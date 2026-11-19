/**
 * ============================================================================
 * routes/location_alert.js — 위치기반 특보 경보: 동의 기록 + 노출 범위 API (④)
 * ============================================================================
 * 설계 문서: 00_docs/LOCATION_BASED_ALERT_DESIGN.md (§3, §10)
 *
 *   POST /api/location-alert/consent          — 동의/철회 사실 최소 기록 (위치 좌표 X)
 *   GET  /api/location-alert/stats            — 활성 동의 수(가벼운 운영 확인용)
 *   GET  /api/location-alert/exposure         — 이 기기에 설정 카드를 보여 줄지(노출 판정)
 *   GET  /api/admin/location-alert/exposure   — [관리자] 지금 노출 범위 + 동의·알림 대상 수
 *   POST /api/admin/location-alert/exposure   — [관리자] 노출 범위 바꾸기 {exposure:'user'|'admin'|'off'}
 *
 * 클라이언트: js/location-alert/location_alert_ui.js(동의·노출 판정) · js/admin/admin_location_status.js(관리자 버튼 3개).
 * 노출 범위(2026-11-19, 사용자 확정): 일반 공개(user) / 관리자만 노출(admin, 기본) / 모두 비노출(off).
 *   숨겨진 대상에게는 알림도 보내지 않는다 — services/location_alert_store.getTargetConsents.
 * 관리자 기기 판정(활동지점 안전 브리핑과 같은 규약 — services/station_briefing.decideExposure):
 *   ①등록된 관리자 기기(admin_devices.json 의 FCM 토큰) ②관리자 로그인 토큰(X-Admin-Token).
 * ============================================================================
 */
'use strict';
const express = require('express');
const router = express.Router();
const store = require('../services/location_alert_store');
const exposureStore = require('../services/location_alert_exposure');

/**
 * 이 요청이 관리자 기기에서 온 것인가.
 * 예: isAdminRequest('fcm-토큰', '로그인-토큰') → true (둘 중 하나라도 관리자로 확인되면)
 * @param {string} pushToken - 기기 FCM 토큰 @param {string} adminToken - X-Admin-Token 헤더 값 @returns {boolean}
 * [연계] → services/admin_device.isAdminDevice(등록 기기) · services/admin_auth.verifyToken(로그인 토큰)
 */
function isAdminRequest(pushToken, adminToken) {
    try { if (pushToken && require('../services/admin_device').isAdminDevice(pushToken)) return true; } catch (_) { /* 기기 목록 읽기 실패 — 아래 토큰으로 */ }
    try { return !!(adminToken && require('../services/admin_auth').verifyToken(adminToken)); } catch (_) { return false; } // 토큰 확인 실패 = 관리자 아님
}

/** [관리자] 응답 본문 — 지금 노출 범위 + 동의 기기 수 + 지금 알림을 받는 기기 수. */
function adminExposureBody() {
    return { ok: true, exposure: exposureStore.getExposure(), consents: store.count(), targets: store.getTargetConsents().length };
}

// 동의/철회 기록 (token + agreed + version + at). 위치 좌표는 받지 않음.
//   관리자 기기로 확인되면 레코드에 admin:true 를 남긴다(노출 '관리자만'일 때 알림 대상).
router.post('/api/location-alert/consent', (req, res) => {
    try {
        const { token, agreed, version, at } = req.body || {};
        if (!token || typeof token !== 'string') {
            return res.status(400).json({ success: false, error: 'token required' });
        }
        const admin = isAdminRequest(token, req.get('X-Admin-Token'));
        const ok = store.recordConsent({ token, agreed: !!agreed, version: version || null, at: at || null, admin });
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

// 노출 판정 — 설정 화면이 열릴 때 이 기기에 카드를 보여 줄지 묻는다.
//   헤더: X-Admin-Device(기기 FCM 토큰) · X-Admin-Token(관리자 로그인 토큰) — 둘 다 없어도 된다(일반 사용자).
//   '관리자만'일 때는 관리자 기기이거나, 관리자 기기로 동의해 둬 지금 알림을 받고 있는 기기면 보인다
//   (알림을 받는 기기가 카드를 못 보면 끌 방법이 없다).
router.get('/api/location-alert/exposure', (req, res) => {
    try {
        const audience = exposureStore.getExposure();
        const pushToken = req.get('X-Admin-Device') || '';
        let display = audience === 'user';
        if (audience === 'admin') display = isAdminRequest(pushToken, req.get('X-Admin-Token')) || store.isAdminConsent(pushToken);
        return res.set('Cache-Control', 'no-store').json({ ok: true, audience, display });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// [관리자] 이 라우터는 routes/admin.js 보다 먼저 붙으므로(server.js) 그쪽 일괄 인증을 지나지 않는다 → 여기서 직접 건다.
const authorize = (req, res, next) => require('../services/admin_auth').requireAdminToken(req, res, next);

router.get('/api/admin/location-alert/exposure', authorize, (req, res) => {
    try {
        return res.set('Cache-Control', 'no-store').json(adminExposureBody());
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

router.post('/api/admin/location-alert/exposure', authorize, (req, res) => {
    try {
        const mode = req.body && req.body.exposure;
        if (!exposureStore.MODES.includes(mode)) {
            return res.status(400).json({ ok: false, error: "exposure 는 'user'·'admin'·'off' 중 하나" });
        }
        if (!exposureStore.setExposure(mode)) return res.status(500).json({ ok: false, error: '노출 범위 저장 실패' });
        console.log('[LocationAlert] 노출 범위 변경 → ' + mode);
        return res.set('Cache-Control', 'no-store').json(adminExposureBody());
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

module.exports = router;
