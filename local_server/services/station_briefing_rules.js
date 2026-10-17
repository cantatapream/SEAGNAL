/**
 * ============================================================================
 * 파일명: local_server/services/station_briefing_rules.js
 * 역할  : 「활동지점 안전 브리핑」(파출소 관할 단위)의 판단 규칙 — 관할 하나의 입력 묶음(가짜 자료로도 만들 수 있는 평범한 객체)을 받아
 *         단계 말(관심·주의·경계 필요)·해역 카드·육상 카드·특별 상황(특보 해제 예고 등)·해상 시간 막대·조석 문구·「총평과 권고」 결론·근거·권고·(기상: 가장 가까운 앞바다 단기 해상예보·단기 전망 특이사항)·(물때)(summary)를 만든다.
 *         파일·네트워크·시계를 건드리지 않는 순수 함수만 둔다(같은 입력 → 같은 출력). AI 는 이 결과를 받아 짧은 해설(1~2문장)만 쓴다(2026-10-17 결정 — 설계서 §11.10).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : 없음(Node 내장 crypto 만 — 입력 해시)
 *  - 서버 API      : 없음(routes/station_briefing.js 가 station_briefing.js 를 거쳐 결과를 낸다)
 *  - 마크업        : 없음(화면은 다음 단계 — 계약: client/js/ocean-map/coastal-risk/briefing.contract.md)
 *  - 나를 쓰는 곳  : services/station_briefing.js(생성) · services/station_briefing_ai.js(AI 입력·검증) · scripts/test_station_briefing.js
 *  - 설계 근거     : coastal_safety_forecast.design.md §11.6 결정 1~17 · §11.10(총평과 권고 구조 — 2026-10-17) · scratchpad 구성안 §7(단계 말)·§8(뼈대)·§9 안 A·부록 A
 * [로드 순서] 서버 require 부작용 없음.
 * ============================================================================
 */
'use strict';
const crypto = require('crypto');

const RULES_VERSION = 'station-briefing-rules-v7'; // v7(2026-10-17 사용자 후속 결정 §11.10.1): 총평에 (기상)(가장 가까운 앞바다 단기 해상예보 오전·오후 + 지방기상청 단기 전망 특이사항)·(물때) 공용 칸 · 예보에서 온 근거에 「예상」 · v6(2026-10-17 사용자 결정 §11.10): 총평을 서버가 만드는 결론·근거·권고(summary)로 — 틀 총평 문단(templateOverview) 폐지 · 육상 「관심 이상인 곳」 수를 카드 상한(10) 대신 전체 수로 · 해상 총평 후보 3곳 · SOURCE_LABEL 에 너울(swell) · v5(2026-10-16 2단계 화면 독립 검토 B1·B12): 틀 총평 「관심 이상 N개 해역」을 총평 기준 수로(공식 사고예보 단계만 있는 해역은 따로 셈) · 경계 카드 문장의 「공식」을 출처별로 · v2(2026-10-16): 독립 검토 반영 — 결측 「확인 불가」·창 겹침·끊긴 시간대·총평 후보 상한 분리 등 · v3(같은 날 사용자 결정 1·2·4·5): 특보 기상청 시각 그대로·육상 지수 단계·해제 뒤 관심 1/3시간·밀물 조석 문구 · v4(같은 날 *"모두 추천대로."*): 공식 사고예보 「경계」도 「주의」처럼 기상·혼잡이 겹칠 때만 총평
const HOUR = 3600000, SLOT_H = 3;
// 단계 말 — 사용자 확정(§11.6-8 Q1 「가」): 「관심 필요·주의 필요·경계 필요」. 해상의 주의·경계는 공식 자료(공식 사고예보·기상특보)가 그 단계일 때만.
// 육상은 2026-10-16 결정 2(*"공식 단어 … 써도 상관없을 것 같다 … 어차피 판단은 사람들이 하는거잖아"*)로 연안 위험지수 단계도 주의·경계를 붙인다(landSpot).
const WORD = ['', '관심 필요', '주의 필요', '경계 필요'];
const SUBJECT = ['', '관심이', '주의가', '경계가'];
// 전남광주특별시 쪽(목포·완도·여수서 19곳, 여수바다 포함)은 해상만 — 관광지 집중률 API 에 그 지역 자료가 아직 없다(§11.6, 결정 6).
const SEA_ONLY_OFFICES = Object.freeze(['목포해양경찰서', '완도해양경찰서', '여수해양경찰서']);
// 「관심」 기상 기준 — 해상 통합 서버와 같은 값(marine_fusion.js analyze: wh>=2||ws>=12).
const WAVE_M = 2, WIND_MS = 12;
// 특보 해제 뒤 「관심」 시간 — 2026-10-16 결정 4(원문 *"특보 해제후에는 관심필요는 육상은 3시간 해상은 1시간동안 붙일 수 있도록 하자."*): 해상 1시간·육상 3시간.
// 종전 구성안 §7 해상 표의 「해제 예정 시각 뒤 12시간」을 대체한다. 해상 3시간 칸에서는 해제 뒤 1시간이 걸친 칸만(warnAtSlot).
const AFTER_RELEASE_SEA_H = 1, AFTER_RELEASE_LAND_H = 3;
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
    // swell — risk_score.js 가 연안 하루 값 missing 에 넣는 열쇠(너울 자료 없음). 종전엔 이 표에 없어 영어 그대로 「swell」이 화면·AI 검증(required:missing:swell)에 나갔다(2026-10-17).
    swell: '너울',
});
/** 원천 열쇠 목록을 사람이 읽는 이름으로(겹치면 하나). 예: ['accident','congestion'] → '공식 사고예보·혼잡 예보'. @param {string[]} keys @returns {string} [연계] ← landSummary·seaSummary·station_briefing_ai */
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
 * 해제 뒤 「관심」(2026-10-16 결정 4): 해상은 해제(예고 범위면 범위 끝) 뒤 1시간 — 그 1시간이 걸친 칸만. 발효가 아직 이어지는 칸은 발효 단계 그대로.
 * 이미 해제된 특보(state '해제' — 특보 구간 기록 sea_warning_history 의 실제 해제 시각)도 같은 규칙.
 * 예: 발효 중 풍랑주의보(해제예고 06~09시) · 칸 06시 → {active:true,rank:2} / 칸 09시 → {active:false, after:true}(09~10시가 걸침) / 칸 12시 → {after:false}
 *     해제예고 10:30(정확) · 칸 09시 → 발효(10:30 전) / 칸 12시 → after 없음(10:30~11:30 은 09시 칸 안 — 그 칸은 발효 단계)
 *     예비 풍랑경보(18시 발효 예정) · 칸 15시 → {} / 칸 18시 → {active:true,rank:3,prewarn:true}(U21 예비 가정)
 * @param {object} w - {zone,type,level:'주의보'|'경보',state:'발효'|'예비'|'해제',effective,release} @param {number} s - 칸 시작(ms) @param {number} e - 칸 끝(ms)
 * @returns {object} {active,rank,prewarn,after}
 * [연계] ← slotOf
 */
function warnAtSlot(w, s, e) {
    const rank = w.level === '경보' ? 3 : 2, start = w.effective ? Date.parse(w.effective.start) : null;
    if (w.state === '예비') return start !== null && start < e ? { active: true, rank, prewarn: true } : { active: false };
    const relEnd = w.release ? Date.parse(w.release.end) : null;
    const active = w.state !== '해제' && (start === null || start < e) && (relEnd === null || relEnd > s);
    const after = !active && relEnd !== null && relEnd < e && relEnd + AFTER_RELEASE_SEA_H * HOUR > s;
    return { active, rank: active ? rank : 0, prewarn: false, after };
}
/**
 * 해역 하나의 3시간 칸 하나를 판정한다(구성안 §7 해상 표, 모두 서버 계산).
 *   경계 필요: 공식 사고예보 '경계' · 풍랑·태풍 경보 발효(예비 경보는 발효 예정 시각부터 — U21)
 *   주의 필요: 공식 사고예보 '주의' · 주의보 발효(같은 예비 규칙)
 *   관심 필요: 충돌·접촉 주의(혼잡 예보 '높음' 이상) · 특보 없이 해구 예보 파고 2m 또는 풍속 12m/s 이상 · 특보 해제 뒤 1시간(결정 4 — 그 1시간이 걸친 칸)
 * 자료 상태가 ok 가 아닌 원천은 쓰지 않는다(「확인 불가」 — 지어내지 않는다).
 * 「총평용 단계」(overviewRank): 공식 사고예보 '주의'·'경계'는 공단 자체 단계라, 같은 칸에 기상(특보·파고·풍속) 또는 혼잡 근거가 겹칠 때만 총평에 올린다
 *   (§11.6-17① 「주의」 + 2026-10-16 *"모두 추천대로."* 로 「경계」도 — §11.8 결정 3). 거른 칸도 해역 카드·시간 막대(rank)에는 그대로 남는다.
 * 예: {accident:'주의', congestion:{level:'높음',index:12.3}, wh:1.0, ws:6} → {rank:2, overviewRank:2, sources:[…]} · 사고예보 '주의'만 → {rank:2, overviewRank:0} · '경계'만 → {rank:3, overviewRank:0}
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
        else if (st.after) sources.push({ kind: 'afterRelease', rank: 1, label: w.zone + ' ' + w.type + w.level + ' 해제 뒤' + (w.state === '해제' && w.release ? '(' + w.release.start.slice(11, 16) + ' 해제)' : '') });
    }
    if (ok.accident && ACCIDENT_RANK[cell.accident]) sources.push({ kind: 'accident', rank: ACCIDENT_RANK[cell.accident], label: "공식 사고예보 '" + cell.accident + "'" });
    const congestionBasis = !!(ok.congestion && cell.congestion && CONGESTION_HIGH.has(cell.congestion.level));
    if (congestionBasis) sources.push({ kind: 'congestion', rank: 1, label: "혼잡 예보 '" + cell.congestion.level + "'(" + (cell.congestion.at ? Number(cell.congestion.at.slice(11, 13)) + '시 ' : '') + '혼잡지수 ' + cell.congestion.index + ') → 충돌·접촉 주의' });
    const wx = ok.zoneForecasts && ((Number.isFinite(cell.wh) && cell.wh >= WAVE_M) || (Number.isFinite(cell.ws) && cell.ws >= WIND_MS));
    if (wx && !warnActive) sources.push({ kind: 'weather', rank: 1, label: '해구 예보 ' + [cell.wh >= WAVE_M ? '파고 ' + cell.wh + 'm' : null, cell.ws >= WIND_MS ? '풍속 ' + cell.ws + 'm/s' : null].filter(Boolean).join('·') });
    const weatherBasis = warnActive || !!wx;
    sources.sort((a, b) => b.rank - a.rank);
    const rank = sources.length ? sources[0].rank : 0;
    const overviewSources = sources.filter((x) => !(x.kind === 'accident' && !weatherBasis && !congestionBasis));
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
/** 발표 시각 꼬리. 예: {start:'2026-10-16T14:00…'} · 대상 10-17 → '(10월 16일 14:00 발표)' · 없음 → ''. @param {object} w @param {string} targetDate @returns {string} [연계] ← warningEvents·landSpot */
function issuedText(w, targetDate) { return w && w.issued ? '(' + warnTimeText(w.issued, targetDate) + ' 발표)' : ''; }
/**
 * 특보 원자료 목록에서 브리핑 창 안의 사건(발효 시작·예비특보·해제 예고·이미 해제)을 뽑고 특별 상황 칸을 만든다.
 * 시각은 기상청이 준 것 그대로(2026-10-16 결정 1, 원문 *"발표, 발효, 해제의 시각은 이미 기상청으로부터 제공이 되는 거니까 그 시각에 맞춰서 그냥 표출"*) — 발표 시각이 있으면 함께.
 * 해제 예고 칸(§11.6-7): 「{구역} {종류}{등급} — {HH~HH시} 해제 예고({발표} 발표)」 + RELEASE_LINES 두 줄(숫자 없는 안내 + 2020~2025 해제 뒤 이틀 1.2~1.3배).
 *   「더 일찍 풀릴 수 있음」은 쓰지 않는다(사용자 *"더 일찍 풀릴수 있음은 굳이 쓸 필요 없을 것 같애"*).
 * 예비특보 칸: 「{구역} {종류}{등급} 예비특보 — {HH시·범위} 발효 예정({발표} 발표)」.
 * 이미 해제된 특보(state '해제' — 특보 구간 기록의 실제 해제 시각, 입력 단계가 창 시작 3시간 전부터만 넘긴다): 「… — HH:MM 해제」 + RELEASE_LINES(kind 'released').
 * 예: [{zone:'제주도서부앞바다',type:'풍랑',level:'주의보',state:'발효',issued:{start:'…16T14:00…'},release:{start:'…06:00',end:'…09:00',range:true}}] → special[0].title '제주도서부앞바다 풍랑주의보 — 06~09시 해제 예고(10월 16일 14:00 발표)'
 * @param {object[]} warnings @param {object} win - editionWindow 결과 @returns {object} {events:[{kind,at,text,zone}], special:[{kind,zone,title,lines}]}
 * [연계] ← buildBriefing / → warnTimeText·issuedText
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
            const when = (w.effective ? warnTimeText(w.effective, win.targetDate) + ' 발효 예정' : '발효 시각 정보 없음') + issuedText(w, win.targetDate);
            if (!w.effective || overlaps(w.effective)) { events.push({ kind: 'prewarn', at: w.effective ? atIn(w.effective.start) : win.from, zone: w.zone, text: name + ' 예비특보 — ' + when }); special.push({ kind: 'prewarn', zone: w.zone, title: name + ' 예비특보 — ' + when, lines: [] }); }
            continue;
        }
        if (w.state === '해제') {
            if (!w.release || seen.has('gone|' + name)) continue; seen.add('gone|' + name);
            const title = name + ' — ' + warnTimeText(w.release, win.targetDate) + ' 해제';
            events.push({ kind: 'released', at: atIn(w.release.start), zone: w.zone, text: title });
            special.push({ kind: 'released', zone: w.zone, title, lines: RELEASE_LINES.slice() });
            continue;
        }
        if (w.effective && inWin(w.effective.start) && !seen.has('start|' + name)) { seen.add('start|' + name); events.push({ kind: 'warnStart', at: w.effective.start, zone: w.zone, text: name + ' 발효 ' + warnTimeText(w.effective, win.targetDate) }); }
        if (w.release && overlaps(w.release) && !seen.has('rel|' + name)) {
            seen.add('rel|' + name);
            const title = name + ' — ' + warnTimeText(w.release, win.targetDate) + ' 해제 예고' + issuedText(w, win.targetDate);
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
        // 경계 문장(2026-10-16 2단계 검토 B12): 종전 「공식 경계 단계 확인」의 「공식」이 무엇인지 모호했다 — 출처별로 무엇을 확인할지 쓴다
        //   공식 사고예보(한국해양교통안전공단 선박 사고위험 예보) '경계' → 「공단 사고위험 예보를 확인하고」 · 특보(풍랑·태풍 경보·예비 경보) → 「기상청 특보를 확인하고」.
        const alert3 = top && top.kind === 'accident' ? ' 단계이므로 공단 사고위험 예보를 확인하고 운항 시 경계가 필요합니다.' : ' 근거로 기상청 특보를 확인하고 운항 시 경계가 필요합니다.';
        const sentence = (windowText ? windowText + ' ' : '') + '이 해역은 ' + (top ? top.label : '') + (x.rank === 3 ? alert3 : ' 근거로 운항 시 ' + SUBJECT[x.rank] + ' 필요합니다.') + (tops[0] ? ' 이 해역에서는 집계 기간 중 ' + tops[0].type + ' 사고가 가장 많이 기록되었습니다.' : '');
        return {
            rid: x.r.rid, name: x.nm.name, nameBase: x.nm.base, nameBaseKind: x.nm.baseKind, rank: x.rank, word: WORD[x.rank], overviewRank: x.overviewRank,
            overview: x.oAts.length ? { rank: x.overviewRank, word: WORD[x.overviewRank], window: runsText(x.oAts, win.targetDate), label: runLabels(x.series.filter((q) => x.oAts.includes(q.at)), win.targetDate), labels: runLabelList(x.series.filter((q) => x.oAts.includes(q.at)), win.targetDate), at: x.oAts[0] } : null,
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
        const oRankAt = Math.max(0, ...regions.map((x) => x.series[i].overviewRank || 0)); // 총평용 단계(공식 주의·경계 거르기 뒤) — AI 입력 시간 흐름에 쓴다
        const s = Date.parse(at), e = s + SLOT_H * HOUR;
        return { at, label: dayPrefix(at, win.targetDate) + pad(Number(at.slice(11, 13))) + '시', rank: best ? best.q.rank : 0, word: best ? WORD[best.q.rank] : unknown, overviewRank: oRankAt, overviewWord: oRankAt ? WORD[oRankAt] : unknown, region: best ? best.x.nm.name : null, labels: best ? best.q.sources.map((y) => y.label) : [], events: wev.events.filter((v) => Date.parse(v.at) >= s && Date.parse(v.at) < e).map((v) => ({ kind: v.kind, text: v.text })) };
    });
    const rank = regions.length ? regions[0].rank : 0, oRegions = regions.filter((x) => x.overviewRank > 0).sort((a, b) => b.overviewRank - a.overviewRank || b.oDuration - a.oDuration || b.accidents - a.accidents || a.nm.name.localeCompare(b.nm.name, 'ko'));
    const worstFlow = Object.values(flows).filter(Boolean).sort((a, b) => (a.onsetAt ? Date.parse(a.onsetAt) : Infinity) - (b.onsetAt ? Date.parse(b.onsetAt) : Infinity) || (b.max.wh - a.max.wh))[0] || null;
    const oRank = oRegions[0]?.overviewRank || 0;
    return {
        level: { rank, word: levelWord(rank, missing, 4), source: regions[0] ? regions[0].series[regions[0].first].sources[0].label : null, partial: missing.length > 0 },
        overviewLevel: { rank: oRank, word: levelWord(oRank, missing, 4) },
        // 총평 후보 3곳까지(2026-10-17 §11.10 — 근거 줄에 해역 3곳까지. 종전 2곳). 단계·거르기 규칙은 그대로.
        overviewTop: oRegions.slice(0, 3).map((x) => cards.find((c) => c.rid === x.r.rid) || toCard(x)),
        // overviewRegions = 총평 기준(공식 사고예보 단계만 있는 칸을 거른 뒤) 관심 이상 해역 수 — 총평 단계(overviewLevel)와 같은 기준(2026-10-16 2단계 검토 B1).
        //   attentionRegions(카드·시간 막대 기준)와 다르면 그 차이 = 공식 사고예보 단계만 있는 해역 수. 틀 총평·AI 입력은 overviewRegions 를 쓴다.
        reviewedCells: sea.reviewedCells || 0, attentionRegions: regions.length, overviewRegions: oRegions.length, cards, timeBar, weather: worstFlow, weatherByHaegu: flows, missing: [...new Set(missing)],
        missingSlots: accGaps.size ? { accident: [...accGaps].sort() } : {},
    };
}
/**
 * 총평용 근거 묶음 — 총평 단계 칸들에서 칸마다 가장 높은 근거 이름을 모아 근거별 시간대(이어진 묶음별)를 붙인다.
 * 예: 15·18시 공식 사고예보 '주의', 21시 예비특보 → "공식 사고예보 '주의'(15~21시)·제주도서부앞바다 풍랑주의보 예비특보(발효 예정 시각 이후)(21~24시)"
 * @param {object[]} run - 칸 판정 묶음 @param {string} targetDate @returns {string} [연계] ← seaSection(카드 overview.label) → AI 입력(stationInput) · 근거 줄(overviewLabelText)
 */
function runLabels(run, targetDate) { return runLabelList(run, targetDate).map((x) => x.label + '(' + x.window + ')').join('·'); }
/**
 * runLabels 의 묶음을 글로 잇지 않고 [{label, window}] 로 — 총평 근거 줄(seaSummary)이 근거가 하나이고 시간대가 해역 창과 같으면 시간대를 되풀이하지 않게.
 * 예: 15·18시 공식 사고예보 '주의' → [{label:"공식 사고예보 '주의'", kind:'accident', window:'15~21시'}]
 * @param {object[]} run @param {string} targetDate @returns {object[]} [연계] ← runLabels · seaSection(카드 overview.labels)
 */
function runLabelList(run, targetDate) {
    const by = new Map();
    // kind = 근거 종류(accident·congestion·weather·warning·afterRelease) — 총평 근거 줄이 예보에서 온 근거에 「예상」을 붙이는 데 쓴다(§11.10.1).
    for (const q of run) { const x = q.overviewSources[0]; if (!x?.label) continue; if (!by.has(x.label)) by.set(x.label, { kind: x.kind, ats: [] }); by.get(x.label).ats.push(q.at); }
    return [...by.entries()].slice(0, 3).map(([label, v]) => ({ label, kind: v.kind, window: runsText(v.ats, targetDate) }));
}
/** 구역 이름 열쇠(띄어쓰기·가운뎃점·점 무시) — warn_zone_cells.zoneKey 와 같은 규칙. @param {string} s @returns {string} [연계] ← seaSection */
function zoneKey(s) { return String(s || '').replace(/[\s·.]/g, ''); }

/**
 * 연안 관광지 하나의 「오늘 바뀐 요소」와 단계를 판정한다 — 2026-10-16 결정 2(구성안 §7 육상 표 그대로, 원문 *"공식 단어 … 써도 상관없을 것 같다 … 어차피 판단은 사람들이 하는거잖아"*).
 *   오늘 바뀐 요소 = 사람 평소보다 많음(사람 점수>0) · 그날 행사 · 너울 12초 이상 · 이안류 '주의' 이상 · 특보·예비특보 · 떠밀림 바람
 *   경계 필요: 풍랑·태풍·강풍 경보 발효 · 연안 위험지수 100('매우 높음')이면서 오늘 바뀐 요소 있음
 *   주의 필요: 주의보 발효 · 지수 '높음'(67+)이면서 오늘 바뀐 요소
 *   관심 필요: 지수 '다소 높음' 이상이면서 오늘 바뀐 요소 · 예비특보 · 떠밀림 문구 · 행사(평일 포함) · 특보 해제 뒤 3시간(결정 4 — released, 바뀐 요소로는 세지 않음)
 *   그 밖 = 「상시 위험 장소」(총평에 올리지 않음 — 10월 평소날에도 68%가 '다소 높음' 이상, 구성안 §5)
 *   출처 꼬리표 = 무엇 때문인지: 「풍랑주의보」·「연안 위험지수 72 '높음'」·(관심 단독 요소면 그 요소 글). 같은 단계면 특보 > 지수 > 단독 요소 순.
 * 특보 문구는 기상청 시각 그대로(결정 1): 「풍랑주의보 발효(10월 17일 06~09시 해제 예고, 14:00 발표)」·「강풍주의보 예비특보(18시 발효 예정)」 — notices.detail(연안 하루 안내의 issued·effective·release).
 * 예: {people:{ratio:1.8,score:0.8}, index:72, band:'높음', notices:{windMs:9}} → {rank:2, sourceLabel:"연안 위험지수 72 '높음'", changes:['사람 평소의 1.8배','해안 바람 9m/s(…)']}
 *     {index:40, band:'다소 높음', notices:{effective:['풍랑경보']}} → {rank:3, sourceLabel:'풍랑경보'} · {index:100, band:'매우 높음'}(바뀐 요소 없음) → {rank:0}
 * @param {object} s - 관광지 하루 값(coastDayDetail 에서 뽑은 것 + released) @param {string} [targetDate] - 시각 글자의 날짜 기준 @returns {object} {rank,word,sourceLabel,changes:[{kind,text}]}
 * [연계] ← landSection / → warnTimeText·issuedText
 */
function landSpot(s, targetDate) {
    const changes = [], eff = s.notices?.effective || [], pre = s.notices?.prelim || [], detail = s.notices?.detail || [];
    const td = targetDate || (s.peakAt ? s.peakAt.slice(0, 10) : '');
    const timeOf = (state, name) => detail.find((d) => d.state === state && d.name === name) || null;
    if (s.people && s.people.score > 0 && Number.isFinite(s.people.ratio)) changes.push({ kind: 'people', text: '사람 평소의 ' + s.people.ratio.toFixed(1) + '배', ratio: +s.people.ratio.toFixed(1) });
    if (s.event?.name) changes.push({ kind: 'event', text: '행사 「' + s.event.name + '」' });
    if (s.swell && s.swell.periodS >= 12) changes.push({ kind: 'swell', text: '너울(파주기 ' + s.swell.periodS + '초)' });
    if (s.rip && ['주의', '경계', '위험'].includes(s.rip.level)) changes.push({ kind: 'rip', text: "이안류 '" + s.rip.level + "'" });
    for (const w of eff) { const d = timeOf('발효', w), tail = [d && d.release ? warnTimeText(d.release, td) + ' 해제 예고' : null, d && d.issued ? warnTimeText(d.issued, td) + ' 발표' : null].filter(Boolean).join(', '); changes.push({ kind: 'warning', text: w + ' 발효' + (tail ? '(' + tail + ')' : ''), name: w }); }
    for (const w of pre) { const d = timeOf('예비', w), tail = [d && d.effective ? warnTimeText(d.effective, td) + ' 발효 예정' : null, d && d.issued ? warnTimeText(d.issued, td) + ' 발표' : null].filter(Boolean).join(', '); changes.push({ kind: 'prewarn', text: w + ' 예비특보' + (tail ? '(' + tail + ')' : ''), name: w }); }
    if (Number.isFinite(s.notices?.windMs)) changes.push({ kind: 'drift', text: '해안 바람 ' + s.notices.windMs + 'm/s(튜브·물놀이기구 떠밀림 주의)' });
    const changed = changes.length > 0;   // 「오늘 바뀐 요소」 — 해제 뒤(released)는 아래에서 더하며 세지 않는다
    for (const r of s.released || []) if (!eff.includes(r.name)) changes.push({ kind: 'released', text: r.name + ' 해제 뒤(' + warnTimeText({ start: r.at, range: false }, td) + ' 해제)' });
    const cands = [];
    for (const w of eff) cands.push({ rank: /경보/.test(w) ? 3 : 2, order: 0, label: w });
    const bandRank = { '다소 높음': 1, '높음': 2, '매우 높음': 3 }[s.band] || 0;
    if (changed && bandRank) cands.push({ rank: bandRank, order: 1, label: '연안 위험지수 ' + (Number.isFinite(s.index) ? s.index + ' ' : '') + "'" + s.band + "'" });
    const alone = changes.find((c) => ['prewarn', 'drift', 'event', 'released'].includes(c.kind));
    if (alone) cands.push({ rank: 1, order: 2, label: alone.text });
    cands.sort((a, b) => b.rank - a.rank || a.order - b.order);
    const top = cands[0] || null;
    return { rank: top ? top.rank : 0, word: top ? WORD[top.rank] : null, sourceLabel: top ? top.label : null, changes };
}
/**
 * 육상 분석: 관광지 카드(관심 이상 — 오늘 바뀐 요소·특보·해제 뒤) + 상시 위험 장소 목록(바뀐 요소 없음 + 관광지에 붙지 않은 위험구역).
 * 해상만 관할(전남 19곳·여수바다)은 null 이유와 함께. 해망처럼 관광지 0곳이면 위험구역만으로 상시 위험 장소(§11.6-8 Q8).
 * 예: 한림 고정 자료 → {level:{rank:1,…}, cards:[협재해수욕장…], constant:[{name:'한림항 방파제',…}]}
 * @param {object} input @param {object} win @returns {object|null} 육상 절 [연계] ← buildBriefing / → landSpot
 */
function landSection(input, win) {
    if (input.seaOnly) return null;
    const land = input.land || {}, spots = land.spots || [];
    const judged = spots.map((s) => ({ s, j: landSpot(s, win.targetDate) }));
    const cardsAll = judged.filter((x) => x.j.rank > 0).sort((a, b) => b.j.rank - a.j.rank || (b.s.index || 0) - (a.s.index || 0) || (b.s.history?.count || 0) - (a.s.history?.count || 0) || a.s.name.localeCompare(b.s.name, 'ko'));
    const traitText = (s) => [s.hazard?.count ? '위험구역 ' + s.hazard.count + '곳(' + (s.hazard.byType || []).filter((t) => t.count).map((t) => t.class + ' ' + t.count).join('·') + ')' : null, s.history?.count ? (s.history.from || '').slice(0, 4) + '~' + (s.history.to || '').slice(0, 4) + ' 연안사고 ' + s.history.count + '건(' + (s.history.topTypes || []).map((t) => t.type + ' ' + t.count).join('·') + ')' : null, s.beach ? '해수욕장' : null].filter(Boolean).join(' · ');
    const cards = cardsAll.slice(0, MAX_LAND_CARDS).map(({ s, j }) => ({
        id: s.id, name: s.name, rank: j.rank, word: j.word, sourceLabel: j.sourceLabel, index: s.index ?? null, band: s.band || null, peakAt: s.peakAt || null,
        traits: { hazard: s.hazard || null, history: s.history || null, beach: !!s.beach, text: traitText(s) || '기록된 위험구역·연안사고 없음' },
        // kinds = changes 와 같은 순서의 요소 종류(people·event·swell·rip·warning·prewarn·drift·released) — 총평 근거 줄이 여러 곳 공통 특보·바람을 한 번만 쓰는 데 쓴다(§11.10).
        today: { changes: j.changes.map((c) => c.text), kinds: j.changes.map((c) => c.kind), text: j.changes.map((c) => c.text).join(' · ') },
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
        // attentionSpots = 관심 이상 관광지 전체 수(카드는 단계 높은 순 MAX_LAND_CARDS 곳까지 — 화면이 「카드는 10곳까지」를 밝힌다, 2단계 검토 B5).
        // attentionByRank = 관심 이상 관광지 전체를 단계별로 센 것({1:관심,2:주의,3:경계}) — 총평 근거 「주의 3곳 · 관심 9곳」은 카드 상한과 상관없이 이 수(§11.10).
        reviewedHazards: (land.hazardOnly || []).length, attentionSpots: cardsAll.length, attentionByRank: { 1: cardsAll.filter((x) => x.j.rank === 1).length, 2: cardsAll.filter((x) => x.j.rank === 2).length, 3: cardsAll.filter((x) => x.j.rank === 3).length },
        cards, constant, overviewTop: cards.slice(0, 3), missing,
    };
}
/**
 * 조석(서해·남해·제주 관할 — §11.6-8·11, 제주는 2026-10-16 결정 5): 대표 위치에서 가장 가까운 앵커 곡선으로 그 판의 창에 걸친 밀물 시간과 문구를 만들고,
 * 화면이 해양종합정보 조석 게이지를 그릴 수 있게 곡선(10분)·고저조(prev/next 포함)를 그대로 넘긴다. 점수에는 넣지 않는다(U45).
 * 문구는 밀물(저조 → 다음 고조) 중심(결정 5, 원문 *"저조가 아니라 고조지 않니? 물이 오르는시간이니까. 나 는 반영하자"*):
 *   「06:12 저조 뒤부터 물이 차오릅니다(12:30 고조) · 18:40 저조 뒤부터 물이 차오릅니다(10월 18일 00:50 고조) — 갯벌·바위에 나가 있다면 물이 차오르기 전에 나오세요.」
 *   창(window)과 겹치는 밀물만 쓴다 — 창 앞 저조에서 이미 차오르는 중이면 그 저조도(날짜를 붙임). 23시 판은 전날 곡선(prevDayPeaks)의 밤 저조도 본다. 다음 날 첫 고조는 nextPeak.
 * 예: 저조 06:12·18:40, 고조 00:50·12:30, 다음 날 00:55 · 아침 판(06시~) → '06:12 저조 뒤부터 물이 차오릅니다(12:30 고조) · 18:40 저조 뒤부터 물이 차오릅니다(10월 18일 00:55 고조) — …'
 * @param {object|null} tide - 수집 결과 {anchorId,distKm,date,curve,peaks,prevPeak,prevDayPeaks,nextPeak,rocks,region} @param {object} win @returns {object|null}
 * [연계] ← buildBriefing
 */
function tideSection(tide, win) {
    if (!tide || !Array.isArray(tide.peaks)) return null;
    const from = Date.parse(win.from), to = Date.parse(win.to), day = (n) => kstDate(Date.parse(tide.date + 'T00:00:00+09:00') + n * 24 * HOUR);
    const all = (tide.prevDayPeaks || []).map((p) => ({ ...p, date: day(-1) })).concat(tide.peaks.map((p) => ({ ...p, date: tide.date })), tide.nextPeak ? [{ ...tide.nextPeak, date: day(1) }] : [])
        .map((p) => ({ ...p, ms: Date.parse(p.date + 'T' + p.t + ':00+09:00') })).filter((p) => Number.isFinite(p.ms)).sort((a, b) => a.ms - b.ms);
    const word = (p) => dayPrefix(p.date + 'T', win.targetDate) + p.t;
    const flood = [];
    all.forEach((p, i) => {
        if (p.type !== 'low') return;
        const h = all.slice(i + 1).find((q) => q.type === 'high') || null, endMs = h ? h.ms : p.ms;
        if (p.ms < to && endMs >= from && !(p.ms < from && !h)) flood.push(word(p) + ' 저조 뒤부터 물이 차오릅니다' + (h ? '(' + word(h) + ' 고조)' : ''));
    });
    const text = [];
    if (flood.length) text.push(flood.join(' · ') + ' — 갯벌·바위에 나가 있다면 물이 차오르기 전에 나오세요.');
    const r = tide.rocks;
    if (r && r.count) text.push('관할 안 잠기는 바위(간출암) ' + r.count + '곳이 ' + (r.first === r.last ? r.first : r.first + '~' + r.last) + ' 사이 물에 잠깁니다 — 바위 위 낚시·채취 중 고립에 주의가 필요합니다.');
    return { anchor: { id: tide.anchorId, distKm: tide.distKm }, region: tide.region || null, date: tide.date, gauge: { curve: tide.curve || [], peaks: tide.peaks, prevPeak: tide.prevPeak || null, nextPeak: tide.nextPeak || null, unit: 'cm' }, rocks: r || null, text };
}

// 「총평과 권고」 서버 결론 — 2026-10-17 사용자 결정(설계서 §11.10, 원문 *"오늘 한림파출소 관할 연안의 단계는 "주의 필요" 입니다. (줄바꿈) (근거)가 나오도록하고 싶고 … 처음보는 사람 입장에서 근거가 이해가 안되지 않겠어?"* → *"위 추천대로 결정."*).
// 결론 한 줄(headline) · 근거 목록(basis) · 권고 한 줄(advice) · 물때(tide, 육상만)를 서버가 서버 값만으로 만든다. AI 는 그 아래 짧은 해설(1~2문장)만 쓴다(station_briefing_ai).
// 종전 틀 총평 문단(templateOverview — 3~5문장 한 덩어리)은 없앴다: 결론 줄이 없고 「관심 이상」 같은 용어·지수가 장소와 따로 놀고 같은 이유가 장소마다 되풀이됐다.
const RANK_SHORT = ['', '관심', '주의', '경계'];
// 여러 장소에 같은 글로 붙는 요소(특보·예비특보·해제 뒤·해안 바람) — 근거 목록에서 장소마다 되풀이하지 않고 한 줄로 모은다.
const SHARED_KINDS = new Set(['warning', 'prewarn', 'released', 'drift']);
// 「예상」 표기(2026-10-17 사용자 후속 결정 §11.10.1, 원문 *"방문객이나 등은 예상정보이잖아? 그러면 예상 이라고 명시하는게 좋겠는데."*).
// 근거가 예보·예측 자료에서 왔으면 「예상」을 붙이고, 실제(발효 중 특보·관측·정해진 행사)는 붙이지 않는다. 분류 근거(코드로 확인):
//   people  = 관광지 사람 집중률 **예측**(한국관광공사) → 예상 · drift = 해안 바람 = 해구 **예보** 풍속(risk_score notices.windMs ← ws) → 예상
//   swell   = 너울 = 기상청 KIM 모델 3시간 **예보**(swell_smallzone) → 예상 · 연안 위험지수 = 위 예측·예보로 계산 → 예상
//   rip     = 이안류 = 국립해양조사원 최신 **관측** 지수(scheduler ripcurrent_index lastScrCn·obsrvnDt, 오늘만) → 예상 아님
//   event   = 정해진 행사 → 아님 · warning = 발효 중 특보 → 아님 · prewarn = 예비특보(글에 이미 「발효 예정」) → 덧붙이지 않음 · released = 해제 기록·해제 예고 → 아님
// 해상 근거: accident(공식 사고예보)·congestion(혼잡 예보)·weather(해구 예보 파고·풍속) → 예상 · warning(발효·예비)·afterRelease → 아님.
const EXPECT_SEA_KINDS = new Set(['accident', 'congestion', 'weather']);
/**
 * 육상 바뀐 요소 글에 「예상」을 붙인다(근거 줄 전용 — 카드 글은 그대로). 예: ('people','사람 평소의 1.8배') → '방문객 평소의 1.8배(예상)'
 *   ('drift','해안 바람 9m/s(튜브·물놀이기구 떠밀림 주의)') → '해안 바람 9m/s(예상, 튜브·물놀이기구 떠밀림 주의)' · ('swell','너울(파주기 12초)') → '너울(파주기 12초, 예상)' · ('warning', …) → 그대로
 * @param {string} kind @param {string} text @returns {string} [연계] ← landSummary
 */
function expectText(kind, text) {
    if (kind === 'people') return String(text).replace(/^사람/, '방문객') + '(예상)';
    if (kind === 'drift') return String(text).replace('m/s(', 'm/s(예상, ');
    if (kind === 'swell') return String(text).replace(/\)$/, ', 예상)');
    return text;
}
/**
 * 육상 「총평과 권고」. 근거 첫 줄의 수는 관심 이상 관광지 **전체**(attentionSpots·attentionByRank — 카드 상한 10곳이 아니다, 2026-10-17 버그 수정).
 * 예: 한림(관심 이상 12곳) → {headline:'오늘 한림파출소 관할 연안의 단계는 "주의 필요"입니다.',
 *       basis:['관할 관광지 30곳 중 평소보다 위험이 높아진 곳 12곳 (주의 3곳 · 관심 9곳)', '금능석물원 — 연안 위험지수 92(높음, 예상), 방문객 평소의 2.2배(예상)', '월령포구 — 방문객 평소의 1.8배(예상)',
 *              '풍랑주의보 예비특보(10월 18일 00~06시 발효 예정, 04:00 발표) — 금능석물원·월령포구 공통'],
 *       advice:'금능석물원·월령포구·한림공원 주변 물가 접근에 주의가 필요합니다.'}  (물때는 §11.10.1 부터 공용 summary.tide)
 *     관심 이상 없음 → basis ['관할 관광지 4곳 — 평소와 달라진 요소(…)가 확인되지 않았습니다', '상시 위험 장소: …'], advice '물가 접근 시 평소처럼 관심이 필요합니다.'
 * @param {object} b - buildBriefing 의 중간 결과 @param {string} dayWord - 오늘|내일 @returns {object|null} 해상만 관할이면 null
 * [연계] ← buildSummary / 화면: station_briefing_render.js 「총평과 권고」 / AI 허용 숫자: station_briefing_ai.stationInput(summaryLines)
 */
function landSummary(b, dayWord) {
    const land = b.land; if (!land) return null;
    const lt = land.overviewTop || [], miss = land.missing.length ? sourceNames(land.missing) : null, basis = [];
    const headline = dayWord + ' ' + b.station.name + ' 관할 연안의 단계는 "' + land.level.word + '"입니다.';
    if (lt.length) {
        const by = land.attentionByRank || {}, parts = [3, 2, 1].filter((r) => by[r] > 0).map((r) => RANK_SHORT[r] + ' ' + by[r] + '곳');
        basis.push('관할 관광지 ' + land.reviewedSpots + '곳 중 평소보다 위험이 높아진 곳 ' + land.attentionSpots + '곳' + (parts.length ? ' (' + parts.join(' · ') + ')' : ''));
        // 공통 요소: 상위 장소 두 곳 이상에 같은 글로 붙은 특보·예비특보·해제 뒤·해안 바람.
        const who = new Map(), kindOf = new Map();
        for (const c of lt) {
            const kinds = c.today.kinds || [];
            (c.today.changes || []).forEach((t, i) => { if (!kindOf.has(t)) kindOf.set(t, kinds[i]); });
            [...new Set((c.today.changes || []).filter((t, i) => SHARED_KINDS.has(kinds[i])))].forEach((t) => who.set(t, (who.get(t) || []).concat(c.name)));
        }
        const shared = [...who.entries()].filter(([, names]) => names.length >= 2), sharedSet = new Set(shared.map(([t]) => t));
        const ex = (t) => expectText(kindOf.get(t), t);
        for (const c of lt) {
            // 단계 출처가 연안 위험지수면 그 장소 줄에 지수를 붙인다(종전엔 첫 문장에 따로 있어 어느 장소 값인지 알 수 없었다). 지수는 예측·예보로 계산 → 「예상」(§11.10.1).
            const idx = /^연안 위험지수/.test(c.sourceLabel || '') ? '연안 위험지수' + (Number.isFinite(c.index) ? ' ' + c.index : '') + '(' + (c.band ? c.band + ', ' : '') + '예상)' : null;
            const own = [idx].concat((c.today.changes || []).filter((t) => !sharedSet.has(t)).map(ex)).filter(Boolean);
            basis.push(c.name + ' — ' + (own.length ? own.join(', ') : '아래 공통 요소'));
        }
        for (const [t, names] of shared) basis.push(ex(t) + ' — ' + names.join('·') + ' 공통');
    } else {
        basis.push('관할 관광지 ' + land.reviewedSpots + '곳 — ' + (miss ? '확인된 자료에서는 ' : '') + '평소와 달라진 요소(사람·행사·너울·이안류·특보·바람)가 확인되지 않았습니다');
        const c = land.constant.slice(0, 3).map((x) => x.name);
        basis.push(c.length ? '상시 위험 장소: ' + c.join('·') + (land.constant.length > 3 ? ' 등' : '') : '관할에 연결된 관광지·위험구역 자료가 없습니다');
    }
    if (miss) basis.push('확인하지 못한 자료: ' + miss);
    const advice = lt.length ? lt.map((c) => c.name).join('·') + ' 주변 물가 접근에 ' + SUBJECT[lt[0].rank] + ' 필요합니다.' : '물가 접근 시 평소처럼 관심이 필요합니다.';
    return { headline, basis, advice };
}
/**
 * 해역 총평 근거 꼬리 — 근거가 하나이고 그 시간대가 해역 창과 같으면 시간대를 되풀이하지 않는다. 예보에서 온 근거(EXPECT_SEA_KINDS)에는 「예상」(§11.10.1).
 * 예: {window:'06~24시', labels:[{label:"공식 사고예보 '경계'",kind:'accident',window:'06~24시'}]} → "공식 사고예보 '경계'(예상)"
 *     두 근거 → "공식 사고예보 '주의'(15~21시 예상)·제주도서부앞바다 풍랑주의보 예비특보(발효 예정 시각 이후)(21~24시)" · labels 없는 옛 카드 → overview.label 그대로
 * @param {object} ov - 카드 overview @returns {string} [연계] ← seaSummary
 */
function overviewLabelText(ov) {
    const l = ov.labels;
    if (!Array.isArray(l) || !l.length) return ov.label;
    const ex = (x) => EXPECT_SEA_KINDS.has(x.kind);
    if (l.length === 1 && l[0].window === ov.window) return l[0].label + (ex(l[0]) ? '(예상)' : '');
    return l.map((x) => x.label + '(' + x.window + (ex(x) ? ' 예상' : '') + ')').join('·');
}
/**
 * 해상 「총평과 권고」. 근거 = 검토 칸·위험이 높아진 해역 수(총평 기준 overviewRegions) · 공식 사고예보 단계만 있는 해역 수 · 해구 예보 흐름 · 해역 3곳까지 · 해제 예고/예비특보 한 번 · 확인하지 못한 자료.
 * 예: → {headline:'오늘 한림파출소 관할 해상의 단계는 "경계 필요"입니다.', basis:['관할 해역 52칸 검토 — 평소보다 위험이 높아진 해역 2개', '대해구 232 예보는 15시부터 …',
 *       "06~24시 한림매일시장 북방 0.6해리 해역(232-2해구) — 공식 사고예보 '경계'", '제주도북부앞바다 풍랑주의보 — 06~09시 해제 예고(…)'], advice:'06~24시경 한림매일시장 북방 0.6해리 해역(232-2해구) 운항에 경계가 필요합니다.'}
 * @param {object} b @param {string} dayWord @returns {object} [연계] ← buildSummary
 */
function seaSummary(b, dayWord) {
    const sea = b.sea, top = sea.overviewTop || [], miss = sea.missing.length ? sourceNames(sea.missing) : null, basis = [];
    const oCount = Number.isFinite(sea.overviewRegions) ? sea.overviewRegions : sea.attentionRegions, accOnly = Math.max(0, sea.attentionRegions - oCount);
    const headline = dayWord + ' ' + b.station.name + ' 관할 해상의 단계는 "' + sea.overviewLevel.word + '"입니다.';
    basis.push('관할 해역 ' + sea.reviewedCells + '칸 검토 — ' + (miss ? '확인된 자료 기준 ' : '') + '평소보다 위험이 높아진 해역 ' + oCount + '개');
    if (accOnly > 0) basis.push('공식 사고예보 단계만 있는 해역 ' + accOnly + '개는 기상·혼잡 근거가 겹치지 않아 총평에 넣지 않았습니다');
    if (sea.weather) basis.push(sea.weather.text);
    else if (!sea.missing.includes('zoneForecasts')) basis.push('해구 예보 자료를 확인하지 못했습니다');
    for (const c of top) basis.push(c.overview.window + ' ' + c.name + ' — ' + overviewLabelText(c.overview));
    const rel = b.special.find((x) => x.kind === 'release' || x.kind === 'released'), pre = b.special.find((x) => x.kind === 'prewarn');
    for (const x of [rel, pre]) if (x) basis.push(x.title);
    if (miss) basis.push('확인하지 못한 자료: ' + miss + ' — 그 근거는 판단에서 뺐습니다');
    const advice = top[0] ? top[0].overview.window + '경 ' + top[0].name + ' 운항에 ' + SUBJECT[top[0].overview.rank] + ' 필요합니다.' : miss ? '출항 전 기상청 특보·예보를 직접 확인하는 데 관심이 필요합니다.' : '출항 전 기상 확인에 관심이 필요합니다.';
    return { headline, basis, advice };
}
// ── (기상) 칸 — 2026-10-17 사용자 후속 결정(§11.10.1, 원문 *"결론 한줄 -> 기상(해당 파출소가 위치한 곳에서 가장 가까운 특보구역 … 오늘의 기상예보를 오전, 오후로 제공(오후 브리핑에서는 오후, 내일 오전만 나오면되고, 23시 브리핑에서는 내일 오전 오후 정보를 제공.) 또한 제주지방기상청 단기전망을 보면 … 참고할만한 특이 기상정보가 있다면 가져와서 함께 정리해서 알려주는게 좋겠어. 너무 길게 말고 그냥 어떤 특이사항 있는지.(해당일의 정보에 대해서만) / 물때 / …"*) ──
const PERIOD_WORD = { am: '오전', pm: '오후' };
const MAX_NOTES = 3;   // 특이사항 줄 수 상한 — 사용자 *"너무 길게 말고"*
/**
 * 판(창)에 맞는 오전·오후 두 칸을 고른다. 08:00 판 = 대상일 오전·오후 · 17:30 판 = 오늘 오후·내일 오전 · 23:00 판 = 내일(대상일) 오전·오후.
 * 특보 변경 판·관리자 실행은 창 시작이 대상일 낮 12시 이후면 17:30 판처럼, 아니면 08:00 판처럼.
 * 예: editionWindow('evening', 10-17 17:30) → [{date:'20261017',period:'pm'},{date:'20261018',period:'am'}]
 * @param {object} win - editionWindow @returns {object[]} [{date:'YYYYMMDD', period:'am'|'pm'}] [연계] ← weatherSummary
 */
function weatherSlotsFor(win) {
    const t = win.targetDate, ymd = (d) => d.replace(/-/g, ''), next = kstDate(Date.parse(t + 'T00:00:00+09:00') + 36 * HOUR);
    const afternoon = win.from.slice(0, 10) === t && Number(win.from.slice(11, 13)) >= 12;
    return afternoon ? [{ date: ymd(t), period: 'pm' }, { date: ymd(next), period: 'am' }] : [{ date: ymd(t), period: 'am' }, { date: ymd(t), period: 'pm' }];
}
/** 「오늘/내일/10월 19일」 — 만든 날짜 기준. 예: ('20261018', '2026-10-17T23:00…') → '내일'. @param {string} ymd8 @param {string} genIso @returns {string} [연계] ← weatherSummary */
function dayLabel(ymd8, genIso) {
    const d = ymd8.slice(0, 4) + '-' + ymd8.slice(4, 6) + '-' + ymd8.slice(6, 8), g = (genIso || '').slice(0, 10);
    if (!g) return md(d);
    return d === g ? '오늘' : d === kstDate(Date.parse(g + 'T00:00:00+09:00') + 36 * HOUR) ? '내일' : md(d);
}
/**
 * 단기 해상예보 한 칸을 한 줄로(인덱스 「○○앞바다 기상예보」 표와 같은 값 — regional_forecast_collector 의 PDF 칸 {weather, waveHeight, wind:'동~남동 / 7~11'}).
 * 예: {weather:'구름많음', waveHeight:'0.5~1.5', wind:'동~남동 / 7~11'} → '구름많음 · 파고 0.5~1.5m · 풍속 7~11m/s · 풍향 동→남동'
 * @param {object} p @returns {string} [연계] ← weatherSummary
 */
function periodText(p) {
    const has = (v) => v && v !== '-', w = has(p.wind) ? String(p.wind).split('/').map((x) => x.trim()) : [];
    return [has(p.weather) ? String(p.weather).replace(/\s+/g, ' ').trim() : null, has(p.waveHeight) ? '파고 ' + p.waveHeight + 'm' : null, has(w[1]) ? '풍속 ' + w[1] + 'm/s' : null, has(w[0]) ? '풍향 ' + w[0].replace(/~/g, '→') : null].filter(Boolean).join(' · ') || '자료 없음';
}
/** 통보문 마크업({{loc:…}}·{{num:…}}·{{warn:…}} — regional_bulletin_collector 의 AI 색칠)을 벗긴다. 예: '{{loc:제주도}}에는' → '제주도에는'. @param {string} t @returns {string} [연계] ← bulletinNotes */
function stripMarkup(t) { return String(t || '').replace(/\{\{(?:loc|num|warn):([^}]*)\}\}/g, '$1'); }
/** 긴 지역 나열을 줄인다(쉼표 경계에서 자르고 「 등」). 예: 45자 넘는 'A, B, C …' → 'A, B 등'. @param {string} s @param {number} [max] @returns {string} [연계] ← bulletinNotes */
function shortList(s, max = 40) { s = String(s).trim(); if (s.length <= max) return s; const i = s.lastIndexOf(',', max); return (i > 0 ? s.slice(0, i) : s.slice(0, max)) + ' 등'; }
// 통보문의 날짜 표지 — 「오늘(17일)」·「내일(18일)」 꼴, 날짜 없는 「오늘/내일/모레/글피」, 「18일」 꼴.
const DAY_RE = /(오늘|내일|모레|글피)\((\d{1,2})일\)|(오늘|내일|모레|글피)(?![(가-힣])|(?<![\d~])(\d{1,2})일(?![\d가-힣])/g;
const REL_DAY = { 오늘: 0, 내일: 1, 모레: 2, 글피: 3 };
// 표지 바로 뒤 때 말(「이른 새벽(00~03시)」·「밤(18~24시)」)과 부터/까지.
const TOD_RE = /^\s*((?:이른 |늦은 )?(?:새벽|아침|오전|낮|오후|저녁|밤)(?:\(\d{2}(?:~\d{2})?시\))?)?\s*(부터|까지)?/;
/**
 * 한 줄을 날짜 표지마다 토막낸다 — 표지가 「과·와··」로만 이어지면(「내일(18일)과 모레(19일)」) 한 토막이 두 날을 다 가진다.
 * 예: '오늘(17일) 밤부터 A, 내일(18일) 새벽부터 B에 …' → [{days:[17],head:'오늘(17일)',text:' 밤부터 A, ',rest:'내일(18일) …'},{days:[18],head:'내일(18일)',text:' 새벽부터 B에 …',rest:''}]
 * @param {string} line @param {number} issuedMs - 발표일 0시(ms, 날짜 없는 「오늘/내일」을 날짜로 바꿀 때) @returns {object[]} {days, head, text(표지 뒤~다음 토막 앞), rest(그 뒤 전부)} [연계] ← bulletinNotes
 */
function daySegments(line, issuedMs) {
    const marks = [];
    for (const m of line.matchAll(DAY_RE)) {
        let day;
        if (m[2]) day = Number(m[2]); else if (m[3]) day = Number(kstDate(issuedMs + REL_DAY[m[3]] * 24 * HOUR).slice(8, 10)); else day = Number(m[4]);
        marks.push({ i: m.index, end: m.index + m[0].length, day, rel: m[1] || m[3] || null });
    }
    const segs = [];
    for (let k = 0; k < marks.length; k++) {
        const days = [marks[k].day]; let j = k;
        while (j + 1 < marks.length && /^\s*[과와·]\s*$/.test(line.slice(marks[j].end, marks[j + 1].i))) { j++; days.push(marks[j].day); }
        const stop = j + 1 < marks.length ? marks[j + 1].i : line.length;
        segs.push({ days, head: line.slice(marks[k].i, marks[j].end), text: line.slice(marks[j].end, stop), rest: line.slice(stop) });
        k = j;
    }
    return segs;
}
/**
 * 지방기상청 단기 전망 통보문에서 브리핑 대상일의 특이사항만 짧게 뽑는다(결정론 — AI 없음, 이유는 설계서 §11.10.1).
 *   <예비특보 현황> 「○ 풍랑 예비특보(17일 밤(18~24시)): 구역」 → 「풍랑 예비특보: 오늘 밤(18~24시) 구역」(날짜가 대상일일 때만)
 *   <강풍 및 해상> (강풍) 대상일 토막 → 「오늘 오후부터 순간풍속 15m/s 안팎의 강한 바람」 · (해상) 대상일 토막 → 「오늘 밤부터 구역 물결 1.5~3.0m로 높아짐」
 *     (구역 뒤 풀이말이 다음 날 토막에 함께 있으면 — 「오늘 밤부터 A, 내일 새벽부터 B에 … 물결이 1.5~3.0m」 — 그 풀이말의 수치를 쓴다)
 *   <강수 및 유의 사항> 대상일 토막의 비·강한 비(시간당)·천둥번개·짙은 안개
 *   순서: 강풍 → 풍랑 예비특보 → 해상 → 그 밖 예비특보 → 강수·유의, 같은 글은 한 번, 최대 MAX_NOTES(3)줄. 다른 날 정보·그 밖 섹션(<유의 사항> 등 타 지역 안내)은 넣지 않는다.
 * 예: 10-17 제주 통보문 · 대상 10-17 · '오늘' → ['오늘 오후부터 순간풍속 15m/s 안팎의 강한 바람', '풍랑 예비특보: 오늘 밤(18~24시) 제주도남쪽바깥먼바다', '오늘 밤부터 제주도남쪽바깥먼바다 물결 1.5~3.0m로 높아짐']
 * @param {string} text - 통보문 본문(마크업 있어도 됨) @param {string} issuedDate - 발표일 YYYY-MM-DD @param {string} targetDate @param {string} dayWord - 대상일의 오늘/내일
 * @returns {string[]} [연계] ← weatherSummary / 시험: test_station_briefing.js(사용자가 붙여 준 10-17 제주 통보문 고정 자료)
 */
function bulletinNotes(text, issuedDate, targetDate, dayWord) {
    const issuedMs = Date.parse(issuedDate + 'T00:00:00+09:00'), tDay = Number(targetDate.slice(8, 10));
    const off = Math.round((Date.parse(targetDate + 'T00:00:00+09:00') - issuedMs) / (24 * HOUR));
    if (!Number.isFinite(off) || off < 0 || off > 3) return [];
    const when = (seg) => { const m = seg.text.match(TOD_RE) || []; return [dayWord, m[1] || null].filter(Boolean).join(' ') + (m[2] || ''); };
    const pick = { gale: [], waveWarn: [], sea: [], otherWarn: [], rain: [] };
    let section = '', tag = '';
    for (const raw of stripMarkup(text).split(/\r?\n/)) {
        const line = raw.replace(/\s+/g, ' ').trim(); if (!line) continue;
        const sec = line.match(/^<([^>]+)>$/); if (sec) { section = sec[1].replace(/\s+/g, ''); tag = ''; continue; }
        if (/^o /.test(line)) continue;                                   // 행동 요령 글머리(o …) — 넣지 않는다
        const t = line.match(/^○\s*\(([^)]+)\)/); if (t) tag = t[1]; else if (/^○/.test(line)) tag = '';
        if (section === '예비특보현황') {
            const m = line.match(/^○\s*(\S+)\s*예비특보\((\d{1,2})일\s*([^:]*?)\)\s*:\s*(.+)$/);
            if (m && Number(m[2]) === tDay) (m[1] === '풍랑' ? pick.waveWarn : pick.otherWarn).push(m[1] + ' 예비특보: ' + [dayWord, m[3].trim()].filter(Boolean).join(' ') + ' ' + shortList(m[4]));
            continue;
        }
        const body = line.replace(/^○\s*(\([^)]+\))?\s*/, '').replace(/^-\s*(?:한편|또한)?,?\s*/, '');
        for (const seg of daySegments(body, issuedMs).filter((x) => x.days.includes(tDay))) {
            const all = seg.text + seg.rest, w = when(seg);
            if (section === '강풍및해상' && tag === '강풍') {
                const g = all.match(/순간풍속\s*\d+km\/h\((\d+)m\/s\)/);
                if (g) pick.gale.push(w + ' 순간풍속 ' + g[1] + 'm/s' + (/안팎/.test(all.slice(g.index, g.index + 40)) ? ' 안팎' : '') + '의 ' + (/매우 강하게/.test(all) ? '매우 강한' : '강한') + ' 바람');
            } else if (section === '강풍및해상' && tag === '해상') {
                const zones = shortList(seg.text.replace(TOD_RE, '').split(/에(?:는|도)?\s/)[0].replace(/[,\s]+$/, ''));
                const wave = all.match(/물결[이가]?\s*(?:최대\s*)?(\d+(?:\.\d+)?~\d+(?:\.\d+)?)m/), wind = all.match(/\((\d+~\d+)m\/s\)/);
                const what = wave ? '물결 ' + wave[1] + 'm로 높아짐' : wind ? '바람 ' + wind[1] + 'm/s로 강해짐' : /천둥/.test(seg.text) ? '돌풍과 천둥·번개' : null;
                if (what && zones) pick.sea.push(w + ' ' + zones + ' ' + what);
            } else if (section === '강수및유의사항') {
                const hr = seg.text.match(/시간당\s*(\d+~\d+mm)/);
                const what = hr ? '시간당 ' + hr[1] + ' 강한 비' : /짙은 안개/.test(seg.text) ? '짙은 안개' : /천둥/.test(seg.text) ? '돌풍과 천둥·번개' : tag === '강수' && /비/.test(seg.text) ? '비' : null;
                if (what) pick.rain.push(w + ' ' + what);
            }
        }
    }
    return [...new Set([].concat(pick.gale.slice(0, 1), pick.waveWarn, pick.sea, pick.otherWarn, pick.rain))].slice(0, MAX_NOTES);
}
/**
 * (기상) 칸 — 파출소 위치에서 가장 가까운 앞바다(특보구역)의 지방기상청 단기 해상예보 오전·오후 두 칸 + 그 지방청 단기 전망의 대상일 특이사항.
 * 자료가 없으면 지어내지 않고 missing·bulletinMissing 으로 밝힌다(화면 「기상예보 자료를 확인하지 못했습니다」).
 * 예: weatherSummary(b, {zone:'제주도서부앞바다', distKm:0.5, office:'184', coastal:{officeName:'제주지방기상청',publishTime:'10.17. 05:00',periods:[…]}, bulletin:{officeName,publishTime:'2026.10.17 04:40',text}}, win)
 *     → {zone:'제주도서부앞바다', rows:[{label:'오늘 오전',text:'구름많음 · 파고 0.5~1.5m · …'},{label:'오늘 오후',…}], source:'제주지방기상청 단기 해상예보 (10.17 05:00 발표)', notes:[…], notesSource:'제주지방기상청 단기 전망 (10.17 04:40 발표)', missing:false, bulletinMissing:false}
 * @param {object} b @param {object|null} wx - station_briefing_inputs.collectZoneWeather 결과 @param {object} win @returns {object}
 * [연계] ← buildSummary / → weatherSlotsFor·periodText·bulletinNotes
 */
function weatherSummary(b, wx, win) {
    const out = { zone: wx?.zone || null, distKm: wx?.distKm ?? null, rows: [], source: null, notes: [], notesSource: null, missing: true, bulletinMissing: true };
    const periods = wx?.coastal?.periods || [];
    if (wx?.coastal && periods.length) {
        out.rows = weatherSlotsFor(win).map((s) => { const p = periods.find((q) => q.date === s.date && q.period === s.period); return { label: dayLabel(s.date, b.generatedAt) + ' ' + PERIOD_WORD[s.period], text: p ? periodText(p) : '자료 없음', ok: !!p }; });
        out.missing = !out.rows.some((r) => r.ok);
        out.source = (wx.coastal.officeName || '지방기상청') + ' 단기 해상예보' + (wx.coastal.publishTime ? ' (' + String(wx.coastal.publishTime).replace(/(\d{2}\.\d{2})\.\s*/, '$1 ') + ' 발표)' : '');
    }
    const bt = wx?.bulletin, iss = bt && String(bt.publishTime || '').match(/^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}:\d{2})/);
    if (bt && bt.text && iss) {
        const issued = iss[1] + '-' + iss[2] + '-' + iss[3], off = (Date.parse(win.targetDate) - Date.parse(issued)) / (24 * HOUR);
        if (off >= 0 && off <= 2) { out.bulletinMissing = false; out.notes = bulletinNotes(bt.text, issued, win.targetDate, dayWordOf(b)); out.notesSource = (bt.officeName || '지방기상청') + ' 단기 전망 (' + iss[2] + '.' + iss[3] + ' ' + iss[4] + ' 발표)'; }
    }
    return out;
}
/**
 * 브리핑의 「총평과 권고」 서버 결론 묶음. 예: buildSummary(b, wx, win) → {weather:{zone,rows,source,notes,…}|null, tide:[…], land:{headline,basis,advice}|null, sea:{headline,basis,advice}}
 *   순서(§11.10.1): 결론(육상·해상) → (기상) → (물때) → 육상 근거·권고 → 해상 근거·권고 → AI 해설. wx·win 이 없으면(옛 브리핑 다시 계산) weather 는 null.
 * @param {object} b - buildBriefing 중간 결과(station·sea·land·special·tide·generatedAt·targetDate) @param {object} [wx] - 관할 기상 입력 @param {object} [win] - editionWindow
 * @returns {object} [연계] ← buildBriefing · station_briefing_ai.stationInput(옛 브리핑에 summary 가 없을 때)
 */
function buildSummary(b, wx, win) { const dw = dayWordOf(b); return { weather: win ? weatherSummary(b, wx, win) : null, tide: b.tide ? b.tide.text.slice() : [], land: landSummary(b, dw), sea: seaSummary(b, dw) }; }
/**
 * summary 의 글을 한 줄씩 모은다(AI 허용 숫자·사실 문장). 결론·근거·권고·물때만 — (기상) 칸의 예보·통보문 숫자는 넣지 않는다(해설 검증 규칙 그대로 — 기상청 글의 숫자는 종전처럼 해설에 못 옮김).
 * 예: summaryLines({tide:['t'],sea:{headline:'…',basis:['a'],advice:'b'}}) → ['…','a','b','t'] @param {object} s @returns {string[]} [연계] ← station_briefing_ai.stationInput
 */
function summaryLines(s) { return [s && s.land, s && s.sea].filter(Boolean).flatMap((x) => [x.headline, ...(x.basis || []), x.advice, ...(x.tide || [])]).concat((s && s.tide) || []).filter(Boolean); }
/**
 * 관할 하나의 브리핑 요소 전체를 만든다. 「총평과 권고」의 결론·근거·권고(summary)는 서버가 만들고, AI 해설(overview.land·sea)은 비워 둔다 —
 * AI 가 성공하면 station_briefing.run 이 해설을 채운다(실패·틀 방식이면 해설 없음, source 'template').
 * 예: buildBriefing(한림 입력, editionWindow('morning',…), {generatedAt}) → {schema,key,station,sea,land,special,tide,summary:{land,sea},overview:{land:null,sea:null,source:'template'},…}
 * @param {object} input - 관할 입력 묶음(station_briefing_inputs.gather 또는 시험 고정 자료) @param {object} win - editionWindow @param {object} meta - {generatedAt}
 * @returns {object} 브리핑(저장·API 응답 본문)
 * [연계] ← station_briefing.run / → seaSection·landSection·tideSection·warningEvents·buildSummary
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
    b.summary = buildSummary(b, input.zoneWeather || null, win);
    b.overview = { land: null, sea: null, source: 'template', model: null };
    return b;
}
/** 총평의 「오늘/내일」 — 대상 날짜가 만든 날짜보다 뒤면 내일. 예: 23시 판(대상 다음 날) → '내일'. @param {object} b @returns {string} [연계] ← buildSummary·station_briefing_ai.stationInput */
function dayWordOf(b) { return b.generatedAt && b.targetDate > b.generatedAt.slice(0, 10) ? '내일' : '오늘'; }
/** 안정된 JSON(열쇠 정렬). 예: {b:1,a:2} → '{"a":2,"b":1}'. @param {any} v @returns {string} [연계] ← hash */
function stable(v) { return Array.isArray(v) ? '[' + v.map(stable).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}' : JSON.stringify(v === undefined ? null : v); }
/** 입력 해시(sha256 앞 16자). 예: hash({a:1}) === hash({a:1}). @param {any} v @returns {string} [연계] ← station_briefing_ai(같은 입력이면 지난 총평 재사용) */
function hash(v) { return crypto.createHash('sha256').update(stable(v)).digest('hex').slice(0, 16); }

module.exports = {
    RULES_VERSION, WORD, SEA_ONLY_OFFICES, RELEASE_LINES, WAVE_M, WIND_MS, EDITIONS, SOURCE_LABEL, UNKNOWN_SOME, UNKNOWN_ALL, AFTER_RELEASE_SEA_H, AFTER_RELEASE_LAND_H,
    isoKst, kstDate, md, editionWindow, runsText, levelWord, sourceNames, dueEdition, displayDate, rangeText, warnTimeText, issuedText, warnAtSlot, slotOf, regionName, weatherFlow,
    warningEvents, seaSection, landSpot, landSection, tideSection, buildSummary, summaryLines, weatherSlotsFor, bulletinNotes, weatherSummary, periodText, stripMarkup, expectText, buildBriefing, stable, hash, zoneKey, topicJosa, haversineKm, dayWordOf,
};
