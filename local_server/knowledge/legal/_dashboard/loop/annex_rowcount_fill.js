#!/usr/bin/env node
/**
 * §6-F 항목수 대조 줄의 **기계 몫**을 채운다. (Q-18 결심 ① 뒤끝, 2026-09-24)
 *
 * [기계가 하는 것 / 못 하는 것 — 선을 분명히 긋는다]
 *   ✅ **원문 N행** — `article_text.countBoxRows()` 가 raw 를 직접 센다. 이건 기계가 확실히 한다.
 *   ❌ **위키 M행** — 기계가 못 한다. 위키는 원문 표를 다시 짜기 때문이다(`〃` 를 풀고, 비고를
 *      목록으로 내리고, 칸을 합친다). 3-28 실측에서 박스 표 80쪽 중 **자동 대조가 맞은 것은 9쪽뿐**이다.
 *   ⇒ 그래서 위키 쪽은 **`미확인(기계 셈 M행)`** 이라고 적는다. M 은 **후보일 뿐 판정이 아니다.**
 *      사람이 보고 `미확인(...)` 를 지우고 `M행` 으로 바꾸면 그때 확정된다.
 *
 * [어디에 적나] 쪽의 **살아 있는 출처 선언**(`> raw 원문: \`raw/…\``) 바로 아래.
 *   ⚠이력 표 줄(`| 2026-07-19 | …`)의 raw 언급은 **출처 선언이 아니다** — 쓰지 않는다.
 *     (처음에 아무 `raw/` 나 주웠다가 있지도 않은 결함 5쪽을 만들어 냈다.)
 *
 * [표가 아닌 별표는 건드리지 않는다]
 *   `countBoxRows()` 가 0 을 주는 쪽이 있다 — 원문이 표가 아니라 **호·목 나열**인 경우다.
 *   거기에 `원문 0행` 이라고 적으면 **거짓**이 된다. 세는 법이 다르므로 **손대지 않고 세어만 둔다.**
 *
 * [연계] → `annex_rowcount_gate.js`(V5-40) 가 이 줄을 읽는다 · `_SCHEMA.md` §6-F
 * 사용법: node annex_rowcount_fill.js [--apply]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const LEGAL = path.dirname(path.dirname(HERE));
const WIKI = path.join(LEGAL, 'wiki', 'annexes');
const AT = require(path.resolve(LEGAL, '../../services/article_text.js'));
const APPLY = process.argv.includes('--apply');

const SRC_RE = /^([ \t]*>?[ \t]*(?:★)?[ \t]*raw[ \t]*원문[ \t]*[::][ \t]*`?)(raw\/[^`\s]+\.txt)(`?.*)$/;
const HAS_RE = /항목수\s*대조\s*\(?§?6-F\)?\s*[::]/;

/**
 * 위키 마크다운 표의 **논리 행** — `|---|` 구분줄은 빼고 센다.
 * ★이건 **후보를 내는 자**지 판정자가 아니다(위 머리말 참고). 원문 쪽 자(`countBoxRows`)와
 *   달리 규약이 아니므로 `article_text.js` 에 두지 않는다.
 */
function countMdRows(text) {
    let n = 0;
    for (const l of String(text || '').split('\n')) {
        const t = l.trim();
        if (!t.startsWith('|')) continue;
        if (/^\|[\s:|-]+\|$/.test(t)) continue;          // |---|---| 구분줄
        n++;
    }
    return n;
}

function main() {
    const files = fs.readdirSync(WIKI).filter((f) => f.endsWith('.md')).sort();
    let done = 0, already = 0, noSrc = 0, notTable = 0, notByl = 0;
    const zero = [];
    for (const f of files) {
        const p = path.join(WIKI, f);
        const txt = fs.readFileSync(p, 'utf8');
        if (HAS_RE.test(txt)) { already++; continue; }
        const lines = txt.split('\n');
        const i = lines.findIndex((l) => SRC_RE.test(l));
        if (i < 0) { noSrc++; continue; }
        const srcs = [...new Set(lines.filter((l) => SRC_RE.test(l))
            .map((l) => SRC_RE.exec(l)[2]))].filter((s) => s.includes('/별표/'));
        if (!srcs.length) { notByl++; continue; }
        let real = 0, missing = false;
        for (const s of srcs) {
            const abs = path.join(LEGAL, s);
            if (!fs.existsSync(abs)) { missing = true; break; }
            real += AT.countBoxRows(fs.readFileSync(abs, 'utf8'));
        }
        if (missing) { noSrc++; continue; }
        if (real === 0) { notTable++; zero.push(f); continue; }   // 표가 아니다 — 손대지 않는다
        const m = countMdRows(txt);
        const prefix = (lines[i].match(/^[ \t]*>?[ \t]*/) || [''])[0];
        const line = `${prefix}항목수 대조(§6-F): 원문 ${real}행 / 위키 미확인(기계 셈 ${m}행)`;
        // 같은 출처 선언 묶음의 **마지막 줄 아래**에 끼운다
        let at = i;
        while (at + 1 < lines.length && SRC_RE.test(lines[at + 1])) at++;
        lines.splice(at + 1, 0, line);
        if (APPLY) fs.writeFileSync(p, lines.join('\n'), 'utf8');
        done++;
    }
    console.log(`  별표 쪽 ${files.length}개`);
    console.log(`    ✅ ${APPLY ? '적었다' : '적을 것'}                 ${String(done).padStart(4)}   원문 쪽은 기계가 센다 · 위키 쪽은 「미확인」`);
    console.log(`    ·  이미 있다               ${String(already).padStart(4)}`);
    console.log(`    ·  ★표가 아니다(호·목 나열) ${String(notTable).padStart(3)}   세는 법이 달라 **손대지 않는다**`);
    console.log(`    ·  가리키는 것이 별표가 아니다 ${String(notByl).padStart(2)}   고시 본문 안의 별표다`);
    console.log(`    ·  살아 있는 출처 선언이 없다 ${String(noSrc).padStart(3)}`);
    for (const z of zero) console.log(`       ↳ [표 아님] ${z}`);
    if (!APPLY) console.log('\n  (미리보기다. 적용하려면 --apply)');
    return 0;
}

if (require.main === module) process.exit(main());
