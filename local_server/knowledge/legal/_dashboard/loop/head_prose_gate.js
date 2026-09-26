#!/usr/bin/env node
/**
 * V5-37 — **머리말이 본문을 잘라먹지 않나.**
 *
 * 무엇이 있었나 (2026-09-24 실측)
 *   `폐기물관리법/시행규칙.txt` **151,785자 · 조 157개**가 챗봇에게 **조 0개**로 보이고 있었다.
 *   까닭은 수집 공백이 아니라 **내가 쓴 머리말 두 줄**이었다:
 *
 *       ※ 별표는 전문을 통째로 …
 *          (별표5의8 · 별표5 3.다 보관 · …).      ← 줄머리 `(별표N`
 *          부칙 전문 포함.                        ← 줄머리 `부칙`
 *
 *   `article_text.articleRegion()` 은 이 두 꼴을 **「본문 끝 · 별표/부칙 시작」** 으로 읽어
 *   **652바이트에서 파일 전체를 잘랐다.** 그래서 `listArticleNumbers()` 가 빈 배열을 냈다.
 *   ★`extractArticleBlock()`(조 하나 찾기)은 잘 됐다 — 그래서 **아무도 몰랐다.**
 *   챗봇이 「이 법 전체를 보여줘」 할 때만 비어 보였다.
 *
 * 무엇을 재나
 *   본문 파일(계층·조약·행정규칙)에서 **별표·별지·서식 덩어리 머리줄이 첫 조 머리줄보다
 *   앞에 있는 자리**. 별표는 본문 **뒤에** 오는 것이므로 앞에 있으면 **머리말 글이 흉내낸 것**이다.
 *
 *   ⚠부칙 경계는 이 검사에서 뺀다 — `교육기본법/법률_발췌.txt` 처럼 **파일 전체가 부칙 발췌**인
 *     것이 실제로 있고(실측), 그때는 거기서 자르는 것이 **맞다**. 부칙 조를 본문 조로 세면
 *     `제1조(시행일)` 이 본문 제1조인 척한다. 그래서 오탐을 만들 바에 안 센다.
 *   ⚠`부칙*`·`별표/`·`_별표`·`_별지`·`_서식` 파일은 그 파일 자체가 부칙·별표다 — 뺀다.
 *
 * ★자를 빌려 쓴다 (L-136)
 *   경계 패턴을 새로 짜지 않는다 — `article_text.js` 의 `ANNEX_BLOCK_SRC` 를 **파일에서 읽어**
 *   그대로 쓴다. 따로 베껴 두면 그쪽이 바뀔 때 이 게이트만 낡는다.
 *
 * [연계] ← `raw/**\/*.txt` · 자: `local_server/services/article_text.js`(ANNEX_BLOCK_SRC)
 * 사용법: node head_prose_gate.js [--list]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const LEGAL = path.dirname(path.dirname(HERE));
const RAW = path.join(LEGAL, 'raw');
const AT_SRC = path.resolve(LEGAL, '../../services/article_text.js');
const SHOW = process.argv.includes('--list');

/** `article_text.js` 에서 별표 덩어리 머리 패턴을 **그 파일 그대로** 읽어 온다. */
function annexHeadRe() {
    const src = fs.readFileSync(AT_SRC, 'utf8');
    const m = /const ANNEX_BLOCK_SRC\s*=\s*'([\s\S]*?)';/.exec(src);
    if (!m) throw new Error('article_text.js 에서 ANNEX_BLOCK_SRC 를 못 찾았다 — 이름이 바뀌었나');
    return new RegExp(m[1].replace(/\\\\/g, '\\'));
}

// 조 머리줄 — `[제10조]` 과 `제10조(` 두 꼴 (listArticleNumbers 와 같은 규약)
const HEAD_RE = /(?:^|\n)(?:\[제\d+조(?:의\d+)?(?:\([^)\n]*\))?\]|제\d+조(?:의\d+)?[ \t]*\()/;
// 그 파일 자체가 부칙·별표인 것은 뺀다
const SKIP_RE = /(^|\/)부칙|\/별표\/|\/별지\/|_별표|_별지|_서식|\/타법인용\//;

function walk(dir, out) {
    let es = [];
    try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
    for (const e of es) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== '_대기') walk(p, out); }
        else if (e.name.endsWith('.txt')) out.push(p);
    }
    return out;
}

function main() {
    const ANNEX = annexHeadRe();
    const bad = [];
    let checked = 0;
    for (const p of walk(RAW, [])) {
        const rel = path.relative(RAW, p).split(path.sep).join('/');
        if (SKIP_RE.test(rel)) continue;
        const t = fs.readFileSync(p, 'utf8');
        const h = HEAD_RE.exec(t);
        if (!h) continue;                        // 조가 없는 파일은 이 검사 대상이 아니다
        checked++;
        const a = t.search(ANNEX);
        if (a < 0 || a >= h.index) continue;
        // ★여기서 한 번 더 가른다 — **진짜 별표 머리줄**과 **머리말 글이 흉내낸 것**은 꼴이 다르다.
        //   진짜: 줄 맨 앞(0칸)에서 `[별표]`·`[별표 2]`·`■ …[별표 3]` 으로 시작한다.
        //   흉내: 들여쓴 줄이거나 여는 괄호로 시작한다 — `   (별표5의8 · 별표5 3.다 …`.
        //   실측 2026-09-24: 이 한 줄이 없으면 **오탐 2건**이 뜬다 —
        //     ①`현장승선실습표준협약서.txt` 는 협약서 조문이 **정말 별표 안에** 있다.
        //     ②`(인천…)장안서부근해역항행안전에관한고시.txt` 의 「제1조 중 "…"」은 **개정문**이다.
        //   ⚠기준선을 굽히는 것이 아니라 **자를 고친 것**이다(G-49). 되짚어 확인했다:
        //     좁힌 자로도 폐기물관리법의 옛 머리말은 잡힌다(`(별표5의8 …` 은 들여쓴 줄이다).
        const lineStart = t.lastIndexOf('\n', a) + 1;
        const line = t.slice(lineStart, t.indexOf('\n', a + 1) < 0 ? undefined : t.indexOf('\n', a + 1));
        if (/^(?:\[|■|〔|【)/.test(line)) continue;           // 진짜 별표 머리줄이다
        bad.push({ rel, at: a, head: h.index, size: t.length, line: line.trim().slice(0, 70) });
    }
    console.log('  V5-37 머리말이 본문을 잘라먹지 않나');
    console.log('    뜻: 본문 파일에서 **별표 덩어리 머리줄이 첫 조보다 앞에** 있으면,'
              + ' `articleRegion()` 이 거기서 자르고 `listArticleNumbers()` 가 조를 0개로 낸다');
    console.log('    범위: raw/ 전체 .txt (부칙·별표 파일과 부칙 발췌는 뺀다) — 검사한 파일 ' + checked);
    if (!bad.length) {
        console.log('    ✅ 없다 0');
        return 0;
    }
    console.log(`    ❌ 있다 ${bad.length}   그 파일의 조가 챗봇에게 하나도 안 보인다`);
    for (const b of bad) {
        console.log(`       ↳ ${b.rel} (${b.size}자) — ${b.at}바이트에서 잘린다 (첫 조는 ${b.head})`);
        if (SHOW) console.log(`          그 줄: ${b.line}`);
    }
    console.log('       고치는 법: **머리말 그 줄만** 고친다 — 줄머리의 여는 괄호를 없애거나');
    console.log('       들여쓰기를 바꾼다. 본문은 한 글자도 건드리지 않는다. `_touched` 기록을 남긴다.');
    if (process.argv.includes('--gate')) return 1;      // ★이 검사는 0이어야 한다 — 기준선을 안 둔다
    return 0;
}

if (require.main === module) process.exit(main());
module.exports = { annexHeadRe };
