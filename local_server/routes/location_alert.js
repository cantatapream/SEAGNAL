/**
 * ============================================================================
 * routes/location_alert.js — 위치기반 특보 경보: 동의 기록 API (④)
 * ============================================================================
 * 설계 문서: 00_docs/LOCATION_BASED_ALERT_DESIGN.md (§3, §10)
 *
 *   POST /api/location-alert/consent  — 동의/철회 사실 최소 기록 (위치 좌표 X)
 *   GET  /api/location-alert/stats    — 활성 동의 수(가벼운 운영 확인용)
 *
 * 클라이언트(js/location_alert_ui.js)가 토글 ON/OFF 시 호출.
 * ============================================================================
 */
'use strict';
const express = require('express');
const router = express.Router();
const store = require('../services/location_alert_store');

// 동의/철회 기록 (token + agreed + version + at). 위치 좌표는 받지 않음.
router.post('/api/location-alert/consent', (req, res) => {
    try {
        const { token, agreed, version, at } = req.body || {};
        if (!token || typeof token !== 'string') {
            return res.status(400).json({ success: false, error: 'token required' });
        }
        const ok = store.recordConsent({ token, agreed: !!agreed, version: version || null, at: at || null });
        return res.json({ success: ok });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

// 운영 확인용 — 활성 동의 수만 반환(개인정보 미노출).
router.get('/api/location-alert/stats', (req, res) => {
    try {
        return res.json({ activeConsents: store.count() });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

module.exports = router;
