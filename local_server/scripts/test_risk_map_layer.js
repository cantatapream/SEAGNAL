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
   const selected=[],layer=RiskMapLayer.create(map,(kind,id)=>selected.push({kind,id})),spots=input.table.spots.map((p,i)=>({...p,i}));
   window.fetch=async url=>({ok:true,json:async()=>url==='/api/warn-zones'?input.main:url==='/api/warn-zones-sub'?input.sub:input.land});
   await layer.boundaries({get:async()=>input.islands});
   layer.setTables({cells:[]},{spots});layer.setActive({coast:true,sea:false},true);layer.drawCoast({spots:spots.map(p=>[p.i,1])});
   const find=name=>map.getLayers().getArray().find(l=>l.getClassName()==='rf-'+name+'-canvas');
   const coast=find('coast').getSource().getFeatures(),shore=find('shore').getSource().getFeatures(),points=find('points').getSource().getFeatures();
   const empty=spots.filter(p=>p.geometry.coordinates.length===0);
   const skipped=empty.every(p=>!coast.some(f=>f.get('id')===p.id));
   const child=input.sub.features[0].properties.name;layer.drawBorders([{borders:[{zone:child,color:'wrn'}]}]);
   const childBorders=find('borders').getSource().getFeatures().length;
   map.renderSync();layer.drawCoast({spots:spots.map(p=>[p.i,2])});map.renderSync();const repeat=find('coast').getSource().getFeatures().length;
   const chosenEmpty=empty.find(p=>points.some(f=>f.get('ids').includes(p.id)&&f.get('ids').length===1)),emptyPoint=points.find(f=>f.get('ids').includes(chosenEmpty.id)),duplicate=points.find(f=>f.get('ids').length>1);
   const click=f=>{map.getView().setCenter(f.getGeometry().getCoordinates());map.renderSync();return layer.hit({coordinate:f.getGeometry().getCoordinates(),pixel:map.getPixelFromCoordinate(f.getGeometry().getCoordinates())});};
   const emptyHit=click(emptyPoint),emptySelected=selected.at(-1).id,duplicateHit=click(duplicate),duplicateSelected=selected.at(-1).id;
   layer.setSelection('coast',chosenEmpty.id);const emptyHighlight=find('selection').getSource().getFeatures().length;
   layer.setActive({coast:false,sea:true},true);const hiddenPoints=!find('points').getVisible(),offHit=click(emptyPoint);layer.destroy();
   return{count:spots.length,empty:empty.length,coast:coast.length,repeat,shore:shore.length,childBorders,skipped,pointIds:points.flatMap(f=>f.get('ids')).length,emptyPointIds:empty.every(p=>points.some(f=>f.get('ids').includes(p.id))),emptyHit,emptySelected,expectedEmpty:chosenEmpty.id,duplicateHit,duplicateSelected,expectedDuplicate:duplicate.get('ids'),emptyHighlight,hiddenPoints,offHit};
  },{table,land,islands,main,sub});
  test('실제 관광지 원천 전체 사용',()=>assert.equal(result.count,table._about.sourceSpots));
  test('빈 교차 형상 수는 정적 빌드 기록과 일치',()=>assert.equal(result.empty,table._about.emptyGeometries));
  test('빈 형상은 건너뛰고 모든 유효 관광지 표시',()=>assert.equal(result.coast,result.count-result.empty));
  test('빈 형상에 대체 관광지 원을 만들지 않음',()=>assert.equal(result.skipped,true));
  test('슬라이더 프레임 재그리기도 전체 유효 형상 유지',()=>assert.equal(result.repeat,result.coast));
  test('육지·21개 섬 원천 외곽선 표시',()=>assert.equal(result.shore,land.rings.length+islands.features.reduce((n,f)=>n+(f.geometry.type==='MultiPolygon'?f.geometry.coordinates.length:1),0)));
  test('실제 하위 특보 이름으로 경계 표시',()=>assert.equal(result.childBorders,1));
  test('빈면 포함 모든 관광지를 중심점에서 선택 가능',()=>{assert.equal(result.pointIds,result.count);assert.equal(result.emptyPointIds,true);assert.equal(result.emptyHit,true);assert.ok(Array.isArray(result.emptySelected)?result.emptySelected.includes(result.expectedEmpty):result.emptySelected===result.expectedEmpty);});
  test('동일좌표 클릭은 전체 관광지 선택 후보 전달',()=>{assert.equal(result.duplicateHit,true);assert.deepEqual(result.duplicateSelected,result.expectedDuplicate);});
  test('빈면 선택도 흰 중심점 강조가 남음',()=>assert.ok(result.emptyHighlight>=1));
  test('연안OFF는 중심점 숨김과 클릭 해제',()=>{assert.equal(result.hiddenPoints,true);assert.equal(result.offHit,false);});
  test('전수 지도 렌더링의 미처리 오류 없음',()=>assert.deepEqual(errors,[]));
  const official=await page.evaluate(()=>{
   const host=document.createElement('div');host.id='official-map';host.style.cssText='width:412px;height:915px';document.body.appendChild(host);
   const map=new ol.Map({target:host,layers:[],view:new ol.View({center:ol.proj.fromLonLat([126.49,36.41]),zoom:12})}),selected=[];
   const layer=RiskMapLayer.create(map,(kind,id,point)=>selected.push({kind,id,point}));
   // 공식 공개웹 2026-10-11 12시 격자14802의 원본 경계. 그리기 검사는 정합성 검사와 별개다.
   const geometry={type:'Polygon',coordinates:[[[126.4678348288123,36.39086142052764],[126.4678348288123,36.42700968205161],[126.5127505930183,36.42700968205161],[126.5127505930183,36.39086142052764],[126.4678348288123,36.39086142052764]]]};
   layer.setTables({cells:[{i:0,id:'traffic-fixture',lat:36.415,lon:126.50}]},{spots:[]},{cells:[{i:0,id:'14802',lat:36.408936,lon:126.490293,geometry}]});
   layer.setActive({coast:false,sea:true},true);layer.drawAccident({cells:[[0,.015262514,'경계']]});layer.drawSea({cells:[[0,99,.14,'낮음']]});map.renderSync();
   const find=name=>map.getLayers().getArray().find(l=>l.getClassName()==='rf-'+name+'-canvas'),accident=find('accident').getSource().getFeatures()[0],traffic=find('sea').getSource().getFeatures()[0];
   const point=ol.proj.fromLonLat([126.505,36.42]);const hit=layer.hit({coordinate:point,pixel:map.getPixelFromCoordinate(point)}),chosen=selected.at(-1);
   const extent=accident.getGeometry().getExtent(),colors=[];['낮음','보통','주의','경계'].forEach(level=>{layer.drawAccident({cells:[[0,.0001,level]]});colors.push(find('accident').getSource().getFeatures()[0].getStyle().getFill().getColor());});
   layer.drawAccident({cells:[[0,.9,'미확인']]});const unknown=find('accident').getSource().getFeatures().length;
   layer.setActive({coast:true,sea:false},true);const off=!find('accident').getVisible()&&!find('sea').getVisible();layer.destroy();map.dispose();host.remove();
   return{extent,riskIndex:accident.get('riskIndex'),level:accident.get('level'),trafficLevel:traffic.get('level'),trafficFill:traffic.getStyle()[0].getFill().getColor(),trafficStyles:traffic.getStyle().length,hit,chosen,colors,unknown,off};
  });
  test('공식 사고 격자는 원본5000m경계와 원시지수 유지',()=>{assert.ok(Math.abs(official.extent[2]-official.extent[0]-5000)<.001);assert.ok(Math.abs(official.extent[3]-official.extent[1]-5000)<.001);assert.equal(official.riskIndex,.015262514);assert.equal(official.level,'경계');});
  test('공식4단계 그대로 구별하고 미확인단계 추정금지',()=>{assert.equal(new Set(official.colors).size,4);assert.equal(official.unknown,0);});
  test('혼잡은 자체사고점수99 대신 공식낮음 점선·한점 표시',()=>{assert.equal(official.trafficLevel,'낮음');assert.equal(official.trafficFill,'rgba(0,0,0,0)');assert.equal(official.trafficStyles,2);});
  test('겹친격자 클릭은 사고상세와 실제클릭 경위도 전달',()=>{assert.equal(official.hit,true);assert.equal(official.chosen.kind,'accident');assert.equal(official.chosen.id,'14802');assert.ok(Math.abs(official.chosen.point.lon-126.505)<1e-8);assert.ok(Math.abs(official.chosen.point.lat-36.42)<1e-8);});
  test('해상OFF는 공식사고와 혼잡 둘다 숨김',()=>assert.equal(official.off,true));
  for(const file of ['style.css','js/marine-life/risk-forecast/risk_forecast.css'])await page.addStyleTag({path:path.join(root,'client',file)});
  const index=fs.readFileSync(path.join(root,'client/index2.html'),'utf8');await page.addStyleTag({content:index.slice(index.indexOf('        .ocean-legend-stack > .banzone-legend,'),index.indexOf('        /* 선택 초기화 버튼',index.indexOf('        .ocean-legend-stack > .banzone-legend,')))});
  for(const file of ['risk_slider.js','risk_sheet.js','risk_basis_content.js','risk_basis.js'])await page.addScriptTag({path:path.join(root,'client/js/marine-life/risk-forecast',file)});
  await page.emulateMedia({reducedMotion:'reduce'});
  const ui=await page.evaluate(()=>{
   document.body.className='ls-safety';const host=document.createElement('div');host.className='rf-sheet';document.body.appendChild(host);const choices=[];const sheet=RiskSheet.create(host,{close(){},hazard(){},basis(){},retry(){},choose:(kind,id)=>choices.push({kind,id})});
   sheet.choose([{id:'a',name:'관광지A'},{id:'b',name:'관광지B'}]);host.querySelector('[data-spot-id="b"]').click();
   sheet.show({title:{major:1,sub:1},subtitle:{name:'부산',bearingWord:'북동',bearingDeg:45,distNm:1},score:.75,index:25,band:'다소 높음',rr:1.68,clickable:true,rows:[{key:'wave',value:2.6},{key:'wind',value:13}],sources:{zoneForecasts:{status:'stale',updatedAt:'2026-10-09T09:00:00+09:00'}}},'sea',{});
   const staleText=host.querySelector('.rf-body').textContent;RiskSlider.mount(sheet.timelineEl,['2026-10-11T18:00:00+09:00','2026-10-11T21:00:00+09:00'],'2026-10-11T18:00:00+09:00',()=>{});
   RiskBasis.open('coast');const close=document.querySelector('.mclose'),focused=getComputedStyle(close),basis=document.querySelector('.rf-basis').textContent;
   const legend=document.createElement('div');legend.className='rf-legend';legend.innerHTML='<div class="banzone-legend"><button class="bzl-row"><span class="bzl-switch"></span></button></div>';document.body.appendChild(legend);
   const result={choices,staleText,basis,headerColor:getComputedStyle(document.querySelector('.rf-basis th')).color,focusWidth:focused.outlineWidth,focusColor:focused.outlineColor,focusOffset:focused.outlineOffset,tipTransition:getComputedStyle(host.querySelector('.ocean-sheet-tooltip')).transitionDuration,switchTransition:getComputedStyle(legend.querySelector('.bzl-switch')).transitionDuration,sliderLabel:host.querySelector('input').getAttribute('aria-label')};RiskBasis.close();return result;
  });
  test('같은 위치 목록에서 다른 관광지 선택',()=>assert.deepEqual(ui.choices,[{kind:'coast',id:'b'}]));
  test('낡은 예보 기준은 경고와 파고·풍속줄에 표시',()=>assert.ok((ui.staleText.match(/예보 기준/g)||[]).length>=3));
  test('연안 기준상세 확정 색문안 복구',()=>{assert.match(ui.basis,/1배 초록 → 1.5배 노랑 → 4배 주황 → 8배 빨강의 연속 그라데이션/);assert.match(ui.basis,/이 관광지 주변 3km에서 이 날에/);});
  test('근거표 제목 색은 확정노랑',()=>assert.equal(ui.headerColor,'rgb(255, 225, 122)'));
  test('키보드 초점은 파랑2px·offset2px',()=>{assert.equal(ui.focusWidth,'2px');assert.equal(ui.focusColor,'rgb(68, 138, 255)');assert.equal(ui.focusOffset,'2px');});
  test('움직임줄이기 스위치·말풍선 전환 중단',()=>{assert.equal(ui.tipTransition,'0s');assert.equal(ui.switchTransition,'0s');});
  test('시간축 보조기기 이름',()=>assert.equal(ui.sliderLabel,'시간 이동'));
  const officialSheet=await page.evaluate(()=>{
   const host=document.createElement('div');host.className='rf-sheet';document.body.appendChild(host);const basisKinds=[];const sheet=RiskSheet.create(host,{close(){},hazard(){},basis:kind=>basisKinds.push(kind),retry(){},choose(){}});
   sheet.show({gridId:'14802',lat:36.408936,lon:126.490293,accidentRiskIndex:.015262514,accidentRiskLevel:'경계',forecastAt:'2026-10-11T12:00:00+09:00',createdAt:'2026-10-11T03:00:00+09:00',congestion:{gridId:'GR4_fixture',congestionIndex:.14,congestionLevel:'낮음',forecastAt:'2026-10-11T13:00:00+09:00'},weather:{source:'기상청 해구별 예보',forecastAt:'2026-10-11T12:00:00+09:00',wh:.2,ws:3.1,wp:4.14,wd:241},missing:[],sources:{accident:{status:'ok'}}},'accident',{});
   const text=host.textContent,noOwnIndex=!host.querySelector('.rf-index'),accidentBasis=!!host.querySelector('[data-basis="sea"]');host.querySelector('[data-basis="sea"]').click();sheet.show({title:{major:1,sub:1},subtitle:{name:'참조',bearingDeg:45},score:3,rr:8,index:100,officialCongestionLevel:'낮음',rows:[{key:'congestion',levelName:'보통',ci:5},{key:'wave',value:1},{key:'wind',value:3}],missing:[]},'sea',{});const trafficText=host.textContent,trafficBasis=!!host.querySelector('[data-basis="sea"]');host.querySelector('[data-basis="sea"]').click();sheet.show({title:{major:1,sub:1},subtitle:{},rows:[{key:'congestion',levelName:'높음',ci:10}],missing:[]},'sea',{});const unknownText=host.textContent;return{text,noOwnIndex,trafficText,unknownText,accidentBasis,trafficBasis,basisKinds,missingMessages:RiskSheet.sourceMessages({sources:{accident:{status:'error'}}},'accident')};
  });
  test('공식 사고상세는 원시지수·생성시각과 다른기상 출처분리',()=>{assert.match(officialSheet.text,/공식 선박 사고 위험예보/);assert.match(officialSheet.text,/0.015262514/);assert.match(officialSheet.text,/발생 확률/);assert.match(officialSheet.text,/GR4_fixture/);assert.match(officialSheet.text,/파주기/);assert.match(officialSheet.text,/4.14s/);assert.match(officialSheet.text,/241°/);assert.match(officialSheet.text,/기상청 해구별 예보/);assert.equal(officialSheet.noOwnIndex,true);});
  test('혼잡만있는 상세는 자체위험 배수를 공식처럼 표시하지 않음',()=>{assert.doesNotMatch(officialSheet.trafficText,/약 8배|위험지수|전복/);assert.match(officialSheet.trafficText,/낮음/);});
  test('공식사고 원천실패는 상세경고로 구분',()=>assert.match(officialSheet.missingMessages.join(' '),/공식 선박 사고 위험예보 자료 수집에 실패/));
  test('혼잡5의 공식낮음은 기존보통 판정으로 바꾸지 않음',()=>{assert.match(officialSheet.trafficText,/낮음 · 지수 5/);assert.doesNotMatch(officialSheet.trafficText,/보통/);assert.match(officialSheet.unknownText,/단계 확인 불가/);assert.doesNotMatch(officialSheet.unknownText,/높음/);});
  test('사고·혼잡 시트 모두 공식기준 상세 버튼 연결',()=>{assert.equal(officialSheet.accidentBasis,true);assert.equal(officialSheet.trafficBasis,true);assert.deepEqual(officialSheet.basisKinds,['sea','sea']);});


 }finally{await browser.close();}
 console.log(`${pass} PASS / ${fail} FAIL`);process.exitCode=fail?1:0;
})().catch(e=>{console.error('FAIL 지도 전수 실행:',e.message);console.log(`${pass} PASS / ${fail+1} FAIL`);process.exitCode=1;});
