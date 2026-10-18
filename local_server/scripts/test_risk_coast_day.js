/**
 * 파일명: local_server/scripts/test_risk_coast_day.js
 * 역할  : 위험예측 연안 「하루 하나」(T24)의 화면을 실제 index2.html 전체(Chromium)로 검사한다 —
 *         연안만 켜면 하단 시간 바 대신 지도 가운데 위쪽 날짜 넘기기(항행경보 날짜 줄과 같은 클래스·모양·자리),
 *         오늘 앞·내일 뒤 비활성, 날짜를 바꾸면 지도·토스트·열린 연안 시트가 함께, 시트의 < > 로 바꾸면 상단도 함께,
 *         해상을 함께 켜면 하단 시간 버튼 그대로·연안은 그 시각의 날짜(시트 < > 는 그 날짜의 같은 시각), 해상을 끄면 상단 날짜 줄로,
 *         시트가 열린 동안 지도 클릭은 무시하되(「나. 무시」) 토글·날짜/시간 버튼·[기준 상세]·✕·Escape·시트 안 관광지 목록은 그대로.
 *         사용자 원문(2026-10-16): 「5-하루 하나로 합치기. 해당구역을 클릭하면 해양종합정보의 바텀시트처럼 일 시 왼쪽 오른쪽에 < > 버튼 만들어서 넘길 수 있도록.」
 *         · 「그리고 연안위험 예측에서 하단의 시간대는 + - 해놓은 기획은 빼야겠지 ? 날짜별로 넘겨가며 볼 수 있도록 변경 필요.」
 *         · 「아직 이미지처럼 연안 위험에 시간 조정이 있네 ? 날짜 바꾸는 디자인을 적용해줘. 예를 들면, 우리 앱에서 항행경보가 반영된곳을 보면 화면 가운데 위쪽에 날짜 변경 기능이 있잖아? 그거처럼 말이야.」
 *         · 하루 값 「1. 가」(그날 3시간 칸 중 가장 높은 값) · 해상 함께 「2. 가」(해상 시간 버튼 그대로, 연안은 그 시각이 속한 KST 날짜) · 「나. 무시」.
 *         연안 시트 안내(특보·표류)는 그날 칸 전부의 것(daily.notices)에 시각을 붙여 — 설계서 §16.1 ②(2026-10-16 「모두 추천대로」).
 *         §18(2026-10-18): 연안 시트 해수욕장 안내 줄(가짜 beach — 특보 상자 바로 아래·요소 줄 위·오늘/내일·360px, 판단·문구는 test_beach_weather).
 *         하루 값 계산 자체(8칸·이른 칸·KST 경계·결측 합침·안내 묶음)는 test_risk_store 가 본다. 여기 가짜 저장소는 날짜마다 다른 값(오늘 1.2·내일 2.2)만 준다.
 *         RISK_DAY_SHOTS=<폴더> 를 주면 380·1280px 화면을 PNG 로 남긴다(판정에 쓰지 않음).
 * [연계] client/index2.html(항행경보 #navwarn-date-nav 규칙) · risk_forecast.js(dateNav·shiftDay·setMain·mapSelect) · risk_sheet.js(day) ·
 *        routes/risk_forecast.js(/coast/frame·/coast/spot → coastDayFrame·coastDayDetail) ← scripts/refactor/verify_all.sh SUITES
 * [로드 순서] 독립 검사. 3001 서버·외부 호출 없음 — 자체 express(임의 포트), 위험예측 API 는 실제 라우터 + 가짜 저장소, 그 밖의 /api 는 404, 127.0.0.1 밖 요청은 끊는다.
 * [실행] NODE_PATH=/opt/node-tools/node_modules node local_server/scripts/test_risk_coast_day.js
 */
'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert'),express=require('express'),{chromium}=require('playwright-core');
const root=path.join(__dirname,'../..'),io=require('../services/risk_collector_io'),M=require('../services/marine_fusion'),T=require('../services/risk_time'),{createRouter}=require('../routes/risk_forecast');
let pass=0,fail=0;
/** 실제 브라우저 결과를 검사한다. 예: check('날짜 줄',async()=>{...}). @param {string} name - 사례 @param {function} fn - 검사 @returns {Promise<void>} [연계] ← 아래 사례 / 실패도 모두 찍고 마지막에 요약한다. */
async function check(name,fn){try{await fn();console.log('✅',name);pass++;}catch(e){console.error('❌',name,e.message);fail++;}}
// 기준 시각은 과거 고정(시각 의존 금지 — verify_all 규칙): 2026-10-12(월) 11:00 KST. 오늘 10-12, 내일 10-13.
const now=Date.parse('2026-10-12T11:00:00+09:00'),at=T.isoKst(now),TOMORROW='2026-10-13T00:00:00+09:00',SHOTS=process.env.RISK_DAY_SHOTS||'';
const coastTimes=T.timeline(now,3,2,21),seaTimes=T.timeline(now,1,2,23),iso=s=>T.isoKst(Date.parse(s));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'coast-day-'));if(SHOTS)fs.mkdirSync(SHOTS,{recursive:true});
(async()=>{let browser,server;try{
 const geometry={type:'Polygon',coordinates:[[[126.525,33.55],[126.55,33.55],[126.55,33.575],[126.525,33.575],[126.525,33.55]]]},cell={id:'GR4_F4K23_P4',i:0,lat:33.5625,lon:126.5375,geometry,haegu:{label:'163-6',major:163,sub:6},ref:{name:'제주항',bearingWord:'북서',distNm:8.2}},acc={...cell,id:'100'};
 io.write(path.join(dir,'sea_realtime.json.gz'),{v:'v1',cells:[cell],rows:[[0,21,.2]],collectedAt:at,sourceAt:null,source:'MTIS realtime API'});
 const frames={};for(const t of coastTimes)frames[t.slice(0,13).replace(/[-T]/g,'')+'00']=[[0,.002,'주의']];frames['202610120900']=[[0,.002,'주의']];
 const inputs={version:1,cells:{cells:[cell]},congestion:{frames:{}},accident:{cells:[acc],frames},sources:{accident:{status:'ok'},congestion:{status:'ok'},zoneForecasts:{status:'ok'}},weather:()=>({wh:2,ws:12,wp:4,wd:241,forecastAt:at})};
 // S1 혼자, S2·S3 는 같은 좌표(같은 위치 관광지 선택 목록). 연안 면 값은 면이 있는 S1·S2 만 지도에 남는다.
 const ring=(x,y)=>[[x,y],[x+.012,y],[x+.012,y+.012],[x,y+.012],[x,y]],spots=[{id:'S1',i:0,lat:33.536,lon:126.506,name:'가짜해변',cell:ring(126.5,33.53)},{id:'S2',i:1,lat:33.53,lon:126.62,name:'같은자리1',cell:ring(126.614,33.524)},{id:'S3',i:2,lat:33.53,lon:126.62,name:'같은자리2',geometry:{type:'MultiPolygon',coordinates:[]}}];   // S3 는 실제 자료의 「육지 몫이 빈 관광지」처럼 빈 면(중심점만)
 const log={coast:[],spot:[],bad:[]};
 /** 서버 validateTime 과 같은 범위(지금-5분 ~ 연안 마지막 칸)만 받는다. @param {string} t @returns {string} KST ISO [연계] ← 가짜 coastDayFrame·coastDayDetail */
 function valid(t){const n=Date.parse(t);if(!Number.isFinite(n)||n<now-5*60000||n>Date.parse(coastTimes.at(-1))){log.bad.push(t);throw Object.assign(new Error('잘못된 예보 시각'),{status:400});}return T.isoKst(n);}
 const DAY={'2026-10-12':{score:1.2,index:40,band:'다소 높음',peak:'2026-10-12T18:00:00+09:00'},'2026-10-13':{score:2.2,index:73,band:'높음',peak:'2026-10-13T15:00:00+09:00'}};
 // §16.1 ②(2026-10-16): 하루 안내 daily.notices — 오늘은 가장 높은 칸(18시) 밖에만 특보(11~15시 발효)·표류(12시), 18~21시 예비. 내일은 없음. 서버 묶음 규칙은 test_risk_store 가 본다.
 // 표류 target(§11.10.36) = 서버 risk_score.driftTarget(칸 시각의 KST 달) — 10월이라 「소형 보트·레저기구」.
 // 결정 1(2026-10-16): 특보는 기상청 시각(발표 issued·발효 예정 effective·해제 예고 release — 서버 warnTimes 꼴)을 싣는다. 태풍 예비는 시각을 못 읽은 경우(칸 기준).
 const NOTES={'2026-10-12':[{key:'warning',name:'풍랑주의보',state:'발효',from:at,to:'2026-10-12T21:00:00+09:00',issued:{start:'2026-10-12T05:00:00+09:00',end:'2026-10-12T05:00:00+09:00',range:false},effective:null,release:{start:'2026-10-13T03:00:00+09:00',end:'2026-10-13T06:00:00+09:00',range:true}},{key:'drift',windMs:8.6,target:require('../services/risk_score').driftTarget('2026-10-12T12:00:00+09:00'),from:'2026-10-12T12:00:00+09:00',to:'2026-10-12T12:00:00+09:00'},{key:'warning',name:'강풍주의보',state:'예비',from:'2026-10-12T18:00:00+09:00',to:'2026-10-12T21:00:00+09:00',issued:{start:'2026-10-12T10:30:00+09:00',end:'2026-10-12T10:30:00+09:00',range:false},effective:{start:'2026-10-12T21:00:00+09:00',end:'2026-10-13T00:00:00+09:00',range:true},release:null},{key:'warning',name:'태풍주의보',state:'예비',from:'2026-10-12T18:00:00+09:00',to:'2026-10-12T21:00:00+09:00',issued:null,effective:null,release:null}],'2026-10-13':[]};
 const store={sources:()=>inputs.sources,marineInputs:()=>inputs,
  meta:()=>({now:at,versions:{spots:'v1',cells:1,accident:'v1'},timeline:{sea:{times:seaTimes},accident:{times:coastTimes},coast:{times:coastTimes}},sources:inputs.sources}),
  spots:()=>({spots}),cells:()=>({cells:[cell]}),accidentCells:()=>({v:'v1',cells:[acc]}),accidentFrame:()=>({v:'v1',cells:[[0,.001,'경계']]}),
  frame:()=>({cells:[[0,0,1,'낮음']],spots:[],borders:[]}),
  coastDayFrame:t=>{t=valid(t);log.coast.push(t);return{t,spots:spots.map(s=>[s.i,DAY[T.dateKey(t)].score]),degraded:[],daily:{date:T.dateKey(t),times:coastTimes.filter(x=>T.dateKey(x)===T.dateKey(t))}};},
  coastDayDetail:(id,t)=>{t=valid(t);log.spot.push({id,t});const d=DAY[T.dateKey(t)],sp=spots.find(s=>s.id===id);return{t:d.peak,title:sp.name,subtitle:{police:'제주파출소',office:'제주해양경찰서'},score:d.score,index:d.index,band:d.band,rr:2**d.score,fatalRr:1.3,rows:[{key:'event',name:'행사 '+id+'@'+T.dateKey(t),weekend:true,rr:1.2,events:[]}],missing:[],notices:[],history:{available:false},daily:{date:T.dateKey(t),peakAt:d.peak,times:coastTimes.filter(x=>T.dateKey(x)===T.dateKey(t)),notices:NOTES[T.dateKey(t)]}};},
  islands:()=>({features:[]})};
 const marine=M.createStore({risk:store,dir,clock:()=>now,stations:[{properties:{name:'제주파출소',station:'제주해양경찰서'},geometry}],accidents:[],describe:()=>cell});
 // §18(2026-10-18) 해수욕장 안내 줄 — 가짜(S1 만, 날짜마다 다른 줄). 판단·문구 자체는 test_beach_weather 가 본다.
 const BEACH={'S1@2026-10-12':['가짜해수욕장이 개장 기간(7.10~8.23)이라 사람이 많이 몰릴 수 있습니다.','가짜해수욕장(1.2km) — 수온 22℃로 따뜻하지만 파도가 1.8m로 높고 바람이 초속 9m로 강해 물에 들어가기에 적절하지 않습니다.'],'S1@2026-10-13':['가짜해수욕장(1.2km) — 수온 22℃ · 낮 최고 27℃ · 파도 0.5m로 바닷물에 들어가 물놀이하기 좋은 날씨입니다. 물에 들어가는 사람이 많을 수 있습니다.']};
 const app=express();app.use(createRouter({store,marine,beach:(id,date)=>BEACH[id+'@'+date]||[]}));
 app.get('/',(req,res)=>res.sendFile(path.join(root,'client/index2.html')));
 app.use(express.static(path.join(root,'client')));
 app.use('/api',(req,res)=>res.status(404).json({ok:false}));
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({...((process.env.PW_CHROME||process.env.SIM_CHROMIUM||process.env.CHROMIUM_EXECUTABLE)?{executablePath:process.env.PW_CHROME||process.env.SIM_CHROMIUM||process.env.CHROMIUM_EXECUTABLE}:{}),headless:true,args:['--no-sandbox']});
 let page,errors=[];
 /** 앱을 새로 띄워 해양안전 → 위험예측(한 번 누름 — 2026-10-18 일반 공개로 잠금 없음)까지 켠다. 시험 서버에 공지 등이 없어 뜨는 「서버 연결 불가」 팝업은 시험 화면에서 지운다(위험예측과 무관). @param {number} width @returns {Promise<void>} */
 async function boot(width){if(page)await page.context().close();const ctx=await browser.newContext({viewport:{width,height:width<600?780:800}});page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
  await page.goto(base+'/');await page.waitForFunction(()=>typeof window.switchMainTab==='function'&&document.getElementById('ocean-risk-forecast-toggle-btn'));await page.waitForTimeout(600);
  await page.evaluate(()=>document.querySelector('.main-tabs .tab-btn[data-target="ocean-life-group"]').click());await page.waitForTimeout(600);
  await page.evaluate(()=>document.getElementById('ocean-risk-forecast-toggle-btn').click());
  await page.waitForFunction(()=>window._riskForecastApp&&window._riskForecastApp.getState().enabled&&!document.querySelector('.rf-date-nav').hidden,null,{timeout:10000});
  await page.evaluate(()=>{const v=window.getOceanMap().getView();v.setCenter(ol.proj.fromLonLat([126.56,33.44]));v.setZoom(11);});await page.waitForTimeout(800);
  await page.evaluate(()=>{const p=document.getElementById('server-maintenance-popup');if(p)p.remove();});}
 const S=()=>page.evaluate(()=>{const a=window._riskForecastApp.getState(),nav=document.querySelector('.rf-date-nav'),bar=document.querySelector('.rf-marine-timebar'),sh=document.getElementById('risk-forecast-sheet'),q=s=>sh.querySelector(s);
  return{t:a.t,sea:a.sea,coast:a.coast,selected:a.selected&&a.selected.id,nav:!nav.hidden&&nav.getClientRects().length>0,label:nav.querySelector('[data-day-label]').textContent,tag:nav.querySelector('[data-day-tag]').textContent,prev:nav.querySelector('[data-day-step="-1"]').disabled,next:nav.querySelector('[data-day-step="1"]').disabled,
   bar:!bar.hidden,seaTimeOn:document.body.classList.contains('rf-sea-time-on'),open:sh.classList.contains('open'),title:(q('.rf-title')||{}).textContent,sheetDate:(q('[data-sheet-date]')||{}).textContent||null,peak:(q('[data-sheet-peak]')||{}).textContent||null,
   sheetPrev:q('[data-sheet-day="-1"]')?q('[data-sheet-day="-1"]').disabled:null,sheetNext:q('[data-sheet-day="1"]')?q('[data-sheet-day="1"]').disabled:null,body:(q('.rf-body')||{}).textContent||'',busy:sh.hasAttribute('aria-busy'),
   coastScores:window.getOceanMap().getLayers().getArray().find(l=>l.getClassName()==='rf-coast-canvas').getSource().getFeatures().map(f=>f.get('score')).sort()};});
 const navClick=d=>page.evaluate(d=>document.querySelector('.rf-date-nav [data-day-step="'+d+'"]').click(),String(d));
 const sheetClick=d=>page.evaluate(d=>document.querySelector('#risk-forecast-sheet [data-sheet-day="'+d+'"]').click(),String(d));
 const step=h=>page.evaluate(h=>document.querySelector('[data-time-step="'+h+'"]').click(),String(h));
 const ready=()=>page.waitForFunction(()=>{const s=document.getElementById('risk-forecast-sheet');return s.classList.contains('open')&&!s.hasAttribute('aria-busy')&&getComputedStyle(s).transform.replace(/\s/g,'')==='matrix(1,0,0,1,0,0)';},null,{timeout:8000});
 /** 지도 연안 면이 모두 그 하루 값이 될 때까지 기다린다(못 되면 실제 값을 실패 글에 남긴다). @param {number} score @returns {Promise<void>} */
 const waitCoast=async score=>{try{await page.waitForFunction(v=>{const l=window.getOceanMap().getLayers().getArray().find(l=>l.getClassName()==='rf-coast-canvas');const s=l.getSource().getFeatures().map(f=>f.get('score'));return s.length&&s.every(x=>x===v);},score,{timeout:8000});}catch(e){throw Error('연안 지도 값 '+score+' 이 아님: '+JSON.stringify((await S()).coastScores));}};
 const toast=()=>page.evaluate(()=>{const el=document.querySelector('.rf-time-toast');return{hidden:el.hidden,text:el.textContent,role:el.getAttribute('role'),live:el.getAttribute('aria-live')};});
 /** 화면 픽셀(지도 좌표) — 실제 마우스 누르기용. @param {number} lon @param {number} lat @returns {Promise<number[]>} */
 //   관광지는 상단 날짜 줄(380px 125~165px)과 시트(242px~) 사이 지도에 오도록 지도를 33.44 에 맞춰 두었다. 그 자리를 누르면 지도(.ol-viewport)가 받는지도 확인한다 — 시트나 버튼에 가려 지도에 닿지 않으면 「무시」를 시험할 수 없다.
 const px=async(lon,lat)=>{const r=await page.evaluate(([lon,lat])=>{const m=window.getOceanMap(),p=m.getPixelFromCoordinate(ol.proj.fromLonLat([lon,lat])),b=m.getTargetElement().getBoundingClientRect(),x=b.left+p[0],y=b.top+p[1],hit=document.elementFromPoint(x,y);return{xy:[x,y],map:!!(hit&&hit.closest('.ol-viewport'))};},[lon,lat]);assert.ok(r.map,'누를 자리가 지도에 닿아야 함 '+JSON.stringify(r));return r.xy;};
 const closeSheet=async()=>{await page.evaluate(()=>document.querySelector('#risk-forecast-sheet .rf-close').click());await page.waitForFunction(()=>!document.getElementById('risk-forecast-sheet').classList.contains('rf-shown'));};
 /** 우리 날짜 줄과 항행경보 날짜 줄(#navwarn-date-nav)의 계산된 모양을 함께 잰다. 항행경보 줄은 잠깐 보이게 해 같은 글자를 넣고 재고 되돌린다(앱 상태는 건드리지 않음). @returns {Promise<Object>} */
 const navLook=()=>page.evaluate(()=>{const pick=el=>{const c=getComputedStyle(el),r=el.getBoundingClientRect(),b=el.querySelector('button'),bc=getComputedStyle(b),l=el.querySelector('[class*="date-label"]'),g=el.querySelector('[class*="date-tag"]');return{top:Math.round(r.top),cx:Math.round((r.left+r.right)/2),h:Math.round(r.height),pos:c.position,radius:c.borderRadius,bg:c.backgroundColor,border:c.borderTopColor,pad:c.padding,gap:c.columnGap,z:c.zIndex,btn:[Math.round(b.getBoundingClientRect().width),Math.round(b.getBoundingClientRect().height),bc.borderRadius,bc.backgroundColor],label:[getComputedStyle(l).fontSize,getComputedStyle(l).fontWeight],tag:[getComputedStyle(g).fontSize,getComputedStyle(g).padding,getComputedStyle(g).backgroundColor]};};
  const ours=document.querySelector('.rf-date-nav'),nw=document.getElementById('navwarn-date-nav'),keep=[nw.style.display,nw.querySelector('#navwarn-date-label').textContent,nw.querySelector('#navwarn-date-tag').textContent];
  nw.style.display='flex';nw.querySelector('#navwarn-date-label').textContent=ours.querySelector('[data-day-label]').textContent;nw.querySelector('#navwarn-date-tag').textContent=ours.querySelector('[data-day-tag]').textContent;
  const out={ours:pick(ours),navwarn:pick(nw),legend:(r=>({l:r.left,r:r.right,t:r.top,b:r.bottom}))(document.getElementById('risk-forecast-legend').getBoundingClientRect()),ourBox:(r=>({l:r.left,r:r.right,t:r.top,b:r.bottom}))(ours.getBoundingClientRect()),width:innerWidth,sameParent:ours.parentElement===nw.parentElement,classes:ours.className};
  nw.style.display=keep[0];nw.querySelector('#navwarn-date-label').textContent=keep[1];nw.querySelector('#navwarn-date-tag').textContent=keep[2];return out;});
 const apart=(a,b)=>a.r<=b.l||b.r<=a.l||a.b<=b.t||b.b<=a.t;

 await boot(380);
 await check('T24 연안만(380px): 하단 시간 바 없음·body.rf-sea-time-on 없음(출처·축척 원위치), 상단 날짜 줄 「10월 12일 (월) 오늘」·오늘 앞 비활성',async()=>{
  await waitCoast(1.2);const s=await S();
  assert.deepEqual([s.bar,s.seaTimeOn,s.nav,s.label,s.tag,s.prev,s.next,s.sea],[false,false,true,'10월 12일 (월)','오늘',true,false,false]);
  const g=await page.evaluate(()=>{const r=e=>e.getBoundingClientRect(),tabs=r(document.querySelector('.main-tabs')||document.querySelector('nav'));return{attr:r(document.querySelector('.ol-attribution')).bottom,scale:r(document.querySelector('.ol-scale-line')).bottom,chrome:parseFloat(getComputedStyle(document.body).getPropertyValue('--ls-bottom-chrome'))||null,h:innerHeight};});
  console.log('측정 연안만 출처·축척 아래끝',JSON.stringify(g));
  for(const k of ['attr','scale'])assert.ok(Math.abs(g.h-g.chrome-6-g[k])<=1.5,k+' 는 원래 자리(하단 탭 위 6px — index2.html body.ls-mode.ls-safety 규칙): '+g[k]);
  assert.deepEqual(log.coast.every(t=>t===at),true,'연안 요청은 오늘 = 지금(첫 칸)');
  if(SHOTS)await page.screenshot({path:path.join(SHOTS,'day-380-연안만.png')});
 });
 await check('T24 380px 상단 날짜 줄 = 항행경보 날짜 줄과 같은 클래스·모양(계산된 높이·모서리·바탕·테두리·여백·버튼 26px·글자), 가운데, 왼쪽 위 토글 범례와 겹치지 않게 그 바로 아래',async()=>{
  const m=await navLook();console.log('측정 380 날짜 줄',JSON.stringify(m));
  assert.equal(m.sameParent,true,'항행경보 날짜 줄과 같은 부모(지도 감싸개) — 같은 기준으로 top 이 잡힌다');assert.ok(/\bnavwarn-date-nav\b/.test(m.classes));
  for(const k of ['h','pos','radius','bg','border','pad','gap','z','btn','label','tag'])assert.deepEqual(m.ours[k],m.navwarn[k],'항행경보와 같은 '+k);
  assert.ok(Math.abs(m.ours.cx-m.width/2)<=1,'가운데');assert.equal(m.navwarn.top,66,'항행경보 자리 66px');
  assert.ok(apart(m.ourBox,m.legend),'토글 범례와 안 겹침 '+JSON.stringify([m.ourBox,m.legend]));assert.ok(m.ourBox.t>=m.legend.b&&m.ourBox.t-m.legend.b<=7,'범례 바로 아래(6px) — 380px 에서는 66px 자리가 범례와 겹친다');
 });
 await check('T24 오늘 < 와 내일 > 는 비활성(disabled·aria-disabled·opacity .3) — 눌러도 시각·요청·토스트 없음',async()=>{
  const look=()=>page.evaluate(()=>Array.from(document.querySelectorAll('.rf-date-nav [data-day-step]')).map(b=>[b.disabled,b.getAttribute('aria-disabled'),getComputedStyle(b).opacity]));
  assert.deepEqual(await look(),[[true,'true','0.3'],[false,'false','1']]);const n=log.coast.length;await navClick(-1);await page.waitForTimeout(300);
  assert.equal((await S()).t,at);assert.equal(log.coast.length,n);assert.equal((await toast()).hidden,true);
  await navClick(1);await page.waitForFunction(t=>window._riskForecastApp.getState().t===t,TOMORROW);assert.deepEqual(await look(),[[false,'false','1'],[true,'true','0.3']]);
  const n2=log.coast.length;await page.waitForFunction(()=>document.querySelector('.rf-time-toast').hidden,null,{timeout:4000});await navClick(1);await page.waitForTimeout(300);assert.equal((await S()).t,TOMORROW);assert.equal(log.coast.length,n2,'모레는 요청하지 않는다');assert.equal((await toast()).hidden,true);
  await navClick(-1);await page.waitForFunction(t=>window._riskForecastApp.getState().t===t,at);
 });
 await check('T24 날짜 넘기기: 내일 → 지도 연안 = 내일 하루 값·요청은 내일 00시·토스트 「10월 13일 (화) 예보」(탭 위, 출처·축척·색 범례와 안 겹침) · 오늘 → 지금·「오늘 10월 12일 (월)」',async()=>{
  await page.waitForFunction(()=>document.querySelector('.rf-time-toast').hidden,null,{timeout:4000});
  await navClick(1);await waitCoast(2.2);let s=await S(),x=await toast();
  assert.deepEqual([s.t,s.label,s.tag,s.prev,s.next],[TOMORROW,'10월 13일 (화)','내일',false,true]);assert.equal(log.coast.at(-1),TOMORROW);
  assert.deepEqual([x.hidden,x.text,x.role,x.live],[false,'10월 13일 (화) 예보','status','polite']);
  const g=await page.evaluate(()=>{const r=e=>{const b=e.getBoundingClientRect();return{l:b.left,r:b.right,t:b.top,b:b.bottom};};return{toast:r(document.querySelector('.rf-time-toast')),attr:r(document.querySelector('.ol-attribution')),scale:r(document.querySelector('.ol-scale-line')),legend:r(document.querySelector('.rf-color-legend')),tabs:r(document.querySelector('.main-tabs')),w:innerWidth};});
  console.log('측정 날짜 토스트 380',JSON.stringify(g));for(const k of ['attr','scale','legend'])assert.ok(apart(g.toast,g[k]),'토스트와 '+k+' 안 겹침');assert.ok(g.toast.b<=g.tabs.t,'토스트는 탭 위');assert.ok(g.toast.l>=0&&g.toast.r<=g.w);
  if(SHOTS)await page.screenshot({path:path.join(SHOTS,'day-380-내일-토스트.png')});
  await navClick(-1);await waitCoast(1.2);s=await S();x=await toast();assert.deepEqual([s.t,s.tag,s.prev,s.next],[at,'오늘',true,false]);assert.equal(x.text,'오늘 10월 12일 (월)');
  assert.ok(log.coast.every(t=>t===at||t===TOMORROW),'연안 요청은 날짜의 첫 칸으로만');assert.deepEqual(log.bad,[]);
 });
 await check('T24 상단에서 넘기면 열린 연안 시트도 함께(날짜 줄·「가장 높은 때」·내용), 시트 < > 로 넘기면 상단도 함께',async()=>{
  await page.evaluate(()=>window._riskForecastApp.select('coast','S1'));await ready();let s=await S();
  assert.deepEqual([s.title,s.sheetDate,s.peak,s.sheetPrev,s.sheetNext],['가짜해변',"'26. 10. 12.(월)",'가장 높은 때 18시 기준',true,false]);assert.ok(s.body.includes('행사 S1@2026-10-12'));
  assert.equal(s.nav,false,'2026-10-18 「바텀시트 자체에서 넘길 수 있으니」 — 연안 시트가 열린 동안 상단 날짜 줄 숨김');
  await navClick(1);await page.waitForFunction(()=>document.querySelector('#risk-forecast-sheet .rf-body').textContent.includes('@2026-10-13'));await ready();s=await S();
  assert.deepEqual([s.sheetDate,s.peak,s.sheetPrev,s.sheetNext,s.label],["'26. 10. 13.(화)",'가장 높은 때 15시 기준',false,true,'10월 13일 (화)'],'상단 → 시트');assert.equal(log.spot.at(-1).t,TOMORROW);
  if(SHOTS)await page.screenshot({path:path.join(SHOTS,'day-380-시트-내일.png')});
  await sheetClick(-1);await page.waitForFunction(()=>document.querySelector('#risk-forecast-sheet .rf-body').textContent.includes('@2026-10-12'));await ready();s=await S();
  assert.deepEqual([s.t,s.label,s.tag,s.sheetDate,s.peak,s.nav],[at,'10월 12일 (월)','오늘',"'26. 10. 12.(월)",'가장 높은 때 18시 기준',false],'시트 → 상단(숨긴 채 값만)');assert.equal((await toast()).text,'오늘 10월 12일 (월)','시트에서 넘겨도 같은 토스트');
  if(SHOTS)await page.screenshot({path:path.join(SHOTS,'day-380-시트-오늘.png')});
 });
 await check('§16.1 ② + 결정 1 연안 시트 안내: 그날 남은 칸 어느 칸이든 특보·표류가 있으면 — 특보는 기상청 시각(발표·발효 예정·해제 예고), 못 읽은 것만 칸 시각+「칸 기준」, 표류는 칸 시각(12시 무렵), 특보 없는 날은 안내 없음',async()=>{
  // 2026-10-18 연안 시트 시안: 특보·표류는 주황 상자(.rf-notice) 하나 안의 줄(.rf-notice-line) — 글자 ⚠·🛟 대신 그림(SVG), 특보 이름·상태는 빨강 굵게, 「특보 중에는…」은 다음 줄.
  const notes=()=>page.evaluate(()=>[...document.querySelectorAll('#risk-forecast-sheet .rf-body .rf-notice-line')].map(e=>e.textContent));
  const boxes=()=>page.evaluate(()=>document.querySelectorAll('#risk-forecast-sheet .rf-body .rf-notice').length);
  assert.equal((await S()).peak,'가장 높은 때 18시 기준');
  assert.equal(await boxes(),1,'특보·표류가 한 상자');
  assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('#risk-forecast-sheet .rf-notice .rf-warn-name')].map(b=>[b.textContent,getComputedStyle(b).color])),[['강풍주의보 예비특보','rgb(239, 68, 68)'],['태풍주의보 예비특보','rgb(239, 68, 68)'],['풍랑주의보 발효 중','rgb(239, 68, 68)']],'특보 이름·상태 빨강 굵게');
  assert.equal(await page.evaluate(()=>document.querySelectorAll('#risk-forecast-sheet .rf-notice-line svg').length),2,'줄마다 그림');
  assert.deepEqual(await notes(),['강풍주의보 예비특보 — 21~24시 발효 예정. 태풍주의보 예비특보 — 18시~(칸 기준). 풍랑주의보 발효 중 — 13일 03~06시 해제 예고.특보 중에는 사고는 평소보다 적지만, 사고가 나면 사망·실종으로 이어질 가능성이 14% 높습니다.','12시 무렵 바람 9m/s로 소형 보트·레저기구 등 표류 주의'],'결정 1: 발효 = 해제 예고 시각(다른 날 「13일」)·발표 시각, 예비 = 발효 예정 시각(범위 21~24시), 시각 없으면 칸 시각+「칸 기준」, 「더 일찍 풀릴」 없음');
  assert.ok(!/더 일찍/.test((await notes()).join('')),'「더 일찍 풀릴 수 있음」 없음');
  if(SHOTS){await page.evaluate(()=>document.querySelector('#risk-forecast-sheet .rf-notice').scrollIntoView({block:'center'}));await page.screenshot({path:path.join(SHOTS,'day-380-시트-안내.png')});}
  await sheetClick(1);await page.waitForFunction(()=>document.querySelector('#risk-forecast-sheet .rf-body').textContent.includes('@2026-10-13'));await ready();
  assert.deepEqual(await notes(),[],'내일(특보·표류 없음) → 안내 없음');
  await sheetClick(-1);await page.waitForFunction(()=>document.querySelector('#risk-forecast-sheet .rf-body').textContent.includes('@2026-10-12'));await ready();
  assert.equal((await notes()).length,2,'오늘로 돌아오면 다시');
 });
 await check('§18 연안 시트 해수욕장 안내 줄: 특보·표류 상자 바로 아래 하늘색 상자 · 개장 줄 → 입수 줄 서버 글 그대로 · 날짜 < > 로 내일 줄 · 줄 없는 관광지는 상자 없음',async()=>{
  const beach=()=>page.evaluate(()=>{const b=document.querySelector('#risk-forecast-sheet .rf-body .rf-beach');if(!b)return null;const prev=b.previousElementSibling,next=b.nextElementSibling,cs=getComputedStyle(b);return{lines:[...b.querySelectorAll('.rf-beach-line')].map(e=>e.textContent),prev:prev&&prev.className,next:next&&next.className,bg:cs.backgroundColor,overflow:document.documentElement.scrollWidth>innerWidth};});
  let b=await beach();
  assert.deepEqual(b.lines,BEACH['S1@2026-10-12']);assert.equal(b.prev,'rf-notice');assert.equal(b.next,'rf-coast-rows');assert.equal(b.bg,'rgba(56, 189, 248, 0.1)');assert.equal(b.overflow,false);
  await page.setViewportSize({width:360,height:780});await page.waitForTimeout(250);
  if(SHOTS){await page.evaluate(()=>document.querySelector('#risk-forecast-sheet .rf-beach').scrollIntoView({block:'center'}));await page.screenshot({path:path.join(SHOTS,'beach_coast_sheet_today_360.png')});}
  assert.equal((await beach()).overflow,false,'360px 가로 넘침 없음');
  await sheetClick(1);await page.waitForFunction(()=>document.querySelector('#risk-forecast-sheet .rf-body').textContent.includes('@2026-10-13'));await ready();
  b=await beach();assert.deepEqual(b.lines,BEACH['S1@2026-10-13']);assert.equal(b.next,'rf-coast-rows','특보 없는 날은 위험지수 카드 바로 아래');
  if(SHOTS){await page.evaluate(()=>document.querySelector('#risk-forecast-sheet .rf-beach').scrollIntoView({block:'center'}));await page.screenshot({path:path.join(SHOTS,'beach_coast_sheet_tomorrow_360.png')});}
  await sheetClick(-1);await page.waitForFunction(()=>document.querySelector('#risk-forecast-sheet .rf-body').textContent.includes('@2026-10-12'));await ready();
  await page.setViewportSize({width:380,height:780});await page.waitForTimeout(250);
  assert.ok(await page.evaluate(()=>!!document.querySelector('#risk-forecast-sheet .rf-beach')));
 });
 await check('T24 「나. 무시」 실제 앱 지도 누르기(ocean_map.js 경로): 연안 시트가 열린 동안 같은 위치 관광지·열린 그 관광지 누름은 무시 — 시트 다시 그림 없음·테두리·제목·요청 그대로',async()=>{
  const sel=()=>page.evaluate(()=>window.getOceanMap().getLayers().getArray().find(l=>l.getClassName()==='rf-selection-canvas').getSource().getFeatures().length);
  const before=await S(),n=log.spot.length,b0=await sel();
  // 표식: 시트 본문에 글자 하나를 끼워 둔다 — 누름이 시트를 다시 그리면(회색 틀·새 응답) 사라진다.
  const mark=()=>page.evaluate(()=>{const m=document.createElement('i');m.id='t24-mark';document.querySelector('#risk-forecast-sheet .rf-body').appendChild(m);}),marked=()=>page.evaluate(()=>!!document.getElementById('t24-mark'));
  for(const [what,lon,lat] of [['같은 위치 관광지(선택 목록)',126.62,33.53],['열린 그 관광지',126.506,33.536]]){
   await mark();const [x,y]=await px(lon,lat);await page.mouse.click(x,y);await page.waitForTimeout(400);
   const s=await S();assert.deepEqual([s.selected,s.title,s.open],[before.selected,before.title,true],what+' — 선택·제목 그대로');assert.equal(await marked(),true,what+' — 시트를 다시 그리지 않음');
   assert.equal(await page.evaluate(()=>document.querySelectorAll('#risk-forecast-sheet [data-spot-id]').length),0,what+' — 선택 목록으로 바뀌지 않음');assert.equal(log.spot.length,n,what+' — 상세 요청 없음');assert.equal(await sel(),b0,what+' — 테두리 그대로');}
 });
 await check('T24 「나. 무시」 예외: 열린 동안에도 [기준 상세]·Escape·✕ 는 그대로',async()=>{
  await page.evaluate(()=>document.querySelector('#risk-forecast-sheet .rf-head-basis').click());await page.waitForSelector('.rf-basis');assert.equal(await page.evaluate(()=>document.querySelector('.rf-basis h3').textContent),'연안 위험지수');
  assert.ok((await page.evaluate(()=>document.querySelector('.rf-basis').textContent)).includes('하루 하나 — 그날 가장 높은 값'),'기준 상세에 「하루 하나」');
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.rf-basis'));assert.equal((await S()).open,true,'Escape 는 기준 상세만 닫는다');
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.getElementById('risk-forecast-sheet').classList.contains('open'));assert.equal((await S()).selected,null,'Escape 로 시트 닫힘');
  await page.waitForFunction(()=>!document.getElementById('risk-forecast-sheet').classList.contains('rf-shown'));
  await page.evaluate(()=>window._riskForecastApp.select('coast','S1'));await ready();await closeSheet();assert.equal((await S()).selected,null,'✕ 로 닫힘');assert.equal((await S()).nav,true,'닫으면 상단 날짜 줄이 다시 보인다(2026-10-18)');
 });
 await check('T24 같은 위치 관광지: 닫힌 상태에서 지도 누름 → 선택 목록, 목록이 열린 동안 지도 누름은 무시, 목록 안 관광지 버튼(시트 안)은 동작',async()=>{
  const [x,y]=await px(126.62,33.53);await page.mouse.click(x,y);await page.waitForFunction(()=>document.getElementById('risk-forecast-sheet').classList.contains('open')&&document.querySelectorAll('#risk-forecast-sheet [data-spot-id]').length===2);
  let s=await S();assert.equal(s.title,'관광지 선택');const [x1,y1]=await px(126.506,33.536);await page.mouse.click(x1,y1);await page.waitForTimeout(400);s=await S();assert.equal(s.title,'관광지 선택','목록이 열린 동안 다른 관광지 누름 무시');
  await page.evaluate(()=>document.querySelector('#risk-forecast-sheet [data-spot-id="S3"]').click());await page.waitForFunction(()=>document.querySelector('#risk-forecast-sheet .rf-title').textContent==='같은자리2');await ready();
  s=await S();assert.deepEqual([s.selected,s.sheetDate],['S3',"'26. 10. 12.(월)"],'목록 안 버튼은 받아들이고 메인 날짜로');await closeSheet();
 });
 await check('T24 해상 켬: 상단 날짜 줄 숨김·하단 5버튼 그대로(body.rf-sea-time-on) — +3H 로 자정을 넘으면 연안 지도·열린 연안 시트가 내일로(KST 00시), 21시는 오늘',async()=>{
  await page.evaluate(()=>document.querySelector('[data-layer="sea"]').click());await page.waitForFunction(()=>window._riskForecastApp.getState().sea&&!document.querySelector('.rf-marine-timebar').hidden);
  let s=await S();assert.deepEqual([s.nav,s.bar,s.seaTimeOn],[false,true,true]);
  if(SHOTS)await page.screenshot({path:path.join(SHOTS,'day-380-해상연안.png')});
  for(const h of [3,3,3,3])await step(h);await page.waitForFunction(()=>window._riskForecastApp.getState().t==='2026-10-12T21:00:00+09:00');await waitCoast(1.2);
  await page.evaluate(()=>window._riskForecastApp.select('coast','S1'));await ready();s=await S();assert.equal(s.sheetDate,"'26. 10. 12.(월)",'21시는 오늘');
  await step(3);await page.waitForFunction(t=>window._riskForecastApp.getState().t===t,TOMORROW);await waitCoast(2.2);await page.waitForFunction(()=>document.querySelector('#risk-forecast-sheet .rf-body').textContent.includes('@2026-10-13'));
  s=await S();assert.deepEqual([s.sheetDate,s.peak,s.open],["'26. 10. 13.(화)",'가장 높은 때 15시 기준',true],'00시는 내일 — 열린 시트도 함께');
  await step(-3);await page.waitForFunction(()=>window._riskForecastApp.getState().t==='2026-10-12T21:00:00+09:00');await waitCoast(1.2);await page.waitForFunction(()=>document.querySelector('#risk-forecast-sheet .rf-body').textContent.includes('@2026-10-12'));
  await step('now');await page.waitForFunction(t=>window._riskForecastApp.getState().t===t,at);
 });
 await check('T24 해상 켬 + 연안 시트 < >: 그 날짜의 같은 시각이 든 칸 — 오늘 15시 → 내일 15시, 지금 11시 → 내일 09시 칸, 내일 09시 < → 지금(지난 시각이면 지금)·토스트는 시각 꼴',async()=>{
  await step(3);await step(3);await page.waitForFunction(()=>window._riskForecastApp.getState().t==='2026-10-12T15:00:00+09:00');
  await sheetClick(1);await page.waitForFunction(()=>window._riskForecastApp.getState().t==='2026-10-13T15:00:00+09:00');assert.equal((await toast()).text,'13.(화) 15:00 예보');
  await page.waitForFunction(()=>document.querySelector('#risk-forecast-sheet [data-sheet-date]').textContent==="'26. 10. 13.(화)");
  await sheetClick(-1);await page.waitForFunction(()=>window._riskForecastApp.getState().t==='2026-10-12T15:00:00+09:00');
  await step('now');await page.waitForFunction(t=>window._riskForecastApp.getState().t===t,at);
  await sheetClick(1);await page.waitForFunction(()=>window._riskForecastApp.getState().t==='2026-10-13T09:00:00+09:00');
  await sheetClick(-1);await page.waitForFunction(t=>window._riskForecastApp.getState().t===t,at);assert.equal((await toast()).text,'현재 12.(월) 11:00');
  // 「나. 무시」 예외: 열린 동안에도 하단 시간 버튼·토글은 그대로
  const s=await S();assert.equal(s.open,true);await step(3);await page.waitForFunction(()=>window._riskForecastApp.getState().t==='2026-10-12T12:00:00+09:00');assert.equal((await S()).open,true);await step('now');
 });
 await check('T24 해상 끄면 상단 날짜 줄로 — 그 시각의 날짜(내일 15시였으면 「10월 13일 (화) 내일」), 해상 시간 바·rf-sea-time-on 해제',async()=>{
  await page.waitForFunction(t=>window._riskForecastApp.getState().t===t,at);
  for(const h of [6,6,6,6])await step(h);await page.waitForFunction(()=>window._riskForecastApp.getState().t==='2026-10-13T09:00:00+09:00');
  await page.evaluate(()=>document.querySelector('[data-layer="sea"]').click());await page.waitForFunction(()=>!window._riskForecastApp.getState().sea);
  const s=await S();assert.deepEqual([s.nav,s.bar,s.seaTimeOn,s.label,s.tag,s.t,s.sheetDate,s.open],[false,false,false,'10월 13일 (화)','내일','2026-10-13T09:00:00+09:00',"'26. 10. 13.(화)",true],'열린 연안 시트·상단 날짜가 그 시각의 날짜(시트가 열려 있어 상단 줄은 숨김 — 2026-10-18)');
  await closeSheet();assert.equal((await S()).nav,true,'닫으면 상단 날짜 줄');await navClick(-1);await page.waitForFunction(t=>window._riskForecastApp.getState().t===t,at);
 });
 await boot(1280);
 await check('T24 1280px: 상단 날짜 줄은 항행경보와 같은 자리(top 66px·가운데)·같은 모양 — 범례와 안 겹침',async()=>{
  await waitCoast(1.2);const m=await navLook();console.log('측정 1280 날짜 줄',JSON.stringify(m));
  for(const k of ['top','cx','h','radius','bg','pad','btn','label','tag'])assert.deepEqual(m.ours[k],m.navwarn[k],'항행경보와 같은 '+k);assert.equal(m.ours.top,66);assert.ok(apart(m.ourBox,m.legend));
  if(SHOTS)await page.screenshot({path:path.join(SHOTS,'day-1280-연안만.png')});
  await page.evaluate(()=>window._riskForecastApp.select('coast','S1'));await ready();if(SHOTS)await page.screenshot({path:path.join(SHOTS,'day-1280-시트.png')});
  const g=await page.evaluate(()=>{const r=e=>e.getBoundingClientRect(),row=r(document.querySelector('#risk-forecast-sheet .rf-sheet-day')),sh=r(document.getElementById('risk-forecast-sheet'));return{cx:(row.left+row.right)/2,sx:(sh.left+sh.right)/2};});assert.ok(Math.abs(g.cx-g.sx)<=2,'시트 날짜 줄 가운데');
  await closeSheet();await page.evaluate(()=>document.querySelector('[data-layer="sea"]').click());await page.waitForFunction(()=>!document.querySelector('.rf-marine-timebar').hidden);if(SHOTS)await page.screenshot({path:path.join(SHOTS,'day-1280-해상연안.png')});
 });
 await check('T24 해양안전 「항행경보」와 위험예측은 동시에 켜지지 않는다(단독 오버레이 SOLO_BTN_IDS) — 항행경보를 켜면 위험예측·날짜 줄이 꺼지고 항행경보 날짜 줄만',async()=>{
  await page.evaluate(()=>document.getElementById('ocean-navwarn-btn').click());await page.waitForFunction(()=>!document.getElementById('ocean-risk-forecast-toggle-btn').classList.contains('active'));
  const r=await page.evaluate(()=>({risk:window._riskForecastApp.getState().enabled,ours:document.querySelector('.rf-date-nav').hidden,nav:getComputedStyle(document.getElementById('navwarn-date-nav')).display}));
  assert.deepEqual(r,{risk:false,ours:true,nav:'flex'});
  await page.evaluate(()=>document.getElementById('ocean-risk-forecast-toggle-btn').click());await page.waitForFunction(()=>window._riskForecastApp.getState().enabled);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.getElementById('navwarn-date-nav')).display),'none','위험예측을 켜면 항행경보(날짜 줄 포함)가 꺼진다');
 });
 await check('실행 오류 없음',()=>assert.deepEqual(errors,[]));
}catch(e){console.error('❌ 실행 실패',e.stack||e.message);fail++;}
finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});console.log(`${pass} PASS / ${fail} FAIL`);process.exitCode=fail?1:0;}})();
