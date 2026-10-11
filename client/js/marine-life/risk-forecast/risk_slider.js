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
     * 서버 시간축을 슬라이더에 연결하고 ISO 시각 변경을 알린다.
     * 예: mount(el,times,t,change)
     * @param {HTMLElement} el - 시간축 영역; times는 ISO 배열, selected는 선택 ISO, change는 콜백
     * @returns {Object} set(value) 슬라이더 갱신 API
     * [연계] RiskForecast → RiskFormat.time
     */
    function mount(el, times, selected, change) {
        el.innerHTML = '<div class="ocean-sheet-slider-wrap"><div class="rf-divider-track"></div><input class="ocean-sheet-slider" type="range" min="0" max="' + Math.max(0,times.length-1) + '" step="1" aria-label="시간 이동"><div class="ocean-sheet-tooltip"></div></div>';
        var input = el.querySelector('input'), tip = el.querySelector('.ocean-sheet-tooltip'), dividers = el.querySelector('.rf-divider-track');
        input.value = String(Math.max(0,times.indexOf(selected)));
        for (var i=1; i<times.length; i++) if (times[i].slice(0,10) !== times[i-1].slice(0,10)) {
            var marker=document.createElement('span'); marker.className='ocean-sheet-divider'; marker.style.left=(i / Math.max(1,times.length-1)*100)+'%'; dividers.appendChild(marker);
        }
        function paint() {
            var n = Number(input.value), p = n / Math.max(1,times.length-1);
            tip.textContent = w.RiskFormat.time(times[n]); input.setAttribute('aria-valuetext', tip.textContent);
            // ocean_sheet_timeline.js의 말풍선 제한 방식: 양끝 안에 상자를 두고 화살표는 손잡이를 따른다.
            var width = input.clientWidth, tw = tip.offsetWidth || 145, pos = 8 + p * Math.max(0,width-16);
            var left = Math.max(0,Math.min(Math.max(0,width-tw),pos-tw/2));
            tip.style.left=left+'px'; tip.style.transform='none'; tip.style.setProperty('--arrow-left',(pos-left)+'px');
        }
        var hideTimer;
        function showTip() { clearTimeout(hideTimer);tip.classList.add('visible');paint(); }
        function hideTip() { clearTimeout(hideTimer);hideTimer=setTimeout(function(){tip.classList.remove('visible');},1000); }
        input.addEventListener('pointerdown',showTip);
        input.addEventListener('pointerup',hideTip);
        input.addEventListener('pointercancel',hideTip);
        input.addEventListener('blur',hideTip);
        input.addEventListener('input',function () { showTip();change(times[Number(input.value)]); });
        input.addEventListener('change',hideTip);
        requestAnimationFrame(paint);
        return {set:function (value) { input.value=String(Math.max(0,times.indexOf(value))); paint(); }};
    }
    w.RiskSlider={mount:mount};
})(window);
