#!/usr/bin/env node
/**
 * ============================================================================
 * 파일명: _dashboard/api_vs_wiki/run_arms.js
 * 역할: 같은 질문을 세 방식으로 풀어 결과를 한 줄씩(JSONL) 남긴다.
 *   A = 지금 챗봇 그대로(POST /api/legal/ask — 위키 검색 → AI 답변, 되묻기·2차 조회 포함)
 *   B = 이미 있는 「원문 직독」 2차 경로를 일부러 켠 것(searchRawFallback — 우리가 모아 둔 원문)
 *   C = 위키 없이 법제처 API 만 쓰는 AI(lawapi.js 도구를 AI 가 스스로 골라 부른다)
 * ============================================================================
 *
 * [★운영에 영향 없음 — 이렇게 지킨다]
 *  - 이 스크립트는 run.sh 가 만든 **임시 작업 사본(git worktree)** 안에서만 돈다. A 경로가
 *    파일을 쓰더라도(지식 후보 큐·보관 답변·설정 파일) 그 사본 안에 쓰이고, 실험이 끝나면 사본째 지운다.
 *  - 운영 서버(fly.dev)는 부르지 않는다. A 도 이 프로세스 안에 챗봇 라우터를 띄워 localhost 로 부른다.
 *  - 앱 코드는 한 줄도 고치지 않는다 — 있는 함수를 그대로 부른다(_RULES §2 「제품이 쓰는 그 함수를 부른다」).
 *
 * [공정성] 세 방식 모두 같은 AI(legal_retriever.ANSWER_MODEL)와 같은 답변 규칙(ANSWER_RULES_BODY)·
 *   같은 생성 설정(온도 0, 생각 예산 -1)을 쓴다. 다른 것은 「근거를 어디서 가져오느냐」뿐이다.
 *
 * [사용] run.sh 를 쓴다. 직접 부를 때:
 *   node run_arms.js --arm a|b|c --set pilot|main --out <결과.jsonl> [--only <문항id,…>]
 *   이미 결과 파일에 있는 문항은 건너뛴다(중간에 끊겨도 이어서 돈다).
 *
 * [연계] ← run.sh · → questions.json(문항) · lawapi.js(C 도구)
 *        → local_server/routes/legal.js(A) · services/legal_retriever.js(B·공통 규칙) · services/gemini_client.js(토큰 집계)
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const LS = path.resolve(HERE, '../../../..');           // …/local_server
const lawapi = require('./lawapi');

// ── 인자 ──
const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : null; };
const ARM = opt('arm');
const SET = opt('set') || 'pilot';
const OUT = opt('out');
const ONLY = opt('only') ? new Set(opt('only').split(',')) : null;
if (!['a', 'b', 'c'].includes(ARM) || !OUT) {
  console.error('사용: node run_arms.js --arm a|b|c --set pilot|main --out <결과.jsonl>');
  process.exit(2);
}

const gemini = require(path.join(LS, 'services/gemini_client'));
const retriever = require(path.join(LS, 'services/legal_retriever'));
const codexBridge = require(path.join(LS, 'services/codex_bridge'));
// ★어느 AI 로 돌리나(2026-10-06 사용자 요청 「BC까지 루나로 할 수 있도록 장치를 고쳐서 해볼래?」).
//   gemini(기본) = Gemini API 키 · luna = ChatGPT 정액제(Codex CLI)를 실험 전용 작업자(avw_worker.js)로.
//   luna 는 run.sh 가 실험용 비밀(NRYA_CODEX_SECRET)과 설정(answerModel=gpt-6-luna)을 깔아 준다.
const LLM = process.env.AVW_LLM === 'luna' ? 'luna' : 'gemini';
const LUNA_CFG = { answerModel: 'gpt-6-luna', codexForUsers: true };
if (LLM === 'gemini' && !gemini.hasAnyKey()) {
  console.error('GEMINI_API_KEY_26_8 가 없다 — 이 실험은 AI 키가 있어야 돈다(README 「키 넣기」).');
  process.exit(3);
}
if (LLM === 'luna' && !codexBridge.ENABLED) {
  console.error('루나 모드인데 NRYA_CODEX_SECRET 이 없다 — run.sh 로 돌려라(LLM=luna bash run.sh …).');
  process.exit(3);
}

/** 이 프로세스가 지금까지 쓴 Gemini 토큰(A·B 는 gemini_client 를 거치므로 여기서 센다). */
const tokenSnap = () => { const u = gemini.getUsageStats(); return { in: u.inputTokens, out: u.outputTokens }; };

// ============================================================================
// A — 지금 챗봇. 라우터를 이 프로세스에 띄우고 앱과 똑같이 되묻기를 이어간다.
// ============================================================================
let baseUrl = null;
async function startLocalServer() {
  const express = require(path.join(LS, 'node_modules/express'));
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(require(path.join(LS, 'routes/legal')));
  await new Promise(r => { const srv = app.listen(0, '127.0.0.1', () => { baseUrl = `http://127.0.0.1:${srv.address().port}`; r(); }); });
  if (LLM === 'luna') await startLunaWorker();
}

/**
 * 루나 모드: 실험 전용 작업자(avw_worker.js)를 자식 프로세스로 띄우고, 이 서버의 창구에 붙을 때까지 기다린다.
 * 운영 서버·운영 작업자와 무관하다 — 작업자가 이 프로세스의 localhost 창구만 본다.
 */
let worker = null;
async function startLunaWorker() {
  const { spawn } = require('child_process');
  worker = spawn(process.execPath, [path.join(HERE, 'avw_worker.js')], {
    env: { ...process.env, NRYA_SERVER: baseUrl }, stdio: ['ignore', 'inherit', 'inherit'],
  });
  for (let i = 0; i < 60 && !codexBridge.workerAlive(); i++) await new Promise(r => setTimeout(r, 500));
  if (!codexBridge.workerAlive()) { console.error('루나 작업자가 30초 안에 붙지 않았다'); process.exit(4); }
}

/** 루나 모드면 이 함수 안의 AI 호출을 전부 codex 로 보낸다(앱의 /api/legal/ask 와 같은 표시 방식). */
function inLlm(fn) {
  if (LLM !== 'luna') return fn();
  // ⚠작업자가 끊긴 채 보내면 withRequest 가 조용히 Gemini 로 돌린다 — 그러면 루나 결과에 Gemini 답이 섞인다.
  if (!codexBridge.workerAlive()) throw new Error('루나 작업자 연결 없음 — 이 문항은 Gemini 로 새지 않게 실패로 둔다');
  return codexBridge.withRequest({ body: {}, get: () => '' }, { setHeader() {} }, fn, LUNA_CFG);
}

/** POST /api/legal/ask 한 번 — 스트림(NDJSON)의 마지막 done 줄을 돌려준다. */
async function ask(payload) {
  const res = await fetch(baseUrl + '/api/legal/ask', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    signal: AbortSignal.timeout(300000),
  });
  ask.lastLlm = res.headers.get('x-nrya-llm') || 'gemini';   // 서버가 실제로 어느 AI 로 보냈나
  const lines = (await res.text()).split('\n').filter(l => l.trim().startsWith('{')).map(l => JSON.parse(l));
  const done = lines.filter(o => o.type === 'done');
  return done.length ? done[done.length - 1] : (lines[lines.length - 1] || null);
}

/**
 * 되묻기 자동 이어가기 — live27/run.py 와 같은 규칙(= 앱 ai_chat.js 의 pickClarifyOption 과 같은 방식).
 * 질문 문장은 그대로 두고, 선택지에 ctx 가 있으면 직전 ctxNext 위에 얹고, 없으면 질문 뒤에 「 — 라벨」.
 * 「모르겠어요·아니요」 같은 선택지는 피한다. 최대 10회.
 */
async function armA(q) {
  if (LLM === 'luna' && !codexBridge.workerAlive()) throw new Error('루나 작업자 연결 없음 — Gemini 로 새지 않게 실패로 둔다');
  let res = await ask({ query: q.question });
  const llmUsed = ask.lastLlm;
  let lastctx = res && res.ctxNext;
  const hist = [{ role: 'user', content: q.question }];
  let rounds = 0;
  for (let i = 0; i < 10; i++) {
    const cl = res && res.clarify;
    const opts = (cl && cl.options) || [];
    if (!cl || !opts.length) break;
    const good = opts.filter(o => !['ask', 'unknown'].includes(o.act) && !/^(아니요|잘 모르)/.test(String(o.label || '')));
    const o = good[0] || opts[0];
    let sendq = q.question, ctx = lastctx || {};
    if (o.ctx) ctx = Object.assign({}, lastctx || {}, o.ctx);
    else sendq = `${q.question} — ${o.label || ''}`.trim();
    hist.push({ role: 'assistant', content: String(res.answer || '').slice(0, 400) });
    const nxt = await ask({ query: sendq, ctx, lastQuestion: cl.question, history: hist.slice(-6) });
    hist.push({ role: 'user', content: String(o.label || '') });
    if (!nxt) break;
    res = nxt; rounds++;
    lastctx = res.ctxNext || lastctx;
    if ((res.citationChain || []).length) break;
  }
  return {
    answer: String((res && res.answer) || ''),
    chain: ((res && res.citationChain) || []).map(c => `${c.law} ${c.citedArticle || c.article || ''}`.trim()),
    note: String((res && res.note) || ''),
    clarify_left: !!(res && res.clarify),
    clarify_rounds: rounds,
    llm_used: llmUsed,   // 첫 요청의 X-Nrya-LLM(codex|gemini) — 루나 모드인데 gemini 면 섞인 것
  };
}

// ============================================================================
// B — 원문 직독 2차 경로를 강제로. 앱에서는 위키가 빈손일 때만 켜진다.
// ============================================================================
async function armB(q) {
  const r = await inLlm(() => retriever.searchRawFallback(q.question));
  return { answer: String(r.answer || ''), laws: r.laws, files: r.files };
}

// ============================================================================
// C — 법제처 API 만 쓰는 AI. 도구 호출을 최대 MAX_STEPS 번까지 허용한다.
// ============================================================================
const MAX_STEPS = 15;
const C_RULES = `너는 "나리야" — 대한민국 해양수산 법령을 안내하는 AI 챗봇이다. 이번에는 미리 정리된 자료가 **없다.**
주어진 도구로 법제처 국가법령정보센터에서 법령 원문을 **직접 찾아 읽고** 답한다.
찾는 순서(권장): ①법령 찾기 — 질문에 법 이름이 있으면 search_law, **없으면 search_text 로 질문 속 제도명·자격명·
전문용어(예: 수상구조사, 해상특수경비원, 검수사)를 본문 검색**한다. 고시·지침이면 search_admin_rule. 이 챗봇은 해양수산
분야라 해양수산부·해양경찰청 소관 후보를 먼저 보되, 다른 부처 법이 맞으면 그 법을 쓴다
→ ②law_toc 로 목차를 보고 관련 조문을 고른다 → ③get_articles 로 조문 원문을 읽는다
→ ④조문이 "대통령령·해양수산부령·고시로 정한다"고 넘기면 delegations 로 위임받은 시행령·시행규칙·고시를 찾아
get_articles·get_annex·get_admin_rule 로 끝까지 따라간다.
★답하기 전에 확인한다: 읽은 조문이 **질문의 핵심 낱말과 상황을 실제로 다루는가.** 이름만 비슷한 다른 제도(예: 질문은
수상구조사의 「지도사」인데 찾은 것은 「경영지도사」)라면 그 법으로 답하지 말고 다시 찾는다. 끝내 못 찾으면 지어내지 말고
"확인되지 않습니다"라고 답한다 — 엉뚱한 법으로 자신 있게 답하는 것이 가장 나쁘다.
도구로 받은 원문만이 아래 규칙에서 말하는 [근거자료]다. 원문을 충분히 읽었으면 도구를 그만 부르고 답을 쓴다.

`;
const C_VERSION = 2;   // 1 = 시험 1회차(이름 검색만) · 2 = 본문 검색·부처 우선·관련성 확인 추가(2026-10-06)
let genai = null;
async function armC(q) {
  if (LLM === 'luna') return inLlm(() => armCText(q));
  if (!genai) {
    const { GoogleGenAI } = require(path.join(LS, 'node_modules/@google/genai'));
    genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY_26_8 });
  }
  const s = lawapi.newSession();
  const system = C_RULES + retriever.ANSWER_RULES_BODY;
  const contents = [{ role: 'user', parts: [{ text: `질문: "${q.question}"` }] }];
  const tok = { in: 0, out: 0 };
  const steps = [];
  let answer = '';
  for (let step = 0; step <= MAX_STEPS; step++) {
    const last = step === MAX_STEPS;   // 마지막 차례엔 도구를 막고 답을 쓰게 한다
    const r = await genai.models.generateContent({
      model: retriever.ANSWER_MODEL, contents,
      config: {
        systemInstruction: system, temperature: 0, thinkingConfig: { thinkingBudget: -1 },
        tools: [{ functionDeclarations: lawapi.declarations }],
        toolConfig: { functionCallingConfig: { mode: last ? 'NONE' : 'AUTO' } },
      },
    });
    const um = r.usageMetadata || {};
    tok.in += um.promptTokenCount || 0;
    tok.out += (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0);
    const calls = r.functionCalls || [];
    const parts = (r.candidates && r.candidates[0] && r.candidates[0].content && r.candidates[0].content.parts) || [];
    if (!calls.length) { answer = String(r.text || ''); break; }
    contents.push({ role: 'model', parts });
    const responses = [];
    for (const c of calls) {
      const out = await lawapi.runTool(s, c.name, c.args);
      steps.push({ tool: c.name, args: c.args, chars: out.length, head: out.slice(0, 160) });
      responses.push({ functionResponse: { name: c.name, response: { result: out } } });
    }
    contents.push({ role: 'user', parts: responses });
  }
  return { answer, steps, api: s.stats, tokens: tok, c_version: C_VERSION };
}

/**
 * C 를 루나로 — 루나 통로(codex_bridge)는 「글을 넣으면 글이 나온다」뿐이라 Gemini 의 도구 호출 기능이 없다.
 * 그래서 같은 도구·같은 지시문을 쓰되, 매 차례 「다음에 쓸 도구를 JSON 하나로」 받는다:
 *   {"tool":"이름","args":{…}} 또는 {"final":true}. final 이면 모은 원문으로 답변을 한 번 따로 쓰게 한다.
 * 도구 결과는 Gemini 판과 같은 lawapi.js 에서 나온다(같은 20,000자 상한).
 */
async function armCText(q) {
  const s = lawapi.newSession();
  const toolDoc = lawapi.declarations.map(d => {
    const ps = Object.entries((d.parameters && d.parameters.properties) || {}).map(([k, v]) => `${k}: ${v.description || ''}`).join(' / ');
    return `- ${d.name} — ${d.description} 인자: {${ps}}`;
  }).join('\n');
  const steps = [];
  const log = [];
  const ask = async (contents, json) => gemini.callGemini({
    model: retriever.ANSWER_MODEL, contents, caller: json ? 'AVW-C-Step' : 'AVW-C-Answer',
    config: json ? { temperature: 0, responseMimeType: 'application/json' } : { temperature: 0 },
  });
  for (let step = 0; step < MAX_STEPS; step++) {
    const prompt = `${C_RULES}${retriever.ANSWER_RULES_BODY}\n\n[쓸 수 있는 도구]\n${toolDoc}\n\n` +
      `[지금까지 부른 도구와 결과]\n${log.length ? log.join('\n\n') : '(아직 없음)'}\n\n질문: "${q.question}"\n\n` +
      `다음 행동을 JSON 하나로만 답하라. 도구를 더 부를 때: {"tool":"도구이름","args":{…}} · 원문을 충분히 읽어 답을 쓸 수 있을 때: {"final":true}`;
    const r = await ask(prompt, true);
    if (!r.success || !r.text) { steps.push({ tool: '(판단 실패)', args: {}, chars: 0, head: String(r.error || '').slice(0, 160) }); break; }
    let act;
    try { act = JSON.parse(codexBridge.stripFence(r.text)); } catch (_) { steps.push({ tool: '(JSON 아님)', args: {}, chars: 0, head: r.text.slice(0, 160) }); break; }
    if (!act || act.final || !act.tool) break;
    const out = await lawapi.runTool(s, act.tool, act.args || {});
    steps.push({ tool: act.tool, args: act.args || {}, chars: out.length, head: out.slice(0, 160) });
    log.push(`#${step + 1} ${act.tool} ${JSON.stringify(act.args || {})}\n${out}`);
  }
  const final = await ask(`${C_RULES}${retriever.ANSWER_RULES_BODY}\n\n[근거자료 — 도구로 받은 원문]\n${log.join('\n\n') || '(없음)'}\n\n질문: "${q.question}"\n답:`, false);
  return { answer: final.success ? String(final.text || '') : '', error: final.success ? undefined : String(final.error || ''),
    steps, api: s.stats, c_version: C_VERSION, c_protocol: 'text-json' };
}

// ============================================================================
async function main() {
  const qs = JSON.parse(fs.readFileSync(path.join(HERE, 'questions.json'), 'utf8'));
  let list = qs.main;
  if (SET === 'pilot') list = list.filter(m => qs.pilot.includes(m.id));
  if (ONLY) list = list.filter(m => ONLY.has(m.id));
  const done = new Set(fs.existsSync(OUT)
    ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).id) : []);
  if (ARM === 'a' || LLM === 'luna') await startLocalServer();
  const fh = fs.openSync(OUT, 'a');
  for (const q of list) {
    if (done.has(q.id)) continue;
    const t0 = Date.now();
    const k0 = tokenSnap();
    let r;
    try {
      r = ARM === 'a' ? await armA(q) : ARM === 'b' ? await armB(q) : await armC(q);
    } catch (e) {
      r = { answer: '', error: String(e && e.message || e) };
    }
    const k1 = tokenSnap();
    const rec = {
      id: q.id, arm: ARM, llm: LLM, layer: q.layer, question: q.question, expect_law: q.expect_law, expect_article: q.expect_article,
      sec: Math.round((Date.now() - t0) / 100) / 10,
      tokens: r.tokens || { in: k1.in - k0.in, out: k1.out - k0.out },
      ...r,
    };
    fs.writeSync(fh, JSON.stringify(rec) + '\n');
    console.log(`[${ARM}] ${q.id} ${rec.sec}s 답${rec.answer.length}자${rec.error ? ' 오류:' + rec.error.slice(0, 60) : ''}`);
  }
  fs.closeSync(fh);
  if (worker) worker.kill();
  process.exit(0);   // 라우터가 띄운 타이머들이 프로세스를 붙잡지 않게
}
main().catch(e => { console.error(e); process.exit(1); });
