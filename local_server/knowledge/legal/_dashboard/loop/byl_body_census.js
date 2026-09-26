#!/usr/bin/env node
/**
 * V5-39 — **별표 파일의 속을 전수로 센다.** 글이 있나 · 주소만인가 · 비었나.
 *
 * 왜 이 검사가 필요한가 (뿌리 사슬 ③ — 게이트가 안 재는 자리는 죽는다)
 *   별표 파일은 **7,500개가 넘는데** 지금까지 어느 게이트도 **파일 자체의 속**을 전수로 세지
 *   않았다. 재던 것은 둘 다 **위키 줄** 기준이다:
 *     · V5-32(`byl_tier_ready`)  계층 별표를 **짚은 근거 줄** 1,379개
 *     · V5-11(`annex_ready`)     고시 별표를 **짚은 근거 줄** 329개
 *   ⇒ **아무 위키 줄도 안 짚는 파일**은 비어 있어도 아무도 모른다.
 *   실제로 2026-09-24 에 `bylBodyKind()` 를 만들고 나서야
 *   **「원문이 있다」로 세어지던 파일 284개가 실은 글이 없다**는 것이 드러났다.
 *
 * 무엇을 세나 (세는 법을 못박는다 — ⑥)
 *   `text`      글(표·조문)이 있다
 *   `linkOnly`  글은 없고 **내려받기 주소만** 있다 — 사용자는 원문을 볼 수 있다
 *   `none·삭제` 비었는데 **`삭제`·`이동`·`폐지`라고 적혀 있다** — 원문이 그런 것이다(정상)
 *   `none·빔`   ★비었는데 **까닭도 안 적혀 있다** — 제목·출처만 있고 본문이 통째로 없다
 *
 * ★기준선은 **`none·빔` 하나만** 잠근다
 *   · `text` 는 늘수록 좋다.
 *   · `linkOnly` 는 **우리가 고른 것**이다(3-49·3-53 — 원문 제공처가 글을 안 줄 때 주소라도 준다).
 *     늘어도 결함이 아니라서 잠그지 않는다. 다만 **숫자는 찍는다**(흐름이 보이도록).
 *   · `none·삭제` 는 법이 바뀌면 자연히 는다. 잠그면 **법 개정에 빨간불**이 켜진다.
 *   · `none·빔` 만이 **언제나 결함**이다 — 받다 만 것이다.
 *
 * [연계] ← `raw/**\/별표/*.txt` · 자: `article_text.bylBodyKind`(챗봇이 쓰는 그 함수, L-136)
 *         기준선 `_dashboard/loop/baseline/byl_body_census.json`
 * 사용법: node byl_body_census.js [--list] [--gate] [--update]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const LEGAL = path.dirname(path.dirname(HERE));
const RAW = path.join(LEGAL, 'raw');
const AT = require(path.resolve(LEGAL, '../../services/article_text.js'));
const BASE_FILE = path.join(HERE, 'baseline', 'byl_body_census.json');
const argv = process.argv.slice(2);

/** 비었을 때 **까닭이 적혀 있나** — 머리 400자만 본다(본문에 「삭제」가 나와도 속지 않게). */
const WHY_RE = /삭제|이동|폐지|없음|미제공/;

function walk(dir, out) {
    let es = [];
    try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
    for (const e of es) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== '_대기') walk(p, out); }
        else if (e.name.endsWith('.txt')
                 && path.relative(RAW, p).split(path.sep).join('/').includes('/별표/')) out.push(p);
    }
    return out;
}

function main() {
    const c = { text: 0, linkOnly: 0, none삭제: 0, none빔: 0 };
    const empty = [];
    for (const p of walk(RAW, [])) {
        const t = fs.readFileSync(p, 'utf8');
        const k = AT.bylBodyKind(t);
        if (k === 'text' || k === 'linkOnly') { c[k]++; continue; }
        if (WHY_RE.test(t.slice(0, 400))) { c.none삭제++; continue; }
        c.none빔++;
        empty.push(path.relative(RAW, p) + `  (${Buffer.byteLength(t)}바이트)`);
    }
    const tot = c.text + c.linkOnly + c.none삭제 + c.none빔;
    console.log('  V5-39 별표 파일의 속을 전수로 센다');
    console.log('    뜻: 파일마다 `article_text.bylBodyKind` 로 글/주소만/빔 을 가른다 ·'
              + ` 범위: raw/**/별표/*.txt **전부** ${tot}개`);
    console.log(`    ✅ 글이 있다        ${String(c.text).padStart(5)}`);
    console.log(`    ·  주소만 있다      ${String(c.linkOnly).padStart(5)}   우리가 고른 것(3-49·3-53) — 잠그지 않는다`);
    console.log(`    ·  비었다(삭제라 적힘) ${String(c.none삭제).padStart(3)}   원문이 그런 것이다 — 결함 아님`);
    console.log(`    ${c.none빔 ? '❌' : '✅'} 비었다(까닭도 없다) ${String(c.none빔).padStart(3)}   `
              + '★제목·출처만 있고 본문이 통째로 없다 — 받다 만 것이다');
    if (argv.includes('--list')) for (const e of empty) console.log('       ↳ ' + e);
    else if (c.none빔) console.log('    (목록: --list)');

    const now = { 까닭없이빔: c.none빔 };
    if (argv.includes('--update')) {
        fs.mkdirSync(path.dirname(BASE_FILE), { recursive: true });
        fs.writeFileSync(BASE_FILE, JSON.stringify(now, null, 1) + '\n', 'utf8');
        console.log('    기준선을 다시 구웠다:', JSON.stringify(now));
    }
    if (argv.includes('--gate')) {
        let base = null;
        try { base = JSON.parse(fs.readFileSync(BASE_FILE, 'utf8')); } catch (_) { base = null; }
        if (!base) { console.log('    ⏭️  기준선이 없다 — `--update` 로 한 번 구워야 한다'); return 0; }
        if (now.까닭없이빔 > base.까닭없이빔) {
            console.log(`    ❌ 늘었다 까닭없이빔 ${base.까닭없이빔}→${now.까닭없이빔}`);
            console.log('       고치는 법: 그 별표를 다시 받는다. 원문 제공처가 글을 안 주면');
            console.log('       **내려받기 주소라도 적어** `linkOnly` 로 만든다(3-49 와 같은 길).');
            console.log('       ★파일을 지워서 초록을 만들지 않는다 — 위키가 짚던 자리가 사라진다(G-34).');
            return 1;
        }
        if (now.까닭없이빔 < base.까닭없이빔) {
            console.log(`    ✅ 줄었다 까닭없이빔 ${base.까닭없이빔}→${now.까닭없이빔} — \`--update\` 로 잠근다`);
        } else console.log('    ✅ 기준선 그대로 — 늘지 않았다');
    }
    return 0;
}

if (require.main === module) process.exit(main());
