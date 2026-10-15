/**
 * ============================================================================
 * 파일명: client/js/marine-life/risk-forecast/risk_forecast.js
 * 역할  : 현재 종합·미래 공식 사고예보를 단일 격자 지도와 상세와 하단 시각 버튼에 연결하고 시트 시각과 뒤로가기를 조율한다.
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
        var map=options.map,api=w.RiskAPI.create(),enabled=options.enabled!==false,state={coast:true,sea:false},meta=null,t=null,selected=null,choosing=false,seq=0,detailSeq=0,table={coast:{spots:[]},sea:{cells:[]},accident:{cells:[]},traffic:{cells:[]}},oldBase=null,disposed=false,boundariesLoaded=false,syncPending=null,accidentFresh=false,marineMode='risk',coastVersion=null,boundaryPending=null;
        var legend=options.legendEl,sheetEl=options.sheetEl,banner=options.bannerEl;
        var layer=w.RiskMapLayer.create(map,select),sheet=w.RiskSheet.create(sheetEl,{close:clearSelection,hazard:hazard,basis:w.RiskBasis.open,choose:select,marinePoint:function(lon,lat){select('marine','point',{lon:lon,lat:lat});var xy=ol.proj.fromLonLat([lon,lat]);map.getView().fit([xy[0]-50,xy[1]-50,xy[0]+50,xy[1]+50],{padding:[55,30,Math.round(map.getSize()[1]*.6),30],maxZoom:14,duration:250});},retry:function(){api.clear();refresh();}});
        legend.innerHTML='<div class="banzone-legend" role="group" aria-label="위험예측 보기"><button type="button" class="bzl-row on" data-layer="coast" aria-pressed="true"><span class="bzl-name">연안 위험 예측·분석</span><span class="bzl-switch" aria-hidden="true"></span></button><button type="button" class="bzl-row" data-layer="sea" aria-pressed="false"><span class="bzl-name">해상 위험 예측·분석</span><span class="bzl-switch" aria-hidden="true"></span></button></div><div class="rf-map-legend"><span><i class="rf-line rf-pre"></i>예비특보</span><span><i class="rf-line rf-adv"></i>주의보</span><span><i class="rf-line rf-wrn"></i>경보</span><span data-coast-legend><i class="rf-line rf-day3"></i>특보급 날씨 가능성(3일째)</span><div class="rf-accident-key" data-sea-legend hidden>점·점선 = 공단 선박 혼잡 (실제 선박 위치·척수 아님) <span><i style="border:2px dashed #b8c5da;background:transparent"></i>낮음</span> · <span><i style="border:2px dashed #74b9ff;background:transparent"></i>보통</span> · <span><i style="border:2px dashed #d47cff;background:transparent"></i>높음</span> · <span><i style="border:2px dashed #ff5fe3;background:transparent"></i>매우높음</span></div><div class="rf-accident-key" data-accident-legend hidden>면 = 공단 선박 사고예보 <span><i style="background:#2fb36b"></i>낮음</span> · <span><i style="background:#f2c230"></i>보통</span> · <span><i style="background:#fb923c"></i>주의</span> · <span><i style="background:#e0322c"></i>경계</span></div></div>';
        if(w.RiskMarine){legend.classList.add('rf-marine-compact');legend.querySelector('.rf-map-legend').innerHTML='<div data-coast-legend hidden></div><div data-sea-legend hidden><strong class="rf-marine-caption" data-marine-caption>현재 종합 관심단계</strong><div data-accident-legend hidden class="rf-mini-key"></div></div>';}
        if(w.RiskMarine){
            legend.querySelector('.banzone-legend').insertAdjacentHTML('beforeend','<div data-marine-tools hidden><span class="rf-mode-badge" data-marine-badge hidden></span><details class="rf-marine-options"><summary>표시 항목 <span aria-hidden="true">⌄</span></summary><div role="group" aria-label="해상 표시 항목"><button type="button" class="bzl-row" data-marine-mode="accident" aria-pressed="false"><span class="bzl-name">사고위험 예보</span><span class="bzl-switch" aria-hidden="true"></span></button><button type="button" class="bzl-row" data-marine-mode="current" aria-pressed="false"><span class="bzl-name">실시간 교통</span><span class="bzl-switch" aria-hidden="true"></span></button><button type="button" class="bzl-row" data-marine-mode="congestion" aria-pressed="false"><span class="bzl-name">혼잡도 예측</span><span class="bzl-switch" aria-hidden="true"></span></button></div></details></div>');
            legend.querySelector('.rf-map-legend').hidden=true;
        }
        if(w.RiskMarine){var colorLegend=document.createElement('div');colorLegend.className='rf-color-legend accident-grid-legend';colorLegend.setAttribute('aria-label','해상 위험 색상 범례');var caption=legend.querySelector('[data-marine-caption]'),key=legend.querySelector('[data-accident-legend]');caption.classList.add('agl-title');colorLegend.appendChild(caption);colorLegend.appendChild(key);colorLegend.hidden=true;map.getTargetElement().parentElement.appendChild(colorLegend);}
        function marineLegend(frame){if(!w.RiskMarine)return;var effective=frame?frame.mode:marineMode==='risk'?(!meta||!t||Date.parse(t)<=Date.parse(meta.now)+60000?'combined':'accident'):marineMode;var levels=effective==='current'?['여유','보통','주의','혼잡']:effective==='congestion'?['낮음','보통','높음','매우높음']:effective==='combined'?['낮음','관심','주의','경계']:['낮음','보통','주의','경계'];(colorLegend||legend).querySelector('[data-accident-legend]').innerHTML='<div class="rf-gradient-bar" aria-hidden="true"></div><div class="rf-gradient-labels">'+levels.map(function(v){return '<span>'+v+'</span>';}).join('')+'</div>';var title=(colorLegend||legend).querySelector('[data-marine-caption]'),kind=effective==='combined'||effective==='current'?'현재':'예보',name=effective==='combined'?'종합 관심단계':effective==='accident'?'공식 사고예보':effective==='congestion'?'공식 혼잡예보':'현재 교통량',changed=title.dataset.meaning&&title.dataset.meaning!==effective;title.textContent=name;title.setAttribute('aria-live','polite');if(changed){title.classList.remove('rf-legend-change');void title.offsetWidth;title.classList.add('rf-legend-change');}title.dataset.meaning=effective;legend.querySelectorAll('[data-marine-mode]').forEach(function(b){var on=b.dataset.marineMode===marineMode;b.setAttribute('aria-pressed',String(on));b.classList.toggle('on',on);});}
        // 화면 하단은 지도 출처 위가 아니라 출처와 메인 탭 사이에 놓는다.
        var timeBar=null;
        if(w.RiskMarine){
            timeBar=document.createElement('div');timeBar.className='rf-marine-timebar';timeBar.hidden=true;
            timeBar.setAttribute('role','group');timeBar.setAttribute('aria-label','해상 조회 시각');
            timeBar.innerHTML='<output data-map-time aria-live="polite"></output><button type="button" data-time-step="now">현재</button><button type="button" data-time-step="3">+3H</button><button type="button" data-time-step="6">+6H</button><button type="button" data-time-step="12">+12H</button>';
            map.getTargetElement().parentElement.appendChild(timeBar);
            timeBar.addEventListener('click',function(e){var b=e.target.closest('[data-time-step]');if(!b||b.disabled||!meta)return;t=b.dataset.timeStep==='now'?meta.now:nextTime(Number(b.dataset.timeStep));if(b.dataset.timeStep!=='now'&&marineMode==='current'){marineMode='risk';marineLegend();modeBadge();}marineTime();refresh();});
        }
        /** 선택 시각을 기준으로 다음 3시간 예보 칸으로 이동한다.
         * 예: 11:00 +3H →12:00, 다시 +3H →15:00; +6H는 두 칸.
         * @param {number} hours - 3·6·12 @returns {string|null} 공개 범위 안 KST ISO
         * [연계] ← 하단 버튼 / → seaTimes; 실제 존재하는 예보 시각만 선택한다.
         */
        function nextTime(hours){var target=Math.floor(Date.parse(t||meta.now)/10800000)*10800000+hours*3600000;return seaTimes().find(function(at){return Date.parse(at)>=target;})||null;}
        /** 고정 날짜 표시와 버튼 사용 가능 여부를 갱신한다.
         * 예: 10.13.(화) 12:00은 버튼이 아닌 output이다.
         * @returns {void} [연계] ← sync·시간버튼 / 현재 복귀는 서버 meta.now를 사용한다.
         */
        function marineTime(){if(!timeBar)return;var shown=enabled&&state.sea;timeBar.hidden=!shown;var tools=legend.querySelector('[data-marine-tools]');if(tools)tools.hidden=!shown;document.body.classList.toggle('rf-sea-time-on',shown);if(!meta)return;var local=new Date(Date.parse(t||meta.now)+32400000),pad=function(n){return String(n).padStart(2,'0');};timeBar.querySelector('[data-map-time]').textContent=pad(local.getUTCMonth()+1)+'.'+pad(local.getUTCDate())+'.('+['일','월','화','수','목','금','토'][local.getUTCDay()]+') '+pad(local.getUTCHours())+':'+pad(local.getUTCMinutes());timeBar.querySelectorAll('[data-time-step]').forEach(function(b){var current=b.dataset.timeStep==='now';b.disabled=!current&&!nextTime(Number(b.dataset.timeStep));if(current)b.setAttribute('aria-pressed',String(t===meta.now));});}
        /** 선택한 한 항목을 뱃지와 배타적인 스위치에 반영한다.
         * 예: 사고위험 예보만 ON → 뱃지 표시; OFF → 기본 통합 색상.
         * @returns {void} [연계] ← 하위 항목·해상 토글 / 선택 후 아코디언을 접는다.
         */
        function modeBadge(){var badge=legend.querySelector('[data-marine-badge]');if(!badge)return;var names={accident:'사고위험 예보',current:'실시간 교통',congestion:'혼잡도 예측'};badge.hidden=marineMode==='risk';badge.textContent=names[marineMode]?names[marineMode]+' 표출 중':'';legend.querySelector('.rf-marine-options').open=false;}
        if(w.RiskMarine){marineLegend();legend.addEventListener('click',function(e){var b=e.target.closest('[data-marine-mode]');if(b){marineMode=marineMode===b.dataset.marineMode?'risk':b.dataset.marineMode;if(marineMode==='current'&&meta)t=meta.now;modeBadge();marineLegend();marineTime();refresh();}});}
        legend.addEventListener('click',function(e){var b=e.target.closest('[data-layer]');if(!b)return;var kind=b.dataset.layer;state[kind]=!state[kind];if(w.RiskMarine&&kind==='sea'&&state.sea){marineMode='risk';modeBadge();marineLegend();}b.classList.toggle('on',state[kind]);b.setAttribute('aria-pressed',String(state[kind]));legend.querySelector('[data-'+kind+'-legend]').hidden=!state[kind];if(colorLegend)colorLegend.hidden=!state.sea;marineTime();if(kind==='sea'){(colorLegend||legend).querySelector('[data-accident-legend]').hidden=!state.sea;marineTime();}if((selected&&(selected.kind===kind||(kind==='sea'&&seaKind(selected.kind)==='sea')))||(choosing&&kind==='coast'))clearSelection();if(!meta)sync();else refresh();});
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
        function seaTimes(){var raw=(meta.timeline.sea&&meta.timeline.sea.times||[]).concat(meta.timeline.accident&&meta.timeline.accident.times||[]),times=Array.from(new Set(raw)).filter(function(at){return Date.parse(at)>=Date.parse(meta.now);});if(w.RiskMarine){var local=new Date(Date.parse(meta.now)+32400000).toISOString().slice(0,10),end=Date.parse(local+'T00:00:00+09:00')+172800000;times=times.filter(function(at){var stamp=Date.parse(at);return stamp>Date.parse(meta.now)&&stamp<end&&stamp%10800000===0;});times.unshift(meta.now);}return times.sort(function(a,b){return Date.parse(a)-Date.parse(b);});}
        /** 선택 대상에 맞는 조회 축을 고른다. 예: accident → 해상 공통 축. [연계] select·sync → seaTimes. */
        function selectionTimes(kind){return kind==='coast'?meta.timeline.coast.times:seaTimes();}
        function select(kind,id,location){
            if(kind==='briefing')return;
            if(!enabled||!state[seaKind(kind)]||disposed)return;
            if(Array.isArray(id)){var choices=table.coast.spots.filter(function(p){return id.includes(p.id);});clearSelection();choosing=true;sheet.choose(choices);registerSheet();return;}
            var item=kind==='marine'?{id:id,lon:location&&location.lon,lat:location&&location.lat}:kind==='briefing'?{id:id}:(kind==='coast'?table.coast.spots:table[kind].cells).find(function(p){return p.id===id;});if(!item)return;
            if(!selected||selected.id!==id||selected.kind!==kind)layer.setSelection(kind==='briefing'?null:kind,id);
            choosing=false;selected={kind:kind,id:id,item:item,at:t,location:seaKind(kind)==='sea'&&location&&Number.isFinite(location.lon)&&Number.isFinite(location.lat)?{lon:location.lon,lat:location.lat}:null};if(meta){selected.at=nearest(selectionTimes(kind),t||meta.now);w.RiskSlider.mount(sheet.timelineEl,selectionTimes(kind),selected.at,function(value){if(selected){selected.at=value;detail();}});}detail();
        }
        async function hazard(id){var snapshot=selected;try{var fc=await api.get('hazard-zones',{ids:id});if(enabled&&selected===snapshot&&selected&&state.coast)layer.showHazards(fc);}catch(e){console.warn('[위험예측] 위험구역 요청 실패',failureInfo(e));if(enabled&&!disposed&&selected===snapshot)message('위험구역 자료를 불러오지 못했습니다 — '+e.message);}}
        async function detail(){
            if(!selected||!enabled)return;var n=++detailSeq,s=selected,at=s.at||t;
            try{var params={id:s.id,t:at};if(s.location){params.lon=s.location.lon;params.lat=s.location.lat;}var d=await api.get(s.kind==='briefing'?'sea/briefing':w.RiskMarine&&seaKind(s.kind)==='sea'?'sea/analysis':s.kind==='accident'?'sea/accident-cell':s.kind+'/'+(s.kind==='coast'?'spot':'cell'),params);if(n!==detailSeq||!enabled||selected!==s||(s.at||t)!==at)return;sheet.show(d,s.kind,s.item);registerSheet();}
            catch(e){console.warn('[위험예측] 상세 요청 실패',failureInfo(e));if(n===detailSeq&&enabled&&selected===s&&(s.at||t)===at){sheet.error(e.message);registerSheet();}}
        }
        /** 연안 요청·부가 경계를 기다리지 않고 해상 지도부터 표시한다.
         * 예: 연안 요청이 늦어도 정상 해상 프레임은 먼저 그린다.
         * @param {number} n - 요청 세대 @param {string} at - 메인 시각
         * @returns {Promise<object>} 안전한 오류·결측 안내
         * [연계] ← refresh / 지도 버전 검증과 OFF·시간변경 경쟁을 보존한다.
         */
        async function refreshMarine(n,at){var errors=[],sourceWarnings=[];
            try{
                var pair=await Promise.all([api.get('sea/unified-cells'),api.get('sea/unified-frame',{mode:marineMode,t:at})]),currentTable=pair[0],currentFrame=pair[1];
                if(n!==seq||!enabled||disposed)return {errors:[],warnings:[]};
                if(currentTable.v!==currentFrame.v){pair=await Promise.all([api.get('sea/unified-cells',{},true),api.get('sea/unified-frame',{mode:marineMode,t:at},true)]);currentTable=pair[0];currentFrame=pair[1];}
                if(n!==seq||!enabled||disposed)return {errors:[],warnings:[]};if(currentTable.v!==currentFrame.v)throw Error('격자 버전 변경');
                table.traffic=currentTable;layer.drawUnified(currentTable,currentFrame);marineLegend(currentFrame);
                if(!currentFrame.cells.length)sourceWarnings.push('선택 시각의 해상 자료 없음');
            }catch(e){if(n===seq&&enabled&&!disposed){layer.drawUnified({cells:[]},{cells:[]});errors.push('해상 자료를 불러오지 못했습니다. 잠시 후 다시 시도합니다.');}console.warn('[위험예측] 해상 통합 지도 요청 실패',failureInfo(e));}
            return {errors:errors,warnings:sourceWarnings};
        }
        /** 선택한 메인 시각에 실제 발표된 특보 구역만 지도 배경 면으로 그린다(연안·해상 켬 여부, 위험 프레임과 독립).
         * 예: 해상만 켜도 /warning-zones 한 번으로 12시 주의보 구역을 칠한다; 특보가 없으면 아무것도 그리지 않는다.
         * @param {number} n - 요청 세대 @param {string} at - 메인 시각(시트 시각 아님)
         * @returns {Promise<object>} 안전한 오류·특보 원천 안내
         * [연계] ← refresh / 구 sea·coast frame은 부르지 않는다. 실패는 빈 화면으로 정상처럼 꾸미지 않고 안내를 남긴다.
         */
        async function refreshWarnings(n,at){var errors=[],warnings=[];
            try{
                var data=await api.get('warning-zones',{t:at});
                if(n!==seq||!enabled||disposed)return {errors:[],warnings:[]};
                var zones=Array.isArray(data.zones)?data.zones:[];
                await layer.zonesLoaded();
                if(n!==seq||!enabled||disposed)return {errors:[],warnings:[]};
                var missing=layer.drawWarnings(zones);
                if(missing.length)errors.push('특보 구역 경계를 지도에 그리지 못했습니다');
                if((data.degraded||[]).includes('warnings')||(data.sources&&data.sources.warnings&&!['ok','offseason'].includes(data.sources.warnings.status)))warnings=w.RiskSheet.sourceMessages({t:data.t,sources:{warnings:(data.sources||{}).warnings||{status:'missing'}}},'sea');
            }catch(e){if(n===seq&&enabled&&!disposed){layer.drawWarnings([]);errors.push('특보 구역 — '+e.message);}console.warn('[위험예측] 특보 구역 요청 실패',failureInfo(e));}
            return {errors:errors,warnings:warnings};
        }
        async function refresh(){
            if(!meta||disposed)return;var n=++seq,at=t,freshAccident=accidentFresh;layer.setActive(state,enabled);legend.hidden=!enabled;if(colorLegend)colorLegend.hidden=!enabled||!state.sea;
            if(!enabled){message('');return;}
            var frames=[],errors=[],degraded=[],sourceWarnings=[],kinds=(w.RiskMarine?['coast']:['coast','sea','accident']).filter(function(k){return state[k==='accident'?'sea':k];});
            var marineJob=w.RiskMarine&&state.sea?refreshMarine(n,at):Promise.resolve({errors:[],warnings:[]});
            var warningJob=state.coast||state.sea?refreshWarnings(n,at):Promise.resolve({errors:[],warnings:[]});
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
            if(n!==seq||!enabled)return;
            var warningResult=await warningJob;if(n!==seq||!enabled||disposed)return;errors=errors.concat(warningResult.errors);sourceWarnings=sourceWarnings.concat(warningResult.warnings);
            var marineResult=await marineJob;if(n!==seq||!enabled||disposed)return;errors=errors.concat(marineResult.errors);sourceWarnings=sourceWarnings.concat(marineResult.warnings);
            message(errors.length?'위험예측 자료를 불러오지 못했습니다 — '+errors.join(' / '):sourceWarnings.length?'⚠ '+Array.from(new Set(sourceWarnings)).join(' / '):degraded.length?'⚠ '+Array.from(new Set(degraded)).map(w.RiskSheet.sourceName).join(', ')+' 자료 없음':'');
            if(selected){layer.setSelection(selected.kind==='briefing'?null:selected.kind,selected.id);await detail();}
        }
        function sync() {
            if(syncPending)return syncPending;
            syncPending=(async function(){
                try {
                    var updated=await api.get('meta',{},true);if(!enabled||disposed)return;
                    var followNow=!t||!meta||t===meta.now;
                    if(state.coast&&coastVersion!==updated.versions.spots){try{table.coast=await api.get('coast/spots',{},true);coastVersion=updated.versions.spots;}catch(e){if(!w.RiskMarine)throw e;console.warn('[위험예측] 연안 위치 요청 실패',failureInfo(e));}}
                    if(!enabled||disposed)return;
                    if(meta&&updated.versions.cells!==meta.versions.cells)table.sea={cells:[]};
                    var accidentVersionChanged=meta&&updated.versions.accident!==meta.versions.accident;
                    var accidentCreatedAt=updated.sources&&updated.sources.accident&&updated.sources.accident.createdAt;
                    var oldAccidentCreatedAt=meta&&meta.sources&&meta.sources.accident&&meta.sources.accident.createdAt;
                    if(meta&&(accidentVersionChanged||accidentCreatedAt!==oldAccidentCreatedAt)){seq++;api.clear();accidentFresh=true;}
                    if(accidentVersionChanged){table.accident={cells:[]};layer.drawAccident({cells:[]});}
                    meta=updated;t=followNow?meta.now:nearest(w.RiskMarine&&state.sea?seaTimes():selectionTimes(selected?selected.kind:'coast'),t);marineTime();
                    layer.setTables(table.sea,table.coast,table.accident,table.traffic);
                    // 부가 경계 실패가 독립 해상 프레임까지 막지 않는다. OFF 뒤에는 결과를 그리지 않는다.
                    if(!w.RiskMarine&&!boundariesLoaded){await layer.boundaries(api);boundariesLoaded=true;}
                    if(w.RiskMarine&&!boundariesLoaded&&!boundaryPending){boundaryPending=layer.boundaries(api).then(function(){boundariesLoaded=true;}).catch(function(e){console.warn('[위험예측] 부가 경계 요청 실패',failureInfo(e));}).finally(function(){boundaryPending=null;});}
                    if(!enabled||disposed)return;
                    if(selected)w.RiskSlider.mount(sheet.timelineEl,selectionTimes(selected.kind),selected.at||t,function(value){if(selected){selected.at=value;detail();}});
                    await refresh();
                }catch(e){console.warn('[위험예측] 자료 갱신 실패',failureInfo(e));if(enabled&&!disposed)message('위험예측 갱신 실패 — '+e.message);}
                finally{syncPending=null;}
            })();
            return syncPending;
        }
        function setEnabled(value){enabled=!!value;seq++;if(!enabled){clearSelection();legend.hidden=true;layer.setActive(state,false);if(colorLegend)colorLegend.hidden=true;marineTime();message('');if(oldBase&&w.oceanSetBasemap){w.oceanSetBasemap(oldBase);oldBase=null;}}else{if(w.oceanGetBasemap&&w.oceanSetBasemap){oldBase=w.oceanGetBasemap();w.oceanSetBasemap('coast');}legend.hidden=false;if(colorLegend)colorLegend.hidden=!state.sea;marineTime();sync();}}
        function escapeSheet(e){if(e.key==='Escape'&&enabled&&(selected||choosing)&&!document.querySelector('.rf-modal')){e.preventDefault();clearSelection();}}
        document.addEventListener('keydown',escapeSheet);
        if(options.enabled===false){legend.hidden=true;if(colorLegend)colorLegend.hidden=true;layer.setActive(state,false);}
        var ready=enabled?sync():Promise.resolve();
        var timer=setInterval(function(){if(enabled&&!disposed)sync();},60000);
        return {ready:ready,setEnabled:setEnabled,select:select,refresh:refresh,tryHandleClick:function(evt){return enabled?layer.hit(evt):false;},getState:function(){return {enabled:enabled,coast:state.coast,sea:state.sea,t:t,selected:selected&&{kind:selected.kind,id:selected.id}};},destroy:function(){disposed=true;clearInterval(timer);document.removeEventListener('keydown',escapeSheet);seq++;clearSelection();layer.destroy();if(colorLegend)colorLegend.remove();if(timeBar){timeBar.remove();document.body.classList.remove('rf-sea-time-on');}}};
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
        var instance=null,pending=false,enabled=false,unlockCount=0,unlocked=false;
        btn.classList.add('rf-preview-locked');btn.setAttribute('aria-disabled','true');
        // disabled 속성은 클릭을 받지 못하므로 첫9회는 캡처 단계에서 막는다.
        btn.addEventListener('click',function(e){if(unlocked)return;if(++unlockCount<10){e.preventDefault();e.stopImmediatePropagation();return;}unlocked=true;btn.classList.remove('rf-preview-locked');btn.setAttribute('aria-disabled','false');},true);
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
