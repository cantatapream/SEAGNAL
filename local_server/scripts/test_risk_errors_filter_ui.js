/**
 * 역할: 관리자 오류현황의 원천·상태 필터가 현재 상태·이력 둘 다에 걸리는지와 상태 배지 색을 실제 라우터+Chromium 으로 검사한다.
 *       빈 목록 안내·상세 줄·380px 폭도 본다.
 * [연계] 제품 admin.js(renderAiForecastSubtab) / routes/risk_errors.createRouter / services/risk_error_history.
 *       인증은 test_risk_errors 가 실제 admin_auth 로 따로 본다 — 여기서는 통과 함수를 주입한다(비밀번호 없음).
 *       환경변수 RISK_SHOT_DIR 이 있으면 그 폴더에 화면 사진을 남긴다(검사 판정과는 무관).
 * [왜] 2026-10-15 사용자 지적 「필터가 제대로 작동하지 않는다」 — 서버 list() 가 이력(data)만 거르고
 *       현재 상태(current)는 거르지 않아, 원천을 골라도 위쪽 현재 상태 목록이 그대로였다.
 */
'use strict';
const fs = require('fs'),
    os = require('os'),
    path = require('path'),
    assert = require('assert'),
    express = require('express'),
    { chromium } = require('playwright-core');
const { createRouter } = require('../routes/risk_errors'),
    { createHistory } = require('../services/risk_error_history');
const ROOT = path.join(__dirname, '../..'),
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'risk-filter-ui-'));
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
// 고정 시각(어제 이전) — 시각 의존 금지.
let now = Date.parse('2026-10-12T09:00:00+09:00');
const history = createHistory({ dir, clock: () => now });
// 원천 여섯: 실패 둘(시정·실시간), 오래됨(사고), 정상(특보), 비운영(이안류), 행사 월 자료 없음.
history.observeSources({
    visibility: {
        status: 'error',
        lastError: 'invalid response',
        detail: '연속 3회 확인 실패',
        lastSuccess: '2026-10-11T21:10:00+09:00',
        checkedAt: '2026-10-12T08:55:00+09:00',
    },
    realtime: { status: 'error', lastError: 'HTTP 503' },
    accident: { status: 'stale', updatedAt: '2026-10-10T03:00:00+09:00' },
    warnings: { status: 'ok', updatedAt: '2026-10-12T08:50:00+09:00' },
    ripCurrent: { status: 'offseason' },
    events: { months: { '2026-10': { status: 'missing' } } },
});
// 행사 다음 달: 수집은 성공(ok)했지만 Gemini 보충검색이 두 시도에서 실패 → 「일부 실패」(2026-10-15).
history.observeSources({
    events: {
        months: {
            '2026-11': {
                status: 'ok',
                failedProvinceCount: 2,
                detail: '시도 실패 경상남도(Gemini 호출 실패), 전라남도(Gemini 호출 실패)',
            },
        },
    },
});
now += 60000;
history.observeSources({ warnings: { status: 'stale' } });
now += 60000;
history.observeSources({ warnings: { status: 'ok' } });

const app = express();
app.use(createRouter({ history, authorize: (req, res, next) => next() }));
const admin = fs.readFileSync(path.join(ROOT, 'client/js/admin/admin.js'), 'utf8'),
    start = admin.indexOf('function renderAiForecastSubtab('),
    end = admin.indexOf('// AI 비서 하위탭 —', start);
app.get('/slice.js', (req, res) => res.type('js').send(admin.slice(start, end)));
app.get('/style.css', (req, res) => res.sendFile(path.join(ROOT, 'client/style.css')));
// 관리자 모달 본문과 같은 어두운 바탕 안에 그린다(모달의 고정 높이·등장 효과만 끈다).
app.get('/', (req, res) =>
    res.type('html').send(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<link rel="stylesheet" href="/style.css"><body style="margin:0;background:#0f172a;">' +
            '<div class="unified-admin-wrapper" style="height:auto;width:100%;max-width:800px;margin:0 auto;animation:none;">' +
            '<div class="unified-admin-body"><div id="host"></div></div></div>' +
            '<script src="/slice.js"></script></body>'
    )
);

(async () => {
    let server, browser;
    try {
        server = app.listen(0, '127.0.0.1');
        await new Promise((resolve) => server.once('listening', resolve));
        browser = await chromium.launch({
            ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}),
            headless: true,
            args: ['--no-sandbox'],
        });
        const page = await browser.newPage({ viewport: { width: 380, height: 900 } });
        await page.goto('http://127.0.0.1:' + server.address().port + '/');
        // 응답이 그려질 때마다 1 씩 늘리는 대신, 요청 수와 「불러오는 중」 해제를 같이 기다린다.
        const settle = async () => {
            await page.waitForFunction(() => {
                const t = document.getElementById('host').innerText;
                return t.includes('오류·복구 이력') && !t.includes('불러오는 중');
            });
        };
        /** 화면 글자를 「현재 원천 상태」 와 「오류·복구 이력」 두 구역으로 나눈다(수정 전·후 공통 제목). */
        const sections = async () => {
            const text = await page.locator('#host').innerText(),
                // 안내문에도 같은 낱말이 나오므로 마지막(구역 제목)을 쓴다.
                a = text.lastIndexOf('현재 원천 상태'),
                b = text.lastIndexOf('오류·복구 이력');
            assert.ok(a >= 0 && b > a, '두 구역 제목이 보여야 함');
            return { current: text.slice(a, b), history: text.slice(b) };
        };
        const choose = async (key, value) => {
            await page.locator('[data-risk-' + key + ']').selectOption(value);
            await settle();
        };
        await page.evaluate(() => renderAiForecastSubtab(document.getElementById('host')));
        await settle();
        const shots = process.env.RISK_SHOT_DIR;
        if (shots) {
            fs.mkdirSync(shots, { recursive: true });
            await page.screenshot({ path: path.join(shots, 'mobile_380_all.png'), fullPage: true });
            await page.setViewportSize({ width: 820, height: 900 });
            await page.screenshot({ path: path.join(shots, 'desktop_820_all.png'), fullPage: true });
            await page.setViewportSize({ width: 380, height: 900 });
        }

        await test('필터 없음: 현재 상태에 여섯 원천이 다 보임', async () => {
            const { current } = await sections();
            for (const label of ['해구별 시정 예측', '실시간 선박 교통', '공식 선박사고 예보', '특보', '이안류', '행사'])
                assert.ok(current.includes(label), label + ' 없음');
        });
        await test('원천 필터(해구별 시정 예측)가 현재 상태에도 적용', async () => {
            await choose('source', 'visibility');
            const { current } = await sections();
            assert.ok(current.includes('해구별 시정 예측'));
            for (const other of ['실시간 선박 교통', '공식 선박사고 예보', '이안류'])
                assert.ok(!current.includes(other), '현재 상태에 ' + other + ' 가 남아 있음');
        });
        await test('원천 필터(해구별 시정 예측)가 이력에도 적용', async () => {
            const { history: h } = await sections();
            assert.ok(h.includes('해구별 시정 예측'));
            assert.ok(!h.includes('실시간 선박 교통') && !h.includes('공식 선박사고 예보'));
        });
        if (shots) {
            await page.setViewportSize({ width: 820, height: 900 });
            await page.screenshot({ path: path.join(shots, 'desktop_820_visibility.png'), fullPage: true });
            await page.setViewportSize({ width: 380, height: 900 });
        }
        await test('상태 필터(수집 실패)가 현재 상태·이력 모두에 적용', async () => {
            await choose('source', '');
            await choose('status', 'error');
            const { current, history: h } = await sections();
            assert.ok(current.includes('해구별 시정 예측') && current.includes('실시간 선박 교통'));
            for (const other of ['공식 선박사고 예보', '이안류', '행사'])
                assert.ok(!current.includes(other), '현재 상태에 ' + other + ' 가 남아 있음');
            assert.ok(!h.includes('자료 오래됨') && !h.includes('자료 없음'), '이력에 다른 상태가 남아 있음');
        });
        await test('원천+상태 함께: 조건에 맞는 것이 없으면 두 구역 모두 빈 안내', async () => {
            await choose('source', 'accident');
            const { current, history: h } = await sections();
            assert.ok(current.includes('조건에 맞는'), '현재 상태 빈 안내 없음');
            assert.ok(h.includes('기록된 이력이 없습니다'), '이력 빈 안내 없음');
        });
        await test('상태 선택지에 서버가 허용하는 상태(비운영 기간 포함)가 다 있음', async () => {
            const values = await page.locator('[data-risk-status] option').evaluateAll((os) => os.map((o) => o.value));
            for (const v of ['', 'error', 'stale', 'missing', 'ok', 'offseason']) assert.ok(values.includes(v), v + ' 없음');
            await choose('status', 'offseason');
            await choose('source', '');
            const { current } = await sections();
            assert.ok(current.includes('이안류') && !current.includes('해구별 시정 예측'));
        });
        await test('원천 선택지에 서버 원천 11개가 다 있음', async () => {
            const values = await page.locator('[data-risk-source] option').evaluateAll((os) => os.map((o) => o.value));
            for (const v of require('../services/risk_error_history').SOURCES) assert.ok(values.includes(v), v + ' 없음');
        });
        await test('상태 배지: 정상 초록·오래됨 노랑·실패 빨강·없음 회색', async () => {
            await choose('status', '');
            const colors = await page.evaluate(() => {
                const out = {};
                document.querySelectorAll('[data-risk-current] [data-risk-badge]').forEach((b) => {
                    out[b.dataset.riskBadge] = getComputedStyle(b).color;
                });
                return out;
            });
            const rgb = (s) => (s || '').match(/\d+/g).slice(0, 3).map(Number);
            const [er, eg] = rgb(colors.error), [sr, sg, sb] = rgb(colors.stale), [or, og] = rgb(colors.ok), [mr, mg, mb] = rgb(colors.missing);
            assert.ok(er > eg + 60, '수집 실패는 빨강 계열: ' + colors.error);
            assert.ok(sr > sb + 60 && sg > sb + 60, '자료 오래됨은 노랑 계열: ' + colors.stale);
            assert.ok(og > or + 60, '정상은 초록 계열: ' + colors.ok);
            assert.ok(Math.max(mr, mg, mb) - Math.min(mr, mg, mb) < 40, '자료 없음은 회색 계열: ' + colors.missing);
        });
        // 2026-10-15 사용자: 「우리 앱에 저장실패했다는 내용을 알려야하겠지? … 통합관리자 센터에서.」
        await test('일부 실패: 주황 배지·선택지·상태 필터가 현재 상태·이력에 적용·분류와 상세 줄', async () => {
            const color = await page.evaluate(() => {
                const b = document.querySelector('[data-risk-current] [data-risk-badge="partial"]');
                return b ? getComputedStyle(b).color : null;
            });
            assert.ok(color, '일부 실패 배지 없음');
            const [r, g, b] = color.match(/\d+/g).slice(0, 3).map(Number);
            assert.ok(r > g + 80 && g > b + 60, '일부 실패는 주황 계열(노랑·빨강과 구별): ' + color);
            const values = await page.locator('[data-risk-status] option').evaluateAll((os) => os.map((o) => o.value));
            assert.ok(values.includes('partial'), 'partial 선택지 없음');
            await choose('status', 'partial');
            const { current, history: h } = await sections();
            for (const t of ['행사', '2026-11', '일부 실패', 'Gemini 일부 실패', '경상남도(Gemini 호출 실패)'])
                assert.ok(current.includes(t), '현재 상태에 ' + t + ' 없음');
            for (const other of ['해구별 시정 예측', '2026-10', '이안류']) assert.ok(!current.includes(other), '현재 상태에 ' + other + ' 가 남아 있음');
            assert.ok(h.includes('문제 발생') && h.includes('일부 실패') && !h.includes('수집 실패'), '이력 필터');
            await choose('status', '');
        });
        await test('상세·분류·시각 줄 유지', async () => {
            const { current } = await sections();
            for (const t of ['상세', '연속 3회 확인 실패', '분류', 'invalid response', '마지막 정상 수집', '최신화 확인', 'KST'])
                assert.ok(current.includes(t), t + ' 없음');
        });
        await test('모바일 380px 에서 가로 넘침 없음', async () => {
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        });
        if (shots) await page.screenshot({ path: path.join(shots, 'mobile_380_after_filters.png'), fullPage: true });
    } finally {
        if (browser) await browser.close();
        if (server) await new Promise((resolve) => server.close(resolve));
        fs.rmSync(dir, { recursive: true, force: true });
        console.log(`${pass} PASS / ${fail} FAIL`);
        process.exit(fail ? 1 : 0);
    }
})();
