'use strict';
// ============================================================================
// [§7.7.25] 발효시각 "범위형 → 정확시각" 정밀화 알림 — node scripts/test_ef_exact_refine.js
//   2026-08-06 실사고: 제주도남동/남서쪽안쪽먼바다 예고 "8/6 06~12시" → 09:00 통보문이
//   "11시" 확정. 정확시각이 범위 "안"이라 MMIS 예비 목록이 안 바뀌었고, GAP 보강 2경로는
//   "이미 예비면 skip" 가드로 통보문을 통째로 버려 사용자 통지가 침묵했다.
//   수정: 등급·종류·해역 구성은 불변, tmEf 만 정밀화 + 경계(정확=범위 끝) 1회 발사.
//   [연계] marine_warning_crawler(_refineUpcomingExactEf · _enrichSnapshot* · _buildUserPushChanges)
// ============================================================================
const path = require('path');
const mc = require(path.join(__dirname, '..', 'marine_warning_crawler.js'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌ FAIL:', name, extra === undefined ? '' : extra); } };

const Z = '제주도남동쪽안쪽먼바다';
const Z2 = '제주도남서쪽안쪽먼바다';
const RANGE = '2026.08.06 06~12시';
const EXACT = '2026.08.06 11:00';

const mkSnap = () => ({
    parents: new Map(), upcomings: new Map(), children: new Map(),
    excludedChildren: new Set(), liveChildren: new Set()
});
const PRELIM = (over = {}) => Object.assign({
    wrnTp: 'V', wrnTpNm: '풍랑', wrnLvl: '1', wrnLvlNm: '예비',
    tmFc: '2026.08.05 04:00', tmEf: RANGE, tmYn: '', clrNtcTm: ''
}, over);
const ACTIVE = (over = {}) => Object.assign({
    wrnTp: 'V', wrnTpNm: '풍랑', wrnLvl: '2', wrnLvlNm: '주의보',
    tmFc: '2026.08.05 04:00', tmEf: RANGE, tmYn: '', clrNtcTm: ''
}, over);

// ── [1] 정밀화 헬퍼 단위 — 무엇을 갱신하고 무엇을 건드리지 않는가 ────────────
console.log('\n[1] _refineUpcomingExactEf 조건 매트릭스');
{
    // (a) 실사고 케이스: 예비(범위) + 통보문(정확) → 갱신 + 표식
    const s = mkSnap(); s.parents.set(Z, PRELIM());
    const done = mc._refineUpcomingExactEf(s, Z, { wrnTpNm: '풍랑', tmEf: EXACT });
    const cur = s.parents.get(Z);
    ok('(a) 범위→정확 정밀화 + _efExactFrom 표식', done === true && cur.tmEf === EXACT && cur._efExactFrom === RANGE);
    ok('(a) 등급·종류 불변(정밀화는 시각만)', cur.wrnLvlNm === '예비' && cur.wrnTpNm === '풍랑' && cur.wrnLvl === '1');

    // (b) 발효중(주의보)은 대상 아님 — tmEf 무의미 + 발효 해역 오염 금지
    const s2 = mkSnap(); s2.parents.set(Z, ACTIVE());
    ok('(b) 발효중 해역 비대상', mc._refineUpcomingExactEf(s2, Z, { wrnTpNm: '풍랑', tmEf: EXACT }) === false
        && s2.parents.get(Z).tmEf === RANGE);

    // (c) 종류 불일치(태풍 통보문 → 풍랑 예비) 비대상
    const s3 = mkSnap(); s3.parents.set(Z, PRELIM());
    ok('(c) 종류 불일치 비대상', mc._refineUpcomingExactEf(s3, Z, { wrnTpNm: '태풍', tmEf: EXACT }) === false
        && s3.parents.get(Z).tmEf === RANGE);

    // (d) 통보문도 범위형이면 비대상 (정밀화 아님)
    const s4 = mkSnap(); s4.parents.set(Z, PRELIM());
    ok('(d) 통보문 범위형 비대상', mc._refineUpcomingExactEf(s4, Z, { wrnTpNm: '풍랑', tmEf: '2026.08.06 06~12시' }) === false);

    // (e) 이미 정확값이면 손대지 않음 (정확↔정확은 기존 GAP/변경 경로 소관)
    const s5 = mkSnap(); s5.parents.set(Z, PRELIM({ tmEf: EXACT }));
    ok('(e) 이미 정확값이면 비대상', mc._refineUpcomingExactEf(s5, Z, { wrnTpNm: '풍랑', tmEf: '2026.08.06 13:00' }) === false
        && s5.parents.get(Z).tmEf === EXACT);

    // (f) 미등장 해역(신규 GAP 대상)은 비대상 — 기존 GAP 생성 경로가 처리
    const s6 = mkSnap();
    ok('(f) 미등장 해역 비대상(GAP 경로 보존)', mc._refineUpcomingExactEf(s6, Z, { wrnTpNm: '풍랑', tmEf: EXACT }) === false);

    // (g) 발효중 + 공존 예비(upcomings) → 예비 쪽이 정밀화 대상
    const s7 = mkSnap(); s7.parents.set(Z, ACTIVE()); s7.upcomings.set(Z, PRELIM({ wrnLvl: '3' }));
    ok('(g) 공존 예비(upcomings) 정밀화', mc._refineUpcomingExactEf(s7, Z, { wrnTpNm: '풍랑', tmEf: EXACT }) === true
        && s7.upcomings.get(Z).tmEf === EXACT && s7.parents.get(Z).tmEf === RANGE);
}

// ── [2] 보강 함수 통합 — warn/latest · ef/list 두 경로 모두 ─────────────────
console.log('\n[2] GAP 보강 경로 통합 (skip 가드는 유지, 시각만 통과)');
const futureExact = (() => {
    const d = new Date(Date.now() + 9 * 3600000 + 6 * 3600000);   // KST 기준 6시간 뒤(미래 정확시각)
    return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:00`;
})();
const futureRange = (() => {
    const d = new Date(Date.now() + 9 * 3600000 + 6 * 3600000);
    return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')} 00~${String(d.getUTCHours() + 1).padStart(2, '0')}시`;
})();
{
    // ef/list 경로
    const s = mkSnap(); s.parents.set(Z, PRELIM({ tmEf: futureRange }));
    mc._enrichSnapshotWithEfList(s, [{
        warn_tp_nm: '풍랑', warn_cmd_nm: '발표', warn_zone_nm: Z, warn_zone_cd: '',
        tm_fc: '202608060900', tm_seq: 6, ed_tm: futureExact
    }], null);
    ok('ef/list: 정밀화 반영', s.parents.get(Z).tmEf === futureExact && s.parents.get(Z)._efExactFrom === futureRange);
    ok('ef/list: 부모 중복 생성 없음(가드 유지)', s.parents.size === 1);

    // warn/latest 경로
    const s2 = mkSnap(); s2.parents.set(Z2, PRELIM({ tmEf: futureRange }));
    mc._enrichSnapshotWithLatest(s2, [{
        warn_tp: 'V', warn_tp_nm: '풍랑', warn_cmd_nm: '발표', warn_zone_nm: Z2, warn_zone_cd: '',
        tm_fc: '202608060900', tm_ef: futureExact
    }], null, []);
    ok('warn/latest: 정밀화 반영', s2.parents.get(Z2).tmEf === futureExact);
    ok('warn/latest: 부모 중복 생성 없음(가드 유지)', s2.parents.size === 1);

    // 회귀: 미등장 해역은 종전대로 GAP 신규 생성
    const s3 = mkSnap();
    mc._enrichSnapshotWithEfList(s3, [{
        warn_tp_nm: '풍랑', warn_cmd_nm: '발표', warn_zone_nm: Z, warn_zone_cd: '',
        tm_fc: '202608060900', tm_seq: 6, ed_tm: futureExact
    }], null);
    ok('회귀: 신규 GAP 생성 경로 불변', s3.parents.has(Z) && s3.parents.get(Z).tmEf === futureExact
        && !s3.parents.get(Z)._efExactFrom);
}

// ── [3] 차분 → 푸시 발사 (실사고 재현 + 경계 케이스) ────────────────────────
console.log('\n[3] _buildUserPushChanges 발사 판정');
const snapOf = (parents = {}) => ({
    parents: new Map(Object.entries(parents)),
    upcomings: new Map(),
    children: new Map()
});
{
    mc._resetCancelVerdictsForTest();
    // (a) 8/6 실사고 재현: 06~12시 → 11시 (범위 안, 끝 아님)
    let changes = mc._buildUserPushChanges(
        snapOf({ [Z]: PRELIM() }),
        snapOf({ [Z]: PRELIM({ tmEf: EXACT, _efExactFrom: RANGE }) }));
    let up = changes.find(c => c.type === 'UPCOMING_CHANGE' && c.zone === Z);
    ok('(a) 실사고 재현: UPCOMING_CHANGE 발사', !!up && up.curr && up.curr.tmEf === EXACT);
    ok('(a) prev 는 범위형 유지(푸시가 변경으로 매핑되는 근거)', !!up && up.prev && up.prev.tmEf === RANGE);

    // (b) 경계: 정확시각 = 범위 끝(12시) — 동일모멘트 흡수를 우회해 발사되어야
    const EXACT_END = '2026.08.06 12:00';
    changes = mc._buildUserPushChanges(
        snapOf({ [Z]: PRELIM() }),
        snapOf({ [Z]: PRELIM({ tmEf: EXACT_END, _efExactFrom: RANGE }) }));
    up = changes.find(c => c.type === 'UPCOMING_CHANGE' && c.zone === Z);
    ok('(b) 경계(정확=범위 끝) 발사', !!up && up.curr.tmEf === EXACT_END);

    // (c) 표식 없이 동일모멘트면 종전대로 흡수(무푸시) — 흡수 규칙 자체는 불변
    changes = mc._buildUserPushChanges(
        snapOf({ [Z]: PRELIM() }),
        snapOf({ [Z]: PRELIM({ tmEf: EXACT_END }) }));
    ok('(c) 표식 없는 동일모멘트는 종전대로 흡수', !changes.some(c => c.type === 'UPCOMING_CHANGE' && c.zone === Z && c.curr));

    // (d) 재발사 없음: 이미 정확값으로 정착한 다음 사이클(표식 잔존해도 prev 가 정확)
    changes = mc._buildUserPushChanges(
        snapOf({ [Z]: PRELIM({ tmEf: EXACT, _efExactFrom: RANGE }) }),
        snapOf({ [Z]: PRELIM({ tmEf: EXACT, _efExactFrom: RANGE }) }));
    ok('(d) 정착 후 재발사 없음', !changes.some(c => c.type === 'UPCOMING_CHANGE' && c.zone === Z && c.curr));

    // (e) 디바운스 롤백 중(curr 가 다시 범위)이면 발사 안 함
    changes = mc._buildUserPushChanges(
        snapOf({ [Z]: PRELIM() }),
        snapOf({ [Z]: PRELIM({ _efExactFrom: RANGE }) }));   // tmEf 는 범위로 되돌려진 상태
    ok('(e) 디바운스 롤백 중 무발사', !changes.some(c => c.type === 'UPCOMING_CHANGE' && c.zone === Z && c.curr));
}

// ── [4] push_sender 매핑 — "🕐 발효시각 변경"(time_ef_change) 인지 ──────────
console.log('\n[4] push_sender 시나리오 매핑');
{
    const fs = require('fs');
    const src = fs.readFileSync(path.join(__dirname, '..', 'push_sender.js'), 'utf8');
    ok('time_ef_change 분기 존재(prev.tmEf !== curr.tmEf)', /prev\.tmEf !== curr\.tmEf[\s\S]{0,120}time_ef_change/.test(src));
    const { generateMessage } = require(path.join(__dirname, '..', 'services', 'push_helpers'));
    const g = generateMessage({
        templateId: 'time_ef_change', typeName: '풍랑', level: '주의보',
        items: [{ zones: [Z, Z2], tmFc: '2026.08.06 09:00', tmEf: EXACT, tmYn: '' }],
        showChildZones: false
    });
    ok('본문 제목 "발효시각 변경"', /발효시각 변경/.test(g.title), g.title);
    ok('본문에 정확시각 표기', /11시/.test(g.body), g.body);
}

console.log(`\n[ef_exact_refine] ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
