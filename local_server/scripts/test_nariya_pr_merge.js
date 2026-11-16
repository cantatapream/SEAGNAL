/**
 * ============================================================================
 * 파일명: scripts/test_nariya_pr_merge.js
 * 역할: 자동 반영 PR 의 조건부 자동 머지(services/nariya_pr_merge.js)를 고정한다 — 설계안(services/nariya_autorun.design.md) §9
 *       (초보자용: 「결정 필요 0건 + 검사 초록이면 서버가 머지, 아니면 앱 머지 버튼」이 정말 그렇게 도는지 가짜 GitHub 로 본다.)
 * ============================================================================
 * [무엇을 검사하나]
 *  J  judge — 공통 조건 + 자동 전용(결정 필요·허용 경로·잠금 주인·세션 시작 뒤 PR) · stale(검사 뒤 main 바뀜)
 *  T  track — 주인·결정 필요 0건·열쇠면 auto, 아니면 human · 이미 맡은 PR 에 결정 필요가 오면 사람 몫으로 내림
 *  A1~A6 자동 머지 — 초록이면 검사한 sha 로 머지 · 범위 밖/주인 아님 → 앱 버튼 · 실패 → 30분 감시(다시 초록이면 머지)
 *     · stale → update-branch · 충돌/skipped/30분 무검사 → GitHub 몫 · 401 → 열쇠 몫 · 버튼과 겹쳐도 멈추지 않음
 *  M  앱 머지 버튼 — 사람이 누르면 범위·결정 필요와 무관 · 공통 조건만 · stale 이면 main 얹고 다시
 *  R  refresh — 방 열 때 canMerge·범위 밖 파일
 *  P  운영 아님이면 GitHub 안 부름 · 시작 때 되살림 · check-runs 여러 쪽 · 파일에 남음
 * [연계] services/nariya_pr_merge.js · scripts/refactor/verify_all.sh SUITES
 * ============================================================================
 */
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const M = require('../services/nariya_pr_merge');

let pass = 0, fail = 0;
async function check(name, fn) { try { await fn(); pass++; console.log('✅ ' + name); } catch (e) { fail++; console.log('❌ ' + name + ' — ' + (e && e.message)); } }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nariya-pr-'));
let fileNo = 0;
const newFile = () => path.join(tmp, 'pr' + (++fileNo) + '.json');
const MIN = 60000, HOUR = 3600000;
const T0 = Date.parse('2026-11-17T03:30:00+09:00');
const SHA = 'a'.repeat(40), SHA2 = 'b'.repeat(40);
const URL = (n) => 'https://github.com/cantatapream/SEAGNAL/pull/' + n;
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
const PROD = () => ({ FLY_APP_NAME: 'seagnal-server', GITHUB_MERGE_TOKEN: 'ghp_test' });

function fakeTime(start = T0) {
    let t = start, seq = 0; const timers = [];
    return {
        now: () => t,
        setTimer: (fn, ms) => { const h = { id: ++seq, at: t + ms, fn }; timers.push(h); return h; },
        clearTimer: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
        pending: () => timers.length,
        async advance(ms) {
            const end = t + ms;
            for (;;) { timers.sort((a, b) => a.at - b.at || a.id - b.id); const h = timers[0]; if (!h || h.at > end) break; timers.shift(); t = h.at; h.fn(); await flush(); }
            t = end; await flush();
        },
    };
}
const RUN_SINCE = T0 - HOUR;                         // 그 세션이 일을 시작한 시각
const prJson = (o = {}) => Object.assign({ number: 9, title: '자동 반영 PR', state: 'open', merged: false, mergeable: true, created_at: new Date(T0 - 10 * MIN).toISOString(),
    base: { ref: 'main' }, head: { ref: 'claude/youthful-gates-x', sha: SHA, repo: { full_name: 'cantatapream/SEAGNAL' } } }, o);
const run = (conclusion, status = 'completed', name = M.REQUIRED_CHECK, extra = {}) => Object.assign({ name, status, conclusion, app: { slug: 'github-actions' }, started_at: new Date(T0 - 5 * MIN).toISOString() }, extra);
const WIKI = ['local_server/knowledge/legal/wiki/statutes/항만법.md', 'local_server/knowledge/legal/raw/항만법/법률.md', 'local_server/knowledge/legal/HANDOFF.md'];
const CTX = (o = {}) => Object.assign({ mainAt: T0 - 30 * MIN, auto: true, files: WIKI, runSince: RUN_SINCE, owner: true }, o);
/** 가짜 GitHub — gh.pr / gh.runs / gh.files / gh.mainAt / gh.merge / gh.update 를 바꿔 상황을 만든다. */
function fakeGh() {
    const g = async (url, init) => {
        g.calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null, auth: init.headers.Authorization });
        if (g.fail && g.fail(url, init)) return { ok: false, status: g.failStatus || 500, json: async () => ({ message: 'nope' }) };
        if (init.method === 'GET' && /\/pulls\/\d+$/.test(url)) return { ok: true, status: 200, json: async () => g.pr };
        if (init.method === 'GET' && /\/check-runs/.test(url)) {
            const page = Number((/[?&]page=(\d+)/.exec(url) || [])[1] || 1);
            return { ok: true, status: 200, json: async () => ({ total_count: g.runs.length, check_runs: g.runs.slice((page - 1) * 100, page * 100) }) };
        }
        if (init.method === 'GET' && /\/commits\/main$/.test(url)) return { ok: true, status: 200, json: async () => ({ commit: { committer: { date: new Date(g.mainAt).toISOString() } } }) };
        if (init.method === 'GET' && /\/files\?/.test(url)) {
            const page = Number((/[?&]page=(\d+)/.exec(url) || [])[1] || 1);
            return { ok: true, status: 200, json: async () => g.files.slice((page - 1) * 100, page * 100).map((f) => ({ filename: f })) };
        }
        if (init.method === 'PUT' && /\/update-branch$/.test(url)) { const u = g.update(JSON.parse(init.body)); return { ok: u.ok, status: u.status, json: async () => ({}) }; }
        if (init.method === 'PUT' && /\/merge$/.test(url)) { const m = g.merge(JSON.parse(init.body)); if (m.ok) { g.pr = Object.assign({}, g.pr, { merged: true, state: 'closed' }); } return { ok: m.ok, status: m.status, json: async () => m.json }; }
        return { ok: false, status: 404, json: async () => ({}) };
    };
    g.calls = []; g.pr = prJson(); g.runs = [run(null, 'in_progress')]; g.files = WIKI.slice(); g.mainAt = T0 - 30 * MIN;
    g.merge = () => ({ ok: true, status: 200, json: { merged: true } });
    g.update = () => ({ ok: true, status: 202 });
    return g;
}
function fakePush() { const p = async (t, b, d) => { p.sent.push({ t, b, d }); return { sent: 1 }; }; p.sent = []; return p; }
function make(o = {}) {
    const time = o.time || fakeTime(), gh = o.gh || fakeGh(), push = o.push || fakePush(), file = o.file || newFile();
    const m = M.createMerger({ file, now: time.now, setTimer: time.setTimer, clearTimer: time.clearTimer, fetch: gh, push, env: o.env || PROD() });
    return { m, time, gh, push, file };
}
const quiet = async (fn) => { const o = { log: console.log, warn: console.warn, error: console.error }; console.log = console.warn = console.error = () => {}; try { await fn(); } finally { Object.assign(console, o); } };
const merges = (gh) => gh.calls.filter((c) => c.method === 'PUT' && /\/merge$/.test(c.url));
const OWN = { owner: true, runSince: RUN_SINCE };

(async () => {
    await check('J judge — 공통 조건(열린 PR·main·claude/ 가지·같은 저장소·GitHub Actions 의 필수 검사 success·다른 검사 실패 없음·mergeable·최신 main) · 자동은 결정 필요·범위·주인·시각까지', () => {
        const ok = (pr, runs, c) => M.judge(pr, runs, c || CTX());
        assert.equal(ok(prJson(), [run('success')]).state, 'green');
        assert.equal(ok(prJson(), [run('success')]).sha, SHA);
        assert.equal(ok(prJson({ merged: true }), []).state, 'merged');
        assert.equal(ok(prJson({ state: 'closed' }), []).state, 'closed');
        assert.equal(ok(prJson({ base: { ref: 'dev' } }), [run('success')]).state, 'invalid');
        assert.equal(ok(prJson({ head: { ref: 'feature/x', sha: SHA, repo: { full_name: 'cantatapream/SEAGNAL' } } }), [run('success')]).state, 'invalid');
        assert.equal(ok(prJson({ head: { ref: 'claude/x', sha: SHA, repo: { full_name: 'evil/SEAGNAL' } } }), [run('success')]).state, 'invalid', '포크');
        assert.equal(ok(prJson(), []).state, 'missing');
        assert.equal(ok(prJson(), [run('success', 'completed', M.REQUIRED_CHECK, { app: { slug: 'evil-app' } })]).state, 'missing', '이름만 같은 다른 앱의 검사는 인정 안 함');
        assert.equal(ok(prJson(), [run(null, 'in_progress')]).state, 'pending');
        assert.equal(ok(prJson(), [run('success'), run(null, 'queued', '다른 검사')]).state, 'pending');
        assert.equal(ok(prJson(), [run('failure')]).state, 'failed');
        assert.equal(ok(prJson(), [run('success'), run('cancelled', 'completed', '다른 검사')]).state, 'failed');
        assert.equal(ok(prJson(), [run('skipped')]).state, 'skipped', '필수 검사가 skipped 면 사람 몫(30분·3시간 헛기다리지 않게)');
        assert.equal(ok(prJson({ mergeable: false }), [run('success')]).state, 'conflict');
        assert.equal(ok(prJson({ mergeable: null }), [run('success')]).state, 'pending');
        assert.equal(ok(prJson(), [run('success'), run('skipped', 'completed', '다른 검사')]).state, 'green');
        assert.equal(ok(prJson(), [run('success')], CTX({ mainAt: T0 })).state, 'stale', '검사 뒤 main 이 바뀌면 stale(적대검증 C#중-6)');
        // 자동만
        assert.equal(ok(prJson(), [run('success')], CTX({ files: WIKI.concat(['local_server/routes/legal.js']) })).state, 'scope', '서버 코드');
        assert.equal(ok(prJson(), [run('success')], CTX({ files: ['.github/workflows/verify-all-gate.yml'] })).state, 'scope', '워크플로');
        assert.equal(ok(prJson(), [run('success')], CTX({ files: ['scripts/refactor/verify_all.sh'] })).state, 'scope', '검사 본체');
        assert.equal(ok(prJson(), [run('success')], CTX({ files: ['local_server/knowledge/legal/_dashboard/loop/baseline/byl_line_ready.json'] })).state, 'scope', '기준선');
        assert.equal(ok(prJson(), [run('success')], CTX({ files: ['local_server/knowledge/legal/wiki/x.js'] })).state, 'scope', '허용 경로라도 코드 파일은 안 됨');
        assert.equal(ok(prJson(), [run('success')], CTX({ filesTruncated: true })).state, 'scope');
        assert.equal(ok(prJson(), [run('success')], CTX({ owner: false })).state, 'foreign', '잠금 주인이 아닌 run(적대검증 C#상-2)');
        assert.equal(ok(prJson({ created_at: new Date(RUN_SINCE - MIN).toISOString() }), [run('success')]).state, 'foreign', '세션 시작 전에 있던 PR');
        assert.equal(ok(prJson(), [run('success')], CTX({ auto: false, files: ['local_server/routes/legal.js'], owner: false })).state, 'green', '버튼(사람)은 범위·주인 조건 없음');
    });

    await check('T track — 주인·결정 필요 0건·열쇠 → auto · 그 밖은 human(까닭) · 이미 맡은 PR 에 결정 필요가 오면 사람 몫으로 내림 · 다른 저장소 주소 거절', async () => {
        const c = make();
        assert.deepEqual(c.m.track({ pr_url: URL(9), run_id: 'ar-1', needs_decision: [], summary: '개정 3건' }, OWN), { tracked: true, mode: 'auto', why: undefined, how: undefined });
        assert.equal(c.m.track({ pr_url: URL(10), needs_decision: ['폴더 결정'] }, OWN).mode, 'human');
        const f = c.m.track({ pr_url: URL(11), needs_decision: [] }, {});
        assert.equal(f.mode, 'human'); assert.ok(/잠금 주인/.test(f.why), '주인 아님 → 사람 몫');
        assert.equal(c.m.track({ pr_url: 'https://github.com/evil/SEAGNAL/pull/1' }, OWN).tracked, false);
        const u = c.m.track({ pr_url: URL(9), needs_decision: ['사장님 판단 필요'] }, {});
        assert.equal(u.updated, true); assert.equal(u.mode, 'human');
        const p9 = c.m.list().prs.find((p) => p.number === 9);
        assert.equal(p9.status, 'needs_human'); assert.deepEqual(p9.needs, ['사장님 판단 필요'], '적대검증 C#중-4');
        await quiet(() => c.time.advance(10 * MIN));
        assert.equal(merges(c.gh).length, 0, '내린 뒤엔 자동 머지 안 함');
        const e = make({ env: { FLY_APP_NAME: 'seagnal-server' } });
        const t = e.m.track({ pr_url: URL(12), needs_decision: [] }, OWN);
        assert.equal(t.mode, 'human'); assert.equal(t.how, 'secrets', '열쇠 없으면 자동 아님');
    });

    await check('A1 자동 머지 — 진행 중이면 5분마다 · 초록 → 검사한 sha 로 머지 · 푸시 「자동 머지 완료 · 배포 시작」', async () => {
        const c = make();
        c.m.track({ pr_url: URL(9), needs_decision: [], summary: '개정 3건 반영' }, OWN);
        await quiet(() => c.time.advance(5 * MIN));
        assert.equal(merges(c.gh).length, 0); assert.equal(c.m.list().prs[0].check.state, 'pending');
        c.gh.runs = [run('success')];
        await quiet(() => c.time.advance(5 * MIN));
        assert.equal(merges(c.gh).length, 1);
        assert.deepEqual(merges(c.gh)[0].body, { sha: SHA, merge_method: 'merge' });
        assert.equal(merges(c.gh)[0].auth, 'Bearer ghp_test');
        assert.equal(c.m.list().prs[0].status, 'merged'); assert.equal(c.m.list().prs[0].mergedBy, 'auto');
        assert.ok(/자동 머지 완료 · 배포 시작/.test(c.push.sent[0].t));
        await quiet(() => c.time.advance(30 * MIN));
        assert.equal(merges(c.gh).length, 1);
    });

    await check('A2 범위 밖 파일·주인 아님 → 첫 확인에서 바로 사람 몫 + 「앱에서 머지 버튼」 푸시 · 머지 안 함', async () => {
        const c = make(); c.gh.runs = [run('success')]; c.gh.files = WIKI.concat(['local_server/services/nariya_pr_merge.js']);
        c.m.track({ pr_url: URL(9), needs_decision: [] }, OWN); await quiet(() => c.time.advance(5 * MIN));
        assert.equal(merges(c.gh).length, 0); assert.equal(c.m.list().prs[0].status, 'needs_human'); assert.equal(c.m.list().prs[0].how, 'button');
        assert.ok(/앱에서 머지 버튼을 눌러 주세요/.test(c.push.sent[0].t) && /위키·원문 밖 파일/.test(c.push.sent[0].b) && /「자동반영」 방/.test(c.push.sent[0].b));
    });

    await check('A3 검사 실패 → failed_checks + 푸시 · 30분마다 계속 보다가 다시 돌려 초록이 되면 자동 머지(적대검증 C#중-2) · 24시간 뒤엔 그만', async () => {
        const c = make(); c.gh.runs = [run('failure')];
        c.m.track({ pr_url: URL(9), needs_decision: [] }, OWN);
        await quiet(() => c.time.advance(5 * MIN));
        assert.equal(c.m.list().prs[0].status, 'failed_checks'); assert.ok(/검사 실패 · 자동 머지 안 함/.test(c.push.sent[0].t) && /머지 버튼이 잠깁니다/.test(c.push.sent[0].b));
        await quiet(() => c.time.advance(HOUR)); assert.equal(c.push.sent.length, 1, '실패 푸시는 한 번');
        c.gh.runs = [run('success')];
        await quiet(() => c.time.advance(30 * MIN));
        assert.equal(merges(c.gh).length, 1); assert.equal(c.m.list().prs[0].status, 'merged');
        const d = make(); d.gh.runs = [run('failure')];
        d.m.track({ pr_url: URL(9), needs_decision: [] }, OWN); await quiet(() => d.time.advance(25 * HOUR));
        const n = d.gh.calls.length; await quiet(() => d.time.advance(5 * HOUR)); assert.equal(d.gh.calls.length, n, '24시간 뒤엔 안 봄');
    });

    await check('A4 main 이 바뀜(stale) → update-branch(expected_head_sha) 한 번 → 다시 검사 · 얹기 거절 → GitHub 몫', async () => {
        const c = make(); c.gh.runs = [run('success')]; c.gh.mainAt = T0;   // 검사(T0-5분)보다 main 이 새것
        c.m.track({ pr_url: URL(9), needs_decision: [] }, OWN);
        await quiet(() => c.time.advance(5 * MIN));
        const up = c.gh.calls.filter((x) => /update-branch$/.test(x.url));
        assert.equal(up.length, 1); assert.deepEqual(up[0].body, { expected_head_sha: SHA }); assert.equal(merges(c.gh).length, 0);
        await quiet(() => c.time.advance(5 * MIN));
        assert.equal(c.gh.calls.filter((x) => /update-branch$/.test(x.url)).length, 1, '같은 head 로는 한 번만');
        c.gh.pr = prJson({ head: { ref: 'claude/youthful-gates-x', sha: SHA2, repo: { full_name: 'cantatapream/SEAGNAL' } } });
        c.gh.runs = [run('success', 'completed', M.REQUIRED_CHECK, { started_at: new Date(T0 + 11 * MIN).toISOString() })];
        await quiet(() => c.time.advance(5 * MIN));
        assert.equal(merges(c.gh).length, 1); assert.equal(merges(c.gh)[0].body.sha, SHA2, '새 head(main 을 얹은 커밋)로 머지');
        const d = make(); d.gh.runs = [run('success')]; d.gh.mainAt = T0; d.gh.update = () => ({ ok: false, status: 422 });
        d.m.track({ pr_url: URL(9), needs_decision: [] }, OWN); await quiet(() => d.time.advance(5 * MIN));
        assert.equal(d.m.list().prs[0].status, 'needs_human'); assert.equal(d.m.list().prs[0].how, 'github');
    });

    await check('A5 충돌·필수 검사 30분 없음·skipped → GitHub 몫 · 3시간 → 버튼 몫 · 401 → 열쇠 몫(바로) · 머지 거절 → 버튼 몫 · GitHub 에서 먼저 머지 → merged(푸시 없음)', async () => {
        const a = make(); a.gh.runs = [run('success')]; a.gh.pr = prJson({ mergeable: false });
        a.m.track({ pr_url: URL(9), needs_decision: [] }, OWN); await quiet(() => a.time.advance(5 * MIN));
        assert.equal(a.m.list().prs[0].how, 'github'); assert.ok(/앱 버튼으로는 풀 수 없습니다/.test(a.push.sent[0].b) && /자동 머지 안 함 · 확인 필요/.test(a.push.sent[0].t));
        const b = make(); b.gh.runs = [];
        b.m.track({ pr_url: URL(9), needs_decision: [] }, OWN); await quiet(() => b.time.advance(35 * MIN));
        assert.equal(b.m.list().prs[0].status, 'needs_human'); assert.ok(/30분/.test(b.m.list().prs[0].why));
        const s2 = make(); s2.gh.runs = [run('skipped')];
        s2.m.track({ pr_url: URL(9), needs_decision: [] }, OWN); await quiet(() => s2.time.advance(5 * MIN));
        assert.equal(s2.m.list().prs[0].status, 'needs_human'); assert.ok(/돌지 않음/.test(s2.m.list().prs[0].why));
        const c = make();
        c.m.track({ pr_url: URL(9), needs_decision: [] }, OWN); await quiet(() => c.time.advance(3 * HOUR + 10 * MIN));
        assert.ok(/3시간/.test(c.m.list().prs[0].why)); assert.equal(c.m.list().prs[0].how, 'button');
        const k = make(); k.gh.fail = (url) => /\/pulls\/9$/.test(url); k.gh.failStatus = 401;
        k.m.track({ pr_url: URL(9), needs_decision: [] }, OWN); await quiet(() => k.time.advance(5 * MIN));
        assert.equal(k.m.list().prs[0].how, 'secrets'); assert.ok(/HTTP 401/.test(k.m.list().prs[0].why), '적대검증 C#하-1');
        const d = make(); d.gh.runs = [run('success')]; d.gh.merge = () => ({ ok: false, status: 405, json: { message: 'Base branch was modified' } });
        d.m.track({ pr_url: URL(9), needs_decision: [] }, OWN); await quiet(() => d.time.advance(5 * MIN));
        assert.equal(d.m.list().prs[0].how, 'button'); assert.ok(/405/.test(d.m.list().prs[0].why));
        const e = make(); e.gh.pr = prJson({ merged: true, state: 'closed' });
        e.m.track({ pr_url: URL(9), needs_decision: [] }, OWN); await quiet(() => e.time.advance(5 * MIN));
        assert.equal(e.m.list().prs[0].status, 'merged'); assert.equal(e.push.sent.length, 0);
    });

    await check('A6 버튼과 5분 확인이 겹쳐도 자동 확인이 멈추지 않는다(적대검증 C#중-1)', async () => {
        const c = make();
        let release; const slow = new Promise((r) => { release = r; });
        const orig = c.gh;
        const gh2 = async (url, init) => { if (init.method === 'GET' && /\/pulls\/9$/.test(url) && gh2.hold) { gh2.hold = false; await slow; } return orig(url, init); };
        gh2.hold = true;
        const m = M.createMerger({ file: newFile(), now: c.time.now, setTimer: c.time.setTimer, clearTimer: c.time.clearTimer, fetch: gh2, push: c.push, env: PROD() });
        m.track({ pr_url: URL(9), needs_decision: [] }, OWN);
        const pressing = m.mergeNow(9);                      // GitHub 응답이 늦는 버튼
        await quiet(() => c.time.advance(5 * MIN));          // 그 사이 5분 확인이 울림(busy)
        release(); await quiet(async () => { await pressing; });
        orig.runs = [run('success')];
        await quiet(() => c.time.advance(10 * MIN));
        assert.equal(merges(orig).length, 1, '다시 걸린 확인이 머지');
    });

    await check('M 앱 머지 버튼 — 결정 필요·범위 밖이 있어도 초록이면 머지(sha 고정) · 실패·진행 중 409 · stale 이면 main 얹고 「20분 뒤 다시」 · 맡지 않은 PR 404 · 열쇠 없음 503', async () => {
        const c = make(); c.gh.runs = [run('success')]; c.gh.files = ['local_server/routes/legal.js'];
        c.m.track({ pr_url: URL(10), needs_decision: ['폴더 결정'] }, OWN);
        let r = await c.m.mergeNow(10, '관리자');
        assert.equal(r.ok, true); assert.deepEqual(merges(c.gh)[0].body, { sha: SHA, merge_method: 'merge' });
        assert.equal(c.m.list().prs[0].mergedBy, '관리자');
        r = await c.m.mergeNow(10); assert.equal(r.status, 409); assert.equal(r.state, 'merged');
        const d = make(); d.gh.runs = [run('failure')]; d.m.track({ pr_url: URL(11), needs_decision: ['x'] }, OWN);
        r = await d.m.mergeNow(11); assert.equal(r.state, 'failed'); assert.equal(merges(d.gh).length, 0);
        d.gh.runs = [run(null, 'in_progress')]; r = await d.m.mergeNow(11); assert.equal(r.state, 'pending');
        d.gh.runs = [run('success')]; d.gh.mainAt = T0; r = await d.m.mergeNow(11);
        assert.equal(r.state, 'stale'); assert.ok(/20분 뒤 다시/.test(r.why)); assert.equal(d.gh.calls.filter((x) => /update-branch$/.test(x.url)).length, 1);
        assert.equal((await d.m.mergeNow(99)).status, 404);
        assert.equal((await d.m.mergeNow(-1)).status, 400);
        const e = make({ env: { FLY_APP_NAME: 'seagnal-server' } }); e.m.track({ pr_url: URL(12), needs_decision: ['x'] }, OWN);
        r = await e.m.mergeNow(12); assert.equal(r.status, 503); assert.equal(e.gh.calls.length, 0);
    });

    await check('R refresh(방 열 때) — 머지 안 된 PR 을 다시 읽어 canMerge·범위 밖 파일·사람이 머지함을 적는다 · 머지는 안 함', async () => {
        const c = make(); c.gh.runs = [run('success')]; c.gh.files = WIKI.concat(['local_server/server.js']);
        c.m.track({ pr_url: URL(10), needs_decision: ['폴더'] }, OWN);
        await quiet(() => c.m.refresh());
        let p = c.m.list().prs[0];
        assert.equal(p.canMerge, true); assert.equal(p.outsideCount, 1); assert.deepEqual(p.outside, ['local_server/server.js']); assert.ok(/「자동반영」 방/.test(p.howText));
        assert.equal(merges(c.gh).length, 0);
        c.gh.runs = [run('failure')]; await quiet(() => c.m.refresh());
        assert.equal(c.m.list().prs[0].canMerge, false);
        c.gh.pr = prJson({ merged: true, state: 'closed' }); await quiet(() => c.m.refresh());
        assert.equal(c.m.list().prs[0].status, 'merged');
    });

    await check('P 운영 아님이면 GitHub 를 안 부름 · 시작 때 기다리던 PR 확인 되살림 · check-runs 100개 넘으면 다음 쪽까지 · 상태가 파일에 남음', async () => {
        const c = make({ env: { FLY_APP_NAME: 'seagnal-staging', GITHUB_MERGE_TOKEN: 'x' } });
        c.m.track({ pr_url: URL(9), needs_decision: [] }, OWN); await quiet(() => c.time.advance(10 * MIN)); await quiet(() => c.m.refresh());
        assert.equal(c.gh.calls.length, 0);
        const time = fakeTime(), gh = fakeGh(); gh.runs = [run('success')];
        const a = make({ time, gh }); a.m.track({ pr_url: URL(9), needs_decision: [] }, OWN);
        const b = make({ time, gh, file: a.file });
        assert.equal(b.m.start().waiting, 1);
        await quiet(() => time.advance(MIN));
        assert.equal(merges(gh).length, 1); assert.equal(JSON.parse(fs.readFileSync(a.file, 'utf8')).prs[0].status, 'merged');
        const d = make(); d.gh.runs = [run('success')].concat([...Array(120)].map((_, i) => run('success', 'completed', 'x' + i))).concat([run('failure', 'completed', '맨 끝 실패')]);
        d.m.track({ pr_url: URL(9), needs_decision: [] }, OWN); await quiet(() => d.time.advance(5 * MIN));
        assert.equal(merges(d.gh).length, 0, '101번째 뒤의 실패도 본다(적대검증 C#하-3)'); assert.equal(d.m.list().prs[0].status, 'failed_checks');
    });

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
})();
