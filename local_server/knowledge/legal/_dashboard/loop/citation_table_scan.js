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
const R = require('/home/user/SEAGNAL/local_server/services/legal_retriever.js');

// `--wiki <디렉터리>` 로 다른 시점의 위키를 가리킬 수 있다(git 으로 옛 커밋을 꺼내 기준선을 잡을 때).
const _wi = process.argv.indexOf('--wiki');
const WIKI = _wi >= 0 ? process.argv[_wi + 1] : '/home/user/SEAGNAL/local_server/knowledge/legal/wiki';
// ⚠**코드가 실제로 어떻게 대조하는지에 맞춰 두 갈래로 나눈다**(2026-08-19 정정).
//   `시행령`·`시행규칙`만 적힌 칸은 lawMentionedInAnswer 의 ⓐ 갈래가 그 페이지의 법을 붙여
//   (`<법이름> 시행령`) 대조하므로 **결함이 아니다**(services/legal_retriever.js BARE_TIER_CELL_RE).
//   나머지 갈래 낱말(`운영규칙`·`행정규칙`·`고시`…)은 그 갈래가 안 받아 **진짜로 못 꺼낸다.**
//   처음엔 둘을 뭉쳐 세어 '결함 417건'으로 보고했는데, 실제 결함은 13건이었다 — 재는 것과
//   코드가 하는 일이 어긋나면 숫자가 통째로 헛것이 된다(오늘 라이브 검증이 준 교훈 그대로).
const TIER_OK = /^(시행령|시행규칙)$/;
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
    tier_ok: 0, bare_tier: 0, deictic: 0, no_name: 0, article_all: 0, paren: 0,
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
        s.tier_ok++;                                    // 결함 아님 — 코드가 페이지 법으로 펼친다
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
console.log(`(참고: 법령 칸이 '시행령'·'시행규칙'뿐인 행 ${now.tier_ok}개 — 코드가 페이지의 법을 붙여 대조하므로 결함 아님)`);
console.log('─'.repeat(78));
for (const k of Object.keys(LABEL)) {
  const d = base && typeof base[k] === 'number' ? now[k] - base[k] : null;
  const delta = d === null ? '' : (d === 0 ? '   (변화 없음)' : `   (${d > 0 ? '+' : ''}${d})`);
  console.log(`${LABEL[k].padEnd(44)} ${String(now[k]).padStart(6)}${delta}`);
}
if (!base) console.log('\n(기준선을 주면 증감을 함께 찍는다: --base <파일>)');

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
