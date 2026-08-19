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
 * [연계] ← pinned/r22_questions.json(문항) · pinned/page_labels.json(정답 페이지).
 *        → services/legal_retriever.js search(). ⚠읽기 전용 — 위키를 고치지 않는다.
 */
const fs = require('fs');
const R = require('/home/user/SEAGNAL/local_server/services/legal_retriever.js');
const DIR = '/home/user/SEAGNAL/local_server/knowledge/legal/_dashboard/loop/pinned/';

const arg = k => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : ''; };
const norm = s => String(s || '').replace(/[\s·ㆍ()（）]/g, '');

(async () => {
  const pins = JSON.parse(fs.readFileSync(DIR + 'r22_questions.json', 'utf8'));
  const labels = JSON.parse(fs.readFileSync(DIR + 'page_labels.json', 'utf8')).labels;
  const want = new Map(Object.entries(labels).map(([law, page]) => [norm(law), norm(page)]));

  const rows = [];
  for (const p of pins) {
    const key = norm(p.law);
    if (!want.has(key)) continue;                       // 정답 페이지를 아직 안 붙인 문항은 건너뛴다
    const target = want.get(key);
    let rank = -1;
    try {
      const { contextPages } = await R.search(p.question_clean || p.question, { canonicalOnly: true });
      // 페이지 식별자는 `<법>__<주제>` — 검색 결과는 law/topic 을 따로 들고 있다.
      const ids = contextPages.map(c => norm(String(c.law) + '__' + String(c.topic || '')));
      rank = ids.indexOf(target);
    } catch (e) { rows.push({ law: p.law, rank: -2, err: e.message }); continue; }
    rows.push({ law: p.law, target, rank });
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
    for (const m of miss) console.log('  ✘ ' + m.law + '  → ' + (m.target || m.err));
  }
  const late = rows.filter(r => r.rank >= 3);
  if (late.length) {
    console.log('\n─ 후보엔 있으나 3위 밖 ─');
    for (const m of late) console.log(`  △ ${m.law}  (${m.rank + 1}위) → ${m.target}`);
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
