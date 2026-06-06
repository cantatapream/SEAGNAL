/**
 * ============================================================================
 * 파일명: services/assistant_log.js
 * 역할: AI 비서 대화 내역(테스트용) 인메모리 링버퍼.
 * ============================================================================
 *  - /api/assistant/ask 의 질문/답변을 최근 N건 보관 → 관리자 AI 탭에서 조회.
 *  - 백그라운드 "나리야" 대화도 같은 엔드포인트를 타므로 함께 기록됨.
 *  - 테스트 기간용. 서버 메모리에만 보관(재시작 시 소멸), 관리자 전용 조회.
 *  - 민감정보(프로필/좌표)는 저장하지 않고 질문/답변 텍스트만 보관.
 * ============================================================================
 */
const LOG = [];
const MAX = 300;

function push(entry) {
    try {
        LOG.push({
            ts: Date.now(),
            query: String(entry.query || '').slice(0, 300),
            answer: String(entry.answer || '').slice(0, 600),
            zone: entry.zone || null,
            intent: entry.intent || null,
            aiUsed: !!entry.aiUsed,
            tools: Array.isArray(entry.tools) ? entry.tools : null
        });
        if (LOG.length > MAX) LOG.splice(0, LOG.length - MAX);
    } catch (e) { /* 로깅 실패는 무시 */ }
}

function getRecent(n) {
    const k = Math.min(n || 100, LOG.length);
    return LOG.slice(LOG.length - k).reverse(); // 최신순
}

function clear() { LOG.length = 0; }

module.exports = { push, getRecent, clear };
