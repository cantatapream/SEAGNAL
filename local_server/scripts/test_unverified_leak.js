/**
 * test_unverified_leak.js — **V5-49 의 탐지기가 진짜 잡는지** 고정 문장으로 확인한다.
 *
 * [왜 있나] `unverified_leak_gate.js` 는 지금 값이 **0** 이다. 0 만 찍는 게이트는
 *   「언제나 통과하는 게이트」와 구별되지 않는다(이 저장소가 이름 붙여 경계하는 병 —
 *   2026-09-26 에 `context_size.js` 가 바로 그 꼴이었다). 그래서 **잡아야 하는 줄을
 *   실제로 잡는지**를 고정 문장으로 못박는다.
 *
 * [판정은 생산 함수가 한다] `legal_retriever.markUnresolvedReview` 에 그 줄 하나만 태워
 *   되돌아온 모양으로 가른다 — 배너 정규식을 여기 베껴 쓰지 않는다(L-136).
 *   ⚠베껴 썼다가 상태 배너 67건을 거짓 실패로 셌다(2026-09-26).
 *
 * [연계] `_dashboard/loop/unverified_leak_gate.js`(V5-49) · 등록표 `N-2` · `D-1`
 */
const R = require('../services/legal_retriever.js');
const HEAD = (() => { const o = R.markUnresolvedReview('> ⚠ REVIEW: 표본');
  const l = o.split('\n').find(x => x.startsWith('[미확인')); return l || '[미확인'; })();
function 샌줄인가(line){ let out; try{out=R.markUnresolvedReview(line);}catch(_){return false;}
  if(out===line) return false; if(!out||!out.trim()) return false;
  return out.split('\n').some(l=>l.startsWith(HEAD)); }
const 표본 = [
  ['> ⚠ REVIEW: 처벌 수치 사람 확인 필요',            true,  '진짜 판단 — 잡아야 한다'],
  ['본문 한 줄에 REVIEW 라는 낱말이 섞였다',            true,  '판단으로 보이면 잡는다'],
  ['> ⚠ **draft — 미승인(8차).** REVIEW 남아 되돌림',  false, '상태 배너 — 남긴다'],
  ['> ✅ **canonical(확정) — 승급.** 미해결 REVIEW 0건', false, '상태 배너 — 남긴다'],
  ['| 2026-09-11 | REVIEW 해소 | raw 대조 |',          false, '변경이력 표 행 — 버린다'],
  ['평범한 본문 한 줄',                                false, 'REVIEW 가 없다'],
];
let 맞음=0;
for (const [line, 기대, 왜] of 표본) {
  const 실제 = /\bREVIEW\b/.test(line) ? 샌줄인가(line) : false;
  const ok = 실제 === 기대; if (ok) 맞음++;
  console.log(`  ${ok?'✅':'❌'} 기대 ${String(기대).padEnd(5)} 실제 ${String(실제).padEnd(5)} · ${왜}`);
  if (!ok) console.log(`       줄: ${JSON.stringify(line)}`);
}
// 결과줄 꼴은 러너의 규약이다 — `verify_all.sh:117` 이 `N PASS / N FAIL` 을 grep 한다.
//   ⚠처음엔 `6/6 PASS` 로 찍었다가 「결과줄 없음」으로 실패했다(2026-09-26). 꼴을 짐작하지 않는다.
console.log(`\ntest_unverified_leak — ${맞음} PASS / ${표본.length - 맞음} FAIL`);
process.exit(맞음 === 표본.length ? 0 : 1);
