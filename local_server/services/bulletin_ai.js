'use strict';
/**
 * ============================================================================
 * 파일명: local_server/services/bulletin_ai.js
 * 역할  : 「AI 모델 설정」(종전 「AI 특보 분석」) — 기능마다(① read = 특보 통보문 읽기, ② interpret = 참고사항 해석, ③ forecast = 해상 기상 전망 색칠, ④ briefing = 연안 안전 브리핑,
 *         ⑤ escalation = 격상 가능성 읽기) AI 우선순위를 두고
 *         그 순서대로 시도한다(1순위가 실패하면 2순위 …). 칸마다 모델·노력, ChatGPT 칸은 실행 위치(Fly 서버|VM)까지 고른다.
 * 사용자 확정(2026-11-15):
 *   「ai 탭에서 ai 브리핑오른쪽에 특보분석 탭을만들고 기상청 통보문도 읽는 모델을 선택, gpt(vm 또는 fly)를 선택하는 모델을 선택, 통보문을 해석하는 모델 각각을 선택」
 *   「특보읽기, 참고사항해석에 지금 반영되어있는 모든 ai 툴을 다 선택할 수 있도록 … 각 기능별 사용 ai의 우선순위를 정해두고 그 우선순위대로 작동」
 *   「chat gpt도 fly, vm중 고를 수있도록 하고, gpt의 모델도 선택할 수 있도록」
 * 사용자 확정(2026-11-16): 해상 기상 전망 색칠 AI(종전 Gemini 고정)도 이 화면에서 고르게 — 「그렇게 진행하자」. ③ 기본 = Gemini 만 = 종전 동작.
 * Gemma(2026-11-19) — ③ forecast(해상 기상 전망 색칠)에서만, **순서 맨 앞에 「먼저 Gemma」** 로 둔다.
 *   사용자: 「단기, 초단기, 지방청별 기상전망에 대해 색을 입히고 … Gemma ai를 사용해도 될 것 같은데? 무료니까」 · 「기존 통합관리자센터에서 ai 모델 선택하는데 Gemma 를 추가해야」 ·
 *     키는 「그냥 기존키에서 젬마를 부르는방식으로하자」 · (실제 시험 뒤) 「지방청별 전망은 규칙으로 읽지 말고, 젬마가 색칠하는 기능을 넣자 격상읽기는 하지말고.
 *     단, 젬마가 색칠할 수 없는 문제, 한도 초과, 서버 붐빔 등 문제가 있다면 그때 내가 선택한 api가 호출하여 색칠하도록 하자.」
 *   ③ 의 `gemma` 칸 = '' (쓰지 않음 — 기본 = 종전 그대로) | gemma-4-26b-a4b-it | gemma-4-31b-it (Gemini API 가 제공하는 Gemma 두 모델 — gemma.ai/deployment/gemini-api, 같은 AI Studio 키).
 *   고르면 Gemma 를 먼저 부르고, Gemma 가 색칠하지 못하면(오류·한도 초과 429·수요 과다 503·60초 시간 초과·빈 답·JSON 을 못 꺼냄·필요한 칸 없음·색 표시 꼴이 깨짐·원문 줄을 빼먹음)
 *   **③ 에 정해 둔 순서대로**(사용자가 고른 AI — 기본은 Gemini 만) 이어서 부른다. ⑤ 격상 가능성 읽기에는 Gemma 를 쓰지 않는다(사용자 「격상읽기는 하지말고」).
 *   실제 키로 불러 본 것(2026-11-19, 사용자가 준 임시 키 — analysis/bulletin_survey/README.md ⑰):
 *     · JSON 모드를 켜면 답을 배열로 한 겹 더 싸서(`[{"항목":[…]}]`) 내는 일이 많다 → **JSON 모드 없이** 부르고, 답에서 JSON 덩어리를 너그럽게 꺼낸다(울타리·덧붙인 설명·한 겹 배열).
 *     · 「생각」을 기본으로 두면 글 한 편에 147~203초 → **생각 최소**(thinkingLevel minimal — 색칠 16~26초)로 부른다.
 *     · gemma-4-31b-it 는 「수요 과다」(503)와 38~45초 지연, gemma-4-26b-a4b-it 도 연달아 부르면 503·한도 초과(429)가 났다(새 무료 키).
 *     · 색칠 답 4편 중 자세히 본 2편에서 유의사항 줄을 빼거나 색 표시 꼴이 깨진 답(`{{num:…}for}`)이 있었다 → 그런 답은 못 쓰는 답으로 쳐 순서의 다음 AI 로 넘긴다(GEMMA_OK · gemmaAccept).
 *   Gemma 가 실패해 다음 AI 가 답한 사실은 gemmaStatus() 로 관리자 화면에 보인다(조용히 대신하면 고장이 안 보인다). Gemma 호출은 gemini_client.callPlain(키 쿨다운을 건드리지 않음 · 60초 시간 제한).
 * 안전: Gemini 는 순서에서 뺄 수 없다(마지막 안전망 — 챗봇 순서와 같은 규칙). ① 기본 순서는 Gemini 가 1순위 = 종전 동작 그대로.
 * ④ briefing(2026-11-16 사용자 「ai 모델 선택 및 설정 부분은 ai 탭의 ai 모델 설정이라는 하위 탭에서 … ① 특보 통보문 읽기에 해당하는 리스트와 같이 …
 *   모든 ai및 모델설정하는것과 동일하게 맞춰줘. 즉 다른 ai로도 돌아가도록」 · 다시 시도 「(나)」 = 줄마다 횟수 · 처음 순서 「클로드 2번, 클로드 1번, 업스테이지, gpt, gemini」):
 *   칸마다 시도 횟수(attempts 1~3)와 Gemini 모델(브리핑만 고름 — 종전 브리핑 설정 geminiModel 두 가지)도 둔다. 부르는 일은 station_briefing_ai.generate 가 한다(briefingChain).
 * ⑤ escalation(2026-11-19 사용자 「관리자페이지에서 어떤 ai 쓸건지 결정하는 부분도 ui 만들어야」): 「풍랑경보로 변경될 가능성」「태풍특보로 변경될 가능성」 문장 가운데
 *   규칙이 해역·시점을 못 읽은 것만 묻는다(services/bulletin_escalation — AI 답은 그 문장에 글자 그대로 있고 규칙이 풀 수 있는 해역일 때만 쓴다). 기본 = Gemini 만(①③ 과 같은 까닭).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/llm_chain(검사·선택지·callDirect) · services/codex_bridge(ChatGPT 줄, runner 지정) ·
 *                   services/gemini_client(Gemini) · services/atomic_write
 *  - 저장          : data/bulletin_ai_config.json (볼륨)
 *  - 나를 쓰는 곳  : ai_report_parser.js(① read) · services/bulletin_ai_trial.js(② interpret — 「설정한 순서로」 시험) ·
 *                   marine_forecast_processor.js·regional_bulletin_collector.js(③ forecast — 해상 기상 전망·지방청 전망 색칠) · services/station_briefing.js(④ briefing — briefingChain) ·
 *                   services/bulletin_escalation.js(⑤ escalation — 규칙이 못 읽은 격상 가능성 문장) ·
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
    briefing: { name: '연안 안전 브리핑', order: ['claude2', 'claude1', 'upstage', 'chatgpt', 'gemini'], removed: [] },       // 사용자 확정 2026-11-16
    // ⑤ 도 기본은 Gemini 만(①③ 과 같은 까닭 — 다른 AI 는 관리자가 「다시 추가」 해야 쓰인다). 규칙이 못 읽은 문장만 묻는다 — 지난 31일치 날씨해설에서는 0번.
    escalation: { name: '격상 가능성 읽기', order: ['gemini', 'claude2', 'claude1', 'upstage', 'chatgpt'], removed: ['claude2', 'claude1', 'upstage', 'chatgpt'] },
};
// ④ 브리핑 칸별 시도 횟수(같은 묶음을 그 AI 로 몇 번까지 — 떨어진 관할만 다시). 기본: ChatGPT 3번(종전 브리핑 「VM 최대 3번」 그대로) · 나머지 1번.
const ATTEMPT_CHOICES = [1, 2, 3];
const BRIEFING_ATTEMPTS = { claude2: 1, claude1: 1, upstage: 1, chatgpt: 3, gemini: 1 };
// ④ 브리핑 Gemini 모델(종전 브리핑 설정 geminiModel 의 두 선택지 — station_briefing.CHOICES.geminiModel 과 같은지 시험이 본다).
const BRIEFING_GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const GEMINI_MODEL = 'gemini-2.5-flash-lite';   // ai_report_parser 가 쓰던 모델(①② 는 표시만 — 고르지 않는다)
// Gemma — Gemini API 가 제공하는 두 모델(2026-11 gemma.ai/deployment/gemini-api: 「hosts the two largest Gemma 4 models」). ③ 색칠에서만, 순서 맨 앞에 둔다.
//   26b 를 앞에 둔다 — 실제로 불러 본 날 31b 는 「수요 과다」와 38~45초 지연이 잦았다.
const GEMMA_MODELS = ['gemma-4-26b-a4b-it', 'gemma-4-31b-it'];
const GEMMA_FEATURES = ['forecast'];
const gemmaLast = {};   // 기능 → 마지막 Gemma 호출 결과 { at, model, ok, error, okCount, failCount } — 서버가 켜져 있는 동안만(관리자 화면 표시용)
const GEMMA_CONFIG = { thinkingConfig: { thinkingLevel: 'minimal' } };   // 생각 최소 — 기본(생각 켬)은 글 한 편에 2~3분이 걸렸다(실측)
/** 색 표시 꼴이 온전한가 — `{{loc|num|warn:…}}` 를 다 걷어 낸 뒤에 `{{`·`}}` 가 남으면 깨진 것(실제 Gemma 답: `{{num:30~60km/h(8~16m/s)}for}로`). */
//   글 칸 하나하나에서 본다 — JSON 글 전체로 보면 JSON 자체의 `}}` 에 걸리고, 안 닫힌 표시가 뒤 칸의 `}}` 와 짝지어져 통과한다.
function markupOk(p) {
    if (typeof p === 'string') return !/\{\{|\}\}/.test(p.replace(/\{\{(?:loc|num|warn):[^{}]*\}\}/g, ''));
    if (p && typeof p === 'object') return Object.values(p).every(markupOk);
    return true;
}
// ③ 색칠에 「쓸 수 있는 Gemma 답」: 필요한 칸이 있고(categories 가 빈 객체가 아니거나 summary 가 글) 색 표시 꼴이 온전하다. 아니면 순서의 다음 AI 로 넘긴다.
//   없으면: `{}`·`[]` 같은 답이 「성공」으로 캐시에 굳어 그 전망은 색칠 없이 확정되고(부르는 쪽은 답이 있으면 다시 부르지 않는다 — 별도 에이전트 검토 2026-11-19), 깨진 표시가 화면에 글자 그대로 나간다.
const GEMMA_OK = (p) => !!p && typeof p === 'object' && !Array.isArray(p)
    && ((!!p.categories && typeof p.categories === 'object' && !Array.isArray(p.categories) && Object.keys(p.categories).length > 0) || (typeof p.summary === 'string' && !!p.summary.trim()))
    && markupOk(p);
/**
 * 답 글에서 JSON 덩어리를 꺼낸다 — ```json 울타리, 뒤에 덧붙인 설명(「*(참고: …)」), 한 겹 배열(`[{…}]`)을 벗긴다. 못 꺼내면 undefined.
 * 예: '```json\n{"항목":[]}\n```\n*(참고: …)*' → {항목:[]} · '[{"항목":[]}]' → {항목:[]}
 * [연계] ← callGemma
 */
function looseJson(text) {
    const t = String(text || '');
    const tryParse = (s) => { try { return JSON.parse(s); } catch (_) { return undefined; } };
    let p = tryParse(require('./codex_bridge').stripFence(t));
    if (p === undefined) { const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a >= 0 && b > a) p = tryParse(t.slice(a, b + 1)); }
    if (Array.isArray(p) && p.length === 1 && p[0] && typeof p[0] === 'object') p = p[0];
    return p;
}
const llm = () => require('./llm_chain');
const RUNNERS = () => require('./codex_bridge').RUNNERS;

/**
 * 저장값 한 기능을 정리한다(틀린 칸은 기본값). ChatGPT 칸은 {model, effort:null, runner}.
 * 예: normFeature('read', undefined) → { order:[gemini,…], removed:[], models:{…, chatgpt:{model:'gpt-6-luna', effort:null, runner:'fly'}} }
 * @param {'read'|'interpret'|'forecast'|'briefing'|'escalation'} f @param {any} v @returns {{order:string[], removed:string[], models:object}}
 * [연계] ← getConfig·setConfig
 */
function normFeature(f, v) {
    const src = v && typeof v === 'object' ? v : {};
    const L = llm();
    const order = L.isValidOrder(src.order) ? src.order.slice() : FEATURES[f].order.slice();
    const removed = L.isValidRemoved(src.removed) ? L.normRemoved(src.removed) : FEATURES[f].removed.slice();
    const models = L.normModels(src.models);
    const r = src.models && src.models.chatgpt && src.models.chatgpt.runner;
    models.chatgpt.runner = RUNNERS().includes(r) ? r : f === 'briefing' && RUNNERS().includes('vm') ? 'vm' : require('./codex_bridge').DEFAULT_RUNNER;   // ④ 기본은 VM — 종전 브리핑 ChatGPT 가 VM 작업자였다(바뀌는 것 최소화)
    if (GEMMA_FEATURES.includes(f)) return { order, removed, models, gemma: GEMMA_MODELS.includes(src.gemma) ? src.gemma : '' };   // ③: 먼저 부를 Gemma 모델('' = 쓰지 않음 = 종전 그대로)
    if (f !== 'briefing') return { order, removed, models };
    // ④ 브리핑만: Gemini 모델 고름 · 칸별 시도 횟수
    const gm = src.models && src.models.gemini && src.models.gemini.model;
    models.gemini = { model: BRIEFING_GEMINI_MODELS.includes(gm) ? gm : BRIEFING_GEMINI_MODELS[0], effort: null };
    const attempts = {};
    for (const id of L.PROVIDERS) { const a = src.attempts && src.attempts[id]; attempts[id] = ATTEMPT_CHOICES.includes(a) ? a : BRIEFING_ATTEMPTS[id]; }
    return { order, removed, models, attempts };
}

/** 저장된 설정 전체. 파일이 없거나 깨지면 기본값. @returns {{read:object, interpret:object, forecast:object, briefing:object, escalation:object}} */
function getConfig() {
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') console.warn('[AI 특보 분석] 설정 파일을 못 읽어 기본값을 씀:', e.message); }
    if (!raw || typeof raw !== 'object') raw = {};   // 파일 내용이 null·숫자 등이면 기본값(독립 검토 7 — AI 브리핑 실행이 이 설정을 읽으므로 던지면 실행이 통째로 실패)
    return { read: normFeature('read', raw.read), interpret: normFeature('interpret', raw.interpret), forecast: normFeature('forecast', raw.forecast), briefing: normFeature('briefing', raw.briefing), escalation: normFeature('escalation', raw.escalation) };
}

/**
 * 한 기능의 바꿀 칸만 받아 검사하고 저장한다. 틀리면 저장하지 않고 { error }.
 * 예: setConfig('read', { order:[…5개], models:{ chatgpt:{ model:'gpt-6-sol', runner:'vm' } } })
 * @param {string} f @param {{order?:string[], removed?:string[], models?:object, attempts?:object, gemma?:string}} patch  gemma = ③ 에서만: 먼저 부를 Gemma 모델 | ''(쓰지 않음)
 * @returns {{ok:true, config:object}|{ok:false, error:string}}
 * [연계] ← routes/bulletin_watch.js POST /api/admin/bulletin-ai/config
 */
function setConfig(f, patch) {
    if (!Object.prototype.hasOwnProperty.call(FEATURES, f)) return { ok: false, error: 'feature 는 read|interpret|forecast|briefing|escalation' };   // __proto__·constructor 막기(독립 검토)
    const L = llm(), p = patch || {};
    if (p.order !== undefined && !L.isValidOrder(p.order)) return { ok: false, error: `order 는 ${L.PROVIDERS.join(',')} 다섯 개를 한 번씩` };
    if (p.removed !== undefined && !L.isValidRemoved(p.removed)) return { ok: false, error: 'removed 는 gemini 를 뺀 AI 중 겹치지 않게(gemini 는 뺄 수 없음)' };
    let runner, geminiModel;
    if (p.attempts !== undefined) {
        if (f !== 'briefing') return { ok: false, error: 'attempts 는 briefing 만' };
        if (!p.attempts || typeof p.attempts !== 'object' || Array.isArray(p.attempts) || !Object.keys(p.attempts).every((id) => L.PROVIDERS.includes(id) && ATTEMPT_CHOICES.includes(p.attempts[id]))) return { ok: false, error: 'attempts 는 {AI: 1|2|3}' };
    }
    if (p.gemma !== undefined && (!GEMMA_FEATURES.includes(f) || (p.gemma !== '' && !GEMMA_MODELS.includes(p.gemma)))) return { ok: false, error: 'gemma 는 forecast 에서 ' + GEMMA_MODELS.join('|') + ' 또는 빈 글(쓰지 않음)만' };
    if (p.models !== undefined) {
        if (!p.models || typeof p.models !== 'object' || Array.isArray(p.models)) return { ok: false, error: 'models 는 객체' };
        const m = Object.assign({}, p.models);
        if (m.gemini !== undefined) {   // Gemini 모델은 ④ 브리핑만 고른다(①②는 고정 표시)
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
    if (p.gemma !== undefined) cur.gemma = p.gemma;
    all[f] = normFeature(f, cur);
    writeFileAtomic(FILE, JSON.stringify(Object.assign(all, { updatedAt: new Date().toISOString() }), null, 1));
    return { ok: true, config: getConfig() };
}

/** 관리자 화면용 선택지(챗봇 탭과 같은 목록 + Gemini 모델 표시 + ChatGPT 실행 위치). */
function choices() {
    const c = llm().choices(GEMINI_MODEL);
    c.chatgpt.runners = RUNNERS().slice();
    c.briefing = { geminiModels: BRIEFING_GEMINI_MODELS.slice(), attempts: ATTEMPT_CHOICES.slice() };   // ④ 브리핑 칸 — Gemini 모델·시도 횟수
    c.gemma = { features: GEMMA_FEATURES.slice(), models: GEMMA_MODELS.slice(), tryModels: [GEMINI_MODEL].concat(GEMMA_MODELS) };   // ③ 「먼저 Gemma」 선택지 · 「시험 호출」로 부를 수 있는 모델
    return c;
}

/**
 * Gemma 를 한 번 부른다(JSON 모드 없이 · 생각 최소). JSON 답을 바라는 호출이면 답에서 JSON 을 꺼내 보고, 기능이 바라는 모양(shape)인지도 본다 —
 * 아니면 실패로 친다(부르는 쪽이 종전 Gemini 로 대신한다).
 * 예: await callGemma('gemma-4-26b-a4b-it', '…JSON 만 답하라…', { caller:'X', shape: GEMMA_OK }) → { success:true, text:'{"categories":{…}}' }(꺼낸 JSON 을 다시 글로)
 * @param {string} model @param {string} prompt @param {{caller?:string, json?:boolean, shape?:function(any): boolean}} [o]
 * @returns {Promise<{success:boolean, text?:string, error?:string, isRateLimited?:boolean}>}
 * [연계] ← call(Gemini 칸) · tryModel / → gemini_client.callPlain
 */
async function callGemma(model, prompt, o) {
    const r = await require('./gemini_client').callPlain({ model, contents: prompt, config: GEMMA_CONFIG, caller: (o && o.caller) || 'Bulletin-Gemma' });
    if (!r.success) return { success: false, error: r.error || 'Gemma 호출 실패', isRateLimited: !!r.isRateLimited };
    if (!r.text || !String(r.text).trim()) return { success: false, error: 'Gemma 가 빈 답을 냈다' };
    if (o && o.json === false) return { success: true, text: r.text };
    const p = looseJson(r.text);
    if (p === undefined) return { success: false, error: 'Gemma 답이 JSON 이 아니다: ' + String(r.text).replace(/\s+/g, ' ').slice(0, 120) };
    if (o && o.shape && !o.shape(p)) return { success: false, error: 'Gemma 답을 쓸 수 없다(필요한 칸이 없거나 색 표시 꼴이 깨졌거나 원문 줄이 빠졌다): ' + JSON.stringify(p).slice(0, 120) };
    return { success: true, text: JSON.stringify(p) };
}

/** 기능별 마지막 Gemma 호출 결과(서버가 켜져 있는 동안) — 관리자 화면이 「Gemma 가 실패해 순서의 다음 AI 가 대신 답함」을 보이게. @returns {object} { forecast?:{at, model, ok, error}, escalation?:… } */
function gemmaStatus() { return JSON.parse(JSON.stringify(gemmaLast)); }

/**
 * 관리자 「시험 호출」 — 고른 모델을 짧은 지시문으로 한 번 불러 본다(설정을 바꾸지 않는다). 이 저장소의 작업 환경에는 AI 키가 없어 Gemma 를 실제로 불러 보지 못했다 — 운영에서 이 버튼으로 확인한다.
 * 예: await tryModel('gemma-4-31b-it') → { ok:true, model, ms:812, text:'{"해역":"동해중부먼바다","시점":"오늘 밤부터"}' } | { ok:false, model, ms, error:'…' }
 * @param {string} model 기본 Gemini 모델 또는 GEMMA_MODELS 중 하나 @returns {Promise<{ok:boolean, model:string, ms?:number, text?:string, error?:string}>}
 * [연계] ← routes/bulletin_watch.js POST /api/admin/bulletin-ai/try-model
 */
async function tryModel(model) {
    const picks = [GEMINI_MODEL].concat(GEMMA_MODELS);
    if (!picks.includes(model)) return { ok: false, model: String(model), error: '고를 수 있는 모델이 아니다(' + picks.join('|') + ')' };
    const prompt = '다음 글에서 「풍랑경보로 변경될 가능성」이 있다고 한 해역과 시점을 글에 적힌 그대로 뽑아 JSON 만 답하라: {"해역":"…","시점":"…"}\n글: 동해중부먼바다는 오늘 밤부터 물결이 더욱 높게 일면서 풍랑경보로 변경될 가능성이 있겠습니다.';
    const t0 = Date.now();
    let r;
    try {
        r = GEMMA_MODELS.includes(model) ? await callGemma(model, prompt, { caller: 'Bulletin-TryModel', shape: (p) => !!p && typeof p === 'object' && !Array.isArray(p) })
            : await require('./gemini_client').callPlain({ model, contents: prompt, config: { responseMimeType: 'application/json' }, caller: 'Bulletin-TryModel' });
    } catch (e) { console.warn('[AI 특보 분석] 시험 호출 중 예외:', model, e && e.message); r = { success: false, error: String((e && e.message) || e) }; }
    const ms = Date.now() - t0;
    return r.success ? { ok: true, model, ms, text: String(r.text || '').slice(0, 300) } : { ok: false, model, ms, error: String(r.error || '실패').slice(0, 300) };
}

/**
 * ④ 연안 안전 브리핑이 부를 AI 사슬 — 저장된 순서에서 삭제한 AI 를 빼고, 칸마다 모델·노력·실행 위치·시도 횟수.
 * 예: briefingChain() → [{id:'claude2', model:'claude-sonnet-5-5', effort:'medium', runner:null, attempts:1}, …, {id:'chatgpt', model:'gpt-6-luna', effort:null, runner:'vm', attempts:3}, {id:'gemini', model:'gemini-2.5-flash', effort:null, runner:null, attempts:1}]
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
 * @param {'read'|'interpret'|'forecast'|'escalation'} f @param {string} prompt @param {{caller?:string, json?:boolean, gemmaAccept?:function(object): boolean}} [opt]
 *   gemmaAccept = ③ 에서 Gemma 답(꺼낸 JSON)을 받아 쓸 만한지 더 본다(부르는 쪽이 원문과 견줘 줄이 빠졌는지 등). false 면 순서의 다음 AI 로 넘긴다. Gemma 를 안 쓰면 불리지 않는다.
 * @returns {Promise<{success:boolean, text?:string, error?:string, isRateLimited?:boolean, keyLabel?:string, provider?:string, tried:Array}>}
 * [연계] ← ai_report_parser.js · bulletin_ai_trial.js · marine_forecast_processor.js · regional_bulletin_collector.js · bulletin_escalation.js / → llm_chain.callDirect · codex_bridge.callRaw · gemini_client.callGemini
 */
async function call(f, prompt, opt) {
    const o = opt || {}, caller = o.caller || ('Bulletin-' + f);
    const config = o.json === false ? {} : { responseMimeType: 'application/json' };
    const cfg = getConfig()[f] || normFeature('read');   // ④ briefing 은 여기를 쓰지 않는다(묶음·검사·다시 시도가 있어 station_briefing_ai.generate 가 직접 — briefingChain)
    const tried = [];
    let last = { success: false, error: '시도한 AI 없음' }, limited = false;
    // [먼저 Gemma — ③ 색칠만] 고른 Gemma 모델을 먼저 부른다. 색칠하지 못하면(오류·한도 초과·수요 과다·시간 초과·못 쓰는 답) 아래 순서(사용자가 정한 AI)로 넘어간다.
    //   사용자 2026-11-19: 「젬마가 색칠할 수 없는 문제, 한도 초과, 서버 붐빔 등 문제가 있다면 그때 내가 선택한 api가 호출하여 색칠하도록 하자.」
    if (GEMMA_FEATURES.includes(f) && cfg.gemma) {
        let g;
        try { g = await callGemma(cfg.gemma, prompt, { caller: caller + '-Gemma', json: o.json, shape: o.json === false ? null : (p) => GEMMA_OK(p) && (!o.gemmaAccept || o.gemmaAccept(p)) }); }
        catch (e) { console.warn('[AI 특보 분석] Gemma 호출 중 예외:', e && e.message); g = { success: false, error: String((e && e.message) || e) }; }
        const prev = gemmaLast[f] || {};
        gemmaLast[f] = { at: Date.now(), model: cfg.gemma, ok: !!g.success, error: g.success ? null : String(g.error || '').slice(0, 200),
            okCount: (prev.okCount || 0) + (g.success ? 1 : 0), failCount: (prev.failCount || 0) + (g.success ? 0 : 1) };
        tried.push({ id: 'gemma', ok: !!g.success, error: gemmaLast[f].error });
        if (g.success) return { success: true, text: g.text, keyLabel: 'gemma:' + cfg.gemma, provider: 'gemma', tried };
        console.warn(`[AI 특보 분석] ${FEATURES[f].name}: Gemma(${cfg.gemma}) 가 색칠하지 못함 — 정해 둔 순서대로 이어서 부른다:`, gemmaLast[f].error);
    }
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

module.exports = { FEATURES, GEMINI_MODEL, GEMMA_MODELS, GEMMA_FEATURES, GEMMA_OK, ATTEMPT_CHOICES, BRIEFING_ATTEMPTS, BRIEFING_GEMINI_MODELS, getConfig, setConfig, choices, call, callGemma, looseJson, gemmaStatus, tryModel, normFeature, briefingChain, FILE };
