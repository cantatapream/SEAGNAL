/**
 * test_context_budget.js — 모델에게 넘기는 [근거자료]의 **합계 상한**(P-19)을 고정한다.
 *
 * [왜 있나] 2026-09-22(P-19). 페이지마다의 예산(1~3위 10,000자·4~6위 5,000자·7위 이하 3,000자)은
 * 있었는데 **합계에는 상한이 없었다.** 근거 페이지는 PRIMARY_TOPK 20 + HOP_MAX 20 = 최대 40장이라
 * 골든 291문항 전수 실측에서 한 질문에 **평균 123,839자 · 중앙값 141,183자 · 최대 161,092자**
 * (≈7만 토큰)가 실려 나갔다. 돈·속도도 문제지만, **40장 가운데 묻힌 한 줄은 모델이 못 찾는다.**
 *
 * [무엇을 고정하나]
 *  ① 합계가 상한을 넘지 않는다(본문 기준) — 장수가 몇이든
 *  ② ★**페이지를 버리지 않는다.** 앞부터 채우고 남은 것만 주는 방식은 근거 페이지를
 *    중앙값 39장 → 18장으로 반 토막 냈다. 이 파일이 스스로 금지한 것이라 비례 축소로 바꿨다
 *  ③ 1~3위는 어떤 경우에도 제 예산을 다 받는다(정답 문장은 실측상 거의 다 여기 있다)
 *  ④ 바닥(MIN_BODY_CHARS) 밑으로는 안 준다 — 몇백 자 토막은 근거가 못 된다
 *  ⑤ 장수가 적어 상한에 안 닿으면 **종전과 똑같다**(회귀 0)
 *
 * [production 함수를 그대로 쓴다] L-136 — `R.bodyBudgets` 는 `search()` 가 실제로 부르는 그 함수다.
 *
 * [연계] ← scripts/refactor/verify_all.sh SUITES. → services/legal_retriever.js(bodyBudgets·search) ·
 *        _dashboard/loop/context_size.js(전수 실측) · _dashboard/loop/context_eval.js(정답 문장 도달).
 */
const R = require('../services/legal_retriever.js');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}
const sum = (a) => a.reduce((x, y) => x + y, 0);

const CAP = R.CONTEXT_MAX_CHARS;
const FLOOR = R.MIN_BODY_CHARS;
const TOP = R.TOP_FULL_RANK;

console.log(`── 설정값 (상한 ${CAP.toLocaleString()}자 · 바닥 ${FLOOR}자 · 1~${TOP}위는 온전히) ──`);
ok('상한이 1~3위 예산 합보다 크다(1~3위를 못 채우는 상한은 설계가 깨진 것)',
  CAP > R.MAX_BODY_CHARS * TOP, `${CAP} vs ${R.MAX_BODY_CHARS * TOP}`);
ok('바닥이 0보다 크다', FLOOR > 0);

console.log('\n── ① 합계가 상한을 넘지 않는다 (실제로 올 수 있는 장수 전부) ──');
{
  let worst = 0, worstN = 0;
  for (let n = 1; n <= 40; n++) {   // PRIMARY_TOPK 20 + HOP_MAX 20 = 40 이 실제 상한
    const t = sum(R.bodyBudgets(n));
    if (t > worst) { worst = t; worstN = n; }
  }
  ok('1~40장 어디서도 상한을 안 넘는다', worst <= CAP, `최대 ${worst}자 (${worstN}장)`);
  console.log(`  · 가장 큰 경우: ${worstN}장에서 ${worst.toLocaleString()}자`);
}

console.log('\n── ② ★페이지를 버리지 않는다 ──');
{
  for (const n of [10, 20, 30, 40]) {
    const b = R.bodyBudgets(n);
    ok(`${n}장이면 ${n}장 다 예산을 받는다`, b.length === n && b.every(v => v >= FLOOR),
      JSON.stringify(b.slice(-3)));
  }
}

console.log('\n── ③ 1~3위는 온전하다 ──');
{
  for (const n of [3, 10, 40]) {
    const b = R.bodyBudgets(n);
    ok(`${n}장이어도 1~3위는 ${R.MAX_BODY_CHARS}자 그대로`,
      b.slice(0, Math.min(TOP, n)).every(v => v === R.MAX_BODY_CHARS), JSON.stringify(b.slice(0, TOP)));
  }
}

console.log('\n── ④ 뒤 순위는 줄되 바닥 밑으로는 안 간다 ──');
{
  const b40 = R.bodyBudgets(40);
  ok('40장에서 꼬리 예산이 종전 3,000자보다 작아졌다(상한이 실제로 작동한다)',
    b40[39] < R.TAIL_BODY_CHARS, `꼬리 ${b40[39]}자`);
  ok('그래도 바닥 이상이다', b40[39] >= FLOOR, `꼬리 ${b40[39]}자`);
  ok('예산이 순위를 거스르지 않는다(뒤가 앞보다 크지 않다)',
    b40.every((v, i) => i === 0 || v <= b40[i - 1]), JSON.stringify(b40.slice(0, 8)));
}

console.log('\n── ⑤ 상한에 안 닿으면 종전과 똑같다 (회귀 0) ──');
{
  ok('1장 → 10,000', JSON.stringify(R.bodyBudgets(1)) === JSON.stringify([10000]));
  ok('6장 → 10/10/10 · 5/5/5 천자',
    JSON.stringify(R.bodyBudgets(6)) === JSON.stringify([10000, 10000, 10000, 5000, 5000, 5000]));
  ok('10장 → 꼬리는 종전 3,000자 그대로(합계 57,000 < 상한)',
    R.bodyBudgets(10).slice(6).every(v => v === R.TAIL_BODY_CHARS), JSON.stringify(R.bodyBudgets(10)));
  ok('0장이면 빈 배열', JSON.stringify(R.bodyBudgets(0)) === '[]');
}

console.log('\n── ⑥ 상한을 바꿔도 규칙이 유지된다 (A/B 스위치 NRYA_CONTEXT_MAX) ──');
{
  for (const cap of [40000, 60000, 100000, 200000]) {
    const b = R.bodyBudgets(40, cap);
    ok(`상한 ${cap.toLocaleString()} — 40장 그대로 · 1~3위 온전`,
      b.length === 40 && b.slice(0, TOP).every(v => v === R.MAX_BODY_CHARS),
      `합계 ${sum(b)}`);
  }
  ok('상한을 키우면 합계도 커진다(단조)', sum(R.bodyBudgets(40, 100000)) > sum(R.bodyBudgets(40, 60000)));
  ok('상한이 아주 크면 페이지별 예산 그대로', JSON.stringify(R.bodyBudgets(40, 10000000)).includes('3000'));
}

console.log(`\n  ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
