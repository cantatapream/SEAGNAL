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
 * [저장] data/station_briefing_autofix.json(볼륨) — {v:1, starts:[{export_id, at}] 최근 20, runs:[…] 최근 30}
 * [로드 순서] 번들 없음(서버).
 * ============================================================================
 */
'use strict';
const fs = require('fs'), path = require('path');

const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'station_briefing_autofix.json');
const EXPORT_RE = /^E\d{8}-\d{6}(?:-\d{1,3})?$/;          // station_briefing_errlog.exportId 꼴
const GROUP_RE = /^G\d{2,3}$/;
const OUTCOMES = ['pr', 'nothing', 'skipped', 'failed'];   // PR 냄 · 오류 없음/고칠 유형 없음 · 열린 자동 PR 이 있어 건너뜀 · 세션 실패
const KEEP_STARTS = 20, KEEP_RUNS = 30;
const UNSAFE_RE = /[\u0000-\u0009\u000b-\u001f\u007f‎‏‪-‮⁦-⁩]/g;   // 제어문자(줄바꿈 빼고)·방향 바꿈 문자
const PROD_APP = 'seagnal-server';

/** ms → KST ISO. @param {number} ms @returns {string|null} */
function iso(ms) { return Number.isFinite(ms) ? new Date(ms + 9 * 3600000).toISOString().slice(0, 19) + '+09:00' : null; }
/** 글 정리 — 제어·방향 문자 빼고 자른다. @param {*} t @param {number} n @returns {string} */
function clean(t, n) { return typeof t === 'string' ? t.replace(UNSAFE_RE, '').trim().slice(0, n) : ''; }
/** 문자열 배열 정리. @returns {string[]} */
function cleanList(a, max, n, re) { return Array.isArray(a) ? a.filter((x) => typeof x === 'string' && (!re || re.test(x))).map((x) => clean(x, n)).filter(Boolean).slice(0, max) : []; }

/**
 * 세션 결과 보고 본문 검사. 예: validateDone({export_id:'E20261120-054812', outcome:'pr', pr_url:'https://github.com/cantatapream/SEAGNAL/pull/9'}) → {ok:true, d:{…}}
 * @param {object} b @returns {{ok:boolean, error?:string, d?:object}} [연계] ← done
 */
function validateDone(b) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return { ok: false, error: '본문은 JSON 객체' };
    if (!OUTCOMES.includes(b.outcome)) return { ok: false, error: 'outcome 은 ' + OUTCOMES.join('|') };
    const exportId = typeof b.export_id === 'string' && EXPORT_RE.test(b.export_id) ? b.export_id : null;
    if (b.outcome === 'pr' && !exportId) return { ok: false, error: "outcome 'pr' 이면 export_id(E…) 필요" };
    const pr = typeof b.pr_url === 'string' && /^https:\/\/github\.com\/cantatapream\/SEAGNAL\/pull\/\d+$/.test(b.pr_url) ? b.pr_url : null;
    if (b.outcome === 'pr' && !pr) return { ok: false, error: "outcome 'pr' 이면 이 저장소 PR 주소(pr_url) 필요" };
    const needs = cleanList(b.needs_decision, 20, 300);
    const opts = Array.isArray(b.needs_options) ? b.needs_options.slice(0, needs.length).map((a) => cleanList(a, 4, 80)) : [];
    return { ok: true, d: { exportId, outcome: b.outcome, pr, fixed: cleanList(b.fixed, 50, 8, GROUP_RE), left: cleanList(b.left, 50, 8, GROUP_RE),
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
        state = { v: 1, starts: [], runs: [] };
        try {
            if (fs.existsSync(file)) {
                const o = JSON.parse(fs.readFileSync(file, 'utf8'));
                if (o && Array.isArray(o.starts)) state.starts = o.starts.filter((x) => x && EXPORT_RE.test(x.export_id) && Number.isFinite(x.at)).slice(-KEEP_STARTS);
                if (o && Array.isArray(o.runs)) state.runs = o.runs.filter((x) => x && OUTCOMES.includes(x.outcome) && Number.isFinite(x.at)).slice(-KEEP_RUNS);
            }
        } catch (e) {
            const moved = file + '.corrupt-' + now();
            try { fs.renameSync(file, moved); } catch (e2) { console.error('[station_briefing_autofix] 깨진 기록 파일을 옮기지 못함:', e2 && e2.message); }
            console.error('[station_briefing_autofix] 기록 파일이 깨져 ' + path.basename(moved) + ' 로 옮기고 빈 기록으로 시작:', e && e.message);
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
        const run = { at: t, export_id: d.exportId, outcome: d.outcome, pr_url: d.pr, fixed: d.fixed, left: d.left, needs: d.needs, summary: d.summary, errors: d.errors, track: null };
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
        const where = ' — 앱 → 관리자 → AI → 「AI 브리핑」 탭 「오류 자동 처리」 칸에서 확인해 주세요.';
        const msg = d.outcome === 'failed' ? ['AI 브리핑 오류 자동 처리 — 세션 실패', (d.summary || '까닭 없음').slice(0, 200) + where, 'briefing_autofix_failed']
            : tracked && tracked.how === 'secrets' ? ['AI 브리핑 오류 자동 처리 — 자동 머지 불가 · 확인 필요', '서버에 GitHub 열쇠가 없어 자동 머지도 머지 버튼도 쓸 수 없습니다. GitHub 에서 PR 을 직접 머지하거나 서버 열쇠를 확인해 주세요' + where, 'briefing_autofix_secrets'] : null;
        if (msg && env.FLY_APP_NAME === PROD_APP) {
            try { await push(msg[0], msg[1], { type: msg[2] }); }
            catch (e) { console.error('[station_briefing_autofix] 푸시 오류:', e && e.message); }
        }
        return { ok: true, tracked, owner: d.outcome === 'pr' ? !!start && !dupPr : undefined };
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
        return { lastRun: runs[0] || null, runs, lastStart: lastStart ? { export_id: lastStart.export_id, at: iso(lastStart.at) } : null, ...prs, prError, saveError };
    }
    return {
        started, done, status,
        refresh: () => M().refresh(),
        mergeNow: (n, by) => M().mergeNow(n, by),
        dismiss: (n) => M().dismiss(n),
        _state: () => load(),
    };
}

let def = null;
/** 운영 기본 인스턴스. [연계] ← routes/station_briefing.js */
function forDefault() { return def || (def = createAutofix()); }

module.exports = { createAutofix, forDefault, validateDone, EXPORT_RE, OUTCOMES };
