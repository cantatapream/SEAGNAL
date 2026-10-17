/**
 * 역할: 소해구 예보 수집 서비스(services/smallzone_forecast.js)와 그 API(routes/weather.js GET /api/marine-small-zone-forecasts/:lzone)를
 *       가짜 fetch 로 검사한다 — 40개 나눔·26시각·-999→null·재시도·일부 실패 상태·같은 대해구 동시 요청 합침·판 바뀌면 비움·상한 100·
 *       브리핑 목록에 브리핑 칸 대해구(risk_sea_cells.describe 가 고르는 major) 포함·인증키가 응답/로그/파일에 안 나옴.
 *       (설계서 client/js/ocean-map/coastal-risk/coastal_safety_forecast.design.md §11.10.18)
 * [연계] services/smallzone_forecast.js · services/risk_sea_cells.js(브리핑 칸 대해구 고르기) · routes/weather.js(scheduler 는 가짜로 끼운다 —
 *        진짜 scheduler.js 는 require 하면 수집이 시작된다). 외부 API 호출 없음, 임시 폴더만 쓴다.
 * [로드 순서] 시험 스크립트 — node local_server/scripts/test_smallzone_forecast.js · verify_all.sh SUITES
 */
'use strict';
const fs = require('fs'),
    os = require('os'),
    path = require('path'),
    zlib = require('zlib'),
    http = require('http'),
    assert = require('assert');
const S = require('../services/smallzone_forecast');
const G = require('../services/risk_geo');

let pass = 0, fail = 0;
async function check(name, fn) {
    try { await fn(); pass++; console.log('✅', name); } catch (e) { fail++; console.error('❌', name, e.message); }
}

const KEY = 'TESTKEY_zz9QxYw7';   // 가짜 키 — 이 글자가 어디에도 새지 않는지 본다
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smallzone-'));
const BASE = '2026103112';        // 달이 바뀌는 판(10-31 12UTC → 11-03 15UTC)

// ── 가짜 기상청 응답 ──────────────────────────────────────────────────────────
const HEAD = '#START7777\n#   1. TMA_FC    : 발표시각(UTC)\n#   2. TMA_EF    : 발효시각(UTC)\n' +
    '#   TMA_FC     TMA_EF LZONE SZONE   LAT_LB    LON_LB    LAT_LT    LON_LT    LAT_RT    LON_RT    LAT_RB    LON_RB       WH_SIG     WVPRD_MAX          WVDR            WS            WD            VS          RAIN            TW         SWELL\n' +
    '#      UTC        UTC                  deg       deg       deg       deg       deg       deg       deg       deg            m           sec        degree           m/s        degree             m            mm            ℃\n';
/** 대해구 z·소해구 s·시각 tm 의 값(검사가 다시 계산해 맞춰 본다). 소해구 1 은 육지처럼 전부 -999. */
function val(z, s, tm) { return s === 1 ? null : +((+z % 7) + s / 10 + (+tm.slice(8) / 100)).toFixed(2); }
function table(fc, ef, lzones) {
    let t = HEAD;
    for (const z of lzones) {
        if (z === '9999') continue;   // 없는 대해구는 줄만 빠진다(실측과 같음)
        for (let s = 1; s <= 9; s++) {
            const v = val(z, s, ef), f = (x) => (x == null ? '-999.0' : String(x));
            t += `${fc} ${ef} ${z.padStart(5)} ${String(s).padStart(5)}   33.333   126.500    33.500   126.500    33.500   126.667    33.333   126.667 ${f(v)} ${f(v == null ? null : v + 4)} ${f(v == null ? null : 90 + s)} ${f(v == null ? null : v * 2)} ${f(v == null ? null : 180 + s)} -999.0 0.0 24.5 -999\n`;
        }
    }
    return t + '#7777END\n';
}
let calls = [];
let rule = () => null;   // (q, attempt) → null(정상) | 'reset' | 'notable' | 'http500'
const attempts = new Map();
const logs = [];
async function fakeFetch(url) {
    const u = new URL(url), q = Object.fromEntries(u.searchParams);
    const k = q.tma_ef + '|' + q.Lzone;
    const n = (attempts.get(k) || 0) + 1;
    attempts.set(k, n);
    calls.push(q);
    await new Promise((r) => setImmediate(r));
    const r = rule(q, n);
    // Node fetch 오류처럼 요청 주소가 글에 섞여 나오는 경우도 흉내 낸다 — mask 가 가려야 한다.
    if (r === 'reset') { const e = new TypeError('fetch failed ' + url); e.cause = new Error('read ECONNRESET ' + url); throw e; }
    const body = r === 'notable' ? '해구번호를 확인하여 주시기 바랍니다.\n#7777END\n' : table(q.tma_fc, q.tma_ef, q.Lzone.split(','));
    return { ok: r !== 'http500', status: r === 'http500' ? 500 : 200, arrayBuffer: async () => Buffer.from(body, 'utf8') };
}
function fresh() {   // 메모리·임시 폴더를 비운다(디스크 판이 남아 있으면 다음 시험의 prefetch 가 「이미 받음」으로 건너뛴다)
    for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f));
    S._reset();
    S.configure({ fetchImpl: fakeFetch, getKey: () => KEY, dataDir: dir, wait: async () => { } });
    calls = []; attempts.clear(); rule = () => null;
}
const origLog = console.log, origErr = console.error, origWarn = console.warn;
function capture() { console.error = (...a) => logs.push(a.join(' ')); console.warn = console.error; console.log = (...a) => { logs.push(a.join(' ')); }; }
function release() { console.log = origLog; console.error = origErr; console.warn = origWarn; }
const zones = (n, from = 1) => Array.from({ length: n }, (_, i) => String(from + i));

(async () => {
    try {
        await check('표 읽기: 머리줄(설명 줄 섞여도)·-999 → null·대해구 행과 같은 필드 이름', () => {
            const rows = S.parseTable(table('2026101700', '2026101703', ['233']));
            assert.equal(rows.length, 9);
            assert.deepEqual(Object.keys(rows[0]), ['lzone', 'szone', 'tm', 'wh', 'wp', 'waveDir', 'ws', 'windDir']);
            assert.deepEqual(rows[0], { lzone: '233', szone: '1', tm: '2026101703', wh: null, wp: null, waveDir: null, ws: null, windDir: null }, '육지 소해구 -999 → null');
            const r5 = rows[4];
            assert.equal(r5.szone, '5'); assert.equal(r5.wh, val('233', 5, '2026101703')); assert.equal(r5.waveDir, 95); assert.equal(r5.windDir, 185);
            assert.equal(S.parseTable('해구번호를 확인하여 주시기 바랍니다.\n#7777END'), null, '판이 아직 없을 때 — 실패로 본다');
        });
        await check('발효시각 26개(+0~75시간 3시간, 달 바뀜)', () => {
            const t = S.efTimes(BASE);
            assert.equal(t.length, 26); assert.equal(t[0], BASE); assert.equal(t[1], '2026103115'); assert.equal(t[25], '2026110315');
        });

        fresh(); capture();
        const LZ = zones(85, 100);   // 85개 → 40·40·5 세 묶음
        const r1 = await S.prefetch(LZ, BASE);
        release();
        await check('미리 받기: 40개씩 나눔 × 26시각 = 78 요청 · 발표시각 같음 · 값 그대로', () => {
            assert.equal(r1.requests, 78); assert.equal(calls.length, 78); assert.equal(r1.failed, 0);
            assert.ok(calls.every((q) => q.Lzone.split(',').length <= 40 && q.tma_fc === BASE && q.Szone === '0' && q.help === '0'));
            assert.deepEqual([...new Set(calls.map((q) => q.Lzone.split(',').length))].sort((a, b) => a - b), [5, 40]);
            assert.deepEqual([...new Set(calls.map((q) => q.tma_ef))].sort(), S.efTimes(BASE));
            const st = S.getStatus();
            assert.equal(st.baseTm, BASE); assert.equal(st.lzones, 85); assert.equal(st.withData, 85); assert.equal(st.missingTimes, 0);
        });
        await check('미리 받은 판은 디스크(gzip)에 남고 상태 한 줄이 써진다', async () => {
            const obj = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'smallzone_forecast.json.gz'))).toString('utf8'));
            assert.equal(obj.baseTm, BASE); assert.equal(Object.keys(obj.data).length, 85);
            assert.equal(obj.data['120']['5'].length, 26); assert.equal(obj.data['120']['5'][3].ws, val('120', 5, S.efTimes(BASE)[3]) * 2);
            assert.equal(obj.data['120']['1'][0].wh, null);
            assert.deepEqual(obj.data['120']['5'].map((x) => x.tm), S.efTimes(BASE), '시각 순서');
            const status = JSON.parse(fs.readFileSync(path.join(dir, 'smallzone_forecast_status.json'), 'utf8'));
            assert.ok(/2026103112 판 · 대해구 85개/.test(status.message), status.message);
            // 재시작: 메모리를 비우고 디스크에서 다시 읽는다 — 요청 없이 같은 판을 준다
            S._reset(); S.configure({ fetchImpl: fakeFetch, getKey: () => KEY, dataDir: dir, wait: async () => { } }); calls = [];
            const g = await S.get('120', BASE);
            assert.equal(calls.length, 0); assert.equal(g.data['5'].length, 26);
        });
        await check('같은 판·같은 목록을 빠짐없이 받았으면 다시 요청하지 않는다', async () => {
            calls = [];
            const r = await S.prefetch(LZ, BASE);
            assert.equal(r.skipped, true); assert.equal(calls.length, 0);
        });

        fresh(); capture();
        rule = (q, n) => (q.tma_ef === '2026103115' && n <= 2 ? 'reset' : null);   // 두 번 끊기고 세 번째에 됨
        const r2 = await S.prefetch(zones(3, 200), BASE);
        release();
        await check('재시도: 요청마다 최대 2번 더 — 두 번 끊겨도 세 번째에 받으면 실패 아님', () => {
            assert.equal(r2.failed, 0); assert.equal(calls.filter((q) => q.tma_ef === '2026103115').length, 3); assert.equal(calls.length, 28);
        });

        fresh(); capture();
        rule = (q) => (q.tma_ef === '2026110109' ? 'reset' : q.tma_ef === '2026110112' ? 'notable' : q.tma_ef === '2026110115' ? 'http500' : null);
        const r3 = await S.prefetch(zones(3, 200), BASE);
        release();
        await check('끝내 실패한 시각은 비워 두고 상태에 몇 개 빠졌는지 남긴다', async () => {
            assert.equal(r3.failed, 3); assert.deepEqual(r3.missingTimes, ['2026110109', '2026110112', '2026110115']);
            assert.equal(calls.length, 26 + 3 * 2, '실패 시각마다 3번(처음 + 2번 더)');
            const st = S.getStatus();
            assert.equal(st.missingTimes, 3); assert.equal(st.failed, 3); assert.ok(st.lastError && /3번 실패/.test(st.lastError.message), JSON.stringify(st.lastError));
            const g = await S.get('201', BASE);
            assert.equal(g.data['5'].length, 23); assert.ok(!g.data['5'].some((x) => x.tm === '2026110109'));
            const status = JSON.parse(fs.readFileSync(path.join(dir, 'smallzone_forecast_status.json'), 'utf8'));
            assert.ok(/^일부 실패: .*요청 26번 중 실패 3 · 빠진 발효시각 3개/.test(status.message), status.message);
            calls = []; rule = () => null;
            const again = await S.prefetch(zones(3, 200), BASE);
            assert.equal(again.skipped, false, '빠진 판은 다음 수집 때 다시 받는다'); assert.equal(calls.length, 26); assert.equal(S.getStatus().missingTimes, 0);
        });
        await check('모두 실패하면 저장된 판을 그대로 둔다', async () => {
            const before = fs.readFileSync(path.join(dir, 'smallzone_forecast.json.gz'));
            calls = []; rule = () => 'reset'; capture();
            const r = await S.prefetch(zones(2, 300), '2026110100');
            release();
            assert.equal(r.failed, 26); assert.equal(r.ok, false);
            assert.ok(before.equals(fs.readFileSync(path.join(dir, 'smallzone_forecast.json.gz'))));
            assert.equal(S.getStatus().baseTm, BASE);
            const status = JSON.parse(fs.readFileSync(path.join(dir, 'smallzone_forecast_status.json'), 'utf8'));
            assert.ok(/^실패: 2026110100 판 요청 26번 모두 실패/.test(status.message), status.message);
            assert.ok(status.message.includes('저장된 2026103112 판 유지'));
        });

        fresh();
        await S.prefetch(['233'], BASE);
        await check('창 클릭: 브리핑용 판에 있으면 요청 없음 · 없으면 26 요청 · 같은 대해구 동시 요청은 하나로 · 두 번째부터 캐시', async () => {
            calls = [];
            const a = await S.get('233', BASE);
            assert.equal(calls.length, 0); assert.equal(a.data['5'].length, 26);
            const [x, y, z] = await Promise.all([S.get('77', BASE), S.get('77', BASE), S.get('77', BASE)]);
            assert.equal(calls.length, 26, '동시 세 번 → 요청은 한 벌'); assert.equal(x, y); assert.equal(y, z);
            assert.ok(calls.every((q) => q.Lzone === '77'));
            calls = [];
            await S.get('77', BASE);
            assert.equal(calls.length, 0); assert.equal(S.getStatus().click.cached, 1);
            assert.equal(await S.get('9999', BASE), null, '응답에 줄이 없는 대해구 → null');
        });
        await check('판이 바뀌면 창 클릭용 캐시를 비우고 새 판으로 받는다(브리핑용 판은 옛 판이면 쓰지 않는다)', async () => {
            calls = [];
            const g = await S.get('77', '2026110100');
            assert.equal(calls.length, 26); assert.ok(calls.every((q) => q.tma_fc === '2026110100'));
            assert.equal(g.baseTm, '2026110100'); assert.equal(S.getStatus().click.cached, 1); assert.equal(S.getStatus().click.baseTm, '2026110100');
            calls = [];
            await S.get('233', '2026110100');
            assert.equal(calls.length, 26, '브리핑용 판(2026103112)은 판이 달라 쓰지 않는다');
        });
        await check('창 클릭용 상한 100 — 오래 안 쓴 것부터 버림 · 브리핑용 판은 세지 않음', async () => {
            fresh();
            await S.prefetch(['500'], BASE);
            for (const z of zones(101, 1000)) await S.get(z, BASE);   // 1000…1100
            assert.equal(S.getStatus().click.cached, 100);
            calls = [];
            await S.get('1001', BASE); assert.equal(calls.length, 0, '최근 쓴 것은 남음');
            await S.get('1000', BASE); assert.equal(calls.length, 26, '가장 오래 안 쓴 1000 은 버려졌다');
            calls = [];
            await S.get('500', BASE); assert.equal(calls.length, 0, '브리핑용은 상한과 무관');
            assert.equal(S.getStatus().click.cached, 100);
        });
        await check('시각 일부가 빠진 클릭 결과는 주되 캐시에 넣지 않는다 · 모두 실패하면 던진다', async () => {
            fresh(); capture();
            rule = (q) => (q.tma_ef === BASE ? 'notable' : null);
            const g = await S.get('42', BASE);
            assert.deepEqual(g.missingTimes, [BASE]); assert.equal(S.getStatus().click.cached, 0);
            rule = () => 'reset';
            let err = null;
            try { await S.get('43', BASE); } catch (e) { err = e; }
            release();
            assert.ok(err, '던져야 한다'); assert.ok(!err.message.includes(KEY)); assert.ok(!/authKey=(?!\*\*\*)/.test(err.message), err.message);
        });

        // ── API(routes/weather.js) — scheduler·freshness 는 가짜로 끼운다 ──
        const cm = require('../services/cache_manager');
        require.cache[require.resolve('../scheduler')] = { id: 'scheduler', loaded: true, exports: { getStatus: () => ({}), collectProgress: { on() { }, off() { } } } };
        const router = require('../routes/weather');
        const express = require('express');
        const app = express(); app.use(router);
        const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
        const getJson = (p) => new Promise((resolve, reject) => http.get('http://127.0.0.1:' + server.address().port + p, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b, cc: res.headers['cache-control'] })); }).on('error', reject));
        try {
            await check('API: 대해구 판에 맞춰 소해구 9칸을 준다 · 키 없음 · 없음 404 · 실패 502 · 준비 전 404(한국어 message)', async () => {
                fresh();
                const saved = cm.dataCache.zoneForecasts;
                cm.dataCache.zoneForecasts = null;
                let r = await getJson('/api/marine-small-zone-forecasts/233');
                assert.equal(r.status, 404); assert.ok(/준비되지/.test(JSON.parse(r.body).message));
                cm.dataCache.zoneForecasts = { baseTmUtf: BASE, data: {} };
                r = await getJson('/api/marine-small-zone-forecasts/233');
                assert.equal(r.status, 200);
                const j = JSON.parse(r.body);
                assert.equal(j.baseTmUtf, BASE); assert.equal(j.lzone, '233'); assert.deepEqual(Object.keys(j.data).sort(), ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
                assert.equal(j.data['1'][0].ws, null); assert.equal(j.data['5'].length, 26); assert.equal(r.cc, 'public, max-age=1800');
                assert.ok(!r.body.includes(KEY));
                r = await getJson('/api/marine-small-zone-forecasts/9999');
                assert.equal(r.status, 404); assert.ok(/소해구 예보가 없습니다/.test(JSON.parse(r.body).message));
                r = await getJson('/api/marine-small-zone-forecasts/abc');
                assert.equal(r.status, 404);
                rule = () => 'reset'; capture();
                r = await getJson('/api/marine-small-zone-forecasts/234');
                release();
                assert.equal(r.status, 502); assert.equal(JSON.parse(r.body).message, '기상청 소해구 예보를 받지 못했습니다.'); assert.equal(r.cc, 'no-store');
                assert.ok(!r.body.includes(KEY));
                cm.dataCache.zoneForecasts = saved;
            });
        } finally { await new Promise((r) => server.close(r)); }

        await check('인증키가 로그·상태·저장 파일 어디에도 없다(요청 주소가 섞인 오류 글도 가림)', () => {
            assert.ok(logs.length > 5, '로그가 실제로 찍혔어야 의미가 있다');
            for (const l of logs) assert.ok(!l.includes(KEY) && !/authKey=(?!\*\*\*)/.test(l), l);
            assert.ok(!JSON.stringify(S.getStatus()).includes(KEY));
            for (const f of fs.readdirSync(dir)) {
                const b = fs.readFileSync(path.join(dir, f));
                const t = f.endsWith('.gz') ? zlib.gunzipSync(b).toString('utf8') : b.toString('utf8');
                assert.ok(!t.includes(KEY), f);
            }
            assert.equal(S.mask('x https://apihub.kma.go.kr/api/typ06/url/marine_small_zone.php?a=1&authKey=' + KEY + '&b=2 y'), 'x (기상청 API허브 주소) y');
        });

        await check('브리핑용 대해구 목록: 관할 칸이 고르는 대해구(risk_sea_cells.describe)가 빠짐없이 든다', () => {
            S._reset();
            const D = require('../services/risk_sea_cells');
            const list = new Set(S.briefingLzones());
            assert.ok(list.size >= 40 && list.size <= 80, '목록 크기 ' + list.size + ' — 40개 묶음 두 개(요청 52번) 안');
            const st = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'coastal_safety', 'coastguard_stations.geojson'), 'utf8')).features.filter((f) => f.geometry && /Polygon/.test(f.geometry.type));
            const pts = [];
            for (const f of st) {
                const a = f.geometry.coordinates.flat(Infinity), xs = a.filter((_, i) => i % 2 === 0), ys = a.filter((_, i) => i % 2 === 1);
                for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.06) for (let y = Math.min(...ys); y <= Math.max(...ys); y += 0.06) if (G.pointInGeometry([x, y], f.geometry)) pts.push([x, y]);
                const rings = f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat(1);
                rings.forEach((ring) => ring.forEach((p, i) => { if (i % 8 === 0) pts.push(p); }));   // 관할 경계 위 점(가장자리 칸)
            }
            // 칸 중심이 관할 안 점 p 인 혼잡 칸(±0.0125°) + p 를 모서리 근처에 품는 사고 칸(약 0.045°×0.038°)
            const HX = 0.0225, HY = 0.019, miss = new Set();
            let n = 0;
            for (const p of pts) {
                const rects = [[p[0] - 0.0125, p[1] - 0.0125, p[0] + 0.0125, p[1] + 0.0125]];
                for (const sx of [-1, 1]) for (const sy of [-1, 1]) { const cx = p[0] + sx * HX * 0.95, cy = p[1] + sy * HY * 0.95; rects.push([cx - HX, cy - HY, cx + HX, cy + HY]); }
                for (const r of rects) {
                    const d = D.describe({ gridId: 't', latitude: (r[1] + r[3]) / 2, longitude: (r[0] + r[2]) / 2 }, { bounds: r });
                    n++;
                    if (d.haegu && !list.has(String(d.haegu.major))) miss.add(d.haegu.major);
                }
            }
            console.log('   (관할 표본점 ' + pts.length + '개 · 칸 ' + n + '개 · 목록 ' + list.size + '개)');
            assert.ok(pts.length > 1000);
            assert.deepEqual([...miss], [], '빠진 대해구');
        });
        await check('scheduler: 대해구 판 저장 직후 같은 판으로 미리 받기(기다리지 않음) · 상태 한 줄 · 키는 configure 로만', () => {
            const src = fs.readFileSync(path.join(__dirname, '..', 'scheduler.js'), 'utf8');
            const save = src.indexOf("saveData('zone_forecasts.json', { updatedAt: getNowStr(), baseTmUtf: validBaseTm");
            const call = src.indexOf('smallZoneForecast.prefetch(smallZoneForecast.briefingLzones(), validBaseTm)');
            assert.ok(save > 0 && call > save && call - save < 2500, '저장 바로 뒤');
            assert.ok(!/await\s+[^;]*smallZoneForecast\.prefetch/.test(src), '기다리지 않는다');
            assert.ok(src.includes('smallZoneForecast.configure({ getKey: () => CONFIG.KMA_HUB_KEY })'));
            assert.ok(src.includes("smallZone: { lastRun: null, status: '대기 중'"));
            const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'data_collection_manifest.json'), 'utf8')).items.find((i) => i.id === 'smallZoneForecasts');
            assert.ok(m, '관리자 데이터 수집현황 목록에 한 줄');
            assert.equal(m.state.statusFile, 'smallzone_forecast_status.json'); assert.equal(m.state.scheduler, 'smallZone'); assert.equal(m.state.file, 'smallzone_forecast.json.gz');
        });
    } catch (e) {
        release();
        fail++; console.error('❌ 실행 실패', e && e.stack);
    } finally {
        release();
        fs.rmSync(dir, { recursive: true, force: true });
        console.log(`${pass} PASS / ${fail} FAIL`);
        process.exitCode = fail ? 1 : 0;
        setTimeout(() => process.exit(process.exitCode), 50).unref();
    }
})();
