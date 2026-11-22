'use strict';
/**
 * ============================================================================
 * 파일명: local_server/config/zone_split.js
 * 역할  : 기상청 해상 특보구역 개편(2026-11-26)의 「언제부터·무엇이 무엇으로」를 한 군데에 둔다.
 *         「제주도남쪽바깥먼바다」 1개가 동경 126°17'40" 선을 경계로
 *         「제주도남서쪽바깥먼바다」(서쪽)·「제주도남동쪽바깥먼바다」(동쪽) 2개로 나뉜다(구역 44 → 45).
 *         서버는 미리 배포해 두고, 이 파일의 시각(2026-11-26 00:00 KST)이 되면 스스로 갈아탄다.
 * 사용자 확정 2026-11-22(원문):
 *   「위 내용은 모두 26일자부터 자동 적용될 수 있도록 설계해야해. 당장 오늘부터 위처럼 작동하도록 만드는게 아니라.」
 *   「제주도남쪽바깥먼바다는 이제 제주도남서쪽바깥먼바다와 제주도남동쪽바깥먼바다로 구분되고 이 두구역 모두 해당되는 경우에서는
 *     제주도남쪽바깥먼바다라고 칭하면 두구역 모두 해당되는 것으로 보아야 함.」
 *   「제주도먼바다라고 표현하는 경우에도 … 총 4구역이 모두 포함」 · 「제주도전해상의 경우 앞바다와 위 제주도먼바다 모든 해역이 모두 포함」
 *   「푸시는 26일부터는 보내지 말것. 인덱스 페이지 메인화면과, 특보구역(해양종합정보탭에서) 대해서만 표출」 — 이 두 구역(옛 이름 포함)에만 해당, 다른 구역 푸시는 정상.
 *   「26일부터는 … 통보문 mmis가 아닌 통보문 기준으로 표출」 — 이 두 구역만. 나머지는 MMIS.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : 없음
 *  - 서버 API      : 없음
 *  - 나를 쓰는 곳  : marine_warning_crawler(구역 뼈대·MMIS 값 버림·통보문 값 끼움) · push_sender(푸시 차단) ·
 *                   analysis/bulletin_survey/lifecycle_check(통보문 해역 해석) · config/zone_group_map(묶음 사전) ·
 *                   services/push_helpers(구독 계층) · routes/weather(/api/warn-zones 분할본) · 검사 test_zone_split
 *  - 화면 쪽 짝    : client/js/core/zone_split.js (같은 시각·같은 이름 — 둘을 함께 고친다)
 *  - 환경변수      : ZONE_SPLIT_AT — 전환 시각을 바꾼다(ISO 시각. 스테이징에서 미리 보거나, 기상청이 미루면 늦추려고). 없으면 2026-11-26T00:00:00+09:00.
 * [로드 순서] 없음(서버 모듈)
 * ============================================================================
 */
const OLD = '제주도남쪽바깥먼바다';
const NEW_WEST = '제주도남서쪽바깥먼바다';
const NEW_EAST = '제주도남동쪽바깥먼바다';
const NEW = [NEW_WEST, NEW_EAST];
const DEFAULT_AT = '2026-11-26T00:00:00+09:00';
const AT_MS = (() => {
    const env = process.env.ZONE_SPLIT_AT;
    const ms = env ? Date.parse(env) : NaN;
    if (env && isNaN(ms)) console.warn('[구역 분할] ZONE_SPLIT_AT 을 못 읽어 기본 시각을 쓴다:', env);
    return isNaN(ms) ? Date.parse(DEFAULT_AT) : ms;
})();
let _forced = null;   // 검사용 — true/false 로 고정, null 이면 시계를 본다

const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, '');

/**
 * 지금 새 구역 기준인가.
 * 예: isActive(Date.parse('2026-11-25T23:59:00+09:00')) → false · isActive(Date.parse('2026-11-26T00:00:00+09:00')) → true
 * @param {number} [nowMs] 기준 시각(ms). 없으면 지금.
 * @returns {boolean}
 * [연계] ← 이 파일을 쓰는 모든 곳 — 26일 전에는 종전과 똑같이 동작하게 하려고 매번 묻는다(서버를 다시 켜지 않아도 자정에 바뀐다)
 */
function isActive(nowMs) {
    if (_forced !== null) return _forced;
    return (nowMs == null ? Date.now() : nowMs) >= AT_MS;
}

/**
 * 구역 이름 목록에서 옛 이름을 새 두 이름으로 바꾼다(전환 뒤에만. 순서 유지·중복 없음).
 * 예: splitNames(['제주도남쪽바깥먼바다', '제주도남동쪽안쪽먼바다']) → ['제주도남서쪽바깥먼바다', '제주도남동쪽바깥먼바다', '제주도남동쪽안쪽먼바다']
 * @param {Iterable<string>} names
 * @returns {string[]} 전환 전이면 그대로(복사본)
 * [연계] ← lifecycle_check.expand · zone_group_map · push_helpers — 「제주도남쪽바깥먼바다 = 두 구역 모두」를 한 규칙으로
 */
function splitNames(names) {
    const list = [...names];
    if (!isActive()) return list;
    const out = [];
    for (const n of list) for (const x of (n === OLD ? NEW : [n])) if (!out.includes(x)) out.push(x);
    return out;
}

/**
 * 이 구역의 푸시를 막아야 하나 — 전환 뒤의 옛 이름·새 두 이름.
 * 예: (26일 이후) isPushBlocked('제주도 남서쪽 바깥먼바다') → true · isPushBlocked('제주도남동쪽안쪽먼바다') → false
 * @param {string} zone 구역 이름(띄어쓰기 무관)
 * @returns {boolean}
 * [연계] ← push_sender.processAndSendNotifications · marine_warning_crawler.run — 이 두 구역 푸시는 별도 검토 뒤 연다(사용자 확정)
 */
function isPushBlocked(zone) {
    if (!isActive()) return false;
    const z = norm(zone);
    return z === OLD || NEW.includes(z);
}

/**
 * 특보 푸시 묶음(payload.items)에서 막을 구역을 뺀다 — 그 구역만 빼고, 구역이 하나도 안 남은 묶음은 버린다.
 * 예: (26일 이후) [{zones:['제주도남부앞바다','제주도남쪽바깥먼바다']}, {zones:['제주도남서쪽바깥먼바다']}] → {items:[{zones:['제주도남부앞바다']}], cut:2}
 * @param {Array<{zones?: string[]}>} items
 * @returns {{items: Array, cut: number}} cut = 뺀 구역 수(0 이면 items 는 받은 그대로)
 * [연계] ← routes/push.js POST /api/push-custom 의 특보 묶음 분기 — 자동·재시도·관리자 「발송」 버튼이 모두 지나는 곳
 */
function filterPushItems(items) {
    if (!Array.isArray(items) || !isActive()) return { items, cut: 0 };
    let cut = 0;
    const out = [];
    for (const it of items) {
        if (!it || !Array.isArray(it.zones)) { out.push(it); continue; }
        const kept = it.zones.filter((z) => !isPushBlocked(z));
        cut += it.zones.length - kept.length;
        if (kept.length) out.push(kept.length === it.zones.length ? it : Object.assign({}, it, { zones: kept }));
    }
    return { items: cut ? out : items, cut };
}

/** 이 구역이 분할 대상(옛 이름·새 두 이름)인가 — 전환 여부와 무관. 예: isSplitZone('제주도남쪽바깥먼바다') → true */
function isSplitZone(zone) { const z = norm(zone); return z === OLD || NEW.includes(z); }

/** 검사용: 전환 여부를 고정한다(true/false), null 이면 다시 시계를 본다. [연계] ← test_zone_split 등 */
function _forceForTest(v) { _forced = (v === true || v === false) ? v : null; }

module.exports = { OLD, NEW, NEW_WEST, NEW_EAST, AT_MS, isActive, splitNames, isPushBlocked, filterPushItems, isSplitZone, _forceForTest };
