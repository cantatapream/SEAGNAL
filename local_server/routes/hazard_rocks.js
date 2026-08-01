/**
 * ============================================================================
 * 파일명: routes/hazard_rocks.js
 * 역할: 간출암 잠김경고 API — "3시간 이내 잠기는 암초" 목록 제공
 * ============================================================================
 *
 * [엔드포인트]
 *   GET /api/hazard-rocks/submersion
 *     → { success, ready, generated_at, warnings: { "<암초id>": etaMin(분) } }
 *       etaMin 은 0보다 크고 180(3시간) 이하인 암초만 포함한다.
 *       ready=false 면 아직 야간 배치가 한 번도 안 돌아 데이터가 없다는 뜻
 *       (크래시 아님, warnings 는 빈 객체).
 *
 * [계산은 여기서 안 함]
 *   무거운 스캔(분단위×3일×전체 암초)은 services/hazard_rocks_submersion.js 의
 *   computeAllCrossings() 가 야간 배치(scheduler.js, KST 23:30)에서 1회만 하고
 *   결과를 파일로 저장해 둔다. 이 라우트는 그 파일을 읽어 "지금"과 빼는 가벼운
 *   연산만 하므로 매 요청마다 무겁게 재계산하지 않는다.
 *
 * [연계]
 *   - services/hazard_rocks_submersion.js → getUpcomingWarnings()
 *   - js/marine-life/safety/hazard_rocks.js → 이 API 를 폴링해 마커 위 경고 표시
 *   - server.js → app.use(require('./routes/hazard_rocks'))
 * ============================================================================
 */

'use strict';

const express = require('express');
const router = express.Router();

const submersion = require('../services/hazard_rocks_submersion');

/** GET /api/hazard-rocks/submersion */
router.get('/api/hazard-rocks/submersion', (req, res) => {
    try {
        const result = submersion.getUpcomingWarnings();
        res.set('Cache-Control', 'public, max-age=60');
        res.json({ success: true, ...result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
