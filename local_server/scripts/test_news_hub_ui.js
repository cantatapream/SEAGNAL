/**
 * ============================================================================
 * 파일명: local_server/scripts/test_news_hub_ui.js
 * 역할  : 「뉴스·공지·어황」 탭(2026-11-21)을 실제 Chromium 으로 index2.html 전체를 띄워 본다 —
 *         하단 탭 이름·안쪽 탭 3칸(밑줄+아이콘)·처음 보일 칸(24시간 공지 규칙)·오늘의 뉴스 날짜줄(날짜 가운데, [오늘]은 ▶ 오른쪽, 달력 맨 오른쪽)·
 *         카드(꼬리표를 사진 위에, 오른쪽 아래 펼친 횟수+시각)·아코디언(펼침 → 다시 누르면 기사, 다른 카드 누르면 접힘)·달력(보관 날짜만)·빈 목록·
 *         공지 목록(알약 없음, 조회·날짜 맨 오른쪽)·어황 목록(바다 꼬리표, 쪽수 없음, 조회·날짜·부서 맨 오른쪽)·어황 팝업(쪽 그림·PDF 받기)·N 표시.
 *         412px 스크린샷을 NHUB_SHOT_DIR(없으면 임시 폴더)에 남긴다.
 * 사용자 확정: client/js/notice/news_hub.design.md §1·§1-2(원문 인용)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 시험 대상     : client/index2.html #promo-section · client/js/notice/hub/notice_hub.js · notice/news/news.js · notice/fishcond/fishcond.js · notice/board/promo.js · client/style.css
 *  - 서버          : 자체 express(임의 포트) — /api/promo·/api/news·/api/fishcond 는 시험 자료. 그 밖의 /api 는 404, 127.0.0.1 밖 요청은 끊는다.
 *  - 나를 쓰는 곳  : scripts/refactor/verify_all.sh SUITES
 * [로드 순서] 독립 검사.
 * [실행] NODE_PATH=/opt/node-tools/node_modules:/home/user/SEAGNAL/local_server/node_modules node local_server/scripts/test_news_hub_ui.js
 * ============================================================================
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), express = require('express'), { chromium } = require('playwright-core');
const root = path.join(__dirname, '../..');
const SHOT = process.env.NHUB_SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'nhub-shot-'));
fs.mkdirSync(SHOT, { recursive: true });

const kst = (ms) => new Date(ms + 9 * 3600000);
const TODAY = kst(Date.now()).toISOString().slice(0, 10), YDAY = kst(Date.now() - 86400000).toISOString().slice(0, 10);
const promoAt = (ms) => { const k = kst(ms); return k.toISOString().slice(0, 10).replace(/-/g, '.') + ' ' + k.toISOString().slice(11, 16); };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const CARDS = [
    { id: 'n0000000001', title: '암컷 대게, 잡아도 팔아도 처벌…12월 1일부터 특별단속', summary: '울진해경이 12월 1일부터 3개월간 대게 불법 포획·유통을 단속한다. 암컷과 몸길이 9cm 이하 대게를 잡거나 팔면 처벌된다. 동해해경청도 같은 기간 단속에 나선다.', cat: 'duty', catName: '처벌·의무', region: '경북', time: '11.20 14:36', pubMs: Date.now() - 3600000, source: '경북매일', more: 6, image: 'https://img.test/a.jpg', views: 23, link: 'https://www.kbmaeil.com/article/1' },
    { id: 'n0000000002', title: '해광호 실종 사흘째…해경, 추정 위치 수중수색', summary: '해경은 서격렬비도 북서쪽 22해리를 추정 위치로 보고 수중 수색에 나섰다.', cat: 'safety', catName: '안전', region: '충남', time: '11.20 10:56', pubMs: Date.now() - 2 * 3600000, source: '연합뉴스', more: 20, image: 'http://news.test/b.jpg', views: 41, link: 'https://www.yna.co.kr/view/2' },
    { id: 'n0000000003', title: '○○군, 어선 장비 지원사업 신청 접수', summary: '어선 안전장비 구입비를 지원한다.', cat: 'money', catName: '돈', region: '', time: '11.20 09:00', pubMs: Date.now() - 3 * 3600000, source: 'gun.go.kr', more: 0, image: '', views: 0, link: 'https://gun.go.kr/3' },
];
const FC = [
    { id: '20261120132915271ZVR', title: '서해주간해어황정보 제26-48호', dept: '기후환경자원과', date: '2026-11-20', sea: '서해', pages: 5, status: 'ok', views: 6, sourceUrl: 'https://www.nifs.go.kr/x?BBS_ID=20261120132915271ZVR' },
    { id: '20261119154811984NIA', title: '주간해어황정보 제26-48호', dept: '연근해자원과', date: '2026-11-19', sea: '전국', pages: 0, status: 'convert_failed', views: 18, sourceUrl: 'https://www.nifs.go.kr/x?BBS_ID=20261119154811984NIA' },
];

let pass = 0, fail = 0;
async function check(name, fn) { try { await fn(); console.log('✅', name); pass++; } catch (e) { console.error('❌', name, e && e.message); fail++; } }

(async () => {
    let browser, server;
    const hits = { open: [], view: [], img: 0, req: { news: 0, promo: 0, fishcond: 0 } };
    const S = { promo: [], newsToday: CARDS, lastRun: new Date().toISOString(), dates: [YDAY, TODAY], promoDelay: 0, fc: FC };
    try {
        const app = express();
        app.get('/api/promo', (req, res) => { hits.req.promo++; setTimeout(() => res.json(S.promo), S.promoDelay); });
        app.get('/api/boards', (req, res) => res.json([{ id: 'notice', name: '공지사항', badgeText: '공지', badgeColor: '#ff5252' }, { id: 'patch', name: '패치노트', badgeText: '패치', badgeColor: '#ffab40' }]));
        app.get('/api/reactions/counts', (req, res) => res.json({}));
        app.get('/api/comments/counts', (req, res) => res.json({}));
        app.get('/api/news', (req, res) => {
            hits.req.news++;
            const d = req.query.date || TODAY;
            res.json({ date: d, cards: d === TODAY ? S.newsToday : d === YDAY ? [CARDS[2]] : [], dates: S.dates, state: { lastRun: S.lastRun, ok: true } });
        });
        app.post('/api/news/:date/:id/open', (req, res) => { hits.open.push(req.params.id + (req.query.admin ? '@admin' : '')); res.json({ views: 99 }); });
        app.get('/api/news/img', (req, res) => { hits.img++; res.type('image/png').send(PNG); });
        app.get('/api/fishcond', (req, res) => { hits.req.fishcond++; res.json({ posts: S.fc, state: { lastRun: new Date().toISOString(), ok: true } }); });
        app.get('/api/fishcond/:id/view', (req, res) => { hits.view.push(req.params.id); res.type('html').send('<html><body style="margin:0"><div style="height:1500px;background:#eef">쪽 그림</div></body></html>'); });
        app.get('/', (req, res) => res.sendFile(path.join(root, 'client/index2.html')));
        app.use(express.static(path.join(root, 'client')));
        app.use('/api', (req, res) => res.status(404).json({ ok: false }));
        server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
        const base = 'http://127.0.0.1:' + server.address().port;
        browser = await chromium.launch({ ...((process.env.PW_CHROME || process.env.SIM_CHROMIUM || process.env.CHROMIUM_EXECUTABLE) ? { executablePath: process.env.PW_CHROME || process.env.SIM_CHROMIUM || process.env.CHROMIUM_EXECUTABLE } : {}), headless: true, args: ['--no-sandbox'] });
        const errors = [];
        const clean = (page) => page.evaluate(() => ['server-maintenance-popup', 'network-error-popup', 'splash-screen', 'main-notice-popup', 'zone-guide-popup', 'survey-user-popup'].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); }));
        const fresh = async (ls, opt) => {
            opt = opt || {};
            const ctx = await browser.newContext({ viewport: { width: opt.width || 412, height: 915 }, timezoneId: opt.tz || 'Asia/Seoul', deviceScaleFactor: 2, hasTouch: !!opt.touch }), page = await ctx.newPage();
            page.on('pageerror', (e) => errors.push(e.message));
            await page.route('**/*', (r) => (r.request().url().startsWith(base) || r.request().url().startsWith('https://img.test/')) ? (r.request().url().startsWith('https://img.test/') ? r.fulfill({ contentType: 'image/png', body: PNG }) : r.continue()) : r.abort());
            await page.addInitScript((x) => { try { localStorage.setItem('seagnal_device_id', 'test-device'); for (const k of Object.keys(x || {})) localStorage.setItem(k, x[k]); } catch (e) { /* 저장소 없음 */ } window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; }, ls || {});
            await page.goto(base + '/');
            await page.waitForFunction(() => window.NoticeHub && window.NewsTab && window.FishcondTab && typeof window.switchMainTab === 'function');
            await page.waitForTimeout(1200); await clean(page);
            return page;
        };
        const openTab = async (page) => { await page.evaluate(() => window.switchMainTab('promo-section')); };

        // ── A. 24시간 안 공지 없음 → 오늘의 뉴스부터
        S.promo = [{ id: 1, title: '지난주 공지', createdAt: promoAt(Date.now() - 3 * 86400000), category: 'notice', views: 6 }];
        const page = await fresh();
        await openTab(page);
        await page.waitForFunction(() => window.NoticeHub.current() === 'news' && document.querySelectorAll('#news-list .news-card').length === 3, null, { timeout: 8000 });

        await check('하단 탭 이름 「뉴스·공지·어황」 · 화면 제목 같음 · 안쪽 탭 3칸(아이콘+글자) · 알약 필터 없음', async () => {
            assert.equal((await page.textContent('.main-tabs .tab-btn[data-target="promo-section"] .tab-btn-label')).replace(/N$/, '').trim(), '뉴스·공지·어황');
            assert.ok(/뉴스·공지·어황/.test(await page.textContent('#promo-section .section-title')));
            assert.deepStrictEqual(await page.$$eval('#nhub-tabs .nhub-tab', (bs) => bs.map((b) => [b.dataset.nhub, b.querySelector('.nhub-tab-label').textContent, !!b.querySelector('i')])), [['news', '오늘의 뉴스', true], ['notice', '공지사항', true], ['fishcond', '어황정보', true]]);
            assert.equal(await page.$('#promo-tabs-container'), null);
            assert.equal(await page.$$eval('.promo-tab-btn', (x) => x.length), 0);
        });
        await check('[처음 칸] 24시간 안 공지가 없으면 오늘의 뉴스가 열려 있다(밑줄)', async () => {
            assert.equal(await page.$eval('#nhub-tabs .nhub-tab.active', (b) => b.dataset.nhub), 'news');
            assert.ok(await page.$eval('#nhub-news', (p) => getComputedStyle(p).display !== 'none'));
            assert.ok(await page.$eval('#nhub-notice', (p) => getComputedStyle(p).display === 'none'));
        });
        await check('[날짜줄] 「◀ 날짜 ▶」가 화면 가운데 · [오늘]은 ▶ 바로 오른쪽 · 달력은 맨 오른쪽 · 오늘이면 ▶ 못 누름', async () => {
            const g = await page.evaluate(() => {
                const r = (e) => e.getBoundingClientRect(), row = r(document.getElementById('news-dateline'));
                const mid = document.querySelector('#news-dateline .mid'), lab = mid.querySelector('.news-dlabel'), btns = mid.querySelectorAll('button');
                const today = [...document.querySelectorAll('#news-dateline .rt button')].find((b) => b.textContent === '오늘'), cal = document.querySelector('#news-dateline .rt button[aria-label^="달력"]');
                return { rowC: row.left + row.width / 2, labC: r(lab).left + r(lab).width / 2, label: lab.textContent, nextR: r(btns[1]).right, nextDis: btns[1].disabled, todayL: r(today).left, calR: r(cal).right, rowR: row.right, sameRow: Math.abs(r(today).top - r(btns[1]).top) < 4 };
            });
            assert.ok(Math.abs(g.rowC - g.labC) < 3, JSON.stringify(g));
            assert.ok(g.todayL - g.nextR >= 0 && g.todayL - g.nextR <= 10 && g.sameRow, JSON.stringify(g));
            assert.ok(Math.abs(g.rowR - g.calR) < 2, JSON.stringify(g));
            assert.ok(/^\d{1,2}월 \d{1,2}일\([일월화수목금토]\)$/.test(g.label) && g.nextDis, JSON.stringify(g));
        });
        await check('[최종 업데이트] 시각·건수', async () => { assert.ok(/^최종 업데이트 \d{2}:\d{2} · 3건$/.test(await page.textContent('#news-updated')), await page.textContent('#news-updated')); });
        await check('[카드] 꼬리표는 사진 위 · 「외 N건」 · 오른쪽 아래에 펼친 횟수(눈)+시각 · 사진 없으면 분류 그림 · http 사진은 서버가 전달', async () => {
            const c = await page.$$eval('#news-list .news-card', (cs) => cs.map((x) => ({ tagInThumb: !!x.querySelector('.news-thumb .news-cat'), src: x.querySelector('.news-foot .src').textContent, rt: [...x.querySelector('.news-foot .rt').children].map((s) => s.textContent.trim()).join(' '), eye: !!x.querySelector('.news-foot .rt .fa-eye'), img: (x.querySelector('.news-thumb img') || {}).src || '', def: !!x.querySelector('.def-ico') })));
            assert.ok(c.every((x) => x.tagInThumb && x.eye), JSON.stringify(c));
            assert.equal(c[0].src, '경북매일 외 6건'); assert.equal(c[0].rt, '23 11.20 14:36');
            assert.ok(/\/api\/news\/img\?u=http%3A%2F%2Fnews\.test%2Fb\.jpg/.test(c[1].img), c[1].img);
            assert.ok(c[2].def && !c[2].img, JSON.stringify(c[2]));
            const rt = await page.$eval('#news-list .news-card .news-foot', (f) => { const a = f.getBoundingClientRect(), b = f.querySelector('.rt').getBoundingClientRect(); return a.right - b.right; });
            assert.ok(rt < 2, '오른쪽 끝 정렬 ' + rt);
        });
        await page.screenshot({ path: path.join(SHOT, '1_news.png') });
        await check('[카드] 사진 위 분류 꼬리표가 사진 칸 안에 다 들어간다 — 긴 이름(「조업·이용 규칙」 79px > 칸 78px)은 두 줄(사용자 2026-11-22 「사진 안에 텍스트가 길어서 잘리는」)', async () => {
            const r = await page.evaluate(() => {
                const t = document.querySelector('#news-list .news-thumb'); const names = ['돈', '처벌·의무', '조업·이용 규칙', '안전', '바다 여건', '갈등·제도'];
                const old = t.querySelector('.news-cat'); const out = [];
                for (const nm of names) { const sp = document.createElement('span'); sp.className = 'news-cat conflict'; sp.textContent = nm; t.appendChild(sp); const a = t.getBoundingClientRect(), c = sp.getBoundingClientRect(); out.push([nm, c.right <= a.right + 0.5 && c.bottom <= a.bottom + 0.5 && sp.scrollWidth <= sp.clientWidth + 1]); sp.remove(); }
                return { out, oldOk: !!old };
            });
            assert.ok(r.oldOk && r.out.every((x) => x[1]), JSON.stringify(r));
        });
        await check('[아코디언] 누르면 펼침 + 펼친 횟수 기록·갱신 → 다른 카드 누르면 앞 카드 접힘 → 펼친 카드를 다시 누르면 기사 열기', async () => {
            const cards = await page.$$('#news-list .news-card');
            await cards[0].click(); await page.waitForTimeout(300);
            assert.deepStrictEqual(await page.$$eval('#news-list .news-card', (cs) => cs.map((x) => x.classList.contains('open'))), [true, false, false]);
            assert.deepStrictEqual(hits.open, ['n0000000001']);
            assert.equal(await page.$eval('#news-list .news-card [data-news-views]', (v) => v.textContent.trim()), '99');
            assert.ok(await page.$eval('#news-list .news-card.open .news-sum', (s) => getComputedStyle(s).display === 'block'));
            await page.screenshot({ path: path.join(SHOT, '2_news_open.png') });
            await cards[1].click(); await page.waitForTimeout(200);
            assert.deepStrictEqual(await page.$$eval('#news-list .news-card', (cs) => cs.map((x) => x.classList.contains('open'))), [false, true, false]);
            await cards[1].click(); await page.waitForTimeout(200);
            assert.deepStrictEqual(await page.evaluate(() => window.__opened), ['https://www.yna.co.kr/view/2']);
            assert.equal(hits.open.length, 2, '다시 눌러 기사를 열 때는 횟수를 또 세지 않는다');
        });
        await check('[달력] 보관 날짜만 누를 수 있다 → 어제를 누르면 그날 목록 · 「다음날」로 오늘 복귀', async () => {
            await page.click('#news-dateline button[aria-label^="달력"]');
            await page.waitForSelector('#news-cal-wrap');
            const have = await page.$$eval('#news-cal-wrap .news-cal-g button.have', (b) => b.map((x) => x.textContent));
            assert.ok(have.length >= 1 && have.length <= 2 && have.includes(String(+TODAY.slice(8))), JSON.stringify(have));
            await page.screenshot({ path: path.join(SHOT, '3_calendar.png') });
            if (YDAY.slice(0, 7) === TODAY.slice(0, 7)) {
                await page.click('#news-cal-wrap .news-cal-g button.have:not(.today)');
                await page.waitForFunction(() => !document.getElementById('news-cal-wrap') && document.querySelectorAll('#news-list .news-card').length === 1);
                await page.click('#news-dateline .mid button[aria-label="다음날"]');
                await page.waitForFunction(() => document.querySelectorAll('#news-list .news-card').length === 3);
            } else { await page.click('#news-cal-wrap'); }
        });

        // 공지 칸 — 알약 없음 · 조회·날짜가 맨 오른쪽(반응 · 조회 · 날짜 순)
        await check('[공지사항] 검색창+목록 · 줄 끝에 반응·조회(눈)·날짜 순으로 맨 오른쪽', async () => {
            await page.click('#nhub-tabs .nhub-tab[data-nhub="notice"]');
            await page.waitForFunction(() => document.querySelectorAll('#promo-list .promo-item').length === 1);
            // 정렬은 화면 위치로 본다 — 계산된 justify-content 글자는 브라우저 판마다 다르다(GitHub 검사 브라우저는 flex-end 를 'flow-end' 로 돌려줘 실패했다, PR #1560)
            const m = await page.$eval('#promo-list .promo-item .promo-item-meta', (x) => { const box = x.parentElement.getBoundingClientRect(), first = x.firstElementChild.getBoundingClientRect(), last = x.lastElementChild.getBoundingClientRect();
                return { order: [...x.children].map((c) => c.className), gap: box.right - last.right, firstFromLeft: (first.left - box.left) / box.width }; });
            assert.deepStrictEqual(m.order, ['promo-item-reactions', 'promo-item-views', 'promo-item-date']);
            assert.ok(m.gap < 20 && m.firstFromLeft > 0.3, '오른쪽 끝에 붙어 있어야 한다 ' + JSON.stringify(m));
            assert.ok(await page.$('#promo-search-input'));
            await page.screenshot({ path: path.join(SHOT, '4_notice.png') });
        });
        // 어황 칸
        await check('[어황정보] 바다 꼬리표 · 쪽수 없음 · 조회(눈)·날짜·부서가 맨 오른쪽', async () => {
            await page.click('#nhub-tabs .nhub-tab[data-nhub="fishcond"]');
            await page.waitForFunction(() => document.querySelectorAll('#fishcond-list .promo-item').length === 2);
            const r = await page.$$eval('#fishcond-list .promo-item', (xs) => xs.map((x) => ({ sea: x.querySelector('.fishcond-sea').textContent, text: x.textContent, meta: [...x.querySelector('.promo-item-meta').children].map((c) => c.textContent.trim()) })));
            assert.equal(r[0].sea, '서해'); assert.equal(r[1].sea, '전국');
            assert.ok(r.every((x) => !/쪽/.test(x.text)), JSON.stringify(r));
            assert.deepStrictEqual(r[0].meta, ['6', '2026.11.20', '기후환경자원과']);
            await page.screenshot({ path: path.join(SHOT, '5_fishcond.png') });
        });
        await check('[어황 팝업] 쪽 그림 보기 페이지(조회 수 셈) · [PDF 받기]는 PDF 주소·한글 이름 · 닫기', async () => {
            await page.evaluate(() => { window.__dl = []; window.downloadKmaFile = (u, n) => window.__dl.push([u, n]); });
            await page.click('#fishcond-list .promo-item');
            await page.waitForFunction(() => !document.getElementById('fishcond-detail-modal').classList.contains('hidden') && document.querySelector('#fishcond-detail-body iframe'));
            assert.ok(/\/api\/fishcond\/20261120132915271ZVR\/view$/.test(await page.$eval('#fishcond-detail-body iframe', (f) => f.src)));
            assert.equal(await page.textContent('#fishcond-detail-title'), '서해주간해어황정보 제26-48호');
            await page.waitForTimeout(300);
            await page.screenshot({ path: path.join(SHOT, '6_fishcond_popup.png') });
            await page.click('#fishcond-detail-pdf');
            const dl = await page.evaluate(() => window.__dl);
            assert.ok(/\/api\/fishcond\/20261120132915271ZVR\/pdf$/.test(dl[0][0]) && dl[0][1] === '서해주간해어황정보 제26-48호.pdf', JSON.stringify(dl));
            await page.click('#fishcond-detail-modal .promo-detail-close');
            assert.ok(await page.$eval('#fishcond-detail-modal', (m) => m.classList.contains('hidden')));
            assert.ok(hits.view.includes('20261120132915271ZVR'));
        });
        await check('[어황 팝업] 미리보기가 없는 글 — 안내 + PDF 받기 · 조회 수는 센다', async () => {
            const before = hits.view.length;
            await page.click('#fishcond-list .promo-item:nth-child(2)');
            await page.waitForSelector('#fishcond-detail-body .fishcond-nopreview');
            await page.waitForTimeout(200);
            assert.equal(hits.view.length, before + 1);
            await page.evaluate(() => window.closeFishcondDetail());
        });

        // ── B. 24시간 안 공지 있음 → 공지사항부터
        S.promo = [{ id: 2, title: 'APK 업데이트 안내', createdAt: promoAt(Date.now() - 2 * 3600000), category: 'patch', views: 1 }];
        const p2 = await fresh({ nhub_news_seen_v1: String(Date.now()) });
        await openTab(p2);
        await check('[처음 칸] 24시간 안 공지가 있으면 공지사항부터 · 공지 칸 N · 하단 탭 N', async () => {
            await p2.waitForFunction(() => window.NoticeHub.current() === 'notice', null, { timeout: 8000 });
            await p2.waitForFunction(() => document.querySelector('#nhub-tabs .nhub-tab[data-nhub="notice"] .new-badge') && document.querySelector('.main-tabs .tab-btn[data-target="promo-section"] .new-badge'));
        });

        // ── C. 오늘 기사가 아직 없음 · 수집이 늦음
        S.promo = []; S.newsToday = []; S.lastRun = new Date(Date.now() - 5 * 3600000).toISOString();
        const p3 = await fresh();
        await openTab(p3);
        await check('[빈 목록] 「아직 오늘 기사가 없어요」 + [어제 뉴스 보기] · 최종 업데이트가 3시간 넘으면 주황 「늦어지고 있어요」', async () => {
            await p3.waitForFunction(() => /아직 오늘 기사가 없어요/.test(document.getElementById('news-list').textContent), null, { timeout: 8000 });
            assert.ok(/어제 뉴스 보기/.test(await p3.textContent('#news-list')));
            assert.ok(await p3.$eval('#news-updated', (e) => e.classList.contains('late') && /늦어지고 있어요/.test(e.textContent)));
            await p3.screenshot({ path: path.join(SHOT, '7_empty.png') });
            await p3.click('#news-list .news-empty button');
            await p3.waitForFunction(() => document.querySelectorAll('#news-list .news-card').length === 1);
        });

        // ── D. 별도 에이전트 검토(2026-11-21)에서 재현된 것들 — 회귀 검사
        S.newsToday = CARDS; S.lastRun = new Date().toISOString();
        await check('[시간대] 휴대폰이 한국 시간대가 아니어도(LA·베트남) 30분 전 공지면 공지사항부터 · 25시간 전 공지면 뉴스부터', async () => {
            for (const tz of ['America/Los_Angeles', 'Asia/Ho_Chi_Minh', 'UTC']) {
                S.promo = [{ id: 7, title: '새 공지', createdAt: promoAt(Date.now() - 30 * 60000), category: 'notice', views: 0 }];
                const pg = await fresh(null, { tz });
                await pg.locator('.main-tabs .tab-btn[data-target="promo-section"]').click();
                await pg.waitForFunction(() => window.NoticeHub.current() === 'notice', null, { timeout: 8000 });
                await pg.context().close();
                S.promo = [{ id: 8, title: '어제 공지', createdAt: promoAt(Date.now() - 25 * 3600000), category: 'notice', views: 0 }];
                const pg2 = await fresh(null, { tz });
                await pg2.locator('.main-tabs .tab-btn[data-target="promo-section"]').click();
                await pg2.waitForTimeout(1500);
                assert.equal(await pg2.evaluate(() => window.NoticeHub.current()), 'news', tz);
                await pg2.context().close();
            }
        });
        await check('[다시 열기] 다른 탭에 다녀오는 사이 새 공지가 오면 다시 열 때 공지사항부터(지난번 판정에 머물지 않음)', async () => {
            S.promo = [];
            const pg = await fresh();
            const tabBtn = pg.locator('.main-tabs .tab-btn[data-target="promo-section"]');
            await tabBtn.click(); await pg.waitForFunction(() => window.NoticeHub.current() === 'news');
            await pg.evaluate(() => window.switchMainTab('weather-group'));
            S.promo = [{ id: 9, title: '방금 공지', createdAt: promoAt(Date.now() - 5 * 60000), category: 'notice', views: 0 }];
            await tabBtn.click();
            await pg.waitForFunction(() => window.NoticeHub.current() === 'notice', null, { timeout: 8000 });
            await pg.context().close();
        });
        await check('[직접 고름] 공지 판정이 늦게 와도 그사이 사용자가 고른 칸(어황정보)을 덮지 않는다 · 기다리는 동안 빈 화면 없음', async () => {
            S.promo = [{ id: 10, title: '방금 공지', createdAt: promoAt(Date.now() - 5 * 60000), category: 'notice', views: 0 }];
            const pg = await fresh();
            S.promoDelay = 2000;
            await pg.locator('.main-tabs .tab-btn[data-target="promo-section"]').click();
            await pg.waitForTimeout(300);
            assert.ok(await pg.evaluate(() => !!document.querySelector('.nhub-panel.active')), '기다리는 동안에도 한 칸은 보인다');
            await pg.click('#nhub-tabs .nhub-tab[data-nhub="fishcond"]');
            await pg.waitForTimeout(2600);
            assert.equal(await pg.evaluate(() => window.NoticeHub.current()), 'fishcond');
            S.promoDelay = 0;
            await pg.context().close();
        });
        await check('[게시글로 이동] 글을 연 뒤 탭이 바뀌어도 아래 칸은 공지사항(닫았을 때 뉴스가 보이지 않게)', async () => {
            S.promo = [{ id: 11, title: '지난주 공지', createdAt: promoAt(Date.now() - 3 * 86400000), category: 'notice', views: 0 }];
            const pg = await fresh();
            await pg.evaluate(() => { window.NoticeHub.pick('notice'); window.switchMainTab('promo-section'); });
            await pg.waitForTimeout(600);
            assert.equal(await pg.evaluate(() => window.NoticeHub.current()), 'notice');
            await pg.context().close();
        });
        await check('[자정] 오늘을 보다가 날짜가 바뀌면 다시 열 때 새 오늘 · [오늘] 단추도 누르는 때의 오늘', async () => {
            S.promo = [];
            const pg = await fresh();
            await pg.evaluate(() => window.switchMainTab('promo-section'));
            await pg.waitForFunction(() => window.NewsTab._st.date && document.querySelectorAll('#news-list .news-card').length === 3);
            const next = await pg.evaluate(() => { const o = Date.now; Date.now = () => o() + 86400000; window.NewsTab.open(); return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); });
            await pg.waitForFunction((d) => window.NewsTab._st.date === d, next);
            await pg.click('#news-dateline .rt button:has-text("오늘")');
            await pg.waitForFunction((d) => window.NewsTab._st.date === d, next);
            await pg.context().close();
        });
        await check('[좁은 폰 320·360px] 「오늘」 한 줄 · 날짜 가운데 · 겹침·가로 스크롤 없음', async () => {
            for (const wd of [320, 360]) {
                S.promo = [];
                const pg = await fresh(null, { width: wd });
                await pg.evaluate(() => window.switchMainTab('promo-section'));
                await pg.waitForSelector('#news-dateline .news-dlabel');
                const g = await pg.evaluate(() => { const R = (e) => e.getBoundingClientRect(); const row = R(document.getElementById('news-dateline')), lab = R(document.querySelector('#news-dateline .news-dlabel')), mid = R(document.querySelector('#news-dateline .mid'));
                    const t = [...document.querySelectorAll('#news-dateline .rt button')].find((x) => x.textContent === '오늘');
                    return { off: Math.abs((lab.left + lab.width / 2) - (row.left + row.width / 2)), nowrap: getComputedStyle(t).whiteSpace === 'nowrap' && t.scrollWidth <= t.clientWidth + 1, overlap: mid.right - R(t).left, sw: document.documentElement.scrollWidth - innerWidth }; });
                assert.ok(g.off < 3 && g.nowrap && g.overlap <= 0 && g.sw <= 0, wd + ' ' + JSON.stringify(g));
                await pg.context().close();
            }
        });

        // ── 2026-11-22 사용자: 「아래로 내려서 당기는 모션이 반영되는 것은 오늘의 뉴스, 공지사항, 그리고 어항 정보」 · 「다 봤어요를 표출하는 곳은 오늘의 뉴스에만」 ·
        //    「어항 정보는 공지사항과 마찬가지로 아래 그 버튼 1, 2, 3 … 버튼을 둠으로써 페이지를 넘길 수 있도록」(10건씩 · [어제 뉴스 보기] 「추천대로」)
        {
            S.promo = [{ id: 1, title: '지난주 공지', createdAt: promoAt(Date.now() - 3 * 86400000), category: 'notice', views: 6 }];
            S.fc = Array.from({ length: 13 }, (_, i) => ({ id: '202611' + String(20 - i).padStart(2, '0') + '000000000' + String(i).padStart(3, '0'), title: '어황정보 ' + (i + 1), dept: '연근해자원과', date: '2026-11-' + String(20 - i).padStart(2, '0'), sea: '전국', pages: 1, status: 'ok', views: i, sourceUrl: 'https://www.nifs.go.kr/x' }));
            const pg = await fresh(null, { touch: true });
            await pg.evaluate(() => window.switchMainTab('promo-section'));
            await pg.waitForFunction(() => document.querySelectorAll('#news-list .news-card').length === 3);
            // 손가락으로 당기기 — 맨 위에서 dy 만큼 내렸다 놓는다. 놓기 직전 띠 높이를 돌려준다.
            const pull = (dy) => pg.evaluate((dy) => {
                const sec = document.getElementById('promo-section');
                const t = (y) => new Touch({ identifier: 1, target: sec, clientX: 200, clientY: y });
                const fire = (type, y, on) => sec.dispatchEvent(new TouchEvent(type, { touches: on ? [t(y)] : [], changedTouches: [t(y)], bubbles: true, cancelable: true }));
                fire('touchstart', 200, true);
                for (let y = 210; y <= 200 + dy; y += 20) fire('touchmove', y, true);
                const h = document.getElementById('nhub-ptr').getBoundingClientRect().height;
                fire('touchend', 200 + dy, false);
                return h;
            }, dy);
            const waitIdle = () => pg.waitForFunction(() => !document.getElementById('nhub-ptr').classList.contains('spin') && document.getElementById('nhub-ptr').getBoundingClientRect().height === 0, null, { timeout: 5000 });
            await check('[당겨서 새로고침] 오늘의 뉴스: 맨 위에서 당기면 띠가 늘고 → 놓으면 파란 동그라미가 돌며 그날 뉴스를 다시 받는다(목록을 비우지 않음)', async () => {
                const n0 = hits.req.news;
                const h = await pull(200);
                assert.ok(h >= 60, '띠 높이 ' + h);
                assert.ok(await pg.$eval('#nhub-ptr', (x) => x.classList.contains('spin')), '받는 중 동그라미');
                assert.equal(await pg.$$eval('#news-list .news-card', (x) => x.length), 3, '받는 동안 목록이 그대로');
                await waitIdle();
                assert.ok(hits.req.news > n0, '다시 받음');
                await pg.screenshot({ path: path.join(SHOT, '8_news_end.png'), fullPage: true });
            });
            await check('[당겨서 새로고침] 조금만 당기고 놓으면 다시 받지 않는다 · 화면을 내려 둔 상태에서는 당겨지지 않는다', async () => {
                const h = await pull(60);   // 띠 30px — 문턱(60) 아래
                assert.ok(h > 0 && h < 60, '띠 높이 ' + h);
                assert.ok(!(await pg.$eval('#nhub-ptr', (x) => x.classList.contains('spin'))), '문턱 아래면 동그라미가 돌지 않는다');
                await waitIdle();
                await pg.evaluate(() => { document.getElementById('news-list').style.minHeight = '3000px'; window.scrollTo(0, 400); });
                const h2 = await pull(200);
                assert.equal(h2, 0);
                assert.ok(!(await pg.$eval('#nhub-ptr', (x) => x.classList.contains('spin'))));
                await pg.evaluate(() => { document.getElementById('news-list').style.minHeight = ''; window.scrollTo(0, 0); });
            });
            await check('[다 봤어요] 오늘의 뉴스 목록 맨 끝 ✓ 다 봤어요 + [어제 뉴스 보기] → 누르면 어제 목록', async () => {
                const end = await pg.$eval('#news-list > :last-child', (x) => ({ cls: x.className, text: x.textContent }));
                assert.ok(end.cls === 'news-end' && /다 봤어요/.test(end.text) && /어제 뉴스 보기/.test(end.text), JSON.stringify(end));
                await pg.click('#news-list .news-end button');
                await pg.waitForFunction((y) => window.NewsTab._st.date === y && document.querySelectorAll('#news-list .news-card').length === 1, YDAY);
                assert.ok(!/어제 뉴스 보기|전날 뉴스 보기/.test(await pg.$eval('#news-list .news-end', (x) => x.textContent)), '그 전날은 보관하지 않아 단추 없음');
            });
            await check('[당겨서 새로고침] 공지사항: 공지 목록을 다시 받는다 · 「다 봤어요」는 없다', async () => {
                await pg.click('#nhub-tabs .nhub-tab[data-nhub="notice"]');
                await pg.waitForFunction(() => document.querySelectorAll('#promo-list .promo-item').length === 1);
                const n0 = hits.req.promo;
                assert.ok(await pull(200) >= 60);
                await waitIdle();
                assert.ok(hits.req.promo > n0, 'promo 요청 ' + n0 + '→' + hits.req.promo);
                assert.equal(await pg.$$eval('#nhub-notice .news-end, #nhub-fishcond .news-end', (x) => x.length), 0);
            });
            await check('[어황정보] 10건씩 · 아래 쪽 번호 단추(공지와 같은 모양) → 2쪽에 나머지 3건 · 당겨서 새로고침해도 보던 쪽 그대로', async () => {
                await pg.click('#nhub-tabs .nhub-tab[data-nhub="fishcond"]');
                await pg.waitForFunction(() => document.querySelectorAll('#fishcond-list .promo-item').length === 10);
                const b = await pg.$$eval('#fishcond-pagination .pagination-btn', (xs) => xs.map((x) => (x.classList.contains('active') ? '*' : '') + (x.textContent || '>')));
                assert.deepStrictEqual(b, ['*1', '2', '>']);
                await pg.click('#fishcond-pagination .pagination-btn:nth-child(2)');
                await pg.waitForFunction(() => document.querySelectorAll('#fishcond-list .promo-item').length === 3);
                assert.ok(/어황정보 11$/.test(await pg.$eval('#fishcond-list .promo-item .promo-item-title', (x) => x.textContent.replace(/N$/, '').trim())), '2쪽 첫 글 = 11번째');
                const n0 = hits.req.fishcond;
                assert.ok(await pull(200) >= 60);
                await waitIdle();
                assert.ok(hits.req.fishcond > n0, '다시 받음 ' + n0 + '→' + hits.req.fishcond);   // 앱이 N 표시를 위해 따로 받는 요청이 끼어들 수 있어 「늘었다」로 본다
                assert.equal(await pg.$$eval('#fishcond-list .promo-item', (x) => x.length), 3, '2쪽 그대로');
                assert.deepStrictEqual(await pg.$$eval('#fishcond-pagination .pagination-btn', (xs) => xs.map((x) => (x.classList.contains('active') ? '*' : '') + (x.textContent || '<'))), ['<', '1', '*2']);
                await pg.screenshot({ path: path.join(SHOT, '9_fishcond_pages.png') });
            });
            await check('[당겨서 새로고침] 팝업이 열려 있으면 당겨지지 않는다', async () => {
                await pg.click('#fishcond-list .promo-item');
                await pg.waitForFunction(() => !document.getElementById('fishcond-detail-modal').classList.contains('hidden'));
                assert.equal(await pull(200), 0);
                await pg.evaluate(() => window.closeFishcondDetail());
            });
            S.fc = FC;
            await pg.context().close();
        }

        await check('페이지 오류 없음', async () => { assert.deepStrictEqual(errors, []); });
    } catch (e) {
        console.error('❌ 시험 준비 실패', e && e.stack); fail++;
    } finally {
        if (browser) await browser.close();
        if (server) server.close();
        console.log('스크린샷:', SHOT);
        console.log(`\n${pass} PASS / ${fail} FAIL`);
        process.exit(fail ? 1 : 0);
    }
})();
