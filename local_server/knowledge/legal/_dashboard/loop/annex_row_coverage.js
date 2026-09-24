#!/usr/bin/env node
/**
 * V5-42 — **별표를 짚은 근거 줄 가운데 「아무 게이트도 안 보는 줄」이 있나.** (2026-09-24, G-9)
 *
 * [왜 이 검사가 필요한가 — 뿌리 사슬 ③·④]
 *   `link_ready`(V5-8) 는 별표를 짚은 줄을 **"조문 칸이 아님"으로 넘긴다**(실측 935줄).
 *   넘긴 자리는 둘이 나눠 받는다:
 *     · **V5-11** `annex_ready`     — 법령 칸이 **고시(행정규칙)** 인 줄
 *     · **V5-32** `byl_tier_ready`  — 법령 칸에 **계층 낱말(법률·시행령·시행규칙)** 이 있는 줄
 *   ⇒ **둘 다 아닌 줄**이 있으면 그 줄은 **아무도 안 본다.**
 *   ★G-9 는 *"605줄을 아무도 안 본다"* 로 열렸고, V5-32 가 생겨 그 자리를 받았다.
 *     그런데 **「이제 빠짐이 없다」는 아무도 증명하지 않았다.** 세는 자가 셋이고 값이 다 달라
 *     (933 · 328 · 1,379) **숫자만으로는 덮였는지 알 수 없다**(뿌리 사슬 ⑥).
 *     이 검사는 **줄 하나하나의 임자를 물어** 그 물음에 답한다.
 *
 * [세는 법 — 임자를 정하는 규칙은 두 게이트가 쓰는 것 그대로다]
 *   · 줄의 `tier` 가 `법률`·`시행령`·`시행규칙` 이면 → **V5-32 소관**
 *   · 그 밖(고시·행정규칙 등)이면 → **V5-11 소관**
 *   · 조문 칸이 별표·별지·서식을 안 짚으면 → 이 검사의 대상이 아니다(V5-8 소관)
 *   ★`tier` 가 비어 있는 줄이 **임자 없는 줄**이다 — 그것이 이 검사가 찾는 것이다.
 *
 * [연계] ← `wiki/**\/*.md` 의 근거 조문 표 · 자: `legal_retriever.extractCitationChain`(생산과 같은 것, L-136)
 *         기준선 `_dashboard/loop/baseline/annex_row_coverage.json`
 * 사용법: node annex_row_coverage.js [--list] [--gate] [--update]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const LEGAL = path.dirname(path.dirname(HERE));
const WIKI = path.join(LEGAL, 'wiki');
const R = require(path.resolve(LEGAL, '../../services/legal_retriever.js'));
const BASE = path.join(HERE, 'baseline', 'annex_row_coverage.json');
const argv = process.argv.slice(2);

/** 조문 칸이 별표·별지·서식을 짚었나 — V5-32 의 `bylKeys` 와 같은 꼴을 본다. */
const ANNEX_RE = /(별표|별지|서식)\s*제?\s*\d/;
/** V5-32 가 맡는 계층 표시. ★`extractCitationChain` 은 **영문 코드**로 준다(`law`·`decree`·`rule`·`notice`).
 *  ⚠2026-09-24 — 처음에 한글 낱말(`법률`…)로 견줬다가 **V5-32 몫이 0** 으로 나왔다.
 *    값이 어떤 꼴인지 안 보고 이름만 보고 썼다. 찍어 보고 고쳤다(`{"tier":"law"}`).
 *  임자 규칙은 `byl_tier_ready.js` 의 `TIER_PREFIX` 와 같은 자리를 쓴다. */
const TIER_OWNED = new Set(['law', 'decree', 'rule']);

function check() {
    const r = { 별표줄: 0, V5_32: 0, V5_11: 0, 임자없음: 0 };
    const orphan = [];
    for (const dir of ['concepts', 'statutes', 'comparisons', 'annexes', 'activities']) {
        const D = path.join(WIKI, dir);
        if (!fs.existsSync(D)) continue;
        for (const f of fs.readdirSync(D)) {
            if (!f.endsWith('.md')) continue;
            const src = fs.readFileSync(path.join(D, f), 'utf8');
            for (const row of R.extractCitationChain(src.replace(/^---[\s\S]*?---\n/, ''))) {
                if (!ANNEX_RE.test(String(row.article || ''))) continue;
                r.별표줄++;
                const tier = String(row.tier || '').trim();
                if (TIER_OWNED.has(tier)) { r.V5_32++; continue; }
                if (tier) { r.V5_11++; continue; }
                r.임자없음++;
                if (orphan.length < 200) {
                    orphan.push(`${dir}/${f}  법령칸「${String(row.law || '').slice(0, 30)}」`
                        + `  조문칸「${String(row.article || '').slice(0, 44)}」`);
                }
            }
        }
    }
    return { r, orphan };
}

function main() {
    const { r, orphan } = check();
    console.log('  V5-42 별표를 짚은 근거 줄에 **임자가 다 있나** (G-9)');
    console.log('    뜻: 줄마다 어느 게이트가 보는지 묻는다 — 계층 낱말이면 V5-32, 그 밖이면 V5-11');
    console.log('    자: legal_retriever.extractCitationChain (챗봇이 쓰는 그 함수 · L-136)\n');
    console.log(`    별표·별지·서식을 짚은 근거 줄 ${r.별표줄}개`);
    console.log(`    ·  V5-32 가 본다(계층 별표)   ${String(r.V5_32).padStart(5)}`);
    console.log(`    ·  V5-11 이 본다(그 밖)       ${String(r.V5_11).padStart(5)}`);
    console.log(`    ${r.임자없음 ? '❌' : '✅'} ★임자가 없다              ${String(r.임자없음).padStart(5)}   `
        + '법령 칸이 비어 아무 게이트도 이 줄을 안 본다');
    if (argv.includes('--list')) for (const o of orphan) console.log('       ↳ ' + o);
    else if (r.임자없음) console.log('    (목록: --list)');

    const now = { 임자없음: r.임자없음 };
    if (argv.includes('--update')) {
        fs.mkdirSync(path.dirname(BASE), { recursive: true });
        fs.writeFileSync(BASE, JSON.stringify(now, null, 1) + '\n', 'utf8');
        console.log('    기준선을 다시 구웠다:', JSON.stringify(now));
    }
    if (argv.includes('--gate')) {
        let base = null;
        try { base = JSON.parse(fs.readFileSync(BASE, 'utf8')); } catch (_) { }
        if (!base) { console.log('    ⏭️  기준선이 없다 — `--update` 로 한 번 구워야 한다'); return 0; }
        if (now.임자없음 > base.임자없음) {
            console.log(`    ❌ 늘었다 임자없음 ${base.임자없음}→${now.임자없음}`);
            console.log('       고치는 법: 그 줄의 **법령 칸에 계층을 적는다**(「시행규칙 별표3」 꼴).');
            console.log('       ★줄을 지워서 초록을 만들지 않는다 — 챗봇이 그 근거를 잃는다(G-34).');
            return 1;
        }
        console.log(now.임자없음 < base.임자없음
            ? `    ✅ 줄었다 임자없음 ${base.임자없음}→${now.임자없음} — \`--update\` 로 잠근다`
            : '    ✅ 기준선 그대로 — 늘지 않았다');
    }
    return 0;
}

if (require.main === module) process.exit(main());
