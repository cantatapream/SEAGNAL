/** 역할: 위험예측 수집 실패·할당량·프로세스 경쟁·행사 검증을 실제 임시 파일로 확인한다.
 * [연계] risk_collector_io 및 세 수집기 · 운영키/외부 HTTP/푸시 호출 없음
 */
'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),{spawn}=require('child_process');
const io=require('../services/risk_collector_io'),sea=require('../services/sea_traffic_collector'),tour=require('../services/tour_concentration_collector'),events=require('../services/coastal_events_collector');
const now=Date.parse('2026-10-11T05:10:00+09:00');
/** 공식목록 없는 검사에서도 외부 호출을 막는다. 예: Gemini보충만 주입. [연계] ← 행사검사 / 실API금지. */
const noOfficial=async()=>[];
const dirs=[];const temp=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'risk-collect-'));dirs.push(dir);return dir;};
const batch=(rows,code='00',msg='NORMAL_SERVICE')=>({ok:true,json:async()=>({response:{header:{resultCode:code,resultMsg:msg},body:{items:{item:rows},totalCount:rows.length}}})});
let pass=0,fail=0;
/** 비동기 검사도 다음 검사와 격리한다. 예: HTTP 대기와 파일 잠금 경쟁.
 * @param {string} name - 검사명 @param {function} fn - 검사 @returns {Promise<void>} [연계] ← 아래 검사 묶음
 */
async function check(name,fn){try{await fn();console.log('✅',name);pass++;}catch(e){console.error('❌',name,e.message);fail++;}}
(async()=>{
 await check('Gemini실제요청은확정행사유형·월범위·공식원문·주소·재확인·Google검색을모두포함',async()=>{
  const geminiPath=require.resolve('../services/gemini_client'),previous=require.cache[geminiPath],dir=temp(),src='https://city.example/official/event',address='부산광역시 중구 해안로 1';let captured=null,calls=0;
  io.write(path.join(dir,'events_202609.json'),{month:'2026-09',events:[{name:'전월후보',address,start:'2026-09-28',end:'2026-10-12',src}]});
  require.cache[geminiPath]={id:geminiPath,filename:geminiPath,loaded:true,exports:{callGeminiRaw:async options=>{calls++;captured=options;return{success:true,text:JSON.stringify({events:[{name:'수영대회',address,start:'2026-10-11',end:'2026-10-11',src}]}),response:{candidates:[{groundingMetadata:{groundingChunks:[{web:{uri:redirect,title:'city.example'}}]}}]}};}}};
  // 2026-10-15: 실제 Gemini 근거는 구글 경유 주소로 온다(검토 C1) — 가짜 응답도 경유 주소로 주고, 가짜 fetch 가 Location 으로 실제 주소를 돌려준다.
  const redirect='https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC123',redirectOptions=[];
  try{const collector=events.createCollector({dir,kakaoKey:'test',clock:()=>now,festivalSearch:noOfficial,spots:[{sgg:'1',sgg_name:'부산광역시 중구',name:'해안',lat:35,lon:129}],coastalGeometry:{type:'Polygon',coordinates:[[[127,36],[128,36],[128,37],[127,37],[127,36]]]},fetchImpl:async(url,options)=>{if(url===redirect){redirectOptions.push(options);return{status:302,headers:new Headers({location:src})};}return{ok:true,json:async()=>({documents:[{road_address_name:address,x:129,y:35}]})};}});
   assert.equal((await collector.collect('2026-10')).ok,true);assert.equal(calls,1);assert.equal(captured.model,'gemini-2.5-flash');assert.equal(captured.caller,'CoastalEvents');assert.deepEqual(captured.config.tools,[{googleSearch:{}}]);
   for(const term of ['철인3종','오픈워터','수영','서핑','SUP','카누','용선','드래곤보트','요트','마라톤','달리기','자전거','비치발리볼','배구','걷기','갯바위','방파제','선상','불꽃','음악','해넘이','해맞이','바닷길','갯벌','수산물','해산물','머드','벚꽃','군항제','개장/폐장','에어쇼','함정 공개','2026-10-01','2026-10-31','공식 지자체/주최기관','원문 https URL','시도·시군구·번지','좌표는 추정하지','취소','내륙/하천','상시 관광활동','만들어 넣지','전월후보','재확인하지 못한 후보는 제외',
    // 2026-10-15 사용자 승인 보완(4·5번): 섬·대상 시군구·해안 1km·스포츠 먼저·해변/항구 지역축제·올해 일정만·실제 연 페이지·출처 범위·빈 결과·작년까지 열린 행사·venue/sgg
    '섬 지역','한산도','부산광역시 중구','해안선에서 1km','스포츠 대회를 먼저','바다축제','모래축제','한산대첩축제','거북선축제','2026년 일정이 명시된','작년 일정을 올해로 옮기지','바뀐 일정','실제로 열어 본','국제연맹','신문사','{"events":[]}','설명·마크다운 금지','"venue"','"sgg"','번지가 없으면 빈 문자열','작년까지 이 지역에서 열린 행사','부산불꽃축제(야간·대규모)','남해안컵 국제요트대회(물에 들어가는 대회)'])assert.ok(captured.contents.includes(term),term);
   assert.equal(captured.contents.includes('진해군항제'),false,'다른 시도(경남) 과거 행사는 넣지 않는다');
   const saved=io.read(path.join(dir,'events_202610.json')).events[0];assert.equal(saved.sourceType,'gemini');assert.equal(saved.src,src,'경유 주소를 풀어낸 실제 주소로 근거 확인');
   assert.equal(redirectOptions.length,1);assert.equal(redirectOptions[0].redirect,'manual');assert.ok(redirectOptions[0].signal,'경유 주소 풀기에도 시간 제한');
  }finally{if(previous)require.cache[geminiPath]=previous;else delete require.cache[geminiPath];}
 });
 await check('월말3일전03:20KST·평년윤년2월·30/31일·연말·중복없음',async()=>{
  for(const [day,target]of [['2026-02-25','2026-03'],['2028-02-26','2028-03'],['2026-04-27','2026-05'],['2026-10-28','2026-11'],['2026-12-28','2027-01']]){const dir=temp(),month=day.slice(0,7),requested=[],src='https://city.example/event',address='부산광역시 중구 해안로 1';let clock=Date.parse(day+'T03:19:00+09:00');
   io.write(path.join(dir,'events_'+month.replace('-','')+'.json'),{month,events:[]});
   const collector=events.createCollector({dir,clock:()=>clock,kakaoKey:'test',festivalSearch:noOfficial,spots:[{sgg:'1',sgg_name:'부산광역시 중구',name:'해안',lat:35,lon:129}],coastalGeometry:{type:'Polygon',coordinates:[[[127,36],[128,36],[128,37],[127,37],[127,36]]]},search:async requestedMonth=>{requested.push(requestedMonth);return{events:[{name:'행사',address,start:target+'-01',end:target+'-01',src}],grounded:[src]};},fetchImpl:async()=>({ok:true,json:async()=>({documents:[{road_address_name:address,x:129,y:35}]})})});
   const before=clock;clock-=24*3600000-60000;assert.equal(await collector.tick(),null,day+' 전날');assert.deepEqual(requested,[]);clock=before;assert.equal(await collector.tick(),null,day+' 03:19');assert.deepEqual(requested,[]);clock+=60000;assert.equal((await collector.tick()).ok,true,day+' 03:20');assert.deepEqual(requested,[target]);assert.equal(await collector.tick(),null,day+' 중복');clock+=24*3600000;assert.equal(await collector.tick(),null,day+' 정상다음날');assert.deepEqual(requested,[target]);
  }
 });
 await check('실패한 HTTP도 장부 한 건·재시작 후 상한 보존',async()=>{const dir=temp();const request=()=>io.request({dir,name:'test',limit:1,url:'https://example.org',key:'test',now,fetchImpl:async()=>({ok:false,status:500})});await assert.rejects(request(),/HTTP 500/);await assert.rejects(request(),/quota exhausted/);assert.equal(io.read(path.join(dir,'test_quota.json')).calls,1);for(const [code,msg] of [['153','NOT_FOUND_DATA'],['200','NOT_FOUND_DATA']])await assert.rejects(io.request({dir:temp(),name:'responseCode',limit:1,url:'https://example.org',key:'test',now,fetchImpl:async()=>batch([],code,msg)}),/invalid response/);});
 await check('동시 프로세스 4개의 장부 총 호출은 2건 이하',async()=>{const dir=temp(),moduleFile=path.resolve(__dirname,'../services/risk_collector_io');const code=`const io=require(process.argv[1]);io.request({dir:process.argv[2],name:'shared',limit:2,key:'test',url:'https://example.org',now:${now},fetchImpl:async()=>({ok:true,json:async()=>({})})}).then(()=>process.exit(0)).catch(e=>process.exit(e.message==='quota exhausted'?2:3))`;const results=await Promise.all(Array.from({length:4},()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,['-e',code,moduleFile,dir],{stdio:'ignore'});child.on('error',reject);child.on('exit',resolve);})));assert.equal(results.filter(x=>x===0).length,2);assert.equal(results.filter(x=>x===2).length,2);assert.equal(io.read(path.join(dir,'shared_quota.json')).calls,2);});
 await check('활성 잠금은 경쟁 수집기를 막고 해제 후 재획득',()=>{const file=path.join(temp(),'test.lock'),release=io.acquireLock(file);assert.equal(io.acquireLock(file),null);release();const next=io.acquireLock(file);assert.equal(typeof next,'function');next();});
 await check('죽은 소유자 잠금은 회수',()=>{const file=path.join(temp(),'test.lock');io.write(file,{pid:2147483647,token:'dead'});const release=io.acquireLock(file);assert.equal(typeof release,'function');release();});
 await check('컨테이너 재기동 같은 PID 잠금과 오래된 빈 잠금 회수',()=>{const file=path.join(temp(),'test.lock');io.write(file,{pid:process.pid,token:'prior-process'});let release=io.acquireLock(file);assert.equal(typeof release,'function');release();fs.writeFileSync(file,'');const old=new Date(Date.now()-60000);fs.utimesSync(file,old,old);release=io.acquireLock(file);assert.equal(typeof release,'function');release();});
 await check('혼잡 원천 null·빈값·없는 시각 거부',()=>{const row={gridId:'one',latitude:35,longitude:129,congestionIndex:1,fcstDate:'20261011',fcstTime:'0000'};for(const v of [null,'',undefined])assert.throws(()=>sea.normalize({...row,congestionIndex:v}));assert.throws(()=>sea.normalize({...row,fcstTime:''}));assert.equal(sea.normalize(row).congestionIndex,1);});
 await check('48시각 전체 성공·0.1 미만 필터·하루 한도',async()=>{const dir=temp();let calls=0;const collector=sea.createCollector({dir,key:'test',clock:()=>now,updateCells:()=>{},fetchImpl:async url=>{calls++;const u=new URL(url);return batch([{gridId:'low',latitude:35,longitude:129,congestionIndex:.05,fcstDate:u.searchParams.get('fcstDate'),fcstTime:u.searchParams.get('fcstTime')},{gridId:'normal',latitude:35,longitude:129,congestionIndex:1,fcstDate:u.searchParams.get('fcstDate'),fcstTime:u.searchParams.get('fcstTime'),forecastWindSpeed:null,forecastWaveHeight:null}], '200');}});assert.equal((await collector.collect()).ok,true);assert.equal(calls,48);const data=io.read(path.join(dir,'sea_traffic.json.gz'));assert.equal(Object.keys(data.frames).length,48);assert.ok(Object.values(data.frames).every(x=>x.length===1&&x[0].gridId==='normal'));await collector.collect();assert.equal(calls,48);});
 await check('혼잡 영구 요청·인증 실패는 1건에서 중단하고 원인·정상캐시 보존',async()=>{for(const status of [400,401,403]){const dir=temp(),file=path.join(dir,'sea_traffic.json.gz');io.write(file,{date:'old',sentinel:42});let calls=0,updates=0;const collector=sea.createCollector({dir,key:'test',clock:()=>now,updateCells:()=>{updates++;},fetchImpl:async()=>{calls++;return{ok:false,status};}});const result=await collector.collect();assert.equal(result.ok,false);assert.equal(result.error,'HTTP '+status);assert.equal(calls,1);assert.equal(updates,0);assert.equal(io.read(file).sentinel,42);assert.equal(io.read(path.join(dir,'congestion_status.json')).lastError,'HTTP '+status);assert.equal(io.read(path.join(dir,'congestion_quota.json')).calls,1);}});
 await check('혼잡 부분 실패는 기존 정상 파일 보존·다음 시도 실패 시각만',async()=>{const dir=temp(),file=path.join(dir,'sea_traffic.json.gz');io.write(file,{date:'old',sentinel:42});let failing=true,calls=0;const collector=sea.createCollector({dir,key:'test',clock:()=>now,updateCells:()=>{},fetchImpl:async url=>{calls++;const u=new URL(url),date=u.searchParams.get('fcstDate'),time=u.searchParams.get('fcstTime');if(failing&&date==='20261011'&&time==='0000')return{ok:false,status:500};return batch([{gridId:'one',latitude:35,longitude:129,congestionIndex:2,fcstDate:date,fcstTime:time}]);}});assert.equal((await collector.collect()).ok,false);assert.equal(io.read(file).sentinel,42);assert.equal(calls,48);failing=false;assert.equal((await collector.collect()).ok,true);assert.equal(calls,49);});
 await check('다른 수집기 인스턴스도 동일 수집 잠금 적용',async()=>{const dir=temp();let unblock;const wait=new Promise(r=>{unblock=r;});const a=sea.createCollector({dir,key:'test',clock:()=>now,updateCells:()=>{},fetchImpl:async()=>{await wait;return{ok:false,status:400};}}),b=sea.createCollector({dir,key:'test',clock:()=>now});const pending=a.collect();assert.equal((await b.collect()).error,'collector busy');unblock();await pending;});
 await check('관광공사 v4.1 tAtsNm 응답·동일 시군구+이름만 연결',async()=>{const documented={baseYmd:'20240725',areaCd:'51',areaNm:'강원특별자치도',signguCd:'51130',signguNm:'원주시',tAtsNm:'간현관광지',cnctrRate:'64.65'};assert.deepEqual(tour.normalize(documented,'51130'),{id:'51130|간현관광지',date:'2024-07-25',cr:64.65});assert.throws(()=>tour.normalize({...documented,tAtsNm:undefined,tatsNm:'간현관광지'},'51130'));const dir=temp();const spots=[{sgg:'26110',name:'바닷가'}];const collector=tour.createCollector({dir,spots,key:'test',clock:()=>now,fetchImpl:async()=>batch([{tAtsNm:'바닷가',baseYmd:'20261011',cnctrRate:25},{tAtsNm:'다른 이름',baseYmd:'20261011',cnctrRate:99}])});assert.equal((await collector.collect()).ok,true);assert.deepEqual(io.read(path.join(dir,'tour_concentration.json')).values,{'26110|바닷가':{'2026-10-11':25}});});
 await check('집중률 동일관광지·날짜중복은 값이같아도 partial로정상캐시보존',async()=>{const dir=temp(),file=path.join(dir,'tour_concentration.json');io.write(file,{sentinel:42});const row={tAtsNm:'해안',baseYmd:'20261011',cnctrRate:25};const collector=tour.createCollector({dir,key:'test',clock:()=>now,spots:[{sgg:'1',name:'해안'}],fetchImpl:async()=>batch([row,row])});assert.equal((await collector.collect()).error,'partial response');assert.equal(io.read(file).sentinel,42);});
 await check('가(2026-10-15) 집중률은 수집일~+2일(연안 2일 표출에 필요한 날)만 저장하고 지난 날·그 뒤 날짜는 저장하지 않음',async()=>{const dir=temp(),days=['20261010','20261011','20261012','20261013','20261014','20261109'];const collector=tour.createCollector({dir,spots:[{sgg:'26110',name:'바닷가'}],key:'test',clock:()=>now,fetchImpl:async()=>batch(days.map((d,i)=>({tAtsNm:'바닷가',baseYmd:d,cnctrRate:10+i})))});assert.equal((await collector.collect()).ok,true);assert.deepEqual(io.read(path.join(dir,'tour_concentration.json')).values,{'26110|바닷가':{'2026-10-11':11,'2026-10-12':12,'2026-10-13':13}});const late=tour.createCollector({dir:temp(),spots:[{sgg:'26110',name:'바닷가'}],key:'test',clock:()=>now,fetchImpl:async()=>batch([{tAtsNm:'바닷가',baseYmd:'20261020',cnctrRate:30}])});assert.equal((await late.collect()).error,'empty response','보관 범위 안 날짜가 하나도 없으면 정상 파일로 쓰지 않는다');});
 await check('U81 수집기는 관광지마다 받은 30일 전부의 기하평균(0 제외)·날짜 수를 avg30 에 저장하고 30일 값 자체는 수집일~+2일만 남김',async()=>{const dir=temp(),days=Array.from({length:30},(_,i)=>{const d=new Date(Date.UTC(2026,9,11+i));return d.toISOString().slice(0,10).replace(/-/g,'');});
   const rate=i=>i<2?0:i%2?40:10;const collector=tour.createCollector({dir,spots:[{sgg:'26110',name:'바닷가'},{sgg:'26110',name:'빈곳'}],key:'test',clock:()=>now,fetchImpl:async()=>batch(days.map((d,i)=>({tAtsNm:'바닷가',baseYmd:d,cnctrRate:rate(i)})).concat([{tAtsNm:'빈곳',baseYmd:days[0],cnctrRate:0}]))});assert.equal((await collector.collect()).ok,true);
   const saved=io.read(path.join(dir,'tour_concentration.json')),xs=days.map((d,i)=>rate(i)).filter(v=>v>0),gm=Math.round(Math.exp(xs.reduce((s,v)=>s+Math.log(v),0)/xs.length)*1e4)/1e4;
   assert.deepEqual(saved.avg30,{'26110|바닷가':{gm,days:28}},'양수 28일의 기하평균 — 0인 날은 빼고, 양수가 없는 관광지는 넣지 않는다');assert.equal(gm,20,'10·40 같은 수(각 14일)의 기하평균 — 0인 두 날은 뺌');
   assert.deepEqual(Object.keys(saved.values['26110|바닷가']),['2026-10-11','2026-10-12','2026-10-13'],'30일 값은 버린다(「가」)');assert.deepEqual(saved.values['26110|빈곳'],{'2026-10-11':0});
   assert.deepEqual(tour.averages30({a:{'2026-10-15':10,'2026-10-16':40,'2026-10-17':0}}),{a:{gm:20,days:2}});});
 await check('U81 운영 재기동: 오늘 파일이라도 30일 평균(avg30)이 없는 옛 파일이면 한 번 다시 받고, 있으면 받지 않음',async()=>{const before=process.env.FLY_ALLOC_ID;process.env.FLY_ALLOC_ID='test';try{for(const [avg30,want] of [[undefined,1],[{x:{gm:1,days:1}},0]]){const dir=temp();io.write(path.join(dir,'tour_concentration.json'),{date:io.day(now),collectedAt:io.iso(now),values:{x:{[io.day(now)]:5}},...(avg30?{avg30}:{})});let calls=0;const collector=tour.createCollector({dir,spots:[{sgg:'26110',name:'바닷가'}],key:'test',clock:()=>now,fetchImpl:async()=>{calls++;return{ok:false,status:500};}});try{assert.equal(collector.start(),true);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(calls,want);}finally{collector.stop();}}}finally{if(before===undefined)delete process.env.FLY_ALLOC_ID;else process.env.FLY_ALLOC_ID=before;}});
 await check('관광지 원천 누락·없는 달력 날짜는 정상파일 보존',async()=>{const dir=temp(),file=path.join(dir,'tour_concentration.json');io.write(file,{sentinel:1});const collector=tour.createCollector({dir,spots:[{sgg:'26110',name:'바닷가'}],key:'test',clock:()=>now,fetchImpl:async()=>batch([{tAtsNm:'바닷가',baseYmd:'20260231',cnctrRate:25}])});assert.equal((await collector.collect()).ok,false);assert.equal(io.read(file).sentinel,1);assert.throws(()=>tour.normalize({tAtsNm:'a',baseYmd:'20261011',cnctrRate:null},'a'));});
 await check('행사 시도 공식명·약칭 동등 및 다른 시도 거부',()=>{assert.ok(events.sameProvince('경상남도 거제시 일운면','경남 거제시 일운면'));assert.ok(events.sameProvince('전북특별자치도 군산시','전북 군산시'));assert.equal(events.sameProvince('부산광역시 중구','서울 중구'),false);assert.equal(events.validDate('2026-02-31'),false);});
 await check('행사 주소 카카오 좌표→최근접 관광지 한 곳만',async()=>{const dir=temp(),src='https://city.example/event';const collector=events.createCollector({festivalSearch:noOfficial,dir,clock:()=>now,kakaoKey:'test',spots:[{sgg:'1',sgg_name:'경상남도 거제시',name:'가까움',lat:35,lon:129},{sgg:'2',sgg_name:'경상남도 거제시',name:'멀음',lat:34,lon:128}],search:async()=>({events:[{name:'축제',address:'경상남도 거제시 일운면 구조라리 123',start:'2026-10-11',end:'2026-10-12',src}],grounded:[src]}),fetchImpl:async()=>({ok:true,json:async()=>({documents:[{address_name:'경남 거제시 일운면 구조라리 123',x:'129',y:'35'}]})})});assert.equal((await collector.collect()).ok,true);assert.equal(io.read(path.join(dir,'events_202610.json')).events[0].spotId,'1|가까움');});
 await check('행사 한 건의 주소가 카카오와 맞지 않거나(unmatched) 번지가 없어도(invalid) 그 건만 건너뛰고 달 수집은 성공 — 운영 10월 「unmatched event」 고정 실패(2026-10-15)',async()=>{const dir=temp(),src='https://city.example/event';
  const collector=events.createCollector({festivalSearch:noOfficial,dir,clock:()=>now,kakaoKey:'test',spots:[{sgg:'1',sgg_name:'경상남도 거제시',name:'가까움',lat:35,lon:129}],
   search:async()=>({events:[{name:'맞음',address:'경상남도 거제시 일운면 구조라리 123',start:'2026-10-11',end:'2026-10-12',src},{name:'안맞음',address:'경상남도 거제시 일운면 와현리 999',start:'2026-10-11',end:'2026-10-12',src},{name:'번지없음',address:'경상남도 거제시 일운면 와현리',start:'2026-10-11',end:'2026-10-12',src}],grounded:[src]}),
   fetchImpl:async url=>({ok:true,json:async()=>({documents:decodeURIComponent(String(url)).includes('구조라리')?[{address_name:'경남 거제시 일운면 구조라리 123',x:'129',y:'35'}]:[{address_name:'경남 거제시 일운면 와현리 1',x:'129',y:'35'}]})})});
  const r=await collector.collect();assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.count,1);assert.deepEqual(r.skipped,{'주소/장소 불일치':1,'번지 없음':1},'사유 이름을 사람이 읽는 말로 바꿨다(2026-10-15 — 전: unmatched event·invalid event)');
  const f=io.read(path.join(dir,'events_202610.json'));assert.deepEqual(f.events.map(e=>e.name),['맞음']);assert.deepEqual(f.skipped,{'주소/장소 불일치':1,'번지 없음':1});});
 await check('키 없음·HTTP 오류 같은 수집 자체 문제는 여전히 그 달 실패(정상 캐시 보존)',async()=>{const dir=temp(),src='https://city.example/event',file=path.join(dir,'events_202610.json');io.write(file,{sentinel:2});
  const collector=events.createCollector({festivalSearch:noOfficial,dir,clock:()=>now,kakaoKey:'test',spots:[{sgg:'1',sgg_name:'경상남도 거제시',name:'a',lat:35,lon:129}],search:async()=>({events:[{name:'맞음',address:'경상남도 거제시 일운면 구조라리 123',start:'2026-10-11',end:'2026-10-12',src}],grounded:[src]}),fetchImpl:async()=>({ok:false,status:503})});
  assert.equal((await collector.collect()).error,'HTTP 503');assert.equal(io.read(file).sentinel,2);});
 await check('행사 날짜·출처 오류는 기존 정상 월 보존',async()=>{const dir=temp(),file=path.join(dir,'events_202610.json');io.write(file,{sentinel:1});const collector=events.createCollector({festivalSearch:noOfficial,dir,clock:()=>now,spots:[{sgg:'1',sgg_name:'부산광역시 중구',name:'a',lat:35,lon:129}],search:async()=>({events:[{name:'축제',address:'부산광역시 중구 해안로 1',start:'2026-10-32',end:'2026-11-01',src:'https://city.example/event'}],grounded:['https://city.example/event']})});assert.equal((await collector.collect()).ok,false);assert.equal(io.read(file).sentinel,1);});
 await check('행사 예정일 이후 재기동은 다음 달 누락을 보충',async()=>{const dir=temp(),before=process.env.FLY_ALLOC_ID;process.env.FLY_ALLOC_ID='test';io.write(path.join(dir,'events_202610.json'),{month:'2026-10',events:[]});const requested=[];const collector=events.createCollector({festivalSearch:noOfficial,dir,clock:()=>Date.parse('2026-10-29T04:00:00+09:00'),spots:[{sgg:'1',sgg_name:'부산광역시 중구',name:'a',lat:35,lon:129}],search:async target=>{requested.push(target);return{events:[],grounded:[]};}});try{assert.equal(collector.start(),true);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(requested,['2026-11']);}finally{collector.stop();if(before===undefined)delete process.env.FLY_ALLOC_ID;else process.env.FLY_ALLOC_ID=before;}});
 await check('행사 주소는 다른 시군구·같은도로 다른번지를 건너뛰고 정확한 후보만',async()=>{
  const e={address:'경상남도 통영시 해안로 123 (행사장)'};
  const docs=[{address_name:'경남 사천시 해안로 123',x:'128',y:'35'},{road_address_name:'경남 통영시 해안로 999',x:'128',y:'35'},{road_address_name:'경남 통영시 해안로 123',address_name:'경남 통영시 정량동 1',x:'128.43',y:'34.83'}];
  const coord=await events.geocode(e,async()=>({ok:true,json:async()=>({documents:docs})}),'test');assert.equal(coord.lon,128.43);assert.equal(coord.resolvedAddress,'경남 통영시 해안로 123');
  await assert.rejects(events.geocode(e,async()=>({ok:true,json:async()=>({documents:docs.slice(0,2)})}),'test'),/unmatched event/);
  assert.equal(events.addressKey('경남 거제시 일운면 구조라리 산 123-4'),events.addressKey('경상남도 거제시 일운면 구조라리 산 0123-04 (해안)'));
  assert.notEqual(events.addressKey('경남 거제시 일운면 구조라리 123-4'),events.addressKey('경남 거제시 일운면 구조라리 123-5'));
  assert.equal(events.addressKey('경남 거제시 일운면'),null);
 });
 await check('한 실제주소의 서로다른 좌표는 거부·동일좌표중복은 허용',async()=>{
  const e={address:'부산광역시 중구 해안로 1'},doc={road_address_name:'부산 중구 해안로 1',x:'129',y:'35'};
  const request=documents=>events.geocode(e,async()=>({ok:true,json:async()=>({documents})}),'test');
  await assert.rejects(request([doc,{...doc,x:'128',y:'34'}]),/unmatched event/);assert.equal((await request([doc,{...doc,x:129,y:35}])).lat,35);
 });
 await check('공식매뉴얼 행의 필드·윤달·명시적취소를 검증하고 숫자상태는 추정안함',()=>{
  const row={contentid:'123',contenttypeid:'15',title:'해변 축제',addr1:'부산광역시 중구 해안로 1',addr2:'행사장',eventstartdate:'20280228',eventenddate:'20280229'};
  const e=events.normalizeFestival(row);assert.equal(e.start,'2028-02-28');assert.equal(e.end,'2028-02-29');assert.equal(e.sourceType,'tourapi');assert.equal(e.contentId,'123');assert.equal(new URL(e.src).search,'');
  for(const status of ['취소','개최 취소','cancelled','CANCELED'])assert.equal(events.normalizeFestival({...row,progresstype:status}),null);
  assert.equal(events.normalizeFestival({...row,title:'해변 축제 [취소]'}),null);assert.ok(events.normalizeFestival({...row,progresstype:'2'}));
  assert.throws(()=>events.normalizeFestival({...row,eventenddate:'20260229'}));assert.throws(()=>events.normalizeFestival({...row,contenttypeid:'12'}));
  assert.deepEqual(events.monthBounds('2028-02'),{first:'2028-02-01',last:'2028-02-29'});
 });
 await check('공식목록 전국월분 paging과 보충검색 병합·내륙/취소제외·주소검증',async()=>{
  const dir=temp(),src='https://sports.example/event',coastalGeometry={type:'Polygon',coordinates:[[[128,34],[131,34],[131,37],[128,37],[128,34]]]};
  const row=(id,title,address)=>({contentid:id,contenttypeid:'15',title,addr1:address,eventstartdate:'20261011',eventenddate:'20261012'});
  const official=[row('1','해안 축제','경상남도 거제시 해안로 123'),{...row('2','취소 축제','경상남도 거제시 해안로 123'),progresstype:'취소'},row('3','내륙 축제','경상남도 거제시 내륙로 999')];
  let pages=0,verified=0,known=[];const spots=[{sgg:'48310',sgg_name:'경상남도 거제시',name:'해안',lat:35,lon:128.005}];
  const collector=events.createCollector({dir,key:'test',kakaoKey:'test',clock:()=>now,spots,coastalGeometry,
   search:async(_target,_province,list)=>{known=list;return{events:[{name:'해안 축제',address:'경남 거제시 해안로 123',start:'2026-10-11',end:'2026-10-12',src},{name:'해안 수영 대회',address:'경남 거제시 해안로 123',start:'2026-10-11',end:'2026-10-12',src},{name:'내륙 대회',address:'경남 거제시 내륙로 999',start:'2026-10-11',end:'2026-10-12',src}],grounded:[src]};},
   fetchImpl:async url=>{const u=new URL(url);if(u.hostname==='apis.data.go.kr'){pages++;assert.equal(u.pathname,'/B551011/KorService2/searchFestival2');assert.equal(u.searchParams.get('eventStartDate'),'20261001');assert.equal(u.searchParams.get('eventEndDate'),'20261031');assert.equal(u.searchParams.get('MobileOS'),'ETC');assert.equal(u.searchParams.get('MobileApp'),'SEAGNAL');assert.equal(u.searchParams.has('areaCode'),false);assert.equal(u.searchParams.has('sigunguCode'),false);assert.equal(u.searchParams.has('lDongSignguCd'),false);const page=Number(u.searchParams.get('pageNo'));const reply=await batch(official.slice(page-1,page)).json();reply.response.body.totalCount=3;return{ok:true,json:async()=>reply};}
    verified++;const query=u.searchParams.get('query'),inland=query.includes('내륙로');return{ok:true,json:async()=>({documents:[{road_address_name:query,x:inland?'129':'128.005',y:'35'}]})};}});
  assert.equal((await collector.collect()).ok,true);assert.equal(pages,3);assert.equal(verified,5);assert.equal(known.length,2);
  const data=io.read(path.join(dir,'events_202610.json'));assert.equal(data.events.length,2);assert.deepEqual(data.sourceCounts,{tourapi:1,gemini:1,duplicates:1});assert.equal(data.events[0].sources.length,2);assert.equal(data.events[0].sourceType,'tourapi');assert.equal(data.events[0].src.includes('serviceKey'),false);assert.equal(data.coverage.completeOngoing,false);
  assert.equal(io.read(path.join(dir,'tourFestival_quota.json')).calls,3);assert.equal(io.read(path.join(dir,'events_202610_status.json')).count,2);
 });
 await check('공식목록 페이지 변경·중복ID·빈누락페이지는 실패하고 정상캐시 보존',async()=>{
  const row={contentid:'1',title:'축제',addr1:'부산광역시 중구 해안로 1',eventstartdate:'20261011',eventenddate:'20261012'};
  for(const kind of ['changing-total','duplicate','empty-page']){const dir=temp();io.write(path.join(dir,'events_202610.json'),{month:'2026-10',events:[{sentinel:42}]});let calls=0,searches=0;
   const collector=events.createCollector({dir,key:'test',clock:()=>now,spots:[{sgg:'1',sgg_name:'부산광역시 중구',name:'해안',lat:35,lon:129}],search:async()=>{searches++;return{events:[],grounded:[]};},fetchImpl:async()=>{calls++;const rows=calls===1?[row]:kind==='empty-page'?[]:[row],reply=await batch(rows).json();reply.response.body.totalCount=kind==='changing-total'&&calls===2?3:2;return{ok:true,json:async()=>reply};}});
   assert.equal((await collector.collect()).ok,false);assert.equal(calls,2);assert.equal(searches,0);assert.equal(io.read(path.join(dir,'events_202610.json')).events[0].sentinel,42);
  }
 });
 await check('명시적으로0건인공식목록은Gemini보충허용·월통합0건은오류',async()=>{
  const dir=temp(),src='https://sports.example/event',spots=[{sgg:'1',sgg_name:'부산광역시 중구',name:'해안',lat:35,lon:129}];
  const collector=events.createCollector({dir,key:'test',kakaoKey:'test',clock:()=>now,spots,search:async()=>({events:[{name:'수영대회',address:'부산광역시 중구 해안로 1',start:'2026-10-11',end:'2026-10-11',src}],grounded:[src]}),fetchImpl:async url=>new URL(url).hostname==='apis.data.go.kr'?batch([]):{ok:true,json:async()=>({documents:[{road_address_name:'부산 중구 해안로 1',x:129,y:35}]})}});
  assert.equal((await collector.collect()).ok,true);assert.equal(io.read(path.join(dir,'events_202610.json')).sourceCounts.gemini,1);
  const empty=events.createCollector({dir:temp(),clock:()=>now,spots,festivalSearch:noOfficial,search:async()=>({events:[],grounded:[]})});assert.equal((await empty.collect()).error,'empty response');
  assert.throws(()=>io.items({response:{body:{items:{item:[]},totalCount:null}}},{allowEmpty:true}));assert.throws(()=>io.items({response:{body:{items:{item:[]},totalCount:0}}}));
 });
 await check('근거출처없는Gemini행은버리고확인된행만보관',async()=>{
  const src='https://sports.example/event',e={name:'수영대회',address:'부산광역시 중구 해안로 1',start:'2026-10-11',end:'2026-10-11',src};
  const collector=events.createCollector({dir:temp(),festivalSearch:noOfficial,kakaoKey:'test',clock:()=>now,spots:[{sgg:'1',sgg_name:'부산광역시 중구',name:'해안',lat:35,lon:129}],search:async()=>({events:[e,{...e,name:'근거없음',src:'https://unknown.example/event'}],grounded:[src]}),fetchImpl:async()=>({ok:true,json:async()=>({documents:[{road_address_name:e.address,x:129,y:35}]})})});assert.equal((await collector.collect()).count,1);
 });
 await check('전월행사는재확인후에만반영·공식취소후보제외·월상태분리',async()=>{
  const dir=temp(),src='https://sports.example/event',spots=[{sgg:'1',sgg_name:'부산광역시 중구',name:'해안',lat:35,lon:129}];
  const older={name:'전월 축제',address:'부산광역시 중구 해안로 1',start:'2026-09-28',end:'2026-10-12',src:'https://apis.data.go.kr/B551011/KorService2/searchFestival2',sourceType:'tourapi',contentId:'9'};
  io.write(path.join(dir,'events_202609.json'),{month:'2026-09',events:[older]});
  let cancelled=false,confirm=false,seenCandidates=[];const collector=events.createCollector({dir,kakaoKey:'test',clock:()=>now,spots,festivalSearch:async()=>cancelled?[{contentid:'9',title:'전월 축제',progresstype:'취소',addr1:older.address,eventstartdate:'20260928',eventenddate:'20261012'}]:[],search:async(_target,_province,_official,candidates)=>{seenCandidates=candidates;return{events:[{name:'이번월 대회',address:older.address,start:'2026-10-11',end:'2026-10-11',src},...(confirm&&candidates.length?[{...older,src}]:[])],grounded:[src]};},fetchImpl:async()=>({ok:true,json:async()=>({documents:[{road_address_name:older.address,x:129,y:35}]})})});
  assert.equal((await collector.collect()).count,1);assert.equal(seenCandidates.length,1);const first=io.read(path.join(dir,'events_202610.json'));assert.equal(first.coverage.carriedCount,0);assert.equal(first.coverage.ongoingCandidates,1);confirm=true;assert.equal((await collector.collect()).count,2);cancelled=true;assert.equal((await collector.collect()).count,1);assert.equal(seenCandidates.length,0);
  const failed=events.createCollector({dir,clock:()=>now,spots,festivalSearch:async()=>{throw new Error('HTTP 500');}});assert.equal((await failed.collect('2026-11')).ok,false);
  assert.equal(io.read(path.join(dir,'events_202610_status.json')).status,'ok');assert.equal(io.read(path.join(dir,'events_202611_status.json')).status,'error');assert.equal(io.read(path.join(dir,'events_202610.json')).events.length,1);
 });
 await check('당월최초실패는다음날03:20재시도·같은예약중복금지·회복뒤건너뜀',async()=>{
  const dir=temp(),src='https://sports.example/event';let clock=now,failing=true,searches=0;
  const collector=events.createCollector({dir,clock:()=>clock,kakaoKey:'test',spots:[{sgg:'1',sgg_name:'부산광역시 중구',name:'해안',lat:35,lon:129}],festivalSearch:noOfficial,search:async()=>{searches++;if(failing)throw new Error('HTTP 500');return{events:[{name:'대회',address:'부산광역시 중구 해안로 1',start:'2026-10-12',end:'2026-10-12',src}],grounded:[src]};},fetchImpl:async()=>({ok:true,json:async()=>({documents:[{road_address_name:'부산 중구 해안로 1',x:129,y:35}]})})});
  assert.equal((await collector.collect()).ok,false);clock=Date.parse('2026-10-12T03:20:00+09:00');assert.equal((await collector.tick()).ok,false);assert.equal(await collector.tick(),null);assert.equal(searches,2);
  clock=Date.parse('2026-10-13T03:20:00+09:00');failing=false;assert.equal((await collector.tick()).ok,true);clock=Date.parse('2026-10-14T03:20:00+09:00');assert.equal(await collector.tick(),null);assert.equal(searches,3);
 });
 // ── 2026-10-15 사용자 승인 「행사 수집 보완」 1~8 (독립 검토 A·B·C 근거). 사용자: 「그 외 네가 GEMINI에 대해서 조사한 것은 그대로 반영해줘. 다만, 1년 내내 진행 중인 것은 제외하자. 그리고 GEMINI는 제한을 두지 말도록 하자.」
 const evSpots=[{sgg:'26500',sgg_name:'부산광역시 수영구',name:'광안리해수욕장 (광안리해변)',lat:35.153,lon:129.118},{sgg:'26500',sgg_name:'부산광역시 수영구',name:'민락수변공원',lat:35.155,lon:129.133},{sgg:'48220',sgg_name:'경상남도 통영시',name:'한산도',lat:34.78,lon:128.5}];
 const farLand={type:'Polygon',coordinates:[[[127,36],[128,36],[128,37],[127,37],[127,36]]]},REDIR='https://vertexaisearch.cloud.google.com/grounding-api-redirect/';
 /** 가짜 Gemini 로 실제 webSearch 경로를 돈다. 예: reply(시도, 요청) → callGeminiRaw 응답. [연계] ← 아래 1~8 검사 / 운영 Gemini·카카오 호출 없음. */
 async function withGemini(reply,fn){const geminiPath=require.resolve('../services/gemini_client'),previous=require.cache[geminiPath],asked=[];asked.prompts={};
  require.cache[geminiPath]={id:geminiPath,filename:geminiPath,loaded:true,exports:{callGeminiRaw:async o=>{const province=o.contents.split(' ')[1];asked.push(province);asked.prompts[province]=o.contents;return reply(province,o);}}};
  try{return await fn(asked);}finally{if(previous)require.cache[geminiPath]=previous;else delete require.cache[geminiPath];}}
 const geminiReply=(events,uris)=>({success:true,text:typeof events==='string'?events:JSON.stringify({events}),response:{candidates:[{groundingMetadata:{groundingChunks:uris.map(uri=>({web:{uri,title:'t'}}))}}]}});
 /** 경유 주소는 Location 으로(null=네트워크 실패, 500=Location 없음), 나머지는 카카오 키워드 응답으로 답하는 가짜 fetch. [연계] ← 아래 검사. */
 const fakeFetch=({redirects={},kakao=()=>[]}={})=>{const log={redirect:0,kakao:[]};const f=async url=>{if(url.startsWith(REDIR)){log.redirect++;const to=redirects[url.slice(REDIR.length)];if(to===undefined||to===null)throw new Error('network');if(to===500)return{status:500,headers:new Headers()};return{status:302,headers:new Headers({location:to})};}
  const q=new URL(url).searchParams.get('query');log.kakao.push(q);return{ok:true,json:async()=>({documents:kakao(q)})};};f.log=log;return f;};
 const officialRow=(over={})=>({contentid:'1',contenttypeid:'15',title:'공식 행사',addr1:'부산광역시 수영구 광안해변로 219',eventstartdate:'20261011',eventenddate:'20261011',...over});
 const officialKakao=()=>[{road_address_name:'부산 수영구 광안해변로 219',x:'129.118',y:'35.153'}];
 await check('1 근거: 경유 주소를 Location 으로 풀어 「호스트+경로」(끝 /·쿼리·조각 무시) 비교·저장 src=실제 주소 · 도메인만 같으면 근거 불일치 · 풀기 전부 실패면 근거 확인 불가',async()=>{
  const real='https://www.busan.go.kr/event/view/123',ev={name:'광안리 수영대회',venue:'광안리해수욕장',sgg:'부산광역시 수영구',address:'',start:'2026-10-11',end:'2026-10-11'};
  const reply=p=>p==='부산광역시'?geminiReply([{...ev,src:'https://WWW.busan.go.kr/event/view/123/?utm=x#top'},{...ev,name:'지어낸 대회',src:'https://www.busan.go.kr/event/view/999'}],[REDIR+'a',REDIR+'b']):geminiReply([],[]);
  await withGemini(reply,async()=>{const dir=temp(),fetchImpl=fakeFetch({redirects:{a:real,b:'https://news.example/x'}});const c=events.createCollector({dir,kakaoKey:'test',clock:()=>now,festivalSearch:noOfficial,spots:evSpots,coastalGeometry:farLand,fetchImpl});
   const r=await c.collect('2026-10');assert.equal(r.ok,true,JSON.stringify(r));const f=io.read(path.join(dir,'events_202610.json'));assert.deepEqual(f.events.map(e=>[e.name,e.src]),[['광안리 수영대회',real]]);assert.deepEqual(f.skipped,{'근거 불일치':1},'같은 도메인 다른 페이지는 받지 않는다');assert.equal(fetchImpl.log.redirect,2);});
  await withGemini(reply,async()=>{const dir=temp();const c=events.createCollector({dir,kakaoKey:'test',clock:()=>now,festivalSearch:async()=>[officialRow()],spots:evSpots,coastalGeometry:farLand,fetchImpl:fakeFetch({redirects:{a:500,b:null},kakao:officialKakao})});
   const r=await c.collect('2026-10');assert.equal(r.ok,true,JSON.stringify(r));const f=io.read(path.join(dir,'events_202610.json'));assert.deepEqual(f.events.map(e=>e.name),['공식 행사']);assert.deepEqual(f.skipped,{'근거 확인 불가':2},'풀기 전부 실패 — 지어내지 않고 건너뛴다');});
  assert.equal(events.urlKey('https://A.example/x/y/?q=1#z'),events.urlKey('http://a.example/x/y'));assert.notEqual(events.urlKey('https://a.example/x/y'),events.urlKey('https://a.example/x'));
  assert.deepEqual(await events.resolveGrounding('https://city.example/a',async()=>{throw Error('경유 주소가 아니면 부르지 않는다');}),{url:'https://city.example/a'});
  assert.deepEqual(await events.resolveGrounding(REDIR+'r',async()=>({status:302,headers:new Headers({location:'/grounding-api-redirect/again'})})),{error:'not a page'},'경유 호스트 안으로 다시 보내면 실제 주소가 아니다');
  assert.deepEqual(await events.resolveGrounding(REDIR+'r',async()=>({status:200,headers:new Headers()})),{error:'HTTP 200'},'Location 없는 답은 못 푼 것');
 });
 await check('2 번지 없는 행사장: ⓐ 같은 시군구 관광지 이름(공백·괄호 제거) 1곳이면 그 관광지 ⓑ 아니면 카카오 「시군구+행사장」에서 같은 시군구 후보가 한 좌표일 때만 · 둘 다 안 되면 그 행사만 건너뜀',async()=>{
  const dir=temp(),src='https://city.example/e',base={start:'2026-10-11',end:'2026-10-11',src};
  const kakao=q=>q==='수영구 민락어민활어직판장'?[{place_name:'민락어민활어직판장',road_address_name:'부산 수영구 민락수변로 1',x:'129.13',y:'35.155'},{place_name:'다른 구 같은 이름',address_name:'부산 해운대구 우동 1',x:'129.16',y:'35.16'}]
   :q==='수영구 광안리 무대'?[{place_name:'A',road_address_name:'부산 수영구 a로 1',x:'129.11',y:'35.15'},{place_name:'B',road_address_name:'부산 수영구 b로 2',x:'129.12',y:'35.152'}]:[];
  const fetchImpl=fakeFetch({kakao});
  const c=events.createCollector({dir,kakaoKey:'test',clock:()=>now,festivalSearch:noOfficial,spots:evSpots,coastalGeometry:farLand,fetchImpl,search:async (_target,p)=>p!=='부산광역시'?{events:[],grounded:[]}:{events:[
   {...base,name:'ⓐ 관광지 이름',venue:' 광안리 해수욕장 ',sgg:'부산 수영구',address:''},
   {...base,name:'ⓑ 카카오 한 곳',venue:'민락어민활어직판장',sgg:'부산광역시 수영구',address:''},
   {...base,name:'ⓑ 두 좌표',venue:'광안리 무대',sgg:'부산광역시 수영구'},
   {...base,name:'행사장 없음',venue:'',sgg:'부산광역시 수영구',address:'부산광역시 수영구 광안동'}],grounded:[src]}});
  const r=await c.collect('2026-10');assert.equal(r.ok,true,JSON.stringify(r));const f=io.read(path.join(dir,'events_202610.json')),by=Object.fromEntries(f.events.map(e=>[e.name,e]));
  assert.deepEqual(Object.keys(by).sort(),['ⓐ 관광지 이름','ⓑ 카카오 한 곳']);
  assert.equal(by['ⓐ 관광지 이름'].spotId,'26500|광안리해수욕장 (광안리해변)');assert.equal(by['ⓐ 관광지 이름'].lat,35.153);assert.equal(by['ⓐ 관광지 이름'].connectionKm,0);
  assert.equal(by['ⓑ 카카오 한 곳'].lat,35.155);assert.equal(by['ⓑ 카카오 한 곳'].resolvedAddress,'부산 수영구 민락수변로 1');assert.equal(by['ⓑ 카카오 한 곳'].spotId,'26500|민락수변공원');
  assert.deepEqual(fetchImpl.log.kakao,['수영구 민락어민활어직판장','수영구 광안리 무대'],'ⓐ 가 맞으면 카카오를 부르지 않고, 번지·행사장 둘 다 없으면 부르지 않는다');
  assert.deepEqual(f.skipped,{'주소/장소 불일치':1,'번지 없음':1});
 });
 await check('3 한 시도 답이 JSON 이 아니면 그 시도만 실패로 적고 공식 목록·다른 시도는 저장 · 다음 03:20 에는 그 시도만 다시 묻는다 · 머리말·코드 울타리는 첫 {~끝 } 로 읽음',async()=>{
  let gyeongnam='죄송합니다. 해당 기간의 행사를 찾지 못했습니다.';const real='https://www.busan.go.kr/e/1',tongyeong='https://www.tongyeong.go.kr/e/2';
  const reply=p=>p==='부산광역시'?geminiReply('다음과 같습니다.\n```json\n'+JSON.stringify({events:[{name:'부산 대회',venue:'민락수변공원',sgg:'부산광역시 수영구',address:'',start:'2026-10-11',end:'2026-10-11',src:real}]})+'\n```',[REDIR+'a']):geminiReply(gyeongnam,[REDIR+'b']);
  await withGemini(reply,async asked=>{const dir=temp();let clock=now;
   const c=events.createCollector({dir,kakaoKey:'test',clock:()=>clock,festivalSearch:async()=>[officialRow()],spots:evSpots,coastalGeometry:farLand,fetchImpl:fakeFetch({redirects:{a:real,b:tongyeong},kakao:officialKakao})});
   const r=await c.collect('2026-10');assert.equal(r.ok,true,JSON.stringify(r));assert.deepEqual(r.failedProvinces,['경상남도']);
   let f=io.read(path.join(dir,'events_202610.json'));assert.deepEqual(f.events.map(e=>e.name).sort(),['공식 행사','부산 대회']);assert.deepEqual(f.provinces['경상남도'],{status:'error',reason:'시도 응답 해석 실패'});assert.equal(f.skipped['시도 응답 해석 실패'],1);
   const st=io.read(path.join(dir,'events_202610_status.json'));assert.equal(st.status,'ok','저장한 달은 정상 — 행사 점수를 버리지 않는다');assert.ok(st.detail.includes('경상남도(시도 응답 해석 실패)'),st.detail);
   assert.deepEqual([...asked],['부산광역시','경상남도']);
   // 4번(대상 시군구 목록): 그 시도 것만 넘긴다.
   assert.ok(asked.prompts['경상남도'].includes('경상남도 통영시'));assert.equal(asked.prompts['경상남도'].includes('부산광역시 수영구'),false);
   clock=Date.parse('2026-10-12T03:20:00+09:00');gyeongnam=JSON.stringify({events:[{name:'한산도 낚시대회',venue:'한산도',sgg:'경상남도 통영시',address:'',start:'2026-10-18',end:'2026-10-18',src:tongyeong}]});
   assert.equal((await c.tick()).ok,true);assert.deepEqual([...asked],['부산광역시','경상남도','경상남도'],'성공한 부산은 다시 묻지 않는다');
   f=io.read(path.join(dir,'events_202610.json'));assert.deepEqual(f.events.map(e=>e.name).sort(),['공식 행사','부산 대회','한산도 낚시대회']);assert.equal(f.skipped['시도 응답 해석 실패'],undefined);assert.equal(io.read(path.join(dir,'events_202610_status.json')).detail,null);
   clock=Date.parse('2026-10-13T03:20:00+09:00');assert.equal(await c.tick(),null,'모든 시도가 성공한 달은 재시도하지 않는다');
  });
  assert.deepEqual(events.parseEvents('{"events":[]}'),[]);for(const bad of ['못 찾음','{"items":[]}','{"events":'])assert.throws(()=>events.parseEvents(bad),e=>e.provinceFailure==='시도 응답 해석 실패',bad);
 });
 await check('5 작년까지 열린 행사 이름: CSV(따옴표 안 쉼표·CRLF) 를 제대로 읽어 그 시도 것만 중복 없이(유형 포함)',()=>{
  assert.deepEqual(events.parseCsv('a,b\r\n"x,1","say ""hi"""\r\n'),[{a:'x,1',b:'say "hi"'}]);assert.throws(()=>events.parseCsv('a,b\n1,2,3\n'));
  const json=require('../config/coastal_safety/events/events_2020_2025.json'),csv=events.parseCsv(fs.readFileSync(path.join(__dirname,'../config/coastal_safety/events/events_2020_2025.csv'),'utf8'));
  assert.equal(csv.length,json.length);assert.ok(csv.filter(r=>Object.values(r).some(v=>v.includes(','))).length>0,'따옴표 안 쉼표가 실제로 있는 파일');
  assert.deepEqual(csv,json.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,Array.isArray(v)?v.join(' '):String(v)]))),'같은 내용인 JSON 과 모든 칸 일치(JSON 의 sources 배열은 CSV 에서 공백으로 이어져 있다)');
  const busan=events.pastEvents('부산광역시');assert.equal(new Set(busan).size,busan.length);assert.ok(busan.includes('부산불꽃축제(야간·대규모)'));assert.ok(busan.includes('남해안컵 국제요트대회(물에 들어가는 대회)'),'복수 시도 행사');assert.equal(busan.some(x=>x.startsWith('진해군항제')),false);
  assert.ok(events.pastEvents('경남').includes('남해안컵 국제요트대회(물에 들어가는 대회)'));assert.ok(events.pastEvents('경상남도').includes('통영한산대첩축제(지역 해양·수산 축제)'));
 });
 await check('6 개최 기간 180일 이상은 상시 행사로 저장하지 않음(공식·Gemini 모두, 179일은 저장) — 예: 광안리 드론 라이트쇼 2026-01-01~12-31',async()=>{
  const dir=temp(),src='https://city.example/e',fetchImpl=fakeFetch({kakao:officialKakao});
  const c=events.createCollector({dir,kakaoKey:'test',clock:()=>now,festivalSearch:async()=>[officialRow({contentid:'7',title:'광안리 M(Marvelous) 드론 라이트쇼',eventstartdate:'20260101',eventenddate:'20261231'})],spots:evSpots,coastalGeometry:farLand,fetchImpl,search:async (_target,p)=>p!=='부산광역시'?{events:[],grounded:[]}:{events:[
   {name:'180일',venue:'민락수변공원',sgg:'부산광역시 수영구',start:'2026-05-05',end:'2026-10-31',src},{name:'179일',venue:'민락수변공원',sgg:'부산광역시 수영구',start:'2026-05-06',end:'2026-10-31',src}],grounded:[src]}});
  const r=await c.collect('2026-10');assert.equal(r.ok,true,JSON.stringify(r));const f=io.read(path.join(dir,'events_202610.json'));assert.deepEqual(f.events.map(e=>e.name),['179일']);assert.deepEqual(f.skipped,{'상시 행사':2});assert.deepEqual(fetchImpl.log.kakao,[],'상시 행사는 카카오도 부르지 않는다');assert.equal(events.PERMANENT_DAYS,180);
 });
 await check('7 Gemini 한 시도가 끝없이 답하지 않으면 시간 제한으로 그 시도만 실패 · 나머지 저장 · 잠금 해제',async()=>{
  const dir=temp(),src='https://city.example/e';const c=events.createCollector({dir,kakaoKey:'test',clock:()=>now,festivalSearch:noOfficial,spots:evSpots,coastalGeometry:farLand,searchTimeoutMs:30,search:(_target,p)=>p==='경상남도'?new Promise(()=>{}):Promise.resolve({events:[{name:'부산 대회',venue:'민락수변공원',sgg:'부산광역시 수영구',start:'2026-10-11',end:'2026-10-11',src}],grounded:[src]})});
  // 시간 제한이 고장 나면 끝나지 않는 약속만 남아 node 가 요약 없이 조용히 끝난다 — 5초 감시로 실패를 드러낸다.
  let guard;const r=await Promise.race([c.collect('2026-10'),new Promise((_,reject)=>{guard=setTimeout(()=>reject(new Error('시간 제한이 동작하지 않음')),5000);})]).finally(()=>clearTimeout(guard));
  assert.equal(r.ok,true,JSON.stringify(r));assert.deepEqual(r.failedProvinces,['경상남도']);assert.deepEqual(io.read(path.join(dir,'events_202610.json')).provinces['경상남도'],{status:'error',reason:'시도 응답 시간 초과'});
  assert.equal((await c.collect('2026-10')).ok,true,'잠금이 풀려 다음 수집이 돈다');assert.equal(events.SEARCH_TIMEOUT_MS,600000);
 });
 await check('8 버린 이유 전부 사유별(근거·기간 밖·내륙·형식·취소·대상 시군구 밖) + 상태 detail → 관리자 오류현황 상세(1분 관찰이 지우지 않음)',async()=>{
  const dir=temp(),src='https://city.example/e',land={type:'Polygon',coordinates:[[[129.10,35.14],[129.14,35.14],[129.14,35.17],[129.10,35.17],[129.10,35.14]]]};
  const c=events.createCollector({dir,kakaoKey:'test',clock:()=>now,festivalSearch:async()=>[officialRow({contentid:'2',progresstype:'취소'}),officialRow({contentid:'3',title:'내륙 도시 축제',addr1:'대구광역시 중구 동성로 1'})],spots:evSpots,coastalGeometry:land,fetchImpl:fakeFetch(),
   search:async (_target,p)=>p!=='부산광역시'?{events:[],grounded:[]}:{events:[{name:'저장',venue:'민락수변공원',sgg:'부산광역시 수영구',start:'2026-10-11',end:'2026-10-11',src},{name:'다음 달',venue:'민락수변공원',sgg:'부산광역시 수영구',start:'2026-11-05',end:'2026-11-05',src},
    {name:'내륙',venue:'광안리해수욕장',sgg:'부산광역시 수영구',start:'2026-10-11',end:'2026-10-11',src},{name:'',venue:'민락수변공원',sgg:'부산광역시 수영구',start:'2026-10-11',end:'2026-10-11',src},{name:'근거 없음',venue:'민락수변공원',sgg:'부산광역시 수영구',start:'2026-10-11',end:'2026-10-11',src:'https://other.example/e'}],grounded:[src]}});
  const r=await c.collect('2026-10');assert.equal(r.ok,true,JSON.stringify(r));const want={'근거 불일치':1,'기간 밖':1,'내륙(해안 1km 밖)':1,'항목 형식 오류':1,'취소':1,'대상 시군구 밖':1};
  assert.deepEqual(r.skipped,want);assert.deepEqual(io.read(path.join(dir,'events_202610.json')).skipped,want);const st=io.read(path.join(dir,'events_202610_status.json'));assert.deepEqual(st.skipped,want);
  const detail='건너뜀 근거 불일치 1·기간 밖 1·내륙(해안 1km 밖) 1·항목 형식 오류 1·취소 1·대상 시군구 밖 1';assert.equal(st.detail,detail);
  const history=require('../services/risk_error_history').createHistory({dir,clock:()=>now});const row=()=>history.list({source:'events'}).current.find(x=>x.scope==='2026-10');assert.equal(row().detail,detail);
  history.observeSources({events:{months:{'2026-10':{status:'ok',month:'2026-10',lastError:null}}}});assert.equal(row().detail,detail,'risk_store 월 상태에는 detail 칸이 없어 1분 관찰이 상세를 지우면 안 된다');
  const failed=events.createCollector({dir,clock:()=>now,spots:evSpots,festivalSearch:async()=>{throw new Error('HTTP 500');}});assert.equal((await failed.collect('2026-10')).ok,false);assert.equal(io.read(path.join(dir,'events_202610_status.json')).detail,null,'실패 상태에 지난 상세를 남기지 않는다');
 });
 await check('첫주집중률변경관측구간영속·행순서만바뀌면동일·7일뒤추가관측없음',async()=>{
  const dir=temp(),spots=[{sgg:'1',name:'가'},{sgg:'1',name:'나'}];let clock=Date.parse('2026-10-11T06:20:00+09:00'),value=10,reverse=false;
  // 기준일은 10-12: 두 수집일(10-11·10-12) 모두의 보관 범위(수집일~+2일) 안이라 날짜 범위가 아니라 값·행 순서만 비교된다(가 2026-10-15).
  const collector=tour.createCollector({dir,key:'test',clock:()=>clock,spots,fetchImpl:async()=>{const rows=spots.map(s=>({tAtsNm:s.name,baseYmd:'20261012',cnctrRate:s.name==='가'?value:5}));return batch(reverse?rows.reverse():rows);}});
  await collector.tick();clock=Date.parse('2026-10-11T12:20:00+09:00');value=25;await collector.tick();
  let observed=io.read(path.join(dir,'tour_concentration_observations.json'));assert.equal(observed.samples.length,2);assert.equal(observed.samples[0].changed,null);assert.equal(observed.samples[1].changed,true);assert.equal(observed.samples[1].changes.updated,1);assert.deepEqual(observed.samples[1].changeWindow,{after:'2026-10-11T06:20:00+09:00',beforeOrAt:'2026-10-11T12:20:00+09:00'});
  clock=Date.parse('2026-10-12T06:20:00+09:00');reverse=true;await collector.tick();observed=io.read(path.join(dir,'tour_concentration_observations.json'));assert.equal(observed.samples[2].changed,false);
  const before=fs.readFileSync(path.join(dir,'tour_concentration_observations.json'),'utf8');clock=Date.parse('2026-10-18T12:20:00+09:00');assert.equal(await collector.tick(),null);await collector.collect();assert.equal(fs.readFileSync(path.join(dir,'tour_concentration_observations.json'),'utf8'),before);
 });
 await check('강풍 같은 응답 성공 heartbeat 갱신·본문/로그 변경 없음',()=>{const dir=temp(),gale=require('../services/gale_warning_store');gale._resetForTest();const fetched={warnList:[{warn_tp:'W',warn_lvl_nm:'주의보',warn_zone_nm:'부산서부',tm_fc:'2026.10.11 05:00'}]};gale.save(fetched,{dir,now:new Date(now)});const before=fs.readFileSync(path.join(dir,'gale_warnings.json'),'utf8'),log=fs.readFileSync(path.join(dir,'gale_warnings_log.jsonl'),'utf8');assert.equal(gale.save(fetched,{dir,now:new Date(now+60000)}).wrote,false);assert.equal(fs.readFileSync(path.join(dir,'gale_warnings.json'),'utf8'),before);assert.equal(fs.readFileSync(path.join(dir,'gale_warnings_log.jsonl'),'utf8'),log);assert.equal(io.read(path.join(dir,'risk_forecast','gale_status.json')).checkedAt,new Date(now+60000).toISOString());});
 await check('수집 진단은 원천 URL·키 대신 고정 오류 분류만 기록',()=>{const before=console.error,messages=[];console.error=message=>messages.push(message);try{io.reportError('test',new Error('https://secret.example/?serviceKey=private'));io.reportError('test',Object.assign(new Error('private path'),{code:'EACCES'}));io.reportError('test',new Error('HTTP 400'));}finally{console.error=before;}assert.equal(messages.join(' ').includes('private'),false);assert.equal(messages.join(' ').includes('secret.example'),false);assert.ok(messages.some(m=>m.endsWith('EACCES')));assert.ok(messages.some(m=>m.endsWith('HTTP 400')));});
 await check('혼잡 수집시간 밖 모든 분은 압축 예보 읽기·외부 요청 없음',async()=>{
  const original=fs.readFileSync;let reads=0,requests=0;const guarded=new Set();
  try{for(const state of ['absent','old','current']){const dir=temp(),file=path.join(dir,'sea_traffic.json.gz');if(state!=='absent')io.write(file,{date:state==='current'?'2026-10-11':'2026-10-10',frames:{}});guarded.add(file);let clock=now;const collector=sea.createCollector({dir,key:'test',clock:()=>clock,fetchImpl:async()=>{requests++;throw Error('unexpected network');},updateCells(){}});
   fs.readFileSync=function(file,...args){if(guarded.has(file)){reads++;throw Error('unexpected full forecast read');}return original.call(this,file,...args);};
   for(let minute=0;minute<1440;minute++){const h=Math.floor(minute/60),m=minute%60;if([240,270,300,330,390,450,510,570,630,690,750].includes(h*60+m))continue;clock=Date.parse('2026-10-11T00:00:00+09:00')+minute*60000;assert.equal(await collector.tick(),null);}
  }assert.equal(reads,0);assert.equal(requests,0);}finally{fs.readFileSync=original;}
 });
 await check('혼잡 정기04:00 실패·04:30 누락분 복구·05:00 정상본 유지',async()=>{
  const dir=temp();let clock=Date.parse('2026-10-11T04:00:00+09:00'),failed=false,requests=0;const collector=sea.createCollector({dir,key:'test',clock:()=>clock,updateCells(){},fetchImpl:async url=>{requests++;const u=new URL(url),date=u.searchParams.get('fcstDate'),time=u.searchParams.get('fcstTime');if(!failed){failed=true;return{ok:false,status:503};}return batch([{gridId:'grid',latitude:35,longitude:129,fcstDate:date,fcstTime:time,congestionIndex:7,congestionLevel:'보통'}]);}});
  assert.equal((await collector.tick()).ok,false);assert.equal(requests,48);clock=Date.parse('2026-10-11T04:30:00+09:00');assert.equal((await collector.tick()).ok,true);assert.equal(requests,49);const saved=io.read(path.join(dir,'sea_traffic.json.gz'));assert.equal(Object.keys(saved.frames).length,48);clock=Date.parse('2026-10-11T05:00:00+09:00');assert.equal(await collector.tick(),null);assert.equal(requests,49);
 });
 await check('혼잡 갱신 전(첫 요청 빈 응답)이면 1건만 쓰고 멈춤→다음 점검 시각에 48시각 수집, 05:10 이후는 점검 안 함',async()=>{
  const dir=temp();let clock=Date.parse('2026-10-11T04:00:00+09:00'),published=false,requests=0;const collector=sea.createCollector({dir,key:'test',clock:()=>clock,updateCells(){},fetchImpl:async url=>{requests++;const u=new URL(url);if(!published)return batch([]);return batch([{gridId:'grid',latitude:35,longitude:129,fcstDate:u.searchParams.get('fcstDate'),fcstTime:u.searchParams.get('fcstTime'),congestionIndex:7,congestionLevel:'보통'}]);}});
  assert.equal((await collector.tick()).ok,false);assert.equal(requests,1);clock=Date.parse('2026-10-11T04:30:00+09:00');assert.equal((await collector.tick()).ok,false);assert.equal(requests,2);
  published=true;clock=Date.parse('2026-10-11T05:00:00+09:00');assert.equal((await collector.tick()).ok,true);assert.equal(requests,50);
  for(const t of ['05:10','06:10','07:10'])assert.equal(await sea.createCollector({dir:temp(),key:'test',clock:()=>Date.parse('2026-10-11T'+t+':00+09:00'),fetchImpl:async()=>{throw Error('unexpected');},updateCells(){}}).tick(),null);
 });
 await check('혼잡 05:30까지 다 실패한 날은 06:30~12:30 매시 다시 보고, 13:30 이후는 보지 않음',async()=>{
  let requests=0;const fetchImpl=async url=>{requests++;const u=new URL(url);return batch([{gridId:'grid',latitude:35,longitude:129,fcstDate:u.searchParams.get('fcstDate'),fcstTime:u.searchParams.get('fcstTime'),congestionIndex:7,congestionLevel:'보통'}]);};
  for(const t of ['06:30','09:30','12:30']){requests=0;const r=await sea.createCollector({dir:temp(),key:'test',clock:()=>Date.parse('2026-10-11T'+t+':00+09:00'),fetchImpl,updateCells(){}}).tick();assert.equal(r.ok,true,t);assert.equal(requests,48,t);}
  for(const t of ['06:10','13:30','18:30'])assert.equal(await sea.createCollector({dir:temp(),key:'test',clock:()=>Date.parse('2026-10-11T'+t+':00+09:00'),fetchImpl:async()=>{throw Error('unexpected');},updateCells(){}}).tick(),null,t);
 });
 await check('개발 start는 키가 있어도 자동 수집하지 않음',()=>{const before=process.env.FLY_ALLOC_ID;delete process.env.FLY_ALLOC_ID;try{for(const module of [sea,tour,events])assert.equal(module.createCollector({dir:temp()}).start(),false);}finally{if(before!==undefined)process.env.FLY_ALLOC_ID=before;}});
})().finally(()=>{for(const dir of dirs)fs.rmSync(dir,{recursive:true,force:true});console.log(`${pass} PASS / ${fail} FAIL`);if(fail)process.exitCode=1;});
