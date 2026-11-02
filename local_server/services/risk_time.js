/**
 * 파일명: local_server/services/risk_time.js
 * 역할  : KST 시간축과 MMIS 확정·예비·해제 시각을 해석한다.
 * [연계] risk_store.js·risk_score.js가 사용 · API/마크업 없음
 * [로드 순서] 위험예측 저장소 이전
 */
'use strict';
const HOUR=3600000,DAY=24*HOUR,KST=9*HOUR;
/** KST 날짜를 돌려준다. 예: 15:00Z→다음 날짜.
 * @param {number|string|Date} t - 기준 시각 @returns {string} YYYY-MM-DD
 * [연계] ← risk_score.js / 같은 한국 날짜인지 판정한다.
 */
function dateKey(t){return new Date(+new Date(t)+KST).toISOString().slice(0,10);}
/** KST ISO 문자열을 만든다. 예: 00:00Z→09:00+09:00.
 * @param {number|string|Date} t - 시각 @returns {string} ISO
 * [연계] ← timeline / API 시각을 표시한다.
 */
function isoKst(t){return new Date(+new Date(t)+KST).toISOString().slice(0,19)+'+09:00';}
/** 날짜 차이를 구한다. 예: 오늘과 내일→1.
 * @param {number|string|Date} t - 목표 @param {number|string|Date} now - 현재
 * @returns {number} 날짜 차이 [연계] ← risk_score.js / 예보 시점 표를 고른다.
 */
function dayOffset(t,now){return(Date.parse(dateKey(t))-Date.parse(dateKey(now)))/DAY;}
/** 지금부터 마지막 날 정시까지 시간축을 만든다. 예: 해상 내일23시.
 * @param {number|string|Date} now - 현재 @param {number} stepH - 간격 @param {number} days - 오늘 포함 날짜 수 @param {number} endHour - 마지막 시
 * @returns {string[]} KST ISO [연계] ← risk_store.js / meta 시간축을 만든다.
 */
function timeline(now,stepH=1,days=2,endHour=23){const n=+new Date(now),base=Date.parse(dateKey(n)+'T00:00:00+09:00'),end=base+(days-1)*DAY+endHour*HOUR,step=stepH*HOUR,out=[isoKst(n)];for(let t=base+(Math.floor((n-base)/step)+1)*step;t<=end;t+=step)out.push(isoKst(t));return out;}
/** MMIS 글자를 시작·끝 시각으로 푼다. 예: 31일18시~00시→다음달0시.
 * @param {string} text - 원시 또는 normalizeMmisTime 결과 @param {number|string|Date} anchor - 월 생략 시 기준
 * @returns {object|null} {start,end,range} ms [연계] ← warningAt / 예비·해제 규칙을 적용한다.
 */
function parseMmisTime(text,anchor){if(!text)return null;const s=String(text).trim(),a=new Date(+new Date(anchor)+KST);let y=a.getUTCFullYear(),m=a.getUTCMonth()+1,d=a.getUTCDate();const full=s.match(/(\d{4})(?:년\s*|[.\/-])(\d{1,2})(?:월\s*|[.\/-])(\d{1,2})(?:일)?/);if(full){y=+full[1];m=+full[2];d=+full[3];}else{const dm=s.match(/(?:(\d{1,2})월\s*)?(\d{1,2})일/);if(!dm){const direct=Date.parse(s);return Number.isFinite(direct)?{start:direct,end:direct,range:false}:null;}if(dm[1])m=+dm[1];d=+dm[2];if(!dm[1]){const candidates=[-1,0,1].map(off=>{const base=new Date(Date.UTC(y,m-1+off,1));const stamp=Date.UTC(base.getUTCFullYear(),base.getUTCMonth(),d)-KST;return new Date(stamp+KST).getUTCDate()===d?stamp:null;}).filter(v=>v!==null);if(!candidates.length)return null;const chosen=candidates.sort((x,z)=>Math.abs(x-+new Date(anchor))-Math.abs(z-+new Date(anchor)))[0];const z=new Date(chosen+KST);y=z.getUTCFullYear();m=z.getUTCMonth()+1;}}
const validDate=new Date(Date.UTC(y,m-1,d));if(validDate.getUTCFullYear()!==y||validDate.getUTCMonth()+1!==m||validDate.getUTCDate()!==d)return null;
const zoneIso=s.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/);if(zoneIso){const stamp=Date.parse(s);return Number.isFinite(stamp)?{start:stamp,end:stamp,range:false}:null;}
const clock=s.slice(full?full.index+full[0].length:s.indexOf('일')+1);
const range=clock.match(/(\d{1,2})(?::(\d{2})|시)?\s*[~∼～-]\s*(\d{1,2})(?::(\d{2})|시)/);
const exact=clock.match(/(\d{1,2})(?::(\d{2})|시\s*(?:(\d{1,2})분)?)/);
if(!range&&!exact)return null;if(!range&&exact&&Number(exact[1])>23)return null;if(!range&&exact&&[58,59].includes(Number(exact[2]||exact[3]||0))){const h=Number(exact[1]),block=h>=18?[18,24]:h>=12?[12,18]:h>=9?[9,12]:h>=6?[6,9]:[0,6];const base=Date.UTC(y,m-1,d)-KST;return{start:base+block[0]*HOUR,end:base+block[1]*HOUR,range:true};}if(range&&(Number(range[1])>24||Number(range[3])>24||Number(range[2]||0)>59||Number(range[4]||0)>59))return null;if(exact&&!range&&(Number(exact[1])>23||Number(exact[2]||exact[3]||0)>59))return null;const midnight=Date.UTC(y,m-1,d)-KST;
if(range){const start=midnight+(+range[1])*HOUR+(+(range[2]||0))*60000;let end=midnight+(+range[3])*HOUR+(+(range[4]||0))*60000;if(end<start)end+=DAY;return{start,end,range:true};}
return{start:midnight+(+exact[1])*HOUR+(+(exact[2]||exact[3]||0))*60000,end:midnight+(+exact[1])*HOUR+(+(exact[2]||exact[3]||0))*60000,range:false};}
/** 특보가 슬라이더 시각에서 어떤 상태인지 고른다. 예: 예비 시작부터 해상만 가정.
 * @param {object} warning - {current,upcoming} 또는 경고 블록 @param {number|string|Date} t - 목표 @param {number|string|Date} now - 현재 @param {number|string|Date} sliderEnd - 끝 @param {object} options - assumePreliminary
 * @returns {object|null} 상태 [연계] ← risk_store.js / 해상·연안의 가정 차이를 구현한다.
 */
function warningAt(warning,t,now,sliderEnd,{assumePreliminary=true}={}){if(!warning)return null;const ts=+new Date(t),end=+new Date(sliderEnd);if(warning.current!==undefined||warning.upcoming!==undefined){const candidates=[warningAt(warning.current,t,now,sliderEnd,{assumePreliminary}),warningAt(warning.upcoming?{...warning.upcoming,preliminary:true}:null,t,now,sliderEnd,{assumePreliminary})].filter(Boolean);return candidates.sort((a,b)=>((b.state==='예비'?0:b.level==='경보'?2:1)-(a.state==='예비'?0:a.level==='경보'?2:1)))[0]||null;}
const type=warning.type||warning.wrnTpNm||warning.wrnTp||'',raw=warning.level||warning.wrnLvlNm||warning.wrnLvl||warning.lvl||'';if(raw==='해제')return null;const level=raw==='경보'?'경보':'주의보',pre=warning.preliminary||/예비/.test(raw)||warning.live==='pre';const anchor=parseMmisTime(warning.tmFc,now)?.start||now;
if(pre){const from=parseMmisTime(warning.tmEf,anchor);if(!from)return{...warning,type,level,state:'예비',from:null};return{...warning,type,level,state:assumePreliminary&&ts>=from.start?'예비가정':'예비',from:isoKst(from.start)};}
const release=parseMmisTime(warning.clrNtcTm||warning.tmCc||warning.tmYn||warning.tmEd,anchor);let until=end;if(release)until=release.range?Date.parse(dateKey(release.start)+'T00:00:00+09:00')+DAY:release.start;if(ts>=until&&release)return null;return{...warning,type,level,state:'발효',until:isoKst(until)};}
/** 시각에 가장 가까운 예보 행을 고른다. 예: 동률은 앞값.
 * @param {object[]} rows - 행 @param {number|string|Date} t - 목표 @param {function} getTime - 시각 추출
 * @returns {object|null} 행 [연계] ← risk_store.js / 예보와 슬라이더를 연결한다.
 */
function nearest(rows,t,getTime=r=>r.t||r.time){let best=null,gap=Infinity,bt=Infinity;for(const row of rows||[]){const n=+new Date(getTime(row)),d=Math.abs(n-+new Date(t));if(d<gap||(d===gap&&n<bt)){best=row;gap=d;bt=n;}}return best;}
module.exports={HOUR,DAY,dateKey,isoKst,dayOffset,timeline,parseMmisTime,warningAt,nearest};
