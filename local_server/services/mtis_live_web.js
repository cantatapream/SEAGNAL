/**
 * 파일명: local_server/services/mtis_live_web.js
 * 역할  : MTIS 공개 지도에서 최신 격자·선종·톤수·밀집도만 읽는다.
 * [연계] sea_realtime_collector → 새 익명 세션의 공개 조회; 과거자료·사용자 쿠키는 사용하지 않는다.
 * [로드 순서] 서버 require 부작용 없음. TLS·타임아웃을 유지한다.
 */
'use strict';
const ORIGIN='https://mtis.komsa.or.kr';
/** 공개 지도 세션을 메모리 안에서 만들고 최신 조회 두 개를 수행한다.
 * 예: shipTypes 7종·tonTypes 10종 전체, lv4 현재 조회.
 * @param {function} fetchImpl - 정상 HTTPS fetch @param {number} now - 조회 시각
 * @returns {Promise<object>} collection,densities,collectedAt
 * [연계] ← sea_realtime_collector.collect / 익명 CSRF는 저장·출력하지 않는다.
 */
async function current(fetchImpl=fetch,now=Date.now()){
    const page=await fetchImpl(ORIGIN+'/traffic/liveSea',{signal:AbortSignal.timeout(30000)});
    if(!page.ok)throw Error('HTTP '+page.status);
    const html=await page.text(),meta={};
    for(const m of html.matchAll(/<meta\b[^>]*>/gi)){const attrs={};for(const a of m[0].matchAll(/([\w-]+)\s*=\s*['"]([^'"]*)['"]/g))attrs[a[1]]=a[2];if(attrs.name)meta[attrs.name]=attrs.content;}
    if(!meta._csrf||!/^x[-\w]+$/i.test(meta._csrf_header||''))throw Error('invalid response');
    const cookies=(page.headers.getSetCookie?.()||[]).map(c=>c.split(';')[0]).join('; ');
    const local=new Date(now+9*3600000),body={stdrDe:local.toISOString().slice(0,10).replace(/-/g,''),stdrTime:String(local.getUTCHours()).padStart(2,'0'),gridLevel:'lv4',shipTypes:Array.from({length:7},(_,i)=>'S'+String(i+1).padStart(3,'0')),tonTypes:Array.from({length:10},(_,i)=>'T'+String(i+1).padStart(3,'0')),isNowTime:true};
    const headers={'Content-Type':'application/json',Accept:'application/json','X-Requested-With':'XMLHttpRequest',Origin:ORIGIN,Referer:ORIGIN+'/traffic/liveSea',Cookie:cookies,[meta._csrf_header]:meta._csrf};
    const post=async name=>{const r=await fetchImpl(ORIGIN+'/traffic/liveSea/'+name,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('HTTP '+r.status);let d=await r.json();if(typeof d==='string')d=JSON.parse(d.replace(/&quot;/g,'"'));return d;};
    const collection=await post('listViewTrafficVolumeStatistics');
    let densities=null;try{densities=await post('listViewTrafficDensities');}catch(e){require('./risk_collector_io').reportError('realtime density',e);/* 척수 정상본은 유지하고 밀집도는 null로 남긴다. */}
    return{collection,densities};
}
module.exports={current};
