/**
 * ============================================================================
 * 파일명: services/legal_amendment_scanner.js
 * 역할  : 나리야(해양법령 챗봇) 개정 감지 — 관리자 UI "개정검토" 방이 보는 큐를 채운다.
 *         (초보자용: "이 법 바뀌었나?"를 밤마다 국가법령정보센터에 물어보고,
 *          바뀐 게 있으면 관리자가 볼 수 있게 메모만 남겨두는 역할. 위키를
 *          자동으로 고치지는 않는다 — 그건 사람이 승인해야 하는 별도 단계.)
 * ----------------------------------------------------------------------------
 * [설계 — 2026-08-10 재작성, H-29 탐지엔진으로 교체]
 *  - ★이전 구현의 결함: raw _meta.json에 저장된 "고정 MST"를 매번 그대로 재조회했다.
 *    MST는 법령의 "특정 버전 하나"를 가리키는 고정 식별자라, 같은 MST를 아무리
 *    다시 물어봐도 공포번호·시행일자는 절대 바뀌지 않는다 — 즉 원리적으로 개정을
 *    감지할 수 없는 코드였다(실측 확인, `_dashboard/H29_design.md` §1).
 *  - ★새 구현: 탐지 자체는 이 파일이 하지 않는다. law.go.kr에 "최근 바뀐 법 있어?"를
 *    직접 광역질의하는, 이미 라이브 검증까지 끝난 `_dashboard/loop/detect_law_changes.py`
 *    (H-29 1~4·8~12항)를 자식 프로세스로 실행하고, 그 결과(`law_change_queue.json`)를
 *    이 파일의 기존 큐 스키마(`_amendments/queue.jsonl`)로 옮겨(mirror) 담기만 한다.
 *    → 탐지 로직을 이중 구현하지 않고, 관리자 UI·라우트 계약(GET/POST 응답 형식)은 그대로 유지.
 *  - Python 자식 프로세스는 `spawn()`(비동기)로 실행 — `execFileSync`류를 쓰면 Node
 *    이벤트루프 전체가 실행시간(실측 3~4분) 동안 멈춰 다른 모든 요청(챗봇 답변 포함)이
 *    막힌다. fire-and-forget 패턴은 `tide_field_collector.js`의 `spawnPrecompute()` 선례.
 *  - `_scanning` 모듈 락으로 중복 실행 방지(같은 `law_change_queue.json`에 두 프로세스가
 *    동시에 쓰면 경합 위험 — CLAUDE.md 병렬 안전 규칙).
 *  - 사람 승인 게이트는 그대로: 큐에 적재만 하고 위키·raw는 이 파일이 절대 자동 수정하지
 *    않는다(환각0 불변식 — 승인 후 재수집·재빌드는 별도 관리자 조치).
 *  - ★기존 `_dashboard/amendment_baseline.json`(옛 고정-MST 방식의 기준값 파일)은 더 이상
 *    쓰지 않는다 — 대체 baseline은 H-29의 `_dashboard/law_change_baseline.json`. 옛 파일은
 *    삭제하지 않고 방치(사용자 판단 시 정리, 지금 지워도 참조하는 코드 없음).
 * [2026-09-10 정정 — 실서비스에서 실제로 돌게]
 *  - ★그동안 프로덕션에서는 한 번도 결과를 낸 적이 없었다: 탐지 스크립트가 `/home/user/SEAGNAL/…`
 *    절대경로를 박고 있어 컨테이너(`/app`)에서 baseline 을 못 열고 종료코드 1 로 죽었다. 스크립트는
 *    `__file__` 기준 상대경로로 고쳤다.
 *  - ★큐 두 개(`law_change_queue.json`·`queue.jsonl`)가 이미지 안 경로라 배포마다 git 상태로 초기화돼
 *    스캔 결과·관리자 승인/무시가 전부 사라졌다. 둘 다 Fly 볼륨(`local_server/data`)으로 옮겼고
 *    (`admrul_fresh_scanner.js` 와 같은 구조), 볼륨에 파일이 없으면 첫 접근 때 git 사본으로 시드한다
 *    (관리자 큐 76건 보존). baseline 은 git 관리 참조파일이라 `_dashboard/` 그대로.
 *  - ★카드에 정보가 없었다: `toLegacyEntry()` 가 바뀐 조문·개정구분·부처·발령일 등을 버렸다 → 그대로 싣는다.
 *  - ★무관한 신규 고시(부처만 같고 우리 법과 무관한 훈령 등)가 큐를 채웠다 → 탐지 스크립트가 본문에서
 *    우리 74법 인용을 찾아 `related_laws` 를 채우고, 관련 법이 없으면 여기서 관리자 큐에 올리지 않는다
 *    (소급 실측: 기존 신규 고시 39건 중 32건이 무관).
 * [연계]
 *  - server.js → cron.schedule('0 16 * * *', ...) 매일 KST 01:00에 1회 `runAmendmentScan()`
 *    호출(끝까지 기다림 — 사람이 안 보는 새벽 실행이라 몇 분 걸려도 무방).
 *  - routes/legal.js → GET /api/legal/amendments·POST /api/legal/amendments/:id/decide
 *    (기존 그대로) · POST /api/legal/amendments/scan-now는 `startAmendmentScan()`으로
 *    즉시 응답(백그라운드 진행, 완료를 기다리지 않음 — HTTP 응답을 몇 분씩 붙들면 리버스
 *    프록시 타임아웃 위험).
 *  - _dashboard/loop/detect_law_changes.py → 실제 탐지 엔진(H-29), `--out` 으로 `data/law_change_queue.json` 산출.
 *  - services/admin_push.js → 새로 감지되면 등록된 관리자 기기로 푸시(2026-09-10 사용자 확정).
 *  - services/legal_wiki_brief.js → 승인 뒤 "무엇을 어디서 고칠지" 인계문을 만든다(GET …/wiki-brief).
 *  - data/legal_amendments_queue.jsonl → 관리자 UI가 보는 최종 큐(각 줄 1건, status 필드로 상태 관리).
 *    최초 시드 원본은 _amendments/queue.jsonl(git). 트랙 C(예고본 사전수집)도 이 파일을 읽는다.
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const LEGAL_DIR = path.join(__dirname, '..', 'knowledge', 'legal');
const DATA = path.join(__dirname, '..', 'data');           // Fly 볼륨(fly.toml mounts) — 재배포해도 남는다
/** 관리자 화면이 읽는 큐(볼륨). 없으면 첫 접근 때 SEED_QUEUE_FILE 로 시드. */
const QUEUE_FILE = path.join(DATA, 'legal_amendments_queue.jsonl');
const SEED_QUEUE_FILE = path.join(LEGAL_DIR, '_amendments', 'queue.jsonl');
/** 탐지 엔진 산출물(볼륨). 없으면 git 사본으로 시드 — dedupe_key 가 거기 있어야 같은 변동을 두 번 적재하지 않는다. */
const H29_QUEUE_FILE = path.join(DATA, 'law_change_queue.json');
const SEED_H29_QUEUE_FILE = path.join(LEGAL_DIR, '_dashboard', 'law_change_queue.json');
const DETECT_SCRIPT = path.join(LEGAL_DIR, '_dashboard', 'loop', 'detect_law_changes.py');
/** 마지막 스캔이 언제·어떻게 끝났는지(볼륨). **실패와 "개정 없음"을 화면에서 가르려고 남긴다**(2026-09-20 사용자 지시). */
const SCAN_STATUS_FILE = path.join(DATA, 'amendment_last_scan.json');
const DETECT_DAYS = 7;          // 큐 실행 주기와 맞춤(H-29 주간 Routine과 동일 창)
// ★따라잡기 창(3-84). 탐지가 며칠 실패하면(2026-09-28~10-07 TLS 장애) 고정 7일 창이 그 사이 공포분을
//   영영 못 본다 — 50일로 다시 돌려 보니 개정 5건·고시 개정 5건이 빠져 있었다. 그래서 창을
//   「마지막으로 성공한 스캔 시작 이후 + 여유 2일」 로 넓히되, 한 번에 60일을 넘기지 않는다(실측 50일 창 정상 완료).
const CATCHUP_MARGIN_DAYS = 2;
const CATCHUP_MAX_DAYS = 60;
// 실측: 2026-08-10 세션 3~4분. 2026-09-10 세션(law.go.kr 이 connection reset·응답 지연을 자주 내던 날)은
// 8분 상한에 걸려 죽었고, 직접 돌리니 10분 3초가 걸렸다(법령 질의만 약 10분 — 응답 지연·재시도 누적). 스크립트는 끝에서 한 번에 쓰므로 상한에 걸리면 그날 결과가
// 통째로 없다 — 그래서 넉넉히 잡는다(admrul_fresh_scanner 는 60분). 좀비 방지용이지 속도 기준이 아니다.
const DETECT_TIMEOUT_MS = 30 * 60 * 1000;

// H-29 이벤트 유형(영문 kind) → 관리자 카드에 그대로 노출되는 한글 라벨(클라 변경 불필요).
const KIND_LABEL = {
  law_amended: '법률 개정(시행 중)',
  law_pending: '법률 개정(시행예정)',
  law_dept_changed: '소관부처 변경',
  law_renamed: '법령명 변경',
  admrul_amended: '행정규칙(고시) 개정',
  admrul_unknown_new: '신규 행정규칙(고시) 발견',
};

let _scanning = false; // 중복 실행 락(cron·수동스캔 동시 발동 시 law_change_queue.json 경합 방지)
// 「지금 스캔」 진행 상황(메모리에만 — 서버가 재시작하면 사라진다). 탐지 스크립트가 stdout 으로
// 찍는 `@@PROG` 줄을 applyProgressLine 이 여기에 옮겨 적고, getScanProgress 가 화면에 준다.
const _progress = { phase: '', done: 0, total: 0, label: '', detail: 0, lawTotal: 0,
                    startedAt: 0, finishedAt: 0, result: null };

/**
 * 볼륨에 파일이 없으면 git 사본으로 시드한다(있으면 아무것도 안 함 — 볼륨 쪽이 항상 정본).
 * 예: seedIfMissing(QUEUE_FILE, SEED_QUEUE_FILE) → 첫 배포 때 76건 복사, 이후엔 no-op
 * @param {string} target 볼륨 경로  @param {string} seed git 사본 경로
 * [연계] queueFile()·runAmendmentScan() 이 부른다. 시드 원본이 없으면(다른 환경) 그냥 빈 상태로 시작.
 */
function seedIfMissing(target, seed) {
  if (fs.existsSync(target) || !fs.existsSync(seed)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(seed, target);
}

/**
 * 관리자 큐 파일 경로(볼륨). 첫 호출 때 git 의 `_amendments/queue.jsonl` 로 시드한다.
 * @returns {string}
 * [연계] routes/legal.js 가 GET/decide/배지 카운트에 이 경로를 쓴다(상수 QUEUE_FILE 을 직접 쓰지 말 것 — 시드가 안 된다).
 */
function queueFile() {
  seedIfMissing(QUEUE_FILE, SEED_QUEUE_FILE);
  return QUEUE_FILE;
}

/**
 * H-29 탐지 큐 파일 경로(볼륨). 첫 호출 때 git 의 `_dashboard/law_change_queue.json` 으로 시드한다.
 * @returns {string}
 * [연계] routes/legal.js 의 decide 가 **승인 상태를 이 파일에도 옮겨 적는다** — 재수집 도구
 *   (`_dashboard/loop/collect_pending_law.py --all-approved`)가 승인 여부를 **이 파일에서** 찾기 때문이다.
 *   2026-09-10 이전에는 승인이 queue.jsonl 에만 남아, 승인해도 재수집 대상이 0건이었다.
 */
function h29QueueFile() {
  seedIfMissing(H29_QUEUE_FILE, SEED_H29_QUEUE_FILE);
  return H29_QUEUE_FILE;
}

/**
 * 관리자 결정(승인/무시)을 H-29 탐지 큐(`law_change_queue.json`)에도 옮겨 적는다.
 * 예: mirrorDecisionToH29('chg_20260810_5373b9', 'approved') → {ok:true, found:true}
 * @param {string} id 큐 항목 id(두 파일이 같은 id 를 쓴다 — toLegacyEntry 가 그대로 물려준다)
 * @param {string} decision 'approved' | 'dismissed'
 * @returns {{ok:boolean, found:boolean, error?:string}} 실패해도 승인 자체를 막지 않는다(결과만 알려 준다)
 * [연계] ← routes/legal.js POST /api/legal/amendments/:id/decide.
 *        → _dashboard/loop/collect_pending_law.py 가 이 파일에서 status==='approved' 를 찾는다.
 */
function mirrorDecisionToH29(id, decision) {
  try {
    const p = h29QueueFile();
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    const items = d.items || [];
    const hit = items.find((x) => String(x.id) === String(id));
    if (!hit) return { ok: true, found: false };
    hit.status = decision;
    hit.decidedAt = new Date().toISOString();
    fs.writeFileSync(p, JSON.stringify(d, null, 1), 'utf8');
    return { ok: true, found: true };
  } catch (e) {
    return { ok: false, found: false, error: String(e.message || e) };
  }
}

/**
 * H-29 탐지엔진(`detect_law_changes.py`)을 자식 프로세스로 1회 실행한다. 비동기(spawn) —
 * 실행 중에도 Node 이벤트루프는 막히지 않는다(다른 API 요청은 정상 처리됨).
 * @param {number} days 최근 N일 창(기본 DETECT_DAYS)
 * @returns {Promise<{ok:boolean, code:number|null}>}
 */
function runDetectScript(days) {
  return new Promise((resolve) => {
    const child = spawn('python3', [DETECT_SCRIPT, '--days', String(days), '--out', H29_QUEUE_FILE], {
      cwd: path.dirname(DETECT_SCRIPT),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let killedByTimeout = false;
    const timer = setTimeout(() => { killedByTimeout = true; child.kill('SIGKILL'); }, DETECT_TIMEOUT_MS);
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c; });
    // ★stdout 을 반드시 **읽어 준다**(2026-09-10). 종전에는 pipe 로 열어 두고 아무도 안 읽어서,
    //   파이프 버퍼(리눅스 기본 64KB)가 차면 파이썬이 write 에서 멈출 수 있었다. 겸사겸사
    //   진행률 줄(`@@PROG {json}`)을 여기서 골라 화면용 상태에 반영한다.
    let outBuf = '';
    child.stdout.on('data', (c) => {
      outBuf += c;
      const lines = outBuf.split('\n');
      outBuf = lines.pop();                     // 마지막 조각은 아직 안 끝난 줄일 수 있다
      for (const ln of lines) applyProgressLine(ln);
    });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, code: null, error: e.message }); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (outBuf) applyProgressLine(outBuf);
      if (killedByTimeout) return resolve({ ok: false, code, error: `timeout(${DETECT_TIMEOUT_MS}ms)` });
      resolve({ ok: code === 0, code, error: code === 0 ? null : stderr.slice(-2000) });
    });
  });
}

/**
 * 탐지 스크립트가 찍은 한 줄에서 진행률(`@@PROG {json}`)만 골라 `_progress` 에 반영한다.
 * 사람이 읽는 print 줄은 그냥 흘려보낸다(형식이 바뀌어도 스캔은 안 죽는다).
 * @param {string} line
 * [연계] ← runDetectScript(stdout). → getScanProgress()(관리자 화면 게이지).
 */
function applyProgressLine(line) {
  const t = String(line || '').trim();
  if (!t.startsWith('@@PROG ')) return;
  try {
    const d = JSON.parse(t.slice(7));
    if (!d || typeof d !== 'object') return;
    _progress.phase = String(d.phase || '');
    _progress.done = Number(d.done) || 0;
    _progress.total = Number(d.total) || 0;
    // 1단계(법령)의 총량을 기억해 둔다 — 2단계 막대가 그 뒤를 이어 차오르게 하려면 필요하다.
    if (_progress.phase === '법령') _progress.lawTotal = _progress.total;
    _progress.label = String(d.label || '');
    if (d.detail !== undefined) _progress.detail = Number(d.detail) || 0;
    _progress.at = Date.now();
  } catch (_) { /* 진행률 한 줄이 깨져도 스캔은 계속 간다 */ }
}

/**
 * 「지금 스캔」 진행 상황을 돌려준다 — 관리자 화면이 2초마다 물어 게이지 바를 그린다.
 *
 * ★게이지는 **질의 진행도**이지 남은 시간이 아니다. 두 단계(법령 광역질의 → 행정규칙 광역질의)의
 *   질의 수를 합쳐 세고, 행정규칙 단계에서 고시 상세를 받아 온 횟수(`detail`)를 따로 얹어
 *   "멈춘 게 아니라 지금도 받고 있다"를 보여 준다. 시간 비율로 환산하지 않는 이유는 부처별
 *   고시 수가 들쭉날쭉해 **거짓 예측이 되기 때문**이다.
 * @returns {{running:boolean, phase:string, done:number, total:number, percent:number,
 *            label:string, detail:number, startedAt:number, finishedAt:number, result:object|null}}
 * [연계] ← routes/legal.js GET /api/legal/amendments/scan-progress.
 */
function getScanProgress() {
  // 두 단계를 이어 붙여 하나의 막대로 만든다. 1단계(법령)가 끝나면 그 총량은 이미 채워진 것으로 본다.
  const p = _progress;
  let done = p.done, total = p.total;
  if (p.phase === '행정규칙' && p.lawTotal) { done += p.lawTotal; total += p.lawTotal; }
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return {
    running: _scanning, phase: p.phase, done, total, percent, label: p.label, detail: p.detail,
    startedAt: p.startedAt, finishedAt: p.finishedAt, result: p.result,
  };
}

/**
 * 마지막 스캔 결과를 볼륨에 적는다(재시작해도 남게 — 메모리 진행률은 재시작하면 사라진다).
 * 예: writeScanStatus({ok:true, finishedAt:'…', scanned:12, changed:3})
 * @param {object} st 상태 객체
 * @returns {void} 기록 실패는 로그만 남긴다 — 상태 기록 때문에 스캔이 죽으면 안 된다
 * [연계] → GET /api/legal/amendments 의 `lastScan` · 관리자 "개정검토" 방 상단 한 줄
 */
function writeScanStatus(st) {
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(SCAN_STATUS_FILE, JSON.stringify(st, null, 1));
  } catch (e) { console.error('[나리야 개정감지] 상태 기록 실패:', e && e.message); }
}

/**
 * 마지막 스캔 결과를 읽는다. 한 번도 안 돌았으면 null.
 * @returns {object|null} {ok,startedAt,finishedAt,error,days,scanned,changed,filtered}
 * [연계] ← routes/legal.js GET /api/legal/amendments
 */
function readScanStatus() {
  try { return JSON.parse(fs.readFileSync(SCAN_STATUS_FILE, 'utf8')); } catch (_) { return null; }
}

/**
 * 마지막으로 **성공한** 스캔의 시작 시각(ISO). 실패 기록이 덮어써도 잃지 않도록 `lastOkAt` 을 따로 이어 적는다.
 * 예: {ok:false, lastOkAt:'2026-09-27T16:00:00Z'} → '2026-09-27T16:00:00Z' · {ok:true, startedAt:X} → X
 * @param {object|null} st readScanStatus() 결과
 * @returns {string|null} 한 번도 성공 기록이 없으면 null
 */
function lastOkAt(st) {
  if (!st) return null;
  if (st.lastOkAt) return st.lastOkAt;
  return st.ok ? (st.startedAt || st.finishedAt || null) : null;
}

/**
 * 이번 스캔의 창(일). 마지막 성공 이후 지난 날 + 여유를 덮되 DETECT_DAYS 보다 좁히지 않고 CATCHUP_MAX_DAYS 에서 자른다.
 * 예: 마지막 성공 10일 전 → 12 · 어제 → 7 · 기록 없음 → 7 · 100일 전 → 60
 * @param {object|null} st readScanStatus() 결과
 * @param {number} [nowMs] 지금(검사용)
 * @returns {number}
 * [연계] ← runAmendmentScan · scripts/test_scan_catchup.js
 */
function scanWindowDays(st, nowMs) {
  const at = Date.parse(lastOkAt(st) || '');
  if (!Number.isFinite(at)) return DETECT_DAYS;
  const gap = Math.ceil(((nowMs || Date.now()) - at) / 86400000) + CATCHUP_MARGIN_DAYS;
  return Math.min(CATCHUP_MAX_DAYS, Math.max(DETECT_DAYS, gap));
}

/** H-29 큐(`law_change_queue.json`)에서 status:pending 항목만 읽는다. 파일 없거나 파싱 실패면 []. */
function loadH29PendingItems() {
  try {
    const d = JSON.parse(fs.readFileSync(H29_QUEUE_FILE, 'utf8'));
    return (d.items || []).filter((it) => (it.status || 'pending') === 'pending');
  } catch (_) { return []; }
}

/** 기존 legacy 큐(`_amendments/queue.jsonl`)에 이미 mirror된 id 집합(중복 적재 방지). */
function existingLegacyIds() {
  const ids = new Set();
  try {
    const lines = fs.readFileSync(QUEUE_FILE, 'utf8').split('\n').filter(Boolean);
    for (const l of lines) { try { ids.add(JSON.parse(l).id); } catch (_) { /* 손상된 줄은 스킵 */ } }
  } catch (_) { /* 파일 없으면 빈 집합 */ }
  return ids;
}

/**
 * H-29 큐 항목 1건을 관리자 카드 스키마로 변환. H-29 id를 그대로 재사용해(`chg_...`) mirror 중복을
 * id 하나로 판별할 수 있게 한다.
 * 카드가 "무엇이 바뀌는지"를 보여 주려면 H-29 항목의 정보를 버리면 안 된다(2026-09-10 정정 전엔
 * 공포번호·시행일자만 남겨 카드가 `? → ?` 로 비어 있었다) — 종류(kind_code)·바뀐 조문·개정구분·부처·
 * 발령일·공포일·현행연혁코드·관련법·근거를 그대로 싣는다.
 * @param {object} item H-29 `law_change_queue.json`의 원소(스키마: detect_law_changes.py make_item())
 * @returns {object} 관리자 큐 1줄 — {id,ts,law,kind,kind_code,mst,법령명,이전,현재,changed_articles,related_laws,evidence,status}
 * [연계] → client/js/ai-chat/ai_chat.js amendmentCardHTML() 이 이 필드로 종류별 카드를 그린다.
 *        트랙 C(예고본 사전수집)도 이 스키마를 읽는다 — 필드명을 바꾸면 거기도 같이.
 */
function toLegacyEntry(item) {
  const before = item.before || {};
  const after = item.after || {};
  const law = item.law || {};
  const ident = item.식별자 || {};
  const snap = (v) => ({
    공포번호: v.공포번호 || '', 공포일자: v.공포일자 || '', 발령일자: v.발령일자 || '', 시행일자: v.시행일자 || '',
    법령명: v.법령명 || v.제목 || '', 소관부처명: v.소관부처명 || '', 제개정구분명: v.제개정구분명 || '',
    현행연혁코드: v.현행연혁코드 || '', MST: v.MST || '', ID: v.ID || '',
  });
  return {
    id: item.id,
    ts: item.detected_at,
    law: law.slug || '',
    kind: KIND_LABEL[item.kind] || item.kind,
    kind_code: item.kind,
    layer: item.layer || '',
    mst: after.MST || after.ID || ident.행정규칙ID || ident.법령ID || '',
    // 행정규칙류는 고시 제목이 카드 제목·검색 링크가 된다(법 이름은 related_laws 로 따로 보인다).
    법령명: (String(item.kind).indexOf('admrul_') === 0 ? (after.제목 || before.제목) : law.name) || after.제목 || law.name || '',
    이전: snap(before),
    현재: snap(after),
    changed_articles: item.changed_articles || [],
    related_laws: item.related_laws || [],
    evidence: item.evidence || {},
    dedupe_key: item.dedupe_key || '',
    status: 'pending',
  };
}

/**
 * 관리자 큐에 올릴 항목인가. 신규 고시(admrul_unknown_new)는 부처만 같고 우리 법과 무관한 것이 대부분이라
 * (소급 실측 2026-09-10: 39건 중 32건 무관), 본문에서 우리 법 인용을 찾은 것만 올린다.
 * 본문을 못 받아 판정 못 한 건(evidence.relevance='unchecked')은 거르지 않는다 — 조용히 버리면 안 된다.
 * @param {object} item H-29 항목
 * @returns {boolean}
 */
function isRelevant(item) {
  if (item.kind !== 'admrul_unknown_new') return true;
  if ((item.related_laws || []).length) return true;
  return (item.evidence || {}).relevance === 'unchecked';
}

/**
 * queue.jsonl에 신규 항목들을 append한다(원자적이지 않은 단순 append — `_scanning` 락으로
 * 이 파일 안에서는 동시 실행을 막으므로 충분, review_queue.md 같은 사람 동시편집 대상과 다름).
 * @param {Array<object>} entries
 */
function appendQueue(entries) {
  if (!entries.length) return;
  fs.mkdirSync(path.dirname(QUEUE_FILE), { recursive: true });
  const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  fs.appendFileSync(QUEUE_FILE, lines, 'utf8');
}

/**
 * 전체 스캔 1회 실행: H-29 탐지엔진 실행 → 결과를 legacy 큐로 mirror. 완료까지 기다린다
 * (실측 3~4분) — cron(새벽 1시, 아무도 안 기다림)이 쓰는 경로. 관리자 버튼(scan-now)은
 * 이 함수를 기다리지 않는 `startAmendmentScan()`을 대신 쓴다.
 * @returns {Promise<{scanned:number, changed:number, filtered:number, errors:number}>}
 *   scanned: H-29 큐의 pending 전체 · changed: 이번에 관리자 큐에 새로 올린 수 · filtered: 무관 신규 고시로 거른 수
 */
/**
 * @param {{days?:number}} [opts] days: 관리자가 고른 창(1~CATCHUP_MAX_DAYS). 없으면 scanWindowDays(마지막 성공 이후).
 */
async function runAmendmentScan(opts) {
  if (_scanning) return { scanned: 0, changed: 0, filtered: 0, errors: 0 };
  _scanning = true;
  // 이번 실행의 진행률을 초기화한다(지난 실행 값이 남아 게이지가 100%부터 시작하면 안 된다).
  _progress.phase = '준비'; _progress.done = 0; _progress.total = 0; _progress.label = '';
  _progress.detail = 0; _progress.lawTotal = 0;
  _progress.startedAt = Date.now(); _progress.finishedAt = 0; _progress.result = null;
  try {
    queueFile();
    seedIfMissing(H29_QUEUE_FILE, SEED_H29_QUEUE_FILE);
    const startedAt = new Date().toISOString();
    const prevStatus = readScanStatus();
    const asked = Math.floor(Number(opts && opts.days));
    const days = asked >= 1 ? Math.min(CATCHUP_MAX_DAYS, asked) : scanWindowDays(prevStatus);
    if (days > DETECT_DAYS) console.log(`[나리야 개정감지] 마지막 성공 스캔(${lastOkAt(prevStatus)}) 이후를 덮으려 창을 ${days}일로 넓힌다`);
    const r = await runDetectScript(days);
    if (!r.ok) {
      console.error('나리야 개정감지 탐지 스크립트 실패:', r.error);
      // ★실패도 알린다(3-80). law.go.kr 이 한 번도 답하지 않으면 탐지 자가 이제 실패로 죽는다 —
      //   종전에는 빈 결과를 「개정 없음」 으로 남겨, 매일 아무것도 안 보고 있어도 아무도 몰랐다.
      try {
        await require('./admin_push').sendAdminPush('나리야 개정감지 — 오늘 확인 실패',
          // 탐지 자의 오류 줄에서 「까닭:」 뒤만 싣는다(같은 문장이 두 번 찍히던 것 — 2026-10-07 사장님 화면).
          `오늘 개정 여부를 확인하지 못했습니다(「개정 없음」 이 아닙니다). 까닭: ${(String(r.error || '').split('까닭:').pop() || '').trim().slice(-160)}`,
          { type: 'amendment_scan_failed' });
      } catch (e) { console.error('[나리야 개정감지] 관리자 푸시 실패:', e && e.message); }
    }
    const pending = loadH29PendingItems();
    const known = existingLegacyIds();
    const fresh = pending.filter((it) => !known.has(it.id));
    const relevant = fresh.filter(isRelevant);
    const cards = relevant.map(toLegacyEntry);      // 한 번만 만든다(적재·알림이 같은 것을 본다)
    appendQueue(cards);
    const filtered = fresh.length - relevant.length;
    console.log(`[나리야 개정감지] 탐지 pending ${pending.length}건 · 새 항목 ${fresh.length}건 중 무관 신규 고시로 거른 ${filtered}건 · 관리자 큐 적재 ${relevant.length}건`);
    // ★새로 감지된 것이 있으면 등록된 관리자 기기로 알린다(사용자 확정 2026-09-10).
    //   푸시가 실패해도 스캔 결과는 그대로 돌려준다 — 알림 때문에 감지를 잃으면 안 된다.
    if (cards.length) await notifyAdmins(cards);
    const out = { scanned: pending.length, changed: relevant.length, filtered, errors: r.ok ? 0 : 1 };
    // ★탐지 스크립트가 죽으면 카드가 0건인데, 그것은 "개정이 없다"가 아니라 "확인을 못 했다"이다.
    //   화면이 둘을 구별할 수 있도록 결과를 볼륨에 남긴다(2026-09-20 사용자 지시).
    writeScanStatus({
      ok: r.ok, startedAt, finishedAt: new Date().toISOString(), days,
      lastOkAt: r.ok ? startedAt : lastOkAt(prevStatus),
      error: r.ok ? null : (r.error || '탐지 스크립트 실패'),
      scanned: pending.length, changed: relevant.length, filtered,
    });
    _progress.result = out;
    return out;
  } finally {
    _scanning = false;
    _progress.finishedAt = Date.now();
  }
}

/**
 * 새로 감지된 개정을 **등록된 관리자 기기**로 푸시한다(사용자 확정 2026-09-10).
 * 예: notifyAdmins([{법령명:'어선원 및 어선 재해보상보험법', 현재:{시행일자:'20260911'}}, …])
 * @param {Array<object>} entries 이번에 관리자 큐에 새로 올린 카드들
 * @returns {Promise<void>} 실패는 로그만 남기고 삼킨다 — 알림 때문에 스캔이 죽으면 안 된다
 * [연계] → services/admin_push.sendAdminPush(통합관리자센터 '등록' 버튼으로 등록한 기기들).
 *   ★본문에 **"승인 후 위키 수동 갱신이 필요하다"** 를 반드시 넣는다 — 승인만 하면 끝나는 줄 알면
 *     위키가 옛 내용으로 남는다(승인은 답변 전환·재수집 표시까지만 한다, `_amendments/README.md`).
 */
async function notifyAdmins(entries) {
  try {
    const { sendAdminPush } = require('./admin_push');
    const names = [];
    for (const e of entries) {
      const n = e.법령명 || e.law || '';
      if (n && names.indexOf(n) < 0) names.push(n);
    }
    const head = names.slice(0, 3).join(' · ') + (names.length > 3 ? ` 외 ${names.length - 3}건` : '');
    const arts = entries.reduce((n, e) => n + ((e.changed_articles || []).length), 0);
    const title = `⚖ 법령 개정 ${entries.length}건 감지`;
    // 푸시 본문은 **평문**이다 — 별표(**) 같은 마크다운 표시는 그대로 글자로 보인다.
    const body = `${head}${arts ? ` · 바뀐 조문 ${arts}개` : ''}\n승인 후 위키를 사람이 갱신해야 합니다. 개정검토 방에서 승인하고 「위키 반영 지시문」을 복사하세요.`;
    const r = await sendAdminPush(title, body, { url: 'https://seagnal-server.fly.dev/?tab=admin', kind: 'legal_amendment' });
    console.log(`[나리야 개정감지] 관리자 푸시 — 성공 ${r.sent}건 · 실패 ${r.failed}건`);
  } catch (e) {
    console.error('[나리야 개정감지] 관리자 푸시 실패(스캔은 정상):', e && e.message);
  }
}

/**
 * 관리자 "지금 스캔" 버튼용 — 백그라운드로 스캔을 시작하고 즉시 반환한다(완료를 기다리지
 * 않음). 실측 실행시간이 3~4분이라, HTTP 응답을 그만큼 붙들면 리버스 프록시 타임아웃·
 * 브라우저 타임아웃 위험이 있어 fire-and-forget으로 바꿨다 — 관리자는 잠시 후 새로고침해
 * 결과를 확인한다.
 * @returns {{ok:boolean, started:boolean, error?:string}}
 */
function startAmendmentScan(opts) {
  if (_scanning) return { ok: false, started: false, error: '스캔이 이미 진행 중입니다. 잠시 후 다시 시도하세요.' };
  runAmendmentScan(opts).catch((e) => console.error('나리야 개정감지 스캔 오류:', e && e.message));
  return { ok: true, started: true };
}

module.exports = { runAmendmentScan, startAmendmentScan, getScanProgress,
  // 진행률 한 줄 파서는 검사(test_wiki_brief_bulk.js)가 직접 먹여 보려고 함께 내보낸다.
  applyProgressLine, queueFile, h29QueueFile, mirrorDecisionToH29, readScanStatus, scanWindowDays, lastOkAt,
  notifyAdmins, toLegacyEntry, isRelevant, QUEUE_FILE, H29_QUEUE_FILE, CATCHUP_MAX_DAYS };
