/**
 * ============================================================================
 * 파일명: marine_forecast_processor.js
 * 역할: 기상청 통보문에서 해상 기상 전망 (초단기/단기) 파싱
 * ============================================================================
 *
 * [설명]
 * - 통보문(list.do)에서 cmt: 접두사인 해설 통보문 중 초단기/단기 전망을 수집
 * - 원문에서 강풍, 해상, 너울, 바다안개 카테고리 텍스트를 추출
 * - AI 분석 불필요 (단순 텍스트 파싱)
 *
 * [연계 파일]
 * - report_alert_processor.js → fetchHtml, fetchReportDetail 재사용
 * - weather_alerts_crawler.js → run() 시 함께 호출
 * - routes/weather.js → /api/marine-forecast 엔드포인트
 * ============================================================================
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data', 'marine_forecast.json');

const CONFIG = {
    LIST_URL: 'https://www.weather.go.kr/w/special-report/list.do',
    DETAIL_URL: 'https://www.weather.go.kr/w/special-report/list.do'
};

// 카테고리 정의 (순서대로 추출)
// "바다 안개"(공백 포함)를 먼저 시도하고, 없으면 "바다안개"를 시도
const CATEGORIES = ['강풍', '해상', '너울', '바다 안개', '바다안개'];

async function fetchHtml(url) {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        }, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        }).on('error', reject);
    });
}

/**
 * 통보문 목록에서 초단기/단기 전망 해설 통보문을 찾는다
 */
async function findForecastReports() {
    const results = { shortTerm: null, ultraShort: null };

    for (let page = 1; page <= 3; page++) {
        const html = await fetchHtml(`${CONFIG.LIST_URL}?pageIndex=${page}`);
        const selectListMatch = html.match(/<select id="select-list"[^>]*>([\s\S]*?)<\/select>/);
        if (!selectListMatch) break;

        const pattern = /<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g;
        let match;
        while ((match = pattern.exec(selectListMatch[1])) !== null) {
            const id = match[1];
            const title = match[2].trim();

            // [특보], [속보], [예비] 등 특보 계열 통보문은 제외
            if (title.includes('[특보]') || title.includes('[속보]') || title.includes('[예비]')) continue;
            // [정보] 제외
            if (title.includes('[정보]')) continue;
            // 중기전망 제외
            if (title.includes('중기') || title.includes('중기전망')) continue;
            // [해설] 통보문만 대상 (단기/초단기 전망 포함)
            if (!title.includes('[해설]') && !title.includes('단기')) continue;

            // 초단기/단기 구분
            const isUltraShort = title.includes('초단기') || title.includes('/ 초단기 전망');
            const isShortTerm = !isUltraShort && (title.includes('단기') || title.includes('/ 단기 전망'));

            if (isUltraShort && !results.ultraShort) {
                results.ultraShort = { id, title };
            } else if (isShortTerm && !results.shortTerm) {
                results.shortTerm = { id, title };
            }

            // 둘 다 찾으면 종료
            if (results.ultraShort && results.shortTerm) break;
        }
        if (results.ultraShort && results.shortTerm) break;
    }

    return results;
}

/**
 * 통보문 상세 HTML에서 원문 텍스트 + 전망 기간을 추출한다
 */
async function fetchForecastDetail(reportId) {
    const parts = reportId.split(':');
    const dateStr = parts[1] || '';
    const dateParam = dateStr.substring(0, 4) + '-' + dateStr.substring(4, 6) + '-' + dateStr.substring(6, 8);
    const url = `${CONFIG.DETAIL_URL}?prevStn=108&stn=108&date=${dateParam}&reportId=${reportId}`;

    const html = await fetchHtml(url);

    // 전망 기간 추출: "※ 03월 21일부터 03월 25일까지의 전망입니다."
    let forecastPeriod = '';
    const periodMatch = html.match(/※\s*(\d{1,2}월\s*\d{1,2}일[^<]*?까지의\s*전망[^<.]*\.?)/);
    if (periodMatch) {
        forecastPeriod = '※ ' + periodMatch[1].replace(/\s+/g, ' ').trim();
    }

    // 발표 시각 추출: reportId에서 직접 추출 (HTML 본문 날짜와 혼동 방지)
    let publishTime = '';
    const ts = parts[1] || '';
    if (ts.length >= 12) {
        publishTime = `${ts.substring(4, 6)}.${ts.substring(6, 8)}. ${ts.substring(8, 10)}:${ts.substring(10, 12)}`;
    }

    // 본문 텍스트 추출
    let contentHtml = '';
    const patterns = [
        /<div class="cmp-view-content">([\s\S]*?)<\/div>\s*<\/section>/,
        /<div class="cmp-view-content">([\s\S]*?)<\/div>\s*<\/div>/,
        /<div class="cmp-view-content">([\s\S]*)<\/div>/,
    ];
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1] && match[1].trim().length > 20) {
            contentHtml = match[1];
            break;
        }
    }
    if (!contentHtml) return { rawText: '', forecastPeriod, publishTime };

    let rawText = contentHtml
        .replace(/<p[^>]*>/g, '\n').replace(/<\/p>/g, '\n').replace(/<br\s*\/?>/g, '\n')
        .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[ ]+/g, ' ').trim();

    return { rawText, forecastPeriod, publishTime };
}

/**
 * 원문 텍스트에서 강풍/해상/너울/바다안개 카테고리를 추출한다
 * 패턴: ○ (카테고리) → 다음 ○ ( 또는 < 까지
 */
function extractCategories(rawText) {
    const result = {};

    for (const category of CATEGORIES) {
        // "바다안개"로 키 통일
        const normalizedCategory = category.replace(/\s+/g, '');
        // 이미 같은 카테고리가 추출되었으면 건너뜀 ("바다 안개" → "바다안개" 중복 방지)
        if (result[normalizedCategory]) continue;

        const escapedCategory = category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // ○ (강풍) 또는 ○ (바다 안개) 또는 ○ (바다안개) 패턴
        // 종료 조건: 다음 ○ ( 또는 < 또는 □ 또는 문서 끝
        const regex = new RegExp(`○\\s*\\(\\s*${escapedCategory}\\s*\\)\\s*([\\s\\S]*?)(?=○\\s*\\(|<[^\\s]|□|$)`, 'g');
        const match = regex.exec(rawText);
        if (match) {
            let text = match[1].trim();
            // 앞뒤 공백/줄바꿈 정리
            text = text.replace(/\n\s*\n/g, '\n').trim();
            if (text.length > 0) {
                result[normalizedCategory] = text;
            }
        }
    }

    return result;
}

/**
 * 카테고리 텍스트를 표시용으로 포맷팅한다
 * - 본문 첫 줄은 카테고리명 뒤에 이어 표시
 * - "- " 로 시작하는 하위 항목은 들여쓰기
 */
function formatCategoryText(text) {
    if (!text) return '';

    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const mainParts = [];
    const subParts = [];

    for (const line of lines) {
        if (line.startsWith('-') || line.startsWith('–') || line.startsWith('—')) {
            subParts.push(line);
        } else {
            mainParts.push(line);
        }
    }

    return {
        main: mainParts.join(' '),
        sub: subParts
    };
}

/**
 * 메인 수집 함수: 최신 초단기/단기 전망을 수집하고 저장한다
 */
async function collectMarineForecasts() {
    console.log('[MarineForecast] 해상 기상 전망 수집 시작...');

    try {
        const reports = await findForecastReports();

        const forecasts = { ultraShort: null, shortTerm: null, updatedAt: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) };

        // 초단기 전망 수집
        if (reports.ultraShort) {
            console.log(`[MarineForecast] 초단기 전망 수집: ${reports.ultraShort.title}`);
            const detail = await fetchForecastDetail(reports.ultraShort.id);
            const categories = extractCategories(detail.rawText);
            const hasContent = Object.keys(categories).length > 0;

            forecasts.ultraShort = {
                reportId: reports.ultraShort.id,
                title: reports.ultraShort.title,
                publishTime: detail.publishTime,
                forecastPeriod: detail.forecastPeriod,
                rawText: detail.rawText,
                categories: hasContent ? categories : null,
                hasContent
            };
        }

        // 단기 전망 수집
        if (reports.shortTerm) {
            console.log(`[MarineForecast] 단기 전망 수집: ${reports.shortTerm.title}`);
            const detail = await fetchForecastDetail(reports.shortTerm.id);
            const categories = extractCategories(detail.rawText);
            const hasContent = Object.keys(categories).length > 0;

            forecasts.shortTerm = {
                reportId: reports.shortTerm.id,
                title: reports.shortTerm.title,
                publishTime: detail.publishTime,
                forecastPeriod: detail.forecastPeriod,
                rawText: detail.rawText,
                categories: hasContent ? categories : null,
                hasContent
            };
        }

        // 저장
        const dataDir = path.dirname(DATA_FILE);
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(DATA_FILE, JSON.stringify(forecasts, null, 2), 'utf8');
        console.log('[MarineForecast] 해상 기상 전망 저장 완료');

        return forecasts;
    } catch (e) {
        console.error(`[MarineForecast] 수집 오류: ${e.message}`);
        return null;
    }
}

/**
 * 저장된 데이터 로드
 */
function loadForecasts() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        }
    } catch (e) {
        console.error(`[MarineForecast] 로드 오류: ${e.message}`);
    }
    return null;
}

module.exports = {
    collectMarineForecasts,
    loadForecasts,
    extractCategories,
    formatCategoryText
};
