'use strict';
/**
 * ============================================================================
 * 파일명: local_server/services/ai_compare_trial.js
 * 역할  : 「AI 비교 시험」 — 같은 글(실수한 글 전체 + 유형별 표본)을 클로드·업스테이지의 여러 모델·노력 설정으로 똑같이 돌려,
 *         운영과 같은 검사로 채점하고 설정별 결과를 나란히 보인다(관리자 AI 탭 버튼으로 시작·멈춤).
 *         ② 참고사항 해석(interpret) · ⑥ 해상 기상 요약(seasummary). **설정·카드·특보현황에는 아무것도 반영하지 않는다.**
 * 사용자 확정(2026-11-23):
 *   「실수한 부분(내용 전체)과 실수하지 않은 부분(유형별 표본)을 업스테이지와 클로드 키로 테스트할 수 있는 방법이 있니 ?」
 *   「클로드는 하이쿠 - low, midium, 소넷 - low, midium으로 테스트할 수 있도록 하고
 *    업스테이지도 mini low, midium, high, pro low, midium, high로 테스트해서 각 도출된 결과를 보고 어떤 모델이 적절한지 판단해보자.」
 * 채점:
 *   ② = 원문에서 사람이 정한 정답(analysis/bulletin_survey/ai_compare_cases.json 의 need·deny·noAuto)과
 *       운영의 사건 검사(bulletin_ai_live.checkEvent)로 본다 — 클로드 답을 정답으로 두지 않는다.
 *   ⑥ = 운영과 같은 원문 대조(regional_sea_summary.check). 통과 = 운영이라면 그 답을 카드에 실었을 것.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : analysis/bulletin_survey/ai_compare_cases.json(시험 글 — 만든 과정은 README ㉒) · services/llm_chain.callDirect(그 키·모델·노력 하나만 — 다음 AI 로 넘기지 않는다) ·
 *                   services/bulletin_ai_live(지시문·사건 검사) · services/bulletin_ai_trial(해역 펼치기) · services/regional_sea_summary(지시문·원문 대조)
 *  - 저장          : data/ai_compare_trial.json — 진행·결과(서버가 다시 뜨면 멈춘 것으로 본다)
 *  - 나를 쓰는 곳  : routes/bulletin_watch.js(GET/POST /api/admin/bulletin-ai/compare…) · 검사 scripts/test_ai_compare_trial.js
 * [로드 순서] 없음(서버 모듈)
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');

const CASES_FILE = path.join(__dirname, '..', 'analysis', 'bulletin_survey', 'ai_compare_cases.json');
const STATE_FILE = path.join(__dirname, '..', 'data', 'ai_compare_trial.json');
const TEXT_MAX = 3000;   // 보고서에 남길 답 글자 수(설정 10 × 글 30 — 파일이 수 MB 로 커지지 않게)
// 사용자가 정한 설정 10가지(2026-11-23). 클로드는 「클로드 키1」로 부른다(관리자 ⑥ 칸의 클로드 키1 과 같은 키).
const VARIANTS = [
    { key: 'haiku-low', id: 'claude1', model: 'claude-haiku-5-5', effort: 'low', label: '클로드 하이쿠 · low' },
    { key: 'haiku-medium', id: 'claude1', model: 'claude-haiku-5-5', effort: 'medium', label: '클로드 하이쿠 · medium' },
    { key: 'sonnet-low', id: 'claude1', model: 'claude-sonnet-5-5', effort: 'low', label: '클로드 소넷 · low' },
    { key: 'sonnet-medium', id: 'claude1', model: 'claude-sonnet-5-5', effort: 'medium', label: '클로드 소넷 · medium' },
    { key: 'mini-low', id: 'upstage', model: 'solar-mini4', effort: 'low', label: '업스테이지 mini · low' },
    { key: 'mini-medium', id: 'upstage', model: 'solar-mini4', effort: 'medium', label: '업스테이지 mini · medium' },
    { key: 'mini-high', id: 'upstage', model: 'solar-mini4', effort: 'high', label: '업스테이지 mini · high' },
    { key: 'pro-low', id: 'upstage', model: 'solar-pro4', effort: 'low', label: '업스테이지 pro · low' },
    { key: 'pro-medium', id: 'upstage', model: 'solar-pro4', effort: 'medium', label: '업스테이지 pro · medium' },
    { key: 'pro-high', id: 'upstage', model: 'solar-pro4', effort: 'high', label: '업스테이지 pro · high' },
];
const FEATURES = { interpret: '② 참고사항 해석', seasummary: '⑥ 해상 기상 요약' };

const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, '');

/**
 * 답 글에서 JSON 을 꺼낸다(울타리·뒤 설명 — 운영과 같은 bulletin_ai.looseJson).
 * @returns {any|undefined}
 */
function parse(text) { try { return require('./bulletin_ai').looseJson(text); } catch (_) { return undefined; } }

/**
 * ② 한 건 채점 — 운영과 같은 지시문의 답을 운영 사건 검사(checkEvent)에 넣고, 원문에서 정한 정답과 맞춘다.
 *   맞음 = 정답 사건이 모두 있고(종류 · 펼친 해역이 정답 해역을 다 품음 · 시간_후에 정답 낱말이 다 있음 · 검사 통과),
 *          있으면 틀린 것(deny 해역을 덮는 후보 · noAuto 글의 후보)이 없고, 검사에 걸린 사건(확인필요)이 없다.
 *   정답 해역이 빈 사건(「위 구역」·「특정관리해역」처럼 규칙이 못 펼치는 표현)은 종류·시각만 보고, 그 종류의 확인필요는 허물로 치지 않는다.
 * 예: gradeInterpret(case, '{"사건":[{"종류":"안내","해역표현":"남해서부서쪽먼바다",…}]}') → { verdict:'맞음', reasons:[] }
 * @param {object} c ai_compare_cases.json 의 interpret 한 건 @param {string} text AI 답 @returns {{verdict:'맞음'|'틀림'|'실패', reasons:string[], events?:Array}}
 * [연계] ← runVariant / → bulletin_ai_live.checkEvent·itemOf·bodyUnits · bulletin_ai_trial.namedParents
 */
function gradeInterpret(c, text) {
    const live = require('./bulletin_ai_live'), T = require('./bulletin_ai_trial');
    const p = parse(text);
    if (!p || !Array.isArray(p.사건)) return { verdict: '실패', reasons: ['답에서 「사건」 목록이 든 JSON 을 못 꺼냈다'] };
    const b = c.bulletin, item = live.itemOf(b);
    const bodyZones = [...new Set(T.namedParents(item.본문 + '\n' + item.참고사항, item.office))];
    const events = p.사건.map((e) => Object.assign({ 종류: e && e.종류, 해역표현: e && e.해역표현, 시간_후: e && e.시간_후, 근거문장: e && e.근거문장 }, live.checkEvent(e, item, bodyZones, live.bodyUnits(b))));
    const reasons = [];
    const timeOk = (e, t) => !t || String(t).split(/\s+/).every((w) => norm(e.시간_후).includes(norm(w)));
    const looseKinds = new Set(c.need.filter((n) => !n.zones.length).map((n) => n.종류));
    // 정답표(ai_compare_cases.json)는 그때 이름이다 — 구역 개편(제주 2026-11-26 · 서해중부·남해동부 2026-11-28) 뒤 이름으로 바꿔 견준다
    //   (없으면: 「서해중부먼바다」 답이 새 구역 4개로 펼쳐져 정답 「서해중부안쪽·바깥먼바다」와 안 맞아 맞는 답이 「틀림」이 된다 — 2026-11-28 verify_all 실측).
    const ZS = require('../config/zone_split');
    for (const n0 of c.need) {
        const n = Object.assign({}, n0, { zones: ZS.splitNames(n0.zones) });
        const hit = events.filter((e) => e.종류 === n.종류 && timeOk(e, n.time) && (n.zones.length ? e.판정 !== '확인필요' : true));
        const got = new Set(hit.flatMap((e) => e.zones || []));
        if (!hit.length) reasons.push(`빠짐: ${n.종류}${n.zones.length ? ' ' + n.zones.join('·') : ''}${n.time ? ' (시각 「' + n.time + '」)' : ''}`);
        else if (n.zones.some((z) => !got.has(z))) reasons.push(`해역 모자람: ${n.종류} — 없는 해역 ${n.zones.filter((z) => !got.has(z)).join('·')}`);
    }
    for (const e of events) {
        if (e.판정 === '후보' && ZS.splitNames(c.deny || []).some((z) => (e.zones || []).includes(z))) reasons.push(`넓혀 적음: ${e.종류} 「${e.해역표현}」 → ${(e.zones || []).join('·')}`);
        if (c.noAuto && e.판정 === '후보') reasons.push(`없는 사건을 자동 반영 후보로: ${e.종류} 「${e.해역표현}」`);
        if (e.판정 === '확인필요' && !looseKinds.has(e.종류)) reasons.push(`검사에 걸림: ${e.종류} 「${e.해역표현 || ''}」 — ${e.까닭}`);
    }
    return { verdict: reasons.length ? '틀림' : '맞음', reasons, events: events.map((e) => ({ 종류: e.종류, 해역표현: e.해역표현, 시간_후: e.시간_후 || null, 판정: e.판정, zones: e.zones || null })) };
}

/**
 * ⑥ 한 편 채점 — 운영과 같은 원문 대조(check). 통과면 카드에 실릴 모양(trim 뒤 + 서버가 붙이는 「바람·물결」)도 돌려준다.
 * @returns {{verdict:'통과'|'걸림'|'실패', reasons:string[], shown?:object}}
 * [연계] ← runVariant / → regional_sea_summary.check·trim·normalize·calmNote
 */
function gradeSea(c, text) {
    const S = require('./regional_sea_summary');
    const p = parse(text);
    if (p === undefined) return { verdict: '실패', reasons: ['답에서 JSON 을 못 꺼냈다'] };
    const items = S.extractSeaItems(c.raw);
    const why = S.check(p, items, c.raw);
    if (why) return { verdict: '걸림', reasons: [why] };
    const t = S.trim(S.normalize(p), items).p, calm = S.calmNote(items.reduce((a, i) => a.concat(i.lines), []));
    return { verdict: '통과', reasons: [], shown: { zones: t.zones, notes: calm ? t.notes.concat(calm) : t.notes } };
}

/** 그 기능·그 글의 지시문(운영과 같은 것). [연계] ← runVariant */
function promptFor(feature, c) {
    if (feature === 'interpret') return require('./bulletin_ai_live').promptOf(c.bulletin, [c.bulletin].concat(c.context || []));
    const S = require('./regional_sea_summary');
    return S.PROMPT(S.extractSeaItems(c.raw).reduce((a, i) => a.concat(i.lines), []).join('\n'));
}

/**
 * 시험 하나(상태·시작·멈춤). 설정마다 따로 돌고(한 설정 안에서는 글을 하나씩 차례로), 결과는 매 건 파일에 남긴다.
 * @param {{call?:function, cases?:object, file?:string, now?:function}} [o] call(id, args, pick) = llm_chain.callDirect 대신(검사용)
 * [연계] ← module.exports(실제) · test_ai_compare_trial
 */
function createCompare(o = {}) {
    const call = o.call || ((id, args, pick) => require('./llm_chain').callDirect(id, args, pick));
    const file = o.file || STATE_FILE, now = o.now || (() => Date.now());
    let st = null, stopFlag = false, running = null;
    const cases = () => o.cases || JSON.parse(fs.readFileSync(CASES_FILE, 'utf8'));
    const load = () => {
        if (st) return st;
        try { st = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { st = { results: {} }; }
        if (st.running) { st.running = false; st.stopped = '서버가 다시 떠서 멈췄다'; }   // 돌던 중 서버가 내려갔으면 이어 돌리지 않는다(운영 키 — 버튼으로 다시)
        return st;
    };
    const save = () => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(st)); fs.renameSync(file + '.tmp', file); };

    async function runVariant(v, features, all) {
        for (const f of features) for (const c of all[f]) {
            if (stopFlag) return;
            const t0 = now();
            let r;
            try { r = await call(v.id, { contents: promptFor(f, c), config: { responseMimeType: 'application/json' } }, { model: v.model, effort: v.effort }); }
            catch (e) { console.warn('[ai_compare_trial] 호출 실패(결과에 「실패」로 남김):', v.key, f, c.id, e && e.message); r = { success: false, error: String((e && e.message) || e) }; }
            const ms = now() - t0, text = r && r.success && r.response ? String(r.response.text || '') : '';
            const g = r && r.success ? (f === 'interpret' ? gradeInterpret(c, text) : gradeSea(c, text)) : { verdict: '실패', reasons: ['호출 실패: ' + String((r && r.error) || '응답 없음').slice(0, 200)] };
            st.results[v.key] = st.results[v.key] || {};
            st.results[v.key][f] = st.results[v.key][f] || {};
            st.results[v.key][f][c.id] = Object.assign({ ms, text: text.slice(0, TEXT_MAX) }, g);
            st.done = (st.done || 0) + 1;
            save();
        }
    }

    /**
     * 시작 — features = ['interpret','seasummary'] 중. 이미 도는 중이면 그대로 둔다.
     * @returns {object} status()
     */
    function start(features) {
        load();
        if (running) return status();
        const fs2 = (Array.isArray(features) && features.length ? features : Object.keys(FEATURES)).filter((f) => FEATURES[f]);
        const all = cases();
        stopFlag = false;
        st = { running: true, startedAt: new Date(now()).toISOString(), features: fs2, total: VARIANTS.length * fs2.reduce((n, f) => n + all[f].length, 0), done: 0, results: {} };
        save();
        running = Promise.all(VARIANTS.map((v) => runVariant(v, fs2, all).catch((e) => console.warn('[AI 비교 시험] 설정 하나가 멈춤:', v.key, e && e.message))))
            .then(() => { st.running = false; st.finishedAt = new Date(now()).toISOString(); if (stopFlag) st.stopped = '관리자가 멈춤'; save(); running = null; });
        return status();
    }
    function stop() { load(); if (running) stopFlag = true; return status(); }

    /**
     * 진행과 설정별 요약(건수·평균 시간). 답 글은 넣지 않는다(보고서에만).
     * 예: { running:false, done:300, total:300, features:[…], rows:[{ key, label, interpret:{ok:17,bad:2,fail:1,n:20,avgMs:4200}, seasummary:{…} }] }
     */
    function status() {
        load();
        const all = (() => { try { return cases(); } catch (_) { return { interpret: [], seasummary: [] }; } })();
        const rows = VARIANTS.map((v) => {
            const row = { key: v.key, label: v.label };
            for (const f of Object.keys(FEATURES)) {
                const ent = Object.entries(((st.results || {})[v.key] || {})[f] || {}), rs = ent.map((x) => x[1]);
                if (!rs.length) continue;
                const okWord = f === 'interpret' ? '맞음' : '통과';
                const groupOf = (id) => ((all[f] || []).find((c) => c.id === id) || {}).group;
                row[f] = { n: rs.length, of: (all[f] || []).length, ok: rs.filter((r) => r.verdict === okWord).length, bad: rs.filter((r) => r.verdict !== okWord && r.verdict !== '실패').length,
                    fail: rs.filter((r) => r.verdict === '실패').length, avgMs: Math.round(rs.reduce((s, r) => s + r.ms, 0) / rs.length),
                    mistakeOk: ent.filter(([id, r]) => r.verdict === okWord && groupOf(id) === '실수').length, mistakeN: (all[f] || []).filter((c) => c.group === '실수').length };
            }
            return row;
        });
        return { running: !!st.running, startedAt: st.startedAt || null, finishedAt: st.finishedAt || null, stopped: st.stopped || null, done: st.done || 0, total: st.total || 0,
            features: st.features || [], variants: VARIANTS.map((v) => ({ key: v.key, label: v.label })), cases: { interpret: (all.interpret || []).length, seasummary: (all.seasummary || []).length }, rows };
    }
    /** 보고서용 전부(답 글 포함). */
    const results = () => { load(); return st; };
    return { start, stop, status, results, runVariant };
}

/**
 * 보고서(마크다운) — 설정별 요약 표 → 글마다 설정별 판정·까닭·답(앞 3,000자).
 * [연계] ← GET /api/admin/bulletin-ai/compare/report.md
 */
function reportMarkdown(st, sts, all) {
    const L = ['# AI 비교 시험 결과', '', `시작 ${st.startedAt || '-'} · 끝 ${st.finishedAt || (st.running ? '도는 중' : '-')}${st.stopped ? ' · ' + st.stopped : ''} · 진행 ${sts.done}/${sts.total}`, '',
        '같은 글을 설정마다 한 번씩 부르고 운영과 같은 검사로 채점했다. ②는 원문에서 정한 정답과, ⑥은 원문 대조 검사(통과 = 운영이라면 카드에 실렸을 답)로 본다. 클로드는 「클로드 키1」.', ''];
    for (const f of sts.features) {
        L.push(`## ${FEATURES[f]} — 설정별 요약`, '', '| 설정 | ' + (f === 'interpret' ? '맞음' : '통과') + ' | 틀림/걸림 | 실패 | 실수했던 글 중 ' + (f === 'interpret' ? '맞음' : '통과') + ' | 평균 시간 |', '|---|---|---|---|---|---|');
        for (const r of sts.rows) { const x = r[f]; if (x) L.push(`| ${r.label} | ${x.ok}/${x.n} | ${x.bad} | ${x.fail} | ${x.mistakeOk}/${x.mistakeN} | ${(x.avgMs / 1000).toFixed(1)}초 |`); }
        L.push('');
    }
    for (const f of sts.features) {
        L.push(`## ${FEATURES[f]} — 글마다`, '');
        for (const c of all[f] || []) {
            L.push(`### [${c.group}] ${c.id} — ${c.what}`, '');
            if (f === 'interpret') L.push('정답: ' + (c.need.length ? c.need.map((n) => `${n.종류} ${n.zones.join('·') || '(해역은 안 봄)'}${n.time ? ' 「' + n.time + '」' : ''}`).join(' / ') : '자동 반영 후보 없음') + (c.deny && c.deny.length ? ' · 덮으면 틀림: ' + c.deny.join('·') : ''), '');
            for (const v of VARIANTS) {
                const r = (((st.results || {})[v.key] || {})[f] || {})[c.id];
                if (!r) continue;
                L.push(`- **${v.label}** — ${r.verdict} · ${(r.ms / 1000).toFixed(1)}초${r.reasons.length ? ' · ' + r.reasons.join(' / ') : ''}`);
                if (r.text) L.push('  ```', '  ' + r.text.replace(/\n/g, '\n  '), '  ```');
            }
            L.push('');
        }
    }
    return L.join('\n');
}

let real = null;
const getReal = () => (real = real || createCompare());
module.exports = {
    start: (f) => getReal().start(f), stop: () => getReal().stop(), status: () => getReal().status(),
    report: () => { const r = getReal(); let all; try { all = JSON.parse(fs.readFileSync(CASES_FILE, 'utf8')); } catch (_) { all = {}; } return reportMarkdown(r.results(), r.status(), all); },
    createCompare, gradeInterpret, gradeSea, promptFor, reportMarkdown, VARIANTS, FEATURES,
};
