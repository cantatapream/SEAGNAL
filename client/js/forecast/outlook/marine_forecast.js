/**
 * ============================================================================
 * 파일명: js/marine_forecast.js
 * 역할: 기상청 해상 기상 전망 데이터 로드 및 렌더링
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : shared/utils/utils.js(trackUsage) · settings/settings.js(UserSettings.hasInterestZones — 관심해역 골랐나) ·
 *                   core/config.js(getTopOffice) · core/backbutton.js(PopupStack — 설정 팝업 뒤로가기)
 *  - 서버 API      : GET /api/marine-forecast · /api/regional-forecast
 *  - 마크업        : #marine-forecast-accordion-header/body · #regional-office-settings-btn(머리 오른쪽 ⚙) ·
 *                   #ultra-short-forecast-body · #short-term-forecast-body · #regional-forecast-title/body ·
 *                   #office-settings-panel(관심 기상청 설정 팝업 — 이 파일이 만든다)
 *  - 저장          : localStorage 'officeManualSettings' {지방청코드: true|false} — 관심 기상청 한 곳(2026-10-17부터 하나만 true) ·
 *                   localStorage 'officeLegacyZoneFallback' '1'|'0' — 이 판 전부터 관심해역을 쓰던 기기인가(처음 한 번만 정함)
 *  - 나를 쓰는 곳  : forecast/alerts/data.js(fetchAllData → loadMarineForecast) ·
 *                   settings/settings.js·onboarding/zone_setup.js(관심해역 저장 뒤 loadRegionalForecast) ·
 *                   index2.html(아코디언 토글·⚙ onclick)
 * ============================================================================
 *
 * [설명]
 * - /api/marine-forecast에서 초단기/단기 전망 데이터를 가져와
 *   인덱스 페이지의 아코디언에 렌더링
 *
 * [로딩 순서] data.js 이후
 * ============================================================================
 */

// 카테고리별 이모지 매핑
const MARINE_FORECAST_EMOJI = {
    '강풍': '💨',
    '해상': '🌅',
    '너울': '🌊',
    '바다안개': '🌫️',
    '바다 안개': '🌫️'
};

// 카테고리 표시 순서
const MARINE_FORECAST_ORDER = ['강풍', '해상', '너울', '바다안개'];

/**
 * 바깥 아코디언 토글
 */
window.toggleMarineForecastAccordion = function () {
    const body = document.getElementById('marine-forecast-accordion-body');
    const header = document.getElementById('marine-forecast-accordion-header');
    // [사용량] 펼칠 때만 카운트(닫을 때 X). toggle 전 collapsed 면 → 펼치는 방향.
    const willOpen = body ? body.classList.contains('collapsed') : false;
    if (body) body.classList.toggle('collapsed');
    if (header) header.classList.toggle('collapsed-state');
    if (willOpen && window.trackUsage) window.trackUsage('main.kma_marine_outlook_open');
};

/**
 * 서브 아코디언 (초단기/단기) 토글
 */
window.toggleMarineForecastSub = function (bodyId) {
    const body = document.getElementById(bodyId);
    if (!body) return;
    const section = body.closest('.marine-forecast-sub-accordion');
    if (section) {
        section.classList.toggle('open');
    }
};

/**
 * 카테고리 텍스트를 HTML로 렌더링
 */
function renderCategoryHtml(categoryKey, text) {
    if (!text) return '';

    const emoji = MARINE_FORECAST_EMOJI[categoryKey] || '📋';
    const displayName = categoryKey === '바다 안개' ? '바다안개' : categoryKey;

    let mainText = '';
    let subItems = [];

    // AI 분석 결과는 {main, sub} 객체 형식
    if (typeof text === 'object' && text.main !== undefined) {
        mainText = text.main || '';
        subItems = text.sub || [];
    } else {
        // 기존 문자열 형식: 줄 분리 후 메인/서브 항목 구분
        const lines = String(text).split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const mainLines = [];

        for (const line of lines) {
            if (line.startsWith('-') || line.startsWith('–') || line.startsWith('—')) {
                subItems.push(line);
            } else {
                mainLines.push(line);
            }
        }
        mainText = mainLines.join(' ');
    }

    let html = `<div class="marine-forecast-category">`;
    html += `<div class="marine-forecast-category-header">`;
    html += `<span class="marine-forecast-emoji">${emoji}</span>`;
    html += `<span class="marine-forecast-category-text">`;
    // renderMarineMarkup: 마크업 태그 있으면 변환, 없으면 자동 패턴 감지 포맷 적용
    const renderText = renderMarineMarkup;

    html += `<span class="marine-forecast-category-name">${displayName}</span> : ${renderText(mainText)}`;
    html += `</span>`;
    html += `</div>`;

    for (const sub of subItems) {
        html += `<div class="marine-forecast-sub-item">${renderText(sub)}</div>`;
    }

    html += `</div>`;
    return html;
}

/**
 * HTML 이스케이프
 */
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * AI 마크업 변환: {{loc:...}}, {{num:...}}, {{warn:...}} → HTML span
 * 색상: 지역=파랑, 수치=빨강, 경고=주황
 */
window.renderMarineMarkup = function renderMarineMarkup(str) {
    if (!str) return '';

    // AI 마크업 태그가 있으면 기존 로직 사용
    const hasMarkupTags = /\{\{(loc|num|warn):/.test(str);
    if (hasMarkupTags) {
        const tokens = [];
        let safe = str.replace(/\{\{(loc|num|warn):([^}]*)\}\}/g, (_, type, text) => {
            const idx = tokens.length;
            tokens.push({ type, text });
            return `__MK${idx}__`;
        });
        safe = escapeHtml(safe);
        safe = safe.replace(/__MK(\d+)__/g, (_, idx) => {
            const t = tokens[parseInt(idx)];
            const escaped = escapeHtml(t.text);
            switch (t.type) {
                case 'loc':  return `<span style="color:#60a5fa;font-weight:700;">${escaped}</span>`;
                case 'num':  return `<span style="color:#f87171;font-weight:700;">${escaped}</span>`;
                case 'warn': return `<span style="color:#fb923c;font-weight:700;">${escaped}</span>`;
                default:     return escaped;
            }
        });
        return safe;
    }

    // 마크업 태그 없으면 자동 패턴 감지하여 포맷 적용
    let result = escapeHtml(str);

    // 수치 패턴 (빨강, 볼드): 풍속, 파고, 거리, 온도 등
    result = result.replace(/(순간풍속\s*\d+\.?\d*[~\-]?\d*\.?\d*\s*km\/h\s*\([^)]*\))/g, '<span style="color:#f87171;font-weight:700;">$1</span>');
    result = result.replace(/(최대풍속\s*\d+\.?\d*[~\-]?\d*\.?\d*\s*km\/h\s*\([^)]*\))/g, '<span style="color:#f87171;font-weight:700;">$1</span>');
    result = result.replace(/(파고\s*\d+\.?\d*[~\-]?\d*\.?\d*\s*m)/g, '<span style="color:#f87171;font-weight:700;">$1</span>');
    result = result.replace(/(가시거리\s*\d+\.?\d*[~\-]?\d*\.?\d*\s*m\s*미만)/g, '<span style="color:#f87171;font-weight:700;">$1</span>');
    result = result.replace(/(가시거리\s*\d+\.?\d*[~\-]?\d*\.?\d*\s*m)/g, '<span style="color:#f87171;font-weight:700;">$1</span>');
    result = result.replace(/(풍속\s*\d+\.?\d*[~\-]?\d*\.?\d*\s*m\/s)/g, '<span style="color:#f87171;font-weight:700;">$1</span>');
    // 풍속 수치: "30~60km/h(8~16m/s)" 형태 (순간풍속/최대풍속 접두사 없는 경우)
    result = result.replace(/(?<!font-weight:700;">)(\d+\.?\d*[~\-]\d+\.?\d*\s*km\/h\s*\([^)]*\))/g, '<span style="color:#f87171;font-weight:700;">$1</span>');
    // 파고/물결 수치: "1.5~3.5m", "1.0~2.5m" 형태 (소수점 포함)
    result = result.replace(/(?<!font-weight:700;">)(\d+\.?\d*[~\-]\d+\.?\d*\s*m)(?![\/a-zA-Z])/g, '<span style="color:#f87171;font-weight:700;">$1</span>');

    // 지역 패턴 (파랑, 볼드): 해역명, 지역명
    // 단일 정규식으로 통합 — 긴 구역명을 먼저 매칭하여 이중 래핑 방지
    result = result.replace(
        new RegExp('(' + [
            // 1. 앞바다/먼바다 복합 구역명 (가장 구체적 → 먼저 매칭)
            '[가-힣·]+(?:앞바다|먼바다)',
            // 2. 해안/해역/연안
            '[가-힣]+(?:해안|해역|연안)',
            // 3. X해상 (예: 동해해상, 남해동부해상, 제주해상)
            '(?:동해|서해|남해|제주도?)[가-힣]*해상',
            // 4. X상 (예: 서해상, 동해상, 남해상)
            '(?:동해|서해|남해)상',
            // 5. 대분류+방향+해상? (예: 동해남부, 서해중부해상, 제주도 남부해상)
            '동해[남중북]부(?:해상)?|서해[남중북]부(?:해상)?|남해[동서]부(?:해상)?|제주도\\s*[남북동서]부(?:해상)?',
            // 6. 대분류 해역명
            '동해|서해|남해|제주도?',
            // 7. 섬 이름
            '울릉도|독도|추자도|마라도|가파도|우도',
            // 8. 내륙/권역
            '(?:경기|충청|전라|경상|강원)내륙|수도권|충청권|전라권|경상권|강원권',
            // 9. 특정 해안 지역명
            '경기서해안|충남서해안|전북서해안|전남서해안|경남남해안|경북동해안|강원동해안',
            // 10. 단독 도시명
            '인천|부산|울산'
        ].join('|') + ')', 'g'),
        '<span style="color:#60a5fa;font-weight:700;">$1</span>'
    );

    // 경고 패턴 (주황, 볼드): 주어, 원인/위험 표현, 위험 기상 현상
    result = result.replace(new RegExp('(' + [
        // 주요 주어 키워드
        '바람이',
        '물결이',
        // 위험 강도 표현 (원인)
        '매우 강하게 불고',
        '매우 강하게 불[어겠]',
        '강하게 불고',
        '강하게 부는 곳',
        '매우 높게 일[면겠]',
        '높게 일[면겠]',
        '높게 일는 곳',
        // 특보/경보
        '풍랑특보[를을]?\\s*발표할\\s*가능성',
        '풍랑특보',
        '폭풍해일특보',
        '태풍특보',
        // 위험 기상 현상
        '돌풍과 함께 천둥[.]?번개',
        '돌풍',
        '천둥[.]?번개',
        '너울성 파도',
        '너울',
        // 해상 주요 키워드
        '바다\\s*안개',
        '바다안개',
        '짙은 안개가 끼는 곳',
        '안개가 끼는 곳'
    ].join('|') + ')', 'g'), '<span style="color:#fb923c;font-weight:700;">$1</span>');

    return result;
}

/**
 * 전망 섹션 렌더링
 */
function renderForecastSection(data, titleId, bodyId) {
    const titleEl = document.getElementById(titleId);
    const bodyEl = document.getElementById(bodyId);
    if (!titleEl || !bodyEl) return;

    if (!data) {
        titleEl.textContent = titleId.includes('ultra') ? '초단기 전망' : '단기 전망';
        bodyEl.innerHTML = '<p class="marine-forecast-empty">해상과 관련하여 발표된 전망이 없습니다.</p>';
        return;
    }

    // 제목에 발표 시간 추가
    const typeLabel = titleId.includes('ultra') ? '초단기 전망' : '단기 전망';
    titleEl.textContent = data.publishTime
        ? `${typeLabel} (${data.publishTime} 발표)`
        : typeLabel;

    // 콘텐츠가 없는 경우
    if (!data.hasContent || !data.categories) {
        bodyEl.innerHTML = '<p class="marine-forecast-empty">해상과 관련하여 발표된 전망이 없습니다.</p>';
        return;
    }

    let html = '';

    // 전망 기간 표시
    if (data.forecastPeriod) {
        html += `<div class="marine-forecast-period">${escapeHtml(data.forecastPeriod)}</div>`;
    }

    // 카테고리별 내용 표시 (순서대로)
    let hasAny = false;
    for (const key of MARINE_FORECAST_ORDER) {
        // "바다안개"와 "바다 안개" 모두 체크
        const text = data.categories[key] || data.categories[key.replace('안개', ' 안개')];
        // [가드 강화] 의미 없는 값 (null/undefined/빈문자/문자열 'null'/공백만) 은 라인 자체 hide.
        //   서버 응답에 KMA 미발표 항목이 문자열 'null' 로 들어와도 '강풍 : null' 같이
        //   어색한 표시가 안 되도록.
        if (_isMeaningfulText(text)) {
            html += renderCategoryHtml(key, text);
            hasAny = true;
        }
    }

    if (!hasAny) {
        html = '<p class="marine-forecast-empty">해상과 관련하여 발표된 전망이 없습니다.</p>';
    }

    bodyEl.innerHTML = html;
}

/**
 * 의미 있는 텍스트인지 판별 — 데이터가 실제로 있는 경우만 true.
 *
 * 무엇을 거름?
 *   - null / undefined: JS 의 falsy 값
 *   - "" (빈 문자열) 또는 공백만: trim 결과 길이 0
 *   - 문자열 "null" / "undefined" (대소문자 무관): 서버가 보낸 sentinel
 *   - 객체 {main, sub} 형태: main 과 sub 모두 의미 없으면 false
 *     (AI 결과는 객체 형식 — main 안에 'null' 문자열이 들어올 수 있어 재귀 검사)
 *
 * 왜 필요?
 *   KMA 응답이 미발표 카테고리에 대해 가끔 문자열 "null" 을 보내옴 →
 *   기존 if (text) 가드는 truthy 판정 → "강풍 : null" 같이 어색한 표시.
 *   AI 분석본은 {main: "null", sub: []} 객체 형식으로 옴 → 재귀로 main/sub 모두 검사.
 *
 * 호출자: renderForecastSection
 */
function _isMeaningfulText(t) {
    if (t == null) return false;
    // 객체 형태 ({main, sub}) — main 또는 sub 중 하나라도 의미 있어야 true
    if (typeof t === 'object') {
        var mainOk = _isMeaningfulText(t.main);
        var subOk = Array.isArray(t.sub) && t.sub.some(function (s) {
            return _isMeaningfulText(s);
        });
        return mainOk || subOk;
    }
    var s = String(t).trim();
    if (!s) return false;
    var low = s.toLowerCase();
    if (low === 'null' || low === 'undefined') return false;
    return true;
}

/**
 * 해상 기상 전망 데이터 로드 및 렌더링
 */
async function loadMarineForecast() {
    try {
        // [캐시] 서버 Cache-Control: max-age=180 — 3분 안의 재호출은 브라우저 캐시 사용
        //        이전엔 ?_t=Date.now() 로 캐시 우회했으나 max-age 짧아 신선도 충분.
        const response = await fetch('/api/marine-forecast');
        if (!response.ok) {
            renderForecastSection(null, 'ultra-short-forecast-title', 'ultra-short-forecast-body');
            renderForecastSection(null, 'short-term-forecast-title', 'short-term-forecast-body');
            return;
        }

        const data = await response.json();

        renderForecastSection(data.ultraShort, 'ultra-short-forecast-title', 'ultra-short-forecast-body');
        renderForecastSection(data.shortTerm, 'short-term-forecast-title', 'short-term-forecast-body');

        // [최초 1회] 초단기/단기 중 더 최근 발표분만 펼친 상태로 시작.
        applyMarineForecastDefaultExpansion(data);

    } catch (e) {
        console.error('[MarineForecast] 로드 오류:', e);
        renderForecastSection(null, 'ultra-short-forecast-title', 'ultra-short-forecast-body');
        renderForecastSection(null, 'short-term-forecast-title', 'short-term-forecast-body');
    }
}

/**
 * 초단기/단기 전망 아코디언의 시작 상태 결정.
 *
 * 둘 다 표시될 때 한꺼번에 펼쳐져 화면이 산만해지는 문제 해소 —
 * 가장 최근 발표분만 펼친 상태로 두고 나머지 하나는 닫는다.
 *
 * 적용 시점: 페이지 로드 후 1회 (이후 사용자 클릭 보존).
 *   세션당 한 번만 동작하도록 _marineForecastDefaultApplied 플래그로 가드.
 *   사용자가 양쪽 다 펼쳐 보다가 자동 새로고침이 돌아도 그 상태가 유지됨.
 *
 * 비교 기준: reportId 안의 12자리 발표 타임스탬프(YYYYMMDDHHMM) — 문자열 비교만으로 시간순 정렬 가능.
 */
let _marineForecastDefaultApplied = false;
function applyMarineForecastDefaultExpansion(data) {
    if (_marineForecastDefaultApplied) return;

    const ultraBody = document.getElementById('ultra-short-forecast-body');
    const shortBody = document.getElementById('short-term-forecast-body');
    if (!ultraBody || !shortBody) return;
    const ultraSection = ultraBody.closest('.marine-forecast-sub-accordion');
    const shortSection = shortBody.closest('.marine-forecast-sub-accordion');
    if (!ultraSection || !shortSection) return;

    // 데이터가 둘 다 비어 있으면 손대지 않음 (디폴트 HTML 의 .open 그대로)
    if (!data || (!data.ultraShort && !data.shortTerm)) return;

    function tsOf(forecast) {
        if (!forecast || !forecast.reportId) return '';
        return (forecast.reportId.split(':')[1] || '').substring(0, 12); // "202605021620"
    }
    const ultraTs = tsOf(data.ultraShort);
    const shortTs = tsOf(data.shortTerm);

    let openSection;
    if (!ultraTs && !shortTs) return;
    if (!ultraTs) openSection = shortSection;
    else if (!shortTs) openSection = ultraSection;
    else openSection = (ultraTs >= shortTs) ? ultraSection : shortSection;

    // 한쪽만 .open 으로 — toggle 대신 명시적으로 add/remove 해서 멱등 보장
    [ultraSection, shortSection].forEach(s => {
        if (s === openSection) s.classList.add('open');
        else s.classList.remove('open');
    });

    _marineForecastDefaultApplied = true;
}

// 지방청 목록 — 화면·설정 팝업에 나오는 차례(수도권→부산→광주→강원→대전→대구→제주).
//   여러 곳을 저장해 둔 옛 설정을 한 곳으로 줄일 때도 이 차례로 첫 곳을 고른다.
const OFFICE_LIST = [
    { code: '109', name: '수도권기상청' },
    { code: '159', name: '부산지방기상청' },
    { code: '156', name: '광주지방기상청' },
    { code: '105', name: '강원지방기상청' },
    { code: '133', name: '대전지방기상청' },
    { code: '143', name: '대구지방기상청' },
    { code: '184', name: '제주지방기상청' }
];

/**
 * 종합 예보에 보여 줄 지방청 코드를 정한다 — 늘 0개 또는 1개.
 *
 * 예: 관심 기상청을 제주로 골라 둠 → ['184'] · 아무것도 안 골랐고 관심해역도 없음 → []
 *
 * [우선순위]
 * 1. 사용자가 고른 관심 기상청 하나(localStorage 'officeManualSettings' — getChosenOfficeCode)
 * 2. 안 골랐으면, **이 판 전부터 관심해역을 쓰던 기기**(_officeLegacyZoneFallback)가 관심해역을 골라 둔
 *    경우에만 관심해역이 **가장 많은 지방청 하나**(config.js getTopOffice — 사용자 확정 2026-09-27).
 *    새로 설치한 기기는 관심해역을 골라도 여기로 오지 않는다(2026-10-17 사용자 확정 —
 *    「지금처럼 두자. 그렇지만 새롭게 설정하는 사람, 최초 설치한 사람 등에 대해서는 뜨도록 해야해.」).
 * 3. 그 밖에는 [] → 화면에 「관심 기상청이 설정되지 않았습니다」와 [설정하기]를 띄운다.
 *    (2026-10-17 사용자 확정 — 종전에는 이때 7개 지방청을 모두 보여 줬다.)
 *
 * @returns {string[]} 지방청 코드 배열(0~1개)
 * [연계] ← renderRegionalForecast()·loadRegionalForecast()(무엇을 그릴지) · openOfficeSettingsPanel()(팝업의 처음 선택)
 *        → settings/settings.js UserSettings.hasInterestZones() · core/config.js getTopOffice()
 */
function getRelevantOfficeCodes() {
    // 1순위: 사용자가 고른 관심 기상청
    var chosen = getChosenOfficeCode();
    if (chosen) return [chosen];

    // 2순위: 이 판 전부터 관심해역을 쓰던 기기가 관심해역을 골라 둔 경우만 — 관심해역이 가장 많은 지방청 하나
    //   관심해역을 안 고른 상태(전 해역)는 판단 근거가 없으므로 고르지 않는다.
    //   새로 설치한 기기는 관심해역이 있어도 관심 기상청을 고를 때까지 안내 칸을 본다.
    if (_officeLegacyZoneFallback
        && typeof UserSettings !== 'undefined' && typeof UserSettings.hasInterestZones === 'function'
        && UserSettings.hasInterestZones() && typeof getTopOffice === 'function') {
        return getTopOffice(UserSettings.settings);
    }
    return [];
}

/**
 * localStorage에서 수동 지방청 설정을 읽어오는 함수
 * 설정이 없거나 파싱 실패 시 null 반환
 *
 * @returns {Object|null} { "109": true, "159": false, ... } 형태 또는 null
 * [연계] ← getChosenOfficeCode()
 */
function getOfficeManualSettings() {
    try {
        var saved = localStorage.getItem('officeManualSettings');
        if (!saved) return null;
        return JSON.parse(saved);
    } catch (e) {
        return null;
    }
}

/**
 * 사용자가 고른 관심 기상청 한 곳의 코드를 돌려준다(없으면 null).
 *
 * 예: {"109":false,"184":true} → '184'
 *     {"109":true,"159":true,"184":true}(여러 곳을 켜 둔 옛 설정) → '109'
 *     {"109":false, …전부 false} 또는 저장 없음 → null(= 안 고름)
 *
 * [옛 설정 옮기기 — 2026-10-17] 예전에는 여러 지방청을 함께 켤 수 있었다. 이제는 한 곳만이므로
 *   켜 둔 곳 가운데 **설정 팝업 차례(OFFICE_LIST)에서 가장 앞선 곳 하나**만 쓴다.
 *   저장값은 읽을 때마다 같은 규칙으로 줄이므로 따로 고쳐 쓰지 않는다 — 사용자가 [완료]를
 *   누르면 그때 한 곳만 켠 꼴로 저장된다. 빈 화면이 되지 않게, 켜 둔 곳이 하나라도 있으면 그중 하나를 보여 준다.
 *
 * @returns {string|null} 지방청 코드
 * [연계] ← getRelevantOfficeCodes() / → getOfficeManualSettings()
 */
function getChosenOfficeCode() {
    var manual = getOfficeManualSettings();
    if (!manual || typeof manual !== 'object') return null;
    for (var i = 0; i < OFFICE_LIST.length; i++) {
        if (manual[OFFICE_LIST[i].code] === true) return OFFICE_LIST[i].code;
    }
    return null;
}

/**
 * 관심 기상청 한 곳을 localStorage에 저장한다 — 고른 곳만 true, 나머지는 false.
 *
 * 예: saveChosenOffice('184') → {"109":false,"159":false,…,"184":true}
 *     (종전과 같은 꼴·같은 키라 옛 판 앱이 읽어도 그 한 곳이 보인다)
 * @param {string} code - 지방청 코드
 * [연계] ← 설정 팝업 [완료](openOfficeSettingsPanel 안)
 */
function saveChosenOffice(code) {
    var settings = {};
    OFFICE_LIST.forEach(function (o) { settings[o.code] = (o.code === code); });
    localStorage.setItem('officeManualSettings', JSON.stringify(settings));
}

/** 옛 기기 표시를 담는 localStorage 키 — '1' 옛 기기(관심해역 기준 유지) · '0' 아님 · 없음 = 아직 안 정함 */
var OFFICE_LEGACY_KEY = 'officeLegacyZoneFallback';

/**
 * 이 기기가 「관심 기상청」 판(2026-10-17) 전부터 관심해역을 쓰던 기기인지 **처음 한 번만** 정하고 기억한다.
 *
 * 왜: 사용자 확정(2026-10-17) — 「지금처럼 두자. 그렇지만 새롭게 설정하는 사람, 최초 설치한 사람 등에
 *   대해서는 뜨도록 해야해.」 이미 관심해역을 쓰던 사람은 종합 예보가 갑자기 안내 칸으로 바뀌지 않게
 *   관심해역 기준(가장 많은 지방청)을 그대로 두고, 새로 설치·새로 설정하는 사람은 관심 기상청을 고를 때까지
 *   「관심 기상청이 설정되지 않았습니다」+[설정하기]를 보게 한다.
 *
 * 예: 새 판을 처음 연 순간 관심해역이 저장돼 있고 관심 기상청은 없음 → '1' 저장 · true
 *     처음 연 순간 관심해역이 없음(처음 설치·앱 데이터 지움·아직 안 고름) → '0' 저장 · false
 *     처음 연 순간 관심 기상청을 이미 골라 둠 → '0'(고른 곳이 늘 앞서므로 기댈 일이 없다)
 *     이미 '1'·'0' 이 있으면 그 값 그대로 — 그 뒤 관심해역을 새로 골라도 다시 정하지 않는다.
 *
 * [순서 — 2026-10-17 코드로 확인] 이 파일 맨 위(스크립트를 읽는 순간)에서 한 번 부른다.
 *   index2.html 에서 settings/settings.js(UserSettings.init() 이 그 자리에서 저장값을 읽음)가 이 파일보다 앞이고,
 *   관심해역을 저장하는 곳(onboarding/zone_setup.js _save · settings.js saveSettingsAndClose ·
 *   tutorial.js 숨은 진입로 → zone_setup)은 모두 이 파일 뒤에 실리거나 사용자가 눌러야 돈다.
 *   그래서 처음 설치한 기기에서 온보딩이 관심해역을 저장하기 전에 판정이 끝난다.
 *
 * 정한 뒤의 경우:
 *   - 옛 기기가 나중에 관심해역을 모두 지움 → 기댈 관심해역이 없으니 안내 칸. 다시 고르면 관심해역 기준이 돌아온다.
 *   - 옛 기기가 관심 기상청을 고름 → 고른 곳이 앞선다(1순위).
 *   - 앱 데이터를 지움 → 표시도 지워지므로 새로 설치한 것과 같다.
 *   - 저장소를 못 읽으면 처음 보는 기기로 보고 판정, 못 쓰면 이번 실행에만 그 판정을 쓴다.
 *
 * @returns {boolean} 옛 기기면 true(관심해역 기준 지방청을 보여 줌)
 * [연계] ← 이 파일 맨 위 _officeLegacyZoneFallback(한 번) / → getChosenOfficeCode() ·
 *          settings/settings.js UserSettings.hasInterestZones() · getRelevantOfficeCodes()(2순위 조건)
 */
function decideOfficeLegacyZoneFallback() {
    var saved = null;
    try { saved = localStorage.getItem(OFFICE_LEGACY_KEY); } catch (e) { /* 못 읽으면 처음 보는 기기로 판정한다 */ }
    if (saved === '1') return true;
    if (saved === '0') return false;
    var legacy = !getChosenOfficeCode()
        && typeof UserSettings !== 'undefined' && typeof UserSettings.hasInterestZones === 'function'
        && UserSettings.hasInterestZones();
    try { localStorage.setItem(OFFICE_LEGACY_KEY, legacy ? '1' : '0'); } catch (e) { /* 못 쓰면 이번 실행에만 이 판정을 쓴다 */ }
    return legacy;
}

// 스크립트를 읽는 순간 한 번 정한다 — 온보딩이 관심해역을 저장하기 전(위 [순서])
var _officeLegacyZoneFallback = decideOfficeLegacyZoneFallback();

/**
 * 「기상청 해상 기상 전망」 아코디언이 닫혀 있으면 연다(설정 팝업·안내가 보이게).
 * [연계] ← openOfficeSettingsPanel() / → toggleMarineForecastAccordion()(같은 파일 — 사용량 기록도 같이)
 */
function _expandMarineForecastAccordion() {
    var body = document.getElementById('marine-forecast-accordion-body');
    if (body && body.classList.contains('collapsed')) window.toggleMarineForecastAccordion();
}

/**
 * 관심 기상청 설정 팝업(「📋 지방청 표시 설정」)을 연다 — 한 곳만 고르는 라디오 목록 + [취소]·[완료].
 *
 * 예: 아코디언 머리 ⚙ 또는 안내 칸의 [설정하기]를 누름 → 아코디언이 펼쳐지고 맨 위에 팝업이 뜬다.
 *     한 곳을 누르면 다른 곳은 풀린다. [완료]는 한 곳을 골라야 눌린다.
 *     [완료] = 저장하고 닫은 뒤 종합 예보를 그 지방청으로 다시 그림 · [취소]·×·Esc·뒤로가기 = 저장 없이 닫음.
 *
 * [화면] 종전 팝업과 같은 모양(어두운 카드·📋 제목·안내 문구). 바뀐 것: 켬/끔 스위치 7개 → 라디오 7줄,
 *   [초기화] 없앰, [취소]·[완료] 추가(사용자 확정 2026-10-17).
 * [뒤로가기] core/backbutton.js 의 PopupStack 에 'office-settings-panel' 로 올려, 하드웨어 뒤로가기가 [취소]와 같게 닫는다.
 *
 * @returns {void}
 * [연계] ← index2.html #regional-office-settings-btn(⚙) · toggleOfficeSettingsPanel() · 안내 칸 [설정하기](renderRegionalForecast)
 *        → saveChosenOffice() · loadRegionalForecast() · window.PopupStack(core/backbutton.js)
 */
function openOfficeSettingsPanel() {
    if (document.getElementById('office-settings-panel')) return;
    var host = document.getElementById('marine-forecast-content');
    if (!host) return;
    _expandMarineForecastAccordion();

    var current = getRelevantOfficeCodes()[0] || null;   // 처음 선택 = 지금 화면에 보이는 곳
    var picked = current;
    var opener = document.activeElement;

    var panel = document.createElement('div');
    panel.id = 'office-settings-panel';
    panel.className = 'office-settings-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'office-settings-title');

    var head = document.createElement('div');
    head.className = 'office-settings-head';
    var title = document.createElement('span');
    title.id = 'office-settings-title';
    title.className = 'office-settings-title';
    title.textContent = '📋 지방청 표시 설정';
    var x = document.createElement('button');
    x.type = 'button';
    x.className = 'office-settings-x';
    x.setAttribute('aria-label', '닫기');
    x.textContent = '×';
    head.appendChild(title);
    head.appendChild(x);
    panel.appendChild(head);

    var note = document.createElement('p');
    note.className = 'office-settings-note';
    note.textContent = '※ 이 설정은 관심해역 설정보다 우선 적용됩니다.';
    panel.appendChild(note);
    var hint = document.createElement('p');
    hint.className = 'office-settings-note';
    hint.textContent = '관심 기상청을 한 곳 고르세요.';
    panel.appendChild(hint);

    var group = document.createElement('div');
    group.className = 'office-settings-list';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-labelledby', 'office-settings-title');
    OFFICE_LIST.forEach(function (o) {
        var row = document.createElement('label');
        row.className = 'office-settings-row';
        var name = document.createElement('span');
        name.textContent = o.name;
        var radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'office-settings-pick';
        radio.value = o.code;
        radio.setAttribute('data-office-code', o.code);
        radio.checked = (o.code === current);
        radio.addEventListener('change', function () {
            if (!radio.checked) return;
            picked = o.code;
            _paint();
        });
        row.appendChild(name);
        row.appendChild(radio);
        group.appendChild(row);
    });
    panel.appendChild(group);

    var actions = document.createElement('div');
    actions.className = 'office-settings-actions';
    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'office-settings-btn';
    cancel.setAttribute('data-office-action', 'cancel');
    cancel.textContent = '취소';
    var done = document.createElement('button');
    done.type = 'button';
    done.className = 'office-settings-btn primary';
    done.setAttribute('data-office-action', 'done');
    done.textContent = '완료';
    actions.appendChild(cancel);
    actions.appendChild(done);
    panel.appendChild(actions);

    /** 고른 줄 강조·[완료] 잠금을 지금 선택에 맞춘다. [연계] ← 라디오 change · 처음 열 때 */
    function _paint() {
        group.querySelectorAll('.office-settings-row').forEach(function (row) {
            row.classList.toggle('checked', row.querySelector('input').checked);
        });
        done.disabled = !picked;
    }
    /** 팝업을 닫는다(저장 여부는 부른 쪽이 정한다). [연계] ← [취소]·[완료]·×·Esc·PopupStack */
    function _close() {
        if (window.PopupStack) window.PopupStack.remove('office-settings-panel');
        panel.remove();
        if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
    }
    /** 저장 없이 닫는다. [연계] ← [취소]·×·Esc·하드웨어 뒤로가기 */
    function _cancel() { _close(); }

    x.addEventListener('click', _cancel);
    cancel.addEventListener('click', _cancel);
    done.addEventListener('click', function () {
        if (!picked) return;
        saveChosenOffice(picked);
        _close();
        if (typeof loadRegionalForecast === 'function') loadRegionalForecast();
    });
    panel.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') { ev.stopPropagation(); _cancel(); }
    });

    _paint();
    host.insertBefore(panel, host.firstChild);
    if (window.PopupStack) window.PopupStack.push('office-settings-panel', _cancel);
    var first = group.querySelector('input:checked') || group.querySelector('input');
    if (first) first.focus();
}

/**
 * 설정 팝업을 열고 닫는다(⚙ 버튼) — 열려 있으면 저장 없이 닫고, 없으면 연다.
 * 예: ⚙ 한 번 → 열림 · 한 번 더 → [취소]와 같이 닫힘
 * [연계] ← index2.html #regional-office-settings-btn onclick / → openOfficeSettingsPanel()
 */
function toggleOfficeSettingsPanel() {
    var existing = document.getElementById('office-settings-panel');
    if (existing) {
        var cancel = existing.querySelector('[data-office-action="cancel"]');
        if (cancel) cancel.click();
        return;
    }
    openOfficeSettingsPanel();
}

// 전역에서 접근 가능하도록 window에 등록
window.toggleOfficeSettingsPanel = toggleOfficeSettingsPanel;
window.openOfficeSettingsPanel = openOfficeSettingsPanel;

/**
 * PDF 발표시각의 날짜(MM.DD)가 KST 오늘과 같은지 판정.
 *
 * [왜 필요?]
 *   PDF 의 "오늘" 셀 값은 PDF 발행일 기준이라, 자정을 넘긴 직후엔 그 값이
 *   실제로는 "어제" 의 기온이 된다. 다음 PDF 사이클(KST 05:10) 에서 새 PDF 가
 *   수집되어야 비로소 진짜 "오늘" 기온이 들어옴.
 *   그 사이엔 기온 박스를 숨겨 사용자에게 옛 정보를 보이지 않도록 함.
 *
 * [형식] item.publishTime 은 PDF 의 "MM.DD. HH:MM" 또는 "YYYYMMDDHH00" 형식.
 *   둘 다 안전하게 파싱.
 *
 * @returns true = 오늘 데이터, false = 어제 이하 / 파싱 실패
 */
function isPdfTemperatureForToday(publishTime) {
    if (!publishTime) return false;

    let pdfMonth = null, pdfDay = null;

    // 패턴 A: "05.02. 17:00" (parsePublishTime 정상 결과)
    const formattedMatch = String(publishTime).match(/^(\d{1,2})\.(\d{1,2})\.\s*(\d{1,2}):(\d{1,2})/);
    if (formattedMatch) {
        pdfMonth = parseInt(formattedMatch[1], 10);
        pdfDay = parseInt(formattedMatch[2], 10);
    } else {
        // 패턴 B: "202605021700" 14자리 raw 타임스탬프 (parsePublishTime 실패 시 폴백 저장값)
        const tsMatch = String(publishTime).match(/^\d{4}(\d{2})(\d{2})\d{2}\d{2}/);
        if (tsMatch) {
            pdfMonth = parseInt(tsMatch[1], 10);
            pdfDay = parseInt(tsMatch[2], 10);
        }
    }
    if (pdfMonth === null) return false;

    // 현재 KST 날짜 — 서버 timezone 무관하게 동일 결과
    const now = new Date();
    const kstMs = now.getTime() + (now.getTimezoneOffset() * 60000) + (9 * 3600000);
    const kst = new Date(kstMs);
    const todayMonth = kst.getUTCMonth() + 1;
    const todayDay = kst.getUTCDate();

    return pdfMonth === todayMonth && pdfDay === todayDay;
}

/**
 * 관심 기상청이 없을 때의 안내 칸을 그린다 — 문구 두 줄 + [설정하기].
 *
 * 예: 앱을 처음 깔고 아코디언을 펼침 → 「관심 기상청이 설정되지 않았습니다.」
 *     「설정하면 그 지방기상청의 해상 단기 전망을 보여 드립니다.」 [설정하기]
 * @param {HTMLElement} bodyEl - #regional-forecast-body
 * [연계] ← renderRegionalForecast() / → openOfficeSettingsPanel()([설정하기]가 같은 설정 팝업을 연다)
 */
function renderOfficeUnsetNotice(bodyEl) {
    bodyEl.textContent = '';
    var box = document.createElement('div');
    box.className = 'regional-office-unset';
    var msg = document.createElement('p');
    msg.className = 'regional-office-unset-title';
    msg.textContent = '관심 기상청이 설정되지 않았습니다.';
    var sub = document.createElement('p');
    sub.className = 'regional-office-unset-sub';
    sub.textContent = '설정하면 그 지방기상청의 해상 단기 전망을 보여 드립니다.';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'regional-office-unset-btn';
    btn.textContent = '설정하기';
    btn.addEventListener('click', function (ev) { ev.stopPropagation(); openOfficeSettingsPanel(); });
    box.appendChild(msg);
    box.appendChild(sub);
    box.appendChild(btn);
    bodyEl.appendChild(box);
}

/**
 * 종합 예보 (지방기상청 단기예보) 렌더링
 */
function renderRegionalForecast(data) {
    const titleEl = document.getElementById('regional-forecast-title');
    const bodyEl = document.getElementById('regional-forecast-body');
    if (!titleEl || !bodyEl) return;

    const relevantCodes = getRelevantOfficeCodes();

    // 관심 기상청이 없으면 7곳을 다 보여 주지 않고 안내 + [설정하기](사용자 확정 2026-10-17)
    if (relevantCodes.length === 0) {
        titleEl.textContent = '종합 예보';
        renderOfficeUnsetNotice(bodyEl);
        return;
    }

    if (!data) {
        titleEl.textContent = '종합 예보';
        bodyEl.innerHTML = '<p class="marine-forecast-empty">종합 예보를 불러오지 못했습니다.</p>';
        return;
    }

    // 지방청 표출 순서: 수도권→부산→광주→강원→대전→대구→제주
    const OFFICE_DISPLAY_ORDER = ['109', '159', '156', '105', '133', '143', '184'];

    // 관심해역에 해당하는 지방청 데이터를 정해진 순서대로 필터링
    const relevantSet = new Set(relevantCodes);
    const relevantData = [];
    for (const code of OFFICE_DISPLAY_ORDER) {
        if (relevantSet.has(code) && data[code] && data[code].summary) {
            relevantData.push(data[code]);
        }
    }

    if (relevantData.length === 0) {
        titleEl.textContent = '종합 예보';
        bodyEl.innerHTML = '<p class="marine-forecast-empty">종합 예보 데이터를 수집 중입니다.</p>';
        return;
    }

    titleEl.textContent = `종합 예보 (${relevantData.length}개 지방청)`;

    // [아코디언 시작 상태 결정]
    //   - 첫 렌더(이전에 카드가 0개)인 경우:
    //       지방청 1개 → 그 카드 자동 펼침 (어차피 하나뿐이라 두 번 누를 일 없도록)
    //       지방청 2개 이상 → 모두 닫음 (사용자가 필요한 것만 펼침)
    //   - 재렌더(자동 새로고침 등)인 경우:
    //       사용자가 직전에 펼쳐둔 지방청 코드 그대로 유지 (선택 보존)
    //   판정: 본문 div 안에 .regional-forecast-office 가 이미 있는가로 첫/재렌더 구분.
    const prevOfficeEls = bodyEl.querySelectorAll('.regional-forecast-office');
    const isFirstRender = prevOfficeEls.length === 0;
    const openCodes = new Set();
    if (isFirstRender) {
        if (relevantData.length === 1 && relevantData[0].officeCode) {
            openCodes.add(relevantData[0].officeCode);
        }
    } else {
        prevOfficeEls.forEach(el => {
            if (el.classList.contains('open')) {
                const code = el.getAttribute('data-office-code');
                if (code) openCodes.add(code);
            }
        });
    }

    let html = '';
    for (const item of relevantData) {
        // [발표 시각] 통보문(단기 전망) 발표시각만 표시.
        //   PDF 발표시각과 통보문 발표시각이 다를 수 있는데, 화면 본문이
        //   통보문 본문이므로 그것의 발표시각을 명시하는 게 사용자에게 일관됨.
        //   bulletinPublishTime 이 비어 있으면 발표시각 라벨 자체를 생략.
        const publishLabel = item.bulletinPublishTime || '';

        // [기온 정보 결정] PDF 파싱 출처 — 형식 { low: "X ~ Y", high: "X ~ Y" }
        //   라벨은 항상 "오늘 기온" 고정 (단기 전망 통보문은 본문만 책임,
        //   기온은 PDF 의 "오늘" 셀에서 추출).
        //
        // [신선도 체크] PDF 발표시각이 KST 오늘 날짜와 일치할 때만 표시.
        //   이유: PDF 의 "오늘" 셀은 PDF 발행일 기준이라, 자정을 넘기면 그 값이
        //   사실 "어제" 가 됨. 다음 PDF 사이클(05:10 +) 까지 옛 데이터가 노출되는
        //   걸 막기 위해 박스 자체를 숨긴다.
        const t = item.temperature;
        const lowText = (t && t.low) ? String(t.low) : '';
        const highText = (t && t.high) ? String(t.high) : '';
        const hasTempValue = !!(lowText || highText);
        const hasTemp = hasTempValue && isPdfTemperatureForToday(item.publishTime);

        // [지방청별 아코디언] 헤더 클릭 시 본문(기온+요약) 영역만 토글.
        //   여러 지방청이 동시에 표시될 때 모든 본문이 한꺼번에 펼쳐져 스크롤이
        //   너무 길어지는 문제 해소 — 사용자는 보고 싶은 지방청만 열어 본다.
        //   기본 상태: 닫힘. 데이터 속성 data-office-code 로 토글 대상 식별.
        const openClass = openCodes.has(item.officeCode) ? ' open' : '';
        html += `<div class="regional-forecast-office${openClass}" data-office-code="${escapeHtml(item.officeCode || '')}">`;
        html += `<div class="regional-forecast-office-header" onclick="toggleRegionalOffice('${escapeHtml(item.officeCode || '')}')">`;
        // [헤더 라벨] "단기예보" → "단기 전망" — list.do [해설] 통보문 본문 기반으로 변경되었음을 반영
        html += `<span class="regional-forecast-office-name">${escapeHtml(item.officeName)} 단기 전망</span>`;
        if (publishLabel) {
            html += `<span class="regional-forecast-publish-time">(${escapeHtml(publishLabel)} 발표)</span>`;
        }
        html += `<i class="fa-solid fa-chevron-down regional-forecast-office-icon"></i>`;
        html += `</div>`;

        // 아코디언 본문 — 헤더 아래의 모든 콘텐츠는 .open 일 때만 표시
        html += `<div class="regional-forecast-office-body">`;

        // [기온 박스] 헤더 바로 아래에 2단 그리드로 표시.
        //   레이아웃: 🌡️ 기온  | 최저          | 최고
        //                       | 7.2 ~ 13.7℃ | 19.1 ~ 23.9℃
        //   라벨(최저/최고)이 위, 값이 아래에 들어가는 컬럼 형식.
        //   둘 중 하나라도 값이 있어야 박스 자체를 그린다.
        //   둘 다 있을 때만 가운데 분리선(|) 출력.
        if (hasTemp) {
            html += `<div class="regional-forecast-temp">`;
            html += `<span class="regional-forecast-temp-icon">🌡️</span>`;
            html += `<span class="regional-forecast-temp-label">기온</span>`;
            html += `<div class="regional-forecast-temp-grid">`;
            if (lowText) {
                html += `<div class="regional-forecast-temp-cell temp-low">`;
                html += `<span class="regional-forecast-temp-cell-label">최저</span>`;
                html += `<span class="regional-forecast-temp-cell-value">${escapeHtml(lowText)}℃</span>`;
                html += `</div>`;
            }
            if (lowText && highText) {
                html += `<span class="regional-forecast-temp-divider">|</span>`;
            }
            if (highText) {
                html += `<div class="regional-forecast-temp-cell temp-high">`;
                html += `<span class="regional-forecast-temp-cell-label">최고</span>`;
                html += `<span class="regional-forecast-temp-cell-value">${escapeHtml(highText)}℃</span>`;
                html += `</div>`;
            }
            html += `</div>`;
            html += `</div>`;
        }

        // [종합 전망 본문]
        //   - AI 마크업 태그({{loc:}}/{{num:}}/{{warn:}})가 들어와 있으면
        //     renderMarineMarkup() 이 색상 span 으로 변환 (escape 도 내부 처리).
        //   - 마크업이 없는 라인(옛 PDF 출처 등)은 자동 패턴 감지로 동일 색상 적용.
        //   - 라인 prefix(□/○/-/*) 별 스타일 클래스는 그대로 유지.
        //   - 본문 영역은 CSS max-height + overflow-y 로 카드 안에서 스크롤된다.
        const lines = item.summary.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        html += `<div class="regional-forecast-summary">`;
        for (const line of lines) {
            const renderedLine = (typeof renderMarineMarkup === 'function')
                ? renderMarineMarkup(line)
                : escapeHtml(line);
            if (line.startsWith('□') || line.startsWith('*') || line.startsWith('※')) {
                // 종합 제목 또는 참고 사항
                html += `<div class="regional-forecast-line regional-forecast-main">${renderedLine}</div>`;
            } else if (line.startsWith('○')) {
                // 일별 전망 / 카테고리 (○ (강풍), ○ (해상) 등)
                html += `<div class="regional-forecast-line regional-forecast-day">${renderedLine}</div>`;
            } else if (line.startsWith('-')) {
                // 하위 항목
                html += `<div class="regional-forecast-line regional-forecast-sub">${renderedLine}</div>`;
            } else {
                // 그 외 (섹션 헤더 <중점 사항> 등 포함)
                html += `<div class="regional-forecast-line">${renderedLine}</div>`;
            }
        }
        html += `</div>`;

        html += `</div>`; // /regional-forecast-office-body
        html += `</div>`; // /regional-forecast-office
    }

    bodyEl.innerHTML = html;
}

/**
 * 지방청 단위 아코디언 토글.
 *   data-office-code 속성으로 해당 지방청 카드를 찾아 .open 클래스 토글.
 *   CSS 가 .open 일 때만 .regional-forecast-office-body 를 표시하도록 처리.
 *   여러 지방청 카드가 같은 코드로 중복될 일은 없지만 querySelectorAll 로 안전하게 처리.
 */
window.toggleRegionalOffice = function (code) {
    if (!code) return;
    const els = document.querySelectorAll('.regional-forecast-office[data-office-code="' + code + '"]');
    els.forEach(el => el.classList.toggle('open'));
};

/**
 * 종합 예보 데이터 로드
 */
async function loadRegionalForecast() {
    // 관심 기상청이 없으면 받을 것도 없다 — 안내 칸만 바로 그린다
    if (getRelevantOfficeCodes().length === 0) {
        renderRegionalForecast(null);
        return;
    }
    try {
        // [캐시] 서버 Cache-Control: max-age=600 (10분) — 하루 3회 수집 데이터라 10분 캐시 안전.
        const response = await fetch('/api/regional-forecast');
        if (!response.ok) {
            renderRegionalForecast(null);
            return;
        }
        const data = await response.json();
        renderRegionalForecast(data);
    } catch (e) {
        console.error('[RegionalForecast] 로드 오류:', e);
        renderRegionalForecast(null);
    }
}

// DOM 로드 후 데이터 불러오기
document.addEventListener('DOMContentLoaded', function () {
    setTimeout(loadMarineForecast, 1000);
    setTimeout(loadRegionalForecast, 1200);
});
