/**
 * reach_eval.js — 근거 조문 표의 **모든 행**에 대해 "이 행이 사용자 화면의 근거 목록에 뜰 수
 * 있기는 한가"를 전수로 확인한다. AI 를 부르지 않는다(비용 0).
 *
 * [왜 있나 — 2026-08-20 신설]
 * `citation_table_scan.js` 는 **우리가 이미 아는 결함 다섯 가지**를 센다. 그래서 그 다섯 가지가
 * 0이 되어도 "그럼 나머지는 다 뜨는가"는 아무도 확인하지 않았다. 실제로 그 검사가 0인 상태에서
 * 이 검사를 처음 돌리니 **10,882행 중 76행(0.70%)이 어떤 답변으로도 근거가 될 수 없었다.**
 * 두 검사는 방향이 반대다 — 저쪽은 "아는 병을 찾고", 이쪽은 "안 낫는 환자를 찾는다".
 *
 * [어떻게 재나]
 * 행마다 **그 행에 가장 유리한 답변**을 만들어 실제 대조 함수에 넣는다. 유리한 답변이란
 *   「그 행의 법령 칸 이름」 + 바로 뒤에 「그 행이 짚는 조문 표기」
 * 를 붙여 쓴 문장이다. 조문 표기는 코드가 실제로 찾는 꼴로 만든다(토큰·묶음 편 것·부칙 열쇠·
 * 번호 없는 별표). 이렇게 최대한 맞춰 준 답변으로도 그 행이 안 살아나면, 현실의 답변으로는
 * 더더욱 안 살아난다 — 그런 행을 **도달불가**로 센다.
 *
 * ⚠이 검사는 "뜰 수 있나"만 본다. "떠야 하나"는 안 본다 — 도달불가가 0이어도 근거가 정확하다는
 *   뜻은 아니다. 그건 라이브 검증(유료·표본)이 볼 몫이다.
 *
 * [쓰는 법]
 *   node reach_eval.js                  → 지금 도달불가 행을 원인별로 센다
 *   node reach_eval.js --examples       → 어느 페이지 어느 칸인지 함께 찍는다
 *   node reach_eval.js --save <파일>     → 지금 숫자를 기준선으로 저장
 *   node reach_eval.js --gate           → 기준선(pinned/reach_eval_base.json)보다 늘면 실패
 *
 * [연계] → services/legal_retriever.js(extractCitationChain·filterCitationChainByAnswer·
 *        articleEnumTokens — **챗봇이 쓰는 그 함수를 그대로 쓴다.** 따로 만들면 검사와 코드가
 *        어긋나 숫자가 헛것이 된다).  ⚠읽기 전용 — 위키를 고치지 않는다.
 *        ← scripts/refactor/verify_all.sh (V5-5).
 */
const fs = require('fs');
const path = require('path');
const R = require('/home/user/SEAGNAL/local_server/services/legal_retriever.js');

const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const WIKI = arg('--wiki') || path.resolve(__dirname, '../../wiki');
const BASE_FILE = arg('--base') || path.join(__dirname, 'pinned', 'reach_eval_base.json');

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.md')) files.push(p);
  }
})(WIKI);

// 코드의 토큰 정규식과 **같은 것**을 쓴다(여기서 갈라지면 검사가 코드를 못 따라간다).
const TOK = /제\d+조(?:의\d+)?(?:제\d+항)?(?:제\d+호)?|별표\s*\d+(?:의\d+)?|별도\s*\d+(?:의\d+)?|별지\s*제\s*\d+호(?:의\d+)?\s*서식/g;

/**
 * 그 행에 **가장 유리한 답변**을 만든다.
 * 예: friendlyAnswer('해운법', '제9·11조') → '「해운법」 제9조에 따릅니다. 「해운법」 제11조에 따릅니다.'
 * @param {string} law - 근거 조문 표의 법령 칸
 * @param {string} article - 조문 칸
 * @returns {string} 그 행이 살아날 수 있는 최대치의 답변 문장
 */
function friendlyAnswer(law, article) {
  const c = new Set((article.match(TOK) || []).concat(R.articleEnumTokens(article)));
  const rg = /제(\d+)\s*[~∼]\s*(\d+)조/.exec(article);
  if (rg) c.add('제' + rg[1] + '조');
  if (/부칙/.test(article)) {
    const ho = /제\s*(\d{3,6})\s*호/.exec(article);
    if (ho) c.add('부칙 제' + ho[1] + '호');
    else {
      const d = /(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/.exec(article);
      if (d) c.add('부칙 ' + d[1] + '.' + Number(d[2]) + '.' + Number(d[3]));
    }
  }
  if (/별표(?!\s*\d)/.test(article) || /^(전체|전문|전조문)/.test(article.trim())) c.add('별표1');
  if (!c.size) c.add('별표1');
  return [...c].map(t => '「' + law + '」 ' + t + '에 따릅니다.').join(' ');
}

/** 도달불가 행을 원인별로 나눈다(고치는 방법이 갈래마다 다르다). */
function shapeOf(law, article) {
  const A = article.trim();
  if (/[·ㆍ・~∼]/.test(A) && /의\s*\d/.test(A)) return 'enum_branch';
  if (/별지|서식/.test(A) && /[·ㆍ・~∼]/.test(A)) return 'annex_form_run';
  if (/부칙/.test(A)) return 'buchik';
  if (!/^제?\s*\d/.test(A)) return 'not_article';
  return 'other';
}
const LABEL = {
  enum_branch: '가운뎃점 묶음에 가지조가 섞여 못 읽음',
  annex_form_run: '별지 서식을 묶음·범위로 적음',
  buchik: '부칙 — 호수·공포일이 답변과 맞지 않음',
  not_article: '조문 칸에 조문이 아닌 설명이 적힘',
  other: '그 밖(묶음·범위 표기 변형)',
};

const now = { rows: 0, dead: 0, enum_branch: 0, annex_form_run: 0, buchik: 0, not_article: 0, other: 0 };
const ex = {};
for (const f of files) {
  const raw = fs.readFileSync(f, 'utf8');
  const fm = /^---\n([\s\S]*?)\n---/.exec(raw);
  const baseLaw = fm ? ((/^law:\s*(.+)$/m.exec(fm[1]) || [])[1] || '').trim().replace(/^["']|["']$/g, '') : '';
  for (const r of R.extractCitationChain(raw.replace(/^---[\s\S]*?---\n/, ''))) {
    now.rows++;
    const law = String(r.law || ''), article = String(r.article || '');
    if (R.filterCitationChainByAnswer([Object.assign({}, r)], friendlyAnswer(law, article), baseLaw).length) continue;
    now.dead++;
    const s = shapeOf(law, article);
    now[s]++;
    (ex[s] = ex[s] || []).push(path.relative(WIKI, f) + '  |  ' + law.slice(0, 30) + '  |  ' + article.slice(0, 44));
  }
}

let base = null;
if (fs.existsSync(BASE_FILE)) { try { base = JSON.parse(fs.readFileSync(BASE_FILE, 'utf8')); } catch (_) {} }
const delta = k => base && typeof base[k] === 'number' ? (now[k] - base[k] > 0 ? `  (+${now[k] - base[k]})` : now[k] - base[k] < 0 ? `  (${now[k] - base[k]})` : '') : '';

console.log(`근거 조문 표 전체 행: ${now.rows.toLocaleString()}`);
console.log(`어떤 답변으로도 근거로 못 뜨는 행: ${now.dead} (${(now.dead / now.rows * 100).toFixed(2)}%)${delta('dead')}\n`);
for (const k of Object.keys(LABEL)) {
  console.log(`  ${String(now[k]).padStart(4)}  ${LABEL[k]}${delta(k)}`);
  if (argv.includes('--examples')) (ex[k] || []).slice(0, 8).forEach(x => console.log('        · ' + x));
}

if (argv.includes('--gate')) {
  // ★0을 요구하지 않는다 — 조문 구조 자체가 없는 고시(구간표·기준임금 같은 것)가 실재해 0이 될 수
  //   없고, 억지로 0을 만들면 그게 지어내기다. **기준선보다 늘어나면** 실패시킨다.
  const cap = base && typeof base.dead === 'number' ? base.dead : now.dead;
  if (now.dead > cap) {
    console.log(`\n  ❌ 근거로 못 뜨는 행이 늘었습니다 (기준선 ${cap} → 지금 ${now.dead})`);
    console.log('     어디인지 보기: node _dashboard/loop/reach_eval.js --examples');
    process.exit(1);
  }
  console.log(`\n  ✅ 근거로 못 뜨는 행 ${now.dead}건 — 기준선(${cap}) 이하`);
}

if (arg('--save')) {
  fs.writeFileSync(arg('--save'), JSON.stringify(now, null, 1));
  console.log(`\n스냅샷 저장: ${arg('--save')}`);
}
