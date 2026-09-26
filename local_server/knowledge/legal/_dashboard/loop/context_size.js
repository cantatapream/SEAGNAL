/**
 * context_size.js — 한 질문에 **모델로 넘어가는 근거자료가 몇 자인가**를 골든 291문항 전수로 잰다.
 *
 * [왜 있나 — P-19]
 * `synthesizeAnswerStream` 은 `buildContextBlock(contextPages)` 를 **통째로** 프롬프트에 붙인다.
 * 페이지마다 예산은 있었다(1~3위 10,000자 · 4~6위 5,000자 · 7위 이하 3,000자) — 그런데
 * **합계에는 상한이 없었다.** 페이지는 PRIMARY_TOPK 20 + HOP_MAX 20 = 최대 40장이다.
 * 이 자로 처음 재 보니 **평균 123,839자 · 중앙값 141,183자 · 최대 161,092자**(≈7만 토큰)였다.
 * 그 실측으로 `CONTEXT_MAX_CHARS` 를 정했고(2026-09-22), 지금 이 자는 **그 상한이 실제로
 * 듣는지**를 계속 재는 용도다.
 *
 * [production 함수를 그대로 쓴다] L-136: `R.search` → `R.buildContextBlock` 을 챗봇이 쓰는 그대로
 *   부른다. 여기서 따로 흉내 내면 숫자가 통째로 헛것이 된다.
 *
 * ⚠**이 자가 재지 못하는 것**: ①AI 키가 없어 검색어 확장(expandQueryTerms)이 빠진다 —
 *   운영에서는 후보가 더 들어와 **합계가 이보다 클 수 있다**(작지는 않다).
 *   ②`historyBlock`(이어묻기)과 `ANSWER_RULES` 는 안 센다 — **근거자료 블록만** 잰다.
 *
 * [★2026-09-26 — 이 자는 기준선이 없었다 (G-51)]
 *   기록 파일 `baseline/context_size.json` 이 있었지만 **실행할 때마다 덮어썼다.** 그러면
 *   그것은 기준선이 아니라 「마지막 측정값」이고, **무엇을 해도 빨간불이 안 난다.**
 *   게다가 `verify_all.sh` 가 이 자를 **부르지 않았다** — 뿌리 사슬 ③④ 그대로다.
 *   그래서 ①기본 실행은 기록을 **건드리지 않고** ②`--update` 만 다시 쓰고
 *   ③`--gate` 가 기준선과 견주며 ④게이트(V5-48)가 그것을 부른다.
 *
 * [무엇을 지키나 — G-51 의 본론]
 *   `CONTEXT_MAX_CHARS`(80,000)는 **본문 합계**만 묶는다. `buildContextBlock` 이 쪽마다
 *   머리글·메타를 덧붙이므로 **모델이 받는 덩어리는 그보다 크다**(실측 15.3%).
 *   그 어긋남을 없앨 수는 없다 — 대신 **자라지 않게 잠근다.** 이 자가 재는 값은
 *   `buildContextBlock()` 의 결과 길이, 곧 **모델이 실제로 받는 크기**다.
 *
 * [쓰는 법] node local_server/knowledge/legal/_dashboard/loop/context_size.js
 *   NRYA_PRIMARY_TOPK=10 을 주면 그 설정으로 다시 잴 수 있다.
 *   --gate    기준선과 견준다(넘으면 exit 1) · --update  기준선을 다시 쓴다(좋아졌을 때만)
 *
 * [연계] → services/legal_retriever.js(search·buildContextBlock) ·
 *         pinned/golden_questions.json(291문항) · 00_WORKLIST P-19.
 */
const fs = require('fs');
const path = require('path');
const R = require('../../../../services/legal_retriever.js');

const QFILE = path.join(__dirname, 'pinned', 'golden_questions.json');
const BASE = path.join(__dirname, 'baseline', 'context_size.json');
const GATE = process.argv.includes('--gate');
const UPDATE = process.argv.includes('--update');
// ★얼마까지 자라도 되나. 0 을 요구하지 않는다 — raw 가 하루에도 바뀌므로 몇십 자는 늘 움직인다
//   (실측: 9-22 최대 92,449 → 9-26 최대 92,484, 35자 차이). 그 흔들림은 넘기고 **의미 있는 증가**만
//   잡는다. 1% 는 최대값에서 약 900자 — 쪽 하나가 더 붙으면 수천 자가 늘므로 그건 반드시 걸린다.
const TOL = 0.01;

/** 대략의 토큰 수. 한국어는 글자당 대략 0.4~0.5 토큰이라 **0.45 로 어림한다**(정확한 수가 아니다). */
const TOK_PER_CHAR = 0.45;

function pct(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

(async () => {
  const qs = JSON.parse(fs.readFileSync(QFILE, 'utf8')).questions;
  const rows = [];
  for (const q of qs) {
    let res = null;
    try { res = await R.search(q.question, {}); } catch (_) { res = null; }
    const pages = (res && res.contextPages) || [];
    const block = pages.length ? R.buildContextBlock(pages) : '';
    rows.push({ q: q.question, law: q.law, pages: pages.length, chars: block.length });
  }

  const chars = rows.map(r => r.chars).sort((a, b) => a - b);
  const pages = rows.map(r => r.pages).sort((a, b) => a - b);
  const sum = chars.reduce((a, b) => a + b, 0);
  const avg = Math.round(sum / (chars.length || 1));

  console.log('── 한 질문의 [근거자료] 크기 (골든 ' + rows.length + '문항 전수) ──');
  console.log(`  평균     ${avg.toLocaleString()}자  (≈${Math.round(avg * TOK_PER_CHAR).toLocaleString()}토큰 어림)`);
  console.log(`  중앙값   ${pct(chars, 0.5).toLocaleString()}자`);
  console.log(`  최소     ${chars[0].toLocaleString()}자`);
  console.log(`  90분위   ${pct(chars, 0.9).toLocaleString()}자`);
  console.log(`  최대     ${chars[chars.length - 1].toLocaleString()}자  (≈${Math.round(chars[chars.length - 1] * TOK_PER_CHAR).toLocaleString()}토큰 어림)`);
  console.log(`  근거 페이지 수 — 중앙값 ${pct(pages, 0.5)}장 · 최대 ${pages[pages.length - 1]}장`);
  console.log(`  합계 상한(본문 기준) ${R.CONTEXT_MAX_CHARS.toLocaleString()}자 — `
    + `머리줄·협약 문단은 따로 붙으므로 완성된 블록은 이보다 조금 크다.`);
  console.log(`  (NRYA_CONTEXT_MAX 로 바꿔 다시 잴 수 있다)`);

  console.log('\n  큰 쪽 5문항:');
  rows.slice().sort((a, b) => b.chars - a.chars).slice(0, 5)
    .forEach(r => console.log(`    ${String(r.chars).padStart(7)}자 · ${String(r.pages).padStart(2)}장 — ${r.q.slice(0, 50)}`));

  const 이번 = {
    잰날: new Date().toISOString().slice(0, 10), 문항: rows.length,
    평균: avg, 중앙값: pct(chars, 0.5), 최소: chars[0], '90분위': pct(chars, 0.9), 최대: chars[chars.length - 1],
    페이지중앙값: pct(pages, 0.5), 페이지최대: pages[pages.length - 1],
  };

  let 기준선 = null;
  try { 기준선 = JSON.parse(fs.readFileSync(BASE, 'utf8')); } catch (_) { 기준선 = null; }

  if (GATE) {
    if (!기준선) { console.error('  ★기준선이 없다 — 먼저 --update 로 만든다.'); process.exit(1); }
    const 탈 = [];
    const 본다 = (이름, 지금, 옛) => {
      if (!Number.isFinite(옛)) return;
      const 한계 = Math.round(옛 * (1 + TOL));
      const 판 = 지금 <= 한계;
      console.log(`  ${판 ? '✅' : '❌'} ${이름} ${지금.toLocaleString()} `
        + `(기준선 ${옛.toLocaleString()} · 한계 ${한계.toLocaleString()})`);
      if (!판) 탈.push(`${이름} ${지금} > ${한계}`);
    };
    console.log(`\n── 기준선 대조 (기준선 잰날 ${기준선.잰날} · 허용 +${Math.round(TOL * 100)}%) ──`);
    본다('평균', 이번.평균, 기준선.평균);
    본다('최대', 이번.최대, 기준선.최대);
    본다('페이지최대', 이번.페이지최대, 기준선.페이지최대);
    if (탈.length) {
      console.error('  ★모델이 받는 근거자료가 커졌다 — ' + 탈.join(' · '));
      console.error('    ⚠먼저 무엇이 늘었는지 열어 본다(G-49 — 빨간불에 기준선을 다시 굽지 않는다).');
      console.error('    쪽수가 늘었으면 PRIMARY_TOPK·HOP_MAX 를, 본문이 늘었으면 CONTEXT_MAX_CHARS 를 본다.');
      process.exit(1);
    }
    console.log('  기준선 안이다.');
    return;
  }

  if (!UPDATE) {
    console.log(`\n  (기록을 건드리지 않았다 — 다시 쓰려면 --update · 견주려면 --gate)`);
    if (기준선) console.log(`  기준선(${기준선.잰날}) 평균 ${기준선.평균.toLocaleString()} · 최대 ${기준선.최대.toLocaleString()}`);
    return;
  }

  try {
    fs.mkdirSync(path.dirname(BASE), { recursive: true });
    // ★옛 기준선을 지우지 않고 파일 안에 남긴다(이 저장소 관례 — 옛 서술은 정정만 붙인다).
    if (기준선) 이번._옛_기준선 = { 잰날: 기준선.잰날, 평균: 기준선.평균, 최대: 기준선.최대, 페이지최대: 기준선.페이지최대 };
    fs.writeFileSync(BASE, JSON.stringify(이번, null, 2) + '\n', 'utf8');
    console.log(`\n  기록: ${path.relative(process.cwd(), BASE)}`);
  } catch (e) { console.log('  (기록 실패: ' + e.message + ')'); }
})();
