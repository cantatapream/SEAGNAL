/**
 * ============================================================================
 * 파일명: services/effective_date.js
 * 역할: "오늘(KST) 기준으로 어느 판이 유효한가"를 한 곳에서 정한다 — 예고본 raw(`_대기/<시행일>/`)와
 *       위키의 시행일 마커(`<!--시행 d-->`·`<!--시행전 d-->`) 둘 다 이 파일의 날짜 하나로 갈린다.
 * ============================================================================
 *
 * [설명 — 왜 있나 (H-29 트랙 C, `_dashboard/H29_stage_design.md`)]
 * 개정 법령은 공포 뒤 시행까지 유예가 있다. 예고본을 미리 받아 `_대기/<시행일>/` 에 두고, 위키에도
 * 옛·새 서술을 마커로 둘 다 적어 두면, 시행일에 서버가 파일을 고칠 필요가 없다 — **읽을 때 날짜로 고르면**
 * 된다. 서버는 git 을 못 쓰므로 "그날 파일을 바꾸는" 방식은 애초에 불가능하고, 타이머·트리거도 필요 없다.
 *
 * [계약]
 *  - 오늘 계산은 `todayKST()` **한 곳**. TZ 환경변수에 기대지 않고 UTC+9 를 직접 더한다.
 *    테스트·수동 확인은 `setTodayForTest('20260911')` 로 주입한다(null 이면 해제) — 시각 의존 테스트 금지 규칙.
 *  - raw: `_dashboard/pending_index.json` 에 적힌 대기본 중 `date <= today` 인 **가장 큰 date** 하나를 고른다.
 *    폴더를 뒤지지 않는다(팝업은 raw 를 GitHub API 로 읽어서, 폴더를 뒤지면 대기본 없는 법마다 404 가 난다).
 *    뒤 시행본이 앞 시행본을 포함한다는 것은 실측으로 확인했다(설계 문서 F6).
 *  - ★**승인 게이트**(사용자 확정 2026-09-10): 날짜가 됐어도 **관리자가 승인한 대기본만** 반영한다.
 *    승인 상태는 개정검토 큐(`data/legal_amendments_queue.jsonl`, Fly 볼륨)의 `status:'approved'` 이고,
 *    대기본과는 `pending_index.json` 의 `queue_id` 로 이어진다. 승인 기록을 못 찾으면 **닫는다**.
 *    raw 는 `stagedRawPath` 가 그 항목을 건너뛰고, 위키는 `unapprovedStageDates()` 가 준 날짜를
 *    `applyStageMarkers(body, today, blocked)` 가 "아직 시행 전"처럼 다룬다.
 *  - 위키: `<!--시행 d-->…<!--/시행-->` 는 today >= d 일 때만, `<!--시행전 d-->…<!--/시행전-->` 는 today < d 일 때만
 *    남기고 마커는 항상 지운다. 블록형(마커가 각각 한 줄)은 그 줄들이 통째로 빠지고, 인라인형(한 줄 안에서
 *    열고 닫음)은 그 자리만 바뀐다. 표 안에서는 인라인형만 쓴다(게이트가 표를 줄 단위로 읽는다). 중첩 없음.
 *
 * [연계]
 * - services/article_text.js       → loadArticle 이 stagedRawPath() 로 읽을 파일을 고른다
 * - services/legal_retriever.js    → readPage 가 applyStageMarkers() 를, loadLawBundle 이 stagedRawPath() 를 쓴다
 * - knowledge/legal/_dashboard/pending_index.json → collect_pending_law.py / fold_effective.py 가 만든다
 * - services/legal_amendment_scanner.js → queueFile()(승인 상태를 읽는 개정검토 큐)
 * - local_server/scripts/test_pending_law.js      → 이 파일의 회귀 테스트
 * [로드 순서] 번들 없음(서버). legal_retriever.js·article_text.js 가 require 시점에 함께 로드한다.
 *   ⚠이 파일은 legal_retriever 를 require 하지 않는다(순환 방지 — article_text 가 legal_retriever 를 쓴다).
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');
const amendmentScanner = require('./legal_amendment_scanner');   // 승인 상태(개정검토 큐)를 읽는다

const PENDING_INDEX_JSON = path.join(__dirname, '..', 'knowledge', 'legal', '_dashboard', 'pending_index.json');

let _todayOverride = null;

/**
 * 오늘 날짜(KST) `YYYYMMDD`. 테스트 주입값이 있으면 그것.
 * 예: todayKST() → '20260910'
 * @param {number} [nowMs] - 기준 시각(ms, UTC). 생략하면 Date.now()
 * @returns {string}
 * [연계] → stagedRawPath()·applyStageMarkers() 의 기본 today. ← 테스트는 setTodayForTest 로 고정한다.
 */
function todayKST(nowMs) {
  if (_todayOverride) return _todayOverride;
  const t = (typeof nowMs === 'number' ? nowMs : Date.now()) + 9 * 3600 * 1000;
  return new Date(t).toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * 테스트·수동 확인용 오늘 날짜 고정. `null` 이면 해제.
 * 예: setTodayForTest('20260911'); … setTodayForTest(null)
 * @param {string|null} yyyymmdd
 */
function setTodayForTest(yyyymmdd) {
  _todayOverride = yyyymmdd ? String(yyyymmdd) : null;
}

// ── pending_index.json 캐시(mtime 감지) — notice_index·contacts 와 같은 방식 ──
let _idxCache = null, _idxMtime = 0;
function loadPendingIndex() {
  let mt = 0;
  try { mt = fs.statSync(PENDING_INDEX_JSON).mtimeMs; } catch (_) { _idxCache = {}; _idxMtime = 0; return _idxCache; }
  if (_idxCache && _idxMtime === mt) return _idxCache;
  try { _idxCache = JSON.parse(fs.readFileSync(PENDING_INDEX_JSON, 'utf8')) || {}; }
  catch (_) { _idxCache = {}; }
  _idxMtime = mt;
  return _idxCache;
}

// ── 승인 게이트 ────────────────────────────────────────────────────────────────
// ★예고본은 **관리자가 승인한 것만** 시행일에 반영한다(사용자 확정 2026-09-10).
//   종전에는 날짜만 보고 갈아탔다 — 사서가 미리 받아 둔 것이 승인 없이 답변에 나갔다.
//   승인 상태를 **개정검토 큐**(`data/legal_amendments_queue.jsonl`, Fly 볼륨)에서 읽는다.
//   왜 거기인가: `pending_index.json` 은 git 파일이고 서버는 git 을 못 쓴다 — 관리자가 폰에서
//   누른 승인이 남을 수 있는 곳은 볼륨뿐이다. 그 큐에는 이미 승인 API 가 있다
//   (`POST /api/legal/amendments/:id/decide`, status: approved|dismissed).
//   대기본과 큐 항목은 `pending_index.json` 의 `queue_id` 로 이어져 있다(collect_pending_law.py 가 적는다).
// ★승인 기록을 못 찾으면 **닫는다**(승인 안 된 것으로 본다). 못 찾았는데 열어 주면 게이트가 없는 것과 같다.
let _apprCache = null, _apprMtime = -1, _apprPath = '';
let _apprOverride = null;                 // 테스트 주입(setApprovedForTest) — setTodayForTest 와 같은 방식

/**
 * 테스트·수동 확인용 승인 목록 고정. `null` 이면 해제(실제 큐를 읽는다).
 * 예: setApprovedForTest(['chg_20260810_5373b9']); … setApprovedForTest(null)
 * @param {Array<string>|Set<string>|null} ids
 */
function setApprovedForTest(ids) {
  _apprOverride = ids ? (ids instanceof Set ? ids : new Set(ids)) : null;
}

/** 승인 상태 파일의 mtime — 바뀌면 위키 본문 캐시도 다시 만들어야 한다(readPage 캐시 키). */
function approvalStamp() {
  if (_apprOverride) return 'test:' + [..._apprOverride].sort().join(',');
  try { return fs.statSync(amendmentScanner.queueFile()).mtimeMs; } catch (_) { return -1; }
}

/**
 * 개정검토 큐에서 **승인된 항목 id 집합**을 읽는다(mtime 캐시).
 * 예: loadApprovedIds().has('chg_20260810_5373b9')
 * @returns {Set<string>}
 * [연계] ← isStageApproved. → services/legal_amendment_scanner.queueFile()(볼륨 큐, 없으면 git 사본으로 시드)
 */
function loadApprovedIds() {
  if (_apprOverride) return _apprOverride;
  let p = '';
  try { p = amendmentScanner.queueFile(); } catch (_) { p = ''; }
  const mt = p ? approvalStamp() : -1;
  if (_apprCache && _apprPath === p && _apprMtime === mt) return _apprCache;
  const s = new Set();
  if (p) {
    try {
      for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { const r = JSON.parse(line); if (r && r.status === 'approved' && r.id) s.add(String(r.id)); } catch (_) { /* 손상된 줄은 스킵 */ }
      }
    } catch (_) { /* 파일 없음 — 승인 0건으로 본다 */ }
  }
  _apprCache = s; _apprMtime = mt; _apprPath = p;
  return s;
}

/**
 * 대기본 한 항목이 승인됐나. `relFile` 을 주면 그 층만, 생략하면 그 항목의 **모든 층**이 승인돼야 한다.
 * 예: isStageApproved({date:'20260911', queue_id:{'법률.txt':'chg_1'}}, '법률.txt', new Set(['chg_1'])) → true
 * @param {object} entry - pending_index 의 한 항목({date, files, mst, queue_id})
 * @param {string|null} [relFile] - 층 파일 이름. null 이면 전 층
 * @param {Set<string>} [approved] - 테스트 주입(생략하면 loadApprovedIds())
 * @returns {boolean}
 * [연계] ← stagedRawPath · unapprovedStageDates · routes/legal.js(관리자 '원문' 방 표시)
 */
function isStageApproved(entry, relFile, approved) {
  const ids = approved || loadApprovedIds();
  const map = (entry && entry.queue_id) || {};
  const want = relFile ? [map[relFile]] : Object.keys(map).map((k) => map[k]);
  if (!want.length) return false;                       // 승인 기록이 아예 없다 → 닫는다
  return want.every((q) => q && ids.has(String(q)));
}

/**
 * 그 법(위키 slug)의 대기본 중 **아직 승인되지 않은 시행일** 집합 — 위키 마커를 접지 말아야 할 날짜들.
 * 예: unapprovedStageDates('어선원및어선재해보상보험법') → Set{'20260911'}
 * @param {string} lawSlug - 위키 파일 이름 앞부분(`<법>__<주제>.md` 의 `<법>`)
 * @param {object} [index] - 테스트 주입
 * @param {Set<string>} [approved] - 테스트 주입
 * @returns {Set<string>}
 * [연계] ← legal_retriever.readPage 가 applyStageMarkers 3번째 인자로 넘긴다.
 *   ⚠지도에 **없는** 날짜(사람이 손으로 넣은 마커·이미 fold 된 뒤 남은 것)는 여기 안 들어간다 —
 *     승인 기록이 애초에 없는 마커까지 막으면 그 서술이 영영 안 바뀐다. 관리 대상만 막는다.
 */
function unapprovedStageDates(lawSlug, index, approved) {
  const out = new Set();
  const slug = String(lawSlug || '');
  if (!slug) return out;
  const idx = index || loadPendingIndex();
  const ids = approved || loadApprovedIds();
  for (const base of Object.keys(idx)) {
    if (base !== slug && !base.endsWith('/' + slug)) continue;
    for (const e of idx[base] || []) {
      if (e && e.date && !isStageApproved(e, null, ids)) out.add(String(e.date));
    }
  }
  return out;
}

/**
 * 그 법 폴더의 파일(`법률.txt` 등)에 대해 **오늘 유효한 대기본 경로**를 돌려준다. 없으면 null(= 현행을 읽는다).
 * 예: stagedRawPath('local_server/knowledge/legal/raw/06_선원노동/어선원및어선재해보상보험법', '법률.txt', '20260911')
 *     → 'local_server/knowledge/legal/raw/06_선원노동/어선원및어선재해보상보험법/_대기/20260911/법률.txt'
 * @param {string} base - raw 법 폴더(저장소 상대경로, rawPathOf 값)
 * @param {string} relFile - 폴더 안 파일 이름(`법률.txt`·`시행령.txt`·`시행규칙.txt`)
 * @param {string} [today] - `YYYYMMDD`, 생략하면 todayKST()
 * @param {object} [index] - 테스트용 지도 주입(생략하면 pending_index.json)
 * @param {Set<string>} [approved] - 테스트용 승인 id 집합 주입(생략하면 loadApprovedIds())
 * @returns {string|null}
 * [연계] ← article_text.loadArticle · legal_retriever.loadLawBundle. → pending_index.json
 *   ★시행일이 지났어도 **승인되지 않은 대기본은 고르지 않는다**(2026-09-10 승인 게이트).
 */
function stagedRawPath(base, relFile, today, index, approved) {
  const idx = index || loadPendingIndex();
  const list = idx[String(base || '').replace(/\/+$/, '')];
  if (!Array.isArray(list) || !list.length) return null;
  const d = today || todayKST();
  const ids = approved || loadApprovedIds();
  let best = null;
  for (const e of list) {
    if (!e || !e.date || String(e.date) > d) continue;
    if (!Array.isArray(e.files) || e.files.indexOf(relFile) < 0) continue;
    if (!isStageApproved(e, relFile, ids)) continue;              // 승인 전 — 현행을 읽는다
    if (!best || String(e.date) > String(best.date)) best = e;
  }
  return best ? `${base}/_대기/${best.date}/${relFile}` : null;
}

const MARK_HEAD = '<!--시행';
// 인라인형: 한 줄 안에서 열고 닫는다. 표 칸 안에서는 이것만 허용.
const INLINE_RE = /<!--(시행전|시행) (\d{8})-->([^\n]*?)<!--\/\1-->/g;
// 블록형: 여는·닫는 마커가 각각 한 줄을 통째로 차지한다.
const OPEN_LINE_RE = /^\s*<!--(시행전|시행) (\d{8})-->\s*$/;
const CLOSE_LINE_RE = /^\s*<!--\/(시행전|시행)-->\s*$/;

// blocked 에 든 날짜는 시행일이 지났어도 **아직 안 온 것처럼** 다룬다(승인 전 예고본).
function isActive(kind, date, today, blocked) {
  const on = blocked && blocked.has(date) ? false : today >= date;
  return kind === '시행' ? on : !on;
}

/** 본문에 시행일 마커가 하나라도 있나(빠른 판별 — 캐시 키에 오늘을 넣을지 정한다). */
function hasStageMarkers(body) {
  const s = String(body || '');
  return s.indexOf(MARK_HEAD) >= 0 || s.indexOf('<!--/시행') >= 0;
}

// 형식이 어긋난 것까지 잡아내는 느슨한 마커 패턴(닫는 것 포함). 검사·비상 제거용.
const ANY_MARK_RE = /<!--\s*\/?\s*시행(?:전)?[^>]*?-->/g;

/**
 * 마커 표기만 걷어내고 **내용은 하나도 버리지 않는다**(마커가 깨졌을 때의 비상 경로).
 * 예: stripStageMarkerTags('a<!--시행 20260918-->새<!--/시행-->b') → 'a새b'
 * @param {string} s
 * @returns {string}
 * [연계] ← applyStageMarkers 의 fail-safe. 옛·새가 같이 보이지만 본문이 사라지지는 않는다.
 */
function stripStageMarkerTags(s) {
  return String(s || '').replace(ANY_MARK_RE, '');
}

/**
 * 마커의 **짝과 형식**을 검사한다(§10 규약). 런타임 fail-safe 와 lint 가 같은 규칙을 쓴다.
 * 잡는 것: ①닫히지 않은 블록 ②짝 없는 닫는 마커 ③여는 종류와 닫는 종류 불일치 ④중첩
 *          ⑤형식이 어긋나 접히지 않는 표기(줄 가운데의 여는 마커·`2026-09-11` 같은 날짜 등)
 * 예: checkStageMarkers('<!--시행전 20260918-->\n옛\n') → {ok:false, errors:[{line:1, msg:'블록 마커가 닫히지 않았다'}]}
 * @param {string} body - 위키 본문
 * @returns {{ok:boolean, errors:Array<{line:number, msg:string}>}}
 * [연계] ← applyStageMarkers · _dashboard/loop/lint_stage_markers.py(게이트) · fold_effective.py 가 같은 규칙을 파이썬으로 갖는다.
 */
function checkStageMarkers(body) {
  const src = String(body || '');
  const errors = [];
  if (!hasStageMarkers(src)) return { ok: true, errors };
  let open = null, openLine = 0;
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], n = i + 1;
    const o = OPEN_LINE_RE.exec(line);
    if (o) {
      if (open) errors.push({ line: n, msg: `블록 마커가 닫히기 전에 또 열렸다(${openLine}행 <!--${open}-->)` });
      else { open = o[1]; openLine = n; }
      continue;
    }
    const c = CLOSE_LINE_RE.exec(line);
    if (c) {
      if (!open) errors.push({ line: n, msg: '닫는 블록 마커에 짝이 없다' });
      else if (open !== c[1]) { errors.push({ line: n, msg: `닫는 종류가 다르다(연 것은 <!--${open}-->)` }); open = null; }
      else open = null;
      continue;
    }
    // 짝 맞는 인라인을 걷어낸 뒤에도 마커 글자가 남으면 형식이 어긋난 것이다.
    if (/<!--\s*\/?\s*시행/.test(line.replace(new RegExp(INLINE_RE.source, 'g'), ''))) {
      errors.push({ line: n, msg: '형식이 어긋난 마커 — 블록은 줄 전체, 인라인은 한 줄 안에서 열고 닫기, 날짜는 8자리' });
    }
  }
  if (open) errors.push({ line: openLine, msg: '블록 마커가 닫히지 않았다' });
  return { ok: errors.length === 0, errors };
}

const _warnedMarkers = new Set();   // 같은 결함을 매 요청마다 찍지 않는다

/**
 * 시행일 마커를 오늘 날짜로 접는다 — 유효한 쪽의 내용만 남기고 마커는 전부 지운다.
 * 예: applyStageMarkers('a <!--시행전 20260918-->옛<!--/시행전--><!--시행 20260918-->새<!--/시행--> b', '20260917') → 'a 옛 b'
 * @param {string} body - 위키 본문(frontmatter 제외)
 * @param {string} [today] - `YYYYMMDD`, 생략하면 todayKST()
 * @param {Set<string>} [blockedDates] - **승인 안 된 시행일**(unapprovedStageDates 결과). 이 날짜의 마커는
 *   시행일이 지났어도 접지 않는다 — 옛 서술을 계속 낸다(2026-09-10 승인 게이트).
 * @returns {string}
 * [연계] ← legal_retriever.readPage(모든 본문 소비처가 이 결과를 본다) · fold_effective.py 가 같은 규칙을 파이썬으로 갖는다.
 *
 * ★마커가 깨져 있으면 **접지 않는다**(2026-09-10 독립 검토 high). 종전에는 닫는 짝을 못 찾은 블록의
 *   아래 줄을 파일 끝까지 버려서, 시행일이 되는 순간 그 페이지의 뒷부분(근거 조문 표 포함)이
 *   답변에서 통째로 사라졌다. 시행 전에는 멀쩡해 보여 사서도 게이트도 못 잡는 결함이었다.
 *   지금은 마커 표기만 걷어내고 내용은 전부 남긴다 — 옛·새가 같이 보이는 편이 본문 소실보다 낫다.
 */
function applyStageMarkers(body, today, blockedDates) {
  const src = String(body || '');
  if (!hasStageMarkers(src)) return src;
  const chk = checkStageMarkers(src);
  if (!chk.ok) {
    const key = chk.errors.map((e) => `${e.line}:${e.msg}`).join('|').slice(0, 200);
    if (!_warnedMarkers.has(key)) {
      _warnedMarkers.add(key);
      console.error('[시행일 마커] 짝·형식이 어긋나 접지 않는다(내용은 그대로 둔다):',
        chk.errors.map((e) => `${e.line}행 ${e.msg}`).join(' / '));
    }
    return stripStageMarkerTags(src);
  }
  const d = today || todayKST();
  const blocked = blockedDates instanceof Set ? blockedDates : (blockedDates ? new Set(blockedDates) : null);
  const inl = src.replace(INLINE_RE, (m, kind, date, inner) => (isActive(kind, date, d, blocked) ? inner : ''));
  const out = [];
  let drop = false;          // 지금 비활성 블록 안인가
  let open = null;           // 열려 있는 블록 종류(닫는 마커 짝 맞추기)
  for (const line of inl.split('\n')) {
    const o = OPEN_LINE_RE.exec(line);
    if (o && !open) { open = o[1]; drop = !isActive(o[1], o[2], d, blocked); continue; }
    const c = CLOSE_LINE_RE.exec(line);
    if (c && open === c[1]) { open = null; drop = false; continue; }
    if (!drop) out.push(line);
  }
  return out.join('\n');
}

module.exports = {
  todayKST, setTodayForTest, stagedRawPath, applyStageMarkers, hasStageMarkers,
  checkStageMarkers, stripStageMarkerTags, loadPendingIndex, PENDING_INDEX_JSON,
  loadApprovedIds, isStageApproved, unapprovedStageDates, approvalStamp, setApprovedForTest,
};
