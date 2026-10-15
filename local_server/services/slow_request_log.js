/**
 * ============================================================================
 * 파일명: services/slow_request_log.js
 * 역할: 3초 넘게 걸린 요청을 "어느 주소·몇 초·응답 코드"로 서버 로그에 한 줄 남긴다.
 *       Fly 응답시간 그래프는 나리야 VM 작업자의 25초 대기(codex poll)에 덮여 늘 20~30초로 보여,
 *       실제로 느린 화면을 그래프로는 알아낼 수 없다(사용자 확정 2026-10-15 「좋아」).
 *       일부러 붙잡아 두는 요청(작업자 대기·SSE 진행 스트림)은 느린 게 아니므로 뺀다.
 * ============================================================================
 * [연계]
 *   - config/server_config.js → app.use(slowRequestLog()) — 모든 라우트보다 앞(정적 파일 포함)
 *   - services/server_logger.js → console.warn 이 서버 로그 파일(WARN)로 간다
 *   - services/codex_bridge.js POLL_HOLD_MS(25초) · routes/weather.js /api/force-update/:type/stream(SSE)
 * [로드 순서] 서버 코드(require 로 로드) — index2.html 과 무관.
 * ============================================================================
 */
'use strict';

// 이 시간 이상 걸린 요청만 남긴다. 앱 API 80개 실측이 0.5~3.5초(2026-10-15)라 3초 넘으면 사람이 기다린다고 느낀다.
const SLOW_MS = 3000;
// 일부러 오래 붙잡는 요청 — 느린 것이 아니라 설계대로 기다리는 것이다.
const HELD = [/^\/api\/legal\/codex\/poll$/, /^\/api\/force-update\/[^/]+\/stream$/];

/**
 * 느린 요청 기록 미들웨어를 만든다.
 * 예: GET /api/tide?lat=… 가 4.2초 → "[slow] 4.2s GET /api/tide 200" (쿼리는 키·좌표가 섞일 수 있어 남기지 않는다)
 * @param {object} [opts] 시험용 주입 — { thresholdMs, log, now }
 * @returns {Function} express 미들웨어 (req, res, next)
 * [연계] ← config/server_config.js
 */
function slowRequestLog(opts = {}) {
    const threshold = opts.thresholdMs || SLOW_MS;
    const log = opts.log || ((line) => console.warn(line));
    const now = opts.now || (() => Date.now());
    return function slowRequestLogger(req, res, next) {
        const path = String(req.originalUrl || req.url || '').split('?')[0];
        if (HELD.some((re) => re.test(path))) return next();
        const started = now();
        let done = false;
        const finish = (how) => {
            if (done) return;
            done = true;
            const ms = now() - started;
            if (ms < threshold) return;
            log(`[slow] ${(ms / 1000).toFixed(1)}s ${req.method} ${path} ${how === 'close' && !res.writableFinished ? '끊김' : res.statusCode}`);
        };
        res.on('finish', () => finish('finish'));
        res.on('close', () => finish('close'));
        next();
    };
}

module.exports = { slowRequestLog, SLOW_MS };
