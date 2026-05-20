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
// 자식 해역 발표 푸시 — 종합기상 텍스트 기반 트리거.
//   weather.go.kr "특정관리해역" 텍스트의 자식 'Y' 마킹 변화(null→'Y') 감지 시
//   부모 통보문 wrnTp/wrnLvl 상속하여 발표 푸시 발송. dmdw 가 미수록하는
//   "예비" 단계까지 포괄. dmdw FC 정식 발표는 자연 dedup 으로 중복 차단.
const dmdwPushSender = require('./services/dmdw_push_sender');

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
                    "인천·경기북부앞바다": { current: null, upcoming: null, history: [], children: { "인천·경기북부앞바다중평수구역": null } },
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

/**
 * weather_alerts.json 의 빈 골격(full form) 생성 — 첫 수집 시 또는 reset 시 사용.
 * 동/서/남/제주 4 sea 트리 + updatedAt 메타.
 */
function createFullForm() {
    return {
        updatedAt: null,
        lastReportId: null,
        processedReportIds: [],
        // 빈 통보문 재시도 대기 목록 (report_alert_processor.js가 관리)
        // 예: { "met:202604100900:73": { title, firstSeen, retryCount, lastRetry, lastNoticeSent } }
        pendingRetries: {},
        // 첫 부팅 폭주 방지 플래그 — 디스크 영속화.
        //   false 인 동안엔 children null→'Y' 전이가 다수 잡혀도 자식 발표 push 발송 skip.
        //   디스크의 previous 가 stale 이거나 빈 골격이면 첫 사이클에 'Y' 가 다수 잡혀 폭주 위험 → 1회 가드.
        //   첫 사이클 완주 시 true 로 마킹 + saveState 가 자동 저장.
        //   운영자가 재실행 원할 때는 weather_alerts.json 의 이 필드만 삭제 (또는 false 설정).
        //   * 모듈 메모리 방식보다 견고 — 프로세스 재시작 시점에 디스크 previous 가 정확하면 1차 사이클은 베이스라인만 확립.
        bulletinPushBootstrapDone: false,
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

    /**
     * full form 트리 재귀 순회 — 자식해역(children) 만 모음.
     * coastalMap 같은 부수 데이터 빌드 시 사용.
     */
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
 *
 * [사전삭제 방어 로직]
 * 기상청이 특보 해제 전에 warning.do 페이지에서 자식해역 정보를 미리 삭제하는 경우가 있다.
 * 부모 특보가 살아있는데 "이전에 활성화된 자식 전부"가 동시에 사라지면 사전삭제로 간주하여
 * 이전 상태를 유지한다. 일부만 사라진 경우는 정상 해제로 처리한다.
 * 사전삭제로 유지된 자식은 부모 해제 시 함께 자동 해제된다.
 */
function mapDataToForm(form, activeChildren) {
    function updateChildren(obj) {
        if (!obj || typeof obj !== 'object') return;

        if (obj.current !== undefined && obj.children) {
            const childNames = Object.keys(obj.children);

            if (obj.current === null && obj.upcoming === null) {
                // [상속 룰] 부모가 발효 중인 특보도 없고 예정된 특보도 없다면 자식도 강제 해제
                for (const childName of childNames) {
                    obj.children[childName] = null;
                }
            } else {
                // 부모가 활성 상태(발효 또는 발표)
                const prevActive = childNames.filter(name => obj.children[name] === 'Y');

                if (prevActive.length > 0) {
                    // 이전에 활성화된 자식이 있었음
                    const stillInCrawl = prevActive.filter(name => activeChildren.has(name));

                    if (stillInCrawl.length === 0) {
                        // 이전 활성 자식 전부 소멸 → 기상청 사전삭제 → 이전 상태 유지
                        console.log(`[Crawler] 사전삭제 감지: 부모 특보 활성 중 자식 ${prevActive.length}개 전체 소멸 → 이전 상태 유지 (${prevActive.join(', ')})`);
                    } else {
                        // 일부 자식이 크롤링에 존재 → 크롤링 결과를 신뢰
                        for (const childName of childNames) {
                            obj.children[childName] = activeChildren.has(childName) ? 'Y' : null;
                        }
                    }
                } else {
                    // 이전에 활성화된 자식 없음 → 크롤링 결과 그대로 반영
                    for (const childName of childNames) {
                        obj.children[childName] = activeChildren.has(childName) ? 'Y' : null;
                    }
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

        // 1-2. tmCc 기반 자동 해제 (해제 예정 시각이 명확한 경우)
        // tmRelease가 없더라도, tmCc에 파싱 가능한 명확한 시각이 있으면 해제 처리
        // 범위형("오늘 밤(21시~24시)")은 parseKmaTime이 null을 반환하므로 안전
        if (obj.current && !obj.current.tmRelease && obj.current.tmCc) {
            const ccTime = parseKmaTime(obj.current.tmCc);
            if (ccTime && ccTime <= now) {
                console.log(`[Resolver] 해제 예정 시각(tmCc) 도달: ${obj.current.tmCc}`);
                obj.current = null;
                obj.history = [];
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

    /**
     * 이전 트리(prevNode) 와 현재 트리(currNode) 를 동시에 재귀 순회하여
     * 변경 사항(추가/해제/격상격하) 을 path 배열에 누적 — diff 알고리즘.
     */
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
// 종합기상 텍스트 기반 자식 발표 푸시 트리거
// ============================================================================
//
// 배경:
//   - dmdw API 는 "정식 발표(tmEf 명시)" 또는 "발효" 단계만 등록. "예비" 단계 미수록.
//   - weather.go.kr 종합기상 "특정관리해역" 텍스트는 "예비" 단계부터 자식 명 기록.
//   - parseChildWarnings + mapDataToForm 가 obj.children[name] = 'Y' | null 마킹.
//   - 따라서 종합기상의 children null→'Y' 전이를 보면 "예비/발표" 자식 발표를
//     dmdw 보다 빨리 감지 가능 → 발표 푸시 트리거.
//
// 정책 (PUBLISH_TRIGGER_SPEC.md 표):
//   | 시점        | 데이터 변화                          | 푸시                      |
//   | 예비 발표   | 종합기상 텍스트 자식 신규 'Y'        | 📢 발표 (발효시각 미포함) |
//   | 정식 발표   | dmdw FC 신규 자식 등장               | ❌ 추가 푸시 없음 (이미 발표 푸시 보냄) |
//   | 발효 시각   | dmdw EF 신규 자식 등장               | 🚨 발효 (정확한 tmEf)     |
//   | EF 사라짐   | 자식 release                         | ✅ 해제                   |
//
// 중복 dedup:
//   - dmdw_push_sender._dedupKey 가 publish 계열에서 tmEf 를 제외하도록 변경됨.
//   - 결과: 종합기상에서 보낸 (parent|child|wrnTpNm|wrnLvlNm||publish) 와
//          dmdw FC 가 enqueuePublish(tmEf=...) 으로 호출한 키가 같은 dedup 키로 결합되어
//          dmdw FC publish 가 자연 차단됨 (운영자가 두 번 받지 않음).
//
// 첫 부팅 폭주 방지 (디스크 영속화):
//   - 디스크의 previous 가 stale (서버 재시작 직전 결과) 또는 빈 골격인 케이스가 다수.
//   - 부팅 직후 첫 사이클에 null→'Y' 전이가 다수 잡히면 폭주 → fullForm.bulletinPushBootstrapDone
//     플래그(디스크 영속) 가 false 인 동안 발송 skip. 첫 사이클 완주 시 true 로 마킹.
//   - corrupt JSON fallback 진입 시에도 createFullForm() 의 기본값 false 가 적용되어 자동 보호.
//
// 안전망:
//   - 변화 개수 ≥ BULLETIN_PUSH_MAX(=100) 면 폭주 방지 차원에서 모두 skip + 경고.
//     (dmdw 백필 BACKFILL_PUSH_MAX 와 동일한 100 으로 통일 — 두 경로 안전망 일관)
//   - 모든 enqueue/flush 호출은 try-catch 흡수 → 크롤러 본체 무영향.

const BULLETIN_PUSH_MAX = 100;

/**
 * 부모|자식 풀네임에서 표시용 짧은 자식명 추출.
 *   dmdw_warn_crawler.js 의 _childDisplayNameFromKey 와 동일 정책으로,
 *   두 경로(text/dmdw) 가 같은 dedup 키와 같은 푸시 본문 표기를 만든다.
 *     "서해남부남쪽안쪽먼바다중조도부근평수구역" + parent="서해남부남쪽안쪽먼바다"
 *       → "조도부근평수구역"
 *     "울릉도울릉읍연안바다" → 그대로 (prefix 매치 없음)
 *     "당진평수구역" → 그대로 (NO_JOONG 예외 — '중' 절단자 없음)
 */
function _bulletinChildDisplayName(parentZone, childFullName) {
    if (!childFullName) return '';
    const p = String(parentZone || '').replace(/\s+/g, '');
    const joiner = `${p}중`;
    if (p && childFullName.startsWith(joiner)) {
        return childFullName.substring(joiner.length);
    }
    return childFullName;
}

/**
 * 두 zone tree 를 동시 재귀 순회하며 children 의 null↔'Y' 전이를 수집한다.
 *   prev / curr 노드 구조: { current, upcoming, history, children: { name: 'Y'|null } }
 * @returns {{candidates, releasedYToNull}}
 *   candidates : Array<{parentZone, childName, parentMeta}>  (null→'Y' 발표 후보)
 *   releasedYToNull : Array<{parentZone, childName}>          ('Y'→null 해제 — 마커 정리용)
 *   parentMeta = upcoming 우선 (예비 단계엔 upcoming 만 채워짐), 없으면 current.
 *     둘 다 없으면 candidate 자체 제외 (mapDataToForm 강제 해제 정책상 발생 불가).
 */
function collectBulletinPublishCandidates(prevTree, currTree) {
    const candidates = [];
    const releasedYToNull = [];

    function walk(prevNode, currNode, lastParentKey) {
        if (!currNode || typeof currNode !== 'object') return;

        const isZoneLeaf = (
            currNode.current !== undefined
            && currNode.children
            && typeof currNode.children === 'object'
        );

        if (isZoneLeaf && lastParentKey) {
            const parentZone = lastParentKey;
            const prevChildren = (prevNode && prevNode.children) || {};
            const currChildren = currNode.children || {};

            // 부모 메타 — upcoming 우선 (예비 단계엔 upcoming 만 채워짐), 없으면 current.
            const meta = currNode.upcoming || currNode.current || null;

            for (const childName of Object.keys(currChildren)) {
                const wasY = prevChildren[childName] === 'Y';
                const isY = currChildren[childName] === 'Y';
                if (!wasY && isY) {
                    // null → 'Y' 전이 — 발표 푸시 후보.
                    if (meta && (meta.wrnTpNm || meta.wrnTp)) {
                        candidates.push({ parentZone, childName, parentMeta: meta });
                    }
                    // 부모 메타 없으면 push skip — mapDataToForm 의 강제 해제 정책상
                    // 거의 발생 불가능 케이스지만 보수적 처리.
                } else if (wasY && !isY) {
                    // 'Y' → null 전이. dmdw EF release 경로가 이미 forgetChild 를
                    // 호출할 수 있으나, 종합기상에서 먼저 사라진 경우 dmdw 경로가
                    // 누락될 수 있어 여기서도 보수적으로 publish 마커 정리 대상에 포함.
                    releasedYToNull.push({ parentZone, childName });
                }
            }
            return;
        }

        // 비-leaf 노드는 재귀 — key 가 부모 zone 이름이 될 수 있으므로 추적.
        for (const [key, value] of Object.entries(currNode)) {
            if (key === 'children' || key === 'history' || key === 'missingCount'
                || key === 'current' || key === 'upcoming') continue;
            const prevSub = prevNode ? prevNode[key] : null;
            walk(prevSub, value, key);
        }
    }

    walk(prevTree, currTree, null);
    return { candidates, releasedYToNull };
}

/**
 * 종합기상 텍스트 기반 발표 푸시 발송.
 *   - fullForm.bulletinPushBootstrapDone === false 면 발송 skip + 첫 사이클 완주 후 true 마킹.
 *   - 변화 개수 안전망 (≥ BULLETIN_PUSH_MAX 면 전체 skip + 경고)
 *   - 'Y'→null 자식은 forgetChild 로 publish 마커 정리 (다음 신규 발효 시 다시 푸시 가능)
 *   - 각 후보에 대해 enqueuePublishFromBulletin 호출 (tmEf 빈 문자열, '예비'→'주의보' 정규화)
 *   - flush() 1회
 *   모든 오류는 흡수 — 크롤러 본체 흐름 무영향.
 *
 *  @returns {boolean} 이번 사이클이 부트스트랩 사이클이었으면 true (호출자가 플래그 마킹).
 */
async function dispatchBulletinPublishPushes(prevTree, currTree, bootstrapDone) {
    try {
        const { candidates, releasedYToNull } = collectBulletinPublishCandidates(prevTree, currTree);

        // 'Y' → null 전이는 자식 해제 의미 — _sentKeys 의 publish 마커 정리.
        //   dmdw 경로와 동일한 짧은 표시 이름으로 forgetChild 호출.
        //   (부트스트랩 사이클에도 정리 — 마커가 stale 일 수 있어 보수적)
        for (const r of releasedYToNull) {
            try {
                const childDisplay = _bulletinChildDisplayName(r.parentZone, r.childName);
                dmdwPushSender.forgetChild(r.parentZone, childDisplay);
            } catch (_) {}
        }

        if (!bootstrapDone) {
            // 첫 사이클: 디스크의 previous 가 이전 세션 결과 또는 stale 일 수 있어
            // null→'Y' 가 다수 잡힐 우려. 폭주 방지 차원에서 발송 skip + 베이스라인 확립.
            console.log(`[Crawler] bulletin push bootstrap — 첫 사이클 자식 발표 push 발송 skip (후보 ${candidates.length}건 / 베이스라인 확립)`);
            return true;  // 호출자가 플래그 true 로 마킹.
        }

        if (candidates.length === 0) return false;

        if (candidates.length >= BULLETIN_PUSH_MAX) {
            console.warn(
                `[Crawler] bulletin push 안전망 발동: ${candidates.length}건 ≥ ${BULLETIN_PUSH_MAX} → 모두 skip`
            );
            return false;
        }

        const cycleId = `bulletin-${Date.now()}`;
        let enq = 0;
        for (const c of candidates) {
            try {
                const m = c.parentMeta || {};
                // 표시용 짧은 자식명 — dmdw_warn_crawler 와 동일 정책으로 dedup key 일치.
                const displayName = _bulletinChildDisplayName(c.parentZone, c.childName);
                // 부모 스키마(report_alert_processor 산출): wrnTp(한글명), wrnLvl ('예비'|'주의보'|'경보')
                //   — wrnTpNm/wrnLvlNm 필드 없음.
                // dmdw 스키마: wrnTpNm/wrnLvlNm 분리.
                // 두 스키마 dedup key 일치를 위해 매핑:
                //   wrnTp / wrnTpNm  ← 부모.wrnTp (예: '풍랑')
                //   wrnLvl / wrnLvlNm ← 부모.wrnLvl 인데 '예비' 는 '주의보' 로 정규화.
                //   사용자 정의: "예비는 추후 발효예정인 주의보". 앱 배지·dmdw 도 '주의보' 표기.
                //   → 종합기상 → dmdw FC 정식 발표 dedup key 자연 일치 → 중복 차단.
                const wrnTpNorm = m.wrnTpNm || m.wrnTp || '';
                const rawLvl = m.wrnLvlNm || m.wrnLvl || '';
                const wrnLvlNorm = rawLvl === '예비' ? '주의보' : rawLvl;
                if (dmdwPushSender.enqueuePublishFromBulletin(cycleId, c.parentZone, displayName, {
                    wrnTp: wrnTpNorm,
                    wrnTpNm: wrnTpNorm,
                    wrnLvl: wrnLvlNorm,
                    wrnLvlNm: wrnLvlNorm,
                    tmFc: m.tmFc || ''
                })) {
                    enq++;
                }
            } catch (e) {
                console.log(`[Crawler] bulletin enqueue 실패 (무시): ${e.message}`);
            }
        }

        if (enq === 0) {
            // 자연 dedup 으로 모두 차단 — 정상 흐름.
            return false;
        }

        try {
            const flushed = await dmdwPushSender.flush(cycleId);
            console.log(
                `[Crawler] bulletin publish flush: 후보 ${candidates.length}건 · 적재 ${enq}건 · 발송 ${(flushed || []).length}건`
            );
        } catch (e) {
            console.log(`[Crawler] bulletin flush 실패 (무시): ${e.message}`);
        }
        return false;
    } catch (e) {
        // 어떤 단계든 본체 흐름은 영향 없도록 흡수.
        console.log(`[Crawler] dispatchBulletinPublishPushes 예외 (무시): ${e.message}`);
        return false;
    }
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
                processedReportIds: existing.processedReportIds || [],
                // [버그 수정] 빈 통보문 재시도 대기 목록 복사
                // 이 필드가 빠지면 매 사이클마다 "첫 감지"로 오인되어 푸시가 매분 발송되는 버그 발생
                // report_alert_processor.js가 이 값을 읽어서 10분 미경과 시 건너뜀
                pendingRetries: existing.pendingRetries || {},
                // 부트스트랩 플래그 — 디스크에서 복원. true 면 자식 발표 push 활성, 미존재 시 false (createFullForm 기본값과 동일).
                //   첫 사이클 완주 시 true 로 마킹되어 다음 사이클부터 정상 발송.
                bulletinPushBootstrapDone: existing.bulletinPushBootstrapDone === true,
                previous: JSON.parse(JSON.stringify(existing.current || createZoneStructure())),
                current: existing.current || createZoneStructure()
            };
        } catch (e) {
            // corrupt JSON fallback — createFullForm() 의 기본값(false) 으로 안전 진입.
            //   bulletinPushBootstrapDone=false 가드가 자동 적용되어 첫 사이클은 push 발송 skip.
            //   previous=빈 골격이라 첫 사이클의 'Y' 가 다수 잡혀도 폭주 없음.
            console.warn(`[Crawler] weather_alerts.json 파싱 실패 → 빈 골격 fallback (bulletinPushBootstrapDone=false 가드 자동 적용): ${e.message}`);
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

        // 3-bis. [종합기상 텍스트 기반 자식 발표 푸시 트리거]
        //   - dmdw 가 잡지 못하는 "예비" 단계까지 포괄하기 위한 보조 트리거.
        //   - previous.children vs current.children null↔'Y' 전이를 발표/해제마커정리로 매핑.
        //   - dmdw_push_sender._dedupKey(publish) 가 tmEf 를 제외하여 dmdw FC 후속 발표와 자연 dedup.
        //   - 부모 푸시 / detectChanges / pushSender 동작 영향 없음 (별도 경로).
        //   - 실패 시 본체 무영향 (함수 내부 try-catch 흡수).
        try {
            const wasBootstrap = await dispatchBulletinPublishPushes(
                fullForm.previous, fullForm.current, fullForm.bulletinPushBootstrapDone === true
            );
            if (wasBootstrap) {
                // 첫 사이클 완주 — 다음 사이클부터 자식 발표 push 활성.
                fullForm.bulletinPushBootstrapDone = true;
                console.log('[Crawler] bulletinPushBootstrapDone=true 마킹 — 다음 사이클부터 자식 발표 push 활성');
            }
        } catch (e) {
            console.error(`[Crawler] 자식 발표 push 처리 오류 (부모 흐름엔 영향 없음): ${e.message}`);
        }

        // 4. 변화 감지 (Previous vs Current)
        const changes = detectChanges(fullForm.previous, fullForm.current);

        if (changes.length > 0) {
            console.log(`🚀 변화 감지: ${changes.length}건`);
            changes.forEach(c => {
                const zone = c.zone;
                const type = c.type;
                const prevInfo = c.prev ? `${c.prev.wrnTp || '?'} ${c.prev.wrnLvl || '?'}` : 'null';
                const currInfo = c.curr ? `${c.curr.wrnTp || '?'} ${c.curr.wrnLvl || '?'}` : 'null';
                console.log(`  [Change] ${type} ${zone}: ${prevInfo} → ${currInfo}`);
            });

            try {
                const pushSuccess = await pushSender.processChanges(changes);
                if (pushSuccess) {
                    console.log('[Crawler] 푸시 발송 완료');
                } else {
                    console.warn('[Crawler] ⚠️ 푸시 발송 실패/일부실패 → pending 저장됨 (다음 실행 시 재시도)');
                }
            } catch (err) {
                console.error(`[Push] 오류: ${err.message}`);
            }
        } else {
            console.log('💤 특보 변경 사항 없음');
            // 변경사항 없어도 미발송 건 재시도 (push_sender 내부에서 pending 확인)
            try {
                await pushSender.processChanges([]);
            } catch (_) {}
        }

        // 5. 저장 (변화 감지 결과와 무관하게 항상 저장 — 데이터 최신 상태 유지)
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
