/**
 * ============================================================================
 * test_location_dispatch_reliability.js — 위치기반 깨우기(특보·태풍) 발송 신뢰성 + 스냅샷 축약 회귀검사
 * 역할: 토큰 500개 분할·실제 성공수 기록·실패 시 지문 미저장(재시도)·실패코드 요약 로그·
 *       스냅샷 축약 후에도 단말 판정이 종전과 글자까지 같은지를 확인한다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 검사 대상: local_server/services/location_alert_dispatch.js · typhoon_radius_dispatch.js ·
 *               fcm_multicast_chunked.js
 *  - 단말 판정: client/js/location-alert/location_alert_runtime.js(decideAlert) + location_alert_core.js
 *  - 등록: scripts/refactor/verify_all.sh SUITES
 * [사용자 결정 원문 인용] 2026-10-15 — "①②둘 다, 서버만, 앱 업데이트 없음".
 * 실행: node local_server/scripts/test_location_dispatch_reliability.js
 *   ⚠실제 FCM 은 부르지 않는다 — firebase_admin_lazy 를 require 캐시에서 가짜로 바꿔 끼운다.
 *   ⚠저장소의 data/ 파일(이력·지문)은 건드리지 않는다 — 읽기/쓰기를 전부 주입한다.
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');

// ── 가짜 firebase-admin: SDK 처럼 토큰 500개 초과면 예외. 동작은 시나리오별로 바꾼다. ──
const fakeState = { admin: true, calls: [], behavior: 'ok' };
function fakeSendEachForMulticast(msg) {
    if (msg.tokens.length > 500) {
        const e = new Error('tokens list must not contain more than 500 items');
        e.code = 'messaging/invalid-argument';
        throw e;
    }
    fakeState.calls.push(msg.tokens.length);
    if (fakeState.behavior === 'throw') {
        const e = new Error('simulated network failure'); e.code = 'app/network-error'; throw e;
    }
    const responses = msg.tokens.map((t, i) => {
        if (fakeState.behavior === 'all_fail') {
            return { success: false, error: { code: 'messaging/invalid-argument', message: 'Message is too big' } };
        }
        if (fakeState.behavior === 'some_fail' && i % 10 === 0) {
            return { success: false, error: { code: 'messaging/registration-token-not-registered', message: 'x' } };
        }
        return { success: true, messageId: 'm' + i };
    });
    const successCount = responses.filter(r => r.success).length;
    return Promise.resolve({ successCount, failureCount: responses.length - successCount, responses });
}
const lazyPath = require.resolve('../services/firebase_admin_lazy');
require.cache[lazyPath] = {
    id: lazyPath, filename: lazyPath, loaded: true,
    exports: {
        getAdmin: () => (fakeState.admin
            ? { apps: [{}], messaging: () => ({ sendEachForMulticast: fakeSendEachForMulticast }) }
            : null),
    },
};

global.LocationAlertCore = require('../../client/js/location-alert/location_alert_core.js');
const core = global.LocationAlertCore;
const RT = require('../../client/js/location-alert/location_alert_runtime.js');
const D = require('../services/location_alert_dispatch');
const T = require('../services/typhoon_radius_dispatch');
let H = null;
try { H = require('../services/fcm_multicast_chunked'); } catch (_) { H = null; }

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ ' + name + (extra ? '\n     ' + extra : '')); }
}
// console 출력 가로채기(로그 내용 검사용)
function captureLogs() {
    const lines = [];
    const orig = { log: console.log, warn: console.warn, error: console.error };
    for (const k of ['log', 'warn', 'error']) console[k] = (...a) => lines.push(a.join(' '));
    return { lines, restore: () => Object.assign(console, orig) };
}
const tokensN = (n, p) => Array.from({ length: n }, (_, i) => (p || 'tok') + '_' + String(i).padStart(5, '0') + '_secret');
const consentsOf = (toks) => () => toks.map(t => ({ token: t, agreed: true }));
const noBlock = () => false;

// 실제 운영 구역명(폴리곤 44개를 표준명으로)
const gj = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'client', 'assets', 'warn_zones.geojson'), 'utf8'));
const features = gj.features;
const stdNames = features.map(f => core.canonZone(f.properties.name));

(async () => {
    // ── [1] 도우미: 500개 분할·합산·코드별 집계 ─────────────────────────────
    console.log('[1] fcm_multicast_chunked — 500개씩 나눠 보내고 합산');
    check('도우미 파일이 있다', !!H);
    if (H) {
        fakeState.calls = []; fakeState.behavior = 'some_fail';
        const r = await H.sendMulticastChunked({ sendEachForMulticast: fakeSendEachForMulticast }, tokensN(1201), { data: { a: '1' } });
        check('1201개 → 호출 3회(500/500/201)', JSON.stringify(fakeState.calls) === '[500,500,201]', JSON.stringify(fakeState.calls));
        check('성공·실패 합산(성공 1080 · 실패 121)', r.successCount === 1080 && r.failureCount === 121, JSON.stringify(r));
        check('실패코드 코드별 건수', r.errorCodes['messaging/registration-token-not-registered'] === 121, JSON.stringify(r.errorCodes));
        // 한 묶음만 예외 → 나머지는 계속
        let n = 0;
        const flaky = { sendEachForMulticast: (m) => { n++; if (n === 2) { const e = new Error('boom'); e.code = 'app/network-error'; throw e; } return fakeSendEachForMulticast(m); } };
        fakeState.calls = []; fakeState.behavior = 'ok';
        const r2 = await H.sendMulticastChunked(flaky, tokensN(1100), { data: {} });
        check('2번째 묶음 예외 → 나머지 묶음은 보냄(성공 600·실패 500)', r2.successCount === 600 && r2.failureCount === 500 && r2.ok === false, JSON.stringify(r2));
        check('예외 묶음은 코드로 집계', r2.errorCodes['app/network-error'] === 500, JSON.stringify(r2.errorCodes));
    }

    // ── [2] 특보 dispatchWake — 기본 발송 경로가 500개 넘게도 보낸다 ─────────
    console.log('\n[2] 특보 dispatchWake 기본 발송(가짜 admin) — 1201명');
    const active = [{ zone: '울산앞바다', warnType: '풍랑', level: '주의보', event: 'active', efTime: '2026.10.14 15:00', forecast: { day: '14', summary: '파고 2.0~4.0m' } }];
    let hist = [];
    const recordHistory = (snap, count) => hist.push(count);
    fakeState.calls = []; fakeState.behavior = 'ok'; fakeState.admin = true;
    let cap = captureLogs();
    let r = await D.dispatchWake(active, { getConsents: consentsOf(tokensN(1201)), isPushBlocked: noBlock, recordHistory });
    cap.restore();
    check('호출마다 ≤500개(500/500/201)', JSON.stringify(fakeState.calls) === '[500,500,201]', JSON.stringify(fakeState.calls));
    check('sent = 실제 성공수 1201', r.sent === 1201, JSON.stringify({ sent: r.sent, targets: r.targets }));
    check('이력 count = 성공수 1201', hist.length === 1 && hist[0] === 1201, JSON.stringify(hist));

    // ── [3] 성공 0 → 이력 0, 지문 미저장(다음 주기 재시도), 실패 이력은 같은 상황에 1번만 ──
    console.log('\n[3] dispatchOnLatest — 성공 0이면 지문을 저장하지 않는다');
    const tree = { '동해': { '울산앞바다': { current: { wrnTp: '풍랑', wrnLvl: '주의보', tmEf: '2026.10.14 15:00', tmCc: '' }, upcoming: null, history: [], children: {} } } };
    let saved = [];
    let lastSig = 'old';
    const sigOpts = () => ({
        tree, readLastSig: () => lastSig, writeLastSig: (s) => { saved.push(s); lastSig = s; },
        getConsents: consentsOf(tokensN(3)), isPushBlocked: noBlock, recordHistory,
    });
    hist = []; fakeState.behavior = 'all_fail';
    cap = captureLogs();
    r = await D.dispatchOnLatest(sigOpts());
    const logs1 = cap.lines.slice();
    cap.restore();
    check('전원 실패 → sent 0', r && r.sent === 0, JSON.stringify(r && { sent: r.sent, reason: r.reason }));
    check('전원 실패 → 지문 저장 안 함', saved.length === 0, JSON.stringify(saved));
    check('전원 실패 → 이력 count 0 (대상 수 3 아님)', hist.length === 1 && hist[0] === 0, JSON.stringify(hist));
    const sumLine = logs1.find(l => /발송 결과/.test(l)) || '';
    check('실패코드 요약이 로그에 있다', /messaging\/invalid-argument/.test(sumLine) && /"messaging\/invalid-argument":3/.test(sumLine), sumLine);
    check('로그에 토큰 값이 없다', !logs1.some(l => /tok_\d+_secret/.test(l)), logs1.join(' | '));
    // 디스패치가 찍는 줄만 센다(첫 예보 모듈 로드 때 dotenv 가 찍는 안내 줄은 이 모듈 것이 아니다).
    const own = (ls) => ls.filter(l => /^\[LocationAlertDispatch\]/.test(l));
    check('발송 1회에 로그 1줄', own(logs1).length === 1, JSON.stringify(logs1));
    // 다음 주기(같은 상황) — 다시 보낸다, 이력은 더 안 쌓는다
    fakeState.calls = [];
    cap = captureLogs();
    r = await D.dispatchOnLatest(sigOpts());
    const logs2 = cap.lines.slice();
    cap.restore();
    check('다음 주기에 재시도한다(발송 호출 있음)', fakeState.calls.length === 1, JSON.stringify(fakeState.calls));
    check('같은 상황 연속 실패 → 이력 추가 안 함(1건 유지)', hist.length === 1, JSON.stringify(hist));
    check('재시도 주기도 로그 1줄', own(logs2).length === 1 && logs2.length === 1, JSON.stringify(logs2));
    // 복구 → 성공 수로 이력, 지문 저장
    fakeState.behavior = 'ok';
    cap = captureLogs();
    r = await D.dispatchOnLatest(sigOpts());
    cap.restore();
    check('복구 → 지문 저장', saved.length === 1 && saved[0] === '울산앞바다:advisory:active', JSON.stringify(saved));
    check('복구 → 이력 count 3', hist.length === 2 && hist[1] === 3, JSON.stringify(hist));
    cap = captureLogs();
    r = await D.dispatchOnLatest(sigOpts());
    cap.restore();
    check('저장 후 같은 상황 → unchanged', r && r.reason === 'unchanged', JSON.stringify(r));
    // 종전 형식 지문과 호환(event 를 스냅샷에서 뺐어도 지문 문자열은 그대로)
    lastSig = '울산앞바다:advisory:active';
    cap = captureLogs();
    r = await D.dispatchOnLatest(sigOpts());
    cap.restore();
    check('종전 지문 문자열과 같다 → 배포 직후 재발송 없음', r && r.reason === 'unchanged', JSON.stringify(r));

    // ── [4] 예외·admin 없음 → 이력 count 0 ─────────────────────────────────
    console.log('\n[4] 예외/no_admin → count 0');
    hist = []; fakeState.behavior = 'throw';
    cap = captureLogs();
    r = await D.dispatchWake(active, { getConsents: consentsOf(tokensN(5)), isPushBlocked: noBlock, recordHistory });
    cap.restore();
    check('전송 예외 → sent 0 · 이력 count 0', r.sent === 0 && hist.length === 1 && hist[0] === 0, JSON.stringify({ sent: r.sent, hist }));
    hist = []; fakeState.admin = false;
    cap = captureLogs();
    r = await D.dispatchWake(active, { getConsents: consentsOf(tokensN(5)), isPushBlocked: noBlock, recordHistory });
    cap.restore();
    check('admin 없음 → sent 0 · 이력 count 0', r.sent === 0 && hist.length === 1 && hist[0] === 0, JSON.stringify({ sent: r.sent, hist }));
    fakeState.admin = true;
    hist = [];
    cap = captureLogs();
    r = await D.dispatchWake(active, { sendFn: async () => ({ ok: false, reason: 'x' }), getConsents: consentsOf(tokensN(5)), isPushBlocked: noBlock, recordHistory });
    cap.restore();
    check('successCount 없는 실패 결과 → count 0(대상 수로 채우지 않음)', r.sent === 0 && hist[0] === 0, JSON.stringify({ sent: r.sent, hist }));

    // ── [5] 스냅샷 축약 — 구역은 하나도 빠지지 않는다 ─────────────────────
    console.log('\n[5] 스냅샷 축약');
    const mixRecs = stdNames.map((z, i) => {
        const k = i % 6;
        const rec = { zone: z, warnType: k === 5 ? '태풍' : '풍랑', level: ['주의보', '경보', '예비', '주의보', '경보', '경보'][k],
            event: ['active', 'active', 'publish', 'publish', 'publish', 'active'][k],
            efTime: '2026.10.14 15:00', ynTime: '2026.10.15 06:00' };
        if (i % 3 !== 0) rec.forecast = { day: '14', summary: '북서풍 12~18m/s, 파고 2.0~4.0m' };
        else rec.forecast = null; // null 이면 서버가 런타임 예보를 찾는다 → 개발환경에선 null
        return rec;
    });
    const snapNew = D.buildSnapshot(mixRecs);
    const zn = snapNew.zones || {};
    check('44개 구역 전부 들어 있다', stdNames.every(z => zn[z] && zn[z].tier), stdNames.filter(z => !(zn[z] && zn[z].tier)).join(','));
    check('level·ynTime 없음', Object.values(zn).every(z => !('level' in z) && !('ynTime' in z)));
    check('generatedAt 없음', !('generatedAt' in snapNew));
    check('warnType 은 풍랑이 아닐 때만', Object.values(zn).every(z => ('warnType' in z) === (z.warnType !== undefined && z.warnType !== '풍랑')) && Object.values(zn).some(z => z.warnType === '태풍'));
    check('event 는 active 가 아닐 때만', Object.values(zn).every(z => !('event' in z) || z.event !== 'active') && Object.values(zn).some(z => z.event === 'publish'));
    check('efTime 은 예비이거나 active 아닐 때만', Object.values(zn).every(z => ('efTime' in z) === (z.tier === 'prelim' || (z.event || 'active') !== 'active')));
    check('forecast 는 있을 때만(null 키 없음)', Object.values(zn).every(z => !('forecast' in z) || (z.forecast && typeof z.forecast === 'object')));

    // ── [6] 단말 판정 동일성 — 종전 스냅샷 vs 축약 스냅샷 ────────────────────
    console.log('\n[6] 단말(JS decideAlert) 판정이 종전 스냅샷과 글자까지 같다');
    // 종전 buildSnapshot 의 출력 모양을 그대로 재현(2026-10-15 이전 코드: 모든 필드 + generatedAt).
    const RANK = { none: 0, prelim: 1, advisory: 2, severe: 3 };
    function legacySnapshot(recs) {
        const byZone = {};
        for (const w of recs) (byZone[w.zone] = byZone[w.zone] || []).push(w);
        const zones = {};
        for (const z of Object.keys(byZone)) {
            const ws = byZone[z];
            const tier = core.classifyTier(ws.map(w => ({ type: w.warnType, level: w.level })));
            const one = (w) => core.classifyTier([{ type: w.warnType, level: w.level }]);
            const rep = ws.slice().sort((a, b) => RANK[one(b)] - RANK[one(a)])[0];
            zones[z] = { warnType: rep.warnType || '풍랑', level: rep.level || '', event: rep.event || 'active',
                efTime: rep.efTime || null, ynTime: rep.ynTime || null, tier,
                forecast: (rep.forecast && typeof rep.forecast === 'object') ? rep.forecast
                    : (ws.find(w => w && w.forecast && typeof w.forecast === 'object') || {}).forecast
                    || require('../services/location_alert_forecast').worstForZone(z) || null };
        }
        return { generatedAt: new Date().toISOString(), zones };
    }
    // 시나리오: 혼합 44개 / 22개 / 전부 경보 / 예비 efTime 없음
    const scen = {
        mix44: mixRecs,
        mix22: mixRecs.slice(0, 22),
        severeAll: stdNames.map(z => ({ zone: z, warnType: '풍랑', level: '경보', event: 'active', efTime: 'A', forecast: { day: '1', summary: 'S' } })),
        prelimNoEf: stdNames.slice(0, 30).map((z, i) => ({ zone: z, warnType: i % 2 ? '풍랑' : '강풍', level: i % 2 ? '예비' : '주의보', event: i % 2 ? 'publish' : 'active', efTime: i % 4 === 1 ? '' : 'B' })),
    };
    // 단말 위치: 각 구역 내부점 + 2° 격자 위 바다/육지 점(GPS 오차 두 가지)
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
    const positions = [];
    for (const f of features) { const p = interiorPointOf(f); if (p) positions.push({ lat: p[1], lng: p[0], accuracyM: 30 }); }
    for (let lat = 33; lat <= 38.5; lat += 1) for (let lng = 124.5; lng <= 131; lng += 1) positions.push({ lat, lng, accuracyM: 3000 });
    let compared = 0, diffs = [], notified = 0;
    for (const [name, recs] of Object.entries(scen)) {
        const sNew = JSON.parse(JSON.stringify(D.buildSnapshot(recs)));   // 단말은 문자열을 파싱해 쓴다
        const sOld = JSON.parse(JSON.stringify(legacySnapshot(recs)));
        for (const pos of positions) {
            const dOld = {}, dNew = {};
            const a = RT.decideAlert(pos, features, sOld, dOld);
            const b = RT.decideAlert(pos, features, sNew, dNew);
            compared++;
            if (a) notified++;
            if (JSON.stringify(a) !== JSON.stringify(b) || JSON.stringify(dOld) !== JSON.stringify(dNew)) {
                diffs.push(name + '@' + pos.lat.toFixed(3) + ',' + pos.lng.toFixed(3));
            }
        }
    }
    check('비교 ' + compared + '건(알림 ' + notified + '건) — 제목·본문·tier·event·진단 전부 동일', diffs.length === 0 && notified > 0, diffs.slice(0, 5).join(' / '));

    // ── [7] 태풍 dispatchTyphoon ────────────────────────────────────────────
    console.log('\n[7] 태풍 반경 디스패치');
    const tj = { typhoons: [{ seq: '6', name: '장미', latestTmFc: '202606261059' }] };
    let keys = [];
    hist = [];
    fakeState.calls = []; fakeState.behavior = 'ok';
    cap = captureLogs();
    r = await T.dispatchTyphoon(tj, { getConsents: consentsOf(tokensN(1201)), lastKey: 'x', writeLastKey: (k) => keys.push(k), recordHistory: (s, c) => hist.push(c) });
    cap.restore();
    check('태풍: 호출마다 ≤500개', JSON.stringify(fakeState.calls) === '[500,500,201]', JSON.stringify(fakeState.calls));
    check('태풍: sent = 성공수 · 이력 count = 1201 · 키 저장', r.sent === 1201 && hist[0] === 1201 && keys.length === 1, JSON.stringify({ sent: r.sent, hist, keys }));
    keys = []; hist = []; fakeState.behavior = 'all_fail';
    const tj2 = { typhoons: [{ seq: '7', name: 'X', latestTmFc: '202606262210' }] };
    cap = captureLogs();
    r = await T.dispatchTyphoon(tj2, { getConsents: consentsOf(tokensN(4)), lastKey: 'x', writeLastKey: (k) => keys.push(k), recordHistory: (s, c) => hist.push(c) });
    const tlogs = cap.lines.slice();
    cap.restore();
    check('태풍: 전원 실패 → 키 저장 안 함(다음 주기 재시도)', keys.length === 0 && r.sent === 0, JSON.stringify({ r: r && r.reason, keys }));
    check('태풍: 전원 실패 → 이력 count 0', hist.length === 1 && hist[0] === 0, JSON.stringify(hist));
    check('태풍: 실패코드 로그 · 토큰 없음', tlogs.some(l => /"messaging\/invalid-argument":4/.test(l)) && !tlogs.some(l => /tok_\d+_secret/.test(l)), tlogs.join(' | '));
    cap = captureLogs();
    r = await T.dispatchTyphoon(tj2, { getConsents: consentsOf(tokensN(4)), lastKey: 'x', writeLastKey: (k) => keys.push(k), recordHistory: (s, c) => hist.push(c) });
    cap.restore();
    check('태풍: 같은 키 연속 실패 → 이력 추가 안 함', hist.length === 1, JSON.stringify(hist));
    fakeState.admin = false; hist = []; keys = [];
    const tj3 = { typhoons: [{ seq: '8', name: 'Y', latestTmFc: '202606271010' }] };
    cap = captureLogs();
    r = await T.dispatchTyphoon(tj3, { getConsents: consentsOf(tokensN(4)), lastKey: 'x', writeLastKey: (k) => keys.push(k), recordHistory: (s, c) => hist.push(c) });
    cap.restore();
    check('태풍: admin 없음 → count 0 · 키 저장 안 함', hist[0] === 0 && keys.length === 0, JSON.stringify({ hist, keys }));
    fakeState.admin = true;

    console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ❌ 예외: ' + (e && e.stack)); console.log('\n' + pass + ' PASS / ' + (fail + 1) + ' FAIL'); process.exit(1); });
