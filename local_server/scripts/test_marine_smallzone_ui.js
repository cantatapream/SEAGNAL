/**
 * 역할: 실제 Chromium 에서 해구 기상전망 창(client/js/forecast/alerts/marine.js)의 소해구 표시를 검사한다(§11.10.17).
 *       대해구를 누르면 지금 그대로(소해구 요청 없음) · 소해구 「233-5」를 누르면 ① 대해구 값으로 먼저 그리고 안내 줄
 *       「대해구 233 예보로 표시 중」 ② 소해구 값이 오면 풍속·파고·파주기·파향·풍향 칸과 그래프를 소해구 값으로 바꾸고 안내 줄을 지움 ·
 *       실패하면 「소해구 예보를 받지 못해 대해구 233 예보로 표시합니다」 · 육지 소해구(값 전부 없음)는 「… 예보 값이 없어 …」 ·
 *       창이 닫히거나 다른 해구로 바뀐 뒤 늦게 온 응답은 버림 · 시정 줄은 그대로 · 빈 시각은 「-」.
 * [연계] client/js/forecast/alerts/marine.js · client/assets/vendor/chartjs(실제 Chart.js) · API 는 가짜(page.route) — 서버·외부 호출 없음.
 *        예보 시각은 지금 시각에서 만든다(창이 지난 칸을 잘라 내므로) — 기준일 고정이 아니라 「늘 지금부터 26칸」이라 시각에 따라 실패하지 않는다.
 * [로드 순서] 시험 스크립트 — NODE_PATH=…/local_server/node_modules:/opt/node-tools/node_modules node local_server/scripts/test_marine_smallzone_ui.js · verify_all.sh SUITES
 */
'use strict';
const path = require('path'), assert = require('assert'), express = require('express'), { chromium } = require('playwright-core');
const root = path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
async function check(name, fn) { try { await fn(); pass++; console.log('✅', name); } catch (e) { fail++; console.error('❌', name, e.message); } }

// 지금(UTC)이 든 3시간 칸부터 26칸 — 창은 지난 칸을 잘라 내므로 늘 지금 기준으로 만든다.
const p2 = (n) => String(n).padStart(2, '0');
const tmOf = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}${p2(d.getUTCHours())}`; };
const start = Math.floor(Date.now() / (3 * 3600000)) * 3 * 3600000;
const TMS = Array.from({ length: 26 }, (_, i) => tmOf(start + i * 3 * 3600000));
const BASE = tmOf(start - 3 * 3600000);
const large = (z, k) => TMS.map((tm, i) => ({ tm, lzone: z, wh: +(1 + k + i * 0.01).toFixed(2), wp: 5, waveDir: 90, ws: +(10 + k + i * 0.1).toFixed(1), windDir: 180 }));
const SMALL5 = TMS.map((tm, i) => ({ tm, wh: +(0.3 + i * 0.01).toFixed(2), wp: 3.5, waveDir: 45, ws: i === 2 ? null : +(4 + i * 0.1).toFixed(1), windDir: 270 }));
const SMALL1 = TMS.map((tm) => ({ tm, wh: null, wp: null, waveDir: null, ws: null, windDir: null }));

(async () => {
    let browser, server;
    try {
        const app = express();
        app.get('/', (req, res) => res.send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#111">'
            + ['assets/vendor/chartjs/chart.umd.min.js', 'assets/vendor/chartjs/chartjs-plugin-datalabels.min.js', 'js/forecast/alerts/marine.js'].map((s) => '<script src="/' + s + '"></script>').join('') + '</body></html>'));
        app.use(express.static(path.join(root, 'client')));
        server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
        browser = await chromium.launch({ ...((process.env.PW_CHROME || process.env.SIM_CHROMIUM || process.env.CHROMIUM_EXECUTABLE) ? { executablePath: process.env.PW_CHROME || process.env.SIM_CHROMIUM || process.env.CHROMIUM_EXECUTABLE } : {}), headless: true, args: ['--no-sandbox'] });
        const page = await browser.newPage({ viewport: { width: 412, height: 915 } }), errors = [];
        page.on('pageerror', (e) => errors.push(e.message));

        // ── 가짜 API ──
        await page.route('**/api/marine-zone-forecasts/*', (route) => {
            const z = decodeURIComponent(route.request().url().split('/').pop());
            route.fulfill({ contentType: 'application/json', body: JSON.stringify({ baseTmUtf: BASE, updatedAt: 'x', data: { [z]: large(z, z === '234' ? 2 : 0) } }) });
        });
        let visHold = null;   // 시정을 붙잡아 둘 때
        await page.route('**/api/vsby-smallzone/**', async (route) => {
            if (visHold) await visHold;
            route.fulfill({ contentType: 'application/json', body: JSON.stringify({ series: [] }) });
        });
        let smallMode = 'ok', smallHold = null, smallCalls = 0;
        await page.route('**/api/marine-small-zone-forecasts/*', async (route) => {
            smallCalls++;
            if (smallHold) await smallHold;
            if (smallMode === 'fail') return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'upstream', message: '기상청 소해구 예보를 받지 못했습니다.' }) });
            route.fulfill({ contentType: 'application/json', body: JSON.stringify({ baseTmUtf: BASE, lzone: '233', data: { '1': SMALL1, '5': SMALL5 }, missingTimes: [] }) });
        });
        await page.goto('http://127.0.0.1:' + server.address().port + '/');
        await page.waitForFunction(() => typeof window.getMarineZoneData === 'function' && typeof Chart !== 'undefined');

        /** 표의 한 줄(머리 글에 label 이 든 줄) 칸 글자들. 예: row('(m/s)') → ['10.0','10.1',…] */
        const row = (label) => page.evaluate((l) => {
            const tr = [...document.querySelectorAll('#marine-zone-table tbody tr')].find((t) => (t.querySelector('th') || {}).textContent && t.querySelector('th').textContent.includes(l));
            return tr ? [...tr.querySelectorAll('td')].map((td) => td.textContent.trim() || (td.querySelector('i') ? td.querySelector('i').style.transform : '')) : null;
        }, label);
        const note = () => page.evaluate(() => { const n = document.getElementById('marine-zone-source-note'); return n ? n.textContent : null; });
        const chartWind = () => page.evaluate(() => window.currentMarineChart && window.currentMarineChart.data.datasets[0].data);
        const release = (holdSetter) => { const r = holdSetter.resolve; holdSetter.resolve = null; r(); };
        const hold = () => { const h = {}; h.p = new Promise((r) => { h.resolve = r; }); return h; };

        await check('대해구를 누르면 지금 그대로 — 소해구 요청 없음·안내 줄 없음', async () => {
            smallCalls = 0;
            await page.evaluate(() => getMarineZoneData('233'));
            await page.waitForSelector('#marine-zone-table');
            assert.equal((await row('(m/s)'))[0], '10.0');
            assert.equal(await note(), null);
            await page.waitForTimeout(200);
            assert.equal(smallCalls, 0);
            await page.evaluate(() => closeSeaZoneModal());
        });

        await check('소해구 「233-5」: 대해구 값으로 먼저 그리고 안내 줄 → 소해구 값이 오면 칸·그래프를 바꾸고 안내 줄을 지움', async () => {
            const h = hold(); smallHold = h.p; smallMode = 'ok';
            await page.evaluate(() => getMarineZoneData('233-5'));
            await page.waitForSelector('#marine-zone-table');
            assert.equal((await row('(m/s)'))[0], '10.0', '먼저 대해구 풍속');
            assert.equal(await note(), '대해구 233 예보로 표시 중');
            await page.waitForFunction(() => window.currentMarineChart);
            assert.equal((await chartWind())[0], 10);
            release(h); smallHold = null;
            await page.waitForFunction(() => !document.getElementById('marine-zone-source-note'));
            const ws = await row('(m/s)'), wh = await row('파고(m)'), wp = await row('파주기'), wd = await row('풍향'), vd = await row('파향');
            assert.deepEqual([ws[0], ws[1], ws[2], ws[3]], ['4.0', '4.1', '-', '4.3'], '풍속 = 소해구 값, 빈 시각은 「-」');
            assert.equal(wh[0], '0.3'); assert.equal(wp[0], '3.5');
            assert.equal(wd[0], 'rotate(270deg)'); assert.equal(vd[0], 'rotate(45deg)');
            await page.waitForFunction(() => window.currentMarineChart && window.currentMarineChart.data.datasets[0].data[0] === 4);
            assert.equal((await chartWind())[2], null, '그래프도 빈 시각은 비움');
            await page.waitForFunction(() => document.getElementById('marine-vis-row').textContent.includes('시정 정보 없음'));   // 시정 줄은 지금 처리 그대로
            await page.evaluate(() => closeSeaZoneModal());
        });

        await check('소해구 예보를 받지 못하면 대해구 값 그대로 + 「소해구 예보를 받지 못해 대해구 233 예보로 표시합니다」', async () => {
            smallMode = 'fail';
            await page.evaluate(() => getMarineZoneData('233-5'));
            await page.waitForFunction(() => { const n = document.getElementById('marine-zone-source-note'); return n && /받지 못해/.test(n.textContent); });
            assert.equal(await note(), '소해구 예보를 받지 못해 대해구 233 예보로 표시합니다');
            assert.equal((await row('(m/s)'))[0], '10.0');
            smallMode = 'ok';
            await page.evaluate(() => closeSeaZoneModal());
        });

        await check('육지 소해구(값이 모두 없음)는 대해구 값 그대로 + 「소해구 233-1 예보 값이 없어 …」', async () => {
            await page.evaluate(() => getMarineZoneData('233-1'));
            await page.waitForFunction(() => { const n = document.getElementById('marine-zone-source-note'); return n && /값이 없어/.test(n.textContent); });
            assert.equal(await note(), '소해구 233-1 예보 값이 없어 대해구 233 예보로 표시합니다');
            assert.equal((await row('(m/s)'))[0], '10.0');
            await page.evaluate(() => closeSeaZoneModal());
        });

        await check('늦게 온 응답은 버린다 — 창을 닫고 다른 해구(234)를 연 뒤 233 소해구 응답이 와도 234 그대로', async () => {
            const h = hold(); smallHold = h.p;
            await page.evaluate(() => getMarineZoneData('233-5'));
            await page.waitForFunction(() => document.getElementById('marine-zone-source-note'));
            await page.evaluate(() => closeSeaZoneModal());
            await page.evaluate(() => getMarineZoneData('234'));
            await page.waitForFunction(() => document.getElementById('zone-modal-title') && document.getElementById('zone-modal-title').textContent.startsWith('234') && document.getElementById('marine-zone-table'));
            release(h); smallHold = null;
            await page.waitForTimeout(400);
            assert.equal((await row('(m/s)'))[0], '12.0', '234 대해구 값 그대로');
            assert.equal(await note(), null);
            await page.evaluate(() => closeSeaZoneModal());
        });

        await check('같은 창에서 다른 소해구로 바뀐 뒤 앞 응답은 버린다(233-5 → 233-1)', async () => {
            const h = hold(); smallHold = h.p;
            await page.evaluate(() => getMarineZoneData('233-5'));
            await page.waitForFunction(() => document.getElementById('marine-zone-source-note'));
            const h2 = h; smallHold = null;   // 두 번째 요청은 바로 답한다
            await page.evaluate(() => getMarineZoneData('233-1'));
            await page.waitForFunction(() => { const n = document.getElementById('marine-zone-source-note'); return n && /값이 없어/.test(n.textContent); });
            release(h2);
            await page.waitForTimeout(400);
            assert.equal(await note(), '소해구 233-1 예보 값이 없어 대해구 233 예보로 표시합니다');
            assert.equal((await row('(m/s)'))[0], '10.0', '233-5 값이 끼어들지 않음');
            await page.evaluate(() => closeSeaZoneModal());
        });

        await check('시정이 먼저 오고 소해구가 나중에 와도 시정 줄이 「불러오는 중」으로 돌아가지 않는다', async () => {
            const h = hold(); smallHold = h.p;
            await page.evaluate(() => getMarineZoneData('233-5'));
            await page.waitForFunction(() => { const r = document.getElementById('marine-vis-row'); return r && r.textContent.includes('시정 정보 없음'); });
            release(h); smallHold = null;
            await page.waitForFunction(() => !document.getElementById('marine-zone-source-note'));
            assert.ok(!(await page.evaluate(() => document.getElementById('marine-vis-row').textContent)).includes('불러오는 중'));
            await page.evaluate(() => closeSeaZoneModal());
        });

        await check('실행 오류 없음', () => assert.deepEqual(errors, []));
    } catch (e) {
        fail++; console.error('❌ 브라우저 검사 실행 실패:', e && e.message);
    } finally {
        if (browser) await browser.close();
        if (server) await new Promise((r) => server.close(r));
        console.log(`${pass} PASS / ${fail} FAIL`);
        if (fail) process.exitCode = 1;
    }
})();
