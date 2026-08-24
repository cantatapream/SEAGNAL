/**
 * ============================================================================
 * 파일명: services/admrul_fresh_scanner.js
 * 역할  : 나리야(해양법령 챗봇) **원문 신선도 점검** — 관리자 UI "원문신선도" 방이 보는
 *         큐를 채운다.
 *         (초보자용: 우리가 예전에 받아 둔 법령·고시 원문이 그새 개정돼 낡은 것이
 *          아닌지 주마다 국가법령정보센터에 물어보고, 낡은 것이 있으면 관리자가 볼 수
 *          있게 목록만 남겨 두는 역할. 위키를 자동으로 고치지는 않는다.)
 *         대상은 두 가지다 — **행정규칙(고시·훈령) 653건**과
 *         **법률·시행령·시행규칙 222건**(2026-08-24 사용자 지적으로 후자를 추가했다).
 * ----------------------------------------------------------------------------
 * [왜 있나 — 2026-08-23 실제 사고]
 *  「위험물 선박운송 기준」이 2016년판으로 수집돼 있어, 위키가 **이미 삭제된 조문을
 *  현행처럼** 설명하고 있던 것이 드러났다. 구버전 원문은 내용이 멀쩡해 보여 사람 눈으로는
 *  못 잡는다. 그래서 원문 머리글의 `ID:`(수집 당시 일련번호)와 law.go.kr 이 지금 내려주는
 *  현행 일련번호를 **기계로 대조**한다. 숫자 비교라 AI 판단이 전혀 필요 없다.
 *  설계·이력은 `knowledge/legal/MASTER_PLAN.md` H-49, 교훈은 `_LESSONS.md` L-175~L-178.
 *
 * [왜 서버로 옮겼나 — 2026-08-24]
 *  종전에는 Claude 세션을 주 1회 깨우는 방식(Routine)이었는데, 그 세션에 저장소가 붙지
 *  않으면 점검 자체가 시작도 못 했다(2026-08-24 실제로 그렇게 실패). 점검은 순수 계산이라
 *  사람도 AI도 필요 없으므로 서버 정기작업으로 옮겼다 — 바로 옆에서 이미 같은 방식으로
 *  돌고 있는 `legal_amendment_scanner.js`(매일 새벽 개정감지)와 같은 구조다.
 *
 * [구조 — 개정감지와 일부러 똑같이 맞췄다]
 *  ① 파이썬 점검 스크립트를 `spawn()`(비동기)으로 1회 실행한다. `execFileSync`류를 쓰면
 *     Node 이벤트루프가 실행시간(실측 20~30분) 동안 멈춰 챗봇 답변을 포함한 모든 요청이
 *     막힌다.
 *  ② 결과 JSON 에서 `구버전` 행만 뽑아 큐(JSONL)로 옮겨 담는다.
 *  ③ **새로 발견된 것이 있을 때만** 관리자 푸시를 보낸다(같은 건은 다시 안 보낸다 —
 *     매주 같은 알림이 오면 사람이 알림을 무시하게 되고, 그러면 진짜 발견을 놓친다).
 *  ④ 위키·raw 는 **절대 자동 수정하지 않는다.** 목록만 남기고 사람이 정한다(환각0 승인게이트).
 *
 * [저장 위치 — 재배포해도 안 지워지는 곳에 쓴다]
 *  결과·큐를 `local_server/data/` 밑에 둔다. 이 디렉토리만 fly.io 볼륨으로 마운트돼 있어
 *  (`fly.toml [[mounts]] destination = '/app/local_server/data'`) 재배포해도 남는다.
 *  이미지 안(`knowledge/legal/_dashboard/`)에 쓰면 배포할 때마다 관리자가 처리하던 목록이
 *  통째로 사라진다.
 *
 * [연계]
 *  - server.js → cron 매주 일요일 KST 03:00 `runFreshnessScan()`
 *    (개정감지는 매일 01:00 이라 시간을 겹치지 않게 뒀다 — 둘 다 law.go.kr 을 두드린다)
 *  - routes/legal.js → GET /api/legal/freshness · POST /api/legal/freshness/:id/decide
 *    · POST /api/legal/freshness/scan-now
 *  - client/js/ai-chat/ai_chat.js → 관리자 검토센터 "원문신선도" 방
 *  - services/admin_push.js → sendAdminPush()
 *  - knowledge/legal/_dashboard/loop/admrul_fresh.py → 행정규칙 점검(표준 라이브러리만 씀)
 *  - knowledge/legal/_dashboard/loop/law_fresh.py    → 법률·시행령·시행규칙 점검
 *  - knowledge/legal/_dashboard/loop/admrul_fresh_pass2.py → 행정규칙 2차 대조(이름불일치 해소)
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const adminQueues = require('./legal_admin_queues');

const LEGAL = path.join(__dirname, '..', 'knowledge', 'legal');
const SCRIPT = path.join(LEGAL, '_dashboard', 'loop', 'admrul_fresh.py');
// 법률·시행령·시행규칙용 형제 점검(2026-08-24 신설). 행정규칙과 묻는 것은 같고 대상만 다르다.
const LAW_SCRIPT = path.join(LEGAL, '_dashboard', 'loop', 'law_fresh.py');
// 1차에서 '이름불일치'로 남은 것을 **보유 일련번호로 본문을 열어 공식명을 받아** 다시 판정한다.
// 실측(2026-08-24): 1차가 못 푼 60건 중 **53건**이 이 2차로 판정됐고, 그중 2건은 다시 보니
// 오탐이었다(보유 ID 가 딴 문서를 가리킴 · 일부러 남긴 구판 보존본) — 실제로 확인된 것은 51건,
// 남은 이름불일치 7건. 오탐 둘은 각각 원인을 막았다(admrul_fresh.py 감시제외·보존본 판별,
// admrul_fresh_pass2.py 의 shares_chunk 안전장치).
// 이걸 안 돌리면 그 60건은 매주 점검이 돌아도 영원히 확인되지 않는다.
const PASS2_SCRIPT = path.join(LEGAL, '_dashboard', 'loop', 'admrul_fresh_pass2.py');
const DATA = path.join(__dirname, '..', 'data');
const REPORT_FILE = path.join(DATA, 'admrul_fresh_report.json');
const LAW_REPORT_FILE = path.join(DATA, 'law_fresh_report.json');
/** 관리자 화면이 읽는 큐. 개정검토(`_amendments/queue.jsonl`)와 같은 형식(JSONL). */
const QUEUE_FILE = path.join(DATA, 'admrul_fresh_queue.jsonl');
/** 마지막 점검이 언제·어떻게 끝났는지. 화면 위에 그대로 보여 준다. */
const STATUS_FILE = path.join(DATA, 'admrul_fresh_status.json');

// 행정규칙 653건 x 약 2.7초(실측 8건 22초) ≈ 30분, 법령 222건 x 약 1.9초(실측 15건 29초) ≈ 7분.
// 한 스크립트당 상한이다. 넉넉히 잡되 무한정 붙들지는 않는다.
const SCAN_TIMEOUT_MS = 60 * 60 * 1000;

let _scanning = false; // 중복 실행 락(cron·수동스캔 동시 발동 시 결과 파일 경합 방지)

/**
 * 점검 스크립트를 자식 프로세스로 1회 실행한다. 비동기(spawn) — 실행 중에도 다른 API 요청은
 * 정상 처리된다.
 * 예: await runScript(SCRIPT, ['--out', REPORT_FILE]) → {ok:true, code:0}
 * @param {string} script 실행할 파이썬 파일 경로
 * @param {string[]} args 넘길 인자
 * @returns {Promise<{ok:boolean, code:number|null, error?:string}>}
 * [연계] → _dashboard/loop/admrul_fresh.py · law_fresh.py
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
 * 큐 항목의 id. **제목 + 현행 일련번호**로 만든다.
 * 예: freshid('위험물 선박운송 기준', '2100000091234') → 'adf_3f9c1a2b'
 * @param {string} title 행정규칙명
 * @param {string} serial law.go.kr 현행 일련번호
 * @returns {string}
 * [연계] 같은 고시가 또 개정되면 일련번호가 달라지므로 **새 항목**이 된다(그게 맞다).
 *        반대로 같은 개정이 매주 다시 잡히면 같은 id 라 중복 적재되지 않는다.
 */
function freshId(title, serial) {
  const h = crypto.createHash('sha1').update(`${title}|${serial}`, 'utf8').digest('hex');
  return 'adf_' + h.slice(0, 8);
}

/**
 * 관리자가 **무엇을 해야 하는지**를 카드에 그대로 적어 준다.
 * 예: actionsFor(row) → ['① 원문을 다시 받는다 — …', '② …']
 * @param {object} row admrul_fresh.py 결과의 구버전 행 1개
 * @returns {string[]} 순서대로 할 일
 * [연계] 이 문구가 없으면 관리자는 "낡았다"는 사실만 알고 무엇을 고칠지 모른다.
 */
function actionsFor(row) {
  const n = (row.wiki_pages || []).length;
  const cur = row.current || {};
  const wikiStep = n
    ? `이 원문을 인용하는 위키 ${n}곳을 고친다 — 아래 목록의 페이지에서 달라진 조문을 짚은 부분만 수정한다.`
    : `이 원문을 인용하는 위키 페이지를 아직 못 찾았다 — 조문 번호·소관 기관으로 다시 찾아본다.`;
  if (row.tier && row.tier !== '행정규칙') {
    // ★법률 계열은 재수집 도구가 `_meta.json` 의 MST(그 판 고유번호)를 그대로 다시 부른다.
    //   MST 를 안 바꾸고 재수집하면 **똑같은 옛날 판이 다시 내려온다.** 번호 갱신이 1번이다.
    return [
      `① \`raw/**/${row.slug || ''}/_meta.json\` 의 \`families.${row.tier}.MST\` 를 현행 번호 **${cur.serial || '?'}** 로 바꾼다. ★이걸 먼저 안 하면 다음 단계가 옛날 판을 그대로 다시 받아 온다(재수집 도구가 이 파일의 MST 를 쓴다).`,
      `② \`python3 _dashboard/loop/recollect_jomun.py\` 로 조문을 다시 받는다.`,
      `③ ${wikiStep}`,
    ];
  }
  return [
    `① 원문을 다시 받는다 — \`python3 _dashboard/loop/admrul_recollect_stale.py --dry\` 로 먼저 확인한 뒤 \`--dry\` 없이 실행. ★"보류"로 나온 것은 강제로 덮어쓰지 말 것(첨부파일·이미지 판독 전사가 들어 있는 파일이다).`,
    `② 달라진 조문을 뽑는다 — \`python3 _dashboard/loop/admrul_diff_wiki.py\` (신설·삭제·변경 조문 목록).`,
    `③ ${wikiStep}`,
  ];
}

/**
 * 결과 JSON 의 `구버전` 행을 큐 항목으로 바꾼다.
 * @param {object} row admrul_fresh.py 결과 행
 * @returns {object} 큐 1줄
 */
function toQueueEntry(row) {
  const cur = row.current || {};
  return {
    id: freshId(row.title, cur.serial || ''),
    ts: new Date().toISOString(),
    title: row.title,
    tier: row.tier || '행정규칙',
    slug: row.slug || '',
    kind: '원문 구버전(' + (row.tier || '행정규칙') + ')',
    pending: row.pending || [],
    held_ids: row.held_ids || [],
    current: { serial: cur.serial || '', issued: cur.issued || '', no: cur.no || '', state: cur.state || '' },
    files: row.files || [],
    wiki_pages: row.wiki_pages || [],
    actions: actionsFor(row),
    status: 'pending',
  };
}

/** 큐에 이미 들어 있는 id 집합(중복 적재 방지). */
function existingIds() {
  const ids = new Set();
  for (const e of adminQueues.readJsonl(QUEUE_FILE)) if (e && e.id) ids.add(e.id);
  return ids;
}

/** 마지막 점검 결과를 기록한다 — 화면 위에 "언제 검사했고 어떻게 끝났나"를 보여주기 위해. */
function writeStatus(obj) {
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(STATUS_FILE, JSON.stringify(obj, null, 1));
  } catch (e) { console.error('[AdmrulFresh] 상태 기록 실패:', e && e.message); }
}

/** 마지막 점검 상태를 읽는다. 없으면 null(= 아직 한 번도 안 돌았다). */
function readStatus() {
  try { return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); } catch (_) { return null; }
}

/**
 * 주간 점검 1회. 점검 → 구버전만 큐에 적재 → **새로 발견된 것이 있을 때만** 관리자 푸시.
 * 예: await runFreshnessScan() → {checked:653, stale:61, added:2}
 * @returns {Promise<{ok:boolean, checked:number, stale:number, added:number, error?:string}>}
 * [연계] server.js cron(매주 일요일 03:00 KST) · routes/legal.js scan-now
 */
async function runFreshnessScan() {
  if (_scanning) return { ok: false, checked: 0, stale: 0, added: 0, error: '점검이 이미 진행 중입니다.' };
  _scanning = true;
  const startedAt = new Date().toISOString();
  try {
    // 두 점검을 잇달아 돌린다. 둘 다 law.go.kr 을 두드리므로 동시에 돌리지 않는다.
    //   ① 행정규칙(고시·훈령) 653건  ② 법률·시행령·시행규칙 222건
    const parts = [
      { name: '행정규칙', script: SCRIPT, out: REPORT_FILE, pass2: PASS2_SCRIPT },
      { name: '법령', script: LAW_SCRIPT, out: LAW_REPORT_FILE },
    ];
    const errors = [];
    let allRows = [];
    let checked = 0, freshCnt = 0, unknown = 0, mismatch = 0, repealed = 0;
    for (const part of parts) {
      let r = await runScript(part.script, ['--out', part.out]);
      // 행정규칙은 2차 대조까지 돌린다. 1차가 실패했으면 2차는 의미가 없으니 건너뛴다.
      if (r.ok && part.pass2) {
        const r2 = await runScript(part.pass2, ['--report', part.out]);
        if (!r2.ok) console.error('[AdmrulFresh] 2차 대조 실패(1차 결과는 그대로 쓴다):', r2.error);
      }
      let rep = null;
      try { rep = JSON.parse(fs.readFileSync(part.out, 'utf8')); } catch (_) { rep = null; }
      if (!rep) {
        // **"이상 없음"이 아니라 "확인 못 했음"이다.** 한쪽이 실패해도 다른 쪽은 살린다.
        errors.push(`${part.name}: ${r.error || '결과 파일을 읽지 못했습니다'}`);
        continue;
      }
      checked += rep.checked || 0;
      freshCnt += rep.fresh || 0;
      unknown += rep.unknown || 0;
      // '이름불일치' = 응답은 왔는데 우리 제목과 공식명이 달라 **확인하지 못한 것**.
      // 화면에서 '이상 없음'과 절대 섞이면 안 되므로 따로 세어 올린다.
      mismatch += rep.mismatch || 0;
      repealed += rep.maybe_repealed || 0;
      allRows = allRows.concat(rep.rows || []);
    }
    if (errors.length === parts.length) {
      const st = { ok: false, startedAt, finishedAt: new Date().toISOString(),
        error: errors.join(' / '), checked: 0, stale: 0, added: 0 };
      writeStatus(st);
      console.error('[AdmrulFresh] 점검 실패:', st.error);
      return st;
    }

    const staleRows = allRows.filter((x) => x.verdict === '구버전');
    const known = existingIds();
    const fresh = staleRows.map(toQueueEntry).filter((e) => !known.has(e.id));
    for (const e of fresh) adminQueues.appendJsonl(QUEUE_FILE, e);

    const st = { ok: true, startedAt, finishedAt: new Date().toISOString(),
      checked, fresh: freshCnt, stale: staleRows.length, unknown, mismatch, repealed,
      added: fresh.length,
      // 한쪽만 실패했으면 ok:true 로 두되 **무엇을 못 봤는지 반드시 남긴다.**
      partialError: errors.length ? errors.join(' / ') : null, error: null };
    writeStatus(st);
    if (errors.length) console.error('[AdmrulFresh] 일부 점검 실패:', st.partialError);

    if (fresh.length) {
      // 새로 나온 것만 알린다. 이미 알린 건은 다시 보내지 않는다.
      const head = fresh.slice(0, 3).map((e) => e.title).join(', ');
      const more = fresh.length > 3 ? ` 외 ${fresh.length - 3}건` : '';
      try {
        await require('./admin_push').sendAdminPush(
          `나리야 원문 신선도 — 구버전 ${fresh.length}건 발견`,
          `${head}${more}. 관리자 센터 → AI → 원문신선도 방에서 후속조치를 확인하세요.`,
          { type: 'admrul_fresh', count: String(fresh.length) });
      } catch (e) { console.error('[AdmrulFresh] 관리자 푸시 실패:', e && e.message); }
    }
    return st;
  } finally {
    _scanning = false;
  }
}

/**
 * 관리자 "지금 점검" 버튼용 — 백그라운드로 시작하고 즉시 반환한다(실측 20~30분이라
 * HTTP 응답을 붙들 수 없다). 관리자는 잠시 후 새로고침해 결과를 본다.
 * @returns {{ok:boolean, started:boolean, error?:string}}
 */
function startFreshnessScan() {
  if (_scanning) return { ok: false, started: false, error: '점검이 이미 진행 중입니다. 20~30분 걸립니다.' };
  runFreshnessScan().catch((e) => console.error('나리야 원문 신선도 점검 오류:', e && e.message));
  return { ok: true, started: true };
}

module.exports = { runFreshnessScan, startFreshnessScan, readStatus, QUEUE_FILE, REPORT_FILE };
