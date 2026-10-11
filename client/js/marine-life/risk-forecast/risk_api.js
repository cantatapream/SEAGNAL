/**
 * ============================================================================
 * 파일명: client/js/marine-life/risk-forecast/risk_api.js
 * 역할  : 위험예측 API의 응답을 제한 시간 안에 받고 입력 시각별로 캐시한다.
 * [연계]
 *  - 사용하는 파일 : 같은 폴더 위험예측 모듈 / OpenLayers(지도 모듈)
 *  - 서버 API      : /api/risk-forecast/* (routes/risk_forecast.js)
 *  - 마크업        : index2.html #risk-forecast-sheet / #risk-forecast-legend
 *  - 나를 쓰는 곳  : risk_forecast.js 또는 index2.html / risk_forecast_preview.html
 * [로드 순서] risk_format.js 다음 · risk_map_layer.js 이전
 * ============================================================================
 */
(function (w) {
    'use strict';
    /**
     * 제한 시간·경로별 TTL을 갖는 API 클라이언트를 만든다.
     * 예: RiskAPI.create().get('meta')
     * @param 없음
     * @returns {Object} get(path, params, fresh)·clear() API
     * [연계] RiskForecast.mount → fetch /api/risk-forecast/*
     */
    function create() {
        var cache = new Map(), pending = new Map();
        async function get(path, params, fresh) {
            var q = new URLSearchParams(params || {});
            var url = '/api/risk-forecast/' + path + (q.size ? '?' + q : '');
            var ttl=/^(coast\/spots|islands)$/.test(path)?86400000:path==='sea/cells'?3600000:path==='status'?0:60000;
            var cached=cache.get(url);
            if (!fresh && cached && Date.now()-cached.at<ttl) return cached.value;
            if (!fresh && pending.has(url)) return pending.get(url);
            var p = (async function () {
                var c = new AbortController(), timer = setTimeout(function () { c.abort(); },15000);
                try {
                    var r = await fetch(url, {signal:c.signal}), j = await r.json();
                    if (!r.ok || j.ok === false) {var error=new Error(j.error || 'HTTP ' + r.status);error.status=r.status;throw error;}
                    cache.set(url,{value:j,at:Date.now()});
                    if (cache.size > 150) cache.delete(cache.keys().next().value);
                    return j;
                } finally { clearTimeout(timer); pending.delete(url); }
            })();
            pending.set(url,p); return p;
        }
        return {get:get, clear:function () { cache.clear(); }};
    }
    w.RiskAPI = {create:create};
})(window);
