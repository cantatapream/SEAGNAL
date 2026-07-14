/**
 * test_location_alert_fresh_fix.js (구 test_location_alert_start_race.js)
 * 실행: node local_server/scripts/test_location_alert_fresh_fix.js
 *
 * [이벤트 기반 전환 — 2026-06-26]
 *   상시 백그라운드 워처(@capacitor-community/background-geolocation)를 제거하고, wake 시점에
 *   getFreshPosition()으로 그 순간 위치 1회를 수집하도록 바꿨다. 따라서 기존 watcher 경쟁
 *   가드(addWatcher/WATCHER_KEY/_laStarting) 테스트는 더 이상 유효하지 않아 이 파일을
 *   getFreshPosition()/start()/stop() 의 이벤트 기반 동작 검증으로 교체한다.
 *
 *   검증:
 *     1) Geolocation 존재 → getFreshPosition()이 활성 픽스를 받아 저장(savePosition)하고 반환.
 *     2) Geolocation 부재 → 마지막 저장 위치로 폴백.
 *     3) 저장 위치도 없으면 null.
 *     4) start()는 워처를 만들지 않고 fresh fix 1회만 수행 → true.
 *     5) stop()은 저장 위치를 삭제(clearPosition).
 *     6) BackgroundGeolocation(addWatcher)을 절대 호출하지 않는다(상시 수집 제거 확인).
 */
'use strict';

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} ${extra || ''}`); }
}

// ── 네이티브 환경 mock ───────────────────────────────────────────────────────
let addWatcherCalls = 0;
global.window = undefined;
global.localStorage = {
    _d: {}, getItem(k) { return this._d[k] || null; },
    setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; },
};

function makeCapacitor(withGeo) {
    const plugins = {
        // 상시 워처 플러그인은 (있더라도) 절대 호출되면 안 됨 — 호출 시 카운트해서 실패 처리.
        BackgroundGeolocation: {
            addWatcher: async () => { addWatcherCalls++; return 'w'; },
            removeWatcher: async () => { },
        },
    };
    if (withGeo) {
        plugins.Geolocation = {
            getCurrentPosition: async (opts) => {
                // 이벤트 기반 옵션 확인용으로 마지막 호출 인자 보관.
                makeCapacitor._lastOpts = opts;
                return { coords: { latitude: 35.1, longitude: 129.2, accuracy: 12 } };
            },
        };
    }
    return { isNativePlatform: () => true, Plugins: plugins };
}

(async () => {
    // ── [1] Geolocation 존재 → 활성 fresh fix + 저장 ──────────────────────────
    global.Capacitor = makeCapacitor(true);
    delete require.cache[require.resolve('../js/location-alert/location_alert_background.js')];
    let BG = require('../js/location-alert/location_alert_background.js');
    console.log('[1] Geolocation 존재 → fresh fix 수집·저장');
    const fresh = await BG.getFreshPosition();
    check('fresh 반환됨', !!fresh, JSON.stringify(fresh));
    check('lat=35.1', fresh && fresh.lat === 35.1, fresh && fresh.lat);
    check('lng=129.2', fresh && fresh.lng === 129.2, fresh && fresh.lng);
    check('acc=12', fresh && fresh.acc === 12, fresh && fresh.acc);
    check("src='gps'", fresh && fresh.src === 'gps', fresh && fresh.src);
    check('at 스탬프됨', !!(fresh && fresh.at), fresh && fresh.at);
    check('저장(getPosition)도 동일 lat', BG.getPosition() && BG.getPosition().lat === 35.1);
    check('저전력 옵션(enableHighAccuracy:false)', makeCapacitor._lastOpts && makeCapacitor._lastOpts.enableHighAccuracy === false);
    check('timeout 8000', makeCapacitor._lastOpts && makeCapacitor._lastOpts.timeout === 8000);

    // ── [2] Geolocation 부재 → 마지막 저장 위치 폴백 ──────────────────────────
    console.log('\n[2] Geolocation 부재 → 저장 위치 폴백');
    // 저장 위치는 [1]에서 남아있음(35.1,129.2). Geolocation 만 제거.
    global.Capacitor = makeCapacitor(false);
    const fb = await BG.getFreshPosition();
    check('폴백으로 저장 위치 반환', fb && fb.lat === 35.1, JSON.stringify(fb));

    // ── [3] 저장 위치도 없음 → null ──────────────────────────────────────────
    console.log('\n[3] Geolocation 부재 + 저장 없음 → null');
    BG.clearPosition();
    const none = await BG.getFreshPosition();
    check('null 반환', none === null, JSON.stringify(none));

    // ── [4] start()는 워처 없이 fresh fix 1회 → true ─────────────────────────
    console.log('\n[4] start(): 워처 없이 fresh fix 1회');
    global.Capacitor = makeCapacitor(true);
    addWatcherCalls = 0;
    const started = await BG.start();
    check('start() true', started === true);
    check('start() 후 저장 위치 갱신됨', BG.getPosition() && BG.getPosition().lat === 35.1);

    // ── [4b] 동시 start() 2회가 겹쳐도 안전(throw 없음, 워처 누수 없음) ──────────
    //   상시 watcher 가 사라져 "워처 2개 생성/유령 워처" 경쟁 자체가 없음을 회귀 검증.
    console.log('\n[4b] 동시 start() 2회 → 안전(throw 없음) + 워처 미생성');
    global.Capacitor = makeCapacitor(true);
    addWatcherCalls = 0;
    const both = await Promise.all([BG.start(), BG.start()]);
    check('동시 start() 모두 true', both[0] === true && both[1] === true);
    check('동시 start() 후에도 addWatcher 0회', addWatcherCalls === 0, `(${addWatcherCalls})`);

    // ── [5] stop()은 저장 위치 삭제 ──────────────────────────────────────────
    console.log('\n[5] stop(): 저장 위치 삭제');
    await BG.stop();
    check('stop() 후 저장 위치 null', BG.getPosition() === null);

    // ── [6] 상시 수집 제거 확인: addWatcher 호출 0 ───────────────────────────
    console.log('\n[6] 상시 수집 제거 — addWatcher 미호출');
    check('addWatcher 0회(상시 워처 없음)', addWatcherCalls === 0, `(${addWatcherCalls})`);
    check('isRunning/WATCHER api 제거됨(상시 상태 없음)', typeof BG.isRunning === 'undefined');

    console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
    process.exit(fail ? 1 : 0);
})();
