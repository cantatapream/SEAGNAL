/**
 * ============================================================================
 * 파일명: marine_weather_api2.js
 * 역할: KMA fct_afs_ds API로 단기예보 종합 전망 텍스트 수집
 * ============================================================================
 *
 * [설명]
 * - fct_afs_ds API는 지방기상청별 단기예보 개황 텍스트를 제공
 * - EUC-KR 인코딩, disp=0 형식 (텍스트)
 * - $0: 헤더 (발표자, 발표시각), $1: 육상 개황, $2: 해상 개황(비어있음), $3: 추가
 * - $1 섹션의 텍스트가 기존 PDF의 "□ (종합)..." 내용과 동일
 *
 * [연계]
 * - marine_weather_api1.js → 상수/유틸리티 참조
 * ============================================================================
 */

const {
    API_URLS,
    REGIONAL_OFFICES,
    getPublishTmCandidates,
    formatPublishTime,
    httpsGet,
    decodeEucKr,
} = require('./marine_weather_api1');

/**
 * fct_afs_ds API에서 종합 전망 텍스트를 수집
 *
 * @param {string} stn - 지방기상청 코드 (예: '109')
 * @param {string} authKey - KMA API Hub 인증키
 * @returns {Promise<{summary: string, publishTime: string, publishTm: string, forecasterName: string}|null>}
 *   summary: 종합 전망 텍스트 (□ (종합)... 형태)
 *   publishTime: "MM.DD. HH:MM" 형태 발표시각
 *   publishTm: YYYYMMDDHH00 형태 발표 타임스탬프
 *   forecasterName: 예보관 이름
 */
async function fetchSummary(stn, authKey) {
    const candidates = getPublishTmCandidates();
    const officeName = REGIONAL_OFFICES[stn]?.name || stn;

    for (const tm of candidates) {
        try {
            const url = `${API_URLS.FCT_AFS_DS}?stn=${stn}&tm=${tm}&disp=0&help=0&authKey=${authKey}`;
            const buffer = await httpsGet(url, 10000);
            const text = decodeEucKr(buffer);

            // 유효한 응답인지 확인 (#START7777 마커 존재)
            if (!text.includes('#START7777')) {
                // 첫 번째 후보에서만 디버그 로그 출력 (tm이 가장 최근)
                if (tm === candidates[0]) {
                    console.log(`[MarineWeatherAPI] ${officeName}: fct_afs_ds 응답에 #START7777 없음 (tm=${tm}, 길이=${text.length}, 앞200자=${text.substring(0, 200).replace(/\n/g, '\\n')})`);
                }
                continue;
            }

            // $1 섹션 추출 (육상 개황 = 종합 전망 텍스트)
            const result = parseFctAfsDs(text);
            if (!result || !result.summary) {
                console.log(`[MarineWeatherAPI] ${officeName}: fct_afs_ds 파싱 실패 (tm=${tm}, sections=${text.substring(0, 300).replace(/\n/g, '\\n')})`);
                continue;
            }

            console.log(`[MarineWeatherAPI] ${officeName}: 종합 전망 수집 성공 (tm=${tm})`);
            return {
                summary: result.summary,
                publishTime: formatPublishTime(tm),
                publishTm: tm,
                forecasterName: result.forecasterName || '',
            };
        } catch (e) {
            // 첫 번째 후보에서 에러 발생 시 로그 출력
            if (tm === candidates[0]) {
                console.log(`[MarineWeatherAPI] ${officeName}: fct_afs_ds 에러 (tm=${tm}): ${e.message}`);
            }
            continue;
        }
    }

    console.log(`[MarineWeatherAPI] ${officeName}: 종합 전망 수집 실패 (모든 후보 시도 완료)`);
    return null;
}

/**
 * fct_afs_ds API 응답 텍스트를 파싱하여 섹션별 데이터 추출
 *
 * 응답 구조:
 *   #START7777
 *   $0 헤더 (발표자, 발표시각 등)
 *   $1 육상 개황 (종합 전망 텍스트)
 *   $2 해상 개황 (대부분 비어있음)
 *   $3 기타
 *   #7777END
 *
 * @param {string} text - API 응답 전체 텍스트
 * @returns {{summary: string, forecasterName: string}|null}
 */
function parseFctAfsDs(text) {
    // #START7777 ~ #7777END 사이 추출
    const startIdx = text.indexOf('#START7777');
    const endIdx = text.indexOf('#7777END');
    if (startIdx === -1) return null;

    const body = text.substring(startIdx, endIdx !== -1 ? endIdx : undefined);

    // $ 섹션 분리
    const sections = {};
    const sectionRegex = /\$(\d+)([\s\S]*?)(?=\$\d+|#7777END|$)/g;
    let match;
    while ((match = sectionRegex.exec(body)) !== null) {
        sections[match[1]] = match[2].trim();
    }

    // $0: 헤더에서 예보관 이름 추출
    let forecasterName = '';
    if (sections['0']) {
        // "예보관: 홍길동" 또는 "예보관 : 홍길동" 패턴
        const nameMatch = sections['0'].match(/예보관\s*[:：]\s*([^\n\r]+)/);
        if (nameMatch) {
            forecasterName = nameMatch[1].trim();
        }
    }

    // $1: 육상 개황 = 종합 전망 텍스트
    let summary = sections['1'] || '';
    if (!summary) return null;

    // 줄바꿈 정리: 연속 빈 줄 제거, 앞뒤 공백 정리
    summary = summary
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    // "□ (종합)" 접두어가 없는 경우에도 그대로 반환 (API 원문 유지)
    return { summary, forecasterName };
}

module.exports = { fetchSummary };
