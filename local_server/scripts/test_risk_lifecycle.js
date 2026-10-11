/**
 * 파일명: local_server/scripts/test_risk_lifecycle.js
 * 역할  : 실제 위험예측 조율기의 실패 복구·OFF 경쟁·날짜 전환과 API TTL을 검사한다.
 * [연계] risk_forecast.js · risk_api.js / verify_all.sh
 */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=path.join(__dirname,'../../client/js/marine-life/risk-forecast');let pass=0,fail=0;
const ui={window:{},URL};vm.createContext(ui);for(const file of ['risk_format.js','risk_sheet.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ui);
/** 제품 비동기 동작을 끝까지 검사한다. 예: await test('OFF',fn). @param {string} name 사례 @param {Function} fn 검증 @returns {Promise<void>} [연계] 아래 사례 → assert */
async function test(name,fn){try{await fn();pass++;}catch(e){fail++;console.error('FAIL',name,e.message);}}
/** DOM·자료경로를 관찰 가능한 최소 의존성으로 바꾼 실제 조율기 환경. @param {Object} opts 실패 단계 @returns {Object} 앱·호출·주기·응답 제어 [연계] 아래 실패 사례 → RiskForecast.mount */
function setup(opts={}){
 const calls=[],requests=[],logs=[],banner={hidden:true,textContent:''};let legendClick,sliderChange,detailRelease;const legend={innerHTML:'',hidden:false,addEventListener(name,fn){legendClick=fn;},querySelector(){return {hidden:false};}},sheet={mode:null,shown:0,clear(){this.mode=null;},show(){this.mode='detail';this.shown++;},error(){},choose(){this.mode='choose';},timelineEl:{}};
 let now=opts.now||'2026-10-10T12:00:00+09:00',failure=opts.failure,tick,release;const meta=()=>({now,versions:{spots:'v1',cells:'v1'},timeline:opts.timeline||{coast:{times:[now,now.slice(0,10)+'T21:00:00+09:00']},sea:{times:[now]}}});
 const api={clear(){},async get(name,params){calls.push(name);requests.push({name,params});if(failure===name){failure=null;throw Error('one failure');}if(name==='meta'&&opts.deferred)return new Promise((resolve,reject)=>{release={resolve:()=>resolve(meta()),reject};});if(name==='meta')return meta();if(name==='coast/spots')return {spots:[{id:'a',i:0,lat:35,lon:129},{id:'c',i:1,lat:35,lon:129}]};if(name==='sea/cells')return{cells:[{id:'b',i:0,lat:35,lon:129}]};if(name==='coast/spot'&&opts.deferredDetail)return new Promise(resolve=>{detailRelease=()=>resolve({});});return {spots:[],cells:[],borders:[],sources:opts.sources||{}};}};
 const layer={setActive(){},setTables(){},async boundaries(){calls.push('boundaries');if(failure==='boundaries'){failure=null;throw Error('one failure');}},drawCoast(){calls.push('drawCoast');},drawSea(){},drawBorders(){},setSelection(){},showHazards(){},destroy(){}};
 const context={window:{RiskAPI:{create:()=>api},RiskMapLayer:{create:()=>layer},RiskSheet:{create:()=>sheet,sourceName:ui.window.RiskSheet.sourceName,sourceMessages:ui.window.RiskSheet.sourceMessages},RiskBasis:{open(){},close(){}},RiskSlider:{mount(el,times,t,fn){sliderChange=fn;}}},document:{readyState:'loading',addEventListener(){},removeEventListener(){},querySelector(){return null;}},console:{warn(...args){logs.push(args);}},setInterval(fn){tick=fn;return 1;},clearInterval(){},URLSearchParams,Promise,Date};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'risk_forecast.js'),'utf8'),context);
 const app=context.window.RiskForecast.mount({map:{},sheetEl:{},legendEl:legend,bannerEl:banner});
 return {app,calls,requests,logs,banner,sheet,tick:()=>tick(),date(v){now=v;},release:()=>release,releaseDetail:()=>detailRelease(),toggle(kind){legendClick({target:{closest:()=>({dataset:{layer:kind},classList:{toggle(){}},setAttribute(){}})}});},slide(t){sliderChange(t);}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 for(const failure of ['meta','coast/spots','boundaries'])await test(failure+' 1회 실패 후 재진입 복구',async()=>{const s=setup({failure});await s.app.ready;assert.equal(s.banner.hidden,false);s.app.setEnabled(false);s.app.setEnabled(true);await settle();assert.equal(s.banner.hidden,true);assert.ok(s.calls.includes('drawCoast'));assert.equal(s.calls.filter(x=>x===failure).length,2);s.app.destroy();});
 await test('OFF 뒤 늦은 초기 오류 배너 숨김',async()=>{const s=setup({deferred:true});s.app.setEnabled(false);s.release().reject(Object.assign(Error('https://private.example/?serviceKey=secret'),{status:503}));await s.app.ready;assert.equal(s.banner.hidden,true);assert.ok(!s.calls.includes('drawCoast'));assert.equal(s.logs.length,1);assert.equal(s.logs[0][1].status,503);assert.ok(!JSON.stringify(s.logs).includes('secret'));assert.ok(!JSON.stringify(s.logs).includes('https://'));s.app.destroy();});
 await test('주기 meta 재조회로 KST 날짜 이동',async()=>{const s=setup();await s.app.ready;s.date('2026-10-11T00:00:00+09:00');s.tick();await settle();assert.equal(s.app.getState().t,'2026-10-11T00:00:00+09:00');assert.equal(s.calls.filter(x=>x==='meta').length,2);s.app.destroy();});
 await test('해상20시 선택은 연안·해상 모두20시로 요청',async()=>{const s=setup({now:'2026-10-11T18:00:00+09:00',timeline:{coast:{times:['2026-10-11T18:00:00+09:00','2026-10-11T21:00:00+09:00']},sea:{times:['2026-10-11T18:00:00+09:00','2026-10-11T20:00:00+09:00','2026-10-11T23:00:00+09:00']}}});await s.app.ready;s.toggle('sea');await settle();s.app.select('sea','b');await settle();s.requests.length=0;s.slide('2026-10-11T20:00:00+09:00');await settle();for(const name of ['coast/frame','sea/frame']){const r=s.requests.find(r=>r.name===name);assert.equal(r.params.t,'2026-10-11T20:00:00+09:00');}s.app.destroy();});
 await test('낡음·마지막수집 시각은 프레임 배너에 표시',async()=>{const s=setup({sources:{zoneForecasts:{status:'stale',updatedAt:'2026-10-09T09:00:00+09:00'},congestion:{status:'error',lastSuccess:'2026-10-08T05:14:00+09:00'}}});await s.app.ready;s.toggle('sea');await settle();assert.match(s.banner.textContent,/해구 예보 자료가 오래되었습니다/);assert.match(s.banner.textContent,/예보 기준 '26\. 10\. 9\./);assert.match(s.banner.textContent,/마지막 수집 '26\. 10\. 8\./);s.app.destroy();});
 await test('동일좌표선택목록은 연안OFF·양층OFF 때 닫힘',async()=>{const s=setup();await s.app.ready;s.app.select('coast',['a','c']);assert.equal(s.sheet.mode,'choose');s.toggle('coast');await settle();assert.equal(s.sheet.mode,null);assert.equal(s.app.getState().coast,false);assert.equal(s.app.getState().sea,false);s.app.destroy();});
 await test('예전상세 지연응답은 동일좌표목록을 덮지 않음',async()=>{const s=setup({deferredDetail:true});await s.app.ready;s.app.select('coast','a');await settle();s.app.select('coast',['a','c']);s.releaseDetail();await settle();assert.equal(s.sheet.mode,'choose');assert.equal(s.sheet.shown,0);s.app.destroy();});
 await test('위험예측OFF는 다른지도 클릭을 가로채지 않음',async()=>{const s=setup();await s.app.ready;s.app.setEnabled(false);assert.equal(s.app.tryHandleClick({}),false);s.app.destroy();});
 await test('API TTL·명시적 갱신·동시요청 중복 억제',async()=>{
  let now=0,calls=0;class Clock extends Date{static now(){return now;}}
  const c={window:{},Date:Clock,Map,URLSearchParams,AbortController,setTimeout,clearTimeout,fetch:async()=>{calls++;return {ok:true,json:async()=>({ok:true,revision:calls})};}};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'risk_api.js'),'utf8'),c);const api=c.window.RiskAPI.create({});
  await Promise.all([api.get('meta'),api.get('meta')]);assert.equal(calls,1);await api.get('meta');assert.equal(calls,1);now=60001;await api.get('meta');assert.equal(calls,2);await api.get('meta',{},true);assert.equal(calls,3);api.clear();await api.get('meta');assert.equal(calls,4);
 });
 console.log(`${pass} PASS / ${fail} FAIL`);process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
