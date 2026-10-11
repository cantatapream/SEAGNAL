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
test('16방위',()=>assert.equal(F.direction(45),'북동'));
test('HTML 보호',()=>assert.equal(F.escape('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;'));
test('javascript 링크 거부',()=>assert.equal(F.safeURL('javascript:alert(1)'),''));
test('https 링크 허용',()=>assert.equal(F.safeURL('https://example.com/a'),'https://example.com/a'));
test('너울 결측 줄 제외',()=>assert.equal(S.coastRows([{key:'swell',missing:true}]),''));
test('행사 이름 escape',()=>assert.ok(!S.coastRows([{key:'event',name:'<img src=x onerror=alert(1)>',weekend:false,src:'javascript:alert(1)'}]).includes('<img')));
test('위험구역 이름 escape',()=>assert.ok(S.coastRows([{key:'hazard',count:1,rr:1.62,fatalRr:1.18,zones:[{id:'"x',place:'<b>x</b>',shape:'s',class:'c',addr:'<img>',police:'경찰'}]}]).includes('&lt;b&gt;x&lt;/b&gt;')));
test('평일 행사 설명',()=>assert.ok(S.coastRows([{key:'event',name:'축제',weekend:false}]).includes('평일 행사는 과거 사고에 차이가 없어')));
test('사람 0단계 숨김',()=>assert.equal(S.coastRows([{key:'people',stage:0}]),''));
test('배 혼잡 낮음 숨김',()=>assert.equal(S.seaRows([{key:'congestion',level:0,ci:.5}]),''));
test('특보없는 파고2m 노랑',()=>assert.match(S.seaRows([{key:'wave',value:2.5}]),/rf-t-y[^>]*>2\.5m/));
test('특보없는 풍속12m 노랑·정수',()=>assert.match(S.seaRows([{key:'wind',value:14}]),/rf-t-y[^>]*>14m\/s/));
test('높은 혼잡도 빨강',()=>assert.match(S.seaRows([{key:'congestion',ci:12,level:2,levelName:'높음'}]),/rf-t-r/));
test('예보 결측 자료 이름 한국어',()=>assert.equal(S.sourceName('forecast'),'해구 예보'));
console.log(`${pass} PASS / ${fail} FAIL`);process.exitCode=fail?1:0;
