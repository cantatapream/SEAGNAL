/**
 * ============================================================================
 * 파일명: local_server/services/station_briefing_rules.js
 * 역할  : 「연안 안전 브리핑」(종전 이름 「활동지점 안전 브리핑」 — 파출소 관할 단위)의 판단 규칙 — 관할 하나의 입력 묶음(가짜 자료로도 만들 수 있는 평범한 객체)을 받아
 *         단계 말(관심·주의·경계 — §11.10.16 부터 「필요」 없음)·해역 카드·육상 카드·특별 상황(특보 해제 예고 등)·해상 시간 막대·조석 문구·「총평과 권고」 결론·근거·권고·(기상: 가장 가까운 앞바다 단기 해상예보·단기 전망 특이사항)·(물때)(summary)
 *         · 규칙 분석 문단(summary.analysis — AI 분석이 실패했을 때 보이는 3~5문장, 2026-10-17 §11.10.4)·판 일정(만들기 시작·공개 시각 — EDITIONS)을 만든다.
 *         파일·네트워크·시계를 건드리지 않는 순수 함수만 둔다(같은 입력 → 같은 출력). AI 는 이 결과를 받아 연안·해상 분석 문단(각 3~5문장)만 쓴다(설계서 §11.10.4).
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

const RULES_VERSION = 'station-briefing-rules-v17'; // v17(2026-10-17 사용자 결정 — 설계서 §11.10.16): 단계 말 「필요」 뺌(WORD 「관심·주의·경계」 — 결론 「단계는 "주의"입니다」·카드 딱지·근거 표·시간 막대·규칙 분석 「주의 수준」) · [권고]·(권고)·규칙 분석 마지막 「따라서」 문장 끝 「요구됩니다」 · (물때) 간출암 줄 「…물에 잠깁니다. 바위 위 …」(「—」 뺌) · 해상 규칙 분석 「다만,」 · (같은 v17 — 설계서 §11.10.15 「2026-10-17 사용자 확정(시안 ④판)」) 해역 카드 배지: 특보 등급 말 뺌(「21~24시 풍랑주의보(기상청)」 — [권고] 근거도) · 해구 예보 배지 = 넘은 축의 바다 상태 말(「파고 '높음'·풍속 '매우 강함'」, 숫자·「기준」 없음) · 상세 detail = 표 {title, head, rows}(「KOMSA 해양사고 위험예보」 시각|등급 · 「KOMSA 혼잡 예보」 시각|혼잡지수 · 「기상청 {구역} {특보}」 시각|상태 · 「232해구 예보」 시각|파고|풍속) · 배지 순서 = 글자 색(rank) 순 · v16(2026-10-17 사용자 결정 — 설계서 §11.10.15): 해역 카드 출처별 배지 badges(「18~24시 해양사고 위험예보 '주의'(KOMSA)」·「18~21시 혼잡 예보 '매우높음'(KOMSA)」·「21~24시 풍랑주의보 '주의'(기상청)」 + 상세 줄 detail — seaBadges) · [권고] 근거 = 배지 꼴 · v15(2026-10-17 사용자 결정 — 설계서 §11.10.13): 해역 카드 [특성] → [사고현황('21~'25년)](유형 전부 「충돌 5건, 전복 2건」 | 「인명피해 사망 N명, 실종 M명」 — traits.label·accidents·casualty·text, 특보구역·해구는 뺌) · 「… 사고가 많이 기록되었습니다」(historyNote) · [오늘 예상] → [기상 예보](tags 와 같은 줄을 빼고 특보 줄 + 바다 상태 흐름 문장 today.forecast — weatherFlow.stateText, 「기준」 없음) · 그 밖의 근거(today.otherLines) · [권고](advice) · v14(2026-10-17 사용자 결정 — 설계서 §11.10.12): 해양사고 위험예보만 위험 단계인 해역 근거 줄을 단계별로 「해양사고 위험예보(KOMSA) 기준 등급 '주의'인 해역 N칸」(풀이 줄 ACC_ONLY_NOTE 뺌) · summary.sea.accidentOnly(단계별 수 — 화면 배지 「N개 해역 주의 필요(KOMSA 예보)」) · AI 입력 문구 「해양사고 위험예보(KOMSA 기준)만 '주의'인 해역」(komsaPhrase) · v13(2026-10-17 사용자 결정 — 설계서 §11.10.10): (물때) 「관할 내 잠기는 바위(간출암) N곳」(「관할 안」이 「안 잠기는」으로 읽힘) + 그 바위 목록(tide.rocks.items·summary.rocks — 지도·위험지형 팝업 재료) · (고립 주의) 「과거 고립 사고(N개소 M건)으로 확인 및 주의가 필요합니다.」 · 지점 표 「지점명 | 발생 현황」(연도별 「22년(1건), 23년(2건)」) · v12(2026-10-17 사용자 결정 — 설계서 §11.10.9): 연안 근거 「평소보다 위험이 높아진 곳 N곳」 표(summary.land.raised — 관심 이상 관광지 전부 · 평소 → 오늘(예상) · 이유, land.attentionAll) · 해상 규칙 분석의 해구 문장 = 특보구역 이름(「경북북부앞바다(대해구 75)」 — weatherFlow.where) + 최대값 + 바다 상태 말(SEA_STATE 표 — 「잔잔한 바다일 것으로 예상됩니다」 등, 「기준」이라는 말 없음 — haeguSentence) · v11(2026-10-17 §11.10.5 독립 검토 8): 해상 규칙 분석 문단 — 결론 「평소 수준」이면 마지막 문장 「… 변화에 평소처럼 관심이 필요합니다」(연안과 같은 꼴) · v10(2026-10-17 사용자 결정 — 설계서 §11.10.4): 규칙 분석 문단(summary.analysis — 연안·해상 각 3~5문장, AI 분석이 실패하면 화면이 「규칙 분석」 이름표로 보인다) · 판 일정 = 만들기 시작 07:10·17:10·22:40 → 공개 07:30·17:30·23:00(publishAtFor) · v9(2026-10-17 사용자 결정 — 설계서 §11.10.3): (물때) 아래 「(고립 주의) 저조 시간 전후 사고 지점(N개소)」(관할 관광지 중 2020~2024 고립 사고 지점 표) · 「물이 차오르기 전에 나오세요」 뺌 · 육상 공통 줄의 「— A·B 공통」 뺌 · 육상 권고 「… 주변 연안사고에 …가 필요합니다」 · 해상 근거 「관할 해역 N칸 중 위험이 높아진 해역 M칸」(칸 = 해역 묶음)·「해양사고 위험예보만 '주의·경계'인 해역 K칸」+풀이 · 해구 예보 줄은 기준을 넘을 때만 · 근거 줄 지도 펼침 재료(summary.sea.area·detail) · 「공식 사고예보」 → 「해양사고 위험예보」 · 해상 권고에서 「경」·해구 꼬리 뺌 · v8(2026-10-17 §11.10.1 독립 검토 1~5·12 — 설계서 §11.10.2): 단기 전망 특이사항 방향(높아짐·낮아짐)은 원문대로·구역은 「에서는·에서·에는·에도·에」 앞까지·지역·「곳에 따라」·「…가능성」 단서·「뽑지 못함」(notesFound)·가장 가까운 구역 줄 먼저·같은 구역 예비특보+해상 한 줄·「18일부터」 표지·앞바다 30km 넘으면 먼바다 예보 또는 거리 안내 · v7(2026-10-17 사용자 후속 결정 §11.10.1): 총평에 (기상)(가장 가까운 앞바다 단기 해상예보 오전·오후 + 지방기상청 단기 전망 특이사항)·(물때) 공용 칸 · 예보에서 온 근거에 「예상」 · v6(2026-10-17 사용자 결정 §11.10): 총평을 서버가 만드는 결론·근거·권고(summary)로 — 틀 총평 문단(templateOverview) 폐지 · 육상 「관심 이상인 곳」 수를 카드 상한(10) 대신 전체 수로 · 해상 총평 후보 3곳 · SOURCE_LABEL 에 너울(swell) · v5(2026-10-16 2단계 화면 독립 검토 B1·B12): 틀 총평 「관심 이상 N개 해역」을 총평 기준 수로(공식 사고예보 단계만 있는 해역은 따로 셈) · 경계 카드 문장의 「공식」을 출처별로 · v2(2026-10-16): 독립 검토 반영 — 결측 「확인 불가」·창 겹침·끊긴 시간대·총평 후보 상한 분리 등 · v3(같은 날 사용자 결정 1·2·4·5): 특보 기상청 시각 그대로·육상 지수 단계·해제 뒤 관심 1/3시간·밀물 조석 문구 · v4(같은 날 *"모두 추천대로."*): 공식 사고예보 「경계」도 「주의」처럼 기상·혼잡이 겹칠 때만 총평
const HOUR = 3600000, SLOT_H = 3;
// 단계 말 — 사용자 확정(§11.6-8 Q1 「가」): 「관심 필요·주의 필요·경계 필요」. 해상의 주의·경계는 공식 자료(공식 사고예보·기상특보)가 그 단계일 때만.
// → 2026-10-17 「필요」를 뺀 「관심·주의·경계」(설계서 §11.10.16 — 사용자 *"경계 필요, 주의 필요 이렇게 하지말고 경계 1, 주의 5, 관심 1 처럼 표출"* · *"전체적으로 필요라는 텍스트는 빼도 될 것 같은데"*).
//   카드 딱지·결론 문장(「단계는 "경계"입니다」)·근거 표·규칙 분석 문단(「주의 수준이며」)이 모두 이 표에서 나온다. 「평소 수준」은 그대로.
// 육상은 2026-10-16 결정 2(*"공식 단어 … 써도 상관없을 것 같다 … 어차피 판단은 사람들이 하는거잖아"*)로 연안 위험지수 단계도 주의·경계를 붙인다(landSpot).
const WORD = ['', '관심', '주의', '경계'];
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
    // accident 이름 — 2026-10-17 사용자 결정(§11.10.3): 브리핑 안에서는 「해양사고 위험예보」(종전 「공식 사고예보」 — 무엇인지 알 수 없다는 지적). 다른 화면 이름은 그대로.
    accident: '해양사고 위험예보', congestion: '혼잡 예보', zoneForecasts: '해구 예보', warnings: '기상특보',
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
// 판 일정(KST) — 만들기 시작(h:m) → 공개(ph:pm). 2026-10-17 사용자 결정(설계서 §11.10.4):
//   *"07:30분용 브리핑이면 07:10분에는 만들기 시작하여 준비해놓았다가 07:30에 표출될 수 있도록 해야해 다른 시간대도 마찬가지야."* ·
//   *"07:10분에 만들기 시작, 보이는 시각 08:00시 오후는 그대로, 밤은 그대로."* → 같은 날 *"아침 보이는 시각은 07시 30분으로 변경함."*
//   = 아침 07:10 → 07:30 · 저녁 17:10 → 17:30 · 밤 22:40 → 23:00(모두 공개 20분 전 시작 — AI 데드라인 20분과 같은 길이).
//   종전(§11.6-10·13) 08:00 · 17:30 · 23:00 에 만들기 시작해 끝나면 바로 보였다.
const EDITIONS = Object.freeze([{ kind: 'morning', h: 7, m: 10, ph: 7, pm: 30 }, { kind: 'evening', h: 17, m: 10, ph: 17, pm: 30 }, { kind: 'night', h: 22, m: 40, ph: 23, pm: 0 }]);
/**
 * 정시 판의 공개 시각(KST ISO)을 정한다 — 그 판을 만들기 시작한 날의 공개 시각. 자정 뒤(정오 전)에 늦게 만든 밤 판은 전날 23:00(이미 지남 → 곧바로 보임).
 * 예: ('morning', 10-17 07:10) → '2026-10-17T07:30:00+09:00' · ('night', 10-17 22:40) → '2026-10-17T23:00:00+09:00' · ('night', 10-18 01:10) → '2026-10-17T23:00:00+09:00' · ('warning', …) → null
 * @param {string} kind - morning|evening|night @param {number} now - ms(만들기 시작 시각) @returns {string|null}
 * [연계] ← station_briefing.run(공개 전에는 pending 에 둔다 — 그동안 화면은 이전 판) · 시험
 */
function publishAtFor(kind, now) {
    const e = EDITIONS.find((x) => x.kind === kind); if (!e) return null;
    const midnight = Date.parse(kstDate(now) + 'T00:00:00+09:00');
    const day = kind === 'night' && now - midnight < 12 * HOUR ? kstDate(midnight - HOUR) : kstDate(now);
    return day + 'T' + pad(e.ph) + ':' + pad(e.pm) + ':00+09:00';
}
/**
 * 지금 다음에 오는 정시 판 공개 시각(07:30·17:30·23:00 — EDITIONS ph:pm) — 화면 머리 「(다음 브리핑 갱신 23:00 또는 특보 변경 시)」(2026-10-17 사용자 결정 §11.10.9 ⑦).
 * 예: 10-17 17:40 → '2026-10-17T23:00:00+09:00' · 23:00 정각 → '2026-10-18T07:30:00+09:00'(지난 것 말고 그다음) · 06:00 → 같은 날 07:30
 * @param {number} now - ms @returns {string} KST ISO [연계] ← routes/station_briefing(GET /api/station-briefing·관리자 preview 의 nextPublishAt)
 */
function nextPublishAt(now) {
    for (const d of [kstDate(now), kstDate(now + 24 * HOUR)]) for (const e of EDITIONS) { const iso = d + 'T' + pad(e.ph) + ':' + pad(e.pm) + ':00+09:00'; if (Date.parse(iso) > now) return iso; }
    return null;
}
/**
 * 지금 만들기 시작해야 할 정시 판을 고른다 — 오늘 시작 시각이 지난 판 중 가장 늦은 것이 아직 없으면 그것 하나(시작 시각 = EDITIONS h:m, 공개는 publishAtFor).
 * 서버가 그 시각에 꺼져 있었으면 다음 판 시작 시각 전까지 늦게라도 만든다(같은 판을 두 번 만들지 않게 done 열쇠로 막는다).
 * 예: 07:10 → {kind:'morning',key:'2026-10-17|morning'} · 07:09 → 어제 night 가 done 이면 null · 17:09(아침 판 있음) → null · 17:10 → evening · 22:40 → night
 * @param {number} now - ms @param {Set<string>|string[]} done - 만든 판 열쇠 @returns {object|null}
 * [연계] ← station_briefing.tick(1분) / 시험: 가짜 시계
 */
function dueEdition(now, done) {
    const has = done instanceof Set ? (k) => done.has(k) : (k) => (done || []).includes(k);
    const p = isoKst(now), date = p.slice(0, 10), minutes = Number(p.slice(11, 13)) * 60 + Number(p.slice(14, 16));
    let pick = null;
    for (const e of EDITIONS) if (minutes >= e.h * 60 + e.m) pick = e;
    if (!pick) { // 자정~07:10 — 어제 밤 판이 없으면 그것(서버가 22:40~23시에 꺼져 있었던 경우)
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
 *   경계: 공식 사고예보 '경계' · 풍랑·태풍 경보 발효(예비 경보는 발효 예정 시각부터 — U21)
 *   주의: 공식 사고예보 '주의' · 주의보 발효(같은 예비 규칙)
 *   관심: 충돌·접촉 주의(혼잡 예보 '높음' 이상) · 특보 없이 해구 예보 파고 2m 또는 풍속 12m/s 이상 · 특보 해제 뒤 1시간(결정 4 — 그 1시간이 걸친 칸)
 * 자료 상태가 ok 가 아닌 원천은 쓰지 않는다(「확인 불가」 — 지어내지 않는다).
 * 「총평용 단계」(overviewRank): 공식 사고예보 '주의'·'경계'는 공단 자체 단계라, 같은 칸에 기상(특보·파고·풍속) 또는 혼잡 근거가 겹칠 때만 총평에 올린다
 *   (§11.6-17① 「주의」 + 2026-10-16 *"모두 추천대로."* 로 「경계」도 — §11.8 결정 3). 거른 칸도 해역 카드·시간 막대(rank)에는 그대로 남는다.
 * 예: {accident:'주의', congestion:{level:'높음',index:12.3}, wh:1.0, ws:6} → {rank:2, overviewRank:2, sources:[…]} · 사고예보 '주의'만 → {rank:2, overviewRank:0} · '경계'만 → {rank:3, overviewRank:0}
 * @param {object} cell - {accident,congestion,wh,ws,warnings:[w…]} @param {number} s @param {number} e @param {object} ok - 원천별 사용 가능 여부
 * @returns {object} {rank,overviewRank,sources:[{kind,rank,label}],overviewSources(총평에 쓸 수 있는 근거만),weatherBasis,congestionBasis}
 *   근거마다 배지 재료(§11.10.15 — seaBadges): accident grade · congestion cong({level,index,at}) · weather wx({wh,ws}) · warning·afterRelease warn(warnOf)
 * [연계] ← seaSection / → warnAtSlot
 */
function slotOf(cell, s, e, ok) {
    const sources = [];
    let warnActive = false;
    if (ok.warnings) for (const w of cell.warnings || []) {
        const st = warnAtSlot(w, s, e);
        if (st.active) { warnActive = true; sources.push({ kind: 'warning', rank: st.rank, label: w.zone + ' ' + w.type + w.level + (st.prewarn ? ' 예비특보(발효 예정 시각 이후)' : ''), warn: warnOf(w, st.prewarn ? '예비특보' : '발효 중') }); }
        else if (st.after) sources.push({ kind: 'afterRelease', rank: 1, label: w.zone + ' ' + w.type + w.level + ' 해제 뒤' + (w.state === '해제' && w.release ? '(' + w.release.start.slice(11, 16) + ' 해제)' : ''), warn: warnOf(w, '해제 뒤') });
    }
    if (ok.accident && ACCIDENT_RANK[cell.accident]) sources.push({ kind: 'accident', rank: ACCIDENT_RANK[cell.accident], label: "해양사고 위험예보 '" + cell.accident + "'", grade: cell.accident });
    const congestionBasis = !!(ok.congestion && cell.congestion && CONGESTION_HIGH.has(cell.congestion.level));
    if (congestionBasis) sources.push({ kind: 'congestion', rank: 1, label: "혼잡 예보 '" + cell.congestion.level + "'(" + (cell.congestion.at ? Number(cell.congestion.at.slice(11, 13)) + '시 ' : '') + '혼잡지수 ' + cell.congestion.index + ') → 충돌·접촉 주의', cong: cell.congestion });
    const wx = ok.zoneForecasts && ((Number.isFinite(cell.wh) && cell.wh >= WAVE_M) || (Number.isFinite(cell.ws) && cell.ws >= WIND_MS));
    if (wx && !warnActive) sources.push({ kind: 'weather', rank: 1, label: '해구 예보 ' + [cell.wh >= WAVE_M ? '파고 ' + cell.wh + 'm' : null, cell.ws >= WIND_MS ? '풍속 ' + cell.ws + 'm/s' : null].filter(Boolean).join('·'), wx: { wh: cell.wh, ws: cell.ws } });
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
 * stateText(§11.10.13) = 해역 카드 [기상 예보]의 바다 상태 흐름 문장(seaStateFlow — 「기준」이라는 말 없음). text 는 종전 그대로(AI 사실 목록·옛 화면).
 * [연계] ← seaSection(해역 카드 [기상 예보]·총평 근거)
 */
function weatherFlow(series, label, targetDate) {
    const rows = (series || []).filter((r) => Number.isFinite(r.wh) || Number.isFinite(r.ws));
    if (!rows.length) return null;
    const over = (r) => r.wh >= WAVE_M || r.ws >= WIND_MS, txt = (r) => [Number.isFinite(r.wh) ? '파고 ' + r.wh + 'm' : null, Number.isFinite(r.ws) ? '풍속 ' + r.ws + 'm/s' : null].filter(Boolean).join('·');
    const hh = (r) => dayPrefix(r.at, targetDate) + Number(r.at.slice(11, 13)) + '시';
    const i = rows.findIndex(over);
    const max = rows.reduce((m, r) => ({ wh: Math.max(m.wh, r.wh ?? -1), ws: Math.max(m.ws, r.ws ?? -1) }), { wh: -1, ws: -1 });
    const stateText = seaStateFlow(rows, label, targetDate);
    if (i < 0) return { label, onsetAt: null, endAt: null, max, stateText, text: label + ' 예보는 최대 ' + txt({ wh: max.wh >= 0 ? max.wh : null, ws: max.ws >= 0 ? max.ws : null }) + '로 기준(파고 2m·풍속 12m/s) 미만입니다' };
    const j = rows.findIndex((r, k) => k > i && !over(r));
    const head = i === 0 ? '창 시작(' + hh(rows[0]) + ')부터 ' : hh(rows[i]) + '부터 ';
    const before = i > 0 ? '(' + hh(rows[i - 1]) + ' ' + txt(rows[i - 1]) + ')' : '';
    const tail = j > 0 ? ', ' + hh(rows[j]) + '부터 기준 아래로 내려갑니다' : '';
    // onsetText·downText = 총평 해상 근거 줄(seaSummary — 기준을 넘을 때만 「대해구 232 예보 15시부터 …로 높아짐(예상)」, §11.10.3)이 쓰는 토막
    return { label, onsetAt: rows[i].at, endAt: j > 0 ? rows[j].at : null, max, stateText, text: label + ' 예보는 ' + head + txt(rows[i]) + '로 높아집니다' + before + tail, onsetText: head + txt(rows[i]), downText: j > 0 ? hh(rows[j]) + '부터' : null };
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
/** 원천 결측을 반영한 단계 말. 예: (0, []) → '평소 수준' · (0, ['congestion']) → '확인 불가(일부)' · (2, […]) → '주의'. @param {number} rank @param {string[]} missing @param {number} total - 원천 수 @returns {string} [연계] ← seaSection·landSection */
function levelWord(rank, missing, total) { return rank ? WORD[rank] : !missing.length ? '평소 수준' : total && missing.length >= total ? UNKNOWN_ALL : UNKNOWN_SOME; }
/**
 * 해역 카드 [사고현황('21~'25년)] 줄(2026-10-17 사용자 결정 — 설계서 §11.10.13). 원문 *"특성이라고 표현하기보다 [사고현황('21~'25년)] 충돌 5건, 전복 2건, 좌초 1건 | 인명피해 사망 0명, 실종 0명 이렇게"*.
 * 유형은 전부(종전 topTypes 상위 3개가 아니라 marine_fusion.cellHistory 의 types 전체 — 많은 순, 같으면 이름 순). 연도는 자료 기간(history.from·to — marine_fusion 「자료 마지막 해 −4 ~ 마지막 해」).
 * 사망·실종 = 그 칸 사고들의 사망·실종 인원 합(marine_fusion.summary — 원자료 r[10]·r[11]).
 * types 가 없는 입력(시험 고정 자료·옛 수집)은 topTypes 를 쓰고, 합이 건수보다 적으면 「외 N건」을 붙인다(지어내지 않는다).
 * 예: ({from:'2021-01-01',to:'2025-12-31',count:9,types:{충돌:5,전복:2,좌초:1,침수:1},death:0,missing:0}, true)
 *     → {label:"사고현황('21~'25년)", accidents:'충돌 5건, 전복 2건, 좌초 1건, 침수 1건', casualty:'인명피해 사망 0명, 실종 0명', text:'충돌 5건, … | 인명피해 사망 0명, 실종 0명', types:[{type:'충돌',count:5},…]}
 *     0건 → text '선박사고 기록 없음' · 자료 없음(hasHist false) → label '사고현황', text '선박사고 이력 자료 없음(집계 불가)'
 * @param {object|null} h - region.history @param {boolean} hasHist - 집계할 수 있는 자료인가 @returns {object} {label, accidents, casualty, text, types}
 * [연계] ← seaSection(toCard — traits·historyNote) · station_briefing_ai.stationInput(해역 evidence — 사망·실종이 둘 다 0 이면 인명피해 토막을 보내지 않는다)
 */
function seaHistoryRow(h, hasHist) {
    if (!hasHist) return { label: '사고현황', accidents: null, casualty: null, text: '선박사고 이력 자료 없음(집계 불가)', types: [] };
    const yy = (d) => "'" + String(d).slice(2, 4), label = h.from && h.to ? '사고현황(' + yy(h.from) + '~' + yy(h.to) + '년)' : '사고현황(최근 5년)';
    if (!h.count) return { label, accidents: null, casualty: null, text: '선박사고 기록 없음', types: [] };
    const types = h.types && typeof h.types === 'object' ? Object.entries(h.types).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type, 'ko')) : (h.topTypes || []).slice();
    const rest = h.count - types.reduce((n, t) => n + t.count, 0);
    const accidents = types.map((t) => t.type + ' ' + t.count + '건').concat(rest > 0 ? ['외 ' + rest + '건'] : []).join(', ');
    const casualty = '인명피해 사망 ' + (h.death || 0) + '명, 실종 ' + (h.missing || 0) + '명';
    return { label, accidents, casualty, text: accidents + ' | ' + casualty, types };
}
// ── 해역 카드 출처별 배지(2026-10-17 사용자 결정 — 설계서 §11.10.15) ──
// 원문 *"KOMSA 단독인 경우에는 이미지 1 딱지는 그대로 유지. 이미지 2는 ##~##시 해양사고 위험예보 '주의'(KOMSA) 라고 표출하고, 색상은 주의 수준의 색상으로 반영(텍스트)"*
//   · *"혼합인 경우 … 그 아래 뱃지는 ##~##시 해양사고 위험예보 '주의'(KOMSA) 와 ##~##시 혼잡 예보 "매우 높음" 이라고 붙이되 그 아래 상세사항으로 혼잡예보와 해양사고 위험예보 정보를 넣어주면"*
//   · *"혼잡예보도 매우 높음에 해당되는 색상이 노란색이니 ? 뭔가 빨간색으로 반영되어야 할 것 같은데"*.
// 혼잡 예보 등급 → 색 단계 = 위험예측 지도와 같은 대응(client/js/marine-life/risk-forecast/risk_marine.js CONG: 높음 = 주의 색 · 매우높음 = 경계 색). 카드 단계(관심)와 별개로 배지 글자 색만.
const CONG_COLOR_RANK = { '높음': 2, '매우높음': 3 };
// 배지 등급 말 — 해양사고 위험예보는 원문 등급 그대로('주의'·'경계'). 기상특보는 2026-10-17 시안 ④판 사용자 확정으로 등급 말을 붙이지 않는다(「21~24시 풍랑주의보(기상청)」 — 설계서 §11.10.15 소절).
/** 특보 한 건의 배지 재료(slotOf 근거에 붙임). 예: ({zone:'Z',type:'풍랑',level:'주의보'}, '발효 중') → {id:'Z|풍랑주의보', name:'풍랑주의보', zone:'Z', state:'발효 중'}. @param {object} w @param {string} state @returns {object} [연계] ← slotOf / → seaBadges */
function warnOf(w, state) { return { id: w.zone + '|' + w.type + w.level, name: w.type + w.level, zone: w.zone, state }; }
/** 근거 하나가 어느 배지 묶음인지. 예: {kind:'afterRelease',warn:{id:'Z|풍랑주의보'}} → 'warning|Z|풍랑주의보' · {kind:'weather'} → 'zoneForecast'. @param {object} s - slotOf 근거 @returns {string} [연계] ← seaBadges·seaSection(toCard — [권고] 근거) */
function badgeKey(s) { return s.kind === 'accident' || s.kind === 'congestion' ? s.kind : s.kind === 'weather' ? 'zoneForecast' : 'warning|' + (s.warn ? s.warn.id : s.label); }
/** 값 하나를 바다 상태 말 칸으로(SEA_STATE — 사용자 확정 표). 예: (2.6, SEA_STATE.wave) → '높음' · (14, SEA_STATE.wind) → '매우 강함' · 값 없음 → null. @param {number} v @param {object[]} tbl @returns {string|null} [연계] ← seaBadges(해구 예보 배지·표 칸) */
function seaWord(v, tbl) { return Number.isFinite(v) ? tbl.find((c) => v < c.lt).word : null; }
/**
 * 해역 카드의 출처별 배지 — 그 해역 칸들(판 창 안)에서 단계를 올린 출처마다 하나(설계서 §11.10.15).
 * 글 = 「{창} {예보 이름} '{그 예보 자체의 등급}'({기관})」. 창 = 그 출처가 그 배지 등급인 칸들(runsText — 끊긴 시간대는 「06~09시·21~24시」).
 *   해양사고 위험예보: 등급 = 창 안 가장 높은 등급(주의·경계), 색 = 그 등급(주의 2·경계 3), 상세 표 「시각 | 등급」.
 *   혼잡 예보: 등급 = 가장 높은 혼잡 등급(높음·매우높음), 색 = CONG_COLOR_RANK(지도와 같은 대응), 상세 표 「시각 | 혼잡지수」(그 칸에서 가장 높은 시각의 값).
 *   기상특보(특보 한 건마다): 등급 말 없음(2026-10-17 시안 ④판 사용자 확정 *"1-붙이지마"* — 「21~24시 풍랑주의보(기상청)」), 색 = 앱 단계(주의보 2·경보 3),
 *     예비특보만이면 이름에 「예비특보」, 해제 뒤 1시간만이면 「해제 뒤」, 상세 표 「시각 | 상태」(발효 중·예비특보·해제 뒤), 표 제목에 특보구역.
 *   해구 예보(파고 2m·풍속 12m/s 이상 칸): 기준을 넘은 축만 그 칸들 최대값의 바다 상태 말(SEA_STATE — 「해구 예보 파고 '높음'·풍속 '매우 강함'」, 숫자·「기준」 없음 — 같은 날 사용자 확정
 *     *"기준이라는 것을 넣지 않도록 하지 않았니 ?"*), 색 = 관심(1), 상세 = 제목 zoneTitle(「232해구 예보」 — 서버 글) + 표 「시각 | 파고 | 풍속」(칸 「2.4m (높음)」·「13m/s (강함)」).
 * 순서 = 글자 색 단계(rank) 높은 것 먼저(빨강 → 주황 → 노랑), 같으면 해양사고 위험예보 → 혼잡 → 기상(2026-10-17 시안 ④판 사용자 확정 「나. 글자 색 순」 — 종전 「카드 단계를 올린 정도(contrib) 순」).
 * 상세는 배지 글보다 더 알려 줄 것이 있을 때만: 배지가 하나뿐이고 칸마다 등급(상태)이 같으면 뺀다(사용자 확정 「가. 되풀이면 빼기」), 혼잡·해구 예보는 값이 있어 늘 넣는다.
 * detail = [{title, head:[…], rows:[[칸…]]}] — 칸은 글 또는 {text, rank}(등급 칸 — 그 등급 색). 규칙 v16 판은 detail 이 글 줄([string])이었다(화면이 둘 다 그린다).
 * 예: 18·21시 '주의' 단독 → [{source:'accident', text:"18~24시 해양사고 위험예보 '주의'(KOMSA)", rank:2, detail:[]}]
 *     18시 '주의'·21시 '경계' + 18시 혼잡 '매우높음'(45.14) → [{text:"21~24시 해양사고 위험예보 '경계'(KOMSA)", detail:[{title:'KOMSA 해양사고 위험예보', head:['시각','등급'], rows:[['18시',{text:"'주의'",rank:2}],['21시',{text:"'경계'",rank:3}]]}]}, {text:"18~21시 혼잡 예보 '매우높음'(KOMSA)", rank:3, …}]
 * @param {object[]} series - 해역 칸 판정(seaSection — [{at, sources}]) @param {string} targetDate @param {string} zoneTitle - 해구 예보 상세 제목(「232해구 예보」)
 * @returns {object[]} [{source:'accident'|'congestion'|'weather', sub, key, name, level, agency, window, rank(글자 색 단계), contrib, text, basis, detail:[]}]
 * [연계] ← seaSection(toCard — card.badges · [권고] 근거 basis) / → runsText·dayPrefix·seaWord · 화면 station_briefing_render.js seaBadges
 */
function seaBadges(series, targetDate, zoneTitle) {
    const hh = (iso) => dayPrefix(iso, targetDate) + Number(iso.slice(11, 13)) + '시', groups = new Map();
    for (const q of series) for (const s of q.sources) {
        const key = badgeKey(s); if (!groups.has(key)) groups.set(key, { key, kind: s.kind, hits: [] });
        const g = groups.get(key), prev = g.hits.find((h) => h.at === q.at);   // 같은 칸에 같은 특보가 두 줄이면(발효·해제 기록) 높은 쪽 하나
        if (!prev) g.hits.push({ at: q.at, s }); else if (s.rank > prev.s.rank) prev.s = s;
    }
    const out = [];
    for (const g of groups.values()) {
        const hits = g.hits;
        if (g.kind === 'accident') {
            const top = Math.max(...hits.map((h) => ACCIDENT_RANK[h.s.grade])), ats = hits.filter((h) => ACCIDENT_RANK[h.s.grade] === top).map((h) => h.at), level = hits.find((h) => ACCIDENT_RANK[h.s.grade] === top).s.grade;
            out.push({ source: 'accident', sub: 'accident', key: g.key, name: SOURCE_LABEL.accident, level, agency: 'KOMSA', ats, rank: top, contrib: top, same: hits.every((h) => h.s.grade === level),
                detail: [{ title: 'KOMSA ' + SOURCE_LABEL.accident, head: ['시각', '등급'], rows: hits.map((h) => [hh(h.at), { text: "'" + h.s.grade + "'", rank: ACCIDENT_RANK[h.s.grade] }]) }] });
        } else if (g.kind === 'congestion') {
            const cr = (h) => CONG_COLOR_RANK[h.s.cong.level] || 0, top = Math.max(...hits.map(cr)), ats = hits.filter((h) => cr(h) === top).map((h) => h.at);
            out.push({ source: 'congestion', sub: 'congestion', key: g.key, name: SOURCE_LABEL.congestion, level: hits.find((h) => cr(h) === top).s.cong.level, agency: 'KOMSA', ats, rank: top, contrib: 1, same: false,
                detail: [{ title: 'KOMSA ' + SOURCE_LABEL.congestion, head: ['시각', '혼잡지수'], rows: hits.map((h) => [hh(h.s.cong.at || h.at), String(h.s.cong.index)]) }] });
        } else if (g.kind === 'weather') {
            const mx = (k, lim) => { const v = hits.map((h) => h.s.wx[k]).filter((x) => Number.isFinite(x) && x >= lim); return v.length ? Math.max(...v) : null; }, mwh = mx('wh', WAVE_M), mws = mx('ws', WIND_MS);
            const words = [mwh !== null ? "파고 '" + seaWord(mwh, SEA_STATE.wave) + "'" : null, mws !== null ? "풍속 '" + seaWord(mws, SEA_STATE.wind) + "'" : null].filter(Boolean).join('·');
            const cell = (v, unit, tbl) => Number.isFinite(v) ? v + unit + ' (' + seaWord(v, tbl) + ')' : '—';
            out.push({ source: 'weather', sub: 'zoneForecast', key: g.key, name: SOURCE_LABEL.zoneForecasts + ' ' + words, level: null, agency: '기상청', ats: hits.map((h) => h.at), rank: 1, contrib: 1, same: false,
                detail: [{ title: zoneTitle || SOURCE_LABEL.zoneForecasts, head: ['시각', '파고', '풍속'], rows: hits.map((h) => [hh(h.at), cell(h.s.wx.wh, 'm', SEA_STATE.wave), cell(h.s.wx.ws, 'm/s', SEA_STATE.wind)]) }] });
        } else {
            const top = Math.max(...hits.map((h) => h.s.rank)), at = hits.filter((h) => h.s.rank === top), wv = at[0].s.warn || { name: at[0].s.label, zone: '' };
            const name = wv.name + (top === 1 ? ' 해제 뒤' : at.every((h) => h.s.warn && h.s.warn.state === '예비특보') ? ' 예비특보' : '');
            out.push({ source: 'weather', sub: 'warning', key: g.key, name, level: null, agency: '기상청', ats: at.map((h) => h.at), rank: top, contrib: top, same: hits.every((h) => h.s.rank === top && h.s.warn && h.s.warn.state === wv.state),
                detail: [{ title: '기상청 ' + (wv.zone ? wv.zone + ' ' : '') + wv.name, head: ['시각', '상태'], rows: hits.map((h) => [hh(h.at), h.s.warn ? h.s.warn.state : '']) }] });
        }
    }
    const order = { accident: 0, congestion: 1, weather: 2 };
    out.sort((a, b) => b.rank - a.rank || order[a.source] - order[b.source]);
    return out.map(({ ats, same, ...x }) => {
        const basis = x.name + (x.level ? " '" + x.level + "'" : '') + '(' + x.agency + ')', window = runsText(ats, targetDate);
        return { ...x, window, text: window + ' ' + basis, basis, detail: out.length === 1 && same ? [] : x.detail };
    });
}
/**
 * 해상 분석: 관할 안 모든 해역(같은 공식 사고 5km 칸은 하나 — 수집 단계에서 묶임)을 창의 모든 3시간 칸에서 판정하고,
 * 순위(단계 > 그 단계 지속 칸 수 > 기상·혼잡 근거 겹침 > 과거 사고 수)를 매겨 카드·시간 막대를 만든다.
 * 원천이 ok 가 아니거나(sources) 공식 사고예보 프레임이 빠진 칸(sea.frameGaps.accident)은 그 근거를 쓰지 않고, 단계가 0 이면 「평소 수준」 대신 「확인 불가(일부)」(A2).
 * 총평 후보(overviewTop)는 카드 상한(10)과 상관없이 총평 단계 순위에서 바로 고른다 — 단계 말과 총평 문장이 어긋나지 않게(A5).
 * 예: 한림 고정 자료 → {level:{rank:2,word:'주의'}, reviewedCells:52, attentionRegions:4, cards:[{name:'비양도 북방 …', window:'15~18시', …}], timeBar:[6칸]}
 * @param {object} input - 관할 입력 묶음 @param {object} win - editionWindow @param {object} wev - warningEvents 결과
 * @returns {object} 해상 절 [연계] ← buildBriefing / → slotOf·regionName·weatherFlow·runsText
 */
// 총평 해상 근거 줄의 지도 펼침 재료(2026-10-17 사용자 결정 §11.10.3) — 관할 경계(input.area)·칸 상자(region.box)·해구 상자(sea.weather[major].box).
// 저장하는 브리핑의 sea 절에는 넣지 않고 summary.sea(area·detail)로만 옮긴다(같은 도형을 두 번 저장하지 않게). seaSection 결과 객체를 열쇠로 seaSummary 가 꺼낸다.
const SEA_GEO = new WeakMap();
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
    for (const [major, w] of Object.entries(sea.weather || {})) {
        const f = ok.zoneForecasts ? weatherFlow(slots.map((at) => ({ at, ...((w.rows || []).find((q) => q.at === at) || {}) })), w.label || '대해구 ' + major, win.targetDate) : null;
        // where = 그 대해구에 든 이 관할 해역들의 특보구역 이름(많은 순 2개까지 — 수집 단계 region.zone, 기상청 특보구역 도형으로 정한 것). 「대해구 75」만으로는 어딘지 모른다는 지적
        //   (2026-10-17 사용자 *"대해구 75가 어딘지 모르겠고"* — 설계서 §11.10.9)에 규칙 분석·AI 입력이 「경북북부앞바다(대해구 75)」로 쓴다(haeguSentence). 이름이 없으면 null(해구 번호만).
        if (f) { const n = {}; for (const r of sea.regions || []) if (String(r.haegu?.major) === String(major) && r.zone?.name) n[r.zone.name] = (n[r.zone.name] || 0) + 1; const z = Object.keys(n).sort((a, b) => n[b] - n[a] || a.localeCompare(b, 'ko')).slice(0, 2); f.where = z.length ? z.join('·') : null; }
        flows[major] = f;
    }
    /** 해역 하나를 카드로. 창(window)·「오늘 예상」은 이어진 칸 묶음별(끊긴 시간대를 잇지 않음), peakAt = 가장 높은 단계의 첫 칸.
     *  §11.10.13(2026-10-17 사용자 결정): 화면 줄 = [사고현황('21~'25년)](traits.label·text) · [기상 예보](today.weatherLines + today.forecast) · [그 밖의 근거](today.otherLines)
     *  · historyNote · [권고](advice). today.lines·sentence 는 종전 그대로 둔다(AI 사실 목록 · 옛 판 화면). */
    const toCard = (x) => {
        const top = x.first >= 0 ? x.series[x.first].sources[0] : null, windowText = x.topAts.length ? runsText(x.topAts, win.targetDate) : null;
        const h = x.r.history || null, flow = flows[x.r.haegu?.major] || null, hasHist = !!h && h.available !== false;
        // 선박사고 이력: 자료 자체가 없음(집계 불가)과 0건을 가른다(독립 검토 낮음) — seaHistoryRow.
        // §11.10.13: 종전 [특성] 의 특보구역 이름·「174-3해구」는 뺐다(사용자 *"안면도 서쪽 평수구역, 173-3해구 빼고"* — 해구는 카드 이름에 이미 있다).
        // §11.10.13: [기상 예보] = 특보 줄(발효·예비·해제 뒤) + 바다 상태 흐름 문장, [그 밖의 근거] = 해양사고 위험예보·혼잡 줄.
        //   카드 꼬리표(sourceLabel·window)와 같은 근거 줄은 뺀다(사용자 *"첫번째 줄은 이미 위에서 표출하고 있고"*). 해구 예보 파고·풍속 줄(kind weather)은 흐름 문장이 있으면 뺀다(같은 값을 두 번 말하지 않게).
        const todayLines = [], seenLabel = new Set(), weatherLines = [], otherLines = [], WX_KINDS = new Set(['warning', 'afterRelease', 'weather']);
        for (const q of x.series) for (const s of q.sources) {
            const k = s.kind + s.label; if (seenLabel.has(k)) continue; seenLabel.add(k);
            const line = runsText(x.series.filter((z) => z.sources.some((y) => y.kind === s.kind && y.label === s.label)).map((z) => z.at), win.targetDate) + ' ' + s.label;
            todayLines.push(line);
            if ((top && s.label === top.label) || (s.kind === 'weather' && flow && flow.stateText)) continue;
            (WX_KINDS.has(s.kind) ? weatherLines : otherLines).push(line);
        }
        if (flow) todayLines.push(flow.text);
        const hist = seaHistoryRow(h, hasHist), tops = hist.types;
        // §11.10.15: 출처별 배지 — [권고] 근거도 배지 꼴(「해양사고 위험예보 '주의'(KOMSA)」 — 사용자 시안 [권고] 줄)로, 카드 꼬리표(top)가 속한 배지의 basis.
        const badges = seaBadges(x.series, win.targetDate, x.r.haegu && x.r.haegu.major != null ? x.r.haegu.major + '해구 예보' : null), topBadge = top ? badges.find((g) => g.key === badgeKey(top)) : null;
        // 경계 문장(2026-10-16 2단계 검토 B12): 종전 「공식 경계 단계 확인」의 「공식」이 무엇인지 모호했다 — 출처별로 무엇을 확인할지 쓴다
        //   공식 사고예보(한국해양교통안전공단 선박 사고위험 예보) '경계' → 「공단 사고위험 예보를 확인하고」 · 특보(풍랑·태풍 경보·예비 경보) → 「기상청 특보를 확인하고」.
        // [권고] 끝 낱말 「요구됩니다」(2026-10-17 사용자 *"필요합니다 보다는 요구됩니다. 라고 표현하는게 좋을 것 같아."* — 설계서 §11.10.16)
        const alert3 = top && top.kind === 'accident' ? ' 단계이므로 공단 사고위험 예보를 확인하고 운항 시 경계가 요구됩니다.' : ' 근거로 기상청 특보를 확인하고 운항 시 경계가 요구됩니다.';
        // §11.10.13: 권고(advice)와 사고 유형 한 줄(historyNote — 사용자 *"이 해역에서는 집계기간 중 충돌사고가 많이 기록되었습니다. 라고 표현"*)을 나눠 둔다. sentence = 둘을 이은 종전 꼴(옛 화면·시험).
        const advice = (windowText ? windowText + ' ' : '') + '이 해역은 ' + (topBadge ? topBadge.basis : top ? top.label : '') + (x.rank === 3 ? alert3 : ' 근거로 운항 시 ' + SUBJECT[x.rank] + ' 요구됩니다.');
        const historyNote = tops[0] ? '이 해역에서는 집계 기간 중 ' + tops[0].type + ' 사고가 많이 기록되었습니다.' : null, sentence = advice + (historyNote ? ' ' + historyNote : '');
        return {
            rid: x.r.rid, name: x.nm.name, nameBase: x.nm.base, nameBaseKind: x.nm.baseKind, rank: x.rank, word: WORD[x.rank], overviewRank: x.overviewRank,
            overview: x.oAts.length ? { rank: x.overviewRank, word: WORD[x.overviewRank], window: runsText(x.oAts, win.targetDate), label: runLabels(x.series.filter((q) => x.oAts.includes(q.at)), win.targetDate), labels: runLabelList(x.series.filter((q) => x.oAts.includes(q.at)), win.targetDate), at: x.oAts[0] } : null,
            sourceLabel: top ? top.label : null, window: windowText, peakAt: x.first >= 0 ? x.series[x.first].at : null,
            traits: { history: hasHist && h.count ? { from: h.from, to: h.to, count: h.count, types: tops, topTypes: h.topTypes || [], death: h.death || 0, missing: h.missing || 0 } : { count: 0, available: hasHist }, zone: x.r.zone || null, haegu: x.r.haegu || null,
                label: hist.label, accidents: hist.accidents, casualty: hist.casualty, text: hist.text },
            today: { lines: todayLines, weather: flow, forecast: flow && flow.stateText ? flow.stateText : null, weatherLines, otherLines, slots: x.series.map((q) => ({ at: q.at, rank: q.rank, labels: q.sources.map((s) => s.label) })) },
            badges, sentence, advice, historyNote, link: { gridId: x.r.gridId || null, accidentGridId: x.r.accidentGridId || null, lat: x.r.lat, lon: x.r.lon, t: x.first >= 0 ? x.series[x.first].at : win.from },
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
    const out = {
        level: { rank, word: levelWord(rank, missing, 4), source: regions[0] ? regions[0].series[regions[0].first].sources[0].label : null, partial: missing.length > 0 },
        overviewLevel: { rank: oRank, word: levelWord(oRank, missing, 4) },
        // 총평 후보 3곳까지(2026-10-17 §11.10 — 근거 줄에 해역 3곳까지. 종전 2곳). 단계·거르기 규칙은 그대로.
        overviewTop: oRegions.slice(0, 3).map((x) => cards.find((c) => c.rid === x.r.rid) || toCard(x)),
        // overviewRegions = 총평 기준(공식 사고예보 단계만 있는 칸을 거른 뒤) 관심 이상 해역 수 — 총평 단계(overviewLevel)와 같은 기준(2026-10-16 2단계 검토 B1).
        //   attentionRegions(카드·시간 막대 기준)와 다르면 그 차이 = 공식 사고예보 단계만 있는 해역 수. 틀 총평·AI 입력은 overviewRegions 를 쓴다.
        //   reviewedRegions = 검토한 해역 수(해역 = 해양사고 위험예보 칸 하나, 그 칸 밖 혼잡 예보 칸은 따로 하나 — 수집 단계 묶음). 총평 근거 「관할 해역 N칸 중 … M칸」은 같은 단위끼리(§11.10.3).
        //   reviewedCells(사고 칸 + 혼잡 칸을 따로 센 수 — 같은 바다를 두 번 셀 수 있다)는 종전 값 그대로 둔다(AI 입력 reviewed_cells).
        reviewedCells: sea.reviewedCells || 0, reviewedRegions: (sea.regions || []).length, attentionRegions: regions.length, overviewRegions: oRegions.length, cards, timeBar, weather: worstFlow, weatherByHaegu: flows, missing: [...new Set(missing)],
        missingSlots: accGaps.size ? { accident: [...accGaps].sort() } : {},
    };
    const accOnly = regions.filter((x) => x.overviewRank === 0), worstMajor = worstFlow ? Object.keys(flows).find((k) => flows[k] === worstFlow) : null;
    SEA_GEO.set(out, {
        area: Array.isArray(input.area) && input.area.length ? input.area : null,
        overview: oRegions.map((x) => x.r.box).filter(Array.isArray),
        // 해양사고 위험예보만 위험 단계인 해역을 단계별로(§11.10.12 — 근거 줄·화면 배지가 단계마다 하나) — 높은 단계 먼저. rank = 그 해역의 가장 높은 단계(사고예보 근거만이라 주의 2·경계 3)
        accidentOnlyByRank: [...new Set(accOnly.map((x) => x.rank))].sort((a, b) => b - a).map((rank) => { const g = accOnly.filter((x) => x.rank === rank); return { rank, count: g.length, boxes: g.map((x) => x.r.box).filter(Array.isArray) }; }),
        haegu: worstMajor ? { major: worstMajor, box: Array.isArray(sea.weather?.[worstMajor]?.box) ? sea.weather[worstMajor].box : null } : null,
        // haeguBoxes = 대해구마다 상자(§11.10.9 ⑥ — 분석 문단 「대해구 N」 링크 팝업 지도)
        haeguBoxes: Object.fromEntries(Object.entries(sea.weather || {}).filter(([, w]) => Array.isArray(w && w.box)).map(([k, w]) => [k, w.box])),
    });
    return out;
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
 *   경계: 풍랑·태풍·강풍 경보 발효 · 연안 위험지수 100('매우 높음')이면서 오늘 바뀐 요소 있음
 *   주의: 주의보 발효 · 지수 '높음'(67+)이면서 오늘 바뀐 요소
 *   관심: 지수 '다소 높음' 이상이면서 오늘 바뀐 요소 · 예비특보 · 떠밀림 문구 · 행사(평일 포함) · 특보 해제 뒤 3시간(결정 4 — released, 바뀐 요소로는 세지 않음)
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
    const top = cardsAll[0], missing = [...new Set(spots.flatMap((s) => s.missing || []))], hp = spots.find((s) => s.history?.from && s.history?.to)?.history || null;
    return {
        level: { rank: top ? top.j.rank : 0, word: levelWord(top ? top.j.rank : 0, missing, 0), source: top ? top.j.sourceLabel : null, partial: missing.length > 0 },
        // 검토한 관광지 수 = 연안 하루 값을 실제로 받은 곳만(상세 실패 'detail' 은 셈에서 뺀다 — 독립 검토 낮음). 실패 수는 failedSpots.
        reviewedSpots: spots.filter((s) => !(s.missing || []).includes('detail')).length, failedSpots: spots.filter((s) => (s.missing || []).includes('detail')).length,
        // attentionSpots = 관심 이상 관광지 전체 수(카드는 단계 높은 순 MAX_LAND_CARDS 곳까지 — 화면이 「카드는 10곳까지」를 밝힌다, 2단계 검토 B5).
        // attentionByRank = 관심 이상 관광지 전체를 단계별로 센 것({1:관심,2:주의,3:경계}) — 총평 근거 「주의 3곳 · 관심 9곳」은 카드 상한과 상관없이 이 수(§11.10).
        reviewedHazards: (land.hazardOnly || []).length, attentionSpots: cardsAll.length, attentionByRank: { 1: cardsAll.filter((x) => x.j.rank === 1).length, 2: cardsAll.filter((x) => x.j.rank === 2).length, 3: cardsAll.filter((x) => x.j.rank === 3).length },
        // attentionAll = 관심 이상 관광지 전부(카드 상한 없음 — attentionSpots 와 같은 수). 총평 근거 「평소보다 위험이 높아진 곳 N곳」을 누르면 펼치는 표(summary.land.raised)의 재료
        //   (2026-10-17 사용자 *"위험이 높아진 모든 관광지에 대해서"* — 설계서 §11.10.9). 단계 출처·지수·오늘 바뀐 요소(종류와 글)만 — 화면 글은 landSummary 가 만든다.
        attentionAll: cardsAll.map(({ s, j }) => ({ name: s.name, rank: j.rank, word: j.word, sourceLabel: j.sourceLabel, index: s.index ?? null, band: s.band || null, changes: j.changes.map((c) => c.text), kinds: j.changes.map((c) => c.kind) })),
        cards, constant, overviewTop: cards.slice(0, 3), missing,
        // isolation = 관할 관광지(육상이 검토하는 같은 목록) 중 연안사고 기록에 고립 사고가 있는 곳 전부 — 건수 많은 순, 같으면 이름 순(2026-10-17 사용자 결정 §11.10.3,
        //   원문 *"고립사고 지점표는 모두 보여줘"*). 기록 = config/coastal_safety/coast_accidents.json(관광지 구역 + 앞바다 500m, 관광지에 붙은 사고만). 상세를 못 받은 곳은 셀 수 없어 빠진다(land.missing 'detail').
        //   years = 연도별 수(수집 isolationYears — 표 「발생 현황」, §11.10.10). 옛 입력(연도 없음)이면 null.
        isolation: spots.filter((s) => s.isolation > 0).map((s) => ({ name: s.name, count: s.isolation, years: s.isolationYears || null })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko')),
        isolationPeriod: hp ? { from: hp.from, to: hp.to } : null,
    };
}
/**
 * 조석(서해·남해·제주 관할 — §11.6-8·11, 제주는 2026-10-16 결정 5): 대표 위치에서 가장 가까운 앵커 곡선으로 그 판의 창에 걸친 밀물 시간과 문구를 만들고,
 * 화면이 해양종합정보 조석 게이지를 그릴 수 있게 곡선(10분)·고저조(prev/next 포함)를 그대로 넘긴다. 점수에는 넣지 않는다(U45).
 * 문구는 밀물(저조 → 다음 고조) 중심(결정 5, 원문 *"저조가 아니라 고조지 않니? 물이 오르는시간이니까. 나 는 반영하자"*):
 *   「06:12 저조 뒤부터 물이 차오릅니다(12:30 고조) · 18:40 저조 뒤부터 물이 차오릅니다(10월 18일 00:50 고조).」(2026-10-17 §11.10.3 부터 「— 갯벌·바위에 … 나오세요.」 꼬리 없음)
 *   창(window)과 겹치는 밀물만 쓴다 — 창 앞 저조에서 이미 차오르는 중이면 그 저조도(날짜를 붙임). 23시 판은 전날 곡선(prevDayPeaks)의 밤 저조도 본다. 다음 날 첫 고조는 nextPeak.
 * 예: 저조 06:12·18:40, 고조 00:50·12:30, 다음 날 00:55 · 아침 판(06시~) → text '06:12 저조 뒤부터 물이 차오릅니다(12:30 고조) · 18:40 저조 뒤부터 물이 차오릅니다(10월 18일 00:55 고조).' · lows ['06:12','18:40']
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
    // 「— 갯벌·바위에 나가 있다면 물이 차오르기 전에 나오세요.」는 뺐다(2026-10-17 사용자 *"물이 차오르기 전에 나오세요 이벤트는 뺐으면 좋겠어"* — §11.10.3). 고립 주의는 summary.isolation 한 줄.
    if (flood.length) text.push(flood.join(' · ') + '.');
    // lows = 창 안 저조 시각(「08:16」, 대상일이 아니면 날짜를 붙임) — 총평 (고립 주의) 줄 「저조 시간(08:16·22:09) 전후」(§11.10.3)
    const lows = all.filter((p) => p.type === 'low' && p.ms >= from && p.ms < to).map(word);
    // 잠기는 바위: 「관할 안 잠기는 바위」는 「안 잠기는 바위」로 읽혀 「관할 내」로(2026-10-17 사용자 *"관할 안 잠기는 바위라고 되어 있어서 잠기지 않는 바위라고 읽힐 수 있거든. 그래서 관할 내라고 표시"* — §11.10.10).
    //   link = 화면이 지도 링크로 만드는 글(「잠기는 바위(간출암) N곳」) — 바위 목록(items)이 있을 때만(옛 수집 결과는 글만).
    const r = tide.rocks, rockLink = r && r.count ? '잠기는 바위(간출암) ' + r.count + '곳' : null;
    if (rockLink) text.push('관할 내 ' + rockLink + '이 ' + (r.first === r.last ? r.first : r.first + '~' + r.last) + ' 사이 물에 잠깁니다. 바위 위 낚시·채취 중 고립에 주의가 필요합니다.');   // §11.10.16 — 「—」 대신 마침표(화면은 「다.」 뒤를 줄바꿈 — 사용자 *"줄바꿔서 표출 … - 빼주고. 잠깁니다 다음에 . 붙여주고."*)
    const rocks = r ? { ...r, ...(rockLink && Array.isArray(r.items) && r.items.length ? { link: rockLink } : {}) } : null;
    return { anchor: { id: tide.anchorId, distKm: tide.distKm }, region: tide.region || null, date: tide.date, lows, gauge: { curve: tide.curve || [], peaks: tide.peaks, prevPeak: tide.prevPeak || null, nextPeak: tide.nextPeak || null, unit: 'cm' }, rocks, text };
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
 * 예: 한림(관심 이상 12곳) → {headline:'오늘 한림파출소 관할 연안의 단계는 "주의"입니다.',
 *       basis:['관할 관광지 30곳 중 평소보다 위험이 높아진 곳 12곳 (주의 3곳 · 관심 9곳)', '금능석물원 — 연안 위험지수 92(높음, 예상), 방문객 평소의 2.2배(예상)', '월령포구 — 방문객 평소의 1.8배(예상)',
 *              '풍랑주의보 예비특보(10월 18일 00~06시 발효 예정, 04:00 발표)'],   ← 두 곳 이상 공통 이유는 한 줄(§11.10.3 부터 「— A·B 공통」 꼬리 없음)
 *       advice:'금능석물원·월령포구·한림공원 주변 연안사고에 주의가 요구됩니다.'}  (물때는 §11.10.1 부터 공용 summary.tide)
 *     관심 이상 없음 → basis ['관할 관광지 4곳 — 평소와 달라진 요소(…)가 확인되지 않았습니다', '상시 위험 장소: …'], advice '관할 연안사고에 평소처럼 관심이 요구됩니다.'
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
        // 공통 줄은 이유만 — 종전 꼬리 「— A·B 공통」은 뺐다(2026-10-17 사용자 결정 §11.10.3). 그 장소 줄에서는 여전히 빠진다(한 번만).
        for (const [t] of shared) basis.push(ex(t));
    } else {
        basis.push('관할 관광지 ' + land.reviewedSpots + '곳 — ' + (miss ? '확인된 자료에서는 ' : '') + '평소와 달라진 요소(사람·행사·너울·이안류·특보·바람)가 확인되지 않았습니다');
        const c = land.constant.slice(0, 3).map((x) => x.name);
        basis.push(c.length ? '상시 위험 장소: ' + c.join('·') + (land.constant.length > 3 ? ' 등' : '') : '관할에 연결된 관광지·위험구역 자료가 없습니다');
    }
    if (miss) basis.push('확인하지 못한 자료: ' + miss);
    // 권고(2026-10-17 사용자 결정 §11.10.3): 「금능석물원·월령포구·한림공원 주변 연안사고에 주의가 필요합니다.」 — 종전 「물가 접근」을 뺐다. §11.10.16: 끝 낱말 「요구됩니다」.
    const advice = lt.length ? lt.map((c) => c.name).join('·') + ' 주변 연안사고에 ' + SUBJECT[lt[0].rank] + ' 요구됩니다.' : '관할 연안사고에 평소처럼 관심이 요구됩니다.';
    const raised = lt.length ? raisedTable(land, dayWord) : null;
    return raised ? { headline, basis, advice, raised } : { headline, basis, advice };
}
/**
 * 연안 근거 첫 줄 「평소보다 위험이 높아진 곳 N곳」을 누르면 펼치는 표(2026-10-17 사용자 결정 — 설계서 §11.10.9). 원문 *"그 위험이 높아진 곳을 하이퍼링크로 누르면
 * 아래로 펼쳐지면서 표로서 … 관광지, 기존, 위험이 높아진 곳 세 개로 구분해서 기존엔 뭐였는데 뭘로 높아졌다 … 위험이 높아진 모든 관광지에 대해서"*.
 * 「평소」 칸 = 「평소 수준」 — 코드로 확인한 정의: 관광지 단계(landSpot)는 오늘 바뀐 요소(방문객 평소보다 많음·행사·너울·이안류·특보·예비특보·해안 바람)나 특보 해제 뒤가 있을 때만 붙고,
 *   그런 것이 없는 날은 연안 위험지수·위험구역·사고 이력과 상관없이 모두 0(「평소 수준」 — 상시 위험 장소)이다. 관광지마다 따로 저장된 평소 단계·평소 지수는 없다.
 * 행 = 관심 이상 관광지 전부(land.attentionAll — 카드 상한 없음), 단계 높은 순 → 이름 순. 이유 = 근거 줄과 같은 글(지수는 「(높음, 예상)」, 바뀐 요소는 expectText).
 * 예: → {line:0, link:'평소보다 위험이 높아진 곳 12곳', head:['관광지','평소','오늘(예상)'], rows:[{name:'금능석물원', usual:'평소 수준', rank:2, word:'주의', reason:'연안 위험지수 92(높음, 예상), 방문객 평소의 2.2배(예상)'}, …], caption:'…'}
 * @param {object} land - landSection 결과 @param {string} dayWord - 오늘|내일 @returns {object|null} attentionAll 이 없는 옛 브리핑(다시 계산)이면 null
 * [연계] ← landSummary / 화면: station_briefing_render.js basisList(그 줄의 link 를 버튼으로 → raisedTable 표)
 */
function raisedTable(land, dayWord) {
    const all = Array.isArray(land.attentionAll) ? land.attentionAll : null;
    if (!all || !all.length) return null;
    const rows = all.slice().sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name, 'ko')).map((c) => {
        const idx = /^연안 위험지수/.test(c.sourceLabel || '') ? '연안 위험지수' + (Number.isFinite(c.index) ? ' ' + c.index : '') + '(' + (c.band ? c.band + ', ' : '') + '예상)' : null;
        const reason = [idx].concat((c.changes || []).map((t, i) => expectText((c.kinds || [])[i], t))).filter(Boolean).join(', ');
        return { name: c.name, usual: '평소 수준', rank: c.rank, word: c.word, reason };
    });
    return {
        line: 0, link: '평소보다 위험이 높아진 곳 ' + land.attentionSpots + '곳', head: ['관광지', '평소', dayWord + '(예상)'], rows,
        caption: '평소 = ' + dayWord + ' 달라진 요소(방문객·행사·너울·이안류·특보·해안 바람)가 없을 때의 단계 — 그런 날은 모든 관광지가 「평소 수준」입니다. 단계 아래 작은 글은 높아진 이유입니다.',
    };
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
// 해양사고 위험예보만 위험 단계인 해역 — 근거 줄(화면 링크)과 AI 입력 문구(§11.10.12, 2026-10-17 사용자 결정).
//   근거 줄: *"해양사고 위험예보(KOMSA) 기준 등급 '주의'인 해역 3칸 이라고 표현하는게 좋겠고"* · 줄 아래 풀이(종전 ACC_ONLY_NOTE 「(한국해양교통안전공단 예보에서는 …)」)는 *"그냥 빼는게 좋겠어"*.
//   AI 입력 문구: *"해양사고 위험예보(KOMSA 기준)만 '주의'인 해역이 있지만, 이렇게 표현"* — AI 분석 문단이 이 꼴을 그대로 쓰게(station_briefing_ai stationInput sea.accident_only_phrases).
/** 근거 줄. 예: ('주의', 3) → "해양사고 위험예보(KOMSA) 기준 등급 '주의'인 해역 3칸". @param {string} word - 주의|경계|주의·경계 @param {number} n @returns {string} [연계] ← seaSummary */
function komsaLine(word, n) { return "해양사고 위험예보(KOMSA) 기준 등급 '" + word + "'인 해역 " + n + '칸'; }
/** AI 입력 문구. 예: '주의' → "해양사고 위험예보(KOMSA 기준)만 '주의'인 해역". @param {string} word @returns {string} [연계] ← station_briefing_ai.stationInput */
function komsaPhrase(word) { return "해양사고 위험예보(KOMSA 기준)만 '" + word + "'인 해역"; }
/**
 * 해상 「총평과 권고」(2026-10-17 사용자 결정 §11.10.3 모양).
 * 근거 = 「관할 해역 N칸 중 위험이 높아진 해역 M칸」(N = 검토한 해역 수 reviewedRegions, M = 총평 기준 overviewRegions — 같은 단위) · 단계마다 「해양사고 위험예보(KOMSA) 기준 등급 '주의'인 해역 K칸」(K>0, 결론에는 넣지 않는 규칙 그대로 — §11.10.12, 풀이 줄 없음)
 *   · 해구 예보 흐름(기준 파고 2m·풍속 12m/s 를 **넘을 때만** — 사용자 *"(가)로 진행하자"*, 넘지 않으면 줄 없음: (기상) 칸이 이미 날씨를 보인다) · 해역 3곳까지 · 해제 예고/예비특보 제목 한 번씩 · 확인하지 못한 자료.
 * detail = 근거 줄 번호(line)별 덧붙임 — key(overview·accidentOnly·haegu), boxes(지도에서 깜빡일 칸·해구 상자 [서,남,동,북]), major(해구). area = 관할 경계(지도 펼침 바탕 — 없으면 화면은 펼침 없이 글만).
 * accidentOnly = 위험예보만 위험 단계인 해역의 단계별 수 [{rank, word, count}](높은 단계 먼저 — 근거 줄과 같은 수, 화면 결론 배지 「N개 해역 주의(KOMSA 예보)」 — §11.10.12). 단계를 모르면(옛 브리핑 다시 계산) rank 0·word '주의·경계'.
 * 예: → {headline:'오늘 한림파출소 관할 해상의 단계는 "경계"입니다.', basis:['관할 해역 88칸 중 위험이 높아진 해역 1칸', "해양사고 위험예보(KOMSA) 기준 등급 '경계'인 해역 3칸", "해양사고 위험예보(KOMSA) 기준 등급 '주의'인 해역 12칸",
 *       "06~24시 한림매일시장 북방 0.6해리 해역(232-2해구) — 해양사고 위험예보 '경계'(예상)", …], advice:'06~24시 한림매일시장 북방 0.6해리 해역 운항에 경계가 요구됩니다.',
 *       area:[[[[126.1,33.3],…]]], detail:[{line:0,key:'overview',boxes:[[126.2,33.4,126.25,33.44]]},{line:1,key:'accidentOnly',boxes:[…]},{line:2,key:'accidentOnly',boxes:[…]}],
 *       accidentOnly:[{rank:3,word:'경계',count:3},{rank:2,word:'주의',count:12}]}
 * @param {object} b @param {string} dayWord @returns {object} [연계] ← buildSummary / 화면: station_briefing_render.js summaryBodyV2(근거 줄 ▸ 지도 펼침)
 */
function seaSummary(b, dayWord) {
    const sea = b.sea, top = sea.overviewTop || [], miss = sea.missing.length ? sourceNames(sea.missing) : null, basis = [], detail = [], geo = SEA_GEO.get(sea) || null;
    const oCount = Number.isFinite(sea.overviewRegions) ? sea.overviewRegions : sea.attentionRegions, accOnly = Math.max(0, sea.attentionRegions - oCount);
    const total = Number.isFinite(sea.reviewedRegions) ? sea.reviewedRegions : sea.reviewedCells;
    const add = (text, extra) => { basis.push(text); if (extra) detail.push({ line: basis.length - 1, ...extra }); };
    const boxesOf = (list) => (list && list.length ? { boxes: list } : {});
    const headline = dayWord + ' ' + b.station.name + ' 관할 해상의 단계는 "' + sea.overviewLevel.word + '"입니다.';
    add('관할 해역 ' + total + '칸 중 ' + (miss ? '확인된 자료 기준 ' : '') + '위험이 높아진 해역 ' + oCount + '칸', oCount > 0 && geo ? { key: 'overview', ...boxesOf(geo.overview) } : null);
    const accidentOnly = [];
    if (accOnly > 0) {
        // 단계마다 한 줄(§11.10.12) — 옛 브리핑 다시 계산(도형·단계 없음)이면 단계를 몰라 「'주의·경계'」 한 줄
        const groups = geo && geo.accidentOnlyByRank.length ? geo.accidentOnlyByRank : [{ rank: 0, count: accOnly, boxes: [] }];
        for (const g of groups) {
            const word = RANK_SHORT[g.rank] || '주의·경계';
            accidentOnly.push({ rank: g.rank, word, count: g.count });
            add(komsaLine(word, g.count), { key: 'accidentOnly', ...boxesOf(g.boxes) });
        }
    }
    if (sea.weather && sea.weather.onsetAt) {
        const w = sea.weather, h = geo && geo.haegu;
        // 끝 토막은 「21시부터 낮아짐」(§11.10.9 — 종전 「… 기준 아래로 내려감」: 사용자 *"그냥 기준내용 빼고"*, 이 줄은 AI 입력 shown 에도 간다)
        add(w.label + ' 예보 ' + (w.onsetText || '') + '로 높아짐(예상)' + (w.downText ? ', ' + w.downText + ' 낮아짐' : ''), { key: 'haegu', ...(h ? { major: h.major, ...(h.box ? { boxes: [h.box] } : {}) } : {}) });
    } else if (!sea.weather && !sea.missing.includes('zoneForecasts')) basis.push('해구 예보 자료를 확인하지 못했습니다');
    for (const c of top) basis.push(c.overview.window + ' ' + c.name + ' — ' + overviewLabelText(c.overview));
    const rel = b.special.find((x) => x.kind === 'release' || x.kind === 'released'), pre = b.special.find((x) => x.kind === 'prewarn');
    for (const x of [rel, pre]) if (x) basis.push(x.title);
    if (miss) basis.push('확인하지 못한 자료: ' + miss + ' — 그 근거는 판단에서 뺐습니다');
    // 권고(§11.10.3): 「06~24시 한림매일시장 북방 0.6해리 해역 운항에 경계가 필요합니다.」 — 종전 「…시경」의 「경」과 해역 이름 꼬리 「(232-2해구)」를 뺐다(근거 줄에는 그대로).
    const advice = top[0] ? top[0].overview.window + ' ' + String(top[0].name).replace(/\([^()]*해구\)$/, '') + ' 운항에 ' + SUBJECT[top[0].overview.rank] + ' 요구됩니다.' : miss ? '출항 전 기상청 특보·예보를 직접 확인하는 데 관심이 요구됩니다.' : '출항 전 기상 확인에 관심이 요구됩니다.';   // §11.10.16 「요구됩니다」
    // haegu(§11.10.9 ⑥ — 사용자 *"대해구 75 부분은 정확히 어딘지 알 수 있도록 하이퍼링크를 통해, 그 부분을 눌렀을 때 팝업으로 지도가 표출되고, 해당 해역의 해구 격자가 표시되도록"*):
    //   분석 문단에 나올 수 있는 대해구 이름(「경북북부앞바다(대해구 75)」·「대해구 75」)과 그 상자 — 화면이 그 글을 링크로, 누르면 관할 경계 + 그 대해구 테두리 팝업 지도. 상자가 없는 해구는 넣지 않는다(화면이 짐작하지 않게).
    const hb = (geo && geo.haeguBoxes) || {}, haegu = Object.entries(sea.weatherByHaegu || {}).filter(([k, f]) => f && Array.isArray(hb[k])).map(([k, f]) => ({ major: k, label: f.label, name: haeguPlace(f), box: hb[k] }));
    return { headline, basis, advice, area: geo && geo.area ? geo.area : null, detail, haegu, accidentOnly };
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
/** 괄호 밖 쉼표로 나눈다(「제주시(북부, 중산간)」의 쉼표는 나누지 않음). 예: 'A, B(c, d), E' → ['A','B(c, d)','E']. @param {string} s @returns {string[]} [연계] ← shortList·zoneHit */
function topItems(s) {
    const out = []; let depth = 0, cur = '';
    for (const ch of String(s)) { if (ch === '(') depth++; else if (ch === ')') depth = Math.max(0, depth - 1); if (ch === ',' && !depth) { out.push(cur.trim()); cur = ''; } else cur += ch; }
    out.push(cur.trim()); return out.filter(Boolean);
}
/** 긴 지역 나열을 줄인다(괄호 밖 쉼표 경계에서 자르고 「 등」 — 괄호 안에서 끊지 않는다, 2026-10-17 독립 검토 2). 예: 45자 넘는 'A, B, C …' → 'A, B 등' · ('제주도산지와 제주시(북부, 중산간), 서귀포시중산간', 24) → '제주도산지와 제주시(북부, 중산간) 등'. @param {string} s @param {number} [max] @returns {string} [연계] ← bulletinScan */
function shortList(s, max = 40) {
    let out = '';
    for (const it of topItems(s)) { const next = out ? out + ', ' + it : it; if (next.length > max && out) return out + ' 등'; out = next; }
    return out;
}
/**
 * 통보문의 구역 나열이 파출소의 가장 가까운 특보구역을 가리키는지(2026-10-17 독립 검토 4). 같은 이름이거나 상위 이름(「제주도앞바다」 ⊃ 「제주도서부앞바다」, 「제주도해상」 ⊃ 제주도 구역 전부)이면 참.
 * 「(북부앞바다 제외)」처럼 괄호 안 제외 구역은 거꾸로 — 그 구역이면 거짓(제외를 맞음으로 세지 않는다).
 * 예: ('제주도앞바다(북부앞바다 제외), 남해서부서쪽먼바다', '제주도서부앞바다') → true · (같은 글, '제주도북부앞바다') → false · ('제주도해상와 남해서부서쪽먼바다', '제주도북부앞바다') → true
 * @param {string} raw - 통보문 구역 나열 @param {string|null} near - 가장 가까운 특보구역 @returns {boolean} [연계] ← bulletinScan
 */
function zoneHit(raw, near) {
    if (!raw || !near) return false;
    const nk = zoneKey(near);
    return topItems(String(raw).replace(/([가-힣])[와과]\s/g, '$1, ')).some((it) => {
        const ex = [...it.matchAll(/\(([^)]*)제외\)/g)].flatMap((m) => m[1].split(/[,·\s]+/)).map(zoneKey).filter(Boolean);
        if (ex.some((e) => nk.endsWith(e))) return false;
        const k = zoneKey(it.replace(/\([^)]*\)/g, ''));
        if (!k) return false;
        if (k === nk) return true;
        const m = k.match(/^(.+?)(앞바다|먼바다|해상)$/);
        return !!m && nk.startsWith(m[1]) && (m[2] === '해상' || nk.endsWith(m[2]));
    });
}
// 통보문의 날짜 표지 — 「오늘(17일)」·「내일(18일)」 꼴, 날짜 없는 「오늘/내일/모레/글피」, 「18일」 꼴.
// 2026-10-17 독립 검토 12: 「18일부터」·「1일부터 3일까지」·「내일부터」처럼 조사가 바로 붙은 꼴도 받는다(종전엔 뒤에 한글이 오면 버려 그날 항목이 빠졌다). 「15일간」 같은 꼴은 그대로 뺀다.
const DAY_TAIL = '(?=부터|까지|은|는|에|도|과|와|께|경|$|[^가-힣(])';
const DAY_RE = new RegExp('(오늘|내일|모레|글피)\\((\\d{1,2})일\\)|(오늘|내일|모레|글피)' + DAY_TAIL + '|(?<![\\d~])(\\d{1,2})일' + DAY_TAIL.replace('[^가-힣(]', '[^\\d가-힣]'), 'g');
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
        for (;;) {
            if (j + 1 >= marks.length) break;
            const gap = line.slice(marks[j].end, marks[j + 1].i), a = marks[j].day, b = marks[j + 1].day;
            if (/^\s*[과와·]\s*$/.test(gap)) { j++; days.push(b); continue; }
            // 「1일부터 3일까지」 — 사이 날(2일)도 그 토막의 날로(독립 검토 12)
            if (/^\s*부터\s*$/.test(gap) && /^\s*까지/.test(line.slice(marks[j + 1].end))) { j++; for (let d = a + 1; d <= b; d++) days.push(d); if (b < a) days.push(b); continue; }
            break;
        }
        const stop = j + 1 < marks.length ? marks[j + 1].i : line.length;
        segs.push({ days, head: line.slice(marks[k].i, marks[j].end), text: line.slice(marks[j].end, stop), rest: line.slice(stop) });
        k = j;
    }
    return segs;
}
// 특이사항 묶음 순서(강풍 → 풍랑 예비특보 → 해상 → 그 밖 예비특보 → 강수·유의)와 다루는 섹션.
const NOTE_CATS = ['gale', 'waveWarn', 'sea', 'otherWarn', 'rain'], NOTE_SECTIONS = new Set(['예비특보현황', '강풍및해상', '강수및유의사항']);
/** 첫 문장까지(「천둥.번개」처럼 마침표 뒤에 바로 글자가 붙은 것은 문장 끝이 아니다). 예: 'A 있겠으니. B' → 'A 있겠으니'. @param {string} s @returns {string} [연계] ← bulletinScan */
function firstSentence(s) { return String(s).split(/\.(?=\s|$)/)[0]; }
/**
 * 원문 단서를 괄호로(독립 검토 2 — 종전엔 버렸다). 「곳에 따라」·「…는 곳이 있겠」 → 곳에 따라 · 「풍랑특보가 발표될 가능성」 → 풍랑특보 가능성 · 그 밖 「가능성」 → 가능성.
 * 예: '…강하게 부는 곳이 있겠으니' → '(곳에 따라)' · '…강풍특보를 발표할 가능성이 있겠으니' → '(강풍특보 가능성)' · 단서 없음 → ''. @param {string} src @returns {string} [연계] ← bulletinScan
 */
function noteQuals(src) {
    const q = [];
    if (/곳에\s*따라|[는은]\s*곳이\s*있/.test(src)) q.push('곳에 따라');
    const p = src.match(/([가-힣]*특보)[를을가이]?\s*(?:발표될|발표할|발효될|내려질)?\s*가능성/);
    if (p) q.push(p[1] + ' 가능성'); else if (/가능성/.test(src)) q.push('가능성');
    return q.length ? '(' + q.join('·') + ')' : '';
}
/**
 * 물결 수치 + 원문이 그 수치 바로 뒤(문장 끝·40자 안)에 쓴 방향 말(독립 검토 1 — 종전엔 방향과 상관없이 「높아짐」). 방향 말이 없으면 수치만, 둘 다 있으면 원문 순서대로.
 * 예: '물결이 0.5~1.0m로 낮게 일겠습니다' → '물결 0.5~1.0m로 낮아짐' · '물결이 2.0~3.0m로 높게 일겠으나 오후에는 낮아지겠으니' → '물결 2.0~3.0m로 높게 일다가 낮아짐' · '물결이 최대 4m로 매우 높게' → '물결 최대 4m로 높아짐' · '물결이 1.0~2.0m로 일겠습니다' → '물결 1.0~2.0m'
 * @param {string} src @returns {string|null} [연계] ← bulletinScan
 */
function waveNote(src) {
    const m = src.match(/물결[이가은는도]?\s*(최대\s*)?(\d+(?:\.\d+)?(?:\s*~\s*\d+(?:\.\d+)?)?)\s*m(?![/a-z])/);
    if (!m) return null;
    const fig = (m[1] ? '최대 ' : '') + m[2].replace(/\s+/g, '') + 'm', w = firstSentence(src.slice(m.index + m[0].length)).slice(0, 40);
    const iu = w.search(/높게|높아|높은|높이/), id = w.search(/낮게|낮아|잦아/);
    if (iu >= 0 && id >= 0) return '물결 ' + fig + (iu < id ? '로 높게 일다가 낮아짐' : '로 낮게 일다가 높아짐');
    return '물결 ' + fig + (iu >= 0 ? '로 높아짐' : id >= 0 ? '로 낮아짐' : '');
}
/** 바람 수치(m/s, 없으면 km/h 그대로) + 원문 방향 말(강하게/약하게 — 없으면 수치만). 예: '바람이 30~55km/h(9~15m/s)로 매우 강하게' → '바람 9~15m/s로 강해짐'. @param {string} src @returns {string|null} [연계] ← bulletinScan */
function windNote(src) {
    const m = src.match(/\((\d+~\d+)\s*m\/s\)|(\d+~\d+)\s*m\/s|(\d+~\d+)\s*km\/h(?!\s*\()/);
    if (!m) return null;
    const fig = m[1] ? m[1] + 'm/s' : m[2] ? m[2] + 'm/s' : m[3] + 'km/h', w = firstSentence(src.slice(m.index + m[0].length)).slice(0, 40);
    const iu = w.search(/강하게|강해/), id = w.search(/약하게|약해|잦아/);
    return '바람 ' + fig + (iu >= 0 && (id < 0 || iu < id) ? '로 강해짐' : id >= 0 ? '로 약해짐' : '');
}
/** 순간풍속(m/s, 괄호 m/s 가 없으면 km/h 그대로 — 독립 검토 3). 예: '순간풍속 55km/h(15m/s) … 안팎으로 강하게' → '순간풍속 15m/s 안팎의 강한 바람' · '순간풍속 90km/h 안팎으로 매우 강하게' → '순간풍속 90km/h 안팎의 매우 강한 바람'. @param {string} src @returns {string|null} [연계] ← bulletinScan */
function gustNote(src) {
    const g = src.match(/순간풍속\s*(\d+)\s*km\/h(?:\s*\((\d+)\s*m\/s\))?|순간풍속\s*(\d+)\s*m\/s/);
    if (!g) return null;
    const v = g[2] ? g[2] + 'm/s' : g[1] ? g[1] + 'km/h' : g[3] + 'm/s';
    return '순간풍속 ' + v + (/안팎/.test(src.slice(g.index, g.index + 40)) ? ' 안팎' : '') + '의 ' + (/매우 강하게/.test(src) ? '매우 강한' : '강한') + ' 바람';
}
/** 해상 토막의 구역 나열(「에서는·에서도·에서·에는·에도·에」 앞까지 — 독립 검토 1). 구역 이름으로 끝나지 않으면 ''. 예: ' 새벽부터 제주도앞바다에서는 물결이' → '제주도앞바다'. @param {string} t @returns {string} [연계] ← bulletinScan */
function zonePart(t) {
    const z = t.replace(TOD_RE, '').split(/(?:에서는|에서도|에서|에는|에도|에)(?=\s|$)/)[0].replace(/^\s*[은는]\s+/, '').replace(/[,\s]+$/, '').trim();
    return z.length <= 80 && /(?:앞바다|먼바다|해상|바다)(?:\([^)]*\))?$/.test(z) ? z : '';
}
/**
 * 지방기상청 단기 전망 통보문에서 브리핑 대상일의 특이사항을 모두 뽑는다(결정론 — AI 없음, 이유는 설계서 §11.10.1) + 대상일 토막이 있었는지(found).
 *   <예비특보 현황> 「○ 풍랑 예비특보(17일 밤(18~24시)): 구역」 → 「풍랑 예비특보: 오늘 밤(18~24시) 구역」(날짜가 대상일일 때만)
 *   <강풍 및 해상> (강풍) → 「오늘 오후부터 제주도에 순간풍속 15m/s 안팎의 강한 바람(곳에 따라)」(지역 짧게 — 괄호 안에서 끊지 않음)
 *     (해상) → 「내일 새벽부터 제주도북부앞바다 물결 1.0~2.5m로 높아짐」 — 방향(높아짐·낮아짐)은 원문이 수치 바로 뒤에 쓴 말로만(waveNote), 구역은 zonePart.
 *     구역 뒤 풀이말이 다음 날 토막에 함께 있으면(「오늘 밤부터 A, 내일 새벽부터 B에 … 물결이 1.5~3.0m」) 그 풀이말을 쓴다.
 *   <강수 및 유의 사항> 대상일 토막의 비(지역·확대 — 「산지에 비, 오후(12~18시)부터 그 밖의 지역으로 확대」)·시간당 강한 비·천둥번개·짙은 안개(「중산간 이상 지역에」).
 *     「한편 … 강수 강도와 강수량의 차이가 있겠으니」 같은 일반 안내는 넣지 않는다.
 *   단서(noteQuals — 곳에 따라·○○특보 가능성·가능성)를 괄호로 붙인다(독립 검토 2). 같은 구역 나열의 풍랑 예비특보 줄과 해상 줄은 한 줄로 합친다(독립 검토 4).
 *   found(독립 검토 3): 다루는 섹션에 대상일 토막이 있었거나 날짜 표지가 없는 ○ 줄이 있었으면 참 — 뽑은 것이 없을 때 화면이 「없습니다」 대신 「뽑지 못했습니다 — 원문을 확인하세요」.
 * 예: (10-17 제주 통보문, '2026-10-17', '2026-10-17', '오늘') → {found:true, notes:[{cat:'gale',text:'오늘 오후부터 제주도에 순간풍속 15m/s 안팎의 강한 바람(곳에 따라)',zones:null}, {cat:'waveWarn',text:'풍랑 예비특보: 오늘 밤(18~24시) 제주도남쪽바깥먼바다 — 물결 1.5~3.0m로 높아짐',zones:'제주도남쪽바깥먼바다'}]}
 * @param {string} text - 통보문 본문(마크업 있어도 됨) @param {string} issuedDate - 발표일 YYYY-MM-DD @param {string} targetDate @param {string} dayWord - 대상일의 오늘/내일
 * @returns {object} {found, notes:[{cat,text,zones}]}(묶음 순서 NOTE_CATS) [연계] ← bulletinNotes·weatherSummary / 시험: test_station_briefing.js
 */
function bulletinScan(text, issuedDate, targetDate, dayWord) {
    const issuedMs = Date.parse(issuedDate + 'T00:00:00+09:00'), tDay = Number(targetDate.slice(8, 10));
    const off = Math.round((Date.parse(targetDate + 'T00:00:00+09:00') - issuedMs) / (24 * HOUR));
    const res = { found: false, notes: [] };
    if (!Number.isFinite(off) || off < 0 || off > 3) return res;
    // 여러 날 토막(「내일(18일)과 모레(19일)」·「1일부터 3일까지」)은 때 말을 붙이지 않는다 — 그 때 말이 어느 날 것인지 모른다.
    const when = (seg) => { if (seg.days.length > 1) return dayWord; const m = seg.text.match(TOD_RE) || []; return [dayWord, m[1] || null].filter(Boolean).join(' ') + (m[2] || ''); };
    const add = (cat, t, zones = null, what = null) => res.notes.push({ cat, text: t.replace(/\s+/g, ' ').trim(), zones, what });
    let section = '', tag = '';
    for (const raw of stripMarkup(text).split(/\r?\n/)) {
        const line = raw.replace(/\s+/g, ' ').trim(); if (!line) continue;
        const sec = line.match(/^<([^>]+)>$/); if (sec) { section = sec[1].replace(/\s+/g, ''); tag = ''; continue; }
        if (/^o /.test(line)) continue;                                   // 행동 요령 글머리(o …) — 넣지 않는다
        const t = line.match(/^○\s*\(([^)]+)\)/); if (t) tag = t[1]; else if (/^○/.test(line)) tag = '';
        if (section === '예비특보현황') {
            const m = line.match(/^○\s*(\S+)\s*예비특보\((\d{1,2})일\s*([^:]*?)\)\s*:\s*(.+)$/);
            if (m && Number(m[2]) === tDay) { res.found = true; add(m[1] === '풍랑' ? 'waveWarn' : 'otherWarn', m[1] + ' 예비특보: ' + [dayWord, m[3].trim()].filter(Boolean).join(' ') + ' ' + shortList(m[4]), m[4]); }
            continue;
        }
        if (!NOTE_SECTIONS.has(section)) continue;
        const body = line.replace(/^○\s*(\([^)]+\))?\s*/, '').replace(/^-\s*(?:한편|또한)?,?\s*/, '');
        const segs = daySegments(body, issuedMs);
        if (!segs.length && /^○/.test(line)) res.found = true;            // 날짜 없는 ○ 줄 — 어느 날 것인지 몰라 넣지 않지만 「없다」고 하지도 않는다
        for (const seg of segs.filter((x) => x.days.includes(tDay))) {
            res.found = true;
            const all = seg.text + seg.rest, w = when(seg);
            if (section === '강풍및해상' && tag === '강풍') {
                const src = firstSentence(/순간풍속/.test(seg.text) ? seg.text : all), g = gustNote(src); if (!g) continue;
                const am = seg.text.replace(TOD_RE, '').match(/^\s*([^\d]+?)(?:에서는|에서|에는|에도|에)\s+(?:바람|순간풍속)/);
                add('gale', w + ' ' + (am ? shortList(am[1], 24) + '에 ' : '') + g + noteQuals(src));
            } else if (section === '강풍및해상' && tag === '해상') {
                const zones = zonePart(seg.text); if (!zones) continue;
                const src = firstSentence(/물결|m\/s|km\/h|천둥/.test(seg.text) ? seg.text : all);
                const what = waveNote(src) || windNote(src) || (/천둥/.test(src) ? '돌풍과 천둥·번개' : null);
                if (what) add('sea', w + ' ' + shortList(zones) + ' ' + what + noteQuals(src), zones, what);
            } else if (section === '강수및유의사항') {
                const s = seg.text;
                if (/강수\s*강도|강수량의\s*차이/.test(s)) continue;          // 일반 안내(「지역에 따라 강수 강도와 강수량의 차이」) — 특이사항 아님
                const hr = s.match(/시간당\s*(\d+~\d+\s*mm)/);
                const what = hr ? '시간당 ' + hr[1].replace(/\s+/g, '') + ' 강한 비' : /짙은 안개/.test(s) ? '짙은 안개' : /천둥/.test(s) ? '돌풍과 천둥·번개' : tag === '강수' && /비/.test(s) ? '비' : null;
                if (!what) continue;
                const rest = s.replace(TOD_RE, '');
                const area = (what === '비' && rest.match(/^\s*([가-힣]+)에\s*비/)) || rest.match(/([가-힣]+(?:\s이상|\s이하)?\s지역|[가-힣]+)을\s*중심으로/);
                const grow = what === '비' ? s.slice(s.indexOf('비') + 1).match(/((?:이른 |늦은 )?(?:새벽|아침|오전|낮|오후|저녁|밤)(?:\(\d{2}(?:~\d{2})?시\))?)부터\s*([^\d,.]{1,20}?)(으로|로)\s*(?:점차\s*)?(?:확대|확산)/) : null;
                add('rain', w + ' ' + (area ? area[1] + '에 ' : '') + what + (grow ? ', ' + grow[1] + '부터 ' + grow[2] + grow[3] + ' 확대' : '') + noteQuals(s));
            }
        }
    }
    // 같은 구역 나열의 풍랑 예비특보 줄 + 해상 줄은 한 줄로(예비특보 줄에 「 — 물결 …」, 해상 줄은 뺀다)
    const zk = (z) => topItems(z).map(zoneKey).join(',');
    for (const ww of res.notes.filter((n) => n.cat === 'waveWarn')) {
        const s = res.notes.find((n) => n.cat === 'sea' && !n.merged && zk(n.zones) === zk(ww.zones));
        if (s) { ww.text += ' — ' + s.what; s.merged = true; }
    }
    const seen = new Set();
    res.notes = res.notes.filter((n) => !n.merged && !seen.has(n.text) && seen.add(n.text)).filter((n, i, a) => n.cat !== 'gale' || a.findIndex((x) => x.cat === 'gale') === i)
        .map((n, i) => ({ ...n, i })).sort((a, b) => NOTE_CATS.indexOf(a.cat) - NOTE_CATS.indexOf(b.cat) || a.i - b.i).map(({ cat, text: tx, zones }) => ({ cat, text: tx, zones }));
    return res;
}
/**
 * 특이사항을 최대 MAX_NOTES(3)줄로 고른다 — 파출소의 가장 가까운 특보구역(또는 그 상위 구역 — zoneHit, 「(…제외)」는 맞음이 아님)을 가리키는 줄을 먼저 넣고(독립 검토 4 — 종전엔 상한에 그 구역 줄이 잘릴 수 있었다),
 * 남은 자리를 묶음 순서대로 채운다. 같은 묶음 안에서는 그 구역 줄이 앞.
 * 예: (18일 제주 통보문 줄들, '제주도북부앞바다') → 강풍 · 북부앞바다 해상 줄 · 제주도해상 천둥 줄(「제주도앞바다(북부앞바다 제외)」 예비특보 줄은 뒤로)
 * @param {object[]} notes - bulletinScan().notes @param {string|null} near @returns {string[]} [연계] ← bulletinNotes·weatherSummary
 */
function pickNotes(notes, near) {
    const hit = notes.map((n) => zoneHit(n.zones, near)), order = notes.map((n, i) => i).sort((a, b) => NOTE_CATS.indexOf(notes[a].cat) - NOTE_CATS.indexOf(notes[b].cat) || hit[b] - hit[a] || a - b);
    const keep = new Set();
    for (const i of order) if (hit[i] && keep.size < MAX_NOTES) keep.add(i);
    for (const i of order) if (keep.size < MAX_NOTES) keep.add(i);
    return order.filter((i) => keep.has(i)).map((i) => notes[i].text);
}
/**
 * 단기 전망 통보문의 대상일 특이사항(최대 3줄). bulletinScan + pickNotes.
 * 예: 10-17 제주 통보문 · 대상 10-17 · '오늘' → ['오늘 오후부터 제주도에 순간풍속 15m/s 안팎의 강한 바람(곳에 따라)', '풍랑 예비특보: 오늘 밤(18~24시) 제주도남쪽바깥먼바다 — 물결 1.5~3.0m로 높아짐']
 * @param {string} text @param {string} issuedDate @param {string} targetDate @param {string} dayWord @param {string} [nearZone] - 파출소의 가장 가까운 특보구역(그 구역 줄을 먼저)
 * @returns {string[]} [연계] ← 시험 · weatherSummary 는 found 도 쓰려고 bulletinScan·pickNotes 를 직접 부른다
 */
function bulletinNotes(text, issuedDate, targetDate, dayWord, nearZone) { return pickNotes(bulletinScan(text, issuedDate, targetDate, dayWord).notes, nearZone || null); }
/**
 * (기상) 칸 — 파출소 위치에서 가장 가까운 앞바다(특보구역)의 지방기상청 단기 해상예보 오전·오후 두 칸 + 그 지방청 단기 전망의 대상일 특이사항.
 * 앞바다가 30km 넘게 떨어져 더 가까운 먼바다 예보를 쓰거나 먼 앞바다를 그대로 쓰면 note 에 그 사실(collectZoneWeather — 독립 검토 5).
 * 자료가 없으면 지어내지 않고 missing·bulletinMissing 으로 밝힌다(화면 「기상예보 자료를 확인하지 못했습니다」).
 * notesFound(독립 검토 3): 통보문에 대상일 토막이 있었는지(자료로만 남긴다). 화면은 §11.10.11(2026-10-17 사용자 결정)부터 notes 가 비면 이유(없음·bulletinMissing·notesFound)와 상관없이 특이사항 칸째 그리지 않는다.
 * 예: weatherSummary(b, {zone:'제주도서부앞바다', distKm:0.5, office:'184', coastal:{officeName:'제주지방기상청',publishTime:'10.17. 05:00',periods:[…]}, bulletin:{officeName,publishTime:'2026.10.17 04:40',text}}, win)
 *     → {zone:'제주도서부앞바다', kind:'coastal', note:null, rows:[{label:'오늘 오전',text:'구름많음 · 파고 0.5~1.5m · …'},{label:'오늘 오후',…}], source:'제주지방기상청 단기 해상예보 (10.17 05:00 발표)', notes:[…], notesFound:true, notesSource:'제주지방기상청 단기 전망 (10.17 04:40 발표)', missing:false, bulletinMissing:false}
 * @param {object} b @param {object|null} wx - station_briefing_inputs.collectZoneWeather 결과 @param {object} win @returns {object}
 * [연계] ← buildSummary / → weatherSlotsFor·periodText·bulletinScan·pickNotes
 */
function weatherSummary(b, wx, win) {
    const out = { zone: wx?.zone || null, distKm: wx?.distKm ?? null, kind: wx?.kind || (wx ? 'coastal' : null), note: wx?.note || null, rows: [], source: null, notes: [], notesFound: false, notesSource: null, missing: true, bulletinMissing: true };
    const periods = wx?.coastal?.periods || [];
    if (wx?.coastal && periods.length) {
        out.rows = weatherSlotsFor(win).map((s) => { const p = periods.find((q) => q.date === s.date && q.period === s.period); return { label: dayLabel(s.date, b.generatedAt) + ' ' + PERIOD_WORD[s.period], text: p ? periodText(p) : '자료 없음', ok: !!p }; });
        out.missing = !out.rows.some((r) => r.ok);
        out.source = (wx.coastal.officeName || '지방기상청') + ' 단기 해상예보' + (wx.coastal.publishTime ? ' (' + String(wx.coastal.publishTime).replace(/(\d{2}\.\d{2})\.\s*/, '$1 ') + ' 발표)' : '');
    }
    const bt = wx?.bulletin, iss = bt && String(bt.publishTime || '').match(/^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}:\d{2})/);
    if (bt && bt.text && iss) {
        const issued = iss[1] + '-' + iss[2] + '-' + iss[3], off = (Date.parse(win.targetDate) - Date.parse(issued)) / (24 * HOUR);
        if (off >= 0 && off <= 2) {
            const scan = bulletinScan(bt.text, issued, win.targetDate, dayWordOf(b));
            out.bulletinMissing = false; out.notes = pickNotes(scan.notes, wx.zone); out.notesFound = scan.found; out.notesSource = (bt.officeName || '지방기상청') + ' 단기 전망 (' + iss[2] + '.' + iss[3] + ' ' + iss[4] + ' 발표)';
        }
    }
    return out;
}
// ── 규칙 분석 문단 — 2026-10-17 사용자 결정(설계서 §11.10.4, AI 가 실패했을 때 *"추천대로"*): AI 분석과 같은 꼴(3~5문장 · 원인 · 마지막 「따라서 … 필요합니다」)을
//    서버 값만으로 만든다. 화면은 AI 분석이 없을 때 이 문단을 「규칙 분석」 이름표와 함께 보인다(제목은 그대로 「HH:MM AI 연안 안전 브리핑」).
//    종전 틀 총평 문단(templateOverview — §11.10 에서 없앰)의 생각을 되살리되 새 문구 결정을 따른다: 「연안사고에 … 필요」 · 해양사고 위험예보 · 「예상」 · 「— A·B 공통」 없음.
const MIN_ANALYSIS_S = 3, MAX_ANALYSIS_S = 5;
/** 조사를 고를 마지막 한글 글자 — 끝의 괄호 덧말은 떼고(「해역(232-2해구)」 → 해역) 따옴표 뒤도 본다. 예: "위험지수 72 '높음'(예상)" → '음' · '…해역(232-2해구)' → '역'. @param {string} w @returns {string} [연계] ← josa */
function lastHangul(w) { let t = String(w); while (/\([^()]*\)\s*$/.test(t) && !/^\([^()]*\)\s*$/.test(t)) t = t.replace(/\([^()]*\)\s*$/, ''); const m = t.match(/[가-힣](?=[^가-힣]*$)/); return m ? m[0] : ''; }
/**
 * 받침에 맞춘 조사. 예: josa('협재해수욕장','은','는') → '은' · josa('비양도','은','는') → '는' · josa("…'높음'(예상)",'으로','로') → '으로' · 받침 ㄹ + 으로 → '로'(「…바람로」가 아니라 「…바람으로」 — ㅁ 받침은 으로)
 * @param {string} w @param {string} withB - 받침 있을 때 @param {string} noB - 없을 때 @returns {string} [연계] ← landAnalysis·seaAnalysis
 */
function josa(w, withB, noB) {
    const ch = lastHangul(w); if (!ch) return noB;
    const jong = (ch.charCodeAt(0) - 0xac00) % 28;
    if (!jong) return noB;
    return withB === '으로' && jong === 8 ? noB : withB;
}
/**
 * 문장 후보(우선순위 pri — 작을수록 먼저 남김)에서 MAX_ANALYSIS_S 개까지 남기고, 모자라면 filler 를 맨 앞에 넣어 MIN_ANALYSIS_S 개를 채운 뒤 원래 순서대로 잇는다.
 * 예: joinSentences([{t:'A.',pri:0},{t:'B.',pri:9},{t:'C.',pri:1}], 'F.') → 'A. B. C.' · 후보가 두 개뿐이면 'F. A. C.'
 * @param {object[]} cands - [{t, pri}] (원래 순서) @param {string|null} filler @returns {string} [연계] ← landAnalysis·seaAnalysis
 */
function joinSentences(cands, filler) {
    const keep = new Set(cands.map((c, i) => [c.pri, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, MAX_ANALYSIS_S).map((x) => x[1]));
    const out = cands.filter((c, i) => keep.has(i)).map((c) => c.t);
    if (out.length < MIN_ANALYSIS_S && filler) out.unshift(filler);
    return out.join(' ');
}
/**
 * 연안 규칙 분석(3~5문장). 예(한림 고정 자료):
 *   "협재해수욕장은 연안 위험지수 72 '높음'(예상)으로 주의 수준이며, 오늘 바뀐 요소는 방문객 평소의 1.8배(예상)·해안 바람 9m/s(예상, 튜브·물놀이기구 떠밀림 주의)입니다.
 *    협재해수욕장 주변에는 위험구역 4곳·2020~2024년 연안사고 6건(표류 4) 기록이 있어 오늘 연안 상황 변화에 유의해야 합니다. 금능해수욕장은 관심 수준입니다.
 *    따라서 협재해수욕장 주변 연안사고에 주의가, 금능해수욕장 주변 연안사고에 관심이 요구됩니다."
 *   관심 이상 없음 → '오늘 관할 관광지 4곳에서 평소와 달라진 요소(방문객·행사·너울·이안류·특보·바람)가 확인되지 않았습니다. 상시 위험 장소로 한림항 등이 있습니다. 따라서 관할 연안사고에 평소처럼 관심이 요구됩니다.'
 * @param {object} b - buildBriefing 중간 결과 @param {string} dw - 오늘|내일 @returns {string|null} 해상만 관할이면 null [연계] ← ruleAnalysis
 */
function landAnalysis(b, dw) {
    const land = b.land; if (!land) return null;
    const lt = land.overviewTop || [], miss = land.missing.length ? sourceNames(land.missing) : null, c = [];
    const missS = miss ? { t: '확인하지 못한 자료(' + miss + ')는 판단에서 뺐습니다.', pri: 3 } : null;
    if (!lt.length) {
        c.push({ t: dw + ' 관할 관광지 ' + land.reviewedSpots + '곳에서 ' + (miss ? '확인된 자료로는 ' : '') + '평소와 달라진 요소(방문객·행사·너울·이안류·특보·바람)가 확인되지 않았습니다.', pri: 0 });
        const cs = land.constant.slice(0, 3).map((x) => x.name), cn = cs.join('·') + (land.constant.length > 3 ? ' 등' : '');
        c.push({ t: cs.length ? '상시 위험 장소로 ' + cn + josa(cn, '이', '가') + ' 있습니다.' : '관할에 연결된 관광지·위험구역 자료가 없습니다.', pri: 2 });
        if (missS) c.push(missS);
        c.push({ t: '따라서 관할 연안사고에 평소처럼 관심이 요구됩니다.', pri: 1 });
        return joinSentences(c, null);
    }
    const top = lt[0], src = /^연안 위험지수/.test(String(top.sourceLabel || '')) ? top.sourceLabel + '(예상)' : String(top.sourceLabel || '');
    const changes = (top.today.changes || []).map((t, i) => expectText((top.today.kinds || [])[i], t));
    c.push({ t: top.name + josa(top.name, '은', '는') + ' ' + (src ? src + josa(src, '으로', '로') + ' ' : '') + top.word + ' 수준이며, ' + dw + ' 바뀐 요소는 ' + (changes.length ? changes.join('·') + '입니다.' : '없습니다.'), pri: 0 });
    const tr = top.traits || {}, hz = tr.hazard && tr.hazard.count ? '위험구역 ' + tr.hazard.count + '곳' : null;
    const h = tr.history, hist = h && h.count ? (h.from && h.to ? h.from.slice(0, 4) + '~' + h.to.slice(0, 4) + '년 ' : '') + '연안사고 ' + h.count + '건' + (h.topTypes && h.topTypes[0] ? '(' + h.topTypes[0].type + ' ' + h.topTypes[0].count + ')' : '') : null;
    if (hz || hist) c.push({ t: top.name + ' 주변에는 ' + [hz, hist].filter(Boolean).join('·') + ' 기록이 있어 ' + dw + ' 연안 상황 변화에 유의해야 합니다.', pri: 2 });
    for (const r of [3, 2, 1]) {
        const ns = lt.slice(1).filter((x) => x.rank === r).map((x) => x.name); if (!ns.length) continue;
        const nm = ns.join('·'); c.push({ t: nm + josa(nm, '은', '는') + ' ' + WORD[r] + ' 수준입니다.', pri: 4 });
    }
    if (Number(land.attentionSpots) > lt.length) c.push({ t: '그 밖에 평소보다 위험이 높아진 관광지가 ' + (land.attentionSpots - lt.length) + '곳 더 있습니다.', pri: 5 });
    if (missS) c.push(missS);
    const groups = [3, 2, 1].map((r) => [r, lt.filter((x) => x.rank === r).map((x) => x.name)]).filter(([, ns]) => ns.length);
    c.push({ t: '따라서 ' + groups.map(([r, ns]) => ns.join('·') + ' 주변 연안사고에 ' + SUBJECT[r]).join(', ') + ' 요구됩니다.', pri: 1 });   // 화면 (권고) 줄 — §11.10.16 「요구됩니다」
    return joinSentences(c, '관할 관광지 ' + land.reviewedSpots + '곳 중 평소보다 위험이 높아진 곳은 ' + (Number.isFinite(land.attentionSpots) ? land.attentionSpots : lt.length) + '곳입니다.');
}
// ── 바다 상태 말(2026-10-17 사용자 결정 — 설계서 §11.10.9) ──
// 원문 *"그냥 기준내용 빼고 잔잔한 바다일것으로 예상된다는 식으로 하면될것같은데? 다른것도 풍속, 파고별 어떤식으로 표출될지 기준마련 필요"* — 분석 문단(규칙·AI)에서 「기준(파고 2m·풍속 12m/s)보다 낮을」을 빼고
// 대해구 예보의 최대 파고·최대 풍속을 아래 표로 말로 바꾼다. 표의 경계값은 **사용자 확정 2026-10-17 — 원문 「좋아.」**(설계서 §11.10.9 근거: 기상청 단기 전망 글 「8~13m/s로 강하게」·「9~15m/s로 매우 강하게」·
// 「1.0~2.5m로 높게」·「1.5~3.0m로 높게 … 풍랑특보가 발표될 가능성」 — 고정 자료 jeju_bulletin_20261017.txt, 저장소 분석 「파고3m↑ 또는 풍속14↑」 — accident_analysis/tables.md:380.
// 「다소 높음」·「다소 강함」 칸의 경계(1.0m·8m/s)는 우리가 고른 값). 값을 바꿀 때는 이 객체만 고치고 RULES_VERSION 을 올린다.
// lt = 이 값 미만이면 그 칸. stem·end = 말 조각(「물결이 높고 바람이 강할 것으로 예상됩니다」 — 앞 축은 stem+'고', 마지막 축은 end).
const SEA_STATE = Object.freeze({
    wave: [{ lt: 1.0, word: '낮음', stem: '낮', end: '낮을', rise: null }, { lt: 2.0, word: '다소 높음', stem: '다소 높', end: '다소 높을', rise: '다소 높아지' }, { lt: 3.0, word: '높음', stem: '높', end: '높을', rise: '높아지' }, { lt: Infinity, word: '매우 높음', stem: '매우 높', end: '매우 높을', rise: '매우 높아지' }],
    wind: [{ lt: 8, word: '약함', stem: '약하', end: '약할', rise: null }, { lt: 11, word: '다소 강함', stem: '다소 강하', end: '다소 강할', rise: '다소 강해지' }, { lt: 14, word: '강함', stem: '강하', end: '강할', rise: '강해지' }, { lt: Infinity, word: '매우 강함', stem: '매우 강하', end: '매우 강할', rise: '매우 강해지' }],
    calm: '잔잔한 바다일 것으로 예상됩니다',
    // §11.10.13 해역 카드 흐름 문장(seaStateFlow)의 말 조각 — 칸 경계값은 위 그대로(사용자 확정), 말만 더했다. rise = 그 칸으로 오를 때 · fall = 내릴 때(칸 상관없이) · calmTo = 둘 다 첫 칸으로 내릴 때.
    fall: { wave: '낮아지', wind: '약해지' }, calmTo: '잔잔해지',
});
/**
 * 최대 파고·풍속을 바다 상태 말로(SEA_STATE). 둘 다 첫 칸(낮음·약함)이면 「잔잔한 바다일 것으로 예상됩니다」, 아니면 첫 칸이 아닌 축만 말한다. 한 축 자료가 없으면 있는 축만.
 * 예: (0.8, 4.8) → {wave:'낮음', wind:'약함', phrase:'잔잔한 바다일 것으로 예상됩니다'} · (2.4, 13) → {…, phrase:'물결이 높고 바람이 강할 것으로 예상됩니다'}
 *     (1.2, 5) → '물결이 다소 높을 것으로 예상됩니다' · (0.5, 15) → '바람이 매우 강할 것으로 예상됩니다' · (null, 5) → '바람이 약할 것으로 예상됩니다'
 * @param {number|null} wh - 최대 파고(m) @param {number|null} ws - 최대 풍속(m/s) @returns {object|null} {wave, wind, phrase} — 둘 다 없으면 null
 * [연계] ← haeguSentence / 표: SEA_STATE
 */
function seaStateOf(wh, ws) {
    const pick = (list, v) => (Number.isFinite(v) && v >= 0 ? list.find((x) => v < x.lt) : null);
    const a = pick(SEA_STATE.wave, wh), b = pick(SEA_STATE.wind, ws);
    if (!a && !b) return null;
    const calmA = !a || a === SEA_STATE.wave[0], calmB = !b || b === SEA_STATE.wind[0];
    let phrase;
    if (a && b && calmA && calmB) phrase = SEA_STATE.calm;
    else {
        const parts = [a && (!calmA || !b) ? ['물결이 ', a] : null, b && (!calmB || !a) ? ['바람이 ', b] : null].filter(Boolean);
        phrase = parts.map((x, i) => x[0] + (i < parts.length - 1 ? x[1].stem + '고' : x[1].end)).join(' ') + ' 것으로 예상됩니다';
    }
    return { wave: a ? a.word : null, wind: b ? b.word : null, phrase };
}
/**
 * 해역 카드 [기상 예보] 바다 상태 흐름 한 문장(2026-10-17 사용자 결정 — 설계서 §11.10.13). 「기준」이라는 말은 쓰지 않는다.
 * 원문 *"두번째 줄은 기상을 표현하되, 기준 부분은 위와 같이 생략하고, 향후 기상이 많이 변한다면 예보상 0시를 기점으로 기상이 점차 안좋아져 … 기상의 변화를 알려주는 게 좋지 않을까?"*
 * 규칙(3시간 칸마다 SEA_STATE 칸 — 파고 칸·풍속 칸):
 *   ① 자료가 있는 첫 칸의 상태 s0 와 처음으로 상태가 달라지는 칸 k 를 찾는다(두 칸 모두 값이 있는 축끼리만 견준다).
 *   ② k 가 없으면(창 내내 같은 칸): 「최대 파고 Xm·풍속 Ym/s로 {seaStateOf(최대) 말}({label} 예보).」
 *   ③ k 가 있으면: 「{k 바로 앞 칸}까지 {s0}다가 {k}부터 {바뀜} 것으로 예상됩니다(최대 파고 Xm·풍속 Ym/s, {label} 예보).」
 *      {s0} = 둘 다 첫 칸(낮음·약함)이면 「잔잔하」, 아니면 첫 칸이 아닌 축만(seaStateOf 와 같은 고르기 — 「물결이 높고 바람이 강하」).
 *      {바뀜} = k 에서 오른 축이 하나라도 있으면: 창 최대 칸이 s0 보다 높은 축마다 그 최대 칸의 rise(「물결이 다소 높아지」·「바람이 강해지」) + k 에서 내린 축은 fall(「낮아지」·「약해지」).
 *               오른 축이 없으면: k 가 둘 다 첫 칸이면 「잔잔해지」, 아니면 내린 축의 fall.
 *      처음 바뀌는 칸만 말한다 — 그 뒤 다시 바뀌는 것은 말하지 않고, 창 최대값을 괄호에 둔다.
 * 예: 18·21시 0.1m·7.5m/s → '최대 파고 0.1m·풍속 7.5m/s로 잔잔한 바다일 것으로 예상됩니다(대해구 174 예보).'
 *     21시 0.4m·6m/s, 0시 1.6m·12m/s → '21시까지 잔잔하다가 0시부터 물결이 다소 높아지고 바람이 강해질 것으로 예상됩니다(최대 파고 1.6m·풍속 12m/s, 대해구 174 예보).'
 *     15시 2.4m·9m/s, 18시 0.8m·6m/s → '15시까지 물결이 높고 바람이 다소 강하다가 18시부터 잔잔해질 것으로 예상됩니다(최대 파고 2.4m·풍속 9m/s, 대해구 174 예보).'
 * @param {object[]} rows - [{at,wh,ws}] 칸 순서(값 없는 칸은 weatherFlow 가 이미 뺌) @param {string} label - 「대해구 174」 @param {string} targetDate @returns {string|null}
 * [연계] ← weatherFlow(stateText) → seaSection 카드 today.forecast → 화면 [기상 예보] · AI 입력 해역 evidence
 */
function seaStateFlow(rows, label, targetDate) {
    const idx = (list, v) => (Number.isFinite(v) && v >= 0 ? list.findIndex((x) => v < x.lt) : null);
    const st = (rows || []).map((r) => ({ r, a: idx(SEA_STATE.wave, r.wh), b: idx(SEA_STATE.wind, r.ws) })).filter((q) => q.a !== null || q.b !== null);
    if (!st.length) return null;
    const top = (k) => { const v = st.map((q) => q.r[k]).filter((x) => Number.isFinite(x) && x >= 0); return v.length ? Math.max(...v) : null; };
    const mwh = top('wh'), mws = top('ws'), src = label + ' 예보';
    const vals = '최대 ' + [mwh !== null ? '파고 ' + mwh + 'm' : null, mws !== null ? '풍속 ' + mws + 'm/s' : null].filter(Boolean).join('·');
    const s0 = st[0], k = st.findIndex((q) => (q.a !== null && s0.a !== null && q.a !== s0.a) || (q.b !== null && s0.b !== null && q.b !== s0.b));
    if (k < 0) return vals + '로 ' + seaStateOf(mwh, mws).phrase + '(' + src + ').';
    const hh = (r) => dayPrefix(r.at, targetDate) + Number(r.at.slice(11, 13)) + '시', q = st[k];
    // s0 말 — seaStateOf 와 같은 고르기(둘 다 첫 칸이면 잔잔, 아니면 첫 칸이 아닌 축만, 한 축만 있으면 그 축)
    const calmA = s0.a === null || s0.a === 0, calmB = s0.b === null || s0.b === 0;
    const p0 = s0.a !== null && s0.b !== null && calmA && calmB ? null : [s0.a !== null && (!calmA || s0.b === null) ? '물결이 ' + SEA_STATE.wave[s0.a].stem : null, s0.b !== null && (!calmB || s0.a === null) ? '바람이 ' + SEA_STATE.wind[s0.b].stem : null].filter(Boolean);
    const before = p0 ? p0.join('고 ') + '다가' : '잔잔하다가';
    const upA = q.a !== null && s0.a !== null && q.a > s0.a, upB = q.b !== null && s0.b !== null && q.b > s0.b;
    const downA = q.a !== null && s0.a !== null && q.a < s0.a, downB = q.b !== null && s0.b !== null && q.b < s0.b;
    const ma = idx(SEA_STATE.wave, mwh), mb = idx(SEA_STATE.wind, mws);
    let parts;
    if (upA || upB) parts = [ma !== null && s0.a !== null && ma > s0.a ? '물결이 ' + SEA_STATE.wave[ma].rise : downA ? '물결이 ' + SEA_STATE.fall.wave : null, mb !== null && s0.b !== null && mb > s0.b ? '바람이 ' + SEA_STATE.wind[mb].rise : downB ? '바람이 ' + SEA_STATE.fall.wind : null].filter(Boolean);
    else parts = q.a === 0 && q.b === 0 ? [SEA_STATE.calmTo] : [downA ? '물결이 ' + SEA_STATE.fall.wave : null, downB ? '바람이 ' + SEA_STATE.fall.wind : null].filter(Boolean);
    const change = parts.map((x, i) => (i < parts.length - 1 ? x + '고' : x.slice(0, -1) + '질')).join(' ');
    return hh(st[k - 1].r) + '까지 ' + before + ' ' + hh(q.r) + '부터 ' + change + ' 것으로 예상됩니다(' + vals + ', ' + src + ').';
}
/** 해구 이름에 특보구역을 붙인다. 예: {label:'대해구 75', where:'경북북부앞바다'} → '경북북부앞바다(대해구 75)' · where 없음 → '대해구 75'. @param {object} w - weatherFlow 결과 @returns {string} [연계] ← haeguSentence · station_briefing_ai.stationInput */
function haeguPlace(w) { return w.where ? w.where + '(' + w.label + ')' : w.label; }
/**
 * 대해구 예보 한 문장 — 위치(haeguPlace) + 최대 파고·풍속 + 바다 상태 말(seaStateOf). 「기준」이라는 말은 쓰지 않는다(§11.10.9). 높아지는 시각이 있으면(onsetAt — 해상 단계 규칙 WAVE_M·WIND_MS 를 넘는 첫 칸) 그 흐름을 앞에.
 * 예: {label:'대해구 75', where:'경북북부앞바다', max:{wh:0.8,ws:4.8}} → '경북북부앞바다(대해구 75)는 최대 파고 0.8m·풍속 4.8m/s로 잔잔한 바다일 것으로 예상됩니다.'
 *     {label:'대해구 232', where:'…', onsetText:'15시부터 파고 2.4m·풍속 13m/s', downText:'21시부터', max:{wh:2.4,ws:13}} → '…(대해구 232)는 15시부터 파고 2.4m·풍속 13m/s로 높아지고 21시부터 낮아지며, 최대 파고 2.4m·풍속 13m/s로 물결이 높고 바람이 강할 것으로 예상됩니다.'
 * @param {object} w - weatherFlow 결과(where 는 seaSection 이 붙임 — 옛 브리핑은 없음) @returns {string|null} [연계] ← seaAnalysis · station_briefing_ai.stationInput(AI 입력 sea.weather·haegu_forecasts)
 */
function haeguSentence(w) {
    if (!w || !w.max) return null;
    const wh = w.max.wh >= 0 ? w.max.wh : null, ws = w.max.ws >= 0 ? w.max.ws : null, st = seaStateOf(wh, ws);
    if (!st) return null;
    const hp = haeguPlace(w), vals = '최대 ' + [wh !== null ? '파고 ' + wh + 'm' : null, ws !== null ? '풍속 ' + ws + 'm/s' : null].filter(Boolean).join('·');
    const flow = w.onsetAt ? (w.onsetText || '') + '로 높아지' + (w.downText ? '고 ' + w.downText + ' 낮아지' : '') + '며, ' : '';
    return hp + josa(hp, '은', '는') + ' ' + flow + vals + '로 ' + st.phrase + '.';
}
/**
 * 해상 규칙 분석(3~5문장). 예(높아지는 시각 없음 · 특이사항 있음 · 위험 해역 없음):
 *   '○○앞바다(대해구 5099)는 최대 파고 0.4m·풍속 6.9m/s로 잔잔한 바다일 것으로 예상됩니다. 다만, 기상청 단기 전망에 「오늘 오후부터 …」 내용이 있어 해상 상황의 변화를 살펴야 합니다.
 *    따라서 마산파출소 관할 해상의 바람과 물결 변화에 평소처럼 관심이 요구됩니다.'(결론 「평소 수준」일 때 — 결론이 관심 이상인데 해역이 없으면 「평소처럼」 없이)
 *   높아지는 시각이 있으면 '제주도서부앞바다(대해구 232)는 15시부터 파고 2.4m·풍속 13m/s로 높아지고 21시부터 낮아지며, 최대 파고 2.4m·풍속 13m/s로 물결이 높고 바람이 강할 것으로 예상됩니다.' + 첫 해역 단계 + 「따라서 15~24시 … 해역 운항에 주의가 요구됩니다.」
 *   (§11.10.9 — 해구 문장은 haeguSentence: 특보구역 이름은 그 대해구에 든 이 관할 해역의 특보구역(weatherFlow.where), 없으면 「대해구 232」만 · 「기준」이라는 말 없이 바다 상태 말(SEA_STATE). 예시의 구역 이름은 꼴만 보인 것)
 * @param {object} b @param {object} S - 지금까지 만든 summary(weather 특이사항) @param {string} dw @returns {string} [연계] ← ruleAnalysis
 */
function seaAnalysis(b, S, dw) {
    const sea = b.sea, top = sea.overviewTop || [], miss = sea.missing.length ? sourceNames(sea.missing) : null, c = [], w = sea.weather;
    const oCount = Number.isFinite(sea.overviewRegions) ? sea.overviewRegions : sea.attentionRegions, total = Number.isFinite(sea.reviewedRegions) ? sea.reviewedRegions : sea.reviewedCells;
    // §11.10.9(2026-10-17 사용자 *"대해구 75가 어딘지 모르겠고"* · *"그냥 기준내용 빼고 잔잔한 바다일것으로 예상된다는 식으로"*): 위치 + 최대값 + 바다 상태 말(haeguSentence) — 「기준」 없음
    const hs = haeguSentence(w), below = !!hs && !w.onsetAt;
    if (hs) c.push({ t: hs, pri: 0 });
    else if (!w && !sea.missing.includes('zoneForecasts')) c.push({ t: '해구 예보 자료를 확인하지 못했습니다.', pri: 0 });
    const note = S && S.weather && Array.isArray(S.weather.notes) ? S.weather.notes[0] : null;
    if (note) c.push({ t: (below ? '다만,' : '또한') + ' 기상청 단기 전망에 「' + note + '」 내용이 있어 해상 상황의 변화를 살펴야 합니다.', pri: 3 });
    if (top[0]) { const nm = top[0].overview.window + ' ' + top[0].name, lbl = overviewLabelText(top[0].overview); c.push({ t: nm + josa(nm, '은', '는') + ' ' + lbl + josa(lbl, '으로', '로') + ' ' + top[0].overview.word + ' 수준입니다.', pri: 2 }); }
    if (oCount > 1) c.push({ t: '그 밖에 위험이 높아진 해역이 ' + (oCount - 1) + '칸 더 있습니다.', pri: 6 });
    const sp = [b.special.find((x) => x.kind === 'release' || x.kind === 'released'), b.special.find((x) => x.kind === 'prewarn')].filter(Boolean).map((x) => x.title);
    if (sp.length) c.push({ t: '기상특보 소식: ' + sp.join(', ') + '.', pri: 5 });
    if (miss) c.push({ t: '확인하지 못한 자료(' + miss + ')는 판단에서 뺐습니다.', pri: 4 });
    // 「다만,」(쉼표 — §11.10.16 사용자 *"다만 다음에는 ,를 붙여줘"*) · 마지막 문장(화면 (권고) 줄) 끝 「요구됩니다」(§11.10.16)
    const fin = top[0] ? top[0].overview.window + ' ' + String(top[0].name).replace(/\([^()]*해구\)$/, '') + ' 운항에 ' + SUBJECT[top[0].overview.rank] + ' 요구됩니다.'
        : miss ? '출항 전 기상청 특보·예보를 직접 확인하는 데 관심이 요구됩니다.' : b.station.name + ' 관할 해상의 바람과 물결 변화에 ' + (sea.overviewLevel.rank ? '' : '평소처럼 ') + '관심이 요구됩니다.';   // 결론 「평소 수준」이면 연안과 같이 「평소처럼 관심」(§11.10.5 독립 검토 8)
    c.push({ t: '따라서 ' + fin, pri: 1 });
    return joinSentences(c, dw + ' 관할 해역 ' + total + '칸 중 ' + (miss ? '확인된 자료 기준 ' : '') + '위험이 높아진 해역은 ' + oCount + '칸입니다.');
}
/**
 * 규칙 분석 문단 묶음 — {land, sea}. 예: ruleAnalysis(b, summary) → {land:'협재해수욕장은 … 따라서 … 요구됩니다.', sea:'대해구 232 예보는 … 따라서 … 요구됩니다.'}
 * @param {object} b @param {object} S - summary(weather 포함) @returns {object} [연계] ← buildSummary / 화면: station_briefing_render.js(AI 분석이 없을 때 「규칙 분석」)
 */
function ruleAnalysis(b, S) { const dw = dayWordOf(b); return { land: landAnalysis(b, dw), sea: seaAnalysis(b, S, dw) }; }
/**
 * 브리핑의 「총평과 권고」 서버 결론 묶음. 예: buildSummary(b, wx, win) → {weather:{zone,rows,source,notes,…}|null, tide:[…], isolation:{text,link,rows,caption}|null, land:{headline,basis,advice}|null, sea:{headline,basis,advice,area,detail}, analysis:{land,sea}(규칙 분석 문단 — §11.10.4)}
 *   순서(§11.10.1): 결론(육상·해상) → (기상) → (물때) → 육상 근거·권고 → 해상 근거·권고 → AI 해설. wx·win 이 없으면(옛 브리핑 다시 계산) weather 는 null.
 * @param {object} b - buildBriefing 중간 결과(station·sea·land·special·tide·generatedAt·targetDate) @param {object} [wx] - 관할 기상 입력 @param {object} [win] - editionWindow
 * @returns {object} [연계] ← buildBriefing · station_briefing_ai.stationInput(옛 브리핑에 summary 가 없을 때)
 */
function buildSummary(b, wx, win) { const dw = dayWordOf(b), S = { weather: win ? weatherSummary(b, wx, win) : null, tide: b.tide ? b.tide.text.slice() : [], rocks: rocksSummary(b), isolation: isolationSummary(b), land: landSummary(b, dw), sea: seaSummary(b, dw) }; S.analysis = ruleAnalysis(b, S); return S; }
/**
 * (물때) 「관할 내 잠기는 바위(간출암) N곳이 …」 줄의 링크 재료(2026-10-17 사용자 결정 §11.10.10 — 원문 *"그 간출암 두 곳 그 부분에 하이퍼링크를 걸어서 누르면 그 바위 두 곳이 어디에 있는지 지도에 표출 …
 * 그 바위 마커를 누르면 우리 해양안전생활에서 위험지형에 저 간출암을 누르면 시간대에 따라 팝업으로 언제 잠기고 … 별도의 박스로 정보를 제공하잖아. 거기까지 제공될 수 있도록"*).
 * line = summary.tide 의 몇째 줄인지 · link = 그 줄 안 링크 글 · rows = 바위 하나하나 {id(hazard_rocks.json properties.id — 위험지형 팝업이 쓰는 같은 번호), lat, lon, v(간출 높이 m), times(그날 잠기는 시각)}.
 * 화면은 이 값만 쓴다(바위를 스스로 찾지 않는다). 바위 목록이 없으면(옛 수집 결과·잠기는 바위 없음) null — 글만 남는다.
 * 예: {tide:{text:['…', '관할 내 잠기는 바위(간출암) 2곳이 02:40~16:41 사이 …'], rocks:{count:2,link:'잠기는 바위(간출암) 2곳',items:[…2]}}} → {line:1, link:'잠기는 바위(간출암) 2곳', rows:[…2]}
 * @param {object} b - buildBriefing 중간 결과 @returns {object|null} [연계] ← buildSummary / 화면: station_briefing_render.js tidePart(rocksLine — 팝업 지도·HazardRockTidePanel)
 */
function rocksSummary(b) {
    const r = b.tide && b.tide.rocks, line = r && r.link ? b.tide.text.findIndex((t) => t.includes(r.link)) : -1;
    return line >= 0 ? { line, link: r.link, rows: r.items.map((x) => ({ id: x.id, lat: x.lat, lon: x.lon, v: x.v ?? null, times: (x.times || []).slice() })) } : null;
}
/**
 * (물때) 아래 「(고립 주의)」 한 줄과 고립 사고 지점 표(2026-10-17 사용자 결정 §11.10.3 — 원문 *"이 부분은 사고 지점(#개소) 확인 및 주의가 필요합니다. 로 하고 사고지점을 하이퍼링크로 해서
 * 누르면 아래로 아코디언이 펼쳐지며 "지점명 | 발생 건수"로 표를 만들어서 표출하는게 좋겠어."* · *"고립사고 지점표는 모두 보여줘"*).
 * 지점 = 육상이 검토하는 같은 관광지 목록(land.isolation — 수가 육상 근거와 맞게) 중 고립 사고가 있는 곳 전부. 저조 = 그 판 창 안의 저조 시각(tide.lows).
 * 해상만 관할(land 없음)·조석 칸이 없는 관할(동해 등 — (물때) 칸이 없다)·고립 지점이 없으면 null(줄을 넣지 않음).
 * 예: {land:{isolation:[{name:'도시해녀',count:1},…5곳], isolationPeriod:{from:'2020-01-01',to:'2024-12-31'}}, tide:{lows:['08:16','22:09']}}
 *     → {text:'(고립 주의) 저조 시간(08:16·22:09) 전후 과거 고립 사고(5개소 6건)으로 확인 및 주의가 필요합니다.', link:'과거 고립 사고(5개소 6건)', lows:['08:16','22:09'], total:6,
 *        head:['지점명','발생 현황'], rows:[{name:'도시해녀',count:2,years:{2022:1,2023:1},status:'22년(1건), 23년(1건)'},…], caption:'2020~2024 연안사고 기록 중 고립(관광지 구역 + 앞바다 500m)'}
 *   (§11.10.3 의 「사고 지점(N개소) 확인 및 …」·「지점명 | 발생 건수」는 §11.10.10 에서 바뀌었다)
 * @param {object} b - buildBriefing 중간 결과 @returns {object|null} [연계] ← buildSummary / 화면: station_briefing_render.js tidePart((물때) 칸 — 「과거 고립 사고(N개소 M건)」 버튼 → 표) / → yearStatus
 */
function isolationSummary(b) {
    const rows = b.land && Array.isArray(b.land.isolation) ? b.land.isolation : [];
    if (!rows.length || !b.tide) return null;
    // §11.10.10(2026-10-17 사용자 *"과거 사고지점(10개소) 보다는 과거 고립 사고(0개소 0건)으로 확인 및 주의가 필요합니다. 라고 … 하이퍼링크는 "과거 고립 사고(0개소 0건)" 여기에"*):
    //   링크 글 「과거 고립 사고(N개소 M건)」(N = 지점 수, M = 그 지점들의 고립 사고 합) + 사용자 말 그대로 「으로 확인 및 주의가 필요합니다.」
    const lows = Array.isArray(b.tide.lows) ? b.tide.lows : [], total = rows.reduce((a, r) => a + (Number(r.count) || 0), 0), link = '과거 고립 사고(' + rows.length + '개소 ' + total + '건)', p = b.land.isolationPeriod;
    return {
        text: '(고립 주의) ' + (lows.length ? '저조 시간(' + lows.join('·') + ') 전후 ' : '') + link + '으로 확인 및 주의가 필요합니다.', link, lows, total,
        head: ['지점명', '발생 현황'], rows: rows.map((r) => ({ name: r.name, count: r.count, years: r.years || null, status: yearStatus(r) })),
        caption: (p ? p.from.slice(0, 4) + '~' + p.to.slice(0, 4) + ' ' : '') + '연안사고 기록 중 고립(관광지 구역 + 앞바다 500m)',
    };
}
/**
 * 고립 사고 지점 표 「발생 현황」 칸 글 — 연도 오름차순, 1건 이상인 해만, 두 자리 연도(2026-10-17 사용자 *"22년 괄호 열고 몇 건, 컴마 23년 괄호 열고 몇 건 …"* — §11.10.10).
 * 연도를 모르는 기록('미상')은 끝에 「연도 미상(N건)」. 연도별 수가 없는 옛 입력이면 합만 「N건」.
 * 예: {count:4, years:{2024:1, 2022:1, 2023:2}} → '22년(1건), 23년(2건), 24년(1건)' · {count:2, years:null} → '2건'
 * @param {object} r - land.isolation 한 줄 {count, years} @returns {string} [연계] ← isolationSummary
 */
function yearStatus(r) {
    const y = r && r.years && typeof r.years === 'object' ? r.years : null;
    if (!y) return (Number(r && r.count) || 0) + '건';
    const known = Object.keys(y).filter((k) => /^\d{4}$/.test(k) && y[k] > 0).sort();
    return known.map((k) => k.slice(2) + '년(' + y[k] + '건)').concat(y['미상'] > 0 ? ['연도 미상(' + y['미상'] + '건)'] : []).join(', ');
}
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
    RULES_VERSION, WORD, SEA_ONLY_OFFICES, seaBadges, CONG_COLOR_RANK, RELEASE_LINES, WAVE_M, WIND_MS, EDITIONS, SOURCE_LABEL, UNKNOWN_SOME, UNKNOWN_ALL, AFTER_RELEASE_SEA_H, AFTER_RELEASE_LAND_H,
    isoKst, kstDate, md, editionWindow, publishAtFor, nextPublishAt, ruleAnalysis, landAnalysis, seaAnalysis, josa, SEA_STATE, seaStateOf, seaStateFlow, seaHistoryRow, haeguPlace, haeguSentence, raisedTable, MIN_ANALYSIS_S, MAX_ANALYSIS_S, runsText, levelWord, sourceNames, dueEdition, displayDate, rangeText, warnTimeText, issuedText, warnAtSlot, slotOf, regionName, weatherFlow,
    warningEvents, seaSection, landSpot, landSection, tideSection, buildSummary, isolationSummary, rocksSummary, yearStatus, komsaLine, komsaPhrase, summaryLines, weatherSlotsFor, bulletinNotes, bulletinScan, pickNotes, zoneHit, shortList, weatherSummary, periodText, stripMarkup, expectText, buildBriefing, stable, hash, zoneKey, topicJosa, haversineKm, dayWordOf,
};
