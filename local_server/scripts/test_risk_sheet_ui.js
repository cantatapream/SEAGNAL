/**
 * 파일명: local_server/scripts/test_risk_sheet_ui.js
 * 역할  : 휴대폰 크기 Chromium에서 위험예측 바텀시트의 하단 탭 가림 방지·고정 머리/스크롤 본문·즉시 스켈레톤과 늦은 응답 보호·고정 일시 표시·위험구역 아코디언과 보이는 지도 중앙 이동을 검사한다.
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
const coastInput={t:now,now,spot:{hazard:{count:12,fatal:true}},concentration:90.52,events:[],swell:{periodS:8}};
const scored=scorer.scoreCoast(coastInput),scoredRows=scored.factors.map(r=>({...r,key:r.key==='concentration'?'people':r.key}));
const zones=Array.from({length:12},(_,i)=>({id:'z'+i,place:'위험구역'+i,shape:'갯바위',class:'연안사고 위험구역',addr:'부산 수영구 광안로 '+(100+i),police:'광안리'}));
const spots=[{i:0,id:'a',name:'광안리해수욕장',lat:35.153,lon:129.118},{i:1,id:'b',name:'해운대해수욕장',lat:35.159,lon:129.16}].map(p=>({...p,sggName:'부산',police:{name:'광안리'},geometry:{type:'Polygon',coordinates:[[[p.lon-.004,p.lat-.004],[p.lon+.004,p.lat-.004],[p.lon+.004,p.lat+.004],[p.lon-.004,p.lat+.004],[p.lon-.004,p.lat-.004]]]}}));
/** 지점 id와 시각이 본문에 드러나는 연안 상세를 만든다. 예: detail('a',later). @param {string} id 지점 @param {string} t 시트 시각 @returns {object} 상세 응답 [연계] ← 가짜 API */
function detail(id,t){const spot=spots.find(p=>p.id===id);return{t,title:spot.name,subtitle:{lat:spot.lat,lon:spot.lon,police:'광안리'},score:scored.score,index:scored.index,band:scored.band,rr:scored.rr,fatalRr:scored.fatalRr,notices:[{key:'warning',effective:['풍랑주의보'],prelim:[]},{key:'drift',windMs:9}],missing:[],inputs:{},rows:scoredRows.map(r=>r.key==='hazard'?{...r,zones}:r).concat([{key:'event',name:'행사 '+id+'@'+t,weekend:true,rr:1.2,events:[]}])};}
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
 const waitTitle=title=>pg.waitForFunction(t=>document.querySelector('#risk-forecast-sheet .rf-title').textContent===t&&document.querySelector('#risk-forecast-sheet .rf-index'),title);
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
  assert.ok(r);const m=await scrollEnd('#long-sheet');console.log('측정 브리핑 20개 해역',JSON.stringify(m));
  assert.ok(m.scrollable&&m.headMoved===0&&m.closeMoved===0&&m.closeVisible);assert.ok(Math.abs(m.sheetBottom-m.tabTop)<=.5);assert.ok(!m.lastCovered);
  await pg.evaluate(()=>document.getElementById('long-sheet').remove());
 });
 /** 시트 슬라이더를 한 칸으로 옮긴다. 예: slide(1) → input 이벤트. @param {number} n 칸 번호 @returns {Promise<void>} [연계] ← 과제6·8 */
 const slide=n=>pg.evaluate(i=>{const el=document.querySelector('#risk-forecast-sheet input[type="range"]');el.value=String(i);el.dispatchEvent(new Event('input',{bubbles:true}));},n);
 const label=()=>pg.evaluate(()=>document.querySelector('#risk-forecast-sheet .rf-time-label').textContent);
 await check('슬라이더 말풍선 없이 위 빈칸에 「\'26.mm.dd(요일) HH:mm」 고정 표시',async()=>{
  await open('a');
  const m=await pg.evaluate(()=>{const l=document.querySelector('#risk-forecast-sheet .rf-time-label'),w=document.querySelector('#risk-forecast-sheet .ocean-sheet-slider-wrap'),lr=l.getBoundingClientRect(),wr=w.getBoundingClientRect(),input=w.querySelector('input');return{tag:l.tagName,text:l.textContent,bubbles:document.querySelectorAll('.ocean-sheet-tooltip').length,above:lr.bottom<=wr.top+.5,visible:lr.width>0&&lr.height>0,valuetext:input.getAttribute('aria-valuetext')};});
  console.log('측정 고정 일시',JSON.stringify(m));
  assert.equal(m.tag,'OUTPUT');assert.equal(m.text,"'26.10.15(목) 15:00");assert.equal(m.bubbles,0);assert.ok(m.above&&m.visible);assert.equal(m.valuetext,m.text);
  await slide(1);assert.equal(await label(),"'26.10.15(목) 18:00");await slide(3);assert.equal(await label(),"'26.10.16(금) 00:00");
  await pg.waitForFunction(()=>document.querySelector('#risk-forecast-sheet .rf-body').textContent.includes('@2026-10-16T00:00:00+09:00'));
 });
 await check('시트 시각을 바꿔도 메인 시각은 그대로·닫고 다른 지점은 메인 시각(15시)으로 시작',async()=>{
  assert.equal(await pg.evaluate(()=>app.getState().t),now);
  await pg.evaluate(()=>document.querySelector('#risk-forecast-sheet .rf-close').click());await open('b');
  assert.equal(await label(),"'26.10.15(목) 15:00");assert.equal(await pg.evaluate(()=>document.querySelector('#risk-forecast-sheet input[type="range"]').value),'0');assert.equal(await pg.evaluate(()=>app.getState().t),now);
 });
 await check('PopupStack·닫기 버튼 동작 유지(뒤로가기로 시트 닫힘)',async()=>{
  await open('a');assert.deepEqual(await pg.evaluate(()=>Array.from(PopupStack.list())),['risk-forecast-sheet']);
  assert.equal(await pg.evaluate(()=>PopupStack.popLast()),true);assert.equal(await pg.evaluate(()=>document.getElementById('risk-forecast-sheet').classList.contains('open')),false);assert.equal(await pg.evaluate(()=>app.getState().selected),null);
  await open('a');await pg.evaluate(()=>document.querySelector('#risk-forecast-sheet .rf-close').click());assert.equal(await pg.evaluate(()=>document.getElementById('risk-forecast-sheet').classList.contains('open')),false);assert.deepEqual(await pg.evaluate(()=>Array.from(PopupStack.list())),[]);
 });
 await check('모바일 실행 오류 없음',()=>assert.deepEqual(errors,[]));
 void requests;void holds;void failures;void hold;
}finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));console.log(`${pass} PASS / ${fail} FAIL`);if(fail)process.exitCode=1;}})().catch(e=>{console.error('❌ 브라우저 검사 실행 실패:',e.message);console.log('0 PASS / 1 FAIL');process.exitCode=1;});
