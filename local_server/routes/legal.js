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
const { DATA_DIR, FILES } = require('../config/server_config');

// [Lazy] Firebase Admin(답변완료 개인 푸시용). routes/report.js 와 같은 이유로 첫 발송 시 로딩.
const { getAdmin } = require('../services/firebase_admin_lazy');

const LEGAL_DIR = path.join(__dirname, '..', 'knowledge', 'legal');
const REVIEW_QUEUE = path.join(LEGAL_DIR, '_dashboard', 'review_queue.md');
const CONCEPTS_DIR = path.join(LEGAL_DIR, 'wiki', 'concepts');
const APPROVALS_LOG = path.join(LEGAL_DIR, '_dashboard', 'review_approvals.json');

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
 * @returns {{fields:Object, urls:string[]}}
 */
function extractStructured(body) {
  const fields = {}; const urls = [];
  for (const line of body.split('\n')) {
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
const CONFIG_FILE = path.join(LEGAL_DIR, '_dashboard', 'nariya_config.json');
function readConfig() {
  try { if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (_) {}
  return {};
}
// 정규화: exposure는 off|admin|user(기본 off) · answerCanonicalOnly는 검증완료 후 켜는 스위치(기본 false).
//   answerCanonicalOnly=false → 현행 동작(모든 페이지 검색). true → canonical만 답변 근거로(미검증 draft 차단).
//   ⚠ true로 켜기 전 반드시 index.json을 status 포함 재빌드(lint_index.py)할 것 — 안 그러면 status 미기재로 전부 제외됨.
function normConfig(c) {
  return {
    exposure: ['off', 'admin', 'user'].includes(c.exposure) ? c.exposure : 'off',
    answerCanonicalOnly: c.answerCanonicalOnly === true,
  };
}
router.get('/api/legal/config', (req, res) => {
  res.json(Object.assign({ ok: true }, normConfig(readConfig())));
});
router.post('/api/legal/config', adminAuth.requireAdminToken, (req, res) => {
  const b = req.body || {};
  if (b.exposure !== undefined && !['off', 'admin', 'user'].includes(b.exposure))
    return res.status(400).json({ ok: false, error: 'exposure는 off|admin|user' });
  if (b.answerCanonicalOnly !== undefined && typeof b.answerCanonicalOnly !== 'boolean')
    return res.status(400).json({ ok: false, error: 'answerCanonicalOnly는 true|false' });
  withLock(async () => {
    const cur = normConfig(readConfig());                       // 기존 필드 보존(머지) — 한 필드 갱신이 다른 필드 삭제 안 하게
    if (b.exposure !== undefined) cur.exposure = b.exposure;
    if (b.answerCanonicalOnly !== undefined) cur.answerCanonicalOnly = b.answerCanonicalOnly;
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

// POST /api/legal/reviews/:id/approve — 승인(+교정값 확정) 또는 반려 → 서버 반영
// body: { decision: 'approve'|'reject', correctedValue?, by? }
router.post('/api/legal/reviews/:id/approve', (req, res) => {
  const id = req.params.id;
  const { decision = 'approve', correctedValue = null, by = '관리자' } = req.body || {};
  withLock(async () => {
    const list = parseReviewQueue();
    const entry = list.find(e => e.id === id);
    if (!entry) return { httpStatus: 404, body: { ok: false, error: 'review not found: ' + id } };
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
  }).then(r => res.status(r.httpStatus).json(r.body))
    .catch(e => res.status(500).json({ ok: false, error: String(e.message || e) }));
});

// ── index.json 로드(mtime 캐시) — legal_retriever와 동일 캐시 공유(중복 방지) ──
const loadIndex = legalRetriever.loadIndex;

// GET /api/legal/admin/stats — 관리자 검토센터 서브탭(초안승인·피드백·새지식후보·개정검토) 실카운트.
//   ⚠수치검증은 /api/legal/reviews/stats 를 그대로 재사용(기존 클라 로직 유지).
router.get('/api/legal/admin/stats', adminAuth.requireAdminToken, (req, res) => {
  try {
    const pages = loadIndex().pages || [];
    const countFiles = (dir) => { try { return fs.readdirSync(dir).filter(f => f !== 'README.md').length; } catch (_) { return 0; } };
    res.json({ ok: true,
      draft: pages.filter(p => p.kind === 'concept' && p.status === 'draft').length,
      feedback: countFiles(path.join(LEGAL_DIR, '_feedback')),
      candidates: countFiles(path.join(LEGAL_DIR, '_candidates')),
      amendments: countFiles(path.join(LEGAL_DIR, '_amendments')) });
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
    res.json({ ok: true, query: entry.query, answer: entry.answer, sources: entry.sources, note: entry.note });
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

// POST /api/legal/ask — { query } → 하이브리드 검색(legal_retriever) + Gemini 답변 스트리밍 합성
//   응답은 NDJSON(줄바꿈으로 구분된 JSON) 스트림: 답변 조각마다 {type:'delta',text}, 마지막에
//   {type:'done', ok, query, canonicalOnly, answer(전체 텍스트), sources, note} 한 줄로 마감.
//   되묻기가 필요한 질문이면 delta 없이 done 한 줄만 나가고 clarify:{question,options} 가 함께 실린다.
//   ⚠ 실제 생성시간은 그대로다(모델 사고+글자수는 안 줄어듦) — 목적은 체감 대기시간 단축뿐.
//   추가 바디(선택): deviceId(기기 식별자) · notifyOnComplete(답변완료 푸시 동의, 기본 false)
//   → 둘 다 있고 6초를 넘게 걸렸으면, 스트림은 그대로 두고 답변을 임시 보관 + 개인 푸시 발송.
router.post('/api/legal/ask', async (req, res) => {
  const startedAt = Date.now();   // 6초 판정 기준(핸들러 시작~완료 실제 소요시간)
  const q = String((req.body && req.body.query) || '').trim();
  if (!q) return res.status(400).json({ ok: false, error: 'query 필요' });
  const deviceId = String((req.body && req.body.deviceId) || '').trim();
  const notifyOnComplete = (req.body && req.body.notifyOnComplete) === true;
  const askId = String((req.body && req.body.askId) || '').trim();
  // 이 요청이 끝난 뒤 [허용]으로 뒤늦게 동의할 수 있게 등록해둔다(POST /api/legal/notify-me 참고).
  if (askId && deviceId) inFlightAsks.set(askId, { deviceId, wantsPush: false });

  const canonicalOnly = normConfig(readConfig()).answerCanonicalOnly;
  try {
    const { sources, contextPages } = await legalRetriever.search(q, { canonicalOnly });
    // gapNotices = 그 위키 페이지가 "우리가 원문을 가질 수 없다"고 정직하게 적어둔 공백 안내
    // (시·군·구 개별고시 등) — 화면이 ⚠칩으로 "원문 미수집 — 별도 확인 필요"를 알린다.
    const toSourceOut = s => ({ file: s.file, law: s.law, topic: s.topic, kind: s.kind, status: s.status, score: s.score, hop: s.hop, citationChain: s.citationChain || [], gapNotices: s.gapNotices || [] });

    // [되묻기] 조건에 따라 답이 완전히 갈리는 질문인지 먼저 빠르게 판단한다(무거운 종합답변 전).
    // 판단이 실패하거나 애매하면 조용히 {needed:false} → 아래 기존 흐름 그대로.
    const clarify = await legalRetriever.decideClarify(q, contextPages);

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    if (res.flushHeaders) res.flushHeaders();

    // 되물을 게 있으면 종합답변(synthesizeAnswerStream)을 아예 만들지 않는다 — 모든 경우를
    // 나열한 긴 답변 대신 짧은 안내 한 줄 + 선택지만 보낸다(화면이 버튼으로 그린다). 근거 법령
    // 목록도 함께 실어 사용자가 먼저 참고할 수 있게 두되, 답변 문장이 없어 filterSourcesByAnswer도
    // filterCitationChainByAnswer도(문장 기반 교차확인) 쓸 수 없다 — 그래서 citationChain은 통째로
    // 걸러지지 않은 원문 표라 여기선 아예 싣지 않는다(법령명·주제 카드만). 되묻기 판단이 실제로
    // 읽은 상위 CLARIFY_TOPK 건까지만 보낸다 — 최대 15건을 통째로 실어 화면이 무거워지는 것도 막는다.
    if (clarify.needed) {
      res.write(JSON.stringify({ type: 'done', ok: true, query: q, canonicalOnly,
        answer: clarify.intro || null,
        sources: sources.slice(0, legalRetriever.CLARIFY_TOPK).map(s => Object.assign(toSourceOut(s), { citationChain: [] })),
        note: '추가 정보가 필요해요',
        clarify: { question: clarify.question, options: clarify.options } }) + '\n');
      res.end();
      if (askId) inFlightAsks.delete(askId);
      return;
    }

    let full = '';
    let streamError = null;
    // 근거 후보가 아예 없으면 합성해봐야 빈 답이라 스트림을 부르지 않는다(기존 최적화 유지).
    if (contextPages.length) {
      try {
        for await (const chunk of legalRetriever.synthesizeAnswerStream(q, contextPages)) {
          full += chunk;
          res.write(JSON.stringify({ type: 'delta', text: chunk }) + '\n');
          if (res.flush) res.flush(); // compression() 버퍼를 즉시 내보내 실제로 조각조각 도착하게 함
        }
      } catch (e) { streamError = e; }
    }

    const usedGemini = full.trim().length > 0;
    // L-57 조치③: 답변이 실제로 나온 경우에만 sourcesOut을 답변 인용 여부로 교차확인해 좁힌다
    // (스트림 실패로 답변이 없으면 교차확인할 대상이 없어 후보를 그대로 반환).
    const finalSources = !contextPages.length ? []
      : (usedGemini ? legalRetriever.filterSourcesByAnswer(sources, full) : sources);
    // citationChain도 소스와 같은 방식으로 답변 문장과 대조해 무관한 줄을 뺀다(legal_retriever.js
    // filterCitationChainByAnswer 참고 — 소스가 통과해도 그 안 표 9줄이 통째로 딸려나오던 문제).
    if (usedGemini) {
      finalSources.forEach(s => { s.citationChain = legalRetriever.filterCitationChainByAnswer(s.citationChain, full); });
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
    const raw = needsFallback ? await legalRetriever.searchRawFallback(q) : null;

    let answer, sourcesOut, note;
    if (raw && raw.answer) {
      answer = raw.answer;
      sourcesOut = [];
      note = `⚠미검증 참고 — 위키 카드가 없어 법령 원문(${raw.laws.join('·') || '원문'})을 직접 읽은 답변`;
    } else {
      // 2차가 실패하면 1차 결과를 그대로 돌려준다 — 특히 1차가 정직하게 만든 "확인되지 않습니다"
      // 답변(근거 0건이라도)은 버리지 않는다.
      answer = usedGemini ? full.trim() : null;
      sourcesOut = finalSources.map(toSourceOut);
      note = usedGemini
        ? (canonicalOnly ? '검증(canonical) 근거만 반영' : '위키 근거 기반 AI 답변')
        : (contextPages.length
          ? `답변 생성 실패(${(streamError && streamError.message) || '응답 없음'}) — 근거 후보만 반환`
          : '이 질문에 맞는 근거를 위키에서 찾지 못했습니다.');
    }
    res.write(JSON.stringify({ type: 'done', ok: true, query: q, canonicalOnly,
      answer, sources: sourcesOut, note }) + '\n');
    res.end();

    // [답변완료 푸시] 스트림은 위에서 이미 평소대로 끝냈다 — 여기부터는 부가 동작이라
    //   기존 응답 흐름에 아무 영향이 없다(실패해도 사용자는 화면에서 답을 이미 봤다).
    //   6초 이하로 빨리 끝난 질문은 보내지 않는다(옵트인해도 매번 울리지 않게).
    //   자체 try 로 감싼다 — 여기서 던지면 바깥 catch 가 이미 끝난 응답에 또 쓰려다 죽는다.
    try {
      const askedMidway = askId && inFlightAsks.has(askId) && inFlightAsks.get(askId).wantsPush;
      if (answer && (notifyOnComplete || askedMidway) && deviceId && (Date.now() - startedAt) > NOTIFY_MIN_ELAPSED_MS) {
        const requestId = pendingAnswers.store(q, answer, sourcesOut, note);
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
