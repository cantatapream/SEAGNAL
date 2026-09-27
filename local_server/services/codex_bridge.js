/**
 * ============================================================================
 * 파일명: services/codex_bridge.js
 * 역할: 나리야 답변 AI를 **관리자 본인 요청에 한해** VM 의 ChatGPT(Codex)로 돌리는 중계소.
 *       Fly 서버는 질문을 줄(대기열)에 세워 두기만 하고, VM 작업자가 가져가 답을 만들어 돌려준다.
 *       (VM 은 밖으로 나가기만 한다 — VM 에 들어오는 문을 열지 않는다.)
 * ============================================================================
 *
 * [삼중 잠금] 셋 다 맞아야 codex 로 간다. 하나라도 빠지면 **지금과 똑같이 Gemini**.
 *   ① 서버 스위치 — 환경변수 NRYA_CODEX_SECRET(16자 이상)이 있어야 이 기능이 산다.
 *      없으면 대기열·작업자 창구가 모두 404 이고 withRequest 는 아무 일도 안 한다.
 *   ② 관리자 인증 — 요청 헤더 X-Admin-Token 이 유효(admin_auth.verifyToken).
 *   ③ 명시 선택  — 요청 본문 llm: "codex".
 *   ⚠이유: /api/legal/ask 는 인증 없이 열려 있다(버튼만 숨김). 잠금 없이 붙이면 남이 내
 *     ChatGPT 정액제를 쓰게 되고, 그건 OpenAI 약관상 계정 공유다.
 *
 * [요청 범위 표시] AsyncLocalStorage — withRequest 가 codex 요청이라고 표시하면, 그 요청 안에서
 *   불리는 gemini_client.callGeminiRaw/callGeminiStream 이 active() 로 알아보고 여기로 온다.
 *   legal_retriever.js 의 AI 호출 지점(9종)은 **한 줄도 고치지 않는다.**
 *   특보분석 등 다른 기능은 그 요청 밖이라 영향이 없다.
 *
 * [실패는 숨기지 않는다] 작업자가 없거나 시간초과면 Gemini 로 몰래 바꾸지 않고 실패로 돌려준다
 *   (어느 AI 답인지 섞이면 비교 시험이 무의미해진다). 응답 헤더 X-Nrya-LLM 으로 어느 쪽이었는지 알린다.
 *
 * [연계]
 *   - services/gemini_client.js   → 입구 두 곳에서 active()·callRaw() 를 부른다
 *   - routes/legal.js             → /api/legal/ask 앞 미들웨어(withRequest),
 *                                   작업자 창구 POST /api/legal/codex/poll · /api/legal/codex/result
 *   - services/admin_auth.js      → ② 관리자 토큰 검증(withRequest 안에서 늦게 require — 아래 ⚠)
 *   - scripts/codex_worker.js     → VM 에서 도는 작업자(이 파일의 상대편)
 *   - services/codex_client.design.md → 설계안(삼중 잠금·대기 중 상태 표)
 * [로드 순서] 서버 코드(require 로 로드) — index2.html 과 무관.
 * ============================================================================
 */

const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
// ⚠admin_auth 는 **쓸 때 불러온다**(withRequest 안). 이 파일은 gemini_client → legal_retriever 를 통해
//   서버 없이 도는 시험·도구 스크립트에도 실린다. admin_auth 를 맨 위에서 부르면 그 1시간 청소 타이머
//   (setInterval)가 스크립트를 끝나지 못하게 붙잡는다 — test_split_law_ask 가 그렇게 멈췄다(2026-09-27).

const SECRET = String(process.env.NRYA_CODEX_SECRET || '');
const ENABLED = SECRET.length >= 16;
// 작업자가 이 시간 안에 한 번도 안 왔으면 "VM 연결 없음"으로 바로 실패한다(질문을 세워 두고 하염없이 기다리지 않게).
const WORKER_STALE_MS = 90 * 1000;
// 질문 하나를 기다리는 최대 시간. 작업자 쪽 codex 실행 상한(scripts/codex_worker.js)보다 길어야 한다.
const JOB_TIMEOUT_MS = 300 * 1000;
// 작업자의 "일감 있어?" 요청을 붙잡아 두는 시간(긴 대기 — 빈 요청을 줄인다).
const POLL_HOLD_MS = 25 * 1000;

const als = new AsyncLocalStorage();
const jobs = new Map();      // id → { id, prompt, json, caller, state, resolve, timer, createdAt }
const queue = [];            // 아직 안 가져간 id 순서
let waiter = null;           // 붙잡아 둔 작업자 요청 { res, timer } — 작업자는 하나라 한 자리만 둔다
let lastWorkerSeenAt = 0;

/**
 * /api/legal/ask 앞에 끼우는 미들웨어. 삼중 잠금이 모두 맞으면 이 요청을 codex 로 표시한다.
 * 예: 관리자 토큰 + { llm: "codex" } → 응답 헤더 X-Nrya-LLM: codex, 그 요청의 AI 호출이 전부 VM 으로.
 * @param {object} req @param {object} res @param {Function} next
 * [연계] ← routes/legal.js router.post('/api/legal/ask', codexBridge.withRequest, …)
 */
function withRequest(req, res, next) {
  const wants = !!(req.body && req.body.llm === 'codex');
  if (!wants) return next();                       // 평소 요청 — 헤더도 안 붙인다(응답 바이트 동일)
  const ok = ENABLED && require('./admin_auth').verifyToken(req.get('X-Admin-Token') || '');
  res.setHeader('X-Nrya-LLM', ok ? 'codex' : 'gemini');
  if (!ok) return next();
  return als.run({ codex: true }, next);
}

/**
 * 지금 이 호출이 codex 로 표시된 요청 안에서 일어났는가.
 * @returns {boolean}
 * [연계] ← gemini_client.js callGeminiRaw·callGeminiStream·hasAnyKey 입구
 */
function active() {
  const s = als.getStore();
  return !!(s && s.codex);
}

/** 프롬프트를 문자열로 — legal_retriever 는 전부 문자열을 넘긴다(실측 9곳). 혹시 모를 객체는 JSON 으로. */
function promptText(contents) {
  return typeof contents === 'string' ? contents : JSON.stringify(contents);
}

/** 붙잡아 둔 작업자가 있으면 줄 맨 앞 일감을 그 자리에서 넘긴다. */
function handOut() {
  if (!waiter || !queue.length) return;
  const job = jobs.get(queue.shift());
  if (!job) return handOut();
  const w = waiter; waiter = null;
  clearTimeout(w.timer);
  job.state = 'taken';
  w.res.json({ id: job.id, prompt: job.prompt, json: job.json, caller: job.caller });
}

/**
 * gemini_client.callGeminiRaw 와 **같은 반환 모양**으로 codex 답을 받아 온다.
 * 예: callRaw({ contents: '…', config: { responseMimeType: 'application/json' }, caller: 'Legal-Clarify' })
 *     → { success: true, response: { text: '{"needed":false}' }, error: null, isRateLimited: false, keyLabel: 'codex' }
 * @param {{contents:any, config?:object, caller?:string}} args
 * @returns {Promise<{success:boolean, response:{text:string}|null, error:string|null, isRateLimited:boolean, keyLabel:string}>}
 * [연계] ← gemini_client.js. → 작업자(scripts/codex_worker.js)가 poll/result 로 처리.
 */
function callRaw({ contents, config, caller = 'unknown' }) {
  const fail = (error) => ({ success: false, response: null, error, isRateLimited: false, keyLabel: 'codex' });
  if (Date.now() - lastWorkerSeenAt > WORKER_STALE_MS) {
    console.error(`[Codex] VM 작업자 연결 없음 caller=${caller} (마지막 접속 ${lastWorkerSeenAt ? Math.round((Date.now() - lastWorkerSeenAt) / 1000) + '초 전' : '없음'})`);
    return Promise.resolve(fail('VM 작업자 연결 없음'));
  }
  const id = crypto.randomUUID();
  const json = !!(config && config.responseMimeType === 'application/json');
  return new Promise((resolve) => {
    const job = { id, prompt: promptText(contents), json, caller, state: 'queued', createdAt: Date.now(), resolve: null, timer: null };
    job.resolve = (r) => { clearTimeout(job.timer); jobs.delete(id); resolve(r); };
    job.timer = setTimeout(() => {
      const i = queue.indexOf(id); if (i >= 0) queue.splice(i, 1);
      console.error(`[Codex] 시간초과 caller=${caller} state=${job.state}`);
      job.resolve(fail('codex 시간초과'));
    }, JOB_TIMEOUT_MS);
    jobs.set(id, job);
    queue.push(id);
    handOut();
  });
}

/** 작업자 비밀 열쇠 확인 — 길이가 달라도 시간차가 안 나게 해시끼리 비교한다. */
function secretOk(req) {
  const got = crypto.createHash('sha256').update(String(req.get('X-Codex-Secret') || '')).digest();
  const want = crypto.createHash('sha256').update(SECRET).digest();
  return crypto.timingSafeEqual(got, want);
}

/** 응답 앞뒤의 ``` 코드블록 표시를 벗긴다(JSON 을 기대하는 호출만). */
function stripFence(text) {
  const m = String(text || '').trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1] : String(text || '').trim();
}

/**
 * 작업자 창구 ① "일감 있어?" — 있으면 바로, 없으면 최대 POLL_HOLD_MS 붙잡았다가 204.
 * [연계] ← routes/legal.js POST /api/legal/codex/poll ← scripts/codex_worker.js
 */
function poll(req, res) {
  if (!ENABLED) return res.status(404).end();
  if (!secretOk(req)) return res.status(401).json({ ok: false });
  lastWorkerSeenAt = Date.now();
  if (waiter) { clearTimeout(waiter.timer); waiter.res.status(204).end(); waiter = null; }  // 작업자가 다시 왔으면 옛 자리는 비운다
  const w = { res, timer: null };
  w.timer = setTimeout(() => { if (waiter === w) { waiter = null; res.status(204).end(); } }, POLL_HOLD_MS);
  res.on('close', () => { if (waiter === w) { clearTimeout(w.timer); waiter = null; } });
  waiter = w;
  handOut();
}

/**
 * 작업자 창구 ② 답 돌려주기 — { id, ok, text, error, ms, commands }.
 * [연계] ← routes/legal.js POST /api/legal/codex/result ← scripts/codex_worker.js
 */
function result(req, res) {
  if (!ENABLED) return res.status(404).end();
  if (!secretOk(req)) return res.status(401).json({ ok: false });
  lastWorkerSeenAt = Date.now();
  const b = req.body || {};
  const job = jobs.get(String(b.id || ''));
  if (!job) return res.json({ ok: false, error: '없는 일감(시간초과로 이미 끝났을 수 있다)' });
  console.log(`[Codex] 완료 caller=${job.caller} ok=${!!b.ok} ms=${Number(b.ms) || 0} commands=${Number(b.commands) || 0}`);
  if (b.ok && typeof b.text === 'string' && b.text.trim()) {
    job.resolve({ success: true, response: { text: job.json ? stripFence(b.text) : b.text }, error: null, isRateLimited: false, keyLabel: 'codex' });
  } else {
    job.resolve({ success: false, response: null, error: String(b.error || 'codex 빈 응답').slice(0, 300), isRateLimited: false, keyLabel: 'codex' });
  }
  res.json({ ok: true });
}

module.exports = { withRequest, active, callRaw, poll, result, stripFence, ENABLED };
