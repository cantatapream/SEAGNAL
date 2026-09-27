#!/usr/bin/env node
/**
 * V5-41 — **`_meta.json` 의 「실측」 칸이 지금도 사실인가.** (2026-09-24 신설)
 *
 * [왜 이 검사가 필요한가 — 뿌리 사슬 ③·⑤]
 *   `raw/**\/_meta.json` 409개에 이런 칸이 있다:
 *     `"실측_2026-09-07": { "설명": "이 폴더에 지금 실제로 들어 있는 것을 기계로 세어 적은 값이다.
 *        위의 서술이 낡았을 수 있으니 **판단은 이 칸을 근거로 한다**", "파일": { "법률.txt": {바이트, 조문수, 조문} } }`
 *   ★스스로 **「판단의 근거」라고 선언**해 놓고, **아무도 다시 재지 않았다.**
 *   2026-09-24 처음 재어 보니 적힌 파일 696개 가운데
 *     **조문수가 다른 것 303 · 바이트가 다른 것 73.**
 *
 * [왜 달라지나 — 두 가지가 섞여 있다. 섞어서 한 통에 넣지 않는다]
 *   ⓐ **파일이 바뀌었다** — 그 뒤에 조문을 더 받았거나 머리말을 고쳤다.
 *   ⓑ **자가 좋아졌다** — 파일은 그대로인데 `listArticleNumbers` 가 더 읽게 됐다.
 *      실제로 조약 파일들은 **글자 하나 안 바뀌었는데** 0 → 2·4 가 됐다.
 *      2026-09-24 에 조약 조문꼴(꼴④ `제1조 일반적 의무`)을 읽게 만들었기 때문이다(3-51).
 *   ⇒ **어느 쪽이든 그 칸은 지금 사실이 아니다.** 「지금 들어 있는 것」이라고 적혀 있으니까.
 *      고치는 길은 하나다 — **다시 재서 새 날짜로 적는다.** 옛 칸은 날짜가 키에 있으니 그대로 남는다.
 *
 * [세는 법 — ⑥]
 *   · 한 폴더에 `실측_*` 칸이 여럿이면 **가장 새 날짜 하나만** 본다(옛 칸은 과거 기록이다).
 *   · 조문수는 `article_text.listArticleNumbers` 로 센다 — **챗봇이 쓰는 그 함수**다(L-136).
 *   · 바이트는 파일 크기 그대로.
 *
 * [연계] ← `raw/**\/_meta.json` · 고치는 도구: `meta_measured_refresh.js`
 *         기준선 `_dashboard/loop/baseline/meta_measured.json`
 * 사용법: node meta_measured_gate.js [--list] [--gate] [--update]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const LEGAL = path.dirname(path.dirname(HERE));
const RAW = path.join(LEGAL, 'raw');
const AT = require(path.resolve(LEGAL, '../../services/article_text.js'));
const BASE = path.join(HERE, 'baseline', 'meta_measured.json');
const argv = process.argv.slice(2);

/** 그 폴더에서 **가장 새 「실측」 칸**의 키. 없으면 null. */
function latestKey(meta) {
    const ks = Object.keys(meta).filter((k) => /^실측_/.test(k) && meta[k] && meta[k]['파일']);
    if (!ks.length) return null;
    return ks.sort()[ks.length - 1];          // `실측_2026-09-07` — 문자열 정렬이 곧 날짜 정렬
}

function check() {
    const r = { 폴더: 0, 칸: 0, 파일: 0, 바이트다름: 0, 조문수다름: 0, 파일없다: 0 };
    const bad = [];
    (function walk(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) { if (e.name !== '_대기') walk(p); continue; }
            if (e.name !== '_meta.json') continue;
            r.폴더++;
            let meta;
            try { meta = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { continue; }
            const k = latestKey(meta);
            if (!k) continue;
            r.칸++;
            for (const [fn, v] of Object.entries(meta[k]['파일'])) {
                r.파일++;
                const fp = path.join(d, fn);
                const rel = path.relative(RAW, fp);
                if (!fs.existsSync(fp)) {
                    r.파일없다++; bad.push(`[없다]   ${rel}  ← ${k} 이 있다고 적었다`); continue;
                }
                const t = fs.readFileSync(fp, 'utf8');
                if (typeof v['바이트'] === 'number' && v['바이트'] !== Buffer.byteLength(t)) {
                    r.바이트다름++;
                    bad.push(`[바이트] ${rel}  적힘 ${v['바이트']} ↔ 지금 ${Buffer.byteLength(t)}`);
                }
                if (typeof v['조문수'] === 'number') {
                    const n = AT.listArticleNumbers(t).length;
                    if (n !== v['조문수']) {
                        r.조문수다름++;
                        bad.push(`[조문수] ${rel}  적힘 ${v['조문수']} ↔ 지금 ${n}`);
                    }
                }
            }
        }
    })(RAW);
    return { r, bad };
}

function main() {
    const { r, bad } = check();
    const total = r.바이트다름 + r.조문수다름 + r.파일없다;
    console.log('  V5-41 `_meta.json` 의 「실측」 칸이 지금도 사실인가');
    console.log('    뜻: 그 칸이 스스로 **「판단의 근거」**라고 적어 둔 값을 **다시 재어** 맞춰 본다');
    console.log('    세는 법의 임자: article_text.listArticleNumbers (챗봇이 쓰는 그 함수 · L-136)');
    console.log(`    범위: 가장 새 「실측」 칸만 — 폴더 ${r.폴더} · 칸 ${r.칸} · 적힌 파일 ${r.파일}\n`);
    console.log(`    ${r.조문수다름 ? '❌' : '✅'} 조문수가 다르다  ${String(r.조문수다름).padStart(4)}`);
    console.log(`    ${r.바이트다름 ? '❌' : '✅'} 바이트가 다르다  ${String(r.바이트다름).padStart(4)}`);
    console.log(`    ${r.파일없다 ? '❌' : '✅'} 그 파일이 없다   ${String(r.파일없다).padStart(4)}`);
    if (argv.includes('--list')) for (const b of bad.slice(0, 60)) console.log('       ↳ ' + b);
    else if (total) console.log('    (목록: --list)');

    const now = { 조문수다름: r.조문수다름, 바이트다름: r.바이트다름, 파일없다: r.파일없다 };
    if (argv.includes('--update')) {
        fs.mkdirSync(path.dirname(BASE), { recursive: true });
        fs.writeFileSync(BASE, JSON.stringify(now, null, 1) + '\n', 'utf8');
        console.log('    기준선을 다시 구웠다:', JSON.stringify(now));
    }
    if (argv.includes('--gate')) {
        let base = null;
        try { base = JSON.parse(fs.readFileSync(BASE, 'utf8')); } catch (_) { }
        if (!base) { console.log('    ⏭️  기준선이 없다 — `--update` 로 한 번 구워야 한다'); return 0; }
        const up = Object.keys(now).filter((k) => now[k] > (base[k] ?? now[k]));
        if (up.length) {
            for (const k of up) console.log(`    ❌ 늘었다 ${k} ${base[k]}→${now[k]}`);
            console.log('       고치는 법: `node meta_measured_refresh.js --apply` 로 **다시 재서 새 날짜 칸**을 단다.');
            console.log('       ★옛 칸은 지우지 않는다 — 날짜가 키에 있어 과거 기록으로 남는다.');
            return 1;
        }
        const down = Object.keys(now).filter((k) => now[k] < (base[k] ?? now[k]));
        console.log(down.length
            ? `    ✅ 줄었다 ${down.map((k) => `${k} ${base[k]}→${now[k]}`).join(' · ')} — \`--update\` 로 잠근다`
            : '    ✅ 기준선 그대로 — 늘지 않았다');
    }
    return 0;
}

if (require.main === module) process.exit(main());
