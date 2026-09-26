#!/usr/bin/env node
/**
 * V5-33 — `raw/` 를 고쳤으면 **되돌릴 수 있게 기록이 남아 있나** (2026-09-23 신설, N-5 · 3-10)
 *
 * [왜 — 규칙을 현실에 맞춘다]
 *   `raw/` 는 규약상 **불변**이라 적혀 있었지만 실제로는 **1,508파일 · 3,573회 · 417커밋** 고쳐졌다.
 *   사용자가 *"규칙을 현실에 맞춘다"* 로 확정했다(N-5). 그러면 현실의 규칙은 이것이다 —
 *   **원문은 고칠 수 있다. 단, 고친 것은 도구가 기록해 되돌릴 수 있어야 한다.**
 *   (`_touched.py` 가 이미 그 기록을 남긴다: `_dashboard/touched/<도구>_<시각>.json`)
 *
 * [실측 — 2026-09-23, 이 가지의 커밋 120개]
 *   `raw/` 를 고친 커밋 **7개** · 그중 되돌리기 기록을 같이 넣은 것 **4개**
 *   기록 없이 고친 셋:
 *     `3-37 꼬리표 제자리`(raw 28파일) · `P-14 겹친 조 머리줄`(20) · `P-7 별표 옮김`(12)
 *   ⇒ **못 지킬 규칙이 아니다.** 셋만 예외로 두고 **늘지 못하게** 막는다.
 *
 * [무엇을 재나] `origin/main` 과의 갈림점부터 지금까지,
 *   **고쳐진 `raw/` 파일** 중 **어느 되돌리기 기록에도 안 적힌 것**의 수.
 *   기준선보다 **늘면 실패**한다. 0 을 요구하지 않는다 — 옛 커밋 셋이 이미 들어 있다.
 *
 * ⚠**되돌리기 기록은 「고쳤다」의 증거이지 「옳게 고쳤다」의 증거가 아니다.**
 *   이 게이트는 *되돌릴 수 있나* 만 묻는다. 값이 맞는지는 다른 게이트들이 묻는다.
 *
 * [왜 훅이 아니라 게이트인가] 훅은 그 컴퓨터에만 있고, 사람이 `--no-verify` 로 넘긴다
 *   (이 저장소도 그렇게 쓴다). **게이트는 CI 가 부른다**(뿌리 사슬 ④).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const LEGAL = path.resolve(__dirname, '../..');
const REPO = path.resolve(LEGAL, '../../..');
const BASE = path.join(__dirname, 'baseline', 'raw_touch_guard.json');
const RAW_PREFIX = 'local_server/knowledge/legal/raw/';
const TOUCH_DIR = 'local_server/knowledge/legal/_dashboard/touched/';

function git(...args) {
    return execFileSync('git', ['-c', 'core.quotepath=false', ...args],
        { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28 });
}

/** 갈림점을 찾는다. 못 찾으면 null — 그때는 **재지 않고 넘긴다**(없는 것을 결함이라 하지 않는다). */
function mergeBase() {
    for (const ref of ['origin/main', 'main']) {
        try { return git('merge-base', ref, 'HEAD').trim(); } catch (_) { /* 다음 이름으로 */ }
    }
    return null;
}

function check() {
    const base = mergeBase();
    if (!base) return { skipped: true, reason: '`origin/main` 을 못 찾았다 — 재지 않는다' };
    const changed = git('diff', '--name-only', `${base}..HEAD`, '--', RAW_PREFIX)
        .split('\n').map((s) => s.trim()).filter(Boolean);
    const recs = git('diff', '--name-only', '--diff-filter=A', `${base}..HEAD`, '--', TOUCH_DIR)
        .split('\n').map((s) => s.trim()).filter(Boolean);
    const covered = new Set();
    for (const r of recs) {
        const p = path.join(REPO, r);
        let j;
        try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { continue; }
        for (const f of (j.files || [])) covered.add(String(f));
    }
    const uncovered = changed.filter((f) => !covered.has(f));
    return { skipped: false, base, changed: changed.length, recs: recs.length,
        covered: covered.size, uncovered };
}

function main() {
    const r = check();
    if (r.skipped) { console.log(`  ⏭️  ${r.reason}`); return 0; }
    console.log(`  \`raw/\` 를 고쳤으면 **되돌릴 수 있나** (갈림점 ${r.base.slice(0, 9)} 이후)`);
    console.log(`    고쳐진 원문 파일          ${String(r.changed).padStart(5)}`);
    console.log(`    되돌리기 기록             ${String(r.recs).padStart(5)}건 · 적힌 파일 ${r.covered}`);
    console.log(`    ❌ 어느 기록에도 없는 것  ${String(r.uncovered.length).padStart(5)}`);
    if (process.argv.includes('--list')) {
        r.uncovered.forEach((f) => console.log('     · ' + f.replace(RAW_PREFIX, '')));
    }
    const watch = { 기록없음: r.uncovered.length };
    if (process.argv.includes('--update')) {
        fs.writeFileSync(BASE, JSON.stringify(watch, null, 2) + '\n');
        console.log('  기준선을 다시 구웠다:', JSON.stringify(watch));
        return 0;
    }
    let b;
    try { b = JSON.parse(fs.readFileSync(BASE, 'utf8')); } catch (_) {
        console.log('  ⚠기준선이 없다 — `--update` 로 한 번 구워야 한다'); return 1;
    }
    if (watch.기록없음 > b.기록없음) {
        console.log(`  ❌ 늘었다: ${b.기록없음} → ${watch.기록없음}`);
        console.log('     → 원문을 **도구 없이** 고쳤다. `_touched.py` 를 쓰는 도구로 고친다(3-10).');
        console.log('     `--list` 로 어느 파일인지 본다. ⚠기준선을 다시 굽는 것으로 넘기지 않는다(G-49).');
        return 1;
    }
    console.log(watch.기록없음 < b.기록없음
        ? `  ✅ 줄었다: ${b.기록없음} → ${watch.기록없음} — \`--update\` 로 잠근다`
        : '  ✅ 기준선 그대로 — 늘지 않았다');
    return 0;
}

if (require.main === module) process.exit(main());
module.exports = { check };
