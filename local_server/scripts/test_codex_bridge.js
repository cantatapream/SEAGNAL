/**
 * test_codex_bridge.js — Codex 개발자 모드(services/codex_bridge.js)의 삼중 잠금·중계를 고정한다.
 *
 * 왜 있나: /api/legal/ask 는 인증 없이 열려 있다. 잠금이 하나라도 새면 남이 관리자의 ChatGPT 정액제를
 *   쓰게 된다(OpenAI 약관상 계정 공유). 그래서 "잠금이 빠지면 Gemini 로 간다"를 문항으로 못박는다.
 *   실제 codex·네트워크는 부르지 않는다 — 가짜 요청/응답 객체로 poll·result 를 직접 부른다.
 *
 * [연계] → services/codex_bridge.js · services/gemini_client.js · scripts/refactor/verify_all.sh(SUITES)
 * 쓰는 법: node local_server/scripts/test_codex_bridge.js
 */
const path = require('path');
const { execFileSync } = require('child_process');

const SECRET = 'test-secret-0123456789';
process.env.NRYA_CODEX_SECRET = SECRET;
delete process.env.GEMINI_API_KEY_26_8;   // 평소 경로가 Gemini 키 없음으로 보이게(진짜 호출 방지)

const adminAuth = require('../services/admin_auth');
adminAuth.verifyToken = (t) => t === 'GOOD';   // 디스크에 토큰을 쓰지 않도록 검증만 바꿔 끼운다
const bridge = require('../services/codex_bridge');
const gemini = require('../services/gemini_client');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
function fakeReq(body, headers) {
  const h = {}; for (const k of Object.keys(headers || {})) h[k.toLowerCase()] = headers[k];
  return { body, get: (k) => h[String(k).toLowerCase()] };
}
function fakeRes() {
  const r = { headers: {}, code: 200, body: undefined, done: false };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (o) => { r.body = o; r.done = true; return r; };
  r.end = () => { r.done = true; return r; };
  r.on = () => r;
  return r;
}
/** withRequest 를 통과시켜 next 안에서 fn 을 돌린다 — 실제 라우트와 같은 모양. */
function through(body, headers, fn) {
  const res = fakeRes();
  let out;
  bridge.withRequest(fakeReq(body, headers), res, () => { out = fn(); });
  return { res, out };
}

(async () => {
  console.log('── ① 삼중 잠금 ──');
  {
    const a = through({ query: 'x' }, {}, () => bridge.active());
    ok('llm 없음 → codex 아님 · 헤더도 안 붙음(평소 응답 동일)', a.out === false && !('X-Nrya-LLM' in a.res.headers));
    const b = through({ llm: 'codex' }, {}, () => bridge.active());
    ok('llm:codex 인데 관리자 토큰 없음 → Gemini', b.out === false && b.res.headers['X-Nrya-LLM'] === 'gemini');
    const c = through({ llm: 'codex' }, { 'X-Admin-Token': 'BAD' }, () => bridge.active());
    ok('틀린 관리자 토큰 → Gemini', c.out === false && c.res.headers['X-Nrya-LLM'] === 'gemini');
    const d = through({}, { 'X-Admin-Token': 'GOOD' }, () => bridge.active());
    ok('관리자 토큰만 있고 llm 선택 없음 → Gemini', d.out === false);
    const e = through({ llm: 'codex' }, { 'X-Admin-Token': 'GOOD' }, () => bridge.active());
    ok('셋 다 맞음 → codex', e.out === true && e.res.headers['X-Nrya-LLM'] === 'codex');
    ok('요청 밖에서는 codex 아님', bridge.active() === false);
  }
  {
    // 서버 스위치(NRYA_CODEX_SECRET)가 없으면 토큰·llm 이 맞아도 꺼져 있어야 한다 — 별도 프로세스로 확인.
    const code = `
      const a = require(${JSON.stringify(path.join(__dirname, '../services/admin_auth'))});
      a.verifyToken = () => true;
      const b = require(${JSON.stringify(path.join(__dirname, '../services/codex_bridge'))});
      let act = null; const res = { setHeader(k, v) { this.h = v; } };
      b.withRequest({ body: { llm: 'codex' }, get: () => 'GOOD' }, res, () => { act = b.active(); });
      const r = { code: 0, status(c) { this.code = c; return this; }, end() {} };
      b.poll({ get: () => '' }, r);
      console.log(JSON.stringify({ en: b.ENABLED, act, h: res.h, poll: r.code })); process.exit(0);`;  // admin_auth 청소 타이머가 프로세스를 붙잡으므로 직접 끝낸다
    const env = Object.assign({}, process.env); delete env.NRYA_CODEX_SECRET;
    let o = {};
    try { o = JSON.parse(execFileSync(process.execPath, ['-e', code], { env, encoding: 'utf8', timeout: 20000 }).trim().split('\n').pop()); } catch (e) { o = { err: e.message }; }
    ok('서버 스위치 없음 → 토큰·llm 맞아도 Gemini, 작업자 창구 404', o.en === false && o.act === false && o.h === 'gemini' && o.poll === 404, JSON.stringify(o));
    const env2 = Object.assign({}, env, { NRYA_CODEX_SECRET: 'short' });
    try { o = JSON.parse(execFileSync(process.execPath, ['-e', code], { env: env2, encoding: 'utf8', timeout: 20000 }).trim().split('\n').pop()); } catch (e) { o = { err: e.message }; }
    ok('비밀 열쇠가 16자 미만 → 꺼짐', o.en === false && o.act === false, JSON.stringify(o));
  }

  console.log('\n── ② 작업자 창구 ──');
  {
    const r = fakeRes();
    bridge.poll(fakeReq({}, { 'X-Codex-Secret': 'wrong-secret-0123456789' }), r);
    ok('틀린 비밀 열쇠 → 401', r.code === 401);
    const r2 = fakeRes();
    bridge.result(fakeReq({ id: 'x' }, {}), r2);
    ok('열쇠 없는 결과 전송 → 401', r2.code === 401);
  }
  {
    const r = await bridge.callRaw({ contents: 'q', caller: 't' });
    ok('작업자가 한 번도 안 왔으면 → 바로 실패("VM 작업자 연결 없음")', r.success === false && /연결 없음/.test(r.error), JSON.stringify(r));
  }

  console.log('\n── ③ 왕복(가짜 작업자) ──');
  const secretH = { 'X-Codex-Secret': SECRET };
  /** 작업자가 기다리는 중에 일감을 넣고, 받은 일감에 text 로 답한다. */
  async function roundTrip(callFn, reply) {
    const pr = fakeRes();
    bridge.poll(fakeReq({}, secretH), pr);
    const p = callFn();
    await new Promise(r => setImmediate(r));
    const job = pr.body;
    if (!job || !job.id) return { job, value: null };
    bridge.result(fakeReq(Object.assign({ id: job.id }, reply), secretH), fakeRes());
    return { job, value: await p };
  }
  {
    const { job, value } = await roundTrip(
      () => bridge.callRaw({ contents: '질문', config: { responseMimeType: 'application/json' }, caller: 'Legal-Clarify' }),
      { ok: true, text: '```json\n{"needed":false}\n```' });
    ok('일감이 작업자에게 전달된다(프롬프트·JSON 여부·호출자)', job && job.prompt === '질문' && job.json === true && job.caller === 'Legal-Clarify', JSON.stringify(job));
    ok('JSON 호출은 ``` 를 벗겨 돌려준다', value && value.success && value.response.text === '{"needed":false}', JSON.stringify(value));
  }
  {
    const { value } = await roundTrip(() => bridge.callRaw({ contents: '질문2', caller: 'Legal-Ask' }), { ok: false, error: '한도' });
    ok('작업자 실패 → 실패로 돌려줌(Gemini 로 몰래 안 바꿈)', value && value.success === false && value.error === '한도' && value.keyLabel === 'codex');
  }

  console.log('\n── ④ gemini_client 입구 분기 ──');
  {
    ok('평소(요청 밖): hasAnyKey 는 Gemini 키 기준(여기선 없음)', gemini.hasAnyKey() === false);
    const inScope = through({ llm: 'codex' }, { 'X-Admin-Token': 'GOOD' }, () => gemini.hasAnyKey());
    ok('codex 요청 안: hasAnyKey 참(키 없어도 AI 단계가 안 빠진다)', inScope.out === true);
    let got = null;
    const { value } = await roundTrip(() => {
      let p; through({ llm: 'codex' }, { 'X-Admin-Token': 'GOOD' }, () => { p = gemini.callGemini({ model: 'm', contents: 'P', config: {}, caller: 'c' }); });
      return p;
    }, { ok: true, text: '답' });
    got = value;
    ok('callGemini 가 codex 로 가서 { success, text } 모양을 지킨다', got && got.success === true && got.text === '답', JSON.stringify(got));
    const chunks = [];
    const { job } = await roundTrip(() => {
      let p; through({ llm: 'codex' }, { 'X-Admin-Token': 'GOOD' }, () => {
        p = (async () => { for await (const c of gemini.callGeminiStream({ model: 'm', contents: 'S', config: {}, caller: 's' })) chunks.push(c); })();
      });
      return p;
    }, { ok: true, text: '스트림답' });
    ok('callGeminiStream 도 codex 로 가서 완성된 답을 한 번에 준다', job && job.prompt === 'S' && chunks.join('') === '스트림답', JSON.stringify(chunks));
    const outside = await gemini.callGemini({ model: 'm', contents: 'P', config: {}, caller: 'c' });
    ok('요청 밖 callGemini 는 기존 경로(키 없음 실패) — codex 로 새지 않는다', outside.success === false && /GEMINI_API_KEY/.test(outside.error || ''), JSON.stringify(outside));
  }

  console.log(`\n  ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
