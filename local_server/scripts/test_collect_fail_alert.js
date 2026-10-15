/**
 * test_collect_fail_alert.js — 이안류·기상청 MMIS 수집 실패 관리자 푸시(services/collect_fail_alert)를 고정한다.
 *
 * [왜 있나] 사용자 결정 2026-10-15 「이안류, mmis는 데이터를 호출했을 때 받아올 수 없다면 그 때 알려줘
 *   보통 천기가 그런 경우가 많아.」 + 「추천하는 방식으로 하고. 고르는건 나로 하자.」(천기 = (나) 연속 3번).
 *   실패가 시작될 때 1번, 복구 때 1번 — 같은 실패가 이어지는 동안은 다시 보내지 않는다.
 *
 * [무엇을 보나] 네트워크·실제 푸시 없이(가짜 send 주입, 고정 시계, 임시 파일).
 *   A. 오류 분류(수집기들이 실제로 만드는 오류문 꼴)
 *   B. 알림 규칙 표 — 언제 보내고 언제 안 보내나
 *   C. 대기 중 상태 변화 표(설계 문서 00_docs/operations/collect-fail-alert.md §4) — 행마다 1:1
 *   D. 개발 환경에서는 실제 푸시를 부르지 않는다 / 운영에서는 sendAdminPush 결과로 전달 여부를 정한다
 *   E. 수집기 연결 — 너울·시정은 가짜 node-fetch 로 실제 함수를 돌려 기록을 확인, 나머지는 소스에 보고 호출이 있는지
 *
 * [실행] node local_server/scripts/test_collect_fail_alert.js
 * [연계] ← scripts/refactor/verify_all.sh SUITES
 *        → services/collect_fail_alert.js · services/swell_smallzone.js · services/vsby_smallzone.js ·
 *          services/data_collection_status.js(records 를 읽는 쪽) · scheduler.js · marine_warning_crawler.js
 */
'use strict';
const fs = require('fs'),
    os = require('os'),
    path = require('path');

// 실제 data/ 와 실제 푸시를 건드리지 않게 — 모듈 require 전에.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'collect-alert-'));
process.env.COLLECT_FAIL_ALERT_FILE = path.join(tmp, 'singleton.json');
process.env.VSBY_CHECK_STATE_FILE = path.join(tmp, 'vsby_check_state.json');
delete process.env.FLY_ALLOC_ID;

let pass = 0,
    fail = 0;
function ok(name, cond, extra) {
    // console.log 를 잠시 막는 구간이 있어 원래 함수로 찍는다
    if (cond) { pass++; orig.log('  ✅ ' + name); }
    else { fail++; orig.log('  ❌ ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 콘솔은 모아서 확인만(화면을 어지럽히지 않게)
const logs = [];
const orig = { log: console.log, warn: console.warn, error: console.error };
const quiet = () => {
    console.warn = (...a) => logs.push('W ' + a.join(' '));
    console.error = (...a) => logs.push('E ' + a.join(' '));
};
quiet();

// ── 가짜 node-fetch(너울·시정 연결 검사용) — URL 로 응답을 고른다 ──
const routes = [];
function fakeFetch(url) {
    const r = routes.find((x) => x.match.test(url));
    if (!r) return Promise.reject(new Error('검사에 없는 주소'));
    if (r.reject) return Promise.reject(r.reject);
    return Promise.resolve({
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        headers: { get: () => 'application/json' },
        text: () => Promise.resolve(r.body),
        json: () => Promise.resolve(JSON.parse(r.body)),
    });
}
require.cache[require.resolve('node-fetch')] = { id: 'node-fetch', filename: 'node-fetch', loaded: true, exports: fakeFetch };

// ── 가짜 admin_push(운영 경로 검사용) — firebase 를 불러오지 않게 미리 끼운다 ──
const pushCalls = [];
let pushResult = { sent: 1, failed: 0 };
require.cache[require.resolve('../services/admin_push')] = {
    id: 'admin_push', filename: 'admin_push', loaded: true,
    exports: { sendAdminPush: async (t, b, d) => { pushCalls.push({ t, b, d }); return pushResult; } },
};

const A = require('../services/collect_fail_alert');
const KST = (s) => Date.parse(s + '+09:00');

/** 가짜 발송기: 호출을 기록하고, plan 에서 결과를 꺼낸다(없으면 전달됨). */
function fakeSender() {
    const calls = [],
        plan = [];
    let gate = null;
    const send = async (title, body, data) => {
        calls.push({ title, body, data });
        if (gate) await gate;
        const p = plan.shift();
        if (p instanceof Error) throw p;
        return p || { delivered: true };
    };
    return { send, calls, plan, hold() { let open; gate = new Promise((r) => (open = r)); return () => { gate = null; open(); }; } };
}
let fileNo = 0;
function make(opts = {}) {
    const file = opts.file || path.join(tmp, 'a' + ++fileNo + '.json');
    const clock = { now: KST('2026-10-16T03:00:00') };
    const s = opts.sender || fakeSender();
    const al = A.createAlerter({ file, clock: () => clock.now, send: s.send });
    return { al, s, clock, file };
}

(async () => {
    try {
        console.log('── A. 오류 분류 — 원문(주소·키)은 넣지 않는다 ──');
        const R = A.reasonOf;
        const cases = [
            [new Error('imgList 빈 응답 (HTTP 200, 0바이트, content-type=없음)'), '빈 응답'],
            [new Error('imgList JSON 아님 (HTTP 200, 12바이트, content-type=text/html): Unexpected token <'), '응답 해석 실패'],
            [new Error('imgList 503'), 'HTTP 503'],
            [new Error('forecast-times 502'), 'HTTP 502'],
            [new Error('HTTP 500'), 'HTTP 500'],
            [Object.assign(new SyntaxError('Unexpected end of JSON input'), {}), '빈 응답 또는 잘린 응답'],
            [Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }), '시간초과'],
            [Object.assign(new Error('network timeout at: https://marine.kma.go.kr/x'), { type: 'request-timeout' }), '시간초과'],
            [new Error('request to https://apis.data.go.kr/x?serviceKey=SECRET failed, reason: getaddrinfo ENOTFOUND apis.data.go.kr'), '연결 실패'],
            [new Error('API code=9999 msg=오류'), 'API 오류 코드 9999'],
            [new Error('API 결과코드=22'), 'API 오류 코드 22'],
            [new Error('marine endpoint 부분 실패: warnList: GET /mmis/warn/list HTTP 503 | warnReady: timeout'), '시간초과'],
            [new Error('marine endpoint 부분 실패: warnList: GET /mmis/warn/list HTTP 503'), 'HTTP 503'],
            [new Error('무엇인지 모를 오류'), '기타 오류'],
        ];
        for (const [e, want] of cases) ok('분류 「' + e.message.slice(0, 40) + '」 → ' + want, R(e) === want, R(e));
        ok('분류 결과에 키·주소가 섞이지 않는다', !/SECRET|https?:/.test(cases.map(([e]) => R(e)).join()));
        ok('시정 기준 3회 = 오류현황 VSBY_FAIL_STREAK (둘이 어긋나지 않게)', A.ITEMS.visibility.threshold === require('../services/risk_history_sources').VSBY_FAIL_STREAK);
        ok('대상 9개 = 사용자 결정 목록(이안류·특보·강풍·너울·시정·관측 4종)',
            eq(Object.keys(A.ITEMS).sort(), ['gale', 'marineBuoys', 'marineLhBuoys', 'marineVs', 'marineWhBuoys', 'ripCurrent', 'swell', 'visibility', 'warnings']));
        const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'data_collection_manifest.json'), 'utf8'));
        ok('대상 열쇠는 모두 데이터 수집현황 목록표 id 다', Object.keys(A.ITEMS).every((id) => manifest.items.some((i) => i.id === id)));
        ok('시각은 KST 로 쓴다(UTC 18:00 → 10/16 03:00)', A.fmtKst(Date.parse('2026-10-15T18:00:00Z')) === '10/16 03:00', A.fmtKst(Date.parse('2026-10-15T18:00:00Z')));

        console.log('\n── B. 알림 규칙 ──');
        {
            const { al, s, clock } = make();
            let r = await al.report('marineBuoys', { ok: false, error: new Error('HTTP 503') });
            ok('B1 첫 실패(기준 1) → 실패 푸시 1통', s.calls.length === 1 && eq(r.sent, ['fail']));
            ok('B1 문장 = 「기상부이 관측 (기상청 MMIS) 수집 실패 — HTTP 503, 10/16 03:00부터」',
                s.calls[0].body === '기상부이 관측 (기상청 MMIS) 수집 실패 — HTTP 503, 10/16 03:00부터' && s.calls[0].title === '자료 수집 실패', s.calls[0].body);
            ok('B1 푸시 data 에 항목·단계', s.calls[0].data.item === 'marineBuoys' && s.calls[0].data.phase === 'fail');
            clock.now = KST('2026-10-16T03:13:00');
            await al.report('marineBuoys', { ok: false, error: new Error('HTTP 503') });
            clock.now = KST('2026-10-16T04:03:00');
            await al.report('marineBuoys', { ok: false, error: new Error('HTTP 502') });
            ok('B2 같은 실패가 이어지는 동안 다시 보내지 않는다(분류가 바뀌어도)', s.calls.length === 1);
            ok('B2 기록: 연속 3회 · 처음 실패 시각 유지 · 마지막 분류', (() => { const x = al.records().marineBuoys; return x.streak === 3 && x.since === new Date(KST('2026-10-16T03:00:00')).toISOString() && x.reason === 'HTTP 502'; })(), JSON.stringify(al.records().marineBuoys));
            clock.now = KST('2026-10-16T06:03:00');
            r = await al.report('marineBuoys', { ok: true });
            ok('B3 다시 받으면 복구 푸시 1통 「… 수집 복구 — 10/16 06:03」',
                s.calls.length === 2 && s.calls[1].body === '기상부이 관측 (기상청 MMIS) 수집 복구 — 10/16 06:03' && s.calls[1].title === '자료 수집 복구' && eq(r.sent, ['recover']), s.calls[1] && s.calls[1].body);
            await al.report('marineBuoys', { ok: true });
            ok('B4 성공이 이어지면 아무것도 안 보낸다', s.calls.length === 2);
            ok('B4 기록이 정상으로 돌아왔다', al.records().marineBuoys.streak === 0 && al.records().marineBuoys.notified === false);
        }
        {
            const { al, s } = make();
            for (let i = 1; i <= 2; i++) await al.report('visibility', { ok: false, error: new Error('imgList 빈 응답 (HTTP 200, 0바이트)'), streak: i, since: '2026-10-15T16:00:00.000Z' });
            ok('B5 시정 예측: 1·2번째 실패는 안 보낸다', s.calls.length === 0);
            await al.report('visibility', { ok: false, error: new Error('imgList 빈 응답 (HTTP 200, 0바이트)'), streak: 3, since: '2026-10-15T16:00:00.000Z' });
            ok('B5 3번째 실패에 1통 — 「시정 예측 (기상청 MMIS) 수집 실패 — 빈 응답, 10/16 01:00부터」(처음 실패 시각은 vsby failSince)',
                s.calls.length === 1 && s.calls[0].body === '시정 예측 (기상청 MMIS) 수집 실패 — 빈 응답, 10/16 01:00부터', s.calls[0] && s.calls[0].body);
            await al.report('visibility', { ok: false, error: new Error('imgList 빈 응답'), streak: 4, since: '2026-10-15T16:00:00.000Z' });
            ok('B5 4번째부터는 안 보낸다', s.calls.length === 1);
            await al.report('visibility', { ok: true });
            ok('B5 성공하면 복구 1통', s.calls.length === 2 && /시정 예측 \(기상청 MMIS\) 수집 복구 — 10\/16 03:00/.test(s.calls[1].body), s.calls[1] && s.calls[1].body);
        }
        {
            const { al, s } = make();
            await al.report('visibility', { ok: false, error: new Error('imgList 503'), streak: 1 });
            await al.report('visibility', { ok: false, error: new Error('imgList 503'), streak: 2 });
            await al.report('visibility', { ok: true });
            ok('B6 시정 예측 2번 실패 뒤 성공 → 실패 알림을 안 보냈으니 복구 알림도 없다', s.calls.length === 0);
            ok('B6 기록은 정상', al.records().visibility.streak === 0);
        }
        {   // B10 (검토 1) 알린 뒤 vsby 연속 실패 수가 0 부터 다시 셈(상태 파일 손상·저장 실패) — 복구는 성공 보고로만
            const { al, s, clock } = make();
            const E = new Error('imgList 빈 응답 (HTTP 200, 0바이트)');
            for (let i = 1; i <= 3; i++) await al.report('visibility', { ok: false, error: E, streak: i, since: '2026-10-15T16:00:00.000Z' });
            for (let i = 1; i <= 3; i++) {
                clock.now += 3600e3;
                await al.report('visibility', { ok: false, error: E, streak: i, since: new Date(clock.now).toISOString() });
            }
            ok('B10 알린 뒤 연속 수가 1·2·3 으로 다시 와도 「복구」·「실패」를 더 보내지 않는다', s.calls.length === 1, s.calls.map((c) => c.body).join(' / '));
            clock.now += 3600e3;
            await al.report('visibility', { ok: true });
            ok('B10 성공 보고가 와야 복구 1통 — 시각이 있다(「시각 모름」 없음)', s.calls.length === 2 && /수집 복구 — 10\/16 07:00$/.test(s.calls[1].body), s.calls[1] && s.calls[1].body);
            ok('B10 이 경로에서 「시각 모름」 문장이 한 번도 나가지 않았다', !s.calls.some((c) => /시각 모름/.test(c.body)));
        }
        {
            const { al, s } = make();
            await al.report('gale', { ok: false, error: new Error('timeout') });
            await al.report('warnings', { ok: false, error: new Error('timeout') });
            ok('B7 특보·강풍은 같은 호출 — 푸시는 특보 1통에 둘을 담는다', s.calls.length === 1 && s.calls[0].body.startsWith('해상 특보·육상 강풍특보 (기상청 MMIS) 수집 실패 — 시간초과'), s.calls.map((c) => c.body).join(' / '));
            ok('B7 강풍은 기록만 남는다(수집현황 카드용)', al.records().gale.streak === 1 && al.records().gale.notified === false);
            await al.report('ripCurrent', { ok: false, error: new Error('API 결과코드=30') });
            ok('B8 이안류 이름은 목록표 그대로', s.calls[1].body === '이안류 지수 (국립해양조사원·공공데이터포털) 수집 실패 — API 오류 코드 30, 10/16 03:00부터', s.calls[1] && s.calls[1].body);
            const r = await al.report('없는항목', { ok: false });
            ok('B9 모르는 항목은 던지지 않고 콘솔에 남긴다', eq(r.sent, []) && logs.some((l) => /모르는 항목/.test(l)));
        }

        console.log('\n── C. 대기 중 상태 변화 표 ──');
        {   // C1 실패 알림 후 재기동
            const m = make();
            await m.al.report('swell', { ok: false, error: new Error('forecast-times 503') });
            const s2 = fakeSender();
            const al2 = A.createAlerter({ file: m.file, clock: () => m.clock.now, send: s2.send });
            await al2.report('swell', { ok: false, error: new Error('forecast-times 503') });
            ok('C1 실패 알림 후 재기동 → 같은 실패를 다시 보내지 않는다', m.s.calls.length === 1 && s2.calls.length === 0);
            await al2.report('swell', { ok: true });
            ok('C1 재기동 뒤 복구 → 복구 1통(알렸던 것을 기억)', s2.calls.length === 1 && /너울 위험등급 \(기상청 MMIS\) 수집 복구/.test(s2.calls[0].body), s2.calls[0] && s2.calls[0].body);
        }
        {   // C2 실패 중 재기동(기준 미달 상태에서)
            const m = make();
            await m.al.report('visibility', { ok: false, error: new Error('imgList 빈 응답'), streak: 2, since: '2026-10-15T16:00:00.000Z' });
            const s2 = fakeSender();
            const al2 = A.createAlerter({ file: m.file, clock: () => m.clock.now, send: s2.send });
            await al2.report('visibility', { ok: false, error: new Error('imgList 빈 응답'), streak: 3, since: '2026-10-15T16:00:00.000Z' });
            ok('C2 실패 중(2회) 재기동 → 재기동 뒤 3번째에 1통(영속 failStreak 로 이어 셈)', m.s.calls.length === 0 && s2.calls.length === 1);
            // 시정 말고(자체 셈) 항목도 재기동을 넘어 연속 수를 잇는다
            await m.al.report('marineVs', { ok: false, error: new Error('HTTP 500') });
            const al3 = A.createAlerter({ file: m.file, clock: () => m.clock.now, send: fakeSender().send });
            await al3.report('marineVs', { ok: false, error: new Error('HTTP 500') });
            ok('C2 자체로 세는 항목도 재기동 뒤 연속 수를 잇는다(1 → 2)', al3.records().marineVs.streak === 2);
        }
        {   // C3 복구 직후 재실패
            const { al, s, clock } = make();
            await al.report('warnings', { ok: false, error: new Error('timeout') });
            clock.now = KST('2026-10-16T03:05:00');
            await al.report('warnings', { ok: true });
            clock.now = KST('2026-10-16T03:06:00');
            await al.report('warnings', { ok: false, error: new Error('HTTP 503') });
            ok('C3 복구 직후 재실패 → 다시 실패 1통(상태를 사건처럼 지우지 않는다)', s.calls.length === 3 && /수집 실패 — HTTP 503, 10\/16 03:06부터/.test(s.calls[2].body), s.calls.map((c) => c.body).join(' / '));
        }
        {   // C4 푸시 발송 자체 실패(전달 0건) → 다음 보고 때 다시
            const { al, s } = make();
            s.plan.push({ delivered: false, error: '전달 0건(기기 없음·Firebase 미초기화·발송 오류)' });
            await al.report('marineWhBuoys', { ok: false, error: new Error('HTTP 503') });
            const r1 = al.records().marineWhBuoys;
            ok('C4 미전달이면 「알렸다」로 치지 않는다', r1.notified === false && /전달 0건/.test(r1.pushError || ''), JSON.stringify(r1));
            ok('C4 미전달은 콘솔에 남는다(조용히 삼키지 않음)', logs.some((l) => /푸시 미전달/.test(l) && /marineWhBuoys/.test(l)));
            await al.report('marineWhBuoys', { ok: false, error: new Error('HTTP 503') });
            ok('C4 다음 실패 보고 때 다시 보내 전달 → 그 뒤로는 안 보냄', s.calls.length === 2 && al.records().marineWhBuoys.notified === true && al.records().marineWhBuoys.pushError === null);
            await al.report('marineWhBuoys', { ok: false, error: new Error('HTTP 503') });
            ok('C4 전달된 뒤 같은 실패 → 더 보내지 않음', s.calls.length === 2);
        }
        {   // C4b 발송 함수가 예외를 던짐
            const { al, s } = make();
            s.plan.push(new Error('FCM 연결 끊김'));
            await al.report('marineLhBuoys', { ok: false, error: new Error('HTTP 503') });
            ok('C4b 발송 예외 → 수집 쪽으로 던지지 않고 기록', /발송 예외: FCM 연결 끊김/.test(al.records().marineLhBuoys.pushError || ''), al.records().marineLhBuoys.pushError);
            await al.report('marineLhBuoys', { ok: true });
            ok('C4b 실패 알림이 전달된 적 없으면 복구 알림도 없다', s.calls.length === 1);
            ok('C4b 그 뒤 성공하면 더 보낼 푸시가 없으니 「미전달」 표시를 지운다', al.records().marineLhBuoys.pushError === null, al.records().marineLhBuoys.pushError);
        }
        {   // C4c 복구 알림 미전달 → 다시 실패 / 다시 성공
            const { al, s, clock } = make();
            await al.report('ripCurrent', { ok: false, error: new Error('HTTP 500') });
            clock.now = KST('2026-10-16T05:05:00');
            s.plan.push({ delivered: false, error: '전달 0건' });
            await al.report('ripCurrent', { ok: true });
            ok('C4c 복구 알림 미전달 → 관리자는 아직 「실패 중」으로 안다(notified 유지)', al.records().ripCurrent.notified === true && s.calls.length === 2);
            clock.now = KST('2026-10-16T05:35:00');
            await al.report('ripCurrent', { ok: true });
            ok('C4c 다음 성공 때 다시 보내고, 시각은 처음 다시 받은 05:05', s.calls.length === 3 && /수집 복구 — 10\/16 05:05$/.test(s.calls[2].body), s.calls[2] && s.calls[2].body);
            // 미전달 뒤 성공이 아니라 실패가 오면: 관리자 지식(실패 중)이 맞으므로 아무것도 안 보낸다
            await al.report('ripCurrent', { ok: false, error: new Error('HTTP 500') });
            s.plan.push({ delivered: false, error: '전달 0건' });
            await al.report('ripCurrent', { ok: true });
            const n = s.calls.length;
            await al.report('ripCurrent', { ok: false, error: new Error('HTTP 500') });
            ok('C4c 복구 알림 미전달 뒤 다시 실패 → 보내지 않음(복구·실패 두 통을 늦게 보내지 않는다)', s.calls.length === n && al.records().ripCurrent.notified === true);
        }
        {   // C5 두 항목 동시 실패 — 같은 파일을 서로 덮어쓰지 않는다
            const { al, s, file, clock } = make();
            const release = s.hold();
            const p = Promise.all(['marineBuoys', 'marineWhBuoys', 'marineLhBuoys', 'marineVs'].map((id) => al.report(id, { ok: false, error: new Error('HTTP 503') })));
            await new Promise((r) => setImmediate(r));
            release();
            await p;
            ok('C5 동시에 실패한 4항목 → 각 1통(4통)', s.calls.length === 4);
            const after = A.createAlerter({ file, clock: () => clock.now, send: fakeSender().send }).records();
            ok('C5 파일에 4항목 모두 「알렸다」로 남는다(덮어쓰기 없음)', ['marineBuoys', 'marineWhBuoys', 'marineLhBuoys', 'marineVs'].every((id) => after[id] && after[id].notified === true), JSON.stringify(after));
        }
        {   // C6 실패 알림을 보내는 사이 복구
            const { al, s } = make();
            const release = s.hold();
            const p = al.report('swell', { ok: false, error: new Error('wfs 500') });
            await new Promise((r) => setImmediate(r));
            await al.report('swell', { ok: true });
            ok('C6 보내는 중 들어온 성공은 기다렸다가 처리(아직 1통)', s.calls.length === 1);
            release();
            await p;
            ok('C6 실패 알림이 전달된 뒤 곧바로 복구 1통 — 「실패」만 남지 않는다', s.calls.length === 2 && s.calls[1].data.phase === 'recover' && al.records().swell.notified === false, s.calls.map((c) => c.data.phase).join(','));
            ok('C6 그 복구 알림의 시각 = 보내는 중 들어온 성공 시각(10/16 03:00)', /수집 복구 — 10\/16 03:00$/.test(s.calls[1].body), s.calls[1] && s.calls[1].body);
        }
        {   // C7 같은 항목 실패 보고 둘이 동시에(정시 수집 + 화면 요청 수집)
            const { al, s } = make();
            const release = s.hold();
            const p = Promise.all([al.report('marineBuoys', { ok: false, error: new Error('HTTP 503') }), al.report('marineBuoys', { ok: false, error: new Error('HTTP 503') })]);
            await new Promise((r) => setImmediate(r));
            release();
            await p;
            ok('C7 같은 항목 동시 실패 2건 → 1통', s.calls.length === 1 && al.records().marineBuoys.streak === 2);
        }
        {   // C8 상태 파일 손상
            const file = path.join(tmp, 'broken.json');
            fs.writeFileSync(file, '{깨짐');
            const { al, s } = make({ file });
            await al.report('marineVs', { ok: false, error: new Error('HTTP 503') });
            ok('C8 손상된 상태 파일 → 콘솔에 남기고 처음부터(실패 1통)', s.calls.length === 1 && logs.some((l) => /상태 파일을 읽지 못해/.test(l)));
            ok('C8 다시 쓴 파일은 정상 형식', JSON.parse(fs.readFileSync(file, 'utf8')).v === 1);
        }
        {   // C8b 알린 뒤 상태 파일이 손상되고 첫 보고가 성공 — 「알렸다」가 사라져 복구 알림이 가지 않는다(설계 문서 C8 에 적은 한계)
            const m = make();
            await m.al.report('marineVs', { ok: false, error: new Error('HTTP 503') });
            fs.writeFileSync(m.file, '{깨짐');
            const s2 = fakeSender();
            const al2 = A.createAlerter({ file: m.file, clock: () => m.clock.now, send: s2.send });
            await al2.report('marineVs', { ok: true });
            ok('C8b 손상 뒤 첫 보고가 성공이면 복구 알림이 없다(한계 — 문서 C8)', m.s.calls.length === 1 && s2.calls.length === 0);
        }
        {   // C9 상태 파일을 쓸 수 없음 → 알림은 가고 콘솔에 남는다
            const blocker = path.join(tmp, 'not-a-dir');
            fs.writeFileSync(blocker, 'x');
            const { al, s } = make({ file: path.join(blocker, 'state.json') });
            await al.report('warnings', { ok: false, error: new Error('timeout') });
            ok('C9 저장 실패해도 알림은 간다 · 저장 실패가 콘솔에 남는다', s.calls.length === 1 && logs.some((l) => /상태 저장 실패/.test(l)));
        }

        console.log('\n── D. 개발/운영 발송 경로 ──');
        {
            const file = path.join(tmp, 'dev.json');
            const devAl = A.createAlerter({ file, clock: () => KST('2026-10-16T03:00:00') });
            const logLines = [];
            console.log = (...a) => logLines.push(a.join(' '));
            await devAl.report('marineBuoys', { ok: false, error: new Error('HTTP 503') });
            console.log = orig.log;
            ok('D1 개발(FLY_ALLOC_ID 없음) → sendAdminPush 를 부르지 않는다', pushCalls.length === 0);
            ok('D1 개발 → 콘솔 한 줄 · 「알렸다」로 치지 않음', logLines.some((l) => /개발 환경 — 관리자 푸시 생략/.test(l)) && devAl.records().marineBuoys.notified === false);
            process.env.FLY_ALLOC_ID = 'test-alloc';
            try {
                const prodAl = A.createAlerter({ file: path.join(tmp, 'prod.json'), clock: () => KST('2026-10-16T03:00:00') });
                console.log = () => {};
                await prodAl.report('marineBuoys', { ok: false, error: new Error('HTTP 503') });
                ok('D2 운영 → sendAdminPush 1번 · 전달(sent 1)이면 알림 완료', pushCalls.length === 1 && prodAl.records().marineBuoys.notified === true && pushCalls[0].d.item === 'marineBuoys');
                pushResult = { sent: 0, failed: 0 };
                await prodAl.report('marineVs', { ok: false, error: new Error('HTTP 503') });
                ok('D3 운영인데 전달 0건(기기 없음 등) → 미전달로 기록', prodAl.records().marineVs.notified === false && /전달 0건/.test(prodAl.records().marineVs.pushError), prodAl.records().marineVs.pushError);
                pushResult = { sent: 0, failed: 2 };
                await prodAl.report('marineVs', { ok: false, error: new Error('HTTP 503') });
                ok('D3 운영 발송 실패 2건 → 「발송 실패 2건」 기록', prodAl.records().marineVs.pushError === '발송 실패 2건', prodAl.records().marineVs.pushError);
            } finally {
                console.log = orig.log;
                delete process.env.FLY_ALLOC_ID;
                pushResult = { sent: 1, failed: 0 };
            }
        }

        console.log('\n── E. 수집기 연결 ──');
        {   // 너울: 실제 refreshIfStale 을 가짜 응답으로
            const swell = require('../services/swell_smallzone');
            console.log = () => {};
            routes.length = 0;
            routes.push({ match: /forecast-times/, status: 503, body: '' });
            await swell.refreshIfStale();
            let r = A.records().swell;
            ok('E1 너울: 예보시각 확인 HTTP 503 → 실패 기록(HTTP 503)', r && r.streak === 1 && r.reason === 'HTTP 503', JSON.stringify(r));
            routes[0] = { match: /forecast-times/, status: 200, body: JSON.stringify({ data: { fctTm: [], baseTm: '2026.10.15 21:00' } }) };
            await swell.refreshIfStale();
            r = A.records().swell;
            ok('E1 너울: 예보시각 목록이 빈 응답 → 실패로 이어 셈(2회, 빈 응답)', r.streak === 2 && r.reason === '빈 응답', JSON.stringify(r));
            routes[0] = { match: /forecast-times/, status: 200, body: JSON.stringify({ data: { fctTm: ['2026.10.16 00:00'], baseTm: '2026.10.15 21:00' } }) };
            routes.push({ match: /geoserver/, status: 500, body: '' });
            await swell.refreshIfStale();
            r = A.records().swell;
            ok('E1 너울: 모든 예보시각 WFS 실패 → 실패(그 까닭 HTTP 500)', r.streak === 3 && r.reason === 'HTTP 500', JSON.stringify(r));
            routes[1] = { match: /geoserver/, status: 200, body: JSON.stringify({ features: [{ properties: { marine_zone_no: '1_1', dngr_grde_lvl: 1, wh: 0.5, wp: 4 } }] }) };
            // 성공하면 swell_smallzone 이 실제 data/swell_smallzone.json.gz 에 캐시를 쓴다 — 그 한 파일만 가로채 쓰지 않는다.
            const realWrite = fs.writeFileSync;
            let cacheWrites = 0;
            fs.writeFileSync = function (f, ...rest) {
                if (String(f).endsWith('swell_smallzone.json.gz')) { cacheWrites++; return; }
                return realWrite.call(fs, f, ...rest);
            };
            try { await swell.refreshIfStale(); } finally { fs.writeFileSync = realWrite; }
            ok('E1 (검사 안전) 실제 너울 캐시 파일 쓰기는 가로챘다', cacheWrites === 1, String(cacheWrites));
            r = A.records().swell;
            ok('E1 너울: 받으면 정상으로(연속 0)', r.streak === 0, JSON.stringify(r));
            console.log = orig.log;
        }
        {   // 시정: 실제 refreshIfStale — 영속 failStreak 를 그대로 넘긴다
            const vsby = require('../services/vsby_smallzone');
            console.log = () => {};
            routes.length = 0;
            routes.push({ match: /rdps\/imgList/, status: 200, body: '' });
            for (let i = 0; i < 2; i++) await vsby.refreshIfStale();
            const r = A.records().visibility;
            ok('E2 시정: imgList 빈 응답 2번 → 기록 연속 2 · 분류 빈 응답 · 처음 실패 시각 = vsby failSince',
                r && r.streak === 2 && r.reason === '빈 응답' && r.since === vsby.getStatus().failSince && r.notified === false, JSON.stringify(r));
            routes[0] = { match: /rdps\/imgList/, status: 200, body: JSON.stringify({ data: { fct_tm_list: [], img_list: [] } }) };
            await vsby.refreshIfStale();
            ok('E2 시정: imgList 정상 → 연속 0', A.records().visibility.streak === 0);
            console.log = orig.log;
        }
        {   // 정시 수집기(scheduler·특보 크롤러)는 require 하면 수집이 시작되므로 소스로 연결만 확인한다
            const src = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
            const sched = src('scheduler.js'),
                crawler = src('marine_warning_crawler.js');
            for (const id of ['marineBuoys', 'marineWhBuoys', 'marineLhBuoys', 'marineVs', 'ripCurrent'])
                ok('E3 scheduler.js 가 ' + id + ' 성공·실패를 모두 알린다',
                    sched.includes("collectFailAlert.report('" + id + "', { ok: true })") && sched.includes("collectFailAlert.report('" + id + "', { ok: false, error:"));
            for (const id of ['warnings', 'gale'])
                ok('E3 marine_warning_crawler.js 가 ' + id + ' 성공·실패를 모두 알린다',
                    crawler.includes("collectFailAlert.report('" + id + "', { ok: true })") && crawler.includes("collectFailAlert.report('" + id + "', { ok: false, error: err })"));
        }
        {   // E4 이안류: scheduler.js 의 실제 collectRipCurrentIndex·_fetchRipLatest 를 떼어 가짜 fetch·실제 알림기로 돌린다
            //   (scheduler.js 를 require 하면 수집이 시작되므로 두 함수 원문만 vm 에서 실행). 검토 2·7.
            const src = fs.readFileSync(path.join(__dirname, '..', 'scheduler.js'), 'utf8');
            const fn = (name) => { const i = src.indexOf('async function ' + name + '('); return src.slice(i, src.indexOf('\n}\n', i) + 2); };
            const beaches = src.slice(src.indexOf('const RIP_BEACHES = ['), src.indexOf('];', src.indexOf('const RIP_BEACHES = [')) + 2);
            const m = make();
            let plan = null;
            const ctx = {
                console, URLSearchParams, String, Array, Object, parseFloat,
                FISHING_API_KEY: 'TESTKEY', RIP_API_BASE: 'https://example.invalid/rip',
                log: () => {}, getNowStr: () => 'NOW', saveData: () => {}, lastRunStatus: {},
                _fetchKhoaMangsang: async () => null, _fetchKmaRipBeaches: async () => ({}),
                fetchWithTimeout: async (url) => plan(url),
                collectFailAlert: { report: (id, o) => m.al.report(id, o) },
            };
            const vm = require('vm');
            vm.createContext(ctx);
            vm.runInContext(beaches + '\n' + fn('collectRipCurrentIndex') + '\n' + fn('_fetchRipLatest') + '\nthis.run = collectRipCurrentIndex;', ctx);
            const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
            const run = async (p) => { plan = p; await ctx.run(); await new Promise((r) => setImmediate(r)); };
            await run(() => resp(200, { header: { resultCode: 3 } }));
            ok('E4 결과코드가 숫자 3(비수기 자료 없음) → 실패로 세지 않는다', !m.al.records().ripCurrent || m.al.records().ripCurrent.streak === 0, JSON.stringify(m.al.records().ripCurrent));
            await run(() => resp(200, { response: { header: { resultCode: 10 } } }));
            ok('E4 숫자 10·response 안의 머리 → 실패로 세지 않는다', !m.al.records().ripCurrent || m.al.records().ripCurrent.streak === 0);
            ok('E4 비수기에는 푸시 0통', m.s.calls.length === 0);
            await run(() => resp(500, {}));
            ok('E4 9곳 모두 HTTP 500 → 실패 1통', m.s.calls.length === 1 && /이안류 지수 .* 수집 실패 — HTTP 500/.test(m.s.calls[0].body), m.s.calls.map((c) => c.body).join(' / '));
            await run((url) => (url.includes('SOKCHO') ? resp(200, { header: { resultCode: '03' } }) : resp(500, {})));
            ok('C10 (검토 2) 전부 실패 뒤 일부(1곳)만 살아남 → 보고 생략 · 복구도 재실패도 안 보냄', m.s.calls.length === 1 && m.al.records().ripCurrent.streak === 1 && m.al.records().ripCurrent.notified === true, JSON.stringify(m.al.records().ripCurrent));
            await run(() => resp(500, {}));
            ok('C10 다시 전부 실패 → 이미 알렸으니 안 보냄(연속 2)', m.s.calls.length === 1 && m.al.records().ripCurrent.streak === 2);
            await run(() => resp(200, { header: { resultCode: '03' } }));
            ok('C10 호출 오류 0건(전부 03) → 그때 복구 1통', m.s.calls.length === 2 && /수집 복구/.test(m.s.calls[1].body));
            await run((url) => (url.includes('SOKCHO') ? resp(500, {}) : resp(200, { header: { resultCode: '03' } })));
            ok('C10 정상 중 1곳만 실패 → 실패로 보고하지 않음', m.s.calls.length === 2 && m.al.records().ripCurrent.streak === 0);
        }
    } catch (e) {
        fail++;
        console.log('  ❌ 실행 오류 — ' + (e && e.stack));
    } finally {
        console.log = orig.log;
        console.warn = orig.warn;
        console.error = orig.error;
        fs.rmSync(tmp, { recursive: true, force: true });
    }
    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();
