// D1 다시 읽기 — 다음 묶음의 args 를 만든다(reread_workflow.js 에 붙여 넣을 꼴).
//
// 대상: status 가 draft/canonical 인데 장부(_dashboard/reread/verdicts.jsonl)에 「본문 전체를 읽은 PASS」가 없거나,
//       마지막 기록이 「PASS · 지금 본문해시」가 아닌 쪽(§5-D ⓖ 규칙 2: D1 다시 읽기는 범위 「전체」만 인정 —
//       변경분 PASS 만 있는 쪽은 아직 대상이다). human_list.md 에 오른 쪽(사람 판단 대기)은 뺀다(--include-human 이면 넣는다).
// --promotable: draft 인데 이미 전체 PASS·해시 일치라 다시 읽을 것 없이 승격만 남은 쪽을 따로 찍는다.
// 순서: 1차 기계 대조 신호(v1)가 있는 쪽 먼저, 그 안에서는 큰 쪽 먼저.
// 쓰는 법(저장소 루트에서):
//   node local_server/knowledge/legal/_dashboard/reread/tools/make_queue.js --status canonical --list > <tmp>/names.json
//   python3 local_server/knowledge/legal/_dashboard/loop/draft_verify1.py <tmp>/names.json --out <tmp>/v1.json   ← 1차(선택이지만 권장)
//   node local_server/knowledge/legal/_dashboard/reread/tools/make_queue.js --status canonical --v1 <tmp>/v1.json \
//        --round D1-R01 --date 2026-11-03 --size 30 --tmp <tmp>/reread_tmp --out <tmp>/args_D1-R01.json [--skip 30]
//   ⚠ --list 출력은 크다(7만 자 넘음) — 파이프보다 파일로 받는다(> names.json).
//   → args 파일 내용을 Workflow 의 args 에 그대로 붙여 넣는다.
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('../../loop/reread_ledger.js');
const LEGAL = path.resolve(__dirname, '..', '..', '..');
const W = path.join(LEGAL, 'wiki') + '/';
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const status = arg('--status', 'canonical');

const rows = L.readLedger();
const lastBy = {};
for (const r of rows) lastBy[r['쪽']] = r;
let human = '';
try { human = fs.readFileSync(path.join(LEGAL, '_dashboard/reread/human_list.md'), 'utf8'); } catch (_) {}
const inHuman = argv.includes('--include-human') ? new Set() : new Set([...human.matchAll(/^## (\S+\.md)/gm)].map(m => m[1]));
const fullPass = new Set(rows.filter(r => r['판정'] === 'PASS' && r['범위'] === '전체').map(r => r['쪽']));
const promotable = [];

const pages = [];
(function walk(d) {
  for (const f of fs.readdirSync(W + d)) {
    const p = d + f;
    if (fs.statSync(W + p).isDirectory()) { walk(p + '/'); continue; }
    if (!f.endsWith('.md') || f.startsWith('_')) continue;
    const t = fs.readFileSync(W + p, 'utf8');
    const st = (t.match(/^status:\s*(\S+)/m) || [])[1];
    if (st !== status) continue;
    const last = lastBy[p];
    const cur = last && last['판정'] === 'PASS' && last['본문해시'] === L.bodyHash(t);
    if (cur && last['범위'] === '전체') { if (st === 'draft') promotable.push(p); continue; }
    if (cur && fullPass.has(p)) continue;   // 전체 PASS 뒤에 변경분 PASS 가 이어진 쪽은 끝난 것으로 본다
    if (inHuman.has(p)) continue;
    pages.push({ p, t });
  }
})('');

function emit(s) { process.stdout.write(s + '\n'); }
if (argv.includes('--promotable')) { emit(JSON.stringify(promotable)); }
else if (argv.includes('--list')) { emit(JSON.stringify(pages.map(x => x.p.replace(/\.md$/, '').replace(/^concepts\//, '')))); }
else main();
function main() {

let v1 = {};
if (arg('--v1')) {
  for (const r of JSON.parse(fs.readFileSync(arg('--v1'), 'utf8'))) {
    const name = r.file || r.name || r.law;
    if (name) v1[name.replace(/^concepts\//, '')] = r.why || [];
  }
}
const cut = (x) => (x.length <= 16 ? x : x.slice(0, 16));
function groups(t) {
  const parts = t.split(/^## /m).slice(1).filter(s => !s.startsWith('변경 이력'));
  const secs = parts.map(s => [s.split('\n')[0].trim(), s.length]);
  if (!secs.length) return [];
  const tot = secs.reduce((a, b) => a + b[1], 0);
  let k = secs.length >= 2 ? Math.max(2, Math.min(3, Math.round(tot / 9000))) : 1;   // §5-D ⓗ: 2~3 묶음
  k = Math.min(k, secs.length);
  const tgt = tot / k; const g = []; let cur = []; let acc = 0;
  for (const [h, n] of secs) {
    cur.push(h); acc += n;
    if (acc >= tgt * (g.length + 1) && g.length < k - 1) { g.push(cur); cur = []; }
  }
  if (cur.length) g.push(cur);
  return g.map(z => [cut(z[0]), cut(z[z.length - 1])]);
}
const q = pages.map(({ p, t }) => {
  const key = p.replace(/\.md$/, '');
  const sig = v1[key.replace(/^concepts\//, '')] || [];
  return { f: key, v1: sig.map(s => s.slice(0, 60)), g: groups(t), size: t.length };
});
q.sort((a, b) => (b.v1.length ? 1 : 0) - (a.v1.length ? 1 : 0) || b.size - a.size);
const skip = +arg('--skip', 0); const size = +arg('--size', 30);
const pick = q.slice(skip, skip + size).map(({ f, v1, g }) => ({ f, v1, g }));
if (!arg('--round') || !arg('--date') || !arg('--tmp')) { console.error('--round · --date(KST, 예 2026-11-03) · --tmp 를 꼭 준다'); process.exit(2); }
const out = { round: arg('--round'), date: arg('--date'), tmp: arg('--tmp'), status, pages: pick };
const s = JSON.stringify(out);
if (arg('--out')) fs.writeFileSync(arg('--out'), s);
console.error(`대상 ${q.length}쪽(${status}) · 이번 묶음 ${pick.length}쪽 · args ${s.length}자`);
if (!arg('--out')) emit(s);
}
