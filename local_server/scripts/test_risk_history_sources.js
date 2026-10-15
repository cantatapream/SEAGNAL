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
        visibilitySource,
        VSBY_FAIL_STREAK,
        VSBY_STALE_MS,
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
            '해구별 시정: 정상·임계 미만 실패는 문제 아님, 연속 실패·오래된 수집은 문제',
            () => {
                const hour = 3600000,
                    recent = io.iso(now - 2 * hour),
                    checked = io.iso(now - 5 * 60000),
                    empty = 'imgList 빈 응답 (HTTP 200, 0바이트, content-type=없음)';
                const base = {
                    collectedAt: recent,
                    lastCheckAt: checked,
                    lastCheckOk: true,
                    lastCheckError: null,
                    failStreak: 0,
                };
                assert.equal(visibilitySource(base, now).status, 'ok');
                assert.equal(
                    visibilitySource(
                        {
                            ...base,
                            lastCheckOk: false,
                            lastCheckError: empty,
                            failStreak: VSBY_FAIL_STREAK - 1,
                        },
                        now
                    ).status,
                    'ok'
                );
                const failing = visibilitySource(
                    {
                        ...base,
                        lastCheckOk: false,
                        lastCheckError: empty,
                        failStreak: VSBY_FAIL_STREAK,
                    },
                    now
                );
                assert.equal(failing.status, 'error');
                assert.equal(failing.lastError, 'empty response');
                assert.equal(failing.lastSuccess, recent);
                assert.equal(failing.checkedAt, checked);
                assert.equal(
                    visibilitySource(
                        {
                            ...base,
                            lastCheckOk: false,
                            lastCheckError:
                                'imgList JSON 아님 (HTTP 200, 31바이트, content-type=text/html): x',
                            failStreak: VSBY_FAIL_STREAK,
                        },
                        now
                    ).lastError,
                    'invalid response'
                );
                assert.equal(
                    visibilitySource(
                        {
                            ...base,
                            lastCheckOk: false,
                            lastCheckError: 'imgList 503',
                            failStreak: VSBY_FAIL_STREAK,
                        },
                        now
                    ).lastError,
                    'HTTP 503'
                );
                // 확인은 성공해도 새 수집이 없으면(같은 런 반복·PNG 실패) 낡음
                assert.equal(
                    visibilitySource(
                        {
                            ...base,
                            collectedAt: io.iso(now - VSBY_STALE_MS - 60000),
                        },
                        now
                    ).status,
                    'stale'
                );
                // 재기동으로 연속 실패 수가 0이 되어도 오래된 수집은 정상으로 돌아가지 않음
                assert.equal(
                    visibilitySource(
                        {
                            collectedAt: io.iso(now - 4 * 86400000),
                            lastCheckAt: null,
                            lastCheckOk: null,
                            failStreak: 0,
                        },
                        now
                    ).status,
                    'stale'
                );
                assert.equal(
                    visibilitySource({ collectedAt: null, failStreak: 0 }, now)
                        .status,
                    'missing'
                );
            }
        );
        await check(
            '해구별 시정 감시: 실패 지속은 오류현황에 남고 복구도 기록, 정상은 이력 없음',
            async () => {
                const hour = 3600000;
                let vs = {
                    collectedAt: io.iso(now - hour),
                    lastCheckAt: io.iso(now),
                    lastCheckOk: true,
                    lastCheckError: null,
                    failStreak: 0,
                };
                const reader = createReader({
                        ...options,
                        vsbyStatus: () => vs,
                    }),
                    historyDir = path.join(root, 'vsby-history'),
                    h = createHistory({ dir: historyDir, clock: () => now }),
                    rows = () => h.list({ source: 'visibility' }).data,
                    current = () =>
                        h.list().current.find((r) => r.source === 'visibility');
                h.observeSources(await reader());
                assert.equal(current().status, 'ok');
                assert.equal(rows().length, 0);
                const success = vs.collectedAt;
                for (let i = 1; i <= VSBY_FAIL_STREAK + 2; i++) {
                    now += hour;
                    vs = {
                        ...vs,
                        lastCheckAt: io.iso(now),
                        lastCheckOk: false,
                        lastCheckError:
                            'request to https://marine.kma.go.kr/mmis_marine_api/v1/kma/mdl/rdps/imgList?serviceKey=SECRET failed, reason: socket hang up',
                        failStreak: i,
                    };
                    h.observeSources(await reader());
                }
                assert.equal(rows().length, 1);
                assert.equal(rows()[0].phase, 'opened');
                assert.equal(rows()[0].status, 'error');
                assert.equal(current().status, 'error');
                assert.equal(current().code, 'network or parse error');
                assert.equal(current().lastSuccess, success);
                const raw = fs.readFileSync(
                    path.join(historyDir, 'error_history.json'),
                    'utf8'
                );
                for (const word of [
                    'SECRET',
                    'https:',
                    'marine.kma',
                    'serviceKey',
                    'socket',
                ])
                    assert.ok(!raw.includes(word), word);
                now += hour;
                vs = {
                    collectedAt: io.iso(now),
                    lastCheckAt: io.iso(now),
                    lastCheckOk: true,
                    lastCheckError: null,
                    failStreak: 0,
                };
                h.observeSources(await reader());
                assert.equal(rows()[0].phase, 'recovered');
                assert.equal(rows().length, 2);
                assert.equal(current().status, 'ok');
                assert.ok(current().recoveredAt);
                assert.equal(current().lastSuccess, vs.collectedAt);
            }
        );
        await check(
            '행사 일부 시도 실패(failedProvinceCount): 공개 저장소는 그 달을 ok(점수에 사용) · 감시 경로는 숫자를 읽어 오류현황 「일부 실패」 → 0 이면 복구 (2026-10-15)',
            async () => {
                const status = (count) =>
                        write(dir, 'events_202610_status.json', {
                            month: '2026-10',
                            status: 'ok',
                            lastRun: at(),
                            lastSuccess: at(),
                            lastError: null,
                            failedProvinces: count ? ['경상남도', '전라남도'] : [],
                            failedProvinceCount: count,
                            detail: count ? '시도 실패 경상남도(Gemini 호출 실패), 전라남도(Gemini 호출 실패)' : null,
                        }),
                    h = createHistory({
                        dir: path.join(root, 'events-partial-history'),
                        clock: () => now,
                    }),
                    current = () =>
                        h.list({ source: 'events' }).current.find(
                            (r) => r.scope === '2026-10'
                        );
                status(2);
                const b = await read();
                assert.equal(b.events.months['2026-10'].status, 'ok');
                assert.equal(b.events.months['2026-10'].failedProvinceCount, 2);
                assert.equal(
                    publicStore.sources(true).events.months['2026-10'].status,
                    'ok',
                    '공개 저장소는 그 달 행사를 계속 쓴다'
                );
                h.observeSources(b);
                assert.equal(current().status, 'partial');
                assert.equal(current().code, 'Gemini 일부 실패');
                now += 60000;
                status(0);
                h.observeSources(await read());
                assert.equal(current().status, 'ok');
                assert.deepEqual(
                    h
                        .list({ source: 'events' })
                        .data.filter((e) => e.scope === '2026-10')
                        .map((e) => e.phase),
                    ['recovered', 'opened']
                );
                fs.rmSync(path.join(dir, 'events_202610_status.json'));
            }
        );
        await check(
            '월 경계 후 이전 행사 메타데이터도 감시 캐시에서 제거',
            async () => {
                now = Date.parse('2026-11-01T12:00:00+09:00');
                const b = await read();
                assert.ok(!b.events.months['2026-10']);
                assert.ok(b.events.months['2026-11']);
            }
        );
        // 2026-10-15: 감시(metadataOnly)가 baseTmUtf 를 버려 「판이 24시간보다 오래되면 낡음」을 못 봤다.
        await check(
            '해구 예보: 받은 시각은 새것이어도 판이 24시간 넘게 오래되면 감시도 낡음(공개 화면과 같음)',
            async () => {
                write(dataDir, 'zone_forecasts.json', {
                    updatedAt: at(),
                    baseTmUtf: '2026103000',
                    data: { 92: [{ tm: '2026103003', wh: 2 }] },
                });
                const a = createStore(options).sources(true),
                    b = await read();
                assert.equal(a.zoneForecasts.status, 'stale');
                assert.equal(b.zoneForecasts.status, 'stale');
                write(dataDir, 'zone_forecasts.json', {
                    updatedAt: at(),
                    baseTmUtf: '2026110100',
                    data: { 92: [{ tm: '2026110103', wh: 2 }] },
                });
                assert.equal((await read()).zoneForecasts.status, 'ok');
            }
        );
        await check('readMetadata 는 고른 칸만 남긴다(데이터 수집현황용)', async () => {
            const meta = await readMetadata(
                path.join(dataDir, 'zone_forecasts.json'),
                new Set(['baseTmUtf'])
            );
            assert.deepEqual(Object.keys(meta).filter((k) => !k.startsWith('_')), ['baseTmUtf']);
            assert.equal(meta.baseTmUtf, '2026110100');
        });
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
        console.log(`${pass} PASS / ${fail} FAIL`);
        process.exitCode = fail ? 1 : 0;
    }
})().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
