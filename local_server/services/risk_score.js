/**
 * 파일명: local_server/services/risk_score.js
 * 역할  : 입력 묶음만으로 해상 최대후보·연안 요소합 점수와 설명 자료를 만든다.
 * [연계] risk_points.js·risk_time.js → risk_store.js · API/마크업 없음
 * [로드 순서] 점수표·시간 모듈 다음
 */
'use strict';
const P=require('./risk_points'),T=require('./risk_time');
const numeric=v=>typeof v==='number'&&Number.isFinite(v);
/** 점수를 공통 응답으로 환산한다. 예: .75→지수25.
 * @param {number} score - 점수 @param {object[]} factors - 요소 @param {string[]} missing - 결측
 * @returns {object} 결과 [연계] ← scoreSea·scoreCoast / 공통 상자를 만든다.
 */
function result(score,factors,missing){const index=P.scoreToIndex(score);return{score,index,band:P.scoreBand(index),rr:2**score,factors,missing};}
/** 해상 점수를 계산한다. 예: 경보+파고4m→3.86(최대 하나).
 * @param {object} input - {t,now,ci,wh,ws,dayMax,warnings}
 * @returns {object} 공통 점수·선택후보·혼잡·충돌배수
 * [연계] ← risk_store.js / 지도 프레임과 상세에 같은 값을 제공한다.
 */
function scoreSea({t,now,ci=null,wh=null,ws=null,warnings=[]}){
const active=warnings.filter(w=>['풍랑','태풍'].includes(w.type)&&w.state!=='예비');
const warning=active.sort((a,b)=>(b.level==='경보')-(a.level==='경보'))[0]||null;
const candidates=[],factors=[],missing=[];
if(!numeric(ci))missing.push('congestion');if(!numeric(wh)||!numeric(ws))missing.push('forecast');
let wave=null,wind=null;
if(warning){const key=warning.level==='경보'?'warn_wrn':'warn_adv';candidates.push({key,...P.SEA[key]});if(numeric(wh)&&wh>=4)wave={key:'wave4m',source:'wave',threshold:4,...P.SEA.wave4m};if(numeric(ws)&&ws>=14){const k=ws>=17?'wind17':'wind14';wind={key:k,source:'wind',threshold:ws>=17?17:14,...P.SEA[k]};}}
else{const lead=T.dayOffset(t,now);if(lead===0||lead===1){const waveTier=numeric(wh)?wh>=4?2:wh>=2.5?1:wh>=2?0:-1:-1,windTier=numeric(ws)?ws>=17?2:ws>=14?1:ws>=12?0:-1:-1;if(waveTier>=0)wave={key:'fcst_only',source:'wave',forecastOnly:true,tier:waveTier,lead,threshold:[2,2.5,4][waveTier],...P.FORECAST[lead][waveTier]};if(windTier>=0)wind={key:'fcst_only',source:'wind',forecastOnly:true,tier:windTier,lead,threshold:[12,14,17][windTier],...P.FORECAST[lead][windTier]};}}
// 줄 순서 특보→파고→풍속: 같은 후보점수는 먼저 나온 줄을 유지한다.
if(wave)candidates.push(wave);if(wind)candidates.push(wind);
const picked=candidates.reduce((best,c)=>c.score>best.score?c:best,{key:null,score:0,rr:1,collisionRr:1});
factors.push({key:'congestion',kind:'congestion',ci:numeric(ci)?ci:null,score:0,missing:!numeric(ci),applied:false});
const warn=warning||warnings.find(w=>['풍랑','태풍'].includes(w.type))||null;
if(warn)factors.push({key:'warning',kind:'warning',...warn,score:warning?P.SEA[warning.level==='경보'?'warn_wrn':'warn_adv'].score:0,rr:warning?P.SEA[warning.level==='경보'?'warn_wrn':'warn_adv'].rr:null,applied:picked.key?.startsWith('warn_')||false});
factors.push({...wave,key:'wave',kind:'wave',value:wh,wh,score:wave?.score||0,rr:wave?.rr??null,missing:!numeric(wh),applied:!!wave&&picked===wave});
factors.push({...wind,key:'wind',kind:'wind',value:ws,ws,score:wind?.score||0,rr:wind?.rr??null,missing:!numeric(ws),applied:!!wind&&picked===wind});
const ciLevel=!numeric(ci)?null:ci<1?0:ci<10?1:ci<20?2:3;
return{...result(picked.score,factors,missing),rr:picked.rr,picked:picked.key,candidate:picked,collisionRr:picked.collisionRr,ci:numeric(ci)?ci:null,ciLevel,clickable:picked.score>0||(ciLevel!==null&&ciLevel>=1),warning:warn};}
/** 연안 요소별 점수를 합산한다. 예: 8월 토요일 행사+혼잡2+위험4+사망→5.30.
 * @param {object} input - {t,now,spot,concentration,events,swell,rip,warnings,ws,dayMax}
 * @returns {object} 공통 점수·사망배수·안내
 * [연계] ← risk_store.js / 정책값과 분석배수를 구분한다.
 */
function scoreCoast({t,now,spot,concentration=null,events=null,swell=null,rip=null,warnings=[],ws=null,dayMax={}}){
const factors=[],missing=[];const day=new Date(T.dateKey(t)+'T00:00:00Z'),month=day.getUTCMonth()+1,weekend=[0,6].includes(day.getUTCDay());
const stage=!numeric(concentration)?0:concentration<12.5?0:concentration<25?1:concentration<50?2:3;
if(!numeric(concentration))missing.push('concentration');
factors.push({key:'concentration',kind:'concentration',stage,cr:concentration,score:P.COAST.crowdScore*stage,rr:P.COAST.crowdRr**stage,fatalRr:P.COAST.crowdFatalRr**stage,missing:!numeric(concentration)});
const hz=spot.hazard||{},count=hz.count||0,bucket=count===0?0:count<=2?1:count<=5?2:3;
factors.push({key:'hazard',kind:'hazard',count,zones:hz.zones||[],zoneIds:hz.zoneIds||[],...P.HAZARDS[bucket]});
if(hz.fatal)factors.push({key:'fatalZone',kind:'fatalZone',score:P.COAST.fatalScore,rr:P.COAST.fatalRr,fatalRr:P.COAST.fatalFatalRr});
if(events===null){missing.push('events');factors.push({key:'event',kind:'event',score:0,missing:true});}else if(events.length)factors.push({key:'event',kind:'event',events,name:events.map(e=>e.name).join(', '),weekend,score:weekend?P.COAST.eventScore:0,rr:weekend?P.COAST.eventRr:null});
factors.push({key:'month',kind:'month',month,...P.MONTHS[month-1]});
// U78: 너울 자료 없으면 줄은 생략하되 결측 상태를 숨기지 않는다.
if(swell&&numeric(swell.periodS)){const on=swell.periodS>=12;factors.push({key:'swell',kind:'swell',periodS:swell.periodS,score:on?P.COAST.policyScore:0,policyScore:on?P.COAST.policyScore:0,analysisRr:P.COAST.swellAnalysisRr});}else missing.push('swell');
if(spot.ripBeach&&T.dayOffset(t,now)===0){if(rip&&rip.hasData!==false&&rip.level){const on=['주의','경계','위험'].includes(rip.level);factors.push({key:'rip',kind:'rip',...rip,score:on?P.COAST.policyScore:0});}else missing.push('rip');}
const score=factors.reduce((sum,f)=>sum+f.score,0),fatalRr=factors.reduce((prod,f)=>prod*(f.fatalRr??1),1);
const order=w=>(w.type==='태풍'?0:w.type==='풍랑'?1:2)*2+(w.level==='경보'?0:1);const sorted=warnings.slice().sort((a,b)=>order(a)-order(b));
return{...result(score,factors,missing),fatalRr,notices:{effective:sorted.filter(w=>w.state==='발효'),prelim:sorted.filter(w=>w.state!=='발효'),day3:T.dayOffset(t,now)===2&&((numeric(dayMax.wh)&&dayMax.wh>=2)||(numeric(dayMax.ws)&&dayMax.ws>=12)),windMs:spot.beach&&numeric(ws)&&ws>=8?Math.round(ws):null}};}
module.exports={scoreSea,scoreCoast};
