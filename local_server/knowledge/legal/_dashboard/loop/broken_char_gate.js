#!/usr/bin/env node
/**
 * V5-54 — raw 법령 원문에 **깨진 글자(U+FFFD)** 가 늘지 않나 (2026-09-27 신설)
 *
 * [왜 생겼나 — 이 게이트가 없어서 92개를 오늘 우연히 찾았다]
 *   2026-09-27, `3-37` 보류 대조를 하다가 챗봇이 읽는 법 원문에 깨진 글자가 박힌 것을 발견했다:
 *       `수목유전자원의증식␦␦␦의시설`   ← 「증식 **등**의 시설」
 *       `무기징␦␦ 또는 7년 이상의 징역`  ← 「무기징**역**」
 *       `돼지수포병(水疱病), 뉴␦␦슬병`   ← 「뉴**캣**슬병」
 *   ★**파일은 온전한 UTF-8 이다.** 지금 깨진 게 아니라 **수집할 때 잘못 읽어 들인 것이 굳었다.**
 *   `fix_broken_char.py` 로 **92 → 23** 까지 줄였지만, **그것을 재는 게이트가 없으면**
 *   수집기가 또 깨진 글을 들여와도 아무도 모른다 — 뿌리 사슬 ②③④ 그대로다.
 *   실제로 이 결함은 **게이트가 묻지 않아서**(뿌리 사슬 ⑤) 며칠 동안 아무도 몰랐다.
 *   ⇒ 「고쳤다」로 끝내지 않고 **늘지 않는 것**을 잠근다.
 *
 * [0 을 요구하지 않는 까닭 — 남은 23개는 고칠 수 없거나 고치면 안 되는 것이다]
 *   · **`_구판` 3자리** — 일부러 남긴 옛 판이다. 현행 글로 메우면 **판이 섞인다.**
 *   · **MST 가 없어 창구를 못 부르는 것 1자리**(장애인복지법)
 *   · **현행에서 앞뒤를 못 찾는 것 4자리** — 개정됐거나 우리 쪽지 안이다. **지어내지 않는다.**
 *   그래서 기준선을 **지금 값으로 잠그고 「늘면 빨간불」**만 본다(G-49 — 빨간불에 기준선을 다시 굽지 않는다).
 *   남은 23개를 더 줄이면 `--update` 로 기준선을 **내려서** 다시 잠근다.
 *
 * [세는 법 — 한 자리 = 한글 한 글자]
 *   한글 한 글자는 UTF-8 로 3바이트 · EUC-KR 로 2바이트다. 잘못 읽으면 그 바이트가 하나씩 `␦` 가 된다.
 *   ⇒ `␦` 가 **붙어 있는 덩이 하나**가 **잃은 글자 하나**다(실측: 3개 20자리 · 2개 16자리).
 *   그래서 **글자 수**와 **자리 수**를 따로 센다 — 둘 다 늘면 안 된다.
 *
 * 사용법
 *   node broken_char_gate.js           지금 값을 찍는다
 *   node broken_char_gate.js --gate    기준선과 견준다 (늘면 exit 1)
 *   node broken_char_gate.js --update  기준선을 지금 값으로 다시 쓴다 (줄었을 때만 쓴다)
 *   node broken_char_gate.js --list    깨진 자리를 하나씩 보여 준다
 *
 * [연계] ← 고치는 자 `fix_broken_char.py` · 기록 `_dashboard/broken_char_fix.json`
 *         ← 이 결함을 드러낸 일 `3-37`(`meta_mst_holdover_diff.py`)
 *         → 기준선 `loop/baseline/broken_char.json` · `verify_all.sh` V5-54
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const LEGAL = path.dirname(path.dirname(HERE));
const RAW = path.join(LEGAL, 'raw');
const BASE = path.join(HERE, 'baseline', 'broken_char.json');

const F = '�';

/** raw 의 `.txt` 전부에서 깨진 자리를 모은다. → [{파일, 자리, 글자수, 앞, 뒤, 구판}] */
function 찾기() {
    const out = [];
    const 걷기 = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) { 걷기(p); continue; }
            if (!e.name.endsWith('.txt')) continue;
            let t;
            try { t = fs.readFileSync(p, 'utf8'); } catch (_) { continue; }
            if (!t.includes(F)) continue;
            const rel = path.relative(RAW, p);
            // ★`␦` 가 붙어 있는 덩이 하나 = 잃은 글자 하나
            const re = new RegExp(F + '+', 'g');
            let m;
            while ((m = re.exec(t)) !== null) {
                out.push({
                    파일: rel, 자리: m.index, 글자수: m[0].length,
                    앞: t.slice(Math.max(0, m.index - 20), m.index).replace(/\s+/g, ' '),
                    뒤: t.slice(m.index + m[0].length, m.index + m[0].length + 20).replace(/\s+/g, ' '),
                    구판: /_구판/.test(e.name),
                });
            }
        }
    };
    걷기(RAW);
    return out;
}

function 지금() {
    const 자리 = 찾기();
    return {
        자리: 자리.length,
        글자: 자리.reduce((a, x) => a + x.글자수, 0),
        파일: new Set(자리.map((x) => x.파일)).size,
        구판자리: 자리.filter((x) => x.구판).length,
        _목록: 자리,
    };
}

function 기준선() {
    try { return JSON.parse(fs.readFileSync(BASE, 'utf8')); } catch (_) { return null; }
}

function 찍기(v) {
    console.log(`  raw 법령 원문의 깨진 글자(U+FFFD)`);
    console.log(`    뜻: 붙어 있는 \`␦\` 덩이 하나 = **잃은 한글 한 글자** (UTF-8 3바이트 · EUC-KR 2바이트)`);
    console.log(`    고치는 자: fix_broken_char.py — 앞 12자+뒤 12자가 현행 원문에서 **한 글자만 허락할 때만** 메운다`);
    console.log('');
    console.log(`    자리 ${v.자리}  ·  글자 ${v.글자}  ·  파일 ${v.파일}  (그중 _구판 자리 ${v.구판자리})`);
}

if (require.main === module) {
    const v = 지금();
    const 목 = v._목록;
    delete v._목록;

    if (process.argv.includes('--list')) {
        찍기(v);
        console.log('');
        for (const x of 목) {
            console.log(`  [${x.글자수}] …${x.앞}␦×${x.글자수}${x.뒤}…${x.구판 ? '   ⏭_구판' : ''}`);
            console.log(`       ${x.파일}`);
        }
        process.exit(0);
    }

    if (process.argv.includes('--update')) {
        fs.mkdirSync(path.dirname(BASE), { recursive: true });
        const 옛 = 기준선();
        fs.writeFileSync(BASE, JSON.stringify({
            자리: v.자리, 글자: v.글자, 파일: v.파일, 구판자리: v.구판자리,
            _잰날: new Date().toISOString().slice(0, 10),
            _옛_기준선: 옛 || null,
            _뜻: '늘면 빨간불. 줄였을 때만 `--update` 로 내려 잠근다(G-49).',
        }, null, 1) + '\n', 'utf8');
        찍기(v);
        console.log('\n✅ 기준선을 다시 썼다 — loop/baseline/broken_char.json');
        process.exit(0);
    }

    찍기(v);
    if (!process.argv.includes('--gate')) process.exit(0);

    const b = 기준선();
    if (!b) {
        console.log('\n❌ 기준선이 없다 — `node broken_char_gate.js --update` 로 먼저 잠근다');
        process.exit(1);
    }
    const 나쁨 = [];
    for (const k of ['자리', '글자', '파일']) {
        if (v[k] > b[k]) 나쁨.push(`${k} ${b[k]} → ${v[k]}`);
    }
    if (!나쁨.length) {
        console.log(`\n✅ V5-54 깨진 글자 늘지 않았다 (기준선 자리 ${b.자리} · 글자 ${b.글자} · 파일 ${b.파일})`);
        process.exit(0);
    }
    console.log(`\n❌ V5-54 **깨진 글자가 늘었다** — ${나쁨.join(' · ')}`);
    console.log('   → 어디가 늘었는지 본다:  node broken_char_gate.js --list');
    console.log('   → 창구 원문으로 메운다:  python3 fix_broken_char.py --apply');
    console.log('      ⚠메운 뒤 V5-41(실측 칸)이 빨간불이 된다 —');
    console.log('        `meta_measured_refresh.js --apply --only <폴더>` 로 **건드린 폴더만** 다시 쓴다.');
    console.log('   ★기준선을 올려서 통과시키지 않는다(G-49).');
    process.exit(1);
}

module.exports = { 찾기, 지금, 기준선 };
