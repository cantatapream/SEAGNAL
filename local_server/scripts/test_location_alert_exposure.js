/**
 * test_location_alert_exposure.js — 위치기반 「노출 범위」(일반 공개/관리자만/모두 비노출) 검증
 * 실행: node local_server/scripts/test_location_alert_exposure.js
 *
 * 사용자 확정(2026-11-19): 설정의 「위치 기반 기상 정보 제공」을 관리자에게만 보이고, 관리자 센터에서
 *   3단으로 바꾼다. 숨겨진 대상에게는 알림(깨우는 신호)도 보내지 않는다.
 * [1] 노출 범위 저장소  [2] 동의 레코드의 관리자 표시  [3] 알림 대상 거르기
 * [4] 발송 경로(특보·태풍)가 실제로 거른 대상을 쓰는가  [5] 라우트(노출 판정·관리자 설정·인증)
 * [6] 화면 로직(location_alert_ui.js) — 숨긴 채 시작, 서버가 허락한 기기만 표시, 못 물으면 숨김
 * 임시 파일만 쓴다(저장소 data 를 건드리지 않는다). FCM·네트워크 없음.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lae_test_'));
process.env.LOCATION_ALERT_CONSENTS_FILE = path.join(TMP_DIR, 'consents.json');
process.env.LOCATION_ALERT_EXPOSURE_FILE = path.join(TMP_DIR, 'exposure.json');

const store = require('../services/location_alert_store');
const exposure = require('../services/location_alert_exposure');
const dispatch = require('../services/location_alert_dispatch');
const typhoon = require('../services/typhoon_radius_dispatch');

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} ${extra === undefined ? '' : JSON.stringify(extra)}`); }
}
const tokensOf = (arr) => arr.map((r) => r.token).sort().join(',');

(async () => {
    console.log('[1] 노출 범위 저장소');
    check('파일 없으면 기본값 admin(관리자만)', exposure.getExposure() === 'admin', exposure.getExposure());
    check('잘못된 값은 저장 거부', exposure.setExposure('everyone') === false);
    check('거부 뒤에도 기본값 그대로', exposure.getExposure() === 'admin');
    check('user 저장', exposure.setExposure('user') === true && exposure.getExposure() === 'user');
    check('off 저장', exposure.setExposure('off') === true && exposure.getExposure() === 'off');
    check('저장 뒤 임시 파일(.tmp)이 남지 않는다', !fs.existsSync(process.env.LOCATION_ALERT_EXPOSURE_FILE + '.tmp'));
    // 깨진 파일 — 기본값으로 보되 조용히 넘기지 않는다(서버 로그에 경고). 독립 검토 C.
    const realWarn = console.warn; let warned = [];
    console.warn = (...x) => warned.push(x.join(' '));
    fs.writeFileSync(process.env.LOCATION_ALERT_EXPOSURE_FILE, '{깨진 파일', 'utf8');
    check('파일이 깨졌으면 기본값 admin', exposure.getExposure() === 'admin');
    check('깨진 파일이면 경고를 남긴다', warned.some((w) => /노출 범위 파일을 못 읽어/.test(w)), warned);
    warned = [];
    fs.writeFileSync(process.env.LOCATION_ALERT_EXPOSURE_FILE, JSON.stringify({ exposure: 'public' }), 'utf8');
    check('모르는 값이 적혀 있으면 기본값 admin + 경고', exposure.getExposure() === 'admin' && warned.length === 1, warned);
    warned = [];
    fs.unlinkSync(process.env.LOCATION_ALERT_EXPOSURE_FILE);
    check('파일이 없을 때는 경고하지 않는다(아직 안 바꾼 정상 상태)', exposure.getExposure() === 'admin' && warned.length === 0, warned);
    console.warn = realWarn;
    exposure.setExposure('admin');

    console.log('\n[2] 동의 레코드의 관리자 표시');
    // 옛 레코드(칸 없음) — 배포 전에 만들어진 것. 그때는 관리자 기기만 켤 수 있었다.
    fs.writeFileSync(process.env.LOCATION_ALERT_CONSENTS_FILE, JSON.stringify([
        { token: 'legacy', agreed: true, version: 'v', at: '2026-06-20T00:00:00.000Z' },
    ]), 'utf8');
    store.recordConsent({ token: 'adminA', agreed: true, admin: true });
    store.recordConsent({ token: 'userB', agreed: true, admin: false });
    store.recordConsent({ token: 'userC', agreed: true }); // admin 안 넘김(옛 호출부) = 새 기기는 일반
    const byTok = () => Object.fromEntries(store.all().map((r) => [r.token, r]));
    check('관리자로 확인된 동의 → admin:true', byTok().adminA.admin === true);
    check('일반 기기 동의 → admin:false', byTok().userB.admin === false);
    check('admin 을 안 넘긴 새 기기 → admin:false', byTok().userC.admin === false);
    check('옛 레코드는 칸 없음 그대로', !('admin' in byTok().legacy));
    // 한번 관리자면 유지 — 관리자 로그인이 풀린 뒤 앱 실행 재동기화(관리자 확인 없이 다시 POST)
    store.recordConsent({ token: 'adminA', agreed: true, admin: false });
    check('관리자였던 기기가 확인 없이 다시 동의 → admin:true 유지', byTok().adminA.admin === true);
    store.recordConsent({ token: 'legacy', agreed: true, admin: false });
    check('옛 레코드가 확인 없이 다시 동의 → 칸 없음 유지(관리자로 봄)', !('admin' in byTok().legacy));
    store.recordConsent({ token: 'userB', agreed: true, admin: false });
    check('일반 기기가 다시 동의 → admin:false 유지', byTok().userB.admin === false);
    store.recordConsent({ token: 'userC', agreed: true, admin: true });
    check('일반이던 기기가 관리자로 확인되면 → admin:true 로 승격', byTok().userC.admin === true);
    store.recordConsent({ token: 'userC', agreed: false, admin: false });
    check('철회해도 관리자 표시는 남는다(다시 켜면 그대로)', byTok().userC.admin === true && byTok().userC.agreed === false);

    console.log('\n[3] 알림 대상 거르기 (활성 동의: legacy·adminA·userB / 철회: userC)');
    check('활성 동의 3건', store.count() === 3, store.count());
    check("off → 대상 0", store.getTargetConsents({ exposure: 'off' }).length === 0);
    check("admin → 관리자 기기만(옛 레코드 포함)", tokensOf(store.getTargetConsents({ exposure: 'admin' })) === 'adminA,legacy', tokensOf(store.getTargetConsents({ exposure: 'admin' })));
    check("user → 동의한 전부", tokensOf(store.getTargetConsents({ exposure: 'user' })) === 'adminA,legacy,userB', tokensOf(store.getTargetConsents({ exposure: 'user' })));
    exposure.setExposure('off');
    check('인자 없이 부르면 저장된 범위(off)를 읽는다', store.getTargetConsents().length === 0);
    exposure.setExposure('user');
    check('인자 없이 부르면 저장된 범위(user)를 읽는다', store.getTargetConsents().length === 3);
    exposure.setExposure('admin');
    check('isAdminConsent — 관리자 동의 기기 true', store.isAdminConsent('adminA') === true && store.isAdminConsent('legacy') === true);
    check('isAdminConsent — 일반 기기 false', store.isAdminConsent('userB') === false);
    check('isAdminConsent — 철회한 기기 false(관리자 표시가 있어도)', store.isAdminConsent('userC') === false);
    check('isAdminConsent — 모르는 토큰·빈 값 false', store.isAdminConsent('nobody') === false && store.isAdminConsent('') === false);

    console.log('\n[4] 발송 경로가 거른 대상을 쓰는가 (특보 깨우기 · 태풍 반경)');
    const active = [{ zone: '울산앞바다', warnType: '풍랑', level: '경보', event: 'active', efTime: null }];
    const sentTo = async (mode) => {
        exposure.setExposure(mode);
        let got = null;
        const res = await dispatch.dispatchWake(active, {
            isPushBlocked: () => false, record: false,
            sendFn: async (tokens) => { got = tokens.slice().sort().join(','); return { ok: true, successCount: tokens.length, failureCount: 0 }; },
        });
        return { got, res };
    };
    let r = await sentTo('admin');
    check('특보: admin → 관리자 기기에만 발송', r.got === 'adminA,legacy', r.got);
    r = await sentTo('user');
    check('특보: user → 동의한 전부에 발송', r.got === 'adminA,legacy,userB', r.got);
    r = await sentTo('off');
    check('특보: off → 발송 안 함(no_targets)', r.got === null && r.res.reason === 'no_targets', r.res);
    // 태풍 — 대상 선택 줄이 같은 저장소 함수를 쓰는지(실제 발송 흐름은 test_typhoon_radius_dispatch 가 본다)
    const tySrc = fs.readFileSync(path.join(__dirname, '..', 'services', 'typhoon_radius_dispatch.js'), 'utf8');
    check('태풍: 기본 대상 = getTargetConsents', /opts\.getConsents \|\| \(\(\) => require\('\.\/location_alert_store'\)\.getTargetConsents\(\)\)/.test(tySrc));
    check('태풍: 옛 getActiveConsents 기본 대상이 남아 있지 않다', !/require\('\.\/location_alert_store'\)\.getActiveConsents\(\)/.test(tySrc));
    check('태풍 모듈 로드됨', typeof typhoon.selectTargetTokens === 'function');
    const dSrc = fs.readFileSync(path.join(__dirname, '..', 'services', 'location_alert_dispatch.js'), 'utf8');
    check('특보: 옛 getActiveConsents 기본 대상이 남아 있지 않다', !/require\('\.\/location_alert_store'\)\.getActiveConsents\(\)/.test(dSrc));

    console.log('\n[5] 라우트 — 노출 판정 · 관리자 설정 · 인증');
    // admin_auth 는 로드 때 타이머를 건다 → 가짜로 바꿔 넣는다(require 캐시). 관리자 기기 목록도 가짜.
    const authPath = require.resolve('../services/admin_auth');
    require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
        verifyToken: (t) => t === 'GOOD',
        requireAdminToken: (req, res, next) => (req.get('X-Admin-Token') === 'GOOD' ? next() : res.status(401).json({ error: 'auth' })),
    } };
    const devPath = require.resolve('../services/admin_device');
    require.cache[devPath] = { id: devPath, filename: devPath, loaded: true, exports: { isAdminDevice: (id) => id === 'REGDEV' } };
    const router = require('../routes/location_alert');
    /** 라우터에 가짜 요청을 넣고 {status, body} 를 받는다(express 서버를 띄우지 않는다). */
    const call = (method, url, { headers = {}, body } = {}) => new Promise((resolve) => {
        const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
        const req = { method, url, originalUrl: url, headers: h, body, query: {}, get: (k) => h[k.toLowerCase()] };
        const res = {
            statusCode: 200, _headers: {},
            status(c) { this.statusCode = c; return this; },
            set(k, v) { this._headers[k] = v; return this; },
            json(b) { resolve({ status: this.statusCode, body: b, headers: this._headers }); return this; },
        };
        router.handle(req, res, () => resolve({ status: 404, body: null }));
    });
    exposure.setExposure('admin');
    let x = await call('GET', '/api/location-alert/exposure');
    check('admin + 일반 기기(헤더 없음) → 안 보임', x.status === 200 && x.body.audience === 'admin' && x.body.display === false, x.body);
    check('노출 판정 응답은 캐시 금지', x.headers['Cache-Control'] === 'no-store');
    x = await call('GET', '/api/location-alert/exposure', { headers: { 'X-Admin-Token': 'GOOD' } });
    check('admin + 유효한 관리자 로그인 → 보임', x.body.display === true, x.body);
    x = await call('GET', '/api/location-alert/exposure', { headers: { 'X-Admin-Token': 'EXPIRED' } });
    check('admin + 만료된 관리자 토큰 → 안 보임', x.body.display === false, x.body);
    x = await call('GET', '/api/location-alert/exposure', { headers: { 'X-Admin-Device': 'REGDEV' } });
    check('admin + 등록된 관리자 기기 → 보임', x.body.display === true, x.body);
    x = await call('GET', '/api/location-alert/exposure', { headers: { 'X-Admin-Device': 'legacy' } });
    check('admin + 관리자 기기로 동의해 알림 받는 기기(로그인 만료) → 보임(끌 수 있어야 한다)', x.body.display === true, x.body);
    x = await call('GET', '/api/location-alert/exposure', { headers: { 'X-Admin-Device': 'userB' } });
    check('admin + 일반 공개 때 켰던 일반 기기 → 안 보임', x.body.display === false, x.body);
    exposure.setExposure('user');
    x = await call('GET', '/api/location-alert/exposure');
    check('user → 누구에게나 보임', x.body.audience === 'user' && x.body.display === true, x.body);
    exposure.setExposure('off');
    x = await call('GET', '/api/location-alert/exposure', { headers: { 'X-Admin-Token': 'GOOD', 'X-Admin-Device': 'REGDEV' } });
    check('off → 관리자에게도 안 보임', x.body.audience === 'off' && x.body.display === false, x.body);

    x = await call('GET', '/api/admin/location-alert/exposure');
    check('관리자 조회 — 토큰 없으면 401', x.status === 401, x.status);
    x = await call('POST', '/api/admin/location-alert/exposure', { body: { exposure: 'user' } });
    check('관리자 변경 — 토큰 없으면 401', x.status === 401, x.status);
    check('401 이면 값이 안 바뀐다', exposure.getExposure() === 'off');
    x = await call('POST', '/api/admin/location-alert/exposure', { headers: { 'X-Admin-Token': 'GOOD' }, body: { exposure: 'everyone' } });
    check('관리자 변경 — 모르는 값은 400', x.status === 400 && exposure.getExposure() === 'off', x.status);
    x = await call('POST', '/api/admin/location-alert/exposure', { headers: { 'X-Admin-Token': 'GOOD' }, body: { exposure: 'admin' } });
    check('관리자 변경 — 저장되고 수치를 돌려준다', x.status === 200 && x.body.exposure === 'admin' && x.body.consents === 3 && x.body.targets === 2, x.body);
    x = await call('GET', '/api/admin/location-alert/exposure', { headers: { 'X-Admin-Token': 'GOOD' } });
    check('관리자 조회 — 지금 범위 + 동의·대상 수', x.status === 200 && x.body.exposure === 'admin' && x.body.consents === 3 && x.body.targets === 2, x.body);

    // 동의 POST — 관리자 확인을 라우트가 한다
    x = await call('POST', '/api/location-alert/consent', { body: { token: 'newUser', agreed: true } });
    check('동의 POST(일반) → admin:false 기록', x.body.success === true && byTok().newUser.admin === false, byTok().newUser);
    x = await call('POST', '/api/location-alert/consent', { headers: { 'X-Admin-Token': 'GOOD' }, body: { token: 'newAdmin', agreed: true } });
    check('동의 POST(유효한 관리자 로그인) → admin:true 기록', byTok().newAdmin.admin === true, byTok().newAdmin);
    x = await call('POST', '/api/location-alert/consent', { body: { token: 'REGDEV', agreed: true } });
    check('동의 POST(등록된 관리자 기기의 토큰) → admin:true 기록', byTok().REGDEV.admin === true, byTok().REGDEV);
    x = await call('POST', '/api/location-alert/consent', { headers: { 'X-Admin-Token': 'EXPIRED' }, body: { token: 'staleAdmin', agreed: true } });
    check('동의 POST(만료된 관리자 토큰, 새 기기) → admin:false', byTok().staleAdmin.admin === false, byTok().staleAdmin);
    x = await call('POST', '/api/location-alert/consent', { body: { agreed: true } });
    check('동의 POST — 토큰 없으면 400(종전과 같다)', x.status === 400);

    console.log('\n[6] 화면 로직 — 숨긴 채 시작, 허락된 기기만 표시');
    const mkEl = () => ({ style: {}, checked: false, disabled: false, textContent: '', onchange: null });
    const els = {};
    ['location-alert-card', 'location-alert-toggle', 'location-alert-admin-badge', 'location-alert-update-note',
        'location-alert-status', 'location-alert-sub', 'location-alert-sub-alert', 'location-alert-sub-typhoon'].forEach((id) => { els[id] = mkEl(); });
    const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
    global.localStorage = memStore();
    global.sessionStorage = memStore();
    global.document = { getElementById: (id) => els[id] || null };
    global.LocationAlertBackground = { Mirror: { set: () => { } } };
    let fetchReply = null, fetchSeen = null;
    global.fetch = (url, opts) => {
        fetchSeen = { url, opts };
        if (fetchReply instanceof Error) return Promise.reject(fetchReply);
        return Promise.resolve({ ok: fetchReply.status === 200, status: fetchReply.status, json: async () => fetchReply.body });
    };
    const UI = require('../../client/js/location-alert/location_alert_ui.js');
    const card = els['location-alert-card'], badge = els['location-alert-admin-badge'], toggle = els['location-alert-toggle'];

    global.localStorage.setItem('push_token', 'PUSH1');
    global.localStorage.setItem('seagnal_admin_token', 'ADM1');
    fetchReply = { status: 200, body: { ok: true, audience: 'admin', display: true } };
    card.style.display = 'block';
    const p = UI.initLocationAlertUI();
    check('판정이 오기 전에는 카드를 숨긴다', card.style.display === 'none', card.style.display);
    await p;
    check('노출 판정 주소를 부른다', fetchSeen.url === '/api/location-alert/exposure', fetchSeen.url);
    check('기기 토큰·관리자 토큰을 헤더로 싣는다', fetchSeen.opts.headers['X-Admin-Device'] === 'PUSH1' && fetchSeen.opts.headers['X-Admin-Token'] === 'ADM1', fetchSeen.opts.headers);
    check('admin + 허락 → 카드 표시', card.style.display === 'block', card.style.display);
    check('admin 일 때 「관리자 전용」 딱지 표시', badge.style.display === 'inline-block', badge.style.display);
    check('토글이 묶였다(onchange)', typeof toggle.onchange === 'function');

    fetchReply = { status: 200, body: { ok: true, audience: 'user', display: true } };
    await UI.initLocationAlertUI();
    check('user → 카드 표시 + 딱지 숨김', card.style.display === 'block' && badge.style.display === 'none', [card.style.display, badge.style.display]);

    toggle.onchange = null;
    fetchReply = { status: 200, body: { ok: true, audience: 'admin', display: false } };
    await UI.initLocationAlertUI();
    check('admin + 불허(일반 기기) → 카드 숨김', card.style.display === 'none', card.style.display);
    check('숨김이면 토글을 묶지 않는다', toggle.onchange === null);

    fetchReply = { status: 200, body: { ok: true, audience: 'off', display: false } };
    await UI.initLocationAlertUI();
    check('off → 카드 숨김', card.style.display === 'none');

    fetchReply = new Error('network down');
    card.style.display = 'block';
    await UI.initLocationAlertUI();
    check('서버에 못 물으면 숨김 유지(보수적)', card.style.display === 'none', card.style.display);
    fetchReply = { status: 500, body: { ok: false, error: 'x' } };
    card.style.display = 'block';
    await UI.initLocationAlertUI();
    check('서버 오류(500)면 숨김', card.style.display === 'none', card.style.display);
    fetchReply = { status: 200, body: { ok: true, audience: 'user', display: 'yes' } };
    await UI.initLocationAlertUI();
    check('display 가 true 가 아니면(이상한 값) 숨김', card.style.display === 'none', card.style.display);

    // 독립 검토 C: 설정을 연달아 열 때 늦게 도착한 옛 판정이 새 판정을 덮으면 안 된다.
    {
        const resolvers = [];
        const savedFetch = global.fetch;
        global.fetch = () => new Promise((res) => resolvers.push(res));
        const mk = (body) => ({ ok: true, status: 200, json: async () => body });
        const p1 = UI.initLocationAlertUI();   // 먼저 연 것(옛 판정: 보임)
        const p2 = UI.initLocationAlertUI();   // 나중에 연 것(새 판정: 숨김)
        resolvers[1](mk({ ok: true, audience: 'off', display: false }));   // 새 판정이 먼저 도착
        await p2;
        resolvers[0](mk({ ok: true, audience: 'user', display: true }));   // 옛 판정이 늦게 도착
        await p1;
        check('늦게 온 옛 판정이 새 판정을 덮지 않는다(숨김 유지)', card.style.display === 'none', card.style.display);
        global.fetch = savedFetch;
    }

    // 숨겨진 상태에서 토글 켜기 시도(방어) → 켜지지 않는다
    const cb = { checked: true };
    await UI.onToggle(cb);
    check('숨겨진 상태에서는 켤 수 없다(체크 되돌림)', cb.checked === false && UI.LocationAlertSettings.get().enabled === false);

    // 동의 POST 에 관리자 토큰이 실리는가
    global.Capacitor = { isNativePlatform: () => true, Plugins: {} };
    UI.LocationAlertSettings.recordConsent();
    UI.LocationAlertSettings.setEnabled(true);
    fetchReply = { status: 200, body: { success: true } };
    fetchSeen = null;
    UI.resyncConsentToServer();
    check('동의 재동기화 POST 에 X-Admin-Token 을 싣는다', fetchSeen && fetchSeen.url === '/api/location-alert/consent' && fetchSeen.opts.headers['X-Admin-Token'] === 'ADM1', fetchSeen && fetchSeen.opts.headers);
    global.localStorage.removeItem('seagnal_admin_token');
    fetchSeen = null;
    UI.resyncConsentToServer();
    check('관리자 토큰이 없으면 헤더를 싣지 않는다', fetchSeen && !('X-Admin-Token' in fetchSeen.opts.headers), fetchSeen && fetchSeen.opts.headers);

    try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (_) { /* 임시 폴더 정리 실패는 검사 결과와 무관 */ }
    console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('테스트 실행 중 예외:', e); console.log(`\n결과: ${pass} PASS / ${fail + 1} FAIL`); process.exit(1); });
