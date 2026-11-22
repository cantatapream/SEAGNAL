/**
 * ============================================================================
 * 파일명: js/marine_forecast.js
 * 역할: 기상청 해상 기상 전망 데이터 로드 및 렌더링
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : shared/utils/utils.js(trackUsage) · settings/settings.js(UserSettings.hasInterestZones — 관심해역 골랐나) ·
 *                   core/config.js(getTopOffice) · core/backbutton.js(PopupStack — 설정 팝업 뒤로가기)
 *  - 서버 API      : GET /api/marine-forecast · /api/regional-forecast(지방청마다 summary · temperature · seaSummary{state:'ok'|'none'|'raw', zones, notes, lines} ·
 *                   doc{title, viewUrl, downloadUrl} — 원문을 받아 둔 관서만. 2026-11-19 「해상 기상 요약」 상자 · 머리줄 📋)
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
    // 앱을 켜고 처음 펼칠 때 안쪽 칸 기본값(지방청 → 없으면 최신 초단기/단기) — 그 뒤엔 사용자가 마지막에 펼쳐 둔 칸 그대로
    if (willOpen) applyMarineForecastDefaultExpansion();
    if (body) body.classList.toggle('collapsed');
    if (header) header.classList.toggle('collapsed-state');
    if (willOpen && window.trackUsage) window.trackUsage('main.kma_marine_outlook_open');
};

/**
 * 안쪽 칸(지방기상청 단기 전망 · 초단기 전망 · 단기 전망) 머리를 눌렀을 때 — 한 번에 하나만 펼친다.
 * 예: 초단기가 펼쳐진 채 「단기 전망」을 누름 → 단기만 펼침 · 펼쳐진 칸을 다시 누름 → 그 칸만 접힘(셋 다 접힌 상태도 된다)
 * [2026-11-19 사용자] 「기상청 해상기상전망 아코디언 안에서도 마찬가지로 아코디언이 한개 이상 켜지지 않도록」
 * @param {string} bodyId - 'regional-forecast-body' | 'ultra-short-forecast-body' | 'short-term-forecast-body'
 * [연계] ← index2.html 세 머리의 onclick / → openOnlyMarineForecastSub
 */
window.toggleMarineForecastSub = function (bodyId) {
    const body = document.getElementById(bodyId);
    if (!body) return;
    const section = body.closest('.marine-forecast-sub-accordion');
    if (!section) return;
    _marineForecastDefaultApplied = true;   // 사용자가 직접 고른 뒤에는 기본값이 덮어쓰지 않는다
    if (section.classList.contains('open')) section.classList.remove('open');
    else openOnlyMarineForecastSub(section);
};

/**
 * 해상 기상 전망 안쪽 세 칸 중 하나만 펼치고 나머지는 접는다.
 * @param {HTMLElement} section - 펼칠 .marine-forecast-sub-accordion(#regional-forecast-section 등)
 * [연계] ← toggleMarineForecastSub · applyMarineForecastDefaultExpansion · 관심 기상청 [완료](saveOfficeSettingsPanel)
 */
function openOnlyMarineForecastSub(section) {
    document.querySelectorAll('#marine-forecast-content > .marine-forecast-sub-accordion').forEach(s => {
        s.classList.toggle('open', s === section);
    });
}

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
        html += hangHtml(String(sub).trim(), 'marine-forecast-sub-item');   // 「o 간판…」「- 또한…」 — 둘째 줄을 글자 시작점에
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
 * 줄 앞 구분 기호(○ □ ※ * - o 등)를 글과 떼어 따로 둔다 — 두 줄이 되면 둘째 줄을 기호 밑이 아니라
 * 첫 줄 글자 시작점에 맞추기 위해(style.css .tf-hang). 기호는 원문 그대로 쓴다(사용자 2026-11-18 「거기에 정렬되어 있는 그 방식 그대로」).
 * 예: hangHtml('○ 강풍주의보: 제주도', 'regional-forecast-line regional-forecast-day')
 *     → '<div class="regional-forecast-line regional-forecast-day tf-hang"><span class="tf-mark">○</span><span class="tf-text">강풍주의보: …</span></div>'
 *     기호가 없으면 → '<div class="…">…</div>' (그대로)
 * @param {string} line - 한 줄(앞뒤 공백 제거된 것) @param {string} cls - 줄 div 의 클래스 @returns {string}
 * [연계] ← renderCategoryHtml(하위 항목) · renderRegionalForecast(지방청 단기 전망 줄) · 줄 맞춤 window.textFit(shared/ui/text_fit.js)
 */
function hangHtml(line, cls) {
    const m = /^([□○●◦※*\-–—]|o(?=\s))\s*/.exec(line);
    if (!m) return `<div class="${cls}">${renderMarineMarkup(line)}</div>`;
    return `<div class="${cls} tf-hang"><span class="tf-mark">${escapeHtml(m[1])}</span><span class="tf-text">${renderMarineMarkup(line.slice(m[0].length))}</span></div>`;
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
        // 닫는 괄호를 띄어 쓴 꼴(「{{warn:물결이} }」 — AI 가 가끔 만든다, 2026-11-18 운영에서 3곳)도 같은 표시로 읽는다
        let safe = str.replace(/\{\{(loc|num|warn):([^}]*)\}\s*\}/g, (_, type, text) => {
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
    // 줄 끝 2~3글자 넘침은 그 줄 글자 간격으로 맞춘다(접힌 아코디언이면 펼칠 때 맞춘다 — shared/ui/text_fit.js)
    if (window.textFit) window.textFit(bodyEl, '.marine-forecast-category-text, .tf-text, .marine-forecast-sub-item:not(.tf-hang)');
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
            _marineForecastLoaded = true;
            applyMarineForecastDefaultExpansion();
            return;
        }

        const data = await response.json();

        renderForecastSection(data.ultraShort, 'ultra-short-forecast-title', 'ultra-short-forecast-body');
        renderForecastSection(data.shortTerm, 'short-term-forecast-title', 'short-term-forecast-body');

        _marineForecastData = data;
        _marineForecastLoaded = true;
        // [앱을 켜고 처음 한 번] 안쪽 칸 기본값 — 관심 기상청이 없는 기기는 이 자료(발표 시각)가 와야 정할 수 있다
        applyMarineForecastDefaultExpansion();

    } catch (e) {
        console.error('[MarineForecast] 로드 오류:', e);
        renderForecastSection(null, 'ultra-short-forecast-title', 'ultra-short-forecast-body');
        renderForecastSection(null, 'short-term-forecast-title', 'short-term-forecast-body');
        _marineForecastLoaded = true;
        applyMarineForecastDefaultExpansion();
    }
}

/**
 * 해상 기상 전망 안쪽 세 칸의 시작 상태 — 하나만 펼친다(앱을 켜고 처음 한 번).
 *   관심 기상청이 있는 기기(직접 고름 · 옛 기기의 관심해역 자동 대응 포함 — getRelevantOfficeCodes) → 「지방기상청 단기 전망」
 *   없는 기기 → 초단기·단기 중 발표가 더 최근인 칸(발표 시각을 모르면 「지방기상청 단기 전망」 — 그 안에 [설정하기] 안내)
 *
 * [사용자 확정 2026-11-19] 「기본적으로 지방기상청 단기전망부터 켜지도록 하되, 지방기상청을 선택하지 않은 사람은 초단기전망과
 *   단기전망 중 발표가 최신인것을 먼저 켜지도록 해줘. 해상 기상 전망 아코디언을 켰을 때 말이야.」
 *   질문 「기본값을 언제?」에 「앱을 껏다켰을 때도 기본값부터. 단, 앱을 끄지 않았을 떄에는 마지막으로 펼쳐둔칸 기준」
 *   → 앱을 켤 때마다(이 값은 메모리에만 있다) 처음 한 번만 정하고, 그 뒤엔 사용자가 펼쳐 둔 칸을 건드리지 않는다.
 * 부르는 때: 바깥 아코디언을 펼칠 때 · 초단기/단기 자료가 왔을 때(관심 기상청이 없으면 발표 시각이 있어야 정할 수 있다).
 *   사용자가 안쪽 칸을 직접 누른 뒤에는(toggleMarineForecastSub) 다시 정하지 않는다.
 * 비교 기준: reportId 안의 12자리 발표 타임스탬프(YYYYMMDDHHMM) — 문자열 비교만으로 시간순 정렬 가능.
 * [연계] ← toggleMarineForecastAccordion · loadMarineForecast / → getRelevantOfficeCodes · openOnlyMarineForecastSub
 */
let _marineForecastDefaultApplied = false;
let _marineForecastData = null;      // 마지막으로 받은 초단기·단기 자료(발표 시각 비교용)
let _marineForecastLoaded = false;   // 초단기·단기 자료 받기를 한 번이라도 끝냈는가(실패 포함)
function applyMarineForecastDefaultExpansion() {
    if (_marineForecastDefaultApplied) return;
    const regional = document.getElementById('regional-forecast-section');
    const ultra = document.getElementById('ultra-short-forecast-section');
    const short = document.getElementById('short-term-forecast-section');
    if (!regional || !ultra || !short) return;

    let target = null;
    if (getRelevantOfficeCodes().length > 0) target = regional;
    else if (_marineForecastLoaded) {
        const tsOf = (f) => (f && f.reportId ? (String(f.reportId).split(':')[1] || '').substring(0, 12) : '');   // "202605021620"
        const d = _marineForecastData || {};
        const ultraTs = tsOf(d.ultraShort), shortTs = tsOf(d.shortTerm);
        if (!ultraTs && !shortTs) target = regional;   // 둘 다 모르면 지방청 칸(그 안에 [설정하기] 안내)
        else if (!shortTs) target = ultra;
        else if (!ultraTs) target = short;
        else target = (ultraTs >= shortTs) ? ultra : short;
    }
    if (!target) return;   // 아직 정할 수 없다(관심 기상청 없음 + 자료 오기 전) — 자료가 오면 다시 부른다
    openOnlyMarineForecastSub(target);
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
 *   관심해역을 저장하는 곳(onboarding/zone_setup.js _save · settings.js saveSettingsAndClose)은
 *   모두 이 파일 뒤에 실리거나 사용자가 눌러야 돈다.
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
        // 고른 지방청의 전망이 바로 보이게 그 칸만 펼친다(2026-11-19 — 안쪽 칸은 한 번에 하나만)
        var rs = document.getElementById('regional-forecast-section');
        if (rs) { openOnlyMarineForecastSub(rs); _marineForecastDefaultApplied = true; }
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

    // 현재 KST 날짜 — 기기 시간대와 무관하게 동일 결과.
    //   「지금 + 기기 시차 + 9시간」은 KST 벽시계를 **기기 시간대 값**으로 만든 것이라 getMonth/getDate(기기 시간대)로 읽어야 한다.
    //   getUTC* 로 읽으면 한국 시간 휴대폰에서 9시간이 빠져 00~09시(KST)에 어제 날짜가 된다(2026-11-23 시험이 잡음 — 그 시간엔 오늘 05시 판 기온이 숨고 어제 17시 판 기온이 보였다).
    const now = new Date();
    const kstMs = now.getTime() + (now.getTimezoneOffset() * 60000) + (9 * 3600000);
    const kst = new Date(kstMs);
    const todayMonth = kst.getMonth() + 1;
    const todayDay = kst.getDate();

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
 * 「지방기상청 단기 전망」 칸 머리를 채운다 — 이름 한 줄 + 그 아래 발표 정보, 오른쪽에 📋(원문을 받아 둔 관서만).
 * 예: setRegionalHeader({ officeName:'제주지방기상청', bulletinPublishTime:'2026.11.19 16:40', doc:{…} })
 *       → 「제주지방기상청 단기 전망」 / 「(2026.11.19 16:40 발표)」 · 📋
 *     setRegionalHeader(null) → 「지방기상청 단기 전망」(관심 기상청 없음·자료 없음)
 * [2026-11-19 사용자] 「종합예보 는 없애고 제주지방기상청 단기전망을 종합 예보 수준으로 올려야해」 — 종전 지방청 카드 머리줄(이름 한 줄 +
 *   발표 정보 줄 + 오른쪽 가운데 📋, 같은 날 사용자 확정)을 그대로 이 칸 머리로 올렸다.
 * @param {object|null} item 지방청 한 곳(GET /api/regional-forecast 의 값)
 * [연계] ← renderRegionalForecast / → regionalDocOf · shared/ui/ui_modal.js openKmaIframeModal(📋)
 */
function setRegionalHeader(item) {
    const titleEl = document.getElementById('regional-forecast-title');
    const header = titleEl && titleEl.closest('.marine-forecast-sub-header');
    if (!titleEl || !header) return;
    const oldDoc = header.querySelector('.regional-forecast-doc');
    if (oldDoc) oldDoc.remove();
    if (!item) { titleEl.textContent = REGIONAL_TITLE; return; }
    const publishLabel = item.bulletinPublishTime || '';   // 통보문(단기 전망) 발표시각 — 본문이 통보문이므로 그 시각을 적는다. 비면 줄을 뺀다
    titleEl.innerHTML = `<span class="regional-forecast-office-head"><span class="regional-forecast-office-name">${escapeHtml(item.officeName)} 단기 전망</span>`
        + (publishLabel ? `<span class="regional-forecast-publish-time">(${escapeHtml(publishLabel)} 발표)</span>` : '') + `</span>`;
    const doc = regionalDocOf(item);
    if (!doc) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'regional-forecast-doc';
    btn.title = '기상청 원문 보기(그림 포함)';
    btn.textContent = '📋';
    // 칸 접힘·펼침(머리 onclick)으로 번지지 않게 막는다
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof window.openKmaIframeModal === 'function') window.openKmaIframeModal(doc.url, doc.title, doc.download ? { download: doc.download } : undefined);
    });
    header.insertBefore(btn, header.querySelector('.marine-forecast-sub-icon'));
}

// 「지방기상청 단기 전망」 칸의 기본 제목(관심 기상청이 없거나 자료가 없을 때). [연계] ← setRegionalHeader
const REGIONAL_TITLE = '지방기상청 단기 전망';

/**
 * 「지방기상청 단기 전망」 칸 그리기 — 관심 기상청 한 곳의 단기 전망(기온 · AI 해상 기상 요약 · 전문).
 * [2026-11-19 사용자] 지방청은 한 곳만 고를 수 있으므로 종전 「종합 예보 (1개 지방청)」 칸 + 그 안의 지방청 카드 두 단계를
 *   한 단계로 합쳤다 — 칸 머리가 곧 「○○지방기상청 단기 전망」이다(setRegionalHeader).
 *   관심 기상청은 한 곳뿐이다(getRelevantOfficeCodes — 직접 고른 한 곳 또는 옛 기기의 관심해역 최다 한 곳). 혹시 여럿이 와도 첫 곳만 그린다.
 * [연계] ← loadRegionalForecast / → setRegionalHeader · seaSummaryHtml · renderOfficeUnsetNotice · bindRegionalFold · shared/ui/text_fit.js
 */
function renderRegionalForecast(data) {
    const bodyEl = document.getElementById('regional-forecast-body');
    if (!bodyEl) return;

    const relevantCodes = getRelevantOfficeCodes();

    // 관심 기상청이 없으면 7곳을 다 보여 주지 않고 안내 + [설정하기](사용자 확정 2026-10-17)
    if (relevantCodes.length === 0) {
        setRegionalHeader(null);
        renderOfficeUnsetNotice(bodyEl);
        return;
    }

    if (!data) {
        setRegionalHeader(null);
        bodyEl.innerHTML = '<p class="marine-forecast-empty">지방기상청 단기 전망을 불러오지 못했습니다.</p>';
        return;
    }

    const item = relevantCodes.map(code => data[code]).find(x => x && x.summary);
    if (!item) {
        setRegionalHeader(null);
        bodyEl.innerHTML = '<p class="marine-forecast-empty">지방기상청 단기 전망 데이터를 수집 중입니다.</p>';
        return;
    }
    setRegionalHeader(item);

    let html = '';
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

    // [해상 기상 요약] 기온 박스 아래 — 바다 얘기만(서버 services/regional_sea_summary 가 만들어 둔 것)
    //   상자를 그리다 실패해도(자료 꼴이 어긋남) 카드의 나머지는 그린다 — 없으면: 요약 자료 한 칸이 어긋났을 때 본문·기온·다른 지방청까지 전부 「불러오지 못했습니다」로 바뀐다(별도 에이전트 검토 2026-11-19)
    //   [요약 ↔ 전문 — 2026-11-19 사용자] 「전문 보기로 켰을 떄에는 AI 해상기상요약은 접히도록 … "AI 해상 기상 요약" 부분 헤더는 아코디언으로」
    //     질문 답 「서로 하나만」: 전문을 펴면 요약이 접히고, 요약을 다시 펴면 전문이 접힌다. 처음엔 요약만 펼침(regionalFold 기본 'sea').
    const foldState = regionalFold.get(String(item.officeCode)) || 'sea';
    let seaHtml = '';
    try { seaHtml = seaSummaryHtml(item.seaSummary, foldState === 'sea'); } catch (e) { console.warn('[해상 기상 요약] 상자를 그리지 못함:', e && e.message); }
    html += seaHtml;
    // [전문 접기] 요약이 있는 지방청은 전문(아래 본문)을 접어 두고 「○○지방기상청 단기 전망 전문 보기」 줄을 누르면 펼친다.
    //   사용자 2026-11-19 오후: 「요약 아래 전문이 나오는데 그 전문은 닫아놓은 상태로 … [00지방기상청 단기 전망 전문 보기] 누르면 아래로 펼쳐지면서 내용이 나왔으면 … 버튼은 아코디언 형식」
    //     「요약을 만들지 못했을때는 지금처럼 그냥 전문이 바로 표출되도록」 「1안이 좋겠어」(머리줄 같은 접는 줄).
    //   요약이 없는 때(못 만듦·아직 전·「바다 내용 없음」)는 버튼 없이 전문이 바로 보인다. 펼친 상태는 다시 그려도 그대로 둔다(regionalFold).
    const fold = !!seaHtml && !!item.seaSummary && item.seaSummary.state === 'ok';
    const fullOpen = fold && foldState === 'full';
    if (fold) {
        html += `<button type="button" class="regional-forecast-full-btn${fullOpen ? ' open' : ''}" data-full-office="${escapeHtml(item.officeCode || '')}" aria-expanded="${fullOpen ? 'true' : 'false'}">`;
        html += `<span>📄 ${escapeHtml(item.officeName || '')} 단기 전망 전문 <span class="rf-full-verb">${fullOpen ? '접기' : '보기'}</span></span><i class="fa-solid fa-chevron-down"></i></button>`;
    }

    // [종합 전망 본문]
    //   - AI 마크업 태그({{loc:}}/{{num:}}/{{warn:}})가 들어와 있으면
    //     renderMarineMarkup() 이 색상 span 으로 변환 (escape 도 내부 처리).
    //   - 마크업이 없는 라인(옛 PDF 출처 등)은 자동 패턴 감지로 동일 색상 적용.
    //   - 라인 prefix(□/○/-/*) 별 스타일 클래스는 그대로 유지.
    //   - 본문 영역은 CSS max-height + overflow-y 로 카드 안에서 스크롤된다.
    const lines = item.summary.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    html += `<div class="regional-forecast-summary${fold ? ' rf-full-fold' : ''}">`;
    //   - 줄 앞 기호는 hangHtml 이 떼어 둔다(두 줄이 되면 둘째 줄을 글자 시작점에 — 2026-11-18).
    for (const line of lines) {
        if (line.startsWith('□') || line.startsWith('*') || line.startsWith('※')) {
            // 종합 제목 또는 참고 사항
            html += hangHtml(line, 'regional-forecast-line regional-forecast-main');
        } else if (line.startsWith('○')) {
            // 일별 전망 / 카테고리 (○ (강풍), ○ (해상) 등)
            html += hangHtml(line, 'regional-forecast-line regional-forecast-day');
        } else if (line.startsWith('-')) {
            // 하위 항목
            html += hangHtml(line, 'regional-forecast-line regional-forecast-sub');
        } else {
            // 그 외 (섹션 헤더 <중점 사항> 등 포함) — 기호가 없으므로 hangHtml 이 그대로 둔다
            html += `<div class="regional-forecast-line">${renderMarineMarkup(line)}</div>`;
        }
    }
    html += `</div>`;


    bodyEl.innerHTML = html;
    // 줄 끝 2~3글자 넘침은 그 줄 글자 간격으로 맞춘다(접혀 있으면 펼칠 때 맞춘다, shared/ui/text_fit.js)
    if (window.textFit) bodyEl.querySelectorAll('.regional-forecast-summary').forEach(s => window.textFit(s, '.regional-forecast-line:not(.tf-hang), .tf-text'));
    //   「해상 기상 요약」 상자도 같은 규칙(어절 단위·자간 줄이기) — 해역 이름 줄·딱지 줄·원문 줄
    if (window.textFit) bodyEl.querySelectorAll('.regional-forecast-sea').forEach(s => window.textFit(s, '.rf-sea-zn, .rf-sea-ln, .regional-forecast-line:not(.tf-hang), .tf-text'));
    bindRegionalFold(bodyEl, String(item.officeCode));
}

/**
 * 그 지방청 카드의 📋 가 열 원문 — 서버가 PDF 를 받아 쪽 그림으로 바꿔 둔 관서에만 있다(GET /api/regional-forecast 의 doc).
 * 예: regionalDocOf({ doc:{ title:'제주지방기상청 날씨해설 제11-37호', viewUrl:'/api/bulletin-doc/fax_wcmt_202611190450_184_37/view', downloadUrl:'…/pdf' } })
 *     → { url:'/api/bulletin-doc/…/view', title:'제주지방기상청 날씨해설 제11-37호', download:{ url:'…/pdf', name:'제주지방기상청 날씨해설 제11-37호.pdf' } }
 *   팝업(openKmaIframeModal)은 제목·주소를 HTML 로 그대로 붙인다 — 우리 서버 원문 주소 꼴일 때만, 제목은 꺾쇠·따옴표를 뺀 글자만 넘긴다(alerts/escalation.js 와 같은 까닭).
 * @param {object} item 지방청 한 곳 @returns {{url:string, title:string, download?:{url:string, name:string}}|null}
 * [연계] ← renderRegionalForecast(📋 그리기·누르기) / → shared/ui/ui_modal.js openKmaIframeModal
 */
function regionalDocOf(item) {
    const d = item && item.doc;
    if (!d || !/^\/api\/bulletin-doc\/[A-Za-z0-9_]+\/view$/.test(d.viewUrl || '')) return null;
    const title = String(d.title || '날씨해설 원문').replace(/[<>&"'`]/g, '');
    const out = { url: d.viewUrl, title };
    if (/^\/api\/bulletin-doc\/[A-Za-z0-9_]+\/pdf$/.test(d.downloadUrl || '')) out.download = { url: d.downloadUrl, name: title.replace(/[\\/:*?|]/g, ' ') + '.pdf' };
    return out;
}

// 지방청(관서 번호)마다 「AI 해상 기상 요약」·「전문」 중 펼친 쪽 — 'sea'(요약, 기본) · 'full'(전문) · 'none'(둘 다 접음).
//   화면을 다시 그려도(주기 갱신) 그대로 두려고. 메모리에만 있으므로 앱을 다시 켜면 기본(요약 펼침)으로 돌아간다.
//   [연계] ← renderRegionalForecast · bindRegionalFold
const regionalFold = new Map();

/**
 * 「AI 해상 기상 요약」 머리와 「○○지방기상청 단기 전망 전문 보기」 줄을 누르면 — 둘 중 하나만 펼친다.
 * 예: 요약이 펼쳐진 채 「전문 보기」 → 전문 펼침 + 요약 접힘 / 요약 머리를 다시 누름 → 요약 펼침 + 전문 접힘 / 펼친 쪽을 누름 → 그쪽만 접힘
 * [2026-11-19 사용자] 「지방기상청 전망에서 전문 보기로 켰을 떄에는 AI 해상기상요약은 접히도록」 + 질문 답 「서로 하나만」.
 * @param {HTMLElement} bodyEl - #regional-forecast-body @param {string} code - 관서 번호
 * [연계] ← renderRegionalForecast / → regionalFold(펼친 쪽 기억)
 */
function bindRegionalFold(bodyEl, code) {
    const sea = bodyEl.querySelector('.regional-forecast-sea');
    const seaHead = sea && sea.querySelector('.rf-sea-ttl');
    const fullBtn = bodyEl.querySelector('.regional-forecast-full-btn');
    function paint(st) {
        regionalFold.set(code, st);
        if (sea) {
            sea.classList.toggle('rf-sea-closed', st !== 'sea');
            if (seaHead) seaHead.setAttribute('aria-expanded', st === 'sea' ? 'true' : 'false');
        }
        if (fullBtn) {
            fullBtn.classList.toggle('open', st === 'full');
            fullBtn.setAttribute('aria-expanded', st === 'full' ? 'true' : 'false');
            const verb = fullBtn.querySelector('.rf-full-verb'); if (verb) verb.textContent = st === 'full' ? '접기' : '보기';
        }
    }
    const cur = () => regionalFold.get(code) || 'sea';
    if (seaHead) {
        const flip = () => paint(cur() === 'sea' ? 'none' : 'sea');
        seaHead.addEventListener('click', flip);
        seaHead.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
    }
    if (fullBtn) fullBtn.addEventListener('click', () => paint(cur() === 'full' ? 'none' : 'full'));
}

// 「해상 기상 요약」 딱지 색 — 종류별(서버 regional_sea_summary.KINDS 의 종류). 모르는 종류는 회색.
const SEA_CHIP = { '특보 가능성': 'red', '해제 예고': 'green', '바람·물결': 'yellow', '이안류': 'red', '기상해일': 'red', '폭풍해일': 'red', '천둥·번개': 'yellow', '너울': 'purple', '조고': 'green', '바다 안개': 'grey' };

/**
 * 「해상 기상 요약」 상자의 HTML — 기온 박스 아래. 서버가 만든 seaSummary 의 상태대로 그린다.
 *   ok   : 해역별 줄(이름 / 기간 · 바람 · 물결) + 종류별 한 줄(딱지 뒤에 글이 이어지고, 둘째 줄은 들여쓰기 없이 왼쪽 끝부터)
 *   none : 「해상 기상 내용이 포함되어 있지 않습니다.」
 *   raw  : AI 가 요약하지 못한 것 — 뽑아 둔 원문 줄 그대로(「요약을 만들지 못해 원문 그대로」라고 적는다. 「없음」과 다르게 보여야 한다)
 *   없음(옛 자료·아직 만드는 중) : 상자를 그리지 않는다
 * 제목은 「AI 해상 기상 요약」(사용자 2026-11-19 오후: 「여기서 AI 해상 기상 요약 이라고 표현되었으면 좋겠어」) — 「없음」 상자도 같은 제목, 「원문 그대로」 상자는 AI 글이 아니라 종전 제목.
 * 사용자 2026-11-19: 「1.모양 - 2번안」 「3.해상 기상 내용이 포함되어있지 않습니다. 라는 식으로 상자 표출」
 *   「[특보가능성] ㅇㅇㅇ… 처럼 들여쓰기 없이 기록되도록. 단, 어절단위 및 자간 줄이기는 동일하게 적용」
 * 예: seaSummaryHtml({ state:'ok', zones:[{ zone:'동해중부먼바다', period:'~글피(22일) 오전', wind:'8~20', wave:'1.5~4.0' }], notes:[{ kind:'천둥·번개', text:'모레(21일)까지 {{loc:동해중부해상}}' }] })
 * @param {object|null} s @param {boolean} [open] - 요약을 펼친 채로 그리는가(기본 펼침 — 전문을 펼쳐 두었으면 false)
 * @returns {string}
 * [연계] ← renderRegionalForecast / 자료 = 서버 services/regional_sea_summary.js(GET /api/regional-forecast 의 seaSummary)
 */
function seaSummaryHtml(s, open) {
    if (!s || !s.state) return '';
    // 머리 = 아코디언(2026-11-19 사용자 「"AI 해상 기상 요약" 부분 헤더는 아코디언으로」) — 누르면 아래 .rf-sea-body 를 접고 편다(bindRegionalFold)
    const isOpen = open !== false;
    const head = (title, note) => `<div class="rf-sea-ttl" role="button" tabindex="0" aria-expanded="${isOpen ? 'true' : 'false'}"><span>🌊 ${title}</span>${note ? `<span class="rf-sea-by">${note}</span>` : ''}<i class="fa-solid fa-chevron-down rf-sea-icon" aria-hidden="true"></i></div>`;
    const box = (cls, inner) => `<div class="regional-forecast-sea${cls}${isOpen ? '' : ' rf-sea-closed'}">${head('AI 해상 기상 요약')}<div class="rf-sea-body">${inner}</div></div>`;
    if (s.state === 'none') return box(' off', '<div class="rf-sea-none">해상 기상 내용이 포함되어 있지 않습니다.</div>');
    // 요약을 만들지 못한 때(raw)는 상자를 그리지 않는다 — 사용자 2026-11-19 오후: 「요약을 만들지 못한 경우는 아예 상자를 표시하지 말자.」
    //   (종전: 「해상 기상 — 요약을 만들지 못해 원문 그대로」 + 뽑아 둔 원문 줄. 그 글은 아래 본문에 그대로 있다.)
    if (s.state !== 'ok') return '';
    //   꼴이 어긋난 줄(객체가 아님·이름이나 글이 빔)은 그리지 않는다
    const zones = (Array.isArray(s.zones) ? s.zones : []).filter(z => z && typeof z === 'object' && String(z.zone || '').trim() && (z.wind || z.wave));
    const notes = (Array.isArray(s.notes) ? s.notes : []).filter(n => n && typeof n === 'object' && String(n.kind || '').trim() && String(n.text || '').trim());
    let html = '';
    // 같은 해역이 이어지면 이름은 한 번만, 기간별 줄을 그 아래에
    for (let i = 0; i < zones.length; i++) {
        const z = zones[i], first = i === 0 || zones[i - 1].zone !== z.zone, last = i === zones.length - 1 || zones[i + 1].zone !== z.zone;
        if (first) html += `<div class="rf-sea-zone"><div class="rf-sea-zn">${escapeHtml(z.zone)}</div>`;
        html += `<div class="rf-sea-zv"><span class="per">${escapeHtml(z.period || '')}</span>`
            + (z.wind ? `<span>바람 <b>${escapeHtml(z.wind)}</b>m/s</span>` : '') + (z.wave ? `<span>물결 <b>${escapeHtml(z.wave)}</b>m</span>` : '') + `</div>`;
        if (last) html += `</div>`;
    }
    if (zones.length && notes.length) html += `<div class="rf-sea-sep"></div>`;
    for (const n of notes) html += `<div class="rf-sea-ln"><span class="rf-sea-chip ${Object.prototype.hasOwnProperty.call(SEA_CHIP, n.kind) ? SEA_CHIP[n.kind] : 'grey'}">${escapeHtml(n.kind)}</span>${renderMarineMarkup(n.text)}</div>`;
    return html ? box('', html) : '';
}

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
