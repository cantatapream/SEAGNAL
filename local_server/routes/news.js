/**
 * ============================================================================
 * 파일명: local_server/routes/news.js
 * 역할  : 「뉴스·공지·어황」 탭의 오늘의 뉴스 — 날짜별 카드 목록·보관 날짜·펼친 횟수 기록·http 사진 전달을 앱에 내준다
 *         (모으고 판정하는 일은 services/news_collector 가 1시간마다 한다).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/news_collector(day · dates · hit · state · imageKnown)
 *  - 서버 API      : GET  /api/news?date=YYYY-MM-DD      — 그날 카드(최신순) + 보관 날짜(달력) + 마지막 갱신(「최종 업데이트」). date 없으면 오늘(KST)
 *                    POST /api/news/:date/:id/open       — 카드를 펼친 횟수 1(?admin=true 는 하루 1번 — 사용자 「아코디언 열어본 횟수도 기록」)
 *                    GET  /api/news/img?u=…              — http:// 사진을 받아 바로 전달(저장하지 않음 — 앱(https) 안에서는 http 사진이 막힌다).
 *                                                         우리 카드에 실린 주소만(아무 주소나 대신 받아 주는 통로가 되지 않게).
 *                    관리자(X-Admin-Token — services/admin_auth.requireAdminToken):
 *                    GET  /api/admin/news?date=              — 그날 카드(숨긴 것 포함)·AI 가 뺀 기사 + 상태·검색어·보관 날짜
 *                    POST /api/admin/news/:date/:id/hide     — { hidden } 카드 숨기기·다시 보이기
 *                    POST /api/admin/news/:date/publish      — { index, cat, link } 뺀 기사 싣기(link 가 있으면 그것으로 찾는다)
 *                    POST /api/admin/news/keywords           — { keywords:[…] } 검색어 저장
 *                    POST /api/admin/news/run                — 지금 갱신(기다리지 않음)
 *  - 나를 쓰는 곳  : server.js(app.use) · client/js/notice/news/news.js(앱) · client/js/admin/admin_news_hub.js(관리자) · 검사 scripts/test_news_collector.js·test_news_admin.js
 * [로드 순서] 없음(서버 라우트)
 * ============================================================================
 */
const express = require('express');
const router = express.Router();
const nc = () => require('../services/news_collector');

router.get('/api/news', (req, res) => {
    const d = req.query.date ? String(req.query.date) : nc().kstDate(Date.now());
    const day = nc().day(d);
    if (!day) return res.status(400).json({ error: 'date 는 YYYY-MM-DD' });
    const st = nc().state();
    res.set('Cache-Control', 'no-cache').json(Object.assign(day, {
        dates: nc().dates(),
        state: st ? { lastRun: st.lastRun, ok: st.ok } : null,
    }));
});

router.post('/api/news/:date/:id/open', (req, res) => {
    const n = nc().hit(String(req.params.date), String(req.params.id), req.query.admin === 'true');
    if (n === null) return res.status(404).json({ error: '없는 카드' });
    res.json({ views: n });
});

/** 내부 주소인가 — og:image 는 바깥 기사 페이지가 정하므로 127.0.0.1·사설망 주소가 올 수 있다(검토 지적). 예: isPrivateHost('10.0.0.5') → true */
function isPrivateHost(h) {
    h = String(h || '').toLowerCase().replace(/^\[|\]$/g, '');
    return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h === '::1' || h === '0.0.0.0'
        || /^(127|10)\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h);
}
router.get('/api/news/img', async (req, res) => {
    const u = String(req.query.u || '');
    let host = '';
    try { host = new URL(u).hostname; } catch (_) { return res.status(404).end(); }
    if (!/^http:\/\//i.test(u) || isPrivateHost(host) || !nc().imageKnown(u)) return res.status(404).end();
    try {
        const r = await fetch(u, { signal: AbortSignal.timeout(8000), redirect: 'manual' });   // 넘겨주기(리다이렉트)를 따라가지 않는다 — 다른 곳(내부 주소)으로 돌려 보내는 길을 막는다
        const type = r.headers.get('content-type') || '';
        if (!r.ok || !/^image\//i.test(type)) return res.status(404).end();
        if (Number(r.headers.get('content-length') || 0) > 3 * 1024 * 1024) return res.status(404).end();   // 받기 전에 크기부터
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 3 * 1024 * 1024) return res.status(404).end();   // 카드 사진에 3MB 넘는 것은 받지 않는다
        res.set('Cache-Control', 'public, max-age=86400').type(type).send(buf);
    } catch (e) {
        console.warn('[오늘의 뉴스] 사진 전달 실패:', String((e && e.message) || e).slice(0, 120));
        res.status(404).end();
    }
});

// ── 관리자(2026-11-21 시안 8-3) ──────────────────────────────────────────
const auth = (req, res, next) => require('../services/admin_auth').requireAdminToken(req, res, next);
const reportFail = (res, e) =>   // 운영 기록(console.error) + 500 — 오류를 조용히 삼키지 않는다(test_silent_catch)
    { console.error('[오늘의 뉴스 관리자]', e && e.message); res.status(500).json({ ok: false, error: String((e && e.message) || e) }); };
router.get('/api/admin/news', auth, (req, res) => {
    try {
        const d = req.query.date ? String(req.query.date) : nc().kstDate(Date.now());
        const day = nc().adminDay(d);
        if (!day) return res.status(400).json({ ok: false, error: 'date 는 YYYY-MM-DD' });
        res.set('Cache-Control', 'no-store').json(Object.assign({ ok: true, state: nc().state(), running: nc().running(), keywords: nc().keywords(), dates: nc().dates() }, day));
    } catch (e) { reportFail(res, e); }
});
router.post('/api/admin/news/run', auth, (req, res) => { try { res.json(Object.assign({ ok: true }, nc().runNow())); } catch (e) { reportFail(res, e); } });
router.post('/api/admin/news/keywords', auth, express.json(), (req, res) => {
    try { const r = nc().setKeywords(req.body && req.body.keywords); res.status(r.ok ? 200 : 400).json(r); } catch (e) { reportFail(res, e); }
});
router.post('/api/admin/news/:date/publish', auth, express.json(), async (req, res) => {
    try { const b = req.body || {}; const r = await nc().publish(String(req.params.date), Number(b.index), b.cat, typeof b.link === 'string' ? b.link : ''); res.status(r.ok ? 200 : 404).json(r); } catch (e) { reportFail(res, e); }
});
router.post('/api/admin/news/:date/:id/hide', auth, express.json(), async (req, res) => {
    try { const ok = await nc().setHidden(String(req.params.date), String(req.params.id), !!(req.body && req.body.hidden)); res.status(ok ? 200 : 404).json({ ok }); } catch (e) { reportFail(res, e); }
});

module.exports = router;
