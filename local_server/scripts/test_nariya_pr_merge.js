/**
 * ============================================================================
 * 파일명: scripts/test_nariya_pr_merge.js
 * 역할: 자동 반영 PR 의 조건부 자동 머지(services/nariya_pr_merge.js)를 고정한다 — 설계안(services/nariya_autorun.design.md) §9
 *       (초보자용: 「결정 필요 0건 + 검사 초록이면 서버가 머지, 아니면 앱 머지 버튼」이 정말 그렇게 도는지 가짜 GitHub 로 본다.)
 * ============================================================================
 * [무엇을 검사하나]
 *  J  judge — 열린 PR·base main·claude/ 가지·같은 저장소·필수 검사 success·나머지 실패 없음·mergeable true 일 때만 green
 *  T  track — 결정 필요 0건이면 auto(5분 뒤 확인), 있으면 human · 같은 PR 두 번 안 맡음 · 이 저장소 PR 주소만
 *  A  자동 머지 — 진행 중이면 5분 뒤 다시 · 초록이면 **검사한 sha** 로 머지 → 푸시 「자동 머지 완료」
 *     · 검사 실패 → failed_checks + 푸시(머지 버튼 잠김 안내) · 충돌 → 사람 몫 · 필수 검사 30분 안 붙음 → 사람 몫 · 3시간 → 사람 몫
 *     · 머지 거절(409) → 사람 몫 · 사람이 GitHub 에서 먼저 머지 → merged(푸시 없음)
 *  M  앱 머지 버튼(mergeNow) — 결정 필요가 있어도 초록이면 머지 · 검사 실패면 거절 · 맡지 않은 PR 거절 · 열쇠 없으면 503
 *  P  운영 아님(스테이징·개발)이면 GitHub 를 부르지 않는다 · 시작 때 기다리던 PR 확인 되살림 · 파일에 남음
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
const prJson = (o = {}) => Object.assign({ number: 9, title: '자동 반영 PR', state: 'open', merged: false, mergeable: true,
    base: { ref: 'main' }, head: { ref: 'claude/youthful-gates-x', sha: SHA, repo: { full_name: 'cantatapream/SEAGNAL' } } }, o);
const run = (conclusion, status = 'completed', name = M.REQUIRED_CHECK) => ({ name, status, conclusion });
/** 가짜 GitHub — gh.pr / gh.runs / gh.merge 를 바꿔 상황을 만든다. */
function fakeGh() {
    const g = async (url, init) => {
        g.calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null, auth: init.headers.Authorization });
        if (init.method === 'GET' && /\/pulls\/\d+$/.test(url)) return { ok: true, status: 200, json: async () => g.pr };
        if (init.method === 'GET' && /\/check-runs/.test(url)) return { ok: true, status: 200, json: async () => ({ check_runs: g.runs }) };
        if (init.method === 'PUT' && /\/merge$/.test(url)) { const m = g.merge(JSON.parse(init.body)); if (m.ok) { g.pr = Object.assign({}, g.pr, { merged: true, state: 'closed' }); } return { ok: m.ok, status: m.status, json: async () => m.json }; }
        return { ok: false, status: 404, json: async () => ({}) };
    };
    g.calls = []; g.pr = prJson(); g.runs = [run(null, 'in_progress')];
    g.merge = () => ({ ok: true, status: 200, json: { merged: true } });
    return g;
}
function fakePush() { const p = async (t, b, d) => { p.sent.push({ t, b, d }); return { sent: 1 }; }; p.sent = []; return p; }
function make(o = {}) {
    const time = o.time || fakeTime(), gh = o.gh || fakeGh(), push = o.push || fakePush(), file = o.file || newFile();
    const m = M.createMerger({ file, now: time.now, setTimer: time.setTimer, clearTimer: time.clearTimer, fetch: gh, push, env: o.env || PROD() });
    return { m, time, gh, push, file };
}
const quiet = async (fn) => { const o = { log: console.log, warn: console.warn, error: console.error }; console.log = console.warn = console.error = () => {}; try { await fn(); } finally { Object.assign(console, o); } };
const merges = (gh) => gh.calls.filter((c) => c.method === 'PUT');

(async () => {
    await check('J judge — 조건이 다 맞을 때만 green · 하나라도 어긋나면 그 까닭', () => {
        assert.equal(M.judge(prJson(), [run('success')]).state, 'green');
        assert.equal(M.judge(prJson(), [run('success')]).sha, SHA);
        assert.equal(M.judge(prJson({ merged: true }), []).state, 'merged');
        assert.equal(M.judge(prJson({ state: 'closed' }), []).state, 'closed');
        assert.equal(M.judge(prJson({ base: { ref: 'dev' } }), [run('success')]).state, 'invalid');
        assert.equal(M.judge(prJson({ head: { ref: 'feature/x', sha: SHA, repo: { full_name: 'cantatapream/SEAGNAL' } } }), [run('success')]).state, 'invalid', 'claude/ 가지만');
        assert.equal(M.judge(prJson({ head: { ref: 'claude/x', sha: SHA, repo: { full_name: 'evil/SEAGNAL' } } }), [run('success')]).state, 'invalid', '포크 PR 은 안 됨');
        assert.equal(M.judge(prJson(), []).state, 'missing', '필수 검사가 없으면 초록 아님');
        assert.equal(M.judge(prJson(), [run(null, 'in_progress')]).state, 'pending');
        assert.equal(M.judge(prJson(), [run('success'), run(null, 'queued', '다른 검사')]).state, 'pending', '다른 검사가 아직이면 기다림');
        assert.equal(M.judge(prJson(), [run('failure')]).state, 'failed');
        assert.equal(M.judge(prJson(), [run('success'), run('cancelled', 'completed', '다른 검사')]).state, 'failed', '다른 검사가 취소돼도 실패');
        assert.equal(M.judge(prJson(), [run('neutral')]).state, 'pending', '필수 검사는 success 여야');
        assert.equal(M.judge(prJson({ mergeable: false }), [run('success')]).state, 'conflict');
        assert.equal(M.judge(prJson({ mergeable: null }), [run('success')]).state, 'pending', 'GitHub 가 계산 중');
        assert.equal(M.judge(prJson(), [run('success'), run('skipped', 'completed', '다른 검사')]).state, 'green', 'skipped 는 실패가 아님');
    });

    await check('T track — 결정 필요 0건 → auto(대기) · 있으면 human · 같은 PR 두 번 안 맡음 · 다른 저장소 주소 거절', async () => {
        const c = make();
        assert.deepEqual(c.m.track({ pr_url: URL(9), run_id: 'ar-1', needs_decision: [], summary: '개정 3건' }), { tracked: true, mode: 'auto' });
        assert.equal(c.m.track({ pr_url: URL(9) }).tracked, false, '두 번 안 맡음');
        assert.deepEqual(c.m.track({ pr_url: URL(10), needs_decision: ['폴더 결정'] }), { tracked: true, mode: 'human' });
        assert.equal(c.m.track({ pr_url: 'https://github.com/evil/SEAGNAL/pull/1' }).tracked, false);
        assert.equal(c.m.track({ pr_url: URL(11) + '/files' }).tracked, false);
        const l = c.m.list();
        assert.deepEqual(l.prs.map((p) => [p.number, p.status]), [[10, 'needs_human'], [9, 'waiting']], '사람 몫이 위');
        assert.deepEqual(l.counts, { needs_human: 1, waiting: 1 }); assert.equal(l.tokenConfigured, true);
        assert.equal(c.gh.calls.length, 0, '맡기만 하고 아직 GitHub 안 부름(5분 뒤 첫 확인)');
    });

    await check('A1 자동 머지 — 검사 진행 중이면 5분마다 다시 · 초록이 되면 검사한 sha 로 머지 · 푸시 「자동 머지 완료 · 배포 시작」 · 상태 merged', async () => {
        const c = make();
        c.m.track({ pr_url: URL(9), needs_decision: [], summary: '개정 3건 반영' });
        await quiet(() => c.time.advance(5 * MIN));
        assert.equal(merges(c.gh).length, 0); assert.equal(c.m.list().prs[0].check.state, 'pending');
        c.gh.runs = [run('success')];
        await quiet(() => c.time.advance(5 * MIN));
        assert.equal(merges(c.gh).length, 1);
        assert.deepEqual(merges(c.gh)[0].body, { sha: SHA, merge_method: 'merge' }, '검사한 그 커밋만');
        assert.equal(merges(c.gh)[0].auth, 'Bearer ghp_test');
        assert.equal(c.m.list().prs[0].status, 'merged'); assert.equal(c.m.list().prs[0].mergedBy, 'auto');
        assert.equal(c.push.sent.length, 1); assert.ok(/자동 머지 완료 · 배포 시작/.test(c.push.sent[0].t), c.push.sent[0].t);
        await quiet(() => c.time.advance(30 * MIN));
        assert.equal(merges(c.gh).length, 1, '머지 뒤 더 안 본다');
    });

    await check('A2 검사 실패 → 머지 안 함 · failed_checks · 푸시(「검사 실패 · 자동 머지 안 함」 + 머지 버튼 잠김 안내) · 더 안 봄', async () => {
        const c = make();
        c.gh.runs = [run('failure')];
        c.m.track({ pr_url: URL(9), needs_decision: [] });
        await quiet(() => c.time.advance(5 * MIN));
        assert.equal(merges(c.gh).length, 0); assert.equal(c.m.list().prs[0].status, 'failed_checks');
        assert.ok(/검사 실패 · 자동 머지 안 함/.test(c.push.sent[0].t) && /머지 버튼이 잠깁니다/.test(c.push.sent[0].b));
        const n = c.gh.calls.length; await quiet(() => c.time.advance(HOUR)); assert.equal(c.gh.calls.length, n);
    });

    await check('A3 충돌 / 필수 검사 30분 안 붙음 / 3시간 초과 / 머지 거절 → 사람 몫(needs_human) + 「자동반영」 방 안내 푸시', async () => {
        const a = make(); a.gh.runs = [run('success')]; a.gh.pr = prJson({ mergeable: false });
        a.m.track({ pr_url: URL(9), needs_decision: [] }); await quiet(() => a.time.advance(5 * MIN));
        assert.equal(a.m.list().prs[0].status, 'needs_human'); assert.ok(/「자동반영」 방/.test(a.push.sent[0].b)); assert.equal(merges(a.gh).length, 0);
        const b = make(); b.gh.runs = [];
        b.m.track({ pr_url: URL(9), needs_decision: [] }); await quiet(() => b.time.advance(25 * MIN));
        assert.equal(b.m.list().prs[0].status, 'waiting'); await quiet(() => b.time.advance(10 * MIN));
        assert.equal(b.m.list().prs[0].status, 'needs_human'); assert.ok(/30분/.test(b.m.list().prs[0].why));
        const c = make();
        c.m.track({ pr_url: URL(9), needs_decision: [] }); await quiet(() => c.time.advance(3 * HOUR + 10 * MIN));
        assert.equal(c.m.list().prs[0].status, 'needs_human'); assert.ok(/3시간/.test(c.m.list().prs[0].why));
        const d = make(); d.gh.runs = [run('success')]; d.gh.merge = () => ({ ok: false, status: 409, json: { message: 'Head branch was modified' } });
        d.m.track({ pr_url: URL(9), needs_decision: [] }); await quiet(() => d.time.advance(5 * MIN));
        assert.equal(d.m.list().prs[0].status, 'needs_human'); assert.ok(/409/.test(d.m.list().prs[0].why));
    });

    await check('A4 사람이 GitHub 에서 먼저 머지·닫음 → merged/closed 로만 적고 푸시 없음', async () => {
        const c = make(); c.gh.pr = prJson({ merged: true, state: 'closed' });
        c.m.track({ pr_url: URL(9), needs_decision: [] }); await quiet(() => c.time.advance(5 * MIN));
        assert.equal(c.m.list().prs[0].status, 'merged'); assert.equal(c.push.sent.length, 0); assert.equal(merges(c.gh).length, 0);
    });

    await check('M 앱 머지 버튼 — 결정 필요가 있어도 초록이면 머지(sha 고정) · 검사 실패·진행 중이면 409 · 맡지 않은 PR 404 · 열쇠 없으면 503 · 이미 머지됨 409', async () => {
        const c = make(); c.gh.runs = [run('success')];
        c.m.track({ pr_url: URL(10), needs_decision: ['폴더 결정'] });
        let r = await c.m.mergeNow(10, '관리자');
        assert.equal(r.ok, true); assert.deepEqual(merges(c.gh)[0].body, { sha: SHA, merge_method: 'merge' });
        assert.equal(c.m.list().prs[0].status, 'merged'); assert.equal(c.m.list().prs[0].mergedBy, '관리자');
        r = await c.m.mergeNow(10); assert.equal(r.ok, false); assert.equal(r.status, 409); assert.equal(r.state, 'merged');
        const d = make(); d.gh.runs = [run('failure')]; d.m.track({ pr_url: URL(11), needs_decision: ['x'] });
        r = await d.m.mergeNow(11); assert.equal(r.ok, false); assert.equal(r.state, 'failed'); assert.equal(merges(d.gh).length, 0, '검사 실패면 버튼으로도 안 됨');
        d.gh.runs = [run(null, 'in_progress')]; r = await d.m.mergeNow(11); assert.equal(r.state, 'pending');
        assert.equal((await d.m.mergeNow(99)).status, 404);
        assert.equal((await d.m.mergeNow(-1)).status, 400);
        const e = make({ env: { FLY_APP_NAME: 'seagnal-server' } }); e.m.track({ pr_url: URL(12), needs_decision: ['x'] });
        r = await e.m.mergeNow(12); assert.equal(r.status, 503); assert.equal(e.gh.calls.length, 0);
        assert.equal(e.m.list().tokenConfigured, false);
    });

    await check('P 운영 아님이면 자동 확인이 GitHub 를 안 부름 · 시작 때 기다리던 PR 을 1분 뒤 다시 확인 · 상태가 파일에 남음', async () => {
        const c = make({ env: { FLY_APP_NAME: 'seagnal-staging', GITHUB_MERGE_TOKEN: 'x' } });
        c.m.track({ pr_url: URL(9), needs_decision: [] }); await quiet(() => c.time.advance(10 * MIN));
        assert.equal(c.gh.calls.length, 0, '스테이징은 GitHub 안 부름');
        const time = fakeTime(), gh = fakeGh(); gh.runs = [run('success')];
        const a = make({ time, gh }); a.m.track({ pr_url: URL(9), needs_decision: [] });
        const b = make({ time, gh, file: a.file });
        assert.equal(b.m.start().waiting, 1);
        await quiet(() => time.advance(MIN));
        assert.equal(merges(gh).length, 1, '되살린 확인이 머지'); assert.equal(b.m.list().prs[0].status, 'merged');
        assert.equal(JSON.parse(fs.readFileSync(a.file, 'utf8')).prs[0].status, 'merged');
    });

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
})();
