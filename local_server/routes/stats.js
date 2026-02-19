/**
 * ============================================================================
 * 파일명: routes/stats.js
 * 역할: 방문자 통계 및 카운터 API 라우트
 * ============================================================================
 *
 * [설명]
 * 이 파일은 방문자 수를 카운팅하고 통계를 제공하는 API를 관리합니다.
 * - GET /api/visit → 방문자 카운터 (오늘/전체 방문수 + 자동 증가)
 * - GET /api/stats/visitors → 날짜별/시간대별 상세 방문 통계
 *
 * [연계 파일]
 * - config/server_config.js → DATA_DIR, FILES 경로 사용
 * - server.js → app.use()로 이 라우터 등록
 *
 * [초보자를 위한 안내]
 * 이 API는 사용자가 앱을 열 때마다 호출되어 방문자 수를 기록합니다.
 * visitors.json에는 오늘/전체 방문 수가, visitors_stats.json에는
 * 날짜별/시간대별 상세 통계가 기록됩니다.
 * 최근 365일치 데이터만 유지하여 파일 크기를 관리합니다.
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const { FILES } = require('../config/server_config');

// ============================================================================
// 유틸리티 함수
// ============================================================================

/**
 * 방문자 데이터 파일을 읽어서 반환합니다.
 */
function getVisitorData() {
    try {
        if (fs.existsSync(FILES.VISITORS)) {
            return JSON.parse(fs.readFileSync(FILES.VISITORS, 'utf8'));
        }
    } catch (e) {
        console.error('방문객 데이터 로드 실패:', e);
    }
    return { today: 0, total: 0, lastDate: '' };
}

/**
 * 시간대별 상세 통계를 업데이트합니다.
 * @param {Date} kstDate - 한국 시간 기준 Date 객체
 */
function updateGranularStats(kstDate) {
    try {
        const dateStr = kstDate.toISOString().split('T')[0];
        const hourStr = String(kstDate.getUTCHours()).padStart(2, '0');

        let stats = {};
        if (fs.existsSync(FILES.VISITORS_STATS)) {
            stats = JSON.parse(fs.readFileSync(FILES.VISITORS_STATS, 'utf8'));
        }

        if (!stats[dateStr]) {
            stats[dateStr] = { total: 0, hourly: {} };
        }

        stats[dateStr].total = (stats[dateStr].total || 0) + 1;
        stats[dateStr].hourly[hourStr] = (stats[dateStr].hourly[hourStr] || 0) + 1;

        // 최근 365일치 데이터만 유지
        const keys = Object.keys(stats).sort();
        if (keys.length > 365) {
            delete stats[keys[0]];
        }

        fs.writeFileSync(FILES.VISITORS_STATS, JSON.stringify(stats, null, 2), 'utf8');
    } catch (e) {
        console.error('상세 통계 기록 실패:', e);
    }
}

// ============================================================================
// API 엔드포인트
// ============================================================================

// 방문자 카운터 (오늘/전체 + 자동 증가)
router.get('/api/visit', (req, res) => {
    try {
        const data = getVisitorData();
        const shouldIncrement = req.query.inc !== 'false';

        if (shouldIncrement) {
            const now = new Date();
            const kstDate = new Date(now.getTime() + (9 * 60 * 60 * 1000));
            const todayStr = kstDate.toISOString().split('T')[0];

            if (data.lastDate !== todayStr) {
                data.today = 1;
                data.lastDate = todayStr;
            } else {
                data.today += 1;
            }
            data.total += 1;

            fs.writeFileSync(FILES.VISITORS, JSON.stringify(data, null, 2), 'utf8');
            updateGranularStats(kstDate);
        }
        res.json(data);
    } catch (e) {
        console.error('방문객 카운트 실패:', e);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 상세 방문 통계 조회
router.get('/api/stats/visitors', (req, res) => {
    try {
        if (fs.existsSync(FILES.VISITORS_STATS)) {
            const stats = JSON.parse(fs.readFileSync(FILES.VISITORS_STATS, 'utf8'));
            res.json(stats);
        } else {
            res.json({});
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
