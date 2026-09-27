#!/usr/bin/env node
/**
 * ============================================================================
 * 파일명: scripts/codex_worker.js
 * 역할: **VM 에서 도는** Codex 작업자. Fly 서버에 "처리할 질문 있어?" 하고 계속 묻고,
 *       질문이 오면 이 VM 에 로그인된 ChatGPT 정액제(codex exec)로 답을 만들어 돌려준다.
 *       VM 은 밖으로 나가기만 한다 — 들어오는 문을 열지 않는다.
 * ============================================================================
 *
 * [쓰는 법 — VM 터미널]
 *   export NRYA_CODEX_SECRET='<Fly 에 넣은 것과 같은 비밀 열쇠>'
 *   node local_server/scripts/codex_worker.js
 *   (선택) NRYA_SERVER=https://seagnal-server.fly.dev  CODEX_MODEL=<모델명>  CODEX_TIMEOUT_S=240
 *   끄기: Ctrl+C
 *
 * [안전장치]
 *   - codex 는 코딩 비서라 명령을 실행하려 할 수 있다 → 읽기 전용(-s read-only) + 빈 폴더(-C)에 가두고,
 *     프롬프트 앞머리에 "도구·명령 금지"를 적는다. 그래도 명령을 쓰면 횟수를 세어 서버 로그에 남긴다.
 *   - --ephemeral: 대화 기록을 디스크에 남기지 않는다.
 *   - 한 번에 한 질문만 처리한다(정액제 한도 보호).
 *   - 마지막 일감의 codex 원본 이벤트를 ~/.codex_worker/last.jsonl 에 남긴다(첫 시험에서 이벤트 모양 확인용).
 *
 * [연계]
 *   - services/codex_bridge.js → 상대편(대기열). POST /api/legal/codex/poll · /api/legal/codex/result
 *   - services/codex_client.design.md → 설계안
 *   - 필요한 것: Node 18+(내장 fetch), `codex` 명령(npm i -g @openai/codex) + `codex login --device-auth`
 * [로드 순서] 단독 실행 스크립트 — 서버가 부르지 않는다.
 * ============================================================================
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SERVER = (process.env.NRYA_SERVER || 'https://seagnal-server.fly.dev').replace(/\/+$/, '');
const SECRET = process.env.NRYA_CODEX_SECRET || '';
const MODEL = process.env.CODEX_MODEL || '';
// codex 한 번 실행 상한. 서버 쪽 JOB_TIMEOUT_MS(300초)보다 짧아야 서버가 먼저 포기하지 않는다.
const TIMEOUT_MS = (Number(process.env.CODEX_TIMEOUT_S) > 0 ? Number(process.env.CODEX_TIMEOUT_S) : 240) * 1000;
const WORK_DIR = path.join(os.homedir(), '.codex_worker');
const EMPTY_DIR = path.join(WORK_DIR, 'empty');

const PREAMBLE_TEXT = [
  '[실행 규칙] 너는 이번 작업에서 도구·셸 명령·파일 읽기를 절대 쓰지 않는다.',
  '아래 지시와 [근거자료]만으로 답하고, 최종 답변 본문만 출력한다(작업 설명·인사 금지).',
  '',
].join('\n');
const PREAMBLE_JSON = PREAMBLE_TEXT + '출력은 JSON 하나뿐이다. 코드블록(```)이나 다른 글자를 붙이지 않는다.\n\n';

function now() { return new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * codex exec 를 한 번 돌려 최종 답을 받는다.
 * 예: runCodex('질문…', false) → { ok: true, text: '답…', commands: 0 }
 * @param {string} prompt @param {boolean} json - JSON 만 출력하라고 덧붙일지
 * @returns {Promise<{ok:boolean, text?:string, error?:string, commands:number}>}
 * [연계] ← main 루프. 결과는 codex_bridge.result 로 간다.
 */
function runCodex(prompt, json) {
  const outFile = path.join(WORK_DIR, 'last_message.txt');
  try { fs.unlinkSync(outFile); } catch (_) { /* 없으면 그만 */ }
  const args = ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only',
    '-C', EMPTY_DIR, '-o', outFile];
  if (MODEL) args.push('-m', MODEL);
  args.push('-');
  return new Promise((resolve) => {
    const child = spawn('codex', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let events = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, TIMEOUT_MS);
    child.stdout.on('data', d => { events += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: 'codex 실행 불가: ' + e.message, commands: 0 }); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      try { fs.writeFileSync(path.join(WORK_DIR, 'last.jsonl'), events); } catch (_) { /* 기록 실패는 무시 */ }
      // ⚠이벤트 이름은 첫 시험에서 last.jsonl 로 확인할 것 — 'command_execution' 은 추정이다.
      const commands = (events.match(/"command_execution"/g) || []).length;
      let text = '';
      try { text = fs.readFileSync(outFile, 'utf8').trim(); } catch (_) { text = ''; }
      if (signal === 'SIGKILL') return resolve({ ok: false, error: `codex 시간초과(${TIMEOUT_MS / 1000}초)`, commands });
      if (code !== 0 || !text) {
        const tail = (stderr || events).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 280);
        return resolve({ ok: false, error: `codex 종료코드 ${code}: ${tail}`, commands });
      }
      resolve({ ok: true, text, commands });
    });
    child.stdin.end((json ? PREAMBLE_JSON : PREAMBLE_TEXT) + prompt);
  });
}

async function post(pathname, body, timeoutMs) {
  return fetch(SERVER + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Codex-Secret': SECRET },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function main() {
  if (SECRET.length < 16) {
    console.error('NRYA_CODEX_SECRET(16자 이상)를 먼저 설정하세요: export NRYA_CODEX_SECRET=...');
    process.exit(1);
  }
  fs.mkdirSync(EMPTY_DIR, { recursive: true });
  console.log(`[${now()}] Codex 작업자 시작 — 서버 ${SERVER}${MODEL ? ' · 모델 ' + MODEL : ''}`);
  let backoff = 2000;
  for (;;) {
    let job = null;
    try {
      const r = await post('/api/legal/codex/poll', {}, 40000);
      if (r.status === 204) { backoff = 2000; continue; }
      if (r.status === 401) { console.error(`[${now()}] 비밀 열쇠가 서버와 다릅니다(401). 종료합니다.`); process.exit(1); }
      if (r.status === 404) { console.error(`[${now()}] 서버에 Codex 모드가 꺼져 있습니다(404, NRYA_CODEX_SECRET 미설정). 30초 뒤 다시 봅니다.`); await sleep(30000); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      job = await r.json();
      backoff = 2000;
    } catch (e) {
      console.error(`[${now()}] 서버 연결 실패: ${e.message} — ${backoff / 1000}초 뒤 재시도`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 60000);
      continue;
    }
    const t0 = Date.now();
    console.log(`[${now()}] 일감 받음 ${job.caller} (${job.prompt.length.toLocaleString()}자${job.json ? ', JSON' : ''})`);
    const out = await runCodex(job.prompt, job.json);
    const ms = Date.now() - t0;
    console.log(`[${now()}]   → ${out.ok ? '완료' : '실패: ' + out.error} · ${(ms / 1000).toFixed(1)}초 · 명령사용 ${out.commands}`);
    try {
      await post('/api/legal/codex/result', { id: job.id, ok: out.ok, text: out.text, error: out.error, ms, commands: out.commands }, 20000);
    } catch (e) {
      console.error(`[${now()}] 결과 전송 실패: ${e.message}`);
    }
  }
}

if (require.main === module) main();
module.exports = { runCodex };
