#!/usr/bin/env node
// ============================================================================
// [용도] 「근거 조문」 표의 **법령 칸이 어느 법인지 말하고 있는가** (P-12 · 3-23).
//
// 왜 있나
//   챗봇은 개념 페이지의 `## 근거 조문` 표에서 근거를 만든다. 그 표의 법령 칸이
//   **`시행령`·`시행규칙` 한 낱말뿐**이면 세 가지가 한꺼번에 무너진다 —
//     ① 화면에 **어느 법인지 모를 근거**가 뜬다
//     ② 눌러도 **원문이 안 열린다**(어느 폴더를 볼지 모른다)
//     ③ **연락처가 안 붙는다**(소관부서를 법으로 찾는다)
//   2026-09-22 실측 **163행 · 48쪽**. 163 전부 raw 로 확인해 보니 **그 쪽의 법, 그 계층**에
//   그 조·별표가 실제로 있었다(넘겨짚은 것이 아니다) — 그래서 법 이름을 채워 0 으로 만들었다.
//
// [무엇을 재나] `legal_retriever.extractCitationChain` — **챗봇이 쓰는 그 파서**로 행을 읽고,
//   법령 칸이 계층 낱말 하나뿐인 행을 센다. 여기서 정규식을 베껴 쓰면 그 사본이 곧 옛 규칙이 된다(L-136).
//
// [판정] **0 을 요구한다.** 고치는 데 네트워크도 사람 판단도 필요 없다 —
//   그 쪽이 어느 법의 쪽인지는 파일 이름이 이미 말하고 있고, 원문 대조로 확인할 수 있다.
//
// [쓰는 법]  node law_cell_named.js          사람이 보는 표
//            node law_cell_named.js --gate   0 이 아니면 exit 1
//            node law_cell_named.js --list   그런 행을 다 찍는다
//
// [연계] `scripts/refactor/verify_all.sh` V5-22 · `services/legal_retriever.js extractCitationChain`
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const R = require('../../../../services/legal_retriever.js');

const WIKI = path.resolve(__dirname, '../../wiki');
// 계층 이름 하나만 덩그러니 있는 꼴. `이 법`·`동법`처럼 가리키는 말도 같은 병이다.
const BARE = /^(시행령|시행규칙|대통령령|해양수산부령|총리령|법률|이 법|동법|같은 법|본법)$/;

function walk(dir, out) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && p.endsWith('.md')) out.push(p);
  }
  return out;
}

let rows = 0;
const bad = [];
for (const f of walk(WIKI, [])) {
  let chain = [];
  try { chain = R.extractCitationChain(fs.readFileSync(f, 'utf8')) || []; } catch { continue; }
  for (const c of chain) {
    rows++;
    const law = String(c.law || c.법령 || '').replace(/\*\*/g, '').replace(/[「」]/g, '').trim();
    if (BARE.test(law)) bad.push({ f: f.slice(WIKI.length + 1), law, art: String(c.article || c.조문 || '').slice(0, 30) });
  }
}
const argv = process.argv.slice(2);
if (argv.includes('--list')) { bad.forEach(b => console.log(`${b.law}\t${b.art}\t${b.f}`)); process.exit(0); }

const pages = new Set(bad.map(b => b.f));
console.log(`  근거 조문 행 ${rows}개`);
if (!bad.length) console.log('  ✅ 법령 칸이 계층 낱말 하나뿐인 행 0');
else {
  console.log(`  ❌ 법령 칸이 계층 낱말 하나뿐인 행 ${bad.length}  (쪽 ${pages.size})`);
  console.log('     → 어느 법인지 모를 근거가 뜨고, 눌러도 안 열리고, 연락처도 안 붙는다.');
  console.log('     고치는 법: 그 쪽의 법 이름을 앞에 붙인다(`시행령` → `○○법 시행령`).');
  console.log('     ⚠붙이기 전에 **그 법 그 계층 원문에 그 조가 있는지** 먼저 확인할 것.');
  for (const b of bad.slice(0, 8)) console.log(`       ${b.law}  ${b.art}  ${b.f}`);
  if (bad.length > 8) console.log(`       … 전체는 --list`);
}
if (argv.includes('--gate') && bad.length) process.exit(1);
process.exit(0);
