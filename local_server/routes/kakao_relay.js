/**
 * ============================================================================
 * 파일명: local_server/routes/kakao_relay.js
 * 역할  : 태블릿 전용 앱이 카톡 특보 알림톡 글을 보내는 받는 창구, 그리고 관리자가 받은 내용을 보는 창구.
 *         앱은 관리자 로그인 대신 미리 정한 비밀 열쇠(환경변수 KAKAO_RELAY_TOKEN)로 들어온다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/kakao_relay(분해·저장) · services/admin_auth(관리자 조회)
 *  - 서버 API      : POST /api/kakao-relay/messages · POST /api/kakao-relay/heartbeat ·
 *                    POST·GET·DELETE /api/kakao-relay/backfill(임시 긁어오기 — 분석용, 같은 열쇠) ·
 *                    GET /api/admin/kakao-relay
 *  - 마크업        : 없음
 *  - 나를 쓰는 곳  : server.js(등록) · kakao_relay_app(안드로이드 앱) · 검사 test_kakao_relay
 * [로드 순서] server.js 에서 routes/admin 보다 먼저 등록한다(자체 인증).
 * ============================================================================
 */
'use strict';
const express = require('express'),
    crypto = require('crypto'),
    adminAuth = require('../services/admin_auth'),
    { createStore } = require('../services/kakao_relay');

/**
 * 앱의 비밀 열쇠를 검사하는 미들웨어를 만든다. 열쇠가 서버에 설정돼 있지 않으면 창구를 닫는다(503).
 * 예: relayAuth(() => 'abc') — 헤더 X-Relay-Token: abc 만 통과
 * @param {function(): string} getSecret
 * [연계] ← createRouter(이 파일)
 */
function relayAuth(getSecret) {
    return (req, res, next) => {
        const secret = getSecret() || '';
        if (!secret) return res.status(503).json({ ok: false, error: 'KAKAO_RELAY_TOKEN 미설정' });
        const got = Buffer.from(req.get('X-Relay-Token') || '');
        const want = Buffer.from(secret);
        if (got.length === want.length && crypto.timingSafeEqual(got, want)) return next();
        // 열쇠를 잘못 넣은 태블릿이 서버에 흔적 없이 묻히지 않게 기록한다.
        console.warn('[kakao_relay] 열쇠 불일치로 거부', req.path);
        return res.status(401).json({ ok: false, error: '열쇠가 맞지 않습니다' });
    };
}

/**
 * 라우터를 만든다. 검사에서는 저장소·열쇠·관리자 인증을 바꿔 끼운다.
 * 예: createRouter({ store: createStore({file}), getSecret: () => 't', authorize: (q,s,n)=>n() })
 * @returns {import('express').Router}
 * [연계] ← server.js / → services/kakao_relay
 */
function createRouter({
    store = createStore(),
    getSecret = () => process.env.KAKAO_RELAY_TOKEN,
    authorize = adminAuth.requireAdminToken,
} = {}) {
    const router = express.Router();
    const auth = relayAuth(getSecret);

    router.post('/api/kakao-relay/messages', auth, (req, res) => {
        const items = Array.isArray(req.body && req.body.messages) ? req.body.messages : [];
        // 한 번에 받는 양을 넘기면 일부만 받고 성공이라 하지 않는다 — 앱은 50건씩 나눠 보낸다.
        if (items.length > 50) return res.status(413).json({ ok: false, error: '한 번에 50건까지' });
        try {
            const r = store.storeMessages(items, req.body.device);
            if (r.added) console.log(`[kakao_relay] 새 글 ${r.added}건 (중복 ${r.duplicate})`);
            res.json({ ok: true, accepted: items.length, added: r.added, duplicate: r.duplicate });
        } catch (e) {
            console.warn('[kakao_relay] 저장 실패:', e.message);
            res.status(500).json({ ok: false, error: '저장 실패' });
        }
    });

    router.post('/api/kakao-relay/heartbeat', auth, (req, res) => {
        const b = req.body || {};
        try {
            store.heartbeat({ device: String(b.device || ''), battery: b.battery, note: String(b.note || '').slice(0, 200) });
            res.json({ ok: true });
        } catch (e) {
            console.warn('[kakao_relay] 신호 저장 실패:', e.message);
            res.status(500).json({ ok: false, error: '저장 실패' });
        }
    });

    // ── 임시 긁어오기(분석용) — 본 휴대폰의 옛 알림톡. 실시간 기록과 따로 둔다(services/kakao_relay storeBackfill). ──
    router.post('/api/kakao-relay/backfill', auth, (req, res) => {
        const items = Array.isArray(req.body && req.body.messages) ? req.body.messages : [];
        if (items.length > 50) return res.status(413).json({ ok: false, error: '한 번에 50건까지' });
        try {
            const r = store.storeBackfill(items, req.body.device);
            res.json({ ok: true, accepted: items.length, ...r });
        } catch (e) {
            console.warn('[kakao_relay] 긁어오기 저장 실패:', e.message);
            res.status(500).json({ ok: false, error: '저장 실패' });
        }
    });
    router.get('/api/kakao-relay/backfill', auth, (req, res) => {
        res.set('Cache-Control', 'no-store');
        try { res.json(store.backfillAll()); }
        catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });
    router.delete('/api/kakao-relay/backfill', auth, (req, res) => {
        try { res.json({ ok: true, deleted: store.clearBackfill() }); }
        catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    router.get('/api/admin/kakao-relay', authorize, (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json(store.snapshot(Math.min(+req.query.n || 50, 300)));
    });

    return router;
}

module.exports = createRouter();
module.exports.createRouter = createRouter;
