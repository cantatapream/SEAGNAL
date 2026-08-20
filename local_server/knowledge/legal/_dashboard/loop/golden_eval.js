/**
 * golden_eval.js — 문항마다 **기대 근거(법령+조문)가 인용 후보까지 도달하는가**를 잰다.
 * AI 를 부르지 않는다(비용 0). `verify_all.sh` 에 걸어 매 커밋 회귀를 막는 용도.
 *
 * [왜 있나 — H-47 ①]
 * 지금 채점판은 다섯 층이 있는데 **한 층이 비어 있다**:
 *   search_eval  법이 후보에 드나            page_eval   정답 페이지가 후보에 드나
 *   context_eval 정답 문장이 자료에 실리나    reach_eval  근거 조문 행이 도달 가능한 꼴인가(전수)
 *   cite_exists  인용의 법령·조문 짝이 맞나(전수)
 * → **"이 질문에 기대되는 그 조문이, 사용자가 받는 근거 목록 후보에 실제로 들어오는가"**
 *   를 문항 단위로 재는 자가 없다. 2026-08-18 라이브 검증에서 감사 `full` 판정의 **52%가
 *   실제로는 근거를 못 댄** 것이 바로 이 층의 실패였는데(L-112), 지금은 **유료 라이브 검증으로만**
 *   잡힌다. 이 파일이 그것을 무료·자동으로 잰다.
 *
 * [무엇을 재나] 문항마다 세 갈래로 가른다 — **어디서 실패했는지가 갈려야 어디를 고칠지 정해진다**(L-126):
 *   chain   기대 조문이 인용 후보에 들어옴                → 정상
 *   §6-E    정답 페이지는 왔는데 그 조문 행이 표에 없음     → 위키 표를 고쳐야 한다
 *   search  정답 페이지 자체가 후보에 없음                → 검색을 고쳐야 한다
 *
 * [AI 채점을 쓰지 않는 이유] L-133: 채점자가 AI 면 라운드 간 **42%가 판정이 뒤집힌다**.
 *   L-134: 온도 0으로도 같은 답이 안 나온다. 그래서 **문자열 대조만** 쓴다.
 *
 * [production 함수를 그대로 쓴다] L-136: 같은 대조를 하는 도구 둘이 서로 다른 눈금을 쓰면
 *   숫자가 통째로 헛것이 된다. `search`·`extractCitationChain` 을 챗봇이 쓰는 그대로 가져온다.
 *
 * ⚠**이 채점판이 재지 못하는 것**: ①개발 컨테이너에 AI 키가 없어 검색어 확장(expandQueryTerms)이
 *   빠진다 — 운영과 순위가 다를 수 있다(page_eval 머리말과 같은 한계). ②답변 본문의 **품질**은
 *   안 잰다. 이건 "근거가 닿는가"만 재는 자다.
 *
 * [쓰는 법]
 *   node golden_eval.js                  → 지금 상태 채점
 *   node golden_eval.js --save <파일>     → 기준선 저장
 *   node golden_eval.js --base <파일>     → 기준선과 비교(나빠진 문항을 이름으로 찍는다)
 *   node golden_eval.js --gate           → 기준선보다 나빠지면 실패(커밋 게이트)
 *   node golden_eval.js --examples       → 실패 문항을 갈래별로 보여준다
 *
 * [연계] ← pinned/golden_questions.json(문항+기대근거 라벨) · services/legal_retriever.js
 *        ⚠읽기 전용 — 위키를 고치지 않는다.
 */
const fs = require('fs');
const path = require('path');
const R = require('/home/user/SEAGNAL/local_server/services/legal_retriever.js');

const HERE = __dirname;
const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : ''; };
const QFILE = arg('--questions') || path.join(HERE, 'pinned', 'golden_questions.json');

/** 비교용 정규화 — 공백·낫표·강조를 없앤다. 양쪽 모두에 같은 함수를 건다(L-144). */
const flat = s => String(s || '').replace(/[\s「」*`\[\]]/g, '');
/** 조문 표기를 뽑아 정규화한다(제12조의2 · 별표3 · 별지 제1호). */
const ART_RE = /제\s*\d+조(?:의\s*\d+)?|별표\s*\d+(?:의\s*\d+)?|별지\s*제\s*\d+호/g;
const artsOf = s => [...new Set((String(s || '').match(ART_RE) || []).map(a => a.replace(/\s+/g, '')))];

/** 법령 이름이 같은가 — 계층(시행령·시행규칙)까지 맞춰 본다. */
function sameLaw(a, b) {
  const A = flat(a), B = flat(b);
  if (!A || !B) return false;
  return A.includes(B) || B.includes(A);
}

async function run() {
  const qs = JSON.parse(fs.readFileSync(QFILE, 'utf8')).questions || [];
  const out = [];
  for (const q of qs) {
    if (q.skip) continue;                       // 되묻기가 정답인 문항 등은 채점에서 뺀다
    let res;
    try { res = await R.search(q.question, {}); } catch (e) { res = null; }
    const pages = (res && res.contextPages) || [];
    const wantArts = artsOf(q.expect_article);
    let verdict = 'search', where = '';
    // ① 정답 페이지가 후보에 들어왔나
    const pageHit = pages.some(p => q.expect_page ? flat(p.file || '').includes(flat(q.expect_page))
                                                  : sameLaw(p.law, q.law));
    if (pageHit) {
      verdict = '6e';
      // ② 그 페이지들의 근거 조문 표에 기대 법령·조문이 있나
      for (const p of pages) {
        const body = p.body || '';
        for (const row of R.extractCitationChain(body)) {
          if (!sameLaw(row.law, q.expect_law)) continue;
          const got = artsOf(row.article);
          if (wantArts.length && wantArts.some(a => got.includes(a))) {
            verdict = 'chain'; where = `${p.file} | ${row.law} | ${row.article}`; break;
          }
        }
        if (verdict === 'chain') break;
      }
    }
    out.push({ law: q.law, q: q.question.slice(0, 60), verdict, where,
               want: `${q.expect_law} ${q.expect_article}` });
  }
  return out;
}

run().then(rows => {
  const n = rows.length;
  const c = v => rows.filter(r => r.verdict === v).length;
  const pct = x => n ? (x * 100 / n).toFixed(1) : '0.0';
  console.log(`골든 문항 ${n}개 — 기대 근거가 인용 후보까지 닿는가\n`);
  console.log(`  ✅ chain   ${String(c('chain')).padStart(4)} (${pct(c('chain'))}%)  기대 조문이 인용 후보에 들어옴`);
  console.log(`  ⚠ §6-E    ${String(c('6e')).padStart(4)} (${pct(c('6e'))}%)  페이지는 왔는데 그 조문 행이 표에 없음 → 위키 표`);
  console.log(`  ❌ search  ${String(c('search')).padStart(4)} (${pct(c('search'))}%)  페이지 자체가 후보에 없음 → 검색`);

  const basePath = arg('--base');
  let base = null;
  if (basePath) { try { base = JSON.parse(fs.readFileSync(basePath, 'utf8')); } catch (_) {} }
  let worse = [];
  if (base) {
    const rank = { chain: 2, '6e': 1, search: 0 };
    const prev = new Map((base.rows || []).map(r => [r.law + '|' + r.q, r.verdict]));
    worse = rows.filter(r => { const p = prev.get(r.law + '|' + r.q); return p && rank[r.verdict] < rank[p]; });
    console.log(`\n기준선 대비 — 나빠진 문항 ${worse.length}개 / 좋아진 문항 ` +
      rows.filter(r => { const p = prev.get(r.law + '|' + r.q); return p && rank[r.verdict] > rank[p]; }).length + '개');
    worse.forEach(r => console.log(`  ↓ ${r.law} · ${r.q} (${prev.get(r.law + '|' + r.q)} → ${r.verdict})`));
  }
  if (argv.includes('--examples')) {
    for (const v of ['6e', 'search']) {
      const list = rows.filter(r => r.verdict === v).slice(0, 12);
      if (!list.length) continue;
      console.log(`\n── ${v} 실패 예시 ──`);
      list.forEach(r => console.log(`  ${r.law} · ${r.q}\n      기대: ${r.want}`));
    }
  }
  if (arg('--save')) {
    fs.writeFileSync(arg('--save'), JSON.stringify({ n, chain: c('chain'), '6e': c('6e'), search: c('search'), rows }, null, 1));
    console.log(`\n스냅샷 저장: ${arg('--save')}`);
  }
  if (argv.includes('--gate')) {
    if (!base) { console.log('\n  ⏭️  기준선이 없어 게이트를 건너뜁니다(--base 로 지정).'); return; }
    if (worse.length) { console.log(`\n  ❌ 기대 근거가 안 닿게 된 문항 ${worse.length}개`); process.exit(1); }
    console.log('\n  ✅ 기준선 대비 나빠진 문항 없음');
  }
}).catch(e => { console.error('실패:', e && e.message); process.exit(2); });
