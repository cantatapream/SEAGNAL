/**
 * 파일명: local_server/scripts/test_risk_format.js
 * 역할  : U77·U78의 위험예측 서식·색·좌표와 HTML/URL 처리를 제품 함수로 검사한다.
 * [연계] risk_format.js · risk_sheet.js / verify_all.sh
 */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const dir=path.join(__dirname,'../../client/js/marine-life/risk-forecast');
const context={window:{},URL,console};vm.createContext(context);
for(const file of ['risk_format.js','risk_sheet.js'])vm.runInContext(fs.readFileSync(path.join(dir,file),'utf8'),context);
const F=context.window.RiskFormat,S=context.window.RiskSheet;let pass=0,fail=0;
/** 사례를 검사하고 verify_all이 읽는 PASS/FAIL 개수를 출력한다. 예: test('서식',()=>assert.equal(...)). @param {string} label 사례 @param {Function} fn 검증 [연계] ← 아래 사례 / → 제품 RiskFormat 함수 */
function test(label,fn){try{fn();pass++;}catch(e){fail++;console.error('FAIL',label,e.message);}}
for(const [rr,expected] of [[1.54,'+54%'],[.58,'−42%'],[1,'±0%'],[2,'약 2배'],[4.27,'약 4.3배'],[14.55,'약 15배']])test('배수 '+rr,()=>assert.equal(F.fmt(rr),expected));
for(const [rr,expected] of [[1.49,'g'],[1.5,'y'],[3.99,'y'],[4,'o'],[7.99,'o'],[8,'r']])test('글자 경계 '+rr,()=>assert.equal(F.tone(rr),expected));
for(const [s,expected] of [[-1,'rgb(47,179,107)'],[0,'rgb(47,179,107)'],[Math.log2(1.5),'rgb(242,194,48)'],[2,'rgb(251,146,60)'],[3,'rgb(224,50,44)'],[5,'rgb(224,50,44)']])test('표시색 경계 '+s,()=>assert.equal(F.col(s),expected));
for(let i=0;i<=100;i++)test('상자 명암 '+i,()=>{const bg=F.col(i*.03),fg=F.ink(bg);const parse=x=>x.match(/\d+/g).slice(0,3).map(Number);const l=F.luminance(parse(bg)),f=fg==='#ffffff'?1:fg==='#000000'?0:F.luminance([16,21,31]);assert.ok((Math.max(l,f)+.05)/(Math.min(l,f)+.05)>=4.5);});
test('좌표 초 carry',()=>assert.equal(F.dms(35+59/60+59.9/3600,true),'36°00′00″N'));
test('좌표 음수',()=>assert.equal(F.dms(-129.5,false),'129°30′00″W'));
test('KST 날짜',()=>assert.equal(F.time('2026-10-09T15:42:00Z'),"'26. 10. 10.(토) 00:42"));
test('시트 고정 일시는 「\'26.mm.dd(요일) HH:mm」 두 자리·KST',()=>{assert.equal(F.stamp('2026-10-14T15:00:00+09:00'),"'26.10.14(수) 15:00");assert.equal(F.stamp('2026-01-02T00:05:00+09:00'),"'26.01.02(금) 00:05");assert.equal(F.stamp('2026-10-09T15:42:00Z'),"'26.10.10(토) 00:42");});
test('시트 고정 일시는 잘못된 시각에 빈 문자열',()=>{assert.equal(F.stamp(''),'');assert.equal(F.stamp('나쁜값'),'');assert.equal(F.stamp(undefined),'');});
test('16방위',()=>assert.equal(F.direction(45),'북동'));
test('HTML 보호',()=>assert.equal(F.escape('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;'));
test('javascript 링크 거부',()=>assert.equal(F.safeURL('javascript:alert(1)'),''));
test('https 링크 허용',()=>assert.equal(F.safeURL('https://example.com/a'),'https://example.com/a'));
test('너울 결측 줄 제외',()=>assert.equal(S.coastRows([{key:'swell',missing:true}]),''));
test('행사 이름 escape',()=>assert.ok(!S.coastRows([{key:'event',name:'<img src=x onerror=alert(1)>',weekend:false,src:'javascript:alert(1)'}]).includes('<img')));
test('위험구역 이름 escape',()=>assert.ok(S.coastRows([{key:'hazard',count:1,rr:1.62,fatalRr:1.18,zones:[{id:'"x',place:'<b>x</b>',shape:'s',class:'c',addr:'<img>',police:'경찰'}]}]).includes('&lt;b&gt;x&lt;/b&gt;')));
test('평일 행사 설명',()=>assert.ok(S.coastRows([{key:'event',name:'축제',weekend:false}]).includes('평일 행사는 과거 사고에 차이가 없어')));
test('U81 사람: 평소(30일 평균) 이하라 0점이면 줄 숨김(종전 「0단계 숨김」)',()=>{assert.equal(S.coastRows([{key:'people',score:0,ratio:.5,cr:5,base:10,rr:1,fatalRr:1}]),'');assert.equal(S.coastRows([{key:'people',stage:0}]),'');});
test('U81 사람 줄: 「평소(30일 평균) 대비 N배」·집중률과 30일 평균을 함께·평소 대비 사고 가능성',()=>{const h=S.coastRows([{key:'people',score:.97,ratio:2,cr:40,base:20,baseDays:30,rr:1.96,fatalRr:1.54}]);assert.match(h,/사람이 평소\(30일 평균\) 대비 <b class="rf-t-y">2\.0배<\/b>라 평소 대비 /);assert.match(h,/집중률 40 · 30일 평균 20/);assert.match(h,/96%<\/b> 높은 사고 발생 가능성/);assert.match(h,/사망·실종 사고 발생 가능성 : 평소 대비 /);assert.doesNotMatch(h,/단계|한산할 때/);});
// 2026-10-15 검토: 30일 평균이 17.3205 처럼 원값 그대로, 1.03배가 「1.0배라 평소 대비 3% 높은」처럼 어긋나 보였다.
test('U81 사람 줄 숫자: 30일 평균은 소수 한 자리 · 2배 미만 배수는 소수 둘째 자리(정수 %와 같은 1% 단위) · 2배 이상은 소수 한 자리',()=>{
  const rr=r=>1.96**Math.log2(r),row=(ratio,base)=>S.coastRows([{key:'people',score:.97*Math.log2(ratio),ratio,cr:+(ratio*base).toFixed(1),base,baseDays:30,rr:rr(ratio),fatalRr:1.54**Math.log2(ratio)}]);
  let h=row(1.03,17.3205);assert.match(h,/30일 평균 17\.3\)/);assert.doesNotMatch(h,/17\.32/);assert.match(h,/대비 <b[^>]*>1\.03배<\/b>라 평소 대비 <b[^>]*>3%<\/b> 높은/);assert.doesNotMatch(h,/1\.0배/);
  assert.match(row(1.84,20),/1\.84배.*30일 평균 20\.0/);assert.match(row(4.27,10),/4\.3배/);assert.match(row(2,20),/2\.0배/);});
test('U81 사람 결측은 「자료 없음」 줄(30일 평균이 없을 때 포함)',()=>assert.match(S.coastRows([{key:'people',missing:true,score:0}]),/사람 혼잡.*자료 없음/));
test('U81 위험구역 줄: 종류별 개수(0곳 종류는 뺌)·모두 N곳·없는 곳 대비',()=>{const h=S.coastRows([{key:'hazard',count:3,rr:1.85,fatalRr:1.86,byType:[{class:'연안사고 위험구역',count:2},{class:'사망사고 발생구역',count:0},{class:'연안사고 다발구역',count:1}],zones:[]}]);assert.match(h,/연안사고 위험구역 2곳 · 연안사고 다발구역 1곳, 모두 <b[^>]*>3곳<\/b> 있어 위험구역 없는 곳 대비/);assert.doesNotMatch(h,/사망사고 발생구역 0곳/);});
test('U81 연안 기준 상세: 새 기준(평소=30일 평균)·종류별 위험구역 점수·재추정 달·0점 뜻 변화 문구, 옛 계단·가산 문구 없음',()=>{const ctx={window:{}};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(dir,'risk_basis_content.js'),'utf8'),ctx);const c=ctx.window.RiskBasisContent.coast;
  for(const t of ['평소(앞으로 30일 집중률의 평균)만큼 붐비고','그 관광지 자신의 평소와 비교','평소(30일 평균)의 2배마다','+0.44 · 0.70 · 0.88','36% · 62% · 84% 높음','8월 67% 높음 … 1월 48% 낮음','+0.74 … −0.95','종류마다 3곳까지만 셉니다'])assert.ok(c.includes(t),t);
  for(const t of ['사람이 가장 적고','사람 혼잡 1단계마다','1~2 / 3~5 / 6곳 이상','사망사고 발생구역 3km 안','단계 경계는 검증하지 못한 값'])assert.ok(!c.includes(t),t);});
test('U81 사망사고 발생구역 가산 줄(fatalZone)은 더 그리지 않음',()=>assert.equal(S.coastRows([{key:'fatalZone',rr:1.29,fatalRr:1.3}]),''));
test('배 혼잡 낮음 숨김',()=>assert.equal(S.seaRows([{key:'congestion',level:0,ci:.5}]),''));
test('특보없는 파고2m 노랑',()=>assert.match(S.seaRows([{key:'wave',value:2.5}]),/rf-t-y[^>]*>2\.5m/));
test('특보없는 풍속12m 노랑·정수',()=>assert.match(S.seaRows([{key:'wind',value:14}]),/rf-t-y[^>]*>14m\/s/));
test('높은 혼잡도 빨강',()=>assert.match(S.seaRows([{key:'congestion',ci:12,level:2,levelName:'높음'}]),/rf-t-r/));
test('예보 결측 자료 이름 한국어',()=>assert.equal(S.sourceName('forecast'),'해구 예보'));
test('예보만 높은 파고는 해당행에 근거·반영 꼬리표 표시',()=>{const html=S.seaRows([{key:'wave',value:2.7,forecastOnly:true,cond:'fcst_only',threshold:2.5,lead:0,rr:2.29,used:true}]);assert.match(html,/파고.*위험지수에 반영/);assert.match(html,/특보 없는 오늘 파고.*2\.5m 이상/);assert.match(html,/약 2\.3배/);assert.ok(!html.includes('특보급 날씨 예보'));assert.ok(!html.includes('특보 중'));});
test('예보만 풍속 단계 근거는 실제 임계값 사용',()=>assert.match(S.seaRows([{key:'wind',value:17.4,forecastOnly:true,cond:'fcst_only',threshold:17,lead:1,rr:3.39,used:true}]),/특보 없는 내일 풍속.*17m\/s 이상/));
test('낡은 예보 기준은 해당 파고줄에도 표시',()=>assert.match(S.seaRows([{key:'wave',value:2.6,sourceTime:"'26. 10. 9.(금) 09:00"}]),/예보 기준/));
test('원천 실패와 한산함을 구분하고 마지막 성공시각 표시',()=>{const text=S.sourceMessages({sources:{congestion:{status:'error',lastSuccess:'2026-10-09T05:14:00+09:00'}}},'sea').join();assert.match(text,/수집에 실패/);assert.match(text,/마지막 수집 '26\. 10\. 9\./);});
test('UTC10자리 예보발표는 KST기준으로 표시',()=>assert.match(S.sourceMessages({sources:{zoneForecasts:{status:'stale',base:'2026100912',updatedAt:'2026-10-09T22:00:00+09:00'}}},'sea').join(),/예보 기준 '26\. 10\. 9\.\(금\) 21:00/));
test('선택일 다음달행사 누락을 당월정상과 분리',()=>{const sources={events:{status:'ok',months:{'2026-10':{status:'ok'},'2026-11':{status:'missing'}}}};assert.equal(S.sourceMessages({t:'2026-10-31T21:00:00+09:00',sources},'coast').length,0);assert.match(S.sourceMessages({t:'2026-11-01T00:00:00+09:00',sources},'coast').join(),/행사 자료를 받지 못했습니다/);});
test('행사 개별 원문과 공식원천 링크 문구 구분',()=>{const html=S.coastRows([{key:'event',name:'축제A, 경기B',weekend:false,events:[{name:'축제A',src:'https://example.com/a',sourceType:'tourapi',start:'2026-10-11',end:'2026-10-12'},{name:'경기B',src:'https://example.com/b',start:'2026-10-11',end:'2026-10-11'}]}]);assert.match(html,/축제A · 관광공사 원천 자료/);assert.match(html,/경기B · 행사 원문/);assert.match(html,/https:\/\/example\.com\/b/);});
console.log(`${pass} PASS / ${fail} FAIL`);process.exitCode=fail?1:0;
