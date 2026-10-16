/**
 * 역할: 해구별 기상예보 수집이 새 판을 못 받았을 때 「새 판 없음, 기존 판 유지」를 기록하고
 *       더 오래된 판으로 지금 판을 덮어쓰지 않는지 검사한다(2026-10-15 사용자 지시 ⓑ).
 * [연계] services/zone_forecast_guard.js(decide·storedBase·record·pollCandidates) · scheduler.js collectZoneForecasts(호출 순서는 글자로 확인 —
 *        scheduler.js 는 require 하면 수집이 시작되므로 불러오지 않는다). 외부 API 호출 없음, 임시 폴더만 쓴다.
 * [로드 순서] 시험 스크립트 — node local_server/scripts/test_zone_forecast_guard.js · verify_all.sh SUITES
 */
'use strict';
const fs = require('fs'),
    os = require('os'),
    path = require('path'),
    assert = require('assert');
const G = require('../services/zone_forecast_guard');
let pass = 0,
    fail = 0;
function check(name, fn) {
    try {
        fn();
        pass++;
        console.log('✅', name);
    } catch (e) {
        fail++;
        console.error('❌', name, e.message);
    }
}
let runs = []; // 비동기 실제 동작 사례 — 아래 finally 에서 차례로 돈다
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zone-guard-')),
    NOW = Date.parse('2026-10-15T21:31:00+09:00'); // 고정 시각(시각 의존 금지)
try {
    check('판 비교: 새 판 / 같은 판 / 더 오래된 판 / 판 없음', () => {
        assert.equal(G.decide('2026101500', '2026101512'), 'new');
        assert.equal(G.decide('2026101500', '2026101500'), 'same');
        assert.equal(G.decide('2026101512', '2026101500'), 'older');
        assert.equal(G.decide('2026101512', null), 'none');
        assert.equal(G.decide(null, '2026101500'), 'new', '가진 판이 없으면 새 판');
        assert.equal(G.decide('깨짐', '2026101500'), 'new', '가진 판 글자가 이상하면 새 판으로 받는다');
    });
    check('지금 가진 판 읽기: 파일 없음·깨짐은 null', () => {
        assert.equal(G.storedBase(dir), null);
        fs.writeFileSync(path.join(dir, 'zone_forecasts.json'), '{깨진');
        assert.equal(G.storedBase(dir), null);
        fs.writeFileSync(path.join(dir, 'zone_forecasts.json'), JSON.stringify({ updatedAt: 'x', baseTmUtf: '2026101512', data: {} }));
        assert.equal(G.storedBase(dir), '2026101512');
    });
    check('더 오래된 판: 「새 판 없음, 기존 판 유지」 기록 + 덮어쓰지 않음 문구', () => {
        const r = G.record(dir, { result: 'older', stored: '2026101512', found: '2026101500', expected: '2026101512' }, NOW);
        const f = JSON.parse(fs.readFileSync(path.join(dir, G.STATUS_NAME), 'utf8'));
        assert.deepEqual(r, f);
        assert.equal(f.result, 'older');
        assert.equal(f.lastRun, '2026-10-15T21:31:00+09:00');
        assert.ok(/새 판 없음, 기존 판 유지/.test(f.message) && /덮어쓰지 않음/.test(f.message), f.message);
        assert.equal(G.storedBase(dir), '2026101512', '가진 판 파일은 그대로');
    });
    check('같은 판 다시 받음·예정 판 미게시도 기록', () => {
        const f = G.record(dir, { result: 'same', stored: '2026101500', found: '2026101500', expected: '2026101512' }, NOW);
        assert.ok(/새 판 없음, 기존 판 유지/.test(f.message) && /예정 판 2026101512 미게시/.test(f.message), f.message);
        const n = G.record(dir, { result: 'none', stored: '2026101500', found: null, expected: '2026101512' }, NOW);
        assert.ok(/기존 판 유지/.test(n.message), n.message);
        const e = G.record(dir, { result: 'empty', stored: '2026101500', found: '2026101512', expected: '2026101512' }, NOW);
        assert.ok(/저장하지 않음/.test(e.message), e.message);
    });
    check('scheduler.js: 판 비교가 75시간치 내려받기·저장보다 먼저, 오래된 판·판 없음이면 return', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'scheduler.js'), 'utf8'),
            fn = src.slice(src.indexOf('async function collectZoneForecasts('), src.indexOf('// 5. 중기해상예보 수집'));
        const decide = fn.indexOf('zoneGuard.decide(storedBaseTm, validBaseTm)'),
            guard = fn.indexOf("if (zoneVerdict === 'older' || zoneVerdict === 'none') {"),
            download = fn.indexOf('for (let h = 0; h <= 75; h += 3)'),
            save = fn.indexOf("saveData('zone_forecasts.json'");
        assert.ok(decide > 0 && guard > decide && download > guard && save > download, [decide, guard, download, save].join(','));
        const block = fn.slice(guard, download);
        assert.ok(/zoneGuard\.record\(/.test(block) && /\breturn;/.test(block), '오래된 판이면 기록하고 끝내야 함');
        assert.ok(!/saveData\(/.test(block), '오래된 판 갈래에서 저장하면 안 됨');
    });
    // 2026-10-16 기상청 API허브 답변 「생성하는데 6시간 이상이 소요될 수 있습니다」 → 30분마다 새 판 확인
    check('새 판 확인 목록: 가진 판보다 새 판만, 최신부터 · 가진 판이 최신이면 빈 목록(묻지 않음)', () => {
        assert.deepEqual(G.pollCandidates('2026101600', '2026101612'), ['2026101612']);
        assert.deepEqual(G.pollCandidates('2026101512', '2026101612'), ['2026101612', '2026101600']);
        assert.deepEqual(G.pollCandidates('2026101612', '2026101612'), []);
        assert.deepEqual(G.pollCandidates('2026101700', '2026101612'), [], '가진 판이 더 새것이어도 묻지 않음');
        assert.deepEqual(G.pollCandidates(null, '2026101700'), ['2026101700', '2026101612', '2026101600', '2026101512'], '가진 판 없으면 최근 4판');
        assert.deepEqual(G.pollCandidates('2026101400', '2026101700'), ['2026101700', '2026101612', '2026101600', '2026101512'], '최대 4판');
        assert.deepEqual(G.pollCandidates('2026101600', '깨짐'), []);
    });
    check('새 판 확인 기록: 아직 미게시·덜 올라옴은 기존 판 유지, 새 판은 판 시각 뒤 몇 분에 확인했는지 최근 14개', () => {
        fs.rmSync(path.join(dir, G.STATUS_NAME), { force: true });
        const w = G.record(dir, { result: 'waiting', stored: '2026101600', found: null, expected: '2026101612' }, NOW);
        assert.ok(/2026101612 아직 미게시/.test(w.message) && /기존 판 2026101600 유지/.test(w.message), w.message);
        assert.deepEqual(w.recentNew, []);
        const p = G.record(dir, { result: 'partial', stored: '2026101600', found: '2026101612', expected: '2026101612' }, NOW);
        assert.ok(/덜 올라옴/.test(p.message) && /저장하지 않고/.test(p.message), p.message);
        const at = Date.parse('2026-10-17T03:45:00+09:00'); // 12UTC 판(21시 KST) 뒤 6시간 45분
        const n = G.record(dir, { result: 'new', stored: '2026101600', found: '2026101612', expected: '2026101612' }, at);
        assert.deepEqual(n.recentNew, [{ base: '2026101612', foundAt: '2026-10-17T03:45:00+09:00', delayMinutes: 405 }]);
        assert.ok(/판 시각 뒤 6시간 45분에 확인/.test(n.message), n.message);
        const again = G.record(dir, { result: 'same', stored: '2026101612', found: '2026101612', expected: '2026101612' }, at + 3600000);
        assert.equal(again.recentNew.length, 1, '같은 판·다른 결과는 지연 기록을 늘리지 않고 그대로 이어 간다');
        const dup = G.record(dir, { result: 'new', stored: null, found: '2026101612', expected: '2026101612' }, at + 7200000);
        assert.equal(dup.recentNew.length, 1, '같은 판을 두 번 새 판으로 받아도 한 번만');
        for (let i = 0; i < 20; i++) {
            const tm = new Date(Date.UTC(2026, 9, 18) + i * 12 * 3600000).toISOString().replace(/[-T:]/g, '').slice(0, 10);
            G.record(dir, { result: 'new', stored: null, found: tm, expected: tm }, Date.UTC(2026, 9, 18) + i * 12 * 3600000 + 60000);
        }
        assert.equal(JSON.parse(fs.readFileSync(path.join(dir, G.STATUS_NAME), 'utf8')).recentNew.length, 14);
    });
    check('scheduler.js 새 판 확인: :15·:45 에 poll · 가진 판이 최신이면 묻기 전에 return · 다 올라온 판(+0h·+75h)만 · 26개 다 받아야 저장', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'scheduler.js'), 'utf8'),
            fn = src.slice(src.indexOf('async function collectZoneForecasts('), src.indexOf('// 5. 중기해상예보 수집'));
        assert.ok(src.includes('if (min === 15 || min === 45) collectZoneForecasts({ poll: true });'));
        assert.ok(/if \(\['09:30', '21:30'\]\.includes\(hm\)\) collectZoneForecasts\(\);/.test(src), '정해진 두 회차는 그대로');
        const cand = fn.indexOf('zoneGuard.pollCandidates('), early = fn.indexOf('if (!candidates.length) return;'), ready = fn.indexOf('await zoneRunReady(tm)');
        assert.ok(cand > 0 && early > cand && ready > early, [cand, early, ready].join(','));
        assert.ok(fn.includes('for (let i = 0; !poll && i <= 3; i++)'), '새 판 확인은 옛 판 찾기(4판 거슬러)를 하지 않는다');
        const partial = fn.slice(fn.indexOf('if (poll && stepsOk < zoneSteps) {'), fn.indexOf('} else if (Object.keys(zoneDataMap).length > 0) {'));
        assert.ok(partial.length > 0 && /result: 'partial'/.test(partial) && !/saveData\(/.test(partial), '덜 받은 판은 저장하지 않음');
        const ready2 = src.slice(src.indexOf('async function zoneRunReady('), src.indexOf('async function collectZoneForecasts('));
        assert.ok(/for \(const h of \[0, 75\]\)/.test(ready2) && /#START7777/.test(ready2), '+0h·+75h 둘 다 있어야 올라옴');
    });
    // 실제 동작: scheduler.js 의 해구 수집 함수들만 떼어 가짜 기상청 응답·고정 시각으로 돌린다(require 하면 수집이 시작되므로).
    const vm = require('vm'),
        src = fs.readFileSync(path.join(__dirname, '..', 'scheduler.js'), 'utf8'),
        cut = (a, b) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a))),
        code = [cut('function getUtcTm(', '/**'), cut('function parseKmaTable(', '/**\n * 해구 예보 판(tm)이 다 올라왔나'), cut('async function zoneRunReady(', '// 5. 중기해상예보 수집')].join('\n');
    /** 고정 시각·가짜 응답으로 collectZoneForecasts 를 한 번 돌린다. published[판] = 그 판에서 응답하는 +h 목록. @returns {Promise<{calls:string[], saved:object|null, status:object|null}>} */
    async function runZone(nowIso, published, stored, opts) {
        const d = fs.mkdtempSync(path.join(os.tmpdir(), 'zone-run-')),
            calls = [],
            RealDate = Date,
            fixed = RealDate.parse(nowIso);
        if (stored) fs.writeFileSync(path.join(d, 'zone_forecasts.json'), JSON.stringify({ updatedAt: 'x', baseTmUtf: stored, data: {} }));
        class FakeDate extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } }
        const head = '#START7777\n# TMA_FC TMA_EF LZONE LAT_LB LON_LB LAT_LT LON_LT LAT_RT LON_RT LAT_RB LON_RB WH_SIG WVPRD_MAX WVDR WS WD\n';
        const ctx = {
            Date: FakeDate, TextDecoder, Math, String, Object, Array, Number, parseInt, console,
            setTimeout: (f) => f(),
            CONFIG: { URLS: { SEA_ZONE_LARGE: 'https://fake/zone' }, KMA_HUB_KEY: 'k', DATA_DIR: d },
            zoneGuard: G,
            lastRunStatus: {},
            collectProgress: { emit() {} },
            getNowStr: () => '2026. 10. 17. 오전 3:45:00',
            log() {},
            PROD_API_BASE: 'https://fake-prod',
            saveData: (name, data) => fs.writeFileSync(path.join(d, name), JSON.stringify(data)),
            fetchWithTimeout: async (url) => {
                calls.push(url);
                const q = new URL(url).searchParams, fc = q.get('tma_fc'), ef = q.get('tma_ef');
                const b = RealDate.UTC(+fc.slice(0, 4), +fc.slice(4, 6) - 1, +fc.slice(6, 8), +fc.slice(8, 10)),
                    h = (RealDate.UTC(+ef.slice(0, 4), +ef.slice(4, 6) - 1, +ef.slice(6, 8), +ef.slice(8, 10)) - b) / 3600000;
                const ok = (published[fc] || []).includes(h);
                const body = ok ? head + fc + ' ' + ef + ' 1 42.5 131.5 43.0 131.5 43.0 132.0 42.5 132.0 0.9 7.1 199.6 5.7 329.7\n' : '#ERROR';   // 실제 응답 꼴(2026-10-16 확인)
                return { ok: true, arrayBuffer: async () => new TextEncoder().encode(body).buffer, json: async () => { throw new Error('프록시 없음'); } };
            },
        };
        vm.createContext(ctx);
        vm.runInContext(code + '\nvar isCollectingZone = false;\nthis.run = collectZoneForecasts;', ctx);
        const realNow = RealDate.now;
        RealDate.now = () => fixed; // zone_forecast_guard.record 가 기본값으로 쓰는 지금 시각도 고정
        try { await ctx.run(opts); } finally { RealDate.now = realNow; }
        const read = (n) => { try { return JSON.parse(fs.readFileSync(path.join(d, n), 'utf8')); } catch (_) { return null; } };
        const out = { calls, saved: read('zone_forecasts.json'), status: read(G.STATUS_NAME) };
        fs.rmSync(d, { recursive: true, force: true });
        return out;
    }
    const ALL = Array.from({ length: 26 }, (_, i) => i * 3);
    runs = [
        ['새 판 확인 실제: 가진 판이 최신이면 기상청에 한 번도 묻지 않는다', async () => {
            const r = await runZone('2026-10-17T03:15:00+09:00', { 2026101612: ALL }, '2026101612', { poll: true });
            assert.equal(r.calls.length, 0);
            assert.equal(r.status, null, '기록도 남기지 않는다');
        }],
        ['새 판 확인 실제: 새 판 미게시 → 판 하나에 한 번 묻고 「아직 미게시」만 기록, 저장 안 함', async () => {
            const r = await runZone('2026-10-17T03:15:00+09:00', { 2026101600: ALL }, '2026101600', { poll: true });
            assert.equal(r.calls.length, 1, r.calls.join('\n'));
            assert.equal(r.saved.baseTmUtf, '2026101600');
            assert.equal(r.status.result, 'waiting');
            assert.ok(/2026101612 아직 미게시/.test(r.status.message), r.status.message);
        }],
        ['새 판 확인 실제: +0h 는 있는데 +75h 가 없으면 「덜 올라옴」으로 보고 받지 않는다', async () => {
            const r = await runZone('2026-10-17T03:15:00+09:00', { 2026101612: [0, 3, 6] }, '2026101600', { poll: true });
            assert.equal(r.calls.length, 2);
            assert.equal(r.saved.baseTmUtf, '2026101600');
            assert.equal(r.status.result, 'waiting');
        }],
        ['새 판 확인 실제: 받다가 가운데 시각이 빠지면 저장하지 않고 「덜 올라옴」 기록', async () => {
            const r = await runZone('2026-10-17T03:15:00+09:00', { 2026101612: ALL.filter((h) => h !== 36) }, '2026101600', { poll: true });
            assert.equal(r.saved.baseTmUtf, '2026101600');
            assert.equal(r.status.result, 'partial');
        }],
        ['새 판 확인 실제: 다 올라온 새 판 → 26개 시각 저장 + 판 시각 뒤 몇 분에 확인했는지 기록', async () => {
            const r = await runZone('2026-10-17T03:45:00+09:00', { 2026101612: ALL }, '2026101600', { poll: true });
            assert.equal(r.saved.baseTmUtf, '2026101612');
            assert.equal(r.saved.data['1'].length, 26);
            assert.equal(r.status.result, 'new');
            assert.deepEqual(r.status.recentNew.map((x) => [x.base, x.delayMinutes]), [['2026101612', 405]]);
        }],
        ['새 판 확인 실제: 가진 판보다 두 판 새 판이 다 올라와 있으면 가장 새 판을 받는다', async () => {
            const r = await runZone('2026-10-17T12:15:00+09:00', { 2026101700: ALL, 2026101612: ALL }, '2026101600', { poll: true });
            assert.equal(r.saved.baseTmUtf, '2026101700');
        }],
        ['정해진 회차(21:30)는 종전대로: 새 판이 없으면 같은 판을 찾아 다시 받는다', async () => {
            const r = await runZone('2026-10-16T21:30:00+09:00', { 2026101600: ALL }, '2026101600');
            assert.equal(r.saved.baseTmUtf, '2026101600');
            assert.equal(r.saved.data['1'].length, 26);
            assert.equal(r.status.result, 'same');
        }],
    ];
} finally {
    (async () => {
        for (const [name, fn] of runs) {
            try {
                await fn();
                pass++;
                console.log('✅', name);
            } catch (e) {
                fail++;
                console.error('❌', name, e.message);
            }
        }
        fs.rmSync(dir, { recursive: true, force: true });
        console.log(`${pass} PASS / ${fail} FAIL`);
        process.exitCode = fail ? 1 : 0;
    })();
}
