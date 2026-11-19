/**
 * 파일명: local_server/scripts/test_safety_late_overlay.js
 * 역할  : 앱을 켜고 처음 여는 지도가 「해양안전생활」이어도, 해양종합정보에서 지난번에 켜 둔 오버레이
 *         (해구기상 격자·특보구역·부이)가 해양안전 지도에 따라 나오지 않는지 실제 화면(Chromium)으로 검사한다.
 *         사용자 보고(2026-11-19): 「해구기상이 꺼져있는데 해양안전생활탭에 해구기상 격자가 남고 격자를 클릭하면
 *         해구기상 정보가 켜지고 있어」. 원인 — 해양안전 진입 때 켜진 버튼을 끄는 장치(_suspendOceanOverlays)는
 *         지도가 아직 없을 때 돌아 아무것도 못 끄고, 지도가 만들어진 뒤에야 각 버튼이 저장값(켜짐)을 되살렸다.
 *         그 켜짐은 해양종합정보로 가면 "해양안전에서 켠 것"으로 꺼져 저장값까지 지워졌다(그래서 그 탭에선 꺼져 보였다).
 * [연계] → client/js/marine-life/safety/life_safety.js (_lsSuspendLateOverlay · _suspendOceanOverlays · _restoreOceanOverlays)
 *        → client/js/ocean-map/map/ocean_map.js (bindMarineZoneGridToggle) · ocean-map/warnings/ocean_warn_zone.js (_bindToggle)
 *          · ocean-map/observation/ocean_buoy.js (bindBuoyToggle)
 *        ← scripts/refactor/verify_all.sh SUITES
 * [로드 순서] 독립 검사. 3001 서버·외부 호출 없음 — node 내장 http 가 client/ 를 내주고 /api 는 모두 404,
 *             127.0.0.1 밖 요청은 끊는다. 시각 의존 없음.
 * [실행] node local_server/scripts/test_safety_late_overlay.js   (playwright-core 또는 playwright 가 필요)
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert');
// playwright-core(CI) 와 playwright(이 컨테이너) 어느 쪽이든 받는다 — 브라우저 조작 API 가 같다(test_overlay_solo 와 같은 방식).
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const root = path.join(__dirname, '../../client');
const BTNS = ['ocean-marine-zone-toggle-btn', 'ocean-warn-zone-toggle-btn', 'ocean-buoy-toggle-btn'];
const KEYS = ['seagnal_marine_zone_visible', 'seagnal_warn_zone_visible', 'seagnal_buoys_visible'];
const TYPES = { '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let pass = 0, fail = 0;
/** 사례 하나를 돌리고 결과를 센다. 예: check('첫 진입', async()=>{...}).
 * @param {string} name - 사례 이름 @param {function} fn - 검사 @returns {Promise<void>}
 * [연계] ← 아래 시나리오 / 실패도 모두 찍고 마지막에 요약한다. */
async function check(name, fn) { try { await fn(); console.log('✅', name); pass++; } catch (e) { console.error('❌', name, e.message); fail++; } }

(async () => {
    let browser, server;
    try {
        server = http.createServer((q, s) => {
            let p = decodeURIComponent(q.url.split('?')[0]);
            if (p === '/') p = '/index2.html';
            if (p.startsWith('/api')) { s.writeHead(404, { 'content-type': 'application/json' }); return s.end('{}'); }
            const f = path.join(root, path.normalize(p));
            if (!f.startsWith(root)) { s.writeHead(403); return s.end(); }
            fs.readFile(f, (e, b) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); s.end(b); });
        });
        server.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
        const base = 'http://127.0.0.1:' + server.address().port;
        const exe = process.env.PW_CHROME || process.env.SIM_CHROMIUM || process.env.CHROMIUM_EXECUTABLE;
        browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), headless: true, args: ['--no-sandbox'] });

        /** 저장값 세 개를 켜 둔 새 화면을 연다(=지난번에 해양종합정보에서 켜 두고 앱을 다시 켠 상태).
         * @returns {Promise<Object>} { page, tab(대상), S() — 버튼·격자·저장값 } [연계] ← 각 사례 */
        async function open() {
            const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } }), page = await ctx.newPage();
            await page.route('**/*', r => r.request().url().startsWith(base) ? r.continue() : r.abort());
            await page.addInitScript(keys => { try { keys.forEach(k => localStorage.setItem(k, 'true')); } catch (e) { /* 저장 불가 환경 — 검사가 실패로 드러난다 */ } }, KEYS);
            await page.goto(base + '/');
            await page.waitForFunction(() => typeof window.switchMainTab === 'function');
            await page.waitForTimeout(800);
            const tab = async t => { await page.evaluate(t => document.querySelector('.main-tabs .tab-btn[data-target="' + t + '"]').click(), t); await page.waitForTimeout(1800); };
            // 격자 레이어가 묶일 때까지(정적 GeoJSON 로드) 기다린 뒤 읽는다 — 늦게 묶이는 것이 이 결함의 조건이다.
            const S = () => page.evaluate(ids => {
                const m = window.getOceanMap && window.getOceanMap();
                const grid = m ? m.getLayers().getArray().filter(l => l.getSource && l.getSource() && l.getSource().getFeatures &&
                    l.getSource().getFeatures().some(f => f.get('marine_zone_no') != null && f.get('parent_marine_zone_no') == null)) : [];
                const on = {}; ids.forEach(id => { const b = document.getElementById(id); on[id] = !!(b && b.classList.contains('active')); });
                return { safety: document.body.classList.contains('ls-safety'), on, grid: grid.map(l => l.getVisible()), zoneLs: localStorage.getItem('seagnal_marine_zone_visible') };
            }, BTNS);
            return { ctx, page, tab, S };
        }
        const allOff = (s) => BTNS.every(id => !s.on[id]);
        const allOn = (s) => BTNS.every(id => s.on[id]);

        const A = await open();
        await A.tab('ocean-life-group');
        await A.page.waitForFunction(() => document.getElementById('ocean-marine-zone-toggle-btn') && window.getOceanMap && window.getOceanMap(), null, { timeout: 15000 });
        await A.page.waitForTimeout(1500);
        let s = await A.S();
        await check('앱 시작 후 첫 지도가 해양안전 — 저장값으로 켜질 오버레이 3종이 모두 꺼져 있다', async () => {
            assert.ok(s.safety, '해양안전 화면이 아님'); assert.ok(s.grid.length === 1, '해구 격자 레이어를 못 찾음: ' + s.grid.length);
            assert.ok(allOff(s), '켜진 버튼: ' + JSON.stringify(s.on));
        });
        await check('해양안전 지도에 해구기상 격자가 그려지지 않는다(격자 클릭으로 해구기상이 뜨지 않음)', async () => {
            assert.deepStrictEqual(s.grid, [false]);
        });
        await A.tab('ocean-map-section'); s = await A.S();
        await check('해양종합정보로 가면 지난번에 켜 둔 3종이 그대로 켜진다(저장값 보존)', async () => {
            assert.ok(!s.safety); assert.ok(allOn(s), '꺼진 버튼: ' + JSON.stringify(s.on)); assert.deepStrictEqual(s.grid, [true]); assert.strictEqual(s.zoneLs, 'true');
        });
        await A.tab('ocean-life-group'); s = await A.S();
        await check('해양안전으로 다시 오면 다시 꺼진다(해양안전 화면 기억에 섞이지 않음)', async () => {
            assert.ok(s.safety); assert.ok(allOff(s), '켜진 버튼: ' + JSON.stringify(s.on)); assert.deepStrictEqual(s.grid, [false]);
        });
        await A.ctx.close();

        const B = await open();
        await B.tab('ocean-map-section');
        await B.page.waitForFunction(() => document.getElementById('ocean-marine-zone-toggle-btn').classList.contains('active'), null, { timeout: 15000 });
        await B.tab('ocean-life-group'); s = await B.S();
        await check('해양종합정보를 먼저 연 경우(종전 경로)도 해양안전에서는 꺼져 있다', async () => {
            assert.ok(s.safety); assert.ok(allOff(s), '켜진 버튼: ' + JSON.stringify(s.on)); assert.deepStrictEqual(s.grid, [false]);
        });
        await B.tab('ocean-map-section'); s = await B.S();
        await check('그 뒤 해양종합정보로 돌아가면 다시 켜진다', async () => { assert.ok(allOn(s), '꺼진 버튼: ' + JSON.stringify(s.on)); });
        await B.ctx.close();
    } catch (e) {
        console.error('❌ 실행 오류', e.message); fail++;
    } finally {
        if (browser) await browser.close();
        if (server) server.close();
        console.log(`\n${pass} PASS / ${fail} FAIL`);
        process.exit(fail ? 1 : 0);
    }
})();
