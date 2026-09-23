#!/usr/bin/env node
/**
 * V5-25 — 74법 목록 **밖**에 있는 기준법급(tier:1) 부령 (2026-09-23 신설, G-26)
 *
 * ★먼저 밝혀 둘 것 — 이것은 **결함이 아니다.** 등록부(G-26)는 이 상태를
 *   *"`tier:1` 로 재분류해 놓고 폴더는 안 옮긴 법"* 이라고 적었지만, 재 보니
 *   **폴더에 그대로 두는 것이 설계**였다. `build_inspection_cycle_table.py:60` 이
 *   그렇게 적고 있다 —
 *     *"문서 하나를 하드코딩하지 않는 이유: 원인이 「그 문서를 몰랐다」가 아니라
 *       「폴더가 스캔 밖」이라, 같은 조건(tier 1)의 문서가 더 생기면 자동으로 들어와야 한다."*
 *   (설계 §3.5 「74법 목록 밖 기준법급 부령」)
 *
 * [그럼 무엇이 위험한가] **그 설계를 아는 도구와 모르는 도구가 갈린다.**
 *   2026-08-10 에 실제로 사고가 났다 — `build_inspection_cycle_table.py` 가 74법 폴더만
 *   훑어 「선박에서의 오염방지에 관한 규칙」을 못 보고, 해양환경관리법의 중간검사 시기를
 *   "raw 미수집"이라고 **잘못 적었다.** 형제 빌더는 같은 문서를 이미 쓰고 있었다.
 *
 * [그래서 무엇을 재나]
 *   ① **판정** — 74법 목록 밖의 tier:1 문서 수. 기준선(2)보다 **늘면 실패**한다.
 *      새로 생기면 위 사고가 다시 날 수 있으니 **사람이 한 번 보고 지나가라**는 뜻이다.
 *   ② **확인 목록(판정 아님)** — 법을 훑는 빌더 중 이 문서들에 **닿지 않는 것**.
 *      ⚠이것은 **소스에 이름이 나오나**로 본 값이라 **싼 대리 지표**다(L-322·L-325·L-327).
 *      "안 닿는다"가 곧 "닿아야 하는데 못 닿는다"는 뜻이 아니다 — 그 빌더가 이 부령을
 *      **써야 하는지는 주제마다 다르고, 기계가 고를 일이 아니다**(G-34). 그래서 세되 **안 막는다.**
 */
const fs = require('fs');
const path = require('path');

const LEGAL = path.resolve(__dirname, '../..');
const RAW = path.join(LEGAL, 'raw');
const LOOP = __dirname;
const BASE = path.join(LOOP, 'baseline', 'tier1_outside.json');
const IN_LIST = /^(0[1-9]|1[0-4])_/;          // 74법 목록이 사는 폴더

function tier1Outside() {
    const out = [];
    for (const dom of fs.readdirSync(RAW)) {
        if (IN_LIST.test(dom)) continue;
        const domDir = path.join(RAW, dom);
        let ents;
        try { ents = fs.readdirSync(domDir, { withFileTypes: true }); } catch (_) { continue; }
        for (const e of ents) {
            if (!e.isDirectory()) continue;
            const mp = path.join(domDir, e.name, '_meta.json');
            let m;
            try { m = JSON.parse(fs.readFileSync(mp, 'utf8')); } catch (_) { continue; }
            if (m.tier === 1) out.push({ 폴더: dom, 이름: e.name, 분류: m.분류 || '' });
        }
    }
    return out;
}

/**
 * ⚠싼 대리 지표 — 소스에 이름이 나오나로만 본다. 판정에 쓰지 않는다.
 *
 * ⚠★**공백을 지우고 견준다.** 2026-09-23 에 같은 것을 두 번 재고 **8 과 10 으로 갈렸다** —
 *   한 번은 폴더 이름(`선박에서의오염방지에관한규칙`)으로, 한 번은 앞머리만으로 봤기 때문이다.
 *   도구들은 법을 **띄어 쓴 이름**(「선박에서의 오염방지에 관한 규칙」)으로도 부른다.
 *   그래서 양쪽에서 공백을 지우고 견준다 — 놓치는 쪽보다 **넉넉히 닿았다고 보는 쪽**이 낫다.
 *   이 목록은 "더 봐야 할 것"을 고르는 데 쓰지 실패를 세우는 데 안 쓰기 때문이다.
 */
function buildersNotReaching(names) {
    const hit = [], miss = [];
    const nosp = (x) => x.replace(/\s+/g, '');
    const keys = names.map(nosp).concat(['TIER1_DIR', '관련타부처']);
    for (const f of fs.readdirSync(LOOP)) {
        if (!f.endsWith('.py')) continue;
        let t;
        try { t = fs.readFileSync(path.join(LOOP, f), 'utf8'); } catch (_) { continue; }
        if (!/load_laws|LAWS\s*=/.test(t)) continue;      // 법을 훑는 빌더만
        const flat = nosp(t);
        (keys.some((k) => flat.includes(k)) ? hit : miss).push(f);
    }
    return { hit, miss };
}

function main() {
    const rows = tier1Outside();
    const names = rows.map((r) => r.이름);
    const b = buildersNotReaching(names);
    console.log(`  74법 목록 밖 기준법급(tier:1) 문서  ${rows.length}개  ★결함이 아니라 설계다(§3.5)`);
    for (const r of rows) console.log(`     · ${r.폴더}/${r.이름}`);
    console.log(`  [확인 목록 — 판정 아님] 법을 훑는 빌더 ${b.hit.length + b.miss.length}개 중` +
                ` 이 문서에 **닿지 않는 것 ${b.miss.length}개**`);
    for (const f of b.miss) console.log(`     · ${f}`);
    console.log('     ⚠"안 닿는다"가 곧 "닿아야 하는데 못 닿는다"는 뜻이 아니다 — 주제마다 다르다.');
    console.log('     ⚠소스에 이름이 나오나로만 본 **싼 대리 지표**다. 판정에 쓰지 않는다(G-34).');

    if (process.argv.includes('--update')) {
        fs.writeFileSync(BASE, JSON.stringify({ 밖에있는tier1: rows.length, 목록: names }, null, 2) + '\n');
        console.log('  기준선을 다시 구웠다');
        return 0;
    }
    let base;
    try { base = JSON.parse(fs.readFileSync(BASE, 'utf8')); } catch (_) {
        console.log('  ⚠기준선이 없다 — `--update` 로 한 번 구워야 한다');
        return 1;
    }
    if (rows.length > base.밖에있는tier1) {
        const 새것 = names.filter((n) => !base.목록.includes(n));
        console.log(`  ❌ 늘었다: ${base.밖에있는tier1} → ${rows.length} (새로: ${새것.join(', ') || '?'})`);
        console.log('     → 새 tier:1 부령이 생겼다. **74법 목록만 훑는 빌더가 이것을 못 본다**');
        console.log('       (2026-08-10 에 실제로 난 사고다 — 중간검사 시기를 "raw 미수집"이라 잘못 적었다).');
        console.log('       사람이 빌더마다 「이 문서가 필요한가」를 보고 지나가라. 기계가 고르지 않는다(G-34).');
        return 1;
    }
    console.log(rows.length < base.밖에있는tier1
        ? `  ✅ 줄었다: ${base.밖에있는tier1} → ${rows.length} — \`--update\` 로 잠근다`
        : '  ✅ 기준선 그대로 — 늘지 않았다');
    return 0;
}

if (require.main === module) process.exit(main());
module.exports = { tier1Outside, buildersNotReaching };
