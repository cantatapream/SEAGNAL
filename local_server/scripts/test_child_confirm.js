'use strict';
// ============================================================================
// [2026-08-09 §child-confirm] 자식 확정 관찰창 회귀 테스트 — node scripts/test_child_confirm.js
//   설계 원문: client/js/forecast/alerts/child_confirm.design.md §9 (T1~T11)
//   배경: MMIS 는 GAP 구간에 부모를 먼저·자식을 조금 뒤에 준다. 그 공백을 빌려오기로
//   메우다 "모든 평수구역 포함" 오표기가 5회 재발(6/2·6/19·6/20·7/14·8/8).
//   → 빌려오기 폐지 + 발표 계열은 자식이 확정될 때까지 3분 관찰 후 발사.
//   [연계] marine_warning_crawler(_applyChildConfirmGate/_childConfirmPending) ·
//          services/push_helpers(buildChildQualifier) — 이 파일이 그 계약을 고정한다.
// ============================================================================
const path = require('path');
const mc = require(path.join(__dirname, '..', 'marine_warning_crawler.js'));
const { buildChildQualifier } = require(path.join(__dirname, '..', 'services', 'push_helpers'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌ FAIL:', name, extra || ''); } };

const PN = '경북남부앞바다';
const PS = '경북남부앞바다중평수구역';
const YN = '경북남부앞바다중연안바다';
const FAR = '동해남부북쪽바깥먼바다';     // 자식 없는 먼바다
const EF_TODAY = '2026.08.08 23:00';
const EF_TOMORROW = '2026.08.09 23:00';
const T0 = 1000000;                       // 가짜 기준시각(ms) — 실행 시각 비의존
const WIN = mc.CONFIRM_WINDOW_MS;

// ── 픽스처 ──────────────────────────────────────────────────────────────────
/** 부모 info (예비/발효). lvl='예비' 면 upcoming, 아니면 active 로 잡힌다. */
const P = (lvl, ef) => ({ wrnTp: 'V', wrnTpNm: '풍랑', wrnLvl: lvl === '예비' ? '1' : '2',
    wrnLvlNm: lvl, tmFc: '2026.08.08 16:00', tmEf: ef, tmYn: '', clrNtcTm: '' });
/** 자식 info. */
const C = (lvl, ef) => ({ wrnTp: 'V', wrnTpNm: '풍랑', wrnLvl: lvl === '예비' ? '1' : '2',
    wrnLvlNm: lvl, tmFc: '2026.08.08 16:00', tmEf: ef, tmYn: '', clrNtcTm: '' });
/** 스냅샷 — children 은 { 부모: { 자식: info } }, live 는 이번 사이클 MMIS 제공분. */
const snap = (parents = {}, children = {}, live = null) => ({
    parents: new Map(Object.entries(parents)),
    upcomings: new Map(),
    children: new Map(Object.entries(children).map(([k, v]) => [k, new Map(Object.entries(v))])),
    liveChildren: new Set(live || [].concat(...Object.values(children).map(Object.keys)))
});
/** 부모 발표(publish) change — childState 는 스냅샷에서 뽑아 붙인다. */
const upChange = (zone, cur, currSnap) => {
    const cs = mc._childSnapshotState(currSnap, zone);
    return {
        type: 'UPCOMING_CHANGE', zone, prev: null,
        curr: { wrnTp: '풍랑', wrnLvl: cur || '예비', tmFc: '2026.08.08 16:00', tmEf: EF_TODAY, tmYn: '' },
        childState: {
            all: mc.PARENT_TO_CHILDREN[zone] || [], active: cs.active, added: [], released: [],
            meta: cs.meta, parentEfUpcoming: EF_TODAY, parentEfActive: ''
        }
    };
};
const reset = () => mc._childConfirmPending.clear();

// ── T1. 발효 알림은 관찰창 없이 즉시 발사 ───────────────────────────────────
console.log('\n[T1] 발효(CURRENT_CHANGE) 즉시 발사');
{
    reset();
    const s = snap({ [PN]: P('주의보', EF_TODAY) }, { [PN]: { [YN]: C('주의보', EF_TODAY) } });
    const ch = { type: 'CURRENT_CHANGE', zone: PN, prev: null,
        curr: { wrnTp: '풍랑', wrnLvl: '주의보', tmFc: '', tmEf: EF_TODAY, tmYn: '' },
        childState: { all: mc.PARENT_TO_CHILDREN[PN], active: [YN], added: [], released: [] } };
    const out = mc._applyChildConfirmGate([ch], s, T0);
    ok('발효는 보류 없이 그대로 통과', out.length === 1 && out[0] === ch);
    ok('보류실 비어 있음', mc._childConfirmPending.size === 0);
}

// ── T2. 발표 알림 — 자식 미확정이면 보류 ────────────────────────────────────
console.log('\n[T2] 발표(UPCOMING_CHANGE) + 자식 0 → 보류');
{
    reset();
    const s = snap({ [PN]: P('예비', EF_TODAY) }, {});
    const out = mc._applyChildConfirmGate([upChange(PN, '예비', s)], s, T0);
    ok('이번 사이클 발사 없음', out.length === 0);
    ok('보류실에 1건 등록', mc._childConfirmPending.size === 1);
    ok('마감이 3분 뒤', mc._childConfirmPending.get(`${PN}|UPCOMING_CHANGE`).deadline === T0 + WIN);
}

// ── T3. 관찰 중 자식 도착 → 재관찰 1회 → 자식 포함 발사 ─────────────────────
console.log('\n[T3] 관찰 중 자식 합류 → 재관찰 → 포함 발사');
{
    reset();
    const s0 = snap({ [PN]: P('예비', EF_TODAY) }, {});
    mc._applyChildConfirmGate([upChange(PN, '예비', s0)], s0, T0);
    // 1분 뒤 자식 1곳 합류 → 마감이 그 시점 기준 3분으로 밀린다
    const s1 = snap({ [PN]: P('예비', EF_TODAY) }, { [PN]: { [YN]: C('예비', EF_TODAY) } });
    const out1 = mc._applyChildConfirmGate([], s1, T0 + 60000);
    ok('합류 사이클엔 아직 미발사', out1.length === 0);
    ok('마감 재설정(합류 시점 +3분)',
        mc._childConfirmPending.get(`${PN}|UPCOMING_CHANGE`).deadline === T0 + 60000 + WIN);
    // 원래 마감(T0+3분)에는 안 나가야 한다
    ok('원 마감 시점엔 미발사', mc._applyChildConfirmGate([], s1, T0 + WIN).length === 0);
    // 재관찰 마감 도달 → 자식 포함해 발사
    const out2 = mc._applyChildConfirmGate([], s1, T0 + 60000 + WIN);
    ok('재관찰 만료 → 발사', out2.length === 1);
    ok('발사 내용에 합류 자식 포함', out2[0].childState.active.join() === YN);
    ok('보류실 비워짐', mc._childConfirmPending.size === 0);
}

// ── T4. 만료 + 자식 없음 → 부모만 발사 ──────────────────────────────────────
console.log('\n[T4] 만료 + 자식 0 → 부모만');
{
    reset();
    const s = snap({ [PN]: P('예비', EF_TODAY) }, {});
    mc._applyChildConfirmGate([upChange(PN, '예비', s)], s, T0);
    const out = mc._applyChildConfirmGate([], s, T0 + WIN);
    ok('만료 시 발사됨', out.length === 1);
    ok('자식 목록 비어 있음', out[0].childState.active.length === 0);
    ok('보류실 비워짐', mc._childConfirmPending.size === 0);
}

// ── T5. 같은 자식 깜빡임 → 재시작 안 함 ─────────────────────────────────────
console.log('\n[T5] 자식 깜빡임(사라졌다 재등장) → 재시작 없음');
{
    reset();
    const withKid = snap({ [PN]: P('예비', EF_TODAY) }, { [PN]: { [YN]: C('예비', EF_TODAY) } });
    const noKid = snap({ [PN]: P('예비', EF_TODAY) }, {});
    // 자식이 없는 상태로 보류 시작 → 30초 뒤 자식 합류(재시작 1회)
    mc._applyChildConfirmGate([upChange(PN, '예비', noKid)], noKid, T0);
    mc._applyChildConfirmGate([], withKid, T0 + 30000);
    const dl = mc._childConfirmPending.get(`${PN}|UPCOMING_CHANGE`).deadline;
    ok('합류로 1회 재시작', dl === T0 + 30000 + WIN);
    // 사라졌다(60초) 다시 나타남(90초) — 집합 증가가 아니므로 마감 불변
    mc._applyChildConfirmGate([], noKid, T0 + 60000);
    mc._applyChildConfirmGate([], withKid, T0 + 90000);
    ok('깜빡임은 마감 불변',
        mc._childConfirmPending.get(`${PN}|UPCOMING_CHANGE`).deadline === dl,
        String(mc._childConfirmPending.get(`${PN}|UPCOMING_CHANGE`).deadline));
}

// ── T6. 관찰 중 부모 해제·소멸 → 관찰 폐기 ──────────────────────────────────
console.log('\n[T6] 관찰 중 부모 예비 소멸 → 폐기(중복 발사 없음)');
{
    reset();
    const s0 = snap({ [PN]: P('예비', EF_TODAY) }, {});
    mc._applyChildConfirmGate([upChange(PN, '예비', s0)], s0, T0);
    const gone = snap({}, {});
    const out = mc._applyChildConfirmGate([], gone, T0 + 60000);
    ok('폐기 사이클 무발사', out.length === 0);
    ok('보류실 비워짐', mc._childConfirmPending.size === 0);
    ok('만료 시각이 지나도 재발사 없음', mc._applyChildConfirmGate([], gone, T0 + WIN * 3).length === 0);
}

// ── T7. 관찰 중 부모 격상 → 새 이벤트로 재시작 ──────────────────────────────
console.log('\n[T7] 관찰 중 등급 변화 → 새 창으로 재시작');
{
    reset();
    const s = snap({ [PN]: P('예비', EF_TODAY) }, {});
    mc._applyChildConfirmGate([upChange(PN, '예비', s)], s, T0);
    // 60초 뒤 경보 발표대기로 격상 → 같은 key 지만 sig(등급)가 달라 창을 새로 연다
    const up2 = upChange(PN, '경보', s);
    mc._applyChildConfirmGate([up2], s, T0 + 60000);
    const p = mc._childConfirmPending.get(`${PN}|UPCOMING_CHANGE`);
    ok('보류 1건 유지(교체)', mc._childConfirmPending.size === 1);
    ok('마감이 새 이벤트 기준', p.deadline === T0 + 60000 + WIN);
    ok('발사 내용이 새 이벤트로 교체', p.change === up2);
    // 시각만 바뀐 change 는 창을 새로 열지 않는다(§5.3)
    const up3 = upChange(PN, '경보', s);
    up3.curr.tmEf = EF_TOMORROW;
    mc._applyChildConfirmGate([up3], s, T0 + 90000);
    const p3 = mc._childConfirmPending.get(`${PN}|UPCOMING_CHANGE`);
    ok('시각만 변경 → 마감 유지', p3.deadline === T0 + 60000 + WIN);
    ok('시각만 변경 → 내용만 갱신', p3.change === up3);
}

// ── T8. 자식 없는 먼바다 → 관찰창 안 열림 ───────────────────────────────────
console.log('\n[T8] 자식 없는 해역 → 즉시 발사');
{
    reset();
    const s = snap({ [FAR]: P('예비', EF_TODAY) }, {});
    const ch = upChange(FAR, '예비', s);
    const out = mc._applyChildConfirmGate([ch], s, T0);
    ok('즉시 통과', out.length === 1 && out[0] === ch);
    ok('보류실 비어 있음', mc._childConfirmPending.size === 0);
}

// ── T9. 8/8 실사고 재현 — 평수구역 배제 ─────────────────────────────────────
console.log('\n[T9] 8/8 실사고 — 다른 날 예비 자식은 확정으로 안 침');
{
    reset();
    // 평수구역은 내일(8/9) 예비 — 이번 특보 소속 아님. 연안바다만 이번 특보.
    const only평수 = snap({ [PN]: P('예비', EF_TODAY) }, { [PN]: { [PS]: C('예비', EF_TOMORROW) } });
    const out = mc._applyChildConfirmGate([upChange(PN, '예비', only평수)], only평수, T0);
    ok('무관한 자식뿐이면 확정 아님 → 보류', out.length === 0 && mc._childConfirmPending.size === 1);
    // 연안바다 합류 → 재관찰 후 발사, 한정사는 연안바다만
    const both = snap({ [PN]: P('예비', EF_TODAY) },
        { [PN]: { [PS]: C('예비', EF_TOMORROW), [YN]: C('예비', EF_TODAY) } });
    mc._applyChildConfirmGate([], both, T0 + 30000);
    const fired = mc._applyChildConfirmGate([], both, T0 + 30000 + WIN);
    ok('재관찰 만료 발사', fired.length === 1);
    const q = buildChildQualifier(PN, fired[0].childState, 'publish');
    ok('한정사 = "(연안바다 포함)"', q === '(연안바다 포함)', q);
}

// ── T10. 빌려온 자식(live=false)은 확정으로 안 침 ───────────────────────────
console.log('\n[T10] live=false 자식은 집계·확정 제외');
{
    reset();
    // 스냅샷엔 자식이 있으나 이번 사이클 MMIS 가 준 게 아님(liveChildren 비어 있음)
    const s = snap({ [PN]: P('예비', EF_TODAY) }, { [PN]: { [YN]: C('예비', EF_TODAY) } }, []);
    const ch = upChange(PN, '예비', s);
    ok('meta.live=false 부착', ch.childState.meta[YN].live === false);
    const out = mc._applyChildConfirmGate([ch], s, T0);
    ok('확정 자식 0 → 보류', out.length === 0 && mc._childConfirmPending.size === 1);
    const q = buildChildQualifier(PN, ch.childState, 'publish');
    ok('한정사에 빌려온 자식 미포함', !/연안바다 포함/.test(q), q);
}

// ── T11. 크롤러 스냅샷 — 빌려오기·합성 폐지 확인 ────────────────────────────
console.log('\n[T11] 빌려오기·합성 폐지 (카드 데이터 오염 방지)');
{
    const mk = () => ({ parents: new Map(), upcomings: new Map(), children: new Map(),
        excludedChildren: new Set(), liveChildren: new Set() });
    const futureEf = (() => { const d = new Date(Date.now() + 9 * 3600000 + 6 * 3600000);
        return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:00`; })();
    const row = { warn_tp_nm: '풍랑', warn_cmd_nm: '발표', warn_zone_nm: PN, warn_zone_cd: '',
        tm_fc: '202608081600', tm_seq: 1, ed_tm: futureEf };
    // prev 에 자식이 있어도 이어받지 않는다
    const prev = mk();
    prev.children.set(PN, new Map([[YN, { wrnTpNm: '풍랑', wrnLvlNm: '예비' }]]));
    const s = mk();
    mc._enrichSnapshotWithEfList(s, [row], prev);
    ok('GAP 부모는 추가됨', s.parents.has(PN));
    ok('자식은 이어받지도 합성하지도 않음', !s.children.has(PN) || s.children.get(PN).size === 0);
    ok('_childUnknown 표식으로 침묵 유지', s.parents.get(PN)._childUnknown === true);
    // 상한(GAP_CARRY_CAP_MS) 잔재 없음
    ok('이어받기 상한 API 제거됨', mc._gapCarryAllowed === undefined && mc._sweepGapCarryMemo === undefined);
}

console.log(`\n[child_confirm] ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
