/**
 * test_vsby_imglist_check.js — 해구별 시정(RDPS 래스터) imgList 확인 실패가 상태로 드러나는지 고정한다.
 *
 * [왜 있나] 2026-10-11 21:10 KST 수집 이후 기상청 imgList 가 HTTP 200 · 0바이트를 돌려줘
 *   1시간마다 「Unexpected end of JSON input」 콘솔 한 줄만 남았다. 캐시는 옛 런을 계속 내주어
 *   /api/vsby-smallzone/status 로는 멈춘 것을 알 수 없었고, 빈 응답인지 잘린 응답인지도 몰랐다.
 *
 * [무엇을 보나] 네트워크 없이 node-fetch 를 가짜로 바꿔 끼운다(기상청을 부르지 않는다).
 *   ① 0바이트 응답 → 오류문에 「빈 응답」·HTTP 상태·0바이트가 담긴다 · 상태에 실패가 남는다
 *   ② 연속 실패 → failStreak 가 늘고 failSince 는 처음 실패 시각을 유지한다
 *   ③ HTML 같은 JSON 아닌 응답 → 「JSON 아님」 + 바이트 수
 *   ④ 정상 JSON → 실패 기록이 지워진다
 *   ⑦ 재기동(모듈 다시 불러 init)해도 연속 실패 수·첫 실패 시각이 이어진다(상태 파일 영속화, 2026-10-15)
 *
 * [실행] node local_server/scripts/test_vsby_imglist_check.js
 * [연계] ← scripts/refactor/verify_all.sh SUITES
 *        → local_server/services/vsby_smallzone.js (fetchImgList · refreshIfStale · getStatus)
 */
'use strict';

// ⑦ 영속화 검사용 — 실제 data/vsby_check_state.json 을 건드리지 않게 임시 경로를 준다(모듈 require 전에).
const os = require('os'), fsT = require('fs'), pathT = require('path');
const stateDir = fsT.mkdtempSync(pathT.join(os.tmpdir(), 'vsby-check-'));
process.env.VSBY_CHECK_STATE_FILE = pathT.join(stateDir, 'vsby_check_state.json');
// 수집 실패 알림 상태도 임시 경로로(refreshIfStale 이 collect_fail_alert 에 알린다 — 실제 data/ 를 건드리지 않게).
process.env.COLLECT_FAIL_ALERT_FILE = pathT.join(stateDir, 'collect_fail_alert.json');
// ★운영 셸(FLY_ALLOC_ID 있음)에서 돌려도 실제 관리자 푸시가 나가지 않게(검토 5): 운영 표시를 지우고,
//   그래도 불리면 드러나도록 admin_push 를 가짜로 끼워 부른 횟수를 센다(아래 ⑧).
delete process.env.FLY_ALLOC_ID;
const realPushCalls = [];
require.cache[require.resolve('../services/admin_push')] = { id: 'admin_push', filename: 'admin_push', loaded: true,
    exports: { sendAdminPush: async (t, b) => { realPushCalls.push(b); return { sent: 0, failed: 0 }; } } };

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

// ── 가짜 node-fetch: 다음 응답을 바꿔 가며 돌려준다 ──
let next = null;
const calls = [];
function fakeFetch(url) {
    calls.push(url);
    const n = next;
    return Promise.resolve({
        ok: n.status >= 200 && n.status < 300,
        status: n.status,
        headers: { get: (k) => (k.toLowerCase() === 'content-type' ? (n.ct || null) : null) },
        text: () => Promise.resolve(n.body),
        json: () => Promise.resolve(JSON.parse(n.body)),
    });
}
require.cache[require.resolve('node-fetch')] = { id: 'node-fetch', filename: 'node-fetch', loaded: true, exports: fakeFetch };

const sz = require('../services/vsby_smallzone');

// 콘솔 오류 줄은 확인만 하고 화면을 어지럽히지 않게 모은다.
const errLines = [];
const origErr = console.error;
console.error = (...a) => { errLines.push(a.join(' ')); };

(async () => {
    try {
        // ① 0바이트
        next = { status: 200, body: '', ct: null };
        let thrown = null;
        try { await sz.fetchImgList(); } catch (e) { thrown = e; }
        ok('① 0바이트 → throw', !!thrown);
        ok('① 오류문에 「빈 응답」·HTTP 200·0바이트', thrown && /빈 응답/.test(thrown.message) && /HTTP 200/.test(thrown.message) && /0바이트/.test(thrown.message), thrown && thrown.message);
        ok('① 기상청 imgList 주소를 불렀다', calls.length === 1 && /\/mdl\/rdps\/imgList$/.test(calls[0]), calls[0]);

        const before = sz.getStatus();
        ok('① 확인 전에는 lastCheckAt 이 비어 있다', before.lastCheckAt === null && before.failStreak === 0);

        await sz.refreshIfStale();
        let s = sz.getStatus();
        ok('① refreshIfStale 후 lastCheckOk=false', s.lastCheckOk === false);
        ok('① lastCheckError 에 빈 응답 사유', /빈 응답/.test(s.lastCheckError || ''), s.lastCheckError);
        ok('① failStreak=1 · failSince=lastCheckAt', s.failStreak === 1 && s.failSince && s.failSince === s.lastCheckAt);
        ok('① 콘솔에도 실패가 찍힌다', errLines.some(l => /imgList 확인 실패/.test(l) && /빈 응답/.test(l)));
        const firstFail = s.failSince;

        // ② 연속 실패
        await new Promise(r => setTimeout(r, 5));
        await sz.refreshIfStale();
        s = sz.getStatus();
        ok('② 연속 실패 → failStreak=2', s.failStreak === 2, String(s.failStreak));
        ok('② failSince 는 첫 실패 시각 유지', s.failSince === firstFail);

        // ③ JSON 아닌 응답(HTML 오류 화면 등)
        next = { status: 200, body: '<!DOCTYPE html><title>x</title>', ct: 'text/html' };
        await sz.refreshIfStale();
        s = sz.getStatus();
        ok('③ JSON 아님 → 사유·바이트 수·형식', /JSON 아님/.test(s.lastCheckError || '') && /31바이트/.test(s.lastCheckError || '') && /text\/html/.test(s.lastCheckError || ''), s.lastCheckError);
        ok('③ failStreak=3', s.failStreak === 3);

        // ⑦ 재기동해도 연속 실패 수가 이어진다(2026-10-15 사용자 지시 ⓐ — 전에는 재기동마다 0).
        //   같은 모듈을 새로 불러(= 재기동) init 만 한 상태를 본다. 가짜 node-fetch 는 그대로 남는다.
        ok('⑦ 확인할 때마다 상태 파일을 남긴다', fsT.existsSync(process.env.VSBY_CHECK_STATE_FILE));
        delete require.cache[require.resolve('../services/vsby_smallzone')];
        const restarted = require('../services/vsby_smallzone');
        ok('⑦ 새로 불러오기만 하면(init 전) 0 — init 이 되읽는 자리', restarted.getStatus().failStreak === 0);
        restarted.init();
        const r = restarted.getStatus();
        ok('⑦ 재기동(init) 뒤 failStreak=3 · failSince·사유 유지', r.failStreak === 3 && r.failSince === firstFail && /JSON 아님/.test(r.lastCheckError || '') && r.lastCheckOk === false, JSON.stringify(r));
        next = { status: 200, body: '', ct: null };
        await restarted.refreshIfStale();
        ok('⑦ 재기동 뒤 한 번 더 실패 → 4 (0 에서 다시 세지 않음)', restarted.getStatus().failStreak === 4);
        fsT.writeFileSync(process.env.VSBY_CHECK_STATE_FILE, JSON.stringify({ v: 1, at: 'x', ok: false, error: null, failStreak: -1, failSince: null }));
        delete require.cache[require.resolve('../services/vsby_smallzone')];
        const broken = require('../services/vsby_smallzone');
        broken.init();
        ok('⑦ 깨진 상태 파일은 버리고 0 부터', broken.getStatus().failStreak === 0 && broken.getStatus().lastCheckAt === null);
        next = { status: 200, body: '<!DOCTYPE html><title>x</title>', ct: 'text/html' };

        // ④ 정상 JSON(목록 비어 baseTm 없음 → 수집은 시작하지 않음) → 실패 기록 해제
        next = { status: 200, body: JSON.stringify({ code: '0000', msg: '성공', data: { fct_tm_list: [], img_list: [] } }), ct: 'application/json;charset=UTF-8' };
        await sz.refreshIfStale();
        s = sz.getStatus();
        ok('④ 정상 응답 → lastCheckOk=true · 실패 기록 지움', s.lastCheckOk === true && s.lastCheckError === null && s.failStreak === 0 && s.failSince === null, JSON.stringify(s));

        // ⑤ 정상 JSON 파싱 값
        next = { status: 200, body: JSON.stringify({ code: '0000', data: { fct_tm_list: ['2026.10.11 22:00'], img_list: ['/resources/mdl/khope/mvis/img/x/RDPS_2026101100_VIS_01.png'] } }), ct: 'application/json' };
        const il = await sz.fetchImgList();
        ok('⑤ 정상 JSON → baseTm 은 이미지 경로 RDPS_<10자리> 에서', il.baseTm === '2026101100' && il.imgs.length === 1 && il.fctTimes.length === 1, JSON.stringify(il));

        ok('⑥ 상태에 lastFctTm 칸이 있다(캐시 없으면 null)', Object.prototype.hasOwnProperty.call(s, 'lastFctTm'));
        ok('⑧ 이 시험은 관리자 푸시(sendAdminPush)를 한 번도 부르지 않는다', realPushCalls.length === 0, realPushCalls.join(' / '));
    } finally {
        console.error = origErr;
        fsT.rmSync(stateDir, { recursive: true, force: true });
    }
    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error = origErr; console.log('  ❌ 실행 오류 — ' + (e && e.stack)); console.log(`\n${pass} PASS / ${fail + 1} FAIL`); process.exit(1); });
