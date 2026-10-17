/**
 * 역할: 관리자 → 점검 → 「데이터 수집현황」 화면을 실제 라우터 + Chromium 으로 검사한다.
 *       하위 탭 셋(수집 목록·현재 원천 상태·오류·복구 이력), 출처별 묶음, 상태 배지 색(오래됨 노랑·수집 실패 빨강),
 *       「확인 필요」·「기록 없음」 표시, 출처 거르기, 늦은 응답 무시, 380px 가로 넘침 없음,
 *       그리고 AI 탭에서 「AI 사고예측」이 빠지고 점검 탭에 들어갔는지(글자 검사)를 본다.
 * [연계] client/js/admin/admin_data_status.js · admin.js(renderAiForecastSubtab 조각, switchMaintenanceSubTab) ·
 *        routes/data_collection.js · routes/risk_errors.js · services/data_collection_status.js · services/risk_error_history.js.
 *        인증은 test_data_collection_status·test_risk_errors 가 실제 admin_auth 로 따로 본다 — 여기서는 통과 함수를 넣는다.
 *        환경변수 DS_SHOT_DIR 이 있으면 화면 사진을 남긴다(판정과 무관). 외부 API 호출 없음.
 * [로드 순서] 시험 스크립트 — NODE_PATH 에 playwright-core 가 있어야 한다 · verify_all.sh SUITES
 */
'use strict';
const fs = require('fs'),
    os = require('os'),
    path = require('path'),
    zlib = require('zlib'),
    assert = require('assert'),
    express = require('express'),
    { chromium } = require('playwright-core');
const { createRouter: riskRouter } = require('../routes/risk_errors'),
    { createRouter: dataRouter } = require('../routes/data_collection'),
    { createHistory } = require('../services/risk_error_history'),
    { createStatus } = require('../services/data_collection_status');
const ROOT = path.join(__dirname, '../..'),
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'data-collection-ui-')),
    dataDir = path.join(tmp, 'data');
let pass = 0,
    fail = 0;
async function test(name, fn) {
    try {
        await fn();
        pass++;
        console.log('✅', name);
    } catch (e) {
        fail++;
        console.error('❌', name, e.message);
    }
}
const write = (rel, obj) => {
    const f = path.join(dataDir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const b = Buffer.from(JSON.stringify(obj));
    fs.writeFileSync(f, rel.endsWith('.gz') ? zlib.gzipSync(b) : b);
};
// 고정 시각(시각 의존 금지): 2026-10-15 22:23 KST — 12UTC 해구 예보 판이 아직 없던 실측 시각.
let now = Date.parse('2026-10-15T22:23:00+09:00');
write('zone_forecasts.json', { updatedAt: '2026. 10. 15. 오후 9:30:40', baseTmUtf: '2026101500', data: {} });
write('zone_forecasts_status.json', { lastRun: '2026-10-15T21:31:00+09:00', result: 'same', message: '새 판 없음, 기존 판 유지 — 같은 판 2026101500 를 다시 받음 · 예정 판 2026101512 미게시' });
write('buoys.json', { updatedAt: '2026. 10. 15. 오후 10:05:54', raw: 'x' });
const history = createHistory({ dir: path.join(tmp, 'risk'), clock: () => now });
history.observeSources({
    visibility: { status: 'error', lastError: 'empty response', lastSuccess: '2026-10-11T21:10:00+09:00', checkedAt: '2026-10-15T22:20:00+09:00' },
    warnings: { status: 'ok', updatedAt: '2026-10-15T22:22:00+09:00' },
    accident: { status: 'stale', updatedAt: '2026-10-13T03:00:00+09:00' },
    // 결정 6(2026-10-16): 활동지점 안전 브리핑 — AI 총평 대신 틀(일부 실패)
    stationBriefing: { status: 'partial', partialCode: '브리핑 일부 실패 — AI 총평 대신 틀', updatedAt: '2026-10-15T17:30:00+09:00', lastSuccess: '2026-10-15T17:30:00+09:00', detail: '마지막 실행 AI 총평 대신 틀 3곳(validate 3) — 생성 방식 chatgpt' },
});
now += 60000;
history.observeSources({ accident: { status: 'ok', updatedAt: '2026-10-15T15:10:00+09:00' } });
const pass_ = (req, res, next) => next();
let delay = 0;
const app = express();
app.use((req, res, next) => (delay && req.path === '/api/admin/data-collection' ? setTimeout(next, delay) : next()));
app.use(riskRouter({ history, authorize: pass_ }));
app.use(
    dataRouter({
        status: createStatus({ dataDir, clock: () => now, riskCurrent: () => history.list({ page: 1, limit: 1 }).current, schedulerStatus: () => null }),
        authorize: pass_,
    })
);
const admin = fs.readFileSync(path.join(ROOT, 'client/js/admin/admin.js'), 'utf8'),
    start = admin.indexOf('function renderAiForecastSubtab('),
    end = admin.indexOf('// AI 비서 하위탭 —', start);
app.get('/slice.js', (req, res) => res.type('js').send(admin.slice(start, end)));
app.get('/data_status.js', (req, res) => res.sendFile(path.join(ROOT, 'client/js/admin/admin_data_status.js')));
app.get('/style.css', (req, res) => res.sendFile(path.join(ROOT, 'client/style.css')));
app.get('/', (req, res) =>
    res.type('html').send(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<link rel="stylesheet" href="/style.css"><body style="margin:0;background:#0f172a;">' +
            '<div class="unified-admin-wrapper" style="height:auto;width:100%;max-width:800px;margin:0 auto;animation:none;">' +
            '<div class="unified-admin-body"><div id="host"></div></div></div>' +
            '<script src="/slice.js"></script><script src="/data_status.js"></script></body>'
    )
);

(async () => {
    let server, browser;
    try {
        await test('글자 검사: AI 탭에서 「AI 사고예측」이 빠지고 점검 탭에 「데이터 수집현황」, index2.html 로드 순서', async () => {
            assert.ok(!admin.includes("mkTabBtn('forecast'"), 'AI 탭에 forecast 버튼이 남아 있음');
            assert.ok(!/which === 'forecast'/.test(admin), 'AI 탭 분기에 forecast 가 남아 있음');
            assert.ok(admin.includes('id="maint-subtab-data"') && admin.includes("switchMaintenanceSubTab('data')"));
            assert.ok(/tab === 'data'[\s\S]{0,200}renderDataCollectionTab/.test(admin));
            const html = fs.readFileSync(path.join(ROOT, 'client/index2.html'), 'utf8'),
                a = html.indexOf('src="js/admin/admin.js'),
                b = html.indexOf('src="js/admin/admin_data_status.js"'),
                c = html.indexOf('src="js/admin/admin_collect.js');
            assert.ok(a > 0 && b > a && c > b, 'admin.js → admin_data_status.js → admin_collect.js');
        });
        server = app.listen(0, '127.0.0.1');
        await new Promise((resolve) => server.once('listening', resolve));
        browser = await chromium.launch({
            ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}),
            headless: true,
            args: ['--no-sandbox'],
        });
        const page = await browser.newPage({ viewport: { width: 380, height: 900 } });
        await page.goto('http://127.0.0.1:' + server.address().port + '/');
        await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* 없음 */ } renderDataCollectionTab(document.getElementById('host')); });
        await page.waitForSelector('[data-ds-summary]');
        const shots = process.env.DS_SHOT_DIR;
        if (shots) {
            fs.mkdirSync(shots, { recursive: true });
            await page.screenshot({ path: path.join(shots, 'list_380.png'), fullPage: true });
        }
        const text = () => page.locator('#host').innerText();
        const color = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).color : null; }, sel);
        const rgb = (s) => (s || '').match(/\d+/g).slice(0, 3).map(Number);

        await test('하위 탭 셋과 기본 「수집 목록」, 요약(데이터 수·1/2단계·확인 필요 수)', async () => {
            const t = await text();
            for (const w of ['수집 목록', '현재 원천 상태', '오류·복구 이력', '1단계 위험예측', '2단계 그 밖', '「확인 필요」']) assert.ok(t.includes(w), w);
        });
        await test('출처별 묶음(기상청 API허브·기상청 MMIS·해양교통안전공단·한국관광공사·국립해양조사원)', async () => {
            const groups = await page.locator('[data-ds-group]').evaluateAll((g) => g.map((x) => x.dataset.dsGroup));
            for (const id of ['kma-apihub', 'kma-mmis', 'komsa', 'kto', 'khoa']) assert.ok(groups.includes(id), id);
        });
        await test('해구 예보 카드: 12UTC 판 미게시 → 노랑 「자료 오래됨」 · 공식 갱신 「실측」 · 「새 판 없음, 기존 판 유지」', async () => {
            const card = page.locator('[data-ds-card="zoneForecasts"]'),
                t = await card.innerText();
            for (const w of ['해구별 기상예보 (기상청 API허브)', '실측', '자료 오래됨', '새 판 없음, 기존 판 유지', '다음 기대 시각', 'KST']) assert.ok(t.includes(w), w);
            const [r, g, b] = rgb(await color('[data-ds-card="zoneForecasts"] [data-ds-badge]'));
            assert.ok(r > b + 60 && g > b + 60, '노랑 계열');
        });
        await test('시정 예측 (기상청 MMIS): 오류현황 수집 실패 → 빨강 · 공식 갱신 「확인 필요」', async () => {
            const t = await page.locator('[data-ds-card="visibility"]').innerText();
            assert.ok(t.includes('시정 예측 (기상청 MMIS)') && t.includes('수집 실패') && t.includes('확인 필요'));
            const [r, g] = rgb(await color('[data-ds-card="visibility"] [data-ds-badge]'));
            assert.ok(r > g + 60, '빨강 계열');
            assert.equal(await page.locator('[data-ds-card="visibility"] [data-ds-needcheck]').count(), 1);
        });
        await test('결정 6: 연안 안전 브리핑 카드(2026-10-17 이름 바꿈) — 오류현황 일부 실패(주황)·분류·상세', async () => {
            const t = await page.locator('[data-ds-card="stationBriefing"]').innerText();
            for (const w of ['연안 안전 브리핑 (우리 서버 생성)', '일부 실패', '브리핑 일부 실패 — AI 총평 대신 틀', 'AI 총평 대신 틀 3곳']) assert.ok(t.includes(w), w + ' / ' + t);
            const [r, g, b] = rgb(await color('[data-ds-card="stationBriefing"] [data-ds-badge]'));
            assert.ok(r > b + 60 && r > g, '주황 계열');
        });
        await test('읽을 곳이 없는 칸은 「기록 없음」(지어내지 않음)', async () => {
            const t = await page.locator('[data-ds-card="typhoon"]').innerText();
            assert.ok(t.includes('기록 없음') && t.includes('자료 없음'), t);
        });
        await test('근거 보기: 저장소 경로:줄과 인용', async () => {
            await page.locator('[data-ds-card="zoneForecasts"] summary').click();
            const t = await page.locator('[data-ds-card="zoneForecasts"] details').innerText();
            assert.ok(/local_server\/scheduler\.js:\d+/.test(t) && t.includes('min === 0 || min === 30'), t.slice(0, 200));
        });
        await test('출처 거르기: 기상청 MMIS 만', async () => {
            await page.locator('[data-ds-provider]').selectOption('kma-mmis');
            const groups = await page.locator('[data-ds-group]').evaluateAll((g) => g.map((x) => x.dataset.dsGroup));
            assert.deepEqual(groups, ['kma-mmis']);
            await page.locator('[data-ds-provider]').selectOption('');
        });
        await test('모바일 380px 에서 가로 넘침 없음(근거 펼친 채)', async () => {
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        });
        await test('「현재 원천 상태」 탭: 현재 상태만(이력·넘김 없음), 필터 유지', async () => {
            await page.locator('[data-ds-tab="current"]').click();
            await page.waitForSelector('[data-risk-current]');
            assert.equal(await page.locator('[data-risk-row]').count(), 0);
            assert.equal(await page.locator('[data-risk-next]').count(), 0);
            const t = await text();
            assert.ok(t.includes('시정') || t.includes('해구별 시정 예측'));
            await page.locator('[data-risk-source]').selectOption('accident');
            await page.waitForFunction(() => document.querySelectorAll('[data-risk-card]').length === 1);
            if (shots) await page.screenshot({ path: path.join(shots, 'current_380.png'), fullPage: true });
        });
        await test('「오류·복구 이력」 탭: 이력만(현재 상태 구역 없음)·복구 기록', async () => {
            await page.locator('[data-ds-tab="history"]').click();
            await page.waitForSelector('[data-risk-next]');
            assert.equal(await page.locator('[data-risk-current]').count(), 0);
            const t = await text();
            assert.ok(t.includes('복구') && t.includes('문제 발생'), t.slice(0, 300));
        });
        await test('마지막으로 연 하위 탭을 기억', async () => {
            await page.evaluate(() => renderDataCollectionTab(document.getElementById('host')));
            await page.waitForSelector('[data-risk-next]');
            assert.equal(await page.evaluate(() => localStorage.getItem('seagnal_datastatus_subtab')), 'history');
        });
        await test('수집 목록 응답이 늦게 와도 다른 탭으로 옮긴 뒤면 덮어쓰지 않음', async () => {
            delay = 600;
            await page.locator('[data-ds-tab="list"]').click();
            await page.locator('[data-ds-tab="current"]').click();
            await page.waitForSelector('[data-risk-current]');
            await page.waitForTimeout(900);
            assert.equal(await page.locator('[data-ds-summary]').count(), 0);
            assert.ok((await text()).includes('현재 원천 상태'));
            delay = 0;
        });
    } finally {
        if (browser) await browser.close();
        if (server) await new Promise((resolve) => server.close(resolve));
        fs.rmSync(tmp, { recursive: true, force: true });
        console.log(`${pass} PASS / ${fail} FAIL`);
        process.exit(fail ? 1 : 0);
    }
})();
