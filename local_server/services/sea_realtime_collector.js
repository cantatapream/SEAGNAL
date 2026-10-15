/**
 * 파일명: local_server/services/sea_realtime_collector.js
 * 역할  : 5분마다 전국 최신 교통정보(격자별 척수·밀집도)를 공식 API 로만 수집해 경계와 수치 배열로 원자 저장한다.
 *         MTIS 웹 화면 수집(선종·톤수)은 없앴다 — 사용자 결정 2026-10-15 원문: 「다른쪽에 이용약관에 사용하면 안된다고
 *         써있어서 오토 스크래핑은 하면 안될 것 같아. 이 부분은 코드에서 제외하도록 수정할 수 있도록 해줘.」
 *         「톤수, 선박 종류는 API에서 제공하지않는다고 공식적으로 확인했어. 이용할 수 없을 것 같아.」
 * [연계] server.js → MTIS 공식 realtime API(mtisopenapi) → marine_fusion 읽기 저장소. 격자 경계는 cellBounds 로 계산.
 * [로드 순서] Fly 운영 start만 자동 수집. 과거 교통자료 다운로드·무제한 기록은 하지 않는다.
 */
'use strict';
const path=require('path'),{createHash}=require('crypto'),io=require('./risk_collector_io'),G=require('./risk_geo');
const URL='https://mtisopenapi.komsa.or.kr/api/v2/traffic/realtime';
/** 4단계 원본 ID만 통일한다. 예: F4K23_P4 → GR4_F4K23_P4.
 * @param {unknown} value - 원본 ID @returns {string} 정규 ID
 * [연계] ← readApi / 임의 격자 변환은 하지 않는다.
 */
function gridId(value){const s=String(value??'');if(!/^(?:GR4_)?[A-Z]\d[A-Z]\d{2}_[A-Z]\d$/.test(s))throw Error('invalid response');return s.startsWith('GR4_')?s:'GR4_'+s;}
/** 누락과 실제 0을 구분해 수치를 검사한다. 예: null은 0이 아닌 null.
 * @param {unknown} value - 수치 @param {boolean} integer - 척수 여부 @returns {number|null} 수치
 * [연계] ← readApi / 음수·무한대·밀집도 초과는 거부한다.
 */
function number(value,integer=false){if(value===null||value===undefined||value==='')return null;const n=Number(value);if(!Number.isFinite(n)||n<0||(integer&&!Number.isInteger(n))||(!integer&&n>100))throw Error('invalid response');return n;}
/** GR4 격자번호에서 그 칸의 경위도 상자를 계산한다(4단계 격자, 한 칸 0.025°).
 * 번호 짜임(실측): GR4_ + [8°칸 글자, 가로4열·북서부터] [4°칸 숫자 1~4 = 북서·북동·남서·남동] [1°칸 글자 A~P, 4×4]
 *   [0.5°칸 숫자] [0.25°칸 숫자] _ [0.05°칸 글자 A~Y, 5×5] [0.025°칸 숫자]. 원점은 동경 112°·북위 48°(북서 모서리).
 *   종전에 MTIS 웹에서 받아 운영에 저장한 경계 29,975칸 전부와 네 모서리가 같고, 공공데이터포털 혼잡예보 API 의
 *   중심점 20,010칸 전부와 일치했다(2026-10-15 대조). 웹 화면 접속은 이용약관 때문에 없앴다(사용자 결정 2026-10-15).
 * 예: cellBounds('GR4_F4K23_P4') → [126.525,33.55,126.55,33.575] · 짜임 밖 번호·범위 밖 → null
 * @param {string} id - GR4_ 로 시작하는 정규 ID @returns {number[]|null} [서,남,동,북]
 * [연계] ← readApi(계산 못 하는 줄은 뺀다)·collect(새 칸 위치) / 1/40도 정수로 계산해 소수 누적 오차가 없다.
 */
function cellBounds(id){
    const m=/^GR4_([A-Z])([1-4])([A-P])([1-4])([1-4])_([A-Y])([1-4])$/.exec(String(id));if(!m)return null;
    const L=c=>c.charCodeAt(0)-65,Q=d=>[(Number(d)-1)%2,Math.floor((Number(d)-1)/2)];
    const parts=[[L(m[1])%4,Math.floor(L(m[1])/4),320],[...Q(m[2]),160],[L(m[3])%4,Math.floor(L(m[3])/4),40],[...Q(m[4]),20],[...Q(m[5]),10],[L(m[6])%5,Math.floor(L(m[6])/5),2],[...Q(m[7]),1]];
    let x=112*40,y=48*40;for(const [col,row,size]of parts){x+=col*size;y-=row*size;}
    const b=[x/40,(y-1)/40,(x+1)/40,y/40];
    return b[0]<115||b[2]>140||b[1]<20||b[3]>45?null:b;
}
/** 경위도 상자를 종전 웹 응답과 같은 순서의 폴리곤으로 만든다. 예: [w,s,e,n] → 북서→북동→남동→남서→북서
 * @param {number[]} b - [서,남,동,북] @returns {object} GeoJSON Polygon [연계] ← collect */
function geometry(b){return{type:'Polygon',coordinates:[[[b[0],b[3]],[b[2],b[3]],[b[2],b[1]],[b[0],b[1]],[b[0],b[3]]]]};}
/** 뺀 줄의 사유를 센다. 예: skip(d,'격자번호 형식') → d['격자번호 형식']=1 @param {object} d @param {string} why 고정 문구 @returns {void} [연계] ← readApi */
function skip(d,why){d[why]=(d[why]||0)+1;}
/** 사유 집계를 관리자용 한 줄로 만든다(고정 문구와 숫자뿐 — 키·주소가 섞이지 않는다).
 * 예: summary('API',{'밀집도 범위 밖(척수는 유지)':2}) → 'API 2줄: 밀집도 범위 밖(척수는 유지) 2' @returns {string|null} [연계] ← collect */
function summary(label,d){const k=Object.keys(d||{});if(!k.length)return null;return label+' '+k.reduce((a,x)=>a+d[x],0)+'줄: '+k.map(x=>x+' '+d[x]).join(', ');}
/** API 전체 페이지를 같은 등록시각으로 검증한다. 예: 다른 regDt가 섞이면 정상본 유지.
 * @param {object} options - dir,key,fetchImpl,now @returns {Promise<object>} rows,sourceAt
 * [연계] ← collect / 기본 3필드만 읽고 숨은 선종 필터를 가정하지 않는다.
 */
async function readApi({dir,key,fetchImpl,now}){
    const rows=[],ids=new Set(),dropped={};let total=null,sourceAt=null,page=1,seen=0;
    do{const d=await io.request({dir,name:'realtime',limit:1200,url:URL,key,fetchImpl,now,params:{pageNo:page,numOfRows:7000}}),batch=io.items(d),b=d.response.body;
        const at=String(b.regDt||'');if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(at)||!Number.isFinite(Date.parse(at.replace(' ','T')+'+09:00')))throw Error('invalid response');
        if(total!==null&&(total!==batch.total||sourceAt!==at))throw Error('partial response');total=batch.total;sourceAt=at;
        for(const r of batch.rows){seen++;
            // ★한 줄이 이상하다고 4천 줄 전체를 버리지 않는다(2026-10-15, 하루 넘게 갱신이 멈춘 사고). 그 줄만 빼고 사유를 센다.
            let id,count;try{id=gridId(r.grid_id);}catch(_){skip(dropped,'격자번호 형식');continue;}
            if(!cellBounds(id)){skip(dropped,'격자번호 형식');continue;}/* 위치를 계산할 수 없는 번호는 지도에 놓을 수 없다 */
            try{count=number(r.vmtc,true);}catch(_){count=null;}if(count===null){skip(dropped,'척수 값');continue;}
            if(ids.has(id)){skip(dropped,'격자 중복');continue;}
            let density;try{density=number(r.dnsty);}catch(_){density=null;/* 범위 밖 밀집도는 그 칸만 비우고 척수는 쓴다 */}if(density===null)skip(dropped,'밀집도 범위 밖(척수는 유지)');
            ids.add(id);rows.push({id,count,density});}
        if(++page>100||seen>total)throw Error('partial response');
    }while(seen<total);
    return{rows,dropped,sourceAt:sourceAt.replace(' ','T')+'+09:00'};
}
/** 중복 수집을 막고 최신 한 벌만 저장한다. 예: API 실패·키 없음이면 마지막 정상본을 그대로 둔다.
 * @param {object} options - 주입 가능한 원천·시계 @returns {object} collect,start,stop
 * [연계] ← server.js / io.acquireLock으로 Fly 머신 간 중복 호출을 제한한다.
 */
function createCollector({dir=io.DEFAULT_DIR,key,fetchImpl=fetch,clock=Date.now,describe=require('./risk_sea_cells').describe}={}){
    let running=false,timer=null;const file=path.join(dir,'sea_realtime.json.gz');
    async function collect(){
        if(running)return{ok:false,error:'collector busy'};const release=io.acquireLock(path.join(dir,'realtime_collect.lock'));if(!release)return{ok:false,error:'collector busy'};running=true;
        const now=clock();try{
            const attempt=io.read(path.join(dir,'realtime_status.json'));if(attempt?.lastRun&&Math.floor(Date.parse(attempt.lastRun)/300000)===Math.floor(now/300000))return{ok:true,unchanged:true};
            const old=io.read(file),apiKey=key===undefined?(process.env.MTIS_REALTIME_SERVICE_KEY||require('./sea_accident_collector').accidentKey()):key;
            let basic;try{if(!apiKey)throw Error('missing key');basic=await readApi({dir,key:apiKey,fetchImpl,now});}catch(e){e.detail='API '+(apiKey?io.errorName(e):'키 없음');throw e;}
            const detail=summary('API',basic.dropped);
            let cells=(old?.cells||[]).slice(),known=new Map(cells.map(c=>[c.id,c]));
            // 위치표는 한 번 나온 칸을 번호 그대로 쌓는다. 상한을 넘으면 이번 응답의 칸만으로 다시 만든다
            // (웹 없이도 번호에서 경계를 다시 계산할 수 있으므로 버려도 잃는 것이 없다 — 상한에 막혀 수집이 멈추지 않게).
            if(cells.length+basic.rows.filter(r=>!known.has(r.id)).length>30000){cells=[];known=new Map();}
            for(const r of basic.rows){if(known.has(r.id))continue;const b=cellBounds(r.id),c={...describe({gridId:r.id,latitude:(b[1]+b[3])/2,longitude:(b[0]+b[2])/2},{bounds:b}),geometry:geometry(b),i:cells.length};known.set(r.id,c);cells.push(c);}
            if(cells.length>30000)throw Error('invalid response');
            const rows=basic.rows.map(r=>[known.get(r.id).i,r.count,r.density]);
            if(!rows.length)throw Error('empty response');
            const v=createHash('sha256').update(JSON.stringify(cells)).digest('hex').slice(0,16),data={v,cells,rows,collectedAt:io.iso(now),sourceAt:basic.sourceAt,source:'MTIS realtime API',scope:'lv4 (GR4)',timeMeaning:'API regDt (KST registration time)'};
            io.write(file,data);io.status(dir,'realtime',now,null,{rows:rows.length,detail});return{ok:true,rows:rows.length};
        }catch(e){io.status(dir,'realtime',now,e,{detail:typeof e.detail==='string'?e.detail:null});return{ok:false,error:io.errorName(e)};}finally{running=false;release();}
    }
    function start(){if(!process.env.FLY_ALLOC_ID||timer)return false;collect().catch(e=>io.reportError('realtime start',e));timer=setInterval(()=>collect().catch(e=>io.reportError('realtime tick',e)),60000);timer.unref();return true;}
    return{collect,start,stop(){if(timer)clearInterval(timer);timer=null;}};
}
module.exports={createCollector,gridId,readApi,cellBounds,geometry};module.exports.start=(...args)=>(module.exports.instance||(module.exports.instance=createCollector())).start(...args);
