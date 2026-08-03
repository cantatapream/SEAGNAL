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
 *                                       위키에 근거가 없으면 2차로 법령 원문(GitHub 온디맨드)을 훑어 "미검증 참고" 답변 시도
 *
 * [연계 파일]
 * - knowledge/legal/_dashboard/review_queue.md   → 검증 대기 원장(승인 마킹 대상)
 * - knowledge/legal/wiki/concepts/*.md           → 대상 페이지(status 승격 대상)
 * - knowledge/legal/_dashboard/index.json        → 답변 검색 색인(사전 생성됨)
 * - knowledge/legal/_dashboard/review_approvals.json → 승인·교정 이력(감사 추적)
 * - services/admin_auth.js  → X-Admin-Token 검증(관리자 전용 게이트)
 * - services/atomic_write.js → 원자적 파일쓰기(경합 방지)
 * - services/legal_retriever.js → /api/legal/ask 의 검색·답변합성 본체
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
// POST /api/legal/ask — { query } → 하이브리드 검색(legal_retriever) + Gemini 답변 스트리밍 합성
//   응답은 NDJSON(줄바꿈으로 구분된 JSON) 스트림: 답변 조각마다 {type:'delta',text}, 마지막에
//   {type:'done', ok, query, canonicalOnly, answer(전체 텍스트), sources, note} 한 줄로 마감.
//   ⚠ 실제 생성시간은 그대로다(모델 사고+글자수는 안 줄어듦) — 목적은 체감 대기시간 단축뿐.
router.post('/api/legal/ask', async (req, res) => {
  const q = String((req.body && req.body.query) || '').trim();
  if (!q) return res.status(400).json({ ok: false, error: 'query 필요' });

  const canonicalOnly = normConfig(readConfig()).answerCanonicalOnly;
  try {
    const { sources, contextPages } = await legalRetriever.search(q, { canonicalOnly });
    const toSourceOut = s => ({ file: s.file, law: s.law, topic: s.topic, kind: s.kind, status: s.status, score: s.score, hop: s.hop, citationChain: s.citationChain || [] });

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    if (res.flushHeaders) res.flushHeaders();

    // 위키(검증된 카드)에 근거가 없으면 여기서 끝내지 않고, 좁혀진 법의 raw 원문을 GitHub에서
    // 그때그때 읽어 "미검증 참고" 등급으로 한 번 더 답을 시도한다(MASTER_PLAN F절 2단계 답변체계).
    // 2차 조회는 AI 호출이 3번 겹쳐(법선택→파일선택→합성) 조각 스트리밍이 어려워, 완성된 답변을
    // done 한 줄로 보낸다(클라 answerHTML은 done의 answer로 최종 렌더하므로 delta 없이도 그려진다).
    // GITHUB_RAW_TOKEN·키가 없거나 원문에서도 못 찾으면 answer:null → 기존 문구로 그대로 끝난다.
    if (!contextPages.length) {
      const raw = await legalRetriever.searchRawFallback(q);
      res.write(JSON.stringify({ type: 'done', ok: true, query: q, canonicalOnly,
        answer: raw.answer, sources: [],
        note: raw.answer
          ? `⚠미검증 참고 — 위키 카드가 없어 법령 원문(${raw.laws.join('·') || '원문'})을 직접 읽은 답변`
          : '이 질문에 맞는 근거를 위키에서 찾지 못했습니다.' }) + '\n');
      return res.end();
    }

    let full = '';
    let streamError = null;
    try {
      for await (const chunk of legalRetriever.synthesizeAnswerStream(q, contextPages)) {
        full += chunk;
        res.write(JSON.stringify({ type: 'delta', text: chunk }) + '\n');
        if (res.flush) res.flush(); // compression() 버퍼를 즉시 내보내 실제로 조각조각 도착하게 함
      }
    } catch (e) { streamError = e; }

    const usedGemini = full.trim().length > 0;
    // L-57 조치③: 답변이 실제로 나온 경우에만 sourcesOut을 답변 인용 여부로 교차확인해 좁힌다
    // (스트림 실패로 답변이 없으면 교차확인할 대상이 없어 후보를 그대로 반환).
    const finalSources = usedGemini ? legalRetriever.filterSourcesByAnswer(sources, full) : sources;
    const sourcesOut = finalSources.map(toSourceOut);
    const note = usedGemini
      ? (canonicalOnly ? '검증(canonical) 근거만 반영' : '위키 근거 기반 AI 답변')
      : `답변 생성 실패(${(streamError && streamError.message) || '응답 없음'}) — 근거 후보만 반환`;
    res.write(JSON.stringify({ type: 'done', ok: true, query: q, canonicalOnly,
      answer: usedGemini ? full.trim() : null, sources: sourcesOut, note }) + '\n');
    res.end();
  } catch (e) {
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
