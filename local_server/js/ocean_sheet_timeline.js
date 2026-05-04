/**
 * ============================================================================
 * 파일명: js/ocean_sheet_timeline.js
 * 역할: 해양종합정보 바텀시트 내부의 시간 이동 슬라이더
 * ============================================================================
 *
 * [위치]
 *   바텀시트 헤더의 양력 날짜(예: '26.5.5.(화) 07:42) 바로 아래.
 *   기존 음력 표기가 있던 자리(.ocean-sheet-subrow) 안.
 *
 * [시간 매핑 정책 — 사용자 합의 (안 A)]
 *   슬라이더 step = 3시간
 *
 *   value = 0  → 진짜 현재 시각 (Date.now() 호출 시점, 분/초 그대로)
 *   value = 3  → 현재 시각 + 3시간   ← 정확히 +3h 후 (분/초 보존)
 *   value = 6  → 현재 시각 + 6시간
 *   value = 9  → 현재 시각 + 9시간
 *   ...
 *
 *   예: 현재 시각이 08:00:00 라면
 *     value=0  → 08:00  (real now)
 *     value=3  → 11:00  (08:00 + 3h)
 *     value=6  → 14:00  (08:00 + 6h)
 *     value=9  → 17:00  (08:00 + 9h)
 *
 *   레이어 슬라이더(ocean_timeline.js)도 동일 좌표계 (value = 지금 + N*h) 사용 →
 *   시트와 레이어가 정확히 같은 시각을 표시. step 차이만 round 영향.
 *
 *   조석 게이지/예상조위 라벨도 dateObj 시각 그대로 사용 → 슬라이더와 동일 시각 표시.
 *   조석은 분 단위 보간이 가능해 어떤 시각이든 정확.
 *   KMA wave/wind 데이터는 backend 가 가장 가까운 frame (예: 11:00 → 12:00 frame)으로 매핑.
 *
 * [자정 눈금]
 *   "지금 + N*h" 가 자정(00:00)이 되는 N 위치에 짧은 세로 막대 (텍스트 없음).
 *   N 은 step=3 격자에 안 떨어질 수 있지만(예: now=08:30 이면 다음 자정 v=15.5)
 *   시각적 막대 위치만 의미하므로 무관 (사용자가 그 위치에 손잡이 못 멈춤).
 *
 * [말풍선]
 *   천기 슬라이더와 동일 패턴 — viewport clamp + 화살표 추적 + 1초 fade-out.
 *   텍스트: "'26. 5. 5.(화) 07:42" 형식.
 *
 * [갱신 정책]
 *   드래그 중 (input)        : 헤더 양력/음력 텍스트 + 말풍선 텍스트만 갱신. API 호출 X.
 *   드래그 종료 (change)     : STL.onRelease(hours, sameDay, newDate) 콜백 발화.
 *                              ocean_bottom_sheet2.js 가 wire — 같은 날 → 게이지 partial /
 *                              다른 날 → loadAllForDate 풀 재로드.
 *
 * [외부 API — window.OceanSheet.SheetTL]
 *   STL.init(initialLayerHours, zoneMaxHours)  : 시트 오픈 시 호출
 *   STL.setMaxHours(zoneMaxHours)              : zone-forecasts 응답 수신 시 호출
 *   STL.setHours(hours)                        : 외부에서 슬라이더 값 강제 설정
 *   STL.syncToStateDate()                      : OS.state.date → 슬라이더 value 동기 (◀/▶ 후)
 *   STL.getHours()                             : 현재 슬라이더 값
 *   STL.getCurrentDate()                       : 현재 슬라이더가 가리키는 Date 객체
 *   STL.setVisible(boolean)                    : 슬라이더 wrap 표시/숨김
 *   STL.isVisible()                            : 현재 표시 상태
 *   STL.teardown()                             : 시트 닫을 때 호출 — 말풍선 정리
 *
 * [외부 콜백 — 호출자가 덮어씌움]
 *   STL.onRelease(hours, sameDay, newDate)     : 손잡이 놓는 순간 호출
 *
 * [의존]
 *   - window.OceanSheet (OS): OS.state, OS.renderHeader
 *   - DOM: #ocean-sheet-slider-wrap, #ocean-sheet-slider, #ocean-sheet-tooltip, #ocean-sheet-ticks
 * ============================================================================
 */

(function () {
    'use strict';

    var OS = window.OceanSheet = window.OceanSheet || {};
    var STL = OS.SheetTL = OS.SheetTL || {};

    // ── 내부 상태 ─────────────────────────────────────────────
    /** zone-forecasts 응답으로 받은 wave/wind maxForecastHours. 슬라이더 max 의 기반. */
    var _zoneMaxHours = 0;
    /** 슬라이더 max — _zoneMaxHours 를 3 단위로 floor 한 값. 0 이면 슬라이더 비활성. */
    var _maxHours = 0;
    /** 말풍선 fade-out 타이머 핸들. */
    var _fadeTimer = null;
    /** 이벤트 바인딩 idempotent 처리. */
    var _bound = false;
    /** 마지막 정착(release/init/sync) 시점 슬라이더 시각의 날짜 키 (YYYY-M-D).
     *  같은 날 판정용. 드래그 중 OS.state.date 가 매번 변하므로 별도 추적 필요. */
    var _lastSettledDayKey = '';
    /** 한국어 요일. */
    var WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];

    // ── 유틸 ─────────────────────────────────────────────────
    function $(id) { return document.getElementById(id); }

    /**
     * 슬라이더 value 가 표현하는 시각 (epoch ms) 계산.
     *
     * 정책 안 A: value = N → Date.now() + N*h (모든 N).
     * 분/초 그대로 보존. 시트와 레이어 슬라이더가 동일 좌표계.
     *
     * @param {number} v - 슬라이더 value (0, 3, 6, 9, ...)
     * @param {number} [nowMs] - 명시적 nowMs. 미지정 시 Date.now() 호출.
     * @returns {number} 표시 시각의 epoch ms
     */
    function displayTimeMs(v, nowMs) {
        var n = (typeof nowMs === 'number') ? nowMs : Date.now();
        return n + v * 3600000;
    }

    /**
     * _zoneMaxHours 로부터 슬라이더 max 계산 (3 단위 floor).
     * 새 정책에선 firstFrame 오프셋이 없어 단순.
     */
    function computeMaxFromZone() {
        if (_zoneMaxHours <= 0) return 0;
        return Math.max(0, Math.floor(_zoneMaxHours / 3) * 3);
    }

    /**
     * 레이어 슬라이더 hours (0~max, "지금으로부터 N시간") → 시트 슬라이더 value 변환.
     *
     * 정책 안 A: 시트와 레이어 좌표계 동일 (둘 다 "지금 + N*h").
     * 단순 round to step=3 + max clamp.
     */
    function sheetValueFromLayerHours(lh) {
        var v = Math.round((lh || 0) / 3) * 3;
        return Math.max(0, Math.min(_maxHours, v));
    }

    // ── 자정 눈금 ────────────────────────────────────────────
    /**
     * 슬라이더 트랙 위 "자정 (00:00)" 위치들의 v 값 배열.
     *
     * 정책 안 A 에선 v = (target_time - now) / h.
     * 다음 자정 = 오늘 24:00. v 는 분 포함 실수 가능 (slider step=3 격자에 안 떨어질 수 있지만
     * 시각적 막대 위치로만 사용 — 손잡이는 그 위치에 못 멈춤).
     *
     * 예: now=08:00:00 → 다음 자정 = +16h → v=16 (66% 위치 / max=72 일 때)
     * 예: now=08:30:00 → 다음 자정 = +15.5h → v=15.5
     *
     * 24h 마다 자정. _maxHours 안에서 모두 표시.
     */
    function computeMidnightTickValues() {
        var arr = [];
        if (_maxHours <= 0) return arr;
        var now = Date.now();
        // 다음 자정 (오늘 24:00 = 내일 00:00)
        var nextMidnight = new Date(now);
        nextMidnight.setHours(24, 0, 0, 0);
        // 자정에 해당하는 v (실수 가능)
        var firstV = (nextMidnight.getTime() - now) / 3600000;
        for (var v = firstV; v <= _maxHours; v += 24) {
            if (v > 0) arr.push(v);
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
        var values = computeMidnightTickValues();
        ticksEl.innerHTML = values.map(function (v) {
            var pct = (v / _maxHours) * 100;
            return '<div class="ocean-sheet-tick" style="left:' + pct.toFixed(2) + '%"></div>';
        }).join('');
    }

    // ── 말풍선 ───────────────────────────────────────────────
    /**
     * 손잡이 위에 말풍선 위치/텍스트 갱신.
     * 천기/타임라인 슬라이더와 동일한 viewport clamping + 화살표 분리 패턴.
     * 폰트 크기 변경 시: getBoundingClientRect() 매번 측정 → 자동 reflow.
     */
    function updateTooltip() {
        var tip = $('ocean-sheet-tooltip');
        var slider = $('ocean-sheet-slider');
        if (!tip || !slider) return;

        var v = parseFloat(slider.value) || 0;
        var ms = displayTimeMs(v);
        var d = new Date(ms);

        // 텍스트: "'26. 5. 5.(화) 07:42"
        var yy = String(d.getFullYear()).slice(-2);
        var hh = String(d.getHours()).padStart(2, '0');
        var mi = String(d.getMinutes()).padStart(2, '0');
        tip.textContent =
            "'" + yy + ". " + (d.getMonth() + 1) + ". " + d.getDate() + ".(" +
            WEEKDAYS_KO[d.getDay()] + ") " + hh + ':' + mi;

        // reset (정확한 width 측정 위해)
        tip.style.left = '0px';

        // thumb viewport 절대 좌표
        var sliderRect = slider.getBoundingClientRect();
        var min = parseFloat(slider.min) || 0;
        var max = parseFloat(slider.max) || 0;
        var pct = (max > min) ? (v - min) / (max - min) : 0;
        var thumbHalf = 7;
        var thumbXVp = sliderRect.left + thumbHalf + pct * (sliderRect.width - thumbHalf * 2);

        // 말풍선 측정 (텍스트 변경 후 재측정 → 폰트 크기 자동 반영)
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

        // 화살표 — clamping 됐어도 thumb 방향
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
        OS.state.date = new Date(displayTimeMs(v));
        if (typeof OS.renderHeader === 'function') OS.renderHeader();
    }

    // ── 이벤트 바인딩 (idempotent) ──────────────────────────────
    /** 슬라이더 input/change/touch/pointer 이벤트 바인딩. 한 번만. */
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

        // 드래그 종료 — release 콜백 발화
        slider.addEventListener('change', function () {
            startFadeOut();
            var v = parseFloat(slider.value) || 0;
            var newDate = STL.getCurrentDate();
            var newKey = _dayKey(newDate);
            var sameDay = (newKey === _lastSettledDayKey);
            _lastSettledDayKey = newKey;
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
     * 시트 오픈 시 호출. 슬라이더 활성화 + 초기 위치 + 헤더 동기.
     *
     * @param {number} initialLayerHours - 레이어 슬라이더의 현재 value (0~72).
     * @param {number} zoneMaxHours      - wave/wind maxForecastHours.
     */
    STL.init = function (initialLayerHours, zoneMaxHours) {
        var slider = $('ocean-sheet-slider');
        var wrap   = $('ocean-sheet-slider-wrap');
        if (!slider || !wrap) return;

        // 1) max 결정
        _zoneMaxHours = zoneMaxHours || 0;
        _maxHours = computeMaxFromZone();

        // 2) max=0 (예보 데이터 없음) → 슬라이더 자체 숨김
        if (_maxHours <= 0) {
            wrap.classList.add('is-hidden');
            slider.disabled = true;
            slider.max = 0;
            slider.value = 0;
            return;
        }

        // 3) 슬라이더 활성화 + 속성 갱신
        wrap.classList.remove('is-hidden');
        slider.disabled = false;
        slider.min = 0;
        slider.max = _maxHours;
        slider.step = 3;

        // 4) 초기값 = 레이어 슬라이더 값 → 시트 슬라이더 value 변환
        slider.value = sheetValueFromLayerHours(initialLayerHours || 0);

        // 5) 자정 눈금 렌더
        renderTicks();

        // 6) 이벤트 바인딩 (한 번만)
        bindEvents();

        // 7) 헤더 동기 — 슬라이더 시각 → OS.state.date → renderHeader
        //    value=0 이면 OS.state.date = real now, 헤더에 "07:42" 표시.
        syncHeaderToSlider();

        // 8) "마지막 정착 날짜" 캡처
        _lastSettledDayKey = _dayKey(STL.getCurrentDate());
    };

    /**
     * zone-forecasts 응답 도착 시 max 갱신.
     * value 가 새 max 너머면 max 로 클램프 + onRelease 자동 발화 (인자 모두 채워서).
     */
    STL.setMaxHours = function (zoneMaxHours) {
        var slider = $('ocean-sheet-slider');
        var wrap   = $('ocean-sheet-slider-wrap');
        if (!slider || !wrap) return;

        _zoneMaxHours = zoneMaxHours || 0;
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
            slider.value = _maxHours;
            syncHeaderToSlider();
            // onRelease 시그너처 (hours, sameDay, newDate) 전부 채워야 NPE 방지
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

    /** 외부에서 슬라이더 값 강제 설정 (이벤트 발화 X). */
    STL.setHours = function (hours) {
        var slider = $('ocean-sheet-slider');
        if (!slider) return;
        var v = Math.max(0, Math.min(_maxHours, Math.round((hours || 0) / 3) * 3));
        slider.value = v;
        syncHeaderToSlider();
        updateTooltip();
    };

    /**
     * OS.state.date 시각 → 슬라이더 value 동기.
     * 사용 예: ◀/▶ 로 OS.state.date 가 ±24h 변경됐을 때 슬라이더 손잡이 위치도 따라가야 함.
     *
     * 정책 안 A: 단순 (state.date - now) / h 계산 후 step=3 round + max clamp.
     * ◀/▶ 가 +24h 단위라 v 도 24h 만큼 이동 (24%3=0 이라 격자 정확히 떨어짐).
     */
    STL.syncToStateDate = function () {
        var slider = $('ocean-sheet-slider');
        if (!slider || !OS.state || !OS.state.date) return;
        var deltaH = (OS.state.date.getTime() - Date.now()) / 3600000;
        var v = Math.round(deltaH / 3) * 3;
        v = Math.max(0, Math.min(_maxHours, v));
        slider.value = v;
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
        return new Date(displayTimeMs(v));
    };

    /**
     * 슬라이더 wrap 표시/숨김. 예보 범위 외 날짜 진입 시 호출.
     * _maxHours == 0 일 때는 visible=true 호출돼도 강제 숨김 유지.
     */
    STL.setVisible = function (visible) {
        var wrap = $('ocean-sheet-slider-wrap');
        if (!wrap) return;
        if (visible && _maxHours > 0) wrap.classList.remove('is-hidden');
        else wrap.classList.add('is-hidden');
    };

    /** 슬라이더가 현재 표시되어 있는지. */
    STL.isVisible = function () {
        var wrap = $('ocean-sheet-slider-wrap');
        return !!(wrap && !wrap.classList.contains('is-hidden'));
    };

    /** 시트 닫을 때 호출 — 말풍선 즉시 제거. */
    STL.teardown = function () {
        clearTimeout(_fadeTimer);
        var tip = $('ocean-sheet-tooltip');
        if (tip) tip.classList.remove('visible');
    };

    /**
     * 손잡이 놓는 순간 호출되는 콜백. ocean_bottom_sheet2.js 가 덮어씌움.
     * 기본 noop.
     */
    STL.onRelease = function (/* hours, sameDay, newDate */) { /* noop */ };

})();
