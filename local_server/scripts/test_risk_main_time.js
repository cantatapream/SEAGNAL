/**
 * 파일명: local_server/scripts/test_risk_main_time.js
 * 역할  : 연안·해상 공통 메인 시각(하단 7버튼·시각 토스트)과 연안 색 범례(2026-10-16)를 실제 Chromium에서 검사한다. 하단 7버튼 -12H·-6H·-3H·현재·+3H·+6H·+12H — 2026-10-16)을 실제 Chromium에서 검사한다.
 *         메인 시각을 옮기면 연안 지도가 그 시각으로 바뀌는지, 처음엔 「-」 셋이 회색이고 +3H 뒤 -3H 가 켜지는지,
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
(async()=>{let browser,server;try{
 const geometry={type:'Polygon',coordinates:[[[126.525,33.55],[126.55,33.55],[126.55,33.575],[126.525,33.575],[126.525,33.55]]]},cell={id:'GR4_F4K23_P4',i:0,lat:33.5625,lon:126.5375,geometry,haegu:{label:'163-6',major:163,sub:6},ref:{name:'제주항',bearingWord:'북서',distNm:8.2}},acc={...cell,id:'100'};
 io.write(path.join(dir,'sea_realtime.json.gz'),{v:'v1',cells:[cell],rows:[[0,21,.2]],collectedAt:at,sourceAt:null,source:'MTIS realtime API'});
 // 공식 사고예보는 연안 2일 전체 3시간 칸에 값을 둔다 → 해상 지도가 비면 자료 부재가 아니라 화면 문제임이 구분된다.
 const frames={'202610120900':[[0,.001,'경계']]};for(const t of coastTimes)frames[t.slice(0,13).replace(/[-T]/g,'')+'00']=[[0,.002,'주의']];
 const inputs={version:1,cells:{cells:[cell]},congestion:{frames:{}},accident:{cells:[acc],frames},sources:{accident:{status:'ok'},congestion:{status:'ok'},zoneForecasts:{status:'ok'}},weather:()=>({wh:2,ws:12,wp:4,wd:241,forecastAt:at})};
 const sources=inputs.sources,log={coast:[],bad:[],detail:[],unified:[]};
 const ring=(x,y)=>[[x,y],[x+.01,y],[x+.01,y+.01],[x,y+.01],[x,y]],spots=[{id:'S1',i:0,lat:33.5,lon:126.5,cell:ring(126.5,33.5)},{id:'S2',i:1,lat:34.5,lon:127.5,cell:ring(127.5,34.5)}];
 /** 서버 validateTime과 같은 범위(지금-5분 ~ 연안 마지막 칸)만 받는다. 범위 밖 요청은 기록하고 400. @param {string} t @returns {string} KST ISO [연계] ← 가짜 frame/detail */
 function valid(t){const n=Date.parse(t);if(!Number.isFinite(n)||n<now-5*60000||n>Date.parse(coastTimes.at(-1))){log.bad.push(t);throw Object.assign(new Error('잘못된 예보 시각'),{status:400});}return T.isoKst(n);}
 const store={sources:()=>sources,marineInputs:()=>inputs,
  meta:()=>({now:at,versions:{spots:'v1',cells:1,accident:'v1'},timeline:{sea:{times:seaTimes},accident:{times:coastTimes},coast:{times:coastTimes}},sources}),
  spots:()=>({spots}),cells:()=>({cells:[cell]}),accidentCells:()=>({v:'v1',cells:[acc]}),accidentFrame:()=>({v:'v1',cells:[[0,.001,'경계']]}),
  frame:(sea,t)=>{t=valid(t);if(sea)return{cells:[[0,0,1,'낮음']],spots:[],borders:[]};log.coast.push(t);return{spots:spots.map(s=>[s.i,scoreAt(t)+s.i]),borders:[]};},
  coastDetail:(id,t)=>{t=valid(t);log.detail.push({id,t});return{title:'연안 '+id+' '+t,subtitle:{lat:33.5,lon:126.5},clickable:false,t};},islands:()=>({features:[]})};
 const marine=M.createStore({risk:store,dir,clock:()=>now,stations:[{properties:{name:'제주파출소'},geometry}],accidents:[],describe:()=>cell});
 const app=express();app.use((req,res,next)=>{if(req.path.endsWith('/sea/unified-frame'))log.unified.push(iso(req.query.t));next();});
 app.use(createRouter({store,marine}));app.get('/api/warn-zones',(req,res)=>res.json({features:[]}));app.get('/api/warn-zones-sub',(req,res)=>res.json({features:[]}));app.get('/api/ocean/land-mask',(req,res)=>res.json({rings:[]}));
 app.get('/',(req,res)=>res.send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/assets/vendor/ol/ol.css"><link rel="stylesheet" href="/js/marine-life/risk-forecast/risk_forecast.css"><style>body{margin:0;background:#10223d;color:white}#map{height:915px}#risk-forecast-legend{position:absolute;top:10px;left:10px}#risk-forecast-sheet{position:absolute;bottom:0;max-height:65vh;overflow:auto;width:100%;background:#172d49}</style></head><body class="ls-mode ls-safety"><nav id="tabs" style="position:fixed;bottom:0;height:68px;width:100%;background:#263f65;z-index:160">메인 탭</nav><div class="ol-attribution" style="position:fixed;left:8px">국토부 V월드</div><div class="ol-scale-line" style="position:fixed;right:8px">100KM</div><div id="map"></div><div id="risk-forecast-legend" class="rf-legend"></div><div id="risk-forecast-banner"></div><div id="risk-forecast-sheet"></div>'+['assets/vendor/ol/ol.js',...['risk_format','risk_api','risk_map_layer','risk_slider','risk_marine','risk_sheet','risk_basis_content','risk_basis','risk_forecast'].map(s=>'js/marine-life/risk-forecast/'+s+'.js')].map(s=>'<script src="/'+s+'"></script>').join('')+'<script>window.map=new ol.Map({target:"map",view:new ol.View({center:ol.proj.fromLonLat([126.5,33.5]),zoom:9})});window.getOceanMap=function(){return map;};window.app=RiskForecast.mount({map:map,legendEl:document.getElementById("risk-forecast-legend"),sheetEl:document.getElementById("risk-forecast-sheet"),bannerEl:document.getElementById("risk-forecast-banner")});window.coastScores=function(){return map.getLayers().getArray().find(function(l){return l.getClassName()==="rf-coast-canvas";}).getSource().getFeatures().map(function(f){return f.get("score");}).sort();};window.marineCount=function(){return map.getLayers().getArray().find(function(l){return l.getClassName()==="rf-marine-canvas";}).getSource().getFeatures().length;};</script></body></html>'));
 app.use(express.static(path.join(root,'client')));server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 browser=await chromium.launch({...((process.env.PW_CHROME||process.env.SIM_CHROMIUM||process.env.CHROMIUM_EXECUTABLE)?{executablePath:process.env.PW_CHROME||process.env.SIM_CHROMIUM||process.env.CHROMIUM_EXECUTABLE}:{}),headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:412,height:915}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);if(!await page.evaluate(()=>!!window.app))throw Error('초기화 실패: '+errors.join(' / '));await page.evaluate(()=>app.ready);
 /** 화면 상태를 읽는다. 예: {t,out}. @returns {Promise<object>} 메인 t와 고정 표시문구 [연계] ← 모든 사례 */
 const state=async()=>({...(await page.evaluate(()=>app.getState())),out:await page.locator('[data-map-time]').textContent()});
 /** 하단 7버튼을 읽는다. 예: [{step:'-3',label:'-3H',at:'12.(월) 11:00',disabled:false,aria:'false'},…]. @returns {Promise<object[]>} 버튼 순서대로 [연계] ← 작은 글씨·비활성 사례 */
 const bar=()=>page.evaluate(()=>Array.from(document.querySelectorAll('.rf-marine-timebar [data-time-step]')).map(b=>({step:b.dataset.timeStep,label:b.querySelector('b').textContent,at:Array.from(b.querySelectorAll('small span')).map(x=>x.textContent).join(' '),disabled:b.disabled,aria:b.getAttribute('aria-disabled')})));
 /** 버튼별 작은 글씨만 step→글자로. 예: {'-3':'',now:'12.(월) 11:00',…} @returns {Promise<object>} [연계] ← 이동 사례 */
 const ats=async()=>Object.fromEntries((await bar()).map(b=>[b.step,b.at]));
 /** 조건이 참이 될 때까지 기다린다(node 쪽 요청 기록용). @param {function} fn @param {string} msg @returns {Promise<void>} [연계] ← 해상 프레임 요청 확인 */
 const until=async(fn,msg)=>{for(let i=0;i<80;i++){if(fn())return;await new Promise(r=>setTimeout(r,100));}assert.fail(msg);};
 /** 연안 지도가 해당 시각의 점수가 될 때까지 기다린다. 예: waitCoast('2026-10-12T12:00:00+09:00'). @param {string} t @returns {Promise<void>} [연계] ← 시각 이동 사례 */
 const waitCoast=t=>page.waitForFunction(s=>JSON.stringify(coastScores())===JSON.stringify([s,s+1]),scoreAt(t),{timeout:8000});
 const step=async h=>{await page.locator('[data-time-step="'+h+'"]').evaluate(el=>el.click());};
 const disabled=async()=>page.evaluate(()=>['3','6','12'].map(h=>document.querySelector('[data-time-step="'+h+'"]').disabled));
 const back=async()=>page.evaluate(()=>['-3','-6','-12'].map(h=>document.querySelector('[data-time-step="'+h+'"]').disabled));
 /** 화면 폭별 바 배치를 잰다: 7버튼 한 줄·서로 안 겹침·화면과 바 안·글자 안 잘림·가로 넘침 없음. @param {number} width - 화면 폭 @returns {Promise<void>} [연계] ← 배치 사례 */
 const layout=async width=>{await page.setViewportSize({width,height:915});const r=await page.evaluate(()=>{const bar=document.querySelector('.rf-marine-timebar'),b=Array.from(bar.querySelectorAll('button'));return{bar:bar.getBoundingClientRect().toJSON(),tabsTop:document.getElementById('tabs').getBoundingClientRect().top,width:innerWidth,docW:document.documentElement.scrollWidth,boxes:b.map(x=>x.getBoundingClientRect().toJSON()),clip:b.flatMap(x=>[x,x.querySelector('b'),x.querySelector('small'),...x.querySelectorAll('small span')]).filter(x=>x.scrollWidth>x.clientWidth||x.scrollHeight>x.clientHeight).map(x=>x.tagName+':'+x.textContent)};});
  assert.equal(r.boxes.length,7);assert.equal(r.bar.height,46,width+'px 바 높이 46 그대로');assert.ok(r.bar.bottom<=r.tabsTop);assert.ok(r.docW<=r.width,width+'px 가로 넘침 없음');
  for(let i=0;i<7;i++){const b=r.boxes[i];assert.ok(b.left>=0&&b.right<=r.width,width+'px 버튼'+i+' 화면 안');assert.ok(Math.abs(b.top-r.boxes[0].top)<1,width+'px 한 줄');if(i)assert.ok(r.boxes[i-1].right<=b.left,width+'px 버튼'+(i-1)+'·'+i+' 안 겹침');assert.ok(b.top>=r.bar.top&&b.bottom<=r.bar.bottom,width+'px 버튼이 바 안');}
  assert.deepEqual(r.clip,[],width+'px 잘린 글자 없음');};
 const shot=async name=>{if(process.env.RISK_SHOT_DIR){const w=page.viewportSize().width;await page.screenshot({path:path.join(process.env.RISK_SHOT_DIR,name+'.png'),clip:{x:0,y:915-68-46-40,width:w,height:40+46+68}});}};
 const at3=hhmm=>coastTimes.find(t=>t.includes('T'+hhmm+':'));
 const banner=()=>page.locator('#risk-forecast-banner').innerText(),caption=()=>page.locator('[data-marine-caption]').innerText();

 await check('연안만 켠 기본 화면에도 공통 메인 시각 바(고정 표시+현재·+3H·+6H·+12H)가 보임',async()=>{
  await waitCoast(at);
  const r=await page.evaluate(()=>{const bar=document.querySelector('.rf-marine-timebar'),tabs=document.getElementById('tabs').getBoundingClientRect();return{count:document.querySelectorAll('.rf-marine-timebar').length,outputs:document.querySelectorAll('[data-map-time]').length,tag:document.querySelector('[data-map-time]').tagName,live:document.querySelector('[data-map-time]').getAttribute('aria-live'),hiddenW:document.querySelector('[data-map-time]').getBoundingClientRect().width,oldOutput:bar.querySelectorAll('output').length,labels:Array.from(bar.querySelectorAll('button b')).map(b=>b.textContent),hidden:bar.hidden,bottom:bar.getBoundingClientRect().bottom,tabsTop:tabs.top,body:document.body.classList.contains('rf-sea-time-on'),tools:document.querySelector('[data-marine-tools]').hidden,sea:app.getState().sea,sliders:document.querySelectorAll('[data-marine-slider]').length};});
  assert.deepEqual([r.count,r.outputs,r.tag,r.live,r.oldOutput,r.hidden,r.sea,r.tools,r.sliders],[1,1,'SPAN',null,0,false,false,true,0],'왼쪽 날짜 output 은 없고 선택 시각은 숨김 글자로만(읽어 주기는 토스트가 — 두 번 읽히지 않게 aria-live 없음)');assert.ok(r.hiddenW<=1,'숨김 글자는 화면에 보이지 않음');assert.deepEqual(r.labels,['-12H','-6H','-3H','현재','+3H','+6H','+12H']);assert.ok(r.bottom<=r.tabsTop);assert.equal(r.body,true);
  assert.equal((await state()).out,'조회 시각 10.12.(월) 11:00');
  assert.deepEqual(await back(),[true,true,true],'처음(현재)엔 「-」 셋 다 회색');assert.deepEqual((await bar()).slice(0,3).map(b=>b.aria),['true','true','true']);assert.deepEqual(await disabled(),[false,false,false]);
  assert.deepEqual(await ats(),{'-12':'','-6':'','-3':'',now:'12.(월) 11:00','3':'12.(월) 12:00','6':'12.(월) 15:00','12':'12.(월) 21:00'},'버튼 작은 글씨 = 누르면 갈 시각, 현재는 지금 시각');
  const before=log.coast.length;await step(-3);await step(-12);assert.equal((await state()).t,at,'비활성 「-」는 시각을 바꾸지 못한다');assert.equal(log.coast.length,before,'비활성 「-」는 요청도 만들지 않는다');
  await layout(380);await shot('380-처음');await layout(320);await shot('320-처음');await page.setViewportSize({width:412,height:915});assert.equal(log.unified.length,0,'해상이 꺼져 있으면 해상 프레임을 요청하지 않는다');assert.equal(await banner(),'');
 });
 await check('메인 시각을 바꾸면 연안 지도가 그 시각의 프레임으로 바뀜(+3H·+3H·현재)',async()=>{
  await step(3);await waitCoast(at3('12:00'));let s=await state();assert.equal(s.t,at3('12:00'));assert.equal(s.out,'조회 시각 10.12.(월) 12:00');assert.ok(log.coast.includes(at3('12:00')));
  assert.deepEqual(await back(),[false,true,true],'+3H 뒤 -3H 활성(지금으로 돌아감), -6H·-12H 는 지금보다 앞이라 회색');
  assert.deepEqual(await ats(),{'-12':'','-6':'','-3':'12.(월) 11:00',now:'12.(월) 11:00','3':'12.(월) 15:00','6':'12.(월) 18:00','12':'13.(화) 00:00'},'작은 글씨가 선택 시각 기준으로 바뀌고 [현재]는 그대로');
  for(const w of [380,320]){await layout(w);await shot(w+'-3H뒤');}await page.setViewportSize({width:412,height:915});
  await step(3);await waitCoast(at3('15:00'));s=await state();assert.equal(s.t,at3('15:00'));assert.equal(s.out,'조회 시각 10.12.(월) 15:00');
  assert.deepEqual(await back(),[false,false,true]);assert.deepEqual(await ats(),{'-12':'','-6':'12.(월) 11:00','-3':'12.(월) 12:00',now:'12.(월) 11:00','3':'12.(월) 18:00','6':'12.(월) 21:00','12':'13.(화) 03:00'});
  await step(-3);await waitCoast(at3('12:00'));assert.equal((await state()).t,at3('12:00'),'15시 -3H → 12시');
  await step(-3);await waitCoast(at);s=await state();assert.equal(s.t,at,'12시 -3H → 지금(11시)');assert.equal(await page.locator('[data-time-step="now"]').getAttribute('aria-pressed'),'true','지금으로 돌아오면 [현재] 강조');assert.deepEqual(await back(),[true,true,true]);
  await step(3);await step(3);await step(6);await waitCoast(at3('21:00'));assert.equal((await state()).t,at3('21:00'));assert.equal(await page.locator('[data-time-step="now"]').getAttribute('aria-pressed'),'false','지금이 아니면 [현재] 강조 없음');
  assert.deepEqual(await ats(),{'-12':'12.(월) 11:00','-6':'12.(월) 15:00','-3':'12.(월) 18:00',now:'12.(월) 11:00','3':'13.(화) 00:00','6':'13.(화) 03:00','12':'13.(화) 09:00'});
  await step(-12);await waitCoast(at);assert.equal((await state()).t,at,'21시 -12H → 09시 칸 = 지금(+12H 의 반대)');await step(12);await waitCoast(at3('21:00'));await step(-6);await waitCoast(at3('15:00'));assert.equal((await state()).t,at3('15:00'));
  await step('now');await waitCoast(at);s=await state();assert.equal(s.t,at);assert.equal(await page.locator('[data-time-step="now"]').getAttribute('aria-pressed'),'true');
 });
 await check('범위 끝: 서버가 주는 연안 마지막 칸(내일 21시 — 「가」 2일 제한)에서 멈추고 모레 시각은 만들지 않음',async()=>{
  assert.equal(coastTimes.at(-1),'2026-10-13T21:00:00+09:00');
  const seen=[];for(let i=0;i<2;i++){await step(12);seen.push((await state()).t);}
  assert.deepEqual(seen,[at3('21:00'),'2026-10-13T09:00:00+09:00']);
  for(const t of seen)assert.ok(coastTimes.includes(t));
  await waitCoast('2026-10-13T09:00:00+09:00');assert.deepEqual(await disabled(),[false,false,false]);
  await step(6);await waitCoast('2026-10-13T15:00:00+09:00');await step(3);await waitCoast('2026-10-13T18:00:00+09:00');
  assert.deepEqual(await disabled(),[false,true,true],'마지막 두 칸 전: +3H만 가능');
  await step(3);await waitCoast('2026-10-13T21:00:00+09:00');const end=await state();assert.equal(end.t,'2026-10-13T21:00:00+09:00');assert.equal(end.out,'조회 시각 10.13.(화) 21:00');
  assert.deepEqual(await disabled(),[true,true,true],'마지막 칸(내일 21시): 앞으로 이동 불가');assert.deepEqual((await bar()).slice(4).map(b=>[b.aria,b.at]),[['true',''],['true',''],['true','']],'「+」 셋 aria-disabled·작은 글씨 없음');
  assert.deepEqual(await back(),[false,false,false]);assert.deepEqual(await ats(),{'-12':'13.(화) 09:00','-6':'13.(화) 15:00','-3':'13.(화) 18:00',now:'12.(월) 11:00','3':'','6':'','12':''});
  await layout(380);await shot('380-끝');await layout(320);await shot('320-끝');await page.setViewportSize({width:412,height:915});
  await step(3);await step(12);assert.equal((await state()).t,'2026-10-13T21:00:00+09:00','비활성 버튼은 시각을 바꾸지 못한다');
  assert.deepEqual(log.bad,[],'서버 연안 범위 밖 시각을 요청하지 않았다');assert.ok(log.coast.every(t=>coastTimes.includes(t)));assert.equal(log.coast.some(t=>t.startsWith('2026-10-14')),false,'모레 시각을 요청하지 않았다');
  assert.equal(await page.locator('[data-time-step="now"]').isEnabled(),true);
  await step(-12);await waitCoast('2026-10-13T09:00:00+09:00');assert.equal((await state()).t,'2026-10-13T09:00:00+09:00','끝에서 -12H 로 되돌아감');assert.deepEqual(log.bad,[]);
  await step('now');await waitCoast(at);
 });
 await check('해상 버튼과 공존: 같은 바 하나로 연안·해상이 함께 이동하고 해상 ON 시 예전 해상 버튼 구성 유지',async()=>{
  await page.locator('[data-layer="sea"]').click();await page.waitForFunction(()=>marineCount()>0);
  const r=await page.evaluate(()=>({bars:document.querySelectorAll('.rf-marine-timebar').length,outputs:document.querySelectorAll('[data-map-time]').length,labels:Array.from(document.querySelectorAll('.rf-marine-timebar button b')).map(b=>b.textContent),tools:document.querySelector('[data-marine-tools]').hidden,caption:document.querySelector('[data-marine-caption]').textContent}));
  assert.deepEqual([r.bars,r.outputs,r.tools],[1,1,false]);assert.deepEqual(r.labels,['-12H','-6H','-3H','현재','+3H','+6H','+12H']);assert.deepEqual(await back(),[true,true,true],'연안·해상 둘 다: 처음 「-」 회색');assert.equal(r.caption,'위험 예측','2026-10-15 조작부 시안 — 해상 기본 [위험 예측](공식 사고예보) 범례 제목 「위험 예측」');
  await step(3);await page.waitForFunction(()=>document.querySelector('[data-marine-caption]').textContent==='위험 예측');await waitCoast(at3('12:00'));
  assert.ok(log.unified.includes(at3('12:00')),'해상 프레임도 같은 시각으로 요청');assert.equal((await state()).out,'조회 시각 10.12.(월) 12:00');assert.ok(await page.evaluate(()=>marineCount())>0);
  assert.deepEqual(await back(),[false,true,true],'연안·해상 둘 다: +3H 뒤 -3H 활성');assert.equal((await ats())['-3'],'12.(월) 11:00');
  // 지금 시각 해상 프레임은 앞에서 받아 risk_api 60초 캐시에 있다 — 요청 기록 대신 지도에 다시 그려졌는지 본다.
  await step(-3);await waitCoast(at);assert.equal((await state()).t,at);await page.waitForFunction(()=>marineCount()>0);
  await step('now');await waitCoast(at);
 });
 await check('연안·해상 둘 다 ON: 내일 21시에서 함께 멈추고 해상 지도는 그대로(「가」 — 연안만 남는 모레 구간·범위 밖 안내 없음)',async()=>{
  for(let i=0;i<3;i++)await step(12);const seaEnd=await state();assert.equal(seaEnd.t,'2026-10-13T21:00:00+09:00');await waitCoast(seaEnd.t);
  await page.waitForFunction(()=>marineCount()>0);assert.equal(await caption(),'위험 예측','내일 21시는 해상 범위 안');
  assert.deepEqual(await disabled(),[true,true,true],'두 층의 끝이 같아 더 갈 칸이 없다');assert.doesNotMatch(await caption(),/범위 밖/);
  const unifiedBefore=log.unified.length;await step(3);await step(12);assert.equal((await state()).t,seaEnd.t);assert.equal(log.unified.length,unifiedBefore,'비활성 버튼은 해상 요청도 만들지 않는다');
  await page.evaluate(()=>{app.setEnabled(false);app.setEnabled(true);});await waitCoast(seaEnd.t);assert.equal((await state()).t,seaEnd.t,'재동기화 뒤에도 내일 21시 유지');await page.waitForFunction(()=>marineCount()>0);
  await page.locator('[data-layer="coast"]').click();await page.waitForFunction(t=>app.getState().t===t,seaEnd.t);
  await page.waitForFunction(()=>marineCount()>0);assert.equal(await caption(),'위험 예측','해상만 보아도 같은 시각');assert.equal(await page.locator('.rf-color-legend [data-accident-legend]').isVisible(),true);assert.equal(await page.locator('.rf-marine-timebar').isVisible(),true);
  assert.deepEqual(await disabled(),[true,true,true]);assert.deepEqual(await back(),[false,false,false],'해상만: 끝에서 「-」 셋 활성');
  assert.deepEqual(await ats(),{'-12':'13.(화) 09:00','-6':'13.(화) 15:00','-3':'13.(화) 18:00',now:'12.(월) 11:00','3':'','6':'','12':''},'해상만: 끝의 작은 글씨');
  const u=log.unified.length;await step(-3);await page.waitForFunction(t=>app.getState().t===t,'2026-10-13T18:00:00+09:00');await until(()=>log.unified.slice(u).includes('2026-10-13T18:00:00+09:00'),'해상만: -3H 시각으로 해상 프레임 요청');
  assert.deepEqual(await disabled(),[false,true,true],'해상만: -3H 뒤 +3H 다시 활성');await step(3);await page.waitForFunction(t=>app.getState().t===t,seaEnd.t);
  await page.locator('[data-layer="sea"]').click();assert.equal(await page.locator('.rf-marine-timebar').isVisible(),false,'연안·해상 둘 다 끄면 바 숨김');assert.equal(await page.evaluate(()=>document.body.classList.contains('rf-sea-time-on')),false);
  await page.locator('[data-layer="coast"]').click();await page.waitForFunction(()=>!document.querySelector('.rf-marine-timebar').hidden);
  await page.locator('[data-layer="sea"]').click();await page.waitForFunction(()=>marineCount()>0);await page.locator('[data-layer="sea"]').click();
  await step('now');await waitCoast(at);
 });
 await check('해상만 켠 경우(지금부터): 처음 「-」 회색·+3H 뒤 -3H 로 지금 복귀·작은 글씨',async()=>{
  await page.locator('[data-layer="sea"]').click();await page.waitForFunction(()=>marineCount()>0);await page.locator('[data-layer="coast"]').click();await page.waitForFunction(()=>!app.getState().coast);
  assert.equal((await state()).t,at);assert.deepEqual(await back(),[true,true,true]);assert.deepEqual(await disabled(),[false,false,false]);
  assert.deepEqual(await ats(),{'-12':'','-6':'','-3':'',now:'12.(월) 11:00','3':'12.(월) 12:00','6':'12.(월) 15:00','12':'12.(월) 21:00'});
  await step(3);await page.waitForFunction(t=>app.getState().t===t,at3('12:00'));assert.deepEqual(await back(),[false,true,true]);assert.equal((await ats())['-3'],'12.(월) 11:00');
  await step(-3);await page.waitForFunction(t=>app.getState().t===t,at);await page.waitForFunction(()=>marineCount()>0);
  assert.equal(await page.locator('[data-time-step="now"]').getAttribute('aria-pressed'),'true');assert.deepEqual(await back(),[true,true,true]);
  await page.locator('[data-layer="coast"]').click();await page.locator('[data-layer="sea"]').click();await waitCoast(at);
 });
 await check('시각 토스트: 버튼마다 바 위에 약 2초·연타는 마지막 것만·aria-live·누름 통과·스피너/실패 안내/해상 범례와 안 겹침',async()=>{
  const toast=()=>page.evaluate(()=>{const els=document.querySelectorAll('.rf-time-toast'),el=els[0];return{count:els.length,hidden:el.hidden,text:el.textContent,live:el.getAttribute('aria-live'),role:el.getAttribute('role'),pe:getComputedStyle(el).pointerEvents};});
  assert.equal((await state()).t,at);await page.waitForFunction(()=>document.querySelector('.rf-time-toast').hidden,null,{timeout:3000});let x=await toast();assert.deepEqual([x.count,x.hidden,x.live,x.role,x.pe],[1,true,'polite','status','none'],'처음엔 숨김');
  await step(3);x=await toast();assert.deepEqual([x.hidden,x.text],[false,'12.(월) 12:00 예보']);
  await step(3);await step(6);await step('now');x=await toast();assert.deepEqual([x.count,x.hidden,x.text],[1,false,'현재 12.(월) 11:00'],'연타하면 마지막 것만');
  await page.waitForTimeout(1500);assert.equal((await toast()).hidden,false,'2초 전에는 남아 있다(연타 뒤 타이머 새로)');await page.waitForFunction(()=>document.querySelector('.rf-time-toast').hidden,null,{timeout:2000});
  await page.locator('[data-layer="sea"]').click();await page.waitForFunction(()=>marineCount()>0);
  for(const w of [380,320]){await page.setViewportSize({width:w,height:915});await step(3);await page.waitForFunction(()=>!document.querySelector('.rf-time-toast').hidden);
   const g=await page.evaluate(()=>{const r=e=>e.getBoundingClientRect().toJSON(),wait=document.querySelector('.rf-map-wait');wait.hidden=false;wait.querySelector('[data-wait-msg]').hidden=false;wait.querySelector('[data-wait-spin]').hidden=false;const out={toast:r(document.querySelector('.rf-time-toast')),bar:r(document.querySelector('.rf-marine-timebar')),legend:r(document.querySelector('.rf-color-legend')),msg:r(wait.querySelector('[data-wait-msg]')),spin:r(wait.querySelector('[data-wait-spin]')),width:innerWidth};wait.hidden=true;wait.querySelector('[data-wait-msg]').hidden=true;return out;});
   const apart=(a,b)=>a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top;
   assert.ok(g.toast.bottom<=g.bar.top&&g.bar.top-g.toast.bottom<=8,w+'px 토스트는 바 바로 위');assert.ok(g.toast.left>=0&&g.toast.right<=g.width,w+'px 화면 안');
   for(const k of ['legend','msg','spin'])assert.ok(apart(g.toast,g[k]),w+'px 토스트와 '+k+' 안 겹침');
   await shot(w+'-토스트');await step('now');}
  await page.setViewportSize({width:412,height:915});
  await step(3);await page.locator('[data-layer="sea"]').click();await page.locator('[data-layer="coast"]').click();assert.equal((await toast()).hidden,true,'바가 숨으면 토스트도 숨김');
  await page.locator('[data-layer="coast"]').click();await step('now');await waitCoast(at);
 });
 await check('연안 색 범례: 연안 켜면 왼쪽 위 「위험지수」 4단계(BAND_COLORS)·해상만은 숨김·둘 다는 둘 다·380/320px 겹침 없음',async()=>{
  const key=()=>page.evaluate(()=>{const k=document.querySelector('[data-coast-key]'),c=document.querySelector('.rf-color-legend');return{count:document.querySelectorAll('[data-coast-key]').length,coast:!!k&&k.getClientRects().length>0,sea:!!c&&c.getClientRects().length>0,title:k&&k.querySelector('.rf-coast-key-title').textContent,labels:k&&Array.from(k.querySelectorAll('.rf-gradient-labels span')).map(s=>s.textContent),bar:k&&k.querySelector('.rf-gradient-bar').style.background,colors:Object.values(RiskFormat.BAND_COLORS).map(h=>'rgb('+[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)).join(', ')+')')};});
  let k=await key();assert.deepEqual([k.count,k.coast,k.sea,k.title],[1,true,false,'위험지수'],'연안만: 연안 범례만');assert.deepEqual(k.labels,['평소 수준','다소 높음','높음','매우 높음']);for(const c of k.colors)assert.ok(k.bar.includes(c),'막대 색 '+c);
  await page.locator('[data-layer="sea"]').click();await page.waitForFunction(()=>marineCount()>0);k=await key();assert.deepEqual([k.coast,k.sea],[true,true],'둘 다: 둘 다 보임');
  for(const w of [380,320]){await page.setViewportSize({width:w,height:915});const g=await page.evaluate(()=>{const r=e=>e.getBoundingClientRect().toJSON(),k=document.querySelector('[data-coast-key]');return{key:r(k),box:r(document.querySelector('.banzone-legend')),sea:r(document.querySelector('.rf-color-legend')),bar:r(document.querySelector('.rf-marine-timebar')),width:innerWidth,clip:[k,...k.querySelectorAll('span,strong')].filter(e=>e.scrollWidth>e.clientWidth).map(e=>e.textContent)};});
   const apart=(a,b)=>a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top;
   assert.ok(g.key.left>=0&&g.key.right<=g.width,w+'px 화면 안');assert.ok(g.key.top>=g.box.top&&g.key.bottom<=g.box.bottom+0.5,w+'px 토글 상자 안');assert.ok(apart(g.key,g.sea)&&apart(g.key,g.bar),w+'px 해상 범례·시간 바와 안 겹침');assert.deepEqual(g.clip,[],w+'px 잘린 글자 없음');assert.ok(g.key.height<=60,w+'px 촘촘히(높이 '+g.key.height+')');
   if(process.env.RISK_SHOT_DIR)await page.screenshot({path:path.join(process.env.RISK_SHOT_DIR,w+'-범례-둘다.png')});}
  await page.setViewportSize({width:412,height:915});
  await page.locator('[data-layer="coast"]').click();k=await key();assert.deepEqual([k.coast,k.sea],[false,true],'해상만: 연안 범례 숨김');
  await page.locator('[data-layer="sea"]').click();k=await key();assert.deepEqual([k.coast,k.sea],[false,false],'둘 다 끔: 둘 다 숨김');
  await page.locator('[data-layer="coast"]').click();await waitCoast(at);k=await key();assert.deepEqual([k.coast,k.sea],[true,false]);
 });
 await check('시트 시각 격리: 메인15시→시트18·21시→메인 이동에도 시트 유지→닫으면 메인 유지·새 시트도 메인 시각',async()=>{
  await step(3);await step(3);await waitCoast(at3('15:00'));
  const slide=async idx=>page.locator('#risk-forecast-sheet input[type="range"]').evaluate((el,i)=>{el.value=String(i);el.dispatchEvent(new Event('input',{bubbles:true}));},idx);
  const lastDetail=()=>log.detail.at(-1);
  await page.evaluate(()=>app.select('coast','S1'));await page.waitForFunction(()=>document.querySelector('#risk-forecast-sheet .rf-title').textContent.includes('S1'));
  assert.deepEqual(lastDetail(),{id:'S1',t:at3('15:00')},'시트는 메인 시각으로 시작');
  await slide(coastTimes.indexOf(at3('18:00')));await page.waitForFunction(t=>document.querySelector('#risk-forecast-sheet .rf-title').textContent.includes(t),at3('18:00'));
  let s=await state();assert.equal(s.t,at3('15:00'),'시트를 옮겨도 메인 시각은 15시');assert.equal(s.out,'조회 시각 10.12.(월) 15:00');assert.deepEqual(await page.evaluate(()=>coastScores()),[scoreAt(at3('15:00')),scoreAt(at3('15:00'))+1]);
  await slide(coastTimes.indexOf(at3('21:00')));await page.waitForFunction(t=>document.querySelector('#risk-forecast-sheet .rf-title').textContent.includes(t),at3('21:00'));
  await step(3);await waitCoast(at3('18:00'));await new Promise(r=>setTimeout(r,300));
  s=await state();assert.equal(s.t,at3('18:00'));assert.equal(lastDetail().t,at3('21:00'),'열린 시트의 시각은 메인 이동에 따라가지 않는다');assert.ok((await page.locator('#risk-forecast-sheet .rf-title').innerText()).includes(at3('21:00')));
  await page.locator('.rf-close').click();s=await state();assert.equal(s.t,at3('18:00'),'시트를 닫아도 메인은 18시(시트의 21시가 새지 않음)');
  await page.evaluate(()=>app.select('coast','S2'));await page.waitForFunction(()=>document.querySelector('#risk-forecast-sheet .rf-title').textContent.includes('S2'));
  assert.deepEqual(lastDetail(),{id:'S2',t:at3('18:00')},'다른 지점의 새 시트는 메인 시각으로 시작');assert.equal(await page.locator('#risk-forecast-sheet input[type="range"]').inputValue(),String(coastTimes.indexOf(at3('18:00'))));
  await page.locator('.rf-close').click();assert.equal((await state()).t,at3('18:00'));assert.deepEqual(log.bad,[]);
 });
 await check('실행 오류 없음',()=>assert.deepEqual(errors,[]));
}finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});console.log(`${pass} PASS / ${fail} FAIL`);if(fail)process.exitCode=1;}})().catch(e=>{console.error('❌ 브라우저 검사 실행 실패:',e.message);console.log(`${pass} PASS / ${fail+1} FAIL`);process.exitCode=1;});
