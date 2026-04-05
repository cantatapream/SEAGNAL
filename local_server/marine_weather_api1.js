/**
 * ============================================================================
 * 파일명: marine_weather_api1.js
 * 역할: KMA API 기반 해양기상 수집 - 상수, 설정, 유틸리티
 * ============================================================================
 *
 * [설명]
 * - 기상청 API Hub(apihub.kma.go.kr) 인증키 및 엔드포인트 설정
 * - 지방기상청 코드(stn) ↔ 해역 구역코드(regId) 매핑
 * - EUC-KR 디코딩, HTTP 요청, 발표시각 계산 등 공통 유틸리티
 *
 * [연계 파일]
 * - marine_weather_api2.js → 종합 전망 수집 (fetchSummary)
 * - marine_weather_api3.js → 기온 수집 (fetchTemperature)
 * - marine_weather_api4.js → 해역별 예보 수집 (fetchSeaForecast)
 * - marine_weather_api5.js → 통합 진입점 (collectAllFromApi)
 * ============================================================================
 */

const https = require('https');

// ─── KMA API 엔드포인트 ───
const API_URLS = {
    // 단기예보 개황 텍스트 (typ01, EUC-KR)
    FCT_AFS_DS: 'https://apihub.kma.go.kr/api/typ01/url/fct_afs_ds.php',
    // 단기예보 상세 데이터 - 기온 등 (typ01, EUC-KR)
    FCT_AFS_DL: 'https://apihub.kma.go.kr/api/typ01/url/fct_afs_dl.php',
    // 해상예보 (typ02, JSON)
    GET_SEA_FCST: 'https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstMsgService/getSeaFcst',
};

// ─── 지방기상청 코드 및 정보 ───
const REGIONAL_OFFICES = {
    '109': { name: '수도권기상청', code: '109' },
    '159': { name: '부산지방기상청', code: '159' },
    '156': { name: '광주지방기상청', code: '156' },
    '105': { name: '강원지방기상청', code: '105' },
    '133': { name: '대전지방기상청', code: '133' },
    '143': { name: '대구지방기상청', code: '143' },
    '184': { name: '제주지방기상청', code: '184' },
};

// ─── 소분류 해역 → 지방기상청 코드 매핑 ───
const ZONE_TO_OFFICE_MAP = {
    // 강원 → 강원지방기상청(105)
    '강원북부앞바다': '105',
    '강원중부앞바다': '105',
    '강원남부앞바다': '105',
    // 경북, 울산 → 대구지방기상청(143)
    '경북북부앞바다': '143',
    '경북남부앞바다': '143',
    '울산앞바다': '143',
    // 부산, 경남, 거제 → 부산지방기상청(159)
    '부산앞바다': '159',
    '경남서부남해앞바다': '159',
    '경남중부남해앞바다': '159',
    '거제시동부앞바다': '159',
    // 인천·경기 → 수도권기상청(109)
    '인천·경기북부앞바다': '109',
    '경기북부앞바다': '109',
    '인천·경기남부앞바다': '109',
    // 충남 → 대전지방기상청(133)
    '충남북부앞바다': '133',
    '충남남부앞바다': '133',
    // 전북, 전남 → 광주지방기상청(156)
    '전북북부앞바다': '156',
    '전북남부앞바다': '156',
    '전남북부서해앞바다': '156',
    '전남중부서해앞바다': '156',
    '전남남부서해앞바다': '156',
    '전남서부남해앞바다': '156',
    '전남동부남해앞바다': '156',
    // 제주 → 제주지방기상청(184)
    '제주도북부앞바다': '184',
    '제주도남부앞바다': '184',
    '제주도동부앞바다': '184',
    '제주도서부앞바다': '184',
    // 먼바다 매핑
    '동해중부안쪽먼바다': '105',
    '동해중부바깥먼바다': '105',
    '동해남부남쪽안쪽먼바다': '159',
    '동해남부남쪽바깥먼바다': '159',
    '동해남부북쪽안쪽먼바다': '143',
    '동해남부북쪽바깥먼바다': '143',
    '서해중부안쪽먼바다': '109',
    '서해중부바깥먼바다': '109',
    '서해남부북쪽안쪽먼바다': '156',
    '서해남부북쪽바깥먼바다': '156',
    '서해남부남쪽안쪽먼바다': '156',
    '서해남부남쪽바깥먼바다': '156',
    '남해동부안쪽먼바다': '159',
    '남해동부바깥먼바다': '159',
    '남해서부서쪽먼바다': '156',
    '남해서부동쪽먼바다': '156',
    '제주도남서쪽안쪽먼바다': '184',
    '제주도남동쪽안쪽먼바다': '184',
    '제주도남쪽바깥먼바다': '184',
};

// ─── 해역 구역명 → getSeaFcst API regId 매핑 ───
// 앞바다 (해상국지 I 코드)
const ZONE_REG_ID_MAP = {
    '강원북부앞바다': '12C20103',
    '강원중부앞바다': '12C20102',
    '강원남부앞바다': '12C20101',
    '경북북부앞바다': '12C10103',
    '경북남부앞바다': '12C10102',
    '울산앞바다': '12C10101',
    '부산앞바다': '12B20103',
    '경남서부남해앞바다': '12B20101',
    '경남중부남해앞바다': '12B20102',
    '거제시동부앞바다': '12B20104',
    '인천·경기북부앞바다': '12A20101',
    '인천·경기남부앞바다': '12A20102',
    '충남북부앞바다': '12A20103',
    '충남남부앞바다': '12A20104',
    '전북북부앞바다': '22A30101',
    '전북남부앞바다': '22A30102',
    '전남북부서해앞바다': '22A30103',
    '전남중부서해앞바다': '22A30104',
    '전남남부서해앞바다': '22A30105',
    '전남서부남해앞바다': '12B10101',
    '전남동부남해앞바다': '12B10102',
    '제주도북부앞바다': '12B10302',
    '제주도남부앞바다': '12B10303',
    '제주도동부앞바다': '12B10301',
    '제주도서부앞바다': '12B10304',
    // 먼바다 (해상광역 H 코드)
    '동해중부안쪽먼바다': '12C20210',
    '동해중부바깥먼바다': '12C20220',
    '동해남부남쪽안쪽먼바다': '12C10211',
    '동해남부남쪽바깥먼바다': '12C10221',
    '동해남부북쪽안쪽먼바다': '12C10212',
    '동해남부북쪽바깥먼바다': '12C10222',
    '서해중부안쪽먼바다': '12A20210',
    '서해중부바깥먼바다': '12A20220',
    '서해남부북쪽안쪽먼바다': '12A30211',
    '서해남부북쪽바깥먼바다': '12A30221',
    '서해남부남쪽안쪽먼바다': '12A30212',
    '서해남부남쪽바깥먼바다': '12A30222',
    '남해동부안쪽먼바다': '12B20210',
    '남해동부바깥먼바다': '12B20220',
    '남해서부서쪽먼바다': '12B10201',
    '남해서부동쪽먼바다': '12B10202',
    '제주도남서쪽안쪽먼바다': '12B10411',
    '제주도남동쪽안쪽먼바다': '12B10412',
    '제주도남쪽바깥먼바다': '12B10420',
};

// ─── 지방기상청별 fct_afs_dl에 사용할 관할 지점 코드 목록 ───
// 각 지방청 관할 지점의 기온(TA) 값을 집계하여 최저~최고 범위를 산출
const OFFICE_STN_LIST = {
    '109': ['108', '112', '119', '202'],  // 서울, 인천, 수원, 양평
    '105': ['101', '105', '106'],          // 춘천, 강릉, 동해
    '133': ['131', '133', '135', '129'],   // 청주, 대전, 추풍령, 서산
    '143': ['143', '136', '138'],          // 대구, 안동, 포항
    '156': ['156', '165', '168', '170'],   // 광주, 목포, 여수, 완도
    '159': ['159', '152', '155', '162'],   // 부산, 울산, 창원, 통영
    '184': ['184', '185', '189'],          // 제주, 고산, 서귀포
};

// ─── 발표시각(05, 11, 17시)에 해당하는 타임스탬프 후보 생성 ───
/**
 * 현재 KST 시각 기준으로 가장 최근 발표시각의 tm 파라미터를 반환
 * @returns {string} YYYYMMDDHH00 형식 (예: 202604051100)
 */
function getLatestPublishTm() {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const h = kst.getUTCHours();
    const hours = [17, 11, 5];
    let publishHour = 5;

    for (const ph of hours) {
        if (h >= ph) {
            publishHour = ph;
            break;
        }
    }

    let targetDate = kst;
    // 05시 이전이면 어제 17시 발표분
    if (h < 5) {
        targetDate = new Date(kst);
        targetDate.setUTCDate(targetDate.getUTCDate() - 1);
        publishHour = 17;
    }

    const y = String(targetDate.getUTCFullYear());
    const m = String(targetDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(targetDate.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}${String(publishHour).padStart(2, '0')}00`;
}

/**
 * 발표 tm 후보 목록 생성 (최신부터 역순)
 * API가 아직 업데이트되지 않은 경우 이전 발표시각으로 폴백
 * @returns {string[]} YYYYMMDDHH00 형식 배열
 */
function getPublishTmCandidates() {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const hours = [17, 11, 5];
    const candidates = [];

    // 오늘 발표분 중 현재 시각 이전 것들
    for (const h of hours) {
        const d = new Date(kst);
        d.setUTCHours(h, 0, 0, 0);
        if (d <= kst) candidates.push(d);
    }

    // 어제 발표분 (폴백용)
    for (const h of hours) {
        const d = new Date(kst);
        d.setUTCDate(d.getUTCDate() - 1);
        d.setUTCHours(h, 0, 0, 0);
        candidates.push(d);
    }

    return candidates.map(d => {
        const y = String(d.getUTCFullYear());
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        const hh = String(d.getUTCHours()).padStart(2, '0');
        return `${y}${m}${day}${hh}00`;
    });
}

/**
 * 발표 타임스탬프를 사람이 읽기 쉬운 형식으로 변환
 * @param {string} tm - YYYYMMDDHH00 형식
 * @returns {string} "MM.DD. HH:MM" 형식 (예: "04.05. 11:00")
 */
function formatPublishTime(tm) {
    if (!tm || tm.length < 12) return '';
    const mm = tm.substring(4, 6);
    const dd = tm.substring(6, 8);
    const hh = tm.substring(8, 10);
    const min = tm.substring(10, 12);
    return `${mm}.${dd}. ${hh}:${min}`;
}

/**
 * HTTPS GET 요청 수행 (타임아웃 지원)
 * @param {string} url - 요청 URL
 * @param {number} [timeout=10000] - 타임아웃(ms)
 * @returns {Promise<Buffer>} 응답 바디 버퍼
 */
function httpsGet(url, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: { 'User-Agent': 'SEAGNAL/1.0' },
            timeout
        }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                return httpsGet(res.headers.location, timeout).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
}

/**
 * EUC-KR 인코딩된 버퍼를 UTF-8 문자열로 디코딩
 * @param {Buffer} buffer - EUC-KR 바이트 버퍼
 * @returns {string} UTF-8 디코딩된 문자열
 */
function decodeEucKr(buffer) {
    return new TextDecoder('euc-kr').decode(buffer);
}

module.exports = {
    API_URLS,
    REGIONAL_OFFICES,
    ZONE_TO_OFFICE_MAP,
    ZONE_REG_ID_MAP,
    OFFICE_STN_LIST,
    getLatestPublishTm,
    getPublishTmCandidates,
    formatPublishTime,
    httpsGet,
    decodeEucKr,
};
