/**
 * V5-35 — 위키 표준 절이 있나 (2026-09-24 신설, 3-4)
 *
 * [왜] 표준 절 목록은 `06_STANDARD_SECTIONS.md` 에 **글로** 정해져 있었다(Q-3, 8개 확정).
 *   그런데 **그것을 읽는 검사가 없었다.** 뿌리 사슬 ③·⑤ 그대로다 —
 *   게이트가 안 재는 자리는 죽고, 새 표준은 그것을 읽는 코드가 먼저 있어야 산다.
 *   3-5 가 이름을 `## 근거 조문` 하나로 모았으니(447쪽) **이제 걸 수 있다.**
 *
 * [세는 법] 규칙은 `_dashboard/section_rules.json` 한 곳에 있고 이 파일은 **그것을 읽기만** 한다(L-136).
 *   ★두 가지를 **따로** 센다(뿌리 사슬 ⑥):
 *     · 없다   — `startsWith` 로도 없다. **진짜 빈 것**(→ 3-6 이 채운다)
 *     · 꼬리표 — 있는데 이름에 꼬리가 붙었다. 소비자는 `startsWith` 로 읽으니 **깨진 게 아니다**
 *   둘을 한 통에 넣으면 「89개」가 되고, 갈라 보면 「없다 56 · 꼬리표 33」이다.
 *
 * [연계] ← `_dashboard/section_rules.json` · 기준선 `_dashboard/loop/baseline/section_ready.json`
 *        → `verify_all.sh` V5-35 · 시험 `local_server/scripts/test_section_ready.js`
 * 사용법: node section_ready.js [--list] [--gate] [--update]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const LEGAL = path.resolve(HERE, '..', '..');
const WIKI = path.join(LEGAL, 'wiki');
const RULES = JSON.parse(fs.readFileSync(path.join(LEGAL, '_dashboard', 'section_rules.json'), 'utf8'));
const BASE_FILE = path.join(HERE, 'baseline', 'section_ready.json');

function heads(text) {
  return text.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.replace(/\s+$/, ''));
}

function scan() {
  const none = [];
  const tailed = [];
  let pages = 0;
  for (const kind of Object.keys(RULES['필수'])) {
    const dir = path.join(WIKI, kind);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      if (!f.endsWith('.md')) continue;
      pages++;
      const hs = heads(fs.readFileSync(path.join(dir, f), 'utf8'));
      for (const want of RULES['필수'][kind]) {
        const exact = hs.some((h) => h === want);
        const pre = hs.some((h) => h.startsWith(want));
        if (!pre) none.push({ kind, f, want });
        else if (!exact) tailed.push({ kind, f, want, got: hs.find((h) => h.startsWith(want)) });
      }
    }
  }
  return { pages, none, tailed };
}

const r = scan();
const argv = process.argv.slice(2);
console.log(`  표준 절을 봐야 하는 쪽 ${r.pages}개 (뜻: \`section_rules.json\` 의 「필수」만 · 조건부·자유는 안 본다)`);
console.log(`    ❌ 없다     ${String(r.none.length).padStart(4)}   앞가지로도 없다 — 진짜 빈 것(3-6 이 채운다)`);
console.log(`    ⚠ 꼬리표   ${String(r.tailed.length).padStart(4)}   있는데 이름에 꼬리가 붙었다 — 소비자는 startsWith 로 읽으니 **깨진 건 아니다**`);

const byKind = (rows) => {
  const m = {};
  for (const x of rows) m[`${x.kind} ${x.want}`] = (m[`${x.kind} ${x.want}`] || 0) + 1;
  return m;
};
if (argv.includes('--list')) {
  console.log('\n  ── 없다 ──');
  for (const [k, n] of Object.entries(byKind(r.none)).sort((a, b) => b[1] - a[1])) console.log(`     ${String(n).padStart(4)}  ${k}`);
  for (const x of r.none.slice(0, 40)) console.log(`       · ${x.kind}/${x.f}  ← ${x.want}`);
  console.log('\n  ── 꼬리표 ──');
  for (const [k, n] of Object.entries(byKind(r.tailed)).sort((a, b) => b[1] - a[1])) console.log(`     ${String(n).padStart(4)}  ${k}`);
  for (const x of r.tailed.slice(0, 20)) console.log(`       · ${x.kind}/${x.f}  ← ${x.got}`);
}

const now = { 없다: r.none.length, 꼬리표: r.tailed.length };
if (argv.includes('--update')) {
  fs.mkdirSync(path.dirname(BASE_FILE), { recursive: true });
  fs.writeFileSync(BASE_FILE, JSON.stringify(now, null, 1) + '\n', 'utf8');
  console.log('  기준선을 다시 구웠다:', JSON.stringify(now));
}
if (argv.includes('--gate')) {
  let base = null;
  try { base = JSON.parse(fs.readFileSync(BASE_FILE, 'utf8')); } catch (_) { base = null; }
  if (!base) { console.log('  ⏭️  기준선이 없다 — `--update` 로 한 번 구워야 한다'); process.exit(0); }
  const worse = Object.keys(now).filter((k) => now[k] > (base[k] || 0));
  if (worse.length) {
    for (const k of worse) console.log(`  ❌ 늘었다 ${k} ${base[k]}→${now[k]}`);
    console.log('     고치는 법: 그 쪽에 표준 절을 쓴다(3-6). **이름을 지워서 초록을 만들지 않는다**(G-34).');
    process.exit(1);
  }
  const better = Object.keys(now).filter((k) => now[k] < (base[k] || 0));
  if (better.length) {
    for (const k of better) console.log(`  ✅ 줄었다 ${k} ${base[k]}→${now[k]} — \`--update\` 로 잠근다`);
  } else {
    console.log('  ✅ 기준선 그대로 — 늘지 않았다');
  }
}
