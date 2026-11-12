/**
 * ============================================================================
 * 파일명: local_server/routes/kakao_relay.js
 * 역할  : 태블릿 전용 앱이 카톡 특보 알림톡 글을 보내는 받는 창구, 그리고 관리자가 받은 내용을 보는 창구.
 *         앱은 관리자 로그인 대신 미리 정한 비밀 열쇠(환경변수 KAKAO_RELAY_TOKEN)로 들어온다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/kakao_relay(분해·저장) · services/admin_auth(관리자 조회)
 *  - 서버 API      : POST·GET /api/kakao-relay/messages · POST /api/kakao-relay/heartbeat · POST /api/kakao-relay/seed ·
 *                    POST /api/kakao-relay/diag(앱 진단 기록 — 0.3) ·
 *                    POST·GET·DELETE /api/kakao-relay/backfill(임시 긁어오기 — 분석용, 같은 열쇠) ·
 *                    GET /api/admin/kakao-relay · POST /api/admin/kakao-relay/device(기기 끄기·켜기·지우기) ·
 *                    GET /api/admin/kakao-relay/compare?day=YYYY-MM-DD(비교현황 — services/kakao_shadow.summarize) ·
 *                    GET /api/admin/kakao-relay/report.md?day=YYYY-MM-DD|all(마크다운 보고서 내려받기)
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
    summarize = (o) => require('../services/kakao_shadow').summarize(o),
    report = (o) => require('../services/kakao_shadow').reportMarkdown(o),
} = {}) {
    const router = express.Router();
    const auth = relayAuth(getSecret);

    router.post('/api/kakao-relay/messages', auth, (req, res) => {
        const items = Array.isArray(req.body && req.body.messages) ? req.body.messages : [];
        // 한 번에 받는 양을 넘기면 일부만 받고 성공이라 하지 않는다 — 앱은 50건씩 나눠 보낸다.
        if (items.length > 50) return res.status(413).json({ ok: false, error: '한 번에 50건까지' });
        try {
            // 기준점 결과(found|missing|none)는 앱이 첫 글에 붙여 보낸다(대기열 묶음이 나뉘어도 따라가게).
            const anchorStatus = req.body.anchor || (items.find((i) => i && i.anchor) || {}).anchor;
            const r = store.storeMessages(items, req.body.device, new Date(), { anchor: anchorStatus });
            if (r.added) console.log(`[kakao_relay] 새 글 ${r.added}건 (중복 ${r.duplicate})`);
            // 끈·지운 기기의 글은 받지 않지만 200 으로 답한다 — 앱이 같은 글을 계속 다시 보내지 않게.
            res.json({ ok: true, accepted: items.length, added: r.added, duplicate: r.duplicate, ignored: r.ignored || 0, anchor: r.anchor });
        } catch (e) {
            console.warn('[kakao_relay] 저장 실패:', e.message);
            res.status(500).json({ ok: false, error: '저장 실패' });
        }
    });

    // 같은 열쇠로 실시간 기록을 읽는다 — 휴대폰 시험(2026-11-02)에서 무엇이 들어왔는지 분석하기 위해.
    router.get('/api/kakao-relay/messages', auth, (req, res) => {
        res.set('Cache-Control', 'no-store');
        try { res.json(store.snapshot(Math.min(+req.query.n || 300, 300))); }
        catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    router.post('/api/kakao-relay/heartbeat', auth, (req, res) => {
        const b = req.body || {};
        try {
            const anchor = store.heartbeat({ device: String(b.device || ''), battery: b.battery, note: String(b.note || '').slice(0, 200) });
            // 앱은 이 기준점(마지막으로 본 글의 id)이 화면에 보일 때까지 위로 올라가며 읽는다.
            res.json({ ok: true, anchor });
        } catch (e) {
            console.warn('[kakao_relay] 신호 저장 실패:', e.message);
            res.status(500).json({ ok: false, error: '저장 실패' });
        }
    });

    // 중계 앱 진단 기록(0.3) — 알림 받음·대화방 읽기 결과. 기록장에만 남는다(services/kakao_relay diag).
    router.post('/api/kakao-relay/diag', auth, (req, res) => {
        try { store.diag(req.body && req.body.device, req.body || {}); res.json({ ok: true }); }
        catch (e) { console.warn('[kakao_relay] 진단 기록 실패:', e.message); res.status(500).json({ ok: false, error: '기록 실패' }); }
    });

    // 「이미 봤음」 기억 미리 채우기 — 긁어온 옛 알림톡 글 목록(texts)을 넣는다(services/kakao_relay seed).
    router.post('/api/kakao-relay/seed', auth, (req, res) => {
        const texts = Array.isArray(req.body && req.body.texts) ? req.body.texts : [];
        if (texts.length > 3000) return res.status(413).json({ ok: false, error: '한 번에 3000건까지' });
        try { res.json({ ok: true, ...store.seed(texts) }); }
        catch (e) { res.status(500).json({ ok: false, error: e.message }); }
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

    // 관리자: 기기 끄기·켜기·지우기(3단계 — 휴대폰을 빼고 태블릿만 남기기)
    router.post('/api/admin/kakao-relay/device', authorize, (req, res) => {
        const b = req.body || {};
        if (!b.device || !['enable', 'disable', 'remove'].includes(b.action)) return res.status(400).json({ ok: false, error: 'device·action(enable|disable|remove) 필요' });
        try { res.json(store.setDevice(String(b.device), b.action)); }
        catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // 비교현황 창 — 카톡판 특보현황과 앱 특보현황(MMIS)의 시간대별 비교(services/kakao_shadow.summarize).
    router.get('/api/admin/kakao-relay/compare', authorize, (req, res) => {
        res.set('Cache-Control', 'no-store');
        try { res.json(summarize({ day: String(req.query.day || '') })); }
        catch (e) { console.warn('[kakao_relay] 비교현황 읽기 실패:', e.message); res.status(500).json({ ok: false, error: e.message }); }
    });

    // 마크다운 보고서 내려받기(day=YYYY-MM-DD 또는 all) — 사람이 읽고, 그대로 AI 에게 줘서 분석할 수 있게.
    router.get('/api/admin/kakao-relay/report.md', authorize, (req, res) => {
        const day = String(req.query.day || '');
        try {
            const md = report({ day });
            const name = 'kakao_relay_report_' + (day === 'all' ? 'all' : (/^\d{4}-\d{2}-\d{2}$/.test(day) ? day : 'today')) + '.md';
            res.set('Cache-Control', 'no-store');
            res.set('Content-Type', 'text/markdown; charset=utf-8');
            res.set('Content-Disposition', 'attachment; filename="' + name + '"');
            res.send(md);
        } catch (e) { console.warn('[kakao_relay] 보고서 만들기 실패:', e.message); res.status(500).json({ ok: false, error: e.message }); }
    });

    router.get('/api/admin/kakao-relay', authorize, (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json(store.snapshot(Math.min(+req.query.n || 50, 300)));
    });

    return router;
}

module.exports = createRouter();
module.exports.createRouter = createRouter;
