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
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │ [부이 데이터 소스 우선순위 / 2026-04-25 갱신]                          │
 * │                                                                        │
 * │  ① /api/buoys (sea_obs.php) — baseline                                │
 * │     - 모든 타입 단일 wh + 풍속/풍향/수온/기온/기압/습도                │
 * │     - J타입(기상1호 22003) 은 marine API 미커버라 baseline 필수        │
 * │                                                                        │
 * │  ② /api/marine-buoys / -wh-buoys / -lh-buoys (marine.kma.go.kr)       │
 * │     - 풍부 필드 (max/sig/ave 파고 + WP/WO + 시정)                      │
 * │     - sea_obs baseline 위에 _mergeNonNull 로 덮어씀 (null 결측은 보존) │
 * │                                                                        │
 * │  [DEPRECATED] /api/kma-buoys (kma_buoy.php) — fetchKmaBuoyData         │
 * │     호환 위해 함수·상수 보존, 호출 사이트만 주석 처리.                 │
 * │                                                                        │
 * │  [후속] /api/marine-vs (시정계 station 181개) — 캐시만 운영,           │
 * │     UI 표시는 별도 작업.                                               │
 * └────────────────────────────────────────────────────────────────────────┘
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
        // 1. 특보 데이터 (crawler가 생성한 JSON 파일) — 스플래시 종료 조건
        // [캐시] 서버 Cache-Control: max-age=30 — 30초 안의 자동 재호출은 브라우저 캐시 사용
        //        이전엔 ?_t=Date.now() 로 캐시를 강제 우회했으나 max-age 가 짧아 신선도 충분.
        const alertsResponse = await fetch('/api/weather-alerts');
        if (alertsResponse.ok) {
            const rootData = await alertsResponse.json();
            flattenAlertsData(rootData);
            appState.apiStatus.hub = 'success';
        } else {
            console.warn('Weather alerts fetch failed');
            appState.alerts = [];
            appState.apiStatus.hub = 'error';
        }

        appState.lastUpdated = new Date();

        // 2. 해상 기상 전망 — 스플래시 종료 조건
        if (typeof loadMarineForecast === 'function') {
            await loadMarineForecast();
        }

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

    // 3. 백그라운드 순차 로딩 (스플래시 종료 후 실행)
    loadBackgroundData();
}

/**
 * 스플래시 종료 후 백그라운드에서 순차적으로 로드하는 데이터
 * 순서: 부이정보 → 해구도 이미지 프리로드
 */
async function loadBackgroundData() {
    try {
        // 3-1. 부이 데이터 로드
        const buoyData = await fetchBuoyData();
        appState.buoyData = buoyData || {};
        appState.apiStatus.buoy = Object.keys(appState.buoyData).length > 0 ? 'success' : 'warning';
        updateApiStatusDisplay();

        // 부이 버튼 색상 갱신
        if (typeof updateBuoyButtonColors === 'function') {
            updateBuoyButtonColors();
        }

        // 3-2. 해구도 이미지 프리로드
        if (window.preloadSeaZoneImage) {
            window.preloadSeaZoneImage();
        }
    } catch (error) {
        console.error('Background data loading error:', error);
    }
}






// --- Weather Alerts Processing Helper Functions ---

/**
 * 서버에서 최신 특보 데이터를 다시 불러와 appState에 반영
 * 수동 특보 등록/삭제 후 호출하여 zone tree의 최신 상태를 동기화
 */
async function refreshAlertData() {
    try {
        // [캐시 강제 우회] 관리자가 특보 수동 등록·삭제 직후 즉시 새 데이터를 보장해야 하므로
        //   `cache: 'no-cache'` 옵션으로 브라우저에 "캐시 사용 말고 서버 검증" 요청.
        //   이전엔 ?_t=Date.now() 로 URL 변형해서 우회했으나, 이 방식이 더 표준적이고 깔끔함.
        //   (서버는 여전히 max-age=30 응답을 보내지만 이 옵션이 우선)
        const resp = await fetch('/api/weather-alerts', { cache: 'no-cache' });
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
    const rangeMatch = (alertObj.tmEf || '').match(/(\d{4})년\s*(\d{2})월\s*(\d{2})일\s*.*?\((\d{2})시~\d{2}시\)/);
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
        tmCcExplicit: alertObj.tmCcExplicit || false, // AI가 통보문에서 직접 추출한 tmCc인지 여부
        tmEd: alertObj.tmYn || alertObj.tmCc,
        command: reallyUpcoming ? '발표' : '발효', // 미래면 '발표', 지났으면 '발효'
        isPreliminary: reallyUpcoming,
        isCoastal: false,
        source: 'CRAWLER',
        prevLevel: null, // 격상/격하 시 이전 등급 (history에서 파생)
        history: history || [] // 해당 해역의 특보 통보문 히스토리 (팝업 표시용)
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
                // [Fix] history는 연안바다에 불필요 (통보문이 연안바다 단위로 발표되지 않으므로)
                const childAlert = {
                    ...alertItem,
                    zoneName: childName,
                    isCoastal: true,
                    parentZone: zoneName,
                    history: [], // 연안바다는 히스토리 미표시
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


// ============================================================================
// [부이 데이터 수집 — 데이터 소스 우선순위 / 2026-04-25 갱신]
// ----------------------------------------------------------------------------
//  1) sea_obs.php (api/buoys) — baseline. 모든 타입(B/C/L/J) 단일 wh + 풍속/풍향/
//     수온/기온/기압/습도. J타입(기상1호 22003) 은 marine API 미커버라 baseline 필수.
//  2) marine.kma.go.kr JSON endpoint (api/marine-*) — 풍부 필드로 baseline 위에 덮어씀.
//       buoy/list    (B): max/sig/ave 파고 + WP(파주기) + WO(파향) + 듀얼 풍속/풍향 +
//                          시정(vs) 등 풀 데이터
//       wh-buoy/list (C): 파고 3종 + WP + 수온
//       lh/list      (L): 풍속/풍향 + 최대순간풍속/풍향 + 기온/기압/습도 + 최고/최저 기온
//  [DEPRECATED] kma_buoy.php (api/kma-buoys, fetchKmaBuoyData) — marine 으로 대체.
//   호환 위해 상수/라우트/함수 정의는 보존, 호출만 차단.
// ============================================================================
async function fetchBuoyData() {
    // 로컬 서버 buoys.json 조회
    const url = CONFIG.BUOY_API_URL;

    try {
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const jsonData = await response.json();
        // buoys.json 구조: { updatedAt: ..., raw: "RAW TEXT" }
        const text = jsonData.raw || '';

        const parsed = parseBuoyData(text);

        // [DEPRECATED 2026-04-25] KMA 부이 상세 데이터 병합 (최대/유의/평균 파고)
        //   marine endpoint 로 대체. 재활성화 시 아래 try 블록 주석 해제.
        // try {
        //     const kmaBuoyData = await fetchKmaBuoyData();
        //     for (const stnId of Object.keys(parsed)) {
        //         if (kmaBuoyData[stnId]) {
        //             parsed[stnId].waveHeightMax = kmaBuoyData[stnId].waveHeightMax;
        //             parsed[stnId].waveHeightSig = kmaBuoyData[stnId].waveHeightSig;
        //             parsed[stnId].waveHeightAvg = kmaBuoyData[stnId].waveHeightAvg;
        //         }
        //     }
        // } catch (e) { }

        // [신규 2026-04-25] marine.kma.go.kr JSON endpoint 데이터 머지
        //   - 3개 endpoint(B/C/L) 병렬 fetch
        //   - 각 타입 매핑 후 stnId 단위로 baseline 위에 덮어씀
        //   - [중요] marine 응답이 결측(null)인 필드는 baseline 값을 보존
        //     (단순 Object.assign 으로 덮으면 marine 의 null 이 sea_obs 의 정상값을
        //      지우는 버그가 생길 수 있어 mergeNonNull 로 분리 처리)
        //   - 실패해도 baseline 은 그대로 남음 (graceful fallback)
        try {
            const marineData = await fetchMarineBuoyData();
            for (const stnId of Object.keys(marineData)) {
                if (parsed[stnId]) {
                    _mergeNonNull(parsed[stnId], marineData[stnId]);
                } else {
                    parsed[stnId] = marineData[stnId];                // baseline 에 없는 부이 추가
                }
            }
        } catch (e) {
            // marine 실패 — sea_obs baseline 만 사용 (graceful)
        }

        return parsed;
    } catch (e) {
        return getMockBuoyData();
    }
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

// [DEPRECATED 2026-04-25] ─────────────────────────────────────────────────────
//   kma_buoy.php 데이터 fetch — marine.kma.go.kr 로 대체.
//   호환을 위해 함수 정의는 보존하되 fetchBuoyData() 의 호출 사이트 주석 처리됨.
//   재활성화 방법: fetchBuoyData() 안의 try 블록 주석 해제.
// ─────────────────────────────────────────────────────────────────────────────
async function fetchKmaBuoyData() {
    try {
        const response = await fetch(CONFIG.KMA_BUOY_API_URL);
        if (!response.ok) return {};
        const jsonData = await response.json();
        const text = jsonData.raw || '';
        return parseKmaBuoyData(text);
    } catch (e) {
        return {};
    }
}

// [DEPRECATED 2026-04-25] kma_buoy.php 응답 파싱 — marine endpoint 로 대체.
// 포맷: TM(0), STN(1), WD1(2), WS1(3), WS1_GST(4), WD2(5), WS2(6), WS2_GST(7),
//        PA(8), HM(9), TA(10), TW(11), WH_MAX(12), WH_SIG(13), WH_AVE(14), WP(15), WO(16)
function parseKmaBuoyData(text) {
    const lines = text.trim().split('\n');
    const result = {};

    lines.forEach(line => {
        if (line.startsWith('#') || !line.trim()) return;
        const parts = line.split(/\s+/).map(p => p.trim()).filter(p => p);
        if (parts.length < 15) return;

        try {
            const stnId = parts[1].trim();
            if (!stnId || stnId.length > 8 || stnId.length < 3) return;

            const parseValue = (val) => {
                const num = parseFloat(val);
                return (isNaN(num) || num <= -99) ? null : num;
            };

            // 같은 부이의 최신 데이터만 유지 (마지막 줄이 최신)
            result[stnId] = {
                waveHeightMax: parseValue(parts[12]),
                waveHeightSig: parseValue(parts[13]),
                waveHeightAvg: parseValue(parts[14]),
            };
        } catch (e) { }
    });

    return result;
}

// ============================================================================
// [메인] fetchMarineBuoyData()  — 신규 2026-04-25
//
//   [무엇을 하는가?]
//   서버의 marine 캐시 라우트 3개(/api/marine-buoys, -wh-buoys, -lh-buoys)를
//   동시에 호출해 부이 종류별 데이터를 받아오고, 우리 앱의 통일된 객체 schema
//   로 변환해 stnId(부이 식별번호) 단위로 묶어 반환.
//
//   [왜 따로 만들었나?]
//   기존에는 sea_obs.php(api/buoys) 한 곳에서만 부이 데이터를 받았는데, 여기엔
//   파주기/파향/시정/최대파고 등이 포함되지 않거나 일부 부이만 커버됨. marine
//   포털의 endpoint 가 더 풍부한 정보를 제공하므로 그쪽으로 보강하는 것이
//   목적.
//
//   [어떻게 동작하나?]
//     1) Promise.allSettled 로 3 endpoint 동시 호출
//        → 한 곳이 실패해도 다른 곳 결과는 머지 진행 (부분 성공 허용)
//     2) 각 endpoint 응답의 data 배열을 부이 종류별 매퍼(mapMarineBuoyB/C/L)로
//        우리 schema 로 변환
//     3) result[stnId] 에 객체 단위로 저장해 반환
//
//   [반환 객체의 키 schema]
//     id, name, tm,                      // 식별·시각
//     waveHeight, waveHeightMax,         // 파고 (단일/최대)
//     waveHeightSig, waveHeightAvg,      // 파고 (유의/평균)
//     wavePeriod, waveDir,               // 파주기·파향
//     windSpeed, windDirection, windGust,// 풍속·풍향·돌풍
//     waterTemp, airTemp,                // 수온·기온
//     pressure, humidity,                // 기압·습도
//     visibility                         // 시정 (m 단위)
//
//   [상위 호출 함수]
//   fetchBuoyData() 가 sea_obs.php 데이터 위에 이 결과를 _mergeNonNull 로 머지.
//
//   [실패 시 동작]
//   3 endpoint 모두 실패하면 빈 객체 반환 → fetchBuoyData() 머지 단계에서
//   sea_obs baseline 만으로 동작 (graceful degradation).
// ============================================================================
async function fetchMarineBuoyData() {
    const result = {};

    // 3개 endpoint 병렬 호출 (각자 실패해도 다른 것은 머지)
    const [bRes, cRes, lRes] = await Promise.allSettled([
        fetch(CONFIG.MARINE_BUOY_API_URL).then(r => r.ok ? r.json() : null),
        fetch(CONFIG.MARINE_WH_BUOY_API_URL).then(r => r.ok ? r.json() : null),
        fetch(CONFIG.MARINE_LH_API_URL).then(r => r.ok ? r.json() : null)
    ]);

    const pickArr = (settled) => (settled.status === 'fulfilled' && settled.value && Array.isArray(settled.value.data)) ? settled.value.data : [];

    pickArr(bRes).forEach(item => {
        const id = String(item.stn_id || '');
        if (!id) return;
        result[id] = mapMarineBuoyB(item);
    });
    pickArr(cRes).forEach(item => {
        const id = String(item.stn_id || '');
        if (!id) return;
        // 같은 stnId 가 B 와 C 에 동시 등장하지 않으므로 단순 set
        result[id] = mapMarineBuoyC(item);
    });
    pickArr(lRes).forEach(item => {
        const id = String(item.stn_id || '');
        if (!id) return;
        result[id] = mapMarineBuoyL(item);
    });

    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// [헬퍼] _mergeNonNull(dst, src)
//
//   [무엇을 하는가?]
//   객체 src 의 필드 중 null/undefined/빈문자열 이 아닌 것만 dst 에 덮어쓰기.
//
//   [왜 필요한가?]
//   marine API 가 어떤 필드를 결측(null) 으로 보낼 때, 단순 Object.assign 을
//   쓰면 sea_obs.php(baseline) 의 정상값을 null 로 덮어쓰는 버그가 발생함.
//   예: baseline 에 pressure=1018 이 있는데 marine 가 pa=null 이면 결과가
//       pressure=null 이 되어 화면에서 "기압" 항목이 사라짐.
//   → 이 함수가 null/undefined/'' 인 src 필드는 무시해 baseline 값을 보존.
//
//   [예외]
//   tm(관측시각) 은 항상 최신값으로 갱신되어야 하므로 별도 처리.
// ─────────────────────────────────────────────────────────────────────────────
function _mergeNonNull(dst, src) {
    if (!src) return dst;
    Object.keys(src).forEach(k => {
        const v = src[k];
        if (v === null || v === undefined) return;       // 결측은 보존
        if (typeof v === 'string' && v.length === 0) return; // 빈 문자열도 보존
        dst[k] = v;
    });
    // [예외] tm 은 marine 의 신선한 관측시각으로 갱신 (있을 때만)
    if (src.tm) dst.tm = src.tm;
    return dst;
}

// ─────────────────────────────────────────────────────────────────────────────
// [헬퍼] _marineObsTmToTm(s)
//
//   [무엇을 하는가?]
//   marine API 가 보내주는 사람이 읽는 형식 "2026.04.25 16:05:00" 을
//   기존 우리 앱이 사용하는 12자리 숫자 형식 "202604251605" 로 변환.
//
//   [왜 필요한가?]
//   기존 부이 모달(seaZones.js displayBuoyDataInModal)이 시각 표시할 때
//   `/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/` 정규식으로 매칭하므로, 마침표·
//   공백·콜론이 섞인 marine 형식을 그대로 두면 매칭 실패해 시각이 안 보임.
//
//   [입력이 비정상이면?]
//   원본 그대로 반환 (downstream 코드가 시각 표시를 자동 스킵).
// ─────────────────────────────────────────────────────────────────────────────
function _marineObsTmToTm(s) {
    if (!s) return '';
    const m = String(s).match(/(\d{4})[.\-\/]?(\d{2})[.\-\/]?(\d{2})\s+(\d{2}):(\d{2})/);
    return m ? (m[1] + m[2] + m[3] + m[4] + m[5]) : String(s);
}

// ─────────────────────────────────────────────────────────────────────────────
// [헬퍼] _mvVal(v)
//
//   [무엇을 하는가?]
//   marine API 응답의 한 필드값을 안전한 number 또는 null 로 정규화.
//
//   [왜 필요한가?]
//   marine API 는 결측값을 null 로 보내지만 가끔 -99 / -9999 같은 sentinel
//   숫자가 섞여 있는 경우가 있고, 문자열 "12.3" 형식도 있을 수 있음.
//   화면 표시 단계에서 sentinel 숫자가 그대로 노출되면 사용자에게 -99 가
//   보이는 사고가 나므로, 이 함수가 한곳에서 일관 처리.
//
//   [반환]
//   null  : 결측·sentinel·NaN 인 경우
//   숫자  : 그 외 정상 측정값
// ─────────────────────────────────────────────────────────────────────────────
function _mvVal(v) {
    if (v === null || v === undefined) return null;
    const n = parseFloat(v);
    if (isNaN(n)) return null;
    if (n <= -99 || n <= -9999) return null;
    return n;
}

// ─────────────────────────────────────────────────────────────────────────────
// [매퍼] mapMarineBuoyB(it)  — B타입(해양기상부이) raw → 우리 schema
//
//   [입력]  marine /buoy/list 응답의 한 부이 항목 (it)
//   [출력]  우리 앱이 사용하는 통일 schema 객체
//
//   [중요 결정 사항]
//   - 풍속/풍향: B타입은 듀얼 센서(상·하단 두 개)를 가지므로 ws_1/wd_1·ws_2/wd_2
//     두 쌍이 응답에 있음. 사용자 결정대로 위쪽 센서(ws_1/wd_1) 사용.
//   - 시정(vs): m 단위. 화면 표시 단계에서 km 로 환산.
// ─────────────────────────────────────────────────────────────────────────────
function mapMarineBuoyB(it) {
    return {
        id: String(it.stn_id || ''),
        name: it.kor_nm || '',
        tm: _marineObsTmToTm(it.obs_tm),
        waveHeight:    _mvVal(it.sig_wh),
        waveHeightMax: _mvVal(it.max_wh),
        waveHeightSig: _mvVal(it.sig_wh),
        waveHeightAvg: _mvVal(it.ave_wh),
        wavePeriod:    _mvVal(it.wp),
        waveDir:       _mvVal(it.wo),
        windSpeed:     _mvVal(it.ws_1),
        windDirection: _mvVal(it.wd_1),
        windGust:      _mvVal(it.ws_1_gst),
        waterTemp:     _mvVal(it.tw),
        airTemp:       _mvVal(it.ta),
        pressure:      _mvVal(it.pa),
        humidity:      _mvVal(it.hm),
        visibility:    _mvVal(it.vs)   // 단위: m (표시 시 km 환산)
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// [매퍼] mapMarineBuoyC(it)  — C타입(파고부이) raw → 우리 schema
//
//   [특징]
//   파고부이는 파고·파주기·수온만 측정하는 단순 부이. 풍속·풍향·기온·기압 등은
//   장비 자체에 없으므로 null 그대로 둠. (한산도 22467 이 대표적인 C 타입)
// ─────────────────────────────────────────────────────────────────────────────
function mapMarineBuoyC(it) {
    return {
        id: String(it.stn_id || ''),
        name: it.kor_nm || '',
        tm: _marineObsTmToTm(it.obs_tm),
        waveHeight:    _mvVal(it.sig_wh),
        waveHeightMax: _mvVal(it.max_wh),
        waveHeightSig: _mvVal(it.sig_wh),
        waveHeightAvg: _mvVal(it.ave_wh),
        wavePeriod:    _mvVal(it.wp),
        waterTemp:     _mvVal(it.tw)
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// [매퍼] mapMarineBuoyL(it)  — L타입(등표) raw → 우리 schema
//
//   [특징]
//   등표는 파고를 측정하지 않고 풍속·풍향·기온·기압·습도만 측정. 풍속/풍향은
//   B타입과 달리 단일 센서이므로 ws/wd 로 끝남. 돌풍 측정값은 따로 없고
//   "최대순간풍속(max_ins_ws)" 을 우리 windGust 에 매핑.
//
//   [필드명 차이 주의]
//   기압이 B타입은 pa, L타입은 ps 로 다름. 우리 schema 의 pressure 필드 하나로
//   일원화해 화면 표시 코드에서 분기 없이 같은 키로 접근.
// ─────────────────────────────────────────────────────────────────────────────
function mapMarineBuoyL(it) {
    return {
        id: String(it.stn_id || ''),
        name: it.kor_nm || '',
        tm: _marineObsTmToTm(it.obs_tm),
        windSpeed:     _mvVal(it.ws),
        windDirection: _mvVal(it.wd),
        windGust:      _mvVal(it.max_ins_ws),
        airTemp:       _mvVal(it.ta),
        pressure:      _mvVal(it.ps),
        humidity:      _mvVal(it.hm)
        // 등표는 파고/수온/시정 미측정 → 해당 필드는 baseline(sea_obs) 값 보존
    };
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

