const fetch = require('node-fetch'); // Node.js 18+ 내장 fetch 사용 시 생략 가능하나 안전하게
// (Node 내장 fetch 사용 시 require 제거 필요할 수 있음. 환경에 따라 다름)
const fs = require('fs');
const path = require('path');

const API_URL = 'http://localhost:3001/api/push-custom'; // 로컬 서버 포트 확인 필요 (현재 3001 사용 중)
const MAINTENANCE_FILE = path.join(__dirname, 'data', 'maintenance_config.json');

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

/**
 * 변경 사항(changes)을 분석하여 그룹핑 후 푸시 알림 발송
 * @param {Array} changes - [{ type, zone, prev, curr, currentActive? }, ...]
 */
async function processAndSendNotifications(changes) {
    if (!changes || changes.length === 0) return;

    // 점검 모드 중에는 푸시 알림 발송 차단
    try {
        if (fs.existsSync(MAINTENANCE_FILE)) {
            const config = JSON.parse(fs.readFileSync(MAINTENANCE_FILE, 'utf8'));
            if (config.active) {
                console.log(`[PushSender] 점검 모드 활성화 중 → 푸시 발송 차단 (${changes.length}건 무시)`);
                return;
            }
        }
    } catch (_) { /* 점검 파일 읽기 실패 시 정상 진행 */ }

    console.log(`[PushSender] ${changes.length}건의 변경사항 분석 중...`);

    // 1. 그룹핑 컨테이너
    // Key: `${Scenario}_${TypeName}_${Level}`
    // Value: { templateId, typeName, level, items: [], prevTypeName?, prevLevel? }
    const groups = {};

    for (const change of changes) {
        const { type, zone, prev, curr } = change;

        // -----------------------------------------------------------
        // 시나리오 판별
        // -----------------------------------------------------------

        // A. 발표 (Upcoming Change)
        // - 신규 생성 (prev X, curr O)
        // - 등급 변경은 보통 Current에서 일어나지만, Upcoming 상태에서 바뀔 수도 있음
        if (type === 'UPCOMING_CHANGE') {
            if (!curr) {
                // Upcoming이 사라짐 -> 발효되었거나 취소됨.
                // 이는 CURRENT_CHANGE에서 '신규 발효'로 잡히거나, 아예 사라진 경우임.
                // 여기서는 '예비특보 해제' 알림을 보낼지 결정해야 하는데,
                // 보통 발효로 이어지므로 '해제' 알림은 보내지 않는 것이 깔끔함 (사용자 요청 시나리오에 없음)
                continue;
            }

            // 신규 발표 또는 시각 변경 처리 (일원화)
            const typeName = curr.wrnTp;
            const level = curr.wrnLvl;

            // (1) 새로 생겼거나 등급이 바뀐 경우 -> '발표' 알림
            // [분석 반영] 단, '예비 -> 주의보' 전환은 동일 특보의 시간 확정 과정이므로 신규 발표에서 제외
            const isPreToAdvisory = (prev && prev.wrnLvl === '예비' && curr.wrnLvl === '주의보');

            if (!prev || (prev.wrnLvl !== curr.wrnLvl && !isPreToAdvisory)) {
                // [추가] 격상/격하 판별: 현재 발효 중인 특보(currentActive)와 비교
                const currentActive = change.currentActive;
                if (currentActive && currentActive.wrnLvl) {
                    const curScore = getAlertScore(currentActive.wrnTp, currentActive.wrnLvl);
                    const newScore = getAlertScore(typeName, level);

                    if (curScore !== newScore) {
                        // 격상 또는 격하 발표
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

                // 격상/격하가 아닌 일반 발표
                const scenario = 'publish';
                addToGroup(groups, scenario, typeName, level, {
                    zones: [zone],
                    tmFc: curr.tmFc,
                    tmEf: curr.tmEf, // 발효예정 시각
                    tmYn: curr.tmYn || curr.tmCc // tmCc가 실제 해제예정시각 필드
                });
            }
            // (2) 등급은 같은데 시각만 바뀐 경우이거나, '예비 -> 주의보'로 시각이 구체화된 경우 -> '시각 변경' 알림
            else if (prev.tmEf !== curr.tmEf || isPreToAdvisory) {
                const scenario = 'time_ef_change';
                addToGroup(groups, scenario, typeName, level, {
                    zones: [zone],
                    tmFc: curr.tmFc,
                    tmEf: curr.tmEf,
                    tmYn: curr.tmYn || curr.tmCc
                });
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
                    tmYn: curr.tmYn || curr.tmCc // tmCc가 실제 해제예정시각 필드
                });
                continue;
            }

            // 3. 등급 변경 (격상/격하)
            if (prev.wrnLvl !== curr.wrnLvl) {
                const prevScore = getAlertScore(prev.wrnTp, prev.wrnLvl);
                const currScore = getAlertScore(curr.wrnTp, curr.wrnLvl);
                const typeName = curr.wrnTp;
                const level = curr.wrnLvl;

                // 격상 또는 격하 발효
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
            // 4. 시각 변경 (등급 변경이 없을 때만 별도 알림 발송 - 일원화)
            else {
                // 4-1. 발효시각 변경 (이미 발효된 건데 발효시각이 바뀔 일은 드묾)
                if (prev.tmEf !== curr.tmEf) {
                    // 필요 시 추가 로직 작성 가능
                }

                // 4-2. 해제시각 변경 (연장 등) — tmCc가 실제 해제예정시각 필드
                const prevTmYn = prev.tmYn || prev.tmCc;
                const currTmYn = curr.tmYn || curr.tmCc;
                if (prevTmYn !== currTmYn) {
                    const scenario = 'time_yn_change';
                    const typeName = curr.wrnTp;
                    const level = curr.wrnLvl;

                    addToGroup(groups, scenario, typeName, level, {
                        zones: [zone],
                        tmFc: curr.tmFc,
                        tmEf: curr.tmEf,
                        tmYn: currTmYn // 변경된 해제예정 시각
                    });
                }
            }
        }
    }

    // 2. 발송 (순차 처리)
    for (const key in groups) {
        const group = groups[key];

        // Payload 구성
        const payload = {
            templateId: group.templateId,
            typeName: group.typeName,
            level: group.level,
            items: group.items, // [{zones:['A'], tmEf:'...'}, {zones:['B'], tmEf:'...'}]
            // [추가] 격상/격하 시 이전 등급 정보 전달
            prevTypeName: group.prevTypeName || null,
            prevLevel: group.prevLevel || null
        };

        // API 호출
        try {
            await sendToApi(payload);
        } catch (e) {
            console.error(`[PushSender] 발송 실패 (${key}):`, e.message);
        }
    }
}

function addToGroup(groups, templateId, typeName, level, itemData) {
    // Key: ACTIVE_풍랑_주의보
    const key = `${templateId}_${typeName}_${level}`;

    if (!groups[key]) {
        groups[key] = {
            templateId,
            typeName,
            level,
            items: [],
            // [추가] 격상/격하 시 이전 특보 정보 저장
            prevTypeName: itemData.prevTypeName || null,
            prevLevel: itemData.prevLevel || null
        };
    }
    // itemData: { zones: ['서해...'], tmEf: '...', tmYn: '...' }
    groups[key].items.push(itemData);
}

async function sendToApi(payload) {
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                isManualGroupSend: true, // 템플릿 엔진 사용 트리거
                type: 'auto', // [추가] 자동 발송 타입 명시
                payload: payload
            })
        });

        if (!response.ok) {
            const txt = await response.text();
            throw new Error(`Server responded ${response.status}: ${txt}`);
        }
        console.log(`[PushSender] 발송 성공: [${payload.templateId}] ${payload.typeName} ${payload.level} (${payload.items.length}개 구역)`);
    } catch (error) {
        // fetch가 없으면 axios 등을 시도하거나 에러 로그
        console.error('[PushSender] API Error:', error.message);
    }
}

module.exports = {
    processChanges: processAndSendNotifications
};
