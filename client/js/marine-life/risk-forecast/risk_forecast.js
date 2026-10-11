/**
 * ============================================================================
 * 파일명: client/js/marine-life/risk-forecast/risk_forecast.js
 * 역할  : 해양안전의 위험예측 버튼·두 층·서버 시각·지도와 바텀시트를 함께 조율한다.
 * [연계]
 *  - 사용하는 파일 : 같은 폴더 위험예측 모듈 / OpenLayers(지도 모듈)
 *  - 서버 API      : /api/risk-forecast/* (routes/risk_forecast.js)
 *  - 마크업        : index2.html #risk-forecast-sheet / #risk-forecast-legend
 *  - 나를 쓰는 곳  : risk_forecast.js 또는 index2.html / risk_forecast_preview.html
 * [로드 순서] risk_basis.js 다음 · life_safety.js 이전
 * ============================================================================
 */
(function (w) {
    'use strict';
    /**
     * 진단 로그에는 원천 URL·응답 본문 대신 오류 종류와 HTTP 상태만 넣는다.
     * 예: failureInfo(new TypeError('private URL')) → {name:'TypeError',status:null}
     * @param {Error} error - 실패한 요청 또는 지도 처리 오류
     * @returns {Object} 허용된 오류 이름과 숫자 HTTP 상태
     * [연계] 아래 요청 catch → console.warn
     */
    function failureInfo(error){return {name:['Error','TypeError','SyntaxError','AbortError'].includes(error&&error.name)?error.name:'Error',status:error&&Number.isInteger(error.status)&&error.status>=100&&error.status<=599?error.status:null};}
    /**
     * API·지도·스위치·슬라이더·상세 시트의 상태를 조율한다.
     * 예: RiskForecast.mount({map,sheetEl,legendEl,bannerEl})
     * @param {Object} options - 지도·시트·범례·배너·초기 enabled
     * @returns {Object} ready·setEnabled·select·refresh·getState·destroy API
     * [연계] index2·미리보기 → RiskAPI·RiskMapLayer·RiskSheet
     */
    function mount(options) {
        var map=options.map,api=w.RiskAPI.create(),enabled=options.enabled!==false,state={coast:true,sea:false},meta=null,t=null,selected=null,seq=0,detailSeq=0,table={coast:{spots:[]},sea:{cells:[]}},oldBase=null,disposed=false,boundariesLoaded=false,syncPending=null;
        var legend=options.legendEl,sheetEl=options.sheetEl,banner=options.bannerEl;
        var layer=w.RiskMapLayer.create(map,select),sheet=w.RiskSheet.create(sheetEl,{close:clearSelection,hazard:hazard,basis:w.RiskBasis.open,retry:function(){api.clear();refresh();}});
        legend.innerHTML='<div class="banzone-legend" role="group" aria-label="위험예측 보기"><button type="button" class="bzl-row on" data-layer="coast" aria-pressed="true"><span class="bzl-name">연안 위험 예측·분석</span><span class="bzl-switch" aria-hidden="true"></span></button><button type="button" class="bzl-row" data-layer="sea" aria-pressed="false"><span class="bzl-name">해상 위험 예측·분석</span><span class="bzl-switch" aria-hidden="true"></span></button></div><div class="rf-map-legend"><span><i class="rf-line rf-pre"></i>예비특보</span><span><i class="rf-line rf-adv"></i>주의보</span><span><i class="rf-line rf-wrn"></i>경보</span><span data-coast-legend><i class="rf-line rf-day3"></i>특보급 날씨 가능성(3일째)</span><span data-sea-legend hidden>점 = 배 혼잡</span></div>';
        legend.addEventListener('click',function(e){var b=e.target.closest('[data-layer]');if(!b)return;var kind=b.dataset.layer;state[kind]=!state[kind];b.classList.toggle('on',state[kind]);b.setAttribute('aria-pressed',String(state[kind]));legend.querySelector('[data-'+kind+'-legend]').hidden=!state[kind];if(selected&&selected.kind===kind)clearSelection();refresh();});
        function message(text) {if(banner){banner.textContent=text;banner.hidden=!text;}}
        function clearSelection(){detailSeq++;selected=null;sheet.clear();layer.setSelection(null);w.RiskBasis.close();}
        function nearest(times,value){return times.reduce(function(a,b){return Math.abs(Date.parse(b)-Date.parse(value))<Math.abs(Date.parse(a)-Date.parse(value))?b:a;},times[0]);}
        function select(kind,id){
            if(!enabled||!state[kind]||disposed)return;
            var item=(kind==='coast'?table.coast.spots:table.sea.cells).find(function(p){return p.id===id;});if(!item)return;
            if(!selected||selected.id!==id||selected.kind!==kind)layer.setSelection(kind,id);
            selected={kind:kind,id:id,item:item};if(meta){t=nearest(meta.timeline[kind].times,t||meta.now);w.RiskSlider.mount(sheet.timelineEl,meta.timeline[kind].times,t,function(value){t=value;refresh();});}refresh();
        }
        async function hazard(id){var snapshot=selected;try{var fc=await api.get('hazard-zones',{ids:id});if(enabled&&selected===snapshot&&selected&&state.coast)layer.showHazards(fc);}catch(e){console.warn('[위험예측] 위험구역 요청 실패',failureInfo(e));if(enabled&&!disposed&&selected===snapshot)message('위험구역 자료를 불러오지 못했습니다 — '+e.message);}}
        async function detail(){
            if(!selected||!enabled)return;var n=++detailSeq,s=selected,at=t;
            try{var d=await api.get(s.kind+'/'+(s.kind==='coast'?'spot':'cell'),{id:s.id,t:at});if(n!==detailSeq||!enabled||selected!==s||t!==at)return;sheet.show(d,s.kind,s.item);}
            catch(e){console.warn('[위험예측] 상세 요청 실패',failureInfo(e));if(n===detailSeq&&enabled&&selected===s)sheet.error(e.message);}
        }
        async function refresh(){
            if(!meta||disposed)return;var n=++seq;layer.setActive(state,enabled);legend.hidden=!enabled;
            if(!enabled){message('');return;}
            var frames=[],errors=[],degraded=[],kinds=['coast','sea'].filter(function(k){return state[k];});
            await Promise.all(kinds.map(async function(kind){
                var axis=meta.timeline[kind].times;
                if(Date.parse(t)>Date.parse(axis[axis.length-1])){if(kind==='sea')layer.drawSea({cells:[]});return;}
                try{
                    if(kind==='sea'&&!table.sea.cells.length){table.sea=await api.get('sea/cells');layer.setTables(table.sea,table.coast);}
                    var at=nearest(axis,t),f=await api.get(kind+'/frame',{t:at});if(n!==seq||!enabled)return;
                    if(kind==='coast')layer.drawCoast(f);else layer.drawSea(f);frames.push(f);degraded=degraded.concat(f.degraded||[]);
                }catch(e){console.warn('[위험예측] '+(kind==='coast'?'연안':'해상')+' 프레임 처리 실패',failureInfo(e));errors.push((kind==='coast'?'연안':'해상')+' 자료 — '+e.message);if(n===seq){if(kind==='sea')layer.drawSea({cells:[]});else layer.drawCoast({spots:[]});}}
            }));
            if(n!==seq||!enabled)return;layer.drawBorders(frames);
            message(errors.length?'위험예측 자료를 불러오지 못했습니다 — '+errors.join(' / '):degraded.length?'⚠ '+Array.from(new Set(degraded)).map(w.RiskSheet.sourceName).join(', ')+' 자료 없음':'');
            if(selected){layer.setSelection(selected.kind,selected.id);await detail();}
        }
        function sync() {
            if(syncPending)return syncPending;
            syncPending=(async function(){
                try {
                    var updated=await api.get('meta',{},true);if(!enabled||disposed)return;
                    var followNow=!t||!meta||t===meta.now;
                    if(!meta||updated.versions.spots!==meta.versions.spots)table.coast=await api.get('coast/spots',{},true);
                    if(!enabled||disposed)return;
                    if(meta&&updated.versions.cells!==meta.versions.cells)table.sea={cells:[]};
                    meta=updated;t=followNow?meta.now:nearest(meta.timeline[selected?selected.kind:'coast'].times,t);
                    layer.setTables(table.sea,table.coast);
                    if(!boundariesLoaded){await layer.boundaries(api);boundariesLoaded=true;}
                    if(!enabled||disposed)return;
                    if(selected)w.RiskSlider.mount(sheet.timelineEl,meta.timeline[selected.kind].times,t,function(value){t=value;refresh();});
                    await refresh();
                }catch(e){console.warn('[위험예측] 자료 갱신 실패',failureInfo(e));if(enabled&&!disposed)message('위험예측 갱신 실패 — '+e.message);}
                finally{syncPending=null;}
            })();
            return syncPending;
        }
        function setEnabled(value){enabled=!!value;seq++;if(!enabled){clearSelection();legend.hidden=true;layer.setActive(state,false);message('');if(oldBase&&w.oceanSetBasemap){w.oceanSetBasemap(oldBase);oldBase=null;}}else{if(w.oceanGetBasemap&&w.oceanSetBasemap){oldBase=w.oceanGetBasemap();w.oceanSetBasemap('coast');}legend.hidden=false;sync();}}
        function escapeSheet(e){if(e.key==='Escape'&&enabled&&selected&&!document.querySelector('.rf-modal')){e.preventDefault();clearSelection();}}
        document.addEventListener('keydown',escapeSheet);
        if(options.enabled===false){legend.hidden=true;layer.setActive(state,false);}
        var ready=enabled?sync():Promise.resolve();
        var timer=setInterval(function(){if(enabled&&!disposed)sync();},60000);
        return {ready:ready,setEnabled:setEnabled,select:select,refresh:refresh,tryHandleClick:function(evt){return enabled?layer.hit(evt):false;},getState:function(){return {enabled:enabled,coast:state.coast,sea:state.sea,t:t,selected:selected&&{kind:selected.kind,id:selected.id}};},destroy:function(){disposed=true;clearInterval(timer);document.removeEventListener('keydown',escapeSheet);seq++;clearSelection();layer.destroy();}};
    }
    /**
     * 해양안전의 실제 위험예측 버튼과 지도 클릭 훅을 등록한다.
     * 예: DOMContentLoaded에서 bindApp()
     * @param 없음
     * @returns {void}
     * [연계] index2 → mount·ocean_map 클릭 훅
     */
    function bindApp(){
        var btn=document.getElementById('ocean-risk-forecast-toggle-btn');if(!btn)return;
        var instance=null,pending=false,enabled=false;
        btn.addEventListener('click',async function(){
            enabled=!enabled;btn.classList.toggle('active',enabled);btn.setAttribute('aria-pressed',String(enabled));
            if(instance){instance.setEnabled(enabled);return;}if(!enabled||pending)return;pending=true;
            try{
                var map=w.getOceanMap&&w.getOceanMap();
                if(!map&&w.initOceanMap)await w.initOceanMap();
                map=w.getOceanMap&&w.getOceanMap();
                if(!map)throw Error('지도가 준비되지 않았습니다');
                instance=mount({map:map,sheetEl:document.getElementById('risk-forecast-sheet'),legendEl:document.getElementById('risk-forecast-legend'),bannerEl:document.getElementById('risk-forecast-banner'),enabled:false});
                w._riskForecastApp=instance;instance.setEnabled(enabled);
            }catch(e){console.warn('[위험예측] 앱 초기화 실패',failureInfo(e));var banner=document.getElementById('risk-forecast-banner');banner.hidden=!enabled;banner.textContent='위험예측을 열지 못했습니다 — '+e.message;enabled=false;btn.classList.remove('active');btn.setAttribute('aria-pressed','false');}
            finally{pending=false;}
        });
        w._riskForecastTryHandleClick=function(map,evt){return instance?instance.tryHandleClick(evt):false;};
    }
    w.RiskForecast={mount:mount};
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindApp);else bindApp();
})(window);
