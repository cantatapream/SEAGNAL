#!/usr/bin/env node
/**
 * V5-19 — 교훈 번호가 겹치지 않나 (2026-09-23 신설)
 *
 * 왜 생겼나: 2026-09-23 에 갈래 둘이 각자 L-306 다음을 L-307 부터 쓰기 시작해
 * **같은 번호가 둘** 생겼다(L-329). 합칠 때 손으로 알아채야 했다 —
 * 뿌리 사슬 ⑤ "게이트가 묻지 않는 물음은 영영 답이 없다" 그대로다.
 *
 * L-136 대로 세는 것은 직접 만들지 않고 운영 함수 `lessonBlocks()` 를 부른다.
 */
const C = require('./_counting.js');

function dupes() {
    const seen = new Map();
    for (const b of C.lessonBlocks()) seen.set(b.no, (seen.get(b.no) || 0) + 1);
    return [...seen.entries()].filter(([, n]) => n > 1).map(([no, n]) => ({ no, n }));
}

if (require.main === module) {
    const d = dupes();
    const total = C.lessonBlocks().length;
    if (!d.length) {
        console.log(`✅ 교훈 ${total}개 — 겹치는 번호 0`);
        process.exit(0);
    }
    console.log(`❌ 교훈 ${total}개 중 겹치는 번호 ${d.length}가지`);
    for (const { no, n } of d) console.log(`   L-${no} 가 ${n}번 나온다`);
    console.log('   → 늦게 붙인 쪽의 번호를 비어 있는 뒷번호로 옮기고, 옛 번호를 적은 정정을 붙인다(L-329).');
    process.exit(1);
}

module.exports = { dupes };
