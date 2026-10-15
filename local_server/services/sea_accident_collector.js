/**
 * 파일명: local_server/services/sea_accident_collector.js
 * 역할  : 공식 선박사고 예보 2일(오늘·내일)·3시간 자료를 버전 확인 후 순차 수집하고 작은 배열로 원자 게시한다.
 *         모레(3일째)는 요청도 저장도 하지 않는다(사용자 확정 2026-10-15 「해상 공식 사고예보는 2일까지만」).
 * [연계] server.js → risk_collector_io/mtis_accident_grid(경계 계산, 외부 접속 없음) → data/risk_forecast/sea_accident.json.gz → risk_store
 * [로드 순서] 서버 require 부작용 없음. FLY_ALLOC_ID 운영만 자동수집하며 연안 관광객 계산에는 사용하지 않는다.
 */
'use strict';
const fs=require('fs'),path=require('path'),{createHash}=require('crypto');
const io=require('./risk_collector_io'),T=require('./risk_time');
const URL='https://mtisopenapi.komsa.or.kr/eopt/api/sea-acdnt-risk-fcst-info';
const LEVELS=['낮음','보통','주의','경계'];
/** 사고 전용 키만 읽는다. 예: ROMS 공용키는전혀사용안함.
 * @returns {string} 키 [연계] ← createCollector / 별도 MTIS 포털 승인 필요
 */
function accidentKey(){if(process.env.MTIS_ACCIDENT_SERVICE_KEY)return process.env.MTIS_ACCIDENT_SERVICE_KEY;try{return JSON.parse(fs.readFileSync(path.join(__dirname,'..','data','api_config.json'),'utf8')).MTIS_ACCIDENT_SERVICE_KEY||'';}catch(_){return '';}}
/** KST 날짜의 16개 정시(오늘·내일 3시간 간격)를 만든다. 예: 10-11 15시 → 10-11 00시부터 10-12 21시까지, 모레 00시는 없음.
 * @param {number} now - 기준시각 @returns {array} [YYYYMMDD,HHmm,key,ISO] [연계] ← collect/complete/start · risk_store meta.timeline.accident / 2일 제한(2026-10-15)의 유일한 자리
 */
function slots(now){const base=Date.parse(io.day(now)+'T00:00:00+09:00');return Array.from({length:16},(_,i)=>{const at=base+i*3*T.HOUR,d=new Date(at+9*T.HOUR),date=io.day(at).replace(/-/g,''),time=String(d.getUTCHours()).padStart(2,'0')+'00';return{date,time,key:date+time,at:T.isoKst(at)};});}
/** 공식 지수·단계를 그대로 검증한다. 예: 0.001 경계는확률/자체순위로변환안함.
 * @param {object} r - 공식행 @returns {object} 필요한7개필드 [연계] ← collect / 기상 필드 폐기
 */
function normalize(r){
    const id=String(r.gridId??''),lat=Number(r.latitude),lon=Number(r.longitude),index=Number(r.accidentRiskIndex),date=String(r.fcstDate||''),time=String(r.fcstTime||'').padStart(4,'0'),created=String(r.fcstCreateDateTime||'');
    if(!/^\d+$/.test(id)||[r.latitude,r.longitude,r.accidentRiskIndex].some(x=>!['number','string'].includes(typeof x)||(typeof x==='string'&&!x.trim()))||!Number.isFinite(lat)||lat<20||lat>45||!Number.isFinite(lon)||lon<115||lon>140||!Number.isFinite(index)||index<0||!LEVELS.includes(r.accidentRiskLevel)||!/^\d{8}$/.test(date)||! /^(?:00|03|06|09|12|15|18|21)00$/.test(time)||!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(created)||!Number.isFinite(Date.parse(created.replace(' ','T')+'+09:00')))throw new Error('invalid response');
    return{gridId:id,latitude:lat,longitude:lon,accidentRiskIndex:index,accidentRiskLevel:r.accidentRiskLevel,fcstDate:date,fcstTime:time,fcstCreateDateTime:created.replace(' ','T')+'+09:00'};
}
/** 공식 페이지 응답을 읽는다. 예: body/items/item은공용검증기와같은계약.
 * @param {object} data - JSON @returns {object} rows,total [연계] ← readFrame / 실제원문형식미확인은거부
 */
function items(data){return io.items(data);}
/** 저장된 격자 번호·좌표·경계를 검사한다. 예: 빈Polygon은경계재수집대상.
 * @param {object} c - 격자 @param {number} i - 순번 @returns {boolean} 유효격자
 * [연계] ← complete/collect / 손상경계를재사용하지않는다
 */
function validCell(c,i){const ring=c?.geometry?.coordinates?.[0];return !!c&&c.i===i&&typeof c.id==='string'&&/^\d+$/.test(c.id)&&Number.isFinite(c.lat)&&c.lat>=20&&c.lat<=45&&Number.isFinite(c.lon)&&c.lon>=115&&c.lon<=140&&c.geometry?.type==='Polygon'&&c.geometry.coordinates.length===1&&Array.isArray(ring)&&ring.length>=4&&ring.every(p=>Array.isArray(p)&&p.length===2&&Number.isFinite(p[0])&&p[0]>=115&&p[0]<=140&&Number.isFinite(p[1])&&p[1]>=20&&p[1]<=45)&&ring[0][0]===ring.at(-1)[0]&&ring[0][1]===ring.at(-1)[1];}
/** 저장본의 16개 정시가 같은 전체 격자를 담았는지 검사한다. 예: 빈16개배열은완료본이아님; 2일 제한 전의 24칸 저장본도 칸 수가 달라 완료본이 아니다(전체 재수집).
 * @param {object} data - 저장본 @param {array} times - 기대정시 @returns {boolean} 재사용가능
 * [연계] ← collect/start / 손상저장본이unchanged로영구고정되지않게한다
 */
function complete(data,times){
    if(!Array.isArray(data?.cells)||!data.cells.length||typeof data.v!=='string'||!data.v||!data.frames||Object.keys(data.frames).length!==times.length)return false;
    const ids=new Set();
    for(const [i,c]of data.cells.entries()){
        if(!validCell(c,i)||ids.has(c.id))return false;
        ids.add(c.id);
    }
    return times.every(slot=>{const rows=data.frames[slot.key];if(!Array.isArray(rows)||rows.length!==data.cells.length)return false;const indices=new Set();for(const r of rows){if(!Array.isArray(r)||r.length!==3||!Number.isInteger(r[0])||r[0]<0||r[0]>=data.cells.length||indices.has(r[0])||!Number.isFinite(r[1])||r[1]<0||!LEVELS.includes(r[2]))return false;indices.add(r[0]);}return true;});
}
/** 독립 수집기를 만든다. 예: 검사에서는키·시각·HTTP·경계를주입.
 * @param {object} options - dir/fetchImpl/key/clock/geometryLoader(rows→칸, 기본은 중심점에서 경계 계산)/limit @returns {object} 실행함수
 * [연계] ← server.js / 하루기본90건보수적상한, 공식허용량확인은별도
 */
function createCollector({dir=io.DEFAULT_DIR,fetchImpl,key,clock=Date.now,geometryLoader=require('./mtis_accident_grid').cells,limit=90}={}){
    let running=false,timer=null,lastSlot=null;
    const file=path.join(dir,'sea_accident.json.gz');
    /** 한 시각 전체페이지를 순차검증한다. 예: 중복ID·변경된총건수·혼합작성시각거부.
     * @param {object} slot - 예보정시 @param {number} count - 페이지크기 @returns {Promise<array>} 공식행
     * [연계] ← collect / 큰원문16개를함께보관하지않음
     */
    async function readFrame(slot,count=7000){let total,page=1;const rows=[];do{
        const batch=items(await io.request({dir,name:'accident',limit,url:URL,fetchImpl,key:key===undefined?accidentKey():key,now:clock(),params:{fcstDate:slot.date,fcstTime:slot.time,pageNo:page,numOfRows:count}}));
        if(total!==undefined&&total!==batch.total)throw new Error('partial response');total=batch.total;
        for(const item of batch.rows){const r=normalize(item);if(r.fcstDate!==slot.date||r.fcstTime!==slot.time)throw new Error('invalid response');rows.push(r);}page++;
    }while(rows.length<total);
    if(rows.length!==total||new Set(rows.map(r=>r.gridId)).size!==rows.length||new Set(rows.map(r=>r.fcstCreateDateTime)).size!==1)throw new Error('partial response');return rows;}
    /** 새 생성본만 모아서 한번 게시한다. 예: 16개중하나실패해도마지막정상본은그대로.
     * @returns {Promise<object>} 결과 [연계] ← tick/start / 버전원자교체
     */
    async function collect(){if(running)return{ok:false,error:'collector busy'};const release=io.acquireLock(path.join(dir,'accident_collect.lock'));if(!release)return{ok:false,error:'collector busy'};running=true;
        const now=clock(),date=io.day(now);
        try{
            if(!Number.isInteger(limit)||limit<1)throw new Error('invalid response');
            const times=slots(now),probeSlot=times.find(s=>Date.parse(s.at)<=now&&Date.parse(s.at)+3*T.HOUR>now)||times[0],probe=items(await io.request({dir,name:'accident',limit,url:URL,fetchImpl,key:key===undefined?accidentKey():key,now:clock(),params:{fcstDate:probeSlot.date,fcstTime:probeSlot.time,pageNo:1,numOfRows:1}})),probeRow=normalize(probe.rows[0]),createdAt=probeRow.fcstCreateDateTime,old=io.read(file);
            if(probeRow.fcstDate!==probeSlot.date||probeRow.fcstTime!==probeSlot.time)throw new Error('invalid response');
            if(old?.date===date&&old.createdAt===createdAt&&complete(old,times)){io.status(dir,'accident',now,null,{date,createdAt,checkedAt:io.iso(now),framesReady:times.length,callCap:limit});return{ok:true,unchanged:true,frames:times.length};}
            if(old?.createdAt&&Date.parse(createdAt)<Date.parse(old.createdAt))throw new Error('invalid response');
            let cells=null,ids=null,version=null;const frames={};
            for(const slot of times){
                const rows=await readFrame(slot);
                if(rows.some(r=>r.fcstCreateDateTime!==createdAt))throw new Error('partial response');
                if(!cells){
                    const sorted=rows.slice().sort((a,b)=>Number(a.gridId)-Number(b.gridId));
                    const oldMap=new Map((Array.isArray(old?.cells)?old.cells:[]).filter(validCell).map(c=>[c.id,c]));
                    const reusable=sorted.every(r=>{const c=oldMap.get(r.gridId);return c?.geometry&&Math.abs(c.lat-r.latitude)<=1e-5&&Math.abs(c.lon-r.longitude)<=1e-5;});
                    cells=reusable?sorted.map((r,i)=>({...oldMap.get(r.gridId),i})):await geometryLoader(sorted);
                    if(!Array.isArray(cells)||cells.length!==sorted.length||cells.some((c,i)=>c.id!==sorted[i].gridId||c.i!==i||!c.geometry))throw new Error('invalid response');
                    ids=new Map(cells.map(c=>[c.id,c]));version=createHash('sha256').update(JSON.stringify(cells)).digest('hex').slice(0,16);
                }
                if(rows.length!==cells.length)throw new Error('partial response');
                const values=rows.map(r=>{const c=ids.get(r.gridId);if(!c||Math.abs(c.lat-r.latitude)>1e-5||Math.abs(c.lon-r.longitude)>1e-5)throw new Error('partial response');return[c.i,r.accidentRiskIndex,r.accidentRiskLevel];});
                frames[slot.key]=values;
            }
            io.write(file,{date,collectedAt:io.iso(now),createdAt,v:version,geometrySource:'computed from API centers (EPSG:3857 5km grid)',cells,frames});
            io.status(dir,'accident',now,null,{date,createdAt,checkedAt:io.iso(now),framesReady:times.length,callCap:limit});return{ok:true,frames:times.length,cells:cells.length};
        }catch(e){io.status(dir,'accident',now,e,{date,checkedAt:io.iso(now),callCap:limit});return{ok:false,error:io.errorName(e)};}finally{running=false;release();}
    }
    /** 배포창뒤와1시간후재시도에버전을확인한다. 예:03:10/04:10/15:10/16:10.
     * @returns {Promise<object|null>} 결과 [연계] ← start / 매분중복호출금지
     */
    async function tick(){const n=new Date(clock()+9*T.HOUR),h=n.getUTCHours(),m=n.getUTCMinutes(),slot=io.day(clock())+'-'+h;
        if(m!==10||![3,4,15,16].includes(h)||lastSlot===slot)return null;lastSlot=slot;return collect();}
    /** Fly운영만누락본을최초수집한다. 예: 개발서버호출0.
     * @returns {boolean} 시작여부 [연계] ← server.js / 자동수집기생명주기
     */
    function start(){if(!process.env.FLY_ALLOC_ID||timer)return false;const current=io.read(file),attempt=io.read(path.join(dir,'accident_status.json')),now=clock(),hour=new Date(now+9*T.HOUR).getUTCHours(),base=Date.parse(io.day(now)+'T00:00:00+09:00'),window=base+(hour>=15?15:hour>=3?3:-9)*T.HOUR;
        if(!complete(current,slots(now))||current.date!==io.day(now)||attempt?.status!=='ok'||!attempt?.checkedAt||Date.parse(attempt.checkedAt)<window)collect().catch(e=>io.reportError('accident startup',e));timer=setInterval(()=>tick().catch(e=>io.reportError('accident tick',e)),60000);timer.unref();return true;}
    return{collect,tick,start,stop(){if(timer)clearInterval(timer);timer=null;}};
}
module.exports={...createCollector(),createCollector,normalize,slots,items,accidentKey,LEVELS};
