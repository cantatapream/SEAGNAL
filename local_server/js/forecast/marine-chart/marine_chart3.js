/**
 * ============================================================================
 * 파일명: js/marine_chart3.js
 * 역할: 해상일기도 — 전체화면 진입/종료 (SEAGNAL 통합 PopupStack 패턴)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : marine_chart1.js(window.MarineChart state·el) · core/backbutton.js(전역 PopupStack)
 *  - 서버 API      : 없음
 *  - 마크업        : #mc-fullscreen (풀스크린 오버레이) · 인라인 GIF <img>
 *  - 나를 쓰는 곳  : 인라인 이미지 클릭 → enterFullscreen() · PopupStack.popLast() → exitFullscreen()
 * ============================================================================
 *
 * [개요]
 *   인라인 영역의 GIF 를 클릭하면 #mc-fullscreen 오버레이가 풀스크린으로 표출.
 *   - 진입: 인라인 이미지 클릭 → enterFullscreen()
 *   - 종료: 우상단 ✕ 클릭, 또는 휴대폰 ← 백버튼, 또는 다른 탭 클릭
 *
 * [백버튼 처리 — SEAGNAL 통합 PopupStack 패턴 사용]
 *   본 모듈은 직접 history.pushState / popstate 를 다루지 않는다.
 *   대신 backbutton.js 가 운영하는 전역 PopupStack 에 등록:
 *
 *     enterFullscreen() → PopupStack.push('mc-fullscreen', exitFullscreen)
 *     exitFullscreen()  → PopupStack.remove('mc-fullscreen')
 *
 *   휴대폰 ← 또는 브라우저 뒤로가기 발생 시 backbutton.js 의 단일 popstate
 *   핸들러가 PopupStack.popLast() 를 호출 → 우리 exitFullscreen() 자동 실행.
 *   다른 modal/sheet 가 위에 떠 있으면 LIFO 순서대로 자연스럽게 닫힘.
 *
 *   이 패턴은 ocean_bottom_sheet1.js, fishing.js 등 SEAGNAL 의 모든
 *   modal/sheet 가 공통으로 사용 (marine.js:1136-1142 주석 참조).
 *
 * [상태 동기]
 *   재생 중이거나 슬라이더 위치가 어디든, 전체화면 진입 후에도 그대로 이어짐.
 *   (state.currentIndex / state.playing 가 단일 source of truth)
 *
 * [전역 노출] window.MarineChart 에 추가:
 *   enterFullscreen(), exitFullscreen()
 *
 * [초보자 안내]
 *   PopupStack 은 SEAGNAL 의 백버튼 시스템 핵심. 모든 popup/modal 이 여기에
 *   "내가 열렸어요, 닫는 법은 이거예요" 라고 등록 → 백버튼 누르면 가장 최근
 *   등록된 것부터 차례로 닫힘. 이 모듈도 같은 약속을 따릅니다.
 * ============================================================================
 */

(function () {
    'use strict';

    const MC = window.MarineChart;
    if (!MC) {
        console.error('[marine_chart3] marine_chart1.js 가 먼저 로드되어야 합니다.');
        return;
    }

    const POPUP_ID = 'mc-fullscreen';

    /**
     * 인라인 이미지 클릭 → 전체화면 진입.
     * - 오버레이 표시
     * - body 클래스 토글 (메인 헤더/탭바 숨김)
     * - 현재 프레임 정보를 풀스크린 라벨에 즉시 반영
     * - PopupStack 에 본인 등록 (백버튼 가로채기 위임)
     */
    function enterFullscreen() {
        const { el, state } = MC;
        if (!el.fullscreen) return;
        // 자료 없을 때는 진입 무시
        if (!state.list || state.list.length === 0) return;
        // 이미 열려 있으면 무시 (중복 진입 방지)
        if (!el.fullscreen.hasAttribute('hidden')) return;

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

        // PopupStack 등록 — 백버튼/다른 modal 통합 처리에 위임
        if (window.PopupStack) {
            window.PopupStack.push(POPUP_ID, function () {
                // popLast 가 호출 → 풀스크린 닫기. PopupStack 이 자동으로
                // 본인을 pop 하므로 여기서는 시각적 닫기만.
                _doClose();
            });
        }
    }

    /**
     * 사용자가 명시적으로 종료 (✕ 클릭 등). PopupStack 에서 자기 자신 제거 후
     * 시각적 닫기.
     */
    function exitFullscreen() {
        // PopupStack 에서 제거 (popLast 가 부른 경우엔 이미 pop 되었지만 안전)
        if (window.PopupStack) {
            window.PopupStack.remove(POPUP_ID);
        }
        _doClose();
    }

    /**
     * 실제 시각적 닫기 동작 (내부 전용).
     * PopupStack 이 호출하든 ✕ 가 호출하든 동일하게 실행.
     */
    function _doClose() {
        const { el } = MC;
        if (!el.fullscreen) return;
        if (el.fullscreen.hasAttribute('hidden')) return; // 이미 닫힘

        el.fullscreen.setAttribute('hidden', '');
        el.fullscreen.setAttribute('aria-hidden', 'true');
        el.fullscreen.classList.remove('show-controls');
        document.body.classList.remove('mc-fullscreen-active');

        // 페이드 타이머 정리
        if (MC.cancelFadeTimer) MC.cancelFadeTimer();
    }

    // ── 이벤트 바인딩 ──

    /**
     * 인라인 이미지 클릭 → 진입.
     * tabindex=0 이라 키보드(Enter/Space) 로도 진입 가능하도록 keydown 도 처리.
     *
     * [중요] DOMContentLoaded 시점엔 MC.el 이 아직 비어있다(init() 호출 전).
     *        그래서 MC.el.* 캐시 대신 document.getElementById 로 직접 조회.
     *        DOM 요소 자체는 HTML 파싱 시점에 이미 존재함.
     */
    function bindEnterTrigger() {
        const img = document.getElementById('mc-image');
        if (!img) return;
        img.addEventListener('click', enterFullscreen);
        img.addEventListener('keydown', (e) => {
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
        const closeBtn = document.getElementById('mc-fs-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', exitFullscreen);
        }
    }

    /**
     * 메인탭/서브탭 전환 시 풀스크린이 열려 있으면 자동 종료.
     * (PopupStack 은 백버튼만 처리하므로, 탭 클릭 시 명시적으로 닫기 호출)
     * capture phase 에서 가로채 다른 탭 핸들러보다 먼저 실행.
     */
    function bindTabGuard() {
        document.addEventListener('click', (e) => {
            const tabBtn = e.target.closest('.tab-btn, .sub-tab-btn');
            if (!tabBtn) return;
            const overlay = document.getElementById('mc-fullscreen');
            if (overlay && !overlay.hasAttribute('hidden')) {
                exitFullscreen();
            }
        }, true); // capture: tab handler 보다 먼저 실행
    }

    // ── 초기화 — DOMContentLoaded 후 1회 ──
    function setup() {
        bindEnterTrigger();
        bindExitTrigger();
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
