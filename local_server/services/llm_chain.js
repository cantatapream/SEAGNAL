/**
 * ============================================================================
 * 파일명: services/llm_chain.js
 * 역할: 나리야 답변 AI 를 관리자 센터에서 정한 순서대로 시도하는 「자동 전환 사슬」.
 *       기본 순서: 업스테이지 → 클로드 키2 → 클로드 키1 → ChatGPT(VM) → Gemini (클로드는 키2 먼저 — 2026-11-02 사용자 확정).
 *       앞의 AI 가 **크레딧 소진**이면 그 AI 를 계속 건너뛴다(관리자가 「소진 해제」를 누르거나 서버가 재시작될 때까지).
 *       그 밖의 일시 오류(시간초과·서버 오류)는 **그 호출 하나만** 다음 AI 가 대신 답한다.
 *       ChatGPT 칸만은 한도 소진을 알아볼 수 없어 **연속 3번 실패하면 30분 쉰다**(2026-11-02 사용자 확정).
 * ============================================================================
 * [사용자 확정 2026-11-02] 범위는 ChatGPT(codex)와 같다(/api/legal/ask). 순서는 관리자 센터에서 바꾼다.
 *   「넘어가는 조건」은 크레딧이 다 떨어졌을 때.
 *
 * [연계]
 *   - 사용 파일 : services/codex_bridge.js (요청 범위 ALS·VM 작업자 호출), @anthropic-ai/sdk
 *   - 서버 API  : Claude Messages API(claude-sonnet-5-5, effort medium) · Upstage chat/completions(solar-pro4, reasoning_effort medium)
 *   - 호출처    : services/gemini_client.js callGeminiRaw/callGeminiStream 입구(사슬 표시가 있는 요청일 때)
 *                 routes/legal.js normConfig(providerOrder)·POST /api/legal/config(providerReset)
 *   - 환경변수  : ANTHROPIC_API_KEY_1 · ANTHROPIC_API_KEY_2 · UPSTAGE_API_KEY (Fly.io 시크릿)
 * [로드 순서] 서버 모듈 — require 순서 무관(codex_bridge 를 부르지만 codex_bridge 는 이 파일을 부르지 않는다).
 */

const Anthropic = require('@anthropic-ai/sdk');
const codexBridge = require('./codex_bridge');

const PROVIDERS = ['upstage', 'claude1', 'claude2', 'chatgpt', 'gemini'];
const DEFAULT_ORDER = ['upstage', 'claude2', 'claude1', 'chatgpt', 'gemini'];   // 사용자 확정: ANTHROPIC_API_KEY_2 먼저, _1 나중
const NAMES = { upstage: '업스테이지', claude1: '클로드 키1', claude2: '클로드 키2', chatgpt: 'ChatGPT(VM)', gemini: 'Gemini' };
const CLAUDE_MODEL = 'claude-sonnet-5-5';
const UPSTAGE_MODEL = 'solar-pro4';
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

// 크레딧 소진 표시(인메모리). id → { at, error }. 재시작하면 비워진다(그때 다시 시도해 보고 또 소진이면 다시 표시).
const exhausted = {};
// ChatGPT 칸 연속 실패 수·쉼 끝 시각(ms, 0 = 안 쉼). 인메모리 — 재시작·「소진 해제」로 비워진다.
const chatgptRest = { fails: 0, until: 0 };
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
 * 이 AI 를 이번 호출에 쓸 수 있는가(키 있음 · 소진 아님 · ChatGPT 는 작업자 연결 + 모델 지정).
 * @param {string} id @param {object} s - 요청 범위 저장소 @returns {boolean}
 */
function usable(id, s) {
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
async function callClaude(apiKey, { contents, config }) {
  const timeout = callTimeout(config);
  // 짧은 한도(호출이 httpOptions.timeout 을 준 경우)면 SDK 재시도를 끈다(maxRetries 0).
  //   재시도 1회면 시간초과 때 한도 × 2 + 대기만큼 걸려 호출이 정한 한도를 넘는다. 재시도 몫은 사슬의 다음 AI 가 맡는다.
  //   한도를 안 준 긴 호출(120초)은 종전대로 1회 재시도.
  const maxRetries = timeout < CALL_TIMEOUT_MS ? 0 : 1;
  // baseURL·authToken 을 못박는다 — 서버에 ANTHROPIC_BASE_URL·ANTHROPIC_AUTH_TOKEN 이 따로 있어도 키가 딴 곳으로 가지 않게.
  const client = new Anthropic({ apiKey, authToken: null, baseURL: 'https://api.anthropic.com', maxRetries, timeout });
  try {
    const msg = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      ...(wantsJson(config) ? { system: JSON_RULE } : {}),
      messages: [{ role: 'user', content: promptText(contents) }],
    });
    if (msg.stop_reason === 'refusal') return { success: false, error: 'Claude 답변 거절(refusal)' };
    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
    if (!text.trim()) return { success: false, error: 'Claude 빈 응답' };
    return { success: true, text };
  } catch (e) {
    // 400 invalid_request_error + 「credit balance」(예: "Your credit balance is too low …")도 소진으로 본다 — 옛 응답 형태 대비.
    //   ⚠이 400 형태는 실호출로 확인하지 않았다(오류표의 402 billing_error 만 문서 기준). 문구가 바뀌면 일시 오류로 처리된다.
    const creditOut = e instanceof Anthropic.APIError && (e.status === 402 || e.type === 'billing_error'
      || (e.status === 400 && e.type === 'invalid_request_error' && /credit balance/i.test(String(e.message || ''))));
    return { success: false, error: `Claude ${e.status || ''} ${String(e.message || e).slice(0, 200)}`, creditOut };
  }
}

// 업스테이지 오류표(console.upstage.ai/docs/resources/error-codes)에서 「크레딧·결제·한도 소진」인 코드.
//   429 too_many_requests(분당 한도)는 소진이 아니다 — 이번 호출만 넘긴다.
const UPSTAGE_CREDIT_CODES = ['api_key_is_blocked', 'api_key_is_not_allowed', 'studio_subscription_quota_exceeded', 'usage_limit_exceeded'];

/** 업스테이지 호출(OpenAI 호환 chat/completions). @returns 위 callClaude 와 같은 모양 */
async function callUpstage(apiKey, { contents, config }) {
  try {
    const messages = [];
    if (wantsJson(config)) messages.push({ role: 'system', content: JSON_RULE });
    messages.push({ role: 'user', content: promptText(contents) });
    const res = await fetch(UPSTAGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: UPSTAGE_MODEL, messages, reasoning_effort: 'medium' }),
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
    if (id === 'claude1' || id === 'claude2') r = await callClaude(KEYS[id], args);
    else if (id === 'upstage') r = await callUpstage(KEYS[id], args);
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
 * ChatGPT 칸 연속 실패를 센다. 성공이면 0, 실패가 CHATGPT_FAIL_LIMIT 번 이어지면 CHATGPT_REST_MS 쉼 + 관리자 푸시 1회.
 * 쉬는 동안 끝난 호출(쉼 직전에 이미 나가 있던 것)의 실패는 세지 않는다 — 쉼이 끝나자마자 다시 쉬지 않게.
 * 예: 실패·실패·실패 → 30분 쉼(카운터 0으로) / 실패·실패·성공 → 카운터 0
 * @param {boolean} success
 * [연계] ← callRaw(사슬 안 ChatGPT 호출 결과만). usable 이 쉼을 본다. status 가 restUntil 로 내보낸다.
 */
function countChatgpt(success) {
  if (success) { chatgptRest.fails = 0; return; }
  if (Date.now() < chatgptRest.until) return;
  if (++chatgptRest.fails < CHATGPT_FAIL_LIMIT) return;
  chatgptRest.fails = 0;
  chatgptRest.until = Date.now() + CHATGPT_REST_MS;
  const hhmm = new Date(chatgptRest.until + 9 * 3600000).toISOString().slice(11, 16);
  console.error(`[LLM 사슬] ${NAMES.chatgpt} 연속 ${CHATGPT_FAIL_LIMIT}회 실패 → ${hhmm} KST 까지 쉼`);
  try {
    const { sendAdminPush } = require('./admin_push');
    sendAdminPush(`⏸ ${NAMES.chatgpt} 연속 ${CHATGPT_FAIL_LIMIT}회 실패 — 쉼`, `${hhmm} KST 까지 다음 순서 AI 로 넘어가고, 그 뒤 자동으로 다시 시도합니다. 바로 다시 쓰려면 관리자 센터에서 「소진 해제」를 눌러 주세요.`)
      .catch(e => console.error('[LLM 사슬] 관리자 푸시 오류:', e.message));
  } catch (_) { /* 푸시 모듈 없음 — 로그만 */ }
}

/** 크레딧 소진 표시 + 관리자 푸시(그 AI 당 한 번). */
function markExhausted(id, error) {
  if (exhausted[id]) return;
  exhausted[id] = { at: new Date().toISOString(), error: String(error || '').slice(0, 200) };
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
 * 소진 표시를 지운다(chatgpt·all 이면 ChatGPT 칸 쉼·연속 실패 수도). @param {string} id - PROVIDERS 중 하나 또는 'all' @returns {boolean} 받은 값이 유효했나
 * [연계] ← routes/legal.js POST /api/legal/config { providerReset }
 */
function resetExhausted(id) {
  if (id !== 'all' && !PROVIDERS.includes(id)) return false;
  if (id === 'all' || id === 'chatgpt') { chatgptRest.fails = 0; chatgptRest.until = 0; }
  if (id === 'all') { PROVIDERS.forEach(p => delete exhausted[p]); return true; }
  delete exhausted[id];
  return true;
}

/**
 * 관리자 화면용 상태 — 키 유무(값은 내보내지 않는다)·소진 여부·쉼 끝 시각(ChatGPT 만, 안 쉬면 null)·오늘 호출 수.
 * @returns {Array<{id,name,hasKey,exhaustedAt,restUntil,today}>}
 * [연계] ← routes/legal.js GET /api/legal/config
 */
function status() {
  const s = _stats();
  return PROVIDERS.map(id => ({
    id, name: NAMES[id],
    hasKey: id === 'chatgpt' ? !!codexBridge.ENABLED : id === 'gemini' ? true : !!KEYS[id],
    exhaustedAt: exhausted[id] ? exhausted[id].at : null,
    restUntil: id === 'chatgpt' && Date.now() < chatgptRest.until ? new Date(chatgptRest.until).toISOString() : null,
    today: s.by[id] || { calls: 0, success: 0, fail: 0 },
  }));
}

module.exports = { PROVIDERS, DEFAULT_ORDER, NAMES, CLAUDE_MODEL, UPSTAGE_MODEL, normOrder, isValidOrder, active, callRaw, isValidReset, resetExhausted, status };
