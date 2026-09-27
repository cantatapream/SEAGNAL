#!/usr/bin/env node
// ============================================================================
// [용도] **표가 열 단위로 세로로 펼쳐진 자리**를 센다 (P-8).
//
// 무엇이 문제인가 — 이름부터 바로잡는다
//   P-8 은 「세로 쪼개짐(한 글자씩 한 줄)」로 적혀 있었다. 표본을 열어 보니 그게 아니다.
//   PDF 표를 글자로 뽑을 때 **행이 아니라 열 순서로** 나오는 바람에, 한 열의 값들이
//   통째로 세로 목록이 된 것이다. 예(선박만재흘수선기준 2071행):
//       건현                     ← 머리
//       (밀리미                  ← 머리가 두 줄로 잘리기도 한다
//       터)
//       24 26 28 … 82            ← **첫 열(길이)** 이 세로로
//       200 217 233 250 …        ← **다음 열(건현 mm)** 이 또 세로로
//   ★값은 하나도 안 빠졌는데 **행·열 짝이 사라졌다.** 그래서 이것은
//   "글자가 깨졌다"가 아니라 **"숫자를 엉뚱한 줄에 붙일 수 있다"** 는 문제다.
//   만재흘수선 건현표처럼 안전에 걸리는 표가 여기 들어 있다(위키 11쪽이 그 고시를 인용).
//
// [지금 피해] 위키가 그 수치를 옮겨 적은 자리는 확인된 것이 없다(만재흘수선 계열 확인).
//   그러나 raw 본문은 **LLM 근거자료로 그대로 넘어간다**(P-19: 평균 123,749자 무절단).
//   즉 사람이 옮겨 적지 않아도 모델은 이 깨진 표를 본다.
//
// [왜 여기서 고치지 않나] 되살리려면 **원본 표의 모양**이 있어야 한다(PDF·이미지).
//   짝을 넘겨짚어 복원하면 그것이 바로 환각이다. 그래서 지금은 **세기만 한다** —
//   늘지 않는 것을 지키고, 복원은 원본을 손에 넣은 뒤에 한다(P-13·3-25 와 함께).
//
// [세는 법] 다듬은 길이가 2자 이하인 줄이 연속 6줄 이상이면 한 덩이로 본다.
//   괘선(─│┏…)만 있는 줄은 표의 테두리이므로 세지 않는다.
//
// [쓰는 법]  node col_split_scan.js            사람이 보는 표
//            node col_split_scan.js --gate     기준선 대조(늘면 exit 1)
//            node col_split_scan.js --update   기준선 재생성(줄었을 때만)
//            node col_split_scan.js --list     덩이를 전부 찍는다
//
// [연계] `scripts/refactor/verify_all.sh` V5-20 · P-8 · P-13(이미지) · 3-25
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');

const LEGAL = path.resolve(__dirname, '../..');
const RAW = path.join(LEGAL, 'raw');
const BASE = path.join(__dirname, 'baseline/col_split.json');
const RUN = 6;
const RULE_ONLY = /^[\s─━│┃┏┓┗┛┠┨┯┷┿╋┼├┤┌┐└┘=+|.-]+$/;

function walk(dir, out) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && p.endsWith('.txt')) out.push(p);
  }
  return out;
}

const blocks = [];
for (const f of walk(RAW, [])) {
  let lines;
  try { lines = fs.readFileSync(f, 'utf8').split('\n'); } catch { continue; }
  let run = 0, start = 0;
  for (let i = 0; i <= lines.length; i++) {
    const t = (lines[i] || '').trim();
    const shortish = t.length > 0 && t.length <= 2 && !RULE_ONLY.test(t);
    if (shortish) { if (run === 0) start = i; run++; continue; }
    if (run >= RUN) blocks.push({ f: f.slice(RAW.length + 1), at: start + 1, n: run });
    run = 0;
  }
}
const files = new Set(blocks.map(b => b.f));
const totalLines = blocks.reduce((a, b) => a + b.n, 0);
const cur = { 덩이: blocks.length, 줄: totalLines, 파일: files.size };

const argv = process.argv.slice(2);
if (argv.includes('--list')) {
  blocks.sort((a, b) => b.n - a.n).forEach(b => console.log(`${String(b.n).padStart(4)}줄  ${b.f}:${b.at}`));
  process.exit(0);
}
if (argv.includes('--update')) {
  fs.mkdirSync(path.dirname(BASE), { recursive: true });
  fs.writeFileSync(BASE, JSON.stringify({ 기준일: new Date().toISOString().slice(0, 10), ...cur }, null, 2) + '\n');
  console.log(`  기준선을 다시 구웠다 — ${JSON.stringify(cur)}`);
  process.exit(0);
}

const byFile = {};
for (const b of blocks) byFile[b.f] = (byFile[b.f] || 0) + b.n;
const top = Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 5);
console.log(`  표가 열 단위로 펼쳐진 덩이 ${cur.덩이}개 · 줄 ${cur.줄} · 파일 ${cur.파일}개`);
for (const [f, n] of top) console.log(`    ${String(n).padStart(5)}줄  ${f}`);
console.log('    (전체 목록: --list · 되살리기는 원본 표가 있어야 한다 → P-13·3-25)');

if (!argv.includes('--gate')) process.exit(0);
let base = null;
if (fs.existsSync(BASE)) { try { base = JSON.parse(fs.readFileSync(BASE, 'utf8')); } catch { base = null; } }
if (!base) { console.log('  ⚠기준선이 없다 — --update 로 먼저 구워라'); process.exit(1); }
console.log(`  기준선(${base.기준일}) — 덩이 ${base.덩이} · 줄 ${base.줄} · 파일 ${base.파일}`);
if (cur.줄 > base.줄) {
  console.log(`  ❌ 늘었다: 줄 ${base.줄} → ${cur.줄}`);
  console.log('     새로 들어온 원문이 같은 방식으로 깨져 들어왔다는 뜻이다 — 수집 쪽을 보라.');
  process.exit(1);
}
console.log('  ✅ 기준선 대비 늘지 않았다');
process.exit(0);
