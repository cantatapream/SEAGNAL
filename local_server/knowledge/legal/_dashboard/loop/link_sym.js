/**
 * link_sym.js — **품질 4축 ④연결** 게이트. "자료끼리 신경망으로 이어져 있나"를 센다.
 *
 * [왜 있나 — 2026-08-20 사용자 확정 H-45]
 * ④연결 축은 게이트가 **절반만** 있었다. `xref_check.py`(V5-2)는 **깨진 링크**(가리키는 파일이
 * 없는 것)만 보고, **한쪽만 걸린 링크**(A→B 는 있는데 B→A 가 없는 것)는 아무도 안 셌다.
 * 이정표가 한 방향으로만 나 있으면 챗봇이 반대쪽에서 그 문서를 못 편다.
 *
 * ⚠**200 이라는 수는 실제 값이 아니었다** — `lint_index.py` 가 `asym_link_gaps: linkgap[:200]` 로
 *   **목록을 200개에서 자른 것**이고, 그 잘린 목록의 길이를 계기판이 그대로 읽고 있었다.
 *   그래서 이 도구는 **자르지 않고 전부 센다.**(L-159 계열 — 잘린 목록을 전체로 읽지 않는다)
 *
 * [무엇을 세나 — 정의는 `lint_index.py` 의 것을 그대로 쓴다(따로 만들면 어긋난다, L-136)]
 *   위키 페이지의 `[[링크]]` 중 **대상 파일이 실재하는데 역링크가 없는 것**.
 *   ⚠모든 링크가 대칭이어야 하는 것은 아니다(개념→법령허브처럼 한 방향이 자연스러운 것도 있다).
 *     그래서 이 게이트는 **0을 요구하지 않고 기준선보다 늘지 않는 것**만 본다.
 *
 * [쓰는 법]
 *   node link_sym.js                    현황
 *   node link_sym.js --examples         표본 20개
 *   node link_sym.js --save <경로>       기준선 저장
 *   node link_sym.js --base <경로> --gate  기준선보다 늘면 실패(verify_all.sh V5-10)
 * [연계] ← _dashboard/index.json → verify_all.sh V5-10.  ⚠읽기 전용.
 */
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const LEGAL = path.resolve(HERE, '..', '..');
const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : ''; };

const idx = JSON.parse(fs.readFileSync(path.join(LEGAL, '_dashboard', 'index.json'), 'utf8'));
const pages = idx.pages || idx;
const flat = s => String(s).replace(/\s+/g, '');

const norm = new Map();                       // 공백 뺀 이름 → 실제 파일명
for (const p of pages) norm.set(flat(p.file), p.file);
const linkmap = new Map();                    // 파일 → 그 페이지가 거는 링크(공백 뺀 이름)
for (const p of pages) linkmap.set(p.file, new Set((p.links || []).map(flat)));

const gaps = [];
for (const p of pages) {
  for (const l of (p.links || [])) {
    const tgt = norm.get(flat(l));
    if (!tgt) continue;                       // 깨진 링크는 V5-2 소관
    if (tgt === p.file) continue;             // 자기 자신
    const back = linkmap.get(tgt);
    if (back && back.has(flat(p.file))) continue;
    gaps.push({ from: p.file, to: tgt });
  }
}

// 어느 쪽으로 쏠렸나 — 역링크를 가장 많이 못 받은 페이지
const byTarget = new Map();
for (const g of gaps) byTarget.set(g.to, (byTarget.get(g.to) || 0) + 1);
const top = [...byTarget.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

console.log(`\n── ④연결 — 한쪽만 걸린 링크(역링크 없음) ──`);
console.log(`  페이지 ${pages.length}장 · 실재 대상 링크 중 역링크 없는 것  ${gaps.length.toLocaleString()}건`);
console.log(`  ※ 모든 링크가 대칭일 필요는 없다(개념→법령허브 등). 게이트는 0이 아니라 **기준선보다 늘지 않는 것**을 본다.`);
console.log(`\n  역링크를 가장 많이 못 받은 페이지`);
for (const [f, n] of top) console.log(`    ${String(n).padStart(4)}건  ${f}`);

if (argv.includes('--examples')) {
  console.log(`\n  표본 20개`);
  for (const g of gaps.slice(0, 20)) console.log(`    ${g.from}\n      → ${g.to}  (역링크 없음)`);
}

if (arg('--save')) {
  fs.writeFileSync(path.resolve(HERE, arg('--save')), JSON.stringify({ count: gaps.length, pages: pages.length, gaps }, null, 1));
  console.log(`\n기준선 저장: ${arg('--save')} (${gaps.length}건)`);
}
if (argv.includes('--gate')) {
  const bp = arg('--base');
  if (!bp || !fs.existsSync(path.resolve(HERE, bp))) { console.log('\n  ⏭️  기준선이 없어 게이트를 건너뜁니다(--base 로 지정).'); process.exit(0); }
  const base = JSON.parse(fs.readFileSync(path.resolve(HERE, bp), 'utf8'));
  if (gaps.length > base.count) { console.log(`\n  ❌ 한쪽만 걸린 링크 ${gaps.length}건 — 기준선(${base.count})보다 늘었다`); process.exit(1); }
  console.log(`\n  ✅ 한쪽만 걸린 링크 ${gaps.length}건 — 기준선(${base.count}) 이하${gaps.length < base.count ? `  (${gaps.length - base.count})` : ''}`);
}
