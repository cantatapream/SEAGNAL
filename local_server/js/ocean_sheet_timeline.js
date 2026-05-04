/**
 * ============================================================================
 * 파일명: js/ocean_sheet_timeline.js
 * 역할: 해양종합정보 바텀시트 내부의 시간 이동 슬라이더
 * ============================================================================
 *
 * [위치]
 *   바텀시트 헤더에서 양력 날짜(예: '26.5.5.(화) 12:00) 바로 아래.
 *   기존 음력 표기가 있던 자리(.ocean-sheet-subrow) 안에 배치.
 *
 * [개념]
 *   - 슬라이더 step = 3시간 (KMA wave/wind 예보가 3시간 단위)
 *   - 슬라이더 value = "첫 프레임 시각으로부터의 N 시간 (3 단위)"
 *     · value=0 → "지금에 가장 가까운 3시간 경계" (첫 프레임)
 *     · value=3 → 첫 프레임 + 3시간
 *     · value=6 → 첫 프레임 + 6시간 ...
 *   - 슬라이더 max = wave/wind maxForecastHours 에서 firstFrame 거리만큼 제한 후 3 단위로 floor
 *   - 자정 위치에만 짧은 세로 막대 (텍스트 X)
 *   - 손잡이 위에 말풍선 (천기 슬라이더와 동일 동작 — viewport clamp + 화살표 추적 + fade-out)
 *
 * [갱신 정책]
 *   드래그 중 (input)        : 헤더 양력/음력 텍스트 + 말풍선 텍스트만 갱신. API 호출 X.
 *   드래그 종료 (change)     : STL.onRelease(hours) 콜백 발화 → ocean_bottom_sheet2.js 가
 *                              구체 동작 결정 (같은 날 → 게이지만 / 다른 날 → 풀 재로드).
 *
 * [외부 API — window.OceanSheet.SheetTL]
 *   STL.init(initialLayerHours, zoneMaxHours)  : 시트 오픈 시 호출
 *   STL.setMaxHours(zoneMaxHours)              : zone-forecasts 응답 수신 시 호출
 *   STL.setHours(hours)                        : 외부에서 슬라이더 값 강제 설정 (이벤트 발화 X)
 *   STL.getHours()                             : 현재 슬라이더 값 (정수, 0~max)
 *   STL.getCurrentDate()                       : 현재 슬라이더가 가리키는 Date 객체
 *   STL.setVisible(boolean)                    : 슬라이더 wrap 표시/숨김 (Phase 8용)
 *   STL.teardown()                             : 시트 닫을 때 호출 — 말풍선 정리
 *
 * [외부 콜백 — 호출자가 덮어씌움]
 *   STL.onRelease(hours)                       : 사용자가 손잡이 놓는 순간 호출 (Phase 3에서 wire)
 *
 * [의존]
 *   - window.OceanSheet (OS)
 *   - OS.state, OS.renderHeader (드래그 중 헤더 갱신)
 *   - DOM: #ocean-sheet-slider-wrap, #ocean-sheet-slider, #ocean-sheet-tooltip, #ocean-sheet-ticks
 *
 * [비의존]
 *   - 외부 라이브러리 0
 *   - 다른 ocean_*.js 의 함수 직접 호출 없음 (콜백 패턴으로 분리)
 * ============================================================================
 */

(function () {
    'use strict';

    var OS = window.OceanSheet = window.OceanSheet || {};
    var STL = OS.SheetTL = OS.SheetTL || {};

    // ── 내부 상태 ─────────────────────────────────────────────
    /** 슬라이더 value=0 의 실제 시각 (epoch ms). "지금에 가장 가까운 3시간 경계"로 스냅됨. */
    var _firstFrameMs = 0;
    /** zone-forecasts 응답으로 받은 wave/wind maxForecastHours (지금 기준). 내부 보관. */
    var _zoneMaxHours = 0;
    /** 슬라이더 max (= firstFrame 으로부터의 시간, 3 단위 floor). */
    var _maxHours = 0;
    /** 말풍선 fade-out 타이머 핸들. */
    var _fadeTimer = null;
    /** 이벤트 바인딩 idempotent 처리. */
    var _bound = false;
    /** 마지막으로 "정착(release/init)" 한 슬라이더 시각의 날짜 키 (YYYY-M-D).
     *  같은 날인지 판정에 사용. drag 중 OS.state.date 가 매번 변하므로
     *  드래그 전 날짜 추적용 별도 변수가 필요. */
    var _lastSettledDayKey = '';
    /** 한국어 요일. */
    var WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];

    // ── 유틸 ─────────────────────────────────────────────────
    function $(id) { return document.getElementById(id); }

    /**
     * ms 시각을 "가장 가까운 3시간 경계"로 스냅.
     *  - 09:00 / 12:00 / 15:00 / 18:00 / 21:00 / 00:00 / 03:00 / 06:00 단위
     *  - 동률(예: 13:30 → 12:00 vs 15:00) 시 floor (과거 쪽) 채택
     *
     * @param {number} ms - epoch milliseconds
     * @returns {number} 스냅된 epoch milliseconds (분/초/밀리초 = 0)
     */
    function snapToNearest3h(ms) {
        var d = new Date(ms);
        var h = d.getHours();
        var floorH = Math.floor(h / 3) * 3;
        var floorD = new Date(d);
        floorD.setHours(floorH, 0, 0, 0);
        var ceilD = new Date(floorD.getTime() + 3 * 3600000);
        var diffFloor = ms - floorD.getTime();
        var diffCeil  = ceilD.getTime() - ms;
        // 동률(diffFloor === diffCeil) 시 floor 우선 — "지금"에 더 가까운 데이터가 과거에 있음
        return diffFloor <= diffCeil ? floorD.getTime() : ceilD.getTime();
    }

    /**
     * _zoneMaxHours 와 _firstFrameMs 로부터 슬라이더 max 계산.
     * firstFrame 이 미래(현재 +0.5~1.5h)이면 그만큼 슬라이더 끝이 줄어듦.
     */
    function computeMaxFromZone() {
        if (_zoneMaxHours <= 0) return 0;
        var hoursOffset = (_firstFrameMs - Date.now()) / 3600000;
        var maxFromFirst = _zoneMaxHours - hoursOffset;
        return Math.max(0, Math.floor(maxFromFirst / 3) * 3);
    }

    /**
     * 레이어 슬라이더 hours(0~72, "지금으로부터 N시간") → 시트 슬라이더 value 변환.
     * 시트 슬라이더는 firstFrame 기준이라 살짝 다름 → 3 단위로 round + max clamp.
     */
    function sheetValueFromLayerHours(lh) {
        var actualMs = Date.now() + (lh || 0) * 3600000;
        var v = Math.round((actualMs - _firstFrameMs) / 3600000 / 3) * 3;
        return Math.max(0, Math.min(_maxHours, v));
    }

    // ── 자정 눈금 ────────────────────────────────────────────
    /**
     * firstFrame 부터 firstFrame+max 사이의 자정(00:00) 위치 % 배열 반환.
     * 예: firstFrame=12:00 today, max=57h → 자정 위치 = 12/57=21%, 36/57=63%
     */
    function computeMidnightTicks() {
        var arr = [];
        if (_maxHours <= 0) return arr;
        var startMs = _firstFrameMs;
        var endMs = startMs + _maxHours * 3600000;
        // 첫 자정 = startMs 이후의 다음 00:00
        var d = new Date(startMs);
        d.setHours(24, 0, 0, 0);  // setHours(24) → 다음날 00:00:00
        while (d.getTime() <= endMs) {
            var pct = (d.getTime() - startMs) / (endMs - startMs) * 100;
            arr.push(pct);
            d = new Date(d.getTime() + 24 * 3600000);
        }
        return arr;
    }

    /**
     * 자정 눈금 DOM 채움. ticks 컨테이너의 좌우 패딩(9px)이 thumb 끝에 맞춰져 있어
     * % 계산은 트랙 가로 길이를 1로 본 비율 그대로 사용 가능.
     */
    function renderTicks() {
        var ticksEl = $('ocean-sheet-ticks');
        if (!ticksEl) return;
        var positions = computeMidnightTicks();
        ticksEl.innerHTML = positions.map(function (p) {
            return '<div class="ocean-sheet-tick" style="left:' + p.toFixed(2) + '%"></div>';
        }).join('');
    }

    // ── 말풍선 ───────────────────────────────────────────────
    /**
     * 손잡이 위에 말풍선 위치/텍스트 갱신.
     * 천기/타임라인 슬라이더와 동일한 viewport clamping + 화살표 분리 패턴.
     *
     * 폰트 크기 변경 시: getBoundingClientRect() 가 매번 실제 폭을 재므로 자동 reflow.
     */
    function updateTooltip() {
        var tip = $('ocean-sheet-tooltip');
        var slider = $('ocean-sheet-slider');
        if (!tip || !slider) return;

        var v = parseFloat(slider.value) || 0;
        var ms = _firstFrameMs + v * 3600000;
        var d = new Date(ms);

        // 텍스트: "'26. 5. 6.(수) 13:00"
        var yy = String(d.getFullYear()).slice(-2);
        var hh = String(d.getHours()).padStart(2, '0');
        var mi = String(d.getMinutes()).padStart(2, '0');
        tip.textContent =
            "'" + yy + ". " + (d.getMonth() + 1) + ". " + d.getDate() + ".(" +
            WEEKDAYS_KO[d.getDay()] + ") " + hh + ':' + mi;

        // reset (정확한 width 측정 위해)
        tip.style.left = '0px';

        // thumb 의 viewport 절대 좌표
        var sliderRect = slider.getBoundingClientRect();
        var min = parseFloat(slider.min) || 0;
        var max = parseFloat(slider.max) || 0;
        var pct = (max > min) ? (v - min) / (max - min) : 0;
        var thumbHalf = 7;  // thumb 14px / 2
        var thumbXVp = sliderRect.left + thumbHalf + pct * (sliderRect.width - thumbHalf * 2);

        // 말풍선 측정 (텍스트 변경 후 재측정 — 폰트 크기 자동 반영)
        var tipRect = tip.getBoundingClientRect();
        var tipW = tipRect.width;

        // viewport clamp
        var pad = 4;
        var minLV = pad;
        var maxLV = window.innerWidth - tipW - pad;
        var idealLV = thumbXVp - tipW / 2;
        var clampedLV = Math.max(minLV, Math.min(idealLV, maxLV));

        // 부모(wrap) 기준 left 로 변환
        var parentRect = tip.parentElement.getBoundingClientRect();
        var leftInParent = clampedLV - parentRect.left;
        tip.style.left = leftInParent + 'px';

        // 화살표 — 말풍선 가두어졌더라도 thumb 방향으로 비스듬히 이동
        var arrowX = thumbXVp - clampedLV;
        var arrowMin = 8, arrowMax = tipW - 8;
        arrowX = Math.max(arrowMin, Math.min(arrowX, arrowMax));
        tip.style.setProperty('--shtl-arrow-x', arrowX + 'px');
    }

    function showTooltip() {
        clearTimeout(_fadeTimer);
        var tip = $('ocean-sheet-tooltip');
        if (tip) tip.classList.add('visible');
    }

    function startFadeOut() {
        clearTimeout(_fadeTimer);
        _fadeTimer = setTimeout(function () {
            var tip = $('ocean-sheet-tooltip');
            if (tip) tip.classList.remove('visible');
        }, 1000);
    }

    /** Date → "YYYY-M-D" 키. 같은 날 판정용. */
    function _dayKey(d) {
        return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    }

    // ── 헤더 동기 (드래그 중 호출) ──────────────────────────────
    /**
     * 슬라이더 현재값 → OS.state.date 갱신 + 헤더 다시 그림.
     * 드래그 중 (input event) 매번 호출. API 호출은 발생하지 않음.
     */
    function syncHeaderToSlider() {
        var slider = $('ocean-sheet-slider');
        if (!slider) return;
        var v = parseFloat(slider.value) || 0;
        var ms = _firstFrameMs + v * 3600000;
        OS.state.date = new Date(ms);
        if (typeof OS.renderHeader === 'function') OS.renderHeader();
    }

    // ── 이벤트 바인딩 (idempotent) ──────────────────────────────
    /**
     * 슬라이더 input/change/touch/pointer 이벤트 바인딩.
     * 한 번만 실행되고 두 번째 호출부터는 무시 (시트 재오픈 시 중복 바인딩 방지).
     */
    function bindEvents() {
        if (_bound) return;
        _bound = true;
        var slider = $('ocean-sheet-slider');
        if (!slider) return;

        // 드래그 시작 — 말풍선 표시
        slider.addEventListener('mousedown', function () {
            updateTooltip();
            showTooltip();
        });
        slider.addEventListener('touchstart', function () {
            updateTooltip();
            showTooltip();
        }, { passive: true });

        // 드래그 중 — 헤더 텍스트 + 말풍선만 갱신, API 호출 X
        slider.addEventListener('input', function () {
            updateTooltip();
            showTooltip();
            syncHeaderToSlider();
        });

        // 드래그 종료 — release 콜백 발화 (ocean_bottom_sheet2.js 가 wire)
        slider.addEventListener('change', function () {
            startFadeOut();
            var v = parseFloat(slider.value) || 0;
            var newDate = STL.getCurrentDate();
            var newKey = _dayKey(newDate);
            var sameDay = (newKey === _lastSettledDayKey);
            _lastSettledDayKey = newKey;  // 다음 release 비교 기준 갱신
            if (typeof STL.onRelease === 'function') {
                STL.onRelease(v, sameDay, newDate);
            }
        });

        // 추가 release 이벤트 (다양한 입력 장치 대응)
        slider.addEventListener('mouseup',       function () { startFadeOut(); });
        slider.addEventListener('touchend',      function () { startFadeOut(); });
        slider.addEventListener('pointercancel', function () { startFadeOut(); });
        slider.addEventListener('touchcancel',   function () { startFadeOut(); });
    }

    // ── 외부 API ─────────────────────────────────────────────

    /**
     * 시트 오픈 시 호출. 시트 슬라이더 활성화/비활성화 및 초기 위치 설정.
     *
     * @param {number} initialLayerHours - 레이어 슬라이더의 현재 value (0~72). 시트 슬라이더 초기 위치 산출.
     * @param {number} zoneMaxHours      - wave/wind maxForecastHours (현재 시각 기준). 슬라이더 max 결정.
     */
    STL.init = function (initialLayerHours, zoneMaxHours) {
        var slider = $('ocean-sheet-slider');
        var wrap   = $('ocean-sheet-slider-wrap');
        if (!slider || !wrap) return;

        // 1) firstFrame 결정 — "지금에 가장 가까운 3시간 경계"
        _firstFrameMs = snapToNearest3h(Date.now());

        // 2) max 결정 — wave/wind 한계 안에서 3시간 단위로 floor
        _zoneMaxHours = zoneMaxHours || 0;
        _maxHours = computeMaxFromZone();

        // 3) max=0 (예보 데이터 없음) → 슬라이더 자체를 숨김
        if (_maxHours <= 0) {
            wrap.classList.add('is-hidden');
            slider.disabled = true;
            slider.max = 0;
            slider.value = 0;
            return;
        }

        // 4) 슬라이더 활성화 + 속성 갱신
        wrap.classList.remove('is-hidden');
        slider.disabled = false;
        slider.min = 0;
        slider.max = _maxHours;
        slider.step = 3;

        // 5) 초기값 = 레이어 슬라이더 값을 시트 슬라이더 좌표계로 변환
        slider.value = sheetValueFromLayerHours(initialLayerHours || 0);

        // 6) 자정 눈금 렌더
        renderTicks();

        // 7) 이벤트 바인딩 (한 번만)
        bindEvents();

        // 8) 헤더 동기 — 슬라이더 시각 → OS.state.date → renderHeader
        syncHeaderToSlider();

        // 9) "마지막 정착 날짜" 캡처 — 다음 release 시 같은 날 비교 기준
        _lastSettledDayKey = _dayKey(STL.getCurrentDate());
    };

    /**
     * zone-forecasts 응답이 도착했을 때 / max 가 갱신될 때 호출.
     * 현재 슬라이더 value 가 새 max 를 넘으면 max 로 클램프 + onRelease 자동 발화.
     */
    STL.setMaxHours = function (zoneMaxHours) {
        var slider = $('ocean-sheet-slider');
        var wrap   = $('ocean-sheet-slider-wrap');
        if (!slider || !wrap) return;

        _zoneMaxHours = zoneMaxHours || 0;
        _firstFrameMs = snapToNearest3h(Date.now());
        _maxHours = computeMaxFromZone();

        if (_maxHours <= 0) {
            wrap.classList.add('is-hidden');
            slider.disabled = true;
            slider.max = 0;
            slider.value = 0;
            return;
        }

        wrap.classList.remove('is-hidden');
        slider.disabled = false;
        slider.max = _maxHours;

        var v = parseFloat(slider.value) || 0;
        if (v > _maxHours) {
            // 사용자가 잡고 있던 위치가 새 max 너머 → max 로 옮기고 풀 재로드 발화
            slider.value = _maxHours;
            syncHeaderToSlider();
            // [수정] onRelease 시그너처 (hours, sameDay, newDate) 전부 채워야 함.
            // newDate undefined 면 핸들러 안에서 OS.state.date = undefined → NPE 위험.
            if (typeof STL.onRelease === 'function') {
                var newDate = STL.getCurrentDate();
                var newKey = _dayKey(newDate);
                var sameDay = (newKey === _lastSettledDayKey);
                _lastSettledDayKey = newKey;
                STL.onRelease(_maxHours, sameDay, newDate);
            }
        }

        renderTicks();
    };

    /**
     * 외부에서 슬라이더 값을 강제 설정 (이벤트 발화 X).
     * 사용 예: 레이어 슬라이더 → 시트 슬라이더 동기 (Phase 5)
     */
    STL.setHours = function (hours) {
        var slider = $('ocean-sheet-slider');
        if (!slider) return;
        var v = Math.max(0, Math.min(_maxHours, Math.round((hours || 0) / 3) * 3));
        slider.value = v;
        syncHeaderToSlider();
        updateTooltip();
    };

    /**
     * OS.state.date 의 시각 → 슬라이더 value 로 동기.
     * 사용 예: ◀/▶ 로 OS.state.date 가 +24h/-24h 변경됐을 때 슬라이더 손잡이 위치도 따라가야 함 (Q5=c).
     *
     * 차이점 (vs STL.setHours):
     *   - STL.setHours: 외부에서 hours 값을 명시. 호출 시 syncHeaderToSlider 도 호출 (state.date 다시 갱신).
     *   - STL.syncToStateDate: OS.state.date 시각을 슬라이더 value 에 반영. state.date 는 변경하지 않음.
     *     (◀/▶ 가 설정한 시:분이 그대로 유지되어야 하므로 syncHeaderToSlider 호출 X)
     */
    STL.syncToStateDate = function () {
        var slider = $('ocean-sheet-slider');
        if (!slider || !OS.state || !OS.state.date) return;
        var deltaMs = OS.state.date.getTime() - _firstFrameMs;
        var v = Math.round(deltaMs / 3600000 / 3) * 3;
        v = Math.max(0, Math.min(_maxHours, v));
        slider.value = v;
        // _lastSettledDayKey 도 동기 — 다음 release 의 sameDay 비교 기준
        _lastSettledDayKey = _dayKey(OS.state.date);
        updateTooltip();
    };

    /** 현재 슬라이더 값 (정수, 0~max). */
    STL.getHours = function () {
        var slider = $('ocean-sheet-slider');
        return slider ? (parseFloat(slider.value) || 0) : 0;
    };

    /** 현재 슬라이더가 가리키는 Date 객체. */
    STL.getCurrentDate = function () {
        var slider = $('ocean-sheet-slider');
        if (!slider) return new Date();
        var v = parseFloat(slider.value) || 0;
        return new Date(_firstFrameMs + v * 3600000);
    };

    /** firstFrame 의 epoch ms (외부 디버깅 / 변환용). */
    STL.getFirstFrameMs = function () { return _firstFrameMs; };

    /**
     * 슬라이더 wrap 표시/숨김. 예보 범위 외 날짜 진입 시 호출 (Phase 8).
     * 단 _maxHours == 0 (예보 데이터 자체 없음) 인 경우엔 visible=true 호출돼도 숨김 강제 유지.
     */
    STL.setVisible = function (visible) {
        var wrap = $('ocean-sheet-slider-wrap');
        if (!wrap) return;
        if (visible && _maxHours > 0) wrap.classList.remove('is-hidden');
        else wrap.classList.add('is-hidden');
    };

    /** 슬라이더가 현재 표시되어 있는지(=is-hidden 클래스 없는지). */
    STL.isVisible = function () {
        var wrap = $('ocean-sheet-slider-wrap');
        return !!(wrap && !wrap.classList.contains('is-hidden'));
    };

    /**
     * 시트 닫을 때 호출 — 말풍선 즉시 제거. (이벤트 바인딩은 그대로 유지)
     */
    STL.teardown = function () {
        clearTimeout(_fadeTimer);
        var tip = $('ocean-sheet-tooltip');
        if (tip) tip.classList.remove('visible');
    };

    /**
     * 사용자가 손잡이를 놓는 순간 호출되는 콜백 — Phase 3 에서 ocean_bottom_sheet2.js 가
     * 덮어씌워서 "같은 날 → 게이지만 / 다른 날 → 풀 재로드" 분기 구현.
     * 기본은 noop.
     */
    STL.onRelease = function (/* hours */) { /* noop */ };

})();
