#!/usr/bin/env node
/**
 * V5-36 — 꼬리표가 「받았다」고 말하는 조문이 **정말 그 파일에 있나**. (3-3 = ⓐ)
 *
 * 왜 이 검사가 필요한가 (뿌리 사슬 ⑤ — 묻지 않는 물음은 답이 안 나온다)
 *   타법은 전문을 안 받고 **필요한 조문만 발췌**해 둔다. 어디까지 받았는지는
 *   `families.<계층>.조문범위` 에 **사람 말로만** 적혀 있어 기계가 못 읽었다.
 *   그래서 **「이 조문이 우리 발췌 안에 있나」를 아무도 묻지 않았다.**
 *   ⇒ 3-3 이 `조문범위_기계` 배열을 만들었다. 이 검사가 그 배열을 **파일과 맞대어 본다.**
 *
 *   이 검사가 없으면 배열은 **적혀만 있는 규칙**이 된다(뿌리 사슬 ①·②).
 *
 * 무엇을 재나
 *   ✅ 있다      — 그 조가 그 파일에서 실제로 열린다
 *   ❌ 없다      — 꼬리표는 「받았다」는데 파일에 그 조가 없다 (꼬리표가 틀렸거나 수집 공백)
 *   ❌ 파일없음  — `families.<계층>.파일` 이 가리키는 파일이 없다
 *   ·  일부만   — 꼬리표가 스스로 「일부만」이라 적은 조(`조문범위_일부만_기계`). 있으면 통과로 센다
 *
 * ★자를 빌려 쓴다 (L-136)
 *   조를 찾는 일은 **챗봇이 쓰는 그 함수**(`article_text.extractArticleBlock`·
 *   `listArticleNumbers`)를 그대로 부른다. 검사용 정규식을 따로 짜면 **게이트만 초록불**이 된다.
 *
 * [연계] ← `raw/**\/_meta.json` 의 `families.<계층>.조문범위_기계`(`article_range_parse.py` 가 적는다)
 *         ← 자: `local_server/services/article_text.js`
 * 사용법: node article_range_gate.js [--list]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const LEGAL = path.dirname(path.dirname(HERE));
const RAW = path.join(LEGAL, 'raw');
const SERVICES = path.resolve(LEGAL, '../../services');
const AT = require(path.join(SERVICES, 'article_text.js'));

const SHOW = process.argv.includes('--list');
const BASE_FILE = path.join(HERE, 'baseline', 'article_range_gate.json');

/** `법률(발췌)` · `조약(발췌)` · `시행령` … 계층 이름 → article_text 가 쓰는 tier 문자열. */
function tierOf(layer) {
    const s = String(layer || '');
    if (/시행규칙|부령/.test(s)) return 'rule';
    if (/시행령|대통령령/.test(s)) return 'decree';
    if (/고시|훈령|예규|지침|행정규칙/.test(s)) return 'notice';
    return 'law';                                  // 법률·조약·그 밖
}

/** 그 계층의 본문 파일을 고른다. 꼬리표의 `파일` 칸이 먼저, 없으면 흔한 이름을 본다. */
function bodyFile(dir, layer, slot) {
    const cands = [];
    if (slot && slot.파일) cands.push(slot.파일);
    const stem = String(layer).replace(/\(.*\)$/, '').trim();
    cands.push(`${stem}_발췌.txt`, `${stem}.txt`);
    if (/조약/.test(layer)) cands.push('법률_발췌.txt', '법률.txt', '조약.txt');
    for (const c of cands) {
        const p = path.join(dir, c);
        if (fs.existsSync(p)) return p;
    }
    return null;
}

/** `제28조제1항제9호` → `제28조` (파일에서 찾는 단위는 조다). */
function joOnly(label) {
    const m = /^(제\d+조(?:의\d+)?)/.exec(String(label || ''));
    return m ? m[1] : null;
}

function metaFiles(base) {
    const out = [];
    (function walk(d) {
        let es = [];
        try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
        for (const e of es) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) { if (e.name !== '_대기') walk(p); }
            else if (e.name === '_meta.json') out.push(p);
        }
    })(base);
    return out.sort();
}

function main() {
    const r = { 자리: 0, 조: 0, 있다: 0, 없다: 0, 파일없음: 0, 일부만: 0, misses: [], noFile: [] };
    for (const mf of metaFiles(RAW)) {
        let j;
        try { j = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch (_) { continue; }
        const fam = j && j.families;
        if (!fam || typeof fam !== 'object') continue;
        const dir = path.dirname(mf);
        for (const [layer, slot] of Object.entries(fam)) {
            if (!slot || typeof slot !== 'object' || !Array.isArray(slot.조문범위_기계)) continue;
            r.자리++;
            const bf = bodyFile(dir, layer, slot);
            const rel = path.relative(RAW, dir);
            if (!bf) {
                r.파일없음 += slot.조문범위_기계.length;
                r.noFile.push(`${rel} [${layer}]`);
                continue;
            }
            const text = fs.readFileSync(bf, 'utf8');
            const tier = tierOf(layer);
            const have = new Set(AT.listArticleNumbers(text, tier));
            const partial = new Set(slot.조문범위_일부만_기계 || []);
            for (const label of slot.조문범위_기계) {
                r.조++;
                const jo = joOnly(label);
                if (!jo) { r.없다++; r.misses.push(`${rel} [${layer}] ${label} (조 표기를 못 읽음)`); continue; }
                const ok = have.has(jo) || AT.extractArticleBlock(text, jo, tier) != null;
                if (ok) {
                    r.있다++;
                    if (partial.has(jo)) r.일부만++;
                } else {
                    r.없다++;
                    r.misses.push(`${rel} [${layer}] ${label} → ${path.basename(bf)} 에 없다`);
                }
            }
        }
    }
    console.log('  V5-36 꼬리표가 「받았다」는 조문이 정말 그 파일에 있나');
    console.log('    뜻: `families.<계층>.조문범위_기계` 의 각 조를 그 계층 본문 파일에서 찾는다 ·'
              + ' 범위: raw/ 전체 (자를 챗봇과 같은 것으로 쓴다 — article_text)');
    console.log(`    자리 ${r.자리} · 조 ${r.조}`);
    console.log(`    ✅ 있다 ${r.있다}${r.일부만 ? `  (그중 꼬리표가 스스로 「일부만」이라 적은 것 ${r.일부만})` : ''}`);
    if (r.없다) console.log(`    ❌ 없다 ${r.없다}   꼬리표는 받았다는데 파일에 그 조가 없다`);
    if (r.파일없음) console.log(`    ❌ 파일없음 ${r.파일없음}   그 계층 본문 파일을 못 찾았다`);
    if (SHOW) {
        for (const m of r.noFile) console.log('       ↳ [파일없음] ' + m);
        for (const m of r.misses) console.log('       ↳ ' + m);
    } else if (r.없다 || r.파일없음) {
        console.log('    (목록: --list)');
    }
    // 기준선 — `section_ready.js` 와 같은 규약(늘면 빨간불, 줄면 `--update` 로 잠근다)
    const now = { 없다: r.없다, 파일없음: r.파일없음 };
    if (process.argv.includes('--update')) {
        fs.mkdirSync(path.dirname(BASE_FILE), { recursive: true });
        fs.writeFileSync(BASE_FILE, JSON.stringify(now, null, 1) + '\n', 'utf8');
        console.log('    기준선을 다시 구웠다:', JSON.stringify(now));
    }
    if (process.argv.includes('--gate')) {
        let base = null;
        try { base = JSON.parse(fs.readFileSync(BASE_FILE, 'utf8')); } catch (_) { base = null; }
        if (!base) { console.log('    ⏭️  기준선이 없다 — `--update` 로 한 번 구워야 한다'); return 0; }
        const worse = Object.keys(now).filter((k) => now[k] > (base[k] || 0));
        if (worse.length) {
            for (const k of worse) console.log(`    ❌ 늘었다 ${k} ${base[k]}→${now[k]}`);
            console.log('       고치는 법: 그 조를 실제로 받거나, 꼬리표의 `조문범위` 를 사실대로 고친다.');
            console.log('       ★`조문범위_기계` 를 지워서 초록을 만들지 않는다 — 그러면 묻던 물음이 사라진다(G-34).');
            return 1;
        }
        const better = Object.keys(now).filter((k) => now[k] < (base[k] || 0));
        if (better.length) {
            for (const k of better) console.log(`    ✅ 줄었다 ${k} ${base[k]}→${now[k]} — \`--update\` 로 잠근다`);
        } else {
            console.log('    ✅ 기준선 그대로 — 늘지 않았다');
        }
    }
    return 0;
}

if (require.main === module) process.exit(main());
module.exports = { tierOf, bodyFile, joOnly };
