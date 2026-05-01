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
 * AFSO 시각 (YYYYMMDDHHMI) → 한글 형식 ("YYYY년 MM월 DD일 HH시 MM분")
 * 기존 앱(통보문)이 한글 형식을 사용하므로 통일.
 * 비교는 timeToTimestamp()로 내부 변환 후 수행.
 */
function parseAfsoTime(timeStr) {
    if (!timeStr || timeStr === '') return null;
    if (!/^\d{12}$/.test(timeStr)) return null;
    const y = timeStr.substring(0, 4);
    const mo = timeStr.substring(4, 6);
    const d = timeStr.substring(6, 8);
    const h = timeStr.substring(8, 10);
    const mi = timeStr.substring(10, 12);
    return `${y}년 ${mo}월 ${d}일 ${h}시 ${mi}분`;
}

/**
 * 부모 통보문 시각을 자식 시각으로 사용 시 한글 형식 정규화.
 * 통보문이 이미 한글이면 그대로, ISO 형식이면 한글로 변환.
 */
function normalizeParentTimeForChild(parentTimeStr) {
    if (!parentTimeStr) return null;
    // 한글 형식이면 그대로
    if (/^\d{4}년/.test(parentTimeStr)) return parentTimeStr;
    // ISO 형식이면 한글로 변환
    const t = timeToTimestamp(parentTimeStr);
    if (t == null) return null;
    const d = new Date(t);
    const kst = new Date(t + (d.getTimezoneOffset() * 60000) + (9 * 3600000));
    const y = kst.getUTCFullYear();
    const mo = String(kst.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(kst.getUTCDate()).padStart(2, '0');
    const hh = String(kst.getUTCHours()).padStart(2, '0');
    const mi = String(kst.getUTCMinutes()).padStart(2, '0');
    return `${y}년 ${mo}월 ${dd}일 ${hh}시 ${mi}분`;
}

/**
 * 통보문 시각을 비교 가능한 timestamp 로 정규화.
 * 통보문에서 오는 한글 시각("2026년 04월 30일 14시 00분") + AFSO ISO 모두 처리.
 */
function timeToTimestamp(timeStr) {
    if (!timeStr) return null;
    // 한글 형식 매칭: YYYY년 MM월 DD일 HH시 MM분
    const m = String(timeStr).match(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*(\d{1,2})시\s*(\d{1,2})분/);
    if (m) {
        const iso = `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}T${String(m[4]).padStart(2,'0')}:${String(m[5]).padStart(2,'0')}:00+09:00`;
        const t = new Date(iso).getTime();
        return Number.isFinite(t) ? t : null;
    }
    try {
        const t = new Date(timeStr).getTime();
        return Number.isFinite(t) ? t : null;
    } catch (e) {
        return null;
    }
}

/**
 * 범위형 시각 식별 (LOGIC 12)
 * 정확 시각(파싱 가능) 외의 모든 형식을 범위형으로 간주.
 */
function isRangeTime(timeStr) {
    if (!timeStr || timeStr === '') return false;
    return timeToTimestamp(timeStr) == null;
}

/**
 * 안전한 정수 파싱 (Agent 리뷰 반영: parseInt(x) || null 패턴 위험성)
 */
function safeParseInt(v) {
    if (v == null || v === '') return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
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
 * 부모 시각이 범위형(파싱 불가)이면 자식 시각 그대로 반환.
 * 캡 적용 시 ISO 형식으로 정규화하여 일관성 유지.
 */
function applyTimeCap(childEnd, parentEnd) {
    const childT = timeToTimestamp(childEnd);
    const parentT = timeToTimestamp(parentEnd);
    if (childT == null || parentT == null) return childEnd;
    if (childT > parentT) {
        // 부모 시각으로 캡 — ISO 정규화하여 반환
        return normalizeParentTimeForChild(parentEnd) || childEnd;
    }
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
    // Step 3.2-A: upcoming → current 시각 도달 자동 승격 (LOGIC 12)
    // 사용자 시나리오: "풍랑경보 발효 중 풍랑주의보 격하 발표 → 발효시각 도달 시
    //                 자동으로 풍랑주의보로 전환, 기존 경보 사라짐"
    // 부모해역의 resolvePendingStatuses 패턴과 동일.
    // ============================================================
    const nowMs = Date.now();
    for (const [regId, child] of Object.entries(newState.subregions)) {
        if (!child.upcoming) continue;
        const upcomingTmEf = child.upcoming.tmEf;
        if (!upcomingTmEf) continue;
        const t = timeToTimestamp(upcomingTmEf);
        if (t == null) continue;
        if (t <= nowMs) {
            // 시각 도달 — upcoming → current 승격
            console.log(`[subregion_judge] upcoming → current 자동 승격: ${child.regKoApp}`);
            child.current = { ...child.upcoming };
            child.upcoming = null;
            // eventLabel 추정: 직전 current와 비교
            // (직전 current 정보는 lifecycle history에 있으나 본 단순 보완에서는 '발효됨' 으로 처리)
            child.eventLabel = '발효됨';
        }
    }

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

    // Step 3.5: 매핑 적용 (먼저 — 매핑된 자식만 후속 처리에서 추적)
    const mappedActive = applyMapping(classified.children, aliasMap, recordError);
    const mappedEmpty = applyMapping(classified.empty, aliasMap, null);

    // 응답에 등장한 매핑된 자식의 regId 집합
    // (매핑 누락 행은 추적 대상에서 제외 — Agent 리뷰 HIGH 반영: stuck 방지)
    const respondedRegIds = new Set();
    for (const item of mappedActive) respondedRegIds.add(item.row.regId);
    for (const item of mappedEmpty) respondedRegIds.add(item.row.regId);

    const now = new Date().toISOString();

    // 방재기상 응답에서 부모 행 빠르게 조회 (시나리오 ②/④ 분기 판정용)
    const parentRowMap = {};
    for (const row of classified.parents) parentRowMap[row.regId] = row;
    for (const row of classified.empty) {
        if (row.regId === row.regUp) parentRowMap[row.regId] = row;
    }

    // ============================================================
    // [신규] 같은 regId 행을 발효/예비로 그룹화 (LOGIC 10 §1-A)
    // 한 자식해역에 발효 행 + 예비/upcoming 행이 동시에 들어올 수 있음
    // 같은 종류 격하/격상 예비, 다른 종류 예비 등
    // ============================================================
    const groupedByRegId = {};
    for (const item of mappedActive) {
        const regId = item.row.regId;
        if (!groupedByRegId[regId]) {
            groupedByRegId[regId] = { active: [], preliminary: [], primaryItem: null };
        }
        const lvl = safeParseInt(item.row.wrnLvl);
        if (lvl === 1) {
            groupedByRegId[regId].preliminary.push(item);
        } else if (lvl >= 2) {
            groupedByRegId[regId].active.push(item);
        }
    }

    // 그룹 안에서 우선순위:
    //  - 발효 행이 있으면 → current 슬롯 (풍랑 우선, 그 외 첫 행)
    //  - 예비 행만 있으면 → upcoming 슬롯
    // (동일 자식해역에 발효 두 개 동시는 사용자 정책상 없음, 보호 차원에서 풍랑 우선)
    for (const regId of Object.keys(groupedByRegId)) {
        const g = groupedByRegId[regId];
        // 활성 행 정렬: 풍랑 우선 (LOGIC 10 §1-A.2 폴백 정책)
        g.active.sort((a, b) => {
            if (a.row.wrnTp === '풍랑' && b.row.wrnTp !== '풍랑') return -1;
            if (b.row.wrnTp === '풍랑' && a.row.wrnTp !== '풍랑') return 1;
            return 0;
        });
        g.preliminary.sort((a, b) => {
            if (a.row.wrnTp === '풍랑' && b.row.wrnTp !== '풍랑') return -1;
            if (b.row.wrnTp === '풍랑' && a.row.wrnTp !== '풍랑') return 1;
            return 0;
        });
        // primaryItem = 발효 우선, 없으면 예비
        g.primaryItem = g.active[0] || g.preliminary[0] || null;
    }

    // Step 3.6 + 신규 처리: 발효 행 처리 (캡 적용 + 시나리오 ②/④ 분기)
    // 같은 regId가 여러 번 처리되지 않도록 처리 완료 set 관리
    const processedRegIds = new Set();
    for (const item of mappedActive) {
        const row = item.row;
        const parentTongbomun = parentTongbomunState[item.parentRegId];

        // 같은 regId 중복 처리 방지 (그룹의 primary만 처리)
        if (processedRegIds.has(row.regId)) continue;
        const group = groupedByRegId[row.regId];
        if (!group || group.primaryItem !== item) {
            // 같은 regId의 다른 행 — 본 루프에서는 건너뜀
            // (예비 행은 후속 별도 루프에서 upcoming으로 처리)
            continue;
        }
        processedRegIds.add(row.regId);

        // ============================================================
        // 시나리오 ④ — 신규 발효 사전 차단
        // 부모 통보문 미발효인데 자식 행 등장 → 통보문 발효까지 자식 무시
        // (사용자 정책: 통보문 = 부모해역 변동의 절대 기준)
        // ============================================================
        if (!parentTongbomun || !parentTongbomun.current) {
            if (recordError) {
                recordError({
                    type: 'PARENT_CHILD_MISMATCH',
                    afsoRegId: row.regId,
                    appName: item.appName,
                    parentRegId: item.parentRegId,
                    wrnTp: row.wrnTp,
                    wrnLvlName: row.wrnLvlName,
                    note: '방재기상 자식 등장했으나 통보문 부모 미발효 — 통보문 발효까지 대기'
                });
            }
            // 자식 추가하지 않음 (현재 사이클에서 무시)
            // 단 직전 사이클에 활성이었다면 그대로 유지 (newState.subregions[row.regId]는 previousState에서 spread됨)
            continue;
        }

        // 캡 적용
        let cappedLvl = safeParseInt(row.wrnLvl);
        let cappedTmEd = parseAfsoTime(row.tmEd);
        let estimationReason = null;
        let confidence = 'CONFIRMED';
        const prev = newState.subregions[row.regId];

        const parentLvl = parentTongbomun.current.wrnLvl || null;
        const parentLvlInt = (typeof parentLvl === 'number')
            ? parentLvl
            : (parentLvl ? (parentLvl.includes('경보') ? 3 : parentLvl.includes('주의') ? 2 : 1) : null);
        const parentEnd = parentTongbomun.current.tmCc || null;

        // 시나리오 ② — 격하 사전 차단
        // 자식이 격하되었는데 방재기상 부모 행도 함께 격하/빠짐 → 사전 격하 → 자식 부모 레벨 유지
        // 자식만 격하 (부모 행 그대로) → 단독 격하 → 즉시 적용
        if (parentLvlInt != null && cappedLvl != null && cappedLvl < parentLvlInt &&
            prev?.current?.wrnLvl === parentLvlInt) {

            const parentRow = parentRowMap[item.parentRegId];
            const parentRowLvl = parentRow ? safeParseInt(parentRow.wrnLvl) : null;
            const parentLowered = !parentRow || isEmptyRow(parentRow) ||
                                  (parentRowLvl != null && parentRowLvl < parentLvlInt);

            if (parentLowered) {
                // 사전 격하 — 부모 레벨 유지 (통보문 격하까지 대기)
                cappedLvl = parentLvlInt;
                estimationReason = 'PRE_DOWNGRADE_LOCK';
                confidence = 'WEAKLY_ESTIMATED';
                if (recordError) {
                    recordError({
                        type: 'PRE_DOWNGRADE_LOCKED',
                        afsoRegId: row.regId,
                        appName: item.appName,
                        rawLvl: safeParseInt(row.wrnLvl),
                        keptLvl: parentLvlInt,
                        note: '방재기상 자식 격하 + 부모 행도 함께 격하 — 통보문 격하까지 부모 레벨 유지'
                    });
                }
            }
            // else: 자식 단독 격하 — cappedLvl 그대로 사용 (즉시 적용)
        }

        // 캡 — 격상 차단 (자식 > 부모)
        const newCappedLvl = applyLevelCap(cappedLvl, parentLvlInt);
        const newCappedEnd = applyTimeCap(cappedTmEd, parentEnd);

        if (newCappedLvl !== cappedLvl) {
            estimationReason = estimationReason || 'LEVEL_CAPPED';
            confidence = 'WEAKLY_ESTIMATED';
            if (recordError) {
                recordError({
                    type: 'LEVEL_CAP_APPLIED',
                    afsoRegId: row.regId,
                    appName: item.appName,
                    rawLvl: cappedLvl,
                    cappedLvl: newCappedLvl,
                    parentLvl: parentLvlInt
                });
            }
            cappedLvl = newCappedLvl;
        }

        if (newCappedEnd !== cappedTmEd) {
            if (estimationReason == null) {
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

        // 격상/격하 라벨 자동 감지 (LOGIC 09)
        let eventLabel = '발효됨';
        if (prev && prev.current && prev.current.wrnLvl != null && cappedLvl != null) {
            if (cappedLvl > prev.current.wrnLvl) eventLabel = '격상됨';
            else if (cappedLvl < prev.current.wrnLvl) eventLabel = '격하됨';
            else eventLabel = prev.eventLabel || '발효됨';
        }

        // 본 primaryItem이 발효(>=2)인지 예비(=1)인지 판별
        const primaryIsActive = group.active.length > 0;

        // current vs upcoming 슬롯 분기
        const builtCurrent = primaryIsActive ? {
            wrnTp: row.wrnTp,
            wrnLvl: cappedLvl,
            wrnLvlName: row.wrnLvlName,
            tmFc: parseAfsoTime(row.tmFc),
            tmEf: parseAfsoTime(row.tmEf),
            tmEd: cappedTmEd
        } : null;

        const builtUpcoming = !primaryIsActive ? {
            wrnTp: row.wrnTp,
            wrnLvl: cappedLvl,
            wrnLvlName: row.wrnLvlName,
            tmFc: parseAfsoTime(row.tmFc),
            tmEf: parseAfsoTime(row.tmEf),
            tmEd: cappedTmEd
        } : null;

        // 추가 — 같은 regId의 예비 행이 있으면 upcoming에 보관
        // (current=발효, upcoming=같은 종류의 격상/격하 예비 또는 다른 종류 예비)
        let extraUpcoming = builtUpcoming;
        if (primaryIsActive && group.preliminary.length > 0) {
            const prelimItem = group.preliminary[0];
            const prelimRow = prelimItem.row;
            const prelimLvl = safeParseInt(prelimRow.wrnLvl);
            extraUpcoming = {
                wrnTp: prelimRow.wrnTp,
                wrnLvl: prelimLvl,
                wrnLvlName: prelimRow.wrnLvlName,
                tmFc: parseAfsoTime(prelimRow.tmFc),
                tmEf: parseAfsoTime(prelimRow.tmEf),
                tmEd: parseAfsoTime(prelimRow.tmEd)
            };
            // 같은 regId의 prelim도 처리 완료 표시
            processedRegIds.add(prelimRow.regId);
        }

        // 자식 상태 객체 빌드/갱신
        newState.subregions[row.regId] = {
            regId: row.regId,
            regKoApp: item.appName,
            regKoAfso: (row.regKo || '').trim(),
            parentRegId: item.parentRegId,
            current: builtCurrent,
            upcoming: extraUpcoming,
            rawFromAfso: {
                wrnLvl: safeParseInt(row.wrnLvl),
                tmEd: parseAfsoTime(row.tmEd)
            },
            status: builtCurrent ? 'active' : 'preliminary',
            confidence: confidence,
            estimationReason: estimationReason,
            missedCount: 0,  // 정상 등장 → 카운터 리셋
            lastSeenAt: now,
            firstActivatedAt: prev ? prev.firstActivatedAt : now,
            lastReleasedAt: prev ? prev.lastReleasedAt : null,
            eventLabel: builtCurrent ? eventLabel : '예비특보 발표',
            tmEdNote: null,
            history: prev ? (prev.history || []).slice(-50) : []
        };
    }

    // 빈 행 처리 — 즉시 해제 (LOGIC 05 §4)
    for (const item of mappedEmpty) {
        const row = item.row;
        const prev = newState.subregions[row.regId];
        if (prev && (prev.current != null || prev.upcoming != null)) {
            console.log(`[subregion_judge] 즉시 해제 (빈 행): ${item.appName}`);
            prev.current = null;
            prev.upcoming = null;  // 자식 해제 시 upcoming 함께 폐기 (사용자 결정 — 권장안)
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
            child.upcoming = null;  // 자식 해제 시 upcoming 함께 폐기 (권장안)
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
                child.upcoming = null;  // 동시 사라짐 잠금 시 upcoming 폐기 (옵션 b — 사용자 결정)
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


    // ============================================================
    // Step 3.9-pre: 부모 통보문 변화 추적 + STALE_PARENT 감지 (OPERATIONS 07)
    // 24시간 이상 통보문 변화 없는 부모해역 발효 중인 경우
    // → STALE_PARENT 오류 기록 + 일별 1회 푸시 (스팸 방지)
    // ============================================================
    if (tongbomunHealthy && parentTongbomunState) {
        const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
        const PUSH_INTERVAL_MS = 24 * 60 * 60 * 1000;

        // newState.parentSnapshots: { [parentRegId]: { lastChangeAt, lastSig, lastStalePushAt } }
        if (!newState.parentSnapshots) {
            newState.parentSnapshots = previousState.parentSnapshots || {};
        }

        for (const [parentRegId, parentTb] of Object.entries(parentTongbomunState)) {
            if (!parentTb || !parentTb.current) continue;  // 미발효 부모는 추적 안 함

            // 부모 상태 시그니처 (변화 감지용)
            const sig = JSON.stringify({
                wrnTp: parentTb.current.wrnTp,
                wrnLvl: parentTb.current.wrnLvl,
                tmEf: parentTb.current.tmEf,
                tmCc: parentTb.current.tmCc
            });

            const snap = newState.parentSnapshots[parentRegId] || {};

            if (snap.lastSig !== sig) {
                // 변화 감지 — 시그니처 갱신
                newState.parentSnapshots[parentRegId] = {
                    lastChangeAt: now,
                    lastSig: sig,
                    lastStalePushAt: snap.lastStalePushAt || null
                };
            } else {
                // 변화 없음 — 시간 누적 검사
                const lastChangeAt = snap.lastChangeAt || now;
                const elapsed = Date.now() - new Date(lastChangeAt).getTime();
                if (elapsed >= STALE_THRESHOLD_MS) {
                    // STALE 감지 — 푸시 빈도 제어
                    const lastPushed = snap.lastStalePushAt ? new Date(snap.lastStalePushAt).getTime() : null;
                    if (lastPushed == null || (Date.now() - lastPushed) >= PUSH_INTERVAL_MS) {
                        const aliasParent = aliasMap.parents[parentRegId];
                        const parentName = aliasParent ? aliasParent.appRegKo : parentRegId;
                        if (recordError) {
                            recordError({
                                type: 'STALE_PARENT',
                                parentRegId: parentRegId,
                                parentRegKo: parentName,
                                lastChangeAt: lastChangeAt,
                                hours: Math.floor(elapsed / (60 * 60 * 1000)),
                                wrnTp: parentTb.current.wrnTp,
                                wrnLvlName: parentTb.current.wrnLvlName || parentTb.current.wrnLvl
                            });
                        }
                        snap.lastStalePushAt = now;
                        newState.parentSnapshots[parentRegId] = {
                            lastChangeAt: lastChangeAt,
                            lastSig: sig,
                            lastStalePushAt: now
                        };
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
