/**
 * 역할: 연안 점수·공식 선박사고 예보·혼잡·해구 기상을 읽고 변경 없는 원천 객체를 재사용한다.
 * [연계] risk_points/time/score/geo, sea_accident_collector의 배열·경계 → routes/risk_forecast.
 * [로드 순서] 서버 require에 수집 부작용 없음. 기존 수집 파일은 절대로 쓰지 않는다.
 */
'use strict';
const fs=require('fs'),path=require('path');
const io=require('./risk_collector_io'),T=require('./risk_time'),S=require('./risk_score'),G=require('./risk_geo'),A=require('./sea_accident_collector');
const ROOT=path.join(__dirname,'..'),CLIENT=path.join(ROOT,'..','client');
/** 구역의 공백·점표기를 통일한다. 예: 인천.경기→인천·경기. @param {string} s @returns {string} [연계] ← flattenWarnings */
function zoneName(s){return String(s||'').replace(/\./g,'·').replace(/\s/g,'');}
/** 기존 파일 갱신시간을 해석한다. 예: 오전/오후 한국어 날짜도 KST로. @param {string|number} s @returns {number|null} [연계] ← sourceStatus */
function timestamp(s){if(typeof s==='number')return s;const v=String(s||'');const k=v.match(/^(\d{4})\.\s*(\d+)\.\s*(\d+)\.\s*(오전|오후)\s*(\d+):(\d+):(\d+)/);if(k){let h=+k[5]%12;if(k[4]==='오후')h+=12;return Date.UTC(+k[1],+k[2]-1,+k[3],h,+k[6],+k[7])-9*T.HOUR;}const wall=/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(v)?v.replace(' ','T')+'+09:00':v;const d=Date.parse(wall);return Number.isFinite(d)?d:null;}
/** 10자리 UTC 해구 예보시각을 읽는다. 예: 2026101000→09시KST. @param {string} tm @returns {number} [연계] ← forecast */
function utcForecast(tm){const m=/^(\d{4})(\d{2})(\d{2})(\d{2})$/.exec(String(tm));return m?Date.UTC(+m[1],+m[2]-1,+m[3],+m[4]):NaN;}
/** 화면은 원본을 읽고 오류 감시는 readData/metadataOnly로 같은 신선도 규칙만 재사용한다.
 * 폴더 안 실제 자료를 읽는 저장소를 만든다. 예: 검사에서는 임시자료만 읽는다. @param {object} options @returns {object} [연계] ← API/검사 */
function createStore({dir=io.DEFAULT_DIR,dataDir=path.join(ROOT,'data'),configDir=path.join(ROOT,'config','coastal_safety'),clientDir=CLIENT,clock=Date.now,readData=io.read,metadataOnly=false}={}){
    let loadedAt=-Infinity,loadedDay=null,inputVersion=0,inputSignature=null,cache={},staticTable=null,zones=null,landZones=null;
    const detailCache=new Map(),frameCache=new Map(),fileCache=new Map();
    /** 최근 유한 개수의 결과만 보관한다. 예: 슬라이더 왕복은 같은 입력을 재계산하지 않는다. @param {Map} map @param {string} key @param {object} value @param {number} limit @returns {object} [연계] ← detail/frame */
    function remember(map,key,value,limit){if(map.has(key))map.delete(key);map.set(key,value);while(map.size>limit)map.delete(map.keys().next().value);return value;}
    /** 같은 날짜·입력·상태의 계산만 재사용한다. 예: 특보 낡음 전환도 별도 키. @param {string} kind @param {string} t @param {string} id @returns {string} [연계] ← detail/frame */
    function resultKey(kind,t,id=''){return JSON.stringify([inputVersion,T.dateKey(clock()),kind,t,id,Object.entries(sources()).map(([k,v])=>[k,v.status]),sources().events.months]);}
    /** 읽을 원천 파일을 같은 날짜 규칙으로 열거한다. 예: 월경계의 행사만 포함.
     * @returns {string[]} 파일 경로 [연계] refresh / risk_history_sources의 순차 메타 읽기
     */
    function sourceFiles(){const now=clock();
        const visibleMonths=new Set(T.timeline(now,3,3,21).map(t=>T.dateKey(t).slice(0,7)));
        const files=['weather_alerts.json','gale_warnings.json','zone_forecasts.json','ripcurrent_index.json','swell_smallzone.json.gz'].map(f=>path.join(dataDir,f));
        files.push(...['sea_traffic.json.gz','sea_accident.json.gz','accident_status.json','accident_quota.json','tour_concentration.json','sea_cells.json','events_status.json','congestion_status.json','tourConcentration_status.json','gale_status.json','congestion_quota.json','tourConcentration_quota.json'].map(f=>path.join(dir,f)));
        for(const month of visibleMonths)for(const suffix of ['.json','_status.json'])files.push(path.join(dir,'events_'+month.replace('-','')+suffix));
        if(!metadataOnly)files.push(path.join(configDir,'risk_spots.json'),path.join(clientDir,'assets','warn_zones.geojson'),path.join(clientDir,'assets','warn_zones_land_coastal.geojson'));
        return files;
    }
    /** 읽기 결과를 30초 공유한다. 예: JSON 손상은 missing이 아니라 error. @returns {object} [연계] ← 모든 GET */
    function refresh(force=false){const now=clock(),today=io.day(now);if(!force&&today===loadedDay&&now-loadedAt<30000)return cache;
        const visibleMonths=new Set(T.timeline(now,3,3,21).map(t=>T.dateKey(t).slice(0,7)));
        const files=sourceFiles();
        const version=files.map(file=>{try{const st=fs.statSync(file);return[file,st.mtimeMs,st.size,st.ino];}catch{return[file,null];}});
        // 전체 버전은 그대로 무효화하되, 변경되지 않은 파일 객체는 다시 JSON.parse 하지 않는다.
        const fileVersions=new Map(version.map(v=>[v[0],JSON.stringify(v.slice(1))]));
        for(const file of fileCache.keys())if(!fileVersions.has(file))fileCache.delete(file);
        const readFile=file=>{const signature=fileVersions.get(file),previous=fileCache.get(file);
            if(previous?.signature===signature)return previous.result;
            const result={data:signature==='[null]'?null:readData(file),exists:signature!=='[null]'};
            fileCache.set(file,{signature,result});return result;};
        const signature=JSON.stringify(version),changed=signature!==inputSignature;if(changed){inputSignature=signature;inputVersion++;detailCache.clear();frameCache.clear();staticTable=null;zones=null;landZones=null;}
        loadedAt=now;loadedDay=today;cache.sourceInfo=null;if(!changed&&cache.warnings)return cache;cache.warningMap=null;
        const read=(name,filename)=>{cache[name]={...readFile(path.join(dataDir,filename))};};
        read('warnings','weather_alerts.json');read('gale','gale_warnings.json');read('zoneForecasts','zone_forecasts.json');read('ripCurrent','ripcurrent_index.json');read('swell','swell_smallzone.json.gz');
        for(const [key,file]of Object.entries({congestion:'sea_traffic.json.gz',accident:'sea_accident.json.gz',tourConcentration:'tour_concentration.json',cells:'sea_cells.json',events:'events_'+io.day(now).slice(0,7).replace('-','')+'.json'})){const filename=path.join(dir,file);cache[key]={...readFile(filename)};}
        cache.events.months={};cache.events.attempts={};cache.events.monthExists={};for(const key of visibleMonths){const file=path.join(dir,'events_'+key.replace('-','')+'.json');cache.events.months[key]=readFile(file).data;cache.events.monthExists[key]=readFile(file).exists;cache.events.attempts[key]=readFile(path.join(dir,'events_'+key.replace('-','')+'_status.json')).data;}
        for(const key of ['congestion','accident','tourConcentration','events','gale'])cache[key].attempt=readFile(path.join(dir,key+'_status.json')).data;
        if(!metadataOnly&&!staticTable)staticTable=readFile(path.join(configDir,'risk_spots.json')).data;
        if(!metadataOnly&&!zones)zones=readFile(path.join(clientDir,'assets','warn_zones.geojson')).data?.features||[];
        if(!metadataOnly&&!landZones)landZones=readFile(path.join(clientDir,'assets','warn_zones_land_coastal.geojson')).data?.features||[];
        return cache;
    }
    /** 나무에서 부모와 자식 표출 블록을 각각 꺼낸다. 예: 자식null은 부모 특보로 채우지 않는다. @returns {Map} [연계] ← warningsFor/borders */
    function flattenWarnings(){if(cache.warningMap)return cache.warningMap;const out=new Map();const visit=(n)=>{if(!n||typeof n!=='object')return;for(const [name,v]of Object.entries(n)){if(v&&typeof v==='object'&&Object.hasOwn(v,'children')){out.set(zoneName(name),{name,block:v});for(const [child,b]of Object.entries(v.children||{}))out.set(zoneName(child),{name:child,block:b});}else visit(v);}};visit(cache.warnings.data?.current);cache.warningMap=out;return out;}
    /** 한 구역의 자료상/가정 특보 상태를 가져온다. 예: 해상 예비21시부터 가정, 연안은 예비 그대로. @param {string} zone @param {string} t @param {boolean} sea @returns {array} [연계] ← details */
    function warningsFor(zone,t,sea,child){const map=flattenWarnings(),end=T.timeline(clock(),sea?1:3,sea?2:3,sea?23:21).at(-1);
        const entry=map.get(zoneName(child||zone));if(!entry||!entry.block)return[];const b=entry.block;
        const blocks=(Object.hasOwn(b,'current')||Object.hasOwn(b,'upcoming'))?[b.current,b.upcoming?{...b.upcoming,preliminary:true}:null]:[b];
        return blocks.map(w=>T.warningAt(w,t,clock(),end,{assumePreliminary:sea})).filter(Boolean);}
    /** 관광지 육상강풍을 연결한다. 예: 이름 미일치는 status unmatched로 드러낸다. @param {object} spot @param {string} t @returns {array} [연계] ← coastDetail */
    function galeFor(spot,t){if(!spot.galeZone)return[];return(cache.gale.data?.rows||[]).filter(r=>r.live&&zoneName(r.zoneNm)===zoneName(spot.galeZone)).map(r=>T.warningAt({...r,type:'강풍',level:r.lvl.includes('경보')?'경보':r.lvl.includes('예비')?'예비':'주의보',preliminary:r.src.endsWith('Ready')||r.lvl.includes('예비')},t,clock(),T.timeline(clock(),3,3,21).at(-1),{assumePreliminary:false})).filter(Boolean);}
    /** 자료별 성공·낡음·오류를 분리한다. 예: 파일이 있어도 마지막 요청실패는 error. @returns {object} [연계] ← API responses */
    function sources(fresh=false){refresh(fresh);if(cache.sourceInfo)return cache.sourceInfo;const now=clock(),date=io.day(now),out={};
        for(const key of ['warnings','gale','zoneForecasts','swell','ripCurrent','congestion','accident','tourConcentration','events']){
            const c=cache[key],d=c.data;const at=timestamp((key==='gale'?c.attempt?.checkedAt:null)||d?.updatedAt||d?.savedAt||d?.collectedAt);
            let status=!d?(c.exists?'error':'missing'):'ok';
            const max={warnings:10*60000,gale:10*60000,zoneForecasts:15*T.HOUR,swell:24*T.HOUR}[key];
            if(d&&max&&(!at||now-at>max))status='stale';
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
        out.events.months={};for(const [month,d]of Object.entries(cache.events.months)){const attempt=cache.events.attempts[month]||(cache.events.attempt?.month===month?cache.events.attempt:null);const status=attempt?.status==='error'?'error':!d?(cache.events.monthExists[month]?'error':'missing'):d.month===month?'ok':'stale';const at=timestamp(d?.collectedAt||d?.updatedAt);out.events.months[month]={status,month,count:d?.events?.length||0,updatedAt:at?T.isoKst(at):null,lastRun:timestamp(attempt?.lastRun)?T.isoKst(timestamp(attempt.lastRun)):null,lastSuccess:timestamp(attempt?.lastSuccess)?T.isoKst(timestamp(attempt.lastSuccess)):null,lastError:attempt?.lastError||null,...(attempt?.sourceCounts?{sourceCounts:attempt.sourceCounts}:{})};}
        const current=out.events.months[date.slice(0,7)];if(current)Object.assign(out.events,current);cache.sourceInfo=out;return out;
    }
    /** 요청시각이 공개 시간범위에 들었는지 확인한다. 예: 2040년 요청은400. @param {string} t @param {boolean} sea @returns {string} [연계] ← frame/detail */
    function validateTime(t,sea){const n=timestamp(t),now=clock(),times=T.timeline(now,sea?1:3,sea?2:3,sea?23:21);if(!Number.isFinite(n)||!/(?:Z|[+-]\d\d:\d\d)$/.test(String(t))||n<now-5*60000||n>timestamp(times.at(-1)))throw Object.assign(new Error('잘못된 예보 시각'),{status:400});return T.isoKst(n);}
    /** 자료를 해구·선택시각에 맞춘다. 예: 자료끝 밖에 이전예보를 연장하지 않는다. @param {number} major @param {string} t @returns {object} [연계] ← detail */
    function forecast(major,t){const rows=cache.zoneForecasts.data?.data?.[String(major)]||[];const times=rows.map(r=>utcForecast(r.tm)).filter(Number.isFinite);const target=timestamp(t);const inside=times.length&&target>=Math.min(...times)-1.5*T.HOUR&&target<=Math.max(...times)+1.5*T.HOUR;
        const r=inside?T.nearest(rows,t,x=>utcForecast(x.tm)):null;const same=rows.filter(x=>Number.isFinite(utcForecast(x.tm))&&T.dateKey(utcForecast(x.tm))===T.dateKey(t));
        const number=x=>x!==null&&x!==''&&x!==undefined&&Number.isFinite(Number(x))&&Number(x)>=0?Number(x):null;
        const max=k=>{const v=same.map(x=>number(x[k])).filter(x=>x!==null);return v.length?Math.max(...v):null;};
        return {wh:number(r?.wh),ws:number(r?.ws),wp:number(r?.wp),wd:number(r?.waveDir),windDir:number(r?.windDir),forecastAt:r?T.isoKst(utcForecast(r.tm)):null,dayMax:{wh:max('wh'),ws:max('ws')}};}
    /** 소해구 너울을 범위 안에서만 가져온다. 예: 모레 범위밖은null. @param {string} key @param {string} t @returns {object|null} [연계] ← coastDetail */
    function swell(key,t){const data=cache.swell.data,c=data?.cells?.[key];if(!c)return null;const rows=(data.fctTimes||[]).map((x,i)=>{const m=String(x).match(/(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/);return{t:m?Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5])-9*T.HOUR:NaN,periodS:c.wp?.[i]};});const valid=rows.filter(r=>Number.isFinite(r.t)),target=timestamp(t);if(!valid.length||target<valid[0].t-1.5*T.HOUR||target>valid.at(-1).t+1.5*T.HOUR)return null;const r=T.nearest(valid,t);return r?.periodS!=null?{periodS:Number(r.periodS)}:null;}
    /** 이안류는 오늘 관측만 연결한다. 예: 어제 관측 파일을 오늘 위험으로 연장하지 않는다.
     * @param {string} name - 해수욕장 @param {string} t - 선택 시각 @returns {object|null} 오늘 관측 [연계] ← coastDetail
     */
    function ripFor(name,t){const r=cache.ripCurrent.data?.places?.[name];if(!r)return null;const at=timestamp(r.obsrvnDt||cache.ripCurrent.data.updatedAt);if(!at||T.dateKey(at)!==T.dateKey(clock())||T.dateKey(t)!==T.dateKey(clock()))return null;return r;}
    /** 정적 관광지 표를 화면 계약으로 준다. 예: id와분할geometry는 빌드결과 그대로. @returns {object} [연계] ← /coast/spots */
    function spots(){refresh();if(!staticTable?.spots)throw Object.assign(new Error('관광지 표 준비 전'),{status:503});return{v:staticTable._about?.hash,spots:staticTable.spots.map((p,i)=>({i,id:p.id,name:p.name,lat:p.lat,lon:p.lon,sggName:p.sgg_name,addr:null,police:p.station?{name:p.station}:null,beach:p.beach,geometry:p.geometry}))};}
    /** 한 연안 지점 설명을 같은 계산기로 만든다. 예: 집중률이 없어도 정적위험과달은계산. @param {string} id @param {string} t @returns {object} [연계] ← /coast/spot/frame */
    function coastDetail(id,t){refresh();const p=staticTable?.spots?.find(p=>p.id===id);if(!p)throw Object.assign(new Error('관광지 없음'),{status:staticTable?404:503});t=validateTime(t,false);const memo=resultKey('coast',t,id);if(detailCache.has(memo))return detailCache.get(memo);const d=T.dateKey(t),f=forecast(p.major,t),src=sources(),cr=src.tourConcentration.status==='ok'?cache.tourConcentration.data?.values?.[id]?.[d]:null;const eventMonth=cache.events.months[d.slice(0,7)];const events=src.events.months[d.slice(0,7)]?.status==='ok'&&eventMonth?.month===d.slice(0,7)?eventMonth.events.filter(e=>e.spotId===id&&e.start<=d&&e.end>=d):null;
        const warning=warningsFor(p.warnZone,t,false).concat(galeFor(p,t));const r=S.scoreCoast({t,now:clock(),spot:p,concentration:typeof cr==='number'?cr:null,events,swell:swell(p.coastCell,t),rip:ripFor(p.ripBeach,t),warnings:warning,...f});
        const notices=[];if(r.notices.effective.length||r.notices.prelim.length)notices.push({key:'warning',effective:r.notices.effective.map(w=>w.type+w.level),prelim:r.notices.prelim.map(w=>w.type+w.level)});if(r.notices.day3)notices.push({key:'day3'});if(r.notices.windMs!==null)notices.push({key:'drift',windMs:r.notices.windMs});
        const rows=r.factors.map(x=>({...x,key:x.key==='concentration'?'people':x.key,used:x.applied, ...(x.key==='hazard'?{zones:(x.zones||[]).map(z=>({id:z.id,place:z['장소명'],shape:z['장소형태'],class:z['구역분류'],addr:z['주소'],police:z['관할파출소']}))}:{}),...(x.key==='event'&&x.events?.length?{src:x.events[0].src,sourceType:x.events[0].sourceType||'gemini',contentId:x.events[0].contentId||null,dateRange:[x.events[0].start,x.events[0].end]}:{})}));
        if(sources().events.months[d.slice(0,7)]?.status!=='ok')r.missing.push('events');if(sources().warnings.status!=='ok')r.missing.push('warnings');if(sources().gale.status!=='ok')r.missing.push('gale');if(f.wh===null||f.ws===null)r.missing.push('forecast');
        return remember(detailCache,memo,{t,title:p.name,subtitle:{addr:null,lat:p.lat,lon:p.lon,sggName:p.sgg_name,police:p.station||null},score:r.score,index:r.index,band:r.band,rr:r.rr,fatalRr:r.fatalRr,notices,rows,missing:[...new Set(r.missing)],inputs:{forecastAt:f.forecastAt}},6000);}
    /** 위치표를 전달한다. 예: 아직수집전이면503. @returns {object} [연계] ← /sea/cells */
    function cells(){refresh();if(!cache.cells.data?.cells?.length)throw Object.assign(new Error('해양교통 칸 위치표 준비 전'),{status:503});return cache.cells.data;}
    /** 한 해상 칸 설명을 계산한다. 예: 수집실패시 null혼잡과날씨만 표시. @param {string} id @param {string} t @returns {object} [연계] ← /sea/cell/frame */
    function seaDetail(id,t){refresh();const c=cells().cells.find(c=>c.id===id);if(!c)throw Object.assign(new Error('해상 칸 없음'),{status:404});t=validateTime(t,true);const memo=resultKey('sea',t,id);if(detailCache.has(memo))return detailCache.get(memo);const n=new Date(timestamp(t)+9*T.HOUR),frame=T.dateKey(t).replace(/-/g,'')+String(n.getUTCHours()).padStart(2,'0')+'00',traffic=sources().congestion.status==='ok'?cache.congestion.data?.frames?.[frame]:null,row=traffic?.find(r=>r.gridId===id);
        const f=forecast(c.haegu?.major,t),warning=warningsFor(c.warnZone,t,true,c.warnSubZone);const r=S.scoreSea({t,now:clock(),ci:row?.congestionIndex??null,warnings:warning,...f});
        const rows=r.factors.map(x=>({...x,key:x.key,used:x.applied,cond:x.forecastOnly?'fcst_only':x.key==='wave'&&x.rr?'wave4m':x.key==='wind'&&x.rr?(f.ws>=17?'wind17':'wind14'):null,...(x.key==='congestion'?{level:r.ciLevel,levelName:r.ciLevel===null?null:['낮음','보통','높음','매우높음'][r.ciLevel]}:{}),...(x.key==='warning'?{name:x.type+x.level,assumedFromHour:x.from?new Date(timestamp(x.from)+9*T.HOUR).getUTCHours():null}:{})}));
        if(sources().warnings.status!=='ok')r.missing.push('warnings');
        return remember(detailCache,memo,{t,title:c.haegu||{major:null,sub:null},subtitle:c.ref||null,clickable:r.clickable,score:r.score,index:r.index,band:r.band,rr:r.rr,officialCongestionLevel:row?.congestionLevel||null,rows,kinds:{sensitive:{rr:r.rr},collision:{rr:r.collisionRr,status:r.collisionRr===null?'withheld':r.picked?'ok':'none'}},inputs:{forecastAt:f.forecastAt,zoneForecastBase:cache.zoneForecasts.data?.baseTmUtf||null,congestionCreated:timestamp(row?.fcstCreateDateTime)?T.isoKst(timestamp(row.fcstCreateDateTime)):null},missing:r.missing},6000);}
    /** 공식 사고 시간대를 이전3시간정시로 고른다. 예:13시는12시원본,보간없음.
     * @param {string} t - 선택시각 @returns {object} t,key,forecastAt [연계] ← accidentFrame/Detail / 혼잡시간과별도표시
     */
    function accidentTime(t){const n=timestamp(t),now=clock(),base=Date.parse(T.dateKey(now)+'T00:00:00+09:00');if(!Number.isFinite(n)||!/(?:Z|[+-]\d\d:\d\d)$/.test(String(t))||n<base||n>base+2*T.DAY+23*T.HOUR+59*60000)throw Object.assign(new Error('잘못된 사고예보 시각'),{status:400});const at=base+Math.floor((n-base)/(3*T.HOUR))*3*T.HOUR,local=new Date(at+9*T.HOUR);return{t:T.isoKst(n),forecastAt:T.isoKst(at),key:T.dateKey(at).replace(/-/g,'')+String(local.getUTCHours()).padStart(2,'0')+'00'};}
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
    /** 지도테두리를 선택시각 특보와 맞춘다. 예: 예비시작전pre노랑. @param {string} t @param {boolean} sea @returns {array} [연계] ← frames */
    function borders(t,sea){const out=[];for(const [_,entry]of flattenWarnings()){const states=warningsFor(entry.name,t,true);if(!states.length)continue;const effective=states.filter(w=>w.state==='발효');const w=(effective.length?effective:states).sort((a,b)=>(b.state==='예비'?0:b.level==='경보'?2:1)-(a.state==='예비'?0:a.level==='경보'?2:1))[0];out.push({zone:entry.name,color:w.state==='예비'?'pre':w.level==='경보'?'wrn':'adv',state:w.state,from:w.from||null});}return out;}
    /** 지도용 작은 숫자배열을 만든다. 예: 해상시각 응답에없는칸은빼되 전체실패면날씨만. @param {boolean} sea @param {string} t @returns {object} [연계] ← /frames */
    function frame(sea,t){refresh();t=validateTime(t,sea);const memo=resultKey(sea?'seaFrame':'coastFrame',t);if(frameCache.has(memo))return frameCache.get(memo);const src=sources(),degraded=Object.entries(src).filter(([k,v])=>(sea?['warnings','zoneForecasts','congestion']:['warnings','gale','zoneForecasts','swell','ripCurrent','tourConcentration','events']).includes(k)&&!['ok','offseason'].includes(v.status)).map(([k])=>k);
        if(sea){const n=new Date(timestamp(t)+9*T.HOUR),key=T.dateKey(t).replace(/-/g,'')+String(n.getUTCHours()).padStart(2,'0')+'00';const traffic=src.congestion.status==='ok'?cache.congestion.data?.frames?.[key]:null,active=traffic?new Set(traffic.map(r=>r.gridId)):null,trafficById=new Map((traffic||[]).map(r=>[r.gridId,r]));return remember(frameCache,memo,{t,cells:cells().cells.filter(c=>!active||active.has(c.id)).map(c=>{const r=seaDetail(c.id,t);return[c.i,r.score,r.rows[0]?.ci??null,trafficById.get(c.id)?.congestionLevel||null];}),borders:borders(t,true),degraded},8);}
        const eventStatus=src.events.months[T.dateKey(t).slice(0,7)]?.status;if(eventStatus==='ok'){const i=degraded.indexOf('events');if(i>=0)degraded.splice(i,1);}else if(!degraded.includes('events'))degraded.push('events');
        const day3Dashed=new Set();const entries=(staticTable?.spots||[]).map((p,i)=>{const r=coastDetail(p.id,t);if(r.notices.some(n=>n.key==='day3')&&p.warnZone)day3Dashed.add(p.warnZone);return[i,r.score];});if(!staticTable)throw Object.assign(new Error('관광지 표 준비 전'),{status:503});return remember(frameCache,memo,{t,day:T.dayOffset(t,clock()),spots:entries,borders:borders(t,false),day3Dashed:[...day3Dashed],degraded},8);}
    /** 첫로드에 시간축·정적표버전·자료상태를 함께 준다. 예: 지금칸은 분유지. @returns {object} [연계] ← /meta */
    function meta(){refresh();const now=clock();return{now:T.isoKst(now),timeline:{sea:{stepH:1,times:T.timeline(now,1,2,23)},accident:{stepH:3,times:A.slots(now).map(s=>s.at)},coast:{stepH:3,times:T.timeline(now,3,3,21),day3From:T.dateKey(now+2*T.DAY)+'T00:00:00+09:00'}},versions:{spots:staticTable?._about?.hash||null,cells:cache.cells.data?.cells?.length||0,accident:cache.accident.data?.v||null},sources:sources()};}
    /** 클릭한 위험구역 원본을 준다. 예: 동일id의 폴리곤만. @param {string[]} ids @returns {object} [연계] ← /hazard-zones */
    function hazards(ids){const all=io.read(path.join(configDir,'coastal_hazard_zones.wgs84.geojson'));if(!all)throw Object.assign(new Error('위험구역 자료 준비 전'),{status:503});return{type:'FeatureCollection',features:all.features.filter(f=>ids.includes(f.properties.name))};}
    /** 섬원본과공통육지geometry를 준다. 예: 서버·화면동일해안선. @returns {object} [연계] ← /islands */
    function islands(){refresh();return{...io.read(path.join(configDir,'island_outlines.geojson')),landGeometry:staticTable?.landGeometry||null};}
    /** 공유 예보 캐시를 복제하지 않고 해상 통합 분석에 제공한다. 예: 기상 조회는 기존 forecast 재사용.
     * @returns {object} 예보·경계·상태·버전 @param 없음
     * [연계] ← marine_fusion / 원천 파일과 기상 캐시의 중복 상주를 막는다.
     */
    function marineInputs(){refresh();return{version:inputVersion,congestion:cache.congestion.data,accident:cache.accident.data,cells:cache.cells.data,sources:sources(),weather:forecast};}
    return{sourceFiles,meta,sources,spots,cells,accidentCells,accidentFrame,accidentDetail,coastDetail,seaDetail,frame,hazards,islands,marineInputs,invalidate(){loadedAt=-Infinity;}};
}
module.exports={createStore,zoneName,timestamp,utcForecast};
