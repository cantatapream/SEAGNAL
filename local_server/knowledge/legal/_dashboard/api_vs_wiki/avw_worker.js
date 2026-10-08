#!/usr/bin/env node
/**
 * ============================================================================
 * 파일명: _dashboard/api_vs_wiki/avw_worker.js
 * 역할: 비교 실험을 GPT 루나(ChatGPT 정액제, Codex CLI)로 돌릴 때 쓰는 **실험 전용** 작업자.
 *   실험 서버 복사본(run_arms.js 가 띄운 localhost)에서만 일감을 가져와 `codex exec` 로 답한다.
 * ============================================================================
 *
 * [왜 운영 작업자(scripts/codex_worker.js)를 그대로 안 쓰나]
 *   운영 작업자는 작업 폴더를 `~/.codex_worker` 로 고정해 쓰고(답 파일 last_message.txt 도 거기),
 *   VM 에서는 그 운영 작업자가 systemd 로 **상시 돌고 있다**. 같은 폴더를 두 작업자가 쓰면
 *   서로의 답 파일을 덮어써 **운영 답변이 섞일 수 있다.** 그래서 폴더만 `~/.avw_codex_worker` 로
 *   다르게 하고, codex 를 부르는 방식(인자·머리말)은 운영 작업자와 **똑같이** 맞춘 사본을 둔다.
 *   (앱 코드는 고치지 않는다 — 실험 장치 안에서 끝낸다.)
 * [다르게 둔 것 하나] C 의 「도구 고르기」 차례(caller=AVW-C-Step)만 머리말이 다르다 — 아래 PREAMBLE_C_STEP 주석.
 * [같게 맞춘 것] codex exec 인자(--json --ephemeral --skip-git-repo-check -s read-only -C <빈 폴더> -o <파일> -m <모델>),
 *   「도구·셸·파일 읽기 금지」 머리말, JSON 일감 머리말 — scripts/codex_worker.js 와 같은 글자다.
 * [환경변수] NRYA_SERVER(실험 서버 주소, 필수) · NRYA_CODEX_SECRET(실험용 비밀, run.sh 가 매번 새로 만든다)
 *   · CODEX_MODEL(기본 gpt-6-luna) · CODEX_BIN(기본 codex — 시험용 가짜 codex 를 넣을 때만 바꾼다)
 * [연계] ← run_arms.js(LLM=luna 일 때 자식 프로세스로 띄운다) → 실험 서버의 /api/legal/codex/poll·result
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SERVER = String(process.env.NRYA_SERVER || '').replace(/\/+$/, '');
const SECRET = process.env.NRYA_CODEX_SECRET || '';
const MODEL = process.env.CODEX_MODEL || 'gpt-6-luna';
const BIN = process.env.CODEX_BIN || 'codex';
const TIMEOUT_MS = 240 * 1000;   // 운영 작업자와 같다(서버 쪽 300초보다 짧게)
const WORK_DIR = path.join(os.homedir(), '.avw_codex_worker');   // ★운영 작업자(~/.codex_worker)와 다른 폴더
const EMPTY_DIR = path.join(WORK_DIR, 'empty');

// ↓ scripts/codex_worker.js 와 같은 글자(바꾸면 그쪽과 결과가 달라진다)
const PREAMBLE_TEXT = [
  '[실행 규칙] 너는 이번 작업에서 도구·셸 명령·파일 읽기를 절대 쓰지 않는다.',
  '아래 지시와 [근거자료]만으로 답하고, 최종 답변 본문만 출력한다(작업 설명·인사 금지).',
  '',
].join('\n');
const PREAMBLE_JSON = PREAMBLE_TEXT + '출력은 JSON 하나뿐이다. 코드블록(```)이나 다른 글자를 붙이지 않는다.\n\n';
// ★C 방식의 「다음 도구 고르기」 차례에만 쓰는 머리말(2026-10-06 루나 시험 1회차에서 발견).
//   위 운영 머리말은 「도구를 절대 쓰지 말고 [근거자료]만으로 답하라」인데, C 는 바로 그 차례에 **법령 도구를
//   고르라**고 시킨다 — 두 지시가 부딪쳐 루나가 10문항 중 3문항에서 도구를 한 번도 안 부르고 끝냈다.
//   셸·파일 금지는 그대로 두고, 「아래 법령 도구는 바깥 프로그램이 대신 실행하니 골라도 된다」를 분명히 한다.
const PREAMBLE_C_STEP = [
  '[실행 규칙] 너는 이번 작업에서 셸 명령·파일 읽기를 절대 쓰지 않는다.',
  '다만 아래 [쓸 수 있는 도구]는 네가 실행하는 것이 아니라, 네가 JSON 으로 고르면 바깥 프로그램이 법제처에서 대신 조회해',
  '다음 차례에 결과를 보여 준다. 그러니 원문을 아직 못 읽었으면 도구를 골라라.',
  '출력은 JSON 하나뿐이다. 코드블록(```)이나 다른 글자를 붙이지 않는다.',
  '', '',
].join('\n');

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** codex exec 한 번 — 운영 작업자의 runCodex 와 같은 방식. */
function runCodex(prompt, json, model, caller) {
  const outFile = path.join(WORK_DIR, 'last_message.txt');
  try { fs.unlinkSync(outFile); } catch (_) { /* 없으면 그만 */ }
  const args = ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '-C', EMPTY_DIR, '-o', outFile, '-m', model, '-'];
  return new Promise((resolve) => {
    const child = spawn(BIN, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let events = '', stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    child.stdout.on('data', d => { events += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', e => { clearTimeout(timer); resolve({ ok: false, error: 'codex 실행 불가: ' + e.message, commands: 0 }); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const commands = (events.match(/"command_execution"/g) || []).length;
      let text = '';
      try { text = fs.readFileSync(outFile, 'utf8').trim(); } catch (_) { text = ''; }
      if (signal === 'SIGKILL') return resolve({ ok: false, error: `codex 시간초과(${TIMEOUT_MS / 1000}초)`, commands });
      if (code !== 0 || !text) return resolve({ ok: false, error: `codex 종료코드 ${code}: ${(stderr || events).split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 280)}`, commands });
      resolve({ ok: true, text, commands });
    });
    child.stdin.end((caller === 'AVW-C-Step' ? PREAMBLE_C_STEP : json ? PREAMBLE_JSON : PREAMBLE_TEXT) + prompt);
  });
}

const post = (p, body, ms) => fetch(SERVER + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Codex-Secret': SECRET },
  body: JSON.stringify(body || {}), signal: AbortSignal.timeout(ms),
});

async function main() {
  if (!SERVER || SECRET.length < 16) { console.error('[avw_worker] NRYA_SERVER·NRYA_CODEX_SECRET 필요'); process.exit(1); }
  fs.mkdirSync(EMPTY_DIR, { recursive: true });
  console.error(`[avw_worker] 시작 — 서버 ${SERVER} · 모델 ${MODEL}`);
  for (;;) {
    let job;
    try {
      const r = await post('/api/legal/codex/poll', {}, 40000);
      if (r.status === 204) continue;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      job = await r.json();
    } catch (e) { await sleep(2000); continue; }
    const t0 = Date.now();
    const model = (typeof job.model === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(job.model)) ? job.model : MODEL;
    const out = await runCodex(job.prompt, job.json, model, job.caller);
    const ms = Date.now() - t0;
    console.error(`[avw_worker] ${job.caller} ${out.ok ? '완료' : '실패: ' + out.error} ${(ms / 1000).toFixed(1)}초`);
    for (let i = 0; i < 4; i++) {
      try { await post('/api/legal/codex/result', { id: job.id, ok: out.ok, text: out.text, error: out.error, ms, commands: out.commands }, 20000); break; }
      catch (_) { await sleep(2000 * (i + 1)); }
    }
  }
}
main();
