#!/usr/bin/env node
/**
 * V5-24 — 「사람이 봐야 한다」 표시가 달린 채 남은 행정규칙 (2026-09-23 신설, G-24 · 2-19)
 *
 * [왜] 수집기가 스스로 `⚠REVIEW` 를 적어 두었다 — *"이건 기계가 받아온 것이니 사람이
 *   원문과 대조해야 한다"*. 그런데 **그 대조가 이뤄졌는지 세는 것이 아무것도 없었다.**
 *   표시를 달아 놓고 아무도 안 세면, 표시는 **적은 사람의 양심**일 뿐 아무 일도 안 한다.
 *   뿌리 사슬 ⑤ — 게이트가 묻지 않는 물음은 영영 답이 없다.
 *
 * [★뜻을 못박는다] 등록부는 이것을 *"「원문 대조 필요」 147개"* 라고 적었다.
 *   2026-09-23 에 재 보니 **어떤 자로도 147 이 안 나온다.** 그 문구가 든 파일은 **6개**다.
 *   대신 뜻마다 값이 이렇게 갈린다 — anywhere 234 · head5 178 · first 36 · phrase 6.
 *   **어느 하나가 옳은 것이 아니다.** 그래서 세는 법은 `_counting.js` 에 적고
 *   이 게이트는 그것을 **부르기만 한다**(L-136 — 여기서 정규식을 베끼면 그 사본이 곧 옛 규칙이 된다).
 *
 * [무엇을 재나] 기준선을 잠그고 **늘면 실패**한다. 줄어드는 것은 막지 않는다.
 *   ⚠빨간불에 **기준선을 다시 굽는 것으로 넘기지 않는다**(G-49).
 *   표시를 지워서 초록을 만드는 것은 더 나쁘다 — 그것은 대조를 한 것이 아니다(G-34).
 */
const fs = require('fs');
const path = require('path');
const C = require('./_counting.js');

const BASE = path.join(__dirname, 'baseline', 'admrul_review.json');
const WATCH = ['anywhere', 'head5', 'first', 'phrase'];

function measure() {
    const out = { 전체: 0 };
    for (const s of WATCH) {
        const r = C.countAdmrulReview(s);
        out[s] = r.걸린파일;
        out.전체 = r.전체;
    }
    const why = C.admrulReviewReasons();
    out.덩어리 = why.덩어리;
    out.맨표시 = why.맨표시;      // 까닭을 안 적은 표시
    out.맨표시파일 = why.맨표시파일;
    return out;
}

function main() {
    const now = measure();
    const update = process.argv.includes('--update');
    if (update) {
        fs.writeFileSync(BASE, JSON.stringify(now, null, 2) + '\n', 'utf8');
        console.log('  기준선을 다시 구웠다:', JSON.stringify(now));
        return 0;
    }
    let base = null;
    try { base = JSON.parse(fs.readFileSync(BASE, 'utf8')); } catch (_) {}
    console.log(`  행정규칙 ${now.전체}개 — ${C.ADMRUL_SCOPE.뜻}`);
    for (const s of WATCH) {
        const d = base ? now[s] - base[s] : 0;
        const mark = d > 0 ? '❌' : d < 0 ? '✅' : '  ';
        console.log(`  ${mark} ${s.padEnd(9)} ${String(now[s]).padStart(4)}   ${C.REVIEW_SENSES[s]}` +
                    (base ? `   (기준선 ${base[s]}${d ? `, ${d > 0 ? '+' : ''}${d}` : ''})` : ''));
    }
    console.log(`  · 표시 덩어리 ${now.덩어리}개 중 **까닭을 안 적은 맨 표시 ${now.맨표시}개**` +
                ` (파일 ${now.맨표시파일}개)`);
    console.log('    ⚠까닭이 없으면 사람도 무엇을 대조해야 할지 모른다 — 줄이려면 까닭부터 적어야 한다.');
    if (!base) {
        console.log('  ⚠기준선이 없다 — `--update` 로 한 번 구워야 한다');
        return 1;
    }
    const worse = WATCH.filter((s) => now[s] > base[s]);
    if (worse.length) {
        console.log(`  ❌ 늘었다: ${worse.map((s) => `${s} ${base[s]}→${now[s]}`).join(' · ')}`);
        console.log('     ⚠기준선을 다시 굽는 것으로 넘기지 않는다(G-49).');
        console.log('     ⚠표시를 지워서 초록을 만들지 않는다 — 그것은 대조를 한 것이 아니다(G-34).');
        return 1;
    }
    const better = WATCH.filter((s) => now[s] < base[s]);
    console.log(better.length
        ? `  ✅ 줄었다: ${better.map((s) => `${s} ${base[s]}→${now[s]}`).join(' · ')} — \`--update\` 로 기준선을 낮춰 잠근다`
        : '  ✅ 기준선 그대로 — 늘지 않았다');
    return 0;
}

if (require.main === module) process.exit(main());
module.exports = { measure };
