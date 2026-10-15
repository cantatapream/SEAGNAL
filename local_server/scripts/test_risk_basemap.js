/**
 * 파일명: local_server/scripts/test_risk_basemap.js
 * 역할  : 위험예측을 켜면 배경이 위성지도로 바뀌고, 끄거나 없애면 켜기 전 배경으로 돌아오는지(과제12)와
 *         위성지도를 못 쓸 때 그 사실이 배너에 남는지, 위험예측 층이 배경지도에 기대지 않는지 검사한다.
 * [연계] 실제 risk_forecast.js(조율기) · ocean_map.js(소스 검사) · risk_map_layer.js(소스 검사) / verify_all.sh
 * [로드 순서] 독립 검사; 브라우저·네트워크·운영 키 없음 — 배경지도 함수는 가짜로 바꿔 호출 기록만 본다.
 */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=path.join(__dirname,'../../client/js/marine-life/risk-forecast'),oceanMap=path.join(__dirname,'../../client/js/ocean-map/map/ocean_map.js');
let pass=0,fail=0;
const ui={window:{},URL};vm.createContext(ui);for(const file of ['risk_format.js','risk_sheet.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ui);
/** 사례 하나를 실행한다. 예: await test('OFF 복원',fn). @param {string} name 사례 @param {Function} fn 검증 @returns {Promise<void>} [연계] 아래 사례 → assert */
async function test(name,fn){try{await fn();pass++;console.log('✅',name);}catch(e){fail++;console.error('❌',name,e.message);}}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
/** 배경지도 함수만 가짜인 실제 조율기. 예: setup({base:'coast'}) → 처음 배경 coast.
 * @param {Object} opts base(처음 배경)·ready(oceanVworldReady 결과: true|false|'none'=함수 없음)·enabled(mount 시 켜짐)·noBase(배경 함수 자체가 없는 환경)
 * @returns {Object} 앱·배경 호출 기록·배너 [연계] 아래 사례 → RiskForecast.mount */
function setup(opts={}){
 const log=[],banner={hidden:true,textContent:''};let base=opts.base||'coast';const ready=opts.ready===undefined?true:opts.ready;
 const meta={now:'2026-10-10T12:00:00+09:00',versions:{spots:'v1',cells:'v1',accident:'v1'},sources:{},timeline:{coast:{times:['2026-10-10T12:00:00+09:00']},sea:{times:['2026-10-10T12:00:00+09:00']}}};
 const api={clear(){},async get(name){if(name==='meta')return meta;if(name==='coast/spots')return {spots:[]};if(name==='sea/cells')return {cells:[]};return {spots:[],cells:[],borders:[],sources:{}};}};
 const layer={setActive(){},setTables(){},async boundaries(){},drawCoast(){},drawSea(){},drawAccident(){},drawBorders(){},setSelection(){},showHazards(){},destroy(){}};
 const sheet={clear(){},show(){},error(){},choose(){},timelineEl:{}};
 const legend={innerHTML:'',hidden:false,addEventListener(){},querySelector(){return {hidden:false};}};
 const win={RiskAPI:{create:()=>api},RiskMapLayer:{create:()=>layer},RiskSheet:{create:()=>sheet,sourceName:ui.window.RiskSheet.sourceName,sourceMessages:ui.window.RiskSheet.sourceMessages},RiskBasis:{open(){},close(){}},RiskSlider:{mount(){}}};
 if(!opts.noBase){win.oceanGetBasemap=()=>base;win.oceanSetBasemap=type=>{log.push(type);base=type;};}
 if(ready!=='none')win.oceanVworldReady=()=>Promise.resolve(ready);
 const context={window:win,document:{readyState:'loading',addEventListener(){},removeEventListener(){}},console:{warn(){}},setInterval(){return 1;},clearInterval(){},URLSearchParams,Promise,Date};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'risk_forecast.js'),'utf8'),context);
 const app=context.window.RiskForecast.mount({map:{},sheetEl:{},legendEl:legend,bannerEl:banner,enabled:opts.enabled===true});
 return {app,log,banner,base:()=>base,setBase(v){base=v;}};
}
(async()=>{
 await test('마운트만 하면(꺼진 채) 배경을 건드리지 않는다',async()=>{const s=setup();await s.app.ready;assert.deepEqual(s.log,[]);assert.equal(s.base(),'coast');s.app.destroy();});
 await test('켜면 배경이 위성지도(vworld)로 바뀐다',async()=>{const s=setup({base:'coast'});s.app.setEnabled(true);await settle();assert.equal(s.base(),'vworld');assert.deepEqual(s.log,['vworld']);s.app.destroy();});
 await test('처음부터 켜진 채 마운트해도 위성지도',async()=>{const s=setup({enabled:true});await s.app.ready;await settle();assert.equal(s.base(),'vworld');s.app.destroy();});
 await test('끄면 켜기 전 배경(해안도·기본맵·전자해도·세계지도)으로 돌아간다',async()=>{for(const before of ['coast','rltm','enc','osm']){const s=setup({base:before});s.app.setEnabled(true);await settle();assert.equal(s.base(),'vworld');s.app.setEnabled(false);assert.equal(s.base(),before,before+' 복원');s.app.destroy();}});
 await test('켠 상태에서 다시 켜도 원래 배경을 잃지 않는다(위성이 원래 배경으로 굳지 않음)',async()=>{const s=setup({base:'rltm'});s.app.setEnabled(true);s.app.setEnabled(true);await settle();s.app.setEnabled(false);assert.equal(s.base(),'rltm');s.app.destroy();});
 await test('켜고 끄기를 반복해도 매번 원래 배경',async()=>{const s=setup({base:'enc'});for(let i=0;i<3;i++){s.app.setEnabled(true);await settle();assert.equal(s.base(),'vworld');s.app.setEnabled(false);assert.equal(s.base(),'enc');}s.app.destroy();});
 await test('원래 배경이 이미 위성지도면 켜고 꺼도 위성지도',async()=>{const s=setup({base:'vworld'});s.app.setEnabled(true);await settle();s.app.setEnabled(false);assert.equal(s.base(),'vworld');s.app.destroy();});
 await test('꺼진 상태에서 끄기를 불러도 배경을 건드리지 않는다(다른 탭 지도 보호)',async()=>{const s=setup({base:'osm'});s.app.setEnabled(false);s.app.setEnabled(false);assert.deepEqual(s.log,[]);assert.equal(s.base(),'osm');s.app.destroy();});
 await test('켠 채 없애도(destroy) 원래 배경으로 돌아간다',async()=>{const s=setup({base:'coast'});s.app.setEnabled(true);await settle();s.app.destroy();assert.equal(s.base(),'coast');});
 await test('켠 동안 사용자가 다른 배경을 골랐어도 끄면 켜기 전 배경으로 정리된다',async()=>{const s=setup({base:'coast'});s.app.setEnabled(true);await settle();s.setBase('enc');s.app.setEnabled(false);assert.equal(s.base(),'coast');s.app.destroy();});
 await test('위성 인증키를 못 받으면 빈 배경 대신 원래 배경을 유지하고 배너로 알린다',async()=>{const s=setup({base:'coast',ready:false});s.app.setEnabled(true);await settle();assert.equal(s.base(),'coast');assert.equal(s.banner.hidden,false);assert.match(s.banner.textContent,/위성지도를 불러오지 못해/);s.app.destroy();});
 await test('위성 실패 안내는 자료 갱신(배너 재작성) 뒤에도 남고, 끄면 사라진다',async()=>{const s=setup({base:'coast',ready:false});s.app.setEnabled(true);await s.app.ready;await settle();await s.app.refresh();assert.match(s.banner.textContent,/위성지도를 불러오지 못해/);s.app.setEnabled(false);assert.equal(s.banner.hidden,true);assert.equal(s.banner.textContent,'');assert.equal(s.base(),'coast');s.app.destroy();});
 await test('키 확인이 끝나기 전에 꺼도 늦은 실패가 배경·배너를 되살리지 않는다',async()=>{const s=setup({base:'coast',ready:false});s.app.setEnabled(true);s.app.setEnabled(false);await settle();assert.equal(s.base(),'coast');assert.equal(s.banner.hidden,true);s.app.destroy();});
 await test('원래 배경이 위성지도였는데 키 실패면 해안도로 바꾸고 알린다(빈 위성 배경 금지)',async()=>{const s=setup({base:'vworld',ready:false});s.app.setEnabled(true);await settle();assert.equal(s.base(),'coast');assert.match(s.banner.textContent,/위성지도를 불러오지 못해/);s.app.destroy();});
 await test('키 확인 함수가 없는 환경(미리보기)도 위성으로 전환하고 오류 없음',async()=>{const s=setup({ready:'none'});s.app.setEnabled(true);await settle();assert.equal(s.base(),'vworld');assert.equal(s.banner.hidden,true);s.app.destroy();});
 await test('지도 배경 함수 자체가 없는 환경(미리보기)에서도 켜고 끄기 오류 없음',async()=>{const s=setup({noBase:true});s.app.setEnabled(true);await settle();s.app.setEnabled(false);s.app.destroy();assert.deepEqual(s.log,[]);});
 await test('ocean_map.js: vworld 배경 전환·위성 줌 한계·키 확인 API가 있다',async()=>{const src=fs.readFileSync(oceanMap,'utf8');assert.match(src,/window\.oceanSetBasemap\s*=/);assert.match(src,/vworld:\s*'위성지도'/);assert.match(src,/type === 'vworld'\) \? VWORLD_MAX_ZOOM : MAX_ZOOM/);assert.match(src,/window\.oceanVworldReady\s*=/);});
 await test('위험예측 층은 자기 canvas 위에 그리며 배경지도 레이어에 의존하지 않는다',async()=>{const src=fs.readFileSync(path.join(root,'risk_map_layer.js'),'utf8');assert.match(src,/className:'rf-'\+k\+'-canvas'/);assert.match(src,/zIndex:130\+i/);assert.doesNotMatch(src,/oceanSetBasemap|oceanGetBasemap|baseLayer/);});
 await test('위험예측 조율기는 배경을 해안도로 고정하던 옛 동작을 쓰지 않는다',async()=>{const src=fs.readFileSync(path.join(root,'risk_forecast.js'),'utf8');assert.doesNotMatch(src,/oceanSetBasemap\('coast'\);\}legend/);assert.match(src,/oceanSetBasemap\('vworld'\)/);});
 console.log(`${pass} PASS / ${fail} FAIL`);process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
