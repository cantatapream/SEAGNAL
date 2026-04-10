/**
 * index2_patch.js
 * index2.html 전용 패치 스크립트
 *
 * [역할]
 * 1. 종합기상 탭을 정상적인 메인 탭으로 등록 (ocean-map-section을 직접 전환)
 * 2. enterOceanMapSection 을 오버라이드하여 헤더를 숨기지 않도록 처리
 * 3. 조석정보 10회 클릭 히든 메커니즘 비활성화 (이미 index2에 진입한 상태)
 * 4. 해역별 특보현황 데이터 수집/표시 완전 차단 (API 전환 준비)
 *
 * [중요] IIFE를 사용하지 않고 전역 스코프에서 직접 함수 선언을 재할당해야
 *        다른 파일에서 fetchAllData(), renderApp() 직접 호출 시에도 오버라이드가 적용됨.
 *
 * [로드 순서] settings.js, marine.js 이후에 로드되어야 함
 */

// ═══════════════════════════════════════════════════
// 페이지 구분: index2가 아니면 아래 코드 전체 스킵
// ═══════════════════════════════════════════════════
if (window.__SEAGNAL_PAGE === 'index2') {

// ──────────────────────────────────────────────
// 1. enterOceanMapSection 오버라이드
// ──────────────────────────────────────────────
window.enterOceanMapSection = function () {
    var section = document.getElementById('ocean-map-section');
    if (!section) return;
    window.switchMainTab('ocean-map-section');
};

// ──────────────────────────────────────────────
// 2. switchMainTab 래핑: ocean-map-section 전환 시
//    body.ocean-map-active + 헤더 유지 + 지도 크기 갱신
// ──────────────────────────────────────────────
var _origSwitchMainTab = window.switchMainTab;

window.switchMainTab = function (targetId) {
    if (targetId !== 'ocean-map-section') {
        document.body.classList.remove('ocean-map-active');
        document.documentElement.style.removeProperty('--ocean-top-offset');
    }

    _origSwitchMainTab.call(window, targetId);

    if (targetId === 'ocean-map-section') {
        document.body.classList.add('ocean-map-active');

        requestAnimationFrame(function () {
            var subVisible = document.querySelector('.sub-tabs.sub-tabs-visible');
            var refEl = subVisible || document.querySelector('.main-tabs');
            if (refEl) {
                var rect = refEl.getBoundingClientRect();
                document.documentElement.style.setProperty('--ocean-top-offset', rect.bottom + 'px');
            } else {
                document.documentElement.style.setProperty('--ocean-top-offset', '0px');
            }
            if (window.getOceanMap) {
                var m = window.getOceanMap();
                if (m && m.updateSize) m.updateSize();
            }
        });
    }
};

// ──────────────────────────────────────────────
// 3. exitOceanMapSection 오버라이드
// ──────────────────────────────────────────────
window.exitOceanMapSection = function () {
    var section = document.getElementById('ocean-map-section');
    if (!section) return;
    section.classList.remove('active');
    document.body.classList.remove('ocean-map-active');
    document.documentElement.style.removeProperty('--ocean-top-offset');

    var fallbackId = null;
    if (window._oceanPrevActiveSections && window._oceanPrevActiveSections.length) {
        for (var i = 0; i < window._oceanPrevActiveSections.length; i++) {
            var el = document.getElementById(window._oceanPrevActiveSections[i]);
            if (el) el.classList.add('active');
            if (!fallbackId) fallbackId = window._oceanPrevActiveSections[i];
        }
        window._oceanPrevActiveSections = [];
    }

    if (!fallbackId) fallbackId = 'weather-alert-section';
    window.switchMainTab(fallbackId);

    if (window.PopupStack) {
        window.PopupStack.remove('ocean-map-section');
    }
};

// ──────────────────────────────────────────────
// 4. 해역별 특보현황 데이터 수집/렌더링 완전 차단
//    전역 스코프에서 직접 함수 선언을 재할당하여
//    어디서 호출하든 (data.js, promo.js, auto_refresh.js, settings.js)
//    오버라이드된 버전이 실행되도록 보장
// ──────────────────────────────────────────────

// 4-1. renderApp 오버라이드
var _origRenderApp = renderApp;

renderApp = function () {
    // appState.alerts 를 비워서 기존 렌더링 로직이 0건으로 처리되도록 함
    if (typeof appState !== 'undefined') {
        appState.alerts = [];
        appState.coastalAlerts = {};
        appState.releasedCoastalZones = {};
    }

    // 원래 renderApp 호출 (0건 상태로 렌더링)
    _origRenderApp.call(window);

    // 특보현황 아코디언 헤더에 "데이터 준비 중" 표시
    var globalStatusContainer = document.querySelector('#main-accordion-header .header-status');
    var mainHeader = document.getElementById('main-accordion-header');
    var mainBody = document.getElementById('main-accordion-body');

    if (globalStatusContainer) {
        globalStatusContainer.innerHTML = '';
        var badge = document.createElement('span');
        badge.className = 'status-badge';
        badge.style.cssText = 'background:rgba(100,116,139,0.3);color:#94a3b8;border:1px solid rgba(148,163,184,0.3);padding:4px 12px;border-radius:12px;font-size:0.8rem;font-weight:600;';
        badge.textContent = '데이터 준비 중';
        globalStatusContainer.appendChild(badge);
    }

    if (mainBody && !mainBody.classList.contains('collapsed')) {
        mainBody.classList.add('collapsed');
    }
    if (mainHeader) {
        mainHeader.classList.remove('gradient-alert');
        mainHeader.classList.remove('gradient-safe');
        mainHeader.classList.add('gradient-safe');
    }
};
window.renderApp = renderApp;

// 4-2. fetchAllData 오버라이드
var _origFetchAllData = fetchAllData;

fetchAllData = async function () {
    if (typeof appState !== 'undefined') {
        if (appState.isLoading) return;
        appState.isLoading = true;
    }

    // 방문객 카운트, 수집 실패 확인 등은 유지
    if (typeof updateVisitorStats === 'function') updateVisitorStats();
    if (typeof checkCollectFailures === 'function') checkCollectFailures();

    if (typeof appState !== 'undefined') {
        appState.apiStatus = { hub: 'loading', buoy: 'loading', coastal: 'loading' };
        if (typeof updateApiStatusDisplay === 'function') updateApiStatusDisplay();

        // 특보 데이터 초기화 (fetch 하지 않음)
        appState.alerts = [];
        appState.coastalAlerts = {};
        appState.releasedCoastalZones = {};
        appState.apiStatus.hub = 'success';
        appState.lastUpdated = new Date();
    }

    try {
        // 해상 기상 전망은 유지
        if (typeof loadMarineForecast === 'function') {
            await loadMarineForecast();
        }

        if (typeof updateApiStatusDisplay === 'function') updateApiStatusDisplay();
        renderApp();
    } catch (error) {
        console.error('[index2] fetchAllData error:', error);
        if (typeof appState !== 'undefined') appState.hasApiError = true;
        if (typeof updateApiStatusDisplay === 'function') updateApiStatusDisplay();
        renderApp();
    } finally {
        if (typeof appState !== 'undefined') appState.isLoading = false;
        if (typeof updateLoading === 'function') updateLoading(false);
    }

    // 백그라운드 데이터 (부이 등)는 유지
    if (typeof loadBackgroundData === 'function') {
        loadBackgroundData();
    }
};
window.fetchAllData = fetchAllData;

// settings.js 에서 window.refreshData = fetchAllData 로 캐싱한 참조도 갱신
window.refreshData = fetchAllData;

} // end if (window.__SEAGNAL_PAGE === 'index2')
