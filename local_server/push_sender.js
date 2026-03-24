// [Fix] node-fetch가 package.json에 없을 수 있으므로 Node 18+ 내장 fetch를 우선 사용
let fetch;
try {
    fetch = require('node-fetch');
} catch (_) {
    // Node 18+ 내장 fetch 사용 (global)
    fetch = globalThis.fetch;
}
if (!fetch) {
    console.error('[PushSender] 치명적 오류: fetch를 사용할 수 없습니다. node-fetch 설치 또는 Node 18+ 필요.');
}

const fs = require('fs');
const path = require('path');

const API_URL = 'http://localhost:3001/api/push-custom';
const MAINTENANCE_FILE = path.join(__dirname, 'data', 'maintenance_config.json');
const PENDING_PUSH_FILE = path.join(__dirname, 'data', 'pending_pushes.json');

// ============================================================================
// 격상/격하 판별을 위한 특보 점수 체계 (app.js getAlertScore와 동일)
// ============================================================================
const TYPE_RANK = { '태풍': 100, '풍랑': 10, '강풍': 10, '해일': 10, '호우': 10, '대설': 10, '기타': 0 };
const LVL_RANK = { '경보': 5, '주의보': 2, '예비': 1, '기타': 0, '해제': 0, '': 0 };

function getAlertScore(type, lvl) {
    const tScore = TYPE_RANK[type] || (type && type.includes('태풍') ? 100 : 10);
    const lScore = LVL_RANK[lvl] || 0;
    return tScore + lScore;
}

// ============================================================================
// Pending Push 관리 (발송 실패 시 재시도용)
// ============================================================================
function loadPendingPushes() {
    try {
        if (fs.existsSync(PENDING_PUSH_FILE)) {
            return JSON.parse(fs.readFileSync(PENDING_PUSH_FILE, 'utf8'));
        }
    } catch (_) {}
    return [];
}

function savePendingPushes(pending) {
    try {
        fs.writeFileSync(PENDING_PUSH_FILE, JSON.stringify(pending, null, 2), 'utf8');
    } catch (e) {
        console.error('[PushSender] pending 저장 실패:', e.message);
    }
}

function clearPendingPushes() {
    try {
        if (fs.existsSync(PENDING_PUSH_FILE)) {
            fs.unlinkSync(PENDING_PUSH_FILE);
        }
    } catch (_) {}
}

/**
 * 변경 사항(changes)을 분석하여 그룹핑 후 푸시 알림 발송
 * @param {Array} changes - [{ type, zone, prev, curr, currentActive? }, ...]
 * @param {Object} options - { adminToken: string|null } 관리자 테스트 모드 시 해당 토큰으로만 발송
 * @returns {boolean} 발송 성공 여부 (실패 시 false → 크롤러에서 재시도 판단)
 */
async function processAndSendNotifications(changes, options = {}) {
    if (!changes || changes.length === 0) {
        // 신규 변경사항은 없지만 미발송 건이 있으면 재시도
        return await retryPendingPushes();
    }

    // 점검 모드 중 푸시 알림 차단 여부 확인
    try {
        if (fs.existsSync(MAINTENANCE_FILE)) {
            const config = JSON.parse(fs.readFileSync(MAINTENANCE_FILE, 'utf8'));
            console.log(`[PushSender] 점검 설정 확인: active=${config.active}, blockPush=${config.blockPush}`);
            if (config.active && config.blockPush !== false) {
                console.log(`[PushSender] 점검 모드 활성화 중 → 푸시 발송 차단 (${changes.length}건 무시)`);
                return false;
            }
        } else {
            console.log('[PushSender] 점검 설정 파일 없음 → 정상 진행');
        }
    } catch (e) {
        console.log(`[PushSender] 점검 파일 읽기 실패 (정상 진행): ${e.message}`);
    }

    if (options.adminToken) {
        console.log(`[PushSender] 🔧 관리자 테스트 모드 → 관리자 토큰으로만 발송`);
    }
    console.log(`[PushSender] ${changes.length}건의 변경사항 분석 중...`);

    // 1. 그룹핑 컨테이너
    const groups = {};

    for (const change of changes) {
        const { type, zone, prev, curr } = change;

        // A. 발표 (Upcoming Change)
        if (type === 'UPCOMING_CHANGE') {
            if (!curr) {
                continue;
            }

            const typeName = curr.wrnTp;
            const level = curr.wrnLvl;

            const isPreToAdvisory = (prev && prev.wrnLvl === '예비' && curr.wrnLvl === '주의보');

            if (!prev || (prev.wrnLvl !== curr.wrnLvl && !isPreToAdvisory)) {
                const currentActive = change.currentActive;
                if (currentActive && currentActive.wrnLvl) {
                    const curScore = getAlertScore(currentActive.wrnTp, currentActive.wrnLvl);
                    const newScore = getAlertScore(typeName, level);

                    if (curScore !== newScore) {
                        const scenario = curScore < newScore ? 'level_upgrade_publish' : 'level_downgrade_publish';
                        addToGroup(groups, scenario, typeName, level, {
                            zones: [zone],
                            tmFc: curr.tmFc,
                            tmEf: curr.tmEf,
                            tmYn: curr.tmYn || curr.tmCc,
                            prevTypeName: currentActive.wrnTp,
                            prevLevel: currentActive.wrnLvl
                        });
                        continue;
                    }
                }

                const scenario = 'publish';
                addToGroup(groups, scenario, typeName, level, {
                    zones: [zone],
                    tmFc: curr.tmFc,
                    tmEf: curr.tmEf,
                    tmYn: curr.tmYn || curr.tmCc
                });
            }
            else if (prev.tmEf !== curr.tmEf || isPreToAdvisory) {
                const scenario = 'time_ef_change';
                addToGroup(groups, scenario, typeName, level, {
                    zones: [zone],
                    tmFc: curr.tmFc,
                    tmEf: curr.tmEf,
                    tmYn: curr.tmYn || curr.tmCc
                });
            }
            else {
                // 동일 등급/발효시각이지만 다른 속성(tmYn 등)이 변경된 경우
                console.log(`[PushSender] UPCOMING 필터링: ${zone} (${typeName} ${level}) - 등급/발효시각 동일, 기타 속성 변경`);
            }
        }

        // B. 발효/해제/변경 (Current Change)
        else if (type === 'CURRENT_CHANGE') {

            // 1. 해제 (Curr X)
            if (!curr) {
                const scenario = 'release';
                const typeName = prev.wrnTp;
                const level = prev.wrnLvl;

                addToGroup(groups, scenario, typeName, level, {
                    zones: [zone],
                    tmFc: prev.tmFc,
                    tmEf: prev.tmEf,
                    tmYn: prev.tmYn || prev.tmCc
                });
                continue;
            }

            // 2. 신규 발효 (Prev X, Curr O)
            if (!prev) {
                const scenario = 'active';
                const typeName = curr.wrnTp;
                const level = curr.wrnLvl;

                addToGroup(groups, scenario, typeName, level, {
                    zones: [zone],
                    tmFc: curr.tmFc,
                    tmEf: curr.tmEf,
                    tmYn: curr.tmYn || curr.tmCc
                });
                continue;
            }

            // 3. 등급 변경 (격상/격하)
            if (prev.wrnLvl !== curr.wrnLvl) {
                const prevScore = getAlertScore(prev.wrnTp, prev.wrnLvl);
                const currScore = getAlertScore(curr.wrnTp, curr.wrnLvl);
                const typeName = curr.wrnTp;
                const level = curr.wrnLvl;

                const scenario = prevScore < currScore ? 'level_upgrade_active' : 'level_downgrade_active';
                addToGroup(groups, scenario, typeName, level, {
                    zones: [zone],
                    tmFc: curr.tmFc,
                    tmEf: curr.tmEf,
                    tmYn: curr.tmYn || curr.tmCc,
                    prevTypeName: prev.wrnTp,
                    prevLevel: prev.wrnLvl
                });
            }
            // 4. 시각 변경
            else {
                const typeName = curr.wrnTp;
                const level = curr.wrnLvl;

                if (prev.tmEf !== curr.tmEf) {
                    console.log(`[PushSender] CURRENT 발효시각 변경 감지: ${zone} (${typeName} ${level}) ${prev.tmEf} → ${curr.tmEf}`);
                }

                const prevTmYn = prev.tmYn || prev.tmCc;
                const currTmYn = curr.tmYn || curr.tmCc;
                if (prevTmYn !== currTmYn) {
                    const scenario = 'time_yn_change';

                    addToGroup(groups, scenario, typeName, level, {
                        zones: [zone],
                        tmFc: curr.tmFc,
                        tmEf: curr.tmEf,
                        tmYn: currTmYn
                    });
                }

                if (prev.tmEf === curr.tmEf && prevTmYn === currTmYn) {
                    console.log(`[PushSender] CURRENT 필터링: ${zone} (${typeName} ${level}) - 등급/시각 동일, 기타 속성 변경`);
                }
            }
        }
    }

    // 그룹이 비어있는지 확인
    const groupKeys = Object.keys(groups);
    if (groupKeys.length === 0) {
        console.log('[PushSender] 그룹핑 결과 발송할 항목 없음 (모든 변경사항이 필터링됨)');
        return true; // 발송할 것 없음 = 성공으로 간주
    }

    console.log(`[PushSender] ${groupKeys.length}개 그룹 발송 시작: ${groupKeys.join(', ')}`);

    // 2. 발송 (순차 처리)
    let allSuccess = true;
    const failedPayloads = [];

    for (const key of groupKeys) {
        const group = groups[key];

        const payload = {
            templateId: group.templateId,
            typeName: group.typeName,
            level: group.level,
            items: group.items,
            prevTypeName: group.prevTypeName || null,
            prevLevel: group.prevLevel || null
        };

        const success = await sendToApi(payload, options.adminToken || null);
        if (!success) {
            allSuccess = false;
            failedPayloads.push({ payload, key, failedAt: new Date().toISOString() });
        }
    }

    // 실패한 건이 있으면 pending으로 저장
    if (failedPayloads.length > 0) {
        console.error(`[PushSender] ⚠️ ${failedPayloads.length}건 발송 실패 → pending 저장 (다음 크롤링 시 재시도)`);
        const existing = loadPendingPushes();
        // 최대 20건까지만 보관 (오래된 건은 버림)
        const merged = [...failedPayloads, ...existing].slice(0, 20);
        savePendingPushes(merged);
    }

    return allSuccess;
}

/**
 * 미발송 건 재시도
 */
async function retryPendingPushes() {
    const pending = loadPendingPushes();
    if (pending.length === 0) return true;

    console.log(`[PushSender] 미발송 ${pending.length}건 재시도 중...`);

    // 점검 모드 확인
    try {
        if (fs.existsSync(MAINTENANCE_FILE)) {
            const config = JSON.parse(fs.readFileSync(MAINTENANCE_FILE, 'utf8'));
            if (config.active && config.blockPush !== false) {
                console.log('[PushSender] 점검 모드 → 재시도 보류');
                return false;
            }
        }
    } catch (_) {}

    const stillPending = [];
    for (const item of pending) {
        // 24시간 이상 지난 건은 폐기
        const age = Date.now() - new Date(item.failedAt).getTime();
        if (age > 24 * 60 * 60 * 1000) {
            console.log(`[PushSender] 만료된 pending 폐기: ${item.key} (${Math.round(age/3600000)}시간 경과)`);
            continue;
        }

        const success = await sendToApi(item.payload);
        if (!success) {
            stillPending.push(item);
        } else {
            console.log(`[PushSender] 재시도 성공: ${item.key}`);
        }
    }

    if (stillPending.length > 0) {
        savePendingPushes(stillPending);
        return false;
    } else {
        clearPendingPushes();
        return true;
    }
}

function addToGroup(groups, templateId, typeName, level, itemData) {
    const key = `${templateId}_${typeName}_${level}`;

    if (!groups[key]) {
        groups[key] = {
            templateId,
            typeName,
            level,
            items: [],
            prevTypeName: itemData.prevTypeName || null,
            prevLevel: itemData.prevLevel || null
        };
    }
    groups[key].items.push(itemData);
}

/**
 * @param {Object} payload - 발송 데이터
 * @param {string|null} adminToken - 관리자 테스트 모드 시 해당 FCM 토큰으로만 발송
 * @returns {boolean} 발송 성공 여부
 */
async function sendToApi(payload, adminToken = null) {
    if (!fetch) {
        console.error('[PushSender] fetch 사용 불가 → 발송 실패');
        return false;
    }

    try {
        console.log(`[PushSender] API 호출: ${API_URL} (${payload.templateId} ${payload.typeName} ${payload.level})`);
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                isManualGroupSend: true,
                type: 'auto',
                payload: payload,
                adminToken: adminToken || undefined
            })
        });

        if (!response.ok) {
            const txt = await response.text();
            console.error(`[PushSender] 서버 응답 오류 ${response.status}: ${txt}`);
            return false;
        }

        const result = await response.json();
        console.log(`[PushSender] ✅ 발송 성공: [${payload.templateId}] ${payload.typeName} ${payload.level} (${payload.items.length}개 구역, ${result.successCount || 0}명 발송)`);
        return true;
    } catch (error) {
        console.error(`[PushSender] ❌ API 통신 오류: ${error.message}`);
        return false;
    }
}

module.exports = {
    processChanges: processAndSendNotifications,
    retryPendingPushes
};
