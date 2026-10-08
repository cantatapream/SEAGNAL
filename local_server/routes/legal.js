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
 *  - GET  /api/legal/rooms/stats      → 지식 방 갈래 버튼 6개 숫자 + 인트로 칩(개념 status·그래프 엣지)
 *  - GET  /api/legal/rooms/list       → 지식 방 6개 목록(room=raw|concept|statute|comparison|annex|graph,
 *                                       한 쪽 10개 페이지네이션)
 *  - GET  /api/legal/rooms/law        → 원문 방 아코디언 한 칸(계층별 **실제 시행일**·별표·고시)
 *  - POST /api/legal/ask              → 하이브리드 검색 + Gemini 답변 스트리밍 합성(NDJSON, services/legal_retriever.js)
 *                                       조건에 따라 답이 갈리는 질문은 종합답변 대신 되묻기(질문+선택지)를
 *                                       done 이벤트의 clarify 필드로 내려보낸다(legal_retriever.decideClarify)
 *                                       위키에 근거가 없으면 2차로 법령 원문(GitHub 온디맨드)을 훑어 "미검증 참고" 답변 시도
 *                                       6초 넘게 걸린 요청 + 알림 동의 시 답변을 임시 보관하고 개인 푸시 발송
 *                                       관리자 센터 answerModel(기본 Luna)·codexForUsers(기본 꺼짐)에 따라 AI 호출을
 *                                       VM 의 Codex 로(services/codex_bridge.js). 시험용 llm:"codex"|"gemini" 도 받는다
 *  - POST /api/legal/codex/poll|result → VM Codex 작업자 창구(X-Codex-Secret, NRYA_CODEX_SECRET 없으면 404)
 *  - GET  /api/legal/pending-answer/:requestId → 푸시로 다시 들어온 사용자에게 그 답변을 1회만 돌려줌
 *  - GET  /api/legal/article-text     → 답변카드의 조문 카드를 눌렀을 때 띄울 원문. 인용 표기에 따라
 *                                       조 하나(항·호 분해 + 인용 항 강조) / 범위(제1~9조) / 문서 전체로
 *                                       갈리고, 본문의 별표·서식 참조는 실재 여부(refs)까지 판정해 준다
 *  - GET  /api/legal/aliases          → 법령 약칭 → 정식 명칭 대응표(모호하지 않은 것만). 화면이 답변
 *                                       본문의 조문에 링크를 걸 때 법을 특정하는 데 쓴다
 *
 * [연계 파일]
 * - knowledge/legal/_dashboard/review_queue.md   → 검증 대기 원장(승인 마킹 대상)
 * - knowledge/legal/wiki/concepts/*.md           → 대상 페이지(status 승격 대상)
 * - knowledge/legal/_dashboard/index.json        → 답변 검색 색인(사전 생성됨) + 지식 방 목록 4종
 * - knowledge/legal/wiki/graph.json              → 지식 방 '지식그래프' 노드·엣지
 * - knowledge/legal/raw/01~14 도메인/<법>/       → 지식 방 '원문' 목록·아코디언(.txt 머리말의 실제 시행일)
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
const effectiveDate = require('../services/effective_date');   // 지식 방 '원문'이 챗봇과 같은 판(예고본 포함)을 보여주게
const pendingAnswers = require('../services/pending_answers');
const gemini = require('../services/gemini_client');
const codexBridge = require('../services/codex_bridge');   // 관리자 전용 Codex 개발자 모드(삼중 잠금)
const adminQueues = require('../services/legal_admin_queues');
const amendmentScanner = require('../services/legal_amendment_scanner');
const wikiBrief = require('../services/legal_wiki_brief');
const freshScanner = require('../services/admrul_fresh_scanner');
// 원문 **결손** 점검(조문 목 누락 + 고시 별표 누락). 위 신선도가 "사본이 낡았나"를 본다면
// 이쪽은 "판은 맞는데 안이 비었나"를 본다. 2026-09-21 신설(C-2 이행).
const mokScanner = require('../services/mok_audit_scanner');
const mokBrief = require('../services/mok_brief');   // 원문결손 대기 전 건 인계문(3-83)
const { DATA_DIR, FILES } = require('../config/server_config');

// [Lazy] Firebase Admin(답변완료 개인 푸시용). routes/report.js 와 같은 이유로 첫 발송 시 로딩.
const { getAdmin } = require('../services/firebase_admin_lazy');

const LEGAL_DIR = path.join(__dirname, '..', 'knowledge', 'legal');
const REVIEW_QUEUE = path.join(LEGAL_DIR, '_dashboard', 'review_queue.md');
// ★2026-09-23 (3-17 · G-11) — 검수 큐를 읽는 **규칙을 여기 적지 않는다.**
//   종전에는 이 파일과 `_dashboard/loop/human_workload.py` 가 **따로** 규칙을 갖고 있었고,
//   `해당 없음` 처리가 파이썬에만 있어 **두 숫자가 어긋난 채 방치**됐다(뿌리 사슬 ⑥).
//   이제 셋(여기 · human_workload.py · V5-30 게이트)이 **한 파일**을 읽는다.
const REVIEW_RULES = require(path.join(LEGAL_DIR, '_dashboard', 'review_queue_rules.json'));
const RQ_HEAD = new RegExp(REVIEW_RULES.카드머리);
const RQ_CLOSE = new RegExp(REVIEW_RULES.카드닫기);
const RQ_OK = new RegExp(REVIEW_RULES.승인);
const RQ_NA = new RegExp(REVIEW_RULES.해당없음);
const RQ_SPLIT = new RegExp(REVIEW_RULES.쪼갬);
const CONCEPTS_DIR = path.join(LEGAL_DIR, 'wiki', 'concepts');
// ★승인 이력은 **볼륨**(local_server/data)에 둔다. 종전 경로(knowledge/legal/_dashboard/)는
//   컨테이너 이미지 안이라 **재배포할 때마다 관리자가 승인한 기록이 통째로 사라졌다.**
//   fly.toml 의 [[mounts]] 로 재배포를 넘어 남는 곳은 local_server/data 뿐이다.
//   (nariya_config.json 이 H-37 적대검증에서 같은 이유로 옮겨졌는데 이 파일은 안 옮겨져 있었다.)
const APPROVALS_LOG = FILES.LEGAL_APPROVALS;
const APPROVALS_LOG_OLD = path.join(LEGAL_DIR, '_dashboard', 'review_approvals.json');
// 이미지 안에 있던 옛 기록을 한 번만 볼륨으로 옮겨 온다(볼륨에 아직 파일이 없을 때만).
try {
  if (!fs.existsSync(APPROVALS_LOG) && fs.existsSync(APPROVALS_LOG_OLD)) {
    fs.mkdirSync(path.dirname(APPROVALS_LOG), { recursive: true });
    fs.copyFileSync(APPROVALS_LOG_OLD, APPROVALS_LOG);
  }
} catch (e) { console.warn('[legal] 승인이력 볼륨 이관 실패:', e.message); }
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
    const m = line.match(RQ_HEAD);
    if (m) {
      if (cur) entries.push(cur);
      const id = m[1];
      const law = id.replace(/^REVIEW-/, '').replace(/-\d+$/, '');
      cur = { id, law, title: m[2].trim(), targetPages: [], body: '', approved: false, approvedMeta: '',
              excluded: false, excludedReason: '' };
      continue;
    }
    // ── 카드가 아닌 `### ` 제목은 **앞 카드를 닫는다**(2026-09-22, P-10) ──
    // review_queue.md 에는 카드가 아닌 `### 〔기록〕 …`·`### 사용자 확정 7건 …`·`### 〔관리 메모〕…`
    // 블록이 5개 있고, 그 안에도 `- 승인: [ ] 대기` 줄이 3개(9435·9468·9515행) 들어 있다.
    // 종전에는 이 제목이 새 카드를 열지 않으므로 **그 줄들이 바로 앞 카드로 흘러들었고**,
    // 아래 `ap` 매칭이 마지막 값으로 덮어쓰는 구조라 **이미 [x] 로 승인된 카드 2장
    // (해양생태계법-907 · 선박법-907)이 「대기」로 뒤집혀 관리자 화면에 떴다.**
    // body 도 같은 경로로 오염돼 남의 기록이 카드에 붙어 보였다.
    // 여기서 cur 를 닫으면 두 증상이 함께 사라진다(대기 3장 → 1장).
    if (RQ_CLOSE.test(line)) { if (cur) { entries.push(cur); cur = null; } continue; }
    if (!cur) continue;
    cur.body += line + '\n';
    const tp = line.match(/^-\s*대상\s*페이지:\s*(.+)$/);
    if (tp) cur.targetPages = tp[1].split(/[,·]/).map(s => s.trim()).filter(Boolean);
    const ap = line.match(RQ_OK);
    if (ap) { cur.approved = ap[1].toLowerCase() === 'x'; cur.approvedMeta = (ap[2] || '').trim(); }
    // ── 세 번째 상태: **승인도 대기도 아닌 카드**(2026-09-18 사용자 확정) ──
    // 종전에는 상태가 둘뿐이었다 — 승인란에 x 가 있으면 승인, 없으면 대기. 그래서 "사람이 할
    // 일이 아닌 카드"를 표현할 방법이 없어 **대기 수가 실제보다 많게 나왔다.**
    //   · `- 쪼갬:` — 논점이 여럿이라 하위 카드로 나눈 부모. 판단은 하위 카드에서 한다.
    //     부모를 지우지 못하는 이유는 **위키 96곳이 이 카드 번호를 참조**하기 때문이다.
    //   · `- 승인: 해당 없음` — 사람 승인 대상이 아닌 항목(재수집 대기 등).
    //     `human_workload.py` 는 2026-08-23 적대검증 뒤 이미 이 카드를 빼고 세는데
    //     **서버에는 같은 처리가 없어 두 숫자가 어긋난 채였다.** 여기서 맞춘다.
    //     (`[ ]` 가 앞에 붙은 꼴도 받는다 — 2026-09-18 에 기계가 읽도록 그렇게 고쳤다.)
    const sp = line.match(RQ_SPLIT);
    if (sp) { cur.excluded = true; cur.excludedReason = '쪼갬 — ' + (sp[1] || '').trim(); }
    const na = line.match(RQ_NA);
    if (na) { cur.excluded = true; cur.excludedReason = '해당 없음 — ' + (na[1] || '').trim(); }
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
    // 세 번째 상태(쪼갠 부모·해당 없음)는 대기 목록에 넣지 않는다 — 사람이 처리할 대상이 아니다.
    // `?status=excluded` 로 따로 볼 수 있게 두어, 숨겨서 안 보이는 일이 없게 한다.
    if (status === 'pending') list = list.filter(e => !e.approved && !e.excluded);
    else if (status === 'approved') list = list.filter(e => e.approved && !e.excluded);
    else if (status === 'excluded') list = list.filter(e => e.excluded);
    res.json({ ok: true, count: list.length, reviews: list.map(e => {
      const s = extractStructured(e.body);
      return {
        id: e.id, law: e.law, title: e.title, targetPages: e.targetPages, body: e.body.trim(),
        fields: s.fields,           // {근거, 확인 필요, AI 연결 내용, 문제, 필요 조치, ...} 가독성용
        urls: s.urls,               // 검증용 원문/이미지 링크(클라에서 클릭 가능하게)
        approved: e.approved, approvedMeta: e.approvedMeta,
        excluded: e.excluded, excludedReason: e.excludedReason,
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
  try { if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (_) { /* 설정 파일이 깨졌으면 던진다 — 아래에서 옛 자리(legacy)를 보고, 그래도 없으면 기본값으로 간다 */ }
  try {
    if (fs.existsSync(CONFIG_FILE_LEGACY)) {
      const legacy = JSON.parse(fs.readFileSync(CONFIG_FILE_LEGACY, 'utf8'));
      if (!configMigrated) {
        configMigrated = true;
        try { writeFileAtomic(CONFIG_FILE, JSON.stringify(legacy, null, 1)); } catch (_) { /* 볼륨이 읽기전용이면 던진다 — 옮겨 적기만 실패하고 **조회는 옛 자리 값으로 계속된다** */ }
      }
      return legacy;
    }
  } catch (_) { /* 옛 자리까지 못 읽으면 던진다 — 부르는 쪽이 기본 설정으로 뜬다(법령 조회는 멈추지 않는다) */ }
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
    // [Codex 모드 · 2026-09-27 사용자 확정] 답변 모델(기본 Luna)과 「일반 사용자에게도 codex」 스위치(기본 꺼짐).
    //   실제 적용은 codexBridge.withRequest 가 한다 — NRYA_CODEX_SECRET 이 없는 서버에서는 둘 다 효과 없음.
    answerModel: codexBridge.ANSWER_MODELS.includes(c.answerModel) ? c.answerModel : codexBridge.DEFAULT_MODEL,
    codexForUsers: c.codexForUsers === true,
  };
}
// POST /api/legal/config 가 받는 boolean 스위치 목록(위 normConfig 와 1:1).
// naverTermLookup(§4-U 모르는 구어 해소)은 2026-08-16 사용자 확정으로 **기본 true**로 전환(다른
// 스위치와 반대 관례) — 관리자가 명시적으로 {naverTermLookup:false}를 보내야만 꺼진다(킬스위치는
// 유지). 이 환경에 NAVER_CLIENT_ID/SECRET이 없으면 스위치가 켜져 있어도 단계가 조용히 물러난다.
const BOOL_SWITCHES = ['codexForUsers', 'answerCanonicalOnly', 'understandConfirm', 'scopeNarrow', 'profileConfirm', 'naverTermLookup'];

/**
 * 되묻기를 **몇 번째로 내는지** 센다(ctx 에 누적).
 * ⚠왜 필요한가(2026-08-20 실측): `decideClarify` 의 무한루프 백스톱은 질의에 붙은 구분자
 *   (`CLARIFY_JOINER`, ' — ')의 개수로 라운드를 셌다. 그런데 그 구분자는 **선택지 버튼으로
 *   답했을 때만** 붙는다. 사용자가 값을 직접 타이핑하면(예: "65점입니다") 카운터가 영원히 0이라
 *   상한이 한 번도 발동하지 않는다 — 해양환경관리법 위해도평가 질문에서 사용자가 이미 총점을
 *   줬는데도 세부항목을 계속 되물어 4회 요청까지 최종 답변에 닿지 못했다(23차 감사).
 *   버튼이든 직접 입력이든 **똑같이** 세도록 ctx 에 누적한다.
 * 예: clarifyRoundNext({cl:{n:2}}) → 3
 * @param {{cl?:{n?:number}}} ctx - 클라이언트가 되돌려 주는 대화 맥락
 * @returns {number} 이번에 내는 되묻기가 몇 번째인지
 * [연계] → ctx.cl.n → legal_retriever.js decideClarify(prevClarify.n 으로 상한 판정).
 */
function clarifyRoundNext(ctx) {
  const prev = ctx && ctx.cl && Number(ctx.cl.n);
  return (Number.isFinite(prev) && prev > 0 ? prev : 0) + 1;
}
router.get('/api/legal/config', (req, res) => {
  res.json(Object.assign({ ok: true }, normConfig(readConfig())));
});
router.post('/api/legal/config', adminAuth.requireAdminToken, (req, res) => {
  const b = req.body || {};
  if (b.exposure !== undefined && !['off', 'admin', 'user'].includes(b.exposure))
    return res.status(400).json({ ok: false, error: 'exposure는 off|admin|user' });
  if (b.answerModel !== undefined && !codexBridge.ANSWER_MODELS.includes(b.answerModel))
    return res.status(400).json({ ok: false, error: `answerModel은 ${codexBridge.ANSWER_MODELS.join('|')}` });
  for (const k of BOOL_SWITCHES) {
    if (b[k] !== undefined && typeof b[k] !== 'boolean')
      return res.status(400).json({ ok: false, error: `${k}는 true|false` });
  }
  withLock(async () => {
    const cur = normConfig(readConfig());                       // 기존 필드 보존(머지) — 한 필드 갱신이 다른 필드 삭제 안 하게
    if (b.exposure !== undefined) cur.exposure = b.exposure;
    if (b.answerModel !== undefined) cur.answerModel = b.answerModel;
    for (const k of BOOL_SWITCHES) if (b[k] !== undefined) cur[k] = b[k];
    writeFileAtomic(CONFIG_FILE, JSON.stringify(Object.assign(cur, { updatedAt: new Date().toISOString() }), null, 1));
    return cur;
  }).then(v => res.json(Object.assign({ ok: true }, normConfig(v)))).catch(e => res.status(500).json({ ok: false, error: String(e.message || e) }));
});

// GET /api/legal/reviews/stats — 카운트
router.get('/api/legal/reviews/stats', (req, res) => {
  try {
    const list = parseReviewQueue();
    // pending 은 **사람이 실제로 볼 일의 개수**다 — 쪼갠 부모·해당 없음은 빼고 센다.
    // 이 수가 관리자 화면의 배지와 `human_workload.py` 의 집계와 같아야 한다(2026-09-18).
    res.json({ ok: true, total: list.length,
      pending: list.filter(e => !e.approved && !e.excluded).length,
      approved: list.filter(e => e.approved && !e.excluded).length,
      excluded: list.filter(e => e.excluded).length });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// GET /api/legal/reviews/approvals — 승인 이력 통째로 내려받기(저장소 반영용)
// 승인은 볼륨에만 남는다. 저장소(위키·review_queue.md)에 반영하려면 이 응답을 파일로 받아
// `_dashboard/loop/apply_approvals.py` 에 먹인다. 그래야 다음 배포에도 승인이 살아남는다.
router.get('/api/legal/reviews/approvals', (req, res) => {
  let out;
  try { out = readApprovalsLog(); } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
  res.json({ ok: true, count: out.log.length, path: APPROVALS_LOG, approvals: out.log,
    brokenMovedTo: out.brokenMovedTo || undefined });
});

/**
 * 대상 위키 개념 페이지의 frontmatter status를 canonical로 올리고,
 * 사람이 확정한 교정값을 명시적 블록으로 남긴다(안전: 표 셀 자동치환 대신 확정값 각인).
 * @returns {string[]} 실제로 수정한 파일명 목록
 */
/**
 * 승인 이력을 읽는다. **읽기 실패를 조용히 넘기지 않는다.**
 * 종전 코드는 `catch (_) {}` 로 삼키고 빈 배열로 시작했는데, 그러면 파일이 한 번 깨졌을 때
 * 다음 승인이 **지금까지의 이력 전부를 지우고 그 한 건만** 써 버린다. 승인 기록은 사람이 직접
 * 누른 것이라 날아가면 복구할 방법이 없다(2026-08-28 발견).
 * 그래서 깨진 파일은 지우지 않고 `.broken-<시각>` 으로 **옆에 옮겨 두고** 그 사실을 로그에 남긴다.
 * @returns {{log: Array, brokenMovedTo: string}} 읽은 이력과, 깨진 파일을 옮겨 둔 경로(없으면 '')
 * [연계] ← finalizeApproval, GET /api/legal/reviews/approvals.
 */
function readApprovalsLog() {
  if (!fs.existsSync(APPROVALS_LOG)) return { log: [], brokenMovedTo: '' };
  let raw = '';
  try { raw = fs.readFileSync(APPROVALS_LOG, 'utf8'); }
  catch (e) { throw new Error('승인 이력 파일을 읽지 못했습니다(' + e.message + '). 덮어쓰지 않고 멈춥니다.'); }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { log: parsed, brokenMovedTo: '' };
    throw new Error('배열이 아닙니다');
  } catch (e) {
    const moved = APPROVALS_LOG + '.broken-' + new Date().toISOString().replace(/[:.]/g, '-');
    // 옮기지 못하면 **빈 배열로 진행하지 않는다.** 그대로 두고 쓰면 다음 쓰기가 이력을 통째로
    // 덮어쓴다 — 이 함수가 막으려던 바로 그 사고다(2026-08-28 독립 검토에서 발견).
    try { fs.renameSync(APPROVALS_LOG, moved); }
    catch (e2) { throw new Error('승인 이력이 깨져 있는데 옆으로 옮기지도 못했습니다(' + e2.message
      + '). 덮어쓰면 기록이 사라지므로 멈춥니다. 관리자가 ' + APPROVALS_LOG + ' 를 직접 확인해야 합니다.'); }
    console.error('[legal] ⚠승인 이력이 깨져 있어(' + e.message + ') ' + moved + ' 로 옮겼습니다. '
      + '새 파일로 다시 시작하지만 **옛 기록은 그 파일에 남아 있으니 사람이 확인해야 합니다.**');
    return { log: [], brokenMovedTo: moved };
  }
}

/**
 * 승인 이력을 쓴다. **덮어쓰기 전에 직전 판을 한 벌 남긴다.**
 * @param {Array} log
 * [연계] ← finalizeApproval. 남기는 파일: <경로>.prev
 */
function writeApprovalsLog(log) {
  try { if (fs.existsSync(APPROVALS_LOG)) fs.copyFileSync(APPROVALS_LOG, APPROVALS_LOG + '.prev'); }
  catch (e) { console.warn('[legal] 승인 이력 직전판 백업 실패:', e.message); }
  writeFileAtomic(APPROVALS_LOG, JSON.stringify(log, null, 1));
}

/**
 * 승인을 **되돌린다** — canonical 로 올렸던 페이지를 draft 로 내리고 확정 각인을 지운다.
 * 사람이 잘못 눌렀을 때 되돌릴 방법이 화면에 없어 2026-08-28 에 추가했다.
 * ⚠같은 페이지에 **다른 리뷰의 확정 각인**이 남아 있으면 각인만 지우고 canonical 은 유지한다
 *   (남의 승인을 지우지 않는다). 그래서 "각인을 지운 파일"과 "draft 로 내린 파일"이 다르다 —
 *   응답 문구가 실제와 다르면 안 되므로 둘을 따로 돌려준다(2026-08-28 실기동 시험에서 발견).
 * @param {string[]} targetPages @param {string} reviewId
 * @returns {{changed: string[], demoted: string[]}} 각인을 지운 파일 · 그중 draft 로 내린 파일
 * [연계] ← finalizeApproval(decision === 'undo'), applyToWikiPages 와 정확히 반대 동작.
 */
function undoWikiPages(targetPages, reviewId) {
  const changed = [];
  const demoted = [];
  let lastLawSlug = '';
  const root = path.resolve(CONCEPTS_DIR) + path.sep;
  const escId = reviewId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const rawTp of targetPages) {
    let base = String(rawTp).replace(/^wiki\/concepts\//, '').trim();
    base = base.replace(/\.md\b[\s\S]*$/, '').trim();
    if (!base) continue;
    if (base.startsWith('__') && lastLawSlug) base = lastLawSlug + base;
    else lastLawSlug = base.split('__')[0];
    const fp = path.join(CONCEPTS_DIR, base + '.md');
    if (!path.resolve(fp).startsWith(root)) continue;
    if (!fs.existsSync(fp)) continue;
    const before = fs.readFileSync(fp, 'utf8');
    let md = before.replace(new RegExp('^> ✅ 사람검증 확정[^\\n]*' + escId + '[^\\n]*\\n?', 'm'), '');
    // 이 리뷰 말고 다른 사람검증 확정이 남아 있으면 canonical 을 유지한다(남의 승인을 지우지 않는다).
    let wasDemoted = false;
    if (!/^> ✅ 사람검증 확정/m.test(md)) {
      const after = md.replace(/^(status:\s*)canonical\s*$/m, '$1draft');
      wasDemoted = after !== md;
      md = after;
    }
    if (md === before) continue;
    writeFileAtomic(fp, md);
    changed.push(path.basename(fp));
    if (wasDemoted) demoted.push(path.basename(fp));
  }
  return { changed, demoted };
}

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
  const mark = decision === 'undo'
    ? `- 승인: [ ] 대기(되돌림: ${by}, ${dateStr})`
    : decision === 'reject'
      ? `- 승인: [ ] 반려(${by}, ${dateStr})`
      : `- 승인: [x] 승인(${by}, ${dateStr})` + (correctedValue != null && correctedValue !== '' ? ` · 확정값: ${String(correctedValue)}` : '');
  // 해당 엔트리 블록 내부의 "- 승인:" 라인만 교체
  const escId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // ⚠`[\s\S]*?` 만 쓰면 **자기 블록에 `- 승인:` 줄이 없을 때 다음 항목까지 삼켜**
  //   남의 승인줄을 덮어쓴다(2026-08-28 독립 검토에서 발견, 실제 대기열에 그런 항목이 2개 있었다).
  //   그래서 다음 `###` 헤더 앞에서 멈추게 한다.
  const INBLOCK = '(?:(?!\\n###\\s)[\\s\\S])*?';
  const blockRe = new RegExp('(###\\s+' + escId + ':' + INBLOCK + ')-\\s*승인:\\s*\\[[ xX]\\][^\\n]*', 'm');
  // 함수 치환: correctedValue/by의 '$' 특수시퀀스($1·$&·$$)가 원장을 손상시키지 않도록
  if (blockRe.test(txt)) txt = txt.replace(blockRe, (mm, p1) => p1 + mark);
  else {
    // 그 항목에 `- 승인:` 줄이 아예 없는 경우 — 블록 끝에 새로 만들어 넣는다.
    // (종전에는 500 을 냈고, 그 전에는 다음 항목의 승인줄을 덮어썼다.)
    // ⚠`$` 는 'm' 플래그에서 **줄 끝마다** 맞아서, 승인줄이 블록 첫 줄 뒤에 끼어들었다
    //   (2026-08-28 실기동 시험에서 발견). 진짜 문서 끝은 `(?![\s\S])` 로 잡는다.
    const headRe = new RegExp('(###\\s+' + escId + ':' + INBLOCK + ')(?=\\n###\\s|(?![\\s\\S]))');
    if (!headRe.test(txt)) return { httpStatus: 404, body: { ok: false, error: '대기열에 그 항목이 없습니다: ' + id } };
    txt = txt.replace(headRe, (mm, p1) => p1.replace(/\s*$/, '') + '\n' + mark + '\n');
  }
  writeFileAtomic(REVIEW_QUEUE, txt);

  // 2) 승인이면 대상 위키 페이지 canonical 승격 + 확정값 각인
  let changedFiles = [];
  if (decision === 'approve') changedFiles = applyToWikiPages(entry.targetPages, correctedValue, id, by, dateStr);
  let undoDemoted = [];
  if (decision === 'undo') {
    const r = undoWikiPages(entry.targetPages, id);
    changedFiles = r.changed;
    undoDemoted = r.demoted;
  }

  // 3) 승인 이력 로그(감사 추적)
  const { log, brokenMovedTo } = readApprovalsLog();
  log.push({ id, decision, correctedValue, by, at: now.toISOString(), targetPages: entry.targetPages, changedFiles });
  writeApprovalsLog(log);

  // 정직한 note: 실제 승격 페이지 수 기준(무음 성공 금지)
  // 정직한 note: **실제로 일어난 것만** 적는다. 각인만 지운 것과 draft 로 내린 것은 다르다.
  const keptCanonical = changedFiles.length - undoDemoted.length;
  const note = decision === 'undo'
    ? (changedFiles.length === 0
        ? '되돌림 완료 · 대기 상태로 복귀(바뀐 위키 페이지는 없다 — 이미 각인이 없었거나 대상 페이지를 찾지 못했다)'
        : `되돌림 완료 · 대기 상태로 복귀 · 확정 각인을 지운 페이지 ${changedFiles.length}개`
          + (undoDemoted.length ? ` · 그중 ${undoDemoted.length}개를 draft 로 내렸다` : '')
          + (keptCanonical ? ` · ${keptCanonical}개는 **다른 승인의 확정 각인이 남아 있어 canonical 을 유지**했다` : ''))
    : decision === 'reject' ? '반려 처리(재검토 큐 유지)'
    : (changedFiles.length ? `승인 완료 · ${changedFiles.length}개 페이지 canonical 승격·확정값 반영(인덱스 재빌드는 배치)`
      : '⚠ 승인은 기록됐으나 대상 위키 페이지를 찾지 못해 승격 0건 — 리뷰의 "대상 페이지" 표기를 확인하세요');
  return { httpStatus: 200, body: { ok: true, id, decision, correctedValue, changedFiles,
    promotedCount: changedFiles.length,
    note: note + (brokenMovedTo ? ' ⚠승인 이력 파일이 깨져 있어 ' + path.basename(brokenMovedTo)
      + ' 로 옮기고 새로 시작했습니다 — 옛 기록을 사람이 확인해야 합니다.' : '') } };
}

// POST /api/legal/reviews/:id/approve — 승인(+교정값 확정) 또는 반려 → 서버 반영
// body: { decision: 'approve'|'reject'|'undo', correctedValue?, by? }
// 'undo' = 잘못 누른 승인을 되돌린다(대기로 복귀 + canonical→draft + 확정 각인 삭제).
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
  // 위와 같은 이유로 블록 경계를 넘지 않게 한다(2026-08-28).
  const blockRe = new RegExp('(###\\s+' + escId + ':(?:(?!\\n###\\s)[\\s\\S])*?)(-\\s*승인:\\s*\\[[ xX]\\][^\\n]*)', 'm');
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
      amendments: adminQueues.countPending(amendmentScanner.queueFile()),
      freshness: adminQueues.countPending(freshScanner.QUEUE_FILE),
      mokAudit: adminQueues.countPending(mokScanner.QUEUE_FILE) });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// 초안승인 방이 쓰는 표시([미확인] 머리표). legal_retriever 가 본문에 넣는 것과 **같은 글자**여야
// 한다 — 이 글자로 "확정 서술"과 "사람 검토가 안 끝난 줄"을 가른다.
const UNVERIFIED_MARK = '[미확인 — 아래는 사람 검토가 끝나지 않은 내용이다.';

/**
 * 초안 한 쪽을 **챗봇이 실제로 쓰는 모습 그대로** 갈라서 돌려준다.
 * 운영 코드(`legal_retriever.markUnresolvedReview`)를 그대로 불러 쓴다 — 규칙을 여기서 다시
 * 구현하면 화면과 실제 답변이 어긋나기 때문이다.
 * @param {string} file - 개념 페이지 파일명(확장자 없음)
 * @returns {{ok:boolean, body:string, kept:string, unverified:Array<string>, error?:string}}
 *   kept: 지금도 그대로 근거로 쓰이는 부분 · unverified: [미확인]으로 밀려난 줄들
 * [연계] ← GET /api/legal/drafts/detail.
 */
function splitDraftBody(file) {
  const page = legalRetriever.readPage('concept', file);
  if (!page) return { ok: false, body: '', kept: '', unverified: [], error: '페이지를 찾지 못했습니다: ' + file };
  const body = page.body || '';
  const out = legalRetriever.markUnresolvedReview(body);
  const i = out.indexOf(UNVERIFIED_MARK);
  const kept = i < 0 ? out : out.slice(0, i);
  const unverified = i < 0 ? [] : out.slice(i).split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
  return { ok: true, body, kept, unverified };
}

// GET /api/legal/drafts?page=1&per=20 — 초안승인 탭 목록(index.json의 status=draft 개념 페이지).
//   ★2026-09-10 사용자 요청으로 **쪽 나누기**를 넣었다(224건이 한 화면에 통째로 쏟아졌다).
//   카드마다 **[미확인]으로 밀려난 줄이 몇 줄인지**(unverified)를 함께 준다 — "이 초안이 왜
//   대기 중인가"가 그 숫자이기 때문이다. 0이면 승격 후보다.
router.get('/api/legal/drafts', adminAuth.requireAdminToken, (req, res) => {
  try {
    const all = (loadIndex().pages || [])
      .filter(p => p.kind === 'concept' && p.status === 'draft')
      .sort((a, b) => (a.law || '').localeCompare(b.law || '') || (a.topic || '').localeCompare(b.topic || ''));
    const per = Math.max(1, Math.min(100, parseInt(req.query.per, 10) || 20));
    const pages = Math.max(1, Math.ceil(all.length / per));
    const page = Math.max(1, Math.min(pages, parseInt(req.query.page, 10) || 1));
    const drafts = all.slice((page - 1) * per, page * per).map((p) => {
      const r = splitDraftBody(p.file);
      return { file: p.file, law: p.law, topic: p.topic, penalty: !!p.penalty,
               unverified: r.ok ? r.unverified.length : -1 };
    });
    res.json({ ok: true, count: all.length, total: all.length, page, pages, per, drafts });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// GET /api/legal/drafts/detail?file=<파일명> — 초안 한 쪽의 내용을 본다(사용자 요청 2026-09-10:
//   "해당 페이지에서 초안을 확인할 수 있는 방안이 현재 없어").
//   ★그냥 본문을 주지 않고 **챗봇이 쓰는 모습 그대로 갈라서** 준다 — 지금도 근거로 쓰이는 부분과
//   [미확인]으로 밀려난 줄을 나눠 줘야, 관리자가 "무엇을 승인해야 하는지"를 바로 본다.
//   파일명에 `ㆍ`·괄호가 섞여 있어 경로가 아니라 쿼리로 받는다.
router.get('/api/legal/drafts/detail', adminAuth.requireAdminToken, (req, res) => {
  try {
    const file = String(req.query.file || '');
    if (!file) return res.status(400).json({ ok: false, error: 'file 이 필요합니다.' });
    const meta = (loadIndex().pages || []).find(p => p.kind === 'concept' && p.file === file);
    if (!meta) return res.status(404).json({ ok: false, error: '개념 페이지를 찾지 못했습니다: ' + file });
    const r = splitDraftBody(file);
    if (!r.ok) return res.status(404).json({ ok: false, error: r.error });
    res.json({ ok: true, file, law: meta.law, topic: meta.topic, status: meta.status,
               penalty: !!meta.penalty, kept: r.kept, unverified: r.unverified, body: r.body });
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
  } catch (e) {
    // ★조용히 넘어가지 않는다 (3-44). `triage:null` 로 남아 **관리자가 직접 판단**하면 되지만,
    //   「분류할 것이 없었다」와 「분류가 실패했다」가 겉으로 똑같았다.
    console.warn('[Legal-FeedbackTriage] 분류 실패 — triage 없이 쌓인다(관리자가 직접 본다):', e && e.message);
  }
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
// 큐 파일은 Fly 볼륨(`data/legal_amendments_queue.jsonl`)에 있고 `queueFile()` 이 첫 접근 때
// git 사본(`_amendments/queue.jsonl`)으로 시드한다 — 상수 경로를 직접 읽으면 시드가 안 된다(2026-09-10).
// (_amendments/README.md 설계: "승인 → 매니페스트 재생성 → 재수집 → 재빌드 → 재감사"는
// 사람이 다음 세션에서 orchestrate하는 별도 단계, 자동 파이프라인 아님 — 환각0 승인게이트).
// ============================================================================

/**
 * 미리 받아 둔 예고본(pending_index.json)을 **큐 id → 그 예고본 정보** 로 뒤집은 표를 만든다.
 * 예: stageByQueueId().get('am_17...') → { law:'양식산업발전법', date:'20261001', file:'법률.txt', due:false }
 * `due:true` 는 시행일이 이미 지났다는 뜻 — 승인 전이라 챗봇이 아직 옛 내용을 답하고 있다.
 * @returns {Map<string, {law:string,date:string,file:string,due:boolean}>}
 * [연계] ← GET /api/legal/amendments(카드에 붙일 stage) · countStagedIds(일괄 승인 미리보기).
 */
function stageByQueueId() {
  const idx = effectiveDate.loadPendingIndex();
  const today = effectiveDate.todayKST();
  const m = new Map();
  for (const base of Object.keys(idx)) {
    for (const e of idx[base] || []) {
      for (const f of Object.keys((e && e.queue_id) || {})) {
        m.set(String(e.queue_id[f]), { law: base.split('/').pop(), date: String(e.date), file: f, due: String(e.date) <= today });
      }
    }
  }
  return m;
}

/**
 * 주어진 큐 id 들 중 **승인하면 챗봇 답변이 실제로 바뀌는 건**이 몇 개인지 센다.
 * 예고본을 미리 받아 둔 건만 해당한다 — 나머지는 승인해도 "재수집 필요" 표시만 붙는다.
 * @param {Array<string>} ids @returns {number}
 * [연계] ← POST /api/legal/amendments/decide-all · GET .../decide-all/preview.
 */
function countStagedIds(ids) {
  const m = stageByQueueId();
  let n = 0;
  for (const id of ids || []) if (m.has(String(id))) n++;
  return n;
}

// GET /api/legal/amendments?status=pending|approved|dismissed|all (관리자)
router.get('/api/legal/amendments', adminAuth.requireAdminToken, (req, res) => {
  try {
    const status = req.query.status || 'pending';
    let list = adminQueues.readJsonl(amendmentScanner.queueFile()).reverse();
    if (status !== 'all') list = list.filter((e) => (e.status || 'pending') === status);
    // ★승인 게이트(2026-09-10): 이 항목에 **미리 받아 둔 예고본**이 있으면 알려 준다. 승인해야 그 판이
    //   답변에 반영되므로, 관리자는 "승인만 하면 바로 바뀌는 건인지"를 카드에서 알아야 한다.
    //   시행일이 이미 지났는데 승인이 안 됐으면(due:true) 지금 챗봇은 **옛 내용**을 내보내는 중이다.
    const byQueue = stageByQueueId();
    list = list.map((e) => (byQueue.has(e.id) ? Object.assign({}, e, { stage: byQueue.get(e.id) }) : e));
    // ★마지막 스캔이 언제·어떻게 끝났는지 함께 준다. 목록이 비었을 때 **"개정이 없다"와
    //   "확인을 못 했다"를 화면이 구별**해야 한다(2026-09-20 사용자 지시).
    res.json({ ok: true, count: list.length, amendments: list, lastScan: amendmentScanner.readScanStatus() });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// POST /api/legal/amendments/:id/decide (관리자) — body: { decision: 'approved'|'dismissed', by? }
router.post('/api/legal/amendments/:id/decide', adminAuth.requireAdminToken, (req, res) => {
  try {
    const { decision = 'approved', by = '관리자' } = req.body || {};
    const updated = adminQueues.updateJsonlById(amendmentScanner.queueFile(), req.params.id, { status: decision, decidedBy: by, decidedAt: new Date().toISOString() });
    if (!updated) return res.status(404).json({ ok: false, error: 'amendment not found: ' + req.params.id });
    // ★승인을 **탐지 큐에도** 옮겨 적는다(2026-09-10에 찾은 결함). 재수집 도구
    //   `_dashboard/loop/collect_pending_law.py --all-approved` 는 승인 여부를
    //   `data/law_change_queue.json` 에서 찾는데, 종전에는 이 버튼이 `queue.jsonl` 에만 써서
    //   **승인해도 재수집 대상이 0건**이었다. 옮겨 적기가 실패해도 승인 자체는 막지 않고 결과만 알려 준다.
    const mirrored = amendmentScanner.mirrorDecisionToH29(req.params.id, decision);
    res.json({ ok: true, amendment: updated, mirrored });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// POST /api/legal/amendments/decide-all (관리자) — body: { decision:'approved'|'dismissed', ids?:[...], by? }
//   대기 중인 건을 **한 번에** 처리한다(사용자 확정 2026-09-10: "전체 승인 할 수 있도록 버튼을 만들어주고").
//   ids 를 주면 그 건만, 안 주면 status==='pending' 인 전 건이 대상이다.
//   ★왜 한 번에 눌러도 되나: 이 큐의 근거는 law.go.kr 이 스스로 공표한 "이 날부터 이 내용"이라,
//     개정 사실 자체는 다투는 값이 아니다. 승인 게이트가 있는 이유는 개정을 의심해서가 아니라
//     **위키가 자동으로 안 바뀌기 때문**이다(서버는 저장소에 글을 못 쓴다). 그래서 응답에
//     `staged`(승인 즉시 챗봇 답변이 바뀌는 건 수)를 함께 돌려준다 — 화면이 그 숫자를 먼저 보여
//     주고 확인을 받는다.
router.post('/api/legal/amendments/decide-all', adminAuth.requireAdminToken, (req, res) => {
  try {
    const { decision = 'approved', ids = null, by = '관리자' } = req.body || {};
    if (decision !== 'approved' && decision !== 'dismissed') {
      return res.status(400).json({ ok: false, error: "decision 은 'approved' 또는 'dismissed' 여야 합니다." });
    }
    const rows = adminQueues.readJsonl(amendmentScanner.queueFile());
    const want = Array.isArray(ids) && ids.length ? new Set(ids.map(String)) : null;
    const targets = rows.filter((e) => (want ? want.has(String(e.id)) : (e.status || 'pending') === 'pending'));
    if (!targets.length) return res.json({ ok: true, decided: 0, mirrored: 0, ids: [], staged: 0 });
    const decidedAt = new Date().toISOString();
    const done = [];
    let mirrored = 0;
    for (const t of targets) {
      const u = adminQueues.updateJsonlById(amendmentScanner.queueFile(), t.id, { status: decision, decidedBy: by, decidedAt });
      if (!u) continue;
      done.push(String(t.id));
      // 개별 승인과 같은 처리 — 재수집 도구가 보는 탐지 큐에도 옮겨 적는다.
      if (amendmentScanner.mirrorDecisionToH29(t.id, decision)) mirrored++;
    }
    res.json({ ok: true, decided: done.length, mirrored, ids: done, staged: countStagedIds(done) });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// GET /api/legal/amendments/decide-all/preview (관리자) — 전체 승인을 누르기 **전에** 무엇이 벌어지는지.
//   대기 건수와, 그중 "승인 즉시(또는 시행일부터) 챗봇 답변이 바뀌는" 건수를 돌려준다.
router.get('/api/legal/amendments/decide-all/preview', adminAuth.requireAdminToken, (req, res) => {
  try {
    const rows = adminQueues.readJsonl(amendmentScanner.queueFile());
    const pending = rows.filter((e) => (e.status || 'pending') === 'pending');
    const ids = pending.map((e) => String(e.id));
    const withArts = pending.filter((e) => (e.changed_articles || []).length).length;
    res.json({ ok: true, pending: pending.length, staged: countStagedIds(ids), withArticles: withArts });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// GET /api/legal/amendments/wiki-brief-all?status=approved (관리자) — 승인한 **전 건**을 한 덩어리
//   인계문으로. 개별 지시문(위 :id/wiki-brief)과 별개다(사용자 확정 2026-09-10).
//   ids 를 콤마로 주면 그 건만 묶는다(방금 일괄 승인한 것만 뽑을 때 쓴다).
router.get('/api/legal/amendments/wiki-brief-all', adminAuth.requireAdminToken, (req, res) => {
  try {
    const rows = adminQueues.readJsonl(amendmentScanner.queueFile());
    const idsQ = String(req.query.ids || '').split(',').map((v) => v.trim()).filter(Boolean);
    let list;
    if (idsQ.length) {
      const want = new Set(idsQ);
      list = rows.filter((e) => want.has(String(e.id)));
    } else {
      const status = req.query.status || 'approved';
      list = status === 'all' ? rows : rows.filter((e) => (e.status || 'pending') === status);
    }
    if (!list.length) {
      // 빈 결과는 오류가 아니라 **아직 승인한 게 없다**는 상태다 — 화면이 그대로 옮겨 적을 문장을 준다.
      return res.status(404).json({ ok: false, error: idsQ.length ? '그 id 로 묶을 항목을 찾지 못했습니다.' : '아직 승인한 건이 없습니다. 카드에서 승인하거나 「전체 승인」을 먼저 누르세요.' });
    }
    const r = wikiBrief.buildBulkWikiBrief(list, effectiveDate.todayKST());
    if (!r.ok) return res.status(500).json({ ok: false, error: r.error });
    res.json({ ok: true, count: r.count, detailed: r.detailed, listed: r.listed, pages: r.pages, text: r.text });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// GET /api/legal/amendments/:id/wiki-brief (관리자) — 승인한 개정을 위키에 반영하려면 무엇을 어디서
//   고쳐야 하는지 한 덩어리 글로 준다. 관리자가 그 글만 복사해 AI 에게 붙여 넣으면 된다
//   (사용자 확정 2026-09-10: "승인한 내역에 대해 어떤 부분이 바뀌었고 어떤 부분에 집중해 위키를
//   수정검토해야 하는지 텍스트로 정리"). 승인 전이어도 뽑을 수 있다 — 미리 읽어 보라고 막지 않는다.
router.get('/api/legal/amendments/:id/wiki-brief', adminAuth.requireAdminToken, (req, res) => {
  try {
    const rows = adminQueues.readJsonl(amendmentScanner.queueFile());
    const am = rows.find((e) => String(e.id) === String(req.params.id));
    if (!am) return res.status(404).json({ ok: false, error: 'amendment not found: ' + req.params.id });
    const r = wikiBrief.buildWikiBrief(am, effectiveDate.todayKST());
    if (!r.ok) return res.status(500).json({ ok: false, error: r.error });
    res.json({ ok: true, id: am.id, 법령명: am.법령명 || '', status: am.status || '', text: r.text, pages: r.pages });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// GET /api/legal/amendments/scan-progress (관리자) — 「지금 스캔」 진행률(화면 게이지 바용).
//   탐지 스크립트가 stdout 으로 찍는 진행 줄을 스캐너가 모아 둔 것을 그대로 준다.
//   ★이 값은 **질의 진행도**이지 남은 시간이 아니다(부처별 고시 수가 들쭉날쭉해 시간 예측은 거짓이 된다).
router.get('/api/legal/amendments/scan-progress', adminAuth.requireAdminToken, (req, res) => {
  try { res.json(Object.assign({ ok: true }, amendmentScanner.getScanProgress())); }
  catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// POST /api/legal/amendments/scan-now (관리자) — 정기 cron과 별개로 즉시 1회 스캔(H-29
// detect_law_changes.py, 실측 3~4분 소요) 백그라운드 시작. HTTP 응답을 그만큼 붙들면
// 리버스 프록시·브라우저 타임아웃 위험이라 완료를 기다리지 않고 즉시 응답(started:true) —
// 클라는 잠시 후 새로고침해 결과를 확인한다.
// days(선택, 3-84): 「60일 따라잡기」 — 탐지가 여러 날 실패한 뒤 그 사이 공포분을 한 번에 다시 본다(최대 60).
router.post('/api/legal/amendments/scan-now', adminAuth.requireAdminToken, (req, res) => {
  const days = Number((req.body && req.body.days) || 0) || undefined;
  const r = amendmentScanner.startAmendmentScan(days ? { days } : undefined);
  res.status(r.ok ? 200 : 409).json(r);
});

// ============================================================================
// 원문 신선도 — services/admrul_fresh_scanner.js 가 매주(server.js cron) 우리가 받아 둔
// 행정규칙 원문의 일련번호를 law.go.kr 현행본과 대조해, **낡은 원문**을 큐에 적재한다.
// 여기는 그 큐를 보여주고 사람이 처리/무시하는 API 만 — 승인해도 재수집·위키수정을 이
// 자리에서 자동 실행하지 않는다(개정검토와 같은 승인게이트 설계).
// 카드에는 "무엇이 낡았나"뿐 아니라 **무엇을 해야 하나(actions)** 와 **어느 위키를 고쳐야
// 하나(wiki_pages)** 가 함께 담긴다 — 그게 없으면 관리자가 손을 댈 수가 없다.
// ============================================================================

// GET /api/legal/freshness?status=pending|done|dismissed|all (관리자)
//   last: 마지막 점검이 언제·어떻게 끝났는지. **"이상 없음"과 "점검 실패"를 반드시 구분해
//   보여주기 위해** 함께 내려준다(실패를 이상 없음으로 읽으면 낡은 원문을 놓친다).
router.get('/api/legal/freshness', adminAuth.requireAdminToken, (req, res) => {
  try {
    const status = req.query.status || 'pending';
    let list = adminQueues.readJsonl(freshScanner.QUEUE_FILE).reverse();
    if (status !== 'all') list = list.filter((e) => (e.status || 'pending') === status);
    res.json({ ok: true, count: list.length, items: list, last: freshScanner.readStatus() });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// POST /api/legal/freshness/:id/decide (관리자) — body: { decision: 'done'|'dismissed', by? }
router.post('/api/legal/freshness/:id/decide', adminAuth.requireAdminToken, (req, res) => {
  try {
    const { decision = 'done', by = '관리자' } = req.body || {};
    const updated = adminQueues.updateJsonlById(freshScanner.QUEUE_FILE, req.params.id,
      { status: decision, decidedBy: by, decidedAt: new Date().toISOString() });
    if (!updated) return res.status(404).json({ ok: false, error: 'freshness item not found: ' + req.params.id });
    res.json({ ok: true, item: updated });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// POST /api/legal/freshness/scan-now (관리자) — 정기 점검과 별개로 즉시 1회 점검.
//   행정규칙 653 · 법령 222 · 조례 416(3-78) 전수 대조라 1시간 가까이 걸린다. 완료를 기다리지 않고 즉시 응답(started:true).
router.post('/api/legal/freshness/scan-now', adminAuth.requireAdminToken, (req, res) => {
  const r = freshScanner.startFreshnessScan();
  res.status(r.ok ? 200 : 409).json(r);
});

// ============================================================================
// 원문 **결손** 점검 큐 (2026-09-21 신설, C-2 이행) — 위 신선도 방과 같은 모양이다
// ============================================================================
// [무엇이 다른가] 신선도 = "우리 사본이 낡았나"(판번호). 결손 = "판은 맞는데 안이 비었나"
//   (조문 목 가·나·다 누락 · 고시 별표·별지 누락).
// [왜 따로 두나] 할 일이 정반대다 — 낡은 것은 **새 판을 받으면** 되고, 빈 것은
//   **같은 판을 다시 받아야** 한다. 한 방에 섞으면 관리자가 무엇을 눌러야 할지 모른다.

// GET /api/legal/mok-audit?status=pending|done|dismissed|all (관리자)
//   last: 마지막 점검이 언제·어떻게 끝났는지. **"이상 없음"과 "점검 실패"를 반드시 구분해서**
//   보여준다 — 실패를 이상 없음으로 읽으면 빠진 조문을 놓친다.
router.get('/api/legal/mok-audit', adminAuth.requireAdminToken, (req, res) => {
  try {
    const status = req.query.status || 'pending';
    let list = adminQueues.readJsonl(mokScanner.QUEUE_FILE).reverse();
    if (status !== 'all') list = list.filter((e) => (e.status || 'pending') === status);
    res.json({ ok: true, count: list.length, items: list, last: mokScanner.readStatus() });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// GET /api/legal/mok-audit/brief-all (관리자) — 대기 전 건을 AI 작업 세션에 넘길 한 덩어리 인계문으로(3-83).
//   개정검토의 「승인분 전체 지시문」 과 같은 자리다(사장님 2026-10-07 「여기에도 … 전체 지시문 복사할 수 있도록」).
//   이 방에는 승인이 없으므로 **대기(pending) 전 건**을 묶는다. ids 를 콤마로 주면 그 건만.
router.get('/api/legal/mok-audit/brief-all', adminAuth.requireAdminToken, (req, res) => {
  try {
    const rows = adminQueues.readJsonl(mokScanner.QUEUE_FILE).reverse();
    const idsQ = String(req.query.ids || '').split(',').map((v) => v.trim()).filter(Boolean);
    const list = idsQ.length
      ? rows.filter((e) => idsQ.indexOf(String(e.id)) >= 0)
      : rows.filter((e) => (e.status || 'pending') === 'pending');
    if (!list.length) return res.status(404).json({ ok: false, error: idsQ.length ? '그 id 로 묶을 카드를 찾지 못했습니다.' : '대기 중인 결손 카드가 없습니다.' });
    const r = mokBrief.buildMokBrief(list);
    if (!r.ok) return res.status(500).json({ ok: false, error: r.error });
    res.json({ ok: true, count: r.count, kinds: r.kinds, excerpt: r.excerpt, text: r.text });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// POST /api/legal/mok-audit/:id/decide (관리자) — body: { decision: 'done'|'dismissed', by? }
//   ⚠닫아도 **이번 주 점검에서 또 빠져 있으면 다시 대기로 돌아온다**
//   (mok_audit_scanner.reopenStillMissing). 실제로 다시 받았다면 돌아오지 않는다.
router.post('/api/legal/mok-audit/:id/decide', adminAuth.requireAdminToken, (req, res) => {
  try {
    const { decision = 'done', by = '관리자' } = req.body || {};
    const updated = adminQueues.updateJsonlById(mokScanner.QUEUE_FILE, req.params.id,
      { status: decision, decidedBy: by, decidedAt: new Date().toISOString() });
    if (!updated) return res.status(404).json({ ok: false, error: 'mok-audit item not found: ' + req.params.id });
    res.json({ ok: true, item: updated });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// ============================================================================
// 지시문을 **마크다운 파일(.md)** 로 받기 (3-88 · 사장님 2026-10-08 「지시문 전체를 텍스트가 아닌 마크다운 파일로 받을 수 있도록」)
//   앱(Capacitor WebView)은 <a download>/blob 저장이 안 된다(admin_collect.js 의 CSV·PNG 와 같은 사정).
//   ① POST 로 글을 잠깐 맡기고(관리자 토큰 필요) 1회용 토큰을 받는다 → ② 그 토큰 주소를 시스템 브라우저로 열면 파일이 내려온다.
//   토큰은 추측할 수 없는 난수(crypto) · 5분 · 한 번 내려받으면 지운다 — 지시문에는 운영 큐 내용이 들어 있어서다.
// ============================================================================
const _briefFileStore = new Map(); // token -> { text, name, exp }
function _briefFileName(name) {
  const base = String(name || '').replace(/[\\/:*?"<>|\r\n]+/g, '_').trim().slice(0, 80) || 'nariya_brief';
  return /\.md$/i.test(base) ? base : base + '.md';
}
router.post('/api/legal/brief-file', adminAuth.requireAdminToken, (req, res) => {
  try {
    const text = String((req.body && req.body.text) || '');
    if (!text.trim()) return res.status(400).json({ ok: false, error: '지시문이 비어 있습니다.' });
    const now = Date.now();
    for (const [k, v] of _briefFileStore) if (v.exp < now) _briefFileStore.delete(k);
    const token = require('crypto').randomBytes(18).toString('hex');
    _briefFileStore.set(token, { text, name: _briefFileName(req.body && req.body.name), exp: now + 5 * 60 * 1000 });
    res.json({ ok: true, token, name: _briefFileStore.get(token).name });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});
// GET /api/legal/brief-file/:token — 시스템 브라우저가 연다(관리자 머리글을 실을 수 없으므로 토큰이 곧 권한이다).
router.get('/api/legal/brief-file/:token', (req, res) => {
  const item = _briefFileStore.get(req.params.token);
  if (!item || item.exp < Date.now()) {
    _briefFileStore.delete(req.params.token);
    return res.status(404).type('text/plain; charset=utf-8').send('파일이 만료되었거나 이미 내려받았습니다. 관리자 화면에서 다시 눌러 주세요.');
  }
  _briefFileStore.delete(req.params.token);
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', "attachment; filename=\"nariya_brief.md\"; filename*=UTF-8''" + encodeURIComponent(item.name));
  res.send(item.text);
});

// POST /api/legal/mok-audit/decide-all (관리자) — body: { decision:'done'|'dismissed', ids?:[...], by? } (3-88)
//   사장님 2026-10-08 「72장을 하나씩 누를 필요가 있겠어? 전체승인 버튼있으면 좋지않아?」 — 대기 전 건(또는 ids)을 한 번에 닫는다.
//   ⚠닫아도 **다음 점검에서 아직 빠져 있으면 다시 대기로 돌아온다**(reopenStillMissing) — 그래서 일괄로 닫아도 놓치지 않는다.
router.post('/api/legal/mok-audit/decide-all', adminAuth.requireAdminToken, (req, res) => {
  try {
    const { decision = 'done', ids = null, by = '관리자(전체 처리)' } = req.body || {};
    if (decision !== 'done' && decision !== 'dismissed') return res.status(400).json({ ok: false, error: 'decision 은 done|dismissed' });
    const want = Array.isArray(ids) && ids.length ? new Set(ids.map(String)) : null;
    const at = new Date().toISOString();
    const done = [];
    for (const e of adminQueues.readJsonl(mokScanner.QUEUE_FILE)) {
      if (!e || !e.id || (e.status || 'pending') !== 'pending') continue;
      if (want && !want.has(String(e.id))) continue;
      if (adminQueues.updateJsonlById(mokScanner.QUEUE_FILE, e.id, { status: decision, decidedBy: by, decidedAt: at })) done.push(e.id);
    }
    res.json({ ok: true, decided: done.length, decision, ids: done });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// POST /api/legal/mok-audit/scan-now (관리자) — 정기 점검(수요일 03:00)과 별개로 즉시 1회.
//   573계열 + 고시 824건 대조라 실측 20~40분. 완료를 기다리지 않고 즉시 응답(started:true).
router.post('/api/legal/mok-audit/scan-now', adminAuth.requireAdminToken, (req, res) => {
  const r = mokScanner.startMokAuditScan();
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
    const out = { ok: true, query: entry.query, answer: entry.answer, sources: entry.sources,
      citationChain: entry.citationChain || [], forms: entry.forms || [],
      citeLaws: entry.citeLaws || [], note: entry.note };
    // 주제는 있을 때만 싣는다(예전 보관분에는 없다 — 그때는 오늘까지의 응답과 바이트 동일).
    if (entry.topic) out.ctxNext = { topic: entry.topic };
    res.json(out);
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// GET /api/legal/answer-by-ask/:askId — 답을 기다리다 연결이 끊긴 앱이 **그 답을 되찾아 가는** 곳.
//   ★2026-08-18(사용자 지적): 앱을 백그라운드로 내리면 진행 중이던 연결이 끊긴다. 서버는 그대로
//   답을 끝까지 만들어 보관하므로, 앱이 다시 앞으로 나왔을 때 여기로 물어보면 **AI를 다시 부르지
//   않고**(비용 0) 화면을 되살릴 수 있다. 아직 만드는 중이면 {ok:false} — 앱이 잠시 뒤 다시 묻는다.
//   ⚠ requestId 쪽(완료 푸시 딥링크)과 달리 **조회해도 지우지 않는다** — 같은 답변을 푸시로도
//     열 수 있어야 한다. askId 는 앱이 그 질문을 보낼 때 만든 값이라 남이 알 수 없다.
router.get('/api/legal/answer-by-ask/:askId', (req, res) => {
  try {
    const entry = pendingAnswers.peekByAsk(String(req.params.askId || ''));
    if (!entry) return res.json({ ok: false });
    const out = { ok: true, query: entry.query, answer: entry.answer, sources: entry.sources,
      citationChain: entry.citationChain || [], forms: entry.forms || [],
      citeLaws: entry.citeLaws || [], note: entry.note };
    if (entry.topic) out.ctxNext = { topic: entry.topic };
    res.json(out);
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
// 답변 아래 서식 다운로드 버튼의 최대 개수. 근거 조문 8줄 × 조당 참조 12개(article_text MAX_REFS)라
// 상한이 없으면 이론상 수십 개가 한 줄씩 쌓여 답변보다 버튼이 길어진다(실측 최다 케이스 §검증 참고).
const MAX_FORMS = 8;

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
 * @returns {Promise<Array>} 각 행에 excerpt 를 직접 채우고, **딸린 별지 서식 목록**을 돌려준다
 *                           (아래 pickFormRefs — 응답의 `forms` 로 나가 화면의 다운로드 버튼이 된다)
 * [연계] ← POST /api/legal/ask. → services/article_text.js loadArticle().
 *          ← citedArticle 은 legal_retriever.js filterCitationChainByAnswer 가 채운다(계약1).
 *          → client/js/ai-chat/ai_chat.js renderFormDownloadsHTML(data.forms).
 */
async function attachChainExcerpts(rows) {
  // ⚠ 보탠 줄(synthesized — 아래 synthesizeChainRows)은 건너뛴다. 그 줄은 만들어질 때 이미 원문을
  //   한 번 읽었고(그때 발췌도 붙였다) 여기서 또 읽으면 같은 파일을 두 번 읽어 대기시간만 는다.
  const targets = (rows || []).filter(r => !(r && r.synthesized)).slice(0, MAX_EXCERPT_ROWS);
  // ⚠ 서식은 줄마다 따로 담았다가 **근거 줄 순서대로** 이어 붙인다 — 공용 배열에 완료 순서대로
  //   밀어 넣으면 같은 질문인데도 버튼 순서가 매번 달라진다(비동기 완료 순서는 보장되지 않는다).
  const formsByRow = targets.map(() => []);
  await Promise.allSettled(targets.map(async (row, i) => {
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
      formsByRow[i] = pickFormRefs(out, row);
    } catch (e) {
      console.error('[Legal] 조문 발췌 실패:', row.law, row.article, e && e.message);
    }
  }));
  // 같은 서식이 여러 조문에 걸리는 일이 흔하다(같은 법의 제10조·제11조가 같은 신고서를 부른다) —
  // 법+계층+열쇠로 한 번만 남긴다. 처음 나온 자리(=답변이 먼저 인용한 조문)의 순서를 지킨다.
  const seen = new Set();
  const forms = [];
  for (const list of formsByRow) {
    for (const f of list) {
      const k = f.law + '|' + f.tier + '|' + f.key;
      if (seen.has(k)) continue;
      seen.add(k);
      forms.push(f);
    }
  }
  return forms.slice(0, MAX_FORMS);
}

/**
 * 서식 제목에서 파일 첫 줄의 번호 꼬리표를 걷어내 **사람이 읽는 이름**만 남긴다.
 * 제목이 두 갈래로 들어오기 때문이다(article_text.resolveRefs 실측):
 *  - kind='text' → 파일 첫 줄에서 온 `서식11 — 낚시어선업 신고서`
 *  - kind='link' → `_links.json` 의 `제목` 인 `낚시어선업 신고서`
 * 예: formTitleOf('서식11 — 낚시어선업 신고서') → '낚시어선업 신고서'
 *     formTitleOf('서식13 — 삭제 &lt;1999.5.13&gt;') → '삭제 &lt;1999.5.13&gt;'(→ 폐지로 걸러진다)
 * @param {string} title - refs 항목의 title
 * @returns {string} 번호 꼬리표를 뗀 제목(없으면 '')
 * [연계] ← pickFormRefs(). 지어내지 않는다 — 원문 글자에서 접두사만 뗀다.
 */
function formTitleOf(title) {
  return String(title || '').replace(/^(?:서식|별표)\s*\d+(?:의\d+)?\s*[—–-]\s*/, '').trim();
}

/**
 * `loadArticle()` 응답의 `refs` 에서 **다운로드할 수 있는 별지 서식만** 골라낸다.
 * ★환각 0: 서식 정보를 새로 찾지 않는다 — 이미 조문 원문을 읽으며 판정해 둔 refs 를 거를 뿐이다
 *   (예전에는 이 refs 를 통째로 버리고 발췌만 꺼내 썼다).
 * 거르는 조건 세 가지:
 *   ①열쇠가 `서식`으로 시작(별표·이미지는 조문 팝업 안에서 이미 볼 수 있어 여기 싣지 않는다)
 *   ②law.go.kr 원본 파일 주소(hwp 또는 pdf)가 실제로 있다 — 없으면 누를 게 없다
 *   ③**폐지·이관 서식 제외** — 제목이 `삭제`로 시작하거나 `으로 이동`을 포함하면 버린다("폐지된
 *     신고서를 받아가라"·"엉뚱한 안내문을 신고서로 받아가라"가 되기 때문. 폐지 117건은
 *     form_download_survey.md §3-2, 이관 6건은 적대검증 발견 1(2026-08-17, 농수산물품질관리법
 *     시행규칙 서식43 "[별지 제11호의2서식]으로 이동 &lt;2013.3.24&gt;"로 실측 재현)
 * 예: pickFormRefs({refs:[{key:'서식11', title:'낚시어선업 신고서', hwp:'https://…'}]}, row)
 *     → [{law:'낚시 관리 및 육성법 시행규칙', tier:'rule', article:'제12조', key:'서식11',
 *         title:'낚시어선업 신고서', hwp:'https://…', pdf:''}]
 * @param {object} out - articleText.loadArticle() 응답(refs 를 가진 객체)
 * @param {object} row - 그 원문을 읽게 한 인용사슬 줄(law·tier·article 를 여기서 가져온다)
 * @returns {Array<object>} 서식 목록(없으면 빈 배열)
 * [연계] ← attachChainExcerpts(). → 응답의 `forms` → ai_chat.js renderFormDownloadsHTML.
 */
function pickFormRefs(out, row) {
  const refs = (out && Array.isArray(out.refs)) ? out.refs : [];
  const url = u => (/^https?:\/\//.test(String(u || '')) ? String(u) : '');
  const list = [];
  for (const r of refs) {
    if (!r || String(r.key || '').indexOf('서식') !== 0) continue;
    const hwp = url(r.hwp);
    const pdf = url(r.pdf);
    if (!hwp && !pdf) continue;
    const title = formTitleOf(r.title);
    if (/^삭제|으로\s*이동/.test(title)) continue;
    list.push({
      law: String(row.law || ''), tier: String(row.tier || ''),
      article: String(row.citedArticle || row.article || ''),
      key: String(r.key), title, hwp, pdf,
    });
  }
  return list;
}

// ── 답변 인용 기반 근거 카드 폴백(B11) ────────────────────────────────────────
// 화면의 근거 목록은 위키 페이지의 `## 근거 조문` 표에서만 만들어진다 — 그 표가 없는 페이지가
// 최상위 근거가 되면 **근거 아코디언이 통째로 사라지고**, 본문 조문 팝업(링크를 근거 줄의 법
// 정보로 건다)·시행일자까지 함께 사라진다(2026-08-17 사용자 실기기 실측: 「유선 및 도선 사업법
// 시행규칙」 제7조·별표1을 정확히 인용한 답변인데 근거 0줄 — statutes 74개 파일에 그 표가 없다).
// 위키 데이터가 채워지길 기다리는 것만으로는 같은 사고가 다른 곳에서 또 나므로 코드로 막는다.
// ★환각 0이 이 폴백의 전제다: 답변에 **문자 그대로 있는 표기**(legal_retriever.extractAnswerCitations)
//   만 후보로 삼고, 그중 `article_text.loadArticle()`이 **원문에서 실제로 찾아낸 것만** 카드가 된다.
//   조회 실패(ok:false·토큰 없음·별표 원문 없음)는 카드를 만들지 않는다 — 지어낸 근거가 화면에
//   뜨는 것이 근거가 안 뜨는 것보다 훨씬 나쁘다.
const SYNTH_MAX_CONCURRENCY = 4;   // 원문 조회 동시 상한(답변 대기시간이 눈에 띄게 늘지 않게)

/**
 * 답변이 인용했는데 위키 기반 목록에 없는 조문을 **원문으로 확인해** 근거 카드로 만든다.
 * 후보는 최대 legal_retriever.SYNTH_CANDIDATE_MAX(6)건, 원문 조회는 동시 SYNTH_MAX_CONCURRENCY(4)건.
 * ⚠ 카드로 인정하는 조회 결과는 두 가지뿐이다:
 *   - `single`(조 하나) — 그 조 블록을 원문에서 찾았다는 뜻이다(못 찾으면 loadArticle 이 ok:false).
 *   - `annex`(별표) — 별표는 못 찾아도 ok:true 가 나오므로 **참조가 하나라도 missing 이면 버린다**.
 *   `range`·`whole`은 여기서 나올 수 없다(후보 표기가 조 하나 또는 별표 하나뿐이라) — 혹시 나오면
 *   "어느 조가 근거인지" 단정할 수 없으므로 버린다.
 * ⚠ `gist`(요지)는 **빈 문자열**이다 — 위키가 사람 손으로 적어둔 요약이 근거지, 우리가 지어낼 것이
 *   아니다. 대신 원문 발췌(excerpt)를 위키 줄과 같은 방식(pickExcerpt)으로 붙인다.
 * 예: synthesizeChainRows('「유선 및 도선 사업법 시행규칙」 제7조에 따라 …', [])
 *     → [{law:'유선 및 도선 사업법 시행규칙', article:'제7조', citedArticle:'제7조', tier:'rule',
 *         effectiveDate:'2026-…', baseLaw:'유선 및 도선 사업법', contact:{…}, gist:'', synthesized:true}]
 * @param {string} answerText - 답변 전체 문장
 * @param {Array} rows - mergeCitationChains 를 지난 위키 기반 줄들
 * @returns {Promise<Array>} 보탤 카드(하나도 확인 못 하면 [])
 * [연계] ← POST /api/legal/ask(dropRedundantChainRows·groupCitationChainByFlow 직전).
 *          → services/article_text.js loadArticle() · legal_retriever.missingAnswerCitations/lookupContact.
 */
/**
 * 답변 본문에 `「법령명」 제N조` 꼴로 적힌 인용에서 **링크에 필요한 법 정보만** 추려 낸다.
 * 화면이 본문 조문을 눌러 원문 팝업을 열 때 쓰는 폴백 재료다(하이브리드 링크의 ②단계).
 * 예: answerCiteLaws('「어선법」 제13조에 따라 …') → [{law:'어선법', tier:'law', base:'어선법'}]
 * ★환각 0: 새로 만들지 않는다 — extractAnswerCitations 가 **답변 글자 그대로** 뽑고
 *   resolveAnswerLaw 가 **우리가 raw 를 가진 법인지 확인**한 것만 나온다(둘 다 기존 함수).
 * ⚠조문 번호는 담지 않는다 — 화면은 본문에 적힌 표기를 그대로 쓰고, 여기서는 "그 법이 무엇이며
 *   어느 폴더에서 읽어야 하는가"만 알려주면 된다(citationChain 의 law·tier·baseLaw 와 같은 역할).
 * @param {string} answerText - 완성된 답변 전체 문장
 * @returns {Array<{law:string, tier:string, base:string}>} 법령명 기준 중복 제거
 * [연계] ← POST /api/legal/ask. → done 응답의 citeLaws → ai_chat.js resolveCiteLaw(폴백).
 */
function answerCiteLaws(answerText) {
  const out = [];
  const seen = new Set();
  try {
    for (const c of legalRetriever.extractAnswerCitations(answerText)) {
      if (!c || !c.law || seen.has(c.law)) continue;
      seen.add(c.law);
      // 연락처도 함께 — 화면이 본문 링크를 눌러 연 조문 팝업에 소관부서를 보여준다(2026-08-18).
      out.push({ law: c.law, tier: c.tier || 'law', base: c.baseLaw || '',
        contact: legalRetriever.lookupContact(c.law) || null });
    }
  } catch (e) { console.error('[Legal] 본문 링크용 법 목록 실패:', e && e.message); }
  return out;
}

async function synthesizeChainRows(answerText, rows) {
  const want = legalRetriever.missingAnswerCitations(answerText, rows);
  if (!want.length) return [];
  const out = new Array(want.length).fill(null);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= want.length) return;
      const c = want[i];
      try {
        const res = await articleText.loadArticle({
          law: c.law, article: c.article, tier: c.tier, baseLaw: c.baseLaw,
        });
        if (!res || res.ok !== true) continue;                       // 원문에 없다 — 카드 없음
        if (res.mode !== 'single' && res.mode !== 'annex') continue;
        if (res.mode === 'annex') {
          const refs = Array.isArray(res.refs) ? res.refs : [];
          if (!refs.length || refs.some(r => r && r.kind === 'missing')) continue;
        }
        const row = {
          law: c.law, article: c.article, citedArticle: c.article, tier: c.tier,
          effectiveDate: res.effectiveDate || '', gist: '', step: '',
          baseLaw: c.baseLaw, subject: '',
          contact: legalRetriever.lookupContact(c.law),
          synthesized: true,                                          // 출처 구분용(화면 스키마는 그대로)
        };
        const ex = pickExcerpt(res);
        if (ex) row.excerpt = ex;
        out[i] = row;
      } catch (e) {
        console.error('[Legal] 인용 카드 확인 실패:', c.law, c.article, e && e.message);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SYNTH_MAX_CONCURRENCY, want.length) }, worker));
  return out.filter(Boolean);
}

// POST /api/legal/ask — { query } → 하이브리드 검색(legal_retriever) + Gemini 답변 스트리밍 합성
//   응답은 NDJSON(줄바꿈으로 구분된 JSON) 스트림: 답변 조각마다 {type:'delta',text}, 마지막에
//   {type:'done', ok, query, canonicalOnly, answer(전체 텍스트), sources, citationChain, forms, note} 한 줄로 마감.
//   forms = 근거 조문에 딸린 **별지 서식 다운로드 목록**(pickFormRefs — {law,tier,article,key,title,hwp,pdf}).
//     최대 MAX_FORMS 개, 폐지(삭제) 서식 제외. 서식이 없으면 빈 배열이고 화면은 아무것도 그리지 않는다.
//   citationChain = 답변이 실제로 인용한 근거 조문 줄을 **모든 소스에서 합쳐 하나로** 정렬한 목록
//   (줄 모양: {law, article, effectiveDate, gist, step, tier, contact, baseLaw, excerpt?,
//              citedArticle, subject, synthesized?}).
//   · citedArticle(계약1) = 답변 문장이 그 줄을 인용할 때 **실제로 쓴 표기 전체**(항·호 포함,
//     예 `제58조제5항제7호`). 답변에 항·호가 없으면 ''. ★답변 문장에 문자 그대로 있는 표기만 담는다.
//   · subject(계약1b) = 답변이 주체별로 나뉠 때 그 줄이 속한 주체 라벨(예 `어선소유자`). 판정이
//     불분명하면 ''(화면은 지금처럼 한 줄기로 그린다) — 틀리게 나누느니 안 나눈다.
//   · 위키 표가 여러 조를 묶어 적은 행(`제52~55·57조`)은 **답변이 인용한 조마다 자기 줄**로 쪼개져
//     나온다(article 만 그 조로 좁히고 나머지 칸은 원본 그대로 물려받는다).
//   · synthesized(B11) = 위키 `## 근거 조문` 표가 아니라 **답변 인용 + 원문 확인**으로 보탠 줄이라는
//     표시(true 인 줄만). 그런 줄의 gist 는 항상 ''(위키 요지가 없으므로 지어내지 않는다) —
//     화면 스키마는 종전 그대로라 ai_chat.js 는 이 필드를 몰라도 똑같이 그린다.
//   되묻기가 필요한 질문이면 delta 없이 done 한 줄만 나가고 clarify:{question,options} 가 함께 실린다.
//   되묻기 선택지 맨 끝에는 항상 `잘 모르겠어요`(act:'unknown', ctx.unk)가 붙는다 — 누르면 질의는
//   그대로 두고 ctx 만 실어 다시 오고, 서버가 용어 풀이 + 갈래 한 줄 요약을 붙여 같은 선택지를 다시 낸다.
//   ⚠ 실제 생성시간은 그대로다(모델 사고+글자수는 안 줄어듦) — 목적은 체감 대기시간 단축뿐.
//   추가 바디(선택): deviceId(기기 식별자) · notifyOnComplete(답변완료 푸시 동의, 기본 false)
//   → 둘 다 있고 6초를 넘게 걸렸으면, 스트림은 그대로 두고 답변을 임시 보관 + 개인 푸시 발송.
//   lastQuestion(선택, H-37 최소 절충안): 클라이언트가 매 요청에 싣는 직전 질문 원문 — ctx와
//   무관해 새 질문 타이핑에도 안 비워진다. decideClarify가 이미 애매해 되물을 때만 "방금 그거예요?"
//   확인 후보 하나를 더 보여주는 데만 쓴다(답을 대신 짓지 않는다).
// [Codex 개발자 모드] VM 작업자 창구 — NRYA_CODEX_SECRET 이 없으면 404, 열쇠가 틀리면 401.
//   설계: services/codex_client.design.md · 작업자: scripts/codex_worker.js
router.post('/api/legal/codex/poll', codexBridge.poll);
router.post('/api/legal/codex/result', codexBridge.result);

// codexBridge.withRequest: 서버 스위치·관리자 센터 설정(answerModel·codexForUsers)·관리자 토큰·llm 을 보고
//   이 요청의 AI 호출을 VM 의 Codex 로 돌릴지 정한다. 결정 순서는 그 함수 주석 참고.
//   설정이 기본(codexForUsers 꺼짐)이면 일반 사용자 요청은 아무것도 안 하고 넘긴다(평소 응답과 바이트 동일).
router.post('/api/legal/ask', (req, res, next) => codexBridge.withRequest(req, res, next, normConfig(readConfig())), async (req, res) => {
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
  // ★[대화 기억, 2026-08-18 사용자 확정] "🔁 관련해서 더 궁금해요"로 이어 물을 때 앱이 실어 보내는
  //   **직전까지의 대화 전체**([{q,a}, …]). 주제 낱말 하나(ctx.topic)만으로는 AI가 확신하지 못해
  //   방금 한 얘기를 또 되물었기 때문이다(사용자 재현).
  //   ⚠**질의 문자열에 절대 합치지 않는다**(설계 §2.1 R2) — 되묻기 판단·답변 합성에 참고 자료로만
  //     간다. 검색은 지금 질문으로만 한다(직전 질문을 질의에 이어붙였다가 "절차·방법·요건" 같은
  //     일반어로 검색이 오염된 사고가 2026-08-18 오전에 있었다).
  //   ⚠**어떤 파일에도 쓰지 않는다**(설계 §3.3 R1 — ctx·profile 과 같은 규약). 로그도 남기지 않는다.
  //   없으면 아래 전 경로가 no-op 이라 응답이 오늘과 바이트 동일하다(R0).
  const history = legalRetriever.normalizeHistory(req.body && req.body.history);
  // 이 요청이 끝난 뒤 [허용]으로 뒤늦게 동의할 수 있게 등록해둔다(POST /api/legal/notify-me 참고).
  if (askId && deviceId) inFlightAsks.set(askId, { deviceId, wantsPush: false });

  const cfg = normConfig(readConfig());
  const canonicalOnly = cfg.answerCanonicalOnly;
  // ★AI 단계가 조용히 빠진 것을 응답에 남긴다(2026-08-20). 질의확장·되묻기 판단은 실패해도 빈
  //   결과로 폴백해 "필요 없었던 것"과 구분되지 않았고, 그 탓에 같은 질문이 회차마다 다른 길로
  //   갔다(라이브 검증 5·6·7차에서 62문항 중 26건이 판정 뒤집힘).
  //   ⚠요청마다 새 배열을 만든다 — 모듈 전역에 두면 동시 요청끼리 섞인다.
  //   ⚠아래 done 이벤트들보다 **먼저** 선언해야 한다(이른 반환 경로에서도 쓰인다).
  const aiDiag = [];
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
    res.write(JSON.stringify(withCtxNext({ type: 'done', ok: true, query: q, canonicalOnly, ...(aiDiag.length ? { aiDiag } : {}),
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
      const done = { type: 'done', ok: true, query: q, canonicalOnly, ...(aiDiag.length ? { aiDiag } : {}),
        answer: legalRetriever.withAssumedNotice(zone.answer, assumed),
        sources: [], citationChain: [], note: zone.note };
      if (zone.clarify) done.clarify = zone.clarify;
      res.write(JSON.stringify(withCtxNext(done)) + '\n');
      res.end();
      if (askId) inFlightAsks.delete(askId);
      return;
    }

    // [4-6] 쪼개진 법을 **옛 이름으로** 물었으면 어느 쪽인지 되묻는다 (2026-09-26, 사장님 확정 ⓐ).
    //   ★zoneTreeStep 과 **같은 자리·같은 반환 꼴**이라 같은 후처리로 나간다.
    //   ★decideClarify(모델 판단) **앞**에 둔다 — 결정론적이라 매번 같은 답이 나오고 스위트로 잠글 수 있다.
    //   좁게 발동한다: 옛 이름을 **홀로** 쓴 물음에만(새 이름을 썼으면 사용자가 이미 고른 것이다).
    //   실측: 골든 291문항 중 옛 이름을 홀로 쓴 문항 **0건** ⇒ 판정 퇴보 위험 0.
    //   ⚠되묻기 라운드 카운터를 **여기서도 올린다** — 안 올리면 상한(CLARIFY_MAX_ROUNDS)이 이 경로를
    //     안 세어 사용자가 더 오래 갇힌다(2026-09-26 L-8 측정에서 카운터가 한 칸 뒤처지는 것을 겪었다).
    const split = legalRetriever.splitLawStep(q);
    if (split) {
      ctx.cl = { q: split.clarify.question,
        labels: split.clarify.options.map(o => o.label), n: clarifyRoundNext(ctx) };
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      if (res.flushHeaders) res.flushHeaders();
      res.write(JSON.stringify(withCtxNext({ type: 'done', ok: true, query: q, canonicalOnly,
        answer: legalRetriever.withAssumedNotice(split.answer, assumed),
        sources: [], citationChain: [], note: split.note, clarify: split.clarify })) + '\n');
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
    // [이어서 질문] 직전 답변의 주제도 **검색 확장어로만** 넘긴다(질의 문자열엔 안 합친다).
    //   "🔁 관련해서 더 궁금해요"를 누른 다음 질문에서만 값이 있다(ctx.topic).
    const searchOpts = { canonicalOnly, diag: aiDiag };
    if (ucRestate) searchOpts.restate = ucRestate;
    if (ctx.topic) searchOpts.topic = ctx.topic;
    const { sources, contextPages } = await legalRetriever.search(qForSearch, searchOpts);

    // ② [H-37 §5] 상황질문(범위좁히기) — 검색 결과가 여러 선박종류 계열에 걸칠 때만, **법 이름이
    //    아니라 상황**("어떤 배에 관한 것인가요?")을 자산 라벨 그대로 묻는다. 스위치 off면 null.
    //    ★zoneTreeStep 이 null 일 때만 시도한다(위에서 이미 return 됐다) — 순서를 지켜야 H-36
    //      파일럿이 검증한 트리 경로가 오늘과 100% 같다(설계 §3.4).
    //   ★직전 라운드의 되묻기(ctx.cl)를 함께 넘긴다 — 같은 상황질문을 두 번 묻지 않게 한다.
    const scope = legalRetriever.scopeNarrowStep(q, ctx.scope, sources, cfg.scopeNarrow, ctx.cl);
    if (scope) {
      // AI 되묻기와 같은 규약으로 이번 질문을 ctx 에 남긴다 — 다음 라운드가 "또 같은 걸 묻는지"
      // 판정할 유일한 근거다. 안 남기면 사용자가 직접 입력으로 답했을 때 빠져나올 길이 없다.
      ctx.cl = { q: scope.clarify.question, labels: (scope.clarify.options || []).map(o => o.label), n: clarifyRoundNext(ctx) };
      return writeConfirm(scope);
    }
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
      ctx.cl = { q: unk.clarify.question, labels: unk.clarify.options.map(o => o.label), n: clarifyRoundNext(ctx) };
      return writeConfirm(unk);
    }

    // [B6] 직전 라운드의 되묻기(ctx.cl)를 함께 넘긴다 — 모델이 표현만 바꿔 같은 걸 다시 물으면
    //   (라벨 완전일치 대조로는 안 잡힌다) 결정론적으로 버린다. ctx.cl 이 없으면 오늘과 동일(R0).
    const clarify = await legalRetriever.decideClarify(q, contextPages, ucRestate, narrowLabels, lastQuestion, ctx.cl, ctx.topic, history, aiDiag);

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
      ctx.cl = { q: clarify.question, labels: clarify.options.map(o => o.label), n: clarifyRoundNext(ctx) };
      res.write(JSON.stringify(withCtxNext({ type: 'done', ok: true, query: q, canonicalOnly, ...(aiDiag.length ? { aiDiag } : {}),
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
        for await (const chunk of legalRetriever.synthesizeAnswerStream(q, contextPages, history)) {
          full += chunk; synth += chunk;
          res.write(JSON.stringify({ type: 'delta', text: chunk }) + '\n');
          if (res.flush) res.flush(); // compression() 버퍼를 즉시 내보내 실제로 조각조각 도착하게 함
        }
      } catch (e) { streamError = e; }
    }

    // ★규약 5-7 — `해석주의` 플래그가 붙은 근거를 썼으면 **참고 한 줄을 자동으로 붙인다**
    //   (`_CHATBOT.md` 5-7, 사용자 확정 2026-07-18). 모델에게 맡기지 않는다 — 규약이
    //   "플래그가 있으면 붙인다"고 정한 것이라 확률에 맡길 일이 아니다.
    //   ASSUMED_NOTICE 와 **같은 방식**으로 델타로도 내보낸다(위 1748행 참고) — 그래야
    //   스트리밍 중 화면과 최종 렌더(`ai_chat.js` 가 done 의 `answer` 로 다시 그린다)가 같다.
    //   답이 한 글자도 안 나온 경우(스트림 실패)에는 붙일 답 자체가 없어 건너뛴다.
    if (synth.trim().length > 0) {
      const caselawTail = legalRetriever.caselawNoticeFor(contextPages, full);
      if (caselawTail) {
        full += caselawTail;
        res.write(JSON.stringify({ type: 'delta', text: caselawTail }) + '\n');
        if (res.flush) res.flush();
      }
    }

    // [답변 AI 표시 · 2026-09-27 사용자 요청] 답이 실제로 나왔으면 **맨 끝**에 어느 AI 가 답했는지 한 줄.
    //   위 참고 한 줄과 같은 방식(델타로도 보내 화면과 done.answer 가 같게). 답이 없으면 붙이지 않는다.
    if (synth.trim().length > 0) {
      const aiTail = codexBridge.answerLabel(legalRetriever.ANSWER_MODEL);
      full += aiTail;
      res.write(JSON.stringify({ type: 'delta', text: aiTail }) + '\n');
      if (res.flush) res.flush();
    }

    const usedGemini = synth.trim().length > 0;
    // L-57 조치③: 답변이 실제로 나온 경우에만 sourcesOut을 답변 인용 여부로 교차확인해 좁힌다
    // (스트림 실패로 답변이 없으면 교차확인할 대상이 없어 후보를 그대로 반환).
    const finalSources = !contextPages.length ? []
      : (usedGemini ? legalRetriever.filterSourcesByAnswer(sources, full) : sources);
    // citationChain도 소스와 같은 방식으로 답변 문장과 대조해 무관한 줄을 뺀다(legal_retriever.js
    // filterCitationChainByAnswer 참고 — 소스가 통과해도 그 안 표 9줄이 통째로 딸려나오던 문제).
    let citationChain = [];
    // 근거 조문에 딸린 별지 서식(신고서·신청서) 다운로드 목록 — 아래 attachChainExcerpts 가 채운다.
    // 근거 줄이 없거나(되묻기 등) 서식이 안 걸리면 빈 배열이고, 그때 화면은 아무것도 그리지 않는다.
    let forms = [];
    // [하이브리드 링크, 2026-08-18 사용자 확정] 답변 본문의 조문 인용을 눌러볼 수 있게 하는 데
    //   쓰는 "링크 가능한 법" 목록. 화면(ai_chat.js resolveCiteLaw)은 지금까지 **근거 목록에 있는
    //   법만** 링크했는데, 그러면 답변에 「법령명」 제N조라고 완전한 주소가 적혀 있어도 그 법이
    //   근거 목록에 없으면 링크를 포기했다(사용자 지적: "정확한 주소가 있는데 왜 못 찾나").
    //   ⚠추가 비용 없음: extractAnswerCitations 는 아래 B11 폴백이 이미 매 답변마다 부르는
    //     함수이고(0.04ms 실측), 원문이 있는 법인지까지 확인해 돌려준다(환각 0 그대로).
    //   ⚠우선순위는 화면이 정한다 — 근거 목록(위키가 검증한 tier·baseLaw)이 먼저, 여기 값은 폴백.
    let citeLaws = [];
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
      const wikiRows = mergeCitationChains(finalSources);
      // [B11] 답변이 인용했는데 위 목록에 없는 조문을 **원문으로 확인해** 카드로 보탠다(위키
      //   `## 근거 조문` 표가 없는 페이지가 근거일 때 아코디언이 통째로 사라지던 구멍).
      //   ⚠ 실패는 조용히 — 이 단계가 죽어도 기존 답변 흐름은 그대로 나간다(기존 폴백 규약과 동일).
      //   ⚠ 보탠 줄은 **위키 줄 뒤에** 붙인다. 그다음 정리·정렬은 기존 두 함수를 그대로 통과시켜
      //     중복 제거·흐름 순서 규칙이 보탠 줄에도 똑같이 적용되게 한다.
      let synthRows = [];
      try { synthRows = await synthesizeChainRows(full, wikiRows); }
      catch (e) { console.error('[Legal] 인용 근거 폴백 실패:', e && e.message); }
      // ⚠총괄 행(`제58조`)과 항·호 행(`제58조제5항제7호`)이 함께 살아남아 같은 조문이 요지만 다르게
      //   두 번 뜨는 것을 막는다(P0 선행 실측). 근거(citedArticle)가 같은 줄에만 적용된다.
      citationChain = legalRetriever.groupCitationChainByFlow(
        legalRetriever.dropRedundantChainRows(wikiRows.concat(synthRows)), full);
      // 살아남은 줄에만 조문 원문 발췌를 붙인다(거르기 전에 붙이면 버려질 줄까지 원문을 읽는다).
      forms = await attachChainExcerpts(citationChain);
      citeLaws = answerCiteLaws(full);
      // [이어서 질문] 이 답변의 **주제**를 ctx 에 남긴다 — "🔁 관련해서 더 궁금해요"를 누르면
      //   다음 질문의 검색 확장어로만 쓰인다(질의 문자열엔 안 합친다).
      //   무엇을 주제로 삼나: 답변이 **가장 먼저 인용한 근거 줄이 실려 있던 위키 페이지의 주제**
      //   (예: `낚시어선업신고`). 페이지 주제가 비면 그 줄의 법 이름으로 대신한다.
      //   ★지어내지 않는다 — 이미 검증된 근거 줄에서 그대로 가져올 뿐이고, 없으면 안 싣는다.
      const head = citationChain[0];
      if (head) {
        const src = finalSources.find(x => x && x.law === head.baseLaw) || finalSources[0];
        ctx.topic = String((src && src.topic) || head.law || '').slice(0, 60);
      }
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
        res.write(JSON.stringify(withCtxNext({ type: 'done', ok: true, query: q, canonicalOnly, ...(aiDiag.length ? { aiDiag } : {}),
          answer: nu.answer, sources: [], citationChain: [],
          note: '이 질문에 맞는 근거를 위키에서 찾지 못했습니다.' })) + '\n');
        res.end();
        if (askId) inFlightAsks.delete(askId);
        return;
      }
    }

    let answer, sourcesOut, note;
    if (raw && raw.answer) {
      answer = legalRetriever.withAssumedNotice(raw.answer, assumed)    // [H-37 §4.4] 2차 조회 경로에도 붙인다
        + codexBridge.answerLabel(legalRetriever.ANSWER_MODEL);          // [답변 AI 표시] 2차 원문 답변도 AI 가 쓴 것
      sourcesOut = [];
      // 2차(원문 직독) 답변은 위키 근거 조문 표를 쓰지 않았다 — 1차에서 만들다 만 인용사슬을 그대로
      // 딸려 보내면 이 답변의 근거인 척 붙는다(환각 0). sources와 같이 비운다.
      citationChain = [];
      forms = [];                                                       // 근거를 비웠으니 그 근거에 딸렸던 서식도 함께 비운다
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
    res.write(JSON.stringify(withCtxNext({ type: 'done', ok: true, query: q, canonicalOnly, ...(aiDiag.length ? { aiDiag } : {}),
      answer, sources: sourcesOut, citationChain, forms, citeLaws, note })) + '\n');
    res.end();

    // [답변완료 푸시] 스트림은 위에서 이미 평소대로 끝냈다 — 여기부터는 부가 동작이라
    //   기존 응답 흐름에 아무 영향이 없다(실패해도 사용자는 화면에서 답을 이미 봤다).
    //   6초 이하로 빨리 끝난 질문은 보내지 않는다(옵트인해도 매번 울리지 않게).
    //   자체 try 로 감싼다 — 여기서 던지면 바깥 catch 가 이미 끝난 응답에 또 쓰려다 죽는다.
    try {
      const askedMidway = askId && inFlightAsks.has(askId) && inFlightAsks.get(askId).wantsPush;
      const slow = (Date.now() - startedAt) > NOTIFY_MIN_ELAPSED_MS;
      // ★2026-08-18(사용자 지적): **보관 조건과 푸시 조건을 갈랐다.**
      //   보관은 오래 걸린 답변이면 무조건 한다 — 답을 기다리는 중에 앱을 백그라운드로 내리면
      //   연결이 끊겨 앱이 답을 못 받는데, 서버는 이미 다 만들어 놨다. 앱이 다시 앞으로 나왔을 때
      //   이 보관본을 그대로 가져가면 **AI를 다시 부르지 않고** 화면을 되살릴 수 있다(비용 0).
      //   푸시는 예전 그대로 **알림에 동의한 기기에만** 보낸다(동의 없이 알림이 가지 않는다).
      //   ⚠ **주제 한 낱말만** 함께 보관한다 — 안 담으면 되찾아온 답변에서만 "🔁 관련해서 더
      //     궁금해요"가 빈손이 되어 이어 물으면 무관한 법이 나온다(사용자 재현). 다만 맥락(ctx)
      //     **전체**는 담지 않는다: 거기엔 프로필로 확정한 축과 사용자가 고른 조건이 들어 있고,
      //     서버는 그것을 어떤 파일에도 쓰지 않는다(설계 §3.3 R1). 나머지 축은 기기 안 기록이 든다.
      if (answer && slow) {
        const requestId = pendingAnswers.store(q, answer, sourcesOut, note, citationChain, forms, citeLaws,
          ctx.topic, askId);
        if ((notifyOnComplete || askedMidway) && deviceId) {
          sendAiAnswerPush(deviceId, requestId).catch(e => console.error('[Legal] 답변완료 푸시 실패:', e && e.message));
        }
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

// ── 법령 약칭표(읽기전용, 계약4) ─────────────────────────────────────────────
// 답변 본문의 조문에 링크를 걸려면 화면이 "이 조문이 어느 법의 것인지"를 문장에서 찾아내야 하는데,
// 사용자·모델이 「어선안전조업법」처럼 약칭을 쓰면 위키의 정식 명칭과 글자가 안 맞는다. 그 대응표를
// 그대로 내려준다: {ok:true, map:{약칭: 정식명}}.
//   · **모호하지 않은 약칭만** 담는다 — 표의 `충돌` 목록에 오른 약칭, 한 약칭이 여러 정식명에 붙은
//     경우, 약칭이 다른 법의 정식명과 같은 경우는 뺀다(legal_retriever.loadLawAliases).
//     ⚠ 지금 표는 충돌 0건이지만 자동 갱신에서 생길 수 있어 이 제외 로직은 그대로 유지한다.
//   · 시행령·시행규칙 파생 항목(`어선안전조업법 시행령`)도 그대로 담는다 — 빼면 화면이 꼬리를
//     스스로 분리하는 폴백으로만 처리하게 돼 시행령·시행규칙 인용 링크가 약해진다.
//   · 파일이 없거나 깨져 있으면 {ok:true, map:{}} — 화면은 링크만 안 걸고 평소대로 동작한다.
// 캐시는 legal_retriever 쪽 mtime 감지 캐시를 그대로 쓴다(서버 기동 시 1회 로드 + 파일 변경 시 갱신).
router.get('/api/legal/aliases', (req, res) => {
  try {
    const map = {};
    for (const [alias, formal] of legalRetriever.loadLawAliases().alias) map[alias] = formal;
    res.json({ ok: true, map });
  } catch (e) {
    console.error('[Legal] 약칭표 조회 실패:', e && e.message);
    res.json({ ok: true, map: {} });
  }
});

// ── 조문 원문 팝업(읽기전용): 답변카드의 조문 카드를 누르면 그 조 전체 원문을 항·호로 쪼개 준다 ──
// 원문은 서버에 상주시키지 않고 GitHub에서 그때그때 읽는다(services/article_text.js).
// 못 찾으면 지어내지 않고 {ok:false, reason} — 클라이언트는 "원문을 불러오지 못했어요"로 안내한다.
router.get('/api/legal/article-text', async (req, res) => {
  try {
    const q = req.query || {};
    // ⚠ `article`(항·호까지 포함한 표기)은 **그대로** 넘긴다 — 라우트에서 항·호를 깎으면 응답의
    //   focused 판정(계약2)이 성립하지 않는다. 응답도 통째로 그대로 통과시킨다(addenda 등 계약3).
    const out = await articleText.loadArticle({
      law: q.law, article: q.article, tier: q.tier, baseLaw: q.baseLaw,
    });
    res.json(out);
  } catch (e) {
    console.error('[Legal] 조문 원문 조회 실패:', e && e.message);
    res.json({ ok: false, reason: 'error' });
  }
});

// ============================================================================
// 지식 방(관리자 콘솔 "지식 방" 화면) — 실데이터 통계·목록 API
// ----------------------------------------------------------------------------
// [왜 만들었나] 2026-09-09 이전의 지식 방 화면은 갈래 버튼 숫자도 아래 목록도 전부
//   client/js/ai-chat/ai_chat.js 의 ROOMS 상수(디자인 시안 복사본)였다. 실제와 크게
//   어긋나 있었고(위키개념 919↔963 · 비교허브 26↔49 · 별표서식 98↔199 · 그래프
//   88노드↔109노드), 특히 **시행일자가 실제 원문과 달라** 관리자가 원문 최신판을
//   오인할 수 있었다. 그래서 화면이 쓸 실데이터를 이 세 엔드포인트로 내려준다.
// [엔드포인트 셋을 이렇게 가른 이유]
//   · stats / list 를 하나로 합치지 않은 것 — 갈래 버튼 숫자는 방을 열 때 한 번만 필요하고,
//     목록은 쪽을 넘길 때마다 필요하다. 합치면 쪽을 넘길 때마다 6방 통계를 다시 센다.
//   · list 를 방마다 6개로 쪼개지 않은 것 — 여섯 방이 전부 같은 재료(index.json·graph.json·
//     raw 스캔)에서 나오고 쪽 계산·권한 게이트가 똑같다. 쪼개면 그 셈을 여섯 벌 두게 된다.
//   · law(원문 한 법의 아코디언 내용)만 따로 뗀 것 — 이건 목록과 재료가 다르다(.txt 머리말·
//     별표/_links.json·행정규칙 폴더). 목록에 미리 담으면 70법치를 매번 다 읽어야 한다.
// [데이터 출처]
//   · _dashboard/index.json  → 위키개념·법령·비교허브·별표서식 (legal_retriever.loadIndex 캐시 공유)
//   · wiki/graph.json        → 지식그래프 (mtime 캐시)
//   · raw/01~14 도메인의 <법> 폴더      → 원문 (프로세스 1회 스캔 캐시)
// ============================================================================

const GRAPH_JSON = path.join(LEGAL_DIR, 'wiki', 'graph.json');
const ROOM_PAGE_SIZE = 10;                 // 한 쪽에 10개(사용자 확정 2026-09-09)
const RAW_DOMAIN_RE = /^(0[1-9]|1[0-4])_/; // 기준법 도메인만(15_관련타부처·_자치법규 제외)
const RAW_TIERS = [                        // raw 법 폴더 바로 밑의 계층 원문(있는 것만 보여준다)
  { file: '법률.txt', label: '법률', ic: '법' },
  { file: '시행령.txt', label: '시행령', ic: '령' },
  { file: '시행규칙.txt', label: '시행규칙', ic: '칙' },
];
const BYL_TIER_SHORT = { 법률: '법', 시행령: '령', 시행규칙: '칙' };

// ── graph.json 캐시(mtime 감지) — loadIndex 와 같은 방식 ──
let _graphCache = null, _graphMtime = 0;
/**
 * wiki/graph.json 을 읽어 캐시한다(파일이 바뀌면 다시 읽는다).
 * 예: loadGraph().nodes.length → 109
 * @returns {{nodes:Array<{id:string,type:string,pages:number}>, edges:Array<{from:string,to:string,kind:string}>}}
 * [연계] → 지식그래프 방의 통계·노드 목록. loadIndex(legal_retriever)와 같은 mtime 캐시 관례.
 */
function loadGraph() {
  try {
    const mt = fs.statSync(GRAPH_JSON).mtimeMs;
    if (_graphCache && mt === _graphMtime) return _graphCache;
    const j = JSON.parse(fs.readFileSync(GRAPH_JSON, 'utf8'));
    _graphCache = { nodes: Array.isArray(j.nodes) ? j.nodes : [], edges: Array.isArray(j.edges) ? j.edges : [] };
    _graphMtime = mt;
  } catch (_) { if (!_graphCache) _graphCache = { nodes: [], edges: [] }; }
  return _graphCache;
}

/**
 * 파일 앞부분만 읽는다(큰 원문 전체를 메모리에 올리지 않기 위함).
 * 예: readHead('/…/법률.txt', 4096) → '제1장 총칙\n\n[제1조] 목적 (시행 20230628 · 일부개정)…'
 * @param {string} file - 절대 경로
 * @param {number} bytes - 읽을 바이트 수
 * @returns {string} UTF-8 문자열(끝이 잘려도 무해 — 찾는 표기는 전부 앞쪽에 있다)
 * [연계] ← effOfTxt/admrulHead. 원문 .txt 머리말에서 시행일·제목만 뽑는 데 쓴다.
 */
function readHead(file, bytes) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.slice(0, n).toString('utf8');
  } catch (_) { return ''; }
  finally { if (fd !== null) { try { fs.closeSync(fd); } catch (_) { /* 무시 */ } } }
}

/**
 * 법령 원문 .txt 의 **파일별 실제 시행일**을 머리말에서 읽는다.
 * 조문 머리표가 `[제1조] 목적 (시행 20230628 · 일부개정)` 꼴이고, 한 파일 안의 모든 조문이
 * 같은 날짜를 갖는다(70법 199개 파일 전수 확인, 섞인 파일 0개). 그래서 첫 표기를 쓴다.
 * ⚠ _meta.json 의 `시행일` 은 **법률 계층의 대표 시행일**이라 시행령·시행규칙에는 안 맞는다
 *   (예: 선박안전법 대표 20230628 / 시행령 20241112 / 시행규칙 20260727).
 * 예: effOfTxt('/…/시행령.txt') → { eff:'20241112', amd:'타법개정' }
 * @param {string} file - 원문 .txt 절대 경로
 * @returns {{eff:string, amd:string}} 못 읽으면 둘 다 '' — 화면은 "확인 안 됨"으로 둔다(지어내지 않음)
 * [연계] ← buildRawLaws(법 목록의 대표 시행일) · /api/legal/rooms/law(계층별 시행일).
 */
function effOfTxt(file) {
  const m = readHead(file, 8192).match(/\(시행\s*(\d{8})(?:\s*·\s*([^)]+))?\)/);
  return m ? { eff: m[1], amd: (m[2] || '').trim() } : { eff: '', amd: '' };
}

/**
 * 디렉터리 아래 .txt 파일 개수를 재귀로 센다(원문 보관량 표시용).
 * 예: countTxt('/…/raw/04_선박해운/선박안전법') → 992
 * @param {string} dir - 절대 경로
 * @returns {number}
 * [연계] ← buildRawLaws. 원문 방 인트로 칩의 "원문 N건".
 */
function countTxt(dir) {
  let n = 0;
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return 0; }
  for (const e of ents) {
    if (e.isDirectory()) n += countTxt(path.join(dir, e.name));
    else if (e.name.endsWith('.txt')) n++;
  }
  return n;
}

// ── raw 법 목록 캐시(프로세스 1회) ──
// raw/ 는 컨테이너 이미지에 통째로 구워져 배포되므로(Dockerfile `COPY . .`) 서버가 도는 동안
// 바뀌지 않는다. 재수집은 저장소에서 하고 재배포 = 프로세스 재기동이라 그때 다시 스캔된다.
let _rawLawsCache = null;
/**
 * raw/01~14 도메인의 <법> 폴더 을 훑어 기준법 목록을 만든다(프로세스 1회, 이후 캐시).
 * 각 법의 이름·소관부처는 `_meta.json`, **대표 시행일은 법률.txt 머리말**에서 읽는다.
 * 예: buildRawLaws().laws[0] → { name:'배타적 경제수역 및 대륙붕에 관한 법률',
 *      dir:'01_해양주권정책/배타적경제수역및대륙붕에관한법률', eff:'20170321' }
 * @returns {{laws:Array<object>, domains:number, txtFiles:number, related:number, local:number}}
 * [연계] ← /api/legal/rooms/stats · /api/legal/rooms/list?room=raw · /api/legal/rooms/law.
 */
function buildRawLaws() {
  if (_rawLawsCache) return _rawLawsCache;
  const laws = [];
  let txtFiles = 0;
  let doms = [];
  try { doms = fs.readdirSync(RAW_DIR).filter(d => RAW_DOMAIN_RE.test(d)).sort(); } catch (_) { doms = []; }
  for (const d of doms) {
    let names = [];
    try { names = fs.readdirSync(path.join(RAW_DIR, d), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort(); } catch (_) { names = []; }
    for (const n of names) {
      const abs = path.join(RAW_DIR, d, n);
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(abs, '_meta.json'), 'utf8')); } catch (_) { meta = {}; }
      const eff = effOfTxt(path.join(abs, '법률.txt')).eff;
      txtFiles += countTxt(abs);
      laws.push({
        name: String(meta['법령명'] || n),
        dir: d + '/' + n,
        domain: d,
        ministry: String(meta['소관부처'] || ''),
        eff,                                     // 법률.txt 머리말의 실제 시행일(없으면 '')
      });
    }
  }
  const countDirs = (sub) => {
    try { return fs.readdirSync(path.join(RAW_DIR, sub), { withFileTypes: true }).filter(e => e.isDirectory()).length; }
    catch (_) { return 0; }
  };
  _rawLawsCache = { laws, domains: doms.length, txtFiles, related: countDirs('15_관련타부처'), local: countDirs('_자치법규') };
  return _rawLawsCache;
}

/** raw/ 아래 상대경로를 브라우저가 열 수 있는 원본 링크로. @param {string} rel @returns {string} */
function srcUrl(rel) { return '/api/legal/src?p=' + encodeURIComponent(rel); }

/** law.go.kr 별표 링크가 상대경로로 적힌 파일이 있어 절대 URL로 만든다. @param {string} u @returns {string} */
function absLawUrl(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return s.startsWith('/') ? 'https://www.law.go.kr' + s : '';
}

/**
 * 이 장이 **다른 법과 이어진 수**를 센다. 갈래마다 셈이 다르다.
 *  · 법령 허브 : `links` 의 `statutes/…` — 다른 법 허브로 가는 실제 위키 링크.
 *  · 비교 허브 : `links` 가 가리키는 개념들의 **법 이름 가짓수**. 비교허브는 `statutes/` 링크가
 *               거의 없어(49장 중 48장이 0건, 2026-09-09 실측) 같은 셈을 쓰면 화면이 전부 0이 된다.
 * ⚠ `cited` 칸은 쓰지 않는다 — 실측 결과 법령 허브 74장 중 **15장이 자기 법 이름을 담고 있고**,
 *   '관련 개념'·'변경 이력' 같은 **문단 제목**을 비롯해 법령명이 아닌 항목 1,679종이 섞여 있다.
 *   즉 `cited.length` 는 "타법의 수"가 아니다(해상교통안전법: cited 11 중 자기 1 · 문단제목 2).
 * 예: crossLawCount(해상교통안전법 허브) → 8
 * @param {object} p - index.json 의 페이지 한 장
 * @returns {number}
 * [연계] ← pagesOf. → 화면의 '타법연결 N'(법령) · '다루는 법 N'(비교허브).
 */
function crossLawCount(p) {
  const links = (p.links || []).map(String);
  if (p.kind === 'statute') return links.filter(l => l.startsWith('statutes/')).length;
  const s = new Set();
  for (const l of links) {
    if (l.startsWith('statutes/')) s.add(l.slice('statutes/'.length).split('|')[0]);
    else if (l.includes('__') && !/^(annexes|comparisons)\//.test(l) && !l.startsWith('concept_')) s.add(l.split('__')[0]);
  }
  return s.size;
}

/**
 * index.json 페이지 배열에서 한 갈래(kind)만 뽑아 화면용 행으로 바꾼다.
 * 예: pagesOf('concept')[0] → { file:'갯벌…__갯벌관리구역지정및관리계획', title:'갯벌관리구역지정및관리계획',
 *      law:'갯벌 및 그 주변지역의 지속가능한 관리와 복원에 관한 법률', status:'canonical' }
 * @param {'concept'|'statute'|'comparison'|'annex'} kind
 * @returns {Array<object>} 법 이름 → 주제 순으로 정렬된 행
 * [연계] ← roomItems. → legalRetriever.loadIndex(mtime 캐시 공유).
 */
function pagesOf(kind) {
  const pages = (loadIndex().pages || []).filter(p => p.kind === kind);
  const conceptCount = {};
  if (kind === 'statute') {
    for (const p of (loadIndex().pages || [])) {
      if (p.kind === 'concept') conceptCount[p.law] = (conceptCount[p.law] || 0) + 1;
    }
  }
  return pages.map(p => {
    const row = {
      file: p.file,
      title: p.topic || p.law || p.file,
      law: p.law || '',
      status: p.status || '',
      penalty: !!p.penalty,
      xlaw: crossLawCount(p),
      links: (p.links || []).length,
      byls: (p.byls || []).length,
    };
    if (kind === 'statute') { row.title = p.law || p.file; row.concepts = conceptCount[p.law] || 0; }
    return row;
  }).sort((a, b) => (a.law || '').localeCompare(b.law || '', 'ko') || (a.title || '').localeCompare(b.title || '', 'ko'));
}

/**
 * 지식그래프 방의 목록 행 — 노드(법)마다 몇 갈래로 이어져 있는지 센다.
 * 예: graphItems()[0] → { title:'낚시 관리 및 육성법', pages:42, out:64, in:64, degree:128 }
 * @returns {Array<object>} 연결 많은 노드부터
 * [연계] ← roomItems. → loadGraph().
 */
function graphItems() {
  const g = loadGraph();
  const out = {}, inn = {};
  for (const e of g.edges) { out[e.from] = (out[e.from] || 0) + 1; inn[e.to] = (inn[e.to] || 0) + 1; }
  return g.nodes.map(n => ({
    title: n.id, pages: n.pages || 0,
    out: out[n.id] || 0, in: inn[n.id] || 0, degree: (out[n.id] || 0) + (inn[n.id] || 0),
  })).sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title, 'ko'));
}

/**
 * 방 이름(ASCII 키)에 해당하는 전체 목록을 만든다(쪽 나누기 전).
 * @param {string} room - raw|concept|statute|comparison|annex|graph
 * @returns {Array<object>|null} 모르는 방이면 null
 * [연계] ← GET /api/legal/rooms/list.
 */
function roomItems(room) {
  if (room === 'raw') return buildRawLaws().laws;
  if (room === 'graph') return graphItems();
  if (room === 'concept' || room === 'statute' || room === 'comparison' || room === 'annex') return pagesOf(room);
  return null;
}

// GET /api/legal/rooms/stats — 갈래 버튼 6개 숫자 + 인트로 카드 칩(개념 status·그래프 엣지 종류).
//   숫자는 전부 그 자리에서 센 값이다(상수 없음).
router.get('/api/legal/rooms/stats', adminAuth.requireAdminToken, (req, res) => {
  try {
    const pages = loadIndex().pages || [];
    const countBy = (kind, field) => {
      const o = {};
      for (const p of pages) if (p.kind === kind) o[p[field] || ''] = (o[p[field] || ''] || 0) + 1;
      return o;
    };
    const kindTotal = (kind) => pages.filter(p => p.kind === kind).length;
    const g = loadGraph();
    const edgeKinds = {};
    for (const e of g.edges) edgeKinds[e.kind] = (edgeKinds[e.kind] || 0) + 1;
    const raw = buildRawLaws();
    // 법령 허브 페이지가 74장인데 raw 기준법은 70개다. 그 차이를 74-70 으로 빼서 쓰지 않고
    // **이름 대조로** 센다(모든 기준법에 허브가 있다는 보장이 코드 어디에도 없기 때문).
    const rawNames = new Set(raw.laws.map(l => l.name));
    const statutePages = pages.filter(p => p.kind === 'statute');
    const inRaw = statutePages.filter(p => rawNames.has(p.law)).length;
    res.json({
      ok: true,
      raw: { laws: raw.laws.length, domains: raw.domains, txtFiles: raw.txtFiles, related: raw.related, local: raw.local },
      concept: { total: kindTotal('concept'), status: countBy('concept', 'status') },
      statute: { total: kindTotal('statute'), status: countBy('statute', 'status'), inRaw, notInRaw: statutePages.length - inRaw },
      comparison: { total: kindTotal('comparison'), status: countBy('comparison', 'status') },
      annex: { total: kindTotal('annex'), status: countBy('annex', 'status') },
      graph: { nodes: g.nodes.length, edges: g.edges.length, kinds: edgeKinds },
    });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// GET /api/legal/rooms/list?room=<raw|concept|statute|comparison|annex|graph>&page=<1부터>
//   한 쪽에 10개씩(ROOM_PAGE_SIZE). 범위를 벗어난 page 는 마지막 쪽으로 당긴다(빈 화면 방지).
router.get('/api/legal/rooms/list', adminAuth.requireAdminToken, (req, res) => {
  try {
    const room = String((req.query && req.query.room) || '').trim();
    const all = roomItems(room);
    if (!all) return res.status(400).json({ ok: false, error: '모르는 방: ' + room });
    const total = all.length;
    const pages = Math.max(1, Math.ceil(total / ROOM_PAGE_SIZE));
    let page = parseInt((req.query && req.query.page) || '1', 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (page > pages) page = pages;
    res.json({
      ok: true, room, page, pages, total, perPage: ROOM_PAGE_SIZE,
      items: all.slice((page - 1) * ROOM_PAGE_SIZE, page * ROOM_PAGE_SIZE),
    });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// GET /api/legal/rooms/law?dir=<도메인>/<법폴더> — 원문 방 아코디언 한 칸의 내용.
//   계층 원문(법률·시행령·시행규칙)의 **시행일은 각 .txt 머리말에서 읽은 실제 값**이고,
//   별표·별지 서식은 `별표/_links.json`(수집 당시의 제목·원본 링크), 고시는 `행정규칙/*.txt` 머리말이다.
//   ⚠ dir 은 캐시된 법 목록에 있는 값만 받는다(경로 이탈 차단 + 오타로 엉뚱한 폴더를 읽는 것 방지).
router.get('/api/legal/rooms/law', adminAuth.requireAdminToken, (req, res) => {
  try {
    const dir = String((req.query && req.query.dir) || '').trim();
    const law = buildRawLaws().laws.find(l => l.dir === dir);
    if (!law) return res.status(404).json({ ok: false, error: '없는 법: ' + dir });
    const abs = path.join(RAW_DIR, dir);

    // ① 계층 원문 — 있는 파일만. 시행일을 못 읽으면 ''(화면이 "확인 안 됨"으로 표시)
    //    ★시행일이 지난 예고본(`_대기/<시행일>/`)이 있으면 **챗봇이 실제로 읽는 그 파일**을 보여준다.
    //      종전에는 이 방만 현행 파일을 읽어, 시행일 뒤에 조문 팝업은 새 원문인데 원문 방은 옛 시행일을
    //      보여줬다(2026-09-10 독립 검토 medium). 아직 시행 전인 대기본은 `pending` 으로 따로 알려 준다.
    const rel = path.relative(path.join(__dirname, '..', '..'), abs).split(path.sep).join('/');
    const today = effectiveDate.todayKST();
    const stageList = (effectiveDate.loadPendingIndex()[rel] || []);
    const files = [];
    for (const t of RAW_TIERS) {
      let f = path.join(abs, t.file);
      if (!fs.existsSync(f)) continue;
      const stagedRel = effectiveDate.stagedRawPath(rel, t.file, today);
      const staged = stagedRel && fs.existsSync(path.join(__dirname, '..', '..', stagedRel)) ? stagedRel : '';
      if (staged) f = path.join(__dirname, '..', '..', staged);
      const { eff, amd } = effOfTxt(f);
      const pending = stageList.filter(e => e.date > today && (e.files || []).indexOf(t.file) >= 0).map(e => e.date).sort();
      // ★시행일이 지났는데 **승인이 안 나** 아직 옛 판을 읽고 있는 층(2026-09-10 승인 게이트).
      //   이걸 안 보여주면 관리자는 "왜 시행일이 지났는데 안 바뀌지"를 알 길이 없다.
      const waiting = stageList.filter(e => e.date <= today && (e.files || []).indexOf(t.file) >= 0
        && !effectiveDate.isStageApproved(e, t.file)).map(e => e.date).sort();
      files.push({
        label: t.label, ic: t.ic, eff, amd,
        src: staged ? srcUrl(staged.replace(/^.*\/raw\//, '')) : srcUrl(dir + '/' + t.file),
        staged: staged ? (staged.match(/_대기\/(\d{8})\//) || [])[1] || '' : '',
        pending, waiting,
      });
    }

    // ② 별표·별지 서식 — `별표/_links.json` 이 수집 당시의 제목·원본(HWP·이미지) 링크를 갖고 있다.
    //    같은 이름의 .txt 가 실제로 있을 때만 "본문" 링크를 준다(없는 링크를 만들지 않는다).
    let links = {};
    try { links = JSON.parse(fs.readFileSync(path.join(abs, '별표', '_links.json'), 'utf8')) || {}; } catch (_) { links = {}; }
    const byls = Object.keys(links).map(key => {
      const v = links[key] || {};
      const m = key.match(/^(\S+)\s+(별표|서식)\s+(\S+)$/);
      const txt = key.replace(/\s*(별표|서식)\s*/, '_$1');
      const hasTxt = fs.existsSync(path.join(abs, '별표', txt + '.txt'));
      const imgs = Array.isArray(v['이미지']) ? v['이미지'].map(absLawUrl).filter(Boolean) : [];
      return {
        badge: m ? (BYL_TIER_SHORT[m[1]] || m[1]) + ' ' + m[2] + m[3] : key,
        title: String(v['제목'] || ''),
        src: hasTxt ? srcUrl(dir + '/별표/' + txt + '.txt') : '',
        hwp: absLawUrl(v['HWP']), pdf: absLawUrl(v['PDF']), img: imgs[0] || '',
      };
    });

    // ③ 고시(행정규칙) — 머리말이 두 꼴이다: `[고시/행정규칙] 제목` / `# 제목`.
    //    제목을 못 읽으면 파일명을 그대로 쓴다(파일명도 실제 값이다). 시행일은 738개 중 203개에만
    //    적혀 있어(2026-09-09 실측) 없는 것은 **빈칸으로 둔다** — 지어내지 않는다.
    let admFiles = [];
    try { admFiles = fs.readdirSync(path.join(abs, '행정규칙')).filter(f => f.endsWith('.txt') && f[0] !== '_').sort(); } catch (_) { admFiles = []; }
    const admruls = admFiles.map(f => {
      const head = readHead(path.join(abs, '행정규칙', f), 2048);
      const l1 = (head.split('\n')[0] || '').trim();
      const mt = l1.match(/^\[고시\/행정규칙\]\s*(.+)$/) || l1.match(/^#\s*(.+)$/);
      const me = head.match(/시행일[:\s]*(\d{8})/);
      return { title: mt ? mt[1].trim() : f.replace(/\.txt$/, ''), eff: me ? me[1] : '', src: srcUrl(dir + '/행정규칙/' + f) };
    });

    res.json({ ok: true, name: law.name, dir, domain: law.domain, ministry: law.ministry, files, byls, admruls });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

module.exports = router;
