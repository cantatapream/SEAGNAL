/**
 * ============================================================================
 * 파일명: marine_forecast_processor.js
 * 역할: 기상청 통보문에서 해상 기상 전망 (초단기/단기) 파싱 + AI 분석
 * ============================================================================
 *
 * [설명]
 * - 통보문(list.do)에서 cmt: 접두사인 해설 통보문 중 초단기/단기 전망을 수집
 * - 원문에서 강풍, 해상, 너울, 바다안개 카테고리 텍스트를 추출
 * - AI 분석으로 원문+추출 결과를 검토하여 최종 표출 데이터 생성
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
require('dotenv').config();

// [공용 Gemini 클라이언트] 기본 키 + 백업 키 라운드로빈/폴백 + 공유 쿨다운
// → 개별 쿨다운 변수는 gemini_client.js 내부로 이관
// → 특보 분석과 해상 전망이 쿨다운 상태를 공유하여 중복 시도 방지
const geminiClient = require('./services/gemini_client');

const DATA_FILE = path.join(__dirname, 'data', 'marine_forecast.json');
const FORECAST_CACHE_DIR = path.join(__dirname, 'data', 'forecast_cache');

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
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
        .replace(/[ ]+/g, ' ').trim();

    // 불필요한 부가 텍스트 제거 (날씨해설 다운로드, 첨부파일 안내 등)
    rawText = rawText
        .replace(/날씨해설\s*다운로드/g, '')
        .replace(/첨부파일\s*다운로드/g, '')
        .replace(/\[?\s*날씨해설\s*\]?/g, '')
        .trim();

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

// ============================================================================
// AI 분석: 원문 + 텍스트 파싱 결과를 AI가 검토하여 최종 표출 데이터 생성
// ============================================================================

const FORECAST_AI_PROMPT = `
너는 대한민국 기상청 해상 기상 전망 통보문 전문 분석가이다.
주어진 원문 텍스트와 코드가 추출한 카테고리별 텍스트를 검토하여, 최종적으로 사용자에게 표출할 정제된 카테고리별 데이터를 생성해야 한다.

### 1. 분석 대상 카테고리
해상 기상 전망 통보문에는 다음 카테고리가 포함될 수 있다:
- **강풍**: 바람 관련 예보 (해상 강풍, 돌풍 등)
- **해상**: 해상 상태, 파도 높이 등
- **너울**: 너울성 파도 관련
- **바다안개**: 해무, 안개 관련

### 2. 분석 규칙 (매우 중요)
- 원문에서 각 카테고리는 "○ (카테고리명)" 패턴으로 시작한다. 예: "○ (강풍)", "○ (바다 안개)"
- 카테고리 내용은 다음 카테고리 시작("○ (") 또는 다른 섹션 구분자("<기온>", "<하늘상태 및 강수>", "<건조 및 강풍>" 등)가 나올 때까지이다.
- **중요**: "<기온>", "<하늘상태 및 강수>", "<건조 및 강풍>" 등 꺽쇠(<>) 안의 내용은 해상 전망과 무관한 육상 기상 정보이므로, 해당 내용은 반드시 제외해야 한다.
- 하위 항목은 "- "로 시작하는 줄이다.
- 각 카테고리의 본문(main)과 하위 항목(sub)을 명확히 분리해야 한다.

### 3. 텍스트 정제 규칙
- HTML 엔티티(&lt;, &gt;, &amp; 등)가 남아있으면 올바른 문자로 변환한다.
- 불필요한 공백, 중복 줄바꿈을 정리한다.
- 원문의 의미를 훼손하지 않되, 읽기 좋게 정리한다.
- 원문에 없는 내용을 추가하거나 임의로 수정하지 않는다.
- **중요**: "날씨해설 다운로드", "첨부파일 다운로드" 등 기상 전망 내용과 무관한 부가 텍스트는 반드시 제거한다.

### 4. 키워드 강조 마크업 (매우 중요)
텍스트 안에서 중요 키워드를 아래 3가지 마크업 태그로 감싸야 한다.
태그는 반드시 아래 형식을 사용하며, HTML 태그가 아닌 커스텀 마크업이다.

#### 4-1. 지역/해역 (파랑): {{loc:텍스트}}
해역명, 지역명, 바다 이름 등 위치를 나타내는 표현을 감싼다.
예시:
- {{loc:경상권해안}}, {{loc:서해상}}, {{loc:동해남부먼바다}}, {{loc:섬 지역}}
- {{loc:서해중부 이남 해상}}, {{loc:제주도전해상}}
- 조사(을, 에, 에는 등)는 태그 바깥에 둔다: "{{loc:서해상}}에는"

#### 4-2. 위험 수치 (빨강): {{num:텍스트}}
풍속, 파고, 거리, 온도 등 구체적 수치와 단위를 감싼다.
예시:
- {{num:순간풍속 55km/h(15m/s)}}, {{num:가시거리 200m 미만}}, {{num:파고 2~4m}}
- {{num:최대풍속 50km/h(14m/s) 이상}}
- {{num:30~60km/h(8~16m/s)}}, {{num:25~45km/h(8~13m/s)}} (접두사 없는 풍속 수치도 반드시 감싼다)
- {{num:1.5~3.5m}}, {{num:1.0~2.5m}} (접두사 없는 파고/물결 높이도 반드시 감싼다)
- 수치 앞뒤 설명이 수치와 함께 하나의 의미를 이루면 함께 감싼다
- **중요**: "순간풍속", "파고" 등 접두 키워드 없이 단독으로 나오는 수치+단위도 반드시 {{num:}}으로 감싸야 한다

#### 4-3. 위험현상/주어/원인/결과 (주황): {{warn:텍스트}}
주요 주어, 위험의 원인이 되는 표현, 그 결과(특보 발표 가능성 등), 위험 기상 현상을 감싼다.
**"~하기 바랍니다", "유의하기 바랍니다", "주의하기 바랍니다", "확인하기 바랍니다" 같은 행동 지침은 감싸지 않는다.**
예시:
- 주요 주어: {{warn:바람이}}, {{warn:물결이}} (위험 상황을 설명하는 문맥에서)
- 위험 강도 표현(원인): {{warn:매우 강하게 불고}}, {{warn:매우 높게 일면서}}, {{warn:강하게 불고}}, {{warn:강하게 부는 곳}}
- 결과: {{warn:풍랑특보를 발표할 가능성}}, {{warn:풍랑특보}}
- 위험 기상 현상: {{warn:돌풍}}, {{warn:천둥.번개}}, {{warn:돌풍과 함께 천둥.번개}}, {{warn:너울성 파도}}
- 해상 주요 키워드: {{warn:바다안개}}, {{warn:바다 안개}}, {{warn:짙은 안개가 끼는 곳}}, {{warn:안개가 끼는 곳}}
- 감싸지 않는 것: "유의하기 바랍니다", "주의하기 바랍니다", "확인하기 바랍니다", "참고하기 바랍니다", "시설물 관리", "안전사고에 유의" 등 행동 지침

#### 마크업 적용 규칙
- 태그는 중첩하지 않는다 (태그 안에 다른 태그를 넣지 않는다)
- 조사(은,는,이,가,을,를,에,에서,으로 등)는 태그 바깥에 둔다
- 한 문장에 같은 종류의 태그가 여러 번 올 수 있다
- main과 sub 모두에 마크업을 적용한다
- 원문 텍스트 자체는 변경하지 않고, 태그만 추가한다

적용 예시:
입력: "모레(23일) 오후부터 밤 사이 경상권해안을 중심으로 바람이 순간풍속 55km/h(15m/s) 안팎으로 강하게 부는 곳이 있겠으니, 시설물 관리와 안전사고에 유의하기 바랍니다."
출력: "모레(23일) 오후부터 밤 사이 {{loc:경상권해안}}을 중심으로 {{warn:바람이}} {{num:순간풍속 55km/h(15m/s)}} 안팎으로 {{warn:강하게 부는 곳}}이 있겠으니, 시설물 관리와 안전사고에 유의하기 바랍니다."

입력: "제주도남쪽먼바다와 남부앞바다에는 차차 바람이 30~60km/h(8~16m/s)로 매우 강하게 불고, 물결이 1.5~3.5m로 매우 높게 일면서 풍랑특보를 발표할 가능성이 있겠으니"
출력: "{{loc:제주도남쪽먼바다}}와 {{loc:남부앞바다}}에는 차차 {{warn:바람이}} {{num:30~60km/h(8~16m/s)}}로 {{warn:매우 강하게 불고}}, {{warn:물결이}} {{num:1.5~3.5m}}로 {{warn:매우 높게 일면서}} {{warn:풍랑특보를 발표할 가능성}}이 있겠으니"

입력: "내일 제주도남쪽먼바다를 중심으로 돌풍과 함께 천둥.번개가 치는 곳이 있겠으니"
출력: "내일 {{loc:제주도남쪽먼바다}}를 중심으로 {{warn:돌풍과 함께 천둥.번개}}가 치는 곳이 있겠으니"

### 5. 출력 형식
반드시 아래 JSON 형식으로만 응답하라. 추가 설명은 생략한다.
{
  "categories": {
    "강풍": {
      "main": "마크업이 적용된 카테고리 본문 텍스트 (하위 항목 제외, 한 줄로)",
      "sub": ["- 마크업이 적용된 하위 항목 1", "- 마크업이 적용된 하위 항목 2"]
    },
    "바다안개": {
      "main": "...",
      "sub": ["- ..."]
    }
  },
  "issues": ["코드 추출과 다른 점이 있으면 여기에 기록 (없으면 빈 배열)"]
}

### 6. 검증 (반드시 수행)
- 코드가 추출한 결과와 원문을 비교하여, 코드 추출이 잘못된 부분이 있으면 교정한다.
- 특히 카테고리 경계가 잘못 잡혀 다른 섹션의 내용이 섞인 경우 반드시 분리한다.
- 원문에 존재하는 카테고리인데 코드가 누락한 경우 추가한다.
- 원문에 해당 카테고리가 없는데 코드가 잘못 추출한 경우 제거한다.
`;

/**
 * AI 분석으로 전망 텍스트를 정제한다
 * - 공용 geminiClient를 사용하여 기본/백업 키 라운드로빈 + 자동 폴백
 * - AI 호출 실패 시 null 반환 → 호출측이 코드 추출 결과를 사용하여 서비스 영향 없음
 */
async function analyzeWithAI(rawText, codeExtracted) {
    if (!geminiClient.hasAnyKey()) {
        console.log('[MarineForecast] GEMINI_API_KEY 없음, AI 분석 건너뜀');
        return null;
    }

    try {
        const userPrompt = `## 원문 텍스트
${rawText}

## 코드 추출 결과
${JSON.stringify(codeExtracted, null, 2)}

위 원문과 코드 추출 결과를 비교 검토하여, 최종 표출용 정제 데이터를 JSON으로 반환하라.`;

        // [공용 클라이언트 호출] 기본 키 429 시 자동으로 백업 키로 폴백됨
        const callResult = await geminiClient.callGemini({
            model: 'gemini-2.5-flash-lite',
            contents: FORECAST_AI_PROMPT + '\n\n' + userPrompt,
            config: { responseMimeType: 'application/json' },
            caller: 'MarineForecast'
        });

        if (!callResult.success) {
            if (callResult.isRateLimited) {
                console.warn('[MarineForecast] 모든 Gemini 키 쿨다운 중, AI 분석 건너뜀 → 코드 추출 결과 사용');
            } else {
                console.error(`[MarineForecast] AI 분석 오류: ${callResult.error}`);
            }
            return null;
        }

        const parsed = JSON.parse(callResult.text);
        console.log(`[MarineForecast] AI 분석 완료 (${callResult.keyLabel} 키 사용)`);
        if (parsed.issues && parsed.issues.length > 0) {
            console.log('[MarineForecast] AI 발견 이슈:', parsed.issues);
        }
        return parsed;
    } catch (e) {
        // JSON.parse 실패 등 기타 오류
        console.error(`[MarineForecast] AI 분석 오류: ${e.message}`);
        return null;
    }
}

/**
 * 전망 캐시 저장
 */
function saveForecastCache(reportId, data) {
    try {
        if (!fs.existsSync(FORECAST_CACHE_DIR)) fs.mkdirSync(FORECAST_CACHE_DIR, { recursive: true });
        const fileName = reportId.replace(/[/:]/g, '_') + '.json';
        fs.writeFileSync(path.join(FORECAST_CACHE_DIR, fileName), JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error(`[MarineForecast] 캐시 저장 오류: ${e.message}`);
    }
}

/**
 * 전망 캐시 로드
 */
function loadForecastCache(reportId) {
    try {
        const fileName = reportId.replace(/[/:]/g, '_') + '.json';
        const filePath = path.join(FORECAST_CACHE_DIR, fileName);
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) { }
    return null;
}

/**
 * 전망 캐시 목록 조회
 */
function listForecastCaches() {
    try {
        if (!fs.existsSync(FORECAST_CACHE_DIR)) return [];
        return fs.readdirSync(FORECAST_CACHE_DIR)
            .filter(f => f.endsWith('.json'))
            .map(f => {
                try {
                    const data = JSON.parse(fs.readFileSync(path.join(FORECAST_CACHE_DIR, f), 'utf8'));
                    return {
                        reportId: data.reportId,
                        title: data.title,
                        type: data.type,
                        publishTime: data.publishTime,
                        hasAiResult: !!data.aiResult,
                        fileName: f
                    };
                } catch (e) { return null; }
            })
            .filter(Boolean)
            .sort((a, b) => (b.publishTime || '').localeCompare(a.publishTime || ''));
    } catch (e) { return []; }
}

/**
 * 메인 수집 함수: 최신 초단기/단기 전망을 수집하고 저장한다
 */
async function collectMarineForecasts() {
    console.log('[MarineForecast] 해상 기상 전망 수집 시작...');

    try {
        const reports = await findForecastReports();

        // 기존 데이터 로드 (새 수집 실패 시 기존 데이터 보존)
        let forecasts = { ultraShort: null, shortTerm: null, updatedAt: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) };
        try {
            if (fs.existsSync(DATA_FILE)) {
                const existing = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
                if (existing.ultraShort) forecasts.ultraShort = existing.ultraShort;
                if (existing.shortTerm) forecasts.shortTerm = existing.shortTerm;
            }
        } catch (e) { /* 기존 파일 읽기 실패 시 무시 */ }

        // 초단기/단기 공통 수집+AI 분석 처리
        async function processForecast(report, typeLabel) {
            // [중복 처리 방지] 동일 reportId에 대해 이미 AI 분석이 완료된 캐시가 있으면 재사용
            // → 기상청이 새 전망을 발행하면 reportId가 바뀌므로 자동으로 캐시 miss → 새로 처리됨
            // → 이전 시도에서 AI 실패(aiResult=null)한 경우는 재시도 필요하므로 aiResult 존재 여부 확인
            // → 원문 fetch(fetchForecastDetail)도 건너뛰어 기상청 서버 부하도 경감
            const cached = loadForecastCache(report.id);
            if (cached && cached.aiResult && cached.categories) {
                console.log(`[MarineForecast] ${typeLabel} 캐시 사용 (AI 재호출 불필요): ${report.title}`);
                return cached;
            }

            console.log(`[MarineForecast] ${typeLabel} 수집: ${report.title}`);
            const detail = await fetchForecastDetail(report.id);
            const codeCategories = extractCategories(detail.rawText);
            const hasContent = Object.keys(codeCategories).length > 0;

            // AI 분석 실행 (원문에 해상 관련 키워드가 있을 때만)
            let aiResult = null;
            const hasMarineKeywords = /강풍|바다\s*안개|해상|너울/.test(detail.rawText);
            if (hasContent && hasMarineKeywords) {
                aiResult = await analyzeWithAI(detail.rawText, codeCategories);
            }

            // AI 결과가 있으면 AI 카테고리를 최종 사용, 없으면 코드 추출 결과 사용
            const finalCategories = (aiResult && aiResult.categories) ? aiResult.categories : (hasContent ? codeCategories : null);

            const forecastData = {
                reportId: report.id,
                title: report.title,
                type: typeLabel,
                publishTime: detail.publishTime,
                forecastPeriod: detail.forecastPeriod,
                rawText: detail.rawText,
                codeCategories: hasContent ? codeCategories : null,
                aiResult: aiResult,
                categories: finalCategories,
                hasContent: hasContent || !!(aiResult && aiResult.categories && Object.keys(aiResult.categories).length > 0)
            };

            // 캐시 저장
            saveForecastCache(report.id, forecastData);

            return forecastData;
        }

        // 초단기 전망 수집
        if (reports.ultraShort) {
            forecasts.ultraShort = await processForecast(reports.ultraShort, '초단기전망');
        }

        // 단기 전망 수집
        if (reports.shortTerm) {
            forecasts.shortTerm = await processForecast(reports.shortTerm, '단기전망');
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
    formatCategoryText,
    loadForecastCache,
    listForecastCaches,
    analyzeWithAI,
    saveForecastCache
};
