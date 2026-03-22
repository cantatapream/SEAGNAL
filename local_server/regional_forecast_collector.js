/**
 * ============================================================================
 * 파일명: regional_forecast_collector.js
 * 역할: 각 지방기상청 단기예보 PDF에서 종합 전망 + 기온 정보 수집
 * ============================================================================
 *
 * [설명]
 * - 7개 지방기상청의 단기예보 PDF를 다운로드하여 텍스트 추출
 * - 종합 전망 (□ (종합)...) 및 오늘 기온(최저/최고) 파싱
 * - 발표 주기: 하루 3회 (05시, 11시, 17시)
 *
 * [연계 파일]
 * - scheduler.js → 주기적 수집 호출
 * - routes/weather.js → /api/regional-forecast 엔드포인트
 * - js/marine_forecast.js → 프론트엔드 표출
 * ============================================================================
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
let pdfParse;
try {
    pdfParse = require('pdf-parse');
} catch (e) {
    console.error('⚠️ pdf-parse 모듈 로드 실패:', e.message);
    pdfParse = null;
}

const DATA_FILE = path.join(__dirname, 'data', 'regional_forecast.json');

// 지방기상청 코드 및 정보
const REGIONAL_OFFICES = {
    '109': { name: '수도권기상청', code: '109' },
    '159': { name: '부산지방기상청', code: '159' },
    '156': { name: '광주지방기상청', code: '156' },
    '105': { name: '강원지방기상청', code: '105' },
    '133': { name: '대전지방기상청', code: '133' },
    '143': { name: '대구지방기상청', code: '143' },
    '184': { name: '제주지방기상청', code: '184' },
};

// 소분류 존 이름 → 지방청 코드 매핑
// 앞바다: 지역명 키워드로 매핑
// 먼바다: 해역명 키워드로 매핑
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
    // 먼바다 → 해역명 기준
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

/**
 * HTTPS로 PDF 바이너리를 다운로드
 */
function fetchPdf(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 15000
        }, (res) => {
            if (res.statusCode === 302 || res.statusCode === 301) {
                return fetchPdf(res.headers.location).then(resolve).catch(reject);
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
 * 단기예보 PDF의 발표시각 후보 목록을 생성
 * 발표 주기: 05:00, 11:00, 17:00
 * 최신 발표시각부터 역순으로 시도
 */
function getPublishTimeCandidates() {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const hours = [17, 11, 5];
    const candidates = [];

    // 오늘 발표분 중 현재 시각 이전 것들
    for (const h of hours) {
        const d = new Date(kst);
        d.setUTCHours(h, 0, 0, 0);
        if (d <= kst) {
            candidates.push(d);
        }
    }

    // 어제 발표분 (최신 17시부터)
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
 * PDF URL을 구성하여 다운로드 시도
 */
async function fetchRegionalPdf(officeCode) {
    const candidates = getPublishTimeCandidates();

    for (const ts of candidates) {
        const url = `https://www.weather.go.kr/w/repositary/xml/fct/rpt_wid_day_${ts}_${officeCode}.pdf`;
        try {
            const buf = await fetchPdf(url);
            if (buf.length > 500) {
                return { buffer: buf, timestamp: ts, url };
            }
        } catch (e) {
            // 이 시간대 PDF 없음, 다음 시도
            continue;
        }
    }
    return null;
}

/**
 * PDF 텍스트에서 종합 전망을 추출
 * 패턴: □ (종합) ... 부터 기온 테이블 또는 다른 섹션 시작까지
 */
function parseSummaryForecast(text) {
    if (!text) return null;

    // 날씨종합 섹션 찾기
    // □ (종합) 으로 시작하는 부분, 기온 테이블이나 다음 섹션 전까지
    const summaryMatch = text.match(/□\s*\(종합\)\s*([\s\S]*?)(?=평년\s*\(오늘\)|기온\s*평년|기온\s*\n|기온\s*\(℃\)|기온\(℃\)|파고|천문정보|쪽수|$)/);
    if (!summaryMatch) return null;

    let summaryText = summaryMatch[0].trim();

    // ※ 참고 문구도 포함 (한 줄로 제한하여 기온 테이블 포함 방지)
    const noteMatch = text.match(/※\s*\d+일까지의[^\n]*참고하기 바랍니다\./);
    if (noteMatch) {
        if (!summaryText.includes('참고하기 바랍니다')) {
            summaryText += '\n' + noteMatch[0].trim();
        }
    }

    // 혹시 포함된 기온 테이블 잔여 텍스트 제거
    summaryText = summaryText.replace(/평년\s*\(오늘\)[\s\S]*/g, '');
    summaryText = summaryText.replace(/최저[\d.\-~\s]+$/gm, '');
    summaryText = summaryText.replace(/최고[\d.\-~\s]+$/gm, '');

    // 줄바꿈 정리
    summaryText = summaryText
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+/g, ' ')
        .trim();

    return summaryText;
}

/**
 * PDF 텍스트에서 오늘 기온(최저/최고)을 추출
 *
 * PDF 텍스트에서 기온 테이블은 공백 없이 셀이 연결되어 추출됨:
 * "최저6.1 ~ 8.35.6 ~ 8.35.0 ~ 9.39 ~ 1010 ~ 11117 ~ 9"
 * 기온표 구조: 평년(오늘) | 어제 | 오늘 | 내일 | 모레 | 글피 | 그글피
 * 각 셀은 "숫자 ~ 숫자" 범위. 셀 간 구분자 없이 연결됨.
 *
 * 파싱 전략: ~ 기호를 기준으로 분할하여 3번째 ~ 앞뒤에서 오늘 값 추출
 * 3번째 ~ = 오늘 셀의 범위 구분자
 * ~ 앞: ...이전셀high + 오늘low → 끝에서 온도값 추출
 * ~ 뒤: 오늘high + 다음셀... → 앞에서 온도값 추출
 */
function parseTodayTemperature(text) {
    if (!text) return null;

    let low = null;
    let high = null;

    // 최저 기온 행에서 오늘 값 추출
    const lowLineMatch = text.match(/최저[^\n]*/);
    if (lowLineMatch) {
        low = extractTodayValueFromLine(lowLineMatch[0].replace(/^최저\s*/, ''));
    }

    // 최고 기온 행에서 오늘 값 추출
    const highLineMatch = text.match(/최고[^\n]*/);
    if (highLineMatch) {
        high = extractTodayValueFromLine(highLineMatch[0].replace(/^최고\s*/, ''));
    }

    if (!low && !high) return null;
    return { low, high };
}

/**
 * 기온 행에서 3번째 ~ 기호를 기준으로 오늘 값(범위)을 추출
 *
 * 전략: ~ 기호들 사이의 세그먼트에는 인접한 두 셀의 값이 연결되어 있음.
 * 세그먼트(tilde#1~tilde#2) = 어제high + 오늘low
 * 세그먼트(tilde#2~tilde#3) = 오늘high + 내일low
 * 각 세그먼트에서 온도값 패턴으로 분리 후 마지막/첫번째 값을 취함.
 *
 * 예: "6.1~8.35.6~8.35.0~9.39~10..." → seg1-2="8.35.0" → [8.3, 5.0]
 */
function extractTodayValueFromLine(data) {
    // ~ 위치 찾기
    const tildePositions = [];
    for (let i = 0; i < data.length; i++) {
        if (data[i] === '~') tildePositions.push(i);
    }

    // 오늘 셀(3번째)에 ~ 가 있으려면 최소 3개, 내일도 있으려면 4개
    if (tildePositions.length < 4) return null;

    // 온도값 패턴: -12.3, 8.8, -3, 20 등 (1~2자리 정수 + 선택적 소수점1자리)
    const tempPattern = /-?\d{1,2}(?:\.\d)?/g;

    // 세그먼트: tilde#1 ~ tilde#2 사이 = 어제high + 오늘low
    const segBefore = data.substring(tildePositions[1] + 1, tildePositions[2]).trim();
    const beforeTemps = segBefore.match(tempPattern);
    if (!beforeTemps || beforeTemps.length < 2) return null;
    const todayLow = beforeTemps[beforeTemps.length - 1]; // 마지막 = 오늘low

    // 세그먼트: tilde#2 ~ tilde#3 사이 = 오늘high + 내일low
    const segAfter = data.substring(tildePositions[2] + 1, tildePositions[3]).trim();
    const afterTemps = segAfter.match(tempPattern);
    if (!afterTemps || afterTemps.length < 2) return null;
    const todayHigh = afterTemps[0]; // 첫번째 = 오늘high

    const lowVal = parseFloat(todayLow);
    const highVal = parseFloat(todayHigh);

    // 유효성 검증: 한국 기온 범위 (-30 ~ 50)
    if (lowVal < -30 || lowVal > 50 || highVal < -30 || highVal > 50) return null;

    return `${todayLow} ~ ${todayHigh}`;
}

/**
 * PDF 텍스트에서 발표 시각을 추출
 */
function parsePublishTime(text) {
    // "2026년 03월 22일 17시 00분 발표" 패턴
    const match = text.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*(\d{1,2})시\s*(\d{1,2})분\s*발표/);
    if (match) {
        const m = match[2].padStart(2, '0');
        const d = match[3].padStart(2, '0');
        const h = match[4].padStart(2, '0');
        const min = match[5].padStart(2, '0');
        return `${m}.${d}. ${h}:${min}`;
    }
    return null;
}

/**
 * 한 지방청의 단기예보 PDF를 수집하고 파싱
 */
async function collectOneOffice(officeCode) {
    const office = REGIONAL_OFFICES[officeCode];
    if (!office) return null;

    try {
        const result = await fetchRegionalPdf(officeCode);
        if (!result) {
            console.log(`[RegionalForecast] ${office.name}: PDF 없음`);
            return null;
        }

        if (!pdfParse) {
            console.error(`[RegionalForecast] pdf-parse 모듈 없음, PDF 파싱 불가`);
            return null;
        }
        const pdfData = await pdfParse(result.buffer);
        const text = pdfData.text;

        const summary = parseSummaryForecast(text);
        const temperature = parseTodayTemperature(text);
        const publishTime = parsePublishTime(text);

        if (!summary) {
            console.log(`[RegionalForecast] ${office.name}: 종합 전망 추출 실패`);
            return null;
        }

        return {
            officeCode,
            officeName: office.name,
            publishTime: publishTime || result.timestamp,
            summary,
            temperature,
            collectedAt: new Date().toISOString()
        };
    } catch (e) {
        console.log(`[RegionalForecast] ${office.name}: 수집 오류 - ${e.message}`);
        return null;
    }
}

/**
 * 모든 지방청의 단기예보를 수집
 */
async function collectRegionalForecasts() {
    console.log('[RegionalForecast] 지방기상청 단기예보 수집 시작...');

    const results = {};
    const codes = Object.keys(REGIONAL_OFFICES);

    // 순차적으로 수집 (서버 부하 방지)
    for (const code of codes) {
        try {
            const data = await collectOneOffice(code);
            if (data) {
                results[code] = data;
            }
            // 요청 간 딜레이
            await new Promise(r => setTimeout(r, 500));
        } catch (e) {
            console.log(`[RegionalForecast] ${code} 수집 실패: ${e.message}`);
        }
    }

    const collectedCount = Object.keys(results).length;
    console.log(`[RegionalForecast] 수집 완료: ${collectedCount}/${codes.length}개 지방청`);

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

    // 데이터 디렉토리 확인
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
 */
function getCurrentPublishTimestamp() {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const h = kst.getUTCHours();
    const hours = [17, 11, 5];
    let publishHour = 5; // 기본값

    for (const ph of hours) {
        if (h >= ph) {
            publishHour = ph;
            break;
        }
    }

    // 05시 이전이면 어제 17시
    if (h < 5) {
        const yesterday = new Date(kst);
        yesterday.setUTCDate(yesterday.getUTCDate() - 1);
        publishHour = 17;
        const y = String(yesterday.getUTCFullYear());
        const m = String(yesterday.getUTCMonth() + 1).padStart(2, '0');
        const d = String(yesterday.getUTCDate()).padStart(2, '0');
        return `${y}${m}${d}${String(publishHour).padStart(2, '0')}00`;
    }

    const y = String(kst.getUTCFullYear());
    const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
    const d = String(kst.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}${String(publishHour).padStart(2, '0')}00`;
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

    const missingCodes = [];
    for (const code of Object.keys(REGIONAL_OFFICES)) {
        const data = existing[code];
        // 데이터가 없거나, 현재 발표 주기의 데이터가 아닌 경우
        if (!data || !data.publishTime) {
            missingCodes.push(code);
            continue;
        }
        // publishTime이 타임스탬프 형식인 경우 비교
        const ts = data._fetchTimestamp || '';
        if (ts && ts !== currentTs) {
            missingCodes.push(code);
        }
    }

    if (missingCodes.length === 0) return;

    console.log(`[RegionalForecast] 미수집 ${missingCodes.length}개 지방청 재시도: ${missingCodes.map(c => REGIONAL_OFFICES[c].name).join(', ')}`);

    for (const code of missingCodes) {
        try {
            const data = await collectOneOffice(code);
            if (data) {
                data._fetchTimestamp = currentTs;
                existing[code] = data;
            }
            await new Promise(r => setTimeout(r, 500));
        } catch (e) {
            console.log(`[RegionalForecast] ${code} 재수집 실패: ${e.message}`);
        }
    }

    existing._lastUpdated = new Date().toISOString();
    fs.writeFileSync(DATA_FILE, JSON.stringify(existing, null, 2), 'utf8');
}

/**
 * 저장된 데이터 로드
 */
function loadRegionalForecasts() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        }
    } catch (_) {}
    return {};
}

module.exports = {
    collectRegionalForecasts,
    retryMissingOffices,
    loadRegionalForecasts,
    REGIONAL_OFFICES,
    ZONE_TO_OFFICE_MAP
};
