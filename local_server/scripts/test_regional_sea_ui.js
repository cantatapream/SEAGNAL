/**
 * ============================================================================
 * 파일명: local_server/scripts/test_regional_sea_ui.js
 * 역할  : 지방청 단기 전망 카드의 새 모양을 실제 Chromium 으로 index2.html 전체를 띄워 본다(2026-11-19 사용자 확정).
 *         ① 머리줄 — 이름 한 줄 + 그 아래 발표 정보, 📋 는 그 묶음의 세로 가운데·오른쪽(접기 화살표 왼쪽), 원문을 받아 둔 관서에만.
 *         ② 📋 — 누르면 원문 팝업(보기 주소·제목·「⬇ PDF」)이 열리고 카드는 접히지 않는다.
 *         ③ 「해상 기상 요약」 상자 — 기온 박스 아래. 해역별 줄(같은 해역은 이름 한 번 + 기간별 줄) + 종류별 한 줄(딱지 뒤에 글이 흐르고 둘째 줄은 들여쓰기 없이 왼쪽 끝부터,
 *            낱말 중간에서 안 끊는다) · 「없음」 문구 · 「요약을 만들지 못해 원문 그대로」 · 자료가 없으면 상자를 안 그린다 · 꺾쇠가 든 글은 글자로만.
 *         380·412px 스크린샷을 SEA_SHOT_DIR(없으면 임시 폴더)에 남긴다.
 * 사용자 2026-11-19: 「제주지방기상청 단기 전망을 한줄로 표현하고 그 아래줄에 발표정보를 줄바꿈하여 기록. 통보문 버튼을 그 오른쪽(… 헤더 박스의 중앙 오른쪽에 배치」
 *   「[특보가능성] ㅇㅇㅇ… 처럼 들여쓰기 없이 기록되도록. 단, 어절단위 및 자간 줄이기는 동일하게 적용」 「3.해상 기상 내용이 포함되어있지 않습니다. 라는 식으로 상자 표출」
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 시험 대상     : client/js/forecast/outlook/marine_forecast.js(renderRegionalForecast·seaSummaryHtml·regionalDocOf) · client/js/shared/ui/ui_modal.js · client/style.css
 *  - 서버          : 자체 express(임의 포트) — /api/regional-forecast 는 시험 자료(실제 응답과 같은 꼴), 원문 보기 주소는 빈 쪽. 그 밖의 /api 는 404, 127.0.0.1 밖 요청은 끊는다.
 *  - 나를 쓰는 곳  : scripts/refactor/verify_all.sh SUITES
 * [로드 순서] 독립 검사.
 * [실행] NODE_PATH=/opt/node-tools/node_modules:/home/user/SEAGNAL/local_server/node_modules node local_server/scripts/test_regional_sea_ui.js
 * ============================================================================
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), express = require('express'), { chromium } = require('playwright-core');
const root = path.join(__dirname, '../..');
const SHOT = process.env.SEA_SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'sea-shot-'));
fs.mkdirSync(SHOT, { recursive: true });

const BODY = '<특보 현황>\n○ 대설주의보: 제주도산지\n○ 풍랑주의보: {{loc:제주도남쪽안쪽먼바다}}(해제 예고: 21일 밤(21~24시))\n<중점 사항>\n○ 내일까지 {{loc:제주도}}에는 {{warn:바람이}} 매우 강하게 부는 곳이 있겠습니다.';
const base0 = (code, name) => ({ officeCode: code, officeName: name, summary: BODY, bulletinPublishTime: '2026.11.19 04:50', bulletinReportId: 'cmt:202611190450:37', publishTime: '11.19. 05:00', temperature: { low: null, high: '12 ~ 13' } });
const REGIONAL = {
    // 요약됨 + 원문 있음 — 같은 해역(남부앞바다)이 기간별 두 줄, 긴 딱지 줄
    184: Object.assign(base0('184', '제주지방기상청'), {
        doc: { title: '제주지방기상청 날씨해설 제11-37호', viewUrl: '/api/bulletin-doc/fax_wcmt_202611190450_184_37/view', downloadUrl: '/api/bulletin-doc/fax_wcmt_202611190450_184_37/pdf' },
        seaSummary: { state: 'ok', by: 'gemma', zones: [
            { zone: '남해서부서쪽먼바다 · 제주도앞바다(남부앞바다 제외)', period: '~모레(21일) 오전', wind: '9~18', wave: '1.5~4.0' },
            { zone: '제주도남쪽안쪽먼바다', period: '~모레(21일) 밤', wind: '9~18', wave: '1.5~4.0' },
            { zone: '제주도남부앞바다', period: '오늘(19일)', wind: '9~14', wave: '1.5~3.0' },
            { zone: '제주도남부앞바다', period: '내일(20일) 새벽~', wind: '9~15', wave: null },
        ], notes: [
            { kind: '특보 가능성', text: '내일(20일) 새벽부터 {{loc:제주도남서쪽안쪽먼바다·제주도남쪽바깥먼바다}} {{warn:풍랑경보 변경 가능성}}(물결 {{num:최대 5.0m 이상}}) · {{loc:제주도남부앞바다}} {{warn:풍랑특보 발표 가능성}}' },
            { kind: '해제 예고', text: '{{loc:제주도남부앞바다}} 19일 밤(21~24시)' },
            { kind: '천둥·번개', text: '내일(20일)~모레(21일) {{loc:제주도해상}}' },
            { kind: '너울', text: '<img src=x onerror="window.__xss=1"> 꺾쇠가 든 글' },
        ] },
    }),
    // 바다 얘기 없음 · 원문 없음(📋 없음)
    143: Object.assign(base0('143', '대구지방기상청'), { seaSummary: { state: 'none' } }),
    // 요약을 못 만듦 — 원문 줄 그대로
    159: Object.assign(base0('159', '부산지방기상청'), { seaSummary: { state: 'raw', error: '모든 AI 실패', lines: ['○ (해상) 풍랑주의보가 발효된 남해동부안쪽먼바다는 모레(21일) 오전까지 바람이 30~60km/h(9~16m/s)로 매우 강하게 불고, 물결이 1.5~4.0m로 매우 높게 일겠습니다.', '- 한편, 오늘(19일)까지 동해남부남쪽해상에는 천둥.번개가 치는 곳이 있겠습니다.'] } }),
    // 요약 자료가 아직 없음(옛 서버 자료)
    105: base0('105', '강원지방기상청'),
    // 꼴이 어긋난 요약(null 줄·빈 글·모르는 종류·숫자 없는 해역) — 카드가 통째로 사라지면 안 된다(별도 에이전트 검토 2026-11-19)
    156: Object.assign(base0('156', '광주지방기상청'), { seaSummary: { state: 'ok', zones: [null, { zone: '서해남부앞바다', period: '내일(20일)까지', wind: '9~15', wave: '1.5~3.5' }, { zone: '', period: 'x', wind: '1' }, { zone: '숫자없는해역', period: '오늘' }, 7],
        notes: [null, { kind: '너울', text: '   ' }, { kind: 'constructor', text: '모르는 종류의 글' }, { kind: '조고', text: '만조 때 저지대 침수 유의' }] } }),
    // 요약 칸이 배열이 아님
    133: Object.assign(base0('133', '대전지방기상청'), { seaSummary: { state: 'ok', zones: 'x', notes: { a: 1 } } }),
};

let pass = 0, fail = 0;
/** 사례 하나. 실패도 모두 찍고 끝에 요약. @param {string} name @param {function} fn [연계] ← 아래 시나리오 */
async function check(name, fn) { try { await fn(); console.log('✅', name); pass++; } catch (e) { console.error('❌', name, e && e.message); fail++; } }

(async () => {
    let browser, server;
    try {
        const app = express();
        app.get('/api/regional-forecast', (req, res) => res.json(REGIONAL));
        app.get('/api/marine-forecast', (req, res) => res.json({ ultraShort: null, shortTerm: null }));
        app.get('/api/warn-zones', (req, res) => res.sendFile(path.join(root, 'client/assets/warn_zones.geojson')));
        app.get('/api/bulletin-doc/:key/view', (req, res) => res.type('html').send('<!doctype html><title>원문</title><body>원문 그림 자리</body>'));
        app.get('/', (req, res) => res.sendFile(path.join(root, 'client/index2.html')));
        app.use(express.static(path.join(root, 'client')));
        app.use('/api', (req, res) => res.status(404).json({ ok: false }));
        server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
        const base = 'http://127.0.0.1:' + server.address().port;

        browser = await chromium.launch({ ...((process.env.PW_CHROME || process.env.SIM_CHROMIUM || process.env.CHROMIUM_EXECUTABLE) ? { executablePath: process.env.PW_CHROME || process.env.SIM_CHROMIUM || process.env.CHROMIUM_EXECUTABLE } : {}), headless: true });
        const errors = [];
        const clean = (page) => page.evaluate(() => ['server-maintenance-popup', 'network-error-popup', 'splash-screen', 'main-notice-popup', 'zone-guide-popup', 'survey-user-popup'].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); }));
        /** 그 관서 하나를 관심 기상청으로 둔 새 기기. @param {string} code @param {number} [width] @returns {Promise<Page>} */
        const device = async (code, width = 412) => {
            const on = {}; ['109', '159', '156', '105', '133', '143', '184'].forEach((c) => { on[c] = c === code; });
            const ctx = await browser.newContext({ viewport: { width, height: 915 }, timezoneId: 'Asia/Seoul', deviceScaleFactor: 2 }), page = await ctx.newPage();
            page.on('pageerror', (e) => errors.push(e.message));
            await page.route('**/*', (r) => r.request().url().startsWith(base) ? r.continue() : r.abort());
            await page.addInitScript((s) => { try { localStorage.setItem('officeManualSettings', s); } catch (e) { /* 저장소 없음 */ } }, JSON.stringify(on));
            await page.goto(base + '/');
            await page.waitForFunction(() => typeof window.toggleOfficeSettingsPanel === 'function' && typeof UserSettings !== 'undefined');
            await page.waitForTimeout(1500);   // marine_forecast.js 가 1.2초 뒤 종합 예보를 그린다
            await clean(page);
            await page.waitForSelector('.regional-forecast-office', { state: 'attached' });
            // 「기상청 해상 기상 전망」 아코디언을 실제 함수로 펼친다(한 곳이면 지방청 카드는 처음부터 펼쳐져 있다)
            await page.evaluate(() => { const b = document.getElementById('marine-forecast-accordion-body'); if (b.classList.contains('collapsed')) window.toggleMarineForecastAccordion(); });
            await page.waitForTimeout(500);   // 펼침 + 자간 줄이기(text_fit — 보일 때 맞춘다)
            await page.evaluate(() => document.querySelector('.regional-forecast-office').scrollIntoView({ block: 'center' }));
            return page;
        };
        const T = (s) => String(s).replace(/\u2060/g, '');   // 자간 줄이기(text_fit)가 낱말 안에 넣는 「줄 바꾸지 마」 표시(폭 0)를 걷는다
        const rect = (page, sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, h: r.height, w: r.width }; });

        const jeju = await device('184');
        await check('머리줄: 이름이 한 줄이고 발표 정보가 그 아래 줄에 있다', async () => {
            const nm = await rect(jeju, '.regional-forecast-office-name'), tm = await rect(jeju, '.regional-forecast-publish-time');
            const lh = await jeju.$eval('.regional-forecast-office-name', (e) => parseFloat(getComputedStyle(e).lineHeight) || parseFloat(getComputedStyle(e).fontSize) * 1.5);
            assert.ok(nm.h <= lh * 1.3, '이름이 두 줄: 높이 ' + nm.h + ' / 줄 ' + lh);
            assert.ok(tm.t >= nm.b - 1, '발표 정보가 이름 아래가 아니다: ' + JSON.stringify({ nm, tm }));
            assert.ok(Math.abs(tm.l - nm.l) < 1, '발표 정보가 이름과 같은 왼쪽 끝에서 시작하지 않는다');
            assert.equal(T(await jeju.textContent('.regional-forecast-office-name')), '제주지방기상청 단기 전망');
            assert.equal(T(await jeju.textContent('.regional-forecast-publish-time')), '(2026.11.19 04:50 발표)');
        });
        await check('머리줄: 📋 는 이름·발표 정보 묶음의 세로 가운데·오른쪽, 접기 화살표는 그 오른쪽 끝', async () => {
            const head = await rect(jeju, '.regional-forecast-office-head'), doc = await rect(jeju, '.regional-forecast-doc'), ic = await rect(jeju, '.regional-forecast-office-icon');
            assert.ok(doc.l >= head.r - 1, '📋 가 묶음 오른쪽이 아니다');
            assert.ok(ic.l >= doc.r - 1, '화살표가 📋 오른쪽이 아니다');
            assert.ok(Math.abs((doc.t + doc.b) / 2 - (head.t + head.b) / 2) <= 2, '📋 가 묶음의 세로 가운데가 아니다: ' + JSON.stringify({ head, doc }));
            assert.equal(await jeju.textContent('.regional-forecast-doc'), '📋');
        });
        await check('📋 를 누르면 원문 팝업(보기 주소·제목·「⬇ PDF」)이 열리고 카드는 접히지 않는다', async () => {
            await jeju.click('.regional-forecast-doc');
            await jeju.waitForSelector('#kma-iframe-modal iframe');
            assert.equal(await jeju.$eval('#kma-iframe-modal iframe', (f) => new URL(f.src).pathname), '/api/bulletin-doc/fax_wcmt_202611190450_184_37/view');
            assert.ok(/제주지방기상청 날씨해설 제11-37호/.test(T(await jeju.textContent('#kma-iframe-modal .kma-iframe-header'))));
            assert.ok(await jeju.$('#kma-iframe-modal .kma-iframe-download'), '「⬇ PDF」 버튼이 없다');
            assert.ok(await jeju.$eval('.regional-forecast-office', (o) => o.classList.contains('open')), '카드가 접혔다');
            await jeju.screenshot({ path: path.join(SHOT, 'sea_412_modal.png') });
            await jeju.evaluate(() => { const m = document.getElementById('kma-iframe-modal'); if (m) m.remove(); });
        });
        await check('「해상 기상 요약」 상자가 기온 박스 아래·본문 위에 있다', async () => {
            const temp = await rect(jeju, '.regional-forecast-temp'), sea = await rect(jeju, '.regional-forecast-sea'), body = await rect(jeju, '.regional-forecast-summary');
            assert.ok(sea.t >= temp.b - 1 && body.t >= sea.b - 1, JSON.stringify({ temp, sea, body }));
            assert.ok(/해상 기상 요약/.test(T(await jeju.textContent('.regional-forecast-sea .rf-sea-ttl'))));
        });
        await check('해역별 줄: 같은 해역은 이름 한 번 + 기간별 줄 · 바람·물결 숫자와 단위 · 없는 칸은 안 그린다', async () => {
            const zones = await jeju.$$eval('.regional-forecast-sea .rf-sea-zone', (els) => els.map((z) => ({ name: z.querySelector('.rf-sea-zn').textContent, rows: [...z.querySelectorAll('.rf-sea-zv')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()) })));
            zones.forEach((z) => { z.name = T(z.name); z.rows = z.rows.map(T); });
            assert.deepStrictEqual(zones.map((z) => z.name), ['남해서부서쪽먼바다 · 제주도앞바다(남부앞바다 제외)', '제주도남쪽안쪽먼바다', '제주도남부앞바다']);
            assert.deepStrictEqual(zones[2].rows, ['오늘(19일)바람 9~14m/s물결 1.5~3.0m', '내일(20일) 새벽~바람 9~15m/s']);
            assert.deepStrictEqual(zones[0].rows, ['~모레(21일) 오전바람 9~18m/s물결 1.5~4.0m']);
        });
        await check('딱지 줄: 딱지 뒤에 글이 흐르고, 둘째 줄은 들여쓰기 없이 왼쪽 끝(딱지의 왼쪽)부터 시작한다', async () => {
            const m = await jeju.$eval('.regional-forecast-sea .rf-sea-ln', (ln) => {
                const chip = ln.querySelector('.rf-sea-chip').getBoundingClientRect(), box = ln.getBoundingClientRect();
                const r = document.createRange(); r.selectNodeContents(ln);
                // 줄마다 가장 왼쪽 글자 자리 — 딱지 상자 안의 글자(딱지 안쪽 여백만큼 들어가 있다)는 빼고, 줄은 줄 높이로 가른다
                const lh0 = parseFloat(getComputedStyle(ln).lineHeight), mid = (c) => (c.top + c.bottom) / 2;
                const rows = {}; for (const c of r.getClientRects()) { if (c.width < 1 || (c.left >= chip.left - 0.5 && c.right <= chip.right + 0.5 && mid(c) < chip.bottom)) continue; const k = Math.floor((mid(c) - box.top) / lh0); rows[k] = Math.min(rows[k] === undefined ? 1e9 : rows[k], c.left); }
                const lefts = Object.keys(rows).map(Number).sort((a, b) => a - b).map((k) => rows[k]);
                return { chipL: chip.left, boxL: box.left, lefts, kind: ln.querySelector('.rf-sea-chip').textContent, h: box.height, lh: parseFloat(getComputedStyle(ln).lineHeight) };
            });
            assert.equal(T(m.kind), '특보 가능성');
            assert.ok(m.lefts.length >= 2, '줄이 하나뿐이라 볼 수 없다: ' + JSON.stringify(m));
            assert.ok(Math.abs(m.chipL - m.boxL) < 1, '딱지가 줄 왼쪽 끝이 아니다');
            assert.ok(m.lefts[0] > m.chipL + 20, '첫 줄 글이 딱지 오른쪽에서 시작하지 않는다: ' + JSON.stringify(m));
            m.lefts.slice(1).forEach((l, i) => assert.ok(Math.abs(l - m.boxL) < 2, (i + 2) + '째 줄이 들여 써졌다: ' + JSON.stringify(m)));
        });
        await check('딱지 줄: 낱말 중간에서 줄을 바꾸지 않는다 · 딱지 안은 한 줄 · 종류별 색', async () => {
            const st = await jeju.$$eval('.regional-forecast-sea .rf-sea-ln', (els) => els.map((ln) => ({ wb: getComputedStyle(ln).wordBreak, chipWs: getComputedStyle(ln.querySelector('.rf-sea-chip')).whiteSpace, cls: ln.querySelector('.rf-sea-chip').className, kind: ln.querySelector('.rf-sea-chip').textContent })));
            assert.ok(st.every((s) => s.wb === 'keep-all' && s.chipWs === 'nowrap'), JSON.stringify(st));
            assert.deepStrictEqual(st.map((s) => T(s.kind) + ':' + s.cls.replace('rf-sea-chip ', '')), ['특보 가능성:red', '해제 예고:green', '천둥·번개:yellow', '너울:purple']);
            assert.equal(await jeju.$eval('.regional-forecast-sea .rf-sea-zn', (e) => getComputedStyle(e).wordBreak), 'keep-all');
            // 색 표시(지역 파랑·수치 빨강·위험 주황)가 딱지 줄에도 들어간다
            const colors = await jeju.$eval('.regional-forecast-sea .rf-sea-ln', (ln) => [...new Set([...ln.querySelectorAll('span[style*="color"]')].map((x) => x.style.color))]);
            assert.deepStrictEqual(colors.sort(), ['rgb(248, 113, 113)', 'rgb(251, 146, 60)', 'rgb(96, 165, 250)'], JSON.stringify(colors));
        });
        await check('꺾쇠가 든 글은 글자로만 보인다(실행되지 않는다)', async () => {
            assert.equal(await jeju.evaluate(() => window.__xss), undefined);
            assert.equal(await jeju.$('.regional-forecast-sea img'), null);
            assert.ok(/<img src=x/.test(T(await jeju.$$eval('.regional-forecast-sea .rf-sea-ln', (els) => els[els.length - 1].textContent))));   // 너울 줄(맨 끝)
        });
        await jeju.$eval('.regional-forecast-office', (e) => e.scrollIntoView());
        await (await jeju.$('.regional-forecast-office')).screenshot({ path: path.join(SHOT, 'sea_412_ok.png') });

        const narrow = await device('184', 360);
        await check('좁은 폭(360px)에서도 이름은 한 줄 · 📋·화살표가 밀려나지 않는다 · 상자가 카드 밖으로 안 나간다', async () => {
            const nm = await rect(narrow, '.regional-forecast-office-name'), card = await rect(narrow, '.regional-forecast-office'), doc = await rect(narrow, '.regional-forecast-doc'), ic = await rect(narrow, '.regional-forecast-office-icon'), sea = await rect(narrow, '.regional-forecast-sea');
            const lh = await narrow.$eval('.regional-forecast-office-name', (e) => parseFloat(getComputedStyle(e).fontSize) * 1.5);
            assert.ok(nm.h <= lh * 1.3, '이름이 두 줄');
            assert.ok(doc.r <= ic.l + 1 && ic.r <= card.r + 1, JSON.stringify({ doc, ic, card }));
            assert.ok(sea.l >= card.l && sea.r <= card.r + 1, JSON.stringify({ sea, card }));
            assert.ok(await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '가로로 넘친다');
        });
        await (await narrow.$('.regional-forecast-office')).screenshot({ path: path.join(SHOT, 'sea_360_ok.png') });

        const none = await device('143');
        await check('바다 얘기가 없는 날: 상자는 그대로 두고 「해상 기상 내용이 포함되어 있지 않습니다.」 · 원문이 없는 관서는 📋 가 없다', async () => {
            assert.equal(T(await none.textContent('.regional-forecast-sea .rf-sea-none')), '해상 기상 내용이 포함되어 있지 않습니다.');
            assert.ok(await none.$eval('.regional-forecast-sea', (e) => e.classList.contains('off')));
            assert.equal(await none.$('.regional-forecast-sea .rf-sea-zone'), null);
            assert.equal(await none.$('.regional-forecast-doc'), null);
            const head = await rect(none, '.regional-forecast-office-head'), ic = await rect(none, '.regional-forecast-office-icon');
            assert.ok(ic.l >= head.r - 1, '화살표가 묶음 오른쪽이 아니다');
        });
        await (await none.$('.regional-forecast-office')).screenshot({ path: path.join(SHOT, 'sea_412_none.png') });

        const raw = await device('159');
        await check('요약을 못 만든 날: 「요약을 만들지 못해 원문 그대로」라고 적고 뽑아 둔 원문 줄을 보인다(「없음」과 다르게 보인다)', async () => {
            assert.ok(/요약을 만들지 못해 원문 그대로/.test(T(await raw.textContent('.regional-forecast-sea .rf-sea-ttl'))));
            assert.ok(!(await raw.$eval('.regional-forecast-sea', (e) => e.classList.contains('off'))));
            const lines = await raw.$$eval('.regional-forecast-sea .regional-forecast-line', (els) => els.map((e) => e.textContent.replace(/[\s\u2060]+/g, '').slice(0, 8)));
            assert.equal(lines.length, 2); assert.ok(/^○\(해상\)/.test(lines[0]) && /^-한편/.test(lines[1]), JSON.stringify(lines));
            assert.equal(await raw.$('.regional-forecast-sea .rf-sea-none'), null);
        });
        await (await raw.$('.regional-forecast-office')).screenshot({ path: path.join(SHOT, 'sea_412_raw.png') });

        const old = await device('105');
        await check('요약 자료가 아직 없으면(옛 자료) 상자를 그리지 않는다 — 나머지는 그대로', async () => {
            assert.equal(await old.$('.regional-forecast-sea'), null);
            assert.ok(await old.$('.regional-forecast-summary .regional-forecast-line'));
            assert.equal(T(await old.textContent('.regional-forecast-office-name')), '강원지방기상청 단기 전망');
        });
        await check('제목 바로 밑 첫 해역에는 구분선이 없고, 둘째 해역부터 있다', async () => {
            const b = await jeju.$$eval('.regional-forecast-sea .rf-sea-zone', (els) => els.map((e) => getComputedStyle(e).borderTopWidth));
            assert.equal(b[0], '0px'); assert.equal(b[1], '1px');
        });
        const broken = await device('156');
        await check('꼴이 어긋난 요약(null 줄·빈 글·숫자 없는 해역·모르는 종류): 카드는 그대로 그려지고, 멀쩡한 줄만 나온다', async () => {
            assert.ok(await broken.$('.regional-forecast-summary .regional-forecast-line'), '본문이 사라졌다');
            assert.deepStrictEqual(await broken.$$eval('.regional-forecast-sea .rf-sea-zn', (els) => els.map((e) => e.textContent.replace(/⁠/g, ''))), ['서해남부앞바다']);
            const chips = await broken.$$eval('.regional-forecast-sea .rf-sea-chip', (els) => els.map((e) => e.textContent.replace(/⁠/g, '') + ':' + e.className.replace('rf-sea-chip ', '')));
            assert.deepStrictEqual(chips, ['constructor:grey', '조고:green'], '빈 글의 딱지는 안 그리고, 모르는 종류는 회색');
        });
        const odd = await device('133');
        await check('요약 칸이 배열이 아니면 상자만 안 그리고 카드는 그린다', async () => {
            assert.equal(await odd.$('.regional-forecast-sea'), null);
            assert.ok(await odd.$('.regional-forecast-summary .regional-forecast-line'));
        });
        await check('페이지 오류가 없다', async () => { assert.deepStrictEqual(errors, []); });
        console.log('스크린샷:', SHOT);
    } catch (e) { console.error('❌ 시험 중 예외', e); fail++; }
    finally { if (browser) await browser.close(); if (server) server.close(); }
    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();
