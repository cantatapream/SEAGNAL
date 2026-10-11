/** 파일명: local_server/scripts/test_risk_time.js
 * 역할  : 기존 크롤러 정규화 글자·월말·해제예고·한국 날짜 시간축을 검증한다.
 * [연계] risk_time.js·marine_warning_crawler.js · 개발검사 전용
 */
'use strict';
const T=require('../services/risk_time'),{normalizeMmisTime}=require('../marine_warning_crawler'),run=require('./risk_test_helpers');
const now='2024-01-31T19:17:00+09:00',end='2024-02-01T23:00:00+09:00';
const parse=s=>T.parseMmisTime(s,now);
run({
 '한국 날짜 자정은 UTC15시':a=>{a.equal(T.dateKey('2024-01-31T15:00:00Z'),'2024-02-01');a.equal(T.dayOffset('2024-02-01T01:00:00+09:00',now),1);},
 '크롤러 정확시각 정규화와 일치':a=>{const raw='2024.01.31 21:30';a.equal(parse(raw).start,parse(normalizeMmisTime(raw)).start);a.equal(T.isoKst(parse(raw).start),'2024-01-31T21:30:00+09:00');},
 '크롤러 범위 정규화와 일치':a=>{const raw='31일 21시 ~ 24시';a.deepEqual(parse(raw),parse(normalizeMmisTime(raw)));},
 '레거시58분 범위코드':a=>{const p=parse(normalizeMmisTime('2024.01.31 05:58'));a.equal(T.isoKst(p.start),'2024-01-31T00:00:00+09:00');a.equal(T.isoKst(p.end),'2024-01-31T06:00:00+09:00');},
 '월 생략 다음달1일과 자정넘김':a=>{a.equal(T.isoKst(parse('1일 03시').start),'2024-02-01T03:00:00+09:00');a.equal(T.isoKst(parse('31일 18시~00시').end),'2024-02-01T00:00:00+09:00');},
 '예비 시작 전과 시작시각':a=>{const w={wrnTp:'풍랑',wrnLvl:'예비',tmEf:'31일 21시~24시'};a.equal(T.warningAt(w,'2024-01-31T20:00:00+09:00',now,end).state,'예비');a.equal(T.warningAt(w,'2024-01-31T21:00:00+09:00',now,end).state,'예비가정');a.equal(T.warningAt(w,'2024-01-31T22:00:00+09:00',now,end,{assumePreliminary:false}).state,'예비');},
 '범위형 해제는 그날 마지막까지':a=>{const w={wrnTp:'풍랑',wrnLvl:'주의보',tmCc:'31일 12시~18시'};a.ok(T.warningAt(w,'2024-01-31T23:59:00+09:00',now,end));a.equal(T.warningAt(w,'2024-02-01T00:00:00+09:00',now,end),null);},
 'raw58분도 크롤러 범위와 같음':a=>a.deepEqual(parse('2024.01.31 05:58'),parse(normalizeMmisTime('2024.01.31 05:58'))),
 'native tmYn 해제예정 반영':a=>a.equal(T.warningAt({wrnTpNm:'풍랑',wrnLvlNm:'주의보',tmYn:'31일 21시'},'2024-01-31T21:00:00+09:00',now,end),null),
 '확정 해제 정확시각에서 끝':a=>{const w={wrnTp:'풍랑',wrnLvl:'주의보',tmCc:'31일 21시'};a.ok(T.warningAt(w,'2024-01-31T20:59:00+09:00',now,end));a.equal(T.warningAt(w,'2024-01-31T21:00:00+09:00',now,end),null);},
 '시간축은 분있는 지금과 규정 끝 포함':a=>{a.equal(T.timeline(now)[0],now.replace('19:17:00','19:17:00'));a.equal(T.timeline(now).at(-1),end);a.equal(T.timeline(now,3,3,21).at(-1),'2024-02-02T21:00:00+09:00');},
 '가장 가까운 예보의 동률은 앞값':a=>{a.equal(T.nearest([{t:'2024-01-31T18:00:00+09:00',v:1},{t:'2024-01-31T21:00:00+09:00',v:2}],'2024-01-31T19:30:00+09:00').v,1);},
 '없는 날짜를 넘겨서 지어내지 않음':a=>{a.equal(T.isoKst(T.parseMmisTime('31일 05시','2024-03-01T12:00:00+09:00').start),'2024-03-31T05:00:00+09:00');a.equal(T.parseMmisTime('2월 31일 05시','2024-03-01T12:00:00+09:00'),null);a.equal(parse('2024.01.31 25:70'),null);a.equal(parse('2024.01.31 25:58'),null);},
 'ISO 시간대는 원래 절대시각 보존':a=>a.equal(T.isoKst(parse('2024-01-31T12:00:00Z').start),'2024-01-31T21:00:00+09:00'),
 '해석못하는 시각을 지어내지 않음':a=>a.equal(parse('미정'),null)
});
