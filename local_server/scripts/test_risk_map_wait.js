/**
 * 파일명: local_server/scripts/test_risk_map_wait.js
 * 역할  : 위험예측 지도의 「기다림 표시」(지도 가운데 스피너·이전 색 흐림·실패 안내 2초)가 켜지고 꺼지는 때를 고정한다(2026-10-16 T4).
 *         사용자가 누른 동작만 250ms 넘게 걸리면 보이고, 연타·실패·토글 끄기·60초 자동 갱신·안전 타이머(50초)·상세 요청 전 끄기를 한 행씩 본다.
 * [연계] client/js/marine-life/risk-forecast/risk_forecast.js(waitStart·waitEnd·refresh finally) / verify_all.sh SUITES
 * [로드 순서] 독립 검사 — 브라우저·서버·외부 호출 없음. 시계는 가짜 타이머(실제 시각과 무관)라 언제 돌려도 같은 결과다.
 */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const file=path.join(__dirname,'../../client/js/marine-life/risk-forecast/risk_forecast.js');
let pass=0,fail=0;
/** 사례 하나를 돌린다. 예: await test('연타',fn). @param {string} name - 사례 @param {Function} fn - 검사 @returns {Promise<void>} [연계] ← 아래 사례 */
async function test(name,fn){try{await fn();pass++;console.log('✅',name);}catch(e){fail++;console.error('❌',name,e.message);}}
/** 대기 중인 promise 사슬을 끝까지 흘린다. @returns {Promise<void>} [연계] ← 요청 풀기·클릭 뒤 */
async function settle(){for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));}
/** 화면 요소 흉내. 선택자마다 같은 자식을 돌려준다(스피너·안내 문구를 다시 찾아도 같은 객체). @returns {Object} 요소 [연계] ← setup */
function el(){const kids=new Map(),listeners=[];return{hidden:false,dataset:{},style:{},className:'',textContent:'',innerHTML:'',offsetWidth:0,children:[],listeners,
 classList:{add(){},remove(){},toggle(){},contains(){return false;}},setAttribute(){},getAttribute(){return null;},insertAdjacentHTML(){},remove(){this.removed=true;},
 appendChild(c){this.children.push(c);c.parentElement=this;return c;},addEventListener(type,fn){listeners.push(fn);},
 querySelector(sel){if(!kids.has(sel))kids.set(sel,el());return kids.get(sel);},querySelectorAll(){return [];}};}
/** 실제 조율기를 가짜 시계·요청·지도 층으로 띄운다.
 * 예: const s=setup(); await s.app.ready; s.defer('coast/frame'); s.timeStep('3'); s.advance(300) → 스피너 보임
 * @param {Object} [opts] - enabled(처음 켜짐 여부) @returns {Object} 앱·조작·관찰 함수 [연계] → RiskForecast.mount */
function setup(opts={}){
 let clock=0,tick=null;const timers=[];let timerId=0;
 const now='2026-10-11T12:00:00+09:00',times=['2026-10-11T12:00:00+09:00','2026-10-11T15:00:00+09:00','2026-10-11T18:00:00+09:00','2026-10-11T21:00:00+09:00'];
 const meta=()=>({now,versions:{spots:'v1',cells:'v1',accident:'v1'},sources:{},timeline:{coast:{times},sea:{times},accident:{times}}});
 const deferred=new Set(),pending=[],calls=[],dims=[];
 const defaults={meta,'coast/spots':()=>({spots:[{id:'a',i:0,lat:35,lon:129,name:'광안리'}]}),'coast/frame':()=>({spots:[],sources:{}}),'coast/spot':()=>({title:'광안리'}),
  'sea/unified-cells':()=>({v:'x',cells:[]}),'sea/unified-frame':p=>({v:'x',cells:[],mode:p.mode==='risk'?'accident':p.mode})};
 const api={clear(){},get(name,params){calls.push(name);if(deferred.has(name))return new Promise((resolve,reject)=>pending.push({name,params,resolve,reject}));return Promise.resolve(defaults[name]?defaults[name](params||{}):{});}};
 const layer={setActive(){},setTables(){},async boundaries(){},drawCoast(){},drawUnified(){},drawSea(){},drawAccident(){},setSelection(){},showHazards(){},hit(){return false;},destroy(){},dim(on){dims.push(on);}};
 const sheet={clear(){},loading(){},show(){},error(){},choose(){},timelineEl:el()};
 const parent=el(),target=el();target.parentElement=parent;
 const doc={readyState:'loading',body:el(),createElement:()=>el(),addEventListener(){},removeEventListener(){},querySelector:()=>null};
 const legend=el();
 const context={window:{RiskMarine:{},RiskAPI:{create:()=>api},RiskMapLayer:{create:()=>layer},RiskSheet:{create:()=>sheet,sourceMessages:()=>[],sourceName:x=>x},RiskBasis:{open(){},close(){}},RiskSlider:{mount(){return null;}}},
  document:doc,console:{warn(){}},URLSearchParams,Promise,Date,
  setInterval(fn){tick=fn;return 1;},clearInterval(){},
  setTimeout(fn,ms){const id=++timerId;timers.push({id,at:clock+ms,fn});return id;},clearTimeout(id){const i=timers.findIndex(t=>t.id===id);if(i>=0)timers.splice(i,1);}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(file,'utf8'),context);
 const app=context.window.RiskForecast.mount({map:{getTargetElement:()=>target,getView:()=>({fit(){}})},sheetEl:el(),legendEl:legend,bannerEl:el(),enabled:opts.enabled});
 const wait=parent.children.find(c=>c.className==='rf-map-wait'),bar=parent.children.find(c=>c.className==='rf-marine-timebar');
 const click=(listeners,closest)=>listeners.forEach(fn=>fn({target:{closest:sel=>closest[sel]||null}}));
 return{app,calls,dims,pending,
  defer(name){deferred.add(name);},
  /** 가짜 시계를 ms 만큼 앞으로 — 그 사이 기한이 된 타이머를 순서대로 부른다. */
  advance(ms){const end=clock+ms;for(;;){timers.sort((a,b)=>a.at-b.at);const t=timers[0];if(!t||t.at>end)break;timers.shift();clock=t.at;t.fn();}clock=end;},
  /** 가장 최근(또는 n번째) 대기 요청을 풀거나 실패시킨다. */
  release(name,which=-1){const list=pending.filter(p=>p.name===name),p=list.at(which);assert.ok(p,name+' 대기 요청 없음');pending.splice(pending.indexOf(p),1);p.resolve(defaults[name](p.params||{}));},
  reject(name){const list=pending.filter(p=>p.name===name),p=list.at(-1);assert.ok(p,name+' 대기 요청 없음');pending.splice(pending.indexOf(p),1);p.reject(Object.assign(Error('HTTP 503 https://private.example/?serviceKey=secret'),{status:503}));},
  timeStep(step){click(bar.listeners,{'[data-time-step]':{dataset:{timeStep:step},disabled:false}});},
  mode(m){click(legend.listeners,{'[data-marine-mode]':{dataset:{marineMode:m}}});},
  toggle(kind){click(legend.listeners,{'[data-layer]':{dataset:{layer:kind},classList:{toggle(){}},setAttribute(){}}});},
  tick(){tick();},
  spinner(){return !wait.hidden&&!wait.querySelector('[data-wait-spin]').hidden;},
  notice(){return !wait.hidden&&!wait.querySelector('[data-wait-msg]').hidden;},
  noticeText(){return wait.innerHTML;},
  dimmed(){return dims.length?dims.at(-1):false;},
  waitEl:wait};
}
(async()=>{
 await test('요소: 지도 칸 안에 기다림 표시 하나(스피너 재사용 .spinner·안내 문구는 원인 없이 「잠시 후 다시 시도해 주세요」)',async()=>{
  const s=setup();await s.app.ready;await settle();
  assert.ok(s.waitEl,'rf-map-wait 요소');assert.equal(s.waitEl.hidden,true,'처음엔 숨김');
  assert.match(s.noticeText(),/class="spinner"/);assert.match(s.noticeText(),/>잠시 후 다시 시도해 주세요</);
  s.app.destroy();assert.equal(s.waitEl.removed,true,'destroy 하면 요소도 지운다');
 });
 await test('250ms 안에 그려지면 스피너·흐림이 전혀 보이지 않음',async()=>{
  const s=setup();await s.app.ready;await settle();s.defer('coast/frame');
  s.timeStep('3');s.advance(200);assert.equal(s.spinner(),false);s.release('coast/frame');await settle();
  s.advance(5000);assert.equal(s.spinner(),false);assert.equal(s.notice(),false);assert.equal(s.dims.includes(true),false,'흐림도 없음');s.app.destroy();
 });
 await test('연타: 앞선 응답이 먼저 와도 꺼지지 않고 마지막 동작의 지도가 그려질 때 꺼짐',async()=>{
  const s=setup();await s.app.ready;await settle();s.defer('coast/frame');
  s.timeStep('3');s.advance(100);s.timeStep('3');s.advance(100);s.timeStep('now');s.advance(100);
  assert.equal(s.spinner(),true,'첫 동작부터 250ms 넘으면 보임');assert.equal(s.dimmed(),true,'이전 색 흐림');
  s.release('coast/frame',0);await settle();s.release('coast/frame',0);await settle();
  assert.equal(s.spinner(),true,'이전 동작의 응답으로는 끄지 않는다');
  s.release('coast/frame',0);await settle();
  assert.equal(s.spinner(),false);assert.equal(s.dimmed(),false,'흐림 해제');assert.equal(s.notice(),false,'성공이면 안내 없음');s.app.destroy();
 });
 await test('실패: 스피너를 끄고 원인 없이 「잠시 후 다시 시도해 주세요」를 2초 보인 뒤 사라짐',async()=>{
  const s=setup();await s.app.ready;await settle();s.defer('coast/frame');
  s.timeStep('3');s.advance(300);assert.equal(s.spinner(),true);
  s.reject('coast/frame');await settle();
  assert.equal(s.spinner(),false);assert.equal(s.notice(),true);assert.equal(s.dimmed(),false);assert.doesNotMatch(s.noticeText(),/503|private|secret|serviceKey/,'원인·주소를 보이지 않는다');
  s.advance(1999);assert.equal(s.notice(),true,'2초 동안 보임');s.advance(2);assert.equal(s.notice(),false,'2초 뒤 사라짐');
  // 250ms 전에 실패해도(스피너가 뜨기 전) 사용자가 누른 동작이므로 안내는 보인다.
  s.timeStep('3');s.advance(50);s.reject('coast/frame');await settle();assert.equal(s.notice(),true);assert.equal(s.dims.filter(Boolean).length,1,'흐림은 처음 실패 때 한 번뿐');s.app.destroy();
 });
 await test('토글 끄기(위험예측 끄기): 기다리던 중이면 그 자리에서 끄고 늦은 응답·안전 타이머가 다시 띄우지 않음',async()=>{
  const s=setup();await s.app.ready;await settle();s.defer('coast/frame');
  s.timeStep('3');s.advance(300);assert.equal(s.spinner(),true);
  s.app.setEnabled(false);assert.equal(s.spinner(),false);assert.equal(s.notice(),false);assert.equal(s.dimmed(),false);
  s.release('coast/frame');await settle();s.advance(60000);assert.equal(s.spinner(),false);assert.equal(s.notice(),false,'안전 타이머도 지워졌다');s.app.destroy();
 });
 await test('60초 자동 갱신: 응답이 늦어도 스피너·흐림을 띄우지 않음',async()=>{
  const s=setup();await s.app.ready;await settle();s.defer('coast/frame');
  s.tick();await settle();assert.ok(s.pending.some(p=>p.name==='coast/frame'),'자동 갱신 요청이 대기 중');
  s.advance(3000);assert.equal(s.spinner(),false);assert.equal(s.dims.includes(true),false);
  s.reject('coast/frame');await settle();assert.equal(s.notice(),false,'자동 갱신 실패는 안내하지 않는다');s.app.destroy();
 });
 await test('안전 타이머: 응답이 끝내 안 오면 50초(요청 최악 약46.2초보다 조금 길게)에 끄고 안내',async()=>{
  const s=setup();await s.app.ready;await settle();s.defer('coast/frame');
  s.timeStep('3');s.advance(49999);assert.equal(s.spinner(),true,'50초 전에는 정상적인 느린 응답으로 본다');
  s.advance(1);assert.equal(s.spinner(),false);assert.equal(s.notice(),true);assert.equal(s.dimmed(),false);
  s.advance(2000);assert.equal(s.notice(),false);
  s.release('coast/frame');await settle();assert.equal(s.spinner(),false,'늦게 온 응답은 그리기만 하고 표시를 다시 켜지 않는다');s.app.destroy();
 });
 await test('상세(시트) 요청을 기다리기 전에 끔: 지도가 그려지면 상세 응답과 상관없이 스피너 해제',async()=>{
  const s=setup();await s.app.ready;await settle();s.defer('coast/spot');s.app.select('coast','a');await settle();s.defer('coast/frame');
  s.timeStep('3');s.advance(300);assert.equal(s.spinner(),true);
  s.release('coast/frame');await settle();
  assert.ok(s.pending.filter(p=>p.name==='coast/spot').length>=1,'상세 요청은 아직 대기 중');assert.equal(s.spinner(),false);assert.equal(s.dimmed(),false);s.app.destroy();
 });
 await test('토글 ON·[혼잡도/위험 예측] 선택도 사용자 동작 — 해상 지도 대기 중 표시, 끄는 토글(OFF)은 띄우지 않음',async()=>{
  const s=setup();await s.app.ready;await settle();s.defer('sea/unified-frame');
  s.toggle('sea');s.advance(300);assert.equal(s.spinner(),true,'해상 ON');s.release('sea/unified-frame');await settle();assert.equal(s.spinner(),false);
  s.mode('congestion');s.advance(300);assert.equal(s.spinner(),true,'혼잡도 선택');s.release('sea/unified-frame');await settle();assert.equal(s.spinner(),false);
  s.toggle('sea');s.advance(300);assert.equal(s.spinner(),false,'해상 OFF 는 기다림 표시 없음');s.app.destroy();
 });
 await test('처음 켤 때 메타(자료 목록) 요청 실패: refresh 전에 실패해도 스피너를 끄고 안내',async()=>{
  const s=setup({enabled:false});s.defer('meta');s.app.setEnabled(true);s.advance(300);assert.equal(s.spinner(),true);
  s.reject('meta');await settle();assert.equal(s.spinner(),false);assert.equal(s.notice(),true);s.app.destroy();
 });
 console.log(`${pass} PASS / ${fail} FAIL`);if(fail)process.exitCode=1;
})().catch(e=>{console.error('❌ 실행 실패:',e.message);console.log(`${pass} PASS / ${fail+1} FAIL`);process.exitCode=1;});
