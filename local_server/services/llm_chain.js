/**
 * ============================================================================
 * 파일명: services/llm_chain.js
 * 역할: 나리야 답변 AI 를 관리자 센터에서 정한 순서대로 시도하는 「자동 전환 사슬」.
 *       기본 순서: 업스테이지 → 클로드 키2 → 클로드 키1 → ChatGPT(VM) → Gemini (클로드는 키2 먼저 — 2026-11-02 사용자 확정).
 *       앞의 AI 가 **크레딧 소진**이면 그 AI 를 계속 건너뛴다(관리자가 「소진 해제」를 누를 때까지 — 서버를 다시 켜도 유지).
 *       그 밖의 일시 오류(시간초과·서버 오류)는 **그 호출 하나만** 다음 AI 가 대신 답한다.
 *       ChatGPT 칸만은 한도 소진을 알아볼 수 없어 **연속 3번 실패하면 30분 쉰다**(2026-11-02 사용자 확정).
 *       소진 표시·ChatGPT 쉼은 볼륨 파일(data/llm_chain_state.json)에 남겨 재시작 뒤에도 이어진다(2026-11-02 사용자 확정).
 *       답변 합성(스트림)은 callStream 이 조각을 흘린다 — 첫 조각 전 실패만 다음 AI 로 넘긴다.
 * ============================================================================
 * [사용자 확정 2026-11-02] 범위는 ChatGPT(codex)와 같다(/api/legal/ask). 순서는 관리자 센터에서 바꾼다.
 *   「넘어가는 조건」은 크레딧이 다 떨어졌을 때.
 *   관리자 센터 [삭제]로 뺀 AI(providerRemoved)는 시도하지 않는다 — Gemini 는 뺄 수 없다(2026-11-02 사용자 요청).
 *   관리자 센터 「AI 모델」 탭에서 칸마다 모델·노력(effort)을 고른다(providerModels — 2026-11-02 사용자 요청, CHOICES 참고).
 *
 * [연계]
 *   - 사용 파일 : services/codex_bridge.js (요청 범위 ALS·VM 작업자 호출), services/atomic_write.js, @anthropic-ai/sdk
 *                 data/llm_chain_state.json (소진·쉼 저장 — fly.toml 볼륨 /app/local_server/data)
 *   - 서버 API  : Claude Messages API(기본 claude-sonnet-5-5, effort medium) · Upstage chat/completions(기본 solar-pro4, reasoning_effort medium)
 *                 — 둘 다 관리자 설정 providerModels 로 바꿀 수 있다(CHOICES 안에서만).
 *   - 호출처    : services/gemini_client.js callGeminiRaw(→callRaw)/callGeminiStream(→callStream) 입구(사슬 표시가 있는 요청일 때)
 *                 routes/legal.js normConfig(providerOrder·providerRemoved·providerModels)·POST /api/legal/config(providerReset)
 *                 services/codex_bridge.js answerLabel(이 파일이 적은 s.usedModel 로 답변 끝 모델 이름)
 *   - 환경변수  : ANTHROPIC_API_KEY_1 · ANTHROPIC_API_KEY_2 · UPSTAGE_API_KEY (Fly.io 시크릿)
 *                 LLM_CHAIN_STATE_FILE (저장 파일 경로 바꾸기 — 시험이 운영 data 파일을 건드리지 않게 임시 폴더로 돌린다)
 * [로드 순서] 서버 모듈 — require 순서 무관(codex_bridge 를 부르지만 codex_bridge 는 이 파일을 부르지 않는다).
 */

const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const codexBridge = require('./codex_bridge');
const { writeFileAtomic } = require('./atomic_write');

const PROVIDERS = ['upstage', 'claude1', 'claude2', 'chatgpt', 'gemini'];
const DEFAULT_ORDER = ['upstage', 'claude2', 'claude1', 'chatgpt', 'gemini'];   // 사용자 확정: ANTHROPIC_API_KEY_2 먼저, _1 나중
const NAMES = { upstage: '업스테이지', claude1: '클로드 키1', claude2: '클로드 키2', chatgpt: 'ChatGPT(VM)', gemini: 'Gemini' };
const CLAUDE_MODEL = 'claude-sonnet-5-5';
const UPSTAGE_MODEL = 'solar-pro4';
// 칸마다 고를 수 있는 모델·노력(2026-11-02 사용자 요청 — 관리자 센터 「AI 모델」 탭). 첫 칸이 아니라 model·effort 가 기본값.
//   클로드: 세 모델 모두 effort low~max 다섯 단계 지원(claude-api 스킬 shared/model-migration.md — Sonnet 5.5·Opus 5.5·Haiku 5.5 절,
//           설치된 @anthropic-ai/sdk 1.3.0 OutputConfig.effort 타입도 같은 다섯 값). 그래서 모델별 제한은 없다.
//   업스테이지: solar-pro4·solar-mini4 둘 다 reasoning_effort 지원(console.upstage.ai/docs/capabilities/reasoning —
//           「solar-mini4 follows the same rules as solar-pro4」, none·minimal=끔, low~max=켬). 사용자가 제안한 none·low·medium·high 만 연다.
//   ChatGPT: VM 작업자(scripts/codex_worker.js)는 `codex exec -m <모델>` 만 넘기고 노력 값은 넘기지 않는다 → 노력 선택 없음(efforts 빈 배열).
//           모델 목록은 codex_bridge.ANSWER_MODELS 에서 'gemini' 를 뺀 것.
//   Gemini: 여기서 고르지 않는다(legal_retriever.ANSWER_MODEL 고정, 사고량은 호출마다 *_CONFIG 가 정한다) — 화면에는 표시만.
const CHOICES = {
  claude: { models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'], efforts: ['low', 'medium', 'high', 'xhigh', 'max'], model: CLAUDE_MODEL, effort: 'medium' },
  upstage: { models: ['solar-pro4', 'solar-mini4'], efforts: ['none', 'low', 'medium', 'high'], model: UPSTAGE_MODEL, effort: 'medium' },
  chatgpt: { models: codexBridge.ANSWER_MODELS.filter(m => m !== 'gemini'), efforts: [], model: codexBridge.DEFAULT_MODEL, effort: null },
};
const CHOICE_OF = { claude1: 'claude', claude2: 'claude', upstage: 'upstage', chatgpt: 'chatgpt' };
const UPSTAGE_URL = 'https://api.upstage.ai/v1/chat/completions';
const CALL_TIMEOUT_MS = 120 * 1000;
const JSON_RULE = 'Respond with a single valid JSON value only. No code fences, no extra text.';
// ChatGPT 칸 쉼(사용자 확정 2026-11-02) — VM 작업자는 종료코드·시간초과 문구만 줘서 한도 소진을 알아볼 수 없다.
//   그래서 사슬 안 ChatGPT 호출이 연속 CHATGPT_FAIL_LIMIT 번 실패하면 CHATGPT_REST_MS 동안 건너뛴다(지나면 자동 재시도).
//   없으면: 한도가 다 찬 동안 질문마다 ChatGPT 칸이 최대 300초를 기다린 뒤에야 다음 AI 로 넘어간다.
const CHATGPT_FAIL_LIMIT = 3;
const CHATGPT_REST_MS = 30 * 60 * 1000;

const env = (k) => String(process.env[k] || '').trim();
const KEYS = { claude1: env('ANTHROPIC_API_KEY_1'), claude2: env('ANTHROPIC_API_KEY_2'), upstage: env('UPSTAGE_API_KEY') };
console.log('[LLM 사슬] 키 — ' + ['ANTHROPIC_API_KEY_1', 'ANTHROPIC_API_KEY_2', 'UPSTAGE_API_KEY']
  .map(k => `${k}:${env(k) ? '있음' : '없음'}`).join(' · '));

// 크레딧 소진 표시. id → { at, error }. 「소진 해제」로 비워진다. 재시작 뒤에도 STATE_FILE 에서 되살린다.
const exhausted = {};
// ChatGPT 칸 연속 실패 수·쉼 끝 시각(ms, 0 = 안 쉼). 「소진 해제」로 비워진다.
//   until 만 STATE_FILE 에 남긴다 — fails 는 쉼 시작·해제 때 늘 0 이 되므로 저장하는 순간의 값이 의미 없다(재시작하면 0 부터).
const chatgptRest = { fails: 0, until: 0 };

// 소진·쉼 저장 파일(2026-11-02 사용자 확정) — 볼륨(DATA_DIR = local_server/data, fly.toml [[mounts]])에 둔다.
//   경로는 config/server_config.js 의 DATA_DIR 와 같은 식 — 그 모듈은 express 앱을 만들고 폴더를 만들어서 여기서 부르지 않는다.
//   없으면: 배포·재시작 때마다 소진된 AI 를 질문마다 다시 불러 보고(실패 기다림), 소진 푸시가 또 간다.
const STATE_FILE = env('LLM_CHAIN_STATE_FILE') || path.join(__dirname, '..', 'data', 'llm_chain_state.json');

/**
 * 저장 파일에서 소진·쉼을 되살린다(모듈 로드 때 1번). 파일 없음 → 빈 상태. 읽기 실패·손상 → 빈 상태 + 로그.
 * 모양이 틀린 칸은 버린다. 지난 쉼(until ≤ 지금)은 무시.
 * 예: {"exhausted":{"claude1":{"at":"2026-11-02T01:00:00Z","error":"…"}},"chatgptRest":{"until":1762000000000}}
 * [연계] ← 이 파일 로드 시. saveState 가 쓴 것을 읽는다.
 */
function loadState() {
  let j;
  try {
    j = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`[LLM 사슬] 상태 파일 읽기 실패 → 빈 상태로 시작 file=${STATE_FILE} err=${String(e.message || e).slice(0, 200)}`);
    return;
  }
  if (!j || typeof j !== 'object') { console.error(`[LLM 사슬] 상태 파일 모양이 틀림 → 빈 상태로 시작 file=${STATE_FILE}`); return; }
  const ex = j.exhausted && typeof j.exhausted === 'object' ? j.exhausted : {};
  for (const id of PROVIDERS) {
    const v = ex[id];
    if (v && typeof v.at === 'string') exhausted[id] = { at: v.at, error: String(v.error || '').slice(0, 200) };
  }
  const until = Number(j.chatgptRest && j.chatgptRest.until);
  if (until > Date.now()) chatgptRest.until = until;
  const names = Object.keys(exhausted).map(id => NAMES[id]);
  if (names.length || chatgptRest.until) console.log(`[LLM 사슬] 저장된 상태 — 소진: ${names.join(', ') || '없음'} · ChatGPT 쉼: ${chatgptRest.until ? new Date(chatgptRest.until + 9 * 3600000).toISOString().slice(11, 16) + ' KST 까지' : '없음'}`);
}

/**
 * 소진·쉼을 저장 파일에 원자적으로 쓴다(상태가 바뀔 때만 부른다 — 소진 표시·해제·쉼 시작). 실패하면 로그만(메모리 상태는 그대로 쓴다).
 * [연계] ← markExhausted·countChatgpt(쉼 시작)·resetExhausted. → atomic_write.writeFileAtomic.
 */
function saveState() {
  try {
    writeFileAtomic(STATE_FILE, JSON.stringify({ exhausted, chatgptRest: { until: chatgptRest.until }, savedAt: new Date().toISOString() }, null, 1));
  } catch (e) {
    console.error(`[LLM 사슬] 상태 파일 쓰기 실패(메모리 상태로 계속) file=${STATE_FILE} err=${String(e.message || e).slice(0, 200)}`);
  }
}
loadState();
// 오늘(KST) 호출 집계 — 관리자 화면 표시용. id → { calls, success, fail }
let stats = null;
function _stats() {
  const d = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  if (!stats || stats.date !== d) stats = { date: d, by: {} };
  return stats;
}
function bump(id, field) {
  const s = _stats();
  const b = s.by[id] || (s.by[id] = { calls: 0, success: 0, fail: 0 });
  b[field]++;
}

/**
 * 관리자 설정의 순서를 검사한다 — 다섯 개를 빠짐없이 한 번씩 담은 배열만 받는다. 아니면 기본 순서.
 * 예: normOrder(['gemini','upstage','claude1','claude2','chatgpt']) → 그대로 / normOrder('x') → DEFAULT_ORDER
 * @param {any} o @returns {string[]}
 * [연계] ← routes/legal.js normConfig·POST /api/legal/config 검사.
 */
function normOrder(o) {
  return isValidOrder(o) ? o.slice() : DEFAULT_ORDER.slice();
}
/** @param {any} o @returns {boolean} 다섯 개 id 의 순열인가 */
function isValidOrder(o) {
  return Array.isArray(o) && o.length === PROVIDERS.length && PROVIDERS.every(p => o.includes(p));
}

/**
 * 관리자 센터에서 [삭제]한 AI 목록(providerRemoved)을 검사한다 — PROVIDERS 의 id 를 겹치지 않게 담은 배열, 'gemini' 는 안 된다
 * (Gemini 는 마지막 안전망 — 2026-11-02 사용자 확정). 빈 배열은 「삭제된 AI 없음」.
 * 순서(providerOrder)는 다섯 개 순열 그대로 두고, 사슬이 이 목록의 AI 를 건너뛴다(usable) — 기존 저장값·순서 검사가 안 바뀌게.
 * 예: isValidRemoved(['claude1']) → true / isValidRemoved(['gemini']) → false / isValidRemoved(['x']) → false
 * @param {any} r @returns {boolean}
 * [연계] ← routes/legal.js POST /api/legal/config 검사(틀리면 400). normRemoved 도 같은 기준.
 */
function isValidRemoved(r) {
  return Array.isArray(r) && r.every((id, i) => PROVIDERS.includes(id) && id !== 'gemini' && r.indexOf(id) === i);
}
/**
 * 저장값용 — 맞으면 그대로(복사), 틀리거나 없으면 [](아무것도 안 뺀다 — 이 필드가 없던 옛 저장값과 같은 동작).
 * 예: normRemoved(undefined) → [] / normRemoved(['upstage']) → ['upstage'] / normRemoved(['gemini']) → []
 * @param {any} r @returns {string[]}
 * [연계] ← routes/legal.js normConfig.
 */
function normRemoved(r) {
  return isValidRemoved(r) ? r.slice() : [];
}

/**
 * 칸 하나의 모델·노력 값이 CHOICES 안에 있는가. ChatGPT 칸은 노력이 없어야 한다(없음·null 만).
 * 예: isValidPick('claude1', {model:'claude-opus-5-5', effort:'high'}) → true / isValidPick('upstage', {model:'solar-pro4', effort:'max'}) → false
 * @param {string} id @param {any} v @returns {boolean}
 * [연계] ← isValidModels·normModels.
 */
function isValidPick(id, v) {
  const c = CHOICES[CHOICE_OF[id]];
  if (!c || !v || typeof v !== 'object' || Array.isArray(v) || !c.models.includes(v.model)) return false;
  return c.efforts.length ? c.efforts.includes(v.effort) : (v.effort === undefined || v.effort === null);
}
/**
 * POST /api/legal/config 의 providerModels 검사 — 객체, 키는 claude1·claude2·upstage·chatgpt 중(일부만 와도 된다),
 * 값은 칸마다 {model, effort}(ChatGPT 는 {model}). Gemini·모르는 키·목록 밖 값은 거절.
 * 예: isValidModels({ claude1: { model: 'claude-opus-5-5', effort: 'max' } }) → true / isValidModels({ gemini: {…} }) → false
 * @param {any} pm @returns {boolean}
 * [연계] ← routes/legal.js POST /api/legal/config(틀리면 400).
 */
function isValidModels(pm) {
  return !!pm && typeof pm === 'object' && !Array.isArray(pm) && Object.keys(pm).every(id => isValidPick(id, pm[id]));
}
/**
 * 저장값용 — 네 칸을 다 채운 객체를 돌려준다. 칸마다 맞으면 그 값, 아니면 기본값(CHOICES).
 * ChatGPT 칸은 옛 저장값 answerModel 과 호환: providerModels.chatgpt 가 없으면 answerModel(‘gemini’ 면 기본 Luna).
 * 예: normModels(undefined, 'gpt-6-sol') → { claude1:{model:'claude-sonnet-5-5',effort:'medium'}, …, chatgpt:{model:'gpt-6-sol',effort:null} }
 * @param {any} pm - 설정의 providerModels @param {string} [answerModel] - 옛 설정값
 * @returns {{claude1:{model:string,effort:string}, claude2:{model:string,effort:string}, upstage:{model:string,effort:string}, chatgpt:{model:string,effort:null}}}
 * [연계] ← routes/legal.js normConfig · 이 파일 pickOf(요청 범위 s.models).
 */
function normModels(pm, answerModel) {
  const src = pm && typeof pm === 'object' && !Array.isArray(pm) ? pm : {};
  const out = {};
  for (const id of Object.keys(CHOICE_OF)) {
    const c = CHOICES[CHOICE_OF[id]];
    out[id] = isValidPick(id, src[id]) ? { model: src[id].model, effort: c.efforts.length ? src[id].effort : null } : { model: c.model, effort: c.effort };
  }
  if (!isValidPick('chatgpt', src.chatgpt) && CHOICES.chatgpt.models.includes(answerModel)) out.chatgpt.model = answerModel;
  return out;
}
/**
 * 관리자 화면용 선택지 — CHOICES 를 칸 id 별로 펼치고 Gemini 칸(표시만)을 붙인다.
 * @param {string} geminiModel - legal_retriever.ANSWER_MODEL @returns {object}
 * [연계] ← routes/legal.js GET·POST /api/legal/config(관리자 응답 providerChoices). → ai_chat.js paintOrderList.
 */
function choices(geminiModel) {
  const out = {};
  for (const id of Object.keys(CHOICE_OF)) {
    const c = CHOICES[CHOICE_OF[id]];
    out[id] = { models: c.models.slice(), efforts: c.efforts.slice(), model: c.model, effort: c.effort };
  }
  out.gemini = { models: [String(geminiModel || '')], efforts: [], model: String(geminiModel || ''), effort: null };
  return out;
}
/** 이 요청에서 그 칸이 쓸 모델·노력(요청 범위 s.models — codexBridge.withRequest 가 넣는다). [연계] ← callRaw·callStream */
function pickOf(id, s) {
  return normModels(s && s.models)[id];
}

/** 지금 이 호출이 사슬 표시가 있는 요청 안인가. [연계] ← gemini_client.js 입구 */
function active() {
  const s = codexBridge.store();
  return !!(s && s.chain);
}

/** 프롬프트를 문자열로(codex_bridge 와 같은 규칙). */
function promptText(contents) {
  return typeof contents === 'string' ? contents : JSON.stringify(contents);
}
const wantsJson = (config) => !!(config && config.responseMimeType === 'application/json');

/**
 * 이 호출의 시간 한도(ms). 호출 config.httpOptions.timeout 이 있으면 그것과 120초 중 짧은 쪽.
 * 왜: legal_retriever.js 의 질문확장·되묻기 등 *_CONFIG 가 10~15초를 준다 — 그 호출이 사슬에서 120초를 기다리면 안 된다.
 * 예: callTimeout({ httpOptions:{ timeout:15000 } }) → 15000 / callTimeout({}) → 120000
 * @param {object} [config] @returns {number}
 * [연계] ← callClaude·callUpstage. ChatGPT 칸(codexBridge.callRaw)은 따로 정한 300초를 쓴다.
 */
function callTimeout(config) {
  const t = Number(config && config.httpOptions && config.httpOptions.timeout);
  return t > 0 ? Math.min(t, CALL_TIMEOUT_MS) : CALL_TIMEOUT_MS;
}

/**
 * 이 AI 를 이번 호출에 쓸 수 있는가(관리자가 삭제 안 함 · 키 있음 · 소진 아님 · ChatGPT 는 작업자 연결 + 모델 지정).
 * @param {string} id @param {object} s - 요청 범위 저장소(s.removed = 관리자 센터 [삭제] 목록, codexBridge.withRequest 가 넣는다) @returns {boolean}
 */
function usable(id, s) {
  if (s && Array.isArray(s.removed) && s.removed.includes(id)) return false;   // 관리자 센터에서 [삭제] — 시도하지 않는다
  if (exhausted[id]) return false;
  if (id === 'chatgpt' && Date.now() < chatgptRest.until) return false;   // 연속 실패로 쉬는 중
  if (id === 'claude1' || id === 'claude2' || id === 'upstage') return !!KEYS[id];
  if (id === 'chatgpt') return !!(s && s.model) && codexBridge.ENABLED && codexBridge.workerAlive();
  return id === 'gemini';
}

/**
 * Claude 호출. 크레딧 소진은 402 billing_error(Anthropic 오류표 기준) + 400 invalid_request_error 중 「credit balance」 문구.
 * @returns {Promise<{success:boolean, text?:string, error?:string, creditOut?:boolean}>}
 */
async function callClaude(apiKey, { contents, config }, pick) {
  const p = pick || { model: CLAUDE_MODEL, effort: 'medium' };
  const timeout = callTimeout(config);
  // 짧은 한도(호출이 httpOptions.timeout 을 준 경우)면 SDK 재시도를 끈다(maxRetries 0).
  //   재시도 1회면 시간초과 때 한도 × 2 + 대기만큼 걸려 호출이 정한 한도를 넘는다. 재시도 몫은 사슬의 다음 AI 가 맡는다.
  //   한도를 안 준 긴 호출(120초)은 종전대로 1회 재시도.
  const maxRetries = timeout < CALL_TIMEOUT_MS ? 0 : 1;
  // baseURL·authToken 을 못박는다 — 서버에 ANTHROPIC_BASE_URL·ANTHROPIC_AUTH_TOKEN 이 따로 있어도 키가 딴 곳으로 가지 않게.
  const client = new Anthropic({ apiKey, authToken: null, baseURL: 'https://api.anthropic.com', maxRetries, timeout });
  try {
    const msg = await client.messages.create({
      model: p.model,
      max_tokens: claudeMaxTokens(p.effort),
      output_config: { effort: p.effort },
      ...(wantsJson(config) ? { system: JSON_RULE } : {}),
      messages: [{ role: 'user', content: promptText(contents) }],
    });
    if (msg.stop_reason === 'refusal') return { success: false, error: 'Claude 답변 거절(refusal)' };
    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
    if (!text.trim()) return { success: false, error: 'Claude 빈 응답' };
    return { success: true, text };
  } catch (e) {
    return { success: false, error: `Claude ${e.status || ''} ${String(e.message || e).slice(0, 200)}`, creditOut: claudeCreditOut(e) };
  }
}

/**
 * Claude max_tokens — effort xhigh·max 면 64000, 아니면 종전 16000.
 * 왜: claude-api 스킬 shared/model-migration.md 체크리스트 「[BLOCKS] At output_config.effort of xhigh or max: set max_tokens >= 64000
 *   (otherwise output truncates mid-thought)」. max_tokens 는 생각+답 합계 상한이라 높은 노력에서 16000 이면 답이 잘릴 수 있다.
 *   클라이언트에 timeout 을 직접 주므로 SDK 의 「10분 넘을 수 있으면 스트림 필수」 검사(_calculateNonstreamingTimeout)는 타지 않는다.
 * @param {string} effort @returns {number}
 * [연계] ← callClaude·streamClaude.
 */
function claudeMaxTokens(effort) {
  return effort === 'xhigh' || effort === 'max' ? 64000 : 16000;
}

/**
 * Claude 오류가 크레딧 소진인가. 402 billing_error(Anthropic 오류표 기준)
 * + 400 invalid_request_error 중 「credit balance」(예: "Your credit balance is too low …")도 소진으로 본다 — 옛 응답 형태 대비.
 *   ⚠이 400 형태는 실호출로 확인하지 않았다(오류표의 402 billing_error 만 문서 기준). 문구가 바뀌면 일시 오류로 처리된다.
 * @param {any} e @returns {boolean}
 * [연계] ← callClaude·streamClaude(같은 판정을 쓰려고 뺐다).
 */
function claudeCreditOut(e) {
  return e instanceof Anthropic.APIError && (e.status === 402 || e.type === 'billing_error'
    || (e.status === 400 && e.type === 'invalid_request_error' && /credit balance/i.test(String(e.message || ''))));
}

// 업스테이지 오류표(console.upstage.ai/docs/resources/error-codes)에서 「크레딧·결제·한도 소진」인 코드.
//   429 too_many_requests(분당 한도)는 소진이 아니다 — 이번 호출만 넘긴다.
const UPSTAGE_CREDIT_CODES = ['api_key_is_blocked', 'api_key_is_not_allowed', 'studio_subscription_quota_exceeded', 'usage_limit_exceeded'];

/** 업스테이지 호출(OpenAI 호환 chat/completions). @returns 위 callClaude 와 같은 모양 */
async function callUpstage(apiKey, { contents, config }, pick) {
  const p = pick || { model: UPSTAGE_MODEL, effort: 'medium' };
  try {
    const messages = [];
    if (wantsJson(config)) messages.push({ role: 'system', content: JSON_RULE });
    messages.push({ role: 'user', content: promptText(contents) });
    const res = await fetch(UPSTAGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: p.model, messages, reasoning_effort: p.effort }),
      signal: AbortSignal.timeout(callTimeout(config)),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const code = String((body && ((body.error && body.error.code) || body.code)) || '');
      return { success: false, error: `Upstage ${res.status} ${code}`.trim(), creditOut: UPSTAGE_CREDIT_CODES.includes(code) };
    }
    const text = body && body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
    if (!text || !String(text).trim()) return { success: false, error: 'Upstage 빈 응답' };
    return { success: true, text: String(text) };
  } catch (e) {
    return { success: false, error: `Upstage ${String(e.message || e).slice(0, 200)}` };
  }
}

/** 실패를 사슬에 넘기는 오류 — 메시지는 「AI 이름 + 원인」, creditOut 이면 소진으로 표시된다. */
function chainError(message, creditOut) {
  const e = new Error(message);
  e.creditOut = !!creditOut;
  return e;
}

/**
 * 첫 조각 시간 한도 — callTimeout(config) 안에 첫 조각이 안 오면 요청을 끊는다. 첫 조각이 오면 clear() 로 푼다.
 * 왜: 스트림은 응답 머리(헤더)가 곧바로 오고 글은 그 뒤에 온다. Claude SDK 의 timeout 은 헤더까지만 재고,
 *   업스테이지의 AbortSignal.timeout 은 거꾸로 긴 답을 중간에 끊는다. 「다음 AI 로 넘길 수 있는 동안」만 재면 둘 다 맞다.
 * @param {number} ms @returns {{signal:AbortSignal, clear:Function, fired:Function}}
 * [연계] ← streamClaude·streamUpstage.
 */
function firstChunkTimer(ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new Error(`첫 조각 시간초과 ${ms}ms`)), ms);
  return { signal: ac.signal, clear: () => clearTimeout(t), fired: () => ac.signal.aborted };
}

/**
 * Claude 스트림 — SDK messages.create({ stream:true })의 text_delta 를 조각으로 흘린다.
 * 실패는 chainError 로 던진다(크레딧 판정은 callClaude 와 같은 claudeCreditOut). 거절(refusal)·빈 응답도 실패.
 * 예: for await (const t of streamClaude(KEYS.claude2, { contents:'…', config:{} })) …  → '가', '나', …
 * [연계] ← callStream. 요청 모양(모델·effort·JSON 규칙·baseURL 고정·재시도)은 callClaude 와 같다.
 */
async function* streamClaude(apiKey, { contents, config }, pick) {
  const p = pick || { model: CLAUDE_MODEL, effort: 'medium' };
  const timeout = callTimeout(config);
  const maxRetries = timeout < CALL_TIMEOUT_MS ? 0 : 1;
  const client = new Anthropic({ apiKey, authToken: null, baseURL: 'https://api.anthropic.com', maxRetries, timeout });
  const timer = firstChunkTimer(timeout);
  let got = false;
  try {
    const stream = await client.messages.create({
      model: p.model,
      max_tokens: claudeMaxTokens(p.effort),
      output_config: { effort: p.effort },
      ...(wantsJson(config) ? { system: JSON_RULE } : {}),
      messages: [{ role: 'user', content: promptText(contents) }],
      stream: true,
    }, { signal: timer.signal });
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta' && ev.delta.text) {
        if (!got) { got = true; timer.clear(); }
        yield ev.delta.text;
      } else if (ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason === 'refusal') {
        throw chainError('Claude 답변 거절(refusal)');
      }
    }
  } catch (e) {
    if (e.creditOut !== undefined) throw e;   // 위에서 만든 chainError
    throw chainError(`Claude ${e.status || ''} ${String(e.message || e).slice(0, 200)}`, claudeCreditOut(e));
  } finally {
    timer.clear();
  }
  // SDK 스트림은 끊김(abort)을 오류 없이 조용히 끝낸다 — 그래서 조각이 하나도 없으면 여기서 실패로 만든다.
  if (!got) throw chainError(timer.fired() ? `Claude 첫 조각 시간초과 ${timeout}ms` : 'Claude 빈 응답');
}

/**
 * 업스테이지 스트림 — chat/completions 에 stream:true, SSE 의 `data: {choices[0].delta.content}` 를 흘린다(`data: [DONE]` 에서 끝).
 * HTTP 오류의 크레딧 판정은 callUpstage 와 같은 UPSTAGE_CREDIT_CODES. 스트림 안의 `{error}` 도 실패.
 * ⚠스트림 응답 모양은 OpenAI 호환 규약 기준이다 — 업스테이지 실호출로 확인하지 않았다.
 * [연계] ← callStream.
 */
async function* streamUpstage(apiKey, { contents, config }, pick) {
  const p = pick || { model: UPSTAGE_MODEL, effort: 'medium' };
  const ms = callTimeout(config);
  const timer = firstChunkTimer(ms);
  let got = false;
  try {
    const messages = [];
    if (wantsJson(config)) messages.push({ role: 'system', content: JSON_RULE });
    messages.push({ role: 'user', content: promptText(contents) });
    const res = await fetch(UPSTAGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: p.model, messages, reasoning_effort: p.effort, stream: true }),
      signal: timer.signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const code = String((body && ((body.error && body.error.code) || body.code)) || '');
      throw chainError(`Upstage ${res.status} ${code}`.trim(), UPSTAGE_CREDIT_CODES.includes(code));
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    read: for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') break read;
        let j;
        try { j = JSON.parse(data); } catch (_) { continue; }
        if (j && j.error) throw chainError(`Upstage 스트림 오류 ${String(j.error.code || j.error.message || '').slice(0, 200)}`, UPSTAGE_CREDIT_CODES.includes(String(j.error.code || '')));
        const t = j && j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
        if (t) {
          if (!got) { got = true; timer.clear(); }
          yield String(t);
        }
      }
    }
  } catch (e) {
    if (e.creditOut !== undefined) throw e;
    throw chainError(`Upstage ${String(e.message || e).slice(0, 200)}`);
  } finally {
    timer.clear();
  }
  if (!got) throw chainError(timer.fired() ? `Upstage 첫 조각 시간초과 ${ms}ms` : 'Upstage 빈 응답');
}

/**
 * 사슬 호출 — gemini_client.callGeminiRaw 와 **같은 반환 모양**.
 * 순서대로: 쓸 수 없는 AI(키 없음·소진·작업자 없음)는 건너뛰고, 실패하면 다음으로. 성공하면 그 AI 를 기록(답변 끝 표시용).
 * 예: callRaw({ model:'gemini-2.5-flash', contents:'…', config:{}, caller:'Legal-Ask' }, geminiDirect)
 *     → { success:true, response:{ text:'…' }, error:null, isRateLimited:false, keyLabel:'claude1' }
 * @param {{model:string, contents:any, config?:object, caller?:string}} args
 * @param {Function} geminiDirect - gemini_client 의 원래 Gemini 호출(사슬을 다시 타지 않는 것)
 * [연계] ← gemini_client.js callGeminiRaw. → callClaude·callUpstage·codexBridge.callRaw·geminiDirect.
 */
async function callRaw(args, geminiDirect) {
  const { contents, config, caller = 'unknown' } = args;
  const s = codexBridge.store() || {};
  const order = normOrder(s.order);
  const errs = [];
  for (const id of order) {
    if (!usable(id, s)) continue;
    bump(id, 'calls');
    let r;
    if (id === 'claude1' || id === 'claude2') r = await callClaude(KEYS[id], args, pickOf(id, s));
    else if (id === 'upstage') r = await callUpstage(KEYS[id], args, pickOf(id, s));
    else {
      const g = id === 'chatgpt'
        ? await codexBridge.callRaw({ contents, config, caller, model: s.model })
        : await geminiDirect(args);
      let text = null;
      try { text = g.success ? g.response.text : null; } catch (_) { text = null; }
      r = g.success && text ? { success: true, text, raw: g } : { success: false, error: `${NAMES[id]} ${g.error || '빈 응답'}` };
    }
    if (id === 'chatgpt') countChatgpt(r.success);
    if (r.success) {
      bump(id, 'success');
      s.used = id;
      s.usedModel = usedModelOf(id, s, args);
      if (errs.length) console.warn(`[LLM 사슬] ${NAMES[id]} 가 대신 답함 caller=${caller} 앞선 실패: ${errs.join(' | ')}`);
      const text = wantsJson(config) && id !== 'gemini' ? codexBridge.stripFence(r.text) : r.text;
      return r.raw && id === 'gemini'
        ? Object.assign({}, r.raw, { keyLabel: id })
        : { success: true, response: { text }, error: null, isRateLimited: false, keyLabel: id };
    }
    bump(id, 'fail');
    errs.push(r.error);
    console.error(`[LLM 사슬] ${NAMES[id]} 실패 caller=${caller} creditOut=${!!r.creditOut} err=${r.error}`);
    if (r.creditOut) markExhausted(id, r.error);
  }
  return { success: false, response: null, error: errs.join(' | ') || '사용 가능한 답변 AI 없음', isRateLimited: false, keyLabel: 'chain' };
}

/**
 * 사슬 스트림(비동기 제너레이터) — gemini_client.callGeminiStream 과 **같은 약속**(텍스트 조각을 yield, 실패는 throw).
 * 순서·건너뛰기·크레딧 소진 표시·ChatGPT 연속 실패 수·시간 한도는 callRaw 와 같다. 다른 점:
 *   - Claude·업스테이지·Gemini 는 조각을 오는 대로 흘린다. ChatGPT 칸은 스트림이 없어 완성본을 한 번에.
 *   - **첫 조각 전** 실패 → 다음 AI(callRaw 와 같은 규칙).
 *   - **첫 조각 뒤** 실패 → 다음으로 넘기지 않고 throw — 이미 일부가 사용자에게 갔다(기존 Gemini 스트림과 같은 관례,
 *     routes/legal.js 가 「여기까지만 받았다」로 처리).
 *   - s.used(답변 끝 AI 이름)는 **첫 조각 때** 적는다 — 중간에 끊겨도 화면에 나간 글을 쓴 AI 이름이 붙게.
 * 예: for await (const t of callStream({ model, contents, config, caller:'Legal-Ask' }, geminiStreamDirect)) res.write(t)
 * @param {{model:string, contents:any, config?:object, caller?:string}} args
 * @param {Function} geminiStream - gemini_client 의 원래 Gemini 스트림(사슬을 다시 타지 않는 것, async generator)
 * [연계] ← gemini_client.js callGeminiStream. → streamClaude·streamUpstage·codexBridge.callRaw·geminiStream.
 */
async function* callStream(args, geminiStream) {
  const { contents, config, caller = 'unknown' } = args;
  const s = codexBridge.store() || {};
  const order = normOrder(s.order);
  const errs = [];
  for (const id of order) {
    if (!usable(id, s)) continue;
    bump(id, 'calls');
    let started = false;
    try {
      const gen = id === 'claude1' || id === 'claude2' ? streamClaude(KEYS[id], args, pickOf(id, s))
        : id === 'upstage' ? streamUpstage(KEYS[id], args, pickOf(id, s))
        : id === 'chatgpt' ? chatgptOnce({ contents, config, caller, model: s.model })
        : geminiStream(args);
      for await (const t of gen) {
        if (!started) {
          started = true;
          s.used = id;
          s.usedModel = usedModelOf(id, s, args);
          if (errs.length) console.warn(`[LLM 사슬] ${NAMES[id]} 가 대신 답함(스트림) caller=${caller} 앞선 실패: ${errs.join(' | ')}`);
        }
        yield t;
      }
      if (!started) throw chainError(`${NAMES[id]} 빈 응답`);
    } catch (e) {
      bump(id, 'fail');
      const error = id === 'gemini' ? `${NAMES.gemini} ${String(e.message || e)}` : String(e.message || e);
      console.error(`[LLM 사슬] ${NAMES[id]} 스트림 실패 caller=${caller} 첫조각뒤=${started} creditOut=${!!e.creditOut} err=${error}`);
      if (started) throw e;   // 이미 일부가 나갔다 — 다음 AI 로 넘기면 답이 둘로 섞인다
      if (id === 'chatgpt') countChatgpt(false);
      errs.push(error);
      if (e.creditOut) markExhausted(id, error);
      continue;
    }
    if (id === 'chatgpt') countChatgpt(true);
    bump(id, 'success');
    return;
  }
  throw new Error(errs.join(' | ') || '사용 가능한 답변 AI 없음');
}

/**
 * 답을 쓴 칸의 실제 모델 이름(답변 끝 표시줄용 s.usedModel). ChatGPT 는 요청 범위 모델, Gemini 는 호출이 넘긴 모델.
 * 예: usedModelOf('claude2', { models:{ claude2:{ model:'claude-opus-5-5', effort:'high' } } }) → 'claude-opus-5-5'
 * [연계] ← callRaw·callStream. → codex_bridge.answerLabel 이 읽는다.
 */
function usedModelOf(id, s, args) {
  if (id === 'chatgpt') return s.model || codexBridge.DEFAULT_MODEL;
  if (id === 'gemini') return args && args.model;
  return pickOf(id, s).model;
}

/**
 * ChatGPT 칸(VM 작업자) — 스트림이 없어 완성본을 한 번 yield. 실패는 chainError(소진 판정 없음 — 연속 실패 수만 센다).
 * [연계] ← callStream. → codexBridge.callRaw(300초 한도).
 */
async function* chatgptOnce({ contents, config, caller, model }) {
  const g = await codexBridge.callRaw({ contents, config, caller, model });
  const text = g.success && g.response ? g.response.text : null;
  if (!text) throw chainError(`${NAMES.chatgpt} ${g.error || '빈 응답'}`);
  yield wantsJson(config) ? codexBridge.stripFence(text) : text;
}

/**
 * ChatGPT 칸 연속 실패를 센다. 성공이면 0, 실패가 CHATGPT_FAIL_LIMIT 번 이어지면 CHATGPT_REST_MS 쉼 + 관리자 푸시 1회.
 * 쉬는 동안 끝난 호출(쉼 직전에 이미 나가 있던 것)의 실패는 세지 않는다 — 쉼이 끝나자마자 다시 쉬지 않게.
 * 예: 실패·실패·실패 → 30분 쉼(카운터 0으로) / 실패·실패·성공 → 카운터 0
 * @param {boolean} success
 * [연계] ← callRaw·callStream(사슬 안 ChatGPT 호출 결과만). usable 이 쉼을 본다. status 가 restUntil 로 내보낸다. 쉼 시작 때 saveState.
 */
function countChatgpt(success) {
  if (success) { chatgptRest.fails = 0; return; }
  if (Date.now() < chatgptRest.until) return;
  if (++chatgptRest.fails < CHATGPT_FAIL_LIMIT) return;
  chatgptRest.fails = 0;
  chatgptRest.until = Date.now() + CHATGPT_REST_MS;
  saveState();
  const hhmm = new Date(chatgptRest.until + 9 * 3600000).toISOString().slice(11, 16);
  console.error(`[LLM 사슬] ${NAMES.chatgpt} 연속 ${CHATGPT_FAIL_LIMIT}회 실패 → ${hhmm} KST 까지 쉼`);
  try {
    const { sendAdminPush } = require('./admin_push');
    sendAdminPush(`⏸ ${NAMES.chatgpt} 연속 ${CHATGPT_FAIL_LIMIT}회 실패 — 쉼`, `${hhmm} KST 까지 다음 순서 AI 로 넘어가고, 그 뒤 자동으로 다시 시도합니다. 바로 다시 쓰려면 관리자 센터에서 「소진 해제」를 눌러 주세요.`)
      .catch(e => console.error('[LLM 사슬] 관리자 푸시 오류:', e.message));
  } catch (_) { /* 푸시 모듈 없음 — 로그만 */ }
}

/** 크레딧 소진 표시 + 저장 파일 + 관리자 푸시(그 AI 당 한 번). [연계] ← callRaw·callStream */
function markExhausted(id, error) {
  if (exhausted[id]) return;
  exhausted[id] = { at: new Date().toISOString(), error: String(error || '').slice(0, 200) };
  saveState();
  try {
    const { sendAdminPush } = require('./admin_push');
    sendAdminPush(`⛔ ${NAMES[id]} 크레딧 소진`, `나리야 답변이 다음 순서 AI 로 넘어갑니다. 충전 후 관리자 센터에서 「소진 해제」를 눌러 주세요.`)
      .catch(e => console.error('[LLM 사슬] 관리자 푸시 오류:', e.message));
  } catch (_) { /* 푸시 모듈 없음 — 로그만 */ }
}

/**
 * 소진 해제 값이 유효한가(PROVIDERS 중 하나 또는 'all'). 검사만 하고 지우지 않는다.
 * [연계] ← routes/legal.js POST /api/legal/config — 다른 검사가 다 통과한 뒤에만 resetExhausted 를 부르려고 먼저 검사한다.
 * @param {any} id @returns {boolean}
 */
function isValidReset(id) {
  return id === 'all' || PROVIDERS.includes(id);
}

/**
 * 소진 표시를 지운다(chatgpt·all 이면 ChatGPT 칸 쉼·연속 실패 수도). 저장 파일에도 반영한다. @param {string} id - PROVIDERS 중 하나 또는 'all' @returns {boolean} 받은 값이 유효했나
 * [연계] ← routes/legal.js POST /api/legal/config { providerReset }
 */
function resetExhausted(id) {
  if (id !== 'all' && !PROVIDERS.includes(id)) return false;
  if (id === 'all' || id === 'chatgpt') { chatgptRest.fails = 0; chatgptRest.until = 0; }
  if (id === 'all') PROVIDERS.forEach(p => delete exhausted[p]);
  else delete exhausted[id];
  saveState();
  return true;
}

/**
 * 관리자 화면용 상태 — 키 유무(값은 내보내지 않는다)·삭제 여부·소진 여부·쉼 끝 시각(ChatGPT 만, 안 쉬면 null)·오늘 호출 수
 *   · ChatGPT 칸만 workerAlive(VM 작업자가 최근 90초 안에 왔나 — 아니면 사슬이 건너뛴다, usable 과 같은 판정).
 * 예: status(['claude1']) → [{ id:'upstage', removed:false, … }, { id:'claude1', removed:true, … }, …]
 * @param {string[]} [removed] - 설정의 providerRemoved(normConfig 결과). 없으면 아무것도 삭제 안 된 것으로.
 * @returns {Array<{id,name,hasKey,removed,exhaustedAt,restUntil,today,workerAlive?}>}
 * [연계] ← routes/legal.js GET·POST /api/legal/config
 */
function status(removed) {
  const s = _stats();
  return PROVIDERS.map(id => ({
    id, name: NAMES[id],
    removed: Array.isArray(removed) && removed.includes(id),
    hasKey: id === 'chatgpt' ? !!codexBridge.ENABLED : id === 'gemini' ? true : !!KEYS[id],
    exhaustedAt: exhausted[id] ? exhausted[id].at : null,
    restUntil: id === 'chatgpt' && Date.now() < chatgptRest.until ? new Date(chatgptRest.until).toISOString() : null,
    today: s.by[id] || { calls: 0, success: 0, fail: 0 },
    ...(id === 'chatgpt' ? { workerAlive: codexBridge.workerAlive() } : {}),
  }));
}

module.exports = { PROVIDERS, DEFAULT_ORDER, NAMES, CLAUDE_MODEL, UPSTAGE_MODEL, CHOICES, normOrder, isValidOrder, normRemoved, isValidRemoved, isValidModels, normModels, choices, active, callRaw, callStream, isValidReset, resetExhausted, status };
