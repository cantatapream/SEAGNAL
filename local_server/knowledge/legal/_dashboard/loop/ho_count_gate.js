#!/usr/bin/env node
/**
 * V5-27 — §5-D ⓕ 「각 호 N개」가 원문과 맞나 (2026-09-23 신설, G-7)
 *
 * [규약] `_SCHEMA §5-D ⓕ`(사용자 확정 2026-09-19) — *"2차 재점검에서 나온 **틀린 값 중
 *   가장 많은 유형이 「각 호 N개」 오산**이었다."* 가지번호는 세고, `삭제` 는 빼고,
 *   마지막 번호는 개수와 다를 수 있다.
 *
 * [왜 만들 수 있었나] §6-F(G-5)는 **표기를 안 정해서** 기계가 못 읽는다. ⓕ 는 다르다 —
 *   **규칙이 글이 아니라 셈**이고, 규약이 **맞춰 볼 실례 둘까지 적어 두었다**.
 *   세는 법은 `_counting.countHo` 에 있고 여기서는 **부르기만** 한다(L-136).
 *
 * [무엇을 재나] 위키가 `제N조(제M항)? 각 호 K개` 라고 **엄격한 꼴**로 적은 자리만 본다.
 *   그 조를 raw 에서 찾아 ⓕ 대로 세고 K 와 맞춘다. **어긋남 0 을 요구한다**
 *   — 기준선을 두지 않는다. 이건 취향이 아니라 **사실이 틀린 것**이기 때문이다.
 *
 * ⚠**닿는 범위를 숨기지 않는다**: 위키가 호 개수를 말하는 표현은 여럿이다
 *   (`호 | N개` 70 · `호 N개` 44 · `호 | **N개` 34 · `각 호 N개` 11 …).
 *   이 게이트는 **맨 끝 꼴 하나만** 본다. 나머지는 §6-F 와 같은 병(표기 미정)이라
 *   Q-18 이 풀리면 함께 넓힌다. **닿는 만큼만 재고, 닿는 만큼만 말한다.**
 */
const fs = require('fs');
const path = require('path');
const C = require('./_counting.js');

const LEGAL = path.resolve(__dirname, '../..');
const WIKI = path.join(LEGAL, 'wiki');
const RAW = path.join(LEGAL, 'raw');
const CLAIM_RE = /(시행령|시행규칙|법률|이 법|법)?\s*(제\d+조(?:의\d+)?)(?:제(\d+)항)?\s*각\s?호\s?(\d+)\s?개/g;

function lawFolders() {
    const out = {};
    for (const dom of fs.readdirSync(RAW)) {
        const dd = path.join(RAW, dom);
        let st;
        try { st = fs.statSync(dd); } catch (_) { continue; }
        if (!st.isDirectory()) continue;
        for (const n of fs.readdirSync(dd)) out[n] = dom + '/' + n;
    }
    return out;
}

function mdFiles(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) mdFiles(p, out);
        else if (e.name.endsWith('.md')) out.push(p);
    }
    return out;
}

function check() {
    const laws = lawFolders();
    const res = { 주장: 0, 맞음: 0, 어긋남: [], 못맞춤: 0 };
    for (const f of mdFiles(WIKI)) {
        const page = path.basename(f, '.md');
        const law = page.split('__')[0];
        const t = fs.readFileSync(f, 'utf8');
        let m;
        CLAIM_RE.lastIndex = 0;
        while ((m = CLAIM_RE.exec(t))) {
            res.주장++;
            const tier = m[1] === '시행령' ? '시행령' : m[1] === '시행규칙' ? '시행규칙' : '법률';
            const jo = m[2];
            const hang = m[3] ? Number(m[3]) : null;
            const claim = Number(m[4]);
            const slug = laws[law];
            if (!slug) { res.못맞춤++; continue; }
            const blk = C.articleBlock(slug + '/' + tier + '.txt', jo);
            if (!blk) { res.못맞춤++; continue; }
            const g = C.countHo(blk);
            const pick = hang ? g.find((x) => x.항 === hang) : g[0];
            if (!pick) { res.못맞춤++; continue; }
            if (pick.살아있는 === claim) res.맞음++;
            else res.어긋남.push({ page, tier, jo, hang, 위키: claim, 원문: pick.살아있는, 삭제: pick.삭제, 마지막번호: pick.마지막번호 });
        }
    }
    return res;
}

function main() {
    const r = check();
    console.log(`  위키가 엄격한 꼴로 적은 「각 호 N개」 주장 ${r.주장}건`);
    console.log(`    ✅ 원문과 맞음 ${r.맞음}   ❌ 어긋남 ${r.어긋남.length}   ·  못 맞춤(법·조 해석 실패) ${r.못맞춤}`);
    console.log('    ⚠이 게이트는 `제N조 각 호 K개` **한 꼴만** 본다 — 위키의 다른 표기');
    console.log('      (`호 | N개` 70 · `호 N개` 44 …)는 표기가 안 정해져 못 읽는다(§6-F 와 같은 병, Q-18).');
    if (!r.어긋남.length) { console.log('  ✅ 어긋남 0'); return 0; }
    console.log('  ❌ 원문과 어긋난다 — **사실이 틀린 것**이다(기준선을 두지 않는다):');
    for (const b of r.어긋남) {
        console.log(`     · ${b.page}  ${b.tier} ${b.jo}${b.hang ? '제' + b.hang + '항' : ''}` +
                    `  위키 ${b.위키}개 ↔ 원문 ${b.원문}개 (삭제 ${b.삭제} · 마지막 번호 ${b.마지막번호})`);
    }
    console.log('     → §5-D ⓕ: 가지번호는 세고, `삭제` 는 빼고, **마지막 번호는 개수와 다를 수 있다**.');
    console.log('       고칠 때 "제8호까지 있으나 제7호는 삭제되어 실제 7개"처럼 **둘 다** 적는다.');
    return 1;
}

if (require.main === module) process.exit(main());
module.exports = { check };
