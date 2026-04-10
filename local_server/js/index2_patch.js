/**
 * index2_patch.js
 * index2.html 전용 패치 스크립트
 *
 * [역할]
 * 1. 종합기상 탭을 정상적인 메인 탭으로 등록 (ocean-map-section을 직접 전환)
 * 2. enterOceanMapSection 을 오버라이드하여 헤더를 숨기지 않도록 처리
 * 3. exitOceanMapSection 오버라이드
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

} // end if (window.__SEAGNAL_PAGE === 'index2')
