/**
 * test_llm_chain.js — 나리야 답변 AI 사슬(services/llm_chain.js)의 순서·자동 전환·크레딧 소진 처리를 고정한다.
 *
 * 왜 있나: 사용자 확정(2026-11-02) — 「업스테이지가 끝나면 클로드1, 클로드1이 끝나면 클로드2 … Gemini」.
 *   크레딧 소진이면 그 AI 를 계속 건너뛰고, 일시 오류면 그 호출만 다음 AI 가 답해야 한다.
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

  console.log(`\n  ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
