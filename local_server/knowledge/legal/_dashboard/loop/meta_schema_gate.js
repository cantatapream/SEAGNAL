/**
 * meta_schema_gate.js — V5-18 ★**꼬리표의 판번호가 제자리에 있나** (2-3, 2026-09-23)
 *
 * [왜 있나] 2-2 가 꼬리표 사전(`_meta_schema.js`)을 세웠다. 그런데 **사전만으로는 죽는다** —
 *   뿌리 사슬 ③: 게이트가 안 재는 자리는 죽는다. 그래서 이 게이트가 그 사전을 **부른다**.
 *   규칙을 여기서 다시 적지 않는다(L-136) — `census()` 가 유일한 자리다.
 *
 * [무엇을 재나]  뜻·범위는 `_meta_schema.js` 의 `census().label` 이 말한다.
 *   families 안에만   판번호가 **제자리**에 있다
 *   최상위에만        **옛 자리**에 흩어져 있다  ← 늘면 안 된다
 *   둘 다             양쪽에 있다(어긋날 수 있다)
 *   아무 데도 없다     **결손** — 그 판을 가리킬 수 없다  ← 늘면 안 된다
 *   어긋남            같은 계층을 다르게 말한다  ← 늘면 안 된다
 *
 * ⚠**줄어드는 것은 막지 않는다**(고치면 줄어드는 게 정상이다). 줄었으면 `--update` 로
 *   그 자리에서 다시 잠근다 — 2-6b·2-21 과 같은 방식이다.
 * ⚠**어긋남은 기계가 고르지 않는다** — 목록으로 찍어 사람이 보게 한다(G-34).
 *
 * [실행]
 *   node …/meta_schema_gate.js            현황만 본다
 *   node …/meta_schema_gate.js --list     흩어진 것·어긋난 것 목록
 *   node …/meta_schema_gate.js --update   기준선을 지금 값으로 다시 굽는다
 *   node …/meta_schema_gate.js --gate     기준선보다 나빠지면 실패 (verify_all 이 쓰는 것)
 *
 * [연계] ← scripts/refactor/verify_all.sh (V5-18)
 *        → _meta_schema.js (정의의 유일한 자리) · baseline/meta_schema.json
 *        → 00_WORKLIST 2-2 · 2-3 · 3-37
 */
'use strict';
const fs = require('fs');
const path = require('path');
const M = require('./_meta_schema.js');

const BASE = path.join(__dirname, 'baseline', 'meta_schema.json');
const argv = process.argv.slice(2);

const c = M.census();
const cur = {
    최상위에만: c.strayOnly,
    아무데도없다: c.none,
    어긋남: c.conflictFiles,
    못읽음: c.unreadable,
    // 아래 둘은 **판정에 쓰지 않는다** — 흐름을 읽으라고 같이 적어 둘 뿐이다.
    families안에만: c.famOnly,
    둘다: c.both,
    전체: c.total,
};

if (argv.includes('--list')) {
    for (const f of M.metaFiles()) {
        const m = M.readMeta(f);
        const rel = path.relative(M.RAW_ROOT, f);
        if (!m.ok) { console.log(`못읽음  ${rel} — ${m.error}`); continue; }
        if (m.conflicts.length) m.conflicts.forEach((w) => console.log(`어긋남  ${rel} — ${w}`));
        const stray = Object.keys(m.strays);
        if (stray.length && !m.hasId) console.log(`옛자리  ${rel} — ${stray.join(', ')}`);
        if (!stray.length && !m.hasId) console.log(`결손    ${rel}`);
    }
    process.exit(0);
}

console.log(`  꼬리표 ${c.total}개 — ${c.label}`);
console.log(`    ✅ 제자리(families 안)      ${String(c.famOnly).padStart(4)}`);
console.log(`    ·  양쪽에                  ${String(c.both).padStart(4)}   (어긋날 수 있다)`);
console.log(`    ❌ 옛 자리(최상위)에만      ${String(c.strayOnly).padStart(4)}   판번호가 families 밖에 있다`);
console.log(`    ❌ 아무 데도 없다           ${String(c.none).padStart(4)}   그 판을 가리킬 수 없다 → 신선도 점검이 못 따라간다`);
console.log(`    ❌ 어긋남                   ${String(c.conflictFiles).padStart(4)}   같은 계층을 두 자리가 다르게 말한다`);
if (c.unreadable) console.log(`    ⚠ 못 읽음                  ${String(c.unreadable).padStart(4)}   (0 이 아니라 「못 읽었다」다)`);
for (const x of c.conflicts.slice(0, 5)) console.log(`       ↳ ${x.file} — ${x.why[0]}`);
if (c.conflicts.length > 5) console.log(`       ↳ … 그 밖 ${c.conflicts.length - 5}건 (--list)`);
console.log('    (목록: --list · 줄이는 일은 3-37)');

if (argv.includes('--update')) {
    fs.mkdirSync(path.dirname(BASE), { recursive: true });
    fs.writeFileSync(BASE, JSON.stringify({ 기준일: new Date().toISOString().slice(0, 10), ...cur }, null, 2) + '\n');
    console.log(`  기준선을 다시 구웠다 — ${JSON.stringify(cur)}`);
    process.exit(0);
}
if (!argv.includes('--gate')) process.exit(0);

let base = null;
if (fs.existsSync(BASE)) { try { base = JSON.parse(fs.readFileSync(BASE, 'utf8')); } catch (_) { base = null; } }
if (!base) { console.log('  ⚠기준선이 없다 — --update 로 먼저 구워라'); process.exit(1); }

// ★판정에 쓰는 것은 **나쁜 쪽 넷**뿐이다. 좋은 쪽이 줄어드는 것은 위 넷이 이미 잡는다.
const WATCH = ['최상위에만', '아무데도없다', '어긋남', '못읽음'];
console.log(`  기준선(${base.기준일}) — ` + WATCH.map((k) => `${k} ${base[k]}`).join(' · '));
const worse = WATCH.filter((k) => cur[k] > (base[k] == null ? 0 : base[k]));
if (worse.length) {
    for (const k of worse) console.log(`  ❌ 늘었다: ${k} ${base[k]} → ${cur[k]}`);
    console.log('     새로 들어온 꼬리표가 판번호를 제자리에 안 적었다는 뜻이다 — 수집 쪽을 보라.');
    console.log('     ⚠기준선을 다시 굽는 것으로 넘기지 않는다. 줄었을 때만 다시 굽는다(G-49).');
    process.exit(1);
}
const better = WATCH.filter((k) => cur[k] < (base[k] == null ? 0 : base[k]));
if (better.length) for (const k of better) console.log(`  ✅ 줄었다: ${k} ${base[k]} → ${cur[k]}  (--update 로 다시 잠가라)`);
console.log('  ✅ 기준선 대비 나빠지지 않았다');
process.exit(0);
