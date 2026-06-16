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
const dispatch = require('../services/location_alert_dispatch');
const { requireAdminToken } = require('../services/admin_auth');

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

// [시연] 관리자 기기로 실제 깨우는 신호(데이터 메시지) 발송 — 관리자 토큰 필요.
//   body: { token(이 기기 push_token), activeWarnings:[{zone,warnType,level,event,efTime}] }
//   단말은 미리 설정한 시연 위치 + 내장 폴리곤으로 판정해 로컬 알림을 띄운다.
router.post('/api/location-alert/demo', requireAdminToken, async (req, res) => {
    try {
        const { token, activeWarnings } = req.body || {};
        if (!token || typeof token !== 'string') {
            return res.status(400).json({ success: false, error: 'token(device push_token) required' });
        }
        if (!Array.isArray(activeWarnings) || activeWarnings.length === 0) {
            return res.status(400).json({ success: false, error: 'activeWarnings array required' });
        }
        const send = () => dispatch.dispatchWake(activeWarnings, { getConsents: () => [{ token, agreed: true }] });
        // 지연 발송(앱 종료 상태 수신 테스트용): 0~10분 범위. >0 이면 서버가 예약 후 즉시 응답.
        const delay = Math.max(0, Math.min(600000, Number(req.body.delayMs) || 0));
        if (delay > 0) {
            setTimeout(() => { send().catch(() => { }); }, delay);
            return res.json({ success: true, scheduled: true, delayMs: delay });
        }
        const result = await send();
        return res.json({ success: true, result });
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
