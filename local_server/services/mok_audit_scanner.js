/**
 * ============================================================================
 * 파일명: services/mok_audit_scanner.js
 * 역할  : 나리야(해양법령 챗봇) **원문 결손 점검** — "가진 파일에 내용이 다 들어 있나"를
 *         주마다 국가법령정보센터와 대조하고, 빠진 것이 있으면 관리자 큐에 목록만 남긴다.
 *         (초보자용: 옆방의 "원문신선도"가 *"우리 사본이 낡았나"* 를 본다면, 이쪽은
 *          *"판은 맞는데 안이 비었나"* 를 본다. 둘 다 위키를 자동으로 고치지는 않는다.)
 *         두 가지를 본다 —
 *           ① **조문 목(가·나·다) 누락** — `mok_audit.py` (법령 계열)
 *           ② **고시 별표·별지 누락** — `admrul_annex_survey.py` (행정규칙)
 * ----------------------------------------------------------------------------
 * [왜 있나 — 2026-09-20 C-2 결정의 이행]
 *  `verify_all.sh` 의 ①수집 게이트(`collect_eval.js`)가 보는 것은 **"가져야 할 파일이
 *  손에 있나"** 까지다. **"그 파일에 조문이 다 있나"** 는 아무도 안 봤다.
 *  실측(2026-09-20): 그걸 보는 도구 둘(`mok_audit.py`·`admrul_annex_survey.py`)은
 *  **저장소 어디에서도 불리지 않고 있었다.** 한 번 돌리고 끝낸 검사였다.
 *  판번호 쪽(`admrul_fresh.py`·`law_fresh.py`)은 이미 주간 cron 이 있는데 이쪽만 없었다.
 *
 * [왜 상시 게이트(`verify_all.sh`)가 아니라 주간 cron 인가]
 *  두 검사 모두 law.go.kr 을 수백 번 두드린다. 커밋마다 돌릴 수 없고, 네트워크가 없는
 *  자리에서 돌리면 **항상 빨갛다. 빨간 게이트는 곧 무시되는 게이트다.**
 *  그리고 **무엇도 멈추지 않는다** — 남의 서버 사정으로 우리 배포가 멈추면 안 된다.
 *
 * [왜 수요일인가]
 *  같은 law.go.kr 을 두드리는 작업이 이미 둘 있다 — 개정감지 **매일 01:00**,
 *  원문신선도 **일요일 03:00**. 2026-09-20 에 둘을 겹쳐 돌렸다가 서로 느려져 전수 점검이
 *  45/200 에서 멈춘 것을 실측했다. 그래서 양쪽에서 가장 먼 **수요일 03:00 KST**.
 *
 * [★이 점검은 판을 못 박은 뒤에야 믿을 수 있다 — 2026-09-21]
 *  `mok_audit.py` 는 원래 `lawService.do?target=law&MST=` 로 원본을 받았는데, 그 호출은
 *  **한 MST 가 시행일 판을 여럿 가질 때 어느 판이 올지 고르지 못한다.**
 *  실측: 「도선법 시행령」 MST 243569 는 판이 넷(20250101 현행/20240101/20230101/20220705)이고
 *  그 호출은 **2년 전 20230101 판**을 줬다. 그 판과 견줘 "목 2개 누락"이 나왔고,
 *  현행으로 받으니 우리 raw 와 **완전히 일치**했다. 이 결함으로 **573계열 전수 점검 하나가
 *  통째로 무효**가 됐다(L-297).
 *  → 지금은 `law_api_guard.fetch_law_body` 가 현행 시행일자를 조회해 `efYd` 로 판을 못 박고,
 *    못 정하면 **아무것도 주지 않는다.** 그 위에서만 이 스캐너를 믿는다.
 *
 * [구조 — 원문신선도 스캐너와 일부러 똑같이 맞췄다]
 *  ① 파이썬을 `spawn()`(비동기)으로 1회씩 실행 — `execFileSync` 류를 쓰면 Node 이벤트루프가
 *     실행시간(실측 20~40분) 동안 멈춰 챗봇 답변까지 막힌다.
 *  ② 결과 JSON 에서 **누락 행만** 뽑아 큐(JSONL)로 옮긴다.
 *  ③ **새로 발견된 것이 있을 때만** 관리자 푸시(같은 알림이 반복되면 사람이 알림을 무시한다).
 *  ④ **raw·위키 자동 수정 절대 금지** — 목록만 남기고 사람이 누른다(환각0 승인게이트).
 *  ⑤ 닫아 둔 카드라도 이번 점검에서 또 누락으로 나오면 **다시 대기로 돌린다**.
 *
 * [저장 위치] `local_server/data/` — fly.io 볼륨이라 재배포해도 안 지워진다.
 *   이미지 안(`knowledge/legal/_dashboard/`)에 쓰면 배포마다 처리 목록이 사라진다.
 *
 * [연계]
 *  - server.js → cron 매주 **수요일 03:00 KST** `runMokAuditScan()`
 *  - services/legal_admin_queues.js → 큐 읽기·쓰기(원문신선도와 같은 JSONL 형식)
 *  - services/admin_push.js → sendAdminPush()
 *  - knowledge/legal/_dashboard/loop/mok_audit.py          → 조문 목 누락 대조
 *  - knowledge/legal/_dashboard/loop/admrul_annex_survey.py → 고시 별표 누락 조사
 *  - knowledge/legal/_dashboard/loop/law_api_guard.py       → 판 고정(위 ★ 참조)
 *  - 형제: services/admrul_fresh_scanner.js (판번호 쪽, 일요일 03:00)
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const adminQueues = require('./legal_admin_queues');

const LEGAL = path.join(__dirname, '..', 'knowledge', 'legal');
const MOK_SCRIPT = path.join(LEGAL, '_dashboard', 'loop', 'mok_audit.py');
const ANNEX_SCRIPT = path.join(LEGAL, '_dashboard', 'loop', 'admrul_annex_survey.py');
const DATA = path.join(__dirname, '..', 'data');
const MOK_REPORT_FILE = path.join(DATA, 'mok_audit.json');
const ANNEX_REPORT_FILE = path.join(DATA, 'admrul_annex_survey.json');
/** 관리자 화면이 읽는 큐. 원문신선도(`admrul_fresh_queue.jsonl`)와 같은 형식(JSONL). */
const QUEUE_FILE = path.join(DATA, 'mok_audit_queue.jsonl');
/** 마지막 점검이 언제·어떻게 끝났는지. 화면 위에 그대로 보여 준다. */
const STATUS_FILE = path.join(DATA, 'mok_audit_status.json');

// 573계열 x 약 2~4초 ≈ 20~40분, 별표 조사 824건 x 약 2초 ≈ 30분. 한 스크립트당 상한이다.
const SCAN_TIMEOUT_MS = 90 * 60 * 1000;

let _scanning = false; // 중복 실행 락(cron·수동스캔 동시 발동 시 결과 파일 경합 방지)

/**
 * 점검 스크립트를 자식 프로세스로 1회 실행한다. 비동기(spawn).
 * 예: await runScript(MOK_SCRIPT, ['--out', MOK_REPORT_FILE]) → {ok:true, code:0}
 * @param {string} script 실행할 파이썬 파일 경로
 * @param {string[]} args 넘길 인자
 * @returns {Promise<{ok:boolean, code:number|null, error?:string}>}
 */
function runScript(script, args) {
  return new Promise((resolve) => {
    fs.mkdirSync(DATA, { recursive: true });
    const child = spawn('python3', [script, ...args], {
      cwd: path.dirname(script),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let killedByTimeout = false;
    const timer = setTimeout(() => { killedByTimeout = true; child.kill('SIGKILL'); }, SCAN_TIMEOUT_MS);
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c; });
    // python3 자체가 없으면 여기로 온다(ENOENT). 조용히 넘기지 말고 상태 파일에 남긴다.
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, code: null, error: e.message }); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (killedByTimeout) return resolve({ ok: false, code, error: `timeout(${SCAN_TIMEOUT_MS}ms)` });
      resolve({ ok: code === 0, code, error: code === 0 ? null : stderr.slice(-2000) });
    });
  });
}

/**
 * 큐 항목의 id. **무엇이 · 어디서 · 얼마나** 빠졌는지로 만든다.
 * 예: mokId('도선법', '시행령', 'raw/…/시행령.txt', 2) → 'mok_9a1b2c3d'
 * @param {string} law 법령명  @param {string} kind 계층(법률/시행령/…)
 * @param {string} file raw 상대경로  @param {number|string} n 빠진 수
 * @returns {string}
 * [연계] 같은 자리에서 **빠진 수가 달라지면 새 카드**가 된다(상황이 변한 것이므로 맞다).
 *        수까지 같으면 같은 id 라 중복 적재되지 않는다.
 */
function mokId(law, kind, file, n) {
  const h = crypto.createHash('sha1').update(`${law}|${kind}|${file}|${n}`, 'utf8').digest('hex');
  return 'mok_' + h.slice(0, 8);
}

/**
 * 관리자가 **무엇을 해야 하는지**를 카드에 그대로 적는다.
 * @param {object} row mok_audit.py 의 누락 행 1개
 * @returns {string[]} 순서대로 할 일
 */
function mokActions(row) {
  return [
    `① **정말 빠진 것인지 먼저 확인한다.** 이 파일이 \`raw/15_관련타부처/\` 아래라면 `
      + `다른 부처 법을 **연결된 조문만** 받아 둔 발췌본일 수 있고, 그때는 모자란 것이 정상이다 `
      + `(도구가 선언을 못 읽었을 뿐). 파일 머리글이 스스로 "발췌"라고 밝히는지 본다.`,
    `② 전문인데 정말 빠졌으면 다시 받는다 — \`python3 _dashboard/loop/recollect_jomun.py\`. `
      + `★이 도구는 \`_meta.json\` 의 MST 를 쓰고, 판 고정은 \`law_api_guard.fetch_law_body\` 가 한다.`,
    `③ 받은 뒤 이 점검을 다시 돌려 0 이 되는지 본다 — \`python3 _dashboard/loop/mok_audit.py\`.`,
    `④ 그 조문을 짚는 위키가 있으면 새로 들어온 목(가·나·다)에 맞춰 서술을 고친다.`,
  ];
}

/** 조문 목 누락 행 → 큐 1줄. */
function toMokEntry(row) {
  const file = row.file || '';
  return {
    id: mokId(row.law || '', row.kind || '', file, row.missing || 0),
    ts: new Date().toISOString(),
    title: `${row.law || '?'} ${row.kind || ''}`.trim(),
    tier: row.kind || '',
    slug: row.law || '',
    kind: '조문 목 누락',
    verdict: '목누락',
    mst: row.mst || '',
    api_count: row.api_mok,
    raw_count: row.raw_mok,
    missing: row.missing,
    spots: row.spots || [],
    files: file ? [file] : [],
    actions: mokActions(row),
    status: 'pending',
  };
}

/** 고시 별표 누락 행 → 큐 1줄. `admrul_annex_survey.py` 의 `빠짐`·`수가모자람` 을 받는다. */
function toAnnexEntry(row, bucket) {
  const name = typeof row === 'string' ? row : (row.name || row.title || '');
  const file = typeof row === 'string' ? '' : (row.file || row.path || '');
  const api = typeof row === 'string' ? '' : (row.api ?? row.api_count ?? '');
  const raw = typeof row === 'string' ? '' : (row.raw ?? row.raw_count ?? '');
  return {
    id: mokId(name, '행정규칙', file || name, `${bucket}|${api}|${raw}`),
    ts: new Date().toISOString(),
    title: name,
    tier: '행정규칙',
    slug: '',
    kind: bucket === '빠짐' ? '고시 별표 없음' : '고시 별표 수가 모자람',
    verdict: bucket,
    api_count: api,
    raw_count: raw,
    files: file ? [file] : [],
    actions: [
      `① 원문에 별표가 정말 있는지 확인한다 — 이 판정은 거칠다(본문에 \`[별표\` 블록이 하나라도 `
        + `있으면 "있다"로 세므로, 5건 중 1건만 들어온 경우는 "수가모자람"으로만 잡힌다).`,
      `② 빠졌으면 받는다 — \`python3 _dashboard/loop/admrul_fill_annex.py\`.`,
      `③ 받은 뒤 \`python3 _dashboard/loop/admrul_annex_survey.py\` 로 다시 센다.`,
      `④ 그 별표를 짚는 위키가 있으면 표 내용에 맞춰 서술을 고친다.`,
    ],
    status: 'pending',
  };
}

/** 큐에 이미 들어 있는 id 집합(중복 적재 방지). */
function existingIds() {
  const ids = new Set();
  for (const e of adminQueues.readJsonl(QUEUE_FILE)) if (e && e.id) ids.add(e.id);
  return ids;
}

/**
 * 관리자가 닫아 둔(처리완료·해당없음) 카드 중 **이번 점검에서도 누락으로 나온 것**을 다시 대기로 돌린다.
 * @param {object[]} entries 이번 점검이 누락으로 판정한 행 중 **이미 큐에 있는 것들**
 * @param {string} [file] 큐 파일 경로(테스트가 임시 파일을 준다)
 * @returns {string[]} 다시 대기로 돌린 카드 id 목록
 * [왜] 원문신선도 쪽과 같은 이유다 — "처리완료"를 눌러도 실제로 다시 받았다면 이번 점검에서
 *   누락으로 나오지 않는다. **점검이 다시 빠졌다고 말하면 그 판정이 이긴다.**
 */
function reopenStillMissing(entries, file = QUEUE_FILE) {
  if (!entries.length) return [];
  const byId = new Map(adminQueues.readJsonl(file).map((e) => [e.id, e]));
  const back = [];
  for (const e of entries) {
    const cur = byId.get(e.id);
    if (!cur || (cur.status || 'pending') === 'pending') continue;
    const was = cur.status === 'done' ? '처리완료' : '해당없음';
    const n = (cur.reopen_count || 0) + 1;
    adminQueues.updateJsonlById(file, e.id, {
      status: 'pending',
      reopened_at: new Date().toISOString(),
      reopen_count: n,
      reopen_reason: `${was}으로 닫았는데 이번 점검에서도 누락으로 나왔습니다(${n}번째 재등장).`,
    });
    back.push(e.id);
  }
  if (back.length) console.log(`[MokAudit] 닫혀 있었지만 아직 빠져 있는 카드 ${back.length}건을 다시 대기로 돌렸습니다.`);
  return back;
}

/**
 * ★대기 카드 중 **이번 점검에서 더는 누락으로 나오지 않은 것**을 자동으로 닫는다 (3-88).
 * @param {object[]} entries 이번 점검이 누락으로 판정한 행 전부(목·별표)
 * @param {{mokOk:boolean, annexOk:boolean, noAnswer:string[], annexFailed:string[], excerpt:object[]}} ctx
 *   mokOk/annexOk: 그쪽 점검이 실제로 답을 받았나(실패한 쪽 카드는 건드리지 않는다)
 *   noAnswer: 원본을 못 받은 계열 라벨(`법 계층 (MST=…)`) · annexFailed: 조회 실패한 고시 이름
 *   excerpt: 발췌본으로 판정된 행(닫는 까닭에 적는다)
 * @param {string} [file] 큐 파일(테스트가 임시 파일을 준다)
 * @returns {string[]} 닫은 카드 id
 * [왜] 2026-10-08 사장님 「72장을 하나씩 누를 필요가 있겠어?」 — 점검 규칙을 고쳐(3-85) 65건이
 *   더는 누락이 아닌데도 카드는 사람이 누를 때까지 대기로 남았다. 다시 띄우는 쪽(reopenStillMissing)만
 *   있고 닫는 쪽이 없었다. **원본을 못 받아 판정 못 한 카드는 닫지 않는다** — 「모른다」 를 「해소」 로 읽지 않는다.
 */
function autoResolveCleared(entries, ctx, file = QUEUE_FILE) {
  const now = new Set(entries.map((e) => e.id));
  const nowTitle = new Set(entries.filter((e) => e.kind === '조문 목 누락').map((e) => e.title));
  const unknown = new Set((ctx.noAnswer || []).map((l) => String(l).replace(/\s*\(MST=[^)]*\)\s*$/, '').trim()));
  const annexFailed = new Set((ctx.annexFailed || []).map((x) => String(typeof x === 'string' ? x : (x.name || x.title || '')).trim()));
  const excerptWhy = new Map((ctx.excerpt || []).map((r) => [String(r.file || ''), r.excerpt_why || '발췌본']));
  const closed = [];
  for (const cur of adminQueues.readJsonl(file)) {
    if (!cur || !cur.id || (cur.status || 'pending') !== 'pending' || now.has(cur.id)) continue;
    const isMok = cur.kind === '조문 목 누락';
    if (isMok ? !ctx.mokOk : !ctx.annexOk) continue;            // 그쪽 점검이 실패했으면 모른다
    if (isMok && unknown.has(String(cur.title || '').trim())) continue;   // 원본을 못 받은 계열
    if (!isMok && annexFailed.has(String(cur.title || '').trim())) continue;
    const f = (cur.files || [])[0] || '';
    let why;
    if (isMok && nowTitle.has(cur.title)) why = '같은 자리가 빠진 수가 달라져 새 카드로 다시 올라왔다';
    else if (isMok && excerptWhy.has(f)) why = `발췌본으로 판정됐다(${excerptWhy.get(f)}) — 모자란 것이 정상`;
    else why = '이번 점검에서 누락으로 나오지 않았다';
    adminQueues.updateJsonlById(file, cur.id, {
      status: 'done', decidedBy: '자동(점검)', decidedAt: new Date().toISOString(),
      auto_resolved: true, resolve_reason: why,
    });
    closed.push(cur.id);
  }
  if (closed.length) console.log(`[MokAudit] 더는 누락이 아닌 대기 카드 ${closed.length}건을 자동으로 닫았습니다.`);
  return closed;
}

/** 마지막 점검 결과를 기록한다 — 화면 위에 "언제 검사했고 어떻게 끝났나"를 보여주기 위해. */
function writeStatus(obj) {
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(STATUS_FILE, JSON.stringify(obj, null, 1));
  } catch (e) { console.error('[MokAudit] 상태 기록 실패:', e && e.message); }
}

/** 마지막 점검 상태를 읽는다. 없으면 null(= 아직 한 번도 안 돌았다). */
function readStatus() {
  try { return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); } catch (_) { return null; }
}

/**
 * 주간 점검 1회. 점검 → 누락만 큐에 적재 → **새로 발견된 것이 있을 때만** 관리자 푸시.
 * 예: await runMokAuditScan() → {ok:true, checked:573, missing:5, added:1}
 * @returns {Promise<object>} 상태 객체(STATUS_FILE 에 쓰는 것과 같다)
 * [연계] server.js cron(매주 수요일 03:00 KST)
 */
async function runMokAuditScan() {
  if (_scanning) return { ok: false, checked: 0, missing: 0, added: 0, error: '점검이 이미 진행 중입니다.' };
  _scanning = true;
  const startedAt = new Date().toISOString();
  try {
    const errors = [];
    let entries = [];
    let checked = 0, noAnswer = 0, excerptOk = 0, notFound = 0, missingMoks = 0;
    let annexMissing = 0, annexShort = 0, annexFail = 0;

    // ① 조문 목 누락 — 둘 다 law.go.kr 을 두드리므로 **잇달아** 돌린다(동시 금지).
    const r1 = await runScript(MOK_SCRIPT, ['--out', MOK_REPORT_FILE]);
    let rep = null;
    try { rep = JSON.parse(fs.readFileSync(MOK_REPORT_FILE, 'utf8')); } catch (_) { rep = null; }
    if (!rep) {
      // **"이상 없음"이 아니라 "확인 못 했음"이다.**
      errors.push(`조문 목: ${r1.error || '결과 파일을 읽지 못했습니다'}`);
    } else if ((rep.checked || 0) > 0 && (rep.no_answer || []).length >= (rep.checked || 0)) {
      // ★하나도 답을 못 받은 판은 **실패**다(3-80) — 「결손 없음」 숫자에 섞지 않는다.
      checked = rep.checked || 0;
      noAnswer = (rep.no_answer || []).length;
      errors.push(`조문 목: ${checked}건을 하나도 확인하지 못했다(응답없음 ${noAnswer})`);
    } else {
      checked = rep.checked || 0;
      noAnswer = (rep.no_answer || []).length;
      excerptOk = (rep.excerpt_ok || []).length;
      notFound = (rep.file_not_found || []).length;
      missingMoks = rep.missing_moks || 0;
      entries = entries.concat((rep.missing || []).map(toMokEntry));
    }

    // ② 고시 별표 누락
    const r2 = await runScript(ANNEX_SCRIPT, ['--out', ANNEX_REPORT_FILE]);
    let arep = null;
    try { arep = JSON.parse(fs.readFileSync(ANNEX_REPORT_FILE, 'utf8')); } catch (_) { arep = null; }
    const annexAnswered = arep ? ['빠짐', '이미있음', '수가모자람', 'API에별표없음'].reduce((n, k) => n + (arep[k] || []).length, 0) : 0;
    const annexFailedAll = arep ? (arep['실패'] || []).length : 0;
    if (!arep) {
      errors.push(`고시 별표: ${r2.error || '결과 파일을 읽지 못했습니다'}`);
    } else if (!annexAnswered && annexFailedAll) {
      // ★하나도 답을 못 받은 판은 실패다(3-80).
      errors.push(`고시 별표: ${annexFailedAll}건 조회가 모두 실패했다`);
    } else {
      annexMissing = (arep['빠짐'] || []).length;
      annexShort = (arep['수가모자람'] || []).length;
      annexFail = (arep['실패'] || []).length + (arep['ID없음'] || []).length;
      entries = entries
        .concat((arep['빠짐'] || []).map((r) => toAnnexEntry(r, '빠짐')))
        .concat((arep['수가모자람'] || []).map((r) => toAnnexEntry(r, '수가모자람')));
    }

    if (errors.length === 2) {
      const st = { ok: false, startedAt, finishedAt: new Date().toISOString(),
        error: errors.join(' / '), checked, no_answer: noAnswer, missing: 0, added: 0 };
      writeStatus(st);
      console.error('[MokAudit] 점검 실패:', st.error);
      try {
        await require('./admin_push').sendAdminPush('나리야 원문결손 — 점검 실패',
          `이번 점검은 아무것도 확인하지 못했습니다. ${String(st.error).slice(0, 180)}`, { type: 'mok_audit_failed' });
      } catch (e) { console.error('[MokAudit] 관리자 푸시 실패:', e && e.message); }
      return st;
    }

    const known = existingIds();
    const fresh = entries.filter((e) => !known.has(e.id));
    for (const e of fresh) adminQueues.appendJsonl(QUEUE_FILE, e);
    const reopened = reopenStillMissing(entries.filter((e) => known.has(e.id)));
    const resolved = autoResolveCleared(entries, {
      mokOk: !!rep && !errors.some((m) => m.startsWith('조문 목')),
      annexOk: !!arep && !errors.some((m) => m.startsWith('고시 별표')),
      noAnswer: (rep && rep.no_answer) || [],
      annexFailed: arep ? [].concat(arep['실패'] || [], arep['ID없음'] || []) : [],
      excerpt: (rep && rep.excerpt_ok) || [],
    });

    const st = { ok: true, startedAt, finishedAt: new Date().toISOString(),
      checked, missing: entries.length, missing_moks: missingMoks,
      no_answer: noAnswer, excerpt_ok: excerptOk, file_not_found: notFound,
      annex_missing: annexMissing, annex_short: annexShort, annex_unknown: annexFail,
      added: fresh.length, reopened: reopened.length, resolved: resolved.length,
      // 한쪽만 실패했으면 ok:true 로 두되 **무엇을 못 봤는지 반드시 남긴다.**
      partialError: errors.length ? errors.join(' / ') : null, error: null };
    writeStatus(st);
    if (errors.length) console.error('[MokAudit] 일부 점검 실패:', st.partialError);

    if (resolved.length && !fresh.length && !reopened.length) {
      try {
        await require('./admin_push').sendAdminPush(`나리야 원문 결손 — 해소된 카드 ${resolved.length}건 자동 정리`,
          `이번 점검에서 더는 누락으로 나오지 않은 대기 카드 ${resolved.length}건을 자동으로 닫았습니다.`, { type: 'mok_audit_resolved', count: String(resolved.length) });
      } catch (e) { console.error('[MokAudit] 관리자 푸시 실패:', e && e.message); }
    }
    if (fresh.length || reopened.length) {
      const names = fresh.slice(0, 3).map((e) => e.title);
      const more = fresh.length > 3 ? ` 외 ${fresh.length - 3}건` : '';
      const title = fresh.length
        ? `나리야 원문 결손 — 누락 ${fresh.length}건 발견`
          + (reopened.length ? ` (+ 다시 뜬 ${reopened.length}건)` : '')
        : `나리야 원문 결손 — 닫은 카드 ${reopened.length}건이 아직 빠져 있습니다`;
      const body = fresh.length
        ? `${names.join(', ')}${more}.`
          + (reopened.length ? ` 닫혀 있었지만 아직 빠져 ${reopened.length}건을 다시 띄웠습니다.` : '')
          + ' 관리자 센터 → AI → 원문결손 방에서 후속조치를 확인하세요.'
        : `처리완료ㆍ해당없음으로 닫았던 ${reopened.length}건이 이번 점검에서도 누락으로 나왔습니다.`
          + ' 원문을 실제로 다시 받으면 다음 점검에서 사라집니다.';
      try {
        await require('./admin_push').sendAdminPush(title, body,
          { type: 'mok_audit', count: String(fresh.length), reopened: String(reopened.length) });
      } catch (e) { console.error('[MokAudit] 관리자 푸시 실패:', e && e.message); }
    }
    return st;
  } finally {
    _scanning = false;
  }
}

/**
 * 관리자 "지금 점검" 버튼용 — 백그라운드로 시작하고 즉시 반환한다(실측 20~40분이라
 * HTTP 응답을 붙들 수 없다).
 * @returns {{ok:boolean, started:boolean, error?:string}}
 */
function startMokAuditScan() {
  if (_scanning) return { ok: false, started: false, error: '점검이 이미 진행 중입니다. 20~40분 걸립니다.' };
  runMokAuditScan().catch((e) => console.error('나리야 원문 결손 점검 오류:', e && e.message));
  return { ok: true, started: true };
}

module.exports = {
  runMokAuditScan, startMokAuditScan, readStatus,
  QUEUE_FILE, MOK_REPORT_FILE, ANNEX_REPORT_FILE,
  reopenStillMissing, autoResolveCleared, toMokEntry, toAnnexEntry,
};
