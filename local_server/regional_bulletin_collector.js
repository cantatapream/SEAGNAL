/**
 * ============================================================================
 * 파일명: regional_bulletin_collector.js
 * 역할 : 지방기상청 [해설] 단기 전망 통보문을 수집해 AI 로 정제,
 *        regional_forecast.json 의 summary / bulletin* 필드를 갱신.
 *        (기온은 PDF 파이프라인이 책임 — 본 모듈은 본문만 다룸)
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
 * [발표 시각] KST 04:40~04:50 / 16:40 (지방청별 다름, 실측 2026-06) — 하루 2회
 *   ※ 과거 04:30 / 16:20~16:30 에서 뒤로 이동했고 웹 게시는 더 지연될 수 있어
 *     발표 시각대 한 시간만으론 늦게 뜨는 발표분(특히 오후)을 놓친다 → 윈도우를 한 시간 더 넓힘.
 *
 * [실행 윈도우] scheduler.js 가 호출
 *   04:01~05:56 / 16:01~17:56  (5분 간격, min % 5 === 1)
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
 *                           (AI 색칠 실패 시엔 마크업 없는 원문 텍스트 — 프론트가 자동 색칠/표출)
 *   - bulletinColored     : AI 색칠 완료 여부(false=원문만 표출 중, 다음 사이클 재색칠 대상)
 *   PDF 출처 필드(publishTime, temperature, marineForecast, coastalForecast)는 그대로 유지.
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
주어진 통보문 본문을 분석하여 마크업이 적용된 전체 본문 텍스트를 JSON으로 반환한다.
(기온 추출은 별도 PDF 파이프라인이 담당하므로 본 프롬프트에서는 다루지 않는다.)

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

### 3. 해상구역별 전망 추출 (marineOutlooks)
본문에서 해상 특보구역(…안쪽먼바다/…바깥먼바다/…먼바다/…앞바다/전해상 등) 단위의
바람·물결 전망을 구역별로 추출한다. 각 항목은 sentence(문장) + wind/wave(수치)로 구성한다.
- sentence 규칙: 시점 표현(오늘/내일/모레(N일) 오전·오후 등) 보존, 수치·단위(괄호 포함) 제거,
  "항해나 조업하는 선박은 유의…", "앞으로 발표하는 기상정보를 참고…" 등 행동지침 제거,
  마크업({{..}}) 없이 평문, "~겠음" 종결로 간결하게.
- wind 규칙: 그 구역 바람의 풍속을 m/s 범위 문자열로(괄호 안 m/s 값). 예 "30~50km/h(9~14m/s)" → "9~14".
  단일값이면 "12". 풍속 수치가 없으면 null.
- wave 규칙: 그 구역 물결(파고)을 m 범위 문자열로. 예 "1.5~3.0m" → "1.5~3.0". 단일값이면 "2.0".
  파고 수치가 없으면 null.
  예) 원문 "모레(14일) 오후부터 제주도남쪽바깥먼바다에는 차차 바람이 30~50km/h(9~14m/s)로
      강하게 불고, 물결이 1.5~3.0m로 높게 일겠으니, 항해나 조업하는 선박은 유의하기 바라며…"
      → { "zone": "제주도남쪽바깥먼바다",
          "sentence": "모레(14일) 오후부터 차차 바람이 강하게 불고 물결이 높게 일겠음",
          "wind": "9~14", "wave": "1.5~3.0" }
- zone 은 본문에 등장한 구역명 그대로(여러 구역이 묶이면 그 묶음 표현 그대로).
- 해당 내용이 없으면 빈 배열 [].

### 4. 출력 형식 (반드시 JSON만, 추가 설명 금지)

{
  "summary": "마크업이 적용된 전체 본문 텍스트 (줄바꿈 보존)",
  "marineOutlooks": [{ "zone": "구역명", "sentence": "전망 문장", "wind": "9~14"|null, "wave": "1.5~3.0"|null }]
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
 * 본문을 Gemini 에 보내 { summary } 형식으로 정제 반환.
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
        return JSON.parse(callResult.text);
    } catch (e) {
        console.error(`[RegionalBulletin] AI 응답 JSON 파싱 실패: ${e.message}`);
        return null;
    }
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
// 발표 사이클 ID — 같은 사이클이면 수집 생략 (KMA list.do 호출 자체 절감)
// ============================================================================
//
// KMA 단기 전망 발표 주기(실측 2026-06): AM 04:40~04:50 / PM 16:40 (지방청별 다름).
//   ※ 아래 사이클 경계(04:30 / 16:20)는 실제 발표보다 일부러 조금 이르게 둬,
//     경계를 넘는 순간부터 "이제 새 발표분을 찾아라" 상태가 되어 발표 직후부터 수집을
//     시도하게 한다. 실제 게시가 늦어도 윈도우(05/17시까지)가 끝까지 재시도한다.
//
// 사이클 경계 (KST):
//   00:00 ~ 04:29  → 어제 PM 사이클
//   04:30 ~ 16:19  → 오늘 AM 사이클
//   16:20 ~ 23:59  → 오늘 PM 사이클
//
// 저장된 통보문의 사이클 ID 와 현재 시각의 기대 사이클 ID 가 일치하면
// "이미 최신 데이터 보유" 로 판단 → list.do 호출 자체를 생략한다.
// 일치하지 않으면 새 사이클이 도래했거나 미보유 상태이므로 수집을 진행.
//
// 부팅 시 + 윈도우 안 5분마다 트리거 모두에 동일 적용 → 사이클 전환 시각
// (04:31, 16:21 또는 16:31) 직후 1회만 실제 KMA 호출 발생.

/**
 * 저장된 통보문의 발표시각 문자열로부터 사이클 ID 를 만든다.
 *   "2026.05.02 04:30" → "20260502-am"
 *   "2026.05.02 16:20" → "20260502-pm"
 *   파싱 실패 시 null (저장된 게 없거나 포맷이 맞지 않음)
 */
function getStoredCycleId(bulletinPublishTime) {
    if (!bulletinPublishTime) return null;
    const m = String(bulletinPublishTime).match(/^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})$/);
    if (!m) return null;
    const hh = parseInt(m[4], 10);
    // 시(hour)가 10 미만이면 AM, 10 이상이면 PM (KMA 발표시각 04:30 vs 16:20-30 분리에 충분)
    const half = hh < 10 ? 'am' : 'pm';
    return `${m[1]}${m[2]}${m[3]}-${half}`;
}

/**
 * 현재 시각이 어느 발표 사이클에 속하는지 ID 로 반환.
 * 서버 TZ(UTC/KST 무관)에 상관없이 KST 기준으로 일관 동작.
 */
function getCurrentExpectedCycleId(now) {
    // [TZ 버그 수정] getTime() 은 서버 TZ 와 무관하게 항상 UTC epoch ms 이므로,
    //   여기에 +9h 만 더한 뒤 getUTC* 로 읽으면 어떤 서버 TZ 에서도 KST 가 된다.
    //   (이전: + now.getTimezoneOffset()*60000 항을 더했는데, 운영 서버가 KST
    //    [Dockerfile ENV TZ=Asia/Seoul]이면 offset(-540분)이 +9h 를 상쇄해
    //    getUTCHours() 가 UTC(=KST-9h)를 돌려줬다. 그 결과 실제 KST 오후(16:20~)에
    //    사이클을 'am' 으로 오판 → 저장된 오전 통보문과 일치 → 오후 PM 통보문이 매일
    //    cycle-skip 되어 fetch/AI 도 못 하고 영구 미수집되던 버그.
    //    scheduler.js 의 kstDate 는 getHours()[로컬TZ]로 읽어 KST 서버에서도 맞았지만,
    //    본 함수만 getUTCHours()를 써서 두 계산이 어긋나 있었다.)
    const kstMs = now.getTime() + (9 * 3600000);
    const kst = new Date(kstMs);
    const minOfDay = kst.getUTCHours() * 60 + kst.getUTCMinutes();

    const AM_BOUNDARY = 4 * 60 + 30;   // 04:30
    const PM_BOUNDARY = 16 * 60 + 20;  // 16:20 (PM 발표 중 가장 이른 시각)

    // 사이클이 가리키는 "날짜" — 자정~04:29 사이엔 어제 날짜로 떨어진다
    let date = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
    let half;
    if (minOfDay < AM_BOUNDARY) {
        date = new Date(date.getTime() - 24 * 3600000);
        half = 'pm';
    } else if (minOfDay < PM_BOUNDARY) {
        half = 'am';
    } else {
        half = 'pm';
    }
    const y = date.getUTCFullYear();
    const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}${mo}${d}-${half}`;
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
 *   { reportId, title, publishTime, rawText, summary, collectedAt, fromCache }
 *   또는 null (수집/분석 실패)
 */
async function processOneOffice(office) {
    try {
        const found = await findBulletinForOffice(office.code);
        if (!found) {
            console.log(`[RegionalBulletin] ${office.name}: 단기 전망 옵션 없음`);
            return null;
        }

        // [캐시 정책] AI 색칠까지 끝난(aiColored===true) 경우에만 "완료"로 보고 즉시 반환.
        //   색칠 못 한 폴백(aiColored===false, 원문만 표출 중)은 할당량 회복 후 재색칠하도록
        //   캐시에 남겨둔 rawText 를 재사용해 AI 만 다시 시도한다(기상청 재요청 회피).
        const cached = loadCache(office.code, found.reportId);
        if (cached && cached.aiColored === true && cached.summary !== undefined) {
            console.log(`[RegionalBulletin] ${office.name}: 캐시 hit (색칠 완료) (${found.title})`);
            return { ...cached, fromCache: true };
        }

        let rawText = (cached && cached.rawText) ? cached.rawText : null;
        if (!rawText) {
            console.log(`[RegionalBulletin] ${office.name}: 새 통보문 수집 (${found.title})`);
            rawText = await fetchBulletinBody(office.code, found.reportId);
        } else {
            console.log(`[RegionalBulletin] ${office.name}: 미색칠 통보문 재색칠 시도 (${found.title})`);
        }
        if (!rawText) {
            console.log(`[RegionalBulletin] ${office.name}: 본문 비어있음, 스킵`);
            return null;
        }

        // AI 색칠 시도. 실패해도 원문(rawText)을 summary 로 그대로 표출한다.
        //   - 프론트 renderMarineMarkup() 이 마크업 없는 텍스트도 escape + 자동 패턴 색칠로
        //     안전하게 그려주므로, 색칠 실패 시에도 사용자는 통보문 내용을 즉시 볼 수 있다.
        //   - aiColored=false 로 캐시/저장해 다음 사이클에 재색칠을 시도한다.
        const ai = await analyzeBulletinWithAI(rawText);
        let summary, aiColored, marineOutlooks;
        if (ai && ai.summary) {
            summary = ai.summary;
            aiColored = true;
            marineOutlooks = Array.isArray(ai.marineOutlooks) ? ai.marineOutlooks : [];
        } else if (cached && cached.summary && (cached.aiColored === true || /\{\{(loc|num|warn):/.test(cached.summary))) {
            // 재색칠 실패했지만 이미 색칠본을 보유 → 원문으로 후퇴하지 않고 기존 색칠본 유지.
            summary = cached.summary;
            aiColored = true;
            marineOutlooks = Array.isArray(cached.marineOutlooks) ? cached.marineOutlooks : [];
            console.log(`[RegionalBulletin] ${office.name}: AI 재색칠 실패 → 기존 색칠본 유지`);
        } else {
            // 색칠본이 전혀 없으면 원문 텍스트로라도 표출 (다음 사이클 재색칠 시도).
            summary = rawText;
            aiColored = false;
            marineOutlooks = [];
        }

        const result = {
            reportId: found.reportId,
            title: found.title,
            publishTime: parsePublishTimeFromTitle(found.title),
            rawText,
            summary,
            aiColored,
            marineOutlooks,
            collectedAt: new Date().toISOString()
        };

        saveCache(office.code, found.reportId, result);
        if (!aiColored) {
            console.log(`[RegionalBulletin] ${office.name}: AI 색칠 실패 → 원문 텍스트로 표출(다음 사이클 재색칠 예정)`);
        }
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
 * summary / bulletin* 필드를 partial-merge 한다.
 *
 * PDF 출처 필드(publishTime, temperature, marineForecast, coastalForecast)는 보존한다.
 *
 * 호출 시점: scheduler.js 가 04:01~04:56, 16:01~16:56 KST 에 5분마다 호출.
 * 모든 지방청 캐시가 hit 이면 fetch/AI 호출이 0회로 끝나 부담 없음.
 */
async function collectAllRegionalBulletins() {
    console.log('[RegionalBulletin] 지방청 단기 전망 수집 시작');
    ensureCacheDir();

    // [사이클 사전 스킵 판단용] 기존 데이터를 읽는다 — 어디까지나 "이미 보유?" 최적화용이며,
    // 최종 저장에는 쓰지 않는다(아래 atomic 임계영역에서 파일을 다시 신선하게 읽음).
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
    let cycleSkips = 0;
    let failed = 0;
    let rawFallbacks = 0; // AI 색칠 실패로 원문만 표출한 건수

    // 이번 사이클에 수집한 "통보문이 책임지는 필드"만 모아둔다.
    // 느린 fetch/AI(await) 가 전부 끝난 뒤, 마지막에 파일을 다시 신선하게 읽어
    // 한 번에 동기 병합한다(race-free atomic write).
    const collected = {};

    // 현재 시각이 어느 발표 사이클인지 한 번만 계산 (이 사이클 안에선 모든 지방청 동일 기준)
    const expectedCycle = getCurrentExpectedCycleId(new Date());

    for (const office of BULLETIN_OFFICES) {
        // [사이클 사전 스킵] 이미 보유한 통보문이 현재 발표 사이클과 일치하면
        // list.do 호출조차 하지 않고 즉시 다음 지방청으로 넘어간다.
        // 부팅 직후나 윈도우 안 반복 호출에서 KMA 부담을 크게 절감.
        const storedEntry = store[office.code];
        const storedCycle = storedEntry ? getStoredCycleId(storedEntry.bulletinPublishTime) : null;
        // 색칠 완료 여부: 구(舊) 데이터(undefined)는 색칠된 것으로 간주(불필요한 재처리 방지).
        const storedColored = storedEntry ? storedEntry.bulletinColored !== false : false;
        // [사이클 사전 스킵] 사이클 일치 + 이미 색칠까지 완료된 경우에만 생략.
        //   색칠 안 된(원문만 표출 중) 상태면 같은 사이클이어도 재색칠을 위해 수집을 진행한다.
        if (storedCycle && storedCycle === expectedCycle && storedColored) {
            console.log(`[RegionalBulletin] ${office.name}: 발표 사이클 일치 + 색칠 완료(${expectedCycle}), 수집 생략`);
            cycleSkips++;
            continue;
        }

        const result = await processOneOffice(office);
        if (!result) { failed++; continue; }

        if (result.fromCache) cacheHits++; else updated++;

        // 이 모듈이 책임지는 필드만 누적 (PDF 출처 필드는 절대 건드리지 않음)
        //   bulletinColored: AI 색칠 완료 여부. false 면 원문만 표출 중 → 다음 사이클 재색칠 대상.
        collected[office.code] = {
            officeCode: office.code,
            officeName: office.name,
            bulletinReportId: result.reportId,
            bulletinPublishTime: result.publishTime,
            summary: result.summary,
            marineOutlooks: Array.isArray(result.marineOutlooks) ? result.marineOutlooks : [],
            bulletinColored: result.aiColored !== false,
            collectedAt: result.collectedAt,
        };
        if (result.aiColored === false) rawFallbacks++;

        // KMA 부하 보호용 짧은 딜레이
        await new Promise(r => setTimeout(r, 300));
    }

    // 변경분이 없으면(전부 사이클스킵/실패) 파일을 건드리지 않는다 — 불필요한 write/경합 회피.
    if (Object.keys(collected).length === 0) {
        console.log(`[RegionalBulletin] 완료: 신규 ${updated}건 / 캐시 ${cacheHits}건 / 사이클스킵 ${cycleSkips}건 / 실패 ${failed}건 (변경 없음, 저장 생략)`);
        return store;
    }

    // ── 동기 임계영역(atomic) ──────────────────────────────────────────────
    // 위 루프의 await 동안 PDF 수집기(본수집 05/11/17시·재시도)가 같은 파일을 갱신했을 수
    // 있으므로, 여기서 파일을 다시 신선하게 읽어 "통보문 필드"만 덮어쓴다.
    // read→merge→write 사이에 await 가 없어 단일 스레드 Node 에서 다른 콜백이 끼어들 수
    // 없다 → PDF 필드(publishTime/temperature/marineForecast/coastalForecast)는 보존된다.
    try {
        const dir = path.dirname(DATA_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        let fresh = {};
        try {
            if (fs.existsSync(DATA_FILE)) fresh = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        } catch (_) { fresh = {}; }

        for (const [code, fields] of Object.entries(collected)) {
            fresh[code] = { ...(fresh[code] || {}), ...fields };
        }
        fresh._lastUpdated = new Date().toISOString();

        fs.writeFileSync(DATA_FILE, JSON.stringify(fresh, null, 2), 'utf8');
        store = fresh; // 반환값 일관성
    } catch (e) {
        console.error(`[RegionalBulletin] 저장 오류: ${e.message}`);
    }
    // ──────────────────────────────────────────────────────────────────────

    console.log(`[RegionalBulletin] 완료: 신규 ${updated}건 / 캐시 ${cacheHits}건 / 사이클스킵 ${cycleSkips}건 / 실패 ${failed}건 / 원문폴백 ${rawFallbacks}건`);
    return store;
}

module.exports = {
    collectAllRegionalBulletins,
    processOneOffice,
    findBulletinForOffice,
    fetchBulletinBody,
    analyzeBulletinWithAI,
    BULLETIN_OFFICES,
    REGIONAL_BULLETIN_AI_PROMPT,
};
