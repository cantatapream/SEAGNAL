/**
 * fix_deictic_law_cells.js — 근거 조문 표의 법령 칸에 **가리키는 말**만 적힌 행을 정식 이름으로 편다.
 *
 * [왜 있나] 챗봇은 개념 페이지의 `## 근거 조문` 표에서만 근거를 만드는데, 그 대조는 법령 칸의
 * 이름을 답변 문장에서 찾는 방식이다(`lawMentionedInAnswer`). 칸이 `이 법`·`동법`·`동법 시행령`
 * 이면 그게 어느 법인지 알 수 없어 **그 행은 근거 목록에 실릴 방법이 없다.**
 * 코드는 `시행령`·`시행규칙` 두 낱말만 페이지의 법으로 펼쳐 주고(BARE_TIER_CELL_RE), 가리키는
 * 말은 받지 않는다. 2026-08-19 실측 113행(22차 통합수정 전에는 214행).
 *
 * [어떻게 푸나 — 지어내지 않는다]
 *   · `동법`·`같은 법`(+시행령/시행규칙) → **바로 앞 행들에서 마지막으로 나온 진짜 법 이름**.
 *     그게 이 말의 뜻 그대로다(위 표에서 ①이 「수산업ㆍ어촌 발전 기본법」이면 ②의 `동법`은 그 법).
 *   · `이 법`(+시행령/시행규칙) → **그 페이지의 법**. 파일명 앞부분(slug)과 표 안에 실제로 적힌
 *     법 이름을 대조해 **표에 있는 그 문자열 그대로** 쓴다(우리가 이름을 새로 만들지 않는다).
 *   · 둘 중 어느 쪽도 확정 못 하면 **손대지 않고 건너뛴다**(추측 금지).
 *
 * [쓰는 법]
 *   node fix_deictic_law_cells.js            → 미리보기(파일을 고치지 않는다)
 *   node fix_deictic_law_cells.js --apply    → 실제로 고친다
 *
 * [연계] ← citation_table_scan.js 가 세는 결함 중 하나. → wiki/concepts/*.md 의 `## 근거 조문` 표만 건드린다.
 *        ⚠본문·다른 절은 건드리지 않는다. 표의 다른 칸(조문·시행일·요지)도 그대로 둔다.
 */
const fs = require('fs');
const path = require('path');

const DIR = '/home/user/SEAGNAL/local_server/knowledge/legal/wiki/concepts';
// 표 안에 진짜 법 이름이 한 번도 안 나오는 페이지(전부 `이 법`)를 위해, slug→정식명 표를 읽어 둔다.
// 우리가 이름을 지어내는 게 아니라 **이미 확정된 법 목록**에서 그대로 가져오는 것이다.
const GROUPS = '/home/user/SEAGNAL/local_server/knowledge/legal/_dashboard/loop/audit18_groups.json';
const SLUG2NAME = new Map();
try {
  const g = JSON.parse(fs.readFileSync(GROUPS, 'utf8'));
  for (const arr of Object.values(g)) for (const l of arr) if (l && l.slug && l.name) SLUG2NAME.set(l.slug, l.name);
} catch (_) { /* 없으면 없는 대로 — 그런 페이지는 건너뛴다 */ }
const APPLY = process.argv.includes('--apply');
const DEICTIC = /^(이\s*법|동\s*법|같은\s*법|본\s*법)(?:\s*(시행령|시행규칙))?$/;
// 가리키는 말이 **섞여 있는** 칸(`이 법·시행령·시행규칙`)은 진짜 이름으로 치지 않는다 —
// 이걸 lastReal 로 삼았다가 `이 법·시행령·` 같은 값이 그대로 번지는 것을 미리보기에서 잡았다.
// ⚠낱말 안을 집으면 안 된다: `수산업ㆍ어촌 발전 기본법`의 "본법"을 가리키는 말로 오인해
//   그 줄이 통째로 무시되던 것을 미리보기에서 잡았다. 그래서 **칸을 구분기호로 쪼개
//   각 조각이 통째로 가리키는 말인지**만 본다(부분일치 금지).
const hasDeictic = v => String(v || '').split(/[·ㆍ,/]/).some(x => DEICTIC.test(x.trim()));
const flat = s => String(s || '').replace(/\s+/g, '');
const baseOf = s => String(s || '').replace(/\s*(시행령|시행규칙)\s*$/, '').trim();

function walk(d, out) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

/** 표 한 줄을 칸으로 쪼갠다(링크 안 파이프는 이 표에 거의 없지만, 있으면 그 줄은 건너뛴다). */
function cellsOf(line) {
  if (/\[\[[^\]]*\|/.test(line)) return null;   // 링크 안 파이프 — 안전하게 손대지 않는다
  const t = line.trim();
  if (!t.startsWith('|') || !t.endsWith('|')) return null;
  return t.slice(1, -1).split('|');
}

let files = 0, fixed = 0, skipped = 0;
const preview = [], skips = [];

for (const f of walk(DIR, [])) {
  const name = path.basename(f, '.md');
  if (!name.includes('__')) continue;                 // 법이 특정 안 되는 공용 페이지는 제외
  const pageSlugFlat = flat(name.split('__')[0]);
  const src = fs.readFileSync(f, 'utf8');
  const lines = src.split('\n');

  let inTable = false, lawCol = -1, lastReal = '', pageLaw = '';
  // 1차 훑기: 이 표에 실제로 적힌 법 이름 중 페이지의 법과 일치하는 문자열을 찾는다
  for (const line of lines) {
    if (/^##\s*근거\s*조문/.test(line)) { inTable = true; continue; }
    if (inTable && /^##\s/.test(line)) break;
    if (!inTable) continue;
    const c = cellsOf(line);
    if (!c) continue;
    const head = c.map(x => x.trim());
    if (lawCol < 0) { const i = head.findIndex(x => x === '법령' || x === '법령명'); if (i >= 0) lawCol = i; continue; }
    const law = (head[lawCol] || '').replace(/\*\*/g, '').trim();
    if (!law || DEICTIC.test(law) || hasDeictic(law)) continue;
    if (flat(baseOf(law)) === pageSlugFlat) { pageLaw = baseOf(law); break; }
  }
  if (!pageLaw) pageLaw = SLUG2NAME.get(name.split('__')[0]) || '';

  inTable = false; lawCol = -1; lastReal = '';
  let changed = false;
  const out = lines.map(line => {
    if (/^##\s*근거\s*조문/.test(line)) { inTable = true; lawCol = -1; lastReal = ''; return line; }
    if (inTable && /^##\s/.test(line)) { inTable = false; return line; }
    if (!inTable) return line;
    const c = cellsOf(line);
    if (!c) return line;
    const trimmed = c.map(x => x.trim());
    if (lawCol < 0) { const i = trimmed.findIndex(x => x === '법령' || x === '법령명'); if (i >= 0) lawCol = i; return line; }
    if (trimmed.every(x => /^:?-+:?$/.test(x) || x === '')) return line;   // 구분선
    const raw = c[lawCol];
    if (raw === undefined) return line;
    const law = raw.replace(/\*\*/g, '').trim();
    const m = DEICTIC.exec(law);
    if (!m) { if (law && !hasDeictic(law)) lastReal = baseOf(law); return line; }

    const kind = flat(m[1]);
    const tier = m[2] || '';
    const base = kind === '이법' ? (pageLaw || lastReal) : lastReal;
    if (!base) {
      skipped++; skips.push(path.basename(f) + ' | ' + law + ' (앞선 법 이름을 못 찾음)');
      return line;
    }
    const next = base + (tier ? ' ' + tier : '');
    c[lawCol] = raw.replace(law, next);
    fixed++; changed = true;
    if (preview.length < 15) preview.push(path.basename(f) + '  [' + law + '] → [' + next + ']');
    return '|' + c.join('|') + '|';
  });

  if (changed) {
    files++;
    if (APPLY) fs.writeFileSync(f, out.join('\n'));
  }
}

console.log(`${APPLY ? '수정 완료' : '미리보기(파일 안 고침)'} — 파일 ${files}개 · 행 ${fixed}개 · 건너뜀 ${skipped}개`);
preview.forEach(p => console.log('  ' + p));
if (skips.length) { console.log('\n건너뛴 것:'); skips.slice(0, 10).forEach(s => console.log('  ' + s)); }
