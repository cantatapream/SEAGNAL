'use strict';
/**
 * ============================================================================
 * 파일명: local_server/scripts/test_zone_trend_ui.js
 * 역할  : 특보 카드 뱃지의 오르내림 화살표를 실제 화면(Chromium)으로 본다.
 *         다가오는 특보가 지금보다 높으면 🔺(발효될 때까지), 낮으면 초록 ▼, 예비특보·같은 등급·다가오는 것 없음은 표시 없음.
 * 사용자 2026-11-20: 「뱃지에는 올라가는 표시가 경보가 될때까지 남아있었으면」 「다가오는 특보가 기존 등급에서 내려가는 것이라면 초록색 하단으로 표시되는 삼각형」
 *   「올라감임 태풍이 풍랑보다 높은 단계」 「다가오는 예비특보는 해당 없음」 「(해제예정만) 표시 없음이 맞음」
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 시험 대상 : client/js/forecast/alerts/escalation.js(zoneTrend) · render.js(createAlertElement 의 뱃지) · client/style.css(.badge-trend-down)
 *  - 서버 API  : GET /api/weather-alerts(가짜 — 운영 응답 꼴: 해역마다 current·upcoming)
 *  - 실행      : node scripts/test_zone_trend_ui.js   (scripts/refactor/verify_all.sh SUITES 에 등록)
 * [로드 순서] 없음(시험)
 * ============================================================================
 */
const path = require('path'), assert = require('assert'), express = require('express'), { chromium } = require('playwright');
const root = path.join(__dirname, '..', '..');
// 시각에 기대지 않게: 지금 특보는 한참 전에 발효, 다가오는 특보는 2099년 발효 예정
const PAST = '2026년 01월 01일 03시 00분', FUT = '2099년 01월 01일 03시 00분';
const A = (tp, lv, ef) => ({ wrnTp: tp, wrnTpNm: tp, wrnLvl: lv, wrnLvlNm: lv, tmFc: ef === FUT ? '2026년 01월 02일 01시 00분' : '2026년 01월 01일 01시 00분', tmEf: ef, tmYn: '', tmCc: '', clrNtcTm: '', source: 'MARINE_MMIS' });
const Z = (cur, up) => ({ current: cur, upcoming: up || null, history: [], children: {} });
const TREE = { 제주도: { 제주도먼바다: {
    제주도남서쪽안쪽먼바다: Z(A('풍랑', '주의보', PAST), A('풍랑', '경보', FUT)),      // 오른다
    제주도남쪽바깥먼바다: Z(A('풍랑', '경보', PAST), A('풍랑', '주의보', FUT)),        // 내린다
    제주도남동쪽안쪽먼바다: Z(A('풍랑', '주의보', PAST), null),                          // 다가오는 것 없음
} } };
let pass = 0, fail = 0;
async function check(name, fn) { try { await fn(); console.log('✅', name); pass++; } catch (e) { console.error('❌', name, e && e.message); fail++; } }

(async () => {
    let browser, server;
    try {
        const app = express();
        app.get('/api/weather-alerts', (q, r) => r.json({ updatedAt: new Date().toISOString(), previous: TREE, current: TREE }));
        app.get('/', (q, r) => r.sendFile(path.join(root, 'client/index2.html')));
        app.use(express.static(path.join(root, 'client')));
        app.use('/api', (q, r) => r.status(404).json({ ok: false }));
        server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
        const base = 'http://127.0.0.1:' + server.address().port;
        browser = await chromium.launch({ ...((process.env.PW_CHROME || process.env.SIM_CHROMIUM || process.env.CHROMIUM_EXECUTABLE) ? { executablePath: process.env.PW_CHROME || process.env.SIM_CHROMIUM || process.env.CHROMIUM_EXECUTABLE } : {}), headless: true, args: ['--no-sandbox'] });
        const page = await (await browser.newContext({ viewport: { width: 412, height: 915 }, timezoneId: 'Asia/Seoul', deviceScaleFactor: 2 })).newPage();
        await page.route('**/*', (r) => r.request().url().startsWith(base) ? r.continue() : r.abort());
        await page.goto(base + '/');
        await page.waitForFunction(() => typeof window.zoneTrend === 'function' && document.querySelectorAll('.status-badge.warning').length >= 3, null, { timeout: 30000 });
        /** 그 해역 카드의 첫 뱃지 글자와 초록 ▼ 유무·색 */
        const badge = (zone) => page.evaluate((z) => {
            const all = [...document.querySelectorAll('.status-badge.warning')];
            const b = all.find((x) => { let p = x; for (let i = 0; i < 6 && p; i++) { p = p.parentElement; if (p && p.textContent.includes(z) && p.querySelectorAll('.status-badge.warning').length === 1) return true; } return false; });
            if (!b) return null; const d = b.querySelector('.badge-trend'), cs = d && getComputedStyle(d);
            return { text: b.textContent.replace(/\s+/g, ' ').trim(), down: !!(d && d.classList.contains('badge-trend-down')), up: !!(d && d.classList.contains('badge-trend-up')), color: cs ? cs.color : '', size: cs ? cs.fontSize : '', font: cs ? cs.fontFamily : '', h: d ? Math.round(d.getBoundingClientRect().height * 10) / 10 : 0, w: d ? Math.round(d.getBoundingClientRect().width * 10) / 10 : 0 };
        }, zone);

        await check('다가오는 특보가 더 높다(풍랑주의보 → 풍랑경보 예정): 뱃지에 빨간 ▲ — 글에 적힌 「가능성」 안내가 없어도', async () => {
            const b = await badge('제주도남서쪽안쪽먼바다'); assert.ok(b, '카드를 못 찾음'); assert.equal(b.text, '풍랑 주의보 ▲'); assert.equal(b.up, true); assert.equal(b.down, false); assert.equal(b.color, 'rgb(255, 82, 82)');
        });
        await check('다가오는 특보가 더 낮다(풍랑경보 → 풍랑주의보 예정): 뱃지에 초록 ▼', async () => {
            const b = await badge('제주도남쪽바깥먼바다'); assert.ok(b, '카드를 못 찾음'); assert.equal(b.text, '풍랑 경보 ▼'); assert.equal(b.down, true); assert.equal(b.color, 'rgb(52, 211, 153)');
        });
        await check('두 화살표는 같은 꼴이다 — 글자 크기·글꼴·차지하는 크기가 같고 색과 방향만 다르다(사용자 「화살표 세모가 동일한 스타일로」)', async () => {
            const u = await badge('제주도남서쪽안쪽먼바다'), d = await badge('제주도남쪽바깥먼바다');
            assert.equal(u.size, d.size); assert.equal(u.font, d.font); assert.equal(u.h, d.h); assert.ok(Math.abs(u.w - d.w) < 0.6, JSON.stringify([u, d])); assert.notEqual(u.color, d.color);
        });
        await check('다가오는 특보가 없으면 화살표 없음', async () => {
            const b = await badge('제주도남동쪽안쪽먼바다'); assert.ok(b, '카드를 못 찾음'); assert.equal(b.text, '풍랑 주의보'); assert.equal(b.down, false); assert.equal(b.up, false);
        });
        await check('높낮이 규칙(zoneTrend): 종류 먼저(태풍 > 풍랑) · 같으면 등급(경보 > 주의보) · 예비특보는 견주지 않는다 · 지금 특보가 없으면 없음 · 「아직 발효 전」 표시(isPreliminary)는 예비가 아니다', async () => {
            const r = await page.evaluate(() => { const t = (c, u) => window.zoneTrend({ current: c && { warnType: c[0], level: c[1] }, upcoming: (u || []).map((x) => ({ warnType: x[0], level: x[1], isPreliminary: true })) });
                return [t(['풍랑', '주의보'], [['풍랑', '경보']]), t(['풍랑', '경보'], [['태풍', '주의보']]), t(['풍랑', '주의보'], [['태풍', '경보']]), t(['태풍', '주의보'], [['태풍', '경보']]),
                    t(['풍랑', '경보'], [['풍랑', '주의보']]), t(['태풍', '주의보'], [['풍랑', '경보']]), t(['태풍', '경보'], [['태풍', '주의보']]),
                    t(['풍랑', '경보'], [['풍랑', '예비']]), t(['풍랑', '주의보'], [['풍랑', '예비']]), t(['풍랑', '주의보'], [['풍랑', '주의보']]), t(['풍랑', '주의보'], []), t(null, [['풍랑', '경보']]),
                    t(['풍랑', '경보'], [['풍랑', '주의보'], ['태풍', '주의보']]), t(['풍랑', '주의보'], [['강풍', '경보']])].join(','); });
            assert.equal(r, 'up,up,up,up,down,down,down,,,,,,up,');
        });
        if (process.env.TREND_SHOT_DIR) {   // 사람이 볼 그림(선택) — 시작 화면·안내 팝업을 걷고 뱃지가 있는 자리로
            await page.evaluate(() => { ['server-maintenance-popup', 'network-error-popup', 'splash-screen', 'main-notice-popup', 'zone-guide-popup', 'survey-user-popup'].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); }); });
            await page.click('text=제주 해역').catch(() => {});   // 지역 묶음을 펼친다(접혀 있으면 뱃지가 안 보인다)
            await page.waitForTimeout(600);
            await page.evaluate(() => { const b = document.querySelector('.status-badge.warning'); if (b) b.scrollIntoView({ block: 'center' }); });
            await page.waitForTimeout(400);
            await page.screenshot({ path: path.join(process.env.TREND_SHOT_DIR, 'trend_412.png'), fullPage: false });
        }
    } catch (e) { console.error('❌ 시험 중 예외', e && e.message); fail++; }
    finally { if (browser) await browser.close(); if (server) server.close(); }
    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();
