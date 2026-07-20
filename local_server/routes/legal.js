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
 *  - POST /api/legal/ask              → 현 위키 DB 검색 기반 답변(기초)
 *
 * [연계 파일]
 * - knowledge/legal/_dashboard/review_queue.md   → 검증 대기 원장(승인 마킹 대상)
 * - knowledge/legal/wiki/concepts/*.md           → 대상 페이지(status 승격 대상)
 * - knowledge/legal/_dashboard/index.json        → 답변 검색 색인(사전 생성됨)
 * - knowledge/legal/_dashboard/review_approvals.json → 승인·교정 이력(감사 추적)
 * - services/admin_auth.js  → X-Admin-Token 검증(관리자 전용 게이트)
 * - services/atomic_write.js → 원자적 파일쓰기(경합 방지)
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

const LEGAL_DIR = path.join(__dirname, '..', 'knowledge', 'legal');
const REVIEW_QUEUE = path.join(LEGAL_DIR, '_dashboard', 'review_queue.md');
const CONCEPTS_DIR = path.join(LEGAL_DIR, 'wiki', 'concepts');
const INDEX_JSON = path.join(LEGAL_DIR, '_dashboard', 'index.json');
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
    const m = line.match(/^###\s+(REVIEW-(.+?)-(\d+)):\s*(.*)$/);
    if (m) {
      if (cur) entries.push(cur);
      cur = { id: m[1], law: m[2], num: m[3], title: m[4].trim(), targetPages: [], body: '', approved: false, approvedMeta: '' };
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

// GET /api/legal/reviews — 검증 대기 목록(옵션: ?status=pending|approved|all)
router.get('/api/legal/reviews', (req, res) => {
  try {
    const status = req.query.status || 'pending';
    let list = parseReviewQueue();
    if (status === 'pending') list = list.filter(e => !e.approved);
    else if (status === 'approved') list = list.filter(e => e.approved);
    res.json({ ok: true, count: list.length, reviews: list.map(e => ({
      id: e.id, law: e.law, title: e.title, targetPages: e.targetPages, body: e.body.trim(),
      approved: e.approved, approvedMeta: e.approvedMeta,
    })) });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
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
  for (const raw of targetPages) {
    // "wiki/concepts/파일.md" 또는 "파일" 형태 모두 허용
    let base = raw.replace(/^wiki\/concepts\//, '').replace(/\.md$/, '').trim();
    const fp = path.join(CONCEPTS_DIR, base + '.md');
    if (!fs.existsSync(fp)) continue;
    let md = fs.readFileSync(fp, 'utf8');
    // frontmatter status 승격(review-pending/draft → canonical)
    md = md.replace(/^(status:\s*)(review-pending|draft)\s*$/m, '$1canonical');
    // 확정 블록 각인(중복 방지: 같은 reviewId 이미 있으면 스킵)
    const stamp = `\n> ✅ 사람검증 확정(${dateStr}, ${by}) · ${reviewId}` +
      (correctedValue != null && correctedValue !== '' ? ` · 확정값: **${String(correctedValue)}**` : '') + `\n`;
    if (!md.includes(reviewId)) md += stamp;
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
    if (blockRe.test(txt)) txt = txt.replace(blockRe, '$1' + mark);
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

    return { httpStatus: 200, body: { ok: true, id, decision, correctedValue, changedFiles,
      note: decision === 'approve'
        ? '승인 완료 · 대상 페이지 canonical 승격 · 확정값 반영(인덱스 재빌드는 배치)'
        : '반려 처리(재검토 큐 유지)' } };
  }).then(r => res.status(r.httpStatus).json(r.body))
    .catch(e => res.status(500).json({ ok: false, error: String(e.message || e) }));
});

// ── 현 DB 기반 답변(기초): index.json 키워드 검색 → 상위 canonical 개념 스니펫 ──
let _idxCache = null;
function loadIndex() {
  if (_idxCache) return _idxCache;
  try { _idxCache = JSON.parse(fs.readFileSync(INDEX_JSON, 'utf8')); } catch (_) { _idxCache = { pages: [] }; }
  return _idxCache;
}
// POST /api/legal/ask — { query } → 위키 검색 기반 근거 페이지(LLM 합성은 후속 단계)
router.post('/api/legal/ask', (req, res) => {
  try {
    const q = String((req.body && req.body.query) || '').trim();
    if (!q) return res.status(400).json({ ok: false, error: 'query 필요' });
    const idx = loadIndex();
    const pages = idx.pages || [];
    const terms = q.replace(/[^가-힣a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length >= 2);
    const scored = pages.map(p => {
      const hay = ((p.law || '') + ' ' + (p.topic || '') + ' ' + (p.file || '') + ' ' + (p.themes || []).join(' '));
      let s = 0; for (const t of terms) if (hay.includes(t)) s += (p.law && p.law.includes(t)) ? 2 : 1;
      return { p, s };
    }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 5);
    res.json({ ok: true, query: q,
      // ⚠ 현 단계는 검색 결과(근거 후보)만 반환. 실제 답변 합성(Gemini)·canonical 필터는 후속.
      sources: scored.map(x => ({ file: x.p.file, law: x.p.law, topic: x.p.topic, kind: x.p.kind, score: x.s })),
      note: '현 DB 검색 기반 근거 후보(답변 합성 LLM 연결은 후속 단계)' });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

module.exports = router;
