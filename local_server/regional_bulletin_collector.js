/**
 * ============================================================================
 * 파일명: regional_bulletin_collector.js
 * 역할 : 지방기상청 [해설] 단기 전망 통보문을 수집해 AI 로 정제 + 기온을 추출,
 *        regional_forecast.json 의 summary / temperature / bulletin* 필드를 갱신
 * ============================================================================
 *
 * [수집 대상] 7개 지방기상청 — 앱 기존 표시 순서 유지
 *   수도권(109) → 부산(159) → 광주(156) → 강원(105)
 *   → 대전(133) → 대구(143) → 제주(184)
 *
 * [수집 방식]
 *   1) 통보문 페이지(list.do)에 stn={지방청코드}를 붙여 호출
 *      → 그 지방청이 발행한 통보문 목록만 select-list 로 응답됨
 *   2) 옵션 중 [해설] AND "단기 전망" (단, "초단기 전망"은 제외) 1건 선택
 *   3) 상세 페이지 호출 시에도 prevStn/stn 을 그 지방청 코드로 맞춰야 본문이
 *      정상 반환됨 (KMA 실측: 본청 108 로 호출하면 빈 본문이 반환됨)
 *   4) 본문을 Gemini AI 에 전달해 마크업({{loc:}}, {{num:}}, {{warn:}})을 입힌
 *      summary 와 대표 기온(아침최저/낮최고 범위)을 받아옴
 *
 * [발표 시각] KST 04:30 / 16:20~16:30 (지방청별 다름) — 하루 2회
 *
 * [실행 윈도우] scheduler.js 가 호출
 *   04:01~04:56 / 16:01~16:56  (5분 간격, min % 5 === 1)
 *   같은 윈도우 안에서 동일 reportId 는 캐시로 즉시 스킵되므로 5분마다 호출되어도
 *   실제 fetch/AI 호출은 처음 1회만 발생.
 *
 * [캐시 정책]
 *   디렉토리: data/forecast_cache/regional/
 *   파일명  : {officeCode}_{reportId}.json
 *   ─ 같은 시각 발표분이라도 지방청별로 동일한 reportId(예: cmt:202605021620:4)를
 *     공유할 수 있어, officeCode 접두를 붙여 충돌 방지.
 *   ─ 본청용 캐시(data/forecast_cache/) 와는 디렉토리가 분리되어 서로 영향 없음.
 *
 * [출력] regional_forecast.json[officeCode] 에 다음 필드를 partial-merge
 *   - bulletinReportId    : 이번에 수집된 통보문 ID
 *   - bulletinPublishTime : "2026.05.02 04:30" 형식의 발표시각 (헤더용)
 *   - summary             : 마크업이 적용된 전체 본문 텍스트
 *   - temperature         : { morningLow, dayHigh, basis } 또는 null
 *   PDF 출처 필드(publishTime, marineForecast, coastalForecast)는 그대로 유지된다.
 *
 * [연계]
 *   - scheduler.js                : 윈도우 시각에 collectAllRegionalBulletins() 호출
 *   - routes/weather.js           : /api/regional-forecast 가 이 JSON 그대로 응답
 *   - js/marine_forecast.js       : renderRegionalForecast() 가 새 필드를 사용해 표출
 *   - regional_forecast_collector : PDF 기반 marine/coastal 수집(별도, 충돌 없음)
 *   - services/gemini_client      : 공용 AI 호출 (키 라운드로빈, 쿨다운 공유)
 *   - marine_forecast_processor   : 본청 단기/초단기 전망(별도) — 본 모듈과 무관
 * ============================================================================
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const geminiClient = require('./services/gemini_client');

// ============================================================================
// 경로 / 상수
// ============================================================================

// PDF 수집기와 공유하는 결과 파일 — partial merge 로 사용
const DATA_FILE = path.join(__dirname, 'data', 'regional_forecast.json');

// 지방청 단기 전망 전용 캐시 디렉토리 (본청용 forecast_cache/ 와 분리)
const CACHE_DIR = path.join(__dirname, 'data', 'forecast_cache', 'regional');

// 7개 지방기상청 (앱 기존 표시 순서대로 — 수도권→부산→광주→강원→대전→대구→제주)
// code 는 KMA list.do 의 stn 파라미터, name 은 화면 헤더에 표출되는 라벨이다.
const BULLETIN_OFFICES = [
    { code: '109', name: '수도권기상청' },
    { code: '159', name: '부산지방기상청' },
    { code: '156', name: '광주지방기상청' },
    { code: '105', name: '강원지방기상청' },
    { code: '133', name: '대전지방기상청' },
    { code: '143', name: '대구지방기상청' },
    { code: '184', name: '제주지방기상청' },
];

const LIST_URL = 'https://www.weather.go.kr/w/special-report/list.do';

// ============================================================================
// AI 프롬프트
// ============================================================================
// marine_forecast_processor.js 의 FORECAST_AI_PROMPT 마크업 규칙(loc/num/warn)을
// 그대로 상속하되 출력 형식이 다르다.
//   - marine_forecast_processor: 카테고리(강풍/해상/너울/바다안개)별 {main,sub} 추출
//   - 본 모듈                  : 전체 본문(마크업 적용) + 대표 기온 추출
const REGIONAL_BULLETIN_AI_PROMPT = `
너는 대한민국 지방기상청 [해설] 단기 전망 통보문 전문 분석가이다.
주어진 통보문 본문을 분석하여 (1) 마크업이 적용된 전체 본문과 (2) 대표 기온을 JSON으로 반환한다.

### 1. 키워드 강조 마크업 (3종)
원문 텍스트 안에서 중요 키워드를 아래 마크업 태그로 감싼다.
태그는 HTML이 아닌 커스텀 마크업이며, 중첩하지 않는다. 조사(은/는/이/가/을/를/에 등)는 태그 바깥에 둔다.

#### 1-1. 지역/해역 (파랑): {{loc:텍스트}}
해역명, 지역명, 바다 이름 등 위치를 나타내는 표현을 감싼다.
예: {{loc:서울.인천.경기도}}, {{loc:서해중부먼바다}}, {{loc:강원동해안}}, {{loc:제주도전해상}}

#### 1-2. 위험 수치 (빨강): {{num:텍스트}}
풍속, 파고, 강수량, 적설량 등 구체적 수치와 단위를 감싼다.
"순간풍속", "파고" 등 접두 키워드 없이 단독으로 나오는 수치+단위도 반드시 감싼다.
예: {{num:순간풍속 55km/h(15m/s)}}, {{num:25~55km/h(7~15m/s)}}, {{num:1.5~3.5m}}, {{num:5~30mm}}

#### 1-3. 위험현상/주어/원인/결과 (주황): {{warn:텍스트}}
주요 주어, 위험의 원인이 되는 표현, 그 결과(특보 발표 가능성 등), 위험 기상 현상을 감싼다.
"~하기 바랍니다", "유의하기 바랍니다", "주의하기 바랍니다" 등 행동 지침은 감싸지 않는다.
예: {{warn:바람이}}, {{warn:물결이}}, {{warn:매우 강하게 불고}}, {{warn:매우 높게 일면서}},
    {{warn:풍랑특보를 발표할 가능성}}, {{warn:돌풍과 함께 천둥.번개}}, {{warn:바다안개}}

### 2. 본문 정제 규칙
- 원문 구조(섹션 헤더 <중점 사항>, <강수 및 유의 사항>, <기온 및 하늘상태> 등)를 보존한다.
- 줄바꿈/들여쓰기/○·-·* 글머리 기호 유지.
- HTML 엔티티(&lt; &gt; &amp;)는 원래 문자(<, >, &)로 변환.
- "날씨해설 다운로드", "첨부파일 다운로드" 같은 부가 텍스트는 제거.
- 원문에 없는 내용은 추가하지 않고, 텍스트 자체는 변경하지 않으며 마크업만 추가.

### 3. 대표 기온 추출 (매우 중요)

**3-1. 기준 시점 판정 (basis)**
본문에서 가장 먼저 나오는 "(오늘|내일)(N일) 아침최저기온은 …" 또는
"(오늘|내일)(N일) 낮최고기온은 …" 블록을 찾는다.
- "오늘"로 시작 → basis="today"
- "내일"로 시작 → basis="tomorrow"

**3-2. 추출 우선순위 (위에서부터 시도)**

(1) "등 X~Y℃" 패턴이 있으면 그 X~Y 사용.
    예: "서울 13℃, 인천 13℃, 수원 13℃ 등 11~13℃" → "11 ~ 13"

(2) 단독 범위 "X~Y℃"만 있으면 그 X~Y 사용.
    "(평년 …)", "(오늘 …, 6~15℃)", "보다 1~7℃ 높겠고" 등 비교/괄호는 무시.
    예: "내일 아침최저기온은 12~14℃" → "12 ~ 14"
    예: "낮최고기온은 19~21℃(평년 19~21℃)" → "19 ~ 21"

(3) 여러 지역명+범위가 콤마로 나열되면, 모든 범위(및 단일 값)의
    최솟값~최댓값으로 묶어 반환.
    예: "강원내륙 10~12℃, 강원산지 8~9℃, 강원동해안 13~14℃" → "8 ~ 14"
    예: "부산 14℃, 울산 14℃, 경상남도 11~14℃로 …" → "11 ~ 14"

**3-3. 형식**
- "X ~ Y" 형태의 문자열 (정수 또는 한 자리 소수).
- 값이 -30 ~ 50 범위를 벗어나면 신뢰 불가 → null.

**3-4. 추출 불가 시**
- 본문에 위 어떤 패턴도 없으면 temperature 전체를 null 로 반환.

### 4. 출력 형식 (반드시 JSON만, 추가 설명 금지)

성공:
{
  "summary": "마크업이 적용된 전체 본문 텍스트 (줄바꿈 보존)",
  "temperature": {
    "morningLow": "11 ~ 13",
    "dayHigh":    "15 ~ 17",
    "basis":      "tomorrow"
  }
}

기온 추출 실패:
{
  "summary": "마크업이 적용된 전체 본문 텍스트",
  "temperature": null
}
`;

// ============================================================================
// HTTP / 파싱 유틸
// ============================================================================

/**
 * 단순 HTTPS GET → UTF-8 텍스트 반환.
 * (다른 모듈의 fetchHtml 과 동일 패턴 — 의존성 최소화 위해 자체 구현)
 *
 * [timeout] 15초 — 응답 없는 KMA 사이트에 영원히 매달리지 않도록.
 *   다른 수집 모듈(regional_forecast_collector.fetchPdf 등)과 동일 값.
 *   timeout 시 reject → 호출측이 캐시 저장 안 하고 다음 5분 사이클에 재시도.
 */
function fetchHtml(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 15000
        }, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
}

/**
 * 옵션 제목에서 발표시각 추출 → "2026.05.02 16:30" 형식
 * 제목 예: "[해설] 제05-4호 : 2026.05.02.16:30/ 단기 전망"
 */
function parsePublishTimeFromTitle(title) {
    if (!title) return '';
    const m = title.match(/(\d{4})\.(\d{2})\.(\d{2})\.(\d{2}):(\d{2})/);
    if (!m) return '';
    return `${m[1]}.${m[2]}.${m[3]} ${m[4]}:${m[5]}`;
}

/**
 * 한 지방청의 list.do 에서 가장 최신 [해설] 단기 전망 옵션 1건을 반환.
 * - "초단기 전망"은 제외 — 단순 substring "단기 전망" 매칭이면 초단기도 잡혀버리므로
 *   부정형 lookbehind (?<!초) 로 보호한다.
 * - select-list 가 비어있는 일시적 빈 응답에 대비해 1회 재시도(800ms 대기).
 *   (109 수도권에서 관측된 간헐적 빈 응답 안전망)
 */
async function findBulletinForOffice(officeCode) {
    const url = `${LIST_URL}?stn=${officeCode}`;
    let html = await fetchHtml(url);
    let m = html.match(/<select id="select-list"[^>]*>([\s\S]*?)<\/select>/);

    if (!m) {
        await new Promise(r => setTimeout(r, 800));
        html = await fetchHtml(url);
        m = html.match(/<select id="select-list"[^>]*>([\s\S]*?)<\/select>/);
        if (!m) return null;
    }

    const optionRe = /<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g;
    let opt;
    while ((opt = optionRe.exec(m[1])) !== null) {
        const id = opt[1];
        const title = opt[2].trim();
        if (!title.includes('[해설]')) continue;
        if (!/(?<!초)단기 전망/.test(title)) continue;
        // select-list 는 최신순 정렬이므로 첫 매칭 = 최신
        return { reportId: id, title };
    }
    return null;
}

/**
 * 통보문 상세 페이지에서 본문 텍스트를 추출.
 *
 * KMA 실측: cmt: 접두 통보문(지방청 코멘터리)은 호출 시 prevStn/stn 을 해당
 * 지방청 코드로 맞추지 않으면 본문이 비거나 다운로드 안내 문구만 반환된다.
 * 따라서 list.do 호출 시 사용한 같은 stn 코드를 그대로 detail 호출에도 사용한다.
 */
async function fetchBulletinBody(officeCode, reportId) {
    const ts = (reportId.split(':')[1] || '');
    const dateParam = ts.substring(0, 4) + '-' + ts.substring(4, 6) + '-' + ts.substring(6, 8);
    const url = `${LIST_URL}?prevStn=${officeCode}&stn=${officeCode}&date=${dateParam}&reportId=${reportId}`;

    const html = await fetchHtml(url);

    // cmp-view-content 본문 추출 (HTML 구조 변경 대비 다중 패턴 — 다른 모듈과 동일)
    const patterns = [
        /<div class="cmp-view-content">([\s\S]*?)<\/div>\s*<\/section>/,
        /<div class="cmp-view-content">([\s\S]*?)<\/div>\s*<\/div>/,
        /<div class="cmp-view-content">([\s\S]*)<\/div>/,
    ];
    let contentHtml = '';
    for (const p of patterns) {
        const mm = html.match(p);
        if (mm && mm[1] && mm[1].trim().length > 20) {
            contentHtml = mm[1];
            break;
        }
    }
    if (!contentHtml) return '';

    // 태그 제거 + HTML 엔티티 디코드 + 부가 텍스트 정리
    let text = contentHtml
        .replace(/<p[^>]*>/g, '\n').replace(/<\/p>/g, '\n').replace(/<br\s*\/?>/g, '\n')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
        .replace(/[ ]+/g, ' ');

    text = text
        .replace(/날씨해설\s*다운로드/g, '')
        .replace(/첨부파일\s*다운로드/g, '')
        .replace(/\[?\s*날씨해설\s*\]?/g, '')
        .trim();

    return text;
}

// ============================================================================
// AI 호출
// ============================================================================

/**
 * 본문을 Gemini 에 보내 { summary, temperature } 형식으로 정제 반환.
 * 실패(키 없음/쿨다운/JSON 파싱 오류 등) 시 null — 호출측이 캐시 저장 안 하고 다음 사이클에 재시도.
 */
async function analyzeBulletinWithAI(rawText) {
    if (!geminiClient.hasAnyKey()) {
        console.log('[RegionalBulletin] GEMINI_API_KEY 없음, AI 분석 건너뜀');
        return null;
    }

    const userPrompt = `## 통보문 본문\n${rawText}\n\n위 본문을 분석하여 마크업 적용 본문과 대표 기온을 JSON으로 반환하라.`;

    const callResult = await geminiClient.callGemini({
        model: 'gemini-2.5-flash-lite',
        contents: REGIONAL_BULLETIN_AI_PROMPT + '\n\n' + userPrompt,
        config: { responseMimeType: 'application/json' },
        caller: 'RegionalBulletin'
    });

    if (!callResult.success) {
        if (callResult.isRateLimited) {
            console.warn('[RegionalBulletin] 모든 Gemini 키 쿨다운 중, 분석 건너뜀');
        } else {
            console.error(`[RegionalBulletin] AI 분석 오류: ${callResult.error}`);
        }
        return null;
    }

    try {
        const parsed = JSON.parse(callResult.text);
        // sanity: 기온이 한국 기온 범위(-30~50) 안에 있는지 검증. 벗어나면 통째로 폐기.
        if (parsed.temperature) {
            const ok = isValidTempRange(parsed.temperature.morningLow)
                    && isValidTempRange(parsed.temperature.dayHigh);
            if (!ok) parsed.temperature = null;
        }
        return parsed;
    } catch (e) {
        console.error(`[RegionalBulletin] AI 응답 JSON 파싱 실패: ${e.message}`);
        return null;
    }
}

/**
 * "X ~ Y" 형식 문자열이 한국 기온 합리 범위(-30 ~ 50℃) 안인지 검증.
 * AI 가 강수량/풍속 등 다른 수치를 잘못 넣은 경우를 차단.
 */
function isValidTempRange(s) {
    if (typeof s !== 'string') return false;
    const m = s.match(/^\s*(-?\d{1,2}(?:\.\d)?)\s*~\s*(-?\d{1,2}(?:\.\d)?)\s*$/);
    if (!m) return false;
    const a = parseFloat(m[1]);
    const b = parseFloat(m[2]);
    return a >= -30 && a <= 50 && b >= -30 && b <= 50;
}

// ============================================================================
// 캐시
// ============================================================================

function ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * 캐시 파일 경로 — officeCode 와 reportId 조합으로 충돌 방지.
 *
 * [왜 officeCode 가 필요?]
 * KMA reportId 는 발표시각+호번 조합(예: cmt:202605021620:4)인데,
 * 같은 시각 발표분이라도 부산(159) / 강원(105) 등 여러 지방청이 동일 ID 를
 * 발급한다(2026-05-02 실측 확인). 그래서 officeCode 접두 없이는 캐시가
 * 서로를 덮어써 잘못된 화면이 표출됨.
 */
function getCachePath(officeCode, reportId) {
    const safeId = reportId.replace(/[/:]/g, '_');
    return path.join(CACHE_DIR, `${officeCode}_${safeId}.json`);
}

function loadCache(officeCode, reportId) {
    try {
        const p = getCachePath(officeCode, reportId);
        if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (_) { /* 캐시 손상 시 조용히 miss 처리 */ }
    return null;
}

function saveCache(officeCode, reportId, data) {
    try {
        ensureCacheDir();
        fs.writeFileSync(getCachePath(officeCode, reportId), JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error(`[RegionalBulletin] 캐시 저장 오류 (${officeCode}/${reportId}): ${e.message}`);
    }
}

// ============================================================================
// 한 지방청 단위 처리
// ============================================================================

/**
 * 한 지방청 처리 흐름:
 *   1) list.do?stn=XXX 에서 최신 [해설] 단기 전망 reportId 찾기
 *   2) 캐시 hit → 즉시 반환 (사용자 요구 "이미 수집된 건 다시 안 가져옴" 충족)
 *   3) 캐시 miss → 본문 fetch → AI 분석 → 캐시 저장
 *
 * 반환:
 *   { reportId, title, publishTime, rawText, summary, temperature, collectedAt, fromCache }
 *   또는 null (수집/분석 실패)
 */
async function processOneOffice(office) {
    try {
        const found = await findBulletinForOffice(office.code);
        if (!found) {
            console.log(`[RegionalBulletin] ${office.name}: 단기 전망 옵션 없음`);
            return null;
        }

        // 캐시 hit ?  → 같은 윈도우 내 5분 간격 재호출은 여기서 끝남 (fetch/AI 호출 0회)
        const cached = loadCache(office.code, found.reportId);
        if (cached && cached.summary !== undefined) {
            console.log(`[RegionalBulletin] ${office.name}: 캐시 hit (${found.title})`);
            return { ...cached, fromCache: true };
        }

        console.log(`[RegionalBulletin] ${office.name}: 새 통보문 수집 (${found.title})`);
        const rawText = await fetchBulletinBody(office.code, found.reportId);
        if (!rawText) {
            console.log(`[RegionalBulletin] ${office.name}: 본문 비어있음, 스킵`);
            return null;
        }

        const ai = await analyzeBulletinWithAI(rawText);
        if (!ai || !ai.summary) {
            // AI 실패 시 캐시 저장하지 않음 — 다음 사이클(5분 뒤)에 재시도
            console.log(`[RegionalBulletin] ${office.name}: AI 분석 실패, 다음 사이클 재시도 예정`);
            return null;
        }

        const result = {
            reportId: found.reportId,
            title: found.title,
            publishTime: parsePublishTimeFromTitle(found.title),
            rawText,
            summary: ai.summary,
            temperature: ai.temperature || null,
            collectedAt: new Date().toISOString()
        };

        saveCache(office.code, found.reportId, result);
        return { ...result, fromCache: false };
    } catch (e) {
        console.error(`[RegionalBulletin] ${office.name} 처리 오류: ${e.message}`);
        return null;
    }
}

// ============================================================================
// 메인 진입점
// ============================================================================

/**
 * 7개 지방청을 순회하며 단기 전망을 수집하고, regional_forecast.json 의
 * summary / temperature / bulletin* 필드를 partial-merge 한다.
 *
 * PDF 출처 필드(publishTime, marineForecast, coastalForecast)는 보존한다.
 *
 * 호출 시점: scheduler.js 가 04:01~04:56, 16:01~16:56 KST 에 5분마다 호출.
 * 모든 지방청 캐시가 hit 이면 fetch/AI 호출이 0회로 끝나 부담 없음.
 */
async function collectAllRegionalBulletins() {
    console.log('[RegionalBulletin] 지방청 단기 전망 수집 시작');
    ensureCacheDir();

    // PDF 수집기가 채워둔 기존 데이터 보존을 위해 먼저 읽음
    let store = {};
    try {
        if (fs.existsSync(DATA_FILE)) {
            store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        }
    } catch (e) {
        console.error(`[RegionalBulletin] 기존 JSON 로드 실패: ${e.message}, 빈 상태로 시작`);
        store = {};
    }

    let updated = 0;
    let cacheHits = 0;
    let failed = 0;

    for (const office of BULLETIN_OFFICES) {
        const result = await processOneOffice(office);
        if (!result) { failed++; continue; }

        if (result.fromCache) cacheHits++; else updated++;

        // partial merge: prev 의 PDF 필드(publishTime, marineForecast, coastalForecast 등)는
        // 보존하고 통보문 출처 필드만 덮어쓴다.
        const prev = store[office.code] || {};
        store[office.code] = {
            ...prev,
            officeCode: office.code,
            officeName: office.name,
            // ↓ 이 모듈이 책임지는 필드들
            bulletinReportId: result.reportId,
            bulletinPublishTime: result.publishTime,
            summary: result.summary,
            temperature: result.temperature,
            collectedAt: result.collectedAt,
        };

        // KMA 부하 보호용 짧은 딜레이
        await new Promise(r => setTimeout(r, 300));
    }

    store._lastUpdated = new Date().toISOString();

    try {
        const dir = path.dirname(DATA_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
    } catch (e) {
        console.error(`[RegionalBulletin] 저장 오류: ${e.message}`);
    }

    console.log(`[RegionalBulletin] 완료: 신규 ${updated}건 / 캐시 ${cacheHits}건 / 실패 ${failed}건`);
    return store;
}

module.exports = {
    collectAllRegionalBulletins,
    processOneOffice,
    findBulletinForOffice,
    fetchBulletinBody,
    analyzeBulletinWithAI,
    isValidTempRange,
    BULLETIN_OFFICES,
    REGIONAL_BULLETIN_AI_PROMPT,
};
