/**
 * 파일명: local_server/scripts/test_risk_select_motion.js
 * 역할  : 위험예측 지도에서 해상 GR4 칸·연안 관광지를 누르면 ①선택 테두리가 해구기상 해구 칸 선택과 같은 모양(시안 #4fc3f7·2.5px)으로 바로 보이고
 *         ②닫혀 있던 시트가 약 0.2초 뒤 해양종합정보 바텀시트처럼 아래에서 올라오며(0.3초) ③닫을 때도 내려간 뒤 정리되는지 실제 Chromium 으로 검사한다.
 *         사용자 원문(2026-10-16): 「격자를 클릭하면 격자가 선택되었다는 느낌으로 격자 테두리를 표시하고 싶어. 표시 방법은 해구기상에서 해구격자를
 *         선택했을떄와 동일한 스타일로. 그리고 선택이후 약간의 딜레이(0.2초?) 정도 후 바텀시트가 나오도록 하고 바텀시트는 현재 동적 애니메이션은 없는
 *         아래서 위로 올라오는 느낌의 애니메이션이 있으면 좋겠어. 현재 해양종합정보 바텀시트에는 애니메이션이 잘 반영되어있음. 그대로 하면될듯.
 *         닫을때도 마찬가지로 말이야.」 · 「바텀시트 애니메이션 및 클릭 관련해서는 연안에도 적용해줘.」
 * [연계] → client/js/marine-life/risk-forecast/risk_sheet.js (hold·present·clear — 0.2초 대기·0.3초 내려가기 정리)
 *        → client/js/marine-life/risk-forecast/risk_forecast.js (select — 테두리 즉시·시트 대기) · risk_map_layer.js (setSelection 색·굵기)
 *        → client/js/marine-life/risk-forecast/risk_forecast.css (.rf-sheet transform 0.3s · .rf-shown · reduced-motion)
 *        → 비교 원본: client/js/ocean-map/map/ocean_map.js _styleSelectedMainFeature · client/style.css .ocean-bottom-sheet
 *        ← scripts/refactor/verify_all.sh SUITES
 * [로드 순서] 독립 검사. 3001 서버·외부 호출 없음 — 자체 express(임의 포트)가 client/ 와 실제 위험예측 라우터(가짜 저장소)를 내준다.
 *             시각에 기대지 않는다: 0.2초·0.3초 타이머는 페이지 안 가짜 타이머로 한 칸씩 돌리고(1부), 실제 움직임은 시간을 재지 않고
 *             계산된 transform 이 제자리에 올 때까지 기다린다(2부). RISK_MOTION_SHOTS=<폴더> 를 주면 380px 화면 사진을 남긴다(판정에는 안 씀).
 * [실행] NODE_PATH=/opt/node-tools/node_modules node local_server/scripts/test_risk_select_motion.js
 */
'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert'),express=require('express'),{chromium}=require('playwright-core');
const root=path.join(__dirname,'../..'),io=require('../services/risk_collector_io'),M=require('../services/marine_fusion'),T=require('../services/risk_time'),{createRouter}=require('../routes/risk_forecast');
let pass=0,fail=0;
/** 실제 브라우저 결과를 검사한다. 예: check('테두리',async()=>{...}).
 * @param {string} name - 사례 @param {function} fn - 검사 @returns {Promise<void>}
 * [연계] ← 아래 시나리오 / 실패도 모두 찍고 마지막에 요약한다. */
async function check(name,fn){try{await fn();console.log('✅',name);pass++;}catch(e){console.error('❌',name,e.message);fail++;}}
const SHOTS=process.env.RISK_MOTION_SHOTS||'';if(SHOTS)fs.mkdirSync(SHOTS,{recursive:true});
// 해구기상 대해구 첫 클릭 강조(ocean_map.js _styleSelectedMainFeature)와 해양종합정보 바텀시트(style.css .ocean-bottom-sheet) — 원본 파일에서 읽어 대조한다.
const oceanMapJs=fs.readFileSync(path.join(root,'client/js/ocean-map/map/ocean_map.js'),'utf8'),styleCss=fs.readFileSync(path.join(root,'client/style.css'),'utf8');
const zoneStyle=/function _styleSelectedMainFeature\(\)[\s\S]*?stroke:\s*new ol\.style\.Stroke\(\{\s*color:\s*'([^']+)',\s*width:\s*([\d.]+)\s*\}\)/.exec(oceanMapJs);
const oceanSheet=/\.ocean-bottom-sheet \{[^}]*?transform:\s*([^;]+);[^}]*?transition:\s*([^;]+);/.exec(styleCss),oceanOpen=/\.ocean-bottom-sheet\.open \{\s*transform:\s*([^;]+);/.exec(styleCss);
if(!zoneStyle||!oceanSheet||!oceanOpen)throw Error('비교 원본(해구기상 선택 스타일·해양종합정보 시트 CSS)을 찾지 못함');
const ZONE={color:zoneStyle[1],width:Number(zoneStyle[2])};
const clock={now:Date.parse('2026-10-12T11:00:00+09:00')};
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'select-motion-'));
(async()=>{let browser,server;try{
 // 해상 GR4 칸 하나(제주 북쪽)와 그 남서쪽 연안 관광지 하나 — 화면 380px 에서 둘 다 보이게 둔다.
 const geometry={type:'Polygon',coordinates:[[[126.525,33.55],[126.55,33.55],[126.55,33.575],[126.525,33.575],[126.525,33.55]]]},cell={id:'GR4_F4K23_P4',i:0,lat:33.5625,lon:126.5375,geometry,haegu:{label:'163-6',major:163,sub:6},ref:{name:'제주항',bearingWord:'북서',distNm:8.2}},acc={...cell,id:'100'};
 const at0=T.isoKst(clock.now);
 io.write(path.join(dir,'sea_realtime.json.gz'),{v:'v1',cells:[cell],rows:[[0,21,.2]],collectedAt:at0,sourceAt:null,source:'MTIS realtime API'});
 const axes=()=>({coast:T.timeline(clock.now,3,2,21),sea:T.timeline(clock.now,1,2,23)});
 // 공식 사고 3시간 칸(00·03·…시) 오늘~모레 — 지도 [위험 예측] 면색이 칠해져야 해상 칸을 누를 수 있다.
 const frames={};for(let t=Date.parse('2026-10-12T00:00:00+09:00');t<=Date.parse('2026-10-14T21:00:00+09:00');t+=3*3600000)frames[T.isoKst(t).slice(0,13).replace(/[-T]/g,'')+'00']=[[0,.002,'주의']];
 const inputs={version:1,cells:{cells:[cell]},congestion:{frames:{}},accident:{cells:[acc],frames},sources:{accident:{status:'ok'},congestion:{status:'ok'},zoneForecasts:{status:'ok'}},weather:()=>({wh:2,ws:12,wp:4,wd:241,forecastAt:at0})};
 const ring=(x,y)=>[[x,y],[x+.012,y],[x+.012,y+.012],[x,y+.012],[x,y]],spots=[{id:'S1',i:0,lat:33.536,lon:126.506,name:'가짜해변',cell:ring(126.5,33.53)}];
 const store={sources:()=>inputs.sources,marineInputs:()=>inputs,
  meta:()=>{const a=axes();return{now:T.isoKst(clock.now),versions:{spots:'v1',cells:1,accident:'v1'},timeline:{sea:{times:a.sea},accident:{times:a.coast},coast:{times:a.coast}},sources:inputs.sources};},
  spots:()=>({spots}),cells:()=>({cells:[cell]}),accidentCells:()=>({v:'v1',cells:[acc]}),accidentFrame:()=>({v:'v1',cells:[[0,.001,'경계']]}),
  frame:(sea)=>sea?{cells:[[0,0,1,'낮음']],spots:[],borders:[]}:{spots:spots.map(s=>[s.i,3]),borders:[]},
  // 연안 지도·상세 경로는 날짜당 하나(T24 — 라우터가 coastDayFrame·coastDayDetail 을 부른다).
  coastDayFrame:()=>({spots:spots.map(s=>[s.i,3]),degraded:[]}),coastDayDetail:(id,t)=>({title:'가짜해변',subtitle:{police:'제주파출소',office:'제주해양경찰서'},clickable:false,t}),islands:()=>({features:[]})};
 const marine=M.createStore({risk:store,dir,clock:()=>clock.now,stations:[{properties:{name:'제주파출소',station:'제주해양경찰서'},geometry}],accidents:[],describe:()=>cell});
 const app=express(),reqLog={analysis:0,spot:0};
 // T24 「나. 무시」: 열린 시트에서 누른 다른 칸이 상세를 요청하지 않는지 세려고 상세 요청을 센다.
 app.use((req,res,next)=>{if(req.path.endsWith('/sea/analysis'))reqLog.analysis++;if(req.path.endsWith('/coast/spot'))reqLog.spot++;next();});
 app.use(createRouter({store,marine}));
 app.get('/',(req,res)=>res.send(page()));
 app.use(express.static(path.join(root,'client')));
 app.use('/api',(req,res)=>res.status(404).json({ok:false}));
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({...((process.env.PW_CHROME||process.env.SIM_CHROMIUM||process.env.CHROMIUM_EXECUTABLE)?{executablePath:process.env.PW_CHROME||process.env.SIM_CHROMIUM||process.env.CHROMIUM_EXECUTABLE}:{}),headless:true,args:['--no-sandbox']});
 const ctx=await browser.newContext({viewport:{width:380,height:780}}),pg=await ctx.newPage(),errors=[];pg.on('pageerror',e=>errors.push(e.message));
 await pg.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
 /** 앱과 같은 층(지도 z50·하단 탭 z60) 휴대폰 화면. 지도를 누르면 앱처럼 위험예측 클릭 훅(tryHandleClick)으로 간다. @returns {string} HTML [연계] ← app.get('/') */
 function page(){return '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/vendor/ol/ol.css"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/js/marine-life/risk-forecast/risk_forecast.css"><style>'+
  ':root{--main-tab-height:68px}body{margin:0;background:#10223d;color:white}#ocean-map-section{position:fixed;top:0;left:0;right:0;bottom:0;z-index:50;overflow:hidden;background:#0c1a3a}.ocean-map-wrapper{position:absolute;inset:0;overflow:hidden}#map{width:100%;height:100%}'+
  '#tabs{position:fixed;left:0;right:0;bottom:0;height:68px;z-index:60;background:#263f65}#risk-forecast-legend{position:absolute;top:10px;left:10px}</style></head>'+
  '<body class="ls-mode ls-safety"><section id="ocean-map-section"><div class="ocean-map-wrapper"><div id="map"></div><div id="risk-forecast-legend" class="rf-legend"></div><div class="rf-banner" id="risk-forecast-banner" hidden></div><div class="rf-sheet" id="risk-forecast-sheet" role="region"></div></div></section><nav id="tabs">메인 탭</nav>'+
  ['assets/vendor/ol/ol.js','js/core/backbutton.js',...['risk_format','risk_api','risk_map_layer','risk_slider','risk_marine','risk_sheet','risk_basis_content','risk_basis','risk_forecast'].map(s=>'js/marine-life/risk-forecast/'+s+'.js')].map(s=>'<script src="/'+s+'"></script>').join('')+
  '<script>window.map=new ol.Map({target:"map",view:new ol.View({center:ol.proj.fromLonLat([126.525,33.49]),zoom:12.4})});'+
  // 시나리오 사이 마우스 누르기가 250ms 안에 이어지면 OL 이 위치와 무관하게 두 번 누름(확대)으로 친다 — 검사 대상이 아니므로 끈다.
  'map.getInteractions().getArray().filter(function(i){return i instanceof ol.interaction.DoubleClickZoom;}).forEach(function(i){map.removeInteraction(i);});'+
  'window.app=RiskForecast.mount({map:map,legendEl:document.getElementById("risk-forecast-legend"),sheetEl:document.getElementById("risk-forecast-sheet"),bannerEl:document.getElementById("risk-forecast-banner")});'+
  // 누른 그 자리(같은 작업 안)의 상태를 남긴다 — 테두리는 즉시, 시트는 아직 아님을 시간 없이 확인하기 위해.
  'map.on("click",function(e){var handled=app.tryHandleClick(e),sh=document.getElementById("risk-forecast-sheet");window.__click={handled:handled,at:performance.now(),shown:sh.classList.contains("rf-shown"),open:sh.classList.contains("open"),sel:selStyles()};});'+
  'window.selStyles=function(){var l=map.getLayers().getArray().find(function(l){return l.getClassName()==="rf-selection-canvas";});return l.getSource().getFeatures().map(function(f){var s=f.getStyle(),st=s.getStroke()||(s.getImage()&&s.getImage().getStroke());return{type:f.getGeometry().getType(),color:st&&st.getColor(),width:st&&st.getWidth(),dash:st&&st.getLineDash()};});};'+
  '</script></body></html>';}
 await pg.goto(base+'/');await pg.waitForFunction(()=>window.app);await pg.evaluate(()=>app.ready);
 const SHEET='#risk-forecast-sheet';
 /** 지도 좌표(경위도)의 화면 픽셀. 예: px(126.5375,33.5625) → [x,y] @returns {Promise<number[]>} [연계] ← 실제 마우스 누르기 */
 const px=(lon,lat)=>pg.evaluate(([lon,lat])=>{const p=map.getPixelFromCoordinate(ol.proj.fromLonLat([lon,lat])),r=map.getTargetElement().getBoundingClientRect();return[r.left+p[0],r.top+p[1]];},[lon,lat]);
 /** 시트 계산된 transform 의 세로 이동(px). 예: 다 올라옴 0, 닫힘 시트 높이. @returns {Promise<number>} */
 const ty=()=>pg.evaluate(s=>{const m=getComputedStyle(document.querySelector(s)).transform;return m==='none'?0:Number(m.slice(7,-1).split(',')[5]);},SHEET);
 /** 다 올라올 때까지(.open·transform 제자리) 기다린다 — 시간을 재지 않는다. @returns {Promise<void>} */
 const waitUp=()=>pg.waitForFunction(s=>{const e=document.querySelector(s),m=getComputedStyle(e).transform;return e.classList.contains('open')&&(m==='none'||m==='matrix(1, 0, 0, 1, 0, 0)');},SHEET);
 /** 내려가기가 끝나 정리될 때까지(.rf-shown 떨어짐) 기다린다. @returns {Promise<void>} */
 const waitGone=()=>pg.waitForFunction(s=>!document.querySelector(s).classList.contains('rf-shown'),SHEET);
 /** 시트 class 변화를 기록하고, .open 이 붙은 뒤 매 그림마다 transform 을 모은다. 예: await rec() → … → await recRead() @returns {Promise<void>} */
 const rec=()=>pg.evaluate(s=>{const el=document.querySelector(s);window.__rec={events:[],samples:[]};if(window.__obs)window.__obs.disconnect();
  const sample=()=>{const m=getComputedStyle(el).transform;window.__rec.samples.push({t:performance.now(),open:el.classList.contains('open'),shown:el.classList.contains('rf-shown'),y:m==='none'?0:Number(m.slice(7,-1).split(',')[5])});};
  // class 속성을 같은 값으로 다시 써도 기록이 오므로(없는 class 를 remove) 시작 상태와 견주어 실제로 바뀐 것만 남긴다.
  let prev={open:el.classList.contains('open'),shown:el.classList.contains('rf-shown')};
  window.__obs=new MutationObserver(()=>{const ev={t:performance.now(),open:el.classList.contains('open'),shown:el.classList.contains('rf-shown')};if(prev.open!==ev.open||prev.shown!==ev.shown){prev=ev;window.__rec.events.push(ev);sample();let n=0;const tick=()=>{sample();if(++n<60)requestAnimationFrame(tick);};requestAnimationFrame(tick);}});
  window.__obs.observe(el,{attributes:true,attributeFilter:['class']});},SHEET);
 const recRead=()=>pg.evaluate(()=>window.__rec);
 const closeBtn=()=>pg.evaluate(s=>document.querySelector(s+' .rf-close').click(),SHEET);
 const toggle=kind=>pg.evaluate(k=>document.querySelector('[data-layer="'+k+'"]').click(),kind);

 // ── 1부: 시트 상태 기계(RiskSheet.hold·present·clear)를 가짜 타이머로 한 칸씩 — 0.2초·0.3초를 실제로 기다리지 않는다 ──
 await check('비교 원본 값: 해구기상 선택 '+ZONE.color+'·'+ZONE.width+'px, 해양종합정보 시트 '+oceanSheet[1]+' → '+oceanOpen[1]+' / '+oceanSheet[2],async()=>{
  const css=await pg.evaluate(s=>{const c=getComputedStyle(document.querySelector(s));return{tp:c.transitionProperty,td:c.transitionDuration,tf:c.transitionTimingFunction};},SHEET);
  const want=/transform\s+([\d.]+)s\s+(cubic-bezier\([^)]*\))/.exec(oceanSheet[2]);assert.ok(want,'해양종합정보 transition 을 읽지 못함 '+oceanSheet[2]);
  assert.equal(css.tp,'transform');assert.equal(css.td,want[1]+'s');assert.equal(css.tf.replace(/\s/g,''),want[2].replace(/\s/g,''));
  assert.equal(oceanSheet[1].trim(),'translateY(100%)');assert.equal(oceanOpen[1].trim(),'translateY(0)');
  const rfCss=fs.readFileSync(path.join(root,'client/js/marine-life/risk-forecast/risk_forecast.css'),'utf8');assert.ok(/\.rf-sheet \{ transform:translateY\(100%\);/.test(rfCss)&&/\.rf-sheet\.open \{ transform:translateY\(0\); \}/.test(rfCss),'위험예측 시트도 닫힘 100% ↔ 열림 0');
 });
 const unit=await pg.evaluate(()=>{
  // 페이지 안 가짜 타이머 — 이 한 번의 실행 동안만 바꾸고 되돌린다(다른 코드는 그 사이 돌지 않는다).
  const q=[];let now=0,id=0;const orig={st:window.setTimeout,ct:window.clearTimeout};
  window.setTimeout=(fn,ms)=>{q.push({id:++id,at:now+(ms||0),fn});return id;};window.clearTimeout=x=>{const i=q.findIndex(e=>e.id===x);if(i>=0)q.splice(i,1);};
  const advance=ms=>{const end=now+ms;for(;;){q.sort((a,b)=>a.at-b.at||a.id-b.id);if(!q.length||q[0].at>end)break;const e=q.shift();now=e.at;e.fn();}now=end;};
  const out={};
  try{
   const host=document.createElement('div');host.className='rf-sheet';host.id='unit-sheet';document.body.appendChild(host);
   const sh=RiskSheet.create(host,{close(){},hazard(){},basis(){},retry(){},choose(){}}),st=()=>({open:host.classList.contains('open'),shown:host.classList.contains('rf-shown'),body:host.querySelector('.rf-body').textContent.length>0});
   // ① 닫혀 있을 때: 0.2초 대기 → 199ms 아직 → 200ms 올라옴
   sh.hold(200);sh.loading({title:'A'});out.t0=st();advance(199);out.t199=st();advance(1);out.t200=st();
   // ② 열린 채 다른 지점: hold 는 아무것도 안 함 → 내용만 바뀜(내리지 않음)
   sh.hold(200);sh.loading({title:'B'});out.swap={...st(),title:host.querySelector('.rf-title').textContent};
   // ③ 닫기: .open 즉시 떨어짐(내려감)·그려짐·본문 유지 → 299ms 아직 → 300ms 정리(숨김·본문 비움)
   sh.clear();out.c0=st();advance(299);out.c299=st();advance(1);out.c300=st();
   // ④ 대기 0.2초 안에 다시 누름 → 마지막 누름부터 다시 0.2초(앞 예약 취소)
   sh.hold(200);sh.loading({title:'C'});advance(150);sh.hold(200);sh.loading({title:'D'});advance(60);out.re210=st();advance(139);out.re349=st();advance(1);out.re350={...st(),title:host.querySelector('.rf-title').textContent};
   // ⑤ 내려가는 중(150ms)에 다시 엶 → 정리 취소·그 자리에서 다시 위로, 300ms 지나도 숨지 않음
   sh.clear();advance(150);sh.hold(200);sh.loading({title:'E'});out.reopen=st();advance(400);out.reopen400={...st(),title:host.querySelector('.rf-title').textContent};
   // ⑥ 대기 중 닫기(토글 끔·탭 떠남·Escape 가 부르는 clear) → 예약 취소·바로 비움, 1초 지나도 안 올라옴
   sh.clear();advance(300);sh.hold(200);sh.loading({title:'F'});advance(100);sh.clear();out.cancel0=st();advance(1000);out.cancel1000=st();
   // ⑦ 대기 중 응답(show)·오류(error)가 먼저 와도 0.2초 전에는 안 올라옴
   sh.hold(200);sh.error('x');advance(100);out.err100=st();advance(100);out.err200=st();sh.clear();advance(300);
   host.remove();
  }finally{window.setTimeout=orig.st;window.clearTimeout=orig.ct;}
  return out;});
 await check('가짜 타이머: 닫힌 시트는 hold(200) 뒤 199ms 까지 안 보이고 200ms 에 올라옴',async()=>{
  assert.deepEqual(unit.t0,{open:false,shown:false,body:true},'누른 순간 — 내용은 채웠지만 숨김');assert.deepEqual(unit.t199,{open:false,shown:false,body:true});assert.deepEqual(unit.t200,{open:true,shown:true,body:true});
 });
 await check('가짜 타이머: 이미 열린 시트에서 다른 지점은 내리지 않고 내용만 바꿈(해양종합정보도 열린 채 내려갔다 올라오지 않음)',async()=>{assert.deepEqual(unit.swap,{open:true,shown:true,body:true,title:'B'});});
 await check('가짜 타이머: 닫기는 바로 내려가기 시작(.open 뗌)·내용은 내려가는 동안 그대로·300ms 에 숨기고 비움',async()=>{
  assert.deepEqual(unit.c0,{open:false,shown:true,body:true});assert.deepEqual(unit.c299,{open:false,shown:true,body:true});assert.deepEqual(unit.c300,{open:false,shown:false,body:false});
 });
 await check('가짜 타이머: 0.2초 안에 다시 누르면 마지막 것만 — 마지막 누름부터 다시 0.2초',async()=>{
  assert.equal(unit.re210.open,false,'첫 누름 기준 200ms 에 올라오면 안 됨');assert.equal(unit.re349.open,false);assert.deepEqual(unit.re350,{open:true,shown:true,body:true,title:'D'});
 });
 await check('가짜 타이머: 내려가는 도중 다시 열면 정리를 취소하고 그 자리에서 다시 올라옴',async()=>{
  assert.deepEqual(unit.reopen,{open:true,shown:true,body:true},'대기 없이 바로 .open');assert.deepEqual(unit.reopen400,{open:true,shown:true,body:true,title:'E'},'옛 300ms 정리가 새 시트를 숨기면 안 됨');
 });
 await check('가짜 타이머: 0.2초 대기 중 닫기(토글 끔·탭 떠남 경로)면 끝내 올라오지 않음',async()=>{
  assert.deepEqual(unit.cancel0,{open:false,shown:false,body:false});assert.deepEqual(unit.cancel1000,{open:false,shown:false,body:false});
 });
 await check('가짜 타이머: 대기 중 오류·응답이 먼저 와도 0.2초 전에는 안 올라옴',async()=>{assert.equal(unit.err100.open,false);assert.equal(unit.err200.open,true);});

 // ── 2부: 실제 지도 누르기·실제 움직임 ──
 await toggle('sea');await pg.waitForFunction(()=>map.getLayers().getArray().find(l=>l.getClassName()==='rf-marine-canvas').getSource().getFeatures().length>0);await pg.waitForTimeout(300);
 await check('해상 칸 누르기: 테두리는 그 자리에서 해구기상 선택과 같은 '+ZONE.color+'·'+ZONE.width+'px 실선, 시트는 아직 안 보임',async()=>{
  await rec();const [x,y]=await px(126.545,33.57);await pg.mouse.click(x,y);const c=await pg.evaluate(()=>window.__click);
  console.log('측정 해상 누른 순간',JSON.stringify(c));
  assert.equal(c.handled,true);assert.equal(c.shown,false);assert.equal(c.open,false);
  assert.deepEqual(c.sel,[{type:'Polygon',color:ZONE.color,width:ZONE.width,dash:null}]);
  await waitUp();const r=await recRead(),opened=r.events.find(e=>e.open);
  console.log('측정 해상 누른 뒤 올라오기 시작까지(ms)',Math.round(opened.t-c.at));
  assert.ok(opened.t-c.at>=190,'0.2초 대기 전에 올라옴: '+(opened.t-c.at));
  const ys=r.samples.filter(s=>s.t>=opened.t).map(s=>s.y),h=await pg.evaluate(s=>document.querySelector(s).offsetHeight,SHEET);
  console.log('측정 해상 올라오기 transform(px, 시트 높이 '+h+')',JSON.stringify(ys.slice(0,25).map(v=>Math.round(v))));
  assert.ok(Math.abs(ys[0]-h)<=1,'시작은 시트 높이만큼 아래: '+ys[0]);assert.ok(ys.some(v=>v>1&&v<h-1),'중간 프레임이 있어야 함(움직임)');assert.equal(ys[ys.length-1],0);
  for(let i=1;i<ys.length;i++)assert.ok(ys[i]<=ys[i-1]+.5,'위로만 움직여야 함 '+ys.slice(0,i+1));
  assert.ok((await pg.evaluate(s=>document.querySelector(s+' .rf-title').textContent,SHEET)).length>0);
 });
 await check('해상 시트 닫기(✕): 테두리 즉시 지움, 시트는 아래로 내려간 뒤 숨기고 내용 정리',async()=>{
  await rec();await closeBtn();const now=await pg.evaluate(s=>{const e=document.querySelector(s);return{open:e.classList.contains('open'),shown:e.classList.contains('rf-shown'),body:e.querySelector('.rf-body').textContent.length,sel:selStyles().length};},SHEET);
  assert.deepEqual([now.open,now.shown,now.sel],[false,true,0],'닫는 순간');assert.ok(now.body>0,'내려가는 동안 내용은 그대로');
  await waitGone();const r=await recRead(),h=await pg.evaluate(s=>document.querySelector(s).offsetHeight||0,SHEET);
  const ys=r.samples.filter(s=>!s.open&&s.shown).map(s=>s.y);console.log('측정 해상 내려가기 transform(px)',JSON.stringify(ys.slice(0,25).map(v=>Math.round(v))));
  assert.ok(ys.some(v=>v>1),'아래로 움직임이 있어야 함');for(let i=1;i<ys.length;i++)assert.ok(ys[i]>=ys[i-1]-.5,'아래로만 '+ys.slice(0,i+1));
  const gone=r.events.find(e=>!e.shown),closed=r.events.find(e=>!e.open);console.log('측정 닫기 시작→정리(ms)',Math.round(gone.t-closed.t));assert.ok(gone.t-closed.t>=290,'0.3초 움직임 전에 정리됨');
  assert.equal(await pg.evaluate(s=>document.querySelector(s+' .rf-body').innerHTML,SHEET),'');assert.equal(h,0);
 });
 await check('연안 관광지 누르기: 영역 테두리·중심 고리도 같은 '+ZONE.color+'·'+ZONE.width+'px(종전 흰 2.5px 대체)·0.2초 뒤 올라옴',async()=>{
  await rec();const [x,y]=await px(126.506,33.536);await pg.mouse.click(x,y);const c=await pg.evaluate(()=>window.__click);
  console.log('측정 연안 누른 순간',JSON.stringify(c));
  assert.equal(c.handled,true);assert.equal(c.shown,false);
  assert.deepEqual(c.sel,[{type:'Polygon',color:ZONE.color,width:ZONE.width,dash:null},{type:'Point',color:ZONE.color,width:ZONE.width,dash:null}]);
  await waitUp();const r=await recRead(),opened=r.events.find(e=>e.open);assert.ok(opened.t-c.at>=190,'0.2초 대기 전에 올라옴: '+(opened.t-c.at));
  assert.equal(await pg.evaluate(s=>document.querySelector(s+' .rf-title').textContent,SHEET),'가짜해변');
 });
 // T24(2026-10-16 사용자 「나. 무시」): 종전 「열린 시트에서 다른 칸 → 내용만 바꿈」을 해양종합정보처럼 「무시」로 바꿨다(ocean_map.js 「시트 열림 가드 — 사용자 합의 Q3」).
 await check('T24 「나. 무시」 열린 시트에서 지도의 다른 칸 누르기: 무시 — 테두리·제목·선택 그대로·상세 요청 없음·누름은 위험예측이 받음',async()=>{
  const before=await pg.evaluate(()=>({sel:selStyles(),selected:app.getState().selected})),n={...reqLog};
  await rec();const [x,y]=await px(126.545,33.57);await pg.mouse.click(x,y);const c=await pg.evaluate(()=>window.__click);
  assert.equal(c.handled,true,'누름은 위험예측이 받아 아래(해양종합정보 등)로 넘기지 않는다');assert.equal(c.open,true,'시트는 열린 그대로');
  assert.deepEqual(c.sel,before.sel,'테두리도 그대로(연안 영역·중심 고리)');await pg.waitForTimeout(500);
  assert.equal(await pg.evaluate(s=>document.querySelector(s+' .rf-title').textContent,SHEET),'가짜해변','제목 그대로');assert.deepEqual(await pg.evaluate(()=>app.getState().selected),before.selected,'선택 그대로');
  assert.deepEqual(reqLog,n,'상세 요청 없음');const r=await recRead();assert.deepEqual(r.events,[],'시트가 내려가거나 다시 그려지지 않음');assert.equal(await ty(),0);
  // 같은 관광지(이미 열린 것)를 다시 눌러도 마찬가지 — 같은 위치 관광지 선택 목록으로 바뀌지 않는다.
  const [cx,cy]=await px(126.506,33.536);await pg.mouse.click(cx,cy);assert.deepEqual((await pg.evaluate(()=>window.__click)).sel,before.sel);await pg.waitForTimeout(300);assert.deepEqual(reqLog,n);
 });
 await check('T24 「나. 무시」 예외: 열린 동안에도 지도 끌기·확대는 그대로 된다',async()=>{
  const v0=await pg.evaluate(()=>map.getView().getCenter().slice()),[x,y]=await px(126.52,33.47);
  await pg.mouse.move(x,y);await pg.mouse.down();await pg.mouse.move(x-80,y-40,{steps:8});await pg.mouse.up();await pg.waitForTimeout(200);
  const v1=await pg.evaluate(()=>map.getView().getCenter().slice());assert.ok(Math.hypot(v1[0]-v0[0],v1[1]-v0[1])>100,'끌어서 지도가 움직였다');
  const z0=await pg.evaluate(()=>map.getView().getZoom());await pg.mouse.move(x,y);await pg.mouse.wheel(0,-400);await pg.waitForFunction(z=>Math.abs(map.getView().getZoom()-z)>.1,z0);
  assert.equal(await pg.evaluate(s=>document.querySelector(s).classList.contains('open'),SHEET),true,'시트는 열린 그대로');
  await pg.evaluate(()=>{map.getView().setCenter(ol.proj.fromLonLat([126.525,33.49]));map.getView().setZoom(12.4);});await pg.waitForTimeout(300);
 });
 await check('닫는 도중 다시 누르기: 내려가다 그 자리에서 다시 올라오고 정리(숨김·비움)가 일어나지 않음',async()=>{
  await rec();await closeBtn();await pg.waitForFunction(()=>window.__rec.samples.filter(s=>!s.open&&s.y>1).length>=2);// 실제로 내려가기 시작한 뒤
  const mid=await ty();const [x,y]=await px(126.506,33.536);await pg.mouse.click(x,y);const c=await pg.evaluate(()=>window.__click);
  console.log('측정 닫는 중 다시 누름: 그때 위치(px)',Math.round(mid),JSON.stringify({open:c.open,shown:c.shown}));
  assert.ok(mid>0,'내려가는 중이어야 함');assert.equal(c.shown,true,'아직 그려져 있음');assert.equal(c.open,true,'대기 없이 곧바로 다시 위로');
  await waitUp();await pg.waitForTimeout(400);const r=await recRead();assert.ok(!r.events.some(e=>!e.shown),'옛 닫기 정리가 시트를 숨기면 안 됨 '+JSON.stringify(r.events));
  assert.equal(await pg.evaluate(s=>document.querySelector(s+' .rf-title').textContent,SHEET),'가짜해변');
 });
 await check('0.2초 안에 다른 곳을 누르면 마지막 것만 한 번 올라옴(앞 예약 취소)',async()=>{
  await closeBtn();await waitGone();await rec();
  await pg.evaluate(()=>{app.select('coast','S1');app.select('marine','GR4_F4K23_P4',{lon:126.545,lat:33.57});window.__sel2=selStyles();});
  assert.deepEqual((await pg.evaluate(()=>window.__sel2)).map(s=>s.type),['Polygon'],'테두리는 마지막 칸 하나');
  await waitUp();await pg.waitForFunction(s=>!document.querySelector(s).getAttribute('aria-busy'),SHEET);const r=await recRead();
  assert.equal(r.events.filter(e=>e.open).length,1,'한 번만 올라와야 함');assert.notEqual(await pg.evaluate(s=>document.querySelector(s+' .rf-title').textContent,SHEET),'가짜해변');
 });
 await check('T24 「나. 무시」 예외: 0.2초 대기 중(아직 열리지 않음) 지도의 다른 칸 누르기는 받아들여 마지막 것만 올라옴',async()=>{
  await closeBtn();await waitGone();await rec();
  const [cx,cy]=await px(126.506,33.536),[sx,sy]=await px(126.545,33.57);await pg.mouse.click(cx,cy);const a=await pg.evaluate(()=>window.__click);await pg.mouse.click(sx,sy);const b=await pg.evaluate(()=>window.__click);
  assert.equal(a.open,false,'첫 누름 뒤 아직 열리지 않음');assert.equal(b.handled,true);assert.deepEqual(b.sel.map(s=>s.type),['Polygon'],'둘째 누름(해상 칸)의 테두리로 바뀜');
  await waitUp();await pg.waitForFunction(s=>!document.querySelector(s).getAttribute('aria-busy'),SHEET);const r=await recRead();
  assert.equal(r.events.filter(e=>e.open).length,1,'한 번만 올라옴');assert.notEqual(await pg.evaluate(s=>document.querySelector(s+' .rf-title').textContent,SHEET),'가짜해변','마지막 누름(해상)의 시트');
  assert.equal(await pg.evaluate(()=>app.getState().selected.kind),'marine');
 });
 await check('0.2초 대기 중 토글을 끄면 시트는 끝내 올라오지 않고 테두리도 지워짐',async()=>{
  await closeBtn();await waitGone();await rec();
  const s=await pg.evaluate(()=>{app.select('coast','S1');const before=selStyles().length;document.querySelector('[data-layer="coast"]').click();return{before,after:selStyles().length};});
  assert.deepEqual(s,{before:2,after:0});await pg.waitForTimeout(600);// 0.2초의 세 배 — 그 사이 한 번이라도 그려지면 아래가 잡는다
  const r=await recRead();assert.deepEqual(r.events,[],'시트가 그려지면 안 됨 '+JSON.stringify(r.events));
  await toggle('coast');await pg.waitForFunction(()=>map.getLayers().getArray().find(l=>l.getClassName()==='rf-points-canvas').getSource().getFeatures().length>0);
 });
 await check('0.2초 대기 중 위험예측을 끄면(탭 떠남과 같은 setEnabled(false)) 올라오지 않음',async()=>{
  await rec();await pg.evaluate(()=>{app.select('coast','S1');app.setEnabled(false);});await pg.waitForTimeout(600);
  const r=await recRead();assert.deepEqual(r.events,[]);assert.equal(await pg.evaluate(()=>selStyles().length),0);
  await pg.evaluate(()=>app.setEnabled(true));await pg.evaluate(()=>app.synced());await pg.waitForFunction(()=>map.getLayers().getArray().find(l=>l.getClassName()==='rf-marine-canvas').getSource().getFeatures().length>0);
 });
 await check('움직임 줄이기(prefers-reduced-motion) — 해양종합정보 시트에는 없는 규칙을 더함: transition 0s, 열리면 바로 제자리',async()=>{
  await pg.emulateMedia({reducedMotion:'reduce'});await rec();
  const td=await pg.evaluate(s=>getComputedStyle(document.querySelector(s)).transitionDuration,SHEET);assert.equal(td,'0s');
  await pg.evaluate(()=>app.select('coast','S1'));await pg.waitForFunction(s=>document.querySelector(s).classList.contains('open'),SHEET);
  const r=await recRead(),first=r.samples.find(s=>s.open);assert.equal(first.y,0,'첫 그림부터 제자리여야 함');
  assert.equal(await pg.evaluate(s=>document.querySelector(s).getAnimations().length,SHEET),0);
  const h=await pg.evaluate(s=>document.querySelector(s).offsetHeight,SHEET);await closeBtn();const y=await ty();assert.ok(Math.abs(y-h)<=1,'닫으면 움직임 없이 바로 아래: '+y+' / '+h);await waitGone();
  await pg.emulateMedia({reducedMotion:'no-preference'});
 });
 // 화면 사진(판정에 쓰지 않음): 누른 순간(테두리만)·올라오는 중간·다 올라옴 — 실제 transition 을 멈춰 그 프레임을 찍는다.
 if(SHOTS)for(const [name,lon,lat,kind,id] of [['sea',126.545,33.57,'marine','GR4_F4K23_P4'],['coast',126.506,33.536,'coast','S1']]){
  if(await pg.evaluate(s=>document.querySelector(s).classList.contains('rf-shown'),SHEET)){await closeBtn();await waitGone();}
  await pg.evaluate(()=>{map.getView().setCenter(ol.proj.fromLonLat([126.525,33.49]));map.getView().setZoom(12.4);});await pg.waitForTimeout(400);
  await pg.evaluate(s=>{const el=document.querySelector(s);window.__pause=new MutationObserver(()=>{if(!el.classList.contains('open'))return;window.__pause.disconnect();const a=el.getAnimations().find(a=>a.transitionProperty==='transform');if(a){a.pause();a.currentTime=0;window.__anim=a;}});window.__pause.observe(el,{attributes:true,attributeFilter:['class']});},SHEET);
  const [x,y]=await px(lon,lat);await pg.mouse.click(x,y);await pg.waitForFunction(()=>window.__anim);await pg.waitForTimeout(150);
  await pg.screenshot({path:path.join(SHOTS,name+'_selected_380.png')});
  for(const ms of [90,150]){await pg.evaluate(ms=>{window.__anim.currentTime=ms;},ms);await pg.waitForTimeout(120);await pg.screenshot({path:path.join(SHOTS,name+'_rising_'+ms+'ms_380.png')});}
  await pg.evaluate(()=>{window.__anim.play();window.__anim=null;});await waitUp();await pg.waitForTimeout(200);await pg.screenshot({path:path.join(SHOTS,name+'_open_380.png')});
  console.log('사진',name,'→',SHOTS);
 }
 await check('실행 오류 없음',async()=>{assert.deepEqual(errors,[]);});
}catch(e){console.error('❌ 실행 실패',e.stack||e.message);fail++;}
finally{if(browser)await browser.close();if(server)server.close();fs.rmSync(dir,{recursive:true,force:true});console.log(pass+' PASS / '+fail+' FAIL');process.exit(fail?1:0);}})();
