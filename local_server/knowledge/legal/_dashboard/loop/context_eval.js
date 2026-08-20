/**
 * context_eval.js — 검색이 찾아온 자료 안에 **정답 문장이 실제로 실려 있는가**를 잰다(AI 안 씀, 비용 0).
 *
 * [왜 있나] page_eval.js 로 재보니 정답 페이지는 3위 안에 96% 들어온다 — 검색은 병목이 아니다.
 * 그런데 라이브 검증에서는 같은 문항이 "확인되지 않습니다"로 끝났다. 페이지를 찾고도 답을 못 한
 * 것이다. 실제 사례: 선박평형수 관리법 — 인용 체인은 기대 조문(제15조제2항·시행규칙 제27조)과
 * 정확히 일치했는데, 답변 본문은 "구체적인 기간은 확인되지 않습니다"라고 했다. 그 수치(3/5/1개월)는
 * 위키 페이지에 분명히 있다. 그렇다면 **페이지를 잘라 자료로 넘기는 단계(sliceRelevant)에서
 * 그 줄이 빠진 것**이 의심된다. 그 단계를 직접 재는 자가 없어 이 파일을 만든다.
 *
 * [무엇을 재나] 문항마다 pinned/page_labels.json 의 `evidence`(그 답에 반드시 필요한 짧은 문자열,
 * 정답 페이지에 실제로 있음을 확인해 붙였다)가 **모델에게 넘어가는 자료 블록 안에 그대로 있는가**.
 *   - 실림   : 자료 안에 있다 → 모델이 못 쓴 것은 자료 탓이 아니다
 *   - 잘림   : 정답 페이지는 후보에 들어왔는데 그 문자열이 잘려 나갔다  ← 여기가 진짜 결손
 *   - 페이지밖: 정답 페이지 자체가 후보에 없다(page_eval 이 잡는 실패)
 *
 * [쓰는 법]  node context_eval.js  [--save <파일>] [--base <파일>]
 *
 * ⚠⚠ **이 채점판이 재지 못하는 것 (2026-08-19 확인, 반드시 읽을 것)**
 *   운영 서버는 검색 전에 **AI로 검색어를 확장**한다(expandQueryTerms — 질문에 없는 관련 법률용어를
 *   최대 8개 뽑아 점수에 함께 넣는다). 그런데 이 채점판이 도는 개발 컨테이너에는 Gemini 키가 없어
 *   `expandQueryTerms` 가 **항상 빈 배열**을 돌려준다(`if (!gemini.hasAnyKey()) return []`).
 *   즉 **여기서 재는 점수에는 AI 확장어가 빠져 있어 운영과 순위가 다를 수 있다.**
 *   실측: "단지관리계획은 언제까지…" 질문에서 정답 페이지가 확장어 없이는 2위인데, AI가 뽑을 법한
 *   확장어(단지·배후단지·항만·마리나 …)를 넣으면 **19위로 밀린다** — 라이브가 실제로 답한 법
 *   (항만법·마리나항만법)과 정확히 일치했다.
 *   → 이 채점판의 점수는 **"AI 확장 이전 단계까지는 정상"**이라는 뜻으로만 읽어야 하며,
 *     "검색은 문제없다"의 근거로 쓰면 안 된다.
 *
 * [연계] ← pinned/r22_questions.json · pinned/page_labels.json.
 *        → services/legal_retriever.js search()·buildContextBlock(). ⚠읽기 전용.
 */
const fs = require('fs');
const R = require('/home/user/SEAGNAL/local_server/services/legal_retriever.js');
const DIR = '/home/user/SEAGNAL/local_server/knowledge/legal/_dashboard/loop/pinned/';

const arg = k => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : ''; };
const norm = s => String(s || '').replace(/[\s·ㆍ()（）]/g, '');
const flat = s => String(s || '').replace(/\s+/g, '');

(async () => {
  const pins = JSON.parse(fs.readFileSync(DIR + 'r22_questions.json', 'utf8'));
  const lab = JSON.parse(fs.readFileSync(DIR + 'page_labels.json', 'utf8'));
  const want = new Map(lab.labels.filter(l => l.evidence).map(l => [l.question, l]));

  const rows = [];
  for (const p of pins) {
    if (!want.has(p.question)) continue;
    const L = want.get(p.question);
    const targets = L.pages.map(norm);
    let verdict = 'error', detail = '';
    try {
      const { contextPages } = await R.search(p.question_clean || p.question, { canonicalOnly: true });
      const ids = contextPages.map(c => norm(String(c.law) + '__' + String(c.topic || '')));
      const inCand = targets.some(t => ids.includes(t));
      // 모델에게 실제로 넘어가는 자료 블록 그대로 본다(공백 차이만 흡수 — 글자를 바꾸지 않는다).
      const blk = flat(R.buildContextBlock(contextPages));
      const has = blk.includes(flat(L.evidence));
      verdict = has ? '실림' : (inCand ? '잘림' : '페이지밖');
      detail = L.evidence;
    } catch (e) { detail = e.message; }
    rows.push({ law: p.law, q: (p.question_clean || p.question).slice(0, 44), evidence: detail, verdict });
  }

  const n = rows.length, cnt = v => rows.filter(r => r.verdict === v).length;
  const pct = v => (v / n * 100).toFixed(1) + '%';
  console.log(`정답 문장을 붙인 문항 ${n}개로 채점`);
  console.log('─'.repeat(60));
  for (const v of ['실림', '잘림', '페이지밖', 'error']) {
    if (cnt(v)) console.log(`${v.padEnd(8)} ${String(cnt(v)).padStart(3)}  ${pct(cnt(v))}`);
  }
  for (const v of ['잘림', '페이지밖', 'error']) {
    const list = rows.filter(r => r.verdict === v);
    if (!list.length) continue;
    console.log(`\n─ ${v} ─`);
    for (const r of list) console.log(`  ✘ ${r.law.slice(0, 26)} | ${r.q} → "${r.evidence}"`);
  }
  // ★--gate: `페이지밖`(정답 페이지가 후보에도 없음)만 실패로 본다. `잘림`은 발췌 예산 안에서
  //   자연히 오르내리므로 문턱을 두지 않는다 — 문턱 언저리에서 결과가 뚝 끊기면 점검표를 무시하는
  //   습관이 생겨 게이트가 무력해진다(L-105).
  if (process.argv.includes('--gate')) {
    const gone = rows.filter(r => r.verdict === '페이지밖' || r.verdict === 'error');
    if (gone.length) {
      console.log('\n  ❌ 정답 페이지가 자료에 아예 못 들어온 문항 ' + gone.length + '건');
      process.exit(1);
    }
    console.log('\n  ✅ 정답 페이지가 모두 자료에 들어온다');
    return;
  }

  const save = arg('--save');
  if (save) { fs.writeFileSync(save, JSON.stringify(rows, null, 1)); console.log('\n기준선 저장: ' + save); }
  const base = arg('--base');
  if (base && fs.existsSync(base)) {
    const prev = new Map(JSON.parse(fs.readFileSync(base, 'utf8')).map(r => [r.q, r.verdict]));
    const better = rows.filter(r => prev.get(r.q) && prev.get(r.q) !== '실림' && r.verdict === '실림');
    const worse = rows.filter(r => prev.get(r.q) === '실림' && r.verdict !== '실림');
    console.log(`\n기준선 대비 — 좋아짐 ${better.length} / 망가짐 ${worse.length}`);
    for (const b of better) console.log('  ＋ ' + b.law + ' | ' + b.q);
    for (const w of worse) console.log('  － ' + w.law + ' | ' + w.q);
  }
})();
