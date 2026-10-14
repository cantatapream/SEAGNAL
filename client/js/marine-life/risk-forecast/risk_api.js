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
            var ttl=/^(coast\/spots|islands|sea\/jurisdictions)$/.test(path)?86400000:/^sea\/(?:cells|unified-cells)$/.test(path)?3600000:path==='status'?0:60000;
            var cached=cache.get(url);
            if (!fresh && cached && Date.now()-cached.at<ttl) return cached.value;
            if (!fresh && pending.has(url)) return pending.get(url);
            var p = (async function () {
                for(var attempt=0;attempt<3;attempt++){
                    var c=new AbortController(),timer=setTimeout(function(){c.abort();},15000);
                    try{
                        var r=await fetch(url,{signal:c.signal,cache:fresh||attempt?'no-store':'default'}),j=await r.json();
                        if(!r.ok||j.ok===false){var error=new Error(j.error||'HTTP '+r.status);error.status=r.status;throw error;}
                        cache.set(url,{value:j,at:Date.now()});
                        // 전국 프레임은 최근8시각만 유지한다. 비정상 응답은 저장하지 않는다.
                        if(path==='sea/unified-frame'){var frames=Array.from(cache.keys()).filter(function(k){return k.includes('/sea/unified-frame?');});while(frames.length>8)cache.delete(frames.shift());}
                        if(cache.size>150)cache.delete(cache.keys().next().value);return j;
                    }catch(e){
                        // Wi-Fi 전환·일시 연결 중단은 짧게 재시도, 사용자 입력 오류/잘못된 JSON은 즉시 반환.
                        var retry=e.name==='TypeError'||e.name==='AbortError'||e.status>=500;
                        if(!retry||attempt===2)throw e;
                        await new Promise(function(resolve){setTimeout(resolve,attempt?900:300);});
                    }finally{clearTimeout(timer);}
                }
            })();
            pending.set(url,p);try{return await p;}finally{if(pending.get(url)===p)pending.delete(url);}
        }
        return {get:get, clear:function () { cache.clear(); }};
    }
    w.RiskAPI = {create:create};
})(window);
