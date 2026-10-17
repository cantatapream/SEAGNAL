/**
 * ============================================================================
 * 파일명: local_server/scripts/test_station_briefing_ui.js
 * 역할  : 「활동지점 안전 브리핑」 2단계(화면)를 실제 Chromium 으로 index2.html 전체를 띄워 눌러 본다 —
 *         일반 기기(아코디언 없음 = 지금 화면) · 관리자 기기(아코디언·설정 흐름: 선택·건너뛰기·숨김·설정 팝업 재표시) ·
 *         본문 각 칸과 상태(해상만·자료 확인 불가·틀(AI 해설 없음)·브리핑 없음·다음 판 예정) · 「총평과 권고」 새 모양(결론·근거·권고·물때·AI 해설 — §11.10)과 옛 브리핑 문단 대체 · 서버 글은 textContent(HTML 문자열이 글자로) ·
 *         [위험예측에서 보기 ›] 로 위험예측 시트 열림 · N 뱃지 · [기준 상세] 창 · 관리자 「AI 브리핑」 탭(설정 저장·노출 범위 전환·지금 다시 만들기 409·미리보기·최근 3일 오류 목록 [복사]·[md로 저장]).
 *         380px·1280px 스크린샷을 SB_SHOT_DIR(없으면 임시 폴더)에 남긴다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 시험 대상     : client/js/forecast/station-briefing/*.js · client/js/admin/admin_station_briefing.js · admin.js(AI 하위 탭) · settings.js(설정 팝업 칸)
 *                    · marine-life/risk-forecast/risk_forecast.js(RiskForecast.openAt·goTo) · ocean-map/bottom-sheet/ocean_bottom_sheet3.js(OS.tideGaugeHtml)
 *  - 서버          : 실제 routes/station_briefing.js(createRouter) + 실제 services/station_briefing.js(createService — 임시 폴더, 실행만 가짜)
 *                    · 실제 routes/risk_forecast.js + 가짜 위험예측 저장소. 브리핑 본문은 실제 규칙(station_briefing_rules.buildBriefing)으로 만든다.
 *  - 나를 쓰는 곳  : scripts/refactor/verify_all.sh SUITES
 * [로드 순서] 독립 검사. 3001 서버·외부 호출·실제 AI·카카오 없음 — 자체 express(임의 포트), 127.0.0.1 밖 요청은 모두 끊는다.
 *             시각 고정: 서버 시계와 브라우저 시계(page.clock.setFixedTime) 모두 2026-10-17 10:05 KST(과거) — 실행 시각과 무관.
 * [실행] NODE_PATH=/opt/node-tools/node_modules:/home/user/SEAGNAL/local_server/node_modules node local_server/scripts/test_station_briefing_ui.js
 * ============================================================================
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), express = require('express'), { chromium } = require('playwright-core');
const root = path.join(__dirname, '../..'), R = require('../services/station_briefing_rules'), SB = require('../services/station_briefing'), { createRouter } = require('../routes/station_briefing');
const RF = require('../routes/risk_forecast'), M = require('../services/marine_fusion'), T = require('../services/risk_time'), io = require('../services/risk_collector_io');
const I = require('../services/station_briefing_inputs');
// (기상) 칸 입력(§11.10.1) — 단기 해상예보는 loadCoastalForecasts 꼴(시험값), 단기 전망은 사용자가 붙여 준 10-17 제주 통보문(고정 자료 그대로)
const REGIONAL = { coastal: { 제주도서부앞바다: { officeName: '제주지방기상청', publishTime: '10.17. 05:00', periods: [
    { date: '20261017', period: 'am', weather: '구름많음', waveHeight: '0.5~1.5', wind: '동~남동 / 7~11' }, { date: '20261017', period: 'pm', weather: '구름많음', waveHeight: '0.5~1.5', wind: '남동 / 7~11' }] } },
offices: { 184: { officeName: '제주지방기상청', bulletinPublishTime: '2026.10.17 04:40', summary: fs.readFileSync(path.join(__dirname, 'fixtures', 'station_briefing', 'jeju_bulletin_20261017.txt'), 'utf8') } }, zoneOffice: { 제주도서부앞바다: '184' } };
let pass = 0, fail = 0;
/** 사례 하나. 실패도 모두 찍고 끝에 요약. @param {string} name @param {function} fn [연계] ← 아래 시나리오 */
async function check(name, fn) { try { await fn(); console.log('✅', name); pass++; } catch (e) { console.error('❌', name, e && e.message); fail++; } }

const pad = (n) => String(n).padStart(2, '0'), at = (h, d = '2026-10-17') => `${d}T${pad(h)}:00:00+09:00`;
const clock = { now: Date.parse('2026-10-17T10:05:00+09:00') };
const HALLIM = '제주해양경찰서|한림파출소', AEWOL = '제주해양경찰서|애월파출소', MOKPO = '목포해양경찰서|남항파출소', BUSAN = '부산해양경찰서|남항파출소';
const XSS = '<img src=x onerror="window.__xss=1">';
const SHOT = process.env.SB_SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'sb-shot-'));
fs.mkdirSync(SHOT, { recursive: true });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ui-'));
const CELL = { id: 'GR4_F4K23_P4', lat: 33.5625, lon: 126.5375 };

/** 한림파출소 입력(가짜 숫자 — test_station_briefing.js 의 고정 자료와 같은 꼴, 첫 해역 칸만 위험예측 가짜 칸에 맞춤). @returns {Object} */
function hallimInput() {
    return {
        key: HALLIM, name: '한림파출소', office: '제주해양경찰서', region: '제주지방해양경찰청', seaOnly: false,
        location: { lat: 33.41, lon: 126.26, source: 'estimate', estimated: true }, sources: { accident: 'ok', congestion: 'ok', zoneForecasts: 'ok', warnings: 'ok' },
        sea: {
            reviewedCells: 52,
            regions: [
                { rid: 'A:1001', gridId: CELL.id, accidentGridId: '1001', lat: CELL.lat, lon: CELL.lon, haegu: { major: 232, sub: 2, label: '232-2' }, ref: { name: '화순항', distNm: 13.3, bearingWord: '북북서' }, zone: { name: '제주도서부앞바다', kind: 'main' }, zones: ['제주도서부앞바다'],
                    slots: { [at(15)]: { accident: '주의', congestion: { level: '높음', index: 12.3, at: at(15) } }, [at(18)]: { accident: '주의', congestion: null } }, history: { from: '2021-01-01', to: '2025-12-31', count: 18, topTypes: [{ type: '충돌', count: 7 }, { type: '침수', count: 5 }], death: 1, missing: 0 } },
                { rid: 'T:GR4_9', gridId: 'GR4_9', accidentGridId: null, lat: 33.48, lon: 126.33, haegu: { major: 232, sub: 3, label: '232-3' }, ref: { name: '제주', distNm: 7.0, bearingWord: '서' }, zone: { name: '제주도북부앞바다', kind: 'main' }, zones: ['제주도북부앞바다'],
                    slots: { [at(12)]: { accident: null, congestion: { level: '높음', index: 11, at: at(13) } } }, history: { count: 0 } },
            ],
            weather: { 232: { label: '대해구 232', rows: [[6, 0.8, 5], [9, 1.0, 6], [12, 1.4, 9], [15, 2.4, 13], [18, 2.6, 14], [21, 1.8, 10]].map(([h, wh, ws]) => ({ at: at(h), wh, ws })) } },
            warnings: [
                { zone: '제주도북부앞바다', kind: '앞바다', type: '풍랑', level: '주의보', state: '발효', effective: { start: '2026-10-16T21:00:00+09:00', end: '2026-10-16T21:00:00+09:00', range: false }, release: { start: at(6), end: at(9), range: true } },
                { zone: '제주도서부앞바다', kind: '앞바다', type: '풍랑', level: '주의보', state: '예비', effective: { start: at(21), end: '2026-10-18T00:00:00+09:00', range: true }, release: null },
            ],
        },
        places: [{ name: '비양도', lat: 33.4067, lon: 126.2275 }, { name: '협재해수욕장', lat: 33.394, lon: 126.239 }, { name: '한림항', lat: 33.414, lon: 126.264 }],
        land: {
            spots: [
                { id: '50110|협재해수욕장', name: '협재해수욕장', lat: 33.394, lon: 126.239, beach: true, index: 72, band: '높음', peakAt: at(15), people: { ratio: 1.8, score: 0.82 }, event: null, swell: null, rip: null, notices: { effective: [], prelim: [], windMs: 9 }, hazard: { count: 4, byType: [{ class: '사망사고 발생구역', count: 1 }, { class: '연안사고 위험구역', count: 3 }] }, history: { count: 6, from: '2020-01-01', to: '2024-12-31', topTypes: [{ type: '표류', count: 4 }] }, missing: [] },
                { id: '50110|한림항', name: '한림항', lat: 33.414, lon: 126.264, beach: false, index: 30, band: '다소 높음', peakAt: at(6), people: { ratio: 0.9, score: 0 }, event: null, swell: null, rip: null, notices: { effective: [], prelim: [], windMs: null }, hazard: { count: 3, byType: [{ class: '사망사고 발생구역', count: 3 }] }, history: { count: 2, from: '2020-01-01', to: '2024-12-31', topTypes: [{ type: '추락', count: 2 }] }, missing: [] },
            ],
            hazardOnly: [{ id: '한림-9', place: '한림항 방파제', class: '사망사고 발생구역', shape: '방파제', lat: 33.415, lon: 126.262 }],
        },
        tide: { anchorId: 'J7', distKm: 3.2, date: '2026-10-17', region: 'jeju', curve: [], peaks: [{ type: 'high', t: '00:50', cm: 210 }, { type: 'low', t: '06:12', cm: 20 }, { type: 'high', t: '12:30', cm: 200 }, { type: 'low', t: '18:40', cm: 25 }], prevPeak: { type: 'low', t: '18:20', cm: 22 }, nextPeak: { type: 'high', t: '00:55', cm: 205 }, rocks: { count: 1, first: '07:10', last: '18:40' } },
    };
}
const WIN = R.editionWindow('morning', Date.parse(at(8)));
/** 날짜 파일 하나를 쓴다(실제 서비스가 pick 으로 읽는다). @param {string} date @param {Object} stations [연계] ← 준비 */
function writeDay(date, stations) { fs.writeFileSync(path.join(dir, 'briefings_' + date + '.json'), JSON.stringify({ date, stations })); }
function makeBriefings() {
    const h = R.buildBriefing({ ...hallimInput(), zoneWeather: I.collectZoneWeather({ lat: 33.41, lon: 126.26 }, REGIONAL) }, WIN, { generatedAt: '2026-10-17T13:10:00+09:00' });
    h.trigger = { kind: 'warning', zones: ['제주도서부앞바다'] }; h.edition = 'warning';
    // AI 해설(1~2문장 — §11.10). 해상 해설에 HTML 문자열을 넣어 textContent 로만 들어가는지 본다.
    h.overview = { land: '협재해수욕장은 사람이 평소의 1.8배로 붐빕니다.', sea: XSS + ' 15시부터 파고가 높아집니다.', source: 'chatgpt', model: 'gpt-6-luna' };
    h.sea.cards[0].sentence = XSS + h.sea.cards[0].sentence;
    const busanIn = { ...hallimInput(), zoneWeather: null, key: BUSAN, name: '남항파출소', office: '부산해양경찰서', region: '남해지방해양경찰청', sources: { accident: 'ok', congestion: 'stale', zoneForecasts: 'stale', warnings: 'ok' }, tide: null,
        sea: { reviewedCells: 30, regions: [], weather: {}, warnings: [] }, land: { spots: [], hazardOnly: [{ id: '남항-1', place: '남항 물양장', class: '연안사고 위험구역', shape: '항포구' }] }, places: [] };
    const b = R.buildBriefing(busanIn, WIN, { generatedAt: at(8) }); b.trigger = { kind: 'morning' };
    const mokpoIn = { ...hallimInput(), key: MOKPO, name: '남항파출소', office: '목포해양경찰서', region: '서해지방해양경찰청', seaOnly: true, land: null, tide: null };
    const m = R.buildBriefing(mokpoIn, WIN, { generatedAt: at(8) }); m.trigger = { kind: 'morning' };
    return { h, b, m };
}

(async () => {
    let browser, server; const B = makeBriefings();
    try {
        writeDay('2026-10-17', { [HALLIM]: B.h, [BUSAN]: B.b, [MOKPO]: B.m });
        const stationsFx = [
            { key: HALLIM, name: '한림파출소', office: '제주해양경찰서', region: '제주지방해양경찰청', seaOnly: false, idx: 0 },
            { key: AEWOL, name: '애월파출소', office: '제주해양경찰서', region: '제주지방해양경찰청', seaOnly: false, idx: 1 },
            { key: BUSAN, name: '남항파출소', office: '부산해양경찰서', region: '남해지방해양경찰청', seaOnly: false, idx: 2 },
            { key: MOKPO, name: '남항파출소', office: '목포해양경찰서', region: '서해지방해양경찰청', seaOnly: true, idx: 3 },
        ];
        const real = SB.createService({ dir, clock: () => clock.now, loadStations: () => stationsFx });
        const ctl = { running: false, runs: 0 };
        const service = { ...real, run: async () => { ctl.runs++; return { ok: true }; }, status: () => ({ ...real.status(), running: ctl.running }) };
        const reqLog = [];
        const sbRouter = createRouter({ service, isAdminDevice: (id) => id === 'admin-push-token', verifyToken: (t) => t === 'admin-login',
            authorize: (req, res, next) => req.get('X-Admin-Token') === 'admin-login' ? next() : res.status(401).json({ ok: false, error: '관리자 인증 필요' }),
            nowLine: (key, r) => key === HALLIM && r.briefing ? { at: '2026-10-17T10:00:00+09:00', count: 37, gridCount: 12, busiest: null, text: '지금(10:00 기준) 관할 해역 선박 37척(교통 칸 12개)' } : null });

        // ── 위험예측 가짜 저장소(test_life_safety_tab_keep.js 와 같은 꼴) — 바로가기가 실제 위험예측 화면·시트를 연다 ──
        const geometry = { type: 'Polygon', coordinates: [[[126.525, 33.55], [126.55, 33.55], [126.55, 33.575], [126.525, 33.575], [126.525, 33.55]]] };
        const cell = { id: CELL.id, i: 0, lat: CELL.lat, lon: CELL.lon, geometry, haegu: { label: '232-2', major: 232, sub: 2 }, ref: { name: '화순항', bearingWord: '북북서', distNm: 13.3 } }, acc = { ...cell, id: '1001' };
        const at0 = T.isoKst(clock.now);
        io.write(path.join(dir, 'sea_realtime.json.gz'), { v: 'v1', cells: [cell], rows: [[0, 21, .2]], collectedAt: at0, sourceAt: null, source: 'MTIS realtime API' });
        const frames = {}; for (const t of T.timeline(clock.now, 3, 3, 21)) frames[t.slice(0, 13).replace(/[-T]/g, '') + '00'] = [[0, .002, '주의']];
        const inputs = { version: 1, cells: { cells: [cell] }, congestion: { frames: {} }, accident: { cells: [acc], frames }, sources: { accident: { status: 'ok' }, congestion: { status: 'ok' }, zoneForecasts: { status: 'ok' } }, weather: () => ({ wh: 2, ws: 12, wp: 4, wd: 241, forecastAt: at0 }) };
        const ring = (x, y) => [[x, y], [x + .01, y], [x + .01, y + .01], [x, y + .01], [x, y]];
        const spots = [{ id: '50110|협재해수욕장', i: 0, lat: 33.394, lon: 126.239, name: '협재해수욕장', cell: ring(126.234, 33.389) }];
        const store = { sources: () => inputs.sources, marineInputs: () => inputs,
            meta: () => { const a = { coast: T.timeline(clock.now, 3, 2, 21), sea: T.timeline(clock.now, 1, 2, 23) }; return { now: T.isoKst(clock.now), versions: { spots: 'v1', cells: 1, accident: 'v1' }, timeline: { sea: { times: a.sea }, accident: { times: a.coast }, coast: { times: a.coast } }, sources: inputs.sources }; },
            spots: () => ({ spots }), cells: () => ({ cells: [cell] }), accidentCells: () => ({ v: 'v1', cells: [acc] }), accidentFrame: () => ({ v: 'v1', cells: [[0, .001, '주의']] }),
            frame: (sea) => sea ? { cells: [[0, 0, 1, '낮음']], spots: [], borders: [] } : { spots: spots.map((s) => [s.i, 3]), borders: [] },
            coastDayFrame: () => ({ spots: spots.map((s) => [s.i, 3]), degraded: [] }),
            coastDayDetail: (id, t) => ({ title: '연안 ' + id, subtitle: { lat: 33.394, lon: 126.239 }, clickable: false, t }), islands: () => ({ features: [] }) };
        const marine = M.createStore({ risk: store, dir, clock: () => clock.now, stations: [{ properties: { name: '한림파출소' }, geometry }], accidents: [], describe: () => cell });

        const app = express();
        app.use((req, res, next) => { if (req.path.startsWith('/api/station-briefing') || req.path.startsWith('/api/admin/station-briefing')) reqLog.push({ path: req.path, q: req.query, dev: req.get('X-Admin-Device') || null, tok: req.get('X-Admin-Token') || null }); next(); });
        app.use(sbRouter);
        app.use(RF.createRouter({ store, marine }));
        app.get('/', (req, res) => res.sendFile(path.join(root, 'client/index2.html')));
        app.use(express.static(path.join(root, 'client')));
        app.use('/api', (req, res) => res.status(404).json({ ok: false }));
        server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r)); const base = 'http://127.0.0.1:' + server.address().port;

        // ── 서버 경로(브라우저 없이) — 관리자 미리보기 경로는 노출 범위와 무관, 토큰 없으면 401 ──
        const http = async (p, init) => { const r = await fetch(base + p, init); return { status: r.status, body: await r.json().catch(() => null) }; };
        await check('서버: 일반 요청은 display:false·빈 목록 · 관리자 기기(쿼리 adminToken)·관리자 토큰은 display:true', async () => {
            let r = await http('/api/station-briefing/stations'); assert.deepEqual([r.status, r.body.display, r.body.stations.length, r.body.audience], [200, false, 0, 'admin']);
            r = await http('/api/station-briefing/stations?adminToken=admin-push-token'); assert.deepEqual([r.body.display, r.body.stations.length], [true, 4]);
            r = await http('/api/station-briefing/stations', { headers: { 'X-Admin-Token': 'admin-login' } }); assert.equal(r.body.display, true);
            r = await http('/api/station-briefing?station=' + encodeURIComponent(HALLIM)); assert.deepEqual([r.body.display, r.body.briefing], [false, null]);
        });
        await check('서버: 관리자 /stations·/preview — 토큰 없으면 401, 노출 「노출 안 함」이어도 관리자는 미리보기', async () => {
            assert.equal((await http('/api/admin/station-briefing/preview?station=' + encodeURIComponent(HALLIM))).status, 401);
            real.writeConfig({ exposure: 'off' });
            const hd = { headers: { 'X-Admin-Token': 'admin-login' } };
            const st = await http('/api/admin/station-briefing/stations', hd); assert.deepEqual([st.status, st.body.stations.length], [200, 4]);
            const pv = await http('/api/admin/station-briefing/preview?station=' + encodeURIComponent(HALLIM), hd); assert.deepEqual([pv.status, pv.body.briefing.key], [200, HALLIM]);
            assert.equal((await http('/api/admin/station-briefing/preview?station=없는곳', hd)).status, 404);
            assert.equal((await http('/api/admin/station-briefing/preview', hd)).status, 400);
            assert.equal((await http('/api/station-briefing/stations', { headers: { 'X-Admin-Token': 'admin-login' } })).body.display, false, '공개 경로는 노출 판정 그대로(off)');
            real.writeConfig({ exposure: 'admin' });
        });

        browser = await chromium.launch({ ...((process.env.PW_CHROME || process.env.SIM_CHROMIUM || process.env.CHROMIUM_EXECUTABLE) ? { executablePath: process.env.PW_CHROME || process.env.SIM_CHROMIUM || process.env.CHROMIUM_EXECUTABLE } : {}), headless: true, args: ['--no-sandbox'] });
        const errors = [];
        /** 이 시험이 주지 않는 자료(/api/weather-alerts 등) 때문에 뜨는 연결 끊김 팝업·스플래시를 치운다 — 스크린샷에 브리핑만 보이게. */
        const clean = (page) => page.evaluate(() => ['server-maintenance-popup', 'network-error-popup', 'splash-screen', 'main-notice-popup'].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); }));
        /** 새 기기(새 브라우저 문맥 — 저장소 비어 있음). admin 이면 관리자 모드 + 푸시 토큰(관리자 기기). @returns {Promise<Page>} */
        const device = async ({ admin = false, width = 412, height = 915, login = false } = {}) => {
            const ctx = await browser.newContext({ viewport: { width, height }, timezoneId: 'Asia/Seoul' }), page = await ctx.newPage();
            page.on('pageerror', (e) => errors.push(e.message));
            await page.route('**/*', (r) => r.request().url().startsWith(base) ? r.continue() : r.abort());
            await page.clock.setFixedTime(new Date(clock.now));
            await page.addInitScript(({ admin, login }) => { try { if (!sessionStorage.getItem('__sb_init')) { sessionStorage.setItem('__sb_init', '1'); if (admin) { localStorage.setItem('seagnal_admin_mode', 'true'); localStorage.setItem('push_token', 'admin-push-token'); } if (login) localStorage.setItem('seagnal_admin_token', 'admin-login'); } } catch (e) { /* 저장소 없음 */ } }, { admin, login });
            await page.goto(base + '/'); await page.waitForFunction(() => window.StationBriefing && typeof window.switchMainTab === 'function'); await page.waitForTimeout(900);
            await clean(page);
            return page;
        };
        /** 요소를 눌러 본다 — 화면 위 안내 팝업(점검·스플래시 등 이 시험이 띄우지 않는 덮개)에 가려지지 않게 DOM click(test_life_safety_tab_keep 과 같은 방식). */
        const tap = async (page, sel) => { await page.waitForSelector(sel); await page.evaluate((sel) => document.querySelector(sel).click(), sel); };
        const vis = (page, id) => page.evaluate((id) => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none' && !e.hidden; }, id);
        const content = (page) => page.evaluate(() => document.getElementById('station-briefing-content').innerText);
        const openAcc = async (page) => { await page.evaluate(() => { const b = document.getElementById('station-briefing-accordion-body'); if (b.classList.contains('collapsed')) window.toggleStationBriefingAccordion(); }); await page.waitForTimeout(400); };
        const pickStation = async (page, key, opts = {}) => {
            await page.evaluate(() => window.openStationBriefingSetup()); await page.waitForSelector('[data-sb-setup]');
            await page.evaluate((key) => document.querySelector('.sb-station-btn[data-key="' + key + '"]').click(), key);
            if (opts.sea === false) await page.evaluate(() => { const c = document.querySelector('[data-sb-show="showSea"]'); c.checked = false; c.dispatchEvent(new Event('change')); });
            if (opts.land === false) await page.evaluate(() => { const c = document.querySelector('[data-sb-show="showLand"]'); c.checked = false; c.dispatchEvent(new Event('change')); });
            await page.evaluate(() => document.querySelector('[data-sb-save]').click());
        };

        // ── 1. 일반 기기 ──
        const logFrom = reqLog.length; let page = await device();
        await check('일반 기기 — 아코디언·⚙·설정 팝업 칸이 없다(지금 화면과 같음), 관리자 정보도 보내지 않는다', async () => {
            assert.equal(await vis(page, 'station-briefing-accordion-header'), false); assert.equal(await vis(page, 'station-briefing-accordion-body'), false);
            const mine = reqLog.slice(logFrom), last = mine.filter((r) => r.path === '/api/station-briefing/stations').pop(); assert.ok(last, '노출 판정을 물었다'); assert.equal(last.q.adminToken, undefined); assert.equal(last.tok, null);
            assert.equal(mine.some((r) => r.path === '/api/station-briefing'), false, '브리핑 본문은 묻지 않는다');
            await page.evaluate(() => window.openSettingsModal()); await page.waitForTimeout(400);
            assert.equal(await vis(page, 'station-briefing-settings'), false, '설정 팝업에도 칸이 없다');
            const order = await page.evaluate(() => [...document.querySelectorAll('#weather-alert-section > .main-accordion-header')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.id));
            assert.ok(!order.includes('station-briefing-accordion-header'));
        });
        await clean(page); await page.screenshot({ path: path.join(SHOT, 'general_412.png') });
        await page.context().close();

        // ── 2. 관리자 기기 — 설정 흐름 ──
        page = await device({ admin: true });
        await check('관리자 기기 — 「기상청 해상 기상 전망」 바로 아래 아코디언, 설정 전 안내 + [설정하기], ⚙ 숨김', async () => {
            assert.equal(await vis(page, 'station-briefing-accordion-header'), true);
            const prev = await page.evaluate(() => document.getElementById('station-briefing-accordion-header').previousElementSibling.id); assert.equal(prev, 'marine-forecast-accordion-body');
            const last = reqLog.filter((r) => r.path === '/api/station-briefing/stations').pop(); assert.equal(last.q.adminToken, 'admin-push-token', '특보 예측과 같은 adminToken 쿼리');
            assert.equal(await vis(page, 'station-briefing-settings-btn'), false);
            await openAcc(page); const t = await content(page); assert.ok(t.includes('활동지점이 설정되지 않았습니다'), t); assert.ok(await page.$('#station-briefing-setup-btn'));
        });
        await check('설정 → 관할 목록이 경찰서별 묶음, 남항 두 곳은 경찰서로 구분, 해상만 표시 · 이름으로 찾기', async () => {
            await tap(page, '#station-briefing-setup-btn'); await page.waitForSelector('[data-sb-setup]');
            const offices = await page.$$eval('.sb-office', (e) => e.map((x) => x.textContent)); assert.deepEqual(offices, ['제주해양경찰서', '부산해양경찰서', '목포해양경찰서']);
            const namhang = await page.$$eval('.sb-station-btn', (e) => e.filter((x) => x.textContent.startsWith('남항파출소')).map((x) => x.dataset.key)); assert.deepEqual(namhang.sort(), [BUSAN, MOKPO].sort());
            assert.ok((await page.$eval('.sb-station-btn[data-key="' + MOKPO + '"]', (e) => e.textContent)).includes('해상만'));
            await page.fill('.sb-search', '애월'); assert.deepEqual(await page.$$eval('.sb-station-btn', (e) => e.map((x) => x.dataset.key)), [AEWOL]); await page.fill('.sb-search', '');
        });
        await page.setViewportSize({ width: 380, height: 844 }); await clean(page); await page.screenshot({ path: path.join(SHOT, 'setup_380.png'), fullPage: false });
        await page.evaluate(() => document.getElementById('station-briefing-accordion-header').scrollIntoView()); await clean(page); await page.screenshot({ path: path.join(SHOT, 'setup_380.png') });
        await page.setViewportSize({ width: 412, height: 915 });
        await check('건너뛰기 → 「더 이상 표시하지 않을까요?」 → 아니요 → 설정 전 안내로', async () => {
            await tap(page, '[data-sb-skip]'); await page.waitForSelector('[data-sb-confirm]');
            assert.ok((await content(page)).includes('이 아코디언을 더 이상 표시하지 않을까요?'));
            await tap(page, '[data-sb-hide-no]'); assert.ok((await content(page)).includes('활동지점이 설정되지 않았습니다'));
            assert.equal(await vis(page, 'station-briefing-accordion-header'), true);
        });
        await check('관할을 골랐어도 해상·육상 둘 다 끄면 = 둘 다 건너뛴 것 → 묻기 → 예 → 숨김 + 「오른쪽 위 설정 버튼」 안내', async () => {
            await pickStation(page, HALLIM, { sea: false, land: false }); await page.waitForSelector('[data-sb-confirm]');
            await tap(page, '[data-sb-hide-yes]'); await page.waitForTimeout(300);
            assert.equal(await vis(page, 'station-briefing-accordion-header'), false); assert.equal(await vis(page, 'station-briefing-accordion-body'), false);
            const modal = await page.evaluate(() => (document.getElementById('seagnal-custom-modal') || {}).innerText || ''); assert.ok(modal.includes('오른쪽 위 설정') && modal.includes('다시 표시'), modal);
            const p = await page.evaluate(() => JSON.parse(localStorage.getItem('seagnal_station_briefing_v1'))); assert.deepEqual([p.hidden, p.station], [true, null]);
            await page.evaluate(() => window.closeSeagnalModal && window.closeSeagnalModal());
        });
        await check('설정 팝업(오른쪽 위 ⚙) — 「활동지점 안전 브리핑」 칸이 보이고 스위치를 켜면 아코디언이 다시 보인다', async () => {
            await page.evaluate(() => window.openSettingsModal()); await page.waitForTimeout(500);
            assert.equal(await vis(page, 'station-briefing-settings'), true);
            const txt = await page.$eval('#station-briefing-settings', (e) => e.innerText); assert.ok(txt.includes('관리자 기기에만') && txt.includes('설정되지 않음'), txt);
            assert.equal(await page.$eval('#opt-station-briefing-show', (e) => e.checked), false);
            await page.evaluate(() => document.getElementById('opt-station-briefing-show').click()); await page.waitForTimeout(200);
            assert.equal(await vis(page, 'station-briefing-accordion-header'), true);
        });
        await clean(page); await page.screenshot({ path: path.join(SHOT, 'settings_popup_412.png') });
        await check('설정 팝업 [관할 설정] → 팝업 닫고 아코디언 펼쳐 관할 고르기 → 한림 저장 → 브리핑·⚙', async () => {
            await tap(page, '#station-briefing-settings-edit'); await page.waitForSelector('[data-sb-setup]');
            assert.equal(await page.evaluate(() => document.getElementById('settings-modal').classList.contains('hidden')), true);
            await page.evaluate((k) => document.querySelector('.sb-station-btn[data-key="' + k + '"]').click(), HALLIM); await tap(page, '[data-sb-save]');
            await page.waitForSelector('[data-sb-sec="overview"]'); assert.equal(await vis(page, 'station-briefing-settings-btn'), true);
            const p = await page.evaluate(() => JSON.parse(localStorage.getItem('seagnal_station_briefing_v1'))); assert.deepEqual([p.station, p.showSea, p.showLand, p.hidden], [HALLIM, true, true, false]);
        });

        // ── 3. 본문 ──
        await check('본문 — 총평(육상·해상마다 단계·결론·(근거)·(권고)·(물때)·AI 해설 · 지금 밀집 · 「근거 ▸」 접힘 없음) · 특별 상황 · 해상 시간 막대(⚑) · 해역 카드 · 육상 카드 · 상시 위험 장소 · 조석 게이지 · 기준 시각·참고 정보', async () => {
            const s = await page.evaluate(() => {
                const q = (s) => document.querySelector('#station-briefing-content ' + s), qa = (s) => [...document.querySelectorAll('#station-briefing-content ' + s)];
                const blk = (k) => { const e = q('[data-sb-summary="' + k + '"]'); return e ? { text: e.textContent, ks: [...e.querySelectorAll('.sb-sum-k')].map((x) => x.textContent.trim()), basis: [...e.querySelectorAll('.sb-sum-basis li')].map((x) => x.textContent), advice: (e.querySelector('.sb-sum-advice') || {}).textContent } : null; };
                const con = [...document.querySelectorAll('#station-briefing-content .sb-conclusion')].map((e) => ({ chip: e.querySelector('.sb-chip').textContent, head: e.querySelector('.sb-headline').textContent, w: getComputedStyle(e.querySelector('.sb-headline')).fontWeight }));
                const wx = q('[data-sb-part="weather"]');
                return { secs: qa('[data-sb-sec]').map((e) => e.dataset.sbSec), land: blk('land'), sea: blk('sea'), parts: qa('[data-sb-part]').map((e) => e.dataset.sbPart), con, oldPara: qa('[data-sb-overview]').length,
                    wx: { title: wx.querySelector('.sb-sum-k').textContent, rows: [...wx.querySelectorAll('.sb-wx-rows li')].map((x) => x.textContent), notes: [...wx.querySelectorAll('.sb-wx-notes li')].map((x) => x.textContent), text: wx.textContent },
                    tideLines: qa('[data-sb-part="tide"] .sb-sum-tide').map((x) => x.textContent), cms: qa('[data-sb-commentary]').map((x) => x.textContent),
                    now: (q('.sb-now') || {}).textContent || '', basis: !!q('details.sb-basis'), source: (q('[data-sb-source]') || {}).dataset ? q('[data-sb-source]').dataset.sbSource : null,
                    special: qa('.sb-special-title').map((e) => e.textContent), slots: qa('.sb-slot').length, flags: qa('.sb-slot[data-event]').length, seaCards: qa('[data-sb-card="sea"]').length,
                    landCards: qa('[data-sb-card="land"]').length, links: qa('.sb-link').length, constant: (q('details.sb-constant summary') || {}).textContent || '',
                    gauge: !!q('.sb-tide .ocean-tide-progress-track'), peaks: qa('.sb-tide .ocean-tide-peak-row').length, tideText: qa('.sb-tide-text').map((e) => e.textContent),
                    foot: (q('.sb-foot') || {}).textContent || '', edition: (q('.sb-edition') || {}).textContent || '' };
            });
            assert.deepEqual(s.secs, ['overview', 'special', 'sea', 'land', 'tide']);
            // §11.10.1 순서: 결론 → (기상) → (물때) → 육상 근거·권고 → 해상 근거·권고 → AI 해설
            assert.deepEqual(s.parts, ['conclusion', 'weather', 'tide', 'land', 'sea', 'commentary']); assert.equal(s.oldPara, 0, '새 브리핑은 옛 문단을 그리지 않음');
            assert.deepEqual(s.con.map((x) => x.chip + '|' + x.head), ['주의 필요|' + B.h.summary.land.headline, '주의 필요|오늘 한림파출소 관할 해상의 단계는 "주의 필요"입니다.']); assert.ok(s.con.every((x) => Number(x.w) >= 700), '결론은 굵게');
            assert.equal(s.wx.title, '(기상) 제주도서부앞바다');
            assert.deepEqual(s.wx.rows, ['오늘 오전 구름많음 · 파고 0.5~1.5m · 풍속 7~11m/s · 풍향 동→남동', '오늘 오후 구름많음 · 파고 0.5~1.5m · 풍속 7~11m/s · 풍향 남동']);
            assert.deepEqual(s.wx.notes, ['오늘 오후부터 순간풍속 15m/s 안팎의 강한 바람', '풍랑 예비특보: 오늘 밤(18~24시) 제주도남쪽바깥먼바다', '오늘 밤부터 제주도남쪽바깥먼바다 물결 1.5~3.0m로 높아짐']);
            assert.ok(s.wx.text.includes('제주지방기상청 단기 해상예보 (10.17 05:00 발표)') && s.wx.text.includes('(특이사항)') && s.wx.text.includes('제주지방기상청 단기 전망 (10.17 04:40 발표)'), s.wx.text);
            assert.deepEqual(s.tideLines, B.h.tide.text, '물때는 공용 칸');
            assert.deepEqual(s.land.ks, ['(근거)', '(권고)'], '육상 덩어리에 물때 없음'); assert.deepEqual(s.land.basis, B.h.summary.land.basis); assert.equal(s.land.advice, '(권고) ' + B.h.summary.land.advice);
            assert.ok(s.land.basis.some((x) => x.includes('방문객 평소의 1.8배(예상)')), '예상 표기 — ' + s.land.basis.join(' / '));
            assert.deepEqual(s.sea.ks, ['(근거)', '(권고)']); assert.deepEqual(s.sea.basis, B.h.summary.sea.basis);
            assert.ok(s.cms[0].startsWith('해설 · ChatGPT · 육상') && s.cms[0].includes('1.8배') && s.cms[1].startsWith('해설 · ChatGPT · 해상'), s.cms.join(' / '));
            assert.ok(s.now.includes('37척')); assert.ok(!s.basis, '「근거 ▸」 접힘은 없앰(근거 목록이 늘 보임)'); assert.equal(s.source, 'chatgpt');
            assert.ok(s.special.some((t) => t.includes('해제 예고')) && s.special.some((t) => t.includes('예비특보')), s.special.join('|'));
            assert.equal(s.slots, B.h.sea.timeBar.length); assert.equal(s.flags, B.h.sea.timeBar.filter((x) => x.events.length).length); assert.ok(s.flags >= 1);
            assert.equal(s.seaCards, B.h.sea.cards.length); assert.equal(s.landCards, B.h.land.cards.length); assert.equal(s.links, s.seaCards + s.landCards);
            assert.ok(s.constant.startsWith('상시 위험 장소'));
            assert.ok(s.gauge, '오늘 판이라 해양종합정보와 같은 진행 게이지'); assert.equal(s.peaks, 4); assert.ok(s.tideText[0].includes('저조 뒤부터 물이 차오릅니다'), s.tideText[0]);
            assert.ok(s.foot.includes('참고 정보이며 안전을 보장하지 않습니다') && s.foot.includes('기준 시각 10월 17일(토) 13:10'), s.foot);
            assert.ok(s.edition.includes('특보 변경 판'), s.edition);
        });
        await check('서버 글은 textContent — HTML 문자열이 글자로 보이고 img 가 생기지 않는다', async () => {
            const r = await page.evaluate(() => ({ imgs: document.querySelectorAll('#station-briefing-content img').length, xss: window.__xss || null, sea: document.querySelector('[data-sb-commentary="sea"]').textContent, card: document.querySelector('[data-sb-card="sea"] .sb-sentence').textContent }));
            assert.equal(r.imgs, 0); assert.equal(r.xss, null); assert.ok(r.sea.includes('<img src=x onerror=')); assert.ok(r.card.startsWith('<img'));
        });
        await check('시간 막대 칸 색 = 위험예측 4색(단계 순위), 칸을 누르면 설명 줄', async () => {
            const r = await page.evaluate(() => { const bs = [...document.querySelectorAll('.sb-slot')]; return bs.map((b) => [b.dataset.rank, getComputedStyle(b).backgroundColor]); });
            const want = { 0: 'rgb(47, 179, 107)', 1: 'rgb(242, 194, 48)', 2: 'rgb(251, 146, 60)', 3: 'rgb(224, 50, 44)' };
            r.forEach(([rank, bg]) => assert.equal(bg, want[rank], rank + ' 칸 색'));
            await page.evaluate(() => document.querySelectorAll('.sb-slot')[3].click());
            const d = await page.$eval('.sb-slot-detail', (e) => e.textContent); assert.ok(d.startsWith(B.h.sea.timeBar[3].label), d);
        });
        await openAcc(page); await page.evaluate(() => document.getElementById('station-briefing-accordion-header').scrollIntoView());
        for (const [w, h] of [[380, 844], [1280, 900]]) { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(250); await clean(page); await page.screenshot({ path: path.join(SHOT, 'briefing_top_' + w + '.png') }); await page.locator('#station-briefing-content').screenshot({ path: path.join(SHOT, 'briefing_' + w + '.png') }); }
        await page.setViewportSize({ width: 380, height: 844 });
        await check('380px 에서 가로로 넘치지 않는다(본문 폭 ≤ 화면 폭)', async () => {
            const r = await page.evaluate(() => ({ sw: document.getElementById('station-briefing-content').scrollWidth, cw: document.getElementById('station-briefing-content').clientWidth, doc: document.documentElement.scrollWidth, vw: innerWidth }));
            assert.ok(r.sw <= r.cw + 1, JSON.stringify(r)); assert.ok(r.doc <= r.vw + 1, JSON.stringify(r));
        });
        await check('[기준 상세] — 위험예측과 같은 창(고정 머리·표 가로 스크롤), 제목 「활동지점 안전 브리핑」·주요 규칙 문구', async () => {
            await tap(page, '#station-briefing-content .sb-basis-btn'); await page.waitForSelector('.rf-modal .rf-basis');
            const r = await page.evaluate(() => ({ title: document.querySelector('.rf-basis-head h3').textContent, body: document.querySelector('.rf-basis-body').innerText, tbl: document.querySelectorAll('.rf-basis-body .rf-tbl').length, close: !!document.querySelector('.rf-basis-head .mclose') }));
            assert.equal(r.title, '활동지점 안전 브리핑'); assert.ok(r.close); assert.equal(r.tbl, 3);
            for (const k of ['08:00 · 17:30 · 23:00', '21시가 넘으면 다음 날', '오늘 밤~내일', '공단 안내로는 경계 상위 5%·주의 상위 5~15% 구간', '만드는 시각이 든 3시간 칸부터', '기상청 해제 시각', '해제 예고로만', '사고 확률이 아닙니다', '단계 높은 순 10곳까지', '최대 12곳', '이안류를 관측하는 해수욕장만', '8m/s 이상', '다음 정시 판에 반영', '최대 20분', '조석 칸이 없습니다', '「확인 불가」(회색)', '1.2~1.3배', '저조 뒤부터 물이 차오릅니다', '틀 문장', '참고 정보이며 안전을 보장하지 않습니다']) assert.ok(r.body.includes(k), k);
        });
        await clean(page); await page.screenshot({ path: path.join(SHOT, 'basis_380.png') });
        await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(200); await clean(page); await page.screenshot({ path: path.join(SHOT, 'basis_1280.png') });
        await page.keyboard.press('Escape'); await page.setViewportSize({ width: 412, height: 915 });

        // ── 4. N 뱃지 ──
        await check('N 뱃지 — 특보 변경 판을 아직 펼쳐 보지 않았으면 머리에 .new-badge, 펼치면 사라지고 다시 켜도 없다(기기 저장)', async () => {
            await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('seagnal_station_briefing_v1')); p.seen = {}; localStorage.setItem('seagnal_station_briefing_v1', JSON.stringify(p)); });
            await page.reload(); await page.waitForFunction(() => window.StationBriefing); await page.waitForSelector('#station-briefing-badge-slot .new-badge', { timeout: 5000 });
            assert.equal(await page.$eval('#station-briefing-badge-slot .new-badge', (e) => e.textContent), 'N');
            await tap(page, '#station-briefing-accordion-header'); await page.waitForTimeout(300);
            assert.equal(await page.$('#station-briefing-badge-slot .new-badge'), null);
            await page.reload(); await page.waitForFunction(() => window.StationBriefing); await page.waitForTimeout(900);
            assert.equal(await page.$('#station-briefing-badge-slot .new-badge'), null);
        });

        // ── 5. 바로가기 ──
        await check('[위험예측에서 보기 ›](육상 카드) → 해양안전생활 > 해양안전 · 위험예측 켜짐 · 그 관광지 시트', async () => {
            await openAcc(page);
            await page.evaluate(() => document.querySelector('[data-sb-card="land"] .sb-link').click());
            await page.waitForFunction(() => { const a = window._riskForecastApp; return a && a.getState().selected && a.getState().selected.id === '50110|협재해수욕장'; }, null, { timeout: 15000 });
            await page.waitForFunction(() => document.getElementById('risk-forecast-sheet').classList.contains('open'), null, { timeout: 5000 });
            const s = await page.evaluate(() => ({ tab: document.body.getAttribute('data-active-tab'), safety: document.body.classList.contains('ls-safety'), btn: document.getElementById('ocean-risk-forecast-toggle-btn').classList.contains('active'), locked: document.getElementById('ocean-risk-forecast-toggle-btn').classList.contains('rf-preview-locked'), st: window._riskForecastApp.getState() }));
            assert.deepEqual([s.tab, s.safety, s.btn, s.locked, s.st.enabled, s.st.coast, s.st.selected.kind], ['ocean-life-group', true, true, false, true, true, 'coast']);
        });
        await check('[위험예측에서 보기 ›](해역 카드) → 해상 층 켜짐 · 그 칸(GR4 id·좌표) · 그 시각(15시) 시트', async () => {
            await page.evaluate(() => window.switchMainTab('weather-group')); await page.waitForTimeout(500); await openAcc(page);
            await page.evaluate(() => document.querySelector('[data-sb-card="sea"] .sb-link').click());
            await page.waitForFunction((id) => { const a = window._riskForecastApp; const s = a && a.getState(); return s && s.enabled && s.sea && s.selected && s.selected.id === id; }, CELL.id, { timeout: 15000 });
            await page.waitForFunction(() => document.getElementById('risk-forecast-sheet').classList.contains('open'), null, { timeout: 5000 });
            const s = await page.evaluate(() => window._riskForecastApp.getState());
            assert.deepEqual([s.selected.kind, s.selected.location, s.t], ['marine', { lon: CELL.lon, lat: CELL.lat }, at(15)]);
        });
        await clean(page); await page.screenshot({ path: path.join(SHOT, 'shortcut_sea_412.png') });
        await page.context().close();

        // ── 6. 상태들 ──
        page = await device({ admin: true });
        await check('해상만 관할(목포 남항) — 육상 보기 칸이 꺼지고 이유 표시, 본문은 해상만(육상 칸 대신 이유 한 줄)', async () => {
            await page.evaluate(() => window.openStationBriefingSetup()); await page.waitForSelector('[data-sb-setup]');
            await page.evaluate((k) => document.querySelector('.sb-station-btn[data-key="' + k + '"]').click(), MOKPO);
            const r = await page.evaluate(() => ({ dis: document.querySelector('[data-sb-show="showLand"]').disabled, on: document.querySelector('[data-sb-show="showLand"]').checked, note: document.querySelector('.sb-toggles .sb-small').textContent }));
            assert.deepEqual([r.dis, r.on], [true, false]); assert.ok(r.note.includes('해상 브리핑만'));
            await tap(page, '[data-sb-save]'); await page.waitForSelector('[data-sb-sec="overview"]');
            const t = await page.evaluate(() => ({ land: !!document.querySelector('[data-sb-summary="land"]'), sec: [...document.querySelectorAll('[data-sb-sec]')].map((e) => e.dataset.sbSec), landSec: (document.querySelector('[data-sb-sec="land"]') || {}).innerText || '' }));
            assert.equal(t.land, false); assert.ok(t.sec.includes('sea')); assert.ok(t.landSec.includes('해상만'), t.landSec);
        });
        await check('자료 확인 불가(부산 남항) — 해상 단계 「확인 불가(일부)」(회색)·빠진 자료 이름 · 틀이면 「AI 해설 없음」 작게 표시 · 해설 칸 없음', async () => {
            await pickStation(page, BUSAN); await page.waitForSelector('[data-sb-sec="sea"]');
            const r = await page.evaluate(() => { const c = document.querySelector('[data-sb-sec="sea"] .sb-sec-head .sb-chip'); return { word: c.textContent, bg: getComputedStyle(c).backgroundColor, miss: document.querySelector('[data-sb-sec="sea"] .sb-miss').textContent, src: document.querySelector('[data-sb-source]').dataset.sbSource, srcText: document.querySelector('[data-sb-source]').textContent, fs: parseFloat(getComputedStyle(document.querySelector('[data-sb-source]')).fontSize), body: parseFloat(getComputedStyle(document.querySelector('[data-sb-part="conclusion"] .sb-headline')).fontSize), wxMiss: (document.querySelector('[data-sb-wx-missing]') || {}).textContent || null, cm: document.querySelectorAll('[data-sb-commentary]').length, basis: [...document.querySelectorAll('[data-sb-summary="sea"] .sb-sum-basis li')].map((x) => x.textContent) }; });
            assert.equal(r.word, '확인 불가(일부)'); assert.equal(r.bg, 'rgb(100, 116, 139)'); assert.ok(r.miss.includes('혼잡 예보') && r.miss.includes('해구 예보'), r.miss);
            assert.equal(r.src, 'template'); assert.equal(r.srcText, 'AI 해설 없음 — 결론·기상·근거·권고는 서버가 모은·계산한 값입니다.');
            assert.equal(r.wxMiss, '기상예보 자료를 확인하지 못했습니다.', '기상 자료가 없으면 지어내지 않고 밝힘'); assert.ok(r.fs < r.body, '작은 글씨'); assert.equal(r.cm, 0, '해설 칸 없음');
            assert.ok(r.basis.some((x) => x.startsWith('확인하지 못한 자료: 혼잡 예보·해구 예보')), r.basis.join(' / '));
        });
        await check('육상 끄기 — 해상만 보이게 저장하면 육상 문단·육상 분석 칸이 없다', async () => {
            await pickStation(page, HALLIM, { land: false }); await page.waitForSelector('[data-sb-sec="overview"]');
            const r = await page.evaluate(() => ({ sec: [...document.querySelectorAll('[data-sb-sec]')].map((e) => e.dataset.sbSec), land: !!document.querySelector('[data-sb-summary="land"]') }));
            assert.deepEqual([r.sec.includes('land'), r.land, r.sec.includes('sea')], [false, false, true]);
        });
        await check('브리핑 없음 — 「아직 이 관할의 브리핑이 없습니다」 + 정시 안내', async () => {
            await pickStation(page, AEWOL); await page.waitForFunction(() => document.getElementById('station-briefing-content').innerText.includes('아직 이 관할의 브리핑이 없습니다'));
            assert.ok((await content(page)).includes('08:00 · 17:30 · 23:00'));
        });
        await check('21시 넘음 — 내일 판이 없으면 다음 예정 시각(nextExpectedAt) 안내 · 오늘 판이 있으면 오늘 판 + 「내일 브리핑이 아직 없어」', async () => {
            clock.now = Date.parse('2026-10-17T21:30:00+09:00');
            await page.evaluate(() => window.StationBriefing.load()); await page.waitForFunction(() => document.getElementById('station-briefing-content').innerText.includes('다음 브리핑 예정'));
            assert.ok((await content(page)).includes('다음 브리핑 예정: 10월 17일(토) 23:00'));
            await pickStation(page, HALLIM); await page.waitForSelector('[data-sb-sec="overview"]');
            const t = await content(page); assert.ok(t.includes('10월 18일(일) 브리핑(23:00 생성)이 아직 없어 10월 17일(토) 브리핑을 보여 드립니다'), t);
            clock.now = Date.parse('2026-10-17T10:05:00+09:00');
        });
        await page.context().close();

        // ── 7. 관리자 「AI 브리핑」 탭 ──
        // 오류 목록(§11.10 — 최근 3일 전부): 10-14(3일 전) 1건은 보이지 않고, 나머지 3건(이유에 「|」·줄바꿈 포함)이 최근 것부터.
        const ERRS = [{ at: '2026-10-14T23:00:00+09:00', stage: 'call', provider: 'vm', stations: [], reason: '오래된 오류' },
            { at: '2026-10-15T08:01:00+09:00', stage: 'validate', provider: 'chatgpt', stations: [HALLIM], reason: 'place:제주도', edition: 'morning', date: '2026-10-15' },
            { at: '2026-10-16T17:31:00+09:00', stage: 'call', provider: 'vm', stations: [HALLIM, AEWOL, BUSAN, MOKPO], reason: 'VM 작업자 연결 없음', edition: 'evening', date: '2026-10-16' },
            { at: '2026-10-17T08:02:00+09:00', stage: 'validate', provider: 'gemini', stations: [AEWOL], reason: 'number:hangul:두 곳|x\n둘째 줄', edition: 'morning', date: '2026-10-17' }];
        fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ errors: ERRS }));
        page = await device({ admin: true, login: true });
        await check('관리자 → AI → 「AI 브리핑」 하위 탭 — 설정 칸(방식·모델·노출·묶음·바뀐 곳만)·상태·미리보기', async () => {
            await page.evaluate(() => { window.showUnifiedAdminModal('ai'); }); await page.waitForSelector('#ai-subtab-bar button[data-aisub="briefing"]');
            await tap(page, '#ai-subtab-bar button[data-aisub="briefing"]'); await page.waitForSelector('[data-sb-config] [data-field="exposure"]');
            const fields = await page.$$eval('[data-sb-config] [data-field]', (e) => e.map((x) => x.dataset.field)); assert.deepEqual(fields, ['method', 'chatgptModel', 'geminiModel', 'exposure', 'batchUnit', 'onlyChanged']);
            assert.equal(await page.$eval('[data-field="exposure"] [aria-pressed="true"]', (e) => e.textContent), '관리자에게만');
            assert.deepEqual(await page.$$eval('[data-field="chatgptModel"] button', (e) => e.map((x) => x.textContent)), ['GPT Luna', 'GPT Sol', 'GPT Astra']);
            await page.waitForSelector('[data-sb-next]'); assert.ok((await page.$eval('[data-sb-next]', (e) => e.textContent)).includes('10-17 17:30'));
            assert.equal(await page.evaluate(() => localStorage.getItem('seagnal_ai_subtab')), 'briefing');
        });
        await check('[§11.10] 오류 목록 — 최근 3일 전부(최근 것부터) · [복사]는 마크다운을 클립보드로(실패하면 보이는 안내) · [md로 저장]은 .md 내려받기', async () => {
            await page.waitForSelector('[data-sb-errors] [data-sb-err-list]');
            const li = await page.$$eval('[data-sb-err-list] li', (e) => e.map((x) => x.textContent));
            assert.equal(li.length, 3, li.join(' / ')); assert.ok(li[0].startsWith('10-17 08:02 · 08:00 판 · 2026-10-17 · validate/gemini · 제주해양경찰서 애월파출소'), li[0]);
            assert.ok(li[1].includes('외 1곳'), '관할이 많으면 3곳까지 + 외 N곳 — ' + li[1]); assert.ok(!li.join('').includes('오래된 오류'), '3일 전은 없음');
            assert.ok((await page.$eval('[data-sb-errors]', (e) => e.textContent)).includes('최근 3일 오류 3건(최근 것부터)'));
            // 복사 — 클립보드를 가짜로 바꿔 받은 글을 본다
            await page.evaluate(() => { window.__copied = null; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied = t; } } }); });
            await tap(page, '[data-sb-err-copy]'); await page.waitForFunction(() => document.querySelector('[data-sb-err-msg]').textContent.startsWith('복사했습니다'));
            const md = await page.evaluate(() => window.__copied), lines = md.split('\n');
            assert.equal(lines[0], '# 활동지점 안전 브리핑 — AI 브리핑 오류(최근 3일)'); assert.ok(lines.includes('- 건수: 3건') && lines.some((l) => /^- 만든 시각: 2026-10-17 \d\d:\d\d KST$/.test(l)), md);
            assert.ok(lines.includes('| 시각(KST) | 판 | 단계 | 공급자 | 관할 | 이유 |'));
            assert.ok(lines.includes('| 2026-10-17 08:02:00 | 08:00 판 · 2026-10-17 | validate | gemini | 제주해양경찰서 애월파출소 | number:hangul:두 곳\\|x 둘째 줄 |'), '「|」·줄바꿈은 표를 깨지 않게 — ' + md);
            assert.ok(md.includes('| 2026-10-16 17:31:00 | 17:30 판 · 2026-10-16 | call | vm | 제주해양경찰서 한림파출소, 제주해양경찰서 애월파출소, 부산해양경찰서 남항파출소, 목포해양경찰서 남항파출소 | VM 작업자 연결 없음 |'), 'md 에는 관할 전부');
            // 복사 실패(클립보드 거부 + 옛 방식도 실패) → 보이는 안내
            await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('권한 없음'); } } }); document.execCommand = () => false; });
            await tap(page, '[data-sb-err-copy]'); await page.waitForFunction(() => document.querySelector('[data-sb-err-msg]').textContent.startsWith('복사하지 못했습니다'));
            assert.ok((await page.$eval('[data-sb-err-msg]', (e) => e.textContent)).includes('[md로 저장]'));
            // md 로 저장 — Blob·a[download] 를 가로채 본다
            await page.evaluate(() => { window.__blobs = []; URL.createObjectURL = (b) => { window.__blobs.push(b); return 'blob:sb-test'; }; const oc = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.hasAttribute('data-sb-err-download')) { window.__dl = { name: this.download, href: this.href }; return; } return oc.call(this); }; });
            await tap(page, '[data-sb-err-md]'); await page.waitForFunction(() => document.querySelector('[data-sb-err-msg]').textContent.startsWith('저장했습니다'));
            const dl = await page.evaluate(async () => ({ ...window.__dl, type: window.__blobs[0].type, text: await window.__blobs[0].text() }));
            assert.ok(/^station_briefing_errors_\d{8}_\d{4}\.md$/.test(dl.name), dl.name); assert.equal(dl.href, 'blob:sb-test'); assert.equal(dl.type, 'text/markdown;charset=utf-8');
            assert.equal(dl.text.split('\n').filter((l) => l.startsWith('| 2026-')).length, 3); assert.ok(dl.text.startsWith('# 활동지점 안전 브리핑 — AI 브리핑 오류(최근 3일)'));
        });
        await check('설정 저장 — 방식 「틀」·묶음 「지방청」·바뀐 곳만 끄기 → 서버 config 에 저장', async () => {
            await tap(page, '[data-field="method"] [data-value="template"]'); await page.waitForFunction(() => document.querySelector('[data-sb-msg]').textContent.startsWith('저장됨'));
            await tap(page, '[data-field="batchUnit"] [data-value="region"]'); await page.waitForFunction(() => document.querySelector('[data-sb-msg]').textContent.includes('지방청'));
            await tap(page, '[data-field="onlyChanged"] [data-value="false"]'); await page.waitForFunction(() => document.querySelector('[data-sb-msg]').textContent.includes('매번 새로'));
            const c = real.readConfig(); assert.deepEqual([c.method, c.batchUnit, c.onlyChanged], ['template', 'region', false]);
            assert.equal(await page.$eval('[data-field="chatgptModel"]', (e) => e.style.opacity), '0.45', '틀이면 모델 줄이 흐리다');
            assert.ok(reqLog.some((r) => r.path === '/api/admin/station-briefing/config' && r.tok === 'admin-login'), '관리자 토큰 자동 첨부');
        });
        await check('노출 범위 전환 — 「사용자에게」면 일반 기기에도 아코디언, 「노출 안 함」이면 관리자 기기에도 없다', async () => {
            await tap(page, '[data-field="exposure"] [data-value="user"]'); await page.waitForFunction(() => document.querySelector('[data-sb-msg]').textContent.includes('사용자에게'));
            const g = await device(); assert.equal(await vis(g, 'station-briefing-accordion-header'), true, '일반 기기에 보임'); await g.context().close();
            await tap(page, '[data-field="exposure"] [data-value="off"]'); await page.waitForFunction(() => document.querySelector('[data-sb-msg]').textContent.includes('노출 안 함'));
            const a = await device({ admin: true }); assert.equal(await vis(a, 'station-briefing-accordion-header'), false, '관리자 기기에도 없음'); await a.context().close();
            await tap(page, '[data-field="exposure"] [data-value="admin"]'); await page.waitForFunction(() => document.querySelector('[data-sb-msg]').textContent.includes('관리자에게만'));
            assert.equal(real.readConfig().exposure, 'admin');
        });
        await check('[지금 다시 만들기] — 202 시작 안내 · 실행 중이면 409 「이미 실행 중」', async () => {
            await tap(page, '[data-sb-run]'); await page.waitForFunction(() => document.querySelector('[data-sb-run-msg]').textContent.startsWith('시작했습니다')); assert.equal(ctl.runs, 1);
            ctl.running = true; await tap(page, '[data-sb-run]'); await page.waitForFunction(() => document.querySelector('[data-sb-run-msg]').textContent.startsWith('이미 실행 중')); assert.equal(ctl.runs, 1, '실행 중이면 다시 부르지 않는다');
            ctl.running = false;
        });
        await check('관할 하나 미리보기 — 노출 범위와 무관, 사용자 화면과 같은 렌더러(바로가기 없음)', async () => {
            real.writeConfig({ exposure: 'off' });
            real.writeConfig({ exposure: 'off' });
            await page.selectOption('[data-sb-preview-station]', HALLIM); await tap(page, '[data-sb-preview-go]');
            await page.waitForSelector('[data-sb-preview-out] [data-sb-sec="overview"]');
            const r = await page.evaluate(() => ({ st: document.querySelector('[data-sb-preview-out] .sb-station').textContent, links: document.querySelectorAll('[data-sb-preview-out] .sb-link').length }));
            assert.ok(r.st.startsWith('한림파출소')); assert.equal(r.links, 0);
            real.writeConfig({ exposure: 'admin' });
        });
        for (const [w, h] of [[380, 844], [1280, 900]]) { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(250); await clean(page); await page.locator('#unified-admin-body').screenshot({ path: path.join(SHOT, 'admin_ai_briefing_' + w + '.png') }); }
        await page.context().close();

        // ── 8. 2단계 화면 독립 검토(review_ui1·review_ui2, 2026-10-16) — 결함마다 1:1 ──
        const toastText = (page) => page.evaluate(() => (document.getElementById('ocean-ui-toast') || {}).textContent || '');
        page = await device({ admin: true, width: 360, height: 780 });
        await pickStation(page, HALLIM); await page.waitForSelector('[data-sb-sec="overview"]'); await openAcc(page);
        await check('[UI-A1] 카드 최대치(해역 10·관광지 10·상시 12)·360px — 아코디언 본문이 잘리지 않고 꼬리(출처·「안전을 보장하지 않습니다」)까지 보인다', async () => {
            const r = await page.evaluate(async () => {
                const S = window.StationBriefing._state, resp = JSON.parse(JSON.stringify(S.resp)), b = resp.briefing;
                const dup = (arr, n) => Array.from({ length: n }, (_, i) => JSON.parse(JSON.stringify(arr[i % arr.length])));
                b.sea.cards = dup(b.sea.cards, 10); b.land.cards = dup(b.land.cards, 10); b.land.constant = dup(b.land.constant, 12);
                const box = document.getElementById('station-briefing-content');
                window.StationBriefingRender.render(box, resp, { showSea: true, showLand: true, onLink: () => {} });
                box.querySelectorAll('details').forEach((d) => { d.open = true; });
                await new Promise((res) => setTimeout(res, 700));
                const body = document.getElementById('station-briefing-accordion-body'), nb = box.querySelector('.sb-notice').getBoundingClientRect(), bb = body.getBoundingClientRect();
                const secs = [...box.querySelectorAll('.sb-sec-body')].map((e) => e.scrollHeight - e.clientHeight);
                return { content: box.scrollHeight, bodyClient: body.clientHeight, bodyScroll: body.scrollHeight, maxH: getComputedStyle(body).maxHeight, notice: nb.bottom, bodyBottom: bb.bottom, secs, cards: box.querySelectorAll('.sb-card').length };
            });
            assert.equal(r.cards, 20); assert.ok(r.content > 8000, '시험 자료가 옛 상한(8000px)을 넘어야 의미가 있다 — ' + r.content);
            assert.equal(r.maxH, 'none'); assert.ok(r.bodyScroll <= r.bodyClient + 1, JSON.stringify(r)); assert.ok(r.notice <= r.bodyBottom + 1, JSON.stringify(r));
            assert.ok(r.secs.every((d) => d <= 1), '안쪽 칸도 잘리지 않음 ' + r.secs.join(','));
            // 접으면 기존처럼 0 으로
            await page.evaluate(() => window.toggleStationBriefingAccordion()); await page.waitForTimeout(500);
            assert.equal(await page.evaluate(() => document.getElementById('station-briefing-accordion-body').clientHeight), 0);
            await openAcc(page);
        });
        await check('[UI-B1·B3·B5·B6·B10·B14] 총평 단계 < 해상 분석 단계면 한 줄 · 지난 칸 흐리게 · 「카드는 10곳까지」 · 내일 판 「내일」 · 출처 한 벌 · 지난 예정 시각은 「준비 중」', async () => {
            const base = JSON.parse(JSON.stringify(B.h));
            const r = await page.evaluate(({ base, now }) => {
                const R = window.StationBriefingRender, out = {}, box = document.createElement('div'); box.className = 'sb-wrap'; document.body.appendChild(box);
                const b1 = JSON.parse(JSON.stringify(base)); b1.sea.level = { rank: 3, word: '경계 필요' }; b1.sea.overviewLevel = { rank: 0, word: '평소 수준' };
                b1.sea.attentionRegions = 12; b1.sea.overviewRegions = 11; b1.land.attentionSpots = 13;
                R.render(box, { ok: true, briefing: b1 }, { now });
                out.note = (box.querySelector('[data-sb-level-note]') || {}).textContent || '';
                out.seaCount = box.querySelector('[data-sb-sea-count]').textContent; out.landCount = box.querySelector('[data-sb-land-count]').textContent;
                out.past = [...box.querySelectorAll('.sb-slot')].map((x) => x.dataset.past === 'true'); out.pastOpacity = getComputedStyle(box.querySelector('.sb-slot-past')).opacity;
                out.legend = box.querySelector('.sb-legend').textContent; out.labels = (b1.sea.timeBar || []).map((s) => s.label);
                out.foot = box.querySelector('[data-sb-foot-source]').textContent;
                const b2 = JSON.parse(JSON.stringify(base)); b2.sea.overviewLevel = { rank: b2.sea.level.rank, word: b2.sea.level.word };
                R.render(box, { ok: true, briefing: b2 }, { now }); out.noNote = !box.querySelector('[data-sb-level-note]');
                const b3 = JSON.parse(JSON.stringify(base)); b3.land.cards = []; b3.targetDate = '2026-10-18'; b3.generatedAt = '2026-10-17T23:00:00+09:00';
                R.render(box, { ok: true, briefing: b3 }, { now }); out.tomorrow = box.querySelector('[data-sb-land-none]').textContent;
                b3.targetDate = '2026-10-17'; b3.generatedAt = '2026-10-17T08:00:00+09:00'; R.render(box, { ok: true, briefing: b3 }, { now }); out.today = box.querySelector('[data-sb-land-none]').textContent;
                // §11.10 전에 저장된 브리핑(summary 없음 — 10-16·10-17 파일): 종전 문단·「근거 ▸」 모양 그대로
                const old = JSON.parse(JSON.stringify(base)); delete old.summary; old.overview = { land: '오늘 한림파출소 관할 육상은 주의 필요입니다. 따라서 협재해수욕장 주변 물가 접근에 주의가 필요합니다. 셋째 문장입니다.', sea: '오늘 한림파출소 관할 해상은 주의 필요입니다. 둘째. 셋째.', source: 'template', model: null };
                R.render(box, { ok: true, briefing: old }, { now });
                out.old = { paras: [...box.querySelectorAll('[data-sb-overview]')].map((e) => e.dataset.sbOverview + ':' + e.textContent), sum: box.querySelectorAll('[data-sb-summary]').length, basis: !!box.querySelector('details.sb-basis'), src: (box.querySelector('[data-sb-source]') || {}).textContent };
                // §11.10 판(10-17 낮에 저장 — summary 는 있지만 weather 칸이 없고 물때는 육상 덩어리 안) — 그 모양 그대로
                const v1 = JSON.parse(JSON.stringify(base)); delete v1.summary.weather; delete v1.summary.tide; v1.summary.land.tide = ['06:12 저조 뒤부터 물이 차오릅니다'];
                R.render(box, { ok: true, briefing: v1 }, { now });
                out.v1 = { parts: box.querySelectorAll('[data-sb-part]').length, landHead: (box.querySelector('[data-sb-summary="land"] .sb-headline') || {}).textContent || '', landTide: [...box.querySelectorAll('[data-sb-summary="land"] .sb-sum-tide')].map((x) => x.textContent) };
                R.render(box, { ok: true, briefing: null, nextExpectedAt: '2026-10-17T08:00:00+09:00' }, { now }); out.passed = box.textContent;
                R.render(box, { ok: true, briefing: null, nextExpectedAt: '2026-10-17T17:30:00+09:00' }, { now }); out.ahead = box.textContent;
                box.remove();
                out.sources = R.SOURCES;
                return out;
            }, { base, now: clock.now });
            assert.ok(r.note.includes('해상 분석에는 「경계 필요」 해역이 있습니다') && r.note.includes('아래 해상 분석을 보세요'), r.note);
            assert.ok(r.noNote, '단계가 같으면 그 줄이 없다');
            assert.ok(r.seaCount.includes('관심 이상 12개 해역(그중 공식 사고예보 단계만 있는 해역 1개 — 총평에는 올리지 않음)') && r.seaCount.includes('카드는 단계 높은 순 ' + base.sea.cards.length + '곳까지'), r.seaCount);
            assert.ok(r.landCount.includes('관심 이상 13곳 중 카드는 단계 높은 순'), r.landCount);
            // 10:05 에 본다 — 06~09시 칸은 끝났고 09~12시 칸은 아직(만드는 시각이 든 칸)
            assert.deepEqual(r.past, r.labels.map((l) => l === '06시')); assert.equal(r.pastOpacity, '0.4'); assert.ok(r.legend.includes('흐린 칸 = 이미 지난 시간'));
            assert.ok(r.tomorrow.startsWith('내일 평소와 달라진 요소'), r.tomorrow); assert.ok(r.today.startsWith('오늘 평소와 달라진 요소'), r.today);
            assert.ok(r.passed.includes('다음 브리핑을 준비 중입니다(10월 17일(토) 08:00 시작)'), r.passed);
            assert.deepEqual([r.old.sum, r.old.basis], [0, true], '옛 브리핑은 새 모양 대신 종전 문단 + 근거 접힘');
            assert.deepEqual([r.v1.parts, r.v1.landHead, r.v1.landTide], [0, base.summary.land.headline, ['06:12 저조 뒤부터 물이 차오릅니다']], '§11.10 판 브리핑은 그 모양(육상 덩어리 안 물때) 그대로');
            assert.ok(r.old.paras[0].startsWith('land:육상 오늘 한림파출소 관할 육상은') && r.old.paras[1].startsWith('sea:해상 '), r.old.paras.join(' / ')); assert.ok(r.old.src.includes('기본 문장(틀)'), r.old.src);
            assert.ok(r.ahead.includes('다음 브리핑 예정: 10월 17일(토) 17:30'), r.ahead);
            // 출처 한 벌 — 꼬리 출처 줄 = [기준 상세] 표(같은 SOURCES)
            for (const [what, who] of r.sources) assert.ok(r.foot.includes(what + ' — ' + who), what);
            assert.ok(r.sources.some((x) => x[1] === '해양경찰청 선박사고 기록(국립해양조사원 개방海 제공)' && x[0].includes('2021~2025')));
            assert.ok(r.sources.some((x) => x[0].includes('익수·추락·고립·표류·기타') && x[0].includes('앞바다 500m') && x[0].includes('2020~2024')));
            assert.ok(r.sources.some((x) => x[1].includes('Gemini 보충')));
            await tap(page, '#station-briefing-content .sb-basis-btn'); await page.waitForSelector('.rf-modal .rf-basis');
            const rows = await page.evaluate(() => { const t = [...document.querySelectorAll('.rf-basis-body table')].find((x) => x.textContent.includes('쓰는 곳')); return [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent)); });
            assert.deepEqual(rows, r.sources, '[기준 상세] 출처 표 = 꼬리 출처 줄과 같은 목록');
            await page.keyboard.press('Escape');
        });
        await check('[UI-A7] 바로가기 — 위험예측에 없는 연안 날짜면 다른 날짜를 열지 않고 안내(토스트), 실패는 false', async () => {
            const r = await page.evaluate(() => window.StationBriefing.openInRisk({ kind: 'coast', id: '50110|협재해수욕장', date: '2026-10-25', location: { lon: 126.239, lat: 33.394 } }));
            assert.equal(r, false);
            const sel = await page.evaluate(() => { const a = window._riskForecastApp; return a && a.getState().selected; });
            assert.equal(sel, null, '다른 날짜의 시트를 조용히 열지 않는다');
            const t = await toastText(page); assert.ok(t.includes('이 관광지(10월 25일(일))') && t.includes('열지 못했습니다'), t);
        });
        await page.context().close();

        await check('[UI-A4] 설정 팝업 [관할 설정] — 저장하지 않은 관심해역 변경이 있으면 묻는다: 취소 → 팝업에 남고 변경 그대로 · 확인 → 저장하고 이동', async () => {
            const pg = await device({ admin: true });
            await pg.evaluate(() => window.openSettingsModal()); await pg.waitForTimeout(500);
            assert.equal(await pg.evaluate(() => window.settingsModalHasUnsaved()), false, '열자마자는 변경 없음(알림 칸 포함)');
            const changed = await pg.evaluate(() => { const c = document.querySelector('#settings-list-container input[type=checkbox]'); c.click(); return JSON.stringify(UserSettings.settings); });
            assert.equal(await pg.evaluate(() => window.settingsModalHasUnsaved()), true);
            const asked = [];
            pg.once('dialog', (d) => { asked.push(d.message()); d.dismiss(); });
            await pg.evaluate(() => document.getElementById('station-briefing-settings-edit').click()); await pg.waitForTimeout(300);
            assert.ok(asked[0] && asked[0].includes('저장하지 않은 변경'), String(asked[0]));
            assert.deepEqual(await pg.evaluate(() => [document.getElementById('settings-modal').classList.contains('hidden'), JSON.stringify(UserSettings.settings), !!document.querySelector('[data-sb-setup]')]), [false, changed, false], '취소 — 팝업·변경 그대로, 관할 고르기로 가지 않음');
            pg.once('dialog', (d) => d.accept());
            await pg.evaluate(() => document.getElementById('station-briefing-settings-edit').click()); await pg.waitForSelector('[data-sb-setup]');
            assert.deepEqual(await pg.evaluate(() => [document.getElementById('settings-modal').classList.contains('hidden'), localStorage.getItem('weatherAppSettings_v1')]), [true, changed], '확인 — 저장하고 관할 고르기');
            await pg.context().close();
        });

        await check('[UI-A5] 관리자 기기에서 노출 판정 조회가 잠깐 실패해도 아코디언이 사라지지 않고, 처음부터 실패하면 짧게 다시 물어 보인다', async () => {
            const pg = await device({ admin: true });
            assert.equal(await vis(pg, 'station-briefing-accordion-header'), true);
            let fails = 1;
            await pg.route('**/api/station-briefing/stations*', (rt) => fails-- > 0 ? rt.fulfill({ status: 503, body: '{}' }) : rt.continue());
            await pg.evaluate(() => window.StationBriefing.refresh()); await pg.waitForTimeout(300);
            assert.equal(await vis(pg, 'station-briefing-accordion-header'), true, '직전 판정(보임) 유지');
            await pg.context().close();
            // 처음 조회가 실패하는 기기 — 5초 뒤 다시 물어 보인다
            const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, timezoneId: 'Asia/Seoul' }), p2 = await ctx.newPage();
            p2.on('pageerror', (e) => errors.push(e.message));
            let first = 1;
            await p2.route('**/*', (rt) => { const u = rt.request().url(); if (!u.startsWith(base)) return rt.abort(); if (u.includes('/api/station-briefing/stations') && first-- > 0) return rt.fulfill({ status: 503, body: '{}' }); return rt.continue(); });
            await p2.clock.setFixedTime(new Date(clock.now));
            await p2.addInitScript(() => { localStorage.setItem('seagnal_admin_mode', 'true'); localStorage.setItem('push_token', 'admin-push-token'); });
            await p2.goto(base + '/'); await p2.waitForFunction(() => window.StationBriefing); await p2.waitForTimeout(800);
            assert.equal(await vis(p2, 'station-briefing-accordion-header'), false, '처음 실패 — 아직 안 보임');
            await p2.waitForFunction(() => getComputedStyle(document.getElementById('station-briefing-accordion-header')).display !== 'none', null, { timeout: 9000 });
            await ctx.close();
        });

        await check('[UI-A8] 관리자 모드를 끄면 다음 갱신을 기다리지 않고 바로 아코디언이 사라진다(노출 「관리자에게만」)', async () => {
            const pg = await device({ admin: true });
            assert.equal(await vis(pg, 'station-briefing-accordion-header'), true);
            await pg.evaluate(() => window._toggleAdminMode(false)); await pg.waitForTimeout(500);
            assert.equal(await vis(pg, 'station-briefing-accordion-header'), false);
            await pg.evaluate(() => window._toggleAdminMode(true)); await pg.waitForTimeout(500);
            assert.equal(await vis(pg, 'station-briefing-accordion-header'), true, '다시 켜면 바로 보임');
            await pg.context().close();
        });

        await check('[UI-A6] 점검 차단 — 「활동지점 안전 브리핑」 개별 차단: 일반 기기는 덮개 + 몸 숨김(정기 갱신에도 그대로), 관리자는 머리를 누르면 열림, 해제하면 노출 판정대로', async () => {
            real.writeConfig({ exposure: 'user' });
            const g = await device();
            await g.evaluate(() => window.applyFeatureBlocks(['station-briefing'])); await g.waitForTimeout(100);
            assert.ok(await g.$('#station-briefing-accordion-header .feature-block-overlay'), '머리에 점검 덮개');
            await g.evaluate(() => window.StationBriefing.refresh()); await g.waitForTimeout(400);
            assert.equal(await vis(g, 'station-briefing-accordion-body'), false, '정기 갱신이 몸을 되살리지 않는다');
            await g.evaluate(() => window.applyFeatureBlocks([])); await g.waitForTimeout(100);
            assert.deepEqual([!!(await g.$('#station-briefing-accordion-header .feature-block-overlay')), await vis(g, 'station-briefing-accordion-body')], [false, true]);
            await g.context().close();
            real.writeConfig({ exposure: 'admin' });
            const n = await device();
            await n.evaluate(() => { window.applyFeatureBlocks(['station-briefing']); window.applyFeatureBlocks([]); }); await n.waitForTimeout(100);
            assert.equal(await vis(n, 'station-briefing-accordion-body'), false, '차단을 풀어도 노출 판정이 「안 보임」이면 몸은 숨김 그대로');
            await n.context().close();
            const a = await device({ admin: true });
            await a.evaluate(() => window.applyFeatureBlocks(['station-briefing'])); await a.waitForTimeout(100);
            assert.equal(await vis(a, 'station-briefing-accordion-body'), false);
            await a.evaluate(() => document.getElementById('station-briefing-accordion-header').onclick(new MouseEvent('click'))); await a.waitForTimeout(400);
            assert.deepEqual(await a.evaluate(() => { const b = document.getElementById('station-briefing-accordion-body'); return [getComputedStyle(b).display !== 'none', b.classList.contains('collapsed')]; }), [true, false], '관리자는 차단 외관이어도 열린다');
            await a.context().close();
        });

        await check('[UI-A2] 일반 기기(노출 「사용자에게」) — [위험예측에서 보기 ›] 가 위험예측 미리보기 잠금을 풀지 않고, 탭도 옮기지 않고 안내', async () => {
            real.writeConfig({ exposure: 'user' });
            const g = await device();
            await pickStation(g, HALLIM); await g.waitForSelector('[data-sb-sec="overview"]'); await openAcc(g);
            const tab0 = await g.evaluate(() => document.body.getAttribute('data-active-tab'));
            await g.evaluate(() => document.querySelector('[data-sb-card="land"] .sb-link').click()); await g.waitForTimeout(700);
            const r = await g.evaluate(() => ({ locked: document.getElementById('ocean-risk-forecast-toggle-btn').classList.contains('rf-preview-locked'), tab: document.body.getAttribute('data-active-tab'), app: !!window._riskForecastApp }));
            assert.deepEqual([r.locked, r.tab, r.app], [true, tab0, false]);
            assert.ok((await toastText(g)).includes('미리보기'), await toastText(g));
            assert.equal(await g.evaluate(() => window.RiskForecast.openAt({ kind: 'coast', id: '50110|협재해수욕장' })), false, 'openAt 도 일반 기기 잠금을 풀지 않는다');
            assert.equal(await g.evaluate(() => document.getElementById('ocean-risk-forecast-toggle-btn').classList.contains('rf-preview-locked')), true);
            await g.context().close();
            real.writeConfig({ exposure: 'admin' });
        });

        await check('[UI-A3] 「노출 안 함」으로 바꾸면 열려 있는 기기(관할 미설정 포함)도 10분 정기 갱신에 사라진다', async () => {
            real.writeConfig({ exposure: 'user' });
            const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, timezoneId: 'Asia/Seoul' }), p3 = await ctx.newPage();
            p3.on('pageerror', (e) => errors.push(e.message));
            await p3.route('**/*', (rt) => rt.request().url().startsWith(base) ? rt.continue() : rt.abort());
            await p3.clock.install({ time: new Date(clock.now) });
            await p3.goto(base + '/'); await p3.waitForFunction(() => window.StationBriefing); await p3.clock.runFor(3000); await p3.waitForTimeout(800);
            assert.equal(await vis(p3, 'station-briefing-accordion-header'), true, '관할 미설정 일반 기기에 보임');
            real.writeConfig({ exposure: 'off' });
            await p3.clock.runFor(11 * 60 * 1000); await p3.waitForTimeout(1200);
            assert.equal(await vis(p3, 'station-briefing-accordion-header'), false, '10분 안에 사라짐');
            await ctx.close();
            real.writeConfig({ exposure: 'admin' });
        });
        await check('실행 오류 없음', async () => { assert.deepEqual(errors, []); });
    } catch (e) { console.error('❌ 준비 실패', e && e.stack); fail++; }
    finally { if (browser) await browser.close(); if (server) server.close(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 임시 폴더 */ } }
    console.log('스크린샷: ' + SHOT);
    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();
