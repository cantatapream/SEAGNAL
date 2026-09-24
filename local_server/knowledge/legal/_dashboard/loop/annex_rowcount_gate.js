#!/usr/bin/env node
/**
 * V5-40 — **별표 쪽의 「항목수 대조」 줄을 지킨다.** (Q-18 사장님 결심 ①, 2026-09-24)
 *
 * [왜]
 *   §6-F 는 2026-08-17 부터 *"원문의 호·목·행 수를 세어 적어라"* 라고 했지만 **세는 법이 없었고,
 *   그 줄이 있는지 아무도 안 봤다.** 199쪽 가운데 실제로 적힌 쪽은 손에 꼽는다.
 *   규칙을 글로만 적으면 아무도 안 지킨다(§6-H 가 21라운드를 그렇게 지나갔다 — 뿌리 사슬 ①·③).
 *
 * [무엇을 보나 — 세는 법은 §6-F 와 `article_text.countBoxRows` 가 임자다(L-136)]
 *   찾는 줄:  `항목수 대조(§6-F): 원문 3행 / 위키 3행`
 *   ① 그 줄이 있는 쪽 — **`원문 N행` 이 raw 를 실제로 센 수와 같은가**(기계가 판정한다)
 *   ② 그 줄이 있는 쪽 — `원문 N` 과 `위키 M` 이 같은가. 다르면 **바로 아랫줄에 까닭**이 있어야 한다.
 *   ③ 그 줄이 없는 쪽 — 센다. **기준선으로 잠가 늘지 못하게 한다.**
 *
 * [★기준선을 어떻게 잡나 — G-49]
 *   지금 「줄이 없는 쪽」이 대다수다. 한꺼번에 빨간불을 켜면 아무도 안 본다.
 *   그래서 **「없는 쪽」은 기준선으로 잠그고**(늘면 빨간불), **①②는 처음부터 0이어야 한다** —
 *   ①②는 **적어 놓고 틀린 것**이라서 한 건도 봐줄 수 없다. 거짓이 적혀 있는 것이 제일 나쁘다.
 *
 * [연계] ← `wiki/annexes/*.md` · 자: `article_text.countBoxRows`(§6-F) · `_SCHEMA.md` §6-F
 *         기준선 `_dashboard/loop/baseline/annex_rowcount.json`
 * 사용법: node annex_rowcount_gate.js [--list] [--gate] [--update]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const LEGAL = path.dirname(path.dirname(HERE));
const REPO = path.dirname(path.dirname(path.dirname(LEGAL)));
const WIKI = path.join(LEGAL, 'wiki', 'annexes');
const RAW = path.join(LEGAL, 'raw');
const AT = require(path.resolve(LEGAL, '../../services/article_text.js'));
const BASE = path.join(HERE, 'baseline', 'annex_rowcount.json');
const argv = process.argv.slice(2);

/**
 * §6-F 가 정한 적는 꼴. 두 가지를 받는다:
 *   `원문 N행 / 위키 M행`                    ← **확정**된 것(사람이 세어 적었다)
 *   `원문 N행 / 위키 미확인(기계 셈 M행)`    ← **사람 몫**. M 은 후보일 뿐 판정이 아니다.
 * ★기계가 위키 쪽을 못 센다는 것이 요점이다 — 위키는 원문 표를 다시 짠다(`〃` 를 풀고 칸을 합친다).
 *   실측: 낚시 시행령 별표1 은 **원문 5행인데 위키 표는 13줄**이다. 같은 내용을 다르게 그린 것이다.
 *   3-28 에서도 박스 표 80쪽 중 자동 대조가 맞은 것은 **9쪽뿐**이었다.
 *   그래서 「미확인」을 **초록으로 통과시키되 따로 세어** 사람이 얼마나 남았는지 늘 보이게 한다.
 */
const ROW_RE = /항목수\s*대조\s*\(?§?6-F\)?\s*[::]\s*원문\s*(\d+)\s*행\s*\/\s*위키\s*(?:(\d+)\s*행|미확인\s*\(\s*기계\s*셈\s*(\d+)\s*행\s*\))/;
/** 수가 다를 때 바로 아래에 있어야 하는 까닭 줄. */
const WHY_RE = /(까닭|이유|왜|일부러|뺐|생략|옮기지)/;
/**
 * 그 쪽이 어느 raw 별표를 가리키나 — ★**살아 있는 출처 선언만** 쓴다.
 * ⚠2026-09-24 — 처음에는 쪽 안의 `raw/…txt` 를 **아무거나** 주웠다. 그랬더니
 *   `| 2026-07-19 | … 별표9~16 raw에 있으나 …` 같은 **이력 표 줄**과 옛 검증 메모까지 주워
 *   **「적힌 경로가 안 열린다」 5쪽**을 만들어 냈다. **그 5쪽은 결함이 아니었다** —
 *   이력 줄은 과거 서술이지 지금의 출처 선언이 아니다(`exact_claim_recheck.py` 가 먼저 배운 것과 같은 병).
 *   자를 좁히니 **살아 있는 선언 55쪽 · 안 열리는 것 0개**다.
 * [세는 법] `> raw 원문: \`raw/…txt\`` 꼴 한 줄만 본다. 이력 표 줄·본문 속 언급은 세지 않는다.
 */
const RAWPATH_RE = /^\s*>?\s*(?:★)?\s*raw\s*원문\s*[::]\s*`?(raw\/[^`\s]+\.txt)`?/gm;

function pages() {
    let out = [];
    try { out = fs.readdirSync(WIKI).filter((f) => f.endsWith('.md')); } catch (_) { }
    return out.sort();
}

function check() {
    const r = { 쪽: 0, 줄있음: 0, 줄없음: 0, 확정: 0, 사람몫: 0, 원문수어긋남: 0, 위키수어긋남: 0, raw못찾음: 0 };
    const bad = { 원문수어긋남: [], 위키수어긋남: [], raw못찾음: [] };
    const none = [];
    for (const f of pages()) {
        r.쪽++;
        const txt = fs.readFileSync(path.join(WIKI, f), 'utf8');
        const lines = txt.split('\n');
        const i = lines.findIndex((l) => ROW_RE.test(l));
        if (i < 0) { r.줄없음++; none.push(f); continue; }
        r.줄있음++;
        const m = ROW_RE.exec(lines[i]);
        const say원문 = Number(m[1]);
        const 확정 = m[2] !== undefined;                 // 사람이 세어 적었나
        const say위키 = Number(확정 ? m[2] : m[3]);
        if (확정) r.확정++; else r.사람몫++;
        // ① 적힌 「원문 N행」이 raw 를 실제로 센 수와 같은가
        RAWPATH_RE.lastIndex = 0;
        const paths = [...new Set([...txt.matchAll(RAWPATH_RE)].map((m) => m[1]))]
            .filter((p) => p.includes('/별표/'));
        let real = null;
        for (const p of paths) {
            const abs = path.join(REPO, 'local_server/knowledge/legal', p);
            const abs2 = path.join(LEGAL, p);
            const use = fs.existsSync(abs) ? abs : (fs.existsSync(abs2) ? abs2 : null);
            if (!use) continue;
            const n = AT.countBoxRows(fs.readFileSync(use, 'utf8'));
            real = real === null ? n : real + n;
        }
        if (real === null) {
            r.raw못찾음++;
            bad.raw못찾음.push(`${f}  ← 쪽 안에 raw 별표 경로가 없다(무엇과 맞췄는지 알 수 없다)`);
        } else if (real !== say원문) {
            r.원문수어긋남++;
            bad.원문수어긋남.push(`${f}  적힌 원문 ${say원문}행 · 실제로 세니 ${real}행`);
        }
        // ② 원문 수와 위키 수가 다른데 까닭이 없다
        // ★「미확인」은 아직 판정이 아니다 — 수가 달라도 결함으로 세지 않는다.
        if (확정 && say원문 !== say위키 && !WHY_RE.test(lines.slice(i + 1, i + 4).join(' '))) {
            r.위키수어긋남++;
            bad.위키수어긋남.push(`${f}  원문 ${say원문} ≠ 위키 ${say위키} 인데 **까닭이 안 적혀 있다**`);
        }
    }
    return { r, bad, none };
}

function main() {
    const { r, bad, none } = check();
    console.log('  V5-40 별표 쪽의 「항목수 대조」 (§6-F · Q-18 결심 ①)');
    console.log(`    뜻: 「항목수 대조(§6-F): 원문 N행 / 위키 M행」 줄을 찾아 **raw 를 직접 세어** 맞춰 본다`);
    console.log(`    세는 법의 임자: article_text.countBoxRows (챗봇이 쓰는 그 함수 · L-136)\n`);
    console.log(`    별표 쪽 ${r.쪽}개`);
    console.log(`    ·  대조 줄이 있다        ${String(r.줄있음).padStart(4)}`);
    console.log(`    ·  └ 사람이 확정했다     ${String(r.확정).padStart(4)}`);
    console.log(`    ·  └ 위키 쪽은 사람 몫   ${String(r.사람몫).padStart(4)}   기계는 원문 쪽만 센다 — 위키는 표를 다시 짜서 못 센다`);
    console.log(`    ${r.원문수어긋남 ? '❌' : '✅'} 적힌 원문 수가 틀렸다  ${String(r.원문수어긋남).padStart(4)}   ★적어 놓고 틀린 것 — 한 건도 봐주지 않는다`);
    console.log(`    ${r.위키수어긋남 ? '❌' : '✅'} 수가 다른데 까닭 없다  ${String(r.위키수어긋남).padStart(4)}`);
    console.log(`    ${r.raw못찾음 ? '⚠' : '✅'} 무엇과 맞췄는지 모름  ${String(r.raw못찾음).padStart(4)}`);
    console.log(`    ·  대조 줄이 없다        ${String(r.줄없음).padStart(4)}   기준선으로 잠근다 — 줄 수는 있어도 늘 수 없다`);
    if (argv.includes('--list')) {
        for (const k of ['원문수어긋남', '위키수어긋남', 'raw못찾음']) {
            for (const b of bad[k]) console.log(`       ↳ [${k}] ${b}`);
        }
        console.log(`       ↳ 대조 줄이 없는 쪽 ${none.length}개 (앞 20개)`);
        for (const n of none.slice(0, 20)) console.log(`           · ${n}`);
    }
    const now = { 원문수어긋남: r.원문수어긋남, 위키수어긋남: r.위키수어긋남, 줄없음: r.줄없음, 사람몫: r.사람몫 };
    if (argv.includes('--update')) {
        fs.mkdirSync(path.dirname(BASE), { recursive: true });
        fs.writeFileSync(BASE, JSON.stringify(now, null, 1) + '\n', 'utf8');
        console.log('    기준선을 다시 구웠다:', JSON.stringify(now));
    }
    if (argv.includes('--gate')) {
        if (r.원문수어긋남 || r.위키수어긋남) {
            console.log('    ❌ **적어 놓고 틀린 자리가 있다.** 고치는 법:');
            console.log('       · 「원문 N행」은 `node -e "…countBoxRows(raw)"` 가 센 수를 적는다(짐작 금지).');
            console.log('       · 수가 다르면 **왜 덜 옮겼는지**를 바로 아랫줄에 적는다.');
            console.log('       ★줄을 지워서 초록을 만들지 않는다 — 그러면 「없음」이 늘어 그쪽이 빨간불이다.');
            return 1;
        }
        let base = null;
        try { base = JSON.parse(fs.readFileSync(BASE, 'utf8')); } catch (_) { }
        if (!base) { console.log('    ⏭️  기준선이 없다 — `--update` 로 한 번 구워야 한다'); return 0; }
        if (now.사람몫 > (base.사람몫 ?? now.사람몫)) {
            console.log(`    ❌ 늘었다 사람몫 ${base.사람몫}→${now.사람몫} — 확정한 자리를 되돌렸다`);
            return 1;
        }
        if (now.줄없음 > base.줄없음) {
            console.log(`    ❌ 늘었다 대조줄없음 ${base.줄없음}→${now.줄없음} — 새 별표 쪽에 §6-F 줄을 안 적었다`);
            return 1;
        }
        console.log(now.줄없음 < base.줄없음
            ? `    ✅ 줄었다 대조줄없음 ${base.줄없음}→${now.줄없음} — \`--update\` 로 잠근다`
            : '    ✅ 기준선 그대로 — 늘지 않았다');
    }
    return 0;
}

if (require.main === module) process.exit(main());
