#!/usr/bin/env node
/**
 * `countBoxRows()` — 표의 「행」을 세는 자 (Q-18 결심 ①, 2026-09-24).
 * ★L-136 — 시험은 **챗봇이 쓰는 그 함수**를 부른다. 여기서 세는 법을 새로 짜지 않는다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const AT = require(path.join(__dirname, '..', 'services', 'article_text.js'));
const RAW = path.join(__dirname, '..', 'knowledge', 'legal', 'raw');
let pass = 0, fail = 0;
const eq = (got, want, why) => {
  if (got === want) { pass++; console.log(`  ✅ ${why}`); }
  else { fail++; console.log(`  ❌ FAIL ${why}: ${got} (바란 것 ${want})`); }
};

console.log('[① 세 가지로 세면 세 답이 나온다 — 그래서 하나로 못박았다]');
const T = [
  '┌────┬────────┐',
  '│구분    │시험과목        │',
  '├────┼────────┤',
  '│1. 제1차│가. 민법        │',
  '│시험    │나. 경제학원론  │',
  '├────┼────────┤',
  '│2. 제2차│가. 감정평가이론│',
  '└────┴────────┘',
].join('\n');
eq(AT.countBoxRows(T), 3, '머리행 + 1차 + 2차 = 3행 (한 행이 두 줄에 걸쳐도 한 행)');
eq(T.split('\n').filter((l) => l.includes('│')).length, 4,
   '참고: 「세로선 있는 줄」로 세면 4 — 같은 표가 3도 되고 4도 된다. 이 자를 쓰지 않는 까닭이다');

console.log('\n[② 테두리·구분선은 행이 아니다]');
eq(AT.countBoxRows('┏━━┓\n┗━━┛'), 0, '테두리뿐이면 0행');
eq(AT.countBoxRows('제목만 있고 표가 없다'), 0, '표가 없으면 0행');

console.log('\n[③ ★작은 표가 들어가 구분선에 글자가 얹혀도 갈라 센다]');
//   감정평가 서식5 에서 실측한 꼴 — 「전부 가로선이어야 구분선」으로 재면 이 7줄이 1행으로 뭉친다.
const NEST = [
  '┠─┬────┴───┬────┨',
  '┃실│기       간     │수습기관│',
  '┃무├────────┼────┤',
  '┃수│~               │        │',
  '┃습├────────┼────┤',
  '┃  │~               │        │',
  '┗━┷━━━━━━━━┷━━━━┛',
].join('\n');
eq(AT.countBoxRows(NEST), 3, '머리 + 두 칸 = 3행 (구분선에 「무」·「습」이 얹혀도 구분선이다)');

console.log('\n[④ 실제 raw — 눈으로 센 값과 같나]');
const f1 = path.join(RAW, '15_관련타부처/감정평가및감정평가사에관한법률/별표/별표1.txt');
if (fs.existsSync(f1)) {
  eq(AT.countBoxRows(fs.readFileSync(f1, 'utf8')), 3,
     '감정평가 시행령 별표1 = 머리행 + 제1차시험 + 제2차시험');
} else { console.log('  ⏭️  그 raw 가 없다 — 건너뛴다'); }

console.log('\n[⑤ 값이 늘 같다 — 두 번 세면 두 번 다 같은 답]');
eq(AT.countBoxRows(T), AT.countBoxRows(T), '같은 표는 몇 번을 세도 같은 수다(뿌리 사슬 ⑥)');

console.log(`\n  ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
