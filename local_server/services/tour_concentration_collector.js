/**
 * 역할: 관광지 집중률을 시군구별로 모아 동일 시군구·이름과 날짜에 연결한다.
 * [연계] ROMS_SERVICE_KEY 공용 설정·coastal_spots.json → data/risk_forecast/tour_concentration.json.
 * [로드 순서] 운영 server.js만 자동 수집. 실패·빈 응답·누락 페이지는 정상 캐시를 보존한다.
 */
'use strict';
const fs=require('fs'),path=require('path'),io=require('./risk_collector_io');
const URL='https://apis.data.go.kr/B551011/TatsCnctrRateService/tatsCnctrRatedList';
/** 원천 행의 날짜·집중률을 엄격히 확인한다. 예: 숫자 없는 행을0으로 바꾸지 않음. @param {object} row @param {string} sgg @returns {object} [연계] ← collect */
function normalize(row,sgg){const name=row.tAtsNm,date=String(row.baseYmd||'').replace(/-/g,''),cr=row.cnctrRate;
    if(typeof name!=='string'||!name||!/^\d{8}$/.test(date)||cr===null||cr===''||cr===undefined||!Number.isFinite(Number(cr))||Number(cr)<0||Number(cr)>100)throw new Error('invalid response');
    const day=date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6,8);if(new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day)throw new Error('invalid response');
    return{id:sgg+'|'+name,date:day,cr:Number(cr)};}
/** 주입 가능한 수집기를 만든다. 예: 테스트 임시폴더/가짜HTTP. @param {object} options @returns {object} [연계] ← server/검사 */
function createCollector({dir=io.DEFAULT_DIR,clock=Date.now,fetchImpl,key,spots}={}){let running=false,timer=null;
    const file=path.join(dir,'tour_concentration.json');
    /** 모든 시군구 성공 후만 정상 파일을 바꾼다. 예: 마지막페이지 실패도 기존파일유지. @returns {Promise<object>} [연계] ← tick/start */
    async function collect(){if(running)return{ok:false,error:'collector busy'};const release=io.acquireLock(path.join(dir,'tourConcentration_collect.lock'));if(!release)return{ok:false,error:'collector busy'};running=true;const now=clock();try{
        const locations=spots||JSON.parse(fs.readFileSync(path.join(__dirname,'..','config','coastal_safety','coastal_spots.json'))).spots;
        const ids=new Set(locations.map(p=>p.sgg+'|'+p.name)),sggs=[...new Set(locations.map(p=>String(p.sgg)))],values={};
        for(const sgg of sggs){let count=0,total=null,pageNo=1;do{
            const data=await io.request({dir,name:'tourConcentration',limit:900,url:URL,key,fetchImpl,now:clock(),params:{MobileOS:'ETC',MobileApp:'SEAGNAL',_type:'json',areaCd:sgg.slice(0,2),signguCd:sgg,pageNo,numOfRows:1000}});
            const batch=io.items(data);if(total!==null&&total!==batch.total)throw new Error('partial response');total=batch.total;
            for(const row of batch.rows){const r=normalize(row,sgg);if(ids.has(r.id)){const dates=values[r.id]||(values[r.id]={});if(Object.hasOwn(dates,r.date)&&dates[r.date]!==r.cr)throw new Error('partial response');dates[r.date]=r.cr;}}
            count+=batch.rows.length;pageNo++;
        }while(count<total);if(count!==total)throw new Error('partial response');}
        if(!Object.keys(values).length)throw new Error('empty response');
        io.write(file,{date:io.day(now),collectedAt:io.iso(now),values});const previous=io.read(path.join(dir,'tourConcentration_status.json'));io.status(dir,'tourConcentration',now,null,{date:io.day(now),spotsMatched:Object.keys(values).length,spotsTotal:locations.length,firstRun:previous?.firstRun||io.iso(now)});return{ok:true,matched:Object.keys(values).length};
    }catch(e){io.status(dir,'tourConcentration',now,e);return{ok:false,error:io.errorName(e)};}finally{running=false;release();}}
    /** 일1회, 첫주에는 갱신시각확인용12:20을 추가한다. 예: 최초성공7일 뒤06:20만. @returns {Promise<object|null>} [연계] ← start */
    async function tick(){const now=clock(),local=new Date(now+9*3600000),h=local.getUTCHours(),m=local.getUTCMinutes(),state=io.read(path.join(dir,'tourConcentration_status.json'));if(m!==20||!(h===6||(h===12&&(!state?.firstRun||now-Date.parse(state.firstRun)<7*86400000))))return null;if(state?.lastRun&&now-Date.parse(state.lastRun)<60000)return null;return collect();}
    /** 운영만 자동 실행한다. 예: 개발에서 외부호출0. @returns {boolean} [연계] ← server.js */
    function start(){if(!process.env.FLY_ALLOC_ID||timer)return false;const data=io.read(file);if(!data||data.date!==io.day(clock()))collect().catch(e=>io.reportError('tourConcentration startup',e));timer=setInterval(()=>{tick().catch(e=>{io.reportError('tourConcentration tick',e);try{io.status(dir,'tourConcentration',clock(),e);}catch(writeError){io.reportError('tourConcentration status write',writeError);}});},60000);timer.unref();return true;}
    return{collect,tick,start,stop(){if(timer)clearInterval(timer);timer=null;}};}
const defaultCollector=createCollector();module.exports={...defaultCollector,createCollector,normalize};
