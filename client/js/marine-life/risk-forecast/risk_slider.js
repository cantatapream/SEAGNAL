/**
 * ============================================================================
 * 파일명: client/js/marine-life/risk-forecast/risk_slider.js
 * 역할  : 서버 KST 시간축 배열을 기존 해양종합정보 슬라이더 모양으로 표시한다.
 * [연계]
 *  - 사용하는 파일 : 같은 폴더 위험예측 모듈 / OpenLayers(지도 모듈)
 *  - 서버 API      : /api/risk-forecast/* (routes/risk_forecast.js)
 *  - 마크업        : index2.html #risk-forecast-sheet / #risk-forecast-legend
 *  - 나를 쓰는 곳  : risk_forecast.js 또는 index2.html / risk_forecast_preview.html
 * [로드 순서] risk_map_layer.js 다음 · risk_sheet.js 이전
 * ============================================================================
 */
(function (w) {
    'use strict';
    /**
     * 서버 시간축을 슬라이더에 연결하고 ISO 시각 변경을 알린다. 말풍선 대신 슬라이더 위에 선택 시각을 고정 표시한다.
     * 예: mount(el,times,t,change) → 「'26.10.14(수) 15:00」
     * @param {HTMLElement} el - 시간축 영역; times는 ISO 배열, selected는 시트 selected.at, change는 콜백
     * @returns {Object} set(value) 슬라이더 갱신 API
     * [연계] RiskForecast → RiskFormat.stamp / 표시는 시트가 넘긴 selected와 슬라이더 값만 쓰고 메인 시각은 읽지 않는다(시간 격리)
     */
    function mount(el, times, selected, change) {
        el.innerHTML = '<output class="rf-time-label" aria-live="off"></output><div class="ocean-sheet-slider-wrap"><div class="rf-divider-track"></div><input class="ocean-sheet-slider" type="range" min="0" max="' + Math.max(0,times.length-1) + '" step="1" aria-label="시간 이동"></div>';
        var input = el.querySelector('input'), label = el.querySelector('.rf-time-label'), dividers = el.querySelector('.rf-divider-track');
        input.value = String(Math.max(0,times.indexOf(selected)));
        for (var i=1; i<times.length; i++) if (times[i].slice(0,10) !== times[i-1].slice(0,10)) {
            var marker=document.createElement('span'); marker.className='ocean-sheet-divider'; marker.style.left=(i / Math.max(1,times.length-1)*100)+'%'; dividers.appendChild(marker);
        }
        // 선택 시각이 새 시간축에 없으면(날짜 경과) 손잡이는 처음 칸이지만 상세는 selected 시각이므로 표시도 selected를 따른다.
        function paint(value) { var text = w.RiskFormat.stamp(value); label.textContent = text; input.setAttribute('aria-valuetext', text); }
        paint(times.indexOf(selected) < 0 && selected ? selected : times[Number(input.value)]);
        input.addEventListener('input',function () { paint(times[Number(input.value)]); change(times[Number(input.value)]); });
        return {set:function (value) { input.value=String(Math.max(0,times.indexOf(value))); paint(times[Number(input.value)]); }};
    }
    w.RiskSlider={mount:mount};
})(window);
