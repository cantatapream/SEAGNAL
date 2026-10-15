/** 파일명: local_server/scripts/test_risk_score_coast.js
 * 역할  : 연안 합산·사망배수 분리·주말·정책값·결측 생략과 U81(사람 30일 평균 대비·위험구역 후보 A)을 검증한다.
 * [연계] risk_score.js · 개발검사 전용
 */
'use strict';
const {scoreCoast}=require('../services/risk_score'),P=require('../services/risk_points'),fixture=require('./fixtures/risk_forecast/core_score.json'),run=require('./risk_test_helpers');
const base={...fixture.coast,now:fixture.now};
/** 종류별 위험구역 목록을 만든다. 예: zonesOf(2,1,0) → 위험 2·사망 1. @param {number} r @param {number} f @param {number} q @returns {object[]} [연계] ← 아래 검사 */
const zonesOf=(r,f,q)=>[['연안사고 위험구역',r],['사망사고 발생구역',f],['연안사고 다발구역',q]].flatMap(([c,n])=>Array.from({length:n},(_,i)=>({id:c+i,'구역분류':c})));
const crowd=o=>o.factors.find(f=>f.key==='concentration'),hazard=o=>o.factors.find(f=>f.key==='hazard');
run({
 'U81 8월토요일 예시: 평소의4배(1.94)+위험2·사망1·다발1(.696+.439+.439)+주말행사1.09+8월.74≈5.34':a=>{const o=scoreCoast(base),want=.97*2+P.hazardType(2).score+2*P.hazardType(1).score+1.09+.74;a.ok(Math.abs(o.score-want)<1e-12);a.equal(Math.round(o.score*100)/100,5.34);a.equal(o.index,100);a.equal(Math.round(o.fatalRr*100)/100,12.54);},
 'U81 사람: 30일 평균 대비 0.5배→0점 · 1배→0점 · 2배→0.97점(연속값, 계단 없음)':a=>{const at=x=>crowd(scoreCoast({...base,concentration:20*x,concentrationBase:{gm:20,days:30}}));
   a.equal(at(.5).score,0);a.equal(at(.5).rr,1);a.equal(at(.5).fatalRr,1);a.equal(at(.5).missing,false);a.equal(at(1).score,0);a.ok(Math.abs(at(2).score-.97)<1e-12);a.ok(Math.abs(at(2).rr-1.96)<1e-12);a.ok(Math.abs(at(2).fatalRr-1.54)<1e-12);
   a.ok(Math.abs(at(1.5).score-.97*Math.log2(1.5))<1e-12);a.ok(at(1.99).score<at(2.01).score&&at(2.01).score-at(1.99).score<.02);a.equal(Object.hasOwn(at(2),'stage'),false);a.equal(at(2).base,20);a.equal(at(2).baseDays,30);a.equal(at(2).ratio,2);},
 'U81 사람: 30일 평균이 없으면 결측(지어내지 않음) · 오늘 0이면 0점':a=>{for(const b of [null,{},{gm:0,days:3},{gm:null}]){const o=scoreCoast({...base,concentrationBase:b});a.ok(o.missing.includes('concentration'));a.equal(crowd(o).missing,true);a.equal(crowd(o).score,0);}
   const z=scoreCoast({...base,concentration:0});a.equal(crowd(z).missing,false);a.equal(crowd(z).score,0);a.ok(!z.missing.includes('concentration'));},
 'U81 위험구역 후보 A: 종류마다 3곳에서 멈추고 더함 · 사망 가산 줄 없음':a=>{const at=(r,f,q)=>hazard(scoreCoast({...base,spot:{hazard:{count:r+f+q,zones:zonesOf(r,f,q)}}}));
   a.ok(Math.abs(at(6,0,0).score-0.8782874243473013)<1e-15);a.ok(Math.abs(at(1,1,1).score-3*0.43914371217365067)<1e-15);a.ok(Math.abs(at(4,3,3).score-3*0.8782874243473013)<1e-12);a.equal(at(0,0,0).score,0);
   a.deepEqual(at(2,0,1).byType.map(t=>[t.class,t.count]),[['연안사고 위험구역',2],['사망사고 발생구역',0],['연안사고 다발구역',1]]);a.ok(Math.abs(at(2,0,1).rr-2**at(2,0,1).score)<1e-12);a.ok(Math.abs(at(1,1,1).fatalRr-1.3633303367286298**3)<1e-12);
   a.ok(!scoreCoast(base).factors.some(f=>f.key==='fatalZone'));},
 'U81 위험구역: 구역 종류를 확인할 수 없으면(목록 없음·개수 불일치·모르는 분류) 결측':a=>{for(const hz of [{count:2},{count:2,zones:zonesOf(1,0,0)},{count:1,zones:[{id:'x','구역분류':'기타'}]}]){const o=scoreCoast({...base,spot:{hazard:hz}});a.ok(o.missing.includes('hazard'));a.equal(hazard(o).missing,true);a.equal(hazard(o).score,0);}},
 '평일행사 줄은 유지 점수는0':a=>{const o=scoreCoast({...base,t:'2024-08-05T12:00:00+09:00'}).factors.find(f=>f.key==='event');a.equal(o.score,0);a.equal(o.name,'검증 행사');},
 '월 음수점수와 지수0(U81 재추정 1월 −0.95)':a=>{const o=scoreCoast({...base,t:'2024-01-02T12:00:00+09:00',spot:{hazard:{count:0}},concentration:5,events:[],swell:{periodS:5}});a.equal(o.score,-.95);a.equal(o.index,0);a.ok(o.rr<1);},
 '너울12초부터 정책 .3만 가산':a=>{const o=scoreCoast({...base,swell:{periodS:12}});a.ok(Math.abs(o.score-scoreCoast(base).score-.3)<1e-12);a.equal(o.factors.find(f=>f.key==='swell').analysisRr,1.25);},
 '너울없으면 줄 생략 결측 유지':a=>{const o=scoreCoast({...base,swell:null});a.ok(o.missing.includes('swell'));a.ok(!o.factors.some(f=>f.key==='swell'));},
 '이안류는 오늘만 적용':a=>{const x={...base,spot:{...base.spot,ripBeach:'검증'},rip:{hasData:true,level:'주의'}};a.ok(scoreCoast(x).factors.some(f=>f.key==='rip'));a.ok(!scoreCoast({...x,t:'2024-08-04T12:00:00+09:00'}).factors.some(f=>f.key==='rip'));},
 '이안류 관심은 줄은 있고0점':a=>{const o=scoreCoast({...base,spot:{...base.spot,ripBeach:'검증'},rip:{hasData:true,level:'관심'}}).factors.find(f=>f.key==='rip');a.equal(o.score,0);},
 '특보 점수제외와 태풍풍랑강풍정렬':a=>{const w=['강풍','풍랑','태풍'].map(type=>({type,level:'주의보',state:'발효'}));const o=scoreCoast({...base,warnings:w});a.equal(o.score,scoreCoast(base).score);a.deepEqual(o.notices.effective.map(w=>w.type),['태풍','풍랑','강풍']);},
 '해수욕장 떠밀림8 경계':a=>{a.equal(scoreCoast({...base,ws:8}).notices.windMs,8);a.equal(scoreCoast({...base,ws:7.99}).notices.windMs,null);},
 '가(2026-10-15) 연안 2일 제한: 3일째 특보급 안내(day3)는 더 이상 만들지 않음':a=>{const n=scoreCoast({...base,t:'2024-08-05T12:00:00+09:00',dayMax:{wh:2,ws:12}}).notices;a.equal(Object.hasOwn(n,'day3'),false);a.deepEqual(Object.keys(n).sort(),['effective','prelim','windMs']);},
 '자료없음을 정상0과 구분':a=>{const o=scoreCoast({...base,concentration:null,events:null});a.ok(o.missing.includes('concentration'));a.ok(o.missing.includes('events'));a.equal(o.factors[0].score,0);}
});
