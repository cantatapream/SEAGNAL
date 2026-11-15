// yebi_timing.js — (분석용, 2026-11-15) 예비특보 취소 시점(시간창 기준)·문장 유무, 「만료」 재분류(끝난 뒤 연장·취소 문장·늦은 정식 특보·문장 없음).
// 실행: node yebi_timing.js   [연계] → raw/ · lifecycle_check.js · config/zone_group_map
// 취소 시점을 시간창 기준으로: 시작 전 / 진행 중(끝까지 남은 분) / 끝난 뒤(문장으로만 나온 취소)
const B=__dirname;
const fs=require('fs');const {lines,splitTop,expand,PARENTS,childrenOf}=require(B+'/lifecycle_check');const {ZONE_GROUP_MAP:G}=require('../../config/zone_group_map');
const KST=s=>Date.parse(String(s).slice(0,19).replace(' ','T')+'+09:00');const fmt=ms=>new Date(ms+9*3600e3).toISOString().slice(0,16).replace('T',' ');
function parseYebi(text,tmFc,all){const out=[];let kind=null;const y0=+String(tmFc).slice(0,4),m0=+String(tmFc).slice(5,7);
 for(const l of lines(text)){const h=l.match(/^\(\d+\)\s*(\S+)\s*예비특보/);if(h){kind=h[1];continue}
  const m=l.match(/^[oOㅇ]\s*(\d+)월\s*(\d+)일\s*[^(]*\((\d+)시~(\d+)시\)\s*:\s*(.+)$/);if(!m||!(kind==='풍랑'||kind==='태풍'))continue;
  const mo=+m[1],dd=+m[2],a=+m[3],b=+m[4];const yr=mo<m0-6?y0+1:(mo>m0+6?y0-1:y0);const day=Date.UTC(yr,mo-1,dd)-9*3600e3;
  for(const tok of splitTop(m[5])){const u=expand(tok,[]);if(u)for(const x of u)if(all||PARENTS.has(x))out.push({unit:x,start:day+a*3600e3,end:day+(b<=a?b+24:b)*3600e3})}}return out}
const key=e=>e.unit+'|'+e.start+'|'+e.end;
const last=list=>{const m=new Map();for(const r of list){const k=String(r.tmFc).slice(0,4)+' '+r.t1Title;if(!m.has(k)||m.get(k).tmIn<r.tmIn)m.set(k,r)}return [...m.values()].sort((a,b)=>a.tmIn.localeCompare(b.tmIn))};
// 2026-11-15 보강: 「동해남부북쪽먼바다」(안쪽+바깥)·「경북앞바다」(북부+남부) 같은 줄임 이름도 그 구역으로 본다
const zoneIn=(txt,u)=>{const t=String(txt||'').replace(/\s+/g,'');if(t.includes(u)||t.includes(u.replace(/(안쪽|바깥)먼바다$/,'먼바다'))||t.includes(u.replace(/(북부|남부|중부)앞바다$/,'앞바다')))return true;for(const [n,ps] of Object.entries(G))if(ps.includes(u)&&t.includes(n))return true;return false};
const cancelTxt=t=>/해제|취소|가능성이\s*(낮|적|없)/.test(String(t||''));   // 2026-11-15 보강: 「적어져」 등
const by={};for(const ym of fs.readdirSync(B+'/raw'))for(const f of fs.readdirSync(B+'/raw/'+ym)){const d=JSON.parse(fs.readFileSync(`${B}/raw/${ym}/${f}`));const o=by[d.officeName]=by[d.officeName]||{y:[],w:[]};for(const it of Object.values(d.items))if(it.result)(it.rpt==='7'?o.y:o.w).push(it.result)}
const rows=[];const after=[];
for(const [off,{y,w}] of Object.entries(by)){const ys=last(y),ws=last(w);
 const formal=ws.map(r=>{const s=new Set();for(const l of lines(r.t6)){const m=l.replace(/^[oOㅇ*]\s*/,'').match(/^(풍랑|태풍)(주의보|경보)\s*:\s*(.+)$/);if(m)for(const tok of splitTop(m[3])){const u=expand(tok,[]);if(u)for(const x of u)if(PARENTS.has(x))s.add(x)}}return{t:KST(r.tmIn),s}});
 const isFormal=(u,a,b)=>formal.some(f=>f.t>=a&&f.t<=b&&f.s.has(u));
 const live=new Map();
 for(const r of ys){const t=KST(r.tmIn);
  for(const [k,v] of [...live])if(v.end<=t){live.delete(k);
    if(!isFormal(v.unit,v.first-3600e3,v.end)){ // 조용히 만료 → 끝난 뒤 12시간 안에 그 구역 취소 문장이 나왔나
      const late=[...ys,...ws].filter(x=>KST(x.tmIn)>v.end&&KST(x.tmIn)<=v.end+12*3600e3&&zoneIn(x.other,v.unit)&&cancelTxt(x.other)).sort((a,b)=>a.tmIn.localeCompare(b.tmIn))[0];
      { // 끝난 뒤 12시간 안 첫 예비 통보문: 같은 구역이 더 뒤 시간창으로 다시 나오면 「끝난 뒤 연장」
        const nx=ys.find(x=>KST(x.tmIn)>v.end&&KST(x.tmIn)<=v.end+12*3600e3);
        const ext=nx&&parseYebi(nx.t4,nx.tmFc).some(e=>e.unit===v.unit&&e.start>=v.end);
        const anyZone=[...ys,...ws].find(x=>KST(x.tmIn)>=v.start-6*3600e3&&KST(x.tmIn)<=v.end+12*3600e3&&zoneIn(x.other,v.unit)&&/예비/.test(x.other));
        global.K=global.K||{끝난뒤연장:0,끝난뒤취소문장:0,그구역언급문장:0,문장없음:[]};
        if(ext)global.K.끝난뒤연장++;else if(late)global.K.끝난뒤취소문장++;else if(anyZone){global.K.그구역언급문장++;(global.MENTION=global.MENTION||[]).push(`${off} ${v.unit} ${fmt(v.start)}~${fmt(v.end).slice(11)} ← ${anyZone.t1Title} ${String(anyZone.tmIn).slice(0,16)} | ${String(anyZone.other).replace(/<br\s*\/?>|\r?\n/g,' / ').slice(0,170)}`)}else if(isFormal(v.unit,v.end,v.end+6*3600e3))global.K.끝난뒤6시간안정식특보=(global.K.끝난뒤6시간안정식특보||0)+1;else global.K.문장없음.push(`${off} ${v.unit} ${fmt(v.start)}~${fmt(v.end).slice(6)}`);
      }
      if(!late){const lo=[...ys,...ws].some(x=>KST(x.tmIn)>=v.start-6*3600e3&&KST(x.tmIn)<=v.end+12*3600e3&&cancelTxt(x.other)&&/풍랑|바다/.test(x.other));global.SIL=global.SIL||{loose:0,none:[]};lo?global.SIL.loose++:global.SIL.none.push(`${off} ${v.unit} ${fmt(v.start)}~${fmt(v.end).slice(6)}`)}
      if(late)after.push({off,unit:v.unit,start:v.start,end:v.end,at:KST(late.tmIn),ho:late.t1Title,txt:String(late.other).replace(/<br\s*\/?>|\r?\n/g,' / ').slice(0,140)})}}
  const now=parseYebi(r.t4,r.tmFc),ks=new Set(now.map(key)),us=new Set(now.map(e=>e.unit));
  for(const [k,v] of [...live])if(!ks.has(k)){live.delete(k);if(isFormal(v.unit,v.first-3600e3,v.end)||us.has(v.unit))continue;
    // 2026-11-15 보강: 같은 시간창에 그 부모의 연안바다·평수구역만 남으면 취소가 아니라 범위 축소(예: 제주 2026 7-13호)
    if(parseYebi(r.t4,r.tmFc,true).some(e=>childrenOf(v.unit).includes(e.unit)&&e.start===v.start&&e.end===v.end)){global.NARROW=(global.NARROW||0)+1;continue}rows.push({off,unit:v.unit,start:v.start,end:v.end,at:t,ho:r.t1Title})}
  for(const e of now)if(!live.has(key(e))&&e.end>t)live.set(key(e),Object.assign({first:t},e))}}
const b={시작전:0,'진행중_끝6시간~1시간전':0,'진행중_끝1시간~10분전':0,'진행중_끝10분전이내':0};
for(const r of rows){const toEnd=(r.end-r.at)/60e3;if(r.at<r.start)b.시작전++;else if(toEnd<=10)b['진행중_끝10분전이내']++;else if(toEnd<=60)b['진행중_끝1시간~10분전']++;else b['진행중_끝6시간~1시간전']++}
console.log('목록에서 빠진 취소',rows.length,b);
const near=rows.filter(r=>(r.end-r.at)/60e3<=10).slice(0,4).map(r=>`${r.off} ${r.ho} ${r.unit} ${fmt(r.start)}~${fmt(r.end).slice(6)} 취소글 ${fmt(r.at)}`);console.log(near);
const pre=rows.filter(r=>r.at<r.start).slice(0,3).map(r=>`${r.off} ${r.ho} ${r.unit} ${fmt(r.start)}~${fmt(r.end).slice(6)} 취소글 ${fmt(r.at)}`);console.log(pre);
const am=after.map(a=>(a.at-a.end)/60e3).sort((x,y)=>x-y);
console.log('끝난 뒤 문장으로 취소(만료 215 중)',after.length,'건, 끝난 뒤 분: 최소',am[0],'중앙',am[Math.floor(am.length/2)],'최대',am[am.length-1]);
for(const a of after.slice(0,5))console.log(` ${a.off} ${a.ho} ${a.unit} ${fmt(a.start)}~${fmt(a.end).slice(6)} → ${fmt(a.at)} | ${a.txt}`);
// 문장 전혀 없는 것: (A) 목록 취소 112 중 그 통보문 참고사항에 그 구역(묶음 포함) 취소 문장 없음
//                   (B) 만료 중 시간창 앞뒤 12시간 안 어느 통보문에도 그 구역 취소 문장 없음 — 그리고 구역 안 적힌 취소 문장조차 없음(느슨)
const allB=[];for(const [off,{y,w}] of Object.entries(by))for(const r of [...last(y),...last(w)])allB.push({off,t:KST(r.tmIn),r});
const near12=(off,a,b)=>allB.filter(x=>x.off===off&&x.t>=a&&x.t<=b);
let A_strict=0,A_loose=0,A_none=[];
for(const r of rows){const bs=near12(r.off,r.at-60e3,r.at+60e3);const s=bs.some(x=>zoneIn(x.r.other,r.unit)&&cancelTxt(x.r.other));const l=bs.some(x=>cancelTxt(x.r.other)&&/풍랑|바다/.test(x.r.other));
 if(s)A_strict++;else if(l)A_loose++;else A_none.push(`${r.off} ${r.ho} ${r.unit} ${fmt(r.start)}~${fmt(r.end).slice(6)} 취소글 ${fmt(r.at)}`)}
console.log('\n목록 취소 112: 그 구역 이름 문장',A_strict,'· 구역 이름은 못 맞췄지만 풍랑 취소 문장 있음',A_loose,'· 문장 전혀 없음',A_none.length);console.log(A_none.slice(0,8));

console.log('\n만료 215 중 끝난 뒤 그 구역 문장',after.length,'· 구역은 못 맞췄지만 근처에 풍랑 취소 문장',global.SIL.loose,'· 문장 전혀 없음',global.SIL.none.length);console.log(global.SIL.none.slice(0,6));

console.log('\n[재분류] 만료 215:',{...global.K,문장없음:global.K.문장없음.length});const c={};for(const x of global.K.문장없음){const o=x.split(' ')[0];c[o]=(c[o]||0)+1}console.log('관서별',c);

console.log('\n범위 축소(취소 아님)',global.NARROW||0);console.log('[후보] ② 목록에서만 빠짐·문장 없음:');for(const x of A_none)console.log('  '+x);console.log('[후보] ③ 아무것도 없음:');for(const x of global.K.문장없음)console.log('  '+x);
console.log('[후보] 근처 문장에 그 구역 언급:');for(const x of global.MENTION||[])console.log('  '+x);
