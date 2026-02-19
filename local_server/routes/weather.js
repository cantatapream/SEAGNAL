/**
 * ============================================================================
 * 파일명: routes/weather.js
 * 역할: 기상 특보 및 전망 데이터 API 라우트
 * ============================================================================
 *
 * [설명]
 * 이 파일은 기상 관련 데이터를 클라이언트에 제공하는 API 엔드포인트를 관리합니다.
 * - GET /api/weather-alerts → 기상 특보 현황 (weather_alerts.json)
 * - GET /api/buoys → 부이 관측 데이터
 * - GET /api/status → API 수집 상태
 * - POST /api/force-update/:type → 수동 데이터 업데이트
 * - GET/POST /api/config → API 인증키 설정
 * - GET /api/forecasts → 일반 기상 전망
 * - GET /api/marine-zone-forecasts → 해구별 기상 전망
 *
 * [연계 파일]
 * - services/cache_manager.js → dataCache에서 캐시된 데이터 응답
 * - config/server_config.js → DATA_DIR 경로 사용
 * - scheduler.js → 수집 상태 조회 및 수동 업데이트 실행
 * - server.js → app.use()로 이 라우터 등록
 *
 * [초보자를 위한 안내]
 * 이 API들은 프론트엔드(app.js)에서 fetch()로 호출되어
 * 사용자에게 기상 특보, 부이 데이터, 전망 정보를 보여주는 데 사용됩니다.
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/server_config');
const { dataCache, refreshCache } = require('../services/cache_manager');
const scheduler = require('../scheduler');

// 1. 특보 정보 (통합 크롤러 데이터)
router.get('/api/weather-alerts', (req, res) => {
    try {
        const filePath = path.join(DATA_DIR, 'weather_alerts.json');
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'weather_alerts.json not found' });
        }
        res.sendFile(filePath);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 2. 부이 정보
router.get('/api/buoys', (req, res) => {
    if (dataCache.buoys) res.json(dataCache.buoys);
    else res.status(404).json({ error: '데이터 준비 중' });
});

// 2-1. API 상태 확인
router.get('/api/status', (req, res) => {
    res.json(scheduler.getStatus());
});

// 2-1. 수동 업데이트
router.post('/api/force-update/:type', async (req, res) => {
    const type = req.params.type;
    console.log(`🔄 수동 업데이트 요청: ${type}`);
    try {
        if (type === 'buoys') await scheduler.collectBuoys();
        else if (type === 'general') await scheduler.collectGeneralForecasts();
        else if (type === 'zone') await scheduler.collectZoneForecasts();
        else return res.status(400).json({ error: '잘못된 타입' });

        refreshCache();
        res.json({ success: true, status: scheduler.getStatus()[type] });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 2-2. API 인증키 설정 조회
router.get('/api/config', (req, res) => {
    try {
        res.json(scheduler.getConfig());
    } catch (e) {
        res.status(500).json({ error: '설정 조회 실패' });
    }
});

// 2-2. API 인증키 설정 저장
router.post('/api/config', (req, res) => {
    try {
        const success = scheduler.updateConfig(req.body);
        if (success) res.json({ success: true });
        else res.status(500).json({ error: '저장 실패' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 3. 기상 전망
router.get('/api/forecasts', (req, res) => {
    if (dataCache.forecasts) res.json(dataCache.forecasts);
    else res.status(404).json({ error: '데이터 준비 중' });
});

// 4. 해구별 기상전망
router.get('/api/marine-zone-forecasts', (req, res) => {
    if (dataCache.zoneForecasts) res.json(dataCache.zoneForecasts);
    else res.status(404).json({ error: '데이터 준비 중' });
});

module.exports = router;
