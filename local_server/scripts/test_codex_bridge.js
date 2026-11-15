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
function through(body, headers, fn, cfg) {
  const res = fakeRes();
  let out;
  bridge.withRequest(fakeReq(body, headers), res, () => { out = fn(); }, cfg);
  return { res, out };
}
const LUNA = { answerModel: 'gpt-6-luna', codexForUsers: false };

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

  console.log('\n── ①-2 관리자 센터 설정(작업자가 아직 한 번도 안 온 상태) ──');
  {
    const a = through({}, { 'X-Admin-Token': 'GOOD' }, () => bridge.active(), LUNA);
    ok('설정 Luna + 관리자 기기 + 작업자 없음 → Gemini 로 답한다(앱 사용자가 답을 못 받는 일 없게)', a.out === false && !('X-Nrya-LLM' in a.res.headers));
    const b = through({ llm: 'codex' }, { 'X-Admin-Token': 'GOOD' }, () => bridge.active(), LUNA);
    ok('시험 llm:codex 는 작업자가 없어도 codex 로 표시(실패로 드러나게 — 몰래 안 바꿈)', b.out === true);
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
  // ③·④ 의 가짜 작업자는 헤더 X-Codex-Worker 가 없다 = VM 작업자. 실행 위치를 VM 으로 맞춰 둔다(기본은 fly — ⑥ 에서 따로 고정).
  bridge.setRunner('vm');
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

  console.log('\n── ⑤ 관리자 센터 설정(작업자 연결됨) ──');
  {
    const w = fakeRes(); bridge.poll(fakeReq({}, secretH), w);   // 작업자가 방금 왔다
    // [2026-11-02] 평소 질문(④)은 ChatGPT 직행이 아니라 답변 AI 사슬(services/llm_chain.js)로 간다.
    //   'chain:<모델>' = 사슬 표시 + ChatGPT 칸이 쓸 모델(null 이면 ChatGPT 칸 건너뜀). 헤더는 codex 직행(시험 llm:codex)만.
    const cases = [
      ['설정 Luna + 관리자 기기(llm 없음) → 사슬·Luna', {}, { 'X-Admin-Token': 'GOOD' }, LUNA, 'chain:gpt-6-luna', null],
      ['설정 Luna + 일반 사용자 + 사용자 스위치 꺼짐 → Gemini·헤더 없음(바이트 동일)', {}, {}, LUNA, 'gemini', null],
      ['설정 Luna + 일반 사용자 + 사용자 스위치 켜짐 → 사슬', {}, {}, { answerModel: 'gpt-6-luna', codexForUsers: true }, 'chain:gpt-6-luna', null],
      ['설정 gemini + 사용자 스위치 켜짐 → 사슬·ChatGPT 칸 없음', {}, { 'X-Admin-Token': 'GOOD' }, { answerModel: 'gemini', codexForUsers: true }, 'chain:null', null],
      ['설정 Sol + 관리자 기기 → 사슬·Sol', {}, { 'X-Admin-Token': 'GOOD' }, { answerModel: 'gpt-6-sol' }, 'chain:gpt-6-sol', null],
      ['시험 llm:gemini + 관리자 + 설정 Luna → Gemini(비교 기준군)', { llm: 'gemini' }, { 'X-Admin-Token': 'GOOD' }, LUNA, 'gemini', null],
      ['시험 llm:codex + 설정 gemini → codex·기본 Luna', { llm: 'codex' }, { 'X-Admin-Token': 'GOOD' }, { answerModel: 'gemini' }, 'codex', 'gpt-6-luna'],
      ['틀린 모델 이름이 설정에 들어와도 ChatGPT 칸에 안 실림', {}, { 'X-Admin-Token': 'GOOD' }, { answerModel: 'rm -rf' }, 'chain:null', null],
    ];
    const where = () => { const st = bridge.store(); return !st ? 'gemini' : st.codex ? 'codex' : 'chain:' + st.model; };
    for (const [name, body, headers, cfg, want, model] of cases) {
      const r = through(body, headers, where, cfg);
      const gotModel = r.res.headers['X-Nrya-Model'] || null;
      ok(name, r.out === want && gotModel === model, JSON.stringify({ where: r.out, headers: r.res.headers }));
    }
    const { job } = await roundTrip(() => {
      let p; through({ llm: 'codex' }, { 'X-Admin-Token': 'GOOD' }, () => { p = bridge.callRaw({ contents: 'M', caller: 'm' }); }, { answerModel: 'gpt-6-astra' });
      return p;
    }, { ok: true, text: 'x' });
    ok('일감에 설정 모델이 실려 작업자에게 간다', job && job.model === 'gpt-6-astra', JSON.stringify(job));
  }

  console.log('\n── ⑥ 답변 끝 「어느 AI 가 답했는지」 한 줄 ──');
  {
    ok('요청 밖(Gemini) → Gemini 2.5 Flash', bridge.answerLabel('gemini-2.5-flash') === '\n\n※ 이 답변은 Gemini 2.5 Flash 모델이 답했습니다.', JSON.stringify(bridge.answerLabel('gemini-2.5-flash')));
    const l = through({ llm: 'codex' }, { 'X-Admin-Token': 'GOOD' }, () => bridge.answerLabel('gemini-2.5-flash'), { answerModel: 'gpt-6-sol' }).out;
    ok('codex 요청 안 → 그 모델(ChatGPT GPT-6 Sol)', l === '\n\n※ 이 답변은 ChatGPT GPT-6 Sol 모델이 답했습니다.', JSON.stringify(l));
    const g = through({}, {}, () => bridge.answerLabel('gemini-2.5-flash'), LUNA).out;
    ok('일반 사용자(스위치 꺼짐) → Gemini', /Gemini 2\.5 Flash/.test(g), JSON.stringify(g));
  }

  console.log('\n── ⑥ 실행 위치(fly|vm) 고르기 ──');
  {
    const flyH = { 'X-Codex-Secret': SECRET, 'X-Codex-Worker': 'fly' }, vmH = { 'X-Codex-Secret': SECRET };
    const tick = () => new Promise(r => setImmediate(r));
    bridge.setRunner('vm');
    const fr = fakeRes(), vr = fakeRes();
    bridge.poll(fakeReq({}, flyH), fr);
    bridge.poll(fakeReq({}, vmH), vr);
    ok('두 작업자가 함께 기다려도 서로의 대기를 끊지 않는다', fr.done === false && vr.done === false);
    let p = bridge.callRaw({ contents: 'A', caller: 't' }); await tick();
    ok('위치=vm → 일감은 VM 작업자에게만', vr.body && vr.body.prompt === 'A' && fr.done === false, JSON.stringify({ vm: vr.body, fly: fr.done }));
    bridge.result(fakeReq({ id: vr.body.id, ok: true, text: 'a' }, vmH), fakeRes());
    ok('VM 작업자 답이 돌아온다', (await p).response.text === 'a');
    // VM 은 지금 자리가 없다(일감을 가져갔으니). 일감을 줄에 세운 채 fly 로 바꾸면 기다리던 fly 가 바로 받는다.
    p = bridge.callRaw({ contents: 'B', caller: 't' }); await tick();
    ok('VM 자리가 비면 일감은 줄에서 기다린다(fly 에게 새지 않는다)', fr.done === false);
    bridge.setRunner('fly'); await tick();
    ok('위치를 fly 로 바꾸는 순간 줄의 일감이 fly 작업자에게 간다', fr.body && fr.body.prompt === 'B', JSON.stringify(fr.body));
    bridge.result(fakeReq({ id: fr.body.id, ok: true, text: 'b' }, flyH), fakeRes());
    ok('fly 작업자 답이 돌아온다', (await p).response.text === 'b');
    // 바꾼 직후 옛 쪽이 끝낸 답도 받는다.
    const vr2 = fakeRes(); bridge.setRunner('vm'); bridge.poll(fakeReq({}, vmH), vr2);
    p = bridge.callRaw({ contents: 'C', caller: 't' }); await tick();
    bridge.setRunner('fly');
    bridge.result(fakeReq({ id: vr2.body.id, ok: true, text: 'c' }, vmH), fakeRes());
    ok('위치를 바꾼 뒤에도 옛 쪽이 이미 가져간 일감의 답은 받는다', (await p).response.text === 'c');
    const w = bridge.workers();
    ok('workers(): 고른 위치와 위치별 연결 상태', w.runner === 'fly' && w.fly === true && w.vm === true, JSON.stringify(w));
    bridge.setRunner('nonsense');
    ok('틀린 값 → 기본 fly', bridge.workers().runner === 'fly');
    // 안 고른 쪽만 살아 있으면 연결 없음으로 본다(작업자 없는 쪽에 일감을 세워 두고 5분 기다리지 않게).
    const realNow = Date.now; Date.now = () => realNow() + 95 * 1000;   // 둘 다 낡게
    const vr3 = fakeRes(); bridge.poll(fakeReq({}, vmH), vr3);          // VM 만 방금 옴
    ok('위치=fly 인데 VM 만 살아 있으면 workerAlive 거짓', bridge.workerAlive() === false);
    const r = await bridge.callRaw({ contents: 'D', caller: 't' });
    ok('그때 callRaw 는 바로 「Fly 작업자 연결 없음」 실패', r.success === false && /Fly 작업자 연결 없음/.test(r.error || ''), JSON.stringify(r));
    Date.now = realNow;
    // 연결 안 된 쪽으로 바꾸면 줄의 일감은 5분 기다리지 않고 바로 실패(독립 검토 지적 1).
    bridge.setRunner('vm');
    const vb = fakeRes(); bridge.poll(fakeReq({}, vmH), vb);
    const pa = bridge.callRaw({ contents: 'E1', caller: 't' }); await tick();        // VM 이 가져감(자리 비움)
    const pq = bridge.callRaw({ contents: 'E2', caller: 't' }); await tick();        // 줄에 섬
    Date.now = () => realNow() + 95 * 1000;   // fly 는 낡음(마지막 접속 95초 전)
    bridge.setRunner('fly');
    const rq = await pq;
    ok('연결 없는 쪽으로 바꾸면 줄의 일감은 바로 「작업자 연결 없음」 실패', rq.success === false && /Fly 작업자 연결 없음/.test(rq.error || ''), JSON.stringify(rq));
    Date.now = realNow;
    bridge.result(fakeReq({ id: vb.body.id, ok: true, text: 'e1' }, vmH), fakeRes());
    ok('그때 이미 가져간 일감은 그대로 답을 받는다', (await pa).response.text === 'e1');
    // 일감마다 위치 지정(runner) — AI 특보 분석. 기본 위치가 fly 여도 vm 으로 지정한 일감은 VM 에게만.
    const f2 = fakeRes(), v2 = fakeRes();
    bridge.poll(fakeReq({}, flyH), f2); bridge.poll(fakeReq({}, vmH), v2);
    const pv = bridge.callRaw({ contents: 'P1', caller: 't', runner: 'vm' }); await tick();
    ok('runner:vm 으로 지정한 일감은 기본 위치(fly)와 상관없이 VM 에게', v2.body && v2.body.prompt === 'P1' && f2.done === false, JSON.stringify({ v: v2.body, f: f2.done }));
    const pf = bridge.callRaw({ contents: 'P2', caller: 't' }); await tick();
    ok('지정 없는 일감은 기본 위치(fly)로', f2.body && f2.body.prompt === 'P2');
    bridge.result(fakeReq({ id: v2.body.id, ok: true, text: 'p1' }, vmH), fakeRes());
    bridge.result(fakeReq({ id: f2.body.id, ok: true, text: 'p2' }, flyH), fakeRes());
    ok('두 위치 답이 각자 돌아온다', (await pv).response.text === 'p1' && (await pf).response.text === 'p2');
    // 지정한 일감은 기본 위치를 바꿔도 따라가지 않는다(VM 줄에서 기다린다).
    const pv2 = bridge.callRaw({ contents: 'P3', caller: 't', runner: 'vm' }); await tick();
    bridge.setRunner('vm'); bridge.setRunner('fly');
    const v3 = fakeRes(); bridge.poll(fakeReq({}, vmH), v3);
    ok('지정한 일감은 기본 위치를 바꿔도 지정한 쪽이 가져간다', v3.body && v3.body.prompt === 'P3', JSON.stringify(v3.body));
    bridge.result(fakeReq({ id: v3.body.id, ok: true, text: 'p3' }, vmH), fakeRes()); await pv2;
  }

  console.log(`\n  ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
