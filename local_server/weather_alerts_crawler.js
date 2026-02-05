/**
 * 기상특보 통합 크롤러 (weather_alerts_crawler.js)
 * 
 * 기능:
 * 1. 기상청 특보 URL에서 HTML 데이터 수집
 * 2. 부모 해역("동해남부앞바다" 등)의 특보(주의보/경보/예비) 파싱
 * 3. 자식 해역("연안바다", "평수구역")의 활성화 여부(Y/N) 파싱
 * 4. 미리 정의된 고정 스키마(폼)에 데이터를 매핑하여 단일 JSON 파일로 저장
 * 5. Previous/Current 비교를 통한 변화 감지 (푸시 알림 트리거용)
 * 
 * 출력: data/weather_alerts.json
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const pushSender = require('./push_sender');

// ============================================================================
// 설정
// ============================================================================

const CONFIG = {
    URL: 'https://www.weather.go.kr/w/wnuri-fct2021/weather/warning.do',
    OUTPUT_FILE: path.join(__dirname, 'data', 'weather_alerts.json'),
    ALLOWED_TYPES: ['풍랑', '태풍', '지진해일', '폭풍해일']
};

// ============================================================================
// 고정 스키마 (폼) 정의
// ============================================================================

/**
 * 기본 해역 구조 생성 (데이터 없음)
 */
function createZoneStructure() {
    return {
        "동해": {
            "동해남부해상": {
                "동해남부앞바다": {
                    "울산앞바다": { current: null, upcoming: null, children: { "울산앞바다중평수구역": null, "울산앞바다중연안바다": null } },
                    "경북남부앞바다": { current: null, upcoming: null, children: { "경북남부앞바다중평수구역": null, "경북남부앞바다중연안바다": null } },
                    "경북북부앞바다": { current: null, upcoming: null, children: { "경북북부앞바다중연안바다": null } }
                },
                "동해남부먼바다": {
                    "동해남부남쪽안쪽먼바다": { current: null, upcoming: null, children: {} },
                    "동해남부남쪽바깥먼바다": { current: null, upcoming: null, children: {} },
                    "동해남부북쪽안쪽먼바다": { current: null, upcoming: null, children: {} },
                    "동해남부북쪽바깥먼바다": { current: null, upcoming: null, children: {} }
                }
            },
            "동해중부해상": {
                "동해중부앞바다": {
                    "강원북부앞바다": { current: null, upcoming: null, children: { "강원북부앞바다중연안바다": null } },
                    "강원중부앞바다": { current: null, upcoming: null, children: { "강원중부앞바다중연안바다": null } },
                    "강원남부앞바다": { current: null, upcoming: null, children: { "강원남부앞바다중연안바다": null } }
                },
                "동해중부먼바다": {
                    "동해중부안쪽먼바다": { current: null, upcoming: null, children: { "울릉도울릉읍연안바다": null, "울릉도서면연안바다": null, "울릉도북면연안바다": null } },
                    "동해중부바깥먼바다": { current: null, upcoming: null, children: {} }
                }
            }
        },

        "서해": {
            "서해남부해상": {
                "서해남부앞바다": {
                    "전북북부앞바다": { current: null, upcoming: null, children: { "전북북부앞바다중평수구역": null } },
                    "전북남부앞바다": { current: null, upcoming: null, children: { "전북남부앞바다중평수구역": null } },
                    "전남북부서해앞바다": { current: null, upcoming: null, children: { "전남북부서해앞바다중평수구역": null } },
                    "전남중부서해앞바다": { current: null, upcoming: null, children: { "전남중부서해앞바다중먼평수구역": null, "전남중부서해앞바다중앞평수구역": null } },
                    "전남남부서해앞바다": { current: null, upcoming: null, children: { "전남남부서해앞바다중평수구역": null } }
                },
                "서해남부먼바다": {
                    "서해남부북쪽안쪽먼바다": { current: null, upcoming: null, children: {} },
                    "서해남부북쪽바깥먼바다": { current: null, upcoming: null, children: {} },
                    "서해남부남쪽안쪽먼바다": { current: null, upcoming: null, children: { "서해남부남쪽안쪽먼바다중조도부근평수구역": null } },
                    "서해남부남쪽바깥먼바다": { current: null, upcoming: null, children: {} }
                }
            },
            "서해중부해상": {
                "서해중부앞바다": {
                    "인천·경기북부앞바다": { current: null, upcoming: null, children: { "인천·경기북부앞바다중평수구역": null, "인천·경기북부앞바다중연안바다": null } },
                    "인천·경기남부앞바다": { current: null, upcoming: null, children: { "인천·경기남부앞바다중먼평수구역": null, "인천·경기남부앞바다중북부앞평수구역": null, "인천·경기남부앞바다중남부앞평수구역": null } },
                    "충남북부앞바다": { current: null, upcoming: null, children: { "천수만평수구역": null, "안면도서쪽평수구역": null, "당진평수구역": null, "태안·서산북쪽평수구역": null } },
                    "충남남부앞바다": { current: null, upcoming: null, children: { "충남남부앞바다중평수구역": null } }
                },
                "서해중부먼바다": {
                    "서해중부안쪽먼바다": { current: null, upcoming: null, children: {} },
                    "서해중부바깥먼바다": { current: null, upcoming: null, children: {} }
                }
            }
        },

        "남해": {
            "남해동부해상": {
                "남해동부앞바다": {
                    "부산앞바다": { current: null, upcoming: null, children: { "부산앞바다중동부평수구역": null, "부산앞바다중서부평수구역": null, "부산앞바다중연안바다": null } },
                    "경남서부남해앞바다": { current: null, upcoming: null, children: { "경남서부남해앞바다중동부평수구역": null, "경남서부남해앞바다중서부평수구역": null, "경남서부남해앞바다중남부평수구역": null, "경남서부남해앞바다중남해군연안바다": null } },
                    "경남중부남해앞바다": { current: null, upcoming: null, children: { "경남중부남해앞바다중평수구역": null, "경남중부남해앞바다중연안바다": null } },
                    "거제시동부앞바다": { current: null, upcoming: null, children: { "거제시동부앞바다중연안바다": null } }
                },
                "남해동부먼바다": {
                    "남해동부안쪽먼바다": { current: null, upcoming: null, children: {} },
                    "남해동부바깥먼바다": { current: null, upcoming: null, children: {} }
                }
            },
            "남해서부해상": {
                "남해서부앞바다": {
                    "전남서부남해앞바다": { current: null, upcoming: null, children: { "전남서부남해앞바다중평수구역": null } },
                    "전남동부남해앞바다": { current: null, upcoming: null, children: { "전남동부남해앞바다중서부평수구역": null, "전남동부남해앞바다중동부평수구역": null } }
                },
                "남해서부먼바다": {
                    "남해서부서쪽먼바다": { current: null, upcoming: null, children: { "남해서부서쪽먼바다중추자도연안바다": null } },
                    "남해서부동쪽먼바다": { current: null, upcoming: null, children: {} }
                }
            }
        },

        "제주도": {
            "제주도앞바다": {
                "제주도북부앞바다": { current: null, upcoming: null, children: { "제주도북부앞바다중연안바다": null } },
                "제주도동부앞바다": { current: null, upcoming: null, children: { "제주도동부앞바다중북동연안바다": null, "제주도동부앞바다중남동연안바다": null, "제주도동부앞바다중우도연안바다": null } },
                "제주도남부앞바다": { current: null, upcoming: null, children: { "제주도남부앞바다중연안바다": null } },
                "제주도서부앞바다": { current: null, upcoming: null, children: { "제주도서부앞바다중북서연안바다": null, "제주도서부앞바다중남서연안바다": null, "제주도서부앞바다중가파도연안바다": null } }
            },
            "제주도먼바다": {
                "제주도남쪽바깥먼바다": { current: null, upcoming: null, children: {} },
                "제주도남동쪽안쪽먼바다": { current: null, upcoming: null, children: {} },
                "제주도남서쪽안쪽먼바다": { current: null, upcoming: null, children: {} }
            }
        }
    };
}

/**
 * 저장용 전체 폼 (current / previous 포함)
 */
function createFullForm() {
    return {
        updatedAt: null,
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
            let data = '';
            res.setEncoding('utf8');
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

function parseZonesString(str) {
    const results = [];
    // 1. 괄호로 묶인 그룹 찾기 (ex: "서해남부먼바다(서해남부남쪽안쪽먼바다, 서해남부남쪽바깥먼바다)")
    // 괄호 밖의 이름(대표명)과 괄호 안의 이름들(상세명)을 모두 추출해야 함

    // 쉼표로 분리하되, 괄호 안의 쉼표는 무시하도록 할 수도 있으나, 
    // 기상청 데이터 패턴상 "구역명(상세1, 상세2), 구역명2(상세3)" 형태이므로 
    // 정규식으로 그룹을 매칭하는 것이 안전함.
    const groupPattern = /([가-힣·\s]+(?:앞바다|먼바다|해상))(?:\(([^)]+)\))?/g;

    let match;
    while ((match = groupPattern.exec(str)) !== null) {
        const primaryName = match[1].trim();
        const subNamesStr = match[2];

        // 괄호 안의 내용이 있으면 쉼표로 분리하여 각각을 개별 Zone으로 등록
        // 예: 서해남부먼바다(서해남부남쪽안쪽먼바다, 서해남부남쪽바깥먼바다)
        // -> 서해남부남쪽안쪽먼바다, 서해남부남쪽바깥먼바다 각각이 Parent 레벨로 올라가야 함 (스키마에 존재하므로)
        if (subNamesStr) {
            const subNames = subNamesStr.split(',').map(s => s.trim());
            subNames.forEach(subName => {
                results.push({
                    parent: subName, // 상세 구역명을 Parent(메인 키)로 승격
                    children: []     // 이 Zone 하위의 연안/평수구역은 별도 로직으로 처리됨
                });
            });
        } else {
            // 괄호가 없으면 대표명 그대로 사용
            results.push({
                parent: primaryName,
                children: []
            });
        }
    }
    return results;
}

// ============================================================================
// Core Parsers
// ============================================================================

// 1. 부모 해역 파싱 (테이블)
function parseParentWarnings(html) {
    const results = [];
    const trPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch;

    while ((trMatch = trPattern.exec(html)) !== null) {
        const tds = [];
        const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let tdMatch;

        while ((tdMatch = tdRegex.exec(trMatch[1])) !== null) {
            tds.push(tdMatch[1].replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&middot;/g, '·').replace(/\s+/g, ' ').trim());
        }

        if (tds.length >= 6) {
            const wrnTp = tds[0];
            if (CONFIG.ALLOWED_TYPES.some(t => wrnTp.includes(t))) {
                results.push({
                    wrnTp: tds[0],
                    wrnLvl: tds[1],
                    zones: parseZonesString(tds[2]),
                    tmFc: tds[3],
                    tmEf: tds[4],
                    tmYn: tds[5]
                });
            }
        }
    }
    return results;
}

// 2. 자식 해역 파싱 (텍스트)
function parseChildWarnings(html, form) {
    const startIdx = html.indexOf('특정관리해역');
    if (startIdx === -1) return new Set();

    const section = html.substring(startIdx);
    const endIdx = section.indexOf('참고사항');
    const targetText = (endIdx !== -1 ? section.substring(0, endIdx) : section)
        .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[\s]+/g, ' ');

    const activeChildren = new Set();
    const allChildren = [];

    // 폼에서 모든 자식 이름 수집
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

// 3. 폼에 데이터 매핑 (부모-자식 관계 해결)
function mapDataToForm(form, parentWarnings, activeChildren) {
    function findZoneEntry(obj, zoneName) {
        if (!obj || typeof obj !== 'object') return null;
        for (const [key, value] of Object.entries(obj)) {
            if (key === zoneName && value && typeof value === 'object' && 'current' in value) {
                return value;
            }
            const found = findZoneEntry(value, zoneName);
            if (found) return found;
        }
        return null;
    }

    function activateChild(obj, childName) {
        if (!obj || typeof obj !== 'object') return false;
        if (obj.children && obj.children.hasOwnProperty(childName)) {
            obj.children[childName] = 'Y';
            return true;
        }
        for (const value of Object.values(obj)) {
            if (activateChild(value, childName)) return true;
        }
        return false;
    }

    const PARENT_GROUP_MAP = {
        "동해남부앞바다": ["울산앞바다", "경북남부앞바다", "경북북부앞바다"],
        "동해남부먼바다": ["동해남부남쪽안쪽먼바다", "동해남부남쪽바깥먼바다", "동해남부북쪽안쪽먼바다", "동해남부북쪽바깥먼바다"],
        "동해중부앞바다": ["강원북부앞바다", "강원중부앞바다", "강원남부앞바다"],
        "동해중부먼바다": ["동해중부안쪽먼바다", "동해중부바깥먼바다"],
        "서해남부앞바다": ["전북북부앞바다", "전북남부앞바다", "전남북부서해앞바다", "전남중부서해앞바다", "전남남부서해앞바다"],
        "서해남부먼바다": ["서해남부북쪽안쪽먼바다", "서해남부북쪽바깥먼바다", "서해남부남쪽안쪽먼바다", "서해남부남쪽바깥먼바다"],
        "서해중부앞바다": ["인천·경기북부앞바다", "인천·경기남부앞바다", "충남북부앞바다", "충남남부앞바다"],
        "서해중부먼바다": ["서해중부안쪽먼바다", "서해중부바깥먼바다"],
        "남해동부앞바다": ["부산앞바다", "경남서부남해앞바다", "경남중부남해앞바다", "거제시동부앞바다"],
        "남해동부먼바다": ["남해동부안쪽먼바다", "남해동부바깥먼바다"],
        "남해서부앞바다": ["전남서부남해앞바다", "전남동부남해앞바다"],
        "남해서부먼바다": ["남해서부서쪽먼바다", "남해서부동쪽먼바다"],
        "제주도앞바다": ["제주도북부앞바다", "제주도동부앞바다", "제주도남부앞바다", "제주도서부앞바다"],
        "제주도먼바다": ["제주도남쪽바깥먼바다", "제주도남동쪽안쪽먼바다", "제주도남서쪽안쪽먼바다"]
    };

    for (const warning of parentWarnings) {
        for (const zoneInfo of warning.zones) {
            let targetNames = [];
            if (zoneInfo.children.length > 0) {
                targetNames = zoneInfo.children;
            } else {
                if (PARENT_GROUP_MAP[zoneInfo.parent]) {
                    targetNames = PARENT_GROUP_MAP[zoneInfo.parent];
                } else {
                    targetNames = [zoneInfo.parent];
                }
            }

            for (const name of targetNames) {
                const entry = findZoneEntry(form, name);
                if (entry) {
                    // [수정] 발효 시각(tmEf)과 현재 시각 비교 로직 추가
                    // 기상청이 '특보' 테이블에 넣었더라도, 발효 시각이 미래라면 논리적으로는 'upcoming(예비/발표)' 상태여야 함.

                    let targetSlot = 'current'; // 기본값

                    // 1. 명시적으로 '예비'인 경우 -> 당연히 upcoming
                    if (warning.wrnLvl === '예비') {
                        targetSlot = 'upcoming';
                    } else {
                        // 2. 주의보/경보인 경우 -> 시간 체크
                        const now = new Date();
                        // tmEf 포맷 예: "2026-02-06 02:00"
                        const tmEfStr = warning.tmEf || '';
                        const efMatch = tmEfStr.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);

                        if (efMatch) {
                            const efDate = new Date(
                                parseInt(efMatch[1]),
                                parseInt(efMatch[2]) - 1,
                                parseInt(efMatch[3]),
                                parseInt(efMatch[4]),
                                parseInt(efMatch[5])
                            );

                            // 현재 시각 < 발효 시각이면 -> 아직 미발효 -> upcoming으로 이동
                            if (now < efDate) {
                                targetSlot = 'upcoming';
                                // 레벨 표기는 기상청 원문("주의보" 등)을 유지하되, 슬롯만 변경됨
                            }
                        }
                    }

                    // 해당 슬롯에 데이터 할당
                    entry[targetSlot] = {
                        wrnTp: warning.wrnTp,
                        wrnLvl: warning.wrnLvl, // 주의보/경보 텍스트 유지
                        tmFc: warning.tmFc,
                        tmEf: warning.tmEf,
                        tmYn: warning.tmYn
                    };
                }
            }
        }
    }

    for (const childName of activeChildren) {
        activateChild(form, childName);
    }
}

// ============================================================================
// 데이터 보정 로직 (Ghost Alert Prevention)
// ============================================================================

function preserveContinuingAlerts(prevNode, currNode, path = []) {
    if (!currNode || typeof currNode !== 'object') return;

    // Leaf Node 도달
    if ('current' in currNode && 'upcoming' in currNode) {
        // 보정 조건 체크
        // 1. 현재 데이터에는 live 특보가 없음 (삭제됨)
        // 2. 하지만 upcoming(예비/미래발효) 데이터는 있음 (격상/격하 대기)
        // 3. 직전 데이터에는 live 특보가 있었음
        if (currNode.current === null && currNode.upcoming !== null && prevNode && prevNode.current !== null) {

            // [중요] 특보 종류가 같은지 체크해야 할까? 
            // 보통 풍랑주의보 -> 풍랑경보로 가므로 종류(wrnTp)는 같음.
            // 태풍 -> 풍랑으로 바뀌는 경우도 있을 수 있으나, 어쨌든 '공백'보다는 유지가 안전함.

            const zoneName = path.length > 0 ? path[path.length - 1] : 'Unknown';
            const logName = `[GhostFix][${zoneName}]`;

            // 기존 데이터 복사 (유지)
            currNode.current = prevNode.current;
            console.log(`${logName} 🛡️ ${currNode.current.wrnLvl} 유지됨. (사유: ${currNode.upcoming.wrnLvl} 대기중)`);
        }
        return;
    }

    // Child Node 순회
    for (const [key, value] of Object.entries(currNode)) {
        if (key === 'children') continue; // children 속성은 건너뜀 (구조상)

        if (prevNode && prevNode[key]) {
            preserveContinuingAlerts(prevNode[key], value, [...path, key]);
        } else {
            // prev가 없으면 비교 불가 (신규 구조 등)
            // 그냥 지나감
        }
    }
}

// ============================================================================
// 변화 감지 로직
// ============================================================================

function detectChanges(previous, current) {
    const changes = [];

    function traverse(prevNode, currNode, path = []) {
        if (!currNode || typeof currNode !== 'object') return;

        // Leaf Node 도달 (특보 정보가 있는 곳)
        if ('current' in currNode && 'upcoming' in currNode) {
            const zoneName = path[path.length - 1];

            // 1. 발효 특보(current) 비교
            const prevCurr = prevNode?.current;
            const currCurr = currNode.current;

            if (isDifferent(prevCurr, currCurr)) {
                changes.push({
                    type: 'CURRENT_CHANGE',
                    zone: zoneName,
                    prev: prevCurr,
                    curr: currCurr
                });
            }

            // 2. 예비 특보(upcoming) 비교
            const prevUp = prevNode?.upcoming;
            const currUp = currNode.upcoming;

            if (isDifferent(prevUp, currUp)) {
                changes.push({
                    type: 'UPCOMING_CHANGE',
                    zone: zoneName,
                    prev: prevUp,
                    curr: currUp
                });
            }

            return;
        }

        // Child Node 순회
        for (const [key, value] of Object.entries(currNode)) {
            if (key === 'children') continue;

            if (prevNode && prevNode[key]) {
                traverse(prevNode[key], value, [...path, key]);
            } else {
                traverse(null, value, [...path, key]);
            }
        }
    }

    function isDifferent(a, b) {
        if (!a && !b) return false;
        if (!a || !b) return true;

        return a.wrnTp !== b.wrnTp ||
            a.wrnLvl !== b.wrnLvl ||
            a.tmEf !== b.tmEf ||
            a.tmFc !== b.tmFc;
    }

    traverse(previous, current);
    return changes;
}

// ============================================================================
// Main Execution
// ============================================================================

async function run() {
    console.log(`[Crawler] 시작: ${new Date().toISOString()}`);

    // 1. 전체 폼 로드 (기존 파일이 있으면 읽어서 previous로 활용)
    let fullForm;
    if (fs.existsSync(CONFIG.OUTPUT_FILE)) {
        try {
            const existing = JSON.parse(fs.readFileSync(CONFIG.OUTPUT_FILE, 'utf8'));

            // 신규 구조(previous/current)인지 구형 구조(동해, 서해... 바로 시작)인지 확인
            if (existing.current) {
                // 신규 구조: 기존 current를 previous로 이동
                fullForm = {
                    updatedAt: null,
                    previous: existing.current,
                    current: createZoneStructure()
                };
            } else if (existing["동해"]) {
                // 구형 구조: 전체를 previous로
                fullForm = {
                    updatedAt: null,
                    previous: existing,
                    current: createZoneStructure()
                };
            } else {
                fullForm = createFullForm();
            }

        } catch (e) {
            console.error('[Crawler] 기존 파일 로드 실패, 새로 생성합니다.');
            fullForm = createFullForm();
        }
    } else {
        fullForm = createFullForm();
    }

    fullForm.updatedAt = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

    try {
        // 2. 데이터 수집
        const html = await fetchHtml(CONFIG.URL);

        // 3. 파싱 (채우기 대상은 fullForm.current)
        const parentWarnings = parseParentWarnings(html);
        const activeChildren = parseChildWarnings(html, fullForm.current);

        console.log(`[Crawler] 부모 특보: ${parentWarnings.length}건, 자식 특보: ${activeChildren.size}건`);

        // 4. 매핑
        mapDataToForm(fullForm.current, parentWarnings, activeChildren);

        // [New] 4-1. 정보 보정 (격상/격하 시 기존 특보 실종 방지)
        // 기상청 데이터가 "주의보"를 삭제하고 "경보(미래)"만 올리는 경우,
        // 실제로는 발효 시각 전까지 "주의보"가 유지되어야 하므로 previous에서 복구함.
        if (fullForm.previous) {
            preserveContinuingAlerts(fullForm.previous, fullForm.current);
        }

        // 5. 변화 감지 (Previous vs Current)
        const changes = detectChanges(fullForm.previous, fullForm.current);

        if (changes.length > 0) {
            console.log(`🚀 변화 감지: ${changes.length}건`);
            changes.forEach(c => {
                const pStr = c.prev ? `${c.prev.wrnTp}/${c.prev.wrnLvl}` : '(없음)';
                const cStr = c.curr ? `${c.curr.wrnTp}/${c.curr.wrnLvl}` : '(해제)';
                console.log(`   - [${c.zone}] ${c.type}: ${pStr} -> ${cStr}`);
            });

            // [Push Notification] 변화가 있으면 알림 발송 위임
            // 크롤러는 '변화 감지'까지만 담당하고, 그룹핑 및 발송은 push_sender가 담당
            try {
                await pushSender.processChanges(changes);
            } catch (err) {
                console.error(`[Crawler] 알림 발송 위임 실패: ${err.message}`);
            }
        } else {
            console.log('💤 특보 변경 사항 없음');
        }

        // 6. 저장
        const jsonStr = JSON.stringify(fullForm, null, 2);
        fs.writeFileSync(CONFIG.OUTPUT_FILE, jsonStr, 'utf8');
        console.log(`[Crawler] 저장 완료: ${CONFIG.OUTPUT_FILE} (${jsonStr.length} bytes)`);

        return changes; // 호출자에게 변화 내역 반환

    } catch (e) {
        console.error(`[Crawler] 오류 발생: ${e.message}`);
        return [];
    }
}

if (require.main === module) {
    run();
}

module.exports = { run, detectChanges };
