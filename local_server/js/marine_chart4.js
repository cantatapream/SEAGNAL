/**
 * ============================================================================
 * 파일명: js/marine_chart4.js
 * 역할: 해상일기도 — 전체화면 컨트롤 자동 페이드 (동영상 플레이어 패턴)
 * ============================================================================
 *
 * [개요]
 *   풀스크린 진입 후 5초 동안 상단(시각/닫기) + 하단(재생 컨트롤) 표시 →
 *   타이머 만료 시 자동 숨김. 사용자가 화면을 탭하면:
 *     - 컨트롤 보이는 상태에서 탭: 즉시 숨김 (타이머 취소)
 *     - 컨트롤 숨겨진 상태에서 탭: 표시 + 5초 타이머 재시작
 *
 * [트리거 — 화면 탭 vs 핀치]
 *   사용자가 두 손가락 핀치줌을 시작했을 때는 탭으로 처리하면 안 됨.
 *   marine_chart5.js (제스처 모듈) 가 "이건 탭이다 / 핀치다" 를 판정해서
 *   탭일 때만 MC.toggleControls() 를 호출. 이 파일은 단순 토글만 제공.
 *
 * [전역 노출]
 *   showControls(), hideControls(), toggleControls(), cancelFadeTimer()
 *
 * [DOM 클래스]
 *   .mc-fullscreen.show-controls — CSS 가 상·하단 페이드 영역을 표출
 *
 * [초보자 안내]
 *   "페이드" 는 opacity 0 ↔ 1 전환. CSS transition 0.25s 가 부드러운 효과
 *   담당. JS 는 클래스 토글 + 5초 타이머만 관리.
 * ============================================================================
 */

(function () {
    'use strict';

    const MC = window.MarineChart;
    if (!MC) {
        console.error('[marine_chart4] marine_chart1.js 가 먼저 로드되어야 합니다.');
        return;
    }

    const HIDE_DELAY_MS = 5000;   // 5초 후 자동 숨김
    let fadeTimer = null;

    /**
     * 컨트롤 표시 + 5초 타이머 재시작.
     * - 풀스크린 오버레이가 열린 상태에서만 의미 있음
     */
    function showControls() {
        const { el } = MC;
        if (!el.fullscreen) return;
        el.fullscreen.classList.add('show-controls');
        cancelFadeTimer();
        fadeTimer = setTimeout(hideControls, HIDE_DELAY_MS);
    }

    /**
     * 컨트롤 즉시 숨김.
     */
    function hideControls() {
        const { el } = MC;
        if (!el.fullscreen) return;
        el.fullscreen.classList.remove('show-controls');
        cancelFadeTimer();
    }

    /**
     * 탭 토글 — 동영상 플레이어 패턴.
     * - 보이는 상태 → 즉시 숨김
     * - 숨겨진 상태 → 표시 + 5초 타이머 재시작
     */
    function toggleControls() {
        const { el } = MC;
        if (!el.fullscreen) return;
        if (el.fullscreen.classList.contains('show-controls')) {
            hideControls();
        } else {
            showControls();
        }
    }

    /**
     * 페이드 타이머 취소 (외부에서 강제 정리 시).
     */
    function cancelFadeTimer() {
        if (fadeTimer) {
            clearTimeout(fadeTimer);
            fadeTimer = null;
        }
    }

    /**
     * 컨트롤 영역(상단/하단/슬라이더) 의 사용자 인터랙션은 페이드를 연장.
     * - 슬라이더 드래그 중 컨트롤이 사라지면 곤란하므로
     */
    function bindActivityRefresh() {
        const { el } = MC;
        const refreshable = [
            el.fsTop, el.fsBottom, el.fsSlider, el.fsPrev, el.fsToggle, el.fsNext, el.fsClose,
        ].filter(Boolean);
        refreshable.forEach(node => {
            // 컨트롤 영역 내 클릭/입력이 발생하면 5초 타이머 리셋
            ['click', 'input', 'pointerdown'].forEach(evt => {
                node.addEventListener(evt, () => showControls());
            });
        });
    }

    /**
     * 슬라이더 드래그 중에는 페이드 잠금 (mousedown ~ mouseup 동안 타이머 정지).
     * - input 이벤트가 페이드를 계속 연장해도 OK 지만, 안전장치로 명시적 잠금.
     */
    function bindSliderHold() {
        const { el } = MC;
        if (!el.fsSlider) return;
        let holding = false;
        const onDown = () => { holding = true; cancelFadeTimer(); };
        const onUp   = () => { if (holding) { holding = false; showControls(); } };
        el.fsSlider.addEventListener('pointerdown', onDown);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
    }

    // ── 초기화 ──
    function setup() {
        bindActivityRefresh();
        bindSliderHold();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setup);
    } else {
        setup();
    }

    // ── 전역 노출 ──
    Object.assign(MC, {
        showControls,
        hideControls,
        toggleControls,
        cancelFadeTimer,
    });
})();
