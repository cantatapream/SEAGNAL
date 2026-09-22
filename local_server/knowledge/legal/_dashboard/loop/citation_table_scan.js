/**
 * citation_table_scan.js — 개념 페이지의 `## 근거 조문` 표가 **챗봇이 실제로 꺼낼 수 있는 상태**인지
 * 전수로 센다. AI 를 부르지 않는다(비용 0). 라이브 검증(유료·표본)과 짝을 이루는 무료·전수 검사다.
 *
 * [왜 있나] 감사관은 위키 아무 파일이나 열어 답을 찾지만, 챗봇은 개념 페이지의 `## 근거 조문` 표에서만
 * 근거를 만든다(`_SCHEMA.md` §6-E). 그래서 내용이 멀쩡히 있어도 그 표가 부실하면 사용자 앞에서는
 * 근거가 통째로 사라진다. 2026-08-18 라이브 검증에서 감사 `full` 판정의 절반이 재현되지 않은
 * 최대 원인이 이것이었다. 표본(법당 1문항)으로는 전체가 몇 건 남았는지 알 수 없어 이 전수 검사를 만든다.
 *
 * [무엇을 세나] 통합수정 2-U 가 고치기로 한 다섯 가지를 그대로 센다:
 *   ① `## 근거 조문` 절이 아예 없는 개념 페이지
 *   ② 법령 칸이 계층 낱말뿐(`시행령`·`시행규칙`)      — 어느 법인지 특정 불가
 *   ③ 법령 칸에 이름이 없음(`행정규칙(고시)` 같은 갈래 중복) — 근거 목록에 실릴 방법이 없음
 *   ④ 조문 칸이 `전체`·`전문`                        — 짚을 조문이 없어 대부분 탈락
 *   ⑤ 법령 칸에 괄호 주석이 붙음                      — 코드가 이미 감당하지만(2026-08-18 수정) 추이 관찰용
 *
 * [쓰는 법]
 *   node citation_table_scan.js                 → 지금 상태를 세어 표로 찍는다
 *   node citation_table_scan.js --save <파일>    → 그 숫자를 스냅샷으로 저장(고치기 전 기준선)
 *   node citation_table_scan.js --base <파일>    → 저장해 둔 기준선과 비교해 증감을 함께 찍는다
 *
 * [연계] → services/legal_retriever.js(extractCitationChain·lawCellVariants — **챗봇이 쓰는 그 파서를
 *        그대로 쓴다.** 따로 만들면 코드와 검사가 어긋나 오늘 같은 사고가 또 난다).
 *        ⚠읽기 전용 — 위키를 고치지 않는다.
 */
const fs = require('fs');
const path = require('path');
// ⚠2026-09-22(G-31) — 여기는 예전에 `/home/user/SEAGNAL/...` 절대경로였다. 그 탓에 이 게이트는
//   **이 컨테이너 한 대에서만** 돌았고, 깃허브 CI 에서는 MODULE_NOT_FOUND 로 죽으면서
//   진단 한 줄 없이 실패만 세웠다(CI run #27 에서 같은 이유로 7개 게이트가 동시에 죽어 있었다).
//   저장소 안 상대경로로 바꾼다 — 어디에 체크아웃하든 따라온다.
const R = require('../../../../services/legal_retriever.js');

// `--wiki <디렉터리>` 로 다른 시점의 위키를 가리킬 수 있다(git 으로 옛 커밋을 꺼내 기준선을 잡을 때).
const _wi = process.argv.indexOf('--wiki');
const WIKI = _wi >= 0 ? process.argv[_wi + 1] : path.resolve(__dirname, '../../wiki');
// ⚠**코드가 실제로 어떻게 대조하는지에 맞춰 두 갈래로 나눈다**(2026-08-19 정정).
//   `시행령`·`시행규칙`만 적힌 칸은 lawMentionedInAnswer 의 ⓐ 갈래가 그 페이지의 법을 붙여
//   (`<법이름> 시행령`) 대조하므로 **결함이 아니다**(services/legal_retriever.js BARE_TIER_CELL_RE).
//   나머지 갈래 낱말(`운영규칙`·`행정규칙`·`고시`…)은 그 갈래가 안 받아 **진짜로 못 꺼낸다.**
//   처음엔 둘을 뭉쳐 세어 '결함 417건'으로 보고했는데, 실제 결함은 13건이었다 — 재는 것과
//   코드가 하는 일이 어긋나면 숫자가 통째로 헛것이 된다(오늘 라이브 검증이 준 교훈 그대로).
const TIER_OK = /^(시행령|시행규칙)$/;
// 계층 낱말 뒤에 별표·별지 번호만 붙은 칸(`시행령 별표1`·`시행규칙 별지2호서식`).
// 2026-08-22 24차 감사(해양과학조사법 그룹)가 찾아냈다 — 이 검사는 TIER_OK 가 **정확일치**라
// 이 꼴을 "이름이 있는 칸"으로 오인해 통째로 통과시키고 있었고, 코드 쪽도 ⓐ 갈래가 못 받아
// 4개 법 19행이 근거 목록에서 죽어 있었다. 코드에 ⓐ-2 갈래를 넣어 살렸고(legal_retriever.js),
// 여기서는 **추이가 보이도록 따로 센다** — 코드가 되돌아가면 이 수가 결함이 된다.
const TIER_ANNEX = /^(시행령|시행규칙)(별표|별지|서식)/;
const TIER_BAD = /^(행정규칙|고시|훈령|예규|지침|규정|요령|세칙|운영규칙|법|법률)$/;
// 법 이름 자리에 **가리키는 말**만 있는 칸(`이 법`·`동법`·`동법 시행령`). 코드의 BARE_TIER_CELL_RE 는
// `시행령`·`시행규칙` 두 낱말만 페이지 법으로 펼치므로 이건 못 받는다 = 그 행은 근거로 못 실린다.
// 2026-08-19 최초 측정 113행(22차 통합수정 전 214행) — 처음 만든 검사가 이 유형을 통째로 놓쳤다.
const DEICTIC = /^(이법|동법|같은법|본법)(시행령|시행규칙)?$/;
const ARTICLE_ALL = /^(전체|전문|전조문)$/;

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

function scan() {
  const conceptDir = path.join(WIKI, 'concepts');
  const files = fs.existsSync(conceptDir) ? walk(conceptDir, []) : [];
  const s = {
    pages: 0, pages_no_table: 0, rows: 0,
    tier_ok: 0, tier_annex: 0, bare_tier: 0, deictic: 0, no_name: 0, article_all: 0, paren: 0,
    examples: { pages_no_table: [], bare_tier: [], no_name: [], article_all: [] },
  };
  for (const f of files) {
    const body = fs.readFileSync(f, 'utf8');
    s.pages++;
    const rows = R.extractCitationChain(body);
    if (!/^##\s*근거\s*조문/m.test(body)) {
      s.pages_no_table++;
      if (s.examples.pages_no_table.length < 8) s.examples.pages_no_table.push(path.basename(f));
      continue;
    }
    for (const r of rows) {
      s.rows++;
      const law = String(r.law || '').trim();
      const art = String(r.article || '').trim();
      const flat = law.replace(/\s+/g, '');
      if (DEICTIC.test(flat)) {
        s.deictic++;
        if (s.examples.bare_tier.length < 8) s.examples.bare_tier.push(path.basename(f) + ' | ' + law + ' | ' + art);
      } else if (TIER_OK.test(flat)) {
        // 원문 찾아오기는 된다(코드가 페이지 법으로 펼친다). **보여주기**는 화면이 따로 막는다 —
        // ai_chat.js displayLawName(2026-09-07 27차 라이브 검증에서 발견해 추가). 자세한 경위는
        // _dashboard/live27/FINDING-01_법령명없는인용.md 참고.
        s.tier_ok++;
      } else if (TIER_ANNEX.test(flat)) {
        s.tier_annex++;                                 // 결함 아님(ⓐ-2 갈래가 받는다) — 추이만 본다
      } else if (TIER_BAD.test(flat)) {
        s.bare_tier++;
        if (s.examples.bare_tier.length < 8) s.examples.bare_tier.push(path.basename(f) + ' | ' + law + ' | ' + art);
      } else if (R.lawCellVariants(law).every(v => TIER_OK.test(v.replace(/\s+/g, '')) || TIER_BAD.test(v.replace(/\s+/g, '')))) {
        // 괄호를 떼도 갈래 낱말만 남는다 = 이름이 없다
        s.no_name++;
        if (s.examples.no_name.length < 8) s.examples.no_name.push(path.basename(f) + ' | ' + law);
      }
      if (ARTICLE_ALL.test(art)) {
        s.article_all++;
        if (s.examples.article_all.length < 8) s.examples.article_all.push(path.basename(f) + ' | ' + law);
      }
      if (/\)$/.test(law) && law.includes('(')) s.paren++;
    }
  }
  return s;
}

const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : ''; };
const now = scan();
const basePath = arg('--base');
let base = null;
if (basePath) { try { base = JSON.parse(fs.readFileSync(basePath, 'utf8')); } catch (_) { base = null; } }

const LABEL = {
  pages_no_table: '① 근거 조문 표가 아예 없는 개념 페이지',
  bare_tier: '② 법령 칸이 갈래뿐이라 못 꺼냄(운영규칙·고시 등)',
  deictic: '②-2 법령 칸이 가리키는 말뿐(이 법·동법 시행령)',
  no_name: '③ 법령 칸에 이름이 없음(갈래만 중복)',
  article_all: '④ 조문 칸이 전체·전문',
  paren: '⑤ 법령 칸에 괄호 주석(코드가 감당함 — 추이 관찰용)',
};
console.log(`개념 페이지 ${now.pages}개 · 근거 조문 행 ${now.rows}개`);
console.log(`(참고: 법령 칸이 '시행령'·'시행규칙'뿐인 행 ${now.tier_ok}개 — 원문 **찾아오기**는 된다`);
console.log(`   (코드가 페이지의 법을 붙여 대조한다). 다만 **보여주기**는 화면 쪽에서 따로 막고 있다 —`);
console.log(`   여러 법이 섞인 답변에서 근거 목록이 "시행규칙 제1조의2"처럼 어느 법인지 없이 나오던 것을`);
console.log(`   2026-09-07 27차 라이브 검증에서 찾아, ai_chat.js displayLawName 이 페이지의 법을 붙여 그린다.`);
console.log(`   → 이 숫자가 늘어도 게이트는 막지 않는다. 다만 **화면 밖의 새 소비자**(알림·내보내기 등)를`);
console.log(`     만들 때는 같은 함정에 빠지므로 그때 displayLawName 과 같은 처리를 꼭 넣어야 한다.)`);
console.log(`(참고: 법령 칸이 '시행령 별표N'·'시행규칙 별지N' 꼴인 행 ${now.tier_annex}개 — 코드 ⓐ-2 갈래가 페이지의 법을 붙여 받는다)`);
console.log('─'.repeat(78));
for (const k of Object.keys(LABEL)) {
  const d = base && typeof base[k] === 'number' ? now[k] - base[k] : null;
  const delta = d === null ? '' : (d === 0 ? '   (변화 없음)' : `   (${d > 0 ? '+' : ''}${d})`);
  console.log(`${LABEL[k].padEnd(44)} ${String(now[k]).padStart(6)}${delta}`);
}
if (!base) console.log('\n(기준선을 주면 증감을 함께 찍는다: --base <파일>)');

// ★`--gate` — 커밋 게이트용. 지금 0으로 만들어 둔 결함이 **다시 생기면** 실패한다.
//   왜 필요한가: 위키는 사람과 AI가 계속 편집하므로, 오늘 214건을 0으로 만들어도
//   내일 새 페이지에 `동법`이라 적히거나 근거 조문 표 없이 만들어지면 그대로 되돌아간다.
//   검사를 만들어 두고 **게이트에 안 걸면 사람이 기억할 때만 돈다**(L-105가 정확히 그 실수였다).
//   ⚠④`조문 칸이 전체`는 게이트에 넣지 않는다 — 출입통제 공고·최저임금 고시처럼 조문 구조가
//     없는 문서가 실재해 0이 될 수 없고, 억지로 0을 만들면 그게 지어내기다.
if (argv.includes('--gate')) {
  const bad = [
    ['근거 조문 표가 아예 없는 개념 페이지', now.pages_no_table],
    ['법령 칸이 갈래뿐이라 못 꺼냄', now.bare_tier],
    ['법령 칸이 가리키는 말뿐(이 법·동법)', now.deictic],
    ['법령 칸에 이름이 없음', now.no_name],
  ].filter(([, n]) => n > 0);
  if (bad.length) {
    console.log('\n  ❌ 챗봇이 근거를 못 꺼내는 행이 다시 생겼습니다');
    bad.forEach(([k, n]) => console.log(`     · ${k}: ${n}건`));
    console.log('     고치는 법: node _dashboard/loop/fix_deictic_law_cells.js --apply (가리키는 말)');
    console.log('               그 밖은 --examples 로 어느 페이지인지 확인해 표를 손본다');
    process.exit(1);
  }
  console.log('\n  ✅ 챗봇이 근거를 못 꺼내는 행 없음');
}

if (arg('--save')) {
  fs.writeFileSync(arg('--save'), JSON.stringify(now, null, 1));
  console.log(`\n스냅샷 저장: ${arg('--save')}`);
}
if (argv.includes('--examples')) {
  console.log('\n── 예시 ──');
  for (const k of Object.keys(now.examples)) {
    if (!now.examples[k].length) continue;
    console.log(`[${LABEL[k]}]`);
    now.examples[k].forEach(x => console.log('  ' + x));
  }
}
