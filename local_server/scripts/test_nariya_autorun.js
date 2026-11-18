/**
 * ============================================================================
 * 파일명: local_server/scripts/test_nariya_autorun.js
 * 역할  : 나리야 자동 반영(services/nariya_autorun.js)을 고정한다 — 설계안(services/nariya_autorun.design.md) §5
 *         「대기 중 상태 변화 표」를 행마다 시험 1개 이상으로 1:1 고정하고, 자동화 열쇠 미들웨어·done 입력 검증·
 *         예약 작업 트리거 요청 모양·상태 파일 방어·라우트 연결(소스 확인)을 함께 본다.
 *         실제 시계·실제 네트워크·실제 푸시 없이(주입한 시계·타이머·fetch·push, 임시 폴더의 상태 파일).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/nariya_autorun.js · routes/legal.js·services/admrul_fresh_scanner.js·server.js(소스만 읽음)
 *  - 나를 쓰는 곳  : scripts/refactor/verify_all.sh SUITES
 * [로드 순서] 독립 실행: node local_server/scripts/test_nariya_autorun.js
 * ============================================================================
 */
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const A = require('../services/nariya_autorun');

let pass = 0, fail = 0;
async function check(name, fn) { try { await fn(); pass++; console.log('✅ ' + name); } catch (e) { fail++; console.log('❌ ' + name + ' — ' + (e && e.message)); } }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nariya-autorun-'));
let fileNo = 0;
const newFile = () => path.join(tmp, 'state' + (++fileNo) + '.json');
const MIN = 60000, HOUR = 3600000, DAY = 24 * HOUR;
const T0 = Date.parse('2026-11-01T00:00:00Z');   // 고정 기준 시각 — 실제 Date.now 로 판정하지 않는다
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
const KEY = 'k'.repeat(40);   // 32자 이상 자동화 열쇠
const PR = (n) => 'https://github.com/cantatapream/SEAGNAL/pull/' + n;

/** 가짜 시계·타이머. advance(ms) 는 그 사이 울릴 타이머를 시각 순서대로 울린다. */
function fakeTime(start = T0) {
    let t = start, seq = 0;
    const timers = [];
    return {
        now: () => t,
        setTimer: (fn, ms) => { const h = { id: ++seq, at: t + ms, fn }; timers.push(h); return h; },
        clearTimer: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
        pending: () => timers.length,
        async advance(ms) {
            const end = t + ms;
            for (;;) {
                timers.sort((a, b) => a.at - b.at || a.id - b.id);
                const h = timers[0];
                if (!h || h.at > end) break;
                timers.shift();
                t = h.at;
                h.fn();
                await flush();
            }
            t = end;
            await flush();
        },
    };
}
const PROD_ENV = () => ({ FLY_APP_NAME: 'seagnal-server', FLY_ALLOC_ID: 'alloc-1', NARIYA_ROUTINE_FIRE_URL: 'https://api.example.test/v1/claude_code/routines/trig_x/fire', NARIYA_ROUTINE_TOKEN: 'routine-tok', NARIYA_AUTOMATION_TOKEN: KEY });
/** 가짜 fetch — 기본은 2xx + 세션 링크. mode 를 바꿔 실패를 흉내낸다. hook 은 응답 전에 부른다(발사 중 상황 만들기). */
function fakeFetch() {
    const f = async (url, init) => {
        f.calls.push({ url, init, body: JSON.parse(init.body) });
        if (f.hook) await f.hook(f.calls[f.calls.length - 1]);
        if (f.mode === 'http500') return { ok: false, status: 500, json: async () => ({}) };
        if (f.mode === 'throw') throw new TypeError('fetch failed');
        if (f.mode === 'timeout') { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; }
        if (f.mode === 'abort') { const e = new Error('This operation was aborted'); e.name = 'AbortError'; throw e; }
        return { ok: true, status: 200, json: async () => ({ claude_code_session_url: 'https://claude.ai/code/session_test' }) };
    };
    f.calls = []; f.mode = 'ok'; f.hook = null;
    return f;
}
function fakePush() { const p = async (title, body, data) => { p.sent.push({ title, body, data }); return { sent: 1, failed: 0 }; }; p.sent = []; return p; }
/** 가짜 머지 담당 — 실제 nariya_pr_merge(볼륨 파일·GitHub)를 건드리지 않게. 결정 필요 0건이면 auto. */
function fakeMerger() { const m = { tracked: [], opts: [], conflictCalls: [], answerCalls: [], conflictResult(f, d) { m.conflictCalls.push([f, d]); }, answersResult(h, d) { m.answerCalls.push([h, d]); }, track(d, o) { m.tracked.push(d); m.opts.push(o || {}); if (m.refuse) return { tracked: false, why: m.refuse }; if (m.reply) return m.reply; const human = (d.needs_decision || []).length || !(o && o.owner); return human ? { tracked: true, mode: 'human', how: 'button', status: 'waiting' } : { tracked: true, mode: 'auto', status: 'waiting' }; } }; return m; }
function make(o = {}) {
    const time = o.time || fakeTime(), f = o.fetch || fakeFetch(), push = o.push || fakePush(), file = o.file || newFile(), merger = o.merger || fakeMerger();
    const ar = A.createAutorun({ file, now: time.now, setTimer: time.setTimer, clearTimer: time.clearTimer, fetch: f, push, env: o.env || PROD_ENV(), adminCheck: o.adminCheck, prMerger: merger });
    return { ar, time, f, push, file, merger };
}
/** console 를 잠시 가로챈다(log·warn·error). */
async function capture(fn) {
    const lines = [], o = { log: console.log, warn: console.warn, error: console.error };
    console.log = console.warn = console.error = (...a) => lines.push(a.join(' '));
    try { await fn(); } finally { Object.assign(console, o); }
    return lines;
}
const quiet = (fn) => capture(fn);
/** 서버가 깨운 run 하나를 만들어 잠근다. @returns run_id */
async function fired(ctx, kind = 'amend', count = 1) {
    await quiet(async () => { ctx.ar.requestRun(kind, { count }); await ctx.time.advance(10 * MIN); });
    return ctx.ar.status().lock.run_id;
}
const titles = (push, re) => push.sent.filter((p) => re.test(p.title));

(async () => {
    // ── 설계안 §5 표 ─────────────────────────────────────────────────────────
    await check('[§5 #1] 10분 안에 또 승인 → 타이머 다시 시작 · 건수 누적 · fire 1번', async () => {
        const { ar, time, f } = make();
        await quiet(async () => {
            ar.requestRun('amend', { count: 1 });
            await time.advance(9 * MIN);
            ar.requestRun('amend', { count: 2 });
            await time.advance(9 * MIN);
            assert.equal(f.calls.length, 0, '두 번째 요청 뒤 9분 — 아직 안 쏜다(첫 요청 기준이면 이미 쐈을 시각)');
            await time.advance(1 * MIN);
        });
        assert.equal(f.calls.length, 1, '두 번째 요청 뒤 10분에 1번');
        assert.ok(/amend=3\b/.test(f.calls[0].body.text) && /fresh=0\b/.test(f.calls[0].body.text), f.calls[0].body.text);
        await quiet(() => time.advance(2 * HOUR));
        assert.equal(f.calls.length, 1, '더 쏘지 않는다');
    });

    await check('[§5 #2] 10분 안에 원문신선도도 → 사유 둘 다 실어 fire 1번 · 푸시②에 둘 다(건수 사실대로) · 세션 링크를 본문 글로', async () => {
        const { ar, time, f, push } = make();
        await quiet(async () => {
            ar.requestRun('amend', { count: 2 });
            await time.advance(5 * MIN);
            ar.requestRun('fresh', { count: 4 });
            await time.advance(10 * MIN);
        });
        assert.equal(f.calls.length, 1);
        assert.ok(/amend=2\b/.test(f.calls[0].body.text) && /fresh=4\b/.test(f.calls[0].body.text), f.calls[0].body.text);
        assert.equal(push.sent.length, 1);
        assert.ok(/세션 시작/.test(push.sent[0].title), push.sent[0].title);
        assert.ok(/개정 승인 2건/.test(push.sent[0].body) && /원문 구버전·이름바뀜·다시 뜬 카드 4건/.test(push.sent[0].body), push.sent[0].body);
        assert.ok(push.sent[0].body.includes('https://claude.ai/code/session_test'), '세션 링크를 본문에(F11)');
        assert.equal(push.sent[0].data.session_url, 'https://claude.ai/code/session_test');
        assert.equal(push.sent[0].data.url, undefined, 'data.url 은 건드리지 않는다');
        assert.equal(ar.status().pending, null, '넘긴 대기는 비운다');
        assert.deepEqual(ar.status().lock.taken, { amend: 2, fresh: 4 }, '잠금이 넘겨받은 몫');
    });

    await check('[§5 #3] 서버 재시작(타이머 유실) → pending 은 파일에 남고, start() 가 10분 타이머를 다시 건다', async () => {
        const file = newFile();
        const first = make({ file });
        first.ar.requestRun('fresh', { count: 3 });
        assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).pending.reasons, { fresh: 3 }, '파일에 남음');
        const time2 = fakeTime(T0 + 2 * MIN), f2 = fakeFetch();
        const second = make({ file, time: time2, fetch: f2 });
        assert.equal(time2.pending(), 0, 'start 전에는 타이머 없음');
        await quiet(async () => { assert.deepEqual(second.ar.start(), { pending: true, lock: false }); });
        await time2.advance(9 * MIN);
        assert.equal(f2.calls.length, 0, '시작 뒤 9분 — 아직');
        await quiet(() => time2.advance(1 * MIN));
        assert.equal(f2.calls.length, 1, '시작 뒤 10분에 발사');
        assert.equal(first.f.calls.length, 0, '옛 인스턴스는 쏘지 않았다');
    });

    await check('[§5 #3 보강] 잠금도 파일에 남는다 — 재시작 뒤 다른 run 의 claim 은 busy · 남은 시간으로 만료 타이머', async () => {
        const file = newFile();
        const first = make({ file });
        await fired(first);
        const time2 = fakeTime(first.time.now() + HOUR), push2 = fakePush();
        const second = make({ file, time: time2, push: push2 });
        await quiet(async () => second.ar.start());
        assert.equal(second.ar.claim({ run_id: 'other-run' }).busy, true);
        await time2.advance(2 * HOUR - 1);
        assert.equal(push2.sent.length, 0, '3시간 전에는 응답 없음 푸시 없음');
        await quiet(() => time2.advance(1));
        assert.equal(titles(push2, /이전 세션 응답 없음/).length, 1, '남은 2시간 뒤에 만료');
    });

    await check('[§5 #4] 잠금 중 새 승인 → pending 에 쌓고 fire 안 함(타이머도 안 검) · done 오면 10분 뒤 fire', async () => {
        const ctx = make(), { ar, time, f } = ctx;
        const runId = await fired(ctx);
        const r = ar.requestRun('amend', { count: 5 });
        assert.equal(r.locked, true);
        assert.equal(ar.status().pending.fireAt, null, '잠금 중에는 10분 타이머를 걸지 않는다');
        await time.advance(2 * HOUR);
        assert.equal(f.calls.length, 1, '잠금 중에는 쏘지 않는다');
        let d; await quiet(async () => { d = ar.done({ run_id: runId, outcome: 'pr', pr_url: PR(1) }); });
        assert.equal(d.released, true);
        assert.equal(ar.status().lock, null);
        await time.advance(9 * MIN);
        assert.equal(f.calls.length, 1, 'done 뒤 9분 — 아직');
        await quiet(() => time.advance(1 * MIN));
        assert.equal(f.calls.length, 2, 'done 뒤 10분에 다음 발사');
        assert.ok(/amend=5\b/.test(f.calls[1].body.text), f.calls[1].body.text);
    });

    await check('[§5 #5] 잠금 3시간 지남(done 안 옴) → 잠금 무효 · 「이전 세션 응답 없음」 푸시 · pending 있으면 fire · 가져간 몫은 되돌리지 않음', async () => {
        const ctx = make(), { ar, time, f, push } = ctx;
        const oldRun = await fired(ctx, 'amend', 7);
        ar.requestRun('fresh', { count: 2 });
        await time.advance(3 * HOUR - 1);
        assert.equal(f.calls.length, 1);
        await quiet(() => time.advance(1));
        const stale = titles(push, /이전 세션 응답 없음/);
        assert.equal(stale.length, 1); assert.equal(stale[0].data.run_id, oldRun);
        assert.equal(f.calls.length, 2, '대기가 있으니 발사');
        assert.ok(/amend=0\b/.test(f.calls[1].body.text) && /fresh=2\b/.test(f.calls[1].body.text), '만료된 run 의 몫(amend 7)은 되돌리지 않는다: ' + f.calls[1].body.text);
    });

    await check('[§5 #5 보강] 잠금 만료 때 대기가 없으면 푸시 한 줄만 · 발사 없음 · 풀린 뒤 다른 run 이 잡는다', async () => {
        const ctx = make(), { ar, time, f, push } = ctx;
        await fired(ctx);
        await quiet(() => time.advance(3 * HOUR));
        assert.equal(titles(push, /이전 세션 응답 없음/).length, 1);
        assert.equal(f.calls.length, 1);
        assert.equal(ar.status().lock, null);
        assert.equal(ar.claim({ run_id: 'daily-b' }).busy, false);
    });

    await check('[§5 #6] fire 실패(HTTP 500) → 푸시② 실패 · pending 유지 · 자동 재시도 없음 · 다음 요청이 줍는다', async () => {
        const { ar, time, f, push } = make();
        f.mode = 'http500';
        await quiet(async () => { ar.requestRun('amend', { count: 2 }); await time.advance(10 * MIN); });
        assert.equal(f.calls.length, 1);
        assert.equal(push.sent.length, 1);
        assert.ok(/세션 전달 실패/.test(push.sent[0].title) && /HTTP 500/.test(push.sent[0].body));
        assert.deepEqual(ar.status().pending.reasons, { amend: 2 });
        assert.equal(ar.status().lock, null);
        await time.advance(24 * HOUR);
        assert.equal(f.calls.length, 1, '자동 재시도 없음');
        f.mode = 'ok';
        await quiet(async () => { ar.requestRun('amend'); await time.advance(10 * MIN); });
        assert.ok(/amend=3\b/.test(f.calls[1].body.text), '남아 있던 2건 + 새 1건');
    });

    await check('[§5 #6] fire 실패(망 오류) → 푸시② 실패 · pending 유지', async () => {
        const { ar, time, f, push } = make();
        f.mode = 'throw';
        await quiet(async () => { ar.requestRun('fresh'); await time.advance(10 * MIN); });
        assert.equal(push.sent.length, 1);
        assert.ok(/세션 전달 실패/.test(push.sent[0].title) && /연결 실패/.test(push.sent[0].body), push.sent[0].body);
        assert.deepEqual(ar.status().pending.reasons, { fresh: 1 });
    });

    await check('[§5 #6] 환경 변수 없음 → fetch 안 부름 · 「세션 전달 실패」 푸시 없음 · pending 유지 · 콘솔 한 줄', async () => {
        const env = PROD_ENV(); delete env.NARIYA_ROUTINE_FIRE_URL;
        const { ar, time, f, push } = make({ env });
        const lines = await capture(async () => { ar.requestRun('amend'); await time.advance(10 * MIN); });
        assert.equal(f.calls.length, 0);
        assert.equal(titles(push, /전달 실패/).length, 0);
        assert.deepEqual(ar.status().pending.reasons, { amend: 1 });
        assert.equal(lines.filter((l) => /NARIYA_ROUTINE_FIRE_URL·NARIYA_ROUTINE_TOKEN 없음/.test(l)).length, 1, lines.join(' | '));
    });

    await check('[§5 #6b] 운영인데 트리거 환경 변수 없음 → 프로세스당 첫 requestRun 때 「나리야 자동 반영 미설정」 푸시 1회', async () => {
        const env = PROD_ENV(); delete env.NARIYA_ROUTINE_TOKEN;
        const { ar, time, push } = make({ env });
        await quiet(async () => { ar.requestRun('amend'); ar.requestRun('fresh'); await time.advance(DAY); ar.requestRun('amend'); await flush(); });
        assert.equal(titles(push, /^나리야 자동 반영 미설정$/).length, 1, push.sent.map((p) => p.title).join(' | '));
        assert.equal(push.sent.length, 1, '그 밖의 푸시 없음');
        const ok = make();
        await quiet(async () => { ok.ar.requestRun('amend'); await flush(); });
        assert.equal(titles(ok.push, /미설정/).length, 0, '설정돼 있으면 없음');
    });

    await check('[§5 #7] done 의 run_id 가 다른 run 의 유효 잠금과 다름 → 잠금 유지 · 푸시③ + 「잠금과 다른 run」', async () => {
        const ctx = make(), { ar, push } = ctx;
        const runId = await fired(ctx);
        let d; await quiet(async () => { d = ar.done({ run_id: 'someone-else', outcome: 'nothing', summary: '반영할 것 없음' }); await flush(); });
        assert.equal(d.ok, true); assert.equal(d.released, false); assert.equal(d.lockMismatch, true); assert.equal(d.late, false);
        assert.equal(ar.status().lock.run_id, runId, '잠금 유지');
        const last = push.sent[push.sent.length - 1];
        assert.ok(/^\[잠금과 다른 run\]/.test(last.title), last.title);
        assert.equal(last.data.lock_mismatch, 'true');
    });

    await check('[§5 #8] 매일 B 세션이 claim 했는데 A 잠금 유효 → busy · A 자신(같은 run_id)은 통과 · run_id 없거나 꼴 틀리면 400', async () => {
        const ctx = make(), { ar } = ctx;
        const runId = await fired(ctx);
        const b = ar.claim({ run_id: 'daily-b' });
        assert.equal(b.busy, true); assert.equal(b.lock.run_id, runId); assert.equal(b.lock.source, 'fire');
        assert.equal(ar.claim({ run_id: runId }).busy, false, 'A 자신은 통과');
        for (const bad of [{}, { run_id: '' }, { run_id: 'bad id!' }, { run_id: 'x'.repeat(65) }, null]) {
            const r = ar.claim(bad); assert.equal(r.ok, false, JSON.stringify(bad)); assert.equal(r.status, 400);
        }
    });

    await check('[§5 #9] 개발 서버(FLY_APP_NAME 없음) · 스테이징(seagnal-staging) → fire·푸시 안 함 · 콘솔 한 줄', async () => {
        for (const app of [undefined, 'seagnal-staging']) {
            const env = PROD_ENV(); if (app) env.FLY_APP_NAME = app; else delete env.FLY_APP_NAME;
            const { ar, time, f, push } = make({ env });
            const lines = await capture(async () => { ar.requestRun('amend', { count: 2 }); await time.advance(10 * MIN); });
            assert.equal(f.calls.length, 0, (app || '개발') + ' — fetch 안 부름');
            assert.equal(lines.filter((l) => /운영 아님 — 세션 깨우기 생략/.test(l)).length, 1, lines.join(' | '));
            assert.deepEqual(ar.status().pending.reasons, { amend: 2 });
            ar.claim({ run_id: 'dev-run' });
            await quiet(async () => { ar.done({ run_id: 'dev-run', outcome: 'pr', pr_url: PR(2) }); ar.claim({ run_id: 'dev-run2' }); await time.advance(4 * HOUR); });
            assert.equal(push.sent.length, 0, (app || '개발') + ' — done·응답 없음도 푸시 없음');
            assert.equal(ar.status().production, false);
        }
    });

    await check('[§5 #10] claim 하는 순간 대기를 넘겨받는다 — lock.taken · 대기 비움 · 10분 타이머 지움(사용자 확정 ①)', async () => {
        const { ar, time, f } = make();
        ar.requestRun('amend', { count: 2 }); ar.requestRun('fresh', { count: 1 });
        const c = ar.claim({ run_id: 'daily-1' });
        assert.equal(c.busy, false); assert.deepEqual(c.taken, { amend: 2, fresh: 1 });
        assert.equal(ar.status().pending, null);
        assert.deepEqual(ar.status().lock.taken, { amend: 2, fresh: 1 }); assert.equal(ar.status().lock.source, 'claim');
        await quiet(async () => { ar.done({ run_id: 'daily-1', outcome: 'pr', pr_url: PR(3) }); await time.advance(30 * MIN); });
        assert.equal(f.calls.length, 0, '넘겨받은 일로 서버가 또 깨우지 않는다');
    });

    await check('[§5 #11] fire 시간초과 → 「전달 여부 확인 불가」 · pending 유지 · 그 run_id 의 claim 이 오면 늦게 성공(source fire) + 「늦게 확인됨」', async () => {
        for (const mode of ['timeout', 'abort']) {
            const { ar, time, f, push } = make();
            f.mode = mode;
            await quiet(async () => { ar.requestRun('amend', { count: 3 }); await time.advance(10 * MIN); });
            assert.equal(titles(push, /세션 전달 여부 확인 불가\(시간초과\)/).length, 1, mode + ': ' + push.sent.map((p) => p.title).join('|'));
            assert.equal(titles(push, /세션 전달 실패/).length, 0);
            assert.deepEqual(ar.status().pending.reasons, { amend: 3 });
            const lf = ar.status().lastFire; assert.equal(lf.unknown, true);
            const runId = f.calls[0].body.text.match(/run_id=(\S+)/)[1]; assert.equal(lf.run_id, runId);
            let c; await quiet(async () => { c = ar.claim({ run_id: runId }); await flush(); });
            assert.equal(c.busy, false);
            assert.equal(ar.status().lock.source, 'fire'); assert.deepEqual(ar.status().lock.taken, { amend: 3 }); assert.equal(ar.status().pending, null);
            assert.equal(titles(push, /세션 시작\(늦게 확인됨\)/).length, 1);
            assert.equal(ar.status().lastFire.unknown, false);
        }
    });

    await check('[§5 #12] fire 진행 중 다른 run 의 claim → busy · 그 run 자신의 claim 은 잡고 · 응답 뒤 다시 빼지 않음 · 그새 다른 잠금이면 덮어쓰지 않고 표시', async () => {
        const a = make();
        let during = null, self = null;
        a.f.hook = async (call) => { during = a.ar.claim({ run_id: 'daily-b' }); self = a.ar.claim({ run_id: call.body.text.match(/run_id=(\S+)/)[1] }); a.ar.requestRun('fresh', { count: 9 }); };
        await quiet(async () => { a.ar.requestRun('amend', { count: 2 }); await a.time.advance(10 * MIN); });
        assert.equal(during.busy, true); assert.equal(during.firing, true);
        assert.equal(self.busy, false);
        const st = a.ar.status();
        assert.equal(st.lock.source, 'fire'); assert.deepEqual(st.lock.taken, { amend: 2 });
        assert.deepEqual(st.pending.reasons, { fresh: 9 }, '잠금 뒤 들어온 요청은 그대로(발사 응답이 다시 빼지 않음)');
        // 덮어쓰기 막기 — 응답 전에 다른 잠금이 생긴 상황을 상태로 직접 만든다(경합을 흉내내는 화이트박스 시험)
        const b = make();
        b.f.hook = async () => { b.ar._state().lock = { run_id: 'other-lock', since: b.time.now(), source: 'claim', taken: {}, workNotified: false }; };
        await quiet(async () => { b.ar.requestRun('amend'); await b.time.advance(10 * MIN); });
        assert.equal(b.ar.status().lock.run_id, 'other-lock', '덮어쓰지 않는다');
        assert.equal(b.ar.status().lastFire.lockConflict, 'other-lock');
        assert.ok(titles(b.push, /잠금 충돌/).length === 1 && /other-lock/.test(b.push.sent[0].body), b.push.sent.map((p) => p.title + ' ' + p.body).join('|'));
    });

    await check('[§5 #13] done 멱등 — 같은 run_id 두 번째는 상태·푸시 없이 {duplicate:true} · 응답은 푸시를 기다리지 않음 · 완료 푸시 시간당 10통', async () => {
        const never = () => new Promise(() => {});   // 끝나지 않는 푸시
        const ctx = make({ push: Object.assign((...a) => { ctx2.sent.push(a); return never(); }, {}) });
        const ctx2 = { sent: [] };
        const runId = await fired(ctx);
        const r = ctx.ar.done({ run_id: runId, outcome: 'pr', pr_url: PR(4) });
        assert.equal(typeof r.then, 'undefined', 'done 은 약속(Promise)이 아니라 바로 결과를 준다');
        assert.equal(r.ok, true); assert.equal(r.released, true);
        const n = ctx2.sent.length;
        const r2 = ctx.ar.done({ run_id: runId, outcome: 'failed' });
        assert.deepEqual(r2, { ok: true, duplicate: true });
        assert.equal(ctx2.sent.length, n, '두 번째는 푸시 없음'); assert.equal(ctx.ar.status().lastDone.outcome, 'pr', '상태 그대로');
        // 시간당 10통
        const { ar, time, push } = make();
        const lines = await capture(async () => { for (let i = 0; i < 12; i++) ar.done({ run_id: 'flood-' + i, outcome: 'failed' }); await flush(); });
        assert.equal(titles(push, /세션 실패/).length, 10, '10통까지');
        assert.equal(lines.filter((l) => /시간당 10통 넘음/.test(l)).length, 2);
        await time.advance(HOUR);
        await quiet(async () => { ar.done({ run_id: 'flood-x', outcome: 'failed' }); await flush(); });
        assert.equal(titles(push, /세션 실패/).length, 11, '한 시간 지나면 다시');
    });

    await check('[§5 #14] done 경로에서 낡은 잠금이 지워졌고 대기가 있으면 타이머를 다시 건다 · start() 에서 이미 만료된 잠금은 만료 처리 한 경로만 발사', async () => {
        // done 경로: B 잠금 중 대기 쌓임 → 만료 타이머가 늦어지는 사이 다른 run 의 done
        //   (시계만 움직이고 타이머는 울리지 않는 가짜 — 만료 타이머가 늦게 울리는 상황)
        let clock = T0;
        const timers = [];
        const ar = A.createAutorun({ file: newFile(), now: () => clock, setTimer: (fn, ms) => { const h = { fn, at: clock + ms }; timers.push(h); return h; },
            clearTimer: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); }, fetch: fakeFetch(), push: fakePush(), env: PROD_ENV() });
        ar.claim({ run_id: 'b1' }); ar.requestRun('amend', { count: 2 });
        clock += 3 * HOUR + 5;   // 만료 타이머는 아직 안 울림(지연)
        await quiet(async () => { ar.done({ run_id: 'other', outcome: 'nothing', summary: 'x' }); await flush(); });
        const st = ar.status();
        assert.equal(st.lock, null); assert.ok(st.pending.fireAt, '대기 타이머가 다시 걸렸다: ' + JSON.stringify(st.pending));
        assert.equal(ar.status().lastDone.late, true, '잠금이 없으니 「늦은 완료」');
        // start: 만료된 잠금 + 대기 → 발사는 한 번
        const file = newFile();
        const first = make({ file });
        first.ar.claim({ run_id: 'b2' }); first.ar.requestRun('amend', { count: 1 });
        const time2 = fakeTime(T0 + 5 * HOUR), f2 = fakeFetch();
        f2.mode = 'http500';   // 첫 발사가 실패해도 따로 걸린 10분 타이머가 「재시도」로 한 번 더 쏘지 않는지까지 본다
        const second = make({ file, time: time2, fetch: f2 });
        await quiet(async () => { second.ar.start(); await time2.advance(0); await time2.advance(30 * MIN); });
        assert.equal(f2.calls.length, 1, '발사 1번(만료 경로만)');
    });

    await check('[§5 #15] 정기 세션(source claim)의 \'nothing\' done 은 푸시 없음 · 서버가 깨운 run 의 \'nothing\' 은 푸시', async () => {
        const a = make();
        a.ar.claim({ run_id: 'daily-1' });
        await quiet(async () => { const d = a.ar.done({ run_id: 'daily-1', outcome: 'nothing' }); assert.equal(d.released, true); assert.equal(d.pushQueued, false); await flush(); });
        assert.equal(a.push.sent.length, 0);
        const b = make(); const runId = await fired(b);
        await quiet(async () => { b.ar.done({ run_id: runId, outcome: 'nothing' }); await flush(); });
        assert.equal(titles(b.push, /반영할 것 없음/).length, 1);
        // [D1] 예외 ① 그 run 에서 「작업 시작」을 이미 보냈으면 'nothing' 이어도 끝을 알린다
        const c = make();
        await quiet(async () => { c.ar.claim({ run_id: 'daily-2' }); c.ar.claim({ run_id: 'daily-2', work: { amend: 1, fresh: 0 } }); c.ar.done({ run_id: 'daily-2', outcome: 'nothing' }); await flush(); });
        assert.equal(titles(c.push, /작업 시작\(직접 실행/).length, 1); assert.equal(titles(c.push, /반영할 것 없음/).length, 1, '시작을 알렸으면 끝도 알린다');
        // [D1] 예외 ② 사람이 정할 것이 있으면 알린다 — 본문에 건수와 앞 몇 줄
        const e = make();
        await quiet(async () => { e.ar.claim({ run_id: 'daily-3' }); e.ar.done({ run_id: 'daily-3', outcome: 'nothing', needs_decision: ['고시 A 동일성', '고시 B 승격', '별표 C', '별표 D'] }); await flush(); });
        const n = titles(e.push, /반영할 것 없음/);
        assert.equal(n.length, 1); assert.ok(/결정 필요 4건/.test(n[0].title), n[0].title);
        assert.ok(/결정 필요 4건: 고시 A 동일성 \/ 고시 B 승격 \/ 별표 C 외/.test(n[0].body), n[0].body);
        assert.ok(b.push.sent[1].body.includes('반영할 것이 없었습니다'), 'summary 없으면 대체문(F11): ' + b.push.sent[1].body);
    });

    await check('[§5 #16] outcome \'failed\' → 그 run 이 가져간 몫은 대기로 되돌리지 않음 · 10분 뒤 다시 깨우지 않음(반복 발사 고리 막기)', async () => {
        const ctx = make(), { ar, time, f, push } = ctx;
        const runId = await fired(ctx, 'amend', 4);
        await quiet(async () => { ar.done({ run_id: runId, outcome: 'failed' }); await time.advance(2 * HOUR); });
        assert.equal(ar.status().pending, null);
        assert.equal(f.calls.length, 1, '다시 쏘지 않는다');
        assert.ok(titles(push, /세션 실패/).length === 1 && /세션 기록을 확인/.test(push.sent[1].body), push.sent[1].body);
    });

    await check('[§5 #17] PR 낸 일(inFlight) — done pr + id 목록 → 자동 세션에서 숨김 · 장부 반영·카드 처리로 빠짐 · 14일 뒤 버림 · status 요약', async () => {
        const ctx = make(), { ar, time } = ctx;
        const runId = await fired(ctx);
        await quiet(async () => { ar.done({ run_id: runId, outcome: 'pr', pr_url: PR(5), amend_ids: ['chg_1', 'chg_2', 'chg_1'], fresh_ids: ['adf_a', 'adf_b', 'adf_c', 'adf_d'] }); await flush(); });
        let h = ar.hiddenIds();
        assert.deepEqual([...h.amend].sort(), ['chg_1', 'chg_2']); assert.deepEqual([...h.fresh].sort(), ['adf_a', 'adf_b', 'adf_c', 'adf_d']);
        assert.deepEqual(ar.status().inFlight, [{ run_id: runId, pr_url: PR(5), amend: 2, fresh: 4, mok: 0, since: ar.status().inFlight[0].since }]);
        h = ar.hiddenIds({ applied: new Map([['chg_1', {}]]) });
        assert.deepEqual([...h.amend], ['chg_2'], '장부에 들어온 amend id 는 빠진다'); assert.equal(h.fresh.size, 4, 'fresh 는 안 건드림');
        // [D7] 점검기가 자동으로 닫은 카드(auto_closed:true · done)만 풀린다 — 손으로 닫은 것·다시 뜬 것·대기 중인 것은 그대로 숨긴다
        h = ar.hiddenIds({ freshCards: new Map([
            ['adf_a', { status: 'pending' }],
            ['adf_b', { status: 'done', auto_closed: true }],
            ['adf_c', { status: 'dismissed', decidedBy: '관리자' }],
            ['adf_d', { status: 'pending', auto_closed: true }]]) });
        assert.deepEqual([...h.fresh].sort(), ['adf_a', 'adf_c', 'adf_d'], '자동 닫힘만 풀림: ' + [...h.fresh]);
        await time.advance(14 * DAY);
        h = ar.hiddenIds();
        assert.equal(h.amend.size + h.fresh.size, 0, '14일 지나면 버린다');
        assert.deepEqual(ar.status().inFlight, []);
        // 'nothing'·'failed' 는 남기지 않는다
        const b = make(); b.ar.claim({ run_id: 'x1' });
        await quiet(async () => { b.ar.done({ run_id: 'x1', outcome: 'failed', amend_ids: ['chg_9'] }); });
        assert.equal(b.ar.hiddenIds().amend.size, 0);
    });

    await check('[§5 #18] 같은 run_id 의 claim = 심장박동(lock.since 갱신 → 만료가 밀림) · 정기 세션이 처음 work n+m>0 을 보내면 「정기 세션 — 작업 시작」 1회', async () => {
        const { ar, time, push } = make();
        await quiet(async () => {
            ar.claim({ run_id: 'daily-1' });
            await time.advance(2 * HOUR);
            assert.equal(ar.claim({ run_id: 'daily-1', work: { amend: 0, fresh: 0 } }).heartbeat, true);
            await time.advance(2 * HOUR);
        });
        assert.equal(ar.status().lock.run_id, 'daily-1', '심장박동 덕에 4시간째에도 잠금 유효');
        assert.equal(push.sent.length, 0, '일감 0 이면 푸시 없음');
        await quiet(async () => { ar.claim({ run_id: 'daily-1', work: { amend: 3, fresh: 1 } }); ar.claim({ run_id: 'daily-1', work: { amend: 5, fresh: 0 } }); await flush(); });
        const w = titles(push, /작업 시작\(직접 실행/);
        assert.equal(w.length, 1, '1회만'); assert.ok(/개정 3·원문신선도 1/.test(w[0].title), w[0].title);
        await quiet(() => time.advance(3 * HOUR));
        assert.equal(titles(push, /이전 세션 응답 없음/).length, 1, '심장박동이 끊기면 3시간 뒤 만료');
        // 서버가 깨운 run 은 work 푸시를 안 한다(이미 「세션 시작」을 보냈다)
        const b = make(); const runId = await fired(b);
        await quiet(async () => { b.ar.claim({ run_id: runId, work: { amend: 1, fresh: 0 } }); await flush(); });
        assert.equal(titles(b.push, /직접 실행/).length, 0);
    });

    await check('[§5 #19] 잠금이 없을 때(만료 뒤) 온 done → 「늦은 완료」(잠금과 다른 run 아님)', async () => {
        const ctx = make(), { ar, time, push } = ctx;
        const runId = await fired(ctx);
        await quiet(() => time.advance(3 * HOUR));   // 만료
        let d; await quiet(async () => { d = ar.done({ run_id: runId, outcome: 'pr', pr_url: PR(6) }); await flush(); });
        assert.equal(d.late, true); assert.equal(d.lockMismatch, false);
        const last = push.sent[push.sent.length - 1];
        assert.ok(/^\[늦은 완료\]/.test(last.title) && !/잠금과 다른/.test(last.title), last.title);
        assert.ok(!last.body.includes('http'), 'PR 을 맡았으면 주소는 앱 카드에 — 푸시엔 안 넣는다(2026-11-18 사용자 「영문이라던가 … 굳이 필요가 없지 않니」): ' + last.body);
    });

    await check('[§5 #21] 3시간 만료로 풀린 run 이 다시 claim → 원래 출처·「작업 시작」 여부를 이어받고 relocked:true · 그새 새 run 이 잠갔으면 busy', async () => {
        const { ar, time, push } = make();
        await quiet(async () => { ar.claim({ run_id: 'daily-9' }); ar.claim({ run_id: 'daily-9', work: { amend: 2, fresh: 0 } }); await time.advance(3 * HOUR); });
        assert.equal(ar.status().lock, null, '만료로 풀림');
        let c; await quiet(async () => { c = ar.claim({ run_id: 'daily-9', work: { amend: 2, fresh: 0 } }); await flush(); });
        assert.equal(c.busy, false); assert.equal(c.relocked, true);
        assert.equal(ar.status().lock.source, 'claim');
        assert.equal(titles(push, /작업 시작\(직접 실행/).length, 1, '「작업 시작」은 이어받아 다시 안 보낸다');
        await quiet(async () => { ar.done({ run_id: 'daily-9', outcome: 'nothing' }); await flush(); });
        assert.equal(titles(push, /반영할 것 없음/).length, 1, 'workNotified 를 이어받아 끝도 알린다(D1)');
        // 서버가 깨운 run 은 source fire 를 이어받는다
        const b = make(); const runId = await fired(b);
        await quiet(() => b.time.advance(3 * HOUR));
        const r = b.ar.claim({ run_id: runId });
        assert.equal(r.relocked, true); assert.equal(b.ar.status().lock.source, 'fire');
        // 대기가 있어 만료 직후 새 run 이 잠갔으면 → busy
        const d = make(); const old = await fired(d);
        d.ar.requestRun('amend');
        await quiet(() => d.time.advance(3 * HOUR));   // 만료 → 대기가 있어 새 발사·새 잠금
        assert.notEqual(d.ar.status().lock.run_id, old);
        assert.equal(d.ar.claim({ run_id: old }).busy, true, '잠금을 잃은 run 은 busy(설계안 §6: 커밋한 데까지 PR → done)');
    });

    await check('[§5 #23] 결과 불명 발사는 최근 목록(5개·3시간)으로 기억 — 그 뒤 다른 발사가 lastFire 를 덮어써도 앞 run 의 claim 을 늦게 확인 · 3시간 지나면 잊음', async () => {
        const { ar, time, f, push } = make();
        f.mode = 'timeout';
        await quiet(async () => { ar.requestRun('amend'); await time.advance(10 * MIN); });
        const first = f.calls[0].body.text.match(/run_id=(\S+)/)[1];
        await quiet(async () => { ar.requestRun('amend'); await time.advance(10 * MIN); });
        const second = f.calls[1].body.text.match(/run_id=(\S+)/)[1];
        assert.notEqual(first, second); assert.equal(ar.status().lastFire.run_id, second, 'lastFire 는 뒤의 것');
        let c; await quiet(async () => { c = ar.claim({ run_id: first }); await flush(); });
        assert.equal(c.busy, false); assert.equal(ar.status().lock.source, 'fire', '앞 run 도 서버가 깨운 run 으로 확인');
        assert.equal(titles(push, /늦게 확인됨/).length, 1);
        const b = make(); b.f.mode = 'timeout';
        await quiet(async () => { b.ar.requestRun('amend'); await b.time.advance(10 * MIN); });
        const rid = b.f.calls[0].body.text.match(/run_id=(\S+)/)[1];
        await b.time.advance(3 * HOUR);
        await quiet(async () => { b.ar.claim({ run_id: rid }); await flush(); });
        assert.equal(b.ar.status().lock.source, 'claim', '3시간 지난 불명 run 은 잊는다'); assert.equal(titles(b.push, /늦게 확인됨/).length, 0);
    });

    await check('[§5 #24] fire 응답이 시간초과·HTTP 오류여도 그 사이 같은 run 이 claim 해 잠금을 쥐었으면 성공 — 실패·불명 푸시 대신 「세션 시작(확인됨)」', async () => {
        for (const mode of ['timeout', 'http500']) {
            const { ar, time, f, push } = make();
            f.mode = mode;
            f.hook = async (call) => { ar.claim({ run_id: call.body.text.match(/run_id=(\S+)/)[1] }); };
            await quiet(async () => { ar.requestRun('amend', { count: 2 }); await time.advance(10 * MIN); });
            assert.equal(titles(push, /전달 실패|확인 불가/).length, 0, mode + ': ' + push.sent.map((p) => p.title).join('|'));
            assert.equal(titles(push, /세션 시작\(확인됨\)/).length, 1, mode);
            const st = ar.status();
            assert.equal(st.lastFire.ok, true); assert.equal(st.lastFire.unknown, undefined); assert.equal(st.lastFire.confirmedByClaim, true);
            assert.equal(st.lock.source, 'fire'); assert.deepEqual(st.lock.taken, { amend: 2 }); assert.equal(st.pending, null);
        }
    });

    await check('[§5 #25] fire 응답 전에 그 run 이 이미 done 까지 끝냈으면 → 잠그지 않고 대기도 깎지 않는다', async () => {
        const { ar, time, f } = make();
        f.hook = async (call) => {
            const rid = call.body.text.match(/run_id=(\S+)/)[1];
            ar.claim({ run_id: rid });
            ar.done({ run_id: rid, outcome: 'nothing' });
            ar.requestRun('fresh', { count: 3 });   // 끝난 뒤 새 요청
        };
        await quiet(async () => { ar.requestRun('amend', { count: 2 }); await time.advance(10 * MIN); });
        const st = ar.status();
        assert.equal(st.lastFire.alreadyDone, true);
        assert.equal(st.lock, null, '다시 잠그지 않는다');
        assert.deepEqual(st.pending.reasons, { fresh: 3 }, '새 대기를 깎지 않는다');
    });

    await check('[§5 #13 보강] done 중복은 최근 20개 run 으로 판정(두 run 이 번갈아 재전송) · 20개 밖으로 밀려도 inFlight 는 같은 run 을 두 번 넣지 않음', async () => {
        const { ar, push } = make();
        await quiet(async () => {
            ar.done({ run_id: 'r-a', outcome: 'pr', pr_url: PR(8), amend_ids: ['chg_a'] });
            ar.done({ run_id: 'r-b', outcome: 'failed' });
            assert.deepEqual(ar.done({ run_id: 'r-a', outcome: 'pr', pr_url: PR(8), amend_ids: ['chg_a'] }), { ok: true, duplicate: true }, '한 칸이면 놓쳤을 재전송');
            for (let i = 0; i < 20; i++) ar.done({ run_id: 'r-x' + i, outcome: 'failed' });
            const again = ar.done({ run_id: 'r-a', outcome: 'pr', pr_url: PR(8), amend_ids: ['chg_a'] });
            assert.equal(again.duplicate, undefined, '20개 밖이면 새 보고로 받는다');
            await flush();
        });
        assert.equal(ar.status().inFlight.filter((x) => x.run_id === 'r-a').length, 1, 'inFlight 는 한 번만');
        assert.ok(push.sent.length >= 1);
    });

    await check('[§5 #20] 상태 화면 fireAt — 잠금이 유효하면 null, 아니면 10분 뒤 시각(KST)', async () => {
        const { ar } = make();
        ar.requestRun('amend', { count: 2 });
        assert.equal(ar.status().pending.fireAt, '2026-11-01T09:10:00+09:00');
        ar._state().lock = { run_id: 'z', since: T0, source: 'claim', taken: {}, workNotified: false };
        assert.equal(ar.status().pending.fireAt, null);
    });

    // ── 예약 작업 트리거 요청 모양(설계안 §2) ─────────────────────────────────
    await check('[§2] fire 요청 — POST · Bearer 토큰 · anthropic-version · anthropic-beta · JSON · 본문은 {text} 하나(지시문 전문 없음)', async () => {
        const ctx = make(), { ar, f } = ctx;
        const runId = await fired(ctx);
        const c = f.calls[0];
        assert.equal(c.url, PROD_ENV().NARIYA_ROUTINE_FIRE_URL);
        assert.equal(c.init.method, 'POST');
        assert.equal(c.init.headers.Authorization, 'Bearer routine-tok');
        assert.equal(c.init.headers['anthropic-version'], '2023-06-01');
        assert.equal(c.init.headers['anthropic-beta'], 'experimental-cc-routine-2026-04-01');
        assert.equal(c.init.headers['Content-Type'], 'application/json');
        assert.deepEqual(Object.keys(c.body), ['text']);
        assert.ok(c.body.text.includes('run_id=' + runId) && c.body.text.length < 200);
        assert.equal(ar.status().lock.run_id, runId);
    });

    // ── 자동화 열쇠 미들웨어(설계안 §3) ───────────────────────────────────────
    const req = (h) => ({ get: (name) => h[name.toLowerCase()] });
    const res = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; } });
    await check('[§3] 자동화 열쇠 — 맞음 통과(req.viaAutomation) · 틀림/없음/길이 다름 401 · 환경 변수 없거나 32자 미만이면 언제나 401', async () => {
        const { ar } = make();
        const run = (h, inst = ar) => { let nexted = false; const r = res(), q = req(h); inst.requireAutomation(q, r, () => { nexted = true; }); return { nexted, code: r.code, via: q.viaAutomation === true }; };
        assert.deepEqual(run({ 'x-automation-token': KEY }), { nexted: true, code: 200, via: true }, '맞음');
        assert.deepEqual(run({ 'x-automation-token': 'k'.repeat(39) + 'x' }), { nexted: false, code: 401, via: false }, '틀림(같은 길이)');
        assert.deepEqual(run({}), { nexted: false, code: 401, via: false }, '없음');
        assert.deepEqual(run({ 'x-automation-token': KEY + 'k' }), { nexted: false, code: 401, via: false }, '길이 다름');
        const env = PROD_ENV(); delete env.NARIYA_AUTOMATION_TOKEN;
        assert.equal(run({ 'x-automation-token': '' }, make({ env }).ar).code, 401, '환경 변수 없음');
        const short = PROD_ENV(); short.NARIYA_AUTOMATION_TOKEN = 's'.repeat(31);
        const sh = make({ env: short });
        assert.equal(run({ 'x-automation-token': 's'.repeat(31) }, sh.ar).code, 401, '31자 열쇠는 맞아도 401');
        assert.equal(sh.ar.status().configured.automationToken, false);
        const lines = await capture(async () => sh.ar.start());
        assert.equal(lines.filter((l) => /32자보다 짧아/.test(l)).length, 1, '시작 때 콘솔 경고');
        assert.equal(A.sameKey(KEY, KEY), true); assert.equal(A.sameKey('abc', 'abc'), false, '짧은 열쇠'); assert.equal(A.sameKey('', ''), false);
        assert.ok(/createHash\('sha256'\)/.test(fs.readFileSync(path.join(__dirname, '../services/nariya_autorun.js'), 'utf8')), '다이제스트끼리 비교');
    });

    await check('[§3] 조합 열쇠 — 자동화 열쇠가 맞으면 관리자 검사 없이 통과 · 틀리거나 없으면 기존 관리자 검사로 넘김(viaAutomation 없음)', async () => {
        const seen = [];
        const adminCheck = (rq, rs, next) => { seen.push(1); if (rq.get('X-Admin-Token') === 'admin-ok') return next(); return rs.status(401).json({ code: 'ADMIN_AUTH_REQUIRED' }); };
        const { ar } = make({ adminCheck });
        const run = (h) => { let nexted = false; const r = res(), q = req(h); ar.requireAdminOrAutomation(q, r, () => { nexted = true; }); return { nexted, code: r.code, body: r.body, via: q.viaAutomation === true }; };
        const a = run({ 'x-automation-token': KEY });
        assert.equal(a.nexted, true); assert.equal(a.via, true); assert.equal(seen.length, 0);
        const b = run({ 'x-admin-token': 'admin-ok' });
        assert.equal(b.nexted, true); assert.equal(b.via, false, '관리자는 viaAutomation 아님 → 숨김 없이 전부');
        const bad = run({ 'x-automation-token': 'wrong' });
        assert.equal(bad.code, 401); assert.equal(bad.body.code, 'ADMIN_AUTH_REQUIRED');
    });

    // ── done 입력 검증 ───────────────────────────────────────────────────────
    await check('[done] 입력 검증 — run_id·outcome 필수 · id 목록 꼴·개수 · pr_url 은 이 저장소 PR 만 · 글은 제어·방향 문자를 빼고 자른다', async () => {
        const V = (b) => A.validateDone(b);
        assert.equal(V(null).ok, false); assert.equal(V([]).ok, false);
        assert.equal(V({ outcome: 'pr' }).ok, false); assert.equal(V({ run_id: 'a b', outcome: 'pr' }).ok, false);
        assert.equal(V({ run_id: 'ar-1', outcome: 'merged' }).ok, false);
        assert.equal(V({ run_id: 'ar-1', outcome: 'pr', amend_ids: 'chg_1' }).ok, false, 'id 목록은 배열');
        assert.equal(V({ run_id: 'ar-1', outcome: 'pr', amend_ids: ['ok', 'bad id'] }).ok, false, 'id 꼴');
        assert.equal(V({ run_id: 'ar-1', outcome: 'pr', fresh_ids: ['x'.repeat(81)] }).ok, false, 'id 81자');
        assert.equal(V({ run_id: 'ar-1', outcome: 'pr', fresh_ids: [...Array(301)].map((_, i) => 'a' + i) }).ok, false, '301개');
        assert.equal(V({ run_id: 'ar-1', outcome: 'pr', fresh_ids: [...Array(300)].map((_, i) => 'a' + i) }).ok, true, '300개');
        for (const u of ['https://github.com/o/r/pull/1', 'https://github.com/cantatapream/SEAGNAL/pull/1x', 'http://github.com/cantatapream/SEAGNAL/pull/1', 'https://github.com/cantatapream/SEAGNAL/pull/1/files', 'https://evil.example/https://github.com/cantatapream/SEAGNAL/pull/1']) {
            assert.equal(V({ run_id: 'ar-1', outcome: 'pr', pr_url: u }).value.pr_url, null, u);
        }
        assert.equal(V({ run_id: 'ar-1', outcome: 'pr', pr_url: PR(12) }).value.pr_url, PR(12));
        const v = V({ run_id: 'ar-1', outcome: 'pr', summary: 'a‮b\u0007c‏d⁦e\nf' + '가'.repeat(5000), needs_decision: [...Array(30)].map(() => '‪' + '나'.repeat(500)).concat([5, null, '\u0001\u0002']) }).value;
        assert.ok(v.summary.startsWith('abcde\nf'), JSON.stringify(v.summary.slice(0, 10))); assert.equal(v.summary.length, 2000);
        assert.equal(v.needs_decision.length, 20); assert.ok(v.needs_decision.every((x) => x.length === 300 && !x.includes('‪')));
        assert.deepEqual(V({ run_id: 'ar-1', outcome: 'failed', needs_decision: 'x', summary: 7 }).value, { run_id: 'ar-1', outcome: 'failed', pr_url: null, summary: '', needs_decision: [], needs_options: [], amend_ids: [], fresh_ids: [], mok_ids: [], deferred_amend_ids: [], deferred_fresh_ids: [], deferred_mok_ids: [], conflict_ids: [], deferred_conflict_ids: [], answer_ids: [], deferred_answer_ids: [] });
        const { ar, push } = make();
        ar.claim({ run_id: 'c1' });
        const r = ar.done({ run_id: 'c1', outcome: 'nope' });
        assert.equal(r.ok, false); assert.equal(r.status, 400);
        assert.equal(ar.status().lock.run_id, 'c1'); assert.equal(push.sent.length, 0);
        await quiet(async () => { ar.done({ run_id: 'c1', outcome: 'pr', pr_url: PR(7), needs_decision: ['이름 바뀐 고시 동일성', '승격 여부'], summary: '개정 3건 반영' }); await flush(); });
        assert.ok(/반영 끝 · 검사 중/.test(push.sent[0].title) && /결정 필요 2건/.test(push.sent[0].title) && !/머지 버튼을 눌러/.test(push.sent[0].title), push.sent[0].title);
        assert.ok(/검사\(약 20분\)가 끝나면 「앱에서 머지 버튼을 눌러 주세요」 알림을 다시 보냅니다/.test(push.sent[0].body), '검사 중엔 버튼이 잠겨 있다 — 초록이 되면 머지 담당이 다시 알린다(2026-11-18): ' + push.sent[0].body);
        assert.ok(!/개정 3건 반영|http/.test(push.sent[0].body), '세션 요약·주소는 푸시에 안 넣는다(앱 카드에 있음)');
        assert.equal(push.sent[0].data.pr_url, PR(7));
        assert.ok(Object.values(push.sent[0].data).every((x) => typeof x === 'string'), 'FCM data 는 전부 문자열');
    });

    await check('[§9.10] 충돌 — requestRun(conflict) 이 발사 글에 실림 · done 의 conflict_ids/deferred_conflict_ids 는 머지 담당에게 · 「충돌 N건 풀었음 · 검사 중」 푸시 · 못 푼 것은 본문에 · 못 푼 PR 은 14일 쉼 · 경로는 자동화 열쇠', async () => {
        const c = make();
        await quiet(async () => { c.ar.requestRun('conflict', { ids: ['1485'] }); await c.time.advance(10 * MIN); });
        assert.ok(/ conflict=1 answer=0$/.test(c.f.calls[0].body.text), c.f.calls[0].body.text);
        const id = c.ar.status().lock.run_id;
        c.ar.noteServed('conflict', ['1485', '1490']);
        await quiet(async () => { c.ar.done({ run_id: id, outcome: 'nothing', conflict_ids: ['1485'], deferred_conflict_ids: ['1490'] }); await flush(); });
        assert.deepEqual(c.merger.conflictCalls, [[['1485'], ['1490']]]);
        const last = c.push.sent[c.push.sent.length - 1];
        assert.ok(/충돌 1건 풀었음 · 검사 중/.test(last.title) && /PR #1485 의 작업 기록 충돌을 풀어/.test(last.body) && /PR #1490\)은 작업 기록 말고 다른 파일도 겹쳐/.test(last.body), last.title + ' / ' + last.body);
        assert.equal(c.ar.requestRun('conflict', { ids: ['1490'] }).queued, false, '못 푼 PR 은 14일 쉼(같은 PR 로 다시 깨우지 않음)');
        assert.equal(A.validateDone({ run_id: 'x', outcome: 'nothing', conflict_ids: ['bad id!'] }).ok, false);
        const lj = fs.readFileSync(path.join(__dirname, '../routes/legal.js'), 'utf8');
        assert.ok(/router\.get\('\/api\/legal\/autorun\/conflicts', autorun\.requireAdminOrAutomation/.test(lj) && /noteServed\('conflict'/.test(lj), '충돌 목록 경로');
    });
    await check('[§9.11] 결정 필요 답 — requestRun(answer) 발사 글 · done 의 answer_ids/deferred_answer_ids 는 머지 담당에게 · 답만 처리한 nothing 도 알림 · 답 경로는 관리자만 저장·자동화 열쇠로 목록', async () => {
        const c = make();
        await quiet(async () => { c.ar.requestRun('answer', { ids: ['1485-1'] }); await c.time.advance(10 * MIN); });
        assert.ok(/ answer=1$/.test(c.f.calls[0].body.text), c.f.calls[0].body.text);
        const id = c.ar.status().lock.run_id; c.ar.noteServed('answer', ['1485-1']);
        await quiet(async () => { c.ar.done({ run_id: id, outcome: 'nothing', answer_ids: ['1485-1'], summary: '답대로 도구를 고쳤습니다.' }); await flush(); });
        assert.deepEqual(c.merger.answerCalls, [[['1485-1'], []]]);
        const lj = fs.readFileSync(path.join(__dirname, '../routes/legal.js'), 'utf8');
        assert.ok(/router\.post\('\/api\/legal\/autorun\/prs\/:n\/answer', adminAuth\.requireAdminToken/.test(lj) && /router\.get\('\/api\/legal\/autorun\/answers', autorun\.requireAdminOrAutomation/.test(lj));
        const cj = fs.readFileSync(path.join(__dirname, '../../client/js/ai-chat/ai_chat.js'), 'utf8');
        assert.ok(/data-ans-send/.test(cj) && /\/answer'/.test(cj), '앱 답 칸');
    });

    // ── 상태 파일 방어(F17) ──────────────────────────────────────────────────
    await check('[파일] 미래 시각 잠금은 버림 · 깨진 파일은 .corrupt-<시각> 으로 옮김 · 이상한 값은 걸러냄 · 마지막 읽기·저장 오류를 status 에', async () => {
        const f1 = newFile();
        fs.writeFileSync(f1, JSON.stringify({ v: 1, lock: { run_id: 'future', since: T0 + 10 * DAY, source: 'claim' }, pending: { reasons: { amend: '5', fresh: 1e308 } }, lastDone: [1, 2] }));
        const a = make({ file: f1 });
        await quiet(async () => { const st = a.ar.status(); assert.equal(st.lock, null, '미래 잠금 버림'); assert.equal(st.pending, null, '문자열·터무니없는 건수는 버림'); assert.equal(st.lastDone, null); assert.ok(/미래 시각/.test(st.errors.read.error), JSON.stringify(st.errors)); });
        const f2 = newFile();
        fs.writeFileSync(f2, JSON.stringify({ v: 1, lock: { run_id: '<img src=x>', since: T0 - 1, source: 'claim' } }));
        assert.equal(make({ file: f2 }).ar.status().lock, null, 'run_id 꼴이 틀린 잠금은 버림');
        const f3 = newFile();
        fs.writeFileSync(f3, '{"v":1,"lock":');
        const c = make({ file: f3 });
        await quiet(async () => { c.ar.requestRun('amend'); });
        assert.ok(fs.existsSync(f3 + '.corrupt-' + T0), '깨진 파일을 옮겨 둔다');
        assert.equal(fs.readFileSync(f3 + '.corrupt-' + T0, 'utf8'), '{"v":1,"lock":');
        assert.ok(/깨진 파일/.test(c.ar.status().errors.read.error));
        const d = make({ file: path.join(tmp, 'regular-file', 's.json') });
        fs.writeFileSync(path.join(tmp, 'regular-file'), 'x');
        await quiet(async () => { d.ar.requestRun('amend'); });
        assert.ok(d.ar.status().errors.save && d.ar.status().errors.save.error, '저장 오류가 status 에');
        assert.deepEqual(d.ar.status().pending.reasons, { amend: 1 }, '저장 못 해도 메모리로 계속');
    });

    // ── 연결(소스 확인) — 서버를 띄우지 않고 배선이 있는지만 본다 ──────────────
    await check('[연결] legal.js — 새 승인만 requestRun(try/catch) · 다섯 경로 조합 열쇠 · 자동화 호출만 inFlight 숨김 · 승인 경로는 관리자 토큰만 · done 은 기다리지 않음', () => {
        const src = fs.readFileSync(path.join(__dirname, '../routes/legal.js'), 'utf8');
        assert.ok(/const wasApproved = !!before && \(before\.status \|\| 'pending'\) === 'approved';/.test(src), 'decide 이전 상태');
        assert.ok(/if \(decision === 'approved' && !wasApproved\) \{\s*try \{ autorun\.requestRun\('amend', \{ count: 1 \}\); \} catch/.test(src), 'decide');
        assert.ok(/if \(\(t\.status \|\| 'pending'\) !== 'approved'\) newlyApproved\+\+;/.test(src), 'decide-all 새 승인만 셈');
        assert.ok(/if \(decision === 'approved' && newlyApproved > 0\) \{\s*try \{ autorun\.requestRun\('amend', \{ count: newlyApproved \}\); \} catch/.test(src), 'decide-all');
        for (const p of ["get('/api/legal/amendments/wiki-brief-all'", "get('/api/legal/freshness'", "post('/api/legal/autorun/claim'", "post('/api/legal/autorun/done'", "get('/api/legal/autorun/status'"]) {
            assert.ok(src.includes('router.' + p + ', autorun.requireAdminOrAutomation'), p);
        }
        for (const p of ["post('/api/legal/amendments/:id/decide'", "post('/api/legal/amendments/decide-all'", "post('/api/legal/freshness/:id/decide'", "post('/api/legal/config'"]) {
            assert.ok(src.includes('router.' + p + ', adminAuth.requireAdminToken'), p + ' 는 관리자만');
        }
        assert.ok(/skippedApplied = w\.skipped;\s*\}\s*\/\/ \[자동 반영\][^\n]*\n\s*if \(req\.viaAutomation\) \{\s*const hid = autorun\.hiddenIds\(\{ applied: amendmentScanner\.loadWikiApplied\(\) \}\);/.test(src), 'wiki-brief-all: withoutApplied 바로 뒤에서 뺀다');
        assert.ok(/if \(req\.viaAutomation\) \{[\s\S]{0,200}autorun\.hiddenIds\(\{ freshCards: new Map\(all\.map/.test(src), 'freshness: 자동화 호출만');
        assert.ok(/const status = req\.viaAutomation \? 'approved' : \(req\.query\.status \|\| 'approved'\);/.test(src), '[D8②] 자동화 호출은 승인분으로 고정');
        assert.ok(/if \(req\.viaAutomation\) list = list\.filter\(\(e\) => \(e\.status \|\| 'pending'\) === 'approved'\);/.test(src), '[D8②] ids= 로 집어도 승인분만');
        assert.ok(/const r = autorun\.done\(req\.body\);/.test(src) && !/await autorun\.done/.test(src), 'done 응답은 푸시를 기다리지 않는다');
        const sc = fs.readFileSync(path.join(__dirname, '../services/admrul_fresh_scanner.js'), 'utf8');
        assert.ok(/if \(fresh\.length \|\| reopened\.length\) \{[\s\S]*?requestRun\('fresh', \{ count: fresh\.length \+ reopened\.length \}\)/.test(sc), '원문신선도 — 다시 뜬 카드만 있어도');
        const sv = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
        assert.ok(/require\('\.\/services\/nariya_autorun'\)\.start\(\)/.test(sv), 'server.js 시작 복원');
        const near = sv.slice(sv.indexOf("require('./services/nariya_autorun').start()") - 400, sv.indexOf("require('./services/nariya_autorun').start()"));
        assert.ok(/FLY_APP_NAME === 'seagnal-server'/.test(near) && !/FLY_ALLOC_ID/.test(near), '[D8①] server.js 주석이 실제 판정과 같다');
    });

    // ── 2026-11-16 남은 일 점검·자동 승인 (설계안 §8) ───────────────────────────
    await check('[§8 #1] 내준 일 → done pr/nothing 이면 deferred_*_ids 에 실은 것만 seen(14일) — 손대지 않은 나머지는 다시 넘긴다 · 내주지 않은 id 를 deferred 로 실어도 무시 · ids 없으면 늘 넣는다', async () => {
        const c = make();
        const id = await fired(c, 'amend', 3);
        assert.equal(c.ar.noteServed('amend', ['chg_a', 'chg_b', 'chg_c']), true);
        assert.equal(c.ar.noteServed('fresh', ['adf_1']), true);
        await quiet(async () => { c.ar.done({ run_id: id, outcome: 'pr', pr_url: PR(3), amend_ids: ['chg_a'], deferred_amend_ids: ['chg_b', 'chg_zz'], deferred_fresh_ids: ['adf_1'], needs_decision: ['chg_b 폴더 결정'] }); });
        assert.equal(c.ar.status().seen, 2, 'chg_b·adf_1 만(chg_zz 는 내준 적 없음)');
        const r1 = c.ar.requestRun('amend', { ids: ['chg_b'] });
        assert.equal(r1.queued, false); assert.equal(r1.seen, 1);
        const r2 = c.ar.requestRun('amend', { ids: ['chg_b', 'chg_c'] });
        assert.equal(r2.queued, true, '손대지 않은 chg_c 는 다시 넘긴다(적대검증 #2)'); assert.deepEqual(c.ar.status().pending.reasons, { amend: 1 });
        assert.equal(c.ar.requestRun('fresh', { ids: ['adf_1'] }).queued, false, 'fresh 도 같은 규칙');
        assert.equal(c.ar.requestRun('fresh', { count: 1 }).queued, true, 'ids 없이 부르면 예전처럼 늘 넣는다(사람의 승인 버튼)');
        // 14일 뒤 잊음
        await quiet(() => c.time.advance(15 * DAY));
        assert.equal(c.ar.requestRun('amend', { ids: ['chg_b'] }).queued, true, '14일 지나면 다시 깨운다');
    });
    await check('[§8 #2] done failed → 내준 일 전부 3일 쉼(매일 실패 고리 막기, 적대검증 #3) · 3시간 응답 없음도 3일 쉼 · 잠금 없을 때 noteServed 는 아무것도 안 함', async () => {
        const c = make();
        assert.equal(c.ar.noteServed('amend', ['chg_x']), false, '잠금 없음');
        const id = await fired(c);
        c.ar.noteServed('amend', ['chg_x']);
        await quiet(async () => { c.ar.done({ run_id: id, outcome: 'failed', summary: '수집 실패' }); });
        assert.equal(c.ar.requestRun('amend', { ids: ['chg_x'] }).queued, false, '실패 직후엔 쉰다');
        await quiet(() => c.time.advance(3 * DAY + MIN));
        assert.equal(c.ar.requestRun('amend', { ids: ['chg_x'] }).queued, true, '3일 뒤 다시 넘긴다');
        // 응답 없음(3시간 만료)
        const d = make();
        await fired(d);
        d.ar.noteServed('fresh', ['adf_q']);
        await quiet(() => d.time.advance(3 * HOUR + MIN));
        assert.equal(d.ar.status().lock, null);
        assert.equal(d.ar.requestRun('fresh', { ids: ['adf_q'] }).queued, false, '죽은 세션의 일도 3일 쉰다');
    });
    await check('[§8 #3] sweep — 잠금 중이면 아무것도 안 함 · 대기(깨우기 실패)가 있으면 다시 쏨 · 남은 일이 새것이면 깨움 · 결정 대기뿐이면 안 깨움 · 없으면 none · 목록 못 읽음은 푸시', async () => {
        const c = make();
        const id = await fired(c);
        let r = c.ar.sweep({ amend: ['chg_1'], fresh: [] });
        assert.equal(r.action, 'locked'); assert.equal(c.ar.status().pending, null, '잠금 중 — 일하는 세션이 다 꺼내 간다');
        c.ar.noteServed('amend', ['chg_1']);
        await quiet(async () => { c.ar.done({ run_id: id, outcome: 'nothing', deferred_amend_ids: ['chg_1'], needs_decision: ['폴더'] }); });
        await quiet(async () => { r = c.ar.sweep({ amend: ['chg_1'], fresh: [] }); });
        assert.equal(r.action, 'seen'); assert.equal(c.ar.status().pending, null);
        await quiet(async () => { r = c.ar.sweep({ amend: ['chg_1', 'chg_2'], fresh: ['adf_9'] }); });
        assert.equal(r.action, 'requested'); assert.deepEqual(c.ar.status().pending.reasons, { amend: 1, fresh: 1 });
        const n0 = c.f.calls.length;
        await quiet(() => c.time.advance(10 * MIN));
        assert.equal(c.f.calls.length, n0 + 1, '10분 뒤 깨운다');
        assert.equal(c.ar.status().lastSweep.action, 'requested');
        const e = make();
        e.f.mode = 'http500';
        await quiet(async () => { e.ar.requestRun('amend', { count: 1 }); await e.time.advance(10 * MIN); });
        assert.ok(e.ar.status().pending, '실패 — 대기 유지');
        e.f.mode = 'ok';
        await quiet(async () => { r = e.ar.sweep({ amend: [], fresh: [] }); await e.time.advance(10 * MIN); });
        assert.equal(r.action, 'pending'); assert.equal(e.f.calls.length, 2); assert.ok(e.ar.status().lock);
        const g = make();
        await quiet(async () => { r = g.ar.sweep({ amend: [], fresh: [], errors: ['개정: ENOENT'] }); await flush(); });
        assert.equal(r.action, 'none'); assert.deepEqual(g.ar.status().lastSweep.errors, ['개정: ENOENT']);
        assert.equal(titles(g.push, /남은 일 점검 실패/).length, 1, '못 읽음은 「남은 일 없음」이 아니다(L-291)');
    });
    await check('[§8 #4] seen·served 는 파일에 남는다 · 깨진 항목 거름 · 3시간 만료 뒤 같은 run 이 다시 claim 하면 served 를 이어받고, 늦은 done 도 만료 기록의 served 를 쓴다(적대검증 #6)', async () => {
        const c = make();
        const id = await fired(c);
        c.ar.noteServed('fresh', ['adf_k', 'adf_k', 'bad id!']);
        const raw = JSON.parse(fs.readFileSync(c.file, 'utf8'));
        assert.deepEqual(raw.lock.served.fresh, ['adf_k'], '중복·꼴 틀린 id 는 빠진다');
        const c2 = make({ file: c.file, time: c.time });
        assert.deepEqual(c2.ar._state().lock.served.fresh, ['adf_k'], '재시작 뒤 served 복원');
        await quiet(async () => { c2.ar.done({ run_id: id, outcome: 'nothing', deferred_fresh_ids: ['adf_k'] }); });
        const st = JSON.parse(fs.readFileSync(c.file, 'utf8'));
        st.seen.push({ kind: 'amend', id: 'x', at: 'nope' }, { kind: 'zzz', id: 'y', at: 1 });
        fs.writeFileSync(c.file, JSON.stringify(st));
        const c3 = make({ file: c.file, time: c.time });
        assert.deepEqual(c3.ar._state().seen.map((x) => x.id), ['adf_k']);
        assert.equal(c3.ar.requestRun('fresh', { ids: ['adf_k'] }).queued, false);
        // relock
        const d = make();
        await quiet(() => { d.ar.claim({ run_id: 'long-1' }); });
        d.ar.noteServed('amend', ['chg_r']);
        await quiet(() => d.time.advance(3 * HOUR + MIN));
        await quiet(() => { assert.equal(d.ar.claim({ run_id: 'long-1' }).relocked, true); });
        assert.deepEqual(d.ar._state().lock.served.amend, ['chg_r']);
        await quiet(async () => { d.ar.done({ run_id: 'long-1', outcome: 'nothing', deferred_amend_ids: ['chg_r'] }); });
        await quiet(() => d.time.advance(4 * DAY));
        assert.equal(d.ar.requestRun('amend', { ids: ['chg_r'] }).queued, false, 'relock 뒤 결정 필요 → 14일');
        // late done
        const e = make();
        await quiet(() => { e.ar.claim({ run_id: 'late-1' }); });
        e.ar.noteServed('amend', ['chg_l']);
        await quiet(() => e.time.advance(3 * HOUR + MIN));
        await quiet(async () => { assert.equal(e.ar.done({ run_id: 'late-1', outcome: 'nothing', deferred_amend_ids: ['chg_l'] }).late, true); });
        await quiet(() => e.time.advance(4 * DAY));
        assert.equal(e.ar.requestRun('amend', { ids: ['chg_l'] }).queued, false, '늦은 done 도 결정 필요 → 14일');
    });
    await check('[§8 #6] 새벽 점검 사슬 동안 깨우기 보류(setHold) — 대기는 쌓이고, 풀면 10분 뒤 발사 · 6시간 뒤 저절로 풀림(적대검증 #4·#5)', async () => {
        const c = make();
        await quiet(async () => {
            c.ar.setHold(true);
            c.ar.requestRun('amend', { count: 2 });
            await c.time.advance(30 * MIN);
        });
        assert.equal(c.f.calls.length, 0, '보류 중엔 안 쏜다'); assert.deepEqual(c.ar.status().pending.reasons, { amend: 2 }); assert.ok(c.ar.status().hold);
        await quiet(async () => { c.ar.setHold(false); await c.time.advance(10 * MIN); });
        assert.equal(c.f.calls.length, 1, '풀면 10분 뒤'); assert.equal(c.ar.status().hold, null);
        const d = make();
        await quiet(async () => { d.ar.setHold(true); d.ar.requestRun('fresh', { count: 1 }); await d.time.advance(6 * HOUR + 10 * MIN + MIN); });
        assert.equal(d.f.calls.length, 1, '사슬이 죽어도 6시간 뒤 풀린다');
    });
    await check('[§8 #5] 개정 감지 즉시 자동 승인(autoApprove) · 탐지 큐에 옮겨 적고 ids 와 함께 requestRun · 푸시 문구 · 원문신선도는 ids 없음 · 새벽 03:00 하루 하나씩(보류→오늘 차례 점검→풀기→남은 일 점검)', () => {
        const S = require('../services/legal_amendment_scanner');
        const src0 = [{ id: 'chg_1', status: 'pending', 법령명: 'x' }];
        const out = S.autoApprove(src0, '2026-11-16T00:00:00.000Z');
        assert.deepEqual(out[0], { id: 'chg_1', status: 'approved', 법령명: 'x', decidedBy: '자동(감지 즉시)', decidedAt: '2026-11-16T00:00:00.000Z' });
        assert.equal(src0[0].status, 'pending', '원본은 안 바꾼다');
        const src = fs.readFileSync(path.join(__dirname, '../services/legal_amendment_scanner.js'), 'utf8');
        const body = src.slice(src.indexOf('async function runAmendmentScan'), src.indexOf('async function notifyAdmins'));
        assert.ok(/const cards = autoApprove\(relevant\.map\(toLegacyEntry\)/.test(body), '적재 전에 승인');
        assert.ok(/mirrorDecisionToH29\(c\.id, 'approved'\)/.test(body), '탐지 큐에도 승인');
        assert.ok(/requestRun\('amend', \{ count: cards\.length, ids: cards\.map/.test(body) && /catch \(e\)/.test(body), 'ids 와 함께 · 실패해도 감지는 그대로');
        assert.ok(/자동 승인했습니다/.test(src) && !/개정검토 방에서 승인하고/.test(src), '푸시가 더는 「승인하세요」라고 하지 않는다');
        const sc = fs.readFileSync(path.join(__dirname, '../services/admrul_fresh_scanner.js'), 'utf8');
        assert.ok(/requestRun\('fresh', \{ count: fresh\.length \+ reopened\.length \}\)/.test(sc), '원문신선도는 ids 를 안 넘긴다 — 「다시 뜬 카드만 있어도 깨운다」 그대로(적대검증 #9)');
        const lj = fs.readFileSync(path.join(__dirname, '../routes/legal.js'), 'utf8');
        assert.ok(/if \(req\.viaAutomation\) \{ try \{ autorun\.noteServed\('amend'/.test(lj), 'wiki-brief-all 이 내준 id 를 적는다');
        assert.ok(/if \(status === 'pending' && list\.length\) \{ try \{ autorun\.noteServed\('fresh'/.test(lj), 'freshness 가 내준 카드를 적는다');
        const sv = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
        const chain = sv.slice(sv.indexOf('async function runNariyaNightly'), sv.indexOf("cron.schedule('0 3 * * *'"));
        assert.ok(/const which = ar\.nightlyScanFor\(Date\.now\(\)\)/.test(chain), '오늘 차례를 nightlyScanFor 로 고른다');
        assert.ok(chain.indexOf('ar.setHold(true)') >= 0 && chain.indexOf('ar.setHold(true)') < chain.indexOf('runAmendmentScan()'), '점검 전에 깨우기 보류');
        assert.ok(/\} finally \{[\s\S]*ar\.setHold\(false\)[\s\S]*ar\.sweep\(ar\.collectOutstanding\(\)\)/.test(chain), '끝나면(실패해도) 풀고 남은 일 점검');
        assert.ok(!/cron\.schedule\('0 3 \* \* 0'/.test(sv) && !/cron\.schedule\('30 4/.test(sv) && !/cron\.schedule\('0 1 \* \* \*'/.test(sv), '옛 일요일·01:00·04:30 cron 없음');
        // 하루 하나씩 돌려 가며(사용자 「하루 개정 하루는 결손 하루는 낡음 이런식으로 새벽 3시마다」)
        const at = (d) => A.nightlyScanFor(Date.parse(d + 'T03:00:00+09:00'));
        const seq = ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23'].map(at);
        assert.deepEqual(seq, ['amend', 'mok', 'fresh', 'amend', 'mok', 'fresh'], '개정 → 결손 → 낡음 순환 · 3일에 한 번씩');
        assert.equal(A.nightlyScanFor(Date.parse('2026-11-18T00:10:00+09:00')), 'amend', 'KST 날짜로 고른다(UTC 로는 전날)');
        assert.equal(A.nightlyScanFor(Date.parse('2026-11-18T23:59:00+09:00')), 'amend');
    });

    await check('[§8 #7] 원문결손(mok) — 대기·발사 글에 실림 · 내준 일·결정 필요·PR(inFlight) 규칙이 개정·신선도와 같음 · 결손 점검기가 자동으로 닫은 카드만 inFlight 에서 풀림 · 연결(사용자 「자동슈정」)', async () => {
        const c = make();
        await quiet(async () => { c.ar.requestRun('mok', { count: 3 }); await c.time.advance(10 * MIN); });
        assert.ok(/ mok=3 conflict=0 answer=0$/.test(c.f.calls[0].body.text), c.f.calls[0].body.text);
        const id = c.ar.status().lock.run_id;
        c.ar.noteServed('mok', ['mok_a', 'mok_b', 'mok_c']);
        await quiet(async () => { c.ar.done({ run_id: id, outcome: 'pr', pr_url: PR(9), mok_ids: ['mok_a'], deferred_mok_ids: ['mok_b'] }); });
        assert.equal(c.ar.requestRun('mok', { ids: ['mok_b'] }).queued, false, '결정 필요 → 쉼');
        assert.deepEqual([...c.ar.hiddenIds({}).mok], ['mok_a'], 'PR 에 실린 결손 카드는 숨김');
        assert.deepEqual([...c.ar.hiddenIds({ mokCards: new Map([['mok_a', { status: 'done', decidedBy: '관리자' }]]) }).mok], ['mok_a'], '손으로 닫은 것은 안 풀림');
        assert.deepEqual([...c.ar.hiddenIds({ mokCards: new Map([['mok_a', { status: 'done', auto_resolved: true }]]) }).mok], [], '점검기가 자동으로 닫으면 풀림');
        assert.equal(c.ar.status().inFlight.length, 0);
        let r; await quiet(async () => { r = c.ar.sweep({ amend: [], fresh: [], mok: ['mok_b', 'mok_c'] }); });
        assert.equal(r.action, 'requested'); assert.deepEqual(c.ar.status().pending.reasons, { mok: 1 }, '손대지 않은 mok_c 만');
        assert.equal(A.validateDone({ run_id: 'x', outcome: 'pr', mok_ids: ['bad id'] }).ok, false);
        const lj = fs.readFileSync(path.join(__dirname, '../routes/legal.js'), 'utf8');
        assert.ok(/router\.get\('\/api\/legal\/mok-audit\/brief-all', autorun\.requireAdminOrAutomation/.test(lj), '결손 지시문을 자동화 열쇠로');
        assert.ok(/const idsQ = req\.viaAutomation \? \[\] :/.test(lj) && /autorun\.noteServed\('mok'/.test(lj) && /hid\.mok\.has/.test(lj), '자동화는 대기만·inFlight 빼고·내준 id 기록');
        assert.ok(/router\.post\('\/api\/legal\/mok-audit\/decide-all', adminAuth\.requireAdminToken/.test(lj) && /router\.post\('\/api\/legal\/mok-audit\/:id\/decide', adminAuth\.requireAdminToken/.test(lj), '카드 처리는 여전히 관리자만');
        const ms = fs.readFileSync(path.join(__dirname, '../services/mok_audit_scanner.js'), 'utf8');
        assert.ok(/if \(fresh\.length \|\| reopened\.length\) \{[\s\S]*?requestRun\('mok', \{ count: fresh\.length \+ reopened\.length \}\)/.test(ms), '결손 점검이 새로·다시 뜬 카드로 깨움');
    });

    await check('[§8 #8] 대기 중이던 개정 카드 일괄 자동 승인(approveAllPending) — pending 만 approved · 이미 승인/기각은 그대로 · 푸시 1통 · 대기 없으면 푸시 없음 · 새벽 점검 끝(보류 풀기·남은 일 점검 앞)에서 부름', async () => {
        const S = require('../services/legal_amendment_scanner');
        const qf = path.join(tmp, 'amend_queue.jsonl');
        fs.writeFileSync(qf, [{ id: 'chg_p1' }, { id: 'chg_p2', status: 'pending' }, { id: 'chg_a', status: 'approved' }, { id: 'chg_d', status: 'dismissed' }].map((x) => JSON.stringify(x)).join('\n') + '\n');
        const sent = [];
        const push = async (t, b, d) => { sent.push({ t, b, d }); return { sent: 1 }; };
        const r = await S.approveAllPending({ file: qf, at: '2026-11-17T03:20:00.000Z', push });
        assert.deepEqual(r.approved, ['chg_p1', 'chg_p2']);
        const rows = fs.readFileSync(qf, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
        assert.deepEqual(rows.map((x) => x.status), ['approved', 'approved', 'approved', 'dismissed'], '기각은 그대로');
        assert.equal(rows[0].decidedBy, '자동(대기분 일괄)');
        assert.equal(sent.length, 1); assert.ok(/대기 중이던 개정 2건 자동 승인/.test(sent[0].t)); assert.ok(Object.values(sent[0].d).every((x) => typeof x === 'string'));
        const r2 = await S.approveAllPending({ file: qf, push });
        assert.deepEqual(r2.approved, []); assert.equal(sent.length, 1, '대기 없으면 푸시 없음');
        const sv = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
        const nightly = sv.slice(sv.indexOf('async function runNariyaNightly'), sv.indexOf("cron.schedule('0 3 * * *'"));
        const iA = nightly.indexOf('approveAllPending()'), iH = nightly.indexOf('ar.setHold(false)'), iS = nightly.indexOf('ar.sweep(');
        assert.ok(iA > 0 && iA < iH && iH < iS && /\} finally \{/.test(nightly.slice(0, iA)), 'finally 안에서 승인 → 풀기 → 남은 일 점검');
    });

    await check('[§9] C(조건부 자동 머지) — done pr 은 머지 담당에게 넘김 · 결정 필요 0건 → 「검사 통과하면 자동 머지(누를 것 없음)」 · 있으면 제목·본문에 「앱에서 머지 버튼」 · pr 아닌 done 은 안 넘김', async () => {
        const a = make();
        const id = await fired(a);
        await quiet(async () => { a.ar.done({ run_id: id, outcome: 'pr', pr_url: PR(21), summary: '개정 2건' }); await flush(); });
        assert.equal(a.merger.tracked.length, 1); assert.equal(a.merger.tracked[0].pr_url, PR(21));
        const t = titles(a.push, /나리야 자동 반영 — 반영 끝 · 검사 중/);
        assert.equal(t.length, 1, a.push.sent.map((x) => x.title).join('|'));
        assert.ok(/검사\(약 20분\)가 끝나면 결과를 알려 드립니다/.test(t[0].body) && !/누를 것 없습니다/.test(t[0].body), t[0].body); assert.equal(t[0].data.merge, 'auto');
        const b = make();
        const id2 = await fired(b);
        await quiet(async () => { b.ar.done({ run_id: id2, outcome: 'pr', pr_url: PR(22), needs_decision: ['고시 폴더'], summary: '신선도 1건' }); await flush(); });
        const h = b.push.sent[b.push.sent.length - 1];
        assert.ok(/반영 끝 · 검사 중/.test(h.title) && /결정 필요 1건/.test(h.title), h.title);
        assert.ok(/「앱에서 머지 버튼을 눌러 주세요」 알림을 다시 보냅니다/.test(h.body) && /「자동반영」 방에서 볼 수 있습니다/.test(h.body), h.body); assert.equal(h.data.merge, 'human');
        const c = make();
        const id3 = await fired(c);
        await quiet(async () => { c.ar.done({ run_id: id3, outcome: 'failed', pr_url: PR(23), summary: 'x' }); c.ar.done({ run_id: 'other', outcome: 'nothing' }); await flush(); });
        assert.equal(c.merger.tracked.length, 0, 'pr 이 아니면 머지 담당에게 안 넘김');
        const lj = fs.readFileSync(path.join(__dirname, '../routes/legal.js'), 'utf8');
        assert.ok(/router\.get\('\/api\/legal\/autorun\/prs', adminAuth\.requireAdminToken/.test(lj) && /router\.post\('\/api\/legal\/autorun\/prs\/:n\/merge', adminAuth\.requireAdminToken/.test(lj), '목록·머지는 관리자 토큰만(자동화 열쇠 아님)');
        const cj = fs.readFileSync(path.join(__dirname, '../../client/js/ai-chat/ai_chat.js'), 'utf8');
        assert.ok(/ADMIN_ORDER = \['⚠수치검증', '자동반영'/.test(cj) && /renderAutorunCards\(document\.getElementById\('nryaAutorunHost'\)\)/.test(cj), '앱 「자동반영」 방');
        assert.ok(/legalPost\('\/api\/legal\/autorun\/prs\/' \+ encodeURIComponent\(n\) \+ '\/merge'/.test(cj) && /한 번 더 누르면 실행/.test(cj), '머지 버튼은 두 번 눌러야');
        const sv = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
        assert.ok(/require\('\.\/services\/nariya_pr_merge'\)\.start\(\)/.test(sv), '시작 때 검사 기다리던 PR 되살림');
    });

    await check('[§9 적대검증 C] 잠금 주인만 자동 머지 후보(owner·runSince=일 시작 시각 — 심장박동과 무관) · 아무 run_id 로 보낸 done 은 사람 몫 · PR 주소 끝 공백·/ 허용 · 주소를 못 읽거나 맡지 못하면 「GitHub 에서 확인」', async () => {
        const a = make();
        const id = await fired(a);
        const started = a.ar._state().lock.startedAt;
        await quiet(() => a.time.advance(30 * MIN));
        await quiet(() => { a.ar.claim({ run_id: id }); });                     // 심장박동 — since 는 바뀌어도 startedAt 은 그대로
        assert.equal(a.ar._state().lock.startedAt, started);
        await quiet(async () => { a.ar.done({ run_id: id, outcome: 'pr', pr_url: PR(31) + '/\n' }); await flush(); });
        assert.equal(a.merger.tracked[0].pr_url, PR(31), '끝 / · 줄바꿈 떼고 받음');
        assert.deepEqual(a.merger.opts[0], { owner: true, runSince: started });
        const b = make();
        await quiet(async () => { b.ar.done({ run_id: 'forged-1', outcome: 'pr', pr_url: PR(32) }); await flush(); });
        assert.equal(b.merger.opts[0].owner, false, '잠금 기록이 없는 run');
        assert.ok(/반영 끝 · 검사 중/.test(b.push.sent[0].title) && /머지 버튼을 눌러 주세요」 알림을 다시/.test(b.push.sent[0].body), b.push.sent[0].title);
        const c = make();
        const id3 = await fired(c);
        await quiet(async () => { c.ar.done({ run_id: id3, outcome: 'pr', pr_url: 'https://github.com/evil/x/pull/1' }); await flush(); });
        assert.equal(c.merger.tracked.length, 0);
        const t = c.push.sent[c.push.sent.length - 1];
        assert.ok(/PR 을 맡지 못함 · GitHub 에서 확인해 주세요/.test(t.title) && /PR 주소를 읽지 못함/.test(t.body) && /카드가 없습니다/.test(t.body), t.title + ' / ' + t.body);
        // 적대검증 중1 — 이미 맡은 PR 이 머지됨·사람 차례(지켜보지 않음)면 「검사 끝나면 알림」을 약속하지 않는다
        for (const [st, re] of [['merged', /이미 머지됐습니다/], ['needs_human', /이미 사람 확인 차례/]]) {
            const g = make(); g.merger.reply = { tracked: true, updated: true, mode: 'human', how: 'button', status: st };
            const idg = await fired(g);
            await quiet(async () => { g.ar.done({ run_id: idg, outcome: 'pr', pr_url: PR(35), needs_decision: ['x'] }); await flush(); });
            const last = g.push.sent[g.push.sent.length - 1];
            assert.ok(!/알림을 다시 보냅니다/.test(last.body) && re.test(last.body) && /앱에서 확인해 주세요/.test(last.title), st + ': ' + last.title + ' / ' + last.body);
        }
        const d = make(); d.merger.refuse = '이미 맡은 PR';
        const id4 = await fired(d);
        await quiet(async () => { d.ar.done({ run_id: id4, outcome: 'pr', pr_url: PR(33) }); await flush(); });
        assert.ok(/GitHub 에서 확인해 주세요/.test(d.push.sent[d.push.sent.length - 1].title));
        // 3시간 만료 뒤 같은 run 의 늦은 완료 — 만료 기록의 startedAt 으로 주인
        const e = make();
        const id5 = await fired(e);
        const st5 = e.ar._state().lock.startedAt;
        await quiet(() => e.time.advance(3 * HOUR + MIN));
        await quiet(async () => { e.ar.done({ run_id: id5, outcome: 'pr', pr_url: PR(34) }); await flush(); });
        assert.deepEqual(e.merger.opts[0], { owner: true, runSince: st5 });
    });

    await check('[§8.10] 새벽 점검 처리 결과 요약 푸시(nightlySummary) — 아무것도 없어도 「이상 없음」 · 찾음·처리할 일·실패를 제목에 · 자동 승인·세션·내일 차례 · 매일 한 통 보냄(사용자 「매일마다 … 완료되었다는 푸시알림」)', () => {
        const S = A.nightlySummary;
        let m = S({ which: 'fresh', scan: { ok: true, checked: 1504, stale: 0, added: 0, reopened: 0 }, approved: 0, sweep: { action: 'none' }, tomorrow: 'amend' });
        assert.equal(m.title, '나리야 새벽 점검 완료 — 원문신선도 · 이상 없음'); assert.equal(m.failed, false);
        assert.ok(/원문신선도: 1,504건 대조 · 새로 낡은 원문 없음/.test(m.body) && /자동 반영할 일 없음/.test(m.body) && /내일 차례: 개정감지/.test(m.body), m.body);
        m = S({ which: 'fresh', scan: { ok: true, checked: 1504, added: 2, reopened: 1, autoClosed: 3 }, approved: 44, sweep: { action: 'requested' }, tomorrow: 'amend' });
        assert.ok(/처리할 일 있음/.test(m.title)); assert.ok(/낡은 원문 새로 2건 · 다시 뜬 1건/.test(m.body) && /현행 확인돼 닫은 3건/.test(m.body) && /대기 중이던 개정 44건 자동 승인/.test(m.body) && /세션을 곧 깨웁니다/.test(m.body), m.body);
        m = S({ which: 'amend', scan: { scanned: 12, changed: 0, errors: 1 }, sweep: { action: 'none' } });
        assert.ok(/⚠확인 필요/.test(m.title) && /확인하지 못했습니다\(「개정 없음」이 아닙니다\)/.test(m.body), '개정감지 실패는 「없음」으로 쓰지 않는다');
        m = S({ which: 'amend', scan: { scanned: 30, changed: 3, errors: 0 }, sweep: { action: 'locked' } });
        assert.ok(/새로 찾음/.test(m.title) && /새 개정 3건 감지 · 자동 승인/.test(m.body) && /이미 일하는 중/.test(m.body), m.title + ' / ' + m.body);
        m = S({ which: 'mok', scan: { ok: false, error: '점검이 이미 진행 중입니다.' }, sweep: { action: 'seen' } });
        assert.ok(m.failed && /원문결손: 점검 실패 — 점검이 이미 진행 중/.test(m.body) && /결정 대기뿐/.test(m.body));
        m = S({ which: 'mok', scanError: 'spawn ENOENT', sweepError: 'x' });
        assert.ok(m.failed && /끝나지 못했습니다 — spawn ENOENT/.test(m.body) && /남은 일 점검 실패/.test(m.body));
        const sv = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
        const nightly = sv.slice(sv.indexOf('async function runNariyaNightly'), sv.indexOf("cron.schedule('0 3 * * *'"));
        const iS = nightly.indexOf('sweep = ar.sweep('), iP = nightly.indexOf('ar.nightlySummary(');
        assert.ok(iS > 0 && iP > iS && /\} finally \{/.test(nightly.slice(0, iS)), 'finally 안에서 남은 일 점검 뒤에 요약');
        assert.ok(/sendAdminPush\(m\.title, m\.body, \{ type: 'nariya_nightly_done'/.test(nightly), '조건 없이 매일 보낸다');
    });

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
})();
