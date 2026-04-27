/**
 * ============================================================================
 * 파일명: js/marine_chart3.js
 * 역할: 해상일기도 — 전체화면 진입/종료 + 안드로이드 백버튼 처리
 * ============================================================================
 *
 * [개요]
 *   인라인 영역의 GIF 를 클릭하면 #mc-fullscreen 오버레이가 풀스크린으로 표출.
 *   - 진입: 인라인 이미지 클릭 → enterFullscreen()
 *   - 종료: 우상단 ✕ 클릭, 또는 휴대폰 ← 백버튼
 *
 * [백버튼 처리 패턴]
 *   js/marine.js 의 enterOceanMapSection() 패턴을 그대로 차용.
 *   - 진입 시 history.pushState({ mcFullscreen: true }, '') 로 더미 1개 push
 *   - popstate 이벤트가 발생하면 (사용자가 ← 누름)
 *       오버레이가 열려 있는 경우 → exitFullscreen(true) 로 닫기 (history.back X)
 *
 * [상태 동기]
 *   재생 중이거나 슬라이더 위치가 어디든, 전체화면 진입 후에도 그대로 이어짐.
 *   (state.currentIndex / state.playing 가 단일 source of truth)
 *
 * [전역 노출] window.MarineChart 에 추가:
 *   enterFullscreen(), exitFullscreen(fromPopstate)
 *
 * [초보자 안내]
 *   "더미 1개 push" 는 "사용자가 백버튼을 눌렀을 때 앱 전체가 종료되지 않고
 *   '한 단계 뒤로'(전체화면만 닫기) 가도록" 하는 트릭이에요. 진입 직전에 가짜
 *   히스토리 항목을 1개 만들어두면, 백버튼 한 번은 우리가 가로챌 수 있습니다.
 * ============================================================================
 */

(function () {
    'use strict';

    const MC = window.MarineChart;
    if (!MC) {
        console.error('[marine_chart3] marine_chart1.js 가 먼저 로드되어야 합니다.');
        return;
    }

    // 더미 히스토리 push 한 적 있는지 추적 (중복 방지)
    let dummyPushed = false;
    // popstate 가 우리 의도로 발생했는지 표시 (다른 핸들러와 충돌 방지)
    let suppressPopstate = false;

    /**
     * 인라인 이미지 클릭 → 전체화면 진입.
     * - 오버레이 표시
     * - body 클래스 토글 (메인 헤더/탭바 숨김)
     * - 현재 프레임 정보를 풀스크린 라벨에 즉시 반영
     * - history 더미 push (백버튼 가로채기 준비)
     */
    function enterFullscreen() {
        const { el, state } = MC;
        if (!el.fullscreen) return;
        // 자료 없을 때는 진입 무시
        if (!state.list || state.list.length === 0) return;

        // 풀스크린 이미지에 현재 인덱스의 GIF 적용 (인라인과 동일한 url)
        const item = state.list[state.currentIndex];
        if (item && el.fsImage) {
            el.fsImage.src = item.url;
        }
        if (el.fsSlider) {
            el.fsSlider.max = Math.max(0, state.list.length - 1);
            el.fsSlider.value = state.currentIndex;
        }

        el.fullscreen.removeAttribute('hidden');
        el.fullscreen.setAttribute('aria-hidden', 'false');
        document.body.classList.add('mc-fullscreen-active');

        // 진입 시 컨트롤 한 번 표출 (5초 타이머는 marine_chart4.js 가 처리)
        if (MC.showControls) MC.showControls();

        // 핀치줌 변환 초기화 (마지막 transform 잔존 방지)
        if (MC.resetTransform) MC.resetTransform();

        // 백버튼 처리용 더미 히스토리 push
        if (!dummyPushed) {
            try {
                history.pushState({ mcFullscreen: true }, '');
                dummyPushed = true;
            } catch (e) {
                // 일부 환경에서 pushState 실패 시 백버튼 처리만 안 됨, 나머지 정상
                console.warn('[marine_chart] pushState 실패:', e);
            }
        }
    }

    /**
     * 전체화면 종료.
     * @param fromPopstate true 면 popstate 핸들러가 호출 (이미 history 가 pop 된 상태).
     *                     false (기본) 면 사용자가 ✕ 클릭 → 우리가 history.back() 해야 함.
     */
    function exitFullscreen(fromPopstate) {
        const { el } = MC;
        if (!el.fullscreen) return;
        if (el.fullscreen.hasAttribute('hidden')) return; // 이미 닫힘

        el.fullscreen.setAttribute('hidden', '');
        el.fullscreen.setAttribute('aria-hidden', 'true');
        el.fullscreen.classList.remove('show-controls');
        document.body.classList.remove('mc-fullscreen-active');

        // 페이드 타이머 정리
        if (MC.cancelFadeTimer) MC.cancelFadeTimer();

        // 더미 히스토리 정리
        if (dummyPushed) {
            if (fromPopstate) {
                // 백버튼으로 들어왔으므로 history 는 이미 pop 됨 → 추가 작업 X
                dummyPushed = false;
            } else {
                // ✕ 클릭 — 우리가 직접 호출. 가짜 더미 1개를 pop 해야 함.
                suppressPopstate = true;
                try {
                    history.back();
                } catch (e) {
                    console.warn('[marine_chart] history.back 실패:', e);
                }
                dummyPushed = false;
            }
        }
    }

    // ── 이벤트 바인딩 ──

    /**
     * 인라인 이미지 클릭 → 진입.
     * tabindex=0 이라 키보드(Enter/Space) 로도 진입 가능하도록 keydown 도 처리.
     */
    function bindEnterTrigger() {
        const { el } = MC;
        if (!el.image) return;
        el.image.addEventListener('click', enterFullscreen);
        el.image.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                enterFullscreen();
            }
        });
    }

    /**
     * 우상단 ✕ 버튼 클릭 → 종료.
     */
    function bindExitTrigger() {
        const { el } = MC;
        if (el.fsClose) {
            el.fsClose.addEventListener('click', () => exitFullscreen(false));
        }
    }

    /**
     * popstate 핸들러 — 휴대폰 ← 백버튼 또는 브라우저 뒤로가기 처리.
     * 풀스크린이 열려 있으면 가로채고, 아니면 다른 핸들러(예: marine.js)에 위임.
     */
    function bindPopstate() {
        window.addEventListener('popstate', (e) => {
            // 우리가 호출한 history.back() 으로 발생한 popstate 는 무시
            if (suppressPopstate) {
                suppressPopstate = false;
                return;
            }
            const { el } = MC;
            // 풀스크린 열려 있는 경우만 가로채기
            if (el.fullscreen && !el.fullscreen.hasAttribute('hidden')) {
                exitFullscreen(true);
            }
            // 그 외에는 marine.js 의 다른 popstate 핸들러가 자체 처리
        });
    }

    /**
     * 메인탭/서브탭 전환 시 풀스크린이 열려 있으면 자동 종료.
     * (사용자가 풀스크린 켜놓고 다른 탭 클릭하는 케이스)
     * marine.js 의 switchMainTab/switchSubTab 호출 직전에 가로챌 수는 없으므로,
     * 탭 버튼 클릭을 캡처 단계에서 감지.
     */
    function bindTabGuard() {
        document.addEventListener('click', (e) => {
            const tabBtn = e.target.closest('.tab-btn, .sub-tab-btn');
            if (!tabBtn) return;
            const { el } = MC;
            if (el.fullscreen && !el.fullscreen.hasAttribute('hidden')) {
                exitFullscreen(false);
            }
        }, true); // capture: tab handler 보다 먼저 실행되도록
    }

    // ── 초기화 — DOMContentLoaded 후 1회 ──
    function setup() {
        bindEnterTrigger();
        bindExitTrigger();
        bindPopstate();
        bindTabGuard();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setup);
    } else {
        setup();
    }

    // ── 전역 노출 ──
    Object.assign(MC, {
        enterFullscreen,
        exitFullscreen,
    });
})();
