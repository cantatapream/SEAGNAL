/**
 * test_location_alert_last_wake.js — "마지막 wake 처리"(location_alert_last_wake) 진단 검증
 * 실행: node local_server/scripts/test_location_alert_last_wake.js
 *
 * handleWake 가 알림 생산 여부와 무관하게 **모든** 종료 경로에서
 * location_alert_last_wake ({at,src,lat,lng,posAt,outcome,zone}) 를
 * localStorage + Preferences(Mirror) 양쪽에 기록하는지 검증한다.
 * 또한 decideAlert 의 공개 반환 계약(Message|null)이 diag out-param 추가 후에도
 * 불변인지(기존 3-인자 호출 non-breaking) 확인한다.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WAKE_KEY = 'location_alert_last_wake';
const MATCH_KEY = 'location_alert_last_match';

// ── 가짜 전역(브라우저 환경 흉내 — 기존 테스트 패턴) ─────────────────────────
function fakeStore() {
    const m = new Map();
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k),
        _map: m,
    };
}
global.localStorage = fakeStore();

// Preferences 미러(writeLastWake/writeLastMatch 가 Mirror.set 사용) + fresh-fix 훅.
const prefsMirror = new Map();
let freshPos = null; // 각 케이스에서 설정
global.LocationAlertBackground = {
    Mirror: { set: (k, v) => prefsMirror.set(k, String(v)) },
    getFreshPosition: async () => freshPos,
};

// 로컬 알림 스파이 — notified 경로에서만 schedule 이 불려야 한다.
const scheduled = [];
global.Capacitor = {
    Plugins: { LocalNotifications: { schedule: async (o) => { scheduled.push(o); } } },
};

// loadFeatures 는 root.fetch('/api/warn-zones') 사용 → 실제 geojson 을 물려준다.
const gj = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'assets', 'warn_zones.geojson'), 'utf8'));
global.fetch = async () => ({ json: async () => gj });

global.LocationAlertCore = require('../js/location_alert_core.js');
const RT = require('../js/location_alert_runtime.js');
const core = global.LocationAlertCore;
const features = gj.features;

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} ${extra || ''}`); }
}

// 구역 내부점 구하기(테스트 보조 — test_location_alert_runtime.js 와 동일)
function interiorPointOf(feature) {
    const geom = feature.geometry;
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    for (const poly of polys) {
        const ext = poly[0];
        let sx = 0, sy = 0; ext.forEach(p => { sx += p[0]; sy += p[1]; });
        const c = [sx / ext.length, sy / ext.length];
        if (core.pointInGeometry(c, core.seaGeometry(feature))) return c;
        for (let i = 0; i < ext.length - 1; i++) {
            const m = [(ext[i][0] + c[0]) / 2, (ext[i][1] + c[1]) / 2];
            if (core.pointInGeometry(m, core.seaGeometry(feature))) return m;
        }
    }
    return null;
}

const ulsan = features.find(f => f.properties.name === '울산앞바다');
const upt = interiorPointOf(ulsan);
const ZONE = ulsan.properties.name;
const snapSevere = { zones: { [ZONE]: { warnType: '풍랑', level: '경보', event: 'active', tier: 'severe' } } };
const snapStr = JSON.stringify(snapSevere);

function readWake() {
    const raw = global.localStorage.getItem(WAKE_KEY);
    try { return raw ? JSON.parse(raw) : null; } catch (_) { return null; }
}
function resetWake() {
    global.localStorage.removeItem(WAKE_KEY);
    prefsMirror.delete(WAKE_KEY);
}
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

(async () => {
    // ── [0] decideAlert 공개 계약 불변(3-인자 non-breaking + diag out-param) ──
    console.log('[0] decideAlert 계약 불변 + diag out-param');
    const p = { lat: upt[1], lng: upt[0], accuracyM: 30 };
    const m3 = RT.decideAlert(p, features, snapSevere);          // 기존 3-인자
    const dg = {};
    const m4 = RT.decideAlert(p, features, snapSevere, dg);      // diag 오버로드
    check('3-인자 호출 여전히 메시지 반환', !!m3 && !!m3.title);
    check('diag 전달해도 반환값 동일(title)', !!m4 && m4.title === m3.title);
    check('diag.reason=notified', dg.reason === 'notified', dg.reason);
    check('diag.locatedZone=울산앞바다', dg.locatedZone === ZONE, dg.locatedZone);
    const dgL = {};
    check('육지 → null + diag off-sea',
        RT.decideAlert({ lat: 37.5665, lng: 126.9780, accuracyM: 30 }, features, snapSevere, dgL) === null
        && dgL.reason === 'off-sea' && dgL.locatedZone === '', dgL.reason);
    const dgN = {};
    check('무특보 → null + diag no-warning',
        RT.decideAlert(p, features, { zones: {} }, dgN) === null
        && dgN.reason === 'no-warning' && dgN.locatedZone === ZONE, dgN.reason);
    check('diag 가 객체 아니면 무시(non-breaking)',
        !!RT.decideAlert(p, features, snapSevere, 'not-an-object'));

    // ── [1] notified (fresh-fix 위치) ─────────────────────────────────────
    console.log('\n[1] handleWake: notified (fresh-fix)');
    resetWake(); scheduled.length = 0;
    freshPos = { lat: upt[1], lng: upt[0], acc: 30, at: '2026-07-11T01:02:03.000Z', src: 'gps' };
    await RT.handleWake(snapStr, {});
    let r = readWake();
    check('last_wake 기록됨', !!r);
    check('outcome=notified', r && r.outcome === 'notified', r && r.outcome);
    check('src=gps', r && r.src === 'gps', r && r.src);
    check('zone=울산앞바다', r && r.zone === ZONE, r && r.zone);
    check('lat/lng = 수집 좌표', r && Math.abs(r.lat - upt[1]) < 1e-9 && Math.abs(r.lng - upt[0]) < 1e-9);
    check('at ISO 형식', r && ISO_RE.test(r.at), r && r.at);
    check('posAt=위치 자체 시각 전파', r && r.posAt === '2026-07-11T01:02:03.000Z', r && JSON.stringify(r.posAt));
    check('Preferences 미러에도 동일 JSON', prefsMirror.get(WAKE_KEY) === global.localStorage.getItem(WAKE_KEY));
    check('로컬 알림 1건 표출', scheduled.length === 1, String(scheduled.length));
    const lm = JSON.parse(global.localStorage.getItem(MATCH_KEY));
    check('last_match 도 기존대로 기록(성공 판정)', lm && lm.zone === ZONE);

    // ── [2] off-sea (육지) ────────────────────────────────────────────────
    console.log('\n[2] handleWake: off-sea (육지/외해)');
    resetWake(); scheduled.length = 0;
    const matchBefore2 = global.localStorage.getItem(MATCH_KEY);
    freshPos = { lat: 37.5665, lng: 126.9780, acc: 30, at: '2026-07-11T01:02:03.000Z', src: 'gps' };
    await RT.handleWake(snapStr, {});
    r = readWake();
    check('outcome=off-sea', r && r.outcome === 'off-sea', r && r.outcome);
    check('zone="" (바다 구역 밖)', r && r.zone === '', r && r.zone);
    check('src=gps', r && r.src === 'gps');
    check('알림 표출 없음', scheduled.length === 0);
    check('last_match 불변(성공 판정만 기록)', global.localStorage.getItem(MATCH_KEY) === matchBefore2);

    // ── [3] no-warning (바다 구역이나 무특보) ─────────────────────────────
    console.log('\n[3] handleWake: no-warning (구역 내 무특보)');
    resetWake(); scheduled.length = 0;
    freshPos = { lat: upt[1], lng: upt[0], acc: 30, at: '2026-07-11T01:02:03.000Z', src: 'gps' };
    await RT.handleWake(JSON.stringify({ zones: {} }), {});
    r = readWake();
    check('outcome=no-warning', r && r.outcome === 'no-warning', r && r.outcome);
    check('zone=판정된 구역명(diag.locatedZone)', r && r.zone === ZONE, r && r.zone);
    check('알림 표출 없음', scheduled.length === 0);

    // ── [3b] no-warning (회색지대 — severe 보류도 no-warning 으로 기록) ───
    console.log('\n[3b] handleWake: no-warning (회색지대 severe 보류)');
    resetWake(); scheduled.length = 0;
    freshPos = { lat: upt[1], lng: upt[0], acc: 999999, at: '2026-07-11T01:02:03.000Z', src: 'gps' };
    await RT.handleWake(snapStr, {});
    r = readWake();
    check('outcome=no-warning(회색지대 보류)', r && r.outcome === 'no-warning', r && r.outcome);
    check('zone=판정된 구역명 유지', r && r.zone === ZONE, r && r.zone);
    check('알림 표출 없음(severe 보류)', scheduled.length === 0);

    // ── [4] no-position (fresh-fix/저장 위치 모두 실패) ───────────────────
    console.log('\n[4] handleWake: no-position');
    resetWake(); scheduled.length = 0;
    freshPos = null;
    await RT.handleWake(snapStr, {});
    r = readWake();
    check('outcome=no-position', r && r.outcome === 'no-position', r && r.outcome);
    check('lat/lng=null(위치 없음)', r && r.lat === null && r.lng === null);
    check('at 은 그래도 기록(ISO)', r && ISO_RE.test(r.at));
    check('알림 표출 없음', scheduled.length === 0);

    // ── [5] notified (실제 gps fresh-fix) — src/posAt 전파 ────────────────
    console.log('\n[5] handleWake: notified (gps fresh-fix + posAt)');
    resetWake(); scheduled.length = 0;
    freshPos = { lat: upt[1], lng: upt[0], acc: 25, at: '2026-07-11T01:02:03.000Z', src: 'gps' };
    await RT.handleWake(snapStr, {});
    r = readWake();
    check('outcome=notified', r && r.outcome === 'notified', r && r.outcome);
    check('src=gps', r && r.src === 'gps', r && r.src);
    check('posAt=위치 자체 시각 전파', r && r.posAt === '2026-07-11T01:02:03.000Z', r && r.posAt);
    check('알림 표출 1건', scheduled.length === 1);

    // ── [6] disabled-skip (subAlert OFF 게이트 — 판정됐어도 표출 스킵) ────
    console.log('\n[6] handleWake: disabled-skip (subAlert OFF)');
    resetWake(); scheduled.length = 0;
    const matchBefore6 = global.localStorage.getItem(MATCH_KEY);
    freshPos = { lat: upt[1], lng: upt[0], acc: 30, at: '2026-07-11T01:02:03.000Z', src: 'gps' };
    global.LocationAlertSettings = { get: () => ({ subAlert: false }) };
    await RT.handleWake(snapStr, {});
    delete global.LocationAlertSettings;
    r = readWake();
    check('outcome=disabled-skip', r && r.outcome === 'disabled-skip', r && r.outcome);
    check('zone 은 판정 구역 유지(진단 가치)', r && r.zone === ZONE, r && r.zone);
    check('알림 표출 없음(게이트 동작)', scheduled.length === 0);
    check('last_match 불변(표출 안 됨)', global.localStorage.getItem(MATCH_KEY) === matchBefore6);

    // ── [7] suberror (스냅샷 파싱 실패 등 예외) ───────────────────────────
    console.log('\n[7] handleWake: suberror (예외 경로)');
    resetWake(); scheduled.length = 0;
    await RT.handleWake('{{{not-json', {});
    r = readWake();
    check('outcome=suberror', r && r.outcome === 'suberror', r && r.outcome);
    check('알림 표출 없음', scheduled.length === 0);

    // ── [8] 연결 무결성 — 다른 키 불오염 ──────────────────────────────────
    console.log('\n[8] 연결 무결성');
    check('POS_KEY(location_alert_last_pos) 미기록(오염 없음)',
        global.localStorage.getItem('location_alert_last_pos') === null
        && !prefsMirror.has('location_alert_last_pos'));

    console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('테스트 실행 실패:', e); process.exit(1); });
