/**
 * 파일명: local_server/scripts/test_risk_goto_frame.js
 * 역할  : 「연안 안전 브리핑」 카드의 [위험예측에서 보기 ›](RiskForecast.openAt)로 위험예측을 열었을 때, 고른 해상 칸·연안 관광지가
 *         바텀시트에 가려지지 않고 시트 위로 보이는 지도 띠의 가운데에 오는지(칸 전체가 그 띠 안에 들어오는지) 실제 Chromium 으로 검사한다.
 *         사용자 원문(2026-10-17, 휴대폰): 「위험 예측에서 보기를 눌렀을 때 이렇게 이동되는데 바텀시트 위쪽으로 해당 격자가 가운데 와서
 *         바텀시트에 가려지지 않도록 조치해줘.」
 *         휴대폰(390×844)과 데스크톱(1280×800) 두 크기, 움직임 줄이기(prefers-reduced-motion)면 애니메이션 없이 바로 그 자리.
 * [연계] → client/js/marine-life/risk-forecast/risk_forecast.js (bindApp 의 RiskForecast.openAt → goTo → frameSelection·visiblePadding·sheetTop)
 *        → client/js/marine-life/risk-forecast/risk_map_layer.js (selectionExtent — 선택 테두리의 범위)
 *        → client/js/marine-life/risk-forecast/risk_forecast.css (.rf-sheet max-height — 시트가 다 올라왔을 때 높이를 여기서 잰다)
 *        ← scripts/refactor/verify_all.sh SUITES
 * [로드 순서] 독립 검사. 3001 서버·외부 호출 없음 — 자체 express(임의 포트)가 client/ 와 실제 위험예측 라우터(가짜 저장소)를 내준다.
 *             시각에 기대지 않는다: 시트가 제자리에 오고(.open·transform 0) 지도 움직임이 끝날 때까지 기다린 뒤 잰다.
 * [실행] NODE_PATH=/opt/node-tools/node_modules node local_server/scripts/test_risk_goto_frame.js
 */
'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert'),express=require('express'),{chromium}=require('playwright-core');
const root=path.join(__dirname,'../..'),io=require('../services/risk_collector_io'),M=require('../services/marine_fusion'),T=require('../services/risk_time'),{createRouter}=require('../routes/risk_forecast');
let pass=0,fail=0;
/** 실제 브라우저 결과를 검사한다. 예: check('휴대폰 해상',async()=>{...}).
 * @param {string} name - 사례 @param {function} fn - 검사 @returns {Promise<void>}
 * [연계] ← 아래 시나리오 / 실패도 모두 찍고 마지막에 요약한다. */
async function check(name,fn){try{await fn();console.log('✅',name);pass++;}catch(e){console.error('❌',name,e.message);fail++;}}
const clock={now:Date.parse('2026-10-12T11:00:00+09:00')};
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'goto-frame-'));
(async()=>{let browser,server;try{
 // 해상 GR4 칸 하나(제주 북쪽)와 그 남서쪽 연안 관광지 하나 — test_risk_select_motion.js 와 같은 가짜 자료.
 const geometry={type:'Polygon',coordinates:[[[126.525,33.55],[126.55,33.55],[126.55,33.575],[126.525,33.575],[126.525,33.55]]]},cell={id:'GR4_F4K23_P4',i:0,lat:33.5625,lon:126.5375,geometry,haegu:{label:'163-6',major:163,sub:6},ref:{name:'제주항',bearingWord:'북서',distNm:8.2}},acc={...cell,id:'100'};
 const at0=T.isoKst(clock.now);
 io.write(path.join(dir,'sea_realtime.json.gz'),{v:'v1',cells:[cell],rows:[[0,21,.2]],collectedAt:at0,sourceAt:null,source:'MTIS realtime API'});
 const axes=()=>({coast:T.timeline(clock.now,3,2,21),sea:T.timeline(clock.now,1,2,23)});
 const frames={};for(let t=Date.parse('2026-10-12T00:00:00+09:00');t<=Date.parse('2026-10-14T21:00:00+09:00');t+=3*3600000)frames[T.isoKst(t).slice(0,13).replace(/[-T]/g,'')+'00']=[[0,.002,'주의']];
 const inputs={version:1,cells:{cells:[cell]},congestion:{frames:{}},accident:{cells:[acc],frames},sources:{accident:{status:'ok'},congestion:{status:'ok'},zoneForecasts:{status:'ok'}},weather:()=>({wh:2,ws:12,wp:4,wd:241,forecastAt:at0})};
 const ring=(x,y)=>[[x,y],[x+.012,y],[x+.012,y+.012],[x,y+.012],[x,y]],spots=[{id:'S1',i:0,lat:33.536,lon:126.506,name:'가짜해변',cell:ring(126.5,33.53)}];
 const store={sources:()=>inputs.sources,marineInputs:()=>inputs,
  meta:()=>{const a=axes();return{now:T.isoKst(clock.now),versions:{spots:'v1',cells:1,accident:'v1'},timeline:{sea:{times:a.sea},accident:{times:a.coast},coast:{times:a.coast}},sources:inputs.sources};},
  spots:()=>({spots}),cells:()=>({cells:[cell]}),accidentCells:()=>({v:'v1',cells:[acc]}),accidentFrame:()=>({v:'v1',cells:[[0,.001,'경계']]}),
  frame:(sea)=>sea?{cells:[[0,0,1,'낮음']],spots:[],borders:[]}:{spots:spots.map(s=>[s.i,3]),borders:[]},
  coastDayFrame:()=>({spots:spots.map(s=>[s.i,3]),degraded:[]}),coastDayDetail:(id,t)=>({title:'가짜해변',subtitle:{police:'제주파출소',office:'제주해양경찰서'},clickable:false,t}),islands:()=>({features:[]})};
 const marine=M.createStore({risk:store,dir,clock:()=>clock.now,stations:[{properties:{name:'제주파출소',station:'제주해양경찰서'},geometry}],accidents:[],describe:()=>cell});
 const app=express();app.use(createRouter({store,marine}));
 app.get('/',(req,res)=>res.send(page()));
 app.use(express.static(path.join(root,'client')));
 app.use('/api',(req,res)=>res.status(404).json({ok:false}));
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({...((process.env.PW_CHROME||process.env.SIM_CHROMIUM||process.env.CHROMIUM_EXECUTABLE)?{executablePath:process.env.PW_CHROME||process.env.SIM_CHROMIUM||process.env.CHROMIUM_EXECUTABLE}:{}),headless:true,args:['--no-sandbox']});
 /** 앱과 같은 층(지도 z50·하단 탭 z60) 화면 — 실제 bindApp 이 붙는 위험예측 버튼(#ocean-risk-forecast-toggle-btn)과 getOceanMap 을 둔다.
  * 지도는 처음에 제주 남쪽 멀리(칸이 화면 밖)에서 시작한다. @returns {string} HTML [연계] ← app.get('/') */
 function page(){return '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/vendor/ol/ol.css"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/js/marine-life/risk-forecast/risk_forecast.css"><style>'+
  ':root{--main-tab-height:68px}body{margin:0;background:#10223d;color:white}#ocean-map-section{position:fixed;top:0;left:0;right:0;bottom:0;z-index:50;overflow:hidden;background:#0c1a3a}.ocean-map-wrapper{position:absolute;inset:0;overflow:hidden}#map{width:100%;height:100%}'+
  '#tabs{position:fixed;left:0;right:0;bottom:0;height:68px;z-index:60;background:#263f65}#risk-forecast-legend{position:absolute;top:10px;left:10px}#ocean-risk-forecast-toggle-btn{position:absolute;top:10px;right:10px}</style></head>'+
  '<body class="ls-mode ls-safety"><section id="ocean-map-section"><div class="ocean-map-wrapper"><div id="map"></div><button type="button" id="ocean-risk-forecast-toggle-btn">위험예측</button><div id="risk-forecast-legend" class="rf-legend"></div><div class="rf-banner" id="risk-forecast-banner" hidden></div><div class="rf-sheet" id="risk-forecast-sheet" role="region"></div></div></section><nav id="tabs">메인 탭</nav>'+
  '<script>localStorage.setItem("seagnal_admin_mode","true");</script>'+
  ['assets/vendor/ol/ol.js','js/core/backbutton.js',...['risk_format','risk_api','risk_map_layer','risk_slider','risk_marine','risk_sheet','risk_basis_content','risk_basis','risk_forecast'].map(s=>'js/marine-life/risk-forecast/'+s+'.js')].map(s=>'<script src="/'+s+'"></script>').join('')+
  '<script>window.map=new ol.Map({target:"map",view:new ol.View({center:ol.proj.fromLonLat([126.40,33.05]),zoom:10})});window.getOceanMap=function(){return map;};'+
  // 선택 테두리(시안) 도형의 화면 픽셀 범위. 예: {l,t,r,b} — 지도 요소가 아니라 창(viewport) 좌표
  'window.selBox=function(){var l=map.getLayers().getArray().find(function(l){return l.getClassName()==="rf-selection-canvas";});var e=l.getSource().getExtent(),r=map.getTargetElement().getBoundingClientRect(),a=map.getPixelFromCoordinate([e[0],e[3]]),b=map.getPixelFromCoordinate([e[2],e[1]]);return{l:r.left+a[0],t:r.top+a[1],r:r.left+b[0],b:r.top+b[1],n:l.getSource().getFeatures().length};};'+
  '</script></body></html>';}
 const SHEET='#risk-forecast-sheet';
 /** 한 화면 크기에서 openAt 로 열고 칸 위치·시트 윗변·지도 띠를 잰다.
  * 예: measure({width:390,height:844},{kind:'marine',…}) → {box,sheetTop,mapTop,…}
  * @param {Object} vp - viewport @param {Object} target - openAt 대상 @param {boolean} [reduce] - 움직임 줄이기
  * @returns {Promise<Object>} [연계] ← 아래 check 들 */
 async function measure(vp,target,reduce){
  const ctx=await browser.newContext({viewport:vp,reducedMotion:reduce?'reduce':'no-preference'}),pg=await ctx.newPage(),errors=[];pg.on('pageerror',e=>errors.push(e.message));
  await pg.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
  await pg.goto(base+'/');await pg.waitForFunction(()=>window.RiskForecast&&RiskForecast.openAt);
  // openAt 가 돌아온 그 순간의 지도 상태(움직임 줄이기면 이미 제자리·움직이는 중 아님)
  const at=await pg.evaluate(async t=>{const ok=await RiskForecast.openAt(t);const v=map.getView();return{ok,animating:v.getAnimating(),center:v.getCenter().slice(),zoom:v.getZoom()};},target);
  await pg.waitForFunction(s=>{const e=document.querySelector(s),m=getComputedStyle(e).transform;return e.classList.contains('open')&&!e.getAttribute('aria-busy')&&(m==='none'||m==='matrix(1, 0, 0, 1, 0, 0)');},SHEET);
  await pg.waitForFunction(()=>!map.getView().getAnimating());await pg.waitForTimeout(150);
  const out=await pg.evaluate(([s,loc])=>{const sh=document.querySelector(s).getBoundingClientRect(),m=map.getTargetElement().getBoundingClientRect(),p=map.getPixelFromCoordinate(ol.proj.fromLonLat([loc.lon,loc.lat]));return{box:selBox(),pointY:m.top+p[1],pointX:m.left+p[0],sheetTop:sh.top,sheetH:sh.height,maxH:parseFloat(getComputedStyle(document.querySelector(s)).maxHeight),mapTop:m.top,mapL:m.left,mapR:m.right,zoom:map.getView().getZoom(),center:map.getView().getCenter().slice(),sel:window._riskForecastApp.getState().selected};},[SHEET,target.location]);
  await ctx.close();return{...out,at,errors};
 }
 /** 칸이 시트 위 지도 띠 안에 다 들어오고 가운데에 있는지 단언한다.
  * @param {Object} r - measure 결과 @param {string} label @returns {void} [연계] ← check */
 function assertFramed(r,label){
  const b=r.box,cy=(b.t+b.b)/2,cx=(b.l+b.r)/2,mid=(r.mapTop+r.sheetTop)/2,midX=(r.mapL+r.mapR)/2,strip=r.sheetTop-r.mapTop;
  console.log('측정',label,JSON.stringify({cell:{l:Math.round(b.l),t:Math.round(b.t),r:Math.round(b.r),b:Math.round(b.b)},center:[Math.round(cx),Math.round(cy)],strip:[Math.round(r.mapTop),Math.round(r.sheetTop)],stripMid:Math.round(mid),sheetH:Math.round(r.sheetH),maxH:Math.round(r.maxH),zoom:+r.zoom.toFixed(2)}));
  assert.ok(b.n>0,'선택 테두리가 있어야 함');assert.deepEqual(r.errors,[]);
  assert.ok(cy>r.mapTop&&cy<r.sheetTop,'칸 가운데가 시트 위 지도 띠 안: '+Math.round(cy)+' ∉ ('+Math.round(r.mapTop)+','+Math.round(r.sheetTop)+')');
  assert.ok(Math.abs(cy-mid)<=Math.max(8,strip*0.05),'칸 가운데가 띠 가운데(±5%): '+Math.round(cy)+' vs '+Math.round(mid));
  assert.ok(Math.abs(cx-midX)<=8,'가로도 가운데: '+Math.round(cx)+' vs '+Math.round(midX));
  assert.ok(b.t>=r.mapTop&&b.b<=r.sheetTop,'칸 전체가 띠 안(시트에 가리지 않음): '+Math.round(b.t)+'~'+Math.round(b.b));
  assert.ok(b.l>=r.mapL&&b.r<=r.mapR,'칸 전체가 가로로도 화면 안');
 }
 const SEA={kind:'marine',id:'GR4_F4K23_P4',location:{lon:126.53,lat:33.56},t:null},COAST={kind:'coast',id:'S1',date:null,location:{lon:126.506,lat:33.536}};
 for(const [label,vp] of [['휴대폰 390×844',{width:390,height:844}],['데스크톱 1280×800',{width:1280,height:800}]]){
  await check(label+' 해상 칸 openAt: 칸이 시트 위 지도 띠 가운데·칸 전체가 띠 안',async()=>{const r=await measure(vp,SEA);assert.equal(r.at.ok,true);assert.equal(r.at.animating,true,'움직임 줄이기가 아니면 0.25초 움직여 옮긴다');assert.equal(r.sel.id,'GR4_F4K23_P4');assertFramed(r,label+' 해상');});
  await check(label+' 연안 관광지 openAt: 관광지 영역이 시트 위 지도 띠 가운데',async()=>{const r=await measure(vp,COAST);assert.equal(r.at.ok,true);assert.equal(r.sel.id,'S1');assertFramed(r,label+' 연안');});
 }
 await check('휴대폰 칸 id 없는 해상 지점(id point — 브리핑에 GR4 칸이 없을 때): 그 좌표가 띠 가운데',async()=>{
  const r=await measure({width:390,height:844},{kind:'marine',id:'point',location:{lon:126.53,lat:33.56},t:null});
  assert.equal(r.at.ok,true);assert.deepEqual(r.errors,[]);
  const mid=(r.mapTop+r.sheetTop)/2,midX=(r.mapL+r.mapR)/2;console.log('측정 해상 point',JSON.stringify({strip:[Math.round(r.mapTop),Math.round(r.sheetTop)],point:[Math.round(r.pointX),Math.round(r.pointY)]}));
  assert.ok(Math.abs(r.pointY-mid)<=Math.max(8,(r.sheetTop-r.mapTop)*0.05),'좌표가 띠 가운데: '+Math.round(r.pointY)+' vs '+Math.round(mid));assert.ok(Math.abs(r.pointX-midX)<=8,'가로 가운데');
 });
 await check('움직임 줄이기: openAt 이 돌아온 순간 지도는 움직이는 중이 아니고 이미 칸이 띠 가운데(애니메이션 없음)',async()=>{
  const r=await measure({width:390,height:844},SEA,true);assert.equal(r.at.animating,false,'움직이는 중이면 안 됨');
  // 지도 픽셀 환산(getPixelFromCoordinate)은 다음 그림 뒤에야 바뀌므로 view 의 가운데·확대 값을 견준다 — 돌아온 순간 값이 다 열린 뒤와 같으면 애니메이션 없이 바로 옮겼고 나중에 또 움직이지 않았다.
  assert.ok(Math.hypot(r.at.center[0]-r.center[0],r.at.center[1]-r.center[1])<1&&Math.abs(r.at.zoom-r.zoom)<1e-6,'돌아온 순간과 다 열린 뒤 지도 위치가 같아야 함 '+JSON.stringify([r.at,r.center,r.zoom]));
 });
}catch(e){console.error('❌ 실행 실패',e.stack||e.message);fail++;}
finally{if(browser)await browser.close();if(server)server.close();fs.rmSync(dir,{recursive:true,force:true});console.log(pass+' PASS / '+fail+' FAIL');process.exit(fail?1:0);}})();
