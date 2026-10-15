/**
 * 파일명: local_server/services/coastal_events_collector.js
 * 역할: 관광공사 공식 행사와 Gemini 보충검색을 모아 주소(또는 행사장 이름)가 맞는 좌표로 최근접 관광지에 연결한다.
 * [연계] risk_collector_io·risk_geo·gemini_client → events_YYYYMM.json 및 월별 상태(관리자 오류현황 「상세」 줄 포함).
 *        과거 행사 이름은 config/coastal_safety/events/events_2020_2025.csv 에서 읽어 Gemini 질문에 넣는다.
 * [로드 순서] server.js 운영 start만 자동 호출. 챗봇 Gemini 공유키에 별도 호출 상한을 두지 않는다(U77, 사용자 2026-10-15 「GEMINI는 제한을 두지 말도록 하자」).
 */
'use strict';
const path=require('path'),fs=require('fs');
const io=require('./risk_collector_io'),G=require('./risk_geo');
const CONFIG=path.join(__dirname,'..','config','coastal_safety');
const SPOTS=path.join(CONFIG,'coastal_spots.json');
const PAST_EVENTS=path.join(CONFIG,'events','events_2020_2025.csv');
// 첨부 한국관광공사 개방데이터 활용매뉴얼(국문)v4.4 행사정보조회 계약.
const FESTIVAL_URL='https://apis.data.go.kr/B551011/KorService2/searchFestival2';
// 1년 내내 진행되는 행사는 「행사일」이 아니라 평소 상태라 저장하지 않는다(사용자 2026-10-15 「1년 내내 진행 중인 것은 제외하자」).
// 180일 경계는 사용자가 정한 숫자가 아니라 오케스트레이터 제안값이다 — 예: 공식 목록 「광안리 드론 라이트쇼 2026-01-01~12-31」(365일).
const PERMANENT_DAYS=180;
// gemini_client 호출에는 시간 제한이 없다. 응답이 영영 오지 않으면 수집 잠금이 계속 잡히므로 수집기 쪽에서 그 시도만 끊는다(2026-10-15).
const SEARCH_TIMEOUT_MS=10*60000;
// Gemini 근거(groundingChunks[].web.uri)는 구글 경유 주소로 온다(공개 자료: python-genai issue #1322 등 — 실호출로는 확인 못 함).
const REDIRECT_HOST='vertexaisearch.cloud.google.com',REDIRECT_TIMEOUT_MS=15000;
// 버린 행사의 사유(월 파일 skipped·상태 detail 에 이 순서로 남긴다).
const SKIP_ORDER=['Gemini 호출 실패','시도 응답 해석 실패','시도 응답 시간 초과','근거 불일치','근거 확인 불가','기간 밖','상시 행사','내륙(해안 1km 밖)','주소/장소 불일치','번지 없음','항목 형식 오류','취소','대상 시군구 밖'];
// events_2020_2025.csv 의 type 칸(notes.md §1).
const TYPE_NAMES={1:'물에 들어가는 대회',2:'해안 육상 대회',3:'낚시대회',4:'야간·대규모',5:'물때',6:'지역 해양·수산 축제'};
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
/** 시도|시군구 비교키를 만든다. 예: 「부산 수영구 광안동 1」과 「부산광역시 수영구」→ 부산|수영구.
 * @param {string} value - 시도부터 시작하는 주소 @returns {string|null} 시도·시군구가 없으면 null
 * [연계] ← collect(대상 시군구)·findPlace / 번지 없는 행사를 같은 시군구 관광지·카카오 결과와 맞춘다.
 */
function municipal(value){const a=addressParts(value);return a.province&&a.city.length?a.province+'|'+a.city.join('/'):null;}
/** 두 주소를 「호스트+경로」로 비교하는 키를 만든다(끝 / 제거, 쿼리·조각·http/https 무시 — 사용자 승인 2026-10-15).
 * withQuery 면 쿼리까지 넣은 전체 주소 키(조각만 무시). 예: https://Busan.go.kr/a/b/?x=1#y → busan.go.kr/a/b · withQuery → busan.go.kr/a/b?x=1
 * @param {string} value - URL @param {boolean} [withQuery] @returns {string|null} 해석 불가는 null [연계] ← matchGrounding / Gemini src 와 실제 근거 주소를 맞춘다.
 */
function urlKey(value,withQuery){try{const u=new URL(value);return u.hostname.toLowerCase()+u.pathname.replace(/\/+$/,'')+(withQuery?u.search:'');}catch(_){return null;}}
/** Gemini src 에 맞는 실제 근거 주소를 고른다. 쿼리까지 같은 근거가 먼저, 없으면 「호스트+경로」가 같은 근거가 **하나뿐일 때만**.
 * 예: 근거 view.do?idx=7·idx=8 에 src idx=8 → idx=8 / src idx=99999 → null(같은 게시판 글이 둘이라 어느 것인지 모름) / src a?utm=x, 근거 a 하나 → a
 * @param {string} src - Gemini 가 적은 주소 @param {string[]} grounded - 실제 근거 주소 @returns {string|null}
 * [연계] ← collect / 2026-10-15 독립 검토: 호스트+경로만 보면 첫 근거만 남아 진짜 행사가 다른 글 링크로 저장되고 지어낸 글 번호도 통과했다.
 */
function matchGrounding(src,grounded){const full=urlKey(src,true),path=urlKey(src);if(!full)return null;const exact=grounded.find(u=>urlKey(u,true)===full);if(exact)return exact;
    const same=[...new Set(grounded.filter(u=>urlKey(u)===path))];return same.length===1?same[0]:null;}
/** Gemini 근거 주소가 구글 경유 주소면 한 번 따라가 실제 주소(Location)를 얻는다. 예: vertexaisearch…/grounding-api-redirect/AB → https://city.go.kr/event/1
 * @param {string} uri - groundingChunks[].web.uri @param {function} fetchImpl - HTTP
 * @returns {Promise<object>} {url: 실제 주소} 또는 {error: 못 푼 까닭} — 풀지 못한 것은 지어내지 않고 「근거 확인 불가」 건수로 남는다
 * [연계] ← webSearch / 경유 주소와 Gemini 가 적은 src 가 문자열로 같을 수 없어 근거 확인이 늘 실패하던 문제(2026-10-15 검토 C1).
 */
async function resolveGrounding(uri,fetchImpl){let u;try{u=new URL(uri);}catch(e){return{error:'invalid uri'};}
    if(u.hostname!==REDIRECT_HOST||!u.pathname.startsWith('/grounding-api-redirect/'))return u.protocol==='https:'?{url:u.href}:{error:'not https'};
    let r;try{r=await fetchImpl(u.href,{redirect:'manual',signal:AbortSignal.timeout(REDIRECT_TIMEOUT_MS)});}catch(e){return{error:io.errorName(e)};}
    const location=r.status>=300&&r.status<400&&typeof r.headers?.get==='function'?r.headers.get('location'):null;if(!location)return{error:'HTTP '+r.status};
    let real;try{real=new URL(location,u.href);}catch(e){return{error:'invalid location'};}
    // 근거는 https 만 받는다(2026-10-15 검토 — http Location 이 src 의 https 조건을 우회해 저장됐다).
    return real.hostname===REDIRECT_HOST||!/^https?:$/.test(real.protocol)?{error:'not a page'}:real.protocol!=='https:'?{error:'not https'}:{url:real.href};
}
/** 따옴표 안 쉼표·줄바꿈·"" 를 지키며 CSV 를 읽는다. 예: a,"b,c"\r\n → [{h1:'a',h2:'b,c'}]
 * @param {string} text - CSV 원문(첫 줄 머리글) @returns {object[]} 행 객체 [연계] ← pastEvents / 과거 행사 목록을 읽는다.
 */
function parseCsv(text){const rows=[];let row=[],cell='',quoted=false;text=String(text).replace(/^\uFEFF/,'');
    for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else quoted=false;}else cell+=c;}
        else if(c==='"')quoted=true;else if(c===','){row.push(cell);cell='';}else if(c==='\n'){row.push(cell);rows.push(row);row=[];cell='';}else if(c!=='\r')cell+=c;}
    if(quoted)throw new Error('invalid response');if(cell||row.length){row.push(cell);rows.push(row);}
    const [head,...body]=rows;if(!head||body.some(r=>r.length!==head.length))throw new Error('invalid response');return body.map(r=>Object.fromEntries(head.map((h,i)=>[h,r[i]])));
}
let pastRows=null;
/** 작년까지 그 시도에서 열린 해안 행사 이름(유형 포함)을 중복 없이 준다. 예: 부산광역시 → ['부산불꽃축제(야간·대규모)', …]
 * region 「복수(부산·경남·전남)」 행은 이름이 나온 시도마다 넣는다.
 * @param {string} province - 시도(정식명·약칭 모두) @returns {string[]} [연계] ← webSearch / 「올해 이 달 개최 여부를 공식 원문으로 확인」 목록.
 */
function pastEvents(province){if(!pastRows)pastRows=parseCsv(fs.readFileSync(PAST_EVENTS,'utf8'));const want=addressParts(province).province,seen=new Set(),out=[];
    for(const r of pastRows){if(!(r.region.match(/[가-힣]+/g)||[]).some(t=>PROVINCES[t]===want)||seen.has(r.event_family))continue;seen.add(r.event_family);out.push(r.event_family+'('+(TYPE_NAMES[r.type]||'유형 미상')+')');}return out;
}
/** 시작·끝날을 모두 넣은 개최 일수. 예: 2026-01-01~2026-12-31 → 365. @param {object} e - start/end @returns {number} [연계] ← collect / 상시 행사 판정. */
function eventDays(e){return Math.round((Date.parse(e.end+'T00:00:00Z')-Date.parse(e.start+'T00:00:00Z'))/86400000)+1;}
/** 관광지·행사장 이름을 비교용으로 다듬는다(공백과 괄호 묶음 제거). 예: 「태종대 (부산 국가지질공원)」→ 태종대.
 * @param {string} value @returns {string} [연계] ← findPlace / 번지 없는 행사장을 관광지 이름과 정확히 맞춘다.
 */
function placeName(value){return String(value||'').normalize('NFKC').replace(/\([^)]*\)/g,'').replace(/\s/g,'');}
/** 그 시도 응답 하나만 실패로 표시하는 오류를 만든다. 예: 머리말뿐인 답 → 시도 응답 해석 실패.
 * @param {string} reason - SKIP_ORDER 의 시도 사유 @returns {Error} [연계] ← webSearch·collect / 공식 목록·다른 시도 결과는 저장한다.
 */
function provinceError(reason){return Object.assign(new Error('network or parse error'),{provinceFailure:reason});}
/** Gemini 답에서 첫 { ~ 마지막 } 만 잘라 events 배열을 읽는다. 예: 「찾았습니다: {"events":[]}」→ []
 * @param {string} text - 모델 답 @returns {object[]} events [연계] ← webSearch / JSON 이 아니면 그 시도만 실패(검토 C3).
 */
function parseEvents(text){const s=String(text||''),a=s.indexOf('{'),b=s.lastIndexOf('}');let value;try{value=a>=0&&b>a?JSON.parse(s.slice(a,b+1)):null;}catch(_){value=null;}
    if(!value||typeof value!=='object'||!Array.isArray(value.events))throw provinceError('시도 응답 해석 실패');return value.events;
}
/** 사유별 건수를 더한다. 예: add(s,'기간 밖') → s['기간 밖']+1. @param {object} into @param {string} why @param {number} n [연계] ← collect. */
function addSkip(into,why,n=1){if(n>0)into[why]=(into[why]||0)+n;}
/** 관리자 오류현황 「상세」에 보일 한 줄을 만든다(고정 문구+숫자, 키·주소 없음). 예: 시도 실패 경상남도(시도 응답 해석 실패) · 건너뜀 근거 불일치 2·번지 없음 1
 * @param {object} skipped - 사유별 건수 @param {object} provinces - 시도별 결과 @returns {string|null} [연계] ← collect → io.status detail.
 */
function skipDetail(skipped,provinces){const failed=Object.entries(provinces).filter(([,p])=>p.status==='error').map(([name,p])=>name+'('+p.reason+')');
    const parts=SKIP_ORDER.filter(k=>skipped[k]).map(k=>k+' '+skipped[k]);
    return [failed.length?'시도 실패 '+failed.join(', '):'',parts.length?'건너뜀 '+parts.join('·'):''].filter(Boolean).join(' · ')||null;
}
/** 주입 가능한 공식목록·보충검색 수집기를 만든다. 예: 검사에서는 외부 HTTP와 Gemini를 모두 주입한다.
 * @param {object} options - dir/clock/fetchImpl/key/kakaoKey/search/festivalSearch/spots/coastalGeometry/searchTimeoutMs(검사용)
 * @returns {object} collect/tick/start/stop [연계] ← server.js / 운영 스케줄에서만 과금검색을 시작한다.
 */
function createCollector({dir=io.DEFAULT_DIR,clock=Date.now,fetchImpl=fetch,key,kakaoKey=process.env.KAKAO_REST_API_KEY,search,festivalSearch,spots,coastalGeometry,searchTimeoutMs=SEARCH_TIMEOUT_MS}={}){
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
    /** 공식 목록에 빠진 해안 행사를 챗봇 공유 클라이언트(Google 검색)로 보충한다. 예: 좌표 추정 없이 원문 행사장·날짜만 받는다.
     * @param {string} target - 조사월 @param {string} province - 시도 @param {object[]} official - 공식 목록 @param {object[]} ongoing - 전월 재확인 후보
     * @param {object} extra - municipalities(그 시도의 대상 시군구 이름)
     * @returns {Promise<object>} events/grounded(풀어낸 실제 근거 주소)/unresolved(풀지 못한 근거 수)
     * [연계] ← collect / gemini_client 의 Google Search 와 공유 429 쿨다운을 쓴다. 호출 실패·JSON 아님이면 provinceError 로 그 시도만 실패.
     */
    async function webSearch(target,province,official,ongoing,{municipalities=[]}={}){const gemini=require('./gemini_client'),bounds=monthBounds(target),year=target.slice(0,4);
        const known=official.filter(e=>sameProvince(e.address,province)).map(e=>({name:e.name,start:e.start,end:e.end,address:e.address}));
        const candidates=ongoing.filter(e=>sameProvince(e.address||e.sgg,province)).map(e=>({name:e.name,venue:e.venue||'',sgg:e.sgg||'',address:e.address||'',start:e.start,end:e.end,src:e.src}));
        const past=pastEvents(province);
        // 사용자 2026-10-15 승인 보완(검토 A·B·C): 섬·대상 시군구·해안 1km·스포츠 먼저·해변/항구 지역축제·올해 일정만·실제 연 페이지 src·출처 범위·빈 결과 형식.
        const contents=[
            `${target} ${province} 해안에서 열리는 행사 중 관광공사 공식 목록에 빠진 행사를 공식 원문으로 보충 조사하세요.`,
            `대상 기간은 ${bounds.first}부터 ${bounds.last}까지이며 이 기간과 개최 기간이 겹치는 행사만 조사하세요.`,
            `대상 시군구(이 목록 안의 행사만): ${municipalities.join(', ')}. 육지 해안뿐 아니라 이 시군구에 속한 섬 지역(예: 통영 한산도·욕지도, 울릉도, 제주 우도·추자도, 인천 백령도·덕적도)의 행사도 찾으세요.`,
            '해안선에서 1km 안의 육지나 바다 위에서 열리는 행사만 넣으세요.',
            '스포츠 대회를 먼저 찾으세요(공식 목록에 거의 없습니다): 해안 레저·수상 대회(철인3종·오픈워터 수영·수영·서핑·SUP·카누·용선/드래곤보트·요트), 해안 육상 대회(해안도로 마라톤·달리기·자전거·비치발리볼·배구·걷기), 낚시대회(갯바위·방파제·선상).',
            '그다음 유형도 빠짐없이 검색하세요: 해변·항구 지역축제(바다축제·모래축제·해양문화/역사 축제 — 예: 한산대첩축제·거북선축제), 야간 대규모 행사(불꽃축제·해변 음악축제·해넘이·해맞이), 물때 행사(바닷길 축제·갯벌 체험), 지역 수산물/해산물 축제·머드축제·해안 벚꽃축제·군항제·해수욕장 개장/폐장 행사, 해안 에어쇼·함정 공개.',
            '유형 목록은 검색 대상이지 실제 개최 근거가 아니므로 찾지 못한 행사를 만들어 넣지 마세요.',
            `작년까지 이 지역에서 열린 행사(올해 이 달 개최 여부를 공식 원문으로 확인하세요 — 이 목록에 있다는 것만으로 넣지 마세요): ${past.length?past.join(', '):'없음'}.`,
            `원문에 ${year}년 일정이 명시된 행사만 넣으세요. 작년 일정을 올해로 옮기지 마세요. 연기된 행사는 바뀐 일정으로 넣으세요.`,
            '이미 취소된 행사, 일반 피서 인파, 상시 관광활동(1년 내내 열리는 것), 내륙/하천 행사는 제외.',
            '출처는 공식 지자체/주최기관의 공지·행사 안내를 우선합니다. 국제대회는 국제연맹 공식 페이지, 신문사가 주최하는 대회는 그 신문사의 대회 공지도 주최기관 원문으로 인정합니다. 검색결과 페이지·재인용 뉴스·단축 링크는 쓰지 마세요.',
            'src 는 실제로 열어 본 그 페이지의 원문 https URL을 그대로 적으세요(주소를 고치거나 만들지 마세요).',
            `기존 공식 목록: ${JSON.stringify(known)}. 전월부터 진행되는 미확인 후보: ${JSON.stringify(candidates)}. 후보는 이전 자료일 뿐입니다. 현재 공식 원문에서 개최 여부·행사장·기간을 다시 확인한 후보만 events에 넣고, 취소되었거나 재확인하지 못한 후보는 제외하세요.`,
            '장소 좌표는 추정하지 마세요.',
            'JSON 객체만 답하세요(설명·마크다운 금지): {"events":[{"name":"행사명","venue":"원문에 적힌 행사장 이름(「일원」「일대」 같은 말은 빼고 장소 이름만)","sgg":"시도와 시군구 — 구가 있는 시는 구까지(예: 경상남도 통영시, 경상남도 창원시 진해구)","address":"원문에 번지가 있을 때만 시도·시군구·번지까지 전체 주소, 없으면 빈 문자열","start":"YYYY-MM-DD","end":"YYYY-MM-DD","src":"원문 https URL"}]}.',
            'address 는 원문에 번지가 없으면 빈 문자열로 두고 다른 곳에서 가져오거나 추정하지 마세요. 날짜와 행사장을 원문으로 확인할 수 없는 행사는 제외하세요. 찾은 행사가 없으면 {"events":[]} 만 답하세요.',
        ].join(' ');
        const result=await gemini.callGeminiRaw({model:'gemini-2.5-flash',caller:'CoastalEvents',contents,config:{tools:[{googleSearch:{}}]}});
        // 호출 자체 실패(키 쿨다운·키 없음·네트워크 — gemini_client 의 success:false)도 그 시도만 실패로 둔다. 공식 행사·다른 시도 결과는 저장한다
        //   (사용자 2026-10-15 「공식 행사는 저장해놔야지. 그리고 우리 앱에 저장실패했다는 내용을 알려야하겠지?」 — 알림은 관리자 오류현황 「일부 실패」).
        if(!result.success)throw provinceError('Gemini 호출 실패');const response=result.response,text=result.text||response?.text||response?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';
        const events=parseEvents(text),chunks=response?.candidates?.[0]?.groundingMetadata?.groundingChunks||[];
        const uris=[...new Set(chunks.map(c=>c?.web?.uri).filter(u=>typeof u==='string'&&u))],resolved=await Promise.all(uris.map(u=>resolveGrounding(u,fetchImpl)));
        return{events,grounded:resolved.filter(x=>x.url).map(x=>x.url),unresolved:resolved.filter(x=>!x.url).length};
    }
    /** Gemini 한 시도 호출에 시간 제한을 건다. 예: 10분 안에 답이 없으면 그 시도만 「시도 응답 시간 초과」.
     * @param {Promise} promise - 검색 @param {number} ms - 제한 @returns {Promise} [연계] ← collect / gemini_client 를 고치지 않고 수집 잠금이 영구히 잡히는 것을 막는다.
     */
    function withTimeout(promise,ms){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(provinceError('시도 응답 시간 초과')),ms);})]).finally(()=>clearTimeout(timer));}
    /** 검증된 월을 원자적으로 바꾼다. 예: 키 없음·HTTP 오류·전체0건이면 기존정상캐시 유지, 공식·Gemini중복은 한 행.
     * 한 시도의 Gemini 호출 실패·해석 실패·시간 초과면 그 시도만 실패로 적고(provinces) 나머지는 저장한다 — 다음 03:20 에는 그 시도만 다시 묻는다.
     * 그때 상태 파일은 ok(행사 점수에 쓰임)이고 failedProvinceCount>0 이라 관리자 오류현황에는 「일부 실패」로 남는다(risk_error_history).
     * @param {string} target - 조사월 @returns {Promise<object>} 성공여부/개수/사유별 건너뜀
     * [연계] ← tick/start / 공식목록·근거·주소/행사장 검증·최근접 연결 후 risk_store가 읽을 파일을 쓴다.
     */
    async function collect(target=io.day(clock()).slice(0,7)){if(running)return{ok:false,error:'collector busy'};const release=io.acquireLock(path.join(dir,'events_collect.lock'));if(!release)return{ok:false,error:'collector busy'};running=true;
        try{const bounds=monthBounds(target),locations=spots||JSON.parse(fs.readFileSync(SPOTS)).spots,provinces=[...new Set(locations.map(s=>s.sgg_name.split(' ')[0]))];
            const scope=new Set(locations.map(s=>municipal(s.sgg_name))),rows=[],skipped={},provinceResults={};
            /** 구가 있는 시를 구 없이 적은 경우도 같은 곳으로 본다. 예: 요청 경남|창원시 ↔ 후보 경남|창원시/진해구 → true, 경남|창원 ↔ 경남|창원시 → false.
             * @param {string|null} want - 요청 시군구 키 @param {string|null} have - 후보 시군구 키 @returns {boolean}
             * [연계] ← inScope·findPlace / 2026-10-15 검토: Gemini sgg 「경상남도 창원시」가 진해구 관광지와 맞지 않아 버려졌다(coastal_spots 74곳이 구 있는 시).
             */
            const sameArea=(want,have)=>!!want&&!!have&&(have===want||have.startsWith(want+'/'));
            /** 대상 시군구(관광지가 있는 시군구) 안인지. 예: 전남|여수시 → false(관광지 없음). @param {string|null} m @returns {boolean} [연계] ← link */
            const inScope=m=>[...scope].some(s=>sameArea(m,s));
            const rawOfficial=await(festivalSearch||festivals)(target);if(!Array.isArray(rawOfficial))throw new Error('invalid response');
            const normalized=rawOfficial.map(normalizeFestival),freshIds=new Set(rawOfficial.map(e=>String(e.contentid)));addSkip(skipped,'취소',normalized.filter(e=>!e).length);
            const prior=new Date(bounds.first+'T00:00:00Z');prior.setUTCMonth(prior.getUTCMonth()-1);const previous=io.read(file(prior.toISOString().slice(0,7)));
            const carried=(previous?.events||[]).filter(e=>validDate(e.start)&&validDate(e.end)&&e.end>=bounds.first&&e.start<=bounds.last&&!freshIds.has(e.contentId));
            // 같은 달 파일에 실패한 시도가 남아 있으면 그 시도만 다시 묻고, 성공했던 시도의 Gemini 결과는 그대로 다시 쓴다(사용자 승인 2026-10-15).
            const same=io.read(file(target)),retryOnly=same?.month===target&&same.provinces&&Object.values(same.provinces).some(p=>p?.status==='error')?same.provinces:null;
            const official=[];
            /** 번지 없는 행사장을 연결한다: ⓐ 같은 시군구 관광지 이름이 정확히 같은 곳 1곳 ⓑ 카카오 장소검색 「시군구+행사장」에서 같은 시군구 후보가 한 좌표일 때만.
             * @param {object} e - venue/sgg @returns {Promise<object|null>} 좌표(ⓐ는 그 관광지), 못 찾으면 null
             * [연계] ← link / 과거 수작업 163행 중 번지 있는 행이 0이라 번지만으로는 비공식 행사를 거의 못 붙였다(검토 C2).
             */
            async function findPlace(e){const want=municipal(e.sgg),name=placeName(e.venue);if(!want||!name)return null;
                const named=locations.filter(s=>sameArea(want,municipal(s.sgg_name))&&placeName(s.name)===name);if(named.length===1)return{lat:named[0].lat,lon:named[0].lon,spot:named[0],linkMethod:'관광지 이름'};
                if(!kakaoKey)throw new Error('missing key');const url=new URL('https://dapi.kakao.com/v2/local/search/keyword.json');url.searchParams.set('query',addressParts(e.sgg).city.join(' ')+' '+String(e.venue).trim());url.searchParams.set('size','7');
                const response=await fetchImpl(url.toString(),{headers:{Authorization:'KakaoAK '+kakaoKey},signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('HTTP '+response.status);
                const found=[];for(const d of (await response.json()).documents||[]){const address=[d.road_address_name,d.address_name].find(a=>a&&sameArea(want,municipal(a)));if(!address)continue;const lat=Number(d.y),lon=Number(d.x);
                    if(d.y===null||d.y===''||d.x===null||d.x===''||!Number.isFinite(lat)||!Number.isFinite(lon)||lat<20||lat>45||lon<115||lon>140)return null;found.push({lat,lon,resolvedAddress:address,resolvedPlace:typeof d.place_name==='string'?d.place_name:null,linkMethod:'카카오 장소검색'});}
                return found.length&&new Set(found.map(d=>d.lat+'|'+d.lon)).size===1?found[0]:null;
            }
            /** 행사 한 건을 검증해 관광지와 연결한다. 버리면 사유를 돌려준다. 예: 번지 있음→카카오 주소 대조, 없음→findPlace.
             * @param {object} e - 행사 @returns {Promise<string|null>} 버린 사유(SKIP_ORDER) 또는 null(저장)
             * [연계] ← collect / 두 원천을 같은 연결 규칙으로 저장한다. 키 없음·HTTP 오류는 throw 해 그 달을 실패로 둔다.
             */
            async function link(e){const text=(v,max)=>v===undefined||v===null||(typeof v==='string'&&v.length<=max);
                if(!e||typeof e!=='object'||typeof e.name!=='string'||!e.name.trim()||e.name.length>200||!text(e.address,500)||!text(e.venue,200)||!text(e.sgg,100)||!validDate(e.start)||!validDate(e.end)||e.start>e.end)return'항목 형식 오류';
                // 대상 시군구 밖(관광지가 없는 시군구)은 가장 가까운 다른 시군구 관광지에 잘못 붙으므로 건너뛴다 — 공식 목록은 아래 for 에서 먼저 거른다(2026-10-15 검토: 전남 여수 행사가 23km 떨어진 남해 관광지에 붙었다).
                const area=addressKey(e.address)?municipal(e.address):e.venue&&e.sgg?municipal(e.sgg):null;if(area&&!inScope(area))return'대상 시군구 밖';
                if(e.end<bounds.first||e.start>bounds.last)return'기간 밖';if(eventDays(e)>=PERMANENT_DAYS)return'상시 행사';
                let coord;if(addressKey(e.address)){try{coord={...await geocode(e,fetchImpl,kakaoKey),linkMethod:'카카오 주소'};}catch(err){const why=io.errorName(err);if(why!=='unmatched event'&&why!=='invalid event')throw err;return'주소/장소 불일치';}}
                else if(e.venue&&e.sgg){coord=await findPlace(e);if(!coord)return'주소/장소 불일치';}else return'번지 없음';
                if(!land)land=io.read(path.join(CONFIG,'risk_spots.json'))?.landGeometry;if(!isCoastal(coord,land))return'내륙(해안 1km 밖)';
                let spot=coord.spot||null,best=spot?0:Infinity;if(!spot)for(const s of locations){const distance=G.haversine(coord.lat,coord.lon,s.lat,s.lon);if(distance<best){best=distance;spot=s;}}if(!spot)throw new Error('unmatched event');
                const {sources:_oldSources,...clean}=e,{spot:_spot,...where}=coord;rows.push({...clean,name:e.name.trim(),...where,spotId:spot.sgg+'|'+spot.name,connectionKm:+best.toFixed(3)});return null;
            }
            // 행사 한 건을 연결할 수 없으면 그 행사만 건너뛰고 사유별로 센다(2026-10-15 — 종전에는 한 건 때문에 그 달 전체가 실패했다).
            // 키 없음·HTTP 오류·한도 같은 수집 자체의 문제는 종전대로 그 달을 실패로 둔다(정상 캐시 보존).
            for(const e of normalized){if(!e)continue;if(!scope.has(municipal(e.address))){addSkip(skipped,'대상 시군구 밖');continue;}if(e.end<bounds.first||e.start>bounds.last){addSkip(skipped,'기간 밖');continue;}
                official.push(e);const why=await link({...e,sourceObservedAt:io.iso(clock()),carriedForward:false});if(why)addSkip(skipped,why);}
            for(const province of provinces){const saved=retryOnly?.[province];
                if(saved?.status==='ok'&&Array.isArray(saved.rows)){rows.push(...saved.rows);for(const [why,n] of Object.entries(saved.skipped||{}))addSkip(skipped,why,n);provinceResults[province]=saved;continue;}
                const local={},before=rows.length,municipalities=[...new Set(locations.filter(s=>s.sgg_name.split(' ')[0]===province).map(s=>s.sgg_name))];let result;
                try{result=await withTimeout((search||webSearch)(target,province,official,carried,{municipalities}),searchTimeoutMs);if(!result||!Array.isArray(result.events)||!Array.isArray(result.grounded))throw provinceError('시도 응답 해석 실패');}
                catch(err){if(!err?.provinceFailure)throw err;provinceResults[province]={status:'error',reason:err.provinceFailure};addSkip(skipped,err.provinceFailure);continue;}
                // 근거 확인: Gemini 가 적은 src 와 실제로 검색에 쓰인 근거 주소(경유 주소는 풀어낸 실제 주소)를 비교한다 — 쿼리까지 같은 근거 먼저,
                // 없으면 「호스트+경로」가 같은 근거가 하나뿐일 때만(matchGrounding). 도메인만 같다고 받지 않는다 — 아무 페이지나 붙여 지어낸 행사가 통과하는 길이 된다.
                // 저장하는 src 는 일치한 실제 주소다.
                const grounded=result.grounded.filter(u=>typeof u==='string'),unresolved=Number(result.unresolved)>0;
                for(const e of result.events){if(!e||typeof e!=='object'){addSkip(local,'항목 형식 오류');continue;}let source;try{source=new URL(e.src);}catch(_){addSkip(local,'근거 불일치');continue;}
                    if(source.protocol!=='https:'||source.username||source.password){addSkip(local,'근거 불일치');continue;}const real=matchGrounding(e.src,grounded);if(!real){addSkip(local,unresolved?'근거 확인 불가':'근거 불일치');continue;}
                    const why=await link({...e,src:real,sourceType:'gemini',sourceObservedAt:io.iso(clock()),carriedForward:false});if(why)addSkip(local,why);}
                provinceResults[province]={status:'ok',rows:rows.slice(before),skipped:local};for(const [why,n] of Object.entries(local))addSkip(skipped,why,n);
            }
            if(!rows.length)throw new Error('empty response');
            // 같은 행사 판정: 이름·기간·연결 관광지. 번지 없는 Gemini 행은 주소가 비어 있어 종전 주소키로는 공식 행과 합쳐지지 않는다(2026-10-15).
            const unique=new Map();for(const e of rows){const id=[e.name.replace(/\s/g,'').toLowerCase(),e.start,e.end,e.spotId].join('|'),source={sourceType:e.sourceType,src:e.src,...(e.contentId?{contentId:e.contentId}:{})};if(unique.has(id))unique.get(id).sources.push(source);else unique.set(id,{...e,sources:[source]});}
            const events=[...unique.values()],sourceCounts={tourapi:events.filter(e=>e.sourceType==='tourapi').length,gemini:events.filter(e=>e.sourceType==='gemini').length,duplicates:rows.length-events.length},collectedAt=io.iso(clock());
            const coverage={queryStart:bounds.first,queryEnd:bounds.last,ongoingCandidates:carried.length,carriedCount:0,previousMonthCached:!!previous,completeOngoing:false};
            const failedProvinces=Object.entries(provinceResults).filter(([,p])=>p.status==='error').map(([name])=>name),detail=skipDetail(skipped,provinceResults);
            io.write(file(target),{month:target,collectedAt,events,sourceCounts,coverage,skipped,provinces:provinceResults});status(target,null,{count:events.length,sourceCounts,skipped,failedProvinces,failedProvinceCount:failedProvinces.length,detail});return{ok:true,count:events.length,skipped,failedProvinces};
        }catch(e){status(target,e,{detail:null});return{ok:false,error:io.errorName(e)};}finally{running=false;release();}
    }
    /** 예정일을 지난 다음달을 구한다. 예:10월29일은 놓친10월28일예약 보충.
     * @param {number} now - UTC밀리초 @returns {string|null} [연계] ← tick/start / U33월말-3일03:20을 계산한다.
     */
    function dueNext(now){const d=new Date(now+9*3600000),last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();if(d.getUTCDate()<last-3||(d.getUTCDate()===last-3&&d.getUTCHours()*60+d.getUTCMinutes()<200))return null;return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)).toISOString().slice(0,7);}
    /** 월별 실패/누락만 재시도 대상으로 고른다. 예:정상당월은 다음월실패와 분리。 한 시도만 실패한 달도 재시도 대상(2026-10-15).
     * @param {string} target - 월 @returns {boolean} [연계] ← tick/start / 상태와 정상캐시를 함께 확인한다.
     */
    function needsMonth(target){const data=io.read(file(target)),legacy=io.read(path.join(dir,'events_status.json')),state=io.read(stateFile(target))||(legacy?.month===target?legacy:null);return !data||data.month!==target||!Array.isArray(data.events)||state?.status==='error'||Object.values(data.provinces||{}).some(p=>p?.status==='error');}
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
const defaultCollector=createCollector();module.exports={...defaultCollector,createCollector,sameProvince,addressKey,geocode,validDate,normalizeFestival,monthBounds,isCoastal,urlKey,matchGrounding,resolveGrounding,parseCsv,pastEvents,parseEvents,PERMANENT_DAYS,SEARCH_TIMEOUT_MS};
