/**
 * index2_patch.js
 * index2.html 전용 패치 스크립트
 *
 * [역할]
 * 1. 종합기상 탭을 정상적인 메인 탭으로 등록 (ocean-map-section을 직접 전환)
 * 2. enterOceanMapSection 을 오버라이드하여 헤더를 숨기지 않도록 처리
 * 3. 조석정보 10회 클릭 히든 메커니즘 비활성화 (이미 index2에 진입한 상태)
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
})();
