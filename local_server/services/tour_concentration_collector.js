/**
 * 역할: 관광지 집중률을 시군구·이름·날짜에 연결하고 첫 주 갱신 관측 구간을 기록한다.
 * [연계] ROMS_SERVICE_KEY·coastal_spots.json → tour_concentration.json(수집일~+2일만 보관 — 「가」 2026-10-15) 및 tour_concentration_observations.json.
 * [로드 순서] 운영 server.js만 자동 수집. 실패·빈 응답·누락 페이지는 정상 캐시를 보존한다.
 */
'use strict';
const fs=require('fs'),path=require('path'),{createHash}=require('crypto'),io=require('./risk_collector_io');
const URL='https://apis.data.go.kr/B551011/TatsCnctrRateService/tatsCnctrRatedList';
/** 원천 행의 날짜·집중률을 엄격히 확인한다. 예: 숫자 없는 행을0으로 바꾸지 않음. @param {object} row @param {string} sgg @returns {object} [연계] ← collect */
function normalize(row,sgg){const name=row.tAtsNm,date=String(row.baseYmd||'').replace(/-/g,''),cr=row.cnctrRate;
    if(typeof name!=='string'||!name||!/^\d{8}$/.test(date)||cr===null||cr===''||cr===undefined||!Number.isFinite(Number(cr))||Number(cr)<0||Number(cr)>100)throw new Error('invalid response');
    const day=date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6,8);if(new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day)throw new Error('invalid response');
    return{id:sgg+'|'+name,date:day,cr:Number(cr)};}
/** 값의 순서가 달라도 같은 원천을 같은 해시로 만든다. 예: API행 순서변경은갱신관측으로세지않는다.
 * @param {object} values - 관광지/날짜별집중률 @returns {object} hash/entries/dates
 * [연계] ← recordObservation / 첫주갱신관측을비교한다.
 */
function valueSnapshot(values){const entries={};for(const id of Object.keys(values||{}).sort())for(const date of Object.keys(values[id]).sort())entries[id+'@'+date]=values[id][date];return{entries,hash:createHash('sha256').update(JSON.stringify(entries)).digest('hex'),dates:[...new Set(Object.keys(values||{}).flatMap(id=>Object.keys(values[id])))].sort()};}
/** 첫7일의원천변경과관측구간을영속기록한다. 예:06:20값10→12:20값25이면변경구간은두수집사이.
 * @param {string} dir - 전용폴더 @param {number} now - 완료시각 @param {string} firstRun - 첫성공ISO
 * @param {object|null} previous - 이전정상파일 @param {object} next - 새정상자료
 * @returns {object|null} 상태요약 [연계] ← collect / 원천의정확한갱신시각이라고추정하지않는다.
 */
function recordObservation(dir,now,firstRun,previous,next){const start=Date.parse(firstRun),end=start+7*86400000;if(!Number.isFinite(start)||now>=end)return null;
    const file=path.join(dir,'tour_concentration_observations.json'),before=previous?valueSnapshot(previous.values):null,after=valueSnapshot(next.values),changed=before?before.hash!==after.hash:null;
    const added=Object.keys(after.entries).filter(k=>!Object.hasOwn(before?.entries||{},k)).length,removed=Object.keys(before?.entries||{}).filter(k=>!Object.hasOwn(after.entries,k)).length,updated=Object.keys(after.entries).filter(k=>Object.hasOwn(before?.entries||{},k)&&before.entries[k]!==after.entries[k]).length;
    const old=io.read(file),samples=old?.firstRun===firstRun&&Array.isArray(old.samples)?old.samples:[];
    const sample={observedAt:io.iso(now),hash:after.hash,sourceDates:after.dates,spotsMatched:Object.keys(next.values).length,changed,changes:{added,removed,updated},...(changed?{changeWindow:{after:previous.collectedAt,beforeOrAt:io.iso(now)}}:{})};
    const unique=samples.filter(s=>s.observedAt!==sample.observedAt);unique.push(sample);const kept=unique.length>64?[unique[0],...unique.slice(-63)]:unique;
    const result={firstRun,windowEndsAt:io.iso(end),samples:kept};io.write(file,result);
    return{firstRun,windowEndsAt:result.windowEndsAt,samples:kept.length,lastObservedAt:sample.observedAt,lastChangedAt:[...kept].reverse().find(s=>s.changed)?.observedAt||null};
}
/** 연안 2일 표출에 필요한 날짜만 남긴다(사용자 확정 2026-10-15 「가」 — 2일 이후 자료는 보관하지 않는다).
 * 원천은 날짜 조건 없이 오늘부터 약30일을 주므로(설계서 §2) 받은 뒤 저장 전에 거른다. 남기는 범위는 수집일~+2일:
 * 이 파일은 다음 정상 수집(다음날06:20)까지 쓰이므로, 그 전 새벽(00~06시)에도 「오늘·내일」=수집일+1·+2가 필요하다.
 * 예: 10-11 수집 → 10-11·10-12·10-13만; 10-10(지난 날)·10-14 이후는 버림.
 * @param {object} values - {관광지id:{YYYY-MM-DD:집중률}} @param {number} now - 수집 완료 ms
 * @returns {object} 범위 안 날짜만 남은 values(남은 날짜가 없는 관광지는 뺌)
 * [연계] ← collect / risk_store.coastDetail 은 그 칸의 KST 날짜 값만 읽는다.
 */
function keepTwoDays(values,now){const first=io.day(now),last=io.day(now+2*86400000),out={};
    for(const [id,dates]of Object.entries(values)){const kept=Object.fromEntries(Object.entries(dates).filter(([d])=>d>=first&&d<=last));if(Object.keys(kept).length)out[id]=kept;}
    return out;}
/** 주입 가능한 수집기를 만든다. 예: 테스트 임시폴더/가짜HTTP. @param {object} options @returns {object} [연계] ← server/검사 */
function createCollector({dir=io.DEFAULT_DIR,clock=Date.now,fetchImpl,key,spots}={}){let running=false,timer=null;
    const file=path.join(dir,'tour_concentration.json');
    /** 모든 시군구 성공 후만 정상 파일을 바꾼다. 예: 마지막페이지 실패도 기존파일유지. @returns {Promise<object>} [연계] ← tick/start */
    async function collect(){if(running)return{ok:false,error:'collector busy'};const release=io.acquireLock(path.join(dir,'tourConcentration_collect.lock'));if(!release)return{ok:false,error:'collector busy'};running=true;const now=clock();try{
        const locations=spots||JSON.parse(fs.readFileSync(path.join(__dirname,'..','config','coastal_safety','coastal_spots.json'))).spots;
        const ids=new Set(locations.map(p=>p.sgg+'|'+p.name)),sggs=[...new Set(locations.map(p=>String(p.sgg)))],values={},seen=new Set();
        for(const sgg of sggs){let count=0,total=null,pageNo=1;do{
            const data=await io.request({dir,name:'tourConcentration',limit:900,url:URL,key,fetchImpl,now:clock(),params:{MobileOS:'ETC',MobileApp:'SEAGNAL',_type:'json',areaCd:sgg.slice(0,2),signguCd:sgg,pageNo,numOfRows:1000}});
            const batch=io.items(data);if(total!==null&&total!==batch.total)throw new Error('partial response');total=batch.total;
            for(const row of batch.rows){const r=normalize(row,sgg),entry=r.id+'|'+r.date;if(seen.has(entry))throw new Error('partial response');seen.add(entry);if(ids.has(r.id)){const dates=values[r.id]||(values[r.id]={});dates[r.date]=r.cr;}}
            count+=batch.rows.length;pageNo++;
        }while(count<total);if(count!==total)throw new Error('partial response');}
        const finished=clock(),kept=keepTwoDays(values,finished);
        if(!Object.keys(kept).length)throw new Error('empty response');
        const prior=io.read(file),previous=io.read(path.join(dir,'tourConcentration_status.json')),firstRun=previous?.firstRun||io.iso(finished),next={date:io.day(finished),collectedAt:io.iso(finished),values:kept};
        const observation=recordObservation(dir,finished,firstRun,prior,next);io.write(file,next);io.status(dir,'tourConcentration',finished,null,{date:next.date,spotsMatched:Object.keys(kept).length,spotsTotal:locations.length,firstRun,...(observation?{observation}:{})});return{ok:true,matched:Object.keys(kept).length};
    }catch(e){io.status(dir,'tourConcentration',now,e);return{ok:false,error:io.errorName(e)};}finally{running=false;release();}}
    /** 일1회, 첫주에는 갱신시각확인용12:20을 추가한다. 예: 최초성공7일 뒤06:20만. @returns {Promise<object|null>} [연계] ← start */
    async function tick(){const now=clock(),local=new Date(now+9*3600000),h=local.getUTCHours(),m=local.getUTCMinutes(),state=io.read(path.join(dir,'tourConcentration_status.json'));if(m!==20||!(h===6||(h===12&&(!state?.firstRun||now-Date.parse(state.firstRun)<7*86400000))))return null;if(state?.lastRun&&now-Date.parse(state.lastRun)<60000)return null;return collect();}
    /** 운영만 자동 실행한다. 예: 개발에서 외부호출0. @returns {boolean} [연계] ← server.js */
    function start(){if(!process.env.FLY_ALLOC_ID||timer)return false;const data=io.read(file);if(!data||data.date!==io.day(clock()))collect().catch(e=>io.reportError('tourConcentration startup',e));timer=setInterval(()=>{tick().catch(e=>{io.reportError('tourConcentration tick',e);try{io.status(dir,'tourConcentration',clock(),e);}catch(writeError){io.reportError('tourConcentration status write',writeError);}});},60000);timer.unref();return true;}
    return{collect,tick,start,stop(){if(timer)clearInterval(timer);timer=null;}};}
const defaultCollector=createCollector();module.exports={...defaultCollector,createCollector,normalize,keepTwoDays};
