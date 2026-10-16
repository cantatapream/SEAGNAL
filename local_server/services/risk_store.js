/**
 * 역할: 연안 점수·공식 선박사고 예보·혼잡·해구 기상을 읽고 변경 없는 원천 객체를 재사용한다.
 * [연계] risk_points/time/score/geo, sea_accident_collector의 배열·경계 → routes/risk_forecast.
 *        정적 표: config/coastal_safety/risk_spots.json · coast_accidents.json(연안 시트 「주변 연안사고」 history, 2026-10-16 T9 — 관광지 표 해시가 다르면 쓰지 않음).
 *        연안 지도·상세 응답은 날짜(KST)당 하나 — 그날 연안 칸 중 가장 높은 값(coastDayFrame·coastDayDetail, 2026-10-16 T24). 안내(특보·표류)는 그날 칸 전부에서 모음(dayNotices, §16.1 ②).
 *        특보 안내는 기상청 시각(발표·발효 예정·해제 예고)을 함께 싣는다(warnTimes → marine_fusion.warnTime, 2026-10-16 결정 1). coastWarnings 는 브리핑 육상 「해제 뒤」용(station_briefing_inputs).
 * [로드 순서] 서버 require에 수집 부작용 없음. 기존 수집 파일은 절대로 쓰지 않는다.
 */
'use strict';
const fs=require('fs'),path=require('path');
const io=require('./risk_collector_io'),T=require('./risk_time'),S=require('./risk_score'),G=require('./risk_geo'),A=require('./sea_accident_collector');
const ROOT=path.join(__dirname,'..'),CLIENT=path.join(ROOT,'..','client');
/** 구역의 공백·점표기를 통일한다. 예: 인천.경기→인천·경기. @param {string} s @returns {string} [연계] ← flattenWarnings */
function zoneName(s){return String(s||'').replace(/\./g,'·').replace(/\s/g,'');}
/** 기존 파일 갱신시간을 해석한다. 예: 오전/오후 한국어 날짜도 KST로.
 * ★운영(Fly)은 같은 toLocaleString('ko-KR') 이 「2026. 10. 15. PM 3:30:48」 처럼 AM/PM 으로 찍는다(2026-10-15 실측).
 *   예전엔 오전/오후만 읽어 운영의 특보·해구 예보가 늘 「자료 오래됨」 으로 판정됐다. AM/PM 도 읽는다.
 * @param {string|number} s @returns {number|null} [연계] ← sourceStatus */
function timestamp(s){if(typeof s==='number')return s;const v=String(s||'');const k=v.match(/^(\d{4})\.\s*(\d+)\.\s*(\d+)\.\s*(오전|오후|AM|PM)\s*(\d+):(\d+):(\d+)/i);if(k){let h=+k[5]%12;if(k[4]==='오후'||k[4].toUpperCase()==='PM')h+=12;return Date.UTC(+k[1],+k[2]-1,+k[3],h,+k[6],+k[7])-9*T.HOUR;}const wall=/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(v)?v.replace(' ','T')+'+09:00':v;const d=Date.parse(wall);return Number.isFinite(d)?d:null;}
/** 10자리 UTC 해구 예보시각을 읽는다. 예: 2026101000→09시KST. @param {string} tm @returns {number} [연계] ← forecast */
function utcForecast(tm){const m=/^(\d{4})(\d{2})(\d{2})(\d{2})$/.exec(String(tm));return m?Date.UTC(+m[1],+m[2]-1,+m[3],+m[4]):NaN;}
/** 연안 시간축(오늘·내일, 3시간 칸, 내일 21시 끝)을 만든다. 해상(내일 23시)과 같은 2일이다(사용자 확정 2026-10-15 「가」).
 * 예: 10-31 12:17 → [12:17, 15:00, …, 11-01 21:00]; 모레 00시는 들어가지 않는다.
 * @param {number} now - 현재 ms @returns {string[]} KST ISO
 * [연계] ← meta·validateTime·warningsFor·galeFor·읽을 행사 월(sourceFiles/refresh) — 한 곳에서만 기간을 정해 3일 가정이 다시 섞이지 않게 한다.
 */
function coastTimeline(now){return T.timeline(now,3,2,21);}
/** 화면은 원본을 읽고 오류 감시는 readData/metadataOnly로 같은 신선도 규칙만 재사용한다.
 * 폴더 안 실제 자료를 읽는 저장소를 만든다. 예: 검사에서는 임시자료만 읽는다. @param {object} options @returns {object} [연계] ← API/검사 */
function createStore({dir=io.DEFAULT_DIR,dataDir=path.join(ROOT,'data'),configDir=path.join(ROOT,'config','coastal_safety'),clientDir=CLIENT,clock=Date.now,readData=io.read,metadataOnly=false}={}){
    let loadedAt=-Infinity,loadedDay=null,inputVersion=0,inputSignature=null,cache={},staticTable=null,landZones=null,coastAccidents=null;
    // coastSlots: 연안 한 칸(시각)의 관광지별 점수(Float64Array, 관광지 표 순서) — 하루 값(coastDayFrame, T24)이 오늘·내일을 오가도 칸마다 1,354곳을 다시 세지 않게.
    //   오늘·내일 칸은 많아야 13개(지금 칸 + 오늘 남은 칸 + 내일 8칸)라 16개를 둔다(한 칸 약 11KB). 프레임 캐시(8개)로는 내일 8칸만으로 꽉 차 서로 밀어낸다.
    const detailCache=new Map(),frameCache=new Map(),fileCache=new Map(),coastSlots=new Map();
    /** 최근 유한 개수의 결과만 보관한다. 예: 슬라이더 왕복은 같은 입력을 재계산하지 않는다. @param {Map} map @param {string} key @param {object} value @param {number} limit @returns {object} [연계] ← detail/frame */
    function remember(map,key,value,limit){if(map.has(key))map.delete(key);map.set(key,value);while(map.size>limit)map.delete(map.keys().next().value);return value;}
    let stationIndex=null;
    /** 파출소의 소속 해양경찰서를 관할 정리판에서 찾는다(사용자 요청 2026-10-15 「제주해양경찰서 한림파출소 관할」).
     * 예: officeOf('한림파출소') → '제주해양경찰서' · officeOf('남항',{office:'부산해양경찰서'}) → '부산해양경찰서'
     * @param {string|null} police - 파출소 이름(위험구역 자료처럼 「파출소」가 빠진 이름도 받는다)
     * @param {object} [hint] - office: 자료에 적힌 소속서(같은 이름 가르기, 정리판에 없는 이름일 때 대신 씀) · lat/lon: 관광지 위치(같은 이름이면 가까운 폴리곤)
     * @returns {string|null} 해양경찰서, 가르지 못하면 null(화면은 파출소 이름만 쓴다)
     * [연계] ← coastDetail 부제·위험구역 / config/coastal_safety/coastguard_stations.geojson 의 name→station(97곳, 같은 이름은 남항파출소 부산·목포 둘) → RiskFormat.stationLabel
     *        정리판이 2023 위험구역 자료의 소속서보다 앞선다 — 강릉해양경찰서 신설(강릉·주문진)이 위험구역 자료에는 반영돼 있지 않다.
     */
    function officeOf(police,{office=null,lat,lon}={}){if(!police)return null;
        if(!stationIndex){stationIndex=new Map();for(const f of io.read(path.join(configDir,'coastguard_stations.geojson'))?.features||[]){const q=f.properties||{};if(!q.name||!q.station)continue;if(!stationIndex.has(q.name))stationIndex.set(q.name,[]);stationIndex.get(q.name).push({office:q.station,points:(f.geometry?.coordinates||[]).flat(Infinity)});}}
        const list=stationIndex.get(/(파출소|출장소)$/.test(police)?police:police+'파출소')||[],offices=[...new Set(list.map(s=>s.office))];
        if(offices.length===1)return offices[0];if(!offices.length)return office||null;if(offices.includes(office))return office;
        if(!Number.isFinite(lat)||!Number.isFinite(lon))return null;
        const near=s=>{let m=Infinity;for(let i=0;i+1<s.points.length;i+=2)m=Math.min(m,(s.points[i]-lon)**2+(s.points[i+1]-lat)**2);return m;};
        return list.reduce((a,b)=>near(b)<near(a)?b:a).office;}
    /** 같은 날짜·입력·상태의 계산만 재사용한다. 예: 특보 낡음 전환도 별도 키. @param {string} kind @param {string} t @param {string} id @returns {string} [연계] ← detail/frame */
    function resultKey(kind,t,id=''){return JSON.stringify([inputVersion,T.dateKey(clock()),kind,t,id,Object.entries(sources()).map(([k,v])=>[k,v.status]),sources().events.months]);}
    /** 읽을 원천 파일을 같은 날짜 규칙으로 열거한다. 예: 월경계의 행사만 포함.
     * @returns {string[]} 파일 경로 [연계] refresh / risk_history_sources의 순차 메타 읽기
     */
    function sourceFiles(){const now=clock();
        const visibleMonths=new Set(coastTimeline(now).map(t=>T.dateKey(t).slice(0,7)));
        const files=['weather_alerts.json','gale_warnings.json','zone_forecasts.json','ripcurrent_index.json','swell_smallzone.json.gz'].map(f=>path.join(dataDir,f));
        files.push(...['sea_traffic.json.gz','sea_accident.json.gz','accident_status.json','accident_quota.json','tour_concentration.json','sea_cells.json','events_status.json','congestion_status.json','tourConcentration_status.json','gale_status.json','congestion_quota.json','tourConcentration_quota.json'].map(f=>path.join(dir,f)));
        for(const month of visibleMonths)for(const suffix of ['.json','_status.json'])files.push(path.join(dir,'events_'+month.replace('-','')+suffix));
        if(!metadataOnly)files.push(path.join(configDir,'risk_spots.json'),path.join(clientDir,'assets','warn_zones_land_coastal.geojson'),path.join(configDir,'coast_accidents.json'));
        return files;
    }
    /** 읽기 결과를 30초 공유한다. 예: JSON 손상은 missing이 아니라 error. @returns {object} [연계] ← 모든 GET */
    function refresh(force=false){const now=clock(),today=io.day(now);if(!force&&today===loadedDay&&now-loadedAt<30000)return cache;
        const visibleMonths=new Set(coastTimeline(now).map(t=>T.dateKey(t).slice(0,7)));
        const files=sourceFiles();
        const version=files.map(file=>{try{const st=fs.statSync(file);return[file,st.mtimeMs,st.size,st.ino];}catch{return[file,null];}});
        // 전체 버전은 그대로 무효화하되, 변경되지 않은 파일 객체는 다시 JSON.parse 하지 않는다.
        const fileVersions=new Map(version.map(v=>[v[0],JSON.stringify(v.slice(1))]));
        for(const file of fileCache.keys())if(!fileVersions.has(file))fileCache.delete(file);
        const readFile=file=>{const signature=fileVersions.get(file),previous=fileCache.get(file);
            if(previous?.signature===signature)return previous.result;
            const result={data:signature==='[null]'?null:readData(file),exists:signature!=='[null]'};
            fileCache.set(file,{signature,result});return result;};
        const signature=JSON.stringify(version),changed=signature!==inputSignature;if(changed){inputSignature=signature;inputVersion++;detailCache.clear();frameCache.clear();coastSlots.clear();staticTable=null;landZones=null;coastAccidents=null;}
        loadedAt=now;loadedDay=today;cache.sourceInfo=null;if(!changed&&cache.warnings)return cache;cache.warningMap=null;
        const read=(name,filename)=>{cache[name]={...readFile(path.join(dataDir,filename))};};
        read('warnings','weather_alerts.json');read('gale','gale_warnings.json');read('zoneForecasts','zone_forecasts.json');read('ripCurrent','ripcurrent_index.json');read('swell','swell_smallzone.json.gz');
        for(const [key,file]of Object.entries({congestion:'sea_traffic.json.gz',accident:'sea_accident.json.gz',tourConcentration:'tour_concentration.json',cells:'sea_cells.json',events:'events_'+io.day(now).slice(0,7).replace('-','')+'.json'})){const filename=path.join(dir,file);cache[key]={...readFile(filename)};}
        cache.events.months={};cache.events.attempts={};cache.events.monthExists={};for(const key of visibleMonths){const file=path.join(dir,'events_'+key.replace('-','')+'.json');cache.events.months[key]=readFile(file).data;cache.events.monthExists[key]=readFile(file).exists;cache.events.attempts[key]=readFile(path.join(dir,'events_'+key.replace('-','')+'_status.json')).data;}
        for(const key of ['congestion','accident','tourConcentration','events','gale'])cache[key].attempt=readFile(path.join(dir,key+'_status.json')).data;
        if(!metadataOnly&&!staticTable)staticTable=readFile(path.join(configDir,'risk_spots.json')).data;
        if(!metadataOnly&&!landZones)landZones=readFile(path.join(clientDir,'assets','warn_zones_land_coastal.geojson')).data?.features||[];
        if(!metadataOnly&&!coastAccidents)coastAccidents=loadCoastAccidents(readFile(path.join(configDir,'coast_accidents.json')),staticTable);
        return cache;
    }
    /** 관광지별 연안 사고 집계표(coast_accidents.json — build_coast_accidents.py split, 앞바다 500m)를 정적 표처럼 받아들인다(2026-10-16 T9).
     * 집계표가 만들어진 관광지 표(_about.riskSpotsHash)와 지금 관광지 표(risk_spots.json _about.hash)가 다르면 **쓰지 않는다** —
     * 관광지 구역이 바뀌었는데 옛 구역으로 센 사고를 보여 주게 되기 때문이다. 그때는 상태 stale 로 /meta 의 coastAccidents 에 드러내고
     * 서버 로그에 한 번 남긴다(파일이 바뀔 때만 다시 읽으므로 같은 줄이 반복되지 않는다). 해시는 비밀이 아니다.
     * 예: 해시 같음 → {status:'ok',spots,from:'2020-01-01',to:'2024-12-31',bufferM:500} / 파일 없음 → {status:'missing'} / 다름 → {status:'stale'}
     * @param {object} file - refresh 의 readFile 결과 {data,exists} @param {object|null} table - risk_spots.json
     * @returns {object} 상태와 (ok 일 때만) 관광지별 사고 목록 [연계] ← refresh / → coastHistory · coastAccidentsStatus(/meta) */
    function loadCoastAccidents(file,table){
        if(!file.exists)return{status:'missing'};const d=file.data,about=d?._about||{};
        if(!d||!d.spots||typeof d.spots!=='object'||!Array.isArray(about.period)){console.warn('[risk_forecast] coast_accidents: invalid response');return{status:'error',lastError:'invalid response'};}
        const want=table?._about?.hash||null;
        if(!want||about.riskSpotsHash!==want){console.warn('[risk_forecast] coast_accidents: riskSpotsHash 불일치 — 연안 사고 목록을 쓰지 않음(집계표 '+String(about.riskSpotsHash).slice(0,32)+' · 관광지 표 '+String(want).slice(0,32)+'). build_coast_accidents.py 를 다시 돌릴 것');return{status:'stale',riskSpotsHash:about.riskSpotsHash||null,spotsHash:want};}
        return{status:'ok',spots:d.spots,from:about.period[0],to:about.period[1],bufferM:about.seaBufferM,hash:about.hash||null};
    }
    /** 연안 사고 집계표 상태를 /meta 에 드러낸다(2026-10-16 T9). sources() 에 넣지 않는 까닭: sources 는 관리자 감시(metadataOnly — risk_spots.json 을 읽지 않아 해시를 비교할 수 없다)와
     * 키·상태가 같아야 한다(test_risk_history_sources). 예: {status:'ok',hash:'4ddc…'} · {status:'stale',riskSpotsHash:'old',spotsHash:'105f…'} · 감시용 저장소 → null
     * @returns {object|null} [연계] ← meta / loadCoastAccidents */
    function coastAccidentsStatus(){const c=coastAccidents;if(metadataOnly||!c)return null;return{status:c.status,...(c.hash?{hash:c.hash}:{}),...(c.lastError?{lastError:c.lastError}:{}),...(c.status==='stale'?{riskSpotsHash:c.riskSpotsHash,spotsHash:c.spotsHash}:{})};}
    /** 연안 상세의 「주변 연안사고」(history)를 만든다. 사고 목록은 집계표 그대로(익수·추락·고립·표류·기타 — 기타는 화면이 「기타(인명)」로 쓴다).
     * 예: coastHistory('26110|BIFF 광장') → {available:true,from:'2020-01-01',to:'2024-12-31',area:'이 관광지 구역과 앞바다 500m',accidents:[{date:'2024-11-19',year:2024,type:'익수',death:0,missing:0,rescue:1},…]}
     *     육지 몫이 없는 6곳(집계표 null)·표에 없는 id·집계표를 못 쓸 때(없음·손상·해시 불일치) → {available:false}
     * @param {string} id - 관광지 id @returns {object} [연계] ← coastDetail → RiskSheet(연안 시트 사고 카드)·RiskMarine.accSummary */
    function coastHistory(id){const c=coastAccidents;if(c?.status!=='ok')return{available:false};const list=c.spots[id];if(!Array.isArray(list))return{available:false};
        return{available:true,from:c.from,to:c.to,area:'이 관광지 구역과 앞바다 '+c.bufferM+'m',accidents:list.map(a=>({date:a.date,year:a.year,type:a.type,death:a.death,missing:a.missing,rescue:a.rescue}))};}
    /** 나무에서 부모와 자식 표출 블록을 각각 꺼낸다. 예: 자식null은 부모 특보로 채우지 않는다. @returns {Map} [연계] ← warningsFor */
    function flattenWarnings(){if(cache.warningMap)return cache.warningMap;const out=new Map();const visit=(n)=>{if(!n||typeof n!=='object')return;for(const [name,v]of Object.entries(n)){if(v&&typeof v==='object'&&Object.hasOwn(v,'children')){out.set(zoneName(name),{name,block:v});for(const [child,b]of Object.entries(v.children||{}))out.set(zoneName(child),{name:child,block:b});}else visit(v);}};visit(cache.warnings.data?.current);cache.warningMap=out;return out;}
    /** 한 구역의 자료상/가정 특보 상태를 가져온다. 예: 해상 예비21시부터 가정, 연안은 예비 그대로; assume=false면 해상도 예비를 승격하지 않는다. @param {string} zone @param {string} t @param {boolean} sea @param {string} [child] @param {boolean} [assume=sea] 예비 가정 여부 @returns {array} [연계] ← details */
    function warningsFor(zone,t,sea,child,assume=sea){const map=flattenWarnings(),end=(sea?T.timeline(clock(),1,2,23):coastTimeline(clock())).at(-1);
        const entry=map.get(zoneName(child||zone));if(!entry||!entry.block)return[];const b=entry.block;
        const blocks=(Object.hasOwn(b,'current')||Object.hasOwn(b,'upcoming'))?[b.current,b.upcoming?{...b.upcoming,preliminary:true}:null]:[b];
        return blocks.map(w=>T.warningAt(w,t,clock(),end,{assumePreliminary:assume})).filter(Boolean);}
    /** 특보 한 건의 기상청 시각(발표 tmFc · 발효/발효 예정 tmEf · 해제 예고 clrNtcTm→tmCc→tmYn→tmEd)을 원문 글자에서 읽는다 — 못 읽으면 null(지어내지 않는다).
     * 글자 해석은 해상 상세·브리핑과 같은 marine_fusion.warnTime(날짜가 없는 「21시」만의 글자는 null, 범위는 {range:true}). 해제 예고는 발효 중 특보만.
     * 예: warnTimes({tmFc:'2026.10.16 14:00',clrNtcTm:'17일 새벽(03시~06시)'},'발효') → {issued:{start:'…16T14:00…',range:false},effective:null,release:{start:'…17T03:00…',end:'…17T06:00…',range:true}}
     * @param {object} w - warningAt 결과(원자료 칸 그대로 든 것) @param {string} state - '발효'|'예비' @returns {{issued:object|null,effective:object|null,release:object|null}}
     * [연계] ← coastScore(notices.times)·coastWarnings / → marine_fusion.warnTime(같은 시각 규칙 — 해상 날씨 상자·브리핑 warningsFromTree) */
    function warnTimes(w,state){const W=require('./marine_fusion').warnTime,now=clock(),issued=W(w.tmFc,now),anchor=issued?Date.parse(issued.start):now;
        return{issued,effective:W(w.tmEf,anchor),release:state==='발효'?W(w.clrNtcTm||w.tmCc||w.tmYn||w.tmEd,anchor):null};}
    /** 관광지 하나에 지금 걸린 특보(풍랑·태풍 = 특보 크롤러 트리의 그 관광지 특보구역, 강풍 = 육상강풍 행)를 기상청 시각과 함께 준다.
     * 브리핑 육상 「특보 해제 뒤 3시간 관심」(2026-10-16 결정 4)이 그날 칸 밖에서 해제되는 특보(예: 오늘 밤 22시 해제 → 내일 00~01시)를 보려고 쓴다. 특보구역 이름도 준다(지난 해제 기록 대조용).
     * 예: coastWarnings('one') → {zones:{warn:'인천·경기남부앞바다',gale:'옹진군'},warnings:[{name:'풍랑주의보',type:'풍랑',level:'주의보',state:'발효',source:'mmis',issued,effective,release}]}
     * @param {string} id - 관광지 id @returns {object} [연계] ← station_briefing_inputs.collectLand / → warningsFor·galeFor·warnTimes */
    function coastWarnings(id){refresh();const p=staticTable?.spots?.find(p=>p.id===id);if(!p)throw Object.assign(new Error('관광지 없음'),{status:staticTable?404:503});const t=T.isoKst(clock()),out=[];
        const add=(w,source)=>{const state=w.state==='발효'?'발효':'예비';out.push({name:w.type+w.level,type:w.type,level:w.level,state,source,...warnTimes(w,state)});};
        if(sources().warnings.status==='ok')for(const w of warningsFor(p.warnZone,t,false))add(w,'mmis');
        if(sources().gale.status==='ok')for(const w of galeFor(p,t))add(w,'gale');
        return{zones:{warn:p.warnZone||null,gale:p.galeZone||null},warnings:out};}
    /** 관광지 육상강풍을 연결한다. 예: 이름 미일치는 status unmatched로 드러낸다. @param {object} spot @param {string} t @returns {array} [연계] ← coastDetail */
    function galeFor(spot,t){if(!spot.galeZone)return[];return(cache.gale.data?.rows||[]).filter(r=>r.live&&zoneName(r.zoneNm)===zoneName(spot.galeZone)).map(r=>T.warningAt({...r,type:'강풍',level:r.lvl.includes('경보')?'경보':r.lvl.includes('예비')?'예비':'주의보',preliminary:r.src.endsWith('Ready')||r.lvl.includes('예비')},t,clock(),coastTimeline(clock()).at(-1),{assumePreliminary:false})).filter(Boolean);}
    /** 자료별 성공·낡음·오류를 분리한다. 예: 파일이 있어도 마지막 요청실패는 error. @returns {object} [연계] ← API responses */
    function sources(fresh=false){refresh(fresh);if(cache.sourceInfo)return cache.sourceInfo;const now=clock(),date=io.day(now),out={};
        for(const key of ['warnings','gale','zoneForecasts','swell','ripCurrent','congestion','accident','tourConcentration','events']){
            const c=cache[key],d=c.data;const at=timestamp((key==='gale'?c.attempt?.checkedAt:null)||d?.updatedAt||d?.savedAt||d?.collectedAt);
            let status=!d?(c.exists?'error':'missing'):'ok';
            const max={warnings:10*60000,gale:10*60000,zoneForecasts:15*T.HOUR,swell:24*T.HOUR}[key];
            if(d&&max&&(!at||now-at>max))status='stale';
            // 해구 예보는 「언제 받았나」만 보면 옛 판(전날 21시 판)을 새로 받아 둔 것도 정상으로 보인다. 판 자체가 하루(24시간)보다
            //   오래됐으면 낡음 — 원천은 하루 2판(00·12UTC)이라 정상이면 가장 새 판도 24시간을 넘지 않는다(2026-10-15 조사).
            if(d&&key==='zoneForecasts'){const base=utcForecast(d.baseTmUtf||d.baseTm);if(Number.isFinite(base)&&now-base>24*T.HOUR)status='stale';}
            const after630=(new Date(now+9*T.HOUR).getUTCHours()*60+new Date(now+9*T.HOUR).getUTCMinutes())>=390;
            if(d&&['congestion','tourConcentration'].includes(key)&&after630&&d.date!==date)status='stale';
            if(d&&key==='events'&&d.month!==date.slice(0,7))status='stale';
            if(c.attempt?.status==='error')status='error';
            out[key]={status,updatedAt:at?T.isoKst(at):null,...(c.attempt?{lastSuccess:timestamp(c.attempt.lastSuccess)?T.isoKst(timestamp(c.attempt.lastSuccess)):null,lastError:c.attempt.lastError||null}:{} )};
        }
        const names=new Set((landZones||[]).map(z=>zoneName(z.properties.name)));out.gale.checkedAt=cache.gale.attempt?.checkedAt||null;out.gale.savedAt=timestamp(cache.gale.data?.savedAt)?T.isoKst(timestamp(cache.gale.data.savedAt)):null;out.gale.rows=cache.gale.data?.rows?.length||0;out.gale.unmatched=(cache.gale.data?.rows||[]).filter(r=>r.live&&!names.has(zoneName(r.zoneNm))).length;
        const rip=cache.ripCurrent.data?.places||{};out.ripCurrent.withData=metadataOnly?(cache.ripCurrent.data?._ripWithData||0):Object.values(rip).filter(r=>r.hasData).length;out.ripCurrent.total=metadataOnly?(cache.ripCurrent.data?._ripTotal||0):Object.keys(rip).length;
        const month=Number(date.slice(5,7));if(cache.ripCurrent.data&&out.ripCurrent.withData===0&&(month<6||month>9))out.ripCurrent.status='offseason';
        for(const key of ['congestion','accident','tourConcentration'])out[key].callsToday=io.read(path.join(dir,key+'_quota.json'))?.date===date?io.read(path.join(dir,key+'_quota.json')).calls:0;
        out.zoneForecasts.base=cache.zoneForecasts.data?.baseTmUtf||cache.zoneForecasts.data?.baseTm||null;
        out.swell.baseTm=cache.swell.data?.baseTm||null;out.swell.frames=cache.swell.data?.fctTimes?.length||0;
        const accident=cache.accident.data,attempt=cache.accident.attempt,local=new Date(now+9*T.HOUR),hour=local.getUTCHours(),base=Date.parse(date+'T00:00:00+09:00');
        const latestWindow=base+(hour>=15?15:hour>=3?3:-9)*T.HOUR,checked=timestamp(attempt?.checkedAt);
        if(accident&&out.accident.status==='ok'&&(accident.date!==date||!checked||checked<latestWindow))out.accident.status='stale';
        Object.assign(out.accident,{createdAt:accident?.createdAt||null,checkedAt:attempt?.checkedAt||null,frames:Object.keys(accident?.frames||{}).length,date:accident?.date||null,source:'한국해양교통안전공단 MTIS 선박사고 위험예보',callCap:attempt?.callCap??90});
        const tour=cache.tourConcentration.data;out.tourConcentration.date=tour?.date||null;out.tourConcentration.spotsMatched=Object.keys(tour?.values||{}).length;out.tourConcentration.spotsTotal=staticTable?.spots?.length||0;
        const observation=cache.tourConcentration.attempt?.observation;if(observation)out.tourConcentration.observation={samples:observation.samples??0,...Object.fromEntries(['firstRun','windowEndsAt','lastObservedAt','lastChangedAt'].map(key=>[key,timestamp(observation[key])?T.isoKst(timestamp(observation[key])):null]))};
        out.events.months={};for(const [month,d]of Object.entries(cache.events.months)){const attempt=cache.events.attempts[month]||(cache.events.attempt?.month===month?cache.events.attempt:null);const status=attempt?.status==='error'?'error':!d?(cache.events.monthExists[month]?'error':'missing'):d.month===month?'ok':'stale';const at=timestamp(d?.collectedAt||d?.updatedAt);out.events.months[month]={status,month,count:d?.events?.length||0,updatedAt:at?T.isoKst(at):null,lastRun:timestamp(attempt?.lastRun)?T.isoKst(timestamp(attempt.lastRun)):null,lastSuccess:timestamp(attempt?.lastSuccess)?T.isoKst(timestamp(attempt.lastSuccess)):null,lastError:attempt?.lastError||null,...(attempt?.sourceCounts?{sourceCounts:attempt.sourceCounts}:{}),...(Number.isInteger(attempt?.failedProvinceCount)?{failedProvinceCount:attempt.failedProvinceCount}:{}),...(typeof attempt?.partialCode==='string'?{partialCode:attempt.partialCode}:{})};}
        // failedProvinceCount: 수집은 성공(status ok — 행사는 점수에 쓰임)했지만 실패한 부분 수(Gemini·카카오로 실패한 시도 수 + 공식 목록 실패면 1, D7).
        //   오류현황 감시가 「일부 실패」로 읽고, partialCode(원인별 분류 이름)를 그 분류로 쓴다(risk_error_history, 2026-10-15 3차 검토 F5·F7).
        const current=out.events.months[date.slice(0,7)];if(current)Object.assign(out.events,current);cache.sourceInfo=out;return out;
    }
    /** 요청시각이 공개 시간범위에 들었는지 확인한다. 예: 2040년 요청은400; 연안 모레 00시도400(「가」 2일 제한). @param {string} t @param {boolean} sea @returns {string} [연계] ← frame/detail */
    function validateTime(t,sea){const n=timestamp(t),now=clock(),times=sea?T.timeline(now,1,2,23):coastTimeline(now);if(!Number.isFinite(n)||!/(?:Z|[+-]\d\d:\d\d)$/.test(String(t))||n<now-5*60000||n>timestamp(times.at(-1)))throw Object.assign(new Error('잘못된 예보 시각'),{status:400});return T.isoKst(n);}
    /** 자료를 해구·선택시각에 맞춘다. 예: 자료끝 밖에 이전예보를 연장하지 않는다.
     * 그날 하루 최대값(dayMax)은 3일째 특보급 안내에만 쓰였으므로 「가」(2026-10-15)로 그 안내와 함께 뺐다.
     * @param {number} major @param {string} t @returns {object} [연계] ← detail / marine_fusion(weather) */
    function forecast(major,t){const rows=cache.zoneForecasts.data?.data?.[String(major)]||[];const times=rows.map(r=>utcForecast(r.tm)).filter(Number.isFinite);const target=timestamp(t);const inside=times.length&&target>=Math.min(...times)-1.5*T.HOUR&&target<=Math.max(...times)+1.5*T.HOUR;
        const r=inside?T.nearest(rows,t,x=>utcForecast(x.tm)):null;
        const number=x=>x!==null&&x!==''&&x!==undefined&&Number.isFinite(Number(x))&&Number(x)>=0?Number(x):null;
        return {wh:number(r?.wh),ws:number(r?.ws),wp:number(r?.wp),wd:number(r?.waveDir),windDir:number(r?.windDir),forecastAt:r?T.isoKst(utcForecast(r.tm)):null};}
    /** 소해구 너울을 범위 안에서만 가져온다. 예: 너울 예보 끝보다 1.5시간 넘게 뒤면 null. @param {string} key @param {string} t @returns {object|null} [연계] ← coastDetail */
    function swell(key,t){const data=cache.swell.data,c=data?.cells?.[key];if(!c)return null;const rows=(data.fctTimes||[]).map((x,i)=>{const m=String(x).match(/(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/);return{t:m?Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5])-9*T.HOUR:NaN,periodS:c.wp?.[i]};});const valid=rows.filter(r=>Number.isFinite(r.t)),target=timestamp(t);if(!valid.length||target<valid[0].t-1.5*T.HOUR||target>valid.at(-1).t+1.5*T.HOUR)return null;const r=T.nearest(valid,t);return r?.periodS!=null?{periodS:Number(r.periodS)}:null;}
    /** 이안류는 오늘 관측만 연결한다. 예: 어제 관측 파일을 오늘 위험으로 연장하지 않는다.
     * @param {string} name - 해수욕장 @param {string} t - 선택 시각 @returns {object|null} 오늘 관측 [연계] ← coastDetail
     */
    function ripFor(name,t){const r=cache.ripCurrent.data?.places?.[name];if(!r)return null;const at=timestamp(r.obsrvnDt||cache.ripCurrent.data.updatedAt);if(!at||T.dateKey(at)!==T.dateKey(clock())||T.dateKey(t)!==T.dateKey(clock()))return null;return r;}
    /** 정적 관광지 표를 화면 계약으로 준다. 예: id와분할geometry는 빌드결과 그대로. @returns {object} [연계] ← /coast/spots */
    function spots(){refresh();if(!staticTable?.spots)throw Object.assign(new Error('관광지 표 준비 전'),{status:503});return{v:staticTable._about?.hash,spots:staticTable.spots.map((p,i)=>({i,id:p.id,name:p.name,lat:p.lat,lon:p.lon,sggName:p.sgg_name,addr:null,police:p.station?{name:p.station}:null,beach:p.beach,geometry:p.geometry}))};}
    /** 한 연안 지점 설명을 같은 계산기로 만든다(시각 하나). 예: 집중률이 없어도 정적위험과달은계산 · 사람 혼잡은 그 날 집중률과 수집기가 저장한 30일 기하평균(avg30, U81③)을 함께 넘긴다.
     * @param {string} id @param {string} t @returns {object} 한 시각 상세(detailCache 에 보관 — 같은 객체를 돌려준다)
     * [연계] ← coastDetail(한 칸)·coastDayDetail(그날 칸마다 — 가장 높은 칸 찾기, T24)·slotScores(연안 지도 칸 점수) */
    function coastScore(id,t){refresh();const p=staticTable?.spots?.find(p=>p.id===id);if(!p)throw Object.assign(new Error('관광지 없음'),{status:staticTable?404:503});t=validateTime(t,false);const memo=resultKey('coast',t,id);if(detailCache.has(memo))return detailCache.get(memo);const d=T.dateKey(t),f=forecast(p.major,t),src=sources(),cr=src.tourConcentration.status==='ok'?cache.tourConcentration.data?.values?.[id]?.[d]:null,crBase=src.tourConcentration.status==='ok'?cache.tourConcentration.data?.avg30?.[id]||null:null;const eventMonth=cache.events.months[d.slice(0,7)];const events=src.events.months[d.slice(0,7)]?.status==='ok'&&eventMonth?.month===d.slice(0,7)?eventMonth.events.filter(e=>e.spotId===id&&e.start<=d&&e.end>=d):null;
        const warning=warningsFor(p.warnZone,t,false).concat(galeFor(p,t));const r=S.scoreCoast({t,now:clock(),spot:p,concentration:typeof cr==='number'?cr:null,concentrationBase:crBase,events,swell:swell(p.coastCell,t),rip:ripFor(p.ripBeach,t),warnings:warning,...f});
        // times: 특보마다 기상청이 준 발표·발효(예정)·해제 예고 시각(warnTimes) — 시트·브리핑이 칸 대신 실제 시각을 쓴다(2026-10-16 결정 1).
        const notices=[];if(r.notices.effective.length||r.notices.prelim.length)notices.push({key:'warning',effective:r.notices.effective.map(w=>w.type+w.level),prelim:r.notices.prelim.map(w=>w.type+w.level),times:r.notices.prelim.map(w=>({name:w.type+w.level,state:'예비',...warnTimes(w,'예비')})).concat(r.notices.effective.map(w=>({name:w.type+w.level,state:'발효',...warnTimes(w,'발효')})))});if(r.notices.windMs!==null)notices.push({key:'drift',windMs:r.notices.windMs});
        const rows=r.factors.map(x=>({...x,key:x.key==='concentration'?'people':x.key,used:x.applied, ...(x.key==='hazard'?{zones:(x.zones||[]).map(z=>({id:z.id,place:z['장소명'],shape:z['장소형태'],class:z['구역분류'],addr:z['주소'],police:z['관할파출소'],office:officeOf(z['관할파출소'],{office:z['소속서']})}))}:{}),...(x.key==='event'&&x.events?.length?{src:x.events[0].src,sourceType:x.events[0].sourceType||'gemini',contentId:x.events[0].contentId||null,dateRange:[x.events[0].start,x.events[0].end]}:{})}));
        // 과제4: 행사·특보가 '없음'이면 자료 파일은 정상(ok)+빈 목록이라 missing 에 들지 않는다. 받지 못했을 때(missing/stale/error)만 아래에서 들어간다.
        // 이안류 비수기(offseason)는 정상 상태라 반환 직전에 missing 에서 뺀다.
        if(sources().events.months[d.slice(0,7)]?.status!=='ok')r.missing.push('events');if(sources().warnings.status!=='ok')r.missing.push('warnings');if(sources().gale.status!=='ok')r.missing.push('gale');if(f.wh===null||f.ws===null)r.missing.push('forecast');
        return remember(detailCache,memo,{t,title:p.name,subtitle:{addr:null,lat:p.lat,lon:p.lon,sggName:p.sgg_name,police:p.station||null,office:officeOf(p.station,{lat:p.lat,lon:p.lon})},score:r.score,index:r.index,band:r.band,rr:r.rr,fatalRr:r.fatalRr,notices,rows,missing:[...new Set(r.missing)].filter(k=>k!=='rip'||sources().ripCurrent.status!=='offseason'),inputs:{forecastAt:f.forecastAt}},6000);}
    /** 연안 한 칸 상세: 그 시각 상세 + 주변 연안사고(history — coastHistory, 2026-10-16 T9).
     * 종전(T7)에는 시트 시각 막대 칸 색용 outlook(시각별 점수)도 붙였으나, T24(2026-10-16 「5-하루 하나로 합치기」)로 연안 시트 시각 막대를 없애 함께 뺐다.
     * 예: coastDetail('one','2026-10-31T18:00:00+09:00') → {t,title,score,index,band,rows,missing,notices,history,…}
     * @param {string} id - 관광지 id @param {string} t - 칸 시각 @returns {object} 한 칸 상세 [연계] ← coastDayDetail(가장 높은 칸)·검사 */
    function coastDetail(id,t){return{...coastScore(id,t),history:coastHistory(id)};}
    /** 연안 하루 값(T24)의 칸 — t 가 든 KST 날짜의 연안 시간축 칸들. 오늘은 지금 칸부터(지난 칸은 연안 시간축에 없다 — 서버는 지금−5분 앞 시각을 400 으로 거부), 내일은 00·03·…·21시 8칸.
     * 지금 칸은 분 단위로 내린다 — 같은 1분 안의 요청이 같은 칸이 되어 칸 점수 보관(coastSlots)을 함께 쓴다(종전 연안 프레임은 요청 시각마다 새로 셌다).
     * 예: 지금 10-31 12:17:40, t 가 10-31 의 어느 시각 → {date:'2026-10-31',times:['…T12:17:00+09:00','…T15:00…','…T18:00…','…T21:00…']}
     *     t 가 11-01 → 11-01 00·03·…·21시 8칸 · 모레·지난 시각 → 400(validateTime) · 그 날짜 칸이 없으면(자정 직후 어제 날짜) 400
     * @param {string} t - 그 날짜 안의 시각(화면은 그 날짜의 첫 칸 — 오늘은 meta.now, 내일은 00시 — 를 보낸다) @returns {{date:string,times:string[]}}
     * [연계] ← coastDayFrame·coastDayDetail / → coastTimeline·validateTime */
    function coastDay(t){t=validateTime(t,false);const date=T.dateKey(t),times=coastTimeline(Math.floor(clock()/60000)*60000).filter(at=>T.dateKey(at)===date);if(!times.length)throw Object.assign(new Error('잘못된 예보 시각'),{status:400});return{date,times};}
    /** 연안 하루 값의 안내(특보·표류)를 그날 칸 전부에서 모은다(설계서 §16.1 ②, 사용자 2026-10-16 「모두 추천대로」).
     * 연안 특보·표류 바람은 점수에 들지 않아(risk_score.scoreCoast 의 notices) 가장 높은 칸과 특보 칸이 다를 수 있다 — 가장 높은 칸 것만 보이면 그날 다른 칸의 특보가 시트에서 빠진다.
     * 같은 안내(특보는 이름+발효/예비, 표류는 하나)가 이어진 칸에 있으면 하나로 묶는다(from=첫 칸·to=끝 칸 시각). 끊겼다 다시 나오면 따로. 순서는 처음 나온 칸 → 그 칸 안 예비·발효·표류 순.
     * 표류 windMs 는 묶은 칸 중 가장 센 바람.
     * 특보는 기상청 시각도 함께 준다(2026-10-16 결정 1, 사용자 *"발표, 발효, 해제의 시각은 이미 기상청으로부터 제공이 되는 거니까 그 시각에 맞춰서 그냥 표출"*):
     *   issued(발표)·effective(발효/발효 예정 — 예비특보는 이것이 예정 시각)·release(해제 예고, 발효만) = 그 묶음 첫 칸 특보의 warnTimes. 못 읽은 시각은 null → 화면은 그때만 칸 시각(「칸 기준」).
     * 예: 칸 [12:17,15,18,21] 중 15·18시에 풍랑주의보 발효, 21시에 바람 9m/s →
     *     [{key:'warning',name:'풍랑주의보',state:'발효',from:'…T15:00…',to:'…T18:00…',issued:{…},effective:null,release:{start,end,range}},{key:'drift',windMs:9,from:'…T21:00…',to:'…T21:00…'}]
     * @param {string[]} times - 그날 칸 시각(coastDay) @param {object[]} slots - 칸마다 coastScore 결과(같은 순서) @returns {object[]} 묶은 안내
     * [연계] ← coastDayDetail(daily.notices) → RiskSheet.dayNotices(「15시~ 풍랑주의보 발효」·「21시 무렵 이 앞바다 바람」) */
    function dayNotices(times,slots){const out=[],last=new Map();const add=(id,i,base,wind)=>{const s=last.get(id);if(s&&s.i===i)return;if(s&&s.i===i-1){s.i=i;s.v.to=times[i];if(wind!==undefined)s.v.windMs=Math.max(s.v.windMs,wind);return;}const v={...base,...(wind!==undefined?{windMs:wind}:{}),from:times[i],to:times[i]};out.push(v);last.set(id,{i,v});};
        const kma=(n,state,name)=>{const x=(n.times||[]).find(q=>q.state===state&&q.name===name)||{};return{issued:x.issued||null,effective:x.effective||null,release:x.release||null};};
        slots.forEach((r,i)=>{for(const n of r.notices||[]){if(n.key==='warning'){for(const name of n.prelim||[])add('예비|'+name,i,{key:'warning',name,state:'예비',...kma(n,'예비',name)});for(const name of n.effective||[])add('발효|'+name,i,{key:'warning',name,state:'발효',...kma(n,'발효',name)});}else if(n.key==='drift')add('drift',i,{key:'drift'},n.windMs);}});return out;}
    /** 연안 상세 하루 값(T24, 사용자 2026-10-16 「1. 가」 = 그날 3시간 칸 8개 중 가장 높은 값): 그날 칸마다 점수를 내 가장 높은 칸의 상세를 준다.
     * 같은 최댓값이 여러 칸이면 이른 칸. 시트의 요소별 설명은 이 칸의 것이다. 안내(특보·표류)는 그날 칸 전부에서 모아 daily.notices 로 준다(dayNotices — §16.1 ②, 2026-10-16).
     * 위의 notices(가장 높은 칸 것)는 그대로 둔다 — 화면은 daily.notices 가 있으면 그것을 쓴다.
     * missing 은 그날 모든 칸의 빠진 요소를 합친다 — 한 칸이라도 요소를 확인하지 못했으면 그 하루 값은 「확인된 요소 기준」이다
     * (기존 결측 관례: 칸 상세의 missing 이 있으면 시트 상자 「확인된 요소 기준의 상대 사고지표」·계산 설명 「현재 확인된 요소만 반영한 값」. 점수를 지어내지 않는다).
     * 예: coastDayDetail('one','2026-11-01T00:00:00+09:00') → {…11-01 의 가장 높은 칸 상세, daily:{date:'2026-11-01',peakAt:'…T03:00:00+09:00',times:[8칸],notices:[…]}}
     * @param {string} id - 관광지 id @param {string} t - 그 날짜 안의 시각 @returns {object} 가장 높은 칸 상세 + history + daily{date,peakAt,times,notices}
     * [연계] ← GET /coast/spot → RiskForecast.detail → RiskSheet.show(날짜 줄 아래 「가장 높은 때 HH시 기준」·안내는 dayNotices) */
    function coastDayDetail(id,t){const {date,times}=coastDay(t),slots=times.map(at=>coastScore(id,at));let k=0;slots.forEach((r,i)=>{if(r.score>slots[k].score)k=i;});
        return{...coastDetail(id,times[k]),missing:[...new Set(slots.flatMap(r=>r.missing))],daily:{date,peakAt:times[k],times,notices:dayNotices(times,slots)}};}
    /** 위치표를 전달한다. 예: 아직수집전이면503. @returns {object} [연계] ← /sea/cells */
    function cells(){refresh();if(!cache.cells.data?.cells?.length)throw Object.assign(new Error('해양교통 칸 위치표 준비 전'),{status:503});return cache.cells.data;}
    /** 한 해상 칸 설명을 계산한다. 예: 수집실패시 null혼잡과날씨만 표시. @param {string} id @param {string} t @returns {object} [연계] ← /sea/cell/frame */
    function seaDetail(id,t){refresh();const c=cells().cells.find(c=>c.id===id);if(!c)throw Object.assign(new Error('해상 칸 없음'),{status:404});t=validateTime(t,true);const memo=resultKey('sea',t,id);if(detailCache.has(memo))return detailCache.get(memo);const n=new Date(timestamp(t)+9*T.HOUR),frame=T.dateKey(t).replace(/-/g,'')+String(n.getUTCHours()).padStart(2,'0')+'00',traffic=sources().congestion.status==='ok'?cache.congestion.data?.frames?.[frame]:null,row=traffic?.find(r=>r.gridId===id);
        const f=forecast(c.haegu?.major,t),warning=warningsFor(c.warnZone,t,true,c.warnSubZone);const r=S.scoreSea({t,now:clock(),ci:row?.congestionIndex??null,warnings:warning,...f});
        const rows=r.factors.map(x=>({...x,key:x.key,used:x.applied,cond:x.forecastOnly?'fcst_only':x.key==='wave'&&x.rr?'wave4m':x.key==='wind'&&x.rr?(f.ws>=17?'wind17':'wind14'):null,...(x.key==='congestion'?{level:r.ciLevel,levelName:r.ciLevel===null?null:['낮음','보통','높음','매우높음'][r.ciLevel]}:{}),...(x.key==='warning'?{name:x.type+x.level,assumedFromHour:x.from?new Date(timestamp(x.from)+9*T.HOUR).getUTCHours():null}:{})}));
        if(sources().warnings.status!=='ok')r.missing.push('warnings');
        return remember(detailCache,memo,{t,title:c.haegu||{major:null,sub:null},subtitle:c.ref||null,clickable:r.clickable,score:r.score,index:r.index,band:r.band,rr:r.rr,officialCongestionLevel:row?.congestionLevel||null,rows,kinds:{sensitive:{rr:r.rr},collision:{rr:r.collisionRr,status:r.collisionRr===null?'withheld':r.picked?'ok':'none'}},inputs:{forecastAt:f.forecastAt,zoneForecastBase:cache.zoneForecasts.data?.baseTmUtf||null,congestionCreated:timestamp(row?.fcstCreateDateTime)?T.isoKst(timestamp(row.fcstCreateDateTime)):null},missing:r.missing},6000);}
    /** 공식 사고 시간대를 이전3시간정시로 고른다. 예:13시는12시원본,보간없음; 내일 23:59는 내일21시, 모레00시는400.
     * 범위는 오늘00시~내일23:59(수집기 16칸과 같은 2일 — 「해상 공식 사고예보는 2일까지만」 2026-10-15). 배포 전 24칸 저장본의 모레 칸도 이 검사로 내보내지 않는다.
     * @param {string} t - 선택시각 @returns {object} t,key,forecastAt [연계] ← accidentFrame/Detail / 혼잡시간과별도표시
     */
    function accidentTime(t){const n=timestamp(t),now=clock(),base=Date.parse(T.dateKey(now)+'T00:00:00+09:00');if(!Number.isFinite(n)||!/(?:Z|[+-]\d\d:\d\d)$/.test(String(t))||n<base||n>base+T.DAY+23*T.HOUR+59*60000)throw Object.assign(new Error('잘못된 사고예보 시각'),{status:400});const at=base+Math.floor((n-base)/(3*T.HOUR))*3*T.HOUR,local=new Date(at+9*T.HOUR);return{t:T.isoKst(n),forecastAt:T.isoKst(at),key:T.dateKey(at).replace(/-/g,'')+String(local.getUTCHours()).padStart(2,'0')+'00'};}
    /** 공식 경계표를 한번 제공한다. 예:사고격자와혼잡ID는별개.
     * @returns {object} cells,v [연계] ← /sea/accident-cells / 프레임에는경계중복안함
     */
    function accidentCells(){refresh();const d=cache.accident.data;if(!d?.cells?.length)throw Object.assign(new Error('공식 선박사고 격자 준비 전'),{status:503});return{v:d.v,cells:d.cells,geometrySource:d.geometrySource};}
    /** 공식 지수·단계배열을 반환한다. 예:수집실패시지난정상본은낡음표시와함께유지.
     * @param {string} t - 선택시각 @returns {object} 선택원본시각과공식행 [연계] ← /sea/accident-frame / 재계산안함
     */
    function accidentFrame(t){refresh();const slot=accidentTime(t),d=cache.accident.data,values=d?.frames?.[slot.key];if(!Array.isArray(values)||!values.length)throw Object.assign(new Error('해당 시각 공식 선박사고 예보 준비 전'),{status:503});return{...slot,v:d.v,createdAt:d.createdAt,cells:values,degraded:sources().accident.status==='ok'?[]:['accident']};}
    /** 실제 클릭좌표에서 공식 사고와 혼잡칸을 각각 연결한다. 예:같은사고칸양쪽은다른혼잡칸.
     * @param {string} id - 사고격자ID @param {string} t - 선택시각 @param {object} point - lon/lat
     * @returns {object} 공식사고·원본혼잡·기상청해구예보 [연계] ← /sea/accident-cell / 임의가중/일대일ID매칭금지
     */
    function accidentDetail(id,t,point={}){refresh();const c=accidentCells().cells.find(c=>c.id===id);if(!c)throw Object.assign(new Error('사고 격자 없음'),{status:404});const frame=accidentFrame(t),row=frame.cells.find(r=>r[0]===c.i);if(!row)throw Object.assign(new Error('해당 격자 사고예보 준비 전'),{status:503});
        const hasPoint=point.lon!==undefined||point.lat!==undefined,lon=hasPoint?Number(point.lon):c.lon,lat=hasPoint?Number(point.lat):c.lat;
        if((hasPoint&&[point.lon,point.lat].some(v=>v===null||v===''||v===undefined||Array.isArray(v)))||!Number.isFinite(lon)||!Number.isFinite(lat)||!G.pointInGeometry([lon,lat],c.geometry))throw Object.assign(new Error('사고 격자 안의 클릭 좌표 필요'),{status:400});
        const n=new Date(timestamp(frame.t)+9*T.HOUR),trafficAt=T.isoKst(Math.floor(timestamp(frame.t)/T.HOUR)*T.HOUR),key=T.dateKey(frame.t).replace(/-/g,'')+String(n.getUTCHours()).padStart(2,'0')+'00',traffic=cache.congestion.data?.frames?.[key]||[];
        const matches=(cache.cells.data?.cells||[]).filter(v=>Number.isFinite(v.lon)&&Number.isFinite(v.lat)&&Math.abs(v.lon-lon)<=.0125+1e-10&&Math.abs(v.lat-lat)<=.0125+1e-10).sort((a,b)=>a.id.localeCompare(b.id));
        const all=matches.map(v=>{const r=traffic.find(r=>r.gridId===v.id);return r?{gridId:r.gridId,congestionIndex:r.congestionIndex,congestionLevel:r.congestionLevel||null,forecastAt:trafficAt,createdAt:timestamp(r.fcstCreateDateTime)?T.isoKst(timestamp(r.fcstCreateDateTime)):null}:null;}).filter(Boolean),candidate=forecast(c.haegu?.major,frame.forecastAt),f=candidate.forecastAt===frame.forecastAt?candidate:{wh:null,ws:null,wp:null,wd:null,windDir:null,forecastAt:null},missing=[];
        if(sources().accident.status!=='ok')missing.push('accident');if(!all.length||sources().congestion.status!=='ok')missing.push('congestion');if(['wh','ws','wp','wd'].some(k=>f[k]===null))missing.push('forecast');
        return{t:frame.t,v:frame.v,title:c.haegu||{major:null,sub:null},subtitle:c.ref||null,gridId:c.id,lat:c.lat,lon:c.lon,accidentRiskIndex:row[1],accidentRiskLevel:row[2],forecastAt:frame.forecastAt,createdAt:frame.createdAt,weather:{wh:f.wh,ws:f.ws,wp:f.wp,wd:f.wd,windDir:f.windDir,forecastAt:f.forecastAt,source:'기상청 해구별 예보',major:c.haegu?.major||null,base:cache.zoneForecasts.data?.baseTmUtf||null},congestion:all[0]||null,congestionMatches:all,queryPoint:{lon,lat},matchingAt:{lon,lat,method:hasPoint?'클릭 위치 공간 포함':'격자 중심 공간 포함'},missing};}
    /** 지도용 작은 숫자배열을 만든다. 예: 해상시각 응답에없는칸은빼되 전체실패면날씨만. @param {boolean} sea @param {string} t @returns {object} [연계] ← /frames */
    function frame(sea,t){refresh();t=validateTime(t,sea);const memo=resultKey(sea?'seaFrame':'coastFrame',t);if(frameCache.has(memo))return frameCache.get(memo);const src=sources(),degraded=Object.entries(src).filter(([k,v])=>(sea?['warnings','zoneForecasts','congestion']:['warnings','gale','zoneForecasts','swell','ripCurrent','tourConcentration','events']).includes(k)&&!['ok','offseason'].includes(v.status)).map(([k])=>k);
        if(sea){const n=new Date(timestamp(t)+9*T.HOUR),key=T.dateKey(t).replace(/-/g,'')+String(n.getUTCHours()).padStart(2,'0')+'00';const traffic=src.congestion.status==='ok'?cache.congestion.data?.frames?.[key]:null,active=traffic?new Set(traffic.map(r=>r.gridId)):null,trafficById=new Map((traffic||[]).map(r=>[r.gridId,r]));return remember(frameCache,memo,{t,cells:cells().cells.filter(c=>!active||active.has(c.id)).map(c=>{const r=seaDetail(c.id,t);return[c.i,r.score,r.rows[0]?.ci??null,trafficById.get(c.id)?.congestionLevel||null];}),degraded},8);}
        const eventStatus=src.events.months[T.dateKey(t).slice(0,7)]?.status;if(eventStatus==='ok'){const i=degraded.indexOf('events');if(i>=0)degraded.splice(i,1);}else if(!degraded.includes('events'))degraded.push('events');
        if(!staticTable)throw Object.assign(new Error('관광지 표 준비 전'),{status:503});const entries=Array.from(slotScores(t),(s,i)=>[i,s]);return remember(frameCache,memo,{t,day:T.dayOffset(t,clock()),spots:entries,degraded},8);}
    /** 연안 한 칸의 관광지별 점수를 관광지 표 순서로 준다(쓸 때마다 가장 최근으로 옮기는 보관 — 오늘·내일 칸이 서로 밀어내지 않게, 16칸).
     * 예: slotScores('2026-11-01T12:00:00+09:00') → Float64Array(1354) [0.41, 1.2, …]
     * @param {string} at - 검사한(validateTime) 칸 시각 @returns {Float64Array} [연계] ← frame(연안)·coastDayFrame / → coastScore */
    function slotScores(at){const memo=resultKey('coastSlot',at);return remember(coastSlots,memo,coastSlots.get(memo)||Float64Array.from(staticTable.spots,p=>coastScore(p.id,at).score),16);}
    /** 연안 지도 하루 값(T24, 사용자 2026-10-16 「1. 가」): 관광지마다 그날 칸(coastDay) 점수 중 가장 높은 값.
     * 예: coastDayFrame('2026-11-01T00:00:00+09:00') → {t:'…11-01T00:00…',day:1,spots:[[0,1.7],…],degraded,daily:{date:'2026-11-01',times:[8칸]}}
     * degraded 는 그 날짜 첫 칸 프레임의 것 — 원천 상태와 그 날짜 달의 행사 상태로 정해져 같은 날짜 안에서는 같다.
     * @param {string} t - 그 날짜 안의 시각 @returns {object} 종전 연안 프레임과 같은 모양(spots [i,점수]) + daily
     * [연계] ← GET /coast/frame → RiskMapLayer.drawCoast / → frame(첫 칸)·slotScores(칸마다 — 보관해 다시 세지 않는다) */
    function coastDayFrame(t){const {date,times}=coastDay(t),base=frame(false,times[0]),slots=times.map(slotScores);return{...base,spots:base.spots.map(([i],k)=>[i,Math.max(...slots.map(s=>s[k]))]),daily:{date,times}};}
    /** 첫로드에 시간축·정적표버전·자료상태를 함께 준다. 예: 지금칸은 분유지; 연안은 내일 21시까지(「가」 — 3일째 시작 표시 day3From 없음); 공식 사고는 오늘00시~내일21시 16칸(A.slots, 2026-10-15 2일 제한). @returns {object} [연계] ← /meta */
    function meta(){refresh();const now=clock();return{now:T.isoKst(now),coastAccidents:coastAccidentsStatus(),timeline:{sea:{stepH:1,times:T.timeline(now,1,2,23)},accident:{stepH:3,times:A.slots(now).map(s=>s.at)},coast:{stepH:3,times:coastTimeline(now)}},versions:{spots:staticTable?._about?.hash||null,cells:cache.cells.data?.cells?.length||0,accident:cache.accident.data?.v||null},sources:sources()};}
    /** 클릭한 위험구역 원본을 준다. 예: 동일id의 폴리곤만. @param {string[]} ids @returns {object} [연계] ← /hazard-zones */
    function hazards(ids){const all=io.read(path.join(configDir,'coastal_hazard_zones.wgs84.geojson'));if(!all)throw Object.assign(new Error('위험구역 자료 준비 전'),{status:503});return{type:'FeatureCollection',features:all.features.filter(f=>ids.includes(f.properties.name))};}
    /** 21개 섬 외곽선 원본(island_outlines.geojson)만 준다. 예: {type:'FeatureCollection',features:[…21]}.
     * 종전엔 risk_spots.json 의 공통 육지 geometry(landGeometry, 운영 응답 5.48MB 중 5.46MB)를 함께 실었으나 화면은 features 만 쓴다
     * (risk_map_layer.boundaries — 육지는 /api/ocean/land-mask 로 따로 받는다). 2026-10-16 T5 버벅임 1단계에서 뺐다.
     * landGeometry 를 쓰는 서버 코드(coastal_events_collector)·검사(test_risk_static)는 risk_spots.json 파일을 직접 읽는다.
     * @returns {object} 섬 FeatureCollection [연계] ← /islands → RiskMapLayer.boundaries */
    function islands(){return{...io.read(path.join(configDir,'island_outlines.geojson'))};}
    /** 공유 예보 캐시를 복제하지 않고 해상 통합 분석에 제공한다. 예: 기상 조회는 기존 forecast 재사용.
     * @returns {object} 예보·경계·상태·버전 @param 없음
     * [연계] ← marine_fusion / 원천 파일과 기상 캐시의 중복 상주를 막는다.
     */
    // warnings: 특보 크롤러 결과 파일(weather_alerts.json) 그대로 — 해상 상세 특보 상자(marine_fusion.warningsAt)가 current 트리를 읽는다. 상태는 sources().warnings(10분 넘으면 낡음).
    function marineInputs(){refresh();return{version:inputVersion,congestion:cache.congestion.data,accident:cache.accident.data,cells:cache.cells.data,warnings:cache.warnings.data,sources:sources(),weather:forecast};}
    return{sourceFiles,meta,sources,spots,cells,accidentCells,accidentFrame,accidentDetail,coastDetail,coastDayDetail,coastWarnings,seaDetail,frame,coastDayFrame,hazards,islands,marineInputs,invalidate(){loadedAt=-Infinity;}};
}
module.exports={createStore,zoneName,timestamp,utcForecast};
