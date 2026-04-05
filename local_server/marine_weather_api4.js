/**
 * ============================================================================
 * 파일명: marine_weather_api4.js
 * 역할: KMA getSeaFcst API로 해역별 예보(먼바다/앞바다) 수집
 * ============================================================================
 *
 * [설명]
 * - getSeaFcst API는 해역별 단기 해상예보를 JSON으로 제공
 * - numEf 0~6 = 7개 반일(AM/PM) 기간
 *   numEf 0: 발표시각 직후 반일 (11시 발표 → 오늘 오후)
 *   numEf 1: 그 다음 반일 (11시 발표 → 내일 오전)
 *   ...
 * - dayOffset = Math.floor(numEf / 2), isAM = numEf % 2 === 1
 *   (11시/17시 발표 기준: numEf 0=오후, 1=오전, 2=오후, ...)
 *
 * [반환 데이터 구조]
 * - 기존 regional_forecast.json의 marineForecast/coastalForecast와 호환
 *   { periods: [{ date, period, wind, weather, waveHeight, numEf, wf, wfCd, ... }] }
 *
 * [연계]
 * - marine_weather_api1.js → 상수/유틸리티 참조
 * - forecast.js → 프론트엔드에서 numEf로 AM/PM 판별하여 테이블 렌더링
 * ============================================================================
 */

const {
    API_URLS,
    REGIONAL_OFFICES,
    ZONE_TO_OFFICE_MAP,
    ZONE_REG_ID_MAP,
    httpsGet,
    getLatestPublishTm,
} = require('./marine_weather_api1');

// 풍향 영문 → 한글 변환
const WIND_DIR_KR = {
    'N': '북', 'NNE': '북북동', 'NE': '북동', 'ENE': '동북동',
    'E': '동', 'ESE': '동남동', 'SE': '남동', 'SSE': '남남동',
    'S': '남', 'SSW': '남남서', 'SW': '남서', 'WSW': '서남서',
    'W': '서', 'WNW': '서북서', 'NW': '북서', 'NNW': '북북서',
};

/**
 * 지방기상청 코드에 속하는 모든 해역의 예보를 수집
 *
 * @param {string} officeCode - 지방기상청 코드 (예: '109')
 * @param {string} authKey - KMA API Hub 인증키
 * @returns {Promise<{marineForecast: Object, coastalForecast: Object}>}
 *   marineForecast: { 구역명: { periods: [...] } } (먼바다)
 *   coastalForecast: { 구역명: { periods: [...] } } (앞바다)
 */
async function fetchSeaForecast(officeCode, authKey) {
    const officeName = REGIONAL_OFFICES[officeCode]?.name || officeCode;

    // 이 지방청 관할 해역 목록 추출
    const officeZones = Object.entries(ZONE_TO_OFFICE_MAP)
        .filter(([, code]) => code === officeCode)
        .map(([zoneName]) => zoneName)
        // '경기북부앞바다'는 '인천·경기북부앞바다'의 별칭이므로 중복 제거
        .filter(name => name !== '경기북부앞바다');

    const marineForecast = {};   // 먼바다
    const coastalForecast = {};  // 앞바다

    let successCount = 0;
    let failCount = 0;

    for (const zoneName of officeZones) {
        const regId = ZONE_REG_ID_MAP[zoneName];
        if (!regId) {
            console.log(`[MarineWeatherAPI] ${officeName}: ${zoneName} → regId 미매핑, 건너뜀`);
            failCount++;
            continue;
        }

        try {
            const url = `${API_URLS.GET_SEA_FCST}?pageNo=1&numOfRows=30&dataType=JSON&regId=${regId}&authKey=${authKey}`;
            const buffer = await httpsGet(url, 10000);
            const jsonText = buffer.toString('utf8');
            const data = JSON.parse(jsonText);

            const items = data.response?.body?.items?.item;
            if (!items) {
                failCount++;
                continue;
            }

            const itemArray = Array.isArray(items) ? items : [items];

            // API 아이템 → periods 배열로 변환
            const periods = convertItemsToPeriods(itemArray);

            if (periods.length > 0) {
                const zoneData = { periods };

                if (zoneName.includes('먼바다')) {
                    marineForecast[zoneName] = zoneData;
                } else {
                    coastalForecast[zoneName] = zoneData;
                }
                successCount++;
            }

            // API 부하 방지 딜레이
            await new Promise(r => setTimeout(r, 30));
        } catch (e) {
            console.log(`[MarineWeatherAPI] ${officeName}: ${zoneName}(${regId}) 수집 실패 - ${e.message}`);
            failCount++;
        }
    }

    console.log(`[MarineWeatherAPI] ${officeName}: 해상예보 수집 완료 (성공 ${successCount}, 실패 ${failCount})`);
    return { marineForecast, coastalForecast };
}

/**
 * getSeaFcst API 아이템 배열을 periods 배열로 변환
 *
 * API 아이템 구조:
 *   { numEf, regId, rnYn, tmFc, wd1, wd2, wdTnd, wf, wfCd, wh1, wh2, ws1, ws2 }
 *
 * 변환 결과 (기존 PDF 파싱 결과와 호환되는 형식):
 *   { date, period, wind, weather, waveHeight, numEf, wf, wfCd, wd1, wd2, ws1, ws2, wh1, wh2, rnYn }
 *
 * @param {Object[]} items - API 응답 아이템 배열
 * @returns {Object[]} periods 배열
 */
function convertItemsToPeriods(items) {
    const periods = [];

    for (const item of items) {
        const numEf = item.numEf;
        if (numEf === undefined || numEf === null) continue;

        // 발표시각(tmFc)으로부터 날짜/기간 계산
        const tmFc = String(item.tmFc);
        const publishHour = parseInt(tmFc.substring(8, 10));

        // dayOffset, period(am/pm) 계산
        // 11시/17시 발표: numEf 0=오후, 1=오전, 2=오후, ...
        // 05시 발표: numEf 0=오전, 1=오후, 2=오전, ...
        const isMorningPublish = publishHour < 11;
        let dayOffset, period;

        if (isMorningPublish) {
            // 05시 발표: numEf 0=오늘 오전, 1=오늘 오후, 2=내일 오전, ...
            dayOffset = Math.floor(numEf / 2);
            period = numEf % 2 === 0 ? 'am' : 'pm';
        } else {
            // 11시/17시 발표: numEf 0=오늘 오후, 1=내일 오전, 2=내일 오후, ...
            dayOffset = Math.floor((numEf + 1) / 2);
            period = numEf % 2 === 0 ? 'pm' : 'am';
        }

        // 기준 날짜 계산
        const baseYear = parseInt(tmFc.substring(0, 4));
        const baseMonth = parseInt(tmFc.substring(4, 6)) - 1;
        const baseDay = parseInt(tmFc.substring(6, 8));
        const baseDate = new Date(baseYear, baseMonth, baseDay);
        baseDate.setDate(baseDate.getDate() + dayOffset);

        const dateStr = `${baseDate.getFullYear()}${String(baseDate.getMonth() + 1).padStart(2, '0')}${String(baseDate.getDate()).padStart(2, '0')}`;

        // 풍향 한글 변환 + 풍속 조합
        const wd1Kr = WIND_DIR_KR[item.wd1] || item.wd1 || '';
        const wd2Kr = WIND_DIR_KR[item.wd2] || item.wd2 || '';
        const windDir = wd1Kr === wd2Kr ? wd1Kr : `${wd1Kr}~${wd2Kr}`;
        const windSpeed = `${item.ws1 || 0}~${item.ws2 || 0}`;
        const wind = `${windDir} / ${windSpeed}`;

        // 파고 범위
        const wh1 = item.wh1 !== undefined ? item.wh1 : 0;
        const wh2 = item.wh2 !== undefined ? item.wh2 : 0;
        const waveHeight = wh1 === wh2 ? `${wh1}` : `${wh1}~${wh2}`;

        periods.push({
            date: dateStr,
            period,
            wind,
            weather: item.wf || '-',
            waveHeight,
            // API 원본 필드 (프론트엔드에서 아이콘 등에 활용)
            numEf,
            wf: item.wf,
            wfCd: item.wfCd,
            wd1: item.wd1,
            wd2: item.wd2,
            ws1: item.ws1,
            ws2: item.ws2,
            wh1: item.wh1,
            wh2: item.wh2,
            rnYn: item.rnYn,
        });
    }

    // numEf 순서로 정렬
    periods.sort((a, b) => a.numEf - b.numEf);

    return periods;
}

module.exports = { fetchSeaForecast };
