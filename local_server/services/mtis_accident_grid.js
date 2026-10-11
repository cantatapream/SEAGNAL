/**
 * 파일명: local_server/services/mtis_accident_grid.js
 * 역할  : 공식 MTIS 공개 지도의 선박사고 격자 경계를 받아 API 중심점과 대조한다.
 * [연계] sea_accident_collector → 본 모듈 → risk_sea_cells.describe / 서버내 수집 전용
 * [로드 순서] 서버 require 부작용 없음. 이용자 쿠키·과거 스냅샷·추정 경계는 사용하지 않는다.
 */
'use strict';
const G=require('./risk_geo');
const ORIGIN='https://mtis.komsa.or.kr';
/** 공식 경위도 Polygon을 검증하고 API 격자에 붙인다. 예: ID는같아도중심이다르면실패.
 * @param {object} collection - 공식 GeoJSON @param {array} rows - API 중심점
 * @returns {array} 경계·대표해구를 가진 칸 [연계] ← collectGrid / 두출처공간일치검사
 */
function bind(collection,rows){
    if(collection?.type!=='FeatureCollection'||!Array.isArray(collection.features))throw new Error('invalid response');
    const byId=new Map();
    for(const f of collection.features){
        const id=String(f.properties?.gridId||''),geo=f.geometry;
        if(!id||byId.has(id)||geo?.type!=='Polygon'||geo.coordinates?.length!==1)throw new Error('invalid response');
        const ring=geo.coordinates[0];
        if(!Array.isArray(ring)||ring.length<4||ring.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||p[0]<115||p[0]>140||p[1]<20||p[1]>45)||ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1])throw new Error('invalid response');
        const xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]);
        byId.set(id,{geometry:geo,bounds:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)],lat:Number(f.properties?.yCrd),lon:Number(f.properties?.xCrd)});
    }
    return rows.map((r,i)=>{
        const f=byId.get(String(r.gridId));
        if(!f||!Number.isFinite(f.lat)||!Number.isFinite(f.lon)||Math.abs(f.lat-r.latitude)>1e-5||Math.abs(f.lon-r.longitude)>1e-5||!G.pointInGeometry([r.longitude,r.latitude],f.geometry))throw new Error('invalid response');
        return {...require('./risk_sea_cells').describe(r,{bounds:f.bounds}),i,geometry:f.geometry};
    });
}
/** 새 익명 세션의 공개 경계를 받는다. 예: API 위험값은이웹응답에서가져오지않음.
 * @param {array} rows - API 격자 @param {string} forecastAt - YYYY-MM-DD HH:mm:ss
 * @param {function} fetchImpl - 정상 TLS fetch @returns {Promise<array>} 칸
 * [연계] ← sea_accident_collector / 좌표계·원점추측없이공식폴리곤사용
 */
async function collectGrid(rows,forecastAt,fetchImpl=fetch){
    const page=await fetchImpl(ORIGIN+'/traffic/focst/acdntRisk',{signal:AbortSignal.timeout(30000)});
    if(!page.ok)throw new Error('HTTP '+page.status);
    const html=await page.text(),meta={};
    for(const m of html.matchAll(/<meta\b[^>]*>/gi)){const attrs={};for(const a of m[0].matchAll(/([\w-]+)\s*=\s*['"]([^'"]*)['"]/g))attrs[a[1]]=a[2];if(attrs.name)meta[attrs.name]=attrs.content;}
    if(!meta._csrf||!/^x[-\w]+$/i.test(meta._csrf_header||''))throw new Error('invalid response');
    const cookies=(page.headers.getSetCookie?.()||[]).map(c=>c.split(';')[0]).join('; ');
    const response=await fetchImpl(ORIGIN+'/traffic/focst/acdnt/focstAccDgGrid',{method:'POST',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json','Accept':'application/json','X-Requested-With':'XMLHttpRequest','Origin':ORIGIN,'Referer':ORIGIN+'/traffic/focst/acdntRisk',Cookie:cookies,[meta._csrf_header]:meta._csrf},body:JSON.stringify({selectOp:forecastAt})});
    if(!response.ok)throw new Error('HTTP '+response.status);
    let collection=await response.json();if(typeof collection==='string')collection=JSON.parse(collection.replace(/&quot;/g,'"'));
    return bind(collection,rows);
}
module.exports={bind,collectGrid};
