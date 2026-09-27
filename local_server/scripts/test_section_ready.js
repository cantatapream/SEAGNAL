/**
 * test_section_ready — V5-35(위키 표준 절)의 「세는 법」을 못박는다. (3-4)
 *
 * [왜] 이 게이트가 쉽게 빠질 함정은 하나다 — **「없다」와 「꼬리표」를 한 통에 넣는 것.**
 *   `## 적용범위·제외 (…)` 는 소비자(`startsWith`)가 읽으므로 **깨진 것이 아니다.**
 *   섞어 세면 89가 되고, 갈라 세면 없다 56 · 꼬리표 33 이다. 그 갈라짐을 시험으로 고정한다.
 * [연계] ← `_dashboard/section_rules.json`·`_dashboard/loop/section_ready.js`
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const LEGAL = path.join(__dirname, '..', 'knowledge', 'legal');
const RULES = JSON.parse(fs.readFileSync(path.join(LEGAL, '_dashboard', 'section_rules.json'), 'utf8'));
const TOOL = path.join(LEGAL, '_dashboard', 'loop', 'section_ready.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌ FAIL:', name, extra === undefined ? '' : extra); }
};

console.log('\n[규칙 파일]');
ok('규칙이 한 파일에 있다(게이트는 읽기만 한다)', !!RULES['필수']);
ok('쪽 종류마다 목록이 다르다(원칙 ②)',
  RULES['필수'].concepts.length > RULES['필수'].annexes.length);
ok('공통 필수 둘은 모든 종류에 있다',
  Object.values(RULES['필수']).every(v => v.includes('## 근거 조문') && v.includes('## 변경 이력')));
ok('조건부는 게이트가 보지 않는다(원칙 ③)', !!RULES['조건부_게이트_안함']);
ok('세는 법이 글로 적혀 있다(⑥)', !!(RULES['세는_법'] && RULES['세는_법']['없다'] && RULES['세는_법']['꼬리표']));
ok('별표에 처벌을 강요하지 않는다(원칙 ②)', !RULES['필수'].annexes.includes('## 위반 시 처벌'));

console.log('\n[도구가 둘을 갈라 센다]');
const out = execFileSync('node', [TOOL], { encoding: 'utf8', cwd: LEGAL });
ok('「없다」 줄이 있다', /❌ 없다/.test(out));
ok('「꼬리표」 줄이 있다', /⚠ 꼬리표/.test(out));
ok('★꼬리표를 「깨진 것」이라 부르지 않는다', /깨진 건 아니다|깨진 것이 아니다/.test(out));
const none = Number((/❌ 없다\s+(\d+)/.exec(out) || [])[1]);
const tail = Number((/⚠ 꼬리표\s+(\d+)/.exec(out) || [])[1]);
ok('두 수가 따로 나온다', Number.isFinite(none) && Number.isFinite(tail), `없다=${none} 꼬리표=${tail}`);
ok('둘을 더한 값으로 보고하지 않는다(그 값은 89 꼴이 된다)', none !== none + tail);

console.log('\n[기준선]');
const BASE = path.join(LEGAL, '_dashboard', 'loop', 'baseline', 'section_ready.json');
ok('기준선 파일이 있다', fs.existsSync(BASE));
if (fs.existsSync(BASE)) {
  const b = JSON.parse(fs.readFileSync(BASE, 'utf8'));
  ok('기준선도 둘을 따로 담는다', typeof b['없다'] === 'number' && typeof b['꼬리표'] === 'number');
  ok('기준선이 지금 값과 맞다(늘지 않았다)', b['없다'] >= none && b['꼬리표'] >= tail, JSON.stringify(b));
}

console.log(`\n  ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
