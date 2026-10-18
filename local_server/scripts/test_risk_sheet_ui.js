/**
 * 파일명: local_server/scripts/test_risk_sheet_ui.js
 * 역할  : 휴대폰 크기 Chromium에서 위험예측 바텀시트의 하단 탭 가림 방지·고정 머리/스크롤 본문·즉시 스켈레톤과 늦은 응답 보호·고정 일시 표시·위험구역 아코디언과 보이는 지도 중앙 이동을 검사한다.
 *         2026-10-16 T8: 머리 부제 줄 오른쪽 끝 [기준 상세], (T7 연안 시각 막대는 T24 로 없앰 — 대신 연안 날짜 줄: 해양종합정보 시트 같은 < 날짜 >·「가장 높은 때 HH시 기준」·시트↔메인 날짜 함께),
 *         기준 상세 창(제목·닫기 고정 머리, 「기준 상세 — 」 없음, 링크·PDF 버튼 글자 대비 4.5:1 이상). RISK_SHEET_SHOTS=<폴더> 를 주면 380·320px 사진을 남긴다.
 * [연계] 실제 risk_forecast/sheet/slider/map_layer/format/marine + risk_forecast.css + index2.html의 --ls-bottom-chrome 규칙 / HTTP 가짜 API → verify_all.
 * [로드 순서] 독립 검사; 외부 수집·운영 키 없음. 측정값은 「측정」 줄로 남긴다.
 */
'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert'),express=require('express'),{chromium}=require('playwright-core');
const root=path.join(__dirname,'../..'),scorer=require('../services/risk_score');
let pass=0,fail=0;
/** 실제 브라우저 결과를 검사한다. 예: 위치·스크롤 값을 직접 측정한다. @param {string} name 사례 @param {function} fn 검사 @returns {Promise<void>} [연계] ← 아래 시나리오 / 실패를 모아 요약한다. */
async function check(name,fn){try{await fn();console.log('✅',name);pass++;}catch(e){console.error('❌',name,e.message);fail++;}}
const now='2026-10-15T15:00:00+09:00',later='2026-10-15T18:00:00+09:00',latest='2026-10-15T21:00:00+09:00';
const index=fs.readFileSync(path.join(root,'client/index2.html'),'utf8');
const chromeRules=[/body\.ls-mode\.ls-safety \{ --ls-bottom-chrome:[^}]*\}/,/body\.ls-mode\.ls-safety\.sub-tabs-open \{[^}]*\}/].map(re=>{const m=index.match(re);if(!m)throw Error('index2.html의 --ls-bottom-chrome 규칙을 찾지 못함: '+re);return m[0];}).join('\n');
// 연안 상세: 실제 점수 계산기로 만든 요소 + 위험구역 12곳(긴 목록). 행사 이름에 id와 시각을 넣어 엉뚱한 응답이 섞이면 드러나게 한다.
// U81(2026-10-15): 위험구역 점수는 구역 종류로 세므로 계산기 입력에 종류를 넣고(표시용 zones 는 아래에서 바꿔 끼움), 사람은 30일 평균과 함께 준다.
const coastInput={t:now,now,spot:{hazard:{count:12,zones:Array.from({length:12},(_,i)=>({id:'z'+i,'구역분류':'연안사고 위험구역'}))}},concentration:90.52,concentrationBase:{gm:30,days:30},events:[],swell:{periodS:8}};
const scored=scorer.scoreCoast(coastInput),scoredRows=scored.factors.map(r=>({...r,key:r.key==='concentration'?'people':r.key}));
const zones=Array.from({length:12},(_,i)=>({id:'z'+i,place:'위험구역'+i,shape:'갯바위',class:'연안사고 위험구역',addr:'부산 수영구 광안로 '+(100+i),police:'광안리'}));
const spots=[{i:0,id:'a',name:'광안리해수욕장',lat:35.153,lon:129.118},{i:1,id:'b',name:'해운대해수욕장',lat:35.159,lon:129.16}].map(p=>({...p,sggName:'부산',police:{name:'광안리'},geometry:{type:'Polygon',coordinates:[[[p.lon-.004,p.lat-.004],[p.lon+.004,p.lat-.004],[p.lon+.004,p.lat+.004],[p.lon-.004,p.lat+.004],[p.lon-.004,p.lat-.004]]]}}));
/** 지점 id와 시각이 본문에 드러나는 연안 상세를 만든다. 예: detail('a',later). @param {string} id 지점 @param {string} t 시트 시각 @returns {object} 상세 응답 [연계] ← 가짜 API */
// T24(2026-10-16): 연안 상세는 날짜당 하나 — 서버가 그날 가장 높은 칸(daily.peakAt)을 준다(종전 T7 outlook 은 없앰). 오늘(10-15)은 18시, 내일(10-16)은 03시가 가장 높은 칸.
const TOMORROW='2026-10-16T00:00:00+09:00',DAILY={'2026-10-15':{date:'2026-10-15',peakAt:later,times:[now,later,latest]},'2026-10-16':{date:'2026-10-16',peakAt:'2026-10-16T03:00:00+09:00',times:[TOMORROW]}};
// T9(2026-10-16): 연안 상세 history(주변 연안사고). a 는 5유형 7건(기타 포함·사망 1·실종 1), b 는 0건. FIX 로 시나리오마다 바꾼다(바꾼 뒤 fresh() — 응답 캐시).
const ACC_A=[{date:'2024-07-26',year:2024,type:'익수',death:1,missing:0,rescue:0},{date:'2023-08-01',year:2023,type:'익수',death:0,missing:0,rescue:2},{date:'2022-05-03',year:2022,type:'추락',death:0,missing:1,rescue:0},{date:'2021-09-10',year:2021,type:'고립',death:0,missing:0,rescue:3},{date:'2020-07-15',year:2020,type:'표류',death:0,missing:0,rescue:1},{date:'2020-06-02',year:2020,type:'기타',death:0,missing:0,rescue:1},{date:'2022-08-20',year:2022,type:'익수',death:0,missing:0,rescue:1}];
const FIX={history:{a:{available:true,from:'2020-01-01',to:'2024-12-31',area:'이 관광지 구역과 앞바다 500m',accidents:ACC_A},b:{available:true,from:'2020-01-01',to:'2024-12-31',area:'이 관광지 구역과 앞바다 500m',accidents:[]}},score:{}};
function detail(id,t){const spot=spots.find(p=>p.id===id),sc=FIX.score[id]||{score:scored.score,index:scored.index,band:scored.band};return{t,title:spot.name,subtitle:{lat:spot.lat,lon:spot.lon,police:'광안리',office:'부산해양경찰서'},history:FIX.history[id],daily:DAILY[t.slice(0,10)],score:sc.score,index:sc.index,band:sc.band,rr:scored.rr,fatalRr:scored.fatalRr,notices:[{key:'warning',effective:['풍랑주의보'],prelim:[]},{key:'drift',windMs:9}],missing:[],inputs:{},rows:scoredRows.map(r=>r.key==='hazard'?{...r,zones}:r).concat([{key:'event',name:'행사 '+id+'@'+t,weekend:true,rr:1.2,events:[]}])};}
/** 앱과 같은 층 구조의 휴대폰 화면 HTML을 만든다. 지도 섹션(z50)·하단 탭(z60)·서브탭을 같은 쌓임으로 둔다. @returns {string} HTML [연계] ← app.get('/') */
function page(){return '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/vendor/ol/ol.css"><link rel="stylesheet" href="/js/marine-life/risk-forecast/risk_forecast.css"><style>'+
 ':root{--main-tab-height:68px;--sub-tab-height:50px}body{margin:0;background:#10223d;color:white}'+chromeRules+
 '#ocean-map-section{position:fixed;top:0;left:0;right:0;bottom:0;z-index:50;overflow:hidden;background:#0c1a3a}body.sub-tabs-open #ocean-map-section{bottom:calc(var(--main-tab-height) + var(--sub-tab-height))}.ocean-map-wrapper{position:absolute;inset:0;overflow:hidden}#map{width:100%;height:100%}'+
 '#tabs{position:fixed;left:0;right:0;bottom:0;box-sizing:border-box;height:68px;z-index:60;background:#263f65}#tabs.safe{height:102px;padding-bottom:34px}#subtabs{position:fixed;left:0;right:0;bottom:var(--main-tab-height);height:50px;z-index:59;background:#31507f;display:none}body.sub-tabs-open #subtabs{display:block}#risk-forecast-legend{position:absolute;top:10px;left:10px}'+
 '</style></head><body class="ls-mode ls-safety"><section id="ocean-map-section"><div class="ocean-map-wrapper"><div id="map"></div><div id="risk-forecast-legend" class="rf-legend"></div><div class="rf-banner" id="risk-forecast-banner" hidden></div><div class="rf-sheet" id="risk-forecast-sheet" role="region"></div></div></section><div id="subtabs">서브탭</div><nav id="tabs">메인 탭</nav>'+
 ['assets/vendor/ol/ol.js','js/core/backbutton.js',...['risk_format','risk_api','risk_map_layer','risk_slider','risk_marine','risk_sheet','risk_basis_content','risk_basis','risk_forecast'].map(s=>'js/marine-life/risk-forecast/'+s+'.js')].map(s=>'<script src="/'+s+'"></script>').join('')+
 '<script>window.map=new ol.Map({target:"map",view:new ol.View({center:ol.proj.fromLonLat([129.14,35.156]),zoom:13})});window.setTabs=function(safe){document.getElementById("tabs").classList.toggle("safe",!!safe);document.documentElement.style.setProperty("--main-tab-height",document.getElementById("tabs").offsetHeight+"px");};window.app=RiskForecast.mount({map:map,legendEl:document.getElementById("risk-forecast-legend"),sheetEl:document.getElementById("risk-forecast-sheet"),bannerEl:document.getElementById("risk-forecast-banner")});</script></body></html>';}
(async()=>{let browser,server;try{
 const holds=new Map(),failures=new Set(),requests=[];
 /** 특정 상세 응답을 붙잡아 두었다가 나중에 보낸다. 예: hold('a|'+later). @param {string} key 지점|시각 @returns {function} 보내기 [연계] ← 늦은 응답 시나리오 */
 function hold(key){let release;const p=new Promise(r=>{release=r;});holds.set(key,p);return()=>{holds.delete(key);release();};}
 const app=express();app.get('/',(req,res)=>res.send(page()));app.use(express.static(path.join(root,'client')));
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 browser=await chromium.launch({...((process.env.PW_CHROME||process.env.SIM_CHROMIUM||process.env.CHROMIUM_EXECUTABLE)?{executablePath:process.env.PW_CHROME||process.env.SIM_CHROMIUM||process.env.CHROMIUM_EXECUTABLE}:{}),headless:true,args:['--no-sandbox']});
 const browserPage=await browser.newPage({viewport:{width:412,height:915}}),errors=[];browserPage.on('pageerror',e=>errors.push(e.message));
 const pg=browserPage;
 await pg.route('**/api/**',async route=>{
  const url=new URL(route.request().url()),name=url.pathname.replace(/^\/api\/(risk-forecast\/)?/,''),q=Object.fromEntries(url.searchParams),json=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  requests.push({name,q});
  if(name==='meta')return json({now,versions:{spots:'v1',cells:0,accident:null},sources:{},timeline:{coast:{stepH:3,times:[now,later,latest,'2026-10-16T00:00:00+09:00']},sea:{times:[now]},accident:{times:[]}}});
  if(name==='coast/spots')return json({v:'v1',spots});
  if(name==='coast/frame')return json({spots:[[0,1.2],[1,2.5]],borders:[],sources:{}});
  if(name==='coast/spot'){const key=q.id+'|'+q.t;if(holds.has(key))await holds.get(key);if(failures.has(key))return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({ok:false,error:'서버 오류'})});return json(detail(q.id,q.t));}
  if(name==='hazard-zones'){const f=zones.filter(z=>q.ids.split(',').includes(z.id)).map((z,k)=>({type:'Feature',properties:{name:z.id},geometry:{type:'Polygon',coordinates:[[[129.12+k*.001,35.14],[129.1215+k*.001,35.14],[129.1215+k*.001,35.1415],[129.12+k*.001,35.1415],[129.12+k*.001,35.14]]]}}));return json({type:'FeatureCollection',features:f});}
  if(name==='islands'||name==='warn-zones'||name==='warn-zones-sub')return json({features:[]});
  if(name==='ocean/land-mask')return json({rings:[]});
  return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({ok:false,error:'가짜 API에 없음 '+name})});
 });
 await pg.goto('http://127.0.0.1:'+server.address().port);
 if(!await pg.evaluate(()=>!!window.app))throw Error('초기화 실패: '+errors.join(' / '));
 await pg.evaluate(()=>app.ready);
 const rect=sel=>pg.evaluate(s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height};},sel);
 /** 시트가 다 올라왔는지 — .open 이고 계산된 transform 이 제자리(올라오는 0.3초 동안은 중간값). 시간을 재지 않고 실제 움직임이 끝나기를 기다린다(2026-10-16 시트 애니메이션).
  * 예: await waitUp() · waitUp('#long-sheet'). @param {string} [sel] 시트 @returns {Promise<void>} [연계] ← waitTitle·브리핑 시나리오 */
 const waitUp=(sel='#risk-forecast-sheet')=>pg.waitForFunction(s=>{const e=document.querySelector(s);if(!e||!e.classList.contains('open'))return false;const t=getComputedStyle(e).transform;return t==='none'||t==='matrix(1, 0, 0, 1, 0, 0)';},sel);
 const waitTitle=async title=>{await pg.waitForFunction(t=>document.querySelector('#risk-forecast-sheet .rf-title').textContent===t&&document.querySelector('#risk-forecast-sheet .rf-index'),title);await waitUp();};
 /** 시트를 닫고 새로 연다. 예: open('a'). @param {string} id 지점 @returns {Promise<void>} [연계] ← 시나리오 */
 async function open(id){await pg.evaluate(i=>app.select('coast',i),id);await waitTitle(spots.find(p=>p.id===id).name);}
 /** 하단 탭 상태를 바꾼다. 예: tabs({sub:true}). @param {object} o sub=서브탭 열림, safe=아래 여백 포함 @returns {Promise<void>} [연계] ← 가림 시나리오 */
 async function tabs(o){await pg.evaluate(o=>{document.body.classList.toggle('sub-tabs-open',!!o.sub);setTabs(o.safe);},o);}
 /** 본문 끝까지 스크롤한 뒤 가림 여부를 측정한다. 예: scrollEnd('#risk-forecast-sheet'). @param {string} sel 시트 @returns {Promise<object>} 측정값 [연계] ← 과제5·7 */
 const scrollEnd=sel=>pg.evaluate(s=>{const sheet=document.querySelector(s),body=sheet.querySelector('.rf-body'),head=sheet.querySelector('.rf-sheet-head'),close=sheet.querySelector('.rf-close'),before=head.getBoundingClientRect().top,closeBefore=close.getBoundingClientRect().top;body.scrollTop=body.scrollHeight;const last=body.lastElementChild,lr=last.getBoundingClientRect(),sr=sheet.getBoundingClientRect(),tabTop=Math.min(...['#tabs','#subtabs'].map(q=>document.querySelector(q)).filter(e=>getComputedStyle(e).display!=='none').map(e=>e.getBoundingClientRect().top)),probe=document.elementFromPoint(lr.left+lr.width/2,lr.bottom-2);const cr=close.getBoundingClientRect();return{scrollable:body.scrollHeight>body.clientHeight,scrolled:body.scrollTop,headMoved:head.getBoundingClientRect().top-before,closeMoved:cr.top-closeBefore,closeVisible:cr.top>=sr.top&&cr.bottom<=sr.top+head.offsetHeight,sheetBottom:sr.bottom,tabTop,lastBottom:lr.bottom,lastCovered:!sheet.contains(probe),bodyClient:body.clientHeight,headHeight:head.offsetHeight,sheetTop:sr.top};},sel);
 await check('상세는 고정 머리와 스크롤 본문으로 나뉨(서브탭 닫힘)',async()=>{
  await open('a');await tabs({});
  const before=await rect('#risk-forecast-sheet .rf-sheet-head'),r=await scrollEnd('#risk-forecast-sheet');console.log('측정 서브탭 닫힘 412x915',JSON.stringify(r));
  assert.ok(r.scrollable,'본문이 스크롤될 만큼 길어야 함');assert.ok(r.scrolled>0);assert.equal(r.headMoved,0,'머리가 스크롤과 함께 움직임');assert.equal(r.closeMoved,0,'닫기 버튼이 스크롤로 움직임');assert.ok(r.closeVisible,'닫기 버튼이 머리 밖');
  assert.ok(Math.abs(r.sheetBottom-r.tabTop)<=.5,'시트 하단 '+r.sheetBottom+' 탭 상단 '+r.tabTop);assert.ok(r.lastBottom<=r.sheetBottom+.5&&!r.lastCovered,'마지막 내용이 가려짐 '+JSON.stringify(r));
  assert.ok(before.height>60);
 });
 await check('서브탭이 열려도 시트는 서브탭 바로 위(이중 여백 없음)',async()=>{
  await tabs({sub:true});const r=await scrollEnd('#risk-forecast-sheet');console.log('측정 서브탭 열림',JSON.stringify(r));
  assert.ok(Math.abs(r.sheetBottom-r.tabTop)<=.5,'시트 하단 '+r.sheetBottom+' 서브탭 상단 '+r.tabTop);assert.equal(r.tabTop,915-68-50);assert.ok(!r.lastCovered);
 });
 await check('아이폰 아래 여백이 있는 탭(102px)에서도 마지막 내용까지 보임',async()=>{
  await tabs({safe:true});const r=await scrollEnd('#risk-forecast-sheet');console.log('측정 safe-area 탭 102px',JSON.stringify(r));
  assert.equal(r.tabTop,915-102);assert.ok(Math.abs(r.sheetBottom-r.tabTop)<=.5);assert.ok(!r.lastCovered&&r.lastBottom<=r.sheetBottom+.5);
  await tabs({sub:true,safe:true});const s=await scrollEnd('#risk-forecast-sheet');assert.equal(s.tabTop,915-102-50);assert.ok(Math.abs(s.sheetBottom-s.tabTop)<=.5);assert.ok(!s.lastCovered);
  await tabs({});
 });
 await check('작은 화면(320x568)에서도 머리 아래 본문이 스크롤 영역을 가짐',async()=>{
  await pg.setViewportSize({width:320,height:568});const r=await scrollEnd('#risk-forecast-sheet'),sheet=await rect('#risk-forecast-sheet');console.log('측정 320x568',JSON.stringify(r));
  assert.ok(r.bodyClient>=120,'본문 높이 '+r.bodyClient);assert.ok(r.sheetTop>=0);assert.ok(sheet.height<=(568-68)*.66+1);assert.ok(r.scrollable&&!r.lastCovered&&r.closeMoved===0);await pg.setViewportSize({width:412,height:915});
 });
 await check('해상 상세·관할 브리핑 같은 긴 내용도 같은 고정 머리·탭 위 배치',async()=>{
  await pg.evaluate(()=>document.querySelector('#risk-forecast-sheet .rf-close').click());
  const r=await pg.evaluate(()=>{
   const host=document.createElement('div');host.className='rf-sheet';host.id='long-sheet';document.querySelector('.ocean-map-wrapper').appendChild(host);const sheet=RiskSheet.create(host,{close(){},hazard(){},basis(){},retry(){},choose(){}});
   const regions=Array.from({length:20},(_,i)=>({location:'제주항 북서방 '+i+'해리 해역',attention:'주의',point:{lon:126.5,lat:33.5},reasons:[{text:'근거 '+i+' 문장입니다. 최근 선박 사고와 현재 교통량을 함께 본 설명입니다.',at:'2026-10-15T15:00:00+09:00'},{text:'두 번째 근거 '+i}]}));
   sheet.show({station:{name:'제주'},t:'2026-10-15T15:00:00+09:00',current:{count:120,gridCount:30,types:[{name:'어선',count:80}],status:'ok',collectedAt:'2026-10-15T14:50:00+09:00'},history:{available:true,from:'2023',to:'2026',count:10,death:1,missing:0,topTypes:[{type:'충돌',count:4}],weatherCause:2},method:'집계 방법',totalAttentionRegions:20,regions},'briefing',{});
   return true;});
  assert.ok(r);await waitUp('#long-sheet');const m=await scrollEnd('#long-sheet');console.log('측정 브리핑 20개 해역',JSON.stringify(m));
  assert.ok(m.scrollable&&m.headMoved===0&&m.closeMoved===0&&m.closeVisible);assert.ok(Math.abs(m.sheetBottom-m.tabTop)<=.5);assert.ok(!m.lastCovered);
  await pg.evaluate(()=>document.getElementById('long-sheet').remove());
 });
 // T24(2026-10-16 「5-하루 하나로 합치기. 해당구역을 클릭하면 해양종합정보의 바텀시트처럼 일 시 왼쪽 오른쪽에 < > 버튼 만들어서 넘길 수 있도록.」):
 //   종전 과제8(연안 시트 슬라이더 위 고정 일시)·시트 시각 격리 사례를 연안 날짜 줄 사례로 바꿨다 — 과제8·시각 격리는 해상 시트에 그대로(test_risk_main_time·test_risk_sea_sheet_ui).
 /** 연안 시트 날짜 줄을 누른다. 예: day(1) → > . @param {number} d -1·1 @returns {Promise<void>} [연계] ← T24 사례 */
 const day=d=>pg.evaluate(d=>document.querySelector('#risk-forecast-sheet [data-sheet-day="'+d+'"]').click(),String(d));
 const dayRow=()=>pg.evaluate(()=>{const tl=document.querySelector('#risk-forecast-sheet .rf-timeline');return{hidden:tl.hidden,date:(tl.querySelector('[data-sheet-date]')||{}).textContent,peak:(tl.querySelector('[data-sheet-peak]')||{}).textContent,prev:tl.querySelector('[data-sheet-day="-1"]').disabled,next:tl.querySelector('[data-sheet-day="1"]').disabled,slider:tl.querySelectorAll('input[type="range"]').length,label:tl.querySelectorAll('.rf-time-label').length,stTrack:tl.querySelectorAll('.rf-st-track').length,bubbles:document.querySelectorAll('.ocean-sheet-tooltip').length,top:document.querySelector('.rf-date-nav [data-day-label]').textContent};});
 await check('T24 연안 시트: 시각 막대 대신 날짜 줄 < \'26. 10. 15.(목) > ·둘째 줄 「가장 높은 때 18시 기준」·오늘이면 < 비활성, 연안 시각 막대·말풍선 없음',async()=>{
  await open('a');const r=await dayRow();console.log('측정 T24 연안 날짜 줄',JSON.stringify(r));
  assert.deepEqual(r,{hidden:false,date:"'26. 10. 15.(목)",peak:'가장 높은 때 18시 기준',prev:true,next:false,slider:0,label:0,stTrack:0,bubbles:0,top:'10월 15일 (목)'});
  assert.ok(requests.filter(x=>x.name==='coast/spot').every(x=>x.q.t===now),'오늘은 지금(첫 칸) 시각으로 요청');
 });
 await check('T24 시트 > → 내일(내일 00시로 요청)·상단 날짜 줄도 내일·> 비활성 — 시트 < → 오늘, 닫고 다른 지점도 메인 날짜로 시작',async()=>{
  await day(1);await pg.waitForFunction(t=>document.querySelector('#risk-forecast-sheet .rf-body').textContent.includes('@'+t),TOMORROW);
  let r=await dayRow();assert.deepEqual([r.date,r.peak,r.prev,r.next,r.top],["'26. 10. 16.(금)",'가장 높은 때 03시 기준',false,true,'10월 16일 (금)'],'시트에서 넘기면 상단 날짜도 함께');
  assert.equal(await pg.evaluate(()=>app.getState().t),TOMORROW,'메인 시각 = 내일 첫 칸(00시) — 연안만이면 항행경보처럼 「그 외 날짜는 00:00」');
  await pg.evaluate(()=>document.querySelector('#risk-forecast-sheet .rf-close').click());await open('b');
  r=await dayRow();assert.deepEqual([r.date,r.prev,r.next],["'26. 10. 16.(금)",false,true],'다른 지점도 메인 날짜(내일)로 시작');assert.equal(requests.filter(x=>x.name==='coast/spot').at(-1).q.t,TOMORROW);
  await day(-1);await pg.waitForFunction(t=>document.querySelector('#risk-forecast-sheet .rf-body').textContent.includes('@'+t),now);
  r=await dayRow();assert.deepEqual([r.date,r.peak,r.prev,r.next,r.top],["'26. 10. 15.(목)",'가장 높은 때 18시 기준',true,false,'10월 15일 (목)']);assert.equal(await pg.evaluate(()=>app.getState().t),now,'오늘로 돌아오면 지금');
 });
 // ── 과제6: 즉시 시트 열기(회색 틀)와 늦은 응답 보호. 응답 캐시(60초)를 피하려고 시나리오마다 새로 불러온다. ──
 /** 페이지를 새로 불러와 앱을 다시 올린다(API 응답 캐시 초기화). 예: await fresh(). @returns {Promise<void>} [연계] ← 과제6 시나리오 */
 async function fresh(){await pg.reload();await pg.evaluate(()=>app.ready);}
 const sheetState=()=>pg.evaluate(()=>{const el=document.getElementById('risk-forecast-sheet');return{open:el.classList.contains('open'),busy:el.getAttribute('aria-busy'),skeleton:!!el.querySelector('.rf-skeleton'),title:el.querySelector('.rf-title').textContent,body:el.querySelector('.rf-body').textContent,rows:el.querySelectorAll('.rf-row').length,index:!!el.querySelector('.rf-index'),stack:Array.from(PopupStack.list()),bottom:el.getBoundingClientRect().bottom};});
 await check('지점을 누르면 응답 전에 시트가 열리고 회색 틀과 그 지점 이름만 보임',async()=>{
  await fresh();const release=hold('a|'+now);await pg.evaluate(()=>app.select('coast','a'));
  await waitUp();const st=await sheetState();console.log('측정 응답 대기 중 시트',JSON.stringify({open:st.open,skeleton:st.skeleton,title:st.title,bottom:st.bottom,stack:st.stack}));
  assert.ok(st.open&&st.skeleton&&st.busy==='true');assert.equal(st.title,'광안리해수욕장');assert.equal(st.rows,0);assert.ok(!st.index);assert.deepEqual(st.stack,['risk-forecast-sheet']);assert.equal(st.bottom,847);
  assert.deepEqual(await pg.evaluate(()=>[document.querySelectorAll('#risk-forecast-sheet [data-sheet-day]').length,document.querySelector('#risk-forecast-sheet [data-sheet-date]').textContent,document.querySelector('#risk-forecast-sheet [data-sheet-peak]').textContent]),[2,"'26. 10. 15.(목)",''],'응답 전에도 날짜 줄은 보이고(T24), 가장 높은 칸은 응답 뒤에');
  release();await waitTitle('광안리해수욕장');const done=await sheetState();assert.ok(!done.skeleton&&done.busy===null&&done.rows>3);
 });
 await check('응답을 기다리는 동안 다른 지점을 누르면 늦게 온 먼저 누른 지점의 응답은 화면에 나오지 않음',async()=>{
  await fresh();const release=hold('a|'+now);await pg.evaluate(()=>{app.select('coast','a');app.select('coast','b');});await waitTitle('해운대해수욕장');
  release();await pg.waitForTimeout(300);const st=await sheetState();assert.equal(st.title,'해운대해수욕장');assert.ok(st.body.includes('행사 b@'+now)&&!st.body.includes('행사 a@'),'엉뚱한 지점 내용');
 });
 // T24: 종전 「시트 시각을 바꾸면 …」(연안 슬라이더)을 연안 날짜 넘기기로 바꿨다 — 같은 늦은 응답 보호(detail 의 세대·요청 시각 검사).
 await check('응답을 기다리는 동안 날짜를 넘기면 회색 틀을 다시 보이고, 다시 돌아온 뒤 늦게 온 앞 날짜 응답은 나오지 않음',async()=>{
  await fresh();await open('a');const release=hold('a|'+TOMORROW);await day(1);
  const st=await sheetState();assert.ok(st.skeleton&&st.title==='광안리해수욕장'&&st.rows===0,'날짜 변경 직후 회색 틀 '+JSON.stringify({skeleton:st.skeleton,rows:st.rows}));assert.equal((await dayRow()).date,"'26. 10. 16.(금)");assert.equal((await dayRow()).peak,'','옛 날짜의 「가장 높은 때」를 남기지 않음');
  await day(-1);await pg.waitForFunction(t=>document.querySelector('#risk-forecast-sheet .rf-body').textContent.includes('@'+t),now);
  release();await pg.waitForTimeout(300);const end=await sheetState();assert.ok(end.body.includes('@'+now)&&!end.body.includes('@'+TOMORROW),'늦게 온 내일 응답이 섞임');assert.equal(await pg.evaluate(()=>app.getState().t),now);assert.equal((await dayRow()).peak,'가장 높은 때 18시 기준');
 });
 await check('응답을 기다리는 동안 시트를 닫으면 늦은 응답이 시트를 다시 열지 않음',async()=>{
  await fresh();const release=hold('a|'+now);await pg.evaluate(()=>app.select('coast','a'));await pg.evaluate(()=>document.querySelector('#risk-forecast-sheet .rf-close').click());
  release();await pg.waitForTimeout(400);await pg.waitForFunction(()=>!document.getElementById('risk-forecast-sheet').classList.contains('rf-shown'));/* 내려가기(0.3초)가 끝나야 본문을 비운다 — 2026-10-16 */const st=await sheetState();assert.ok(!st.open&&st.body===''&&!st.busy);assert.deepEqual(st.stack,[]);assert.equal(await pg.evaluate(()=>app.getState().selected),null);
 });
 await check('상세 요청이 실패하면 회색 틀 대신 오류와 다시 시도(꾸미지 않음)',async()=>{
  await fresh();failures.add('a|'+now);await pg.evaluate(()=>app.select('coast','a'));
  await pg.waitForFunction(()=>document.querySelector('#risk-forecast-sheet [data-retry]'),null,{timeout:20000});const st=await sheetState();assert.ok(!st.skeleton&&st.busy===null&&st.body.includes('서버 오류')&&!st.index);assert.deepEqual(st.stack,['risk-forecast-sheet']);
  failures.delete('a|'+now);await pg.evaluate(()=>document.querySelector('#risk-forecast-sheet [data-retry]').click());await waitTitle('광안리해수욕장');
 });
 await check('열린 연안 상세에 「사고 배수는 어떻게 합쳤나요?」 없음(2026-10-18 사용자 「빼자.」 — 과제15 설명 삭제, 같은 방법은 [기준 상세]·PDF)',async()=>{
  const m=await pg.evaluate(()=>{const s=document.querySelector('#risk-forecast-sheet');return{has:!!s.querySelector('.rf-calculation'),text:s.textContent};});assert.equal(m.has,false);assert.doesNotMatch(m.text,/어떻게 합쳤나요/);
 });
 // ── 과제10: 위험구역 아코디언과 시트에 가려지지 않은 지도 영역의 가운데 이동 ──
 /** 지도가 움직임(애니메이션)을 끝낼 때까지 기다린다. 예: await settleMap(). @returns {Promise<void>} [연계] ← 과제10 */
 const settleMap=async()=>{await pg.waitForFunction(()=>!map.getView().getAnimating()&&!map.getView().getInteracting());await pg.waitForTimeout(600);};
 /** 위험구역 폴리곤(또는 한 점)의 지도 화면 위치를 시트 윗변과 함께 잰다. @param {string} what 'hazard'|'point' @param {number[]} [lonlat] 점 좌표 @returns {Promise<object>} cx·cy·top·bottom·visibleCenterY·sheetTop [연계] ← 과제10 */
 const placed=(what,lonlat)=>pg.evaluate(([w,ll])=>{const el=document.getElementById('risk-forecast-sheet'),m=document.getElementById('map').getBoundingClientRect(),sr=el.getBoundingClientRect();let x0,y0,x1,y1;if(w==='hazard'){const ex=map.getLayers().getArray().find(l=>l.getClassName()==='rf-hazard-canvas').getSource().getExtent();const a=map.getPixelFromCoordinate([ex[0],ex[3]]),b=map.getPixelFromCoordinate([ex[2],ex[1]]);x0=a[0];y0=a[1];x1=b[0];y1=b[1];}else{const a=map.getPixelFromCoordinate(ol.proj.fromLonLat(ll));x0=x1=a[0];y0=y1=a[1];}return{cx:(x0+x1)/2,cy:(y0+y1)/2,top:y0,bottom:y1,mapWidth:m.width,visibleCenterY:(sr.top-m.top)/2,sheetTop:sr.top-m.top};},[what,lonlat||null]);
 // 2026-10-18 연안 시트 시안 ②-2(CoastSheetOpen.dc.html): 종전 「위험구역 N곳 현황」 아코디언(목록·주소·관할) → 종류별 밑줄 버튼을 누르면 테두리 상자 안 표(위치·종류·구분·지도).
 await check('위험구역 표(시안 ②-2): 처음 접힘 → 종류 밑줄 버튼(종류색)을 누르면 상자 안 표 펼침(머리 흰색 굵게·칸 위치/종류/구분/지도·연번·주소·관할 없음) → 다시 누르면 접힘, [위치보기] 24px 이상·보통 굵기',async()=>{
  await fresh();await open('a');
  const m=await pg.evaluate(()=>{const s=document.querySelector('#risk-forecast-sheet'),box=s.querySelector('[data-hz-box]'),tg=s.querySelector('[data-hz-toggle]');const closed=box.hidden&&box.getBoundingClientRect().height===0;tg.scrollIntoView();tg.click();const cs=getComputedStyle(box),btn=box.querySelector('button[data-zone-id]');
   return{closed,opened:!box.hidden&&box.getBoundingClientRect().height>0,exp:tg.getAttribute('aria-expanded'),toggles:[...s.querySelectorAll('[data-hz-toggle]')].map(b=>[b.textContent,getComputedStyle(b).color,getComputedStyle(b).textDecorationLine]),head:[...box.querySelectorAll('th')].map(t=>[t.textContent,getComputedStyle(t).color,getComputedStyle(t).fontWeight]),rows:box.querySelectorAll('tbody tr').length,buttons:box.querySelectorAll('button[data-zone-id]').length,minBtn:Math.min(...[...box.querySelectorAll('button')].map(b=>b.getBoundingClientRect().height)),btnWeight:getComputedStyle(btn).fontWeight,btnColor:getComputedStyle(btn).color,first:[...box.querySelector('tbody tr').cells].map(c=>c.textContent),kindColor:getComputedStyle(box.querySelector('.rf-hz-class')).color,border:cs.borderTopWidth+' '+cs.borderTopColor,radius:cs.borderTopLeftRadius,pad:cs.padding,bg:cs.backgroundColor,text:box.textContent,head2:s.querySelector('.rf-coast-rows .rf-row:nth-child(2) .rf-row-head').textContent};});
  console.log('측정 위험구역 표',JSON.stringify({...m,text:undefined}));
  assert.ok(m.closed&&m.opened,'접힘 → 펼침');assert.equal(m.exp,'true');
  assert.deepEqual(m.toggles,[['연안사고 위험구역 12개소','rgb(45, 212, 191)','underline']]);assert.equal(m.head2,'위험구역(3km 안)12개소');
  assert.deepEqual(m.head,[['위치','rgb(255, 255, 255)','800'],['종류','rgb(255, 255, 255)','800'],['구분','rgb(255, 255, 255)','800'],['지도','rgb(255, 255, 255)','800']]);
  assert.equal(m.rows,12);assert.equal(m.buttons,12);assert.ok(m.minBtn>=24,'누르는 곳 높이 '+m.minBtn);assert.equal(m.btnWeight,'400','[위치보기] 보통 굵기(사용자 「여기서도 볼드 빼줘」)');assert.equal(m.btnColor,'rgb(143, 195, 255)');
  assert.deepEqual(m.first,['위험구역0','갯바위','위험구역','위치보기']);assert.equal(m.kindColor,'rgb(45, 212, 191)');
  assert.equal(m.border,'1px rgba(255, 255, 255, 0.18)');assert.equal(m.radius,'10px');assert.equal(m.pad,'4px 8px 2px');assert.equal(m.bg,'rgba(255, 255, 255, 0.04)');
  for(const t of ['광안로','관할','연안사고 위험구역'])assert.ok(!m.text.includes(t),'표에 없어야 함 '+t);
  const shots=process.env.RISK_SHEET_SHOTS;if(shots){fs.mkdirSync(shots,{recursive:true});await pg.evaluate(()=>document.querySelector('#risk-forecast-sheet [data-hz-box]').scrollIntoView({block:'center'}));await pg.waitForTimeout(80);await pg.screenshot({path:path.join(shots,'coast_hazard_table_412.png')});}
  const again=await pg.evaluate(()=>{const s=document.querySelector('#risk-forecast-sheet');s.querySelector('[data-hz-toggle]').click();return[s.querySelector('[data-hz-box]').hidden,s.querySelector('[data-hz-toggle]').getAttribute('aria-expanded')];});
  assert.deepEqual(again,[true,'false'],'다시 누르면 접힘');
  await pg.evaluate(()=>document.querySelector('#risk-forecast-sheet [data-hz-toggle]').click());
 });
 await check('위험구역을 누르면 시트에 가려지지 않은 지도 영역의 가운데로 이동(서브탭 닫힘·열림)',async()=>{
  for(const sub of [false,true]){
   await tabs({sub});await pg.evaluate(()=>document.querySelector('#risk-forecast-sheet [data-zone-id="z3"]').click());
   await pg.waitForFunction(()=>map.getLayers().getArray().find(l=>l.getClassName()==='rf-hazard-canvas').getSource().getFeatures().length===1&&document.querySelector('#risk-forecast-sheet [data-zone-id="z3"]').getAttribute('aria-pressed')==='true');await settleMap();
   const r=await placed('hazard');console.log('측정 위험구역 이동 서브탭'+(sub?'열림':'닫힘'),JSON.stringify(r));
   assert.ok(Math.abs(r.cx-r.mapWidth/2)<=2,'가로 중심 '+r.cx);assert.ok(Math.abs(r.cy-r.visibleCenterY)<=2,'세로 중심 '+r.cy+' vs 남은 영역 가운데 '+r.visibleCenterY);assert.ok(r.bottom<=r.sheetTop&&r.top>=0,'구역이 시트에 가려짐 '+r.bottom+' > '+r.sheetTop);
  }
  const pressed=await pg.evaluate(()=>Array.from(document.querySelectorAll('#risk-forecast-sheet [data-zone-id]')).filter(b=>b.getAttribute('aria-pressed')==='true').map(b=>b.dataset.zoneId));assert.deepEqual(pressed,['z3']);
  await pg.evaluate(()=>document.querySelector('#risk-forecast-sheet [data-zone-id="z7"]').click());await pg.waitForFunction(()=>document.querySelector('#risk-forecast-sheet [data-zone-id="z7"]').getAttribute('aria-pressed')==='true');
  assert.equal(await pg.evaluate(()=>document.querySelector('#risk-forecast-sheet [data-zone-id="z3"]').getAttribute('aria-pressed')),'false','이전 구역 선택 해제');await tabs({});
 });
 await check('다른 지점을 고르면 위험구역 표시가 해제됨',async()=>{
  await pg.evaluate(()=>{app.select('coast','b');});await waitTitle('해운대해수욕장');
  assert.equal(await pg.evaluate(()=>map.getLayers().getArray().find(l=>l.getClassName()==='rf-hazard-canvas').getSource().getFeatures().length),0);
 });
 await check('해상 관할 해역 이동도 같은 보이는 영역 가운데 규칙(서브탭 닫힘·열림)',async()=>{
  for(const sub of [false,true]){
   await tabs({sub});await open('a');await settleMap();
   await pg.evaluate(()=>{const b=document.createElement('button');b.dataset.marineLon='129.2';b.dataset.marineLat='35.2';b.id='marine-test';document.querySelector('#risk-forecast-sheet .rf-body').appendChild(b);b.click();});await pg.waitForTimeout(50);await settleMap();
   const r=await placed('point',[129.2,35.2]);console.log('측정 해역 이동 서브탭'+(sub?'열림':'닫힘'),JSON.stringify(r));
   assert.ok(Math.abs(r.cx-r.mapWidth/2)<=2,'가로 '+r.cx);assert.ok(Math.abs(r.cy-r.visibleCenterY)<=2,'세로 '+r.cy+' vs '+r.visibleCenterY);assert.ok(r.cy<r.sheetTop);
  }
  await tabs({});
 });
 await check('PopupStack·닫기 버튼 동작 유지(뒤로가기로 시트 닫힘)',async()=>{
  await open('a');assert.deepEqual(await pg.evaluate(()=>Array.from(PopupStack.list())),['risk-forecast-sheet']);
  assert.equal(await pg.evaluate(()=>PopupStack.popLast()),true);assert.equal(await pg.evaluate(()=>document.getElementById('risk-forecast-sheet').classList.contains('open')),false);assert.equal(await pg.evaluate(()=>app.getState().selected),null);
  await open('a');await pg.evaluate(()=>document.querySelector('#risk-forecast-sheet .rf-close').click());assert.equal(await pg.evaluate(()=>document.getElementById('risk-forecast-sheet').classList.contains('open')),false);assert.deepEqual(await pg.evaluate(()=>Array.from(PopupStack.list())),[]);
 });

 // ── T7·T8(2026-10-16): 실제 앱처럼 공용 style.css 를 risk_forecast.css 앞에 얹고(✕ 크기·전역 여백 0) 연안 시각 막대·머리 [기준 상세]·기준 상세 창을 잰다.
 //    앞 검사들의 측정값을 바꾸지 않으려고 맨 끝에서 얹는다. ──
 const SHOTS=process.env.RISK_SHEET_SHOTS||'';if(SHOTS)fs.mkdirSync(SHOTS,{recursive:true});
 /** 공용 style.css 를 risk_forecast.css 앞에 얹는다(실제 앱 순서). 새로 불러오면(fresh) 빠지므로 그 뒤에 다시 부른다. @returns {Promise<void>} [연계] ← T8·T24 */
 const withStyle=()=>pg.evaluate(()=>new Promise(res=>{const l=document.createElement('link');l.rel='stylesheet';l.href='/style.css';l.onload=res;l.onerror=res;document.head.insertBefore(l,document.querySelector('link[href*="risk_forecast.css"]'));const st=document.createElement('style');st.textContent='body{display:block}body::before{display:none!important}';document.head.appendChild(st);}));
 await withStyle();
 /** 시트 머리를 잰다: [기준 상세]·✕·부제·시각 줄, 「지금」 꼬리표와 범례 항목, 버튼을 숨겼을 때의 시각 줄 위치. @returns {Promise<object>} 측정값 [연계] ← T7·T8 */
 const headM=()=>pg.evaluate(()=>{const s=document.getElementById('risk-forecast-sheet'),q=x=>s.querySelector(x),r=e=>{const b=e.getBoundingClientRect();return{l:+b.left.toFixed(1),r:+b.right.toFixed(1),t:+b.top.toFixed(1),b:+b.bottom.toFixed(1)};};
  const btn=q('.rf-head-basis'),sub=q('.rf-subtitle'),tl=q('.rf-timeline'),now=q('.rf-st-now'),row=q('.rf-sub-row');
  // 버튼이 시각 줄을 밀지 않는지: 부제 줄 높이 = 부제 글자 높이(버튼이 줄을 키우지 않음), 그리고 한 줄짜리 짧은 부제로 바꿔 버튼 있을 때·없을 때 시각 줄 위치가 같은지.
  const text=sub.textContent;sub.textContent='광안리파출소 관할';const shortTop=tl.getBoundingClientRect().top;btn.hidden=true;const shortTopNoBtn=tl.getBoundingClientRect().top;btn.hidden=false;sub.textContent=text;
  return{btn:r(btn),btnH:+btn.getBoundingClientRect().height.toFixed(1),hidden:btn.hidden,basis:btn.dataset.basis,close:r(q('.rf-close')),sub:r(sub),subLines:Math.round(sub.getBoundingClientRect().height/parseFloat(getComputedStyle(sub).lineHeight)),rowH:+row.getBoundingClientRect().height.toFixed(2),subH:+sub.getBoundingClientRect().height.toFixed(2),shortTop,shortTopNoBtn,now:now&&r(now),keys:q('.rf-st-key')?[...q('.rf-st-key').children].map(r):[],key:q('.rf-st-key')?q('.rf-st-key').textContent:null,day:q('.rf-sheet-day')&&{row:r(q('.rf-sheet-day')),btns:[...q('.rf-sheet-day').querySelectorAll('button')].map(b=>({...r(b),w:+b.getBoundingClientRect().width.toFixed(1),h:+b.getBoundingClientRect().height.toFixed(1),op:getComputedStyle(b).opacity,dis:b.disabled})),solar:r(q('.ocean-sheet-solar')),solarFont:getComputedStyle(q('.ocean-sheet-solar')).fontSize,peakFont:getComputedStyle(q('.ocean-sheet-lunar')).fontSize,sheetW:s.getBoundingClientRect().width,clip:[...q('.rf-sheet-day').querySelectorAll('*')].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.className)},sheet:r(s),cardBtn:s.querySelectorAll('.rf-body [data-basis]').length,cardPad:q('.rf-index')?getComputedStyle(q('.rf-index')).paddingTop:null};});
 /** 머리 측정값을 판정한다. @param {object} m headM 결과 @param {string} kind 'coast' @returns {void} [연계] ← T7·T8 */
 const judgeHead=(m,kind)=>{assert.equal(m.hidden,false);assert.equal(m.basis,kind);assert.ok(Math.abs(m.btn.r-m.close.r)<=6,'버튼 오른쪽 끝이 ✕ 오른쪽 끝과 맞음 '+m.btn.r+' vs '+m.close.r);assert.ok(m.btn.t>=m.close.b-.5,'버튼이 ✕ 아래 '+m.btn.t+' < '+m.close.b);
  assert.ok(m.sub.r<=m.btn.l-4,'부제가 버튼 자리를 침범 '+m.sub.r+' > '+m.btn.l);assert.ok(Math.abs(m.rowH-m.subH)<.5,'버튼이 부제 줄을 키움 '+m.rowH+' vs '+m.subH);assert.ok(Math.abs(m.shortTop-m.shortTopNoBtn)<.5,'한 줄 부제에서 버튼이 시각 줄을 밀어냄 '+m.shortTop+' vs '+m.shortTopNoBtn);assert.ok(m.btnH>=24,'누르는 곳 높이 '+m.btnH);
  if(kind!=='coast'){assert.ok(m.now,'「지금」 꼬리표');assert.ok(m.keys[0].l>=m.now.r+1,'범례가 「지금」 꼬리표와 겹침 '+m.keys[0].l+' < '+m.now.r);assert.ok(m.keys.at(-1).r<=m.sheet.r-4,'범례 끝이 시트 밖 '+m.keys.at(-1).r);}
  // T24: 연안은 시각 막대 대신 날짜 줄 — 시트 가운데, 버튼은 해양종합정보 시트와 같은 28px(style.css .ocean-date-nav-btn)·비활성 opacity .3, ✕·부제 줄 아래, 글자 안 잘림
  else{const d=m.day;assert.ok(d,'연안 날짜 줄');assert.equal(m.now,null,'연안 「지금」 꼬리표(시각 막대) 없음');assert.ok(Math.abs((d.row.l+d.row.r)/2-(m.sheet.l+m.sheet.r)/2)<=2,'날짜 줄이 시트 가운데 '+JSON.stringify(d.row));assert.deepEqual(d.btns.map(b=>[b.w,b.h]),[[28,28],[28,28]],'해양종합정보 날짜 버튼과 같은 28px');
   assert.deepEqual(d.btns.map(b=>[b.dis,b.op]),[[true,'0.3'],[false,'1']],'오늘: < 비활성(opacity .3 — 해양종합정보 :disabled 와 같음)');assert.ok(d.row.t>=m.close.b&&d.row.t>=m.sub.b,'날짜 줄은 ✕·부제 아래');assert.ok(d.btns.every(b=>b.l>=m.sheet.l&&b.r<=m.sheet.r),'버튼이 시트 안');assert.deepEqual(d.clip,[],'잘린 글자 없음');}};
 // T24(2026-10-16): 종전 「T7 연안 시각 막대」 사례를 없앴다 — 연안은 시각 막대 대신 날짜 줄(아래 380·320px 머리 사례가 모양을 잰다).
 await check('T24 연안 시트에 T7 시각 막대(연안 4단계 색 칸·범례·「지금」)가 없고, 날짜 줄은 해양종합정보 시트 날짜(.ocean-sheet-solar 글자 크기)와 같은 꼴',async()=>{
  await pg.setViewportSize({width:380,height:820});await fresh();await withStyle();await open('a');   // 날짜 줄 모양은 style.css(해양종합정보 시트 규칙)에서 온다 — 새로 불러온 뒤 다시 얹는다
  const r=await pg.evaluate(()=>{const tl=document.querySelector('#risk-forecast-sheet .rf-timeline');return{risk:tl.classList.contains('rf-risk-time'),track:tl.querySelectorAll('.rf-st-track,.rf-st-key,.rf-st-now').length,classes:[...tl.querySelectorAll('[class]')].map(e=>e.className),solar:getComputedStyle(tl.querySelector('.ocean-sheet-solar')).fontSize,ocean:(()=>{const o=document.createElement('div');o.className='ocean-sheet-solar';document.body.appendChild(o);const f=getComputedStyle(o).fontSize;o.remove();return f;})()};});
  console.log('측정 T24 연안 날짜 줄',JSON.stringify(r));
  assert.equal(r.risk,false);assert.equal(r.track,0);assert.ok(['ocean-date-nav-inline rf-sheet-day','ocean-date-nav-btn','ocean-sheet-date-stack','ocean-sheet-solar','ocean-sheet-lunar'].every(c=>r.classes.includes(c)),'해양종합정보 시트 날짜 줄 클래스 그대로 '+r.classes);assert.equal(r.solar,r.ocean,'날짜 글자 크기 = 해양종합정보 시트 날짜');
 });
 for(const width of [380,320])await check('T8·T24 연안 '+width+'px: [기준 상세]는 부제 줄 오른쪽 끝·✕ 아래, 날짜 줄을 밀지 않음, 날짜 줄은 가운데·28px 버튼·잘림 없음',async()=>{
  await pg.setViewportSize({width,height:width===320?568:820});await pg.waitForTimeout(150);const m=await headM();console.log('측정 T8 연안 머리 '+width+'px',JSON.stringify(m));
  judgeHead(m,'coast');assert.equal(m.cardBtn,0,'위험지수 카드 안 [기준 상세] 없음');assert.equal(m.cardPad,'10px','버튼 자리 여백(34px) 없앰');
  if(SHOTS)await pg.locator('#risk-forecast-sheet .rf-sheet-head').screenshot({path:path.join(SHOTS,'coast_head_day_'+width+'.png')});
 });
 await check('T8 [기준 상세] 누르면 기준 상세 창: 제목 「연안 위험지수」(「기준 상세 — 」 없음), 제목·닫기는 스크롤해도 제자리, 첫 초점 닫기',async()=>{
  await pg.setViewportSize({width:380,height:820});await pg.click('#risk-forecast-sheet .rf-head-basis');await pg.waitForSelector('.rf-basis');
  const m=await pg.evaluate(()=>{const box=document.querySelector('.rf-basis'),head=box.querySelector('.rf-basis-head'),body=box.querySelector('.rf-basis-body'),h=head.getBoundingClientRect().top,c=head.querySelector('.mclose').getBoundingClientRect(),before=body.scrollTop;body.scrollTop=body.scrollHeight;const c2=head.querySelector('.mclose').getBoundingClientRect(),hit=document.elementFromPoint(c2.left+c2.width/2,c2.top+c2.height/2);
   return{title:head.querySelector('h3').textContent,headKids:[...head.children].map(e=>e.tagName),bodyH3:body.querySelectorAll('h3').length,boxOverflow:getComputedStyle(box).overflowY,scrolled:body.scrollTop-before,headMoved:head.getBoundingClientRect().top-h,closeMoved:c2.top-c.top,closeHit:!!hit&&hit.classList.contains('mclose'),focus:document.activeElement&&document.activeElement.className,text:box.textContent};});
  console.log('측정 T8 기준 상세 창',JSON.stringify({...m,text:undefined}));
  assert.equal(m.title,'연안 위험지수');assert.ok(!m.text.includes('기준 상세 —'));assert.deepEqual(m.headKids,['H3','BUTTON']);assert.equal(m.bodyH3,0);assert.equal(m.boxOverflow,'hidden');
  assert.ok(m.scrolled>0,'내용이 스크롤되어야 함');assert.equal(m.headMoved,0);assert.equal(m.closeMoved,0);assert.equal(m.closeHit,true,'닫기 버튼이 가려짐');assert.equal(m.focus,'mclose');
 });
 /** 두 색의 명암비(WCAG). 예: ratio([143,211,255],[22,45,90]) → 약 8.3 @param {number[]} a @param {number[]} b RGB @returns {number} [연계] ← T8 링크 색 */
 const lum=c=>{const v=c.map(x=>{x/=255;return x<=.03928?x/12.92:Math.pow((x+.055)/1.055,2.4);});return .2126*v[0]+.7152*v[1]+.0722*v[2];},ratio=(a,b)=>{const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
 const rgb=t=>t.match(/[\d.]+/g).map(Number),over=(fg,bg)=>fg.slice(0,3).map((v,i)=>v*(fg[3]??1)+bg[i]*(1-(fg[3]??1)));
 const ENDS=[[12,26,58],[22,45,90]];   // 창 바탕 그라데이션 두 끝 #0c1a3a·#162d5a — 어느 높이든 그 사이 색이다
 // 2026-10-16 사용자 「맨 아래 mtis 공식 사고예보, mtis 공식 혼잡예보가 하이퍼링크 형식으로 있는데 이거는 디자인은 버튼 형식으로 바꿔주고 각 버튼을 가운데 정렬해줘.」
 //   종전 단언(밑줄 하늘색 링크 · 「·」 로 이음)을 버튼 모양·가운데·「·」 없음으로 바꿨다. 같은 날 「여기 제목에 공식 텍스트는 빼줘.」 — 해상 제목 「선박 사고위험·교통혼잡 예보」.
 await check('기준 상세 MTIS 두 링크는 버튼 모양(밑줄 없음·둥근 테두리)·가운데·「·」 없음·새 창, 창 바탕 두 끝 모두에 글자 대비 4.5:1 이상(연안 PDF 버튼 포함), 해상 제목에 「공식」 없음',async()=>{
  const pdf=await pg.evaluate(()=>{const a=document.querySelector('.rf-basis .pdf-btn'),cs=getComputedStyle(a);return{color:cs.color,bg:cs.backgroundColor};});
  for(const width of [380,320,1024]){
   await pg.setViewportSize({width,height:820});await pg.evaluate(()=>{RiskBasis.close();RiskBasis.open('sea');});
   const m=await pg.evaluate(()=>{const p=document.querySelector('.rf-basis .rf-basis-links'),pr=p.getBoundingClientRect(),cs=getComputedStyle(p);const inner={l:pr.left+parseFloat(cs.paddingLeft),r:pr.right-parseFloat(cs.paddingRight)};
    const links=[...p.querySelectorAll('a')].map(a=>{const c=getComputedStyle(a),r=a.getBoundingClientRect();return{text:a.textContent,href:a.getAttribute('href'),target:a.target,rel:a.rel,cls:a.className,color:c.color,bg:c.backgroundColor,line:c.textDecorationLine,radius:parseFloat(c.borderTopLeftRadius),border:c.borderTopStyle,l:r.left,r:r.right,t:Math.round(r.top),h:r.height};});
    const rows={};links.forEach(a=>{(rows[a.t]=rows[a.t]||[]).push(a);});
    return{links,pText:p.textContent,rows:Object.values(rows).map(row=>({left:Math.min(...row.map(a=>a.l))-inner.l,right:inner.r-Math.max(...row.map(a=>a.r)),n:row.length})),aCount:document.querySelectorAll('.rf-basis a').length};});
   const out={...m,links:m.links.map(l=>({text:l.text,min:+Math.min(...ENDS.map(e=>ratio(rgb(l.color),over(rgb(l.bg),e)))).toFixed(2),rows:undefined}))};console.log('측정 MTIS 버튼 '+width+'px',JSON.stringify({rows:m.rows,links:out.links}));
   // 2026-10-16 사용자 「1-가」: 주소 비교는 뺀다 — MTIS 웹 주소를 local_server 의 .js 에 적으면 test_no_mtis_web 이 막는다(주소는 risk_basis_content.js 에만 둔다).
   assert.deepEqual(m.links.map(l=>[l.text,!!l.href,l.target,l.rel]),[['MTIS 공식 사고예보',true,'_blank','noopener noreferrer'],['MTIS 공식 혼잡예보',true,'_blank','noopener noreferrer']]);
   assert.equal(m.pText,'MTIS 공식 사고예보MTIS 공식 혼잡예보','「·」 글자 없음');assert.equal(m.aCount,2);
   for(const l of m.links){assert.equal(l.cls,'link-btn');assert.equal(l.line,'none');assert.equal(l.border,'solid');assert.ok(l.radius>=10,'둥근 모양 '+l.radius);assert.ok(l.h>=24,'누르는 곳 높이 '+l.h);}
   for(const l of out.links)assert.ok(l.min>=4.5,l.text+' 대비 '+l.min);
   for(const r of m.rows)assert.ok(Math.abs(r.left-r.right)<=1.5,'가운데 정렬 '+width+'px '+JSON.stringify(r));
   if(width===1024)assert.equal(m.rows.length,1,'넓은 화면은 한 줄에 나란히');
   if(SHOTS&&width===380){await pg.evaluate(()=>{const b=document.querySelector('.rf-basis-body');b.scrollTop=b.scrollHeight;});await pg.waitForTimeout(50);await pg.screenshot({path:path.join(SHOTS,'basis_sea_380_mtis_buttons.png')});}
  }
  const pmin=+Math.min(...ENDS.map(e=>ratio(rgb(pdf.color),over(rgb(pdf.bg),e)))).toFixed(2);console.log('측정 PDF 버튼 대비',pmin);assert.ok(pmin>=4.5,'PDF 버튼 '+pmin);
  assert.equal(await pg.evaluate(()=>document.querySelector('.rf-basis-head h3').textContent),'선박 사고위험·교통혼잡 예보');
  await pg.setViewportSize({width:380,height:820});
 });
 if(SHOTS)for(const width of [380,320])for(const kind of ['coast','sea']){await pg.setViewportSize({width,height:width===320?568:820});await pg.evaluate(k=>{RiskBasis.close();RiskBasis.open(k);},kind);await pg.waitForTimeout(100);
  await pg.screenshot({path:path.join(SHOTS,'basis_'+kind+'_'+width+'_top.png')});await pg.evaluate(()=>{const b=document.querySelector('.rf-basis-body');b.scrollTop=b.scrollHeight;});await pg.waitForTimeout(50);await pg.screenshot({path:path.join(SHOTS,'basis_'+kind+'_'+width+'_bottom.png')});}
 await pg.evaluate(()=>RiskBasis.close());await pg.setViewportSize({width:412,height:915});

 // ── T9(2026-10-16): 연안 시트 「이 관광지 주변 연안사고」 — 해상 사고 카드와 같은 꼴(도넛·범례 팝업·인명피해 줄), 0건·자료 없음. 사용자 「500미터로 하자. 표류로 통일 넣지 말자. 주황계열로 변경.」 ──
 const accCard=()=>pg.evaluate(()=>{const c=document.querySelector('#risk-forecast-sheet [data-coast-acc]');if(!c)return null;const r=e=>{const b=e.getBoundingClientRect();return{l:b.left,r:b.right,t:b.top,b:b.bottom};};const body=document.querySelector('#risk-forecast-sheet .rf-body');
  return{kind:c.dataset.coastAcc,title:c.querySelector('h4').textContent,area:(c.querySelector('.rf-acc-area')||{}).textContent||null,total:(c.querySelector('[data-acc-total]')||{}).textContent||null,legend:[...c.querySelectorAll('.rf-acc-leg li')].map(li=>li.textContent.replace(/\s+/g,' ').trim()),cas:(c.querySelector('[data-acc-cas]')||{}).textContent||null,casBold:[...c.querySelectorAll('.rf-acc-cas b')].map(b=>[b.textContent,getComputedStyle(b).color,getComputedStyle(b).fontWeight]),
   card:r(c),svg:c.querySelector('svg')&&r(c.querySelector('svg')),items:[...c.querySelectorAll('.rf-acc-leg li')].map(r),last:body.lastElementChild===c||body.lastElementChild.contains(c),bodyOverflow:body.scrollWidth-body.clientWidth,boxBg:getComputedStyle(document.querySelector('#risk-forecast-sheet .rf-score-box')).backgroundColor,sub:document.querySelector('#risk-forecast-sheet .rf-subtitle').textContent,text:body.textContent};});
 await check('T9 연안 주변 연안사고: 제목(기간, 2026-10-18 시안 흰색·영역 줄 없음)·도넛 총 건수·유형 범례(기타(인명))·인명피해 줄(사망·실종만 빨강 굵게), 시트 맨 끝 · 380px 겹침 없음',async()=>{
  await pg.setViewportSize({width:380,height:820});await fresh();await open('a');const m=await accCard();console.log('측정 T9 사고 카드 380px',JSON.stringify({...m,text:undefined}));
  // 2026-10-18 시안: 제목 「주변 연안사고('20년 ~ '24년)」(흰색, 연도만 종전 제목색) · 영역 한 줄은 뺐다 · 마지막 요소 줄 구분선 없음, 상자와 18px.
  assert.equal(m.kind,'list');assert.equal(m.title,"주변 연안사고('20년 ~ '24년)");assert.equal(m.area,null);assert.equal(m.total,'7건');
  const hc=await pg.evaluate(()=>{const c=document.querySelector('#risk-forecast-sheet [data-coast-acc]'),rows=[...document.querySelectorAll('#risk-forecast-sheet .rf-coast-rows>.rf-row')],last=rows[rows.length-1];return{h4:getComputedStyle(c.querySelector('h4')).color,yrs:getComputedStyle(c.querySelector('.rf-coast-yrs')).color,lastBorder:getComputedStyle(last).borderBottomWidth,otherBorder:getComputedStyle(rows[0]).borderBottomWidth,gap:c.getBoundingClientRect().top-last.getBoundingClientRect().bottom+parseFloat(getComputedStyle(last).paddingBottom)};});
  assert.deepEqual([hc.h4,hc.yrs],['rgb(255, 255, 255)','rgb(207, 224, 255)'],'제목 흰색·연도 범위 종전 제목색');assert.equal(hc.lastBorder,'0px','마지막 요소 줄 구분선 없음');assert.equal(hc.otherBorder,'1px');assert.ok(Math.abs(hc.gap-18)<=.5,'마지막 줄 글 끝 ↔ 상자 '+hc.gap);
  assert.deepEqual(m.legend,['익수3건›','추락1건›','고립1건›','표류1건›','기타(인명)1건›']);
  assert.equal(m.cas,'사망 1명(24년, 익수), 실종 1명(22년, 추락)');assert.deepEqual(m.casBold.map(x=>x[0]),['사망 1명','실종 1명']);for(const b of m.casBold){assert.equal(b[1],'rgb(255, 107, 107)');assert.ok(+b[2]>=700);}
  assert.ok(m.last,'시트 맨 끝 카드');assert.equal(m.bodyOverflow,0,'본문 가로 넘침');
  assert.ok(m.svg.r<=m.items[0].l,'도넛과 범례 겹침');for(const it of m.items)assert.ok(it.r<=m.card.r-1&&it.l>=m.card.l,'범례가 카드 밖 '+JSON.stringify(it));for(let i=1;i<m.items.length;i++)assert.ok(m.items[i].t>=m.items[i-1].b-.5,'범례 줄 겹침');
  if(SHOTS){await pg.evaluate(()=>document.querySelector('#risk-forecast-sheet [data-coast-acc]').scrollIntoView({block:'end'}));await pg.waitForTimeout(80);await pg.screenshot({path:path.join(SHOTS,'coast_acc_list_380.png')});}
 });
 await check('T9 범례를 누르면 그 유형 사고 목록 팝업(최신순 날짜·사망/실종 빨강 굵게·없으면 비움), ×·Escape 로 닫힘',async()=>{
  await pg.evaluate(()=>document.querySelector('#risk-forecast-sheet [data-acc-group="0"]').click());await pg.waitForSelector('.rf-acc-pop:not([hidden]) .box');
  const p=await pg.evaluate(()=>{const b=document.querySelector('.rf-acc-pop .box');return{title:b.querySelector('h5').textContent,rows:[...b.querySelectorAll('li')].map(li=>[li.querySelector('.t').textContent,(li.querySelector('.c')||{}).textContent||'']),hurt:[...b.querySelectorAll('.c.hurt')].map(x=>[getComputedStyle(x).color,getComputedStyle(x).fontWeight]),stack:Array.from(PopupStack.list())};});
  console.log('측정 T9 팝업',JSON.stringify(p));
  assert.equal(p.title,'익수 3건최신순');assert.deepEqual(p.rows,[['2024.07.26','사망 1명'],['2023.08.01',''],['2022.08.20','']]);assert.deepEqual(p.hurt,[['rgb(255, 107, 107)','800']]);assert.ok(p.stack.includes('risk-sea-accident-pop'));
  if(SHOTS)await pg.screenshot({path:path.join(SHOTS,'coast_acc_popup_380.png')});
  await pg.click('.rf-acc-pop .x');assert.equal(await pg.evaluate(()=>document.querySelector('.rf-acc-pop').hidden),true);
  await pg.evaluate(()=>document.querySelector('#risk-forecast-sheet [data-acc-group="4"]').click());await pg.waitForSelector('.rf-acc-pop:not([hidden]) .box');
  assert.deepEqual(await pg.evaluate(()=>[document.querySelector('.rf-acc-pop h5').textContent,[...document.querySelectorAll('.rf-acc-pop li .t')].map(x=>x.textContent)]),['기타(인명) 1건최신순',['2020.06.02']]);
  await pg.keyboard.press('Escape');assert.equal(await pg.evaluate(()=>document.querySelector('.rf-acc-pop').hidden),true);assert.equal(await pg.evaluate(()=>document.getElementById('risk-forecast-sheet').classList.contains('open')),true,'Escape 는 팝업만');
 });
 await check('T9 0건이면 「주변 연안사고 없음(\'20년 ~ \'24년)」(2026-10-18 시안 — 영역 줄 없음), 자료 없음(available:false)이면 「주변 연안사고 자료 없음」',async()=>{
  await pg.evaluate(()=>{app.select('coast','b');});await waitTitle('해운대해수욕장');let m=await accCard();console.log('측정 T9 0건',JSON.stringify({kind:m.kind,title:m.title,area:m.area}));
  assert.equal(m.kind,'none');assert.equal(m.title,"주변 연안사고 없음('20년 ~ '24년)");assert.equal(m.area,null);assert.equal(m.total,null);assert.equal(m.bodyOverflow,0);
  if(SHOTS){await pg.evaluate(()=>document.querySelector('#risk-forecast-sheet [data-coast-acc]').scrollIntoView({block:'end'}));await pg.waitForTimeout(80);await pg.screenshot({path:path.join(SHOTS,'coast_acc_none_380.png')});}
  FIX.history.b={available:false};await fresh();await open('b');m=await accCard();
  assert.equal(m.kind,'nodata');assert.equal(m.title,'주변 연안사고 자료 없음');assert.equal(m.area,null);
  if(SHOTS){await pg.evaluate(()=>document.querySelector('#risk-forecast-sheet [data-coast-acc]').scrollIntoView({block:'end'}));await pg.waitForTimeout(80);await pg.screenshot({path:path.join(SHOTS,'coast_acc_nodata_380.png')});}
  FIX.history.b.available=true;FIX.history.b={available:true,from:'2020-01-01',to:'2024-12-31',area:'이 관광지 구역과 앞바다 500m',accidents:[]};
 });
 await check('「표류」 통일(떠밀림 없음)·연안 부제는 경위도 없이 관할만·위험지수 상자 색 = 단계 색(지수 19 → 초록)',async()=>{
  await fresh();await open('a');let m=await accCard();
  assert.ok(m.text.includes('사고 종류 : 익수, 추락, 고립, 표류'));assert.ok(m.text.includes('튜브·물놀이기구 등 표류 주의'));assert.ok(!m.text.includes('떠밀림'));
  assert.equal(m.sub,'부산해양경찰서 광안리파출소 관할');assert.ok(!/[°′″]/.test(m.sub));
  const B={'평소 수준':'rgb(47, 179, 107)','다소 높음':'rgb(242, 194, 48)','높음':'rgb(251, 146, 60)','매우 높음':'rgb(224, 50, 44)'};assert.equal(m.boxBg,B[scored.band],'상자 색 '+scored.band);
  for(const [idx,band] of [[19,'평소 수준'],[20,'다소 높음'],[67,'높음'],[100,'매우 높음']]){FIX.score.b={score:idx*.03,index:idx,band};await fresh();await open('b');m=await accCard();assert.equal(m.boxBg,B[band],'지수 '+idx);
   // 2026-10-18 시안: 등급 글자는 칸 안 남색 알약 배지(글자색 = 칸 색, 15.2px·800·자간 0.06em), 오른쪽 글은 등급 없이 「평소 정도로 붐비고…」부터, 막대 위 지수 위치 눈금(A안).
   const g=await pg.evaluate(()=>{const s=document.querySelector('#risk-forecast-sheet'),bd=s.querySelector('.rf-band-badge'),cs=getComputedStyle(bd),ramp=s.querySelector('.rf-ramp').getBoundingClientRect(),tick=s.querySelector('.rf-ramp-tick').getBoundingClientRect(),val=s.querySelector('.rf-ramp-val'),tri=s.querySelector('.rf-ramp-tri').getBoundingClientRect(),card=s.querySelector('.rf-index').getBoundingClientRect(),tcs=getComputedStyle(s.querySelector('.rf-ramp-tick'));
    return{text:bd.textContent,color:cs.color,bg:cs.backgroundColor,size:cs.fontSize,weight:cs.fontWeight,ls:cs.letterSpacing,radius:cs.borderTopLeftRadius,prose:s.querySelector('.rf-index-prose').textContent,pos:(tick.left+tick.width/2-ramp.left)/ramp.width*100,tickW:tick.width,tickBg:tcs.backgroundColor,tickShadow:tcs.boxShadow,val:val.textContent,valBg:getComputedStyle(val).backgroundColor,triAbove:tri.bottom<=tick.top+.5&&tri.top>=val.getBoundingClientRect().bottom-.5,inside:val.getBoundingClientRect().top>=card.top,gap:ramp.top-s.querySelector('.rf-index-main').getBoundingClientRect().bottom};});
   assert.equal(g.text,band);assert.equal(g.color,B[band],'배지 글자 = 칸 색');assert.equal(g.bg,'rgb(16, 21, 31)');assert.equal(g.size,'15.2px');assert.equal(g.weight,'800');assert.equal(g.ls,(15.2*.06).toFixed(3).replace(/0+$/,'')+'px');assert.equal(g.radius,'999px');
   assert.ok(g.prose.startsWith('평소 정도로 붐비고 위험구역 없는 곳의평범한 날과 비교 시전체 사고 '),'오른쪽 글 '+g.prose);assert.ok(!g.prose.includes(band+'평소'),'오른쪽 글에 등급 없음');assert.match(g.prose,/날 수 있는 조건사망·실종 사고 .* 날 수 있는 조건사고 종류/);
   assert.ok(Math.abs(g.pos-idx)<=0.6,'눈금 위치 '+g.pos+' vs 지수 '+idx);assert.equal(g.tickW,3);assert.equal(g.tickBg,'rgb(255, 255, 255)');assert.match(g.tickShadow,/rgb\(16, 21, 31\) 0px 0px 0px 1.5px/);assert.equal(g.val,String(idx));assert.equal(g.valBg,'rgb(255, 255, 255)');assert.ok(g.triAbove,'말풍선 → ▼ → 눈금 순서');assert.ok(g.inside,'말풍선이 카드 안');assert.ok(g.gap>=22,'막대 위 표시 자리 '+g.gap);
   if(SHOTS&&idx===19){await pg.evaluate(()=>{document.querySelector('#risk-forecast-sheet .rf-body').scrollTop=0;});await pg.waitForTimeout(80);await pg.screenshot({path:path.join(SHOTS,'coast_index19_380.png')});}}
  delete FIX.score.b;
  const basis=await pg.evaluate(()=>{RiskBasis.open('coast');const t=document.querySelector('.rf-basis-body').textContent;RiskBasis.close();return t;});
  assert.ok(basis.includes('연안 사고(익수·추락·고립·표류)')&&!basis.includes('떠밀림'));
  assert.ok(basis.includes('목록에는 익수·추락·고립·표류와 기타(인명)를 보여 줍니다. 위험지수 점수는 익수·추락·고립·표류 4유형으로 계산했습니다.'),'목록과 점수 유형 차이 한 줄');
 });
 // 2026-10-18 시안 댓글: 한 줄을 몇 글자 넘쳐 두 줄이 되는 「그 줄만」 자간을 -0.02 → -0.035 → -0.05em 순으로 줄여 한 줄이 되는 최소값만, 그래도 안 되면 원래대로. 전체 일괄 축소 금지.
 // 글꼴마다 폭이 달라, 첫 「•」 줄의 실제 한 줄 폭을 자간별로 재고 그 사이 폭으로 줄을 좁혀(max-width) 기대값을 정한다.
 await check('자간 맞춤(시안 댓글): 넘치는 줄만 -0.02/-0.035/-0.05em 중 한 줄이 되는 최소값, 안 되면 원래대로 두 줄 · 다른 줄은 그대로',async()=>{
  await pg.setViewportSize({width:412,height:915});await fresh();await open('a');
  const W=await pg.evaluate(()=>{const f=document.querySelector('#risk-forecast-sheet .rf-coast-rows .rf-fit'),c=f.cloneNode(true);c.style.cssText='position:absolute;visibility:hidden;white-space:nowrap;width:auto;max-width:none';f.parentNode.appendChild(c);const out=[0,-0.02,-0.035,-0.05].map(v=>{c.style.letterSpacing=v+'em';return c.getBoundingClientRect().width;});c.remove();return out;});
  console.log('측정 자간별 한 줄 폭',JSON.stringify(W));
  const cases=[[Math.ceil(W[0])+2,''],[(W[0]+W[1])/2,'-0.02em'],[(W[1]+W[2])/2,'-0.035em'],[(W[2]+W[3])/2,'-0.05em'],[W[3]-15,'']];
  for(const [width,want] of cases){
   await fresh();await pg.addStyleTag({content:'#risk-forecast-sheet .rf-coast-rows>.rf-row:first-child .rf-bullet:first-child .rf-fit{max-width:'+width.toFixed(2)+'px}'});await open('a');
   const r=await pg.evaluate(()=>{const fs=[...document.querySelectorAll('#risk-forecast-sheet .rf-coast-rows .rf-fit')],f=fs[0],lh=parseFloat(getComputedStyle(f).lineHeight);return{ls:f.style.letterSpacing,lines:Math.round(f.getBoundingClientRect().height/lh),second:fs[1].style.letterSpacing};});
   console.log('측정 자간 맞춤 폭 '+width.toFixed(1),JSON.stringify(r));
   assert.equal(r.ls,want,'폭 '+width+' → '+want);assert.equal(r.lines,want||width>W[0]?1:2,'줄 수');assert.equal(r.second,'','다른 줄은 그대로');
  }
 });
 // 2026-10-16 사용자 「표는 오른쪽 왼쪽으로 스크롤하면서 볼 수 있도록 해서 표가 과도하게 위아래로 켜지지 않도록 … 화면에 맞게 적절하게」
 for(const kind of ['coast','sea'])await check('기준 상세 표('+kind+'): 380·320px 가로 스크롤 상자·줄 수 ≤ 4·숫자 칸 줄바꿈 없음·창 자체는 가로 스크롤 없음, 1024px 스크롤 없이 꽉 참',async()=>{
  for(const width of [380,320,1024]){
   await pg.setViewportSize({width,height:820});await pg.evaluate(k=>{RiskBasis.close();RiskBasis.open(k);},kind);await pg.waitForTimeout(80);
   const m=await pg.evaluate(()=>{const body=document.querySelector('.rf-basis-body'),box=document.querySelector('.rf-basis');return{body:body.scrollWidth-body.clientWidth,box:box.scrollWidth-box.clientWidth,bare:[...body.querySelectorAll('table')].filter(t=>!t.closest('.rf-tbl-scroll')).length,
    tables:[...document.querySelectorAll('.rf-basis .rf-tbl')].map(o=>{const sc=o.querySelector('.rf-tbl-scroll'),t=o.querySelector('table'),cs=getComputedStyle(sc);return{over:sc.scrollWidth-sc.clientWidth,ox:cs.overflowX,box:sc.clientWidth,table:Math.round(t.getBoundingClientRect().width),cls:o.className,
     lines:[...t.querySelectorAll('tbody td')].map(td=>{const c=getComputedStyle(td);return Math.round((td.getBoundingClientRect().height-parseFloat(c.paddingTop)-parseFloat(c.paddingBottom))/parseFloat(c.lineHeight));}),
     nWrap:[...t.querySelectorAll('.n')].filter(td=>getComputedStyle(td).whiteSpace!=='nowrap').length};})};});
   console.log('측정 기준 상세 표 '+kind+' '+width+'px',JSON.stringify({...m,tables:m.tables.map(t=>({...t,lines:Math.max(...t.lines)}))}));
   assert.ok(m.tables.length>=1);assert.equal(m.bare,0,'감싸지 않은 표');assert.equal(m.body,0,'창 본문 가로 스크롤');assert.equal(m.box,0,'창 가로 스크롤');
   for(const t of m.tables){assert.equal(t.ox,'auto');assert.ok(Math.max(...t.lines)<=4,'줄 수 '+Math.max(...t.lines));assert.equal(t.nWrap,0);
    if(width===1024){assert.equal(t.over,0,'넓은 화면 스크롤');assert.equal(t.table,t.box,'꽉 참');assert.ok(!/more-right/.test(t.cls));}
    else if(t.over>0)assert.ok(/more-right/.test(t.cls),'오른쪽 그늘 단서');}
   if(kind==='coast'&&width===380){assert.ok(m.tables[0].over>0,'380px 연안 요소 표는 옆으로 민다');
    if(SHOTS){await pg.evaluate(()=>document.querySelector('.rf-tbl').scrollIntoView({block:'center'}));await pg.waitForTimeout(60);await pg.screenshot({path:path.join(SHOTS,'basis_coast_380_table_before.png')});
     await pg.evaluate(()=>{const sc=document.querySelector('.rf-tbl-scroll');sc.scrollLeft=sc.scrollWidth;});await pg.waitForTimeout(120);
     assert.ok(await pg.evaluate(()=>{const o=document.querySelector('.rf-tbl');return o.classList.contains('more-left')&&!o.classList.contains('more-right');}),'끝까지 밀면 왼쪽 그늘만');await pg.screenshot({path:path.join(SHOTS,'basis_coast_380_table_after.png')});}}
   if(kind==='sea'&&width===380&&SHOTS){await pg.evaluate(()=>document.querySelector('.rf-tbl').scrollIntoView({block:'center'}));await pg.waitForTimeout(60);await pg.screenshot({path:path.join(SHOTS,'basis_sea_380_table.png')});}
  }
  await pg.evaluate(()=>RiskBasis.close());await pg.setViewportSize({width:380,height:820});
 });
 await check('모바일 실행 오류 없음',()=>assert.deepEqual(errors,[]));
 void requests;void holds;void failures;void hold;
}finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));console.log(`${pass} PASS / ${fail} FAIL`);if(fail)process.exitCode=1;}})().catch(e=>{console.error('❌ 브라우저 검사 실행 실패:',e.message);console.log('0 PASS / 1 FAIL');process.exitCode=1;});
