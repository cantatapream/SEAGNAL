'use strict';
/**
 * ============================================================================
 * 파일명: local_server/services/bulletin_ai.js
 * 역할  : 「AI 모델 설정」(종전 「AI 특보 분석」) — 기능마다(① read = 특보 통보문 읽기, ② interpret = 참고사항 해석, ③ briefing = 연안 안전 브리핑) AI 우선순위를 두고
 *         그 순서대로 시도한다(1순위가 실패하면 2순위 …). 칸마다 모델·노력, ChatGPT 칸은 실행 위치(Fly 서버|VM)까지 고른다.
 * 사용자 확정(2026-11-15):
 *   「ai 탭에서 ai 브리핑오른쪽에 특보분석 탭을만들고 기상청 통보문도 읽는 모델을 선택, gpt(vm 또는 fly)를 선택하는 모델을 선택, 통보문을 해석하는 모델 각각을 선택」
 *   「특보읽기, 참고사항해석에 지금 반영되어있는 모든 ai 툴을 다 선택할 수 있도록 … 각 기능별 사용 ai의 우선순위를 정해두고 그 우선순위대로 작동」
 *   「chat gpt도 fly, vm중 고를 수있도록 하고, gpt의 모델도 선택할 수 있도록」
 * 안전: Gemini 는 순서에서 뺄 수 없다(마지막 안전망 — 챗봇 순서와 같은 규칙). ① 기본 순서는 Gemini 가 1순위 = 종전 동작 그대로.
 * ③ briefing(2026-11-16 사용자 「ai 모델 선택 및 설정 부분은 ai 탭의 ai 모델 설정이라는 하위 탭에서 … ① 특보 통보문 읽기에 해당하는 리스트와 같이 …
 *   모든 ai및 모델설정하는것과 동일하게 맞춰줘. 즉 다른 ai로도 돌아가도록」 · 다시 시도 「(나)」 = 줄마다 횟수 · 처음 순서 「클로드 2번, 클로드 1번, 업스테이지, gpt, gemini」):
 *   칸마다 시도 횟수(attempts 1~3)와 Gemini 모델(브리핑만 고름 — 종전 브리핑 설정 geminiModel 두 가지)도 둔다. 부르는 일은 station_briefing_ai.generate 가 한다(briefingChain).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/llm_chain(검사·선택지·callDirect) · services/codex_bridge(ChatGPT 줄, runner 지정) ·
 *                   services/gemini_client(Gemini) · services/atomic_write
 *  - 저장          : data/bulletin_ai_config.json (볼륨)
 *  - 나를 쓰는 곳  : ai_report_parser.js(① read) · services/bulletin_ai_trial.js(② interpret — 「설정한 순서로」 시험) · services/station_briefing.js(③ briefing — briefingChain) ·
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
    briefing: { name: '연안 안전 브리핑', order: ['claude2', 'claude1', 'upstage', 'chatgpt', 'gemini'], removed: [] },       // 사용자 확정 2026-11-16
};
// ③ 브리핑 칸별 시도 횟수(같은 묶음을 그 AI 로 몇 번까지 — 떨어진 관할만 다시). 기본: ChatGPT 3번(종전 브리핑 「VM 최대 3번」 그대로) · 나머지 1번.
const ATTEMPT_CHOICES = [1, 2, 3];
const BRIEFING_ATTEMPTS = { claude2: 1, claude1: 1, upstage: 1, chatgpt: 3, gemini: 1 };
// ③ 브리핑 Gemini 모델(종전 브리핑 설정 geminiModel 의 두 선택지 — station_briefing.CHOICES.geminiModel 과 같은지 시험이 본다).
const BRIEFING_GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const GEMINI_MODEL = 'gemini-2.5-flash-lite';   // ai_report_parser 가 쓰던 모델(표시만 — 고르지 않는다)
const llm = () => require('./llm_chain');
const RUNNERS = () => require('./codex_bridge').RUNNERS;

/**
 * 저장값 한 기능을 정리한다(틀린 칸은 기본값). ChatGPT 칸은 {model, effort:null, runner}.
 * 예: normFeature('read', undefined) → { order:[gemini,…], removed:[], models:{…, chatgpt:{model:'gpt-6-luna', effort:null, runner:'fly'}} }
 * @param {'read'|'interpret'} f @param {any} v @returns {{order:string[], removed:string[], models:object}}
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
    if (f !== 'briefing') return { order, removed, models };
    // ③ 브리핑만: Gemini 모델 고름 · 칸별 시도 횟수
    const gm = src.models && src.models.gemini && src.models.gemini.model;
    models.gemini = { model: BRIEFING_GEMINI_MODELS.includes(gm) ? gm : BRIEFING_GEMINI_MODELS[0], effort: null };
    const attempts = {};
    for (const id of L.PROVIDERS) { const a = src.attempts && src.attempts[id]; attempts[id] = ATTEMPT_CHOICES.includes(a) ? a : BRIEFING_ATTEMPTS[id]; }
    return { order, removed, models, attempts };
}

/** 저장된 설정 전체. 파일이 없거나 깨지면 기본값. @returns {{read:object, interpret:object}} */
function getConfig() {
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') console.warn('[AI 특보 분석] 설정 파일을 못 읽어 기본값을 씀:', e.message); }
    return { read: normFeature('read', raw.read), interpret: normFeature('interpret', raw.interpret), briefing: normFeature('briefing', raw.briefing) };
}

/**
 * 한 기능의 바꿀 칸만 받아 검사하고 저장한다. 틀리면 저장하지 않고 { error }.
 * 예: setConfig('read', { order:[…5개], models:{ chatgpt:{ model:'gpt-6-sol', runner:'vm' } } })
 * @param {string} f @param {{order?:string[], removed?:string[], models?:object}} patch
 * @returns {{ok:true, config:object}|{ok:false, error:string}}
 * [연계] ← routes/bulletin_watch.js POST /api/admin/bulletin-ai/config
 */
function setConfig(f, patch) {
    if (!Object.prototype.hasOwnProperty.call(FEATURES, f)) return { ok: false, error: 'feature 는 read|interpret|briefing' };   // __proto__·constructor 막기(독립 검토)
    const L = llm(), p = patch || {};
    if (p.order !== undefined && !L.isValidOrder(p.order)) return { ok: false, error: `order 는 ${L.PROVIDERS.join(',')} 다섯 개를 한 번씩` };
    if (p.removed !== undefined && !L.isValidRemoved(p.removed)) return { ok: false, error: 'removed 는 gemini 를 뺀 AI 중 겹치지 않게(gemini 는 뺄 수 없음)' };
    let runner, geminiModel;
    if (p.attempts !== undefined) {
        if (f !== 'briefing') return { ok: false, error: 'attempts 는 briefing 만' };
        if (!p.attempts || typeof p.attempts !== 'object' || Array.isArray(p.attempts) || !Object.keys(p.attempts).every((id) => L.PROVIDERS.includes(id) && ATTEMPT_CHOICES.includes(p.attempts[id]))) return { ok: false, error: 'attempts 는 {AI: 1|2|3}' };
    }
    if (p.models !== undefined) {
        if (!p.models || typeof p.models !== 'object' || Array.isArray(p.models)) return { ok: false, error: 'models 는 객체' };
        const m = Object.assign({}, p.models);
        if (m.gemini !== undefined) {   // Gemini 모델은 ③ 브리핑만 고른다(①②는 고정 표시)
            if (f !== 'briefing' || !m.gemini || !BRIEFING_GEMINI_MODELS.includes(m.gemini.model)) return { ok: false, error: 'Gemini 모델은 briefing 에서 ' + BRIEFING_GEMINI_MODELS.join('|') + ' 만' };
            geminiModel = m.gemini.model; delete m.gemini;
        }
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
            else if (id === 'gemini') cur.models.gemini = { model: geminiModel, effort: null };
            else cur.models[id] = { model: p.models[id].model, effort: p.models[id].effort };
        }
    }
    if (p.attempts) cur.attempts = Object.assign({}, cur.attempts, p.attempts);
    all[f] = normFeature(f, cur);
    writeFileAtomic(FILE, JSON.stringify(Object.assign(all, { updatedAt: new Date().toISOString() }), null, 1));
    return { ok: true, config: getConfig() };
}

/** 관리자 화면용 선택지(챗봇 탭과 같은 목록 + Gemini 모델 표시 + ChatGPT 실행 위치). */
function choices() {
    const c = llm().choices(GEMINI_MODEL);
    c.chatgpt.runners = RUNNERS().slice();
    c.briefing = { geminiModels: BRIEFING_GEMINI_MODELS.slice(), attempts: ATTEMPT_CHOICES.slice() };   // ③ 브리핑 칸 — Gemini 모델·시도 횟수
    return c;
}

/**
 * ③ 연안 안전 브리핑이 부를 AI 사슬 — 저장된 순서에서 삭제한 AI 를 빼고, 칸마다 모델·노력·실행 위치·시도 횟수.
 * 예: briefingChain() → [{id:'claude2', model:'claude-sonnet-5-5', effort:'medium', runner:null, attempts:1}, …, {id:'chatgpt', model:'gpt-6-luna', effort:null, runner:'fly', attempts:3}, {id:'gemini', model:'gemini-2.5-flash', effort:null, runner:null, attempts:1}]
 * @returns {Array<{id:string, model:string, effort:string|null, runner:string|null, attempts:number}>}
 * [연계] ← services/station_briefing.js run(forDefault 가 aiChain 으로 넘김) → station_briefing_ai.generate(config.chain)
 */
function briefingChain() {
    const c = getConfig().briefing;
    return c.order.filter((id) => !c.removed.includes(id)).map((id) => ({ id, model: c.models[id].model, effort: c.models[id].effort || null, runner: id === 'chatgpt' ? c.models.chatgpt.runner : null, attempts: c.attempts[id] }));
}

/**
 * 그 기능의 순서대로 AI 를 불러 첫 성공을 돌려준다. 전부 실패하면 마지막 오류.
 * 반환 모양은 gemini_client.callGemini 와 같다 + provider(누가 답했나)·tried(시도 기록).
 * 예: await call('read', '통보문…', { caller: 'AI Parser' }) → { success:true, text:'{…}', keyLabel:'claude2', provider:'claude2', tried:[…] }
 * @param {'read'|'interpret'} f @param {string} prompt @param {{caller?:string, json?:boolean}} [opt]
 * @returns {Promise<{success:boolean, text?:string, error?:string, isRateLimited?:boolean, keyLabel?:string, provider?:string, tried:Array}>}
 * [연계] ← ai_report_parser.js · bulletin_ai_trial.js / → llm_chain.callDirect · codex_bridge.callRaw · gemini_client.callGemini
 */
async function call(f, prompt, opt) {
    const o = opt || {}, caller = o.caller || ('Bulletin-' + f);
    const config = o.json === false ? {} : { responseMimeType: 'application/json' };
    const cfg = getConfig()[f] || normFeature('read');   // ③ briefing 은 여기를 쓰지 않는다(묶음·검사·다시 시도가 있어 station_briefing_ai.generate 가 직접 — briefingChain)
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

module.exports = { FEATURES, GEMINI_MODEL, ATTEMPT_CHOICES, BRIEFING_ATTEMPTS, BRIEFING_GEMINI_MODELS, getConfig, setConfig, choices, call, normFeature, briefingChain, FILE };
