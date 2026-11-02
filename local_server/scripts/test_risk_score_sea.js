/** 파일명: local_server/scripts/test_risk_score_sea.js
 * 역할  : 선택시각 예보·특보 최대후보·혼잡 결측·강풍 제외를 검증한다.
 * [연계] risk_score.js · 개발검사 전용
 */
'use strict';
const {scoreSea}=require('../services/risk_score'),fixture=require('./fixtures/risk_forecast/core_score.json'),run=require('./risk_test_helpers');
const base={t:fixture.sea.t,now:fixture.now,ci:.4,wh:1,ws:5,warnings:[]},warn=(level='주의보',state='발효',type='풍랑')=>({type,level,state});
run({
 '정상 저혼잡은 눌리지 않음':a=>a.equal(scoreSea(base).clickable,false),
 '날씨 없어도 혼잡보통부터 누름':a=>{const o=scoreSea({...base,ci:1});a.equal(o.ciLevel,1);a.ok(o.clickable);a.equal(o.score,0);},
 '주의보 점수25와 표배수 유지':a=>{const o=scoreSea({...base,warnings:[warn()],wh:2.6,ws:13});a.equal(o.index,25);a.equal(o.rr,1.68);a.equal(o.collisionRr,.4);},
 '큰파고와강풍을 더하지 않고 최대선택':a=>{const o=scoreSea({...fixture.sea,now:fixture.now});a.equal(o.score,3.86);a.equal(o.picked,'wave4m');a.equal(o.rr,14.55);},
 '풍속14와17 경계 포함':a=>{a.equal(scoreSea({...base,warnings:[warn()],ws:14}).score,2.09);const o=scoreSea({...base,warnings:[warn()],ws:17});a.equal(o.score,3.39);a.equal(o.collisionRr,null);},
 '예비 가정전 특보점수 없음':a=>a.equal(scoreSea({...base,warnings:[warn('주의보','예비')]}).score,0),
 '예비 가정시 특보 후보 적용':a=>a.equal(scoreSea({...base,warnings:[warn('주의보','예비가정')]}).score,.75),
 '오늘과내일 세기단계 다름':a=>{for(const [wh,i,j]of [[2,22,23],[2.5,40,37],[4,71,59]]){a.equal(scoreSea({...base,wh}).index,i);a.equal(scoreSea({...base,wh,t:'2024-08-04T12:00:00+09:00'}).index,j);}},
 '예보 근거는 파고·풍속 각 행에 제공':a=>{const o=scoreSea({...base,wh:2.5,ws:12});a.equal(o.picked,'fcst_only');const wave=o.factors.find(f=>f.key==='wave'),wind=o.factors.find(f=>f.key==='wind');a.equal(wave.forecastOnly,true);a.equal(wave.rr,2.29);a.equal(wave.threshold,2.5);a.equal(wave.lead,0);a.equal(wave.applied,true);a.equal(wind.rr,1.59);a.equal(wind.threshold,12);a.equal(wind.applied,false);a.equal(o.factors.some(f=>f.key==='forecast'),false);},
 '예보 동률은 파고 줄 하나에 반영':a=>{const o=scoreSea({...base,wh:2.5,ws:14});a.equal(o.factors.find(f=>f.key==='wave').applied,true);a.equal(o.factors.find(f=>f.key==='wind').applied,false);a.equal(o.factors.filter(f=>f.applied).length,1);},
 '미선택 특보중 후보도 분석점수를 보존':a=>{const o=scoreSea({...base,wh:4.4,ws:18,warnings:[warn('경보')]});const wind=o.factors.find(f=>f.key==='wind');a.equal(wind.score,3.39);a.equal(wind.rr,10.46);a.equal(wind.applied,false);a.equal(o.score,3.86);},
 '하루최대 나빠도 선택시각 순하면 점수없음':a=>a.equal(scoreSea({...base,dayMax:{wh:5,ws:20}}).score,0),
 '해상 강풍특보 점수 제외':a=>a.equal(scoreSea({...base,warnings:[warn('경보','발효','강풍')]}).score,0),
 '혼잡과예보 결측은 명시':a=>{const o=scoreSea({...base,ci:null,wh:null,ws:null});a.deepEqual(o.missing,['congestion','forecast']);a.equal(o.ciLevel,null);},
 '입력 객체를 바꾸지 않음':a=>{const x=JSON.parse(JSON.stringify(fixture.sea)),before=JSON.stringify(x);scoreSea({...x,now:fixture.now});a.equal(JSON.stringify(x),before);}
});
