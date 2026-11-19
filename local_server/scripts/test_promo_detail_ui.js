/**
 * ============================================================================
 * 파일명: local_server/scripts/test_promo_detail_ui.js
 * 역할  : 공지사항 게시글 상세 팝업의 새 모양(2026-11-19 사용자 확정 시안)을 실제 Chromium 으로 index2.html 전체를 띄워 본다.
 *         ① 좌우를 거의 다 쓴다(팝업 양옆 여백 6px · 본문 안 따로 스크롤 없음)
 *         ② 제목 머리는 스크롤해도 제자리 · 몸통만 스크롤
 *         ③ 댓글 입력은 팝업 맨 아래에 고정 — 스크롤하지 않아도 보인다 · 입력창 높이는 종전의 1/3 수준 · 「등록」은 입력창 오른쪽 ·
 *            글이 칸을 넘으면 줄바꿈되고 입력창이 줄 수만큼 높아짐(최대 높이 넘으면 안에서 스크롤, 지우면 다시 낮아짐)
 *         ④ 「관리자」 줄 오른쪽 끝에 비밀댓글 체크박스
 *         ⑤ 「댓글 N개」 줄은 없고, 그 자리에 ❤️👍😮 + 오른쪽 끝 작은 「작성 가이드라인」(누르면 펼침) · 제목 아래에는 반응 버튼이 없다
 *         ⑥ 댓글을 못 쓰는 글(일반 사용자)은 입력칸·가이드라인 단추가 없고 반응 줄은 남는다
 *         ⑦ 같은 글을 관리자가 열어도 댓글 영역(목록·안내·입력칸·가이드라인)이 없다(2026-11-19 사용자)
 *         ⑧ 폰 글쓰기·수정 창은 위를 상태표시줄 높이만큼 띄운다(2026-11-19 사용자)
 *         412px 스크린샷을 PROMO_SHOT_DIR(없으면 임시 폴더)에 남긴다.
 * 사용자 2026-11-19: 「좌우 영역까지 게시글이 꽉 차서 표현」 「댓글 쓰는 부분이 … 아예 게시글 하단에 고정되도록 하되, 댓글 입력창의 영역 상하를
 *   1/3로 줄이고 등록버튼도 댓글입력창의 오른쪽에 배치 / 관리자 오른쪽 끝에 비밀댓글 체크박스와 텍스트」 「댓글작성 가이드라인은 댓글 0개 오른쪽 끝에
 *   작게 … 작성 가이드라인 이라고만」 「댓글 0개 부분은 삭제하고 … 하트 따봉, 놀라는 이모지 선택버튼 배치」 「스크롤을 내려도 제목부분 헤더는 고정」 → 시안 확인 후 「이대로 반영해보자」
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 시험 대상     : client/index2.html #promo-detail-modal · client/js/notice/board/promo.js(openPromoDetail·closePromoDetail·_initPromoReactions) ·
 *                    client/js/notice/comments/promo_comment3.js(renderCommentInput) · promo_comment5.js(loadPromoComments·toggleCommentGuideline) · client/style.css
 *  - 서버          : 자체 express(임의 포트) — /api/promo(/:id)·/api/reactions·/api/comments 는 시험 자료. 그 밖의 /api 는 404, 127.0.0.1 밖 요청은 끊는다.
 *  - 나를 쓰는 곳  : scripts/refactor/verify_all.sh SUITES
 * [로드 순서] 독립 검사.
 * [실행] NODE_PATH=/opt/node-tools/node_modules:/home/user/SEAGNAL/local_server/node_modules node local_server/scripts/test_promo_detail_ui.js
 * ============================================================================
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), express = require('express'), { chromium } = require('playwright-core');
const root = path.join(__dirname, '../..');
const SHOT = process.env.PROMO_SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'promo-shot-'));
fs.mkdirSync(SHOT, { recursive: true });

// 본문이 화면보다 길어야 「몸통만 스크롤」을 볼 수 있다
const BODY = '<p>새로 생긴 기능과 고친 문제를 알려드려요.</p>' + Array.from({ length: 14 }, (_, i) =>
    '<h3>' + (i + 1) + '. 시험 항목</h3><p>○ 통보문이나 기상청 날씨해설에 「풍랑경보·태풍특보로 바뀔 가능성」이 적혀 있으면 알려 드려요. 해당 특보구역 뱃지에 ▲ 표시가 붙어요.</p>').join('');
const POSTS = {
    1: { id: 1, title: '기능 추가·버그 수정 안내(\'26. 11. 18. ~ 19.)', createdAt: '2026.11.19 22:12', views: 1, content: BODY, format: 'md', allowComments: true, attachments: [] },
    2: { id: 2, title: '댓글을 막아 둔 글', createdAt: '2026.11.19 10:00', views: 3, content: '<p>짧은 글</p>', allowComments: false, attachments: [] }
};

let pass = 0, fail = 0;
/** 사례 하나. 실패도 모두 찍고 끝에 요약. @param {string} name @param {function} fn [연계] ← 아래 시나리오 */
async function check(name, fn) { try { await fn(); console.log('✅', name); pass++; } catch (e) { console.error('❌', name, e && e.message); fail++; } }

(async () => {
    let browser, server;
    try {
        const app = express();
        app.get('/api/promo', (req, res) => res.json([]));
        app.get('/api/promo/:id', (req, res) => POSTS[req.params.id] ? res.json(POSTS[req.params.id]) : res.status(404).json({}));
        app.get('/api/reactions/counts', (req, res) => res.json({}));
        app.get('/api/reactions', (req, res) => res.json({ heartCount: 2, thumbsCount: 1, wowCount: 0, myReaction: null }));
        app.get('/api/comments/counts', (req, res) => res.json({}));
        app.get('/api/comments', (req, res) => res.json([]));
        app.get('/api/boards', (req, res) => res.json([]));
        app.get('/', (req, res) => res.sendFile(path.join(root, 'client/index2.html')));
        app.use(express.static(path.join(root, 'client')));
        app.use('/api', (req, res) => res.status(404).json({ ok: false }));
        server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
        const base = 'http://127.0.0.1:' + server.address().port;

        browser = await chromium.launch({ ...((process.env.PW_CHROME || process.env.SIM_CHROMIUM || process.env.CHROMIUM_EXECUTABLE) ? { executablePath: process.env.PW_CHROME || process.env.SIM_CHROMIUM || process.env.CHROMIUM_EXECUTABLE } : {}), headless: true, args: ['--no-sandbox'] });
        const errors = [];
        const clean = (page) => page.evaluate(() => ['server-maintenance-popup', 'network-error-popup', 'splash-screen', 'main-notice-popup', 'zone-guide-popup', 'survey-user-popup'].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); }));
        /** 게시글 하나를 연 새 기기. @param {number} id @param {boolean} admin @returns {Promise<Page>} */
        const open = async (id, admin) => {
            const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, timezoneId: 'Asia/Seoul', deviceScaleFactor: 2 }), page = await ctx.newPage();
            page.on('pageerror', (e) => errors.push(e.message));
            await page.route('**/*', (r) => r.request().url().startsWith(base) ? r.continue() : r.abort());
            await page.addInitScript((a) => { try { localStorage.setItem('seagnal_device_id', 'test-device'); if (a) localStorage.setItem('seagnal_admin_mode', 'true'); } catch (e) { /* 저장소 없음 */ } }, admin);
            await page.goto(base + '/');
            await page.waitForFunction(() => typeof window.openPromoDetail === 'function' && typeof window.switchMainTab === 'function');
            await page.waitForTimeout(1200); await clean(page);
            await page.evaluate(() => window.switchMainTab('promo-section'));
            await page.evaluate((i) => window.openPromoDetail(i), id);
            await page.waitForFunction(() => !document.getElementById('promo-detail-modal').classList.contains('hidden') && document.querySelector('#promo-detail-reactions .reaction-btn'));
            await page.waitForTimeout(500);
            return page;
        };
        const R = (page, sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; });

        const p = await open(1, true);
        await p.screenshot({ path: path.join(SHOT, 'promo_412_top.png') });
        await check('① 팝업이 좌우를 거의 다 쓴다(양옆 여백 6px 이하) · 본문 칸은 따로 스크롤하지 않는다', async () => {
            const box = await R(p, '#promo-detail-modal .promo-modal-content');
            assert.ok(box.l <= 7 && 412 - box.r <= 7, JSON.stringify(box));
            const st = await p.$eval('#promo-detail-content', (e) => ({ oy: getComputedStyle(e).overflowY, mh: getComputedStyle(e).maxHeight, sh: e.scrollHeight, ch: e.clientHeight }));
            assert.ok(st.mh === 'none' && st.sh <= st.ch + 1, '본문이 따로 스크롤된다: ' + JSON.stringify(st));
        });
        await check('② 제목 머리는 스크롤해도 제자리 — 몸통만 스크롤된다', async () => {
            const before = await R(p, '#promo-detail-title');
            const moved = await p.$eval('#promo-detail-scroll', (e) => { e.scrollTop = 600; return e.scrollTop; });
            assert.ok(moved > 0, '몸통이 스크롤되지 않는다');
            const after = await R(p, '#promo-detail-title');
            assert.ok(Math.abs(after.t - before.t) < 1, JSON.stringify({ before, after }));
            await p.$eval('#promo-detail-scroll', (e) => { e.scrollTop = 0; });
        });
        await check('③ 댓글 입력칸은 스크롤하지 않아도 팝업 맨 아래에 보인다 · 입력창 높이 ≤ 44px(종전 ~3줄의 1/3) · 「등록」은 입력창 오른쪽 같은 줄', async () => {
            const box = await R(p, '#promo-detail-modal .promo-modal-content'), foot = await R(p, '#comment-input-area');
            assert.ok(foot.h > 0 && Math.abs(foot.b - box.b) <= 2 && foot.b <= 915, JSON.stringify({ box, foot }));
            const ta = await R(p, '#comment-input-textarea'), btn = await R(p, '#comment-input-area .comment-submit-btn');
            assert.ok(ta.h <= 44, '입력창이 높다: ' + ta.h);
            assert.ok(btn.l >= ta.r - 1 && Math.abs((btn.t + btn.b) / 2 - (ta.t + ta.b) / 2) <= 3, JSON.stringify({ ta, btn }));
            const cc = await R(p, '#comment-char-count');
            assert.ok(cc.r <= ta.r && cc.b <= ta.b + 1 && cc.t >= ta.t, '글자 수가 입력창 안 오른쪽 아래가 아니다: ' + JSON.stringify({ ta, cc }));
        });
        await check('④ 「관리자」 줄 오른쪽 끝에 비밀댓글 체크박스와 글자', async () => {
            const badge = await R(p, '#comment-input-area .comment-nickname-badge'), lab = await R(p, '#comment-input-area .comment-secret-label'), foot = await R(p, '#comment-input-area');
            assert.equal((await p.textContent('#comment-input-area .comment-nickname-badge')).trim(), '관리자');
            assert.ok(Math.abs((lab.t + lab.b) / 2 - (badge.t + badge.b) / 2) <= 4 && lab.r >= foot.r - 14, JSON.stringify({ badge, lab, foot }));
            assert.ok((await p.textContent('#comment-input-area .comment-secret-label')).includes('비밀댓글'));
            await p.click('#comment-secret-check'); assert.equal(await p.$eval('#comment-secret-check', (e) => e.checked), true);
        });
        await check('③ 글이 칸을 넘으면 줄바꿈되고 입력창이 줄 수만큼 높아진다 — 최대 높이를 넘으면 안에서 스크롤 · 지우면 다시 낮아진다 · 입력칸은 계속 맨 아래', async () => {
            const h = () => p.$eval('#comment-input-textarea', (t) => t.getBoundingClientRect().height);
            const h0 = await h();
            await p.fill('#comment-input-textarea', '');
            await p.type('#comment-input-textarea', '가나다라마바사 아자차카타파하 '.repeat(3), { delay: 0 });
            const h1 = await h();
            assert.ok(h1 > h0 + 10, '두세 줄인데 높아지지 않았다: ' + JSON.stringify({ h0, h1 }));
            const st1 = await p.$eval('#comment-input-textarea', (t) => ({ sh: t.scrollHeight, ch: t.clientHeight, oy: t.style.overflowY }));
            assert.ok(st1.sh <= st1.ch + 1 && st1.oy === 'hidden', '줄이 다 보이지 않는다: ' + JSON.stringify(st1));
            await p.type('#comment-input-textarea', '아주 긴 댓글을 계속 이어서 씁니다 '.repeat(12), { delay: 0 });
            const st2 = await p.$eval('#comment-input-textarea', (t) => ({ h: t.getBoundingClientRect().height, max: parseFloat(getComputedStyle(t).maxHeight), oy: t.style.overflowY }));
            assert.ok(Math.abs(st2.h - st2.max) < 1 && st2.oy === 'auto', '최대 높이에서 멈추고 안에서 스크롤해야 한다: ' + JSON.stringify(st2));
            const box = await R(p, '#promo-detail-modal .promo-modal-content'), foot = await R(p, '#comment-input-area'), ta = await R(p, '#comment-input-textarea'), btn = await R(p, '#comment-input-area .comment-submit-btn');
            assert.ok(Math.abs(foot.b - box.b) <= 2, '입력칸이 맨 아래에서 떨어졌다');
            assert.ok(Math.abs(btn.b - ta.b) <= 1, '등록 단추가 입력창 아래쪽에 붙어 있지 않다: ' + JSON.stringify({ ta, btn }));
            await p.screenshot({ path: path.join(SHOT, 'promo_412_grow.png') });
            await p.fill('#comment-input-textarea', '');
            await p.$eval('#comment-input-textarea', (t) => t.dispatchEvent(new Event('input', { bubbles: true })));
            assert.ok(Math.abs((await h()) - h0) < 1, '글을 지웠는데 다시 낮아지지 않았다');
        });
        await check('⑤ 「댓글 N개」 줄이 없고, 그 자리에 ❤️👍😮 + 오른쪽 끝 「작성 가이드라인」 · 제목 아래에는 반응 버튼이 없다', async () => {
            assert.equal(await p.$('#comment-count-label'), null);
            assert.equal(await p.$('.comment-section-header'), null);
            const em = await p.$$eval('#promo-detail-reactions .reaction-btn', (bs) => bs.map((b) => b.textContent.replace(/\s+/g, '')));
            assert.deepStrictEqual(em, ['❤️2', '👍1', '😮0']);
            const reac = await R(p, '#promo-detail-reactions'), content = await R(p, '#promo-detail-content'), head = await R(p, '.promo-detail-head');
            assert.ok(reac.t > content.b - 1, '반응 버튼이 본문 위(제목 아래)에 있다');
            assert.ok(reac.t > head.b);
            const g = await R(p, '#comment-guideline-slot .comment-guideline-mini'), row = await R(p, '.promo-detail-reaction-row');
            assert.equal((await p.textContent('#comment-guideline-slot .comment-guideline-mini')).trim(), '작성 가이드라인');
            assert.ok(row.r - g.r <= 2 && Math.abs((g.t + g.b) / 2 - (reac.t + reac.b) / 2) <= 4, JSON.stringify({ g, row, reac }));
            const fs = await p.$eval('#comment-guideline-slot .comment-guideline-mini', (e) => parseFloat(getComputedStyle(e).fontSize));
            assert.ok(fs <= 13, '작게: ' + fs);
        });
        await check('⑤ 「작성 가이드라인」을 누르면 아래에 펼쳐지고 다시 누르면 접힌다', async () => {
            await p.$eval('#promo-detail-scroll', (e) => { e.scrollTop = e.scrollHeight; });
            await p.click('#comment-guideline-slot .comment-guideline-mini');
            await p.waitForTimeout(400);
            assert.equal(await p.$eval('#comment-guideline-body', (b) => b.classList.contains('open') && b.getBoundingClientRect().height > 40), true);
            assert.equal(await p.$eval('#comment-guideline-slot button', (b) => b.getAttribute('aria-expanded')), 'true');
            await p.screenshot({ path: path.join(SHOT, 'promo_412_bottom_guide.png') });
            await p.click('#comment-guideline-slot .comment-guideline-mini');
            assert.equal(await p.$eval('#comment-guideline-body', (b) => b.classList.contains('open')), false);
        });
        await check('닫으면 입력칸·가이드라인 단추·반응을 비우고, 다시 열면 맨 위부터', async () => {
            await p.$eval('#promo-detail-scroll', (e) => { e.scrollTop = 400; });
            await p.evaluate(() => window.closePromoDetail());
            assert.deepStrictEqual(await p.evaluate(() => ['comment-input-area', 'comment-guideline-slot', 'promo-detail-reactions'].map((id) => document.getElementById(id).innerHTML)), ['', '', '']);
            await p.evaluate(() => window.openPromoDetail(1));
            await p.waitForFunction(() => document.querySelector('#promo-detail-reactions .reaction-btn') && document.querySelector('#comment-input-textarea'));
            assert.equal(await p.$eval('#promo-detail-scroll', (e) => e.scrollTop), 0);
        });
        await p.context().close();

        const u = await open(2, false);
        await check('⑥ 댓글을 막아 둔 글(일반 사용자): 입력칸은 숨고 가이드라인 단추도 없다 · 반응 줄은 남는다', async () => {
            assert.equal(await u.$eval('#comment-input-area', (e) => e.innerHTML === '' && getComputedStyle(e).display === 'none'), true);
            assert.equal(await u.$eval('#comment-guideline-slot', (e) => e.innerHTML), '');
            assert.equal((await u.$$('#promo-detail-reactions .reaction-btn')).length, 3);
        });
        await u.screenshot({ path: path.join(SHOT, 'promo_412_nocomment.png') });
        await u.context().close();

        // [2026-11-19 사용자] 「댓글 허용하지 않은 게시물에는 댓글 영역이 사용자 및 관리자 입장에서 … 표출되지 않도록」
        const ad = await open(2, true);
        await check('⑦ 댓글을 막아 둔 글(관리자): 댓글 목록·안내·입력칸·가이드라인 단추가 모두 없다 · 반응 줄은 남는다', async () => {
            assert.equal(await ad.$eval('#comment-input-area', (e) => e.innerHTML === '' && getComputedStyle(e).display === 'none'), true);
            assert.equal(await ad.$eval('#promo-detail-comments', (e) => e.innerHTML), '');
            assert.equal(await ad.$eval('#comment-guideline-slot', (e) => e.innerHTML), '');
            assert.equal(await ad.evaluate(() => document.body.innerText.includes('댓글 기능이 비활성화')), false);
            assert.equal((await ad.$$('#promo-detail-reactions .reaction-btn')).length, 3);
        });
        await ad.context().close();

        await check('⑧ 폰에서 화면을 꽉 채우는 글쓰기·수정 창은 위를 상태표시줄 높이(safe-area)만큼 띄운다', async () => {
            const css = fs.readFileSync(path.join(root, 'client/style.css'), 'utf8');
            const m = css.match(/@media \(max-width: 600px\)[\s\S]*?\.promo-editor-modal-content \{([^}]*)\}/);
            assert.ok(m && /padding-top: env\(safe-area-inset-top, 0px\);/.test(m[1]) && /box-sizing: border-box;/.test(m[1]), m && m[1]);
        });

        await check('페이지 오류가 없다', async () => { assert.deepStrictEqual(errors.filter((m) => !/Failed to fetch|NetworkError|Load failed/.test(m)), []); });
        console.log('스크린샷:', SHOT);
    } catch (e) { console.error('❌ 시험 중 예외', e); fail++; }
    finally { if (browser) await browser.close(); if (server) server.close(); }
    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();
