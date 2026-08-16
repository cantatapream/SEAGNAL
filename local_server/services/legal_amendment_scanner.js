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
 * [연계]
 *  - server.js → cron.schedule('0 16 * * *', ...) 매일 KST 01:00에 1회 `runAmendmentScan()`
 *    호출(끝까지 기다림 — 사람이 안 보는 새벽 실행이라 몇 분 걸려도 무방).
 *  - routes/legal.js → GET /api/legal/amendments·POST /api/legal/amendments/:id/decide
 *    (기존 그대로) · POST /api/legal/amendments/scan-now는 `startAmendmentScan()`으로
 *    즉시 응답(백그라운드 진행, 완료를 기다리지 않음 — HTTP 응답을 몇 분씩 붙들면 리버스
 *    프록시 타임아웃 위험).
 *  - _dashboard/loop/detect_law_changes.py → 실제 탐지 엔진(H-29), `_dashboard/law_change_queue.json` 산출.
 *  - _amendments/queue.jsonl → 관리자 UI가 보는 최종 큐(각 줄 1건, status 필드로 상태 관리, 스키마 불변).
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const LEGAL_DIR = path.join(__dirname, '..', 'knowledge', 'legal');
const QUEUE_FILE = path.join(LEGAL_DIR, '_amendments', 'queue.jsonl');
const H29_QUEUE_FILE = path.join(LEGAL_DIR, '_dashboard', 'law_change_queue.json');
const DETECT_SCRIPT = path.join(LEGAL_DIR, '_dashboard', 'loop', 'detect_law_changes.py');
const DETECT_DAYS = 7;          // 큐 실행 주기와 맞춤(H-29 주간 Routine과 동일 창)
const DETECT_TIMEOUT_MS = 8 * 60 * 1000; // 실측 3~4분 + 여유(오래 걸리면 죽여서 좀비 방지)

// H-29 이벤트 유형(영문 kind) → 관리자 카드에 그대로 노출되는 한글 라벨(클라 변경 불필요).
const KIND_LABEL = {
  law_pending: '법률 개정(시행예정)',
  law_dept_changed: '소관부처 변경',
  law_renamed: '법령명 변경',
  admrul_amended: '행정규칙(고시) 개정',
  admrul_unknown_new: '신규 행정규칙(고시) 발견',
};

let _scanning = false; // 중복 실행 락(cron·수동스캔 동시 발동 시 law_change_queue.json 경합 방지)

/**
 * H-29 탐지엔진(`detect_law_changes.py`)을 자식 프로세스로 1회 실행한다. 비동기(spawn) —
 * 실행 중에도 Node 이벤트루프는 막히지 않는다(다른 API 요청은 정상 처리됨).
 * @param {number} days 최근 N일 창(기본 DETECT_DAYS)
 * @returns {Promise<{ok:boolean, code:number|null}>}
 */
function runDetectScript(days) {
  return new Promise((resolve) => {
    const child = spawn('python3', [DETECT_SCRIPT, '--days', String(days)], {
      cwd: path.dirname(DETECT_SCRIPT),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let killedByTimeout = false;
    const timer = setTimeout(() => { killedByTimeout = true; child.kill('SIGKILL'); }, DETECT_TIMEOUT_MS);
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, code: null, error: e.message }); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (killedByTimeout) return resolve({ ok: false, code, error: `timeout(${DETECT_TIMEOUT_MS}ms)` });
      resolve({ ok: code === 0, code, error: code === 0 ? null : stderr.slice(-2000) });
    });
  });
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
 * H-29 큐 항목 1건을 기존 관리자 카드 스키마({id,ts,law,kind,mst,법령명,이전,현재,status})로 변환.
 * H-29 id를 그대로 재사용해(`chg_...`) mirror 중복을 id 하나로 판별할 수 있게 한다.
 * @param {object} item H-29 `law_change_queue.json`의 원소(스키마: detect_law_changes.py make_item())
 * @returns {object} legacy 큐 1줄
 */
function toLegacyEntry(item) {
  const before = item.before || {};
  const after = item.after || {};
  const law = item.law || {};
  const ident = item.식별자 || {};
  return {
    id: item.id,
    ts: item.detected_at,
    law: law.slug || '',
    kind: KIND_LABEL[item.kind] || item.kind,
    mst: after.MST || after.ID || ident.행정규칙ID || ident.법령ID || '',
    법령명: law.name || after.제목 || before.제목 || '',
    이전: { 공포번호: before.공포번호 || '', 시행일자: before.시행일자 || '', 법령명: before.법령명 || before.제목 || '' },
    현재: { 공포번호: after.공포번호 || '', 시행일자: after.시행일자 || '', 법령명: after.법령명 || after.제목 || '' },
    status: 'pending',
  };
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
 * @returns {Promise<{scanned:number, changed:number, errors:number}>}
 */
async function runAmendmentScan() {
  if (_scanning) return { scanned: 0, changed: 0, errors: 0 };
  _scanning = true;
  try {
    const r = await runDetectScript(DETECT_DAYS);
    const pending = loadH29PendingItems();
    const known = existingLegacyIds();
    const fresh = pending.filter((it) => !known.has(it.id));
    appendQueue(fresh.map(toLegacyEntry));
    return { scanned: pending.length, changed: fresh.length, errors: r.ok ? 0 : 1 };
  } finally {
    _scanning = false;
  }
}

/**
 * 관리자 "지금 스캔" 버튼용 — 백그라운드로 스캔을 시작하고 즉시 반환한다(완료를 기다리지
 * 않음). 실측 실행시간이 3~4분이라, HTTP 응답을 그만큼 붙들면 리버스 프록시 타임아웃·
 * 브라우저 타임아웃 위험이 있어 fire-and-forget으로 바꿨다 — 관리자는 잠시 후 새로고침해
 * 결과를 확인한다.
 * @returns {{ok:boolean, started:boolean, error?:string}}
 */
function startAmendmentScan() {
  if (_scanning) return { ok: false, started: false, error: '스캔이 이미 진행 중입니다. 잠시 후 다시 시도하세요.' };
  runAmendmentScan().catch((e) => console.error('나리야 개정감지 스캔 오류:', e && e.message));
  return { ok: true, started: true };
}

module.exports = { runAmendmentScan, startAmendmentScan, QUEUE_FILE };
