/**
 * 파일명: local_server/scripts/test_marine_fusion.js
 * 역할  : 해상 통합의 누락·중복·시각·사고유형·관할 집계와 최신 수집의 정상본 보존을 검증한다.
 * [연계] marine_fusion/sea_realtime_collector(공식 API 전용 — 2026-10-15 웹 수집·선종·톤수 제거) → verify_all; 네트워크·키·과거 다운로드 없음.
 * [로드 순서] 독립 Node 실행, 임시 자료만 사용.
 */
'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),express=require('express');
const io=require('../services/risk_collector_io'),C=require('../services/sea_realtime_collector'),M=require('../services/marine_fusion'),{createRouter}=require('../routes/risk_forecast');
let pass=0,fail=0;const dir=fs.mkdtempSync(path.join(os.tmpdir(),'marine-fusion-'));let now=Date.parse('2026-10-12T13:05:00+09:00');
/** 개별 경계조건의 실제 결과를 검사한다. 예: 0과 null의 계약을 구분.
 * @param {string} name - 검사명 @param {function} fn - 검사 @returns {Promise<void>}
 * [연계] ← 아래 검사 / 실패가 있어도 나머지 진단 수행.
 */
async function check(name,fn){try{await fn();pass++;console.log('✅',name);}catch(e){fail++;console.error('❌',name,e.message);}}
/** 공단 realtime v2 모양의 가짜 응답을 만든다. 예: api([['GR4_F4K23_P4',21,.2]])
 * @param {array} rows - [grid_id,vmtc,dnsty] @param {string} regDt - 등록시각 @returns {function} fetchImpl
 * [연계] ← 수집 검사 / 임의 원천 값은 production으로 저장하지 않는다.
 */
function api(rows,regDt='2026-10-12 13:05:00'){return async()=>({ok:true,json:async()=>({response:{header:{resultCode:'200',resultMsg:'NORMAL_SERVICE'},body:{regDt,totalCount:rows.length,items:{item:rows.map(([g,v,d])=>({grid_id:g,vmtc:v,dnsty:d}))}}}})});}
const gr4Geometry={type:'Polygon',coordinates:[[[126.525,33.575],[126.55,33.575],[126.55,33.55],[126.525,33.55],[126.525,33.575]]]};
const describe=r=>({id:String(r.gridId),lat:r.latitude,lon:r.longitude,haegu:{major:163,sub:6,label:'163-6'},ref:{name:'제주항',bearingWord:'북서',distNm:8.2}});
const accGeometry={type:'Polygon',coordinates:[[[126.5,33.5],[126.6,33.5],[126.6,33.6],[126.5,33.6],[126.5,33.5]]]};
const stations=[{properties:{name:'제주파출소'},geometry:accGeometry},{properties:{name:'중복파출소'},geometry:accGeometry}];
const row=(type,cause=null,death=0,missing=0,ymd='20250101')=>[33.5625,126.5375,ymd,'1300','해역',type,cause,null,null,0,death,missing,[],null,null,null];
const accidents=[row('ATY027',null,2,1),row('ATY028','ACC008'),row('ATY034','ACC008',3,0),row('ATY040',null,1,0),row('ATY010'),row('ATY019',null,null,null),row('ATY027',null,10,0,'20100101')];
const trafficCell={...describe({gridId:'GR4_F4K23_P4',latitude:33.5625,longitude:126.5375}),i:0,geometry:gr4Geometry};
const inputs={version:1,cells:{cells:[trafficCell]},congestion:{frames:{'202610121300':[{gridId:trafficCell.id,fcstDate:'20261012',fcstTime:'1300',fcstCreateDateTime:'2026-10-12 04:00:00',congestionIndex:2,congestionLevel:'낮음'}],'202610121500':[{gridId:trafficCell.id,fcstDate:'20261012',fcstTime:'1500',congestionIndex:22,congestionLevel:'매우높음'}]}},accident:{cells:[{...trafficCell,id:'100',geometry:accGeometry}],createdAt:'2026-10-12T00:00:00+09:00',frames:{'202610121200':[[0,.001,'경계']],'202610121500':[[0,.002,'주의']]}},sources:{accident:{status:'ok'},congestion:{status:'ok'},zoneForecasts:{status:'ok'}},weather:()=>({wh:2,ws:12,wp:4,wd:241,forecastAt:'2026-10-12T12:00:00+09:00'})};
const risk={marineInputs:()=>inputs,sources:()=>inputs.sources};
(async()=>{let server;try{
    await check('API 밀집도 0은 선박 0으로 변환하지 않음',async()=>{const r=await C.readApi({dir,key:'test',fetchImpl:api([['GR4_F4K23_P4',21,0]]),now});assert.equal(r.rows[0].count,21);assert.equal(r.rows[0].density,0);});
    // 2026-10-15 사용자 확정: 한 줄이 이상해도 전체를 버리지 않고 그 줄만 뺀다(종전엔 전체 거부 → 하루 넘게 갱신 정지).
    await check('API 밀집도 누락은 null·척수 유지',async()=>{const r=await C.readApi({dir,key:'test',fetchImpl:api([['GR4_F4K23_P4',21,null]]),now});assert.equal(r.rows[0].density,null);assert.equal(r.rows[0].count,21);});
    await check('API 중복 격자는 하나만·음수 척수 줄은 뺌·잘못된 레벨 거부',async()=>{const r=await C.readApi({dir,key:'test',fetchImpl:api([['GR4_F4K23_P4',21,1],['GR4_F4K23_P4',3,1],['GR4_F4K23_P3',-1,1]]),now});assert.equal(r.rows.length,1);assert.equal(r.dropped['격자 중복'],1);assert.equal(r.dropped['척수 값'],1);assert.throws(()=>C.gridId('GR3_F4K23_P'));});
    const collector=C.createCollector({dir,key:'test',clock:()=>now,fetchImpl:api([['GR4_F4K23_P4',21,.2]]),describe});
    await check('공식 API 최신 조회를 작은 배열·번호에서 계산한 경계 한 벌로 게시',async()=>{assert.equal((await collector.collect()).ok,true);const d=io.read(path.join(dir,'sea_realtime.json.gz'));assert.deepEqual(d.rows,[[0,21,.2]]);assert.equal(d.sourceAt,'2026-10-12T13:05:00+09:00');assert.equal(d.cells.length,1);assert.deepEqual(d.cells[0].geometry,gr4Geometry);});
    await check('5분 동일 구간에는 외부 수집 반복 없음',async()=>{assert.equal((await collector.collect()).unchanged,true);});
    const m=M.createStore({risk,dir,clock:()=>now,stations,accidents,describe});
    await check('기존 지명·해구 이름 재사용',()=>{assert.equal(M.location(trafficCell),'제주항 북서방 8.2해리 해역(163-6해구)');});
    await check('GR4 척수 단계 경계7·14·21',()=>{assert.deepEqual([0,6,7,13,14,20,21].map(M.trafficLevel),['여유','여유','보통','보통','주의','주의','혼잡']);});
    // 2026-10-15 합의 변경: 「충돌, 접촉 주의로 안내가 나가야하고 사유도 명시해야해.」 — 14척 한 단계 올림(종합 관심단계) 폐지.
    await check('미래 risk 지도는 공식 단계',()=>{assert.equal(M.combinedLevel,undefined,'14척 한 단계 올림 규칙은 없앴다');const future=m.unifiedFrame('risk','2026-10-12T15:00:00+09:00');assert.equal(future.mode,'accident');assert.equal(future.cells[0][2],'주의');});
    const scenario=({official='보통',count=18,cong13=['낮음',.5],cong16=['낮음',.5],cong1316=['낮음',.5]})=>{const scoped=fs.mkdtempSync(path.join(os.tmpdir(),'fusion-notice-'));io.write(path.join(scoped,'sea_realtime.json.gz'),{cells:[trafficCell],rows:[[0,count,.1]],sourceAt:'2026-10-12T13:05:00+09:00',collectedAt:'2026-10-12T13:05:00+09:00',v:'n'});const row=(d,h,[level,index])=>({gridId:trafficCell.id,fcstDate:d,fcstTime:h,congestionIndex:index,congestionLevel:level});const inp={...inputs,congestion:{frames:{'202610121300':[row('20261012','1300',cong13)],'202610121600':[row('20261012','1600',cong16)],'202610131600':[row('20261013','1600',cong1316)]}},accident:{...inputs.accident,frames:{'202610121200':[[0,.001,official]],'202610121500':[[0,.002,official]],'202610131500':[[0,.002,official]]}}};const s=M.createStore({risk:{marineInputs:()=>inp},dir:scoped,clock:()=>Date.parse('2026-10-12T13:05:00+09:00'),stations,accidents,describe});s.cleanup=()=>fs.rmSync(scoped,{recursive:true,force:true});return s;};
    const at13='2026-10-12T13:05:00+09:00',kinds=n=>n.reasons.map(r=>r.kind);
    await check('14척·28척이어도 사고 단계·지도 색은 공식 그대로(종합 관심단계 없음)',()=>{for(const count of [14,28]){const s=scenario({official:'보통',count});try{const a=s.analysis({id:trafficCell.id,t:at13}).marine;assert.equal(a.accident.level,'보통');assert.equal('combinedLevel' in a,false);assert.ok(!a.reasons.some(r=>r.key==='combined'||r.text.includes('종합 관심단계')));const risk=s.unifiedFrame('risk',at13),acc=s.unifiedFrame('accident',at13);assert.equal(risk.mode,'accident');assert.deepEqual(risk.cells,acc.cells);assert.ok(risk.cells.length>0&&risk.cells.every(r=>r[2]==='보통'));assert.equal('officialOnlyCells' in risk,false);}finally{s.cleanup();}}});
    await check('충돌·접촉 주의 조건A만: 그 시각 혼잡 높음(지수 12.3)',()=>{const s=scenario({count:5,cong13:['높음',12.3]});try{const n=s.analysis({id:trafficCell.id,t:at13}).marine.collisionNotice;assert.equal(n.on,true);assert.deepEqual(kinds(n),['congestion']);assert.deepEqual(n.reasons[0],{kind:'congestion',level:'높음',value:12.3,at:'2026-10-12T13:00:00+09:00'});for(const w of ['충돌·접촉 주의','13시',"'높음'",'혼잡지수 12.3','사고 확률'])assert.ok(n.text.includes(w),w);assert.ok(!n.text.includes('척'));}finally{s.cleanup();}});
    await check('충돌·접촉 주의 조건B만: 현재 14척 이상(13척은 아님)',()=>{for(const [count,on]of [[13,false],[14,true],[18,true]]){const s=scenario({count,cong13:['보통',9.99]});try{const a=s.analysis({id:trafficCell.id,t:at13}).marine,n=a.collisionNotice;assert.equal(n.on,on,String(count));if(on){assert.deepEqual(kinds(n),['traffic']);assert.deepEqual(n.reasons[0],{kind:'traffic',level:M.trafficLevel(count),value:count,at:'2026-10-12T13:05:00+09:00'});assert.ok(n.text.includes(count+'척'));assert.ok(n.text.includes('13:05'));assert.equal(a.attention,'관심 필요');assert.equal(a.accident.level,'보통');}else{assert.deepEqual(n.reasons,[]);assert.equal(n.text,null);}}finally{s.cleanup();}}});
    await check('충돌·접촉 주의 둘 다: 안내 1개·사유 2개(숫자·시각)',()=>{const s=scenario({count:18,cong13:['매우높음',22.4]});try{const a=s.analysis({id:trafficCell.id,t:at13}).marine,n=a.collisionNotice;assert.equal(n.on,true);assert.deepEqual(kinds(n),['congestion','traffic']);assert.equal(a.reasons.filter(r=>r.key==='collision').length,1);assert.equal(a.reasons[0].key,'collision');assert.equal(a.reasons[0].text,n.text);for(const w of ['13시',"'매우높음'",'22.4','18척','13:05'])assert.ok(n.text.includes(w),w);assert.equal(n.text.split('충돌·접촉 주의').length,2);}finally{s.cleanup();}});
    await check('충돌·접촉 주의 둘 다 아님: 혼잡 보통·13척',()=>{const s=scenario({count:13,cong13:['보통',9.99]});try{const a=s.analysis({id:trafficCell.id,t:at13}).marine;assert.deepEqual(a.collisionNotice,{on:false,reasons:[],text:null});assert.ok(!a.reasons.some(r=>r.key==='collision'));}finally{s.cleanup();}});
    await check('미래 시각은 조건A(그 시각 혼잡)로만 판정·현재 척수는 미래 사유로 쓰지 않음',()=>{const s=scenario({count:30,cong16:['높음',12.3],cong1316:['보통',3]});try{const n=s.analysis({id:trafficCell.id,t:'2026-10-12T16:00:00+09:00'}).marine.collisionNotice;assert.equal(n.on,true);assert.deepEqual(kinds(n),['congestion']);assert.equal(n.reasons[0].at,'2026-10-12T16:00:00+09:00');assert.ok(n.text.includes('16시'));assert.ok(!n.text.includes('30척'));assert.equal(s.analysis({id:trafficCell.id,t:'2026-10-13T16:00:00+09:00'}).marine.collisionNotice.on,false);}finally{s.cleanup();}const t=scenario({count:2,cong1316:['높음',15]});try{const n=t.analysis({id:trafficCell.id,t:'2026-10-13T16:00:00+09:00'}).marine.collisionNotice;assert.equal(n.on,true);assert.ok(n.text.includes('10.13. 16시'),n.text);}finally{t.cleanup();}});
    await check('해상 기준상세: 사고 단계는 공식 그대로·충돌·접촉 주의 기준(높음·혼잡지수 10·14척) 명시·종합 관심단계 문구 없음',()=>{const w={};require('vm').runInNewContext(fs.readFileSync(path.join(__dirname,'..','..','client','js','marine-life','risk-forecast','risk_basis_content.js'),'utf8'),{window:w});const sea=w.RiskBasisContent.sea;for(const k of ['현재와 미래 모두 공식 사고예보 단계','충돌·접촉 주의','「높음」 이상(혼잡지수 10 이상)','14척 이상','사고 확률이나 공식 사고 등급이 아닙니다'])assert.ok(sea.includes(k),k);assert.doesNotMatch(sea,/종합 관심단계|한 단계 높이/);});
    await check('혼잡 지도 색 경계는 실제 단계 경계 1·10·20(보통 2와 4가 다른 색)',()=>{const color=(level,index)=>{const s=scenario({cong13:[level,index]});try{return s.unifiedFrame('congestion',at13).cells.find(r=>r[1]===index)[3];}finally{s.cleanup();}};const c2=color('보통',2),c4=color('보통',4);assert.ok(c2<c4,c2+' '+c4);assert.ok(Math.abs(color('보통',1)-.25)<1e-9);assert.ok(Math.abs(color('높음',10)-.5)<1e-9);assert.ok(color('보통',9.99)<.5);assert.ok(Math.abs(color('낮음',.5)-.125)<1e-9);});
    await check('같은공식등급도 원지수에따라 연속색상위치·0~1범위',()=>{const colors=M.riskColors([[0,.001,'경계'],[1,.01,'경계'],[2,.1,'경계'],[3,0,'낮음']]);assert.ok(colors.get(0)<colors.get(1));assert.ok(colors.get(1)<colors.get(2));assert.ok([...colors.values()].every(v=>v>=0&&v<=1));});
    let d;
    await check('현재·예보 시각 분리 및 13시의 12시 사고 예보 연결',()=>{d=m.analysis({id:trafficCell.id,t:'2026-10-12T13:00:00+09:00'}).marine;assert.equal(d.current.count,21);assert.equal(d.accident.forecastAt,'2026-10-12T12:00:00+09:00');assert.equal(d.congestion.forecastAt,'2026-10-12T13:00:00+09:00');assert.equal(d.current.sourceAt,'2026-10-12T13:05:00+09:00');assert.equal('types' in d.current,false);assert.equal('tons' in d.current,false);assert.equal('typeCollectedAt' in d.current,false);});
    await check('선박사고 유형·최근5개연도·사망실종 집계',()=>{assert.equal(d.history.count,3);assert.equal(d.history.death,2);assert.equal(d.history.missing,1);assert.equal(d.history.casualtyUnknown,1);assert.equal(d.history.weatherCause,1);assert.equal(d.history.from,'2021-01-01');assert.deepEqual(d.history.excludedTypes,['해양오염','부유물감김']);});
    await check('기상악화 침몰은 1건·공식 위험지수 그대로 유지',()=>{assert.equal(d.history.types['침몰'],1);assert.equal(d.accident.index,.001);assert.equal(d.accident.level,'경계');assert.ok(d.reasons.some(r=>r.key==='increase'));assert.ok(d.reasons.every(r=>!r.text.includes('배 높은')));});
    await check('사고 통계는 작은 교통 격자가 아닌 원본 사고 격자 범위 표시',()=>{assert.equal(d.history.scope,'공식 사고 예보 격자 전체');assert.equal(d.history.gridId,'100');});
    await check('미래 선택해도 현재 척수·조회시각을 미래 관측으로 바꾸지 않음',()=>{const f=m.analysis({id:trafficCell.id,t:'2026-10-12T15:00:00+09:00'}).marine;assert.equal(f.current.collectedAt,'2026-10-12T13:05:00+09:00');assert.equal(f.current.count,21);assert.equal(f.accident.index,.002);});
    await check('표출 격자는GR4한벌·현재/혼잡/사고 모두같은인덱스',()=>{const table=m.unifiedCells();assert.ok(table.cells.length>=1);const native=table.cells.find(c=>c.id===trafficCell.id);assert.ok(native);assert.ok(table.cells.some(c=>c.displayOnly));for(const mode of ['current','congestion','accident']){const f=m.unifiedFrame(mode,'2026-10-12T13:00:00+09:00');assert.equal(f.v,table.v);assert.ok(f.cells.some(r=>r[0]===native.i));}assert.equal(m.unifiedFrame('accident','2026-10-12T13:00:00+09:00').cells[0][2],'경계');assert.throws(()=>m.unifiedFrame('invalid'),e=>e.status===400);});
    // 2026-10-16 T5: 칸 목록 버전은 칸 목록 자체의 해시 — 상태·쿼터 파일만 바뀐 입력 변경(inputVersion++)에는 v 가 그대로라 화면이 2.5MB 표를 다시 받지 않는다.
    await check('같은 입력의 공통 격자는 재사용하고 입력이 바뀌면 다시 만들되 칸이 같으면 v 유지·최소 필드만 전달',()=>{const first=m.unifiedCells();assert.equal(first,m.unifiedCells());assert.ok(first.cells.every(c=>!c.geometry&&!c.haegu&&!c.ref));inputs.version++;const next=m.unifiedCells();assert.notEqual(next,first);assert.equal(next.v,first.v,'칸 목록이 같으면 버전도 같다');assert.equal(next,m.unifiedCells());assert.equal(m.unifiedFrame('risk').v,next.v,'프레임은 같은 칸 목록 버전을 싣는다');});
    await check('반복 혼잡예보 공통표 압축·구버전 읽기 계약 유지',()=>{const codec=require('../services/marine_congestion_codec'),raw={date:'2026-10-12',frames:inputs.congestion.frames},packed=codec.pack(raw),read=codec.decode(packed);assert.equal(packed.cells.length,1);assert.equal(Object.keys(read.frames).length,2);assert.equal(read.frames['202610121300'][0].gridId,trafficCell.id);assert.equal(codec.rowAt(read,'202610121500',trafficCell.id).congestionIndex,22);assert.equal(codec.rowAt(read,'202610121500','none'),null);assert.equal(codec.decode(raw),raw);assert.ok(Buffer.byteLength(JSON.stringify(packed))<Buffer.byteLength(JSON.stringify(raw)));});
    await check('칸 목록이 실제로 바뀌면(새 GR4 칸) 칸 목록 버전도 바뀌고 프레임도 새 버전',()=>{const before=m.unifiedCells();const extra={...trafficCell,id:'GR4_F4K23_P3',i:1,lon:126.5625};inputs.cells.cells.push(extra);inputs.version++;try{const after=m.unifiedCells();assert.notEqual(after.v,before.v);assert.ok(after.cells.some(c=>c.id==='GR4_F4K23_P3'));assert.equal(m.unifiedFrame('risk').v,after.v);}finally{inputs.cells.cells.pop();inputs.version++;}assert.equal(m.unifiedCells().v,before.v,'되돌리면 같은 목록이라 같은 버전');});
    await check('관할별 척수(선종 구성 없음) 및 동일 사고격자 중복 제거',()=>{const b=m.briefing('0','2026-10-12T13:00:00+09:00');assert.equal(b.current.count,21);assert.equal('types' in b.current,false);assert.equal('unknownTypes' in b.current,false);assert.equal(b.history.count,3);assert.equal(b.totalAttentionRegions,1);assert.equal(b.baselineAvailable,false);assert.match(b.method,/격자 중심/);assert.equal(m.briefing('1','2026-10-12T13:00:00+09:00').current.count,null);});
    await check('관할 브리핑 current.cells — 지금 척수를 이룬 같은 줄(격자 id·상자 4자리·척수), 합 = count · 줄 수 = gridCount(연안 안전 브리핑 §11.10.9 ⑥ 팝업 지도)',()=>{const b=m.briefing('0','2026-10-12T13:00:00+09:00');assert.ok(Array.isArray(b.current.cells)&&b.current.cells.length===b.current.gridCount);assert.equal(b.current.cells.reduce((n,c)=>n+c.count,0),b.current.count);for(const c of b.current.cells){assert.ok(typeof c.id==='string'&&c.box.length===4&&c.box[0]<c.box[2]&&c.box[1]<c.box[3]);assert.ok(c.box.every(v=>Math.round(v*1e4)/1e4===v));}});
    // 연안 안전 브리핑 설계서 §11.10.41(2026-10-19 사용자 「위험예측까지 넓힘」): 해역 이름 = 브리핑 해역 카드와 같은 규칙(station_briefing_rules.regionName — 주요지명이 10km 넘게 멀면 칸 중심이 든 관할의 관광지·위험구역 중 더 가까운 곳)
    await check('해역 이름 — 관할 기준점(placesOf)이 있으면 regionName(분석 제목·관할 브리핑 regions 모두), 주요지명보다 먼 기준점·기준점 없음·관할 밖은 종전 location',()=>{const R=require('../services/station_briefing_rules'),at='2026-10-12T13:00:00+09:00',near=[{name:'가까운곳',lat:33.56,lon:126.54}],asked=[];
        const s=M.createStore({risk,dir,clock:()=>now,stations,accidents,describe,placesOf:id=>{asked.push(id);return near;}});const want=R.regionName(trafficCell,near).name;
        assert.equal(want,'가까운곳 북서방 0.2해리 해역(163-6해구)');assert.equal(s.analysis({id:trafficCell.id,t:at}).title,want);assert.equal(s.briefing('0',at).regions[0].location,want);assert.ok(asked.includes('0'),'칸 중심이 든 관할 id 로 묻는다');
        const far=M.createStore({risk,dir,clock:()=>now,stations,accidents,describe,placesOf:()=>[{name:'먼곳',lat:34.5,lon:126.5}]});assert.equal(far.analysis({id:trafficCell.id,t:at}).title,M.location(trafficCell),'주요지명(15.2km)보다 먼 기준점이면 주요지명 그대로');
        assert.equal(m.analysis({id:trafficCell.id,t:at}).title,M.location(trafficCell),'관할을 주입한 시험의 기본 = 기준점 없음 → 종전');
        const out=M.createStore({risk,dir,clock:()=>now,stations,accidents,describe,placesOf:()=>{throw new Error('관광지 표 준비 전');}});assert.equal(out.analysis({id:trafficCell.id,t:at}).title,M.location(trafficCell),'기준점 실패 → 종전 이름');
        assert.equal(s.analysis({lon:127.5,lat:34.0,t:at}).title,M.location(describe({gridId:'point',latitude:34.0,longitude:127.5})),'관할 밖 → 종전 이름(주요지명만)');});
    // 연안 안전 브리핑 설계서 §11.10.43(2026-10-19 사용자 「항구 우선」·「마을공동어항만 제외 (추천)」 · 관할 밖은 *"관할 밖 바다에 대해서는 논외로 남기는게 좋을 것 같은데 관할 내 주요지명을 기준으로 설명토록 하는게 좋겠는걸"*):
    //   관할 안 칸만 10km 안 공식 항이 관할 기준점·주요지명보다 먼저. 관할 밖 칸은 항이 가까워도 종전 location(주요지명만).
    await check('해역 이름 — 관할 안 칸은 공식 항(ports)이 10km 안이면 그 항이 먼저(관할 기준점이 더 가까워도) · 관할 밖 칸은 항이 10km 안이어도 종전 이름(주요지명만) · 10km 밖 항은 무시 · 관할을 주입한 시험의 기본은 항 없음',()=>{const R=require('../services/station_briefing_rules'),at='2026-10-12T13:00:00+09:00',near=[{name:'가까운곳',lat:33.56,lon:126.54}],port={name:'가짜항',kind:'지방어항',lat:33.58,lon:126.53};
        const s=M.createStore({risk,dir,clock:()=>now,stations,accidents,describe,placesOf:()=>near,ports:[port]});const want=R.regionName(trafficCell,near,[port]);
        assert.equal(want.baseKind,'port');assert.ok(want.name.startsWith('가짜항 ')&&want.name.endsWith('해리 해역(163-6해구)'),want.name);assert.equal(s.analysis({id:trafficCell.id,t:at}).title,want.name);assert.equal(s.briefing('0',at).regions[0].location,want.name);
        const outPt=describe({gridId:'point',latitude:34.0,longitude:127.5}),o=M.createStore({risk,dir,clock:()=>now,stations,accidents,describe,ports:[{name:'바깥항',kind:'국가어항',lat:34.03,lon:127.52}]});
        assert.equal(o.analysis({lon:127.5,lat:34.0,t:at}).title,M.location(outPt),'관할 밖 칸은 3.8km 안 항이 있어도 종전 이름(주요지명만)');
        const f=M.createStore({risk,dir,clock:()=>now,stations,accidents,describe,ports:[{name:'먼항',kind:'국가어항',lat:33.75,lon:126.54}]});assert.equal(f.analysis({id:trafficCell.id,t:at}).title,M.location(trafficCell),'관할 안이어도 10km 넘는 항(20.9km)은 무시 → 종전');
        assert.equal(m.analysis({id:trafficCell.id,t:at}).title,M.location(trafficCell),'관할을 주입한 시험의 기본 = 항 없음 → 종전');});
    await check('같은 사고영역의 뒤쪽 교통격자가 더 붐비면 대표로 유지',()=>{const second={...trafficCell,id:'GR4_F4K23_P3',i:1,lon:126.5625,geometry:{type:'Polygon',coordinates:[[[126.55,33.55],[126.575,33.55],[126.575,33.575],[126.55,33.575],[126.55,33.55]]]}};const scoped=fs.mkdtempSync(path.join(os.tmpdir(),'fusion-representative-'));try{io.write(path.join(scoped,'sea_realtime.json.gz'),{cells:[trafficCell,second],rows:[[0,1,.1],[1,21,.2]],collectedAt:io.iso(now),v:'two'});const local=M.createStore({risk,dir:scoped,clock:()=>now,stations,accidents,describe}),b=local.briefing('0','2026-10-12T13:00:00+09:00');assert.equal(b.current.count,22);assert.equal(b.totalAttentionRegions,1);assert.equal(b.regions[0].current.count,21);}finally{fs.rmSync(scoped,{recursive:true,force:true});}});
    await check('모레(3일째) 시각은 해상 통합 조회 전부 400·내일 23:59까지 정상(「해상 공식 사고예보는 2일까지만」 2026-10-15)',async()=>{inputs.accident.frames['202610140000']=[[0,.003,'경계']];try{assert.equal(m.unifiedFrame('accident','2026-10-13T23:59:00+09:00').t,'2026-10-13T23:59:00+09:00');for(const bad of ['2026-10-14T00:00:00+09:00','2026-10-14T21:00:00+09:00']){assert.throws(()=>m.unifiedFrame('accident',bad),e=>e.status===400,bad);assert.throws(()=>m.unifiedFrame('risk',bad),e=>e.status===400,bad);assert.throws(()=>m.analysis({id:trafficCell.id,t:bad}),e=>e.status===400,bad);assert.throws(()=>m.briefing('0',bad),e=>e.status===400,bad);}const app=express();app.use(createRouter({store:risk,marine:m}));const local=app.listen(0,'127.0.0.1');await new Promise(resolve=>local.once('listening',resolve));try{const url='http://127.0.0.1:'+local.address().port+'/api/risk-forecast/sea/',day3=encodeURIComponent('2026-10-14T00:00:00+09:00');assert.equal((await fetch(url+'unified-frame?mode=accident&t='+day3)).status,400);assert.equal((await fetch(url+'analysis?id='+trafficCell.id+'&t='+day3)).status,400);assert.equal((await fetch(url+'briefing?id=0&t='+day3)).status,400);}finally{await new Promise(resolve=>local.close(resolve));}}finally{delete inputs.accident.frames['202610140000'];}});
    await check('잘못된 관할·시각·좌표는 사용자 입력 오류',()=>{assert.throws(()=>m.briefing('none'),e=>e.status===404);assert.throws(()=>m.analysis({lon:'nan',lat:33}),e=>e.status===400);assert.throws(()=>m.analysis({id:trafficCell.id,t:'2020-01-01'}),e=>e.status===400);});
    await check('오래된 현재 척수는 관심 판단·충돌·접촉 주의의 근거로 쓰지 않음',()=>{now+=20*60000;const f=m.analysis({id:trafficCell.id}).marine;assert.equal(f.current.status,'stale');assert.ok(!f.reasons.some(r=>r.key==='traffic'));assert.ok(!(f.collisionNotice.reasons||[]).some(r=>r.kind==='traffic'),'낡은 척수는 충돌·접촉 주의 사유로 쓰지 않음');});
    await check('원천 실패는 마지막 정상본을 덮어쓰지 않음',async()=>{const before=fs.readFileSync(path.join(dir,'sea_realtime.json.gz'));const failed=C.createCollector({dir,key:'test',clock:()=>now,fetchImpl:async()=>{throw Error('secret serviceKey=never-log');},describe});assert.equal((await failed.collect()).ok,false);assert.deepEqual(fs.readFileSync(path.join(dir,'sea_realtime.json.gz')),before);assert.doesNotMatch(JSON.stringify(io.read(path.join(dir,'realtime_status.json'))),/secret|serviceKey/);});
    await check('API 등록시각이 다른 페이지를 섞지 않음',async()=>{let n=0;const f=async()=>({ok:true,json:async()=>({response:{header:{resultCode:'200',resultMsg:'NORMAL_SERVICE'},body:{regDt:++n===1?'2026-10-12 13:05:00':'2026-10-12 13:10:00',totalCount:2,items:{item:[{grid_id:n===1?'GR4_F4K23_P4':'GR4_F4K23_P3',vmtc:1,dnsty:0}]}}}})});await assert.rejects(C.readApi({dir,key:'test',fetchImpl:f,now}),/partial response/);});
    await check('다음 5분 구간 API 값은 같은 칸 번호를 유지하고 척수만 바뀜',async()=>{now+=5*60000;const c=C.createCollector({dir,key:'test',clock:()=>now,fetchImpl:api([[trafficCell.id,22,1]],'2026-10-12 13:30:00'),describe});assert.equal((await c.collect()).ok,true);const saved=io.read(path.join(dir,'sea_realtime.json.gz'));assert.deepEqual(saved.rows,[[0,22,1]]);assert.equal(saved.cells.length,1);});
    await check('밀집도 잠정 4단계 경계 = 혼잡예보 응답 경계(낮음 ≤1 · 보통 1 초과~10 미만 · 높음 10 이상~20 미만 · 매우높음 20 이상)·빈 값은 단계 없음(사용자 2026-10-16 「그럼 ㄱ으로 하자」)',()=>{
        assert.deepEqual([0,1,1.01,5,9.99,10,19.99,20,100].map(M.densityLevel),['낮음','낮음','보통','보통','보통','높음','높음','매우높음','매우높음']);
        for(const v of [null,undefined,NaN])assert.equal(M.densityLevel(v),null);
    });
    await check('지금 혼잡도 지도(current)는 밀집도로 칠하고 칸 숫자는 척수 그대로 · 밀집도 빈 칸은 칠하지 않음 · 응답에 없는 칸은 「낮음」·0척(사용자 「배가없는 칸을 낮음으로」) · 낡으면 아무것도 안 칠함',()=>{
        const scoped=fs.mkdtempSync(path.join(os.tmpdir(),'fusion-density-')),second={...trafficCell,id:'GR4_F4K23_P3',i:1,lon:126.5625,geometry:{type:'Polygon',coordinates:[[[126.55,33.55],[126.575,33.55],[126.575,33.575],[126.55,33.575],[126.55,33.55]]]}},third={...trafficCell,id:'GR4_F4K23_P2',i:2,lon:126.5875,geometry:{type:'Polygon',coordinates:[[[126.575,33.55],[126.6,33.55],[126.6,33.575],[126.575,33.575],[126.575,33.55]]]}};
        io.write(path.join(scoped,'sea_realtime.json.gz'),{cells:[trafficCell,second,third],rows:[[0,18,12],[1,30,null],[2,6,5.5]],sourceAt:io.iso(now),collectedAt:io.iso(now),source:'MTIS realtime API'});
        const local={...inputs,cells:{cells:[trafficCell,second,third]}};
        const s2=M.createStore({risk:{marineInputs:()=>local,sources:()=>local.sources},dir:scoped,clock:()=>now,stations,accidents,describe});
        const f=s2.unifiedFrame('current');
        const ids=new Map(s2.unifiedCells().cells.map(c=>[c.i,c.id]));
        const got=f.cells.map(([i,n,level,color])=>[ids.get(i),n,level,Math.round(color*1000)/1000]);
        assert.deepEqual(got.filter(r=>r[1]>0).sort((a,b)=>a[0].localeCompare(b[0])),[['GR4_F4K23_P2',6,'보통',0.375],['GR4_F4K23_P4',18,'높음',0.55]]);   // 12% → 높음 칸(10~20)의 20% 위치 → (2+0.2)/4 · 5.5% → 보통 칸(1~10)의 50% → (1+0.5)/4(종전 5·10 경계면 0.275)
        assert.ok(!got.some(r=>r[0]==='GR4_F4K23_P3'),'척수는 있는데 밀집도가 빈 칸은 칠하지 않음');
        const empty=got.filter(r=>r[1]===0);assert.ok(empty.length>0&&empty.every(r=>r[2]==='낮음'&&r[3]===0),'응답에 없는 칸은 낮음·0');
        const late=M.createStore({risk:{marineInputs:()=>local,sources:()=>local.sources},dir:scoped,clock:()=>now+20*60000,stations,accidents,describe});assert.deepEqual(late.unifiedFrame('current').cells,[],'수집이 낡았으면 0척으로 지어내지 않음');
        assert.equal(s2.analysis({id:trafficCell.id}).marine.current.densityLevel,'높음');
        fs.rmSync(scoped,{recursive:true,force:true});
    });
    await check('최신 응답에 이 칸이 없으면 0척·밀집도 낮음(공단 API 는 배 없는 칸을 안 보냄) · 수집이 낡았으면 모름(null)',()=>{
        const scoped=fs.mkdtempSync(path.join(os.tmpdir(),'fusion-empty-')),other={...trafficCell,id:'GR4_F4K23_P3',i:1,lon:126.5625,geometry:{type:'Polygon',coordinates:[[[126.55,33.55],[126.575,33.55],[126.575,33.575],[126.55,33.575],[126.55,33.55]]]}};
        io.write(path.join(scoped,'sea_realtime.json.gz'),{cells:[trafficCell,other],rows:[[1,7,3]],sourceAt:io.iso(now),collectedAt:io.iso(now),source:'MTIS realtime API'});
        const s2=M.createStore({risk,dir:scoped,clock:()=>now,stations,accidents,describe});
        const c=s2.analysis({id:trafficCell.id}).marine.current;
        assert.deepEqual([c.gridId,c.count,c.density,c.densityLevel,c.absent,c.status],[trafficCell.id,0,0,'낮음',true,'ok']);
        const late=M.createStore({risk,dir:scoped,clock:()=>now+20*60000,stations,accidents,describe});
        assert.equal(late.analysis({id:trafficCell.id}).marine.current,null,'수집이 멈췄으면 0척으로 지어내지 않는다');
        fs.rmSync(scoped,{recursive:true,force:true});
    });
    await check('칸 사고 목록: 최신순·종류·원인 이름·사망/실종(빈 값은 null, 0 으로 바꾸지 않음)·제외 유형 빠짐',()=>{
        const list=M.accidentList([row('ATY027',null,2,1,'20230914'),row('ATY028','ACC008',0,0,'20250102'),row('ATY019','ACC012',null,null,'20240501'),row('ATY010','ACC008',0,3,'20220101')]);
        assert.deepEqual(list,[
            {date:'2025-01-02',year:2025,type:'침몰',cause:'기상악화',death:0,missing:0},
            {date:'2024-05-01',year:2024,type:'접촉',cause:'운항부주의',death:null,missing:null},
            {date:'2023-09-14',year:2023,type:'충돌',cause:null,death:2,missing:1},
            {date:'2022-01-01',year:2022,type:'기상 관련 기타',cause:'기상악화',death:0,missing:3}]);
        const h=m.analysis({id:trafficCell.id}).marine.history;
        assert.equal(h.accidents.length,h.count,'목록 건수 = 집계 건수(해양오염·부유물감김 제외 규칙 같음)');
        assert.ok(h.accidents.every(a=>a.year>=2021&&a.year<=2025));
        const br=m.briefing(m.jurisdictionList().stations[0].id);assert.ok(br.regions.every(r=>!r.history||!('accidents' in JSON.parse(JSON.stringify(r.history)))),'관할 브리핑에는 사고 목록을 싣지 않음(독립 검토 지적)');
    });
    // ── 발효 중 특보 상자(marine.warnings) — 2026-10-16 사용자 「해당 해역에 특보가 있다면 파고 윗부분에 … 빨간 사각형 박스로 제주도북부앞바다 풍랑주의보 발효 / 발표 / 발효 / 해제예정 … 정보없음」
    // 원자료 꼴은 크롤러 결과 트리(weather_alerts.json current — marine_warning_crawler._buildZoneTreeFromSnapshot·normalizeMmisTime 뒤)를 그대로 흉내 낸다.
    const W13=Date.parse('2026-10-12T13:05:00+09:00'),wdir=path.join(dir,'warn-empty');fs.mkdirSync(wdir);   // 실시간 교통 파일 없는 폴더(dir 정리 때 함께 지워짐)
    const blk=(lvl,o={})=>({wrnTp:'풍랑',wrnTpNm:'풍랑',wrnLvl:lvl,wrnLvlNm:lvl,tmFc:'2026년 10월 12일 04시 30분',tmEf:'2026년 10월 12일 06시 00분',tmYn:'',tmCc:'',clrNtcTm:'',source:'MARINE_MMIS',...o});
    const wtree=(parent,child,upcoming=null)=>({남해:{제주도해상:{제주도앞바다:{'제주도북부앞바다':{current:parent||null,upcoming,history:[],children:{'제주도북부앞바다중연안바다':child||null}}}}}});
    const subCell={...trafficCell,id:'GR4_F4K23_R4',i:1,lon:126.6375,lat:33.5625,geometry:{type:'Polygon',coordinates:[[[126.625,33.55],[126.65,33.55],[126.65,33.575],[126.625,33.575],[126.625,33.55]]]}};
    const wstore=(tree,status='ok')=>{const inp={...inputs,cells:{cells:[trafficCell,subCell]},warnings:tree===undefined?null:{updatedAt:'2026. 10. 12. PM 1:04:30',current:tree},sources:{...inputs.sources,warnings:{status,updatedAt:'2026-10-12T13:04:30+09:00'}}};return M.createStore({risk:{marineInputs:()=>inp},dir:wdir,clock:()=>W13,stations,accidents,describe});};
    const wAt=(s,t,id=trafficCell.id)=>s.analysis({id,t}).marine.warnings;
    await check('특보 상자: 발효 중(해제예정 없음) — 구역·종류·단계·발표·발효 시각, 해제예정 null(화면 「정보없음」)',()=>{
        const w=wAt(wstore(wtree(blk('주의보'))),'2026-10-12T13:05:00+09:00');
        assert.equal(w.status,'ok');assert.deepEqual(w.zone,{name:'제주도북부앞바다',kind:'앞바다'});assert.equal(w.items.length,1);
        assert.deepEqual(w.items[0],{zone:'제주도북부앞바다',kind:'앞바다',type:'풍랑',level:'주의보',issued:{start:'2026-10-12T04:30:00+09:00',end:'2026-10-12T04:30:00+09:00',range:false},effective:{start:'2026-10-12T06:00:00+09:00',end:'2026-10-12T06:00:00+09:00',range:false},release:null});
    });
    await check('특보 상자: 해제예정이 이미 지났으면 뺌 · 남았으면 넣음 · 미래 시각에서 해제예정 이후면 뺌(정확 시각)',()=>{
        assert.deepEqual(wAt(wstore(wtree(blk('주의보',{clrNtcTm:'2026년 10월 12일 12시 00분'}))),'2026-10-12T13:05:00+09:00').items,[],'12시 해제예정 → 13:05 에는 없음');
        const s=wstore(wtree(blk('경보',{clrNtcTm:'2026년 10월 12일 15시 00분',tmCc:'2026년 10월 12일 15시 00분'})));
        const now=wAt(s,'2026-10-12T13:05:00+09:00');assert.equal(now.items.length,1);assert.deepEqual(now.items[0].release,{start:'2026-10-12T15:00:00+09:00',end:'2026-10-12T15:00:00+09:00',range:false});
        assert.equal(wAt(s,'2026-10-12T14:59:00+09:00').items.length,1,'14:59 미래 — 아직 발효 중');
        assert.deepEqual(wAt(s,'2026-10-12T15:00:00+09:00').items,[],'해제예정 시각 그 자체부터는 뺌');
        assert.deepEqual(wAt(s,'2026-10-13T09:00:00+09:00').items,[],'내일 09시 — 해제예정 뒤');
    });
    await check('특보 상자: 해제예정 범위(15~18시)는 범위 끝까지 남김 · 범위 끝 뒤 미래는 뺌 · 범위·발표 글자는 원문 꼴(월 없는 「12일 오후(15시~18시)」)도 읽음',()=>{
        const s=wstore(wtree(blk('주의보',{clrNtcTm:'12일 오후(15시~18시)',tmCc:'12일 오후(15시~18시)'})));
        const a=wAt(s,'2026-10-12T16:00:00+09:00');assert.equal(a.items.length,1);assert.deepEqual(a.items[0].release,{start:'2026-10-12T15:00:00+09:00',end:'2026-10-12T18:00:00+09:00',range:true});
        assert.equal(wAt(s,'2026-10-12T17:59:00+09:00').items.length,1);assert.deepEqual(wAt(s,'2026-10-12T18:00:00+09:00').items,[]);
    });
    await check('특보 상자: 해제예고(clrNtcTm) 없으면 tmYn(통보문 해제예정, 58분 코드는 범위)으로 — 특보정보 탭 「해제예정」과 같은 순서',()=>{
        const w=wAt(wstore(wtree(blk('주의보',{tmYn:'2026년 10월 12일 18시~24시'}))),'2026-10-12T13:05:00+09:00');
        assert.deepEqual(w.items[0].release,{start:'2026-10-12T18:00:00+09:00',end:'2026-10-13T00:00:00+09:00',range:true});
    });
    await check('특보 상자: 발효시각이 선택 시각보다 뒤면(발표됐지만 아직 발효 전) 뺌 · 미래 시각이 발효 뒤면 넣음 · 발효 범위는 범위 시작부터',()=>{
        const s=wstore(wtree(blk('주의보',{tmEf:'2026년 10월 12일 14시 00분'})));
        assert.deepEqual(wAt(s,'2026-10-12T13:05:00+09:00').items,[]);const f=wAt(s,'2026-10-12T15:00:00+09:00');assert.equal(f.items.length,1);assert.equal(f.items[0].effective.start,'2026-10-12T14:00:00+09:00');
        const r=wstore(wtree(blk('경보',{tmEf:'2026년 10월 12일 오후(15시~18시)'})));
        assert.deepEqual(wAt(r,'2026-10-12T14:00:00+09:00').items,[]);const g=wAt(r,'2026-10-12T16:00:00+09:00').items[0];assert.deepEqual(g.effective,{start:'2026-10-12T15:00:00+09:00',end:'2026-10-12T18:00:00+09:00',range:true});
        const d=wstore(wtree(blk('주의보',{tmEf:'2026년 10월 12일 밤(21시~21시)'})));assert.deepEqual(wAt(d,'2026-10-12T22:00:00+09:00').items[0].effective,{start:'2026-10-12T18:00:00+09:00',end:'2026-10-13T00:00:00+09:00',range:true},'시작=끝 범위는 특보정보 탭처럼 6시간 칸');
    });
    await check('특보 상자: 예비특보(부모 upcoming·자식 「예비」)는 발효가 아니라 뺌',()=>{
        assert.deepEqual(wAt(wstore(wtree(null,null,blk('예비',{tmEf:'12일 오후(15시~18시)'}))),'2026-10-12T16:00:00+09:00').items,[]);
        assert.deepEqual(wAt(wstore(wtree(null,blk('예비'))),'2026-10-12T13:05:00+09:00',subCell.id).items,[]);
    });
    await check('특보 상자: 특보 자료가 낡음·없음·깨짐이면 상자 없음(items 빈 배열)·상태는 그대로 알림 · 원자료 시각 빈 값(\'0\'·12자리 0·\'일\')은 null',()=>{
        for(const st of ['stale','missing','error']){const w=wAt(wstore(wtree(blk('경보')),st),'2026-10-12T13:05:00+09:00');assert.equal(w.status,st);assert.deepEqual(w.items,[]);}
        assert.equal(wAt(wstore(undefined),'2026-10-12T13:05:00+09:00').items.length,0,'파일 없음');
        assert.equal(m.analysis({id:trafficCell.id,t:'2026-10-12T15:00:00+09:00'}).marine.warnings.status,'missing','특보 상태가 없는 입력 → missing');
        const w=wAt(wstore(wtree(blk('주의보',{tmFc:'0',tmEf:'000000000000',clrNtcTm:'일'}))),'2026-10-12T13:05:00+09:00');assert.equal(w.items.length,1);assert.deepEqual([w.items[0].issued,w.items[0].effective,w.items[0].release],[null,null,null]);
        assert.equal(M.warnTime('0',W13),null,'risk_time.parseMmisTime 은 \'0\' 을 2000-01-01 로 읽는다 — 날짜 꼴만 받는다');
    });
    await check('특보 상자: 연안바다 칸은 그 연안바다 블록만(부모 앞바다 「연안바다 제외」 대비) · 지점 조회(GR4 칸 밖)도 같은 구역 판정',()=>{
        const only=wstore(wtree(blk('주의보'),null));assert.deepEqual(wAt(only,'2026-10-12T13:05:00+09:00',subCell.id).zone,{name:'제주도북부앞바다중 연안바다',kind:'연안바다'});
        assert.deepEqual(wAt(only,'2026-10-12T13:05:00+09:00',subCell.id).items,[],'부모만 발효·자식 없음 → 연안바다 칸은 상자 없음');
        assert.equal(wAt(only,'2026-10-12T13:05:00+09:00').items.length,1,'연안바다 밖 앞바다 칸은 부모 특보');
        const both=wstore(wtree(blk('주의보'),blk('경보',{tmEf:'2026년 10월 12일 09시 00분'})));const w=wAt(both,'2026-10-12T13:05:00+09:00',subCell.id);
        assert.deepEqual(w.items.map(x=>[x.zone,x.kind,x.level,x.effective.start]),[['제주도북부앞바다중연안바다','연안바다','경보','2026-10-12T09:00:00+09:00']]);
        const pt=both.analysis({lon:126.64,lat:33.56,t:'2026-10-12T13:05:00+09:00'}).marine.warnings;assert.equal(pt.zone.kind,'연안바다');assert.equal(pt.items[0].level,'경보');
    });
    await check('특보 상자: 여러 개면 경보 먼저, 같은 단계는 발효 이른 순(정렬 규칙 — 인위적 두 블록)',()=>{
        const tree={a:{'제주도북부앞바다':{current:blk('주의보',{tmEf:'2026년 10월 12일 03시 00분'}),children:{}}},b:{'제주도북부앞바다':{current:blk('경보',{tmEf:'2026년 10월 12일 10시 00분'}),children:{}}},c:{'제주도북부앞바다':{current:blk('주의보',{tmEf:'2026년 10월 12일 01시 00분',wrnTp:'T',wrnTpNm:'태풍'}),children:{}}}};
        const w=M.warningsAt(tree,{name:'제주도북부앞바다',kind:'앞바다'},'2026-10-12T13:05:00+09:00',{status:'ok'},W13);
        assert.deepEqual(w.items.map(x=>x.type+x.level+'@'+x.effective.start.slice(11,13)),['풍랑경보@10','태풍주의보@01','풍랑주의보@03']);
    });
    await check('실제 HTTP 통합·관할 계약과 읽기전용 오류',async()=>{const app=express();app.use(createRouter({store:risk,marine:m}));server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const url='http://127.0.0.1:'+server.address().port+'/api/risk-forecast/sea/';const a=await fetch(url+'analysis?id='+trafficCell.id);assert.equal(a.status,200);assert.equal(a.headers.get('cache-control'),'no-store');assert.ok((await a.json()).marine);assert.equal((await fetch(url+'briefing?id=none')).status,404);assert.equal((await(await fetch(url+'jurisdictions')).json()).stations.length,2);});
}finally{if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});console.log(`${pass} PASS / ${fail} FAIL`);if(fail)process.exitCode=1;}})();
