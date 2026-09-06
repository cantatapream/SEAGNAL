/**
 * search_gap.js — 고정 문제집의 `search` 실패(행은 위키에 있는데 그 페이지가 후보에 안 옴)를
 * **원인별로 갈라 센다.** AI 안 쓴다(비용 0).
 *
 * [왜 있나 — 2026-08-21, L-157 에서 배운 것]
 * 라이브에서 기대 근거를 못 댄 3건을 원문으로 파 봤더니 원인이 **셋 다 달랐다**(검색·라벨·위키 연결).
 * 그런데 지금 계기판은 그 셋을 `search` 한 칸에 뭉쳐 세고 있다. **뭉친 숫자로는 손댈 곳을 못 정한다** —
 * 39건을 "검색이 나쁘다"로 읽고 의미검색부터 붙이면, 그 안의 라벨·배치 문제는 영영 안 고쳐진다.
 *
 * [갈래 — 왜 그 페이지가 안 왔나]
 *   ⓐ **허브에만 있음**   그 (법령, 조문) 행을 가진 페이지가 statutes·comparisons·annexes 뿐이다.
 *                        개념 페이지가 없어 주제 질의에서 밀린다(`_SCHEMA` §8-A ①, 출입국관리법 사례).
 *   ⓑ **다른 법 소관**    행을 가진 페이지의 법이 **문항의 법과 다르다**. 질문은 A법을 보고 물었는데
 *                        답의 근거는 B법에 있다 — 두 법을 잇는 다리가 있어야 닿는다(해양폐기물법 사례).
 *   ⓒ **낱말이 안 겹침**  개념 페이지가 그 법에 있는데도 안 왔다. 질의에 **그 법 이름을 넣으면 오는지**
 *                        확인해 가른다: 오면 낱말 문제(의미검색 후보), 그래도 안 오면 순위·본문 문제.
 *   ⓓ **법 이름을 넣어도 안 옴**  검색 점수 자체가 안 나온다 — 페이지 본문·주제를 봐야 한다.
 *
 * [어떻게] 판정은 `golden_eval.js` 의 함수를 **그대로 가져다 쓴다**(따로 구현하면 어긋난다 — L-136).
 *          검색도 생산 `legal_retriever.search()` 를 그대로 부른다.
 *
 * [쓰는 법]  node search_gap.js [--out pinned/search_gap.md]
 * [연계] ← pinned/golden_questions.json · golden_eval.js(판정) · services/legal_retriever.js(검색)
 *        ⚠읽기 전용.
 */
const fs = require('fs');
const path = require('path');
const R = require('/home/user/SEAGNAL/local_server/services/legal_retriever.js');
const G = require('./golden_eval.js');

const HERE = __dirname;
const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : ''; };
const WIKI = path.resolve(HERE, '../..', 'wiki');
/** 후보 개수 컷 — 생산 상수를 그대로 읽는다(여기서 숫자를 베껴 두면 값이 바뀔 때 계기판만 옛말을 한다). */
const TOPK = R.PRIMARY_TOPK;

/** 질문에 흔히 섞이는 말 — 낱말 대조에서 뺀다(있으나 마나라 판정을 흐린다). */
const STOP = new Set(['하나요', '있나요', '어떻게', '무엇을', '경우', '해야', '되나요', '건가요', '인가요',
  '있는', '하는', '되는', '대해', '관해', '때는', '수도', '그런', '이런', '저런', '것은', '것이', '해도',
  '한다', '된다', '있다', '없다', '나요', '까요', '알려', '주세요', '싶은데', '합니다', '그럼', '그리고']);

/** 그 페이지 본문(frontmatter 제외). */
const BODY_CACHE = new Map();
function readBody(file) {
  if (BODY_CACHE.has(file)) return BODY_CACHE.get(file);
  let t = '';
  for (const dir of ['concepts', 'statutes', 'comparisons', 'annexes', 'activities']) {
    const p = path.join(WIKI, dir, file + '.md');
    if (fs.existsSync(p)) { t = fs.readFileSync(p, 'utf8').replace(/^---[\s\S]*?---\n/, ''); break; }
  }
  BODY_CACHE.set(file, t);
  return t;
}

/** 그 페이지 파일이 어느 폴더(kind)에 있나 — 개념 페이지인지 허브인지 가른다. */
const KIND_CACHE = new Map();
function kindOf(file) {
  if (KIND_CACHE.has(file)) return KIND_CACHE.get(file);
  let k = '?';
  for (const dir of ['concepts', 'statutes', 'comparisons', 'annexes', 'activities']) {
    if (fs.existsSync(path.join(WIKI, dir, file + '.md'))) { k = dir; break; }
  }
  KIND_CACHE.set(file, k);
  return k;
}

(async () => {
  const qs = JSON.parse(fs.readFileSync(path.join(HERE, 'pinned', 'golden_questions.json'), 'utf8')).questions
    .filter(q => q.verified && !q.skip);
  const idx = G.buildRowIndex();
  const PAGES = (R.loadIndex().pages || []);
  const rows = [];
  for (const q of qs) {
    const arts = G.artsOf(q.expect_article);
    // 부칙/본문 구분은 golden_eval 과 같은 판정을 쓴다(L-136 — 같은 대조는 같은 눈금으로).
    const owners = G.ownersOf(idx, q.expect_law, arts, G.isAddenda(q.expect_article));
    if (!owners.length) continue;                       // §6-E — 이 검사의 대상이 아니다
    let res = null;
    try { res = await R.search(q.question, {}); } catch (_) { res = null; }
    const got = new Set(((res && res.contextPages) || []).map(p => String(p.file || '')));
    if (owners.some(o => got.has(o))) continue;         // chain — 잘 닿았다

    const kinds = owners.map(kindOf);
    const hasConcept = kinds.includes('concepts');
    // 그 행을 가진 개념 페이지가 **문항의 법** 것인가(파일명 앞이 그 법인가).
    const flatLaw = G.flat(q.law);
    const sameLawConcept = owners.some((o, i) => kinds[i] === 'concepts' && G.flat(o).startsWith(flatLaw));

    let cause, detail = '';
    if (!hasConcept) {
      cause = 'ⓐ 허브에만 있음';
      detail = owners.slice(0, 2).map((o, i) => `${kinds[i]}/${o}`).join(', ');
    } else if (!sameLawConcept) {
      cause = 'ⓑ 다른 법 소관';
      detail = owners.filter((o, i) => kinds[i] === 'concepts').slice(0, 2).join(', ');
    } else {
      // 개념 페이지가 그 법에 있는데도 안 왔다 — 질의에 법 이름을 붙이면 오는지 본다.
      let res2 = null;
      try { res2 = await R.search(q.law + ' ' + q.question, {}); } catch (_) { res2 = null; }
      const got2 = new Set(((res2 && res2.contextPages) || []).map(p => String(p.file || '')));
      const hit = owners.find(o => got2.has(o));
      if (!hit) {
        cause = 'ⓓ 법 이름을 붙여도 안 옴';
        detail = owners.filter((o, i) => kinds[i] === 'concepts').slice(0, 2).join(', ');
      } else {
        // ★"법 이름을 붙이면 온다"는 법 이름에 가중치가 붙어서일 뿐, 의미검색이 답이라는 증거가 아니다.
        //   **그 페이지가 원래 질문에서 몇 위인지**를 생산 함수로 직접 잰다(termsOf → termWeights → scoreOne).
        //   ⚠근사치다 — 질의확장(AI)·용어사전·그래프 1홉이 빠진 값이다. 다만 생산도 그 페이지를
        //     못 가져온 상황이라, 이 순위는 "얼마나 밀렸나"의 눈금으로 쓸 만하다.
        const terms = R.termsOf(q.question);
        const w = R.termWeights(PAGES, terms);
        const scored = PAGES.map(p => ({ f: p.file, s: R.scoreOne(p, terms, w) })).sort((a, b) => b.s - a.s);
        const at = scored.findIndex(x => owners.includes(x.f));
        const sc = at >= 0 ? scored[at].s : 0;
        const top = scored[0] ? scored[0].s : 0;
        // ★후보를 자르는 관문은 **둘**이다 — 문턱과 개수. 순서대로 걸린다:
        //   ① 문턱  `MIN_KEEP_SCORE = Math.max(2, topScore * 0.3)` 미만이면 버린다
        //   ② 개수  문턱을 넘은 것 중 **앞에서 PRIMARY_TOPK(현재 20)개만** 남긴다
        //   ⚠2026-08-21 최초판은 ①만 관문으로 보고 "문턱을 아슬아슬하게 놓쳤다"고 14건을 묶었는데,
        //     그 14건은 점수가 문턱의 124~267%로 **문턱을 이미 넘은 것들**이었고 실제로는 21~134위라
        //     ②에 잘린 것이었다. L-158에서 똑같은 오진을 한 번 하고도 도구 라벨에 그대로 남겨 뒀다
        //     (H-45 ③ "그 검사가 통과했다고 정말 괜찮은가"를 도구 자신에게도 물어야 한다).
        //     **문턱을 손봐도 안 들어오는 것과 들어오는 것은 손댈 곳이 전혀 다르다.**
        const cut = Math.max(2, top * 0.3);
        const pct = cut > 0 ? sc / cut : 0;
        const rank = at + 1;
        cause = sc <= 0 ? 'ⓒ-1 점수가 아예 안 남(낱말이 안 겹침)'
          : sc >= cut ? `ⓒ-2 문턱은 넘었는데 순위 컷(상위 ${TOPK}위)에 잘림`
            : pct >= 0.4 ? 'ⓒ-3 문턱 미달(문턱의 40~100%)'
              : 'ⓒ-4 문턱의 40% 미만(한참 아래)';
        detail = `${scored[at] ? scored[at].f : hit} · ${rank}위 · 점수 ${sc.toFixed(1)} / 문턱 ${cut.toFixed(1)}` +
          ` = ${(pct * 100).toFixed(0)}% (1위 ${top.toFixed(1)})`;
      }
    }
    rows.push({ law: q.law, q: q.question.slice(0, 52), want: `${q.expect_law} ${q.expect_article}`, cause, detail });
  }

  const tally = {};
  rows.forEach(r => { tally[r.cause] = (tally[r.cause] || 0) + 1; });
  console.log(`search 실패 ${rows.length}건 — 원인별\n`);
  Object.entries(tally).sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  ${k}  (${(v * 100 / rows.length).toFixed(0)}%)`));

  if (arg('--out')) {
    const out = ['# search 실패 원인 분류 — 자동 생성(`node search_gap.js --out ...`)', '',
      '`golden_eval.js` 가 `search`(행은 위키에 있는데 그 페이지가 후보에 안 옴)로 찍은 문항을 원인별로 갈랐다.',
      '판정은 그 파일의 함수를 그대로 쓰고, 검색도 생산 `legal_retriever.search()` 를 그대로 부른다.', '',
      '| 원인 | 건수 | 뜻 | 손댈 곳 |', '|---|---:|---|---|',
      `| ⓐ 허브에만 있음 | ${tally['ⓐ 허브에만 있음'] || 0} | 그 행을 가진 페이지가 허브·비교·별표뿐 | **개념 페이지 신설**(출입국관리법 사례) |`,
      `| ⓑ 다른 법 소관 | ${tally['ⓑ 다른 법 소관'] || 0} | 근거가 다른 법에 있다 | **타법 연결 다리**(해양폐기물법 사례) |`,
      `| ⓒ-1 점수가 아예 안 남 | ${tally['ⓒ-1 점수가 아예 안 남(낱말이 안 겹침)'] || 0} | 질의 낱말이 그 페이지와 하나도 안 겹친다 | **의미검색(H-47 ④) · 본문 용어 보강** |`,
      `| ⓒ-2 순위 컷에 잘림 | ${tally[`ⓒ-2 문턱은 넘었는데 순위 컷(상위 ${TOPK}위)에 잘림`] || 0} | 문턱은 넘었는데 상위 ${TOPK}위 밖 | **순위** 문제 — 문턱을 낮춰도 안 들어온다 |`,
      `| ⓒ-3 문턱 미달(40~100%) | ${tally['ⓒ-3 문턱 미달(문턱의 40~100%)'] || 0} | 문턱에 못 미친다 | 가중치 개선 여지 |`,
      `| ⓒ-4 문턱의 40% 미만 | ${tally['ⓒ-4 문턱의 40% 미만(한참 아래)'] || 0} | 한참 아래 | 흔한 말이 점수를 지배 — **의미검색** 후보 |`,
      `| ⓓ 법 이름을 붙여도 안 옴 | ${tally['ⓓ 법 이름을 붙여도 안 옴'] || 0} | 점수가 아예 안 난다 | 페이지 본문·주제를 봐야 한다 |`, ''];
    for (const c of Object.keys(tally)) {
      out.push(`## ${c} (${tally[c]}건)\n`, '| 법 | 문항 | 기대 근거 | 그 행이 있는 곳 |', '|---|---|---|---|');
      rows.filter(r => r.cause === c).forEach(r =>
        out.push(`| ${r.law} | ${r.q.replace(/\|/g, '／')} | ${r.want.replace(/\|/g, '／')} | ${r.detail.replace(/\|/g, '／')} |`));
      out.push('');
    }
    fs.writeFileSync(path.resolve(HERE, arg('--out')), out.join('\n'));
    console.log(`\n저장: ${arg('--out')}`);
  }
})();
