/**
 * ============================================================================
 * 파일명: js/marine_forecast.js
 * 역할: 기상청 해상 기상 전망 데이터 로드 및 렌더링
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

/**
 * 사용자 관심해역 기반으로 해당하는 지방청 코드 목록 반환
 *
 * [우선순위]
 * 1. 수동 지방청 설정 (localStorage의 'officeManualSettings')이 있으면 최우선 적용
 * 2. 수동 설정이 없으면 기존 관심해역 설정에 따라 자동 결정
 *
 * [연계] toggleOfficeSettingsPanel() → 수동 설정 UI
 * [연계] renderRegionalForecast() → 이 함수의 반환값으로 표시할 지방청 결정
 */
function getRelevantOfficeCodes() {
    // 1순위: 수동 지방청 설정 확인
    var manualSettings = getOfficeManualSettings();
    if (manualSettings) {
        // 수동 설정에서 ON인 지방청 코드만 반환
        var codes = [];
        Object.keys(manualSettings).forEach(function(code) {
            if (manualSettings[code]) codes.push(code);
        });
        return codes;
    }

    // 2순위: 기존 관심해역 기반 자동 결정
    if (typeof getRelevantOffices === 'function' && typeof UserSettings !== 'undefined') {
        return getRelevantOffices(UserSettings.settings);
    }
    // config.js 로드 전이면 모든 지방청 반환
    return Object.keys(REGIONAL_OFFICES || {});
}

/**
 * localStorage에서 수동 지방청 설정을 읽어오는 함수
 * 설정이 없거나 파싱 실패 시 null 반환 (= 관심해역 설정 사용)
 *
 * @returns {Object|null} { "109": true, "159": false, ... } 형태 또는 null
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
 * 수동 지방청 설정을 localStorage에 저장하는 함수
 *
 * @param {Object} settings - { "109": true, "159": false, ... }
 */
function saveOfficeManualSettings(settings) {
    localStorage.setItem('officeManualSettings', JSON.stringify(settings));
}

/**
 * 수동 지방청 설정을 초기화하는 함수 (관심해역 설정으로 되돌리기)
 * localStorage에서 삭제하고 UI 갱신
 */
function resetOfficeManualSettings() {
    localStorage.removeItem('officeManualSettings');
    // 설정 패널 닫기
    var panel = document.getElementById('office-settings-panel');
    if (panel) panel.remove();
    // 예보 다시 렌더링 (관심해역 기반으로 복원)
    if (typeof loadRegionalForecast === 'function') loadRegionalForecast();
}

/**
 * 지방청 설정 패널을 열고 닫는 토글 함수
 * 종합 예보 헤더의 ⚙ 버튼 클릭 시 호출
 *
 * [동작]
 * - 패널이 없으면 생성하여 표시
 * - 패널이 이미 있으면 제거 (토글)
 * - 7개 지방청 목록과 토글 스위치를 표시
 * - 수동 설정이 없는 경우 현재 관심해역 기반 상태를 기본값으로 표시
 *
 * [연계] index.html → ⚙ 버튼의 onclick에서 호출
 * [연계] saveOfficeManualSettings() → 토글 변경 시 저장
 * [연계] renderRegionalForecast() → 설정 변경 후 예보 다시 렌더링
 */
function toggleOfficeSettingsPanel() {
    var existing = document.getElementById('office-settings-panel');
    if (existing) { existing.remove(); return; }

    // 현재 상태: 수동 설정이 있으면 그 값, 없으면 관심해역 기반
    var manualSettings = getOfficeManualSettings();
    var currentCodes;
    if (manualSettings) {
        currentCodes = new Set(Object.keys(manualSettings).filter(function(k) { return manualSettings[k]; }));
    } else {
        if (typeof getRelevantOffices === 'function' && typeof UserSettings !== 'undefined') {
            currentCodes = new Set(getRelevantOffices(UserSettings.settings));
        } else {
            currentCodes = new Set(Object.keys(REGIONAL_OFFICES || {}));
        }
    }

    // 지방청 목록 (표출 순서)
    var offices = [
        { code: '109', name: '수도권기상청' },
        { code: '159', name: '부산지방기상청' },
        { code: '156', name: '광주지방기상청' },
        { code: '105', name: '강원지방기상청' },
        { code: '133', name: '대전지방기상청' },
        { code: '143', name: '대구지방기상청' },
        { code: '184', name: '제주지방기상청' }
    ];

    // 설정 패널 HTML 생성
    var listHtml = offices.map(function(o) {
        var isOn = currentCodes.has(o.code);
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);">'
            + '<span style="color:#e2e8f0;font-size:0.85rem;">' + o.name + '</span>'
            + '<label style="position:relative;display:inline-block;width:44px;height:24px;cursor:pointer;">'
            + '<input type="checkbox" data-office-code="' + o.code + '" ' + (isOn ? 'checked' : '')
            + ' onchange="onOfficeToggleChange()" style="opacity:0;width:0;height:0;">'
            + '<span style="position:absolute;inset:0;background:' + (isOn ? 'rgba(59,130,246,0.6)' : 'rgba(255,255,255,0.1)')
            + ';border-radius:12px;transition:background 0.3s;"></span>'
            + '<span style="position:absolute;top:2px;left:' + (isOn ? '22px' : '2px')
            + ';width:20px;height:20px;background:#fff;border-radius:50%;transition:left 0.3s;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></span>'
            + '</label></div>';
    }).join('');

    var panel = document.createElement('div');
    panel.id = 'office-settings-panel';
    panel.style.cssText = 'background:rgba(15,23,42,0.95);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:16px;margin:8px 0;';
    panel.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">'
        + '<span style="color:#fff;font-size:0.9rem;font-weight:600;">📋 지방청 표시 설정</span>'
        + '<button onclick="document.getElementById(\'office-settings-panel\').remove()" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:1.1rem;">&times;</button>'
        + '</div>'
        + '<p style="color:#94a3b8;font-size:0.75rem;margin:0 0 12px 0;">※ 이 설정은 관심해역 설정보다 우선 적용됩니다.</p>'
        + listHtml
        + '<div style="text-align:center;margin-top:12px;">'
        + '<button onclick="resetOfficeManualSettings()" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#94a3b8;padding:8px 20px;border-radius:8px;font-size:0.8rem;cursor:pointer;">초기화 (관심해역 기준으로 복원)</button>'
        + '</div>';

    // 종합 예보 헤더 바로 아래에 삽입
    var headerEl = document.querySelector('#regional-forecast-section .marine-forecast-sub-header');
    if (headerEl && headerEl.parentNode) {
        headerEl.parentNode.insertBefore(panel, headerEl.nextSibling);
    }
}

/**
 * 지방청 토글 스위치 변경 시 호출되는 함수
 * 모든 토글의 현재 상태를 수집하여 localStorage에 저장하고 예보를 다시 렌더링
 *
 * [동작]
 * 1. 설정 패널 내 모든 체크박스를 순회
 * 2. 각 지방청 코드별 ON/OFF 상태를 수집
 * 3. localStorage에 저장
 * 4. 토글 스위치 시각적 상태 갱신 (색상, 위치)
 * 5. 예보 다시 렌더링
 */
function onOfficeToggleChange() {
    var panel = document.getElementById('office-settings-panel');
    if (!panel) return;

    var checkboxes = panel.querySelectorAll('input[data-office-code]');
    var settings = {};
    checkboxes.forEach(function(cb) {
        settings[cb.getAttribute('data-office-code')] = cb.checked;
        // 토글 스위치 시각적 상태 갱신
        var track = cb.nextElementSibling;
        var thumb = track ? track.nextElementSibling : null;
        if (track) track.style.background = cb.checked ? 'rgba(59,130,246,0.6)' : 'rgba(255,255,255,0.1)';
        if (thumb) thumb.style.left = cb.checked ? '22px' : '2px';
    });

    saveOfficeManualSettings(settings);

    // 예보 다시 렌더링
    if (typeof loadRegionalForecast === 'function') loadRegionalForecast();
}

// 전역에서 접근 가능하도록 window에 등록
window.toggleOfficeSettingsPanel = toggleOfficeSettingsPanel;
window.onOfficeToggleChange = onOfficeToggleChange;
window.resetOfficeManualSettings = resetOfficeManualSettings;

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
 * 종합 예보 (지방기상청 단기예보) 렌더링
 */
function renderRegionalForecast(data) {
    const titleEl = document.getElementById('regional-forecast-title');
    const bodyEl = document.getElementById('regional-forecast-body');
    if (!titleEl || !bodyEl) return;

    const relevantCodes = getRelevantOfficeCodes();

    if (!data || relevantCodes.length === 0) {
        titleEl.textContent = '종합 예보';
        bodyEl.innerHTML = '<p class="marine-forecast-empty">관심해역을 설정하면 해당 지역의 종합 예보를 확인할 수 있습니다.</p>';
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
