/**
 * 파일명: local_server/services/coastal_events_collector.js
 * 역할: 관광공사 공식 행사와 Gemini 보충검색을 모아 주소가 맞는 카카오 좌표로 최근접 관광지에 연결한다.
 * [연계] risk_collector_io·risk_geo·gemini_client → events_YYYYMM.json 및 월별 상태.
 * [로드 순서] server.js 운영 start만 자동 호출. 챗봇 Gemini 공유키에 별도 호출 상한을 두지 않는다(U77).
 */
'use strict';
const path=require('path'),fs=require('fs');
const io=require('./risk_collector_io'),G=require('./risk_geo');
const CONFIG=path.join(__dirname,'..','config','coastal_safety');
const SPOTS=path.join(CONFIG,'coastal_spots.json');
// 첨부 한국관광공사 개방데이터 활용매뉴얼(국문)v4.4 행사정보조회 계약.
const FESTIVAL_URL='https://apis.data.go.kr/B551011/KorService2/searchFestival2';
const PROVINCES={서울:'서울',부산:'부산',대구:'대구',인천:'인천',광주:'광주',대전:'대전',울산:'울산',세종:'세종',경기:'경기',강원:'강원',충북:'충북',충청북:'충북',충남:'충남',충청남:'충남',전북:'전북',전라북:'전북',전남:'전남',전라남:'전남',경북:'경북',경상북:'경북',경남:'경남',경상남:'경남',제주:'제주'};
/** 시도 약칭과 주소 토큰을 읽는다. 예: 경상남도 거제시→경남/거제시.
 * @param {string} value - 시도부터 시작하는 주소 @returns {object} 정규화 주소
 * [연계] ← sameProvince/addressKey/collect / 시도·시군구를 비교한다.
 */
function addressParts(value){const tokens=String(value||'').normalize('NFKC').replace(/대한민국|\([^)]*\)/g,'').replace(/,/g,' ').trim().split(/\s+/);const province=PROVINCES[tokens.shift()?.replace(/특별자치도|특별자치시|광역시|특별시|도$/g,'')];const city=[];while(tokens.length&&/^[가-힣]+(?:시|군|구)$/.test(tokens[0]))city.push(tokens.shift());return{province,city,tokens};}
/** 요청 주소와 후보의 시도가 같은지 확인한다. 예: 부산과 서울은false.
 * @param {string} a - 요청 주소 @param {string} b - 후보 주소 @returns {boolean}
 * [연계] ← 검사 / 예전 시도 확인 계약을 보존한다.
 */
function sameProvince(a,b){const left=addressParts(a).province;return !!left&&left===addressParts(b).province;}
/** 시군구와 도로/지번을 포함하는 엄격한 주소키를 만든다. 예: 같은 도의 다른 시나 다른 번지는 다른 키.
 * @param {string} value - 실제 주소 @returns {string|null} 검증가능한 주소키
 * [연계] ← geocode/collect / 주소 없는 장소 추정 좌표를 거부한다.
 */
function addressKey(value){const {province,city,tokens}=addressParts(value);if(!province||!city.length)return null;
    const number=x=>/^\d+(?:-\d+)?(?:번지)?$/.test(x||'')?x.replace(/번지$/,'').split('-').map(v=>String(Number(v))).join('-'):null;
    const road=tokens.findIndex(t=>/(?:대로|로|길)$/.test(t));if(road>=0){const n=number(tokens[road+1]);return n?[province,city.join('/'),'road',tokens.slice(0,road+1).join('/'),n].join('|'):null;}
    const lot=tokens.findIndex(t=>/(?:동\d*가?|리|가)$/.test(t));if(lot<0)return null;const mountain=tokens[lot+1]==='산',n=number(tokens[lot+(mountain?2:1)]);return n?[province,city.join('/'),'lot',tokens.slice(0,lot+1).join('/'),mountain?'산':'',n].join('|'):null;
}
/** 실제 달력 날짜만 허용한다. 예: 2026-02-31은false.
 * @param {string} value - YYYY-MM-DD @returns {boolean}
 * [연계] ← normalizeFestival/collect / 잘못된 행사 기간을 저장하지 않는다.
 */
function validDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const stamp=Date.parse(value+'T00:00:00Z');return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===value;}
/** 조사할 달의 실제 마지막 날짜를 구한다. 예: 2028-02→29일.
 * @param {string} target - YYYY-MM @returns {object} first/last YYYY-MM-DD
 * [연계] ← collect/festivals / 월 경계를 검증한다.
 */
function monthBounds(target){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(target))throw new Error('invalid event');const [y,m]=target.split('-').map(Number);return{first:target+'-01',last:target+'-'+new Date(Date.UTC(y,m,0)).getUTCDate()};}
/** 카카오 후보 중 실제 시군구·도로/지번이 일치하는 주소만 채택한다. 예: 통영 요청에 사천 첫 후보를 건너뛴다.
 * @param {object} event - 실제address @param {function} fetchImpl - HTTP @param {string} key - REST키
 * @returns {Promise<object>} 검증 좌표/주소 [연계] ← collect / 행사 주소를 최근접 연결 좌표로 바꾼다.
 */
async function geocode(event,fetchImpl,key){if(!key)throw new Error('missing key');const wanted=addressKey(event.address);if(!wanted)throw new Error('invalid event');
    const url=new URL('https://dapi.kakao.com/v2/local/search/keyword.json');url.searchParams.set('query',event.address);url.searchParams.set('size','7');
    const response=await fetchImpl(url.toString(),{headers:{Authorization:'KakaoAK '+key},signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('HTTP '+response.status);
    const result=await response.json(),matches=[];for(const d of result.documents||[]){const address=[d.road_address_name,d.address_name].find(a=>a&&addressKey(a)===wanted);if(!address)continue;
        const lat=Number(d.y),lon=Number(d.x);if(d.y===null||d.y===''||d.x===null||d.x===''||!Number.isFinite(lat)||!Number.isFinite(lon)||lat<20||lat>45||lon<115||lon>140)throw new Error('invalid event');matches.push({lat,lon,resolvedAddress:address});}
    if(!matches.length||new Set(matches.map(d=>d.lat+'|'+d.lon)).size!==1)throw new Error('unmatched event');return matches[0];
}
/** 공식 응답 필드를 행사 형태로 바꾼다. 예: eventstartdate=20261011→2026-10-11, sourceType=tourapi.
 * @param {object} row - searchFestival2 v4.4 행 @returns {object|null} 명시적으로 취소된 제목은null
 * [연계] ← collect / 원천 URL과 contentId를 보존하며 개별 기사 링크를 추정하지 않는다.
 */
function normalizeFestival(row){if(!row||typeof row.title!=='string'||!row.title.trim()||!/^\d+$/.test(String(row.contentid||'')))throw new Error('invalid response');
    if(row.contenttypeid!==undefined&&String(row.contenttypeid)!=='15')throw new Error('invalid response');
    // v4.4 progresstype 진행상태정보에는 숫자enum이 설명되어 있지 않다. 명시적인 취소 텍스트만 제외한다.
    if(/\[\s*취소\s*\]|\(\s*취소\s*\)|개최\s*취소\s*$/.test(row.title)||/^(?:취소|개최\s*취소|cancelled|canceled)$/i.test(String(row.progresstype||'').trim()))return null;
    const date=x=>/^\d{8}$/.test(String(x||''))?String(x).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'):'';
    const start=date(row.eventstartdate),end=date(row.eventenddate);if(!validDate(start)||!validDate(end)||start>end)throw new Error('invalid response');
    return{name:row.title.trim(),address:[row.addr1,row.addr2].filter(Boolean).join(' ').trim(),start,end,src:FESTIVAL_URL,sourceType:'tourapi',contentId:String(row.contentid)};
}
/** 기존 해안 관광지 선정 기준으로 좌표를 거른다. 예: 육지 안에서 해안1km 밖은false, 바다 위는true.
 * @param {object} coord - lat/lon @param {object} geometry - land_mask+island Polygon/MultiPolygon
 * @returns {boolean} [연계] ← collect / 전국 공식 목록의 내륙 행사를 제외한다(설계§5.1 U13).
 */
function isCoastal(coord,geometry){if(!geometry||!['Polygon','MultiPolygon'].includes(geometry.type))throw new Error('invalid response');const p=[coord.lon,coord.lat];if(!G.pointInGeometry(p,geometry))return true;const polys=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;for(const poly of polys){const ring=poly[0];for(let i=1;i<ring.length;i++)if(G.segmentDistance(p,ring[i-1],ring[i])<=1)return true;}return false;}
/** 주입 가능한 공식목록·보충검색 수집기를 만든다. 예: 검사에서는 외부 HTTP와 Gemini를 모두 주입한다.
 * @param {object} options - dir/clock/fetchImpl/key/kakaoKey/search/festivalSearch/spots/coastalGeometry
 * @returns {object} collect/tick/start/stop [연계] ← server.js / 운영 스케줄에서만 과금검색을 시작한다.
 */
function createCollector({dir=io.DEFAULT_DIR,clock=Date.now,fetchImpl=fetch,key,kakaoKey=process.env.KAKAO_REST_API_KEY,search,festivalSearch,spots,coastalGeometry}={}){
    let running=false,timer=null,land=coastalGeometry;
    const file=target=>path.join(dir,'events_'+target.replace('-','')+'.json');
    const stateFile=target=>path.join(dir,'events_'+target.replace('-','')+'_status.json');
    /** 월별 상태와 호환 최근시도 요약을 함께 쓴다. 예: 다음달 오류가 당월의월별 성공을 덮지 않는다.
     * @param {string} target - 조사월 @param {Error|null} error - 오류 @param {object} extra - 수집 개수
     * @returns {void} [연계] ← collect/start / risk_store에 월별 결과를 전달한다.
     */
    function status(target,error,extra={}){const data=io.read(file(target)),info={month:target,count:data?.events?.length??null,sourceCounts:data?.sourceCounts||null,...extra},now=clock();io.status(dir,'events_'+target.replace('-',''),now,error,info);io.status(dir,'events',now,error,info);}
    /** 전국 월분 행사 목록을 페이지 끝까지 받는다. 예: 행정sgg코드를 TourAPI지역코드에 대입하지 않는다.
     * @param {string} target - 조사월 @returns {Promise<object[]>} 공식 행 목록
     * [연계] ← collect / ROMS 공용키·영속900건 상한을 사용하는 risk_collector_io로 요청한다.
     */
    async function festivals(target){const bounds=monthBounds(target),rows=[];let pageNo=1,total=null;
        do{const data=await io.request({dir,name:'tourFestival',limit:900,url:FESTIVAL_URL,key,fetchImpl,now:clock(),params:{MobileOS:'ETC',MobileApp:'SEAGNAL',_type:'json',arrange:'C',eventStartDate:bounds.first.replace(/-/g,''),eventEndDate:bounds.last.replace(/-/g,''),pageNo,numOfRows:1000}});
            if(!data.response?.header)throw new Error('invalid response');const batch=io.items(data,{allowEmpty:true});if(total!==null&&total!==batch.total)throw new Error('partial response');total=batch.total;if(!batch.rows.length&&rows.length<total)throw new Error('partial response');rows.push(...batch.rows);pageNo++;
        }while(rows.length<total);if(rows.length!==total||new Set(rows.map(r=>String(r.contentid))).size!==rows.length)throw new Error('partial response');return rows;
    }
    /** 공식 목록에 드문 스포츠 대회를 챗봇 공유 클라이언트로 보충한다. 예: 좌표 추정 없이 원문 주소/날짜만 검색.
     * @param {string} target - 조사월 @param {string} province - 시도 @param {object[]} official - 공식 목록 @param {object[]} ongoing - 전월 재확인 후보
     * @returns {Promise<object>} events/grounded [연계] ← collect / gemini_client의Google Search와 공유429쿨다운을 사용한다.
     */
    async function webSearch(target,province,official,ongoing){const gemini=require('./gemini_client');
        const known=official.filter(e=>sameProvince(e.address,province)).map(e=>({name:e.name,start:e.start,end:e.end,address:e.address}));
        const candidates=ongoing.filter(e=>sameProvince(e.address,province)).map(e=>({name:e.name,address:e.address,start:e.start,end:e.end,src:e.src}));
        const result=await gemini.callGeminiRaw({model:'gemini-2.5-flash',caller:'CoastalEvents',contents:`${target} ${province} 해안에서 열리는 스포츠 대회·물때·해맞이 등 관광공사 공식 목록에 빠진 행사를 공식 지자체/주최기관 웹 원문으로 보충 조사하세요. 이미 취소된 행사, 일반 피서 인파, 내륙/하천 행사는 제외. 기존 공식 목록: ${JSON.stringify(known)}. 전월부터 진행되는 미확인 후보: ${JSON.stringify(candidates)}. 후보는 이전 자료일 뿐입니다. 현재 공식 원문에서 개최 여부·실제 주소·기간을 다시 확인한 후보만 events에 넣고, 취소되었거나 재확인하지 못한 후보는 제외하세요. 장소 좌표는 추정하지 마세요. JSON 객체만 답하세요: {"events":[{"name":"행사명","address":"실제 도로명 또는 지번 전체 주소(시도·시군구·번지 포함)","start":"YYYY-MM-DD","end":"YYYY-MM-DD","src":"공식 출처 https URL"}]}. 날짜와 주소를 원문으로 확인할 수 없는 행사는 제외하세요.`,config:{tools:[{googleSearch:{}}]}});
        if(!result.success)throw new Error('network or parse error');const response=result.response,text=result.text||response?.text||response?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';
        const value=JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g,'')),chunks=response?.candidates?.[0]?.groundingMetadata?.groundingChunks||[];return{events:value.events,grounded:chunks.map(c=>c.web?.uri).filter(Boolean)};
    }
    /** 검증된 월을 원자적으로 바꾼다. 예: 주소 오류/전체0건이면 기존정상캐시 유지, 공식·Gemini중복은한행。
     * @param {string} target - 조사월 @returns {Promise<object>} 성공여부/개수
     * [연계] ← tick/start / 공식목록·주소검증·최근접 연결 후 risk_store가 읽을 파일을 쓴다.
     */
    async function collect(target=io.day(clock()).slice(0,7)){if(running)return{ok:false,error:'collector busy'};const release=io.acquireLock(path.join(dir,'events_collect.lock'));if(!release)return{ok:false,error:'collector busy'};running=true;
        try{const bounds=monthBounds(target),locations=spots||JSON.parse(fs.readFileSync(SPOTS)).spots,provinces=[...new Set(locations.map(s=>s.sgg_name.split(' ')[0]))];
            const municipal=address=>{const a=addressParts(address);return a.province+'|'+a.city.join('/');},scope=new Set(locations.map(s=>municipal(s.sgg_name))),rows=[];
            const rawOfficial=await(festivalSearch||festivals)(target);if(!Array.isArray(rawOfficial))throw new Error('invalid response');
            const normalized=rawOfficial.map(normalizeFestival).filter(Boolean),freshIds=new Set(rawOfficial.map(e=>String(e.contentid)));
            const prior=new Date(bounds.first+'T00:00:00Z');prior.setUTCMonth(prior.getUTCMonth()-1);const previous=io.read(file(prior.toISOString().slice(0,7)));
            const carried=(previous?.events||[]).filter(e=>validDate(e.start)&&validDate(e.end)&&e.end>=bounds.first&&e.start<=bounds.last&&!freshIds.has(e.contentId));
            const official=[];
            /** 주소를 검증해 관광지와 연결한다. 예: 공식좌표가있어도 U77카카오주소 확인을 생략하지 않는다.
             * @param {object} e - 행사 @returns {Promise<void>} [연계] ← collect / 두원천을 같은 연결규칙으로 저장한다.
             */
            async function connect(e){if(typeof e.name!=='string'||!e.name.trim()||e.name.length>200||typeof e.address!=='string'||e.address.length<8||e.address.length>500||!validDate(e.start)||!validDate(e.end)||e.start>e.end)throw new Error('invalid event');if(e.end<bounds.first||e.start>bounds.last)return;
                const coord=await geocode(e,fetchImpl,kakaoKey);if(!land)land=io.read(path.join(CONFIG,'risk_spots.json'))?.landGeometry;if(!isCoastal(coord,land))return;
                let spot=null,best=Infinity;for(const s of locations){const distance=G.haversine(coord.lat,coord.lon,s.lat,s.lon);if(distance<best){best=distance;spot=s;}}if(!spot)throw new Error('unmatched event');
                const {sources:_oldSources,...clean}=e;rows.push({...clean,name:e.name.trim(),...coord,spotId:spot.sgg+'|'+spot.name,connectionKm:+best.toFixed(3)});
            }
            for(const e of normalized){if(!scope.has(municipal(e.address))||e.end<bounds.first||e.start>bounds.last)continue;official.push(e);await connect({...e,sourceObservedAt:io.iso(clock()),carriedForward:false});}
            for(const province of provinces){const result=await(search||webSearch)(target,province,official,carried);if(!result||!Array.isArray(result.events)||!Array.isArray(result.grounded))throw new Error('invalid response');
                for(const e of result.events){let source;try{source=new URL(e?.src);}catch(_){continue;}if(source.protocol!=='https:'||source.username||source.password||!result.grounded.includes(e.src))continue;await connect({...e,sourceType:'gemini',sourceObservedAt:io.iso(clock()),carriedForward:false});}
            }
            if(!rows.length)throw new Error('empty response');const unique=new Map();for(const e of rows){const id=[e.name.replace(/\s/g,'').toLowerCase(),e.start,e.end,addressKey(e.address)].join('|'),source={sourceType:e.sourceType,src:e.src,...(e.contentId?{contentId:e.contentId}:{})};if(unique.has(id))unique.get(id).sources.push(source);else unique.set(id,{...e,sources:[source]});}
            const events=[...unique.values()],sourceCounts={tourapi:events.filter(e=>e.sourceType==='tourapi').length,gemini:events.filter(e=>e.sourceType==='gemini').length,duplicates:rows.length-events.length},collectedAt=io.iso(clock());
            const coverage={queryStart:bounds.first,queryEnd:bounds.last,ongoingCandidates:carried.length,carriedCount:0,previousMonthCached:!!previous,completeOngoing:false};
            io.write(file(target),{month:target,collectedAt,events,sourceCounts,coverage});status(target,null,{count:events.length,sourceCounts});return{ok:true,count:events.length};
        }catch(e){status(target,e);return{ok:false,error:io.errorName(e)};}finally{running=false;release();}
    }
    /** 예정일을 지난 다음달을 구한다. 예:10월29일은 놓친10월28일예약 보충.
     * @param {number} now - UTC밀리초 @returns {string|null} [연계] ← tick/start / U33월말-3일03:20을 계산한다.
     */
    function dueNext(now){const d=new Date(now+9*3600000),last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();if(d.getUTCDate()<last-3||(d.getUTCDate()===last-3&&d.getUTCHours()*60+d.getUTCMinutes()<200))return null;return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)).toISOString().slice(0,7);}
    /** 월별 실패/누락만 재시도 대상으로 고른다. 예:정상당월은 다음월실패와 분리。
     * @param {string} target - 월 @returns {boolean} [연계] ← tick/start / 상태와 정상캐시를 함께 확인한다.
     */
    function needsMonth(target){const data=io.read(file(target)),legacy=io.read(path.join(dir,'events_status.json')),state=io.read(stateFile(target))||(legacy?.month===target?legacy:null);return !data||data.month!==target||!Array.isArray(data.events)||state?.status==='error';}
    /**03:20에 당월실패와 예정 다음월누락을 각각 재시도한다. 예:최초당월실패도 서버재기동 없이 다음날회복。
     * @returns {Promise<object|null>} [연계] ← start / 같은날같은예약을 중복 실행하지 않는다.
     */
    async function tick(){const now=clock(),d=new Date(now+9*3600000);if(d.getUTCHours()!==3||d.getUTCMinutes()!==20)return null;const targets=[io.day(now).slice(0,7),dueNext(now)].filter(Boolean),results=[];
        for(const target of targets){if(!needsMonth(target))continue;const state=io.read(stateFile(target)),last=Date.parse(state?.lastRun);if(Number.isFinite(last)&&io.day(last)===io.day(now)&&last>=now-60000)continue;results.push(await collect(target));}return results.length===1?results[0]:results.length?{ok:results.every(r=>r.ok),results}:null;
    }
    /** 운영기동에서 당월과 예정 다음월을 보충한다. 예:개발자동호출0, 기동실패는03:20재시도。
     * @returns {boolean} [연계] ← server.js / 각월상태를 보존하며 자동수집을 등록한다.
     */
    function start(){if(!process.env.FLY_ALLOC_ID||timer)return false;(async()=>{const target=io.day(clock()).slice(0,7);if(needsMonth(target))await collect(target);const next=dueNext(clock());if(next&&needsMonth(next))await collect(next);})().catch(e=>io.reportError('events startup',e));timer=setInterval(()=>{tick().catch(e=>io.reportError('events tick',e));},60000);timer.unref();return true;}
    return{collect,tick,start,stop(){if(timer)clearInterval(timer);timer=null;}};
}
const defaultCollector=createCollector();module.exports={...defaultCollector,createCollector,sameProvince,addressKey,geocode,validDate,normalizeFestival,monthBounds,isCoastal};
