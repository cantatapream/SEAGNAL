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
 *            · 마치면 안내 띠 + ⚙ 가 흐려지며 사라짐 · [건너뛰기]는 닫기만.
 *         ③ 두 ⚙ 모두 머리 안 오른쪽 끝, 「활동지점 안전 브리핑」 ⚙ 와 같은 모양.
 *         ⑥ 큰 아코디언 4개 한 번에 하나만 · 다시 펼치면 안쪽 직전 상태 · 자동 펼침은 앱 처음 켤 때만 · 해상 기상 전망 안쪽 하나만·기본값(지방청 → 없으면 최신 초단기/단기) ·
 *            「지방기상청 단기 전망」 칸(종합 예보 칸 없앰) · 「내 위치」 한 줄(2026-11-19).
 *         ⑤ 특보 카드 머리줄 — 큰 글자·좁은 폭에서 📋 와 뱃지가 갈라지지 않고 함께 다음 줄로, 그때 📋 는 뱃지 바로 왼쪽(2026-11-19).
 *         ④ 해역별 📋 통보문 팝업(alert_history.js showZoneBulletins)이 하드웨어 뒤로가기(core/backbutton.js PopupStack)로 닫힌다(2026-11-18).
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
    let marineForecast = { ultraShort: null, shortTerm: null };   // /api/marine-forecast 응답(⑥ 에서 바꾼다)
    try {
        const app = express();
        app.get('/api/regional-forecast', (req, res) => res.json(REGIONAL));
        app.get('/api/marine-forecast', (req, res) => res.json(marineForecast));   // ⑥ 시험이 발표 시각을 바꿔 넣는다
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
        const officeCards = (page) => page.evaluate(() => [...document.querySelectorAll('#regional-forecast-title .regional-forecast-office-name')].map((e) => e.textContent));   // 2026-11-19 — 지방청 이름이 「지방기상청 단기 전망」 칸 머리로 올라왔다
        const checkedCodes = (page) => page.evaluate(() => [...document.querySelectorAll('#office-settings-panel input[type=radio]:checked')].map((e) => e.value));
        const stored = (page, k) => page.evaluate((k) => localStorage.getItem(k), k);
        /** 라디오 한 줄을 실제로 누른다(라벨 줄을 클릭). */
        const pickRow = (page, code) => page.evaluate((c) => document.querySelector('#office-settings-panel input[data-office-code="' + c + '"]').closest('label').click(), code);

        // ── ① 관심 기상청 ─────────────────────────────────────────────
        const p = await device();
        await check('처음 설치: ⚙ 는 「기상청 해상 기상 전망」 머리 안에 있고 「지방기상청 단기 전망」 칸에는 없다', async () => {
            const r = await p.evaluate(() => { const g = document.getElementById('regional-office-settings-btn'); return { inHeader: !!g && g.parentElement.id === 'marine-forecast-accordion-header', last: !!g && g === g.parentElement.lastElementChild, inSub: !!document.querySelector('#regional-forecast-section .marine-forecast-sub-header button:not(.regional-forecast-doc)'), visible: !!g && getComputedStyle(g).display !== 'none' }; });
            assert.deepEqual(r, { inHeader: true, last: true, inSub: false, visible: true });
        });
        await check('처음 설치: 아코디언을 펼치면 「관심 기상청이 설정되지 않았습니다.」+안내+[설정하기] — 지방청 카드는 0개', async () => {
            await openMarine(p);
            const t = await regionalText(p);
            assert.ok(t.includes('관심 기상청이 설정되지 않았습니다.'), t);
            assert.ok(t.includes('설정하면 그 지방기상청의 해상 단기 전망을 보여 드립니다.'), t);
            assert.equal(await p.locator('#regional-forecast-body button', { hasText: '설정하기' }).count(), 1);
            assert.deepEqual(await officeCards(p), []);
            assert.equal(await p.textContent('#regional-forecast-title'), '지방기상청 단기 전망');
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
            await p.waitForFunction(() => document.querySelectorAll('#regional-forecast-title .regional-forecast-office-name').length === 1);
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
        // 2026-11-18 사용자 보고: 해역별 📋 통보문 팝업(showZoneBulletins)이 휴대폰 뒤로가기로 안 닫혔다 —
        //   backbutton.js 가 옛 showAlertHistoryPopup 만 스택에 올리고 있었다. (/api/zone-bulletins 는 이 서버에서 404 →
        //   팝업은 「불러오지 못했습니다」로 뜨지만 열림·닫힘을 보기엔 충분하다)
        await check('📋 통보문 팝업도 하드웨어 뒤로가기(PopupStack)로 닫힌다 · ✕ 로 닫으면 스택에 안 남는다', async () => {
            await p.evaluate(() => window.showZoneBulletins('경북북부앞바다'));
            await p.waitForSelector('#alert-history-modal.show');
            assert.equal(await p.evaluate(() => window.PopupStack.popLast()), true, '스택에 없으면 뒤로가기가 못 닫는다');
            await p.waitForFunction(() => !document.getElementById('alert-history-modal'), null, { timeout: 2000 });
            await p.evaluate(() => window.showZoneBulletins('경북북부앞바다'));
            await p.waitForSelector('#alert-history-modal.show');
            await tap(p, '#alert-history-modal .alert-history-close');
            await p.waitForFunction(() => !document.getElementById('alert-history-modal'), null, { timeout: 2000 });
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
            await q.waitForFunction(() => document.querySelectorAll('#regional-forecast-title .regional-forecast-office-name').length === 1);
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
            await q.waitForFunction(() => (document.querySelector('#regional-forecast-title .regional-forecast-office-name') || {}).textContent === '부산지방기상청 단기 전망');
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
        // 2026-11-19 사용자: 글자 크기 「크게」 + 좁은 폭에서 해역명이 길면 📋 만 윗줄에 남고 뱃지만 아랫줄로 갈라졌다
        //   → 「통보문 버튼과 뱃지 둘다 다음줄로」(render.js createAlertElement 의 .alert-header-actions 묶음).
        await check('⑤ 큰 글자·412px: 긴 해역명은 📋+뱃지가 함께 다음 줄(📋 는 뱃지 바로 왼쪽) · 짧은 해역명은 한 줄 그대로(📋 는 해역명 뒤) · 둘이 갈라지지 않는다', async () => {
            const q = await device({ width: 412, store: { user_font_size: 'large' } });
            const rows = await q.evaluate(() => {
                UserSettings.settings = {}; UserSettings.isVisible = () => true;
                appState.coastalAlerts = {};
                appState.alerts = [['동해남부북쪽안쪽먼바다', '경보'], ['경북북부앞바다', '주의보']]
                    .map(([z, lv]) => ({ zoneName: z, warnType: '풍랑', level: lv, tmFc: '202611180400', tmEf: '202611190000' }));
                window.renderApp();
                toggleSection('east-sea-list');
                document.querySelector('#east-sea-list .sub-region-header').click();
                return new Promise((res) => setTimeout(() => res([...document.querySelectorAll('#east-sea-list .alert-card')].map((c) => {
                    const y = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
                    const n = c.querySelector('.zone-name'), b = c.querySelector('.alert-history-btn'), g = c.querySelector('.alert-badges > *');
                    const nr = n.querySelector('span').getBoundingClientRect(), br = b.getBoundingClientRect(), gr = g.getBoundingClientRect();
                    return { name: n.textContent.trim(), down: y(b) > y(n) + 8, apart: Math.abs(y(b) - y(g)) > 8,
                             btnToBadge: Math.round(gr.left - br.right), btnToName: Math.round(br.left - nr.right) };
                })), 1200));
            });
            await q.screenshot({ path: path.join(SHOT, 'alert_header_large_412.png') });
            await q.context().close();
            const long = rows.find((r) => r.name === '동해남부북쪽안쪽먼바다'), short = rows.find((r) => r.name === '경북북부앞바다');
            assert.ok(long && short, JSON.stringify(rows));
            assert.deepEqual(rows.filter((r) => r.apart), [], '📋 와 뱃지가 다른 줄에 있으면 안 된다');
            assert.equal(long.down, true, '긴 이름은 📋+뱃지가 다음 줄로');
            assert.equal(short.down, false, '짧은 이름은 한 줄 그대로');
            // 2026-11-19 사용자 「통보문 버튼이 … 뱃지 바로 왼쪽에」 + 「두 줄일 때만 뱃지 옆」
            assert.ok(long.btnToBadge >= 0 && long.btnToBadge <= 16, '둘째 줄이면 📋 는 뱃지 바로 왼쪽: ' + JSON.stringify(long));
            assert.ok(short.btnToName >= 0 && short.btnToName <= 30 && short.btnToBadge > 30, '한 줄이면 📋 는 해역명 바로 뒤: ' + JSON.stringify(short));
        });
        // ── ⑥ 큰 아코디언 4개·해상 기상 전망 안쪽 칸·「내 위치」 (2026-11-19 사용자) ─────────────────────
        //   「다른 아코디언이 펼쳐지면 기존 펼쳐져있던 아코디언은 접히도록 … 다시 펼쳤을 때 그 아코디언 안에 직전에 펼쳐놨던 아코디언이 펼쳐져있게」
        //   「해상기상전망 아코디언 안에서도 마찬가지로 … 기본적으로 지방기상청 단기전망부터 … 선택하지 않은 사람은 초단기전망과 단기전망 중 발표가 최신인것」
        //   질문 답: 1-가(자동 펼침은 앱 처음 켤 때만) · 2(앱을 켤 때마다 기본값, 켠 동안은 마지막 칸) · 4(「내 위치」 항상 한 줄)
        const acc = (page) => page.evaluate(() => {
            const open = (id) => { const e = document.getElementById(id); return !!e && !e.classList.contains('collapsed'); };
            const sub = (id) => document.getElementById(id).classList.contains('open');
            return { forecast: open('marine-forecast-accordion-body'), alert: open('main-accordion-body'), status: open('marine-status-accordion-body'),
                sub: [sub('regional-forecast-section') && 'regional', sub('ultra-short-forecast-section') && 'ultra', sub('short-term-forecast-section') && 'short'].filter(Boolean) };
        });
        const ALERTS = [['동해남부북쪽안쪽먼바다', '경보'], ['경북북부앞바다', '주의보'], ['동해중부안쪽먼바다', '주의보']]
            .map(([z, lv]) => ({ zoneName: z, warnType: '풍랑', level: lv, tmFc: '202611180400', tmEf: '202611190000' }));
        const a1 = await device();
        await check('⑥ 앱을 처음 켜면 특보가 없으므로 「해역별 기상현황」만 펼쳐져 있다(자동 펼침) · 해상 기상 전망 안쪽은 기본값 한 칸만(관심 기상청 없음 + 발표 시각 모름 → 지방청 칸)', async () => {
            assert.deepEqual(await acc(a1), { forecast: false, alert: false, status: true, sub: ['regional'] });
        });
        await check('⑥ 하나를 펼치면 나머지는 접힌다 — 해상 기상 전망 → 특보현황 → 기상현황, 어느 길로 열어도(머리 누르기·함수)', async () => {
            await tap(a1, '#marine-forecast-accordion-header');
            assert.deepEqual((await acc(a1)), { forecast: true, alert: false, status: false, sub: ['regional'] });   // 관심 기상청 없음 + 발표 시각 모름 → 지방청 칸([설정하기] 안내)
            await a1.evaluate(() => window.toggleMainAccordion());
            const s1 = await acc(a1); assert.ok(s1.alert && !s1.forecast && !s1.status, JSON.stringify(s1));
            await a1.evaluate(() => window.toggleMarineStatusAccordion());
            const s2 = await acc(a1); assert.ok(s2.status && !s2.forecast && !s2.alert, JSON.stringify(s2));
        });
        await check('⑥ 해상 기상 전망 안쪽도 하나만 — 초단기를 누르면 지방청이 접히고, 단기를 누르면 초단기가 접힌다 · 펼친 칸을 다시 누르면 접힌다', async () => {
            await tap(a1, '#marine-forecast-accordion-header');
            await tap(a1, '#ultra-short-forecast-section .marine-forecast-sub-header');
            assert.deepEqual((await acc(a1)).sub, ['ultra']);
            await tap(a1, '#short-term-forecast-section .marine-forecast-sub-header');
            assert.deepEqual((await acc(a1)).sub, ['short']);
            await tap(a1, '#short-term-forecast-section .marine-forecast-sub-header');
            assert.deepEqual((await acc(a1)).sub, []);
            await tap(a1, '#short-term-forecast-section .marine-forecast-sub-header');
        });
        await check('⑥ 다른 아코디언을 펼쳤다가 해상 기상 전망을 다시 펼치면 직전에 펼쳐 둔 칸(단기)이 그대로 — 기본값으로 돌아가지 않는다', async () => {
            await a1.evaluate(() => window.toggleMainAccordion());
            assert.equal((await acc(a1)).forecast, false);
            await tap(a1, '#marine-forecast-accordion-header');
            assert.deepEqual(await acc(a1), { forecast: true, alert: false, status: false, sub: ['short'] });
        });
        await check('⑥ 자료를 새로 받아 다시 그려도(5분마다 renderApp) 특보현황이 저절로 펼쳐지지 않는다 — 보던 해상 기상 전망 그대로', async () => {
            await a1.evaluate((al) => { appState.alerts = al; appState.coastalAlerts = {}; window.renderApp(); }, ALERTS);
            assert.deepEqual(await acc(a1), { forecast: true, alert: false, status: false, sub: ['short'] });
        });
        await check('⑥ 특보현황 안에서 펼쳐 둔 중분류는 다시 그려도(5분마다) 펼친 채로 — 접었다 다시 펼쳐도 그대로', async () => {
            await a1.evaluate(() => window.toggleMainAccordion());
            await a1.evaluate(() => { toggleSection('east-sea-list'); });
            await a1.waitForTimeout(100);
            await tap(a1, '#east-sea-list .sub-region-header');
            await a1.waitForTimeout(450);
            const shown = () => a1.evaluate(() => [...document.querySelectorAll('#east-sea-list .sub-region-list')].map((l) => l.style.display !== 'none'));
            const before = await shown();
            assert.deepEqual(before.filter(Boolean).length, 1, JSON.stringify(before));
            await a1.evaluate(() => window.renderApp());
            assert.deepEqual(await shown(), before, '다시 그린 뒤 펼친 중분류가 접혔다');
            await tap(a1, '#marine-forecast-accordion-header');   // 특보현황이 접힌다
            await a1.evaluate(() => window.renderApp());          // 접혀 있는 동안 자료 새로고침
            await a1.evaluate(() => window.toggleMainAccordion());
            assert.deepEqual(await shown(), before, '다시 펼쳤을 때 직전 중분류가 펼쳐져 있지 않다');
        });
        await a1.context().close();

        const MF_BOTH = { ultraShort: { reportId: 'cmt:202611191010:92', publishTime: '11.19. 10:10', type: '초단기전망' }, shortTerm: { reportId: 'cmt:202611191640:51', publishTime: '11.19. 16:40', type: '단기전망' } };
        await check('⑥ 관심 기상청 없음 → 해상 기상 전망을 처음 펼치면 초단기·단기 중 발표가 최신인 칸(단기 16:40)만 펼쳐진다', async () => {
            marineForecast = MF_BOTH;
            const q = await device();
            await tap(q, '#marine-forecast-accordion-header');
            assert.deepEqual((await acc(q)).sub, ['short']);
            await q.context().close();
            marineForecast = { ultraShort: { reportId: 'cmt:202611191710:93', publishTime: '11.19. 17:10' }, shortTerm: MF_BOTH.shortTerm };
            const q2 = await device();
            await tap(q2, '#marine-forecast-accordion-header');
            assert.deepEqual((await acc(q2)).sub, ['ultra'], '초단기가 더 최신이면 초단기');
            await q2.context().close();
        });
        await check('⑥ 관심 기상청 있음 → 처음 펼치면 「지방기상청 단기 전망」(이름이 칸 머리) · 칸을 바꾼 뒤 앱을 다시 켜면 다시 기본값', async () => {
            const q = await device({ store: { officeManualSettings: JSON.stringify({ 109: false, 159: true, 156: false, 105: false, 133: false, 143: false, 184: false }) } });
            await tap(q, '#marine-forecast-accordion-header');
            assert.deepEqual((await acc(q)).sub, ['regional']);
            assert.equal((await q.textContent('#regional-forecast-title .regional-forecast-office-name')).trim(), '부산지방기상청 단기 전망');
            assert.equal(await q.locator('#regional-forecast-body .regional-forecast-office-name').count(), 0, '안쪽에 지방청 카드가 또 있으면 안 된다');
            await tap(q, '#ultra-short-forecast-section .marine-forecast-sub-header');
            assert.deepEqual((await acc(q)).sub, ['ultra']);
            await reopen(q);
            await tap(q, '#marine-forecast-accordion-header');
            assert.deepEqual((await acc(q)).sub, ['regional'], '앱을 다시 켜면 기본값(지방청)부터');
            await q.context().close();
            marineForecast = { ultraShort: null, shortTerm: null };
        });
        await check('⑥ 「내 위치」 버튼에 이름이 한 줄로 붙고 버튼 안에 다 들어간다 — 평소·글자 크게 모두(해양종합정보 화면에서 잰다. 해양안전생활 #ls-gps-btn 은 같은 표시)', async () => {
            for (const size of ['medium', 'large']) {
                const q = await device({ store: { user_font_size: size } });
                await q.evaluate(() => window.switchMainTab('ocean-map-section'));
                await q.waitForTimeout(800); await clean(q);
                const r = await q.evaluate(() => {
                    const b = document.getElementById('ocean-myloc-btn'), l = b.querySelector('.ocean-overlay-label'), ls = document.querySelector('#ls-gps-btn .ocean-overlay-label');
                    const br = b.getBoundingClientRect(), lr = l.getBoundingClientRect(), cs = getComputedStyle(b);
                    const inner = br.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
                    // 큰 글자 모드는 글자를 ::before 로 그린다(style.css) — 그 글자가 줄바꿈 금지(nowrap)면 한 줄이고, 라벨 폭이 곧 글자 폭이다
                    const big = document.documentElement.getAttribute('data-font-size') === 'large';
                    const ws = getComputedStyle(l, big ? '::before' : null).whiteSpace;
                    return { text: l.textContent, line1: l.getAttribute('data-line1'), line2: l.getAttribute('data-line2'), lsText: ls && ls.textContent, lsLine2: ls && ls.getAttribute('data-line2'),
                        w: lr.width, inner, ws, bw: br.width, basemapW: document.getElementById('ocean-basemap-label').closest('button').getBoundingClientRect().width, visible: br.width > 0 };
                });
                assert.ok(r.visible, '버튼이 안 보인다');
                assert.deepEqual([r.text, r.line1, r.line2, r.lsText, r.lsLine2], ['내 위치', '내 위치', null, '내 위치', null]);
                assert.ok(r.w <= r.inner + 0.5, size + ' — 글자가 버튼 안쪽 폭을 넘는다: ' + JSON.stringify(r));
                assert.equal(r.ws, 'nowrap', size + ' — 줄바꿈이 될 수 있다: ' + JSON.stringify(r));
                assert.ok(Math.abs(r.bw - r.basemapW) < 0.5, size + ' — 「내 위치」 버튼 폭이 기본맵 버튼과 다르다(글자가 넘쳐 버튼이 넓어짐): ' + JSON.stringify(r));
                await q.screenshot({ path: path.join(SHOT, 'myloc_' + size + '.png'), clip: { x: 0, y: 0, width: 220, height: 260 } });
                await q.context().close();
            }
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
