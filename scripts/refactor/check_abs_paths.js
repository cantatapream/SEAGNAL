#!/usr/bin/env node
// ============================================================================
// [용도] 실행 코드에 **그 컴퓨터에서만 통하는 절대경로**(`/home/user/…`)가 박혀 있는지 센다.
//
// 왜 있나 (2026-09-22 신설, G-31)
//   같은 사고가 **세 번** 났다.
//     ①2026-09-10 — 개정탐지 스크립트가 `/home/user/SEAGNAL/…` 를 박고 있어 프로덕션
//       컨테이너(`/app`)에서 baseline 을 못 열고 종료코드 1 로 죽었다.
//       **그동안 실서비스에서 한 번도 결과를 낸 적이 없었다.**
//     ②2026-09-18 — 색인 재생성(`lint_index.py`·`lint_build.py`)을 CI 로 옮기려 하니
//       같은 병이 있었다(L-289). 그때 교훈까지 적었다 —
//       *"이미 있는 스크립트를 자동화에 태울 때는 먼저 다른 폴더에서 한 번 돌려 본다."*
//     ③2026-09-22 — 그 교훈을 **아무도 읽지 않았고 아무것도 재지 않았다.** 게이트 7개
//       (V5-3·V5-4×2·V5-5·V5-7·V5-8·V5-11)가 `/home/user/SEAGNAL/local_server/services/…`
//       를 require 하고 있어, 깃허브 CI 에서 **진단 한 줄 없이 전부 죽었다**(run #27).
//       챗봇 답변 품질을 재는 게이트가 통째로 **한 대의 컨테이너 밖에서는 안 돌고 있었다.**
//
//   ①→②→③ 이 이 저장소의 뿌리 사슬 그대로다 —
//     규칙은 있었다(L-289) → 코드가 안 읽는다 → 읽지 않는 규칙은 죽는다.
//   그래서 교훈을 한 줄 더 적는 대신 **세는 것**을 만든다.
//
// [무엇을 재나] `.js`·`.py`·`.sh` 안의 `/home/user/` — **주석 줄은 뺀다**(이 파일처럼
//   사고 경위를 적어 둔 설명까지 세면 고칠수록 숫자가 올라간다).
// [판정] 기준선(`baseline/abs_path_baseline.json`)보다 **늘어나면 실패**한다. 0 을 요구하지
//   않는 이유는 한 번 쓰고 버린 라운드 스크립트가 아직 많아서다(2026-09-22 실측 **파일 89개 · 자리 119곳**).
//   줄이는 것은 따로 하고, 이 검사는 **다시 늘지 않는 것**만 지킨다.
// [고치는 법] 절대경로 대신 자기 파일 위치 기준으로 잡는다 —
//   js  : require('../../services/x.js') · path.resolve(__dirname, '…')
//   py  : os.path.dirname(os.path.abspath(__file__))
//   sh  : "$(cd "$(dirname "$0")" && pwd)"
// [기준선 갱신] 줄였을 때만 `--update` 로 다시 굽는다(늘리는 방향으로는 쓰지 말 것).
//
// [연계] `scripts/refactor/verify_all.sh` V2-b · `.githooks/pre-commit` static_gate
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const BASE = path.join(__dirname, 'baseline/abs_path_baseline.json');
const NEEDLE = '/home/user/';
const SKIP = ['node_modules', '.git', 'archive', '_legacy', 'apk_build', 'android'];
// ⚠자기 자신은 뺀다 — 이 파일에서 그 문자열은 **찾는 대상**이지 경로가 아니다.
//   (2026-09-22: 이 검사를 만들자마자 첫 커밋에서 자기를 잡았다. L-210 과 같은 일이
//    또 났다 — "검사를 만들면 그 검사가 나를 먼저 잡는다".)
const SELF = 'scripts/refactor/check_abs_paths.js';

/** 그 줄이 주석인가 — 설명까지 세면 고칠수록 숫자가 올라간다. */
function isComment(line, ext) {
  const t = line.trim();
  if (ext === '.py' || ext === '.sh') return t.startsWith('#');
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

function listFiles() {
  // git 이 아는 파일만 본다 — 작업 중 생긴 임시물까지 세면 숫자가 흔들린다.
  const out = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  return out.split('\0').filter(f =>
    /\.(js|py|sh)$/.test(f) && f !== SELF &&
    !SKIP.some(s => f === s || f.startsWith(s + '/') || f.includes('/' + s + '/')));
}

function scan() {
  const hits = {};
  for (const rel of listFiles()) {
    const abs = path.join(ROOT, rel);
    let text;
    try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    if (!text.includes(NEEDLE)) continue;
    const ext = path.extname(rel);
    let n = 0;
    for (const line of text.split('\n')) {
      if (!line.includes(NEEDLE)) continue;
      if (isComment(line, ext)) continue;
      n++;
    }
    if (n > 0) hits[rel] = n;
  }
  return hits;
}

const argv = process.argv.slice(2);
const cur = scan();
const total = Object.values(cur).reduce((a, b) => a + b, 0);

if (argv.includes('--update')) {
  fs.mkdirSync(path.dirname(BASE), { recursive: true });
  const sorted = {};
  for (const k of Object.keys(cur).sort()) sorted[k] = cur[k];
  fs.writeFileSync(BASE, JSON.stringify({ 기준일: new Date().toISOString().slice(0, 10), 총계: total, 파일: sorted }, null, 2) + '\n');
  console.log(`  기준선을 다시 구웠다 — 파일 ${Object.keys(cur).length}개 · 자리 ${total}곳`);
  process.exit(0);
}

let base = { 총계: 0, 파일: {} };
if (fs.existsSync(BASE)) base = JSON.parse(fs.readFileSync(BASE, 'utf8'));

const worse = [];
for (const [f, n] of Object.entries(cur)) {
  const was = base.파일[f] || 0;
  if (n > was) worse.push(`${f}  ${was} → ${n}`);
}
const gone = Object.keys(base.파일).filter(f => !(f in cur));

console.log(`  실행 코드(.js·.py·.sh)에 박힌 \`${NEEDLE}\` — 파일 ${Object.keys(cur).length}개 · 자리 ${total}곳`);
console.log(`  기준선(${base.기준일 || '없음'}) — 파일 ${Object.keys(base.파일).length}개 · 자리 ${base.총계}곳`);
if (gone.length) console.log(`  ↓ 없어진 파일 ${gone.length}개 (좋아진 것)`);

if (worse.length) {
  console.log(`  ❌ 늘어난 자리 ${worse.length}곳 — 여기는 **그 컴퓨터 밖에서는 안 돈다**`);
  for (const w of worse) console.log(`     · ${w}`);
  console.log('     고치는 법: js `require(\'../상대경로\')`·`path.resolve(__dirname, …)` /');
  console.log('                py `os.path.dirname(os.path.abspath(__file__))` /');
  console.log('                sh `"$(cd "$(dirname "$0")" && pwd)"`');
  process.exit(1);
}
console.log('  ✅ 기준선 대비 늘지 않았다');
process.exit(0);
