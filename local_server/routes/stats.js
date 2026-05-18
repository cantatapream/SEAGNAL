/**
 * ============================================================================
 * 파일명: routes/stats.js
 * 역할: 방문자 통계 및 카운터 API 라우트
 * ============================================================================
 *
 * [설명]
 * 이 파일은 방문자 수를 카운팅하고 통계를 제공하는 API를 관리합니다.
 * - GET /api/visit           → 방문자 카운터 (오늘/전체 방문수 + 자동 증가)
 * - GET /api/stats/visitors  → 날짜별/시간대별 상세 방문 통계 (관리자 대시보드)
 *
 * [연계 파일]
 * - config/server_config.js   → DATA_DIR, FILES 경로 사용
 * - services/visit_queue.js   → 방문 카운트의 메모리 큐 + 5초 비동기 flush
 * - server.js                 → app.use()로 이 라우터 등록 + 종료 시 flushSync
 *
 * [초보자를 위한 안내]
 * 이 API는 사용자가 앱을 열 때마다 호출되어 방문자 수를 기록합니다.
 * visitors.json 에는 오늘/전체 방문 수가, visitors_stats.json 에는
 * 날짜별/시간대별 상세 통계가 기록됩니다.
 * 방문자 통계는 영구 보관됩니다. (1일 ≈ 150바이트, 10년 ≈ 540KB)
 *
 * [변경 이력 — 2026-05 비동기화]
 *   원래는 매 /api/visit 요청마다 fs.writeFileSync 를 2번(visitors.json 과
 *   visitors_stats.json)호출하여 이벤트 루프를 15~20ms 차단했습니다.
 *   이제는 services/visit_queue.js 의 메모리 큐만 갱신하고, 디스크 쓰기는
 *   백그라운드에서 5초마다 한 번씩 비동기로 묶어서 처리합니다.
 *   응답 본문은 메모리 카운터에서 즉시 읽어 반환하므로, 카운트 즉시성은
 *   기존과 동일합니다(통계 표시 지연 0초). 디스크 반영만 최대 5초 지연됨.
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const visitQueue = require('../services/visit_queue');

// 서버 부팅 시 1회: 디스크에서 초기 상태 로드 + 5초 flush 타이머 시작.
// (visit_queue.init() 자체는 idempotent — 다른 곳에서 또 호출해도 무해)
visitQueue.init();

// ============================================================================
// API 엔드포인트
// ============================================================================

/**
 * GET /api/visit
 * 방문자 카운터 (오늘/전체 + 자동 증가)
 *
 * 쿼리 파라미터:
 *   inc=false  → 카운트 증가 없이 현재 수치만 조회 (이미 세션 내 방문 기록이 있을 때)
 *   admin=true → 관리자 기기에서 호출. 하루에 1회만 카운트
 *                (오늘 이미 카운트했으면 증가 안 함)
 *   (파라미터 없음) → 일반 사용자 첫 방문. 무조건 카운트 +1
 *
 * 응답 본문 (변경 없음):
 *   { today, total, lastDate, adminLastDate? }
 *   ※ 메모리 큐의 최신값을 즉시 반영하므로, 디스크 flush 가 5초 지연되더라도
 *      클라이언트가 보는 숫자는 즉시 갱신됨.
 */
router.get('/api/visit', (req, res) => {
    try {
        const shouldIncrement = req.query.inc !== 'false';
        const isAdmin = req.query.admin === 'true';

        if (!shouldIncrement) {
            // 단순 조회: 메모리 카운터의 현재 스냅샷을 반환.
            return res.json(visitQueue.getVisitorSnapshot());
        }

        // 카운트 증가 모드.
        const now = new Date();
        const kstDate = new Date(now.getTime() + (9 * 60 * 60 * 1000));

        // 큐에 방문 +1 적용. applyVisit 은 다음 중 하나를 반환:
        //   - 갱신된 snapshot 객체     → 정상 카운트 증가
        //   - null                       → 관리자 모드에서 오늘 이미 카운트한 경우
        const updated = visitQueue.applyVisit({ kstDate, isAdmin });
        if (updated) {
            return res.json(updated);
        }
        // 관리자 중복 카운트 차단된 경우: 현재 메모리 상태를 그대로 반환.
        return res.json(visitQueue.getVisitorSnapshot());
    } catch (e) {
        console.error('방문객 카운트 실패:', e);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

/**
 * GET /api/stats/visitors
 * 날짜별/시간대별 상세 방문 통계 (관리자 대시보드 — admin_collect.js 에서 호출)
 *
 * 응답 본문 (변경 없음):
 *   { [YYYY-MM-DD]: { total, hourly: { [HH]: count } } }
 *   ※ 메모리 큐의 최신 통계를 즉시 반영 — 디스크 flush 보다 빠름.
 */
router.get('/api/stats/visitors', (req, res) => {
    try {
        res.json(visitQueue.getStatsSnapshot());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
