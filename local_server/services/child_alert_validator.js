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

// [제거 — 중복 함수]
// cascadeParentRelease 는 subregion_ledger.cascadeRelease 와 중복 기능이었으나
// 호출처 0건으로 dead code. ledger 의 단순 null 적용 방식이 표준.
// 자세한 메타 보존은 lastUpdated/cascadedBy 등 별도 추가 시 활용 가능.

module.exports = {
    validateChildStatus,
    validateBulkChildStatus
};
