#!/usr/bin/env node
/**
 * 3-67 ③ — **원문에 번호가 없는 별표 파일의 이름에서 지어낸 번호를 뗀다**(`_별표1` → `_별표0`).
 *
 * [무엇이 문제였나] 제공처 API 가 `별표번호: "0000"`(원문에 번호가 없다)을 줄 때
 *   `admrul_fill_annex.py` 가 **`1` 을 지어내** 파일 이름에 박았다(2026-09-26 에 `0` 으로 고쳤다).
 *   이미 만들어진 것이 **107개**다. 사장님 결심 ⑥ⓑ(2026-09-24)는 「`0` 그대로 두고
 *   『원문에 번호가 없다』고 적는다」로 정했고, 이 자는 그 결심을 **이미 있는 파일에 집행**한다.
 *
 * [왜 안전한가 — 먼저 쟀다]
 *   · 위키는 그 고시의 별표를 **거의 다 「번호 없이」** 짚는다(표 행 실측 — 「(번호없음)」이 대다수).
 *     즉 어긋난 것은 **파일 이름뿐**이고, `별표0` 은 이 저장소에 이미 있는 꼴이다(15개).
 *   · 이름 충돌 **0**(바꿀 이름이 이미 있는 자리가 없다).
 *   · ★그래도 짐작하지 않는다 — **`annex_ready.js` 의 「열린다」 수를 전·후로 잰다.**
 *     줄면 되돌린다(`--revert`).
 *
 * [되돌리는 법] `_touched.py --revert` 는 `git checkout` 이라 **이름 바꾸기에는 안 듣는다**
 *   (옛 이름은 되살아나지만 새 이름이 남는다). 그래서 이 자는 옛/새 짝을 기록하고
 *   `--revert <기록파일>` 로 **이름을 되돌린다**.
 *
 * 사용법
 *   node nonum_byl_rename.js --from <nonum_byl_scan_*.json>            (미리보기)
 *   node nonum_byl_rename.js --from <...> --apply                      (바꾼다)
 *   node nonum_byl_rename.js --revert <_dashboard/touched/rename_*.json>
 */
'use strict';
const fs = require('fs');
const path = require('path');

const LEGAL = path.resolve(__dirname, '..', '..');
const RAW = path.join(LEGAL, 'raw');
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : ''; };
const FROM = arg('--from');
const REVERT = arg('--revert');
const APPLY = argv.includes('--apply');

function walk(d, out) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== '_대기') walk(p, out); }
    else if (e.isFile()) out.push(p);
  }
  return out;
}

if (REVERT) {
  const rec = JSON.parse(fs.readFileSync(REVERT, 'utf8'));
  let n = 0;
  for (const { 옛, 새 } of (rec.바꾼것 || [])) {
    const oldAbs = path.join(LEGAL, 옛);
    const newAbs = path.join(LEGAL, 새);
    if (!fs.existsSync(newAbs)) { console.log('  (없다, 건너뜀)', 새); continue; }
    if (fs.existsSync(oldAbs)) { console.log('  ★옛 이름이 이미 있다 — 손대지 않는다:', 옛); continue; }
    fs.renameSync(newAbs, oldAbs); n++;
  }
  console.log(`되돌렸다 — ${n}개`);
  process.exit(0);
}

if (!FROM) { console.error('--from <nonum_byl_scan_*.json> 이 필요하다'); process.exit(2); }
const scan = JSON.parse(fs.readFileSync(FROM, 'utf8'));
// 「원문 괄호에 숫자가 아예 없는데 우리 이름은 번호를 달았다」 목록만 쓴다.
const 대상 = new Set((scan.진짜무번호 || []).map((r) => r.파일));
const files = walk(RAW, []).filter((p) => 대상.has(path.basename(p)));

const 바꿀것 = [];
const 충돌 = [];
for (const p of files) {
  const base = path.basename(p);
  const 새base = base.replace(/_(별표|별지|서식)[0-9]+(의[0-9]+)?\.txt$/, '_$10.txt');
  if (새base === base) continue;
  const 새p = path.join(path.dirname(p), 새base);
  if (fs.existsSync(새p)) { 충돌.push([base, 새base]); continue; }
  바꿀것.push({ 옛: path.relative(LEGAL, p), 새: path.relative(LEGAL, 새p) });
}
console.log(`찾은 파일 ${files.length}개 · 바꿀 것 ${바꿀것.length}개 · 충돌 ${충돌.length}개`);
for (const [a, b] of 충돌) console.log('  ★충돌(건너뜀):', a, '→', b);
for (const x of 바꿀것.slice(0, 5)) console.log('  ', path.basename(x.옛), '→', path.basename(x.새));
if (!APPLY) { console.log('\n(미리보기다 — 바꾸려면 --apply)'); process.exit(0); }

for (const x of 바꿀것) fs.renameSync(path.join(LEGAL, x.옛), path.join(LEGAL, x.새));
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);   // YYYYMMDDHHMMSS
const OUT = path.join(LEGAL, '_dashboard', 'touched', `nonum_byl_rename_${stamp}.json`);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ 자: 'nonum_byl_rename.js', 때: new Date().toISOString(),
  바꾼것: 바꿀것 }, null, 1) + '\n');
console.log(`\n바꿨다 ${바꿀것.length}개`);
console.log(`[기록] ${path.relative(LEGAL, OUT)}`);
console.log(`[되돌리려면] node ${path.relative(process.cwd(), __filename)} --revert ${path.relative(process.cwd(), OUT)}`);
