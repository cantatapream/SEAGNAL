/**
 * link_ready.js — 근거 조문 줄을 **눌렀을 때 그 원문이 실제로 열리는가**를 전수로 잰다. AI 안 쓴다(비용 0).
 *
 * [왜 있나 — 2026-08-21, 사용자 지적에서 나옴]
 * 2026-08-18 사용자 확정으로 답변 아래 "근거 법령" 카드 목록을 **없앴다**. 지금 사용자가 실제로 만나는
 * 근거는 **답변 본문의 조문 하이퍼링크**뿐이다 — 그걸 누르면 조문 팝업이 raw 원문을 읽어 보여준다.
 * 그런데 우리 계기판(V5-3·V5-5·V5-7)은 없어진 그 카드 목록을 기준으로 재고 있었다(L-152).
 * 이 검사는 계기판을 사용자 쪽으로 한 칸 옮긴다: **그 링크가 열 파일이 정해지는가, 그 파일에 그 조가 있는가.**
 *
 * [어떻게 보나 — 생산 코드를 그대로 태운다(L-136)]
 *   ① `legal_retriever.extractCitationChain` 으로 위키 표에서 줄을 뽑는다(챗봇이 쓰는 그 파서).
 *   ② `article_text.resolveBase(law, baseLaw, tier)` 로 **팝업이 열 raw 폴더**를 그대로 계산한다.
 *   ③ tier 로 파일을 고른다(법률·시행령·시행규칙은 고정 파일, 고시는 `pickNoticeFile` 이 고른다).
 *   ④ `article_text.listArticleNumbers` 로 그 파일에 실재하는 조 번호를 읽어, 줄의 조문 칸이
 *      가리키는 조가 거기 있는지 본다(묶음·범위 표기는 `articleEnumTokens` 로 편다).
 *
 * [갈래]
 *   ✅ ok          — 파일도 정해지고 그 조도 있다(누르면 열린다)
 *   ❌ 조문없음     — 파일은 열리는데 **그 조가 그 파일에 없다** → 계층을 잘못 짚었거나 수집이 덜 됐다
 *   ⚠ 경로없음     — 법령 칸으로 raw 폴더를 못 찾는다(모법도 안 잡힘)
 *   ⏭️ 원문미수집   — 그 폴더에 그 계층 파일 자체가 없다(수집 공백 — 4축 ①, 결함으로 세지 않는다)
 *   ⏭️ 조문아님     — 조문 칸이 별표·별지·설명뿐이라 이 검사의 대상이 아니다(V5-5 가 따로 본다)
 *
 * [쓰는 법]
 *   node link_ready.js [--examples] [--save <파일>] [--base <파일>] [--gate]
 * [연계] ← wiki 아래 md 전부 · raw 아래 txt 전부.
 *        ← services/legal_retriever.js · services/article_text.js (생산 함수 그대로).
 *        ⚠읽기 전용 — 위키를 고치지 않는다.
 */
const fs = require('fs');
const path = require('path');
const R = require('/home/user/SEAGNAL/local_server/services/legal_retriever.js');
const A = require('/home/user/SEAGNAL/local_server/services/article_text.js');

const REPO = path.resolve(__dirname, '../../../../..');   // rawPathOf 는 저장소 루트 기준 상대경로를 준다
const WIKI = path.resolve(__dirname, '../..', 'wiki');
const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : ''; };

const TIER_FILE = { law: '법률.txt', decree: '시행령.txt', rule: '시행규칙.txt' };

/**
 * 페이지 → 그 페이지의 법(baseLaw) 표. ★생산과 같은 재료를 쓴다 —
 * `routes/legal.js mergeCitationChains` 가 줄마다 붙이는 baseLaw 는 **index.json 의 law** 이지
 * 마크다운 frontmatter 가 아니다. 처음엔 frontmatter 를 읽었다가, `law:` 줄이 없는 페이지(강선의
 * 구조기준 등)에서 baseLaw 가 빈 값이 돼 "폴더 못 찾음" 이 부풀었다(2026-08-21, 보고 전에 잡음).
 */
function buildBaseLawMap() {
  const m = new Map();
  try {
    const idx = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'index.json'), 'utf8'));
    for (const p of (idx.pages || [])) m.set(String(p.file || ''), String(p.law || ''));
  } catch (_) { /* 없으면 빈 표 — 아래에서 frontmatter 로 대체한다 */ }
  return m;
}
const BASE_LAW = buildBaseLawMap();

/**
 * 위키에 있는데 **색인(index.json)에 없는 페이지**를 센다 — 그런 페이지는 챗봇이 아예 못 본다.
 * ★왜(2026-08-21 실제 사고): 이번 세션에 만들어 canonical 로 승격까지 한 개념 페이지 12장이
 *   `lint_index.py` 를 다시 안 돌려 색인에 없었다. 검색은 index.json 만 훑으므로(scoreOne),
 *   그 12장은 **만들었지만 사용자에게 한 번도 닿을 수 없는 상태**였다. 아무 게이트도 이걸 안 봤다.
 *   고치는 법은 한 줄이다 — `python3 _dashboard/loop/lint_index.py`.
 */
function unindexedPages() {
  const out = [];
  for (const dir of ['concepts', 'statutes', 'comparisons', 'annexes', 'activities']) {
    const D = path.join(WIKI, dir);
    if (!fs.existsSync(D)) continue;
    for (const f of fs.readdirSync(D)) {
      if (!f.endsWith('.md')) continue;
      const k = f.replace(/\.md$/, '');
      if (!BASE_LAW.has(k)) out.push(dir + '/' + k);
    }
  }
  return out;
}

/** 조문 칸에서 조 번호만 뽑는다. 묶음·범위는 생산 함수가 편다(`제52~55·57조` → 여러 개). */
function joTokens(article) {
  const s = String(article || '');
  const out = new Set();
  for (const t of R.articleEnumTokens(s)) { const m = /^제\d+조(?:의\d+)?/.exec(t); if (m) out.add(m[0]); }
  const re = /제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/g;
  let m;
  while ((m = re.exec(s)) !== null) out.add('제' + m[1] + '조' + (m[2] ? '의' + m[2] : ''));
  return [...out];
}

/** 그 폴더·계층의 원문 파일 경로. 없으면 null. */
function fileOf(baseRel, tier, law) {
  const dir = path.join(REPO, baseRel);
  if (tier === 'notice') {
    const nd = path.join(dir, '행정규칙');
    if (!fs.existsSync(nd)) return null;
    // pickNoticeFile 은 GitHub Contents API 응답 모양을 받는다 — `{name, type}` 둘 다 있어야 한다.
    // ⚠`type` 을 빼먹었더니 그 함수가 전부 건너뛰어 833건이 "고시 파일 못 고름"으로 잡혔다
    //   (2026-08-21, 보고 전에 손으로 한 건 열어 보고 발견 — 파일은 멀쩡히 있었다).
    const picked = A.pickNoticeFile(
      fs.readdirSync(nd, { withFileTypes: true })
        .map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' })), law);
    return picked ? path.join(nd, picked) : null;
  }
  const f = TIER_FILE[tier] || TIER_FILE.law;
  const p = path.join(dir, f);
  return fs.existsSync(p) ? p : null;
}

const numsCache = new Map();
/**
 * 그 파일에 실재하는 조 번호. **삭제된 조는 따로 모은다.**
 * ⚠왜(2026-08-21 실측): `listArticleNumbers` 는 조 제목 괄호를 표식으로 삼는데, 삭제된 조는
 *   `제11조 <삭제 2007. 11. 2>` 처럼 제목이 없어 그 목록에 안 잡힌다. 그런데 위키가 범위로 적은
 *   칸(`제7~18조`)에는 그 삭제 조가 딸려 들어온다 — 이걸 결함으로 세면 **고칠 수 없는 것을
 *   고치라고 시키는 셈**이다(삭제는 국가가 한 것이지 우리가 틀린 게 아니다).
 */
function articleNumbersOf(file, tier) {
  const k = file + '|' + tier;
  if (numsCache.has(k)) return numsCache.get(k);
  const out = { live: new Set(), dead: new Set() };
  try {
    const text = fs.readFileSync(file, 'utf8');
    out.live = new Set(A.listArticleNumbers(text, tier));
    const re = tier === 'notice'
      ? /(?:^|\n)제(\d+)조(?:의(\d+))?\s*(?:<[^>]*)?삭제/g
      : /(?:^|\n)\[제(\d+)조(?:의(\d+))?\][^\n]*삭제/g;
    let m;
    while ((m = re.exec(text)) !== null) out.dead.add('제' + m[1] + '조' + (m[2] ? '의' + m[2] : ''));
  } catch (_) { /* 못 읽으면 빈 집합 */ }
  numsCache.set(k, out);
  return out;
}

const now = { rows: 0, ok: 0, deleted: 0, no_article: 0, no_base: 0, no_file: 0, no_notice: 0, skipped: 0 };
const ex = { no_article: [], no_base: [], no_file: [], no_notice: [] };

for (const dir of ['concepts', 'statutes', 'comparisons', 'annexes', 'activities']) {
  const D = path.join(WIKI, dir);
  if (!fs.existsSync(D)) continue;
  for (const f of fs.readdirSync(D)) {
    if (!f.endsWith('.md')) continue;
    const src = fs.readFileSync(path.join(D, f), 'utf8');
    const fm = /^---\n([\s\S]*?)\n---/.exec(src);
    const baseLaw = BASE_LAW.get(f.replace(/\.md$/, ''))
      || (fm ? ((/^law:\s*(.+)$/m.exec(fm[1]) || [])[1] || '').trim().replace(/^["']|["']$/g, '') : '');
    for (const row of R.extractCitationChain(src.replace(/^---[\s\S]*?---\n/, ''))) {
      now.rows++;
      const law = String(row.law || ''), tier = String(row.tier || 'law');
      const jos = joTokens(row.article);
      if (!jos.length) { now.skipped++; continue; }              // 별표·별지·설명뿐인 칸은 V5-5 소관
      const baseRel = A.resolveBase(law, baseLaw, tier);
      if (!baseRel) {
        now.no_base++;
        if (ex.no_base.length < 30) ex.no_base.push(`${dir}/${f}  |  ${law.slice(0, 34)}  |  ${String(row.article).slice(0, 24)}`);
        continue;
      }
      const file = fileOf(baseRel, tier, law);
      if (!file) {
        // 고시는 폴더 안 여러 파일 중 하나를 이름으로 골라야 해서 성격이 다르다 —
        // 못 고른 것은 "그 고시를 아직 안 받아왔다" 이거나 "위키 이름과 파일 이름이 어긋난다" 다.
        const k = tier === 'notice' ? 'no_notice' : 'no_file';
        now[k]++;
        if (ex[k].length < 30) ex[k].push(`${dir}/${f}  |  ${law.slice(0, 40)}`);
        continue;
      }
      const have = articleNumbersOf(file, tier);
      const miss = jos.filter(j => !have.live.has(j) && !have.dead.has(j));
      if (!miss.length) {
        // 삭제된 조만 걸린 줄은 "열린다" 로 세되 따로 표시해 둔다(고칠 수 있는 결함이 아니다).
        if (jos.some(j => !have.live.has(j) && have.dead.has(j))) now.deleted++;
        now.ok++; continue;
      }
      now.no_article++;
      if (ex.no_article.length < 40) {
        ex.no_article.push(`${dir}/${f}  |  ${law.slice(0, 30)}  |  ${String(row.article).slice(0, 26)}  ← ${miss.slice(0, 4).join('·')}  (${path.basename(file)})`);
      }
    }
  }
}

let base = null;
const BASE_FILE = arg('--base');
if (BASE_FILE) { try { base = JSON.parse(fs.readFileSync(BASE_FILE, 'utf8')); } catch (_) {} }
const delta = k => base && typeof base[k] === 'number'
  ? (now[k] - base[k] > 0 ? `  (+${now[k] - base[k]})` : now[k] - base[k] < 0 ? `  (${now[k] - base[k]})` : '') : '';

const unindexed = unindexedPages();
const judged = now.ok + now.no_article;
console.log(`근거 조문 줄 ${now.rows.toLocaleString()}개 · 조문을 짚은 줄 ${(now.rows - now.skipped).toLocaleString()}개`);
console.log(`\n  ✅ 눌러서 열린다        ${String(now.ok).padStart(6)}` +
  (judged ? `  (${(now.ok * 100 / judged).toFixed(1)}%)` : '') + delta('ok'));
console.log(`      └ 그중 삭제된 조가 낀 줄 ${String(now.deleted).padStart(4)}${delta('deleted')}   (국가가 삭제한 조 — 우리가 고칠 것 아님)`);
console.log(`  ❌ 그 파일에 그 조 없음  ${String(now.no_article).padStart(6)}${delta('no_article')}   ← 계층 오지정 또는 수집 공백`);
console.log(`  ⚠ 원문 폴더를 못 찾음   ${String(now.no_base).padStart(6)}${delta('no_base')}`);
console.log(`  ⏭️ 그 계층 파일이 없음   ${String(now.no_file).padStart(6)}${delta('no_file')}   (법률·시행령·시행규칙 미수집 — 4축 ①)`);
console.log(`  ⚠ 고시 파일을 못 고름   ${String(now.no_notice).padStart(6)}${delta('no_notice')}   (미수집이거나 위키 이름과 파일 이름이 어긋남)`);
console.log(`  ⏭️ 조문 칸이 아님        ${String(now.skipped).padStart(6)}${delta('skipped')}   (별표·별지·설명 — V5-5 소관)`);
if (unindexed.length) {
  console.log(`\n  ❌ 색인에 없는 위키 페이지 ${unindexed.length}장 — 챗봇이 **아예 못 봅니다**`);
  unindexed.slice(0, 10).forEach(x => console.log('      · ' + x));
  console.log('      고치는 법: python3 _dashboard/loop/lint_index.py');
}

if (argv.includes('--examples')) {
  for (const [k, title] of [['no_article', '그 파일에 그 조가 없음'], ['no_base', '원문 폴더를 못 찾음'], ['no_notice', '고시 파일을 못 고름'], ['no_file', '그 계층 파일이 없음']]) {
    if (!ex[k].length) continue;
    console.log(`\n── ${title} ──`);
    ex[k].forEach(l => console.log('  ' + l));
  }
}

if (arg('--save')) {
  fs.writeFileSync(arg('--save'), JSON.stringify(Object.assign({}, now, { examples: ex }), null, 1));
  console.log(`\n스냅샷 저장: ${arg('--save')}`);
}

if (argv.includes('--gate')) {
  if (!base) { console.log('\n  ⏭️  기준선이 없어 게이트를 건너뜁니다(--base 로 지정).'); process.exit(0); }
  // 0 을 요구하지 않는다 — 수집이 덜 된 법이 남아 있어 억지로 0 을 만들면 그게 지어내기다.
  // **기준선보다 늘어나면** 실패시킨다(V5-5 와 같은 규약).
  if (unindexed.length) {
    console.log(`\n  ❌ 색인에 없는 페이지 ${unindexed.length}장 — 만들어 놓고 색인을 안 돌렸습니다`);
    process.exit(1);
  }
  if (now.no_article > base.no_article || now.no_base > base.no_base) {
    console.log(`\n  ❌ 눌러도 안 열리는 줄이 늘었습니다 (조문없음 ${base.no_article}→${now.no_article} · 경로없음 ${base.no_base}→${now.no_base})`);
    process.exit(1);
  }
  console.log('\n  ✅ 기준선 대비 나빠지지 않음');
}
