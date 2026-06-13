'use strict';
/**
 * stateManager 통합본 검증 — 5개 mock 시나리오 (네트워크 불필요).
 * 통합본을 require('./stateManager') 로 불러 opts.noWrite + opts.now/prevState 주입.
 * 산출: state_test_integrated.json + stdout 요약.
 */
const fs = require('fs');
const path = require('path');
const { updateState } = require('./stateManager');

const NOW = '2026-06-11T03:00:00.000Z';
const nowMs = Date.parse(NOW);
const H = 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();

const checks = [];
function check(scenario, name, cond, detail) {
    checks.push({ scenario, name, pass: !!cond, detail });
}

// ── 시나리오 1: forecast_eased ──────────────────────────────────────────────
//   prev.active 의 zone A(30kt,3.5m,65%) 가 current 에서 빠지고,
//   zoneSignal A=(18kt,1.5m,prob 0.20), suppressed 없음 → resolved 에 A.
const s1 = updateState(
    {
        baseTimeKST: '2026061100',
        predictions: [
            { office: 'jeju', zone: '제주A', windKt: 30, waveM: 2, probPct: 80, onsetISO: iso(nowMs + 12 * H) },
        ],
        zoneSignals: [
            { office: 'gawn', zone: '강원B', windKt: 18, waveM: 1.5, prob: 0.20 },
        ],
    },
    [], // suppressedZones
    {
        now: NOW, noWrite: true,
        prevState: {
            active: [
                { office: 'jeju', zone: '제주A', windKt: 30, waveM: 2, probPct: 80, onsetISO: iso(nowMs + 12 * H) },
                { office: 'gawn', zone: '강원B', windKt: 30, waveM: 3.5, probPct: 65, onsetISO: iso(nowMs + 10 * H) },
            ],
            resolved: [],
        },
    }
);
const s1res = s1.resolved.find(r => r.zone === '강원B');
const s1active = s1.active.find(a => a.zone === '제주A');
check(1, '강원B resolved 됨', !!s1res, s1res);
check(1, '사유 forecast_eased', s1res && s1res.reason === 'forecast_eased', s1res && s1res.reason);
check(1, 'narrative 30kt→~18kt 포함', s1res && /30kt→~18kt/.test(s1res.narrative), s1res && s1res.narrative);
check(1, 'narrative 65%→20% 포함', s1res && /65%→20%/.test(s1res.narrative), s1res && s1res.narrative);
check(1, 'after probPct 20', s1res && s1res.after && s1res.after.probPct === 20, s1res && s1res.after);
check(1, '제주A active 유지', !!s1active, s1active);
check(1, '제주A resolved 아님', !s1.resolved.find(r => r.zone === '제주A'));

// ── 시나리오 2: suppressed → drop ───────────────────────────────────────────
const s2 = updateState(
    { baseTimeKST: '2026061100', predictions: [], zoneSignals: [] },
    ['X'],
    {
        now: NOW, noWrite: true,
        prevState: {
            active: [{ office: 'busn', zone: 'X', windKt: 35, waveM: 4, probPct: 88, onsetISO: iso(nowMs + 8 * H) }],
            resolved: [],
        },
    }
);
check(2, 'X drop (resolved 없음)', !s2.resolved.find(r => r.zone === 'X'), s2.resolved);
check(2, 'X active 없음', !s2.active.find(a => a.zone === 'X'));

// ── 시나리오 3: onset_passed ────────────────────────────────────────────────
//   onsetISO 가 now 보다 (ONSET_GRACE_H + a)h 과거, zoneSignal 없음 → after null.
const s3 = updateState(
    { baseTimeKST: '2026061100', predictions: [], zoneSignals: [] },
    [],
    {
        now: NOW, noWrite: true,
        prevState: {
            active: [{ office: 'gwju', zone: 'Y', windKt: 28, waveM: 3.2, probPct: 75, onsetISO: iso(nowMs - 12 * H) }],
            resolved: [],
        },
    }
);
const s3res = s3.resolved.find(r => r.zone === 'Y');
check(3, 'Y resolved 됨', !!s3res, s3res);
check(3, '사유 onset_passed', s3res && s3res.reason === 'onset_passed', s3res && s3res.reason);
check(3, 'after null (신호 없음)', s3res && s3res.after === null, s3res && s3res.after);
check(3, 'narrative 예상 시각 경과', s3res && /예상 시각 경과/.test(s3res.narrative), s3res && s3res.narrative);

// ── 시나리오 4: expiry ──────────────────────────────────────────────────────
//   prev.resolved 의 OLD(now-25h) 만료 제거, FRESH(now-2h) 유지.
const s4 = updateState(
    { baseTimeKST: '2026061100', predictions: [], zoneSignals: [] },
    [],
    {
        now: NOW, noWrite: true,
        prevState: {
            active: [],
            resolved: [
                { zone: 'OLD', office: 'jeju', reason: 'forecast_eased', resolvedAt: iso(nowMs - 25 * H), before: {}, after: null, narrative: 'old' },
                { zone: 'FRESH', office: 'jeju', reason: 'forecast_eased', resolvedAt: iso(nowMs - 2 * H), before: {}, after: null, narrative: 'fresh' },
            ],
        },
    }
);
check(4, 'OLD(25h) 만료 제거', !s4.resolved.find(r => r.zone === 'OLD'), s4.resolved.map(r => r.zone));
check(4, 'FRESH(2h) 유지', !!s4.resolved.find(r => r.zone === 'FRESH'), s4.resolved.map(r => r.zone));

// ── 시나리오 5: re-entry ────────────────────────────────────────────────────
//   prev.resolved 의 zone Z 가 current.predictions 에 재등장 → resolved 제거, active 존재.
const s5 = updateState(
    {
        baseTimeKST: '2026061100',
        predictions: [{ office: 'dajn', zone: 'Z', windKt: 26, waveM: 2.1, probPct: 63, onsetISO: iso(nowMs + 6 * H) }],
        zoneSignals: [],
    },
    [],
    {
        now: NOW, noWrite: true,
        prevState: {
            active: [],
            resolved: [
                { zone: 'Z', office: 'dajn', reason: 'forecast_eased', resolvedAt: iso(nowMs - 3 * H), before: {}, after: null, narrative: 'z resolved' },
            ],
        },
    }
);
check(5, 'Z resolved 에서 제거', !s5.resolved.find(r => r.zone === 'Z'), s5.resolved.map(r => r.zone));
check(5, 'Z active 등장', !!s5.active.find(a => a.zone === 'Z'), s5.active.map(a => a.zone));

// ── 시나리오별 PASS 집계 ────────────────────────────────────────────────────
const scenarioIds = [1, 2, 3, 4, 5];
const scenarioResults = scenarioIds.map(id => {
    const cs = checks.filter(c => c.scenario === id);
    const pass = cs.every(c => c.pass);
    return { scenario: id, pass, detail: cs };
});

const passedScn = scenarioResults.filter(s => s.pass).length;
const totalScn = scenarioResults.length;
const passedChecks = checks.filter(c => c.pass).length;

const out = {
    ranAt: new Date().toISOString(),
    fixedNow: NOW,
    summary: {
        scenariosPassed: passedScn,
        scenariosTotal: totalScn,
        checksPassed: passedChecks,
        checksTotal: checks.length,
        allPass: passedScn === totalScn,
    },
    scenarioResults,
    scenarios: {
        s1_forecast_eased: s1,
        s2_suppressed_drop: s2,
        s3_onset_passed: s3,
        s4_expiry: s4,
        s5_reentry: s5,
    },
};
fs.writeFileSync(path.resolve(__dirname, 'state_test_integrated.json'), JSON.stringify(out, null, 2));

console.log('=== stateManager 통합본 검증 (5 시나리오) ===');
for (const s of scenarioResults) {
    console.log(`${s.pass ? 'PASS' : 'FAIL'}  시나리오 ${s.scenario}`);
    for (const c of s.detail) {
        if (!c.pass) console.log(`        FAIL → ${c.name} :: ${JSON.stringify(c.detail)}`);
    }
}
console.log(`\n${passedScn}/${totalScn} 시나리오 PASS  (${passedChecks}/${checks.length} checks)`);
console.log('\n-- 샘플 narrative --');
if (s1res) console.log('S1:', s1res.narrative);
if (s3res) console.log('S3:', s3res.narrative);
process.exit(passedScn === totalScn ? 0 : 1);
