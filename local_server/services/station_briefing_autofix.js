/**
 * ============================================================================
 * 파일명: services/station_briefing_autofix.js
 * 역할  : 연안 안전 브리핑 「누적 오류 자동 처리」 세션의 기록과 PR 머지 연결(설계서 §11.10.59).
 *         (초보자용: 매일 새벽 예약 작업 세션이 처리 안 된 오류를 받아 검사기를 고치고 PR 을 올린 뒤 결과를 여기로 알린다.
 *          여기서 「언제 마지막으로 세션이 검사했나」를 남기고, PR 이면 머지 담당에게 넘긴다 — 조건이 맞으면 자동 머지, 아니면 관리자 푸시 + 앱 머지 버튼.)
 * ----------------------------------------------------------------------------
 * [사용자 확정 — 원문]
 *   「가, 나 진행」(2026-11-20 — 자동화 만들기) · 「세션을 통한 브리핑 오류 수정은 새벽 6시에」 ·
 *   「조건부 머지하되, 조건이 안맞으면 관리자에게 푸시로 앱 내부에서 머지하라고 해야할 것이야. 머지 버튼 위치는 ai 브리핑 탭 내부에 영역을 만들어서 반영했으면 좋겠어.
 *    언제 가장마지막으로 세션 검사를 했는지 기록도 반영필요허며, 머지 이후에는 처리 안된 오류 현황(통합관리자센터)이 갱신되도록 해줘.」
 * [연계]
 *  - 사용하는 파일 : services/nariya_pr_merge.js(forBriefing — 조건부 자동 머지·앱 머지 버튼) · services/admin_push.js(세션 실패 푸시)
 *  - 나를 쓰는 곳  : routes/station_briefing.js(POST /api/station-briefing/automation/error-export → started · …/autofix-done → done ·
 *                    GET /api/admin/station-briefing/autofix → status · POST …/autofix/prs/:n/merge·dismiss) · scripts/test_station_briefing.js
 *  - 화면          : client/js/admin/admin_station_briefing.js 「오류 자동 처리」 칸
 * [저장] data/station_briefing_autofix.json(볼륨) — {v:1, starts:[{export_id, at}] 최근 20, runs:[…] 최근 30, dseq, decisions:[…] 최근 60}
 * [결정 답 · 판정 자동 닫기 — 설계서 §11.10.62, 2026-11-22 사용자]
 *   「배경과 내용을 충분히 설명 … ai 브리핑 탭에 반영 … 맞다, 아니다, 기타 의견을 기록하여 전송 … 다음 절차가 자동으로 진행」 · 답 처리 시점 「다음 새벽 05:48」 ·
 *   「처리한 건은 아래 처리한 건으로 자동으로 목록에서 삭제」 → 세션이 「AI 가 실제로 틀림」·「AI 호출 문제」로 판정한 유형도 자동 닫기(사용자 「네, 자동으로 닫기」) ·
 *   「푸시알림에 있어서도 내가 선택해주어야 할 것이 있다는 내용을 알려줘야해」.
 *   결정(decisions)은 PR 의 자동 머지를 막지 않는다(PR 은 확정된 오판 고침만 담는다 — 막는 것은 needs_decision 「확인 필요」뿐).
 * [로드 순서] 번들 없음(서버).
 * ============================================================================
 */
'use strict';
const fs = require('fs'), path = require('path');

const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'station_briefing_autofix.json');
const EXPORT_RE = /^E\d{8}-\d{6}(?:-\d{1,3})?$/;          // station_briefing_errlog.exportId 꼴
const GROUP_RE = /^G\d{2,3}$/;
const OUTCOMES = ['pr', 'nothing', 'skipped', 'failed'];   // PR 냄 · 오류 없음/고칠 유형 없음 · 열린 자동 PR 이 있어 건너뜀 · 세션 실패
const KEEP_STARTS = 20, KEEP_RUNS = 30, KEEP_DECISIONS = 60;
const LEFT_KINDS = ['ai', 'external'];        // 세션이 그대로 둔 유형의 판정 — AI 가 실제로 어김 · 코드 밖(호출 시간초과·응답 깨짐 등)
const CHOICES = ['allow', 'block', 'other'];   // 결정 답 — 맞다(허용) · 아니다(막기) · 기타 의견
const DECISION_ID_RE = /^d\d{1,6}$/;
const UNSAFE_RE = /[\u0000-\u0009\u000b-\u001f\u007f‎‏‪-‮⁦-⁩]/g;   // 제어문자(줄바꿈 빼고)·방향 바꿈 문자
const PROD_APP = 'seagnal-server';

/** ms → KST ISO. @param {number} ms @returns {string|null} */
function iso(ms) { return Number.isFinite(ms) ? new Date(ms + 9 * 3600000).toISOString().slice(0, 19) + '+09:00' : null; }
/** 글 정리 — 제어·방향 문자 빼고 자른다. @param {*} t @param {number} n @returns {string} */
function clean(t, n) { return typeof t === 'string' ? t.replace(UNSAFE_RE, '').trim().slice(0, n) : ''; }
/** 문자열 배열 정리. @returns {string[]} */
function cleanList(a, max, n, re) { return Array.isArray(a) ? a.filter((x) => typeof x === 'string' && (!re || re.test(x))).map((x) => clean(x, n)).filter(Boolean).slice(0, max) : []; }

/**
 * 결정 하나를 다듬는다(사장님이 앱에서 읽는 글 — 배경·실제 문장·허용하면·막으면·추천과 까닭). 제목이 없으면 버린다.
 * 예: cleanDecision({group:'G04', title:'붙여 쓴 「몽돌해변」을 통과시킬지', recommend:'block', …}) → {group:'G04', title, background, example, allow, block, recommend:'block', why}
 * @param {*} x @returns {object|null} [연계] ← validateDone·addDecisions
 */
function cleanDecision(x) {
    if (!x || typeof x !== 'object') return null;
    const title = clean(x.title, 200); if (!title) return null;
    return { group: typeof x.group === 'string' && GROUP_RE.test(x.group) ? x.group : null, title, background: clean(x.background, 1500), example: clean(x.example, 1000),
        allow: clean(x.allow, 600), block: clean(x.block, 600), recommend: ['allow', 'block'].includes(x.recommend) ? x.recommend : null, why: clean(x.why, 600) };
}
/**
 * 세션 결과 보고 본문 검사. 예: validateDone({export_id:'E20261120-054812', outcome:'pr', pr_url:'https://github.com/cantatapream/SEAGNAL/pull/9'}) → {ok:true, d:{…}}
 * @param {object} b @returns {{ok:boolean, error?:string, d?:object}} [연계] ← done
 */
function validateDone(b) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return { ok: false, error: '본문은 JSON 객체' };
    if (!OUTCOMES.includes(b.outcome)) return { ok: false, error: 'outcome 은 ' + OUTCOMES.join('|') };
    const exportId = typeof b.export_id === 'string' && EXPORT_RE.test(b.export_id) ? b.export_id : null;
    const answerIds = cleanList(b.answer_ids, 50, 8, DECISION_ID_RE), deferredAnswerIds = cleanList(b.deferred_answer_ids, 50, 8, DECISION_ID_RE);
    // 세션이 받아 간 답의 시각(autofix-answers 의 answer.at) — 그 사이 사장님이 답을 바꿨으면 「반영함」으로 찍지 않는다(독립 검토 중3)
    const answerAts = {};
    if (b.answer_ats && typeof b.answer_ats === 'object' && !Array.isArray(b.answer_ats)) for (const [k, v] of Object.entries(b.answer_ats).slice(0, 50)) if (DECISION_ID_RE.test(k) && typeof v === 'string') answerAts[k] = v.slice(0, 40);
    // 결정 답만 처리한 PR(그날 처리 안 된 오류가 없었음)은 내보내기 번호가 없을 수 있다 — 그때는 자동 머지 후보가 아니다(owner 는 내보내기 기록으로만 정해진다)
    if (b.outcome === 'pr' && !exportId && !answerIds.length) return { ok: false, error: "outcome 'pr' 이면 export_id(E…) 필요(결정 답만 처리한 PR 이면 answer_ids)" };
    const pr = typeof b.pr_url === 'string' && /^https:\/\/github\.com\/cantatapream\/SEAGNAL\/pull\/\d+$/.test(b.pr_url) ? b.pr_url : null;
    if (b.outcome === 'pr' && !pr) return { ok: false, error: "outcome 'pr' 이면 이 저장소 PR 주소(pr_url) 필요" };
    const needs = cleanList(b.needs_decision, 20, 300);
    const opts = Array.isArray(b.needs_options) ? b.needs_options.slice(0, needs.length).map((a) => cleanList(a, 4, 80)) : [];
    const kinds = {};
    if (b.left_kinds && typeof b.left_kinds === 'object' && !Array.isArray(b.left_kinds)) for (const [k, v] of Object.entries(b.left_kinds).slice(0, 50)) if (GROUP_RE.test(k) && LEFT_KINDS.includes(v)) kinds[k] = v;
    const decisions = Array.isArray(b.decisions) ? b.decisions.slice(0, 10).map(cleanDecision).filter(Boolean) : [];
    return { ok: true, d: { exportId, outcome: b.outcome, pr, fixed: cleanList(b.fixed, 50, 8, GROUP_RE), left: cleanList(b.left, 50, 8, GROUP_RE), kinds, decisions, answerIds, deferredAnswerIds, answerAts,
        needs, opts, summary: clean(b.summary, 2000), errors: Number.isInteger(b.errors) && b.errors >= 0 && b.errors < 100000 ? b.errors : null } };
}

/**
 * 자동 처리 기록 담당을 만든다. 시험은 파일·시계·머지 담당·푸시·환경 변수를 바꿔 넣는다.
 * @param {object} [o] {file, now, merger, push, env}
 * @returns {{started:Function, done:Function, status:Function, refresh:Function, mergeNow:Function, dismiss:Function}}
 * [연계] ← forDefault · scripts/test_station_briefing.js
 */
function createAutofix({
    file = DEFAULT_FILE,
    now = Date.now,
    merger = null,   // 기본 nariya_pr_merge.forBriefing()(지연 require)
    push = (t, b, d) => require('./admin_push').sendAdminPush(t, b, d),
    env = process.env,
} = {}) {
    let state = null, saveError = null;
    const M = () => merger || require('./nariya_pr_merge').forBriefing();
    function load() {
        if (state) return state;
        state = { v: 1, starts: [], runs: [], dseq: 0, decisions: [] };
        try {
            if (fs.existsSync(file)) {
                const o = JSON.parse(fs.readFileSync(file, 'utf8'));
                if (o && Array.isArray(o.starts)) state.starts = o.starts.filter((x) => x && EXPORT_RE.test(x.export_id) && Number.isFinite(x.at)).slice(-KEEP_STARTS);
                if (o && Array.isArray(o.runs)) state.runs = o.runs.filter((x) => x && OUTCOMES.includes(x.outcome) && Number.isFinite(x.at)).slice(-KEEP_RUNS);
                if (o && Array.isArray(o.decisions)) state.decisions = o.decisions.filter((x) => x && DECISION_ID_RE.test(x.id) && x.title).slice(-KEEP_DECISIONS);
                if (o && Number.isInteger(o.dseq)) state.dseq = o.dseq;
            }
        } catch (e) {
            const moved = file + '.corrupt-' + now();
            try { fs.renameSync(file, moved); } catch (e2) { console.error('[station_briefing_autofix] 깨진 기록 파일을 옮기지 못함:', e2 && e2.message); }
            console.error('[station_briefing_autofix] 기록 파일이 깨져 ' + path.basename(moved) + ' 로 옮기고 빈 기록으로 시작:', e && e.message);
            state.dseq = 100000 + Math.floor(now() / 1000) % 800000;   // 결정 번호를 d1 부터 다시 매기면 열려 있던 화면의 옛 카드 답이 새 결정에 들어간다(독립 검토 하10)
        }
        return state;
    }
    function save() {
        const tmp = file + '.' + process.pid + '.tmp';
        try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(tmp, JSON.stringify(state, null, 1)); fs.renameSync(tmp, file); saveError = null; }
        catch (e) { try { fs.unlinkSync(tmp); } catch (_) { /* 임시 파일이 없으면 그만 */ } saveError = String((e && e.code) || (e && e.message) || e).slice(0, 80); console.error('[station_briefing_autofix] 기록 저장 실패:', e && e.message); }
    }

    /**
     * 세션이 자동화 열쇠로 오류를 내보냈다(=그 내보내기로 일을 시작했다). 자동 머지 조건의 「이 PR 이 그 세션 것인가」(owner·runSince)에 쓴다.
     * @param {string} exportId @returns {void} [연계] ← routes POST automation/error-export
     */
    function started(exportId) {
        if (!EXPORT_RE.test(String(exportId || ''))) return;
        const st = load(); st.starts = st.starts.filter((x) => x.export_id !== exportId).concat([{ export_id: exportId, at: now() }]).slice(-KEEP_STARTS); save();
    }

    const PUSH_WHERE = ' — 앱 → 관리자 → AI → 「AI 브리핑」 탭 「오류 자동 처리」 칸에서 확인해 주세요.';
    /** 운영에서만 관리자 푸시(실패는 콘솔). @returns {Promise<void>} */
    async function notify(title, body, type) {
        if (env.FLY_APP_NAME !== PROD_APP) return;
        try { await push(title, body, { type }); } catch (e) { console.error('[station_briefing_autofix] 푸시 오류:', e && e.message); }
    }
    /**
     * 결정을 더한다(번호 d1, d2 …). 같은 내보내기·같은 제목으로 아직 안 끝난 결정이 있으면 더하지 않는다(같은 세션이 두 번 보내도 한 번).
     * @param {object[]} list - cleanDecision 결과 @param {string|null} exportId @param {number} t @returns {object[]} 새로 더한 것 [연계] ← done·addDecisions
     */
    function pushDecisions(list, exportId, t) {
        const st = load(), out = [];
        for (const x of list) {
            // 같은 질문이 아직 열려 있으면 더하지 않는다 — 내보내기는 날마다 새 번호라 번호로 묶으면 매일 다시 올라오고 푸시도 매일 간다(독립 검토 중2)
            if (st.decisions.some((d) => !d.handledAt && d.title === x.title)) continue;
            const d = { id: 'd' + (++st.dseq), at: t, export_id: exportId, ...x, answer: null, handledAt: null, deferredAt: null, result: null };
            st.decisions.push(d); out.push(d);
        }
        // 상한은 끝난 것부터 버린다(안 끝난 결정이 밀려나지 않게 — 독립 검토 하10)
        while (st.decisions.length > KEEP_DECISIONS) { const i = st.decisions.findIndex((d) => d.handledAt); st.decisions.splice(i >= 0 ? i : 0, 1); }
        return out;
    }
    /** 정하실 것이 새로 생겼다는 푸시(사용자 「푸시알림에 있어서도 내가 선택해주어야 할 것이 있다는 내용을 알려줘야해」). @param {object[]} added @returns {Promise<void>} */
    async function notifyDecisions(added) {
        if (!added.length) return;
        await notify('AI 브리핑 — 정하실 것 ' + added.length + '건', '「' + added[0].title + '」' + (added.length > 1 ? ' 외 ' + (added.length - 1) + '건' : '') + ' — [맞다]·[아니다]·[기타 의견] 중 골라 보내 주세요' + PUSH_WHERE, 'briefing_autofix_decision');
    }
    /**
     * 세션 결과 보고(늘 보낸다 — PR·오류 없음·건너뜀·실패). 기록을 남기고, PR 이면 머지 담당에 넘긴다.
     * 자동 머지 후보(owner)는 그 내보내기를 자동화 경로로 받은 기록이 있고, 같은 내보내기로 아직 PR 을 보고한 적이 없을 때만.
     * 예: done({export_id:'E20261120-054812', outcome:'pr', pr_url:'…/pull/9', fixed:['G01'], left:['G02'], summary:'…'}) → {ok:true, tracked:{mode:'auto', status:'waiting'}}
     * @param {object} body @returns {Promise<object>} [연계] ← routes POST automation/autofix-done
     */
    async function done(body) {
        const v = validateDone(body);
        if (!v.ok) return { ok: false, status: 400, error: v.error };
        const d = v.d, st = load(), t = now();
        const start = d.exportId ? st.starts.find((x) => x.export_id === d.exportId) : null;
        const dupPr = d.outcome === 'pr' && st.runs.some((r) => r.outcome === 'pr' && r.export_id === d.exportId);
        const added = pushDecisions(d.decisions, d.exportId, t);
        const changed = [];
        for (const id of d.answerIds) {
            const x = st.decisions.find((y) => y.id === id); if (!x || !x.answer || x.handledAt && x.result !== 'block') continue;
            // 세션이 받아 간 뒤 사장님이 답을 바꿨으면 반영으로 찍지 않는다 — 다음 세션이 새 답을 다시 받는다. 그 PR 은 자동 머지를 막는다(독립 검토 중3).
            if (d.answerAts[id] !== iso(x.answer.at) || x.result === 'block') { changed.push(x); continue; }
            x.handledAt = t; x.result = d.pr ? 'pr' : 'done'; x.handledPr = d.pr || null;
        }
        const deferred = [];
        for (const id of d.deferredAnswerIds) { const x = st.decisions.find((y) => y.id === id); if (x && x.answer && !x.handledAt) { x.deferredAt = t; deferred.push(x); } }
        if (changed.length) d.needs = d.needs.concat(changed.map((x) => '「' + x.title + '」 답이 세션 처리 중에 바뀌었습니다 — 이 PR 이 새 답과 맞는지 확인이 필요합니다'));
        // 판정 자동 닫기(§11.10.62): 세션이 그대로 둔 유형(left — AI 가 실제로 어김·코드 밖)은 사람 확인 없이 처리 완료. 다만(독립 검토 상1·중4·하8)
        //   ①판정(left_kinds)을 적은 유형만 — 옛 지침 꼴(판정 없이 left 만)은 결정이 걸린 유형도 left 에 넣었으므로 닫지 않는다
        //   ②결정이 걸린 유형·고친 유형(fixed — 머지 때 닫힌다)은 빼고 ③이 세션이 자동화 경로로 받은 내보내기일 때만(start 기록).
        const decided = new Set(st.decisions.filter((x) => !x.handledAt && x.export_id === d.exportId && x.group).map((x) => x.group));
        const close = (d.outcome === 'pr' || d.outcome === 'nothing') && d.exportId && start ? d.left.filter((c) => d.kinds[c] && !decided.has(c) && !d.fixed.includes(c)).map((c) => ({ code: c, kind: d.kinds[c] })) : [];
        const run = { at: t, export_id: d.exportId, outcome: d.outcome, pr_url: d.pr, fixed: d.fixed, left: d.left, kinds: d.kinds, needs: d.needs, summary: d.summary, errors: d.errors, track: null, decisions: added.map((x) => x.id), closed: close.map((x) => x.code) };
        let tracked = null;
        if (d.outcome === 'pr') {
            try {
                tracked = M().track({ pr_url: d.pr, run_id: d.exportId, needs_decision: d.needs, needs_options: d.opts, summary: d.summary }, { owner: !!start && !dupPr, runSince: start ? start.at : NaN });
            } catch (e) { console.error('[station_briefing_autofix] 머지 담당에 넘기기 실패:', e && e.message); tracked = { tracked: false, why: '머지 담당 오류' }; }
            run.track = tracked ? { tracked: !!tracked.tracked, mode: tracked.mode || null, status: tracked.status || null, why: tracked.why || null } : null;
        }
        st.runs = st.runs.concat([run]).slice(-KEEP_RUNS); save();
        // 세션 실패는 조용히 지나가면 안 된다(CLAUDE.md L-291 — 조용한 것이 이상 없는 것처럼 보임). PR·없음·건너뜀은 머지 담당·Claude 앱 알림이 맡는다.
        //   서버에 GitHub 열쇠가 없어 머지 담당이 지켜보지도 못하는 PR(how secrets)도 머지 담당이 푸시를 안 보내므로 여기서 보낸다(독립 검토 (D)).
        const where = PUSH_WHERE;
        const msg = d.outcome === 'failed' ? ['AI 브리핑 오류 자동 처리 — 세션 실패', (d.summary || '까닭 없음').slice(0, 200) + where, 'briefing_autofix_failed']
            : tracked && tracked.how === 'secrets' ? ['AI 브리핑 오류 자동 처리 — 자동 머지 불가 · 확인 필요', '서버에 GitHub 열쇠가 없어 자동 머지도 머지 버튼도 쓸 수 없습니다. GitHub 에서 PR 을 직접 머지하거나 서버 열쇠를 확인해 주세요' + where, 'briefing_autofix_secrets'] : null;
        if (msg) await notify(msg[0], msg[1], msg[2]);
        await notifyDecisions(added);
        // 보류된 답은 사람이 다시 정해야 한다 — 카드를 열어야만 보이면 매일 같은 답을 다시 받아 다시 보류하는 고리가 조용히 돈다(독립 검토 중6)
        if (deferred.length) await notify('AI 브리핑 — 답을 다시 정해 주세요 ' + deferred.length + '건', '「' + deferred[0].title + '」 — 세션이 보낸 답을 그대로 반영하지 못했습니다(까닭은 세션 요약). 답을 고쳐 다시 보내 주세요' + PUSH_WHERE, 'briefing_autofix_decision');
        return { ok: true, tracked, owner: d.outcome === 'pr' ? !!start && !dupPr : undefined, close: close.length ? { exportId: d.exportId, groups: close } : null, decisions: added.map((x) => x.id) };
    }

    /**
     * 화면용 — 마지막 세션 검사(「언제 마지막으로 세션이 검사했나」)·최근 기록·PR 목록(머지 버튼).
     * @returns {object} [연계] ← routes GET /api/admin/station-briefing/autofix → 관리자 「오류 자동 처리」 칸
     */
    function status() {
        const st = load(), runs = st.runs.slice().reverse().slice(0, 10).map((r) => ({ at: iso(r.at), export_id: r.export_id, outcome: r.outcome, pr_url: r.pr_url, fixed: Array.isArray(r.fixed) ? r.fixed : [], left: Array.isArray(r.left) ? r.left : [], needs: Array.isArray(r.needs) ? r.needs : [], summary: r.summary, errors: r.errors, track: r.track }));
        let prs = { prs: [], counts: { needs_human: 0, waiting: 0 }, tokenConfigured: false }, prError = null;
        try { prs = M().list(); } catch (e) { prError = String((e && e.message) || e).slice(0, 80); }
        const lastStart = st.starts.length ? st.starts[st.starts.length - 1] : null;
        return { lastRun: runs[0] || null, runs, lastStart: lastStart ? { export_id: lastStart.export_id, at: iso(lastStart.at) } : null, ...prs, prError, saveError,
            decisions: decisionsView(), openDecisions: st.decisions.filter((x) => !x.handledAt && (!x.answer || x.deferredAt)).length, closeIssue: st.closeIssue ? { at: iso(st.closeIssue.at), text: st.closeIssue.text } : null };
    }
    /** 결정 목록(화면용 — 안 끝난 것 모두 + 끝난 것 최근 5개, 최근 것부터). @returns {object[]} */
    function decisionsView() {
        const st = load(), v = (x) => ({ id: x.id, at: iso(x.at), export_id: x.export_id, group: x.group, title: x.title, background: x.background, example: x.example, allow: x.allow, block: x.block, recommend: x.recommend, why: x.why,
            answer: x.answer ? { choice: x.answer.choice, text: x.answer.text, at: iso(x.answer.at), by: x.answer.by } : null, handledAt: iso(x.handledAt), deferredAt: iso(x.deferredAt), result: x.result || null, handledPr: x.handledPr || null });
        const all = st.decisions.slice().reverse();
        return all.filter((x) => !x.handledAt).concat(all.filter((x) => x.handledAt).slice(0, 5)).map(v);
    }
    /**
     * 결정 답(관리자 앱 — 맞다 allow · 아니다 block · 기타 other + 글). 끝난 결정은 409.
     * 「아니다(막기)」는 고칠 코드가 없어 곧바로 끝낸다 — 그 결정이 걸린 유형을 처리 완료로 닫으라고 close 를 돌려준다(라우터가 누적 오류 기록에 적용).
     * 「맞다」·「기타」는 다음 새벽 05:48 세션이 GET automation/autofix-answers 로 받아 반영한다(사용자 「다음 새벽 05:48」). 끝나기 전에는 답을 바꿀 수 있다.
     * 예: answer('d3', 'block', '', '관리자(앱)') → {ok:true, decision:{…, result:'block'}, close:{exportId:'E…', code:'G04'}}
     * @param {string} id @param {string} choice @param {string} text @param {string} by @returns {object} [연계] ← routes POST /api/admin/station-briefing/autofix/decisions/:id/answer
     */
    function answer(id, choice, text, by) {
        const st = load(), x = st.decisions.find((y) => y.id === String(id || ''));
        if (!x) return { ok: false, status: 404, error: '없는 결정' };
        if (x.handledAt) return { ok: false, status: 409, error: '이미 반영이 끝난 결정입니다' };
        if (!CHOICES.includes(choice)) return { ok: false, status: 400, error: 'choice 는 ' + CHOICES.join('|') };
        const tx = clean(text, 1000);
        if (choice === 'other' && !tx) return { ok: false, status: 400, error: '기타 의견은 글을 적어 주세요' };
        const t = now();
        x.answer = { choice, text: tx, at: t, by: clean(by, 40) || '관리자' }; x.deferredAt = null;
        let close = null;
        if (choice === 'block') { x.handledAt = t; x.result = 'block'; if (x.export_id && x.group) close = { exportId: x.export_id, code: x.group }; }
        save();
        return { ok: true, decision: decisionsView().find((y) => y.id === x.id) || null, close };
    }
    /**
     * 세션이 반영할 답(맞다·기타 — 아직 안 끝난 것). 예: answers() → [{id:'d3', title, background, example, allow, block, answer:{choice:'allow', text:''}}]
     * @returns {object[]} [연계] ← routes GET /api/station-briefing/automation/autofix-answers
     */
    function answers() {
        return load().decisions.filter((x) => x.answer && !x.handledAt).map((x) => ({ id: x.id, export_id: x.export_id, group: x.group, title: x.title, background: x.background, example: x.example, allow: x.allow, block: x.block, answer: { choice: x.answer.choice, text: x.answer.text, at: iso(x.answer.at) } }));
    }
    /**
     * 세션이 같은 질문을 다시 올리지 않게 — 아직 열린 결정(답 없음 포함)과 최근 30일 끝난 결정(답 포함). 예: known() → [{id:'d1', title, status:'open'|'answered'|'block'|'done', answer}]
     * @returns {object[]} [연계] ← routes GET automation/autofix-answers(known)
     */
    function known() {
        const t = now();
        return load().decisions.filter((x) => !x.handledAt || t - x.handledAt < 30 * 86400000).map((x) => ({ id: x.id, title: x.title, group: x.group, export_id: x.export_id,
            status: !x.handledAt ? (x.answer ? 'answered' : 'open') : x.result === 'block' ? 'block' : 'done', answer: x.answer ? { choice: x.answer.choice, text: x.answer.text } : null }));
    }
    /** 자동 닫기·결정 막기가 누적 기록에 적용되지 못한 것(라우터가 알린다 — 조용히 지나가지 않게, 독립 검토 하7). @param {string|null} text @returns {void} */
    function closeIssue(text) { const st = load(); st.closeIssue = text ? { at: now(), text: clean(text, 300) } : null; save(); }
    /**
     * 세션이 결정만 따로 올린다(자동화 열쇠 — 결과 보고와 별개). 예: addDecisions({export_id:'E…', decisions:[{title, …}]}) → {ok:true, added:['d4']}
     * @param {object} b @returns {Promise<object>} [연계] ← routes POST /api/station-briefing/automation/autofix-decisions
     */
    async function addDecisions(b) {
        if (!b || typeof b !== 'object') return { ok: false, status: 400, error: '본문은 JSON 객체' };
        const list = Array.isArray(b.decisions) ? b.decisions.slice(0, 10).map(cleanDecision).filter(Boolean) : [];
        if (!list.length) return { ok: false, status: 400, error: 'decisions(제목 있는 것) 필요' };
        const exportId = typeof b.export_id === 'string' && EXPORT_RE.test(b.export_id) ? b.export_id : null;
        const added = pushDecisions(list, exportId, now()); save();
        await notifyDecisions(added);
        return { ok: true, added: added.map((x) => x.id) };
    }
    /**
     * 「처리 안 된 오류」 목록에 붙일 꼬리표 재료(상태 응답에 싣는다 — 가볍게): 고침 PR 이 머지를 기다리는 유형 · 결정을 기다리는 유형 · 마지막 세션 검사.
     * 예: brief() → {lastRun:{at, export_id, outcome}, pendingFix:[{export_id:'E…', codes:['G04'], pr:1559, status:'waiting'}], decisions:[{export_id, group, answered:false}]}
     * @returns {object} [연계] ← routes GET /api/admin/station-briefing/status → 화면 drawOpenErrors
     */
    function brief() {
        const st = load(); let prs = [];
        try { prs = M().list().prs || []; } catch (e) { console.warn('[station_briefing_autofix] PR 목록 읽기 실패(꼬리표 없이):', e && e.message); }
        const num = (u) => { const m = /\/pull\/(\d+)$/.exec(String(u || '')); return m ? Number(m[1]) : null; };
        const pendingFix = st.runs.filter((r) => r.outcome === 'pr' && r.export_id && (r.fixed || []).length).map((r) => { const n = num(r.pr_url), p = prs.find((x) => x.number === n); return { export_id: r.export_id, codes: r.fixed, pr: n, status: p ? p.status : null }; })
            .filter((x) => x.status !== 'closed');
        const last = st.runs.length ? st.runs[st.runs.length - 1] : null;
        return { lastRun: last ? { at: iso(last.at), export_id: last.export_id, outcome: last.outcome } : null, pendingFix,
            decisions: st.decisions.filter((x) => !x.handledAt && x.export_id && x.group).map((x) => ({ export_id: x.export_id, group: x.group, answered: !!x.answer })) };
    }
    return {
        started, done, status, answer, answers, known, closeIssue, addDecisions, brief,
        refresh: () => M().refresh(),
        mergeNow: (n, by) => M().mergeNow(n, by),
        dismiss: (n) => M().dismiss(n),
        _state: () => load(),
    };
}

let def = null;
/** 운영 기본 인스턴스. [연계] ← routes/station_briefing.js */
function forDefault() { return def || (def = createAutofix()); }

module.exports = { createAutofix, forDefault, validateDone, cleanDecision, EXPORT_RE, OUTCOMES, LEFT_KINDS, CHOICES };
