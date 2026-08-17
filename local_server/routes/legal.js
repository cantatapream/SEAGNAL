/**
 * ============================================================================
 * 파일명: routes/legal.js
 * 역할: 해양법령 챗봇(나리야) — 관리자 리뷰 검증 API + 현 DB 기반 답변 API
 * ============================================================================
 *
 * [설명]
 * 이 라우터는 관리자(운영자)가 앱 '통합관리자 센터'에서 ⚠REVIEW(사람 검증 대기)
 * 항목을 직접 검토·승인/반려하고, 특히 별표 OCR 판독값을 **직접 수정한 값으로 확정**
 * 하도록 한다. 승인 시 그 값이 서버에 자동 반영된다(위키 페이지 canonical 승격 +
 * review_queue.md 승인 마킹 + 승인 이력 저장).
 *  - GET  /api/legal/reviews          → 검증 대기 목록(review_queue.md 파싱)
 *  - GET  /api/legal/reviews/stats    → 대기/승인 카운트
 *  - POST /api/legal/reviews/:id/approve → 승인(+교정값 확정) 또는 반려 → 서버 반영
 *  - POST /api/legal/reviews/:id/submit-findings → 사람이 "확인 체크리스트"를 보고 적은 확인
 *                                       결과를 Gemini가 재검토(match/mismatch/uncertain) →
 *                                       match면 자동 승인(위 approve와 동일 반영), 아니면 이유를
 *                                       담아 대기 유지 + review_queue.md에 시도 이력 append
 *  - GET  /api/legal/admin/stats      → 관리자 검토센터 서브탭(초안·피드백·새지식후보·개정검토) 실카운트
 *  - GET  /api/legal/drafts           → 초안승인 탭 목록(index.json status=draft)
 *  - POST /api/legal/ask              → 하이브리드 검색 + Gemini 답변 스트리밍 합성(NDJSON, services/legal_retriever.js)
 *                                       조건에 따라 답이 갈리는 질문은 종합답변 대신 되묻기(질문+선택지)를
 *                                       done 이벤트의 clarify 필드로 내려보낸다(legal_retriever.decideClarify)
 *                                       위키에 근거가 없으면 2차로 법령 원문(GitHub 온디맨드)을 훑어 "미검증 참고" 답변 시도
 *                                       6초 넘게 걸린 요청 + 알림 동의 시 답변을 임시 보관하고 개인 푸시 발송
 *  - GET  /api/legal/pending-answer/:requestId → 푸시로 다시 들어온 사용자에게 그 답변을 1회만 돌려줌
 *  - GET  /api/legal/article-text     → 답변카드의 조문 카드를 눌렀을 때 띄울 원문. 인용 표기에 따라
 *                                       조 하나(항·호 분해 + 인용 항 강조) / 범위(제1~9조) / 문서 전체로
 *                                       갈리고, 본문의 별표·서식 참조는 실재 여부(refs)까지 판정해 준다
 *
 * [연계 파일]
 * - knowledge/legal/_dashboard/review_queue.md   → 검증 대기 원장(승인 마킹 대상)
 * - knowledge/legal/wiki/concepts/*.md           → 대상 페이지(status 승격 대상)
 * - knowledge/legal/_dashboard/index.json        → 답변 검색 색인(사전 생성됨)
 * - knowledge/legal/_dashboard/review_approvals.json → 승인·교정 이력(감사 추적)
 * - services/admin_auth.js  → X-Admin-Token 검증(관리자 전용 게이트)
 * - services/atomic_write.js → 원자적 파일쓰기(경합 방지)
 * - services/legal_retriever.js → /api/legal/ask 의 검색·답변합성 본체
 * - services/article_text.js    → /api/legal/article-text 의 조문 원문 발췌 본체
 * - services/pending_answers.js → 답변완료 푸시용 1회용 임시 보관함(3시간)
 * - services/firebase_admin_lazy.js → FCM 발송(첫 사용 시 SDK 로딩)
 *
 * [경합위험] review_queue.md·공유 md는 여러 승인이 동시에 쓰면 손상될 수 있어
 *   승인 쓰기는 반드시 직렬(single-writer)로 처리한다(아래 withLock).
 * ============================================================================
 */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const adminAuth = require('../services/admin_auth');
const { writeFileAtomic } = require('../services/atomic_write');
const legalRetriever = require('../services/legal_retriever');
const articleText = require('../services/article_text');
const pendingAnswers = require('../services/pending_answers');
const gemini = require('../services/gemini_client');
const adminQueues = require('../services/legal_admin_queues');
const amendmentScanner = require('../services/legal_amendment_scanner');
const { DATA_DIR, FILES } = require('../config/server_config');

// [Lazy] Firebase Admin(답변완료 개인 푸시용). routes/report.js 와 같은 이유로 첫 발송 시 로딩.
const { getAdmin } = require('../services/firebase_admin_lazy');

const LEGAL_DIR = path.join(__dirname, '..', 'knowledge', 'legal');
const REVIEW_QUEUE = path.join(LEGAL_DIR, '_dashboard', 'review_queue.md');
const CONCEPTS_DIR = path.join(LEGAL_DIR, 'wiki', 'concepts');
const APPROVALS_LOG = path.join(LEGAL_DIR, '_dashboard', 'review_approvals.json');
const FEEDBACK_FILE = path.join(LEGAL_DIR, '_feedback', 'logs.jsonl');
const CANDIDATES_FILE = path.join(LEGAL_DIR, '_candidates', 'queue.jsonl');

// 관리자 전용: 모든 리뷰 API는 X-Admin-Token 필요(일반 사용자 접근 차단)
router.use('/api/legal/reviews', adminAuth.requireAdminToken);

// ── 직렬 쓰기 락(경합 방지): 승인 쓰기를 하나씩 처리 ──
let _chain = Promise.resolve();
function withLock(fn) {
  const run = _chain.then(fn, fn);
  _chain = run.catch(() => {}); // 다음 작업이 이어지도록 에러 삼킴(결과는 run으로 반환)
  return run;
}

/**
 * review_queue.md를 엔트리 배열로 파싱한다.
 * 각 엔트리는 `### REVIEW-<법>-NN: <제목>` 로 시작하고 다음 헤더 전까지의 블록.
 * @returns {Array<{id,law,num,title,targetPages,body,approved,approvedMeta}>}
 */
function parseReviewQueue() {
  if (!fs.existsSync(REVIEW_QUEUE)) return [];
  const txt = fs.readFileSync(REVIEW_QUEUE, 'utf8');
  const lines = txt.split('\n');
  const entries = [];
  let cur = null;
  for (const line of lines) {
    // 헤더 id는 콜론 앞 전체(끝이 -숫자가 아니어도 인식: 예 'REVIEW-야간운항-3법')
    const m = line.match(/^###\s+(REVIEW-.+?):\s*(.*)$/);
    if (m) {
      if (cur) entries.push(cur);
      const id = m[1];
      const law = id.replace(/^REVIEW-/, '').replace(/-\d+$/, '');
      cur = { id, law, title: m[2].trim(), targetPages: [], body: '', approved: false, approvedMeta: '' };
      continue;
    }
    if (!cur) continue;
    cur.body += line + '\n';
    const tp = line.match(/^-\s*대상\s*페이지:\s*(.+)$/);
    if (tp) cur.targetPages = tp[1].split(/[,·]/).map(s => s.trim()).filter(Boolean);
    const ap = line.match(/^-\s*승인:\s*\[([ xX])\]\s*(.*)$/);
    if (ap) { cur.approved = ap[1].toLowerCase() === 'x'; cur.approvedMeta = (ap[2] || '').trim(); }
  }
  if (cur) entries.push(cur);
  return entries;
}

/**
 * 리뷰 body(장황한 자유서술)를 카드 가독성용 구조 필드 + 클릭가능 URL로 분해한다.
 * `- 근거:` `- 확인 필요:` `- AI 연결 내용:` `- 문제:` `- 필요 조치:` 등 라벨 라인을 키:값으로,
 * 본문 내 http(s) URL을 urls[]로 추출한다(원본 이미지/고시 링크 검증용).
 * `- 확인 체크리스트:`(값 없이 콜론만) 다음에 오는 `  1. ...` 들여쓴 번호줄들은 한 필드로
 * 모아 개행으로 합친다(§6-D 표준 템플릿, 2026-08-06) — 일반 `- key: value` 한 줄 매칭으로는
 * 못 잡는 유일한 다줄 필드라 별도 처리.
 * @returns {{fields:Object, urls:string[]}}
 */
function extractStructured(body) {
  const fields = {}; const urls = [];
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const checklistHead = line.match(/^\s*-\s*확인\s*체크리스트\s*[:：]?\s*$/);
    if (checklistHead) {
      const items = [];
      let j = i + 1;
      while (j < lines.length && /^\s+\d+\.\s+\S/.test(lines[j])) { items.push(lines[j].trim()); j++; }
      if (items.length) { fields['확인 체크리스트'] = items.join('\n'); i = j - 1; continue; }
    }
    const m = line.match(/^\s*-\s*([^:：]{1,120})[:：]\s*(.+)$/);
    if (m) { const k = m[1].trim(); if (k !== '승인' && !fields[k]) fields[k] = m[2].trim(); }
    let um; const re = /(https?:\/\/[^\s)"'<>]+)/g;
    while ((um = re.exec(line)) !== null) urls.push(um[1].replace(/[.,]$/, ''));
    // 로컬 원본 서빙 상대링크(별표 OCR 이미지·조문 원문)도 검증 링크로 노출 — 같은 오리진이라 상대경로가 정답
    let sm; const sre = /(\/api\/legal\/src\?p=[^\s)"'<>]+)/g;
    while ((sm = sre.exec(line)) !== null) urls.push(sm[1].replace(/[.,]$/, ''));
  }
  return { fields, urls: [...new Set(urls)] };
}

// GET /api/legal/reviews — 검증 대기 목록(옵션: ?status=pending|approved|all)
router.get('/api/legal/reviews', (req, res) => {
  try {
    const status = req.query.status || 'pending';
    let list = parseReviewQueue();
    if (status === 'pending') list = list.filter(e => !e.approved);
    else if (status === 'approved') list = list.filter(e => e.approved);
    res.json({ ok: true, count: list.length, reviews: list.map(e => {
      const s = extractStructured(e.body);
      return {
        id: e.id, law: e.law, title: e.title, targetPages: e.targetPages, body: e.body.trim(),
        fields: s.fields,           // {근거, 확인 필요, AI 연결 내용, 문제, 필요 조치, ...} 가독성용
        urls: s.urls,               // 검증용 원문/이미지 링크(클라에서 클릭 가능하게)
        approved: e.approved, approvedMeta: e.approvedMeta,
      };
    }) });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// ── 노출 설정(서버 저장): 챗봇 FAB를 일반/관리자만/비노출 중 무엇으로 할지 ──
//   기본 'off'(비노출). GET은 공개(클라가 FAB 노출여부 판단), POST는 관리자 전용.
//   ★2026-08-14(H-37 적대검증 F1): 저장 위치를 **fly 볼륨 하위**(DATA_DIR = local_server/data)로
//     옮겼다. 종전 경로(knowledge/legal/_dashboard/)는 **컨테이너 이미지 안**이라 관리자가 켠
//     스위치가 재시작·재배포·머신 추가 때마다 이미지의 옛 값으로 되돌아갔다(프로덕션 실측: 켠
//     직후 true, 이후 조회 12/12 false). 볼륨(fly.toml [[mounts]] destination=/app/local_server/data)에
//     두면 재시작해도 값이 남는다. 다른 런타임 상태 파일(maintenance_config.json 등)과 같은 자리다.
const CONFIG_FILE = path.join(DATA_DIR, 'nariya_config.json');
// 구경로(이미지 내부·git 추적). 신경로 파일이 아직 없는 머신에서 **최초 1회만** 값을 옮겨온다 —
// 안 그러면 이번 배포에서 exposure·answerCanonicalOnly 가 기본값으로 리셋된다.
const CONFIG_FILE_LEGACY = path.join(LEGAL_DIR, '_dashboard', 'nariya_config.json');
let configMigrated = false;      // 프로세스당 1회만 시도(볼륨 쓰기 실패해도 조회는 계속돼야 한다)
function readConfig() {
  try { if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (_) {}
  try {
    if (fs.existsSync(CONFIG_FILE_LEGACY)) {
      const legacy = JSON.parse(fs.readFileSync(CONFIG_FILE_LEGACY, 'utf8'));
      if (!configMigrated) {
        configMigrated = true;
        try { writeFileAtomic(CONFIG_FILE, JSON.stringify(legacy, null, 1)); } catch (_) {}
      }
      return legacy;
    }
  } catch (_) {}
  return {};
}
// 정규화: exposure는 off|admin|user(기본 off) · answerCanonicalOnly는 검증완료 후 켜는 스위치(기본 false).
//   answerCanonicalOnly=false → 현행 동작(모든 페이지 검색). true → canonical만 답변 근거로(미검증 draft 차단).
//   ⚠ true로 켜기 전 반드시 index.json을 status 포함 재빌드(lint_index.py)할 것 — 안 그러면 status 미기재로 전부 제외됨.
// H-37 §3.3 R3: 신규 단계 3종은 각각 서버 스위치로 잠근다. **기본 전부 false** — canonical 안전
//   필터와 같은 관례("미리 준비하되 안전장치와 함께"). 켜는 순서 권고: understandConfirm →
//   profileConfirm → scopeNarrow. 되돌리기는 {false} 한 번, 무손실.
function normConfig(c) {
  return {
    exposure: ['off', 'admin', 'user'].includes(c.exposure) ? c.exposure : 'off',
    answerCanonicalOnly: c.answerCanonicalOnly === true,
    understandConfirm: c.understandConfirm === true,
    scopeNarrow: c.scopeNarrow === true,
    profileConfirm: c.profileConfirm === true,
    naverTermLookup: c.naverTermLookup !== false,
  };
}
// POST /api/legal/config 가 받는 boolean 스위치 목록(위 normConfig 와 1:1).
// naverTermLookup(§4-U 모르는 구어 해소)은 2026-08-16 사용자 확정으로 **기본 true**로 전환(다른
// 스위치와 반대 관례) — 관리자가 명시적으로 {naverTermLookup:false}를 보내야만 꺼진다(킬스위치는
// 유지). 이 환경에 NAVER_CLIENT_ID/SECRET이 없으면 스위치가 켜져 있어도 단계가 조용히 물러난다.
const BOOL_SWITCHES = ['answerCanonicalOnly', 'understandConfirm', 'scopeNarrow', 'profileConfirm', 'naverTermLookup'];
router.get('/api/legal/config', (req, res) => {
  res.json(Object.assign({ ok: true }, normConfig(readConfig())));
});
router.post('/api/legal/config', adminAuth.requireAdminToken, (req, res) => {
  const b = req.body || {};
  if (b.exposure !== undefined && !['off', 'admin', 'user'].includes(b.exposure))
    return res.status(400).json({ ok: false, error: 'exposure는 off|admin|user' });
  for (const k of BOOL_SWITCHES) {
    if (b[k] !== undefined && typeof b[k] !== 'boolean')
      return res.status(400).json({ ok: false, error: `${k}는 true|false` });
  }
  withLock(async () => {
    const cur = normConfig(readConfig());                       // 기존 필드 보존(머지) — 한 필드 갱신이 다른 필드 삭제 안 하게
    if (b.exposure !== undefined) cur.exposure = b.exposure;
    for (const k of BOOL_SWITCHES) if (b[k] !== undefined) cur[k] = b[k];
    writeFileAtomic(CONFIG_FILE, JSON.stringify(Object.assign(cur, { updatedAt: new Date().toISOString() }), null, 1));
    return cur;
  }).then(v => res.json(Object.assign({ ok: true }, normConfig(v)))).catch(e => res.status(500).json({ ok: false, error: String(e.message || e) }));
});

// GET /api/legal/reviews/stats — 카운트
router.get('/api/legal/reviews/stats', (req, res) => {
  try {
    const list = parseReviewQueue();
    res.json({ ok: true, total: list.length,
      pending: list.filter(e => !e.approved).length,
      approved: list.filter(e => e.approved).length });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

/**
 * 대상 위키 개념 페이지의 frontmatter status를 canonical로 올리고,
 * 사람이 확정한 교정값을 명시적 블록으로 남긴다(안전: 표 셀 자동치환 대신 확정값 각인).
 * @returns {string[]} 실제로 수정한 파일명 목록
 */
function applyToWikiPages(targetPages, correctedValue, reviewId, by, dateStr) {
  const changed = [];
  let lastLawSlug = '';
  const root = path.resolve(CONCEPTS_DIR) + path.sep;
  const escId = reviewId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const rawTp of targetPages) {
    // 파일 경로만 추출: "wiki/concepts/" 접두 제거 + ".md" 이후 주석("(신규)"·설명) 절단
    let base = String(rawTp).replace(/^wiki\/concepts\//, '').trim();
    base = base.replace(/\.md\b[\s\S]*$/, '').trim();
    if (!base) continue;
    // 멀티페이지 약칭("__개념" — 법 접두사 없음)은 직전 페이지의 법 slug 상속
    if (base.startsWith('__') && lastLawSlug) base = lastLawSlug + base;
    else lastLawSlug = base.split('__')[0];
    const fp = path.join(CONCEPTS_DIR, base + '.md');
    if (!path.resolve(fp).startsWith(root)) continue;        // 경로 봉쇄(../ 상위 탈출 차단)
    if (!fs.existsSync(fp)) continue;
    let md = fs.readFileSync(fp, 'utf8');
    // frontmatter status 승격(review-pending/draft → canonical)
    md = md.replace(/^(status:\s*)(review-pending|draft)\s*$/m, '$1canonical');
    // 확정 각인: 이 reviewId의 기존 확정줄 제거 후 새로 append(재승인 시 값 갱신)
    md = md.replace(new RegExp('^> ✅ 사람검증 확정[^\\n]*' + escId + '[^\\n]*\\n?', 'm'), '');
    md += `\n> ✅ 사람검증 확정(${dateStr}, ${by}) · ${reviewId}` +
      (correctedValue != null && correctedValue !== '' ? ` · 확정값: **${String(correctedValue)}**` : '') + `\n`;
    writeFileAtomic(fp, md);
    changed.push(base + '.md');
  }
  return changed;
}

/**
 * review_queue.md 승인/반려 마킹 + (승인이면) 대상 위키 페이지 반영 + 승인 이력 로그.
 * approve 엔드포인트와 submit-findings(AI 재검토 match 시 자동승인)가 공유한다.
 * **반드시 withLock(...) 콜백 안에서만 호출할 것** — review_queue.md 직렬쓰기 보장.
 * @returns {{httpStatus:number, body:object}}
 */
function finalizeApproval(entry, decision, correctedValue, by) {
  const id = entry.id;
  const now = new Date();
  const dateStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

  // 1) review_queue.md 승인/반려 마킹(원자적)
  let txt = fs.readFileSync(REVIEW_QUEUE, 'utf8');
  const mark = decision === 'reject'
    ? `- 승인: [ ] 반려(${by}, ${dateStr})`
    : `- 승인: [x] 승인(${by}, ${dateStr})` + (correctedValue != null && correctedValue !== '' ? ` · 확정값: ${String(correctedValue)}` : '');
  // 해당 엔트리 블록 내부의 "- 승인:" 라인만 교체
  const escId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blockRe = new RegExp('(###\\s+' + escId + ':[\\s\\S]*?)-\\s*승인:\\s*\\[[ xX]\\][^\\n]*', 'm');
  // 함수 치환: correctedValue/by의 '$' 특수시퀀스($1·$&·$$)가 원장을 손상시키지 않도록
  if (blockRe.test(txt)) txt = txt.replace(blockRe, (mm, p1) => p1 + mark);
  else return { httpStatus: 500, body: { ok: false, error: '승인 라인 없음: ' + id } };
  writeFileAtomic(REVIEW_QUEUE, txt);

  // 2) 승인이면 대상 위키 페이지 canonical 승격 + 확정값 각인
  let changedFiles = [];
  if (decision === 'approve') changedFiles = applyToWikiPages(entry.targetPages, correctedValue, id, by, dateStr);

  // 3) 승인 이력 로그(감사 추적)
  let log = [];
  try { if (fs.existsSync(APPROVALS_LOG)) log = JSON.parse(fs.readFileSync(APPROVALS_LOG, 'utf8')); } catch (_) {}
  log.push({ id, decision, correctedValue, by, at: now.toISOString(), targetPages: entry.targetPages, changedFiles });
  writeFileAtomic(APPROVALS_LOG, JSON.stringify(log, null, 1));

  // 정직한 note: 실제 승격 페이지 수 기준(무음 성공 금지)
  const note = decision === 'reject' ? '반려 처리(재검토 큐 유지)'
    : (changedFiles.length ? `승인 완료 · ${changedFiles.length}개 페이지 canonical 승격·확정값 반영(인덱스 재빌드는 배치)`
      : '⚠ 승인은 기록됐으나 대상 위키 페이지를 찾지 못해 승격 0건 — 리뷰의 "대상 페이지" 표기를 확인하세요');
  return { httpStatus: 200, body: { ok: true, id, decision, correctedValue, changedFiles, promotedCount: changedFiles.length, note } };
}

// POST /api/legal/reviews/:id/approve — 승인(+교정값 확정) 또는 반려 → 서버 반영
// body: { decision: 'approve'|'reject', correctedValue?, by? }
router.post('/api/legal/reviews/:id/approve', (req, res) => {
  const id = req.params.id;
  const { decision = 'approve', correctedValue = null, by = '관리자' } = req.body || {};
  withLock(async () => {
    const list = parseReviewQueue();
    const entry = list.find(e => e.id === id);
    if (!entry) return { httpStatus: 404, body: { ok: false, error: 'review not found: ' + id } };
    return finalizeApproval(entry, decision, correctedValue, by);
  }).then(r => res.status(r.httpStatus).json(r.body))
    .catch(e => res.status(500).json({ ok: false, error: String(e.message || e) }));
});

/**
 * review_queue.md 해당 항목에 "- 확인 시도(N차, ...)" 이력 줄을 "- 승인:" 줄 바로 앞에 append한다
 * (매 시도가 쌓여 다음 재시도 때도 이전 시도 내역이 남는다). **반드시 withLock(...) 안에서 호출할 것.**
 * @param {string} id @param {string} findings @param {'match'|'mismatch'|'uncertain'} verdict
 * @param {string} message @param {string} by
 */
function appendFindingsAttempt(id, findings, verdict, message, by) {
  const now = new Date();
  const dateStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  let txt = fs.readFileSync(REVIEW_QUEUE, 'utf8');
  const escId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blockRe = new RegExp('(###\\s+' + escId + ':[\\s\\S]*?)(-\\s*승인:\\s*\\[[ xX]\\][^\\n]*)', 'm');
  const mm = txt.match(blockRe);
  if (!mm) return;
  const n = (mm[1].match(/^-\s*확인\s*시도\(/gm) || []).length + 1;
  const cleanFindings = String(findings).replace(/\n+/g, ' ').trim();
  const line = `- 확인 시도(${n}차, ${dateStr}, ${by}) AI판정=${verdict}: ${cleanFindings} → AI: ${message}\n`;
  txt = txt.replace(blockRe, (whole, p1, p2) => p1 + line + p2);
  writeFileAtomic(REVIEW_QUEUE, txt);
}

const REVIEW_RECHECK_MODEL = 'gemini-2.5-flash';

// POST /api/legal/reviews/:id/submit-findings — 사람이 "확인 체크리스트"를 보고 직접 확인한
// 내용을 Gemini가 재검토한다: match면 그 자리에서 자동 승인(approve와 동일 반영), mismatch/
// uncertain이면 이유를 담아 대기 유지 + review_queue.md에 이번 시도 이력을 남긴다(다음 시도 때
// 참고할 수 있게). body: { findings: string, by? }
router.post('/api/legal/reviews/:id/submit-findings', (req, res) => {
  const id = req.params.id;
  const { findings = '', by = '관리자' } = req.body || {};
  if (!String(findings).trim()) return res.status(400).json({ ok: false, error: '확인한 내용을 입력하세요.' });
  withLock(async () => {
    const list = parseReviewQueue();
    const entry = list.find(e => e.id === id);
    if (!entry) return { httpStatus: 404, body: { ok: false, error: 'review not found: ' + id } };

    const s = extractStructured(entry.body);
    const context = ['왜 의문인가', 'AI 잠정결론', '근거', 'AI 법리추론 내용', 'AI 연결 내용']
      .map(k => s.fields[k] ? `${k}: ${s.fields[k]}` : '').filter(Boolean).join('\n');

    let verdict = 'uncertain';
    let message = 'AI 재검토 기능을 쓸 수 없습니다(API 키 미설정) — 내용을 확인한 뒤 직접 승인/반려해주세요.';
    if (gemini.hasAnyKey()) {
      const prompt = [
        '너는 한국 해양법률 위키의 검토 보조 AI다. 아래 REVIEW 항목을 사람이 직접 확인하고 그 결과를 적었다.',
        '',
        `REVIEW 제목: ${entry.title}`,
        context,
        '',
        `사람이 적은 확인 내용: "${String(findings).trim()}"`,
        '',
        '이 확인 내용이 위 의문을 실제로 해소하는지 판단하라:',
        '- match: 내용이 논리적으로 일관되고 원래 의문을 명확히 해소한다',
        '- mismatch: 내용에 논리적 모순·근거부족이 있거나 원래 의문을 제대로 해소하지 못한다',
        '- uncertain: 판단하기에 정보가 부족하다(예: 구체 근거 없이 "확인함"만 적음)',
        '',
        'JSON으로만 답하라: {"verdict":"match|mismatch|uncertain","message":"사람에게 보여줄 한두 문장 — match면 확인 요지, 아니면 무엇을 더 확인해야 하는지"}',
      ].join('\n');
      try {
        const result = await gemini.callGemini({
          model: REVIEW_RECHECK_MODEL, contents: prompt,
          config: { temperature: 0.1, thinkingConfig: { thinkingBudget: 0 }, responseMimeType: 'application/json', httpOptions: { timeout: 15000 } },
          caller: 'Legal-ReviewRecheck',
        });
        if (result.success && result.text) {
          const m = result.text.match(/\{[\s\S]*\}/);
          if (m) {
            const parsed = JSON.parse(m[0]);
            if (['match', 'mismatch', 'uncertain'].includes(parsed.verdict)) verdict = parsed.verdict;
            if (typeof parsed.message === 'string' && parsed.message.trim()) message = parsed.message.trim();
          }
        } else {
          message = 'AI 재검토 호출에 실패했습니다 — 내용을 확인한 뒤 직접 승인/반려해주세요.';
        }
      } catch (_) {
        message = 'AI 재검토 중 오류가 발생했습니다 — 내용을 확인한 뒤 직접 승인/반려해주세요.';
      }
    }

    appendFindingsAttempt(id, findings, verdict, message, by);

    if (verdict === 'match') {
      const r = finalizeApproval(entry, 'approve', null, by + '·AI 재검토 자동승인');
      r.body.verdict = verdict; r.body.message = message; r.body.autoApplied = true;
      return r;
    }
    return { httpStatus: 200, body: { ok: true, id, verdict, message, autoApplied: false } };
  }).then(r => res.status(r.httpStatus).json(r.body))
    .catch(e => res.status(500).json({ ok: false, error: String(e.message || e) }));
});

// ── index.json 로드(mtime 캐시) — legal_retriever와 동일 캐시 공유(중복 방지) ──
const loadIndex = legalRetriever.loadIndex;

// GET /api/legal/admin/stats — 관리자 검토센터 서브탭(초안승인·피드백·새지식후보·개정검토) 실카운트.
//   ⚠수치검증은 /api/legal/reviews/stats 를 그대로 재사용(기존 클라 로직 유지).
//   2026-08-06: feedback/candidates/amendments는 이제 파일 개수(옛 countFiles)가 아니라
//   JSONL 안의 "대기(pending)" 항목 수를 센다 — 로그가 파일 1개에 여러 줄로 쌓이므로
//   파일 개수로는 항목 수를 알 수 없다(초안승인의 draft 카운트와 의미를 맞춤).
router.get('/api/legal/admin/stats', adminAuth.requireAdminToken, (req, res) => {
  try {
    const pages = loadIndex().pages || [];
    res.json({ ok: true,
      draft: pages.filter(p => p.kind === 'concept' && p.status === 'draft').length,
      feedback: adminQueues.countPending(FEEDBACK_FILE),
      candidates: adminQueues.countPending(CANDIDATES_FILE),
      amendments: adminQueues.countPending(amendmentScanner.QUEUE_FILE) });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// GET /api/legal/drafts — 초안승인 탭 목록(index.json의 status=draft 개념 페이지, 법·주제·처벌포함여부)
router.get('/api/legal/drafts', adminAuth.requireAdminToken, (req, res) => {
  try {
    const drafts = (loadIndex().pages || [])
      .filter(p => p.kind === 'concept' && p.status === 'draft')
      .map(p => ({ file: p.file, law: p.law, topic: p.topic, penalty: !!p.penalty }))
      .sort((a, b) => (a.law || '').localeCompare(b.law || ''));
    res.json({ ok: true, count: drafts.length, drafts });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// ============================================================================
// 피드백(👍/👎) — 답변 만족도 익명 로그. _feedback/README.md 설계를 따르되, 로그+검토
// 파일을 분리하지 않고 파일 하나에 status 필드로 단순화(services/legal_admin_queues.js).
// ============================================================================

// POST /api/legal/feedback — 공개(로그인 불요, 챗봇 사용자 누구나). 개인정보 없는 익명 로그만.
// body: { question, answerGist, thumb: 'up'|'down', reason? }
router.post('/api/legal/feedback', (req, res) => {
  const { question = '', answerGist = '', thumb, reason = '' } = req.body || {};
  if (thumb !== 'up' && thumb !== 'down') return res.status(400).json({ ok: false, error: "thumb은 'up'|'down'이어야 합니다." });
  const entry = {
    id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    question: String(question).slice(0, 300),
    answerGist: String(answerGist).slice(0, 400),
    thumb, reason: String(reason).slice(0, 300),
    status: 'pending', triage: null,
  };
  adminQueues.appendJsonl(FEEDBACK_FILE, entry);
  res.json({ ok: true });
  // 👎만 AI 재검토(응답은 이미 보냈으니 사용자를 기다리게 하지 않는다 — 실패해도 무해, 트리아지만 비어있게 됨)
  if (thumb === 'down' && gemini.hasAnyKey()) triageFeedback(entry).catch(() => {});
});

/** 👎 피드백 1건을 Gemini로 재검토해 triage 필드를 채운다(비동기, 응답과 무관). @param {object} entry */
async function triageFeedback(entry) {
  const prompt = [
    '너는 한국 해양법령 챗봇(나리야)의 답변 품질 재검토 AI다. 사용자가 아래 답변에 👎(불만족)를 눌렀다.',
    `질문: ${entry.question}`,
    `답변 요지: ${entry.answerGist}`,
    entry.reason ? `사용자가 적은 불만족 사유: ${entry.reason}` : '(사유 미기재)',
    '',
    '이게 정말 위키 보강이 필요한 문제인지, 아니면 사용자 오해·단순 톤 문제인지 판단하라.',
    'JSON으로만 답하라: {"genuineIssue": true|false, "category": "wiki_gap"|"wrong_answer"|"tone"|"misunderstanding"|"other", "note": "한두 문장 설명"}',
  ].join('\n');
  try {
    const result = await gemini.callGemini({
      model: REVIEW_RECHECK_MODEL, contents: prompt,
      config: { temperature: 0.1, thinkingConfig: { thinkingBudget: 0 }, responseMimeType: 'application/json', httpOptions: { timeout: 15000 } },
      caller: 'Legal-FeedbackTriage',
    });
    if (result.success && result.text) {
      const m = result.text.match(/\{[\s\S]*\}/);
      if (m) adminQueues.updateJsonlById(FEEDBACK_FILE, entry.id, { triage: JSON.parse(m[0]) });
    }
  } catch (_) { /* 트리아지 실패는 조용히 — triage:null로 남아 관리자가 직접 판단 */ }
}

// GET /api/legal/feedback?status=pending|reviewed|dismissed|all (관리자)
router.get('/api/legal/feedback', adminAuth.requireAdminToken, (req, res) => {
  try {
    const status = req.query.status || 'pending';
    let list = adminQueues.readJsonl(FEEDBACK_FILE).reverse();
    if (status !== 'all') list = list.filter((e) => (e.status || 'pending') === status);
    res.json({ ok: true, count: list.length, feedback: list });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// POST /api/legal/feedback/:id/decide (관리자) — body: { decision: 'reviewed'|'dismissed', note?, by? }
router.post('/api/legal/feedback/:id/decide', adminAuth.requireAdminToken, (req, res) => {
  try {
    const { decision = 'reviewed', note = '', by = '관리자' } = req.body || {};
    const updated = adminQueues.updateJsonlById(FEEDBACK_FILE, req.params.id, { status: decision, adminNote: note, decidedBy: by, decidedAt: new Date().toISOString() });
    if (!updated) return res.status(404).json({ ok: false, error: 'feedback not found: ' + req.params.id });
    res.json({ ok: true, feedback: updated });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// ============================================================================
// 새 지식 후보 — "위키 밖 질문 2단계 답변"(searchRawFallback, GitHub 원문 온디맨드 조회)이
// 성공한 순간이 정확히 "AI가 새로 알게 된 것"의 발생 지점이다(POST /api/legal/ask 안에서 호출).
// _candidates/README.md 설계와 동일하게 로그+승인 게이트, 단 파일 하나로 단순화.
// ============================================================================

/**
 * searchRawFallback 성공 시 호출 — 위키에 없어 원문을 직접 읽어 답한 사례를 후보로 적재한다.
 * 실패해도(디스크 오류 등) 응답 흐름을 막지 않도록 호출부에서 이미 try로 감싼다.
 * @param {string} query @param {{answer:string, laws:string[], files:string[]}} raw
 */
function logKnowledgeCandidate(query, raw) {
  adminQueues.appendJsonl(CANDIDATES_FILE, {
    id: `cd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    query: String(query).slice(0, 300),
    laws: raw.laws || [],
    files: raw.files || [],
    answerGist: String(raw.answer || '').slice(0, 500),
    status: 'pending',
  });
}

/**
 * [§4-U ④] 사용자가 "네, 맞아요"로 확인해 준 구어→뜻 매핑을 학습 후보로 적재한다.
 * ★`_glossary.md`를 직접 고치지 않는다 — 구어표는 사람 승인 게이트를 거치는 게 이 저장소의
 *   확립된 관례라, 위 logKnowledgeCandidate 와 **같은 큐·같은 승인 흐름**에 얹는다(kind로만 구분).
 * @param {string} query - 그 말이 나온 원 질문 @param {string} term - 구어 @param {string} meaning - 확인된 뜻
 */
function logGlossaryCandidate(query, term, meaning) {
  adminQueues.appendJsonl(CANDIDATES_FILE, {
    id: `cd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    kind: 'glossary',
    query: String(query).slice(0, 300),
    term: String(term).slice(0, 40),
    meaning: String(meaning).slice(0, 100),
    status: 'pending',
  });
}

// GET /api/legal/candidates?status=pending|approved|dismissed|all (관리자)
router.get('/api/legal/candidates', adminAuth.requireAdminToken, (req, res) => {
  try {
    const status = req.query.status || 'pending';
    let list = adminQueues.readJsonl(CANDIDATES_FILE).reverse();
    if (status !== 'all') list = list.filter((e) => (e.status || 'pending') === status);
    res.json({ ok: true, count: list.length, candidates: list });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// POST /api/legal/candidates/:id/decide (관리자) — body: { decision: 'approved'|'dismissed', by? }
// ⚠ approved여도 이 자리에서 위키 draft 페이지를 자동 생성하지 않는다 — 실제 편입은
// _SCHEMA.md §2 ingest 절차(정의확정→조문단위처리→링크→REVIEW플래그)를 따라야 하는
// 저작 작업이라 자동화 대상이 아니다. "승인"은 "위키에 편입 필요"라는 표시일 뿐이다.
router.post('/api/legal/candidates/:id/decide', adminAuth.requireAdminToken, (req, res) => {
  try {
    const { decision = 'approved', by = '관리자' } = req.body || {};
    const updated = adminQueues.updateJsonlById(CANDIDATES_FILE, req.params.id, { status: decision, decidedBy: by, decidedAt: new Date().toISOString() });
    if (!updated) return res.status(404).json({ ok: false, error: 'candidate not found: ' + req.params.id });
    res.json({ ok: true, candidate: updated });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// ============================================================================
// 개정 검토 — services/legal_amendment_scanner.js가 매일 밤(server.js cron) law.go.kr을
// 정기 조회해 공포번호·시행일자가 바뀐 법을 찾아 큐에 적재한다. 여기는 그 큐를 보여주고
// 사람이 승인/반려하는 API만 — 승인해도 재수집·재빌드는 이 자리에서 자동 실행하지 않는다
// (_amendments/README.md 설계: "승인 → 매니페스트 재생성 → 재수집 → 재빌드 → 재감사"는
// 사람이 다음 세션에서 orchestrate하는 별도 단계, 자동 파이프라인 아님 — 환각0 승인게이트).
// ============================================================================

// GET /api/legal/amendments?status=pending|approved|dismissed|all (관리자)
router.get('/api/legal/amendments', adminAuth.requireAdminToken, (req, res) => {
  try {
    const status = req.query.status || 'pending';
    let list = adminQueues.readJsonl(amendmentScanner.QUEUE_FILE).reverse();
    if (status !== 'all') list = list.filter((e) => (e.status || 'pending') === status);
    res.json({ ok: true, count: list.length, amendments: list });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// POST /api/legal/amendments/:id/decide (관리자) — body: { decision: 'approved'|'dismissed', by? }
router.post('/api/legal/amendments/:id/decide', adminAuth.requireAdminToken, (req, res) => {
  try {
    const { decision = 'approved', by = '관리자' } = req.body || {};
    const updated = adminQueues.updateJsonlById(amendmentScanner.QUEUE_FILE, req.params.id, { status: decision, decidedBy: by, decidedAt: new Date().toISOString() });
    if (!updated) return res.status(404).json({ ok: false, error: 'amendment not found: ' + req.params.id });
    res.json({ ok: true, amendment: updated });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// POST /api/legal/amendments/scan-now (관리자) — 정기 cron과 별개로 즉시 1회 스캔(H-29
// detect_law_changes.py, 실측 3~4분 소요) 백그라운드 시작. HTTP 응답을 그만큼 붙들면
// 리버스 프록시·브라우저 타임아웃 위험이라 완료를 기다리지 않고 즉시 응답(started:true) —
// 클라는 잠시 후 새로고침해 결과를 확인한다.
router.post('/api/legal/amendments/scan-now', adminAuth.requireAdminToken, (req, res) => {
  const r = amendmentScanner.startAmendmentScan();
  res.status(r.ok ? 200 : 409).json(r);
});

// ============================================================================
// 답변완료 개인 푸시(옵트인) — 늦게 끝난 답변을 그 사람 기기에만 알린다
// ============================================================================
//
// [프라이버시] 제목·본문·data 어디에도 질문/답변 원문을 싣지 않는다. 고정 문구 +
//   추측 불가능한 requestId 뿐이다(내용은 앱이 requestId로 서버에서 1회만 받아간다).
// [구조 판단] routes/report.js 의 sendReportPush 와 거의 같은 모양이지만,
//   그쪽을 일반화하지 않고 여기에 따로 뒀다 — 잘 돌고 있는 제보 푸시 경로를 건드리지
//   않기 위해서다(파일별 소유 헬퍼는 이 저장소의 기존 관례이기도 하다: admin_push /
//   dmdw_push_sender / report.js 가 각각 자기 발송 함수를 갖는다).

// 알림 문구(고정). 3시간 = services/pending_answers.js 의 TTL 과 같은 값이어야 한다.
const AI_ANSWER_PUSH_BODY = 'AI 답변이 도착했습니다. 3시간 안에 확인하지 않으면 내용이 사라져요';
// 푸시를 눌렀을 때 앱이 열 딥링크(클라: ai_chat.js 가 ?popup=ai_chat&rid= 를 읽어 답변 복원)
const AI_ANSWER_PUSH_URL = 'https://seagnal-server.fly.dev/?popup=ai_chat&rid=';
// 이 시간(6초)을 넘게 걸린 질문만 푸시 대상 — 빨리 끝난 질문마다 알림이 오는 걸 막는다.
const NOTIFY_MIN_ELAPSED_MS = 6000;

// ── "이번 질문"도 알림 받기 — 진행 중인 요청과 뒤늦은 [허용] 클릭을 잇는 대응표 ──────
//   질문을 보낼 때 이미 옵트인 상태가 아니면(그래서 notifyOnComplete=false로 감) 배너가
//   6초 뒤에나 뜬다 — 이 시점엔 이미 요청이 떠난 뒤라 그 바디를 고칠 수 없다. 그래서 요청마다
//   가벼운 askId를 같이 보내 여기 등록해두고, [허용]을 누르면 POST /api/legal/notify-me 가
//   같은 askId로 "이 요청도 푸시 보내주세요"라고 뒤늦게 표시한다. 요청이 끝나면(성공이든 실패든)
//   반드시 이 표를 지운다 — 답변 1건 수명(길어야 1~2분)보다 오래 남지 않는다.
const inFlightAsks = new Map();   // askId → { deviceId, wantsPush }

/**
 * 답변이 준비됐음을 그 기기(deviceId)에만 FCM 으로 알린다.
 * 예: sendAiAnswerPush('dev-abc', 'a3f1…') → 그 기기 트레이에 고정 문구 알림 1건
 * 구독자 목록(data/subscriptions.json)에서 deviceId 가 일치하는 FCM 토큰만 골라 보낸다.
 * Firebase 미초기화·토큰 없음·발송 실패는 로그만 남기고 조용히 지나간다(답변 응답에는 영향 없음).
 * @param {string} deviceId - 앱의 localStorage 'seagnal_device_id'
 * @param {string} requestId - services/pending_answers.js store() 가 발급한 조회키
 * @returns {Promise<void>}
 * [연계] ← POST /api/legal/ask (6초 초과 + notifyOnComplete 인 요청)
 *          → services/firebase_admin_lazy.js getAdmin(), data/subscriptions.json
 *          (routes/report.js sendReportPush 와 동일한 발송 규약)
 */
async function sendAiAnswerPush(deviceId, requestId) {
  const firebaseAdmin = getAdmin();
  if (!firebaseAdmin || firebaseAdmin.apps.length === 0) {
    console.warn('[Legal] Firebase 미초기화, 답변완료 푸시 발송 불가');
    return;
  }
  const SUBS_FILE = FILES.SUBSCRIPTIONS || path.join(DATA_DIR, 'subscriptions.json');
  try {
    if (!fs.existsSync(SUBS_FILE)) return;
    const subs = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
    // ★subscriptions.json 의 options(master·aiAnswer)는 여기서 안 본다(사용자 확정) — 태풍/특보처럼
    // 서버가 알아서 훑어 보내는 방송성 푸시가 아니라, 호출자(POST /api/legal/ask)가 이미 그때그때의
    // 살아있는 동의(옵트인 상태 or 방금 누른 [허용])를 직접 확인한 뒤에만 이 함수를 부른다. 여기서
    // options.aiAnswer 를 또 보면, ns.set()의 서버 동기화가 아직 안 끝난 경합 상황에서 방금 누른
    // 동의가 무시될 수 있다(옛 subscriptions.json 값을 읽게 되므로) — deviceId 일치만으로 충분하다.
    const matched = subs.filter(s => s.deviceId === deviceId && s.type === 'fcm' && s.token);
    for (const sub of matched) {
      try {
        await firebaseAdmin.messaging().send({
          token: sub.token,
          notification: { title: 'SEAGNAL', body: AI_ANSWER_PUSH_BODY },
          data: { type: 'ai_answer_ready', url: AI_ANSWER_PUSH_URL + requestId },
          android: { priority: 'high' },
          apns: { headers: { 'apns-priority': '10' } }
        });
        console.log('📤 [Legal] 답변완료 푸시 발송 성공');
      } catch (e) {
        console.error('[Legal] 답변완료 푸시 FCM 발송 실패:', e.message);
      }
    }
  } catch (e) {
    console.error('[Legal] 답변완료 푸시 발송 중 오류:', e.message);
  }
}

// GET /api/legal/pending-answer/:requestId — 푸시로 다시 들어온 앱이 그 답변을 1회만 받아간다.
//   무인증: requestId 자체가 256비트 무작위라 유추 불가 + 기기 식별자를 서버에 남기지 않기 위함.
//   조회 즉시 서버에서 삭제된다(1회용). 없거나 만료면 200 + {ok:false}
//   (routes/report.js 의 GET /api/reports/pending-answer 가 200 + hasAnswer:false 를 쓰는 관례와 동일).
router.get('/api/legal/pending-answer/:requestId', (req, res) => {
  try {
    const entry = pendingAnswers.retrieve(String(req.params.requestId || ''));
    if (!entry) return res.json({ ok: false });
    res.json({ ok: true, query: entry.query, answer: entry.answer, sources: entry.sources,
      citationChain: entry.citationChain || [], note: entry.note });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// POST /api/legal/notify-me { askId } — 6초 동의배너에서 [허용]을 눌렀을 때, 이미 떠난 그 질문
//   요청에도 뒤늦게 "완료되면 푸시해달라"고 표시한다. 그 요청이 이미 끝났으면(빨리 끝난 경우
//   등) askId가 없어 조용히 무시된다 — 어차피 화면에서 이미 답을 봤을 것이므로 해가 없다.
router.post('/api/legal/notify-me', (req, res) => {
  const askId = String((req.body && req.body.askId) || '').trim();
  const entry = askId && inFlightAsks.get(askId);
  if (entry) entry.wantsPush = true;
  res.json({ ok: true });
});

// ── 근거 조문 발췌(excerpt) ────────────────────────────────────────────────
// 근거 법령 목록의 조문 한 줄이 예전엔 위키 표의 `요지`(사람이 줄여 적은 한 문장)를 보여줬다 —
// 요지는 원문이 아니라 요약이라, 정작 "그 조문에 실제로 뭐라고 적혀 있나"를 알 수 없었다.
// 조문 팝업이 이미 쓰는 article_text.loadArticle() 로 그 조 원문을 읽어, **인용된 항(또는 호)의
// 원문 앞부분**을 목록 미리보기로 함께 싣는다(전문은 예전처럼 카드를 눌러 팝업에서 본다).
// ⚠환각 0: 발췌는 loadArticle 이 준 원문 문자열을 그대로 자른 것이다 — 요약·재작성하지 않는다.
//   유일한 가공은 ⓐ줄바꿈·연속공백을 공백 하나로 합치는 것(목록 한 칸에서 줄이 깨지지 않게)과
//   ⓑ길면 뒤를 잘라 '…'를 붙이는 것뿐이다.
const EXCERPT_MAX = 140;          // 목록 미리보기 최대 글자수(넘으면 뒤를 자르고 '…')
const MAX_EXCERPT_ROWS = 8;       // 한 답변에서 원문을 읽어올 최대 줄 수(=GitHub 파일 읽기 횟수 상한)

/**
 * loadArticle() 응답에서 목록에 실을 짧은 발췌 한 조각을 고른다.
 * 어디를 인용했는지에 따라 고르는 자리가 다르다.
 *  - 호까지 짚은 인용(제10조④3호) → 그 호 원문
 *  - 항까지 짚은 인용(제9조제3항)  → 그 항 원문
 *  - 조만 짚은 인용(제39조, 이 위키에서 가장 흔한 표기) → **첫 항** 원문(조의 첫머리 미리보기)
 * 조 하나를 특정하지 못한 인용(범위 `제1~9조`·전체·별표만 가리킨 행)과 원문 조회 실패(ok:false)는
 * 발췌하지 않는다 — 그런 줄은 예전처럼 위키 요지로 그려진다.
 * ⚠뒤에 더 있는데 이게 전부인 것처럼 보이면 안 된다 — 글자수로 잘렸거나, 고른 자리 뒤에 다른
 *   항·호가 더 있으면 끝에 '…'를 붙여 "이 조문에 더 있다"를 드러낸다(전문은 카드를 눌러 팝업에서).
 * 예: pickExcerpt({ok:true, mode:'single', paragraphs:[{mark:'④', text:'제1항에 따른 술에 취한 상태의 기준은 …', hit:true, items:null}]})
 *     → '④ 제1항에 따른 술에 취한 상태의 기준은 혈중알코올농도 0.03퍼센트 이상으로 한다.'
 * @param {object} out - article_text.loadArticle() 반환값
 * @returns {string} 발췌(못 고르면 빈 문자열)
 * [연계] ← attachChainExcerpts(). → ai_chat.js chainStepHTML 의 발췌 줄(.nrya-chain-ex).
 */
function pickExcerpt(out) {
  if (!out || out.ok !== true || out.mode !== 'single' || !Array.isArray(out.paragraphs) || !out.paragraphs.length) return '';
  const hitIdx = out.paragraphs.findIndex(p => p && p.hit);
  const para = out.paragraphs[hitIdx >= 0 ? hitIdx : 0];
  if (!para) return '';
  const item = (hitIdx >= 0 && Array.isArray(para.items)) ? para.items.find(it => it && it.hit) : null;
  // 항 기호(①…)는 splitParagraphs 가 text 에서 떼어놨다 — 어느 항인지 알 수 있게 다시 앞에 붙인다
  // (호를 짚은 경우엔 제목 줄이 이미 항·호를 말하고 있어 붙이지 않는다).
  const raw = item ? String(item.text || '') : (para.mark ? para.mark + ' ' : '') + String(para.text || '');
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const body = text.length > EXCERPT_MAX ? text.slice(0, EXCERPT_MAX).trim() : text;
  const more = body.length < text.length                                  // 글자수로 잘림
    || (!item && Array.isArray(para.items) && para.items.length > 0)      // 이 항에 호가 더 달려 있음
    || (hitIdx < 0 && out.paragraphs.length > 1);                         // 조 전체 인용인데 첫 항만 보여줌
  return body + (more ? '…' : '');
}

/**
 * 여러 소스(위키 페이지)에 흩어져 있던 인용사슬 줄을 **하나의 목록으로 합친다**.
 * ⚠ 예전엔 소스마다 자기 citationChain을 들고 있었고, 서버(pickChainSource)와 화면(answerHTML의
 *   chainSrc)이 각자 "줄이 가장 많은 소스 하나"만 골라 그렸다 — 그래서 답변이 두 법을 함께 인용해도
 *   **한쪽 법의 근거가 통째로 사라졌다**(라이브 재현: 답변은 「낚시 관리 및 육성법」의 금지·벌칙을 먼저
 *   말하는데, 근거 목록 5줄이 전부 해상교통안전법·선박직원법이고 낚시 관리 및 육성법은 0줄). 답변이
 *   실제로 인용한 줄은 filterCitationChainByAnswer가 이미 검증했으므로, 어느 위키 페이지에서 왔든
 *   전부 보여주는 게 맞다.
 * ⚠ 줄마다 `baseLaw`(그 줄이 실려 있던 위키 페이지의 법)를 붙여둔다 — 합치고 나면 줄만 봐서는 어느
 *   페이지에서 왔는지 알 수 없는데, 조문 원문 조회(article_text.resolveBase)가 ⓐ법령 칸이 `시행령`·
 *   `이 법`처럼 계층 단어뿐인 행 ⓑ고시(tier==='notice') 두 경우에 이 값으로 raw 폴더를 찾기 때문이다.
 *   여기서 잃어버리면 그 두 종류 조문 팝업·발췌가 조용히 실패한다.
 * ★환각 0: 줄을 새로 만들거나 고치지 않는다 — 원 객체 그대로 모으고 baseLaw 한 칸만 채운다.
 * @param {Array} sources - filterCitationChainByAnswer 까지 끝난 finalSources
 * @returns {Array} 모든 소스의 살아남은 줄(각 줄에 baseLaw 포함, 소스 순서대로)
 * [연계] ← POST /api/legal/ask. → groupCitationChainByFlow · attachChainExcerpts · 응답의 citationChain.
 */
function mergeCitationChains(sources) {
  const out = [];
  for (const s of sources || []) {
    for (const row of s.citationChain || []) {
      row.baseLaw = s.law || '';
      out.push(row);
    }
  }
  return out;
}

/**
 * 합쳐진 인용사슬의 각 줄에 `excerpt`(조문 원문 발췌)를 붙인다. 줄마다 원문 파일을 한 번
 * 읽으므로 **답변 문장과 대조해 살아남은 줄에만**(=filterCitationChainByAnswer 이후) 부른다.
 * 한 줄이 실패해도(원문 없음·토큰 없음·범위 인용 등) 나머지는 그대로 간다 — 실패는 발췌 없음일 뿐
 * 예외로 번지지 않는다(allSettled + 개별 try).
 * ⚠ 앞의 MAX_EXCERPT_ROWS 줄까지만 읽는다 — 여러 소스를 합치면서 줄 수가 늘어날 수 있는데, 발췌
 *   한 줄이 GitHub 파일 읽기 한 번이라 상한을 풀면 답변 대기시간이 그만큼 늘어난다. 상한을 넘은
 *   줄은 화면에서 사라지지 않고 예전처럼 위키 요지로 그려진다.
 * ★조회에 쓰는 표기는 위키 칸(row.article)이 아니라 **답변이 실제로 쓴 표기**(row.citedArticle,
 *   항·호 포함)를 우선한다(2026-08-17, B10). 위키 칸엔 항·호가 없는 경우가 많아 pickExcerpt 가
 *   hit 를 못 찾고 **첫 항**을 그냥 썼는데, 그 결과 답변은 제58조제5항제7호(어선원 준수의무 위반
 *   과태료)를 말하는데 미리보기엔 무관한 ①항(중대재해 보고)이 떴다(라이브 실측).
 * ⚠ 그 표기로 원문을 못 열면(article_text 가 못 읽는 모양이면) **위키 칸으로 한 번 더** 시도한다 —
 *   더 정확히 하려다 예전에 나오던 발췌까지 잃으면 안 된다.
 * @param {Array} rows - mergeCitationChains → groupCitationChainByFlow 를 지난 줄들
 * @returns {Promise<void>} 각 행에 excerpt 를 직접 채운다(반환값 없음)
 * [연계] ← POST /api/legal/ask. → services/article_text.js loadArticle().
 *          ← citedArticle 은 legal_retriever.js filterCitationChainByAnswer 가 채운다(계약1).
 */
async function attachChainExcerpts(rows) {
  const targets = (rows || []).slice(0, MAX_EXCERPT_ROWS);
  await Promise.allSettled(targets.map(async (row) => {
    // 항·호까지 짚은 표기일 때만 우선한다(같은 조를 가리키는데 더 좁힌 것이라 안전하다).
    const cited = String(row.citedArticle || '');
    const first = /[항호]/.test(cited) ? cited : String(row.article || '');
    try {
      const load = a => articleText.loadArticle({
        law: row.law, article: a, tier: row.tier, baseLaw: row.baseLaw || '',
      });
      let out = await load(first);
      if ((!out || out.ok !== true) && first !== row.article) out = await load(row.article);
      const ex = pickExcerpt(out);
      if (ex) row.excerpt = ex;
    } catch (e) {
      console.error('[Legal] 조문 발췌 실패:', row.law, row.article, e && e.message);
    }
  }));
}

// POST /api/legal/ask — { query } → 하이브리드 검색(legal_retriever) + Gemini 답변 스트리밍 합성
//   응답은 NDJSON(줄바꿈으로 구분된 JSON) 스트림: 답변 조각마다 {type:'delta',text}, 마지막에
//   {type:'done', ok, query, canonicalOnly, answer(전체 텍스트), sources, citationChain, note} 한 줄로 마감.
//   citationChain = 답변이 실제로 인용한 근거 조문 줄을 **모든 소스에서 합쳐 하나로** 정렬한 목록
//   (줄 모양: {law, article, effectiveDate, gist, step, tier, contact, baseLaw, excerpt?}).
//   되묻기가 필요한 질문이면 delta 없이 done 한 줄만 나가고 clarify:{question,options} 가 함께 실린다.
//   ⚠ 실제 생성시간은 그대로다(모델 사고+글자수는 안 줄어듦) — 목적은 체감 대기시간 단축뿐.
//   추가 바디(선택): deviceId(기기 식별자) · notifyOnComplete(답변완료 푸시 동의, 기본 false)
//   → 둘 다 있고 6초를 넘게 걸렸으면, 스트림은 그대로 두고 답변을 임시 보관 + 개인 푸시 발송.
//   lastQuestion(선택, H-37 최소 절충안): 클라이언트가 매 요청에 싣는 직전 질문 원문 — ctx와
//   무관해 새 질문 타이핑에도 안 비워진다. decideClarify가 이미 애매해 되물을 때만 "방금 그거예요?"
//   확인 후보 하나를 더 보여주는 데만 쓴다(답을 대신 짓지 않는다).
router.post('/api/legal/ask', async (req, res) => {
  const startedAt = Date.now();   // 6초 판정 기준(핸들러 시작~완료 실제 소요시간)
  const q = String((req.body && req.body.query) || '').trim();
  if (!q) return res.status(400).json({ ok: false, error: 'query 필요' });
  const deviceId = String((req.body && req.body.deviceId) || '').trim();
  const notifyOnComplete = (req.body && req.body.notifyOnComplete) === true;
  const askId = String((req.body && req.body.askId) || '').trim();
  // [H-37 최소 절충안, 2026-08-15] 클라이언트가 매 요청에 실어 보내는 "직전 질문 원문" —
  //   ctx와 무관한 별도 채널이다(§9.1 #1 "새로 타이핑한 질문은 맥락을 비운다"는 그대로 두고,
  //   decideClarify가 이미 애매해서 되물을 때만 "방금 그거예요?" 확인 후보 하나를 더 보여준다).
  const lastQuestion = String((req.body && req.body.lastQuestion) || '').trim().slice(0, 200);
  // 이 요청이 끝난 뒤 [허용]으로 뒤늦게 동의할 수 있게 등록해둔다(POST /api/legal/notify-me 참고).
  if (askId && deviceId) inFlightAsks.set(askId, { deviceId, wantsPush: false });

  const cfg = normConfig(readConfig());
  const canonicalOnly = cfg.answerCanonicalOnly;
  // [H-37] 대기 맥락(ctx)·온디바이스 프로필(profile) — **둘 다 선택**이고, 없으면 아래 전 경로가
  //   no-op 이라 응답이 오늘과 바이트 동일하다(설계 §3.3 R0).
  //   ⚠ `q`(질의 문자열)에는 이 값들을 **절대 합치지 않는다**(R2) — 합치면 ①되묻기 라운드 카운트
  //     ②트리 주제 판정 ③트리 경로 복원이 동시에 오염되고(설계 §2.1), 프로필이 로그·임시보관 파일에
  //     남아 "온디바이스에만 저장"이 그 자리에서 깨진다(R1).
  const profile = legalRetriever.normalizeProfile(req.body && req.body.profile);
  const ctx = legalRetriever.normalizeAskCtx(req.body && req.body.ctx, profile);
  // [H-37 §3.2 · 2026-08-14 적대검증 F2] 지금까지 확정된 맥락을 **모든 done 응답에 함께** 실어
  //   보낸다. 클라이언트는 이걸 들고 있다가 다음 요청에 붙인다 — 맥락을 버튼의 data-ctx 에만
  //   실었더니 **ctx 없는 버튼**(기존 되묻기·트리 되묻기)을 누르는 순간 직전 맥락이 사라져
  //   프로필 확인이 무한루프가 됐다(라이브 재현). 비어 있으면 null 이라 필드 자체를 안 싣는다(R0).
  //   ★[§4-U] 값을 **호출 시점에 다시 계산한다** — §4-U 단계가 `ctx.nu`(확인된 뜻을 다 쓴 뒤의
  //     상태)를 갱신하는데, 미리 굳혀 두면 그 갱신이 응답에 안 실린다. ctxNextOf 는 순수 함수라
  //     ctx 를 안 건드리는 기존 경로에서는 결과가 문자 그대로 같다(R0).
  const withCtxNext = (done) => {
    const cn = legalRetriever.ctxNextOf(ctx);
    if (cn) done.ctxNext = cn;
    return done;
  };
  // 신규 단계가 확인 카드를 낼 때 쓰는 done 한 줄(기존 되묻기 응답과 **같은 모양** — clarify 스키마
  // 그대로라 ai_chat.js clarifyHTML 이 그대로 그린다. confirmKind 만 새로 붙는다).
  // ★[§4-U] 헤더는 아직 안 나갔을 때만 세운다 — §4-U 는 스트림 헤더가 이미 나간 뒤(2차 조회 실패
  //   지점)에서도 이 함수를 쓴다. 기존 호출부는 전부 헤더 전이라 동작이 그대로다(R0).
  const writeConfirm = (step) => {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      if (res.flushHeaders) res.flushHeaders();
    }
    res.write(JSON.stringify(withCtxNext({ type: 'done', ok: true, query: q, canonicalOnly,
      answer: step.answer || null, sources: [], citationChain: [], note: step.note || '',
      clarify: step.clarify, confirmKind: step.confirmKind })) + '\n');
    res.end();
    if (askId) inFlightAsks.delete(askId);
  };
  try {
    // ① [H-37 §4] 이해확인 — 질문이 들어오면 **가장 먼저**(사용자 확정 (가)). 스위치 off면 null.
    //    3회 연속 "이해 못함"이면 확인을 아예 안 내고 assumed 로 통과 — 그때는 최종 답변 첫 줄에
    //    서버가 고정 고지문을 직접 붙인다(§4.4, withAssumedNotice).
    const uc = await legalRetriever.understandConfirmStep(q, ctx.uc, cfg.understandConfirm);
    if (uc && uc.clarify) return writeConfirm(uc);
    const assumed = !!(uc && uc.assumed);

    // [H-36 배선 파일럿] 해역·항해구역 트리 게이트 — 결정 트리의 **맨 앞**에 이것 하나만 끼운다.
    //   "우리 배 어디까지 나갈 수 있나요?"처럼 **구역 자체가 질문**인 경우에만 발화하고(실측:
    //   실제 사용자형 질문 43,956건 중 6건), 그 밖에는 null이라 아래 기존 흐름이 그대로 돈다.
    //   되묻기 응답 모양은 아래 clarify 분기와 똑같다(sources·citationChain을 비우는 이유도 같다 —
    //   아직 어느 조문이 답인지 정해지지 않았는데 근거 아코디언을 그리면 확정된 근거처럼 보인다).
    //   설계·근거: knowledge/legal/_dashboard/H36_live_wiring_design.md
    //   [H-37 §7.5] 프로필로 이미 확정한 구역 라벨이 있으면 **이 함수에 넘기는 질의에 한해** 합성한다
    //   (트리는 질의 문자열이 곧 계약이라 다른 운반로가 없다). 요청 바디의 `q`는 그대로다.
    const zone = legalRetriever.zoneTreeStep(legalRetriever.zoneQueryWithProfile(q, ctx));
    if (zone) {
      // [H-37 §7.5] 트리 되묻기에도 프로필 확인을 건다(사용자 확정 (차) "처음부터 같이 넣고 테스트").
      //   두 경로의 clarify 반환 스키마가 같아 **같은 후처리 함수 하나**로 된다.
      if (zone.clarify) {
        const pc = legalRetriever.profileConfirmStep({ needed: true, options: zone.clarify.options },
          profile, ctx.prof, cfg.profileConfirm);
        if (pc.mode === 'confirm') return writeConfirm(pc.step);
      }
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      if (res.flushHeaders) res.flushHeaders();
      const done = { type: 'done', ok: true, query: q, canonicalOnly,
        answer: legalRetriever.withAssumedNotice(zone.answer, assumed),
        sources: [], citationChain: [], note: zone.note };
      if (zone.clarify) done.clarify = zone.clarify;
      res.write(JSON.stringify(withCtxNext(done)) + '\n');
      res.end();
      if (askId) inFlightAsks.delete(askId);
      return;
    }

    // [H-37 §5.5·§7.4] 검색어에만 상황질문·프로필로 확정된 조건을 덧붙인다 — `q` 자체는 안 건드린다.
    //   되묻기 판단(decideClarify)·답변 합성에는 **원 질문 q**를 그대로 넘긴다: 상황 정보는 검색
    //   후보를 고르는 데만 쓰고, 답변은 사용자가 실제로 쓴 문장에 답한다(안 그러면 답변 문장과
    //   filterSourcesByAnswer 의 교차확인 기준이 흔들린다).
    //   ⚠ 붙일 게 없으면 qForSearch === q 라 R0(회귀 0)가 성립한다.
    const narrowLabels = ctx.scope.map(s => s.label)
      .concat(legalRetriever.profileAcceptedLabels(ctx).map(d => d.label));
    // [§4-U] 사용자가 "네, 맞아요"로 확인해 준 구어의 뜻도 **검색어에만** 덧붙인다(같은 규약).
    //   ★한 번만 쓰고 버린다(아래에서 ctx.nu 를 소진 상태로 갱신) — 확인된 뜻이 뒤따르는 다른
    //     질문까지 따라다니면 엉뚱한 검색어가 되고, 같은 말을 계속 되묻는 고리도 생긴다.
    const nuTerm = cfg.naverTermLookup ? (ctx.nu.term || '') : '';
    const nuMeaning = cfg.naverTermLookup ? (ctx.nu.meaning || '') : '';
    if (nuMeaning) {
      // 소진 표시: rounds 를 상한으로 올려 둔다 — 이 뜻으로도 못 찾으면 아래 §4-U 는 같은 말을
      // 또 묻지 않고 곧장 ③정직한 포기로 간다(§4-6 ③).
      // ★NAVER_MAX_ROUNDS(재질문 횟수 상한)가 아니라 NAVER_ROUNDS_SPENT(소진값)를 쓴다(적대검증
      //   D2) — 전자는 "아직 한 번 더 찾아볼 수 있다"는 뜻이라 소진 표시 구실을 못 한다.
      ctx.nu = { rounds: legalRetriever.NAVER_ROUNDS_SPENT, state: 'none', term: '', meaning: '' };
      // ④ 학습 후보 적재(관리자 승인 시 _glossary.md 로 정식 편입). 실패해도 응답 흐름과 무관.
      try { logGlossaryCandidate(q, nuTerm, nuMeaning); } catch (_) { /* 로그 실패는 무시 */ }
    }
    const qForSearch = (narrowLabels.length || nuMeaning)
      ? [q].concat(narrowLabels, nuMeaning ? [nuMeaning] : []).join(' ') : q;
    // [H-37 §17] 사용자가 "네, 맞아요"로 확인한 재진술은 **검색 확장어로만** 넘긴다(질의 문자열에
    //   합치지 않는다 — 합치면 §2.1의 세 오염이 그대로 살아난다). 스위치가 off면 넘기지 않는다:
    //   대기 중 운영자가 스위치를 내리면 그 단계가 없는 것처럼 동작해야 한다(설계 §9.1 #10).
    const ucRestate = cfg.understandConfirm ? (ctx.uc.restate || '') : '';
    const { sources, contextPages } = await legalRetriever.search(qForSearch,
      ucRestate ? { canonicalOnly, restate: ucRestate } : { canonicalOnly });

    // ② [H-37 §5] 상황질문(범위좁히기) — 검색 결과가 여러 선박종류 계열에 걸칠 때만, **법 이름이
    //    아니라 상황**("어떤 배에 관한 것인가요?")을 자산 라벨 그대로 묻는다. 스위치 off면 null.
    //    ★zoneTreeStep 이 null 일 때만 시도한다(위에서 이미 return 됐다) — 순서를 지켜야 H-36
    //      파일럿이 검증한 트리 경로가 오늘과 100% 같다(설계 §3.4).
    const scope = legalRetriever.scopeNarrowStep(q, ctx.scope, sources, cfg.scopeNarrow);
    if (scope) return writeConfirm(scope);
    // gapNotices = 그 위키 페이지가 "우리가 원문을 가질 수 없다"고 정직하게 적어둔 공백 안내
    // (시·군·구 개별고시 등) — 화면이 ⚠칩으로 "원문 미수집 — 별도 확인 필요"를 알린다.
    // ⚠ 인용사슬(citationChain)은 여기 소스마다 싣지 않는다 — 모든 소스의 줄을 합쳐 응답 최상위
    //   `citationChain` 한 곳으로 내보낸다(mergeCitationChains 주석 참고). 소스별로 나눠 실으면
    //   화면이 그중 하나만 골라 그려 다른 법의 근거가 통째로 사라진다.
    const toSourceOut = s => ({ file: s.file, law: s.law, topic: s.topic, kind: s.kind, status: s.status, score: s.score, hop: s.hop, gapNotices: s.gapNotices || [] });

    // [되묻기] 조건에 따라 답이 완전히 갈리는 질문인지 먼저 빠르게 판단한다(무거운 종합답변 전).
    // 판단이 실패하거나 애매하면 조용히 {needed:false} → 아래 기존 흐름 그대로.
    // [H-37 §17] 확인된 재진술을 함께 넘긴다 — 지시어가 풀린 문장을 읽어야 "사용자가 이미 확인해
    //   준 조건"을 다시 묻지 않는다(5차 프로덕션 재검증에서 "네" 뒤에 off 와 똑같은 되묻기가 뜬 원인).
    // (2026-08-15) D-트리(scopeNarrowStep)가 확정한 조건도 함께 넘긴다 — 안 넘기면 decideClarify가
    //   그 확정을 전혀 모른 채 같은 축(예: 선박종류)을 중복으로 되묻는다(라이브 재현, narrowLabels는
    //   위에서 이미 계산해 둔 것을 그대로 재사용 — R0: ctx.scope·profile이 없으면 빈 배열이라 무변화).
    // [B7] 사용자가 되묻기에서 "잘 모르겠어요"를 눌렀으면(ctx.unk), 새로 판단하지 말고 **같은 되묻기를
    //   그대로 다시** 내되 그 앞에 용어 풀이 + 갈래 한 줄 요약을 붙인다. 질의 문자열은 바뀌지 않아
    //   위 search() 결과가 직전 라운드와 같은 근거다(그 근거로만 풀이한다 — 환각 0).
    //   ctx.unk 가 없으면 null 이라 아래 기존 흐름이 그대로 돈다(R0).
    const unk = await legalRetriever.explainClarifyStep(contextPages, ctx.unk);
    if (unk) {
      // 다음 라운드가 "같은 되묻기를 또 물었는지" 판정할 수 있게 ctx.cl 을 갱신해 함께 내려보낸다(B6).
      ctx.cl = { q: unk.clarify.question, labels: unk.clarify.options.map(o => o.label) };
      return writeConfirm(unk);
    }

    // [B6] 직전 라운드의 되묻기(ctx.cl)를 함께 넘긴다 — 모델이 표현만 바꿔 같은 걸 다시 물으면
    //   (라벨 완전일치 대조로는 안 잡힌다) 결정론적으로 버린다. ctx.cl 이 없으면 오늘과 동일(R0).
    const clarify = await legalRetriever.decideClarify(q, contextPages, ucRestate, narrowLabels, lastQuestion, ctx.cl);

    // ③ [H-37 §7.4] 프로필 확인 — 이 되묻기가 묻는 축을 프로필이 이미 알고 있으면 되묻는 대신
    //    "저장된 정보로 답할까요?"를 **그 축에 대해서만** 확인한다(축 단위, 사용자 확정 (자)).
    //    'drop'은 이미 "네"로 확정한 축을 또 묻는 경우 — 그 되묻기를 버리고 답변으로 넘어간다(§9.1 #21).
    const pc = legalRetriever.profileConfirmStep(clarify, profile, ctx.prof, cfg.profileConfirm);
    if (pc.mode === 'confirm') return writeConfirm(pc.step);
    const askClarify = clarify.needed && pc.mode !== 'drop';

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    if (res.flushHeaders) res.flushHeaders();

    // 되물을 게 있으면 종합답변(synthesizeAnswerStream)을 아예 만들지 않는다 — 모든 경우를
    // 나열한 긴 답변 대신 짧은 안내 한 줄 + 선택지만 보낸다(화면이 버튼으로 그린다).
    // ⚠근거 법령 목록은 여기서 **아예 보내지 않는다**(sources: []). 되묻기 단계는 아직 어느 법·어느
    //   조문이 답인지 정해지지 않은 상태라(사용자가 선택지를 고르면 그때 답이 갈린다), 답변 문장이
    //   없어 filterSourcesByAnswer·filterCitationChainByAnswer(문장 기반 교차확인) 둘 다 쓸 수 없다.
    //   그런데도 검색 후보를 실어 보내면 화면이 "📖 근거 법령 N건" 아코디언을 그려, 확정되지 않은
    //   내부 계산 결과가 확정된 근거처럼 보인다(라이브 실측으로 확인된 문제). 근거는 사용자가 되묻기에
    //   답한 뒤 나오는 실제 답변에서만 보여준다.
    if (askClarify) {
      // [B6] 이번 라운드의 질문·선택지 라벨을 ctx 에 실어 보낸다(클라이언트가 다음 요청에 되돌려 준다).
      //   다음 라운드의 decideClarify 가 "표현만 바꾼 같은 되묻기"인지 판정하는 유일한 근거다 —
      //   서버는 대화 이력을 저장하지 않으므로 새 저장소를 만들지 않고 기존 ctx 채널을 재사용한다.
      ctx.cl = { q: clarify.question, labels: clarify.options.map(o => o.label) };
      res.write(JSON.stringify(withCtxNext({ type: 'done', ok: true, query: q, canonicalOnly,
        answer: clarify.intro || null,
        sources: [],
        citationChain: [],
        note: '추가 정보가 필요해요',
        clarify: { question: clarify.question, options: clarify.options } })) + '\n');
      res.end();
      if (askId) inFlightAsks.delete(askId);
      return;
    }

    let full = '';
    let synth = '';        // 모델이 실제로 만든 부분만(아래 usedGemini 판정 기준 — 종전과 동일)
    let streamError = null;
    // [H-37 §4.4] 3회 백스톱으로 "추정 답변"이 된 경우: 첫 chunk보다 **먼저** 고지문 한 줄을 쓰고
    //   full 에도 같은 문자열을 선행 포함시킨다 — 화면(delta 누적)과 done.answer 가 어긋나지 않게.
    //   ⚠프롬프트로 시키지 않는다(모델이 지시를 어긴 전례) — 서버가 문자열로 붙인다.
    //   ⚠고지문은 `synth` 에 넣지 않는다 — 넣으면 스트림이 실패해도 "답변이 나왔다"고 오판한다.
    if (assumed && contextPages.length) {
      full = legalRetriever.ASSUMED_NOTICE + '\n\n';
      res.write(JSON.stringify({ type: 'delta', text: full }) + '\n');
      if (res.flush) res.flush();
    }
    // 근거 후보가 아예 없으면 합성해봐야 빈 답이라 스트림을 부르지 않는다(기존 최적화 유지).
    if (contextPages.length) {
      try {
        for await (const chunk of legalRetriever.synthesizeAnswerStream(q, contextPages)) {
          full += chunk; synth += chunk;
          res.write(JSON.stringify({ type: 'delta', text: chunk }) + '\n');
          if (res.flush) res.flush(); // compression() 버퍼를 즉시 내보내 실제로 조각조각 도착하게 함
        }
      } catch (e) { streamError = e; }
    }

    const usedGemini = synth.trim().length > 0;
    // L-57 조치③: 답변이 실제로 나온 경우에만 sourcesOut을 답변 인용 여부로 교차확인해 좁힌다
    // (스트림 실패로 답변이 없으면 교차확인할 대상이 없어 후보를 그대로 반환).
    const finalSources = !contextPages.length ? []
      : (usedGemini ? legalRetriever.filterSourcesByAnswer(sources, full) : sources);
    // citationChain도 소스와 같은 방식으로 답변 문장과 대조해 무관한 줄을 뺀다(legal_retriever.js
    // filterCitationChainByAnswer 참고 — 소스가 통과해도 그 안 표 9줄이 통째로 딸려나오던 문제).
    let citationChain = [];
    if (usedGemini) {
      // ⓐ 소스마다 답변 문장과 대조해 무관한 줄을 뺀 뒤, ⓑ 살아남은 줄을 **소스 구분 없이 하나로**
      // 합치고(mergeCitationChains), ⓒ 그 합친 목록을 한 번에 "답변이 먼저 말한 법 → 그 법의
      // 법률→시행령→시행규칙→고시" 순으로 재배열한다(groupCitationChainByFlow).
      // ⚠ 반드시 거른 **뒤에** 합치고 정렬한다(원표 순서가 아니라 답변이 실제로 인용한 줄만 대상).
      // ⚠ 정렬을 소스마다 따로 하면 안 된다 — 두 법이 서로 다른 위키 페이지에서 왔을 때 법 묶음
      //   순서를 페이지 경계 너머로 맞출 수 없다(그래서 합친 뒤 딱 한 번 부른다).
      // ⚠ 세 번째 인자 baseLaw(=그 줄이 실려 있던 위키 페이지의 법)를 넘긴다 — 법령 칸이 `시행규칙`
      //   처럼 계층 낱말만 적힌 행을 답변과 대조하려면 어느 법의 시행규칙인지 알아야 한다(B3).
      //   mergeCitationChains 가 붙이는 row.baseLaw 는 이 시점엔 아직 없다(거른 뒤에 붙인다).
      finalSources.forEach(s => {
        s.citationChain = legalRetriever.filterCitationChainByAnswer(s.citationChain, full, s.law || '');
      });
      citationChain = legalRetriever.groupCitationChainByFlow(mergeCitationChains(finalSources), full);
      // 살아남은 줄에만 조문 원문 발췌를 붙인다(거르기 전에 붙이면 버려질 줄까지 원문을 읽는다).
      await attachChainExcerpts(citationChain);
    }

    // 위키(검증된 카드)에 쓸 근거가 결국 안 남으면 여기서 끝내지 않고, 좁혀진 법의 raw 원문을
    // GitHub에서 그때그때 읽어 "미검증 참고" 등급으로 한 번 더 답을 시도한다(MASTER_PLAN F절).
    // ★판단 시점은 "검색 직후 후보 유무"가 아니라 "1차 답변까지 만들어본 뒤 남은 근거 유무"다 —
    //   검색이 관대해 후보 0건은 사실상 없고, L-57 필터가 다 걸러 최종 0건이 되는 게 실제 대부분이라
    //   검색 직후만 보면 2차가 영영 발동하지 않는다(실키 라이브 6건 전부 미발동으로 확인).
    // 2차 조회는 AI 호출이 3번 겹쳐(법선택→파일선택→합성) 조각 스트리밍이 어려워, 완성된 답변을
    // done 한 줄로 보낸다(클라 answerHTML은 done의 answer로 최종 렌더하므로 delta 없이도 그려진다).
    // GITHUB_RAW_TOKEN·키가 없거나 원문에서도 못 찾으면 answer:null → 아래 else로 기존 동작 유지.
    const needsFallback = !usedGemini || !finalSources.length;
    // [§4-U] 확인된 뜻이 있으면 원문 직독도 그 뜻을 얹어 시도한다 — 이 경로가 빈손이 되는 실제
    //   원인의 대부분이 pickCandidateLaws 의 빈 배열(=AI가 낱말 자체를 못 알아들어 읽을 법을 못
    //   고름)이라, 뜻 한 조각만 붙어도 후보 법이 잡힌다.
    //   ★뜻은 **두 번째 인자**로 넘긴다(2026-08-16 적대검증 D1 수정). 예전처럼 `q + ' ' + 뜻` 을
    //     한 덩어리로 넘기면 그 문장이 2차 답변 합성 프롬프트의 "질문:" 자리에 그대로 실려,
    //     "답변 합성에는 사용자가 실제로 친 문장만 넘긴다"는 이 파일의 규약(위 §5.5·§7.4 주석,
    //     narrowLabels·ucRestate 도 전부 그렇게 한다)이 깨진다. 보조어는 검색에만 쓴다.
    const raw = needsFallback ? await legalRetriever.searchRawFallback(q, nuMeaning) : null;

    // [§4-U 모르는 구어 해소] 위키(1차)도 원문 직독(2차)도 빈손인 바로 이 지점 — 지금까지 "이
    //   질문에 맞는 근거를 위키에서 찾지 못했습니다"로 끝나던 자리 — 에서만 개입한다.
    //   ★발동 조건을 `raw`와 **똑같이** 잡은 이유(2026-08-16 로컬 실측으로 정정): 처음엔 "화면에
    //     글자가 이미 흘러갔으면(full) 카드로 갈아끼우지 말자"고 막아 뒀는데, 정작 대표 사례인
    //     "깔때기가 뭐죠"가 그 갈래로 떨어진다 — 위키 검색이 관대해 약한 후보 4건이 잡히고(실측),
    //     그래서 합성은 돌지만 L-57 교차확인이 근거를 전부 걸러 needsFallback 이 된다. 그 조건을
    //     달면 §4-U 가 정작 필요한 자리에서 영영 안 뜬다. 여기까지 온 답변은 **어느 위키 근거도
    //     인용하지 않은 답변**이라(그래서 finalSources 가 0건이다) 카드로 바꿔도 잃는 게 없고,
    //     바로 위 2차 조회도 이미 같은 자리에서 1차 답변을 통째로 갈아끼우고 있다(established).
    //   스위치 off·키 없음·모르는 낱말 없음이면 null 이라 아래 기존 흐름이 그대로 돈다(R0).
    if (needsFallback && !(raw && raw.answer)) {
      const nu = await legalRetriever.naverTermStep(q, ctx.nu, cfg.naverTermLookup);
      if (nu && nu.clarify) return writeConfirm(nu);
      if (nu && nu.giveup) {
        res.write(JSON.stringify(withCtxNext({ type: 'done', ok: true, query: q, canonicalOnly,
          answer: nu.answer, sources: [], citationChain: [],
          note: '이 질문에 맞는 근거를 위키에서 찾지 못했습니다.' })) + '\n');
        res.end();
        if (askId) inFlightAsks.delete(askId);
        return;
      }
    }

    let answer, sourcesOut, note;
    if (raw && raw.answer) {
      answer = legalRetriever.withAssumedNotice(raw.answer, assumed);   // [H-37 §4.4] 2차 조회 경로에도 붙인다
      sourcesOut = [];
      // 2차(원문 직독) 답변은 위키 근거 조문 표를 쓰지 않았다 — 1차에서 만들다 만 인용사슬을 그대로
      // 딸려 보내면 이 답변의 근거인 척 붙는다(환각 0). sources와 같이 비운다.
      citationChain = [];
      // ★2026-08-14(H-37 §8, 사용자 확정 (사)): 신뢰등급 꼬리표를 없앤다("⚠미검증 참고 — …").
      //   화면 하단에는 항상 "참고용입니다. 최종 확인은 공식 출처를 확인하세요."가 붙는다.
      //   ⚠오류·결과 상태를 알리는 note(아래 else 가지의 두 문장)는 등급이 아니라 **지금 무슨 일이
      //     일어났는지의 고지**라 그대로 둔다.
      note = '';
      // 위키에 없어 원문을 직접 읽어 답한 순간 = "새 지식 후보" 발생 지점. 실패해도 응답 흐름과 무관.
      try { logKnowledgeCandidate(q, raw); } catch (_) { /* 로그 실패는 무시 */ }
    } else {
      // 2차가 실패하면 1차 결과를 그대로 돌려준다 — 특히 1차가 정직하게 만든 "확인되지 않습니다"
      // 답변(근거 0건이라도)은 버리지 않는다.
      answer = usedGemini ? full.trim() : null;
      sourcesOut = finalSources.map(toSourceOut);
      // ★2026-08-14(H-37 §8): 등급 꼬리표 2종('검증(canonical) 근거만 반영'·'위키 근거 기반 AI
      //   답변')을 없앴다 — 답변이 정상적으로 나온 경우의 note 는 빈 문자열이다.
      note = usedGemini
        ? ''
        : (contextPages.length
          ? `답변 생성 실패(${(streamError && streamError.message) || '응답 없음'}) — 근거 후보만 반환`
          : '이 질문에 맞는 근거를 위키에서 찾지 못했습니다.');
    }
    res.write(JSON.stringify(withCtxNext({ type: 'done', ok: true, query: q, canonicalOnly,
      answer, sources: sourcesOut, citationChain, note })) + '\n');
    res.end();

    // [답변완료 푸시] 스트림은 위에서 이미 평소대로 끝냈다 — 여기부터는 부가 동작이라
    //   기존 응답 흐름에 아무 영향이 없다(실패해도 사용자는 화면에서 답을 이미 봤다).
    //   6초 이하로 빨리 끝난 질문은 보내지 않는다(옵트인해도 매번 울리지 않게).
    //   자체 try 로 감싼다 — 여기서 던지면 바깥 catch 가 이미 끝난 응답에 또 쓰려다 죽는다.
    try {
      const askedMidway = askId && inFlightAsks.has(askId) && inFlightAsks.get(askId).wantsPush;
      if (answer && (notifyOnComplete || askedMidway) && deviceId && (Date.now() - startedAt) > NOTIFY_MIN_ELAPSED_MS) {
        const requestId = pendingAnswers.store(q, answer, sourcesOut, note, citationChain);
        sendAiAnswerPush(deviceId, requestId).catch(e => console.error('[Legal] 답변완료 푸시 실패:', e && e.message));
      }
    } catch (e) { console.error('[Legal] 답변완료 푸시 준비 실패:', e && e.message); }
    if (askId) inFlightAsks.delete(askId);
  } catch (e) {
    if (askId) inFlightAsks.delete(askId);
    if (res.headersSent) {
      res.write(JSON.stringify({ type: 'done', ok: false, error: String(e.message || e) }) + '\n');
      return res.end();
    }
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ── 원본 서빙(읽기전용): 리뷰 카드에서 AI가 본 별표 OCR 이미지·조문 원문을 그대로 보여주기 위함 ──
// raw/ 하위(공개 법령 데이터: law.go.kr 수집분)만, 안전 확장자만, 경로이탈 차단. <img>/<a>로 열리게 무인증.
const RAW_DIR = path.join(LEGAL_DIR, 'raw');
const SRC_MIME = { '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  // 해양안전 출입통제구역 팝업의 "고시 원문 보기" 버튼용 — 각 해양경찰서 홈페이지에서
  // 직접 수집한 원본 고시 PDF/HWP(_원본첨부/ 폴더)를 그대로 서빙.
  '.pdf': 'application/pdf', '.hwp': 'application/x-hwp', '.hwpx': 'application/x-hwpx' };
router.get('/api/legal/src', (req, res) => {
  try {
    const rel = String((req.query && req.query.p) || '').trim();
    if (!rel) return res.status(400).send('p 필요');
    const ext = path.extname(rel).toLowerCase();
    if (!SRC_MIME[ext]) return res.status(415).send('허용 안 된 형식');
    const full = path.resolve(RAW_DIR, rel);
    if (full !== RAW_DIR && !full.startsWith(RAW_DIR + path.sep)) return res.status(403).send('경로 이탈'); // 샌드박스
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return res.status(404).send('없음');
    // PDF/HWP/HWPX는 브라우저가 인라인으로 못 띄우는 경우가 많아(특히 HWP는 뷰어 자체가 없음)
    // 흰 화면만 뜨는 문제가 있었음 — 다운로드로 강제해 새 화면 전환 없이 파일로 받게 한다.
    // (txt/md/png/jpg/gif는 리뷰 카드 <img>/원문 표시용이라 그대로 인라인 유지)
    if (ext === '.pdf' || ext === '.hwp' || ext === '.hwpx') {
      const filename = path.basename(full);
      res.setHeader('Content-Disposition',
        'attachment; filename="download' + ext + '"; filename*=UTF-8\'\'' + encodeURIComponent(filename));
    }
    res.type(SRC_MIME[ext]).sendFile(full);
  } catch (e) { res.status(500).send(String(e.message || e)); }
});

// ── 조문 원문 팝업(읽기전용): 답변카드의 조문 카드를 누르면 그 조 전체 원문을 항·호로 쪼개 준다 ──
// 원문은 서버에 상주시키지 않고 GitHub에서 그때그때 읽는다(services/article_text.js).
// 못 찾으면 지어내지 않고 {ok:false, reason} — 클라이언트는 "원문을 불러오지 못했어요"로 안내한다.
router.get('/api/legal/article-text', async (req, res) => {
  try {
    const q = req.query || {};
    const out = await articleText.loadArticle({
      law: q.law, article: q.article, tier: q.tier, baseLaw: q.baseLaw,
    });
    res.json(out);
  } catch (e) {
    console.error('[Legal] 조문 원문 조회 실패:', e && e.message);
    res.json({ ok: false, reason: 'error' });
  }
});

module.exports = router;
