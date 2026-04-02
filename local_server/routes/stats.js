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
 * 방문자 통계는 영구 보관됩니다. (1일 ≈ 150바이트, 10년 ≈ 540KB)
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

        // 방문자 통계는 영구 보관 (삭제 로직 없음)
        // 1일 ≈ 150바이트이므로 10년 누적해도 약 540KB → 성능 영향 없음

        fs.writeFileSync(FILES.VISITORS_STATS, JSON.stringify(stats, null, 2), 'utf8');
    } catch (e) {
        console.error('상세 통계 기록 실패:', e);
    }
}

// ============================================================================
// API 엔드포인트
// ============================================================================

// 방문자 카운터 (오늘/전체 + 자동 증가)
// 쿼리 파라미터:
//   inc=false → 카운트 증가 없이 현재 수치만 조회 (이미 세션 내 방문 기록이 있을 때)
//   admin=true → 관리자 기기에서 호출. 하루에 1회만 카운트 (오늘 이미 카운트했으면 증가 안 함)
//   (파라미터 없음) → 일반 사용자 첫 방문. 무조건 카운트 +1
router.get('/api/visit', (req, res) => {
    try {
        const data = getVisitorData();
        const shouldIncrement = req.query.inc !== 'false';
        const isAdmin = req.query.admin === 'true';

        if (shouldIncrement) {
            const now = new Date();
            const kstDate = new Date(now.getTime() + (9 * 60 * 60 * 1000));
            const todayStr = kstDate.toISOString().split('T')[0];

            // 관리자 기기인 경우: 오늘 이미 관리자로 방문 기록이 있으면 카운트 증가하지 않음
            // → 관리자가 하루에 여러 번 접속해도 방문수는 1회만 올라감
            if (isAdmin && data.adminLastDate === todayStr) {
                return res.json(data);
            }

            if (data.lastDate !== todayStr) {
                data.today = 1;
                data.lastDate = todayStr;
            } else {
                data.today += 1;
            }
            data.total += 1;

            // 관리자 방문인 경우 오늘 날짜를 기록하여 중복 카운트 방지
            if (isAdmin) {
                data.adminLastDate = todayStr;
            }

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
