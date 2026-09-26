#!/usr/bin/env node
/**
 * V5-28 — `index.md` 의 목차 링크가 **눌러서 열리나** (2026-09-23 신설, G-25)
 *
 * [왜] `_SCHEMA §13` — *"목차를 갱신한다 … 방치 금지(**누가 언제 봐도 목차로 찾아가야 한다**)."*
 *   읽는 **코드**는 없다. 읽는 것이 **사람**이다. 그래서 "코드가 안 읽으니 피해 0" 이 아니다 —
 *   눌러서 안 열리면 그 목차는 제 일을 못 한다.
 *
 * [무엇이었나 — 2026-09-23 실측] 링크 **1,037개 중 열리는 것이 3개**였다. 원인이 셋이었다:
 *   ① `wiki/` 접두사 누락 …… **1,020개**. `index.md` 는 `legal/` 에 있는데 쪽은 `legal/wiki/` 에 있다.
 *   ② 괄호를 안 감쌌다 …… **12개**. 파일명에 `(` 가 든 쪽이 12개인데
 *      마크다운 링크는 **첫 `)` 에서 끊긴다**(`선박평형수(船舶平衡水` 에서 잘렸다).
 *   ③ 가리키는 쪽이 없다 …… **2개**. `index.md` 가 **2026-08-22 이후 한 달째 재생성이 안 됐다**
 *      — §13 이 "방치 금지"라고 적은 바로 그 상태였다.
 *   `gen_index.py` 를 고치고 다시 만들어 **1,040개 전부 열린다**.
 *
 * [무엇을 재나] **0 을 요구한다.** 기준선을 두지 않는다 — 목차가 안 열리는 것은
 *   취향이 아니라 고장이다. 고치는 법도 한 줄이다(`python3 _dashboard/gen_index.py`).
 */
const fs = require('fs');
const path = require('path');

const LEGAL = path.resolve(__dirname, '../..');
const INDEX = path.join(LEGAL, 'index.md');
// `](<경로>)` 와 `](경로)` 둘 다 받는다 — `<>` 는 괄호가 든 이름을 감쌀 때 쓴다
const LINK_RE = /\]\((<[^>]+>|[^)]+)\)/g;

function check() {
    let t;
    try { t = fs.readFileSync(INDEX, 'utf8'); } catch (_) { return { 없음: true }; }
    const dead = [];
    let n = 0, m;
    LINK_RE.lastIndex = 0;
    while ((m = LINK_RE.exec(t))) {
        let href = m[1];
        if (href.startsWith('<') && href.endsWith('>')) href = href.slice(1, -1);
        if (/^(https?:|#)/.test(href)) continue;
        n++;
        const p = path.resolve(LEGAL, href.split('#')[0]);
        if (!fs.existsSync(p)) dead.push(href);
    }
    return { 링크: n, 죽은링크: dead };
}

function main() {
    const r = check();
    if (r.없음) { console.log('  ❌ index.md 가 없다'); return 1; }
    console.log(`  목차 링크 ${r.링크}개 — 열린다 ${r.링크 - r.죽은링크.length} · ❌안 열린다 ${r.죽은링크.length}`);
    if (!r.죽은링크.length) { console.log('  ✅ 전부 열린다'); return 0; }
    console.log('  ❌ 눌러서 안 열리는 링크가 있다 — 목차가 제 일을 못 한다(§13 "누가 언제 봐도"):');
    for (const d of r.죽은링크.slice(0, 10)) console.log('     · ' + d);
    if (r.죽은링크.length > 10) console.log(`     … 그 밖 ${r.죽은링크.length - 10}개`);
    console.log('     고치려면: python3 local_server/knowledge/legal/_dashboard/gen_index.py');
    console.log('     ⚠그래도 남으면 **가리키는 쪽이 정말 없는 것**이다 — 이름이 바뀌었거나 지워졌다.');
    return 1;
}

if (require.main === module) process.exit(main());
module.exports = { check };
