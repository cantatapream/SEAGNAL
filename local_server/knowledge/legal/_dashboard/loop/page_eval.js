/**
 * page_eval.js — 검색이 **그 질문의 정답 개념 페이지까지** 올려주는가를 채점한다(AI 안 씀, 비용 0).
 *
 * [왜 있나] search_eval.js 는 "그 질문의 **법**이 후보에 드는가"를 재고, 그 점수는 이미 95%다.
 * 그런데 2026-08-19 5차 라이브 검증에서 남은 실패의 대부분은 법이 아니라 **법 안에서 엉뚱한
 * 페이지로 가는 것**이었다 — 선박안전법 질문이 위험물 페이지 대신 컨테이너 페이지로 갔고,
 * 선박입출항법 질문이 선박법 개측 페이지로 갔다. 법 단위 점수는 이 실패를 하나도 못 잡는다.
 * 그래서 페이지 단위로 다시 잰다.
 *
 * [무엇을 재나] pinned/page_labels.json 에 사람이 확인해 적어둔 "정답 페이지"가 검색 후보
 * (contextPages)에 드는가, 몇 번째인가.
 *   - top1/top3 : 1위/3위 안   - hit : 후보에 들어옴   - miss : 후보에 아예 없음
 *
 * [쓰는 법]
 *   node page_eval.js                 → 지금 상태 채점
 *   node page_eval.js --save <파일>    → 기준선 저장
 *   node page_eval.js --base <파일>    → 기준선과 비교(좋아진/망가진 문항을 이름으로 찍는다)
 *
 * [연계] ← pinned/r22_questions.json(문항) · pinned/page_labels.json(문항별 정답 페이지·되묻기가 정답인 문항).
 *        → services/legal_retriever.js search(). ⚠읽기 전용 — 위키를 고치지 않는다.
 */
const fs = require('fs');
const R = require('/home/user/SEAGNAL/local_server/services/legal_retriever.js');
const DIR = '/home/user/SEAGNAL/local_server/knowledge/legal/_dashboard/loop/pinned/';

const arg = k => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : ''; };
const norm = s => String(s || '').replace(/[\s·ㆍ()（）]/g, '');

(async () => {
  const pins = JSON.parse(fs.readFileSync(DIR + 'r22_questions.json', 'utf8'));
  const lab = JSON.parse(fs.readFileSync(DIR + 'page_labels.json', 'utf8'));
  // 문항 단위로 붙인다 — 한 법에 문항이 둘이면 정답 페이지가 서로 다르다(법 단위로 묶으면 둘 다 틀린다).
  const want = new Map(lab.labels.map(l => [l.question, l.pages.map(norm)]));

  const rows = [];
  for (const p of pins) {
    if (!want.has(p.question)) continue;                // 정답 페이지를 안 붙인 문항·되묻기가 정답인 문항은 건너뛴다
    const targets = want.get(p.question);
    let rank = -1;
    try {
      const { contextPages } = await R.search(p.question_clean || p.question, { canonicalOnly: true });
      // 페이지 식별자는 `<법>__<주제>` — 검색 결과는 law/topic 을 따로 들고 있다.
      const ids = contextPages.map(c => norm(String(c.law) + '__' + String(c.topic || '')));
      // 정답이 여럿이면 **가장 앞선 것**의 순위로 잰다(어느 쪽에 닿아도 맞은 것으로 센다).
      for (const t of targets) {
        const at = ids.indexOf(t);
        if (at >= 0 && (rank < 0 || at < rank)) rank = at;
      }
    } catch (e) { rows.push({ law: p.law, rank: -2, err: e.message }); continue; }
    rows.push({ law: p.law, q: (p.question_clean || p.question).slice(0, 46), target: targets[0], rank });
  }
  if (lab.generic && lab.generic.length) {
    console.log(`※ 되묻기가 정답이라 채점에서 뺀 문항 ${lab.generic.length}개 — 질문에 법·주제를 특정할 단서가 없다.`);
  }

  const n = rows.length;
  const cnt = f => rows.filter(f).length;
  const pct = v => (v / n * 100).toFixed(1) + '%';
  console.log(`정답 페이지를 붙인 문항 ${n}개로 채점`);
  console.log('─'.repeat(60));
  console.log(`1위(top1)        ${String(cnt(r => r.rank === 0)).padStart(3)}  ${pct(cnt(r => r.rank === 0))}`);
  console.log(`3위 안(top3)     ${String(cnt(r => r.rank >= 0 && r.rank < 3)).padStart(3)}  ${pct(cnt(r => r.rank >= 0 && r.rank < 3))}`);
  console.log(`후보에 들어옴     ${String(cnt(r => r.rank >= 0)).padStart(3)}  ${pct(cnt(r => r.rank >= 0))}`);
  console.log(`후보에 없음(miss) ${String(cnt(r => r.rank < 0)).padStart(3)}  ${pct(cnt(r => r.rank < 0))}`);

  const miss = rows.filter(r => r.rank < 0);
  if (miss.length) {
    console.log('\n─ 정답 페이지가 후보에 아예 없는 문항 ─');
    for (const m of miss) console.log('  ✘ ' + m.law + '  | ' + (m.q || '') + '  → ' + (m.target || m.err));
  }
  const late = rows.filter(r => r.rank >= 3);
  if (late.length) {
    console.log('\n─ 후보엔 있으나 3위 밖 ─');
    for (const m of late) console.log(`  △ ${m.law}  (${m.rank + 1}위) | ${m.q || ''}`);
  }

  // ★--gate: 커밋 전 점검용. 순위는 위키가 바뀌면 자연히 흔들리므로 **순위 자체엔 문턱을 두지 않고**,
  //   "사람이 정답이라고 확인한 페이지가 후보에 아예 안 든다"는 것만 실패로 본다 — 이건 순위 흔들림이
  //   아니라 검색이 그 페이지에 못 닿는다는 뜻이라 답을 낼 방법이 없어진다.
  if (process.argv.includes('--gate')) {
    const gone = rows.filter(r => r.rank < 0);
    if (gone.length) {
      console.log('\n  ❌ 정답 페이지가 후보에 아예 없는 문항 ' + gone.length + '건');
      process.exit(1);
    }
    console.log('\n  ✅ 정답 페이지가 모두 후보에 들어온다');
    return;
  }

  const save = arg('--save');
  if (save) { fs.writeFileSync(save, JSON.stringify(rows, null, 1)); console.log('\n기준선 저장: ' + save); }
  const base = arg('--base');
  if (base && fs.existsSync(base)) {
    const prev = new Map(JSON.parse(fs.readFileSync(base, 'utf8')).map(r => [r.law, r.rank]));
    const better = rows.filter(r => prev.has(r.law) && prev.get(r.law) < 0 && r.rank >= 0);
    const worse = rows.filter(r => prev.has(r.law) && prev.get(r.law) >= 0 && r.rank < 0);
    console.log(`\n기준선 대비 — 좋아짐 ${better.length} / 망가짐 ${worse.length}`);
    for (const b of better) console.log('  ＋ ' + b.law);
    for (const w of worse) console.log('  － ' + w.law);
  }
})();
