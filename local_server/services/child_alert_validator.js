/**
 * [자식해역 사용자 원칙 검증]
 *
 * 사용자 원칙: "부모해역 특보 없이 자식해역 단독 발효 불가"
 *
 * 자식해역 status 가 "Y" 가 되려면 부모해역 current 가 발효 중이어야 한다.
 * 통보문 도착 시 + 수동 수정 시 모두 이 검증을 거친다.
 *
 * 관련 정책: policy/02_SUBREGION_DISPLAY.md §1, policy/07_MANUAL_EDIT_UI.md §3-3
 */
'use strict';

/**
 * 자식해역 상태 변경이 사용자 원칙에 부합하는지 검증
 *
 * @param {object} args
 *   - args.parentCurrent: 부모해역의 current 객체 (또는 null)
 *   - args.targetChildStatus: 자식해역에 적용하려는 새 status ("Y" | null | "EXCLUDED" | "PENDING")
 *
 * @returns {{ allowed: boolean, reason?: string, correctedStatus?: string }}
 */
function validateChildStatus({ parentCurrent, targetChildStatus }) {
    // 자식이 미발효(null) 또는 EXCLUDED 또는 예비(PENDING) 로 가는 건 항상 허용
    if (!targetChildStatus || targetChildStatus === null) {
        return { allowed: true };
    }
    if (targetChildStatus === 'EXCLUDED') {
        return { allowed: true };
    }
    if (targetChildStatus === 'PENDING') {
        // 예비 상태는 부모 current 무관하게 가능 (upcoming 상태)
        return { allowed: true };
    }

    // "Y" 활성 전환 시도 — 부모 current 반드시 활성이어야 함
    if (targetChildStatus === 'Y') {
        if (!parentCurrent || parentCurrent === null) {
            return {
                allowed: false,
                reason: '부모해역이 발효 중이 아니므로 자식해역 단독 발효 불가',
                correctedStatus: null   // 자식 status null 로 강제 보정 권장
            };
        }
        return { allowed: true };
    }

    // 알 수 없는 상태
    return {
        allowed: false,
        reason: `알 수 없는 자식 status: ${targetChildStatus}`
    };
}

/**
 * 일괄 수정 검증 — 여러 자식해역에 같은 status 를 적용할 때
 *
 * @param {object} args
 *   - args.parentCurrent: 부모 current
 *   - args.targetChildStatus: 적용할 새 status
 *   - args.children: 자식해역 이름 배열
 *
 * @returns {{ allowedChildren: string[], blockedChildren: string[], reason?: string }}
 */
function validateBulkChildStatus({ parentCurrent, targetChildStatus, children }) {
    const v = validateChildStatus({ parentCurrent, targetChildStatus });
    if (v.allowed) {
        return { allowedChildren: children.slice(), blockedChildren: [] };
    }
    // 모두 차단됨 (부모 발효 안 됨 등 케이스)
    return {
        allowedChildren: [],
        blockedChildren: children.slice(),
        reason: v.reason
    };
}

/**
 * 부모 해제 시 자식 강제 처리 — 모든 자식 status null
 *
 * @param {object} children — 부모해역의 children 객체
 * @returns {object} 강제 해제 처리된 children 객체
 */
function cascadeParentRelease(children) {
    if (!children || typeof children !== 'object') return children;
    const result = {};
    for (const [name, child] of Object.entries(children)) {
        if (child && typeof child === 'object') {
            result[name] = {
                ...child,
                status: null,
                lastUpdated: new Date().toISOString(),
                cascadedBy: 'parent_release'
            };
        } else {
            // 구 형식 (단순 "Y"/null 값) 처리
            result[name] = null;
        }
    }
    return result;
}

module.exports = {
    validateChildStatus,
    validateBulkChildStatus,
    cascadeParentRelease
};
