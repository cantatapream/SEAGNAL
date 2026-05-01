/**
 * [자식해역 비교 검증 서비스]
 *
 * 기존 로직 결과(weather_alerts.json children)와 신규 로직 결과
 * (subregion_lifecycle.json)를 비교하여 상이성을 감지하고,
 * 발견 시 subregion_error_log.json 에 기록 + 관리자 푸시 발송.
 *
 * 근거: separation/06_comparison_validation.md
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/server_config');
const { sendAdminPush } = require('./admin_push');

const ALIAS_MAP_FILE = path.join(DATA_DIR, 'region_alias_map.json');
const LIFECYCLE_FILE = path.join(DATA_DIR, 'subregion_lifecycle.json');
const WEATHER_ALERTS_FILE = path.join(DATA_DIR, 'weather_alerts.json');
const ERROR_LOG_FILE = path.join(DATA_DIR, 'subregion_error_log.json');

// 푸시 발송 빈도 제어 (signature → lastSentTime)
const pushSentMap = new Map();

const PUSH_INTERVAL_HIGH_MS = 60 * 60 * 1000;       // 1시간
const PUSH_INTERVAL_MEDIUM_MS = 6 * 60 * 60 * 1000; // 6시간

// ============================================================================
// 파일 로드 / 저장
// ============================================================================

function loadJson(filePath, defaultValue) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        return defaultValue;
    }
}

function saveJsonAtomic(filePath, data) {
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
}

function loadErrorLog() {
    return loadJson(ERROR_LOG_FILE, {
        schema_version: '1.0',
        lastUpdated: null,
        errors: [],
        stats: { totalErrors: 0, unacknowledged: 0, byType: {} }
    });
}

function saveErrorLog(log) {
    log.lastUpdated = new Date().toISOString();
    log.stats.totalErrors = log.errors.length;
    log.stats.unacknowledged = log.errors.filter(e => !e.acknowledged).length;
    log.stats.byType = {};
    for (const e of log.errors) {
        log.stats.byType[e.errorType] = (log.stats.byType[e.errorType] || 0) + 1;
    }
    saveJsonAtomic(ERROR_LOG_FILE, log);
}

// ============================================================================
// 기존 로직 결과 추출 (weather_alerts.json children + 부모 통보문 상속)
// ============================================================================

/**
 * weather_alerts.json 트리에서 자식해역 활성 여부 + 부모 통보문 상속 정보 추출
 * @returns {Map<string, { active: boolean, wrnTp: string, wrnLvl: number, wrnLvlName: string, parentName: string }>}
 *   key = 자식해역 이름 (우리 앱 기준, 예: "가파도연안바다중연안바다")
 */
function extractLegacyResults(weatherAlerts) {
    const results = new Map();
    // walk는 부모 노드의 키 (한글 이름)를 자식에게 전달하여 parentName 정확히 채움
    function walk(node, parentNodeName) {
        if (!node || typeof node !== 'object') return;

        const isZoneNode =
            ('current' in node && 'children' in node);

        if (isZoneNode) {
            // 부모 zone 의 발효 정보를 자식이 상속 (이 부분의 parentName은 본 zone 자기 이름)
            const inheritedForChildren = node.current
                ? {
                    wrnTp: ((node.current.wrnTp || node.current.type) || '').trim(),
                    wrnLvl: levelStringToInt(node.current.wrnLvl || node.current.level || ''),
                    wrnLvlName: (node.current.wrnLvl || node.current.level || '').trim(),
                    parentName: parentNodeName || '(미상)'
                }
                : null;

            if (node.children) {
                for (const [childName, status] of Object.entries(node.children)) {
                    const isActive = status === 'Y';
                    if (isActive && inheritedForChildren) {
                        results.set(childName, {
                            active: true,
                            wrnTp: inheritedForChildren.wrnTp,
                            wrnLvl: inheritedForChildren.wrnLvl,
                            wrnLvlName: inheritedForChildren.wrnLvlName,
                            parentName: parentNodeName || '(미상)'
                        });
                    } else {
                        results.set(childName, {
                            active: false,
                            wrnTp: null,
                            wrnLvl: null,
                            wrnLvlName: null,
                            parentName: parentNodeName || '(미상)'
                        });
                    }
                }
            }
        }

        // 자식 노드(트리 하위) 재귀 — key가 zone 이름이면 다음 walk에서 그게 parentNodeName이 됨
        for (const [key, val] of Object.entries(node)) {
            if (key === 'current' || key === 'upcoming' || key === 'history' || key === 'children') continue;
            if (val && typeof val === 'object') {
                // val이 zone 노드(current/children 보유)면 key가 그 zone 이름 → 자식의 parent
                const isChildZone = ('current' in val && 'children' in val);
                walk(val, isChildZone ? key : parentNodeName);
            }
        }
    }

    walk(weatherAlerts, null);
    return results;
}

/**
 * 한글 레벨 문자열 → 정수 변환.
 * Agent 리뷰 반영: 정확 매칭 우선 (substring 매칭은 false-positive 위험).
 */
function levelStringToInt(s) {
    if (!s) return null;
    const trimmed = String(s).trim();
    // 정확 매칭 우선
    const exact = { '예비': 1, '예비특보': 1, '주의보': 2, '경보': 3 };
    if (exact[trimmed] != null) return exact[trimmed];
    // 폴백 — 단어 시작 매칭으로 false-positive 최소화
    if (/^예비/.test(trimmed)) return 1;
    if (/^주의/.test(trimmed)) return 2;
    if (/^경보/.test(trimmed)) return 3;
    return null;
}

// ============================================================================
// 비교 알고리즘 (separation/06 §2)
// ============================================================================

/**
 * 두 자식해역 결과 비교
 * @returns {object|null} 상이성 객체 또는 null (정상)
 */
function compareSubregion(subregionInfo, legacy, afso) {
    const diff = [];
    let diffType = null;
    let severity = null;

    const legacyActive = legacy && legacy.active;
    const afsoActive = afso && afso.current != null;

    // 둘 다 미발효 → 정상
    if (!legacyActive && !afsoActive) return null;

    // 활성 여부 불일치
    if (legacyActive && !afsoActive) {
        return {
            diffType: 'LEGACY_ACTIVE_AFSO_INACTIVE',
            severity: 'HIGH',
            diff: [{ field: 'active', legacy: true, afso: false }]
        };
    }
    if (!legacyActive && afsoActive) {
        return {
            diffType: 'LEGACY_INACTIVE_AFSO_ACTIVE',
            severity: 'HIGH',
            diff: [{ field: 'active', legacy: false, afso: true }]
        };
    }

    // 둘 다 활성 — 세부 비교 (Agent 리뷰 반영: trim 후 비교)
    const legacyWrnTp = (legacy.wrnTp || '').trim();
    const afsoWrnTp = (afso.current.wrnTp || '').trim();
    if (legacyWrnTp !== afsoWrnTp) {
        return {
            diffType: 'BOTH_ACTIVE_DIFFERENT_TYPE',
            severity: 'HIGH',
            diff: [{ field: 'wrnTp', legacy: legacyWrnTp, afso: afsoWrnTp }]
        };
    }

    if (legacy.wrnLvl !== afso.current.wrnLvl) {
        const isUpgrade = (afso.current.wrnLvl || 0) > (legacy.wrnLvl || 0);
        return {
            diffType: 'BOTH_ACTIVE_DIFFERENT_LEVEL',
            severity: isUpgrade ? 'MEDIUM' : 'LOW',
            diff: [
                { field: 'wrnLvl', legacy: legacy.wrnLvl, afso: afso.current.wrnLvl },
                { field: 'wrnLvlName', legacy: legacy.wrnLvlName, afso: afso.current.wrnLvlName }
            ]
        };
    }

    return null;  // 일치
}

// ============================================================================
// 서술형 메시지 생성 (separation/06 §4.2, §4.3)
// ============================================================================

function buildNarrative(subregionInfo, legacy, afso, mismatch) {
    const now = new Date();
    const timeStr = formatKoreanDate(now);
    const lvlNames = { 1: '예비특보', 2: '주의보', 3: '경보' };

    let header = `${timeStr}, 자식해역 비교 검증에서 결과가 일치하지 않는 항목이 발견되었습니다.`;

    let info = `\n[해역 정보]\n  자식해역 이름: ${subregionInfo.appRegKo}\n  부모해역: ${subregionInfo.parentName || '(매핑 미완)'}\n  방재기상 코드: ${subregionInfo.regId}`;

    let legacyBlock = `\n\n[기존 로직 결과 (기상청 텍스트 스크래핑 기반)]`;
    if (legacy && legacy.active) {
        legacyBlock += `\n  발효 상태: 발효 중\n  특보 종류: ${legacy.wrnTp}\n  특보 수준: ${legacy.wrnLvlName} (부모해역 통보문에서 상속)\n  근거 데이터: weather_alerts.json children`;
    } else {
        legacyBlock += `\n  발효 상태: 미발효`;
    }

    let afsoBlock = `\n\n[방재기상 로직 결과 (방재기상시스템 API 기반)]`;
    if (afso && afso.current) {
        afsoBlock += `\n  발효 상태: 발효 중\n  특보 종류: ${afso.current.wrnTp}\n  특보 수준: ${afso.current.wrnLvlName} (lvl ${afso.current.wrnLvl})\n  발효 시각: ${afso.current.tmEf || 'N/A'}\n  근거 데이터: subregion_lifecycle.json`;
    } else {
        afsoBlock += `\n  발효 상태: 미발효`;
    }

    let diffBlock = `\n\n[차이점]`;
    let causeBlock = `\n\n[추정 원인]`;
    let actionBlock = `\n\n[조치 안내]`;

    switch (mismatch.diffType) {
        case 'LEGACY_ACTIVE_AFSO_INACTIVE':
            diffBlock += `\n  기존 로직은 발효, 방재기상은 미발효`;
            causeBlock += `\n  방재기상시스템에서 사전 해제 발표 표시 (미래 해제 예정), 일시 누락, 또는 매핑/정의 오류 가능.`;
            actionBlock += `\n  - 1~2분 후 다시 확인하여 일시적 누락인지 확인하세요.\n  - 지속되면 매핑 테이블 또는 우리 앱 정의 점검 필요.\n  - 사용자에게는 기존 로직 결과(발효 중)가 표시됩니다.`;
            break;
        case 'LEGACY_INACTIVE_AFSO_ACTIVE':
            diffBlock += `\n  기존 로직은 미발효, 방재기상은 발효`;
            causeBlock += `\n  기상청 텍스트 페이지의 사전 삭제, 텍스트 매칭 실패, 또는 신규 등장 가능.`;
            actionBlock += `\n  - 부모해역 통보문이 살아있는지 확인하세요.\n  - 자식 이름이 텍스트와 정확히 매칭되는지 점검.\n  - 사용자에게는 기존 로직 결과(미발효)가 표시됩니다.`;
            break;
        case 'BOTH_ACTIVE_DIFFERENT_TYPE':
            diffBlock += `\n  특보 종류 다름: 기존(${legacy.wrnTp}) vs 방재기상(${afso.current.wrnTp})`;
            causeBlock += `\n  매우 드문 케이스. 매핑 또는 데이터 무결성 점검 필요.`;
            actionBlock += `\n  - 부모해역 통보문 종류와 비교하세요.\n  - 매핑 테이블의 부모-자식 연결 확인.`;
            break;
        case 'BOTH_ACTIVE_DIFFERENT_LEVEL':
            const dl = mismatch.diff[0];
            const isUp = (dl.afso || 0) > (dl.legacy || 0);
            diffBlock += `\n  특보 수준 다름: 기존(${legacy.wrnLvlName}) vs 방재기상(${afso.current.wrnLvlName})`;
            if (isUp) {
                causeBlock += `\n  부모해역 통보문이 ${legacy.wrnLvlName}이지만, 방재기상이 ${afso.current.wrnLvlName} 격상 발표를 미리 표시하고 있을 가능성. 통보문 갱신 시 일치 예상.`;
                actionBlock += `\n  - 부모해역 통보문 갱신을 1~2시간 대기.\n  - 지속 시 매핑/품질 점검.\n  - 사용자에게는 기존 결과(${legacy.wrnLvlName})가 표시됩니다 (안전 측 정책).`;
            } else {
                causeBlock += `\n  방재기상이 격하 발표를 미리 표시하거나 자식해역 별도 시각이 적용되었을 가능성.`;
                actionBlock += `\n  - 부모 통보문 갱신을 대기.\n  - 사용자에게는 기존 결과(${legacy.wrnLvlName})가 표시됩니다.`;
            }
            break;
    }

    return header + info + legacyBlock + afsoBlock + diffBlock + causeBlock + actionBlock;
}

function formatKoreanDate(d) {
    const kst = new Date(d.getTime() + 9 * 3600 * 1000);
    const y = kst.getUTCFullYear();
    const mo = String(kst.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(kst.getUTCDate()).padStart(2, '0');
    const hh = String(kst.getUTCHours()).padStart(2, '0');
    const mi = String(kst.getUTCMinutes()).padStart(2, '0');
    return `${y}년 ${mo}월 ${dd}일 ${hh}시 ${mi}분`;
}

// ============================================================================
// 푸시 발송 정책 (separation/06 §5)
// ============================================================================

function shouldSendComparisonPush(severity, signature) {
    if (severity === 'LOW') return false;

    const last = pushSentMap.get(signature);
    if (last == null) return true;

    const interval = severity === 'HIGH' ? PUSH_INTERVAL_HIGH_MS : PUSH_INTERVAL_MEDIUM_MS;
    return (Date.now() - last) >= interval;
}

function recordPushSent(signature) {
    pushSentMap.set(signature, Date.now());
}

// ============================================================================
// 오류 항목 생성 / 갱신
// ============================================================================

function generateErrorId() {
    const d = new Date();
    const kst = new Date(d.getTime() + 9 * 3600 * 1000);
    const y = kst.getUTCFullYear();
    const mo = String(kst.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(kst.getUTCDate()).padStart(2, '0');
    const hh = String(kst.getUTCHours()).padStart(2, '0');
    const mi = String(kst.getUTCMinutes()).padStart(2, '0');
    const ss = String(kst.getUTCSeconds()).padStart(2, '0');
    return `err_${y}${mo}${dd}${hh}${mi}${ss}_${Math.floor(Math.random() * 1000)}`;
}

function makeSignature(errorType, info) {
    return `${errorType}::${info.afsoRegId || info.subregionRegId || 'unknown'}`;
}

// ============================================================================
// 메인 함수
// ============================================================================

/**
 * 비교 검증 실행
 * @param {object} parentTongbomunNameMap - parentRegId(AFSO) → 한글이름 매핑 (선택)
 * @returns {Promise<{ matches: number, mismatches: number, newMismatches: object[] }>}
 */
async function runComparison(parentTongbomunNameMap = {}) {
    const aliasMap = loadJson(ALIAS_MAP_FILE, null);
    const lifecycle = loadJson(LIFECYCLE_FILE, null);
    const weatherAlerts = loadJson(WEATHER_ALERTS_FILE, null);

    if (!aliasMap || !lifecycle || !weatherAlerts) {
        console.log('[subregion_comparator] 필수 파일 로드 실패 — 비교 보류');
        return { matches: 0, mismatches: 0, newMismatches: [] };
    }

    const legacyResults = extractLegacyResults(weatherAlerts);
    const errorLog = loadErrorLog();
    const newMismatches = [];

    let matches = 0;
    let mismatches = 0;

    // 매핑된 자식해역들 순회
    for (const [afsoRegId, mapEntry] of Object.entries(aliasMap.subregions)) {
        const appName = mapEntry.appRegKo;
        const parentName = parentTongbomunNameMap[mapEntry.parentRegId] ||
                          (aliasMap.parents[mapEntry.parentRegId]
                            ? aliasMap.parents[mapEntry.parentRegId].appRegKo
                            : '(미상)');

        const legacyResult = legacyResults.get(appName) || { active: false };
        const afsoResult = lifecycle.subregions[afsoRegId] || { current: null };

        const subregionInfo = {
            regId: afsoRegId,
            appRegKo: appName,
            parentRegId: mapEntry.parentRegId,
            parentName: parentName
        };

        const mismatch = compareSubregion(subregionInfo, legacyResult, afsoResult);

        if (mismatch == null) {
            matches++;
            continue;
        }

        mismatches++;

        // 오류 항목 생성/갱신
        const developerInfo = {
            comparisonId: generateErrorId().replace('err_', 'cmp_'),
            subregionRegId: afsoRegId,
            subregionName: appName,
            parentRegion: parentName,
            diffType: mismatch.diffType,
            legacy: legacyResult,
            afso: afsoResult,
            diff: mismatch.diff,
            file: 'services/subregion_comparator.js',
            function: 'runComparison'
        };

        const narrative = buildNarrative(subregionInfo, legacyResult, afsoResult, mismatch);
        const actionRequired = '통합관리자 센터에서 상세 내용 확인 후 통보문 갱신을 대기하거나, 매핑/데이터 점검 진행하세요.';

        const signature = makeSignature('COMPARISON_MISMATCH', developerInfo);
        const existing = errorLog.errors.find(e =>
            e.errorType === 'COMPARISON_MISMATCH' &&
            e.developerInfo &&
            e.developerInfo.subregionRegId === afsoRegId &&
            e.developerInfo.diffType === mismatch.diffType
        );

        let isNewOrReactivated = false;
        if (existing) {
            // 누적 갱신
            existing.occurrenceCount = (existing.occurrenceCount || 1) + 1;
            existing.lastOccurredAt = new Date().toISOString();
            // 확인 후 재발 시 재활성화
            if (existing.acknowledged) {
                existing.acknowledged = false;
                existing.acknowledgedAt = null;
                existing.acknowledgedBy = null;
                isNewOrReactivated = true;
            }
            // 최신 데이터로 갱신
            existing.developerInfo = developerInfo;
            existing.narrativeDescription = narrative;
            existing.severity = mismatch.severity;
        } else {
            // 신규
            const id = generateErrorId();
            errorLog.errors.push({
                id: id,
                errorType: 'COMPARISON_MISMATCH',
                severity: mismatch.severity,
                occurredAt: new Date().toISOString(),
                acknowledged: false,
                acknowledgedAt: null,
                acknowledgedBy: null,
                developerInfo: developerInfo,
                narrativeDescription: narrative,
                actionRequired: actionRequired,
                occurrenceCount: 1,
                lastOccurredAt: new Date().toISOString()
            });
            isNewOrReactivated = true;
            newMismatches.push(developerInfo);
        }

        // 푸시 발송 정책 검사
        if (isNewOrReactivated && shouldSendComparisonPush(mismatch.severity, signature)) {
            const title = '자식해역 비교 불일치 감지';
            const body = `${appName} (${parentName}) — ${mismatch.diffType}`;
            try {
                await sendAdminPush(title, body, {
                    category: 'subregion_comparison_mismatch',
                    severity: mismatch.severity,
                    subregionRegId: afsoRegId,
                    diffType: mismatch.diffType
                });
                recordPushSent(signature);
            } catch (e) {
                console.error('[subregion_comparator] 푸시 발송 실패:', e.message);
            }
        }
    }

    saveErrorLog(errorLog);

    return { matches, mismatches, newMismatches };
}

module.exports = {
    runComparison,
    compareSubregion,
    extractLegacyResults,
    shouldSendComparisonPush,
    buildNarrative,
    loadErrorLog,
    saveErrorLog
};
