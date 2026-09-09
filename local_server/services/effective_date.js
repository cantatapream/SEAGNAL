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
 *  - 위키: `<!--시행 d-->…<!--/시행-->` 는 today >= d 일 때만, `<!--시행전 d-->…<!--/시행전-->` 는 today < d 일 때만
 *    남기고 마커는 항상 지운다. 블록형(마커가 각각 한 줄)은 그 줄들이 통째로 빠지고, 인라인형(한 줄 안에서
 *    열고 닫음)은 그 자리만 바뀐다. 표 안에서는 인라인형만 쓴다(게이트가 표를 줄 단위로 읽는다). 중첩 없음.
 *
 * [연계]
 * - services/article_text.js       → loadArticle 이 stagedRawPath() 로 읽을 파일을 고른다
 * - services/legal_retriever.js    → readPage 가 applyStageMarkers() 를, loadLawBundle 이 stagedRawPath() 를 쓴다
 * - knowledge/legal/_dashboard/pending_index.json → collect_pending_law.py / fold_effective.py 가 만든다
 * - local_server/scripts/test_pending_law.js      → 이 파일의 회귀 테스트
 * [로드 순서] 번들 없음(서버). legal_retriever.js·article_text.js 가 require 시점에 함께 로드한다.
 *   ⚠이 파일은 legal_retriever 를 require 하지 않는다(순환 방지 — article_text 가 legal_retriever 를 쓴다).
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');

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

/**
 * 그 법 폴더의 파일(`법률.txt` 등)에 대해 **오늘 유효한 대기본 경로**를 돌려준다. 없으면 null(= 현행을 읽는다).
 * 예: stagedRawPath('local_server/knowledge/legal/raw/06_선원노동/어선원및어선재해보상보험법', '법률.txt', '20260911')
 *     → 'local_server/knowledge/legal/raw/06_선원노동/어선원및어선재해보상보험법/_대기/20260911/법률.txt'
 * @param {string} base - raw 법 폴더(저장소 상대경로, rawPathOf 값)
 * @param {string} relFile - 폴더 안 파일 이름(`법률.txt`·`시행령.txt`·`시행규칙.txt`)
 * @param {string} [today] - `YYYYMMDD`, 생략하면 todayKST()
 * @param {object} [index] - 테스트용 지도 주입(생략하면 pending_index.json)
 * @returns {string|null}
 * [연계] ← article_text.loadArticle · legal_retriever.loadLawBundle. → pending_index.json
 */
function stagedRawPath(base, relFile, today, index) {
  const idx = index || loadPendingIndex();
  const list = idx[String(base || '').replace(/\/+$/, '')];
  if (!Array.isArray(list) || !list.length) return null;
  const d = today || todayKST();
  let best = null;
  for (const e of list) {
    if (!e || !e.date || String(e.date) > d) continue;
    if (!Array.isArray(e.files) || e.files.indexOf(relFile) < 0) continue;
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

function isActive(kind, date, today) {
  return kind === '시행' ? today >= date : today < date;
}

/** 본문에 시행일 마커가 하나라도 있나(빠른 판별 — 캐시 키에 오늘을 넣을지 정한다). */
function hasStageMarkers(body) {
  return String(body || '').indexOf(MARK_HEAD) >= 0;
}

/**
 * 시행일 마커를 오늘 날짜로 접는다 — 유효한 쪽의 내용만 남기고 마커는 전부 지운다.
 * 예: applyStageMarkers('a <!--시행전 20260918-->옛<!--/시행전--><!--시행 20260918-->새<!--/시행--> b', '20260917') → 'a 옛 b'
 * @param {string} body - 위키 본문(frontmatter 제외)
 * @param {string} [today] - `YYYYMMDD`, 생략하면 todayKST()
 * @returns {string}
 * [연계] ← legal_retriever.readPage(모든 본문 소비처가 이 결과를 본다) · fold_effective.py 가 같은 규칙을 파이썬으로 갖는다.
 */
function applyStageMarkers(body, today) {
  const src = String(body || '');
  if (!hasStageMarkers(src)) return src;
  const d = today || todayKST();
  const inl = src.replace(INLINE_RE, (m, kind, date, inner) => (isActive(kind, date, d) ? inner : ''));
  const out = [];
  let drop = false;          // 지금 비활성 블록 안인가
  let open = null;           // 열려 있는 블록 종류(닫는 마커 짝 맞추기)
  for (const line of inl.split('\n')) {
    const o = OPEN_LINE_RE.exec(line);
    if (o && !open) { open = o[1]; drop = !isActive(o[1], o[2], d); continue; }
    const c = CLOSE_LINE_RE.exec(line);
    if (c && open === c[1]) { open = null; drop = false; continue; }
    if (!drop) out.push(line);
  }
  return out.join('\n');
}

module.exports = { todayKST, setTodayForTest, stagedRawPath, applyStageMarkers, hasStageMarkers, loadPendingIndex, PENDING_INDEX_JSON };
