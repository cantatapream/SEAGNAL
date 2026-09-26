/**
 * expansion_probe.js — AI 검색어 확장이 정답 페이지를 밀어낼 위험이 **몇 건짜리인지** 잰다(AI 안 씀, 비용 0).
 *
 * [왜 있나] 2026-08-19 실측(L-130). 운영 서버는 검색 전에 AI로 검색어를 넓히는데(expandQueryTerms,
 * 질문에 없는 관련 법률용어를 최대 8개), 그 낱말이 여러 페이지에 두루 걸리면 **정답 페이지를 밀어낸다.**
 * "단지관리계획은 언제까지…" 질문에서 정답이 2위 → 19위로 밀렸고, 그 자리를 채운 법이 라이브가
 * 실제로 답한 법과 일치했다. 그렇다면 이건 몇 건짜리 문제인가 — 그것을 재려고 만들었다.
 *
 * [어떻게 재나 — 지어내지 않기 위한 두 갈래]
 *   ⓐ 여유(margin): 확장어 없이 재서, 정답 페이지의 점수가 1위 대비 얼마나 되나. 아무것도 지어내지
 *      않는 순수 측정이다. 여유가 크면 웬만한 확장어로는 안 흔들린다.
 *   ⓑ 흔들림(fragility): **경쟁 페이지의 주제어를 확장어로 주입**해 정답이 3위 밖으로 밀리는지 본다.
 *      낱말을 내가 상상해 만드는 대신 **위키 데이터에서 그대로 뽑아** 쓴다 — "AI가 이 질문에서
 *      옆 페이지의 개념을 떠올린다면"이라는 가정 실험이다.
 *
 * ⚠⚠ **이것은 가정 실험이다.** 실제 AI가 뽑는 낱말과 다를 수 있다. 여기서 나온 "밀림"은
 *     "이런 낱말이 붙으면 밀린다"이지 "라이브에서 실제로 밀린다"가 아니다. 실제 확인은 라이브뿐이다.
 *
 * [쓰는 법]  node expansion_probe.js [--save <파일>]
 *
 * [연계] ← pinned/r22_questions.json · pinned/page_labels.json.
 *        → services/legal_retriever.js search() (NRYA_FAKE_AI_TERMS 통로로 확장어 주입).
 *        ⚠읽기 전용.
 */
const fs = require('fs');
const R = require(require('path').resolve(__dirname, '../../../../services/legal_retriever.js'));
const { execFileSync } = require('child_process');
const DIR = path.resolve(__dirname, './pinned');
const arg = k => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : ''; };
const norm = s => String(s || '').replace(/[\s·ㆍ()（）]/g, '');

// 자식 프로세스로 검색을 돌린다 — NRYA_FAKE_AI_TERMS 는 모듈 적재 시점이 아니라 호출 시점에 읽히지만,
// 한 프로세스 안에서 값만 바꿔가며 돌리면 termWeights 캐시 등 상태가 섞일 수 있어 매번 새로 띄운다.
function rankOf(question, targets, fakeTerms) {
  const script = `
    const R = require(require('path').resolve(__dirname, '../../../../services/legal_retriever.js'));
    const norm = s => String(s||'').replace(/[\\s·ㆍ()（）]/g,'');
    (async () => {
      const { contextPages } = await R.search(process.argv[1], { canonicalOnly: true });
      const ids = contextPages.map(c => norm(String(c.law)+'__'+String(c.topic||'')));
      const tops = contextPages.slice(0,3).map(c => ({ law: c.law, topic: c.topic || '' }));
      const T = JSON.parse(process.argv[2]);
      let r = -1;
      for (const t of T) { const at = ids.indexOf(t); if (at >= 0 && (r < 0 || at < r)) r = at; }
      process.stdout.write(JSON.stringify({ rank: r, tops }));
    })();`;
  const env = Object.assign({}, process.env);
  if (fakeTerms && fakeTerms.length) env.NRYA_FAKE_AI_TERMS = fakeTerms.join(',');
  else delete env.NRYA_FAKE_AI_TERMS;
  const out = execFileSync(process.execPath, ['-e', script, question, JSON.stringify(targets)],
    { env, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] });
  // 모듈이 적재되며 찍는 안내줄("[Gemini] 키 0개 …")이 섞이므로 **마지막 JSON 덩어리만** 떼어 읽는다.
  const m = String(out).match(/\{[\s\S]*\}\s*$/);
  if (!m) throw new Error('검색 결과를 읽지 못했다: ' + String(out).slice(0, 200));
  return JSON.parse(m[0]);
}
// 경쟁 페이지의 **법 이름과 주제**에서 검색어가 될 만한 낱말을 뽑는다.
// ★검색이 실제로 쓰는 토크나이저(termsOf)를 그대로 써야 한다 — 처음엔 주제를 통째로 넣었더니
//   `보험료신고납부와체납징수` 같은 긴 덩어리 하나가 들어가 아무 페이지에도 안 걸렸고, 그래서
//   "취약 0건"이라는 **거짓 안심**이 나왔다(실제로는 같은 문항이 현실적인 낱말로는 8위로 밀린다).
//   낱말을 지어내지는 않는다 — 위키에 적힌 이름·주제를 검색과 같은 방식으로 쪼갤 뿐이다.
// 법 이름을 쪼개면 나오는 **문법 조각**들 — AI 질의확장은 개념 명사를 뽑으므로 이런 것은 안 낸다.
// 이걸 빼지 않으면 실험이 현실보다 과격해져 "취약"이 부풀려진다.
const FUNC_WORDS = new Set(['등에', '대한', '관한', '관하여', '및', '에서의', '등의', '위한', '따른',
  '권리의', '행사에', '이용에', '관리에', '지원에', '증진', '지속가능한', '그', '의', '법률', '시행령', '시행규칙']);
function termsFromPage(law, topic) {
  const raw = R.termsOf(String(law || '') + ' ' + String(topic || ''));
  const seen = new Set(); const out = [];
  for (const t of raw) {
    if (t.length < 2 || t.length > 6) continue;      // 너무 긴 덩어리는 실제 확장어답지 않다
    if (FUNC_WORDS.has(t)) continue;                 // 법 이름의 문법 조각은 AI가 개념으로 뽑지 않는다
    if (seen.has(t)) continue;
    seen.add(t); out.push(t);
    if (out.length >= 8) break;
  }
  return out;
}


// 여유(margin) — 정답 페이지의 점수가 1위 점수의 몇 %인가. **아무것도 주입하지 않는 순수 측정**이다.
// 여유가 작을수록 확장어 몇 개로도 순위가 뒤집힌다(어느 낱말이 붙느냐와 무관한 구조적 취약성).
function marginOf(question, targets) {
  const idx = R.loadIndex();
  const pages = (idx && (idx.pages || idx)) || [];
  const terms = R.termsOf(question);
  const w = R.termWeights(pages, terms);
  const norm2 = s => String(s || '').replace(/[\s·ㆍ()（）]/g, '');
  let top = 0, mine = 0;
  for (const p of pages) {
    const s = R.scoreOne(p, terms, w);
    if (s > top) top = s;
    if (targets.includes(norm2(String(p.law) + '__' + String(p.topic || '')))) mine = Math.max(mine, s);
  }
  return top > 0 ? mine / top : 0;
}

const pins = JSON.parse(fs.readFileSync(DIR + 'r22_questions.json', 'utf8'));
const lab = JSON.parse(fs.readFileSync(DIR + 'page_labels.json', 'utf8'));
const want = new Map(lab.labels.map(l => [l.question, l.pages.map(norm)]));

const rows = [];
for (const p of pins) {
  if (!want.has(p.question)) continue;
  const targets = want.get(p.question);
  const q = p.question_clean || p.question;
  const base = rankOf(q, targets, null);
  // 경쟁 페이지(정답이 아닌 상위 3개)의 주제어를 확장어로 주입해 본다.
  let worst = base.rank, worstTerms = null;
  const probes = base.tops.map(t => termsFromPage(t.law, t.topic)).filter(f => f.length);
  // 상위 경쟁 페이지들의 낱말을 **합친** 경우도 본다(AI가 여러 개념을 함께 떠올리는 상황).
  if (probes.length > 1) probes.push([...new Set(probes.flat())].slice(0, 8));
  for (const fake of probes) {
    const probe = rankOf(q, targets, fake);
    if (probe.rank < 0 || (worst >= 0 && probe.rank > worst)) { worst = probe.rank; worstTerms = fake; }
  }
  rows.push({ law: p.law, q: q.slice(0, 40), base: base.rank, worst, terms: worstTerms, margin: marginOf(q, targets) });
  process.stdout.write('.');
}
process.stdout.write('\n');

const n = rows.length;
const inTop3 = r => r >= 0 && r < 3;
const stable = rows.filter(r => inTop3(r.base) && inTop3(r.worst)).length;
const fragile = rows.filter(r => inTop3(r.base) && !inTop3(r.worst));
const already = rows.filter(r => !inTop3(r.base)).length;
console.log(`고정 문항 ${n}개 (정답 페이지를 붙인 것만)`);
console.log('─'.repeat(64));
console.log(`확장어 없이도 3위 밖        ${String(already).padStart(3)}`);
console.log(`흔들어도 3위 안 유지(안전)  ${String(stable).padStart(3)}  ${(stable / n * 100).toFixed(1)}%`);
console.log(`흔들면 3위 밖으로 밀림(취약) ${String(fragile.length).padStart(3)}  ${(fragile.length / n * 100).toFixed(1)}%`);
// ⓐ 여유 분포 — 주입 없이 잰 값이라 가정이 섞이지 않는다.
const band = (lo, hi) => rows.filter(r => r.margin >= lo && r.margin < hi).length;
console.log('\n─ 여유(정답 페이지 점수 ÷ 1위 점수) — 주입 없는 순수 측정 ─');
console.log(`  1.0 (정답이 곧 1위)      ${String(rows.filter(r => r.margin >= 0.999).length).padStart(3)}`);
console.log(`  0.8~1.0 (근소하게 뒤짐)  ${String(band(0.8, 0.999)).padStart(3)}`);
console.log(`  0.5~0.8                 ${String(band(0.5, 0.8)).padStart(3)}`);
console.log(`  0.5 미만 (많이 뒤짐)     ${String(band(0, 0.5)).padStart(3)}`);

if (fragile.length) {
  console.log('\n─ 취약: 옆 페이지 개념이 확장어로 붙으면 정답이 밀린다 ─');
  for (const f of fragile) {
    console.log(`  △ ${f.law.slice(0, 24).padEnd(26)} ${f.base + 1}위 → ${f.worst < 0 ? '후보 밖' : (f.worst + 1) + '위'}   주입: ${(f.terms || []).join(',')}`);
    console.log(`     ${f.q}`);
  }
}
console.log('\n※ 가정 실험이다 — 실제 AI가 뽑는 낱말과 다를 수 있다. "밀린다"는 이런 낱말이 붙었을 때의 이야기지,');
console.log('  라이브에서 실제로 밀린다는 뜻이 아니다.');
const save = arg('--save');
if (save) { fs.writeFileSync(save, JSON.stringify(rows, null, 1)); console.log('\n저장: ' + save); }
