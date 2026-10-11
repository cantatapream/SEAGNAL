/**
 * 역할: 매월 말일 3일 전에 Gemini 웹검색 행사 주소를 카카오 좌표로 바꿔 최근접 관광지에 연결한다.
 * [연계] 기존 gemini_client(챗봇 공용키)·KAKAO_REST_API_KEY → data/risk_forecast/events_YYYYMM.json.
 * [로드 순서] server.js에서 운영만 start. 새로운 Gemini 호출 상한은 두지 않는다(U77).
 */
'use strict';
const path = require('path');
const fs = require('fs');
const io = require('./risk_collector_io');
const G = require('./risk_geo');
const SPOTS = path.join(__dirname, '..', 'config', 'coastal_safety', 'coastal_spots.json');
/** 행사월을 KST 기준으로 만든다. 예: 2026-10. @param {number} now @returns {string} [연계] ← tick */
function month(now) { return io.day(now).slice(0,7); }
/** 카카오 검색의 주소가 요청한 주소와 같은 시도인지 확인한다. 예: 부산 행사에 서울 좌표를 붙이지 않는다. @param {string} a @param {string} b @returns {boolean} [연계] ← geocode */
function sameProvince(a,b) {
    const aliases={서울:'서울',부산:'부산',대구:'대구',인천:'인천',광주:'광주',대전:'대전',울산:'울산',세종:'세종',경기:'경기',강원:'강원',충북:'충북',충청북:'충북',충남:'충남',충청남:'충남',전북:'전북',전라북:'전북',전남:'전남',전라남:'전남',경북:'경북',경상북:'경북',경남:'경남',경상남:'경남',제주:'제주'};
    const token=s=>String(s||'').replace(/대한민국|\(.*?\)/g,'').trim().split(/\s+/)[0].replace(/특별자치도|특별자치시|광역시|특별시|도$/g,'');
    const left=aliases[token(a)],right=aliases[token(b)];return !!left&&left===right;
}
/** 실제 달력 날짜만 받는다. 예: 2026-02-31은 거부.
 * @param {string} value - YYYY-MM-DD @returns {boolean} 유효 여부 [연계] ← collect
 */
function validDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const stamp=Date.parse(value+'T00:00:00Z');return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===value;}
/** 행사 주소의 장소검색 좌표를 검증한다. 예: 검색결과 없는 주소는 기록하지 않는다. @param {object} event @param {function} fetchImpl @param {string} key @returns {Promise<object>} [연계] ← collect */
async function geocode(event,fetchImpl,key) {
    if(!key)throw new Error('missing key');
    const url=new URL('https://dapi.kakao.com/v2/local/search/keyword.json');url.searchParams.set('query',event.address);url.searchParams.set('size','7');
    const response=await fetchImpl(url.toString(),{headers:{Authorization:'KakaoAK '+key},signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error('HTTP '+response.status);
    const result=await response.json();
    const match=(result.documents||[]).find(d=>sameProvince(event.address,d.address_name||d.road_address_name));
    if(!match)throw new Error('unmatched event');
    const lat=Number(match.y),lon=Number(match.x);
    if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<20||lat>45||lon<115||lon>140)throw new Error('invalid event');
    return {lat,lon,resolvedAddress:match.road_address_name||match.address_name};
}
/** 월별 수집기를 만든다. 예: 시험은 검색·좌표서비스를 주입해 실과금 없이 검증한다. @param {object} options @returns {object} [연계] ← server/검사 */
function createCollector({dir=io.DEFAULT_DIR,clock=Date.now,fetchImpl=fetch,kakaoKey=process.env.KAKAO_REST_API_KEY,search,spots}={}) {
    let running=false,timer=null;
    /** 챗봇과 같은 클라이언트로 공식 행사 원문을 검색한다. 예: googleSearch grounding 출처만 허용. @param {string} target @param {string} province @returns {Promise<object>} [연계] ← collect */
    async function webSearch(target,province) {
        const gemini=require('./gemini_client');
        const result=await gemini.callGeminiRaw({model:'gemini-2.5-flash',caller:'CoastalEvents',contents:`${target} ${province} 해안에서 열리는 축제·대회·해맞이 행사를 공식 지자체/주최기관 웹 원문으로 조사하세요. 이미 취소된 행사, 일반 피서 인파, 내륙/하천 행사는 제외. 장소 좌표는 추정하지 마세요. JSON 객체만 답하세요: {"events":[{"name":"행사명","address":"실제 도로명 또는 지번 전체 주소(시도 포함)","start":"YYYY-MM-DD","end":"YYYY-MM-DD","src":"공식 출처 https URL"}]}. 날짜와 주소를 원문으로 확인할 수 없는 행사는 제외하세요.`,config:{tools:[{googleSearch:{}}]}});
        if(!result.success)throw new Error('network or parse error');
        const response=result.response;
        const text=result.text||response?.text||response?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';
        const value=JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g,''));
        const chunks=response?.candidates?.[0]?.groundingMetadata?.groundingChunks||[];
        return {events:value.events, grounded:chunks.map(c=>c.web?.uri).filter(Boolean)};
    }
    /** 검증된 한 달을 통째로 바꾼다. 예: 주소 실패 한 건이면 기존 정상 파일 유지. @param {string} target @returns {Promise<object>} [연계] ← tick/start */
    async function collect(target=month(clock())) {
        if(running)return{ok:false,error:'collector busy'};const release=io.acquireLock(path.join(dir,'events_collect.lock'));if(!release)return{ok:false,error:'collector busy'};running=true;
        const now=clock();
        try{
            if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(target))throw new Error('invalid event');
            const locations=spots||JSON.parse(fs.readFileSync(SPOTS)).spots;
            const provinces=[...new Set(locations.map(s=>s.sgg_name.split(' ')[0]))];
            const rows=[];
            for(const province of provinces){
                const result=await(search||webSearch)(target,province);
                if(!result||!Array.isArray(result.events)||!Array.isArray(result.grounded))throw new Error('invalid response');
                for(const e of result.events){
                    if(!e||typeof e.name!=='string'||!e.name.trim()||e.name.length>200||typeof e.address!=='string'||e.address.length<8||e.address.length>500||!validDate(e.start)||!validDate(e.end)||e.start>e.end||e.end<target+'-01'||e.start>target+'-31')throw new Error('invalid event');
                    const source=new URL(e.src);if(source.protocol!=='https:'||!result.grounded.includes(e.src))throw new Error('invalid event');
                    const coord=await geocode(e,fetchImpl,kakaoKey);
                    let spot=null,best=Infinity;for(const s of locations){const dist=G.haversine(coord.lat,coord.lon,s.lat,s.lon);if(dist<best){best=dist;spot=s;}}
                    if(!spot)throw new Error('unmatched event');
                    rows.push({name:e.name.trim(),address:e.address,start:e.start,end:e.end,src:e.src,...coord,spotId:spot.sgg+'|'+spot.name,connectionKm:+best.toFixed(3)});
                }
            }
            if(!rows.length)throw new Error('empty response');
            const events=[...new Map(rows.map(e=>[e.name+'|'+e.start+'|'+e.address,e])).values()];
            io.write(path.join(dir,'events_'+target.replace('-','')+'.json'),{month:target,collectedAt:io.iso(now),events});
            io.status(dir,'events',now,null,{month:target,count:events.length});return{ok:true,count:events.length};
        }catch(e){io.status(dir,'events',now,e,{month:target});return{ok:false,error:io.errorName(e)};}
        finally{running=false;release();}
    }
    /** 다음 달 수집 예정 시각을 지났는지 판정한다. 예: 10월29일은 놓친 10월28일 예약을 보충.
     * @param {number} now - KST 기준 입력 @returns {string|null} 예정 월 [연계] ← tick/start
     */
    function dueNext(now){const d=new Date(now+9*3600000),last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();if(d.getUTCDate()<last-3||(d.getUTCDate()===last-3&&d.getUTCHours()*60+d.getUTCMinutes()<200))return null;return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)).toISOString().slice(0,7);}
    /** 예정일 이후03:20에 누락 월을 보충한다. 예: 예정 시각 장애는 다음 날 재시도, 정상 월은 건너뜀.
     * @returns {Promise<object|null>} [연계] ← start / 호출 횟수 상한은 새로 두지 않는다.
     */
    async function tick(){const now=clock(),d=new Date(now+9*3600000),next=dueNext(now);if(!next||d.getUTCHours()!==3||d.getUTCMinutes()!==20)return null;if(io.read(path.join(dir,'events_'+next.replace('-','')+'.json')))return null;return collect(next);}
    /** 운영 기동에서는 이번 달과 예정 시각을 지난 다음 달 누락을 순서대로 보충한다.
     * 예: 개발 자동 호출0, 10월29일 재배포도 11월 예약 누락 방지.
     * @returns {boolean} [연계] ← server.js
     */
    function start(){if(!process.env.FLY_ALLOC_ID||timer)return false;
        (async()=>{const target=month(clock());if(!io.read(path.join(dir,'events_'+target.replace('-','')+'.json')))await collect(target);const next=dueNext(clock());if(next&&!io.read(path.join(dir,'events_'+next.replace('-','')+'.json')))await collect(next);})().catch(e=>io.reportError('events startup',e));
        timer=setInterval(()=>{tick().catch(e=>{io.reportError('events tick',e);try{io.status(dir,'events',clock(),e);}catch(writeError){io.reportError('events status write',writeError);}});},60000);timer.unref();return true;}
    return{collect,tick,start,stop(){if(timer)clearInterval(timer);timer=null;}};
}
const defaultCollector=createCollector();
module.exports={...defaultCollector,createCollector,sameProvince,geocode,validDate};
