/**
 * 파일명: local_server/scripts/test_risk_sea_sheet_ui.js
 * 역할  : 해상 위험 예측·분석 화면(2026-10-15 확정 시안 8차 + 추가 확정 5가지, 지도 조작부 시안)을 실제 Chromium 에서 검사한다.
 *         위 카드(지금: 밀집도 뱃지·척수·충돌주의·혼잡예보 / 미래: 혼잡도 뱃지·혼잡 지수), 「15~18시 예보」 줄 없음, 출처 「해양교통안전공단 API」,
 *         과거 2주간 선박교통량(기록 0일 「-」·「평균 16:00 (3일)」·「2주 평균」, 확대 문턱 아래 점 0개·위 점>0·글자 안 겹침, 핀치·누르기·×50,
 *         시트 시각 이동 시 초기화), 이 해역 과거 선박사고(0건 한 줄·도넛·팝업·인명피해 줄·null 처리), 날씨 아코디언(접힘·5항목),
 *         시트 시각 막대(공식 사고 위험 색·「지금」), 지도 [혼잡도][위험 예측] 단일 선택·해상 OFF 숨김·혼잡도 지금/미래 mode·범례 제목.
 * [연계] 실제 risk_format/api/map_layer/slider/marine/sheet/basis/forecast + risk_forecast.css + client/style.css, 실제 routes/risk_forecast·
 *        marine_fusion 저장소(시계 주입)·sea_traffic_history.createApi(가짜 이력·특보) → verify_all SUITES.
 *        SEA_SHEET_SHOTS=<폴더> 를 주면 380px 폭 화면 사진을 남긴다(검사 판정에는 쓰지 않음).
 * [로드 순서] 독립 검사; 외부 수집·운영 키·Gemini 호출 없음. 현재 시각에 기대지 않는다(서버·이력 시계 2026-10-15 16:12 KST 고정).
 */
'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert'),express=require('express'),{chromium}=require('playwright-core');
const root=path.join(__dirname,'../..'),io=require('../services/risk_collector_io'),M=require('../services/marine_fusion'),H=require('../services/sea_traffic_history'),{createRouter}=require('../routes/risk_forecast');
let pass=0,fail=0;
/** 실제 브라우저 결과를 검사한다. 예: check('위 카드',async()=>{...}) @param {string} name - 검사명 @param {function} fn - 검사 @returns {Promise<void>} [연계] ← 아래 시나리오 / 실패를 모아 요약한다. */
async function check(name,fn){try{await fn();console.log('✅',name);pass++;}catch(e){console.error('❌',name,e.message);fail++;}}
const HR=3600000,MIN30=1800000,now=Date.parse('2026-10-15T16:12:00+09:00'),at='2026-10-15T16:12:00+09:00',SHOTS=process.env.SEA_SHEET_SHOTS||'';
const kst=ms=>new Date(ms+9*HR).toISOString().slice(0,19)+'+09:00',key=ms=>kst(ms).slice(0,13).replace(/[-T]/g,'')+'00';
const dirs=[],tmp=()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'sea-sheet-'));dirs.push(d);return d;};
const geometry={type:'Polygon',coordinates:[[[129.0625,35.025],[129.0875,35.025],[129.0875,35.05],[129.0625,35.05],[129.0625,35.025]]]};
const cell={id:'GR4_F4K23_P4',i:0,lat:35.0375,lon:129.075,geometry,haegu:{label:'99-4',major:99,sub:4},ref:{name:'생도',bearingWord:'남남동',distNm:1.6}};
const accGeom={type:'Polygon',coordinates:[[[129.03,35.0],[129.12,35.0],[129.12,35.08],[129.03,35.08],[129.03,35.0]]]},acc={...cell,id:'7811',geometry:accGeom};
// 공식 사고 3시간 칸(오늘 00시~내일 21시): 오늘 15·18시 보통, 내일 09시 주의, 그 밖은 낮음.
const accLevels={};for(let t=Date.parse('2026-10-15T00:00:00+09:00');t<=Date.parse('2026-10-16T21:00:00+09:00');t+=3*HR){const h=kst(t).slice(5,13);accLevels[key(t)]=h==='10-15T15'||h==='10-15T18'?'보통':h==='10-16T09'?'주의':'낮음';}
/** 선박사고 원본 한 줄(앱 accident_ships_hk 형식). 예: row('ATY027','ACC012',1,0,'20230914') @returns {array} [연계] ← 가짜 사고 목록 */
const row=(type,cause,death,missing,ymd,lat=35.0375,lon=129.075)=>[lat,lon,ymd,'1300','해역',type,cause,null,null,0,death,missing,[],null,null,null];
// 붐비는 해역 14건: 충돌5·접촉3·표류2·침수2·화재1·전복1 → 상위 4종 + 기타(화재·전복). 사망 1(23년 충돌)·실종 2(21년 전복)·인명피해 미기록 1건(접촉).
const busyAccidents=[row('ATY027','ACC012',0,0,'20250814'),row('ATY033','ACC006',0,0,'20250310'),row('ATY019',null,null,null,'20241120'),row('ATY029','ACC017',0,0,'20240603'),row('ATY027',null,1,0,'20230914'),row('ATY036','ACC021',0,0,'20230702'),row('ATY019','ACC012',0,0,'20230211'),row('ATY027',null,0,0,'20221205'),row('ATY029',null,0,0,'20220820'),row('ATY033','ACC011',0,0,'20220515'),row('ATY027','ACC012',0,0,'20211003'),row('ATY018','ACC008',0,2,'20210712'),row('ATY019',null,0,0,'20210405'),row('ATY027',null,0,0,'20210110')];
const farAccidents=[row('ATY027',null,0,0,'20250101',33.2,126.2)];
const fx={days:15,warnings:true,live:{count:18,density:12.0,sourceAt:'2026-10-15T16:10:00+09:00'},accidents:busyAccidents};
/** 이 칸의 30분 척수 가짜 기록. fx.days = 기록이 쌓인 달력일 수(오늘 포함 — 오늘 0시부터면 1, 15 면 2주 창을 다 덮음). 예: 평일 낮 20척 안팎·새벽 9척. 값은 시각의 결정적 함수다(시험마다 같다).
 * @param {number} t - 30분 칸 시작 ms @returns {number} 척수(소수 한 자리) [연계] ← history.series */
function shipsAt(t){const d=new Date(t+9*HR),h=d.getUTCHours()+d.getUTCMinutes()/60,base=h<5?9:h<9?9+(h-5)*3:h<18?20:20-(h-18)*1.8,wig=((t/MIN30)*7919%13)-6;return Math.max(0,Math.round((base+wig*.6)*10)/10);}
const nowSlot=Math.floor(now/MIN30)*MIN30;
const history={series(id,from,count){const recStart=fx.days>=15?-Infinity:Date.parse(kst(now).slice(0,10)+'T00:00:00+09:00')-(fx.days-1)*86400000,values=[],samples=[];for(let i=0;i<count;i++){const t=from+i*MIN30,ok=fx.days>0&&t>=recStart&&t<nowSlot;values.push(ok?shipsAt(t):null);samples.push(ok?6:0);}return{values,samples};}};
const warnings={list(){return{intervals:fx.warnings?[{zone:'부산앞바다',role:'main',kind:'앞바다',type:'풍랑',level:'주의보',start:'2026-10-07T15:00:00+09:00',startBy:'tmEf',end:'2026-10-08T03:00:00+09:00',endBy:'levelChange'},{zone:'부산앞바다',role:'main',kind:'앞바다',type:'풍랑',level:'경보',start:'2026-10-08T03:00:00+09:00',startBy:'tmEf',end:'2026-10-08T18:00:00+09:00',endBy:'clrNtcTm'},{zone:'부산앞바다',role:'main',kind:'앞바다',type:'풍랑',level:'주의보',start:'2026-10-15T09:00:00+09:00',startBy:'tmEf',end:null,endBy:null}]:[],checkedAt:'2026-10-15T16:11:00+09:00'};}};
const trafficHistory=H.createApi({history,warnings,zonesOfCell:id=>/^GR4_/.test(id)?{center:[cell.lon,cell.lat],main:{name:'부산앞바다',code:'S1',kind:'앞바다'},sub:null}:null,clock:()=>now});
(async()=>{let browser,server;try{
 const dir=tmp(),liveFile=path.join(dir,'sea_realtime.json.gz');
 /** 실시간 교통 파일을 쓴다. 예: live({count:18,density:12,sourceAt}) — null 이면 이 칸 행 없음 @returns {void} [연계] ← 시나리오 전환 */
 const writeLive=l=>io.write(liveFile,{v:'v1',cells:[cell],rows:l?[[0,l.count,l.density]]:[],collectedAt:l?l.sourceAt:at,sourceAt:l?l.sourceAt:at,source:'MTIS realtime API'});
 writeLive(fx.live);
 const cong={};for(let t=Date.parse('2026-10-15T00:00:00+09:00');t<=Date.parse('2026-10-16T23:00:00+09:00');t+=HR){const k=key(t),h=Number(kst(t).slice(11,13)),hi=k==='202610151600'?['높음',12.3]:k==='202610160900'?['높음',11.4]:k==='202610151800'?['매우높음',21.7]:[h<6?'낮음':'보통',h<6?.4:3.2];cong[k]=[{gridId:cell.id,fcstDate:k.slice(0,8),fcstTime:k.slice(8),congestionIndex:hi[1],congestionLevel:hi[0]}];}
 const frames={};for(const [k,l]of Object.entries(accLevels))frames[k]=[[0,l==='주의'?.004:l==='보통'?.001:.0001,l]];
 const accTimes=Object.keys(accLevels).map(k=>k.slice(0,4)+'-'+k.slice(4,6)+'-'+k.slice(6,8)+'T'+k.slice(8,10)+':00:00+09:00');
 const seaTimes=[at];for(let t=Date.parse('2026-10-15T17:00:00+09:00');t<=Date.parse('2026-10-16T23:00:00+09:00');t+=HR)seaTimes.push(kst(t));
 const inputs={version:1,cells:{cells:[cell]},congestion:{frames:cong},accident:{cells:[acc],frames,createdAt:'2026-10-15T14:30:00+09:00'},sources:{accident:{status:'ok'},congestion:{status:'ok'},zoneForecasts:{status:'ok'}},weather:(major,t)=>fx.weatherNull?{wh:null,ws:null,wp:null,wd:null,windDir:null,forecastAt:null}:Date.parse(t)>=Date.parse('2026-10-16T09:00:00+09:00')?{wh:1.8,ws:9.2,wp:6.8,wd:214,windDir:232,forecastAt:'2026-10-16T09:00:00+09:00'}:{wh:1.2,ws:6.4,wp:6.1,wd:203.4,windDir:215,forecastAt:'2026-10-15T15:00:00+09:00'}};
 const sources=inputs.sources,store={sources:()=>sources,marineInputs:()=>inputs,meta:()=>({now:at,versions:{spots:'v1',cells:1,accident:'v1'},timeline:{sea:{times:seaTimes},accident:{times:accTimes},coast:{times:[at]}},sources}),spots:()=>({spots:[]}),cells:()=>({cells:[cell]}),accidentCells:()=>({v:'v1',cells:[acc]}),accidentFrame:()=>({v:'v1',cells:[]}),frame:()=>({cells:[],spots:[],borders:[]}),islands:()=>({features:[]})};
 const stations=[{properties:{name:'남항파출소',station:'부산해양경찰서'},geometry:accGeom}];
 // 지도 조작부 상자·스위치 모양은 index2.html 인라인 CSS(.banzone-legend·.bzl-*)에 있다 — 화면 사진을 실제와 같게 하려고 그 규칙을 그대로 가져온다.
 const index2=fs.readFileSync(path.join(root,'client/index2.html'),'utf8'),legendCss=(index2.match(/\.ocean-legend-stack > \.banzone-legend,[\s\S]*?\.banzone-legend \.bzl-row\.on \.bzl-switch::after \{[^}]*\}/)||[''])[0];
 if(!legendCss)throw Error('index2.html 의 .banzone-legend 규칙을 찾지 못함');
 const stores=new Map(),marineFor=list=>{if(!stores.has(list))stores.set(list,M.createStore({risk:store,dir,clock:()=>now,stations,accidents:list,describe:()=>cell}));return stores.get(list);};
 const marine=new Proxy({},{get:(_,name)=>(...a)=>marineFor(fx.accidents)[name](...a)});
 const log={frames:[],history:[]};
 const app=express();app.use((req,res,next)=>{if(req.path.endsWith('/sea/unified-frame'))log.frames.push({mode:req.query.mode,t:req.query.t});if(req.path.endsWith('/sea/traffic-history'))log.history.push(req.query);next();});
 app.use(createRouter({store,marine,trafficHistory}));app.get('/api/ocean/land-mask',(req,res)=>res.json({rings:[]}));
 app.get('/',(req,res)=>res.send('<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/assets/vendor/ol/ol.css"><link rel="stylesheet" href="/js/marine-life/risk-forecast/risk_forecast.css"><style>:root{--main-tab-height:56px}body{margin:0;background:#10223d;color:white;display:block}body::before{display:none!important}#map{height:100vh}.ocean-legend-stack{position:absolute;top:10px;left:10px;z-index:5}'+legendCss+'body.full .rf-sheet{position:static;max-height:none}body.full .rf-body{overflow:visible}body.full #map,body.full #tabs,body.full .ocean-legend-stack,body.full .rf-color-legend,body.full .rf-marine-timebar{display:none!important}</style></head><body class="ls-mode ls-safety"><nav id="tabs" style="position:fixed;bottom:0;height:56px;width:100%;background:#263f65;z-index:160">메인 탭</nav><div id="map"></div><div class="ocean-legend-stack"><div id="risk-forecast-legend" class="rf-legend"></div></div><div id="risk-forecast-banner" hidden></div><div id="risk-forecast-sheet" class="rf-sheet"></div>'+['assets/vendor/ol/ol.js','js/core/backbutton.js',...['risk_format','risk_api','risk_map_layer','risk_slider','risk_marine','risk_sheet','risk_basis_content','risk_basis','risk_forecast'].map(s=>'js/marine-life/risk-forecast/'+s+'.js')].map(s=>'<script src="/'+s+'"></script>').join('')+'<script>window.map=new ol.Map({target:"map",view:new ol.View({center:ol.proj.fromLonLat([129.075,35.0375]),zoom:11})});window.getOceanMap=function(){return map;};window.app=RiskForecast.mount({map:map,legendEl:document.getElementById("risk-forecast-legend"),sheetEl:document.getElementById("risk-forecast-sheet"),bannerEl:document.getElementById("risk-forecast-banner")});</script></body></html>'));
 app.use(express.static(path.join(root,'client')));server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 browser=await chromium.launch({...(process.env.PW_CHROME?{executablePath:process.env.PW_CHROME}:{}),headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:380,height:820},deviceScaleFactor:2}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 // 가로채기를 켜면 브라우저 HTTP 캐시(서버 max-age=60)를 쓰지 않는다 — 장면마다 바꾼 가짜 자료를 새로 받기 위해서다.
 await page.route('**/api/risk-forecast/**',r=>r.continue());
 await page.goto('http://127.0.0.1:'+server.address().port);if(!await page.evaluate(()=>!!window.app))throw Error('초기화 실패: '+errors.join(' / '));await page.evaluate(()=>app.ready);
 if(SHOTS)fs.mkdirSync(SHOTS,{recursive:true});
 const shot=async(name,sel)=>{if(!SHOTS)return;if(sel)await page.locator(sel).screenshot({path:path.join(SHOTS,name+'.png')});else await page.screenshot({path:path.join(SHOTS,name+'.png')});};
 const caption=()=>page.locator('.rf-color-legend [data-marine-caption]').evaluate(el=>el.textContent);
 const lastMode=()=>log.frames.at(-1)&&log.frames.at(-1).mode;
 const marineMode=()=>page.evaluate(()=>{const l=map.getLayers().getArray().find(l=>l.getClassName()==='rf-marine-canvas');const f=l&&l.getSource().getFeatures()[0];return f?f.get('mode'):null;});
 const checked=()=>page.evaluate(()=>[...document.querySelectorAll('[data-marine-mode]')].filter(b=>b.getAttribute('aria-checked')==='true').map(b=>b.textContent));
 const labels=()=>page.locator('.rf-color-legend .rf-gradient-labels').evaluate(el=>el.textContent);
 const waitMode=m=>page.waitForFunction(m=>{const l=map.getLayers().getArray().find(l=>l.getClassName()==='rf-marine-canvas');const f=l&&l.getSource().getFeatures()[0];return f&&f.get('mode')===m;},m);

 // ── 지도 조작부 ──
 await check('지도: 해상 OFF 면 [혼잡도][위험 예측] 숨김·「표시 항목」·「표출 중」 없음',async()=>{
  assert.equal(await page.locator('[data-marine-tools]').isVisible(),false);assert.equal(await page.locator('.rf-marine-options,[data-marine-badge]').count(),0);
  assert.doesNotMatch(await page.locator('#risk-forecast-legend').evaluate(el=>el.textContent),/표시 항목|표출 중/);await shot('map_1_sea_off');});
 await check('지도: 해상 ON → 두 칸 보임·기본 [위험 예측]·범례 「위험 예측」 낮음·보통·주의·경계(mode risk)',async()=>{
  await page.locator('[data-layer="sea"]').click();await page.waitForFunction(()=>{const l=map.getLayers().getArray().find(l=>l.getClassName()==='rf-marine-canvas');return l&&l.getSource().getFeatures().length;});
  assert.equal(await page.locator('[data-marine-tools]').isVisible(),true);assert.deepEqual(await checked(),['위험 예측']);assert.equal(await caption(),'위험 예측');assert.equal(await labels(),'낮음보통주의경계');assert.equal(lastMode(),'risk');assert.equal(await marineMode(),'accident');
  assert.equal(await page.locator('.rf-color-legend .rf-gradient-bar.rf-pal-cong').count(),0);await shot('map_2_sea_on_risk');});
 await check('지도: [혼잡도] 지금 → mode current·범례 「밀집도 (실시간)」 혼잡 색·면색도 혼잡 색',async()=>{
  await page.locator('[data-marine-mode="congestion"]').click();await page.waitForFunction(()=>{const l=map.getLayers().getArray().find(l=>l.getClassName()==='rf-marine-canvas');const f=l&&l.getSource().getFeatures()[0];return f&&f.get('mode')==='current';});
  assert.deepEqual(await checked(),['혼잡도']);assert.equal(await caption(),'밀집도 (실시간)');assert.equal(await labels(),'낮음보통높음매우높음');assert.equal(lastMode(),'current');assert.equal(await page.locator('.rf-color-legend .rf-gradient-bar.rf-pal-cong').count(),1);
  const c=await page.evaluate(()=>{const l=map.getLayers().getArray().find(l=>l.getClassName()==='rf-marine-canvas'),f=l.getSource().getFeatures()[0];return{fill:f.getStyle().getFill().getColor(),want:RiskMarine.congestionColor(Math.round(f.get('colorValue')*255)/255)};});
  assert.ok(c.fill.startsWith(c.want.replace('rgb(','rgba(').replace(')',',')),JSON.stringify(c));await shot('map_3_sea_on_cong_now');});
 await check('지도: [혼잡도] 그대로 +3H(미래) → mode congestion·「혼잡도 (예보)」, 현재로 오면 다시 밀집도',async()=>{
  await page.locator('[data-time-step="3"]').click();await page.waitForFunction(()=>{const l=map.getLayers().getArray().find(l=>l.getClassName()==='rf-marine-canvas');const f=l&&l.getSource().getFeatures()[0];return f&&f.get('mode')==='congestion';});
  assert.equal(lastMode(),'congestion');assert.equal(await caption(),'혼잡도 (예보)');assert.deepEqual(await checked(),['혼잡도']);assert.equal(await labels(),'낮음보통높음매우높음');await shot('map_4_sea_on_cong_future');
  await page.locator('[data-time-step="now"]').click();await waitMode('current');assert.equal(await caption(),'밀집도 (실시간)');assert.ok(log.frames.some(f=>f.mode==='current'));});
 await check('지도: 켜진 칸을 다시 눌러도 그대로(단일 선택)·해상 OFF→ON 이면 [위험 예측]으로',async()=>{
  const before=log.frames.length;await page.locator('[data-marine-mode="congestion"]').click();await page.waitForTimeout(150);assert.deepEqual(await checked(),['혼잡도']);assert.equal(log.frames.length,before,'같은 칸은 다시 요청하지 않는다');
  await page.locator('[data-layer="sea"]').click();assert.equal(await page.locator('[data-marine-tools]').isVisible(),false);assert.equal(await page.locator('.rf-color-legend').isVisible(),false);
  await page.locator('[data-layer="sea"]').click();await waitMode('accident');assert.equal(await caption(),'위험 예측');assert.deepEqual(await checked(),['위험 예측']);});

 // ── 해상 시트: 지금 붐빔 ──
 const body='#risk-forecast-sheet .rf-body';
 const openSheet=async()=>{await page.evaluate(()=>{const b=document.querySelector('#risk-forecast-sheet .rf-close');if(document.getElementById('risk-forecast-sheet').classList.contains('open')&&b)b.click();app.select('traffic','GR4_F4K23_P4');});await page.waitForSelector(body+' .rf-hero');await page.waitForFunction(()=>document.querySelector('#risk-forecast-sheet [data-chart] svg'));};
 await openSheet();
 const heroText=()=>page.locator(body+' .rf-hero').innerText();
 await check('시트 지금: 위 카드 「위험 예측 보통」·「밀집도 높음」(혼잡 색)·「이 해역 선박 18척(밀집도 12.0%)」·충돌주의·「16시 혼잡예보 [높음]」',async()=>{
  const r=await page.evaluate(b=>[...document.querySelectorAll(b+' .rf-hero .rf-lvl')].map(l=>({small:l.querySelector('small').textContent,strong:l.querySelector('strong').textContent,bg:getComputedStyle(l).backgroundColor})),body);
  assert.deepEqual(r.map(x=>[x.small,x.strong]),[['위험 예측','보통'],['밀집도','높음']]);assert.equal(r[0].bg,'rgb(219, 199, 83)');assert.equal(r[1].bg,'rgb(212, 124, 255)');
  const t=(await heroText()).replace(/\s+/g,' ');for(const s of ['최근 5년 간 사고사례 및 기상정보 기반 예측 결과','이 해역 선박 18척(밀집도 12.0%)','충돌·접촉사고 주의','16시 혼잡예보 높음'])assert.ok(t.includes(s),s+' / '+t);
  assert.equal(await page.locator(body+' .rf-hero .rf-chip').innerText(),'높음');assert.equal(await page.locator(body+' .rf-hero b.rf-cc').count(),1);});
 await check('시트: 「15~18시 예보」 같은 예보 시간 줄 없음·옛 시트 문구(종합 관심단계·현재 교통현황·시간대별 표) 없음',async()=>{
  const t=await page.locator(body).innerText();assert.doesNotMatch(t,/\d+~\d+시 예보/);for(const s of ['종합 관심단계','현재 교통현황','오늘·내일 예보 시간대별 보기','공식 예보 기준','관심 필요','정보 확인'])assert.ok(!t.includes(s),s);});
 await check('시트: 순서 위 카드→교통량→선박사고→날씨→출처, 출처 「해양교통안전공단 API」·[기준 상세]',async()=>{
  const order=await page.evaluate(b=>[...document.querySelector(b).children].map(e=>e.matches('.rf-hero')?'hero':e.matches('[data-traffic-card]')?'traffic':e.matches('.rf-acc,.rf-none')?'acc':e.matches('.rf-wx')?'wx':e.matches('.rf-cite')?'cite':e.className),body);
  assert.deepEqual(order,['hero','traffic','acc','wx','cite']);const cite=(await page.locator(body+' .rf-cite').innerText()).replace(/\s+/g,' ');
  for(const s of ['위험 예측·혼잡도·과거 2주간 선박교통량: 해양교통안전공단 API','이 해역 날씨: 기상청 해구별 예보','이 해역 과거 선박사고: 국립해양조사원 개방海 데이터셋','기준 상세'])assert.ok(cite.includes(s),s);assert.ok(!cite.includes('공식 제공 데이터'));
  assert.equal(await page.locator(body+' .rf-cite [data-basis="sea"]').count(),1);});
 await check('시트 막대: 시각별 공식 사고 위험 색·「지금」 꼬리표·범례 4단계·눈금',async()=>{
  const r=await page.evaluate(()=>{const tl=document.querySelector('#risk-forecast-sheet .rf-timeline'),seg=[...tl.querySelectorAll('.rf-st-track span')];return{now:tl.querySelector('.rf-st-now')&&tl.querySelector('.rf-st-now').textContent,key:tl.querySelector('.rf-st-key').textContent,first:seg[0]&&seg[0].dataset.level,firstBg:seg[0]&&getComputedStyle(seg[0]).backgroundColor,levels:seg.map(s=>s.dataset.level||'-'),day:[...tl.querySelectorAll('.rf-st-lab em.day')].map(e=>e.textContent),label:tl.querySelector('.rf-time-label').textContent,nowMark:tl.querySelector('.rf-st-marks i.now').hidden};});
  assert.equal(r.now,'지금');assert.equal(r.key,'낮음보통주의경계');assert.equal(r.first,'보통');assert.equal(r.firstBg,'rgb(219, 199, 83)');assert.ok(r.levels.includes('주의'),r.levels.join(','));assert.ok(!r.levels.includes('-'),'모든 칸 색 '+r.levels.join(','));
  assert.deepEqual(r.day,['10.16(금)']);assert.equal(r.label,"'26.10.15(목) 16:12");assert.equal(r.nowMark,true);});
 await check('교통량(14일): 머리 「16:10 기준 · 2분 전」·「2주 평균 16:00」·선·특보 띠·「지금 18척」, days=15 로 요청',async()=>{
  const r=await page.evaluate(b=>{const c=document.querySelector(b+' [data-traffic-card]');return{src:c.querySelector('.rf-src').textContent,name:c.querySelector('[data-avg-name]').textContent,val:c.querySelector('[data-avg-value]').textContent,fut:c.querySelector('.rf-avg').classList.contains('fut'),lines:c.querySelectorAll('polyline').length,warn:[...c.querySelectorAll('rect[data-warn]')].map(x=>x.dataset.warn),now:c.querySelector('[data-now-label]')&&c.querySelector('[data-now-label]').textContent,leg:c.querySelector('[data-chart-leg]').textContent,empty:c.querySelectorAll('[data-empty]').length,dots:c.querySelectorAll('[data-dot]').length};},body);
  assert.equal(r.src,'16:10 기준 · 2분 전');assert.equal(r.name,'2주 평균 16:00');assert.match(r.val,/^\d+(\.\d)?척$/);assert.equal(r.fut,false);assert.ok(r.lines>=1);assert.deepEqual(r.warn,['주의보','경보','주의보']);assert.equal(r.now,'지금 18척');assert.ok(r.leg.includes('주의보')&&r.leg.includes('경보'));assert.equal(r.empty,0);assert.equal(r.dots,0,'×1 에서는 선만');
  // 16:00 칸 평균 = 어제~14일 전 16:00 기록 14개의 평균(진행 중인 오늘 16:00 은 빼고)
  const want=[];for(let d=1;d<=14;d++)want.push(shipsAt(Date.parse('2026-10-15T16:00:00+09:00')-d*86400000));assert.equal(r.val,String(Math.round(want.reduce((a,b)=>a+b,0)/14*10)/10).replace(/\.0$/,'')+'척');
  assert.deepEqual(log.history.at(-1),{cell:'GR4_F4K23_P4',days:'15'});await shot('sheet_now_busy_hero',body+' .rf-hero');});
 let th;
 await check('그래프 확대: 문턱 아래 점·글자 0개, 문턱 이상 점>0·글자>0·글자끼리/「지금」과 안 겹침, 숫자 8px·「척」 6.5px',async()=>{
  th=(await page.evaluate(b=>RiskMarine.zoom(document.querySelector(b),1),body)).th;console.log('  측정 문턱 배율 ×'+th.toFixed(2));assert.ok(th>1&&th<50,String(th));
  const inspect=()=>page.evaluate(b=>{const ch=document.querySelector(b+' [data-chart]'),g=ch._g,vis=x=>x.x+x.width>g.padL&&x.x<g.padL+g.pw,L=[...ch.querySelectorAll('text[data-n]')].map(t=>t.getBBox()).filter(vis).sort((a,c)=>a.x-c.x),nt=ch.querySelector('[data-now-label]'),nb=nt&&nt.getBBox();let ov=0,ovNow=0;for(let i=0;i<L.length;i++){for(let j=i+1;j<L.length;j++){const a=L[i],c=L[j];if(a.x<c.x+c.width&&c.x<a.x+a.width&&a.y<c.y+c.height&&c.y<a.y+a.height)ov++;}const a=L[i];if(nb&&a.x<nb.x+nb.width&&nb.x<a.x+a.width&&a.y<nb.y+nb.height&&nb.y<a.y+a.height)ovNow++;}const t=ch.querySelector('text[data-n]');return{dots:ch.querySelectorAll('[data-dot]').length,labels:L.length,ov,ovNow,fs:t&&t.getAttribute('font-size'),unit:t&&t.querySelector('tspan')&&t.querySelector('tspan').getAttribute('font-size'),unitText:t&&t.querySelector('tspan')&&t.querySelector('tspan').textContent,zh:document.querySelector(b+' [data-zoom]').textContent};},body);
  const below=Math.floor(th*10-1e-9)/10,above=Math.ceil(th*10)/10;
  await page.evaluate(([b,s])=>RiskMarine.zoom(document.querySelector(b),s,'2026-10-14T12:00:00+09:00'),[body,below]);let r=await inspect();assert.equal(r.dots,0,'문턱 아래 점');assert.equal(r.labels,0);assert.equal(r.zh,'확대율 ×'+below.toFixed(1));
  for(const [s,c] of [[above,'2026-10-14T12:00:00+09:00'],[above,'2026-10-15T15:00:00+09:00'],[50,'2026-10-14T03:00:00+09:00'],[50,'2026-10-15T16:00:00+09:00']]){await page.evaluate(([b,s,c])=>RiskMarine.zoom(document.querySelector(b),s,c),[body,s,c]);r=await inspect();assert.ok(r.dots>0&&r.labels>0,JSON.stringify(r));assert.equal(r.ov,0,'글자 겹침 '+s+' '+c);assert.equal(r.ovNow,0,'「지금」과 겹침 '+s+' '+c);assert.equal(r.fs,'8');assert.equal(r.unit,'6.5');assert.equal(r.unitText,'척');}
  await page.evaluate(([b,s])=>RiskMarine.zoom(document.querySelector(b),s,'2026-10-14T12:00:00+09:00'),[body,above]);await shot('sheet_now_zoom_above','#risk-forecast-sheet [data-traffic-card]');
  assert.equal((await page.evaluate(b=>RiskMarine.zoom(document.querySelector(b),80),body)).s,50,'최대 ×50');});
 const chartBox=()=>page.locator(body+' [data-chart]').boundingBox();
 const pointer=(type,id,x,y)=>page.evaluate(([b,type,id,x,y])=>{const ch=document.querySelector(b+' [data-chart]');ch.dispatchEvent(new PointerEvent(type,{pointerId:id,clientX:x,clientY:y,bubbles:true,isPrimary:id===1}));},[body,type,id,x,y]);
 await check('손가락: 두 손가락 벌림 = 확대(확대율 표시)·한 손가락 끌기 = 넘김·누르기 = 흰 점+말풍선 「N척 · MM.DD(요) HH:MM」',async()=>{
  await page.evaluate(b=>RiskMarine.zoom(document.querySelector(b),1),body);const b=await chartBox(),cy=b.y+60;
  await pointer('pointerdown',1,b.x+150,cy);await pointer('pointerdown',2,b.x+170,cy);await pointer('pointermove',2,b.x+250,cy);await pointer('pointerup',2,b.x+250,cy);await pointer('pointerup',1,b.x+150,cy);
  const zh=await page.locator(body+' [data-zoom]').evaluate(e=>e.textContent);assert.match(zh,/^확대율 ×(\d+\.\d)$/);const s=Number(zh.split('×')[1]);assert.ok(s>3.5&&s<=5.1,zh);
  const off0=await page.evaluate(b=>document.querySelector(b+' [data-chart] svg rect[fill="#8fd3ff"]').getAttribute('x'),body);
  await pointer('pointerdown',1,b.x+200,cy);await pointer('pointermove',1,b.x+120,cy);await pointer('pointerup',1,b.x+120,cy);
  const off1=await page.evaluate(b=>document.querySelector(b+' [data-chart] svg rect[fill="#8fd3ff"]').getAttribute('x'),body);assert.ok(Number(off1)>Number(off0),'넘김 '+off0+'→'+off1);
  await pointer('pointerdown',1,b.x+200,cy);await pointer('pointerup',1,b.x+200,cy);
  const tip=await page.evaluate(b=>{const t=document.querySelector(b+' [data-chart] [data-tip]');return t&&t.textContent;},body);assert.match(tip||'',/^\d+(\.\d)?척 · 10\.\d\d\([일월화수목금토]\) \d\d:(00|30)$/);assert.equal(await page.locator(body+' [data-tap-dot]').count(),1);
  for(let i=0;i<3;i++){await pointer('pointerdown',1,b.x+100,cy);await pointer('pointerdown',2,b.x+110,cy);await pointer('pointermove',2,b.x+340,cy);await pointer('pointerup',2,b.x+340,cy);await pointer('pointerup',1,b.x+100,cy);}
  assert.equal(await page.locator(body+' [data-zoom]').evaluate(e=>e.textContent),'확대율 ×50.0','최대 ×50');});
 await check('60초 자동 갱신(같은 지점·시각)은 확대·말풍선·날씨 펼침을 지킨다',async()=>{
  await page.locator(body+' [data-wx]').click();const z0=await page.locator(body+' [data-zoom]').evaluate(e=>e.textContent);await page.evaluate(()=>app.refresh());await page.waitForFunction(()=>document.querySelector('#risk-forecast-sheet [data-chart] svg'));await page.waitForTimeout(200);
  assert.equal(await page.locator(body+' [data-zoom]').evaluate(e=>e.textContent),z0);assert.equal(await page.locator(body+' [data-wx]').getAttribute('aria-expanded'),'true');await page.locator(body+' [data-wx]').click();});
 const setSlider=async iso=>{await page.evaluate(t=>{const tl=document.querySelector('#risk-forecast-sheet .rf-timeline'),s=tl.querySelector('input'),labels=[];window.__want=t;s.value=String(window.__rfIndex(t));s.dispatchEvent(new Event('input',{bubbles:true}));},iso);};
 await page.evaluate(times=>{window.__rfIndex=t=>times.indexOf(t);},[at,...accTimes.filter(t=>Date.parse(t)>now)]);
 await check('날씨(지금): 처음 접힘 → 펼치면 파도 3·바람 2 (「203° 남남서」·「215° 남서」)',async()=>{
  assert.equal(await page.locator(body+' [data-wx]').getAttribute('aria-expanded'),'false');assert.equal(await page.locator(body+' [data-wx-body]').isVisible(),false);assert.equal(await page.locator(body+' .rf-wx h4').innerText(),'지금 이 해역 날씨');
  await page.locator(body+' [data-wx]').click();const tiles=await page.locator(body+' [data-wx-body] .rf-tile').evaluateAll(t=>t.map(e=>e.innerText.replace(/\s+/g,' ').trim()));
  assert.deepEqual(tiles.map(t=>t.replace(/\s/g,'')),['유의파고1.2m','파주기6.1초','파향203°남남서','풍속6.4m/s','풍향215°남서'],JSON.stringify(tiles));await shot('sheet_now_wx_open',body+' .rf-wx');await page.locator(body+' [data-wx]').click();});
 await check('선박사고: 도넛 14건·범례 상위 4종+기타(화재·전복)·인명피해 줄(사망·실종 빨강 굵게, 기록 없는 사고는 적지 않음 — 사용자 「기록없다고 표기하지말고」)',async()=>{
  const r=await page.evaluate(b=>{const s=document.querySelector(b+' .rf-acc');return{total:s.querySelector('[data-acc-total]').textContent,rows:[...s.querySelectorAll('[data-acc-group]')].map(x=>x.innerText.replace(/\s+/g,'')),cas:s.querySelector('[data-acc-cas]').textContent,red:[...s.querySelectorAll('[data-acc-cas] b')].map(x=>[x.textContent,getComputedStyle(x).color,getComputedStyle(x).fontWeight]),arcs:s.querySelectorAll('[data-arc]').length,yrs:s.querySelector('h4 .rf-src').textContent};},body);
  assert.equal(r.total,'14건');assert.deepEqual(r.rows,['충돌5건›','접촉3건›','표류2건›','침수2건›','기타(화재·전복)2건›']);assert.equal(r.arcs,5);assert.equal(r.yrs,'2021~2025년');
  assert.equal(r.cas,'사망 1명(23년, 충돌), 실종 2명(21년, 전복)');assert.deepEqual(r.red.map(x=>x[0]),['사망 1명','실종 2명']);assert.ok(r.red.every(x=>x[1]==='rgb(255, 107, 107)'&&Number(x[2])>=700));});
 await check('선박사고 팝업: 충돌 최신순 「YYYY년 · 원인: X」/「원인 기록 없음」+「사망 1명」 빨강, 기타는 종류 이름 앞에, 사망·실종 없거나 미기록이면 오른쪽 비움(사용자 「사망, 실종 만 표기해」)',async()=>{
  await page.locator(body+' [data-acc-group="0"]').click();await page.waitForSelector('.rf-acc-pop:not([hidden])');
  let li=await page.locator('.rf-acc-pop li').evaluateAll(a=>a.map(x=>{const c=x.querySelector('.c');return [x.querySelector('.t').textContent,c?c.textContent:'',!!c&&c.classList.contains('hurt')];}));
  assert.deepEqual(li,[['2025년 · 원인: 운항부주의','',false],['2023년 · 원인 기록 없음','사망 1명',true],['2022년 · 원인 기록 없음','',false],['2021년 · 원인: 운항부주의','',false],['2021년 · 원인 기록 없음','',false]]);
  assert.equal(await page.locator('.rf-acc-pop').innerText().then(t=>/인명피해/.test(t)),false,'팝업에 「인명피해 없음/기록 없음」 글자 없음');
  assert.equal(await page.locator('.rf-acc-pop h5').innerText(),'충돌 5건최신순');await shot('sheet_acc_popup');
  await page.locator('.rf-acc-pop .x').click();assert.equal(await page.locator('.rf-acc-pop').isVisible(),false);
  await page.locator(body+' [data-acc-group="1"]').click();li=await page.locator('.rf-acc-pop li .c').allInnerTexts();assert.deepEqual(li,[]);
  await page.keyboard.press('Escape');assert.equal(await page.locator('.rf-acc-pop').isVisible(),false);assert.equal(await page.locator('#risk-forecast-sheet').evaluate(e=>e.classList.contains('open')),true,'Escape 는 팝업만 닫는다');
  await page.locator(body+' [data-acc-group="4"]').click();li=await page.locator('.rf-acc-pop li .t').allInnerTexts();assert.deepEqual(li,['화재 · 2023년 · 원인: 화기취급부주의','전복 · 2021년 · 원인: 기상악화']);
  assert.deepEqual(await page.locator('.rf-acc-pop li .c').allInnerTexts(),['실종 2명']);await page.mouse.click(5,5);assert.equal(await page.locator('.rf-acc-pop').isVisible(),false,'바깥 누르면 닫힘');
  const cover=await page.evaluate(()=>{const p=document.querySelector('.rf-acc-pop');return p.parentElement===document.body;});assert.equal(cover,true,'팝업은 화면 전체(document.body)');
  await page.locator(body+' [data-acc-group="0"]').click();await page.evaluate(()=>PopupStack.popLast());assert.equal(await page.locator('.rf-acc-pop').isVisible(),false,'뒤로가기는 팝업부터 닫음');assert.equal(await page.locator('#risk-forecast-sheet').evaluate(e=>e.classList.contains('open')),true);
  await page.locator(body+' [data-acc-group="0"]').click();await page.evaluate(()=>document.querySelector('#risk-forecast-sheet .rf-close').click());assert.equal(await page.locator('.rf-acc-pop').isVisible(),false,'시트를 닫으면 팝업도 닫힘');await openSheet();});
 if(SHOTS){await page.evaluate(b=>RiskMarine.zoom(document.querySelector(b),1),body);await page.evaluate(()=>document.body.classList.add('full'));await page.setViewportSize({width:380,height:2400});await page.locator('#risk-forecast-sheet').screenshot({path:path.join(SHOTS,'sheet_now_busy_full.png')});await page.evaluate(()=>document.body.classList.remove('full'));await page.setViewportSize({width:380,height:820});}

 // ── 미래 시각 ──
 await check('시트 시각을 내일 09시로 옮기면 그래프 배율·넘김·말풍선 초기화',async()=>{
  await page.evaluate(b=>RiskMarine.zoom(document.querySelector(b),20,'2026-10-14T12:00:00+09:00'),body);
  await setSlider('2026-10-16T09:00:00+09:00');await page.waitForFunction(()=>document.querySelector('#risk-forecast-sheet .rf-hero')&&document.querySelector('#risk-forecast-sheet .rf-hero').textContent.includes('혼잡 지수'));await page.waitForFunction(()=>document.querySelector('#risk-forecast-sheet [data-chart] svg'));
  assert.equal(await page.locator(body+' [data-zoom]').evaluate(e=>e.textContent),'');assert.equal(await page.locator(body+' [data-chart] [data-tip]').count(),0);assert.equal(await page.locator(body+' [data-chart] [data-dot]').count(),0);});
 await check('시트 미래: 「위험 예측 주의」·「혼잡도 높음」·「혼잡 지수 11.4」·충돌주의, 밀집도·척수 줄 없음·「15~18시 예보」 없음',async()=>{
  const r=await page.evaluate(b=>[...document.querySelectorAll(b+' .rf-hero .rf-lvl')].map(l=>[l.querySelector('small').textContent,l.querySelector('strong').textContent]),body);assert.deepEqual(r,[['위험 예측','주의'],['혼잡도','높음']]);
  const t=(await heroText()).replace(/\s+/g,' ');assert.ok(t.includes('혼잡 지수 11.4'));assert.ok(t.includes('충돌·접촉사고 주의'));assert.ok(!t.includes('밀집도'));assert.ok(!t.includes('이 해역 선박'));assert.doesNotMatch(t,/시 예보/);
  const lab=await page.locator('#risk-forecast-sheet .rf-time-label').innerText();assert.equal(lab,"'26.10.16(금) 09:00 · 예보");assert.equal(await page.locator('#risk-forecast-sheet .rf-st-marks i.now').isVisible(),true);});
 await check('미래 교통량: 머리 「지금 16:10 기준」·평균 칸 노란(fut) 「2주 평균 09:00」 / 날씨 제목 「이 해역 내일 09시 예보」',async()=>{
  const r=await page.evaluate(b=>{const c=document.querySelector(b+' [data-traffic-card]');return{src:c.querySelector('.rf-src').textContent,name:c.querySelector('[data-avg-name]').textContent,fut:c.querySelector('.rf-avg').classList.contains('fut'),col:getComputedStyle(c.querySelector('[data-avg-name]')).color};},body);
  assert.equal(r.src,'지금 16:10 기준');assert.equal(r.name,'2주 평균 09:00');assert.equal(r.fut,true);assert.equal(r.col,'rgb(255, 210, 122)');assert.equal(await page.locator(body+' .rf-wx h4').innerText(),'이 해역 내일 09시 예보');
  if(SHOTS){await page.evaluate(()=>document.body.classList.add('full'));await page.setViewportSize({width:380,height:2400});await page.locator('#risk-forecast-sheet').screenshot({path:path.join(SHOTS,'sheet_future_full.png')});await page.evaluate(()=>document.body.classList.remove('full'));await page.setViewportSize({width:380,height:820});}});
 await check('오늘 미래(18시): 날씨 제목 「이 해역 18시 예보」·혼잡도 「매우높음」 뱃지는 글자 줄임(l4)·칸 안에 듦',async()=>{
  await setSlider('2026-10-15T18:00:00+09:00');await page.waitForFunction(()=>document.querySelector('#risk-forecast-sheet .rf-wx h4')&&document.querySelector('#risk-forecast-sheet .rf-wx h4').textContent==='이 해역 18시 예보');
  const r=await page.evaluate(b=>{const s=document.querySelectorAll(b+' .rf-hero .rf-lvl strong')[1];return{t:s.textContent,l4:s.classList.contains('l4'),fit:s.scrollWidth<=s.clientWidth+1};},body);assert.deepEqual(r,{t:'매우높음',l4:true,fit:true});});

 // ── 조용한 해역·기록 0일·3일 ──
 // 화면 쪽 API 캐시(60초)를 비우려고 페이지를 새로 연다 — 자료를 바꾼 장면마다 새 응답을 받는다.
 const reopen=async()=>{await page.reload();await page.evaluate(()=>app.ready);await page.locator('[data-layer="sea"]').click();await waitMode('accident');await openSheet();};
 await check('선박사고 0건: 한 줄 「이 해역 선박사고 없음 2021~2025년」 / 교통 기록 0일: 「2주 평균 16:00」 값 「-」·그래프 가운데 「-」',async()=>{
  fx.accidents=farAccidents;fx.days=0;fx.warnings=false;writeLive({count:4,density:2.4,sourceAt:'2026-10-15T16:10:00+09:00'});await reopen();
  const t=await page.locator(body+' [data-acc-none]').evaluate(e=>[e.querySelector('h4').firstChild.textContent,e.querySelector('.rf-src').textContent]);assert.deepEqual(t,['이 해역 선박사고 없음','2021~2025년']);assert.equal(await page.locator(body+' .rf-acc').count(),0);
  const r=await page.evaluate(b=>{const c=document.querySelector(b+' [data-traffic-card]');return{name:c.querySelector('[data-avg-name]').textContent,val:c.querySelector('[data-avg-value]').textContent,dash:c.querySelector('[data-empty]')&&c.querySelector('[data-empty]').textContent,lines:c.querySelectorAll('polyline').length,warn:c.querySelectorAll('rect[data-warn]').length,leg:c.querySelector('[data-chart-leg]').textContent};},body);
  assert.deepEqual(r,{name:'2주 평균 16:00',val:'-',dash:'-',lines:0,warn:0,leg:'선박 수'});
  const lv=await page.evaluate(b=>[...document.querySelectorAll(b+' .rf-hero .rf-lvl strong')].map(s=>s.textContent),body);assert.deepEqual(lv,['보통','낮음']);assert.equal(await page.locator(body+' .rf-hero b.rf-cc').count(),1,'4척이어도 16시 혼잡 예보 높음이면 충돌·접촉 주의(서버 조건A)');
  if(SHOTS){await page.evaluate(()=>document.body.classList.add('full'));await page.setViewportSize({width:380,height:2400});await page.locator('#risk-forecast-sheet').screenshot({path:path.join(SHOTS,'sheet_calm_acc0_days0_full.png')});await page.evaluate(()=>document.body.classList.remove('full'));await page.setViewportSize({width:380,height:820});}});
 await check('교통 기록 일부: 오늘 포함 3일째면 끝난 16:00 칸 2개 「평균 16:00 (2일)」·4일째 「(3일)」·2주 창을 다 덮으면 「2주 평균」',async()=>{
  fx.days=3;await reopen();
  const name=await page.locator(body+' [data-avg-name]').innerText();assert.equal(name,'평균 16:00 (2일)');
  fx.days=4;await reopen();assert.equal(await page.locator(body+' [data-avg-name]').innerText(),'평균 16:00 (3일)');await shot('sheet_days3_traffic','#risk-forecast-sheet [data-traffic-card]');
  fx.days=15;await reopen();assert.equal(await page.locator(body+' [data-avg-name]').innerText(),'2주 평균 16:00');});

 // ── 값이 없거나 낡은 경우(직접 렌더) ──
 const direct=(m,now)=>page.evaluate(([m,now])=>{let host=document.getElementById('direct');if(!host){host=document.createElement('div');host.id='direct';host.className='rf-sheet';host.style.cssText='width:352px;padding:8px';document.body.appendChild(host);}host.innerHTML='<div class="rf-body"></div>';const b=host.firstChild;b.innerHTML=RiskMarine.render(m,{now});RiskMarine.attach(b,m,{now});return{hero:b.querySelector('.rf-hero').innerText.replace(/\s+/g,' '),lv:[...b.querySelectorAll('.rf-hero .rf-lvl strong')].map(s=>s.textContent),cas:b.querySelector('[data-acc-cas]')&&b.querySelector('[data-acc-cas]').textContent,avg:b.querySelector('[data-avg-value]').textContent,dash:!!b.querySelector('[data-empty]'),wx:[...b.querySelectorAll('[data-wx-body] .rf-tile b')].map(x=>x.textContent),html:b.innerHTML};},[m,now]);
 const base={location:'생도 남남동방 1.6해리 해역(99-4해구)',t:at,point:{lon:129.075,lat:35.0375},accident:{level:'보통',status:'ok',forecastAt:'2026-10-15T15:00:00+09:00'},congestion:{gridId:'GR4_F4K23_P4',level:'높음',index:12.3,status:'ok',forecastAt:'2026-10-15T16:00:00+09:00'},collisionNotice:{on:false},weather:{wh:null,wp:null,wd:null,ws:null,windDir:null},history:{available:true,from:'2021-01-01',to:'2025-12-31',accidents:[]}};
 await check('낡은 현재 교통: 밀집도 뱃지 「-」·「이 해역 선박 정보 없음」만(옛 숫자·「최신성 확인 필요」 없음) / 최신 응답에 칸 없음(absent)은 「이 해역 선박 없음」·밀집도 낮음 / 사고 예보 낡음은 「-」',async()=>{
  const r=await direct({...base,current:{gridId:'GR4_F4K23_P4',count:30,density:24,densityLevel:'매우높음',status:'stale',sourceAt:'2026-10-15T15:30:00+09:00'},accident:{level:'경계',status:'stale'}},at);
  assert.deepEqual(r.lv,['-','-']);assert.ok(r.hero.includes('이 해역 선박 정보 없음'));assert.ok(!r.hero.includes('최신성'));assert.ok(!r.hero.includes('30척'));assert.ok(!r.hero.includes('매우높음'));
  const e=await direct({...base,current:{gridId:'GR4_F4K23_P4',count:0,density:0,densityLevel:'낮음',absent:true,status:'ok',sourceAt:'2026-10-15T16:10:00+09:00'}},at);assert.equal(e.lv[1],'낮음');assert.ok(e.hero.includes('이 해역 선박 없음'));assert.ok(!e.hero.includes('정보 없음 ')&&!e.hero.includes('0척'));
  const n=await direct({...base,current:null,congestion:null},at);assert.deepEqual(n.lv,['보통','-']);assert.ok(n.hero.includes('이 해역 선박 정보 없음'));assert.ok(n.hero.includes('혼잡예보 정보 없음'));assert.equal(n.avg,'-');assert.equal(n.dash,true,'칸 번호가 없으면 교통량 카드 「-」');});
 await check('날씨 값 null 은 「-」 5칸 / 인명피해: 전부 0이면 「인명피해 없음」, 미기록만 있어도 「인명피해 없음」, 한 사고 둘 다면 「사망 1명·실종 2명(23년, 충돌)」',async()=>{
  const a=(type,date,death,missing)=>({date,year:+date.slice(0,4),type,cause:null,death,missing});
  let r=await direct({...base,current:null,history:{...base.history,accidents:[a('충돌','2023-01-01',0,0),a('접촉','2022-01-01',0,0)]}},at);assert.equal(r.cas,'인명피해 없음');assert.deepEqual(r.wx,['-','-','-','-','-']);
  r=await direct({...base,current:null,history:{...base.history,accidents:[a('충돌','2023-01-01',0,0),a('접촉','2022-01-01',null,null)]}},at);assert.equal(r.cas,'인명피해 없음');
  r=await direct({...base,current:null,history:{...base.history,accidents:[a('충돌','2023-05-01',1,2),a('전복','2021-01-01',0,1)]}},at);assert.equal(r.cas,'사망 1명·실종 2명(23년, 충돌), 실종 1명(21년, 전복)');});
 await check('시트 막대: 60초 갱신으로 지금이 지나 열린 시트 시각이 지금보다 앞서도 「· 예보」·지금 눈금을 붙이지 않음·미래만 붙임',async()=>{
  const r=await page.evaluate(()=>{const el=document.createElement('div');document.body.appendChild(el);const times=['2026-10-15T16:13:00+09:00','2026-10-15T18:00:00+09:00'],out=[];
   for(const sel of ['2026-10-15T16:12:00+09:00','2026-10-15T18:00:00+09:00']){RiskSlider.mount(el,times,sel,()=>{},{risk:true,now:times[0]});out.push([el.querySelector('.rf-time-label').textContent,el.querySelector('.rf-st-marks i.now').hidden]);}el.remove();return out;});
  assert.deepEqual(r,[["'26.10.15(목) 16:12",true],["'26.10.15(목) 18:00 · 예보",false]]);});
 await check('원천 문자열의 HTML 을 실행하지 않음(사고 종류·원인·해역 이름)',async()=>{
  const r=await direct({...base,location:'<img src=x onerror=alert(1)>',current:null,history:{...base.history,accidents:[{date:'2024-01-01',year:2024,type:'<img src=x onerror=alert(1)>',cause:'<script>evil()</script>',death:0,missing:0}]}},at);
  assert.ok(!/<img|<script/.test(r.html),'escape');assert.ok(r.html.includes('&lt;img'));});
 await check('기준 상세(sea): 밀집도 앱 가안·지도 [혼잡도] 지금/미래·교통량 정의·사고 범위 문구',async()=>{const sea=await page.evaluate(()=>RiskBasisContent.sea);for(const s of ['앱 가안','5·10·20%','같은 산식인지는 확인하지 못했습니다','[혼잡도]는 지금 시각이면 실시간 밀집도','미래 시각이면 공식 혼잡예보','5분 값','평균 척수','배포 뒤부터','5㎞ 칸','2021~2025년','해양오염·부유물감김은 제외'])assert.ok(sea.includes(s),s);});
 await check('실행 오류 없음',()=>assert.deepEqual(errors,[]));
}finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));for(const d of dirs)fs.rmSync(d,{recursive:true,force:true});console.log(`${pass} PASS / ${fail} FAIL`);if(fail)process.exitCode=1;}})().catch(e=>{console.error('❌ 브라우저 검사 실행 실패:',e.message);console.log(`${pass} PASS / ${fail+1} FAIL`);process.exitCode=1;});
