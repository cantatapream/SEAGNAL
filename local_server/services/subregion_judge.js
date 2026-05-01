/**
 * [자식해역 종합 판정 서비스]
 *
 * 통보문 부모해역 상태 + 방재기상 응답을 입력으로 받아 자식해역의 최종
 * 상태를 판정하고 subregion_lifecycle.json 에 영속화합니다.
 *
 * LOGIC 14의 9단계 처리 순서를 그대로 구현:
 *   3.1 응답 건전성 검사 (afso_poller에서 이미 처리됨)
 *   3.2 통보문 건전성 검사
 *   3.3 부모 자동 해제 처리 + 자식 일괄 정리
 *   3.4 행 분류 (parent / child / empty / active)
 *   3.5 매핑 적용 (region_alias_map)
 *   3.6 캡 규칙 적용 (자식 ≤ 부모)
 *   3.7 사라짐 카운트 갱신 (1회/2회 빠짐)
 *   3.8 동시 사라짐 잠금 검사
 *   3.9 영속화
 *
 * 근거: 01_LOGIC/14_rule_order.md, 01_LOGIC/05~13 케이스 처리
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/server_config');

const LIFECYCLE_FILE = path.join(DATA_DIR, 'subregion_lifecycle.json');
const ALIAS_MAP_FILE = path.join(DATA_DIR, 'region_alias_map.json');

// 매핑 테이블 캐시
let aliasMapCache = null;
let aliasMapMtime = null;

/**
 * 매핑 테이블 로드 (mtime 기반 캐시)
 */
function loadAliasMap() {
    try {
        const stat = fs.statSync(ALIAS_MAP_FILE);
        if (aliasMapCache && stat.mtimeMs === aliasMapMtime) {
            return aliasMapCache;
        }
        aliasMapCache = JSON.parse(fs.readFileSync(ALIAS_MAP_FILE, 'utf8'));
        aliasMapMtime = stat.mtimeMs;
        return aliasMapCache;
    } catch (e) {
        console.error('[subregion_judge] aliasMap load error:', e.message);
        return null;
    }
}

/**
 * 라이프사이클 상태 로드
 */
function loadLifecycle() {
    try {
        return JSON.parse(fs.readFileSync(LIFECYCLE_FILE, 'utf8'));
    } catch (e) {
        return {
            schema_version: '1.0',
            lastUpdated: null,
            subregions: {},
            stats: { totalActive: 0, totalEstimated: 0, lastSuccessfulPoll: null }
        };
    }
}

/**
 * 라이프사이클 상태 원자적 저장
 */
function saveLifecycle(state) {
    state.lastUpdated = new Date().toISOString();
    const tmp = LIFECYCLE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, LIFECYCLE_FILE);
}

/**
 * 빈 행 판정
 */
function isEmptyRow(row) {
    return row.wrnSeq === '99' || (row.wrnTp === '' && row.wrnLvl === '');
}

/**
 * AFSO 시각 (YYYYMMDDHHMI) → ISO 문자열
 */
function parseAfsoTime(timeStr) {
    if (!timeStr || timeStr === '') return null;
    if (!/^\d{12}$/.test(timeStr)) return null;
    const y = timeStr.substring(0, 4);
    const mo = timeStr.substring(4, 6);
    const d = timeStr.substring(6, 8);
    const h = timeStr.substring(8, 10);
    const mi = timeStr.substring(10, 12);
    return `${y}-${mo}-${d}T${h}:${mi}:00+09:00`;
}

/**
 * 통보문 시각을 비교 가능한 timestamp 로 정규화
 * (현재는 단순 ISO 비교, 추후 통보문 시각 형식에 따라 보완)
 */
function timeToTimestamp(isoStr) {
    if (!isoStr) return null;
    try {
        return new Date(isoStr).getTime();
    } catch (e) {
        return null;
    }
}

/**
 * 자식 레벨 캡 적용 (LOGIC 13 §2)
 */
function applyLevelCap(childLvl, parentLvl) {
    if (parentLvl == null) return childLvl;
    if (childLvl > parentLvl) return parentLvl;
    return childLvl;
}

/**
 * 자식 시각 캡 적용 (LOGIC 13 §3)
 */
function applyTimeCap(childEnd, parentEnd) {
    const childT = timeToTimestamp(childEnd);
    const parentT = timeToTimestamp(parentEnd);
    if (childT == null || parentT == null) return childEnd;
    if (childT > parentT) return parentEnd;
    return childEnd;
}

/**
 * Step 3.4 — 행 분류
 */
function classifyRows(metData) {
    const result = { parents: [], children: [], empty: [] };
    for (const row of metData) {
        if (row.regId === row.regUp) {
            result.parents.push(row);
        } else if (isEmptyRow(row)) {
            result.empty.push(row);
        } else {
            result.children.push(row);
        }
    }
    return result;
}

/**
 * Step 3.5 — 매핑 적용 (parentRegId 변환 + 우리 앱 이름)
 */
function applyMapping(rows, aliasMap, recordError) {
    const mapped = [];
    for (const row of rows) {
        const childEntry = aliasMap.subregions[row.regId];
        if (!childEntry) {
            // 매핑 누락
            if (recordError) {
                recordError({
                    type: 'MAPPING_MISSING',
                    afsoRegId: row.regId,
                    afsoRegKo: (row.regKo || '').trim(),
                    parentRegId: row.regUp,
                    wrnTp: row.wrnTp,
                    wrnLvlName: row.wrnLvlName
                });
            }
            continue;
        }
        mapped.push({
            row: row,
            appName: childEntry.appRegKo,
            parentRegId: childEntry.parentRegId
        });
    }
    return mapped;
}

/**
 * 종합 판정 메인 함수
 *
 * @param {object} parentTongbomunState - 부모해역 통보문 상태 맵
 *   { [parentRegId]: { current: { wrnTp, wrnLvl, tmCc, ... } | null, ... } }
 *   (3단계에서는 빈 객체로 호출 가능; 5단계 통합 시 실제 데이터 전달)
 * @param {object} afsoResult - afso_poller.pollAfso() 결과
 * @param {function} recordError - 오류 기록 콜백 (선택, comparator 등에서 주입)
 * @returns {Promise<{ success: boolean, state: object, error: object | null }>}
 */
async function runJudgement(parentTongbomunState, afsoResult, recordError = null) {
    // Step 3.1: 응답 건전성 검사 (afso_poller가 이미 했음)
    if (!afsoResult || !afsoResult.success) {
        console.log('[subregion_judge] AFSO 응답 비정상 — 자식 상태 갱신 보류');
        return {
            success: false,
            state: loadLifecycle(),
            error: { type: 'AFSO_UNHEALTHY', detail: afsoResult ? afsoResult.error : null }
        };
    }

    const aliasMap = loadAliasMap();
    if (!aliasMap) {
        return {
            success: false,
            state: loadLifecycle(),
            error: { type: 'ALIAS_MAP_LOAD_ERROR' }
        };
    }

    const previousState = loadLifecycle();
    const newState = {
        schema_version: '1.0',
        lastUpdated: null,
        subregions: { ...previousState.subregions },
        stats: { ...previousState.stats }
    };

    // Step 3.2: 통보문 건전성 (호출 측에서 빈 객체 가능)
    const tongbomunHealthy = parentTongbomunState != null;

    // ============================================================
    // Step 3.3: 부모 자동 해제 연동 (LOGIC 11)
    // 통보문상 부모해역이 미발효(current=null)인데 lifecycle 자식이 활성이면
    // → 부모 자동 해제 시점에 자식도 함께 정리되어야 함 (고아 자식 방지)
    // ============================================================
    const now0 = new Date().toISOString();
    if (tongbomunHealthy) {
        for (const [regId, child] of Object.entries(newState.subregions)) {
            if (!child.current) continue;  // 이미 미발효
            const parentTb = parentTongbomunState[child.parentRegId];
            if (parentTb && parentTb.current == null) {
                // 부모 통보문 미발효 → 자식 일괄 정리
                console.log(`[subregion_judge] 부모 자동 해제 연동: ${child.regKoApp} (parent=${child.parentRegId})`);
                child.current = null;
                child.lastReleasedAt = now0;
                child.status = 'released';
                child.releaseReason = 'PARENT_AUTO_RELEASE';
            }
        }
    }

    // Step 3.4: 행 분류
    const classified = classifyRows(afsoResult.metData);

    // 응답에 등장한 자식의 regId 집합
    const respondedRegIds = new Set();
    for (const row of classified.children) respondedRegIds.add(row.regId);
    for (const row of classified.empty) respondedRegIds.add(row.regId);

    // Step 3.5: 매핑 적용
    const mappedActive = applyMapping(classified.children, aliasMap, recordError);
    const mappedEmpty = applyMapping(classified.empty, aliasMap, null); // 빈 행은 매핑 누락 로그 안 함

    const now = new Date().toISOString();

    // Step 3.6 + 신규 처리: 발효 행 처리 (캡 적용)
    for (const item of mappedActive) {
        const row = item.row;
        const parentTongbomun = parentTongbomunState[item.parentRegId];

        // 부모 통보문 상태가 알려져 있으면 캡 적용
        let cappedLvl = parseInt(row.wrnLvl) || null;
        let cappedTmEd = parseAfsoTime(row.tmEd);
        let estimationReason = null;
        let confidence = 'CONFIRMED';

        if (parentTongbomun && parentTongbomun.current) {
            const parentLvl = parentTongbomun.current.wrnLvl || null;
            const parentEnd = parentTongbomun.current.tmCc || null;

            const newCappedLvl = applyLevelCap(cappedLvl, parentLvl);
            const newCappedEnd = applyTimeCap(cappedTmEd, parentEnd);

            if (newCappedLvl !== cappedLvl) {
                estimationReason = 'LEVEL_CAPPED';
                confidence = 'WEAKLY_ESTIMATED';
                if (recordError) {
                    recordError({
                        type: 'LEVEL_CAP_APPLIED',
                        afsoRegId: row.regId,
                        appName: item.appName,
                        rawLvl: cappedLvl,
                        cappedLvl: newCappedLvl,
                        parentLvl: parentLvl
                    });
                }
                cappedLvl = newCappedLvl;
            }

            if (newCappedEnd !== cappedTmEd) {
                if (estimationReason === null) {
                    estimationReason = 'TIME_CAPPED';
                    confidence = 'WEAKLY_ESTIMATED';
                }
                if (recordError) {
                    recordError({
                        type: 'TIME_CAP_APPLIED',
                        afsoRegId: row.regId,
                        appName: item.appName,
                        rawEnd: cappedTmEd,
                        cappedEnd: newCappedEnd,
                        parentEnd: parentEnd
                    });
                }
                cappedTmEd = newCappedEnd;
            }
        }

        // 자식 상태 객체 빌드/갱신
        const prev = newState.subregions[row.regId];
        newState.subregions[row.regId] = {
            regId: row.regId,
            regKoApp: item.appName,
            regKoAfso: (row.regKo || '').trim(),
            parentRegId: item.parentRegId,
            current: {
                wrnTp: row.wrnTp,
                wrnLvl: cappedLvl,
                wrnLvlName: row.wrnLvlName,
                tmFc: parseAfsoTime(row.tmFc),
                tmEf: parseAfsoTime(row.tmEf),
                tmEd: cappedTmEd
            },
            rawFromAfso: {
                wrnLvl: parseInt(row.wrnLvl) || null,
                tmEd: parseAfsoTime(row.tmEd)
            },
            status: 'active',
            confidence: confidence,
            estimationReason: estimationReason,
            missedCount: 0,  // 정상 등장 → 카운터 리셋
            lastSeenAt: now,
            firstActivatedAt: prev ? prev.firstActivatedAt : now,
            lastReleasedAt: prev ? prev.lastReleasedAt : null,
            eventLabel: prev && prev.current ? prev.eventLabel : '발효됨',
            tmEdNote: null,
            history: prev ? (prev.history || []).slice(-50) : []
        };
    }

    // 빈 행 처리 — 즉시 해제 (LOGIC 05 §4)
    for (const item of mappedEmpty) {
        const row = item.row;
        const prev = newState.subregions[row.regId];
        if (prev && prev.current != null) {
            console.log(`[subregion_judge] 즉시 해제 (빈 행): ${item.appName}`);
            prev.current = null;
            prev.lastReleasedAt = now;
            prev.status = 'released';
        }
    }

    // Step 3.7: 사라짐 카운트 갱신 (응답에 행 자체가 없는 자식)
    for (const regId of Object.keys(newState.subregions)) {
        const child = newState.subregions[regId];
        if (!child.current) continue;  // 이미 미발효
        if (respondedRegIds.has(regId)) continue;  // 응답에 등장 (위에서 이미 처리)

        // 응답에 행 자체 없음 → missedCount 증가
        child.missedCount = (child.missedCount || 0) + 1;

        if (!tongbomunHealthy) {
            console.log(`[subregion_judge] 통보문 비정상 — ${child.regKoApp} 해제 보류`);
            continue;
        }

        if (child.missedCount >= 2) {
            console.log(`[subregion_judge] 2회 누락 해제: ${child.regKoApp}`);
            child.current = null;
            child.lastReleasedAt = now;
            child.status = 'released';
        } else {
            child.confidence = 'WEAKLY_ESTIMATED';
            child.estimationReason = 'MISSED_ONCE';
        }
    }

    // ============================================================
    // Step 3.8: 동시 사라짐 잠금 검사 (LOGIC 7)
    //
    // 한 부모해역에 속한 모든 자식이 같은 사이클에 응답에서 빠졌고
    // (= 빈 행이거나 행 자체 누락), 부모는 통보문상 살아있다면
    // → "지금 해제"가 아닌 "미래 해제 예정"으로 추정
    // → 자식들을 status='pending_release'로 잠금
    // → tmEd = parentTongbomun.tmCc
    //
    // 단, 직전 사이클에 자식들이 활성이었어야 동시 사라짐 의미가 있음.
    // ============================================================
    if (tongbomunHealthy) {
        // 부모 regId별로 자식 그룹 빌드
        const parentChildMap = {};
        for (const [regId, child] of Object.entries(newState.subregions)) {
            const pId = child.parentRegId;
            if (!parentChildMap[pId]) parentChildMap[pId] = [];
            parentChildMap[pId].push({ regId, child });
        }

        for (const [parentRegId, children] of Object.entries(parentChildMap)) {
            const parentTb = parentTongbomunState[parentRegId];

            // 부모 통보문상 살아있어야 잠금 의미 있음
            if (!parentTb || !parentTb.current) continue;

            // 직전 사이클 활성 자식 (이번 사이클 시작 시점 기준)
            const prevActive = children.filter(({ regId, child }) => {
                const prev = previousState.subregions[regId];
                return prev && prev.current != null;
            });

            if (prevActive.length === 0) continue;  // 직전 활성 자식 없음

            // 직전 활성 자식이 모두 이번 사이클에 미발효(빠짐)인지 확인
            const allMissingNow = prevActive.every(({ regId, child }) => {
                return child.current == null;
            });

            if (!allMissingNow) continue;  // 일부만 빠짐 (자식 단독 해제 케이스)

            // 부모-자식 동시 사라짐 → 잠금 적용
            const parentTmCc = parentTb.current.tmCc || null;
            for (const { regId, child } of prevActive) {
                const prev = previousState.subregions[regId];
                console.log(`[subregion_judge] 동시 사라짐 잠금: ${child.regKoApp} → 부모 해제시각(${parentTmCc || '미정'})까지 유지`);

                // 직전 활성 정보 복원하여 잠금
                child.current = prev.current ? { ...prev.current } : null;
                child.status = 'pending_release';
                child.confidence = 'STRONGLY_ESTIMATED';
                child.estimationReason = 'CONCURRENT_DISAPPEAR_LOCK';
                child.tmEdNote = null;

                // 종료 시각: 부모 tmCc 적용 (자식이 더 짧으면 자식 시각 유지)
                if (child.current) {
                    if (parentTmCc) {
                        const childEnd = child.current.tmEd ? timeToTimestamp(child.current.tmEd) : null;
                        const parentEnd = timeToTimestamp(parentTmCc);
                        if (parentEnd != null && (childEnd == null || childEnd > parentEnd)) {
                            child.current.tmEd = parentTmCc;
                        }
                    } else {
                        // 부모 tmCc 미정 (범위형 등) → 자식 시각도 미정으로
                        child.current.tmEd = null;
                        child.tmEdNote = '부모 통보문 갱신 대기 (범위형 또는 미명시)';
                    }
                }
            }
        }
    }


    // Step 3.9: 영속화
    let activeCount = 0;
    let estimatedCount = 0;
    for (const c of Object.values(newState.subregions)) {
        if (c.current) activeCount++;
        if (c.confidence && c.confidence !== 'CONFIRMED') estimatedCount++;
    }
    newState.stats.totalActive = activeCount;
    newState.stats.totalEstimated = estimatedCount;
    newState.stats.lastSuccessfulPoll = now;

    saveLifecycle(newState);

    return {
        success: true,
        state: newState,
        error: null
    };
}

module.exports = {
    runJudgement,
    loadLifecycle,
    loadAliasMap,
    saveLifecycle,
    isEmptyRow,
    parseAfsoTime,
    applyLevelCap,
    applyTimeCap
};
