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
 * fct_afs_dl API에서 기온(최저/최고)을 수집
 *
 * 전략:
 *   - fct_afs_dl은 지역별 단기예보 상세 데이터를 제공
 *   - TM_EF(예보 대상 시각)는 12시간 간격: 1200(낮=최고), 0000(밤=최저)
 *   - 관할 지점별로 TA(기온) 수집 후 min~max 범위 산출
 *
 * @param {string} officeCode - 지방기상청 코드 (예: '109')
 * @param {string} authKey - KMA API Hub 인증키
 * @returns {Promise<{low: string, high: string}|null>}
 *   low: "최저기온" (예: "6") 또는 범위 "5 ~ 8"
 *   high: "최고기온" (예: "13") 또는 범위 "13 ~ 18"
 */
async function fetchTemperature(officeCode, authKey) {
    const stnList = OFFICE_STN_LIST[officeCode];
    if (!stnList || stnList.length === 0) return null;

    const officeName = REGIONAL_OFFICES[officeCode]?.name || officeCode;
    const candidates = getPublishTmCandidates();

    // KST 기준 오늘/내일 날짜 계산
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const todayStr = `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, '0')}${String(kst.getUTCDate()).padStart(2, '0')}`;
    const tomorrow = new Date(kst);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowStr = `${tomorrow.getUTCFullYear()}${String(tomorrow.getUTCMonth() + 1).padStart(2, '0')}${String(tomorrow.getUTCDate()).padStart(2, '0')}`;

    // 각 관할 지점별로 기온 수집
    const allLows = [];   // 최저기온(0000 행)들
    const allHighs = [];  // 최고기온(1200 행)들

    for (const stn of stnList) {
        let fetched = false;
        for (const tm of candidates) {
            try {
                const url = `${API_URLS.FCT_AFS_DL}?stn=${stn}&tm=${tm}&disp=0&help=0&authKey=${authKey}`;
                const buffer = await httpsGet(url, 10000);
                const text = decodeEucKr(buffer);

                if (!text.includes('#START7777')) {
                    if (tm === candidates[0]) {
                        console.log(`[MarineWeatherAPI] ${officeName}: fct_afs_dl 응답에 #START7777 없음 (stn=${stn}, tm=${tm}, 길이=${text.length})`);
                    }
                    continue;
                }

                // TA 필드에서 최저/최고 추출
                const temps = parseTaFromFctAfsDl(text, todayStr, tomorrowStr);
                if (temps) {
                    if (temps.low !== null) allLows.push(temps.low);
                    if (temps.high !== null) allHighs.push(temps.high);
                    fetched = true;
                    break; // 이 지점 성공, 다음 지점으로
                } else {
                    if (tm === candidates[0]) {
                        console.log(`[MarineWeatherAPI] ${officeName}: fct_afs_dl TA 파싱 실패 (stn=${stn}, tm=${tm})`);
                    }
                }
            } catch (e) {
                if (tm === candidates[0]) {
                    console.log(`[MarineWeatherAPI] ${officeName}: fct_afs_dl 에러 (stn=${stn}, tm=${tm}): ${e.message}`);
                }
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

    // 범위 산출: 여러 지점의 값 중 min~max
    // 값이 하나뿐이거나 min===max이면 단일 값으로 표시
    const formatRange = (arr) => {
        const min = Math.min(...arr);
        const max = Math.max(...arr);
        return min === max ? `${min}` : `${min} ~ ${max}`;
    };

    const low = allLows.length > 0 ? formatRange(allLows) : null;
    const high = allHighs.length > 0 ? formatRange(allHighs) : null;

    console.log(`[MarineWeatherAPI] ${officeName}: 기온 수집 완료 (최저: ${low || '없음'}, 최고: ${high || '없음'})`);
    return { low, high };
}

/**
 * fct_afs_dl API 응답에서 기온(TA) 최저/최고를 추출
 *
 * 응답 형식 (disp=0):
 *   #START7777
 *   # REG_ID TM_FC TM_EF MOD NE STN C MAN_ID MAN_FC W1 T W2 TA ST SKY PREP WF
 *   11A00101 202604051100 202604051200 A02 0 109 2 shs*** 신현식 S 1 SW 9 90 DB03 1 "구름많고 한때 비"
 *   11A00101 202604051100 202604060000 A02 1 109 2 shs*** 신현식 NW 1 N 6 60 DB03 1 "구름많고 한때 비 곳"
 *   ...
 *   #7777END
 *
 * TM_EF 시각 패턴 (12시간 간격):
 *   - YYYYMMDD1200 → 낮 최고기온
 *   - YYYYMMDD0000 → 밤 최저기온 (전일 밤~당일 아침)
 *
 * 추출 로직:
 *   - 오늘 1200 → 오늘 최고기온
 *   - 오늘 0000 → 오늘 최저기온 (05시 발표에서만 존재)
 *   - 내일 0000 → 오늘밤 최저기온 (11시/17시 발표 폴백)
 *
 * @param {string} text - API 응답 텍스트
 * @param {string} todayStr - YYYYMMDD 형식 오늘 날짜
 * @param {string} tomorrowStr - YYYYMMDD 형식 내일 날짜
 * @returns {{low: number|null, high: number|null}|null}
 */
function parseTaFromFctAfsDl(text, todayStr, tomorrowStr) {
    const lines = text.split('\n');
    let headerFields = [];
    let taIndex = -1;

    let lowTemp = null;       // 오늘 0000 최저기온
    let highTemp = null;      // 오늘 1200 최고기온
    let tonightLow = null;    // 내일 0000 (오늘밤 최저, 폴백용)
    let tomorrowHigh = null;  // 내일 1200 (내일 최고, 17시 발표 폴백용)

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

        // TM_EF 필드 확인
        const tmEfIndex = headerFields.indexOf('TM_EF');
        if (tmEfIndex === -1 || parts.length <= tmEfIndex) continue;

        const tmEf = parts[tmEfIndex];
        const ta = parseFloat(parts[taIndex]);
        if (isNaN(ta)) continue;

        // 오늘 1200 → 최고기온
        if (tmEf === todayStr + '1200') {
            highTemp = ta;
        }
        // 오늘 0000 → 최저기온 (05시 발표에서만 존재)
        if (tmEf === todayStr + '0000') {
            lowTemp = ta;
        }
        // 내일 0000 → 오늘밤 최저기온 (폴백)
        if (tmEf === tomorrowStr + '0000' && tonightLow === null) {
            tonightLow = ta;
        }
        // 내일 1200 → 내일 최고기온 (17시 발표 폴백)
        if (tmEf === tomorrowStr + '1200' && tomorrowHigh === null) {
            tomorrowHigh = ta;
        }
    }

    // 오늘 최저가 없으면 오늘밤 최저(내일 0000)로 대체
    if (lowTemp === null && tonightLow !== null) {
        lowTemp = tonightLow;
    }
    // 오늘 최고가 없으면 내일 최고(내일 1200)로 대체 (17시 발표 등)
    if (highTemp === null && tomorrowHigh !== null) {
        highTemp = tomorrowHigh;
    }

    if (lowTemp === null && highTemp === null) return null;
    return { low: lowTemp, high: highTemp };
}

module.exports = { fetchTemperature };
