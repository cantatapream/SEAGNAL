/**
 * 역할: 새 해양교통 칸에 대해구·대표 소해구·주요지명·특보구역을 붙인다.
 * [연계] sea_traffic_collector → data/risk_forecast/sea_cells.json → risk_store/지도.
 * [로드 순서] 서버 require 부작용 없음. 육지 자르기는 화면의 해안선 마스크와 같은 원본을 쓴다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const io = require('./risk_collector_io');
const G = require('./risk_geo');
const CLIENT = path.join(__dirname, '..', '..', 'client');
let tables;
/** 위치 원본을 한 번 읽는다. 예: tide.js의 주요지명 165개를 별도 복제하지 않는다. @returns {object} [연계] ← describe */
function loadTables() {
    if (tables) return tables;
    const marine = JSON.parse(fs.readFileSync(path.join(CLIENT, 'marine_zone_area.json'))).features;
    const boxes = marine.map(f => {
        const points = f.geometry.coordinates.flat(Infinity);
        const xs = points.filter((_, i) => i % 2 === 0), ys = points.filter((_, i) => i % 2 === 1);
        return { major: Number(f.properties.marine_zone_no), minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    }).sort((a,b) => a.major-b.major);
    const tide = fs.readFileSync(path.join(CLIENT, 'tide.js'), 'utf8').match(/const TIDE_REFERENCE_STATIONS\s*=\s*(\[[\s\S]*?\n\]);/);
    if (!tide) throw new Error('reference table missing');
    const refs = vm.runInNewContext('(' + tide[1] + ')', {}, { timeout: 100 });
    const zones = JSON.parse(fs.readFileSync(path.join(CLIENT, 'assets', 'warn_zones.geojson'))).features;
    const subZones = JSON.parse(fs.readFileSync(path.join(CLIENT, 'assets', 'warn_zones_sub.geojson'))).features;
    tables = { boxes, refs, zones, subZones };
    return tables;
}
/** 중심±.0125도 칸을 공간표에 연결한다. 예: 동률 소해구는 번호 작은 쪽. @param {object} r @returns {object} [연계] ← update */
function describe(r) {
    const { boxes, refs, zones, subZones } = loadTables();
    const lat = Number(r.latitude), lon = Number(r.longitude);
    const rect = [lon-.0125, lat-.0125, lon+.0125, lat+.0125];
    const area = b => Math.max(0,Math.min(rect[2],b.maxX)-Math.max(rect[0],b.minX))*Math.max(0,Math.min(rect[3],b.maxY)-Math.max(rect[1],b.minY));
    let best = null, bestArea = 0;
    for (const b of boxes) { const a = area(b); if (a > bestArea) { bestArea = a; best = b; } }
    let sub = null;
    if (best) {
        let max = -1;
        for (let s = 1; s <= 9; s++) {
            const row = Math.floor((s-1)/3), col = (s-1)%3;
            const dx=(best.maxX-best.minX)/3,dy=(best.maxY-best.minY)/3;
            const a=area({minX:best.minX+col*dx,maxX:best.minX+(col+1)*dx,minY:best.maxY-(row+1)*dy,maxY:best.maxY-row*dy});
            if(a>max){max=a;sub=s;}
        }
    }
    let ref=null,dist=Infinity;
    for (const r of refs) { const d=G.haversine(r.lat,r.lon,lat,lon); if(d<dist){ref=r;dist=d;} }
    const bearing=ref?G.bearing(ref.lat,ref.lon,lat,lon):null;
    const zone=zones.find(z=>G.pointInGeometry([lon,lat],z.geometry));
    const child=subZones.find(z=>G.pointInGeometry([lon,lat],z.geometry));
    return { id:String(r.gridId), lat, lon, haegu:best?{major:best.major,sub,label:best.major+'-'+sub}:null,
        ref:ref?{name:ref.name,bearingDeg:Math.round(bearing)%360,bearingWord:G.direction16(bearing),distNm:+(dist/1.852).toFixed(1)}:null,
        warnZone:zone?zone.properties.name:null, warnSubZone:child?child.properties.name:null };
}
/** 기존 번호를 지키며 새 칸만 덧붙인다. 예: 새수집에서 안 온 칸도 위치표에는 남는다. @param {array} rows @param {object} options @returns {object} [연계] ← sea_traffic_collector */
function update(rows, { dir = io.DEFAULT_DIR } = {}) {
    const file=path.join(dir,'sea_cells.json');
    const old=io.read(file)||{cells:[]};
    const cells=old.cells.slice(), known=new Set(cells.map(c=>c.id));
    for(const row of rows){if(known.has(String(row.gridId)))continue;const c=describe(row);c.i=cells.length;cells.push(c);known.add(c.id);}
    const next={v:cells.length,cellDeg:.025,cells};io.write(file,next);return next;
}
module.exports={describe,update};
