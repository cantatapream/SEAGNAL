/**
 * ============================================================================
 * 파일명: services/pending_answers.js
 * 역할  : 나리야 챗봇의 "답변완료 푸시"를 위한 1회용 임시 답변 보관함.
 *         답이 늦게 나오는 사이 사용자가 앱을 완전히 종료해 버리면 스트림이 끊겨
 *         답변이 사라진다. 그 한 건만 잠깐 맡아 두었다가, 푸시를 누르고 다시 들어온
 *         사용자에게 딱 한 번 돌려주고 즉시 버린다.
 * ----------------------------------------------------------------------------
 * [원칙 — 왜 이게 "온디바이스 대화기록" 원칙과 충돌하지 않는가]
 *   이 파일은 **대화 히스토리 저장소가 아니다.** 끊긴 연결을 대신 잇는
 *   "1건짜리 임시 핸드오프"다:
 *     · 저장 단위 = 질문 1건 + 그 답변 1건 (대화 맥락·사용자 식별자 저장 안 함)
 *     · 최대 3시간 (그 전에 조회되면 그 즉시 삭제 — 1회용)
 *     · 푸시 본문·데이터에는 질문/답변 원문이 절대 안 실린다(requestId만)
 *   즉 서버는 "누가 무엇을 물었는지"를 누적하지 않는다.
 *
 * [연계]
 *  - 사용하는 파일 : services/atomic_write.js(writeFileAtomic — tmp→rename 원자적 저장)
 *                    config/server_config.js(DATA_DIR)
 *  - 서버 API      : 없음(라우트가 아니라 라우트가 쓰는 서비스)
 *  - 마크업        : 없음
 *  - 나를 쓰는 곳  : routes/legal.js
 *                    POST /api/legal/ask            → store()  (6초 초과 + 알림 동의 시)
 *                    GET  /api/legal/pending-answer/:requestId → retrieve()
 * [로드 순서] 해당 없음(서버 CommonJS require — 첫 require 시 디스크에서 복원)
 * ============================================================================
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/server_config');
const { writeFileAtomic } = require('./atomic_write');

// ============================================================================
// 상수
// ============================================================================

// 보관 기한: 3시간. 지나면 조회 안 해도 무효(푸시 문구도 "3시간 안에 확인" 으로 고정).
const TTL_MS = 3 * 60 * 60 * 1000;

// 만료분 청소 주기: 1시간마다 1회 (services/admin_auth.js 토큰 청소와 동일 패턴)
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

// 안전 상한: 동시에 보관할 수 있는 최대 건수. 초과 시 오래된 것부터 버린다.
// (3시간 TTL + 6초 이상 걸린 질문만 저장이라 정상 운영에서는 한참 못 미친다.)
const MAX_ENTRIES = 500;

// 디스크 영속화 — Fly.io 볼륨(data/). 배포로 서버가 재시작돼도 3시간 이내 건은 살아남는다.
const STORE_FILE = path.join(DATA_DIR, 'pending_answers.json');

// ============================================================================
// 저장소 — 메모리 Map(디스크와 단방향 동기화: 메모리가 진실, 디스크는 백업)
//   key   : requestId (64자 hex)
//   value : { query, answer, sources, citationChain, note, createdAt }
// ============================================================================
const store_ = new Map();

/**
 * 메모리 Map 의 현재 상태를 data/pending_answers.json 에 원자적으로 저장한다.
 * 예: 답변 1건 저장 직후 호출 → 파일에 {"<64자hex>":{query,answer,...}} 로 기록
 * 실패해도 조용히 로그만 남긴다 — 메모리만으로도 기능은 동작하고, 다음 저장 때 재시도된다.
 * [연계] ← store/retrieve/청소 타이머. → services/atomic_write.js writeFileAtomic
 *          (쓰다 죽어도 옛 파일이 온전히 남게 하려고 tmp→rename 을 쓴다)
 */
function saveToDisk() {
    try {
        const obj = {};
        for (const [id, entry] of store_.entries()) obj[id] = entry;
        writeFileAtomic(STORE_FILE, JSON.stringify(obj), 'utf8');
    } catch (e) {
        console.warn('[pending_answers] 디스크 저장 실패:', e && e.message);
    }
}

/**
 * 서버 시작 시 1회. data/pending_answers.json 에서 아직 안 만료된 건만 메모리로 복원한다.
 * 예: 3시간 안에 재배포가 일어나도 사용자가 푸시를 누르면 답변을 받을 수 있다.
 * 파일이 없거나 깨졌으면 빈 상태로 시작(안전 폴백).
 * [연계] ← 이 모듈 로드 시점(맨 아래 즉시 호출). → saveToDisk(만료분을 정리했을 때만)
 */
function loadFromDisk() {
    try {
        if (!fs.existsSync(STORE_FILE)) return;
        const obj = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
        const now = Date.now();
        let loaded = 0, expired = 0;
        for (const id of Object.keys(obj)) {
            const entry = obj[id];
            if (entry && typeof entry.createdAt === 'number' && now - entry.createdAt < TTL_MS) {
                store_.set(id, entry);
                loaded++;
            } else {
                expired++;
            }
        }
        if (loaded + expired > 0) console.log(`[pending_answers] 디스크 복원: 유효 ${loaded} / 만료 ${expired}`);
        if (expired > 0) saveToDisk();
    } catch (e) {
        console.warn('[pending_answers] 디스크 로드 실패(빈 상태로 시작):', e && e.message);
    }
}

// ============================================================================
// 공개 API
// ============================================================================

/**
 * 답변 1건을 임시 보관하고, 그 건을 가리키는 무작위 requestId 를 발급한다.
 * 예: store('야간조업 되나요?', '…됩니다', [{law:'…'}], '위키 근거 기반 AI 답변')
 *     → 'a3f1…'(64자 hex) — 푸시 data.url 의 ?rid= 값이 된다.
 * requestId 는 256비트 무작위(admin_auth.issueToken 과 동일 방식)라 유추가 불가능하므로
 * 조회 라우트에 별도 인증을 두지 않는다(기기 식별자를 서버에 남기지 않기 위한 선택).
 * @param {string} query - 사용자 질문 원문
 * @param {string|null} answer - 완성된 답변 텍스트(없으면 null)
 * @param {Array} sources - 근거 목록(/api/legal/ask 의 sourcesOut 그대로)
 * @param {string} note - 답변 등급/주석 문구
 * @param {Array} citationChain - 근거 조문 줄 목록(/api/legal/ask 의 citationChain 그대로).
 *   ⚠ 함께 보관해야 한다 — 화면 복원(answerHTML)이 이 값으로 "근거 법령" 아코디언을 그리므로,
 *     빼먹으면 푸시로 되돌아온 답변만 근거 목록이 통째로 비어 보인다.
 * @param {Array} [forms] - 서식 다운로드 목록(/api/legal/ask 의 forms 그대로). citationChain과 같은
 *   이유로 함께 보관한다 — 빼먹으면 푸시로 되돌아온 답변만 서식 버튼이 안 뜬다(2026-08-17, 적대검증 발견 2).
 * @returns {string} requestId(64자 hex)
 * [연계] ← routes/legal.js POST /api/legal/ask (6초 초과 + 알림 동의한 요청에서만)
 *          → saveToDisk (발급 즉시 디스크 반영)
 */
function store(query, answer, sources, note, citationChain, forms) {
    const requestId = crypto.randomBytes(32).toString('hex');
    store_.set(requestId, {
        query: String(query || ''),
        answer: answer == null ? null : String(answer),
        sources: Array.isArray(sources) ? sources : [],
        citationChain: Array.isArray(citationChain) ? citationChain : [],
        forms: Array.isArray(forms) ? forms : [],
        note: String(note || ''),
        createdAt: Date.now()
    });
    // 안전 상한: 넘치면 가장 오래된 것부터 버린다(Map 은 삽입 순서를 유지한다).
    while (store_.size > MAX_ENTRIES) {
        const oldest = store_.keys().next().value;
        store_.delete(oldest);
    }
    saveToDisk();
    return requestId;
}

/**
 * requestId 로 보관 중인 답변을 꺼내고 **즉시 삭제**한다(1회용).
 * 예: retrieve('a3f1…') → {query, answer, sources, citationChain, note, createdAt} · 두 번째 호출은 null
 * 없거나 3시간이 지난 건은 null (만료 건은 만난 김에 정리한다).
 * @param {string} requestId - store() 가 발급한 64자 hex
 * @returns {{query:string, answer:string|null, sources:Array, citationChain:Array, forms:Array, note:string, createdAt:number}|null}
 * [연계] ← routes/legal.js GET /api/legal/pending-answer/:requestId
 *          (푸시를 눌러 다시 들어온 앱이 답변 말풍선을 복원하려고 딱 한 번 부른다)
 */
function retrieve(requestId) {
    if (typeof requestId !== 'string' || !requestId) return null;
    const entry = store_.get(requestId);
    if (!entry) return null;
    store_.delete(requestId);          // 1회용 — 조회 즉시 삭제
    saveToDisk();
    if (Date.now() - entry.createdAt >= TTL_MS) return null;   // 만료분(삭제만 하고 안 준다)
    return entry;
}

/** 현재 보관 중인 건수(운영 디버깅용 — 내용은 노출하지 않는다). @returns {number} */
function getPendingCount() {
    return store_.size;
}

// ============================================================================
// 주기적 청소 — 조회되지 않은 채 3시간이 지난 건을 일괄 삭제
// ============================================================================
// retrieve 에서도 지연 청소를 하지만, 아무도 안 누른 건은 영원히 남으므로 1시간 단위로
// 일괄 정리한다(services/admin_auth.js 의 만료 토큰 청소와 같은 구조).
setInterval(() => {
    const now = Date.now();
    let removed = 0;
    for (const [id, entry] of store_.entries()) {
        if (now - entry.createdAt >= TTL_MS) { store_.delete(id); removed++; }
    }
    if (removed > 0) {
        console.log(`[pending_answers] 만료 ${removed}건 청소. 잔여: ${store_.size}`);
        saveToDisk();
    }
}, CLEANUP_INTERVAL_MS);

// 모듈 로드 즉시 1회 — 재시작 전 보관분 복원
loadFromDisk();

module.exports = {
    store,
    retrieve,
    getPendingCount,
    TTL_MS,
};
