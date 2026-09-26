/**
 * test_score_body.js — ★「변경 이력」이 **검색 점수에서 빠졌는지**를 고정한다. (결심 4-5ⓐ)
 *
 * [왜 있나] 2026-09-25. `scoreOne()` 과 `termWeights()` 가 **페이지 본문 전체**로 점수와
 * 낱말 가중치(IDF)를 만들었다. 그 본문에 「## 변경 이력」이 들어 있어 **과거 서술이 지금 답을
 * 고르는 데 끼어들었다.** 실측으로 드러난 경위(L-385): 승급 1차 기록을 canonical 987쪽
 * 변경이력에 한 줄씩 넣자 골든 279문항의 `chain` 이 266 → 265 로 떨어졌다
 * (어선법 SOLAS 문항이 `chain → search`). 사장님 결심 **4-5ⓐ** 로 **점수에서만** 뺐다.
 *
 * [무엇을 고정하나]
 *  ① 「변경 이력」 절의 글자는 점수용 본문에 **없다**
 *  ② 그 앞 절과 **뒤에 오는 절**은 그대로 남는다 — 24쪽이 그 절 뒤에 다른 절을 더 갖고 있다
 *  ③ ★그 절이 **두 번** 있는 쪽도 **둘 다** 빠진다(`## 변경 이력` 두 번 · `## 변경 이력 (추가)`)
 *     — 한 번만 자르게 만들었다가 24쪽에서 둘째가 남는 것을 실측으로 찾았다
 *  ④ 그 절이 없는 쪽은 **한 글자도 안 바뀐다**(쓸데없이 건드리지 않는다)
 *  ⑤ ★**`readPage().body` 는 그대로다** — 인용·모델 컨텍스트·되묻기는 본문 전체를 봐야 한다.
 *     여기서 같이 빼면 「그 쪽에 무엇이 적혀 있나」가 바뀌어 **답이 달라진다.** 이 결심은 점수만이다
 *  ⑥ `###`(더 작은 머리)은 절 경계가 아니다 — 변경 이력 안의 작은 머리에서 끊기면 안 된다
 *
 * [연계] ← scripts/refactor/verify_all.sh SUITES.
 *        → services/legal_retriever.js(stripHistory · readPage · scoreOne · termWeights).
 *        근거: 등록부 `4-5` · L-385.
 */
const R = require('../services/legal_retriever.js');
const { stripHistory } = R;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else {
    fail++; console.log(`  ❌ ${name}`); if (extra) console.log(extra);
  }
}

console.log('\n── stripHistory — 점수용 본문에서 「변경 이력」을 뺀다 ──');

{
  const body = [
    '## 근거 조문', '| 법률 | 제5조 | 신고 |', '',
    '## 변경 이력', '| 2026-08-17 | 표 신설 | 원문 대조 |', '',
  ].join('\n');
  const out = stripHistory(body);
  ok('① 변경 이력 표 행이 빠진다', !out.includes('표 신설'));
  ok('① 절 머리도 빠진다', !/변경\s*이력/.test(out));
  ok('   그 앞 절은 남는다', out.includes('## 근거 조문') && out.includes('제5조'));
}

{
  const body = [
    '## 개요', '본문이다.', '',
    '## 변경 이력', '| 2026-08-17 | 지난 일 | 출처 |', '',
    '## 관련 개념', '뒤에 오는 절이다.', '',
  ].join('\n');
  const out = stripHistory(body);
  ok('② 뒤에 오는 절이 살아 있다 (24쪽이 이 꼴이다)',
    out.includes('## 관련 개념') && out.includes('뒤에 오는 절이다'));
  ok('   가운데 것만 빠졌다', !out.includes('지난 일') && out.includes('본문이다'));
}

{
  const body = [
    '## 개요', '본문이다.', '',
    '## 변경 이력', '| 2026-08-17 | 첫째 기록 | 출처 |', '',
    '## 변경 이력 (추가)', '| 2026-09-01 | 둘째 기록 | 출처 |', '',
    '## 관련 개념', '맨 뒤 절이다.', '',
  ].join('\n');
  const out = stripHistory(body);
  ok('③ ★두 번 있어도 둘 다 빠진다 (한 번만 자르게 만들었다가 실측으로 찾았다)',
    !out.includes('첫째 기록') && !out.includes('둘째 기록'),
    `        남은 것: ${JSON.stringify(out)}`);
  ok('   그래도 맨 뒤 절은 살아 있다', out.includes('맨 뒤 절이다'));
  ok('   변경 이력 머리가 하나도 안 남았다', !/변경\s*이력/.test(out));
}

{
  const body = '## 개요\n변경 이력 절이 없는 쪽이다.\n\n## 근거 조문\n| 법률 | 제1조 | — |\n';
  ok('④ 그 절이 없으면 한 글자도 안 바뀐다', stripHistory(body) === body);
}

{
  const body = [
    '## 변경 이력',
    '### 2026년', '| 2026-08-17 | 작은 머리 아래 기록 | 출처 |', '',
    '## 관련 개념', '뒤 절.', '',
  ].join('\n');
  const out = stripHistory(body);
  ok('⑥ `###`(작은 머리)에서 끊기지 않는다 — 그 안의 기록까지 빠진다',
    !out.includes('작은 머리 아래 기록') && !out.includes('### 2026년'),
    `        남은 것: ${JSON.stringify(out)}`);
  ok('   `##` 에서는 끊긴다', out.includes('## 관련 개념'));
}

// ⑤ 실제 위키 한 쪽으로 — 본문(body)은 그대로이고 점수용(scoreBody)만 줄어야 한다
{
  const pages = (R.loadIndex().pages || []);
  const hit = pages.map((p) => R.readPage(p.kind, p.file))
    .find((pg) => pg && /^##\s*변경\s*이력/m.test(pg.body));
  ok('⑤ 실제 위키 쪽을 하나 잡았다', !!hit);
  if (hit) {
    ok('⑤ ★`body` 에는 변경 이력이 **그대로 있다** (인용·컨텍스트·되묻기가 본문을 봐야 한다)',
      /^##\s*변경\s*이력/m.test(hit.body));
    ok('⑤ `scoreBody` 에는 없다', !/^##\s*변경\s*이력/m.test(hit.scoreBody));
    ok('⑤ `scoreBody` 가 `body` 보다 짧다', hit.scoreBody.length < hit.body.length,
      `        body ${hit.body.length} · scoreBody ${hit.scoreBody.length}`);
    ok('⑤ `scoreBody` 는 `stripHistory(body)` 와 같다 — 두 자가 갈리지 않는다(L-136)',
      hit.scoreBody === stripHistory(hit.body));
  }
}

console.log(`\n  ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
