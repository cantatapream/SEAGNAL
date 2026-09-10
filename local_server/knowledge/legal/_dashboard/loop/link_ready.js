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

// 생산(`article_text.js` squash)과 같은 정규화 — 이름 비교에만 쓴다.
const squash = s0 => String(s0 || '').replace(/\.txt$/i, '').replace(/[^0-9A-Za-z가-힣]/g, '');
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
    if (!fs.existsSync(nd)) {
      const g0 = A.pickNoticeGlobal && A.pickNoticeGlobal(law);
      return g0 ? path.join(REPO, g0) : null;
    }
    // pickNoticeFile 은 GitHub Contents API 응답 모양을 받는다 — `{name, type}` 둘 다 있어야 한다.
    // ⚠`type` 을 빼먹었더니 그 함수가 전부 건너뛰어 833건이 "고시 파일 못 고름"으로 잡혔다
    //   (2026-08-21, 보고 전에 손으로 한 건 열어 보고 발견 — 파일은 멀쩡히 있었다).
    const picked = A.pickNoticeFile(
      fs.readdirSync(nd, { withFileTypes: true })
        .map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' })), law);
    if (picked) return path.join(nd, picked);
    // 자기 폴더에서 못 찾으면 저장소 전체 고시 지도를 본다 — 생산과 같은 순서(L-136).
    const g = A.pickNoticeGlobal && A.pickNoticeGlobal(law);
    return g ? path.join(REPO, g) : null;
  }
  const f = TIER_FILE[tier] || TIER_FILE.law;
  const p = path.join(dir, f);
  if (fs.existsSync(p)) return p;
  // ★발췌본 폴백(2026-08-28) — 생산 코드(`article_text.js`)와 **같은 순서**로 본다.
  //   타법은 인용한 조문만 받아 두는 것이 확정 방침이라 파일 이름이 `법률_발췌.txt` 다.
  //   이 검사가 그걸 몰라서 **원문이 손에 있는데도 "계층 파일 없음"으로 세고 있었다**
  //   (실측: raw/15_관련타부처 491개 폴더 중 224개가 발췌본만 가진다).
  const alt = path.join(dir, f.replace('.txt', '_발췌.txt'));
  if (fs.existsSync(alt)) return alt;
  // ★그 자체가 대통령령인 법령(공무원 여비 규정·보안업무규정 등 실측 6폴더)은 파일 이름이
  //   `대통령령.txt`·`대통령령_발췌.txt` 다. 생산 코드와 **같은 순서**로 본다(L-136).
  if (tier === 'decree') {
    for (const n of ['대통령령.txt', '대통령령_발췌.txt']) {
      const p2 = path.join(dir, n);
      if (fs.existsSync(p2)) return p2;
    }
  }
  // ★그 자체가 "○○규칙"·"○○령"인 법령은 그 폴더의 `법률.txt` 안에 있다 — 생산과 같은 규칙(L-136).
  //   폴더 이름이 인용된 법령 이름과 같을 때만 쓴다.
  const bareLaw = String(law || '').replace(/[「」『』]/g, '').replace(/\s*[（(][^)）]*[)）]\s*$/, '').trim();
  if (tier !== 'law' && (squash(path.basename(dir)) === squash(String(law || '').replace(/[「」『』]/g, ''))
      || squash(path.basename(dir)) === squash(bareLaw))) {
    for (const n of ['법률.txt', '법률_발췌.txt']) {
      const p3 = path.join(dir, n);
      if (fs.existsSync(p3)) return p3;
    }
  }
  return null;
}

const numsCache = new Map();
/**
 * 그 파일에 실재하는 조 번호. **삭제된 조는 따로 모은다.**
 * ⚠왜(2026-08-21 실측): `listArticleNumbers` 는 조 제목 괄호를 표식으로 삼는데, 삭제된 조는
 *   `제11조 <삭제 2007. 11. 2>` 처럼 제목이 없어 그 목록에 안 잡힌다. 그런데 위키가 범위로 적은
 *   칸(`제7~18조`)에는 그 삭제 조가 딸려 들어온다 — 이걸 결함으로 세면 **고칠 수 없는 것을
 *   고치라고 시키는 셈**이다(삭제는 국가가 한 것이지 우리가 틀린 게 아니다).
 */
// ★addenda=true 면 **부칙 구간만** 본다(2026-08-28). 아래 본문 스캔은 부칙을 일부러 빼는데,
//   `○○법 부칙 제2조` 같은 인용은 정확히 그 뺀 자리를 가리킨다 — 그래서 갈래를 나눈다.
//   부칙은 줄머리 `제2조(제목)` 꼴이라 고시와 같은 규칙으로 읽는다(article_text.js 와 같은 판단).
function articleNumbersOf(file, tier, addenda) {
  let k = file + '|' + tier;
  if (addenda) k += '#부칙';
  if (numsCache.has(k)) return numsCache.get(k);
  const out = { live: new Set(), dead: new Set() };
  try {
    const text = fs.readFileSync(file, 'utf8');
    out.live = new Set(A.listArticleNumbers(text, tier));
    // ★타법 발췌본은 법률인데 **고시 형식**으로 적혀 있다(2026-08-23 실측).
    //   `listArticleNumbers` 는 계열별로 표식이 다르다는 전제로 만들어져 있어(L-54),
    //   법률 계열이면 `[제23조]` 대괄호만 조로 인정한다. 그런데
    //   `raw/15_관련타부처/*/법률.txt`(다른 부처 법을 연결 조문만 발췌한 파일)는
    //   `제23조(민감정보의 처리 제한)` 꼴로 적혀 있다 — 수집 스크립트가 달랐기 때문이다.
    //   그래서 **원문에 멀쩡히 있는 조가 "그 파일에 그 조 없음"으로 세어졌다.**
    //   실측: 표본 40건 중 23건이 이 경우였고, 개인정보 보호법 제23조는 파일 17행에 있었다.
    //   같은 유형의 사고가 전에도 있었다(L-167 — 채점 도구가 표기 차이를 못 넘으면
    //   맞은 답이 틀린 것으로 집계된다).
    //   ⚠고치는 범위를 좁힌다: **찾는 방식만 늘리고(합집합) 줄이지 않는다.** 이 도구는
    //   게이트 계측용이므로 여기서만 보정하고, 챗봇이 쓰는 `article_text.js` 는 건드리지 않는다
    //   (런타임 동작을 바꾸는 것은 별도 판단 사항이다).
    if (addenda) {
      // 부칙 구간만 남기고, 그 안의 줄머리 `제N조(` 를 조로 인정한다.
      const cut = text.search(/(?:^|\n)\s*\[?\s*부\s*칙/);
      const tail = cut >= 0 ? text.slice(cut) : '';
      const re2 = /(?:^|\n)제(\d+)조(?:의(\d+))?\(/g;
      let a2;
      while ((a2 = re2.exec(tail)) !== null) out.live.add('제' + a2[1] + '조' + (a2[2] ? '의' + a2[2] : ''));
      numsCache.set(k, out);
      return out;
    }
    if (tier !== 'notice') {
      // ⚠**부칙은 빼고 본다**(2026-08-23 적대검증에서 지적).
      //   부칙에는 `제15조(다른 법령의 개정)` 처럼 **다른 법을 고치는 조문**이 적혀 있는데,
      //   그걸 이 법의 살아 있는 조로 세면 없는 조가 있는 것이 된다.
      //   재현 사례: `raw/15_관련타부처/선원의안전및위생에관한규칙/법률.txt` 는 본문이 제1~8조뿐인데
      //   97행 부칙에 `제15조(다른 법령의 개정)` 이 나온다. 지금 이 법을 인용하는 위키는
      //   제8조만 짚고 있어 실제 오탐으로 이어지진 않았지만, 구멍은 구멍이다.
      const cut = text.search(/(?:^|\n)\s*부\s*칙\s*(?:<|\(|\s|$)/);
      const body = cut >= 0 ? text.slice(0, cut) : text;
      const alt = /(?:^|\n)제(\d+)조(?:의(\d+))?\(/g;
      let a;
      while ((a = alt.exec(body)) !== null) {
        out.live.add('제' + a[1] + '조' + (a[2] ? '의' + a[2] : ''));
      }
    }
    // ★"삭제된 조" 표기가 실제로는 여러 꼴이다(2026-08-31 전수 확인 — 종전 패턴 263개 → 342개).
    //   실측 표기: `제42조 삭 제 <2018.12.31.>`(삭제 사이 공백) · `제10조 < 삭  제`(공백 둘) ·
    //   `제47조 <개정 2008.7.18.> <삭제 2020.9.4>`(앞에 다른 꺾쇠가 하나 더) ·
    //   `제63조 ～ 제65조 <삭제 2002.1.18>`(여러 조를 한 번에 삭제).
    //   못 잡으면 **국가가 지운 조를 "우리가 못 받아온 조"로 세게 된다** — 실제로 선박설비기준
    //   제63~65조·어선설비기준 제42·62조 등이 그렇게 결함으로 집계되고 있었다.
    const re = tier === 'notice'
      ? /(?:^|\n)제(\d+)조(?:의(\d+))?\s*(?:[~～∼]\s*제(\d+)조\s*)?(?:<[^>]*>\s*)*[<(]?\s*삭\s*제/g
      : /(?:^|\n)\[제(\d+)조(?:의(\d+))?\][^\n]*삭\s*제/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      out.dead.add('제' + m[1] + '조' + (m[2] ? '의' + m[2] : ''));
      // `제63조 ～ 제65조 <삭제>` 는 그 사이 조가 통째로 지워진 것이다 — 사이 번호도 다 담는다.
      const to = m[3] ? parseInt(m[3], 10) : 0;
      for (let n = parseInt(m[1], 10) + 1; to && n <= to; n++) out.dead.add('제' + n + '조');
    }
  } catch (_) { /* 못 읽으면 빈 집합 */ }
  numsCache.set(k, out);
  return out;
}

const now = { rows: 0, ok: 0, deleted: 0, no_article: 0, no_parse: 0, no_base: 0, no_file: 0, no_notice: 0, skipped: 0 };
const ex = { no_article: [], no_parse: [], no_base: [], no_file: [], no_notice: [] };

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
      const law = String(row.law || '');
      let tier = String(row.tier || 'law');
      // ★생산이 실제로 여는 조만 센다(2026-08-31, L-136 — 게이트가 판정을 다시 만들면 안 된다).
      //   종전에는 `joTokens` 로 칸 안의 `제N조` 를 **전부** 긁었다. 그런데 조문 칸에는
      //   `법 제8조② 위임`·`별표6(법 제52조 위임)`·`제6조·시행령 제42조①…` 처럼
      //   **다른 문서의 조**가 함께 적힌 것이 있고, 생산(`parseArticleRef`)은 그런 번호를
      //   애초에 열지 않는다(직접 돌려 확인함 — 앞의 셋은 각각 null·null·제6조만). 그걸
      //   긁어다 "그 고시에 그 조가 없다"고 세면 **일어나지 않는 실패를 세는 것**이다.
      //   ⚠이 수정으로 줄어드는 숫자는 **자료가 좋아진 것이 아니라 계측이 고쳐진 것**이다.
      const ref = A.parseArticleRef(row.article, tier, law);
      // ⚠생산이 이 칸을 아예 못 읽는 경우는 **따로 센다**(`no_parse`). 처음엔 "V5-5 소관"이라며
      //   건너뛰기로 넣었다가, 실제로 세어 보니 190줄이고 **어느 게이트도 그걸 세고 있지 않았다**
      //   (reach_eval 의 같은 갈래는 14줄뿐). 건너뛰기로 넣으면 진짜 문제를 감추게 된다.
      //   내용은 두 갈래다 — ⓐ`법 제8조② 위임`처럼 다른 문서의 조가 적힌 칸,
      //   ⓑ`제127조·제129조~제132조`처럼 나열과 범위를 섞어 적어 파서가 포기하는 칸.
      //   둘 다 "챗봇이 이 줄로는 원문을 못 연다"는 점에서 같다.
      if (!ref) {
        now.no_parse++;
        if (ex.no_parse.length < 400) ex.no_parse.push(`${dir}/${f}  |  ${law.slice(0, 30)}  |  ${String(row.article).slice(0, 40)}`);
        continue;
      }
      if (ref.mode === 'whole' || ref.mode === 'annex') { now.skipped++; continue; }
      const jos = (ref.joList && ref.joList.length ? ref.joList : (ref.jo ? [ref.jo] : []))
        .filter(j => /^제\d+조(?:의\d+)?$/.test(j));
      if (!jos.length) { now.skipped++; continue; }              // 별표·별지·설명뿐인 칸은 V5-5 소관
      let baseRel = A.resolveBase(law, baseLaw, tier);
      // 이름이 우리가 가진 고시면 그 고시가 있는 법 폴더를 쓴다 — 생산과 같은 순서(L-136).
      if (!baseRel) {
        const g = A.pickNoticeGlobal && A.pickNoticeGlobal(law);
        if (g) { baseRel = g.replace(/\/행정규칙\/[^/]+$/, ''); tier = 'notice'; }
      }
      if (!baseRel) {
        now.no_base++;
        if (ex.no_base.length < 400) ex.no_base.push(`${dir}/${f}  |  ${law.slice(0, 34)}  |  ${String(row.article).slice(0, 24)}`);
        continue;
      }
      const file = fileOf(baseRel, tier, law);
      if (!file) {
        // 고시는 폴더 안 여러 파일 중 하나를 이름으로 골라야 해서 성격이 다르다 —
        // 못 고른 것은 "그 고시를 아직 안 받아왔다" 이거나 "위키 이름과 파일 이름이 어긋난다" 다.
        const k = tier === 'notice' ? 'no_notice' : 'no_file';
        now[k]++;
        if (ex[k].length < 400) ex[k].push(`${dir}/${f}  |  ${law.slice(0, 40)}`);
        continue;
      }
      // ★부칙 여부는 **법령 칸과 조문 칸 둘 다** 본다(2026-09-07).
      //   종전에는 법령 칸(`…법 부칙`)만 봤다. 그런데 생산이 조문 칸 부칙(`부칙(제21368호) 제3조`)도
      //   읽게 되면서(article_text.js ref.addenda), 그 줄은 부칙 구간을 봐야 조가 나온다.
      //   여기서 안 맞추면 **생산은 여는데 게이트만 "그 조 없음"이라 세는** 어긋남이 난다(L-136).
      const isAdd = (A.isAddendaCell && A.isAddendaCell(law)) || !!ref.addenda;
      const have = articleNumbersOf(file, tier, isAdd);
      let miss = jos.filter(j => !have.live.has(j) && !have.dead.has(j));
      // ★"없다"고 말하기 전에 **생산 함수로 한 번 더 확인한다**(2026-08-31, L-136·§6).
      //   빠른 판정에 쓰는 `listArticleNumbers` 는 조문 구간을 별표·부칙 앞에서 끊는다(부칙의
      //   제1조가 본문 조로 섞이는 것을 막는 정당한 장치다). 그런데 「현장승선실습 표준협약서」처럼
      //   **고시의 알맹이가 별표 안에 든 문서**는 그 조가 전부 경계 뒤에 있어, 파일에 멀쩡히 있는데도
      //   "그 조 없음"으로 세어졌다. 챗봇이 한 조를 열 때 쓰는 것은 `extractArticleBlock` 이고
      //   그쪽은 경계를 안 자르므로 실제로는 열린다. 없다고 셀 후보만 다시 보므로 비용은 미미하다.
      if (miss.length) {
        try {
          const text = fs.readFileSync(file, 'utf8');
          // 부칙 줄은 부칙 머리표기(고시와 같은 줄머리 `제6조(제목)`)로 적혀 있어 계층 규칙이 다르다.
          miss = miss.filter(j => !A.extractArticleBlock(text, j, isAdd ? 'notice' : tier));
        } catch (_) { /* 못 읽으면 종전 판정을 그대로 둔다 */ }
      }
      if (!miss.length) {
        // 삭제된 조만 걸린 줄은 "열린다" 로 세되 따로 표시해 둔다(고칠 수 있는 결함이 아니다).
        if (jos.some(j => !have.live.has(j) && have.dead.has(j))) now.deleted++;
        now.ok++; continue;
      }
      now.no_article++;
      // 표본 상한을 40 → 400 으로 올린다(2026-08-28) — 다른 세 갈래는 이미 400 인데 여기만
      // 40 이라, 185건을 유형별로 나누려 해도 **40건까지밖에 못 봤다.** 진단용 목록일 뿐이라
      // 숫자(now.no_article)에는 영향이 없다.
      if (ex.no_article.length < 400) {
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
console.log(`  ❌ 칸을 못 읽음         ${String(now.no_parse).padStart(6)}${delta('no_parse')}   ← 다른 문서의 조를 적었거나(「법 제8조 위임」) 나열·범위를 섞어 적어 파서가 포기한 칸`);
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
  for (const [k, title] of [['no_article', '그 파일에 그 조가 없음'], ['no_parse', '칸을 못 읽음'], ['no_base', '원문 폴더를 못 찾음'], ['no_notice', '고시 파일을 못 고름'], ['no_file', '그 계층 파일이 없음']]) {
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
  // `no_parse`(칸을 못 읽음)도 함께 막는다 — 안 그러면 조문 칸을 파서가 못 읽는 꼴로 고쳐 놓고도
  // "조문없음이 줄었다"로 통과한다(2026-08-31 신설).
  if (now.no_article > base.no_article || now.no_base > base.no_base ||
      (base.no_parse !== undefined && now.no_parse > base.no_parse)) {
    console.log(`\n  ❌ 눌러도 안 열리는 줄이 늘었습니다 (조문없음 ${base.no_article}→${now.no_article} · 경로없음 ${base.no_base}→${now.no_base} · 칸못읽음 ${base.no_parse}→${now.no_parse})`);
    process.exit(1);
  }
  console.log('\n  ✅ 기준선 대비 나빠지지 않음');
}
