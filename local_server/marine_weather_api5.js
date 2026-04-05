/**
 * ============================================================================
 * 파일명: marine_weather_api5.js
 * 역할: KMA API 기반 해양기상 수집 - 통합 진입점
 * ============================================================================
 *
 * [설명]
 * - marine_weather_api1~4 모듈을 통합하여 단일 수집 함수 제공
 * - 지방기상청별로 종합 전망 + 기온 + 해역별 예보를 수집
 * - 기존 regional_forecast_collector.js의 collectOneOffice()를 대체
 * - 출력 구조는 기존 regional_forecast.json과 동일
 *
 * [연계 파일]
 * - regional_forecast_collector.js → collectRegionalForecasts()에서 호출
 * - scheduler.js → CONFIG.KMA_HUB_KEY 인증키 제공
 * - routes/weather.js → /api/regional-forecast 엔드포인트
 * ============================================================================
 */

const {
    REGIONAL_OFFICES,
    ZONE_TO_OFFICE_MAP,
    ZONE_REG_ID_MAP,
    formatPublishTime,
} = require('./marine_weather_api1');

const { fetchSummary } = require('./marine_weather_api2');
const { fetchTemperature } = require('./marine_weather_api3');
const { fetchSeaForecast } = require('./marine_weather_api4');

/**
 * 한 지방기상청의 모든 데이터를 API로 수집
 *
 * @param {string} officeCode - 지방기상청 코드 (예: '109')
 * @param {string} authKey - KMA API Hub 인증키
 * @returns {Promise<Object|null>} 기존 regional_forecast.json 구조와 동일한 객체
 */
async function collectOneOfficeFromApi(officeCode, authKey) {
    const office = REGIONAL_OFFICES[officeCode];
    if (!office) return null;

    try {
        // 종합 전망, 기온, 해상예보를 병렬 수집
        const [summaryResult, temperatureResult, seaResult] = await Promise.all([
            fetchSummary(officeCode, authKey).catch(e => {
                console.log(`[MarineWeatherAPI] ${office.name}: 종합 전망 오류 - ${e.message}`);
                return null;
            }),
            fetchTemperature(officeCode, authKey).catch(e => {
                console.log(`[MarineWeatherAPI] ${office.name}: 기온 오류 - ${e.message}`);
                return null;
            }),
            fetchSeaForecast(officeCode, authKey).catch(e => {
                console.log(`[MarineWeatherAPI] ${office.name}: 해상예보 오류 - ${e.message}`);
                return { marineForecast: {}, coastalForecast: {} };
            }),
        ]);

        // 종합 전망도 해상예보도 없으면 실패 처리
        const marineCount = Object.keys(seaResult.marineForecast).length;
        const coastalCount = Object.keys(seaResult.coastalForecast).length;
        if (!summaryResult && marineCount === 0 && coastalCount === 0) {
            console.log(`[MarineWeatherAPI] ${office.name}: 모든 데이터 수집 실패`);
            return null;
        }

        return {
            officeCode,
            officeName: office.name,
            publishTime: summaryResult?.publishTime || formatPublishTime(require('./marine_weather_api1').getLatestPublishTm()),
            publishTm: summaryResult?.publishTm || '',
            summary: summaryResult?.summary || null,
            temperature: temperatureResult,
            marineForecast: seaResult.marineForecast,
            coastalForecast: seaResult.coastalForecast,
            collectedAt: new Date().toISOString(),
            source: 'api',  // PDF가 아닌 API로 수집되었음을 표시
        };
    } catch (e) {
        console.log(`[MarineWeatherAPI] ${office.name}: 수집 오류 - ${e.message}`);
        return null;
    }
}

module.exports = {
    collectOneOfficeFromApi,
    // 하위 모듈 re-export (개별 사용 가능)
    fetchSummary,
    fetchTemperature,
    fetchSeaForecast,
    // 상수 re-export
    REGIONAL_OFFICES,
    ZONE_TO_OFFICE_MAP,
    ZONE_REG_ID_MAP,
};
