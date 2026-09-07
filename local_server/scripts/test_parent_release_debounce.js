'use strict';
// ============================================================================
// [2026-09-07 실사고 §7.7.28] 부모 해제 디바운스 검증 — node scripts/test_parent_release_debounce.js
//   20:52 MMIS 글리치로 발효중 부모 10곳이 한 사이클 전멸 → 45초 만에 그대로 복귀했는데,
//   "풍랑주의보 해제"(914명) → 다음 사이클 "풍랑주의보 발효"(1523명) 가 연달아 오발송됐다.
//   같은 순간 사라진 예비 4곳은 예비취소 디바운스가 막았다(로그: "45초 만에 복귀, 가짜
//   예비취소 억제됨"). 즉 발효중 부모에만 관찰 절차가 없었다.
//   [연계] marine_warning_crawler(_applyParentReleaseDebounce) — 이 파일이 그 계약을 고정한다.
// ============================================================================
const path = require('path');
const mc = require(path.join(__dirname, '..', 'marine_warning_crawler.js'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌ FAIL:', name, extra || ''); } };

const WIN = mc.PARENT_RELEASE_DEBOUNCE_MS;
const PN = '울산앞바다';
const KID = '울산앞바다중연안바다';
const EF = '2026.09.04 05:00';

/** 발효중 부모 info. */
const P = (lvl) => ({ wrnTp: 'V', wrnTpNm: '풍랑', wrnLvl: lvl === '예비' ? '1' : '2',
    wrnLvlNm: lvl, tmFc: '2026.09.03 04:00', tmEf: EF, tmYn: '', clrNtcTm: '8일 오전(09시~12시)' });
const C = () => ({ wrnTp: 'V', wrnTpNm: '풍랑', wrnLvl: '2', wrnLvlNm: '주의보',
    tmFc: '2026.09.03 04:00', tmEf: EF, tmYn: '', clrNtcTm: '' });
const snap = (parents = {}, children = {}) => ({
    parents: new Map(Object.entries(parents)),
    upcomings: new Map(),
    children: new Map(Object.entries(children).map(([k, v]) => [k, new Map(Object.entries(v))])),
    liveChildren: new Set([].concat(...Object.values(children).map(Object.keys)))
});
/** 관찰 시작 시각을 과거로 밀어 경과 시간을 흉내낸다. */
const ageBy = (zone, ms) => { if (mc._parentReleasePending[zone]) mc._parentReleasePending[zone].firstMissingAt -= ms; };
const reset = () => { for (const k of Object.keys(mc._parentReleasePending)) delete mc._parentReleasePending[k]; };

console.log('\n[T0] 관찰창 길이 = 1분 30초 (사용자 확정)');
ok('PARENT_RELEASE_DEBOUNCE_MS === 90초', WIN === 90 * 1000, String(WIN));

// ── T1. 발효중 부모가 사라지면 이어받아 관찰 ────────────────────────────────
console.log('\n[T1] 발효중 부모 소멸 → 이어받기(해제 푸시 안 나감)');
{
    reset();
    const prev = snap({ [PN]: P('주의보') }, { [PN]: { [KID]: C() } });
    const curr = snap({}, {});
    mc._applyParentReleaseDebounce(prev, curr);
    ok('curr 에 부모 복원됨', curr.parents.has(PN));
    ok('복원된 부모가 직전 값과 동일', curr.parents.get(PN).tmEf === EF);
    ok('관찰실에 1건 등록', Object.keys(mc._parentReleasePending).length === 1);
}

// ── T2. 실사고 재현 — 45초 만에 복귀하면 글리치로 확정 ──────────────────────
console.log('\n[T2] 45초 만에 복귀 → 글리치 확정 (2026-09-07 실사고)');
{
    reset();
    const prev = snap({ [PN]: P('주의보') }, { [PN]: { [KID]: C() } });
    mc._applyParentReleaseDebounce(prev, snap({}, {}));      // 사이클1 — 사라짐
    ageBy(PN, 45 * 1000);                                     // 45초 경과
    const back = snap({ [PN]: P('주의보') }, { [PN]: { [KID]: C() } });
    mc._applyParentReleaseDebounce(prev, back);               // 사이클2 — 복귀
    ok('관찰 종료(글리치 확정)', Object.keys(mc._parentReleasePending).length === 0);
    ok('부모 그대로 유지', back.parents.has(PN));
}

// ── T3. 90초 넘게 없으면 진짜 해제로 확정 ───────────────────────────────────
console.log('\n[T3] 90초 연속 부재 → 진짜 해제 확정');
{
    reset();
    const prev = snap({ [PN]: P('주의보') }, { [PN]: { [KID]: C() } });
    const c1 = snap({}, {});
    mc._applyParentReleaseDebounce(prev, c1);
    ok('89초 시점엔 아직 이어받음', (ageBy(PN, 89 * 1000), (() => {
        const c = snap({}, {}); mc._applyParentReleaseDebounce(prev, c); return c.parents.has(PN);
    })()));
    ageBy(PN, 2 * 1000);                                      // 총 91초
    const c2 = snap({}, {});
    mc._applyParentReleaseDebounce(prev, c2);
    ok('91초 시점엔 이어받기 중단', !c2.parents.has(PN));
    ok('관찰실 비워짐', Object.keys(mc._parentReleasePending).length === 0);
}

// ── T4. 예비는 이 디바운스 대상이 아니다 ────────────────────────────────────
console.log('\n[T4] 예비 부모는 비대상 (예비취소 디바운스 소관)');
{
    reset();
    const prev = snap({ [PN]: P('예비') }, {});
    const curr = snap({}, {});
    mc._applyParentReleaseDebounce(prev, curr);
    ok('예비는 이어받지 않음', !curr.parents.has(PN));
    ok('관찰실 비어 있음', Object.keys(mc._parentReleasePending).length === 0);
}

// ── T5. 자식도 함께 복원 + live 근거 표식 ───────────────────────────────────
console.log('\n[T5] 자식 동반 복원 — "(연안바다 미발효)" 오표기 방지');
{
    reset();
    const prev = snap({ [PN]: P('주의보') }, { [PN]: { [KID]: C() } });
    const curr = snap({}, {});
    mc._applyParentReleaseDebounce(prev, curr);
    ok('자식도 복원됨', curr.children.has(PN) && curr.children.get(PN).has(KID));
    ok('_liveEvidence 표식 부착', curr.children.get(PN).get(KID)._liveEvidence === true);
    const cs = mc._childSnapshotState(curr, PN);
    ok('푸시 집계에서 live 로 인정', cs.meta[KID] && cs.meta[KID].live === true);
}

// ── T6. 부모 복원이 자식 해제 디바운스까지 되살린다 ─────────────────────────
console.log('\n[T6] 부모 복원 → 자식 해제 디바운스 게이트 해제');
{
    reset();
    const prev = snap({ [PN]: P('주의보') }, { [PN]: { [KID]: C() } });
    const curr = snap({}, {});
    // 부모 디바운스를 먼저 돌리지 않으면 자식 디바운스는 "부모 없음"으로 건너뛴다.
    const noParent = snap({}, {});
    mc._applyChildReleaseDebounce(prev, noParent);
    ok('부모 없으면 자식 디바운스 건너뜀', !noParent.children.has(PN));
    // 실제 사이클 순서대로 — 부모 먼저
    mc._applyParentReleaseDebounce(prev, curr);
    mc._applyChildReleaseDebounce(prev, curr);
    ok('부모 복원 후엔 자식도 보호됨', curr.children.has(PN) && curr.children.get(PN).has(KID));
}

// ── T7. 종단 — 해제 푸시 change 가 생성되지 않는다 ──────────────────────────
console.log('\n[T7] 종단: 이어받는 동안 해제 change 없음');
{
    reset();
    mc._resetCancelVerdictsForTest();
    const prev = snap({ [PN]: P('주의보') }, { [PN]: { [KID]: C() } });
    const curr = snap({}, {});
    mc._applyParentReleaseDebounce(prev, curr);
    const changes = mc._buildUserPushChanges(prev, curr);
    const rel = changes.filter(c => c.zone === PN && c.type === 'CURRENT_CHANGE' && !c.curr);
    ok('해제 change 0건', rel.length === 0, `changes=${changes.map(c => c.type).join(',') || '없음'}`);
}

// ── T8. 실사고 규모 — 발효중 10곳 전멸 ──────────────────────────────────────
console.log('\n[T8] 발효중 10곳 전멸 → 전부 이어받기 (실사고 규모)');
{
    reset();
    const ZONES = ['울산앞바다', '경북남부앞바다', '동해남부남쪽안쪽먼바다', '동해남부남쪽바깥먼바다',
        '동해남부북쪽안쪽먼바다', '동해남부북쪽바깥먼바다', '남해동부안쪽먼바다', '남해동부바깥먼바다',
        '제주도남쪽바깥먼바다', '제주도남동쪽안쪽먼바다'];
    const parents = {}; ZONES.forEach(z => { parents[z] = P('주의보'); });
    const prev = snap(parents, {});
    const curr = snap({}, {});
    mc._applyParentReleaseDebounce(prev, curr);
    ok('10곳 전부 복원', curr.parents.size === 10, String(curr.parents.size));
    ok('관찰실 10건', Object.keys(mc._parentReleasePending).length === 10);
    // 45초 뒤 전부 복귀 → 전부 글리치 확정, 푸시 0
    ZONES.forEach(z => ageBy(z, 45 * 1000));
    const back = snap(parents, {});
    mc._applyParentReleaseDebounce(prev, back);
    ok('전부 복귀 → 관찰실 비워짐', Object.keys(mc._parentReleasePending).length === 0);
    const changes = mc._buildUserPushChanges(prev, back);
    const rel = changes.filter(c => c.type === 'CURRENT_CHANGE' && !c.curr);
    ok('해제 푸시 0건 (오발송 차단)', rel.length === 0, `n=${rel.length}`);
    reset();
}

console.log(`\n[parent_release_debounce] ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
