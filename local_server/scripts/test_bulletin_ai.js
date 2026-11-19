/**
 * test_bulletin_ai.js — 「AI 모델 설정」(종전 「AI 특보 분석」) 기능별 AI 순서(services/bulletin_ai.js — ① 특보 읽기·② 참고사항 해석·④ 연안 안전 브리핑)와 그 API·일감별 실행 위치를 고정한다.
 *
 * 왜 있나: ① 특보 읽기는 푸시에 직결된다. 순서대로 시도·실패 시 다음 순위·Gemini 를 뺄 수 없음·틀린 값 거절이
 *   조용히 깨지면 특보가 엉뚱한 AI 로 읽히거나 아예 안 읽힌다. 실제 AI·네트워크는 부르지 않는다(가짜로 바꿔 끼움).
 * [연계] → services/bulletin_ai.js · routes/bulletin_watch.js · services/codex_bridge.js · scripts/refactor/verify_all.sh(SUITES)
 * 쓰는 법: node local_server/scripts/test_bulletin_ai.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bai-'));
process.env.BULLETIN_AI_CONFIG_FILE = path.join(tmp, 'cfg.json');
process.env.NRYA_CODEX_SECRET = 'test-secret-0123456789';

const llm = require('../services/llm_chain');
const bridge = require('../services/codex_bridge');
const gemini = require('../services/gemini_client');
const bai = require('../services/bulletin_ai');

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); } }

const calls = [];
const behave = {};   // id → 'ok' | 'fail'
llm.callDirect = async (id, args, pick) => { calls.push({ id, pick }); return behave[id] === 'ok' ? { success: true, response: { text: '```json\n{"by":"' + id + '"}\n```' }, keyLabel: id } : { success: false, error: id + ' 실패' }; };
bridge.callRaw = async (a) => { calls.push({ id: 'chatgpt', model: a.model, runner: a.runner }); return behave.chatgpt === 'ok' ? { success: true, response: { text: '{"by":"chatgpt"}' } } : { success: false, error: 'chatgpt 실패' }; };
gemini.callGemini = async (a) => { calls.push({ id: 'gemini', model: a.model }); return behave.gemini === 'ok' ? { success: true, text: '{"by":"gemini"}', keyLabel: 'k' } : { success: false, error: 'gemini 실패', isRateLimited: true }; };

(async () => {
  console.log('── ① 기본값 ──');
  {
    const c = bai.getConfig();
    ok('파일 없음 → ① 특보 읽기 기본 1순위는 Gemini(종전 동작)', c.read.order[0] === 'gemini' && c.read.order.length === 5, c.read.order.join(','));
    ok('① 기본은 Gemini 만 쓴다(나머지는 삭제 상태 — 종전 동작, 키가 생겨도 몰래 크레딧 안 씀)', c.read.removed.length === 4 && !c.read.removed.includes('gemini'), JSON.stringify(c.read.removed));
    ok('② 참고사항 해석 기본 1순위는 클로드 키2 · 삭제 없음', c.interpret.order[0] === 'claude2' && c.interpret.removed.length === 0);
    ok('③ 해상 기상 전망 색칠 기본 = Gemini 만(종전 Gemini 고정 그대로)', c.forecast.order[0] === 'gemini' && c.forecast.removed.length === 4 && !c.forecast.removed.includes('gemini'), JSON.stringify(c.forecast));
    ok('ChatGPT 칸 기본 = Luna · Fly', c.read.models.chatgpt.model === 'gpt-6-luna' && c.read.models.chatgpt.runner === 'fly' && c.read.models.chatgpt.effort === null, JSON.stringify(c.read.models.chatgpt));
  }
  console.log('\n── ② 저장 검사 ──');
  {
    ok('틀린 기능 이름 → 거절', bai.setConfig('x', {}).ok === false);
    ok('__proto__·constructor 이름 → 거절(전역 객체 오염 없음)', bai.setConfig('__proto__', { order: ['gemini', 'claude1', 'claude2', 'upstage', 'chatgpt'] }).ok === false && bai.setConfig('constructor', {}).ok === false && ({}).order === undefined);
    ok('순서가 다섯 개 순열이 아니면 거절', bai.setConfig('read', { order: ['gemini'] }).ok === false);
    ok('Gemini 삭제 → 거절(마지막 안전망)', bai.setConfig('read', { removed: ['gemini'] }).ok === false);
    ok('ChatGPT 실행 위치가 fly|vm 밖이면 거절', bai.setConfig('read', { models: { chatgpt: { model: 'gpt-6-sol', runner: 'mars' } } }).ok === false);
    ok('목록 밖 모델 → 거절', bai.setConfig('read', { models: { claude1: { model: 'nope', effort: 'low' } } }).ok === false);
    ok('Gemini 모델은 고를 수 없음', bai.setConfig('read', { models: { gemini: { model: 'x' } } }).ok === false);
    const r = bai.setConfig('read', { order: ['chatgpt', 'claude1', 'upstage', 'gemini', 'claude2'], models: { chatgpt: { model: 'gpt-6-sol', runner: 'vm' }, claude1: { model: 'claude-opus-5-5', effort: 'high' } } });
    ok('맞는 값 → 저장', r.ok && r.config.read.order[0] === 'chatgpt' && r.config.read.models.chatgpt.runner === 'vm' && r.config.read.models.claude1.model === 'claude-opus-5-5', JSON.stringify(r));
    const r2 = bai.setConfig('read', { models: { chatgpt: { model: 'gpt-6-astra' } } });
    ok('모델만 바꾸면 실행 위치는 그대로', r2.ok && r2.config.read.models.chatgpt.runner === 'vm' && r2.config.read.models.chatgpt.model === 'gpt-6-astra');
    ok('한 기능 저장이 다른 기능을 안 건드린다', bai.getConfig().interpret.order[0] === 'claude2');
    fs.writeFileSync(process.env.BULLETIN_AI_CONFIG_FILE, '{깨진');
    ok('설정 파일이 깨지면 기본값(Gemini 1순위)', bai.getConfig().read.order[0] === 'gemini');
    fs.writeFileSync(process.env.BULLETIN_AI_CONFIG_FILE, 'null');   // §11.10.51 독립 검토 7 — 종전엔 TypeError(브리핑 실행이 이 설정을 읽으므로 실행이 통째로 실패)
    let nul = null; try { nul = bai.getConfig(); } catch (e) { nul = e; }
    ok('설정 파일 내용이 null 이어도 기본값(던지지 않음)', nul && !(nul instanceof Error) && nul.briefing.order[0] === 'claude2', String(nul));
  }
  console.log('\n── ③ 순서대로 시도 ──');
  {
    bai.setConfig('read', { order: ['chatgpt', 'claude1', 'upstage', 'gemini', 'claude2'], removed: ['upstage'], models: { chatgpt: { model: 'gpt-6-sol', runner: 'vm' } } });
    Object.assign(behave, { chatgpt: 'fail', claude1: 'ok', gemini: 'ok' }); calls.length = 0;
    const r = await bai.call('read', 'P');
    ok('1순위 실패 → 2순위가 답한다', r.success && r.provider === 'claude1' && JSON.parse(r.text).by === 'claude1', JSON.stringify(r));
    ok('ChatGPT 는 고른 모델·실행 위치로 부른다', calls[0].id === 'chatgpt' && calls[0].model === 'gpt-6-sol' && calls[0].runner === 'vm', JSON.stringify(calls[0]));
    ok('JSON 답의 ``` 를 벗긴다', r.text === '{"by":"claude1"}');
    Object.assign(behave, { chatgpt: 'fail', claude1: 'fail', upstage: 'ok', gemini: 'ok', claude2: 'ok' }); calls.length = 0;
    const r2 = await bai.call('read', 'P');
    ok('삭제한 AI(업스테이지)는 건너뛴다', r2.provider === 'gemini' && !calls.some(c => c.id === 'upstage'), calls.map(c => c.id).join(','));
    ok('Gemini 는 gemini-2.5-flash-lite 로', calls.find(c => c.id === 'gemini').model === 'gemini-2.5-flash-lite');
    Object.assign(behave, { chatgpt: 'fail', claude1: 'fail', gemini: 'fail', claude2: 'fail' }); calls.length = 0;
    const r3 = await bai.call('read', 'P');
    ok('전부 실패 → 실패(마지막 오류)·시도 기록', r3.success === false && r3.tried.length === 4 && r3.error === 'claude2 실패', JSON.stringify(r3));
    ok('도중에 Gemini 가 한도 초과(429)였으면 마지막이 다른 AI 여도 isRateLimited(10분 재시도 분기 유지)', r3.isRateLimited === true);
    ok('forecast 기본 순서 → Gemini 만 부른다(gemini-2.5-flash-lite)', (await (async () => { behave.gemini = 'ok'; calls.length = 0; const x = await bai.call('forecast', 'P'); return x.provider === 'gemini' && calls.length === 1 && calls[0].model === 'gemini-2.5-flash-lite'; })()));
    ok('forecast 순서를 바꾸면 그 순서로(클로드 키2 1순위)', (await (async () => {
      bai.setConfig('forecast', { order: ['claude2', 'gemini', 'claude1', 'upstage', 'chatgpt'], removed: ['claude1', 'upstage', 'chatgpt'] });
      behave.claude2 = 'ok'; calls.length = 0; const x = await bai.call('forecast', 'P');
      return x.provider === 'claude2' && calls[0].id === 'claude2' && bai.getConfig().read.order[0] === 'chatgpt';   // read 순서는 그대로
    })()));
    ok('read 와 interpret 는 각자 순서를 쓴다', (await (async () => { behave.claude2 = 'ok'; calls.length = 0; const x = await bai.call('interpret', 'P'); return x.provider === 'claude2' && calls[0].id === 'claude2'; })()));
  }
  console.log('\n── ④ API ──');
  {
    const express = require('express');
    const router = require('../routes/bulletin_watch').createRouter({ bulletinAi: bai, authorize: (q, s, n) => n() });
    const app = express(); app.use(express.json()); app.use(router);
    const srv = app.listen(0); const base = 'http://127.0.0.1:' + srv.address().port;
    const g = await (await fetch(base + '/api/admin/bulletin-ai/config')).json();
    ok('GET → 설정·선택지(ChatGPT 실행 위치 포함)·작업자 상태', g.ok && g.config.read && g.choices.chatgpt.runners.join() === 'fly,vm' && 'fly' in g.workers, JSON.stringify(Object.keys(g)));
    const bad = await fetch(base + '/api/admin/bulletin-ai/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feature: 'read', removed: ['gemini'] }) });
    ok('POST 틀린 값 → 400', bad.status === 400);
    const good = await (await fetch(base + '/api/admin/bulletin-ai/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feature: 'interpret', models: { chatgpt: { model: 'gpt-6-luna', runner: 'vm' } } }) })).json();
    ok('POST 맞는 값 → 저장된 상태를 돌려준다', good.ok && good.config.interpret.models.chatgpt.runner === 'vm');
    // §11.10.51 ④ 연안 안전 브리핑(2026-11-16 사용자 — 순서 「클로드 2번, 클로드 1번, 업스테이지, gpt, gemini」 · 다시 시도 「(나)」 줄마다 횟수)
    ok('④ briefing 기본: 순서 클로드 키2→키1→업스테이지→ChatGPT→Gemini · 삭제 없음 · 시도 ChatGPT 3 나머지 1 · Gemini 모델 gemini-2.5-flash · ChatGPT 실행 위치 VM(종전 브리핑 그대로 — ①② 기본은 Fly)',
      g.config.briefing && g.config.briefing.order.join() === 'claude2,claude1,upstage,chatgpt,gemini' && g.config.briefing.removed.length === 0
      && JSON.stringify(g.config.briefing.attempts) === JSON.stringify({ upstage: 1, claude1: 1, claude2: 1, chatgpt: 3, gemini: 1 }) && g.config.briefing.models.gemini.model === 'gemini-2.5-flash' && g.config.briefing.models.chatgpt.runner === 'vm', JSON.stringify(g.config.briefing));
    ok('선택지: 브리핑 Gemini 모델 2개·시도 1~3 · 그 Gemini 모델 목록 = 브리핑 설정의 종전 선택지(station_briefing.CHOICES.geminiModel)',
      g.choices.briefing && g.choices.briefing.attempts.join() === '1,2,3' && g.choices.briefing.geminiModels.join() === require('../services/station_briefing').CHOICES.geminiModel.join());
    const post = async (body) => fetch(base + '/api/admin/bulletin-ai/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const pb = await (await post({ feature: 'briefing', attempts: { claude2: 2 }, models: { gemini: { model: 'gemini-2.5-flash-lite' }, chatgpt: { model: llm.CHOICES.chatgpt.models[0], runner: 'vm' } } })).json();
    ok('POST briefing 시도·Gemini 모델·ChatGPT 실행 위치 저장', pb.ok && pb.config.briefing.attempts.claude2 === 2 && pb.config.briefing.attempts.chatgpt === 3 && pb.config.briefing.models.gemini.model === 'gemini-2.5-flash-lite' && pb.config.briefing.models.chatgpt.runner === 'vm', JSON.stringify(pb.config && pb.config.briefing));
    ok('틀린 값 400: 시도 4 · 시도는 briefing 만 · Gemini 모델은 briefing 만 · 목록 밖 Gemini 모델 · Gemini 삭제',
      (await post({ feature: 'briefing', attempts: { claude2: 4 } })).status === 400 && (await post({ feature: 'read', attempts: { claude2: 2 } })).status === 400
      && (await post({ feature: 'interpret', models: { gemini: { model: 'gemini-2.5-flash' } } })).status === 400 && (await post({ feature: 'briefing', models: { gemini: { model: 'gemini-9' } } })).status === 400
      && (await post({ feature: 'briefing', removed: ['gemini'] })).status === 400);
    await post({ feature: 'briefing', removed: ['claude1'] });
    const ch = bai.briefingChain();
    ok('briefingChain — 삭제한 AI 를 빼고 순서대로, 칸마다 모델·노력·실행 위치·시도', ch.map((c) => c.id).join() === 'claude2,upstage,chatgpt,gemini'
      && ch[0].attempts === 2 && ch[0].effort === 'medium' && ch[2].runner === 'vm' && ch[2].attempts === 3 && ch[3].model === 'gemini-2.5-flash-lite' && ch[0].runner === null, JSON.stringify(ch));
    ok('①·② 응답 꼴은 그대로(attempts·gemini 모델 칸 없음)', !('attempts' in bai.getConfig().read) && !('gemini' in bai.getConfig().interpret.models));
    // ── Gemma(2026-11-19 사용자 「젬마가 색칠하는 기능을 넣자 격상읽기는 하지말고. 단, 젬마가 색칠할 수 없는 문제, 한도 초과, 서버 붐빔 등 문제가 있다면
    //    그때 내가 선택한 api가 호출하여 색칠하도록 하자」 · 키는 「이미 플라이아이오 시크릿으로 반영된 gemini키인 GEMINI_API_KEY_26_8 로 젬마를 호출」) ──
    console.log('\n── ⑤ Gemma — ③ 색칠에서만, 순서 맨 앞 「먼저 Gemma」 ──');
    const GOOD = '{"categories":{"해상":{"main":"{{loc:서해상}}에는 {{num:1.5~3.5m}}","sub":[]}},"by":"gemma"}';   // ③ 색칠이 쓸 수 있는 모양
    const plain = []; let gemmaAnswer = () => ({ success: true, text: '```json\n' + GOOD + '\n```' });
    gemini.callPlain = async (a) => { plain.push(a); return gemmaAnswer(a); };
    const g2 = await (await fetch(base + '/api/admin/bulletin-ai/config')).json();
    ok('선택지: ③·⑥ 에서만 · Gemma 두 모델(Gemini API 가 제공하는 것 — 실제로 불린 26b 가 앞) · 「시험 호출」은 기본 Gemini 모델도', g2.choices.gemma && g2.choices.gemma.features.join() === 'forecast,seasummary'
      && g2.choices.gemma.models.join() === 'gemma-4-26b-a4b-it,gemma-4-31b-it' && g2.choices.gemma.tryModels.join() === 'gemini-2.5-flash-lite,gemma-4-26b-a4b-it,gemma-4-31b-it', JSON.stringify(g2.choices.gemma));
    ok('기본은 종전 그대로 — ③ 의 gemma 칸은 비어 있다(쓰지 않음) · 다른 기능에는 그 칸이 없다', g2.config.forecast.gemma === '' && !('gemma' in g2.config.escalation) && !('gemma' in g2.config.read) && !('gemma' in g2.config.briefing) && !('gemini' in g2.config.forecast.models));
    // 관리자가 정한 순서: 클로드 키2 → Gemini (나머지는 삭제)
    await post({ feature: 'forecast', order: ['claude2', 'gemini', 'claude1', 'upstage', 'chatgpt'], removed: ['claude1', 'upstage', 'chatgpt'] });
    Object.assign(behave, { claude2: 'ok', gemini: 'ok' }); calls.length = 0; plain.length = 0;
    const d0 = await bai.call('forecast', 'P');
    ok('고르지 않으면 Gemma 를 부르지 않는다(종전과 같은 호출 — 정한 순서의 1순위가 답한다)', d0.provider === 'claude2' && plain.length === 0 && calls.length === 1 && calls[0].id === 'claude2');
    const sv = await (await post({ feature: 'forecast', gemma: 'gemma-4-26b-a4b-it' })).json();
    ok('③ 에 「먼저 Gemma」 저장 — 순서·다른 기능은 그대로', sv.ok && sv.config.forecast.gemma === 'gemma-4-26b-a4b-it' && sv.config.forecast.order[0] === 'claude2' && sv.config.forecast.removed.length === 3
      && sv.config.briefing.models.gemini.model === 'gemini-2.5-flash-lite' && bai.getConfig().read.order[0] === 'chatgpt');
    ok('틀린 값 400: 다른 기능(①②④⑤)에는 Gemma 못 고름 · 목록 밖 모델 · Gemini 칸 모델로는 못 고름', (await post({ feature: 'read', gemma: 'gemma-4-26b-a4b-it' })).status === 400
      && (await post({ feature: 'interpret', gemma: 'gemma-4-26b-a4b-it' })).status === 400 && (await post({ feature: 'briefing', gemma: 'gemma-4-26b-a4b-it' })).status === 400
      && (await post({ feature: 'escalation', gemma: 'gemma-4-26b-a4b-it' })).status === 400 && (await post({ feature: 'forecast', gemma: 'gemma-3-27b-it' })).status === 400
      && (await post({ feature: 'forecast', models: { gemini: { model: 'gemma-4-26b-a4b-it' } } })).status === 400 && bai.getConfig().forecast.gemma === 'gemma-4-26b-a4b-it');
    calls.length = 0; plain.length = 0;
    const d1 = await bai.call('forecast', 'P', { caller: 'MarineForecast' });
    ok('골랐으면 Gemma 가 먼저 색칠한다 — JSON 모드 없이·생각 최소로(실제 키로 확인: JSON 모드는 답을 배열로 싸고, 생각 기본은 글 한 편에 2~3분) · 답의 ``` 는 벗긴다 · 다른 AI 는 안 부른다',
      d1.success && d1.provider === 'gemma' && d1.keyLabel === 'gemma:gemma-4-26b-a4b-it' && JSON.parse(d1.text).by === 'gemma' && plain.length === 1 && plain[0].model === 'gemma-4-26b-a4b-it'
      && JSON.stringify(plain[0].config) === '{"thinkingConfig":{"thinkingLevel":"minimal"}}' && plain[0].caller === 'MarineForecast-Gemma' && calls.length === 0, JSON.stringify([d1, plain]));
    ok('마지막 Gemma 결과가 관리자 화면용으로 남는다(성공)', bai.gemmaStatus().forecast && bai.gemmaStatus().forecast.ok === true && bai.gemmaStatus().forecast.model === 'gemma-4-26b-a4b-it');
    // Gemma 가 색칠하지 못하는 경우들 → 관리자가 정한 순서(클로드 키2 → Gemini)로
    const falls = [
      ['한도 초과(429)', () => ({ success: false, error: '429 RESOURCE_EXHAUSTED You exceeded your current quota', isRateLimited: true })],
      ['서버 붐빔(503 수요 과다)', () => ({ success: false, error: '503 UNAVAILABLE This model is currently experiencing high demand' })],
      ['시간 초과', () => ({ success: false, error: '60초 안에 답이 없다(시간 초과)' })],
      ['빈 답', () => ({ success: true, text: '   ' })],
      ['JSON 이 아닌 답', () => ({ success: true, text: '네, 색을 입혀 드리겠습니다.' })],
      ['필요한 칸이 없는 JSON({})', () => ({ success: true, text: '{}' })],
      ['필요한 칸이 없는 JSON([])', () => ({ success: true, text: '[]' })],
      ['categories 가 글', () => ({ success: true, text: '{"categories":"x"}' })],
      ['categories 가 빈 객체', () => ({ success: true, text: '{"categories":{}}' })],
      ['색 표시 꼴이 깨짐(실제 Gemma 답 꼴 — }for})', () => ({ success: true, text: '{"categories":{"해상":{"main":"{{num:30~60km/h(8~16m/s)}for}로 불고","sub":[]}}}' })],
      ['색 표시가 안 닫힘', () => ({ success: true, text: '{"categories":{"해상":{"main":"{{loc:서해상 에는","sub":[]}}}' })],
      ['Gemma 호출이 던짐', () => { throw new Error('network down'); }],
    ];
    let allFell = true; const fellNote = [];
    for (const [name, fn] of falls) {
      gemmaAnswer = fn; calls.length = 0;
      const x = await bai.call('forecast', 'P');
      const good = x.success && x.provider === 'claude2' && JSON.parse(x.text).by === 'claude2' && calls.length === 1 && calls[0].id === 'claude2' && x.tried[0].id === 'gemma' && x.tried[0].ok === false && !x.isRateLimited && bai.gemmaStatus().forecast.ok === false;
      if (!good) { allFell = false; fellNote.push(name + ' → ' + JSON.stringify(x).slice(0, 200)); }
    }
    ok('Gemma 가 색칠하지 못하면(한도 초과·서버 붐빔·시간 초과·빈 답·JSON 아님·필요한 칸 없음·색 표시 깨짐·예외 — ' + falls.length + '가지) 관리자가 정한 순서의 1순위(클로드 키2)가 대신 색칠한다', allFell, fellNote.join(' | '));
    ok('대신 색칠한 사실이 관리자 화면용으로 남는다(조용히 대신하면 고장이 안 보인다) — 서버를 올린 뒤 성공·실패 횟수도', bai.gemmaStatus().forecast.ok === false && /network down/.test(bai.gemmaStatus().forecast.error)
      && bai.gemmaStatus().forecast.okCount === 1 && bai.gemmaStatus().forecast.failCount === falls.length, JSON.stringify(bai.gemmaStatus()));
    gemmaAnswer = () => ({ success: false, error: '503 UNAVAILABLE' }); behave.claude2 = 'fail'; calls.length = 0;
    const d2 = await bai.call('forecast', 'P');
    ok('Gemma 도 1순위도 안 되면 순서의 다음(Gemini)이 — 순서를 끝까지 탄다', d2.success && d2.provider === 'gemini' && calls.map((c) => c.id).join() === 'claude2,gemini' && d2.tried.map((t) => t.id).join() === 'gemma,claude2,gemini');
    behave.gemini = 'fail'; const d3 = await bai.call('forecast', 'P');
    ok('전부 안 되면 실패를 돌려준다(던지지 않는다) — 한도 초과 표시는 순서 쪽 AI 기준 그대로', d3.success === false && d3.isRateLimited === true && d3.tried.length === 3);
    Object.assign(behave, { claude2: 'ok', gemini: 'ok' });
    // 실제 키로 본 답 꼴 — 울타리 뒤에 설명을 덧붙임 · 한 겹 배열로 쌈
    gemmaAnswer = () => ({ success: true, text: '```json\n' + GOOD + '\n```\n*(참고: 원문에서 해역이 두 곳이며 …)*' }); calls.length = 0;
    const dA = await bai.call('forecast', 'P');
    ok('답 뒤에 설명을 덧붙여도 JSON 덩어리를 꺼내 쓴다(실제 Gemma 답 꼴)', dA.success && dA.provider === 'gemma' && JSON.parse(dA.text).by === 'gemma' && calls.length === 0, JSON.stringify(dA));
    gemmaAnswer = () => ({ success: true, text: '[' + GOOD + ']' }); calls.length = 0;
    ok('한 겹 배열로 싼 답(`[{…}]`)도 벗겨 쓴다(실제 Gemma 답 꼴)', JSON.parse((await bai.call('forecast', 'P')).text).by === 'gemma' && calls.length === 0);
    gemmaAnswer = () => ({ success: true, text: '{"summary":"{{loc:서해상}}에 바람","by":"gemma"}' }); calls.length = 0;
    ok('지방청 전망 꼴(summary 글)도 쓸 수 있는 답이다', JSON.parse((await bai.call('forecast', 'P')).text).by === 'gemma' && calls.length === 0);
    // 부르는 쪽 검사(gemmaAccept) — 원문 줄을 빼먹은 답
    gemmaAnswer = () => ({ success: true, text: GOOD }); calls.length = 0;
    const seen = [];
    const dK = await bai.call('forecast', 'P', { gemmaAccept: (p) => { seen.push(p.by); return false; } });
    ok('부르는 쪽이 「못 쓰는 답」이라 하면(원문 줄을 빼먹음) 순서의 다음 AI 로 — 그 검사는 Gemma 답에만 걸린다', dK.provider === 'claude2' && seen.join() === 'gemma' && calls.length === 1);
    {
      const M = require('../marine_forecast_processor');
      const code = { 강풍: '강풍특보가 발효된 충남서해안은 바람이 순간풍속 70km/h(20m/s) 이상으로 매우 강하게 불겠습니다.\no 간판, 비닐하우스 등 실외 설치 시설물 점검 및 농작물 관리 철저\no 현수막, 나뭇가지 등 낙하물과 쓰러지거나 부러진 나무에 의한 피해가 우려되니, 보행자와 교통 안전 각별히 유의\no 매우 강한 바람으로 인해 항공기 운항에 차질이 있을 수 있으니 공항 이용객들은 사전에 운항정보 확인', 해상: '풍랑특보가 발효된 서해상은 물결이 1.5~3.5m로 매우 높게 일겠습니다.' };
      const full = { categories: { 강풍: { main: '{{warn:강풍특보}}가 발효된 {{loc:충남서해안}}은 바람이 {{num:순간풍속 70km/h(20m/s) 이상}}으로 매우 강하게 불겠습니다.', sub: ['- 간판, 비닐하우스 등 실외 설치 시설물 점검 및 농작물 관리 철저', '- 현수막, 나뭇가지 등 낙하물과 쓰러지거나 부러진 나무에 의한 피해가 우려되니, 보행자와 교통 안전 각별히 유의', '- 매우 강한 바람으로 인해 항공기 운항에 차질이 있을 수 있으니 공항 이용객들은 사전에 운항정보 확인'] }, 해상: { main: '{{warn:풍랑특보}}가 발효된 {{loc:서해상}}은 물결이 {{num:1.5~3.5m}}로 매우 높게 일겠습니다.', sub: [] } } };
      const dropped = JSON.parse(JSON.stringify(full)); dropped.categories.강풍.sub = [];
      const noCat = JSON.parse(JSON.stringify(full)); delete noCat.categories.해상;
      ok('날씨해설 색칠: 원문 줄을 다 지닌 답은 통과 · 유의사항 세 줄을 뺀 답(실제 Gemma 가 낸 꼴)·칸을 통째로 뺀 답은 못 쓰는 답', M.gemmaKeptText(full, code) === true && M.gemmaKeptText(dropped, code) === false && M.gemmaKeptText(noCat, code) === false && M.gemmaKeptText({}, code) === false && M.gemmaKeptText(full, {}) === true);
      ok('날씨해설 색칠은 그 검사를 어느 AI 답에든 건다(accept — 2026-11-19 오후, 종전 Gemma 답에만. 글자 확인)', !/gemmaAccept:/.test(fs.readFileSync(require('path').join(__dirname, '..', 'marine_forecast_processor.js'), 'utf8')) && /[^a-zA-Z]accept: \(p\) => gemmaKeptText\(p, codeExtracted\)/.test(fs.readFileSync(require('path').join(__dirname, '..', 'marine_forecast_processor.js'), 'utf8')));
      // 지방청 전망 — 글 전체 글자 수가 원문의 97% 이상 남아야 한다
      const R = require('../regional_bulletin_collector');
      const rawR = '<중점 사항>\n○ 당분간 서해중부해상에 바람이 매우 강하게 불고 물결이 매우 높게 일겠습니다.\n<강풍 및 풍랑>\n○ (강풍) 서해5도는 바람이 순간풍속 70km/h(20m/s) 이상으로 매우 강하게 불겠습니다.\n○ (풍랑) 풍랑특보가 발효 중인 서해중부해상은 바람이 25~60km/h(7~16m/s)로 매우 강하게 불고 물결이 1.0~3.5m로 매우 높게 일겠습니다.';
      const fullR = { summary: rawR.replace('서해중부해상에', '{{loc:서해중부해상}}에').replace('25~60km/h(7~16m/s)', '{{num:25~60km/h(7~16m/s)}}') };
      const droppedR = { summary: fullR.summary.split('\n').filter((l) => !/^○ \(풍랑\)/.test(l)).join('\n') };
      ok('지방청 전망 색칠: 원문 줄을 다 지닌 답은 통과 · (풍랑) 항목을 뺀 답·summary 없는 답은 못 쓰는 답 · 원문이 비면 안 따진다', R.gemmaKeptSummary(fullR, rawR) === true && R.gemmaKeptSummary(droppedR, rawR) === false && R.gemmaKeptSummary({}, rawR) === false && R.gemmaKeptSummary(null, rawR) === false && R.gemmaKeptSummary({}, '') === true);
      {
        // 실제 검사 함수를 accept 로 걸어 불러 본다: Gemma 가 줄을 뺀 답 → 순서의 AI(클로드 키2, 시험 대역은 GOOD 을 낸다 — summary 가 없어 역시 걸림) → 전부 실패로 돌려준다(부르는 쪽이 기존 색칠본·원문으로 물러난다)
        gemmaAnswer = () => ({ success: true, text: JSON.stringify(droppedR) }); calls.length = 0;
        const rj = await bai.call('forecast', 'P', { accept: (p) => R.gemmaKeptSummary(p, rawR) });
        gemmaAnswer = () => ({ success: true, text: JSON.stringify(fullR) });
        const okj = await bai.call('forecast', 'P', { accept: (p) => R.gemmaKeptSummary(p, rawR) });
        ok('색칠: 줄 빠짐 검사를 accept 로 걸면 Gemma 답도 순서 쪽 AI 답도 같은 검사를 거친다 — 줄을 뺀 답은 어느 AI 것이든 실패, 온전한 답은 통과', rj.success === false && rj.tried.length >= 2 && rj.tried.every((t) => !t.ok) && calls.length >= 1 && okj.success === true && okj.provider === 'gemma', JSON.stringify([rj.tried, okj.provider]).slice(0, 300));
      }
      {
        // 검사에 걸린 답이 거듭 나오는 통보문은 3번 뒤 더 부르지 않는다(주기마다 돈 드는 호출이 되풀이되지 않게) — 호출 자체가 실패한 것은 세지 않는다
        const realCall = bai.call;
        bai.call = async () => ({ success: false, error: '검사에 걸림', tried: [{ id: 'claude2', ok: false, error: 'x', raw: '{"categories":{}}' }] });
        const a1 = await M.analyzeWithAI('원문', code), rej = M.analyzeWithAI.lastRejected;
        bai.call = async () => ({ success: false, error: '503', tried: [{ id: 'gemma', ok: false, error: 'JSON 아님', raw: '깨진 답' }, { id: 'claude2', ok: false, error: '503' }] });
        const a2 = await M.analyzeWithAI('원문', code), down = M.analyzeWithAI.lastRejected;   // Gemma(무료)만 답하고 나머지는 호출 실패 → 세지 않는다
        // 검사와 같은 방법으로 읽는다: 한 겹 배열·뒤에 설명이 붙은 답도 쓴다 · 필요한 칸이 없는 「성공」은 못 쓰는 답으로 센다
        bai.call = async () => ({ success: true, text: '[' + JSON.stringify(full) + ']\n*(참고: …)*', keyLabel: 'claude2', tried: [] });
        const a3 = await M.analyzeWithAI('원문', code);
        bai.call = async () => ({ success: true, text: '{"issues":[]}', keyLabel: 'claude2', tried: [] });
        const a4 = await M.analyzeWithAI('원문', code), a4rej = M.analyzeWithAI.lastRejected;
        bai.call = async () => ({ success: true, text: '[' + JSON.stringify(fullR) + ']', keyLabel: 'claude2', tried: [] });
        const r3 = await R.analyzeBulletinWithAI(rawR);
        bai.call = async () => ({ success: true, text: '{"marineOutlooks":[]}', keyLabel: 'claude2', tried: [] });
        const r4 = await R.analyzeBulletinWithAI(rawR), r4rej = R.analyzeBulletinWithAI.lastRejected;
        bai.call = realCall;
        ok('색칠: 답을 검사와 같은 방법으로 읽는다(한 겹 배열·뒤 설명) · 필요한 칸(categories·summary)이 없는 「성공」은 못 쓰는 답으로 센다 — 검토', !!(a3 && a3.categories && a3.categories.강풍) && a4 === null && a4rej === true && !!(r3 && r3.summary === fullR.summary) && r4 === null && r4rej === true, JSON.stringify([!!a3, a4, a4rej, !!r3, r4, r4rej]));
        // 순서 쪽 AI 가 줄을 뺀 답을 내면 걸러지는가(대역이 낸 답을 줄 뺀 색칠본으로 바꿔서) — 97% 선에 실제로 걸리는지
        { const keep = llm.callDirect; let n = 0;
          llm.callDirect = async (id) => { n++; return { success: true, response: { text: JSON.stringify(id === 'claude2' ? droppedR : fullR) }, keyLabel: id }; };
          await post({ feature: 'forecast', gemma: '' });
          const viaOrder = await bai.call('forecast', 'P', { accept: (p) => R.gemmaKeptSummary(p, rawR) });
          llm.callDirect = async (id) => ({ success: true, response: { text: JSON.stringify(fullR) }, keyLabel: id });
          const viaOk = await bai.call('forecast', 'P', { accept: (p) => R.gemmaKeptSummary(p, rawR) });
          llm.callDirect = keep; await post({ feature: 'forecast', gemma: bai.GEMMA_MODELS[0] });
          ok('색칠: 순서 1순위(클로드 키2)가 줄을 뺀 답을 내면 그 답은 버린다(종전에는 그대로 나갔다 — 다음 순위로 넘어간다) · 온전한 답이면 그대로 쓴다', viaOrder.provider !== 'claude2' && n >= 1 && viaOrder.tried[0].id === 'claude2' && viaOrder.tried[0].ok === false && !!viaOrder.tried[0].raw && viaOk.success && viaOk.provider === 'claude2', JSON.stringify([viaOrder.provider, n, viaOrder.tried]).slice(0, 300)); }
        const mf = fs.readFileSync(require('path').join(__dirname, '..', 'marine_forecast_processor.js'), 'utf8'), rb = fs.readFileSync(require('path').join(__dirname, '..', 'regional_bulletin_collector.js'), 'utf8');
        ok('색칠: 「답은 왔는데 검사에 걸림」과 「호출 실패」를 가른다(앞의 것만 센다) · 같은 통보문에서 3번 쌓이면 본청·지방청 모두 더 부르지 않는다(글자 확인)', a1 === null && rej === true && a2 === null && down === false
          && /COLOR_REJECT_MAX = 3/.test(mf) && /\(cached\.colorRejects \|\| 0\) >= COLOR_REJECT_MAX/.test(mf) && /asked && !aiResult && analyzeWithAI\.lastRejected \? 1 : 0/.test(mf)
          && /COLOR_REJECT_MAX = 3/.test(rb) && /\(cached\.colorRejects \|\| 0\) >= COLOR_REJECT_MAX/.test(rb) && /analyzeBulletinWithAI\.lastRejected \? 1 : 0/.test(rb), [rej, down]);
      }
      ok('지방청 전망 색칠도 그 검사를 어느 AI 답에든 건다(accept — 글자 확인)', !/gemmaAccept:/.test(fs.readFileSync(require('path').join(__dirname, '..', 'regional_bulletin_collector.js'), 'utf8')) && /[^a-zA-Z]accept: \(p\) => gemmaKeptSummary\(p, rawText\)/.test(fs.readFileSync(require('path').join(__dirname, '..', 'regional_bulletin_collector.js'), 'utf8')));
    }
    gemmaAnswer = () => ({ success: true, text: '글 그대로의 답' }); calls.length = 0;
    const d6 = await bai.call('forecast', 'P', { json: false });
    ok('글 답(json:false)을 바라는 호출이면 Gemma 의 글 답을 그대로 쓴다', d6.success && d6.text === '글 그대로의 답' && d6.provider === 'gemma');
    ok('looseJson: 못 꺼내면 undefined', bai.looseJson('그냥 글') === undefined && bai.looseJson('') === undefined && bai.looseJson('{"a":1} 뒤 글').a === 1);
    // ⑤ 격상 가능성 읽기에는 Gemma 를 쓰지 않는다(사용자 「격상읽기는 하지말고」)
    gemmaAnswer = () => ({ success: true, text: '{"항목":[]}' }); plain.length = 0; calls.length = 0;
    const e1 = await bai.call('escalation', 'P');
    ok('⑤ 격상 가능성 읽기는 Gemma 를 부르지 않는다 — 정해 둔 순서(기본 Gemini)만', e1.provider === 'gemini' && plain.length === 0 && calls.length === 1 && calls[0].model === 'gemini-2.5-flash-lite' && !bai.gemmaStatus().escalation);
    // ⑥ 해상 기상 요약(2026-11-19 사용자 「2.순서 - 전용칸 6」 「이 작업은 젬마가 진행하도록 하고 젬마가 안되면 … 순서로서 ai api 호출」)
    {
      const c6 = bai.getConfig().seasummary;
      ok('⑥ 기본: 「먼저 Gemma」가 처음부터 켜져 있다(26b) · 순서는 Gemini 만(다른 AI 는 「다시 추가」 해야 쓰인다) · ③ 의 기본(쓰지 않음)은 그대로', c6.gemma === 'gemma-4-26b-a4b-it' && c6.order.filter((id) => !c6.removed.includes(id)).join() === 'gemini'
        && bai.normFeature('forecast', undefined).gemma === '' && bai.GEMMA_DEFAULT.seasummary === bai.GEMMA_MODELS[0], JSON.stringify(c6));
      const seen = [];
      gemmaAnswer = () => ({ success: true, text: '{"zones":[],"notes":[],"by":"gemma"}' }); plain.length = 0; calls.length = 0;
      const s1 = await bai.call('seasummary', 'P', { accept: (p) => { seen.push(p && p.by); return true; } });
      ok('⑥ Gemma 가 먼저 답한다 — 색칠 칸(categories·summary)이 없는 답이어도 된다 · 부르는 쪽 검사(accept)를 거친다', s1.success && s1.provider === 'gemma' && plain.length === 1 && plain[0].model === 'gemma-4-26b-a4b-it' && calls.length === 0 && seen.join() === 'gemma', JSON.stringify(s1));
      seen.length = 0; plain.length = 0; calls.length = 0;
      const s2 = await bai.call('seasummary', 'P', { accept: (p) => { seen.push(p && p.by); return !!p && p.by !== 'gemma'; } });
      ok('⑥ Gemma 답이 부르는 쪽 검사에 걸리면 정해 둔 순서(Gemini)가 답한다 — 그 답도 같은 검사를 거친다', s2.success && s2.provider === 'gemini' && seen.join() === 'gemma,gemini' && s2.tried.map((t) => t.id + ':' + t.ok).join() === 'gemma:false,gemini:true' && bai.gemmaStatus().seasummary.ok === false, JSON.stringify(s2));
      seen.length = 0;
      const s3 = await bai.call('seasummary', 'P', { accept: () => false });
      ok('⑥ 어느 AI 의 답이든 검사에 걸리면 실패로 돌려준다(지어낸 숫자가 든 답이 「성공」이 되지 않게) — 던지지 않는다', s3.success === false && s3.tried.map((t) => t.id + ':' + t.ok).join() === 'gemma:false,gemini:false' && /부르는 쪽 검사에 걸림/.test(s3.error), JSON.stringify(s3));
      // 못 쓴 답은 시도 기록에 전체(raw)를 남긴다 — 오류 문구는 앞 120자뿐이라 까닭을 알 수 없었다(운영 「시험 요약」 2026-11-19)
      { const LONG = '```json\n{ "zones": [ { "zone": "' + '가'.repeat(300) + '" } ], "notes": [ }\n```';   // 깨진 JSON(120자를 넘는다)
        gemmaAnswer = () => ({ success: true, text: LONG });
        const r1 = await bai.call('seasummary', 'P', { accept: () => true });
        ok('⑥ 못 쓴 답 전체를 시도 기록에 남긴다: Gemma 답이 JSON 이 아닐 때 — error 는 앞 120자, raw 는 답 전체 · 성공한 AI 줄에는 raw 가 없다', r1.provider === 'gemini' && r1.tried[0].id === 'gemma' && /JSON 이 아니다/.test(r1.tried[0].error) && r1.tried[0].raw === LONG && !('raw' in r1.tried[1]), JSON.stringify(r1.tried).slice(0, 300));
        gemmaAnswer = () => ({ success: true, text: '{"zones":[],"notes":[],"by":"gemma"}' });
        const r2 = await bai.call('seasummary', 'P', { accept: () => false });
        ok('⑥ 검사에 걸린 답도 전체를 남긴다(Gemma·순서 쪽 AI 모두) · 호출 자체가 실패하면 raw 가 없다 · 4,000자에서 자른다', r2.success === false && r2.tried.length === 2 && r2.tried.every((t) => typeof t.raw === 'string' && t.raw.length > 10)
          && (gemmaAnswer = () => ({ success: false, error: '503 수요 과다' }), !('raw' in (await bai.call('seasummary', 'P', { accept: () => true })).tried[0]))
          && (gemmaAnswer = () => ({ success: true, text: 'x'.repeat(9000) }), (await bai.call('seasummary', 'P', { accept: () => true })).tried[0].raw.length === 4000), JSON.stringify(r2.tried).slice(0, 300)); }
      gemmaAnswer = () => ({ success: true, text: '{"zones":[],"notes":[{"kind":"너울","text":"{{period:내일까지}} {{loc:제주도해안}} 너울"}]}' });
      const s4 = await bai.call('seasummary', 'P', { accept: () => true });
      ok('⑥ 색 표시 꼴은 여기서 보지 않는다(부르는 쪽이 벗겨 내고 본다 — 실제 Gemma 답의 `{{period:…}}`) · 배열·글 답은 여전히 못 쓰는 답', s4.provider === 'gemma'
        && (gemmaAnswer = () => ({ success: true, text: '["zones"]' }), (await bai.call('seasummary', 'P', { accept: () => true })).provider) === 'gemini');
      const off6 = await (await post({ feature: 'seasummary', gemma: '' })).json(); plain.length = 0;
      ok('⑥ 「쓰지 않음」으로 저장하면 그대로 꺼져 있다(기본값으로 되살아나지 않는다) — Gemma 를 안 부른다', off6.ok && off6.config.seasummary.gemma === '' && bai.getConfig().seasummary.gemma === '' && (await bai.call('seasummary', 'P')).provider === 'gemini' && plain.length === 0);
      ok('accept 는 다른 기능에도 듣는다(순서 쪽 AI 답) · 안 주면 종전 그대로', (await bai.call('escalation', 'P', { accept: () => false })).success === false && (await bai.call('escalation', 'P')).success === true);
    }
    // 끄기
    const off = await (await post({ feature: 'forecast', gemma: '' })).json(); plain.length = 0; calls.length = 0;
    ok('「쓰지 않음」으로 되돌리면 Gemma 를 더 부르지 않는다', off.ok && off.config.forecast.gemma === '' && (await bai.call('forecast', 'P')).provider === 'claude2' && plain.length === 0);
    // 시험 호출
    gemmaAnswer = () => ({ success: true, text: '{"해역":"동해중부먼바다","시점":"오늘 밤부터"}' }); plain.length = 0;
    const tr = async (model) => (await fetch(base + '/api/admin/bulletin-ai/try-model', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }) })).json();
    const t1 = await tr('gemma-4-26b-a4b-it');
    ok('「시험 호출」: 고른 모델을 한 번 불러 결과(답 글·걸린 시간)를 돌려준다 — 설정은 안 바뀐다', t1.ok && t1.model === 'gemma-4-26b-a4b-it' && typeof t1.ms === 'number' && /동해중부먼바다/.test(t1.text) && plain.length === 1 && plain[0].model === 'gemma-4-26b-a4b-it'
      && bai.getConfig().forecast.gemma === '', JSON.stringify(t1));
    gemmaAnswer = () => ({ success: false, error: 'models/gemma-4-31b-it is not found' });
    const t2 = await tr('gemma-4-31b-it'), t3 = await tr('gpt-9'), t4 = await tr('');
    ok('「시험 호출」: 실패하면 오류 글을 그대로 보인다 · 목록 밖 모델은 부르지 않는다', t2.ok === false && /not found/.test(t2.error) && t3.ok === false && t4.ok === false && plain.length === 2);   // 성공 1 + 실패 1 — 목록 밖 두 번은 안 불렀다
    plain.length = 0; gemmaAnswer = () => ({ success: true, text: '{"a":1}' });
    const t5 = await tr('gemini-2.5-flash-lite');
    ok('「시험 호출」: 기본 Gemini 모델도 같은 버튼으로(JSON 모드로 부른다) — 그 모델이 아직 불리는지 볼 때', t5.ok && plain.length === 1 && plain[0].model === 'gemini-2.5-flash-lite' && plain[0].config && plain[0].config.responseMimeType === 'application/json');
    ok('GET 응답에 마지막 Gemma 결과가 실린다', (await (await fetch(base + '/api/admin/bulletin-ai/config')).json()).gemma.forecast.model === 'gemma-4-26b-a4b-it');
    {
      const src = fs.readFileSync(require('path').join(__dirname, '..', 'services', 'gemini_client.js'), 'utf8');
      const body = src.slice(src.indexOf('async function callPlain'), src.indexOf('module.exports'));
      ok('Gemma 는 이미 등록된 Gemini 키(GEMINI_API_KEY_26_8)로 부른다 — 새 시크릿이 필요 없다(사용자 「GEMINI_API_KEY_26_8 로 젬마를 호출」)', /const KEY_ENV = 'GEMINI_API_KEY_26_8'/.test(src) && /keys\[0\]\.apiKey/.test(body) && !/GEMMA_API_KEY/.test(src) && !/GEMMA_API_KEY/.test(fs.readFileSync(require('path').join(__dirname, '..', 'services', 'bulletin_ai.js'), 'utf8')));
      ok('callPlain 은 60초(기본) 안에 답이 없으면 실패로 돌려준다(Gemma 가 답이 없을 때 색칠이 멈추지 않게)', /timeoutMs = 60000/.test(body) && /Promise\.race/.test(body) && /clearTimeout\(timer\)/.test(body));
      ok('Gemma 호출(callPlain)은 공용 Gemini 키의 쿨다운·전환·관리자 알림을 건드리지 않는다 — Gemma 한도 초과가 챗봇의 Gemini 까지 멈추지 않게', body.length > 200 && !/markRateLimited|notifyAdmin|pickNextKey|llmChain|codexBridge/.test(body));
    }
    srv.close();
  }
  console.log(`\n  ${pass} PASS / ${fail} FAIL`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})();
