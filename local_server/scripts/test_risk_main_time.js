/**
 * 파일명: local_server/scripts/test_risk_main_time.js
 * 역할  : 메인 시각(하단 5버튼·시각 토스트)과 연안 색 범례(2026-10-16)를 실제 Chromium에서 검사한다.
 *         T24(2026-10-16 「연안위험 예측에서 하단의 시간대는 + - 해놓은 기획은 빼야겠지 ? 날짜별로 넘겨가며 볼 수 있도록 변경 필요.」): 하단 시간 바는 해상이 켜져 있을 때만,
 *         연안만 켜면 바 대신 상단 가운데 날짜 넘기기(자세한 검사는 test_risk_coast_day). 연안 지도는 그 시각이 든 KST 날짜의 하루 값(가짜 저장소 dayScore — 오늘 4·내일 7). 하단 5버튼 -6H·-3H·현재·+3H·+6H — 2026-10-16, -12H·+12H 는 같은 날 사용자 「버튼이 높아지네 ? +12 -12버튼은 빼도록 하자」로 뺐다)을 실제 Chromium에서 검사한다.
 *         메인 시각을 옮기면 연안 지도가 그 시각으로 바뀌는지, 처음엔 「-」 둘이 회색이고 +3H 뒤 -3H 가 켜지는지,
 *         버튼 안 작은 글씨(갈 시각)가 이동에 따라 바뀌고 [현재]만 그대로인지, 연안 범위 끝(내일 21시 — 「가」)에서 「+」가 꺼지는지,
 *         연안만·해상만·둘 다 켠 경우, 380·320px 에서 버튼이 겹치거나 글자가 잘리지 않는지,
 *         시트 시각이 메인과 서로 새지 않는지(메인15시→시트18시→닫으면 메인15시·새 시트도 15시)를 본다.
 *         RISK_SHOT_DIR 을 주면 380·320px 하단(처음·+3H 뒤·끝)을 그 폴더에 PNG 로 남긴다(없으면 찍지 않는다).
 * [연계] 실제 risk_forecast/risk_map_layer/risk_sheet/risk_slider 모듈 + 실제 라우터·해상 저장소 fixture → verify_all.
 * [로드 순서] 독립 검사; 외부 수집·운영 키·Gemini 호출 없음. 연안 프레임은 서버와 같은 시간 검증을 하는 가짜 저장소.
 */
'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert'),express=require('express'),{chromium}=require('playwright-core');
const root=path.join(__dirname,'../..'),io=require('../services/risk_collector_io'),M=require('../services/marine_fusion'),T=require('../services/risk_time'),{createRouter}=require('../routes/risk_forecast');
let pass=0,fail=0;
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'main-time-')),now=Date.parse('2026-10-12T11:00:00+09:00'),at=T.isoKst(now);
// 연안 축은 서버 meta와 같게 오늘·내일(내일 21시 끝) — 사용자 확정 2026-10-15 「가」 연안 2일 제한.
const coastTimes=T.timeline(now,3,2,21),seaTimes=T.timeline(now,1,2,23),iso=s=>T.isoKst(Date.parse(s));
/** 실제 브라우저 결과를 검사한다. 예: check('연안 이동',async()=>{...}). @param {string} name - 사례 @param {function} fn - 검사 @returns {Promise<void>} [연계] ← 아래 시나리오 / 실패를 모아 요약한다. */
async function check(name,fn){try{await fn();console.log('✅',name);pass++;}catch(e){console.error('❌',name,e.message);fail++;}}
/** 3시간 슬롯 번호로 연안 점수를 만든다. 예: 12시→4. 시각마다 다른 값이라 화면이 그 시각 프레임인지 구별된다. @param {string} t - KST ISO @returns {number} 가짜 점수 [연계] ← 가짜 coast frame·기대값 */
function scoreAt(t){return Math.floor(((Date.parse(t)+9*3600000)%86400000)/10800000/1)+1;}
/** 연안 하루 값(T24)을 날짜로 만든다. 예: 10-12 의 어느 시각 → 4, 10-13 → 7. 날짜마다 달라 지도가 그 시각의 날짜 값인지 구별된다. @param {string} t - KST ISO @returns {number} [연계] ← 가짜 coastDayFrame·waitCoast */
function dayScore(t){return T.dateKey(t)==='2026-10-12'?4:7;}
(async()=>{let browser,server;try{
 const geometry={type:'Polygon',coordinates:[[[126.525,33.55],[126.55,33.55],[126.55,33.575],[126.525,33.575],[126.525,33.55]]]},cell={id:'GR4_F4K23_P4',i:0,lat:33.5625,lon:126.5375,geometry,haegu:{label:'163-6',major:163,sub:6},ref:{name:'제주항',bearingWord:'북서',distNm:8.2}},acc={...cell,id:'100'};
 io.write(path.join(dir,'sea_realtime.json.gz'),{v:'v1',cells:[cell],rows:[[0,21,.2]],collectedAt:at,sourceAt:null,source:'MTIS realtime API'});
 // 공식 사고예보는 연안 2일 전체 3시간 칸에 값을 둔다 → 해상 지도가 비면 자료 부재가 아니라 화면 문제임이 구분된다.
 const frames={'202610120900':[[0,.001,'경계']]};for(const t of coastTimes)frames[t.slice(0,13).replace(/[-T]/g,'')+'00']=[[0,.002,'주의']];
 const inputs={version:1,cells:{cells:[cell]},congestion:{frames:{}},accident:{cells:[acc],frames},sources:{accident:{status:'ok'},congestion:{status:'ok'},zoneForecasts:{status:'ok'}},weather:()=>({wh:2,ws:12,wp:4,wd:241,forecastAt:at})};
 const sources=inputs.sources,log={coast:[],bad:[],detail:[],unified:[],analysis:[]};
 const ring=(x,y)=>[[x,y],[x+.01,y],[x+.01,y+.01],[x,y+.01],[x,y]],spots=[{id:'S1',i:0,lat:33.5,lon:126.5,cell:ring(126.5,33.5)},{id:'S2',i:1,lat:34.5,lon:127.5,cell:ring(127.5,34.5)}];
 /** 서버 validateTime과 같은 범위(지금-5분 ~ 연안 마지막 칸)만 받는다. 범위 밖 요청은 기록하고 400. @param {string} t @returns {string} KST ISO [연계] ← 가짜 frame/detail */
 function valid(t){const n=Date.parse(t);if(!Number.isFinite(n)||n<now-5*60000||n>Date.parse(coastTimes.at(-1))){log.bad.push(t);throw Object.assign(new Error('잘못된 예보 시각'),{status:400});}return T.isoKst(n);}
 const store={sources:()=>sources,marineInputs:()=>inputs,
  meta:()=>({now:at,versions:{spots:'v1',cells:1,accident:'v1'},timeline:{sea:{times:seaTimes},accident:{times:coastTimes},coast:{times:coastTimes}},sources}),
  spots:()=>({spots}),cells:()=>({cells:[cell]}),accidentCells:()=>({v:'v1',cells:[acc]}),accidentFrame:()=>({v:'v1',cells:[[0,.001,'경계']]}),
  frame:(sea,t)=>{t=valid(t);return{cells:[[0,0,1,'낮음']],spots:[],borders:[]};},
  // 연안 지도·상세는 날짜당 하나(T24 — 라우터가 coastDayFrame·coastDayDetail 을 부른다).
  coastDayFrame:t=>{t=valid(t);log.coast.push(t);return{spots:spots.map(s=>[s.i,dayScore(t)+s.i]),degraded:[]};},
  coastDayDetail:(id,t)=>{t=valid(t);log.detail.push({id,t});return{title:'연안 '+id+' '+t,subtitle:{lat:33.5,lon:126.5},clickable:false,t,daily:{date:T.dateKey(t),peakAt:t,times:[t]}};},islands:()=>({features:[]})};
 const marine=M.createStore({risk:store,dir,clock:()=>now,stations:[{properties:{name:'제주파출소'},geometry}],accidents:[],describe:()=>cell});
 const app=express();app.use((req,res,next)=>{if(req.path.endsWith('/sea/unified-frame'))log.unified.push(iso(req.query.t));if(req.path.endsWith('/sea/analysis'))log.analysis.push(iso(req.query.t));next();});
 app.use(createRouter({store,marine}));app.get('/api/warn-zones',(req,res)=>res.json({features:[]}));app.get('/api/warn-zones-sub',(req,res)=>res.json({features:[]}));app.get('/api/ocean/land-mask',(req,res)=>res.json({rings:[]}));
 // index2.html 의 출처·축척 위치 규칙(<style> 안, body.ls-mode.ls-safety … !important 포함)을 그대로 넣는다 — 실제 앱에서 risk_forecast.css 와 다투는 규칙이라 없으면 시험이 실제와 달라진다(2026-10-16 출처가 시간 줄에 가려진 원인).
 const indexCss=Array.from(fs.readFileSync(path.join(root,'client/index2.html'),'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)).map(m=>m[1].replace(/\/\*[\s\S]*?\*\//g,'')).join('\n').match(/[^{}]+\{[^{}]*\}/g).filter(r=>/\.ol-(?:attribution|scale-line)|--ls-bottom-chrome\s*:|\.navwarn-/.test(r)),indexRules=indexCss.filter(r=>/\.ol-(?:attribution|scale-line)/.test(r)).length;
 app.get('/',(req,res)=>res.send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>'+indexCss.join('\n')+'</style><link rel="stylesheet" href="/assets/vendor/ol/ol.css"><link rel="stylesheet" href="/js/marine-life/risk-forecast/risk_forecast.css"><style>body{margin:0;background:#10223d;color:white}#map{height:915px}#risk-forecast-legend{position:absolute;top:10px;left:10px}#risk-forecast-sheet{position:absolute;bottom:0;max-height:65vh;overflow:auto;width:100%;background:#172d49}</style></head><body class="ls-mode ls-safety"><nav id="tabs" style="position:fixed;bottom:0;height:68px;width:100%;background:#263f65;z-index:160">메인 탭</nav><div class="ol-attribution" style="position:fixed;left:8px">국토부 V월드</div><div class="ol-scale-line" style="position:fixed;right:8px">100KM</div><div id="map"></div><div id="risk-forecast-legend" class="rf-legend"></div><div id="risk-forecast-banner"></div><div id="risk-forecast-sheet"></div>'+['assets/vendor/ol/ol.js',...['risk_format','risk_api','risk_map_layer','risk_slider','risk_marine','risk_sheet','risk_basis_content','risk_basis','risk_forecast'].map(s=>'js/marine-life/risk-forecast/'+s+'.js')].map(s=>'<script src="/'+s+'"></script>').join('')+'<script>window.map=new ol.Map({target:"map",view:new ol.View({center:ol.proj.fromLonLat([126.5,33.5]),zoom:9})});window.getOceanMap=function(){return map;};window.app=RiskForecast.mount({map:map,legendEl:document.getElementById("risk-forecast-legend"),sheetEl:document.getElementById("risk-forecast-sheet"),bannerEl:document.getElementById("risk-forecast-banner")});window.coastScores=function(){return map.getLayers().getArray().find(function(l){return l.getClassName()==="rf-coast-canvas";}).getSource().getFeatures().map(function(f){return f.get("score");}).sort();};window.marineCount=function(){return map.getLayers().getArray().find(function(l){return l.getClassName()==="rf-marine-canvas";}).getSource().getFeatures().length;};</script></body></html>'));
 app.use(express.static(path.join(root,'client')));server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 browser=await chromium.launch({...((process.env.PW_CHROME||process.env.SIM_CHROMIUM||process.env.CHROMIUM_EXECUTABLE)?{executablePath:process.env.PW_CHROME||process.env.SIM_CHROMIUM||process.env.CHROMIUM_EXECUTABLE}:{}),headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:412,height:915}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);if(!await page.evaluate(()=>!!window.app))throw Error('초기화 실패: '+errors.join(' / '));await page.evaluate(()=>app.ready);
 /** 화면 상태를 읽는다. 예: {t,out}. @returns {Promise<object>} 메인 t와 고정 표시문구 [연계] ← 모든 사례 */
 const state=async()=>({...(await page.evaluate(()=>app.getState())),out:await page.locator('[data-map-time]').textContent()});
 /** 하단 5버튼을 읽는다. 예: [{step:'-3',label:'-3H',at:'12.(월) 11:00',disabled:false,aria:'false'},…]. @returns {Promise<object[]>} 버튼 순서대로 [연계] ← 작은 글씨·비활성 사례 */
 const bar=()=>page.evaluate(()=>Array.from(document.querySelectorAll('.rf-marine-timebar [data-time-step]')).map(b=>({step:b.dataset.timeStep,label:b.querySelector('b').textContent,at:Array.from(b.querySelectorAll('small span')).map(x=>x.textContent).join(' '),disabled:b.disabled,aria:b.getAttribute('aria-disabled')})));
 /** 버튼별 작은 글씨만 step→글자로. 예: {'-3':'',now:'12.(월) 11:00',…} @returns {Promise<object>} [연계] ← 이동 사례 */
 const ats=async()=>Object.fromEntries((await bar()).map(b=>[b.step,b.at]));
 /** 조건이 참이 될 때까지 기다린다(node 쪽 요청 기록용). @param {function} fn @param {string} msg @returns {Promise<void>} [연계] ← 해상 프레임 요청 확인 */
 const until=async(fn,msg)=>{for(let i=0;i<80;i++){if(fn())return;await new Promise(r=>setTimeout(r,100));}assert.fail(msg);};
 /** 연안 지도가 해당 시각이 든 날짜의 하루 값(T24)이 될 때까지 기다린다. 예: waitCoast('2026-10-12T12:00:00+09:00') → [4,5]. @param {string} t @returns {Promise<void>} [연계] ← 시각 이동 사례 */
 const waitCoast=t=>page.waitForFunction(s=>JSON.stringify(coastScores())===JSON.stringify([s,s+1]),dayScore(t),{timeout:8000});
 /** 연안 요청은 날짜의 첫 칸(오늘=지금·내일=00시)으로만 나간다(T24 — 같은 날짜면 같은 주소). @returns {void} */
 const coastCanonical=()=>assert.ok(log.coast.every(t=>t===at||t==='2026-10-13T00:00:00+09:00'),'연안 요청은 날짜의 첫 칸으로만: '+JSON.stringify(Array.from(new Set(log.coast))));
 const step=async h=>{await page.locator('[data-time-step="'+h+'"]').evaluate(el=>el.click());};
 const disabled=async()=>page.evaluate(()=>['3','6'].map(h=>document.querySelector('[data-time-step="'+h+'"]').disabled));
 const back=async()=>page.evaluate(()=>['-3','-6'].map(h=>document.querySelector('[data-time-step="'+h+'"]').disabled));
 /** 화면 폭별 바 배치를 잰다: 5버튼 한 줄·버튼 높이 34px 이하(종전 4버튼 때와 같음)·작은 시각 글씨 한 줄·서로 안 겹침·화면과 바 안·글자 안 잘림·가로 넘침 없음. @param {number} width - 화면 폭 @returns {Promise<void>} [연계] ← 배치 사례 */
 const layout=async width=>{await page.setViewportSize({width,height:915});const r=await page.evaluate(()=>{const bar=document.querySelector('.rf-marine-timebar'),b=Array.from(bar.querySelectorAll('button'));return{bar:bar.getBoundingClientRect().toJSON(),tabsTop:document.getElementById('tabs').getBoundingClientRect().top,width:innerWidth,docW:document.documentElement.scrollWidth,boxes:b.map(x=>x.getBoundingClientRect().toJSON()),oneLine:b.map(x=>{const t=Array.from(x.querySelectorAll('small span')).map(e=>e.getBoundingClientRect().top);return t.every(v=>Math.abs(v-t[0])<1);}),smallH:b.map(x=>x.querySelector('small').getBoundingClientRect().height),clip:b.flatMap(x=>[x,x.querySelector('b'),x.querySelector('small'),...x.querySelectorAll('small span')]).filter(x=>x.scrollWidth>x.clientWidth||x.scrollHeight>x.clientHeight).map(x=>x.tagName+':'+x.textContent)};});
  assert.equal(r.boxes.length,5);assert.ok(r.bar.height<=46,width+'px 바 높이 '+r.bar.height+' ≤ 종전 46');assert.ok(r.boxes.every(b=>b.height<=34),width+'px 버튼 높이 ≤ 종전 34: '+r.boxes.map(b=>b.height));assert.ok(r.oneLine.every(Boolean),width+'px 작은 시각 글씨 한 줄');assert.ok(r.smallH.every(h=>h<=12.5),width+'px 작은 글씨 높이 한 줄: '+r.smallH);assert.ok(r.bar.bottom<=r.tabsTop);assert.ok(r.docW<=r.width,width+'px 가로 넘침 없음');
  for(let i=0;i<5;i++){const b=r.boxes[i];assert.ok(b.left>=0&&b.right<=r.width,width+'px 버튼'+i+' 화면 안');assert.ok(Math.abs(b.top-r.boxes[0].top)<1,width+'px 한 줄');if(i)assert.ok(r.boxes[i-1].right<=b.left,width+'px 버튼'+(i-1)+'·'+i+' 안 겹침');assert.ok(b.top>=r.bar.top&&b.bottom<=r.bar.bottom,width+'px 버튼이 바 안');}
  assert.deepEqual(r.clip,[],width+'px 잘린 글자 없음');};
 const shot=async name=>{if(process.env.RISK_SHOT_DIR){const w=page.viewportSize().width;await page.screenshot({path:path.join(process.env.RISK_SHOT_DIR,name+'.png'),clip:{x:0,y:915-68-46-40,width:w,height:40+46+68}});}};
 const at3=hhmm=>coastTimes.find(t=>t.includes('T'+hhmm+':'));
 const banner=()=>page.locator('#risk-forecast-banner').innerText(),caption=()=>page.locator('[data-marine-caption]').innerText();

 // T24(2026-10-16): 연안만 켠 기본 화면에는 하단 시간 바가 없다(종전 「연안만 켠 기본 화면에도 공통 메인 시각 바」). 해상을 켜면 종전 5버튼 바가 그대로 나온다.
 await check('T24 연안만 켠 기본 화면: 하단 시간 바 없음(body.rf-sea-time-on 없음)·상단 가운데 날짜 넘기기 — 해상을 켜면 하단 5버튼 -6H~+6H·날짜 줄 숨김',async()=>{
  await waitCoast(at);
  const c=await page.evaluate(()=>{const bar=document.querySelector('.rf-marine-timebar'),nav=document.querySelector('.rf-date-nav');return{bar:bar.hidden,barSeen:bar.getClientRects().length>0,body:document.body.classList.contains('rf-sea-time-on'),nav:!nav.hidden&&nav.getClientRects().length>0,label:nav.querySelector('[data-day-label]').textContent,tag:nav.querySelector('[data-day-tag]').textContent,prev:nav.querySelector('[data-day-step="-1"]').disabled,next:nav.querySelector('[data-day-step="1"]').disabled,sea:app.getState().sea,tools:document.querySelector('[data-marine-tools]').hidden};});
  assert.deepEqual(c,{bar:true,barSeen:false,body:false,nav:true,label:'10월 12일 (월)',tag:'오늘',prev:true,next:false,sea:false,tools:true},'연안만: 바 숨김·상단 날짜 「10월 12일 (월) 오늘」·오늘 앞 비활성');
  assert.equal(log.unified.length,0,'해상이 꺼져 있으면 해상 프레임을 요청하지 않는다');assert.equal(await banner(),'');coastCanonical();
  await page.locator('[data-layer="sea"]').click();await page.waitForFunction(()=>marineCount()>0);
  const r=await page.evaluate(()=>{const bar=document.querySelector('.rf-marine-timebar'),tabs=document.getElementById('tabs').getBoundingClientRect();return{count:document.querySelectorAll('.rf-marine-timebar').length,outputs:document.querySelectorAll('[data-map-time]').length,tag:document.querySelector('[data-map-time]').tagName,live:document.querySelector('[data-map-time]').getAttribute('aria-live'),hiddenW:document.querySelector('[data-map-time]').getBoundingClientRect().width,oldOutput:bar.querySelectorAll('output').length,labels:Array.from(bar.querySelectorAll('button b')).map(b=>b.textContent),hidden:bar.hidden,bottom:bar.getBoundingClientRect().bottom,tabsTop:tabs.top,body:document.body.classList.contains('rf-sea-time-on'),tools:document.querySelector('[data-marine-tools]').hidden,sea:app.getState().sea,sliders:document.querySelectorAll('[data-marine-slider]').length,nav:document.querySelector('.rf-date-nav').hidden};});
  assert.deepEqual([r.count,r.outputs,r.tag,r.live,r.oldOutput,r.hidden,r.sea,r.tools,r.sliders,r.nav],[1,1,'SPAN',null,0,false,true,false,0,true],'해상 켬: 바 보임·날짜 줄 숨김. 왼쪽 날짜 output 은 없고 선택 시각은 숨김 글자로만(읽어 주기는 토스트가 — 두 번 읽히지 않게 aria-live 없음)');assert.ok(r.hiddenW<=1,'숨김 글자는 화면에 보이지 않음');assert.deepEqual(r.labels,['-6H','-3H','현재','+3H','+6H']);assert.ok(r.bottom<=r.tabsTop);assert.equal(r.body,true);
  assert.equal((await state()).out,'조회 시각 10.12.(월) 11:00');
  assert.deepEqual(await back(),[true,true],'처음(현재)엔 「-」 둘 다 회색');assert.deepEqual((await bar()).slice(0,2).map(b=>b.aria),['true','true']);assert.deepEqual(await disabled(),[false,false]);
  assert.deepEqual(await ats(),{'-6':'','-3':'',now:'12.(월) 11:00','3':'12.(월) 12:00','6':'12.(월) 15:00'},'버튼 작은 글씨 = 누르면 갈 시각, 현재는 지금 시각');
  const before=log.coast.length;await step(-3);await step(-6);assert.equal((await state()).t,at,'비활성 「-」는 시각을 바꾸지 못한다');assert.equal(log.coast.length,before,'비활성 「-」는 요청도 만들지 않는다');
  await layout(380);await shot('v2-380-처음');await layout(320);await shot('v2-320-처음');await page.setViewportSize({width:412,height:915});
 });
 await check('해상 켬: 하단 버튼으로 메인 시각 이동(+3H·+3H·현재) — 연안 지도는 그 시각이 든 날짜의 하루 값(T24 「2. 가」)',async()=>{
  await step(3);await waitCoast(at3('12:00'));let s=await state();assert.equal(s.t,at3('12:00'));assert.equal(s.out,'조회 시각 10.12.(월) 12:00');coastCanonical();
  assert.deepEqual(await back(),[false,true],'+3H 뒤 -3H 활성(지금으로 돌아감), -6H 는 지금보다 앞이라 회색');
  assert.deepEqual(await ats(),{'-6':'','-3':'12.(월) 11:00',now:'12.(월) 11:00','3':'12.(월) 15:00','6':'12.(월) 18:00'},'작은 글씨가 선택 시각 기준으로 바뀌고 [현재]는 그대로');
  for(const w of [380,320]){await layout(w);await shot('v2-'+w+'-3H뒤');}await page.setViewportSize({width:412,height:915});
  await step(3);await waitCoast(at3('15:00'));s=await state();assert.equal(s.t,at3('15:00'));assert.equal(s.out,'조회 시각 10.12.(월) 15:00');
  assert.deepEqual(await back(),[false,false]);assert.deepEqual(await ats(),{'-6':'12.(월) 11:00','-3':'12.(월) 12:00',now:'12.(월) 11:00','3':'12.(월) 18:00','6':'12.(월) 21:00'});
  await step(-3);await waitCoast(at3('12:00'));assert.equal((await state()).t,at3('12:00'),'15시 -3H → 12시');
  await step(-3);await waitCoast(at);s=await state();assert.equal(s.t,at,'12시 -3H → 지금(11시)');assert.equal(await page.locator('[data-time-step="now"]').getAttribute('aria-pressed'),'true','지금으로 돌아오면 [현재] 강조');assert.deepEqual(await back(),[true,true]);
  await step(3);await step(3);await step(6);await waitCoast(at3('21:00'));assert.equal((await state()).t,at3('21:00'));assert.equal(await page.locator('[data-time-step="now"]').getAttribute('aria-pressed'),'false','지금이 아니면 [현재] 강조 없음');
  assert.deepEqual(await ats(),{'-6':'12.(월) 15:00','-3':'12.(월) 18:00',now:'12.(월) 11:00','3':'13.(화) 00:00','6':'13.(화) 03:00'});
  await step(3);await waitCoast('2026-10-13T00:00:00+09:00');assert.equal((await state()).t,'2026-10-13T00:00:00+09:00','21시 +3H → 내일 00시: 연안은 내일 하루 값(KST 00시 경계)');await step(-3);await waitCoast(at3('21:00'));assert.equal((await state()).t,at3('21:00'),'다시 -3H → 오늘 21시: 연안은 오늘 하루 값');coastCanonical();
  await step(-6);await waitCoast(at3('15:00'));await step(-6);await waitCoast(at);assert.equal((await state()).t,at,'15시 -6H → 09시 칸 = 지금(+6H 의 반대)');await step(6);await waitCoast(at3('15:00'));await step(6);await waitCoast(at3('21:00'));await step(-6);await waitCoast(at3('15:00'));assert.equal((await state()).t,at3('15:00'));
  await step('now');await waitCoast(at);s=await state();assert.equal(s.t,at);assert.equal(await page.locator('[data-time-step="now"]').getAttribute('aria-pressed'),'true');
 });
 await check('범위 끝: 서버가 주는 연안 마지막 칸(내일 21시 — 「가」 2일 제한)에서 멈추고 모레 시각은 만들지 않음',async()=>{
  assert.equal(coastTimes.at(-1),'2026-10-13T21:00:00+09:00');
  const seen=[];for(let i=0;i<4;i++){await step(6);seen.push((await state()).t);}
  assert.deepEqual(seen,[at3('15:00'),at3('21:00'),'2026-10-13T03:00:00+09:00','2026-10-13T09:00:00+09:00']);
  for(const t of seen)assert.ok(coastTimes.includes(t));
  await waitCoast('2026-10-13T09:00:00+09:00');assert.deepEqual(await disabled(),[false,false]);
  await step(6);await waitCoast('2026-10-13T15:00:00+09:00');await step(3);await waitCoast('2026-10-13T18:00:00+09:00');
  assert.deepEqual(await disabled(),[false,true],'마지막 칸 전: +3H만 가능');
  await step(3);await waitCoast('2026-10-13T21:00:00+09:00');const end=await state();assert.equal(end.t,'2026-10-13T21:00:00+09:00');assert.equal(end.out,'조회 시각 10.13.(화) 21:00');
  assert.deepEqual(await disabled(),[true,true],'마지막 칸(내일 21시): 앞으로 이동 불가');assert.deepEqual((await bar()).slice(3).map(b=>[b.aria,b.at]),[['true',''],['true','']],'「+」 둘 aria-disabled·작은 글씨 없음');
  assert.deepEqual(await back(),[false,false]);assert.deepEqual(await ats(),{'-6':'13.(화) 15:00','-3':'13.(화) 18:00',now:'12.(월) 11:00','3':'','6':''});
  await layout(380);await shot('v2-380-끝');await layout(320);await shot('v2-320-끝');await page.setViewportSize({width:412,height:915});
  await step(3);await step(6);assert.equal((await state()).t,'2026-10-13T21:00:00+09:00','비활성 버튼은 시각을 바꾸지 못한다');
  assert.deepEqual(log.bad,[],'서버 연안 범위 밖 시각을 요청하지 않았다');assert.ok(log.coast.every(t=>coastTimes.includes(t)));coastCanonical();assert.equal(log.coast.some(t=>t.startsWith('2026-10-14')),false,'모레 시각을 요청하지 않았다');
  assert.equal(await page.locator('[data-time-step="now"]').isEnabled(),true);
  await step(-6);await waitCoast('2026-10-13T15:00:00+09:00');assert.equal((await state()).t,'2026-10-13T15:00:00+09:00','끝에서 -6H 로 되돌아감');assert.deepEqual(log.bad,[]);
  await step('now');await waitCoast(at);
 });
 await check('해상 버튼과 공존: 같은 바 하나로 연안·해상이 함께 이동하고 해상 ON 시 예전 해상 버튼 구성 유지',async()=>{
  await page.waitForFunction(()=>app.getState().sea&&marineCount()>0);   // 해상은 첫 사례부터 켜 둔 채(T24 — 바는 해상이 켜져 있을 때만)
  const r=await page.evaluate(()=>({bars:document.querySelectorAll('.rf-marine-timebar').length,outputs:document.querySelectorAll('[data-map-time]').length,labels:Array.from(document.querySelectorAll('.rf-marine-timebar button b')).map(b=>b.textContent),tools:document.querySelector('[data-marine-tools]').hidden,caption:document.querySelector('[data-marine-caption]').textContent}));
  assert.deepEqual([r.bars,r.outputs,r.tools],[1,1,false]);assert.deepEqual(r.labels,['-6H','-3H','현재','+3H','+6H']);assert.deepEqual(await back(),[true,true],'연안·해상 둘 다: 처음 「-」 회색');assert.equal(r.caption,'위험 예측','2026-10-15 조작부 시안 — 해상 기본 [위험 예측](공식 사고예보) 범례 제목 「위험 예측」');
  await step(3);await page.waitForFunction(()=>document.querySelector('[data-marine-caption]').textContent==='위험 예측');await waitCoast(at3('12:00'));
  await until(()=>log.unified.includes(at3('12:00')),'해상 프레임도 같은 시각으로 요청');assert.equal((await state()).out,'조회 시각 10.12.(월) 12:00');assert.ok(await page.evaluate(()=>marineCount())>0);
  assert.deepEqual(await back(),[false,true],'연안·해상 둘 다: +3H 뒤 -3H 활성');assert.equal((await ats())['-3'],'12.(월) 11:00');
  // 지금 시각 해상 프레임은 앞에서 받아 risk_api 60초 캐시에 있다 — 요청 기록 대신 지도에 다시 그려졌는지 본다.
  await step(-3);await waitCoast(at);assert.equal((await state()).t,at);await page.waitForFunction(()=>marineCount()>0);
  await step('now');await waitCoast(at);
 });
 await check('연안·해상 둘 다 ON: 내일 21시에서 함께 멈추고 해상 지도는 그대로(「가」 — 연안만 남는 모레 구간·범위 밖 안내 없음)',async()=>{
  for(let i=0;i<6;i++)await step(6);const seaEnd=await state();assert.equal(seaEnd.t,'2026-10-13T21:00:00+09:00');await waitCoast(seaEnd.t);
  await page.waitForFunction(()=>marineCount()>0);assert.equal(await caption(),'위험 예측','내일 21시는 해상 범위 안');
  assert.deepEqual(await disabled(),[true,true],'두 층의 끝이 같아 더 갈 칸이 없다');assert.doesNotMatch(await caption(),/범위 밖/);
  const unifiedBefore=log.unified.length;await step(3);await step(6);assert.equal((await state()).t,seaEnd.t);assert.equal(log.unified.length,unifiedBefore,'비활성 버튼은 해상 요청도 만들지 않는다');
  await page.evaluate(()=>{app.setEnabled(false);app.setEnabled(true);});await waitCoast(seaEnd.t);assert.equal((await state()).t,seaEnd.t,'재동기화 뒤에도 내일 21시 유지');await page.waitForFunction(()=>marineCount()>0);
  await page.locator('[data-layer="coast"]').click();await page.waitForFunction(t=>app.getState().t===t,seaEnd.t);
  await page.waitForFunction(()=>marineCount()>0);assert.equal(await caption(),'위험 예측','해상만 보아도 같은 시각');assert.equal(await page.locator('.rf-color-legend [data-accident-legend]').isVisible(),true);assert.equal(await page.locator('.rf-marine-timebar').isVisible(),true);
  assert.deepEqual(await disabled(),[true,true]);assert.deepEqual(await back(),[false,false],'해상만: 끝에서 「-」 둘 활성');
  assert.deepEqual(await ats(),{'-6':'13.(화) 15:00','-3':'13.(화) 18:00',now:'12.(월) 11:00','3':'','6':''},'해상만: 끝의 작은 글씨');
  const u=log.unified.length;await step(-3);await page.waitForFunction(t=>app.getState().t===t,'2026-10-13T18:00:00+09:00');await until(()=>log.unified.slice(u).includes('2026-10-13T18:00:00+09:00'),'해상만: -3H 시각으로 해상 프레임 요청');
  assert.deepEqual(await disabled(),[false,true],'해상만: -3H 뒤 +3H 다시 활성');await step(3);await page.waitForFunction(t=>app.getState().t===t,seaEnd.t);
  await page.locator('[data-layer="sea"]').click();assert.equal(await page.locator('.rf-marine-timebar').isVisible(),false,'연안·해상 둘 다 끄면 바 숨김');assert.equal(await page.evaluate(()=>document.body.classList.contains('rf-sea-time-on')),false);
  await page.locator('[data-layer="coast"]').click();await page.waitForFunction(()=>!document.querySelector('.rf-date-nav').hidden);assert.equal(await page.locator('.rf-marine-timebar').isVisible(),false,'T24 연안만 다시 켜면 바 대신 상단 날짜 줄');
  await page.locator('[data-layer="sea"]').click();await page.waitForFunction(()=>marineCount()>0);await page.locator('[data-layer="sea"]').click();
  await step('now');await waitCoast(at);
 });
 await check('해상만 켠 경우(지금부터): 처음 「-」 회색·+3H 뒤 -3H 로 지금 복귀·작은 글씨',async()=>{
  await page.locator('[data-layer="sea"]').click();await page.waitForFunction(()=>marineCount()>0);await page.locator('[data-layer="coast"]').click();await page.waitForFunction(()=>!app.getState().coast);
  assert.equal((await state()).t,at);assert.deepEqual(await back(),[true,true]);assert.deepEqual(await disabled(),[false,false]);
  assert.deepEqual(await ats(),{'-6':'','-3':'',now:'12.(월) 11:00','3':'12.(월) 12:00','6':'12.(월) 15:00'});
  await step(3);await page.waitForFunction(t=>app.getState().t===t,at3('12:00'));assert.deepEqual(await back(),[false,true]);assert.equal((await ats())['-3'],'12.(월) 11:00');
  await step(-3);await page.waitForFunction(t=>app.getState().t===t,at);await page.waitForFunction(()=>marineCount()>0);
  assert.equal(await page.locator('[data-time-step="now"]').getAttribute('aria-pressed'),'true');assert.deepEqual(await back(),[true,true]);
  await page.locator('[data-layer="coast"]').click();await page.locator('[data-layer="sea"]').click();await waitCoast(at);
 });
 await check('시각 토스트: 버튼마다 바 위에 약 2초·연타는 마지막 것만·aria-live·누름 통과·스피너/실패 안내/해상 범례와 안 겹침',async()=>{
  const toast=()=>page.evaluate(()=>{const els=document.querySelectorAll('.rf-time-toast'),el=els[0];return{count:els.length,hidden:el.hidden,text:el.textContent,live:el.getAttribute('aria-live'),role:el.getAttribute('role'),pe:getComputedStyle(el).pointerEvents};});
  await page.locator('[data-layer="sea"]').click();await page.waitForFunction(()=>marineCount()>0);   // 시간 버튼은 해상이 켜져 있을 때만(T24)
  assert.equal((await state()).t,at);await page.waitForFunction(()=>document.querySelector('.rf-time-toast').hidden,null,{timeout:3000});let x=await toast();assert.deepEqual([x.count,x.hidden,x.live,x.role,x.pe],[1,true,'polite','status','none'],'처음엔 숨김');
  await step(3);x=await toast();assert.deepEqual([x.hidden,x.text],[false,'12.(월) 12:00 예보']);
  await step(3);await step(6);await step('now');x=await toast();assert.deepEqual([x.count,x.hidden,x.text],[1,false,'현재 12.(월) 11:00'],'연타하면 마지막 것만');
  await page.waitForTimeout(1500);assert.equal((await toast()).hidden,false,'2초 전에는 남아 있다(연타 뒤 타이머 새로)');await page.waitForFunction(()=>document.querySelector('.rf-time-toast').hidden,null,{timeout:2000});
  for(const w of [380,320]){await page.setViewportSize({width:w,height:915});await step(3);await page.waitForFunction(()=>!document.querySelector('.rf-time-toast').hidden);
   const g=await page.evaluate(()=>{const r=e=>e.getBoundingClientRect().toJSON(),wait=document.querySelector('.rf-map-wait');wait.hidden=false;wait.querySelector('[data-wait-msg]').hidden=false;wait.querySelector('[data-wait-spin]').hidden=false;const out={toast:r(document.querySelector('.rf-time-toast')),bar:r(document.querySelector('.rf-marine-timebar')),legend:r(document.querySelector('.rf-color-legend')),attr:r(document.querySelector('.ol-attribution')),scale:r(document.querySelector('.ol-scale-line')),msg:r(wait.querySelector('[data-wait-msg]')),spin:r(wait.querySelector('[data-wait-spin]')),width:innerWidth};wait.hidden=true;wait.querySelector('[data-wait-msg]').hidden=true;return out;});
   const apart=(a,b)=>a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top;
   assert.ok(g.toast.bottom<=g.bar.top,w+'px 토스트는 바 위');assert.ok(g.toast.top>g.spin.bottom,w+'px 토스트는 지도 가운데(스피너)보다 아래쪽');assert.ok(g.toast.left>=0&&g.toast.right<=g.width,w+'px 화면 안');
   for(const k of ['legend','attr','scale','msg','spin'])assert.ok(apart(g.toast,g[k]),w+'px 토스트와 '+k+' 안 겹침');
   if(process.env.RISK_SHOT_DIR)await page.screenshot({path:path.join(process.env.RISK_SHOT_DIR,'v2-'+w+'-토스트.png')});await step('now');}
  await page.setViewportSize({width:412,height:915});
  await step(3);await page.locator('[data-layer="sea"]').click();await page.locator('[data-layer="coast"]').click();assert.equal((await toast()).hidden,true,'바가 숨으면 토스트도 숨김');
  await page.locator('[data-layer="coast"]').click();await step('now');await waitCoast(at);
 });
 await check('연안 색 범례: 해상 색 범례와 같은 왼쪽 아래 상자 — 연안만/해상만/둘 다(위아래, 제목 구분)/둘 다 끔·BAND_COLORS·380/320px 겹침 없음',async()=>{
  const key=()=>page.evaluate(()=>{const k=document.querySelector('[data-coast-key]'),c=document.querySelector('.rf-color-legend'),cap=c.querySelector('[data-marine-caption]'),seen=e=>!!e&&e.getClientRects().length>0;return{count:document.querySelectorAll('[data-coast-key]').length,inBox:!!k&&k.parentElement===c,topLeft:document.querySelectorAll('#risk-forecast-legend [data-coast-key]').length,box:seen(c),coast:seen(k),sea:seen(cap)&&seen(c.querySelector('[data-accident-legend]')),title:k&&k.querySelector('.rf-coast-key-title').textContent,labels:k&&Array.from(k.querySelectorAll('.rf-gradient-labels span')).map(s=>s.textContent),bar:k&&k.querySelector('.rf-gradient-bar').style.background,colors:Object.values(RiskFormat.BAND_COLORS).map(h=>'rgb('+[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)).join(', ')+')')};});
  let k=await key();assert.deepEqual([k.count,k.inBox,k.topLeft],[1,true,0],'연안 범례는 해상과 같은 .rf-color-legend 상자 안, 왼쪽 위 토글 아래에는 없음');
  assert.deepEqual([k.box,k.coast,k.sea,k.title],[true,true,false,'위험지수(연안)'],'연안만: 상자에 연안 범례만');assert.deepEqual(k.labels,['평소 수준','다소 높음','높음','매우 높음']);for(const c of k.colors)assert.ok(k.bar.includes(c),'막대 색 '+c);
  if(process.env.RISK_SHOT_DIR)await page.screenshot({path:path.join(process.env.RISK_SHOT_DIR,'v2-412-범례-연안만.png')});
  await page.locator('[data-layer="sea"]').click();await page.waitForFunction(()=>marineCount()>0);k=await key();assert.deepEqual([k.box,k.coast,k.sea],[true,true,true],'둘 다: 같은 상자에 둘 다');
  for(const w of [380,320]){await page.setViewportSize({width:w,height:915});const g=await page.evaluate(()=>{const r=e=>e.getBoundingClientRect().toJSON(),c=document.querySelector('.rf-color-legend'),k=c.querySelector('[data-coast-key]');return{box:r(c),key:r(k),cap:r(c.querySelector('[data-marine-caption]')),bar:r(document.querySelector('.rf-marine-timebar')),attr:r(document.querySelector('.ol-attribution')),scale:r(document.querySelector('.ol-scale-line')),width:innerWidth,clip:[c,k,...c.querySelectorAll('span,strong')].filter(e=>e.scrollWidth>e.clientWidth).map(e=>e.textContent)};});
   const apart=(a,b)=>a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top;
   assert.ok(g.box.left>=0&&g.box.right<=g.width,w+'px 화면 안');assert.ok(g.key.bottom<=g.cap.top,w+'px 연안 위·해상 아래');for(const x of ['bar','attr','scale'])assert.ok(apart(g.box,g[x]),w+'px 범례 상자와 '+x+' 안 겹침');assert.deepEqual(g.clip,[],w+'px 잘린 글자 없음');
   if(process.env.RISK_SHOT_DIR)await page.screenshot({path:path.join(process.env.RISK_SHOT_DIR,'v2-'+w+'-범례-둘다.png')});}
  await page.setViewportSize({width:412,height:915});
  await page.locator('[data-layer="coast"]').click();k=await key();assert.deepEqual([k.box,k.coast,k.sea],[true,false,true],'해상만: 해상 범례만');
  await page.locator('[data-layer="sea"]').click();k=await key();assert.deepEqual([k.box,k.coast,k.sea],[false,false,false],'둘 다 끔: 상자 숨김');
  await page.locator('[data-layer="coast"]').click();await waitCoast(at);k=await key();assert.deepEqual([k.box,k.coast,k.sea],[true,true,false]);
  await page.evaluate(()=>app.setEnabled(false));k=await key();assert.equal(k.box,false,'위험예측 끄면 상자 숨김');await page.evaluate(()=>app.setEnabled(true));await waitCoast(at);
 });
 await check('출처(브이월드)·축척: 시간 줄이 보이는 동안 그 높이만큼 위(index2.html 의 실제 출처·축척 규칙을 함께 적용), 끄면 원래 자리·380/320px',async()=>{
  const g=()=>page.evaluate(()=>{const r=e=>e.getBoundingClientRect().toJSON(),bar=document.querySelector('.rf-marine-timebar');return{attr:r(document.querySelector('.ol-attribution')),scale:r(document.querySelector('.ol-scale-line')),bar:bar.hidden?null:r(bar),barH:bar.hidden?null:bar.getBoundingClientRect().height,tabsTop:document.getElementById('tabs').getBoundingClientRect().top,rule:getComputedStyle(document.body).getPropertyValue('--rf-time-height').trim()};});
  assert.ok(indexRules>=4,'index2.html 의 출처·축척 규칙을 시험 화면에 넣었다('+indexRules+'개)');
  for(const w of [380,320]){await page.setViewportSize({width:w,height:915});await page.locator('[data-layer="sea"]').click();await page.waitForFunction(()=>marineCount()>0);let x=await g();
   assert.ok(x.bar,'해상 켬: 시간 줄 보임');for(const k of ['attr','scale']){assert.ok(x[k].bottom<=x.bar.top,w+'px '+k+' 가 시간 줄 위('+x[k].bottom+' ≤ '+x.bar.top+')');assert.ok(x.bar.top-x[k].bottom<=8,w+'px '+k+' 는 시간 줄 바로 위');}
   assert.equal(x.barH,46);assert.equal(x.rule,'46px','시간 줄 높이와 출처 올림이 같은 변수(--rf-time-height)');
   await page.evaluate(()=>document.body.style.setProperty('--rf-time-height','60px'));x=await g();assert.equal(x.barH,60,'변수를 바꾸면 바 높이가 따라감');for(const k of ['attr','scale'])assert.ok(x[k].bottom<=x.bar.top&&x.bar.top-x[k].bottom<=8,w+'px 바 높이를 바꿔도 '+k+' 가 따라감');await page.evaluate(()=>document.body.style.removeProperty('--rf-time-height'));
   if(process.env.RISK_SHOT_DIR)await page.screenshot({path:path.join(process.env.RISK_SHOT_DIR,'v2-'+w+'-출처축척-켬.png'),clip:{x:0,y:915-68-46-40,width:w,height:40+46+68}});
   // T24: 연안만이면 시간 줄이 없으므로 출처·축척도 원래 자리(사용자 「하단의 시간대는 … 빼야겠지 ?」 — 시간 줄 때문에 올리던 처리를 되돌림).
   await page.locator('[data-layer="sea"]').click();x=await g();assert.equal(x.bar,null,'연안만: 시간 줄 숨김');assert.equal(await page.evaluate(()=>document.body.classList.contains('rf-sea-time-on')),false);for(const k of ['attr','scale'])assert.ok(Math.abs(x.tabsTop-6-x[k].bottom)<1,w+'px 연안만이면 '+k+' 원래 자리(탭 위 6px): '+x[k].bottom);
   if(process.env.RISK_SHOT_DIR)await page.screenshot({path:path.join(process.env.RISK_SHOT_DIR,'v2-'+w+'-출처축척-연안만.png'),clip:{x:0,y:915-68-46-40,width:w,height:40+46+68}});
   await waitCoast(at);}
  await page.setViewportSize({width:412,height:915});
 });
 // T24(2026-10-16): 연안 시트는 시각 막대가 없고 메인 날짜를 따른다(test_risk_coast_day). 시트 시각 격리(과제8)는 해상 시트에 그대로 — 그쪽으로 옮겨 검사한다.
 await check('해상 시트 시각 격리: 메인15시→시트18·21시→메인 이동에도 시트 유지→닫으면 메인 유지·새 시트도 메인 시각',async()=>{
  await page.locator('[data-layer="sea"]').click();await page.waitForFunction(()=>marineCount()>0);
  await step(3);await step(3);await page.waitForFunction(t=>app.getState().t===t,at3('15:00'));
  const slide=async idx=>page.locator('#risk-forecast-sheet input[type="range"]').evaluate((el,i)=>{el.value=String(i);el.dispatchEvent(new Event('input',{bubbles:true}));},idx);
  const ready=()=>page.waitForFunction(()=>{const s=document.getElementById('risk-forecast-sheet');return s.classList.contains('open')&&!s.hasAttribute('aria-busy');});
  const point={lon:126.5375,lat:33.5625};
  await page.evaluate(p=>app.select('marine','GR4_F4K23_P4',p),point);await ready();
  assert.equal(log.analysis.at(-1),at3('15:00'),'시트는 메인 시각으로 시작');
  await slide(coastTimes.indexOf(at3('18:00')));await until(()=>log.analysis.at(-1)===at3('18:00'),'시트 18시 요청');await ready();
  let s=await state();assert.equal(s.t,at3('15:00'),'시트를 옮겨도 메인 시각은 15시');assert.equal(s.out,'조회 시각 10.12.(월) 15:00');
  await slide(coastTimes.indexOf(at3('21:00')));await until(()=>log.analysis.at(-1)===at3('21:00'),'시트 21시 요청');await ready();
  await step(3);await page.waitForFunction(t=>app.getState().t===t,at3('18:00'));await new Promise(r=>setTimeout(r,500));
  assert.equal(log.analysis.at(-1),at3('21:00'),'열린 시트의 시각은 메인 이동에 따라가지 않는다');assert.equal(await page.locator('#risk-forecast-sheet input[type="range"]').inputValue(),String(coastTimes.indexOf(at3('21:00'))));
  await page.locator('.rf-close').click();s=await state();assert.equal(s.t,at3('18:00'),'시트를 닫아도 메인은 18시(시트의 21시가 새지 않음)');
  await page.waitForFunction(()=>!document.getElementById('risk-forecast-sheet').classList.contains('rf-shown'));
  await page.evaluate(p=>app.select('marine','GR4_F4K23_P4',p),point);await ready();
  assert.match(await page.locator('#risk-forecast-sheet .rf-time-label').textContent(),/ 18:00/,'새 시트는 메인 시각(18시)으로 시작 — 같은 시각 응답은 앞에서 받아 risk_api 60초 캐시에 있어 요청 기록 대신 시트 시각 글자로 본다');assert.equal(await page.locator('#risk-forecast-sheet input[type="range"]').inputValue(),String(coastTimes.indexOf(at3('18:00'))));
  await page.locator('.rf-close').click();assert.equal((await state()).t,at3('18:00'));assert.deepEqual(log.bad,[]);
 });
 await check('실행 오류 없음',()=>assert.deepEqual(errors,[]));
}finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});console.log(`${pass} PASS / ${fail} FAIL`);if(fail)process.exitCode=1;}})().catch(e=>{console.error('❌ 브라우저 검사 실행 실패:',e.message);console.log(`${pass} PASS / ${fail+1} FAIL`);process.exitCode=1;});
