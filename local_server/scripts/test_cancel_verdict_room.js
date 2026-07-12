'use strict';
// ============================================================================
// [§7.7.23] 판정 보류실 e2e 시뮬레이션 — node scripts/test_cancel_verdict_room.js
//   오보 3건(7/8·7/10·7/11) 리허설 + 판정 4경로 + 2차 적대검증 발견 케이스.
//   네트워크 없음(스캔 결과는 주입). data/marine_prelim_cancel_verdicts.json 을
//   만들었다 지우므로 운영 데이터가 있는 곳에서 돌리지 말 것.
// ============================================================================
const fs = require('fs');
const path = require('path');
const mc = require(path.join(__dirname, '..', 'marine_warning_crawler.js'));
const sc = require(path.join(__dirname, '..', 'services', 'bulletin_cancel_scanner.js'));

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌ FAIL:', name); } };

const snap = (parents = {}, children = {}, upcomings = {}) => ({
    parents: new Map(Object.entries(parents)),
    upcomings: new Map(Object.entries(upcomings)),
    children: new Map(Object.entries(children).map(([k, v]) => [k, new Map(Object.entries(v))]))
});
const PRELIM = (over = {}) => Object.assign({
    wrnTp: 'V', wrnTpNm: '풍랑', wrnLvl: '1', wrnLvlNm: '예비',
    tmFc: '2026.07.11 06:00', tmEf: '2026.07.11 06~12시', tmYn: '', clrNtcTm: ''
}, over);
const relOf = (sentence, over = {}) => {
    const r = sc.parseCancelPhrases('참고사항 o ' + sentence)[0];
    if (!r) throw new Error('테스트 문구가 정규식에 안 잡힘: ' + sentence);
    return Object.assign(r, { foundAt: Date.now(), issuedAtMs: Date.now() - 60 * 1000, source: 'test' }, over);
};
const freshScan = (releases) => ({ fetchedAt: Date.now(), releases, scannedCount: releases.length, rawByOffice: { t: '(test)' } });

const Z = '남해동부안쪽먼바다';
const cleanup = () => { try { fs.unlinkSync(mc._CANCEL_VERDICT_FILE); } catch (_) {} };

cleanup();

console.log('\n[1] 예비 소멸 → 즉시 취소 푸시 없음 + 보류 등록');
mc._resetCancelVerdictsForTest();
let changes = mc._buildUserPushChanges(snap({ [Z]: PRELIM() }), snap({}));
ok('UPCOMING_CANCEL 즉발 없음', !changes.some(c => c.type === 'UPCOMING_CANCEL'));
ok('보류 등록', mc._cvHasPendings());
ok('블록 캡처', mc._loadCancelVerdicts().parents[Z + '|풍랑'].block.wrnTp === '풍랑');

console.log('\n[2] 발표 전환(7/11 09:35 오보 리허설) → 폐기, 무푸시');
changes = mc._buildUserPushChanges(snap({}), snap({ [Z]: PRELIM({ _efBridged: true, _realLvlNm: '주의보', tmEf: '2026.07.11 11:30' }) }));
ok('전환 감지 폐기', !mc._cvHasPendings());
ok('취소 푸시 없음', !changes.some(c => c.type === 'UPCOMING_CANCEL'));

console.log('\n[3] 통보문 취소 문구 → 그때만 발사');
mc._resetCancelVerdictsForTest();
mc._buildUserPushChanges(snap({ [Z]: PRELIM() }), snap({}));
mc._setLastCancelScanForTest(freshScan([relOf('남해동부안쪽먼바다의 풍랑 예비특보는 발표 가능성이 낮아져 해제합니다')]));
changes = mc._buildUserPushChanges(snap({}), snap({}));
const fired = changes.find(c => c.type === 'UPCOMING_CANCEL');
ok('취소 발사', !!fired && fired.zone === Z && fired.prev.wrnTp === '풍랑');
ok('보류 소진', !mc._cvHasPendings());

console.log('\n[4] 만료 소멸(7/10 06:01 오보 리허설) → TTL 무푸시');
mc._resetCancelVerdictsForTest();
mc._setLastCancelScanForTest(null);
mc._buildUserPushChanges(snap({ [Z]: PRELIM() }), snap({}));
mc._loadCancelVerdicts().parents[Z + '|풍랑'].registeredAt = Date.now() - mc.CANCEL_VERDICT_TTL_MS - 1000;
changes = mc._buildUserPushChanges(snap({}), snap({}));
ok('TTL 무푸시 종료', !changes.some(c => c.type === 'UPCOMING_CANCEL') && !mc._cvHasPendings());

console.log('\n[5] [적대검증 1] 묵은 문구(이전 에피소드) 오확정 차단 — 시간 축 게이트');
mc._resetCancelVerdictsForTest();
mc._buildUserPushChanges(snap({ [Z]: PRELIM() }), snap({}));
const staleRel = relOf('남해동부안쪽먼바다의 풍랑 예비특보는 발표 가능성이 낮아져 해제합니다', { issuedAtMs: Date.now() - 100 * 60 * 1000, foundAt: Date.now() - 100 * 60 * 1000 });
mc._setLastCancelScanForTest(freshScan([staleRel]));
changes = mc._buildUserPushChanges(snap({}), snap({}));
ok('100분 전 발행 문구로는 미발사', !changes.some(c => c.type === 'UPCOMING_CANCEL') && mc._cvHasPendings());
const oldScan = freshScan([relOf('남해동부안쪽먼바다의 풍랑 예비특보는 발표 가능성이 낮아져 해제합니다')]);
oldScan.fetchedAt = Date.now() - 11 * 60 * 1000;
mc._setLastCancelScanForTest(oldScan);
changes = mc._buildUserPushChanges(snap({}), snap({}));
ok('스캔 결과 자체가 오래되면(11분) (c) 생략', !changes.some(c => c.type === 'UPCOMING_CANCEL') && mc._cvHasPendings());
mc._setLastCancelScanForTest(freshScan([relOf('남해동부안쪽먼바다의 풍랑 예비특보는 발표 가능성이 낮아져 해제합니다')]));
changes = mc._buildUserPushChanges(snap({}), snap({}));
ok('신선한 문구는 정상 발사', changes.some(c => c.type === 'UPCOMING_CANCEL'));

console.log('\n[6] [적대검증 1] 해역 단위 소각 — 한 문장 다해역은 모두 발사, 재사용은 차단');
mc._resetCancelVerdictsForTest();
const multi = relOf('남해서부서쪽먼바다, 남해서부동쪽먼바다의 풍랑 예비특보는 발표 가능성이 낮아져 해제합니다');
mc._buildUserPushChanges(snap({ '남해서부서쪽먼바다': PRELIM(), '남해서부동쪽먼바다': PRELIM() }), snap({}));
mc._setLastCancelScanForTest(freshScan([multi]));
changes = mc._buildUserPushChanges(snap({}), snap({}));
ok('두 해역 모두 발사', changes.filter(c => c.type === 'UPCOMING_CANCEL').length === 2);
mc._buildUserPushChanges(snap({ '남해서부서쪽먼바다': PRELIM() }), snap({}));   // 같은 해역 재등록(다음 에피소드 가정)
mc._loadCancelVerdicts().parents['남해서부서쪽먼바다|풍랑'].registeredAt = Date.now();   // 승계 무력화(신규 에피소드 흉내)
changes = mc._buildUserPushChanges(snap({}), snap({}));
ok('소각된 문구로 재확정 불가', !changes.some(c => c.type === 'UPCOMING_CANCEL'));

console.log('\n[7] 재등장/종류/발효 승격 판정');
mc._resetCancelVerdictsForTest();
mc._setLastCancelScanForTest(null);
mc._buildUserPushChanges(snap({ [Z]: PRELIM() }), snap({}));
mc._buildUserPushChanges(snap({}), snap({ [Z]: PRELIM({ wrnTpNm: '태풍', wrnTp: 'T' }) }));
ok('타 종류(태풍) 등장에도 풍랑 보류 유지', mc._cvHasPendings());
mc._buildUserPushChanges(snap({}), snap({ [Z]: PRELIM() }));
ok('같은 종류 재등장 → 폐기', !mc._cvHasPendings());
mc._buildUserPushChanges(snap({ [Z]: PRELIM() }), snap({}));
mc._buildUserPushChanges(snap({}), snap({ [Z]: PRELIM({ wrnLvlNm: '주의보', tmYn: '2026.07.15 15~18시' }) }));
ok('발효 승격 → 폐기', !mc._cvHasPendings());

console.log('\n[8] [적대검증 9] 재등록 시 registeredAt 승계 (TTL 무한 연장 방지)');
mc._resetCancelVerdictsForTest();
mc._buildUserPushChanges(snap({ [Z]: PRELIM() }), snap({}));
const firstAt = mc._loadCancelVerdicts().parents[Z + '|풍랑'].registeredAt;
mc._loadCancelVerdicts().parents[Z + '|풍랑'].registeredAt = firstAt - 5000;   // 시간 경과 흉내
mc._registerParentCancelVerdict(Z, { wrnTp: '풍랑', wrnLvl: '예비', tmFc: '', tmEf: '', tmYn: '' });
ok('같은 종류 재등록 → 승계', mc._loadCancelVerdicts().parents[Z + '|풍랑'].registeredAt === firstAt - 5000);

console.log('\n[9] 자식 보류 — 4단 매칭·종류·복원');
mc._resetCancelVerdictsForTest();
mc._registerChildCancelVerdict('제주도동부앞바다', '북동연안바다', { wrnTp: '풍랑', wrnLvl: '예비', tmFc: '', tmEf: '', tmYn: '' });
mc._setLastCancelScanForTest(freshScan([relOf('제주도동부앞바다의 풍랑 예비특보는 발표 가능성이 낮아져 해제합니다')]));
changes = mc._buildUserPushChanges(snap({ '제주도동부앞바다': PRELIM() }), snap({ '제주도동부앞바다': PRELIM() }));
const cf = changes.find(c => c.type === 'CHILD_PRELIM_CANCEL');
ok('부모명 대표로 자식 확정 발사', !!cf && cf.childState.released.includes('북동연안바다'));
// [적대검증 7] 자식 복귀 종류 일치
mc._resetCancelVerdictsForTest();
mc._setLastCancelScanForTest(null);
mc._registerChildCancelVerdict(Z, '남해동부안쪽먼바다중연안바다', { wrnTp: '풍랑', wrnLvl: '예비', tmFc: '', tmEf: '', tmYn: '' });
mc._buildUserPushChanges(snap({}), snap({ [Z]: PRELIM() }, { [Z]: { '남해동부안쪽먼바다중연안바다': PRELIM({ wrnTpNm: '태풍', wrnTp: 'T' }) } }));
ok('태풍으로 복귀한 동명 자식은 풍랑 보류 유지', mc._cvHasPendings());
mc._buildUserPushChanges(snap({}), snap({ [Z]: PRELIM() }, { [Z]: { '남해동부안쪽먼바다중연안바다': PRELIM() } }));
ok('풍랑으로 복귀 → 폐기', !mc._cvHasPendings());

console.log('\n[10-B] [3차 검증] 부모 (d) 만료 시에도 흡수 자식 복원 (데드라인 불일치)');
{
    mc._resetCancelVerdictsForTest();
    mc._setLastCancelScanForTest(null);
    const futureEf = (() => { const k = new Date(Date.now() + 10 * 3600e3 + 9 * 3600e3); const p = n => String(n).padStart(2, '0'); const H = p(k.getUTCHours()); return `${k.getUTCFullYear()}.${p(k.getUTCMonth() + 1)}.${p(k.getUTCDate())} ${H}~${H}시`; })();
    mc._registerChildCancelVerdict(Z, '남해동부안쪽먼바다중연안바다', { wrnTp: '풍랑', wrnLvl: '예비', tmFc: '', tmEf: futureEf, tmYn: '' });
    mc._buildUserPushChanges(snap({ [Z]: PRELIM({ tmEf: '' }) }), snap({}));   // 부모(발효예정 미상→기본 1h) 등록·흡수
    mc._loadCancelVerdicts().parents[Z + '|풍랑'].registeredAt = Date.now() - 61 * 60e3;   // 부모 만료
    mc._buildUserPushChanges(snap({}), snap({}));
    const vX = mc._loadCancelVerdicts();
    ok('부모 만료 후 자식 보류 복원(자기 데드라인 지속)', !vX.parents[Z + '|풍랑'] && !!vX.children[Z + '|남해동부안쪽먼바다중연안바다']);
}

console.log('\n[10] [적대검증 6] 부모 (a) 폐기 시 흡수 자식 복원');
mc._resetCancelVerdictsForTest();
mc._registerChildCancelVerdict(Z, '남해동부안쪽먼바다중연안바다', { wrnTp: '풍랑', wrnLvl: '예비', tmFc: '', tmEf: '', tmYn: '' });
mc._buildUserPushChanges(snap({ [Z]: PRELIM() }), snap({}));   // 부모 등록 → 자식 흡수
ok('흡수 후 자식 보류 0', Object.keys(mc._loadCancelVerdicts().children).length === 0);
mc._buildUserPushChanges(snap({}), snap({ [Z]: PRELIM() }));   // 부모 재등장(자식은 미복귀) → (a) 폐기
const vr = mc._loadCancelVerdicts();
ok('부모 폐기 + 자식 보류 복원', !vr.parents[Z + '|풍랑'] && !!vr.children[Z + '|남해동부안쪽먼바다중연안바다']);

console.log('\n[11] 부모 확정 시 부모명 1건 대표 (자식 별도 없음)');
mc._resetCancelVerdictsForTest();
mc._registerChildCancelVerdict(Z, '남해동부안쪽먼바다중연안바다', { wrnTp: '풍랑', wrnLvl: '예비', tmFc: '', tmEf: '', tmYn: '' });
mc._buildUserPushChanges(snap({ [Z]: PRELIM() }), snap({}));
mc._setLastCancelScanForTest(freshScan([relOf('남해동부안쪽먼바다의 풍랑 예비특보는 발표 가능성이 적어져 해제합니다')]));
changes = mc._buildUserPushChanges(snap({}), snap({}));
ok('UPCOMING_CANCEL 1건 + CHILD 0건', changes.filter(c => c.type === 'UPCOMING_CANCEL').length === 1 && !changes.some(c => c.type === 'CHILD_PRELIM_CANCEL'));

console.log('\n[12] 영속화 — 파일 저장·복원·TTL 벽시계 연속');
mc._resetCancelVerdictsForTest();
mc._buildUserPushChanges(snap({ [Z]: PRELIM() }), snap({}));
mc._saveCancelVerdicts();
ok('파일 생성 + registeredAt 저장', fs.existsSync(mc._CANCEL_VERDICT_FILE) && typeof JSON.parse(fs.readFileSync(mc._CANCEL_VERDICT_FILE, 'utf8')).parents[Z + '|풍랑'].registeredAt === 'number');
delete require.cache[require.resolve(path.join(__dirname, '..', 'marine_warning_crawler.js'))];
const mc2 = require(path.join(__dirname, '..', 'marine_warning_crawler.js'));
ok('재시작 후 보류 복원', mc2._cvHasPendings());

console.log('\n[14] [2026-07-12 실사고 리허설] 발효예정 기반 데드라인 — 통보문이 3시간 뒤에 나와도 잡는다');
{
    // _mmisEndMs 파싱
    const kst = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h - 9, mi);
    if (mc._mmisEndMs('2026.07.12 11~11시') !== kst(2026, 7, 12, 11)) { fail++; console.log('  ❌ FAIL: 범위형 끝시각 파싱'); } else { pass++; console.log('  ✅ 범위형 끝시각 파싱'); }
    if (mc._mmisEndMs('2026.07.11 18~24시') !== kst(2026, 7, 12, 0)) { fail++; console.log('  ❌ FAIL: 24시→익일 00시'); } else { pass++; console.log('  ✅ 24시→익일 00시'); }
    // [3차 검증 치명] 자정넘김 "18~00시" (warn-sasc/ready 실측 형식) → 익일 00시
    if (mc._mmisEndMs('2026.07.11 18~00시') !== kst(2026, 7, 12, 0)) { fail++; console.log('  ❌ FAIL: 자정넘김 18~00시'); } else { pass++; console.log('  ✅ 자정넘김 18~00시→익일 00시'); }
    if (mc._mmisEndMs('2026.07.11 23~03시') !== kst(2026, 7, 12, 3)) { fail++; console.log('  ❌ FAIL: 자정넘김 23~03시'); } else { pass++; console.log('  ✅ 자정넘김 23~03시→익일 03시'); }
    if (mc._mmisEndMs('2026.07.11 18시~24시') !== kst(2026, 7, 12, 0)) { fail++; console.log('  ❌ FAIL: 시 병기 변형'); } else { pass++; console.log('  ✅ "18시~24시" 병기 변형'); }
    if (mc._mmisEndMs('2026.06.02 23∼23시') !== kst(2026, 6, 2, 23)) { fail++; console.log('  ❌ FAIL: 전각 ∼'); } else { pass++; console.log('  ✅ 전각 ∼ 허용'); }
    if (mc._mmisEndMs('2026.07.11 11:30') !== kst(2026, 7, 11, 11, 30)) { fail++; console.log('  ❌ FAIL: 정확형 파싱'); } else { pass++; console.log('  ✅ 정확형 파싱'); }
    if (mc._mmisEndMs('이상한값') !== null) { fail++; console.log('  ❌ FAIL: 파싱불가 null'); } else { pass++; console.log('  ✅ 파싱불가 null'); }
    // 데드라인: 발효예정이 미래(+3h)면 1시간 넘어도 대기 유지, 발효예정+1h 지나면 만료
    const now = Date.now();
    // ms(KST 순간) → MMIS 범위형 문자열 "YYYY.MM.DD HH~HH시"
    const tmEfOf = (ms) => {
        const k = new Date(ms + 9 * 3600 * 1000);
        const p = (n) => String(n).padStart(2, '0');
        const H = p(k.getUTCHours());
        return `${k.getUTCFullYear()}.${p(k.getUTCMonth() + 1)}.${p(k.getUTCDate())} ${H}~${H}시`;
    };
    const entFut = { registeredAt: now - 2 * 3600 * 1000, block: { tmEf: '' } };   // tmEf 파싱불가 → 기본 1h
    ok('기본: 등록+1h 만료', now >= mc._cvDeadline(entFut));
    // 7/12 실사고 형상: 07시 소멸(등록), 발효예정 11시(+수시간), 취소 통보문 10시 —
    //   등록 2시간 경과 시점에도 데드라인(발효예정+1h) 전이므로 대기 유지 → 10시 문구를 잡는다.
    const entHold = { registeredAt: now - 2 * 3600 * 1000, block: { tmEf: tmEfOf(now + 3 * 3600 * 1000) } };
    ok('발효예정 미래(+3h): 2시간 경과에도 대기 유지', now < mc._cvDeadline(entHold));
    // 상한: 발효예정이 3일 뒤여도 보류는 최대 24h
    const entFar = { registeredAt: now, block: { tmEf: tmEfOf(now + 72 * 3600 * 1000) } };
    ok('상한 24h 캡', mc._cvDeadline(entFar) === now + mc.CANCEL_VERDICT_MAX_HOLD_MS);
}

console.log('\n[13] 스캔 대상 구성 — 관할청 + 108 + 강원 105');
mc2._resetCancelVerdictsForTest();
mc2._registerParentCancelVerdict('강원남부앞바다', { wrnTp: '풍랑', wrnLvl: '예비', tmFc: '', tmEf: '', tmYn: '' });
mc2._registerParentCancelVerdict('제주도동부앞바다', { wrnTp: '풍랑', wrnLvl: '예비', tmFc: '', tmEf: '', tmYn: '' });
const t = mc2._cvScanTargets();
ok('108/105/184 포함', t.offices.has('108') && t.offices.has('105') && t.offices.has('184'));
ok('KST 날짜 형식', t.dates.every(d => /^\d{4}-\d{2}-\d{2}$/.test(d)));

console.log('\n[15] [4차 레드팀 2-A] 종류 교대 — 풍랑·태풍 보류 공존, 덮어쓰기 없음');
{
    mc2._resetCancelVerdictsForTest();
    mc2._setLastCancelScanForTest(null);
    // step1: 풍랑 예비 소멸 → 풍랑 보류
    mc2._buildUserPushChanges(snap({ [Z]: PRELIM() }), snap({}));
    // step2: 태풍 예비 등장 → (풍랑 보류 유지) → step3: 태풍 예비도 소멸 → 태풍 보류 등록
    mc2._buildUserPushChanges(snap({}), snap({ [Z]: PRELIM({ wrnTpNm: '태풍', wrnTp: 'T' }) }));
    mc2._buildUserPushChanges(snap({ [Z]: PRELIM({ wrnTpNm: '태풍', wrnTp: 'T' }) }), snap({}));
    const vv = mc2._loadCancelVerdicts();
    ok('풍랑·태풍 보류 공존(덮어쓰기 없음)', !!vv.parents[Z + '|풍랑'] && !!vv.parents[Z + '|태풍']);
    // 풍랑 취소 문구 → 풍랑만 발사, 태풍 보류 잔존
    mc2._setLastCancelScanForTest(freshScan([relOf('남해동부안쪽먼바다의 풍랑 예비특보는 발표 가능성이 낮아져 해제합니다')]));
    const ch15 = mc2._buildUserPushChanges(snap({}), snap({}));
    ok('풍랑 취소 발사(침묵 살해 해소)', ch15.some(c => c.type === 'UPCOMING_CANCEL' && c.prev.wrnTp === '풍랑'));
    ok('태풍 보류는 잔존', !!mc2._loadCancelVerdicts().parents[Z + '|태풍']);
}

console.log('\n[16] [4차 레드팀 1-A/1-B] 취소 절 한정 — 유지·발효 절의 해역은 오발사 금지');
{
    mc2._resetCancelVerdictsForTest();
    mc2._buildUserPushChanges(snap({ [Z]: PRELIM() }), snap({}));   // Z(남해동부안쪽먼바다) 보류
    mc2._setLastCancelScanForTest(freshScan([relOf('동해남부남쪽바깥먼바다의 풍랑 예비특보는 발표 가능성이 낮아져 해제하나 남해동부안쪽먼바다는 풍랑 예비특보를 유지합니다')]));
    let ch16 = mc2._buildUserPushChanges(snap({}), snap({}));
    ok('유지 절 해역 오발사 없음', !ch16.some(c => c.type === 'UPCOMING_CANCEL') && mc2._cvHasPendings());
    mc2._setLastCancelScanForTest(freshScan([relOf('부산앞바다의 풍랑 예비특보는 발표 가능성이 낮아져 해제하나 남해동부먼바다에는 풍랑주의보가 발효 중입니다')]));
    ch16 = mc2._buildUserPushChanges(snap({}), snap({}));
    ok('발효 안내 절 묶음명 오발사 없음', !ch16.some(c => c.type === 'UPCOMING_CANCEL') && mc2._cvHasPendings());
}

console.log('\n[17] [5차 전수열거 발견1] 예비 소멸 + 타종류 발효 공존 — 보류 등록되어야');
{
    mc2._resetCancelVerdictsForTest();
    mc2._setLastCancelScanForTest(null);
    // 태풍 예비가 있다가, 태풍 예비는 소멸하고 풍랑 주의보만 발효 중인 상태로 전이
    const ACT = { wrnTp: 'V', wrnTpNm: '풍랑', wrnLvl: '2', wrnLvlNm: '주의보', tmFc: '2026.07.12 04:00', tmEf: '2026.07.12 06:00', tmYn: '', clrNtcTm: '2026.07.15 09~12시' };
    const ch17 = mc2._buildUserPushChanges(snap({ [Z]: PRELIM({ wrnTpNm: '태풍', wrnTp: 'T' }) }), snap({ [Z]: ACT }));
    ok('타종류 발효는 승격 아님 → 태풍 보류 등록', !!mc2._loadCancelVerdicts().parents[Z + '|태풍']);
    ok('비취소 출력 보존(UPCOMING_CHANGE no-op 유지)', ch17.some(c => c.type === 'UPCOMING_CHANGE' && !c.curr));
    mc2._setLastCancelScanForTest(freshScan([relOf('남해동부안쪽먼바다의 태풍 예비특보는 발표 가능성이 낮아져 해제합니다')]));
    const ch17b = mc2._buildUserPushChanges(snap({ [Z]: ACT }), snap({ [Z]: ACT }));
    ok('태풍 취소 문구로 발사(침묵 해소)', ch17b.some(c => c.type === 'UPCOMING_CANCEL' && c.prev.wrnTp === '태풍'));
    ok('풍랑 발효는 무영향(발효 change 없음 그대로)', !ch17b.some(c => c.type === 'CURRENT_CHANGE'));
}

cleanup();
console.log(`\n[cancel_verdict_room] ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
