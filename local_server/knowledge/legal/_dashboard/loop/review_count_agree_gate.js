#!/usr/bin/env node
/**
 * V5-30 — 검수 대기 수를 **두 곳이 같게 세나** (2026-09-23 신설, G-22 아님 · G-11)
 *
 * [왜] 같은 물음("사람이 봐야 할 카드가 몇 장인가")을 **두 코드가 따로 센다** —
 *   서버 `routes/legal.js parseReviewQueue()` 와 `_dashboard/human_workload.py`.
 *   `human_workload.py` 가 **스스로 그 위험을 적어 두었다**:
 *     *"이 규칙은 **서버와 여기 두 곳에만** 있다. 한쪽만 고치면 두 숫자가 어긋난다 —
 *       실제로 `해당 없음` 처리가 여기에만 있어 어긋난 채 방치돼 있었다."*
 *   뿌리 사슬 ⑥ 그 자체다.
 *
 * [★2026-09-23 실측 — 지금은 어긋나지 않는다] 등록부(G-11)는 *"서버 3 · human_workload 0"* 이라
 *   적었는데, 그것은 **P-10(2026-09-22) 으로 서버를 고치기 전 상태**다. 오늘 재니 **둘 다 0** 이다.
 *     카드 762장 · `[x]` 676 · 「해당 없음」 50 · 「쪼갬」 36  ⇒ 사람 몫 **0**
 *   카드 경계를 어느 쪽 규칙으로 잡든 같은 답이 나온다(아래 두 셈을 견준다).
 *
 * [⚠못 한 것을 밝힌다] 서버 함수를 **직접 부르지 못했다** — `routes/legal.js` 를 `require` 하면
 *   부작용으로 멈춘다(30초 넘게 안 끝난다). 그래서 **서버의 카드 경계 규칙만 여기 옮겨 적었다**.
 *   이것은 L-136 이 경계하는 「규칙 베끼기」다. 다만 여기서는 **두 셈이 갈리는지를 묻는 것**이
 *   목적이라, 같은 값이 나오는 한 사본이 낡았는지도 함께 드러난다.
 *   파이썬 쪽은 베끼지 않고 **운영 스크립트를 그대로 돌려** 값을 받는다.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const LEGAL = path.resolve(__dirname, '../..');
const QUEUE = path.join(LEGAL, '_dashboard', 'review_queue.md');
const PY = path.join(LEGAL, '_dashboard', 'loop', 'human_workload.py');
const WL_JSON = path.join(LEGAL, '_dashboard', 'human_workload.json');

// ★2026-09-23 (3-17) — **규칙을 여기 베끼지 않는다.** 위 [⚠못 한 것을 밝힌다] 가 적어 둔
//   「서버 규칙을 옮겨 적었다」는 이제 사실이 아니다 — 서버·파이썬·이 게이트가 **한 파일**을 읽는다:
//     `_dashboard/review_queue_rules.json`
//   (서버 함수를 직접 못 부르는 것은 그대로다. 다만 **규칙 사본이 낡을 일은 없어졌다.**)
const RULES = JSON.parse(fs.readFileSync(path.join(LEGAL, '_dashboard', 'review_queue_rules.json'), 'utf8'));
const RE_HEAD = new RegExp(RULES.카드머리);
const RE_CLOSE = new RegExp(RULES.카드닫기);
const RE_APPROVED = new RegExp(RULES.승인, 'm');
const RE_NA = new RegExp(RULES.해당없음, 'm');
const RE_SPLIT = new RegExp(RULES.쪼갬, 'm');

/** 서버 규칙 — 카드가 아닌 `### ` 제목은 **앞 카드를 닫는다**(P-10, 2026-09-22). */
function countByServerRule() {
    const txt = fs.readFileSync(QUEUE, 'utf8');
    const cards = [];
    let cur = null;
    for (const line of txt.split('\n')) {
        const m = RE_HEAD.exec(line);
        if (m) { if (cur) cards.push(cur); cur = { id: m[1], body: '' }; continue; }
        if (RE_CLOSE.test(line)) { if (cur) { cards.push(cur); cur = null; } continue; }
        if (cur) cur.body += line + '\n';
    }
    if (cur) cards.push(cur);
    let x = 0, na = 0, sp = 0, pending = 0;
    for (const c of cards) {
        // ⚠공유 규칙의 `승인` 은 `[ ]`(대기)도 **같이** 잡는다 — 무리1 이 `x` 일 때만 승인이다.
        //   (게이트가 베끼기를 그만두면서 여기서 한 번 틀릴 뻔했다 — 잡는 것과 판정은 다른 일이다.)
        const ap = RE_APPROVED.exec(c.body);
        if (ap && ap[1].toLowerCase() === 'x') { x++; continue; }
        if (RE_NA.test(c.body)) { na++; continue; }
        if (RE_SPLIT.test(c.body)) { sp++; continue; }
        pending++;
    }
    return { 카드: cards.length, 승인: x, 해당없음: na, 쪼갬: sp, 사람몫: pending };
}

/**
 * 파이썬 쪽은 **운영 스크립트를 그대로 돌려** 값을 받는다(베끼지 않는다).
 *
 * ⚠★**트리를 바꾸지 않는다.** `human_workload.py` 는 `_dashboard/human_workload.json` 을
 *   **덮어쓴다**. 검증이 트리를 바꾸면 안 된다(V5-0 이 세운 규칙) — 그래서 먼저 옆에
 *   치워 두고, 값을 읽은 뒤 **결과와 무관하게 되돌린다**(`finally`. 중간에 죽어도 되돌아간다).
 *   ⚠이걸 처음엔 빠뜨려서 게이트가 돌 때마다 그 파일이 더럽혀졌다 — 스스로 잡았다.
 */
function countByPython() {
    const had = fs.existsSync(WL_JSON);
    const saved = had ? fs.readFileSync(WL_JSON) : null;
    try {
        execFileSync('python3', [PY], { stdio: 'pipe' });
        return JSON.parse(fs.readFileSync(WL_JSON, 'utf8')).pending_total;
    } finally {
        if (had) fs.writeFileSync(WL_JSON, saved);
        else if (fs.existsSync(WL_JSON)) fs.unlinkSync(WL_JSON);
    }
}

function main() {
    const s = countByServerRule();
    let py;
    try { py = countByPython(); } catch (e) {
        console.log('  ❌ human_workload.py 를 돌리지 못했다 — ' + String(e.message || e).slice(0, 200));
        return 1;
    }
    console.log(`  검수 큐 카드 ${s.카드}장 — 승인 ${s.승인} · 해당없음 ${s.해당없음} · 쪼갬 ${s.쪼갬}`);
    console.log(`    서버 규칙이 센 사람 몫      ${s.사람몫}`);
    console.log(`    human_workload.py 가 센 값  ${py}   (운영 스크립트를 그대로 돌린 값)`);
    if (s.사람몫 === py) { console.log('  ✅ 두 곳이 같게 센다'); return 0; }
    console.log(`  ❌ 두 곳이 다르게 센다 — ${s.사람몫} ↔ ${py}`);
    console.log('     → 같은 물음을 두 코드가 따로 센다(서버 `parseReviewQueue()` · `human_workload.py`).');
    console.log('       한쪽에만 규칙을 더하면 이렇게 갈린다 — `human_workload.py` 가 스스로 적어 둔 위험이다.');
    console.log('       네 규칙이 양쪽에 다 있는지 본다: 카드 경계(`### ` 에서 닫기) · `[x]` · 「해당 없음」 · 「쪼갬」.');
    return 1;
}

if (require.main === module) process.exit(main());
module.exports = { countByServerRule, countByPython };
