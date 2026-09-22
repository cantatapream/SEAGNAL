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
// ⚠2026-09-22(G-31) — 여기는 예전에 `/home/user/SEAGNAL/...` 절대경로였다. 그 탓에 이 게이트는
//   **이 컨테이너 한 대에서만** 돌았고, 깃허브 CI 에서는 MODULE_NOT_FOUND 로 죽으면서
//   진단 한 줄 없이 실패만 세웠다(CI run #27 에서 같은 이유로 7개 게이트가 동시에 죽어 있었다).
//   저장소 안 상대경로로 바꾼다 — 어디에 체크아웃하든 따라온다.
const R = require('../../../../services/legal_retriever.js');

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

/**
 * 위키 전체를 훑어 `법령|조문 → 그 행을 가진 페이지들` 색인을 만든다(한 번만).
 * ★왜 필요한가(2026-08-20, 첫 실행에서 오분류로 발견): 처음엔 "그 법의 아무 페이지나 왔으면
 *   페이지 도달"로 보고, 조문이 안 맞으면 §6-E 라고 찍었다. 그런데 손으로 확인해 보니
 *   「공유수면 관리 및 매립에 관한 법률 시행령 제40조」 행은 `매립면허.md` 에 **멀쩡히 있었다** —
 *   검색이 그 페이지를 안 가져온 것이었다. **검색 실패를 위키 실패로 뒤집어씌운 것**이다.
 *   그래서 "그 행이 위키 어딘가에 있기는 한가"를 먼저 보고 갈래를 정한다(L-125 와 같은 뿌리).
 */
/** 페이지 → 그 페이지의 법. 생산이 baseLaw 로 쓰는 값과 같은 재료(index.json). */
function buildBaseLawMap() {
  const m = new Map();
  try {
    const idx = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'index.json'), 'utf8'));
    for (const p of (idx.pages || [])) m.set(String(p.file || ''), String(p.law || ''));
  } catch (_) { /* 없으면 아래에서 frontmatter 로 대체 */ }
  return m;
}
const BASE_LAW = buildBaseLawMap();

function buildRowIndex() {
  const idx = new Map();
  const WIKI = path.resolve(__dirname, '..', '..', 'wiki');
  // ★생산 코드와 같은 범위를 본다(2026-08-21, 출입국관리법 사서 지적 → 생산 코드로 검산):
  //   legal_retriever.search() 는 매칭된 **모든 소스**에서 extractCitationChain 을 뽑고,
  //   그 소스에는 statutes(허브)·comparisons·annexes·activities 페이지가 다 들어온다.
  //   여기서 concepts 만 훑으면, 근거 행이 허브 페이지에만 있는 tier-2 참조법(출입국관리법 등)이
  //   "위키 어느 표에도 없음(§6-E)" 으로 **잘못** 찍힌다 — 위키 결함이 아니라 채점기 결함이다(L-150).
  for (const dir of ['concepts', 'statutes', 'comparisons', 'annexes', 'activities']) {
    const D = path.join(WIKI, dir);
    if (!fs.existsSync(D)) continue;
    for (const f of fs.readdirSync(D)) {
      if (!f.endsWith('.md')) continue;
      const src = fs.readFileSync(path.join(D, f), 'utf8');
      // ★baseLaw 는 **index.json 의 law** 다(생산 routes/legal.js mergeCitationChains 와 같은 재료).
      //   마크다운 frontmatter 를 읽으면 `law:` 줄이 없는 페이지에서 빈 값이 된다 — link_ready.js 에서
      //   같은 실수를 이미 고쳤는데(L-153) 이 파일에는 남아 있었다. baseLaw 가 비면 계층 낱말 칸
      //   (`시행규칙`)을 어느 법으로 풀지 몰라 **맞는 근거 행이 통째로 탈락**한다(2026-08-21 실측).
      const fm = /^---\n([\s\S]*?)\n---/.exec(src);
      const baseLaw = BASE_LAW.get(f.replace(/\.md$/, ''))
        || (fm ? ((/^law:\s*(.+)$/m.exec(fm[1]) || [])[1] || '').trim().replace(/^["']|["']$/g, '') : '');
      // ⚠검색 결과의 `file` 은 **확장자가 없다**(`법__주제`). 색인 쪽도 떼어 맞춘다 —
      //   처음엔 `.md` 를 붙여 넣어 한 건도 안 맞았고 chain 이 0 으로 나왔다.
      const file = f.replace(/\.md$/, '');
      for (const row of R.extractCitationChain(src.replace(/^---[\s\S]*?---\n/, ''))) {
        const k = flat(row.law);
        if (!idx.has(k)) idx.set(k, []);
        idx.get(k).push({ file, row, baseLaw });
      }
    }
  }
  return idx;
}

/**
 * 기대 (법령, 조문) 을 가진 페이지들.
 * ★판정을 **생산 함수에 맡긴다**(2026-08-21). 예전엔 행의 조문 칸에서 조문 토큰을 뽑아 문자열로
 *   맞춰 봤는데, 그러면 **범위 표기 행**(`제9~15조의2`)이 그 안의 조문(제10조의3)을 안 가진 것으로
 *   보였다. 생산 코드는 그 행을 제대로 살려 낸다 — 직접 태워 확인했다:
 *     filterCitationChainByAnswer([제9~15조의2 행], '「해운법 시행규칙」 제10조의3에 따릅니다.') → 살아남음.
 *   즉 문자열 비교판은 **멀쩡한 행을 없는 것으로 찍어** 위키에 없는 결함을 만들어 냈다
 *   (L-149·L-150 과 같은 뿌리 — 채점기의 좁은 시야를 데이터 탓으로 돌리는 것). 검사와 코드가
 *   어긋나지 않게 같은 함수를 쓴다(L-136).
 */
/**
 * 법령 칸이 **계층 낱말뿐**인가(`시행령`·`시행규칙`·`이 법`). 그런 칸은 그 페이지의 법(baseLaw)으로
 * 풀어야 어느 법인지 정해진다 — 클라이언트 `_baseMatters` 와 같은 판정이다.
 */
function tierWordOnly(name) {
  const t = String(name || '').replace(/[「」『』]/g, '')
    .replace(/\s*(?:별표|별지|서식)[^가-힣]*$/, '').replace(/\s+/g, '');
  if (!t || /^같은/.test(t)) return true;
  return t.replace(/^(이|동|본)/, '').replace(/(법률|법령|법|시행령|시행규칙|[·ㆍ・,\/]|→)/g, '') === '';
}

/**
 * 기대 근거·행이 **부칙**을 가리키는가.
 * ★왜 필요한가(2026-09-06, 소유자 결정 ⑤ⓐ로 고침): `artsOf()` 는 `부칙(제20939호) 제2조` 에서
 *   호수를 떼고 **`제2조` 하나로 뭉갠다.** 그러면 "이 근거를 가진 페이지"를 찾을 때 **법 본문
 *   제2조(정의)를 가진 엉뚱한 페이지**가 잡힌다 — 실측으로 확인했다(수산업ㆍ어촌발전기본법
 *   `부칙(제20939호) 제2조` 문항에서 `__수산업수산인어업인정의` 와 허브 페이지가 잡혔고,
 *   정작 그 부칙을 실은 페이지는 검색 후보 4위로 들어와 있는데도 실패로 찍혔다).
 *   부칙은 본문과 **다른 조문 공간**이다. 같은 "제2조"라도 서로 다른 것이므로 갈라 본다.
 * ⚠호수(제20939호)까지 맞추지는 않는다 — 위키가 호수를 적는 꼴이 제각각이라 그것까지 맞추면
 *   맞는 행도 떨어진다. 여기서는 **부칙이냐 본문이냐**만 가른다(그것만으로 오매칭이 사라진다).
 */
function isAddenda(s) { return /부\s*칙/.test(String(s || '')); }

/**
 * 부칙 근거를 찾을 때 쓰는 **추가 열쇠**를 만든다 — `부칙 제20939호` · `부칙 2025.4.22` 꼴.
 * ★왜 필요한가(2026-09-06): 생산 매처는 부칙 행을 **호수·공포일**로 살려 낸다. 그래서 기대 근거를
 *   `제2조` 하나로만 두면, 위키에 맞는 부칙 행이 **있어도** 못 찾는다(실측: 수산업ㆍ어촌발전기본법
 *   페이지에 `부칙(제20939호) 제2조` 행을 넣어도 owners 가 비었다).
 *   `reach_eval.js` 의 `friendlyAnswer()` 가 이미 같은 열쇠를 만들고 있어 **그 규칙을 그대로 쓴다**
 *   (L-136 — 같은 대조를 두 곳에서 다르게 구현하면 숫자가 헛것이 된다).
 */
function addendaKeys(s) {
  const t = String(s || ''); const out = [];
  if (!isAddenda(t)) return out;
  const ho = /제\s*(\d{3,6})\s*호/.exec(t);
  if (ho) { out.push('부칙 제' + ho[1] + '호'); return out; }
  const d = /(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/.exec(t);
  if (d) out.push('부칙 ' + d[1] + '.' + Number(d[2]) + '.' + Number(d[3]));
  return out;
}

function ownersOf(idx, law, arts, wantAddenda) {
  const L = flat(law); const out = new Set();
  for (const [rl, entries] of idx) {
    if (!(rl.includes(L) || L.includes(rl))) continue;
    for (const e of entries) {
      if (out.has(e.file)) continue;
      // ★계층 낱말뿐인 칸(`시행령`)은 **그 페이지의 법**으로 풀어야 한다(2026-08-21).
      //   안 풀면 `시행령` 이 "…시행령" 을 이름에 품은 **모든 법**에 붙어, 아무 관계 없는 법의
      //   페이지가 "그 근거를 가진 곳"으로 잡힌다(실측: 수산물유통법 시행령 제5조를 찾는데
      //   해사안전기본법 페이지가 잡혔다 — 그 페이지의 `시행령 제5조` 행 때문).
      //   ⚠생산 `filterCitationChainByAnswer` 는 이 경우를 걸러 주지 않는다(그 칸은 답변이 어느
      //     법의 시행령을 말하든 살아남는다). 그건 그것대로 결함이지만, **측정은 그 느슨함을
      //     물려받으면 안 된다** — 여기서 기대 법과 맞는지 따로 본다.
      if (tierWordOnly(e.row.law) && !(L && flat(e.baseLaw) && L.startsWith(flat(e.baseLaw)))) continue;
      // ★부칙과 본문을 가른다(2026-09-06) — 위 isAddenda 머리말 참고.
      if (!!wantAddenda !== (isAddenda(e.row.law) || isAddenda(e.row.article))) continue;
      // ★기대 근거가 부칙인데 **호수를 안 적은** 경우가 있다(`부칙 제3조·제20조·제82조`).
      //   그때는 **행이 스스로 적어 둔 호수**를 열쇠로 써 본다 — 생산 매처가 부칙 행을 살려 내는
      //   열쇠가 호수·공포일이기 때문이다(reach_eval friendlyAnswer 와 같은 규칙).
      //   ⚠아무 부칙 행에나 붙지 않게, **그 행이 기대한 조(제3조 등)를 실제로 담고 있을 때만** 쓴다.
      const tries = arts.slice();
      if (wantAddenda) {
        const rowKeys = addendaKeys(`${e.row.law} ${e.row.article}`);
        if (rowKeys.length && arts.some(a => !/^부칙/.test(a) && flat(e.row.article).includes(flat(a)))) {
          tries.push(...rowKeys);
        }
      }
      for (const a of tries) {
        const answer = `\u300c${e.row.law}\u300d ${a}에 따릅니다.`;
        if (R.filterCitationChainByAnswer([Object.assign({}, e.row)], answer, e.baseLaw).length) {
          out.add(e.file); break;
        }
      }
    }
  }
  return [...out];
}


/**
 * raw 원문에 실재하는 조문 번호를 법마다 모아 둔다(cite_exists.js 와 같은 방식).
 * [왜] §6-E(위키 표에 행이 없음)로 찍힌 문항이, 생산 코드의 **B11 보탬**
 *   (routes/legal.js synthesizeChainRows — 답변이 인용한 조문을 원문으로 확인해 카드로 보탠다)
 *   으로 구제될 수 있는지 가르려고. 위키에 행이 없어도 원문에 그 조가 있으면 답변이 그 조를
 *   인용하는 순간 카드가 붙는다. 원문에도 없으면 그건 **수집 공백**(4축 ①)이라 성격이 다르다.
 * ⚠근사치다 — 실제 B11 은 services/article_text.js 가 GitHub 에서 읽고(토큰 필요) 조문 꼴까지 본다.
 *   여기서는 같은 저장소의 로컬 raw 로 "그 조가 원문에 있나"만 본다.
 */
function buildRawArticleIndex() {
  const RAW = path.resolve(__dirname, '..', '..', 'raw');
  const idx = new Map();
  if (!fs.existsSync(RAW)) return idx;
  for (const domain of fs.readdirSync(RAW)) {
    const dp = path.join(RAW, domain);
    if (!fs.statSync(dp).isDirectory()) continue;
    for (const law of fs.readdirSync(dp)) {
      const lp = path.join(dp, law);
      if (!fs.statSync(lp).isDirectory()) continue;
      const nums = new Set();
      const walk = d => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const q = path.join(d, e.name);
          if (e.isDirectory()) walk(q);
          else if (e.name.endsWith('.txt')) {
            const t = fs.readFileSync(q, 'utf8');
            let m; const re = /제\s*(\d+)조/g;
            while ((m = re.exec(t)) !== null) nums.add(Number(m[1]));
          }
        }
      };
      try { walk(lp); } catch (_) { /* 못 읽으면 건너뛴다 */ }
      const key = flat(law).replace(/(시행령|시행규칙|시행규정)$/, '');
      const prev = idx.get(key);
      if (prev) for (const n of nums) prev.add(n);
      else idx.set(key, nums);
    }
  }
  return idx;
}

/** 기대 근거의 조문이 그 법 raw 에 실제로 있나(B11 이 구제할 수 있나). */
function inRaw(rawIdx, law, arts) {
  const L = flat(law).replace(/(시행령|시행규칙|시행규정)$/, '');
  let set = rawIdx.get(L);
  if (!set) for (const [k, v] of rawIdx) if (k.includes(L) || L.includes(k)) { set = v; break; }
  if (!set) return false;
  return arts.some(a => { const m = /제(\d+)조/.exec(a); return m && set.has(Number(m[1])); });
}

async function run() {
  const qs = JSON.parse(fs.readFileSync(QFILE, 'utf8')).questions || [];
  const idx = buildRowIndex();
  const rawIdx = buildRawArticleIndex();
  const out = [];
  for (const q of qs) {
    if (q.skip) continue;                       // 되묻기가 정답인 문항 등은 채점에서 뺀다
    if (!q.verified) continue;                  // ★사서가 원문·위키로 확인한 라벨만 채점한다(L-125)
    const wantArts = artsOf(q.expect_article).concat(addendaKeys(q.expect_article));
    const owners = ownersOf(idx, q.expect_law, wantArts, isAddenda(q.expect_article));
    let res;
    try { res = await R.search(q.question, {}); } catch (e) { res = null; }
    const pages = (res && res.contextPages) || [];
    const got = new Set(pages.map(p => String(p.file || '')));
    let verdict, where = '';
    const hit = owners.find(o => got.has(o));
    if (hit) { verdict = 'chain'; where = hit; }
    else if (!owners.length) { verdict = '6e'; where = '(위키 어느 표에도 이 근거 행이 없음)'; }
    else { verdict = 'search'; where = `있는 곳: ${owners.slice(0, 2).join(', ')}`; }
    const row = { law: q.law, q: q.question.slice(0, 60), verdict, where,
                  want: `${q.expect_law} ${q.expect_article}` };
    // §6-E 로 찍힌 문항은 "원문에는 있나"까지 갈라 둔다 — 있으면 B11 보탬이 구제할 수 있고,
    // 없으면 수집 공백(4축 ①)이라 손댈 곳이 다르다.
    if (verdict === '6e') row.raw = inRaw(rawIdx, q.expect_law, wantArts);
    out.push(row);
  }
  return out;
}

// ★다른 검사도 같은 판정을 쓰도록 열어 둔다(2026-08-21). 판정을 두 번 구현하면 어긋난다(L-136) —
//   `search_gap.js` 가 "그 행을 가진 페이지가 어디인가"를 여기서 그대로 가져다 쓴다.
//   ⚠아래 실행부는 **직접 실행할 때만** 돈다(require 로 불러도 안 돈다).
module.exports = { buildRowIndex, ownersOf, artsOf, flat, buildRawArticleIndex, inRaw, tierWordOnly, isAddenda, addendaKeys };
if (require.main === module) main();

function main() {
run().then(rows => {
  const n = rows.length;
  const c = v => rows.filter(r => r.verdict === v).length;
  const pct = x => n ? (x * 100 / n).toFixed(1) : '0.0';
  console.log(`골든 문항 ${n}개 — 기대 근거가 인용 후보까지 닿는가\n`);
  console.log(`  ✅ chain   ${String(c('chain')).padStart(4)} (${pct(c('chain'))}%)  기대 조문이 인용 후보에 들어옴`);
  console.log(`  ⚠ §6-E    ${String(c('6e')).padStart(4)} (${pct(c('6e'))}%)  위키 어느 근거 조문 표에도 그 행이 없음 → 위키`);
  console.log(`  ❌ search  ${String(c('search')).padStart(4)} (${pct(c('search'))}%)  행은 위키에 있는데 그 페이지가 후보에 안 옴 → 검색`);
  // §6-E 를 갈라 보여 준다(H-47 ③ 계측): 원문에 조가 있으면 답변이 그 조를 인용하는 순간
  // 생산 코드의 B11 보탬(routes/legal.js synthesizeChainRows)이 카드를 붙여 준다.
  const sixE = rows.filter(r => r.verdict === '6e');
  if (sixE.length) {
    const rescuable = sixE.filter(r => r.raw).length;
    console.log(`      └ 그중 원문엔 그 조가 있음(답변이 인용하면 B11 보탬이 구제) ${rescuable}건 · ` +
      `원문에도 없음(수집 공백, 4축 ①) ${sixE.length - rescuable}건`);
  }

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
}
