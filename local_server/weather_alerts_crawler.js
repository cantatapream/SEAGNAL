/**
 * 기상특보 통합 크롤러 (weather_alerts_crawler.js)
 * 
 * 기능:
 * 1. 통보문(list.do) 기반 실시간 특보 상태 관리 (Report Alert Processor 연동)
 * 2. 특보종합(warning.do) 기반 연안바다/평수구역 활성화 여부 동기화
 * 3. 부모 해역 상태에 따른 자식 해역 상속 및 강제 해제 로직 적용
 * 4. 해역별 특보 히스토리 누적
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const pushSender = require('./push_sender');
const reportProcessor = require('./report_alert_processor');

const CONFIG = {
    URL: 'https://www.weather.go.kr/w/wnuri-fct2021/weather/warning.do',
    OUTPUT_FILE: path.join(__dirname, 'data', 'weather_alerts.json')
};

// ============================================================================
// 고정 스키마 (폼) 정의
// ============================================================================

const ZONE_GROUP_MAP = {
    // ... (Keep existing map or if it's not defined here, rely on what's available. ZONE_GROUP_MAP is actually not in this file, it's in report_alert_processor.js. Wait, createZoneStructure IS in this file.)
};
// Re-reading file content shows createZoneStructure at line 27. I will replace the function body.

function createZoneStructure() {
    return {
        "동해": {
            "동해남부해상": {
                "동해남부앞바다": {
                    "울산앞바다": { current: null, upcoming: null, history: [], children: { "울산앞바다중평수구역": null, "울산앞바다중연안바다": null } },
                    "경북남부앞바다": { current: null, upcoming: null, history: [], children: { "경북남부앞바다중평수구역": null, "경북남부앞바다중연안바다": null } },
                    "경북북부앞바다": { current: null, upcoming: null, history: [], children: { "경북북부앞바다중연안바다": null } }
                },
                "동해남부먼바다": {
                    "동해남부남쪽안쪽먼바다": { current: null, upcoming: null, history: [], children: {} },
                    "동해남부남쪽바깥먼바다": { current: null, upcoming: null, history: [], children: {} },
                    "동해남부북쪽안쪽먼바다": { current: null, upcoming: null, history: [], children: {} },
                    "동해남부북쪽바깥먼바다": { current: null, upcoming: null, history: [], children: {} }
                }
            },
            "동해중부해상": {
                "동해중부앞바다": {
                    "강원북부앞바다": { current: null, upcoming: null, history: [], children: { "강원북부앞바다중연안바다": null } },
                    "강원중부앞바다": { current: null, upcoming: null, history: [], children: { "강원중부앞바다중연안바다": null } },
                    "강원남부앞바다": { current: null, upcoming: null, history: [], children: { "강원남부앞바다중연안바다": null } }
                },
                "동해중부먼바다": {
                    "동해중부안쪽먼바다": { current: null, upcoming: null, history: [], children: { "울릉도울릉읍연안바다": null, "울릉도서면연안바다": null, "울릉도북면연안바다": null } },
                    "동해중부바깥먼바다": { current: null, upcoming: null, history: [], children: {} }
                }
            }
        },
        "서해": {
            "서해남부해상": {
                "서해남부앞바다": {
                    "전북북부앞바다": { current: null, upcoming: null, history: [], children: { "전북북부앞바다중평수구역": null } },
                    "전북남부앞바다": { current: null, upcoming: null, history: [], children: { "전북남부앞바다중평수구역": null } },
                    "전남북부서해앞바다": { current: null, upcoming: null, history: [], children: { "전남북부서해앞바다중평수구역": null } },
                    "전남중부서해앞바다": { current: null, upcoming: null, history: [], children: { "전남중부서해앞바다중먼평수구역": null, "전남중부서해앞바다중앞평수구역": null } },
                    "전남남부서해앞바다": { current: null, upcoming: null, history: [], children: { "전남남부서해앞바다중평수구역": null } }
                },
                "서해남부먼바다": {
                    "서해남부북쪽안쪽먼바다": { current: null, upcoming: null, history: [], children: {} },
                    "서해남부북쪽바깥먼바다": { current: null, upcoming: null, history: [], children: {} },
                    "서해남부남쪽안쪽먼바다": { current: null, upcoming: null, history: [], children: { "서해남부남쪽안쪽먼바다중조도부근평수구역": null } },
                    "서해남부남쪽바깥먼바다": { current: null, upcoming: null, history: [], children: {} }
                }
            },
            "서해중부해상": {
                "서해중부앞바다": {
                    "인천·경기북부앞바다": { current: null, upcoming: null, history: [], children: { "인천·경기북부앞바다중평수구역": null, "인천·경기북부앞바다중연안바다": null } },
                    "인천·경기남부앞바다": { current: null, upcoming: null, history: [], children: { "인천·경기남부앞바다중먼평수구역": null, "인천·경기남부앞바다중북부앞평수구역": null, "인천·경기남부앞바다중남부앞평수구역": null } },
                    "충남북부앞바다": { current: null, upcoming: null, history: [], children: { "천수만평수구역": null, "안면도서쪽평수구역": null, "당진평수구역": null, "태안·서산북쪽평수구역": null } },
                    "충남남부앞바다": { current: null, upcoming: null, history: [], children: { "충남남부앞바다중평수구역": null } }
                },
                "서해중부먼바다": {
                    "서해중부안쪽먼바다": { current: null, upcoming: null, history: [], children: {} },
                    "서해중부바깥먼바다": { current: null, upcoming: null, history: [], children: {} }
                }
            }
        },
        "남해": {
            "남해동부해상": {
                "남해동부앞바다": {
                    "부산앞바다": { current: null, upcoming: null, history: [], children: { "부산앞바다중동부평수구역": null, "부산앞바다중서부평수구역": null, "부산앞바다중연안바다": null } },
                    "경남서부남해앞바다": { current: null, upcoming: null, history: [], children: { "경남서부남해앞바다중동부평수구역": null, "경남서부남해앞바다중서부평수구역": null, "경남서부남해앞바다중남부평수구역": null, "경남서부남해앞바다중남해군연안바다": null } },
                    "경남중부남해앞바다": { current: null, upcoming: null, history: [], children: { "경남중부남해앞바다중평수구역": null, "경남중부남해앞바다중연안바다": null } },
                    "거제시동부앞바다": { current: null, upcoming: null, history: [], children: { "거제시동부앞바다중연안바다": null } }
                },
                "남해동부먼바다": {
                    "남해동부안쪽먼바다": { current: null, upcoming: null, history: [], children: {} },
                    "남해동부바깥먼바다": { current: null, upcoming: null, history: [], children: {} }
                }
            },
            "남해서부해상": {
                "남해서부앞바다": {
                    "전남서부남해앞바다": { current: null, upcoming: null, history: [], children: { "전남서부남해앞바다중평수구역": null } },
                    "전남동부남해앞바다": { current: null, upcoming: null, history: [], children: { "전남동부남해앞바다중서부평수구역": null, "전남동부남해앞바다중동부평수구역": null } }
                },
                "남해서부먼바다": {
                    "남해서부서쪽먼바다": { current: null, upcoming: null, history: [], children: { "남해서부서쪽먼바다중추자도연안바다": null } },
                    "남해서부동쪽먼바다": { current: null, upcoming: null, history: [], children: {} }
                }
            }
        },
        "제주도": {
            "제주도앞바다": {
                "제주도북부앞바다": { current: null, upcoming: null, history: [], children: { "제주도북부앞바다중연안바다": null } },
                "제주도동부앞바다": { current: null, upcoming: null, history: [], children: { "제주도동부앞바다중북동연안바다": null, "제주도동부앞바다중남동연안바다": null, "제주도동부앞바다중우도연안바다": null } },
                "제주도남부앞바다": { current: null, upcoming: null, history: [], children: { "제주도남부앞바다중연안바다": null } },
                "제주도서부앞바다": { current: null, upcoming: null, history: [], children: { "제주도서부앞바다중북서연안바다": null, "제주도서부앞바다중남서연안바다": null, "제주도서부앞바다중가파도연안바다": null } }
            },
            "제주도먼바다": {
                "제주도남쪽바깥먼바다": { current: null, upcoming: null, history: [], children: {} },
                "제주도남동쪽안쪽먼바다": { current: null, upcoming: null, history: [], children: {} },
                "제주도남서쪽안쪽먼바다": { current: null, upcoming: null, history: [], children: {} }
            }
        }
    };
}

function createFullForm() {
    return {
        updatedAt: null,
        lastReportId: null,
        previous: createZoneStructure(),
        current: createZoneStructure()
    };
}

// ============================================================================
// 유틸리티 함수
// ============================================================================

async function fetchHtml(url) {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept-Language': 'ko-KR,ko;q=0.9' }
        }, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        }).on('error', reject);
    });
}

/**
 * 자식 해역 파싱 (warning.do의 특정관리해역 섹션에서 활성화 여부 추출)
 */
function parseChildWarnings(html, form) {
    const startIdx = html.indexOf('특정관리해역');
    if (startIdx === -1) return new Set();

    const section = html.substring(startIdx);
    const endIdx = section.indexOf('참고사항');
    const targetText = (endIdx !== -1 ? section.substring(0, endIdx) : section)
        .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[\s]+/g, ' ');

    const activeChildren = new Set();
    const allChildren = [];

    function collectChildren(obj) {
        if (!obj || typeof obj !== 'object') return;
        if (obj.children) {
            Object.keys(obj.children).forEach(k => allChildren.push(k));
        }
        Object.values(obj).forEach(collectChildren);
    }
    collectChildren(form);

    for (const childName of allChildren) {
        const normalizedChild = childName.replace(/[\s·\.]/g, '');
        const normalizedText = targetText.replace(/[\s·\.]/g, '');

        if (normalizedText.includes(normalizedChild)) {
            activeChildren.add(childName);
        }
    }
    return activeChildren;
}

/**
 * 폼에 데이터 매핑 (부모-자식 상속 해결)
 */
function mapDataToForm(form, activeChildren) {
    function updateChildren(obj) {
        if (!obj || typeof obj !== 'object') return;

        if (obj.current !== undefined && obj.children) {
            for (const childName of Object.keys(obj.children)) {
                if (obj.current === null && obj.upcoming === null) {
                    // [상속 룰] 부모가 발효 중인 특보도 없고 예정된 특보도 없다면 자식도 강제 해제
                    obj.children[childName] = null;
                } else {
                    // 부모가 활성 상태(발효 또는 발표)일 때만 warning.do의 표기 여부에 따름
                    obj.children[childName] = activeChildren.has(childName) ? 'Y' : null;
                }
            }
        }

        for (const value of Object.values(obj)) {
            if (value && typeof value === 'object') updateChildren(value);
        }
    }
    updateChildren(form);
}

// ============================================================================
// 시간 기반 상태 정성 (Pending Status Resolver)
// ============================================================================

function parseKmaTime(timeStr) {
    if (!timeStr || timeStr === "시각미정") return null;
    const match = timeStr.match(/(\d{4})년\s*(\d{2})월\s*(\d{2})일\s*(\d{2})시\s*(\d{2})분/);
    if (!match) return null;
    const [_, y, m, d, h, min] = match;
    return new Date(`${y}-${m}-${d}T${h}:${min}:00+09:00`);
}

/**
 * 발효 시각이 지났으면 상태를 업데이트함
 */
const HISTORY_FILE = path.join(__dirname, 'data/alert_history.json');

function updateHistoryFile(zoneName, event, isRelease = false) {
    try {
        let historyData = {};
        if (fs.existsSync(HISTORY_FILE)) {
            historyData = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        }

        if (isRelease) {
            if (zoneName && historyData[zoneName]) {
                delete historyData[zoneName];
            }
        }
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(historyData, null, 2));
    } catch (e) {
        console.error(`[HistoryFile] Error: ${e.message}`);
    }
}

/**
 * 발효 시각이 지났으면 상태를 업데이트함
 */
function resolvePendingStatuses(obj, zoneName = null, referenceTime = null) {
    if (!obj || typeof obj !== 'object') return;
    const now = referenceTime ? new Date(referenceTime) : new Date();

    if ('current' in obj && 'upcoming' in obj) {
        // 1. 예약된 해제 처리 (tmRelease)
        if (obj.current && obj.current.tmRelease) {
            const releaseTime = parseKmaTime(obj.current.tmRelease);
            if (releaseTime && releaseTime <= now) {
                console.log(`[Resolver] 해제 발효 시각 도달: ${obj.current.tmRelease}`);
                obj.current = null;
                obj.history = []; // [지침 반영] 해제 발효 시 히스토리 즉시 삭제
                if (zoneName) updateHistoryFile(zoneName, null, true);
            }
        }

        // 2. 예약된 발효 처리 (upcoming)
        if (obj.upcoming && obj.upcoming.wrnLvl !== '예비') {
            const effectiveTime = parseKmaTime(obj.upcoming.tmEf);
            if (effectiveTime && effectiveTime <= now) {
                console.log(`[Resolver] 특보 발효 시각 도달: ${obj.upcoming.wrnTp} (${obj.upcoming.tmEf})`);

                // [Fix] 기존 upcoming의 모든 메타데이터(tmFc, tmYn 등)를 상속하며 current로 전환
                obj.current = {
                    ...(obj.current || {}),
                    ...obj.upcoming,
                    tmEf: obj.upcoming.tmEf // 발효시각 확정
                };
                obj.upcoming = null;
            }
        }
    }

    for (const [key, value] of Object.entries(obj)) {
        if (key === 'children' || key === 'history' || key === 'missingCount') continue;
        resolvePendingStatuses(value, key, referenceTime);
    }
}

// ============================================================================
// 변화 감지 로직
// ============================================================================

function detectChanges(previous, current) {
    const changes = [];

    function traverse(prevNode, currNode, path = []) {
        if (!currNode || typeof currNode !== 'object') return;

        if ('current' in currNode && 'upcoming' in currNode) {
            const zoneName = path[path.length - 1];
            const prevCurr = prevNode?.current;
            const currCurr = currNode.current;
            const prevUp = prevNode?.upcoming;
            const currUp = currNode.upcoming;

            // [수정] PushSender와 Type 일치시킴
            // 1. Upcoming 변화 (발표, 예비특보 등)
            // [추가] 격상/격하 판별을 위해 현재 발효 중인 특보(currentActive) 정보도 함께 전달
            if (JSON.stringify(prevUp) !== JSON.stringify(currUp)) {
                changes.push({ type: 'UPCOMING_CHANGE', zone: zoneName, prev: prevUp, curr: currUp, currentActive: currCurr || null });
            }

            // 2. Current 변화 (발효, 해제, 변경 등)
            if (JSON.stringify(prevCurr) !== JSON.stringify(currCurr)) {
                changes.push({ type: 'CURRENT_CHANGE', zone: zoneName, prev: prevCurr, curr: currCurr });
            }
            return;
        }

        for (const [key, value] of Object.entries(currNode)) {
            if (key === 'children' || key === 'history' || key === 'missingCount') continue;
            traverse(prevNode ? prevNode[key] : null, value, [...path, key]);
        }
    }

    traverse(previous, current);
    return changes;
}

// ============================================================================
// Main Execution
// ============================================================================

// [Fix] 동시 실행 방지 Lock — AI 처리가 1분 초과 시 중복 실행되어 데이터 오염 방지
let _isRunning = false;

async function run() {
    if (_isRunning) {
        console.log('[Crawler] 이전 실행이 아직 진행 중, 건너뜀');
        return [];
    }
    _isRunning = true;
    console.log(`[Crawler] 시작: ${new Date().toISOString()}`);

    let fullForm;
    if (fs.existsSync(CONFIG.OUTPUT_FILE)) {
        try {
            const existing = JSON.parse(fs.readFileSync(CONFIG.OUTPUT_FILE, 'utf8'));
            fullForm = {
                updatedAt: null,
                lastReportId: existing.lastReportId || null,
                previous: JSON.parse(JSON.stringify(existing.current || createZoneStructure())),
                current: existing.current || createZoneStructure()
            };
        } catch (e) {
            fullForm = createFullForm();
        }
    } else {
        fullForm = createFullForm();
    }

    try {
        // 1. 시간 기반 예약 처리 선행 실행 (upcoming → current 전환)
        // 해제 이벤트는 current에만 적용되므로, 통보문 처리 전에 상태 전환이 필요
        resolvePendingStatuses(fullForm.current);

        // 2. 통보문 처리 (부모 상태 및 히스토리 업데이트)
        await reportProcessor.applyNewReports(fullForm);

        // 3. 통보문 처리 후 재실행 (새로 생성된 upcoming 처리)
        resolvePendingStatuses(fullForm.current);

        // 3. 특보종합 처리 (연안/평수구역 활성화 여부 확인용)
        const html = await fetchHtml(CONFIG.URL);
        const activeChildren = parseChildWarnings(html, fullForm.current);
        console.log(`[Crawler] 자식 특보(연안/평수) 활성화: ${activeChildren.size}건`);

        // 3. 자식 상속 로직 적용
        mapDataToForm(fullForm.current, activeChildren);

        // 4. 변화 감지 (Previous vs Current)
        const changes = detectChanges(fullForm.previous, fullForm.current);

        if (changes.length > 0) {
            console.log(`🚀 변화 감지: ${changes.length}건`);
            await pushSender.processChanges(changes).catch(err => console.error(`[Push] 오류: ${err.message}`));
        } else {
            console.log('💤 특보 변경 사항 없음');
        }

        // 5. 저장
        fullForm.updatedAt = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        fs.writeFileSync(CONFIG.OUTPUT_FILE, JSON.stringify(fullForm, null, 2), 'utf8');
        console.log(`[Crawler] 저장 완료`);

        return changes;
    } catch (e) {
        console.error(`[Crawler] 오류: ${e.message}`);
        return [];
    } finally {
        _isRunning = false;
    }
}

if (require.main === module) {
    run();
}

module.exports = { run, detectChanges, createFullForm, resolvePendingStatuses, CONFIG };
