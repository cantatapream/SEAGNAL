/** 파일명: local_server/scripts/test_risk_points.js
 * 역할  : 점수표를 원고와 대조하고 반올림한 지수의 새 단계 경계를 고정한다(연안 달·위험구역은 U81 정정 절 §13과 대조).
 * [연계] risk_points.js · 개발검사 전용
 */
'use strict';
const fs=require('fs'),path=require('path'),P=require('../services/risk_points'),run=require('./risk_test_helpers');
const doc=fs.readFileSync(path.join(__dirname,'../config/coastal_safety/accident_analysis/v3/points_v31.md'),'utf8');
const forecast=fs.readFileSync(path.join(__dirname,'../config/coastal_safety/accident_analysis/v3/fcst_leads.md'),'utf8');
const rows=doc.split('\n').filter(s=>s.startsWith('|')).map(s=>s.split('|').slice(1,-1).map(t=>t.trim()));
// U81(2026-10-15): 연안 달·위험구역 표는 보고서 v3 §13(정정 절)이 원문이다 — 그 절만 잘라 읽는다(앞 절에도 「| 1월 |」 표가 많다).
const report=fs.readFileSync(path.join(__dirname,'../config/coastal_safety/accident_analysis/v3/report.md'),'utf8');
const section=(from,to)=>{const i=report.indexOf(from),j=report.indexOf(to,i+1);if(i<0||j<0)throw Error('보고서 절을 찾지 못함: '+from);return report.slice(i,j).split('\n').filter(s=>s.startsWith('|')).map(s=>s.split('|').slice(1,-1).map(t=>t.trim()));};
const first=s=>Number(String(s).replace('−','-').match(/-?[\d.]+/)[0]);
run({
 'U81 월 점수·배수·사망 배수를 보고서 v3 §13.2 재추정 표 12행과 대조':a=>{const t=section('### 13.2','### 13.3');P.MONTHS.forEach((p,i)=>{const r=t.find(r=>r[0]===`${i+1}월`);a.ok(r,`${i+1}월 행`);a.equal(p.score,first(r[1]));a.equal(p.rr,first(r[2]));a.equal(p.fatalRr,first(r[5]));a.ok(Math.abs(Math.log2(p.rr)-p.score)<.011,'점수 = log2(배수)');});},
 'U81 위험구역 후보 A: 종류마다 0·.44·.70·.88(3곳에서 멈춤)을 보고서 §13.3 표·분석 결과값과 대조':a=>{const t=section('### 13.3','### 13.4');const exact=[0,0.43914371217365067,0.6960263162227209,0.8782874243473013];
   for(const [n,label] of [[0,'0곳'],[1,'1곳'],[2,'2곳'],[3,'3곳 이상']]){const r=t.find(r=>r[0]===label);a.ok(r,label);const h=P.hazardType(n);a.ok(Math.abs(h.score-exact[n])<1e-15,label+' 점수');a.equal(Math.round(h.score*100)/100,first(r[1]));a.equal(Math.round(h.rr*100)/100,first(r[2]));a.equal(Math.round(h.fatalRr*100)/100,first(r[3]));}
   for(const n of [4,6,13])a.deepEqual(P.hazardType(n),P.hazardType(3));a.deepEqual(P.HAZARD_TYPES,['연안사고 위험구역','사망사고 발생구역','연안사고 다발구역']);a.equal(Object.hasOwn(P,'HAZARDS'),false);a.equal(Object.hasOwn(P.COAST,'fatalScore'),false);},
 '해상 선택 점수·배수를 원문과 대조':a=>Object.values(P.SEA).forEach(p=>a.ok(rows.some(r=>r[0]==='해상'&&Number(r[4])===p.score&&r[3].includes(`· ${p.rr}배`)))),
 '오늘·내일 예보 세 단계 원문 대조':a=>{const rs=forecast.split('\n').filter(s=>s.startsWith('| 선박 기상민감 4종 |')).map(s=>s.split('|').slice(1,-1).map(t=>t.trim()));a.equal(rs.length,3);P.FORECAST.forEach((day,d)=>day.forEach((p,i)=>{a.equal(p.rr,Number(rs[i][d+2].split(' ')[0]));a.equal(p.score,Math.log2(p.rr));}));},
 '음수와 초과점수의 지수 상한':a=>{a.equal(P.scoreToIndex(-1),0);a.equal(P.scoreToIndex(9),100);a.equal(P.scoreToIndex(.75),25);},
 '반올림 지수로 20·67·100 단계 선택':a=>{for(const [n,label]of [[19,'평소 수준'],[20,'다소 높음'],[66,'다소 높음'],[67,'높음'],[99,'높음'],[100,'매우 높음']])a.equal(P.scoreBand(n),label);},
 '예보표 경계의 표시 지수':a=>{a.deepEqual(P.FORECAST.map(d=>d.map(p=>P.scoreToIndex(p.score))),[[22,40,71],[23,37,59]]);}
});
