'use strict';
/**
 * ============================================================================
 * 파일명: local_server/services/bulletin_ai.js
 * 역할  : 「AI 특보 분석」 — 기능마다(① read = 특보 통보문 읽기, ② interpret = 참고사항 해석, ③ forecast = 해상 기상 전망 색칠) AI 우선순위를 두고
 *         그 순서대로 시도한다(1순위가 실패하면 2순위 …). 칸마다 모델·노력, ChatGPT 칸은 실행 위치(Fly 서버|VM)까지 고른다.
 * 사용자 확정(2026-11-15):
 *   「ai 탭에서 ai 브리핑오른쪽에 특보분석 탭을만들고 기상청 통보문도 읽는 모델을 선택, gpt(vm 또는 fly)를 선택하는 모델을 선택, 통보문을 해석하는 모델 각각을 선택」
 *   「특보읽기, 참고사항해석에 지금 반영되어있는 모든 ai 툴을 다 선택할 수 있도록 … 각 기능별 사용 ai의 우선순위를 정해두고 그 우선순위대로 작동」
 *   「chat gpt도 fly, vm중 고를 수있도록 하고, gpt의 모델도 선택할 수 있도록」
 * 사용자 확정(2026-11-16): 해상 기상 전망 색칠 AI(종전 Gemini 고정)도 이 화면에서 고르게 — 「그렇게 진행하자」. ③ 기본 = Gemini 만 = 종전 동작.
 * 안전: Gemini 는 순서에서 뺄 수 없다(마지막 안전망 — 챗봇 순서와 같은 규칙). ① 기본 순서는 Gemini 가 1순위 = 종전 동작 그대로.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/llm_chain(검사·선택지·callDirect) · services/codex_bridge(ChatGPT 줄, runner 지정) ·
 *                   services/gemini_client(Gemini) · services/atomic_write
 *  - 저장          : data/bulletin_ai_config.json (볼륨)
 *  - 나를 쓰는 곳  : ai_report_parser.js(① read) · services/bulletin_ai_trial.js(② interpret — 「설정한 순서로」 시험) ·
 *                   marine_forecast_processor.js·regional_bulletin_collector.js(③ forecast — 해상 기상 전망·지방청 전망 색칠) ·
 *                   routes/bulletin_watch.js(GET/POST /api/admin/bulletin-ai/config) · client/js/admin/admin_bulletin_ai.js(화면)
 * [로드 순서] 없음(서버 모듈)
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./atomic_write');

const FILE = process.env.BULLETIN_AI_CONFIG_FILE || path.join(__dirname, '..', 'data', 'bulletin_ai_config.json');
const FEATURES = {
    // removed 기본값: ① 은 Gemini 만 남긴다 = 종전 동작 그대로(다른 AI 는 관리자가 「다시 추가」 해야 쓰인다 — 독립 검토: 키가 생기면 몰래 크레딧을 쓰지 않게).
    read: { name: '특보 통보문 읽기', order: ['gemini', 'claude2', 'claude1', 'upstage', 'chatgpt'], removed: ['claude2', 'claude1', 'upstage', 'chatgpt'] },
    interpret: { name: '참고사항 해석', order: ['claude2', 'claude1', 'chatgpt', 'upstage', 'gemini'], removed: [] },        // 최근 시험 = 클로드 키2
    // ③ 도 기본은 Gemini 만 = 종전 동작(전망 색칠은 종전에 Gemini 고정이었다 — 2026-11-16).
    forecast: { name: '해상 기상 전망 색칠', order: ['gemini', 'claude2', 'claude1', 'upstage', 'chatgpt'], removed: ['claude2', 'claude1', 'upstage', 'chatgpt'] },
};
const GEMINI_MODEL = 'gemini-2.5-flash-lite';   // ai_report_parser·전망 색칠이 쓰던 모델(표시만 — 고르지 않는다)
const llm = () => require('./llm_chain');
const RUNNERS = () => require('./codex_bridge').RUNNERS;

/**
 * 저장값 한 기능을 정리한다(틀린 칸은 기본값). ChatGPT 칸은 {model, effort:null, runner}.
 * 예: normFeature('read', undefined) → { order:[gemini,…], removed:[], models:{…, chatgpt:{model:'gpt-6-luna', effort:null, runner:'fly'}} }
 * @param {'read'|'interpret'|'forecast'} f @param {any} v @returns {{order:string[], removed:string[], models:object}}
 * [연계] ← getConfig·setConfig
 */
function normFeature(f, v) {
    const src = v && typeof v === 'object' ? v : {};
    const L = llm();
    const order = L.isValidOrder(src.order) ? src.order.slice() : FEATURES[f].order.slice();
    const removed = L.isValidRemoved(src.removed) ? L.normRemoved(src.removed) : FEATURES[f].removed.slice();
    const models = L.normModels(src.models);
    const r = src.models && src.models.chatgpt && src.models.chatgpt.runner;
    models.chatgpt.runner = RUNNERS().includes(r) ? r : require('./codex_bridge').DEFAULT_RUNNER;
    return { order, removed, models };
}

/** 저장된 설정 전체. 파일이 없거나 깨지면 기본값. @returns {{read:object, interpret:object, forecast:object}} */
function getConfig() {
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') console.warn('[AI 특보 분석] 설정 파일을 못 읽어 기본값을 씀:', e.message); }
    return { read: normFeature('read', raw.read), interpret: normFeature('interpret', raw.interpret), forecast: normFeature('forecast', raw.forecast) };
}

/**
 * 한 기능의 바꿀 칸만 받아 검사하고 저장한다. 틀리면 저장하지 않고 { error }.
 * 예: setConfig('read', { order:[…5개], models:{ chatgpt:{ model:'gpt-6-sol', runner:'vm' } } })
 * @param {string} f @param {{order?:string[], removed?:string[], models?:object}} patch
 * @returns {{ok:true, config:object}|{ok:false, error:string}}
 * [연계] ← routes/bulletin_watch.js POST /api/admin/bulletin-ai/config
 */
function setConfig(f, patch) {
    if (!Object.prototype.hasOwnProperty.call(FEATURES, f)) return { ok: false, error: 'feature 는 read|interpret|forecast' };   // __proto__·constructor 막기(독립 검토)
    const L = llm(), p = patch || {};
    if (p.order !== undefined && !L.isValidOrder(p.order)) return { ok: false, error: `order 는 ${L.PROVIDERS.join(',')} 다섯 개를 한 번씩` };
    if (p.removed !== undefined && !L.isValidRemoved(p.removed)) return { ok: false, error: 'removed 는 gemini 를 뺀 AI 중 겹치지 않게(gemini 는 뺄 수 없음)' };
    let runner;
    if (p.models !== undefined) {
        if (!p.models || typeof p.models !== 'object' || Array.isArray(p.models)) return { ok: false, error: 'models 는 객체' };
        const m = Object.assign({}, p.models);
        if (m.chatgpt) {
            runner = m.chatgpt.runner;
            if (runner !== undefined && !RUNNERS().includes(runner)) return { ok: false, error: 'ChatGPT 실행 위치는 fly|vm' };
            m.chatgpt = { model: m.chatgpt.model, effort: null };
        }
        if (!L.isValidModels(m)) return { ok: false, error: 'models 값이 선택지 밖(GET 의 choices 안에서)' };
    }
    const all = getConfig(), cur = all[f];
    if (p.order) cur.order = p.order.slice();
    if (p.removed) cur.removed = p.removed.slice();
    if (p.models) {
        for (const id of Object.keys(p.models)) {
            if (id === 'chatgpt') cur.models.chatgpt = { model: p.models.chatgpt.model, effort: null, runner: runner || cur.models.chatgpt.runner };
            else cur.models[id] = { model: p.models[id].model, effort: p.models[id].effort };
        }
    }
    all[f] = normFeature(f, cur);
    writeFileAtomic(FILE, JSON.stringify(Object.assign(all, { updatedAt: new Date().toISOString() }), null, 1));
    return { ok: true, config: getConfig() };
}

/** 관리자 화면용 선택지(챗봇 탭과 같은 목록 + Gemini 모델 표시 + ChatGPT 실행 위치). */
function choices() {
    const c = llm().choices(GEMINI_MODEL);
    c.chatgpt.runners = RUNNERS().slice();
    return c;
}

/**
 * 그 기능의 순서대로 AI 를 불러 첫 성공을 돌려준다. 전부 실패하면 마지막 오류.
 * 반환 모양은 gemini_client.callGemini 와 같다 + provider(누가 답했나)·tried(시도 기록).
 * 예: await call('read', '통보문…', { caller: 'AI Parser' }) → { success:true, text:'{…}', keyLabel:'claude2', provider:'claude2', tried:[…] }
 * @param {'read'|'interpret'|'forecast'} f @param {string} prompt @param {{caller?:string, json?:boolean}} [opt]
 * @returns {Promise<{success:boolean, text?:string, error?:string, isRateLimited?:boolean, keyLabel?:string, provider?:string, tried:Array}>}
 * [연계] ← ai_report_parser.js · bulletin_ai_trial.js · marine_forecast_processor.js · regional_bulletin_collector.js / → llm_chain.callDirect · codex_bridge.callRaw · gemini_client.callGemini
 */
async function call(f, prompt, opt) {
    const o = opt || {}, caller = o.caller || ('Bulletin-' + f);
    const config = o.json === false ? {} : { responseMimeType: 'application/json' };
    const cfg = getConfig()[f] || normFeature('read');
    const tried = [];
    let last = { success: false, error: '시도한 AI 없음' }, limited = false;
    for (const id of cfg.order) {
        if (cfg.removed.includes(id)) continue;
        let r;
        try {
            if (id === 'gemini') {
                r = await require('./gemini_client').callGemini({ model: GEMINI_MODEL, contents: prompt, config, caller });
            } else if (id === 'chatgpt') {
                const m = cfg.models.chatgpt;
                const x = await require('./codex_bridge').callRaw({ contents: prompt, config, caller, model: m.model, runner: m.runner });
                r = x.success ? { success: true, text: x.response.text, keyLabel: 'chatgpt-' + m.runner } : { success: false, error: x.error };
            } else {
                const x = await llm().callDirect(id, { contents: prompt, config }, cfg.models[id]);
                r = x.success ? { success: true, text: x.response.text, keyLabel: id } : { success: false, error: x.error };
            }
        } catch (e) { console.warn(`[AI 특보 분석] ${id} 호출 중 예외 — 다음 순위로:`, e && e.message); r = { success: false, error: String(e && e.message || e) }; }
        if (r.isRateLimited) limited = true;
        tried.push({ id, ok: !!r.success, error: r.success ? null : String(r.error || '').slice(0, 200) });
        if (r.success && r.text && String(r.text).trim()) {
            const text = id === 'gemini' || o.json === false ? r.text : require('./codex_bridge').stripFence(r.text);
            if (tried.length > 1) console.warn(`[AI 특보 분석] ${FEATURES[f].name}: ${id} 로 답함(앞 순위 실패 — ${tried.slice(0, -1).map(t => t.id + ':' + t.error).join(' / ')})`);
            return { success: true, text, keyLabel: r.keyLabel || id, provider: id, tried };
        }
        last = r;
    }
    // 시도한 AI 중 하나라도 한도 초과(429)였으면 isRateLimited — report_alert_processor 의 「10분 뒤 재시도」 분기가 종전대로 타게(독립 검토).
    return { success: false, error: last.error || '모든 AI 실패', isRateLimited: limited, tried };
}

module.exports = { FEATURES, GEMINI_MODEL, getConfig, setConfig, choices, call, normFeature, FILE };
