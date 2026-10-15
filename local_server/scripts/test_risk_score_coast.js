/** 파일명: local_server/scripts/test_risk_score_coast.js
 * 역할  : 연안 합산·사망배수 분리·주말·정책값·결측 생략을 검증한다.
 * [연계] risk_score.js · 개발검사 전용
 */
'use strict';
const {scoreCoast}=require('../services/risk_score'),fixture=require('./fixtures/risk_forecast/core_score.json'),run=require('./risk_test_helpers');
const base={...fixture.coast,now:fixture.now};
run({
 '8월토요일 실제확정 예시5.30':a=>{const o=scoreCoast(base);a.ok(Math.abs(o.score-5.3)<1e-12);a.equal(o.index,100);a.equal(Math.round(o.fatalRr*100)/100,10.85);},
 '집중률12.5·25·50은 윗단계':a=>{for(const [cr,stage]of [[12.49,0],[12.5,1],[25,2],[50,3]])a.equal(scoreCoast({...base,concentration:cr}).factors[0].stage,stage);},
 '평일행사 줄은 유지 점수는0':a=>{const o=scoreCoast({...base,t:'2024-08-05T12:00:00+09:00'}).factors.find(f=>f.key==='event');a.equal(o.score,0);a.equal(o.name,'검증 행사');},
 '월 음수점수와 지수0':a=>{const o=scoreCoast({...base,t:'2024-01-02T12:00:00+09:00',spot:{hazard:{count:0}},concentration:5,events:[],swell:{periodS:5}});a.equal(o.score,-.78);a.equal(o.index,0);a.ok(o.rr<1);},
 '너울12초부터 정책 .3만 가산':a=>{const o=scoreCoast({...base,swell:{periodS:12}});a.ok(Math.abs(o.score-scoreCoast(base).score-.3)<1e-12);a.equal(o.factors.find(f=>f.key==='swell').analysisRr,1.25);},
 '너울없으면 줄 생략 결측 유지':a=>{const o=scoreCoast({...base,swell:null});a.ok(o.missing.includes('swell'));a.ok(!o.factors.some(f=>f.key==='swell'));},
 '이안류는 오늘만 적용':a=>{const x={...base,spot:{...base.spot,ripBeach:'검증'},rip:{hasData:true,level:'주의'}};a.ok(scoreCoast(x).factors.some(f=>f.key==='rip'));a.ok(!scoreCoast({...x,t:'2024-08-04T12:00:00+09:00'}).factors.some(f=>f.key==='rip'));},
 '이안류 관심은 줄은 있고0점':a=>{const o=scoreCoast({...base,spot:{...base.spot,ripBeach:'검증'},rip:{hasData:true,level:'관심'}}).factors.find(f=>f.key==='rip');a.equal(o.score,0);},
 '특보 점수제외와 태풍풍랑강풍정렬':a=>{const w=['강풍','풍랑','태풍'].map(type=>({type,level:'주의보',state:'발효'}));const o=scoreCoast({...base,warnings:w});a.equal(o.score,scoreCoast(base).score);a.deepEqual(o.notices.effective.map(w=>w.type),['태풍','풍랑','강풍']);},
 '해수욕장 떠밀림8 경계':a=>{a.equal(scoreCoast({...base,ws:8}).notices.windMs,8);a.equal(scoreCoast({...base,ws:7.99}).notices.windMs,null);},
 '가(2026-10-15) 연안 2일 제한: 3일째 특보급 안내(day3)는 더 이상 만들지 않음':a=>{const n=scoreCoast({...base,t:'2024-08-05T12:00:00+09:00',dayMax:{wh:2,ws:12}}).notices;a.equal(Object.hasOwn(n,'day3'),false);a.deepEqual(Object.keys(n).sort(),['effective','prelim','windMs']);},
 '자료없음을 정상0과 구분':a=>{const o=scoreCoast({...base,concentration:null,events:null});a.ok(o.missing.includes('concentration'));a.ok(o.missing.includes('events'));a.equal(o.factors[0].score,0);}
});
