'use strict';
// ============================================================================
// [2026-08-08 실사고] 자식 정합 필터(§7.7.26) 검증 — node scripts/test_child_relevance.js
//
//   실사고: 경북남부앞바다. 통보문 제08-3호(8/8 16:00 예비특보 — 평수구역·연안바다 모두 포함,
//   발효예정 8/9 18~24시) → 제08-30호(8/8 22:00 풍랑주의보 발표 — "평수구역 제외",
//   발효 8/8 23:00). MMIS 는 양쪽을 정확히 제공(평수구역=8/9 예비특보, 연안바다=8/8 주의보).
//   그런데 우리 푸시는 22:05 "발효시각 변경"·23:00 "주의보 발효" 두 건 모두
//   "(모든 평수구역/연안바다 포함)" 으로 나갔다 — 내일(8/9) 예비인 평수구역을
//   오늘(8/8) 특보에 포함으로 집계한 것.
//
//   원인: buildChildQualifier 가 childState.active(= 스냅샷에 존재하는 자식 전부)를
//   등급·시각 무관하게 세었다. 같은 뿌리의 사고가 6/2·6/19·6/20·7/14 에 이어 5번째 재발이며,
//   기존 검사(test_child_unknown_gate 24건)는 "자식 목록이 빈" 반대 방향만 덮고 있어
//   매번 통과하며 지나갔다. 이 파일이 "과대 포함" 방향을 고정한다.
//
//   [연계] services/push_helpers(_relevantChildren·buildChildQualifier),
//          marine_warning_crawler(childState.meta/parentEfUpcoming/parentEfActive)
// ============================================================================
const path = require('path');
const mc = require(path.join(__dirname, '..', 'marine_warning_crawler.js'));
const { buildChildQualifier, _relevantChildren } = require(path.join(__dirname, '..', 'services', 'push_helpers'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌ FAIL:', name, extra || ''); } };

const PN = '경북남부앞바다';
const PS = '경북남부앞바다중평수구역';   // 실사고: 8/9 18~24시 발효예정 '예비'
const YN = '경북남부앞바다중연안바다';   // 실사고: 8/8 23:00 발효 '주의보'
const ALL = [PS, YN];
const EF_TODAY = '2026.08.08 23:00';
const EF_TOMORROW = '2026.08.09 18:00';

// ── [1] 실사고 재현 — "과대 포함" 차단 ──────────────────────────────────────
console.log('\n[1] 실사고 재현 (2026-08-08 경북남부앞바다)');
{
    // 23:00 "🚨 풍랑 주의보 발효" — 연안바다만 발효, 평수구역은 내일 예비
    const cs = {
        all: ALL, active: ALL, added: [], released: [],
        meta: { [PS]: { lvl: '예비', tmEf: EF_TOMORROW }, [YN]: { lvl: '주의보', tmEf: EF_TODAY } },
        parentEfActive: EF_TODAY, parentEfUpcoming: ''
    };
    const r = buildChildQualifier(PN, cs, 'active');
    ok('23:00 발효 → "(연안바다 포함)" (종전 "모든 … 포함" 오표기)', r === '(연안바다 포함)', r);

    // 22:05 "🕐 발효시각 변경" — 둘 다 '예비'지만 발효 날짜가 다름
    const cs2 = {
        all: ALL, active: ALL, added: [], released: [],
        meta: { [PS]: { lvl: '예비', tmEf: EF_TOMORROW }, [YN]: { lvl: '예비', tmEf: EF_TODAY } },
        parentEfActive: '', parentEfUpcoming: EF_TODAY
    };
    const r2 = buildChildQualifier(PN, cs2, 'time_ef_change');
    ok('22:05 발효시각변경 → "(연안바다 포함)"', r2 === '(연안바다 포함)', r2);

    // 이번 특보에 해당하는 자식이 하나도 없으면 "미발효" 단정 (침묵 아님 — 확정 정보임)
    const cs3 = {
        all: ALL, active: ALL, added: [], released: [],
        meta: { [PS]: { lvl: '예비', tmEf: EF_TOMORROW }, [YN]: { lvl: '예비', tmEf: EF_TOMORROW } },
        parentEfActive: EF_TODAY, parentEfUpcoming: ''
    };
    ok('전 자식이 내일 예비 → "(… 미발효)"', buildChildQualifier(PN, cs3, 'active') === '(평수구역/연안바다 미발효)');
}

// ── [2] _relevantChildren 단위 — 두 규칙 각각 ───────────────────────────────
console.log('\n[2] _relevantChildren 규칙별');
{
    const meta = { [PS]: { lvl: '예비', tmEf: EF_TODAY }, [YN]: { lvl: '주의보', tmEf: EF_TODAY } };
    // ① 발효 계열(tmYn 단계)에서 '예비' 자식 제외
    ok('① 발효 알림 + 예비 자식 → 제외',
        JSON.stringify(_relevantChildren({ meta, parentEfActive: EF_TODAY }, ALL, 'active')) === JSON.stringify([YN]));
    // ① 예비 계열(tmEf 단계)에서는 '예비' 자식 유지
    ok('① 예비 알림 + 예비 자식 → 유지',
        _relevantChildren({ meta, parentEfUpcoming: EF_TODAY }, ALL, 'publish').length === 2);
    // ② 날짜 다르면 제외
    const meta2 = { [PS]: { lvl: '예비', tmEf: EF_TOMORROW }, [YN]: { lvl: '예비', tmEf: EF_TODAY } };
    ok('② 발효일자 다름 → 제외',
        JSON.stringify(_relevantChildren({ meta: meta2, parentEfUpcoming: EF_TODAY }, ALL, 'publish')) === JSON.stringify([YN]));
    // ②' 같은 날이라도 양쪽 정확시각이 다르면 별개 특보 (2026-08-08 사용자 지적으로 강화). 상세 → [2-B]
    const meta3 = { [PS]: { lvl: '예비', tmEf: '2026.08.08 18:00' }, [YN]: { lvl: '예비', tmEf: EF_TODAY } };
    ok("②' 같은 날 + 정확시각 다름 → 제외",
        JSON.stringify(_relevantChildren({ meta: meta3, parentEfUpcoming: EF_TODAY }, ALL, 'publish')) === JSON.stringify([YN]));
    // 부모 시각을 모르면 날짜 규칙 비적용
    ok('부모 시각 없음 → 날짜 규칙 비적용',
        _relevantChildren({ meta: meta2 }, ALL, 'publish').length === 2);
    // meta 에 없는 자식은 종전대로 포함
    ok('meta 미등재 자식 → 종전대로 포함',
        _relevantChildren({ meta: { [YN]: { lvl: '주의보', tmEf: EF_TODAY } }, parentEfActive: EF_TODAY }, ALL, 'active').length === 2);
}

// ── [2-B] ②' 같은 날 안의 시각 대조 (사용자 지적 2026-08-08) ────────────────
//   날짜만 보면 "예비 발효예정이 부모와 같은 날, 다른 시각"인 별개 특보를 못 거른다.
//   양쪽 모두 정확시각일 때만 시각까지 대조한다 — 한쪽이 범위형이면 같은 특보인데도
//   문자열이 달라 멀쩡한 자식을 지우게 되므로 건너뛴다.
console.log('\n[2-B] 같은 날 시각 대조');
{
    const mk = (psEf, ynEf, pUp) => ({
        all: ALL, active: ALL, added: [], released: [],
        meta: { [PS]: { lvl: '예비', tmEf: psEf }, [YN]: { lvl: '예비', tmEf: ynEf } },
        parentEfUpcoming: pUp, parentEfActive: ''
    });
    ok('같은 날 다른 시각(둘 다 정확) → 제외',
        buildChildQualifier(PN, mk('2026.08.08 18:00', EF_TODAY, EF_TODAY), 'time_ef_change') === '(연안바다 포함)');
    ok('같은 날 같은 시각 → 둘 다 포함',
        buildChildQualifier(PN, mk(EF_TODAY, EF_TODAY, EF_TODAY), 'time_ef_change') === '(모든 평수구역/연안바다 포함)');
    ok('자식이 범위형이면 시각대조 건너뜀(오제외 방지)',
        buildChildQualifier(PN, mk('2026.08.08 18시~24시', EF_TODAY, EF_TODAY), 'time_ef_change') === '(모든 평수구역/연안바다 포함)');
    ok('시각차로 전원 제외될 상황 → 거짓 "미발표" 대신 1단계 결과 유지',
        buildChildQualifier(PN, mk('2026.08.08 18:00', '2026.08.08 19:00', EF_TODAY), 'time_ef_change') === '(모든 평수구역/연안바다 포함)');
    ok('부모가 범위형이면 시각대조 비적용',
        buildChildQualifier(PN, mk('2026.08.08 18:00', EF_TODAY, '2026.08.08 18시~24시'), 'time_ef_change') === '(모든 평수구역/연안바다 포함)');
}

// ── [3] 회귀 — 기존 표기 전부 보존 ──────────────────────────────────────────
console.log('\n[3] 회귀 (기존 동작 보존)');
{
    const csNoMeta = { all: ALL, active: ALL, added: [], released: [] };
    ok('meta 없음(구 스냅샷·S-matrix) → 종전 "모든 … 포함"',
        buildChildQualifier(PN, csNoMeta, 'active') === '(모든 평수구역/연안바다 포함)');

    const csAllSame = {
        all: ALL, active: ALL, added: [], released: [],
        meta: { [PS]: { lvl: '주의보', tmEf: EF_TODAY }, [YN]: { lvl: '주의보', tmEf: EF_TODAY } },
        parentEfActive: EF_TODAY, parentEfUpcoming: ''
    };
    ok('정상 전원 발효 → "모든 … 포함" 유지',
        buildChildQualifier(PN, csAllSame, 'active') === '(모든 평수구역/연안바다 포함)');

    // 자식 변동 계열(added/released)은 필터 대상 아님 — 종전 그대로
    const csAdd = Object.assign({}, csAllSame, { added: [YN] });
    ok('additional_active(추가 발효) 표기 유지',
        buildChildQualifier(PN, csAdd, 'additional_active') === '(연안바다 추가 발효)');
    const csRel = Object.assign({}, csAllSame, { released: [PS] });
    ok('partial_release(일부 해제) 표기 유지',
        buildChildQualifier(PN, csRel, 'partial_release') === '(평수구역만 해제)');
    ok('release(부모 동시 해제) 무한정사 유지',
        buildChildQualifier(PN, csAllSame, 'release') === '');

    // 미상 게이트(§7.7.24) 무손상 — 빈 목록 + unknown 은 여전히 침묵
    ok('미상 게이트 보존(침묵)',
        buildChildQualifier(PN, { all: ALL, active: [], added: [], released: [], unknown: true }, 'publish') === '');

    // 자식 없는 먼바다 — 종전대로 무한정사
    ok('자식 없는 먼바다 무한정사 유지',
        buildChildQualifier('동해남부북쪽바깥먼바다', { all: [], active: [], added: [], released: [] }, 'active') === '');
}

// ── [4] 크롤러 전파 — childState.meta / parentEf* 부착 ──────────────────────
console.log('\n[4] _buildUserPushChanges 전파');
{
    mc._resetCancelVerdictsForTest();
    const P = (over = {}) => Object.assign({
        wrnTp: 'V', wrnTpNm: '풍랑', wrnLvl: '2', wrnLvlNm: '주의보',
        tmFc: '2026.08.08 16:00', tmEf: EF_TODAY, tmYn: '', clrNtcTm: ''
    }, over);
    const C = (lvl, ef) => ({ wrnTp: 'V', wrnTpNm: '풍랑', wrnLvl: lvl === '예비' ? '1' : '2', wrnLvlNm: lvl,
        tmFc: '2026.08.08 16:00', tmEf: ef, tmYn: '', clrNtcTm: '' });
    const snap = (parents = {}, children = {}) => ({
        parents: new Map(Object.entries(parents)),
        upcomings: new Map(),
        children: new Map(Object.entries(children).map(([k, v]) => [k, new Map(Object.entries(v))]))
    });

    // 22:00 예비(발효예정 오늘 23시) → 23:00 주의보 발효. 평수구역은 내내 내일(8/9) 예비.
    const prev = snap({ [PN]: P({ wrnLvlNm: '예비', wrnLvl: '1' }) },
        { [PN]: { [PS]: C('예비', EF_TOMORROW), [YN]: C('예비', EF_TODAY) } });
    const curr = snap({ [PN]: P() },
        { [PN]: { [PS]: C('예비', EF_TOMORROW), [YN]: C('주의보', EF_TODAY) } });
    const changes = mc._buildUserPushChanges(prev, curr);
    const ch = changes.find(c => c.zone === PN && c.childState && c.childState.meta);
    ok('change 에 childState.meta 부착', !!ch, `changes=${changes.map(c => c.type).join(',')}`);
    if (ch) {
        ok('meta 에 자식별 등급 기록', ch.childState.meta[PS] && ch.childState.meta[PS].lvl === '예비');
        ok('meta 에 자식별 발효시각 기록', ch.childState.meta[YN] && ch.childState.meta[YN].tmEf === EF_TODAY);
        ok('parentEfActive 부착', ch.childState.parentEfActive === EF_TODAY, ch.childState.parentEfActive);
        // 종단 확인: 이 childState 로 발효 한정사를 만들면 연안바다만 잡혀야 한다
        ok('종단: 발효 한정사 = "(연안바다 포함)"',
            buildChildQualifier(PN, ch.childState, 'active') === '(연안바다 포함)',
            buildChildQualifier(PN, ch.childState, 'active'));
    }
}

console.log(`\n[child_relevance] ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
