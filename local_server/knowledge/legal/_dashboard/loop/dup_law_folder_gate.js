#!/usr/bin/env node
/**
 * V5-34 — 같은 법이 **기준법 폴더와 타법 폴더에 이중으로** 있나 (2026-09-23 신설, Q-2 · 3-11)
 *
 * [무엇인가] `raw/<도메인>/<법>/` 에 **전문**이 있는데 `raw/15_관련타부처/<법>/` 에도 **발췌**가 있다.
 *   실측(2026-09-23): **25개**. 예) 해양환경관리법 6,083,822자 ↔ 3,062자.
 *
 * [★챗봇은 안 속는다 — 검사기가 속는다]
 *   `resolveBase()` 를 10번 돌려 보니 **10번 다 기준법(전문)** 을 골랐다(조사 1-3).
 *   그런데 V5-16(「다음 각 목」이라 해 놓고 목이 없는 자리)이 남긴 자리 중 여럿이
 *   **이 발췌본 탓**이다 — 가짜 결손이 진짜 결손에 섞인다.
 *
 * [★왜 그냥 지우지 않나 — 2026-09-23 전수검색이 알려 준 것]
 *   사용자는 Q-2 에서 *"전수검색 후 지운다"* 로 정했다. 그래서 전수로 찾았다:
 *     `15_관련타부처/<그 법>` 을 글로 적은 곳 **182파일**
 *       위키(사람이 읽는 글) 56 · 자료 JSON 8 · 감사·범위 리포트 23 · 그 밖 문서 19 · **도구 1**
 *   ⇒ ★**그리고 더 중요한 것**: 그 도구(`add_other_law_article.js`)가 바로 **이 폴더를 만드는 도구**다.
 *     즉 25개는 **실수로 생긴 복사본이 아니라, 타법 발췌 작업이 설계대로 낸 결과**다.
 *     **도구를 안 고치고 지우면 다음 인용 때 그대로 되살아난다.**
 *   그래서 이 게이트는 **지우지 않고 세기만 한다** — 늘면 실패.
 *   지울지 말지는 위 사실을 얹어 사람이 다시 정한다(G-34).
 *
 * [무엇을 재나] 기준법 도메인 폴더와 `15_관련타부처` 에 **이름이 같은 폴더**의 수.
 */
const fs = require('fs');
const path = require('path');

const LEGAL = path.resolve(__dirname, '../..');
const RAW = path.join(LEGAL, 'raw');
const OTHER = '15_관련타부처';
const BASE = path.join(__dirname, 'baseline', 'dup_law_folder.json');

function dirs(p) {
    try { return fs.readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); }
    catch (_) { return []; }
}

function txtSize(p) {
    let n = 0;
    const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const q = path.join(d, e.name);
            if (e.isDirectory()) walk(q);
            else if (e.name.endsWith('.txt')) n += fs.statSync(q).size;
        }
    };
    try { walk(p); } catch (_) { /* 없으면 0 */ }
    return n;
}

function find() {
    const base = new Map();                       // 법이름 → 도메인
    for (const d of dirs(RAW)) {
        if (d === OTHER || d.startsWith('_')) continue;
        for (const law of dirs(path.join(RAW, d))) if (!base.has(law)) base.set(law, d);
    }
    const out = [];
    for (const law of dirs(path.join(RAW, OTHER))) {
        if (!base.has(law)) continue;
        const dom = base.get(law);
        out.push({ 법: law, 기준법폴더: dom,
            전문: txtSize(path.join(RAW, dom, law)),
            발췌: txtSize(path.join(RAW, OTHER, law)) });
    }
    return out.sort((a, b) => b.전문 - a.전문);
}

function main() {
    const rows = find();
    console.log(`  같은 법이 **기준법 폴더와 타법 폴더에 둘 다** 있는 것 ${rows.length}개`);
    console.log('     ⚠챗봇은 안 속는다(`resolveBase` 가 전문을 고른다) — **검사기가 속는다**(V5-16 의 가짜 결손).');
    for (const r of rows.slice(0, 5)) {
        console.log(`     · ${r.법}  ${r.기준법폴더} ${r.전문.toLocaleString()}자  ↔  ${OTHER} ${r.발췌.toLocaleString()}자`);
    }
    if (rows.length > 5) console.log(`     … 그 밖 ${rows.length - 5}개 (전부 보려면 --list)`);
    if (process.argv.includes('--list')) {
        rows.forEach((r) => console.log(`     · ${r.법} | ${r.기준법폴더} ${r.전문} | ${OTHER} ${r.발췌}`));
    }
    const watch = { 이중폴더: rows.length };
    if (process.argv.includes('--update')) {
        fs.writeFileSync(BASE, JSON.stringify(watch, null, 2) + '\n');
        console.log('  기준선을 다시 구웠다:', JSON.stringify(watch));
        return 0;
    }
    let b;
    try { b = JSON.parse(fs.readFileSync(BASE, 'utf8')); } catch (_) {
        console.log('  ⚠기준선이 없다 — `--update` 로 한 번 구워야 한다'); return 1;
    }
    if (watch.이중폴더 > b.이중폴더) {
        console.log(`  ❌ 늘었다: ${b.이중폴더} → ${watch.이중폴더}`);
        console.log('     → 전문을 이미 가진 법에 **타법 발췌 폴더를 또 만들었다**.');
        console.log('        `add_other_law_article.js` 가 그 자리에서 경고한다 — 그 경고를 넘기지 않는다(3-11).');
        return 1;
    }
    console.log(watch.이중폴더 < b.이중폴더
        ? `  ✅ 줄었다: ${b.이중폴더} → ${watch.이중폴더} — \`--update\` 로 잠근다`
        : '  ✅ 기준선 그대로 — 늘지 않았다 (지울지 말지는 사람이 정한다 — Q-2 재확인 필요)');
    return 0;
}

if (require.main === module) process.exit(main());
module.exports = { find };
