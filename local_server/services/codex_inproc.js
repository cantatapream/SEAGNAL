/**
 * ============================================================================
 * 파일명: services/codex_inproc.js
 * 역할: VM 에서 돌던 Codex 작업자(scripts/codex_worker.js)를 **Fly 서버 안에서** 자식 프로세스로 띄운다.
 *       작업자 코드는 그대로 — 서버 주소만 자기 자신(127.0.0.1)으로 바꿔 VM 과 똑같이 poll/result 로 일한다.
 * ============================================================================
 *
 * [켜는 법] Fly 시크릿 두 개
 *   - NRYA_CODEX_SECRET : 원래 있던 것(중계 창구 열쇠). 없으면 작업자가 401/404 로 일을 못 한다.
 *   - CODEX_AUTH_JSON   : ChatGPT 로그인 파일(auth.json) 내용 전체(JSON 그대로 또는 base64). **이게 있을 때만 작업자를 띄운다.**
 *   끄기: `fly secrets unset CODEX_AUTH_JSON` (또는 NRYA_CODEX_SECRET 을 지우면 기능 전체가 꺼진다).
 *
 * [왜 시크릿을 "씨앗"으로만 쓰나 — 확인한 사실]
 *   codex 는 로그인 토큰이 만료되면 새 토큰으로 바꾸고 auth.json 을 **다시 쓴다.** 갱신용 토큰은 한 번 쓰면
 *   못 쓴다(codex 0.169.0 실행파일 안 문구: "your refresh token was already used. Please log out and sign in again").
 *   시크릿은 읽기 전용이라 바뀐 토큰을 담을 수 없다 → 시크릿만 쓰면 첫 갱신 뒤 다음 재시작에서 로그인이 깨진다.
 *   그래서 볼륨(CODEX_HOME_DIR)에 auth.json 이 **없을 때만** 시크릿 내용으로 만들고, 그다음부터는 codex 가
 *   볼륨 파일을 스스로 갱신한다. 로그인을 새로 하고 싶으면 볼륨 파일을 지우고 시크릿을 새 내용으로 바꾼다.
 *   ⚠같은 auth.json 을 VM 과 Fly 가 함께 쓰면 한쪽 갱신이 다른 쪽 토큰을 무효로 만든다 — VM 작업자는 끈다.
 *
 * [연계]
 *   - server.js                 → app.listen 직후 start(PORT)
 *   - scripts/codex_worker.js   → 띄우는 대상(NRYA_SERVER·CODEX_HOME 만 바꿔 넘긴다)
 *   - services/codex_bridge.js  → 작업자가 붙는 대기열(같은 프로세스 안)
 *   - Dockerfile                → `codex` 명령 설치(@openai/codex)
 *   - services/codex_vm_runbook.md §7 → 운영 안내
 * [로드 순서] 서버 모듈(require) — index2.html 과 무관.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// 볼륨(fly.toml [[mounts]] /app/local_server/data) 안 — 배포·재시작 뒤에도 갱신된 로그인이 남는다.
const CODEX_HOME_DIR = path.join(__dirname, '..', 'data', '.codex');
const WORKER = path.join(__dirname, '..', 'scripts', 'codex_worker.js');

/**
 * 볼륨에 auth.json 이 없으면 시크릿 내용으로 만든다(있으면 건드리지 않는다).
 * 예: ensureAuth('{"tokens":…}') → 'seeded' | 'kept'
 * @param {string} seed - CODEX_AUTH_JSON 값(JSON 또는 base64) @returns {'seeded'|'kept'}
 * [연계] ← start. 이미 있으면 codex 가 갱신해 둔 최신본이므로 덮어쓰지 않는다(위 머리말).
 */
function ensureAuth(seed) {
  const file = path.join(CODEX_HOME_DIR, 'auth.json');
  if (fs.existsSync(file)) return 'kept';
  // 윈도 cmd 에서 따옴표가 든 JSON 을 그대로 넣기 어려워 base64 로도 받는다({ 로 시작하지 않으면 base64 로 본다).
  if (!seed.trim().startsWith('{')) seed = Buffer.from(seed.trim(), 'base64').toString('utf8');
  JSON.parse(seed); // 깨진 값이면 여기서 throw — 작업자를 띄우지 않는다
  fs.mkdirSync(CODEX_HOME_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, seed, { mode: 0o600 });
  return 'seeded';
}

/**
 * 시크릿 CODEX_AUTH_JSON 이 있으면 작업자를 자식 프로세스로 띄우고, 죽으면 다시 띄운다.
 * 예: start(3001) → 로그 「[codex 작업자] 시작 (로그인 kept)」
 * @param {number|string} port - 이 서버가 듣는 포트 @returns {void}
 * [연계] ← server.js app.listen 콜백. 작업자 출력은 서버 로그(fly logs)에 그대로 섞인다.
 */
function start(port) {
  const seed = process.env.CODEX_AUTH_JSON;
  if (!seed) return;
  let how;
  try { how = ensureAuth(seed); } catch (e) {
    console.error('[codex 작업자] 로그인 파일 준비 실패 — 작업자를 띄우지 않음:', e.message);
    return;
  }
  console.log(`[codex 작업자] 시작 (로그인 ${how === 'seeded' ? '시크릿에서 새로 만듦' : '볼륨 파일 사용'})`);
  const env = { ...process.env, NRYA_SERVER: `http://127.0.0.1:${port}`, CODEX_HOME: CODEX_HOME_DIR };
  delete env.CODEX_AUTH_JSON; // 작업자·codex 에는 필요 없다(로그인은 파일로 읽는다)
  let delay = 30000;
  const launch = () => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [WORKER], { env, stdio: 'inherit' });
    child.on('exit', (code) => {
      // 오래 돌다 죽었으면 30초 뒤, 곧바로 또 죽으면(열쇠 틀림 등) 최대 10분까지 늘려 로그가 넘치지 않게 한다.
      delay = Date.now() - t0 > 10 * 60 * 1000 ? 30000 : Math.min(delay * 2, 10 * 60 * 1000);
      console.error(`[codex 작업자] 종료(코드 ${code}) — ${delay / 1000}초 뒤 다시 띄움`);
      setTimeout(launch, delay).unref();
    });
  };
  launch();
}

module.exports = { start, ensureAuth, CODEX_HOME_DIR };
