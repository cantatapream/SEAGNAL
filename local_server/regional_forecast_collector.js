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
    const pdfModule = require('pdf-parse');
    if (typeof pdfModule === 'function') {
        // pdf-parse v1: 함수형 API (정상)
        pdfParse = pdfModule;
    } else {
        // pdf-parse v2가 로드됨 → v1을 상위 node_modules에서 시도
        // v2는 테이블 텍스트 추출 방식이 다르므로 v1 필요
        try {
            const v1Path = require.resolve('pdf-parse', { paths: [path.join(__dirname, '..')] });
            const v1Module = require(v1Path);
            if (typeof v1Module === 'function') {
                pdfParse = v1Module;
                console.log('[RegionalForecast] pdf-parse v1 로드 (상위 경로)');
            } else {
                console.error('⚠️ pdf-parse v1을 찾을 수 없음. v2는 해상 테이블 파싱과 호환되지 않습니다.');
                pdfParse = null;
            }
        } catch {
            console.error('⚠️ pdf-parse v1을 상위 경로에서 찾을 수 없음');
            pdfParse = null;
        }
    }
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
    '경기북부앞바다': '109',  // seaZoneCoordinates.js에서 사용하는 별칭
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
    const errors = [];

    for (const ts of candidates) {
        const url = `https://www.weather.go.kr/w/repositary/xml/fct/rpt_wid_day_${ts}_${officeCode}.pdf`;
        try {
            const buf = await fetchPdf(url);
            if (buf.length > 500) {
                console.log(`[RegionalForecast] ${officeCode}: PDF 다운로드 성공 (${ts}, ${buf.length}bytes)`);
                return { buffer: buf, timestamp: ts, url };
            }
            errors.push(`${ts}: ${buf.length}bytes (too small)`);
        } catch (e) {
            errors.push(`${ts}: ${e.message}`);
            continue;
        }
    }
    // 디버그: 모든 후보 시도 실패 사유 기록
    try {
        const debugDir = path.join(__dirname, 'data', 'debug_pdf');
        if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
        const logContent = `[${new Date().toISOString()}] officeCode=${officeCode}\n후보 시도 결과:\n${errors.map(e => `  - ${e}`).join('\n')}\n`;
        fs.writeFileSync(path.join(debugDir, `fetch_log_${officeCode}.txt`), logContent, 'utf8');
    } catch (_) {}
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

        // 디버그: PDF 원본 텍스트를 파일로 저장 (파싱 검증용)
        try {
            const debugDir = path.join(__dirname, 'data', 'debug_pdf');
            if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
            fs.writeFileSync(path.join(debugDir, `pdf_text_${officeCode}.txt`), text, 'utf8');
        } catch (_) {}

        const summary = parseSummaryForecast(text);
        const temperature = parseTodayTemperature(text);
        const publishTime = parsePublishTime(text);
        const { farSeaZones: marineForecast, coastalZones: coastalForecast } = parseMarineForecast(text, result.timestamp);

        const marineCount = Object.keys(marineForecast).length;
        const coastalCount = Object.keys(coastalForecast).length;
        if (marineCount > 0 || coastalCount > 0) {
            console.log(`[RegionalForecast] ${office.name}: 해상예보 먼바다 ${marineCount}개, 앞바다 ${coastalCount}개 구역 파싱 완료`);
        }

        if (!summary) {
            console.log(`[RegionalForecast] ${office.name}: 종합 전망 추출 실패`);
            // 해상예보만이라도 반환
            if (marineCount === 0 && coastalCount === 0) return null;
        }

        return {
            officeCode,
            officeName: office.name,
            publishTime: publishTime || result.timestamp,
            summary,
            temperature,
            marineForecast,
            coastalForecast,
            collectedAt: new Date().toISOString()
        };
    } catch (e) {
        console.log(`[RegionalForecast] ${office.name}: 수집 오류 - ${e.message}`);
        return null;
    }
}

/**
 * 모든 지방청의 단기예보를 수집
 * @param {EventEmitter} [progressEmitter] - 진행률 이벤트 전송용 (scheduler.collectProgress)
 */
async function collectRegionalForecasts(progressEmitter) {
    console.log('[RegionalForecast] 지방기상청 단기예보 수집 시작...');

    // 디버그 디렉토리를 미리 생성
    const debugDir = path.join(__dirname, 'data', 'debug_pdf');
    try {
        if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
        console.log(`[RegionalForecast] 디버그 디렉토리: ${debugDir}`);
    } catch (e) {
        console.error(`[RegionalForecast] 디버그 디렉토리 생성 실패: ${e.message}`);
    }

    const results = {};
    const codes = Object.keys(REGIONAL_OFFICES);
    const total = codes.length;
    const collectLog = [`[${new Date().toISOString()}] 지방청 수집 시작\n`];

    // 순차적으로 수집 (서버 부하 방지)
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
            const data = await collectOneOffice(code);
            if (data) {
                results[code] = data;
                collectLog.push(`✅ ${officeName}(${code}): 성공`);
            } else {
                collectLog.push(`❌ ${officeName}(${code}): 데이터 없음 (PDF 다운로드 실패 또는 파싱 실패)`);
            }
            // 요청 간 딜레이
            await new Promise(r => setTimeout(r, 500));
        } catch (e) {
            collectLog.push(`❌ ${officeName}(${code}): 오류 - ${e.message}`);
            console.log(`[RegionalForecast] ${code} 수집 실패: ${e.message}`);
        }
    }

    const collectedCount = Object.keys(results).length;
    collectLog.push(`\n수집 결과: ${collectedCount}/${codes.length}개 성공`);
    console.log(`[RegionalForecast] 수집 완료: ${collectedCount}/${codes.length}개 지방청`);

    // 수집 결과 로그 파일 저장
    try {
        fs.writeFileSync(path.join(debugDir, 'collect_result.txt'), collectLog.join('\n'), 'utf8');
        console.log(`[RegionalForecast] 수집 로그 저장: ${path.join(debugDir, 'collect_result.txt')}`);
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
 * PDF 텍스트에서 해상예보 [해상] 섹션의 먼바다 데이터를 파싱
 *
 * PDF 해상 테이블 구조:
 *   구역 | 오늘 오후 | 내일 오전 | 내일 오후 | 모레 오전 | 모레 오후 | 글피 오전 | 글피 오후 | 그글피 오전 | 그글피 오후
 *   각 셀: 풍향/풍속 + 날씨 + 파고
 *
 * @param {string} text - PDF에서 추출한 전체 텍스트
 * @param {string} publishTimestamp - 발표 타임스탬프 (YYYYMMDDHH00)
 * @returns {Object} { zoneName: { publishTime, periods: [{date, period, wind, weather, waveHeight}...] } }
 */
function parseMarineForecast(text, publishTimestamp) {
    if (!text) return { farSeaZones: {}, coastalZones: {} };

    // 해상 섹션 추출 (단 기 예 보 [해상] 또는 [육상/해상] 이후)
    let marineIdx = text.indexOf('단 기 예 보 [해상]');
    if (marineIdx === -1) {
        // 대전지방기상청 등 육상/해상 합본 PDF 지원
        marineIdx = text.indexOf('단 기 예 보 [육상/해상]');
    }
    if (marineIdx === -1) return { farSeaZones: {}, coastalZones: {} };

    const marineText = text.substring(marineIdx);

    // 발표일 기준 날짜 계산
    let baseDate;
    if (publishTimestamp && publishTimestamp.length >= 8) {
        baseDate = new Date(
            parseInt(publishTimestamp.substring(0, 4)),
            parseInt(publishTimestamp.substring(4, 6)) - 1,
            parseInt(publishTimestamp.substring(6, 8))
        );
    } else {
        baseDate = new Date();
    }

    // 발표 시각에 따라 시간대 라벨 결정 (9개)
    // 05시 발표: 오늘 오전부터 시작 (오전,오후,오전,오후,...,그글피 오전)
    // 11시/17시 발표: 오늘 오후부터 시작 (오후,오전,오후,...,그글피 오후)
    const publishHour = publishTimestamp ? parseInt(publishTimestamp.substring(8, 10)) : 17;
    const isMorningPublish = (publishHour < 11); // 05시 발표

    const timeSlots = isMorningPublish ? [
        { dayOffset: 0, period: 'am' },   // 오늘 오전
        { dayOffset: 0, period: 'pm' },   // 오늘 오후
        { dayOffset: 1, period: 'am' },   // 내일 오전
        { dayOffset: 1, period: 'pm' },   // 내일 오후
        { dayOffset: 2, period: 'am' },   // 모레 오전
        { dayOffset: 2, period: 'pm' },   // 모레 오후
        { dayOffset: 3, period: 'am' },   // 글피 오전
        { dayOffset: 3, period: 'pm' },   // 글피 오후
        { dayOffset: 4, period: 'am' },   // 그글피 오전
    ] : [
        { dayOffset: 0, period: 'pm' },   // 오늘 오후
        { dayOffset: 1, period: 'am' },   // 내일 오전
        { dayOffset: 1, period: 'pm' },   // 내일 오후
        { dayOffset: 2, period: 'am' },   // 모레 오전
        { dayOffset: 2, period: 'pm' },   // 모레 오후
        { dayOffset: 3, period: 'am' },   // 글피 오전
        { dayOffset: 3, period: 'pm' },   // 글피 오후
        { dayOffset: 4, period: 'am' },   // 그글피 오전
        { dayOffset: 4, period: 'pm' },   // 그글피 오후
    ];

    // 해상 구역명 패턴 (PDF에서 줄바꿈 포함)
    // 먼바다: "안쪽먼바다", "바깥먼바다", "서쪽\n먼바다", "동쪽\n먼바다"
    // 앞바다: "강원북부앞바다", "제주도서부앞바다" 등
    const farSeaZones = {};
    const coastalZones = {};

    // 줄 단위로 분할 (pdf-parse v2는 같은 Y좌표의 셀을 탭으로 구분하므로 탭도 줄바꿈으로 변환)
    const lines = marineText.replace(/\t/g, '\n').split('\n');

    // 먼바다 구역을 찾고 해당 줄 이후의 데이터를 파싱
    // 전략: "먼바다" 키워드가 포함된 구역명을 찾고, 이후 풍향/풍속 + 날씨 + 파고 패턴을 9회 추출

    // 먼저 전체 텍스트에서 구역별로 블록을 분리
    // 해상국지 테이블 시작 전까지만 파싱 (해상국지는 앞바다)

    // 구역명 정규화를 위한 매핑
    const ZONE_NAME_NORMALIZE = {
        '제주도남서쪽\n안쪽먼바다': '제주도남서쪽안쪽먼바다',
        '제주도남동쪽\n안쪽먼바다': '제주도남동쪽안쪽먼바다',
        '제주도남쪽\n바깥먼바다': '제주도남쪽바깥먼바다',
        '남쪽\n안쪽먼바다': null,  // 컨텍스트에 따라 결정
        '남쪽\n바깥먼바다': null,
        '북쪽\n안쪽먼바다': null,
        '북쪽\n바깥먼바다': null,
        '서쪽\n먼바다': null,
        '동쪽\n먼바다': null,
    };

    // 풍향/풍속 패턴: "북동~동 / 7~11" 또는 "북동~동 / 6~9"
    const windPattern = /^([가-힣~]+)\s*\/\s*(\d+~\d+)$/;
    // 파고 패턴: "0.5" 또는 "1.0" (단독) 또는 "0.5~1.0" (한 줄 범위) 또는 "0.5\n~\n1.5" (여러 줄 범위)
    const waveSimplePattern = /^(\d+\.?\d*)$/;
    const waveRangePattern = /^(\d+\.?\d*)\s*~\s*(\d+\.?\d*)$/;

    // 해상 섹션을 구역 블록으로 분할하는 다른 접근법:
    // "날씨파고" 헤더 행 이후의 데이터를 구역별로 읽음

    // 해상 섹션에서 먼바다가 포함된 구역 데이터 추출
    // 접근법: 연속된 줄을 스캔하면서 먼바다 구역명과 9개 시간대 데이터를 추출

    // 먼바다 키워드를 포함하는 줄의 인덱스 찾기
    const zoneBlocks = [];
    let currentParent = ''; // 상위 카테고리 (동해남부, 서해남부 등)
    let lastDirectionPrefix = ''; // 방향 접두어 (북쪽, 남쪽, 서쪽, 동쪽)

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // 상위 카테고리 추적
        // Case 1: 세로 텍스트 (동\n해\n남\n부 → 동해남부)
        if (/^[동서남]$/.test(line) && i + 1 < lines.length) {
            let vertical = line;
            let j = i + 1;
            while (j < lines.length && /^[해서남북중부동]$/.test(lines[j].trim())) {
                vertical += lines[j].trim();
                j++;
            }
            if (vertical.length >= 2) {
                currentParent = vertical;
                lastDirectionPrefix = ''; // 새 섹션 시작 시 방향 접두어 초기화
                i = j - 1; // 세로 텍스트로 소비된 줄을 건너뛰어 중복 감지 방지
            }
        }
        // Case 2: 한 줄로 추출된 상위 카테고리 (세로 텍스트가 병합된 경우)
        if (/^(서해중부|서해남부|서해북부|동해중부|동해남부|남해동부|남해서부)$/.test(line)) {
            currentParent = line;
            lastDirectionPrefix = ''; // 새 섹션 시작 시 방향 접두어 초기화
        }
        // Case 3: "해상구역" 또는 "해상국지" 같은 섹션 구분자는 parent로 사용하지 않음
        // (해상구역 하위에는 개별 구역명이 직접 나옴)

        // 방향 접두어 추적 (북쪽, 남쪽, 서쪽, 동쪽)
        // PDF에서 "북쪽\n안쪽먼바다" 같은 2줄 구역명의 첫 줄을 기억
        if (/^(북쪽|남쪽|서쪽|동쪽)$/.test(line)) {
            lastDirectionPrefix = line;
        }

        // 먼바다 또는 앞바다 구역명 감지
        if (line.includes('먼바다') || line.includes('앞바다')) {
            let zoneName = '';

            // PDF 텍스트에서 구역명은 1~2줄에 걸쳐 나옴:
            // 1줄: "강원북부앞바다" (전체), "제주도남서쪽안쪽먼바다" (전체)
            // 2줄: "강원북부" + "앞바다", "전남서부" + "남해앞바다"
            //       "서쪽" + "먼바다", "제주도남서쪽" + "안쪽먼바다"
            // 단독: "앞바다", "먼바다" (상위 카테고리 필요)

            const prevLine = i > 0 ? lines[i - 1].trim() : '';

            // prevLine이 데이터(풍향/파고/날씨)인지 판별
            const weatherWords = ['맑음', '구름많음', '흐림', '흐리고', '비', '눈', '소나기', '안개'];
            const isPrevData = !prevLine || prevLine.length < 2 ||
                windPattern.test(prevLine) || waveSimplePattern.test(prevLine) ||
                waveRangePattern.test(prevLine) ||
                prevLine === '~' || weatherWords.some(w => prevLine.includes(w));

            if (!isPrevData) {
                // 이전 줄이 구역명 접두어 → 합쳐서 전체 구역명 생성
                // "강원북부" + "앞바다" → "강원북부앞바다"
                // "전남서부" + "남해앞바다" → "전남서부남해앞바다"
                // "서쪽" + "먼바다" → "서쪽먼바다"
                // "인천·경기" + "남부앞바다" → "인천·경기남부앞바다"
                zoneName = (prevLine + line).replace(/\s/g, '');
            } else {
                // 이전 줄 없거나 데이터 → 현재 줄만 사용
                zoneName = line.replace(/\s/g, '');
            }

            // 방향 접두어 적용 (PDF에서 "북쪽"과 "안쪽먼바다"가 데이터 줄로 분리된 경우)
            // "안쪽먼바다" → "북쪽안쪽먼바다", "바깥먼바다" → "남쪽바깥먼바다"
            // "먼바다" → "서쪽먼바다" (남해서부 서쪽/동쪽먼바다)
            if (lastDirectionPrefix && (
                zoneName === '먼바다' ||
                zoneName.startsWith('안쪽') || zoneName.startsWith('바깥'))) {
                zoneName = lastDirectionPrefix + zoneName;
            }

            // 상위 카테고리 붙이기 (세로 텍스트에서 추출한 동해남부, 서해중부 등)
            // 단독 "앞바다"/"먼바다" 또는 방향 접두어만 있는 경우
            if (zoneName === '앞바다' || zoneName === '먼바다' ||
                zoneName.startsWith('남쪽') || zoneName.startsWith('북쪽') ||
                zoneName.startsWith('서쪽') || zoneName.startsWith('동쪽') ||
                zoneName.startsWith('안쪽') || zoneName.startsWith('바깥')) {
                if (currentParent) {
                    zoneName = currentParent + zoneName;
                }
            }

            // 먼바다 또는 앞바다가 아닌 경우 제외
            if (!zoneName.includes('먼바다') && !zoneName.includes('앞바다')) continue;

            // 이 구역의 데이터 시작 위치
            zoneBlocks.push({ zoneName, startLine: i + 1 });
        }
    }

    // 디버그: 감지된 구역 블록 로그
    const farBlocks = zoneBlocks.filter(b => b.zoneName.includes('먼바다'));
    const coastalBlocks = zoneBlocks.filter(b => b.zoneName.includes('앞바다'));
    if (coastalBlocks.length > 0) {
        console.log(`[MarineParse] 앞바다 구역 감지: ${coastalBlocks.map(b => b.zoneName).join(', ')}`);
    }
    if (farBlocks.length > 0) {
        console.log(`[MarineParse] 먼바다 구역 감지: ${farBlocks.map(b => b.zoneName).join(', ')}`);
    }

    // 각 구역 블록에서 시간대 데이터 추출 (수집-후-매칭 방식)
    // pdf-parse의 텍스트 추출 순서에 의존하지 않고, 풍향/풍속·날씨·파고를 독립 수집 후 인덱스로 결합
    for (const block of zoneBlocks) {
        const winds = [];
        const weathers = [];
        const waves = [];
        let lineIdx = block.startLine;

        // 1단계: 구역 데이터 영역의 모든 값을 유형별로 수집
        while (lineIdx < lines.length) {
            const line = lines[lineIdx].trim();
            if (!line) { lineIdx++; continue; }

            // 다음 구역이나 섹션 시작이면 중단
            if (line.includes('먼바다') || line.includes('앞바다') ||
                line === '※' || line.startsWith('※ 날씨')) break;

            // 충분한 데이터를 수집했으면 중단
            if (winds.length >= timeSlots.length && weathers.length >= timeSlots.length && waves.length >= timeSlots.length) break;

            // 풍향/풍속 패턴
            const windMatch = line.match(windPattern);
            if (windMatch) {
                winds.push(`${windMatch[1]} / ${windMatch[2]}`);
                lineIdx++;
                continue;
            }

            // 파고 패턴: "0.5~1.0" (한 줄 범위)
            const waveRangeMatch = line.match(waveRangePattern);
            if (waveRangeMatch) {
                waves.push(`${waveRangeMatch[1]}~${waveRangeMatch[2]}`);
                lineIdx++;
                continue;
            }

            // 파고 패턴 (단순 숫자 "0.5")
            if (waveSimplePattern.test(line)) {
                let waveVal = line;
                // "0.5\n~\n1.5" 범위 패턴 확인 (여러 줄에 걸친 경우)
                if (lineIdx + 2 < lines.length &&
                    lines[lineIdx + 1].trim() === '~' &&
                    waveSimplePattern.test(lines[lineIdx + 2].trim())) {
                    waveVal += '~' + lines[lineIdx + 2].trim();
                    lineIdx += 2;
                }
                waves.push(waveVal);
                lineIdx++;
                continue;
            }

            // ~ 문자 (파고 범위 구분자) - 위에서 처리되지 않은 경우 스킵
            if (line === '~') { lineIdx++; continue; }

            // 날씨 키워드 체크
            const weatherKeywords = ['맑음', '구름많음', '구름많', '흐림', '흐리고', '비', '눈', '소나기', '안개'];
            if (weatherKeywords.some(w => line.includes(w))) {
                let weatherText = line;
                // 복합 날씨 ("흐리고" 다음에 "비", "눈" 등) 처리
                // "흐리고\n한때 비 곳" 등 다음 줄에 비/눈이 포함된 경우도 병합
                if (line.includes('흐리고') && !line.includes('비') && !line.includes('눈') && !line.includes('소나기')) {
                    const nextLine = lineIdx + 1 < lines.length ? lines[lineIdx + 1].trim() : '';
                    if (['비', '눈', '비/눈', '소나기'].some(w => nextLine.includes(w))) {
                        weatherText += ' ' + nextLine;
                        lineIdx++;
                    }
                }
                weathers.push(weatherText);
                lineIdx++;
                continue;
            }

            lineIdx++;
        }

        // 2단계: 수집된 데이터를 인덱스로 결합하여 시간대별 데이터 생성
        const periods = [];
        const maxSlots = Math.min(winds.length, timeSlots.length);

        for (let s = 0; s < maxSlots; s++) {
            const slot = timeSlots[s];
            const date = new Date(baseDate);
            date.setDate(date.getDate() + slot.dayOffset);
            const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;

            periods.push({
                date: dateStr,
                period: slot.period,
                wind: winds[s],
                weather: s < weathers.length ? weathers[s] : '-',
                waveHeight: s < waves.length ? waves[s] : '-'
            });
        }

        if (periods.length > 0) {
            // ZONE_TO_OFFICE_MAP의 키와 일치하도록 구역명 정규화
            const normalizedName = normalizeMarineZoneName(block.zoneName);
            if (normalizedName) {
                if (normalizedName.includes('앞바다')) {
                    coastalZones[normalizedName] = { periods };
                } else {
                    farSeaZones[normalizedName] = { periods };
                }
            }
        }
    }

    // === 후처리: 통합 구역명 → 개별 구역으로 확장 ===
    // 광주지방기상청 PDF는 "서해남부 > 앞바다" 통합명만 제공하고
    // 전북북부/남부앞바다 개별 구역명이 없으므로, 동일 데이터를 복제 적용
    const ZONE_EXPANSION_MAP = {
        '서해남부앞바다': ['전북북부앞바다', '전북남부앞바다'],
        '서해중부앞바다': ['인천·경기북부앞바다', '인천·경기남부앞바다', '충남북부앞바다', '충남남부앞바다'],
        '서해북부앞바다': [],  // 서해북부앞바다는 그 자체가 유효한 구역
    };

    for (const [genericName, specificNames] of Object.entries(ZONE_EXPANSION_MAP)) {
        if (specificNames.length === 0) continue;
        if (coastalZones[genericName]) {
            // 개별 구역이 아직 파싱되지 않은 경우에만 통합 데이터로 채움
            for (const specific of specificNames) {
                if (!coastalZones[specific]) {
                    coastalZones[specific] = JSON.parse(JSON.stringify(coastalZones[genericName]));
                    console.log(`[MarineParse] 통합 구역 확장: ${genericName} → ${specific}`);
                }
            }
            // 통합 구역명 자체는 제거 (ZONE_TO_OFFICE_MAP에 없으므로)
            delete coastalZones[genericName];
        }
    }

    // 먼바다도 동일하게 통합 구역 확장
    const FAR_SEA_EXPANSION_MAP = {
        '서해남부먼바다': ['서해남부북쪽안쪽먼바다', '서해남부북쪽바깥먼바다', '서해남부남쪽안쪽먼바다', '서해남부남쪽바깥먼바다'],
        '남해서부먼바다': ['남해서부서쪽먼바다', '남해서부동쪽먼바다'],
    };

    for (const [genericName, specificNames] of Object.entries(FAR_SEA_EXPANSION_MAP)) {
        if (farSeaZones[genericName]) {
            for (const specific of specificNames) {
                if (!farSeaZones[specific]) {
                    farSeaZones[specific] = JSON.parse(JSON.stringify(farSeaZones[genericName]));
                    console.log(`[MarineParse] 먼바다 통합 구역 확장: ${genericName} → ${specific}`);
                }
            }
            delete farSeaZones[genericName];
        }
    }

    return { farSeaZones, coastalZones };
}

/**
 * 해상 구역명을 ZONE_TO_OFFICE_MAP 키와 일치하도록 정규화
 */
function normalizeMarineZoneName(rawName) {
    // 공백, 줄바꿈 제거
    let name = rawName.replace(/[\s\n]/g, '');

    // 파고 값이 구역명 앞에 붙은 경우 제거 (예: "0.5~1.0먼바다" → "먼바다")
    name = name.replace(/^[\d.~]+/, '');

    // PDF에서 '인천경기' (가운뎃점 누락) → '인천·경기' 정규화
    if (name.includes('인천경기') && !name.includes('인천·경기')) {
        name = name.replace('인천경기', '인천·경기');
    }

    // PDF에서 '인천.경기' (마침표) → '인천·경기' 정규화
    if (name.includes('인천.경기')) {
        name = name.replace('인천.경기', '인천·경기');
    }

    // 대화퇴, 연해주, 규슈, 동중국해 등 관련 없는 구역 제외
    if (['대화퇴', '연해주', '규슈서해', '규슈남해', '동중국해'].some(x => name.includes(x))) {
        return null;
    }

    // ZONE_TO_OFFICE_MAP에 있는 먼바다/앞바다 구역명과 매칭
    const isCoastal = name.includes('앞바다');
    const knownZones = Object.keys(ZONE_TO_OFFICE_MAP).filter(z => isCoastal ? z.includes('앞바다') : z.includes('먼바다'));

    // 정확히 일치
    if (knownZones.includes(name)) return name;

    // 부분 매칭 시도
    for (const known of knownZones) {
        if (name.includes(known) || known.includes(name)) return known;
    }

    return name; // 매칭 안 되더라도 원본 반환
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
// seaZoneCoordinates.js와 ZONE_TO_OFFICE_MAP 간 이름 차이를 해소하기 위한 별칭
const COASTAL_ZONE_ALIASES = {
    '인천·경기북부앞바다': '경기북부앞바다',
    '인천·경기남부앞바다': '경기남부앞바다',
};

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
