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
     * 시간 변경 시 오버레이 갱신
     */
    function onTimeChange(hours) {
        var targetTime = new Date();
        targetTime.setHours(targetTime.getHours() + hours);

        // ROMS 그리드를 해당 시간으로 다시 로드
        var map = window.getOceanMap ? window.getOceanMap() : null;
        if (!map) return;

        var view = map.getView();
        var extent = view.calculateExtent(map.getSize());
        var bl = ol.proj.toLonLat([extent[0], extent[1]]);
        var tr = ol.proj.toLonLat([extent[2], extent[3]]);

        fetch('/api/ocean/roms-grid?ymin=' + bl[1].toFixed(2) +
            '&ymax=' + tr[1].toFixed(2) +
            '&xmin=' + bl[0].toFixed(2) +
            '&xmax=' + tr[0].toFixed(2) +
            '&time=' + targetTime.toISOString())
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success && window.oceanOverlayRefresh) {
                    window.oceanOverlayRefresh(map);
                }
            })
            .catch(function () { });
    }

})();
