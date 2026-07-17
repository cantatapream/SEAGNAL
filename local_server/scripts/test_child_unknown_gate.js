'use strict';
// ============================================================================
// [2026-07-18 실사고] 자식 정보 '미상' 게이트 검증 — node scripts/test_child_unknown_gate.js
//   7/18 05:12 "(평수구역 미발표)" 오표기: GAP 보강(ef/list)으로 부모만 먼저 온 전이 창에서
//   자식 부재를 "미발표 확정"으로 단정 → 2분 뒤 자식 4곳 합류(실측). 수정: GAP 부모의
//   자식 부재는 '미상'(_childUnknown) → 한정사 괄호를 아예 붙이지 않는다(모르면 침묵).
//   [연계] marine_warning_crawler(_addGapParentFromEf/_enrichSnapshotWithLatest/childState),
//          services/push_helpers(buildChildQualifier) — 이 파일이 그 계약을 고정한다.
// ============================================================================
const path = require('path');
const mc = require(path.join(__dirname, '..', 'marine_warning_crawler.js'));
const { buildChildQualifier, generateMessage } = require(path.join(__dirname, '..', 'services', 'push_helpers'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌ FAIL:', name, extra || ''); } };

const PN = '인천·경기남부앞바다';           // 자식 3 (먼/북부앞/남부앞평수구역)
const PN2 = '인천·경기북부앞바다';          // 자식 1 (평수구역)
const KIDS = ['인천·경기남부앞바다중먼평수구역', '인천·경기남부앞바다중북부앞평수구역', '인천·경기남부앞바다중남부앞평수구역'];
const FAR = '동해남부북쪽바깥먼바다';        // 자식 없는 먼바다

// ── [1] 한정사 매트릭스 — 미상 게이트 vs 기존 표기 전부 보존 ────────────────
console.log('\n[1] buildChildQualifier 매트릭스');
const cs = (over = {}) => Object.assign({ all: KIDS, active: [], added: [], released: [] }, over);
ok('미상+빈 목록(publish) → 괄호 없음', buildChildQualifier(PN, cs({ unknown: true }), 'publish') === '');
ok('미상+빈 목록(active) → 괄호 없음', buildChildQualifier(PN, cs({ unknown: true }), 'active') === '');
ok('미상+빈 목록(격상) → 괄호 없음', buildChildQualifier(PN, cs({ unknown: true }), 'level_upgrade_publish') === '');
ok('확정 빈 목록(publish) → "미발표" 유지', buildChildQualifier(PN, cs(), 'publish') === '(평수구역 미발표)');
ok('확정 빈 목록(active) → "미발효" 유지', buildChildQualifier(PN, cs(), 'active') === '(평수구역 미발효)');
ok('확정 빈 목록(격상) → "격상 없음" 유지', /격상 없음/.test(buildChildQualifier(PN, cs(), 'level_upgrade_publish')));
ok('전 자식 포함 → "모든 … 포함" 유지', /모든 평수구역 포함/.test(buildChildQualifier(PN, cs({ active: KIDS }), 'publish')));
ok('일부 자식 → 나열 유지(미상 플래그 무시)', buildChildQualifier(PN, cs({ active: [KIDS[0]], unknown: true }), 'publish') === '(먼평수구역 포함)');
ok('해제(release) 무한정사 유지', buildChildQualifier(PN, cs({ unknown: true }), 'release') === '');
ok('자식취소: released 있으면 미상 무관 발동', /만 취소/.test(buildChildQualifier(PN, cs({ released: [KIDS[0]], unknown: true }), 'child_prelim_cancel')));
ok('자식 없는 먼바다 → 종전대로 무한정사', buildChildQualifier(FAR, { all: [], active: [], added: [], released: [], unknown: true }, 'publish') === '');

// ── [2] GAP 보강 내부 — _childUnknown 표식 부착 조건 ────────────────────────
console.log('\n[2] GAP 보강 표식 (ef/list·warn/latest)');
const mkSnap = () => ({
    parents: new Map(), upcomings: new Map(), children: new Map(),
    excludedChildren: new Set(), liveChildren: new Set()
});
const futureEf = (() => { const d = new Date(Date.now() + 9 * 3600000 + 6 * 3600000); // KST+6h
    return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:00`; })();
const efRow = (zone, over = {}) => Object.assign({
    warn_tp_nm: '풍랑', warn_cmd_nm: '발표', warn_zone_nm: zone, warn_zone_cd: '',
    tm_fc: '202607180510', tm_seq: 1, ed_tm: futureEf
}, over);

// (a) 7/18 리허설 — sasc 제외행이 전 자식을 먹어 synth 0 → 미상
{
    const s = mkSnap();
    KIDS.forEach(k => s.excludedChildren.add(k));
    mc._enrichSnapshotWithEfList(s, [efRow(PN)], null);
    const info = s.parents.get(PN);
    ok('(a) 7/18 리허설: carry0·synth0 → _childUnknown', !!info && info._childUnknown === true);
}
// (b) 정상 synth (제외 없음) → 자식 합성됨 → 미상 아님
{
    const s = mkSnap();
    mc._enrichSnapshotWithEfList(s, [efRow(PN)], null);
    const info = s.parents.get(PN);
    ok('(b) 자식 합성 성공 → 미상 아님', !!info && !info._childUnknown && s.children.get(PN).size === 3);
}
// (c) prev 자식 carry → 미상 아님
{
    const s = mkSnap();
    KIDS.forEach(k => s.excludedChildren.add(k));   // 제외행이 있어도 carry 우선
    const prev = mkSnap();
    prev.children.set(PN, new Map([[KIDS[0], { wrnTpNm: '풍랑', wrnLvlNm: '예비' }]]));
    mc._enrichSnapshotWithEfList(s, [efRow(PN)], prev);
    ok('(c) prev carry → 미상 아님', !s.parents.get(PN)._childUnknown && s.children.get(PN).size === 1);
}
// (d) 자식 없는 먼바다 → 표식 자체를 안 붙임 (한정사 비대상)
{
    const s = mkSnap();
    mc._enrichSnapshotWithEfList(s, [efRow(FAR)], null);
    ok('(d) 자식 없는 해역 → 표식 없음', !s.parents.get(FAR)._childUnknown);
}
// (e) warn/latest GAP — sasc/latest 자식이 같은 사이클에 실리면 미상 아님 (7/18 05:14 상황)
{
    const s = mkSnap();
    KIDS.forEach(k => s.excludedChildren.add(k));
    const sascRows = KIDS.map(k => ({ warn_tp: 'V', warn_cmd_nm: '발표', warn_zone_nm: k,
        warn_zone_cd: 'S9', tm_ef: futureEf, clr_ntc_tm: '' }));
    // _isChildZoneCode 는 이름 기반 폴백도 있으므로 코드 미상값이어도 자식명이면 자식 취급
    mc._enrichSnapshotWithLatest(s, [efRow(PN, { warn_tp: 'V', tm_ef: futureEf })], null, sascRows);
    const info = s.parents.get(PN);
    ok('(e) 05:14 리허설: sasc 자식 합류 → 미상 아님', !!info && !info._childUnknown,
        info ? `kids=${s.children.has(PN) ? s.children.get(PN).size : 0}` : 'no parent');
}
// (f) warn/latest GAP — 자식 전무(전 자식 제외행) → 미상
{
    const s = mkSnap();
    KIDS.forEach(k => s.excludedChildren.add(k));
    mc._enrichSnapshotWithLatest(s, [efRow(PN, { warn_tp: 'V', tm_ef: futureEf })], null, []);
    const info = s.parents.get(PN);
    ok('(f) warn/latest GAP 자식 전무 → _childUnknown', !!info && info._childUnknown === true);
}

// ── [3] 차분(diff) 전파 — UPCOMING_CHANGE childState.unknown ────────────────
console.log('\n[3] _buildUserPushChanges 전파');
const snap = (parents = {}, children = {}) => ({
    parents: new Map(Object.entries(parents)),
    upcomings: new Map(),
    children: new Map(Object.entries(children).map(([k, v]) => [k, new Map(Object.entries(v))]))
});
const GAPPRELIM = (over = {}) => Object.assign({
    wrnTp: 'V', wrnTpNm: '풍랑', wrnLvl: '1', wrnLvlNm: '예비',
    tmFc: '2026.07.18 05:10', tmEf: '2026.07.18 06:00', tmYn: '', clrNtcTm: '', _childUnknown: true
}, over);
{
    mc._resetCancelVerdictsForTest();
    // 신규 GAP 부모(미상) 등장 — 7/18 05:12
    let changes = mc._buildUserPushChanges(snap({}), snap({ [PN2]: GAPPRELIM() }));
    const up = changes.find(c => c.type === 'UPCOMING_CHANGE' && c.zone === PN2);
    ok('신규 발표 change 에 unknown 전파', !!up && up.childState && up.childState.unknown === true);
    // 2분 뒤: 자식 합류(같은 부모, 미상 표식 소멸) — unknown 없어야
    changes = mc._buildUserPushChanges(
        snap({ [PN2]: GAPPRELIM() }),
        snap({ [PN2]: GAPPRELIM({ _childUnknown: undefined }) }, { [PN2]: { '인천·경기북부앞바다중평수구역': { wrnTpNm: '풍랑', wrnLvlNm: '예비' } } }));
    const upAll = changes.filter(c => c.type === 'UPCOMING_CHANGE');
    ok('자식 합류 후 unknown 없음', upAll.every(c => !c.childState || c.childState.unknown !== true));
    // 정식 예비(미상 아님)가 자식 없이 등장 → unknown 없음 (진짜 미발표 유지)
    mc._resetCancelVerdictsForTest();
    changes = mc._buildUserPushChanges(snap({}), snap({ [PN2]: GAPPRELIM({ _childUnknown: undefined }) }));
    const up3 = changes.find(c => c.type === 'UPCOMING_CHANGE' && c.zone === PN2);
    ok('정식 경로 자식 부재 → unknown 미전파("미발표" 유지)', !!up3 && (!up3.childState || up3.childState.unknown !== true));
}

// ── [4] 실사고 리허설 — 05:12 푸시 본문 재구성 ──────────────────────────────
console.log('\n[4] 7/18 05:12 본문 리허설');
{
    const itemUnknown = { zones: [PN, PN2], tmFc: '2026.07.18 05:10', tmEf: '2026.07.18 06:00', tmYn: '',
        childStateByZone: null };
    // generateMessage 는 items[].childState(단일) 경로 — 두 부모를 한 item 으로 묶는 실경로 재현
    const gU = generateMessage({ templateId: 'publish', typeName: '풍랑', level: '주의보',
        items: [{ zones: [PN, PN2], tmFc: '2026.07.18 05:10', tmEf: '2026.07.18 06:00', tmYn: '',
            childState: { all: KIDS, active: [], added: [], released: [], unknown: true } }],
        showChildZones: true });
    ok('미상: 본문에 "미발표" 없음', gU.body && gU.body.indexOf('미발표') === -1, gU.body);
    ok('미상: 해역명·발효예정은 유지', gU.body.indexOf(PN) !== -1 && /발효예정/.test(gU.body));
    const gK = generateMessage({ templateId: 'publish', typeName: '풍랑', level: '주의보',
        items: [{ zones: [PN], tmFc: '2026.07.18 05:10', tmEf: '2026.07.18 06:00', tmYn: '',
            childState: { all: KIDS, active: KIDS, added: [], released: [] } }],
        showChildZones: true });
    ok('자식 확인 후: "모든 평수구역 포함" 표기', /모든 평수구역 포함/.test(gK.body), gK.body);
    const gE = generateMessage({ templateId: 'publish', typeName: '풍랑', level: '주의보',
        items: [{ zones: [PN], tmFc: '2026.07.18 05:10', tmEf: '2026.07.18 06:00', tmYn: '',
            childState: { all: KIDS, active: [], added: [], released: [] } }],
        showChildZones: true });
    ok('확정 미발표(정식 경로): "미발표" 유지', /평수구역 미발표/.test(gE.body), gE.body);
}

console.log(`\n[child_unknown_gate] ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
