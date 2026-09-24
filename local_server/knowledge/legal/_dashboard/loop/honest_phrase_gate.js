#!/usr/bin/env node
/**
 * V5-38 — 위키의 **마무리 정직문구**가 확정 3유형과 같은 말인가. (3-7)
 *
 * 왜 이 검사가 필요한가
 *   「모른다·못 한다」를 말하는 자리가 1,847곳인데 **문구가 제각각**이었다.
 *   같은 뜻을 다른 말로 하면 ⓐ사용자가 뜻을 못 잡고 ⓑ기계가 「정직한 표시」를 **세지 못한다**
 *   (뿌리 사슬 ⑥ — 세는 법을 안 정하면 같은 것이 다르게 측정된다).
 *   → 사용자가 3유형을 확정했다(2026-09-24). 문구는 `_dashboard/honest_phrases.json` 한 곳에 있고
 *     이 검사는 **읽기만** 한다(L-136 · 뿌리 사슬 ①).
 *
 * 무엇을 재나
 *   ✅ 맞음  — 확정 문구와 (칸을 뺀) 글자가 같다
 *   ⚠ 닮음  — 같은 뜻인데 글자가 다르다 → 고칠 자리
 *   빈칸    — 확정 문구 꼴인데 `{소관부서}`·`☎` 가 **비어 있다** → 빈 괄호를 남긴 자리
 *
 *   ★기준선을 둔다. 문구를 바꾸면 **사용자가 보는 말**이 바뀌므로 한꺼번에 안 바꾼다 —
 *     「닮음」이 늘지 않게 지키면서 줄여 나간다.
 *
 * 무엇을 안 세나 (0-4 가 두 번 틀린 자리다)
 *   · 앞머리(frontmatter) — `소관부처:`·`연락처:` 줄을 문장으로 세면 안 된다
 *   · `## 변경 이력` 절 아래 — 그날의 감사 기록이지 사용자에게 하는 말이 아니다
 *   · 표 줄(`|` 로 시작) — 칸 안의 말은 문장이 아니다
 *
 * [연계] ← `_dashboard/honest_phrases.json`(규칙) · `wiki/**\/*.md`
 *         기준선 `_dashboard/loop/baseline/honest_phrase.json`
 * 사용법: node honest_phrase_gate.js [--list] [--gate] [--update]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const LEGAL = path.dirname(path.dirname(HERE));
const WIKI = path.join(LEGAL, 'wiki');
const RULES = JSON.parse(fs.readFileSync(path.join(LEGAL, '_dashboard', 'honest_phrases.json'), 'utf8'));
const BASE_FILE = path.join(HERE, 'baseline', 'honest_phrase.json');
const argv = process.argv.slice(2);

/** 확정 문구를 정규식으로 — `{칸}` 자리는 아무 글자나 받는다. */
function exactRe(tpl) {
    const parts = String(tpl).split(/\{[^}]+\}/).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(parts.join('[^\\n]{0,80}'));
}

/**
 * 확정 문구와 **거의 같은** 말 — 어미·조사만 다른 자리다. 여기만 「고칠 자리」로 센다.
 *
 * ★2026-09-24 실측으로 자를 좁혔다. 처음엔 `단정하지 않는다`·`규정 없음`·`개별 심사` 처럼
 *   **낱말**로 잡았더니 **2,102줄**이 걸렸는데, 표본을 읽어 보니 대부분 마무리 문구가 아니라
 *   **본문 문장·비교표 줄**이었다(`구명조끼 색상 ↔ 안전표지판 색채 — 서로 무관(원문 확인)`).
 *   그 수를 기준선으로 박으면 **뜻 없는 숫자를 지키게** 된다(⑥).
 *   ⇒ 확정 문구의 **뼈대 두 마디 이상**이 같은 줄만 「고칠 자리」로 센다.
 */
const NEAR = {
    A: [/한쪽으로\s*정해지지\s*않(아|으므로|기)[^\n]{0,40}단정/,
        /단정[^\n]{0,20}(않는다|않습니다)[^\n]{0,60}(확인하시기|문의)/],
    B: [/(에\s*대한|에\s*관한)?\s*규정은?\s*원문에\s*없(다|습니다)/],
    C: [/(개별\s*심사|실무\s*운용)[^\n]{0,40}(달라지므로|따라\s*달라)[^\n]{0,60}(단정|확인하시기)/],
};

const SKIP_LINE = /^\s*\||^\s*$|^\s*[-*+]\s*$/;

/**
 * 한 줄을 **문장**으로 가른다. ★단위가 줄이면 안 된다 — 이 저장소의 위키는 한 줄이
 * 한 단락이라(수백 자) 줄로 재면 「어디가 걸렸는지」를 볼 수 없고 수도 부풀려진다
 * (실측 2026-09-24: 줄 단위 155 → 읽어 보니 대부분 문장 한복판이 걸린 것이었다).
 * `다.`·`습니다.`·`)` 뒤에서 끊는다. 조문 인용의 `제1항.` 같은 것은 안 끊는다.
 */
function sentences(line) {
    return String(line)
        .replace(/(다|요|까)\.\s+/g, '$1.\u0000')
        .replace(/(습니다|입니다)\.\s*/g, '$1.\u0000')
        .split('\u0000')
        .map((x) => x.trim())
        .filter(Boolean);
}

function files(dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) files(p, out);
        else if (e.name.endsWith('.md')) out.push(p);
    }
    return out;
}

/** 본문 줄만 돌려준다 — 앞머리·`## 변경 이력` 절·표 줄을 뺀다. */
function bodyLines(text) {
    const lines = String(text).split('\n');
    const out = [];
    let i = 0;
    if (lines[0] && lines[0].trim() === '---') {          // 앞머리를 넘긴다
        i = 1;
        while (i < lines.length && lines[i].trim() !== '---') i++;
        i++;
    }
    let inHistory = false;
    for (; i < lines.length; i++) {
        const L = lines[i];
        if (/^#{1,6}\s/.test(L)) inHistory = /변경\s*이력/.test(L);
        if (inHistory) continue;
        if (SKIP_LINE.test(L)) continue;
        out.push(L);
    }
    return out;
}

function main() {
    const R = { 맞음: 0, 닮음: 0, 빈칸: 0, hits: [], blanks: [] };
    const exact = {};
    for (const [k, v] of Object.entries(RULES.유형)) exact[k] = exactRe(v.문구);
    for (const f of files(WIKI, [])) {
        const rel = path.relative(WIKI, f);
        const ls = [];
        for (const line of bodyLines(fs.readFileSync(f, 'utf8'))) ls.push(...sentences(line));
        for (const L of ls) {
            for (const k of Object.keys(RULES.유형)) {
                const ok = exact[k].test(L);
                const near = NEAR[k].some((re) => re.test(L));
                if (!ok && !near) continue;
                if (ok) {
                    // 빈 괄호를 남겼나 — `(☎)`·`() 로 확인`·`{소관부서}` 그대로
                    if (/\(\s*☎?\s*\)|\{소관부서\}|\{전화\}|\{무엇\}/.test(L)) {
                        R.빈칸++; R.blanks.push(`${rel} [${k}] ${L.trim().slice(0, 90)}`);
                    } else R.맞음++;
                } else {
                    R.닮음++; R.hits.push(`${rel} [${k}] ${L.trim().slice(0, 95)}`);
                }
                break;                                   // 한 줄은 한 유형으로만 센다
            }
        }
    }
    console.log('  V5-38 마무리 정직문구가 확정 3유형과 같은 말인가');
    console.log('    뜻: `_dashboard/honest_phrases.json` 의 확정 문구(A 해석이 갈린다 · B 원문에 없다 ·'
              + ' C 개별 사안이다)와 글자가 같은가 · 범위: wiki/ 본문 줄(앞머리·변경이력·표는 뺀다)');
    console.log(`    ✅ 확정 문구 그대로 ${R.맞음}`);
    if (R.닮음) console.log(`    ⚠ 거의 같다 ${R.닮음}   어미·조사만 다르다 → 확정 문구로 모을 자리`);
    if (R.빈칸) console.log(`    ❌ 빈칸 ${R.빈칸}   확정 문구 꼴인데 소관부서·전화가 비어 있다`);
    if (argv.includes('--list')) {
        for (const x of R.blanks) console.log('       ↳ [빈칸] ' + x);
        for (const x of R.hits.slice(0, 40)) console.log('       ↳ ' + x);
        if (R.hits.length > 40) console.log(`       … 그 밖 ${R.hits.length - 40}줄`);
    } else if (R.닮음 || R.빈칸) {
        console.log('    (목록: --list)');
    }
    // ★기준선에 「거의 같다」를 **안 넣는다** — 그 수는 고쳐 나갈 후보지 지킬 값이 아니다.
    //   지킬 것은 둘이다: 빈칸은 **0**이어야 하고, 이미 확정 문구로 바꾼 자리는 **뒷걸음 없이** 늘어야 한다.
    const now = { 빈칸: R.빈칸, 확정문구_최소: -R.맞음 };
    if (argv.includes('--update')) {
        fs.mkdirSync(path.dirname(BASE_FILE), { recursive: true });
        fs.writeFileSync(BASE_FILE, JSON.stringify(now, null, 1) + '\n', 'utf8');
        console.log('    기준선을 다시 구웠다:', JSON.stringify(now));
    }
    if (argv.includes('--gate')) {
        let base = null;
        try { base = JSON.parse(fs.readFileSync(BASE_FILE, 'utf8')); } catch (_) { base = null; }
        if (!base) { console.log('    ⏭️  기준선이 없다 — `--update` 로 한 번 구워야 한다'); return 0; }
        const worse = Object.keys(now).filter((k) => now[k] > (base[k] || 0));
        if (worse.length) {
            for (const k of worse) console.log(`    ❌ 늘었다 ${k} ${base[k]}→${now[k]}`);
            console.log('       고치는 법: 확정 문구(honest_phrases.json)로 바꿔 적는다.');
            console.log('       (`확정문구_최소` 가 늘었다는 것은 **확정 문구가 줄었다**는 뜻이다 — 음수로 잰다)');
            console.log('       ★문구를 규칙 파일에서 지워 초록을 만들지 않는다 — 그러면 묻던 물음이 사라진다(G-34).');
            return 1;
        }
        const better = Object.keys(now).filter((k) => now[k] < (base[k] || 0));
        if (better.length) {
            for (const k of better) console.log(`    ✅ 줄었다 ${k} ${base[k]}→${now[k]} — \`--update\` 로 잠근다`);
        } else console.log('    ✅ 기준선 그대로 — 늘지 않았다');
    }
    return 0;
}

if (require.main === module) process.exit(main());
module.exports = { exactRe, bodyLines, sentences };
