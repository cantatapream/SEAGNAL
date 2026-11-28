/**
 * ============================================================================
 * 파일명: local_server/scripts/test_promo_lite.js
 * 역할  : 공지 목록이 본문(사진 base64) 없이 가볍게 오고, 같은 목록을 두 번씩 받지 않는지 본다(2026-11-28).
 *         사용자 「공지사항이 누적될수록 리스트로딩이 느려지는것 같은데」 → 조사: 목록이 본문째 9.5MB(운영 60개, 98% 사진) +
 *         켤 때 2번·탭 한 번에 2번·글 열 때 1번 더 받았다 → 「1+2 추천대로 진행해줘. 검색은 제목만」.
 *         ① 서버 GET /api/promo?lite=1 — 제목·분류·날짜·고정·조회수만(본문·첨부 없음). lite 없이는 종전대로 본문째 · ?page= 도 종전대로
 *         ② 앱을 켜면 목록 1번(lite) · 공지 탭을 한 번 누르면 1번 더(lite) · 글을 열어도 목록을 다시 받지 않고 그 줄 조회수만 바뀐다
 *         ③ 검색은 제목만 — 본문에만 있는 낱말로는 안 찾힌다
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 시험 대상     : local_server/routes/content.js GET /api/promo · client/js/notice/board/promo.js(loadPromoPosts·renderPromoPosts·openPromoDetail) ·
 *                    client/js/notice/hub/notice_hub.js refreshBadges · client/js/admin/admin_collect.js initPromoBadges · forecast/alerts/marine.js switchMainTab
 *  - 서버          : ① 실제 routes/content.js 를 임의 포트에 띄우고 dataCache.promo 에 시험 글을 넣는다.
 *                    ②③ 자체 express — /api/promo(/:id) 는 시험 자료·요청 기록, 그 밖의 /api 는 404, 127.0.0.1 밖 요청은 끊는다.
 *  - 나를 쓰는 곳  : scripts/refactor/verify_all.sh SUITES
 * [로드 순서] 독립 검사.
 * [실행] NODE_PATH=/opt/node-tools/node_modules:/home/user/SEAGNAL/local_server/node_modules node local_server/scripts/test_promo_lite.js
 * ============================================================================
 */
'use strict';
const path = require('path'), assert = require('assert'), express = require('express'), { chromium } = require('playwright-core');
const root = path.join(__dirname, '../..');

const POSTS = [
    { id: 1, title: '바다 안전 안내', category: 'NOTICE', isPinned: false, createdAt: '2026.11.20 10:00', views: 5, content: '<p>본문에만 있는 낱말 고래상어</p><img src="data:image/jpeg;base64,' + 'A'.repeat(5000) + '">', format: 'md', attachments: [{ name: 'a.pdf' }], allowComments: true },
    { id: 2, title: '고래상어 출현 공지', category: 'NOTICE', isPinned: true, createdAt: '2026.11.21 10:00', views: 9, content: '<p>짧은 글</p>', attachments: [], allowComments: true }
];

let pass = 0, fail = 0;
/** 사례 하나. 실패도 모두 찍고 끝에 요약. @param {string} name @param {function} fn [연계] ← 아래 시나리오 */
async function check(name, fn) { try { await fn(); console.log('✅', name); pass++; } catch (e) { console.error('❌', name, e && e.message); fail++; } }

(async () => {
    let browser, s1, s2;
    try {
        // ① 실제 서버 경로
        const { dataCache } = require(path.join(root, 'local_server/services/cache_manager'));
        const contentRouter = require(path.join(root, 'local_server/routes/content'));
        const a1 = express(); a1.use(contentRouter);
        s1 = a1.listen(0, '127.0.0.1'); await new Promise((r) => s1.once('listening', r));
        const b1 = 'http://127.0.0.1:' + s1.address().port;
        await check('① 서버 ?lite=1 은 제목·분류·날짜·고정·조회수만 · lite 없이는 본문째 · ?page= 는 종전 꼴', async () => {
            dataCache.promo = JSON.parse(JSON.stringify(POSTS));
            const lite = await (await fetch(b1 + '/api/promo?lite=1')).json();
            assert.deepStrictEqual(lite.map((p) => Object.keys(p).sort().join(',')), ['category,createdAt,id,isPinned,title,views', 'category,createdAt,id,isPinned,title,views']);
            assert.deepStrictEqual(lite.map((p) => p.title), POSTS.map((p) => p.title));
            const full = await (await fetch(b1 + '/api/promo')).json();
            assert.ok(full[0].content && full[0].attachments, '관리자 화면이 쓰는 기본 꼴은 본문째');
            const pg = await (await fetch(b1 + '/api/promo?page=1&limit=1')).json();
            assert.ok(pg.data.length === 1 && pg.data[0].content && pg.pagination.total === 2, JSON.stringify(pg.pagination));
        });

        // ②③ 앱 화면
        const hits = [];
        const app = express();
        app.get('/api/promo', (req, res) => { hits.push(req.originalUrl); const lite = req.query.lite != null; res.json(POSTS.map((p) => lite ? { id: p.id, title: p.title, category: p.category, isPinned: p.isPinned, createdAt: p.createdAt, views: p.views } : p)); });
        app.get('/api/promo/:id', (req, res) => { const p = POSTS.find((x) => String(x.id) === req.params.id); if (!p) return res.status(404).json({}); res.json(Object.assign({}, p, { views: p.views + 100 })); });
        app.get('/api/reactions/counts', (req, res) => res.json({}));
        app.get('/api/reactions', (req, res) => res.json({ heartCount: 0, thumbsCount: 0, wowCount: 0, myReaction: null }));
        app.get('/api/comments/counts', (req, res) => res.json({}));
        app.get('/api/comments', (req, res) => res.json([]));
        app.get('/api/boards', (req, res) => res.json([{ id: 'NOTICE', name: '공지', badgeText: '공지' }]));
        app.get('/', (req, res) => res.sendFile(path.join(root, 'client/index2.html')));
        app.use(express.static(path.join(root, 'client')));
        app.use('/api', (req, res) => res.status(404).json({ ok: false }));
        s2 = app.listen(0, '127.0.0.1'); await new Promise((r) => s2.once('listening', r));
        const base = 'http://127.0.0.1:' + s2.address().port;

        browser = await chromium.launch({ ...((process.env.PW_CHROME || process.env.SIM_CHROMIUM || process.env.CHROMIUM_EXECUTABLE) ? { executablePath: process.env.PW_CHROME || process.env.SIM_CHROMIUM || process.env.CHROMIUM_EXECUTABLE } : {}), headless: true, args: ['--no-sandbox'] });
        const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, timezoneId: 'Asia/Seoul' }), page = await ctx.newPage();
        await page.route('**/*', (r) => r.request().url().startsWith(base) ? r.continue() : r.abort());
        await page.goto(base + '/');
        await page.waitForFunction(() => typeof window.openPromoDetail === 'function' && typeof window.switchMainTab === 'function');
        await page.waitForTimeout(6500);   // notice_hub.js refreshBadges(4초 뒤)까지 지나게
        await page.evaluate(() => ['server-maintenance-popup', 'network-error-popup', 'splash-screen', 'main-notice-popup', 'zone-guide-popup', 'survey-user-popup'].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); }));

        await check('② 앱을 켜면 공지 목록 1번(가벼운 꼴)', async () => {
            assert.deepStrictEqual(hits.splice(0), ['/api/promo?lite=1']);
        });
        await check('② 공지 탭을 한 번 누르면 목록 1번(가벼운 꼴) — 종전 2번', async () => {
            await page.click('.tab-btn[data-target="promo-section"]');
            await page.waitForFunction(() => document.querySelectorAll('#promo-list .promo-item').length === 2);
            await page.waitForTimeout(800);
            assert.deepStrictEqual(hits.splice(0), ['/api/promo?lite=1']);
        });
        await check('② 글을 열어도 목록을 다시 받지 않는다 · 목록의 그 줄 조회수는 받은 값으로 바뀐다', async () => {
            await page.evaluate(() => window.openPromoDetail(1));
            await page.waitForFunction(() => !document.getElementById('promo-detail-modal').classList.contains('hidden'));
            await page.waitForTimeout(800);
            assert.deepStrictEqual(hits.splice(0), [], '목록 요청 없음');
            const body = (await page.$eval('#promo-detail-content', (e) => e.textContent)).replace(/\u2060/g, '');   // 한글 줄바꿈용 보이지 않는 글자(U+2060)는 빼고 본다
            assert.ok(/본문에만 있는 낱말/.test(body), '본문은 글을 열 때 받아 보인다 ' + JSON.stringify(body.slice(0, 120)));
            const views = await page.$$eval('#promo-list .promo-item', (xs) => xs.map((x) => x.querySelector('.promo-item-title').textContent.replace(/\s+/g, ' ').trim() + ':' + x.querySelector('.promo-item-views').textContent.trim()));
            assert.ok(views.some((v) => /바다 안전 안내.*:105$/.test(v)), JSON.stringify(views));
            await page.evaluate(() => window.closePromoDetail && window.closePromoDetail());
        });
        await check('③ 검색은 제목만 — 본문에만 있는 낱말로는 찾히지 않는다', async () => {
            await page.fill('#promo-search-input', '고래상어');
            await page.evaluate(() => window.searchPromo());
            const titles = await page.$$eval('#promo-list .promo-item .promo-item-title', (xs) => xs.map((x) => x.textContent.trim()));
            assert.equal(titles.length, 1, JSON.stringify(titles));
            assert.ok(/고래상어 출현 공지/.test(titles[0]), JSON.stringify(titles));
        });
    } catch (e) {
        console.error('❌ 시험 준비 실패', e && e.message); fail++;
    } finally {
        if (browser) await browser.close();
        if (s1) s1.close(); if (s2) s2.close();
        console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
        process.exit(fail ? 1 : 0);
    }
})();
