/**
 * ============================================================================
 * 파일명: js/data.js
 * 역할: 데이터 수집(fetchAllData), 부이 데이터, API 상태 관리
 * ============================================================================
 *
 * [설명]
 * - fetchAllData(): 서버에서 특보/부이 데이터를 가져와 appState에 저장
 * - fetchBuoyData(): 부이 관측 데이터 수집
 * - parseBuoyData(): CSV→JSON 변환
 * - flattenAlertsData(): 트리 구조 → 평면 배열 변환
 * - processSingleAlert(): 개별 특보 정규화
 * - ApiStatusManager: API 상태 추적 객체
 *
 * [로딩 순서] 4번째 (utils.js 이후)
 * ============================================================================
 */

async function fetchAllData() {
    if (appState.isLoading) return;
    updateLoading(true);

    // [New] 방문객 카운트 업데이트
    updateVisitorStats();
    // [New] 수집 실패 여부 확인 → 헤더 경고 표시
    checkCollectFailures();

    appState.apiStatus = { hub: 'loading', buoy: 'loading', coastal: 'loading' };
    updateApiStatusDisplay();

    // 초기화
    appState.coastalAlerts = {};
    appState.releasedCoastalZones = {};

    try {
        // 1. 부이 데이터 호출 (비동기 시작)
        const buoyPromise = fetchBuoyData();

        // 2. 특보 데이터 (crawler가 생성한 JSON 파일)
        const alertsResponse = await fetch('/api/weather-alerts?_t=' + Date.now());
        if (alertsResponse.ok) {
            const rootData = await alertsResponse.json();
            // JSON 계층 구조를 appState.alerts(평탄화된 배열)와 appState.coastalAlerts로 변환
            flattenAlertsData(rootData);
            appState.apiStatus.hub = 'success';
        } else {
            console.warn('Weather alerts fetch failed');
            appState.alerts = [];
            appState.apiStatus.hub = 'error';
        }

        appState.lastUpdated = new Date(); // 업데이트 시각 갱신

        // 3. 부이 데이터 대기
        const buoyData = await buoyPromise;
        appState.buoyData = buoyData || {};
        appState.apiStatus.buoy = Object.keys(appState.buoyData).length > 0 ? 'success' : 'warning';

        updateApiStatusDisplay();
        renderApp();
    } catch (error) {
        console.error('Critical Error in fetchAllData:', error);
        appState.hasApiError = true;
        updateApiStatusDisplay();
        renderApp();
    } finally {
        updateLoading(false);
    }
}






// --- Weather Alerts Processing Helper Functions ---

/**
 * 서버에서 최신 특보 데이터를 다시 불러와 appState에 반영
 * 수동 특보 등록/삭제 후 호출하여 zone tree의 최신 상태를 동기화
 */
async function refreshAlertData() {
    try {
        const resp = await fetch('/api/weather-alerts?_t=' + Date.now());
        if (resp.ok) {
            const rootData = await resp.json();
            flattenAlertsData(rootData);
            appState.lastUpdated = new Date();
        }
    } catch (e) {
        console.error('[refreshAlertData] 특보 데이터 갱신 실패:', e.message);
    }
}

/**
 * weather_alerts.json 구조를 기존 UI 렌더링에 맞는 평탄화된 배열 구조로 변환
 * 데이터 깊이가 동적(제주는 3단계, 동해/서해/남해는 4단계)이므로 재귀적으로 탐색
 */
function flattenAlertsData(rootData) {
    const alerts = [];
    const coastalMap = {};
    const seas = rootData.current || {};
    // [Fix] 동일 zone 중복 처리 방지 (만약 JSON 구조에 중복 키가 존재하더라도 안전)
    const processedZones = new Set();

    // 재귀 탐색 함수
    function recursiveFind(obj) {
        for (const key in obj) {
            const val = obj[key];
            // 객체가 아니거나 null이면 패스
            if (!val || typeof val !== 'object') continue;

            // 'current' 또는 'upcoming' 키를 가지고 있다면 구역(Zone) 노드로 판단
            if (Object.prototype.hasOwnProperty.call(val, 'current') ||
                Object.prototype.hasOwnProperty.call(val, 'upcoming')) {

                const zoneName = key; // 키가 곧 구역명 (예: "울산앞바다", "제주도북부앞바다")
                const zoneData = val;

                // [Fix] 이미 처리한 zone은 건너뜀
                if (processedZones.has(zoneName)) continue;
                processedZones.add(zoneName);

                // 1. Current Alert (Active)
                if (zoneData.current) {
                    processSingleAlert(zoneName, zoneData.current, false, alerts, zoneData.children, coastalMap, zoneData.history);
                }

                // 2. Upcoming Alert (Preliminary)
                if (zoneData.upcoming) {
                    processSingleAlert(zoneName, zoneData.upcoming, true, alerts, zoneData.children, coastalMap, zoneData.history);
                }
            } else {
                // 구역 노드가 아니라면 하위로 더 탐색 (Grouping Node)
                recursiveFind(val);
            }
        }
    }

    // 탐색 시작
    recursiveFind(seas);

    appState.alerts = alerts;
    appState.coastalAlerts = coastalMap;
}

/**
 * 단일 특보 객체를 처리하고 연안바다 정보를 매핑
 */
function processSingleAlert(zoneName, alertObj, isUpcoming, alertsArr, childrenObj, coastalMap, history) {
    // alertObj 구조: { wrnTp, wrnLvl, tmFc, tmEf, tmYn }
    const displayLevel = transformLevel(alertObj.wrnLvl);

    // [핵심 수정] 시간 비교 로직 추가
    // tmEf(발효시각)를 파싱하여 현재 시각과 비교
    const now = getKfTime(); // YYYYMMDDHHmm 형식의 현재 시각
    // 범위형 tmEf에서 시작 시각 추출 (예: "2026년 02월 15일 오전(06시~12시)" → 시작시각의 숫자)
    let rawEf = (alertObj.tmEf || '').replace(/[^0-9]/g, ''); // 숫자만 추출
    // 범위형인 경우 숫자가 14자리 이상이 됨 (YYYYMMDD + 시작HH + 종료HH + ...) → 앞 12자리만 사용
    const rangeMatch = (alertObj.tmEf || '').match(/(\d{4})년\s*(\d{2})월\s*(\d{2})일\s*\S*\((\d{2})시~\d{2}시\)/);
    if (rangeMatch) {
        rawEf = rangeMatch[1] + rangeMatch[2] + rangeMatch[3] + rangeMatch[4] + '00';
    } else if (rawEf.length > 12) {
        rawEf = rawEf.substring(0, 12);
    }

    // 미래 발효 여부 확인:
    // 1. isUpcoming 파라미터가 true이면 무조건 예비/발표
    // 2. wrnLvl이 '예비'이면 무조건 예비
    // 3. tmEf가 유효하고(12자리), 현재 시각보다 미래이면 -> 아직 발효 전이므로 '발표(대기)' 상태로 취급
    let reallyUpcoming = isUpcoming || displayLevel === '예비';

    if (!reallyUpcoming && rawEf.length >= 12) {
        if (now < rawEf) {
            // 현재 시각이 발효 시각보다 작음 -> 미래 -> 예비(발표)로 취급
            reallyUpcoming = true;
        }
    }

    const alertItem = {
        zoneName: zoneName,
        regId: zoneName,
        warnType: alertObj.wrnTp,
        level: displayLevel === '예비' ? '주의보' : displayLevel,
        tmFc: alertObj.tmFc,
        tmEf: alertObj.tmEf,
        tmCc: alertObj.tmCc || '',
        tmEd: alertObj.tmYn || alertObj.tmCc,
        command: reallyUpcoming ? '발표' : '발효', // 미래면 '발표', 지났으면 '발효'
        isPreliminary: reallyUpcoming,
        isCoastal: false,
        source: 'CRAWLER',
        prevLevel: null // 격상/격하 시 이전 등급 (history에서 파생)
    };

    // 레벨 재조정: 화면 표시용
    if (displayLevel === '예비') {
        alertItem.level = '예비';
    }

    // [격상/격하 판별] history에서 현재 특보를 생성한 command가 '변경'인지 확인
    // history 구조: [{ type: "풍랑경보", command: "변경", ... }, { type: "풍랑주의보", command: "발효", ... }, ...]
    // history[0]이 가장 최신이며, 현재 current/upcoming 상태를 만든 이벤트에 해당
    if (history && history.length > 0 && displayLevel !== '예비') {
        const baseType = alertObj.wrnTp; // e.g., "풍랑"
        // 같은 특보 종류(wrnTp)에 해당하는 이력만 필터 (다른 종류가 섞일 수 있음)
        const relevantHistory = history.filter(h => h.type && h.type.startsWith(baseType));

        if (relevantHistory.length > 0 && relevantHistory[0].command === '변경') {
            // 현재 상태가 '변경' 명령으로 도달했음 → 격상 또는 격하
            alertItem.command = '변경';

            // 이전 등급 찾기: 같은 종류의 이전 이력 중 현재와 다른 등급을 가진 첫 번째 항목
            const currentLevel = alertObj.wrnLvl; // e.g., "경보"
            for (let i = 1; i < relevantHistory.length; i++) {
                const prevType = relevantHistory[i].type; // e.g., "풍랑주의보"
                const prevLvl = prevType.includes('경보') ? '경보'
                    : prevType.includes('주의보') ? '주의보'
                    : prevType.includes('예비') ? '예비' : null;
                if (prevLvl && prevLvl !== currentLevel) {
                    alertItem.prevLevel = prevLvl;
                    break;
                }
            }
        }
    }

    alertsArr.push(alertItem);

    // 연안바다(Children) 처리
    if (childrenObj) {
        for (const [childName, status] of Object.entries(childrenObj)) {
            // status가 'Y'인 경우 부모 특보 적용
            if (status === 'Y') {
                if (!coastalMap[childName]) coastalMap[childName] = [];
                // 부모 특보 정보를 상속받아 연안바다 특보 객체 생성
                const childAlert = {
                    ...alertItem,
                    zoneName: childName,
                    isCoastal: true,
                    parentZone: zoneName,
                    id: `auto_${childName}_${alertObj.wrnTp}_${reallyUpcoming ? 'pre' : 'act'}`
                };
                coastalMap[childName].push(childAlert);
            }
        }
    }
}

function transformLevel(lvl) {
    if (lvl === '주의') return '주의보';
    return lvl;
}


// --- BUOY API (해양관측 데이터) ---
async function fetchBuoyData() {
    // 로컬 서버 buoys.json 조회
    const url = CONFIG.BUOY_API_URL;

    // console.log('Fetching Buoy Data (Local):', url);

    try {
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const jsonData = await response.json();
        // buoys.json 구조: { updatedAt: ..., raw: "RAW TEXT" }
        const text = jsonData.raw || '';

        // console.log('Buoy Raw Response (first 500 chars):', text.substring(0, 500));
        // console.log('Buoys Updated At:', jsonData.updatedAt);

        const parsed = parseBuoyData(text);
        // console.log('Buoy Parsed:', Object.keys(parsed).length, 'stations');

        return parsed;
    } catch (e) {
        // console.warn(`Local Buoy Fetch failed:`, e.message);
        return getMockBuoyData();
    }

    return getMockBuoyData();
}

function parseBuoyData(text) {
    const lines = text.trim().split('\n');
    const buoyData = {};

    // console.log('Parsing buoy data, total lines:', lines.length);

    lines.forEach((line, idx) => {
        // 헤더/주석 라인 건너뛰기
        if (line.startsWith('#') || line.trim() === '') return;

        // 첫 몇 줄 디버깅
        if (idx < 3) {
            // console.log('Line', idx, ':', line.substring(0, 100));
        }

        // 공백으로 분리 (KMA API는 주로 공백 구분)
        const parts = line.split(/\s+/).map(p => p.trim()).filter(p => p);

        // sea_obs.php 응답 포맷:
        // TP, STN_ID, STN_KO, TM, WH, WD, WS, WS_GST, TW, TA, PA, HM
        if (parts.length < 6) return;

        try {
            // 실제 API 응답 형식 (콘솔에서 확인):
            // TP(0), TM(1), STN_ID(2), STN_KO(3), LON(4), LAT(5), WH(6), WD(7), WS(8), WS_GST(9), TW(10), TA(11), PA(12), HM(13)
            const tp = parts[0];
            const tm = parts[1];
            let stnId = parts[2].replace(/,/g, '').trim();  // 쉼표 제거!
            const stnName = parts[3] ? parts[3].replace(/,/g, '').trim() : stnId;

            // stnId 유효성 검사
            if (!stnId || stnId.length > 8 || stnId.length < 3) return;

            // -99는 결측값(관측 불가)이므로 null로 처리
            const parseValue = (val) => {
                const num = parseFloat(val);
                return (isNaN(num) || num <= -99) ? null : num;
            };

            // 올바른 인덱스 (LON=4, LAT=5 건너뛰고 WH=6부터)
            const wh = parseValue(parts[6]);      // 유의파고
            const wd = parseValue(parts[7]);      // 풍향
            const ws = parseValue(parts[8]);      // 풍속
            const wsGust = parseValue(parts[9]);  // 돌풍
            const tw = parseValue(parts[10]);     // 수온
            const ta = parseValue(parts[11]);     // 기온
            const pa = parseValue(parts[12]);     // 기압
            const hm = parseValue(parts[13]);     // 습도

            buoyData[stnId] = {
                id: stnId,
                name: stnName,
                tm: tm,
                waveHeight: wh,
                windDirection: wd,
                windSpeed: ws,
                windGust: wsGust,
                waterTemp: tw,
                airTemp: ta,
                pressure: pa,
                humidity: hm
            };

            // 처음 3개 파싱 결과 출력
            if (Object.keys(buoyData).length <= 3) {
                // console.log('✓ Parsed:', stnId, stnName, '파고:', wh, '풍속:', ws);
            }
        } catch (e) {
            // console.warn('Buoy parse error at line', idx, e);
        }
    });

    // console.log('Parsed buoy station IDs:', Object.keys(buoyData).slice(0, 10));

    return buoyData;
}

// 부이 데이터 없음 (API 실패 시)
function getMockBuoyData() {
    // console.log('Buoy API returned no data');
    return {};
}

// 풍향을 방위로 변환
function getWindDirectionText(degree) {
    if (degree === null || degree === undefined) return '-';
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
        'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const index = Math.round(degree / 22.5) % 16;
    return directions[index];
}


// 연안바다 및 제외 처리 함수 제거됨


// ----------------------------------------------------------------------------
// UI Rendering
// ----------------------------------------------------------------------------

// API 상태 표시 관리자 (롤링 대신 정적 표시)
const ApiStatusManager = {
    _injectStyles() {
        if (document.getElementById('api-status-styles')) return;
        const style = document.createElement('style');
        style.id = 'api-status-styles';
        style.textContent = `
            .api-status-wrapper {
                height: 24px;
                overflow: hidden;
                position: relative;
                margin-top: 5px;
                background: transparent;
                padding: 0;
                display: flex;
                align-items: center;
                border: none;
            }
            #api-rolling-list {
                list-style: none;
                padding: 0;
                margin: 0;
                width: 100%;
                height: 100%;
            }
            #api-rolling-list li {
                height: 24px;
                display: flex;
                align-items: center;
                justify-content: flex-start;
                gap: 6px;
                font-size: 0.85rem;
                color: #aaa;
                white-space: nowrap;
            }
            .status-update-time {
                color: #8ecfff;
            }
            .status-error {
                color: #ff5252;
                font-weight: 600;
            }
            .status-error i {
                margin-right: 4px;
            }
        `;
        document.head.appendChild(style);
    },

    update() {
        this._injectStyles();

        const list = document.getElementById('api-rolling-list');
        if (!list) return;

        // 에러 표시 로직 제거 (항상 시간 표시)
        const time = new Date(); // 항상 현재 시간 표시 (사용자 요청: 자동 업데이트 및 우측 시계와 동기화)
        const hours = time.getHours();
        const minutes = String(time.getMinutes()).padStart(2, '0');
        const ampm = hours < 12 ? '오전' : '오후';
        const displayHour = hours === 0 ? 12 : (hours > 12 ? hours - 12 : hours);

        const html = `<li><span class="status-update-time">최근 업데이트: ${ampm} ${displayHour}:${minutes}</span></li>`;

        list.innerHTML = html;
    }
};

function updateApiStatusDisplay() {
    ApiStatusManager.update();
}

// --- Accordion Logic ---
window.toggleMainAccordion = function () {
    const body = document.getElementById('main-accordion-body');
    const header = document.getElementById('main-accordion-header');
    if (body) body.classList.toggle('collapsed');
    if (header) header.classList.toggle('collapsed-state');
};

// --- 특보 정렬 함수 ---
// 정렬 우선순위: 1) 특보종류(태풍 > 지진해일 > 폭풍해일 > 풍랑), 2) 경보 > 주의보
// 3) 앞바다 > 먼바다, 4) 앞바다: 북부→남부→서부→동부, 5) 먼바다: 안쪽→바깥쪽
function sortAlertItems(items) {
    const TYPE_ORDER = { '태풍': 1, '지진해일': 2, '폭풍해일': 3, '풍랑': 4 };
    const DIRECTION_ORDER = { '북부': 1, '남부': 2, '서부': 3, '동부': 4 };
    const FAR_SEA_ORDER = { '안쪽': 1, '바깥': 2 };

    // 그룹화된 아이템(배열)인 경우 가장 높은 순위의 특보를 반환하는 헬퍼
    const getRepresentativeAlert = (item) => {
        if (!Array.isArray(item)) return item;
        if (item.length === 0) return null;

        // 그룹 내부 정렬 (가장 높은 우선순위가 0번으로)
        // [수정] 발효 중(Active) 알림이 발표 예정(Preliminary)보다 우선하도록 정렬
        const sorted = [...item].sort((a, b) => {
            // 0. 발효 상태 우선 (isPreliminary: false가 true보다 상단)
            // -> 현재 발효 중인 특보가 미래 발효 예정인 특보보다 먼저 표시되어야 함
            if (a.isPreliminary !== b.isPreliminary) {
                return a.isPreliminary ? 1 : -1; // active(false) first
            }

            const aTypeWeight = TYPE_ORDER[a.warnType] || 99;
            const bTypeWeight = TYPE_ORDER[b.warnType] || 99;
            if (aTypeWeight !== bTypeWeight) return aTypeWeight - bTypeWeight;

            if (a.level === '경보' && b.level !== '경보') return -1;
            if (a.level !== '경보' && b.level === '경보') return 1;

            return 0;
        });
        return sorted[0];
    };

    // 구역명에서 정렬 가중치 계산
    const getZoneSortWeight = (zoneName) => {
        if (!zoneName) return 9999;
        const isNearSea = zoneName.includes('앞바다');
        const isFarSea = zoneName.includes('먼바다');
        let seaTypeWeight = isNearSea ? 0 : (isFarSea ? 1000 : 500);

        let directionWeight = 99;
        for (const [dir, order] of Object.entries(DIRECTION_ORDER)) {
            if (zoneName.includes(dir)) {
                directionWeight = order;
                break;
            }
        }

        let farSeaWeight = 0;
        if (isFarSea) {
            if (zoneName.includes('안쪽')) farSeaWeight = 1;
            else if (zoneName.includes('바깥')) farSeaWeight = 2;
        }

        return seaTypeWeight + directionWeight * 10 + farSeaWeight;
    };

    const isWarning = (item) => {
        const rep = getRepresentativeAlert(item);
        return rep && rep.level === '경보';
    };

    return [...items].sort((a, b) => {
        const repA = getRepresentativeAlert(a);
        const repB = getRepresentativeAlert(b);

        if (!repA) return 1;
        if (!repB) return -1;

        // 0. [추가] 발효 상태 우선 (isPreliminary: false가 true보다 상단)
        // -> 현재 발효 중인 특보가 미래 발효 예정인 특보보다 먼저 표시되어야 함
        if (repA.isPreliminary !== repB.isPreliminary) {
            return repA.isPreliminary ? 1 : -1; // active(false) first
        }

        // 1. 특보 종류 우선순위 (태풍→지진해일→폭풍해일→풍랑)
        const aTypeWeight = TYPE_ORDER[repA.warnType] || 99;
        const bTypeWeight = TYPE_ORDER[repB.warnType] || 99;
        if (aTypeWeight !== bTypeWeight) {
            return aTypeWeight - bTypeWeight;
        }

        // 2. 경보가 주의보보다 상단
        const aIsWarning = isWarning(a);
        const bIsWarning = isWarning(b);
        if (aIsWarning && !bIsWarning) return -1;
        if (!aIsWarning && bIsWarning) return 1;

        // 3. 구역 정렬 (앞바다→먼바다, 방향순서)
        const aWeight = getZoneSortWeight(repA.zoneName);
        const bWeight = getZoneSortWeight(repB.zoneName);

        return aWeight - bWeight;
    });
}

