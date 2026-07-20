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
    const m = line.match(/^\s*-\s*([^:：]{1,24})[:：]\s*(.+)$/);
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

// ── 현 DB 기반 답변(기초): index.json 키워드 검색 → 상위 canonical 개념 스니펫 ──
let _idxCache = null, _idxMtime = 0;
function loadIndex() {
  try {
    const mt = fs.statSync(INDEX_JSON).mtimeMs;   // 재빌드 감지: mtime 바뀌면 캐시 무효화(스테일 방지)
    if (_idxCache && mt === _idxMtime) return _idxCache;
    _idxCache = JSON.parse(fs.readFileSync(INDEX_JSON, 'utf8')); _idxMtime = mt;
  } catch (_) { if (!_idxCache) _idxCache = { pages: [] }; }
  return _idxCache;
}
// POST /api/legal/ask — { query } → 위키 검색 기반 근거 페이지(LLM 합성은 후속 단계)
router.post('/api/legal/ask', (req, res) => {
  try {
    const q = String((req.body && req.body.query) || '').trim();
    if (!q) return res.status(400).json({ ok: false, error: 'query 필요' });
    const idx = loadIndex();
    let pages = idx.pages || [];
    // ── canonical 안전필터(스위치) ──
    //   answerCanonicalOnly=true면 **검증된 canonical 페이지만** 근거로 삼는다(미검증 draft가 사용자 답변에 새는 것 차단).
    //   기본 false라 현행과 동일(전체 검색). 검증(초안승급) 충분히 쌓인 뒤 관리자가 config로 켠다. 취지: MASTER_PLAN E절.
    const canonicalOnly = normConfig(readConfig()).answerCanonicalOnly;
    if (canonicalOnly) pages = pages.filter(p => p.kind !== 'concept' || p.status === 'canonical'); // statute는 통과, concept는 canonical만
    const terms = q.replace(/[^가-힣a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length >= 2);
    const scored = pages.map(p => {
      const hay = ((p.law || '') + ' ' + (p.topic || '') + ' ' + (p.file || '') + ' ' + (p.themes || []).join(' '));
      let s = 0; for (const t of terms) if (hay.includes(t)) s += (p.law && p.law.includes(t)) ? 2 : 1;
      return { p, s };
    }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 5);
    res.json({ ok: true, query: q, canonicalOnly,
      // ⚠ 현 단계는 검색 결과(근거 후보)만 반환. 실제 답변 합성(Gemini)은 후속. canonical 필터는 위 스위치로 제어.
      sources: scored.map(x => ({ file: x.p.file, law: x.p.law, topic: x.p.topic, kind: x.p.kind, status: x.p.status || null, score: x.s })),
      note: canonicalOnly ? '검증(canonical) 근거만 반환' : '현 DB 검색 기반 근거 후보(canonical 필터 OFF·후속 단계)' });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// ── 원본 서빙(읽기전용): 리뷰 카드에서 AI가 본 별표 OCR 이미지·조문 원문을 그대로 보여주기 위함 ──
// raw/ 하위(공개 법령 데이터: law.go.kr 수집분)만, 안전 확장자만, 경로이탈 차단. <img>/<a>로 열리게 무인증.
const RAW_DIR = path.join(LEGAL_DIR, 'raw');
const SRC_MIME = { '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif' };
router.get('/api/legal/src', (req, res) => {
  try {
    const rel = String((req.query && req.query.p) || '').trim();
    if (!rel) return res.status(400).send('p 필요');
    const ext = path.extname(rel).toLowerCase();
    if (!SRC_MIME[ext]) return res.status(415).send('허용 안 된 형식');
    const full = path.resolve(RAW_DIR, rel);
    if (full !== RAW_DIR && !full.startsWith(RAW_DIR + path.sep)) return res.status(403).send('경로 이탈'); // 샌드박스
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return res.status(404).send('없음');
    res.type(SRC_MIME[ext]).sendFile(full);
  } catch (e) { res.status(500).send(String(e.message || e)); }
});

module.exports = router;
