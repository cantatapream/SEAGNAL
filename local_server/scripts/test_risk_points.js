/** 파일명: local_server/scripts/test_risk_points.js
 * 역할  : 점수표를 원고와 대조하고 반올림한 지수의 새 단계 경계를 고정한다.
 * [연계] risk_points.js · 개발검사 전용
 */
'use strict';
const fs=require('fs'),path=require('path'),P=require('../services/risk_points'),run=require('./risk_test_helpers');
const doc=fs.readFileSync(path.join(__dirname,'../config/coastal_safety/accident_analysis/v3/points_v31.md'),'utf8');
const forecast=fs.readFileSync(path.join(__dirname,'../config/coastal_safety/accident_analysis/v3/fcst_leads.md'),'utf8');
const rows=doc.split('\n').filter(s=>s.startsWith('|')).map(s=>s.split('|').slice(1,-1).map(t=>t.trim()));
run({
 '월 점수·사망 배수를 원문12행과 대조':a=>P.MONTHS.forEach((p,i)=>{const r=rows.find(r=>r[0]==='연안'&&r[1]==='달'&&r[2]===`${i+1}월`);a.ok(r);a.equal(p.score,Number(r[4]));a.equal(p.rr,Number(r[3].match(/· ([\d.]+)배/)[1]));const pct=Number(r[5].match(/\*\*([+−-]?\d+)%/)[1].replace('−','-'));a.ok(Math.abs(p.fatalRr-(1+pct/100))<1e-12);}),
 '해상 선택 점수·배수를 원문과 대조':a=>Object.values(P.SEA).forEach(p=>a.ok(rows.some(r=>r[0]==='해상'&&Number(r[4])===p.score&&r[3].includes(`· ${p.rr}배`)))),
 '오늘·내일 예보 세 단계 원문 대조':a=>{const rs=forecast.split('\n').filter(s=>s.startsWith('| 선박 기상민감 4종 |')).map(s=>s.split('|').slice(1,-1).map(t=>t.trim()));a.equal(rs.length,3);P.FORECAST.forEach((day,d)=>day.forEach((p,i)=>{a.equal(p.rr,Number(rs[i][d+2].split(' ')[0]));a.equal(p.score,Math.log2(p.rr));}));},
 '음수와 초과점수의 지수 상한':a=>{a.equal(P.scoreToIndex(-1),0);a.equal(P.scoreToIndex(9),100);a.equal(P.scoreToIndex(.75),25);},
 '반올림 지수로 20·67·100 단계 선택':a=>{for(const [n,label]of [[19,'평소 수준'],[20,'다소 높음'],[66,'다소 높음'],[67,'높음'],[99,'높음'],[100,'매우 높음']])a.equal(P.scoreBand(n),label);},
 '예보표 경계의 표시 지수':a=>{a.deepEqual(P.FORECAST.map(d=>d.map(p=>P.scoreToIndex(p.score))),[[22,40,71],[23,37,59]]);}
});
