/** 역할: 실제 렌더러로 관리자 오류현황·실시간 원천·목록 이동·응답 경합과 사용자 진단 제거를 검사한다.
 * [연계] 제품 admin.js / risk_sheet.js. 운영 API·인증정보 없이 Chromium 사용.
 */
'use strict';
const fs = require('fs'),
    path = require('path'),
    assert = require('assert'),
    { chromium } = require('playwright-core');
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
(async () => {
    const browser = await chromium.launch({
        ...(process.env.PW_CHROME
            ? { executablePath: process.env.PW_CHROME }
            : {}),
        headless: true,
        args: ['--no-sandbox'],
    });
    const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
    });
    try {
        const admin = fs.readFileSync(
                path.join(__dirname, '../../client/js/admin/admin.js'),
                'utf8'
            ),
            start = admin.indexOf('function renderAiForecastSubtab('),
            end = admin.indexOf('// AI 비서 하위탭 —', start);
        await page.setContent('<div id="host"></div><div id="sheet"></div>');
        await page.evaluate(() => {
            window.requests = [];
            window.fetch = async (url) => {
                window.requests.push(url);
                const p = Number(
                    new URL(url, 'https://local.invalid').searchParams.get(
                        'page'
                    ) || 1
                );
                return {
                    ok: true,
                    json: async () => ({
                        current: [
                            {
                                source: 'accident',
                                scope: 'global',
                                status: 'stale',
                                code: 'stale',
                                updatedAt: '2026-10-12T03:00:00+09:00',
                            },
                        ],
                        data: [
                            {
                                source: 'events',
                                scope: '2026-10',
                                status: 'error',
                                phase: 'opened',
                                code: 'HTTP 400',
                                firstAt: '2026-10-12T03:00:00+09:00',
                                lastAt: '2026-10-12T09:00:00+09:00',
                            },
                        ],
                        pagination: { page: p, totalPages: 2, total: 31 },
                    }),
                };
            };
        });
        await page.addScriptTag({ content: admin.slice(start, end) });
        await page.evaluate(() =>
            renderAiForecastSubtab(document.getElementById('host'))
        );
        await test('관리자 하위탭에 현재 원천·오류·KST 표시', async () => {
            await page.waitForSelector('[data-risk-next]');
            const text = await page.locator('#host').innerText();
            for (const expected of [
                '오류현황',
                '공식 선박사고 예보',
                '자료 오래됨',
                '문제 발생',
                'HTTP 400',
                'KST',
            ])
                assert.ok(text.includes(expected));
            // 2026-10-15: AI 탭에서 빠져 점검 → 데이터 수집현황 아래로 옮겼다(사용자 「빠져서 점검 탭 아래로 가는게 맞음」).
            assert.ok(!admin.includes("mkTabBtn('forecast', 'AI 사고예측')"));
            assert.ok(admin.includes("switchMaintenanceSubTab('data')"));
        });
        await test('관리자 목록 다음 페이지와 원천 필터는 실제 요청 조건 변경', async () => {
            await page.locator('[data-risk-next]').click();
            await page.waitForFunction(() =>
                window.requests.at(-1).includes('page=2')
            );
            await page.locator('[data-risk-source]').selectOption('events');
            await page.waitForFunction(
                () =>
                    window.requests.at(-1).includes('source=events') &&
                    window.requests.at(-1).includes('page=1')
            );
        });
        await test('실시간 교통도 관리자 원천 필터에 포함', async () => {
            assert.equal(
                await page
                    .locator('[data-risk-source] option[value="realtime"]')
                    .count(),
                1
            );
        });
        await test('해구별 시정 예측도 관리자 원천 필터에 포함', async () => {
            assert.equal(
                await page
                    .locator('[data-risk-source] option[value="visibility"]')
                    .innerText(),
                '해구별 시정 예측'
            );
        });
        await test('결정 6(2026-10-16): 연안 안전 브리핑(종전 활동지점 안전 브리핑 — 2026-10-17 이름 바꿈)도 관리자 원천 필터에 포함', async () => {
            assert.equal(
                await page
                    .locator('[data-risk-source] option[value="stationBriefing"]')
                    .innerText(),
                '연안 안전 브리핑'
            );
        });
        await test('모바일 390px에서 관리자 오류 목록 가로 넘침 없음', async () => {
            assert.equal(
                await page.evaluate(
                    () => document.documentElement.scrollWidth > innerWidth
                ),
                false
            );
        });
        await test('관리자 HTML 값은 실행되지 않고 안전한 문자열 표시', async () => {
            await page.evaluate(() => {
                window.fetch = async () => ({
                    ok: true,
                    json: async () => ({
                        current: [],
                        data: [
                            {
                                source: 'events',
                                scope: '<img src=x onerror="window.injected=true">',
                                status: 'error',
                                phase: 'opened',
                                code: '<script>window.injected=true</script>',
                                firstAt: null,
                                lastAt: null,
                            },
                        ],
                        pagination: { page: 1, totalPages: 1, total: 1 },
                    }),
                });
                renderAiForecastSubtab(document.getElementById('host'));
            });
            await page.waitForSelector('[data-risk-next]');
            assert.equal(
                await page.locator('#host img, #host script').count(),
                0
            );
            assert.equal(
                await page.evaluate(() => Boolean(window.injected)),
                false
            );
        });
        await test('탭 이동 뒤 지연 응답이 다른 탭을 덮지 않음', async () => {
            await page.evaluate(() => {
                window.fetch = () =>
                    new Promise((resolve) => (window.delayed = resolve));
                renderAiForecastSubtab(document.getElementById('host'));
                document.getElementById('host').innerHTML = '<p>다른 탭</p>';
                window.delayed({
                    ok: true,
                    json: async () => ({
                        current: [],
                        data: [],
                        pagination: { page: 1, totalPages: 1, total: 0 },
                    }),
                });
            });
            await page.waitForTimeout(20);
            assert.equal(await page.locator('#host').innerText(), '다른 탭');
        });
        const root = path.join(
            __dirname,
            '../../client/js/marine-life/risk-forecast'
        );
        for (const file of ['risk_format.js', 'risk_sheet.js'])
            await page.addScriptTag({
                content: fs.readFileSync(path.join(root, file), 'utf8'),
            });
        await test('사용자 시트의 원천 진단 상자 제거, 개별 결측 표시 유지', async () => {
            await page.evaluate(() => {
                window.sheet = RiskSheet.create(
                    document.getElementById('sheet'),
                    {
                        close() {},
                        hazard() {},
                        basis() {},
                        choose() {},
                        retry() {},
                    }
                );
                sheet.show(
                    {
                        title: '관광지',
                        subtitle: { lat: 35, lon: 129 },
                        t: '2026-10-12T09:00:00+09:00',
                        score: 0,
                        index: 0,
                        band: '낮음',
                        rr: 1,
                        fatalRr: 1,
                        rows: [{ key: 'people', missing: true }],
                        sources: {
                            warnings: { status: 'stale' },
                            events: { status: 'error' },
                            zoneForecasts: { status: 'stale' },
                        },
                        missing: ['events', 'warnings'],
                    },
                    'coast',
                    { lat: 35, lon: 129 }
                );
            });
            const body = await page.locator('#sheet .rf-body').innerText();
            for (const forbidden of [
                '자료가 오래되었습니다',
                '자료 수집에 실패했습니다',
                '일부 요소 자료 없음',
            ])
                assert.ok(!body.includes(forbidden));
            assert.ok(body.includes('자료 없음'));
        });
        await test('상세 전체 실패의 다시 시도는 유지', async () => {
            await page.evaluate(() => sheet.error('HTTP 503'));
            assert.equal(await page.locator('#sheet [data-retry]').count(), 1);
            assert.ok(
                (await page.locator('#sheet').innerText()).includes('다시 시도')
            );
        });
    } finally {
        await browser.close();
        console.log(`${pass} PASS / ${fail} FAIL`);
        if (fail) process.exitCode = 1;
    }
})();
