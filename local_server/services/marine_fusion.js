/**
 * 파일명: local_server/services/marine_fusion.js
 * 역할  : 현재 교통·공식 예보·기존 선박사고를 같은 위치로 연결해 해역과 관할의 근거 있는 설명을 만든다.
 * [연계] risk_store.marineInputs → 본 저장소 → routes/risk_forecast → RiskMarine 화면.
 * [로드 순서] 요청에서 외부 수집·Gemini 호출 없음. 연안 관광객 사고는 읽지 않는다.
 */
'use strict';
const fs=require('fs'),path=require('path'),io=require('./risk_collector_io'),G=require('./risk_geo'),T=require('./risk_time');
const ROOT=path.join(__dirname,'..'),CLIENT=path.join(ROOT,'..','client'),codec=require('./marine_congestion_codec');
// 선종·톤수 구성은 다루지 않는다 — 사용자 결정 2026-10-15 「톤수, 선박 종류는 API에서 제공하지않는다고 공식적으로 확인했어. 이용할 수 없을 것 같아.」
const INCIDENTS={ATY018:'전복',ATY019:'접촉',ATY022:'좌주',ATY023:'좌초',ATY027:'충돌',ATY028:'침몰',ATY029:'침수',ATY032:'폭발',ATY033:'표류',ATY035:'행방불명',ATY036:'화재',ATY037:'침수침몰',ATY041:'좌초/좌주'};
const EXCLUDED=new Set(['ATY034','ATY040']),RANK={'낮음':0,'보통':1,'높음':2,'매우높음':3,'주의':2,'경계':3};
/** 실제 폴리곤의 경위도 상자를 구한다. 예: Polygon과 MultiPolygon 모두 지원.
 * @param {object} geometry - GeoJSON @returns {array} bounds
 * [연계] ← historyIndex/jurisdictions / 후보를 먼저 줄여 공간 판정한다.
 */
function bounds(geometry){const a=geometry.coordinates.flat(Infinity),xs=a.filter((_,i)=>i%2===0),ys=a.filter((_,i)=>i%2===1);return[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];}
/** 기존 해구·지명·16방위·해리로 해역 이름을 만든다. 예: 제주항 북서방 8.2해리 해역(163-6해구).
 * @param {object} cell - 기존 risk_sea_cells.describe 결과 @returns {string} 해역 이름
 * [연계] ← analyze/briefing / 별도 해구 번호 체계를 만들지 않는다.
 */
function location(cell){const r=cell.ref,h=cell.haegu;return(r?`${r.name} ${r.bearingWord}방 ${Number(r.distNm).toFixed(1)}해리 해역`:'선택 해역')+(h?.label?`(${h.label}해구)`:'');}
/** 요약 빈 값을 만든다. 예: 사망 수치 누락 건수는 실제 0과 분리.
 * @returns {object} 집계 @param 없음
 * [연계] ← summary / 과거 건수는 현재 사고 확률로 변환하지 않는다.
 */
function emptySummary(){return{count:0,death:0,missing:0,casualtyUnknown:0,weatherCause:0,types:{}};}
/** 공간 포함 사고를 중복 없이 집계한다. 예: 기상악화 침몰 1건은 전체 1건.
 * @param {array} rows - 허용된 기존 선박사고 @returns {object} 사고 통계
 * [연계] ← history / 구조 인원은 인명피해에 더하지 않는다.
 */
function summary(rows){const s=emptySummary();for(const r of rows){s.count++;const type=INCIDENTS[r[5]]||'기상 관련 기타';s.types[type]=(s.types[type]||0)+1;if(r[6]==='ACC008')s.weatherCause++;if(r[10]===null||r[11]===null)s.casualtyUnknown++;if(Number.isFinite(r[10])&&r[10]>=0)s.death+=r[10];if(Number.isFinite(r[11])&&r[11]>=0)s.missing+=r[11];}return{...s,topTypes:Object.entries(s.types).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'ko')).slice(0,3).map(([type,count])=>({type,count}))};}
/** 현재 척수 기준 교통 단계만 구한다. 예: GR4 21척 → 혼잡, 사고 경계와 다른 단계.
 * @param {number|null} n - 척수 @returns {string|null} 단계
 * [연계] ← analyze / MTIS 모바일 GR4 기준 7·14·21.
 */
function trafficLevel(n){return n===null?null:n<7?'여유':n<14?'보통':n<21?'주의':'혼잡';}
// 실시간 밀집도(%) 4단계 — 공식 단계가 아니라 앱 가안이다. 실시간 API 는 칸번호·척수·밀집도 세 값만 주고 단계는 주지 않는다.
// 경계는 공단 혼잡예보 **실제 응답**의 단계 경계 1·10·20(아래 unifiedFrame 의 혼잡 색 경계 [0,1,10,20,100] 과 같은 배열)이다. 두 %가 같은 산식인지는 확인하지 못했다.
//  - 사용자 결정 2026-10-16: 혼잡도 표는 「1-(나)」(실제 응답 경계로 고치기), 밀집도는 「그럼 ㄱ으로 하자」(밀집도 잠정 기준도 1·10·20). 종전(2026-10-15 「밀집도는 가안대로 가자.」)은 기관 안내 문구의 5·10·20%, 경계값은 아래 단계였다.
//  - 경계값이 어느 단계인지: 운영 혼잡 프레임 10개(2026-10-15, 46,312칸) 실제 응답은 낮음 0.1~1 · 보통 1~9.99 · 높음 10~19.94 · 매우높음 20.02~99.9 였다
//    (2026-10-10 03·12시 실측: 낮음 0.1~1.0 · 보통 1.0~9.97 · 높음 10.07~19.49 · 매우높음 20.24~99.86 — coastal_safety_forecast.design.md 4.2).
//    10 은 높음 쪽(보통 최대 9.99, 높음 최소 10)이라 「10 이상 높음」. 20 은 두 자료 어디에도 나온 적이 없어 10 과 같은 규칙으로 「20 이상 매우높음」.
//    1 은 기록이 「낮음 ~1」·「보통 1~」로 겹쳐 응답으로는 가를 수 없다 — 기관 안내 문구의 「1% 초과」(그 위부터 단계가 시작)와 맞춰 「1 이하 낮음」.
//  - 그래서: 낮음 ≤1 · 보통 1 초과~10 미만 · 높음 10 이상~20 미만 · 매우높음 20 이상.
const DENSITY_CUTS=[0,1,10,20,100],DENSITY_LEVELS=['낮음','보통','높음','매우높음'];
/** 실시간 밀집도를 잠정 4단계(혼잡예보 응답 경계 1·10·20)로 나눈다. 예: 1 → 낮음, 1.01 → 보통, 10 → 높음, 12.0 → 높음, 20 → 매우높음, null → null.
 * @param {number|null} d - 밀집도(%) @returns {string|null} 단계
 * [연계] ← analyze(current.densityLevel) · unifiedFrame('current' 지도 색) / 화면 뱃지·범례 「밀집도」
 */
function densityLevel(d){return d===null||d===undefined||!Number.isFinite(d)?null:d<=1?'낮음':d<10?'보통':d<20?'높음':'매우높음';}
// 사고 원인 코드 → 이름. 출처는 client/js/shared/utils/accident_codes.js(국립해양조사원 개방海 코드정의서)와 같은 값.
const CAUSES={ACC004:'기타(인명)',ACC005:'관리소홀',ACC006:'기관고장',ACC007:'기관손상',ACC008:'기상악화',ACC009:'기타',ACC010:'별표',ACC011:'연료고갈',ACC012:'운항부주의',ACC013:'원인미상',ACC014:'재질불량',ACC015:'적재불량',ACC016:'전복',ACC017:'정비불량',ACC018:'좌초',ACC019:'충돌',ACC020:'침수',ACC021:'화기취급부주의',ACC022:'안전부주의'};
/** 칸 안 사고를 한 건씩 최신순 목록으로 만든다(사고 종류별 팝업·인명피해 한 줄용). 예: [{date:'2023-09-14',year:2023,type:'충돌',cause:'운항부주의',death:1,missing:0}]
 * 원인이 없으면 cause:null(「원인 기록 없음」), 사망·실종 수가 비었으면 null(0 으로 바꾸지 않는다).
 * @param {array} rows - 허용된 기존 선박사고 @returns {array} 사고 목록
 * [연계] ← history(칸 단위만 — 관할 briefing 은 건수가 많아 싣지 않는다) / 화면 「이 해역 과거 선박사고」
 */
function accidentList(rows){const n=x=>Number.isFinite(x)&&x>=0?x:null;return rows.map(r=>{const d=String(r[2]);return{date:d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8),year:Number(d.slice(0,4)),type:INCIDENTS[r[5]]||'기상 관련 기타',cause:CAUSES[r[6]]||null,death:n(r[10]),missing:n(r[11])};}).sort((a,b)=>b.date.localeCompare(a.date));}
// 사고 단계는 공식 사고 예보 그대로 둔다. 종전 「공식 낮음·보통 + 현재 14척 이상이면 한 단계 올림(종합 관심단계)」은 없앴다 —
// 사용자 결정 2026-10-15 「혼잡해서 발생하는 사고는 실질적으로 충돌뿐이라 혼잡도·밀집도로 사고 등급을 높이는 게 맞나 싶다」 ·
// 「충돌, 접촉 주의로 안내가 나가야하고 사유도 명시해야해.」 → 혼잡·척수는 아래 collisionNotice 의 별도 안내로만 쓴다.
const NOTICE_COUNT=14,NOTICE_CONGESTION=new Set(['높음','매우높음']);
/** 예보 시각을 짧게 쓴다. 예: 같은 날 '16시', 다른 날 '10.13. 16시'.
 * @param {string} at - KST ISO @param {number} now - 지금(ms) @returns {string} 시각 문구
 * [연계] ← collisionNotice / 내일 예보를 오늘 시각으로 오해하지 않게 날짜를 붙인다.
 */
function hourText(at,now){return(at.slice(0,10)===T.isoKst(now).slice(0,10)?'':at.slice(5,7)+'.'+at.slice(8,10)+'. ')+Number(at.slice(11,13))+'시';}
/** 충돌·접촉 주의 안내와 사유를 만든다. 예: 16시 혼잡 '높음'(12.3) 또는 현재 18척 → 안내 1개, 사유 1~2개.
 * 조건A 그 시각 공식 혼잡 예보 '높음' 이상(실제 응답 경계 혼잡지수 10) · 조건B 현재 시각이고 최신 척수 14척 이상(교통량 단계 '주의' 경계).
 * @param {object|null} cf - 선택 시각의 공식 혼잡 예보 @param {object|null} live - 최신 정상 척수(현재 시각일 때만) @param {number} now - 지금(ms)
 * @returns {object} {on,reasons:[{kind,level,value,at}],text}
 * [연계] ← analyze / 사고 단계·지도 색은 바꾸지 않는 앱 안내이며 사고 확률·공단 등급이 아니다.
 */
function collisionNotice(cf,live,now){const reasons=[],parts=[];
    if(cf&&cf.status==='ok'&&NOTICE_CONGESTION.has(cf.level)){reasons.push({kind:'congestion',level:cf.level,value:cf.index,at:cf.forecastAt});parts.push(`${hourText(cf.forecastAt,now)} 혼잡 예보 '${cf.level}'(혼잡지수 ${cf.index})`);}
    if(live&&Number.isFinite(live.count)&&live.count>=NOTICE_COUNT){const at=live.sourceAt||live.collectedAt;reasons.push({kind:'traffic',level:live.level,value:live.count,at});parts.push(`현재 이 해역 선박 ${live.count}척${at?`(${at.slice(11,16)} 기준)`:''}`);}
    return reasons.length?{on:true,reasons,text:`충돌·접촉 주의 — ${parts.join(' · ')}. 배가 붐벼 충돌·접촉에 주의가 필요하다는 앱 안내이며, 사고 확률이나 공식 사고 등급이 아닙니다.`}:{on:false,reasons:[],text:null};}
/** 공식 등급 안에서 원지수의 연속 위치를 구한다. 예: 같은 경계라도 지수가 커지면 더 붉음.
 * @param {array} rows - 공식[i,index,level] @returns {Map} i→0..1 색상위치
 * [연계] ← unifiedFrame / 지수의 큰 규모차만 로그로 표시하며 확률로 해석하지 않는다.
 */
function riskColors(rows){const limits={};for(const r of rows||[]){if(RANK[r[2]]===undefined||!Number.isFinite(r[1]))continue;const l=limits[r[2]]||(limits[r[2]]=[Infinity,-Infinity]);l[0]=Math.min(l[0],r[1]);l[1]=Math.max(l[1],r[1]);}return new Map((rows||[]).map(r=>{const l=limits[r[2]],rank=RANK[r[2]];if(!l)return[r[0],null];const e=Math.max(l[1]*1e-6,1e-16),fraction=l[1]>l[0]?(Math.log(r[1]+e)-Math.log(l[0]+e))/(Math.log(l[1]+e)-Math.log(l[0]+e)):0.5;return[r[0],Math.min(.999999,(rank+Math.max(0,Math.min(1,fraction)))/4)];}));}
/** 읽기 전용 통합 저장소를 만든다. 예: current와 t의 미래 예보는 시각을 별도 보존.
 * @param {object} options - risk 저장소, 폴더·시계·정적자료 주입 @returns {object} 조회 API
 * [연계] ← routes/risk_forecast / 캐시는 자료 버전과 시간으로 제한한다.
 */
function createStore({risk,dir=io.DEFAULT_DIR,clientDir=CLIENT,configDir=path.join(ROOT,'config','coastal_safety'),clock=Date.now,stations:injectedStations,accidents:injectedAccidents,describe=require('./risk_sea_cells').describe}={}){
    if(typeof clock!=='function')throw TypeError('clock function required');
    let live=null,liveSignature='',staticLoaded=false,stations=[],accidents=[],buckets=new Map(),period=null,excludedCount=0,staticAvailable=false,unifiedCache=null,unifiedCacheKey=null,accidentMapping=new Map();
    const historyCache=new Map(),briefCache=new Map(),stationCache=new Map(),spatial=new WeakMap(),frameRows=new WeakMap(),congestionIds=new WeakMap();
    function loadLive(){const file=path.join(dir,'sea_realtime.json.gz');let sign='';try{const s=fs.statSync(file);sign=[s.mtimeMs,s.size,s.ino].join(':');}catch(e){if(e.code!=='ENOENT')throw e;}if(sign!==liveSignature){liveSignature=sign;live=io.read(file);briefCache.clear();}return live;}
    function loadStatic(){if(staticLoaded)return;staticLoaded=true;const sc=injectedStations||io.read(path.join(configDir,'coastguard_stations.geojson'))?.features||[];
        stations=sc.filter(f=>['Polygon','MultiPolygon'].includes(f.geometry?.type)).map((f,i)=>({id:String(i),name:f.properties?.name||'관할 '+i,station:f.properties?.station||'',geometry:f.geometry,bounds:bounds(f.geometry)}));
        const raw=injectedAccidents||io.read(path.join(clientDir,'accident_ships_hk.json'))?.rows||[];staticAvailable=!!raw.length;const latest=raw.reduce((n,r)=>Math.max(n,Number(String(r[2]).slice(0,4))||0),0);period={from:`${latest-4}-01-01`,to:`${latest}-12-31`,source:'앱 기존 선박사고 자료',includedTypes:Object.values(INCIDENTS),excludedTypes:['해양오염','부유물감김'],weatherRule:'기상악화 원인 포함, 제외 유형 우선',available:staticAvailable};
        for(const r of raw){const y=Number(String(r[2]).slice(0,4));if(y<latest-4||y>latest||!Number.isFinite(r[0])||!Number.isFinite(r[1]))continue;if(EXCLUDED.has(r[5])||(!INCIDENTS[r[5]]&&r[6]!=='ACC008')){excludedCount++;continue;}accidents.push(r);const key=Math.floor(r[1]*4)+','+Math.floor(r[0]*4);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(r);}
    }
    function inside(p,b){return p[0]>=b[0]&&p[0]<=b[2]&&p[1]>=b[1]&&p[1]<=b[3];}
    function stationFor(p){loadStatic();const key=p.join(',');if(stationCache.has(key))return stationCache.get(key);const value=stations.filter(s=>inside(p,s.bounds)&&G.pointInGeometry(p,s.geometry)).sort((a,b)=>a.name.localeCompare(b.name,'ko')||a.id.localeCompare(b.id))[0]||null;stationCache.set(key,value);if(stationCache.size>60000)stationCache.delete(stationCache.keys().next().value);return value;}
    function history(geometry,key){loadStatic();if(historyCache.has(key))return historyCache.get(key);const b=bounds(geometry),rows=[];for(let x=Math.floor(b[0]*4);x<=Math.floor(b[2]*4);x++)for(let y=Math.floor(b[1]*4);y<=Math.floor(b[3]*4);y++)for(const r of buckets.get(x+','+y)||[])if(inside([r[1],r[0]],b)&&G.pointInGeometry([r[1],r[0]],geometry))rows.push(r);const result={...summary(rows),...period,excludedCount,accidents:accidentList(rows)};historyCache.set(key,result);if(historyCache.size>20000)historyCache.delete(historyCache.keys().next().value);return result;}
    function input(){loadLive();return risk.marineInputs();}
    function freshness(){const d=loadLive(),attempt=io.read(path.join(dir,'realtime_status.json')),stamp=Date.parse(d?.sourceAt||d?.collectedAt);return{status:!d?'missing':!Number.isFinite(stamp)||clock()-stamp>15*60000||stamp>clock()+5*60000?'stale':attempt?.status==='error'?'error':'ok',sourceAt:d?.sourceAt||null,collectedAt:d?.collectedAt||null,source:d?.source||null,unmapped:d?.unmapped||0,scope:d?.scope||null,timeMeaning:d?.timeMeaning||null};}
    function tables(){const d=loadLive();return{v:d?.v||null,cells:d?.cells||[],status:freshness()};}
    function current(){const d=loadLive();return{v:d?.v||null,cells:(d?.rows||[]).map(r=>[r[0],r[1],r[2],trafficLevel(r[1])]),status:freshness()};}
    /** 현재·혼잡의 공통 GR4 경계만 한 벌로 제공한다. 예: 사고 원본5㎞ 경계를 중복해서 그리지 않는다.
     * @returns {object} v,cells @param 없음
     * [연계] ← routes/risk_forecast / 원본 사고 해상도는 상세에서 보존한다.
     */
    function unifiedCells(){const inputs=input(),cacheKey=liveSignature+':'+inputs.version;if(unifiedCache&&unifiedCacheKey===cacheKey)return unifiedCache;const byId=new Map(),occupied=new Set();for(const c of [...(inputs.cells?.cells||[]),...(live?.cells||[])]){if(!String(c.id).startsWith('GR4_'))continue;byId.set(c.id,{id:c.id,lon:c.lon,lat:c.lat});occupied.add(Math.floor(c.lon*40)+','+Math.floor(c.lat*40));}
        // 교통이 없는 사고예보 해역도 같은0.025도표출망으로 유지한다. 내부표출ID를 공식GR4ID로 위장하지 않는다.
        for(const a of inputs.accident?.cells||[]){const b=bounds(a.geometry);for(let x=Math.floor(b[0]*40);x<=Math.floor(b[2]*40);x++)for(let y=Math.floor(b[1]*40);y<=Math.floor(b[3]*40);y++){const key=x+','+y,lon=(x+.5)/40,lat=(y+.5)/40;if(occupied.has(key)||!G.pointInGeometry([lon,lat],a.geometry))continue;occupied.add(key);const id='display_'+x+'_'+y;byId.set(id,{id,lon,lat,displayOnly:true});}}
        const cells=[...byId.values()].sort((a,b)=>a.id.localeCompare(b.id)).map((c,i)=>({...c,i}));accidentMapping=new Map(cells.map(c=>[c.i,pointCell(inputs.accident?.cells,[c.lon,c.lat])?.i]));unifiedCacheKey=cacheKey;unifiedCache={v:(live?.v||'none')+':'+inputs.version,cells,grid:'GR4-size',accidentResolution:'약5㎞ 원본 사고 격자를0.025도 공통 표출 격자의 중심 위치에 연결. display_ ID는 공식 교통 격자번호가 아님'};return unifiedCache;}
    /** 선택 항목 하나만 GR4 면색으로 표시할 수 있게 수치를 공간 연결한다.
     * 예: 모드 accident/congestion/current, 사고 단계는 원본 그대로 공유. risk(기본)는 현재·미래 모두 공식 사고 예보(2026-10-15 종합 관심단계 폐지).
     * 혼잡 색 위치 경계 0·1·10·20·100 은 실제 응답의 단계 경계다(2026-10-15 운영 혼잡 프레임 10개 46,312칸: 낮음 0.1~1 · 보통 1~9.99 · 높음 10~19.94 · 매우높음 20.02~99.9).
     * 종전 0·5·10·20 은 보통 칸 81.6%(5,120/6,274)를 지수 5 미만이라 같은 색(0.25)으로 눌렀다.
     * current(지금 혼잡도 버튼)는 척수가 아니라 실시간 밀집도 잠정 4단계(densityLevel, 경계 0·1·10·20·100 — 혼잡 색 경계와 같은 배열, 2026-10-16 「그럼 ㄱ으로 하자」)로 칠한다 — 사용자 2026-10-15 「현재기준 조회 시 밀집도를 기준으로 미래 조회시 혼잡도를 기준으로」. 밀집도가 빈 칸은 칠하지 않는다. 칸 숫자(n, 크게 확대했을 때 지도에 찍히는 글자)는 종전대로 척수다.
     * 최신 응답(status ok)에 없는 칸은 배 없음(공단 API 는 배 없는 칸을 안 보냄)이라 「낮음」·n=0·색 0 으로 칠한다(사용자 2026-10-15). 수집이 낡았으면 아무 칸도 칠하지 않는다.
     * @param {string} mode - 지도 항목 @param {string} t - 선택 시각 @returns {object} 프레임
     * [연계] ← RiskForecast / 현재 숫자를 미래 관측으로 바꾸지 않는다.
     */
    function unifiedFrame(mode='risk',t){if(!['risk','accident','congestion','current'].includes(mode))throw Object.assign(Error('지도 항목 오류'),{status:400});const inputs=input(),at=time(t),table=unifiedCells(),status=freshness(),liveById=new Map((live?.rows||[]).map(r=>[live.cells[r[0]].id,r])),accAt=T.isoKst(Math.floor(Date.parse(at)/(3*3600000))*3*3600000),accRows=inputs.accident?.frames?.[forecastKey(accAt)],colorById=riskColors(accRows),result=[];
        for(const c of table.cells){let level=null,n=null,color=null;if(mode==='current'){const r=liveById.get(c.id);if(!r&&status.status==='ok'){level='낮음';n=0;color=0;}   // 최신 응답에 없는 칸 = 배 없음 → 「낮음」(사용자 2026-10-15 「혼잡도에서 배가없는 칸을 낮음으로 색칠해줘」)
            else if(r&&status.status==='ok'){level=densityLevel(r[2]);if(level){n=r[1];const rank=DENSITY_LEVELS.indexOf(level);color=Math.min(.999999,(rank+Math.max(0,Math.min(1,(r[2]-DENSITY_CUTS[rank])/(DENSITY_CUTS[rank+1]-DENSITY_CUTS[rank]))))/4);}}}else if(mode==='congestion'){const r=congestionAt(inputs.congestion,forecastKey(at),c.id);if(r&&inputs.sources.congestion?.status==='ok'){level=r.congestionLevel;n=r.congestionIndex;const cuts=[0,1,10,20,100],rank=RANK[level];color=(rank+Math.max(0,Math.min(1,(n-cuts[rank])/(cuts[rank+1]-cuts[rank]))))/4;}}else{const accidentIndex=accidentMapping.get(c.i),r=accidentIndex!==undefined&&findRow(accRows,accidentIndex,true);if(r&&inputs.sources.accident?.status==='ok'){level=r[2];n=r[1];color=colorById.get(accidentIndex);}}if(level&&Number.isFinite(n)&&Number.isFinite(color))result.push([c.i,n,level,color]);}
        return{v:table.v,cells:result,mode:mode==='risk'?'accident':mode,t:at,forecastAt:mode==='accident'||mode==='risk'?accAt:mode==='congestion'?T.isoKst(Math.floor(Date.parse(at)/3600000)*3600000):null,currentStatus:status,grid:table.grid,accidentResolution:table.accidentResolution};}
    function jurisdictionList(){loadStatic();return{stations:stations.map(({id,name,station})=>({id,name,station}))};}
    /** 해상 통합 조회 시각을 검사한다. 예: 지금-3시간~내일 23:59는 통과, 모레 00시는 400.
     * 끝은 오늘 00시+48시간(앞으로 보기 outlook 의 end 와 같다 — 「해상 공식 사고예보는 2일까지만」 2026-10-15; 종전 지금+72시간).
     * @param {string} value - 선택시각(없으면 지금) @returns {string} KST ISO
     * [연계] ← unifiedFrame/analysis/briefing ← /sea/unified-frame·analysis·briefing / 배포 전 24칸 저장본의 모레 칸을 내보내지 않는다
     */
    function time(value){const stamp=value?Date.parse(value):clock();if(!Number.isFinite(stamp)||stamp<clock()-3*3600000||stamp>=Date.parse(io.day(clock())+'T00:00:00+09:00')+48*3600000)throw Object.assign(Error('조회 시각 범위 오류'),{status:400});return T.isoKst(stamp);}
    function pointCell(cells,p){if(!cells)return null;if(!spatial.has(cells)){const map=new Map();for(const c of cells){const b=c.geometry?bounds(c.geometry):[c.lon-.0125,c.lat-.0125,c.lon+.0125,c.lat+.0125];for(let x=Math.floor(b[0]*10);x<=Math.floor(b[2]*10);x++)for(let y=Math.floor(b[1]*10);y<=Math.floor(b[3]*10);y++){const key=x+','+y;if(!map.has(key))map.set(key,[]);map.get(key).push({c,b});}}spatial.set(cells,map);}return(spatial.get(cells).get(Math.floor(p[0]*10)+','+Math.floor(p[1]*10))||[]).filter(({c,b})=>inside(p,b)&&(!c.geometry||G.pointInGeometry(p,c.geometry))).map(x=>x.c).sort((a,b)=>a.id.localeCompare(b.id))[0]||null;}
    function findRow(rows,id,accident=false){if(!rows)return null;if(!frameRows.has(rows))frameRows.set(rows,new Map(rows.map(r=>[accident?r[0]:r.gridId,r])));return frameRows.get(rows).get(id)||null;}
    function congestionAt(data,key,id){if(!data)return null;if(!congestionIds.has(data))congestionIds.set(data,codec.cellIds(data));return codec.rowAt(data,key,id,congestionIds.get(data));}
    function forecastKey(at){const d=new Date(Date.parse(at)+9*3600000);return d.toISOString().slice(0,10).replace(/-/g,'')+String(d.getUTCHours()).padStart(2,'0')+'00';}
    function congestion(row,c){return row?{gridId:c.id,index:row.congestionIndex,level:row.congestionLevel,forecastAt:T.isoKst(Date.parse(row.fcstDate.slice(0,4)+'-'+row.fcstDate.slice(4,6)+'-'+row.fcstDate.slice(6,8)+'T'+row.fcstTime.slice(0,2)+':00:00+09:00')),createdAt:row.fcstCreateDateTime}:null;}
    function analyze(p,at,inputs){
        const currentCell=pointCell(live?.cells,p),traffic=pointCell(inputs.cells?.cells,p),accidentCell=pointCell(inputs.accident?.cells,p),cell=currentCell||traffic||accidentCell||describe({gridId:'point',latitude:p[1],longitude:p[0]}),liveRow=currentCell&&(live?.rows||[]).find(r=>r[0]===currentCell.i),status=freshness();
        // 공단 실시간 API 는 배가 없는 칸을 보내지 않는다(2026-10-15 운영 응답 3,890칸 중 0척 칸 0개 — 실행 확인). 그래서 최신 응답(status ok)에
        // 이 칸이 없으면 0척·밀집도 0 으로 낸다(사용자 2026-10-15 「수집된 데이터가 없으면 그 격자에 선박이 없다는 말」). 수집이 멈춘(낡은) 때는 모름 → null.
        const emptyId=!liveRow&&status.status==='ok'?(currentCell||traffic)?.id:null;
        const liveData=liveRow?{gridId:currentCell.id,count:liveRow[1],density:liveRow[2],densityLevel:densityLevel(liveRow[2]),level:trafficLevel(liveRow[1]),...status}:emptyId?{gridId:emptyId,count:0,density:0,densityLevel:densityLevel(0),level:trafficLevel(0),absent:true,...status}:null;
        const key=forecastKey(at),congestionRow=traffic&&congestionAt(inputs.congestion,key,traffic.id),cf=congestion(congestionRow,traffic);
        const accAt=T.isoKst(Math.floor(Date.parse(at)/(3*3600000))*3*3600000),ar=accidentCell&&findRow(inputs.accident?.frames?.[forecastKey(accAt)],accidentCell.i,true),af=ar?{gridId:accidentCell.id,index:ar[1],level:ar[2],forecastAt:accAt,createdAt:inputs.accident.createdAt,status:inputs.sources.accident?.status}:null;
        if(cf)cf.status=inputs.sources.congestion?.status;
        const end=Date.parse(io.day(clock())+'T00:00:00+09:00')+48*3600000,upcoming=[];
        if(traffic)for(const k of Object.keys(inputs.congestion?.frames||{})){const r=congestionAt(inputs.congestion,k,traffic.id);if(!r)continue;const c=congestion(r,traffic);if(Date.parse(c.forecastAt)>=Math.floor(Date.parse(at)/3600000)*3600000&&Date.parse(c.forecastAt)<end)upcoming.push(c);}
        upcoming.sort((a,b)=>Date.parse(a.forecastAt)-Date.parse(b.forecastAt));
        const riskTimes=[];if(accidentCell)for(const [k,rows]of Object.entries(inputs.accident?.frames||{})){const r=findRow(rows,accidentCell.i,true);if(!r)continue;const date=k.slice(0,4)+'-'+k.slice(4,6)+'-'+k.slice(6,8)+'T'+k.slice(8,10)+':00:00+09:00';if(Date.parse(date)>=Date.parse(accAt)&&Date.parse(date)<end)riskTimes.push({forecastAt:date,level:r[2],index:r[1]});}riskTimes.sort((a,b)=>Date.parse(a.forecastAt)-Date.parse(b.forecastAt));
        const histCell=accidentCell||currentCell||traffic,stats=histCell?.geometry?{...history(histCell.geometry,'grid:'+histCell.id),gridId:histCell.id,scope:accidentCell?'공식 사고 예보 격자 전체':'선택 교통 격자'}:null;
        const weather=inputs.weather(cell.haegu?.major,at),reasons=[];
        if(liveData&&status.status==='ok')reasons.push({key:'traffic',text:`현재 해당 교통 격자는 ${liveData.count}척, 교통량 단계 ${liveData.level}입니다.`,at:status.sourceAt||status.collectedAt});
        if(af)reasons.push({key:'accident',text:`${af.forecastAt.slice(11,16)} 공식 사고 예보는 ${af.level}입니다.`,at:af.forecastAt,status:af.status});
        if(cf)reasons.push({key:'congestion',text:`${cf.forecastAt.slice(11,16)} 공식 혼잡 예보는 ${cf.level}입니다.`,at:cf.forecastAt,status:cf.status});
        const peak=upcoming.filter(c=>RANK[c.level]>=(RANK[cf?.level]??-1)+1).sort((a,b)=>RANK[b.level]-RANK[a.level]||Date.parse(a.forecastAt)-Date.parse(b.forecastAt))[0];
        if(peak&&inputs.sources.congestion?.status==='ok')reasons.push({key:'increase',text:`${peak.forecastAt.slice(5,10)} ${peak.forecastAt.slice(11,16)}에는 혼잡 ${peak.level} 단계가 예측되어 선택 시각보다 혼잡 증가가 예상됩니다.`,at:peak.forecastAt});
        const riskPeak=riskTimes.find(r=>RANK[r.level]>=2);if(riskPeak&&inputs.sources.accident?.status==='ok')reasons.push({key:'riskWindow',text:`${riskPeak.forecastAt.slice(5,10)} ${riskPeak.forecastAt.slice(11,16)} 공식 사고 예보가 ${riskPeak.level}인 시간대에 운항 시 주의가 필요합니다.`,at:riskPeak.forecastAt});
        if(stats?.count)reasons.push({key:'history',text:`${stats.from.slice(0,4)}~${stats.to.slice(0,4)}년 ${stats.scope}에서 대상 선박사고 ${stats.count}건이 기록되었고, 가장 많은 유형은 ${stats.topTypes[0].type}(${stats.topTypes[0].count}건)입니다.`});
        if(inputs.sources.zoneForecasts?.status==='ok'&&(weather.wh>=2||weather.ws>=12))reasons.push({key:'weather',text:`해구 기상 예보는 ${weather.wh!=null?'유의파고 '+weather.wh+'m ':''}${weather.ws!=null?'풍속 '+weather.ws+'m/s':''}로 기상 변화에 관심이 필요합니다.`,at:weather.forecastAt});
        const notice=collisionNotice(cf,Date.parse(at)<=clock()+60000&&liveData&&status.status==='ok'?liveData:null,clock());
        if(notice.on)reasons.unshift({key:'collision',text:notice.text,at:notice.reasons[0].at});
        const attention=Math.max(notice.on?1:0,af?.status==='ok'&&RANK[af.level]>=2?RANK[af.level]:0,cf?.status==='ok'&&RANK[cf.level]>=2?1:0,liveData&&status.status==='ok'&&liveData.count>=21?1:0,riskPeak&&inputs.sources.accident?.status==='ok'?(RANK[riskPeak.level]||0):0,inputs.sources.zoneForecasts?.status==='ok'&&(weather.wh>=2||weather.ws>=12)?1:0);
        return{location:location(cell),point:{lon:p[0],lat:p[1]},t:at,station:stationFor(p)?.name||null,office:stationFor(p)?.station||null,current:liveData,currentStatus:status,congestion:cf,accident:af,collisionNotice:notice,weather:{...weather,source:'기상청 해구별 예보',status:inputs.sources.zoneForecasts?.status},history:stats,outlook:{congestion:upcoming,accident:riskTimes},attention:['정보 확인','관심 필요','주의 필요','경계 단계 확인 필요'][attention],attentionRank:attention,reasons,scopeNote:'사고 단계와 지도 색은 현재·미래 모두 공식 사고 예보 그대로입니다. 충돌·접촉 주의는 혼잡 예보 높음 이상 또는 현재 14척 이상일 때 붙이는 앱 안내이며 사고 확률이나 공단 등급이 아닙니다. 현재 교통이 누락·낡으면 현재 척수는 사유로 쓰지 않습니다. 앱 사고 통계는 해양오염·부유물감김을 제외합니다.'};
    }
    function analysis({id,lon,lat,t}={}){const inputs=input(),at=time(t);let p;if(lon!==undefined&&lat!==undefined){p=[Number(lon),Number(lat)];if(!p.every(Number.isFinite)||p[0]<115||p[0]>140||p[1]<20||p[1]>45)throw Object.assign(Error('좌표 범위 오류'),{status:400});}else{const c=[...(live?.cells||[]),...(inputs.cells?.cells||[]),...(inputs.accident?.cells||[])].find(c=>c.id===id);if(!c)throw Object.assign(Error('해상 격자 없음'),{status:404});p=[c.lon,c.lat];}const marine=analyze(p,at,inputs);return{t:at,marine,title:marine.location,subtitle:marine.station||'',gridId:id||null,lat:p[1],lon:p[0]};}
    function briefing(id,t){loadStatic();const inputs=input(),at=time(t),s=stations.find(s=>s.id===id);if(!s)throw Object.assign(Error('관할 없음'),{status:404});const key=[id,at,liveSignature,inputs.version,freshness().status].join('|');if(briefCache.has(key))return briefCache.get(key);
        const liveCells=live?.cells||[],byIndex=new Map(liveCells.map(c=>[c.i,c])),rows=(live?.rows||[]).filter(r=>{const c=byIndex.get(r[0]);return c&&stationFor([c.lon,c.lat])?.id===id;});let count=0;
        for(const r of rows)count+=r[1];
        const candidates=new Map();for(const c of [...liveCells,...(inputs.cells?.cells||[]),...(inputs.accident?.cells||[])])if(stationFor([c.lon,c.lat])?.id===id)candidates.set(c.id,c);
        const byRegion=new Map();for(const c of candidates.values()){
            const a=analyze([c.lon,c.lat],at,inputs),group=a.accident?.gridId||c.id,previous=byRegion.get(group);
            if(a.attentionRank>0&&(!previous||a.attentionRank>previous.attentionRank||(a.attentionRank===previous.attentionRank&&(a.current?.count||0)>(previous.current?.count||0))))byRegion.set(group,a);
        }
        const regions=[...byRegion.values()];
        regions.sort((a,b)=>b.attentionRank-a.attentionRank||(b.current?.count||0)-(a.current?.count||0)||a.location.localeCompare(b.location,'ko'));
        const stationAccidents=accidents.filter(r=>stationFor([r[1],r[0]])?.id===id),historySummary={...summary(stationAccidents),...period};
        const status=freshness(),result={station:{id:s.id,name:s.name},t:at,current:live?{count:rows.length?count:null,gridCount:rows.length,...status}:null,history:historySummary,regions:regions.slice(0,20).map(r=>r.history?{...r,history:{...r.history,accidents:undefined}}:r),totalAttentionRegions:regions.length,gridCount:candidates.size,method:'격자 중심이 속한 관할로 배정한 척수 집계. 경계·중복 관할은 이름순 1개에 배정하며 실제 선박 위치 기반 관할 척수가 아닙니다. 수신 격자가 없는 관할은 0척이 아닌 자료 없음으로 표시합니다.',baselineAvailable:false};
        briefCache.set(key,result);while(briefCache.size>8)briefCache.delete(briefCache.keys().next().value);return result;
    }
    return{tables,current,unifiedCells,unifiedFrame,jurisdictionList,analysis,briefing};
}
module.exports={createStore,location,trafficLevel,densityLevel,accidentList,collisionNotice,riskColors,summary,INCIDENTS};
