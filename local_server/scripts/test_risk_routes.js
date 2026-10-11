/** 역할: 실제 HTTP 위험예측 라우터의 계약·캐시·오류·PDF 다운로드를 검증한다.
 * [연계] routes/risk_forecast.js · 임시 보고서/가짜 저장소만 사용, 수집/키/푸시 없음
 */
'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert'),express=require('express'),{createRouter}=require('../routes/risk_forecast');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'risk-routes-')),sources={warnings:{status:'missing'}};let pass=0,fail=0;
let freshCalls=0;const store={sources:fresh=>{if(fresh)freshCalls++;return sources;},meta:()=>({now:'2026-10-11T12:00:00+09:00',timeline:{sea:{times:[]},coast:{times:[]}}}),spots:()=>({spots:[{id:'one'}]}),cells:()=>{throw Object.assign(new Error('해양교통 칸 위치표 준비 전'),{status:503});},frame:(sea,t)=>{if(!t)throw Object.assign(new Error('잘못된 예보 시각'),{status:400});return{t,[sea?'cells':'spots']:[]};},coastDetail:(id,t)=>({t,title:id}),seaDetail:(id,t)=>({t,title:id}),hazards:ids=>({type:'FeatureCollection',features:ids}),islands:()=>({type:'FeatureCollection',features:[]})};
const app=express();app.use(createRouter({store,reportDir:dir}));
/** 실제 응답을 검사해 요청 순서를 보장한다. 예: 오류에서도 source 상태 유지.
 * @param {string} name - 검사명 @param {function} fn - 비동기 검사 @returns {Promise<void>} [연계] ← 아래 HTTP 검사
 */
async function check(name,fn){try{await fn();console.log('✅',name);pass++;}catch(e){console.error('❌',name,e.message);fail++;}}
const server=app.listen(0,'127.0.0.1',async()=>{const url='http://127.0.0.1:'+server.address().port+'/api/risk-forecast';try{
 await check('meta/status는 no-store·자료 상태 포함',async()=>{for(const route of ['/meta','/status']){const r=await fetch(url+route);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');const b=await r.json();assert.equal(b.ok,true);assert.equal(b.sources.warnings.status,'missing');}});
 await check('status 요청은 원자료 상태를 매번 최신 읽기',async()=>{const before=freshCalls;await fetch(url+'/status');await fetch(url+'/status');assert.equal(freshCalls-before,2);});
 await check('fixture 쿼리는 실제 API 자료를 우회하지 않음',async()=>{const normal=await(await fetch(url+'/meta')).json(),fixture=await(await fetch(url+'/meta?fixture=1')).json();assert.deepEqual(fixture,normal);});
 await check('정적 지점은 하루 캐시·지도 frame 계약',async()=>{const r=await fetch(url+'/coast/spots');assert.equal(r.headers.get('cache-control'),'public, max-age=86400');assert.equal((await r.json()).spots[0].id,'one');for(const kind of ['sea','coast']){const response=await fetch(url+'/'+kind+'/frame?t='+encodeURIComponent('2026-10-11T12:00:00+09:00'));assert.ok(Array.isArray((await response.json())[kind==='sea'?'cells':'spots']));}});
 await check('자료 준비 전 503과 잘못된 시각 400은 캐시 금지',async()=>{for(const [route,status]of [['/sea/cells',503],['/sea/frame',400]]){const r=await fetch(url+route);assert.equal(r.status,status);assert.equal(r.headers.get('cache-control'),'no-store');const b=await r.json();assert.equal(b.ok,false);assert.deepEqual(b.sources,sources);}});
 await check('상세·위험구역 필수 파라미터 및 id 계약',async()=>{for(const route of ['/coast/spot','/sea/cell','/hazard-zones'])assert.equal((await fetch(url+route)).status,400);const r=await fetch(url+'/coast/spot?id='+encodeURIComponent('경남|해안'));assert.equal((await r.json()).title,'경남|해안');const h=await fetch(url+'/hazard-zones?ids=a,b');assert.deepEqual((await h.json()).features,['a','b']);});
 await check('PDF만 다운로드·준비 전503·다른 종류404',async()=>{assert.equal((await fetch(url+'/report/sea')).status,503);fs.writeFileSync(path.join(dir,'해상_위험지수_산출근거.pdf'),'%PDF-1.7\nfixture');const r=await fetch(url+'/report/sea');assert.equal(r.status,200);assert.ok(r.headers.get('content-type').includes('application/pdf'));assert.ok(r.headers.get('content-disposition').includes("filename*=UTF-8''"));assert.ok((await r.text()).startsWith('%PDF'));assert.equal((await fetch(url+'/report/unknown')).status,404);});
 await check('내부 오류 메시지·URL·키를 응답에 출력하지 않음',async()=>{store.spots=()=>{throw new Error('secret URL serviceKey=private');};const r=await fetch(url+'/coast/spots');assert.equal(r.status,503);assert.equal((await r.json()).error,'위험예측 자료 처리 실패');});
}finally{server.close();fs.rmSync(dir,{recursive:true,force:true});console.log(`${pass} PASS / ${fail} FAIL`);if(fail)process.exitCode=1;}});
