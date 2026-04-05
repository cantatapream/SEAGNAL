/**
 * ============================================================================
 * 파일명: regional_forecast_collector.js
 * 역할: 각 지방기상청 단기예보 수집 (KMA API 기반)
 * ============================================================================
 *
 * [설명]
 * - 기존 PDF 파싱 방식에서 KMA API Hub 직접 호출 방식으로 전환
 * - 7개 지방기상청의 종합 전망 + 기온 + 해역별 예보를 API로 수집
 * - 발표 주기: 하루 3회 (05시, 11시, 17시)
 *
 * [사용 API]
 * - fct_afs_ds: 단기예보 개황 텍스트 (종합 전망)
 * - fct_afs_dl: 단기예보 상세 데이터 (기온)
 * - getSeaFcst: 해상예보 (해역별 풍향/풍속/날씨/파고)
 *
 * [연계 파일]
 * - marine_weather_api1~5.js → API 수집 모듈
 * - scheduler.js → 주기적 수집 호출, CONFIG.KMA_HUB_KEY 제공
 * - routes/weather.js → /api/regional-forecast 엔드포인트
 * - js/marine_forecast.js → 프론트엔드 표출
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

// KMA API 수집 모듈
const {
    collectOneOfficeFromApi,
    REGIONAL_OFFICES,
    ZONE_TO_OFFICE_MAP,
} = require('./marine_weather_api5');

const { getLatestPublishTm, formatPublishTime } = require('./marine_weather_api1');

const DATA_FILE = path.join(__dirname, 'data', 'regional_forecast.json');

// seaZoneCoordinates.js와 ZONE_TO_OFFICE_MAP 간 이름 차이를 해소하기 위한 별칭
const COASTAL_ZONE_ALIASES = {
    '인천·경기북부앞바다': '경기북부앞바다',
    '인천·경기남부앞바다': '경기남부앞바다',
};

/**
 * 모든 지방기상청의 단기예보를 API로 수집
 * @param {EventEmitter} [progressEmitter] - 진행률 이벤트 전송용 (scheduler.collectProgress)
 * @returns {Promise<Object>} 지방청 코드별 수집 결과 객체
 */
async function collectRegionalForecasts(progressEmitter) {
    console.log('[RegionalForecast] 지방기상청 단기예보 API 수집 시작...');

    // scheduler.js에서 CONFIG.KMA_HUB_KEY를 가져옴
    let authKey = '';
    try {
        const configFile = path.join(__dirname, 'data/api_config.json');
        if (fs.existsSync(configFile)) {
            const fileData = JSON.parse(fs.readFileSync(configFile, 'utf8'));
            if (fileData.KMA_HUB_KEY) authKey = fileData.KMA_HUB_KEY;
        }
    } catch (_) {}
    // 설정 파일에 없으면 기본키 사용
    if (!authKey) {
        authKey = 'ZKEQU5ukRvGhEFObpBbxVw';
    }

    const results = {};
    const codes = Object.keys(REGIONAL_OFFICES);
    const total = codes.length;
    const collectLog = [`[${new Date().toISOString()}] 지방청 API 수집 시작\n`];

    // 순차적으로 수집 (API 부하 방지)
    for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        const officeName = REGIONAL_OFFICES[code].name;
        try {
            if (progressEmitter) {
                progressEmitter.emit('progress', {
                    type: 'general',
                    step: `지방청 예보 (${officeName})`,
                    current: i + 1,
                    total,
                    detail: officeName
                });
            }

            const data = await collectOneOfficeFromApi(code, authKey);
            if (data) {
                results[code] = data;
                const marineCount = Object.keys(data.marineForecast || {}).length;
                const coastalCount = Object.keys(data.coastalForecast || {}).length;
                collectLog.push(`✅ ${officeName}(${code}): 성공 (먼바다 ${marineCount}, 앞바다 ${coastalCount})`);
            } else {
                collectLog.push(`❌ ${officeName}(${code}): 데이터 없음`);
            }
            // 요청 간 딜레이 (API 부하 방지)
            await new Promise(r => setTimeout(r, 300));
        } catch (e) {
            collectLog.push(`❌ ${officeName}(${code}): 오류 - ${e.message}`);
            console.log(`[RegionalForecast] ${code} 수집 실패: ${e.message}`);
        }
    }

    const collectedCount = Object.keys(results).length;
    collectLog.push(`\n수집 결과: ${collectedCount}/${codes.length}개 성공`);
    console.log(`[RegionalForecast] API 수집 완료: ${collectedCount}/${codes.length}개 지방청`);

    // 수집 로그 저장
    try {
        const debugDir = path.join(__dirname, 'data', 'debug_api');
        if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
        fs.writeFileSync(path.join(debugDir, 'collect_result.txt'), collectLog.join('\n'), 'utf8');
    } catch (e) {
        console.error(`[RegionalForecast] 수집 로그 저장 실패: ${e.message}`);
    }

    // 기존 데이터와 병합 (일부만 실패한 경우 이전 데이터 유지)
    let existing = {};
    try {
        if (fs.existsSync(DATA_FILE)) {
            existing = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        }
    } catch (_) {}

    const merged = { ...existing };
    for (const [code, data] of Object.entries(results)) {
        merged[code] = data;
    }
    merged._lastUpdated = new Date().toISOString();

    // 데이터 디렉토리 확인 및 저장
    const dataDir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    fs.writeFileSync(DATA_FILE, JSON.stringify(merged, null, 2), 'utf8');
    return merged;
}

/**
 * 현재 발표 주기에 해당하는 타임스탬프를 반환
 * 가장 최근 발표시각(05, 11, 17시) 기준
 * @returns {string} YYYYMMDDHH00 형식
 */
function getCurrentPublishTimestamp() {
    return getLatestPublishTm();
}

/**
 * 미수집 지방청만 재시도
 * 현재 발표 주기에 해당하는 데이터가 없는 지방청만 수집
 */
async function retryMissingOffices() {
    const currentTs = getCurrentPublishTimestamp();
    let existing = {};
    try {
        if (fs.existsSync(DATA_FILE)) {
            existing = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        }
    } catch (_) {}

    // 인증키 로드
    let authKey = '';
    try {
        const configFile = path.join(__dirname, 'data/api_config.json');
        if (fs.existsSync(configFile)) {
            const fileData = JSON.parse(fs.readFileSync(configFile, 'utf8'));
            if (fileData.KMA_HUB_KEY) authKey = fileData.KMA_HUB_KEY;
        }
    } catch (_) {}
    if (!authKey) authKey = 'ZKEQU5ukRvGhEFObpBbxVw';

    const missingCodes = [];
    for (const code of Object.keys(REGIONAL_OFFICES)) {
        const data = existing[code];
        if (!data || !data.publishTime) {
            missingCodes.push(code);
            continue;
        }
        // publishTm이 현재 발표 주기와 다르면 재수집 대상
        if (data.publishTm && data.publishTm !== currentTs) {
            missingCodes.push(code);
        }
    }

    if (missingCodes.length === 0) return;

    console.log(`[RegionalForecast] 미수집 ${missingCodes.length}개 지방청 재시도: ${missingCodes.map(c => REGIONAL_OFFICES[c].name).join(', ')}`);

    for (const code of missingCodes) {
        try {
            const data = await collectOneOfficeFromApi(code, authKey);
            if (data) {
                existing[code] = data;
            }
            await new Promise(r => setTimeout(r, 300));
        } catch (e) {
            console.log(`[RegionalForecast] ${code} 재수집 실패: ${e.message}`);
        }
    }

    existing._lastUpdated = new Date().toISOString();
    fs.writeFileSync(DATA_FILE, JSON.stringify(existing, null, 2), 'utf8');
}

/**
 * 저장된 지역 예보 데이터 로드
 * @returns {Object} 지방청 코드별 데이터 객체
 */
function loadRegionalForecasts() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        }
    } catch (_) {}
    return {};
}

/**
 * 먼바다 해상예보 데이터 로드 (모든 지방청의 marineForecast를 통합)
 * ZONE_TO_OFFICE_MAP에 따라 해당 구역의 관할 지방청 데이터만 사용
 * @returns {Object} { zoneName: { officeName, publishTime, periods: [...] } }
 */
function loadMarineForecasts() {
    const regional = loadRegionalForecasts();
    const result = {};

    for (const [code, data] of Object.entries(regional)) {
        if (code.startsWith('_') || !data || !data.marineForecast) continue;
        for (const [zoneName, zoneData] of Object.entries(data.marineForecast)) {
            // 해당 구역의 관할 지방청이 맞는지 확인
            const correctOffice = ZONE_TO_OFFICE_MAP[zoneName];
            if (correctOffice && correctOffice !== code) continue;
            result[zoneName] = {
                officeName: data.officeName,
                publishTime: data.publishTime,
                collectedAt: data.collectedAt,
                ...zoneData
            };
        }
    }
    return result;
}

/**
 * 앞바다 해상예보 데이터 로드 (모든 지방청의 coastalForecast를 통합)
 * ZONE_TO_OFFICE_MAP에 따라 해당 구역의 관할 지방청 데이터만 사용
 * @returns {Object} { zoneName: { officeName, publishTime, periods: [...] } }
 */
function loadCoastalForecasts() {
    const regional = loadRegionalForecasts();
    const result = {};

    for (const [code, data] of Object.entries(regional)) {
        if (code.startsWith('_') || !data || !data.coastalForecast) continue;
        for (const [zoneName, zoneData] of Object.entries(data.coastalForecast)) {
            // 해당 구역의 관할 지방청이 맞는지 확인
            const correctOffice = ZONE_TO_OFFICE_MAP[zoneName];
            if (correctOffice && correctOffice !== code) continue;
            const entry = {
                officeName: data.officeName,
                publishTime: data.publishTime,
                collectedAt: data.collectedAt,
                ...zoneData
            };
            result[zoneName] = entry;

            // 별칭도 동일 데이터로 등록 (seaZoneCoordinates.js에서 다른 이름을 사용하는 경우)
            const alias = COASTAL_ZONE_ALIASES[zoneName];
            if (alias) {
                result[alias] = entry;
            }
        }
    }
    return result;
}

module.exports = {
    collectRegionalForecasts,
    retryMissingOffices,
    loadRegionalForecasts,
    loadMarineForecasts,
    loadCoastalForecasts,
    REGIONAL_OFFICES,
    ZONE_TO_OFFICE_MAP
};
