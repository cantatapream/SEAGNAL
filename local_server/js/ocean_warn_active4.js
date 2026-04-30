/**
 * ============================================================================
 * 파일명: js/ocean_warn_active4.js  (4/5 — 토글 버튼 + 활성/비활성 전환)
 * 역할 : 우측 컨트롤 스택의 "🚨 ON/OFF" 토글 버튼을 바인딩하고,
 *        활성 진입(_activate) / 종료(_deactivate) 시점의 부수효과를 모두 처리.
 * ============================================================================
 *
 * [버튼 3-state 표시]
 *   1. 색칠 가능한 활성 특보 0건  → 회색 경광등 + "특보 없음" (disabled)
 *   2. 1건 이상 + OFF 상태         → 회색 경광등 + "ON"  (클릭하면 색칠 ON)
 *   3. 1건 이상 + ON  상태         → 빨간 경광등 + "OFF" (클릭하면 색칠 OFF)
 *
 * [활성 진입 시 부수효과 (_activate)]
 *   - 직전 베이스맵 종류를 state.savedBasemap 에 저장 (OFF 시 복귀용)
 *   - 베이스맵 → 'coast'(해안도) 로 전환 (요구사항)
 *   - 특보구역도 자동 ON (이미 ON 이면 그대로) — setWarnZoneVisible(true)
 *   - 자식 layer 의 minZoom 제약 해제 → 줌 8 이하에서도 자식까지 색칠 보임
 *   - OceanWarnZone.setActiveStyler(_styler) 등록 → 즉시 색칠 적용
 *
 * [비활성 종료 시 (_deactivate)]
 *   - OceanWarnZone.setActiveStyler(null) → 기존 outline 으로 복귀
 *   - 자식 layer minZoom 원복
 *   - 베이스맵을 savedBasemap 으로 복귀
 *   - 정보 박스 떠 있으면 닫기 (5.js 의 _hideBox 호출)
 *   - ※ 특보구역도 토글 자체는 사용자 의도 존중 → 강제로 끄지 않음
 *
 * [활성 도중 사용자가 베이스맵을 수동 변경한 경우]
 *   - 사용자 의도이므로 그 새 값을 savedBasemap 으로 갱신 (OFF 시 복귀 위치)
 *   - bindBasemapPicker 에 추가 listener 설치
 * ============================================================================
 */

(function () {
    'use strict';

    var ns = window.OceanWarnActive;
    if (!ns) return;

    // 토글 버튼 DOM 참조 캐시 (_renderButton 마다 다시 찾지 않도록)
    var _btn = null;

    /**
     * 토글 버튼 DOM 을 찾아 캐시. 아직 없으면 null.
     * (5.js 부트스트랩에서 polling 으로 이 함수를 호출하므로 안전.)
     */
    function _getButton() {
        if (_btn && document.body.contains(_btn)) return _btn;
        _btn = document.getElementById('ocean-warn-active-toggle-btn');
        return _btn;
    }

    /**
     * 특보구역 토글 버튼이 현재 ON 인지 확인.
     * ocean_warn_zone.js 의 _bindToggle 가 click 시마다 .active 클래스를 토글하므로
     * 그 클래스 보유 여부로 판정. 정적 DOM 룩업이라 매번 호출해도 부담 없음.
     */
    function _isWarnZoneOn() {
        var wz = document.getElementById('ocean-warn-zone-toggle-btn');
        return !!(wz && wz.classList.contains('active'));
    }

    /**
     * 범례 박스 표출/숨김. 4.js 의 _activate / _deactivate 가 호출.
     */
    function _setLegendVisible(show) {
        var lg = document.getElementById('ocean-warn-active-legend');
        if (!lg) return;
        lg.style.display = show ? '' : 'none';
        lg.setAttribute('aria-hidden', show ? 'false' : 'true');
    }

    /**
     * 토글 버튼의 시각 상태를 현재 상태에 맞게 갱신.
     *
     * [동적 노출 정책]
     *   - 특보구역 토글이 OFF 면 우리 버튼 자체를 display:none → 숨김
     *   - 특보구역 토글이 ON  이면 표출 + 3-state 표시:
     *       (a) 색칠 가능 활성 특보 0건 → disabled + "특보 없음"
     *       (b) ≥1건 + 우리 OFF        → 회색 경광등 + "특보 ON"
     *       (c) ≥1건 + 우리 ON         → 빨간 경광등 + "특보 OFF"
     *
     * [읽는 값] state.active, state.activeMap (paletteKey 보유 여부),
     *           특보구역 버튼의 .active 클래스
     * [쓰는 값] 버튼의 display, class, 자식 i 아이콘 색, span 라벨 텍스트
     *
     * [호출 시점]
     *   - 부트(5.js) 직후 1회
     *   - 'seagnal:alerts-changed' 이벤트 시 (특보 데이터 갱신)
     *   - 특보구역 버튼 click 동기화 직후 (_bindWarnZoneSync)
     *   - _activate / _deactivate 직후
     */
    ns._renderButton = function () {
        var btn = _getButton();
        if (!btn) return;

        // 0) 특보구역 토글 OFF → 우리 버튼 자체 숨김
        if (!_isWarnZoneOn()) {
            btn.style.display = 'none';
            return;
        }
        // 표출 — 명시적으로 'flex' 사용 (style.css:8261 의 .ocean-overlay-btn 기본값과 동일).
        // [중요] 빈 문자열('') 로 두면 인라인 스타일이 비워져 CSS 의
        //   `#ocean-warn-active-toggle-btn.ocean-warn-active-toggle { display: none }`
        // 규칙으로 fallback 되어 영원히 숨김 상태가 됨. 명시적 'flex' 가 안전.
        btn.style.display = 'flex';

        var hasActive = ns._hasAnyColorableActive();
        var isOn = state.active && hasActive;

        // 라벨 / 아이콘 자식 element
        var icon  = btn.querySelector('i');
        var label = btn.querySelector('.ocean-overlay-label');

        if (!hasActive) {
            // (a) 활성 특보 0건 — disabled
            btn.classList.remove('active');
            btn.classList.add('warn-active-disabled');
            btn.setAttribute('aria-disabled', 'true');
            btn.title = '현재 활성 특보 없음';
            if (icon) icon.style.color = '#9ca3af';   // 회색 경광등
            if (label) label.textContent = '특보 없음';
        } else if (isOn) {
            // (c) ON — 빨간 경광등 + "특보 OFF" 라벨 (누르면 OFF)
            btn.classList.add('active');
            btn.classList.remove('warn-active-disabled');
            btn.removeAttribute('aria-disabled');
            btn.title = '활성 특보 색칠 끄기';
            if (icon) icon.style.color = '#ef4444';
            if (label) label.textContent = '특보 OFF';
        } else {
            // (b) OFF — 회색 경광등 + "특보 ON" 라벨 (누르면 ON)
            btn.classList.remove('active');
            btn.classList.remove('warn-active-disabled');
            btn.removeAttribute('aria-disabled');
            btn.title = '활성 특보 색칠 켜기';
            if (icon) icon.style.color = '#9ca3af';
            if (label) label.textContent = '특보 ON';
        }
    };

    var state = ns._state;

    /**
     * 토글 ON 진입 — 색칠 모드 활성화.
     *
     * [순서]
     *   1) 직전 베이스맵 저장 → 2) 해안도 전환 → 3) 특보구역도 ON
     *   → 4) 자식 minZoom 해제 → 5) 스타일러 등록 → 6) 버튼 갱신
     *
     * [안전]
     *   - state.active 가 이미 true 면 no-op (멱등성 보장)
     *   - 외부 API(setWarnZoneVisible/oceanSetBasemap) 가 아직 정의 안 된
     *     초기 단계에 호출되면 typeof 검사로 안전 skip
     */
    ns._activate = function () {
        if (state.active) return;
        if (!ns._hasAnyColorableActive()) return;  // 활성 특보 없으면 진입 거부

        // 1) 현재 베이스맵 기억
        try {
            state.savedBasemap = (typeof window.oceanGetBasemap === 'function')
                ? window.oceanGetBasemap()
                : 'rltm';
        } catch (e) { state.savedBasemap = 'rltm'; }

        // 2) 베이스맵을 해안도로 전환
        if (state.savedBasemap !== 'coast' && typeof window.oceanSetBasemap === 'function') {
            try { window.oceanSetBasemap('coast'); } catch (e) { /* noop */ }
        }

        // 3) 특보구역도 자동 ON (이미 ON 이면 그대로)
        if (typeof window.setWarnZoneVisible === 'function') {
            try { window.setWarnZoneVisible(true); } catch (e) { /* noop */ }
        }

        // 4) 자식 layer minZoom 해제 — 멀리서도 자식까지 색이 보이게
        if (window.OceanWarnZone && typeof window.OceanWarnZone.setSubMinZoomDisabled === 'function') {
            window.OceanWarnZone.setSubMinZoomDisabled(true);
        }

        // 5) 스타일러 등록 — 이 호출이 즉시 layer.changed() 까지 트리거
        state.active = true;
        if (window.OceanWarnZone && typeof window.OceanWarnZone.setActiveStyler === 'function') {
            window.OceanWarnZone.setActiveStyler(ns._styler);
        }

        // 6) 범례 표출
        _setLegendVisible(true);

        // 7) 버튼 표시 갱신
        ns._renderButton();
        ns._log('activated; savedBasemap =', state.savedBasemap);
    };

    /**
     * 토글 OFF — 색칠 모드 종료 + 베이스맵 원복.
     */
    ns._deactivate = function () {
        if (!state.active) return;
        state.active = false;

        // 1) 스타일러 해제 → 즉시 기본 outline 복귀
        if (window.OceanWarnZone && typeof window.OceanWarnZone.setActiveStyler === 'function') {
            window.OceanWarnZone.setActiveStyler(null);
        }

        // 2) 자식 layer minZoom 원복
        if (window.OceanWarnZone && typeof window.OceanWarnZone.setSubMinZoomDisabled === 'function') {
            window.OceanWarnZone.setSubMinZoomDisabled(false);
        }

        // 3) 베이스맵 복귀 (저장된 값으로). state.savedBasemap 이 'coast' 였다면
        //    그대로 둠 (사용자가 원래 해안도였던 케이스).
        if (state.savedBasemap && state.savedBasemap !== 'coast'
            && typeof window.oceanSetBasemap === 'function') {
            try { window.oceanSetBasemap(state.savedBasemap); } catch (e) { /* noop */ }
        }

        // 4) 정보 박스 떠 있으면 닫기 (5.js 의 _hideBox)
        if (typeof ns._hideBox === 'function') ns._hideBox();

        // 5) 범례 숨김
        _setLegendVisible(false);

        // 6) 버튼 표시 갱신
        ns._renderButton();
        ns._log('deactivated');
    };

    /**
     * 버튼 click 핸들러.
     * - disabled 상태(특보 없음) 면 무반응
     * - 그 외에는 active 상태 toggle
     */
    function _onToggleClick(e) {
        e.preventDefault();
        var btn = _getButton();
        if (!btn || btn.classList.contains('warn-active-disabled')) return;
        if (state.active) ns._deactivate();
        else              ns._activate();
    }

    /**
     * 버튼/베이스맵 피커/특보구역 버튼에 이벤트 바인딩.
     *
     * [핵심 바인딩]
     *   1) 우리 토글 버튼 click → _onToggleClick
     *   2) 베이스맵 피커 (.ocean-basemap-item) click → 활성 도중 사용자가 직접 베이스맵
     *      변경 시 state.savedBasemap 을 그 새 값으로 업데이트. 이렇게 해야 OFF 시
     *      "방금 사용자가 고른 그 베이스맵" 으로 자연스럽게 남음.
     *   3) 특보구역 버튼(#ocean-warn-zone-toggle-btn) click → 동적 노출 동기화.
     *      특보구역 OFF 로 바뀌면 우리도 자동 _deactivate (활성 도중일 때) +
     *      버튼 자체 숨김. 특보구역 ON 으로 바뀌면 우리 버튼 표출(특보 없음/ON/OFF
     *      상태에 맞춰).
     *      ※ ocean_warn_zone.js _bindToggle 가 click 시 _visible 토글 + active
     *        클래스 갱신을 동기로 처리 → 우리 listener 도 같은 click 이벤트에서
     *        그 상태를 즉시 읽을 수 있음. 단, listener 등록 순서상 ocean_warn_zone.js
     *        의 핸들러보다 뒤에 등록되어야 .active 갱신 후 우리가 읽게 됨.
     *        bootWhenReady (5.js) 에서 OceanWarnZone 준비된 뒤 _bindButton 을
     *        호출하므로 순서 보장.
     *
     * [중복 바인딩 방지]
     *   data-warn-active-bound 속성으로 1회만 등록.
     */
    ns._bindButton = function () {
        var btn = _getButton();
        if (btn && !btn.dataset.warnActiveBound) {
            btn.addEventListener('click', _onToggleClick);
            btn.dataset.warnActiveBound = '1';
        }

        // 베이스맵 피커 listener
        var items = document.querySelectorAll('.ocean-basemap-item');
        items.forEach(function (item) {
            if (item.dataset.warnActiveBound) return;
            item.addEventListener('click', function () {
                if (!state.active) return;
                // 사용자가 활성 도중 베이스맵을 직접 골랐으므로 그것을 복귀 대상으로
                var newType = item.dataset.basemap;
                if (newType) state.savedBasemap = newType;
            });
            item.dataset.warnActiveBound = '1';
        });

        // 특보구역 버튼 동기화 — 우리 버튼 표출/숨김 + OFF 시 자동 _deactivate
        var wzBtn = document.getElementById('ocean-warn-zone-toggle-btn');
        if (wzBtn && !wzBtn.dataset.warnActiveSyncBound) {
            wzBtn.addEventListener('click', function () {
                // ocean_warn_zone.js _bindToggle 가 같은 click 에서 active 클래스를 동기 갱신.
                // 우리는 그 결과를 즉시 읽어 동기화 — 한 프레임 뒤로 미루지 않아도 안전.
                var wzOn = wzBtn.classList.contains('active');
                if (!wzOn && state.active) {
                    // 특보구역 OFF 전환 시 우리도 자동 OFF (베이스맵 복귀 등 모두 처리)
                    ns._deactivate();
                }
                ns._renderButton();
            });
            wzBtn.dataset.warnActiveSyncBound = '1';
        }
    };
})();
