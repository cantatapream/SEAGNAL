/**
 * ============================================================================
 * 파일명: local_server/services/station_briefing_rules.js
 * 역할  : 「활동지점 안전 브리핑」(파출소 관할 단위)의 판단 규칙 — 관할 하나의 입력 묶음(가짜 자료로도 만들 수 있는 평범한 객체)을 받아
 *         단계 말(관심·주의·경계 필요)·해역 카드·육상 카드·특별 상황(특보 해제 예고 등)·해상 시간 막대·조석 문구·틀 총평을 만든다.
 *         파일·네트워크·시계를 건드리지 않는 순수 함수만 둔다(같은 입력 → 같은 출력). AI 는 이 결과를 받아 총평 문장만 쓴다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : 없음(Node 내장 crypto 만 — 입력 해시)
 *  - 서버 API      : 없음(routes/station_briefing.js 가 station_briefing.js 를 거쳐 결과를 낸다)
 *  - 마크업        : 없음(화면은 다음 단계 — 계약: client/js/ocean-map/coastal-risk/briefing.contract.md)
 *  - 나를 쓰는 곳  : services/station_briefing.js(생성) · services/station_briefing_ai.js(AI 입력·검증) · scripts/test_station_briefing.js
 *  - 설계 근거     : coastal_safety_forecast.design.md §11.6 결정 1~17 · scratchpad 구성안 §7(단계 말)·§8(뼈대)·§9 안 A·부록 A
 * [로드 순서] 서버 require 부작용 없음.
 * ============================================================================
 */
'use strict';
const crypto = require('crypto');

const RULES_VERSION = 'station-briefing-rules-v2'; // v2(2026-10-16): 독립 검토 반영 — 결측 「확인 불가」·창 겹침·끊긴 시간대·총평 후보 상한 분리 등
const HOUR = 3600000, SLOT_H = 3;
// 단계 말 — 사용자 확정(§11.6-8 Q1 「가」): 「관심 필요·주의 필요·경계 필요」. 주의·경계는 공식 자료(공식 사고예보·기상특보)가 그 단계일 때만.
const WORD = ['', '관심 필요', '주의 필요', '경계 필요'];
const SUBJECT = ['', '관심이', '주의가', '경계가'];
// 전남광주특별시 쪽(목포·완도·여수서 19곳, 여수바다 포함)은 해상만 — 관광지 집중률 API 에 그 지역 자료가 아직 없다(§11.6, 결정 6).
const SEA_ONLY_OFFICES = Object.freeze(['목포해양경찰서', '완도해양경찰서', '여수해양경찰서']);
// 「관심」 기상 기준 — 해상 통합 서버와 같은 값(marine_fusion.js analyze: wh>=2||ws>=12).
const WAVE_M = 2, WIND_MS = 12;
// 특보 해제 뒤 「관심」 시간 — 구성안 §7 해상 표(사용자 「가」 확정): 해제 예정 시각 뒤 12시간.
const AFTER_RELEASE_H = 12;
// 특보 해제 칸 고정 문구(§11.6-7, 독립 검토 정정 반영). 「첫 아침 1.4배」·「0~6시간 1.31배」는 쓰지 않는다.
const RELEASE_LINES = Object.freeze([
    '해제 뒤 출항이 이어질 수 있습니다.',
    '2020~2025년 특보 해제 뒤 이틀 동안 전복·침몰·침수·표류 사고가 평소보다 약 1.2~1.3배 많았습니다.',
]);
const ACCIDENT_RANK = { '주의': 2, '경계': 3 }, CONGESTION_HIGH = new Set(['높음', '매우높음']);
const MAX_SEA_CARDS = 10, MAX_LAND_CARDS = 10, MAX_CONSTANT = 12;
// 결측과 0 구분(CLAUDE.md L-291 「조용한 것이 이상 없는 것처럼 보이면 안 된다」, 독립 검토 A2 — 2026-10-16):
// 원천이 ok 가 아니면 그 근거는 판단에서 빠지므로, 남은 자료로 단계가 0 이어도 「평소 수준」이라 쓰지 않는다.
const UNKNOWN_SOME = '확인 불가(일부)', UNKNOWN_ALL = '확인 불가';
// 원천 열쇠 → 사람이 읽는 이름(해상 원천 4개 + 연안 하루 값 missing 열쇠 — risk_score·risk_store 가 넣는 것).
const SOURCE_LABEL = Object.freeze({
    accident: '공식 사고예보', congestion: '혼잡 예보', zoneForecasts: '해구 예보', warnings: '기상특보',
    concentration: '관광지 사람 집중률', hazard: '위험구역', events: '행사', rip: '이안류', gale: '강풍 자료', forecast: '해구 예보', detail: '관광지 상세',
});
/** 원천 열쇠 목록을 사람이 읽는 이름으로(겹치면 하나). 예: ['accident','congestion'] → '공식 사고예보·혼잡 예보'. @param {string[]} keys @returns {string} [연계] ← templateOverview·station_briefing_ai */
function sourceNames(keys) { return [...new Set((keys || []).map((k) => SOURCE_LABEL[k] || k))].join('·'); }

/** 두 자리 숫자로 만든다. 예: 6 → '06'. @param {number} n @returns {string} [연계] ← 시각 문구들 */
function pad(n) { return String(n).padStart(2, '0'); }
/** KST ISO 를 만든다. 예: Date.parse('2026-10-17T00:00:00+09:00') → '2026-10-17T00:00:00+09:00'. @param {number} ms @returns {string} [연계] ← 창·시각 계산 */
function isoKst(ms) { return new Date(ms + 9 * HOUR).toISOString().slice(0, 19) + '+09:00'; }
/** KST 날짜(YYYY-MM-DD). 예: 2026-10-16T15:30Z → '2026-10-17'. @param {number} ms @returns {string} [연계] ← 창·판 */
function kstDate(ms) { return isoKst(ms).slice(0, 10); }
/** 날짜 문구. 예: '2026-10-17' → '10월 17일'. @param {string} date @returns {string} [연계] ← dayPrefix */
function md(date) { return Number(date.slice(5, 7)) + '월 ' + Number(date.slice(8, 10)) + '일'; }
/** 브리핑 대상 날짜가 아니면 날짜를 앞에 붙인다. 예: ('2026-10-16T21:00…', '2026-10-17') → '10월 16일 ' · 같은 날 → ''. @returns {string} [연계] ← rangeText·warnTimeText */
function dayPrefix(iso, targetDate) { return iso.slice(0, 10) === targetDate ? '' : md(iso.slice(0, 10)) + ' '; }
/** 3시간 칸 묶음을 「HH~HH시」로 쓴다(끝이 자정이면 24). 예: ('…T15:00…','…T18:00…','2026-10-17') → '15~18시'
 * @param {string} startIso @param {string} endIso - 끝(배타) @param {string} targetDate @returns {string} [연계] ← seaSection·timeBar */
function rangeText(startIso, endIso, targetDate) {
    const h1 = Number(startIso.slice(11, 13)), h2 = Number(endIso.slice(11, 13)), head = dayPrefix(startIso, targetDate) + pad(h1);
    if (endIso.slice(0, 10) === startIso.slice(0, 10)) return head + '~' + pad(h2) + '시';
    const nextDay = kstDate(Date.parse(startIso.slice(0, 10) + 'T00:00:00+09:00') + 36 * HOUR);
    if (h2 === 0 && endIso.slice(0, 10) === nextDay) return head + '~24시';
    return head + '시~' + md(endIso.slice(0, 10)) + ' ' + pad(h2) + '시';
}
/** 특보 원자료 시각({start,end,range})을 문구로. 예: 범위 → '06~09시', 정확 → '06:00', 다른 날 → '10월 18일 06~09시'. @returns {string} [연계] ← warningEvents */
function warnTimeText(t, targetDate) {
    if (!t) return '시각 정보 없음';
    if (t.range) return rangeText(t.start, t.end, targetDate);
    return dayPrefix(t.start, targetDate) + t.start.slice(11, 16);
}
/** 조사 「은/는」을 받침으로 고른다. 예: '한림항' → '은', '협재해수욕장' → '은', '비양도' → '는'. @param {string} word @returns {string} [연계] ← 틀 총평 */
function topicJosa(word) { const c = String(word).charCodeAt(String(word).length - 1); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? '은' : '는'; }

/**
 * 생성 판(08:00·17:30·23:00)과 그 판이 다루는 창(3시간 칸)을 정한다(§11.6-10·13·14).
 * 예: editionWindow('morning', 10-17 08:00) → {kind:'morning',targetDate:'2026-10-17',from:'…T06:00…',to:'…10-18T00:00…',slots:[06,09,…,21시 6칸]}
 *     editionWindow('night', 10-16 23:00) → targetDate '2026-10-17'(「오늘 밤~내일」), from 10-16 21:00, to 10-18 00:00 → 9칸
 *     editionWindow('night', 10-17 01:10) → targetDate '2026-10-17'(23시 판을 놓쳐 자정 뒤 늦게 만든 경우), from 00:00 → 8칸
 *     editionWindow('warning', 10-17 13:10, '2026-10-17') → from 12:00 ~ 10-18 00:00(특보가 바뀌어 다시 만드는 판 — 그 날 판의 남은 칸)
 *     editionWindow('warning', 10-17 13:10, '2026-10-18') → from 10-18 00:00(내일 판엔 오늘 칸을 섞지 않음) · 10-17 23:10 이면 from 21:00(night 판과 같은 「오늘 밤~내일」)
 * @param {string} kind - morning|evening|night|warning @param {number} now - ms @param {string} [targetDate] - warning 판의 대상 날짜
 * @returns {object|null} 창(남은 칸이 없으면 null)
 * [연계] ← station_briefing.run / 대상 날짜 = 화면이 고르는 날짜(displayDate)와 같은 규칙
 */
function editionWindow(kind, now, targetDate) {
    const today = kstDate(now), midnight = Date.parse(today + 'T00:00:00+09:00');
    let from = midnight + Math.floor((now - midnight) / (SLOT_H * HOUR)) * SLOT_H * HOUR;
    // night 판은 「오늘 밤~내일」 — 23시에 만들면 대상은 내일. 서버가 23시에 꺼져 있어 자정 뒤(정오 전)에 늦게 만들면 대상은 그날(이미 「내일」이 된 날).
    const target = kind === 'night' ? (now - midnight >= 12 * HOUR ? kstDate(midnight + 36 * HOUR) : today) : kind === 'warning' && targetDate ? targetDate : today;
    // 특보 변경 판이 내일 판을 고칠 때(독립 검토 A8): 21시 전이면 내일 0시부터 — 오늘 칸을 섞지 않는다. 21시부터는 night 판과 같은 「오늘 밤~내일」(U58).
    if (kind === 'warning' && target > today && now - midnight < 21 * HOUR) from = Date.parse(target + 'T00:00:00+09:00');
    const to = Date.parse(target + 'T00:00:00+09:00') + 24 * HOUR;
    if (from >= to) return null;
    const slots = []; for (let t = from; t < to; t += SLOT_H * HOUR) slots.push(isoKst(t));
    return { kind, targetDate: target, from: isoKst(from), to: isoKst(to), slots };
}
// 생성 시각(KST) — 사용자 확정 §11.6-10·13: 08:00 · 17:30 · 23:00.
const EDITIONS = Object.freeze([{ kind: 'morning', h: 8, m: 0 }, { kind: 'evening', h: 17, m: 30 }, { kind: 'night', h: 23, m: 0 }]);
/**
 * 지금 만들어야 할 정시 판을 고른다 — 오늘 지난 판 중 가장 늦은 것이 아직 없으면 그것 하나.
 * 서버가 그 시각에 꺼져 있었으면 다음 판 시각 전까지 늦게라도 만든다(같은 판을 두 번 만들지 않게 done 열쇠로 막는다).
 * 예: 08:00 → {kind:'morning',key:'2026-10-17|morning'} · 07:59 → 어제 night 가 done 이면 null · 17:29(아침 판 있음) → null · 17:30 → evening
 * @param {number} now - ms @param {Set<string>|string[]} done - 만든 판 열쇠 @returns {object|null}
 * [연계] ← station_briefing.tick(1분) / 시험: 가짜 시계
 */
function dueEdition(now, done) {
    const has = done instanceof Set ? (k) => done.has(k) : (k) => (done || []).includes(k);
    const p = isoKst(now), date = p.slice(0, 10), minutes = Number(p.slice(11, 13)) * 60 + Number(p.slice(14, 16));
    let pick = null;
    for (const e of EDITIONS) if (minutes >= e.h * 60 + e.m) pick = e;
    if (!pick) { // 자정~08시 — 어제 23시 판이 없으면 그것(서버가 23시에 꺼져 있었던 경우)
        const y = kstDate(Date.parse(date + 'T00:00:00+09:00') - HOUR), key = y + '|night';
        return has(key) ? null : { kind: 'night', key, date: y };
    }
    const key = date + '|' + pick.kind;
    return has(key) ? null : { kind: pick.kind, key, date };
}
/**
 * 화면(메인)이 보여 줄 날짜 — U58 「당일 한정, 21시 넘으면 다음 날」. 예: 20:59 → 오늘, 21:00 → 내일.
 * @param {number} now - ms @returns {string} YYYY-MM-DD [연계] ← station_briefing.pick
 */
function displayDate(now) { const p = isoKst(now); return Number(p.slice(11, 13)) >= 21 ? kstDate(now + 24 * HOUR) : p.slice(0, 10); }

/**
 * 특보 하나가 3시간 칸 하나에서 어떤 상태인지 본다.
 * 예: 발효 중 풍랑주의보(해제예고 06~09시) · 칸 03시 → {active:true,rank:2} / 칸 09시 → {active:false, after:true}(해제 뒤 12시간 안)
 *     예비 풍랑경보(18시 발효 예정) · 칸 15시 → {} / 칸 18시 → {active:true,rank:3,prewarn:true}(U21 예비 가정)
 * @param {object} w - {zone,type,level:'주의보'|'경보',state:'발효'|'예비',effective,release} @param {number} s - 칸 시작(ms) @param {number} e - 칸 끝(ms)
 * @returns {object} {active,rank,prewarn,after}
 * [연계] ← slotOf
 */
function warnAtSlot(w, s, e) {
    const rank = w.level === '경보' ? 3 : 2, start = w.effective ? Date.parse(w.effective.start) : null;
    if (w.state === '예비') return start !== null && start < e ? { active: true, rank, prewarn: true } : { active: false };
    const relEnd = w.release ? Date.parse(w.release.end) : null;
    const active = (start === null || start < e) && (relEnd === null || relEnd > s);
    const after = !active && relEnd !== null && s >= relEnd - SLOT_H * HOUR && s < relEnd + AFTER_RELEASE_H * HOUR;
    return { active, rank: active ? rank : 0, prewarn: false, after };
}
/**
 * 해역 하나의 3시간 칸 하나를 판정한다(구성안 §7 해상 표, 모두 서버 계산).
 *   경계 필요: 공식 사고예보 '경계' · 풍랑·태풍 경보 발효(예비 경보는 발효 예정 시각부터 — U21)
 *   주의 필요: 공식 사고예보 '주의' · 주의보 발효(같은 예비 규칙)
 *   관심 필요: 충돌·접촉 주의(혼잡 예보 '높음' 이상) · 특보 없이 해구 예보 파고 2m 또는 풍속 12m/s 이상 · 특보 해제 예정 뒤 12시간
 * 자료 상태가 ok 가 아닌 원천은 쓰지 않는다(「확인 불가」 — 지어내지 않는다).
 * 「총평용 단계」(overviewRank): 공식 사고예보 '주의'는 전국 상대 순위라, 같은 칸에 기상(특보·파고·풍속) 또는 혼잡 근거가 겹칠 때만 총평에 올린다(§11.6-17①).
 * 예: {accident:'주의', congestion:{level:'높음',index:12.3}, wh:1.0, ws:6} → {rank:2, overviewRank:2, sources:[…]} · 사고예보 '주의'만 → {rank:2, overviewRank:0}
 * @param {object} cell - {accident,congestion,wh,ws,warnings:[w…]} @param {number} s @param {number} e @param {object} ok - 원천별 사용 가능 여부
 * @returns {object} {rank,overviewRank,sources:[{kind,rank,label}],overviewSources(총평에 쓸 수 있는 근거만),weatherBasis,congestionBasis}
 * [연계] ← seaSection / → warnAtSlot
 */
function slotOf(cell, s, e, ok) {
    const sources = [];
    let warnActive = false;
    if (ok.warnings) for (const w of cell.warnings || []) {
        const st = warnAtSlot(w, s, e);
        if (st.active) { warnActive = true; sources.push({ kind: 'warning', rank: st.rank, label: w.zone + ' ' + w.type + w.level + (st.prewarn ? ' 예비특보(발효 예정 시각 이후)' : '') }); }
        else if (st.after) sources.push({ kind: 'afterRelease', rank: 1, label: w.zone + ' ' + w.type + w.level + ' 해제 뒤' });
    }
    if (ok.accident && ACCIDENT_RANK[cell.accident]) sources.push({ kind: 'accident', rank: ACCIDENT_RANK[cell.accident], label: "공식 사고예보 '" + cell.accident + "'" });
    const congestionBasis = !!(ok.congestion && cell.congestion && CONGESTION_HIGH.has(cell.congestion.level));
    if (congestionBasis) sources.push({ kind: 'congestion', rank: 1, label: "혼잡 예보 '" + cell.congestion.level + "'(" + (cell.congestion.at ? Number(cell.congestion.at.slice(11, 13)) + '시 ' : '') + '혼잡지수 ' + cell.congestion.index + ') → 충돌·접촉 주의' });
    const wx = ok.zoneForecasts && ((Number.isFinite(cell.wh) && cell.wh >= WAVE_M) || (Number.isFinite(cell.ws) && cell.ws >= WIND_MS));
    if (wx && !warnActive) sources.push({ kind: 'weather', rank: 1, label: '해구 예보 ' + [cell.wh >= WAVE_M ? '파고 ' + cell.wh + 'm' : null, cell.ws >= WIND_MS ? '풍속 ' + cell.ws + 'm/s' : null].filter(Boolean).join('·') });
    const weatherBasis = warnActive || !!wx;
    sources.sort((a, b) => b.rank - a.rank);
    const rank = sources.length ? sources[0].rank : 0;
    const overviewSources = sources.filter((x) => !(x.kind === 'accident' && x.rank === 2 && !weatherBasis && !congestionBasis));
    const overviewRank = overviewSources.length ? overviewSources[0].rank : 0;
    return { rank, overviewRank, sources, overviewSources, weatherBasis, congestionBasis };
}
/**
 * 해역 이름 — U60 「○○ 방위 N해리 해역(대해구-소해구해구)」. 주요지명(조석 표준항 165곳)이 10km 넘게 멀면
 * 관할 안 포구·섬·해수욕장(관광지 이름, 없으면 위험구역 장소명)을 기준점으로 쓴다(§11.6-5, 결정 5). 그 기준점도 더 멀면 주요지명 그대로.
 * 예: 한림 비양도 북쪽 칸 → 주요지명 화순항 24.6km → 관광지 비양도 3.1km → '비양도 북방 1.7해리 해역(232-2해구)'
 * @param {object} region - {lat,lon,ref:{name,distNm,bearingWord},haegu:{label}} @param {object[]} places - [{name,lat,lon}]
 * @returns {object} {name, base, baseKind:'ref'|'place', distKm}
 * [연계] ← seaSection / → haversineKm·bearing16 (marine_fusion.location 과 같은 꼴)
 */
function regionName(region, places) {
    const label = region.haegu?.label ? '(' + region.haegu.label + '해구)' : '';
    const ref = region.ref, refKm = ref ? ref.distNm * 1.852 : Infinity;
    let best = null;
    if (refKm > 10) for (const p of places || []) { const d = haversineKm(p.lat, p.lon, region.lat, region.lon); if (!best || d < best.d) best = { p, d }; }
    // 거리 0 가드(독립 검토 낮음): 0.1해리(약 185m)보다 가까우면 방위가 뜻이 없다 — 「○○ 인근 해역」.
    if (best && best.d < refKm) {
        if (best.d / 1.852 < 0.1) return { name: best.p.name + ' 인근 해역' + label, base: best.p.name, baseKind: 'place', distKm: +best.d.toFixed(1) };
        const word = bearing16(bearingDeg(best.p.lat, best.p.lon, region.lat, region.lon));
        return { name: best.p.name + ' ' + word + '방 ' + (best.d / 1.852).toFixed(1) + '해리 해역' + label, base: best.p.name, baseKind: 'place', distKm: +best.d.toFixed(1) };
    }
    if (!ref) return { name: '관할 해역' + label, base: null, baseKind: 'none', distKm: null };
    if (!(Number(ref.distNm) >= 0.1) || !ref.bearingWord) return { name: ref.name + ' 인근 해역' + label, base: ref.name, baseKind: 'ref', distKm: +refKm.toFixed(1) };
    return { name: ref.name + ' ' + ref.bearingWord + '방 ' + Number(ref.distNm).toFixed(1) + '해리 해역' + label, base: ref.name, baseKind: 'ref', distKm: +refKm.toFixed(1) };
}
/** 두 점 거리(km, 대권). risk_geo.haversine 과 같은 식(R=6371). @returns {number} [연계] ← regionName */
function haversineKm(lat1, lon1, lat2, lon2) { const r = Math.PI / 180, a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2; return 2 * 6371 * Math.asin(Math.sqrt(Math.min(1, a))); }
/** 방위각(도). risk_geo.bearing 과 같은 식. @returns {number} [연계] ← regionName */
function bearingDeg(lat1, lon1, lat2, lon2) { const r = Math.PI / 180, dl = (lon2 - lon1) * r, y = Math.sin(dl) * Math.cos(lat2 * r), x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos(dl); return (Math.atan2(y, x) / r + 360) % 360; }
/** 16방위. risk_geo.direction16 과 같은 표. 예: 0 → '북'. @returns {string} [연계] ← regionName */
function bearing16(deg) { return ['북', '북북동', '북동', '동북동', '동', '동남동', '남동', '남남동', '남', '남남서', '남서', '서남서', '서', '서북서', '북서', '북북서'][Math.round(((deg % 360 + 360) % 360) / 22.5) % 16]; }

/**
 * 해구 3시간 예보의 흐름에서 「몇 시부터」 기상이 기준(파고 2m·풍속 12m/s)을 넘는지 찾는다(§11.6-3 결정 1).
 * 예: [09시 1.0m·6m/s, 12시 1.4m·9m/s, 15시 2.4m·13m/s] → {onsetAt:'…15:00', text:'대해구 232 예보는 15시부터 파고 2.4m·풍속 13m/s로 높아집니다(12시 파고 1.4m·풍속 9m/s)'}
 *     처음부터 넘음 → '창 시작(09시)부터 파고 …' · 끝까지 안 넘음 → onsetAt null, 최대값 문구
 * @param {object[]} series - [{at,wh,ws}] 칸 순서 @param {string} label - 해구 이름 @param {string} targetDate @returns {object|null}
 * [연계] ← seaSection(해역 카드 「오늘 예상」·총평 근거)
 */
function weatherFlow(series, label, targetDate) {
    const rows = (series || []).filter((r) => Number.isFinite(r.wh) || Number.isFinite(r.ws));
    if (!rows.length) return null;
    const over = (r) => r.wh >= WAVE_M || r.ws >= WIND_MS, txt = (r) => [Number.isFinite(r.wh) ? '파고 ' + r.wh + 'm' : null, Number.isFinite(r.ws) ? '풍속 ' + r.ws + 'm/s' : null].filter(Boolean).join('·');
    const hh = (r) => dayPrefix(r.at, targetDate) + Number(r.at.slice(11, 13)) + '시';
    const i = rows.findIndex(over);
    const max = rows.reduce((m, r) => ({ wh: Math.max(m.wh, r.wh ?? -1), ws: Math.max(m.ws, r.ws ?? -1) }), { wh: -1, ws: -1 });
    if (i < 0) return { label, onsetAt: null, endAt: null, max, text: label + ' 예보는 최대 ' + txt({ wh: max.wh >= 0 ? max.wh : null, ws: max.ws >= 0 ? max.ws : null }) + '로 기준(파고 2m·풍속 12m/s) 미만입니다' };
    const j = rows.findIndex((r, k) => k > i && !over(r));
    const head = i === 0 ? '창 시작(' + hh(rows[0]) + ')부터 ' : hh(rows[i]) + '부터 ';
    const before = i > 0 ? '(' + hh(rows[i - 1]) + ' ' + txt(rows[i - 1]) + ')' : '';
    const tail = j > 0 ? ', ' + hh(rows[j]) + '부터 기준 아래로 내려갑니다' : '';
    return { label, onsetAt: rows[i].at, endAt: j > 0 ? rows[j].at : null, max, text: label + ' 예보는 ' + head + txt(rows[i]) + '로 높아집니다' + before + tail };
}
/**
 * 특보 원자료 목록에서 브리핑 창 안의 사건(발효 시작·예비특보·해제 예고)을 뽑고 특별 상황 칸을 만든다.
 * 해제 예고 칸(§11.6-7): 「{구역} {종류}{등급} — {HH~HH시} 해제 예고(더 일찍 풀릴 수 있음)」 + RELEASE_LINES 두 줄(숫자 없는 안내 + 2020~2025 해제 뒤 이틀 1.2~1.3배).
 * 예: [{zone:'제주도서부앞바다',type:'풍랑',level:'주의보',state:'발효',release:{start:'…06:00',end:'…09:00',range:true}}] → special[0].title '제주도서부앞바다 풍랑주의보 — 06~09시 해제 예고(더 일찍 풀릴 수 있음)'
 * @param {object[]} warnings @param {object} win - editionWindow 결과 @returns {object} {events:[{kind,at,text,zone}], special:[{kind,zone,title,lines}]}
 * [연계] ← buildBriefing / → warnTimeText
 */
function warningEvents(warnings, win) {
    const from = Date.parse(win.from), to = Date.parse(win.to), events = [], special = [], seen = new Set();
    const inWin = (iso) => iso && Date.parse(iso) >= from && Date.parse(iso) < to;
    // 범위 시각(해제 예고 「06~09시」·예비 발효 예정 범위)은 창과 겹치면 넣는다 — 창 시작 전에 시작해도 창 안에 걸치면 빠뜨리지 않는다(독립 검토 A4).
    const overlaps = (t) => t && (t.range && t.end ? Date.parse(t.start) < to && Date.parse(t.end) > from : inWin(t.start));
    const atIn = (iso) => isoKst(Math.max(Date.parse(iso), from)); // 시간 막대 칸에 붙일 시각 — 창 앞이면 첫 칸
    for (const w of warnings || []) {
        const name = w.zone + ' ' + w.type + w.level;
        if (w.state === '예비') {
            const k = 'pre|' + name; if (seen.has(k)) continue; seen.add(k);
            const when = w.effective ? warnTimeText(w.effective, win.targetDate) + ' 발효 예정' : '발효 시각 정보 없음';
            if (!w.effective || overlaps(w.effective)) { events.push({ kind: 'prewarn', at: w.effective ? atIn(w.effective.start) : win.from, zone: w.zone, text: name + ' 예비특보 — ' + when }); special.push({ kind: 'prewarn', zone: w.zone, title: name + ' 예비특보 — ' + when, lines: [] }); }
            continue;
        }
        if (w.effective && inWin(w.effective.start) && !seen.has('start|' + name)) { seen.add('start|' + name); events.push({ kind: 'warnStart', at: w.effective.start, zone: w.zone, text: name + ' 발효 ' + warnTimeText(w.effective, win.targetDate) }); }
        if (w.release && overlaps(w.release) && !seen.has('rel|' + name)) {
            seen.add('rel|' + name);
            const title = name + ' — ' + warnTimeText(w.release, win.targetDate) + ' 해제 예고(더 일찍 풀릴 수 있음)';
            events.push({ kind: 'release', at: atIn(w.release.start), zone: w.zone, text: title });
            special.push({ kind: 'release', zone: w.zone, title, lines: RELEASE_LINES.slice() });
        }
    }
    events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    return { events, special };
}
/**
 * 칸 시각 목록(창 순서)을 이어진 묶음별 「HH~HH시」로 쓴다 — 끊긴 시간대를 하나로 잇지 않는다(독립 검토 A6).
 * 예: [06시] → '06~09시' · [15,18시] → '15~21시' · [06,21시] → '06~09시·21~24시'
 * @param {string[]} ats - 칸 시작 시각(오름차순) @param {string} targetDate @returns {string} [연계] ← seaSection(카드 창·오늘 예상)·runLabels
 */
function runsText(ats, targetDate) {
    const out = []; let s = null, prev = null;
    for (const at of ats) { const t = Date.parse(at); if (s !== null && t === prev + SLOT_H * HOUR) { prev = t; continue; } if (s !== null) out.push([s, prev]); s = t; prev = t; }
    if (s !== null) out.push([s, prev]);
    return out.map(([a, b]) => rangeText(isoKst(a), isoKst(b + SLOT_H * HOUR), targetDate)).join('·');
}
/** 원천 결측을 반영한 단계 말. 예: (0, []) → '평소 수준' · (0, ['congestion']) → '확인 불가(일부)' · (2, […]) → '주의 필요'. @param {number} rank @param {string[]} missing @param {number} total - 원천 수 @returns {string} [연계] ← seaSection·landSection */
function levelWord(rank, missing, total) { return rank ? WORD[rank] : !missing.length ? '평소 수준' : total && missing.length >= total ? UNKNOWN_ALL : UNKNOWN_SOME; }
/**
 * 해상 분석: 관할 안 모든 해역(같은 공식 사고 5km 칸은 하나 — 수집 단계에서 묶임)을 창의 모든 3시간 칸에서 판정하고,
 * 순위(단계 > 그 단계 지속 칸 수 > 기상·혼잡 근거 겹침 > 과거 사고 수)를 매겨 카드·시간 막대를 만든다.
 * 원천이 ok 가 아니거나(sources) 공식 사고예보 프레임이 빠진 칸(sea.frameGaps.accident)은 그 근거를 쓰지 않고, 단계가 0 이면 「평소 수준」 대신 「확인 불가(일부)」(A2).
 * 총평 후보(overviewTop)는 카드 상한(10)과 상관없이 총평 단계 순위에서 바로 고른다 — 단계 말과 총평 문장이 어긋나지 않게(A5).
 * 예: 한림 고정 자료 → {level:{rank:2,word:'주의 필요'}, reviewedCells:52, attentionRegions:4, cards:[{name:'비양도 북방 …', window:'15~18시', …}], timeBar:[6칸]}
 * @param {object} input - 관할 입력 묶음 @param {object} win - editionWindow @param {object} wev - warningEvents 결과
 * @returns {object} 해상 절 [연계] ← buildBriefing / → slotOf·regionName·weatherFlow·runsText
 */
function seaSection(input, win, wev) {
    const ok = Object.fromEntries(['accident', 'congestion', 'zoneForecasts', 'warnings'].map((k) => [k, input.sources?.[k] === 'ok']));
    const sea = input.sea || {}, warnings = sea.warnings || [], slots = win.slots;
    const accGaps = new Set((sea.frameGaps?.accident || []).filter((at) => slots.includes(at)));
    const regions = (sea.regions || []).map((r) => {
        const zk = r.zone ? zoneKey(r.zone.name) : null, ws = warnings.filter((w) => zk && zoneKey(w.zone) === zk);
        const series = slots.map((at) => {
            const s = Date.parse(at), e = s + SLOT_H * HOUR, x = r.slots?.[at] || {}, wx = (sea.weather?.[r.haegu?.major]?.rows || []).find((q) => q.at === at) || {};
            return { at, ...slotOf({ accident: x.accident, congestion: x.congestion, wh: wx.wh, ws: wx.ws, warnings: ws }, s, e, accGaps.has(at) ? { ...ok, accident: false } : ok) };
        });
        const rank = Math.max(0, ...series.map((q) => q.rank)), overviewRank = Math.max(0, ...series.map((q) => q.overviewRank));
        const topAts = series.filter((q) => q.rank === rank && rank > 0).map((q) => q.at), oAts = series.filter((q) => q.overviewRank === overviewRank && overviewRank > 0).map((q) => q.at);
        const nm = regionName(r, input.places);
        return { r, nm, series, rank, overviewRank, first: series.findIndex((q) => q.rank === rank && rank > 0), topAts, oAts, duration: topAts.length, oDuration: oAts.length, basis: series.some((q) => q.rank === rank && (q.weatherBasis || q.congestionBasis)), accidents: r.history?.count || 0 };
    }).filter((x) => x.rank > 0);
    regions.sort((a, b) => b.rank - a.rank || b.duration - a.duration || Number(b.basis) - Number(a.basis) || b.accidents - a.accidents || a.nm.name.localeCompare(b.nm.name, 'ko'));
    const flows = {};
    for (const [major, w] of Object.entries(sea.weather || {})) flows[major] = ok.zoneForecasts ? weatherFlow(slots.map((at) => ({ at, ...((w.rows || []).find((q) => q.at === at) || {}) })), w.label || '대해구 ' + major, win.targetDate) : null;
    /** 해역 하나를 카드로. 창(window)·「오늘 예상」은 이어진 칸 묶음별(끊긴 시간대를 잇지 않음), peakAt = 가장 높은 단계의 첫 칸. */
    const toCard = (x) => {
        const top = x.first >= 0 ? x.series[x.first].sources[0] : null, windowText = x.topAts.length ? runsText(x.topAts, win.targetDate) : null;
        const h = x.r.history || null, flow = flows[x.r.haegu?.major] || null, hasHist = !!h && h.available !== false;
        // 선박사고 이력: 자료 자체가 없음(집계 불가)과 0건을 가른다(독립 검토 낮음).
        const histText = !hasHist ? '선박사고 이력 자료 없음(집계 불가)' : h.count ? (h.from || '').slice(0, 4) + '~' + (h.to || '').slice(0, 4) + '년 선박사고 ' + h.count + '건(' + (h.topTypes || []).map((t) => t.type + ' ' + t.count).join('·') + ')' + (h.death || h.missing ? ', 사망 ' + (h.death || 0) + '·실종 ' + (h.missing || 0) : '')
            : (h.from && h.to ? h.from.slice(0, 4) + '~' + h.to.slice(0, 4) + '년' : '최근 5년') + ' 선박사고 기록 없음';
        const traits = [histText, x.r.zone?.name || null, x.r.haegu?.label ? x.r.haegu.label + '해구' : null].filter(Boolean);
        const todayLines = [], seenLabel = new Set();
        for (const q of x.series) for (const s of q.sources) { const k = s.kind + s.label; if (seenLabel.has(k)) continue; seenLabel.add(k); todayLines.push(runsText(x.series.filter((z) => z.sources.some((y) => y.kind === s.kind && y.label === s.label)).map((z) => z.at), win.targetDate) + ' ' + s.label); }
        if (flow) todayLines.push(flow.text);
        const tops = hasHist ? h.topTypes || [] : [];
        const sentence = (windowText ? windowText + ' ' : '') + '이 해역은 ' + (top ? top.label : '') + (x.rank === 3 ? ' 단계이므로 공식 경계 단계 확인과 운항 시 경계가 필요합니다.' : ' 근거로 운항 시 ' + SUBJECT[x.rank] + ' 필요합니다.') + (tops[0] ? ' 이 해역에서는 집계 기간 중 ' + tops[0].type + ' 사고가 가장 많이 기록되었습니다.' : '');
        return {
            rid: x.r.rid, name: x.nm.name, nameBase: x.nm.base, nameBaseKind: x.nm.baseKind, rank: x.rank, word: WORD[x.rank], overviewRank: x.overviewRank,
            overview: x.oAts.length ? { rank: x.overviewRank, word: WORD[x.overviewRank], window: runsText(x.oAts, win.targetDate), label: runLabels(x.series.filter((q) => x.oAts.includes(q.at)), win.targetDate), at: x.oAts[0] } : null,
            sourceLabel: top ? top.label : null, window: windowText, peakAt: x.first >= 0 ? x.series[x.first].at : null,
            traits: { history: hasHist && h.count ? { from: h.from, to: h.to, count: h.count, topTypes: h.topTypes || [], death: h.death || 0, missing: h.missing || 0 } : { count: 0, available: hasHist }, zone: x.r.zone || null, haegu: x.r.haegu || null, text: traits.join(' · ') },
            today: { lines: todayLines, weather: flow, slots: x.series.map((q) => ({ at: q.at, rank: q.rank, labels: q.sources.map((s) => s.label) })) },
            sentence, link: { gridId: x.r.gridId || null, accidentGridId: x.r.accidentGridId || null, lat: x.r.lat, lon: x.r.lon, t: x.first >= 0 ? x.series[x.first].at : win.from },
        };
    };
    const cards = regions.slice(0, MAX_SEA_CARDS).map(toCard);
    const missing = Object.entries(ok).filter(([, v]) => !v).map(([k]) => k).concat(ok.accident && accGaps.size ? ['accident'] : []);
    const unknown = levelWord(0, missing, 4);
    const timeBar = slots.map((at, i) => {
        let best = null; for (const x of regions) { const q = x.series[i]; if (q.rank > 0 && (!best || q.rank > best.q.rank)) best = { x, q }; }
        const s = Date.parse(at), e = s + SLOT_H * HOUR;
        return { at, label: dayPrefix(at, win.targetDate) + pad(Number(at.slice(11, 13))) + '시', rank: best ? best.q.rank : 0, word: best ? WORD[best.q.rank] : unknown, region: best ? best.x.nm.name : null, labels: best ? best.q.sources.map((y) => y.label) : [], events: wev.events.filter((v) => Date.parse(v.at) >= s && Date.parse(v.at) < e).map((v) => ({ kind: v.kind, text: v.text })) };
    });
    const rank = regions.length ? regions[0].rank : 0, oRegions = regions.filter((x) => x.overviewRank > 0).sort((a, b) => b.overviewRank - a.overviewRank || b.oDuration - a.oDuration || b.accidents - a.accidents || a.nm.name.localeCompare(b.nm.name, 'ko'));
    const worstFlow = Object.values(flows).filter(Boolean).sort((a, b) => (a.onsetAt ? Date.parse(a.onsetAt) : Infinity) - (b.onsetAt ? Date.parse(b.onsetAt) : Infinity) || (b.max.wh - a.max.wh))[0] || null;
    const oRank = oRegions[0]?.overviewRank || 0;
    return {
        level: { rank, word: levelWord(rank, missing, 4), source: regions[0] ? regions[0].series[regions[0].first].sources[0].label : null, partial: missing.length > 0 },
        overviewLevel: { rank: oRank, word: levelWord(oRank, missing, 4) },
        overviewTop: oRegions.slice(0, 2).map((x) => cards.find((c) => c.rid === x.r.rid) || toCard(x)),
        reviewedCells: sea.reviewedCells || 0, attentionRegions: regions.length, cards, timeBar, weather: worstFlow, weatherByHaegu: flows, missing: [...new Set(missing)],
        missingSlots: accGaps.size ? { accident: [...accGaps].sort() } : {},
    };
}
/**
 * 총평용 근거 묶음 — 총평 단계 칸들에서 칸마다 가장 높은 근거 이름을 모아 근거별 시간대(이어진 묶음별)를 붙인다.
 * 예: 15·18시 공식 사고예보 '주의', 21시 예비특보 → "공식 사고예보 '주의'(15~21시)·제주도서부앞바다 풍랑주의보 예비특보(발효 예정 시각 이후)(21~24시)"
 * @param {object[]} run - 칸 판정 묶음 @param {string} targetDate @returns {string} [연계] ← seaSection(카드 overview.label) → templateOverview
 */
function runLabels(run, targetDate) {
    const by = new Map();
    for (const q of run) { const l = q.overviewSources[0]?.label; if (!l) continue; if (!by.has(l)) by.set(l, []); by.get(l).push(q.at); }
    return [...by.entries()].slice(0, 3).map(([l, ats]) => l + '(' + runsText(ats, targetDate) + ')').join('·');
}
/** 구역 이름 열쇠(띄어쓰기·가운뎃점·점 무시) — warn_zone_cells.zoneKey 와 같은 규칙. @param {string} s @returns {string} [연계] ← seaSection */
function zoneKey(s) { return String(s || '').replace(/[\s·.]/g, ''); }

/**
 * 연안 관광지 하나의 「오늘 바뀐 요소」와 단계를 판정한다(구성안 §7 육상 표 + 이번 결정: 주의·경계는 기상특보가 그 단계일 때만).
 *   오늘 바뀐 요소 = 사람 평소보다 많음(사람 점수>0) · 그날 행사 · 너울 12초 이상 · 이안류 '주의' 이상 · 특보·예비특보 · 떠밀림 바람
 *   경계 필요: 풍랑·태풍·강풍 경보 발효 / 주의 필요: 주의보 발효 / 관심 필요: (바뀐 요소 있음 + 지수 '다소 높음' 이상) · 예비특보 · 떠밀림 문구 · 행사
 *   그 밖 = 「상시 위험 장소」(총평에 올리지 않음 — 10월 평소날에도 68%가 '다소 높음' 이상, 구성안 §5)
 * 예: {people:{ratio:1.8,score:0.8}, band:'높음', notices:{windMs:9}} → {rank:1, changes:['사람 평소의 1.8배','해안 바람 9m/s(튜브·물놀이기구 떠밀림 주의)']}
 * @param {object} s - 관광지 하루 값(coastDayDetail 에서 뽑은 것) @returns {object} {rank,word,sourceLabel,changes:[{kind,text}]}
 * [연계] ← landSection
 */
function landSpot(s) {
    const changes = [], eff = s.notices?.effective || [], pre = s.notices?.prelim || [];
    if (s.people && s.people.score > 0 && Number.isFinite(s.people.ratio)) changes.push({ kind: 'people', text: '사람 평소의 ' + s.people.ratio.toFixed(1) + '배', ratio: +s.people.ratio.toFixed(1) });
    if (s.event?.name) changes.push({ kind: 'event', text: '행사 「' + s.event.name + '」' });
    if (s.swell && s.swell.periodS >= 12) changes.push({ kind: 'swell', text: '너울(파주기 ' + s.swell.periodS + '초)' });
    if (s.rip && ['주의', '경계', '위험'].includes(s.rip.level)) changes.push({ kind: 'rip', text: "이안류 '" + s.rip.level + "'" });
    for (const w of eff) changes.push({ kind: 'warning', text: w + ' 발효' });
    for (const w of pre) changes.push({ kind: 'prewarn', text: w + ' 예비특보' });
    if (Number.isFinite(s.notices?.windMs)) changes.push({ kind: 'drift', text: '해안 바람 ' + s.notices.windMs + 'm/s(튜브·물놀이기구 떠밀림 주의)' });
    let rank = 0, sourceLabel = null;
    const warnRank = Math.max(0, ...eff.map((w) => (/경보/.test(w) ? 3 : 2)));
    if (warnRank) { rank = warnRank; sourceLabel = eff.find((w) => (warnRank === 3 ? /경보/ : /주의보/).test(w)); }
    else {
        // 「관심」 근거 이름은 판정 이유와 맞게(독립 검토 낮음): 지수가 평소 수준 위면 첫 바뀐 요소, 아니면 단독으로 관심이 되는 요소(예비특보·떠밀림·행사).
        const byBand = changes.length && s.band && s.band !== '평소 수준', alone = changes.find((c) => c.kind === 'prewarn' || c.kind === 'drift' || c.kind === 'event');
        if (byBand || alone) { rank = 1; sourceLabel = byBand ? changes[0].text : alone.text; }
    }
    return { rank, word: rank ? WORD[rank] : null, sourceLabel, changes };
}
/**
 * 육상 분석: 관광지 카드(오늘 바뀐 요소가 있는 곳) + 상시 위험 장소 목록(바뀐 요소 없음 + 관광지에 붙지 않은 위험구역).
 * 해상만 관할(전남 19곳·여수바다)은 null 이유와 함께. 해망처럼 관광지 0곳이면 위험구역만으로 상시 위험 장소(§11.6-8 Q8).
 * 예: 한림 고정 자료 → {level:{rank:1,…}, cards:[협재해수욕장…], constant:[{name:'한림항 방파제',…}]}
 * @param {object} input @param {object} win @returns {object|null} 육상 절 [연계] ← buildBriefing / → landSpot
 */
function landSection(input, win) {
    if (input.seaOnly) return null;
    const land = input.land || {}, spots = land.spots || [];
    const judged = spots.map((s) => ({ s, j: landSpot(s) }));
    const cardsAll = judged.filter((x) => x.j.rank > 0).sort((a, b) => b.j.rank - a.j.rank || (b.s.index || 0) - (a.s.index || 0) || (b.s.history?.count || 0) - (a.s.history?.count || 0) || a.s.name.localeCompare(b.s.name, 'ko'));
    const traitText = (s) => [s.hazard?.count ? '위험구역 ' + s.hazard.count + '곳(' + (s.hazard.byType || []).filter((t) => t.count).map((t) => t.class + ' ' + t.count).join('·') + ')' : null, s.history?.count ? (s.history.from || '').slice(0, 4) + '~' + (s.history.to || '').slice(0, 4) + ' 연안사고 ' + s.history.count + '건(' + (s.history.topTypes || []).map((t) => t.type + ' ' + t.count).join('·') + ')' : null, s.beach ? '해수욕장' : null].filter(Boolean).join(' · ');
    const cards = cardsAll.slice(0, MAX_LAND_CARDS).map(({ s, j }) => ({
        id: s.id, name: s.name, rank: j.rank, word: j.word, sourceLabel: j.sourceLabel, index: s.index ?? null, band: s.band || null, peakAt: s.peakAt || null,
        traits: { hazard: s.hazard || null, history: s.history || null, beach: !!s.beach, text: traitText(s) || '기록된 위험구역·연안사고 없음' },
        today: { changes: j.changes.map((c) => c.text), text: j.changes.map((c) => c.text).join(' · ') },
        sentence: s.name + ' — ' + j.changes.map((c) => c.text).join(', ') + '. 물가 접근에 ' + SUBJECT[j.rank] + ' 필요합니다.',
        missing: s.missing || [], link: { spotId: s.id, lat: s.lat, lon: s.lon, date: win.targetDate },
    }));
    const constant = judged.filter((x) => x.j.rank === 0).sort((a, b) => (b.s.hazard?.count || 0) - (a.s.hazard?.count || 0) || (b.s.history?.count || 0) - (a.s.history?.count || 0) || a.s.name.localeCompare(b.s.name, 'ko'))
        .map(({ s, j }) => ({ kind: 'spot', id: s.id, name: s.name, text: traitText(s) || null, changedButLow: j.changes.length > 0 }))
        .concat((land.hazardOnly || []).map((z) => ({ kind: 'hazard', id: z.id, name: z.place, text: [z.class, z.shape].filter(Boolean).join(' · ') })))
        .filter((c) => c.text).slice(0, MAX_CONSTANT);
    const top = cardsAll[0], missing = [...new Set(spots.flatMap((s) => s.missing || []))];
    return {
        level: { rank: top ? top.j.rank : 0, word: levelWord(top ? top.j.rank : 0, missing, 0), source: top ? top.j.sourceLabel : null, partial: missing.length > 0 },
        // 검토한 관광지 수 = 연안 하루 값을 실제로 받은 곳만(상세 실패 'detail' 은 셈에서 뺀다 — 독립 검토 낮음). 실패 수는 failedSpots.
        reviewedSpots: spots.filter((s) => !(s.missing || []).includes('detail')).length, failedSpots: spots.filter((s) => (s.missing || []).includes('detail')).length,
        reviewedHazards: (land.hazardOnly || []).length, cards, constant, overviewTop: cards.slice(0, 3), missing,
    };
}
/**
 * 조석(서해·남해 관할 — §11.6-8·11): 대표 위치에서 가장 가까운 물빠짐 앵커 곡선으로 그 판의 창 안 고조·저조와 문구를 만들고,
 * 화면이 해양종합정보 조석 게이지를 그릴 수 있게 곡선(10분)·고저조(prev/next 포함)를 그대로 넘긴다. 점수에는 넣지 않는다(U45).
 * 문구에는 창(window) 안의 고조·저조만 쓴다(독립 검토 낮음) — 17:30 판은 15시 이후, 23시 판은 전날 곡선(prevDayPeaks)의 오늘 밤 21시 이후도 넣는다(날짜를 붙임).
 * 예: 저조 06:12(-12cm)·18:40, 아침 판 → text ['저조 06:12·18:40 무렵 갯벌·고립 주의 — …'] · 저녁 판(15시~) → '저조 18:40 무렵 …'
 * @param {object|null} tide - 수집 결과 {anchorId,distKm,date,curve,peaks,prevPeak,prevDayPeaks,nextPeak,rocks} @param {object} win @returns {object|null}
 * [연계] ← buildBriefing
 */
function tideSection(tide, win) {
    if (!tide || !Array.isArray(tide.peaks)) return null;
    const from = Date.parse(win.from), to = Date.parse(win.to), prevDate = kstDate(Date.parse(tide.date + 'T00:00:00+09:00') - HOUR);
    const all = (tide.prevDayPeaks || []).map((p) => ({ ...p, date: prevDate })).concat(tide.peaks.map((p) => ({ ...p, date: tide.date })))
        .map((p) => ({ ...p, ms: Date.parse(p.date + 'T' + p.t + ':00+09:00') })).filter((p) => p.ms >= from && p.ms < to);
    const word = (p) => dayPrefix(p.date + 'T', win.targetDate) + p.t;
    const lows = all.filter((p) => p.type === 'low').map(word), highs = all.filter((p) => p.type === 'high').map(word);
    const text = [];
    if (lows.length) text.push('저조 ' + lows.join('·') + ' 무렵 갯벌·고립 주의 — 물이 빠져 갯벌·바위가 드러나고, 물이 다시 차오를 때 고립될 수 있습니다' + (highs.length ? '(고조 ' + highs.join('·') + ').' : '.'));
    const r = tide.rocks;
    if (r && r.count) text.push('관할 안 잠기는 바위(간출암) ' + r.count + '곳이 ' + (r.first === r.last ? r.first : r.first + '~' + r.last) + ' 사이 물에 잠깁니다 — 바위 위 낚시·채취 중 고립에 주의가 필요합니다.');
    return { anchor: { id: tide.anchorId, distKm: tide.distKm }, date: tide.date, gauge: { curve: tide.curve || [], peaks: tide.peaks, prevPeak: tide.prevPeak || null, nextPeak: tide.nextPeak || null, unit: 'cm' }, rocks: r || null, text };
}

/**
 * 틀 총평(AI 없음·AI 실패 때) — 육상 한 문단 + 해상 한 문단, 각 3~5문장, 원인·시간 흐름 포함(§11.6-9). 숫자·지명은 서버가 정한 값만 쓴다.
 * 예: 해상 '오늘 한림파출소 관할 해상은 주의 필요입니다(관할 안 52칸 검토, 관심 이상 4개 해역). 232 해구 15시부터 파고 2.4m·… . 15~18시 비양도 … 따라서 …'
 * @param {object} b - buildBriefing 의 중간 결과(station·sea·land·special·tide) @returns {object} {land:string|null, sea:string}
 * [연계] ← buildBriefing · station_briefing_ai(실패 시 대체) / 검증(validateOverview)을 통과해야 한다(시험)
 */
function templateOverview(b) {
    const st = b.station.name, dayWord = dayWordOf(b);
    const sea = b.sea, s = [], top = sea.overviewTop[0], miss = sea.missing.length ? sourceNames(sea.missing) : null;
    // 빠진 원천은 첫 문장에 밝힌다(A2) — 남은 자료로 0 이어도 「평소 수준」·「없습니다」라 쓰지 않는다.
    const counts = '관할 안 ' + sea.reviewedCells + '칸 검토, ' + (miss ? '확인된 자료 기준 ' : '') + '관심 이상 ' + sea.attentionRegions + '개 해역';
    s.push(dayWord + ' ' + st + ' 관할 해상은 ' + sea.overviewLevel.word + '입니다' + (miss ? ' — ' + miss + ' 자료를 확인하지 못해 그 근거는 판단에서 뺐습니다(' + counts + ').' : '(' + counts + ').'));
    s.push(sea.weather ? sea.weather.text + '.' : '해구 예보 자료를 확인하지 못했습니다.');
    if (top) s.push(top.overview.window + ' ' + top.name + '의 근거는 ' + top.overview.label + '입니다.');
    else s.push(miss ? '확인된 자료에서는 기상·혼잡 근거가 겹치는 해역을 찾지 못했습니다(빠진 자료의 근거는 알 수 없습니다).' : '공식 사고예보 순위만으로 붙은 단계 외에 기상·혼잡 근거가 겹치는 해역은 없습니다.');
    const rel = b.special.find((x) => x.kind === 'release'), pre = b.special.find((x) => x.kind === 'prewarn');
    if (rel) s.push(rel.title + ' — ' + RELEASE_LINES[0]);
    else if (pre) s.push(pre.title + '입니다.');
    s.push(top ? '따라서 ' + top.overview.window + '경 ' + top.name + ' 운항에 ' + SUBJECT[top.overview.rank] + ' 필요합니다.' : miss ? '따라서 출항 전 기상청 특보·예보를 직접 확인하는 데 관심이 필요합니다.' : '따라서 출항 전 기상 확인에 관심이 필요합니다.');
    let land = null;
    if (b.land) {
        const l = [], lt = b.land.overviewTop, lm = b.land.missing.length ? sourceNames(b.land.missing) : null;
        if (lt.length) {
            l.push(dayWord + ' ' + st + ' 관할 육상은 ' + b.land.level.word + '입니다(관광지 ' + b.land.reviewedSpots + '곳 검토, 오늘 바뀐 요소가 있는 곳 ' + b.land.cards.length + '곳' + (lm ? ', 확인하지 못한 자료: ' + lm : '') + ').');
            l.push(lt[0].name + topicJosa(lt[0].name) + ' ' + dayWord + ' ' + lt[0].today.changes.join(', ') + ' 요소가 있습니다.');
            if (lt[1]) l.push(lt[1].name + '도 ' + lt[1].today.changes.join(', ') + ' 요소가 있습니다.');
            l.push('따라서 ' + lt.map((c) => c.name).join('·') + ' 주변 물가 접근에 ' + SUBJECT[lt[0].rank] + ' 필요합니다.');
        } else {
            l.push(dayWord + ' ' + st + ' 관할 육상은 ' + (lm ? b.land.level.word + '입니다 — ' + lm + ' 자료를 확인하지 못했고, 확인된 자료에서는 ' : '') + '평소와 달라진 요소(사람·행사·너울·이안류·특보·바람)가 확인되지 않았습니다.');
            const c = b.land.constant.slice(0, 3).map((x) => x.name);
            l.push(c.length ? '상시 위험 장소로 ' + c.join('·') + ' 등이 있습니다.' : '관할에 연결된 관광지·위험구역 자료가 없습니다.');
            l.push('물가 접근 시 평소처럼 관심이 필요합니다.');
        }
        if (b.tide && b.tide.text[0]) l.push(b.tide.text[0]);
        land = l.slice(0, 5).join(' ');
    }
    return { land, sea: s.slice(0, 5).join(' ') };
}
/**
 * 관할 하나의 브리핑 요소 전체를 만든다(AI 총평 제외 — overview 는 틀로 채워 두고 AI 가 성공하면 바꾼다).
 * 예: buildBriefing(한림 입력, editionWindow('morning',…), {generatedAt}) → {schema,key,station,sea,land,special,tide,overview:{source:'template',…},…}
 * @param {object} input - 관할 입력 묶음(station_briefing_inputs.gather 또는 시험 고정 자료) @param {object} win - editionWindow @param {object} meta - {generatedAt}
 * @returns {object} 브리핑(저장·API 응답 본문)
 * [연계] ← station_briefing.run / → seaSection·landSection·tideSection·warningEvents·templateOverview
 */
function buildBriefing(input, win, meta = {}) {
    // 특보 원천이 ok 가 아니면(낡음·없음) 해제 예고·예비 칸·사건도 만들지 않는다 — 단계 판정(slotOf ok.warnings)과 같은 규칙(독립 검토 A3, marine_fusion warningsAt 과 같게).
    const wev = warningEvents(input.sources?.warnings === 'ok' ? input.sea?.warnings : [], win);
    const b = {
        schema: 'station-briefing-v1', rulesVersion: RULES_VERSION, key: input.key,
        station: { name: input.name, office: input.office, region: input.region || null },
        edition: win.kind, targetDate: win.targetDate, window: { from: win.from, to: win.to }, generatedAt: meta.generatedAt || null,
        seaOnly: !!input.seaOnly, seaOnlyReason: input.seaOnly ? (input.seaOnlyReason || '관광지 집중률 자료 없음(전남) — 해상만') : null,
        location: input.location || null, sources: input.sources || {},
        sea: seaSection(input, win, wev), land: landSection(input, win), special: wev.special, tide: tideSection(input.tide, win),
        kmaOutlook: input.kmaOutlook ? { title: input.kmaOutlook.title || null, publishTime: input.kmaOutlook.publishTime || null } : null,
        notice: '참고 정보이며 안전을 보장하지 않습니다.',
    };
    const t = templateOverview(b);
    b.overview = { land: t.land, sea: t.sea, source: 'template', model: null };
    return b;
}
/** 총평의 「오늘/내일」 — 대상 날짜가 만든 날짜보다 뒤면 내일. 예: 23시 판(대상 다음 날) → '내일'. @param {object} b @returns {string} [연계] ← templateOverview·station_briefing_ai.stationInput */
function dayWordOf(b) { return b.generatedAt && b.targetDate > b.generatedAt.slice(0, 10) ? '내일' : '오늘'; }
/** 안정된 JSON(열쇠 정렬). 예: {b:1,a:2} → '{"a":2,"b":1}'. @param {any} v @returns {string} [연계] ← hash */
function stable(v) { return Array.isArray(v) ? '[' + v.map(stable).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}' : JSON.stringify(v === undefined ? null : v); }
/** 입력 해시(sha256 앞 16자). 예: hash({a:1}) === hash({a:1}). @param {any} v @returns {string} [연계] ← station_briefing_ai(같은 입력이면 지난 총평 재사용) */
function hash(v) { return crypto.createHash('sha256').update(stable(v)).digest('hex').slice(0, 16); }

module.exports = {
    RULES_VERSION, WORD, SEA_ONLY_OFFICES, RELEASE_LINES, WAVE_M, WIND_MS, EDITIONS, SOURCE_LABEL, UNKNOWN_SOME, UNKNOWN_ALL,
    isoKst, kstDate, md, editionWindow, runsText, levelWord, sourceNames, dueEdition, displayDate, rangeText, warnTimeText, warnAtSlot, slotOf, regionName, weatherFlow,
    warningEvents, seaSection, landSpot, landSection, tideSection, templateOverview, buildBriefing, stable, hash, zoneKey, topicJosa, haversineKm, dayWordOf,
};
