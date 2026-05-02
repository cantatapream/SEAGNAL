/**
 * ============================================================================
 * 파일명: js/ocean_timeline.js
 * 역할: 해양현황 타임라인 슬라이더 (72시간 예측)
 * ============================================================================
 *
 * [설명]
 * 모드 B(해양현황)에서 하단 타임라인 슬라이더를 통해
 * 72시간 예측 데이터의 시간을 선택할 수 있습니다.
 *
 * [연계 파일]
 * - ocean_map.js → initOceanTimeline() 호출
 * - ocean_overlay.js → 시간 변경 시 오버레이 갱신
 * - index.html → #ocean-timeline, #ocean-timeline-slider
 * ============================================================================
 */

(function () {
    'use strict';

    let initialized = false;

    // 말풍선 fade-out 타이머 핸들
    var _fadeTimer = null;

    /**
     * 슬라이더 손잡이 바로 위에 말풍선을 위치시키고 텍스트를 갱신합니다.
     *
     * thumb 중심 x = 9 + pct × (trackWidth - 18)   (thumb 반지름 = 9px)
     */
    function updateTooltip(hours) {
        var tooltip = document.getElementById('ocean-timeline-tooltip');
        var slider  = document.getElementById('ocean-timeline-slider');
        if (!tooltip || !slider) return;

        // 텍스트 생성: 0h → "현재", 그 외 → "4.10.(금) 08:00" 형식
        var text;
        if (hours === 0) {
            text = '현재';
        } else {
            var DAYS = ['일', '월', '화', '수', '목', '금', '토'];
            var future = new Date(new Date().getTime() + hours * 60 * 60 * 1000);
            var mo  = future.getMonth() + 1;
            var dd  = future.getDate();
            var day = DAYS[future.getDay()];
            var hh  = String(future.getHours()).padStart(2, '0');
            text = mo + '.' + dd + '.(' + day + ') ' + hh + ':00';
        }
        tooltip.textContent = text;

        // thumb 중심 x 계산
        var min = parseFloat(slider.min) || 0;
        var max = parseFloat(slider.max) || 72;
        var val = parseFloat(slider.value) || 0;
        var pct = (val - min) / (max - min || 1);
        var trackW = slider.getBoundingClientRect().width;
        var thumbHalf = 9; // thumb 반지름 (18px / 2)
        var left = thumbHalf + pct * (trackW - thumbHalf * 2);
        tooltip.style.left = left + 'px';
    }

    /** 말풍선을 즉시 표시합니다. 진행 중인 fade-out 타이머는 취소합니다. */
    function showTooltip() {
        var tooltip = document.getElementById('ocean-timeline-tooltip');
        if (!tooltip) return;
        clearTimeout(_fadeTimer);
        tooltip.classList.add('visible');
    }

    /**
     * 1초 후 말풍선을 숨깁니다.
     * CSS에서 visible 제거 시 transition: opacity 1s ease 가 적용됩니다.
     */
    function startFadeOut() {
        clearTimeout(_fadeTimer);
        _fadeTimer = setTimeout(function () {
            var tooltip = document.getElementById('ocean-timeline-tooltip');
            if (tooltip) tooltip.classList.remove('visible');
        }, 1000);
    }

    /**
     * 타임라인 슬라이더를 초기화합니다.
     */
    window.initOceanTimeline = function () {
        if (initialized) return;
        initialized = true;

        var slider = document.getElementById('ocean-timeline-slider');
        var label = document.getElementById('ocean-timeline-label'); // 제거된 요소 — null 허용
        var ticksEl = document.getElementById('ocean-timeline-ticks');
        if (!slider) return;

        // 눈금 생성 (6시간 간격)
        if (ticksEl) {
            var ticks = '';
            for (var h = 0; h <= 72; h += 6) {
                var pct = (h / 72) * 100;
                var tickLabel = h === 0 ? '현재' : '+' + h + 'h';
                ticks += '<div class="ocean-tick" style="left:' + pct + '%"><span>' + tickLabel + '</span></div>';
            }
            ticksEl.innerHTML = ticks;
        }

        // 드래그 시작: 말풍선 표시
        slider.addEventListener('mousedown', function () {
            updateTooltip(parseInt(this.value) || 0);
            showTooltip();
        });
        slider.addEventListener('touchstart', function () {
            updateTooltip(parseInt(this.value) || 0);
            showTooltip();
        }, { passive: true });

        // 값 변경 중: 말풍선 위치·텍스트 갱신 + 데이터 갱신
        slider.addEventListener('input', function () {
            var hours = parseInt(this.value);
            updateTooltip(hours);
            showTooltip(); // 드래그 중 fade-out 타이머 리셋
            updateTimelineLabel(label, hours); // label=null 이면 내부에서 조용히 반환
            onTimeChange(hours);
        });

        // 드래그 종료: 1초 후 fade-out
        slider.addEventListener('mouseup',   function () { startFadeOut(); });
        slider.addEventListener('touchend',  function () { startFadeOut(); });

        updateTimelineLabel(label, 0);
    };

    /**
     * 슬라이더 스텝을 변경합니다.
     * 조류=1h, 바람/파고=3h
     */
    window.setTimelineStep = function (step) {
        var slider = document.getElementById('ocean-timeline-slider');
        if (!slider) return;

        slider.step = step;

        // 현재 값을 스텝 경계에 맞게 스냅
        var cur = parseInt(slider.value);
        var snapped = Math.round(cur / step) * step;
        snapped = Math.max(0, Math.min(parseInt(slider.max) || 72, snapped));
        slider.value = snapped;
        updateTimelineLabel(null, snapped); // label 제거됨 — null 전달
    };

    /**
     * 슬라이더 최대값을 동적으로 변경합니다.
     * zone-forecasts 응답의 maxForecastHours에 따라 호출됩니다.
     */
    window.setTimelineMax = function (max) {
        var slider = document.getElementById('ocean-timeline-slider');
        if (!slider) return;

        slider.max = max;

        // 현재값이 새 최대값을 초과하면 최대값으로 스냅
        var cur = parseInt(slider.value);
        if (cur > max) {
            var step = parseInt(slider.step) || 3;
            var snapped = Math.floor(max / step) * step;
            slider.value = snapped;
            updateTimelineLabel(null, snapped); // label 제거됨 — null 전달
            onTimeChange(snapped);
        }

        // 눈금 재생성
        var ticksEl = document.getElementById('ocean-timeline-ticks');
        if (ticksEl) {
            var ticks = '';
            var step2 = parseInt(slider.step) || 3;
            var interval = max <= 24 ? step2 : 6;
            if (interval < step2) interval = step2;
            for (var h = 0; h <= max; h += interval) {
                var pct = (h / max) * 100;
                var tickLabel = h === 0 ? '현재' : '+' + h + 'h';
                ticks += '<div class="ocean-tick" style="left:' + pct + '%"><span>' + tickLabel + '</span></div>';
            }
            ticksEl.innerHTML = ticks;
        }
    };

    /**
     * 타임라인 라벨 업데이트
     */
    function updateTimelineLabel(label, hours) {
        if (!label) return;

        if (hours === 0) {
            label.textContent = '현재';
        } else {
            var now = new Date();
            var future = new Date(now.getTime() + hours * 60 * 60 * 1000);
            var m = future.getMonth() + 1;
            var d = future.getDate();
            var h = future.getHours();
            label.textContent = m + '/' + d + ' ' + String(h).padStart(2, '0') + ':00 (+' + hours + 'h)';
        }
    }

    /**
     * 시간 변경 시 오버레이 데이터 재로드.
     * 활성 오버레이(조류/바람/파고)의 API를 새 시간으로 다시 호출한다.
     *   조류  → /api/ocean/khoa-stream-vector?date=YYYYMMDD&hour=HH
     *   바람/파고 → /api/ocean/zone-forecasts?time=ISO
     */
    /**
     * 슬라이더 값 변경 시 호출 — 의존 모듈에 시각 변경 알림.
     *
     * 호출 대상:
     *   1) window.oceanOverlaySetTime(hours): 지도 overlay (current/wind/wave) 시각 갱신
     *   2) window.OceanSheet.onTimelineChanged(hours): 바텀시트 헤더 시각 표시 갱신
     *      (시트가 닫혀있으면 OceanSheet 가 자체적으로 무시 — 안전)
     *
     * @param {number} hours - 슬라이더 값 (0~72, 현재시각으로부터 시간)
     */
    function onTimeChange(hours) {
        if (window.oceanOverlaySetTime) {
            window.oceanOverlaySetTime(hours);
        }
        // 바텀시트 헤더 — 시각 표시 동기 (천기 카드 등 추후 추가될 시각 의존 데이터도 자동 반영)
        if (window.OceanSheet && typeof window.OceanSheet.onTimelineChanged === 'function') {
            window.OceanSheet.onTimelineChanged(hours);
        }
    }

})();
