// 미리보기: 10-09 수집 30일 집중률(coast_alt/base.json, 1,354곳)로 새 코드(실제 scoreCoast·수집기 averages30)를 돌려 단계 분포를 센다.
// 행사·너울·이안류·특보 없음으로 둔다(사람·위험구역·달만). 사용: node preview.js <저장소> <base.json>
'use strict';
const [repo,basePath]=process.argv.slice(2);
const S=require(repo+'/local_server/services/risk_score'),P=require(repo+'/local_server/services/risk_points'),tour=require(repo+'/local_server/services/tour_concentration_collector');
const fs=require('fs');
const spots=new Map(JSON.parse(fs.readFileSync(repo+'/local_server/config/coastal_safety/risk_spots.json')).spots.map(p=>[p.id,p]));
const base=JSON.parse(fs.readFileSync(basePath));
const avg=tour.averages30(Object.fromEntries(base.map(o=>[o.id,o.cr30])));
const BANDS=['평소 수준','다소 높음','높음','매우 높음'];
for(const day of ['2026-10-15','2026-10-17']){
  const t=day+'T12:00:00+09:00',now=day+'T09:00:00+09:00',count={new:{},oldMonth:{}},parts={people:[],hazard:[],score:[]};let missingPeople=0;
  for(const o of base){const p=spots.get(o.id);const r=S.scoreCoast({t,now,spot:{...p,ripBeach:null},concentration:o.cr30[day]??null,concentrationBase:avg[o.id]||null,events:[],swell:null,rip:null,warnings:[]});
    if(r.missing.includes('concentration'))missingPeople++;
    count.new[r.band]=(count.new[r.band]||0)+1;
    const old=r.score-P.MONTHS[9].score+.02,b=P.scoreBand(P.scoreToIndex(old));count.oldMonth[b]=(count.oldMonth[b]||0)+1;
    parts.people.push(r.factors.find(f=>f.key==='concentration').score);parts.hazard.push(r.factors.find(f=>f.key==='hazard').score);parts.score.push(r.score);}
  const q=a=>{a=a.slice().sort((x,y)=>x-y);return [.1,.5,.9].map(k=>a[Math.floor(k*(a.length-1))].toFixed(2)).join('/');};
  console.log(day,'새 코드(10월 '+P.MONTHS[9].score+'):',BANDS.map(b=>count.new[b]||0).join('/'),'· 달만 +0.02로 바꾸면:',BANDS.map(b=>count.oldMonth[b]||0).join('/'),'· 사람 결측',missingPeople,'· 사람 점수 10/50/90%',q(parts.people),'· 사람 0점',parts.people.filter(x=>x===0).length,'· 위험구역 10/50/90%',q(parts.hazard),'· 합계 10/50/90%',q(parts.score));
}
