/**
 * golden_search_why.js — ★골든 `search` 실패가 **왜** 실패하는지 가른다. (등록부 3-32)
 *
 * [왜 있나]
 * `V5-7`(golden_eval.js)은 골든 279문항 중 **13**을 `search` 실패로 찍는다 —
 * *"행은 위키에 있는데 그 페이지가 후보에 안 옴 → 검색"*. 등록부 `3-32` 는 그것을
 * *"막연한 자연어 질문 13건 … 그 개념을 가리키는 구어를 새로 등재하거나 의미 기반이 필요"*
 * 라고 적어 두었다. 그런데 **13 을 한 덩이로 보면 고칠 자리가 안 정해진다.**
 * 이 자는 13 을 **까닭별로 가른다** — 까닭이 다르면 고치는 곳이 다르다(L-126).
 *
 * [무엇을 가르나]
 *   ⓐ **맥락을 주면 닿는다** — 챗봇은 `opts.topic`(직전 주제)을 얹어 검색한다.
 *      그런데 `golden_eval.js` 는 `R.search(q.question, **{}**)` 로 **맥락 없이** 부른다.
 *      질문에 「이 법」·「이 기준」밖에 없으면 **맥락 없이는 원리상 못 찾는다.**
 *   ⓑ **낱말이 하나도 안 겹친다** — 기대 쪽 본문에 질문 낱말이 0개. 구어·의미가 필요한 자리.
 *   ⓒ **낱말은 겹치는데 순위에서 밀렸다** — 가중치·자름의 문제. 구어를 등재해도 안 풀린다.
 *
 * [어떻게 재나 — 생산 함수를 그대로 부른다(L-136)]
 *   · 후보  `legal_retriever.search(질문, opts)` — 챗봇이 쓰는 그 함수
 *   · 기대 쪽 `golden_eval.ownersOf()` — V5-7 이 쓰는 그 판정(두 번 구현하지 않는다)
 *   · 본문  `legal_retriever.readPage().scoreBody` — 점수에 실제로 쓰이는 그 글
 *
 * ⚠**이 자는 게이트가 아니다.** 숫자를 바꾸지 않고 **까닭만 보여 준다.**
 * ⚠**이 컨테이너에는 Gemini 키가 없다** — `expandQueryTerms`(질의 확장)가 빠진 상태다.
 *   운영에서는 확장이 더 붙으므로 **여기 숫자는 상한**이다. 그 사실을 표에 함께 찍는다.
 *
 * 쓰는 법: node golden_search_why.js [--all]
 *   `--all` 은 chain 으로 통과한 문항까지 표에 넣는다(맥락이 순위를 얼마나 올리는지 보려고).
 *
 * [연계] ← 등록부 `3-32` · `V5-7`(golden_eval.js). → services/legal_retriever.js(search·readPage).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = require('../../../../services/legal_retriever.js');
const G = require('./golden_eval.js');

const HERE = __dirname;
const QFILE = path.join(HERE, 'pinned', 'golden_questions.json');
const ALL = process.argv.includes('--all');

// 「이 법」처럼 **그것만으로는 무엇인지 알 수 없는** 가리킴말. 맥락이 없으면 원리상 못 찾는다.
const DEICTIC = /(이|그|해당|동)\s*(법|법률|기준|규칙|고시|시행령|시행규칙)|이\s*법\s*때문|이\s*법\s*에/;

function termsOfQ(q) {
  // 점수에 쓰이는 낱말과 같은 자로 자른다 — 여기서 새로 짜면 눈금이 갈린다(L-136).
  return (typeof R.termsOf === 'function' ? R.termsOf(q)
    : String(q).split(/[^가-힣A-Za-z0-9]+/).filter((w) => w.length >= 2));
}

function rankOf(sources, owners) {
  for (let i = 0; i < sources.length; i++) {
    if (owners.includes(String(sources[i].file || ''))) return i + 1;
  }
  return 0;                                    // 후보 안에 아예 없다
}

async function main() {
  const qs = JSON.parse(fs.readFileSync(QFILE, 'utf8')).questions || [];
  const idx = G.buildRowIndex();
  const rows = [];
  for (const q of qs) {
    if (q.skip || !q.verified) continue;
    const wantArts = G.artsOf(q.expect_article).concat(G.addendaKeys(q.expect_article));
    const owners = G.ownersOf(idx, q.expect_law, wantArts, G.isAddenda(q.expect_article));
    if (!owners.length) continue;                           // §6-E 는 이 자의 몫이 아니다
    let a, b;
    try { a = await R.search(q.question, {}); } catch (_) { a = null; }
    try { b = await R.search(q.question, { topic: q.law }); } catch (_) { b = null; }
    const sa = (a && a.sources) || [];
    const sb = (b && b.sources) || [];
    const rA = rankOf(sa, owners);
    const rB = rankOf(sb, owners);
    if (!ALL && rA) continue;                               // 맥락 없이도 닿은 것은 건너뛴다
    // 기대 쪽 본문에 질문 낱말이 몇 개 있나 — `scoreBody`(점수에 쓰이는 글)로 본다
    let overlap = 0, tried = 0;
    const terms = termsOfQ(q.question);
    for (const own of owners.slice(0, 2)) {
      let pg = null;
      try { pg = R.readPage('statute', own) || R.readPage('concept', own); } catch (_) { pg = null; }
      if (!pg) continue;
      tried++;
      const bodyText = pg.scoreBody || pg.body || '';
      const n = terms.filter((t) => bodyText.includes(t)).length;
      if (n > overlap) overlap = n;
    }
    rows.push({ law: q.law, q: q.question.slice(0, 54), want: `${q.expect_law} ${q.expect_article}`,
                rA, rB, terms: terms.length, overlap, tried,
                deictic: DEICTIC.test(q.question), owners: owners.length });
  }

  console.log('\n── 골든 `search` 실패를 까닭별로 가른다 (3-32) ──');
  console.log('   ⚠이 컨테이너에 Gemini 키가 없다 — 질의 확장이 빠진 상태라 **이 수는 상한**이다.\n');
  const cause = (r) => (r.rB ? 'ⓐ 맥락을 주면 닿는다'
    : (r.overlap === 0 ? 'ⓑ 낱말이 하나도 안 겹친다' : 'ⓒ 낱말은 겹치는데 순위에서 밀렸다'));
  for (const r of rows) {
    console.log(`  ${cause(r)}${r.deictic ? '  [「이 법」류 가리킴말]' : ''}`);
    console.log(`     ${r.law} · ${r.q}`);
    console.log(`     기대 ${r.want}`);
    console.log(`     순위  맥락없이 ${r.rA || '후보 밖'} · 주제를 주면 ${r.rB || '후보 밖'}` +
                `   · 질문 낱말 ${r.terms}개 중 그 쪽 본문에 ${r.overlap}개`);
  }
  const by = {};
  rows.forEach((r) => { const c = cause(r); by[c] = (by[c] || 0) + 1; });
  console.log(`\n  합 ${rows.length}건`);
  for (const [k, v] of Object.entries(by).sort((x, y) => y[1] - x[1])) {
    console.log(`    ${String(v).padStart(3)}  ${k}`);
  }
  const d = rows.filter((r) => r.deictic).length;
  console.log(`\n  그중 「이 법」류 가리킴말이 든 질문 ${d}건 — **맥락 없이는 원리상 못 찾는다.**`);
  console.log('  ⇒ 고칠 자리가 갈린다: ⓐ는 **채점이 맥락을 안 준 것**(자 쪽) ·');
  console.log('    ⓑ는 구어·의미가 필요한 것(데이터 쪽) · ⓒ는 가중치·자름(코드 쪽).');
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error('실패:', e && e.stack || e); process.exit(1); });
