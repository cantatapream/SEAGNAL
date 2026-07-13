/**
 * test_typhoon_runtime.js — 위치기반 태풍 반경 알림: 단말 런타임 검증
 * 실행: node local_server/scripts/test_typhoon_runtime.js
 *
 * framesOf(키 매핑 + lng→lon), decideTyphoonAlerts(storm 우선/strong 폴백/태풍별 복수/반경밖),
 * handleTyphoonWake(subTyphoon 게이트 + 위치없음 + 태풍별 별도 schedule).
 * 전역(root)에 TyphoonRadius/TyphoonMessage/LocalNotifications 스파이를 주입.
 */
'use strict';

// 런타임이 require 로 typhoon_radius/typhoon_message 를 찾도록 전역에 노출(브라우저 셸 대신).
global.TyphoonRadius = require('../services/typhoon_radius.js');
global.TyphoonMessage = require('../services/typhoon_message.js');

const RT = require('../js/typhoon/location_alert_typhoon_runtime.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} ${extra || ''}`); }
}

// LOC 와 동일 좌표 프레임은 거리 0 → 어떤 반경이든 진입.
const LOC = { lat: 30.0, lon: 130.0 };

function typhoon(seq, name, frameOverride) {
    const cur = Object.assign({
        time: '202606261200', lat: 30.0, lon: 130.0,
        radStrong: 300, radStrongS: 300, radStrongD: null,
        radStorm: 100, radStormS: 100, radStormD: null,
    }, frameOverride || {});
    return { seq, name, nameEn: name + 'EN', latestTmFc: '202606261059',
        bulletins: [{ code: '1_x_' + seq + '_1', isLatest: true, current: cur, forecast: [] }] };
}

// ── [1] framesOf 매핑 ───────────────────────────────────────────────────────
console.log('[1] framesOf 키 매핑');
const fr = RT.framesOf(typhoon('6', '장미'));
check('프레임 1개(current)', fr.length === 1, JSON.stringify(fr));
check('time/lat/lon 매핑', fr[0].time === '202606261200' && fr[0].lat === 30.0 && fr[0].lon === 130.0);
check('radStrong/radStorm 매핑', fr[0].radStrong === 300 && fr[0].radStorm === 100);

// lng→lon 폴백: lon 누락, lng 보유.
const tLng = { seq: '8', name: '잎', latestTmFc: '202606261059',
    bulletins: [{ isLatest: true, current: { time: '202606261200', lat: 31.0, lng: 131.0, radStrong: 50 }, forecast: [] }] };
const frLng = RT.framesOf(tLng);
check('lng→lon 폴백', frLng.length === 1 && frLng[0].lon === 131.0, JSON.stringify(frLng));

// current + forecast 모두 모음.
const tMulti = { seq: '9', name: '여러', latestTmFc: '202606261059', bulletins: [{ isLatest: true,
    current: { time: '202606261200', lat: 30, lon: 130, radStrong: 100 },
    forecast: [{ time: '202606261800', lat: 31, lon: 131, radStrong: 100 }, { time: 'x', lat: null, lon: null }] }] };
check('current+forecast 수집(좌표없는 건 제외)', RT.framesOf(tMulti).length === 2);

check('빈/이상 입력 → []', RT.framesOf(null).length === 0 && RT.framesOf({}).length === 0 && RT.framesOf({ bulletins: [] }).length === 0);

// ── [2] decideTyphoonAlerts ────────────────────────────────────────────────
console.log('\n[2] decideTyphoonAlerts');
// 폭풍 우선: storm 반경(100) 안 → which='storm'.
let res = RT.decideTyphoonAlerts(LOC, [typhoon('6', '장미')]);
check('storm 우선 채택', res.length === 1 && res[0].which === 'storm', JSON.stringify(res));
check('snap 호수/이름', res[0].snap.seq === '6' && res[0].snap.name === '장미');

// strong 폴백: storm 반경 없음(작게/없음) → strong 만 진입.
const strongOnly = typhoon('7', '쁘라', { radStorm: null, radStormS: null });
res = RT.decideTyphoonAlerts(LOC, [strongOnly]);
check('storm 없으면 strong 폴백', res.length === 1 && res[0].which === 'strong', JSON.stringify(res));

// 반경 밖: 먼 위치 + 작은 반경 → skip.
const farTyp = typhoon('8', '먼', { lat: 10, lon: 110, radStrong: 10, radStorm: 5 });
res = RT.decideTyphoonAlerts(LOC, [farTyp]);
check('반경 밖 → 결과 없음', res.length === 0, JSON.stringify(res));

// 태풍별 복수: 두 태풍 모두 진입 → 결과 2건(earliest-only 아님).
res = RT.decideTyphoonAlerts(LOC, [typhoon('6', '장미'), typhoon('7', '쁘라')]);
check('진입 태풍 각각 1건(복수)', res.length === 2 && res[0].seq === '6' && res[1].seq === '7', JSON.stringify(res.map(r => r.seq)));

// 일부만 진입.
res = RT.decideTyphoonAlerts(LOC, [typhoon('6', '장미'), farTyp]);
check('진입한 태풍만 반환', res.length === 1 && res[0].seq === '6');

check('이상 입력 방어', RT.decideTyphoonAlerts(null, [typhoon('6', '장미')]).length === 0 && RT.decideTyphoonAlerts(LOC, null).length === 0);

// notifIdForSeq: 안정적 + 태풍별 상이.
check('notifIdForSeq 안정적', RT.notifIdForSeq('6') === RT.notifIdForSeq('6') && RT.notifIdForSeq('6') !== RT.notifIdForSeq('7'));
check('notifIdForSeq 양의 32bit', RT.notifIdForSeq('6') > 0 && RT.notifIdForSeq('6') < 2147483647);

// ── [3] handleTyphoonWake (스파이 주입) ─────────────────────────────────────
console.log('\n[3] handleTyphoonWake (스파이)');
function makeRoot(opts) {
    const scheduled = [];
    const root = {
        scheduled,
        TyphoonRadius: global.TyphoonRadius,
        TyphoonMessage: global.TyphoonMessage,
        LocationAlertSettings: opts.settings,   // { get(){...} } 또는 undefined
        LocationAlertBackground: { getFreshPosition: async () => opts.pos },
        fetch: async () => ({ json: async () => opts.apiResp }),
        Capacitor: { Plugins: { LocalNotifications: { schedule: async (s) => { scheduled.push(s); } } } },
    };
    return root;
}

// 런타임은 클로저 root(= window/globalThis) 를 본다. handleTyphoonWake 는 root 전역을 직접 읽으므로
// 테스트는 전역에 스파이를 세팅 후 호출하고 정리한다.
async function runWake(opts) {
    const r = makeRoot(opts);
    const saved = {};
    ['LocationAlertSettings', 'LocationAlertBackground', 'fetch', 'Capacitor', 'TyphoonRadius', 'TyphoonMessage'].forEach(k => { saved[k] = global[k]; global[k] = r[k]; });
    try { await RT.handleTyphoonWake({ type: 'typhoon_radius_wake', sig: '20260626-morning' }); }
    finally { Object.keys(saved).forEach(k => { if (saved[k] === undefined) delete global[k]; else global[k] = saved[k]; }); }
    return r.scheduled;
}

(async () => {
    const apiResp = { year: 2026, typhoons: [typhoon('6', '장미'), typhoon('7', '쁘라')] };

    // 정상: subTyphoon 미설정(fail-open) + 위치 있음 + 두 태풍 진입 → schedule 2회(태풍별).
    let sched = await runWake({ settings: undefined, pos: { lat: 30.0, lng: 130.0 }, apiResp });
    check('정상: 태풍별 별도 schedule 2회', sched.length === 2, 'len=' + sched.length);
    if (sched.length === 2) {
        const ids = sched.map(s => s.notifications[0].id);
        check('태풍별 고유 알림 id', ids[0] !== ids[1]);
        check('extra.url 포함(buildDemoUrl)', /demoTphn=1/.test(sched[0].notifications[0].extra.url) && /dtGuide=1/.test(sched[0].notifications[0].extra.url), sched[0].notifications[0].extra.url);
        check('제목에 긴급경보', /긴급경보/.test(sched[0].notifications[0].title), sched[0].notifications[0].title);
    }

    // subTyphoon === false → 표출 skip.
    sched = await runWake({ settings: { get: () => ({ subTyphoon: false }) }, pos: { lat: 30.0, lng: 130.0 }, apiResp });
    check('subTyphoon OFF → 미표출', sched.length === 0);

    // subTyphoon === true → 표출.
    sched = await runWake({ settings: { get: () => ({ subTyphoon: true }) }, pos: { lat: 30.0, lng: 130.0 }, apiResp });
    check('subTyphoon ON → 표출', sched.length === 2);

    // 위치 없음 → 미표출.
    sched = await runWake({ settings: undefined, pos: null, apiResp });
    check('위치 없음 → 미표출', sched.length === 0);

    // 활성 태풍 없음 → 미표출.
    sched = await runWake({ settings: undefined, pos: { lat: 30.0, lng: 130.0 }, apiResp: { year: 2026, typhoons: [] } });
    check('활성 태풍 없음 → 미표출', sched.length === 0);

    // 반경 밖(먼 위치) → 미표출.
    sched = await runWake({ settings: undefined, pos: { lat: 0.0, lng: 0.0 }, apiResp });
    check('반경 밖 → 미표출', sched.length === 0);

    console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
    process.exit(fail ? 1 : 0);
})();
