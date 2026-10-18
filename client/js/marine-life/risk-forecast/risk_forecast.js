/**
 * ============================================================================
 * 파일명: client/js/marine-life/risk-forecast/risk_forecast.js
 * 역할  : 해상 지도 [위험 예측](공식 사고예보)·[혼잡도](지금 밀집도·미래 혼잡예보) 두 칸 선택을 단일 격자 지도와 상세와 연안·해상 공통 하단 시각 버튼(-6H~+6H 5개, 2026-10-16)에 연결하고 시트 시각과 뒤로가기를 조율한다.
 *         (2026-10-15 조작부 시안 — 「표시 항목」 접이식 폐지. 종합 관심단계는 같은 날 폐지.)
 *         사용자가 누른 동작이 250ms 넘게 걸리면 지도 가운데 스피너·이전 색 흐림, 실패면 「잠시 후 다시 시도해 주세요」 2초(2026-10-16 T4).
 *         칸·관광지를 누르면 선택 테두리는 즉시, 닫혀 있던 시트는 약 0.2초 뒤 아래에서 올라온다(2026-10-16). 시트가 열려 있는 동안 지도 클릭은 무시(T24 「나. 무시」).
 *         연안은 날짜(KST)당 하나 — 그날 가장 높은 값(T24). 연안만 켜면 하단 시간 바 대신 화면 가운데 위쪽 날짜 넘기기(항행경보 날짜 줄 모양),
 *         해상도 켜면 하단 시간 버튼 그대로·연안은 그 시각의 날짜. 연안 시트의 날짜 < > 와 함께 움직인다.
 *         「활동지점 안전 브리핑」 바로가기용 RiskForecast.openAt·goTo(그 층·시각·칸/관광지로 이동, 2026-10-16 §11.4).
 *         바로가기로 고른 칸·관광지는 시트 위로 보이는 지도 띠의 가운데로 옮기고 칸 전체가 그 띠에 들어오게 맞춘다(시트 높이는 재서 — 2026-10-17 frameTo).
 * [연계]
 *  - 사용하는 파일 : 같은 폴더 위험예측 모듈 / OpenLayers(지도 모듈) / style.css .spinner(기다림 표시) · risk_forecast.css .rf-map-wait
 *                    · shared/utils/utils.js(trackUsage·withUsageSuppressed — 사용량 「위험예측」 묶음, 키 이름표 shared/utils/usage_keys.js)
 *                    · index2.html 항행경보 날짜 줄 CSS(.navwarn-date-nav·.navwarn-nav-btn·.navwarn-date-label·.navwarn-date-tag — 연안 날짜 넘기기가 그대로 씀, T24)
 *  - 서버 API      : /api/risk-forecast/* (routes/risk_forecast.js) — 해상 시트는 sea/analysis 뒤 sea/traffic-history?days=15
 *  - 마크업        : index2.html #risk-forecast-sheet / #risk-forecast-legend
 *  - 나를 쓰는 곳  : risk_forecast.js 또는 index2.html / risk_forecast_preview.html · forecast/station-briefing/station_briefing.js(RiskForecast.openAt)
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
     * 사용량 통계에 1건 보낸다(shared/utils/utils.js trackUsage — 없으면 조용히 넘어간다). 키 이름표는 shared/utils/usage_keys.js 「위험예측」 묶음.
     * 집계 규칙(사용자 2026-10-18 *"위험예측 버튼을 누르고 각 토글을 누르면 1건, 그리고 격자를 눌러서 바텀시트를 열면 한건"*): 위험예측 켬·스위치 켬·해상 표시 선택·지도에서 칸·관광지를 눌러 시트를 열 때.
     * 예: usage('risk.on') → POST /api/usage {feature:'risk.on'}
     * @param {string} key - 'risk.*' 기능 키 @returns {void}
     * [연계] ← bindApp 버튼·mount 의 범례 스위치·mapSelect / → window.trackUsage(utils.js) → routes/usage.js
     */
    function usage(key){if(typeof w.trackUsage==='function')w.trackUsage(key);}
    /**
     * fn 을 사용량 집계 없이 실행한다(프로그램이 대신 누르는 클릭 — 브리핑 바로가기가 위험예측 버튼·층 스위치를 누를 때). 사람이 누른 것만 센다(usage_keys.js 규칙).
     * 예: quiet(function(){btn.click();}) → 그 클릭의 'risk.on' 은 0건
     * @param {Function} fn @returns {void}
     * [연계] ← goTo·RiskForecast.openAt / → window.withUsageSuppressed(utils.js — 없으면 그냥 실행)
     */
    function quiet(fn){if(typeof w.withUsageSuppressed==='function')w.withUsageSuppressed(fn);else fn();}
    /**
     * API·지도·스위치·슬라이더·상세 시트의 상태를 조율한다.
     * 예: RiskForecast.mount({map,sheetEl,legendEl,bannerEl})
     * @param {Object} options - 지도·시트·범례·배너·초기 enabled
     * @returns {Object} ready·setEnabled·select·refresh·getState·synced·destroy API
     *          (getState().selected.location·synced() — 2026-10-16 탭 왕복 시 시트 다시 열기용, life_safety.js 1-3 절)
     * [연계] index2·미리보기 → RiskAPI·RiskMapLayer·RiskSheet
     */
    function mount(options) {
        var map=options.map,api=w.RiskAPI.create(),enabled=options.enabled!==false,state={coast:true,sea:false},meta=null,t=null,selected=null,choosing=false,seq=0,detailSeq=0,table={coast:{spots:[]},sea:{cells:[]},accident:{cells:[]},traffic:{cells:[]}},oldBase=null,bannerText='',disposed=false,boundariesLoaded=false,syncPending=null,accidentFresh=false,marineMode='risk',coastVersion=null,boundaryPending=null;
        var legend=options.legendEl,sheetEl=options.sheetEl,banner=options.bannerEl;
        // goTo(브리핑 바로가기)로 고른 칸을 시트 위 지도 띠 가운데에 맞추는 중인 상태 — {s:그 선택, extent:맞출 범위, bottom:마지막에 쓴 아래 여백, rendered:상세가 그려졌나}.
        // 상세가 그려진 뒤 실제 시트 높이로 한 번 고치거나, 다른 칸을 고르거나 닫거나 사용자가 지도를 끌면 null(그 뒤로는 지도를 다시 움직이지 않는다). [연계] frameTo·fitFrame·framed·clearSelection
        var framing=null;
        var OPEN_DELAY_MS=200; // 선택 테두리를 먼저 보이고 시트를 올리기까지(사용자 2026-10-16 「약간의 딜레이(0.2초?)」). 지도 스피너의 250ms(waitStart)와는 따로다 — 그것은 지도 색 요청을 기다릴 때만.
        /** 시트 열림 가드(T24 「나. 무시」, 2026-10-16): 시트가 열려 있는 동안 지도에서 누른 다른 해상 칸·연안 관광지(같은 위치 관광지 목록 포함)는 무시한다 — 테두리도 그대로.
         * 해양종합정보와 같은 판정이다: ocean_map.js 「시트 열림 가드 — 사용자 합의 Q3」·ocean_bottom_sheet1.js showOceanBottomSheet 는 .open 이면 조용히 return(토스트 없음).
         * 0.2초 대기 중(아직 .open 없음)·닫히는 움직임 중(clear 가 .open 을 먼저 뗌)은 열려 있지 않은 것으로 본다. 누름은 위험예측이 받은 것으로 친다(RiskMapLayer.hit → true) —
         * 그 아래 다른 지도 클릭 처리로 넘어가지 않게. 지도 클릭 경로만 막는다: 시트 안 버튼(같은 위치 관광지 목록·관할 해역 이동)·탭 복귀(life_safety.js)·날짜/시간 버튼은 select 를 바로 부른다.
         * 예: 연안 시트가 열린 채 해상 칸 누름 → 아무것도 바뀌지 않음 / ✕ 로 닫는 0.3초 안에 누름 → 그 칸이 열림
         * 사용량: 시트가 열리면 'risk.sheet.sea'·'risk.sheet.coast' 1건(지도 클릭 경로만 — 브리핑 바로가기·탭 복귀의 select 는 세지 않는다).
         * @param {string} kind @param {string|string[]} id @param {Object} [location] @returns {void} [연계] ← RiskMapLayer.hit(지도 클릭) / → select·usage */
        function mapSelect(kind,id,location){if(sheetEl.classList&&sheetEl.classList.contains('open'))return;select(kind,id,location);
            // [사용량] 지도에서 눌러 시트가 열렸을 때만 1건(해상 칸·연안 관광지 구분). 같은 위치 관광지 목록도 연안 1건 — 목록에서 고르는 것(시트 안 버튼)은 세지 않는다.
            if(Array.isArray(id)?choosing:(selected&&selected.kind===kind&&selected.id===id))usage(seaKind(kind)==='coast'?'risk.sheet.coast':'risk.sheet.sea');}
        var layer=w.RiskMapLayer.create(map,mapSelect),sheet=w.RiskSheet.create(sheetEl,{close:clearSelection,hazard:hazard,basis:w.RiskBasis.open,choose:select,day:function(dir){shiftDay(dir);},marinePoint:function(lon,lat){var pad=visiblePadding();select('marine','point',{lon:lon,lat:lat});var xy=ol.proj.fromLonLat([lon,lat]);map.getView().fit([xy[0]-50,xy[1]-50,xy[0]+50,xy[1]+50],{padding:pad,maxZoom:14,duration:250});},retry:function(){api.clear();refresh();}});
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
        var timeBar=null,toastEl=null,toastTimer=null,TOAST_MS=2000,dateNav=null;
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
            timeBar.addEventListener('click',function(e){var b=e.target.closest('[data-time-step]');if(!b||b.disabled||!meta)return;setMain(b.dataset.timeStep==='now'?meta.now:nextTime(Number(b.dataset.timeStep)));});
            // 연안만 켰을 때 화면 가운데 위쪽 날짜 넘기기(T24, 사용자 2026-10-16 「연안위험 예측에서 하단의 시간대는 + - 해놓은 기획은 빼야겠지 ? 날짜별로 넘겨가며 볼 수 있도록 변경 필요.」
            // · 「우리 앱에서 항행경보가 반영된곳을 보면 화면 가운데 위쪽에 날짜 변경 기능이 있잖아? 그거처럼 말이야.」). 항행경보 날짜 내비게이션(index2.html #navwarn-date-nav)의
            // 마크업·클래스(.navwarn-date-nav·.navwarn-nav-btn·.navwarn-date-label·.navwarn-date-tag — 모양·크기·위치 top:66px 가운데는 index2.html 의 그 규칙 그대로)를 재사용한다.
            // 다른 점: 오늘 앞·내일 뒤 버튼은 비활성(항행경보는 날짜 제한이 없어 비활성 모양이 없다 — 해양종합정보 시트 날짜 버튼의 비활성 opacity .3 을 risk_forecast.css 에 더함),
            // 휴대폰 폭에서 왼쪽 위 위험예측 토글 범례와 겹치면 그 아래로 내린다(placeDateNav — 항행경보는 왼쪽 위 범례가 없다).
            dateNav=document.createElement('div');dateNav.className='navwarn-date-nav rf-date-nav';dateNav.hidden=true;dateNav.setAttribute('role','group');dateNav.setAttribute('aria-label','연안 위험 예측 날짜');
            dateNav.innerHTML='<button type="button" class="navwarn-nav-btn" data-day-step="-1" title="이전 날짜" aria-label="이전 날짜"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button><div class="navwarn-date-label" data-day-label></div><div class="navwarn-date-tag" data-day-tag></div><button type="button" class="navwarn-nav-btn" data-day-step="1" title="다음 날짜" aria-label="다음 날짜"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>';
            map.getTargetElement().parentElement.appendChild(dateNav);
            dateNav.addEventListener('click',function(e){var b=e.target.closest('[data-day-step]');if(b&&!b.disabled)shiftDay(Number(b.dataset.dayStep));});
            if(w.addEventListener)w.addEventListener('resize',placeDateNav);
        }
        /** 시간 버튼으로 고른 시각을 바 위 토스트로 약 2초 보이고 스크린리더로 읽어 준다. 연타하면 글자를 바꿔 치우고 타이머를 새로 잡아 마지막 것만 남는다.
         * 예: +3H → 「16.(금) 13:00 예보」 · 현재 → 「현재 16.(금) 10:00」 · 연안만 켜고 날짜 넘기기(T24) → 「10월 17일 (토) 예보」·오늘로 → 「오늘 10월 16일 (금)」
         * @returns {void} [연계] ← setMain(시간 버튼·날짜 넘기기) / → dayTime·dayLabel. marineTime 이 바·날짜 줄을 모두 숨길 때·setEnabled(false)·destroy 에서 같이 숨긴다. */
        function timeToast(){if(!toastEl||!meta)return;var d=dayTime(t);toastEl.textContent=dateMode()?(dayTag(t)==='오늘'?'오늘 '+dayLabel(t):dayLabel(t)+' 예보'):t===meta.now?'현재 '+d[0]+' '+d[1]:d[0]+' '+d[1]+' 예보';toastEl.hidden=false;liftToast();clearTimeout(toastTimer);toastTimer=setTimeout(function(){toastEl.hidden=true;},TOAST_MS);}
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
         * T24(2026-10-16): 하단 시간 바는 해상이 켜져 있을 때만 보인다. 연안만 켜면 바(와 바 때문에 올리던 출처·축척 — body.rf-sea-time-on)를 숨기고 화면 가운데 위쪽 날짜 넘기기(dateNav)를 보인다.
         *   예: 연안만 → 바 숨김·날짜 줄 「‹ 10월 16일 (금) [오늘] ›」(‹ 비활성) · 해상 켬 → 바 보임·날짜 줄 숨김 · 둘 다 끔 → 둘 다 숨김
         *   연안 지점을 골라 바텀시트가 열려 있는 동안은 위쪽 날짜 줄도 숨긴다 — 시트 머리의 날짜 줄로 넘긴다(사용자 2026-10-18 「바텀시트 자체에서 넘길 수 있으니」). 닫으면(clearSelection) 다시 보인다.
         * @returns {void} [연계] ← sync·시간버튼·날짜 넘기기·층 스위치 / → nextTime·buttonTime·dayInfo·placeDateNav·sheetDay(열린 연안 시트 날짜 줄). 현재 복귀는 서버 meta.now를 사용한다.
         */
        function marineTime(){sheetDay();if(!timeBar)return;var shown=enabled&&state.sea,dated=enabled&&state.coast&&!state.sea;timeBar.hidden=!shown;dateNav.hidden=!dated||!!selected;if(!shown&&!dated){clearTimeout(toastTimer);toastEl.hidden=true;}var tools=legend.querySelector('[data-marine-tools]');if(tools)tools.hidden=!(enabled&&state.sea);document.body.classList.toggle('rf-sea-time-on',shown);if(!meta)return;
            if(dated){var info=dayInfo();dateNav.querySelector('[data-day-label]').textContent=info.label;var tag=dateNav.querySelector('[data-day-tag]');tag.textContent=info.tag;tag.classList.toggle('other',info.tag!=='오늘');[['-1',info.prev],['1',info.next]].forEach(function(x){var b=dateNav.querySelector('[data-day-step="'+x[0]+'"]');b.disabled=!x[1];b.setAttribute('aria-disabled',String(!x[1]));});placeDateNav();}var local=new Date(Date.parse(t||meta.now)+32400000),pad=function(n){return String(n).padStart(2,'0');};timeBar.querySelector('[data-map-time]').textContent='조회 시각 '+pad(local.getUTCMonth()+1)+'.'+pad(local.getUTCDate())+'.('+['일','월','화','수','목','금','토'][local.getUTCDay()]+') '+pad(local.getUTCHours())+':'+pad(local.getUTCMinutes());timeBar.querySelectorAll('[data-time-step]').forEach(function(b){var current=b.dataset.timeStep==='now',to=current?meta.now:nextTime(Number(b.dataset.timeStep));b.disabled=!to;b.setAttribute('aria-disabled',String(!to));b.querySelector('[data-time-at]').innerHTML=to?buttonTime(to):'';if(current)b.setAttribute('aria-pressed',String(t===meta.now));});}
        // ── 연안 하루 값·날짜 넘기기(T24, 사용자 2026-10-16) ─────────────────────────────
        // 「5-하루 하나로 합치기. 해당구역을 클릭하면 해양종합정보의 바텀시트처럼 일 시 왼쪽 오른쪽에 < > 버튼 만들어서 넘길 수 있도록.」
        // 「1. 가」 하루 값 = 그날 3시간 칸 중 가장 높은 값(서버 risk_store.coastDayFrame·coastDayDetail) · 「2. 가」 해상과 함께 켜면 해상 시간 버튼은 그대로, 연안은 그 시각이 든 KST 날짜의 값.
        // 메인 시각 t 는 그대로 하나다. 연안 요청은 t 가 든 날짜의 첫 연안 칸(coastT — 오늘은 지금, 내일은 00시)으로 보내 같은 날짜면 같은 주소(응답 캐시 공유)가 되게 한다.
        /** 시각의 KST 날짜. 예: '2026-10-16T23:00:00+09:00' → '2026-10-16' @param {string} at - ISO @returns {string} YYYY-MM-DD [연계] ← 아래 날짜 함수들·setMain */
        function kstDay(at){return new Date(Date.parse(at)+32400000).toISOString().slice(0,10);}
        /** 지금 이후 연안 시간축(서버 meta.timeline.coast — 첫 칸이 지금, 끝 내일 21시). @returns {string[]} [연계] ← coastT·coastDays */
        function coastTimes(){return (meta.timeline.coast&&meta.timeline.coast.times||[]).filter(function(at){return Date.parse(at)>=Date.parse(meta.now);});}
        /** 연안이 보여 줄 수 있는 날짜들. 예: ['2026-10-16','2026-10-17'](오늘·내일 — U79) @returns {string[]} [연계] ← dayInfo·shiftDay */
        function coastDays(){return Array.from(new Set(coastTimes().map(kstDay)));}
        /** 연안 요청에 보낼 시각 = at 이 든 날짜의 첫 연안 칸(오늘은 지금, 내일은 00시). 예: 내일 15:00 → 내일 00:00 · 오늘 18:00 → 지금
         * @param {string} at - 메인 시각 @returns {string} ISO(그 날짜 칸이 없으면 at 그대로 — 서버가 400 으로 알린다) [연계] ← refresh(coast/frame)·detail(coast/spot)·shiftDay — 서버는 그 날짜의 하루 값을 준다 */
        function coastT(at){var d=kstDay(at);return coastTimes().find(function(x){return kstDay(x)===d;})||at;}
        /** 연안을 날짜로만 보는가 — 연안만 켰을 때(해상이 켜져 있으면 하단 시간 버튼). @returns {boolean} [연계] ← timeToast */
        function dateMode(){return !!dateNav&&enabled&&state.coast&&!state.sea;}
        /** 날짜 글자 — 항행경보 날짜 줄과 같은 꼴(navigational_warning.js _formatDateLabel 「M월 D일 (요일)」). 예: '2026-10-17T00:00:00+09:00' → 「10월 17일 (토)」
         * @param {string} at - ISO @returns {string} [연계] ← dayInfo·timeToast */
        function dayLabel(at){var l=new Date(Date.parse(kstDay(at)+'T00:00:00Z'));return (l.getUTCMonth()+1)+'월 '+l.getUTCDate()+'일 ('+['일','월','화','수','목','금','토'][l.getUTCDay()]+')';}
        /** 날짜 꼬리표 — 항행경보는 오늘이 아니면 「지난 날짜」·「예정」이지만 위험예측은 오늘·내일뿐이라 「오늘」·「내일」. @param {string} at - ISO @returns {string} [연계] ← dayInfo·timeToast */
        function dayTag(at){return ['오늘','내일'][(Date.parse(kstDay(at))-Date.parse(kstDay(meta.now)))/86400000]||'';}
        /** 지금 메인 시각의 날짜와 앞뒤로 갈 수 있는지. 예: 오늘 → {date:'2026-10-16',label:'10월 16일 (금)',tag:'오늘',sheet:"'26. 10. 16.(금)",prev:false,next:true}
         * sheet 는 해양종합정보 시트 날짜 꼴(ocean_bottom_sheet2.js OS.renderHeader 「'YY. M. D.(요) HH:MM」)에서 시각을 뺀 것 — 연안은 날짜당 하나다.
         * @returns {Object} [연계] ← marineTime(지도 날짜 줄)·sheetDay(연안 시트 날짜 줄) */
        function dayInfo(){var at=t||meta.now,days=coastDays(),i=days.indexOf(kstDay(at)),l=new Date(Date.parse(kstDay(at)+'T00:00:00Z'));return {date:kstDay(at),label:dayLabel(at),tag:dayTag(at),sheet:"'"+String(l.getUTCFullYear()).slice(-2)+'. '+(l.getUTCMonth()+1)+'. '+l.getUTCDate()+'.('+['일','월','화','수','목','금','토'][l.getUTCDay()]+')',prev:i>0,next:i>=0&&i<days.length-1};}
        /** 열린 연안 시트의 날짜 줄(< 날짜 >)을 지금 메인 날짜로 맞춘다 — 지도(상단 날짜·하단 시간)에서 날짜가 바뀌면 시트도 같이 바뀐다. 연안 시트가 아니면 아무것도 안 한다.
         * @returns {void} [연계] ← marineTime·mountSlider / → RiskSheet.day */
        function sheetDay(){if(meta&&w.RiskMarine&&selected&&selected.kind==='coast'&&sheet.day)sheet.day(dayInfo());}
        /** 메인 날짜를 하루 앞·뒤로 옮긴다(지도 날짜 줄·연안 시트 < > 공통). 해상이 꺼져 있으면 그 날짜의 첫 칸(오늘=지금·내일=00시 — 항행경보 날짜 이동이
         * 「오늘이면 현재 시각, 그 외 00:00」으로 기준 시각을 되돌리는 것과 같다). 해상이 켜져 있으면 「그 날짜의 같은 시각」이 든 해상 칸(오늘로 돌아올 때 지난 시각이면 지금).
         * 예: 연안만, 오늘 → shiftDay(1) → 내일 00:00 · 해상도 켬, 오늘 15:00 → 내일 15:00 · 지금 13:25 → 내일 12:00(13:25 가 든 칸) · 내일 09:00 → shiftDay(-1), 지금 11:00 → 지금
         * @param {number} dir - -1·1 @returns {void} [연계] ← 날짜 줄 버튼·RiskSheet 날짜 < >(handlers.day) / → setMain */
        function shiftDay(dir){if(!meta)return;var days=coastDays(),target=days[days.indexOf(kstDay(t||meta.now))+dir];if(!target)return;var next=coastT(target+'T00:00:00+09:00');
            if(state.sea){var goal=Date.parse(t||meta.now)+dir*86400000;if(goal<=Date.parse(meta.now))next=meta.now;else{var on=mainTimes().filter(function(at){return kstDay(at)===target&&Date.parse(at)<=goal;});if(on.length)next=on[on.length-1];}}
            setMain(next);}
        /** 메인 시각을 바꾸고 지도·바·날짜 줄·토스트·열린 연안 시트를 함께 맞춘다. 연안 시트는 날짜가 바뀔 때만 회색 틀로 바꿔 그 날짜 값을 바로 요청한다(지도를 기다리지 않음).
         * 예: setMain('2026-10-17T00:00:00+09:00') → 토스트 「10월 17일 (토) 예보」·지도·시트 날짜 함께
         * @param {string} next - 새 메인 시각 @returns {Promise<void>} 지도 갱신(refresh) — 브리핑 바로가기(goTo)만 기다린다 [연계] ← 시간 버튼·shiftDay·goTo / → marineTime·timeToast·waitStart·detail·refresh */
        function setMain(next){var before=t||meta.now;t=next;marineLegend();marineTime();timeToast();waitStart();if(w.RiskMarine&&selected&&selected.kind==='coast'&&kstDay(before)!==kstDay(t)){sheet.loading();detail();}return refresh();}
        /** 날짜 줄은 항행경보와 같은 자리(지도 가운데 위쪽 top 66px — index2.html .navwarn-date-nav)에 두되, 왼쪽 위 위험예측 토글 범례와 겹치면 범례 바로 아래(6px)로 내린다.
         * 예: 380px — 범례 12~175px·날짜 줄 82~298px 가 겹쳐 범례 아래로 · 1280px — 안 겹쳐 66px 그대로. 크기를 잴 수 없는 가짜 DOM 에서는 아무것도 하지 않는다.
         * @returns {void} [연계] ← marineTime(보일 때)·창 크기 변경 / 위치 기준(offsetParent)은 지도 감싸개(.ocean-map-wrapper) */
        function placeDateNav(){if(!dateNav||!dateNav.style)return;dateNav.style.top='';if(dateNav.hidden||!dateNav.getBoundingClientRect||!legend.getBoundingClientRect)return;var n=dateNav.getBoundingClientRect(),l=legend.getBoundingClientRect();if(l.width>0&&l.height>0&&n.left<l.right&&l.left<n.right&&n.top<l.bottom&&l.top<n.bottom){var p=dateNav.offsetParent?dateNav.offsetParent.getBoundingClientRect().top:0;dateNav.style.top=Math.ceil(l.bottom-p+6)+'px';}}
        // 두 칸은 늘 하나만 켜진다: 이미 켜진 칸을 다시 눌러도 그대로다. 시각은 바꾸지 않는다.
        if(w.RiskMarine){marineLegend();legend.addEventListener('click',function(e){var b=e.target.closest('[data-marine-mode]');if(b&&b.dataset.marineMode!==marineMode){marineMode=b.dataset.marineMode;usage(marineMode==='congestion'?'risk.marine_mode.congestion':'risk.marine_mode.risk');marineLegend();waitStart();refresh();}});}
        legend.addEventListener('click',function(e){var b=e.target.closest('[data-layer]');if(!b)return;var kind=b.dataset.layer;state[kind]=!state[kind];if(state[kind])usage(kind==='sea'?'risk.layer.sea':'risk.layer.coast');/* [사용량] 켤 때만 — 끌 때는 세지 않는다(해양안전 집계 규칙) */if(w.RiskMarine&&kind==='sea'&&state.sea){marineMode='risk';marineLegend();}b.classList.toggle('on',state[kind]);b.setAttribute('aria-pressed',String(state[kind]));if(w.RiskMarine&&meta&&t)t=nearest(mainTimes(),t);var kindKey=legend.querySelector('[data-'+kind+'-legend]');if(kindKey)kindKey.hidden=!state[kind];if(!w.RiskMarine)legend.querySelector('.rf-map-legend').hidden=!state.sea;colorLegendSync();marineTime();if(kind==='sea'){(colorLegend||legend).querySelector('[data-accident-legend]').hidden=!state.sea;marineTime();}if((selected&&(selected.kind===kind||(kind==='sea'&&seaKind(selected.kind)==='sea')))||(choosing&&kind==='coast'))clearSelection();if(state[kind])waitStart();if(!meta)sync();else refresh();});
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
        function clearSelection(){framing=null;if(w.PopupStack)w.PopupStack.remove('risk-forecast-sheet');detailSeq++;selected=null;choosing=false;sheet.clear();layer.setSelection(null);w.RiskBasis.close();marineTime();}
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
        /**
         * 지도에서 고른 해상 칸·연안 관광지를 선택하고 상세 시트를 연다(테두리는 즉시, 시트는 닫혀 있었으면 약 0.2초 뒤).
         * 예: select('marine','GR4_F4K23_P4',{lon:126.53,lat:33.56}) · select('coast','S1') · select('coast',['a','c']) → 같은 위치 관광지 선택 목록
         * @param {string} kind - marine/coast/accident/traffic/sea @param {string|string[]} id - 칸·관광지 id(배열이면 선택 목록) @param {Object} [location] - 해상 클릭 경위도
         * @returns {void} [연계] ← RiskMapLayer.hit·시트 안 버튼·life_safety.js 탭 복귀 / → layer.setSelection·RiskSheet.hold/loading·detail
         */
        function select(kind,id,location){
            if(kind==='briefing')return;
            if(!enabled||!state[seaKind(kind)]||disposed)return;
            if(Array.isArray(id)){var choices=table.coast.spots.filter(function(p){return id.includes(p.id);});clearSelection();choosing=true;if(sheet.hold)sheet.hold(OPEN_DELAY_MS);sheet.choose(choices);registerSheet();return;}
            var item=kind==='marine'?{id:id,lon:location&&location.lon,lat:location&&location.lat}:kind==='briefing'?{id:id}:(kind==='coast'?table.coast.spots:table[kind].cells).find(function(p){return p.id===id;});if(!item)return;
            if(!selected||selected.id!==id||selected.kind!==kind)layer.setSelection(kind==='briefing'?null:kind,id);
            choosing=false;selected={kind:kind,id:id,item:item,at:t,location:seaKind(kind)==='sea'&&location&&Number.isFinite(location.lon)&&Number.isFinite(location.lat)?{lon:location.lon,lat:location.lat}:null};
            // 누르는 즉시 회색 틀을 채우고 상세를 요청한다. 이전 지점의 제목은 남기지 않고 이 지점의 이름(연안만 알고 있음)만 쓴다.
            // 시트가 닫혀 있으면 지도 선택 테두리(위 setSelection, 즉시)를 먼저 보이고 약 0.2초 뒤에 시트가 올라온다(사용자 2026-10-16
            // 「선택이후 약간의 딜레이(0.2초?) 정도 후 바텀시트가 나오도록」). 그 안에 다른 곳을 누르면 마지막 것만, 닫기·토글 끔·탭 떠남이면 올리지 않는다(RiskSheet.hold·clear).
            // 이미 열려 있으면(또는 내려가는 중이면) 내리지 않고 내용만 바꾼다 — 단 지도 클릭은 열린 동안 mapSelect 가 막는다(T24 「나. 무시」).
            //   여기까지 오는 열린 시트의 변경은 시트 안 버튼(같은 위치 관광지 목록·관할 해역 이동)과 탭 복귀뿐이다.
            if(sheet.hold)sheet.hold(OPEN_DELAY_MS);
            sheet.loading({title:kind==='coast'&&typeof item.name==='string'?item.name:'',subtitle:''});registerSheet();marineTime();
            // 연안 시트는 따로 시각을 갖지 않고 메인 날짜를 따른다(T24 — 시트에서 넘기면 상단 날짜도, 상단에서 넘기면 시트도 같이).
            if(meta){selected.at=w.RiskMarine&&kind==='coast'?null:nearest(selectionTimes(kind),t||meta.now);mountSlider();}detail();
        }
        /** 열린 시트의 시각 조작을 (다시) 그린다. 해상은 막대를 시각별 공식 사고 위험 색으로 칠하는 모양이고, 이미 받은 단계 색을 다시 칠한다.
         * 연안은 시각 막대 대신 날짜 줄(< '26. 10. 16.(금) >) — T24(2026-10-16)로 T7 의 연안 시각 막대(시각별 연안 4단계 색)를 없앴다. 연안 시트는 메인 날짜를 따른다.
         * 예: 해상 지점 → RiskSlider.mount(...,{risk:true,now:meta.now}) 뒤 levels(selected.levels) · 연안 지점 → sheetDay()(RiskSheet.day)
         * @returns {void} [연계] ← select·sync / → RiskSlider.mount·sheetDay; 단계는 detail() 이 해상 분석 응답의 outlook.accident 에서 selected.levels 로 모은다 */
        function mountSlider(){if(!selected||!meta)return;if(w.RiskMarine&&selected.kind==='coast'){selected.slider=null;sheetDay();return;}var sea=!!w.RiskMarine&&seaKind(selected.kind)==='sea';var sl=w.RiskSlider.mount(sheet.timelineEl,selectionTimes(selected.kind),selected.at||t,sliderChanged,sea?{risk:true,now:meta.now}:undefined);selected.slider=sl||null;if(sl&&sl.levels&&selected.levels)sl.levels(Object.keys(selected.levels).map(function(k){return selected.levels[k];}));}
        /** 시트 시각 조작 값을 받아 그 시각의 상세를 다시 요청한다. 예: 18시로 옮기면 회색 틀 뒤 18시 상세.
         * @param {string} value - 선택 ISO 시각 @returns {void}
         * [연계] ← RiskSlider.mount / 메인 t는 바꾸지 않는다(시간 격리); 늦게 온 이전 시각 응답은 detail()의 세대·시각 검사가 버린다.
         */
        function sliderChanged(value){if(selected){selected.at=value;sheet.loading();detail();}}
        /** 시트가 가린 아래쪽을 뺀 지도 영역의 가운데로 이동하기 위한 fit 여백을 구한다.
         * 예: 지도 0~915px, 시트 윗변 340px → [30,40,605,40] (남은 0~340px의 가운데로)
         *     visiblePadding(true) — 막 고른 직후(시트가 0.2초 뒤에 올라올 참·아직 회색 틀): 시트가 다 올라왔을 때의 높이로 셈한다(sheetTop)
         * @param {boolean} [opening] - 시트가 곧 열릴 참이면 true(아직 .open 이 없어도 가릴 높이를 미리 뺀다)
         * @returns {number[]} [위,오른쪽,아래,왼쪽] px
         * [연계] ← hazard·marinePoint·fitFrame(goTo) / 연안 위험구역과 해상 관할 해역 이동·브리핑 바로가기가 같은 계산을 써서 선택 동작이 어긋나지 않는다.
         */
        function visiblePadding(opening){var pad=[30,40,30,40];try{var size=map.getSize(),el=map.getTargetElement();if(size&&el&&sheetEl.classList&&(opening||sheetEl.classList.contains('open'))){var top=sheetTop(opening);if(top!==null){var m=el.getBoundingClientRect(),cover=Math.max(0,m.bottom-top);pad[2]=Math.min(cover,Math.max(0,size[1]-pad[0]-60))+30;}}}catch(e){/* 지도·시트 크기를 못 재는 환경(미리보기·시험 틀)은 기본 여백으로 이동한다 — 이동만 덜 정확할 뿐 선택은 그대로 된다 */}return pad;}
        /** 시트가 다 올라왔을 때 시트 윗변의 화면(창) 세로 위치를 잰다 — 올라오는 움직임(transform) 중이어도 움직임을 뺀 제자리로 잰다.
         * 시트 높이는 숫자로 박지 않고 실제 값을 잰다: 그려져 있으면 offsetHeight, 곧 열릴 참(opening)이거나 아직 숨어 있으면 CSS max-height(risk_forecast.css .rf-sheet — 화면의 66%)와 견줘 큰 쪽.
         *   막 고른 직후의 회색 틀은 다 그려진 내용보다 낮을 수 있어서, 처음에는 가장 높이 올라올 때를 기준으로 잡아 칸이 절대 가리지 않게 하고 내용이 그려진 뒤 실제 높이로 한 번 고친다(fitFrame).
         * 예: 390×844 휴대폰·하단 탭 68px·max-height 512px → 844-68-512 = 264 / 그려진 연안 시트 176px(opening 아님) → 600
         * @param {boolean} [opening] - 곧 열릴 참이면 true @returns {number|null} 창 좌표 px(못 재면 null)
         * [연계] ← visiblePadding / .rf-sheet 는 position:fixed·bottom:하단 탭 높이 — 숨어 있을 때(display:none)는 창 높이에서 bottom 을 빼서 아랫변을 잡는다 */
        function sheetTop(opening){
            var cs=getComputedStyle(sheetEl),shown=cs.display!=='none',bottom,h=0;
            if(shown){var r=sheetEl.getBoundingClientRect(),ty=cs.transform&&cs.transform!=='none'&&w.DOMMatrixReadOnly?new w.DOMMatrixReadOnly(cs.transform).m42:0;bottom=r.bottom-ty;h=sheetEl.offsetHeight;}
            else bottom=w.innerHeight-parseFloat(cs.bottom);
            if(opening||!shown){var max=parseFloat(cs.maxHeight);if(Number.isFinite(max))h=Math.max(h,max);}
            return Number.isFinite(bottom)&&h>0?bottom-h:null;
        }
        /** 브리핑 바로가기로 고른 칸·관광지를 시트 위로 보이는 지도 띠의 가운데에 두고, 그 범위 전체가 띠 안에 들어오게 확대한다(최대 13).
         * 처음에는 시트가 가장 높이 올라올 때를 기준으로 곧바로 옮기고(fitFrame(true)), 상세가 그려져 시트 높이가 정해지면 실제 높이로 한 번 고친다(detail·sheetResize).
         * 예: frameTo([x0,y0,x1,y1]) — 해상 칸 사각형 범위 / 연안 관광지 영역 범위 / 칸 테두리가 없으면 그 좌표 둘레 3km
         * @param {number[]} extent - 지도 좌표 범위 @returns {void}
         * [연계] ← goTo / → fitFrame. 사용자 2026-10-17 「바텀시트 위쪽으로 해당 격자가 가운데 와서 바텀시트에 가려지지 않도록」 */
        function frameTo(extent){if(!selected)return;framing={s:selected,extent:extent,bottom:null,rendered:false};fitFrame(true);}
        /** framing 범위로 지도를 옮긴다. 시트가 가릴 높이가 지난번과 8px 안쪽으로 같으면 다시 움직이지 않는다. 움직임 줄이기(prefers-reduced-motion)면 애니메이션 없이 바로.
         * 예: fitFrame(true) → 시트 최대 높이 기준 0.25초 이동 / fitFrame(false) → 그려진 시트 높이 기준(달라졌을 때만 움직임) — 그 뒤 framing 끝
         * @param {boolean} opening - visiblePadding 에 그대로 @returns {void} [연계] ← frameTo·detail·sheetResize / → visiblePadding·ol View.fit */
        function fitFrame(opening){
            if(!framing||framing.s!==selected||!w.ol)return;var f=framing;if(!opening)framing=null;/* 실제 높이로 고치는 것은 한 번뿐 — 그 뒤 시각 넘기기 등으로 시트 내용이 바뀌어도 지도를 따라 흔들지 않는다 */
            var pad=visiblePadding(opening);if(f.bottom!==null&&Math.abs(pad[2]-f.bottom)<8)return;f.bottom=pad[2];
            var reduce=false;try{reduce=!!(w.matchMedia&&w.matchMedia('(prefers-reduced-motion: reduce)').matches);}catch(e){reduce=false;/* matchMedia 없는 틀 — 움직임 있는 쪽으로 */}
            var view=map.getView(),opt={padding:pad,maxZoom:13};if(!reduce)opt.duration=250;view.cancelAnimations();view.fit(f.extent,opt);
        }
        // 사용자가 지도를 끌면 그 뒤로는 시트 높이가 바뀌어도 지도를 다시 옮기지 않는다(끌어 놓은 자리를 빼앗지 않음).
        function stopFraming(){framing=null;}
        if(map.on)map.on('pointerdrag',stopFraming);   // 시험 틀의 가짜 지도(on 없음)에서도 mount 가 되게
        // 상세가 그려진 뒤 시트 높이가 바뀌면(0.2초 뒤 처음 나타남·내용 채움) 실제 높이로 한 번 고친다. ResizeObserver 없는 브라우저는 detail 의 직접 호출만.
        var sheetResize=w.ResizeObserver&&sheetEl.nodeType===1?new w.ResizeObserver(function(){if(framing&&framing.rendered&&sheetEl.classList.contains('rf-shown'))fitFrame(false);}):null;if(sheetResize)sheetResize.observe(sheetEl);
        async function hazard(id){var snapshot=selected;try{var fc=await api.get('hazard-zones',{ids:id});if(enabled&&selected===snapshot&&selected&&state.coast){layer.showHazards(fc,visiblePadding());sheet.markZone(id);}}catch(e){console.warn('[위험예측] 위험구역 요청 실패',failureInfo(e));if(enabled&&!disposed&&selected===snapshot)message('위험구역 자료를 불러오지 못했습니다 — '+e.message);}}
        /** 상세 요청 시각. 연안(앱)은 메인 날짜의 첫 연안 칸(coastT — 서버가 그 날짜 하루 값을 준다, T24), 나머지는 시트 시각(없으면 메인 시각).
         * 예: 연안·메인 내일 15:00 → 내일 00:00 · 해상 시트 18:00 → 18:00 @param {Object} s - 선택 @returns {string} ISO [연계] ← detail(요청·늦은 응답 검사) */
        function detailAt(s){return w.RiskMarine&&s.kind==='coast'&&meta?coastT(t||meta.now):(s.at||t);}
        /** 상세(또는 오류)가 시트에 그려졌다 — goTo 로 맞추던 칸이면 이제 시트 높이가 정해졌으니 실제 높이로 한 번 고친다(시트가 아직 0.2초 대기 중이면 나타날 때 sheetResize 가).
         * 예: 연안 시트가 최대 높이보다 낮게 그려짐 → 칸을 그만큼 아래(띠 가운데)로 @param {Object} s - 그린 선택 @returns {void} [연계] ← detail / → fitFrame */
        function framed(s){if(framing&&framing.s===s){framing.rendered=true;if(sheetEl.classList.contains('rf-shown'))fitFrame(false);}}
        async function detail(){
            if(!selected||!enabled)return;var n=++detailSeq,s=selected,at=detailAt(s);
            try{var params={id:s.id,t:at};if(s.location){params.lon=s.location.lon;params.lat=s.location.lat;}var d=await api.get(s.kind==='briefing'?'sea/briefing':w.RiskMarine&&seaKind(s.kind)==='sea'?'sea/analysis':s.kind==='accident'?'sea/accident-cell':s.kind+'/'+(s.kind==='coast'?'spot':'cell'),params);if(n!==detailSeq||!enabled||selected!==s||detailAt(s)!==at)return;sheet.show(d,s.kind,s.item,meta?{now:meta.now}:undefined);registerSheet();framed(s);
                var out=d&&d.marine&&d.marine.outlook&&d.marine.outlook.accident;if(out&&out.length){s.levels=s.levels||{};out.forEach(function(r){if(r&&r.forecastAt)s.levels[r.forecastAt]=r;});if(s.slider&&s.slider.levels)s.slider.levels(out);}if(d&&d.marine)trafficHistory(n,s,at,d.marine);}   // 시각 막대 칸 색: 해상 outlook.accident(연안 시각 막대는 T24 로 없앰)
            catch(e){console.warn('[위험예측] 상세 요청 실패',failureInfo(e));if(n===detailSeq&&enabled&&selected===s&&detailAt(s)===at){sheet.error(e.message);registerSheet();framed(s);}}
        }
        /** 해상 시트의 「지난 2주간 선박교통량」 이력을 받아 카드를 채운다. 칸이 없으면 요청하지 않는다(카드는 「-」).
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
                    }else f=await api.get(kind+'/frame',{t:w.RiskMarine&&kind==='coast'?coastT(at):at});   // 연안(앱)은 날짜 하루 값 — 그 날짜의 첫 칸으로 보낸다(T24)
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
        /** 「활동지점 안전 브리핑」 바로가기(설계서 §11.4·U55, 2026-10-16) — 그 층을 켜고 그 시각(연안은 그 날짜)으로 옮긴 뒤 그 칸·관광지를 골라 시트를 열고 지도를 그 자리로 옮긴다.
         * 시각 규칙은 지도 버튼과 같다: 해상은 지난 시각이면 지금, 아니면 그 시각을 넘지 않는 마지막 메인 시각 · 연안은 오늘이면 지금, 내일이면 그날 첫 칸(shiftDay 와 같음).
         * 예: goTo({kind:'marine',id:'GR4_F4K23_P4',location:{lon:126.53,lat:33.56},t:'2026-10-17T15:00:00+09:00'}) → 해상 ON·15시·그 칸 시트
         *     goTo({kind:'coast',id:'50110|협재해수욕장',date:'2026-10-17',location:{lon:126.239,lat:33.394}}) → 그 날짜·그 관광지 시트 / 관광지 표에 없는 id → false
         * @param {Object} target - kind('marine'|'coast')·id·location{lon,lat}·t(해상 ISO)·date(연안 YYYY-MM-DD) @returns {Promise<boolean>} 골랐으면 true
         * [연계] ← RiskForecast.openAt(bindApp) ← forecast/station-briefing/station_briefing.js / → 층 스위치 click(quiet — 사용량 0건)·sync·setMain·select */
        async function goTo(target){
            if(!target||!enabled||disposed)return false;
            await sync();var layerKey=target.kind==='coast'?'coast':'sea';
            if(!state[layerKey]){var lb=legend.querySelector('[data-layer="'+layerKey+'"]');if(lb)quiet(function(){lb.click();});await sync();}   // 프로그램 클릭 — 바로가기 1건(station_briefing.js)만 센다
            if(!meta||!enabled||disposed||!state[layerKey])return false;
            var next=t||meta.now;
            // 연안 날짜가 위험예측 표(coastDays)에 없으면 다른 날짜를 조용히 열지 않고 false(2단계 검토 A7 — 부른 쪽이 안내한다).
            if(target.kind==='coast'&&target.date&&target.date!==kstDay(meta.now)&&coastDays().indexOf(target.date)<0)return false;
            if(target.kind==='coast'&&target.date)next=target.date===kstDay(meta.now)?meta.now:coastT(target.date+'T00:00:00+09:00');
            else if(target.t){var goal=Date.parse(target.t);next=!(goal>Date.parse(meta.now))?meta.now:(mainTimes().filter(function(at){return Date.parse(at)<=goal;}).pop()||meta.now);}
            if(next!==t)await setMain(next);
            if(target.kind==='coast'&&!table.coast.spots.some(function(p){return p.id===target.id;}))return false;
            select(target.kind,target.id,target.location);
            // 선택 테두리(해상 칸·연안 관광지 영역)가 있으면 그 범위를, 없으면(칸 id 없는 해상 지점 'point') 그 좌표 둘레 3km 를 시트 위 지도 띠 가운데로(frameTo).
            // 종전에는 select 직후(시트가 0.2초 대기 중이라 .open 이 아직 없음) visiblePadding() 을 불러 시트를 빼지 않은 화면 전체의 가운데로 옮겼다 — 칸이 시트 뒤에 숨었다(2026-10-17 사용자 화면).
            var loc=target.location,extent=selected&&selected.id===target.id&&layer.selectionExtent?layer.selectionExtent():null;
            if(!extent&&loc&&Number.isFinite(loc.lon)&&Number.isFinite(loc.lat)&&w.ol){var xy=ol.proj.fromLonLat([loc.lon,loc.lat]);extent=[xy[0]-1500,xy[1]-1500,xy[0]+1500,xy[1]+1500];}
            if(extent)frameTo(extent);
            return !!selected&&selected.id===target.id;
        }
        function setEnabled(value){enabled=!!value;seq++;if(!enabled){waitEnd(false);clearSelection();legend.hidden=true;layer.setActive(state,false);colorLegendSync();marineTime();restoreBasemap();message('');}else{satelliteOn();legend.hidden=false;colorLegendSync();marineTime();waitStart();sync();}}
        function escapeSheet(e){if(e.key==='Escape'&&enabled&&(selected||choosing)&&!document.querySelector('.rf-modal')&&!document.querySelector('.rf-acc-pop:not([hidden])')){e.preventDefault();clearSelection();}}
        document.addEventListener('keydown',escapeSheet);
        if(options.enabled===false){legend.hidden=true;if(colorLegend)colorLegend.hidden=true;layer.setActive(state,false);}
        if(enabled)satelliteOn();
        var ready=enabled?sync():Promise.resolve();
        var timer=setInterval(function(){if(enabled&&!disposed)sync();},60000);
        return {ready:ready,setEnabled:setEnabled,select:select,goTo:goTo,refresh:refresh,tryHandleClick:function(evt){return enabled?layer.hit(evt):false;},getState:function(){return {enabled:enabled,coast:state.coast,sea:state.sea,t:t,selected:selected&&{kind:selected.kind,id:selected.id,location:selected.location}};},synced:function(){return syncPending||Promise.resolve();},destroy:function(){disposed=true;clearInterval(timer);framing=null;if(map.un)map.un('pointerdrag',stopFraming);if(sheetResize)sheetResize.disconnect();document.removeEventListener('keydown',escapeSheet);seq++;waitEnd(false);if(waitEl)waitEl.remove();clearSelection();restoreBasemap();layer.destroy();if(colorLegend)colorLegend.remove();if(timeBar){timeBar.remove();dateNav.remove();if(w.removeEventListener)w.removeEventListener('resize',placeDateNav);clearTimeout(toastTimer);toastEl.remove();document.body.classList.remove('rf-sea-time-on');}}};
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
        // 2026-10-18 일반 공개: 미리보기 잠금(10번 눌러야 풀림)을 없앴다 — 처음 누르면 바로 열린다(사용자 「해양안전생활에서 위험예측을 이제 트리거를 제거해줘.」).
        var instance=null,pending=false,enabled=false;
        btn.addEventListener('click',async function(){
            enabled=!enabled;btn.classList.toggle('active',enabled);btn.setAttribute('aria-pressed',String(enabled));
            if(enabled)usage('risk.on');   // [사용량] 켤 때 1건(첫 await 전 — 바로가기의 quiet 클릭이 막을 수 있게)
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
        /** 「활동지점 안전 브리핑」 카드의 [위험예측에서 보기 ›](설계서 §11.4) — 꺼져 있으면 버튼을 눌러 켠 뒤(해양안전 단독 표출 규칙 그대로) goTo.
         * 2026-10-18 일반 공개로 미리보기 잠금이 없어져 관리자·일반 기기 모두 같은 길로 연다(종전: 관리자 모드만 — 2단계 검토 A2).
         * 예: await RiskForecast.openAt({kind:'coast',id:'S1',date:'2026-10-17'}) → true · 표에 없는 id → false
         * @param {Object} target - goTo 와 같음 @returns {Promise<boolean>} [연계] ← station_briefing.js openInRisk / → btn click(quiet — 사용량 0건)·instance.goTo */
        w.RiskForecast.openAt=async function(target){
            if(!enabled)quiet(function(){btn.click();});   // 프로그램 클릭 — 'risk.on' 을 세지 않는다(바로가기 1건만, 이중 집계 방지)
            for(var i=0;i<200&&!(instance&&instance.getState().enabled);i++)await new Promise(function(r){setTimeout(r,50);});   // 지도·모듈 준비(최대 10초)
            return instance&&instance.getState().enabled?instance.goTo(target):false;
        };
    }
    w.RiskForecast={mount:mount};
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindApp);else bindApp();
})(window);
