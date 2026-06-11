'use strict';
/**
 * run_cycle_test.js — runPrediction 통합 오케스트레이터 검증.
 *
 * 세 의존 함수(generatePredictions / applySuppression / updateState)를 opts.deps
 * 로 mock 주입해, 네트워크 0 으로 5 케이스를 검증한다.
 *
 *   1) happy path — updateState 호출 인자/요약 검증
 *   2) suppressedZones 매핑 (null 제거)
 *   3) 엔진 실패 → ok:false, stage:'generate', updateState 미호출
 *   4) 억제 실패 폴백 → visible=전체, suppressedZones=[], ok:true
 *   5) current 형태 — { baseTimeKST, predictions, zoneSignals } 키/값 일치
 *
 * 산출: cycle_test_integrated.json  +  stdout PASS/FAIL.
 * 실행: node /home/user/SEAGNAL/local_server/advisory/run_cycle_test.js
 */
const fs = require('fs');
const path = require('path');
const { runPredictionCycle } = require('./runPrediction');

const OUT = path.join(__dirname, 'cycle_test_integrated.json');
const results = [];

function rec(name, pass, detail) {
    results.push({ case: name, pass: !!pass, detail });
}

// 공통 mock predictions / zoneSignals
const p1 = { office: 'jeju', zone: 'Z1', windKt: 30, waveM: 3 };
const p2 = { office: 'jeju', zone: 'Z2', windKt: 28, waveM: 2.5 };
const p3 = { office: 'busan', zone: 'Z3', windKt: 26, waveM: 2 };
const zoneSignals = [{ zone: 'Z1', prob: 0.8 }, { zone: 'Z2', prob: 0.6 }];

// deps factory — updateState 호출 인자를 캡처한다.
function makeUpdateCapture(returnVal) {
    const cap = { calls: [] };
    cap.fn = (current, suppressedZones, opts) => {
        cap.calls.push({ current, suppressedZones, opts });
        return returnVal;
    };
    return cap;
}

function deepEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

(async () => {
    // ── 케이스 1: happy path ──────────────────────────────────────────────
    {
        const upd = makeUpdateCapture({ active: [p1, p2], resolved: [] });
        const r = await runPredictionCycle({
            deps: {
                generatePredictions: async () => ({
                    generatedAt: 'G',
                    baseTimeKST: '2026061021',
                    predictions: [p1, p2, p3],
                    zoneSignals,
                }),
                applySuppression: async () => ({
                    visible: [p1, p2],
                    suppressed: [{ zone: 'Zx', reason: 'official' }],
                }),
                updateState: upd.fn,
            },
        });

        const call = upd.calls[0];
        const okReturn = r.ok === true && r.activeCount === 2 && r.suppressedCount === 1 &&
            r.generatedAt === 'G' && r.baseTimeKST === '2026061021' && r.resolvedCount === 0;
        const okCurrent = call && deepEqual(call.current, {
            baseTimeKST: '2026061021',
            predictions: [p1, p2],
            zoneSignals,
        });
        const okZones = call && deepEqual(call.suppressedZones, ['Zx']);
        const pass = okReturn && okCurrent && okZones && upd.calls.length === 1;
        rec('happy_path', pass, {
            ok: r.ok, activeCount: r.activeCount, suppressedCount: r.suppressedCount,
            suppressedZones: call && call.suppressedZones,
            currentMatches: okCurrent, returnMatches: okReturn,
        });
    }

    // ── 케이스 2: suppressedZones 매핑(null 제거) ─────────────────────────
    {
        const upd = makeUpdateCapture({ active: [], resolved: [] });
        const r = await runPredictionCycle({
            deps: {
                generatePredictions: async () => ({
                    generatedAt: 'G2', baseTimeKST: 'B2',
                    predictions: [p1, p2, p3], zoneSignals,
                }),
                applySuppression: async () => ({
                    visible: [p1],
                    suppressed: [{ zone: 'A' }, { zone: 'B' }, { zone: null }],
                }),
                updateState: upd.fn,
            },
        });
        const call = upd.calls[0];
        const pass = r.ok === true && call && deepEqual(call.suppressedZones, ['A', 'B']);
        rec('suppressedZones_mapping', pass, {
            suppressedZones: call && call.suppressedZones, expected: ['A', 'B'],
        });
    }

    // ── 케이스 3: 엔진 실패 → updateState 미호출 ──────────────────────────
    {
        const upd = makeUpdateCapture({ active: [], resolved: [] });
        const r = await runPredictionCycle({
            deps: {
                generatePredictions: async () => { throw new Error('boom-engine'); },
                applySuppression: async () => ({ visible: [], suppressed: [] }),
                updateState: upd.fn,
            },
        });
        const pass = r.ok === false && r.stage === 'generate' && upd.calls.length === 0;
        rec('engine_failure', pass, {
            ok: r.ok, stage: r.stage, updateStateCalls: upd.calls.length, error: r.error,
        });
    }

    // ── 케이스 4: 억제 실패 폴백(과억제 방지) ─────────────────────────────
    {
        const upd = makeUpdateCapture({ active: [p1, p2, p3], resolved: [] });
        const r = await runPredictionCycle({
            deps: {
                generatePredictions: async () => ({
                    generatedAt: 'G4', baseTimeKST: 'B4',
                    predictions: [p1, p2, p3], zoneSignals,
                }),
                applySuppression: async () => { throw new Error('boom-suppress'); },
                updateState: upd.fn,
            },
        });
        const call = upd.calls[0];
        const okVisible = call && deepEqual(call.current.predictions, [p1, p2, p3]);
        const okZones = call && deepEqual(call.suppressedZones, []);
        const pass = r.ok === true && okVisible && okZones &&
            r.activeCount === 3 && r.suppressedCount === 0 && upd.calls.length === 1;
        rec('suppression_fallback', pass, {
            ok: r.ok, activeCount: r.activeCount, suppressedCount: r.suppressedCount,
            predictionsFull: okVisible, suppressedZonesEmpty: okZones,
        });
    }

    // ── 케이스 5: current 형태(키/값 정확) ────────────────────────────────
    {
        const upd = makeUpdateCapture({ active: [p1], resolved: [{ zone: 'Zr' }] });
        const r = await runPredictionCycle({
            deps: {
                generatePredictions: async () => ({
                    generatedAt: 'G5', baseTimeKST: 'B5',
                    predictions: [p1, p2], zoneSignals,
                }),
                applySuppression: async () => ({
                    visible: [p1], suppressed: [{ zone: 'Zs', reason: 'official' }],
                }),
                updateState: upd.fn,
            },
        });
        const call = upd.calls[0];
        const expectedCurrent = { baseTimeKST: 'B5', predictions: [p1], zoneSignals };
        // 키 집합 일치 확인(정확히 이 키만).
        const keysOk = call &&
            deepEqual(Object.keys(call.current).sort(), ['baseTimeKST', 'predictions', 'zoneSignals']);
        const valOk = call && deepEqual(call.current, expectedCurrent);
        const resolvedOk = r.resolvedCount === 1;
        const pass = keysOk && valOk && resolvedOk;
        rec('current_shape', pass, {
            keys: call && Object.keys(call.current), valueMatches: valOk,
            resolvedCount: r.resolvedCount,
        });
    }

    // ── 결과 기록 + 요약 ──────────────────────────────────────────────────
    const allPass = results.every((r) => r.pass);
    fs.writeFileSync(OUT, JSON.stringify({
        generatedAt: new Date().toISOString(),
        allPass,
        passCount: results.filter((r) => r.pass).length,
        total: results.length,
        results,
    }, null, 2));

    for (const r of results) {
        console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.case}`);
    }
    console.log(`\n${allPass ? 'ALL PASS' : 'SOME FAIL'} (${results.filter((r) => r.pass).length}/${results.length})`);
    console.log(`결과: ${OUT}`);
    process.exit(allPass ? 0 : 1);
})().catch((e) => {
    console.error('FATAL', e);
    process.exit(1);
});
