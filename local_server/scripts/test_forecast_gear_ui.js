/**
 * ============================================================================
 * 파일명: local_server/scripts/test_forecast_gear_ui.js
 * 역할  : 해양예보 탭 아코디언 ⚙ 두 개를 실제 Chromium 으로 index2.html 전체를 띄워 눌러 본다(2026-10-17 사용자 확정).
 *         ① 「기상청 해상 기상 전망」 관심 기상청 — 처음엔 7곳을 다 보이지 않고 「관심 기상청이 설정되지 않았습니다.」+[설정하기] ·
 *            설정 팝업은 한 곳만(라디오) · [초기화] 없음 · [완료] 저장 · [취소]·Esc·뒤로가기는 저장 없이 닫기 · ⚙ 로 다시 열기 ·
 *            여러 곳을 저장해 둔 옛 설정은 팝업 차례에서 첫 곳 하나로 · 한 곳 저장은 그대로 · 관심해역이 있으면 가장 많은 지방청.
 *            ①-2 옛 기기 표시(officeLegacyZoneFallback) — 새 설치는 온보딩으로 관심해역을 골라도 안내 칸 · 이 판 전부터 관심해역을
 *            쓰던 기기는 가장 많은 지방청 그대로 · 표시는 처음 한 번만(온보딩 함수가 생기기 전에) 정함.
 *         ② 「해역별 특보현황」 관심해역 ⚙ — 관심해역을 안 골랐을 때만 보임 · 누르면 온보딩 관심해역 화면(안내 → 해역 → 지도)
 *            · 마치면 안내 띠 + ⚙ 가 흐려지며 사라짐 · [건너뛰기]는 닫기만 · 첫 실행 흐름(딱지 있음)은 그대로.
 *         ③ 두 ⚙ 모두 머리 안 오른쪽 끝, 「활동지점 안전 브리핑」 ⚙ 와 같은 모양.
 *         380px 스크린샷(안내 칸·설정 팝업·두 머리)을 GEAR_SHOT_DIR(없으면 임시 폴더)에 남긴다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 시험 대상     : client/js/forecast/outlook/marine_forecast.js · client/js/forecast/alerts/render.js(syncAlertZoneGear·openAlertZoneSetup) ·
 *                    client/js/onboarding/zone_setup.js(openZoneSetup) · client/js/settings/settings.js(UserSettings.hasInterestZones) · client/style.css
 *  - 서버          : 자체 express(임의 포트) — /api/regional-forecast·/api/marine-forecast 는 시험 자료, /api/warn-zones 는 실제 client/assets/warn_zones.geojson.
 *                    그 밖의 /api 는 404, 127.0.0.1 밖 요청은 모두 끊는다. 3001 서버·외부 호출 없음.
 *  - 나를 쓰는 곳  : scripts/refactor/verify_all.sh SUITES
 * [로드 순서] 독립 검사.
 * [실행] NODE_PATH=/opt/node-tools/node_modules:/home/user/SEAGNAL/local_server/node_modules node local_server/scripts/test_forecast_gear_ui.js
 * ============================================================================
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), express = require('express'), { chromium } = require('playwright-core');
const root = path.join(__dirname, '../..');
const SHOT = process.env.GEAR_SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'gear-shot-'));
fs.mkdirSync(SHOT, { recursive: true });

// 7개 지방청 시험 본문(실제 /api/regional-forecast 와 같은 꼴: { 코드: { officeCode, officeName, summary, bulletinPublishTime } })
const OFFICES = [['109', '수도권기상청'], ['159', '부산지방기상청'], ['156', '광주지방기상청'], ['105', '강원지방기상청'], ['133', '대전지방기상청'], ['143', '대구지방기상청'], ['184', '제주지방기상청']];
const REGIONAL = {};
OFFICES.forEach(([code, name]) => { REGIONAL[code] = { officeCode: code, officeName: name, summary: '□ ' + name + ' 시험 본문\n○ (해상) 물결 0.5~1.0m', bulletinPublishTime: '2026.10.17 05:00' }; });

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
        app.get('/', (req, res) => res.sendFile(path.join(root, 'client/index2.html')));
        app.use(express.static(path.join(root, 'client')));
        app.use('/api', (req, res) => res.status(404).json({ ok: false }));
        server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
        const base = 'http://127.0.0.1:' + server.address().port;

        browser = await chromium.launch({ ...((process.env.PW_CHROME || process.env.SIM_CHROMIUM || process.env.CHROMIUM_EXECUTABLE) ? { executablePath: process.env.PW_CHROME || process.env.SIM_CHROMIUM || process.env.CHROMIUM_EXECUTABLE } : {}), headless: true, args: ['--no-sandbox'] });
        const errors = [];
        /** 이 시험이 주지 않는 자료 때문에 뜨는 덮개(점검·연결 끊김·스플래시·공지)를 치운다. */
        const clean = (page) => page.evaluate(() => ['server-maintenance-popup', 'network-error-popup', 'splash-screen', 'main-notice-popup', 'zone-guide-popup', 'survey-user-popup'].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); }));
        /**
         * 새 기기(새 브라우저 문맥). store 에 준 값을 처음 한 번만 localStorage 에 넣는다.
         * @param {Object} [o] - { store:{키:문자열}, width, reducedMotion } @returns {Promise<Page>}
         */
        const device = async ({ store = {}, width = 412, reducedMotion = 'no-preference', initScript = null } = {}) => {
            const ctx = await browser.newContext({ viewport: { width, height: 915 }, timezoneId: 'Asia/Seoul', reducedMotion }), page = await ctx.newPage();
            page.on('pageerror', (e) => errors.push(e.message));
            await page.route('**/*', (r) => r.request().url().startsWith(base) ? r.continue() : r.abort());
            await page.addInitScript((store) => { try { if (!sessionStorage.getItem('__g_init')) { sessionStorage.setItem('__g_init', '1'); Object.keys(store).forEach((k) => localStorage.setItem(k, store[k])); } } catch (e) { /* 저장소 없음 */ } }, store);
            if (initScript) await page.addInitScript(initScript);
            await page.goto(base + '/');
            await settle(page);
            return page;
        };
        /** 페이지가 다 뜨고 종합 예보를 그릴 때까지 기다린 뒤 덮개를 치운다(처음 열 때·새로고침 뒤 공용). */
        const settle = async (page) => {
            await page.waitForFunction(() => typeof window.toggleOfficeSettingsPanel === 'function' && typeof UserSettings !== 'undefined');
            await page.waitForTimeout(1500);   // marine_forecast.js 가 1.2초 뒤 종합 예보를 그린다
            await clean(page);
        };
        /** 같은 기기에서 앱을 다시 연다(새로고침 — 저장소는 그대로, 시험용 처음 값은 다시 넣지 않는다). */
        const reopen = async (page) => { await page.reload(); await settle(page); };
        /**
         * 온보딩 관심해역 화면에서 [설정 마치기]를 누른 것과 같은 저장·뒷정리를 한다
         * (onboarding/zone_setup.js _save: UserSettings.set … → UserSettings.save() → loadRegionalForecast()).
         * 지도 클릭으로 끝까지 가는 실제 흐름은 아래 ② 시나리오가 따로 시험한다.
         * @param {Page} page @param {Object} zones - {구역·해역 이름: true|false}
         */
        const saveZonesLikeOnboarding = (page, zones) => page.evaluate(async (z) => {
            Object.keys(z).forEach((k) => UserSettings.set(k, z[k])); UserSettings.save();
            await window.loadRegionalForecast();
        }, zones);
        const JEJU_ONLY = { 동해: false, 서해: false, 남해: false, 제주: true };
        const LEGACY_KEY = 'officeLegacyZoneFallback';
        /** 화면 위 덮개에 가려지지 않게 DOM click. */
        const tap = async (page, sel) => { await page.waitForSelector(sel, { state: 'attached' }); await page.evaluate((s) => document.querySelector(s).click(), sel); };
        const openMarine = async (page) => { await page.evaluate(() => { const b = document.getElementById('marine-forecast-accordion-body'); if (b.classList.contains('collapsed')) window.toggleMarineForecastAccordion(); }); await page.waitForTimeout(200); };
        const regionalText = (page) => page.evaluate(() => document.getElementById('regional-forecast-body').innerText);
        const officeCards = (page) => page.evaluate(() => [...document.querySelectorAll('#regional-forecast-body .regional-forecast-office-name')].map((e) => e.textContent));
        const checkedCodes = (page) => page.evaluate(() => [...document.querySelectorAll('#office-settings-panel input[type=radio]:checked')].map((e) => e.value));
        const stored = (page, k) => page.evaluate((k) => localStorage.getItem(k), k);
        /** 라디오 한 줄을 실제로 누른다(라벨 줄을 클릭). */
        const pickRow = (page, code) => page.evaluate((c) => document.querySelector('#office-settings-panel input[data-office-code="' + c + '"]').closest('label').click(), code);

        // ── ① 관심 기상청 ─────────────────────────────────────────────
        const p = await device();
        await check('처음 설치: ⚙ 는 「기상청 해상 기상 전망」 머리 안에 있고 「종합 예보」 칸에는 없다', async () => {
            const r = await p.evaluate(() => { const g = document.getElementById('regional-office-settings-btn'); return { inHeader: !!g && g.parentElement.id === 'marine-forecast-accordion-header', last: !!g && g === g.parentElement.lastElementChild, inSub: !!document.querySelector('#regional-forecast-section .marine-forecast-sub-header button'), visible: !!g && getComputedStyle(g).display !== 'none' }; });
            assert.deepEqual(r, { inHeader: true, last: true, inSub: false, visible: true });
        });
        await check('처음 설치: 아코디언을 펼치면 「관심 기상청이 설정되지 않았습니다.」+안내+[설정하기] — 지방청 카드는 0개', async () => {
            await openMarine(p);
            const t = await regionalText(p);
            assert.ok(t.includes('관심 기상청이 설정되지 않았습니다.'), t);
            assert.ok(t.includes('설정하면 그 지방기상청의 해상 단기 전망을 보여 드립니다.'), t);
            assert.equal(await p.locator('#regional-forecast-body button', { hasText: '설정하기' }).count(), 1);
            assert.deepEqual(await officeCards(p), []);
            assert.equal(await p.textContent('#regional-forecast-title'), '종합 예보');
        });
        await p.setViewportSize({ width: 380, height: 844 }); await clean(p);
        await p.evaluate(() => document.getElementById('marine-forecast-accordion-header').scrollIntoView({ block: 'center' }));
        await p.screenshot({ path: path.join(SHOT, 'office_unset_380.png') });
        await check('[설정하기] → 설정 팝업: 라디오 7줄(radiogroup)·[초기화] 없음·[취소]·[완료](처음엔 잠김)·안내 문구', async () => {
            await tap(p, '.regional-office-unset-btn');
            await p.waitForSelector('#office-settings-panel');
            const r = await p.evaluate(() => { const P = document.getElementById('office-settings-panel'); return { text: P.innerText, radios: P.querySelectorAll('input[type=radio]').length, group: !!P.querySelector('[role=radiogroup]'), checkbox: P.querySelectorAll('input[type=checkbox]').length, done: P.querySelector('[data-office-action=done]').disabled, cancel: !!P.querySelector('[data-office-action=cancel]') }; });
            assert.equal(r.radios, 7); assert.equal(r.group, true); assert.equal(r.checkbox, 0); assert.equal(r.done, true); assert.equal(r.cancel, true);
            assert.ok(!r.text.includes('초기화'), '초기화 버튼이 남아 있음');
            for (const s of ['📋 지방청 표시 설정', '※ 이 설정은 관심해역 설정보다 우선 적용됩니다.', '취소', '완료', '수도권기상청', '제주지방기상청']) assert.ok(r.text.includes(s), s);
            assert.deepEqual(await checkedCodes(p), []);
        });
        await p.evaluate(() => document.getElementById('office-settings-panel').scrollIntoView({ block: 'center' })); await p.screenshot({ path: path.join(SHOT, 'office_popup_380.png') });
        await p.setViewportSize({ width: 412, height: 915 });
        await check('한 곳만 고를 수 있다 — 수도권 다음 제주를 누르면 제주만 남고 [완료]가 풀린다', async () => {
            await pickRow(p, '109'); assert.deepEqual(await checkedCodes(p), ['109']);
            await pickRow(p, '184'); assert.deepEqual(await checkedCodes(p), ['184']);
            assert.equal(await p.evaluate(() => document.querySelector('[data-office-action=done]').disabled), false);
            assert.equal(await p.locator('#office-settings-panel .office-settings-row.checked').count(), 1);
        });
        await check('[취소]는 저장 없이 닫는다 — 저장값 없음·안내 칸 그대로', async () => {
            await tap(p, '[data-office-action=cancel]');
            assert.equal(await p.locator('#office-settings-panel').count(), 0);
            assert.equal(await stored(p, 'officeManualSettings'), null);
            assert.ok((await regionalText(p)).includes('관심 기상청이 설정되지 않았습니다.'));
        });
        await check('⚙ 로 다시 열고 부산 → [완료] = 한 곳만 켠 꼴로 저장·닫힘·부산 카드 1개', async () => {
            await tap(p, '#regional-office-settings-btn');
            await p.waitForSelector('#office-settings-panel');
            assert.deepEqual(await checkedCodes(p), [], '취소한 선택이 남아 있으면 안 된다');
            await pickRow(p, '159'); await tap(p, '[data-office-action=done]');
            await p.waitForFunction(() => document.querySelectorAll('#regional-forecast-body .regional-forecast-office').length === 1);
            assert.equal(await p.locator('#office-settings-panel').count(), 0);
            const s = JSON.parse(await stored(p, 'officeManualSettings'));
            assert.deepEqual(Object.keys(s).filter((k) => s[k]), ['159']); assert.equal(Object.keys(s).length, 7);
            assert.deepEqual(await officeCards(p), ['부산지방기상청 단기 전망']);
        });
        await check('⚙ 로 다시 열면 지금 고른 곳(부산)이 골라져 있다 · Esc 는 저장 없이 닫는다', async () => {
            await tap(p, '#regional-office-settings-btn'); await p.waitForSelector('#office-settings-panel');
            assert.deepEqual(await checkedCodes(p), ['159']);
            await pickRow(p, '105');
            await p.focus('#office-settings-panel input[data-office-code="105"]'); await p.keyboard.press('Escape');
            assert.equal(await p.locator('#office-settings-panel').count(), 0);
            assert.deepEqual(await officeCards(p), ['부산지방기상청 단기 전망']);
            const s = JSON.parse(await stored(p, 'officeManualSettings')); assert.equal(s['105'], false);
        });
        await check('하드웨어 뒤로가기(PopupStack)도 [취소]와 같다 · ⚙ 두 번 = 열고 닫기', async () => {
            await tap(p, '#regional-office-settings-btn'); await p.waitForSelector('#office-settings-panel');
            assert.equal(await p.evaluate(() => window.PopupStack.popLast()), true);
            assert.equal(await p.locator('#office-settings-panel').count(), 0);
            await tap(p, '#regional-office-settings-btn'); await tap(p, '#regional-office-settings-btn');
            assert.equal(await p.locator('#office-settings-panel').count(), 0);
            assert.equal(await p.evaluate(() => window.PopupStack.popLast()), false, '닫힌 뒤 스택에 남으면 안 된다');
        });
        await check('⚙ 를 눌러도 아코디언이 접히지 않는다(머리 클릭으로 번지지 않음)', async () => {
            await tap(p, '#regional-office-settings-btn'); await p.waitForSelector('#office-settings-panel');
            assert.equal(await p.evaluate(() => document.getElementById('marine-forecast-accordion-body').classList.contains('collapsed')), false);
            await tap(p, '[data-office-action=cancel]');
        });
        await check('아코디언이 닫힌 채 ⚙ 를 누르면 펼쳐지며 팝업이 보인다', async () => {
            await p.evaluate(() => window.toggleMarineForecastAccordion());
            assert.equal(await p.evaluate(() => document.getElementById('marine-forecast-accordion-body').classList.contains('collapsed')), true);
            await p.locator('#regional-office-settings-btn').click();
            await p.waitForSelector('#office-settings-panel');
            assert.equal(await p.evaluate(() => document.getElementById('marine-forecast-accordion-body').classList.contains('collapsed')), false);
            assert.equal(await p.locator('#office-settings-panel').isVisible(), true);
            await tap(p, '[data-office-action=cancel]');
        });

        await check('옛 설정 옮기기: 여러 곳(수도권·부산·제주)을 켜 둔 기기 → 팝업 차례의 첫 곳(수도권) 하나만 보이고 팝업도 수도권만', async () => {
            const q = await device({ store: { officeManualSettings: JSON.stringify({ 109: true, 159: true, 156: false, 105: false, 133: false, 143: false, 184: true }) } });
            await openMarine(q);
            assert.deepEqual(await officeCards(q), ['수도권기상청 단기 전망']);
            await tap(q, '#regional-office-settings-btn'); await q.waitForSelector('#office-settings-panel');
            assert.deepEqual(await checkedCodes(q), ['109']);
            await q.context().close();
        });
        await check('옛 설정 옮기기: 차례가 뒤섞인 저장(제주·대전) → 화면 차례가 앞선 대전', async () => {
            const q = await device({ store: { officeManualSettings: JSON.stringify({ 184: true, 133: true }) } });
            await openMarine(q); assert.deepEqual(await officeCards(q), ['대전지방기상청 단기 전망']); await q.context().close();
        });
        await check('옛 설정 옮기기: 전부 끈 저장 → 빈 화면이 아니라 「설정되지 않았습니다」 안내', async () => {
            const q = await device({ store: { officeManualSettings: JSON.stringify({ 109: false, 159: false, 156: false, 105: false, 133: false, 143: false, 184: false }) } });
            await openMarine(q); assert.ok((await regionalText(q)).includes('관심 기상청이 설정되지 않았습니다.')); await q.context().close();
        });
        await check('한 곳 저장(제주)은 그대로 제주', async () => {
            const q = await device({ store: { officeManualSettings: JSON.stringify({ 109: false, 159: false, 156: false, 105: false, 133: false, 143: false, 184: true }) } });
            await openMarine(q); assert.deepEqual(await officeCards(q), ['제주지방기상청 단기 전망']); await q.context().close();
        });
        await check('관심 기상청 없이 관심해역만(제주만 켬) → 관심해역이 가장 많은 지방청(제주) 하나 · 팝업도 제주', async () => {
            const z = { 동해: false, 서해: false, 남해: false, 제주: true };
            const q = await device({ store: { weatherAppSettings_v1: JSON.stringify(z) } });
            await openMarine(q); assert.deepEqual(await officeCards(q), ['제주지방기상청 단기 전망']);
            await tap(q, '#regional-office-settings-btn'); await q.waitForSelector('#office-settings-panel');
            assert.deepEqual(await checkedCodes(q), ['184']);
            await q.context().close();
        });

        // ── ①-2 새로 설치한 사람 vs 이 판 전부터 관심해역을 쓰던 기기 (2026-10-17 사용자 확정) ──
        //   원문: 「지금처럼 두자. 그렇지만 새롭게 설정하는 사람, 최초 설치한 사람 등에 대해서는 뜨도록 해야해.」
        await check('새 설치: 첫 실행에서 옛 기기 표시를 한 번 정한다 — officeLegacyZoneFallback="0"(옛 기기 아님) · 안내 칸', async () => {
            const q = await device();
            assert.equal(await stored(q, LEGACY_KEY), '0');
            await openMarine(q); assert.ok((await regionalText(q)).includes('관심 기상청이 설정되지 않았습니다.'));
            await q.context().close();
        });
        await check('새 설치 → 바로 온보딩으로 관심해역(제주만) 저장 → 그래도 「설정되지 않았습니다」+[설정하기](관심해역으로 지방청을 고르지 않음)', async () => {
            const q = await device();
            await openMarine(q);
            await saveZonesLikeOnboarding(q, JEJU_ONLY);
            assert.equal(await q.evaluate(() => UserSettings.hasInterestZones()), true, '관심해역이 저장돼 있어야 시험이 뜻이 있다');
            assert.ok((await regionalText(q)).includes('관심 기상청이 설정되지 않았습니다.'), await regionalText(q));
            assert.equal(await q.locator('#regional-forecast-body button', { hasText: '설정하기' }).count(), 1);
            assert.deepEqual(await officeCards(q), []);
            // 같은 기기를 다시 열어도 그대로 — 관심해역이 생겼다고 다음 실행에 옛 기기로 바뀌지 않는다(한 번만 정함)
            await reopen(q); await openMarine(q);
            assert.equal(await stored(q, LEGACY_KEY), '0');
            assert.ok((await regionalText(q)).includes('관심 기상청이 설정되지 않았습니다.'));
            assert.deepEqual(await officeCards(q), []);
            // 팝업 처음 선택도 비어 있다(관심해역에서 고른 곳을 미리 고르지 않음) → 제주를 고르면 제주
            await tap(q, '.regional-office-unset-btn'); await q.waitForSelector('#office-settings-panel');
            assert.deepEqual(await checkedCodes(q), []);
            await pickRow(q, '184'); await tap(q, '[data-office-action=done]');
            await q.waitForFunction(() => document.querySelectorAll('#regional-forecast-body .regional-forecast-office').length === 1);
            assert.deepEqual(await officeCards(q), ['제주지방기상청 단기 전망']);
            await q.context().close();
        });
        await check('순서: 옛 기기 표시는 온보딩(zone_setup.js 의 window.openZoneSetup)이 생기기 전에 이미 정해져 있다', async () => {
            const q = await device({ initScript: () => {
                // zone_setup.js 가 window.openZoneSetup 을 다는 순간의 표시 값을 적어 둔다
                let fn; Object.defineProperty(window, 'openZoneSetup', { configurable: true, get: () => fn, set: (v) => { window.__legacyAtZoneSetup = localStorage.getItem('officeLegacyZoneFallback'); fn = v; } });
            } });
            assert.equal(await q.evaluate(() => window.__legacyAtZoneSetup), '0');
            assert.equal(await q.evaluate(() => typeof window.openZoneSetup), 'function');
            await q.context().close();
        });
        await check('옛 기기(관심해역을 새 판 전에 저장, 제주만) → 관심해역이 가장 많은 지방청(제주) · 표시 "1" · 다시 열어도 제주', async () => {
            const q = await device({ store: { weatherAppSettings_v1: JSON.stringify(JEJU_ONLY) } });
            assert.equal(await stored(q, LEGACY_KEY), '1');
            await openMarine(q); assert.deepEqual(await officeCards(q), ['제주지방기상청 단기 전망']);
            await reopen(q); await openMarine(q);
            assert.equal(await stored(q, LEGACY_KEY), '1');
            assert.deepEqual(await officeCards(q), ['제주지방기상청 단기 전망']);
            await q.context().close();
        });
        await check('옛 기기 + 관심 기상청(부산)을 고르면 → 부산(고른 곳이 앞선다) · 다시 열어도 부산', async () => {
            const q = await device({ store: { weatherAppSettings_v1: JSON.stringify(JEJU_ONLY) } });
            await openMarine(q);
            await tap(q, '#regional-office-settings-btn'); await q.waitForSelector('#office-settings-panel');
            await pickRow(q, '159'); await tap(q, '[data-office-action=done]');
            await q.waitForFunction(() => (document.querySelector('#regional-forecast-body .regional-forecast-office-name') || {}).textContent === '부산지방기상청 단기 전망');
            await reopen(q); await openMarine(q);
            assert.deepEqual(await officeCards(q), ['부산지방기상청 단기 전망']);
            await q.context().close();
        });
        await check('옛 기기가 관심해역을 모두 지우면 → 안내 칸(기댈 관심해역이 없음) · 다시 고르면 관심해역 기준이 돌아온다', async () => {
            const q = await device({ store: { weatherAppSettings_v1: JSON.stringify(JEJU_ONLY) } });
            await openMarine(q);
            await q.evaluate(async () => { UserSettings.settings = {}; UserSettings.save(); await window.loadRegionalForecast(); });
            assert.ok((await regionalText(q)).includes('관심 기상청이 설정되지 않았습니다.'));
            assert.equal(await stored(q, LEGACY_KEY), '1', '표시는 한 번 정하면 그대로');
            await saveZonesLikeOnboarding(q, JEJU_ONLY);
            assert.deepEqual(await officeCards(q), ['제주지방기상청 단기 전망']);
            await q.context().close();
        });
        await check('관심 기상청을 이미 고른 채 새 판을 처음 연 기기(관심해역도 있음) → 표시 "0" · 고른 곳(대전) 그대로', async () => {
            const q = await device({ store: { weatherAppSettings_v1: JSON.stringify(JEJU_ONLY), officeManualSettings: JSON.stringify({ 133: true }) } });
            assert.equal(await stored(q, LEGACY_KEY), '0');
            await openMarine(q); assert.deepEqual(await officeCards(q), ['대전지방기상청 단기 전망']);
            await q.context().close();
        });
        await check('표시가 이미 정해진 기기는 다시 정하지 않는다 — 표시 "0"+관심해역 → 안내 칸 · 표시 "1"+관심해역 없음 → 안내 칸 · 표시 그대로', async () => {
            const a = await device({ store: { weatherAppSettings_v1: JSON.stringify(JEJU_ONLY), [LEGACY_KEY]: '0' } });
            await openMarine(a); assert.deepEqual(await officeCards(a), []); assert.equal(await stored(a, LEGACY_KEY), '0');
            await a.context().close();
            const b = await device({ store: { [LEGACY_KEY]: '1' } });
            await openMarine(b); assert.ok((await regionalText(b)).includes('관심 기상청이 설정되지 않았습니다.')); assert.equal(await stored(b, LEGACY_KEY), '1');
            await b.context().close();
        });

        // ── ③ 두 ⚙ 모양·자리 ────────────────────────────────────────
        await check('두 ⚙ 모두 머리 안 오른쪽 끝 · 「활동지점 안전 브리핑」 ⚙ 와 같은 모양(색·크기·여백·배경·테두리)', async () => {
            const r = await p.evaluate(() => {
                const pick = (el) => { const c = getComputedStyle(el); return [c.color, c.fontSize, c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft, c.backgroundColor, c.borderTopWidth, c.cursor].join('|'); };
                const box = (g, h) => { const a = g.getBoundingClientRect(), b = h.getBoundingClientRect(); return { inside: a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom, gapRight: Math.round(b.right - a.right) }; };
                const sb = document.getElementById('station-briefing-settings-btn'), m = document.getElementById('regional-office-settings-btn'), z = document.getElementById('alert-zone-settings-btn');
                return { sb: pick(sb), m: pick(m), z: pick(z), mBox: box(m, document.getElementById('marine-forecast-accordion-header')), zBox: box(z, document.getElementById('main-accordion-header')), zHidden: z.hidden };
            });
            assert.equal(r.zHidden, false, '관심해역 미설정이면 특보현황 ⚙ 가 보여야 한다');
            assert.equal(r.m, r.sb); assert.equal(r.z, r.sb);
            assert.ok(r.mBox.inside && r.mBox.gapRight <= 24, JSON.stringify(r.mBox));
            assert.ok(r.zBox.inside && r.zBox.gapRight <= 24, JSON.stringify(r.zBox));
        });
        await p.setViewportSize({ width: 380, height: 844 }); await clean(p);
        await p.evaluate(() => document.getElementById('marine-forecast-accordion-header').scrollIntoView({ block: 'start' })); await p.evaluate(() => { const e = document.getElementById('marine-forecast-accordion-header'); const sc = (function f(n) { while (n && n !== document.body) { if (n.scrollHeight > n.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(n).overflowY)) return n; n = n.parentElement; } return document.scrollingElement; })(e.parentElement); sc.scrollTop -= 100; });
        await p.screenshot({ path: path.join(SHOT, 'gear_headers_380.png') });
        await check('380px 에서도 두 ⚙ 가 머리 안 오른쪽 끝·가로 넘침 없음', async () => {
            const r = await p.evaluate(() => { const f = (g, h) => { const a = document.getElementById(g).getBoundingClientRect(), b = document.getElementById(h).getBoundingClientRect(); return a.right <= b.right && a.left >= b.left && b.right - a.right <= 24; }; return [f('regional-office-settings-btn', 'marine-forecast-accordion-header'), f('alert-zone-settings-btn', 'main-accordion-header'), document.documentElement.scrollWidth <= innerWidth]; });
            assert.deepEqual(r, [true, true, true]);
        });
        await p.setViewportSize({ width: 412, height: 915 });

        // ── ② 해역별 특보현황 관심해역 ⚙ ───────────────────────────────
        await check('관심해역을 이미 고른 기기에는 특보현황 ⚙ 가 없다', async () => {
            const q = await device({ store: { weatherAppSettings_v1: JSON.stringify({ 서해: false }) } });
            assert.equal(await q.evaluate(() => document.getElementById('alert-zone-settings-btn').hidden), true);
            await q.context().close();
        });
        await check('⚙ → 안내(이미지 2) → [건너뛰기]는 닫기만: 관심해역·⚙ 그대로, 아코디언도 안 접힘·안 펼쳐짐', async () => {
            const before = await p.evaluate(() => [document.getElementById('main-accordion-body').className, localStorage.getItem('weatherAppSettings_v1')]);
            await tap(p, '#alert-zone-settings-btn');
            await p.waitForSelector('#zone-setup-overlay');
            const t = await p.evaluate(() => document.getElementById('zone-setup-overlay').innerText);
            assert.ok(t.includes('관심 해역을 설정해보세요') && t.includes('꼭 필요한 특보 알림만 받을 수 있어요'), t);
            assert.ok(!t.includes('시험 모드'), '일반 화면에서 「시험 모드」 딱지가 보이면 안 된다');
            await p.evaluate(() => [...document.querySelectorAll('#zone-setup-overlay button')].find((b) => b.textContent === '건너뛰기').click());
            assert.equal(await p.locator('#zone-setup-overlay').count(), 0);
            assert.equal(await p.evaluate(() => document.getElementById('alert-zone-settings-btn').hidden), false);
            assert.deepEqual(await p.evaluate(() => [document.getElementById('main-accordion-body').className, localStorage.getItem('weatherAppSettings_v1')]), before);
            assert.equal(await p.locator('#zone-setup-done-toast').count(), 0);
        });
        await check('⚙ → 안내 → 해역(이미지 3) → 제주 지도(이미지 4)에서 구역 고르기 → 마침: 저장·안내 띠·⚙ 흐려지며 사라짐·특보현황 다시 그림', async () => {
            await tap(p, '#alert-zone-settings-btn'); await p.waitForSelector('#zone-setup-overlay');
            const btn = (label) => p.evaluate((l) => [...document.querySelectorAll('#zone-setup-overlay button')].find((b) => b.textContent.includes(l)).click(), label);
            await btn('관심 해역 설정하기');
            assert.ok((await p.textContent('#zone-setup-card')).includes('관심해역을 클릭해보세요'));
            await p.evaluate(() => document.querySelector('#zone-setup-overlay button[data-macro="제주"]').click());
            await btn('확인');
            await p.waitForFunction(() => document.getElementById('zone-setup-card').textContent.includes('제주 특보구역을 선택해주세요'));
            assert.ok((await p.textContent('#zone-setup-card')).includes('1 / 1'));
            await p.waitForFunction(() => window.__zsMap && window.__zsLayer && window.__zsLayer.getSource().getFeatures().length > 0 && window.__zsMap.getSize() && window.__zsMap.getSize()[1] > 0, null, { timeout: 8000 });
            const pt = await p.evaluate(() => {
                const m = window.__zsMap, f = window.__zsLayer.getSource().getFeatures().find((x) => x.get('name') === '제주도북부앞바다'); m.renderSync();
                const g = f.getGeometry(), c = g.getType() === 'Polygon' ? g.getInteriorPoint().getCoordinates() : g.getInteriorPoints().getCoordinates()[0];
                const px = m.getPixelFromCoordinate([c[0], c[1]]), r = m.getTargetElement().getBoundingClientRect(); return [r.left + px[0], r.top + px[1]];
            });
            await p.mouse.click(pt[0], pt[1]);
            await p.waitForFunction(() => document.getElementById('zone-setup-count').textContent.includes('고른 구역 1개'), null, { timeout: 4000 });
            await btn('설정 마치기');
            assert.equal(await p.locator('#zone-setup-overlay').count(), 0);
            await p.waitForSelector('#zone-setup-done-toast');
            assert.equal(await p.textContent('#zone-setup-done-toast'), '관심해역은 언제든 메인 화면 설정 ⚙ → 관심해역 탭에서 바꿀 수 있습니다.');
            const s = JSON.parse(await stored(p, 'weatherAppSettings_v1'));
            assert.equal(s['제주도북부앞바다'], true); assert.equal(s['제주도남부앞바다'], false);
            assert.equal(await p.evaluate(() => document.getElementById('alert-zone-settings-btn').classList.contains('is-fading')), true, '바로 사라지지 않고 흐려져야 한다');
            await p.waitForFunction(() => document.getElementById('alert-zone-settings-btn').hidden, null, { timeout: 2000 });
            assert.ok((await p.textContent('#main-accordion-header .section-title')).includes('관심해역별 특보현황'));
        });
        await check('특보현황 ⚙ 를 연 첫 실행 흐름(튜토리얼 숨은 진입로 = opts 없이)은 종전 그대로 「시험 모드」 딱지 있음·건너뛰기 → 콜백(true)', async () => {
            const q = await device();
            await q.evaluate(() => { window.__zsDone = 'none'; window.openZoneSetup(function (skipped) { window.__zsDone = skipped; }); });
            assert.ok((await q.evaluate(() => document.getElementById('zone-setup-overlay').innerText)).includes('관심해역 설정 시험 모드'));
            await q.evaluate(() => [...document.querySelectorAll('#zone-setup-overlay button')].find((b) => b.textContent === '건너뛰기').click());
            assert.equal(await q.evaluate(() => window.__zsDone), true);
            await q.context().close();
        });
        await check('움직임 줄이기 설정이면 ⚙ 는 흐려지는 단계 없이 바로 사라진다', async () => {
            const q = await device({ reducedMotion: 'reduce' });
            assert.equal(await q.evaluate(() => document.getElementById('alert-zone-settings-btn').hidden), false);
            const r = await q.evaluate(() => { UserSettings.set('서해', false); UserSettings.save(); window.renderApp(); const g = document.getElementById('alert-zone-settings-btn'); return [g.hidden, g.classList.contains('is-fading')]; });
            assert.deepEqual(r, [true, false]);
            await q.context().close();
        });
        await check('설정 화면에서 관심해역을 전부 켬으로 되돌리면 ⚙ 가 다시 보인다', async () => {
            const r = await p.evaluate(() => { UserSettings.settings = {}; UserSettings.save(); window.renderApp(); return document.getElementById('alert-zone-settings-btn').hidden; });
            assert.equal(r, false);
        });
        await check('화면 오류 없음', () => assert.deepEqual(errors.filter((m) => !/Failed to fetch|NetworkError|Load failed/.test(m)), []));
        console.log('스크린샷:', SHOT);
    } catch (e) {
        console.error('❌ 브라우저 검사 실행 실패:', e && e.stack); fail++;
    } finally {
        if (browser) await browser.close();
        if (server) await new Promise((r) => server.close(r));
        console.log(`\n${pass} PASS / ${fail} FAIL`);
        if (fail) process.exitCode = 1;
    }
})();
