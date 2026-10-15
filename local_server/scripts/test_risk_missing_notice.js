/** 역할: 과제4 — 행사·특보가 '없음(정상)'이면 자료없음 문구가 없고, '받지 못함(모름)'이면 구분돼 드러나는지 검사한다.
 * 실제 risk_store 가 임시 자료로 만든 상세 응답을 실제 RiskSheet(Chromium)에 그대로 넣고, 같은 원천 상태를 관리자 오류이력에도 넣는다.
 * [연계] risk_store.coastDetail/seaDetail/frame · risk_sheet.js · risk_error_history. 과제16(공통 배너·원천 경고 숨김)은 되살리지 않는다.
 */
'use strict';
const fs = require('fs'),
    os = require('os'),
    path = require('path'),
    assert = require('assert'),
    { chromium } = require('playwright-core');
const io = require('../services/risk_collector_io'),
    { createStore } = require('../services/risk_store'),
    { createHistory } = require('../services/risk_error_history');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'risk-missing-notice-'));
let seq = 0,
    pass = 0,
    fail = 0;
const T = (s) => Date.parse(s);
/** 모든 원천이 정상이고 행사·특보가 '없는' 임시 자료를 만든다. 예: make('2026-10-31T12:17:00+09:00') → {store,dir,dataDir,iso}
 * @param {string} nowIso - 가짜 현재 시각 @param {object} [opt] - rip: 이안류 places @returns {object} [연계] 모든 검사의 출발점 */
function make(nowIso, opt = {}) {
    const base = path.join(root, 'c' + ++seq),
        dataDir = path.join(base, 'data'),
        dir = path.join(base, 'risk'),
        configDir = path.join(base, 'config'),
        clientDir = path.join(base, 'client');
    const now = T(nowIso),
        iso = new Date(now).toISOString(),
        w = (b, f, v) => io.write(path.join(b, f), v);
    const day = nowIso.slice(0, 10),
        month = nowIso.slice(0, 7),
        mm = month.replace('-', ''),
        next = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 1)).toISOString().slice(0, 7);
    w(configDir, 'risk_spots.json', {
        _about: { hash: 'm' },
        spots: [
            {
                id: 'one', name: '관광지', lat: 35, lon: 129, sgg_name: '부산광역시 중구', major: 92,
                warnZone: '부산앞바다', galeZone: null, beach: true, station: null, coastCell: '92-1',
                ripBeach: '해변', hazard: { count: 0, zones: [] }, geometry: { type: 'Polygon', coordinates: [] },
            },
        ],
    });
    w(clientDir, 'assets/warn_zones.geojson', { features: [] });
    w(clientDir, 'assets/warn_zones_land_coastal.geojson', { features: [] });
    w(dataDir, 'weather_alerts.json', { updatedAt: iso, current: {} }); // 특보 없음(정상)
    w(dataDir, 'gale_warnings.json', { savedAt: iso, count: 0, rows: [] }); // 강풍 없음(정상)
    w(dir, 'gale_status.json', { checkedAt: iso });
    const rows = [];
    for (let h = -9; h <= 24 * 3; h += 3) {
        const d = new Date(T(day + 'T00:00:00Z') + h * 3600000).toISOString();
        rows.push({ tm: d.slice(0, 4) + d.slice(5, 7) + d.slice(8, 10) + d.slice(11, 13), wh: 1, ws: 3 });
    }
    w(dataDir, 'zone_forecasts.json', { updatedAt: iso, data: { 92: rows } });
    w(dataDir, 'swell_smallzone.json.gz', {
        updatedAt: iso,
        fctTimes: [day.replace(/-/g, '.') + ' 15:00'],
        cells: { '92-1': { wp: [8] } },
    });
    w(dataDir, 'ripcurrent_index.json', { updatedAt: iso, places: opt.rip || {} });
    // U81(2026-10-15): 사람 혼잡은 30일 기하평균(avg30)이 있어야 결측이 아니다 — 정상 파일에는 함께 둔다.
    w(dir, 'tour_concentration.json', { date: day, collectedAt: iso, values: { one: { [day]: 10 } }, avg30: { one: { gm: 10, days: 30 } } });
    w(dir, 'events_' + mm + '.json', { month, collectedAt: iso, events: [] }); // 행사 없음(정상)
    w(dir, 'events_' + next.replace('-', '') + '.json', { month: next, collectedAt: iso, events: [] });
    const store = createStore({ dir, dataDir, configDir, clientDir, clock: () => now });
    return { store, dir, dataDir, iso, w, month, next };
}
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
const OCT = '2026-10-31T12:17:00+09:00',
    AT = '2026-10-31T15:00:00+09:00',
    NEXT_DAY = '2026-11-01T12:00:00+09:00';
const rm = (f) => fs.rmSync(f, { force: true });
(async () => {
    // ── 1. 정상 없음 ────────────────────────────────────────────────
    await test('행사·특보·강풍이 모두 없으면(자료는 정상) missing·degraded 가 비어 있다 — 이안류 비수기 포함', () => {
        const c = make(OCT),
            r = c.store.coastDetail('one', AT);
        assert.deepEqual(r.missing, []);
        assert.equal(r.rows.some((x) => x.key === 'event'), false);
        assert.deepEqual(r.notices, []);
        assert.equal(c.store.sources().ripCurrent.status, 'offseason');
        assert.deepEqual(c.store.frame(false, AT).degraded, []);
        assert.equal(c.store.sources().events.months['2026-10'].status, 'ok');
    });
    await test('해상 칸도 특보가 없으면 warnings 결측이 아니다', () => {
        const c = make(OCT);
        c.w(c.dir, 'sea_cells.json', { v: 1, cells: [{ i: 0, id: 'a', haegu: { major: 92, sub: 1 }, warnZone: '부산앞바다', warnSubZone: null }] });
        c.store.invalidate();
        assert.equal(c.store.seaDetail('a', AT).missing.includes('warnings'), false);
    });
    // ── 2. 이안류 비수기 vs 성수기 ───────────────────────────────────
    await test('이안류 성수기에 오늘 관측이 없으면 rip 결측은 그대로 드러난다(비수기만 제외)', () => {
        const c = make('2026-07-15T12:17:00+09:00', { rip: { 해변: { hasData: false } } });
        assert.notEqual(c.store.sources().ripCurrent.status, 'offseason');
        assert.ok(c.store.coastDetail('one', '2026-07-15T15:00:00+09:00').missing.includes('rip'));
    });
    // ── 3. 행사 실패 ────────────────────────────────────────────────
    await test('행사 파일을 못 받으면(missing·error·손상) events 결측 + 행 자료 없음 + 점수 0', () => {
        for (const how of ['absent', 'error', 'corrupt']) {
            const c = make(OCT);
            if (how === 'absent') rm(path.join(c.dir, 'events_202610.json'));
            if (how === 'error') c.w(c.dir, 'events_202610_status.json', { status: 'error', month: '2026-10', lastError: 'HTTP 500' });
            if (how === 'corrupt') fs.writeFileSync(path.join(c.dir, 'events_202610.json'), '{bad');
            c.store.invalidate();
            const r = c.store.coastDetail('one', AT),
                row = r.rows.find((x) => x.key === 'event');
            assert.ok(r.missing.includes('events'), how);
            assert.ok(row && row.missing === true && row.score === 0, how);
            assert.ok(c.store.frame(false, AT).degraded.includes('events'), how);
        }
    });
    // ── 4. 특보 실패 ────────────────────────────────────────────────
    await test('특보를 못 받으면(없음·손상·20분 낡음) warnings 결측이고 events 는 건드리지 않는다', () => {
        for (const how of ['absent', 'corrupt', 'stale']) {
            const c = make(OCT);
            if (how === 'absent') rm(path.join(c.dataDir, 'weather_alerts.json'));
            if (how === 'corrupt') fs.writeFileSync(path.join(c.dataDir, 'weather_alerts.json'), '{bad');
            if (how === 'stale') c.w(c.dataDir, 'weather_alerts.json', { updatedAt: new Date(T(OCT) - 20 * 60000).toISOString(), current: {} });
            c.store.invalidate();
            const r = c.store.coastDetail('one', AT);
            assert.ok(r.missing.includes('warnings'), how);
            assert.equal(r.missing.includes('events'), false, how);
            assert.ok(c.store.frame(false, AT).degraded.includes('warnings'), how);
        }
    });
    await test('해상 칸도 특보 수집 실패는 warnings 결측으로 드러난다', () => {
        const c = make(OCT);
        c.w(c.dir, 'sea_cells.json', { v: 1, cells: [{ i: 0, id: 'a', haegu: { major: 92, sub: 1 }, warnZone: '부산앞바다', warnSubZone: null }] });
        rm(path.join(c.dataDir, 'weather_alerts.json'));
        c.store.invalidate();
        assert.ok(c.store.seaDetail('a', AT).missing.includes('warnings'));
    });
    // ── 5. 일부 실패 ────────────────────────────────────────────────
    await test('일부만 실패하면 실패한 원천만 결측이다(정상 없음과 섞이지 않음)', () => {
        const a = make(OCT);
        rm(path.join(a.dataDir, 'weather_alerts.json'));
        a.store.invalidate();
        const ra = a.store.coastDetail('one', AT);
        assert.deepEqual(ra.missing, ['warnings']);
        const b = make(OCT);
        b.w(b.dir, 'events_202610_status.json', { status: 'error', month: '2026-10', lastError: 'HTTP 500' });
        b.store.invalidate();
        assert.deepEqual(b.store.coastDetail('one', AT).missing, ['events']);
        const g = make(OCT);
        rm(path.join(g.dataDir, 'gale_warnings.json'));
        g.store.invalidate();
        assert.deepEqual(g.store.coastDetail('one', AT).missing, ['gale']);
    });
    // ── 6. 행사 월 경계 ─────────────────────────────────────────────
    await test('월말: 다음 달 행사가 없음(정상)이면 11월 날짜도 events 결측이 아니다', () => {
        const c = make(OCT),
            r = c.store.coastDetail('one', NEXT_DAY);
        assert.equal(r.missing.includes('events'), false);
        assert.equal(r.missing.includes('warnings'), false);
        assert.equal(r.rows.some((x) => x.key === 'event'), false);
        assert.equal(c.store.frame(false, NEXT_DAY).degraded.includes('events'), false);
    });
    await test('월말: 다음 달 행사 파일이 아직 없으면 그 달 날짜만 결측이고 이번 달은 정상이다', () => {
        const c = make(OCT);
        rm(path.join(c.dir, 'events_202611.json'));
        c.store.invalidate();
        assert.ok(c.store.coastDetail('one', NEXT_DAY).missing.includes('events'));
        assert.equal(c.store.coastDetail('one', AT).missing.includes('events'), false);
        assert.equal(c.store.frame(false, AT).degraded.includes('events'), false);
        assert.ok(c.store.frame(false, NEXT_DAY).degraded.includes('events'));
    });
    await test('월초(11/1 00:30): 이번 달만 정상이면 지난 달 파일이 없어도 events 결측이 아니다', () => {
        const c = make('2026-11-01T00:30:00+09:00');
        rm(path.join(c.dir, 'events_202610.json'));
        c.store.invalidate();
        assert.equal(c.store.coastDetail('one', '2026-11-01T03:00:00+09:00').missing.includes('events'), false);
    });
    // ── 7. 관리자 오류현황: 없음은 기록하지 않고 실패는 기록한다 ───────────
    const SRC = ['warnings', 'gale', 'events', 'zoneForecasts', 'swell', 'ripCurrent', 'tourConcentration'];
    const pick = (s) => Object.fromEntries(SRC.map((k) => [k, s[k]]));
    await test('관리자 이력: 행사·특보 없음(정상)은 오류로 기록되지 않는다', () => {
        const c = make(OCT),
            h = createHistory({ dir: path.join(root, 'hist-ok'), clock: () => T(OCT) });
        h.observeSources(pick(c.store.sources()));
        assert.equal(h.list().data.length, 0);
    });
    await test('관리자 이력: 특보·행사 수집 실패는 각각 기록된다', () => {
        const c = make(OCT);
        rm(path.join(c.dataDir, 'weather_alerts.json'));
        c.w(c.dir, 'events_202610_status.json', { status: 'error', month: '2026-10', lastError: 'HTTP 500' });
        c.store.invalidate();
        const h = createHistory({ dir: path.join(root, 'hist-bad'), clock: () => T(OCT) });
        h.observeSources(pick(c.store.sources()));
        const got = h.list().data.map((e) => e.source + ':' + e.scope).sort();
        assert.deepEqual(got, ['events:2026-10', 'warnings:global']);
    });
    // ── 8. 실제 시트: 없음 → 문구 없음 / 실패 → 구분 ────────────────────
    const browser = await chromium.launch({
        ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}),
        headless: true,
        args: ['--no-sandbox'],
    });
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.setContent('<div id="sheet"></div>');
        const dirRF = path.join(__dirname, '../../client/js/marine-life/risk-forecast');
        for (const f of ['risk_format.js', 'risk_sheet.js'])
            await page.addScriptTag({ content: fs.readFileSync(path.join(dirRF, f), 'utf8') });
        const render = async (detail) => {
            await page.evaluate((d) => {
                const sheet = RiskSheet.create(document.getElementById('sheet'), { close() {}, hazard() {}, basis() {}, choose() {}, retry() {} });
                sheet.show(d, 'coast', { lat: 35, lon: 129 });
            }, JSON.parse(JSON.stringify(detail)));
            return page.locator('#sheet .rf-body').textContent();
        };
        const detail = (c, t = AT) => c.store.coastDetail('one', t);
        await test('시트: 행사·특보·강풍 없음 → 자료 없음·일부 요소·확인된 요소 기준 문구가 전혀 없다', async () => {
            const body = await render(detail(make(OCT)));
            for (const bad of ['자료 없음', '일부 요소', '확인된 요소', '특보, ', '행사 정보'])
                assert.ok(!body.includes(bad), bad + ' / ' + body);
            assert.ok(body.includes('평소만큼 붐비고 위험구역 없는 곳'));
        });
        await test('시트: 행사 수집 실패 → 행사 행에 자료 없음 + 확인된 요소 기준 안내(전역 경고 목록은 숨김)', async () => {
            const c = make(OCT);
            c.w(c.dir, 'events_202610_status.json', { status: 'error', month: '2026-10', lastError: 'HTTP 500' });
            c.store.invalidate();
            const body = await render(detail(c));
            assert.ok(/행사 정보\s*자료 없음/.test(body.replace(/\n/g, ' ')), body);
            assert.ok(body.includes('확인된 요소 기준'));
            assert.ok(body.includes('현재 확인된 요소만 반영한 값입니다'));
            assert.ok(!body.includes('일부 요소 자료 없음'));
        });
        await test('시트: 특보 수집 실패 → 행사 행은 없고(일부 실패) 확인된 요소 기준 안내만 정상 없음과 구분된다', async () => {
            const c = make(OCT);
            rm(path.join(c.dataDir, 'weather_alerts.json'));
            c.store.invalidate();
            const body = await render(detail(c));
            assert.ok(!body.includes('행사 정보'), body);
            assert.ok(body.includes('확인된 요소 기준'));
            assert.ok(!body.includes('일부 요소 자료 없음'));
        });
        await test('시트: 11/1 행사 없음(정상)은 문구 없음, 11월 파일 미수신은 행사 행 자료 없음', async () => {
            const ok = await render(detail(make(OCT), NEXT_DAY));
            assert.ok(!ok.includes('행사 정보') && !ok.includes('일부 요소'), ok);
            const c = make(OCT);
            rm(path.join(c.dir, 'events_202611.json'));
            c.store.invalidate();
            const bad = await render(detail(c, NEXT_DAY));
            assert.ok(/행사 정보\s*자료 없음/.test(bad.replace(/\n/g, ' ')), bad);
        });
    } finally {
        await browser.close();
        fs.rmSync(root, { recursive: true, force: true });
        console.log(`${pass} PASS / ${fail} FAIL`);
        if (fail) process.exitCode = 1;
    }
})();
