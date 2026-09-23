#!/usr/bin/env node
/**
 * V5-32 — **법령 계층 별표**를 짚은 근거 줄이 눌러서 열리나 (2026-09-23 신설, G-9 · 3-42)
 *
 * [왜 만들었나 — G-9 에서 잰 빈자리]
 *   `link_ready`(V5-8)는 근거 줄 중 **별표·별지를 짚은 933줄**을 "조문 칸이 아님"으로 넘긴다.
 *   넘긴 곳은 V5-5(뜨나)와 V5-11(열리나)이 받는데, **V5-11 은 「고시」 별표 328줄만** 본다.
 *   ⇒ **933 − 328 = 605줄**의 「눌러서 열리나」를 **아무도 안 보고 있었다.**
 *   이 도구가 그 자리를 본다 — 법률·시행령·시행규칙 별표를 짚은 줄.
 *
 * ⚠★**정정(2026-09-23) — 「605 를 정확히 덮었다」고 말하지 않는다.** 만들고 재 보니
 *   **자가 셋이고 값이 다 다르다**(뿌리 사슬 ⑥ 가 또 나왔다):
 *       link_ready 가 넘기는 `ref.mode === 'annex'` **줄**   933
 *       V5-11 이 보는 **고시 별표 줄**                        328
 *       이 도구: 계층 별표 **줄** 1,333 · **열쇠** 1,379
 *                (그중 조를 안 짚은 줄 802 — link_ready 가 넘기는 꼴에 가깝다)
 *   802 + 328 = 1,130 ≠ 933 이다. 셋이 **서로 다른 분류**(정규식 · `parseArticleRef` · tier)를 쓴다.
 *   ⇒ **이 도구가 「605」를 채운다고 적지 않는다.** 다만 **아무도 안 묻던 물음**을 묻고,
 *     그 답으로 **파일 없음 104 · 선언 어긋남 18** 을 처음으로 드러냈다. 그것이 소득이다.
 *
 * [★생산과 같은 길로 찾는다 — 베끼지 않고 부른다(L-136)]
 *   `article_text.js` 가 계층 별표를 찾는 순서 그대로다:
 *     ① `<법>/별표/<계층>_별표N.txt`  → 본문이 있으면(`hasBylBody`) 그대로 쓴다.
 *        (계층 접두 파일은 이름에 계층·번호가 다 있고 실측 2,676개 전부 선언줄과 일치한다)
 *     ② 없으면 `<법>/별표/별표N.txt`   → **선언줄이 계층도 번호도 같을 때만**(`bylDeclMatches`).
 *        계층 없는 파일은 법마다 임자가 다르다(어장관리법=시행규칙 · 항만법=시행령).
 *   ⚠`[별표 7] 삭제` 한 줄뿐인 폐지 별표는 **원문이 있는 게 아니다** — 따로 센다.
 *
 * [무엇을 재나] 기준선보다 **늘면 실패**한다. 0 을 요구하지 않는다 — 수집 공백이 섞여 있고,
 *   그것을 채우는 일은 네트워크가 필요하다.
 *
 * ★★정정(2026-09-23, 3-46) — **104 중 35줄은 「없는 것」이 아니라 「내가 잘못 본 것」이었다.**
 *   옛 서술은 지우지 않는다. 채우러 가 보니 **법이 그 별표를 아예 안 갖고 있다**는 답이
 *   자꾸 나왔다(영해및접속수역법·원양산업발전법·수상레저안전법 …). 이상해서 위키를 열었다:
 *
 *       | ⑥ 행정처분 | 낚시 관리 및 육성법 | **제38조 → 시행규칙 별표2** | … |
 *
 *   **「시행규칙」이 별표2 바로 앞에 적혀 있는데** 나는 줄의 tier(법령 칸=법률)만 보고
 *   `법률_별표2.txt` 를 찾아 놓고 "파일이 없다"고 셌다. **위키가 틀린 게 아니라 내 자가 틀렸다.**
 *   → `bylKeys` 가 이제 **별표 앞에 적힌 계층**을 읽는다(아래 머리말).
 *
 *   ⚠**두 원인을 갈라서 쟀다**(안 그러면 무엇이 고친 것인지 모른다):
 *       옛 자 + 옛 파일   없다 **104**
 *       옛 자 + 새 파일   없다  **90**   ← 실제로 받아 채운 것: **파일 12개 = 줄 17개**
 *       새 자 + 새 파일   없다  **52**   ← 자를 고쳐 준 것: **줄 35개**
 *   ✅ 열린다 **1,242 → 1,294** (90.1% → 93.8%)
 *
 *   남은 52줄 / 파일 자리 43개 = **법령 21 · 조례 22**.
 *     · 법령 21 중 16 은 **꼬리표(`families`)에 그 계층의 MST 가 없다** — 어느 판을 받을지 모른다(3-48)
 *     · 5 는 **API 가 정말 안 준다**(번호 오기이거나 진짜 공백 — 사람이 본다)
 *     · 조례 22 는 **API 가 다르다**(`target=ordin`) — 따로 한다(3-49)
 */
const fs = require('fs');
const path = require('path');
const R = require('../../../../services/legal_retriever.js');
const A = require('../../../../services/article_text.js');

const REPO = path.resolve(__dirname, '../../../../..');
const LEGAL = path.resolve(__dirname, '../..');
const WIKI = path.join(LEGAL, 'wiki');
const BASE = path.join(__dirname, 'baseline', 'byl_tier_ready.json');
const TIER_PREFIX = { law: '법률', decree: '시행령', rule: '시행규칙' };
const argv = process.argv.slice(2);

function buildBaseLawMap() {
    const m = new Map();
    try {
        const idx = JSON.parse(fs.readFileSync(path.join(LEGAL, '_dashboard', 'index.json'), 'utf8'));
        for (const p of (idx.pages || idx || [])) if (p && p.file) m.set(String(p.file), String(p.law || ''));
    } catch (_) { /* frontmatter 로 떨어진다 */ }
    return m;
}

/** 조문 칸에서 별표·별지 열쇠를 뽑는다 — `annex_ready` 와 같은 꼴.
 *
 * ★정정(2026-09-23, 3-46) — **열쇠만 뽑고 계층을 안 봤다. 그래서 내가 틀렸다.**
 *   옛 서술은 지우지 않는다. 종전에는 열쇠(`별표2`)만 돌려주고, 계층은 **줄의 tier**(법령 칸)를
 *   썼다. 그런데 위키의 조문 칸은 이렇게 적혀 있다:
 *
 *     | ⑥ 행정처분 | 낚시 관리 및 육성법 | **제38조 → 시행규칙 별표2** | … |
 *       → row.tier = law   ·  row.article = "제38조 → 시행규칙 별표2"
 *
 *   **「시행규칙」이 별표2 바로 앞에 적혀 있는데** 나는 `법률_별표2.txt` 를 찾아 놓고
 *   "파일이 없다"고 셌다. 위키가 틀린 게 아니라 **내 자가 옆 글자를 안 읽은 것**이다.
 *   실측: 그렇게 잘못 센 것이 **파일 25개 · 근거 줄 42개**였다(104 중 42).
 *
 *   그래서 이제 **별표 앞에 계층이 적혀 있으면 그것이 이긴다.** 없으면 줄의 tier 를 쓴다.
 *   ⚠줄의 tier 를 **버리는 게 아니다** — 적혀 있을 때만 덮는다.
 */
const TIER_WORD = { 법률: 'law', 시행령: 'decree', 시행규칙: 'rule' };

function bylKeys(article) {
    const src = String(article || '');
    // 조문 칸 안에 적힌 계층 낱말의 자리를 먼저 모은다.
    const marks = [];
    const tre = /(법률|시행령|시행규칙)/g;
    let t;
    while ((t = tre.exec(src)) !== null) marks.push({ at: t.index, tier: TIER_WORD[t[1]] });
    const out = new Map();
    const re = /(별표|별지|서식)\s*제?\s*(\d+(?:의\d+)?)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        const key = (m[1] === '별표' ? '별표' : '서식') + m[2];
        // **그 별표 앞에 있는 마지막 계층 낱말**이 임자다. 없으면 null(=줄의 tier 를 쓴다).
        let own = null;
        for (const k of marks) if (k.at < m.index) own = k.tier;
        if (!out.has(key)) out.set(key, own);
    }
    return [...out.entries()].map(([key, tier]) => ({ key, tier }));
}

function check() {
    const BASE_LAW = buildBaseLawMap();
    const r = { rows: 0, ok: 0, deleted: 0, no_file: 0, decl_mismatch: 0, no_base: 0 };
    const ex = { no_file: [], decl_mismatch: [], no_base: [] };
    for (const dir of ['concepts', 'statutes', 'comparisons', 'annexes', 'activities']) {
        const D = path.join(WIKI, dir);
        if (!fs.existsSync(D)) continue;
        for (const f of fs.readdirSync(D)) {
            if (!f.endsWith('.md')) continue;
            const src = fs.readFileSync(path.join(D, f), 'utf8');
            const fm = /^---\n([\s\S]*?)\n---/.exec(src);
            const baseLaw = BASE_LAW.get(f.replace(/\.md$/, ''))
                || (fm ? ((/^law:\s*(.+)$/m.exec(fm[1]) || [])[1] || '').trim().replace(/^["']|["']$/g, '') : '');
            for (const row of R.extractCitationChain(src.replace(/^---[\s\S]*?---\n/, ''))) {
                const tier = String(row.tier || '');
                const prefix = TIER_PREFIX[tier];
                if (!prefix) continue;                       // 고시는 V5-11 소관
                const keys = bylKeys(row.article);
                if (!keys.length) continue;                  // 별표를 안 짚은 줄은 V5-8 소관
                const law = String(row.law || '');
                const baseRel = A.resolveBase(law, baseLaw, tier);
                for (const { key, tier: own } of keys) {
                    // ★조문 칸에 계층이 적혀 있으면 그것이 이긴다(위 bylKeys 머리말).
                    const prefix2 = TIER_PREFIX[own || tier] || prefix;
                    r.rows++;
                    if (!baseRel) {
                        r.no_base++;
                        if (ex.no_base.length < 2000) ex.no_base.push(`${dir}/${f} | ${law.slice(0, 30)} | ${key}`);
                        continue;
                    }
                    const bd = path.join(REPO, baseRel, '별표');
                    // ① 계층 접두 파일 — 생산과 같은 순서
                    const owned = path.join(bd, `${prefix2}_${key}.txt`);
                    if (fs.existsSync(owned)) {
                        const t = fs.readFileSync(owned, 'utf8');
                        if (A.hasBylBody(t)) { r.ok++; continue; }
                        r.deleted++; continue;               // `[별표 7] 삭제` — 원문이 있는 게 아니다
                    }
                    // ② 계층 없는 파일 — **선언줄이 계층도 번호도 같을 때만**
                    const num = key.replace(/^(별표|서식)/, '');
                    const type = key.startsWith('별표') ? '별표' : '서식';
                    const bare = path.join(bd, `${key}.txt`);
                    if (fs.existsSync(bare)) {
                        const t = fs.readFileSync(bare, 'utf8');
                        if (A.bylDeclMatches(t, prefix2, { type, num })) {
                            if (A.hasBylBody(t)) { r.ok++; continue; }
                            r.deleted++; continue;
                        }
                        r.decl_mismatch++;
                        if (ex.decl_mismatch.length < 2000) ex.decl_mismatch.push(`${baseRel}/별표/${key}.txt | ${prefix} ${key}`);
                        continue;
                    }
                    r.no_file++;
                    if (ex.no_file.length < 2000) ex.no_file.push(`${baseRel}/별표/${prefix2}_${key}.txt | ${dir}/${f}`);
                }
            }
        }
    }
    return { r, ex };
}

function main() {
    const { r, ex } = check();
    console.log(`  법령 계층 별표를 짚은 근거 줄 ${r.rows}개  (고시 별표는 V5-11 소관)`);
    console.log(`    ✅ 눌러서 열린다         ${String(r.ok).padStart(5)}  (${r.rows ? (r.ok * 100 / r.rows).toFixed(1) : 0}%)`);
    console.log(`    ·  폐지(「삭제」 한 줄)   ${String(r.deleted).padStart(5)}  원문이 있는 게 아니다 — 결손 아님`);
    console.log(`    ❌ 그 별표 파일이 없다    ${String(r.no_file).padStart(5)}`);
    console.log(`    ❌ 선언줄이 어긋난다      ${String(r.decl_mismatch).padStart(5)}  계층 없는 파일인데 임자·번호가 안 맞는다`);
    console.log(`    ⚠ 원문 폴더를 못 찾음    ${String(r.no_base).padStart(5)}`);
    if (argv.includes('--list')) {
        for (const k of ['no_file', 'decl_mismatch', 'no_base']) {
            if (!ex[k].length) continue;
            console.log(`\n  ── ${k} ──`);
            ex[k].forEach((x) => console.log('     · ' + x));
        }
    }
    const watch = { 없다: r.no_file, 어긋남: r.decl_mismatch, 폴더없음: r.no_base };
    if (argv.includes('--update')) {
        fs.writeFileSync(BASE, JSON.stringify(watch, null, 2) + '\n');
        console.log('  기준선을 다시 구웠다:', JSON.stringify(watch));
        return 0;
    }
    let base;
    try { base = JSON.parse(fs.readFileSync(BASE, 'utf8')); } catch (_) {
        console.log('  ⚠기준선이 없다 — `--update` 로 한 번 구워야 한다'); return 1;
    }
    const worse = Object.keys(watch).filter((k) => watch[k] > base[k]);
    if (worse.length) {
        console.log(`  ❌ 늘었다: ${worse.map((k) => `${k} ${base[k]}→${watch[k]}`).join(' · ')}`);
        console.log('     → 위키가 새로 짚은 계층 별표를 못 연다. `--list` 로 자리를 본다.');
        console.log('     ⚠기준선을 다시 굽는 것으로 넘기지 않는다(G-49).');
        return 1;
    }
    const better = Object.keys(watch).filter((k) => watch[k] < base[k]);
    console.log(better.length ? `  ✅ 줄었다: ${better.map((k) => `${k} ${base[k]}→${watch[k]}`).join(' · ')} — \`--update\` 로 잠근다`
                              : '  ✅ 기준선 그대로 — 늘지 않았다');
    return 0;
}

if (require.main === module) process.exit(main());
module.exports = { check };
