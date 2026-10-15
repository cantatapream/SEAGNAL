/**
 * 파일명: local_server/scripts/test_risk_station_label.js
 * 역할  : 위험예측 시트(해상·연안 부제, 위험구역 목록)의 관할 문구가 「제주해양경찰서 한림파출소 관할」 꼴인지 검사한다.
 *         사용자 요청 2026-10-15 — 종전에는 「한림파출소」처럼 파출소 이름만 나왔다.
 * [연계] 제품 risk_format.stationLabel · risk_sheet.js(해상·연안 부제, 위험구역 아코디언) ·
 *        marine_fusion.analyze(office) · risk_store.coastDetail(subtitle.office, zones[].office) /
 *        대응표 = config/coastal_safety/coastguard_stations.geojson 의 name→station · verify_all.sh SUITES
 * [로드 순서] 독립 검사 — 임시 폴더·실제 Chromium(PW_CHROME)만 쓰고 운영 수집·3001 포트를 쓰지 않는다.
 */
'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm'),assert=require('assert'),{chromium}=require('playwright-core');
const root=path.join(__dirname,'../..'),ui=path.join(root,'client/js/marine-life/risk-forecast'),realConfig=path.join(root,'local_server/config/coastal_safety');
const io=require('../services/risk_collector_io'),M=require('../services/marine_fusion'),{createStore}=require('../services/risk_store');
let pass=0,fail=0;
/** 사례 하나를 실행하고 verify_all 이 읽는 PASS/FAIL 개수를 센다. 예: await test('이름',async()=>{...}).
 * @param {string} name - 사례 이름 @param {Function} fn - 검증 @returns {Promise<void>}
 * [연계] ← 아래 사례 / 실패해도 나머지 사례를 계속 돈다.
 */
async function test(name,fn){try{await fn();pass++;console.log('✅',name);}catch(e){fail++;console.error('❌',name,e.message);}}
(async()=>{let browser;try{
 // 1) 서식 함수 — 순수 함수라 vm 에서 바로 부른다.
 const ctx={window:{},URL};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(ui,'risk_format.js'),'utf8'),ctx);const F=ctx.window.RiskFormat;
 await test('서식: 경찰서+파출소+관할',()=>{assert.equal(typeof F.stationLabel,'function');assert.equal(F.stationLabel('한림파출소','제주해양경찰서'),'제주해양경찰서 한림파출소 관할');});
 await test('서식: 「파출소」가 빠진 이름은 붙여 쓴다(위험구역 자료 「광안리」)',()=>assert.equal(F.stationLabel('광안리','부산해양경찰서'),'부산해양경찰서 광안리파출소 관할'));
 await test('서식: 출장소는 그대로',()=>assert.equal(F.stationLabel('가거도출장소','목포해양경찰서'),'목포해양경찰서 가거도출장소 관할'));
 await test('서식: 경찰서를 모르면 파출소 이름만',()=>assert.equal(F.stationLabel('없는파출소',null),'없는파출소 관할'));
 await test('서식: 파출소가 없으면 빈 문자열',()=>{assert.equal(F.stationLabel(null,'제주해양경찰서'),'');assert.equal(F.stationLabel('',''),'');});

 // 2) 해상 — marine_fusion 이 관할 폴리곤의 station(해양경찰서)을 office 로 함께 준다.
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'station-label-')),now=Date.parse('2026-10-12T11:00:00+09:00'),at='2026-10-12T11:00:00+09:00';
 const geometry={type:'Polygon',coordinates:[[[126.525,33.55],[126.55,33.55],[126.55,33.575],[126.525,33.575],[126.525,33.55]]]},cell={id:'GR4_F4K23_P4',i:0,lat:33.5625,lon:126.5375,geometry,haegu:{label:'232-2',major:232,sub:2},ref:{name:'화순항',bearingWord:'북북서',distNm:11.8}};
 io.write(path.join(dir,'sea_realtime.json.gz'),{v:'v1',cells:[cell],rows:[[0,21,.2,21,0,0,0,0,0,0,0,0,0,0,21,0,0,0,0,0]],collectedAt:at,sourceAt:null,source:'MTIS public liveSea'});
 const sources={accident:{status:'ok'},congestion:{status:'ok'},zoneForecasts:{status:'ok'}},inputs={version:1,cells:{cells:[cell]},congestion:{frames:{}},accident:{cells:[],frames:{}},sources,weather:()=>({wh:1,ws:5,wp:4,wd:241,forecastAt:at})};
 const risk={sources:()=>sources,marineInputs:()=>inputs,meta:()=>({now:at,timeline:{sea:{times:[at]}},sources})};
 const marineOf=stations=>M.createStore({risk,dir,clock:()=>now,stations,accidents:[],describe:()=>cell}).analysis({lon:cell.lon,lat:cell.lat,t:at}).marine;
 const marine=marineOf([{properties:{name:'한림파출소',station:'제주해양경찰서'},geometry}]);
 await test('해상 분석: 파출소 이름은 그대로·해양경찰서는 office',()=>{assert.equal(marine.station,'한림파출소');assert.equal(marine.office,'제주해양경찰서');assert.equal(marine.location,'화순항 북북서방 11.8해리 해역(232-2해구)');});
 await test('해상 분석: 폴리곤에 경찰서가 없으면 office 는 null',()=>{const m=marineOf([{properties:{name:'제주파출소'},geometry}]);assert.equal(m.station,'제주파출소');assert.equal(m.office,null);});
 await test('해상 분석: 실제 정리판 97곳은 모두 해양경찰서가 적혀 있다',()=>{const fsx=io.read(path.join(realConfig,'coastguard_stations.geojson')).features;assert.equal(fsx.length,97);assert.deepEqual(fsx.filter(f=>!String(f.properties.station||'').endsWith('해양경찰서')).map(f=>f.properties.name),[]);});

 // 3) 연안 — risk_store 가 실제 대응표(coastguard_stations.geojson)로 경찰서를 찾는다.
 const cdir=path.join(dir,'config'),cl=path.join(dir,'client'),dataDir=path.join(dir,'data');
 fs.mkdirSync(cdir,{recursive:true});fs.copyFileSync(path.join(realConfig,'coastguard_stations.geojson'),path.join(cdir,'coastguard_stations.geojson'));
 const template=io.read(path.join(realConfig,'risk_spots.json')).spots.find(s=>s.hazard?.count>0&&s.hazard.zones?.length);
 const zone=(id,office,police)=>({id,name:id,'소속서':office,'관할파출소':police,'구역분류':'연안사고 위험구역','장소명':id+' 장소','장소형태':'해안가','주소':id+' 주소'});
 const spot=(id,lat,lon,station,zones=[])=>({...template,id,name:id,lat,lon,station,hazard:{...template.hazard,count:zones.length||template.hazard.count,zoneIds:zones.map(z=>z.id),zones}});
 io.write(path.join(cdir,'risk_spots.json'),{_about:{hash:'station-label'},spots:[
  spot('한림',33.41,126.26,'한림파출소',[zone('강릉-1','동해해양경찰서','강릉'),zone('목포남항-1','목포해양경찰서','목포남항'),zone('남항-1','부산해양경찰서','남항'),zone('미상-1',null,'미상')]),
  spot('부산남항',35.0739,129.0165,'남항파출소'),spot('목포남항',34.79,126.37,'남항파출소'),spot('모름',35,129,'없는파출소'),spot('밖',37.24,131.87,null)]});
 io.write(path.join(cl,'assets/warn_zones.geojson'),{features:[]});io.write(path.join(cl,'assets/warn_zones_land_coastal.geojson'),{features:[]});
 const store=createStore({dir,dataDir,configDir:cdir,clientDir:cl,clock:()=>now}),coast=id=>store.coastDetail(id,at);
 await test('연안 부제: 한림파출소 → 제주해양경찰서',()=>{const s=coast('한림').subtitle;assert.equal(s.police,'한림파출소');assert.equal(s.office,'제주해양경찰서');});
 await test('연안 부제: 이름이 같은 남항파출소는 위치로 부산·목포를 가른다',()=>{assert.equal(coast('부산남항').subtitle.office,'부산해양경찰서');assert.equal(coast('목포남항').subtitle.office,'목포해양경찰서');});
 await test('연안 부제: 대응표에 없는 파출소·관할 밖은 office null',()=>{assert.equal(coast('모름').subtitle.office,null);assert.equal(coast('밖').subtitle.police,null);assert.equal(coast('밖').subtitle.office,null);});
 const zones=coast('한림').rows.find(r=>r.key==='hazard').zones,officeOf=id=>zones.find(z=>z.id===id).office;
 await test('위험구역: 현행 대응표가 2023 자료의 옛 소속서보다 앞선다(강릉 → 강릉해양경찰서)',()=>assert.equal(officeOf('강릉-1'),'강릉해양경찰서'));
 await test('위험구역: 대응표에 없는 이름은 구역 자료의 소속서를 쓴다(목포남항)',()=>assert.equal(officeOf('목포남항-1'),'목포해양경찰서'));
 await test('위험구역: 같은 이름 남항은 구역 자료의 소속서로 가른다',()=>assert.equal(officeOf('남항-1'),'부산해양경찰서'));
 await test('위험구역: 어디에도 없으면 null',()=>assert.equal(officeOf('미상-1'),null));

 // 4) 실제 시트 렌더 — 머리 부제와 아코디언 문구.
 browser=await chromium.launch({...(process.env.PW_CHROME?{executablePath:process.env.PW_CHROME}:{}),headless:true,args:['--no-sandbox']});
 const page=await browser.newPage();await page.setContent('<!doctype html><html><body><div id="sheet"></div></body></html>');
 for(const file of ['risk_format.js','risk_sheet.js','risk_marine.js'])await page.addScriptTag({content:fs.readFileSync(path.join(ui,file),'utf8')});
 await page.evaluate(()=>{window.sheet=RiskSheet.create(document.getElementById('sheet'),{close(){},hazard(){},basis(){},choose(){},retry(){}});});
 const show=(d,kind,item)=>page.evaluate(([d,kind,item])=>{sheet.show(d,kind,item);return{title:document.querySelector('.rf-title').textContent,sub:document.querySelector('.rf-subtitle').textContent,body:document.querySelector('.rf-body').textContent};},[d,kind,item]);
 await test('해상 시트 머리: 「제주해양경찰서 한림파출소 관할」',async()=>{const r=await show({marine,t:at},'sea',{id:cell.id});assert.equal(r.title,'화순항 북북서방 11.8해리 해역(232-2해구)');assert.equal(r.sub,'제주해양경찰서 한림파출소 관할');});
 await test('해상 시트 머리: 경찰서를 모르면 「제주파출소 관할」·관할 없으면 빈칸',async()=>{assert.equal((await show({marine:{...marine,station:'제주파출소',office:null},t:at},'sea',{id:cell.id})).sub,'제주파출소 관할');assert.equal((await show({marine:{...marine,station:null,office:null},t:at},'sea',{id:cell.id})).sub,'');});
 await test('연안 시트 머리: 좌표 뒤 「제주해양경찰서 한림파출소 관할」',async()=>{const d=coast('한림'),r=await show(d,'coast',{id:'한림',lat:33.41,lon:126.26});assert.match(r.sub,/^33°24′36″N - 126°15′36″E · 제주해양경찰서 한림파출소 관할$/);});
 await test('연안 시트 머리: 경찰서를 모르면 파출소 이름만, 관할 없으면 좌표만',async()=>{assert.match((await show(coast('모름'),'coast',{id:'모름',lat:35,lon:129})).sub,/ · 없는파출소 관할$/);assert.doesNotMatch((await show(coast('밖'),'coast',{id:'밖',lat:37.24,lon:131.87})).sub,/관할/);});
 await test('위험구역 아코디언: 「강릉해양경찰서 강릉파출소 관할」·소속서 없으면 이름만',async()=>{const r=await show(coast('한림'),'coast',{id:'한림',lat:33.41,lon:126.26});for(const t of ['강릉해양경찰서 강릉파출소 관할','목포해양경찰서 목포남항파출소 관할','부산해양경찰서 남항파출소 관할',' · 미상파출소 관할'])assert.ok(r.body.includes(t),t);});
}catch(e){fail++;console.error('❌ 준비 실패',e.stack||e.message);}finally{if(browser)await browser.close();}
console.log(`${pass} PASS / ${fail} FAIL`);process.exit(fail?1:0);})();
