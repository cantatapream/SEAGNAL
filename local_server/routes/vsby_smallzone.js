/**
 * ============================================================================
 * routes/vsby_smallzone.js
 * MMIS 해구별예측(소해구) 시정 캐시 제공 API.
 *
 *   GET /api/vsby-smallzone/status            → 캐시 상태(baseTm, 셀 수)
 *   GET /api/vsby-smallzone?zone=S1251100     → 특보구역의 소해구별 시정 시계열(프리페치 캐시)
 *   GET /api/vsby-smallzone?cells=144-1,145-2 → 지정 소해구들의 시정 시계열(캐시)
 *   GET /api/vsby-smallzone/point?lat=&lon=   → [B1] 임의 해점이 속한 소해구 시정(지연 로딩)
 *   GET /api/vsby-smallzone/cell?key=144-9    → [B1] 특정 소해구 시정(지연 로딩)
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

// [B1] 임의 해점 → 그 점이 속한 소해구 시정 (지연 로딩: 캐시 우선, 없으면 MMIS 즉시 1회)
router.get('/api/vsby-smallzone/point', async (req, res) => {
    const lat = parseFloat(req.query.lat), lon = parseFloat(req.query.lon);
    if (!isFinite(lat) || !isFinite(lon)) {
        return res.json({ success: false, error: 'lat/lon 필요' });
    }
    try {
        const r = await sz.getByPoint(lat, lon);
        if (!r) return res.json({ success: false, error: '격자 밖 좌표' });
        res.json({ success: true, ...r });
    } catch (e) {
        console.error('[vsby-smallzone/point] 실패:', e.message);
        res.status(500).json({ success: false, error: 'server error' });
    }
});

// [선 차트] 대해구 1시간 시정 시계열 — 소해구·오버레이와 동일한 RDPS 래스터로 통일
//           (그 대해구 9개 소해구 래스터의 프레임별 최악값 집계, 완전 래스터화)
router.get('/api/vsby-smallzone/major', async (req, res) => {
    try {
        const no = (req.query.no || '').trim();
        let r;
        if (no) r = await sz.getMajorForGraph(no);
        else {
            const lat = parseFloat(req.query.lat), lon = parseFloat(req.query.lon);
            if (!isFinite(lat) || !isFinite(lon)) return res.json({ success: false, error: 'no 또는 lat/lon 필요' });
            r = await sz.getMajorForGraphByPoint(lat, lon);
        }
        if (!r) return res.json({ success: false, error: '격자 밖 좌표' });
        res.json({ success: true, ...r });
    } catch (e) {
        console.error('[vsby-smallzone/major] 실패:', e.message);
        res.status(500).json({ success: false, error: 'server error' });
    }
});

// [B1] 특정 소해구 키 → 시정 (지연 로딩)
router.get('/api/vsby-smallzone/cell', async (req, res) => {
    const key = (req.query.key || '').trim();
    if (!key) return res.json({ success: false, error: 'key 필요 (예: 144-9)' });
    try {
        const r = await sz.getCellLazy(key);
        res.json({ success: true, ...r });
    } catch (e) {
        console.error('[vsby-smallzone/cell] 실패:', e.message);
        res.status(500).json({ success: false, error: 'server error' });
    }
});

router.get('/api/vsby-smallzone', async (req, res) => {
    try {
        const zone = (req.query.zone || '').trim();
        const cellsParam = (req.query.cells || '').trim();

        if (zone) {
            const data = await sz.getZone(zone);
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
