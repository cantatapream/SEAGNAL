/**
 * [자식해역 정규식 파서]
 *
 * 통보문 본문에서 자식해역(연안바다·평수구역) 단위 정보를 추출한다.
 * 5년치 CSV(2021~2026) 분석에서 도출된 P1·P2 패턴 기반.
 *
 * - P1 (제외): "○○앞바다(○○연안바다 제외)" — 자식해역이 부모에서 제외 (status=EXCLUDED)
 * - P2 (단독·다중 명시): "○○앞바다(○○연안바다)" 또는 "○○앞바다(자식1.자식2)"
 *
 * AI 파서(ai_report_parser.js)와 함께 Dual Validation 으로 사용.
 *
 * 관련 정책: policy/02_SUBREGION_DISPLAY.md, policy/06_ADMIN_PUSH_POLICY.md
 */
'use strict';

const normalizer = require('./services/subregion_normalizer');

// ============================================================================
// 정규식 — 본문에서 부모해역(자식들) 패턴 매칭
// ============================================================================

// "[부모해역명](괄호 안 내용)" — 부모는 "앞바다" 또는 "먼바다" 로 끝남
// 괄호 안에 연안바다·평수구역 키워드가 있는 경우만
const PARENT_PAREN_RE = /([가-힣·\s0-9]+?(?:앞바다|먼바다))\s*\(\s*([^)]*?(?:연안바다|평수구역)[^)]*?)\s*\)/g;

// "[N] [종류][주의보/경보/예비특보] [동사] :" — 발효시각 컬럼 패턴
// 동사: 발표 / 발효 / 해제 / 변경 / 연장 (취소·정정·대치는 5년치 0건)
const EVENT_HEADER_RE = /\((\d+)\)\s*([가-힣]+(?:주의보|경보|예비특보))\s*(발표|발효|해제|변경|연장)/g;

// ============================================================================
// 자식해역 추출 — 단일 통보문 본문 분석
// ============================================================================

/**
 * 통보문 본문에서 자식해역 정보를 추출한다.
 *
 * @param {string} body — 통보문 본문 텍스트 (HTML 제거됨)
 * @param {object} [opts]
 *   - opts.eventContext: 동사·종류 컨텍스트 ('풍랑주의보 발효' 등)
 *
 * @returns {Array<{
 *   parent: string,
 *   child: string,
 *   excluded: boolean,
 *   wrnTp?: string,
 *   action?: string,
 *   matched: string
 * }>}
 */
function extractChildrenFromBody(body, opts = {}) {
    if (!body || typeof body !== 'string') return [];
    const results = [];

    // 모든 "부모(자식들)" 매칭 시도
    let m;
    PARENT_PAREN_RE.lastIndex = 0;
    while ((m = PARENT_PAREN_RE.exec(body)) !== null) {
        const parent = m[1].trim();
        const inside = m[2];

        // 카탈로그에 없는 부모면 skip (또는 신규 명칭 — 별도 알림 대상이지만 여기서는 무시)
        // 단, isKnownParent 가 false 라도 통보문에 자식해역 명시가 있으므로 추출은 시도
        // → 신규 명칭 감지는 cross_check 모듈에서 별도 알림

        // 1) 제외(EXCLUDED) 패턴 분리
        // 예: "북서연안바다 제외" 또는 "북서연안바다. 남서연안바다 제외"
        const exclusionMatch = inside.match(/^(.+?)\s*제외\s*$/);
        if (exclusionMatch) {
            const excludedParts = exclusionMatch[1]
                .split('.')
                .map(s => s.trim())
                .filter(s => s.length > 0);
            for (const child of excludedParts) {
                // 자식해역명이 카탈로그에 있어야 정식 자식으로 인정
                if (/(연안바다|평수구역)/.test(child)) {
                    results.push({
                        parent,
                        child: child.replace(/\s+/g, ' '),
                        excluded: true,
                        matched: m[0]
                    });
                }
            }
            continue;
        }

        // 2) 단독·다중 명시 패턴 (P2)
        // 예: "북서연안바다" 또는 "북서연안바다. 남서연안바다"
        // 단, "(자식1. 자식2 제외)" 같은 혼합 케이스는 위 정규식이 잡음 (제외만 처리)
        const parts = inside
            .split('.')
            .map(s => s.trim())
            .filter(s => s.length > 0);

        for (const part of parts) {
            // "자식 제외" 가 한 부분에 있으면 그 부분 자식만 EXCLUDED
            const partExclusionMatch = part.match(/^(.+?)\s*제외\s*$/);
            if (partExclusionMatch) {
                const excludedName = partExclusionMatch[1].trim();
                if (/(연안바다|평수구역)/.test(excludedName)) {
                    results.push({
                        parent,
                        child: excludedName,
                        excluded: true,
                        matched: m[0]
                    });
                }
            } else if (/(연안바다|평수구역)/.test(part)) {
                results.push({
                    parent,
                    child: part.replace(/\s+/g, ' '),
                    excluded: false,
                    matched: m[0]
                });
            }
        }
    }

    return results;
}

// ============================================================================
// 예비특보 자연어 해제 검출 (참고사항 절)
// ============================================================================

/**
 * "발표 가능성이 낮[아어]져 해제(합니다|하나)" 패턴 검출.
 * [예비] 통보문(kind=pwn)의 참고사항 절에서만 사용.
 *
 * @returns {Array<{ region, kind, detectedPhrase }>}
 */
const PRELIM_CANCEL_NATURAL_RE =
    /(?<region>[가-힣.·\s()0-9~]+?)의?\s*(?<kind>[가-힣]+)\s*예비\s*특보(?:는)?\s*발표\s*가능성이\s*낮[아어]져\s*해제(?:합니다|하나)/g;

function extractPrelimNaturalCancel(referenceBlock) {
    if (!referenceBlock) return [];
    const results = [];
    let m;
    PRELIM_CANCEL_NATURAL_RE.lastIndex = 0;
    while ((m = PRELIM_CANCEL_NATURAL_RE.exec(referenceBlock)) !== null) {
        results.push({
            region: m.groups.region.trim(),
            kind: m.groups.kind.trim(),
            detectedPhrase: m[0]
        });
    }
    return results;
}

// ============================================================================
// 풍랑예비특보 해제 (방식 B) 검출 — 정식 [특보] 통보문
// ============================================================================

const PRELIM_CANCEL_OFFICIAL_RE = /\(\d+\)\s*([가-힣]+)예비특보\s*해제/g;

function detectOfficialPrelimCancel(text) {
    if (!text) return [];
    const results = [];
    let m;
    PRELIM_CANCEL_OFFICIAL_RE.lastIndex = 0;
    while ((m = PRELIM_CANCEL_OFFICIAL_RE.exec(text)) !== null) {
        results.push({
            kind: m[1],
            matched: m[0]
        });
    }
    return results;
}

// ============================================================================
// HTML 엔티티 추가 디코딩 (안전망)
// ============================================================================

function decodeEntities(text) {
    if (!text) return text;
    return text
        .replace(/&middot;/g, '·')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#183;/g, '·')
        .replace(/&#xb7;/gi, '·');
}

module.exports = {
    extractChildrenFromBody,
    extractPrelimNaturalCancel,
    detectOfficialPrelimCancel,
    decodeEntities,
    // 정규식도 export (테스트·재사용)
    PARENT_PAREN_RE,
    EVENT_HEADER_RE,
    PRELIM_CANCEL_NATURAL_RE,
    PRELIM_CANCEL_OFFICIAL_RE
};
