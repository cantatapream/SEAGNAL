/**
 * ============================================================================
 * 파일명: client/js/marine-life/risk-forecast/risk_forecast.js
 * 역할  : 해상 지도 [위험 예측](공식 사고예보)·[혼잡도](지금 밀집도·미래 혼잡예보) 두 칸 선택을 단일 격자 지도와 상세와 연안·해상 공통 하단 시각 버튼(-6H~+6H 5개, 2026-10-16)에 연결하고 시트 시각과 뒤로가기를 조율한다.
 *         (2026-10-15 조작부 시안 — 「표시 항목」 접이식 폐지. 종합 관심단계는 같은 날 폐지.)
 *         사용자가 누른 동작이 250ms 넘게 걸리면 지도 가운데 스피너·이전 색 흐림, 실패면 「잠시 후 다시 시도해 주세요」 2초(2026-10-16 T4).
 * [연계]
 *  - 사용하는 파일 : 같은 폴더 위험예측 모듈 / OpenLayers(지도 모듈) / style.css .spinner(기다림 표시) · risk_forecast.css .rf-map-wait
 *  - 서버 API      : /api/risk-forecast/* (routes/risk_forecast.js) — 해상 시트는 sea/analysis 뒤 sea/traffic-history?days=15
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
        var map=options.map,api=w.RiskAPI.create(),enabled=options.enabled!==false,state={coast:true,sea:false},meta=null,t=null,selected=null,choosing=false,seq=0,detailSeq=0,table={coast:{spots:[]},sea:{cells:[]},accident:{cells:[]},traffic:{cells:[]}},oldBase=null,bannerText='',disposed=false,boundariesLoaded=false,syncPending=null,accidentFresh=false,marineMode='risk',coastVersion=null,boundaryPending=null;
        var legend=options.legendEl,sheetEl=options.sheetEl,banner=options.bannerEl;
        var layer=w.RiskMapLayer.create(map,select),sheet=w.RiskSheet.create(sheetEl,{close:clearSelection,hazard:hazard,basis:w.RiskBasis.open,choose:select,marinePoint:function(lon,lat){var pad=visiblePadding();select('marine','point',{lon:lon,lat:lat});var xy=ol.proj.fromLonLat([lon,lat]);map.getView().fit([xy[0]-50,xy[1]-50,xy[0]+50,xy[1]+50],{padding:pad,maxZoom:14,duration:250});},retry:function(){api.clear();refresh();}});
        legend.innerHTML='<div class="banzone-legend" role="group" aria-label="위험예측 보기"><button type="button" class="bzl-row on" data-layer="coast" aria-pressed="true"><span class="bzl-name">연안 위험 예측·분석</span><span class="bzl-switch" aria-hidden="true"></span></button><button type="button" class="bzl-row" data-layer="sea" aria-pressed="false"><span class="bzl-name">해상 위험 예측·분석</span><span class="bzl-switch" aria-hidden="true"></span></button></div><div class="rf-map-legend" hidden><div class="rf-accident-key" data-sea-legend hidden>점·점선 = 공단 선박 혼잡 (실제 선박 위치·척수 아님) <span><i style="border:2px dashed #b8c5da;background:transparent"></i>낮음</span> · <span><i style="border:2px dashed #74b9ff;background:transparent"></i>보통</span> · <span><i style="border:2px dashed #d47cff;background:transparent"></i>높음</span> · <span><i style="border:2px dashed #ff5fe3;background:transparent"></i>매우높음</span></div><div class="rf-accident-key" data-accident-legend hidden>면 = 공단 선박 사고예보 <span><i style="background:#2fb36b"></i>낮음</span> · <span><i style="background:#f2c230"></i>보통</span> · <span><i style="background:#fb923c"></i>주의</span> · <span><i style="background:#e0322c"></i>경계</span></div></div>';
        if(w.RiskMarine){legend.classList.add('rf-marine-compact');legend.querySelector('.rf-map-legend').innerHTML='<div data-sea-legend hidden><strong class="rf-marine-caption" data-marine-caption>공식 사고예보</strong><div data-accident-legend hidden class="rf-mini-key"></div></div>';}
        if(w.RiskMarine){
            // 해상 ON 일 때만 바로 아래 두 칸 단일 선택 [혼잡도][위험 예측](2026-10-15 조작부 시안). 「표시 항목」 접이식·「~ 표출 중」 뱃지는 없앴다.
            legend.querySelector('.banzone-legend').insertAdjacentHTML('beforeend','<div data-marine-tools hidden><div class="rf-seg" role="radiogroup" aria-label="해상 표시"><button type="button" role="radio" data-marine-mode="congestion" aria-checked="false">혼잡도</button><button type="button" role="radio" data-marine-mode="risk" aria-checked="true">위험 예측</button></div></div>');
            legend.querySelector('.rf-map-legend').hidden=true;
        }
        if(w.RiskMarine){var colorLegend=document.createElement('div');colorLegend.className='rf-color-legend accident-grid-legend';colorLegend.setAttribute('aria-label','위험예측 색상 범례');var caption=legend.querySelector('[data-marine-caption]'),key=legend.querySelector('[data-accident-legend]');caption.classList.add('agl-title');colorLegend.appendChild(caption);colorLegend.appendChild(key);colorLegend.hidden=true;map.getTargetElement().parentElement.appendChild(colorLegend);}
        // 연안 색 범례(2026-10-16 사용자 「그런데 지금 지도에 색상에 따른 범례가 안보이는데 ?」) — 연안 원은 4단계 색인데 범례가 원래 없었다.
        // 같은 날 「범례는 해상위험예측과 동일한 위치에 배치하도록 해줘」 → 왼쪽 위 토글 아래가 아니라 해상 색 범례와 같은 왼쪽 아래 상자(.rf-color-legend) 위쪽에 둔다.
        // 「위험지수(연안)」 제목 + 4칸 색 막대(RiskFormat.BAND_COLORS) + 단계 이름. 보임은 colorLegendSync 가 정한다. 옛 경로(RiskMarine 없음)에는 이 상자가 없어 만들지 않는다.
        var coastKey=null,bands=(w.RiskFormat||{}).BAND_COLORS;
        if(colorLegend&&bands){var names=['평소 수준','다소 높음','높음','매우 높음'];coastKey=document.createElement('div');coastKey.className='rf-coast-key';coastKey.setAttribute('data-coast-key','');coastKey.innerHTML='<strong class="rf-coast-key-title">위험지수(연안)</strong><div class="rf-gradient-bar" aria-hidden="true" style="background:linear-gradient(to right,'+names.map(function(n,i){return bands[n]+' '+i*25+'% '+(i+1)*25+'%';}).join(',')+')"></div><div class="rf-gradient-labels">'+names.map(function(n){return '<span>'+n+'</span>';}).join('')+'</div>';colorLegend.insertBefore(coastKey,colorLegend.firstChild);}
        /** 왼쪽 아래 색 범례 상자를 켠 층에 맞춘다. 연안만 → 연안 범례만, 해상만 → 해상만, 둘 다 → 위아래 둘 다(제목으로 구분), 둘 다 끔·위험예측 끔 → 상자 숨김.
         * 예: state {coast:true,sea:false} → 상자 보임·[data-coast-key] 보임·해상 제목과 막대 숨김
         * @returns {void} [연계] ← 층 토글 클릭·refresh·setEnabled. 해상 제목·막대 내용은 marineLegend 가 채운다. */
        function colorLegendSync(){if(!colorLegend)return;var coast=!!coastKey&&state.coast;colorLegend.hidden=!enabled||!(state.sea||coast);if(coastKey)coastKey.hidden=!coast;colorLegend.querySelector('[data-marine-caption]').hidden=!state.sea;colorLegend.querySelector('[data-accident-legend]').hidden=!state.sea;}
        /** 해상 범례(왼쪽 아래 색 막대)와 두 칸 선택 상태를 갱신한다.
         * 예: 위험 예측 → 「위험 예측」 낮음·보통·주의·경계(위험 색) · 혼잡도+지금 → 「밀집도 (실시간)」 · 혼잡도+미래 → 「혼잡도 (예보)」(둘 다 낮음·보통·높음·매우높음, 혼잡 색)
         * @param {Object} [frame] - 서버 unified-frame(mode: accident·current·congestion). 없으면 지금 고른 항목·시각으로 정한다.
         * @returns {void} [연계] ← refreshMarine·두 칸 선택·해상 토글 / 색은 RiskMapLayer 면색(RiskMarine.color·congestionColor)과 같다. */
        function marineLegend(frame){if(!w.RiskMarine)return;var effective=frame?frame.mode:frameMode(t)==='risk'?'accident':frameMode(t);var cong=effective!=='accident',levels=cong?['낮음','보통','높음','매우높음']:['낮음','보통','주의','경계'];(colorLegend||legend).querySelector('[data-accident-legend]').innerHTML='<div class="rf-gradient-bar'+(cong?' rf-pal-cong':'')+'" aria-hidden="true"></div><div class="rf-gradient-labels">'+levels.map(function(v){return '<span>'+v+'</span>';}).join('')+'</div>';(colorLegend||legend).querySelector('[data-accident-legend]').style.display='';var title=(colorLegend||legend).querySelector('[data-marine-caption]'),name=effective==='accident'?'위험 예측':effective==='current'?'밀집도 <small>(실시간)</small>':'혼잡도 <small>(예보)</small>',changed=title.dataset.meaning&&title.dataset.meaning!==effective;title.innerHTML=name;title.setAttribute('aria-live','polite');if(changed){title.classList.remove('rf-legend-change');void title.offsetWidth;title.classList.add('rf-legend-change');}title.dataset.meaning=effective;legend.querySelectorAll('[data-marine-mode]').forEach(function(b){b.setAttribute('aria-checked',String(b.dataset.marineMode===marineMode));});}
        /** 지금 고른 항목과 시각으로 서버 지도 mode 를 정한다. 예: 위험 예측 → 'risk'; 혼잡도+지금 → 'current'(실시간 밀집도); 혼잡도+미래 → 'congestion'(혼잡 예보).
         * @param {string} at - 메인 시각 ISO @returns {string} unified-frame mode
         * [연계] ← refreshMarine·marineLegend / 시각을 바꾸면 혼잡도는 저절로 밀집도↔혼잡 예보로 바뀐다(종전엔 미래로 가면 위험 예측으로 돌렸다). */
        function frameMode(at){return marineMode!=='congestion'?'risk':meta&&at&&at!==meta.now?'congestion':'current';}
        // ── 지도 기다림 표시(2026-10-16 T4, 사용자 「추천대로」) ─────────────────────────────
        // 사용자가 누른 동작(토글 ON·시간 버튼·[혼잡도/위험 예측]·위험예측 켜기)만 250ms 넘게 걸리면 지도 가운데 스피너를 띄우고
        // 이전 지도 색을 흐리게 한다(「글자는 새 시각, 색은 옛 시각」 혼동 방지). 60초 자동 갱신에는 띄우지 않는다.
        // 실패하면 원인은 말하지 않고 「잠시 후 다시 시도해 주세요」만 2초 — 과제16(공개 지도 원천 오류 숨김)과 같은 취지(README 「지도 기다림 표시」).
        // WAIT_LIMIT_MS(안전 타이머) 50초의 근거: risk_api.js 한 요청의 최악은 15초 제한 × 3회 + 재시도 대기 0.3초·0.9초 = 약46.2초.
        //   그보다 조금 길게 잡아 정상적인 느린 응답은 끊지 않고, 끄는 길을 놓친 경우에도 스피너가 영원히 돌지 않게 한다.
        //   메타→연안 위치→프레임처럼 요청이 이어지면 46초를 넘을 수 있다 — 그때는 50초에 안내만 띄우고, 늦게 온 응답은 그대로 그린다.
        var WAIT_SHOW_MS=250,WAIT_LIMIT_MS=50000,WAIT_FAIL_MS=2000,waiting=null,waitFailTimer=null,waitEl=null;
        if(map.getTargetElement&&map.getTargetElement()){waitEl=document.createElement('div');waitEl.className='rf-map-wait';waitEl.hidden=true;waitEl.setAttribute('role','status');waitEl.setAttribute('aria-live','polite');waitEl.innerHTML='<div class="spinner" data-wait-spin aria-hidden="true"></div><p data-wait-msg hidden>잠시 후 다시 시도해 주세요</p>';map.getTargetElement().parentElement.appendChild(waitEl);}
        /** 사용자가 누른 동작의 기다림을 시작한다. 250ms 안에 지도가 다 그려지면 아무것도 보이지 않는다.
         * 예: +3H 누름 → waitStart() → refresh() 가 자기 세대 n 을 waiting.n 에 묶고, 끝나면 waitEnd. 연타하면 마지막 동작의 refresh 에 다시 묶인다.
         * @returns {void} [연계] ← 시간 버튼·두 칸 선택·층 토글 ON·setEnabled(true) / → refresh(묶기)·waitEnd(끄기). 60초 자동 갱신(sync)은 부르지 않는다. */
        function waitStart(){if(!waitEl)return;clearTimeout(waitFailTimer);waitEl.querySelector('[data-wait-msg]').hidden=true;
            if(!waiting){waiting={n:null,shown:false};waiting.show=setTimeout(function(){if(!waiting)return;waiting.shown=true;waitEl.querySelector('[data-wait-spin]').hidden=false;waitEl.hidden=false;if(layer.dim)layer.dim(true);},WAIT_SHOW_MS);}
            // 이전 동작에 묶인 refresh 가 늦게 끝나도 끄지 않는다(새 동작의 refresh 가 다시 묶을 때까지 n=null).
            waiting.n=null;clearTimeout(waiting.limit);waiting.limit=setTimeout(function(){waitEnd(true);},WAIT_LIMIT_MS);}
        /** 기다림 표시를 끈다. 실패면 원인 없이 「잠시 후 다시 시도해 주세요」를 2초 보인다.
         * 예: waitEnd(false) → 스피너·흐림 해제; waitEnd(true) → 같은 자리에 안내 2초 뒤 사라짐.
         * @param {boolean} failed - 사용자가 기다린 지도 요청이 실패(또는 안전 타이머 만료)했나
         * @returns {void} [연계] ← refresh finally(n===seq·자기 세대)·sync catch(아직 refresh 에 묶이기 전 실패)·setEnabled(false)·destroy·안전 타이머 */
        function waitEnd(failed){if(!waitEl)return;if(waiting){clearTimeout(waiting.show);clearTimeout(waiting.limit);waiting=null;}
            if(layer.dim)layer.dim(false);clearTimeout(waitFailTimer);waitEl.querySelector('[data-wait-spin]').hidden=true;
            var msg=waitEl.querySelector('[data-wait-msg]');msg.hidden=!failed;waitEl.hidden=!failed;
            if(failed)waitFailTimer=setTimeout(function(){msg.hidden=true;waitEl.hidden=true;},WAIT_FAIL_MS);}
        // 화면 하단은 지도 출처 위가 아니라 출처와 메인 탭 사이에 놓는다.
        var timeBar=null,toastEl=null,toastTimer=null,TOAST_MS=2000;
        if(w.RiskMarine){
            timeBar=document.createElement('div');timeBar.className='rf-marine-timebar';timeBar.hidden=true;
            timeBar.setAttribute('role','group');timeBar.setAttribute('aria-label','연안·해상 조회 시각');
            // 2026-10-16 사용자 「-12 -6h - 3h 현재 +3h, +6h +12로 버튼을 만들고 … 왼쪽에 0월 0일 금요일 10:00은 빼도록 하고 … 버튼 내에 작은 글씨로」:
            // 2026-10-16 사용자 후속 「이 시안을 보니까 버튼이 높아지네 ? +12 -12버튼은 빼도록 하자. 그리고 버튼을 좀더 넓게 사용하도록 하자.」 → 5버튼, 갈 시각은 한 줄.
            // 왼쪽 날짜 output 을 없애고 5버튼, 각 버튼 아래 줄에 그 버튼을 누르면 갈 시각(현재 버튼은 지금 시각). 선택 시각은 화면에 안 보이는 글자(data-map-time)로 남기고,
            // 바꿀 때 읽어 주는 일(종전 output 의 aria-live)은 아래 시각 토스트가 한다 — 둘 다 aria-live 면 두 번 읽힌다.
            timeBar.innerHTML='<span class="rf-sr-only" data-map-time></span>'+['-6','-3','now','3','6'].map(function(h){return '<button type="button" data-time-step="'+h+'"><b>'+(h==='now'?'현재':(h.charAt(0)==='-'?h:'+'+h)+'H')+'</b><small data-time-at></small></button>';}).join('');
            map.getTargetElement().parentElement.appendChild(timeBar);
            // 2026-10-16 사용자 「그러면 토스트 메시지로 하단에 뜨면 되는거 아니니 ?」 — 왼쪽 날짜를 없애 지금 보는 시각을 알 길이 없어진 것을
            // 시간 버튼을 누를 때마다 바 바로 위 가운데 토스트(약 2초)로 알린다. 스피너·실패 안내(.rf-map-wait)는 지도 가운데라 겹치지 않는다.
            toastEl=document.createElement('div');toastEl.className='rf-time-toast';toastEl.hidden=true;toastEl.setAttribute('role','status');toastEl.setAttribute('aria-live','polite');
            map.getTargetElement().parentElement.appendChild(toastEl);
            timeBar.addEventListener('click',function(e){var b=e.target.closest('[data-time-step]');if(!b||b.disabled||!meta)return;t=b.dataset.timeStep==='now'?meta.now:nextTime(Number(b.dataset.timeStep));marineLegend();marineTime();timeToast();waitStart();refresh();});
        }
        /** 시간 버튼으로 고른 시각을 바 위 토스트로 약 2초 보이고 스크린리더로 읽어 준다. 연타하면 글자를 바꿔 치우고 타이머를 새로 잡아 마지막 것만 남는다.
         * 예: +3H → 「16.(금) 13:00 예보」 · 현재 → 「현재 16.(금) 10:00」
         * @returns {void} [연계] ← 시간 버튼 클릭 / → dayTime. marineTime 이 바를 숨길 때·setEnabled(false)·destroy 에서 같이 숨긴다. */
        function timeToast(){if(!toastEl||!meta)return;var d=dayTime(t);toastEl.textContent=t===meta.now?'현재 '+d[0]+' '+d[1]:d[0]+' '+d[1]+' 예보';toastEl.hidden=false;liftToast();clearTimeout(toastTimer);toastTimer=setTimeout(function(){toastEl.hidden=true;},TOAST_MS);}
        /** 토스트가 지도 아래쪽의 출처(브이월드)·축척·색 범례 상자를 덮으면 그것들 위로 올린다(기본 자리는 시간 줄 바로 위 — CSS).
         * 예: 320px 에서 가운데 토스트가 왼쪽 출처 글자와 겹침 → 출처 윗변 4px 위로; 그 자리가 다시 색 범례와 겹치면 범례 위로.
         * @returns {void} [연계] ← timeToast / 화면에 안 보이는 요소(폭 0)는 건너뛴다. 가짜 DOM 시험(크기 재기 없음)에서는 아무것도 하지 않는다. */
        function liftToast(){toastEl.style.bottom='';if(!toastEl.getBoundingClientRect||!document.querySelectorAll)return;var others=Array.from(document.querySelectorAll('.ol-attribution,.ol-scale-line,.rf-color-legend')).map(function(e){return e.getBoundingClientRect();}).filter(function(r){return r.width>0&&r.height>0;});
            for(var moved=true,i=0;moved&&i<others.length;i++){moved=false;var me=toastEl.getBoundingClientRect();others.forEach(function(r){if(!moved&&r.left<me.right&&me.left<r.right&&r.top<me.bottom&&me.top<r.bottom){toastEl.style.bottom=(w.innerHeight-r.top+4)+'px';moved=true;}});}}
        /** 선택 시각을 기준으로 앞·뒤 3시간 예보 칸으로 이동할 시각을 구한다(없으면 null = 버튼 비활성).
         * 규칙(앞뒤 대칭): 시각마다 그 시각이 든 3시간 칸(00·03·06…시 시작)을 「칸」이라 한다. 지금(meta.now, 예 11:00)의 칸은 09시 칸이다.
         *   목표 칸 = 선택 시각 t 의 칸 ± hours.
         *   + : 목표 칸 이상인 첫 시각(mainTimes). 시간축 끝(내일 21시)을 넘으면 없음 → 비활성.
         *   - : 칸이 목표 칸 이하인 마지막 시각. 목표 칸이 지금의 칸이면 지금(meta.now)으로 돌아가고, 지금의 칸보다 앞이면 없음 → 비활성.
         * 예: 지금 11:00 → +3H 12:00, 다시 +3H 15:00 · 15:00 -3H → 12:00, 12:00 -3H → 11:00(지금) · 지금에서 -3/-6H 는 둘 다 비활성
         *     12:00 에서 -6H 는 목표 06시 칸이 지금의 09시 칸보다 앞이라 비활성 · 15:00 에서 -6H 는 09시 칸 = 지금 · 내일 18:00 에서 +6H 는 비활성(끝 21시)
         * @param {number} hours - -6·-3·3·6 @returns {string|null} 공개 범위 안 KST ISO
         * [연계] ← 하단 버튼 클릭·marineTime(버튼 작은 글씨·비활성) / → mainTimes; 실제 존재하는 예보 시각만 선택한다.
         */
        function nextTime(hours){var slot=function(at){return Math.floor(Date.parse(at)/10800000)*10800000;},target=slot(t||meta.now)+hours*3600000,times=mainTimes();if(hours>0)return times.find(function(at){return Date.parse(at)>=target;})||null;var back=null;times.forEach(function(at){if(slot(at)<=target)back=at;});return back;}
        /** 시각을 버튼 작은 글씨 꼴로 만든다(KST). 예: '2026-10-16T13:00:00+09:00' → 「16.(금) 13:00」 한 줄(HTML, 두 <span> 사이 공백).
         * @param {string} at - ISO 시각 @returns {string} <span> 두 개(숫자·요일만 들어가 이스케이프 불필요)
         * [연계] ← marineTime / → dayTime / 2026-10-16 사용자 「1.(금) 00:00 라고 버튼 내에 작은 글씨로」 — 일(앞 0 없음).(요일) 시:분 */
        function buttonTime(at){var d=dayTime(at);return '<span>'+d[0]+'</span> <span>'+d[1]+'</span>';}
        /** 시각을 [「일.(요일)」, 「시:분」] 으로 나눈다(KST). 예: '2026-10-16T13:00:00+09:00' → ['16.(금)','13:00']
         * @param {string} at - ISO 시각 @returns {string[]} 두 글자 [연계] ← buttonTime(버튼 작은 글씨)·timeToast(토스트) — 같은 꼴을 쓰게 한 곳에서 만든다 */
        function dayTime(at){var local=new Date(Date.parse(at)+32400000),pad=function(n){return String(n).padStart(2,'0');};return [local.getUTCDate()+'.('+['일','월','화','수','목','금','토'][local.getUTCDay()]+')',pad(local.getUTCHours())+':'+pad(local.getUTCMinutes())];}
        /** 버튼마다 갈 시각(작은 글씨)·사용 가능 여부와, 화면에 안 보이는 선택 시각 글자(스크린리더용)를 갱신한다.
         * 예: 지금 11:00 → [현재] 아래 「12.(월) 11:00」(이동해도 그대로)·[+3H] 아래 「12.(월) 12:00」·[-3H] 회색(aria-disabled) 빈칸
         *     숨김 글자 data-map-time = 「조회 시각 10.12.(월) 11:00」(aria-live 없음 — 바꿀 때 읽어 주기는 timeToast)
         * @returns {void} [연계] ← sync·시간버튼·층 스위치 / → nextTime·buttonTime. 현재 복귀는 서버 meta.now를 사용한다.
         */
        function marineTime(){if(!timeBar)return;var shown=enabled&&(state.coast||state.sea);timeBar.hidden=!shown;if(!shown){clearTimeout(toastTimer);toastEl.hidden=true;}var tools=legend.querySelector('[data-marine-tools]');if(tools)tools.hidden=!(enabled&&state.sea);document.body.classList.toggle('rf-sea-time-on',shown);if(!meta)return;var local=new Date(Date.parse(t||meta.now)+32400000),pad=function(n){return String(n).padStart(2,'0');};timeBar.querySelector('[data-map-time]').textContent='조회 시각 '+pad(local.getUTCMonth()+1)+'.'+pad(local.getUTCDate())+'.('+['일','월','화','수','목','금','토'][local.getUTCDay()]+') '+pad(local.getUTCHours())+':'+pad(local.getUTCMinutes());timeBar.querySelectorAll('[data-time-step]').forEach(function(b){var current=b.dataset.timeStep==='now',to=current?meta.now:nextTime(Number(b.dataset.timeStep));b.disabled=!to;b.setAttribute('aria-disabled',String(!to));b.querySelector('[data-time-at]').innerHTML=to?buttonTime(to):'';if(current)b.setAttribute('aria-pressed',String(t===meta.now));});}
        // 두 칸은 늘 하나만 켜진다: 이미 켜진 칸을 다시 눌러도 그대로다. 시각은 바꾸지 않는다.
        if(w.RiskMarine){marineLegend();legend.addEventListener('click',function(e){var b=e.target.closest('[data-marine-mode]');if(b&&b.dataset.marineMode!==marineMode){marineMode=b.dataset.marineMode;marineLegend();waitStart();refresh();}});}
        legend.addEventListener('click',function(e){var b=e.target.closest('[data-layer]');if(!b)return;var kind=b.dataset.layer;state[kind]=!state[kind];if(w.RiskMarine&&kind==='sea'&&state.sea){marineMode='risk';marineLegend();}b.classList.toggle('on',state[kind]);b.setAttribute('aria-pressed',String(state[kind]));if(w.RiskMarine&&meta&&t)t=nearest(mainTimes(),t);var kindKey=legend.querySelector('[data-'+kind+'-legend]');if(kindKey)kindKey.hidden=!state[kind];if(!w.RiskMarine)legend.querySelector('.rf-map-legend').hidden=!state.sea;colorLegendSync();marineTime();if(kind==='sea'){(colorLegend||legend).querySelector('[data-accident-legend]').hidden=!state.sea;marineTime();}if((selected&&(selected.kind===kind||(kind==='sea'&&seaKind(selected.kind)==='sea')))||(choosing&&kind==='coast'))clearSelection();if(state[kind])waitStart();if(!meta)sync();else refresh();});
        function seaKind(kind){return ['accident','traffic','marine','briefing'].includes(kind)?'sea':kind;}
        /** 일반 화면 배너는 띄우지 않는다. 자료 원천 안내는 과제16에 따라 관리자 오류현황으로 보내고,
         * 위성지도 실패도 안내 없이 기본맵으로 바꾼다(사용자 확정 2026-10-15 「마」).
         * 예: message('특보 갱신 지연') → 배너 숨김 유지.
         * @param {string} [text] - 자료 쪽 안내(표시하지 않음 — 과제16) @returns {void} [연계] refresh·sync → banner */
        function message(text) {bannerText=text||'';if(banner){banner.textContent='';banner.hidden=true;}}
        /** 위험예측을 켜면 배경을 위성지도로 바꾼다(켜기 전 배경은 oldBase에 한 번만 기억).
         * 예: 해안도 → 위성지도; 이미 켜진 상태에서 다시 불러도 원래 배경(해안도)을 잃지 않는다.
         * 위성 인증키를 못 받으면 빈 배경 대신 기본맵(rltm)으로 바꾼다 — 일반 화면 안내는 띄우지 않는다(사용자 확정 2026-10-15 「마」).
         * @returns {void} [연계] ← setEnabled·mount / → ocean_map.js oceanSetBasemap·oceanVworldReady */
        function satelliteOn(){
            if(!w.oceanGetBasemap||!w.oceanSetBasemap)return;
            if(oldBase===null)oldBase=w.oceanGetBasemap();
            w.oceanSetBasemap('vworld');
            if(typeof w.oceanVworldReady!=='function')return;
            w.oceanVworldReady().then(function(ok){
                if(ok||!enabled||disposed||w.oceanGetBasemap()!=='vworld')return;
                w.oceanSetBasemap('rltm');if(oldBase==='vworld')oldBase='rltm';
                console.warn('[위험예측] 위성지도 인증 실패 — 기본맵으로 표시');
            });
        }
        /** 위험예측을 끄거나 없앨 때 켜기 전 배경으로 되돌리고 배경 안내를 지운다.
         * 예: 위성지도 → 해안도. 켠 적이 없으면(oldBase 없음) 아무것도 바꾸지 않는다.
         * @returns {void} [연계] ← setEnabled(false)·destroy / → oceanSetBasemap */
        function restoreBasemap(){if(oldBase&&w.oceanSetBasemap)w.oceanSetBasemap(oldBase);oldBase=null;}
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
         * 두 날의 시간별 혼잡 예보와 두 날(오늘·내일)의 3시간별 공식 사고 예보를 한 조회 축으로 합친다.
         * 예: 서버 사고 축은 내일 21시에서 끝난다(2026-10-15 「해상 공식 사고예보는 2일까지만」 — 종전 모레까지). 혼잡 축에 없는 사고 칸은 사고 예보만 조회하고 혼잡 격자는 비운다.
         * @returns {string[]} 지금 이후 KST ISO 시각
         * [연계] selectionTimes → meta.timeline.sea/accident, 원천 간격 매칭은 서버가 한다.
         */
        function seaTimes(){var raw=(meta.timeline.sea&&meta.timeline.sea.times||[]).concat(meta.timeline.accident&&meta.timeline.accident.times||[]),times=Array.from(new Set(raw)).filter(function(at){return Date.parse(at)>=Date.parse(meta.now);});if(w.RiskMarine){var local=new Date(Date.parse(meta.now)+32400000).toISOString().slice(0,10),end=Date.parse(local+'T00:00:00+09:00')+172800000;times=times.filter(function(at){var stamp=Date.parse(at);return stamp>Date.parse(meta.now)&&stamp<end&&stamp%10800000===0;});times.unshift(meta.now);}return times.sort(function(a,b){return Date.parse(a)-Date.parse(b);});}
        /** 선택 대상에 맞는 조회 축을 고른다. 예: accident → 해상 공통 축. [연계] select·sync → seaTimes. */
        function selectionTimes(kind){return kind==='coast'?meta.timeline.coast.times:seaTimes();}
        /**
         * 연안·해상 공통 메인 시각이 고를 수 있는 시각 목록을 만든다.
         * 예: 연안 ON이면 지금~내일 21시(3시간 간격, 서버 연안 축 그대로 — 「가」 2026-10-15 연안 2일 제한); 해상만 ON이면 지금~내일 21시; 둘 다 ON이면 두 축의 합집합(끝이 같다).
         * @returns {string[]} 지금 이후 KST ISO; 서버가 주지 않은 시각은 넣지 않는다
         * [연계] ← 하단 버튼 nextTime·sync·층 스위치 / → meta.timeline.coast, seaTimes. 시트 시각과는 무관하다.
         */
        function mainTimes(){var coast=state.coast&&meta.timeline.coast&&meta.timeline.coast.times||[];coast=coast.filter(function(at){return Date.parse(at)>=Date.parse(meta.now);});return coast.length&&!state.sea?coast:Array.from(new Set(coast.concat(seaTimes()))).sort(function(a,b){return Date.parse(a)-Date.parse(b);});}
        function select(kind,id,location){
            if(kind==='briefing')return;
            if(!enabled||!state[seaKind(kind)]||disposed)return;
            if(Array.isArray(id)){var choices=table.coast.spots.filter(function(p){return id.includes(p.id);});clearSelection();choosing=true;sheet.choose(choices);registerSheet();return;}
            var item=kind==='marine'?{id:id,lon:location&&location.lon,lat:location&&location.lat}:kind==='briefing'?{id:id}:(kind==='coast'?table.coast.spots:table[kind].cells).find(function(p){return p.id===id;});if(!item)return;
            if(!selected||selected.id!==id||selected.kind!==kind)layer.setSelection(kind==='briefing'?null:kind,id);
            choosing=false;selected={kind:kind,id:id,item:item,at:t,location:seaKind(kind)==='sea'&&location&&Number.isFinite(location.lon)&&Number.isFinite(location.lat)?{lon:location.lon,lat:location.lat}:null};
            // 누르는 즉시 시트를 열고 회색 틀을 보인다. 이전 지점의 제목은 남기지 않고 이 지점의 이름(연안만 알고 있음)만 쓴다.
            sheet.loading({title:kind==='coast'&&typeof item.name==='string'?item.name:'',subtitle:''});registerSheet();
            if(meta){selected.at=nearest(selectionTimes(kind),t||meta.now);mountSlider();}detail();
        }
        /** 열린 시트의 시각 조작을 (다시) 그린다. 해상은 막대를 시각별 공식 사고 위험 색, 연안은 시각별 연안 4단계 색(2026-10-16 T7)으로 칠하는 모양이고, 이미 받은 단계 색을 다시 칠한다.
         * 예: 해상 지점 → RiskSlider.mount(...,{risk:true,now:meta.now}) 뒤 levels(selected.levels) · 연안 지점 → {risk:true,now,colors:RiskFormat.BAND_COLORS}
         * @returns {void} [연계] ← select·sync / → RiskSlider.mount; 단계는 detail() 이 상세 응답(해상 outlook.accident·연안 outlook)에서 selected.levels 로 모은다 */
        function mountSlider(){if(!selected||!meta)return;var sea=!!w.RiskMarine&&seaKind(selected.kind)==='sea';var sl=w.RiskSlider.mount(sheet.timelineEl,selectionTimes(selected.kind),selected.at||t,sliderChanged,sea?{risk:true,now:meta.now}:selected.kind==='coast'?{risk:true,now:meta.now,colors:(w.RiskFormat||{}).BAND_COLORS}:undefined);selected.slider=sl||null;if(sl&&sl.levels&&selected.levels)sl.levels(Object.keys(selected.levels).map(function(k){return selected.levels[k];}));}
        /** 시트 시각 조작 값을 받아 그 시각의 상세를 다시 요청한다. 예: 18시로 옮기면 회색 틀 뒤 18시 상세.
         * @param {string} value - 선택 ISO 시각 @returns {void}
         * [연계] ← RiskSlider.mount / 메인 t는 바꾸지 않는다(시간 격리); 늦게 온 이전 시각 응답은 detail()의 세대·시각 검사가 버린다.
         */
        function sliderChanged(value){if(selected){selected.at=value;sheet.loading();detail();}}
        /** 시트가 가린 아래쪽을 뺀 지도 영역의 가운데로 이동하기 위한 fit 여백을 구한다.
         * 예: 지도 0~915px, 시트 윗변 340px → [30,40,605,40] (남은 0~340px의 가운데로)
         * @returns {number[]} [위,오른쪽,아래,왼쪽] px
         * [연계] ← hazard·marinePoint / 연안 위험구역과 해상 관할 해역 이동이 같은 계산을 써서 선택 동작이 어긋나지 않는다.
         */
        function visiblePadding(){var pad=[30,40,30,40];try{var size=map.getSize(),el=map.getTargetElement();if(size&&el&&sheetEl.classList&&sheetEl.classList.contains('open')){var m=el.getBoundingClientRect(),s=sheetEl.getBoundingClientRect(),cover=Math.max(0,m.bottom-s.top);pad[2]=Math.min(cover,Math.max(0,size[1]-pad[0]-60))+30;}}catch(e){/* 지도·시트 크기를 못 재는 환경(미리보기·시험 틀)은 기본 여백으로 이동한다 — 이동만 덜 정확할 뿐 선택은 그대로 된다 */}return pad;}
        async function hazard(id){var snapshot=selected;try{var fc=await api.get('hazard-zones',{ids:id});if(enabled&&selected===snapshot&&selected&&state.coast){layer.showHazards(fc,visiblePadding());sheet.markZone(id);}}catch(e){console.warn('[위험예측] 위험구역 요청 실패',failureInfo(e));if(enabled&&!disposed&&selected===snapshot)message('위험구역 자료를 불러오지 못했습니다 — '+e.message);}}
        async function detail(){
            if(!selected||!enabled)return;var n=++detailSeq,s=selected,at=s.at||t;
            try{var params={id:s.id,t:at};if(s.location){params.lon=s.location.lon;params.lat=s.location.lat;}var d=await api.get(s.kind==='briefing'?'sea/briefing':w.RiskMarine&&seaKind(s.kind)==='sea'?'sea/analysis':s.kind==='accident'?'sea/accident-cell':s.kind+'/'+(s.kind==='coast'?'spot':'cell'),params);if(n!==detailSeq||!enabled||selected!==s||(s.at||t)!==at)return;sheet.show(d,s.kind,s.item,meta?{now:meta.now}:undefined);registerSheet();
                var out=d&&(d.marine?d.marine.outlook&&d.marine.outlook.accident:d.outlook);if(out&&out.length){s.levels=s.levels||{};out.forEach(function(r){if(r&&r.forecastAt)s.levels[r.forecastAt]=r;});if(s.slider&&s.slider.levels)s.slider.levels(out);}if(d&&d.marine)trafficHistory(n,s,at,d.marine);}   // 시각 막대 칸 색: 해상 outlook.accident · 연안 outlook(2026-10-16 T7)
            catch(e){console.warn('[위험예측] 상세 요청 실패',failureInfo(e));if(n===detailSeq&&enabled&&selected===s&&(s.at||t)===at){sheet.error(e.message);registerSheet();}}
        }
        /** 해상 시트의 「과거 2주간 선박교통량」 이력을 받아 카드를 채운다. 칸이 없으면 요청하지 않는다(카드는 「-」).
         * 예: GR4_F4K23_P4 → GET sea/traffic-history?cell=GR4_F4K23_P4&days=15 — 지금 30분 칸을 끝으로 하는 14일(672칸)과
         *     「평균 HH:MM」의 최근 14번을 다 덮으려면 오늘 포함 달력일 15일이 필요하다(서버 days 는 오늘 포함 달력일).
         * @param {number} n - 상세 세대 @param {Object} s - 선택 @param {string} at - 시트 시각 @param {Object} m - marine
         * @returns {Promise<void>} [연계] ← detail / → RiskSheet.trafficHistory → RiskMarine.fillTraffic. 늦은 응답은 detail 과 같은 검사로 버린다. */
        async function trafficHistory(n,s,at,m){var cell=w.RiskMarine.cellOf&&w.RiskMarine.cellOf(m);if(!cell||!sheet.trafficHistory)return;
            try{var h=await api.get('sea/traffic-history',{cell:cell,days:15});if(n!==detailSeq||!enabled||selected!==s||(s.at||t)!==at)return;sheet.trafficHistory(cell,h);}
            catch(e){console.warn('[위험예측] 교통량 이력 요청 실패',failureInfo(e));if(n===detailSeq&&enabled&&selected===s&&(s.at||t)===at)sheet.trafficHistory(cell,null,'error');}}
        /** 연안 요청·부가 경계를 기다리지 않고 해상 지도부터 표시한다.
         * 예: 연안 요청이 늦어도 정상 해상 프레임은 먼저 그린다.
         * @param {number} n - 요청 세대 @param {string} at - 메인 시각
         * @returns {Promise<object>} 안전한 오류·결측 안내
         * [연계] ← refresh / 지도 버전 검증과 OFF·시간변경 경쟁을 보존한다.
         */
        async function refreshMarine(n,at){var errors=[],sourceWarnings=[];
            try{
                var mode=frameMode(at),pair=await Promise.all([api.get('sea/unified-cells'),api.get('sea/unified-frame',{mode:mode,t:at})]),currentTable=pair[0],currentFrame=pair[1];
                if(n!==seq||!enabled||disposed)return {errors:[],warnings:[]};
                if(currentTable.v!==currentFrame.v){pair=await Promise.all([api.get('sea/unified-cells',{},true),api.get('sea/unified-frame',{mode:mode,t:at},true)]);currentTable=pair[0];currentFrame=pair[1];}
                if(n!==seq||!enabled||disposed)return {errors:[],warnings:[]};if(currentTable.v!==currentFrame.v)throw Error('격자 버전 변경');
                table.traffic=currentTable;layer.drawUnified(currentTable,currentFrame);marineLegend(currentFrame);
                if(!currentFrame.cells.length)sourceWarnings.push('선택 시각의 해상 자료 없음');
            }catch(e){if(n===seq&&enabled&&!disposed){layer.drawUnified({cells:[]},{cells:[]});errors.push('해상 자료를 불러오지 못했습니다. 잠시 후 다시 시도합니다.');}console.warn('[위험예측] 해상 통합 지도 요청 실패',failureInfo(e));}
            return {errors:errors,warnings:sourceWarnings};
        }
        async function refresh(){
            if(!meta||disposed)return;var n=++seq,at=t,freshAccident=accidentFresh,drawn=false;if(waiting)waiting.n=n;layer.setActive(state,enabled);legend.hidden=!enabled;colorLegendSync();
            if(!enabled){message('');return;}
            // 지도 기다림 표시는 이 try 의 finally 에서 끈다 — 중간 반환(n!==seq)·예외에도 빠짐없이, 상세(detail)를 기다리기 전에.
            try{
            var frames=[],errors=[],degraded=[],sourceWarnings=[],kinds=(w.RiskMarine?['coast']:['coast','sea','accident']).filter(function(k){return state[k==='accident'?'sea':k];});
            var marineJob=w.RiskMarine&&state.sea?refreshMarine(n,at):Promise.resolve({errors:[],warnings:[]});
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
                    // 원천 예보의 간격은 서버가 맞춘다. 두 층은 선택한 한 시각을 공유한다(특보 구역은 그리지 않음 — 2026-10-15).
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
            var marineResult=await marineJob;if(n!==seq||!enabled||disposed)return;errors=errors.concat(marineResult.errors);sourceWarnings=sourceWarnings.concat(marineResult.warnings);
            message(errors.length?'위험예측 자료를 불러오지 못했습니다 — '+errors.join(' / '):sourceWarnings.length?'⚠ '+Array.from(new Set(sourceWarnings)).join(' / '):degraded.length?'⚠ '+Array.from(new Set(degraded)).map(w.RiskSheet.sourceName).join(', ')+' 자료 없음':'');
            drawn=!errors.length;
            }finally{if(waiting&&waiting.n===n&&n===seq)waitEnd(!drawn);}
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
                    meta=updated;t=followNow?meta.now:nearest(w.RiskMarine?mainTimes():selectionTimes(selected?selected.kind:'coast'),t);marineTime();
                    layer.setTables(table.sea,table.coast,table.accident,table.traffic);
                    // 부가 경계 실패가 독립 해상 프레임까지 막지 않는다. OFF 뒤에는 결과를 그리지 않는다.
                    if(!w.RiskMarine&&!boundariesLoaded){await layer.boundaries(api);boundariesLoaded=true;}
                    if(w.RiskMarine&&!boundariesLoaded&&!boundaryPending){boundaryPending=layer.boundaries(api).then(function(){boundariesLoaded=true;}).catch(function(e){console.warn('[위험예측] 부가 경계 요청 실패',failureInfo(e));}).finally(function(){boundaryPending=null;});}
                    if(!enabled||disposed)return;
                    if(selected)mountSlider();
                    await refresh();
                }catch(e){console.warn('[위험예측] 자료 갱신 실패',failureInfo(e));if(enabled&&!disposed)message('위험예측 갱신 실패 — '+e.message);if(waiting&&waiting.n===null)waitEnd(true);/* refresh 에 묶이기 전(메타 등)에서 실패 — 사용자가 켜고 기다리던 중이면 안내 */}
                finally{syncPending=null;}
            })();
            return syncPending;
        }
        function setEnabled(value){enabled=!!value;seq++;if(!enabled){waitEnd(false);clearSelection();legend.hidden=true;layer.setActive(state,false);colorLegendSync();marineTime();restoreBasemap();message('');}else{satelliteOn();legend.hidden=false;colorLegendSync();marineTime();waitStart();sync();}}
        function escapeSheet(e){if(e.key==='Escape'&&enabled&&(selected||choosing)&&!document.querySelector('.rf-modal')&&!document.querySelector('.rf-acc-pop:not([hidden])')){e.preventDefault();clearSelection();}}
        document.addEventListener('keydown',escapeSheet);
        if(options.enabled===false){legend.hidden=true;if(colorLegend)colorLegend.hidden=true;layer.setActive(state,false);}
        if(enabled)satelliteOn();
        var ready=enabled?sync():Promise.resolve();
        var timer=setInterval(function(){if(enabled&&!disposed)sync();},60000);
        return {ready:ready,setEnabled:setEnabled,select:select,refresh:refresh,tryHandleClick:function(evt){return enabled?layer.hit(evt):false;},getState:function(){return {enabled:enabled,coast:state.coast,sea:state.sea,t:t,selected:selected&&{kind:selected.kind,id:selected.id}};},destroy:function(){disposed=true;clearInterval(timer);document.removeEventListener('keydown',escapeSheet);seq++;waitEnd(false);if(waitEl)waitEl.remove();clearSelection();restoreBasemap();layer.destroy();if(colorLegend)colorLegend.remove();if(timeBar){timeBar.remove();clearTimeout(toastTimer);toastEl.remove();document.body.classList.remove('rf-sea-time-on');}}};
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
