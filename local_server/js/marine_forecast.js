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
    const icon = document.getElementById('marine-forecast-accordion-icon');

    if (body) body.classList.toggle('collapsed');
    if (header) header.classList.toggle('collapsed-state');
    if (icon) {
        if (header && header.classList.contains('collapsed-state')) {
            icon.style.transform = 'rotate(0deg)';
        } else {
            icon.style.transform = 'rotate(180deg)';
        }
    }
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

    // 줄 분리 후 메인/서브 항목 구분
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const mainLines = [];
    const subItems = [];

    for (const line of lines) {
        if (line.startsWith('-') || line.startsWith('–') || line.startsWith('—')) {
            subItems.push(line);
        } else {
            mainLines.push(line);
        }
    }

    const mainText = mainLines.join(' ');

    let html = `<div class="marine-forecast-category">`;
    html += `<div class="marine-forecast-category-header">`;
    html += `<span class="marine-forecast-emoji">${emoji}</span>`;
    html += `<span class="marine-forecast-category-text">`;
    html += `<span class="marine-forecast-category-name">${displayName}</span> : ${escapeHtml(mainText)}`;
    html += `</span>`;
    html += `</div>`;

    for (const sub of subItems) {
        html += `<div class="marine-forecast-sub-item">${escapeHtml(sub)}</div>`;
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
        if (text) {
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
 * 해상 기상 전망 데이터 로드 및 렌더링
 */
async function loadMarineForecast() {
    try {
        const response = await fetch('/api/marine-forecast?_t=' + Date.now());
        if (!response.ok) {
            renderForecastSection(null, 'ultra-short-forecast-title', 'ultra-short-forecast-body');
            renderForecastSection(null, 'short-term-forecast-title', 'short-term-forecast-body');
            return;
        }

        const data = await response.json();

        renderForecastSection(data.ultraShort, 'ultra-short-forecast-title', 'ultra-short-forecast-body');
        renderForecastSection(data.shortTerm, 'short-term-forecast-title', 'short-term-forecast-body');

    } catch (e) {
        console.error('[MarineForecast] 로드 오류:', e);
        renderForecastSection(null, 'ultra-short-forecast-title', 'ultra-short-forecast-body');
        renderForecastSection(null, 'short-term-forecast-title', 'short-term-forecast-body');
    }
}

// DOM 로드 후 데이터 불러오기
document.addEventListener('DOMContentLoaded', function () {
    setTimeout(loadMarineForecast, 1000);
});
