/**
 * 역할: 오류 감시의 본문 제거·손상 판별·공개 저장소와 같은 신선도·갱신/삭제를 검사한다.
 * [연계] risk_history_sources / risk_store / 임시 파일만 사용, 외부 API·실사용 인증 없음.
 * [로드 순서] verify_all.sh의 독립 Node 검사.
 */
'use strict';
const fs = require('fs'),
    os = require('os'),
    path = require('path'),
    assert = require('assert'),
    zlib = require('zlib');
const io = require('../services/risk_collector_io'),
    { createStore } = require('../services/risk_store');
const {
        createReader,
        readMetadata,
    } = require('../services/risk_history_sources'),
    { createHistory } = require('../services/risk_error_history');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'risk-thin-')),
    dir = path.join(root, 'risk'),
    dataDir = path.join(root, 'data'),
    configDir = path.join(root, 'config'),
    clientDir = path.join(root, 'client');
let now = Date.parse('2026-10-31T12:00:00+09:00'),
    pass = 0,
    fail = 0;
/** 실제 파일·상태 계산을 검사한다. 예: 과거 날짜는 mtime이 새로워도 stale.
 * @param {string} name - 사례 @param {function} fn - 검사 [연계] 아래 시나리오 → assert
 */
async function check(name, fn) {
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
    try {
        for (const d of [dir, dataDir, configDir, clientDir])
            fs.mkdirSync(d, { recursive: true });
        const write = (folder, name, data) =>
                io.write(path.join(folder, name), data),
            at = () => io.iso(now),
            options = { dir, dataDir, configDir, clientDir, clock: () => now };
        write(configDir, 'risk_spots.json', { spots: [] });
        write(clientDir, 'assets/warn_zones.geojson', { features: [] });
        write(clientDir, 'assets/warn_zones_land_coastal.geojson', {
            features: [],
        });
        write(dataDir, 'weather_alerts.json', { updatedAt: at(), current: {} });
        write(dataDir, 'zone_forecasts.json', {
            updatedAt: at(),
            data: {
                92: Array.from({ length: 1000 }, () => ({
                    tm: '2026103103',
                    wh: 2,
                })),
            },
        });
        write(dataDir, 'gale_warnings.json', { savedAt: at(), rows: [] });
        write(dataDir, 'swell_smallzone.json.gz', {
            updatedAt: at(),
            cells: { x: { wp: [8] } },
        });
        write(dataDir, 'ripcurrent_index.json', {
            updatedAt: at(),
            places: { a: { hasData: false }, b: { hasData: false } },
        });
        write(dir, 'sea_traffic.json.gz', {
            date: io.day(now),
            collectedAt: at(),
            frames: { 202610311200: [{ gridId: 'g', congestionIndex: 2 }] },
        });
        write(dir, 'sea_accident.json.gz', {
            date: io.day(now),
            collectedAt: at(),
            createdAt: at(),
            frames: { a: [[0, 0.1, '주의']] },
        });
        write(dir, 'accident_status.json', {
            status: 'ok',
            checkedAt: at(),
            lastSuccess: at(),
        });
        write(dir, 'tour_concentration.json', {
            date: io.day(now),
            collectedAt: at(),
            values: { a: 2 },
        });
        write(dir, 'events_202610.json', {
            month: '2026-10',
            collectedAt: at(),
            events: [],
        });
        write(dir, 'sea_realtime.json.gz', {
            sourceAt: at(),
            collectedAt: at(),
            source: 'MTIS API',
            cells: [{ id: 'x' }],
            rows: [[0, 1, 2]],
        });
        const read = createReader(options),
            publicStore = createStore(options);
        await check(
            '공개 원천과 감시 원천의 상태·실제 수집 시각 일치',
            async () => {
                const a = publicStore.sources(true),
                    b = await read();
                for (const key of Object.keys(a)) {
                    assert.equal(b[key].status, a[key].status, key);
                    assert.equal(b[key].updatedAt, a[key].updatedAt, key);
                    if (key === 'events')
                        for (const m of Object.keys(a.events.months))
                            assert.equal(
                                b.events.months[m].status,
                                a.events.months[m].status
                            );
                }
                assert.equal(b.ripCurrent.status, 'offseason');
                assert.equal(b.realtime.status, 'ok');
            }
        );
        await check(
            '작은 상태 감시는 전체 frames/cells/기상 본문을 남기지 않음',
            async () => {
                for (const file of [
                    path.join(dir, 'sea_traffic.json.gz'),
                    path.join(dir, 'sea_accident.json.gz'),
                    path.join(dataDir, 'zone_forecasts.json'),
                ]) {
                    const meta = await readMetadata(file);
                    assert.ok(meta);
                    assert.ok(!meta.frames && !meta.cells && !meta.data);
                    assert.ok(Buffer.byteLength(JSON.stringify(meta)) < 1024);
                }
            }
        );
        await check(
            'UTF8 경계와 루트 끝에 위치한 metadata도 정확히 읽음',
            async () => {
                const file = path.join(dir, 'boundary.json');
                fs.writeFileSync(
                    file,
                    JSON.stringify({
                        rows: ['가'.repeat(21843)],
                        collectedAt: at(),
                    })
                );
                assert.equal((await readMetadata(file)).collectedAt, at());
            }
        );
        await check(
            '미완성·다중 루트·잘못된 쉼표·숫자·배열 루트는 손상',
            async () => {
                const file = path.join(dir, 'broken.json');
                for (const text of [
                    '{"a":[1',
                    '{}{}',
                    '{"a":1,}',
                    '{"a":[1,]}',
                    '{"a":1.}',
                    '{"a":01}',
                    '{"a":0001}',
                    '{"a":}',
                    '{"a":"\\u123:"}',
                    '[]',
                    'null',
                ]) {
                    fs.writeFileSync(file, text);
                    assert.equal(await readMetadata(file), null, text);
                }
            }
        );
        await check(
            '중복 root 필드·places·hasData는 JSON 마지막 값과 동일',
            async () => {
                const file = path.join(dir, 'duplicates.json');
                fs.writeFileSync(
                    file,
                    '{"updatedAt":"' +
                        at() +
                        '","updatedAt":[],"date":"2026-10-31","date":{},"places":{"a":{"hasData":true,"hasData":false}}}'
                );
                let m = await readMetadata(file);
                assert.equal(m.updatedAt, null);
                assert.equal(m.date, null);
                assert.equal(m._ripWithData, 0);
                fs.writeFileSync(
                    file,
                    '{"places":{"a":{"hasData":true}},"places":{"a":{"hasData":false}}}'
                );
                m = await readMetadata(file);
                assert.equal(m._ripWithData, 0);
                assert.equal(m._ripTotal, 1);
            }
        );
        await check(
            'gzip 손상·64MiB 펼침 상한은 메타데이터 정상으로 감추지 않음',
            async () => {
                const file = path.join(dir, 'oversize.gz');
                fs.writeFileSync(file, 'broken');
                assert.equal(await readMetadata(file), null);
                fs.writeFileSync(
                    file,
                    zlib.gzipSync(Buffer.alloc(64 * 1024 * 1024 + 1, 32))
                );
                assert.equal(await readMetadata(file), null);
            }
        );
        await check(
            '큰 자료는 통째 읽기 없이 처리하고 읽는 동안 이벤트 루프가 진행됨',
            async () => {
                const file = path.join(dir, 'streaming.json.gz');
                fs.writeFileSync(
                    file,
                    zlib.gzipSync(
                        Buffer.from(
                            JSON.stringify({
                                rows: ['x'.repeat(2 * 1024 * 1024)],
                                updatedAt: at(),
                            })
                        )
                    )
                );
                const original = fs.readFileSync;
                let progressed = false;
                fs.readFileSync = function (name, ...args) {
                    if (name === file) throw Error('whole-file read forbidden');
                    return original.call(this, name, ...args);
                };
                const timer = setTimeout(() => {
                    progressed = true;
                }, 0);
                try {
                    const meta = await readMetadata(file);
                    assert.equal(meta.updatedAt, at());
                    assert.equal(progressed, true);
                } finally {
                    clearTimeout(timer);
                    fs.readFileSync = original;
                }
            }
        );
        await check(
            '낡음은 원천 시각 기준·파일 새 mtime으로 정상 처리 안 함',
            async () => {
                now += 16 * 60000;
                const a = publicStore.sources(true),
                    b = await read();
                assert.equal(b.warnings.status, a.warnings.status);
                assert.equal(b.warnings.status, 'stale');
                assert.equal(b.realtime.status, 'stale');
            }
        );
        await check(
            '자료 없는 실제 최초 실패와 공식 source 표시명도 고정 identity로 기록',
            async () => {
                fs.unlinkSync(path.join(dir, 'sea_realtime.json.gz'));
                write(dir, 'realtime_status.json', {
                    status: 'error',
                    lastError: 'HTTP 502',
                    lastRun: at(),
                });
                const h = createHistory({
                    dir: path.join(root, 'history'),
                    clock: () => now,
                });
                h.observeSources(await read());
                const row = h
                    .list()
                    .current.find((r) => r.source === 'realtime');
                assert.equal(row.status, 'error');
                assert.equal(row.code, 'HTTP 502');
                assert.ok(
                    h.list().current.some((r) => r.source === 'accident')
                );
                write(dir, 'realtime_status.json', {
                    status: 'ok',
                    lastRun: at(),
                });
                h.observeSources(await read());
                assert.equal(
                    h.list().current.find((r) => r.source === 'realtime')
                        .status,
                    'missing'
                );
            }
        );
        await check('업데이트·삭제·손상 때 파일 서명 캐시 무효화', async () => {
            write(dir, 'sea_realtime.json.gz', {
                sourceAt: at(),
                collectedAt: at(),
                rows: [],
            });
            assert.equal((await read()).realtime.status, 'ok');
            fs.writeFileSync(path.join(dir, 'sea_realtime.json.gz'), 'broken');
            assert.equal((await read()).realtime.status, 'error');
            fs.unlinkSync(path.join(dir, 'sea_realtime.json.gz'));
            assert.equal((await read()).realtime.status, 'missing');
        });
        await check(
            '월 경계 후 이전 행사 메타데이터도 감시 캐시에서 제거',
            async () => {
                now = Date.parse('2026-11-01T12:00:00+09:00');
                const b = await read();
                assert.ok(!b.events.months['2026-10']);
                assert.ok(b.events.months['2026-11']);
            }
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
        console.log(`${pass} PASS / ${fail} FAIL`);
        process.exitCode = fail ? 1 : 0;
    }
})().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
