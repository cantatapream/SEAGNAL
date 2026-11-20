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
 *  - 나를 쓰는 곳  : server.js(app.use) · 앱 오늘의 뉴스 화면(다음 단계: client/js/notice/news) · 검사 scripts/test_news_collector.js(글자 확인)
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

router.get('/api/news/img', async (req, res) => {
    const u = String(req.query.u || '');
    if (!/^http:\/\//i.test(u) || !nc().imageKnown(u)) return res.status(404).end();
    try {
        const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
        const type = r.headers.get('content-type') || '';
        if (!r.ok || !/^image\//i.test(type)) return res.status(404).end();
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 3 * 1024 * 1024) return res.status(404).end();   // 카드 사진에 3MB 넘는 것은 받지 않는다
        res.set('Cache-Control', 'public, max-age=86400').type(type).send(buf);
    } catch (e) {
        console.warn('[오늘의 뉴스] 사진 전달 실패:', String((e && e.message) || e).slice(0, 120));
        res.status(404).end();
    }
});

module.exports = router;
