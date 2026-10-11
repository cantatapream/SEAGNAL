/**
 * 파일명: local_server/scripts/test_risk_map_layer.js
 * 역할  : 실제 관광지·육지·섬 원천 전체를 제품 OpenLayers 지도 층에 넣어 빈 형상 회귀를 검사한다.
 * [연계] risk_map_layer.js · risk_spots.json · land_mask_korea.json · island_outlines.geojson / verify_all.sh
 */
'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.join(__dirname,'../..');let pass=0,fail=0;
/** 실제 실행 결과를 확인한다. 예: test('전수 형상',()=>assert.equal(...)). @param {string} label 사례 @param {Function} fn 검증 @returns {void} [연계] 아래 브라우저 결과 → assert */
function test(label,fn){try{fn();pass++;}catch(e){fail++;console.error('FAIL',label,e.message);}}
(async()=>{
 const {chromium}=require('playwright-core');
 const candidates=[process.env.PW_CHROME,process.env.SIM_CHROMIUM,process.env.CHROMIUM_EXECUTABLE,chromium.executablePath(),process.env.PLAYWRIGHT_BROWSERS_PATH&&path.join(process.env.PLAYWRIGHT_BROWSERS_PATH,'chromium')];
 const exe=candidates.find(p=>p&&fs.existsSync(p));
 const browser=await chromium.launch({...(exe?{executablePath:exe}:{}),args:['--no-sandbox']});
 try{
  const load=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
  const table=load('local_server/config/coastal_safety/risk_spots.json'),land=load('client/land_mask_korea.json'),islands=load('local_server/config/coastal_safety/island_outlines.geojson'),main=load('client/assets/warn_zones.geojson'),sub=load('client/assets/warn_zones_sub.geojson');
  const page=await browser.newPage({viewport:{width:412,height:915}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<div id="map" style="width:412px;height:915px"></div>');
  for(const file of ['assets/vendor/ol/ol.js','js/marine-life/risk-forecast/risk_format.js','js/marine-life/risk-forecast/risk_map_layer.js'])await page.addScriptTag({path:path.join(root,'client',file)});
  const result=await page.evaluate(async input=>{
   const map=new ol.Map({target:'map',layers:[],view:new ol.View({center:ol.proj.fromLonLat([129.15,35.16]),zoom:12})});
   const layer=RiskMapLayer.create(map,()=>{}),spots=input.table.spots.map((p,i)=>({...p,i}));
   window.fetch=async url=>({ok:true,json:async()=>url==='/api/warn-zones'?input.main:url==='/api/warn-zones-sub'?input.sub:input.land});
   await layer.boundaries({get:async()=>input.islands});
   layer.setTables({cells:[]},{spots});layer.setActive({coast:true,sea:false},true);layer.drawCoast({spots:spots.map(p=>[p.i,1])});
   const find=name=>map.getLayers().getArray().find(l=>l.getClassName()==='rf-'+name+'-canvas');
   const coast=find('coast').getSource().getFeatures(),shore=find('shore').getSource().getFeatures();
   const empty=spots.filter(p=>p.geometry.coordinates.length===0);
   const skipped=empty.every(p=>!coast.some(f=>f.get('id')===p.id));
   const child=input.sub.features[0].properties.name;layer.drawBorders([{borders:[{zone:child,color:'wrn'}]}]);
   const childBorders=find('borders').getSource().getFeatures().length;
   map.renderSync();layer.drawCoast({spots:spots.map(p=>[p.i,2])});map.renderSync();
   return{count:spots.length,empty:empty.length,coast:coast.length,repeat:find('coast').getSource().getFeatures().length,shore:shore.length,childBorders,skipped};
  },{table,land,islands,main,sub});
  test('실제 관광지 원천 전체 사용',()=>assert.equal(result.count,table._about.sourceSpots));
  test('빈 교차 형상 수는 정적 빌드 기록과 일치',()=>assert.equal(result.empty,table._about.emptyGeometries));
  test('빈 형상은 건너뛰고 모든 유효 관광지 표시',()=>assert.equal(result.coast,result.count-result.empty));
  test('빈 형상에 대체 관광지 원을 만들지 않음',()=>assert.equal(result.skipped,true));
  test('슬라이더 프레임 재그리기도 전체 유효 형상 유지',()=>assert.equal(result.repeat,result.coast));
  test('육지·21개 섬 원천 외곽선 표시',()=>assert.equal(result.shore,land.rings.length+islands.features.reduce((n,f)=>n+(f.geometry.type==='MultiPolygon'?f.geometry.coordinates.length:1),0)));
  test('실제 하위 특보 이름으로 경계 표시',()=>assert.equal(result.childBorders,1));
  test('전수 지도 렌더링의 미처리 오류 없음',()=>assert.deepEqual(errors,[]));
 }finally{await browser.close();}
 console.log(`${pass} PASS / ${fail} FAIL`);process.exitCode=fail?1:0;
})().catch(e=>{console.error('FAIL 지도 전수 실행:',e.message);console.log(`${pass} PASS / ${fail+1} FAIL`);process.exitCode=1;});
