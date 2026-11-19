/**
 * test_push_device_test.js — 「직접 발송」의 "이 휴대폰에만 보내기(시험)" 검증
 * 실행: node local_server/scripts/test_push_device_test.js
 *
 * 사용자 확정(2026-11-20): 새 앱의 헤드업 알림을 휴대폰 한 대로 시험한다 + 10초 지연(누른 뒤 앱을 끌 시간).
 * ★가장 먼저 보는 것 — **시험 푸시가 다른 사람에게 나가는 길이 없는가.**
 * [1] 입력 확인  [2] 푸시 모양이 실제 「직접 발송」과 같은가  [3] 한 대에만·지연  [4] 서버 라우트(인증·오류)
 * [5] 화면 흐름 — 시험이면 일반 발송(/api/push-custom)을 절대 부르지 않는다
 * 실제 FCM·네트워크·구독자 파일을 쓰지 않는다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const D = require('../services/push_device_test');

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} ${extra === undefined ? '' : JSON.stringify(extra)}`); }
}

(async () => {
    console.log('[1] 입력 확인');
    const ok = D.validate({ token: ' tok-1 ', title: ' 시험 ', content: ' 내용 ', delaySec: 10 });
    check('정상 입력 → 앞뒤 공백을 떼고 통과', ok.ok && ok.token === 'tok-1' && ok.title === '시험' && ok.content === '내용' && ok.delaySec === 10, ok);
    check('지연을 안 주면 0(바로)', D.validate({ token: 't', title: 'a', content: 'b' }).delaySec === 0);
    check('token 없음 → 거절', D.validate({ title: 'a', content: 'b' }).ok === false);
    check('token 빈 문자열·공백 → 거절', !D.validate({ token: '', title: 'a', content: 'b' }).ok && !D.validate({ token: '   ', title: 'a', content: 'b' }).ok);
    check('token 이 배열(여러 개) → 거절', D.validate({ token: ['t1', 't2'], title: 'a', content: 'b' }).ok === false);
    check('token 이 객체 → 거절', D.validate({ token: { $ne: null }, title: 'a', content: 'b' }).ok === false);
    check('제목·내용 없음 → 거절', !D.validate({ token: 't', content: 'b' }).ok && !D.validate({ token: 't', title: 'a' }).ok);
    check('내용 500자는 통과, 501자는 거절', D.validate({ token: 't', title: 'a', content: 'x'.repeat(500) }).ok && !D.validate({ token: 't', title: 'a', content: 'x'.repeat(501) }).ok);
    check('지연 60초는 통과, 61초는 거절', D.validate({ token: 't', title: 'a', content: 'b', delaySec: 60 }).ok && !D.validate({ token: 't', title: 'a', content: 'b', delaySec: 61 }).ok);
    for (const bad of [true, [5], '1e1', ' 10', { a: 1 }]) check(`지연 ${JSON.stringify(bad)}(숫자가 아닌 꼴) → 거절`, D.validate({ token: 't', title: 'a', content: 'b', delaySec: bad }).ok === false);
    check('지연 "10"(숫자만 있는 문자열)은 받는다', D.validate({ token: 't', title: 'a', content: 'b', delaySec: '10' }).delaySec === 10);
    for (const bad of [-1, 1.5, 'abc', NaN, Infinity]) check(`지연 ${String(bad)} → 거절`, D.validate({ token: 't', title: 'a', content: 'b', delaySec: bad }).ok === false);
    check('본문이 통째로 없어도 죽지 않고 거절', D.validate(undefined).ok === false && D.validate(null).ok === false);

    console.log('\n[2] 푸시 모양 — 실제 「직접 발송」과 같은가');
    const msg = D.buildMessage({ token: 'tok-1', title: '시험', content: '내용' });
    check('받는 곳은 token 하나(tokens·topic·condition 없음)', msg.token === 'tok-1' && !('tokens' in msg) && !('topic' in msg) && !('condition' in msg), Object.keys(msg));
    check('notification 제목·본문', msg.notification.title === '시험' && msg.notification.body === '내용');
    check('android priority high', msg.android && msg.android.priority === 'high');
    check('★알림 채널을 지정하지 않는다(지정하면 새 앱의 기본 채널=헤드업을 시험하지 못한다)',
        !(msg.android && msg.android.notification) && !JSON.stringify(msg).includes('channel'), msg.android);
    // 원본(routes/push.js 의 일반 발송 msg)과 같은 열쇠·같은 값인지 소스에서 대조한다 — 원본이 바뀌면 여기서 걸린다.
    const pushSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'push.js'), 'utf8');
    check('원본에 같은 notification 꼴이 있다', /notification: \{ title: part\.title, body: part\.body \}/.test(pushSrc));
    check("원본의 data.type 'custom_push' 와 같다", /type: isManualGroupSend \? 'manual_group' : 'custom_push'/.test(pushSrc) && msg.data.type === 'custom_push');
    check("원본의 android { priority: 'high' } 와 같다", /android: \{ priority: 'high' \},\s*\n\s*apns: \{ headers: \{ 'apns-priority': '10' \} \}/.test(pushSrc) && msg.apns.headers['apns-priority'] === '10');
    check('딥링크 주소가 원본과 같은 꼴(tab=weather-alert-section&popup=true)', msg.data.url === 'https://seagnal-server.fly.dev/?tab=weather-alert-section&popup=true'
        && /const url = `\$\{BASE_URL\}\/\?tab=weather-alert-section&\$\{params\.toString\(\)\}`/.test(pushSrc) && /params\.append\('popup', 'true'\)/.test(pushSrc), msg.data.url);

    console.log('\n[3] 한 대에만 · 지연');
    let sent = [];
    const send = async (m) => { sent.push(m); return { ok: true, messageId: 'mid-1' }; };
    let r = await D.sendToDevice(D.validate({ token: 'tok-1', title: '시험', content: '내용' }), { send });
    check('지연 0 → 바로 한 통', sent.length === 1 && sent[0].token === 'tok-1' && r.success === true && r.scheduled === false && r.messageId === 'mid-1', r);
    sent = [];
    const timers = [];
    r = await D.sendToDevice(D.validate({ token: 'tok-1', title: '시험', content: '내용', delaySec: 10 }), { send, setTimer: (fn, ms) => timers.push({ fn, ms }), log: () => { } });
    check('지연 10 → 아직 안 보냄 + 예약됐다고 답함', sent.length === 0 && r.success === true && r.scheduled === true && r.delaySec === 10, r);
    check('타이머는 정확히 10000ms 하나', timers.length === 1 && timers[0].ms === 10000, timers.map((t) => t.ms));
    timers[0].fn(); await new Promise((z) => setImmediate(z));
    check('타이머가 터지면 그 한 대에 한 통', sent.length === 1 && sent[0].token === 'tok-1', sent.length);
    r = await D.sendToDevice(D.validate({ token: 'tok-1', title: '시험', content: '내용' }), { send: async () => ({ ok: false, code: 'messaging/registration-token-not-registered' }) });
    check('발송 실패 → success:false + 실패 코드', r.success === false && r.code === 'messaging/registration-token-not-registered' && /발송 실패/.test(r.error), r);
    const logs = [];
    r = await D.sendToDevice(D.validate({ token: 't', title: 'a', content: 'b', delaySec: 1 }), { send: async () => { throw new Error('boom'); }, setTimer: (fn) => fn(), log: (l) => logs.push(l) });
    await new Promise((z) => setImmediate(z));
    check('예약 발송이 던져도 서버가 죽지 않고 로그를 남긴다', logs.some((l) => /예약 발송 오류: boom/.test(l)), logs);
    const modSrc = fs.readFileSync(path.join(__dirname, '..', 'services', 'push_device_test.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    check('★이 모듈은 구독자 파일·파일 시스템을 아예 읽지 않는다', !/require\(['"]fs['"]\)|subscriptions|SUBS_FILE|sendEachForMulticast|sendMulticast/.test(modSrc));

    console.log('\n[4] 서버 라우트 — 인증 · 오류');
    const stub = (rel, exports) => { const p = require.resolve(rel); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
    stub('../services/admin_auth', {
        verifyToken: (t) => t === 'GOOD',
        requireAdminToken: (req, res, next) => (req.get('X-Admin-Token') === 'GOOD' ? next() : res.status(401).json({ error: 'auth' })),
    });
    const fcmSent = [];
    let fcmReady = true, fcmFail = null;
    stub('../services/firebase_admin_lazy', {
        getAdmin: () => (fcmReady ? { apps: [{}], messaging: () => ({ send: async (m) => { if (fcmFail) { const e = new Error('x'); e.code = fcmFail; throw e; } fcmSent.push(m); return 'mid-9'; } }) } : { apps: [] }),
    });
    const realLog = console.log, realErr = console.error, realWarn = console.warn;
    console.log = console.error = console.warn = () => { };
    const router = require('../routes/push');
    console.log = realLog; console.error = realErr; console.warn = realWarn;
    const call = (method, url, { headers = {}, body } = {}) => new Promise((resolve) => {
        const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
        const req = { method, url, originalUrl: url, headers: h, body, query: {}, get: (k) => h[k.toLowerCase()] };
        const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, setHeader() { }, set() { return this; }, json(b) { resolve({ status: this.statusCode, body: b }); return this; } };
        router.handle(req, res, () => resolve({ status: 404, body: null }));
    });
    const quiet = async (fn) => { console.log = console.error = console.warn = () => { }; try { return await fn(); } finally { console.log = realLog; console.error = realErr; console.warn = realWarn; } };
    const B = { token: 'tok-dev', title: '시험', content: '내용', delaySec: 0 };
    let x = await quiet(() => call('POST', '/api/admin/push-test-device', { body: B }));
    check('관리자 토큰 없음 → 401, 아무것도 안 보냄', x.status === 401 && fcmSent.length === 0, x.status);
    x = await quiet(() => call('POST', '/api/admin/push-test-device', { headers: { 'X-Admin-Token': 'BAD' }, body: B }));
    check('틀린 관리자 토큰 → 401, 아무것도 안 보냄', x.status === 401 && fcmSent.length === 0, x.status);
    x = await quiet(() => call('POST', '/api/admin/push-test-device', { headers: { 'X-Admin-Token': 'GOOD' }, body: { title: '시험', content: '내용' } }));
    check('token 없음 → 400, 아무것도 안 보냄', x.status === 400 && x.body.success === false && fcmSent.length === 0, x);
    x = await quiet(() => call('POST', '/api/admin/push-test-device', { headers: { 'X-Admin-Token': 'GOOD' }, body: B }));
    check('정상 → 200, FCM 에 정확히 한 통·그 토큰으로', x.status === 200 && x.body.success === true && fcmSent.length === 1 && fcmSent[0].token === 'tok-dev', [x, fcmSent.length]);
    check('보낸 모양에 알림 채널 지정이 없다', !JSON.stringify(fcmSent[0]).includes('channel'));
    fcmFail = 'messaging/registration-token-not-registered';
    x = await quiet(() => call('POST', '/api/admin/push-test-device', { headers: { 'X-Admin-Token': 'GOOD' }, body: B }));
    check('FCM 이 거절(죽은 토큰) → 502 + 실패 코드', x.status === 502 && x.body.success === false && x.body.code === fcmFail, x);
    fcmFail = null; fcmReady = false;
    x = await quiet(() => call('POST', '/api/admin/push-test-device', { headers: { 'X-Admin-Token': 'GOOD' }, body: B }));
    check('Firebase 미준비 → 503', x.status === 503 && x.body.success === false, x);
    fcmReady = true;
    check('★시험 라우트 본문이 구독자 파일(SUBS_FILE)·이력 파일을 건드리지 않는다', (() => {
        const i = pushSrc.indexOf("router.post('/api/admin/push-test-device'"); const j = pushSrc.indexOf('// 태풍 발생/소멸 푸시 발송 API', i);
        const body = pushSrc.slice(i, j);
        return i > 0 && j > i && !/SUBS_FILE|HISTORY_FILE|pushCounter|writeFile/.test(body);
    })());

    console.log('\n[5] 화면 흐름 — 시험이면 일반 발송을 절대 부르지 않는다');
    const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'js', 'push', 'alert_push.js'), 'utf8');
    const a = ui.indexOf('window.toggleSendThisDevice = function');
    const b = ui.indexOf('// ============================================================================', ui.indexOf('window.executeCustomPush = async function'));
    const endOfExec = ui.indexOf('\n};', ui.indexOf('window.executeCustomPush = async function')) + 3;
    check('화면 코드 구간을 찾았다', a > 0 && endOfExec > a, [a, endOfExec]);
    const code = ui.slice(a, endOfExec);
    const runUi = async ({ thisDevice, delay = true, pushToken = 'PT-1', zonesChecked = 2, allSubs = false, title = '시험', content = '내용', reply, between, forceExecute = false, skipExecute = false }) => {
        const els = {
            'check-send-this-device': { checked: thisDevice }, 'check-this-device-delay': { checked: delay },
            'check-send-all-subscribers': { checked: allSubs, disabled: false }, 'check-all-zones': { checked: false },
            'custom-push-title': { value: title }, 'custom-push-content': { value: content },
            'confirm-target-text': { textContent: '' }, 'custom-push-confirm-overlay': { style: { display: 'none' } },
            'final-send-btn': { disabled: false, innerHTML: '지금 발송' }, 'this-device-options': { style: {} },
            'zone-selection-area': { style: {} }, 'target-zone-count': { textContent: '' },
        };
        const calls = [], alerts = [];
        const ctx = {
            window: {}, console,
            document: { getElementById: (id) => els[id] || null, querySelectorAll: () => ({ length: zonesChecked, [Symbol.iterator]: function* () { for (let i = 0; i < zonesChecked; i++) yield { value: '해역' + i }; } }) },
            localStorage: { getItem: (k) => (k === 'push_token' ? pushToken : null) },
            alert: (m) => alerts.push(m),
            fetch: async (url, opts) => { calls.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null }); const rp = reply || { status: 200, body: { success: true, scheduled: true, delaySec: 10 } }; if (rp instanceof Error) throw rp; return { status: rp.status, json: async () => rp.body }; },
            _invalidateHistoryCache: () => { }, Array, JSON, Promise,
        };
        ctx.window.switchAlertAdminTab = () => { };
        vm.createContext(ctx);
        vm.runInContext(code + '\n;window.__f = { isThisDeviceMode, thisDevicePushToken };', ctx);
        ctx.window.confirmCustomPush();
        const shown = els['custom-push-confirm-overlay'].style.display === 'flex';
        if (shown && between) between(els);   // 확인 창이 떠 있는 동안 일어나는 일(체크칸이 바뀜 등)
        if ((shown || forceExecute) && !skipExecute) await ctx.window.executeCustomPush();
        return { calls, alerts, shown, target: els['confirm-target-text'].textContent, els, ctx };
    };
    let u = await runUi({ thisDevice: true });
    check('시험 + 10초 → 확인 창 대상 문구 「이 휴대폰 1대(시험)」', u.shown && u.target === '이 휴대폰 1대(시험)', u.target);
    check('시험 → 시험 주소만 부른다', u.calls.length === 1 && u.calls[0].url === '/api/admin/push-test-device', u.calls.map((c) => c.url));
    check('시험 → 이 휴대폰의 푸시 주소·지연 10초를 싣는다', u.calls[0].body.token === 'PT-1' && u.calls[0].body.delaySec === 10 && u.calls[0].body.title === '시험', u.calls[0].body);
    check('★시험 → 일반 발송(/api/push-custom)을 부르지 않는다', !u.calls.some((c) => c.url === '/api/push-custom'));
    check('예약됐다는 안내가 뜬다', u.alerts.some((m) => /10초 뒤에 이 휴대폰으로/.test(m)), u.alerts);
    check('버튼·확인 창을 되돌린다', u.els['final-send-btn'].disabled === false && u.els['custom-push-confirm-overlay'].style.display === 'none');
    u = await runUi({ thisDevice: true, delay: false, reply: { status: 200, body: { success: true, scheduled: false } } });
    check('시험 + 지연 끔 → delaySec 0', u.calls.length === 1 && u.calls[0].body.delaySec === 0, u.calls[0] && u.calls[0].body);
    u = await runUi({ thisDevice: true, zonesChecked: 0 });
    check('시험은 해역을 하나도 안 골라도 된다', u.shown && u.calls.length === 1);
    u = await runUi({ thisDevice: true, pushToken: null });
    check('★푸시 주소가 없으면 확인 창도 안 뜨고 아무 요청도 안 나간다', !u.shown && u.calls.length === 0 && u.alerts.some((m) => /푸시 주소가 없습니다/.test(m)), [u.shown, u.calls.length]);
    u = await runUi({ thisDevice: true, zonesChecked: 5, reply: { status: 502, body: { success: false, error: '발송 실패 (x)' } } });
    check('★시험 발송이 실패해도 일반 발송으로 넘어가지 않는다(해역이 골라져 있어도)', u.calls.length === 1 && u.calls[0].url === '/api/admin/push-test-device' && u.alerts.some((m) => /시험 발송 실패/.test(m)), u.calls.map((c) => c.url));
    u = await runUi({ thisDevice: true, zonesChecked: 5, reply: new Error('network') });
    check('★통신 오류여도 일반 발송으로 넘어가지 않는다', u.calls.length === 1 && u.calls[0].url === '/api/admin/push-test-device' && u.alerts.some((m) => /서버 통신 오류/.test(m)), u.calls.map((c) => c.url));
    u = await runUi({ thisDevice: true, zonesChecked: 5, reply: { status: 401, body: { error: '관리자 인증이 필요합니다.' } } });
    check('★인증 실패(401)여도 일반 발송으로 넘어가지 않는다', u.calls.length === 1 && u.calls[0].url === '/api/admin/push-test-device', u.calls.map((c) => c.url));
    u = await runUi({ thisDevice: false, zonesChecked: 2, reply: { status: 200, body: { success: true, successCount: 1, failCount: 0 } } });
    check('체크칸을 끄면 종전대로 일반 발송(/api/push-custom)만 부른다', u.calls.length === 1 && u.calls[0].url === '/api/push-custom' && u.target === '2개 해역', [u.calls.map((c) => c.url), u.target]);
    check('일반 발송 본문에 token·delaySec 이 섞이지 않는다', !('token' in u.calls[0].body) && !('delaySec' in u.calls[0].body) && !('adminToken' in u.calls[0].body), u.calls[0].body);
    u = await runUi({ thisDevice: false, zonesChecked: 0 });
    check('체크칸을 끄고 해역도 없으면 종전대로 막는다', !u.shown && u.calls.length === 0);
    // 독립 검토 E-A: 확인 창이 떠 있는 동안 체크칸이 바뀌어도, 창에 적힌 대상과 다른 곳으로 나가지 않는다.
    u = await runUi({ thisDevice: true, zonesChecked: 3, between: (els) => { els['check-send-this-device'].checked = false; } });
    check('★「이 휴대폰 1대(시험)」으로 확인한 뒤 체크칸이 꺼져도 시험으로만 나간다(일반 발송 0번)', u.target === '이 휴대폰 1대(시험)' && u.calls.length === 1 && u.calls[0].url === '/api/admin/push-test-device', [u.target, u.calls.map((c) => c.url)]);
    u = await runUi({ thisDevice: false, zonesChecked: 3, between: (els) => { els['check-send-this-device'].checked = true; }, reply: { status: 200, body: { success: true, scheduled: true, delaySec: 10 } } });
    check('★일반으로 확인한 뒤 시험 체크칸이 켜지면 시험으로만 나간다(일반 발송 0번)', u.calls.length === 1 && u.calls[0].url === '/api/admin/push-test-device', u.calls.map((c) => c.url));
    u = await runUi({ thisDevice: false, zonesChecked: 3, forceExecute: true, skipExecute: false, between: null, title: '시험', content: '내용', reply: { status: 200, body: { success: true, successCount: 1, failCount: 0 } } });
    check('일반으로 확인하고 그대로 누르면 종전대로 일반 발송 1번', u.calls.length === 1 && u.calls[0].url === '/api/push-custom');
    {   // 확인 창을 거치지 않고 발송 함수가 불리면(상태 null) 아무것도 보내지 않는다
        const r0 = await runUi({ thisDevice: false, zonesChecked: 3, skipExecute: true });
        r0.calls.length = 0; r0.alerts.length = 0;
        await r0.ctx.window.executeCustomPush();   // 1번째: 방금 확인한 것 → 일반 발송
        await r0.ctx.window.executeCustomPush();   // 2번째: 확인 없이 다시 → 보내지 않는다
        check('★확인 한 번에 발송은 한 번 — 확인 없이 다시 불리면 보내지 않는다', r0.calls.length === 1 && r0.alerts.some((m) => /발송 대상을 다시 확인/.test(m)), [r0.calls.map((c) => c.url), r0.alerts]);
    }
    u = await runUi({ thisDevice: true });
    check('예약 안내에 "실패해도 여기에 표시되지 않는다"는 말이 있다', u.alerts.some((m) => /예약 발송은 실패해도 여기에 표시되지 않습니다/.test(m)), u.alerts);

    // 토글: 켜면 「구독자 전원」을 풀고 잠근다
    u = await runUi({ thisDevice: false, zonesChecked: 0 });
    u.els['check-send-all-subscribers'].checked = true;
    u.ctx.window.toggleSendThisDevice(true);
    check('시험 체크칸을 켜면 「구독자 전원」이 풀리고 잠긴다', u.els['check-send-all-subscribers'].checked === false && u.els['check-send-all-subscribers'].disabled === true);
    check('시험 체크칸을 켜면 해역 영역이 잠긴다 + 지연 선택이 보인다', u.els['zone-selection-area'].style.pointerEvents === 'none' && u.els['this-device-options'].style.display === 'block');
    u.ctx.window.toggleSendThisDevice(false);
    check('끄면 되돌아온다', u.els['check-send-all-subscribers'].disabled === false && u.els['zone-selection-area'].style.pointerEvents === 'auto' && u.els['this-device-options'].style.display === 'none');
    check('화면 마크업에 체크칸 2개가 있다', ui.includes('id="check-send-this-device"') && ui.includes('id="check-this-device-delay"'));

    console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('테스트 실행 중 예외:', e); console.log(`\n결과: ${pass} PASS / ${fail + 1} FAIL`); process.exit(1); });
