'use strict';
// ============================================================================
// [2026-08-09] GAP 자식 이어받기·합성 시간 상한 검증 — node scripts/test_gap_carry_cap.js
//
//   [문제] 발표대기(GAP) 부모의 자식을 prev 에서 이어받거나 PARENT_TO_CHILDREN 으로
//   합성하는 두 경로에 시간 제한이 없었다. 두 경로는 파이프라인에서 3분 자식 해제
//   디바운스보다 **먼저** 실행되므로, 매 사이클 자식을 되살려 놓아 디바운스가
//   "사라진 적 없음"으로 보고 타이머를 시작조차 못 했다 — 안전장치가 일할 기회를
//   잃는 구조. 그 결과 잘못 들어간 자식이 발효 시각까지 수 시간 생존했다
//   (6/2 제주 §7.6.6 · 6/19 제주 §7.7.14 계열의 공통 뿌리).
//
//   [계약] MMIS 가 자식을 전혀 안 주는 상태가 GAP_CARRY_CAP_MS 를 넘으면 이어받기·합성을
//   모두 멈춘다. 그러면 자식이 비고 `_childUnknown` 이 서므로 **푸시는 침묵**한다
//   ("모르면 침묵" — 근거 없이 "포함"도 "미발표"도 단정하지 않음).
//   MMIS 가 그 부모의 자식을 한 건이라도 실제로 주면(liveChildren) 타이머는 즉시 리셋.
//
//   [연계] marine_warning_crawler(_gapCarryAllowed·_sweepGapCarryMemo·
//          _enrichSnapshotWithEfList·_enrichSnapshotWithLatest·_addGapParentFromEf)
// ============================================================================
const path = require('path');
const mc = require(path.join(__dirname, '..', 'marine_warning_crawler.js'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌ FAIL:', name, extra || ''); } };

const P = '제주도북부앞바다';                    // 자식 1개 (연안바다) — 6/2·6/19 재발 해역
const C = '제주도북부앞바다중연안바다';
const FAR = '동해남부북쪽바깥먼바다';            // 자식 없는 먼바다

const futureEf = (() => {
    const d = new Date(Date.now() + 9 * 3600000 + 6 * 3600000);   // KST +6h
    return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:00`;
})();
const efRow = (zone, over = {}) => Object.assign({
    warn_tp_nm: '풍랑', warn_cmd_nm: '발표', warn_zone_nm: zone, warn_zone_cd: '',
    tm_fc: '202608090100', tm_seq: 1, ed_tm: futureEf
}, over);
const mkSnap = () => ({
    parents: new Map(), upcomings: new Map(), children: new Map(),
    excludedChildren: new Set(), liveChildren: new Set()
});
const kid = () => ({
    wrnTp: 'V', wrnTpNm: '풍랑', wrnLvl: '1', wrnLvlNm: '예비',
    tmFc: '2026.08.09 01:00', tmEf: futureEf, tmYn: '', clrNtcTm: ''
});
const prevWithKid = () => ({
    parents: new Map(), upcomings: new Map(),
    children: new Map([[P, new Map([[C, kid()]])]]),
    excludedChildren: new Set(), liveChildren: new Set()
});
const kidsOf = (s, z) => (s.children.get(z) || new Map()).size;
const unknownOf = (s, z) => !!((s.parents.get(z) || {})._childUnknown);

// ── [1] ef/list 경로 (_addGapParentFromEf) ──────────────────────────────────
console.log('\n[1] ef/list GAP 이어받기 상한');
{
    mc._resetGapCarryForTest();
    const s = mkSnap();
    mc._enrichSnapshotWithEfList(s, [efRow(P)], prevWithKid());
    ok('상한 이내 → 자식 이어받기 정상', kidsOf(s, P) === 1, `자식=${kidsOf(s, P)}`);
    ok('상한 이내 → _childUnknown 안 섬', unknownOf(s, P) === false);

    // 최초 이어받기 시각을 상한 밖으로 밀어 "MMIS 가 계속 자식을 안 주는" 상태 재현
    mc._setGapCarryFirstAtForTest(P, Date.now() - (mc.GAP_CARRY_CAP_MS + 60 * 1000));
    const s2 = mkSnap();
    mc._enrichSnapshotWithEfList(s2, [efRow(P)], prevWithKid());
    ok('상한 초과 → 이어받기 중단', kidsOf(s2, P) === 0, `자식=${kidsOf(s2, P)}`);
    ok('상한 초과 → _childUnknown 부착(푸시 침묵)', unknownOf(s2, P) === true);
    ok('상한 초과여도 부모는 정상 등록', s2.parents.has(P) === true);
}

// ── [2] warn/latest 경로 (_enrichSnapshotWithLatest) ────────────────────────
console.log('\n[2] warn/latest GAP 이어받기 상한');
{
    mc._resetGapCarryForTest();
    const latestRow = (zone) => ({
        warn_tp: 'V', warn_tp_nm: '풍랑', warn_cmd_nm: '발표', warn_zone_nm: zone,
        warn_zone_cd: 'S1', tm_fc: '2026.08.09 01:00', tm_ef: futureEf, clr_ntc_tm: ''
    });
    const s = mkSnap();
    mc._enrichSnapshotWithLatest(s, [latestRow(P)], prevWithKid(), []);
    ok('상한 이내 → 자식 이어받기 정상', kidsOf(s, P) === 1, `자식=${kidsOf(s, P)}`);

    mc._setGapCarryFirstAtForTest(P, Date.now() - (mc.GAP_CARRY_CAP_MS + 60 * 1000));
    const s2 = mkSnap();
    mc._enrichSnapshotWithLatest(s2, [latestRow(P)], prevWithKid(), []);
    ok('상한 초과 → 이어받기 중단', kidsOf(s2, P) === 0, `자식=${kidsOf(s2, P)}`);
    ok('상한 초과 → _childUnknown 부착', unknownOf(s2, P) === true);
}

// ── [3] 타이머 해제 조건 ────────────────────────────────────────────────────
console.log('\n[3] 상한 타이머 해제 (_sweepGapCarryMemo)');
{
    mc._resetGapCarryForTest();
    mc._setGapCarryFirstAtForTest(P, Date.now() - (mc.GAP_CARRY_CAP_MS + 60 * 1000));
    ok('해제 전에는 이어받기 불가', mc._gapCarryAllowed(P) === false);

    // MMIS 가 자식을 실제로 줌(liveChildren) → 타이머 해제
    const live = mkSnap();
    live.parents.set(P, kid()); live.children.set(P, new Map([[C, kid()]])); live.liveChildren.add(C);
    mc._sweepGapCarryMemo(live);
    ok('라이브 자식 공급 → 타이머 해제', mc._gapCarryAllowed(P) === true);

    // 부모가 GAP 을 벗어남(스냅샷에서 소멸) → 타이머 해제
    mc._resetGapCarryForTest();
    mc._setGapCarryFirstAtForTest(P, Date.now() - (mc.GAP_CARRY_CAP_MS + 60 * 1000));
    mc._sweepGapCarryMemo(mkSnap());   // parents 비어 있음
    ok('부모 소멸 → 타이머 해제', mc._gapCarryAllowed(P) === true);

    // 이어받기 중(자식은 있으나 라이브 근거 없음)에는 해제되지 않아야 한다
    mc._resetGapCarryForTest();
    mc._setGapCarryFirstAtForTest(P, Date.now() - (mc.GAP_CARRY_CAP_MS + 60 * 1000));
    const carried = mkSnap();
    carried.parents.set(P, kid());
    carried.children.set(P, new Map([[C, kid()]]));   // liveChildren 비어 있음 = 이어받기 산물
    mc._sweepGapCarryMemo(carried);
    ok('이어받기 산물만으로는 타이머 해제 안 됨', mc._gapCarryAllowed(P) === false);
}

// ── [4] 회귀 — 자식 없는 해역·상한 내 동작 보존 ─────────────────────────────
console.log('\n[4] 회귀');
{
    mc._resetGapCarryForTest();
    const s = mkSnap();
    mc._enrichSnapshotWithEfList(s, [efRow(FAR)], null);
    ok('자식 없는 먼바다 → _childUnknown 안 섬', unknownOf(s, FAR) === false);

    // 상한을 넘겨도 자식 매핑이 없는 해역엔 표식을 붙이지 않는다
    mc._setGapCarryFirstAtForTest(FAR, Date.now() - (mc.GAP_CARRY_CAP_MS + 60 * 1000));
    const s2 = mkSnap();
    mc._enrichSnapshotWithEfList(s2, [efRow(FAR)], null);
    ok('자식 없는 먼바다 → 상한 초과여도 표식 없음', unknownOf(s2, FAR) === false);

    // 상한은 3분 자식 해제 디바운스보다 커야 한다 — 작으면 이어받기가 끝난 직후
    //   디바운스가 관찰을 시작하기도 전에 자식이 사라져 깜빡임이 생긴다.
    ok('상한이 3분 디바운스보다 큼', mc.GAP_CARRY_CAP_MS > 3 * 60 * 1000, `${mc.GAP_CARRY_CAP_MS}ms`);
}

console.log(`\n[gap_carry_cap] ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
