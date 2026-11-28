/**
 * test_push_route_auth.js — 푸시 발송·발송 기록 삭제 주소가 「관리자 또는 서버 자신」만 받는지 검증
 * 실행: node local_server/scripts/test_push_route_auth.js
 *
 * 대상: services/internal_push_auth.js · routes/push.js(네 주소의 문지기) · push_sender.js · services/typhoon_notifier.js · client/js/admin/admin.js(fetch 래퍼)
 * 사용자 확정(2026-11-20): 「이것 반영하고자 하는데, 주의할 점이 발생하지 않도록 그 부분에 대해서는 재검토 할 수 있도록 해줘.」
 *   주의할 점 = 서버의 자동 특보 푸시(push_sender → /api/push-custom)·자동 태풍 푸시(typhoon_notifier → /api/push-typhoon)가
 *   같은 주소를 서버 안에서 부른다 — 그 길이 막히면 안 된다.
 * ★실제 발송을 하지 않는다: 진짜 라우터에는 "열쇠 없음 → 401(처리 코드에 닿기 전에 막힘)"만 보낸다.
 *   열쇠가 맞을 때의 통과는 같은 문지기를 붙인 시험용 주소로 본다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} ${extra === undefined ? '' : JSON.stringify(extra)}`); }
}
const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/** app 을 잠깐 띄워 요청 하나를 보낸다. */
async function call(app, method, url, headers = {}, body) {
    const srv = app.listen(0);
    await new Promise((r) => srv.once('listening', r));
    const port = srv.address().port;
    try {
        return await new Promise((resolve, reject) => {
            const data = body === undefined ? null : JSON.stringify(body);
            const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: Object.assign(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}, headers) }, (res) => {
                let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (_) { /* 본문이 JSON 이 아니면 그대로 둔다 */ } resolve({ status: res.statusCode, body: j }); });
            });
            req.on('error', reject);
            if (data) req.write(data);
            req.end();
        });
    } finally { srv.close(); }
}

(async () => {
    const ipa = require('../services/internal_push_auth');

    console.log('[1] 문지기 — 내부 열쇠는 통과, 열쇠 없음·틀린 열쇠·틀린 관리자 열쇠는 401');
    const probe = express();
    probe.use(express.json());
    let reached = 0;
    probe.post('/probe', ipa.requireAdminOrInternal, (req, res) => { reached++; res.json({ ok: true }); });
    let r = await call(probe, 'POST', '/probe', ipa.internalHeaders(), {});
    check('내부 열쇠 → 통과(자동 특보·태풍 푸시 길)', r.status === 200 && reached === 1, r);
    r = await call(probe, 'POST', '/probe', {}, {});
    check('열쇠 없음 → 401, 처리 코드에 안 닿는다', r.status === 401 && reached === 1 && r.body && r.body.code === 'ADMIN_AUTH_REQUIRED', r);
    r = await call(probe, 'POST', '/probe', { [ipa.HEADER]: 'x'.repeat(64) }, {});
    check('같은 길이의 틀린 내부 열쇠 → 401', r.status === 401 && reached === 1, r);
    r = await call(probe, 'POST', '/probe', { [ipa.HEADER]: '' }, {});
    check('빈 내부 열쇠 → 401', r.status === 401 && reached === 1, r);
    r = await call(probe, 'POST', '/probe', { 'X-Admin-Token': 'not-a-real-token' }, {});
    check('틀린 관리자 열쇠 → 401', r.status === 401 && reached === 1, r);
    const h = ipa.internalHeaders()[ipa.HEADER];
    check('내부 열쇠는 64자 무작위(32바이트) — 추측할 수 없다', /^[0-9a-f]{64}$/.test(h), h && h.length);
    check('내부 열쇠는 매번 같은 프로세스 안에서 같다(자동 발송 코드와 문지기가 같은 값을 본다)', ipa.internalHeaders()[ipa.HEADER] === h);

    console.log('[2] 진짜 라우터(routes/push.js) — 네 주소가 열쇠 없이 막힌다(실제 발송·삭제는 일어나지 않는다)');
    const histFile = path.join(root, 'local_server', 'data', 'custom_push_history.json');
    const histBefore = fs.existsSync(histFile) ? fs.readFileSync(histFile, 'utf8') : null;
    const app = express();
    app.use(express.json());
    app.use(require('../routes/push'));
    for (const [m, u, b] of [
        ['POST', '/api/push-custom', { title: 't', content: 'c', targetZones: ['all'], sendToAllSubscribers: true }],
        ['POST', '/api/push-typhoon', { title: 't', body: 'b' }],
        ['DELETE', '/api/push-history/1', undefined],
        ['DELETE', '/api/push-history', {}],
    ]) {
        r = await call(app, m, u, {}, b);
        check(`${m} ${u} 열쇠 없음 → 401`, r.status === 401 && r.body && r.body.code === 'ADMIN_AUTH_REQUIRED', r);
        r = await call(app, m, u, { 'X-Admin-Token': 'forged' }, b);
        check(`${m} ${u} 지어낸 관리자 열쇠 → 401`, r.status === 401, r.status);
    }
    const histAfter = fs.existsSync(histFile) ? fs.readFileSync(histFile, 'utf8') : null;
    check('막힌 요청은 발송 기록 파일을 건드리지 않았다', histBefore === histAfter);
    r = await call(app, 'GET', '/api/push-history');
    check('조회(GET /api/push-history)는 종전대로 열려 있다(이번 범위 밖)', r.status === 200, r.status);

    console.log('[3] 연결 — 자동 발송 코드가 내부 열쇠를 붙이고, 관리자 화면이 관리자 열쇠를 붙인다');
    const push = read('local_server/routes/push.js');
    for (const [m, u] of [['post', '/api/push-custom'], ['post', '/api/push-typhoon'], ['delete', '/api/push-history/:id'], ['delete', '/api/push-history']]) {
        check(`push.js ${m.toUpperCase()} ${u} 에 문지기가 붙어 있다`, new RegExp(`router\\.${m}\\('${u.replace(/[/:]/g, (c) => '\\' + c)}', requireAdminOrInternal,`).test(push));
    }
    const sender = read('local_server/push_sender.js');
    check('push_sender.js(자동 특보 푸시) → /api/push-custom 에 내부 열쇠를 붙인다', /API_URL = 'http:\/\/localhost:3001\/api\/push-custom'/.test(sender) && /internal_push_auth'\)\.internalHeaders\(\)/.test(sender));
    const typhoon = read('local_server/services/typhoon_notifier.js');
    check('typhoon_notifier.js(자동 태풍 푸시) → /api/push-typhoon 에 내부 열쇠를 붙인다', /PUSH_API = 'http:\/\/localhost:3001\/api\/push-typhoon'/.test(typhoon) && /internal_push_auth'\)\.internalHeaders\(\)/.test(typhoon));
    check('typhoon_notifier.js 가 거절(401 등)을 「성공 0」으로 삼키지 않는다', /if \(!res\.ok\) \{ console\.error\(`\[typhoon-notify\] 발송 거절/.test(typhoon));
    const admin = read('client/js/admin/admin.js');
    check('관리자 화면 fetch 래퍼가 /api/push-custom·push-typhoon·push-history 에도 관리자 열쇠를 붙인다', /isPushAdminApi = url\.indexOf\('\/api\/push-custom'\) !== -1 \|\| url\.indexOf\('\/api\/push-typhoon'\) !== -1 \|\| url\.indexOf\('\/api\/push-history'\) !== -1/.test(admin) && /\|\| isPushAdminApi;/.test(admin));
    const promo = read('client/js/notice/board/promo.js');
    check('관리자 모드 비밀번호 없는 진입은 서버 열쇠가 있을 때만(없으면 로그인 창) — 열쇠 없이 들어가 발송·삭제가 401 로 막히지 않게(독립 검토 A)', /const hasServerKey = typeof getStoredAdminToken === 'function' && !!getStoredAdminToken\(\);\s*if \(isAdminMode && hasServerKey\) \{/.test(promo));
    const ap = read('client/js/push/alert_push.js');
    check('발송 기록 삭제 3종이 거절(401 등)을 화면에 알린다(종전에는 아무 표시 없음)', (ap.match(/\} else \{\s*_alertHistoryDeleteFailed\(res\);\s*\}/g) || []).length === 3 && /res\.status === 401\) alert\('관리자 로그인이 필요합니다/.test(ap));
    check('index2.html 이 바뀐 promo.js·alert_push.js 를 새로 받는다(캐시 번호)', /promo\.js\?v=PushAuth_20261120/.test(read('client/index2.html')) && /alert_push\.js\?v=(PushAuth|AutoPathCheck)_20261120/.test(read('client/index2.html')));
    check('index2.html 이 바뀐 admin.js 를 새로 받는다(캐시 번호)', /js\/admin\/admin\.js\?v=(PushAuth_20261120|Maint_20261123b?|ZoneSplit2b_20261128)/.test(/* 2026-11-23 점검 목록 개편으로 번호가 다시 올랐다 */ read('client/index2.html')));
    // 서버 안에서 이 주소들을 HTTP 로 부르는 곳이 두 곳뿐인지 — 새로 생기면 내부 열쇠를 빠뜨리지 않았는지 이 시험이 알려 준다.
    const offenders = [];
    const walk = (dir) => { for (const n of fs.readdirSync(dir)) { if (n === 'node_modules' || n === 'knowledge' || n === 'scripts' || n.startsWith('.')) continue; const p = path.join(dir, n); const st = fs.statSync(p); if (st.isDirectory()) walk(p); else if (/\.js$/.test(n)) { const s = fs.readFileSync(p, 'utf8'); if (/localhost:\d+\/api\/(push-custom|push-typhoon|push-history)/.test(s)) offenders.push(path.relative(root, p)); } } };
    walk(path.join(root, 'local_server'));
    check('서버 안에서 이 주소를 부르는 곳은 push_sender.js·typhoon_notifier.js·[임시] push_auto_path_check.js 뿐(모두 내부 열쇠)', JSON.stringify(offenders.sort()) === JSON.stringify(['local_server/push_sender.js', 'local_server/services/push_auto_path_check.js', 'local_server/services/typhoon_notifier.js']), offenders);

    console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('테스트 실행 중 예외:', e); console.log(`\n결과: ${pass} PASS / ${fail + 1} FAIL`); process.exit(1); });
