/**
 * test_location_alert_start_race.js — 위치 수집기 start()/stop() 경쟁 가드 회귀 테스트
 * 실행: node local_server/scripts/test_location_alert_start_race.js
 *
 * 배경(교차검토 HIGH): WATCHER_KEY 할당이 await(addWatcher) 이후라, 동기 가드만으로는
 *   두 start()가 겹치면 워처가 2개 생성되고 stop() 시 1개가 유령으로 남았다.
 *   (자동 재가동 ensureStarted 가 토글과 겹치는 경우.) 진행 플래그(_laStarting)로 차단.
 */
'use strict';

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} ${extra || ''}`); }
}

// ── 네이티브 환경 + 비동기 addWatcher mock ───────────────────────────────────
let added = 0, removed = 0;
const activeIds = new Set();
global.window = undefined;
global.localStorage = {
    _d: {}, getItem(k) { return this._d[k] || null; },
    setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; },
};
global.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
        BackgroundGeolocation: {
            // addWatcher 는 의도적으로 await 구간(20ms)을 둔다 — 경쟁창을 재현.
            addWatcher: async () => { const id = 'w' + (++added); await new Promise(r => setTimeout(r, 20)); activeIds.add(id); return id; },
            removeWatcher: async ({ id }) => { removed++; activeIds.delete(id); },
        },
        Geolocation: { getCurrentPosition: async () => ({ coords: { latitude: 0, longitude: 0, accuracy: 10 } }) },
    },
};

const BG = require('../js/location_alert_background.js');

(async () => {
    console.log('[1] 동시 start() 2회 → 워처 1개만 생성');
    await Promise.all([BG.start(), BG.start()]);
    check('addWatcher 1회만 호출', added === 1, `(${added})`);
    check('활성 워처 1개', activeIds.size === 1, `(${activeIds.size})`);
    check('isRunning true', BG.isRunning() === true);

    console.log('\n[2] stop() → 누수 없음');
    await BG.stop();
    check('활성 워처 0(누수 없음)', activeIds.size === 0, `(${activeIds.size})`);
    check('isRunning false', BG.isRunning() === false);

    console.log('\n[3] start() 진행 중 stop() 끼어들기 → 유령 워처 없음');
    added = 0; removed = 0; activeIds.clear();
    const p = BG.start();
    await BG.stop();            // 시작 진행 중 중단 요청
    await p;
    await new Promise(r => setTimeout(r, 30)); // addWatcher 완료 대기
    check('유령 워처 없음', activeIds.size === 0, `(${activeIds.size})`);
    check('isRunning false(비활성 존중)', BG.isRunning() === false);

    console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
    process.exit(fail ? 1 : 0);
})();
