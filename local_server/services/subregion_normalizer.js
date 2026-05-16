/**
 * [자식해역 명칭 정규화 유틸리티]
 *
 * 앱과 통보문의 자식해역 명칭 표기가 다르므로 (`[부모]중[자식]` vs `[부모]([자식])`),
 * 공통 정규화 키 `(부모이름, 자식짧은이름)` 튜플로 변환하여 매칭에 사용한다.
 *
 * 관련 정책: policy/03_CODE_FIXES.md §4
 */
'use strict';

const fs = require('fs');
const path = require('path');

const CATALOG_PATH = path.join(__dirname, '..', 'data', 'subregion_catalog.json');

// ============================================================================
// 카탈로그 로드 (lazy)
// ============================================================================
let _catalog = null;
function getCatalog() {
    if (_catalog) return _catalog;
    try {
        _catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
    } catch (e) {
        console.error('[SubregionNormalizer] 카탈로그 로드 실패:', e.message);
        _catalog = { parents: {}, deprecated: [] };
    }
    return _catalog;
}

// ============================================================================
// 앱 명칭 ↔ 정규화 키 변환
// ============================================================================

/**
 * 앱 명칭 → (부모, 자식) 튜플
 * 예: "제주도서부앞바다중북서연안바다" → ["제주도서부앞바다", "북서연안바다"]
 *
 * 알고리즘:
 * - 카탈로그의 부모해역 이름들 중에서 prefix 가 일치하는 가장 긴 것을 찾는다.
 * - 그 prefix 뒤를 "중" 으로 시작하면 "중" 을 제거하고 자식 이름으로 사용한다.
 * - 매칭 실패 시 [appName, null] 반환.
 */
function normalizeAppName(appName) {
    if (!appName || typeof appName !== 'string') return [null, null];
    const catalog = getCatalog();
    const parents = Object.keys(catalog.parents || {});

    // 부모 이름이 긴 것부터 매칭해야 부분 매칭 충돌 방지 (예: "경남서부남해앞바다" vs "남해앞바다")
    const sortedParents = parents.sort((a, b) => b.length - a.length);

    // 1) 가장 일반적 — "[부모]중[자식]" 또는 "[부모][자식]" prefix 매칭
    for (const parent of sortedParents) {
        if (appName.startsWith(parent)) {
            let rest = appName.substring(parent.length);
            if (rest.startsWith('중')) rest = rest.substring(1);
            rest = rest.trim();
            if (rest.length === 0) return [parent, null];
            return [parent, rest];
        }
    }

    // 2) prefix 없는 단독 자식해역 (예: "천수만평수구역") — 카탈로그 자식 목록에서 검색
    // 공백 무시하고 매칭 (앱 "천수만평수구역" ↔ 카탈로그 "천수만 평수구역")
    const normalizedInput = appName.replace(/\s+/g, '');
    for (const parent of sortedParents) {
        const children = (catalog.parents[parent].children || []);
        for (const child of children) {
            if (child.replace(/\s+/g, '') === normalizedInput) {
                return [parent, child];
            }
        }
    }

    return [appName, null];
}

/**
 * 통보문 명칭 → (부모, 자식들) 튜플
 * 예: "제주도서부앞바다(북서연안바다. 남서연안바다)" → ["제주도서부앞바다", ["북서연안바다", "남서연안바다"]]
 *
 * 마침표(.) 분리자로 자식 여러 개 처리. 공백 trim. EXCLUDED 여부는 별도 함수.
 */
function parseNoticeNotation(text) {
    if (!text) return [null, []];
    // "[부모해역명](자식들)" 매칭
    const m = text.match(/^([가-힣A-Za-z·\s0-9]+?앞바다|[가-힣A-Za-z·\s0-9]+?먼바다)\s*\(([^)]+)\)/);
    if (!m) return [text.trim(), []];

    const parent = m[1].trim();
    const inside = m[2];

    // 마침표(.)로 자식 분리 (5년 CSV 검증된 분리자)
    const children = inside.split('.')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !/^제외$/.test(s));

    return [parent, children];
}

/**
 * 통보문 안 EXCLUDED 자식해역 추출 (P1 패턴)
 * 예: "(북서연안바다 제외)" → ["북서연안바다"]
 * 예: "(북서연안바다 . 남서연안바다 제외)" → ["북서연안바다", "남서연안바다"]
 */
function parseExclusion(text) {
    if (!text) return [];
    const m = text.match(/\(([^)]+?)\s*제외\s*\)/);
    if (!m) return [];
    return m[1].split('.')
        .map(s => s.trim())
        .filter(s => s.length > 0);
}

// ============================================================================
// 카탈로그 조회 — 부모/자식 유효성 검증
// ============================================================================

/**
 * 부모해역이 카탈로그에 등록되어 있고 자식해역을 가지는가
 */
function isKnownParent(parentName) {
    const catalog = getCatalog();
    return !!catalog.parents[parentName];
}

/**
 * 부모해역의 자식 목록을 반환 (없으면 빈 배열)
 */
function getChildrenOf(parentName) {
    const catalog = getCatalog();
    return (catalog.parents[parentName] && catalog.parents[parentName].children) || [];
}

/**
 * 자식해역명이 해당 부모해역의 자식 카탈로그에 있는가
 */
function isKnownChild(parentName, childName) {
    const children = getChildrenOf(parentName);
    return children.includes(childName);
}

/**
 * 폐지된 자식해역명인가 (영덕연안바다 등)
 */
function isDeprecated(name) {
    const catalog = getCatalog();
    return (catalog.deprecated || []).some(d => d.name === name);
}

/**
 * 정규화 비교 — appName 과 (noticeParent, noticeChild) 가 같은 자식해역을 가리키는가
 */
function isSameSubregion(appName, noticeParent, noticeChild) {
    const [appParent, appChild] = normalizeAppName(appName);
    return appParent === noticeParent && appChild === noticeChild;
}

// ============================================================================
// 풀네임 생성 (앱 표기)
// ============================================================================
/**
 * 부모·자식 → 앱 풀네임
 * 예: ("제주도서부앞바다", "북서연안바다") → "제주도서부앞바다중북서연안바다"
 */
function makeAppFullName(parent, child) {
    if (!parent) return null;
    if (!child) return parent;
    return `${parent}중${child}`;
}

module.exports = {
    normalizeAppName,
    parseNoticeNotation,
    parseExclusion,
    isKnownParent,
    isKnownChild,
    isDeprecated,
    isSameSubregion,
    getChildrenOf,
    makeAppFullName
};
