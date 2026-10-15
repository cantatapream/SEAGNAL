/**
 * 파일명: local_server/scripts/test_risk_main_time.js
 * 역할  : 연안·해상 공통 메인 시각(하단 날짜·시각 버튼)을 실제 Chromium에서 검사한다.
 *         메인 시각을 옮기면 연안 지도가 그 시각으로 바뀌는지, 연안 범위 끝(내일 21시 — 「가」), 해상 버튼과의 공존,
 *         시트 시각이 메인과 서로 새지 않는지(메인15시→시트18시→닫으면 메인15시·새 시트도 15시)를 본다.
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
 app.get('/',(req,res)=>res.send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/vendor/ol/ol.css"><link rel="stylesheet" href="/js/marine-life/risk-forecast/risk_forecast.css"><style>body{margin:0;background:#10223d;color:white}#map{height:915px}#risk-forecast-legend{position:absolute;top:10px;left:10px}#risk-forecast-sheet{position:absolute;bottom:0;max-height:65vh;overflow:auto;width:100%;background:#172d49}</style></head><body class="ls-mode ls-safety"><nav id="tabs" style="position:fixed;bottom:0;height:68px;width:100%;background:#263f65;z-index:160">메인 탭</nav><div class="ol-attribution" style="position:fixed;left:8px">국토부 V월드</div><div class="ol-scale-line" style="position:fixed;right:8px">100KM</div><div id="map"></div><div id="risk-forecast-legend" class="rf-legend"></div><div id="risk-forecast-banner"></div><div id="risk-forecast-sheet"></div>'+['assets/vendor/ol/ol.js',...['risk_format','risk_api','risk_map_layer','risk_slider','risk_marine','risk_sheet','risk_basis_content','risk_basis','risk_forecast'].map(s=>'js/marine-life/risk-forecast/'+s+'.js')].map(s=>'<script src="/'+s+'"></script>').join('')+'<script>window.map=new ol.Map({target:"map",view:new ol.View({center:ol.proj.fromLonLat([126.5,33.5]),zoom:9})});window.getOceanMap=function(){return map;};window.app=RiskForecast.mount({map:map,legendEl:document.getElementById("risk-forecast-legend"),sheetEl:document.getElementById("risk-forecast-sheet"),bannerEl:document.getElementById("risk-forecast-banner")});window.coastScores=function(){return map.getLayers().getArray().find(function(l){return l.getClassName()==="rf-coast-canvas";}).getSource().getFeatures().map(function(f){return f.get("score");}).sort();};window.marineCount=function(){return map.getLayers().getArray().find(function(l){return l.getClassName()==="rf-marine-canvas";}).getSource().getFeatures().length;};</script></body></html>'));
 app.use(express.static(path.join(root,'client')));server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 browser=await chromium.launch({...((process.env.PW_CHROME||process.env.SIM_CHROMIUM||process.env.CHROMIUM_EXECUTABLE)?{executablePath:process.env.PW_CHROME||process.env.SIM_CHROMIUM||process.env.CHROMIUM_EXECUTABLE}:{}),headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:412,height:915}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);if(!await page.evaluate(()=>!!window.app))throw Error('초기화 실패: '+errors.join(' / '));await page.evaluate(()=>app.ready);
 /** 화면 상태를 읽는다. 예: {t,out}. @returns {Promise<object>} 메인 t와 고정 표시문구 [연계] ← 모든 사례 */
 const state=async()=>({...(await page.evaluate(()=>app.getState())),out:await page.locator('[data-map-time]').innerText()});
 /** 연안 지도가 해당 시각의 점수가 될 때까지 기다린다. 예: waitCoast('2026-10-12T12:00:00+09:00'). @param {string} t @returns {Promise<void>} [연계] ← 시각 이동 사례 */
 const waitCoast=t=>page.waitForFunction(s=>JSON.stringify(coastScores())===JSON.stringify([s,s+1]),scoreAt(t),{timeout:8000});
 const step=async h=>{await page.locator('[data-time-step="'+h+'"]').evaluate(el=>el.click());};
 const disabled=async()=>page.evaluate(()=>['3','6','12'].map(h=>document.querySelector('[data-time-step="'+h+'"]').disabled));
 const at3=hhmm=>coastTimes.find(t=>t.includes('T'+hhmm+':'));
 const banner=()=>page.locator('#risk-forecast-banner').innerText(),caption=()=>page.locator('[data-marine-caption]').innerText();

 await check('연안만 켠 기본 화면에도 공통 메인 시각 바(고정 표시+현재·+3H·+6H·+12H)가 보임',async()=>{
  await waitCoast(at);
  const r=await page.evaluate(()=>{const bar=document.querySelector('.rf-marine-timebar'),tabs=document.getElementById('tabs').getBoundingClientRect();return{count:document.querySelectorAll('.rf-marine-timebar').length,outputs:document.querySelectorAll('[data-map-time]').length,tag:document.querySelector('[data-map-time]').tagName,labels:Array.from(bar.querySelectorAll('button')).map(b=>b.textContent),hidden:bar.hidden,bottom:bar.getBoundingClientRect().bottom,tabsTop:tabs.top,body:document.body.classList.contains('rf-sea-time-on'),tools:document.querySelector('[data-marine-tools]').hidden,sea:app.getState().sea,sliders:document.querySelectorAll('[data-marine-slider]').length};});
  assert.deepEqual([r.count,r.outputs,r.tag,r.hidden,r.sea,r.tools,r.sliders],[1,1,'OUTPUT',false,false,true,0]);assert.deepEqual(r.labels,['현재','+3H','+6H','+12H']);assert.ok(r.bottom<=r.tabsTop);assert.equal(r.body,true);
  assert.equal((await state()).out,'10.12.(월) 11:00');assert.equal(log.unified.length,0,'해상이 꺼져 있으면 해상 프레임을 요청하지 않는다');assert.equal(await banner(),'');
 });
 await check('메인 시각을 바꾸면 연안 지도가 그 시각의 프레임으로 바뀜(+3H·+3H·현재)',async()=>{
  await step(3);await waitCoast(at3('12:00'));let s=await state();assert.equal(s.t,at3('12:00'));assert.equal(s.out,'10.12.(월) 12:00');assert.ok(log.coast.includes(at3('12:00')));
  await step(3);await waitCoast(at3('15:00'));s=await state();assert.equal(s.t,at3('15:00'));assert.equal(s.out,'10.12.(월) 15:00');
  await step(6);await waitCoast(at3('21:00'));assert.equal((await state()).t,at3('21:00'));
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
  await step(3);await waitCoast('2026-10-13T21:00:00+09:00');const end=await state();assert.equal(end.t,'2026-10-13T21:00:00+09:00');assert.equal(end.out,'10.13.(화) 21:00');
  assert.deepEqual(await disabled(),[true,true,true],'마지막 칸(내일 21시): 앞으로 이동 불가');
  await step(3);await step(12);assert.equal((await state()).t,'2026-10-13T21:00:00+09:00','비활성 버튼은 시각을 바꾸지 못한다');
  assert.deepEqual(log.bad,[],'서버 연안 범위 밖 시각을 요청하지 않았다');assert.ok(log.coast.every(t=>coastTimes.includes(t)));assert.equal(log.coast.some(t=>t.startsWith('2026-10-14')),false,'모레 시각을 요청하지 않았다');
  assert.equal(await page.locator('[data-time-step="now"]').isEnabled(),true);await step('now');await waitCoast(at);
 });
 await check('해상 버튼과 공존: 같은 바 하나로 연안·해상이 함께 이동하고 해상 ON 시 예전 해상 버튼 구성 유지',async()=>{
  await page.locator('[data-layer="sea"]').click();await page.waitForFunction(()=>marineCount()>0);
  const r=await page.evaluate(()=>({bars:document.querySelectorAll('.rf-marine-timebar').length,outputs:document.querySelectorAll('[data-map-time]').length,labels:Array.from(document.querySelectorAll('.rf-marine-timebar button')).map(b=>b.textContent),tools:document.querySelector('[data-marine-tools]').hidden,caption:document.querySelector('[data-marine-caption]').textContent}));
  assert.deepEqual([r.bars,r.outputs,r.tools],[1,1,false]);assert.deepEqual(r.labels,['현재','+3H','+6H','+12H']);assert.equal(r.caption,'공식 사고예보','2026-10-15 종합 관심단계 폐지 — 현재도 공식 사고예보');
  await step(3);await page.waitForFunction(()=>document.querySelector('[data-marine-caption]').textContent.includes('공식 사고예보'));await waitCoast(at3('12:00'));
  assert.ok(log.unified.includes(at3('12:00')),'해상 프레임도 같은 시각으로 요청');assert.equal((await state()).out,'10.12.(월) 12:00');assert.ok(await page.evaluate(()=>marineCount())>0);
  await step('now');await waitCoast(at);
 });
 await check('연안·해상 둘 다 ON: 내일 21시에서 함께 멈추고 해상 지도는 그대로(「가」 — 연안만 남는 모레 구간·범위 밖 안내 없음)',async()=>{
  for(let i=0;i<3;i++)await step(12);const seaEnd=await state();assert.equal(seaEnd.t,'2026-10-13T21:00:00+09:00');await waitCoast(seaEnd.t);
  await page.waitForFunction(()=>marineCount()>0);assert.equal(await caption(),'공식 사고예보','내일 21시는 해상 범위 안');
  assert.deepEqual(await disabled(),[true,true,true],'두 층의 끝이 같아 더 갈 칸이 없다');assert.doesNotMatch(await caption(),/범위 밖/);
  const unifiedBefore=log.unified.length;await step(3);await step(12);assert.equal((await state()).t,seaEnd.t);assert.equal(log.unified.length,unifiedBefore,'비활성 버튼은 해상 요청도 만들지 않는다');
  await page.evaluate(()=>{app.setEnabled(false);app.setEnabled(true);});await waitCoast(seaEnd.t);assert.equal((await state()).t,seaEnd.t,'재동기화 뒤에도 내일 21시 유지');await page.waitForFunction(()=>marineCount()>0);
  await page.locator('[data-layer="coast"]').click();await page.waitForFunction(t=>app.getState().t===t,seaEnd.t);
  await page.waitForFunction(()=>marineCount()>0);assert.equal(await caption(),'공식 사고예보','해상만 보아도 같은 시각');assert.equal(await page.locator('.rf-color-legend [data-accident-legend]').isVisible(),true);assert.equal(await page.locator('.rf-marine-timebar').isVisible(),true);
  assert.deepEqual(await disabled(),[true,true,true]);
  await page.locator('[data-layer="sea"]').click();assert.equal(await page.locator('.rf-marine-timebar').isVisible(),false,'연안·해상 둘 다 끄면 바 숨김');assert.equal(await page.evaluate(()=>document.body.classList.contains('rf-sea-time-on')),false);
  await page.locator('[data-layer="coast"]').click();await page.waitForFunction(()=>!document.querySelector('.rf-marine-timebar').hidden);
  await page.locator('[data-layer="sea"]').click();await page.waitForFunction(()=>marineCount()>0);await page.locator('[data-layer="sea"]').click();
  await step('now');await waitCoast(at);
 });
 await check('시트 시각 격리: 메인15시→시트18·21시→메인 이동에도 시트 유지→닫으면 메인 유지·새 시트도 메인 시각',async()=>{
  await step(3);await step(3);await waitCoast(at3('15:00'));
  const slide=async idx=>page.locator('#risk-forecast-sheet input[type="range"]').evaluate((el,i)=>{el.value=String(i);el.dispatchEvent(new Event('input',{bubbles:true}));},idx);
  const lastDetail=()=>log.detail.at(-1);
  await page.evaluate(()=>app.select('coast','S1'));await page.waitForFunction(()=>document.querySelector('#risk-forecast-sheet .rf-title').textContent.includes('S1'));
  assert.deepEqual(lastDetail(),{id:'S1',t:at3('15:00')},'시트는 메인 시각으로 시작');
  await slide(coastTimes.indexOf(at3('18:00')));await page.waitForFunction(t=>document.querySelector('#risk-forecast-sheet .rf-title').textContent.includes(t),at3('18:00'));
  let s=await state();assert.equal(s.t,at3('15:00'),'시트를 옮겨도 메인 시각은 15시');assert.equal(s.out,'10.12.(월) 15:00');assert.deepEqual(await page.evaluate(()=>coastScores()),[scoreAt(at3('15:00')),scoreAt(at3('15:00'))+1]);
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
