/**
 * test_push_auto_path_check.js — [임시] 「자동 푸시 경로 점검」이 실제 사용자에게 절대 가지 않는지 검증
 * 실행: node local_server/scripts/test_push_auto_path_check.js
 *
 * 대상: local_server/services/push_auto_path_check.js · routes/push.js(POST /api/admin/push-auto-path-check) · client/js/push/alert_push.js(버튼)
 * 사용자 요청(2026-11-20): 「자동 푸시 경로 점검 버튼 임시로 만들어보자.」
 * ★가장 중요한 것: /api/push-custom 은 adminToken 이 비면 전체 구독자에게 보낸다 → 이 점검은 주소가 없으면 그 주소를 아예 부르지 않아야 한다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} ${extra === undefined ? '' : JSON.stringify(extra)}`); }
}
const root = path.join(__dirname, '..', '..');
const chk = require('../services/push_auto_path_check');
const TOKEN = 'f'.repeat(40) + ':APA91b-fake-device-token';

function fakeFetch(map) {
    const calls = [];
    const fn = async (url, init) => {
        calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
        const r = map[url] || { status: 500, body: {} };
        if (r.throw) throw new Error(r.throw);
        return { status: r.status, json: async () => r.body };
    };
    fn.calls = calls;
    return fn;
}
const headers = () => ({ 'X-Seagnal-Internal': 'k'.repeat(64) });

(async () => {
    console.log('[1] 주소 확인 — 없거나 짧으면 서버 자신을 부르지도 않는다(빈 adminToken = 전체 발송이기 때문)');
    for (const bad of [undefined, null, '', '   ', 'short', 'x'.repeat(19), 12345, {}]) {
        const f = fakeFetch({});
        const out = await chk.run(bad, { fetchImpl: f, headers });
        check(`주소 ${JSON.stringify(bad)} → 거절, 요청 0건`, out.ok === false && f.calls.length === 0, { out, n: f.calls.length });
    }
    check('너무 긴 주소 → 거절', chk.validate('x'.repeat(5000)).ok === false);

    console.log('[2] 정상 — 특보 길은 이 휴대폰 한 대로 좁혀 부르고, 태풍 길은 제목·본문 없이 부른다');
    let f = fakeFetch({
        [chk.PUSH_CUSTOM_URL]: { status: 200, body: { success: true, successCount: 1, failCount: 0, testMode: true } },
        [chk.PUSH_TYPHOON_URL]: { status: 400, body: { error: 'title/body required' } },
    });
    let out = await chk.run('  ' + TOKEN + '  ', { fetchImpl: f, headers });
    const c = f.calls.find((x) => x.url === chk.PUSH_CUSTOM_URL);
    const t = f.calls.find((x) => x.url === chk.PUSH_TYPHOON_URL);
    check('자동 특보와 같은 주소(push_sender API_URL)', chk.PUSH_CUSTOM_URL === 'http://localhost:3001/api/push-custom' && /API_URL = 'http:\/\/localhost:3001\/api\/push-custom'/.test(fs.readFileSync(path.join(root, 'local_server', 'push_sender.js'), 'utf8')));
    check('자동 태풍과 같은 주소(typhoon_notifier PUSH_API)', chk.PUSH_TYPHOON_URL === 'http://localhost:3001/api/push-typhoon' && /PUSH_API = 'http:\/\/localhost:3001\/api\/push-typhoon'/.test(fs.readFileSync(path.join(root, 'local_server', 'services', 'typhoon_notifier.js'), 'utf8')));
    check('★특보 길에 adminToken = 이 휴대폰 주소(앞뒤 공백 정리) — 그 한 대로 좁혀진다', c && c.body.adminToken === TOKEN, c && c.body);
    check('두 요청 모두 내부 열쇠를 붙인다', c && t && c.headers['X-Seagnal-Internal'] === 'k'.repeat(64) && t.headers['X-Seagnal-Internal'] === 'k'.repeat(64));
    check('★태풍 길은 제목·본문 없이(발송이 일어나지 않는다)', t && Object.keys(t.body).length === 0, t && t.body);
    check('결과: 특보 통과·1건, 태풍 통과(400)', out.ok && out.custom.passed && out.custom.successCount === 1 && out.typhoon.passed && out.typhoon.status === 400, out);

    console.log('[3] 막힘·실패를 정확히 알린다');
    f = fakeFetch({ [chk.PUSH_CUSTOM_URL]: { status: 401, body: { code: 'ADMIN_AUTH_REQUIRED' } }, [chk.PUSH_TYPHOON_URL]: { status: 401, body: {} } });
    out = await chk.run(TOKEN, { fetchImpl: f, headers });
    check('401 → 두 길 모두 「막힘」', out.custom.passed === false && out.typhoon.passed === false, out);
    f = fakeFetch({ [chk.PUSH_CUSTOM_URL]: { status: 200, body: { success: true, successCount: 0, message: '관리자 토큰과 일치하는 구독자가 없습니다.' } }, [chk.PUSH_TYPHOON_URL]: { status: 400, body: {} } });
    out = await chk.run(TOKEN, { fetchImpl: f, headers });
    check('길은 열렸지만 이 휴대폰이 구독자에 없음 → 통과 · 0건 · 까닭', out.custom.passed && out.custom.successCount === 0 && /일치하는 구독자가 없습니다/.test(out.custom.message), out.custom);
    f = fakeFetch({ [chk.PUSH_CUSTOM_URL]: { throw: 'ECONNREFUSED' }, [chk.PUSH_TYPHOON_URL]: { status: 200, body: {} } });
    out = await chk.run(TOKEN, { fetchImpl: f, headers });
    check('요청 자체 실패 → 막힘 + 까닭', out.custom.passed === false && /ECONNREFUSED/.test(out.custom.message), out.custom);
    check('태풍 길이 200 이면(제목 없이도 받아 버림 = 점검이 틀림) 통과로 보지 않는다', out.typhoon.passed === false, out.typhoon);

    console.log('[4] 연결');
    const push = fs.readFileSync(path.join(root, 'local_server', 'routes', 'push.js'), 'utf8');
    check('라우트는 관리자 열쇠가 있어야 부를 수 있다', /router\.post\('\/api\/admin\/push-auto-path-check',\s*\(req, res, next\) => require\('\.\.\/services\/admin_auth'\)\.requireAdminToken\(req, res, next\)/.test(push));
    check('라우트가 주소를 먼저 확인하고(400), 자동 발송과 같은 내부 열쇠를 넘긴다', /check\.validate\(req\.body && req\.body\.token\)/.test(push) && /headers: require\('\.\.\/services\/internal_push_auth'\)\.internalHeaders/.test(push));
    const ap = fs.readFileSync(path.join(root, 'client', 'js', 'push', 'alert_push.js'), 'utf8');
    check('버튼이 있고, 이 휴대폰 주소가 없으면 서버에 요청하지 않는다', /onclick="window\.runAutoPushPathCheck\(this\)"/.test(ap) && /var token = thisDevicePushToken\(\);\s*if \(!token\) \{ alert\(/.test(ap));
    check('index2.html 이 바뀐 alert_push.js 를 새로 받는다', /alert_push\.js\?v=AutoPathCheck_20261120/.test(fs.readFileSync(path.join(root, 'client', 'index2.html'), 'utf8')));

    console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('테스트 실행 중 예외:', e); console.log(`\n결과: ${pass} PASS / ${fail + 1} FAIL`); process.exit(1); });
