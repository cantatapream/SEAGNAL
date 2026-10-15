/** 역할: 임시자료에서 오류이력 중복·복구·상한·비밀 배제와 실제 관리자 HTTP 인증을 검사한다.
 * [연계] risk_error_history / risk_errors / 기존 admin_auth. 외부 수집·실사용 인증키 없음.
 */
'use strict';
const fs = require('fs'),
    os = require('os'),
    path = require('path'),
    assert = require('assert'),
    express = require('express'),
    vm = require('vm');
const { createRequire } = require('module');
const { createHistory, STATES } = require('../services/risk_error_history'),
    io = require('../services/risk_collector_io');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'risk-errors-'));
const TEST_PASSWORD = 'test-only-password';
/** 실제 관리자 인증 코드를 임시 토큰 폴더에서 실행한다. 기존 토큰 파일을 읽거나 쓰지 않는다.
 * @returns {object} 실제 인증 모듈 API [연계] 관리자 HTTP 인증 회귀 검사
 */
function isolatedAuth() {
    const filename = path.join(__dirname, '../services/admin_auth.js'),
        module = { exports: {} };
    const context = {
        module,
        exports: module.exports,
        require: createRequire(filename),
        __dirname: path.join(dir, 'auth', 'services'),
        __filename: filename,
        process: { env: { ADMIN_PASSWORD: TEST_PASSWORD } },
        console: { log() {}, warn() {}, error() {} },
        Buffer,
        Date,
        setInterval: () => ({ unref() {} }),
        clearInterval() {},
    };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, {
        filename,
    });
    return module.exports;
}
const auth = isolatedAuth();
// 실제 라우터의 기본 인증 의존성에 위의 실제 인증 코드를 연결한다.
const routerFile = path.join(__dirname, '../routes/risk_errors.js'),
    routeModule = { exports: {} },
    routeRequire = createRequire(routerFile);
vm.runInNewContext(
    fs.readFileSync(routerFile, 'utf8'),
    {
        module: routeModule,
        exports: routeModule.exports,
        require: (name) =>
            name === '../services/admin_auth' ? auth : routeRequire(name),
    },
    { filename: routerFile }
);
const { createRouter } = routeModule.exports;
let now = Date.parse('2026-10-12T09:00:00+09:00'),
    pass = 0,
    fail = 0;
const history = createHistory({
    dir,
    clock: () => now,
    maxRecords: 5,
    retentionDays: 2,
});
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
    let server;
    try {
        await check('반복된 같은 오류는 새 이력 없이 유지', () => {
            for (let i = 0; i < 10; i++) {
                now += 60000;
                history.observeSources({
                    accident: { status: 'error', lastError: 'HTTP 400' },
                });
            }
            assert.equal(history.list().data.length, 1);
            assert.equal(history.list().current[0].code, 'HTTP 400');
        });
        await check('재기동 후 같은 오류도 중복 없음', () => {
            createHistory({
                dir,
                clock: () => now,
                maxRecords: 5,
            }).observeSources({
                accident: { status: 'error', lastError: 'HTTP 400' },
            });
            assert.equal(history.list().data.length, 1);
        });
        await check('정상 회복 한 건과 문제 변경 한 건', () => {
            now += 60000;
            history.observeSources({ accident: { status: 'ok' } });
            assert.equal(history.list().data[0].phase, 'recovered');
            now += 60000;
            history.observeSources({ accident: { status: 'missing' } });
            now += 60000;
            history.observeSources({ accident: { status: 'stale' } });
            assert.equal(history.list().data[0].phase, 'changed');
            assert.equal(history.list().data.length, 4);
        });
        await check('비밀·URL·쿠키·HTML 포함 오류는 고정 분류만 저장', () => {
            history.observeSources({
                congestion: {
                    status: 'error',
                    lastError:
                        'https://private/?serviceKey=SECRET cookie=PRIVATE <script>bad</script>',
                    updatedAt: 'PRIVATE',
                    lastSuccess: 'https://private',
                },
            });
            const raw = fs.readFileSync(
                path.join(dir, 'error_history.json'),
                'utf8'
            );
            for (const word of ['SECRET', 'PRIVATE', 'script', 'https:'])
                assert.ok(!raw.includes(word));
            assert.equal(history.list().data[0].code, 'network or parse error');
        });
        await check('offseason과 정상 행사 없음은 문제를 만들지 않음', () => {
            const before = history.list().data.length;
            history.observeSources({
                ripCurrent: { status: 'offseason' },
                events: { months: { '2026-10': { status: 'ok', count: 0 } } },
            });
            assert.equal(history.list().data.length, before);
        });
        await check('상태 변화가 많아도 건수와 파일 바이트 상한 유지', () => {
            for (let i = 0; i < 20; i++)
                history.observeSources({
                    congestion: {
                        status: i % 2 ? 'ok' : 'error',
                        lastError: 'HTTP 400',
                    },
                });
            assert.equal(history.list().pagination.total, 5);
            assert.ok(
                fs.statSync(path.join(dir, 'error_history.json')).size <
                    1024 * 1024
            );
        });
        await check('보관기간 지난 이력 삭제와 현재 문제 유지', () => {
            now += 3 * 86400000;
            history.observeSources({ accident: { status: 'stale' } });
            assert.equal(history.list().data.length, 0);
            assert.equal(
                history.list().current.find((r) => r.source === 'accident')
                    .status,
                'stale'
            );
        });
        await check('현재 source상태 감시만으로 missing·stale 기록', () => {
            const monitor = createHistory({
                dir: path.join(dir, 'monitor'),
                clock: () => now,
            });
            monitor.observeSources({ warnings: { status: 'missing' } });
            now += 60000;
            monitor.observeSources({ warnings: { status: 'stale' } });
            assert.equal(monitor.list().data.length, 2);
        });
        await check('월별 행사와 공통 상태 기록은 같은 이력에 합침', () => {
            const eventsDir = path.join(dir, 'events');
            io.status(eventsDir, 'events_202610', now, Error('HTTP 400'), {
                month: '2026-10',
            });
            io.status(eventsDir, 'events', now, Error('HTTP 400'), {
                month: '2026-10',
            });
            const h = createHistory({ dir: eventsDir });
            assert.equal(h.list().data.length, 1);
            assert.equal(h.list().data[0].scope, '2026-10');
        });
        await check(
            '60개월 정상·오류 전환도 현재 월 상한과 재기동을 유지',
            () => {
                const yearsDir = path.join(dir, 'years'),
                    h = createHistory({ dir: yearsDir, clock: () => now });
                for (let i = 0; i < 60; i++) {
                    const month = new Date(Date.UTC(2020, i, 1))
                        .toISOString()
                        .slice(0, 7);
                    assert.equal(
                        h.observeSources({
                            events: {
                                months: {
                                    [month]: {
                                        status: i % 2 ? 'ok' : 'error',
                                        lastError: 'HTTP 400',
                                    },
                                },
                            },
                            accident: { status: 'missing' },
                        }),
                        true
                    );
                }
                const current = createHistory({ dir: yearsDir }).list().current;
                // 2026-10-15 3차 검토 F2: 감시가 보는 달보다 앞선 달은 닫힌다 — 감시만으로는 마지막 달 하나만 남는다.
                assert.equal(
                    current.filter((r) => r.source === 'events').length,
                    1
                );
                // 현재 월 상한(4)은 수집기 기록 경로로 확인한다(수집기 기록은 지난 달을 닫지 않는다).
                const capped = createHistory({ dir: path.join(dir, 'years-cap'), clock: () => now });
                for (let i = 0; i < 60; i++) {
                    const month = new Date(Date.UTC(2020, i, 1)).toISOString().slice(0, 7);
                    assert.equal(capped.recordCollector('events_' + month.replace('-', ''), { month, status: i % 2 ? 'ok' : 'error', lastError: 'HTTP 400' }), true);
                }
                assert.equal(capped.list().current.filter((r) => r.source === 'events').length, 4);
                assert.equal(
                    current.filter((r) => r.source === 'accident').length,
                    1
                );
                assert.equal(
                    h.observeSources({ accident: { status: 'ok' } }),
                    true
                );
            }
        );
        await check('깨진 이력은 정상 빈 목록으로 감추지 않음', () => {
            const broken = path.join(dir, 'broken');
            fs.mkdirSync(broken);
            fs.writeFileSync(path.join(broken, 'error_history.json'), 'broken');
            assert.throws(
                () => createHistory({ dir: broken }).list(),
                /history unavailable/
            );
        });
        await check('이력 저장 실패가 실제 수집 성공을 바꾸지 않음', () => {
            const failed = path.join(dir, 'failed');
            fs.mkdirSync(failed);
            fs.writeFileSync(path.join(failed, 'error_history.json'), 'broken');
            io.status(failed, 'accident', now, null);
            assert.equal(
                io.read(path.join(failed, 'accident_status.json')).status,
                'ok'
            );
        });
        await check(
            '건수 상한 전에도 작은 파일 바이트 상한으로 이력 제한',
            () => {
                const smallDir = path.join(dir, 'small'),
                    h = createHistory({
                        dir: smallDir,
                        clock: () => now,
                        maxRecords: 1000,
                        maxBytes: 1400,
                    });
                for (let i = 0; i < 70; i++) {
                    now += 1000;
                    assert.equal(
                        h.observeSources({
                            warnings: {
                                status: i % 2 ? 'ok' : 'error',
                                lastError: 'HTTP 429',
                            },
                        }),
                        true
                    );
                }
                assert.ok(
                    fs.statSync(path.join(smallDir, 'error_history.json'))
                        .size <= 1400
                );
                assert.ok(h.list().pagination.total < 70);
                assert.ok(h.list().pagination.total > 0);
            }
        );
        await check(
            '운영 감시가 화면 접속 없이 시작·60초 stale·중복 시작 방지',
            async () => {
                let tick,
                    cleared = false,
                    reads = 0;
                const m = { exports: {} },
                    context = {
                        module: m,
                        exports: m.exports,
                        require: (n) =>
                            n === './risk_collector_io' ? io : require(n),
                        process: { env: { FLY_ALLOC_ID: 'test-only' } },
                        console,
                        Buffer,
                        setInterval: (fn, ms) => {
                            assert.equal(ms, 60000);
                            tick = fn;
                            return { unref() {} };
                        },
                        clearInterval: () => {
                            cleared = true;
                        },
                    };
                vm.runInNewContext(
                    fs.readFileSync(
                        path.join(
                            __dirname,
                            '../services/risk_error_history.js'
                        ),
                        'utf8'
                    ),
                    context
                );
                const h = m.exports.createHistory({
                        dir: path.join(dir, 'timer'),
                        clock: () => now,
                    }),
                    store = {
                        sources: (fresh) => {
                            assert.equal(fresh, true);
                            reads++;
                            return {
                                warnings: {
                                    status: reads === 1 ? 'ok' : 'stale',
                                },
                            };
                        },
                    };
                assert.equal(h.start(store), true);
                assert.equal(h.start(store), false);
                assert.equal(reads, 0);
                await tick();
                await tick();
                assert.equal(h.list().data[0].status, 'stale');
                assert.equal(reads, 2);
                h.stop();
                assert.equal(cleared, true);
            }
        );
        await check(
            '느린 비동기 감시는 겹치지 않고 중지 뒤 늦은 결과를 기록하지 않음',
            async () => {
                let tick,
                    release,
                    calls = 0;
                const file = path.join(
                        __dirname,
                        '../services/risk_error_history.js'
                    ),
                    module = { exports: {} };
                vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
                    module,
                    exports: module.exports,
                    require: (n) =>
                        n === './risk_collector_io' ? io : require(n),
                    process: { env: { FLY_ALLOC_ID: 'test-only' } },
                    console,
                    Buffer,
                    setInterval: (fn) => {
                        tick = fn;
                        return { unref() {} };
                    },
                    clearInterval() {},
                });
                const h = module.exports.createHistory({
                    dir: path.join(dir, 'async-watch'),
                    clock: () => now,
                });
                h.start(() => {
                    calls++;
                    return new Promise((resolve) => {
                        release = resolve;
                    });
                });
                const pending = tick();
                await tick();
                assert.equal(calls, 1);
                h.stop();
                release({ warnings: { status: 'missing' } });
                await pending;
                assert.equal(h.list().current.length, 0);
            }
        );
        await check('실시간 교통의 수집 실패·복구도 기록', () => {
            const h = createHistory({
                dir: path.join(dir, 'live'),
                clock: () => now,
            });
            h.recordCollector('realtime', {
                status: 'error',
                lastError: 'HTTP 502',
                lastRun: io.iso(now),
            });
            h.observeSources({
                realtime: {
                    status: 'ok',
                    lastSuccess: io.iso(now),
                    updatedAt: io.iso(now),
                },
            });
            assert.equal(h.list().data[0].phase, 'recovered');
            assert.equal(h.list().data[1].source, 'realtime');
            assert.equal(h.list().data[1].code, 'HTTP 502');
        });
        await check(
            '실시간 자료 관측시각을 수집시각으로 대체해도 유효 ISO만 저장',
            () => {
                const h = createHistory({
                    dir: path.join(dir, 'live-times'),
                    clock: () => now,
                });
                h.observeSources({
                    realtime: {
                        status: 'stale',
                        updatedAt: 'not an ISO',
                        collectedAt: io.iso(now),
                        lastSuccess: io.iso(now),
                    },
                });
                assert.equal(h.list().current[0].updatedAt, io.iso(now));
            }
        );
        await check('원천 설명문은 사고·실시간 고정 식별자를 덮지 않음', () => {
            const h = createHistory({
                dir: path.join(dir, 'identity'),
                clock: () => now,
            });
            h.observeSources({
                accident: { source: '공식 MTIS 사고', status: 'missing' },
                realtime: { source: null, status: 'stale' },
            });
            assert.deepEqual(
                h
                    .list()
                    .current.map((r) => r.source)
                    .sort(),
                ['accident', 'realtime']
            );
        });
        await check(
            '복구 다음 정상 감시에도 복구시각 유지·삭제에도 마지막 성공 보존',
            () => {
                const h = createHistory({
                    dir: path.join(dir, 'recovery-times'),
                    clock: () => now,
                });
                const success = io.iso(now);
                h.observeSources({
                    realtime: {
                        status: 'ok',
                        lastSuccess: success,
                        updatedAt: success,
                    },
                });
                now += 60000;
                h.observeSources({ realtime: { status: 'missing' } });
                assert.equal(h.list().current[0].lastSuccess, success);
                assert.equal(h.list().data[0].updatedAt, success);
                now += 60000;
                h.observeSources({
                    realtime: { status: 'ok', lastSuccess: io.iso(now) },
                });
                const recovered = h.list().current[0].recoveredAt;
                assert.ok(recovered);
                now += 60000;
                h.observeSources({ realtime: { status: 'ok' } });
                assert.equal(h.list().current[0].recoveredAt, recovered);
            }
        );
        await check('해구별 시정 원천도 이력·현재 상태에 기록', () => {
            const h = createHistory({
                dir: path.join(dir, 'visibility'),
                clock: () => now,
            });
            const success = io.iso(now - 3 * 86400000);
            h.observeSources({
                visibility: {
                    status: 'error',
                    lastError: 'empty response',
                    lastSuccess: success,
                    updatedAt: success,
                    checkedAt: io.iso(now),
                },
            });
            const row = h
                .list()
                .current.find((r) => r.source === 'visibility');
            assert.ok(row);
            assert.equal(row.code, 'empty response');
            assert.equal(row.lastSuccess, success);
            assert.equal(
                h.list({ source: 'visibility' }).data[0].phase,
                'opened'
            );
        });
        await check('원천·상태 필터는 이력뿐 아니라 현재 상태에도 적용', () => {
            const h = createHistory({
                dir: path.join(dir, 'filter-current'),
                clock: () => now,
            });
            h.observeSources({
                visibility: { status: 'error', lastError: 'empty response' },
                realtime: { status: 'error', lastError: 'HTTP 503' },
                accident: { status: 'stale' },
                warnings: { status: 'ok' },
            });
            const sources = (f) =>
                h.list(f).current.map((r) => r.source).sort().join(',');
            assert.equal(sources({}), 'accident,realtime,visibility,warnings');
            assert.equal(sources({ source: 'visibility' }), 'visibility');
            assert.equal(sources({ status: 'error' }), 'realtime,visibility');
            assert.equal(sources({ source: 'accident', status: 'error' }), '');
        });
        // 2026-10-15 사용자: 「우리 앱에 저장실패했다는 내용을 알려야하겠지? … 통합관리자 센터에서.」
        await check(
            '일부 실패(partial): 행사 수집 ok + failedProvinceCount>0 만 · 두 상태 파일 한 건 · 재기동 후 읽기 · 필터 · 오류로 바뀌면 changed · 다른 원천 영향 없음',
            () => {
                const partialDir = path.join(dir, 'partial'),
                    h = createHistory({ dir: partialDir, clock: () => now }),
                    st = {
                        month: '2026-10',
                        status: 'ok',
                        lastError: null,
                        failedProvinces: ['경상남도'],
                        failedProvinceCount: 1,
                        detail: '시도 실패 경상남도(Gemini 호출 실패)',
                    };
                assert.ok(STATES.includes('partial'));
                h.recordCollector('events_202610', st);
                h.recordCollector('events', st);
                const row = () =>
                    h.list().current.find((r) => r.source === 'events');
                assert.equal(row().status, 'partial');
                // partialCode 가 없는 상태 파일(이 변경 전 수집기)은 원인 모름 분류(3차 검토 F5).
                assert.equal(row().code, '행사 일부 실패');
                assert.equal(row().detail, st.detail);
                assert.deepEqual(
                    h.list().data.map((e) => [e.phase, e.status]),
                    [['opened', 'partial']]
                );
                h.observeSources({
                    warnings: { status: 'ok' },
                    accident: { status: 'ok' },
                    ripCurrent: { status: 'offseason' },
                    realtime: { status: 'error', lastError: 'HTTP 503' },
                });
                const statusOf = (source) =>
                    h.list().current.find((r) => r.source === source).status;
                assert.equal(statusOf('warnings'), 'ok');
                assert.equal(statusOf('ripCurrent'), 'offseason');
                assert.equal(statusOf('realtime'), 'error');
                const again = createHistory({
                    dir: partialDir,
                    clock: () => now,
                }).list({ status: 'partial' });
                assert.deepEqual(
                    again.current.map((r) => r.source + ':' + r.scope),
                    ['events:2026-10'],
                    '저장 파일을 다시 읽어도(clean) partial 유지'
                );
                assert.equal(again.data.length, 1);
                now += 60000;
                h.recordCollector('events', {
                    ...st,
                    status: 'error',
                    lastError: 'HTTP 500',
                });
                assert.equal(row().status, 'error');
                assert.equal(h.list().data[0].phase, 'changed');
            }
        );
        // 2026-10-15 3차 검토 F2: 달이 바뀐 뒤 지난 달 「일부 실패」가 현재 목록에 약 3개월 고정됐다.
        await check('지난 달 닫기: 감시가 더 보지 않는 지난 달의 문제 상태(일부 실패·실패)는 「수집 종료」 사건을 남기고 현재 목록에서 빠짐 · 정상 지난 달은 조용히 빠짐 · 지금 달은 닫지 않음', () => {
            let clock = Date.parse('2026-10-31T12:00:00+09:00');
            const h = createHistory({ dir: path.join(dir, 'past-month'), clock: () => clock }),
                cur = () => h.list({ source: 'events' }).current.map((r) => r.scope + ':' + r.status).sort();
            h.recordCollector('events_202608', { month: '2026-08', status: 'ok' });
            h.recordCollector('events_202609', { month: '2026-09', status: 'error', lastError: 'HTTP 500' });
            h.observeSources({ events: { months: { '2026-10': { status: 'ok', failedProvinceCount: 1, partialCode: '행사 일부 실패 — 공식 목록' }, '2026-11': { status: 'error', lastError: 'HTTP 500' } } } });
            assert.deepEqual(cur(), ['2026-10:partial', '2026-11:error'], '감시 달보다 앞선 8·9월은 닫힘');
            const closed9 = h.list({ source: 'events' }).data.find((e) => e.scope === '2026-09' && e.phase === 'recovered');
            assert.equal(closed9.status, 'offseason');
            assert.equal(closed9.detail, '지난 달 — 더 수집하지 않음(마지막 상태: HTTP 500)');
            assert.ok(!h.list({ source: 'events' }).data.some((e) => e.scope === '2026-08' && e.phase === 'recovered'), '정상 지난 달은 사건 없이 빠짐');
            clock = Date.parse('2026-11-01T00:01:00+09:00');
            h.observeSources({ events: { months: { '2026-11': { status: 'error', lastError: 'HTTP 500' } } } });
            assert.deepEqual(cur(), ['2026-11:error']);
            const closed10 = h.list({ source: 'events' }).data[0];
            assert.deepEqual([closed10.scope, closed10.phase, closed10.status, closed10.code], ['2026-10', 'recovered', 'offseason', null]);
            assert.equal(closed10.detail, '지난 달 — 더 수집하지 않음(마지막 상태: 행사 일부 실패 — 공식 목록)');
            assert.equal(h.list({ status: 'partial' }).data.filter((e) => e.scope === '2026-10').length, 1, '원래 문제 사건(opened)은 이력에 남음');
            // 다시 읽어도(clean) 유효, 다음 관찰에서 같은 사건을 또 만들지 않음
            h.observeSources({ events: { months: { '2026-11': { status: 'error', lastError: 'HTTP 500' } } } });
            assert.equal(createHistory({ dir: path.join(dir, 'past-month'), clock: () => clock }).list({ source: 'events' }).data.filter((e) => e.phase === 'recovered').length, 2);
            // 감시 달이 다음 달뿐이어도 지금 달은 닫지 않는다
            const g = createHistory({ dir: path.join(dir, 'past-month-2'), clock: () => Date.parse('2026-10-12T09:00:00+09:00') });
            g.observeSources({ events: { months: { '2026-10': { status: 'missing' } } } });
            g.observeSources({ events: { months: { '2026-11': { status: 'ok' } } } });
            assert.deepEqual(g.list().current.filter((r) => r.source === 'events').map((r) => r.scope).sort(), ['2026-10', '2026-11']);
            // 행사 달이 없는 관찰은 닫지 않는다
            g.observeSources({ warnings: { status: 'ok' } });
            assert.equal(g.list().current.filter((r) => r.source === 'events').length, 2);
        });
        // 2026-10-15 3차 검토 F5: partial 분류가 늘 「Gemini 일부 실패」라 원인이 바뀌어도 사건이 안 남았다.
        await check('일부 실패 분류는 원인별(partialCode) · 원인이 바뀌면 문제 변경 사건 · 칸 없는 감시 행은 앞 분류 유지 · 고정 이름 밖은 받지 않음 · 옛 이름은 읽힘', () => {
            let clock = Date.parse('2026-10-12T03:21:00+09:00');
            const pdir = path.join(dir, 'partial-code'),
                h = createHistory({ dir: pdir, clock: () => clock }),
                row = () => h.list({ source: 'events' }).current.find((r) => r.scope === '2026-10'),
                phases = () => h.list({ source: 'events' }).data.map((e) => e.phase + '|' + e.code).reverse();
            const st = (code) => ({ month: '2026-10', status: 'ok', failedProvinceCount: 1, partialCode: code });
            h.recordCollector('events_202610', st('행사 일부 실패 — Gemini'));
            assert.equal(row().code, '행사 일부 실패 — Gemini');
            clock += 60000;
            h.observeSources({ events: { months: { '2026-10': { status: 'ok', failedProvinceCount: 1 } } } });
            assert.equal(row().code, '행사 일부 실패 — Gemini', '감시 행에 칸이 없으면 앞 분류 유지(가짜 변경 없음)');
            clock += 86400000;
            h.recordCollector('events_202610', st('행사 일부 실패 — 공식 목록'));
            assert.deepEqual(phases(), ['opened|행사 일부 실패 — Gemini', 'changed|행사 일부 실패 — 공식 목록']);
            h.recordCollector('events_202610', st('<script>아무 글</script>'));
            assert.equal(row().code, '행사 일부 실패 — 공식 목록', '고정 이름 밖 글은 받지 않고 앞 분류 유지');
            const fresh = createHistory({ dir: path.join(dir, 'partial-code-2'), clock: () => clock });
            fresh.recordCollector('events_202610', st('<script>아무 글</script>'));
            assert.equal(fresh.list().current[0].code, '행사 일부 실패', '앞 분류가 없으면 원인 모름 분류');
            const file = path.join(pdir, 'error_history.json'), data = JSON.parse(fs.readFileSync(file, 'utf8'));
            data.current['events:2026-10'].code = 'Gemini 일부 실패';
            data.events[0].code = 'Gemini 일부 실패';
            fs.writeFileSync(file, JSON.stringify(data));
            assert.equal(createHistory({ dir: pdir, clock: () => clock }).list().current.find((r) => r.source === 'events').code, 'Gemini 일부 실패', '이 변경 전 이력 파일의 옛 이름도 읽힘');
        });
        await check('이미 보유한 파일 잠금은 다른 변경을 차단', () => {
            const release = io.acquireLock(
                path.join(dir, 'error_history.json.lock')
            );
            try {
                assert.equal(
                    history.observeSources({ warnings: { status: 'missing' } }),
                    false
                );
            } finally {
                release();
            }
        });
        const app = express();
        app.use(createRouter({ history }));
        server = app.listen(0, '127.0.0.1');
        await new Promise((resolve) => server.once('listening', resolve));
        const url =
            'http://127.0.0.1:' +
            server.address().port +
            '/api/admin/risk-forecast/errors';
        await check('토큰 없음·잘못된 토큰은 관리자 HTTP401', async () => {
            assert.equal((await fetch(url)).status, 401);
            assert.equal(
                (await fetch(url, { headers: { 'X-Admin-Token': 'wrong' } }))
                    .status,
                401
            );
        });
        const token = auth.issueToken(TEST_PASSWORD, false).token;
        await check(
            '기존 관리자 토큰으로만 조회·캐시 금지·페이지 상한',
            async () => {
                const r = await fetch(url + '?limit=2', {
                    headers: { 'X-Admin-Token': token },
                });
                assert.equal(r.status, 200);
                assert.equal(r.headers.get('cache-control'), 'no-store');
                assert.equal((await r.json()).pagination.limit, 2);
                assert.equal(
                    (
                        await fetch(url + '?source=visibility', {
                            headers: { 'X-Admin-Token': token },
                        })
                    ).status,
                    200
                );
                assert.equal(
                    (
                        await fetch(url + '?status=partial', {
                            headers: { 'X-Admin-Token': token },
                        })
                    ).status,
                    200,
                    '「일부 실패」 상태 필터'
                );
                for (const query of [
                    'limit=101',
                    'page=-1',
                    'source=private',
                    'status=bad',
                    'from=https://private',
                ])
                    assert.equal(
                        (
                            await fetch(url + '?' + query, {
                                headers: { 'X-Admin-Token': token },
                            })
                        ).status,
                        400
                    );
            }
        );
        await check('이력 처리 실패는 고정 관리자 오류만 반환', async () => {
            history.list = () => {
                throw Error('https://private?serviceKey=SECRET');
            };
            const r = await fetch(url, { headers: { 'X-Admin-Token': token } });
            assert.equal(r.status, 503);
            assert.ok(!(await r.text()).includes('SECRET'));
        });
    } finally {
        if (server) await new Promise((resolve) => server.close(resolve));
        fs.rmSync(dir, { recursive: true, force: true });
        console.log(`${pass} PASS / ${fail} FAIL`);
        process.exit(fail ? 1 : 0);
    }
})();
