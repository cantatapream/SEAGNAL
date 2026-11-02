/** 실제 물빠짐 HTTP 경로에서 예측값·결측·메타갱신을 보존하며 불필요한 앵커계산을 검사한다.
 * [연계] routes/tide_field.js; 임시 메모리 파일·앵커만 사용, 실제 수집/키/운영 파일 없음.
 * [로드 순서] verify_all.sh에서 Node로 실행한다.
 */
'use strict';
const fs = require('fs'),
    path = require('path'),
    vm = require('vm'),
    assert = require('assert'),
    { createRequire } = require('module');
const root = path.resolve(__dirname, '../..'),
    req = createRequire(path.join(root, 'local_server/package.json')),
    express = req('express'),
    base = req('./services/tide_field_common');
let pass = 0,
    fail = 0;
/** 파일 입력만 격리한 실제 라우터를 만든다. @returns {object} 앱·입력 변경·거리 관찰 [연계] 아래 HTTP 검사 */
function fixture() {
    let stamp = 1,
        distanceCalls = 0,
        anchors = [
            { id: 'A', lat: 35, lon: 126 },
            { id: 'B', lat: 35.1, lon: 126.1 },
        ];
    const cells = [
            { key: 'a', lat: 35, lon: 126, depth: 1, z0: 2 },
            { key: 'b', lat: 35.01, lon: 126.01, depth: 1, z0: 2 },
            { key: 'c', lat: 40, lon: 130, depth: 1, z0: 2 },
        ],
        files = new Map();
    const C = {
        ...base,
        GRID_META_PATH: '/fixture/grid.json',
        FRAMES_META: '/fixture/frames.json',
        FRAMES_BIN: '/fixture/frames.bin',
        haversineKm(...a) {
            distanceCalls++;
            return base.haversineKm(...a);
        },
    };
    const meta = {
        generated_at: 'v1',
        cell_deg: C.TIDE_FIELD_CONFIG.CELL_DEG,
        cells,
    };
    files.set(C.GRID_META_PATH, JSON.stringify(meta));
    files.set(
        C.FRAMES_META,
        JSON.stringify({
            build_version: C.TIDE_FIELD_CONFIG.BUILD_VERSION,
            cell_deg: meta.cell_deg,
            step_minutes: C.TIDE_FIELD_CONFIG.STEP_MINUTES,
            grid_generated_at: 'v1',
            num_cells: 3,
            num_frames: 1,
            frames: [{ date: 20261014, minute: 0 }],
        })
    );
    const bin = Buffer.alloc(6);
    [-100, 150, -32768].forEach((v, i) => bin.writeInt16LE(v, i * 2));
    files.set(C.FRAMES_BIN, bin);
    const curvePath = (id, date) => '/fixture/' + id + '_' + date + '.json';
    for (const a of anchors)
        files.set(
            curvePath(a.id, 20261014),
            JSON.stringify({
                status: 'complete',
                curve: [
                    { t: '00:00', h: 0 },
                    { t: '01:00', h: 0 },
                ],
            })
        );
    const io = {
        existsSync: (f) => files.has(f),
        statSync(f) {
            if (!files.has(f))
                throw Object.assign(Error('absent'), { code: 'ENOENT' });
            return { mtimeMs: stamp };
        },
        readFileSync(f) {
            if (!files.has(f))
                throw Object.assign(Error('absent'), { code: 'ENOENT' });
            return files.get(f);
        },
    };
    const context = {
        require: (n) =>
            n === 'express'
                ? express
                : n === 'fs'
                ? io
                : n.endsWith('tide_field_common')
                ? C
                : n.endsWith('tide_field_collector')
                ? {
                      loadAnchors: () => anchors,
                      windowDatesKST: () => [20261014],
                      curvePath,
                  }
                : req(n),
        module: { exports: {} },
        console: { log() {}, warn() {}, error() {} },
        Buffer,
        Date,
        Map,
        Set,
        Float32Array,
    };
    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(
            path.join(root, 'local_server/routes/tide_field.js'),
            'utf8'
        ),
        context
    );
    const app = express();
    app.use(context.module.exports);
    return {
        app,
        calls: () => distanceCalls,
        noCurves() {
            for (const k of files.keys())
                if (k.includes('/fixture/A_') || k.includes('/fixture/B_'))
                    files.delete(k);
        },
        reload() {
            anchors = [{ id: 'far', lat: 0, lon: 0 }];
            meta.generated_at = 'v2';
            files.set(C.GRID_META_PATH, JSON.stringify(meta));
            stamp++;
        },
    };
}
/** 실제 HTTP 응답으로 계약을 검증한다. @param {string} name @param {function} fn @returns {Promise<void>} [연계] 임시 서버는 항상 종료 */
async function check(name, fn) {
    const f = fixture(),
        server = f.app.listen(0, '127.0.0.1');
    try {
        await new Promise((r) => server.once('listening', r));
        const url = 'http://127.0.0.1:' + server.address().port;
        const get = async (q) => {
            const r = await fetch(url + q);
            return { status: r.status, data: await r.json() };
        };
        await fn(f, get);
        pass++;
        console.log('PASS', name);
    } catch (e) {
        fail++;
        console.error('FAIL', name, e.message);
    } finally {
        await new Promise((r) => server.close(r));
    }
}
const field = (t) =>
    '/api/tide-field?time=' +
    encodeURIComponent('2026-10-14T' + t + ':00+09:00') +
    '&shallow=1';
(async () => {
    await check(
        '정상 메타와 프리컴퓨트 조회는 앵커 거리계산 없이 값·sentinel 유지',
        async (f, get) => {
            assert.equal((await get('/api/tide-field/meta')).status, 200);
            assert.equal(f.calls(), 0);
            const r = await get(field('00:00'));
            assert.equal(r.data.precomputed, true);
            assert.deepEqual(
                r.data.cells.map((c) => [c.state, c.depth_m]),
                [
                    [1, -1],
                    [2, 1.5],
                ]
            );
            assert.equal(f.calls(), 0);
            assert.deepEqual((await get(field('00:00'))).data, r.data);
        }
    );
    await check(
        '없는 프레임은 조회 셀만 보간하고 같은 셀 재조회에 거리계산 재사용',
        async (f, get) => {
            const route = field('01:00') + '&bbox=125.99,34.99,126.005,35.005';
            const r = await get(route);
            assert.equal(r.data.count, 1);
            assert.equal(r.data.cells[0].depth_m, -1);
            assert.equal(f.calls(), 2);
            await get(route);
            assert.equal(f.calls(), 2);
            const all = await get(field('01:00'));
            assert.equal(all.data.count, 2);
            assert.ok(!all.data.cells.some((c) => c.lat === 40));
        }
    );
    await check('곡선 누락은 정상0 또는 노출로 채우지 않음', async (f, get) => {
        f.noCurves();
        const r = await get(field('01:00'));
        assert.equal(r.data.count, 0);
    });
    await check(
        '메타 갱신은 옛 앵커 연결과 프레임을 재사용하지 않음',
        async (f, get) => {
            const route = field('01:00') + '&bbox=125.99,34.99,126.005,35.005';
            assert.equal((await get(route)).data.count, 1);
            const before = f.calls();
            f.reload();
            await get('/api/tide-field/meta');
            assert.equal(f.calls(), before);
            const r = await get(route);
            assert.equal(r.data.precomputed, false);
            assert.equal(r.data.count, 0);
            assert.equal(f.calls(), before + 1);
        }
    );
    await check('디버그도 필요한 셀의 앵커와 곡선을 유지', async (f, get) => {
        const r = await get('/api/tide-field/debug?lat=35&lon=126');
        assert.equal(r.status, 200);
        assert.equal(r.data.anchorCount, 2);
        assert.equal(r.data.series[1].depthM, -1);
        assert.equal(f.calls(), 2);
    });
    console.log(`${pass} PASS / ${fail} FAIL`);
    process.exitCode = fail ? 1 : 0;
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
