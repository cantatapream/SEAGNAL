#!/usr/bin/env node
// ============================================================================
// [용도] **계층 접두가 없는 별표 파일**(`별표/별표1.txt`·`별표/서식3.txt`)이 실제로 열리는지 센다.
//
// 왜 있나 (2026-09-22 신설, 2-7 · P-3 · G-8/G-9 의 파일 단위 절반)
//   `article_text.js` 의 ③경로는 계층 접두가 없는 별표 파일을 **파일 안 선언줄**로 검증한다
//   (`bylDeclMatches`). 파일명 번호와 내용 번호가 어긋난 파일이 있어 그냥 믿으면 **다른 별표를
//   그 번호인 것처럼** 보여주기 때문이다(환각 0 위반).
//   그런데 **그 판정이 맞는지 재는 것이 하나도 없었다.** 그래서 종전 규칙이
//   `시행규칙|시행령` 만 받아들이는 바람에 「선박에서의 오염방지에 관한 규칙」(tier:1)의
//   별표가 **90개 중 0개** 열리는데도 게이트는 전부 초록이었다 — ③"게이트가 안 재는 자리도
//   죽는다" 그대로다.
//
// [무엇을 재나] raw 의 `*/별표/(별표|서식|별지)N.txt` 를 전수로 훑어
//   ①선언줄을 읽어 계층·종류·번호를 뽑고 ②본문이 실제로 있는지 보아
//   **열린다 / 본문없음(삭제·이동) / 번호어긋남 / 선언못읽음** 넷으로 가른다.
//   ⚠판정은 **운영 코드를 그대로 호출**한다(`article_text.bylDeclLine`·`parseBylDecl`·
//     `hasBylBody`). 여기서 정규식을 베껴 쓰면 그 사본이 곧 옛 규칙으로 굳는다(L-136).
//
// [판정] `--gate` 를 주면 기준선과 견준다.
//   · **열리는 파일이 줄면 실패** (고치다 되레 닫히는 것을 막는다)
//   · **번호 어긋남이 늘면 실패** (수집이 또 `의M` 을 흘리는 것을 막는다)
//   0 을 요구하지 않는다 — 번호 어긋남 178개는 수집 때 `별표18의2` 의 `의2` 가 떨어져
//   `별표18.txt` 로 저장된 것들이라 **네트워크 재수집**이 필요하다(3-34).
//
// [쓰는 법]
//   node byl_bare_ready.js            사람이 보는 표
//   node byl_bare_ready.js --gate     기준선 대조(실패 시 exit 1)
//   node byl_bare_ready.js --update   기준선 재생성(좋아졌을 때만)
//   node byl_bare_ready.js --list 번호어긋남   그 갈래의 파일을 다 찍는다
//
// [연계] `scripts/refactor/verify_all.sh` V5-21a · `article_text.js` resolveRefs ③
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('../../../../services/article_text.js');

const LEGAL = path.resolve(__dirname, '../..');
const RAW = path.join(LEGAL, 'raw');
const BASE = path.join(__dirname, 'baseline/byl_bare_ready.json');
// 계층 접두가 없는 파일명만 본다. `시행령_별표1.txt` 는 파일명에 계층·번호가 다 있어 이 경로를 안 탄다.
const BARE = /^(별표|서식|별지)(\d+(?:의\d+)?)\.txt$/;

function walk(dir, out) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && p.endsWith('.txt') && p.includes(`${path.sep}별표${path.sep}`)) out.push(p);
  }
  return out;
}

const groups = { 열린다: [], 본문없음: [], 번호어긋남: [], 선언못읽음: [] };
for (const f of walk(RAW, [])) {
  const m = BARE.exec(path.basename(f));
  if (!m) continue;
  const rel = f.slice(RAW.length + 1);
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
  const d = A.parseBylDecl(A.bylDeclLine(text));
  if (!d) { groups.선언못읽음.push(rel); continue; }
  const want = { type: m[1] === '별표' ? '별표' : '서식', num: m[2] };
  if (d.type !== want.type || d.num !== want.num) {
    groups.번호어긋남.push(`${rel}   파일명=${want.type}${want.num}  내용=${d.type}${d.num}`);
    continue;
  }
  (A.hasBylBody(text) ? groups.열린다 : groups.본문없음).push(rel);
}

const cur = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length]));
const total = Object.values(cur).reduce((a, b) => a + b, 0);

const argv = process.argv.slice(2);
const listAt = argv.indexOf('--list');
if (listAt >= 0) {
  const g = argv[listAt + 1];
  if (!groups[g]) { console.error(`갈래 이름이 아니다: ${g} (${Object.keys(groups).join('·')})`); process.exit(2); }
  groups[g].forEach(x => console.log(x));
  process.exit(0);
}

if (argv.includes('--update')) {
  fs.mkdirSync(path.dirname(BASE), { recursive: true });
  fs.writeFileSync(BASE, JSON.stringify({ 기준일: new Date().toISOString().slice(0, 10), 총계: total, ...cur }, null, 2) + '\n');
  console.log(`  기준선을 다시 구웠다 — ${JSON.stringify(cur)}`);
  process.exit(0);
}

let base = null;
if (fs.existsSync(BASE)) { try { base = JSON.parse(fs.readFileSync(BASE, 'utf8')); } catch { base = null; } }

console.log(`  계층 접두 없는 별표 파일 ${total}개`);
console.log(`    ✅ 열린다        ${String(cur.열린다).padStart(5)}   선언줄이 파일명과 맞고 본문도 있다`);
console.log(`    ·  본문없음      ${String(cur.본문없음).padStart(5)}   "[별표 7] 삭제" 꼴 — 원문이 있는 척하지 않는다(정상)`);
console.log(`    ❌ 번호어긋남    ${String(cur.번호어긋남).padStart(5)}   파일명 번호 ≠ 내용 번호 (수집 때 "의M" 이 떨어진 것) → 3-34`);
console.log(`    ❌ 선언못읽음    ${String(cur.선언못읽음).padStart(5)}   머리에서 [별표 N] 꼴을 못 찾았다`);

if (!argv.includes('--gate')) process.exit(0);
if (!base) { console.log('  ⚠기준선이 없다 — --update 로 먼저 구워라'); process.exit(1); }

const bad = [];
if (cur.열린다 < base.열린다) bad.push(`열리는 파일이 줄었다: ${base.열린다} → ${cur.열린다}`);
if (cur.번호어긋남 > base.번호어긋남) bad.push(`번호 어긋남이 늘었다: ${base.번호어긋남} → ${cur.번호어긋남}`);
if (cur.선언못읽음 > base.선언못읽음) bad.push(`선언 못 읽는 것이 늘었다: ${base.선언못읽음} → ${cur.선언못읽음}`);
console.log(`  기준선(${base.기준일}) — 열린다 ${base.열린다} · 번호어긋남 ${base.번호어긋남} · 선언못읽음 ${base.선언못읽음}`);
if (bad.length) { bad.forEach(b => console.log(`  ❌ ${b}`)); process.exit(1); }
console.log('  ✅ 기준선 대비 나빠지지 않았다');
process.exit(0);
