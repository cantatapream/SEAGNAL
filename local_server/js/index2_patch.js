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
 * [로드 순서] settings.js, marine.js 이후에 로드되어야 함
 */
(function () {
    if (window.__SEAGNAL_PAGE !== 'index2') return;

    // ──────────────────────────────────────────────
    // 1. enterOceanMapSection 오버라이드
    //    - body.ocean-map-active 클래스는 여전히 추가 (지도 레이아웃용)
    //    - 단, CSS 에서 헤더 숨김이 !important 로 취소되므로 헤더는 유지됨
    // ──────────────────────────────────────────────
    var _origEnterOceanMap = window.enterOceanMapSection;

    window.enterOceanMapSection = function () {
        var section = document.getElementById('ocean-map-section');
        if (!section) return;

        // 종합기상 탭을 통한 일반 탭 전환 방식으로 처리
        window.switchMainTab('ocean-map-section');
    };

    // ──────────────────────────────────────────────
    // 2. switchMainTab 에서 ocean-map-section 전환 시
    //    body.ocean-map-active 추가 + 헤더 유지 + 지도 크기 갱신
    // ──────────────────────────────────────────────
    var _origSwitchMainTab = window.switchMainTab;

    window.switchMainTab = function (targetId) {
        // 다른 탭으로 전환 시 ocean-map-active 제거
        if (targetId !== 'ocean-map-section') {
            document.body.classList.remove('ocean-map-active');
            document.documentElement.style.removeProperty('--ocean-top-offset');
        }

        // 원래 switchMainTab 호출
        _origSwitchMainTab.call(window, targetId);

        // ocean-map-section 전환 시 추가 처리
        if (targetId === 'ocean-map-section') {
            document.body.classList.add('ocean-map-active');

            // 탭바 아래쪽 offset 계산 (지도가 탭 아래에 표시되도록)
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
    // 3. 조석정보 10회 클릭 히든 메커니즘 비활성화
    //    settings.js initTabs()가 이미 바인딩한 이벤트를 덮어쓸 수 없으므로,
    //    enterOceanMapSection 을 위에서 이미 switchMainTab 호출로 대체했기 때문에
    //    10회 클릭해도 단순히 종합기상 탭으로 전환될 뿐임 (사실상 무해)
    // ──────────────────────────────────────────────

    // ──────────────────────────────────────────────
    // 4. exitOceanMapSection 오버라이드
    //    뒤로가기 등으로 호출될 때 헤더 상태를 올바르게 유지
    // ──────────────────────────────────────────────
    window.exitOceanMapSection = function () {
        var section = document.getElementById('ocean-map-section');
        if (!section) return;
        section.classList.remove('active');
        document.body.classList.remove('ocean-map-active');
        document.documentElement.style.removeProperty('--ocean-top-offset');

        // 직전 활성 섹션 복원
        var fallbackId = null;
        if (window._oceanPrevActiveSections && window._oceanPrevActiveSections.length) {
            for (var i = 0; i < window._oceanPrevActiveSections.length; i++) {
                var el = document.getElementById(window._oceanPrevActiveSections[i]);
                if (el) el.classList.add('active');
                if (!fallbackId) fallbackId = window._oceanPrevActiveSections[i];
            }
            window._oceanPrevActiveSections = [];
        }

        // 기본 탭으로 복귀
        if (!fallbackId) fallbackId = 'weather-alert-section';
        window.switchMainTab(fallbackId);

        if (window.PopupStack) {
            window.PopupStack.remove('ocean-map-section');
        }
    };

    // ──────────────────────────────────────────────
    // 5. 해역별 특보현황 데이터 수집/렌더링 완전 차단
    //    - renderApp()을 오버라이드: 특보 데이터를 렌더링하지 않음
    //    - fetchAllData()를 오버라이드: /api/weather-alerts 호출을 건너뜀
    //    → 추후 API 수집 방식으로 교체 예정
    // ──────────────────────────────────────────────

    // 5-1. renderApp 오버라이드: 특보 데이터 비우고 "준비 중" 상태 표시
    var _origRenderApp = window.renderApp || renderApp;
    window.renderApp = function () {
        // appState.alerts 를 비워서 기존 렌더링 로직이 0건으로 처리되도록 함
        if (typeof appState !== 'undefined') {
            appState.alerts = [];
            appState.coastalAlerts = {};
            appState.releasedCoastalZones = {};
        }

        // 원래 renderApp 호출 (0건 상태로 렌더링 → 모든 해역 숨김 처리됨)
        _origRenderApp.call(window);

        // 특보현황 아코디언 헤더에 "API 전환 준비 중" 표시
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

        // 아코디언 닫힘 상태 유지
        if (mainBody && !mainBody.classList.contains('collapsed')) {
            mainBody.classList.add('collapsed');
        }
        if (mainHeader) {
            mainHeader.classList.remove('gradient-alert');
            mainHeader.classList.remove('gradient-safe');
            mainHeader.classList.add('gradient-safe');
        }
    };
    // renderApp을 전역에 노출 (다른 코드에서 renderApp() 직접 호출하는 경우 대비)
    if (typeof renderApp !== 'undefined') {
        renderApp = window.renderApp;
    }

    // 5-2. fetchAllData 오버라이드: 특보 데이터 fetch 건너뜀
    var _origFetchAllData = window.fetchAllData || fetchAllData;
    window.fetchAllData = async function () {
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
            appState.apiStatus.hub = 'success'; // 에러 표시 방지
            appState.lastUpdated = new Date();
        }

        try {
            // 해상 기상 전망은 유지
            if (typeof loadMarineForecast === 'function') {
                await loadMarineForecast();
            }

            if (typeof updateApiStatusDisplay === 'function') updateApiStatusDisplay();
            // 오버라이드된 renderApp 호출 (특보 데이터 없이)
            if (typeof window.renderApp === 'function') window.renderApp();
        } catch (error) {
            console.error('[index2] fetchAllData error:', error);
            if (typeof appState !== 'undefined') appState.hasApiError = true;
            if (typeof updateApiStatusDisplay === 'function') updateApiStatusDisplay();
            if (typeof window.renderApp === 'function') window.renderApp();
        } finally {
            if (typeof appState !== 'undefined') appState.isLoading = false;
            if (typeof updateLoading === 'function') updateLoading(false);
        }

        // 백그라운드 데이터 (부이 등)는 유지
        if (typeof loadBackgroundData === 'function') {
            loadBackgroundData();
        }
    };
    // fetchAllData 전역 노출
    if (typeof fetchAllData !== 'undefined') {
        fetchAllData = window.fetchAllData;
    }
})();
