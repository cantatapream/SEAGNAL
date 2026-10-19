/**
 * ============================================================================
 * 파일명: local_server/scripts/test_usage_briefing_risk_ui.js
 * 역할  : 사용량 통계 「연안 안전 브리핑」·「위험예측」 두 묶음이 실제 클릭 한 번에 정확히 1건씩(키·건수) 서버로 가는지 실제 Chromium 으로 index2.html 전체를 띄워 눌러 본다.
 *         사용자 원문(2026-10-18): *"연안안전 브리핑 제공실적도 집계되도록 해줘 집계는 아코디언이 열리면 1건으로 반영. 그리고 해양생활안전에서 위험예측 버튼을 누르고
 *         각 토글을 누르면 1건, 그리고 격자를 눌러서 바텀시트를 열면 한건, 그리고 브리핑에서 위험예측 또는 지도와 연계된 하이퍼링크 등을 누르면 각 한건으로 집계해줘.
 *         연안 안전 브리핑과 위험예측은 별개로 집계가 되어야하고 브리핑에서 위험예측 기능과 관련된 지도가 열리면 위험예측으로 반영되어야하는거야"*
 *         ①아코디언 펼침 1건·접힘 0건 ②브리핑 글 속 지도 링크·근거 지도 펼침·지도 칸 시트 각 1건(위험예측 지도 → 'risk.*_from_briefing', 아니면 'briefing.*') ·
 *         표만 펼치는 단추 0건 · 관리자 미리보기(opts.usage 없음) 0건 ③[위험예측에서 보기 ›] = 바로가기 1건뿐(위험예측 버튼·층 스위치를 대신 누르는 클릭은 0건 — 이중 집계 없음)
 *         ④위험예측 켬 1건·끔 0건 · 연안/해상 스위치 켬 1건·끔 0건 · 해상 [혼잡도]/[위험 예측] 고름 1건 · 지도에서 칸·관광지를 눌러 시트 열림 1건 · 시트가 열린 동안 지도 클릭 0건.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 시험 대상     : client/js/forecast/station-briefing/station_briefing.js(toggle·openInRisk) · station_briefing_render.js(usageOf·usage·mapLink·expander·riskPopup·basisList)
 *                    · client/js/marine-life/risk-forecast/risk_forecast.js(usage·quiet·mapSelect·bindApp·openAt·goTo) · client/js/shared/utils/utils.js(trackUsage·withUsageSuppressed)
 *                    · client/js/shared/utils/usage_keys.js(이름표 — 보낸 키가 모두 이름표에 있고 묶음 앞말이 맞는지)
 *  - 서버          : 실제 routes/station_briefing.js + services/station_briefing.js(임시 폴더) · 실제 routes/risk_forecast.js + 가짜 위험예측 저장소
 *                    (test_station_briefing_ui.js 와 같은 꼴 — 브리핑 본문은 실제 규칙 station_briefing_rules.buildBriefing). POST /api/usage 는 이 시험이 받아 적는다.
 *  - 나를 쓰는 곳  : scripts/refactor/verify_all.sh SUITES
 * [로드 순서] 독립 검사. 3001 서버·외부 호출 없음 — 자체 express(임의 포트), 127.0.0.1 밖 요청은 모두 끊는다.
 *             시각 고정: 서버 시계·브라우저 시계 모두 2026-10-17 10:05 KST(과거) — 실행 시각과 무관. USAGE_SHOT_DIR 를 주면 관리자 사용량 화면 사진을 남긴다(판정에는 안 씀).
 * [실행] NODE_PATH=/opt/node-tools/node_modules:/home/user/SEAGNAL/local_server/node_modules node local_server/scripts/test_usage_briefing_risk_ui.js
 * ============================================================================
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), express = require('express'), { chromium } = require('playwright-core');
const root = path.join(__dirname, '../..'), R = require('../services/station_briefing_rules'), SB = require('../services/station_briefing'), { createRouter } = require('../routes/station_briefing');
const RF = require('../routes/risk_forecast'), M = require('../services/marine_fusion'), T = require('../services/risk_time'), io = require('../services/risk_collector_io'), I = require('../services/station_briefing_inputs');
const LABELS = require('../../client/js/shared/utils/usage_keys.js');
let pass = 0, fail = 0;
/** 사례 하나. 실패도 모두 찍고 끝에 요약. @param {string} name @param {function} fn [연계] ← 아래 시나리오 */
async function check(name, fn) { try { await fn(); console.log('✅', name); pass++; } catch (e) { console.error('❌', name, e && e.message); fail++; } }

const pad = (n) => String(n).padStart(2, '0'), at = (h) => `2026-10-17T${pad(h)}:00:00+09:00`;
const clock = { now: Date.parse('2026-10-17T10:05:00+09:00') };
const HALLIM = '제주해양경찰서|한림파출소', CELL = { id: 'GR4_F4K23_P4', lat: 33.5625, lon: 126.5375 };
const IN_CELL = { id: 'GR4_HALLIM_IN', i: 1, lat: 33.4125, lon: 126.2125, geometry: { type: 'Polygon', coordinates: [[[126.2, 33.4], [126.225, 33.4], [126.225, 33.425], [126.2, 33.425], [126.2, 33.4]]] } };
const SPOT = { lon: 126.239, lat: 33.394 };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-ui-')), SHOT = process.env.USAGE_SHOT_DIR || '';
if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
const REGIONAL = { coastal: { 제주도서부앞바다: { officeName: '제주지방기상청', publishTime: '10.17. 05:00', periods: [
    { date: '20261017', period: 'am', weather: '구름많음', waveHeight: '0.5~1.5', wind: '동~남동 / 7~11' }, { date: '20261017', period: 'pm', weather: '구름많음', waveHeight: '0.5~1.5', wind: '남동 / 7~11' }] } },
offices: { 184: { officeName: '제주지방기상청', bulletinPublishTime: '2026.10.17 04:40', summary: fs.readFileSync(path.join(__dirname, 'fixtures', 'station_briefing', 'jeju_bulletin_20261017.txt'), 'utf8') } }, zoneOffice: { 제주도서부앞바다: '184' } };

/**
 * 한림파출소 브리핑 한 판(test_station_briefing_ui.js hallimInput·mapInputs 와 같은 숫자 — 해역 카드·관광지 카드·특보·대해구·잠기는 바위·위험이 높아진 해역 근거가 다 생긴다).
 * 예: makeBriefing() → {key:HALLIM, sea:{cards:[…]}, land:{cards:[…]}, summary:{sea:{haegu:[…], warnings:{…}}, rocks:{…}}, …}
 * @returns {Object} [연계] ← 준비(writeDay) / → station_briefing_rules.buildBriefing·station_briefing_inputs
 */
function makeBriefing() {
    const hl = I.loadStations().find((s) => s.name === '한림파출소'), sq = (lon, lat) => [lon - 0.0125, lat - 0.0125, lon + 0.0125, lat + 0.0125];
    const regions = [
        { rid: 'A:1001', gridId: CELL.id, accidentGridId: '1001', lat: CELL.lat, lon: CELL.lon, box: [126.525, 33.55, 126.55, 33.575], haegu: { major: 232, sub: 2, label: '232-2' }, ref: { name: '화순항', distNm: 13.3, bearingWord: '북북서' }, zone: { name: '제주도서부앞바다', kind: 'main' }, zones: ['제주도서부앞바다'],
            slots: { [at(15)]: { accident: '주의', congestion: { level: '높음', index: 12.3, at: at(15) } }, [at(18)]: { accident: '주의', congestion: null } }, history: { from: '2021-01-01', to: '2025-12-31', count: 18, topTypes: [{ type: '충돌', count: 7 }], death: 1, missing: 0 } },
        { rid: 'T:GR4_9', gridId: 'GR4_9', accidentGridId: null, lat: 33.48, lon: 126.33, box: sq(126.33, 33.48), haegu: { major: 232, sub: 3, label: '232-3' }, ref: { name: '제주', distNm: 7.0, bearingWord: '서' }, zone: { name: '제주도북부앞바다', kind: 'main' }, zones: ['제주도북부앞바다'],
            slots: { [at(12)]: { accident: null, congestion: { level: '높음', index: 11, at: at(13) } } }, history: { count: 0 } },
        { rid: 'A:1003', gridId: null, accidentGridId: '1003', lat: 33.35, lon: 126.2, box: [126.18, 33.33, 126.22, 33.37], haegu: { major: 231, sub: 6, label: '231-6' }, ref: { name: '모슬포', distNm: 6.0, bearingWord: '북서' }, zone: null, zones: [], slots: { [at(9)]: { accident: '주의' } }, history: { count: 0 } },
    ];
    const inp = {
        key: HALLIM, name: '한림파출소', office: '제주해양경찰서', region: '제주지방해양경찰청', seaOnly: false, area: I.areaOf(hl.geometry),
        location: { lat: 33.41, lon: 126.26, source: 'estimate', estimated: true }, sources: { accident: 'ok', congestion: 'ok', zoneForecasts: 'ok', warnings: 'ok' },
        sea: {
            reviewedCells: 52, regions,
            weather: { 232: { label: '232해구', box: I.haeguBox(232), rows: [[6, 0.8, 5], [9, 1.0, 6], [12, 1.4, 9], [15, 2.4, 13], [18, 2.6, 14], [21, 1.8, 10]].map(([h, wh, ws]) => ({ at: at(h), wh, ws })) } },
            warnings: [
                { zone: '제주도북부앞바다', kind: '앞바다', type: '풍랑', level: '주의보', state: '발효', effective: { start: '2026-10-16T21:00:00+09:00', end: '2026-10-16T21:00:00+09:00', range: false }, release: { start: at(6), end: at(9), range: true } },
                { zone: '제주도서부앞바다', kind: '앞바다', type: '풍랑', level: '주의보', state: '예비', effective: { start: at(21), end: '2026-10-18T00:00:00+09:00', range: true }, release: null },
            ],
        },
        places: [{ name: '비양도', lat: 33.4067, lon: 126.2275 }, { name: '협재해수욕장', lat: 33.394, lon: 126.239 }, { name: '한림항', lat: 33.414, lon: 126.264 }],
        land: {
            spots: [
                { id: '50110|협재해수욕장', name: '협재해수욕장', lat: 33.394, lon: 126.239, beach: true, index: 72, band: '높음', peakAt: at(15), people: { ratio: 1.8, score: 0.82 }, event: null, swell: null, rip: null, notices: { effective: [], prelim: [], windMs: 9, driftTarget: '튜브·물놀이기구' }, hazard: { count: 4, byType: [{ class: '사망사고 발생구역', count: 1 }, { class: '연안사고 위험구역', count: 3 }], zones: [{ id: '제주-1', class: '연안사고 위험구역' }] }, history: { count: 6, from: '2020-01-01', to: '2024-12-31', topTypes: [{ type: '표류', count: 4 }] }, missing: [], isolation: 2, isolationYears: { 2022: 1, 2024: 1 } },
                { id: '50110|한림항', name: '한림항', lat: 33.414, lon: 126.264, beach: false, index: 30, band: '다소 높음', peakAt: at(6), people: { ratio: 0.9, score: 0 }, event: null, swell: null, rip: null, notices: { effective: [], prelim: [], windMs: null }, hazard: { count: 3, byType: [{ class: '사망사고 발생구역', count: 3 }] }, history: { count: 2, from: '2020-01-01', to: '2024-12-31', topTypes: [{ type: '추락', count: 2 }] }, missing: [], isolation: 1, isolationYears: { 2023: 1 } },
            ],
            hazardOnly: [{ id: '한림-9', place: '한림항 방파제', class: '사망사고 발생구역', shape: '방파제', lat: 33.415, lon: 126.262 }],
        },
        tide: { anchorId: 'J7', distKm: 3.2, date: '2026-10-17', region: 'jeju', curve: [], peaks: [{ type: 'high', t: '00:50', cm: 210 }, { type: 'low', t: '06:12', cm: 20 }, { type: 'high', t: '12:30', cm: 200 }, { type: 'low', t: '18:40', cm: 25 }], prevPeak: { type: 'low', t: '18:20', cm: 22 }, nextPeak: { type: 'high', t: '00:55', cm: 205 },
            rocks: { count: 2, first: '02:40', last: '16:41', items: [{ id: 812, lat: 33.4205, lon: 126.2560, v: 0.9, times: ['02:40'] }, { id: 77, lat: 33.4105, lon: 126.2350, v: 1.4, times: ['03:10', '16:41'] }] } },
    };
    const h = R.buildBriefing({ ...inp, zoneWeather: I.collectZoneWeather({ lat: 33.41, lon: 126.26 }, REGIONAL) }, R.editionWindow('morning', Date.parse(at(8))), { generatedAt: '2026-10-17T09:10:00+09:00' });
    h.trigger = { kind: 'morning' };
    // 분석 문단 — 대해구 이름(대해구 지도 링크)·「예비특보」(기상특보 현황 창 링크)가 들어가게
    h.overview = { land: '협재해수욕장은 방문객이 평소의 1.8배로 예상돼 주의 수준입니다. 따라서 협재해수욕장 주변 연안사고에 주의가 요구됩니다.',
        sea: h.summary.sea.haegu[0].name + '는 유의파고 2.6m·풍속 14m/s로 높아집니다. 21시부터 예비특보 구역에 들어갑니다. 따라서 비양도 주변 해역 운항에 주의가 요구됩니다.', source: 'chatgpt', model: 'gpt-6-luna' };
    return h;
}

(async () => {
    let browser, server;
    try {
        const B = makeBriefing();
        fs.writeFileSync(path.join(dir, 'briefings_2026-10-17.json'), JSON.stringify({ date: '2026-10-17', stations: { [HALLIM]: B } }));
        const realSt = I.loadStations().find((x) => x.key === HALLIM);
        const stationsFx = [{ key: HALLIM, name: '한림파출소', office: '제주해양경찰서', region: '제주지방해양경찰청', seaOnly: false, idx: 0, geometry: realSt && realSt.geometry }];
        const NOW_CELLS = { cells: [{ id: 'GR4_A', box: [126.2, 33.4, 126.225, 33.425], count: 18 }, { id: 'GR4_B', box: [126.225, 33.4, 126.25, 33.425], count: 12 }], busiest: { name: '한림항 북서방 1.2해리 해역(232-2해구)', count: 18, id: 'GR4_A' } };
        const NOWFX = { at: '2026-10-17T10:00:00+09:00', count: 37, gridCount: 2, text: '10:00 기준 관할 해역 선박 37척 · 선박이 있는 해역 격자 2개\n한림항 북서방 1.2해리 해역(232-2해구) 18척 — 충돌·접촉 주의', ...NOW_CELLS };
        const real = SB.createService({ dir, clock: () => clock.now, loadStations: () => stationsFx });
        real.writeConfig({ exposure: 'user' });   // 일반 기기에도 보이게 — 관리자 모드가 끼어들지 않는 사용자 화면 그대로
        const sbRouter = createRouter({ service: real, isAdminDevice: () => false, verifyToken: () => false, authorize: (req, res) => res.status(401).json({ ok: false }), clock: () => clock.now,
            nowLine: (key, r, o) => key === HALLIM && r.briefing ? (o && o.since && o.since === NOWFX.at ? { unchanged: true, at: o.since } : { ...NOWFX }) : null });

        // ── 위험예측 가짜 저장소(test_station_briefing_ui.js 와 같은 꼴) — 해상 칸 하나(CELL) · 관할 안 실시간 칸(IN_CELL) · 관광지 하나(협재) ──
        const geometry = { type: 'Polygon', coordinates: [[[126.525, 33.55], [126.55, 33.55], [126.55, 33.575], [126.525, 33.575], [126.525, 33.55]]] };
        const cell = { id: CELL.id, i: 0, lat: CELL.lat, lon: CELL.lon, geometry, haegu: { label: '232-2', major: 232, sub: 2 }, ref: { name: '화순항', bearingWord: '북북서', distNm: 13.3 } }, acc = { ...cell, id: '1001' };
        const at0 = T.isoKst(clock.now);
        io.write(path.join(dir, 'sea_realtime.json.gz'), { v: 'v2', cells: [cell, IN_CELL], rows: [[0, 21, .2], [1, 18, .5]], collectedAt: at0, sourceAt: at0, source: 'MTIS realtime API' });
        const frames = {}; for (const t of T.timeline(clock.now, 3, 3, 21)) frames[t.slice(0, 13).replace(/[-T]/g, '') + '00'] = [[0, .002, '주의']];
        const inputs = { version: 1, cells: { cells: [cell] }, congestion: { frames: {} }, accident: { cells: [acc], frames }, sources: { accident: { status: 'ok' }, congestion: { status: 'ok' }, zoneForecasts: { status: 'ok' } }, weather: () => ({ wh: 2, ws: 12, wp: 4, wd: 241, forecastAt: at0 }) };
        const ring = (x, y) => [[x, y], [x + .01, y], [x + .01, y + .01], [x, y + .01], [x, y]];
        const spots = [{ id: '50110|협재해수욕장', i: 0, lat: SPOT.lat, lon: SPOT.lon, name: '협재해수욕장', cell: ring(126.234, 33.389) }];
        const HZ = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'coastal_safety', 'coastal_hazard_zones.wgs84.geojson'), 'utf8'));
        const store = { sources: () => inputs.sources, marineInputs: () => inputs,
            meta: () => { const a = { coast: T.timeline(clock.now, 3, 2, 21), sea: T.timeline(clock.now, 1, 2, 23) }; return { now: T.isoKst(clock.now), versions: { spots: 'v1', cells: 1, accident: 'v1' }, timeline: { sea: { times: a.sea }, accident: { times: a.coast }, coast: { times: a.coast } }, sources: inputs.sources }; },
            spots: () => ({ spots }), cells: () => ({ cells: [cell] }), accidentCells: () => ({ v: 'v1', cells: [acc] }), accidentFrame: () => ({ v: 'v1', cells: [[0, .001, '주의']] }),
            frame: (sea) => sea ? { cells: [[0, 0, 1, '낮음']], spots: [], borders: [] } : { spots: spots.map((s) => [s.i, 3]), borders: [] },
            coastDayFrame: () => ({ spots: spots.map((s) => [s.i, 3]), degraded: [] }),
            coastDayDetail: (id, t) => ({ title: '연안 ' + id, subtitle: { lat: SPOT.lat, lon: SPOT.lon }, clickable: false, t }), islands: () => ({ features: [] }),
            hazards: (ids) => ({ type: 'FeatureCollection', features: HZ.features.filter((f) => ids.includes(f.properties.name)) }) };
        const marine = M.createStore({ risk: store, dir, clock: () => clock.now, stations: [{ properties: { name: '한림파출소' }, geometry }], accidents: [], describe: () => cell });

        // ── 사용량 수신(실제 utils.js trackUsage → POST /api/usage 를 이 시험이 받는다) ──
        const sent = [];
        const app = express();
        app.post('/api/usage', express.json(), (req, res) => { const b = req.body || {}; (Array.isArray(b.features) ? b.features : [b.feature]).forEach((f) => sent.push(f)); res.json({ ok: true }); });
        app.use(sbRouter);
        app.use(RF.createRouter({ store, marine }));
        app.get('/', (req, res) => res.sendFile(path.join(root, 'client/index2.html')));
        app.use(express.static(path.join(root, 'client')));
        app.use('/api', (req, res) => res.status(404).json({ ok: false }));
        server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r)); const base = 'http://127.0.0.1:' + server.address().port;

        browser = await chromium.launch({ ...((process.env.PW_CHROME || process.env.SIM_CHROMIUM || process.env.CHROMIUM_EXECUTABLE) ? { executablePath: process.env.PW_CHROME || process.env.SIM_CHROMIUM || process.env.CHROMIUM_EXECUTABLE } : {}), headless: true, args: ['--no-sandbox'] });
        const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, timezoneId: 'Asia/Seoul' }), pg = await ctx.newPage(), errors = [];
        pg.on('pageerror', (e) => errors.push(e.message));
        await pg.route('**/*', (r) => r.request().url().startsWith(base) ? r.continue() : r.abort());
        await pg.clock.setFixedTime(new Date(clock.now));
        // 관할(한림)을 이미 골라 둔 기기 — 설정 흐름은 test_station_briefing_ui.js 가 본다. 여기서는 아코디언을 처음 펼치는 것부터 센다.
        await pg.addInitScript((st) => { try { if (!sessionStorage.getItem('__u_init')) { sessionStorage.setItem('__u_init', '1'); localStorage.setItem('seagnal_station_briefing_v1', JSON.stringify({ station: st, name: '한림파출소', office: '제주해양경찰서', seaOnly: false, showSea: true, showLand: true, hidden: false, seen: {} })); } } catch (e) { /* 저장소 없음 */ } }, HALLIM);
        await pg.goto(base + '/'); await pg.waitForFunction(() => window.StationBriefing && typeof window.switchMainTab === 'function' && window.RiskForecast && window.RiskForecast.openAt);
        await pg.waitForFunction(() => getComputedStyle(document.getElementById('station-briefing-accordion-header')).display !== 'none', null, { timeout: 8000 });
        await pg.waitForTimeout(600);
        await pg.evaluate(() => ['server-maintenance-popup', 'network-error-popup', 'splash-screen', 'main-notice-popup'].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); }));

        const OURS = /^(briefing|risk)\./;
        /**
         * fn 을 실행한 뒤 보낸 사용량 키(이 두 묶음만 — 다른 기능 키는 따로 모아 「다른 키 없음」을 본다)를 돌려준다.
         * 예: await keysOf(() => click('…')) → ['briefing.haegu_map']
         * @param {Function} fn - 누르기(Promise) @param {Function} [until] - 끝났다고 볼 조건(페이지 안 함수) @returns {Promise<{ours:string[], other:string[]}>}
         */
        const keysOf = async (fn, until) => {
            const k0 = sent.length; await fn();
            if (until) await pg.waitForFunction(until, null, { timeout: 10000 });
            await pg.waitForTimeout(350);   // fetch(keepalive) 가 서버에 닿을 때까지
            const got = sent.slice(k0); return { ours: got.filter((k) => OURS.test(k)), other: got.filter((k) => !OURS.test(k)) };
        };
        const click = (sel) => pg.evaluate((s) => { const e = document.querySelector(s); if (!e) throw Error('없음: ' + s); e.click(); }, sel);
        const closePopup = () => pg.evaluate(() => { const x = document.querySelector('[data-sb-map-popup] [data-sb-map-close]'); if (x) x.click(); });
        const C = '#station-briefing-content ';

        // ── 1. 연안 안전 브리핑 아코디언 ──
        await check('[브리핑] 아코디언을 펼치면 1건(briefing.open) · 접으면 0건 · 다시 펼치면 또 1건', async () => {
            let r = await keysOf(() => click('#station-briefing-accordion-header'), () => !!document.querySelector('#station-briefing-content [data-sb-sec="overview"]'));
            assert.deepEqual(r.ours, ['briefing.open']); assert.deepEqual(r.other, []);
            r = await keysOf(() => click('#station-briefing-accordion-header')); assert.deepEqual(r.ours, [], '접힘은 세지 않는다');
            r = await keysOf(() => click('#station-briefing-accordion-header')); assert.deepEqual(r.ours, ['briefing.open']);
            // 칸(총평·해상·연안 분석)을 펼치는 머리·근거 상세 알약은 세지 않는다
            r = await keysOf(() => pg.evaluate(() => { document.querySelectorAll('#station-briefing-content .sb-sec:not(.open) > .marine-forecast-sub-header').forEach((h) => h.click());
                ['basis-sea', 'basis-land'].forEach((k) => { const b = document.querySelector('#station-briefing-content [data-sb-x="' + k + '"]'); if (b && b.getAttribute('aria-expanded') !== 'true') b.click(); }); }));
            assert.deepEqual(r.ours, [], '칸 펼침·근거 상세 펼침 0건');
        });

        // ── 2. 브리핑 글 속 링크 — 위험예측 자료가 없는 지도·창 = 「연안 안전 브리핑」 묶음 ──
        await check('[브리핑] 대해구 이름 → briefing.haegu_map · 특보 말 → briefing.warn_popup · 잠기는 바위 → briefing.rocks_map (각 1건)', async () => {
            for (const [sel, key] of [[C + '[data-sb-analysis="sea"] [data-sb-maplink="haegu"]', 'briefing.haegu_map'], [C + '[data-sb-maplink="warn"]', 'briefing.warn_popup'], [C + '[data-sb-maplink="rocks"]', 'briefing.rocks_map']]) {
                const r = await keysOf(() => click(sel), () => !!document.querySelector('[data-sb-map-popup]'));
                assert.deepEqual(r.ours, [key], sel); await closePopup();
            }
        });
        await check('[브리핑] 근거 「대해구」 줄 펼침 지도 → briefing.haegu_map 1건 · 접기 0건 · 표만 펼치는 단추(고립 사고 표)는 0건', async () => {
            let r = await keysOf(() => click(C + 'button[data-sb-x="map-haegu"]')); assert.deepEqual(r.ours, ['briefing.haegu_map']);
            r = await keysOf(() => click(C + 'button[data-sb-x="map-haegu"]')); assert.deepEqual(r.ours, [], '접기');
            r = await keysOf(() => click(C + 'button[data-sb-x="iso"]')); assert.deepEqual(r.ours, [], '고립 사고 표');
        });

        // ── 3. 브리핑 → 위험예측 지도 = 「위험예측」 묶음 ──
        const popupCellXY = (lonlat) => pg.evaluate((c) => { const m = document.querySelector('[data-sb-map-popup] .sb-minimap'), map = m._sbMap.map, p = ol.proj.fromLonLat([c.lon, c.lat]); map.getView().setCenter(p); map.renderSync(); const px = map.getPixelFromCoordinate(p), r = m.getBoundingClientRect(); return [r.left + px[0], r.top + px[1]]; }, lonlat);
        await check('[위험예측] 「관할 해역 선박 N척」 → risk.ships_map_from_briefing 1건 · 그 지도 칸을 눌러 연 시트 → risk.sheet.sea_from_briefing 1건', async () => {
            let r = await keysOf(() => click(C + '[data-sb-maplink="now-all"]'), () => { const m = document.querySelector('[data-sb-map-popup] .sb-minimap'); return m && m.dataset.sbGrid === 'current' && m.dataset.sbGridN === '1'; });
            assert.deepEqual(r.ours, ['risk.ships_map_from_briefing']);
            const xy = await popupCellXY(IN_CELL);
            r = await keysOf(() => pg.mouse.click(xy[0], xy[1]), () => { const sh = document.querySelector('[data-sb-map-popup] [data-sb-rf-sheet]'); return sh && sh.classList.contains('open'); });
            assert.deepEqual(r.ours, ['risk.sheet.sea_from_briefing']);
            await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); await pg.keyboard.press('Escape');
        });
        // §11.10.38(2026-10-19 사용자 「격자(육지쪽)을 눌러도 바텀시트가 켜지도록」): 칸 안 육지 쪽을 눌러 연 시트도 해상 칸을 누를 때와 같은 1건 · 칸 밖 육지는 0건
        await check('[위험예측] §11.10.38 지도 칸 안 육지 쪽을 눌러 연 시트 → risk.sheet.sea_from_briefing 1건 · 칸 밖 육지 0건', async () => {
            await pg.route('**/api/ocean/land-mask', (rt) => rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rings: [[[126.18, 33.40], [126.2125, 33.40], [126.2125, 33.43], [126.18, 33.43], [126.18, 33.40]]] }) }));
            try {
                let r = await keysOf(() => click(C + '[data-sb-maplink="now-all"]'), () => { const m = document.querySelector('[data-sb-map-popup] .sb-minimap'); return m && m.dataset.sbGrid === 'current' && m.dataset.sbGridN === '1'; });
                assert.deepEqual(r.ours, ['risk.ships_map_from_briefing']); await pg.waitForTimeout(300);
                let xy = await popupCellXY({ lon: 126.19, lat: 33.41 });
                r = await keysOf(() => pg.mouse.click(xy[0], xy[1])); assert.deepEqual(r.ours, [], '칸 밖 육지');
                xy = await popupCellXY({ lon: 126.205, lat: 33.41 });
                r = await keysOf(() => pg.mouse.click(xy[0], xy[1]), () => { const sh = document.querySelector('[data-sb-map-popup] [data-sb-rf-sheet]'); return sh && sh.classList.contains('open'); });
                assert.deepEqual(r.ours, ['risk.sheet.sea_from_briefing'], '칸 안 육지 쪽');
                await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); await pg.keyboard.press('Escape');
            } finally { await pg.unroute('**/api/ocean/land-mask'); await closePopup(); }
        });
        await check('[위험예측] 붐비는 해역 이름 → risk.busiest_map_from_briefing 1건', async () => {
            const r = await keysOf(() => click(C + '[data-sb-maplink="now-busiest"]'), () => !!document.querySelector('[data-sb-map-popup="now-busiest"]'));
            assert.deepEqual(r.ours, ['risk.busiest_map_from_briefing']); await closePopup();
        });
        await check('[위험예측] 연안 근거 관광지 이름 → risk.spot_map_from_briefing 1건 · 저절로 올라오는 첫 시트 0건 · 지도에서 관광지를 눌러 연 시트 → risk.sheet.coast_from_briefing 1건', async () => {
            let r = await keysOf(() => pg.evaluate(() => [...document.querySelectorAll('#station-briefing-content .sb-spotlink')].find((x) => x.textContent === '협재해수욕장').click()),
                () => { const sh = document.querySelector('[data-sb-map-popup] [data-sb-rf-sheet]'); return sh && sh.classList.contains('open') && sh.getAttribute('data-sb-rf-loaded') === 'coast'; });
            assert.deepEqual(r.ours, ['risk.spot_map_from_briefing'], '링크 1건 — 자동 시트는 세지 않는다');
            await pg.keyboard.press('Escape'); await pg.waitForTimeout(450);   // 시트만 내림(창은 그대로)
            const xy = await popupCellXY(SPOT);
            r = await keysOf(() => pg.mouse.click(xy[0], xy[1]), () => { const sh = document.querySelector('[data-sb-map-popup] [data-sb-rf-sheet]'); return sh && sh.classList.contains('open'); });
            assert.deepEqual(r.ours, ['risk.sheet.coast_from_briefing']);
            await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); await pg.keyboard.press('Escape');
        });
        await check('[위험예측] 해상 근거 「위험이 높아진 해역」·「위험예보만」 펼침 지도 → risk.basis_map_from_briefing 각 1건 · 그 칸을 눌러 연 화면 시트 → risk.sheet.sea_from_briefing 1건', async () => {
            // 이 자료의 위험 예측 칸은 한림 관할 상자 밖이라, 관할 상자 요청에만 관할 안 칸 하나를 돌려준다(test_station_briefing_ui.js §11.10.24-UI4 와 같은 방법)
            await pg.route('**/api/risk-forecast/sea/area-frame?*', async (route) => { const u = new URL(route.request().url()); if (u.searchParams.get('mode') !== 'risk') return route.continue();
                const res = await route.fetch(), j = await res.json(); j.cells = j.cells.concat([{ id: IN_CELL.id, lon: IN_CELL.lon, lat: IN_CELL.lat, n: 0.002, level: '주의', color: 0.3 }]); return route.fulfill({ response: res, json: j }); });
            let r = await keysOf(() => click(C + 'button[data-sb-x="map-accidentOnly"]')); assert.deepEqual(r.ours, ['risk.basis_map_from_briefing'], 'accidentOnly');
            r = await keysOf(() => click(C + 'button[data-sb-x="map-accidentOnly"]')); assert.deepEqual(r.ours, [], '접기 0건');
            r = await keysOf(() => click(C + 'button[data-sb-x="map-overview"]'), () => { const p = document.querySelector('[data-sb-x-panel="map-overview"] .sb-minimap'); return p && p.dataset.sbGrid === 'accident' && p.dataset.sbGridN === '1'; });
            assert.deepEqual(r.ours, ['risk.basis_map_from_briefing'], 'overview');
            const xy = await pg.evaluate((c) => { const mm = document.querySelector('[data-sb-x-panel="map-overview"] .sb-minimap'); mm.scrollIntoView({ block: 'center' }); const map = mm._sbMap.map, p = ol.proj.fromLonLat([c.lon, c.lat]); map.renderSync(); const px = map.getPixelFromCoordinate(p), rr = mm.getBoundingClientRect(); return [rr.left + px[0], rr.top + px[1]]; }, IN_CELL);
            r = await keysOf(() => pg.mouse.click(xy[0], xy[1]), () => { const sh = document.querySelector('body > [data-sb-rf-sheet]'); return sh && sh.classList.contains('open'); });
            assert.deepEqual(r.ours, ['risk.sheet.sea_from_briefing']);
            await click(C + 'button[data-sb-x="map-overview"]'); await pg.waitForTimeout(450);
            await pg.unroute('**/api/risk-forecast/sea/area-frame?*');
        });
        await check('[위험예측] 연안 카드 [위험구역] 표 펼침 0건 · [위치 보기](위험예측 위험구역 자료 지도) → risk.hazard_map_from_briefing 1건', async () => {
            let r = await keysOf(() => click(C + '[data-sb-card="land"] button[data-sb-x="land-hazard"]')); assert.deepEqual(r.ours, [], '표 펼침');
            r = await keysOf(() => click(C + '[data-sb-card="land"] button[data-sb-x="land-hazard-map"]')); assert.deepEqual(r.ours, ['risk.hazard_map_from_briefing']);
        });
        await check('[브리핑] 관리자 미리보기처럼 opts.usage 없이 그린 본문의 링크는 0건(사용자 화면만 센다)', async () => {
            const r = await keysOf(() => pg.evaluate(() => {
                const box = document.createElement('div'); document.body.appendChild(box);
                window.StationBriefingRender.render(box, window.StationBriefing._state.resp, { links: false });
                box.querySelector('[data-sb-maplink="haegu"]').click(); const x = document.querySelector('[data-sb-map-popup] [data-sb-map-close]'); if (x) x.click();
                box.querySelector('[data-sb-maplink="now-all"]').click(); const y = document.querySelector('[data-sb-map-popup] [data-sb-map-close]'); if (y) y.click();
                box.remove();
            }));
            assert.deepEqual(r.ours, []);
        });

        // ── 4. [위험예측에서 보기 ›] — 바로가기 1건뿐(이중 집계 없음) ──
        const riskSheetOpen = () => { const s = document.getElementById('risk-forecast-sheet'); return s && s.classList.contains('open'); };
        await check('[이중 집계 없음] 해역 카드 [위험예측에서 보기 ›] → risk.goto_sea_from_briefing 정확히 1건 — 위험예측 켬(risk.on)·해상 스위치(risk.layer.sea)·시트(risk.sheet.sea)는 0건', async () => {
            const r = await keysOf(() => click(C + '[data-sb-card="sea"] .sb-link'), riskSheetOpen);
            assert.deepEqual(r.ours, ['risk.goto_sea_from_briefing']);
            const st = await pg.evaluate(() => ({ on: document.getElementById('ocean-risk-forecast-toggle-btn').classList.contains('active'), sea: window._riskForecastApp.getState().sea }));
            assert.deepEqual(st, { on: true, sea: true }, '위험예측은 실제로 켜졌고 해상 스위치도 켜졌다(세지만 않았다)');
        });
        await check('[이중 집계 없음] 관광지 카드 [위험예측에서 보기 ›] → risk.goto_coast_from_briefing 정확히 1건', async () => {
            await pg.evaluate(() => { const s = document.querySelector('#risk-forecast-sheet .rf-close'); if (s) s.click(); });
            await pg.evaluate(() => { window.switchMainTab('weather-group'); }); await pg.waitForTimeout(500);
            const r = await keysOf(() => click(C + '[data-sb-card="land"] .sb-link'), () => { const s = document.getElementById('risk-forecast-sheet'); return s && s.classList.contains('open') && window._riskForecastApp.getState().selected && window._riskForecastApp.getState().selected.kind === 'coast'; });
            assert.deepEqual(r.ours, ['risk.goto_coast_from_briefing']);
            await pg.evaluate(() => { const s = document.querySelector('#risk-forecast-sheet .rf-close'); if (s) s.click(); }); await pg.waitForTimeout(450);
        });

        // ── 5. 해양안전 [위험예측] 직접 ──
        const btn = '#ocean-risk-forecast-toggle-btn';
        await check('[위험예측] 버튼 끔 0건 · 켬 risk.on 1건', async () => {
            let r = await keysOf(() => click(btn)); assert.deepEqual(r.ours, [], '끔');
            r = await keysOf(() => click(btn), () => window._riskForecastApp.getState().enabled); assert.deepEqual(r.ours, ['risk.on']);
        });
        await check('[위험예측] 스위치 — 해상 끔 0건·켬 risk.layer.sea · 연안 끔 0건·켬 risk.layer.coast · 해상 [혼잡도]·[위험 예측] 고름 각 1건 · 이미 고른 칸 0건', async () => {
            const lay = (k) => '#risk-forecast-legend [data-layer="' + k + '"]';
            let r = await keysOf(() => click(lay('sea'))); assert.deepEqual(r.ours, [], '해상 끔(바로가기로 켜져 있었다)');
            r = await keysOf(() => click(lay('sea'))); assert.deepEqual(r.ours, ['risk.layer.sea']);
            r = await keysOf(() => click(lay('coast'))); assert.deepEqual(r.ours, [], '연안 끔');
            r = await keysOf(() => click(lay('coast'))); assert.deepEqual(r.ours, ['risk.layer.coast']);
            const mode = (m) => click('#risk-forecast-legend [data-marine-mode="' + m + '"]');
            r = await keysOf(() => mode('risk')); assert.deepEqual(r.ours, [], '이미 고른 칸(해상을 켜면 [위험 예측])');
            r = await keysOf(() => mode('congestion')); assert.deepEqual(r.ours, ['risk.marine_mode.congestion']);
            r = await keysOf(() => mode('risk')); assert.deepEqual(r.ours, ['risk.marine_mode.risk']);
            // 다음 사례는 [혼잡도](지금 = 실시간 선박 칸)에서 칸을 누른다 — 이 시험 자료의 공식 사고예보는 3시간 칸이라 지금(10:05) 칠한 칸이 없다
            r = await keysOf(() => mode('congestion')); assert.deepEqual(r.ours, ['risk.marine_mode.congestion']);
        });
        const mainXY = (c) => pg.evaluate((c) => { const map = window.getOceanMap(), p = ol.proj.fromLonLat([c.lon, c.lat]); map.getView().setCenter(p); map.getView().setZoom(12); map.renderSync(); const px = map.getPixelFromCoordinate(p), r = map.getTargetElement().getBoundingClientRect(); return [r.left + px[0], r.top + px[1]]; }, c);
        await check('[위험예측] 지도에서 해상 칸을 눌러 시트 열림 → risk.sheet.sea 1건 · 열린 동안 지도 클릭 0건 · 닫기 0건', async () => {
            await pg.evaluate(() => window._riskForecastApp.synced()); await pg.waitForTimeout(500);
            const xy = await mainXY(CELL); await pg.waitForTimeout(300);
            let r = await keysOf(() => pg.mouse.click(xy[0], xy[1]), riskSheetOpen); assert.deepEqual(r.ours, ['risk.sheet.sea']);
            r = await keysOf(() => pg.mouse.click(xy[0], xy[1])); assert.deepEqual(r.ours, [], '열린 동안 지도 클릭은 무시(T24)');
            r = await keysOf(() => click('#risk-forecast-sheet .rf-close')); assert.deepEqual(r.ours, []); await pg.waitForTimeout(450);
        });
        await check('[위험예측] 지도에서 연안 관광지를 눌러 시트 열림 → risk.sheet.coast 1건', async () => {
            const xy = await mainXY(SPOT); await pg.waitForTimeout(300);
            const r = await keysOf(() => pg.mouse.click(xy[0], xy[1]), riskSheetOpen); assert.deepEqual(r.ours, ['risk.sheet.coast']);
            await click('#risk-forecast-sheet .rf-close'); await pg.waitForTimeout(450);
        });
        await check('보낸 키는 모두 이름표가 있고, briefing.* = 「연안 안전 브리핑 · 」 · risk.* = 「위험예측 · 」 묶음', async () => {
            const ours = [...new Set(sent.filter((k) => OURS.test(k)))];
            assert.ok(ours.length >= 18, '이 시험이 보낸 두 묶음 키 ' + ours.length + '개');
            ours.forEach((k) => { assert.ok(LABELS[k], '이름표 없음: ' + k); assert.ok((/^briefing\./.test(k) ? /^연안 안전 브리핑 · / : /^위험예측 · /).test(LABELS[k]), k + ' → ' + LABELS[k]); });
        });

        // ── 6. 관리자 화면(종합 통계 > 사용량 통계) 사진 — 이 시험이 받은 건수를 그대로 그려 두 묶음 이름표가 보이는지 눈으로 확인(판정 아님) ──
        if (SHOT) {
            const byFeature = {}; sent.filter((k) => OURS.test(k)).forEach((k) => { byFeature[k] = (byFeature[k] || 0) + 1; });
            const total = Object.values(byFeature).reduce((a, b) => a + b, 0);
            const page2 = await ctx.newPage(); await page2.setViewportSize({ width: 412, height: 1400 });
            await page2.route('**/api/stats/usage?*', (route) => route.fulfill({ json: { period: 'daily', start: '2026-10-17', end: '2026-10-17', affiliation: '전체', affiliationOrder: ['소속 미정'], trend: [{ bucket: '2026-10-17', total }], trendByFeature: {}, byAffiliation: { '소속 미정': total }, affiliationDistribution: [{ name: '소속 미정', total }], byFeature, totalEvents: total, topFeature: { key: 'briefing.open', count: byFeature['briefing.open'] }, deviceCount: 1, assignedDeviceCount: 0, unassignedDeviceCount: 1 } }));
            await page2.route('**/*', (r) => r.request().url().startsWith(base) ? r.fallback() : r.abort());
            await page2.goto(base + '/'); await page2.waitForFunction(() => typeof window.renderUsageStatsContent === 'function' || typeof renderUsageStatsContent === 'function', null, { timeout: 10000 });
            await page2.evaluate(async () => { [...document.body.children].forEach((e) => { e.style.display = 'none'; }); const h = document.createElement('div'); h.id = 'usage-host'; h.style.cssText = 'width:412px;box-sizing:border-box;padding:8px;background:#0c1120'; document.body.appendChild(h); document.body.style.overflow = 'auto'; await renderUsageStatsContent(h); });
            await page2.waitForFunction(() => document.getElementById('usage-dashboard') && document.getElementById('usage-dashboard').style.display !== 'none', null, { timeout: 10000 }).catch(() => {});
            await page2.waitForTimeout(1200);
            const card = await page2.$('#usage-feature-card'); if (card) { await card.scrollIntoViewIfNeeded(); await card.screenshot({ path: path.join(SHOT, 'usage_admin_feature.png') }); }
            // 넓은 화면(PC·가로보기) — 이름표가 잘리지 않고 두 묶음 앞말이 다 보인다
            await page2.setViewportSize({ width: 1100, height: 1400 }); await page2.evaluate(async () => { const h = document.getElementById('usage-host'); h.style.width = '1000px'; await renderUsageStatsContent(h); });
            await page2.waitForTimeout(1500);
            const wide = await page2.$('#usage-feature-card'); if (wide) { await wide.scrollIntoViewIfNeeded(); await wide.screenshot({ path: path.join(SHOT, 'usage_admin_feature_wide.png') }); }
            await page2.close();
        }
        await check('실행 오류 없음', async () => { assert.deepEqual(errors, []); });
    } catch (e) { console.error('❌ 준비 실패', e && e.stack); fail++; }
    finally { if (browser) await browser.close(); if (server) server.close(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 임시 폴더 */ } }
    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();
