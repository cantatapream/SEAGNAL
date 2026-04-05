/**
 * ============================================================================
 * 파일명: marine_weather_api3.js
 * 역할: KMA fct_afs_dl API로 기온(최저/최고) 수집
 * ============================================================================
 *
 * [설명]
 * - fct_afs_dl API는 지점별 단기예보 상세 데이터를 제공
 * - 각 지방기상청 관할 지점들의 TA(기온) 필드를 수집하여
 *   최저(MIN) ~ 최고(MAX) 범위를 산출
 * - EUC-KR 인코딩, disp=0 형식 (텍스트 테이블)
 * - 오늘 날짜의 기온 데이터만 추출
 *
 * [연계]
 * - marine_weather_api1.js → 상수/유틸리티 참조
 * ============================================================================
 */

const {
    API_URLS,
    REGIONAL_OFFICES,
    OFFICE_STN_LIST,
    getPublishTmCandidates,
    httpsGet,
    decodeEucKr,
} = require('./marine_weather_api1');

/**
 * fct_afs_dl API에서 기온(최저/최고) 범위를 수집
 *
 * 전략: 관할 지점별 TA 값을 모두 수집한 뒤,
 *   오늘의 최저기온(06시) / 최고기온(15시)을 각각 min~max 범위로 산출
 *   → 기존 PDF의 "최저 5.5 ~ 8.0 / 최고 13 ~ 18" 형식과 동일
 *
 * @param {string} officeCode - 지방기상청 코드 (예: '109')
 * @param {string} authKey - KMA API Hub 인증키
 * @returns {Promise<{low: string, high: string}|null>}
 *   low: "최저1 ~ 최저2" (예: "5.5 ~ 8.0")
 *   high: "최고1 ~ 최고2" (예: "13 ~ 18")
 */
async function fetchTemperature(officeCode, authKey) {
    const stnList = OFFICE_STN_LIST[officeCode];
    if (!stnList || stnList.length === 0) return null;

    const officeName = REGIONAL_OFFICES[officeCode]?.name || officeCode;
    const candidates = getPublishTmCandidates();

    // 오늘 날짜 (KST 기준)
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const todayStr = `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, '0')}${String(kst.getUTCDate()).padStart(2, '0')}`;

    // 각 관할 지점별로 기온 수집
    const allLows = [];   // 오늘 최저기온들
    const allHighs = [];  // 오늘 최고기온들

    for (const stn of stnList) {
        let fetched = false;
        for (const tm of candidates) {
            try {
                const url = `${API_URLS.FCT_AFS_DL}?stn=${stn}&tm=${tm}&disp=0&help=0&authKey=${authKey}`;
                const buffer = await httpsGet(url, 10000);
                const text = decodeEucKr(buffer);

                if (!text.includes('#START7777')) continue;

                // TA 필드에서 오늘 최저/최고 추출
                const temps = parseTaFromFctAfsDl(text, todayStr);
                if (temps) {
                    if (temps.low !== null) allLows.push(temps.low);
                    if (temps.high !== null) allHighs.push(temps.high);
                    fetched = true;
                    break; // 이 지점 성공, 다음 지점으로
                }
            } catch (e) {
                continue;
            }
        }
        if (!fetched) {
            console.log(`[MarineWeatherAPI] ${officeName}: 지점 ${stn} 기온 수집 실패`);
        }
    }

    if (allLows.length === 0 && allHighs.length === 0) {
        console.log(`[MarineWeatherAPI] ${officeName}: 기온 데이터 없음`);
        return null;
    }

    // 범위 산출: 모든 지점의 최저 중 min~max, 최고 중 min~max
    const low = allLows.length > 0
        ? `${Math.min(...allLows)} ~ ${Math.max(...allLows)}`
        : null;
    const high = allHighs.length > 0
        ? `${Math.min(...allHighs)} ~ ${Math.max(...allHighs)}`
        : null;

    console.log(`[MarineWeatherAPI] ${officeName}: 기온 수집 완료 (최저: ${low || '없음'}, 최고: ${high || '없음'})`);
    return { low, high };
}

/**
 * fct_afs_dl API 응답에서 오늘 날짜의 TA(기온) 최저/최고를 추출
 *
 * 응답 형식 (disp=0):
 *   #START7777
 *   # REG_ID TM_FC TM_EF ... TA ...
 *   108 202604051100 202604050600 ... 5.0 ...
 *   108 202604051100 202604051500 ... 15.0 ...
 *   ...
 *   #7777END
 *
 * 최저기온: TM_EF가 오늘 0600인 행의 TA
 * 최고기온: TM_EF가 오늘 1500인 행의 TA
 *
 * @param {string} text - API 응답 텍스트
 * @param {string} todayStr - YYYYMMDD 형식 오늘 날짜
 * @returns {{low: number|null, high: number|null}|null}
 */
function parseTaFromFctAfsDl(text, todayStr) {
    const lines = text.split('\n');
    let headerFields = [];
    let taIndex = -1;

    let lowTemp = null;
    let highTemp = null;

    for (const line of lines) {
        const trimmed = line.trim();

        // 헤더 행: "#" 으로 시작하고 필드명 포함
        if (trimmed.startsWith('#') && trimmed.includes('TA')) {
            // "# REG_ID TM_FC TM_EF ... TA ..." 형태
            headerFields = trimmed.substring(1).trim().split(/\s+/);
            taIndex = headerFields.indexOf('TA');
            continue;
        }

        // 주석이나 빈 줄 스킵
        if (trimmed.startsWith('#') || trimmed === '' || trimmed.startsWith('$')) continue;

        // 데이터 행 파싱
        if (taIndex === -1) continue;

        const parts = trimmed.split(/\s+/);
        if (parts.length <= taIndex) continue;

        // TM_EF 필드 확인 (3번째 컬럼, 인덱스 2)
        const tmEfIndex = headerFields.indexOf('TM_EF');
        if (tmEfIndex === -1 || parts.length <= tmEfIndex) continue;

        const tmEf = parts[tmEfIndex];
        if (!tmEf.startsWith(todayStr)) continue;

        const ta = parseFloat(parts[taIndex]);
        if (isNaN(ta)) continue;

        // 0600 = 최저기온 시각
        if (tmEf.includes('0600')) {
            lowTemp = ta;
        }
        // 1500 = 최고기온 시각
        if (tmEf.includes('1500')) {
            highTemp = ta;
        }
    }

    if (lowTemp === null && highTemp === null) return null;
    return { low: lowTemp, high: highTemp };
}

module.exports = { fetchTemperature };
