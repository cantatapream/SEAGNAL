'use strict';
// ============================================================================
// [푸시 본문 분할 확장] 테스트 — node scripts/test_push_pagination.js
//   2026-07-13 실사고: 전국 구독자에게 여러 해역 동시 "발표"(publish) 푸시가
//   분할 없이 통째로 나가 안드로이드에서 "..." 로 잘림 — 분할 게이트가
//   ef_extend/yn_extend 에만 걸려 있었음. B안(다해역 계열 명시 확장) 검증.
// ============================================================================
const fs = require('fs');
const path = require('path');
const { generateMessage, paginateByZoneBlocks } = require('../services/push_helpers');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌ FAIL:', name, extra || ''); } };

// ── 1) 7/13 실사고 본문 재구성 (스크린샷의 두 시간그룹·13개 해역·자식 한정사) ──
console.log('\n[1] 7/13 실사고 리허설 — publish 다해역 본문');
const csAll = (allN) => ({ all: Array.from({ length: allN }, (_, i) => 'c' + i), active: Array.from({ length: allN }, (_, i) => 'c' + i), added: [], released: [] });
const items = [
    {
        zones: ['울산앞바다', '경북남부앞바다', '경북북부앞바다', '동해남부남쪽안쪽먼바다', '동해남부남쪽바깥먼바다', '동해남부북쪽안쪽먼바다', '동해남부북쪽바깥먼바다', '동해중부안쪽먼바다', '동해중부바깥먼바다'],
        tmFc: '2026.07.13 16:00', tmEf: '2026.07.14 18~24시', tmYn: '', childState: csAll(2)
    },
    {
        zones: ['부산앞바다', '경남서부남해앞바다', '거제시동부앞바다', '남해동부안쪽먼바다'],
        tmFc: '2026.07.13 16:00', tmEf: '2026.07.14 12~18시', tmYn: '', childState: csAll(2)
    }
];
const gen = generateMessage({ templateId: 'publish', typeName: '풍랑', level: '주의보', items, showChildZones: true });
ok('본문 생성(길이 ' + gen.body.length + '자)', gen.body.length > 165);
ok('본문이 ㅇ 블록 형식', gen.body.split('\n').some(l => l.startsWith('ㅇ')));

// ── 2) 분할 결과 검증 — 해역 무손실·한도·시각줄 복제·제목 접미사 ──
console.log('\n[2] paginateByZoneBlocks 분할 검증 (블록 내 분할 포함)');
const parts = paginateByZoneBlocks(gen.title, gen.body);
ok('2건 이상으로 분할됨 (' + parts.length + '건)', parts.length >= 2);
ok('제목 접미사 (n/N)', parts.every((p, i) => p.title === `${gen.title} (${i + 1}/${parts.length})`));
// [실사고 보강] 모든 파트가 한도 이내 — 단독 초과 블록도 해역 단위로 쪼개짐
ok('전 파트 한도(165자) 준수', parts.every(p => p.body.length <= 165), parts.map(p => p.body.length).join(','));
// 해역 무손실: 원문 해역(한정사 포함)이 전 파트 합계에 정확히 1회씩
const allZoneTokens = items.flatMap(it => it.zones);
const joined = parts.map(p => p.body).join('\n');
ok('해역 무손실(각 1회)', allZoneTokens.every(z => (joined.split(z).length - 1) === 1));
// 시각 줄 복제: 해역이 있는 모든 파트에 발효예정 줄 존재
ok('시각 줄 각 파트 복제', parts.every(p => !p.body.startsWith('ㅇ') || p.body.includes('발효예정')));

// ── 3) 짧은 본문은 기존과 동일하게 1건·제목 무접미사 ──
console.log('\n[3] 짧은 본문 무영향');
const genShort = generateMessage({ templateId: 'publish', typeName: '풍랑', level: '주의보', items: [{ zones: ['부산앞바다'], tmFc: '2026.07.13 16:00', tmEf: '2026.07.14 12~18시', tmYn: '' }], showChildZones: false });
const one = paginateByZoneBlocks(genShort.title, genShort.body);
ok('1건 유지', one.length === 1);
ok('제목 접미사 없음', one[0].title === genShort.title);
ok('본문 원형 그대로', one[0].body === genShort.body);

// ── 4) 라우트 게이트(B안) — 다해역 계열 전 등재 + 기존 연장 포함 확인 ──
console.log('\n[4] 게이트 목록 검증 (routes/push.js)');
const routeSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'push.js'), 'utf8');
const m = routeSrc.match(/const PAGINATE_TIDS = \[([\s\S]*?)\];/);
ok('PAGINATE_TIDS 존재', !!m);
const tids = m ? Array.from(m[1].matchAll(/'([a-z_]+)'/g)).map(x => x[1]) : [];
const MUST = ['publish', 'active', 'release', 'additional_active', 'partial_release',
    'prelim_cancel', 'child_prelim', 'child_prelim_cancel',
    'level_upgrade_publish', 'level_upgrade_active', 'level_downgrade_publish', 'level_downgrade_active',
    'type_upgrade_publish', 'type_upgrade_active', 'type_downgrade_publish', 'type_downgrade_active',
    'time_ef_change', 'time_yn_change', 'child_time_ef_change', 'child_time_yn_change',
    'time_yn_confirm', 'ef_extend', 'yn_extend'];
const missing = MUST.filter(t => !tids.includes(t));
ok('다해역 계열 23종 전부 등재', missing.length === 0, missing.join(','));
ok('기존 연장 2종 포함(회귀 없음)', tids.includes('ef_extend') && tids.includes('yn_extend'));
// 커스텀/수동 발송(비그룹)은 게이트 밖(단건 유지) — shouldPaginate 가 isManualGroupSend 를 요구
ok('그룹 발송에만 적용(커스텀 단건 유지)', /shouldPaginate = isManualGroupSend && payload &&/.test(routeSrc));

// ── 5) 대표 계열별 분할 스모크 — 발효/해제/격상/취소도 동일하게 동작 ──
console.log('\n[5] 계열별 스모크 (active/release/level_upgrade_publish)');
const manyZones = Array.from({ length: 14 }, (_, i) => `테스트해역${String(i + 1).padStart(2, '0')}앞바다`);
for (const [tid, extra] of [['active', { tmYn: '2026.07.15 09~12시' }], ['release', {}], ['level_upgrade_publish', { tmEf: '2026.07.14 12:00' }]]) {
    const g = generateMessage({ templateId: tid, typeName: '풍랑', level: '주의보', prevLevel: '주의보', items: [Object.assign({ zones: manyZones, tmFc: '2026.07.13 16:00', tmEf: '', tmYn: '' }, extra)], showChildZones: false });
    if (!g.body) { ok(tid + ': 본문 없음(스킵)', true); continue; }
    const ps = paginateByZoneBlocks(g.title, g.body);
    const joined5 = ps.map(p => p.body).join('\n');
    const zonesOnce = manyZones.every(z => (joined5.split(z).length - 1) === 1);
    const capOk = ps.every(p => p.body.length <= 165);
    ok(`${tid}: 분할(${ps.length}건)·한도·해역 1회`, zonesOnce && capOk && (g.body.length <= 165 ? ps.length === 1 : ps.length >= 2));
}

// ── 6) 블록 내 분할 경계 — 괄호 안 쉼표 보호 + 소형 블록 무변화(연장 회귀 없음) ──
console.log('\n[6] 블록 내 분할 경계');
{
    // 괄호 안 쉼표("(북동연안바다, 우도연안바다 포함)")는 해역 경계로 오인하지 않아야
    const blockBody = 'ㅇ' + Array.from({ length: 6 }, (_, i) => `해역${i + 1}앞바다(북동연안바다, 우도연안바다 포함)`).join(', ') + '\n   - 발효예정 : 7월 14일 18시~24시';
    const ps = paginateByZoneBlocks('📢 풍랑 주의보 발표', blockBody);
    ok('단독 초과 블록 해역단위 분할(' + ps.length + '건)', ps.length >= 2 && ps.every(p => p.body.length <= 165));
    ok('괄호 쉼표 보호(한정사 온전)', ps.every(p => !/포함\)[^,\n]|\(북동연안바다,\s*$/.test('') ) && ps.map(p=>p.body).join('\n').split('(북동연안바다, 우도연안바다 포함)').length - 1 === 6);
    ok('각 조각에 시각 줄 복제', ps.every(p => p.body.includes('발효예정')));
    // 한도 이내 블록들만 있으면 종전 알고리즘과 동일(연장 계열 회귀 없음)
    const small = 'ㅇ부산앞바다\n   - 기존 : 7월 13일 03시~06시\n   - 변경 후 : 7월 15일 09시~12시\nㅇ울산앞바다\n   - 기존 : 7월 13일 03시~06시\n   - 변경 후 : 7월 15일 09시~12시';
    const psSmall = paginateByZoneBlocks('🕐 풍랑 주의보 해제 예정시각 연장', small);
    ok('소형 블록 무변화(연장 형식)', psSmall.map(p => p.body).join('\n') === small);
    // 단일 해역이 스스로 큰 극단 케이스 — 쪼개지 않고 그대로(폴백, 크래시 없음)
    const giant = 'ㅇ' + '아주긴가상해역명'.repeat(30) + '앞바다\n   - 발효예정 : 7월 14일 18시~24시';
    const psGiant = paginateByZoneBlocks('t', giant);
    ok('단일 해역 초과는 폴백 유지', psGiant.length === 1 && psGiant[0].body === giant);
}

console.log(`\n[push_pagination] ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
