/**
 * ============================================================================
 * 파일명: services/nariya_pr_merge.js
 * 역할: 자동 반영 세션이 올린 PR 을 **조건이 맞으면 서버가 자동으로 머지**하고, 아니면 사장님이 앱에서 누를 머지 버튼 뒤의 일을 한다.
 *       (초보자용: 세션이 위키를 고쳐 PR 을 올리면, 「결정 필요」가 없고 GitHub 검사가 초록이고 위키·원문만 고쳤으면 여기서 머지까지 해 준다.
 *        아니면 머지하지 않고 「앱에서 머지 버튼」 또는 「GitHub 에서 확인」 푸시를 보낸다.)
 * ============================================================================
 *
 * [사용자 확정 — 원문]
 *   「C로 하자. 그러면 푸시알림으로 그 내용을 표현해 주어야 하고, 머지를 앱에서 눌러야한다고 푸시 알림 내용에 명시하도록 해주고.
 *    관련 머지 버튼도 앱 내에 반영하여야 해.」 (2026-11-16)
 *   C = 「검사 통과하고 결정 필요 0건이면 자동 머지, 아니면 사장님이 앱 머지 버튼」. 설계안 services/nariya_autorun.design.md §9.
 *
 * [머지 조건 — judge]
 *   공통(자동·버튼): 열린 PR · base main · head 가 같은 저장소의 claude/ 가지 · head 커밋의 「verify_all.sh 전체 실행」(GitHub Actions)이
 *     success · 다른 검사도 실패·취소 없이 끝남 · mergeable:true · 그 필수 검사가 **지금 main 의 마지막 커밋보다 뒤에** 시작됨
 *     (아니면 stale — 검사한 조합과 머지될 조합이 다르다 → update-branch 로 main 을 얹고 검사를 다시 돌린다, 적대검증 C#중-6).
 *   자동만 추가로: 결정 필요 0건 · **바뀐 파일이 전부 허용 경로**(위키·원문·작업 기록 — 아래 AUTO_ALLOW, 적대검증 C#상-1)
 *     · PR 이 그 세션이 일을 시작한 뒤에 만들어짐 · done 을 보낸 run 이 잠금 주인이었음(적대검증 C#상-2).
 *   머지는 **검사한 그 커밋(sha)만**(PUT …/merge {sha}) — 그 뒤 누가 커밋을 얹으면 GitHub 가 거절한다.
 *
 * [저장] data/nariya_pr_state.json(볼륨) — {v:1, prs:[…]} 최근 30개.
 *   status: waiting(자동 — 검사 기다림) · needs_human(앱 버튼 또는 GitHub 몫 — how 가 가른다) · failed_checks · merged · closed
 *   how: 'button'(앱 머지 버튼으로 풀림) · 'github'(버튼으로 못 풂 — GitHub 에서 처리) · 'secrets'(서버 열쇠 확인)
 *
 * [연계]
 *  - services/nariya_autorun.js done() → track() (outcome 'pr' + pr_url)
 *  - routes/legal.js GET /api/legal/autorun/prs(refresh → list) · POST /api/legal/autorun/prs/:n/merge (관리자 토큰만)
 *  - client/js/ai-chat/ai_chat.js 「자동반영」 방(renderAutorunCards) — 머지 버튼
 *  - server.js 시작 때 start() — 검사 기다리던 PR 의 확인 타이머를 되살린다
 *  - 환경 변수: GITHUB_MERGE_TOKEN(Fly secrets), FLY_APP_NAME==='seagnal-server' 일 때만 GitHub 를 부른다
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
const REQUIRED_APP = 'github-actions';               // 그 검사를 만든 앱 — 이름만 같은 다른 앱의 검사는 인정하지 않는다
const PROD_APP = 'seagnal-server';
// 자동 머지를 허용하는 경로(적대검증 C#상-1) — 세션의 본업(원문·위키·작업 기록)만. 검사 도구·게이트 기준값·서버 코드·워크플로를 건드리면 사람 몫.
//   없으면: PR 이 자기 게이트를 끄거나(워크플로·verify_all.sh·기준선) 서버 코드를 바꿔도 사람 눈 없이 배포된다.
const AUTO_ALLOW = [
    'local_server/knowledge/legal/raw/',
    'local_server/knowledge/legal/wiki/',
    'local_server/knowledge/legal/_dashboard/reread/',
    'local_server/knowledge/legal/_dashboard/touched/',
    // 원문 새 판을 받을 때 옛 판을 옮겨 두는 곳(collect_approved — 원문 글 파일, 코드 아님). 2026-11-18 PR #1485 에서 「위키·원문 밖 파일」 경고가 떴다(사용자 「뭘 개발 검토를 하라는거지」).
    'local_server/knowledge/legal/_legacy/',
];
const AUTO_ALLOW_FILES = new Set([
    'local_server/knowledge/legal/HANDOFF.md',
    'local_server/knowledge/legal/_amendments/wiki_applied.jsonl',
    'local_server/knowledge/legal/_dashboard/pending_index.json',
    'local_server/knowledge/legal/_dashboard/build_index.md',
    // 같은 날 같은 까닭으로 더함 — 수집 보고서(collect_approved)와 위키 목록(lint_index 가 다시 만드는 파일). 지시문대로 돌면 늘 바뀌는 파일이다.
    'local_server/knowledge/legal/_dashboard/collect_approved_report.json',
    'local_server/knowledge/legal/_dashboard/index.json',
]);
const CODE_EXT_RE = /\.(js|mjs|cjs|py|sh|ya?ml|ts|html|css)$/i;
// 5분: 검사(실측 약 19분 — PR #1471)를 기다리며 다시 볼 간격. 없으면 검사가 끝나도 아무도 머지하지 않는다.
const POLL_MS = 5 * 60000;
// 30분 · 24시간: 검사 실패 뒤에도 드물게 다시 본다 — 다시 돌려 초록이 되면 머지할 수 있게(적대검증 C#중-2). 24시간 뒤엔 그만.
const FAIL_POLL_MS = 30 * 60000, FAIL_WATCH_MS = 24 * 3600000;
// 3시간: 이 안에 검사가 안 끝나면 자동 머지를 그만두고 사람에게 넘긴다. 없으면 멈춘 검사를 영원히 본다.
const WAIT_MAX_MS = 3 * 3600000;
// 30분: 필수 검사가 아예 안 붙으면 이만큼 기다린 뒤 넘긴다. 없으면 3시간을 헛되이 기다린다.
const NO_CHECK_MAX_MS = 30 * 60000;
const FETCH_TIMEOUT_MS = 30000;   // GitHub 응답 하나의 상한 — 없으면 걸린 연결 하나가 확인 고리를 붙든다
const KEEP = 30;
const BAD_CONCLUSIONS = new Set(['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'stale']);

/** ms → KST ISO. @param {number} ms @returns {string|null} */
function iso(ms) { return Number.isFinite(ms) ? new Date(ms + 9 * 3600000).toISOString().slice(0, 19) + '+09:00' : null; }
const isPlain = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

/**
 * 바뀐 파일 중 자동 머지 허용 경로 밖의 것을 돌려준다. 예: outsideAuto(['local_server/routes/legal.js', 'local_server/knowledge/legal/wiki/a.md']) → ['local_server/routes/legal.js']
 * @param {string[]} files @returns {string[]}
 */
function outsideAuto(files) {
    return (files || []).filter((f) => typeof f !== 'string' || CODE_EXT_RE.test(f) || !(AUTO_ALLOW_FILES.has(f) || AUTO_ALLOW.some((p) => f.startsWith(p))));
}

/**
 * PR·검사·(있으면) 파일 목록·main 시각으로 머지할 수 있는지 판정한다(순수 함수 — 시험이 직접 먹인다).
 * @param {object} pr GitHub PR 응답 @param {object[]} runs check_runs
 * @param {{behindBy?:number, auto?:boolean, files?:string[], filesTruncated?:boolean, runSince?:number, owner?:boolean, runId?:string}} [ctx]
 *   behindBy: main 에는 있고 PR head 에는 없는 커밋 수(GET /compare/main...{head}). 0 이면 head 가 main 을 다 품었다 — 검사한 head 와 머지 결과가 같다.
 * @returns {{ok:boolean, state:string, why?:string, sha?:string, how?:string}}
 *   state: green · pending · failed · conflict · missing · skipped · stale · scope · foreign · merged · closed · invalid
 *   how(사람에게 넘길 때 어떻게 풀리나): button · github
 */
function judge(pr, runs, ctx) {
    const c = ctx || {};
    if (!isPlain(pr)) return { ok: false, state: 'invalid', why: 'PR 정보를 못 읽음', how: 'github' };
    if (pr.merged) return { ok: false, state: 'merged', why: '이미 머지됨' };
    if (pr.state !== 'open') return { ok: false, state: 'closed', why: 'PR 이 닫혀 있음' };
    const head = pr.head || {}, base = pr.base || {};
    if (base.ref !== 'main') return { ok: false, state: 'invalid', why: 'base 가 main 이 아님(' + String(base.ref).slice(0, 40) + ')', how: 'github' };
    if (typeof head.ref !== 'string' || !head.ref.startsWith('claude/')) return { ok: false, state: 'invalid', why: 'claude/ 가지가 아님', how: 'github' };
    if (!head.repo || head.repo.full_name !== REPO) return { ok: false, state: 'invalid', why: '다른 저장소(포크)의 PR', how: 'github' };
    if (typeof head.sha !== 'string' || !/^[0-9a-f]{40}$/.test(head.sha)) return { ok: false, state: 'invalid', why: 'head 커밋을 못 읽음', how: 'github' };
    const sha = head.sha;
    if (c.auto) {
        if (!c.owner) return { ok: false, state: 'foreign', why: '이 PR 을 보낸 세션이 잠금 주인인지 확인하지 못함', sha, how: 'button' };
        const created = Date.parse(pr.created_at || '');
        if (!Number.isFinite(created) || !Number.isFinite(c.runSince) || created < c.runSince) return { ok: false, state: 'foreign', why: '이 PR 이 그 세션이 일을 시작한 뒤에 만들어진 것인지 확인하지 못함', sha, how: 'button' };
        // PR 본문의 표식 「nariya-run: <run_id>」가 done 을 보낸 run 과 같아야 한다(재검토 중-D — 세션이 다른 PR 번호를 잘못 보고해도 자동 머지되지 않게).
        if (typeof c.runId !== 'string' || !c.runId || String(pr.body || '').indexOf('nariya-run: ' + c.runId) < 0) return { ok: false, state: 'foreign', why: 'PR 본문에 이 세션의 표식(nariya-run: ' + String(c.runId || '?').slice(0, 64) + ')이 없음', sha, how: 'button' };
        if (c.filesTruncated) return { ok: false, state: 'scope', why: '바뀐 파일이 너무 많아 다 보지 못함', sha, how: 'button' };
        const out = outsideAuto(c.files);
        if (!Array.isArray(c.files) || out.length) return { ok: false, state: 'scope', why: '위키·원문 밖 파일을 고침: ' + (out.slice(0, 3).join(', ') || '(목록 없음)') + (out.length > 3 ? ` 외 ${out.length - 3}개` : ''), sha, how: 'button' };
    }
    // mergeable 은 GitHub 가 늦게 채워 null 로 오래 남을 수 있다 — mergeable_state 「dirty」(충돌)도 충돌로 본다(2026-11-18 PR #1485: 충돌인데 앱이 「계산 중」으로 보였다).
    //   충돌을 검사보다 먼저 본다 — 충돌한 PR 에는 GitHub 가 검사를 돌리지 않아(머지 ref 를 못 만듦) 「필수 검사 없음」으로 30분을 헛기다리다 넘겼다(2026-11-18 PR #1497).
    if (pr.mergeable === false || pr.mergeable_state === 'dirty') return { ok: false, state: 'conflict', why: '충돌 — 이 PR 과 main 이 같은 파일(대개 HANDOFF.md 작업 기록)을 서로 다르게 고쳤습니다', sha, how: 'github' };
    const list = Array.isArray(runs) ? runs : [];
    const bad = list.filter((r) => r && r.status === 'completed' && BAD_CONCLUSIONS.has(r.conclusion));
    if (bad.length) return { ok: false, state: 'failed', why: '검사 실패: ' + bad.map((r) => String(r.name).slice(0, 40)).join(', '), sha };
    const req = list.filter((r) => r && r.name === REQUIRED_CHECK && r.app && r.app.slug === REQUIRED_APP);
    // 충돌인지 아직 모르면(GitHub 가 main 이 바뀐 뒤 머지 가능 여부를 다시 계산 중 — mergeable null) 「검사 없음」으로 30분을 세지 않는다 — 곧 다시 본다(2026-11-18 PR #1497: 계산 중이던 순간에 「검사 없음」으로 남았다).
    if (!req.length && pr.mergeable == null && pr.mergeable_state !== 'clean') return { ok: false, state: 'pending', why: 'GitHub 가 머지 가능 여부를 계산 중', sha, how: 'button' };
    if (!req.length) return { ok: false, state: 'missing', why: '필수 검사(' + REQUIRED_CHECK + ')가 아직 없음', sha, how: 'github' };
    if (list.some((r) => r && r.status !== 'completed')) return { ok: false, state: 'pending', why: '검사 진행 중', sha, how: 'button' };
    if (req.some((r) => r.conclusion === 'skipped' || r.conclusion === 'neutral')) return { ok: false, state: 'skipped', why: '필수 검사가 돌지 않음(' + req.map((r) => r.conclusion).join(',') + ')', sha, how: 'github' };
    if (!req.every((r) => r.conclusion === 'success')) return { ok: false, state: 'pending', why: '검사 진행 중', sha, how: 'button' };
    if (pr.mergeable !== true) return { ok: false, state: 'pending', why: 'GitHub 가 머지 가능 여부를 계산 중', sha, how: 'button' };
    // 검사한 head 가 main 을 다 품지 않았으면(behind_by > 0) 머지 결과가 검사한 것과 달라진다 — 최신 main 을 얹고 다시 검사(재검토 중-C:
    //   커밋 시각 비교는 늦게 push 된 커밋을 놓쳤다). 모르면(behindBy 없음) 머지하지 않는다.
    if (!Number.isInteger(c.behindBy) || c.behindBy < 0) return { ok: false, state: 'error', why: 'main 과의 차이를 확인하지 못함', sha, how: 'button' };
    if (c.behindBy > 0) return { ok: false, state: 'stale', why: 'PR 가지가 최신 main 보다 ' + c.behindBy + '커밋 뒤처짐 — 최신 main 을 얹고 다시 검사해야 함', sha, how: 'button' };
    return { ok: true, state: 'green', sha };
}

/**
 * 머지 담당을 만든다. 시험은 시계·타이머·fetch·푸시·파일·환경 변수를 바꿔 넣는다.
 * @param {object} [o] {file, now, setTimer, clearTimer, fetch, push, env}
 * @returns {object} track · evaluate · mergeNow · refresh · list · start · tick · _state
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
    // 충돌 처리 담당(2026-11-18 사용자 「자동으로 세션이 해결」) — PR 번호를 받아 자동 반영 세션에 「충돌 풀기」를 맡긴다(nariya_autorun.requestRun('conflict')).
    //   없으면(시험·개발) 종전대로 「GitHub 에서 확인」으로 넘긴다. forDefault 가 운영 담당을 넣는다.
    onConflict = null,
    // 결정 필요 답 담당(2026-11-18 사용자 「앱에 답 칸 만들기」) — 답을 저장하면 자동 반영 세션을 깨운다(nariya_autorun.requestRun('answer')). 없으면 저장만.
    onAnswer = null,
} = {}) {
    let state = null, conflictHook = onConflict, answerHook = onAnswer;
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
            try { fs.renameSync(file, moved); } catch (e2) { console.error('[nariya_pr_merge] 깨진 상태 파일을 옮기지 못함:', e2 && e2.message); }
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
            try { fs.unlinkSync(tmp); } catch (e2) { console.error('[nariya_pr_merge] 임시 파일 정리 실패:', e2 && e2.message); }
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
    const httpFail = (what, r) => ({ ok: false, state: [401, 403, 404].includes(r.status) ? 'auth' : 'error',
        why: what + ' 실패(HTTP ' + r.status + (r.json && r.json.message ? ' · ' + String(r.json.message).slice(0, 80) : '') + ')', how: [401, 403, 404].includes(r.status) ? 'secrets' : undefined });

    /**
     * PR 의 지금 상태를 GitHub 에서 읽어 판정한다(머지는 안 한다).
     * @param {number} n @param {{auto?:boolean, runSince?:number, owner?:boolean, runId?:string, withFiles?:boolean}} [o]
     * @returns {Promise<object>} judge 결과 + title · outside(허용 경로 밖 파일 — 파일을 읽었을 때)
     */
    async function evaluate(n, o) {
        const opt = o || {};
        if (!token()) return { ok: false, state: 'no_token', why: 'GITHUB_MERGE_TOKEN 이 없어 GitHub 를 볼 수 없음', how: 'secrets' };
        const p = await gh('GET', API + '/pulls/' + n);
        if (!p.ok) return httpFail('PR 조회', p);
        const sha = p.json && p.json.head && p.json.head.sha;
        let runs = [];
        if (typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha)) {
            // 100개씩 끝까지(최대 5쪽) — 한 쪽만 보면 101번째부터의 실패를 놓친다(적대검증 C#하-3).
            for (let page = 1; page <= 5; page++) {
                const c = await gh('GET', API + '/commits/' + sha + '/check-runs?per_page=100&page=' + page);
                if (!c.ok) return httpFail('검사 조회', c);
                const got = (c.json && c.json.check_runs) || [];
                runs = runs.concat(got);
                if (!got.length || runs.length >= ((c.json && c.json.total_count) || 0)) break;
                if (page === 5) return { ok: false, state: 'error', why: '검사가 500개를 넘어 다 보지 못함', how: 'github' };
            }
        }
        let behindBy = NaN;
        if (typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha)) {
            const m = await gh('GET', API + '/compare/main...' + sha);
            if (!m.ok) return httpFail('main 과 비교', m);
            behindBy = m.json && Number.isInteger(m.json.behind_by) ? m.json.behind_by : NaN;
        }
        let files = null, filesTruncated = false;
        if (opt.auto || opt.withFiles) {
            files = [];
            for (let page = 1; page <= 30; page++) {
                const f = await gh('GET', API + '/pulls/' + n + '/files?per_page=100&page=' + page);
                if (!f.ok) return httpFail('바뀐 파일 조회', f);
                const got = Array.isArray(f.json) ? f.json : [];
                // 이름 바꾸기는 옛 경로도 본다 — 기준선·검사 도구를 wiki/ 로 「옮기는」 것은 그 자리에서 지우는 것과 같다(재검토 중-A).
                for (const x of got) { if (!x) continue; files.push(x.filename); if (x.previous_filename) files.push(x.previous_filename); }
                if (got.length < 100) break;
                if (page === 30) filesTruncated = true;   // GitHub 는 3,000개까지만 준다
            }
        }
        const r = judge(p.json, runs, { behindBy, auto: !!opt.auto, files, filesTruncated, runSince: opt.runSince, owner: opt.owner, runId: opt.runId });
        const outside = files ? outsideAuto(files) : null;
        return Object.assign(r, { title: String((p.json && p.json.title) || '').slice(0, 200), ref: p.json && p.json.head && typeof p.json.head.ref === 'string' ? p.json.head.ref.slice(0, 200) : null }, outside ? { outside: outside.slice(0, 5), outsideCount: outside.length + (filesTruncated ? '+' : '') } : {});
    }

    /** 그 sha 만 머지한다. @returns {Promise<{ok:boolean, why?:string}>} */
    async function doMerge(n, sha) {
        const r = await gh('PUT', API + '/pulls/' + n + '/merge', { sha, merge_method: 'merge' });
        if (r.ok && r.json && r.json.merged) return { ok: true };
        return { ok: false, why: 'GitHub 머지 거절(HTTP ' + r.status + (r.json && r.json.message ? ' · ' + String(r.json.message).slice(0, 120) : '') + ')' };
    }
    /** 최신 main 을 PR 가지에 얹는다(검사가 새로 돈다). expected_head_sha 로 그 사이 바뀐 가지는 건드리지 않는다. */
    async function updateBranch(n, sha) {
        const r = await gh('PUT', API + '/pulls/' + n + '/update-branch', { expected_head_sha: sha });
        if (r.ok) return { ok: true };
        return { ok: false, why: 'main 얹기 거절(HTTP ' + r.status + (r.json && r.json.message ? ' · ' + String(r.json.message).slice(0, 120) : '') + ')' };
    }

    function arm(n, ms) {
        if (timers.has(n)) clearTimer(timers.get(n));
        timers.set(n, setTimer(() => { timers.delete(n); tick(n).catch((e) => console.error('[nariya_pr_merge] 확인 오류:', e && e.message)); }, ms));
    }
    function disarm(n) { if (timers.has(n)) { clearTimer(timers.get(n)); timers.delete(n); } }

    /** 사람에게 넘길 때 무엇을 해야 하나 — 푸시·카드에 같은 글을 쓴다(적대검증 C#중-3). */
    const HOW_TEXT = {
        button: '앱 → 관리자 → 「자동반영」 방에서 내용을 확인하고 [머지] 버튼을 눌러 주세요(검사가 끝나 초록이면 눌립니다)',
        github: '앱 버튼으로는 풀 수 없습니다 — GitHub 에서 PR 을 직접 확인해 주세요(앱 「자동반영」 방 카드의 「GitHub 에서 보기」)',
        secrets: '서버의 GitHub 열쇠(Fly secrets GITHUB_MERGE_TOKEN)의 값·권한을 확인해 주세요',
    };
    /**
     * 사람에게 넘긴다 — needs_human + how + 푸시.
     * 「머지 버튼을 눌러 주세요」 푸시는 **검사가 초록일 때만**(ready) 보낸다 — 2026-11-18 사용자: 푸시를 받고 가 보니 버튼이 잠겨 있었다(검사 진행 중)
     *   → *"추천대로 진행"*(= 검사가 초록으로 끝난 뒤에 푸시). 초록이 아닌 채 넘길 때(3시간·머지 거절 등)는 「확인 필요」로 쓴다.
     * 푸시 글은 쉬운 말만 — 파일 경로·영문·PR 주소는 넣지 않는다(사용자 「어려운 명칭이라던가 영문이라던가 이런 거는 굳이 필요가 없지 않니」). 자세한 것은 앱 카드에 있다.
     * @param {object} p @param {string} why @param {string} [how] - button|github|secrets @param {boolean} [ready] - 검사 초록(지금 버튼이 눌린다)
     */
    async function handOver(p, why, how, ready) {
        disarm(p.number);
        p.status = 'needs_human'; p.why = why; p.how = how || 'button'; p.mode = 'human'; save();
        // 「위키·원문 밖 파일을 고침: local_server/…」 → 앞말만 · 괄호 속(「표식(nariya-run: …)」)은 뺀다(적대검증 하3 — 괄호가 안 닫힌 채 잘렸다).
        const plain = (p.needs || []).length && /^결정 필요/.test(String(why)) ? '결정 필요 ' + p.needs.length + '건'
            : String(why || '').replace(/\([^)]*\)/g, '').split(':')[0].replace(/\s+/g, ' ').trim();
        const title = p.how !== 'button' ? '나리야 자동 반영 — 자동 머지 안 함 · 확인 필요'
            : ready ? '나리야 자동 반영 — 앱에서 머지 버튼을 눌러 주세요' : '나리야 자동 반영 — 확인 필요';
        const body = p.how !== 'button' ? `${plain}. ${HOW_TEXT[p.how]}.`
            : ready ? `검사를 통과했습니다(자동으로 머지하지 않은 까닭: ${plain}). 앱 → 관리자 → 「자동반영」 방에서 내용을 확인하고 [머지] 버튼을 눌러 주세요.`
            : `${plain}. 앱 → 관리자 → 「자동반영」 방에서 확인해 주세요.`;
        await notify(title, body, { type: 'nariya_pr_needs_human', pr: String(p.number), how: p.how, ready: String(!!ready) });
    }

    /**
     * 충돌(conflict) — 자동 반영 세션에 풀기를 맡기고(conflict_fixing) 계속 지켜본다(2026-11-18 사용자 「자동으로 세션이 해결」).
     *  · 같은 head 로는 한 번만 맡긴다 · 맡긴 뒤 3시간 넘게 그대로면, 또는 서로 다른 head 로 두 번 맡겨도 또 충돌이면 「GitHub 에서 확인」으로 넘긴다.
     *  · 세션이 「기록 파일 말고 다른 파일도 겹친다」고 보고하면(conflictResult deferred) 바로 넘긴다. 담당이 없으면 종전대로 넘긴다.
     * [연계] ← tick · refresh / → conflictHook(nariya_autorun.requestRun('conflict'))
     */
    async function handleConflict(p, r) {
        if (!conflictHook) { await handOver(p, r.why, 'github'); return; }
        if (p.status === 'conflict_fixing' && p.conflictFor === r.sha) {
            if (now() - (p.conflictAt || now()) >= WAIT_MAX_MS) { await handOver(p, '충돌을 3시간 안에 자동으로 풀지 못했습니다 — GitHub 에서 확인해 주세요', 'github'); return; }
            arm(p.number, POLL_MS); return;
        }
        if ((p.conflictTries || 0) >= 2) { await handOver(p, '충돌이 되풀이돼 자동으로 풀지 않습니다 — GitHub 에서 확인해 주세요', 'github'); return; }
        if (p.status !== 'conflict_fixing') { p.statusBefore = p.status; p.whyBefore = p.why || null; }
        p.conflictFor = r.sha || null; p.conflictAt = now(); p.conflictTries = (p.conflictTries || 0) + 1; if (r.ref) p.branch = r.ref;
        p.status = 'conflict_fixing'; p.why = '충돌 — 자동 반영 세션이 푸는 중'; save();
        let q = null;
        try { q = conflictHook(p.number); } catch (e) { console.error('[nariya_pr_merge] PR #' + p.number + ' 충돌 풀기 맡기기 실패:', e && e.message); }
        if (!q || (q.queued === false && !q.locked)) { await handOver(p, '충돌 풀기를 자동 반영 세션에 맡기지 못했습니다' + (q && q.seen ? '(자동 반영 세션이 최근 이 PR 을 다뤘지만 풀지 못함)' : '') + ' — GitHub 에서 확인해 주세요', 'github'); return; }
        arm(p.number, POLL_MS);
    }
    /**
     * 자동 반영 세션의 충돌 풀기 결과(done 의 conflict_ids · deferred_conflict_ids). 푼 PR 은 곧바로 다시 확인하고, 못 푼 PR 은 「GitHub 에서 확인」으로 넘긴다.
     * @param {string[]} fixed @param {string[]} deferred [연계] ← nariya_autorun.done
     */
    async function conflictResult(fixed, deferred) {
        for (const id of fixed || []) { const p = find(Number(id)); if (p && p.status === 'conflict_fixing') arm(p.number, 60000); }
        for (const id of deferred || []) { const p = find(Number(id)); if (p && p.status === 'conflict_fixing') await handOver(p, '작업 기록 말고 다른 파일도 겹쳐 자동으로 풀지 않았습니다 — GitHub 에서 확인해 주세요', 'github'); }
    }
    /** 세션이 풀 충돌 PR 목록(GET /api/legal/autorun/conflicts). @returns {{number:number, branch:string|null, pr_url:string}[]} */
    //   가지 이름은 claude/ 로 시작하는 안전한 글자만 준다 — 세션이 셸 명령에 넣는다(적대검증 하 — 「claude/$(id)」도 git 이 허용하는 이름이다). 아니면 branch null(세션은 손대지 않고 deferred).
    const SAFE_BRANCH = /^claude\/[A-Za-z0-9._\/-]{1,150}$/;
    function conflicts() { return load().prs.filter((p) => p.status === 'conflict_fixing').map((p) => ({ number: p.number, branch: p.branch && SAFE_BRANCH.test(p.branch) && !/\.\.|\/\//.test(p.branch) ? p.branch : null, pr_url: p.pr_url })); }

    /**
     * 자동 머지 대기(waiting)·검사 실패(failed_checks) PR 을 한 번 확인한다.
     * [연계] ← arm 타이머 · start(되살림)
     */
    async function tick(n) {
        const p = find(n);
        if (!p || (p.status !== 'waiting' && p.status !== 'failed_checks' && p.status !== 'conflict_fixing')) return;
        if (busy.has(n)) { arm(n, POLL_MS); return; }   // 버튼이 확인 중이면 물러나되 다시 건다(적대검증 C#중-1 — 안 걸면 영영 멈춘다)
        if (!isProd()) { console.log('[nariya_pr_merge] 운영 아님 — PR #' + n + ' 확인 생략'); return; }
        busy.add(n);
        try {
            let auto = p.mode === 'auto';
            let r;
            try {
                r = await evaluate(n, { auto, runSince: p.runSince, owner: p.owner, runId: p.run_id });
                // 자동 조건(주인·표식·범위)에서 떨어지면 사람 몫으로 내리고 **검사는 계속 본다** — 초록이 되면 그때 「머지 버튼」 푸시(2026-11-18).
                //   종전에는 검사가 아직 도는데도 곧바로 「머지 버튼을 눌러 주세요」를 보내 가 보면 잠겨 있었다.
                if (auto && (r.state === 'foreign' || r.state === 'scope')) {
                    p.mode = 'human'; p.how = 'button'; p.why = r.why; save(); auto = false;
                    r = await evaluate(n, {});
                }
            }
            catch (e) { console.error('[nariya_pr_merge] PR #' + n + ' 확인 실패(다시 봄):', e && e.message); r = { ok: false, state: 'error', why: '연결 실패: ' + String((e && e.message) || e).slice(0, 80) }; }
            p.check = { state: r.state, why: r.why || null, at: now() }; save();
            if (r.state === 'conflict') { await handleConflict(p, r); return; }
            // 충돌이 풀렸다(세션이 main 을 합쳐 올림) — 맡기기 전 상태로 돌아가 하던 대로 본다(검사 초록이면 자동 머지·「머지 버튼」 푸시).
            //   같은 head 인데 GitHub 가 머지 가능 여부를 아직 계산 중(null)이거나 일시 오류면 풀린 것이 아니다 — 그대로 기다린다(적대검증 중1 — 다시 충돌로 보고 세션을 또 깨웠다).
            if (p.status === 'conflict_fixing') {
                const resolved = r.ok || (r.sha && r.sha !== p.conflictFor) || ['failed', 'stale', 'merged', 'closed'].includes(r.state);
                if (!resolved) {
                    if (now() - (p.conflictAt || now()) >= WAIT_MAX_MS) await handOver(p, '충돌을 3시간 안에 자동으로 풀지 못했습니다 — GitHub 에서 확인해 주세요', 'github');
                    else arm(n, POLL_MS);
                    return;
                }
                p.status = p.statusBefore === 'failed_checks' ? 'failed_checks' : 'waiting'; p.why = p.whyBefore || null; p.watchFrom = now();
                // 맡기기 전 까닭이 「GitHub 에서 확인」 몫의 까닭(검사 30분 없음 등 — 충돌 탓이었다)이면 버리고 지금 까닭으로 — 그대로 두면 「머지 버튼」 푸시에 옛 까닭이 실린다(2026-11-18 PR #1497).
                if (p.how === 'github') { p.how = 'button'; p.why = (p.needs || []).length ? '결정 필요 ' + p.needs.length + '건' : parseInt(p.outsideCount, 10) > 0 ? '위키·원문 밖 파일(프로그램 코드 등)을 고침' : null; }
                save();
            }
            // 확인을 기다리는 사이 track 이 사람 몫으로 내렸으면(결정 필요가 더해짐) 머지하지 않는다(적대검증 하5 — p 는 상태 객체 그 자체라 지금 값을 본다).
            if (r.ok && auto && p.mode !== 'auto') auto = false;
            if (r.ok && auto) {
                let m;
                try { m = await doMerge(n, r.sha); } catch (e) { console.error('[nariya_pr_merge] PR #' + n + ' 자동 머지 요청 실패:', e && e.message); m = { ok: false, why: '연결 실패: ' + String((e && e.message) || e).slice(0, 80) }; }
                if (m.ok) {
                    p.status = 'merged'; p.mergedAt = now(); p.mergedBy = 'auto'; p.mergedSha = r.sha; save();
                    await notify('나리야 자동 반영 — 자동 머지 완료 · 배포 시작',
                        '검사를 통과해 자동으로 머지했습니다. 배포가 이어서 시작됩니다(누를 것 없음).',
                        { type: 'nariya_pr_merged', pr: String(n), by: 'auto' });
                } else await handOver(p, '자동 머지가 거절됐습니다 — ' + m.why, 'button');
                return;
            }
            if (r.ok) { await handOver(p, p.why || '사람 확인이 필요한 PR', 'button', true); return; }   // 사람 몫 PR 의 검사가 초록이 됨(처음이든 실패 뒤든) — 이제 버튼이 눌린다
            if (r.state === 'merged' || r.state === 'closed') { p.status = r.state; if (r.state === 'merged' && !p.mergedAt) { p.mergedAt = now(); p.mergedBy = p.mergedBy || 'GitHub'; } disarm(n); save(); return; }
            if (r.state === 'failed') {
                if (p.status !== 'failed_checks') {
                    // 사람 몫 PR 은 처음 까닭(결정 필요 N건 등)을 지운다 — 초록이 되면 그 까닭으로 「머지 버튼」 푸시를 보낸다. 실패 까닭은 check.why 에 있다.
                    p.status = 'failed_checks'; if (auto) p.why = r.why; p.failedAt = now(); save();
                    await notify('나리야 자동 반영 — 검사 실패 · 자동 머지 안 함',
                        '검사가 실패해 머지 버튼이 잠깁니다. 다시 돌려 통과하면 알려 드립니다. 앱 → 관리자 → 「자동반영」 방에서 확인해 주세요.',
                        { type: 'nariya_pr_failed', pr: String(n) });
                }
                if (now() - (p.failedAt || now()) < FAIL_WATCH_MS) arm(n, FAIL_POLL_MS);
                else await handOver(p, '검사 실패가 24시간 이어졌습니다 — 더는 자동으로 지켜보지 않습니다', 'button');   // 적대검증 하4 — 조용히 멈추지 않게
                return;
            }
            if (p.status === 'failed_checks' && (r.state === 'pending' || r.state === 'missing' || r.state === 'error')) {   // 다시 도는 중
                if (now() - (p.failedAt || now()) < FAIL_WATCH_MS) arm(n, POLL_MS);
                else await handOver(p, '검사 실패가 24시간 이어졌습니다 — 더는 자동으로 지켜보지 않습니다', 'button');
                return;
            }
            if (r.state === 'stale' && now() - (p.watchFrom || p.at) >= WAIT_MAX_MS) { await handOver(p, '3시간 동안 최신 main 으로 다시 검사하지 못했습니다 — ' + r.why, 'button'); return; }   // 재검토 중-C — 상한 없이 영원히 돌던 분기
            if (r.state === 'stale') {
                // 검사 뒤 main 이 바뀌었다 — 최신 main 을 얹어 검사를 다시 돌린다(같은 head 로는 한 번만).
                if (p.updatedFor !== r.sha) {
                    let u;
                    try { u = await updateBranch(n, r.sha); } catch (e) { console.error('[nariya_pr_merge] PR #' + n + ' main 얹기 실패:', e && e.message); u = { ok: false, why: '연결 실패' }; }
                    if (!u.ok) { await handOver(p, u.why, 'github'); return; }
                    p.updatedFor = r.sha; save();
                }
                arm(n, POLL_MS);
                return;
            }
            if (['invalid', 'no_token', 'auth', 'scope', 'foreign', 'skipped'].includes(r.state)) { await handOver(p, r.why, r.how || 'github'); return; }
            const waited = now() - (p.watchFrom || p.at);   // 지켜보기 시작 시각부터(충돌을 푼 뒤·다시 done 뒤에는 그때부터 — 적대검증 상1)
            if (r.state === 'missing' && waited >= NO_CHECK_MAX_MS) { await handOver(p, '필수 검사가 30분 동안 붙지 않았습니다', 'github'); return; }
            if (waited >= WAIT_MAX_MS) { await handOver(p, r.state === 'error' ? '3시간 동안 GitHub 를 확인하지 못했습니다 — ' + r.why : '검사가 3시간 안에 끝나지 않았습니다', r.state === 'error' ? 'github' : 'button'); return; }
            arm(n, POLL_MS);   // pending · missing(30분 전) · error — 5분 뒤 다시
        } finally { busy.delete(n); }
    }

    /**
     * 세션이 올린 PR 을 맡는다(done 'pr' 때).
     * 자동(waiting · auto): 결정 필요 0건 · done 을 보낸 run 이 잠금 주인(owner) · 열쇠 있음. 아니면 사람 몫(mode human) — 버튼 몫은 검사를 지켜보다가(waiting)
     * 초록이 되면 「머지 버튼」 푸시와 함께 needs_human, 열쇠가 없으면 곧바로 needs_human.
     * 이미 맡은 PR 에 결정 필요가 오면 합치고 사람 몫으로 내린다(적대검증 C#중-4 — 안 그러면 푸시는 「앱 버튼」인데 서버는 자동 머지).
     * 예: track({pr_url:'…/pull/9', run_id:'ar-1', needs_decision:[], summary:'…'}, {owner:true, runSince:Date.now()-3600000}) → {tracked:true, mode:'auto'}
     * @param {{pr_url:string, run_id?:string, needs_decision?:string[], summary?:string}} d
     * @param {{owner?:boolean, runSince?:number}} [o]
     * @returns {{tracked:boolean, mode?:'auto'|'human', why?:string, how?:string, updated?:boolean}}
     * [연계] ← nariya_autorun.done
     */
    function track(d, o) {
        const opt = o || {};
        const m = PR_URL_RE.exec(String((d && d.pr_url) || ''));
        if (!m) return { tracked: false, why: 'PR 주소가 이 저장소 PR 이 아님' };
        const n = Number(m[1]);
        const needs = Array.isArray(d.needs_decision) ? d.needs_decision.filter((x) => typeof x === 'string').slice(0, 20) : [];
        // 결정 필요마다 세션이 준 추천안(needs_options — 첫 칸이 추천, 2026-11-18 사용자 「추천안을 버튼으로」). needs 와 같은 순서.
        const opts = Array.isArray(d.needs_options) ? d.needs_options.slice(0, needs.length).map((a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.slice(0, 80)).slice(0, 4) : [])) : [];
        const old = find(n);
        if (old) {
            if (needs.length) {
                const before = old.needs || [], add = needs.map((x, i) => [x, opts[i] || []]).filter(([x]) => !before.includes(x));
                old.needs = before.concat(add.map((a) => a[0])).slice(0, 20);
                old.needOptions = (old.needOptions || before.map(() => [])).concat(add.map((a) => a[1])).slice(0, old.needs.length);
                // 상태와 무관하게 auto 면 내린다(재검토 중-B — failed_checks 인 auto PR 이 재실행 뒤 결정 필요를 안고 자동 머지되던 길).
                //   2026-11-18: 상태(waiting·failed_checks)와 확인은 그대로 둔다 — 검사가 초록이 되면 그때 「머지 버튼」 푸시.
                if (old.mode === 'auto' && ['waiting', 'failed_checks', 'conflict_fixing'].includes(old.status)) { old.mode = 'human'; old.how = 'button'; old.why = '다른 세션이 결정 필요를 더했습니다'; }
                save();
            }
            // 다른 run 이 같은 PR 로 다시 done 했다 = 새 커밋이 올라왔을 수 있다 → 사람 몫(버튼) PR 은 다시 지켜본다(적대검증 중1 —
            //   needs_human 은 타이머가 없어 done 이 약속한 「검사가 끝나면 머지 버튼 알림」이 오지 않았다). 실패 뒤 24시간이 지나 멈춘 것도 다시 본다.
            if (old.mode === 'human' && old.how === 'button' && (old.status === 'needs_human' || (old.status === 'failed_checks' && !timers.has(n)))) {
                if (old.status === 'failed_checks') old.failedAt = now(); else { old.status = 'waiting'; old.watchFrom = now(); }
                save(); arm(n, POLL_MS);
            }
            return { tracked: true, updated: true, mode: old.mode, how: old.how, status: old.status };
        }
        let why = null, how = null;
        if (needs.length) { why = '결정 필요 ' + needs.length + '건'; how = 'button'; }
        else if (!opt.owner) { why = '이 PR 을 보낸 세션이 잠금 주인인지 확인하지 못함'; how = 'button'; }
        else if (!token()) { why = '서버에 GitHub 열쇠가 없어 자동 머지할 수 없음'; how = 'secrets'; }
        const auto = !why;
        // 사람 몫(버튼)도 검사를 지켜본다(status waiting · mode human) — 초록이 되면 「머지 버튼을 눌러 주세요」 푸시(2026-11-18 사용자 「추천대로」).
        //   열쇠가 없으면(secrets) 지켜볼 수 없으니 곧바로 needs_human.
        const watch = auto || how === 'button';
        const p = { number: n, pr_url: m[0], run_id: typeof d.run_id === 'string' ? d.run_id.slice(0, 64) : null, needs, summary: typeof d.summary === 'string' ? d.summary.slice(0, 500) : '',
            at: now(), runSince: Number.isFinite(opt.runSince) ? opt.runSince : null, owner: !!opt.owner,
            mode: auto ? 'auto' : 'human', status: watch ? 'waiting' : 'needs_human', why, how, needOptions: needs.map((_, i) => opts[i] || []) };
        const st = load();
        st.prs = st.prs.concat([p]).slice(-KEEP);
        save();
        if (watch) arm(n, POLL_MS);
        return { tracked: true, mode: p.mode, why: why || undefined, how: how || undefined, status: p.status };
    }

    /**
     * 앱 머지 버튼(관리자). 결정 필요·범위 밖 파일이 있어도 사람이 누른 것이면 된다. 공통 조건(검사 초록·충돌 없음·claude/ 가지·최신 main)일 때만, 확인한 sha 만 머지.
     * main 이 바뀌어 stale 이면 최신 main 을 얹고 「약 20분 뒤 다시 눌러 주세요」.
     * @param {number} n @param {string} [by] @returns {Promise<{ok:boolean, status?:number, why?:string, state?:string}>}
     * [연계] ← routes/legal.js POST /api/legal/autorun/prs/:n/merge
     */
    async function mergeNow(n, by) {
        if (!Number.isInteger(n) || n <= 0) return { ok: false, status: 400, why: 'PR 번호가 틀림' };
        const p = find(n);
        if (!p) return { ok: false, status: 404, why: '자동 반영이 맡은 PR 이 아님' };
        if (!token()) return { ok: false, status: 503, why: 'GITHUB_MERGE_TOKEN 이 없어 머지할 수 없습니다(Fly secrets 확인)' };
        if (busy.has(n)) return { ok: false, status: 409, why: '이 PR 을 지금 확인·머지하는 중입니다 — 잠시 뒤 다시 눌러 주세요' };
        busy.add(n);
        try {
            const r = await evaluate(n, {});
            p.check = { state: r.state, why: r.why || null, at: now() }; save();
            if (r.state === 'merged' || r.state === 'closed') { p.status = r.state; disarm(n); save(); return { ok: false, status: 409, state: r.state, why: r.why }; }
            if (r.state === 'stale') {
                const u = await updateBranch(n, r.sha);
                if (!u.ok) return { ok: false, status: 409, state: 'stale', why: u.why + ' — GitHub 에서 확인해 주세요' };
                p.updatedFor = r.sha; save();
                return { ok: false, status: 409, state: 'stale', why: 'main 이 바뀌어 최신 main 으로 검사를 다시 돌립니다 — 약 20분 뒤 다시 눌러 주세요' };
            }
            if (!r.ok) return { ok: false, status: 409, state: r.state, why: r.why };
            const m = await doMerge(n, r.sha);
            if (!m.ok) return { ok: false, status: 502, why: m.why };
            p.status = 'merged'; p.mergedAt = now(); p.mergedBy = String(by || '관리자').slice(0, 40); p.mergedSha = r.sha;
            disarm(n);
            save();
            return { ok: true, state: 'merged' };
        } catch (e) {
            console.error('[nariya_pr_merge] PR #' + n + ' 머지 버튼 처리 실패:', e && e.message);
            return { ok: false, status: 502, why: '연결 실패: ' + String((e && e.message) || e).slice(0, 80) };
        } finally {
            busy.delete(n);
            if (p.status === 'waiting' && !timers.has(n)) arm(n, POLL_MS);   // 버튼이 실패해도 자동 확인은 이어 간다(적대검증 C#중-1)
        }
    }

    /**
     * 앱이 방을 열 때 — 머지되지 않은 PR(최근 10개)을 GitHub 에서 다시 읽어 「지금 버튼이 눌리나」·범위 밖 파일을 적는다.
     * 머지는 하지 않는다. 운영 아님·열쇠 없음이면 아무것도 안 한다.
     * @returns {Promise<void>} [연계] ← routes/legal.js GET /api/legal/autorun/prs
     */
    async function refresh() {
        if (!isProd() || !token()) return;
        const open = load().prs.filter((p) => ['waiting', 'needs_human', 'failed_checks', 'conflict_fixing'].includes(p.status)).slice(-10);
        // PR 들을 한꺼번에 읽는다(재검토 하-신규1 — 하나씩이면 방이 오래 「불러오는 중」).
        await Promise.all(open.map(async (p) => {
            if (busy.has(p.number)) return;
            busy.add(p.number);
            try {
                const r = await evaluate(p.number, { withFiles: true });
                p.check = { state: r.state, why: r.why || null, at: now() };
                // stale 도 버튼을 연다 — 누르면 서버가 최신 main 을 얹고 「약 20분 뒤 다시」(재검토 상-신규: 안 열면 main 이 한 번만 바뀌어도 버튼이 사라졌다).
                p.canMerge = r.ok || r.state === 'stale';
                if (r.outside) { p.outside = r.outside; p.outsideCount = r.outsideCount; }
                if (r.state === 'merged' || r.state === 'closed') { p.status = r.state; if (r.state === 'merged' && !p.mergedAt) { p.mergedAt = now(); p.mergedBy = p.mergedBy || 'GitHub'; } disarm(p.number); }
                // 사람 몫(needs_human) PR 이 충돌이면 자동 반영 세션에 풀기를 맡긴다(지켜보던 PR 은 tick 이 맡는다).
                //   이미 「GitHub 에서 확인」으로 넘긴 PR(how github — 못 풂·3시간·되풀이)은 다시 맡기지 않는다(적대검증 중2 — 방을 열 때마다 푸시가 갔다).
                //   한 번도 충돌 풀기를 맡긴 적 없는 PR 은 「GitHub 에서 확인」 몫이어도 맡긴다(예: 위 순서 고침 전 「필수 검사 30분 없음」으로 넘어간 충돌 PR — #1497).
                else if (r.state === 'conflict' && p.status === 'needs_human' && (p.how === 'button' || !p.conflictTries) && conflictHook) await handleConflict(p, r);
            } catch (e) { console.error('[nariya_pr_merge] PR #' + p.number + ' 새로 읽기 실패:', e && e.message); }
            finally { busy.delete(p.number); }
        }));
        save();
    }

    /**
     * 앱 「자동반영」 방에 보일 목록(사람 몫·실패·대기를 위에). 상태를 바꾸지 않는다.
     * @returns {{prs:object[], counts:{needs_human:number, waiting:number}, tokenConfigured:boolean}}
     */
    function list() {
        const order = { needs_human: 0, failed_checks: 1, conflict_fixing: 2, waiting: 2, merged: 4, closed: 5 };
        // [확인]을 누른 머지·닫힌 PR 은 목록에서 뺀다(2026-11-18 사용자 「확인 버튼을 눌러서 … 더이상 표출할 필요없게」). 기록(상태 파일)은 남는다.
        const prs = load().prs.slice().reverse().filter((p) => !p.dismissedAt).map((p) => ({
            number: p.number, pr_url: p.pr_url, run_id: p.run_id, needs: p.needs || [], summary: p.summary || '', at: iso(p.at),
            mode: p.mode, status: p.status, why: p.why || null, how: p.how || null, howText: p.how ? HOW_TEXT[p.how] : null,
            canMerge: p.canMerge === true, outside: p.outside || [], outsideCount: p.outsideCount || 0,
            check: p.check ? { state: p.check.state, why: p.check.why, at: iso(p.check.at) } : null,
            needOptions: (p.needs || []).map((_, i) => ((p.needOptions || [])[i] || [])),
            answers: (p.answers || []).map((x) => (x ? { text: x.text, at: iso(x.at), handled: !!x.handledAt, deferred: !!x.deferredAt } : null)),
            mergedAt: iso(p.mergedAt), mergedBy: p.mergedBy || null,
        })).sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
        return { prs, counts: { needs_human: prs.filter((p) => p.status === 'needs_human').length, waiting: prs.filter((p) => p.status === 'waiting').length }, tokenConfigured: !!token() };
    }

    /** 서버 시작 때 — 기다리던 PR(자동 대기·실패 뒤 감시)의 확인을 1분 뒤로 되살린다. [연계] ← server.js */
    function start() {
        let k = 0;
        for (const p of load().prs) if (p.status === 'waiting' || p.status === 'conflict_fixing' || (p.status === 'failed_checks' && now() - (p.failedAt || 0) < FAIL_WATCH_MS)) { arm(p.number, 60000); k++; }
        return { waiting: k };
    }

    /**
     * 결정 필요 한 줄에 사장님 답을 적는다(앱 「자동반영」 방 답 칸 — 관리자만). 같은 줄에 다시 적으면 새 답으로 바꾸고 「처리됨」을 지운다.
     * 저장하면 자동 반영 세션을 깨워(answerHook) 그 답대로 처리하게 한다 — 세션은 GET /api/legal/autorun/answers 로 꺼내 가고 done 의 answer_ids 로 끝냈다고 알린다.
     * 예: answer(1485, 1, '도구를 교집합으로 고쳐 주세요', '관리자') → {ok:true}
     * @param {number} n @param {number} index - needs 의 몇 번째(0부터) @param {string} text @param {string} [by] @returns {{ok:boolean, status?:number, why?:string}}
     * [연계] ← routes/legal.js POST /api/legal/autorun/prs/:n/answer / → answerHook
     */
    function answer(n, index, text, by) {
        const p = find(n);
        if (!p) return { ok: false, status: 404, why: '자동 반영이 맡은 PR 이 아님' };
        if (p.status === 'merged' || p.status === 'closed') return { ok: false, status: 409, why: '이미 머지되었거나 닫힌 PR 입니다' };
        if (!Number.isInteger(index) || index < 0 || index >= (p.needs || []).length) return { ok: false, status: 400, why: '결정 필요 번호가 틀림' };
        const t = String(text || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, 500);
        if (!t) return { ok: false, status: 400, why: '답이 비었음' };
        if (!Array.isArray(p.answers)) p.answers = [];
        while (p.answers.length < p.needs.length) p.answers.push(null);   // 빈 칸(hole) 없이 — JSON 저장·화면 map 이 줄 번호를 잃지 않게
        p.answers[index] = { text: t, at: now(), by: String(by || '관리자').slice(0, 40), handledAt: null, deferredAt: null };
        save();
        // id 에 답 시각을 붙인다 — 고쳐 쓴 답은 새 일감(세션이 옛 답을 처리하고 낸 보고가 새 답을 「처리됨」으로 찍지 않게 · 보류·실패로 쉬는 옛 답에 막히지 않게 — 적대검증 중3).
        if (answerHook) { try { answerHook(n + '-' + index + '-' + p.answers[index].at); } catch (e) { console.error('[nariya_pr_merge] 답 처리 세션 깨우기 실패(답은 저장됨):', e && e.message); } }
        return { ok: true };
    }
    /** 세션이 처리할 답 목록(GET /api/legal/autorun/answers) — 아직 처리·보류되지 않은 것. @returns {object[]} */
    function answers() {
        const out = [];
        for (const p of load().prs) (p.answers || []).forEach((a, i) => { if (a && !a.handledAt && !a.deferredAt) out.push({ id: p.number + '-' + i + '-' + a.at, number: p.number, pr_url: p.pr_url, pr_status: p.status, branch: p.branch || null, question: (p.needs || [])[i] || '', answer: a.text, at: iso(a.at) }); });
        return out;
    }
    /** 세션의 답 처리 결과(done 의 answer_ids · deferred_answer_ids — 「번호-줄」). [연계] ← nariya_autorun.done */
    function answersResult(handled, deferred) {
        const mark = (ids, key) => { for (const id of ids || []) { const m = /^(\d+)-(\d+)-(\d+)$/.exec(String(id)); const p = m && find(Number(m[1])); const a = p && p.answers && p.answers[Number(m[2])]; if (a && String(a.at) === m[3]) a[key] = now(); } };   // 그 판(시각)의 답일 때만
        mark(handled, 'handledAt'); mark(deferred, 'deferredAt'); save();
    }
    /**
     * 머지·닫힌 PR 카드를 목록에서 치운다(앱 [확인] — 관리자만). 아직 열린 PR 은 치우지 않는다(사람이 할 일이 남았을 수 있다).
     * @param {number} n @returns {{ok:boolean, status?:number, why?:string}} [연계] ← routes/legal.js POST /api/legal/autorun/prs/:n/dismiss
     */
    function dismiss(n) {
        const p = find(n);
        if (!p) return { ok: false, status: 404, why: '자동 반영이 맡은 PR 이 아님' };
        if (p.status !== 'merged' && p.status !== 'closed') return { ok: false, status: 409, why: '아직 머지되지 않은 PR 은 치울 수 없습니다' };
        p.dismissedAt = now(); save();
        return { ok: true };
    }
    /** 결정 필요 답 담당을 넣는다. @param {Function|null} fn */
    function setAnswerHook(fn) { answerHook = typeof fn === 'function' ? fn : null; }
    /** 충돌 처리 담당을 넣는다(운영 forDefault). @param {Function|null} fn */
    function setConflictHook(fn) { conflictHook = typeof fn === 'function' ? fn : null; }
    return { track, evaluate, mergeNow, refresh, list, start, tick, conflicts, conflictResult, setConflictHook, answer, answers, answersResult, setAnswerHook, dismiss, _state: () => load() };
}

let def = null;
/** 운영 기본 인스턴스. [연계] ← nariya_autorun · routes/legal.js · server.js */
function forDefault() {
    return def || (def = createMerger({
        onConflict: (n) => require('./nariya_autorun').requestRun('conflict', { ids: [String(n)] }),
        onAnswer: (id) => require('./nariya_autorun').requestRun('answer', { ids: [String(id)] }),
    }));
}

module.exports = {
    createMerger, forDefault, judge, outsideAuto, REQUIRED_CHECK, PR_URL_RE, AUTO_ALLOW,
    track: (d, o) => forDefault().track(d, o),
    mergeNow: (n, by) => forDefault().mergeNow(n, by),
    refresh: () => forDefault().refresh(),
    list: () => forDefault().list(),
    conflicts: () => forDefault().conflicts(),
    answer: (n, i, t, by) => forDefault().answer(n, i, t, by),
    answers: () => forDefault().answers(),
    dismiss: (n) => forDefault().dismiss(n),
    start: () => forDefault().start(),
};
