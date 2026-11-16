/**
 * ============================================================================
 * 파일명: services/nariya_pr_merge.js
 * 역할: 자동 반영 세션이 올린 PR 을 **조건이 맞으면 서버가 자동으로 머지**하고, 아니면 사장님이 앱에서 누를 머지 버튼 뒤의 일을 한다.
 *       (초보자용: 세션이 위키를 고쳐 PR 을 올리면, 「결정 필요」가 없고 GitHub 검사가 초록이면 여기서 머지까지 해 준다.
 *        결정 필요가 있거나 검사가 안 좋으면 머지하지 않고 「앱에서 머지 버튼을 눌러 주세요」 푸시를 보낸다.)
 * ============================================================================
 *
 * [사용자 확정 — 원문]
 *   「C로 하자. 그러면 푸시알림으로 그 내용을 표현해 주어야 하고, 머지를 앱에서 눌러야한다고 푸시 알림 내용에 명시하도록 해주고.
 *    관련 머지 버튼도 앱 내에 반영하여야 해.」 (2026-11-16)
 *   C = 「검사 통과하고 결정 필요 0건이면 자동 머지, 아니면 사장님이 앱 머지 버튼」. 설계안 services/nariya_autorun.design.md §9.
 *
 * [머지 조건 — 하나라도 어긋나면 자동 머지하지 않는다]
 *   ① PR 이 이 저장소(cantatapream/SEAGNAL)의 열린 PR · base main · head 가 같은 저장소의 claude/ 가지
 *   ② head 커밋의 GitHub 검사 중 「verify_all.sh 전체 실행」 이 success · 나머지 검사도 실패·취소 없이 끝남
 *   ③ GitHub 가 mergeable:true 라고 답함(충돌 없음)
 *   ④ 자동 머지는 추가로 세션이 보낸 결정 필요(needs_decision)가 0건일 때만. 앱 버튼(사람)은 결정 필요가 있어도 된다 — 사람이 본 것이다.
 *   머지는 **검사한 그 커밋(sha)만** 머지한다(PUT …/merge {sha}) — 검사 뒤 누가 커밋을 더 얹으면 GitHub 가 거절한다(409).
 *
 * [저장] data/nariya_pr_state.json(볼륨) — {v:1, prs:[{number, pr_url, run_id, needs[], summary, at, mode, status, …}]} 최근 30개.
 *   status: waiting(검사 기다림·자동) · needs_human(앱 버튼 대기) · merged · closed · failed_checks · conflict
 *
 * [연계]
 *  - services/nariya_autorun.js done() → track() (outcome 'pr' + pr_url)
 *  - routes/legal.js GET /api/legal/autorun/prs · POST /api/legal/autorun/prs/:n/merge (관리자 토큰만)
 *  - client/js/ai-chat/ai_chat.js 「자동반영」 방(renderAutorunCards) — 머지 버튼
 *  - server.js 시작 때 start() — 검사 기다리던 PR 의 확인 타이머를 되살린다
 *  - 환경 변수: GITHUB_MERGE_TOKEN(Fly secrets — 사장님이 넣음), FLY_APP_NAME==='seagnal-server' 일 때만 GitHub 를 부른다
 * [로드 순서] 번들 없음(서버). nariya_autorun 이 done 때 지연 require 한다.
 * ============================================================================
 */
'use strict';
const fs = require('fs'), path = require('path');

const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'nariya_pr_state.json');
const REPO = 'cantatapream/SEAGNAL';
const API = 'https://api.github.com/repos/' + REPO;
const PR_URL_RE = /^https:\/\/github\.com\/cantatapream\/SEAGNAL\/pull\/(\d+)$/;
const REQUIRED_CHECK = 'verify_all.sh 전체 실행';   // .github/workflows/verify-all-gate.yml 의 잡 이름 — 차단 게이트(2026-09-23)
const PROD_APP = 'seagnal-server';
// 5분: 검사(실측 약 19분 — PR #1471)를 기다리며 다시 볼 간격. 없으면 검사가 끝나도 아무도 머지하지 않는다.
const POLL_MS = 5 * 60000;
// 3시간: 이 안에 검사가 안 끝나면 자동 머지를 그만두고 사람에게 넘긴다. 없으면 검사가 걸린 채 멈춘 PR 을 영원히 다시 본다.
const WAIT_MAX_MS = 3 * 3600000;
// 30분: 필수 검사가 아예 안 붙으면(경로 조건으로 안 돎 등) 이만큼 기다린 뒤 사람에게 넘긴다. 없으면 3시간을 헛되이 기다린다.
const NO_CHECK_MAX_MS = 30 * 60000;
const FETCH_TIMEOUT_MS = 30000;   // GitHub 응답 하나의 상한 — 없으면 걸린 연결 하나가 확인 고리를 붙든다
const KEEP = 30;
const BAD_CONCLUSIONS = new Set(['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'stale']);

/** ms → KST ISO. @param {number} ms @returns {string|null} */
function iso(ms) { return Number.isFinite(ms) ? new Date(ms + 9 * 3600000).toISOString().slice(0, 19) + '+09:00' : null; }
const isPlain = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

/**
 * PR 하나와 그 head 커밋의 검사 목록으로 머지할 수 있는지 판정한다(순수 함수 — 시험이 직접 먹인다).
 * 예: judge({state:'open', merged:false, base:{ref:'main'}, head:{ref:'claude/x', sha:'ab', repo:{full_name:REPO}}, mergeable:true},
 *            [{name:REQUIRED_CHECK, status:'completed', conclusion:'success'}]) → {ok:true, state:'green', sha:'ab'}
 * @param {object} pr GitHub PR 응답 @param {object[]} runs check_runs @returns {{ok:boolean, state:string, why?:string, sha?:string}}
 *   state: green(머지 가능) · pending(기다림) · failed(검사 실패) · conflict · missing(필수 검사 없음) · merged · closed · invalid
 * [연계] ← evaluate
 */
function judge(pr, runs) {
    if (!isPlain(pr)) return { ok: false, state: 'invalid', why: 'PR 정보를 못 읽음' };
    if (pr.merged) return { ok: false, state: 'merged', why: '이미 머지됨' };
    if (pr.state !== 'open') return { ok: false, state: 'closed', why: 'PR 이 닫혀 있음' };
    const head = pr.head || {}, base = pr.base || {};
    if (base.ref !== 'main') return { ok: false, state: 'invalid', why: 'base 가 main 이 아님(' + String(base.ref).slice(0, 40) + ')' };
    if (typeof head.ref !== 'string' || !head.ref.startsWith('claude/')) return { ok: false, state: 'invalid', why: 'claude/ 가지가 아님' };
    if (!head.repo || head.repo.full_name !== REPO) return { ok: false, state: 'invalid', why: '다른 저장소(포크)의 PR' };
    if (typeof head.sha !== 'string' || !/^[0-9a-f]{40}$/.test(head.sha)) return { ok: false, state: 'invalid', why: 'head 커밋을 못 읽음' };
    const list = Array.isArray(runs) ? runs : [];
    const bad = list.filter((r) => r && r.status === 'completed' && BAD_CONCLUSIONS.has(r.conclusion));
    if (bad.length) return { ok: false, state: 'failed', why: '검사 실패: ' + bad.map((r) => String(r.name).slice(0, 40)).join(', '), sha: head.sha };
    const req = list.filter((r) => r && r.name === REQUIRED_CHECK);
    if (!req.length) return { ok: false, state: 'missing', why: '필수 검사(' + REQUIRED_CHECK + ')가 아직 없음', sha: head.sha };
    if (list.some((r) => r && r.status !== 'completed') || !req.every((r) => r.conclusion === 'success')) return { ok: false, state: 'pending', why: '검사 진행 중', sha: head.sha };
    if (pr.mergeable === false) return { ok: false, state: 'conflict', why: '충돌 — GitHub 가 머지할 수 없다고 답함', sha: head.sha };
    if (pr.mergeable !== true) return { ok: false, state: 'pending', why: 'GitHub 가 머지 가능 여부를 계산 중', sha: head.sha };
    return { ok: true, state: 'green', sha: head.sha };
}

/**
 * 머지 담당을 만든다. 시험은 시계·타이머·fetch·푸시·파일·환경 변수를 바꿔 넣는다.
 * @param {object} [o] {file, now, setTimer, clearTimer, fetch, push, env}
 * @returns {object} track · evaluate · mergeNow · list · start · _state
 * [연계] ← forDefault · scripts/test_nariya_pr_merge.js
 */
function createMerger({
    file = DEFAULT_FILE,
    now = Date.now,
    setTimer = (fn, ms) => { const t = setTimeout(fn, ms); if (t && t.unref) t.unref(); return t; },
    clearTimer = (t) => clearTimeout(t),
    fetch: doFetch = (url, init) => fetch(url, init),
    push = (t, b, d) => require('./admin_push').sendAdminPush(t, b, d),
    env = process.env,
} = {}) {
    let state = null;
    const timers = new Map();   // number → 타이머
    const busy = new Set();     // number → 판정·머지 중(같은 PR 을 두 번 머지하지 않게)
    const isProd = () => env.FLY_APP_NAME === PROD_APP;
    const token = () => env.GITHUB_MERGE_TOKEN || '';

    function load() {
        if (state) return state;
        state = { v: 1, prs: [] };
        try {
            if (fs.existsSync(file)) {
                const o = JSON.parse(fs.readFileSync(file, 'utf8'));
                if (isPlain(o) && Array.isArray(o.prs)) state.prs = o.prs.filter((p) => isPlain(p) && Number.isInteger(p.number) && p.number > 0).slice(-KEEP);
            }
        } catch (e) {
            const moved = file + '.corrupt-' + now();
            try { fs.renameSync(file, moved); } catch (_) { /* 옮기지 못해도 빈 상태로 간다 */ }
            console.error('[nariya_pr_merge] 상태 파일이 깨져 ' + path.basename(moved) + ' 로 옮기고 빈 상태로 시작:', e && e.message);
        }
        return state;
    }
    function save() {
        const tmp = file + '.' + process.pid + '.tmp';
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
            fs.renameSync(tmp, file);
        } catch (e) {
            try { fs.unlinkSync(tmp); } catch (_) { /* 임시 파일이 없으면 지울 것도 없다 */ }
            console.error('[nariya_pr_merge] 상태 저장 실패:', e && e.message);
        }
    }
    const find = (n) => load().prs.find((p) => p.number === n);
    async function notify(title, body, data) {
        if (!isProd()) { console.log('[nariya_pr_merge] 운영 아님 — 푸시 생략: ' + title + ' / ' + body); return; }
        try { await push(title, body, data); } catch (e) { console.error('[nariya_pr_merge] 푸시 실패:', e && e.message); }
    }
    /** GitHub API 를 부른다. @returns {Promise<{ok:boolean, status:number, json:*}>} */
    async function gh(method, url, body) {
        const res = await doFetch(url, {
            method,
            headers: { Authorization: 'Bearer ' + token(), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'seagnal-server', 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        let json = null;
        try { json = await res.json(); } catch (e) { console.warn('[nariya_pr_merge] GitHub 응답이 JSON 이 아님(HTTP ' + res.status + '):', e && e.message); }
        return { ok: !!res.ok, status: res.status, json };
    }

    /**
     * PR 의 지금 상태를 GitHub 에서 읽어 판정한다(머지는 안 한다).
     * @param {number} n PR 번호 @returns {Promise<{ok:boolean, state:string, why?:string, sha?:string, title?:string}>}
     */
    async function evaluate(n) {
        if (!token()) return { ok: false, state: 'no_token', why: 'GITHUB_MERGE_TOKEN 이 없어 GitHub 를 볼 수 없음' };
        const p = await gh('GET', API + '/pulls/' + n);
        if (!p.ok) return { ok: false, state: 'error', why: 'PR 조회 실패(HTTP ' + p.status + ')' };
        const sha = p.json && p.json.head && p.json.head.sha;
        let runs = [];
        if (typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha)) {
            const c = await gh('GET', API + '/commits/' + sha + '/check-runs?per_page=100');
            if (!c.ok) return { ok: false, state: 'error', why: '검사 조회 실패(HTTP ' + c.status + ')' };
            runs = (c.json && c.json.check_runs) || [];
        }
        return Object.assign(judge(p.json, runs), { title: String((p.json && p.json.title) || '').slice(0, 200) });
    }

    /** 그 sha 만 머지한다. @returns {Promise<{ok:boolean, why?:string}>} */
    async function doMerge(n, sha) {
        const r = await gh('PUT', API + '/pulls/' + n + '/merge', { sha, merge_method: 'merge' });
        if (r.ok && r.json && r.json.merged) return { ok: true };
        return { ok: false, why: 'GitHub 머지 거절(HTTP ' + r.status + (r.json && r.json.message ? ' · ' + String(r.json.message).slice(0, 120) : '') + ')' };
    }

    function arm(n, ms) {
        if (timers.has(n)) clearTimer(timers.get(n));
        timers.set(n, setTimer(() => { timers.delete(n); tick(n).catch((e) => console.error('[nariya_pr_merge] 확인 오류:', e && e.message)); }, ms));
    }

    /** 사람에게 넘긴다 — 상태를 needs_human 으로 두고 「앱에서 머지 버튼」 푸시. */
    async function handOver(p, why, title) {
        p.status = 'needs_human'; p.why = why; p.mode = 'human'; save();
        await notify(title || ('나리야 자동 반영 — 자동 머지 안 함 · 앱에서 확인 필요(PR #' + p.number + ')'),
            `${why}. 앱 → 관리자 → 「자동반영」 방에서 내용을 확인해 주세요. PR: ${p.pr_url}`,
            { type: 'nariya_pr_needs_human', pr: String(p.number) });
    }

    /**
     * 자동 머지 대기 중인 PR 을 한 번 확인한다 — 초록이면 머지, 진행 중이면 5분 뒤 다시, 나쁘면 사람에게 넘김.
     * [연계] ← arm 타이머 · track(첫 확인) · start(되살림)
     */
    async function tick(n) {
        const p = find(n);
        if (!p || p.status !== 'waiting' || busy.has(n)) return;
        if (!isProd()) { console.log('[nariya_pr_merge] 운영 아님 — PR #' + n + ' 확인 생략'); return; }
        busy.add(n);
        try {
            let r;
            try { r = await evaluate(n); } catch (e) { console.error('[nariya_pr_merge] PR #' + n + ' 확인 실패(5분 뒤 다시):', e && e.message); r = { ok: false, state: 'error', why: '연결 실패: ' + String((e && e.message) || e).slice(0, 80) }; }
            p.check = { state: r.state, why: r.why || null, at: now() }; save();
            if (r.ok) {
                let m;
                try { m = await doMerge(n, r.sha); } catch (e) { console.error('[nariya_pr_merge] PR #' + n + ' 자동 머지 요청 실패:', e && e.message); m = { ok: false, why: '연결 실패: ' + String((e && e.message) || e).slice(0, 80) }; }
                if (m.ok) {
                    p.status = 'merged'; p.mergedAt = now(); p.mergedBy = 'auto'; p.mergedSha = r.sha; save();
                    await notify('나리야 자동 반영 — 자동 머지 완료 · 배포 시작(PR #' + n + ')',
                        `결정 필요 없음 · 검사 통과로 자동 머지했습니다. 배포가 이어서 시작됩니다. ${String(p.summary || '').slice(0, 120)}`,
                        { type: 'nariya_pr_merged', pr: String(n), by: 'auto' });
                } else {
                    await handOver(p, '자동 머지가 거절됐습니다 — ' + m.why);
                }
                return;
            }
            if (r.state === 'merged' || r.state === 'closed') { p.status = r.state; save(); return; }
            if (r.state === 'failed') { p.status = 'failed_checks'; p.why = r.why; save();
                await notify('나리야 자동 반영 — 검사 실패 · 자동 머지 안 함(PR #' + n + ')',
                    `${r.why}. 검사가 실패한 PR 은 머지 버튼이 잠깁니다. 앱 → 관리자 → 「자동반영」 방에서 내용을 확인해 주세요. PR: ${p.pr_url}`,
                    { type: 'nariya_pr_failed', pr: String(n) });
                return; }
            if (r.state === 'conflict' || r.state === 'invalid' || r.state === 'no_token') { await handOver(p, r.why); return; }
            const waited = now() - p.at;
            if (r.state === 'missing' && waited >= NO_CHECK_MAX_MS) { await handOver(p, '필수 검사가 30분 동안 붙지 않았습니다'); return; }
            if (waited >= WAIT_MAX_MS) { await handOver(p, '검사가 3시간 안에 끝나지 않았습니다'); return; }
            arm(n, POLL_MS);   // pending · missing(30분 전) · error — 5분 뒤 다시
        } finally { busy.delete(n); }
    }

    /**
     * 세션이 올린 PR 을 맡는다(done 'pr' 때). 결정 필요가 없으면 자동 머지 대기(5분 뒤 첫 확인), 있으면 바로 사람 몫.
     * 같은 PR 을 두 번 맡지 않는다.
     * 예: track({pr_url:'https://github.com/cantatapream/SEAGNAL/pull/9', run_id:'ar-1', needs_decision:[], summary:'…'}) → {tracked:true, mode:'auto'}
     * @param {{pr_url:string, run_id?:string, needs_decision?:string[], summary?:string}} d
     * @returns {{tracked:boolean, mode?:'auto'|'human', why?:string}}
     * [연계] ← nariya_autorun.done
     */
    function track(d) {
        const m = PR_URL_RE.exec(String((d && d.pr_url) || ''));
        if (!m) return { tracked: false, why: 'PR 주소가 이 저장소 PR 이 아님' };
        const n = Number(m[1]);
        if (find(n)) return { tracked: false, why: '이미 맡은 PR' };
        const needs = Array.isArray(d.needs_decision) ? d.needs_decision.filter((x) => typeof x === 'string').slice(0, 20) : [];
        const auto = needs.length === 0;
        const p = { number: n, pr_url: m[0], run_id: typeof d.run_id === 'string' ? d.run_id.slice(0, 64) : null, needs, summary: typeof d.summary === 'string' ? d.summary.slice(0, 500) : '',
            at: now(), mode: auto ? 'auto' : 'human', status: auto ? 'waiting' : 'needs_human' };
        const st = load();
        st.prs = st.prs.concat([p]).slice(-KEEP);
        save();
        if (auto) arm(n, POLL_MS);
        return { tracked: true, mode: p.mode };
    }

    /**
     * 앱 머지 버튼(관리자). 결정 필요가 있어도 된다(사람이 본 것). 검사 초록·충돌 없음·이 저장소 claude/ 가지일 때만, 확인한 sha 만 머지.
     * @param {number} n PR 번호 @param {string} [by] 누른 사람 표시
     * @returns {Promise<{ok:boolean, status?:number, why?:string, state?:string}>}
     * [연계] ← routes/legal.js POST /api/legal/autorun/prs/:n/merge
     */
    async function mergeNow(n, by) {
        if (!Number.isInteger(n) || n <= 0) return { ok: false, status: 400, why: 'PR 번호가 틀림' };
        const p = find(n);
        if (!p) return { ok: false, status: 404, why: '자동 반영이 맡은 PR 이 아님' };
        if (!token()) return { ok: false, status: 503, why: 'GITHUB_MERGE_TOKEN 이 없어 머지할 수 없습니다(Fly secrets 확인)' };
        if (busy.has(n)) return { ok: false, status: 409, why: '이 PR 을 지금 확인·머지하는 중입니다' };
        busy.add(n);
        try {
            const r = await evaluate(n);
            p.check = { state: r.state, why: r.why || null, at: now() }; save();
            if (r.state === 'merged' || r.state === 'closed') { p.status = r.state; save(); return { ok: false, status: 409, state: r.state, why: r.why }; }
            if (!r.ok) return { ok: false, status: 409, state: r.state, why: r.why };
            const m = await doMerge(n, r.sha);
            if (!m.ok) return { ok: false, status: 502, why: m.why };
            p.status = 'merged'; p.mergedAt = now(); p.mergedBy = String(by || '관리자').slice(0, 40); p.mergedSha = r.sha;
            if (timers.has(n)) { clearTimer(timers.get(n)); timers.delete(n); }
            save();
            return { ok: true, state: 'merged' };
        } catch (e) {
            console.error('[nariya_pr_merge] PR #' + n + ' 머지 버튼 처리 실패:', e && e.message);
            return { ok: false, status: 502, why: '연결 실패: ' + String((e && e.message) || e).slice(0, 80) };
        } finally { busy.delete(n); }
    }

    /**
     * 앱 「자동반영」 방에 보일 목록(최근 것 먼저). 상태를 바꾸지 않는다. 사람 몫(needs_human)·검사 대기·실패를 위에.
     * @returns {{prs:object[], counts:{needs_human:number, waiting:number}, tokenConfigured:boolean}}
     */
    function list() {
        const order = { needs_human: 0, failed_checks: 1, waiting: 2, conflict: 3, merged: 4, closed: 5 };
        const prs = load().prs.slice().reverse().map((p) => ({
            number: p.number, pr_url: p.pr_url, run_id: p.run_id, needs: p.needs || [], summary: p.summary || '', at: iso(p.at),
            mode: p.mode, status: p.status, why: p.why || null, check: p.check ? { state: p.check.state, why: p.check.why, at: iso(p.check.at) } : null,
            mergedAt: iso(p.mergedAt), mergedBy: p.mergedBy || null,
        })).sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
        return { prs, counts: { needs_human: prs.filter((p) => p.status === 'needs_human').length, waiting: prs.filter((p) => p.status === 'waiting').length }, tokenConfigured: !!token() };
    }

    /** 서버 시작 때 — 검사 기다리던 PR 의 확인을 1분 뒤로 되살린다. [연계] ← server.js */
    function start() {
        for (const p of load().prs) if (p.status === 'waiting') arm(p.number, 60000);
        return { waiting: load().prs.filter((p) => p.status === 'waiting').length };
    }

    return { track, evaluate, mergeNow, list, start, tick, _state: () => load() };
}

let def = null;
/** 운영 기본 인스턴스. [연계] ← nariya_autorun · routes/legal.js · server.js */
function forDefault() { return def || (def = createMerger()); }

module.exports = {
    createMerger, forDefault, judge, REQUIRED_CHECK, PR_URL_RE,
    track: (d) => forDefault().track(d),
    mergeNow: (n, by) => forDefault().mergeNow(n, by),
    list: () => forDefault().list(),
    start: () => forDefault().start(),
};
