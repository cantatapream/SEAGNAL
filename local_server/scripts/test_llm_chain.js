/**
 * test_llm_chain.js — 나리야 답변 AI 사슬(services/llm_chain.js)의 순서·자동 전환·크레딧 소진 처리를 고정한다.
 *
 * 왜 있나: 사용자 확정(2026-11-02) — 「업스테이지가 끝나면 클로드1, 클로드1이 끝나면 클로드2 … Gemini」.
 *   크레딧 소진이면 그 AI 를 계속 건너뛰고, 일시 오류면 그 호출만 다음 AI 가 답해야 한다.
 *   ChatGPT 칸은 연속 3번 실패하면 30분 쉰다(⑦). 스트림(callStream)은 조각을 흘리고 첫 조각 전 실패만 다음 AI 로(⑧).
 *   소진·쉼은 파일에 남아 모듈을 다시 불러와도 이어진다(⑨) — 저장 파일은 임시 폴더(LLM_CHAIN_STATE_FILE)로 돌려 운영 data 를 안 건드린다.
 *   관리자 센터 [삭제]로 뺀 AI(providerRemoved)는 부르지 않고, 다시 추가하면 다시 부른다 · Gemini 는 못 뺀다(⑩) — 설정 파일은 메모리로 돌린다.
 *   칸별 모델·노력(providerModels)으로 요청하고, 틀린 값은 400, 옛 answerModel 은 ChatGPT 칸 모델로 이어진다(⑪).
 *   실제 네트워크는 부르지 않는다 — 전역 fetch 를 가짜로 바꿔 Claude·업스테이지 응답을 흉내 낸다.
 *
 * [연계] → services/llm_chain.js · services/codex_bridge.js(요청 범위) · services/gemini_client.js(입구)
 *          · scripts/refactor/verify_all.sh(SUITES)
 * 쓰는 법: node local_server/scripts/test_llm_chain.js
 */
process.env.ANTHROPIC_API_KEY_1 = 'k1';
process.env.ANTHROPIC_API_KEY_2 = 'k2';
process.env.UPSTAGE_API_KEY = 'ku';
delete process.env.NRYA_CODEX_SECRET;      // ChatGPT 칸은 서버 스위치 없음 → 건너뜀
delete process.env.GEMINI_API_KEY_26_8;    // Gemini 칸은 키 없음 → 실패(진짜 호출 방지)
const fs = require('fs');
const os = require('os');
const path = require('path');
const STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'llm_chain_test_'));
const STATE_FILE = process.env.LLM_CHAIN_STATE_FILE = path.join(STATE_DIR, 'llm_chain_state.json');   // 운영 data/ 대신

const bridge = require('../services/codex_bridge');
const chain = require('../services/llm_chain');
const gemini = require('../services/gemini_client');
try { require('../services/admin_push').sendAdminPush = async () => {}; } catch (_) { /* 푸시 모듈 없음 */ }

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

// 가짜 fetch — 호스트별로 정해 둔 응답을 돌려주고, 받은 요청을 기록한다.
const plan = { claude: {}, upstage: null };   // claude: { k1: fn, k2: fn }
const seen = [];
function jsonRes(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } });
}
globalThis.fetch = async (url, init) => {
  const u = String(url && url.url || url);
  const headers = new Headers((init && init.headers) || (url && url.headers) || {});
  const body = JSON.parse((init && init.body) || '{}');
  if (u.includes('api.anthropic.com')) {
    const key = String(headers.get('authorization') || '').replace(/^Bearer /, '');   // SDK 1.x 는 키를 Bearer 로 보낸다
    seen.push({ who: 'claude:' + key, body });
    return plan.claude[key](init);
  }
  if (u.includes('api.upstage.ai')) {
    seen.push({ who: 'upstage', body, auth: headers.get('authorization') });
    return plan.upstage(init);
  }
  throw new Error('예상 밖 호출 ' + u);
};
const claudeOk = (text) => () => jsonRes(200, { id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } });
const claudeErr = (status, type) => () => jsonRes(status, { type: 'error', error: { type, message: type } });
const upOk = (text) => () => jsonRes(200, { choices: [{ message: { content: text } }] });
const upErr = (status, code) => () => jsonRes(status, { error: { code, message: code } });
// 응답 없이 매달려 있다가 시간 한도(signal)가 끊으면 그때 실패한다.
const hang = () => (init) => new Promise((_, rej) => {
  const sig = init && init.signal;
  if (sig) sig.addEventListener('abort', () => rej(sig.reason || new Error('aborted')));
});
// SSE(스트림) 응답 — evs 는 [이벤트이름|null, 데이터] 묶음.
//   first 를 바로 보내고, gate 가 풀린 뒤 rest 를 보내고 닫는다. rest 가 null 이면 닫지 않고 매달린다(요청 signal 이 끊으면 오류).
const enc = new TextEncoder();
const sseText = (evs) => evs.map(([ev, d]) => (ev ? `event: ${ev}\n` : '') + `data: ${typeof d === 'string' ? d : JSON.stringify(d)}\n\n`).join('');
function sseRes(init, first, rest, gate) {
  const sig = init && init.signal;
  const body = new ReadableStream({
    start(c) {
      if (sig) sig.addEventListener('abort', () => { try { c.error(sig.reason || new Error('aborted')); } catch (_) { /* 이미 닫힘 */ } });
      if (first.length) c.enqueue(enc.encode(sseText(first)));
      if (rest === null) return;
      Promise.resolve(gate).then(() => { if (rest.length) c.enqueue(enc.encode(sseText(rest))); c.close(); }).catch(() => {});
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': 'req_test' } });
}
const cHead = [['message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }]];
const cDelta = (t) => ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } }];
const cTail = [['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } }],
  ['message_stop', { type: 'message_stop' }]];
const cErrEv = ['error', { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }];
const uDelta = (t) => [null, { choices: [{ delta: { content: t } }] }];
const uDone = [null, '[DONE]'];
/** Claude 스트림: texts 를 조각으로. gate 를 주면 첫 조각만 먼저 보내고 gate 뒤에 나머지. */
const claudeStream = (texts, gate) => (init) => sseRes(init, [...cHead, cDelta(texts[0])], [...texts.slice(1).map(cDelta), ...cTail], gate);
const upStream = (texts, gate) => (init) => sseRes(init, [uDelta(texts[0])], [...texts.slice(1).map(uDelta), uDone], gate);
/** p 가 ms 안에 안 끝나면 '__시간초과__' — 시험이 120초 매달리지 않게. */
const within = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r('__시간초과__'), ms))]);

/** 사슬 요청 범위 안에서 fn 을 돌린다(일반 사용자 + 「일반 사용자에게도」 켜짐). */
function inChain(fn, order) {
  const req = { body: {}, get: () => undefined };
  const res = { setHeader() {} };
  let p;
  bridge.withRequest(req, res, () => { p = fn(); }, { answerModel: 'gpt-6-luna', codexForUsers: true, providerOrder: order });
  return p;
}
const ORD = ['upstage', 'claude1', 'claude2', 'chatgpt', 'gemini'];   // ②③ 은 키1→키2 순서로 고정해 시험한다
const ask = (order, config) => inChain(async () => {
  const r = await gemini.callGemini({ model: 'gemini-2.5-flash', contents: '질문', config: config || {}, caller: 't' });
  return { r, label: bridge.answerLabel('gemini-2.5-flash') };
}, order);

(async () => {
  console.log('── ① 순서·요청 모양 ──');
  ok('기본 순서: 업스테이지 → 클로드 키2 → 클로드 키1 → ChatGPT → Gemini(사용자 확정)', JSON.stringify(chain.DEFAULT_ORDER) === JSON.stringify(['upstage', 'claude2', 'claude1', 'chatgpt', 'gemini']));
  {
    seen.length = 0;
    plan.upstage = upOk('업스테이지 답');
    const { r, label } = await ask();
    ok('기본 순서 1번 업스테이지가 답한다', r.success && r.text === '업스테이지 답', JSON.stringify(r));
    ok('업스테이지 요청: solar-pro4 · reasoning_effort medium · Bearer 키', seen[0] && seen[0].body.model === 'solar-pro4' && seen[0].body.reasoning_effort === 'medium' && seen[0].auth === 'Bearer ku', JSON.stringify(seen[0]));
    ok('답변 끝 표시 → Upstage Solar Pro 4', /Upstage Solar Pro 4/.test(label), label);
  }

  console.log('\n── ② 크레딧 소진 → 다음으로, 이후 계속 건너뜀 ──');
  {
    seen.length = 0;
    plan.upstage = upErr(403, 'api_key_is_not_allowed');
    plan.claude.k1 = claudeErr(402, 'billing_error');
    plan.claude.k2 = claudeOk('클로드2 답');
    const { r, label } = await ask(ORD);
    ok('업스테이지 소진 → 클로드1 소진 → 클로드2 가 답한다', r.success && r.text === '클로드2 답', JSON.stringify(r));
    ok('Claude 요청: claude-sonnet-5-5 · effort medium', seen[1] && seen[1].body.model === 'claude-sonnet-5-5' && seen[1].body.output_config && seen[1].body.output_config.effort === 'medium', JSON.stringify(seen[1] && seen[1].body));
    ok('답변 끝 표시 → Claude Sonnet 5.5', /Claude Sonnet 5\.5/.test(label), label);
    const st = chain.status();
    ok('상태: 업스테이지·클로드1 소진, 클로드2 아님', st.find(x => x.id === 'upstage').exhaustedAt && st.find(x => x.id === 'claude1').exhaustedAt && !st.find(x => x.id === 'claude2').exhaustedAt, JSON.stringify(st));
    seen.length = 0;
    await ask(ORD);
    ok('다음 질문은 소진된 둘을 부르지 않는다', seen.length === 1 && seen[0].who === 'claude:k2', JSON.stringify(seen.map(x => x.who)));
  }

  console.log('\n── ③ 일시 오류 → 그 호출만 다음으로(소진 아님) ──');
  {
    plan.claude.k2 = claudeErr(400, 'invalid_request_error');
    const { r } = await ask(ORD);
    ok('클로드2 일시 오류 → Gemini 칸(키 없음)까지 가서 실패', r.success === false && /GEMINI_API_KEY/.test(r.error || ''), JSON.stringify(r));
    ok('클로드2 는 소진으로 안 찍힌다', !chain.status().find(x => x.id === 'claude2').exhaustedAt);
    plan.upstage = upErr(429, 'too_many_requests');
    chain.resetExhausted('upstage');
    plan.claude.k2 = claudeOk('복구');
    const r2 = (await ask(ORD)).r;
    ok('업스테이지 분당 한도(429 too_many_requests)는 소진 아님 → 클로드2 가 답함', r2.success && r2.text === '복구' && !chain.status().find(x => x.id === 'upstage').exhaustedAt, JSON.stringify(r2));
  }

  console.log('\n── ④ 소진 해제·순서 바꾸기·JSON ──');
  {
    ok('resetExhausted(all) 유효', chain.resetExhausted('all') === true && chain.status().every(x => !x.exhaustedAt));
    ok('resetExhausted(틀린 값) 거부', chain.resetExhausted('x') === false);
    seen.length = 0;
    plan.claude.k2 = claudeOk('먼저 2');
    const { r } = await ask(['claude2', 'upstage', 'claude1', 'chatgpt', 'gemini']);
    ok('관리자가 정한 순서(클로드2 먼저)를 따른다', r.success && r.text === '먼저 2' && seen[0].who === 'claude:k2', JSON.stringify(seen.map(x => x.who)));
    ok('잘못된 순서는 기본 순서로', JSON.stringify(chain.normOrder(['gemini'])) === JSON.stringify(chain.DEFAULT_ORDER));
    plan.upstage = upOk('```json\n{"needed":false}\n```');
    const j = (await ask(undefined, { responseMimeType: 'application/json' })).r;
    ok('JSON 호출은 ``` 를 벗긴다', j.success && j.text === '{"needed":false}', JSON.stringify(j));
  }

  console.log('\n── ⑤ 사슬 밖·Gemini 전용 기능 ──');
  {
    seen.length = 0;
    const out = await gemini.callGemini({ model: 'm', contents: 'P', config: {}, caller: 'c' });
    ok('요청 밖은 기존 Gemini 경로 — 사슬로 새지 않는다', out.success === false && seen.length === 0, JSON.stringify(out));
    const req = { body: {}, get: () => undefined };
    let p; bridge.withRequest(req, { setHeader() {} }, () => { p = gemini.callGemini({ model: 'm', contents: 'P', config: {}, caller: 'c' }); }, { answerModel: 'gpt-6-luna', codexForUsers: false });
    await p;
    ok('일반 사용자 + 스위치 꺼짐 → 사슬 안 탐', seen.length === 0, JSON.stringify(seen.map(x => x.who)));
    seen.length = 0;
    await inChain(() => gemini.callGeminiRaw({ model: 'gemini-2.5-flash', contents: 'S', config: { tools: [{ googleSearch: {} }] }, caller: 'g' }));
    ok('검색 그라운딩(tools) 호출은 사슬을 안 탄다', seen.length === 0, JSON.stringify(seen.map(x => x.who)));
  }

  console.log('\n── ⑥ 리뷰 결함 회귀(2026-11-02) — 짧은 시간 한도·400 크레딧 문구·설정 API ──');
  {
    chain.resetExhausted('all');
    seen.length = 0;
    plan.upstage = hang();
    plan.claude.k1 = hang();
    plan.claude.k2 = claudeOk('짧은 한도 뒤 답');
    const t0 = Date.now();
    const out = await within(ask(ORD, { httpOptions: { timeout: 80 } }), 5000);
    const ms = Date.now() - t0;
    ok('httpOptions.timeout(80ms) 을 따른다 — 업스테이지·클로드1 이 끊기고 클로드2 가 답함(5초 안)', out !== '__시간초과__' && out.r.success && out.r.text === '짧은 한도 뒤 답', `${ms}ms ${JSON.stringify(out && out.r)}`);
    ok('짧은 한도면 Claude 재시도 안 함(클로드1 요청 1번)', seen.filter(x => x.who === 'claude:k1').length === 1, JSON.stringify(seen.map(x => x.who)));
    ok('시간초과는 소진 아님', chain.status().every(x => !x.exhaustedAt), JSON.stringify(chain.status()));

    seen.length = 0;
    plan.claude.k1 = claudeErr(500, 'api_error');
    await ask(['claude1', 'claude2', 'upstage', 'chatgpt', 'gemini']);
    ok('한도 없는 호출은 종전대로 Claude 1회 재시도(500 → 요청 2번)', seen.filter(x => x.who === 'claude:k1').length === 2, JSON.stringify(seen.map(x => x.who)));

    plan.claude.k1 = () => jsonRes(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } });
    const r = (await ask(['claude1', 'claude2', 'upstage', 'chatgpt', 'gemini'])).r;
    ok('400 invalid_request_error + "credit balance" → 클로드1 소진, 클로드2 가 답함', r.success && r.text === '짧은 한도 뒤 답' && !!chain.status().find(x => x.id === 'claude1').exhaustedAt, JSON.stringify(chain.status()));

    // 설정 API — 서버를 띄우지 않고 라우터의 처리 함수를 직접 부른다(쓰기 없는 경로만: GET · 400 거절).
    const adminAuth = require('../services/admin_auth');
    adminAuth.verifyToken = (t) => t === 'good';
    const router = require('../routes/legal');
    const route = (m) => router.stack.find(l => l.route && l.route.path === '/api/legal/config' && l.route.methods[m]).route;
    const call = (m, token, body) => new Promise((resolve) => {
      const stack = route(m).stack;
      const req = { body, get: (h) => (h === 'X-Admin-Token' ? token : undefined) };
      const res = { code: 200, status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, body: o }); } };
      stack[stack.length - 1].handle(req, res, () => resolve({ code: 'next' }));   // 마지막 = 본 처리(POST 의 관리자 검사는 건너뜀)
    });
    const g0 = await call('get', undefined);
    ok('GET 토큰 없음 → providerStatus 안 붙음', g0.body.ok && !('providerStatus' in g0.body), JSON.stringify(Object.keys(g0.body)));
    const g1 = await call('get', 'bad');
    ok('GET 틀린 토큰 → providerStatus 안 붙음', g1.body.ok && !('providerStatus' in g1.body));
    const g2 = await call('get', 'good');
    ok('GET 관리자 토큰 → providerStatus 붙음', Array.isArray(g2.body.providerStatus) && g2.body.providerStatus.length === chain.PROVIDERS.length, JSON.stringify(g2.body.providerStatus));

    const p1 = await call('post', 'good', { providerReset: 'claude1', codexForUsers: 'yes' });
    ok('POST providerReset + 틀린 BOOL → 400, 소진 표시는 그대로', p1.code === 400 && !!chain.status().find(x => x.id === 'claude1').exhaustedAt, JSON.stringify(p1));
    const p2 = await call('post', 'good', { providerReset: 'x' });
    ok('POST providerReset 틀린 값 → 400', p2.code === 400 && /providerReset/.test(p2.body.error), JSON.stringify(p2));
    ok('isValidReset 은 검사만 한다(지우지 않음)', chain.isValidReset('claude1') && chain.isValidReset('all') && !chain.isValidReset('x') && !!chain.status().find(x => x.id === 'claude1').exhaustedAt);
  }

  console.log('\n── ⑦ ChatGPT 칸 연속 3회 실패 → 30분 쉼(2026-11-02 사용자 확정) ──');
  {
    // 가짜 ChatGPT 칸 — 위처럼 모듈 함수를 바꿔 끼운다(실제 VM 작업자·네트워크 없음). 시계는 Date.now 를 앞으로 돌려 흉내 낸다.
    chain.resetExhausted('all');
    const realNow = Date.now;
    let skew = 0;
    Date.now = () => realNow() + skew;
    const saved = { en: bridge.ENABLED, alive: bridge.workerAlive, call: bridge.callRaw };
    let alive = true, gpt = { success: false, response: null, error: '종료코드 1', isRateLimited: false, keyLabel: 'codex' }, gptCalls = 0;
    bridge.ENABLED = true;
    bridge.workerAlive = () => alive;
    bridge.callRaw = async () => { gptCalls++; return gpt; };
    const pushes = [];
    const ap = require('../services/admin_push');
    const savedPush = ap.sendAdminPush;
    ap.sendAdminPush = async (title) => { pushes.push(title); };
    plan.claude.k2 = claudeOk('클로드2 대신');
    const GORD = ['chatgpt', 'claude2', 'upstage', 'claude1', 'gemini'];
    const gst = () => chain.status().find(x => x.id === 'chatgpt');
    const askN = async (n) => { for (let i = 0; i < n; i++) await ask(GORD); };
    const gptFail = gpt;
    const gptOk = { success: true, response: { text: 'GPT 답' }, error: null, isRateLimited: false, keyLabel: 'codex' };

    alive = false;
    await askN(3);
    ok('작업자 미연결로 건너뛴 것은 실패로 안 센다(3번 건너뜀 → 쉼 아님)', gptCalls === 0 && !gst().restUntil && pushes.length === 0, JSON.stringify({ gptCalls, st: gst(), pushes }));
    alive = true;

    await askN(2);
    ok('2연속 실패 → 아직 안 쉼', gptCalls === 2 && !gst().restUntil, JSON.stringify(gst()));
    const r3 = (await ask(GORD)).r;
    const want = new Date(Date.now() + 30 * 60 * 1000).getTime();
    const until = Date.parse(gst().restUntil);
    ok('3연속 실패 → 쉼(restUntil ≈ 지금 + 30분) · 그 질문은 클로드2 가 답함', gptCalls === 3 && Math.abs(until - want) < 5000 && r3.success && r3.text === '클로드2 대신', JSON.stringify({ st: gst(), r3 }));
    ok('쉬기 시작할 때 관리자 푸시 1회', pushes.length === 1 && /ChatGPT/.test(pushes[0]), JSON.stringify(pushes));
    ok('쉼은 소진 표시가 아니다(exhaustedAt 없음)', !gst().exhaustedAt);

    skew += 29 * 60 * 1000;
    await askN(3);
    ok('쉬는 동안(29분 뒤까지) ChatGPT 를 안 부른다 · 푸시 추가 없음', gptCalls === 3 && !!gst().restUntil && pushes.length === 1, JSON.stringify({ gptCalls, pushes }));

    skew += 60 * 1000 + 1000;
    gpt = gptOk;
    const r4 = (await ask(GORD)).r;
    ok('30분 지나면 다시 부른다 → 성공하면 ChatGPT 가 답함 · 쉼 표시 사라짐', gptCalls === 4 && r4.success && r4.text === 'GPT 답' && !gst().restUntil, JSON.stringify({ gptCalls, r4, st: gst() }));

    gpt = gptFail; await askN(2);
    gpt = gptOk; await askN(1);
    gpt = gptFail; await askN(2);
    ok('실패·실패·성공·실패·실패 → 성공에서 0 으로 돌아가 안 쉼', gptCalls === 9 && !gst().restUntil && pushes.length === 1, JSON.stringify({ gptCalls, st: gst(), pushes }));
    await askN(1);
    ok('그 뒤 한 번 더 실패(성공 뒤 3연속) → 쉼 · 푸시 2번째', gptCalls === 10 && !!gst().restUntil && pushes.length === 2, JSON.stringify({ gptCalls, pushes }));

    ok('providerReset chatgpt → 쉼 즉시 해제', chain.resetExhausted('chatgpt') === true && !gst().restUntil);
    await askN(1);
    ok('해제 뒤 바로 다시 부른다', gptCalls === 11, String(gptCalls));
    await askN(2);
    ok('해제는 연속 실패 수도 0 으로(해제 뒤 3번째 실패에서야 다시 쉼)', gptCalls === 13 && !!gst().restUntil && pushes.length === 3, JSON.stringify({ gptCalls, pushes }));
    ok('providerReset all 도 쉼 해제', chain.resetExhausted('all') === true && !gst().restUntil);

    Date.now = realNow;
    bridge.ENABLED = saved.en; bridge.workerAlive = saved.alive; bridge.callRaw = saved.call;
    ap.sendAdminPush = savedPush;
  }

  console.log('\n── ⑧ 스트림(callStream) — 조각을 흘리고, 첫 조각 전 실패만 다음 AI 로(2026-11-02 사용자 확정) ──');
  {
    chain.resetExhausted('all');
    /** 사슬 요청 범위 안에서 callGeminiStream 을 끝까지 읽는다. onChunk 는 조각마다 불린다. */
    const askStream = (order, config, onChunk) => inChain(async () => {
      const chunks = []; let err = null;
      try {
        for await (const c of gemini.callGeminiStream({ model: 'gemini-2.5-flash', contents: '질문', config: config || {}, caller: 's' })) { chunks.push(c); if (onChunk) onChunk(c); }
      } catch (e) { err = e; }
      return { chunks, err, label: bridge.answerLabel('gemini-2.5-flash') };
    }, order);
    const today = (id) => chain.status().find(x => x.id === id).today;

    // 첫 조각을 받기 전에는 서버가 나머지를 안 보낸다(gate) — 사슬이 완성본을 모아 한 번에 넘기면 여기서 매달린다.
    seen.length = 0;
    let open; let gate = new Promise(r => { open = r; });
    plan.claude.k2 = claudeStream(['가', '나', '다'], gate);
    const s0 = today('claude2').success;
    const a = await within(askStream(['claude2', 'upstage', 'claude1', 'chatgpt', 'gemini'], null, () => open()), 5000);
    ok('Claude 스트림: 첫 조각이 나머지보다 먼저 나온다 · 조각 3개', a !== '__시간초과__' && JSON.stringify(a.chunks) === '["가","나","다"]' && !a.err, JSON.stringify(a));
    ok('Claude 스트림 요청: stream:true · claude-sonnet-5-5 · effort medium', seen[0] && seen[0].body.stream === true && seen[0].body.model === 'claude-sonnet-5-5' && seen[0].body.output_config.effort === 'medium', JSON.stringify(seen[0] && seen[0].body));
    ok('답변 끝 표시 → Claude Sonnet 5.5 · 통계 success +1', a.label && /Claude Sonnet 5\.5/.test(a.label) && today('claude2').success === s0 + 1, JSON.stringify({ label: a.label, t: today('claude2') }));

    seen.length = 0;
    gate = new Promise(r => { open = r; });
    plan.upstage = upStream(['업', '스', '테'], gate);
    const b = await within(askStream(ORD, null, () => open()), 5000);
    ok('업스테이지 스트림: 첫 조각이 먼저 · 조각 3개', b !== '__시간초과__' && JSON.stringify(b.chunks) === '["업","스","테"]' && !b.err, JSON.stringify(b));
    ok('업스테이지 스트림 요청: stream:true · solar-pro4 · reasoning_effort medium', seen[0] && seen[0].body.stream === true && seen[0].body.model === 'solar-pro4' && seen[0].body.reasoning_effort === 'medium', JSON.stringify(seen[0] && seen[0].body));
    ok('답변 끝 표시 → Upstage Solar Pro 4', /Upstage Solar Pro 4/.test(b.label), b.label);

    seen.length = 0;
    plan.upstage = upErr(403, 'api_key_is_not_allowed');
    plan.claude.k1 = claudeErr(402, 'billing_error');
    plan.claude.k2 = claudeStream(['대', '신']);
    const c = await askStream(ORD);
    ok('첫 조각 전 소진(업스테이지 403·클로드1 402) → 클로드2 가 흘린다', JSON.stringify(c.chunks) === '["대","신"]' && !c.err, JSON.stringify(c));
    ok('스트림에서도 소진 표시(업스테이지·클로드1) · 클로드2 아님', !!chain.status().find(x => x.id === 'upstage').exhaustedAt && !!chain.status().find(x => x.id === 'claude1').exhaustedAt && !chain.status().find(x => x.id === 'claude2').exhaustedAt, JSON.stringify(chain.status()));
    chain.resetExhausted('all');

    seen.length = 0;
    plan.claude.k2 = (init) => sseRes(init, [...cHead, cDelta('반쯤')], [cErrEv]);
    plan.upstage = upOk('부르면 안 됨');
    const f0 = today('claude2').fail;
    const d = await askStream(['claude2', 'upstage', 'claude1', 'chatgpt', 'gemini']);
    ok('첫 조각 뒤 실패 → throw · 다음 AI(업스테이지)를 안 부른다', JSON.stringify(d.chunks) === '["반쯤"]' && !!d.err && !seen.some(x => x.who === 'upstage'), JSON.stringify({ d, seen: seen.map(x => x.who) }));
    ok('그 경우 답변 끝 이름은 글을 쓴 AI(클로드) · 실패 통계 +1 · 소진 아님', /Claude Sonnet 5\.5/.test(d.label) && today('claude2').fail === f0 + 1 && !chain.status().find(x => x.id === 'claude2').exhaustedAt, JSON.stringify({ label: d.label, t: today('claude2') }));

    seen.length = 0;
    plan.upstage = (init) => sseRes(init, [], null);            // 머리는 왔는데 조각이 안 온다
    plan.claude.k1 = (init) => sseRes(init, cHead, null);
    plan.claude.k2 = claudeStream(['늦지', '않게']);
    const t0 = Date.now();
    const e = await within(askStream(ORD, { httpOptions: { timeout: 80 } }), 5000);
    ok('첫 조각 시간 한도(httpOptions.timeout 80ms) → 업스테이지·클로드1 끊고 클로드2 가 흘림(5초 안) · 소진 아님', e !== '__시간초과__' && JSON.stringify(e.chunks) === '["늦지","않게"]' && chain.status().every(x => !x.exhaustedAt), `${Date.now() - t0}ms ${JSON.stringify(e)}`);

    plan.upstage = upErr(500, 'internal');
    plan.claude.k1 = claudeErr(400, 'invalid_request_error');
    plan.claude.k2 = claudeErr(400, 'invalid_request_error');
    const g = await askStream(ORD);
    ok('모두 첫 조각 전 실패 → throw(Gemini 칸 키 없음까지 감) · 조각 없음', g.chunks.length === 0 && !!g.err && /Gemini GEMINI_API_KEY/.test(g.err.message), JSON.stringify({ chunks: g.chunks, err: g.err && g.err.message }));

    // Gemini 칸 — 실제 Gemini 를 부르지 않도록 callStream 에 가짜 Gemini 스트림을 넘겨 시험한다.
    const fakeGem = (pieces, failAfter) => async function* () { for (const p of pieces) yield p; if (failAfter) throw new Error('끊김'); };
    const viaChain = (gen) => inChain(async () => {
      const chunks = []; let err = null;
      try { for await (const x of chain.callStream({ model: 'gemini-2.5-flash', contents: 'q', config: {}, caller: 'g' }, gen)) chunks.push(x); } catch (er) { err = er; }
      return { chunks, err, label: bridge.answerLabel('gemini-2.5-flash') };
    }, ['gemini', 'claude2', 'upstage', 'claude1', 'chatgpt']);
    plan.claude.k2 = claudeStream(['클']);
    const h = await viaChain(fakeGem(['G1', 'G2']));
    ok('Gemini 칸 스트림: 조각을 그대로 흘림 · 답변 끝 Gemini', JSON.stringify(h.chunks) === '["G1","G2"]' && !h.err && /Gemini 2\.5 Flash/.test(h.label), JSON.stringify(h));
    const i = await viaChain(fakeGem(['G1'], true));
    ok('Gemini 칸 첫 조각 뒤 끊김 → throw · 클로드2 로 안 넘어감', JSON.stringify(i.chunks) === '["G1"]' && !!i.err, JSON.stringify(i));
    const j = await viaChain(fakeGem([], true));
    ok('Gemini 칸 첫 조각 전 실패 → 클로드2 가 흘림', JSON.stringify(j.chunks) === '["클"]' && !j.err, JSON.stringify(j));

    // ChatGPT 칸 — 스트림이 없어 완성본 1번. 연속 실패 수도 callRaw 와 같이 센다.
    const saved = { en: bridge.ENABLED, alive: bridge.workerAlive, call: bridge.callRaw };
    let gpt = { success: true, response: { text: 'GPT 통째 답' }, error: null, isRateLimited: false, keyLabel: 'codex' }, gptCalls = 0;
    bridge.ENABLED = true; bridge.workerAlive = () => true; bridge.callRaw = async () => { gptCalls++; return gpt; };
    const GORD = ['chatgpt', 'claude2', 'upstage', 'claude1', 'gemini'];
    const k = await askStream(GORD);
    ok('ChatGPT 칸: 완성본을 한 번에(조각 1개) · 답변 끝 ChatGPT', JSON.stringify(k.chunks) === '["GPT 통째 답"]' && /ChatGPT GPT-6 Luna/.test(k.label), JSON.stringify(k));
    gpt = { success: false, response: null, error: '종료코드 1', isRateLimited: false, keyLabel: 'codex' };
    plan.claude.k2 = claudeStream(['대타']);
    const l = await askStream(GORD);
    ok('ChatGPT 칸 실패 → 클로드2 가 흘림', JSON.stringify(l.chunks) === '["대타"]', JSON.stringify(l));
    await askStream(GORD); await askStream(GORD);
    ok('스트림에서도 ChatGPT 연속 3회 실패 → 쉼', gptCalls === 4 && !!chain.status().find(x => x.id === 'chatgpt').restUntil, JSON.stringify({ gptCalls, st: chain.status().find(x => x.id === 'chatgpt') }));
    chain.resetExhausted('all');
    bridge.ENABLED = saved.en; bridge.workerAlive = saved.alive; bridge.callRaw = saved.call;
  }

  console.log('\n── ⑨ 소진·ChatGPT 쉼 — 재시작(모듈 다시 불러오기) 뒤에도 유지(2026-11-02 사용자 확정) ──');
  {
    const fresh = () => { delete require.cache[require.resolve('../services/llm_chain')]; return require('../services/llm_chain'); };
    chain.resetExhausted('all');
    plan.upstage = upErr(403, 'api_key_is_not_allowed');
    plan.claude.k2 = claudeOk('클로드2');
    await ask(['upstage', 'claude2', 'claude1', 'chatgpt', 'gemini']);
    const saved = { en: bridge.ENABLED, alive: bridge.workerAlive, call: bridge.callRaw };
    bridge.ENABLED = true; bridge.workerAlive = () => true;
    bridge.callRaw = async () => ({ success: false, response: null, error: '종료코드 1', isRateLimited: false, keyLabel: 'codex' });
    for (let n = 0; n < 3; n++) await ask(['chatgpt', 'claude2', 'upstage', 'claude1', 'gemini']);
    bridge.ENABLED = saved.en; bridge.workerAlive = saved.alive; bridge.callRaw = saved.call;
    const before = chain.status();
    const up0 = before.find(x => x.id === 'upstage').exhaustedAt, rest0 = before.find(x => x.id === 'chatgpt').restUntil;
    ok('저장 파일이 임시 폴더에 생겼다(운영 data 아님)', fs.existsSync(STATE_FILE) && up0 && rest0, JSON.stringify({ file: STATE_FILE, up0, rest0 }));

    const c2 = fresh();
    const st2 = c2.status();
    ok('다시 불러오기 → 업스테이지 소진 유지(같은 시각)', st2.find(x => x.id === 'upstage').exhaustedAt === up0 && st2.filter(x => x.exhaustedAt).length === 1, JSON.stringify(st2));
    ok('다시 불러오기 → ChatGPT 쉼 유지(같은 끝 시각)', st2.find(x => x.id === 'chatgpt').restUntil === rest0, JSON.stringify(st2.find(x => x.id === 'chatgpt')));

    ok('소진 해제도 파일에 남는다(해제 → 다시 불러오기 → 비어 있음)', c2.resetExhausted('all') && fresh().status().every(x => !x.exhaustedAt && !x.restUntil), fs.readFileSync(STATE_FILE, 'utf8'));

    fs.writeFileSync(STATE_FILE, '{"exhausted": {"upstage": ');   // 반쯤 쓰다 만 파일
    ok('손상 파일 → 빈 상태로 뜬다(오류 없이)', fresh().status().every(x => !x.exhaustedAt && !x.restUntil));
    fs.writeFileSync(STATE_FILE, JSON.stringify({ exhausted: { claude1: 'x', bogus: { at: '2026-11-02T00:00:00Z' }, claude2: { at: '2026-11-02T00:00:00Z', error: 'e' } }, chatgptRest: { until: Date.now() - 1000 } }));
    const st3 = fresh().status();
    ok('모양 틀린 칸·모르는 이름은 버리고, 지난 쉼은 무시', st3.filter(x => x.exhaustedAt).map(x => x.id).join() === 'claude2' && !st3.find(x => x.id === 'chatgpt').restUntil, JSON.stringify(st3));
    fs.writeFileSync(STATE_FILE, '[]');
    ok('JSON 이지만 엉뚱한 모양([]) → 빈 상태', fresh().status().every(x => !x.exhaustedAt && !x.restUntil));
  }

  console.log('\n── ⑩ AI 삭제(providerRemoved) — 뺀 AI 는 안 부름 · 다시 추가 · Gemini 는 못 뺌(2026-11-02 사용자 요청) ──');
  {
    // ⑨ 가 모듈을 다시 불러왔다 — gemini_client 가 쥔 사슬은 처음 불러온 것(chain)이라 그것으로 시험한다.
    chain.resetExhausted('all');
    /** 삭제 목록을 준 사슬 요청 범위에서 fn 을 돌린다. */
    const inChainRm = (fn, order, removed) => {
      let p;
      bridge.withRequest({ body: {}, get: () => undefined }, { setHeader() {} }, () => { p = fn(); }, { answerModel: 'gpt-6-luna', codexForUsers: true, providerOrder: order, providerRemoved: removed });
      return p;
    };
    const askRm = (removed) => inChainRm(() => gemini.callGemini({ model: 'gemini-2.5-flash', contents: '질문', config: {}, caller: 'rm' }), ORD, removed);
    plan.upstage = upOk('업스테이지 답');
    plan.claude.k1 = claudeOk('클로드1 답');
    seen.length = 0;
    const r1 = await askRm(['upstage']);
    ok('업스테이지 삭제 → 업스테이지를 안 부르고 클로드1 이 답함', r1.success && r1.text === '클로드1 답' && !seen.some(x => x.who === 'upstage'), JSON.stringify({ r1, seen: seen.map(x => x.who) }));
    const s1 = [];
    plan.claude.k2 = claudeStream(['스', '트']);
    seen.length = 0;
    await inChainRm(async () => { for await (const t of gemini.callGeminiStream({ model: 'gemini-2.5-flash', contents: '질문', config: {}, caller: 'rm' })) s1.push(t); }, ORD, ['upstage', 'claude1']);
    ok('스트림도 삭제된 AI(업스테이지·클로드1)를 안 부르고 클로드2 가 흘림', JSON.stringify(s1) === '["스","트"]' && seen.length === 1 && seen[0].who === 'claude:k2', JSON.stringify({ s1, seen: seen.map(x => x.who) }));
    seen.length = 0;
    const r2 = await askRm([]);
    ok('다시 추가(삭제 목록에서 뺌) → 업스테이지를 다시 부른다', r2.success && r2.text === '업스테이지 답' && seen[0].who === 'upstage', JSON.stringify({ r2, seen: seen.map(x => x.who) }));
    seen.length = 0;
    const r3 = await askRm(undefined);
    ok('삭제 목록 없음(옛 설정) → 종전대로 1번부터', r3.success && r3.text === '업스테이지 답' && seen[0].who === 'upstage', JSON.stringify(seen.map(x => x.who)));

    ok('isValidRemoved: 빈 배열·정상 id 는 받는다', chain.isValidRemoved([]) && chain.isValidRemoved(['upstage', 'claude1', 'claude2', 'chatgpt']));
    ok('isValidRemoved: gemini·모르는 이름·겹침·배열 아님은 거부', !chain.isValidRemoved(['gemini']) && !chain.isValidRemoved(['x']) && !chain.isValidRemoved(['claude1', 'claude1']) && !chain.isValidRemoved('claude1') && !chain.isValidRemoved(null));
    ok('normRemoved: 없음·틀린 값 → [] · 맞으면 복사', JSON.stringify(chain.normRemoved(undefined)) === '[]' && JSON.stringify(chain.normRemoved(['gemini'])) === '[]' && JSON.stringify(chain.normRemoved(['claude1'])) === '["claude1"]');
    const st = chain.status(['claude1']);
    ok('status(삭제 목록) → removed 표시(claude1 만)', st.filter(x => x.removed).map(x => x.id).join() === 'claude1' && chain.status().every(x => x.removed === false), JSON.stringify(st.map(x => [x.id, x.removed])));

    // 설정 API — 설정 파일(nariya_config.json)만 메모리로 돌려 실제 파일을 안 건드린다(atomic_write·legal.js 둘 다 fs 객체를 쓴다).
    const mem = {};
    const isCfg = (p) => /nariya_config\.json(\.tmp)?$/.test(String(p));
    const real = { ex: fs.existsSync, rd: fs.readFileSync, wr: fs.writeFileSync, mv: fs.renameSync };
    fs.existsSync = (p) => (isCfg(p) ? p in mem : real.ex(p));
    fs.readFileSync = (p, ...a) => (isCfg(p) ? (p in mem ? mem[p] : (() => { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; })()) : real.rd(p, ...a));
    fs.writeFileSync = (p, d, ...a) => (isCfg(p) ? void (mem[p] = String(d)) : real.wr(p, d, ...a));
    fs.renameSync = (a, b) => (isCfg(a) ? void (mem[b] = mem[a], delete mem[a]) : real.mv(a, b));
    try {
      const router = require('../routes/legal');
      const route = (m) => router.stack.find(l => l.route && l.route.path === '/api/legal/config' && l.route.methods[m]).route;
      const call = (m, token, body) => new Promise((resolve) => {
        const stack = route(m).stack;
        const req = { body, get: (h) => (h === 'X-Admin-Token' ? token : undefined) };
        const res = { code: 200, status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, body: o }); } };
        stack[stack.length - 1].handle(req, res, () => resolve({ code: 'next' }));
      });
      const CFG = path.join(__dirname, '..', 'data', 'nariya_config.json');
      const OLD_ORDER = ['claude2', 'upstage', 'claude1', 'gemini', 'chatgpt'];
      mem[CFG] = JSON.stringify({ exposure: 'admin', providerOrder: OLD_ORDER });   // 이 필드가 생기기 전의 저장값
      const g = await call('get', 'good');
      ok('옛 저장값(providerRemoved 없음) → 순서 그대로 · providerRemoved [] · 모두 removed:false', JSON.stringify(g.body.providerOrder) === JSON.stringify(OLD_ORDER) && JSON.stringify(g.body.providerRemoved) === '[]' && g.body.providerStatus.every(x => x.removed === false), JSON.stringify(g.body));
      const g0 = await call('get', undefined);
      ok('GET 토큰 없음에도 providerRemoved 는 붙고 providerStatus 는 안 붙음', Array.isArray(g0.body.providerRemoved) && !('providerStatus' in g0.body), JSON.stringify(Object.keys(g0.body)));

      for (const [name, bad] of [['gemini', ['gemini']], ['모르는 이름', ['x']], ['겹침', ['claude1', 'claude1']], ['배열 아님', 'claude1']]) {
        const before = mem[CFG];
        const p = await call('post', 'good', { providerRemoved: bad });
        ok(`POST providerRemoved ${name} → 400 · 저장값 그대로`, p.code === 400 && /providerRemoved/.test(p.body.error) && mem[CFG] === before, JSON.stringify(p));
      }
      const p1 = await call('post', 'good', { providerRemoved: ['claude1'] });
      const saved1 = JSON.parse(mem[CFG]);
      ok('POST providerRemoved [claude1] → 저장 · 순서·다른 필드 보존 · 응답 status 에 removed', p1.code === 200 && JSON.stringify(saved1.providerRemoved) === '["claude1"]' && JSON.stringify(saved1.providerOrder) === JSON.stringify(OLD_ORDER) && saved1.exposure === 'admin' && p1.body.providerStatus.find(x => x.id === 'claude1').removed === true, JSON.stringify({ p1: p1.body, saved1 }));
      const p2 = await call('post', 'good', { providerOrder: ['claude2', 'upstage', 'claude1', 'chatgpt', 'gemini'], providerRemoved: [] });
      const saved2 = JSON.parse(mem[CFG]);
      ok('POST 다시 추가(순서+빈 삭제 목록 한 번에) → 둘 다 저장', p2.code === 200 && JSON.stringify(saved2.providerRemoved) === '[]' && saved2.providerOrder.join() === 'claude2,upstage,claude1,chatgpt,gemini', JSON.stringify(saved2));
      mem[CFG] = JSON.stringify({ providerOrder: OLD_ORDER, providerRemoved: ['claude1', 'gemini'] });   // 손으로 고친 틀린 저장값
      const g2 = await call('get', 'good');
      ok('저장값에 gemini 가 들어 있으면 → providerRemoved [](아무것도 안 뺌)', JSON.stringify(g2.body.providerRemoved) === '[]', JSON.stringify(g2.body.providerRemoved));
    } finally {
      fs.existsSync = real.ex; fs.readFileSync = real.rd; fs.writeFileSync = real.wr; fs.renameSync = real.mv;
    }
  }

  console.log('\n── ⑪ 칸별 모델·노력(providerModels) — 고른 모델·effort 로 요청 · 검증 400 · 옛 answerModel 호환(2026-11-02 사용자 요청) ──');
  {
    chain.resetExhausted('all');
    /** providerModels 를 준 사슬 요청 범위에서 질문 하나(비스트림) — 답과 답변 끝 표시줄을 돌려준다. */
    const askPm = (order, pm) => {
      let p;
      bridge.withRequest({ body: {}, get: () => undefined }, { setHeader() {} }, () => {
        p = (async () => {
          const r = await gemini.callGemini({ model: 'gemini-2.5-flash', contents: '질문', config: {}, caller: 'pm' });
          return { r, label: bridge.answerLabel('gemini-2.5-flash') };
        })();
      }, { answerModel: 'gpt-6-luna', codexForUsers: true, providerOrder: order, providerModels: pm });
      return p;
    };
    plan.claude.k1 = claudeOk('클로드1 답');
    plan.claude.k2 = claudeOk('클로드2 답');
    plan.upstage = upOk('업스테이지 답');
    seen.length = 0;
    const a1 = await askPm(['claude1', 'claude2', 'upstage', 'chatgpt', 'gemini'], { claude1: { model: 'claude-opus-5-5', effort: 'high' }, claude2: { model: 'claude-haiku-5-5', effort: 'low' } });
    ok('클로드 키1 = claude-opus-5-5 · effort high · max_tokens 16000 으로 요청', a1.r.text === '클로드1 답' && seen[0].who === 'claude:k1' && seen[0].body.model === 'claude-opus-5-5' && seen[0].body.output_config.effort === 'high' && seen[0].body.max_tokens === 16000, JSON.stringify(seen[0] && seen[0].body));
    ok('답변 끝 표시 → 실제 고른 모델(Claude Opus 5.5)', /Claude Opus 5\.5 모델이 답했습니다/.test(a1.label), a1.label);
    seen.length = 0;
    const a2 = await askPm(['claude2', 'claude1', 'upstage', 'chatgpt', 'gemini'], { claude1: { model: 'claude-opus-5-5', effort: 'high' }, claude2: { model: 'claude-haiku-5-5', effort: 'low' } });
    ok('클로드 키2 는 따로 저장된 값(claude-haiku-5-5 · low) — 키1 값과 안 섞임', a2.r.text === '클로드2 답' && seen[0].who === 'claude:k2' && seen[0].body.model === 'claude-haiku-5-5' && seen[0].body.output_config.effort === 'low', JSON.stringify(seen[0] && seen[0].body));
    ok('답변 끝 표시 → Claude Haiku 5.5', /Claude Haiku 5\.5/.test(a2.label), a2.label);
    seen.length = 0;
    await askPm(['claude1', 'claude2', 'upstage', 'chatgpt', 'gemini'], { claude1: { model: 'claude-sonnet-5-5', effort: 'max' } });
    ok('effort max → max_tokens 64000(xhigh·max 는 64000 이상 — claude-api 스킬 체크리스트)', seen[0].body.output_config.effort === 'max' && seen[0].body.max_tokens === 64000, JSON.stringify(seen[0] && seen[0].body));
    seen.length = 0;
    const a3 = await askPm(['upstage', 'claude1', 'claude2', 'chatgpt', 'gemini'], { upstage: { model: 'solar-mini4', effort: 'none' } });
    ok('업스테이지 = solar-mini4 · reasoning_effort none 으로 요청', a3.r.text === '업스테이지 답' && seen[0].body.model === 'solar-mini4' && seen[0].body.reasoning_effort === 'none', JSON.stringify(seen[0] && seen[0].body));
    ok('답변 끝 표시 → Upstage Solar Mini 4', /Upstage Solar Mini 4 모델이 답했습니다/.test(a3.label), a3.label);
    // 스트림도 같은 값
    seen.length = 0;
    plan.claude.k2 = claudeStream(['가', '나']);
    let label = '';
    const chunks = [];
    await new Promise((resolve) => {
      bridge.withRequest({ body: {}, get: () => undefined }, { setHeader() {} }, () => {
        (async () => {
          for await (const t of gemini.callGeminiStream({ model: 'gemini-2.5-flash', contents: '질문', config: {}, caller: 'pms' })) chunks.push(t);
          label = bridge.answerLabel('gemini-2.5-flash');
        })().then(resolve, resolve);
      }, { codexForUsers: true, providerOrder: ['claude2', 'claude1', 'upstage', 'chatgpt', 'gemini'], providerModels: { claude2: { model: 'claude-opus-5-5', effort: 'xhigh' } } });
    });
    ok('스트림도 고른 값(claude-opus-5-5 · xhigh · max_tokens 64000)', chunks.join('') === '가나' && seen[0].body.stream === true && seen[0].body.model === 'claude-opus-5-5' && seen[0].body.output_config.effort === 'xhigh' && seen[0].body.max_tokens === 64000, JSON.stringify(seen[0] && seen[0].body));
    ok('스트림 답변 끝 표시 → Claude Opus 5.5', /Claude Opus 5\.5/.test(label), label);
    // ChatGPT 칸 모델 — providerModels.chatgpt 가 먼저, 없으면 옛 answerModel
    const storeOf = (cfg) => { let st; bridge.withRequest({ body: {}, get: () => undefined }, { setHeader() {} }, () => { st = bridge.store(); }, Object.assign({ codexForUsers: true }, cfg)); return st; };
    ok('withRequest: providerModels.chatgpt.model(gpt-6-sol)이 answerModel(luna)보다 먼저', storeOf({ answerModel: 'gpt-6-luna', providerModels: { chatgpt: { model: 'gpt-6-sol', effort: null } } }).model === 'gpt-6-sol');
    ok('withRequest: providerModels 없음 → 종전대로 answerModel(gpt-6-astra)', storeOf({ answerModel: 'gpt-6-astra' }).model === 'gpt-6-astra');

    ok('isValidModels: 정상(일부 칸만·ChatGPT 는 model 만)', chain.isValidModels({}) && chain.isValidModels({ claude1: { model: 'claude-opus-5-5', effort: 'max' }, upstage: { model: 'solar-pro4', effort: 'high' }, chatgpt: { model: 'gpt-6-astra' } }));
    for (const [name, bad] of [['gemini 칸', { gemini: { model: 'gemini-2.5-flash' } }], ['모르는 모델', { claude1: { model: 'claude-x', effort: 'low' } }], ['노력 빠짐', { claude2: { model: 'claude-opus-5-5' } }],
      ['업스테이지 노력 max(목록 밖)', { upstage: { model: 'solar-pro4', effort: 'max' } }], ['ChatGPT 에 노력', { chatgpt: { model: 'gpt-6-luna', effort: 'high' } }], ['ChatGPT gemini', { chatgpt: { model: 'gemini' } }],
      ['배열', []], ['null', null]]) {
      ok(`isValidModels 거부: ${name}`, !chain.isValidModels(bad));
    }
    const nm = chain.normModels(undefined, 'gemini');
    ok('normModels(없음, answerModel gemini) → 네 칸 기본값 · ChatGPT 는 Luna', nm.claude1.model === 'claude-sonnet-5-5' && nm.claude1.effort === 'medium' && nm.claude2.effort === 'medium' && nm.upstage.model === 'solar-pro4' && nm.upstage.effort === 'medium' && nm.chatgpt.model === 'gpt-6-luna' && nm.chatgpt.effort === null, JSON.stringify(nm));
    ok('normModels(없음, answerModel gpt-6-sol) → ChatGPT 칸 Sol(옛 저장값 호환)', chain.normModels(undefined, 'gpt-6-sol').chatgpt.model === 'gpt-6-sol');
    ok('normModels: providerModels.chatgpt 가 있으면 answerModel 무시', chain.normModels({ chatgpt: { model: 'gpt-6-astra' } }, 'gpt-6-sol').chatgpt.model === 'gpt-6-astra');
    ok('normModels: 틀린 칸만 기본값, 맞는 칸은 그대로', (() => { const x = chain.normModels({ claude1: { model: 'zz', effort: 'low' }, claude2: { model: 'claude-opus-5-5', effort: 'xhigh' } }); return x.claude1.model === 'claude-sonnet-5-5' && x.claude1.effort === 'medium' && x.claude2.model === 'claude-opus-5-5' && x.claude2.effort === 'xhigh'; })());

    // 설정 API — ⑩ 과 같이 설정 파일만 메모리로 돌린다.
    const mem = {};
    const isCfg = (p) => /nariya_config\.json(\.tmp)?$/.test(String(p));
    const real = { ex: fs.existsSync, rd: fs.readFileSync, wr: fs.writeFileSync, mv: fs.renameSync };
    fs.existsSync = (p) => (isCfg(p) ? p in mem : real.ex(p));
    fs.readFileSync = (p, ...a) => (isCfg(p) ? (p in mem ? mem[p] : (() => { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; })()) : real.rd(p, ...a));
    fs.writeFileSync = (p, d, ...a) => (isCfg(p) ? void (mem[p] = String(d)) : real.wr(p, d, ...a));
    fs.renameSync = (a, b) => (isCfg(a) ? void (mem[b] = mem[a], delete mem[a]) : real.mv(a, b));
    try {
      const router = require('../routes/legal');
      const route = (m) => router.stack.find(l => l.route && l.route.path === '/api/legal/config' && l.route.methods[m]).route;
      const call = (m, token, body) => new Promise((resolve) => {
        const stack = route(m).stack;
        const req = { body, get: (h) => (h === 'X-Admin-Token' ? token : undefined) };
        const res = { code: 200, status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, body: o }); } };
        stack[stack.length - 1].handle(req, res, () => resolve({ code: 'next' }));
      });
      const CFG = path.join(__dirname, '..', 'data', 'nariya_config.json');
      mem[CFG] = JSON.stringify({ exposure: 'admin', answerModel: 'gemini' });   // providerModels 가 생기기 전 · 버튼줄에서 Gemini 를 골라 둔 저장값
      const g = await call('get', 'good');
      ok('옛 저장값 answerModel gemini → providerModels.chatgpt = gpt-6-luna · 나머지 기본값', g.body.providerModels && g.body.providerModels.chatgpt.model === 'gpt-6-luna' && g.body.providerModels.claude1.model === 'claude-sonnet-5-5' && g.body.answerModel === 'gemini', JSON.stringify(g.body.providerModels));
      ok('GET 관리자 → providerChoices(Gemini 칸 = legal_retriever.ANSWER_MODEL, 노력 없음 · ChatGPT 노력 없음)', g.body.providerChoices && g.body.providerChoices.gemini.model === require('../services/legal_retriever').ANSWER_MODEL && g.body.providerChoices.gemini.efforts.length === 0 && g.body.providerChoices.chatgpt.efforts.length === 0 && g.body.providerChoices.claude1.efforts.join() === 'low,medium,high,xhigh,max', JSON.stringify(g.body.providerChoices));
      ok('GET 관리자 status → ChatGPT 칸에 workerAlive(서버 스위치 없음 시험 → hasKey false)', (() => { const c = g.body.providerStatus.find(x => x.id === 'chatgpt'); return c && typeof c.workerAlive === 'boolean' && c.hasKey === false; })(), JSON.stringify(g.body.providerStatus.find(x => x.id === 'chatgpt')));
      const g0 = await call('get', undefined);
      ok('GET 토큰 없음 → providerChoices 안 붙음', !('providerChoices' in g0.body));
      mem[CFG] = JSON.stringify({ answerModel: 'gpt-6-sol' });
      ok('옛 저장값 answerModel gpt-6-sol → providerModels.chatgpt = gpt-6-sol', (await call('get', 'good')).body.providerModels.chatgpt.model === 'gpt-6-sol');

      mem[CFG] = JSON.stringify({ exposure: 'admin', providerModels: { claude2: { model: 'claude-opus-5-5', effort: 'high' } } });
      for (const [name, bad] of [['gemini 칸', { gemini: { model: 'gemini-2.5-flash' } }], ['effort 목록 밖', { claude1: { model: 'claude-opus-5-5', effort: 'ultra' } }], ['배열', [1]], ['문자열', 'claude']]) {
        const before = mem[CFG];
        const p = await call('post', 'good', { providerModels: bad });
        ok(`POST providerModels ${name} → 400 · 저장값 그대로`, p.code === 400 && /providerModels/.test(p.body.error) && mem[CFG] === before, JSON.stringify(p));
      }
      const p1 = await call('post', 'good', { providerModels: { claude1: { model: 'claude-haiku-5-5', effort: 'xhigh' } } });
      const sv = JSON.parse(mem[CFG]);
      ok('POST providerModels 한 칸 → 그 칸만 바뀌고 키2·다른 필드는 보존', p1.code === 200 && sv.providerModels.claude1.model === 'claude-haiku-5-5' && sv.providerModels.claude1.effort === 'xhigh' && sv.providerModels.claude2.model === 'claude-opus-5-5' && sv.exposure === 'admin' && p1.body.providerModels.claude1.effort === 'xhigh', JSON.stringify(sv));
      const p2 = await call('post', 'good', { providerModels: { chatgpt: { model: 'gpt-6-astra' } } });
      ok('POST ChatGPT 칸 모델 → providerModels.chatgpt 저장(이후 사슬·llm:codex 가 이 모델)', p2.code === 200 && JSON.parse(mem[CFG]).providerModels.chatgpt.model === 'gpt-6-astra' && p2.body.providerModels.chatgpt.effort === null, JSON.stringify(p2.body.providerModels));
    } finally {
      fs.existsSync = real.ex; fs.readFileSync = real.rd; fs.writeFileSync = real.wr; fs.renameSync = real.mv;
    }
  }

  fs.rmSync(STATE_DIR, { recursive: true, force: true });
  console.log(`\n  ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
