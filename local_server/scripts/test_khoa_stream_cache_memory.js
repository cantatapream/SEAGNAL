/**
 * 파일명: test_khoa_stream_cache_memory.js
 * 역할: 유향·유속·수온 캐시의 과거 슬롯 제거와 73슬롯 상한을 검증한다.
 * [연계] khoa_stream_cache.js / verify_all.sh.
 * 실제 모듈을 가상 시계·가짜 upstream과 함께 VM에서 실행한다.
 * 외부 요청·인증키·원천 파일 수정 없이 임시 자료만 사용하고 종료 후 정리한다.
 */
'use strict';
const assert = require('assert'),
    fs = require('fs'),
    path = require('path'),
    vm = require('vm'),
    zlib = require('zlib'),
    os = require('os');
const ROOT = process.env.SEAGNAL_REPO_ROOT || path.resolve(__dirname, '..', '..');
const stage =
    process.env.SEAGNAL_CACHE_SOURCE ||
    path.join(ROOT, 'local_server/services/khoa_stream_cache.js');
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'seagnal-khoa-memory-'));
let count = 0;
/**
 * 독립 캐시 검사 환경을 만든다. 시간·실패·정리 타이머를 검사에서 직접 제어한다.
 * @param {string} tag - 임시 폴더를 구분하는 검사 이름
 * @returns {object} 캐시 API와 시계·가짜 호출·타이머 제어 함수
 * [연계] ← 각 회귀 검사. require는 운영 설정 대신 임시 DATA_DIR를 사용한다.
 */
function instance(tag, opts = {}) {
    const dir = path.join(testRoot, tag);
    fs.mkdirSync(dir, { recursive: true });
    let clock = Date.parse('2026-10-13T00:00:00Z'),
        requests = 0,
        fail = false;
    const sweeps = [];
    class ClockDate extends Date {
        constructor(...a) {
            super(...(a.length ? a : [clock]));
        }
        static now() {
            return clock;
        }
    }
    const context = {
        module: { exports: {} },
        exports: {},
        console: { log() {}, warn() {}, error() {} },
        Date: ClockDate,
        Buffer,
        // fastSleep: 정기 수집의 슬롯 사이 500ms 쉬기만 즉시로 바꾼다(73슬롯×0.5초를 기다리지 않게). _sleep 만 setTimeout 을 쓴다.
        setTimeout: opts.fastSleep ? (fn) => setImmediate(fn) : setTimeout,
        setInterval: (fn, ms) => {
            sweeps.push({ fn, ms });
            return { unref() {} };
        },
        global: {
            fetch: async () => {
                requests++;
                if (fail) throw Error('mock offline');
                return {
                    ok: true,
                    text: async () =>
                        JSON.stringify({
                            points: [
                                { lat: 34, lon: 127, s: 1, d: 30, temp: 20, salt: 2, zeta: 4 },
                            ],
                            meta: { id: 'kept' },
                        }),
                };
            },
        },
        require: (n) => (n === '../config/server_config' ? { DATA_DIR: dir } : require(n)),
    };
    vm.runInNewContext(fs.readFileSync(stage, 'utf8'), context);
    return {
        api: context.module.exports,
        dir,
        setNow: (v) => (clock = v),
        now: () => clock,
        requests: () => requests,
        setFail: (v) => (fail = v),
        sweep: () => sweeps.forEach((s) => s.fn()),
        sweeps,
    };
}
/** UTC epoch를 원천 API의 KST 날짜·시간 인자로 바꾼다. 호스트 TZ와 무관하다.
 * @param {number} n - UTC epoch @returns {array} YYYYMMDD, 정시
 * [연계] ← 가상 시간 진행 검사
 */
const kst = (n) => {
    const d = new Date(n + 9 * 3600000);
    return [d.toISOString().slice(0, 10).replaceAll('-', ''), d.getUTCHours()];
};
/** 검사를 실행하고 통과 수를 센다. 실패하면 호출부로 오류를 전달한다.
 * @param {string} label - 검사 설명 @param {function} fn - assert 검사
 * [연계] ← main / 검사 종료 코드
 */
function ok(label, fn) {
    fn();
    count++;
    console.log('PASS ' + label);
}
/** 시간 진행·백업·실패 대체·원천 호환을 순서대로 검사한다. 외부 API는 호출하지 않는다. */
async function main() {
    const a = instance('growth');
    for (let day = 0; day < 8; day++) {
        a.setNow(Date.parse('2026-10-13T00:00:00Z') + day * 86400000);
        for (let h = 0; h <= 72; h++) await a.api.getStream(...kst(a.now() + h * 3600000));
        const size = Object.keys(a.api.getCacheSnapshot().entries).length;
        ok('day ' + (day + 1) + ' cap', () => assert(size <= 73));
    }
    const [d, h] = kst(a.now());
    let r = await a.api.getStream(d, h);
    ok('fields preserved', () =>
        assert.deepStrictEqual(JSON.parse(JSON.stringify(r.points[0])), {
            lat: 34,
            lon: 127,
            s: 1,
            d: 30,
            temp: 20,
        })
    );
    const requests = a.requests();
    await a.api.getStream(d, h);
    ok('cache hit skips upstream', () => assert.equal(a.requests(), requests));
    const [sd, sh] = kst(a.now() + 3 * 3600000);
    await a.api.getStream(sd, sh);
    a.setNow(a.now() + 2 * 3600000);
    a.setFail(true);
    r = await a.api.getStream(sd, sh);
    ok('same future slot keeps stale fallback when refresh fails', () =>
        assert(r.stale && r._failed && r.points.length === 1)
    );
    a.setFail(false);
    a.api.persistToDisk();
    const persisted = JSON.parse(
        zlib.gunzipSync(fs.readFileSync(path.join(a.dir, 'khoa_stream_cache.json.gz')))
    );
    ok('codec2 bounded backup', () =>
        assert(persisted.codec === 2 && Object.keys(persisted.entries).length <= 73)
    );
    const b = instance('restore');
    b.setNow(a.now());
    fs.copyFileSync(
        path.join(a.dir, 'khoa_stream_cache.json.gz'),
        path.join(b.dir, 'khoa_stream_cache.json.gz')
    );
    const restored = b.api.hydrateFromDisk();
    ok('codec2 restore', () =>
        assert(restored > 0 && Object.keys(b.api.getCacheSnapshot().entries).length <= 73)
    );
    const br = await b.api.getStream(...kst(a.now()));
    ok('codec2 points/meta shape', () => assert.equal(br.points[0].s, 1));
    const c = instance('legacy');
    const [cd, ch] = kst(c.now());
    fs.writeFileSync(
        path.join(c.dir, 'khoa_stream_cache.json.gz'),
        zlib.gzipSync(
            JSON.stringify({
                entries: {
                    [cd + '_' + ch]: {
                        ts: c.now(),
                        points: [{ lat: 34, lon: 127, s: 1, d: 30, temp: 20 }],
                        meta: { id: 'old' },
                    },
                },
            })
        )
    );
    ok('legacy backup compatible', () => assert.equal(c.api.hydrateFromDisk(), 1));
    const cr = await c.api.getStream(cd, ch);
    ok('legacy exact meta', () => assert.equal(cr.meta.id, 'old'));
    const base = c.now();
    c.setNow(base + 25 * 3600000);
    await c.api.getStream(...kst(c.now()));
    ok('expired legacy memory removed', () =>
        assert(!Object.hasOwn(c.api.getCacheSnapshot().entries, cd + '_' + ch))
    );
    const e = instance('oversize');
    const target = path.join(e.dir, 'khoa_stream_cache.json.gz');
    fs.writeFileSync(target, zlib.gzipSync(Buffer.alloc(65 * 1024 * 1024, 32)));
    ok('oversized compressed backup rejected before JSON', () =>
        assert.equal(e.api.hydrateFromDisk(), 0)
    );
    ok('rejected backup remains on disk', () => assert(fs.existsSync(target)));
    const concurrent = instance('dedup');
    const pair = await Promise.all([
        concurrent.api.getStream(...kst(concurrent.now())),
        concurrent.api.getStream(...kst(concurrent.now())),
    ]);
    ok('same-key concurrent fetch deduplicated', () => assert.equal(concurrent.requests(), 1));
    ok('dedup returns same data', () => assert.strictEqual(pair[0], pair[1]));
    const outside = instance('outside');
    const outsideKey = kst(outside.now() + 100 * 3600000);
    const outsideResult = await outside.api.getStream(...outsideKey);
    ok('outside-window request retains API return', () =>
        assert.equal(outsideResult.points.length, 1)
    );
    ok('outside-window data not retained', () =>
        assert.equal(Object.keys(outside.api.getCacheSnapshot().entries).length, 0)
    );
    const failures = instance('failure');
    failures.setFail(true);
    await failures.api.getStream(...kst(failures.now())).catch(() => {});
    await failures.api.getStream(...kst(failures.now()));
    ok('failure TTL avoids second upstream', () => assert.equal(failures.requests(), 1));
    failures.setNow(failures.now() + 31000);
    failures.setFail(false);
    await failures.api.getStream(...kst(failures.now()));
    ok('failure expiry retries genuine upstream', () => assert.equal(failures.requests(), 2));
    ok('success removes failure entry', () =>
        assert.equal(failures.api.getCacheSnapshot().failKeys.length, 0)
    );
    const coords = instance('coordinates');
    const normalized = coords.api._normalizeRawPoints([
        { lat: NaN, lon: 127, s: 1, d: 1, temp: 20 },
        { lat: 34, lon: Infinity, s: 1, d: 1, temp: 20 },
        { lat: 91, lon: 127, s: 1, d: 1, temp: 20 },
        { lat: 34, lon: 127, s: Infinity, d: 1, temp: 20 },
        { lat: 34, lon: 127, s: 1, d: 1, temp: 20 },
    ]);
    ok('invalid points omitted without zero replacement', () =>
        assert(normalized.length === 1 && normalized[0].s === 1)
    );
    const corrupt = instance('corrupt');
    const [gd, gh] = kst(corrupt.now());
    const good = {
        ts: corrupt.now(),
        points: [{ lat: 34, lon: 127, s: 1, d: 30, temp: 20 }],
        meta: { id: 'normal' },
    };
    const cb = path.join(corrupt.dir, 'khoa_stream_cache.json.gz');
    fs.writeFileSync(
        cb,
        zlib.gzipSync(
            JSON.stringify({
                codec: 2,
                entries: {
                    [gd + '_' + gh]: 'bad',
                    [gd + '_' + (gh + 1)]: zlib.gzipSync(JSON.stringify(good)).toString('base64'),
                },
            })
        )
    );
    ok('bad codec slot does not block normal slot', () =>
        assert.equal(corrupt.api.hydrateFromDisk(), 1)
    );
    const invalidDate = instance('invalid-date');
    const ret = await invalidDate.api.getStream('20261399', 0);
    ok('malformed calendar key not retained', () =>
        assert.equal(Object.keys(invalidDate.api.getCacheSnapshot().entries).length, 0)
    );
    const aliases = instance('aliases');
    const [ad, ah] = kst(aliases.now());
    await aliases.api.getStream(ad, ah);
    await aliases.api.getStream(ad, String(ah).padStart(2, '0'));
    ok('numeric/padded hour share one cache', () => assert.equal(aliases.requests(), 1));
    const expired = instance('past-slots');
    const start = expired.now();
    await expired.api.getStream(...kst(start));
    await expired.api.getStream(...kst(start + 3600000));
    expired.setNow(start + 3600000);
    await expired.api.getStream(...kst(expired.now()));
    const oldKey = kst(start);
    ok('previous hour immediately evicted', () =>
        assert(
            !Object.hasOwn(
                expired.api.getCacheSnapshot().entries,
                oldKey[0] + '_' + String(oldKey[1]).padStart(2, '0')
            )
        )
    );
    expired.api.persistToDisk();
    const expiredBackup = JSON.parse(
        zlib.gunzipSync(fs.readFileSync(path.join(expired.dir, 'khoa_stream_cache.json.gz')))
    );
    ok('backup excludes previous hour', () =>
        assert(
            !Object.hasOwn(
                expiredBackup.entries,
                oldKey[0] + '_' + String(oldKey[1]).padStart(2, '0')
            )
        )
    );
    const past = instance('past-query');
    const pastHour = kst(past.now() - 3600000);
    const pastReturn = await past.api.getStream(...pastHour);
    ok('explicit same-day past request still returns real source', () =>
        assert.equal(pastReturn.points.length, 1)
    );
    ok('same-day past hour not retained', () =>
        assert.equal(Object.keys(past.api.getCacheSnapshot().entries).length, 0)
    );
    const yesterdayReturn = await past.api.getStream(...kst(past.now() - 86400000));
    ok('yesterday request returns real source but not retained', () =>
        assert(
            yesterdayReturn.points.length === 1 &&
                Object.keys(past.api.getCacheSnapshot().entries).length === 0
        )
    );
    past.api.persistToDisk();
    ok('past-only requests not persisted', () =>
        assert.equal(
            Object.keys(
                JSON.parse(
                    zlib.gunzipSync(
                        fs.readFileSync(path.join(past.dir, 'khoa_stream_cache.json.gz'))
                    )
                ).entries
            ).length,
            0
        )
    );
    const hydratePast = instance('past-hydrate');
    const present = kst(hydratePast.now()),
        previous = kst(hydratePast.now() - 3600000),
        yesterday = kst(hydratePast.now() - 86400000);
    const hp = {
        ts: hydratePast.now(),
        points: [{ lat: 34, lon: 127, s: 1, d: 30, temp: 20 }],
        meta: {},
    };
    const hpfile = path.join(hydratePast.dir, 'khoa_stream_cache.json.gz');
    const hprows = Object.fromEntries(
        [present, previous, yesterday].map(([date, hour]) => [date + '_' + hour, hp])
    );
    fs.writeFileSync(hpfile, zlib.gzipSync(JSON.stringify({ entries: hprows })));
    ok('legacy startup restore excludes prior-hour and yesterday slots', () =>
        assert.equal(hydratePast.api.hydrateFromDisk(), 1)
    );
    const timer = instance('timer');
    await timer.api.getStream(...kst(timer.now()));
    timer.setNow(timer.now() + 3600000);
    timer.sweep();
    ok('past entries removed without user request or collector', () =>
        assert.equal(Object.keys(timer.api.getCacheSnapshot().entries).length, 0)
    );
    ok('background sweep is once per minute', () =>
        assert(timer.sweeps.length === 1 && timer.sweeps[0].ms === 60000)
    );
    ok('background sweep makes no upstream calls', () => assert.equal(timer.requests(), 1));
    // 정기 수집 집계 네 갈래(2026-10-15): 옛 자료로 채운 칸을 「성공」에 섞지 않는다.
    // refreshCycle 의 _toDateHour 는 서버 지역시각을 쓴다(운영 Dockerfile TZ=Asia/Seoul). 시험도 같은 시간대로 맞춘다 — UTC 그대로면
    //   키가 9시간 밀려 끝 9칸이 72시간 밖으로 잘린다(운영과 다른 환경 탓).
    process.env.TZ = 'Asia/Seoul';
    const cy = instance('cycle-counts', { fastSleep: true }), lines = [];
    const log = (l) => lines.push(l);
    let res = await cy.api.refreshCycle({ log });
    ok('cycle: 처음엔 73칸 모두 새로 받음', () => assert.deepEqual([res.fresh, res.kept, res.stale, res.fail], [73, 0, 0, 0]));
    ok('cycle: 로그에 새로 받음·옛 자료로 대체가 따로 찍힘', () => assert.match(lines.at(-1), /새로 받음 73 \/ 최근분 유지 0 \/ 옛 자료로 대체 0 \/ 실패 0/));
    cy.setNow(cy.now() + 30 * 60000);
    const before = cy.requests();
    res = await cy.api.refreshCycle({ log });
    ok('cycle: 30분 뒤엔 1시간 안에 받은 칸을 그대로 둠(외부 요청 0)', () => assert.deepEqual([res.kept, cy.requests() - before], [73, 0]));
    cy.setNow(cy.now() + 2 * 3600000);
    cy.setFail(true);
    res = await cy.api.refreshCycle({ log });
    ok('cycle: 장애 땐 옛 자료로 채운 칸은 「옛 자료로 대체」, 채울 것 없는 칸만 「실패」', () => {
        assert.equal(res.fresh, 0); assert.ok(res.stale >= 1 && res.fail >= 1); assert.equal(res.stale + res.fail, 73);
        assert.equal(res.ok, res.stale);
    });
    console.log('RESULT ' + count + ' PASS / 0 FAIL');
}

main()
    .catch((e) => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(() => fs.rmSync(testRoot, { recursive: true, force: true }));
