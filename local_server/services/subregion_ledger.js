/**
 * [자식해역 장부 헬퍼]
 *
 * weather_alerts.json 의 children 값을 단순 "Y"/null 에서 객체로 마이그레이션하면서
 * 하위 호환성을 유지하기 위한 헬퍼 모음.
 *
 * 자식해역 값의 두 가지 형식:
 *   (구식) "Y"  또는 null
 *   (신식) { status, tmFc, tmEf, tmCc, wrnTp, wrnLvl, source, sourceReportId, lastUpdated }
 *
 * 관련 정책: policy/02_SUBREGION_DISPLAY.md §3
 */
'use strict';

/**
 * 자식해역 값에서 status 추출. 객체/문자열/null 모두 처리.
 *
 * @param {*} child — children[childName] 의 값
 * @returns {"Y" | null | "EXCLUDED" | "PENDING"}
 */
function getChildStatus(child) {
    if (child === null || child === undefined) return null;
    if (typeof child === 'string') {
        // legacy: "Y" 또는 다른 문자열
        return child;
    }
    if (typeof child === 'object') {
        return child.status || null;
    }
    return null;
}

/**
 * 자식해역 값이 객체 형식인가
 */
function isChildObject(child) {
    return child !== null && typeof child === 'object';
}

/**
 * 시각 형식이 정확형인지 (YYYY년 MM월 DD일 HH시 MM분) 판단
 * 범위형(예: "밤(21시~24시)") 은 false 반환.
 */
function isExactTime(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return false;
    // "YYYY년 MM월 DD일 HH시 MM분" 패턴
    return /\d{4}년\s*\d{1,2}월\s*\d{1,2}일\s*\d{1,2}시\s*\d{1,2}분\s*$/.test(timeStr);
}

/**
 * 시각 단조성 검증 — 이전 시각이 정확형이고 새 시각이 범위형이면 위반
 *
 * @returns {{ violated: boolean, reason?: string }}
 */
function checkMonotonicity(prevTmEf, newTmEf) {
    if (!prevTmEf || !newTmEf) return { violated: false };
    if (prevTmEf === newTmEf) return { violated: false };
    if (isExactTime(prevTmEf) && !isExactTime(newTmEf)) {
        return {
            violated: true,
            reason: `이전 정확형(${prevTmEf}) → 새 범위형(${newTmEf}) — 시간상 뒤로 가는 갱신`
        };
    }
    return { violated: false };
}

/**
 * 자식해역 값을 객체 형식으로 변환 (기존 정보 보존)
 *
 * @param {*} existingChild — 현재 children[childName] 값
 * @param {object} updates — 적용할 새 정보
 *   - status, source, sourceReportId, wrnTp, wrnLvl, tmFc, tmEf, tmCc
 * @param {object} [opts]
 *   - opts.violationCallback: 시각 단조성 위반 시 호출되는 콜백 (시각 위반 알림용)
 *   - opts.parentRegion / opts.childRegion: 콜백 인자
 *
 * @returns {object|null} — 객체 또는 null (status === null 일 때)
 */
function makeChildObject(existingChild, updates = {}, opts = {}) {
    const base = isChildObject(existingChild) ? { ...existingChild } : {};
    const merged = { ...base, ...updates };

    // status === null 이면 null 반환 (장부에 null 로 저장)
    if (merged.status === null || merged.status === undefined) {
        return null;
    }

    // [시각 단조성 검증 — 정책 06 케이스 ⑧]
    //   이전 자식 객체에 tmEf 가 있고 새 tmEf 와 비교했을 때 단조성 위반이면
    //   콜백으로 알림. 적용은 강제하지 않음 (정정 가능성 고려).
    if (isChildObject(existingChild) && existingChild.tmEf && updates.tmEf
        && opts.violationCallback) {
        const monoCheck = checkMonotonicity(existingChild.tmEf, updates.tmEf);
        if (monoCheck.violated) {
            try {
                opts.violationCallback({
                    parentRegion: opts.parentRegion,
                    childRegion: opts.childRegion,
                    previousTmEf: existingChild.tmEf,
                    newTmEf: updates.tmEf,
                    reason: monoCheck.reason
                });
            } catch (e) {
                console.error('[subregion_ledger] violationCallback 오류:', e.message);
            }
        }
    }

    // 기본 메타 채움
    merged.lastUpdated = new Date().toISOString();
    return merged;
}

/**
 * 부모 시각 변경 시 inherit 자식들 자동 갱신
 *
 * [활용 예정]
 *   현재 정규 흐름은 weather_alerts_crawler.js 의 mapDataToForm 이
 *   매 사이클 inherit 자식을 새로 만들어 덮어쓰므로 결과적으로 동일 효과.
 *   본 함수는 그 외 경로 (부모 수동 수정 후 자식 일괄 동기화 등) 에서 활용.
 *
 * @param {object} parentCurrent — 부모해역의 current 객체 (wrnTp/wrnLvl/tmFc/tmEf/tmCc)
 * @param {object} children — 부모의 children 객체
 * @returns {object} 갱신된 children (mutation 안 함)
 */
function syncInheritChildren(parentCurrent, children) {
    if (!children || typeof children !== 'object') return children;
    if (!parentCurrent) return children;

    const result = {};
    const now = new Date().toISOString();
    for (const [name, child] of Object.entries(children)) {
        if (isChildObject(child) && child.source === 'inherit' && child.status === 'Y') {
            // 부모 시각 그대로 상속
            result[name] = {
                ...child,
                wrnTp: parentCurrent.wrnTp || child.wrnTp,
                wrnLvl: parentCurrent.wrnLvl || child.wrnLvl,
                tmFc: parentCurrent.tmFc || child.tmFc,
                tmEf: parentCurrent.tmEf || child.tmEf,
                tmCc: parentCurrent.tmCc || child.tmCc,
                lastUpdated: now
            };
        } else if (child === 'Y' && parentCurrent) {
            // 구 형식 'Y' → 객체로 마이그레이션하면서 부모 상속
            result[name] = {
                status: 'Y',
                source: 'inherit',
                wrnTp: parentCurrent.wrnTp || null,
                wrnLvl: parentCurrent.wrnLvl || null,
                tmFc: parentCurrent.tmFc || null,
                tmEf: parentCurrent.tmEf || null,
                tmCc: parentCurrent.tmCc || null,
                lastUpdated: now
            };
        } else {
            // 그 외는 그대로 보존
            result[name] = child;
        }
    }
    return result;
}

/**
 * 부모 해제 시 모든 자식 강제 null (source 무관)
 */
function cascadeRelease(children) {
    if (!children || typeof children !== 'object') return children;
    const result = {};
    for (const name of Object.keys(children)) {
        result[name] = null;
    }
    return result;
}

/**
 * 자식해역 변화 감지 — prev vs curr 비교
 * status 가 달라지면 변화로 본다.
 *
 * [활용 예정]
 *   현재 자식해역 변화는 통보문 파싱 시점에서 직접 감지(extractChildrenFromBody)
 *   하여 케이스 ①·② 푸시로 처리됨. 본 함수는 detectChanges (부모) 와 짝이 되는
 *   자식 차원의 변화 감지 — 후속 운영 모니터링 단계에서 활용 (격상/격하·연장 추적용).
 *
 * @returns {Array<{ childName, prevStatus, currStatus, changeType }>}
 */
function detectChildChanges(prevChildren, currChildren) {
    const changes = [];
    const allNames = new Set([
        ...Object.keys(prevChildren || {}),
        ...Object.keys(currChildren || {})
    ]);
    for (const name of allNames) {
        const pStatus = getChildStatus((prevChildren || {})[name]);
        const cStatus = getChildStatus((currChildren || {})[name]);
        if (pStatus !== cStatus) {
            let changeType = 'OTHER';
            if (!pStatus && cStatus === 'Y') changeType = 'ACTIVATED';
            else if (pStatus === 'Y' && !cStatus) changeType = 'DEACTIVATED';
            else if (cStatus === 'EXCLUDED') changeType = 'EXCLUDED';
            else if (pStatus === 'EXCLUDED' && cStatus === 'Y') changeType = 'INCLUDED';
            changes.push({ childName: name, prevStatus: pStatus, currStatus: cStatus, changeType });
        }
    }
    return changes;
}

module.exports = {
    getChildStatus,
    isChildObject,
    makeChildObject,
    syncInheritChildren,
    cascadeRelease,
    detectChildChanges,
    isExactTime,
    checkMonotonicity
};
