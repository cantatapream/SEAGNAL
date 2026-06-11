/**
 * ============================================================================
 * routes/vsby_smallzone.js
 * MMIS 해구별예측(소해구) 시정 캐시 제공 API.
 *
 *   GET /api/vsby-smallzone/status            → 캐시 상태(baseTm, 셀 수)
 *   GET /api/vsby-smallzone?zone=S1251100     → 특보구역의 소해구별 시정 시계열
 *   GET /api/vsby-smallzone?cells=144-1,145-2 → 지정 소해구들의 시정 시계열
 *
 * 응답 시계열은 원값(vs km, 소수1자리). 표기 규칙(20km 상한 클램프 / >10km
 * 투명+텍스트만)은 클라이언트가 적용한다.
 * ============================================================================
 */
'use strict';

const express = require('express');
const router = express.Router();
const sz = require('../services/vsby_smallzone');

router.get('/api/vsby-smallzone/status', (req, res) => {
    res.json({ success: true, ...sz.getStatus() });
});

router.get('/api/vsby-smallzone', (req, res) => {
    try {
        const zone = (req.query.zone || '').trim();
        const cellsParam = (req.query.cells || '').trim();

        if (zone) {
            const data = sz.getZone(zone);
            if (!data) return res.json({ success: false, error: '해당 특보구역 없음' });
            return res.json({ success: true, ...data });
        }
        if (cellsParam) {
            const keys = cellsParam.split(',').map(s => s.trim()).filter(Boolean);
            return res.json({ success: true, baseTm: sz.getStatus().baseTm, cells: sz.getCells(keys) });
        }
        return res.json({ success: false, error: 'zone 또는 cells 파라미터 필요' });
    } catch (e) {
        console.error('[vsby-smallzone] 실패:', e.message);
        res.status(500).json({ success: false, error: 'server error' });
    }
});

module.exports = router;
