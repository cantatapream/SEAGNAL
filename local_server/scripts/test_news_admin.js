/**
 * ============================================================================
 * 파일명: local_server/scripts/test_news_admin.js
 * 역할  : 「뉴스·공지·어황」 관리자(2026-11-21 시안 8-1 A·8-2·8-3) 검사 —
 *         ① 서버: 관리자 토큰 없으면 401 · 어황 숨기기(앱 목록에서 빠짐)·삭제(파일째, 다시 받지 않음)·다시 변환 · 뉴스 숨기기·뺀 기사 싣기(분류)·검색어 저장 ·
 *            수집이 도는 중에 바꾸면 끝난 뒤 적용(덮이지 않음) · 지금 확인/갱신
 *         ② 화면(실제 Chromium): admin_news_hub.js 의 어황정보·오늘의 뉴스 칸 — 마지막 확인·결과, [원문]·[숨기기]·[싣기]·검색어 추가·삭제
 *         ③ admin_collect.js: 위 3칸 · [게시판 관리|게시글 관리] 는 공지사항 칸에만(글자 확인)
 * 사용자: 「게시판 괸리 게시글관리 선택버튼은 공지사항눌럿을때만 표출」 · 「뺀기사는 원문 링크 볼수있는 버튼 [원문] 반영」
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 시험 대상     : local_server/routes/news.js · routes/fishcond.js · services/news_collector.js · services/fishcond_collector.js ·
 *                    client/js/admin/admin_news_hub.js · client/js/admin/admin_collect.js(글자)
 *  - 나를 쓰는 곳  : scripts/refactor/verify_all.sh SUITES
 * [로드 순서] 독립 검사.
 * [실행] NODE_PATH=/opt/node-tools/node_modules:/home/user/SEAGNAL/local_server/node_modules node local_server/scripts/test_news_admin.js
 * ============================================================================
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), express = require('express');
const root = path.join(__dirname, '../..'), LS = path.join(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nadmin-'));

// 관리자 인증을 가짜로 — X-Admin-Token: good 만 통과
const authPath = require.resolve(path.join(LS, 'services/admin_auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { requireAdminToken: (req, res, next) => (req.get('X-Admin-Token') === 'good' ? next() : res.status(401).json({ ok: false, error: '관리자 인증 필요' })) } };

// 수집기를 임시 폴더 인스턴스로 바꿔 끼운다(라우트는 require 로 부른다)
const NC = require(path.join(LS, 'services/news_collector')), FC = require(path.join(LS, 'services/fishcond_collector'));
const T0 = Date.parse('2026-11-21T05:02:00Z'), H = 3600000;
const rfc = (ms) => new Date(ms).toUTCString().replace('GMT', '+0000');
const nItem = (t, d, u, ms) => ({ title: t, description: d, link: u, originallink: u, pubDate: rfc(ms) });
const ng = { results: {}, verdict: () => ({ score: 1 }), clock: T0, slowJudge: null };
const newsDir = tmp();
const news = NC.createNews({
    dir: newsDir, configFile: path.join(newsDir, 'cfg.json'), now: () => ng.clock,
    search: async (q, o) => ({ ok: true, items: (ng.results[q] || []).slice(o.start - 1, o.start + 99), total: 0 }),
    judge: async (arts, cards) => { if (ng.slowJudge) await ng.slowJudge; return { results: arts.map((a, i) => Object.assign({ i, score: 1, cat: 'none', region: '', group: '', same: '', newInfo: false, summary: a.desc, summaryFixed: false, reason: '행사', provider: 'gemma' }, ng.verdict(a.title))), failed: [], providers: { gemma: 1 }, errors: [] }; },
    meta: async (u) => ({ image: 'https://img.test/' + path.basename(u) + '.jpg', site: '테스트일보' }),
});
const fcDir = tmp(), fg = { html: '', clock: T0 };
const row = (id, title, date, fileId) => `<tr><td class="subject"><a href="javascript:fnPopupPrevew('${id}')">${title}</a></td><td data-label="부서">기후환경자원과</td><td data-label="원본"><a href="/cmmnFile/fileDownloadStat.do?FILE_ID=${fileId}" title="${title}.pdf">p</a></td><td data-label="작성일" class="date">${date}</td></tr>`;
const fish = FC.createFishcond({ dir: fcDir, now: () => fg.clock, fetchText: async () => fg.html, fetchPdf: async () => Buffer.from('%PDF-1.4 x'),
    convert: async (pdf, prefix) => { for (let i = 1; i <= 2; i++) fs.writeFileSync(prefix + '-' + i + '.png', 'PNG'); } });
const swap = (p, inst, base) => { const k = require.resolve(p); require.cache[k].exports = Object.assign({}, base, inst); };
swap(path.join(LS, 'services/news_collector'), news, NC);
swap(path.join(LS, 'services/fishcond_collector'), fish, FC);

let pass = 0, fail = 0;
async function check(name, fn) { try { await fn(); console.log('✅', name); pass++; } catch (e) { console.error('❌', name, e && e.message); fail++; } }

(async () => {
    let server, browser;
    try {
        const app = express();
        app.use(require(path.join(LS, 'routes/news')));
        app.use(require(path.join(LS, 'routes/fishcond')));
        app.get('/admin-test.html', (req, res) => res.type('html').send('<!doctype html><html><head><meta charset="utf-8"></head><body style="background:#141c2c;color:#e2e8f0;font-family:sans-serif"><div id="host" style="max-width:640px;padding:12px"></div>'
            + '<script>window.CONFIG={API_BASE:""};const of=window.fetch;window.fetch=(u,o)=>{o=o||{};if(String(u).includes("/api/admin/")){o.headers=Object.assign({},o.headers,{"X-Admin-Token":"good"});}return of(u,o)};window.__opened=[];window.open=(u)=>{window.__opened.push(u);return null};window.confirm=()=>true;window.alert=(m)=>{window.__alert=m};</script>'
            + '<script src="/js/admin/admin_news_hub.js"></script></body></html>'));
        app.use(express.static(path.join(root, 'client')));
        server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
        const base = 'http://127.0.0.1:' + server.address().port;
        const call = async (method, p, body, token = 'good') => { const r = await fetch(base + p, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'X-Admin-Token': token } : {}), body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };

        // 자료 만들기
        await news.setKeywords(['k']);
        ng.results.k = [nItem('암컷 대게 단속', '12월 1일부터 단속한다.', 'https://a.com/1', T0 - H), nItem('FIRA 워크숍 성료', '자율관리어업 워크숍을 열었다. 다음 문장.', 'https://b.com/2', T0 - 2 * H)];
        ng.verdict = (t) => /대게/.test(t) ? { score: 4, cat: 'duty' } : { score: 1, reason: '행사' };
        await news.run();
        fg.html = row('20261120132915271ZVR', '서해주간해어황정보', '2026-11-20', 'DX5-1-1') + row('20261119154811984NIA', '주간해어황정보', '2026-11-19', 'DX5-2-1');
        await fish.run();
        const D = '2026-11-21';

        await check('[인증] 관리자 토큰이 없거나 틀리면 401(읽기·쓰기 모두)', async () => {
            for (const [m, p] of [['GET', '/api/admin/news'], ['POST', '/api/admin/news/run'], ['POST', '/api/admin/news/keywords'], ['GET', '/api/admin/fishcond'], ['POST', '/api/admin/fishcond/20261120132915271ZVR/delete']]) {
                assert.equal((await call(m, p, m === 'POST' ? {} : null, null)).status, 401, m + ' ' + p);
                assert.equal((await call(m, p, m === 'POST' ? {} : null, 'bad')).status, 401, m + ' ' + p + ' bad');
            }
        });
        await check('[뉴스] 관리자 목록: 실린 카드·뺀 기사(원문 주소·점수·까닭)·상태·검색어·날짜', async () => {
            const r = (await call('GET', '/api/admin/news?date=' + D)).json;
            assert.ok(r.ok && r.cards.length === 1 && r.rejected.length === 1 && r.state.ok && r.keywords.join() === 'k' && r.dates.includes(D), JSON.stringify(r).slice(0, 300));
            assert.ok(r.rejected[0].link === 'https://b.com/2' && r.rejected[0].score === 1 && r.rejected[0].reason === '행사' && r.rejected[0].index === 0);
        });
        await check('[뉴스] 숨기기 → 앱 목록에서 빠지고 관리자 목록엔 남음 → 다시 보이기', async () => {
            const id = news.adminDay(D).cards[0].id;
            assert.equal((await call('POST', '/api/admin/news/' + D + '/' + id + '/hide', { hidden: true })).status, 200);
            assert.equal(news.day(D).cards.length, 0); assert.equal(news.adminDay(D).cards[0].hidden, true);
            await call('POST', '/api/admin/news/' + D + '/' + id + '/hide', { hidden: false });
            assert.equal(news.day(D).cards.length, 1);
            assert.equal((await call('POST', '/api/admin/news/' + D + '/n0000000000/hide', { hidden: true })).status, 404);
        });
        await check('[뉴스] 뺀 기사 싣기 → 카드(관리자 고른 분류·원문 요약·사진) · 뺀 목록에서 빠짐', async () => {
            const r = await call('POST', '/api/admin/news/' + D + '/publish', { index: 0, cat: 'conflict' });
            assert.equal(r.status, 200, JSON.stringify(r.json));
            const day = news.day(D), c = day.cards.find((x) => /FIRA/.test(x.title));
            assert.ok(c && c.cat === 'conflict' && c.catName === '바다 이용 갈등·제도' && c.summary === '자율관리어업 워크숍을 열었다. 다음 문장.' && /img\.test/.test(c.image) && c.source === '테스트일보', JSON.stringify(c));
            assert.equal(news.adminDay(D).rejected.length, 0); assert.ok(news.adminDay(D).cards.find((x) => /FIRA/.test(x.title)).manual);
            assert.equal((await call('POST', '/api/admin/news/' + D + '/publish', { index: 5 })).status, 404);
            // 원문 주소로 찾는다 — 자리 번호가 밀린 낡은 화면에서도 그 기사가 실린다(검토 지적)
            ng.results.k.unshift(nItem('뺀 기사 갑', '갑 내용.', 'https://x.com/a', T0 - 0.1 * H), nItem('뺀 기사 을', '을 내용.', 'https://x.com/b', T0 - 0.05 * H));
            ng.clock = T0 + 0.1 * H; ng.verdict = () => ({ score: 1, reason: '홍보' }); await news.run();
            const rj = news.adminDay(D).rejected;                       // 화면이 받은 목록(자리 번호 포함)
            const eul = rj.find((x) => /을/.test(x.title)), gap = rj.find((x) => /갑/.test(x.title));
            await call('POST', '/api/admin/news/' + D + '/publish', { index: gap.index, link: gap.link });   // 갑을 먼저 실음 → 을의 자리가 밀림
            const r2 = await call('POST', '/api/admin/news/' + D + '/publish', { index: eul.index, link: eul.link, cat: 'sea' });   // 낡은 번호 + 주소
            assert.equal(r2.status, 200, JSON.stringify(r2.json));
            assert.ok(news.day(D).cards.some((c) => /뺀 기사 을/.test(c.title) && c.cat === 'sea'), JSON.stringify(news.day(D).cards.map((c) => c.title)));
            ng.clock = T0;
        });
        await check('[뉴스] 검색어 저장(빈 목록 거절) · 지금 갱신은 기다리지 않고 시작만', async () => {
            const r = await call('POST', '/api/admin/news/keywords', { keywords: ['k', '해루질 단속'] });
            assert.ok(r.status === 200 && news.keywords().join() === 'k,해루질 단속');
            assert.equal((await call('POST', '/api/admin/news/keywords', { keywords: [] })).status, 400);
            let release; ng.slowJudge = new Promise((r2) => { release = r2; });
            ng.results.k.unshift(nItem('해광호 수색', '수색 중', 'https://c.com/3', T0 + 0.5 * H)); ng.clock = T0 + H; ng.verdict = () => ({ score: 5, cat: 'safety' });
            const a = await call('POST', '/api/admin/news/run'); const b = await call('POST', '/api/admin/news/run');
            assert.ok(a.json.started === true && b.json.started === false, JSON.stringify([a.json, b.json]));
            assert.equal((await call('GET', '/api/admin/news?date=' + D)).json.running, true);
            // 도는 중에 숨기기 → 수집이 끝난 뒤 적용되어 덮이지 않는다
            const id = news.adminDay(D).cards.find((x) => /대게/.test(x.title)).id;
            const hideP = call('POST', '/api/admin/news/' + D + '/' + id + '/hide', { hidden: true });
            await new Promise((r2) => setTimeout(r2, 50)); release(); ng.slowJudge = null;
            assert.equal((await hideP).status, 200);
            const after = news.adminDay(D);
            assert.ok(after.cards.find((x) => x.id === id).hidden === true && after.cards.some((x) => /해광호/.test(x.title)), JSON.stringify(after.cards.map((x) => [x.title, x.hidden])));
        });
        await check('[사진 전달] 우리 카드 사진이라도 내부 주소(127.0.0.1·사설망)는 받지 않는다 · 모르는 주소도 404', async () => {
            const d = news.adminDay(D); const id = d.cards[0].id;
            const file = path.join(newsDir, D + '.json'), raw = JSON.parse(fs.readFileSync(file, 'utf8'));
            raw.cards.find((c) => c.id === id).image = 'http://127.0.0.1:' + server.address().port + '/api/admin/news'; fs.writeFileSync(file, JSON.stringify(raw));
            ng.clock = T0 + 10 * 60000;   // 사진 목록 담아 둔 것(60초)이 지나게
            const r = await fetch(base + '/api/news/img?u=' + encodeURIComponent('http://127.0.0.1:' + server.address().port + '/api/admin/news'));
            assert.equal(r.status, 404);
            assert.equal((await fetch(base + '/api/news/img?u=' + encodeURIComponent('http://evil.example/x.jpg'))).status, 404);
            ng.clock = T0;
        });
        await check('[어황] 관리자 목록·숨기기(앱 목록에서 빠짐)·다시 변환·삭제(파일째, 다음 확인에 다시 받지 않음)', async () => {
            let r = (await call('GET', '/api/admin/fishcond')).json;
            assert.ok(r.ok && r.posts.length === 2 && r.state.ok && r.running === false, JSON.stringify(r).slice(0, 200));
            await call('POST', '/api/admin/fishcond/20261120132915271ZVR/hide', { hidden: true });
            assert.deepStrictEqual(fish.list().map((p) => p.id), ['20261119154811984NIA']);
            assert.ok(fish.adminList().find((p) => p.id === '20261120132915271ZVR').hidden);
            assert.ok(fish.get('20261120132915271ZVR'), '숨긴 글도 관리자는 열어 볼 수 있다(보기 주소)');
            fs.unlinkSync(path.join(fcDir, '20261119154811984NIA-1.png'));
            const rc = await call('POST', '/api/admin/fishcond/20261119154811984NIA/reconvert');
            assert.ok(rc.json.ok && rc.json.status === 'ok' && fs.existsSync(path.join(fcDir, '20261119154811984NIA-1.png')));
            assert.equal((await call('POST', '/api/admin/fishcond/20261119154811984NIA/delete')).status, 200);
            assert.ok(!fs.readdirSync(fcDir).some((f) => f.startsWith('20261119154811984NIA')), fs.readdirSync(fcDir).join());
            await fish.run();
            assert.ok(!fish.adminList().some((p) => p.id === '20261119154811984NIA'), '다시 받지 않는다');
            assert.equal((await call('POST', '/api/admin/fishcond/../x/delete')).status, 404);
            const run = await call('POST', '/api/admin/fishcond/run'); assert.ok(run.json.ok);
            await new Promise((r2) => setTimeout(r2, 100));
        });

        // ② 화면
        const { chromium } = require('playwright-core');
        browser = await chromium.launch({ ...((process.env.PW_CHROME || process.env.SIM_CHROMIUM || process.env.CHROMIUM_EXECUTABLE) ? { executablePath: process.env.PW_CHROME || process.env.SIM_CHROMIUM || process.env.CHROMIUM_EXECUTABLE } : {}), headless: true, args: ['--no-sandbox'] });
        const page = await browser.newPage({ viewport: { width: 412, height: 900 } });
        const errors = []; page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(base + '/admin-test.html');
        await check('[화면·어황] 마지막 확인·결과·보관 건수 · 글마다 [원문]·[숨기기/다시 보이기]·[삭제] · 숨긴 글 표시', async () => {
            await page.evaluate(() => window.renderAdminFishcond(document.getElementById('host')));
            await page.waitForFunction(() => /마지막 확인/.test(document.getElementById('host').textContent) && /서해주간해어황정보/.test(document.getElementById('host').textContent));
            const t = await page.textContent('#host');
            assert.ok(/결과정상/.test(t.replace(/\s/g, '')) && /보관 중1건/.test(t) && /\(숨김\)/.test(t) && /다시 보이기/.test(t) && /삭제/.test(t), t.slice(0, 300));
            await page.click('text=원문'); assert.deepStrictEqual(await page.evaluate(() => window.__opened.slice(-1)), ['https://www.nifs.go.kr/board/actionBoard0014PopupPrevew.do?BBS_ID=20261120132915271ZVR']);
            await page.click('text=다시 보이기'); await page.waitForFunction(() => /숨기기/.test(document.getElementById('host').textContent) && !/\(숨김\)/.test(document.getElementById('host').textContent));
            assert.deepStrictEqual(fish.list().map((p) => p.id), ['20261120132915271ZVR']);
        });
        await check('[화면·뉴스] 날짜·마지막 갱신·이번 회차·판정한 AI · 검색어 칩 추가·삭제 · 실린 기사 [원문]·[숨기기] · 뺀 기사 [원문]·[싣기]', async () => {
            ng.results.k.unshift(nItem('홍보성 행사 기사', '행사를 열었다.', 'https://d.com/4', T0 + 1.5 * H)); ng.clock = T0 + 2 * H; ng.verdict = (t) => /홍보/.test(t) ? { score: 1, reason: '홍보' } : { score: 1 };
            await news.run();
            await page.evaluate(() => window.renderAdminNews(document.getElementById('host')));
            await page.waitForFunction(() => /수집 검색어/.test(document.getElementById('host').textContent));
            const t = await page.textContent('#host');
            assert.ok(/마지막 갱신/.test(t) && /이번 회차받음/.test(t.replace(/\s/g, '').replace('이번회차', '이번 회차')) || /받음 \d+ → 판정/.test(t), t.slice(0, 300));
            assert.ok(/지금 뉴스 수집/.test(t), '수집 단추 이름(사용자 「수집버튼은 요기에」)'); assert.ok(/gemma/.test(t) && /해루질 단속/.test(t) && /\(숨김\)/.test(t) && /관리자가 실음/.test(t) && /홍보성 행사 기사/.test(t), t.slice(0, 500));
            await page.fill('input[placeholder^="새 검색어"]', '적조'); await page.click('text=+ 추가');
            await page.waitForFunction(() => /수집 검색어 \(3개\)/.test(document.getElementById('host').textContent));
            assert.equal(news.keywords().join(), 'k,해루질 단속,적조');
            await page.click('button[aria-label="해루질 단속 삭제"]');
            await page.waitForFunction(() => /수집 검색어 \(2개\)/.test(document.getElementById('host').textContent));
            assert.equal(news.keywords().join(), 'k,적조');
            // 뺀 기사 [원문] → [싣기](분류 고름)
            const rej = (await page.$$('text=홍보성 행사 기사'));
            assert.ok(rej.length >= 1);
            const rowEl = await page.evaluateHandle(() => [...document.querySelectorAll('#host div')].filter((d) => /홍보성 행사 기사/.test(d.textContent) && d.querySelector('select')).pop());
            await (await rowEl.asElement().$('button:has-text("원문")')).click();
            assert.equal(await page.evaluate(() => window.__opened.slice(-1)[0]), 'https://d.com/4');
            await (await rowEl.asElement().$('select')).selectOption('money');
            await (await rowEl.asElement().$('button:has-text("싣기")')).click();
            for (let i = 0; i < 50 && !news.day(D).cards.some((c) => /홍보성/.test(c.title)); i++) await page.waitForTimeout(100);
            assert.ok(news.day(D).cards.some((c) => /홍보성/.test(c.title) && c.cat === 'money'));
            await page.waitForFunction(() => /홍보성 행사 기사 \(관리자가 실음\)/.test(document.getElementById('host').textContent));
            await page.screenshot({ path: path.join(os.tmpdir(), 'nadmin_news.png'), fullPage: true });
        });
        await check('화면 오류 없음', async () => { assert.deepStrictEqual(errors, []); });

        // ③ admin_collect 글자 확인
        await check('[게시판 관리] 위 3칸(공지사항·어황정보·오늘의 뉴스) · [게시판 관리|게시글 관리] 는 공지사항 칸 안에만', async () => {
            const src = fs.readFileSync(path.join(root, 'client/js/admin/admin_collect.js'), 'utf8');
            assert.ok(/data-hubtab="notice"[\s\S]{0,400}data-hubtab="fishcond"[\s\S]{0,400}data-hubtab="news"/.test(src));
            assert.ok(/<div id="nhub-admin-notice">[\s\S]{0,300}data-subtab="board-mgmt"[\s\S]{0,300}data-subtab="post-mgmt"[\s\S]{0,200}id="board-subtab-content"[\s\S]{0,40}<\/div>\s*<\/div>/.test(src));
            assert.ok(/notice\.style\.display = tab === 'notice' \? '' : 'none'/.test(src));
            const html = fs.readFileSync(path.join(root, 'client/index2.html'), 'utf8');
            assert.ok(html.indexOf('js/admin/admin_news_hub.js') > html.indexOf('js/admin/admin_bulletin_ai.js'));
        });
    } catch (e) {
        console.error('❌ 시험 준비 실패', e && e.stack); fail++;
    } finally {
        if (browser) await browser.close();
        if (server) server.close();
        console.log(`\n${pass} PASS / ${fail} FAIL`);
        process.exit(fail ? 1 : 0);
    }
})();
