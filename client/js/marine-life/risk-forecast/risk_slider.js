/**
 * ============================================================================
 * 파일명: client/js/marine-life/risk-forecast/risk_slider.js
 * 역할  : 서버 KST 시간축 배열을 기존 해양종합정보 슬라이더 모양으로 표시한다.
 *         해상 시트에서는 막대를 시각별 공식 사고 위험 단계 색으로 칠하고 눈금·범례·「지금」 꼬리표를 붙인다(2026-10-15 시안 8차).
 * [연계]
 *  - 사용하는 파일 : 같은 폴더 위험예측 모듈(RiskFormat.stamp) / OpenLayers(지도 모듈)
 *  - 서버 API      : /api/risk-forecast/* (routes/risk_forecast.js) — 색은 sea/analysis 의 marine.outlook.accident
 *  - 마크업        : index2.html #risk-forecast-sheet / #risk-forecast-legend
 *  - 나를 쓰는 곳  : risk_forecast.js 또는 index2.html / risk_forecast_preview.html
 * [로드 순서] risk_map_layer.js 다음 · risk_sheet.js 이전
 * ============================================================================
 */
(function (w) {
    'use strict';
    // 공식 사고 위험 4단계 색 — 시트 위 카드 뱃지·지도 위험 예측 범례(risk_forecast.css .rf-gradient-bar)와 같은 값.
    var RISK={'낮음':'#56a66f','보통':'#dbc753','주의':'#e58b46','경계':'#d64b45'},WD=['일','월','화','수','목','금','토'];
    /**
     * 서버 시간축을 슬라이더에 연결하고 ISO 시각 변경을 알린다. 말풍선 대신 슬라이더 위에 선택 시각을 고정 표시한다.
     * 예: mount(el,times,t,change) → 「'26.10.14(수) 15:00」
     *     mount(el,times,t,change,{now:meta.now,risk:true}) → 해상: 단계 색 막대·3시간 눈금·「지금」 꼬리표, 미래면 「… · 예보」
     * @param {HTMLElement} el - 시간축 영역; times는 ISO 배열, selected는 시트 selected.at, change는 콜백
     * @param {Object} [opts] - risk:true 면 해상 모양, now 는 서버 meta.now(「지금」 위치)
     * @returns {Object} set(value) 슬라이더 갱신 · levels(map) 단계 색 칠하기(해상만) API
     * [연계] RiskForecast → RiskFormat.stamp / 표시는 시트가 넘긴 selected와 슬라이더 값만 쓰고 메인 시각은 읽지 않는다(시간 격리)
     *        levels ← RiskForecast.detail(해상 분석 응답의 outlook.accident) — 응답 전에는 회색 막대
     */
    function mount(el, times, selected, change, opts) {
        opts=opts||{};
        if (opts.risk) return mountRisk(el, times, selected, change, opts);
        el.classList.remove('rf-risk-time');   // 해상 막대를 그린 뒤 같은 칸에 연안 막대를 그리면 해상용 투명 줄 스타일이 남던 결함(2026-10-15 독립 검토)
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
        return {set:function (value) { input.value=String(Math.max(0,times.indexOf(value))); paint(times[Number(input.value)]); }, levels:function(){}};
    }
    /**
     * 해상 시트 슬라이더를 그린다: 막대 = 칸마다 그 시각이 든 3시간 공식 사고 위험 단계 색, 3시간 눈금, 자정 굵은 눈금·날짜,
     * 6시간마다 「HH시」, 막대 위 가운데 4단계 범례, 「지금」 꼬리표(미래를 고르면 지금 자리에 파란 세로 눈금도).
     * 예: times=[16:12, 18:00, 21:00, 10.16 00:00 …], selected 내일 09시 → 「'26.10.16(금) 09:00 · 예보」
     * @param {HTMLElement} el - 시간축 영역 @param {string[]} times - ISO 배열 @param {string} selected - 시트 시각
     * @param {function} change - 시각 변경 콜백 @param {Object} opts - now(서버 지금)
     * @returns {Object} set·levels API
     * [연계] ← mount(opts.risk) / 단계 색은 levels() 로 나중에 받는다 — 모르는 칸은 회색으로 두고 지어내지 않는다.
     */
    function mountRisk(el, times, selected, change, opts) {
        var n=times.length,pos=function(i){return n>1?i/(n-1)*100:0;},nowIdx=times.indexOf(opts.now),known={};
        var kst=function(iso){var d=new Date(Date.parse(iso)+9*3600000);return{m:d.getUTCMonth()+1,d:d.getUTCDate(),h:d.getUTCHours(),mi:d.getUTCMinutes(),w:WD[d.getUTCDay()]};};
        var marks='',labs='';
        for(var j=0;j<n;j++){if(j===nowIdx)continue;var q=kst(times[j]);if(q.h%3||q.mi)continue;var day=q.h===0;
            marks+='<i class="'+(day?'day':'')+'" style="left:'+pos(j)+'%"></i>';
            if(day)labs+='<em class="day" style="left:'+pos(j)+'%">'+q.m+'.'+q.d+'('+q.w+')</em>';else if(q.h%6===0)labs+='<em style="left:'+pos(j)+'%">'+String(q.h).padStart(2,'0')+'시</em>';}
        el.innerHTML='<output class="rf-time-label" aria-live="off"></output>'
            +'<div class="rf-st-top">'+(nowIdx>=0?'<span class="rf-st-now" style="left:'+pos(nowIdx)+'%">지금</span>':'')+'<div class="rf-st-key">'+Object.keys(RISK).map(function(l){return '<span><i style="background:'+RISK[l]+'"></i>'+l+'</span>';}).join('')+'</div></div>'
            +'<div class="rf-st-wrap"><div class="rf-st-track"></div><div class="rf-st-marks">'+marks+'<i class="now" hidden style="left:'+pos(Math.max(0,nowIdx))+'%"></i></div>'
            +'<input class="ocean-sheet-slider" type="range" min="0" max="'+Math.max(0,n-1)+'" step="1" aria-label="시간 이동"><div class="rf-st-lab">'+labs+'</div></div>';
        el.classList.add('rf-risk-time');
        var input=el.querySelector('input'),label=el.querySelector('.rf-time-label'),track=el.querySelector('.rf-st-track'),nowMark=el.querySelector('.rf-st-marks i.now');
        input.value=String(Math.max(0,times.indexOf(selected)));
        /** 선택 시각 글자와 「지금」 눈금을 갱신한다. 예: 미래 → 「… · 예보」. 60초 갱신으로 지금이 몇 분 지나 열린 시트 시각이 지금보다 앞서도 미래로 보지 않는다
         * (서버 collisionNotice·RiskMarine.isNow 와 같은 「지금+60초 이하 = 지금」). @param {string} value - ISO @returns {void} [연계] ← 처음·input·set */
        function paint(value){var future=nowIdx>=0&&Date.parse(value)>Date.parse(opts.now)+60000,text=w.RiskFormat.stamp(value)+(future?' · 예보':'');label.textContent=text;input.setAttribute('aria-valuetext',text);nowMark.hidden=!(future&&nowIdx>=0);}
        /** 막대를 칸별 단계 색으로 칠한다. 예: {'1760490000000':'보통'} (3시간 칸 시작 ms → 단계). @returns {void} [연계] ← levels */
        function draw(){var seg='';for(var i=0;i<n-1;i++){var slot=Math.floor(Date.parse(times[i])/10800000)*10800000,lv=known[slot];seg+='<span'+(lv?' data-level="'+lv+'"':'')+' style="left:'+pos(i)+'%;width:'+(pos(i+1)-pos(i)+.3)+'%;background:'+(RISK[lv]||'#4a5a73')+'"></span>';}track.innerHTML=seg;}
        paint(times.indexOf(selected)<0&&selected?selected:times[Number(input.value)]);draw();
        input.addEventListener('input',function(){paint(times[Number(input.value)]);change(times[Number(input.value)]);});
        return {set:function(value){input.value=String(Math.max(0,times.indexOf(value)));paint(times[Number(input.value)]);},
            /** 공식 사고 예보 시각별 단계를 받아 막대를 칠한다. 예: levels([{forecastAt:'2026-10-15T15:00:00+09:00',level:'보통'}]) @param {Object[]} rows - outlook.accident @returns {void} */
            levels:function(rows){(rows||[]).forEach(function(r){var t=Date.parse(r&&r.forecastAt);if(Number.isFinite(t)&&RISK[r.level])known[Math.floor(t/10800000)*10800000]=r.level;});draw();}};
    }
    w.RiskSlider={mount:mount};
})(window);
