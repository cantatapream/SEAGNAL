/**
 * ============================================================================
 * 파일명: client/js/marine-life/risk-forecast/risk_forecast.js
 * 역할  : 현재 종합·미래 공식 사고예보를 단일 격자 지도와 상세·관할 브리핑에 연결하고 시트 시각과 뒤로가기를 조율한다.
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
        var map=options.map,api=w.RiskAPI.create(),enabled=options.enabled!==false,state={coast:true,sea:false},meta=null,t=null,selected=null,choosing=false,seq=0,detailSeq=0,table={coast:{spots:[]},sea:{cells:[]},accident:{cells:[]},traffic:{cells:[]}},oldBase=null,disposed=false,boundariesLoaded=false,syncPending=null,accidentFresh=false,marineMode='risk';
        var legend=options.legendEl,sheetEl=options.sheetEl,banner=options.bannerEl;
        var layer=w.RiskMapLayer.create(map,select),sheet=w.RiskSheet.create(sheetEl,{close:clearSelection,hazard:hazard,basis:w.RiskBasis.open,choose:select,marinePoint:function(lon,lat){select('marine','point',{lon:lon,lat:lat});var xy=ol.proj.fromLonLat([lon,lat]);map.getView().fit([xy[0]-50,xy[1]-50,xy[0]+50,xy[1]+50],{padding:[55,30,Math.round(map.getSize()[1]*.6),30],maxZoom:14,duration:250});},retry:function(){api.clear();refresh();}});
        legend.innerHTML='<div class="banzone-legend" role="group" aria-label="위험예측 보기"><button type="button" class="bzl-row on" data-layer="coast" aria-pressed="true"><span class="bzl-name">연안 위험 예측·분석</span><span class="bzl-switch" aria-hidden="true"></span></button><button type="button" class="bzl-row" data-layer="sea" aria-pressed="false"><span class="bzl-name">해상 위험 예측·분석</span><span class="bzl-switch" aria-hidden="true"></span></button></div><div class="rf-map-legend"><span><i class="rf-line rf-pre"></i>예비특보</span><span><i class="rf-line rf-adv"></i>주의보</span><span><i class="rf-line rf-wrn"></i>경보</span><span data-coast-legend><i class="rf-line rf-day3"></i>특보급 날씨 가능성(3일째)</span><div class="rf-accident-key" data-sea-legend hidden>점·점선 = 공단 선박 혼잡 (실제 선박 위치·척수 아님) <span><i style="border:2px dashed #b8c5da;background:transparent"></i>낮음</span> · <span><i style="border:2px dashed #74b9ff;background:transparent"></i>보통</span> · <span><i style="border:2px dashed #d47cff;background:transparent"></i>높음</span> · <span><i style="border:2px dashed #ff5fe3;background:transparent"></i>매우높음</span></div><div class="rf-accident-key" data-accident-legend hidden>면 = 공단 선박 사고예보 <span><i style="background:#2fb36b"></i>낮음</span> · <span><i style="background:#f2c230"></i>보통</span> · <span><i style="background:#fb923c"></i>주의</span> · <span><i style="background:#e0322c"></i>경계</span></div></div>';
        if(w.RiskMarine){legend.classList.add('rf-marine-compact');legend.querySelector('.rf-map-legend').innerHTML='<div data-coast-legend hidden></div><div data-sea-legend hidden><strong class="rf-marine-caption" data-marine-caption>현재 종합 관심단계</strong><div class="rf-map-time"><span data-map-time></span><div data-marine-slider></div></div><details class="rf-map-extra"><summary>교통 자료 보기</summary><div class="rf-marine-modes" role="group" aria-label="해상 지도 표시"><button type="button" data-marine-mode="risk" aria-pressed="true">위험</button><button type="button" data-marine-mode="congestion" aria-pressed="false">혼잡</button><button type="button" data-marine-mode="current" aria-pressed="false">교통</button></div></details><div data-accident-legend hidden class="rf-mini-key"></div></div>';}
        if(w.RiskMarine){var colorLegend=document.createElement('div');colorLegend.className='rf-color-legend accident-grid-legend';colorLegend.setAttribute('aria-label','해상 위험 색상 범례');var caption=legend.querySelector('[data-marine-caption]'),key=legend.querySelector('[data-accident-legend]');caption.classList.add('agl-title');colorLegend.appendChild(caption);colorLegend.appendChild(key);colorLegend.hidden=true;map.getTargetElement().parentElement.appendChild(colorLegend);}
        function marineLegend(frame){if(!w.RiskMarine)return;var effective=frame?frame.mode:marineMode==='risk'?(!meta||!t||Date.parse(t)<=Date.parse(meta.now)+60000?'combined':'accident'):marineMode;var levels=effective==='current'?['여유','보통','주의','혼잡']:effective==='congestion'?['낮음','보통','높음','매우높음']:effective==='combined'?['낮음','관심','주의','경계']:['낮음','보통','주의','경계'];(colorLegend||legend).querySelector('[data-accident-legend]').innerHTML='<div class="rf-gradient-bar" aria-hidden="true"></div><div class="rf-gradient-labels">'+levels.map(function(v){return '<span>'+v+'</span>';}).join('')+'</div>';var title=(colorLegend||legend).querySelector('[data-marine-caption]'),kind=effective==='combined'||effective==='current'?'현재':'예보',name=effective==='combined'?'종합 관심단계':effective==='accident'?'공식 사고예보':effective==='congestion'?'공식 혼잡예보':'현재 교통량',changed=title.dataset.meaning&&title.dataset.meaning!==effective;title.textContent=name;title.setAttribute('aria-live','polite');if(changed){title.classList.remove('rf-legend-change');void title.offsetWidth;title.classList.add('rf-legend-change');}title.dataset.meaning=effective;legend.querySelectorAll('[data-marine-mode]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.marineMode===marineMode));});}
        function marineTime(){if(!w.RiskMarine||!meta)return;var times=Array.from(new Set([meta.now].concat(seaTimes()))).sort(function(a,b){return Date.parse(a)-Date.parse(b);});legend.querySelector('[data-map-time]').textContent=t===meta.now?'지금':w.RiskFormat.time(t);w.RiskSlider.mount(legend.querySelector('[data-marine-slider]'),times,t,function(value){t=value;marineTime();refresh();});}
        if(w.RiskMarine){marineLegend();legend.addEventListener('click',function(e){var b=e.target.closest('[data-marine-mode]');if(b){marineMode=b.dataset.marineMode;marineLegend();refresh();}});}
        legend.addEventListener('click',function(e){var b=e.target.closest('[data-layer]');if(!b)return;var kind=b.dataset.layer;state[kind]=!state[kind];b.classList.toggle('on',state[kind]);b.setAttribute('aria-pressed',String(state[kind]));legend.querySelector('[data-'+kind+'-legend]').hidden=!state[kind];if(colorLegend)colorLegend.hidden=!state.sea;if(kind==='sea'){(colorLegend||legend).querySelector('[data-accident-legend]').hidden=!state.sea;marineTime();}if((selected&&(selected.kind===kind||(kind==='sea'&&seaKind(selected.kind)==='sea')))||(choosing&&kind==='coast'))clearSelection();refresh();});
        if(w.RiskMarine){var controls=document.createElement('details');controls.className='rf-brief-controls';controls.innerHTML='<summary>관할별 해상 브리핑</summary><select aria-label="브리핑 관할"><option value="">관할 선택</option></select><button type="button" data-marine-brief>브리핑 보기</button><small data-current-stamp>숫자는 현재 척수이며 미래 예보와 시각이 다릅니다.</small>';legend.appendChild(controls);controls.querySelector('button').addEventListener('click',function(){var id=controls.querySelector('select').value;if(id){if(!state.sea)legend.querySelector('[data-layer="sea"]').click();select('briefing',id);}});api.get('sea/jurisdictions').then(function(d){if(disposed)return;d.stations.forEach(function(s){var option=document.createElement('option');option.value=s.id;option.textContent=s.name;controls.querySelector('select').appendChild(option);});}).catch(function(e){console.warn('[위험예측] 관할 목록 요청 실패',failureInfo(e));});}
        function seaKind(kind){return ['accident','traffic','marine','briefing'].includes(kind)?'sea':kind;}
        function message(text) {if(banner){banner.textContent=text;banner.hidden=!text;}}
        function clearSelection(){if(w.PopupStack)w.PopupStack.remove('risk-forecast-sheet');detailSeq++;selected=null;choosing=false;sheet.clear();layer.setSelection(null);w.RiskBasis.close();}
        /**
         * 열린 시트를 기존 휴대폰 뒤로가기 관리자에 등록한다.
         * 예: 기준창이 열려도 기존 시트 항목은 다시 쌓지 않는다.
         * @param 없음 @returns {void}
         * [연계] select/detail → core/backbutton.js의 PopupStack, 뒤로가기 시 창부터 닫는다.
         */
        function registerSheet(){if(w.PopupStack)w.PopupStack.push('risk-forecast-sheet',clearSelection);}
        function nearest(times,value){return times.reduce(function(a,b){return Math.abs(Date.parse(b)-Date.parse(value))<Math.abs(Date.parse(a)-Date.parse(value))?b:a;},times[0]);}
        /**
         * 두 날의 시간별 혼잡 예보와 세 날의 3시간별 공식 사고 예보를 한 조회 축으로 합친다.
         * 예: 모레00·03·06시는 사고 예보만 조회하고 혼잡 격자는 비운다.
         * @returns {string[]} 지금 이후 KST ISO 시각
         * [연계] selectionTimes → meta.timeline.sea/accident, 원천 간격 매칭은 서버가 한다.
         */
        function seaTimes(){var times=Array.from(new Set(meta.timeline.sea.times.concat(meta.timeline.accident?meta.timeline.accident.times.filter(function(at){return Date.parse(at)>=Date.parse(meta.now);}):[])));if(w.RiskMarine){var local=new Date(Date.parse(meta.now)+9*3600000).toISOString().slice(0,10),end=Date.parse(local+'T00:00:00+09:00')+48*3600000;times=times.filter(function(at){return Date.parse(at)<end;});}return times.sort(function(a,b){return Date.parse(a)-Date.parse(b);});}
        /** 선택 대상에 맞는 조회 축을 고른다. 예: accident → 해상 공통 축. [연계] select·sync → seaTimes. */
        function selectionTimes(kind){return kind==='coast'?meta.timeline.coast.times:seaTimes();}
        function select(kind,id,location){
            if(!enabled||!state[seaKind(kind)]||disposed)return;
            if(Array.isArray(id)){var choices=table.coast.spots.filter(function(p){return id.includes(p.id);});clearSelection();choosing=true;sheet.choose(choices);registerSheet();return;}
            var item=kind==='marine'?{id:id,lon:location&&location.lon,lat:location&&location.lat}:kind==='briefing'?{id:id}:(kind==='coast'?table.coast.spots:table[kind].cells).find(function(p){return p.id===id;});if(!item)return;
            if(!selected||selected.id!==id||selected.kind!==kind)layer.setSelection(kind==='briefing'?null:kind,id);
            choosing=false;selected={kind:kind,id:id,item:item,at:t,location:seaKind(kind)==='sea'&&location&&Number.isFinite(location.lon)&&Number.isFinite(location.lat)?{lon:location.lon,lat:location.lat}:null};if(meta){selected.at=nearest(selectionTimes(kind),t||meta.now);w.RiskSlider.mount(sheet.timelineEl,selectionTimes(kind),selected.at,function(value){if(selected){selected.at=value;detail();}});}refresh();
        }
        async function hazard(id){var snapshot=selected;try{var fc=await api.get('hazard-zones',{ids:id});if(enabled&&selected===snapshot&&selected&&state.coast)layer.showHazards(fc);}catch(e){console.warn('[위험예측] 위험구역 요청 실패',failureInfo(e));if(enabled&&!disposed&&selected===snapshot)message('위험구역 자료를 불러오지 못했습니다 — '+e.message);}}
        async function detail(){
            if(!selected||!enabled)return;var n=++detailSeq,s=selected,at=s.at||t;
            try{var params={id:s.id,t:at};if(s.location){params.lon=s.location.lon;params.lat=s.location.lat;}var d=await api.get(s.kind==='briefing'?'sea/briefing':w.RiskMarine&&seaKind(s.kind)==='sea'?'sea/analysis':s.kind==='accident'?'sea/accident-cell':s.kind+'/'+(s.kind==='coast'?'spot':'cell'),params);if(n!==detailSeq||!enabled||selected!==s||(s.at||t)!==at)return;sheet.show(d,s.kind,s.item);registerSheet();}
            catch(e){console.warn('[위험예측] 상세 요청 실패',failureInfo(e));if(n===detailSeq&&enabled&&selected===s&&(s.at||t)===at){sheet.error(e.message);registerSheet();}}
        }
        async function refresh(){
            if(!meta||disposed)return;var n=++seq,at=t,freshAccident=accidentFresh;layer.setActive(state,enabled);legend.hidden=!enabled;if(colorLegend)colorLegend.hidden=!enabled||!state.sea;
            if(!enabled){message('');return;}
            var frames=[],errors=[],degraded=[],sourceWarnings=[],kinds=(w.RiskMarine?['coast']:['coast','sea','accident']).filter(function(k){return state[k==='accident'?'sea':k];});
            await Promise.all(kinds.map(async function(kind){
                // 메타가 이미 위치표 부재를 알려준 경우 준비 전 503을 반복 요청하지 않는다.
                if((kind==='sea'&&meta.versions.cells===0)||(kind==='accident'&&!meta.versions.accident)){
                    if(kind==='sea')layer.drawSea({cells:[]});else layer.drawAccident({cells:[]});
                    sourceWarnings.push(kind==='sea'?'선박 혼잡 자료 없음':'공단 사고 위험예보 자료 없음');
                    sourceWarnings=sourceWarnings.concat(w.RiskSheet.sourceMessages(meta,kind));return;
                }
                var axis=meta.timeline[kind]&&meta.timeline[kind].times;if(!axis||!axis.length){if(kind==='accident'){layer.drawAccident({cells:[]});sourceWarnings.push('공단 사고 위험예보 자료 없음');}return;}
                if(Date.parse(at)>Date.parse(axis[axis.length-1])){if(kind==='sea')layer.drawSea({cells:[]});else if(kind==='accident')layer.drawAccident({cells:[]});return;}
                try{
                    if(kind==='sea'&&!table.sea.cells.length){var seaTable=await api.get('sea/cells',{},true);if(n!==seq||!enabled||disposed)return;table.sea=seaTable;layer.setTables(table.sea,table.coast,table.accident,table.traffic);}
                    // 원천 예보의 간격은 서버가 맞춘다. 두 층과 특보 경계는 선택한 한 시각을 공유한다.
                    var f;
                    if(kind==='accident'){
                        // i는 경계 표의 정렬 순번이다. 수집 도중 순번이 바뀌면 같은 버전의 한 쌍만 그린다.
                        var accidentTable=table.accident;
                        for(var attempt=0;attempt<2;attempt++){
                            if(attempt||!accidentTable.cells.length)accidentTable=await api.get('sea/accident-cells',{},true);
                            if(n!==seq||!enabled||disposed)return;
                            f=await api.get('sea/accident-frame',{t:at,v:accidentTable.v},freshAccident||!!attempt);
                            if(n!==seq||!enabled||disposed)return;
                            if(accidentTable.v!==undefined&&f.v!==undefined&&accidentTable.v===f.v)break;
                        }
                        if(accidentTable.v===undefined||f.v===undefined||accidentTable.v!==f.v)throw Error('사고 예보 경계와 시각 자료의 버전이 일치하지 않습니다');
                        table.accident=accidentTable;accidentFresh=false;layer.setTables(table.sea,table.coast,table.accident,table.traffic);
                    }else f=await api.get(kind+'/frame',{t:at});
                    if(n!==seq||!enabled||disposed)return;
                    if(kind==='coast')layer.drawCoast(f);else if(kind==='accident')layer.drawAccident(f);else layer.drawSea(f);frames.push(f);degraded=degraded.concat(f.degraded||[]);sourceWarnings=sourceWarnings.concat(w.RiskSheet.sourceMessages(f,kind));
                }catch(e){console.warn('[위험예측] '+(kind==='coast'?'연안':kind==='accident'?'공단 사고 위험예보':'선박 혼잡')+' 프레임 처리 실패',failureInfo(e));errors.push((kind==='coast'?'연안':kind==='accident'?'공단 사고 위험예보':'선박 혼잡')+' 자료 — '+e.message);if(n===seq){if(kind==='sea')layer.drawSea({cells:[]});else if(kind==='accident')layer.drawAccident({cells:[]});else layer.drawCoast({spots:[]});}}
            }));
            if(n!==seq||!enabled)return;layer.drawBorders(frames);
            if(w.RiskMarine&&state.sea){try{var currentTable=await api.get('sea/unified-cells'),currentFrame=await api.get('sea/unified-frame',{mode:marineMode,t:at});if(n!==seq||!enabled)return;if(currentTable.v!==currentFrame.v){currentTable=await api.get('sea/unified-cells',{},true);currentFrame=await api.get('sea/unified-frame',{mode:marineMode,t:at},true);}if(n!==seq||!enabled)return;if(currentTable.v!==currentFrame.v)throw Error('격자 버전 변경');table.traffic=currentTable;layer.drawUnified(currentTable,currentFrame);marineLegend(currentFrame);var stamp=legend.querySelector('[data-current-stamp]');if(stamp){var c=currentFrame.currentStatus;stamp.textContent=currentFrame.mode==='combined'||marineMode==='current'?'현재 · '+w.RiskFormat.time(c.sourceAt||c.collectedAt):'예보 · '+w.RiskFormat.time(currentFrame.forecastAt);}}catch(e){if(n===seq&&enabled&&!disposed)layer.drawUnified({cells:[]},{cells:[]});console.warn('[위험예측] 해상 통합 지도 요청 실패',failureInfo(e));}}
            message(errors.length?'위험예측 자료를 불러오지 못했습니다 — '+errors.join(' / '):sourceWarnings.length?'⚠ '+Array.from(new Set(sourceWarnings)).join(' / '):degraded.length?'⚠ '+Array.from(new Set(degraded)).map(w.RiskSheet.sourceName).join(', ')+' 자료 없음':'');
            if(selected){layer.setSelection(selected.kind==='briefing'?null:selected.kind,selected.id);await detail();}
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
                    var accidentVersionChanged=meta&&updated.versions.accident!==meta.versions.accident;
                    var accidentCreatedAt=updated.sources&&updated.sources.accident&&updated.sources.accident.createdAt;
                    var oldAccidentCreatedAt=meta&&meta.sources&&meta.sources.accident&&meta.sources.accident.createdAt;
                    if(meta&&(accidentVersionChanged||accidentCreatedAt!==oldAccidentCreatedAt)){seq++;api.clear();accidentFresh=true;}
                    if(accidentVersionChanged){table.accident={cells:[]};layer.drawAccident({cells:[]});}
                    meta=updated;t=followNow?meta.now:nearest(w.RiskMarine&&state.sea?seaTimes():selectionTimes(selected?selected.kind:'coast'),t);marineTime();
                    layer.setTables(table.sea,table.coast,table.accident,table.traffic);
                    if(!boundariesLoaded){await layer.boundaries(api);boundariesLoaded=true;}
                    if(!enabled||disposed)return;
                    if(selected)w.RiskSlider.mount(sheet.timelineEl,selectionTimes(selected.kind),selected.at||t,function(value){if(selected){selected.at=value;detail();}});
                    await refresh();
                }catch(e){console.warn('[위험예측] 자료 갱신 실패',failureInfo(e));if(enabled&&!disposed)message('위험예측 갱신 실패 — '+e.message);}
                finally{syncPending=null;}
            })();
            return syncPending;
        }
        function setEnabled(value){enabled=!!value;seq++;if(!enabled){clearSelection();legend.hidden=true;layer.setActive(state,false);message('');if(oldBase&&w.oceanSetBasemap){w.oceanSetBasemap(oldBase);oldBase=null;}}else{if(w.oceanGetBasemap&&w.oceanSetBasemap){oldBase=w.oceanGetBasemap();w.oceanSetBasemap('coast');}legend.hidden=false;sync();}}
        function escapeSheet(e){if(e.key==='Escape'&&enabled&&(selected||choosing)&&!document.querySelector('.rf-modal')){e.preventDefault();clearSelection();}}
        document.addEventListener('keydown',escapeSheet);
        if(options.enabled===false){legend.hidden=true;if(colorLegend)colorLegend.hidden=true;layer.setActive(state,false);}
        var ready=enabled?sync():Promise.resolve();
        var timer=setInterval(function(){if(enabled&&!disposed)sync();},60000);
        return {ready:ready,setEnabled:setEnabled,select:select,refresh:refresh,tryHandleClick:function(evt){return enabled?layer.hit(evt):false;},getState:function(){return {enabled:enabled,coast:state.coast,sea:state.sea,t:t,selected:selected&&{kind:selected.kind,id:selected.id}};},destroy:function(){disposed=true;clearInterval(timer);document.removeEventListener('keydown',escapeSheet);seq++;clearSelection();layer.destroy();if(colorLegend)colorLegend.remove();}};
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
