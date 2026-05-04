/**
 * ============================================================================
 * 파일명: js/ocean_northup.js
 * 역할: 해양종합정보 지도의 "진북(North Up)" 회전 컨트롤
 * ============================================================================
 *
 * [기능 — 3-state 사이클]
 *   사용자가 #ocean-northup-btn 을 누를 때마다 다음 순서로 상태 전환:
 *
 *     자유 (free)
 *        │  클릭
 *        ↓
 *     진북 정렬 (aligned)  ← view.rotation = 0 으로 회전, 자유 회전은 유지
 *        │  클릭
 *        ↓
 *     진북 고정 (locked)   ← rotation = 0 강제 + PinchRotate/DragRotate 비활성
 *        │  클릭
 *        ↓
 *     자유 (free)          ← 잠금 해제, 회전 자유
 *
 * [상태별 시각]
 *   - free    : 기본 .ocean-overlay-btn (어두운 반투명)
 *   - aligned : .northup-aligned   (옅은 파랑)
 *   - locked  : .northup-locked    (진한 파랑 + box-shadow)
 *   ※ 큰 글자 모드(html[data-font-size="large"]) 에서는 이모지 hide,
 *     data-line1="진북" 속성이 ::before 로 자동 표시 — 추가 작업 불필요.
 *
 * [잠금 영구 보존]
 *   사용자가 잠금 상태로 앱 종료 → 다음 진입에도 잠금 유지.
 *   localStorage 키 'oceanMap.northUp.locked' = 'true' 일 때만 locked 로 시작.
 *   그 외(free / aligned 였던 경우)는 자유로 시작 (aligned 는 일시적 상태라
 *   영구 보존 의미 없음).
 *
 * [토스트]
 *   - free → aligned (정렬) 진입 : "North up 정렬"  (bottom, 2초)
 *   - aligned → locked (고정) 진입 : "North up fixed"  (bottom, 2초)
 *   - locked → free (해제) 진입 : 토스트 없음 (배경색 변경으로 식별)
 *   - 자동 복원(localStorage 잠금) 시 : 토스트 없음 (사용자 액션 아님)
 *
 * [연계 파일]
 *   - index2.html       — #ocean-northup-btn DOM, 검색창 폭 양보(right 98px)
 *   - style.css         — .northup-aligned / .northup-locked 색상 클래스
 *   - js/ocean_map.js   — window.getOceanMap() 으로 OL Map 인스턴스 참조
 *   - js/index2_patch.js — _showOceanToast(msg, 'bottom', 2000) (토스트 함수)
 * ============================================================================
 */

(function () {
    'use strict';

    var STATES = { FREE: 'free', ALIGNED: 'aligned', LOCKED: 'locked' };
    var LS_KEY = 'oceanMap.northUp.locked';

    var currentState = STATES.FREE;
    var btnEl = null;
    var inited = false;

    /**
     * 현재 상태에 맞춰 버튼 클래스 + 라벨 텍스트 + title 을 모두 갱신.
     *
     * [라벨 동적 토글 정책]
     *   - free / aligned : "진북 정렬"  (data-line1="진북" data-line2="정렬")
     *   - locked         : "진북 Fix"   (data-line1="진북" data-line2="Fix")
     *   사용자 요구로 잠금(locked) 상태일 때만 "Fix" 라고 표시. 평소는 "정렬".
     *
     * [큰 글자 모드 호환]
     *   data-line1/data-line2 속성을 setAttribute 로 갱신하면 CSS 의
     *   ::before(content: attr(data-line1)) / ::after(content: attr(data-line2))
     *   가 자동으로 새 값을 반영함. textContent 변경은 일반 모드용.
     *
     * [배경색 클래스]
     *   .northup-aligned (옅파랑) / .northup-locked (진파랑+그림자) 만 토글.
     *   .ocean-overlay-btn 기본 어두운 반투명 색은 그대로 유지.
     */
    function _renderButton() {
        if (!btnEl) return;

        // 1) 배경색 클래스
        btnEl.classList.remove('northup-aligned', 'northup-locked');
        if (currentState === STATES.ALIGNED) {
            btnEl.classList.add('northup-aligned');
        } else if (currentState === STATES.LOCKED) {
            btnEl.classList.add('northup-locked');
        }

        // 2) 라벨 텍스트 + 큰글자 모드용 data 속성 + title 동기 갱신
        var labelEl = btnEl.querySelector('.ocean-overlay-label');
        if (currentState === STATES.LOCKED) {
            if (labelEl) {
                labelEl.textContent = '진북 Fix';
                labelEl.setAttribute('data-line1', '진북');
                labelEl.setAttribute('data-line2', 'Fix');
            }
            btnEl.title = '진북 Fix (North Up Fixed)';
        } else {
            // free 또는 aligned — 동일 라벨
            if (labelEl) {
                labelEl.textContent = '진북 정렬';
                labelEl.setAttribute('data-line1', '진북');
                labelEl.setAttribute('data-line2', '정렬');
            }
            btnEl.title = '진북 정렬 (North Up Align)';
        }
    }

    /**
     * OL View 의 회전을 0(진북) 으로 부드럽게 전환 (250ms 애니메이션).
     * 이미 0 이면 사실상 no-op.
     */
    function _rotateToNorth(map) {
        var view = map.getView();
        view.animate({ rotation: 0, duration: 250 });
    }

    /**
     * PinchRotate(두 손가락 회전) / DragRotate(Alt+드래그 회전) 인터랙션의
     * 활성 여부 토글. enabled=false 면 사용자가 손가락으로 회전 시도해도 무시됨.
     *
     * [구현 메모]
     *   OL View 의 enableRotation 옵션은 생성 시점에만 적용 가능 → 동적으로
     *   잠그려면 인터랙션 자체를 disable 해야 함. 이미 회전된 상태에서는
     *   _rotateToNorth() 로 0 으로 강제 후 disable 해야 잔여 각도 없음.
     */
    function _setRotateInteraction(map, enabled) {
        var ints = map.getInteractions();
        ints.forEach(function (it) {
            if (it instanceof ol.interaction.PinchRotate ||
                it instanceof ol.interaction.DragRotate) {
                it.setActive(enabled);
            }
        });
    }

    /**
     * bottom 토스트 표시 — index2_patch.js 의 _showOceanToast 위임.
     * 함수 미존재 시 silent fallback (토스트는 안내용이라 critical 아님).
     */
    function _toast(msg) {
        var fn = (typeof _showOceanToast === 'function') ? _showOceanToast
                : (window._showOceanToast || null);
        if (typeof fn === 'function') {
            fn(msg, 'bottom', 2000);
        }
    }

    /**
     * 상태 전환 — 새 상태에 따라:
     *   - 회전 위치 조정 (aligned/locked → 진북, free → 변경 없음)
     *   - 회전 인터랙션 활성/비활성
     *   - localStorage 저장 (locked 만 영구 보존)
     *   - 버튼 시각 갱신
     *   - 필요 시 토스트
     */
    function _applyState(newState, opts) {
        var silentToast = !!(opts && opts.silentToast);
        var map = (typeof window.getOceanMap === 'function') ? window.getOceanMap() : null;
        if (!map) return;

        currentState = newState;

        if (newState === STATES.ALIGNED) {
            _rotateToNorth(map);
            _setRotateInteraction(map, true);
            try { localStorage.removeItem(LS_KEY); } catch (e) {}
            if (!silentToast) _toast('North up 정렬');
        } else if (newState === STATES.LOCKED) {
            _rotateToNorth(map);
            _setRotateInteraction(map, false);
            try { localStorage.setItem(LS_KEY, 'true'); } catch (e) {}
            if (!silentToast) _toast('North up fixed');
        } else {  // FREE
            _setRotateInteraction(map, true);
            try { localStorage.removeItem(LS_KEY); } catch (e) {}
            // 잠금 해제(자유) 진입은 토스트 없음 — 색상 변경으로 식별
        }

        _renderButton();
    }

    /**
     * 버튼 클릭 — 3-state 사이클 한 칸 전진.
     */
    function _onClick() {
        if (currentState === STATES.FREE) {
            _applyState(STATES.ALIGNED);
        } else if (currentState === STATES.ALIGNED) {
            _applyState(STATES.LOCKED);
        } else {
            _applyState(STATES.FREE);
        }
    }

    /**
     * localStorage 로부터 잠금 여부 복원. true 면 locked 로 시작.
     * 토스트는 자동 시작이라 표시하지 않음 (사용자가 누른 게 아니므로).
     */
    function _restoreFromStorage() {
        var saved = null;
        try { saved = localStorage.getItem(LS_KEY); } catch (e) {}
        if (saved === 'true') {
            _applyState(STATES.LOCKED, { silentToast: true });
        }
    }

    /**
     * 초기화 — DOMContentLoaded 시 호출. 지도 인스턴스가 아직 없을 수 있어
     * window.getOceanMap() 가 null 일 수 있는 시점이라, 잠금 복원은 '지도
     * 준비 완료' 시점까지 지연 시도.
     */
    function _init() {
        if (inited) return;
        btnEl = document.getElementById('ocean-northup-btn');
        if (!btnEl) return;
        btnEl.addEventListener('click', _onClick);
        inited = true;

        // 지도 인스턴스가 준비될 때까지 폴링하여 잠금 상태 복원.
        // 일반적으로 ocean_map.js 의 init 후 즉시 사용 가능. 100ms × 50회 = 5초 한도.
        var tries = 0;
        var iv = setInterval(function () {
            tries++;
            var map = (typeof window.getOceanMap === 'function') ? window.getOceanMap() : null;
            if (map) {
                clearInterval(iv);
                _restoreFromStorage();
            } else if (tries > 50) {
                clearInterval(iv);
            }
        }, 100);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }
})();
