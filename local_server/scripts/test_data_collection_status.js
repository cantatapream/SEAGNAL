/**
 * 역할: 관리자 「데이터 수집현황 → 수집 목록」의 목록표(manifest)·계산·API 를 검사한다.
 *       ①목록표 규칙(근거 없는 공식 갱신 금지·근거 인용이 실제 파일에 있음·위험예측 원천 11종 모두 포함)
 *       ②시각 읽기·다음 회차 계산 ③임시 폴더 + 고정 시계로 정상/오래됨/수집 실패/자료 없음 판정
 *       ④실제 관리자 인증(임시 토큰 폴더)으로 401·200.
 * [연계] config/data_collection_manifest.json · services/data_collection_status.js · routes/data_collection.js ·
 *        services/admin_auth.js(vm 격리 실행 — 실제 토큰 파일을 건드리지 않음). 외부 API 호출 없음.
 * [로드 순서] 시험 스크립트 — node local_server/scripts/test_data_collection_status.js · verify_all.sh SUITES
 */
'use strict';
const fs = require('fs'),
    os = require('os'),
    path = require('path'),
    vm = require('vm'),
    zlib = require('zlib'),
    assert = require('assert'),
    express = require('express'),
    { createRequire } = require('module');
const S = require('../services/data_collection_status'),
    { SOURCES } = require('../services/risk_error_history');
const ROOT = path.join(__dirname, '..', '..'),
    MANIFEST = path.join(__dirname, '..', 'config', 'data_collection_manifest.json'),
    manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')),
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'data-collection-')),
    dataDir = path.join(tmp, 'data');
let pass = 0,
    fail = 0;
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
const K = (s) => Date.parse(s + '+09:00'); // KST 벽시계 → ms
const write = (rel, obj) => {
    const f = path.join(dataDir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const b = Buffer.from(JSON.stringify(obj, null, 2));
    fs.writeFileSync(f, rel.endsWith('.gz') ? zlib.gzipSync(b) : b);
};
/** 실제 관리자 인증 코드를 임시 폴더에서 돌린다(test_risk_errors 와 같은 방식). */
function isolatedAuth() {
    const filename = path.join(__dirname, '../services/admin_auth.js'),
        module = { exports: {} };
    vm.runInNewContext(
        fs.readFileSync(filename, 'utf8'),
        {
            module,
            exports: module.exports,
            require: createRequire(filename),
            __dirname: path.join(tmp, 'auth', 'services'),
            __filename: filename,
            process: { env: { ADMIN_PASSWORD: 'test-only-password' } },
            console: { log() {}, warn() {}, error() {} },
            Buffer,
            Date,
            setInterval: () => ({ unref() {} }),
            clearInterval() {},
        },
        { filename }
    );
    return module.exports;
}

// 실제 라우터를 불러오되 관리자 인증 의존성만 위의 격리 인증으로 바꾼다 — 실제 토큰 파일·타이머를 건드리지 않게.
const auth = isolatedAuth(),
    routerFile = path.join(__dirname, '../routes/data_collection.js'),
    routeModule = { exports: {} },
    routeRequire = createRequire(routerFile);
vm.runInNewContext(
    fs.readFileSync(routerFile, 'utf8'),
    {
        module: routeModule,
        exports: routeModule.exports,
        require: (name) => (name === '../services/admin_auth' ? auth : routeRequire(name)),
    },
    { filename: routerFile }
);
const { createRouter } = routeModule.exports;

(async () => {
    try {
        // ── ① 목록표 규칙 ──
        await check('목록표: id 중복 없음·단계 1/2·출처가 providers 에 있음·일정 설명과 근거', () => {
            const ids = new Set(),
                providers = new Set(manifest.providers.map((p) => p.id));
            for (const it of manifest.items) {
                assert.ok(!ids.has(it.id), '중복 ' + it.id);
                ids.add(it.id);
                assert.ok([1, 2].includes(it.stage), it.id);
                assert.ok(providers.has(it.provider), it.id + ' 출처 ' + it.provider);
                assert.ok(it.schedule && it.schedule.text && it.schedule.evidence.length, it.id + ' 일정 근거');
                assert.ok(/\(.+\)$/.test(it.name), it.id + ' 이름 끝에 (출처) — 사용자 확정 4');
            }
        });
        await check('목록표: 공식 갱신은 근거가 있을 때만(kind doc/measured ⇒ 근거 1건 이상), 없으면 kind=null', () => {
            for (const it of manifest.items) {
                const o = it.official;
                assert.ok([null, 'doc', 'measured'].includes(o.kind), it.id);
                if (o.kind) assert.ok(o.evidence.length > 0, it.id + ' 근거 없는 공식 갱신');
                else assert.equal(o.evidence.length, 0, it.id + ' 근거가 있으면 kind 를 정해야 함');
            }
        });
        await check('목록표: 모든 파일 근거의 인용(quote)이 그 파일에 실제로 있다', () => {
            for (const it of manifest.items)
                for (const e of [...it.official.evidence, ...(it.official.reference || []), ...it.schedule.evidence]) {
                    if (!e.file) {
                        assert.ok(e.note || e.url, it.id + ' 근거 형식');
                        continue;
                    }
                    const text = fs.readFileSync(path.join(ROOT, e.file), 'utf8');
                    assert.ok(text.includes(e.quote), it.id + ' — ' + e.file + ' 에 「' + e.quote + '」 없음');
                }
        });
        await check('목록표: 위험예측 오류현황 원천(' + SOURCES.length + '종)이 모두 1단계에 있다', () => {
            const risk = manifest.items.filter((i) => i.stage === 1).map((i) => i.state.risk);
            for (const s of SOURCES) assert.ok(risk.includes(s), s + ' 없음');
        });

        // ── ② 시각 읽기·다음 회차 ──
        await check('시각 읽기: koLocale(오전·오후·AM·PM·12시)·utcYmdh·kstDot·iso·epochMs, 모르면 NaN', () => {
            const P = S.parseTime;
            assert.equal(P('2026. 10. 15. 오후 9:30:12', 'koLocale'), K('2026-10-15T21:30:12'));
            assert.equal(P('2026. 10. 15. 오전 12:05:00', 'koLocale'), K('2026-10-15T00:05:00'));
            assert.equal(P('2026. 10. 15. 오후 12:05:34', 'koLocale'), K('2026-10-15T12:05:34'));
            assert.equal(P('2026. 10. 10. AM 01:00:00', 'koLocale'), K('2026-10-10T01:00:00'));
            assert.equal(P('2026. 10. 15. PM 9:45:38', 'koLocale'), K('2026-10-15T21:45:38'));
            assert.equal(P('2026101512', 'utcYmdh'), K('2026-10-15T21:00:00'));
            assert.equal(P('2026.09.09 21:00', 'kstDot'), K('2026-09-09T21:00:00'));
            assert.equal(P('2026-10-15T03:00:00+09:00', 'iso'), K('2026-10-15T03:00:00'));
            assert.equal(P(K('2026-10-15T03:00:00'), 'epochMs'), K('2026-10-15T03:00:00'));
            for (const [v, f] of [['2026101500', 'raw'], ['어제', 'iso'], ['2026. 10. 15. 오후 13:00:00', 'koLocale'], [null, 'iso']])
                assert.ok(Number.isNaN(P(v, f)), String(v) + ' ' + f);
        });
        await check('다음 회차: 매일 시각·매시 분·N분 칸·간격·같은 시각 포함 여부', () => {
            const N = S.nextRun;
            assert.equal(N({ times: ['09:30', '21:30'] }, K('2026-10-15T09:31:00')), K('2026-10-15T21:30:00'));
            assert.equal(N({ times: ['09:30', '21:30'] }, K('2026-10-15T21:30:00')), K('2026-10-16T09:30:00'));
            assert.equal(N({ times: ['09:30', '21:30'] }, K('2026-10-15T21:30:00'), true), K('2026-10-15T21:30:00'));
            assert.equal(N({ minutes: [5, 35] }, K('2026-10-15T12:06:00')), K('2026-10-15T12:35:00'));
            assert.equal(N({ minutes: [5, 35] }, K('2026-10-15T12:40:00')), K('2026-10-15T13:05:00'));
            assert.equal(N({ everyMinutes: 5 }, K('2026-10-15T12:06:00')), K('2026-10-15T12:10:00'));
            assert.equal(N({ everyMinutes: 5 }, K('2026-10-15T12:10:00')), K('2026-10-15T12:15:00'));
            assert.equal(N({ intervalMinutes: 60 }, K('2026-10-15T12:06:00')), K('2026-10-15T13:06:00'));
            assert.equal(N({}, K('2026-10-15T12:06:00')), null);
        });

        // ── ③ 임시 폴더 + 고정 시계 ──
        let now = K('2026-10-15T21:50:00'),
            rows = [],
            sched = null;
        const status = S.createStatus({
            dataDir,
            clock: () => now,
            riskCurrent: () => rows,
            schedulerStatus: () => sched,
        });
        const get = async (id) => (await status.list()).items.find((i) => i.id === id);
        // 해구 예보: 00UTC 판(09시 KST)을 09:30 에 받음 → 새 판은 21:30 회차에 기대.
        write('zone_forecasts.json', { updatedAt: '2026. 10. 15. 오전 9:30:40', baseTmUtf: '2026101500', data: { 1: [] } });
        write('zone_forecasts_status.json', { lastRun: '2026-10-15T21:31:00+09:00', result: 'same', message: '새 판 없음, 기존 판 유지 — 같은 판 2026101500 를 다시 받음 · 예정 판 2026101512 미게시' });
        await check('해구 예보: 21:30 회차+여유 30분 전에는 정상, 기준 시각=판(KST 09시), 다음 기대=21:30', async () => {
            const z = await get('zoneForecasts');
            assert.equal(z.status, 'ok');
            assert.equal(z.basis.at, '2026-10-15T09:00:00+09:00');
            assert.equal(z.collectedAt, '2026-10-15T09:30:40+09:00');
            assert.equal(z.nextExpectedAt, '2026-10-15T21:30:00+09:00');
            assert.equal(z.nextFrom, 'basis');
            assert.ok(/새 판 없음, 기존 판 유지/.test(z.detail), z.detail);
        });
        await check('해구 예보: 12UTC 판이 22:00 KST 넘도록 없으면 노랑(자료 오래됨) — 사용자 실측 상황', async () => {
            now = K('2026-10-15T22:23:00');
            const z = await get('zoneForecasts');
            assert.equal(z.status, 'stale');
            assert.ok(/다음 기대 시각/.test(z.reason) && /판/.test(z.reason), z.reason);
        });
        await check('해구 예보: 12UTC 판을 받으면 다음 기대는 다음 날 09:30', async () => {
            write('zone_forecasts.json', { updatedAt: '2026. 10. 15. 오후 10:40:00', baseTmUtf: '2026101512', data: {} });
            const z = await get('zoneForecasts');
            assert.equal(z.status, 'ok');
            assert.equal(z.nextExpectedAt, '2026-10-16T09:30:00+09:00');
        });
        await check('오류현황 원천 상태를 그대로 쓴다(수집 실패·분류·상세), 정상인데 기대 시각이 지나면 오래됨', async () => {
            rows = [
                { source: 'visibility', scope: 'global', status: 'error', code: 'empty response', detail: null, updatedAt: '2026-10-11T21:10:00+09:00' },
                { source: 'warnings', scope: 'global', status: 'ok', updatedAt: '2026-10-15T22:00:00+09:00' },
                { source: 'events', scope: '2026-09', status: 'ok' },
                { source: 'events', scope: '2026-10', status: 'partial', code: 'Gemini 일부 실패', detail: '시도 실패 경상남도(Gemini 호출 실패)' },
            ];
            write('vsby_check_state.json', { v: 1, at: '2026-10-15T13:20:00.000Z', ok: false, error: 'x', failStreak: 4, failSince: '2026-10-15T10:20:00.000Z' });
            const v = await get('visibility');
            assert.equal(v.status, 'error');
            assert.ok(/empty response/.test(v.detail) && /연속 확인 실패 4회/.test(v.detail), v.detail);
            assert.equal(v.checkedAt, '2026-10-15T22:20:00+09:00');
            const w = await get('warnings');
            assert.equal(w.status, 'stale', '특보: 22:00 이후 1분 회차+10분 여유 지남');
            const e = await get('events');
            assert.equal(e.status, 'partial', '이번 달(2026-10) 행을 쓴다');
            assert.ok(/경상남도/.test(e.detail));
        });
        await check('2단계 부이: 정상 → 기대 시각 지나면 오래됨 → 마지막 시도 실패면 수집 실패(빨강)', async () => {
            write('buoys.json', { updatedAt: '2026. 10. 15. 오전 11:05:54', raw: 'x' });
            now = K('2026-10-15T11:50:00');
            assert.equal((await get('buoys')).status, 'ok');
            now = K('2026-10-15T11:56:00');
            const b = await get('buoys');
            assert.equal(b.status, 'stale');
            assert.equal(b.nextExpectedAt, '2026-10-15T11:35:00+09:00');
            sched = { buoys: { lastRun: '…', status: '실패', message: 'HTTP 503' } };
            const c = await get('buoys');
            assert.equal(c.status, 'error');
            assert.ok(/마지막 시도 실패: HTTP 503/.test(c.detail), c.detail);
            sched = null;
        });
        await check('하루 1번 자료(혼잡예보): 04:00 에 받으면 다음 기대는 다음 날 04:00', async () => {
            write('risk_forecast/sea_traffic.json.gz', { date: '2026-10-15', collectedAt: '2026-10-15T04:00:12+09:00', frames: { a: [1] } });
            now = K('2026-10-15T12:00:00');
            const c = await get('congestion');
            assert.equal(c.nextExpectedAt, '2026-10-16T04:00:00+09:00');
            assert.equal(c.status, 'ok');
            assert.equal(c.basis.raw, '2026-10-15');
        });
        await check('파일이 없으면 지어내지 않는다: 자료 없음·수집 시각 null·다음 회차는 일정표상', async () => {
            const t = await get('typhoon');
            assert.equal(t.status, 'missing');
            assert.equal(t.collectedAt, null);
            assert.equal(t.basis.at, null);
            assert.equal(t.nextFrom, 'schedule');
            assert.equal(t.nextExpectedAt, '2026-10-15T12:07:00+09:00');
        });
        await check('다음 시각을 정할 수 없는 항목은 이유를 준다(너울·행사)', async () => {
            const s = await get('swell');
            assert.equal(s.nextExpectedAt, null);
            assert.ok(/기동 시각/.test(s.nextNote), s.nextNote);
        });
        await check('응답: 근거는 「저장소 경로:줄」이고 그 줄에 인용이 있다 · 절대 경로가 없다', async () => {
            const r = await status.list(),
                text = JSON.stringify(r);
            assert.ok(!text.includes(ROOT) && !text.includes(tmp), '절대 경로 노출');
            const z = r.items.find((i) => i.id === 'zoneForecasts');
            for (const e of z.schedule.evidence) {
                const [file, line] = e.ref.split(':');
                const at = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n')[Number(line) - 1];
                assert.ok(at.includes(e.quote.split('\n')[0]), e.ref);
            }
            assert.equal(r.counts.items, manifest.items.length);
            assert.equal(r.counts.stage1 + r.counts.stage2, r.counts.items);
            assert.equal(r.counts.needCheck, manifest.items.filter((i) => !i.official.kind).length);
            assert.equal(r.items.find((i) => i.id === 'warnings').official.text, '확인 필요');
        });

        // ── ④ 실제 관리자 인증 ──
        await check('API: 토큰 없음 401 · 올바른 토큰 200(no-store) · 계산 실패는 503', async () => {
            const app = express();
            app.use(createRouter({ status, authorize: auth.requireAdminToken }));
            const bad = express();
            bad.use(createRouter({ status: { list: async () => { throw Error('x'); } }, authorize: (q, s, n) => n() }));
            const servers = [app.listen(0, '127.0.0.1'), bad.listen(0, '127.0.0.1')];
            await Promise.all(servers.map((s) => new Promise((r) => s.once('listening', r))));
            try {
                const url = 'http://127.0.0.1:' + servers[0].address().port + '/api/admin/data-collection';
                assert.equal((await fetch(url)).status, 401);
                const token = auth.issueToken('test-only-password', false).token,
                    ok = await fetch(url, { headers: { 'X-Admin-Token': token } });
                assert.equal(ok.status, 200);
                assert.equal(ok.headers.get('cache-control'), 'no-store');
                const body = await ok.json();
                assert.equal(body.ok, true);
                assert.equal(body.items.length, manifest.items.length);
                const r = await fetch('http://127.0.0.1:' + servers[1].address().port + '/api/admin/data-collection');
                assert.equal(r.status, 503);
            } finally {
                await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
            }
        });
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
        console.log(`${pass} PASS / ${fail} FAIL`);
        process.exitCode = fail ? 1 : 0;
    }
})();
