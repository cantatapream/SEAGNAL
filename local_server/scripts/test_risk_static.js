/** 파일명: local_server/scripts/test_risk_static.js
 * 역할  : 배송 정적 표가 원본 관광지·위험구역·이안류·기하 계약을 보존하는지 검사한다.
 * [연계] config/coastal_safety/risk_spots.json·build_risk_static.js · 개발검사 전용
 */
'use strict';
const fs=require('fs'),path=require('path'),run=require('./risk_test_helpers');
const readJson=p=>JSON.parse(fs.readFileSync(path.join(__dirname,p),'utf8'));
const root=path.join(__dirname,'..'),d=require('../config/coastal_safety/risk_spots.json'),source=require('../config/coastal_safety/coastal_spots.json'),rip=require('../config/coastal_safety/rip_spot_map.json'),hz=readJson('../config/coastal_safety/coastal_hazard_zones.wgs84.geojson');
run({
 '관광지1354개 원본순·좌표 보존':a=>{a.equal(d.spots.length,1354);a.deepEqual(d.spots.map(s=>[s.sgg,s.name,s.lat,s.lon]),source.spots.map(s=>[s.sgg,s.name,s.lat,s.lon]));},
 'ID 중복없음':a=>a.equal(new Set(d.spots.map(s=>s.id)).size,d.spots.length),
 '해수욕장313 원본이름 규칙':a=>{a.equal(d.spots.filter(s=>s.beach).length,313);for(const s of d.spots)a.equal(s.beach,/해수욕장|해변|비치/.test(s.name));},
 '위험구역222·397·505·230 재현':a=>{a.deepEqual([0,1,2,3].map(b=>d.spots.filter(s=>s.hazard.bucket===b).length),[222,397,505,230]);},
 '위험구역 목록원문과 개수·사망 판정':a=>{const names=new Map(hz.features.map(f=>[f.properties.name,f.properties]));for(const s of d.spots){a.equal(s.hazard.count,s.hazard.zoneIds.length);a.equal(s.hazard.fatal,s.hazard.zoneIds.some(id=>names.get(id)['구역분류']==='사망사고 발생구역'));for(const id of s.hazard.zoneIds)a.ok(names.has(id));}},
 '이안류12연결+전남1미연결 명시':a=>{a.equal(Object.keys(rip.places).length,13);a.equal(Object.values(rip.places).filter(Boolean).length,12);a.equal(rip.places['신지명사십리해수욕장'],null);for(const [name,id]of Object.entries(rip.places))if(id)a.equal(d.spots.find(s=>s.id===id).ripBeach,name);},
 '165지명은 tide.js 단일원문과 일치':a=>{const vm=require('vm'),tide=fs.readFileSync(path.join(root,'../client/tide.js'),'utf8'),arr=vm.runInNewContext(tide.match(/const TIDE_REFERENCE_STATIONS\s*=\s*(\[.*?\]);/s)[1]);a.equal(arr.length,165);a.equal(JSON.stringify(d.references),JSON.stringify(arr));},
 '섬21·거리5179·union클립 메타':a=>{a.equal(d._about.islands,21);a.equal(d._about.distanceCrs,'EPSG:5179');a.ok(d._about.landClip.includes('union'));},
 '경고구역·해안소해구 원천 이름 유효':a=>{const warns=new Set(readJson('../../client/assets/warn_zones.geojson').features.map(f=>f.properties.name)),gales=new Set(readJson('../../client/assets/warn_zones_land_coastal.geojson').features.map(f=>f.properties.name)),segments=new Set(require('../../client/coastline_segments.json').segments.map(s=>s.z));for(const s of d.spots){a.ok(!s.warnZone||warns.has(s.warnZone));a.ok(!s.galeZone||gales.has(s.galeZone));a.ok(segments.has(s.coastCell));}},
 '원 형상과 육지 마스크는 GeoJSON 면':a=>{a.ok(['Polygon','MultiPolygon'].includes(d.landGeometry.type));for(const s of d.spots)a.ok(['Polygon','MultiPolygon'].includes(s.geometry.type));}
});
