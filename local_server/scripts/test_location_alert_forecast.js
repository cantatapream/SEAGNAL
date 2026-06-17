/**
 * test_location_alert_forecast.js — location_alert_forecast.worstForZone 검증
 * 실행: node local_server/scripts/test_location_alert_forecast.js
 * 실제 데이터 파일 없이 mock period 배열을 주입(deps)하여 최악 선정 규칙을 검증.
 */
'use strict';
const F = require('../services/location_alert_forecast');

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} ${extra != null ? JSON.stringify(extra) : ''}`); }
}

// mock 앞바다 로더 헬퍼
function coastalOf(zone, periods) { return () => ({ [zone]: { periods } }); }

console.log('[1] 날짜 간 최악 — 파고 max 큰 날 선택');
{
    const periods = [
        { date: '20260620', period: 'am', wind: '남동 / 4~8', weather: '흐림', waveHeight: '0.5~1.0' },
        { date: '20260620', period: 'pm', wind: '남동 / 4~12', weather: '흐림', waveHeight: '1.0~2.0' },
        { date: '20260621', period: 'am', wind: '북서 / 5~9', weather: '흐림', waveHeight: '0.5~1.5' },
    ];
    const r = F.worstForZone('제주도북부앞바다', { loadCoastal: coastalOf('제주도북부앞바다', periods), midTerm: null });
    check('20일 선택(파고 2.0 > 1.5)', r && r.day === '20', r);
    check('summary = 남동풍 4~12m/s, 파고 1.0~2.0m', r && r.summary === '남동풍 4~12m/s, 파고 1.0~2.0m', r);
}

console.log('\n[2] am/pm 중 나쁜 쪽 선택(같은 날)');
{
    const periods = [
        { date: '20260620', period: 'am', wind: '남동 / 4~8', weather: '흐림', waveHeight: '2.0~3.0' },
        { date: '20260620', period: 'pm', wind: '북서 / 10~15', weather: '흐림', waveHeight: '1.0~1.5' },
    ];
    const r = F.worstForZone('제주도북부앞바다', { loadCoastal: coastalOf('제주도북부앞바다', periods), midTerm: null });
    check('am 선택(파고 3.0 > 1.5)', r && /파고 2.0~3.0m/.test(r.summary), r);
    check('풍향 = 첫 토큰 "남동"', r && /^남동풍/.test(r.summary), r);
}

console.log('\n[3] 파고 동률 → 풍속 max 큰 쪽');
{
    const periods = [
        { date: '20260620', period: 'am', wind: '동 / 4~8', weather: '흐림', waveHeight: '2.0~3.0' },
        { date: '20260620', period: 'pm', wind: '서 / 6~14', weather: '흐림', waveHeight: '2.0~3.0' },
    ];
    const r = F.worstForZone('제주도북부앞바다', { loadCoastal: coastalOf('제주도북부앞바다', periods), midTerm: null });
    check('풍속 max 14 > 8 → 서풍 6~14', r && r.summary === '서풍 6~14m/s, 파고 2.0~3.0m', r);
}

console.log('\n[4] 풍향 첫 토큰 — "동~남동"→"동", 단일 "남동"→"남동"');
{
    const c1 = F._internals.parseWind('동~남동 / 4~8');
    check('"동~남동" → dir=동', c1 && c1.dir === '동', c1);
    const c2 = F._internals.parseWind('남동 / 4~8');
    check('"남동" → dir=남동', c2 && c2.dir === '남동', c2);
    const c3 = F._internals.parseWind('-');
    check('"-" → null', c3 === null, c3);
}

console.log('\n[5] 먼바다 → loadMarine 사용');
{
    const periods = [{ date: '20260622', period: 'am', wind: '북 / 8~12', weather: '흐림', waveHeight: '1.5~2.0' }];
    const r = F.worstForZone('제주도남쪽먼바다', {
        loadCoastal: () => ({}), // 앞바다엔 없음
        loadMarine: () => ({ '제주도남쪽먼바다': { periods } }),
        midTerm: null,
    });
    check('먼바다 구역은 marine 로더로 조회', r && r.day === '22' && /북풍 8~12m\/s/.test(r.summary), r);
}

console.log('\n[6] 중기 — 단기보다 파고 엄격히 크면 사용(파고만)');
{
    // 단기 최악 파고 max = 2.0. 중기에 3.0 → 중기 사용(풍향/풍속 없음).
    const shortPeriods = [
        { date: '20260620', period: 'am', wind: '남동 / 4~12', weather: '흐림', waveHeight: '1.0~2.0' },
    ];
    // 제주도북부앞바다 regId=12B10000. tmFc=20260617... base=2026-06-17. d=7 → 6/24.
    const midItem = {};
    // d=7 오전에 큰 파고
    midItem['wh7AAm'] = '2.0'; midItem['wh7BAm'] = '3.0';
    const midTerm = { tmFc: '202606170600', data: { '12B10000': midItem } };
    const r = F.worstForZone('제주도북부앞바다', {
        loadCoastal: coastalOf('제주도북부앞바다', shortPeriods),
        midTerm,
    });
    check('중기 파고 3.0 > 단기 2.0 → 중기 사용', r && /파고 2.0~3.0m/.test(r.summary), r);
    check('중기 사용 시 풍향/풍속 없음(파고만)', r && !/풍/.test(r.summary) && !/m\/s/.test(r.summary), r);
    check('중기 날짜 = 24일(base 6/17 + 7일)', r && r.day === '24', r);
}

console.log('\n[7] 중기가 단기보다 크지 않으면 단기 유지');
{
    const shortPeriods = [
        { date: '20260620', period: 'am', wind: '남동 / 4~12', weather: '흐림', waveHeight: '2.0~3.0' },
    ];
    const midItem = { 'wh7AAm': '1.0', 'wh7BAm': '2.0' }; // 중기 max 2.0 ≤ 단기 3.0
    const midTerm = { tmFc: '202606170600', data: { '12B10000': midItem } };
    const r = F.worstForZone('제주도북부앞바다', {
        loadCoastal: coastalOf('제주도북부앞바다', shortPeriods),
        midTerm,
    });
    check('중기 ≤ 단기 → 단기(풍향 포함) 유지', r && /남동풍 4~12m\/s/.test(r.summary), r);
}

console.log('\n[8] 방어성 — 데이터 없음/형식오류 → null');
{
    check('빈 로더 → null', F.worstForZone('제주도북부앞바다', { loadCoastal: () => ({}), midTerm: null }) === null);
    check('zoneName 비정상 → null', F.worstForZone(null, {}) === null);
    check('periods 비배열 → null', F.worstForZone('Z', { loadCoastal: () => ({ Z: { periods: 'x' } }), midTerm: null }) === null);
    // 던지는 로더도 흡수
    check('throw 로더 흡수 → null', F.worstForZone('Z', { loadCoastal: () => { throw new Error('boom'); }, midTerm: null }) === null);
}

console.log('\n[9] 중기 전용(단기 없음) — 파고만');
{
    const midItem = { 'wh7AAm': '2.0', 'wh7BAm': '3.0' };
    const midTerm = { tmFc: '202606170600', data: { '12B10000': midItem } };
    const r = F.worstForZone('제주도북부앞바다', { loadCoastal: () => ({}), midTerm });
    check('단기 없고 중기만 → 중기(파고) 사용', r && /파고 2.0~3.0m/.test(r.summary) && !/풍/.test(r.summary), r);
}

console.log('\n[10] 단기 파고만(풍향 없음) → 파고형 한 줄');
{
    // wind='-' (파싱 불가) + 파고만 있는 단기 → "파고 {파고}m" (풍향/풍속 생략)
    const periods = [{ date: '20260624', period: 'am', wind: '-', weather: '흐림', waveHeight: '2.0~3.0' }];
    const r = F.worstForZone('제주도북부앞바다', { loadCoastal: coastalOf('제주도북부앞바다', periods), midTerm: null });
    check('풍향 없으면 파고 only 표시', r && r.day === '24' && r.summary === '파고 2.0~3.0m', r);
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
