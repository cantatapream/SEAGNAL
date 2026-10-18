/**
 * 파일명: local_server/scripts/test_life_safety_tab_keep.js
 * 역할  : 하단 「해양안전생활」 탭이 다른 메인탭에 다녀와도 마지막 화면을 유지하고 새로고침이면 처음 상태인지 실제 화면으로 검사한다.
 *         켜 둔 버튼·위험예측 안의 상태(연안/해상·혼잡도/위험 예측·시각)·지도 위치·배경·시트, 다른 탭에 있는 동안
 *         위험예측 층·60초 갱신이 멈춰 있는지를 index2.html 전체를 Chromium 으로 띄워 눌러 본다.
 *         사용자 원문(2026-10-16): 「해양안전생활 탭에서 어떤 버튼을 클릭하여 화면을 표출해놓고 예를 들어
 *         위험예측. 그 상태에서 해양종합정보나 다른 탭을 갔다오면 해양안전생활 화면이 초기화되는데 가장
 *         마지막에 했던 화면 상태로 유지해줘. 단 앱을 껐다가 켜면 초기화상태로 시작.」
 *         둘째 결정(2026-10-16 「4-1, 2, 3 추천대로」): ①위험지형·금지구역 범례 스위치와 사고 「현황」 모드도 되살림
 *         ②하위탭(해양안전 ↔ 해양생활)끼리 옮겨 다녀도 각 하위탭 상태 유지(해양안전 하위탭 다시 누름 포함, 해양생활
 *         지도 위치·지점 팝업, 그 팝업 표시가 해양안전 버튼을 가리지 않음) ③탭 다시 누름은 그대로 — 항목마다 사례 하나.
 *         셋째 결정(2026-10-16 남은 질문 12·13 「추천대로」): 12. 사고정보 필터·사고 현황 선박/인명·항행경보 날짜·시각·
 *         물빠짐 시간 슬라이더·관제구역 선택 표시도 메인탭·하위탭 왕복 뒤 그대로 13. 숨은 해양생활 지점 팝업은 휴대폰 뒤로가기가
 *         건너뛰고(돌아오면 다시 닫힘), 다른 메인탭 팝업의 뒤로가기는 그대로 — 「12 …」·「13 …」 사례.
 * [연계] → client/js/marine-life/safety/life_safety.js 1-3 절(_parkSafety·_unparkSafety·switchMainTab 래퍼)
 *        → client/js/core/index2_patch.js ③-2(해양안전생활은 기본 하위탭으로 되돌리지 않음)
 *        → client/js/marine-life/risk-forecast/risk_forecast.js (getState·setEnabled·synced·select)
 *        → hazard_rocks.js·ban_zone.js 범례 줄(#tgl-row-*·#bzl-row-*), accident_info.js [분석·현황] 토글 — 둘째 결정 ①
 *        → accident_info.js 필터 팝업·[선박·인명], navigational_warning.js, ocean-map/layers/tide_field.js,
 *          vts_zone.js(_vtsZoneTryHandleClick·_vtsZoneGetSelected), core/backbutton.js(PopupStack) — 셋째 결정
 *        ← scripts/refactor/verify_all.sh SUITES
 * [로드 순서] 독립 검사. 3001 서버·외부 호출 없음 — 자체 express(임의 포트)가 client/ 를 내주고,
 *             위험예측 API 는 실제 라우터 + 가짜 저장소, 그 밖의 /api 는 404, 127.0.0.1 밖 요청은 모두 끊는다.
 * [실행] NODE_PATH=/opt/node-tools/node_modules node local_server/scripts/test_life_safety_tab_keep.js
 */
'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert'),express=require('express'),{chromium}=require('playwright-core');
const root=path.join(__dirname,'../..'),io=require('../services/risk_collector_io'),M=require('../services/marine_fusion'),T=require('../services/risk_time'),{createRouter}=require('../routes/risk_forecast');
let pass=0,fail=0;
/** 실제 브라우저 결과를 검사한다. 예: check('왕복 유지',async()=>{...}).
 * @param {string} name - 사례 @param {function} fn - 검사 @returns {Promise<void>}
 * [연계] ← 아래 시나리오 / 실패도 모두 찍고 마지막에 요약한다. */
async function check(name,fn){try{await fn();console.log('✅',name);pass++;}catch(e){console.error('❌',name,e.message);fail++;}}
// 기준 시각은 과거 고정(시각 의존 금지 — verify_all 규칙). 서버 meta.now 는 아래 clock.now 로 바꿀 수 있다.
const clock={now:Date.parse('2026-10-12T11:00:00+09:00')};
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tab-keep-'));
(async()=>{let browser,server;try{
 const geometry={type:'Polygon',coordinates:[[[126.525,33.55],[126.55,33.55],[126.55,33.575],[126.525,33.575],[126.525,33.55]]]},cell={id:'GR4_F4K23_P4',i:0,lat:33.5625,lon:126.5375,geometry,haegu:{label:'163-6',major:163,sub:6},ref:{name:'제주항',bearingWord:'북서',distNm:8.2}},acc={...cell,id:'100'};
 const at0=T.isoKst(clock.now);
 io.write(path.join(dir,'sea_realtime.json.gz'),{v:'v1',cells:[cell],rows:[[0,21,.2]],collectedAt:at0,sourceAt:null,source:'MTIS realtime API'});
 /** 지금 clock.now 기준 시간축. 예: 11:00 → 연안 3시간 칸 내일 21시까지. @returns {Object} [연계] ← 가짜 meta */
 const axes=()=>({coast:T.timeline(clock.now,3,2,21),sea:T.timeline(clock.now,1,2,23)});
 const frames={};for(const t of T.timeline(clock.now,3,3,21))frames[t.slice(0,13).replace(/[-T]/g,'')+'00']=[[0,.002,'주의']];
 const inputs={version:1,cells:{cells:[cell]},congestion:{frames:{}},accident:{cells:[acc],frames},sources:{accident:{status:'ok'},congestion:{status:'ok'},zoneForecasts:{status:'ok'}},weather:()=>({wh:2,ws:12,wp:4,wd:241,forecastAt:at0})};
 const ring=(x,y)=>[[x,y],[x+.01,y],[x+.01,y+.01],[x,y+.01],[x,y]],spots=[{id:'S1',i:0,lat:33.5,lon:126.5,name:'가짜해변',cell:ring(126.5,33.5)}];
 const log={meta:0,detail:[],analysis:[],tide:[],navwarn:[]};
 const store={sources:()=>inputs.sources,marineInputs:()=>inputs,
  meta:()=>{log.meta++;const a=axes();return{now:T.isoKst(clock.now),versions:{spots:'v1',cells:1,accident:'v1'},timeline:{sea:{times:a.sea},accident:{times:a.coast},coast:{times:a.coast}},sources:inputs.sources};},
  spots:()=>({spots}),cells:()=>({cells:[cell]}),accidentCells:()=>({v:'v1',cells:[acc]}),accidentFrame:()=>({v:'v1',cells:[[0,.001,'경계']]}),
  frame:(sea)=>sea?{cells:[[0,0,1,'낮음']],spots:[],borders:[]}:{spots:spots.map(s=>[s.i,3]),borders:[]},
  // 연안 지도·상세 경로는 날짜당 하나(T24 — 라우터가 coastDayFrame·coastDayDetail 을 부른다).
  coastDayFrame:()=>({spots:spots.map(s=>[s.i,3]),degraded:[]}),
  coastDayDetail:(id,t)=>{log.detail.push({id,t});return{title:'연안 '+id+' '+t,subtitle:{lat:33.5,lon:126.5},clickable:false,t};},islands:()=>({features:[]})};
 const marine=M.createStore({risk:store,dir,clock:()=>clock.now,stations:[{properties:{name:'제주파출소'},geometry}],accidents:[],describe:()=>cell});
 const app=express();
 app.use((req,res,next)=>{if(req.path.endsWith('/sea/analysis'))log.analysis.push({lon:+req.query.lon,lat:+req.query.lat});next();});
 app.use(createRouter({store,marine}));
 // 셋째 결정용 가짜 자료 — 물빠짐(과거 고정 6시간·30분 칸 12개, 그리는 칸 없음)·항행경보(구역 없음). 요청 시각·날짜만 적어 둔다.
 app.get('/api/tide-field/meta',(req,res)=>res.json({success:true,ready:true,time_start:'2026-10-12T00:00:00Z',time_end:'2026-10-12T06:00:00Z',step_minutes:30,cell_deg:0.001}));
 app.get('/api/tide-field',(req,res)=>{log.tide.push(req.query.time);res.json({success:true,cells:[],cell_deg:0.001});});
 app.get('/api/navigational-warning/list',(req,res)=>{log.navwarn.push(req.query.date);res.json({success:true,zones:[]});});
 app.get('/',(req,res)=>res.sendFile(path.join(root,'client/index2.html')));
 app.use(express.static(path.join(root,'client')));
 app.use('/api',(req,res)=>res.status(404).json({ok:false}));
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({...((process.env.PW_CHROME||process.env.SIM_CHROMIUM||process.env.CHROMIUM_EXECUTABLE)?{executablePath:process.env.PW_CHROME||process.env.SIM_CHROMIUM||process.env.CHROMIUM_EXECUTABLE}:{}),headless:true,args:['--no-sandbox']});
 const ctx=await browser.newContext({viewport:{width:412,height:915}}),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
 // 60초 주기 타이머를 따로 모아 둔다 — 60초를 실제로 기다리지 않고 "주기가 돌았을 때" 무엇을 하는지 직접 불러 본다.
 await page.addInitScript(()=>{const orig=window.setInterval;window.__iv60=[];window.setInterval=function(fn,ms){if(ms===60000)window.__iv60.push(fn);return orig.apply(this,arguments);};});
 const load=async()=>{await page.goto(base+'/');await page.waitForFunction(()=>typeof window.switchMainTab==='function'&&document.getElementById('ocean-risk-forecast-toggle-btn'));await page.waitForTimeout(800);};
 await load();
 const tab=t=>page.evaluate(t=>document.querySelector('.main-tabs .tab-btn[data-target="'+t+'"]').click(),t);
 const settle=(ms=700)=>page.waitForTimeout(ms);
 /** 화면 상태를 한 번에 읽는다. @returns {Promise<Object>} [연계] ← 모든 사례 */
 const S=()=>page.evaluate(()=>{const m=window.getOceanMap&&window.getOceanMap(),a=window._riskForecastApp,btn=document.getElementById('ocean-risk-forecast-toggle-btn'),bar=document.querySelector('.rf-marine-timebar'),cong=document.querySelector('[data-marine-mode="congestion"]');
  const rfLayers=m?m.getLayers().getArray().filter(l=>/^rf-/.test(l.getClassName&&l.getClassName()||'')).map(l=>l.getVisible()):[];
  return{tab:document.body.getAttribute('data-active-tab'),safety:document.body.classList.contains('ls-safety'),life:document.body.classList.contains('ls-life'),
   oceanSec:document.getElementById('ocean-map-section').classList.contains('active'),
   btn:btn.classList.contains('active'),locked:btn.classList.contains('rf-preview-locked'),app:a?a.getState():null,
   legendHidden:document.getElementById('risk-forecast-legend').hidden,bar:bar?!bar.hidden:false,seaTimeOn:document.body.classList.contains('rf-sea-time-on'),
   cong:cong?cong.getAttribute('aria-checked'):null,rfVisible:rfLayers.some(Boolean),sheetOpen:document.getElementById('risk-forecast-sheet').classList.contains('open'),
   title:(document.querySelector('#risk-forecast-sheet .rf-title')||{}).textContent||'',
   view:m?{c:m.getView().getCenter().map(v=>Math.round(v)),z:Math.round(m.getView().getZoom()*100)/100}:null,base:window.oceanGetBasemap&&window.oceanGetBasemap(),
   stack:window.PopupStack&&window.PopupStack.list?window.PopupStack.list():null};});
 const fire60=()=>page.evaluate(()=>{window.__iv60.forEach(fn=>{try{fn();}catch(e){}});return window.__iv60.length;});
 const riskOnFirst=async()=>{await page.evaluate(()=>{const b=document.getElementById('ocean-risk-forecast-toggle-btn');for(let i=0;i<10;i++)b.click();});await page.waitForFunction(()=>window._riskForecastApp&&window._riskForecastApp.getState().enabled&&document.querySelector('.rf-date-nav')&&!document.querySelector('.rf-date-nav').hidden,null,{timeout:10000});await settle(500);};
 const step=h=>page.evaluate(h=>document.querySelector('[data-time-step="'+h+'"]').click(),String(h));
 const coastPlus3=()=>T.timeline(clock.now,3,2,21)[1];

 await check('새로고침 직후 처음 상태 — 해양안전 하위탭, 위험예측 꺼짐·잠김',async()=>{
  await tab('ocean-life-group');await settle();const s=await S();
  assert.equal(s.tab,'ocean-life-group');assert.equal(s.safety,true);assert.equal(s.btn,false);assert.equal(s.locked,true);assert.equal(s.app,null);assert.equal(s.bar,false);
 });

 let before;
 await check('위험예측 켬 → 해상 ON·[혼잡도]·+3H·지도 이동 → 특보정보 탭 → 층·시간 바·버튼 꺼짐, 60초 주기가 돌아도 요청 없음',async()=>{
  await riskOnFirst();
  await page.evaluate(()=>document.querySelector('[data-layer="sea"]').click());await settle(600);
  await page.evaluate(()=>document.querySelector('[data-marine-mode="congestion"]').click());await settle(600);
  await step(3);await page.waitForFunction(t=>window._riskForecastApp.getState().t===t,coastPlus3());
  await page.evaluate(()=>{const v=window.getOceanMap().getView();v.setCenter(ol.proj.fromLonLat([126.9,34.1]));v.setZoom(9.5);});await settle(300);
  before=await S();
  assert.deepEqual([before.btn,before.app.enabled,before.app.coast,before.app.sea,before.cong,before.app.t],[true,true,true,true,'true',coastPlus3()]);
  await tab('weather-group');await settle();
  const s=await S();
  assert.equal(s.tab,'weather-group');assert.equal(s.oceanSec,false);
  assert.equal(s.btn,false,'다른 탭에서는 위험예측 버튼이 꺼져 있다');assert.equal(s.app.enabled,false,'위험예측 모듈이 멈춤(setEnabled(false))');
  assert.equal(s.rfVisible,false,'위험예측 지도 층이 하나도 보이지 않는다');assert.equal(s.legendHidden,true);assert.equal(s.bar,false);assert.equal(s.seaTimeOn,false,'하단 시간 바 표식(body.rf-sea-time-on)도 꺼짐');
  const metaBefore=log.meta,n=await fire60();await settle(500);
  assert.ok(n>=1,'60초 주기 타이머를 찾았다');assert.equal(log.meta,metaBefore,'다른 탭에 있는 동안 60초 주기가 돌아도 위험예측 자료를 요청하지 않는다');
 });

 await check('해양안전생활로 돌아오면 위험예측·해상 ON·[혼잡도]·+3H 시각·지도 위치·배경이 그대로, 자료는 새로 받음',async()=>{
  const metaBefore=log.meta;
  await tab('ocean-life-group');await page.waitForFunction(()=>window._riskForecastApp.getState().enabled);await settle(900);
  const s=await S();
  assert.deepEqual([s.tab,s.safety,s.btn,s.app.enabled,s.app.coast,s.app.sea,s.cong],['ocean-life-group',true,true,true,true,true,'true']);
  assert.equal(s.app.t,coastPlus3(),'미래 시각(+3H)은 그대로');assert.equal(s.bar,true);assert.equal(s.rfVisible,true);
  assert.deepEqual(s.view,before.view,'지도 중심·확대 그대로');assert.equal(s.base,before.base,'배경지도 그대로');
  assert.ok(log.meta>metaBefore,'돌아오면 최신 자료로 다시 맞춘다(meta 재요청)');
 });

 await check('해양종합정보 탭에는 위험예측이 따라가지 않고, 다녀오면 그대로 복원',async()=>{
  await tab('ocean-map-section');await settle(900);
  let s=await S();
  assert.equal(s.tab,'ocean-map-section');assert.equal(s.safety,false);assert.equal(s.btn,false,'해양종합정보에서 위험예측 버튼이 켜져 있지 않다');assert.equal(s.app.enabled,false);assert.equal(s.rfVisible,false,'공유 지도에 위험예측 층이 남지 않는다');assert.equal(s.bar,false);
  await page.evaluate(()=>{const v=window.getOceanMap().getView();v.setCenter(ol.proj.fromLonLat([129.5,35.5]));v.setZoom(8);});await settle(200);
  await tab('ocean-life-group');await page.waitForFunction(()=>window._riskForecastApp.getState().enabled);await settle(900);
  s=await S();
  assert.deepEqual([s.btn,s.app.coast,s.app.sea,s.cong,s.app.t],[true,true,true,'true',coastPlus3()]);
  assert.deepEqual(s.view,before.view,'해양종합정보에서 옮긴 지도 위치가 아니라 해양안전에서 보던 위치');
 });

 await check('해양안전을 보던 중 같은 탭을 다시 눌러도 꺼지지 않는다(서브탭 바 펼치기)',async()=>{
  const metaBefore=log.meta;await tab('ocean-life-group');await settle(600);const s=await S();
  assert.deepEqual([s.safety,s.btn,s.app.enabled,s.app.sea,s.app.t],[true,true,true,true,coastPlus3()]);assert.equal(log.meta,metaBefore,'다시 누름은 다시 받지 않는다');
 });

 await check('「현재」였으면 돌아온 시점의 현재로 맞춘다',async()=>{
  await step('now');await page.waitForFunction(()=>{const a=window._riskForecastApp.getState();return a.t&&document.querySelector('[data-time-step="now"]').getAttribute('aria-pressed')==='true';});
  await tab('promo-section');await settle();
  clock.now+=3*3600000;   // 다른 탭에 있는 동안 3시간이 지났다
  await tab('ocean-life-group');await page.waitForFunction(t=>window._riskForecastApp.getState().t===t,T.isoKst(clock.now),{timeout:8000});
  const s=await S();assert.equal(s.app.t,T.isoKst(clock.now));assert.equal(s.btn,true);
 });

 await check('열려 있던 위험예측 시트(관광지)를 다시 연다 — 다른 탭에서는 닫혀 뒤로가기 목록에도 없음',async()=>{
  await page.evaluate(()=>document.querySelector('[data-layer="sea"]').click());await settle(500);   // 해상 끔 → 연안만
  await page.evaluate(()=>window._riskForecastApp.select('coast','S1'));await page.waitForFunction(()=>document.querySelector('#risk-forecast-sheet .rf-title').textContent.includes('S1'));
  await tab('weather-group');await settle();
  let s=await S();assert.equal(s.sheetOpen,false,'다른 탭에서는 시트가 닫혀 있다');assert.equal(s.app.selected,null);
  assert.equal((s.stack||[]).includes('risk-forecast-sheet'),false,'숨은 시트가 뒤로가기 목록에 남지 않는다');
  await tab('ocean-life-group');await page.waitForFunction(()=>document.getElementById('risk-forecast-sheet').classList.contains('open')&&document.querySelector('#risk-forecast-sheet .rf-title').textContent.includes('S1'),null,{timeout:8000});
  s=await S();assert.deepEqual(s.app.selected&&[s.app.selected.kind,s.app.selected.id],['coast','S1']);
  assert.ok(s.title.includes(T.isoKst(clock.now)),'시트 시각은 메인 시각(현재)에서 시작 — '+s.title);assert.ok((s.stack||[]).includes('risk-forecast-sheet'),'다시 연 시트는 뒤로가기 목록에 있다');
  // 2026-10-16 선택 테두리·시트 올라오기: 다시 연 관광지도 해구기상 선택과 같은 시안 2.5px 테두리, 시트는 아래에서 올라와 제자리(계산된 transform)에 선다.
  await page.waitForFunction(()=>{const m=getComputedStyle(document.getElementById('risk-forecast-sheet')).transform;return m==='none'||m==='matrix(1, 0, 0, 1, 0, 0)';});
  const sel=await page.evaluate(()=>{const l=window.getOceanMap().getLayers().getArray().find(l=>l.getClassName()==='rf-selection-canvas');return l.getSource().getFeatures().map(f=>{const st=f.getStyle(),k=st.getStroke()||st.getImage().getStroke();return[k.getColor(),k.getWidth()];});});
  assert.ok(sel.length>0&&sel.every(([c,w])=>c==='#4fc3f7'&&w===2.5),'다시 연 선택 테두리 '+JSON.stringify(sel));
  await page.evaluate(()=>document.querySelector('#risk-forecast-sheet .rf-close').click());
 });

 await check('열려 있던 해상 시트(해역)는 같은 좌표로 다시 연다',async()=>{
  await page.evaluate(()=>document.querySelector('[data-layer="sea"]').click());await settle(500);
  await page.evaluate(()=>window._riskForecastApp.select('marine','point',{lon:126.5375,lat:33.5625}));await page.waitForFunction(()=>document.getElementById('risk-forecast-sheet').classList.contains('open')&&!document.getElementById('risk-forecast-sheet').hasAttribute('aria-busy'),null,{timeout:8000});
  await tab('ocean-map-section');await settle();
  assert.equal((await S()).sheetOpen,false,'해양종합정보에는 해상 시트가 따라가지 않는다');
  await tab('ocean-life-group');await page.waitForFunction(()=>{const a=window._riskForecastApp.getState();return a.selected&&a.selected.kind==='marine';},null,{timeout:8000});
  await page.waitForFunction(()=>document.getElementById('risk-forecast-sheet').classList.contains('open')&&!document.getElementById('risk-forecast-sheet').hasAttribute('aria-busy'),null,{timeout:8000});
  const s=await S();assert.deepEqual(s.app.selected.location,{lon:126.5375,lat:33.5625});assert.equal(s.sheetOpen,true);assert.ok(s.title.length>0,'해상 시트 제목이 채워졌다');
  assert.ok(log.analysis.every(q=>q.lon===126.5375&&q.lat===33.5625)&&log.analysis.length>=1,'해상 분석은 같은 좌표로만 요청');
  await page.evaluate(()=>document.querySelector('#risk-forecast-sheet .rf-close').click());
 });

 await check('해양생활(활동) 하위탭에서 떠나도 그 활동·지도 위치로 돌아온다',async()=>{
  await page.evaluate(()=>document.getElementById('ls-life-sub-btn').click());await page.waitForFunction(()=>document.body.classList.contains('ls-life')&&window.getFishingMap&&window.getFishingMap());await settle(800);
  let s=await S();assert.equal(s.btn,false,'해양생활로 가면 해양안전 버튼은 종전대로 꺼진다');
  await page.evaluate(()=>{const v=window.getFishingMap().getView();v.setCenter(ol.proj.fromLonLat([128.6,34.8]));v.setZoom(10);});await settle(200);
  const fv=await page.evaluate(()=>{const v=window.getFishingMap().getView();return{c:v.getCenter().map(Math.round),z:v.getZoom()};});
  await tab('weather-group');await settle();await tab('ocean-life-group');await settle(1800);
  s=await S();const fv2=await page.evaluate(()=>{const v=window.getFishingMap().getView();return{c:v.getCenter().map(Math.round),z:v.getZoom()};});
  assert.equal(s.life,true,'해양생활 활동 화면으로 돌아왔다');assert.equal(await page.evaluate(()=>document.getElementById('fishing-section').classList.contains('active')),true);
  assert.deepEqual(fv2,fv,'바다낚시 지도 위치 그대로');
 });

 await check('다른 버튼도 같은 방식 — 관제구역 켜고 배경을 해안도로 바꾼 뒤 다녀오면 버튼·해안도 그대로, 끄면 켜기 전 배경',async()=>{
  await page.evaluate(()=>document.querySelector('#ocean-safety-sub-tabs .sub-tab-btn[data-target="ocean-safety-section"]').click());await page.waitForFunction(()=>document.body.classList.contains('ls-safety'));await settle(500);
  const pre=(await S()).base;
  await page.evaluate(()=>document.getElementById('ocean-vts-toggle-btn').click());await page.waitForFunction(()=>document.getElementById('ocean-vts-toggle-btn').classList.contains('active'));await settle(300);
  assert.equal((await S()).base,'enc','관제구역은 켜면 전자해도로 바뀐다(전제 확인)');
  await page.evaluate(()=>window.oceanSetBasemap('coast'));
  await tab('weather-group');await settle();
  assert.equal(await page.evaluate(()=>document.getElementById('ocean-vts-toggle-btn').classList.contains('active')),false,'다른 탭에서는 꺼져 있다');
  await tab('ocean-life-group');await page.waitForFunction(()=>document.getElementById('ocean-vts-toggle-btn').classList.contains('active'),null,{timeout:5000});await settle(300);
  assert.equal((await S()).base,'coast','떠날 때 보던 배경(해안도)');
  await page.evaluate(()=>document.getElementById('ocean-vts-toggle-btn').click());await settle(300);
  assert.equal((await S()).base,pre,'끄면 관제구역을 켜기 전 배경으로 돌아간다');
 });

 // ── 2026-10-16 둘째 결정: ① 범례 스위치·사고 「현황」도 되살림 ② 하위 탭(해양안전 ↔ 해양생활) 사이에서도 유지 ──
 //   사용자 결정 원문: 「4-1, 2, 3 추천대로」 — ①위험·금지구역 범례 스위치와 사고 「현황」 모드 되살리기
 //   ②하위 탭끼리 옮겨 다녀도 각 하위 탭 상태 유지 ③해양안전생활 탭 다시 누름은 지금 동작 그대로.
 const sub=t=>page.evaluate(t=>{const b=t==='life'?document.getElementById('ls-life-sub-btn'):document.querySelector('#ocean-safety-sub-tabs .sub-tab-btn[data-target="ocean-safety-section"]');b.click();},t);
 const toLife=async()=>{await sub('life');await page.waitForFunction(()=>document.body.classList.contains('ls-life'));await settle(800);};
 const toSafety=async()=>{await sub('safety');await page.waitForFunction(()=>document.body.classList.contains('ls-safety'));await settle(900);};
 /** 해양종합정보 지도에서 지금 보이는 층(고유번호) 목록 — 떠날 때와 돌아왔을 때 같은 층이 보이는지 맞대어 본다. */
 const vis=()=>page.evaluate(()=>window.getOceanMap().getLayers().getArray().filter(l=>l.getVisible()).map(l=>ol.util.getUid(l)).sort());
 const rowsOn=()=>page.evaluate(()=>['tgl-row-exposed','tgl-row-rock','bzl-row-ac','bzl-row-fb'].map(id=>document.getElementById(id).classList.contains('on')));
 const ctrlsShown=()=>page.evaluate(()=>getComputedStyle(document.getElementById('ocean-overlay-controls')).display!=='none');
 /** 메인탭(특보정보) 한 번, 하위 탭(해양생활) 한 번 다녀온 뒤 매번 같은 검사를 돌린다. @param {function} ready - 돌아와 다 켜졌는지 @param {function} same - 같은지 검사 */
 const bothTrips=async(ready,same)=>{
  await tab('weather-group');await settle();await tab('ocean-life-group');await page.waitForFunction(ready,null,{timeout:8000});await settle(600);await same('메인탭 왕복');
  await toLife();await toSafety();await page.waitForFunction(ready,null,{timeout:8000});await settle(600);await same('하위 탭 왕복');
 };

 await check('하위 탭: 위험예측(해상·[혼잡도]·+3H·지도 위치·시트) → 해양생활 → 해양안전 하면 그대로, 해양생활에 있는 동안 층·60초 갱신 멈춤',async()=>{
  await load();await tab('ocean-life-group');await settle();await riskOnFirst();
  await page.evaluate(()=>document.querySelector('[data-layer="sea"]').click());await settle(600);
  await page.evaluate(()=>document.querySelector('[data-marine-mode="congestion"]').click());await settle(600);
  await step(3);await page.waitForFunction(t=>window._riskForecastApp.getState().t===t,coastPlus3());
  await page.evaluate(()=>{const v=window.getOceanMap().getView();v.setCenter(ol.proj.fromLonLat([126.7,34.3]));v.setZoom(9.25);});await settle(300);
  await page.evaluate(()=>window._riskForecastApp.select('coast','S1'));await page.waitForFunction(()=>document.querySelector('#risk-forecast-sheet .rf-title').textContent.includes('S1'));
  const b=await S();
  await toLife();
  let s=await S();
  assert.deepEqual([s.btn,s.app.enabled,s.rfVisible,s.bar,s.sheetOpen],[false,false,false,false,false],'해양생활에서는 위험예측 버튼·층·시간 바·시트가 꺼져 있다');
  const metaBefore=log.meta;await fire60();await settle(400);assert.equal(log.meta,metaBefore,'해양생활에 있는 동안 60초 주기가 돌아도 요청하지 않는다');
  await toSafety();await page.waitForFunction(()=>document.getElementById('risk-forecast-sheet').classList.contains('open')&&document.querySelector('#risk-forecast-sheet .rf-title').textContent.includes('S1'),null,{timeout:8000});
  s=await S();
  assert.deepEqual([s.btn,s.app.enabled,s.app.coast,s.app.sea,s.cong,s.app.t],[true,true,true,true,'true',coastPlus3()],'위험예측 안의 상태 그대로');
  assert.deepEqual(s.view,b.view,'지도 위치 그대로');assert.equal(s.base,b.base,'배경 그대로');
  assert.deepEqual(s.app.selected&&[s.app.selected.kind,s.app.selected.id],['coast','S1'],'열려 있던 시트를 다시 연다');
  await page.evaluate(()=>document.querySelector('#risk-forecast-sheet .rf-close').click());await settle(300);
 });

 await check('하위 탭: 해양안전을 보던 중 해양안전 하위 탭을 다시 눌러도 꺼지지 않고, 해양종합정보로 새지도 않는다',async()=>{
  const metaBefore=log.meta;await sub('safety');await settle(900);
  let s=await S();assert.deepEqual([s.safety,s.btn,s.app.enabled,s.app.sea,s.app.t],[true,true,true,true,coastPlus3()]);assert.equal(log.meta,metaBefore,'다시 누름은 다시 받지 않는다');
  await tab('ocean-map-section');await settle(900);
  s=await S();assert.equal(s.btn,false,'해양종합정보에서 위험예측이 켜지지 않는다');assert.equal(s.rfVisible,false);
  await tab('ocean-life-group');await page.waitForFunction(()=>window._riskForecastApp.getState().enabled,null,{timeout:8000});await settle(600);
  await page.evaluate(()=>document.getElementById('ocean-risk-forecast-toggle-btn').click());await settle(400);   // 다음 사례를 위해 끈다
 });

 await check('위험지형 범례 스위치(「간출암, 암암 등」 끔) — 메인탭·하위 탭 다녀와도 스위치·보이는 층 그대로',async()=>{
  await page.evaluate(()=>document.getElementById('ocean-terrain-toggle-btn').click());
  await page.waitForFunction(()=>{const i=document.querySelector('#ocean-rock-toggle-btn i');return document.getElementById('ocean-rock-toggle-btn').classList.contains('active')&&!(i&&/fa-spin/.test(i.className));},null,{timeout:15000});await settle(400);
  await page.evaluate(()=>document.getElementById('tgl-row-rock').click());await settle(300);
  const r=await rowsOn(),v=await vis();assert.deepEqual(r.slice(0,2),[true,false],'전제: 노출암 켬·간출암 끔');
  await bothTrips(()=>document.getElementById('ocean-terrain-toggle-btn').classList.contains('active'),async w=>{
   assert.deepEqual((await rowsOn()).slice(0,2),[true,false],w+' — 스위치 그대로');assert.deepEqual(await vis(),v,w+' — 보이는 층 그대로');
   assert.equal(await page.evaluate(()=>document.getElementById('terrain-legend').style.display),'flex',w+' — 범례가 떠 있다');});
  await page.evaluate(()=>document.getElementById('ocean-terrain-toggle-btn').click());await settle(300);
 });

 await check('금지구역 범례 스위치(「낚시금지구역」 끔) — 메인탭·하위 탭 다녀와도 스위치·보이는 층 그대로',async()=>{
  await page.evaluate(()=>document.getElementById('ocean-banzone-toggle-btn').click());
  await page.waitForFunction(()=>['ocean-access-control-toggle-btn','ocean-fishing-ban-toggle-btn'].every(id=>document.getElementById(id).classList.contains('active')),null,{timeout:15000});await settle(1500);
  await page.evaluate(()=>document.getElementById('bzl-row-fb').click());await settle(300);
  const v=await vis();assert.deepEqual((await rowsOn()).slice(2),[true,false],'전제: 출입통제 켬·낚시금지 끔');
  await bothTrips(()=>document.getElementById('ocean-banzone-toggle-btn').classList.contains('active'),async w=>{
   assert.deepEqual((await rowsOn()).slice(2),[true,false],w+' — 스위치 그대로');assert.deepEqual(await vis(),v,w+' — 보이는 층 그대로');});
  await page.evaluate(()=>document.getElementById('ocean-banzone-toggle-btn').click());await settle(300);
 });

 await check('사고정보 「현황」 — 메인탭·하위 탭 다녀오면 현황·배경 그대로, 끄면 켜기 전 배경',async()=>{
  const pre=(await S()).base;
  await page.evaluate(()=>document.getElementById('ocean-accident-toggle-btn').click());
  await page.waitForFunction(()=>document.getElementById('ocean-accident-mode-toggle').style.display==='flex',null,{timeout:30000});await settle(300);
  await page.evaluate(()=>document.querySelector('#ocean-accident-mode-toggle [data-mode="status"]').click());await settle(500);
  await page.evaluate(()=>window.oceanSetBasemap('coast'));await settle(200);
  const mode=()=>page.evaluate(()=>(document.querySelector('#ocean-accident-mode-toggle button.active')||{dataset:{}}).dataset.mode);
  assert.equal(await mode(),'status','전제: 현황');const v=await vis();
  await bothTrips(()=>document.getElementById('ocean-accident-mode-toggle').style.display==='flex'&&(document.querySelector('#ocean-accident-mode-toggle button.active')||{dataset:{}}).dataset.mode==='status',async w=>{
   assert.equal(await mode(),'status',w+' — 현황 그대로');assert.equal((await S()).base,'coast',w+' — 떠날 때 보던 배경');assert.deepEqual(await vis(),v,w+' — 보이는 층 그대로');});
  await page.evaluate(()=>document.getElementById('ocean-accident-toggle-btn').click());await settle(400);
  assert.equal((await S()).base,pre,'끄면 사고정보를 켜기 전 배경으로 돌아간다');
 });

 await check('하위 탭: 해양생활(바다낚시) 지도 위치·열린 지점 팝업 유지, 그 팝업 표시가 해양안전 버튼을 가리지 않는다',async()=>{
  await toLife();
  await page.evaluate(()=>document.querySelector('#ls-rail .ls-act-btn[data-act="surfing-section"]').click());await settle(900);
  await page.evaluate(()=>document.querySelector('#ls-rail .ls-act-btn[data-act="fishing-section"]').click());await page.waitForFunction(()=>window.getFishingMap&&window.getFishingMap()&&document.getElementById('fishing-section').classList.contains('active'));await settle(1800);
  await page.evaluate(()=>{const v=window.getFishingMap().getView();v.setCenter(ol.proj.fromLonLat([126.2,34.6]));v.setZoom(10.5);});await settle(200);
  const fv=await page.evaluate(()=>{const v=window.getFishingMap().getView();return{c:v.getCenter().map(Math.round),z:v.getZoom()};});
  // 지점 팝업 열기 — fishing.js _openBottomSheet 가 하는 것과 같은 표시(시험 서버에는 낚시 자료가 없어 마커를 누를 수 없다)
  await page.evaluate(()=>{document.getElementById('fishing-bottomsheet').classList.add('active');document.getElementById('fishing-bottomsheet-overlay').classList.add('active');});await settle(200);
  await toSafety();
  assert.equal(await ctrlsShown(),true,'해양안전 우측 버튼 묶음이 보인다(해양생활 팝업 표시가 남아 가리지 않는다)');
  await toLife();await settle(1000);
  const fv2=await page.evaluate(()=>{const v=window.getFishingMap().getView();return{c:v.getCenter().map(Math.round),z:v.getZoom()};});
  assert.equal(await page.evaluate(()=>document.getElementById('fishing-section').classList.contains('active')),true,'바다낚시로 돌아왔다');
  assert.deepEqual(fv2,fv,'바다낚시 지도 위치 그대로');
  assert.equal(await page.evaluate(()=>document.getElementById('fishing-bottomsheet').classList.contains('active')),true,'열어 둔 지점 팝업 그대로');
  await page.evaluate(()=>{document.getElementById('fishing-bottomsheet').classList.remove('active');document.getElementById('fishing-bottomsheet-overlay').classList.remove('active');});
 });

 // T24(2026-10-16 「5-하루 하나로 합치기」 + 상단 날짜 넘기기): 연안만 켜고 내일로 넘긴 날짜와 연안 시트도 탭 왕복 뒤 그대로.
 await check('T24 연안만·내일 날짜·연안 시트 — 메인탭·하위 탭 다녀와도 상단 날짜 줄 「내일」·메인 날짜 그대로, 시트도 내일 하루 값으로 다시 열림, 다른 탭에서는 날짜 줄 숨김',async()=>{
  await load();await tab('ocean-life-group');await settle();await riskOnFirst();
  const tmr=T.isoKst(Date.parse(T.dateKey(clock.now+86400000)+'T00:00:00+09:00')),sheetDate="'"+tmr.slice(2,4)+'. '+Number(tmr.slice(5,7))+'. '+Number(tmr.slice(8,10))+'.';
  await page.evaluate(()=>document.querySelector('.rf-date-nav [data-day-step="1"]').click());await page.waitForFunction(t=>window._riskForecastApp.getState().t===t,tmr);
  await page.evaluate(()=>window._riskForecastApp.select('coast','S1'));await page.waitForFunction(t=>document.getElementById('risk-forecast-sheet').classList.contains('open')&&document.querySelector('#risk-forecast-sheet .rf-title').textContent.includes(t),tmr,{timeout:8000});
  const nav=()=>page.evaluate(()=>{const n=document.querySelector('.rf-date-nav');return{shown:!n.hidden&&n.getClientRects().length>0,label:n.querySelector('[data-day-label]').textContent,tag:n.querySelector('[data-day-tag]').textContent};});
  const before=await nav();assert.deepEqual([before.shown,before.tag],[false,'내일'],'전제: 연안만·내일(연안 시트가 열린 동안 상단 날짜 줄은 숨김 — 2026-10-18 「바텀시트 자체에서 넘길 수 있으니」)');
  for(const trip of ['메인탭','하위 탭']){
   if(trip==='메인탭'){await tab('weather-group');await settle();}else await toLife();
   assert.equal((await nav()).shown,false,trip+' — 다른 탭에서는 날짜 줄 숨김');assert.equal((await S()).sheetOpen,false);
   if(trip==='메인탭')await tab('ocean-life-group');else await toSafety();
   await page.waitForFunction(t=>document.getElementById('risk-forecast-sheet').classList.contains('open')&&document.querySelector('#risk-forecast-sheet .rf-title').textContent.includes(t)&&!document.getElementById('risk-forecast-sheet').hasAttribute('aria-busy'),tmr,{timeout:8000});
   const s=await S();assert.equal(s.app.t,tmr,trip+' — 메인 날짜(내일) 그대로');assert.deepEqual(await nav(),before,trip+' — 상단 날짜 줄 그대로');
   assert.ok((await page.evaluate(()=>document.querySelector('#risk-forecast-sheet [data-sheet-date]').textContent)).startsWith(sheetDate),trip+' — 시트 날짜 줄도 내일');
  }
  await page.evaluate(()=>document.querySelector('#risk-forecast-sheet .rf-close').click());await settle(400);
  assert.deepEqual(await nav(),{...before,shown:true},'시트를 닫으면 상단 날짜 줄 「내일」이 다시 보인다');
 });

 // ── 2026-10-16 셋째 결정 「12·13 추천대로」 ──
 //   12. 사고정보 필터·사고 현황의 선박/인명·항행경보 날짜·시각·물빠짐 시간 슬라이더·관제구역 선택 표시도 메인탭·하위탭 왕복 뒤 그대로(메모리만).
 //   13. 해양생활 지점 팝업을 연 채 다른 화면으로 가면 그 팝업이 뒤로가기를 가져가지 않고, 돌아오면 다시 뒤로가기로 닫힌다.
 //       다른 메인탭 팝업의 뒤로가기 동작은 그대로.
 await check('12 사고정보 필터(사고유형)·현황 [인명] — 메인탭·하위 탭 다녀와도 필터·인명·마커 수·배경 그대로',async()=>{
  await load();await tab('ocean-life-group');await settle();
  await page.evaluate(()=>document.getElementById('ocean-accident-toggle-btn').click());
  await page.waitForFunction(()=>document.getElementById('ocean-accident-mode-toggle').style.display==='flex',null,{timeout:30000});await settle(300);
  await page.evaluate(()=>document.querySelector('#ocean-accident-mode-toggle [data-mode="status"]').click());await settle(500);
  await page.evaluate(()=>document.querySelector('#accident-source-toggle [data-source="person"]').click());
  await page.waitForFunction(()=>document.querySelector('#accident-source-toggle [data-source="person"]').classList.contains('active'),null,{timeout:30000});await settle(500);
  /** 지금 보이는 현황 마커(클러스터 안쪽 소스) 수. */
  const markers=()=>page.evaluate(()=>window.getOceanMap().getLayers().getArray().filter(l=>l.getVisible()&&l.getSource&&l.getSource() instanceof ol.source.Cluster).map(l=>l.getSource().getSource().getFeatures().length));
  const n0=await markers();
  await page.evaluate(()=>document.getElementById('accident-filter-btn-types').click());await page.waitForFunction(()=>document.querySelector('.accident-filter-opt-btn'));
  await page.evaluate(()=>{const b=[...document.querySelectorAll('.accident-filter-opt-btn')].find(b=>parseInt(b.querySelector('.n').textContent,10)>0);b.click();document.getElementById('afp-confirm').click();});await settle(500);
  const look=()=>page.evaluate(()=>{const t=document.getElementById('accident-filter-btn-types');return{label:t.textContent,on:t.classList.contains('has-selection'),src:(document.querySelector('#accident-source-toggle button.active')||{dataset:{}}).dataset.source,mode:(document.querySelector('#ocean-accident-mode-toggle button.active')||{dataset:{}}).dataset.mode,base:window.oceanGetBasemap()};});
  const b=await look(),n1=await markers();
  assert.deepEqual([b.on,b.src,b.mode],[true,'person','status'],'전제: 사고유형 필터 걸림·인명·현황');
  assert.ok(n0.length===1&&n1.length===1&&n1[0]>0&&n1[0]<n0[0],'전제: 필터가 인명 마커를 줄였다 '+JSON.stringify([n0,n1]));
  await bothTrips(()=>document.getElementById('ocean-accident-mode-toggle').style.display==='flex'&&(document.querySelector('#accident-source-toggle button.active')||{dataset:{}}).dataset.source==='person',async w=>{
   await settle(500);
   assert.deepEqual(await look(),b,w+' — 필터 단추·인명·현황·배경 그대로');assert.deepEqual(await markers(),n1,w+' — 필터 걸린 인명 마커 수 그대로');});
  await page.evaluate(()=>document.getElementById('ocean-accident-toggle-btn').click());await settle(400);
 });

 await check('12 항행경보 날짜(다음 날)·기준 시각(10:00) — 메인탭·하위 탭 다녀와도 그대로, 그 날짜로만 요청',async()=>{
  await page.evaluate(()=>document.getElementById('ocean-navwarn-btn').click());await page.waitForFunction(()=>document.getElementById('navwarn-date-nav').style.display==='flex');await settle(400);
  await page.evaluate(()=>document.getElementById('navwarn-next-day').click());await settle(400);
  await page.evaluate(()=>{const s=document.getElementById('navwarn-time-slider');s.value='600';s.dispatchEvent(new Event('input'));});await settle(200);
  const look=()=>page.evaluate(()=>({date:document.getElementById('navwarn-date-label').textContent,tag:document.getElementById('navwarn-date-tag').textContent,slider:document.getElementById('navwarn-time-slider').value,time:document.getElementById('navwarn-time-value').textContent,shown:document.getElementById('navwarn-time-bar').style.display}));
  const b=await look(),day=log.navwarn[log.navwarn.length-1];
  assert.deepEqual([b.tag,b.slider,b.time,b.shown],['예정','600','10:00','flex'],'전제: 다음 날·10:00');
  await bothTrips(()=>document.getElementById('ocean-navwarn-btn').classList.contains('active'),async w=>{
   assert.deepEqual(await look(),b,w+' — 날짜·태그·시각 그대로');assert.equal(log.navwarn[log.navwarn.length-1],day,w+' — 고른 날짜로만 받는다');});
  await page.evaluate(()=>document.getElementById('ocean-navwarn-btn').click());await settle(300);
 });

 await check('12 물빠짐 시간 슬라이더(넷째 칸) — 메인탭·하위 탭 다녀와도 같은 칸·말풍선, 그 시각으로 다시 받음',async()=>{
  await page.evaluate(()=>{const v=window.getOceanMap().getView();v.setCenter(ol.proj.fromLonLat([126.5,37.0]));v.setZoom(12);});await settle(300);
  await page.evaluate(()=>document.getElementById('ocean-mudflat-toggle-btn').click());await page.waitForFunction(()=>document.getElementById('mudflat-slider-bar').style.display==='flex',null,{timeout:8000});await settle(500);
  await page.evaluate(()=>{const s=document.getElementById('mudflat-slider');s.value='3';s.dispatchEvent(new Event('input'));});
  const iso3='2026-10-12T01:30:00.000Z';
  await page.waitForFunction(()=>document.getElementById('mudflat-tooltip').textContent==='10/12 10:30',null,{timeout:5000});await settle(500);
  assert.ok(log.tide.includes(iso3),'전제: 넷째 칸(01:30Z = 10:30 KST)을 받았다(켤 때 모든 칸을 미리 받는다)');
  const look=()=>page.evaluate(()=>({v:document.getElementById('mudflat-slider').value,tip:document.getElementById('mudflat-tooltip').textContent}));
  // bothTrips 대신 직접 돈다 — 켤 때 나머지 칸을 미리 받는 요청이 떠난 뒤에도 조금 늦게 도착하므로, 떠나고 잠시 뒤에 요청 수를 적어야
  // 「돌아와 맨 먼저 받은 칸」을 가려낼 수 있다(bothTrips 로 돌렸을 때 앞 왕복의 미리 받기가 섞여 들어온 것을 실측).
  for(const w of ['메인탭 왕복','하위 탭 왕복']){
   if(w==='메인탭 왕복'){await tab('weather-group');}else await toLife();
   await settle(600);const n=log.tide.length;
   if(w==='메인탭 왕복')await tab('ocean-life-group');else await sub('safety');
   await page.waitForFunction(()=>document.getElementById('mudflat-slider-bar').style.display==='flex'&&document.getElementById('mudflat-tooltip').textContent!=='',null,{timeout:8000});
   for(let i=0;i<40&&log.tide.length<=n;i++)await settle(100);
   assert.deepEqual(await look(),{v:'3',tip:'10/12 10:30'},w+' — 슬라이더·말풍선 그대로');
   // 끌 때 캐시를 비우므로 돌아와 다시 켜면 맨 먼저 지금 칸(renderFrame(_frameIdx))을 받고, 그 뒤에 나머지 칸을 미리 받는다
   assert.equal(log.tide[n],iso3,w+' — 돌아와 맨 먼저 같은 시각을 받는다 '+JSON.stringify(log.tide.slice(n,n+3)));
   await settle(600);
  }
  await page.evaluate(()=>document.getElementById('ocean-mudflat-toggle-btn').click());await settle(300);
 });

 await check('12 관제구역 선택 표시(연보라 굵은 테두리) — 메인탭·하위 탭 다녀와도 같은 구역이 선택돼 있다',async()=>{
  await page.evaluate(()=>document.getElementById('ocean-vts-toggle-btn').click());
  await page.waitForFunction(()=>window.getOceanMap().getLayers().getArray().some(l=>l.getSource&&l.getSource()&&l.getSource().getFeatures&&l.getSource().getFeatures().some(f=>/VTS/.test(f.get('name')||''))),null,{timeout:8000});
  // 실제 지도 클릭과 같은 길 — ocean_map.js handleMapClick 이 부르는 window._vtsZoneTryHandleClick 에 그 구역 안쪽 화소를 넘긴다.
  const picked=await page.evaluate(()=>{const m=window.getOceanMap(),src=m.getLayers().getArray().map(l=>l.getSource&&l.getSource()).find(s=>s&&s.getFeatures&&s.getFeatures().some(f=>/VTS/.test(f.get('name')||'')));
   const f=src.getFeatures().find(f=>/VTS/.test(f.get('name')||''));m.getView().fit(f.getGeometry().getExtent(),{padding:[60,60,60,60]});m.renderSync();
   const px=m.getPixelFromCoordinate(f.getGeometry().getInteriorPoint().getCoordinates());window._vtsZoneTryHandleClick(m,{pixel:px});return f.get('name');});
  /** 선택된 구역 이름과 그 구역의 테두리 굵기(선택이면 4). */
  const sel=()=>page.evaluate(()=>{const f=window._vtsZoneGetSelected();if(!f)return null;const m=window.getOceanMap(),w=m.getLayers().getArray().filter(l=>l.getVisible()&&l.getStyleFunction&&l.getStyleFunction()).map(l=>l.getStyleFunction()(f,m.getView().getResolution())).filter(s=>s&&s.getStroke&&s.getStroke()).map(s=>s.getStroke().getWidth());return{name:f.get('name'),w};});
  const b=await sel();assert.ok(b&&b.name===picked&&b.w.includes(4),'전제: 누른 구역이 선택(굵기 4) '+JSON.stringify(b));
  await bothTrips(()=>document.getElementById('ocean-vts-toggle-btn').classList.contains('active'),async w=>{assert.deepEqual(await sel(),b,w+' — 같은 구역이 선택 표시');});
  await page.evaluate(()=>document.getElementById('ocean-vts-toggle-btn').click());await settle(300);
  await page.evaluate(()=>document.getElementById('ocean-vts-toggle-btn').click());await settle(300);
  assert.equal(await sel(),null,'사용자가 직접 껐다 켜면 선택은 비워진다(종전 규칙 그대로)');
  await page.evaluate(()=>document.getElementById('ocean-vts-toggle-btn').click());await settle(300);
 });

 /** 휴대폰 뒤로가기 한 번(웹 환경은 backbutton.js 의 history 트랩이 popstate 로 받는다). */
 //   시험 서버에는 특보 API 가 없어 「서버 점검」 안내(admin_trigger.js)가 떠 뒤로가기 목록에 들어간다. 그 항목은 뒤로가기로
 //   닫으면 페이지를 새로 고치므로(backbutton.js wrapMaintenancePopup) 누르기 전에 그 안내만 걷어 낸다(목록에서도 빠진다).
 const back=async()=>{await page.evaluate(()=>['server-maintenance-popup','network-error-popup'].forEach(id=>{const e=document.getElementById(id);if(e)e.remove();}));await settle(50);
  await page.evaluate(()=>history.back());await settle(400);};
 const stack=()=>page.evaluate(()=>window.PopupStack.list().filter(id=>!/^(server-maintenance|network-error)-popup$/.test(id)));
 const fishOpen=()=>page.evaluate(()=>document.getElementById('fishing-bottomsheet').classList.contains('active'));
 /** 바다낚시 지점 팝업 열기 — fishing.js _openBottomSheet 와 같은 표시·같은 뒤로가기 항목(시험 서버에는 낚시 자료가 없어 마커를 누를 수 없다). */
 const openFish=()=>page.evaluate(()=>{const s=document.getElementById('fishing-bottomsheet'),o=document.getElementById('fishing-bottomsheet-overlay');s.classList.add('active');o.classList.add('active');
  window.PopupStack.push('fishing-bottomsheet',()=>{s.classList.remove('active');o.classList.remove('active');window.PopupStack.remove('fishing-bottomsheet');});});

 await check('13 뒤로가기 — 바다낚시 팝업을 연 채 해양안전 하위 탭으로 가면 뒤로가기가 그 팝업을 닫지 않고, 돌아오면 뒤로가기로 닫힌다',async()=>{
  await load();await tab('ocean-life-group');await settle();await toLife();
  await page.evaluate(()=>document.querySelector('#ls-rail .ls-act-btn[data-act="fishing-section"]').click());await page.waitForFunction(()=>document.getElementById('fishing-section').classList.contains('active'));await settle(600);
  await openFish();assert.ok((await stack()).includes('fishing-bottomsheet'),'전제: 팝업이 뒤로가기 목록에 있다');
  await toSafety();
  assert.equal((await stack()).includes('fishing-bottomsheet'),false,'해양안전에서는 숨은 팝업이 뒤로가기 목록에 없다');
  await back();
  assert.equal(await fishOpen(),true,'해양안전에서 뒤로가기를 눌러도 숨은 바다낚시 팝업은 그대로 열려 있다');
  assert.equal(await page.evaluate(()=>!!document.getElementById('back-exit-toast')),true,'목록이 비었으니 「한번 더 누르면 종료」 안내가 뜬다');
  await toLife();
  assert.equal(await fishOpen(),true,'돌아오면 팝업 그대로');assert.ok((await stack()).includes('fishing-bottomsheet'),'돌아오면 뒤로가기 목록에 다시 있다');
  await back();
  assert.equal(await fishOpen(),false,'돌아온 뒤 뒤로가기는 그 팝업을 닫는다');assert.equal((await stack()).includes('fishing-bottomsheet'),false);
 });

 await check('13 뒤로가기 — 메인탭(특보정보)으로 가도 숨은 바다낚시 팝업은 건너뛰고, 특보정보의 팝업은 종전대로 뒤로가기로 닫힌다·다른 항목은 탭 왕복에 손대지 않음',async()=>{
  await settle(2600);   // 앞 사례의 「한번 더 누르면 종료」 2.5초가 지나야 빈 목록 뒤로가기가 앱을 닫지 않는다
  await openFish();
  await tab('weather-group');await settle();
  assert.equal((await stack()).includes('fishing-bottomsheet'),false,'특보정보에서는 숨은 팝업이 뒤로가기 목록에 없다');
  await page.evaluate(()=>window.showSeagnalModal('시험','본문','info'));await settle(200);
  assert.deepEqual(await stack(),['seagnal-custom-modal'],'특보정보에서 연 팝업만 목록에 있다');
  await back();
  assert.equal(await page.evaluate(()=>{const m=document.getElementById('seagnal-custom-modal');return !!m&&getComputedStyle(m).display!=='none';}),false,'특보정보의 팝업이 뒤로가기로 닫혔다(종전 그대로)');
  assert.equal(await fishOpen(),true,'숨은 바다낚시 팝업은 그대로');
  // 이 화면 밖 항목(가짜 'x-other')은 탭 왕복이 빼거나 순서를 바꾸지 않는다
  await page.evaluate(()=>window.PopupStack.push('x-other',()=>{}));
  await tab('ocean-life-group');await settle(1200);
  let st=await stack();assert.deepEqual(st,['x-other','fishing-bottomsheet'],'해양생활로 돌아오면 바다낚시 항목이 다시 맨 위에, 다른 항목은 그대로 '+JSON.stringify(st));
  await toSafety();await tab('promo-section');await settle();await tab('ocean-life-group');await settle(1200);
  st=await stack();assert.deepEqual(st,['x-other'],'해양안전·공지사항을 오가도 다른 항목은 그대로(해양안전 하위 탭이라 바다낚시 항목은 빠져 있음) '+JSON.stringify(st));
  await page.evaluate(()=>window.PopupStack.remove('x-other'));
  await toLife();assert.deepEqual(await stack(),['fishing-bottomsheet']);
  await back();assert.equal(await fishOpen(),false,'돌아온 뒤 뒤로가기는 바다낚시 팝업을 닫는다');
 });

 await check('새로고침(앱 다시 켜기)하면 처음 상태 — 해양안전 하위탭·위험예측 꺼짐·잠김',async()=>{
  await load();await tab('ocean-life-group');await settle();const s=await S();
  assert.equal(s.safety,true);assert.equal(s.life,false);assert.equal(s.btn,false);assert.equal(s.locked,true);assert.equal(s.app,null);
  assert.equal(await page.evaluate(()=>{try{return Object.keys(localStorage).filter(k=>/park|tab.?keep|life.?safety/i.test(k)).length;}catch(e){return 0;}}),0,'기억을 localStorage 에 남기지 않는다');
 });

 await check('실행 오류 없음',()=>assert.deepEqual(errors,[]));
}finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});console.log(`${pass} PASS / ${fail} FAIL`);if(fail)process.exitCode=1;}})().catch(e=>{console.error('❌ 브라우저 검사 실행 실패:',e.message);console.log(`${pass} PASS / ${fail+1} FAIL`);process.exitCode=1;});
