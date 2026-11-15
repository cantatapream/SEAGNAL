/**
 * test_bulletin_ai.js — 「AI 특보 분석」 기능별 AI 순서(services/bulletin_ai.js)와 그 API·일감별 실행 위치를 고정한다.
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
    srv.close();
  }
  console.log(`\n  ${pass} PASS / ${fail} FAIL`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})();
