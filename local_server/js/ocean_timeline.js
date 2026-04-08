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

    /**
     * 타임라인 슬라이더를 초기화합니다.
     */
    window.initOceanTimeline = function () {
        if (initialized) return;
        initialized = true;

        var slider = document.getElementById('ocean-timeline-slider');
        var label = document.getElementById('ocean-timeline-label');
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

        // 슬라이더 이벤트
        slider.addEventListener('input', function () {
            var hours = parseInt(this.value);
            updateTimelineLabel(label, hours);
            onTimeChange(hours);
        });

        updateTimelineLabel(label, 0);
    };

    /**
     * 슬라이더 스텝을 변경합니다.
     * 조류=1h, 바람/파고=3h
     */
    window.setTimelineStep = function (step) {
        var slider = document.getElementById('ocean-timeline-slider');
        var label = document.getElementById('ocean-timeline-label');
        if (!slider) return;

        slider.step = step;

        // 현재 값을 스텝 경계에 맞게 스냅
        var cur = parseInt(slider.value);
        var snapped = Math.round(cur / step) * step;
        snapped = Math.max(0, Math.min(72, snapped));
        slider.value = snapped;
        updateTimelineLabel(label, snapped);
    };

    /**
     * 슬라이더 최대값을 동적으로 변경합니다.
     * zone-forecasts 응답의 maxForecastHours에 따라 호출됩니다.
     */
    window.setTimelineMax = function (max) {
        var slider = document.getElementById('ocean-timeline-slider');
        var label = document.getElementById('ocean-timeline-label');
        if (!slider) return;

        slider.max = max;

        // 현재값이 새 최대값을 초과하면 최대값으로 스냅
        var cur = parseInt(slider.value);
        if (cur > max) {
            var step = parseInt(slider.step) || 3;
            var snapped = Math.floor(max / step) * step;
            slider.value = snapped;
            updateTimelineLabel(label, snapped);
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
    function onTimeChange(hours) {
        if (window.oceanOverlaySetTime) {
            window.oceanOverlaySetTime(hours);
        }
    }

})();
