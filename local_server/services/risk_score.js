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
 * @param {object} input - {t,now,ci,wh,ws,warnings}
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
/** 연안 표류 안내의 대상 말을 그 안내가 가리키는 예보 시각의 KST 달로 정한다(사용자 2026-10-18 *"6월 ~ 9월이 좋겠어. 튜브, 물놀이기구. 나머지는 소형보트, 레저기구 등이라고 표현 하자."*).
 * 오늘이 아니라 예보 시각의 달 — 5/31 밤에 본 6/1 예보는 6월 말. 연안 시트(risk_sheet.driftText)·관할 브리핑(station_briefing_rules.landSpot·landAdvice)이 이 값을 그대로 쓴다(설계서 §11.10.36).
 * 예: driftTarget('2026-06-01T00:00:00+09:00') → '튜브·물놀이기구' · driftTarget('2026-05-31T21:00:00+09:00') → '소형 보트·레저기구' · driftTarget('2026-05-31T15:00:00Z')(= 6/1 00시 KST) → '튜브·물놀이기구'
 * @param {string|number} t - 예보 시각(ISO 또는 ms) @returns {string} 대상 말(「등 표류 주의」·「표류 주의」 앞에 붙는다)
 * [연계] ← scoreCoast(notices.driftTarget) → risk_store(표류 안내 target) / 바람 기준·표시 조건·점수와 무관
 */
function driftTarget(t){const month=Number(T.dateKey(t).slice(5,7));return month>=6&&month<=9?'튜브·물놀이기구':'소형 보트·레저기구';}
/** 연안 요소별 점수를 합산한다. 예: 8월 토요일 행사+평소의 4배 붐빔+위험구역(위험2·사망1·다발1)→1.94+(.696+.439+.439)+1.09+.74≈5.34.
 * 사람 혼잡 = .97×max(0,log2(오늘 집중률÷30일 기하평균)) — 30일 평균이 없으면 지어내지 않고 결측(U81①).
 * 위험구역 = 종류마다 coef×log2(min(개수,3)+1) 합(후보 A, U81②) — 구역 종류를 확인할 수 없으면 결측.
 * @param {object} input - {t,now,spot,concentration,concentrationBase:{gm,days}|null,events,swell,rip,warnings,ws}
 * @returns {object} 공통 점수·사망배수·안내(특보·떠밀림 — 3일째 특보급 안내는 연안 2일 제한 「가」 2026-10-15로 없앰 · 표류 대상 말 driftTarget = t 의 KST 달, 2026-10-18 §11.10.36)
 * [연계] ← risk_store.js / 정책값과 분석배수를 구분한다.
 */
function scoreCoast({t,now,spot,concentration=null,concentrationBase=null,events=null,swell=null,rip=null,warnings=[],ws=null}){
const factors=[],missing=[];const day=new Date(T.dateKey(t)+'T00:00:00Z'),month=day.getUTCMonth()+1,weekend=[0,6].includes(day.getUTCDay());
const gm=concentrationBase&&numeric(concentrationBase.gm)&&concentrationBase.gm>0?concentrationBase.gm:null,crowdOk=numeric(concentration)&&gm!==null;
const ratio=crowdOk?concentration/gm:null,doubling=crowdOk&&ratio>0?Math.max(0,Math.log2(ratio)):0;
if(!crowdOk)missing.push('concentration');
factors.push({key:'concentration',kind:'concentration',cr:concentration,base:gm,baseDays:gm===null?null:concentrationBase.days??null,ratio,score:P.COAST.crowdScore*doubling,rr:P.COAST.crowdRr**doubling,fatalRr:P.COAST.crowdFatalRr**doubling,missing:!crowdOk});
const hz=spot.hazard||{},count=hz.count||0,zones=hz.zones||[],typed=zones.length===count&&zones.every(z=>P.HAZARD_TYPES.includes(z['구역분류']));
if(!typed){missing.push('hazard');factors.push({key:'hazard',kind:'hazard',count,zones,zoneIds:hz.zoneIds||[],score:0,missing:true});}
else{const byType=P.HAZARD_TYPES.map(c=>{const n=zones.filter(z=>z['구역분류']===c).length;return{class:c,count:n,...P.hazardType(n)};}),score=byType.reduce((sum,x)=>sum+x.score,0);
factors.push({key:'hazard',kind:'hazard',count,byType,zones,zoneIds:hz.zoneIds||[],score,rr:2**score,fatalRr:byType.reduce((prod,x)=>prod*x.fatalRr,1)});}
if(events===null){missing.push('events');factors.push({key:'event',kind:'event',score:0,missing:true});}else if(events.length)factors.push({key:'event',kind:'event',events,name:events.map(e=>e.name).join(', '),weekend,score:weekend?P.COAST.eventScore:0,rr:weekend?P.COAST.eventRr:null});
factors.push({key:'month',kind:'month',month,...P.MONTHS[month-1]});
// U78: 너울 자료 없으면 줄은 생략하되 결측 상태를 숨기지 않는다.
if(swell&&numeric(swell.periodS)){const on=swell.periodS>=12;factors.push({key:'swell',kind:'swell',periodS:swell.periodS,score:on?P.COAST.policyScore:0,policyScore:on?P.COAST.policyScore:0,analysisRr:P.COAST.swellAnalysisRr});}else missing.push('swell');
if(spot.ripBeach&&T.dayOffset(t,now)===0){if(rip&&rip.hasData!==false&&rip.level){const on=['주의','경계','위험'].includes(rip.level);factors.push({key:'rip',kind:'rip',...rip,score:on?P.COAST.policyScore:0});}else missing.push('rip');}
const score=factors.reduce((sum,f)=>sum+f.score,0),fatalRr=factors.reduce((prod,f)=>prod*(f.fatalRr??1),1);
const order=w=>(w.type==='태풍'?0:w.type==='풍랑'?1:2)*2+(w.level==='경보'?0:1);const sorted=warnings.slice().sort((a,b)=>order(a)-order(b));
return{...result(score,factors,missing),fatalRr,notices:{effective:sorted.filter(w=>w.state==='발효'),prelim:sorted.filter(w=>w.state!=='발효'),windMs:spot.beach&&numeric(ws)&&ws>=8?Math.round(ws):null,driftTarget:driftTarget(t)}};}
module.exports={scoreSea,scoreCoast,driftTarget};
