/** 파일명: local_server/scripts/test_tour_concentration_daily.js
 * 역할  : 관광지 집중률 「그날 값」 매일 쌓기(appendDaily)가 해마다 파일에 쌓이고 5년보다 오래된 날을 지우는지 검증한다.
 * [연계] tour_concentration_collector.js · 개발검사 전용(고정 시각 주입 — 시각 의존 없음)
 */
'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),{appendDaily}=require('../services/tour_concentration_collector'),run=require('./risk_test_helpers');
/** 빈 임시 폴더를 만든다. @returns {string} [연계] ← 아래 검사 */
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'tcd-'));
/** KST 그날 정오의 ms. 예: at('2026-10-15'). @param {string} d @returns {number} */
const at=d=>Date.parse(d+'T03:00:00Z');
const read=(dir,y)=>JSON.parse(fs.readFileSync(path.join(dir,'tour_concentration_daily_'+y+'.json'),'utf8'));
run({
 '그날 값만 쌓고(30일 예측의 다른 날은 안 쌓음) 같은 날 다시 받으면 나중 값':a=>{const dir=tmp();
   let r=appendDaily(dir,{'1|해수욕장':{'2026-10-15':40,'2026-10-16':55},'2|항':{'2026-10-16':10}},at('2026-10-15'));
   a.deepEqual(r,{date:'2026-10-15',spots:1,removedFiles:0});a.deepEqual(read(dir,2026).values,{'1|해수욕장':{'2026-10-15':40}});
   appendDaily(dir,{'1|해수욕장':{'2026-10-15':42}},at('2026-10-15'));appendDaily(dir,{'1|해수욕장':{'2026-10-16':55}},at('2026-10-16'));
   a.deepEqual(read(dir,2026).values,{'1|해수욕장':{'2026-10-15':42,'2026-10-16':55}});},
 '해가 바뀌면 새 파일':a=>{const dir=tmp();appendDaily(dir,{a:{'2026-12-31':1}},at('2026-12-31'));appendDaily(dir,{a:{'2027-01-01':2}},at('2027-01-01'));
   a.deepEqual(read(dir,2026).values,{a:{'2026-12-31':1}});a.deepEqual(read(dir,2027).values,{a:{'2027-01-01':2}});},
 '최대 5년: 5년보다 오래된 날은 지우고, 그 이전 해 파일은 통째로 지움(5년 전 같은 날은 남김)':a=>{const dir=tmp(),w=(y,v)=>fs.writeFileSync(path.join(dir,'tour_concentration_daily_'+y+'.json'),JSON.stringify({year:y,values:v}));
   w(2025,{a:{'2025-12-31':9}});w(2026,{a:{'2026-10-14':1,'2026-10-15':2,'2026-10-16':3},b:{'2026-01-01':4}});
   const r=appendDaily(dir,{a:{'2031-10-15':5}},at('2031-10-15'));a.equal(r.removedFiles,1);a.equal(fs.existsSync(path.join(dir,'tour_concentration_daily_2025.json')),false);
   a.deepEqual(read(dir,2026).values,{a:{'2026-10-15':2,'2026-10-16':3}});a.deepEqual(read(dir,2031).values,{a:{'2031-10-15':5}});},
 '오늘 값이 하나도 없으면 파일을 만들지 않음 · 숫자 아닌 값은 안 쌓음':a=>{const dir=tmp();const r=appendDaily(dir,{a:{'2026-10-16':1},b:{'2026-10-15':null}},at('2026-10-15'));
   a.equal(r.spots,0);a.equal(fs.existsSync(path.join(dir,'tour_concentration_daily_2026.json')),false);},
});
