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
 * [쓰는 법] node local_server/knowledge/legal/_dashboard/loop/context_size.js
 *   NRYA_PRIMARY_TOPK=10 을 주면 그 설정으로 다시 잴 수 있다.
 *
 * [연계] → services/legal_retriever.js(search·buildContextBlock) ·
 *         pinned/golden_questions.json(291문항) · 00_WORKLIST P-19.
 */
const fs = require('fs');
const path = require('path');
const R = require('../../../../services/legal_retriever.js');

const QFILE = path.join(__dirname, 'pinned', 'golden_questions.json');

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

  const OUT = path.join(__dirname, 'baseline', 'context_size.json');
  try {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({
      잰날: new Date().toISOString().slice(0, 10), 문항: rows.length,
      평균: avg, 중앙값: pct(chars, 0.5), 최소: chars[0], '90분위': pct(chars, 0.9), 최대: chars[chars.length - 1],
      페이지중앙값: pct(pages, 0.5), 페이지최대: pages[pages.length - 1],
    }, null, 2) + '\n', 'utf8');
    console.log(`\n  기록: ${path.relative(process.cwd(), OUT)}`);
  } catch (e) { console.log('  (기록 실패: ' + e.message + ')'); }
})();
