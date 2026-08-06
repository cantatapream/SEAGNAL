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
    const done = mc._refineUpcomingExactEf(s, Z, { wrnTpNm: '풍랑', tmEf: EXACT, tmFc: '2026.08.06 11:30' });
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
    ok('(g) 공존 예비(upcomings) 정밀화', mc._refineUpcomingExactEf(s7, Z, { wrnTpNm: '풍랑', tmEf: EXACT, tmFc: '2026.08.06 11:30' }) === true
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

// ── [5] §7.7.25-2 늦은 확정 — 발효시각 경과 후 발표된 정확시각 ──────────────
console.log('\n[5] 늦은 확정(과거 정확시각) 수용 조건');
{
    // 과거 시각 만들기: KST 기준 "오늘 00:00" 은 항상 과거. 범위는 그 시각을 포함하도록 구성.
    const kst = new Date(Date.now() + 9 * 3600000);
    const Y = kst.getUTCFullYear(), M = String(kst.getUTCMonth() + 1).padStart(2, '0'), D = String(kst.getUTCDate()).padStart(2, '0');
    const pastExact = `${Y}.${M}.${D} 00:00`;                  // 오늘 00시 (이미 지남)
    const rangeCover = `${Y}.${M}.${D} 00~06시`;               // 00시를 시작점으로 포함하는 범위
    const rangeNotCover = `${Y}.${M}.${D} 03~09시`;            // 00시를 포함하지 않는 범위
    const pastOutside = `${Y}.${M}.${D} 01:00`;                // 범위(03~09시) 밖 과거값

    // (a) 사장님 시나리오: 12시(=범위 끝) 도래 후 "12시 발효" 통보문 → 범위 안이므로 수용
    const s = mkSnap(); s.parents.set(Z, PRELIM({ tmEf: rangeCover }));
    ok('(a) 늦은 확정이 범위 안이면 수용', mc._refineUpcomingExactEf(s, Z, { wrnTpNm: '풍랑', tmEf: pastExact, tmFc: `${Y}.${M}.${D} 00:10` }) === true
        && s.parents.get(Z).tmEf === pastExact && s.parents.get(Z)._efExactFrom === rangeCover);

    // (b) 범위 밖 과거값(옛 통보문)은 거부 — 유령특보 차단 유지
    const s2 = mkSnap(); s2.parents.set(Z, PRELIM({ tmEf: rangeNotCover }));
    ok('(b) 범위 밖 과거값 거부(유령특보 차단)', mc._refineUpcomingExactEf(s2, Z, { wrnTpNm: '풍랑', tmEf: pastOutside }) === false
        && s2.parents.get(Z).tmEf === rangeNotCover);

    // (c) ef/list 경로 통합 — 과거 정확시각 행이 정밀화로만 반영되고 신규 생성은 안 됨
    const s3 = mkSnap(); s3.parents.set(Z, PRELIM({ tmEf: rangeCover }));
    mc._enrichSnapshotWithEfList(s3, [{
        warn_tp_nm: '풍랑', warn_cmd_nm: '발표', warn_zone_nm: Z, warn_zone_cd: '',
        tm_fc: '202608061210', tm_seq: 9, ed_tm: pastExact
    }], null);
    ok('(c) ef/list 늦은 확정 반영', s3.parents.get(Z).tmEf === pastExact);

    // (d) ef/list — 모르는 해역의 과거 통보문은 신규 생성 안 함 (종전 가드 유지)
    const s4 = mkSnap();
    mc._enrichSnapshotWithEfList(s4, [{
        warn_tp_nm: '풍랑', warn_cmd_nm: '발표', warn_zone_nm: Z2, warn_zone_cd: '',
        tm_fc: '202608061210', tm_seq: 9, ed_tm: pastExact
    }], null);
    ok('(d) 미등장 해역 과거 통보문은 신규 생성 안 함', !s4.parents.has(Z2));

    // (e) warn/latest 경로 통합
    const s5 = mkSnap(); s5.parents.set(Z2, PRELIM({ tmEf: rangeCover }));
    mc._enrichSnapshotWithLatest(s5, [{
        warn_tp: 'V', warn_tp_nm: '풍랑', warn_cmd_nm: '발표', warn_zone_nm: Z2, warn_zone_cd: '',
        tm_fc: '202608061210', tm_ef: pastExact
    }], null, []);
    ok('(e) warn/latest 늦은 확정 반영', s5.parents.get(Z2).tmEf === pastExact);

    // (f) 발효중 해역은 늦은 확정으로도 안 건드림
    const s6 = mkSnap(); s6.parents.set(Z, ACTIVE({ tmEf: rangeCover }));
    ok('(f) 발효중 해역 비대상(늦은 확정)', mc._refineUpcomingExactEf(s6, Z, { wrnTpNm: '풍랑', tmEf: pastExact }) === false);

    // (g) 차분 발사 — 범위 → 늦은 확정(같은 모멘트여도 표식으로 1회 발사)
    mc._resetCancelVerdictsForTest();
    const changes = mc._buildUserPushChanges(
        snapOf({ [Z]: PRELIM({ tmEf: rangeCover }) }),
        snapOf({ [Z]: PRELIM({ tmEf: pastExact, _efExactFrom: rangeCover }) }));
    const up = changes.find(c => c.type === 'UPCOMING_CHANGE' && c.zone === Z);
    ok('(g) 늦은 확정도 UPCOMING_CHANGE 발사', !!up && up.curr.tmEf === pastExact);
}

// ── [6] 적대검증 결함 수정 고정 (1·2·3·4·5·6) ─────────────────────────────
console.log('\n[6] 적대검증 수정 회귀 고정');
{
    const kst = new Date(Date.now() + 9 * 3600000);
    const Y = kst.getUTCFullYear(), M = String(kst.getUTCMonth() + 1).padStart(2, '0'), D = String(kst.getUTCDate()).padStart(2, '0');
    const pastExact = `${Y}.${M}.${D} 00:00`;
    const rangeCover = `${Y}.${M}.${D} 00~06시`;

    // [결함1-a] 옛 통보문(발표시각이 예비보다 이른)은 과거 정확시각을 못 덮어씀
    const s1 = mkSnap(); s1.parents.set(Z, PRELIM({ tmEf: rangeCover, tmFc: `${Y}.${M}.${D} 04:00` }));
    ok('[결함1] 옛 통보문(tmFc 이른) 거부', mc._refineUpcomingExactEf(s1, Z, {
        wrnTpNm: '풍랑', tmEf: pastExact, tmFc: `${Y}.${M}.${D} 01:00` }) === false
        && s1.parents.get(Z).tmEf === rangeCover);
    // [결함1-b] 최신 통보문(발표시각이 예비 이후)은 정상 수용
    const s1b = mkSnap(); s1b.parents.set(Z, PRELIM({ tmEf: rangeCover, tmFc: `${Y}.${M}.${D} 04:00` }));
    ok('[결함1] 최신 통보문 수용', mc._refineUpcomingExactEf(s1b, Z, {
        wrnTpNm: '풍랑', tmEf: pastExact, tmFc: `${Y}.${M}.${D} 05:00` }) === true);
    // [결함1-c] 등급 불일치(발효중 주의보 통보문 → 경보 예비) 거부
    const s1c = mkSnap();
    s1c.parents.set(Z, ACTIVE());
    s1c.upcomings.set(Z, PRELIM({ tmEf: rangeCover, wrnLvlReal: '경보' }));
    ok('[결함1] 등급 불일치(주의보 통보문 vs 경보 예비) 거부', mc._refineUpcomingExactEf(s1c, Z, {
        wrnTpNm: '풍랑', tmEf: pastExact, _realLvlNm: '주의보' }) === false
        && s1c.upcomings.get(Z).tmEf === rangeCover);

    // [결함2] ef/list: 옛 행과 최신 행이 함께 와도 "최신"이 이김
    const s2 = mkSnap(); s2.parents.set(Z, PRELIM({ tmEf: futureRange, tmFc: '202608060400' }));
    const rowOf = (tmfc, seq, ed) => ({ warn_tp_nm: '풍랑', warn_cmd_nm: '발표', warn_zone_nm: Z,
        warn_zone_cd: '', tm_fc: tmfc, tm_seq: seq, ed_tm: ed });
    mc._enrichSnapshotWithEfList(s2, [rowOf('202608060600', 1, pastExact), rowOf('202608061100', 9, futureExact)], null);
    ok('[결함2] ef/list 최신 통보문 채택', s2.parents.get(Z).tmEf === futureExact, s2.parents.get(Z).tmEf);
    // 행 순서를 뒤집어도 동일
    const s2b = mkSnap(); s2b.parents.set(Z, PRELIM({ tmEf: futureRange, tmFc: '202608060400' }));
    mc._enrichSnapshotWithEfList(s2b, [rowOf('202608061100', 9, futureExact), rowOf('202608060600', 1, pastExact)], null);
    ok('[결함2] ef/list 행 순서 비의존', s2b.parents.get(Z).tmEf === futureExact);
    // [결함2] warn/latest 도 행 순서 비의존
    const wrow = (tmfc, ef) => ({ warn_tp: 'V', warn_tp_nm: '풍랑', warn_cmd_nm: '발표',
        warn_zone_nm: Z2, warn_zone_cd: '', tm_fc: tmfc, tm_ef: ef });
    const s2c = mkSnap(); s2c.parents.set(Z2, PRELIM({ tmEf: futureRange, tmFc: '202608060400' }));
    mc._enrichSnapshotWithLatest(s2c, [wrow('202608060600', pastExact), wrow('202608061100', futureExact)], null, []);
    const s2d = mkSnap(); s2d.parents.set(Z2, PRELIM({ tmEf: futureRange, tmFc: '202608060400' }));
    mc._enrichSnapshotWithLatest(s2d, [wrow('202608061100', futureExact), wrow('202608060600', pastExact)], null, []);
    ok('[결함2] warn/latest 행 순서 비의존', s2c.parents.get(Z2).tmEf === futureExact
        && s2d.parents.get(Z2).tmEf === futureExact, `${s2c.parents.get(Z2).tmEf} / ${s2d.parents.get(Z2).tmEf}`);

    // [결함4] 자정 넘김 범위에서 늦은 확정 수용 (종전엔 전건 거부)
    const y = new Date(Date.now() + 9 * 3600000 - 24 * 3600000);   // 어제(KST)
    const Y2 = y.getUTCFullYear(), M2 = String(y.getUTCMonth() + 1).padStart(2, '0'), D2 = String(y.getUTCDate()).padStart(2, '0');
    const overnight = `${Y2}.${M2}.${D2} 22~02시`;                  // 어제 22시 ~ 오늘 02시
    const inOvernight = `${Y}.${M}.${D} 01:00`;                     // 오늘 01시 (범위 안, 과거)
    const outOvernight = `${Y}.${M}.${D} 05:00`;                    // 범위 밖
    const s4 = mkSnap(); s4.parents.set(Z, PRELIM({ tmEf: overnight, tmFc: `${Y2}.${M2}.${D2} 20:00` }));
    ok('[결함4] 자정 넘김 범위 안 늦은 확정 수용', mc._refineUpcomingExactEf(s4, Z, {
        wrnTpNm: '풍랑', tmEf: inOvernight, tmFc: `${Y}.${M}.${D} 01:20` }) === true
        && s4.parents.get(Z).tmEf === inOvernight);
    const s4b = mkSnap(); s4b.parents.set(Z, PRELIM({ tmEf: overnight, tmFc: `${Y2}.${M2}.${D2} 20:00` }));
    ok('[결함4] 자정 넘김 범위 밖은 여전히 거부', mc._refineUpcomingExactEf(s4b, Z, {
        wrnTpNm: '풍랑', tmEf: outOvernight, tmFc: `${Y}.${M}.${D} 05:20` }) === false);

    // [결함5] 정밀화 표식이 있으면 디바운스를 즉시 통과 (통보문 휘발에도 확정)
    const s5 = { parents: new Map([[Z, PRELIM({ tmEf: EXACT, _efExactFrom: RANGE })]]), upcomings: new Map(), children: new Map() };
    mc._debounceTimeValues(s5);
    ok('[결함5] 정밀화 값은 디바운스 즉시 수락', s5.parents.get(Z).tmEf === EXACT);

    // [결함1-d] 발효시각보다 "먼저" 발표된 과거 통보문 = 다른 에피소드 → 거부
    const s1d = mkSnap(); s1d.parents.set(Z, PRELIM({ tmEf: rangeCover, tmFc: `${Y}.${M}.${D} 00:05` }));
    ok('[결함1] 발효시각 이전 발표(옛 에피소드) 거부', mc._refineUpcomingExactEf(s1d, Z, {
        wrnTpNm: '풍랑', tmEf: `${Y}.${M}.${D} 03:00`, tmFc: `${Y}.${M}.${D} 01:00` }) === false);

    // [결함6] parents 예비 + upcomings 동시 존재 → 푸시가 읽는 parents 쪽을 갱신
    const s6 = mkSnap();
    s6.parents.set(Z, PRELIM({ tmEf: futureRange }));
    s6.upcomings.set(Z, PRELIM({ tmEf: futureRange }));
    ok('[결함6] parents(푸시가 읽는 쪽) 우선 갱신', mc._refineUpcomingExactEf(s6, Z, { wrnTpNm: '풍랑', tmEf: futureExact }) === true
        && s6.parents.get(Z).tmEf === futureExact);
}

// ── [7] 적대검증 A — 공존 예비가 발효중 특보의 시각을 물려받지 않는다 ────────
console.log('\n[7] 공존 예비 시각 오염 방지 (격상 발표 본문)');
{
    const ACT_EXACT = '2026.08.06 03:00';     // 발효중 주의보의 발효시각(이미 지난 시각)
    const PRE_RANGE = '2026.08.06 06~12시';   // 새로 등장한 경보 예비의 예고 범위
    // C1: 주의보 단독 발효중
    const prev = { parents: new Map([[Z, ACTIVE({ tmEf: ACT_EXACT, wrnLvlNm: '주의보' })]]),
                   upcomings: new Map(), children: new Map() };
    // C2: 같은 해역에 경보 예비 공존 등장 (예고는 범위형)
    const curr = { parents: new Map([[Z, ACTIVE({ tmEf: ACT_EXACT, wrnLvlNm: '주의보' })]]),
                   upcomings: new Map([[Z, PRELIM({ tmEf: PRE_RANGE, wrnLvlReal: '경보', wrnLvl: '3' })]]),
                   children: new Map() };
    mc._applyUpcomingEfLogic(prev, curr);
    ok('[A] 공존 예비가 발효중 주의보 시각을 상속하지 않음',
        curr.upcomings.get(Z).tmEf === PRE_RANGE, curr.upcomings.get(Z).tmEf);
    ok('[A] 발효중 주의보 자신의 시각은 그대로 유지',
        curr.parents.get(Z).tmEf === ACT_EXACT, curr.parents.get(Z).tmEf);

    // 회귀: 직전에도 "예비"였으면 종전대로 정확값 고정(깜빡임 방지)이 살아 있어야
    const prev2 = { parents: new Map([[Z, PRELIM({ tmEf: '2026.08.06 09:00' })]]),
                    upcomings: new Map(), children: new Map() };
    const curr2 = { parents: new Map(),
                    upcomings: new Map([[Z, PRELIM({ tmEf: PRE_RANGE })]]), children: new Map() };
    mc._applyUpcomingEfLogic(prev2, curr2);
    ok('[A] 회귀: 직전도 예비였으면 정확값 고정 유지',
        curr2.upcomings.get(Z).tmEf === '2026.08.06 09:00', curr2.upcomings.get(Z).tmEf);
}

console.log(`\n[ef_exact_refine] ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
