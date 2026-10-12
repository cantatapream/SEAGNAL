/**
 * 파일명: local_server/services/sea_realtime_collector.js
 * 역할  : 5분마다 전국 최신 교통정보를 수집해 경계와 수치 배열로 원자 저장한다.
 * [연계] server.js → MTIS 공식 realtime API·mtis_live_web → marine_fusion 읽기 저장소.
 * [로드 순서] Fly 운영 start만 자동 수집. 과거 교통자료 다운로드·무제한 기록은 하지 않는다.
 */
'use strict';
const path=require('path'),{createHash}=require('crypto'),io=require('./risk_collector_io'),G=require('./risk_geo');
const URL='https://mtisopenapi.komsa.or.kr/api/v2/traffic/realtime';
/** 4단계 원본 ID만 통일한다. 예: F4K23_P4 → GR4_F4K23_P4.
 * @param {unknown} value - 원본 ID @returns {string} 정규 ID
 * [연계] ← normalizeWeb/readApi / 임의 격자 변환은 하지 않는다.
 */
function gridId(value){const s=String(value??'');if(!/^(?:GR4_)?[A-Z]\d[A-Z]\d{2}_[A-Z]\d$/.test(s))throw Error('invalid response');return s.startsWith('GR4_')?s:'GR4_'+s;}
/** 누락과 실제 0을 구분해 수치를 검사한다. 예: null은 0이 아닌 null.
 * @param {unknown} value - 수치 @param {boolean} integer - 척수 여부 @returns {number|null} 수치
 * [연계] ← normalizeWeb/readApi / 음수·무한대·밀집도 초과는 거부한다.
 */
function number(value,integer=false){if(value===null||value===undefined||value==='')return null;const n=Number(value);if(!Number.isFinite(n)||n<0||(integer&&!Number.isInteger(n))||(!integer&&n>100))throw Error('invalid response');return n;}
/** 실제 경계·선종·톤수와 별도 밀집도를 연결한다. 예: 밀집도 응답이 없으면 null.
 * @param {object} web - 최신 공개웹 응답 @returns {array} cells와 값
 * [연계] ← collect / 필터는 전체 선종·전체 톤수로 고정한다.
 */
function normalizeWeb(web){
    if(web.collection?.type!=='FeatureCollection'||!Array.isArray(web.collection.features)||!web.collection.features.length)throw Error('empty response');
    const density=new Map((Array.isArray(web.densities)?web.densities:[]).map(r=>[gridId(r.gridId),number(r.density)])),ids=new Set();
    return web.collection.features.map(f=>{
        const p=f.properties||{},id=gridId(p.gridId),g=f.geometry,ring=g?.coordinates?.[0];
        if(ids.has(id)||g?.type!=='Polygon'||g.coordinates.length!==1||!Array.isArray(ring)||ring.length<4||ring.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||p[0]<115||p[0]>140||p[1]<20||p[1]>45)||ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1])throw Error('invalid response');ids.add(id);
        const xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]),bounds=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
        const lon=(bounds[0]+bounds[2])/2,lat=(bounds[1]+bounds[3])/2;if(Math.abs(bounds[2]-bounds[0]-.025)>1e-5||Math.abs(bounds[3]-bounds[1]-.025)>1e-5)throw Error('invalid response');
        const count=number(p.shipCount,true),types=Array.from({length:7},(_,i)=>number(p['s'+String(i+1).padStart(3,'0')+'Count'],true)),tons=Array.from({length:10},(_,i)=>number(p['t'+String(i+1).padStart(3,'0')+'Count'],true));
        if(count===null||types.some(x=>x===null)||tons.some(x=>x===null)||types.reduce((a,b)=>a+b,0)!==count||tons.reduce((a,b)=>a+b,0)!==count)throw Error('partial response');
        return{id,lon,lat,geometry:g,bounds,count,density:density.get(id)??null,types,tons};
    });
}
/** API 전체 페이지를 같은 등록시각으로 검증한다. 예: 다른 regDt가 섞이면 정상본 유지.
 * @param {object} options - dir,key,fetchImpl,now @returns {Promise<object>} rows,sourceAt
 * [연계] ← collect / 기본 3필드만 읽고 숨은 선종 필터를 가정하지 않는다.
 */
async function readApi({dir,key,fetchImpl,now}){
    const rows=[],ids=new Set();let total=null,sourceAt=null,page=1;
    do{const d=await io.request({dir,name:'realtime',limit:1200,url:URL,key,fetchImpl,now,params:{pageNo:page,numOfRows:7000}}),batch=io.items(d),b=d.response.body;
        const at=String(b.regDt||'');if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(at)||!Number.isFinite(Date.parse(at.replace(' ','T')+'+09:00')))throw Error('invalid response');
        if(total!==null&&(total!==batch.total||sourceAt!==at))throw Error('partial response');total=batch.total;sourceAt=at;
        for(const r of batch.rows){const id=gridId(r.grid_id),count=number(r.vmtc,true),density=number(r.dnsty);if(ids.has(id)||count===null||density===null)throw Error('partial response');ids.add(id);rows.push({id,count,density});}
        if(++page>100||rows.length>total)throw Error('partial response');
    }while(rows.length<total);
    return{rows,sourceAt:sourceAt.replace(' ','T')+'+09:00'};
}
/** 중복 수집을 막고 최신 한 벌만 저장한다. 예: API 실패 시 최신 웹 전체 선종 조회로 보완.
 * @param {object} options - 주입 가능한 원천·시계 @returns {object} collect,start,stop
 * [연계] ← server.js / io.acquireLock으로 Fly 머신 간 중복 호출을 제한한다.
 */
function createCollector({dir=io.DEFAULT_DIR,key,fetchImpl=fetch,clock=Date.now,webFetch=require('./mtis_live_web').current,describe=require('./risk_sea_cells').describe}={}){
    let running=false,timer=null;const file=path.join(dir,'sea_realtime.json.gz');
    async function collect(){
        if(running)return{ok:false,error:'collector busy'};const release=io.acquireLock(path.join(dir,'realtime_collect.lock'));if(!release)return{ok:false,error:'collector busy'};running=true;
        const now=clock();try{
            const attempt=io.read(path.join(dir,'realtime_status.json'));if(attempt?.lastRun&&Math.floor(Date.parse(attempt.lastRun)/300000)===Math.floor(now/300000))return{ok:true,unchanged:true};
            const old=io.read(file),apiKey=key===undefined?(process.env.MTIS_REALTIME_SERVICE_KEY||require('./sea_accident_collector').accidentKey()):key;
            let basic=null,apiError=null,web=null;try{if(apiKey)basic=await readApi({dir,key:apiKey,fetchImpl,now});}catch(e){apiError=io.errorName(e);}
            try{web=normalizeWeb(await webFetch(fetchImpl,now));}catch(e){if(!basic)throw e;}
            const oldCells=old?.cells||[],known=new Map(oldCells.map(c=>[c.id,c])),cells=oldCells.slice(),webMap=new Map((web||[]).map(r=>[r.id,r]));
            for(const r of web||[]){if(known.has(r.id))continue;const c={...describe({gridId:r.id,latitude:r.lat,longitude:r.lon},{bounds:r.bounds}),geometry:r.geometry,i:cells.length};known.set(r.id,c);cells.push(c);}
            if(cells.length>30000)throw Error('invalid response');
            const rows=(basic?.rows||web||[]).map(r=>{const c=known.get(r.id);if(!c)return null;const rich=webMap.get(r.id),same=rich&&rich.count===r.count;return[c.i,r.count,r.density,...(same?rich.types:Array(7).fill(null)),...(same?rich.tons:Array(10).fill(null))];}).filter(Boolean);
            if(!rows.length)throw Error('empty response');
            const v=createHash('sha256').update(JSON.stringify(cells)).digest('hex').slice(0,16),data={v,cells,rows,collectedAt:io.iso(now),sourceAt:basic?.sourceAt||null,source:basic?'MTIS realtime API + public web statistics':'MTIS public liveSea',typeCollectedAt:web?io.iso(now):null,apiError,unmapped:(basic?.rows||web).length-rows.length,scope:'lv4 / all ship types / all tonnage',timeMeaning:basic?'API regDt (KST registration time)':'live web retrieval time; source observation timestamp unavailable'};
            io.write(file,data);io.status(dir,'realtime',now,null,{rows:rows.length,unmapped:data.unmapped,apiError});return{ok:true,rows:rows.length};
        }catch(e){io.status(dir,'realtime',now,e);return{ok:false,error:io.errorName(e)};}finally{running=false;release();}
    }
    function start(){if(!process.env.FLY_ALLOC_ID||timer)return false;collect().catch(e=>io.reportError('realtime start',e));timer=setInterval(()=>collect().catch(e=>io.reportError('realtime tick',e)),60000);timer.unref();return true;}
    return{collect,start,stop(){if(timer)clearInterval(timer);timer=null;}};
}
module.exports={createCollector,gridId,normalizeWeb,readApi};module.exports.start=(...args)=>(module.exports.instance||(module.exports.instance=createCollector())).start(...args);
