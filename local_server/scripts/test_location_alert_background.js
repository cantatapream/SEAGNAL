/**
 * test_location_alert_background.js — 백그라운드 위치 모듈의 순수 헬퍼 검증
 * 실행: node local_server/scripts/test_location_alert_background.js
 * 대상: isStale(rec, nowMs, maxMs) — 낡음 가드 판정의 경계/방어성.
 *   (start/stop 등 네이티브 의존 경로는 단위 테스트 대상이 아님 — 순수 함수만 검증.)
 */
'use strict';

const BG = require('../js/location-alert/location_alert_background.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} ${extra || ''}`); }
}

check('STALE_MAX_MS = 12h', BG.STALE_MAX_MS === 12 * 60 * 60 * 1000, String(BG.STALE_MAX_MS));
check('isStale export 됨', typeof BG.isStale === 'function');

const MAX = BG.STALE_MAX_MS;
const now = Date.parse('2026-06-25T12:00:00.000Z');

console.log('\n[1] 방금 저장 → 낡지 않음(false)');
const fresh = { at: new Date(now - 5 * 60 * 1000).toISOString() }; // 5분 전
check('fresh → false', BG.isStale(fresh, now, MAX) === false);

console.log('\n[2] 13시간 전 → 낡음(true)');
const old13 = { at: new Date(now - 13 * 60 * 60 * 1000).toISOString() };
check('13h-old → true', BG.isStale(old13, now, MAX) === true);

console.log('\n[3] 정확히 12시간 경계 직전/직후');
check('12h 직전(11h59m) → false', BG.isStale({ at: new Date(now - (12 * 60 * 60 * 1000 - 1000)).toISOString() }, now, MAX) === false);
check('12h 초과(12h1s) → true', BG.isStale({ at: new Date(now - (12 * 60 * 60 * 1000 + 1000)).toISOString() }, now, MAX) === true);

console.log('\n[4] at 누락 → false(낡지 않음으로 취급)');
check('rec 없음 → false', BG.isStale(null, now, MAX) === false);
check('at 없음 → false', BG.isStale({ lat: 35, lng: 129 }, now, MAX) === false);

console.log('\n[5] at 파싱 불가 → false');
check('unparseable at → false', BG.isStale({ at: 'not-a-date' }, now, MAX) === false);
check('빈 문자열 at → false', BG.isStale({ at: '' }, now, MAX) === false);

console.log('\n[6] 밀리초 단위 경계(>maxMs 엄격) — 12h+1ms → true, 12h-1ms → false');
check('12h+1ms → true', BG.isStale({ at: new Date(now - (MAX + 1)).toISOString() }, now, MAX) === true);
check('12h-1ms → false', BG.isStale({ at: new Date(now - (MAX - 1)).toISOString() }, now, MAX) === false);

// ── getFreshPosition: 이벤트 기반 fresh-fix 폴백/획득 검증 ──────────────────────
//   Capacitor/localStorage 전역을 주입해 두 경로를 검증한다(상시 watcher 없음).
check('getFreshPosition export 됨', typeof BG.getFreshPosition === 'function');

function fakeLocalStorage() {
    const d = {};
    return {
        getItem: (k) => (k in d ? d[k] : null),
        setItem: (k, v) => { d[k] = String(v); },
        removeItem: (k) => { delete d[k]; },
    };
}

(async () => {
    console.log('\n[7] Geolocation 없음 → 저장 위치로 폴백');
    const stored = { lat: 34.5, lng: 128.3, acc: 50, at: new Date(now).toISOString(), src: 'gps' };
    global.localStorage = fakeLocalStorage();
    global.localStorage.setItem(BG.POS_KEY, JSON.stringify(stored));
    // Geolocation 플러그인 부재(absent).
    global.Capacitor = { isNativePlatform: () => true, Plugins: {} };
    const fb = await BG.getFreshPosition();
    check('폴백: 저장 위치 반환', fb && fb.lat === 34.5 && fb.lng === 128.3, JSON.stringify(fb));

    console.log('\n[7b] Geolocation 없음 + 저장 위치도 없음 → null');
    global.localStorage = fakeLocalStorage();
    global.Capacitor = { isNativePlatform: () => true, Plugins: {} };
    const nul = await BG.getFreshPosition();
    check('폴백 대상 없음 → null', nul === null, JSON.stringify(nul));

    console.log('\n[8] Geolocation 있음 → fresh 위치 획득 + POS_KEY 저장');
    global.localStorage = fakeLocalStorage();
    let called = 0;
    global.Capacitor = {
        isNativePlatform: () => true,
        Plugins: {
            Geolocation: {
                getCurrentPosition: async (opts) => {
                    called++;
                    // 옵션 계약 확인(저전력, 8초 타임아웃).
                    check('getCurrentPosition opts.timeout=8000', opts && opts.timeout === 8000, JSON.stringify(opts));
                    check('getCurrentPosition enableHighAccuracy=false', opts && opts.enableHighAccuracy === false);
                    return { coords: { latitude: 36.7, longitude: 130.1, accuracy: 8 } };
                },
            },
        },
    };
    const fresh = await BG.getFreshPosition();
    check('Geolocation 1회 호출', called === 1, `(${called})`);
    check('fresh 좌표 반환', fresh && fresh.lat === 36.7 && fresh.lng === 130.1, JSON.stringify(fresh));
    check('fresh src=gps', fresh && fresh.src === 'gps');
    const persisted = JSON.parse(global.localStorage.getItem(BG.POS_KEY));
    check('POS_KEY 저장됨(최신 1건 갱신)', persisted && persisted.lat === 36.7 && persisted.lng === 130.1, JSON.stringify(persisted));

    console.log('\n[9] Geolocation 예외 → 저장 위치로 폴백');
    global.localStorage = fakeLocalStorage();
    global.localStorage.setItem(BG.POS_KEY, JSON.stringify(stored));
    global.Capacitor = {
        isNativePlatform: () => true,
        Plugins: { Geolocation: { getCurrentPosition: async () => { throw new Error('timeout'); } } },
    };
    const afterErr = await BG.getFreshPosition();
    check('예외 시 저장 위치 폴백', afterErr && afterErr.lat === 34.5, JSON.stringify(afterErr));

    console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
    process.exit(fail ? 1 : 0);
})();
