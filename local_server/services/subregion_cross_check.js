/**
 * [자식해역 Dual Validation 교차 검증]
 *
 * AI 파서(ai_report_parser.js)와 정규식 파서(subregion_parser.js)의 결과를 비교하여
 * 불일치 시 관리자에게 푸시 알림 발송 + 정규식 결과를 신뢰값으로 채택.
 *
 * 비교 기준:
 *   - AI: events[i].zones 안에 자식해역명이 들어있는가 (잘못 들어간 케이스)
 *   - 정규식: extractChildrenFromBody 결과
 *
 * 정책 06_ADMIN_PUSH_POLICY.md 케이스 ③.
 */
'use strict';

const subregionAdminPush = require('./subregion_admin_push');
const subregionNormalizer = require('./subregion_normalizer');

/**
 * AI 출력 zones 에서 자식해역 후보 추출
 * (AI 가 hallucination 으로 자식 이름을 zones 에 잘못 넣은 경우 감지)
 *
 * AI 는 정상적으로는 부모해역(앞바다·먼바다)만 zones 에 넣어야 함.
 * 자식해역 키워드(연안바다·평수구역)가 zones 에 있으면 hallucination 의심.
 */
function extractAiSuspectedChildren(events) {
    const suspected = new Set();
    if (!Array.isArray(events)) return suspected;
    for (const ev of events) {
        if (!ev.zones || !Array.isArray(ev.zones)) continue;
        for (const zone of ev.zones) {
            if (typeof zone !== 'string') continue;
            // 자식해역 키워드가 들어있고 부모해역으로 인식되지 않으면 자식 의심
            if (/(연안바다|평수구역)/.test(zone) && !subregionNormalizer.isKnownParent(zone)) {
                suspected.add(zone);
            }
        }
    }
    return suspected;
}

/**
 * 정규식 결과에서 자식해역 이름 집합 추출
 */
function extractRegexChildren(childrenInfo) {
    const set = new Set();
    if (!Array.isArray(childrenInfo)) return set;
    for (const c of childrenInfo) {
        if (c.child) set.add(c.child);
    }
    return set;
}

/**
 * 부모해역별로 자식 정보 그룹핑
 */
function groupChildrenByParent(childrenInfo) {
    const map = {};
    if (!Array.isArray(childrenInfo)) return map;
    for (const c of childrenInfo) {
        if (!map[c.parent]) map[c.parent] = [];
        map[c.parent].push(c.child);
    }
    return map;
}

/**
 * 교차 검증 메인 함수
 *
 * @param {object} args
 *   - args.reportId — 통보문 ID
 *   - args.stn — 광역 코드
 *   - args.aiEvents — AI 파서 events 배열
 *   - args.regexChildren — 정규식 파서 자식해역 배열
 *
 * @returns {{ matched: boolean, aiOnly: string[], regexOnly: string[] }}
 */
function crossCheck({ reportId, stn, aiEvents, regexChildren }) {
    const aiSet = extractAiSuspectedChildren(aiEvents);
    const regexSet = extractRegexChildren(regexChildren);

    const aiOnly = [...aiSet].filter(c => !regexSet.has(c));
    const regexOnly = [...regexSet].filter(c => !aiSet.has(c));

    // 양쪽이 완전 일치하면 OK
    if (aiOnly.length === 0 && regexOnly.length === 0) {
        return { matched: true, aiOnly: [], regexOnly: [] };
    }

    // 불일치 — 정책 06 케이스 ③ 발송
    // 부모해역별로 묶어서 발송 (스팸 방지)
    const regexByParent = groupChildrenByParent(regexChildren);
    const parents = Object.keys(regexByParent);

    // AI 만 추출된 자식(hallucination 의심) 발송
    if (aiOnly.length > 0) {
        // 정확한 parent 추정이 어려우므로 첫 통보문 부모 사용
        const parentGuess = parents[0] || '(미상)';
        subregionAdminPush.sendCrossCheckMismatch({
            reportId,
            stn,
            parentRegion: parentGuess,
            aiChildren: [...aiSet],
            regexChildren: [...regexSet]
        });
    } else if (regexOnly.length > 0) {
        // 정규식만 추출, AI 누락 → 정규식 신뢰. 알림만
        const parentGuess = parents[0] || '(미상)';
        subregionAdminPush.sendCrossCheckMismatch({
            reportId,
            stn,
            parentRegion: parentGuess,
            aiChildren: [...aiSet],
            regexChildren: [...regexSet]
        });
    }

    return { matched: false, aiOnly, regexOnly };
}

/**
 * 본문 파싱 직후 호출되는 entry point
 *
 * @param {object} args
 *   - args.reportId
 *   - args.stn
 *   - args.aiParsed: ai_report_parser 의 결과 객체 (data, children 포함)
 *
 * @returns 검증 결과
 */
function runCrossCheck({ reportId, stn, aiParsed }) {
    try {
        const aiEvents = aiParsed.data || [];
        const regexChildren = aiParsed.children || [];

        // 본문에 자식해역 명시가 있을 때만 의미 있는 검증
        if (regexChildren.length === 0
            && !extractAiSuspectedChildren(aiEvents).size) {
            // 양쪽 모두 자식해역 없음 — 정상
            return { matched: true };
        }

        return crossCheck({ reportId, stn, aiEvents, regexChildren });
    } catch (e) {
        console.error('[subregion_cross_check] 검증 오류:', e.message);
        return { matched: true, error: e.message };
    }
}

module.exports = {
    runCrossCheck,
    crossCheck,
    extractAiSuspectedChildren,
    extractRegexChildren
};
