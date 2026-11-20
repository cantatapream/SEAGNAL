/**
 * ============================================================================
 * 파일명: local_server/routes/fishcond.js
 * 역할  : 「뉴스·공지·어황」 탭의 어황정보 — 우리 서버에 받아 둔 국립수산과학원 어황정보 글 목록과
 *         그 PDF·쪽 그림을 앱에 내려준다(받아 두는 일은 services/fishcond_collector 가 1시간마다 한다).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/fishcond_collector(list · file · state)
 *  - 서버 API      : GET /api/fishcond                 — 글 목록(최신순) + 마지막 확인 결과
 *                    GET /api/fishcond/:id/view        — 쪽 그림을 세로로 이어 붙인 보기 페이지(기상특보 원문 /api/bulletin-doc/…/view 와 같은 모양)
 *                    GET /api/fishcond/:id/page/:n     — n 쪽 그림(PNG)
 *                    GET /api/fishcond/:id/pdf         — 원문 PDF(첨부로 — 사용자 「pdf 다운로드 기능도 반영」)
 *  - 나를 쓰는 곳  : server.js(app.use) · 앱 어황정보 화면(다음 단계: client/js/notice/fishcond) · 검사 scripts/test_fishcond_collector.js(글자 확인)
 * [로드 순서] 없음(서버 라우트)
 * ============================================================================
 */
const express = require('express');
const router = express.Router();
const fc = () => require('../services/fishcond_collector');

router.get('/api/fishcond', (req, res) => {
    const st = fc().state();
    res.set('Cache-Control', 'no-cache').json({
        posts: fc().list(),
        // 화면이 「마지막 확인」을 띄울 수 있게 — 확인이 멈췄는데 목록만 그대로 보이면 낡은 줄 모른다
        state: st ? { lastRun: st.lastRun, ok: st.ok } : null,
    });
});

// 글 ID·쪽 번호는 꼴을 확인한 뒤에만 파일을 찾는다(fishcond_collector.file — 바깥 글자를 경로에 붙이지 않는다). 원문은 안 바뀌므로 오래 캐시한다.
router.get('/api/fishcond/:id/view', (req, res) => {
    const id = String(req.params.id || ''), post = fc().get(id);
    const pages = post ? Array.from({ length: post.pages || 0 }, (_, i) => i + 1).filter((n) => fc().file(id, n)) : [];
    if (!pages.length) return res.status(404).type('text/plain; charset=utf-8').send('어황정보 미리보기가 없습니다(아직 만드는 중이거나 만들지 못했습니다).');
    const imgs = pages.map((n, i) => (i ? '<div class="gap"></div>' : '') + '<img src="page/' + n + '" alt="어황정보 ' + n + '쪽"' + (i ? ' loading="lazy"' : '') + '>').join('');
    res.set('Cache-Control', 'no-cache').type('text/html; charset=utf-8').send('<!doctype html><html lang="ko"><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5">'
        + '<title>어황정보</title><style>html,body{margin:0;background:#fff}img{display:block;width:100%;height:auto}.gap{height:10px;background:#d7dbe0}</style></head>'
        + '<body>' + imgs + '</body></html>');
});
router.get('/api/fishcond/:id/page/:n', (req, res) => {
    const f = fc().file(String(req.params.id || ''), +req.params.n);
    if (!f) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=604800, immutable').type('image/png').sendFile(f);
});
router.get('/api/fishcond/:id/pdf', (req, res) => {
    const id = String(req.params.id || ''), f = fc().file(id, 'pdf');
    if (!f) return res.status(404).end();
    const post = fc().get(id), name = String((post && (post.title + '.pdf')) || (id + '.pdf')).replace(/[\\/:*?"<>|\r\n]/g, ' ');
    // 한글 파일 이름 — filename 에는 ASCII 대체 이름, filename* 에 UTF-8 원래 이름(RFC 6266)
    res.set('Cache-Control', 'public, max-age=604800, immutable')
        .set('Content-Disposition', 'attachment; filename="' + id + '.pdf"; filename*=UTF-8\'\'' + encodeURIComponent(name))
        .type('application/pdf').sendFile(f);
});

module.exports = router;
