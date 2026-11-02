/**
 * 위험예측 파일 캐시 회귀: 작은 상태/쿼터 갱신은 큰 자료를 재파싱하지 않되
 * 전체 입력버전·계산무효화, 손상/삭제 상태, 실제 자료 갱신과 월 경계 해제를 유지한다.
 * [연계] risk_store.js / risk_collector_io / verify_all.sh. 외부 호출 없이 임시 자료만 사용.
 */
'use strict';
const fs = require('fs'),
    path = require('path'),
    os = require('os'),
    assert = require('assert');
const ROOT = process.env.SEAGNAL_REPO_ROOT || path.resolve(__dirname, '..', '..');
const io = require(path.join(ROOT, 'local_server/services/risk_collector_io')),
    { createStore } = require(path.join(ROOT, 'local_server/services/risk_store'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'risk-file-cache-')),
    dir = path.join(tmp, 'risk'),
    dataDir = path.join(tmp, 'data'),
    configDir = path.join(tmp, 'config'),
    clientDir = path.join(tmp, 'client');
let now = Date.parse('2026-10-31T12:00:00+09:00'),
    pass = 0;
const originalRead = io.read,
    reads = new Map();
io.read = (file) => {
    reads.set(file, (reads.get(file) || 0) + 1);
    return originalRead(file);
};
const write = (folder, file, value) => {
    const p = path.join(folder, file);
    io.write(p, value);
    return p;
};
const at = (file) => path.join(dir, file),
    staticFile = path.join(configDir, 'risk_spots.json'),
    weatherFile = path.join(dataDir, 'zone_forecasts.json');
/** 검사 설명과 assert를 실행한다. 실패는 최종 종료 코드로 전달한다.
 * @param {string} name - 검사 설명 @param {function} fn - assert 검사
 * [연계] ← 원천 갱신/삭제/월 경계 회귀 검사
 */
function check(name, fn) {
    fn();
    pass++;
    console.log('PASS ' + name);
}
try {
    write(configDir, 'risk_spots.json', { _about: { hash: 'first' }, spots: [] });
    write(clientDir, 'assets/warn_zones.geojson', { features: [] });
    write(clientDir, 'assets/warn_zones_land_coastal.geojson', { features: [] });
    write(dataDir, 'weather_alerts.json', { updatedAt: new Date(now).toISOString(), current: {} });
    write(dataDir, 'gale_warnings.json', { updatedAt: new Date(now).toISOString(), rows: [] });
    write(dataDir, 'zone_forecasts.json', {
        updatedAt: new Date(now).toISOString(),
        data: { 92: [{ tm: '2026103103', wh: 2, ws: 8 }] },
    });
    write(dir, 'sea_cells.json', {
        v: 'cells',
        cells: [{ i: 0, id: 'GR4_F2I24_A1', lon: 125, lat: 35, haegu: { major: 92 } }],
    });
    write(dir, 'sea_traffic.json.gz', {
        date: '2026-10-31',
        collectedAt: new Date(now).toISOString(),
        frames: {
            202610311200: [
                {
                    gridId: 'GR4_F2I24_A1',
                    latitude: 35,
                    longitude: 125,
                    congestionIndex: 5,
                    congestionLevel: '보통',
                    fcstDate: '20261031',
                    fcstTime: '1200',
                },
            ],
        },
    });
    write(dir, 'sea_accident.json.gz', {
        date: '2026-10-31',
        v: 'first',
        createdAt: new Date(now).toISOString(),
        collectedAt: new Date(now).toISOString(),
        cells: [{ i: 0, id: '1', lon: 125, lat: 35 }],
        frames: { 202610311200: [[0, 0.01, '보통']] },
    });
    write(dir, 'accident_status.json', { status: 'ok', checkedAt: new Date(now).toISOString() });
    write(dir, 'events_202610.json', {
        month: '2026-10',
        events: [],
        collectedAt: new Date(now).toISOString(),
    });
    write(dir, 'events_202611.json', {
        month: '2026-11',
        events: [],
        collectedAt: new Date(now).toISOString(),
    });
    const store = createStore({ dir, dataDir, configDir, clientDir, clock: () => now }),
        first = store.marineInputs(),
        frame = store.frame(false, '2026-10-31T15:00:00+09:00');
    check('current-month event parsed once', () =>
        assert.equal(reads.get(at('events_202610.json')), 1)
    );
    const large = ['sea_traffic.json.gz', 'sea_accident.json.gz', 'sea_cells.json']
        .map(at)
        .concat([weatherFile, staticFile]);
    const before = new Map(large.map((f) => [f, reads.get(f)]));
    write(dir, 'accident_status.json', {
        status: 'error',
        checkedAt: new Date(now).toISOString(),
        lastError: 'HTTP 500',
    });
    store.sources(true);
    const statusChanged = store.marineInputs();
    check('status-only update reuses congestion reference', () =>
        assert.strictEqual(statusChanged.congestion, first.congestion)
    );
    check('status-only update reuses accident reference', () =>
        assert.strictEqual(statusChanged.accident, first.accident)
    );
    check('status-only update reuses cells reference', () =>
        assert.strictEqual(statusChanged.cells, first.cells)
    );
    check('status update does not read large/static files', () =>
        large.forEach((f) => assert.equal(reads.get(f), before.get(f)))
    );
    check('status update preserves input-version invalidation', () =>
        assert(statusChanged.version > first.version)
    );
    check('status update invalidates computed frames', () =>
        assert.notStrictEqual(store.frame(false, '2026-10-31T15:00:00+09:00'), frame)
    );
    check('status failure reflected', () => assert.equal(store.sources().accident.status, 'error'));
    write(dir, 'accident_quota.json', { date: '2026-10-31', calls: 2 });
    store.sources(true);
    const quotaChanged = store.marineInputs();
    check('quota-only update preserves all data references', () => {
        assert.strictEqual(quotaChanged.accident, statusChanged.accident);
        assert.strictEqual(quotaChanged.congestion, statusChanged.congestion);
    });
    check('quota-only update leaves large-read counts unchanged', () =>
        large.forEach((f) => assert.equal(reads.get(f), before.get(f)))
    );
    write(dir, 'sea_accident.json.gz', { ...first.accident, v: 'second' });
    store.sources(true);
    check('changed accident file is read and replaced', () => {
        assert.notStrictEqual(store.marineInputs().accident, first.accident);
        assert.equal(store.marineInputs().accident.v, 'second');
        assert.equal(
            reads.get(at('sea_accident.json.gz')),
            before.get(at('sea_accident.json.gz')) + 1
        );
    });
    write(dataDir, 'zone_forecasts.json', {
        updatedAt: new Date(now).toISOString(),
        data: { 92: [{ tm: '2026103103', wh: 4, ws: 8 }] },
    });
    store.sources(true);
    check('changed weather file reflects new values', () => {
        assert.equal(store.marineInputs().weather(92, '2026-10-31T12:00:00+09:00').wh, 4);
        assert.equal(reads.get(weatherFile), before.get(weatherFile) + 1);
    });
    fs.unlinkSync(at('sea_accident.json.gz'));
    store.sources(true);
    check('deleted accident does not retain old data', () =>
        assert.strictEqual(store.marineInputs().accident, null)
    );
    check('deleted source preserves failed-attempt error precedence', () =>
        assert.equal(store.sources().accident.status, 'error')
    ); // attempt error still takes precedence
    write(dir, 'accident_status.json', { status: 'ok', checkedAt: new Date(now).toISOString() });
    store.sources(true);
    check('deleted file with successful attempt is missing', () =>
        assert.equal(store.sources().accident.status, 'missing')
    );
    fs.writeFileSync(at('sea_accident.json.gz'), 'broken gzip');
    store.sources(true);
    check('corrupt existing file reports error', () => {
        assert.strictEqual(store.marineInputs().accident, null);
        assert.equal(store.sources().accident.status, 'error');
    });
    write(dir, 'sea_accident.json.gz', { ...first.accident, v: 'recovered' });
    store.sources(true);
    check('repaired source is read normally', () =>
        assert.equal(store.marineInputs().accident.v, 'recovered')
    );
    write(configDir, 'risk_spots.json', { _about: { hash: 'changed' }, spots: [] });
    store.sources(true);
    check('static version is replaced when file changes', () =>
        assert.equal(store.meta().versions.spots, 'changed')
    );
    fs.unlinkSync(staticFile);
    store.sources(true);
    check('deleted static table drops old version', () =>
        assert.strictEqual(store.meta().versions.spots, null)
    );
    const octoberReads = reads.get(at('events_202610.json'));
    now = Date.parse('2026-11-04T12:00:00+09:00');
    store.sources(true);
    check('past visible month disappears from source map', () =>
        assert(!Object.hasOwn(store.sources().events.months, '2026-10'))
    );
    now = Date.parse('2026-10-31T12:00:00+09:00');
    store.sources(true);
    check('past-month file memo evicted and reread upon return', () =>
        assert.equal(reads.get(at('events_202610.json')), octoberReads + 1)
    );
    console.log(pass + ' PASS / 0 FAIL');
} catch (e) {
    console.error(e);
    process.exitCode = 1;
} finally {
    io.read = originalRead;
    fs.rmSync(tmp, { recursive: true, force: true });
}
