/**
 * run_onsetscan_test.js — frame-outer(onsetScan) ↔ zone-outer(원본) 동치 증명.
 *
 *   네트워크/디코드 없이, 합성 신호표(sig[frameId][zoneId] = {wB,vB})로
 *   두 알고리즘을 같은 입력에 돌려 "각 해역의 onset/밴드/peak"이 100% 동일한지
 *   무작위 시나리오 N회 검증한다. 추가로 frame-outer 가 프레임을 1회만,
 *   그리고 onset 확정 이후 불필요한 프레임을 받지 않음을 검증한다.
 *
 * 실행: node /home/user/SEAGNAL/local_server/advisory/run_onsetscan_test.js
 * 산출: onsetscan_test_integrated.json
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { scanOnsets } = require('./onsetScan');

const results = [];
function rec(name, pass, detail) {
    results.push({ case: name, pass: !!pass, detail: detail || '' });
    console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : ''));
}

// ── 결정론적 PRNG (재현 가능) ────────────────────────────────────────────────
function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ── 원본 zone-outer 로직(참조 구현) — predictionEngine.js 225~271 행 복제 ──────
//   캐시 없는 순수 버전. 결과(onset/밴드/peak)는 캐시 유무와 무관하므로 동치 비교에 적합.
function refScanZoneOuter({ primary, waveByVt, hasWind, zones, windCut, waveCut, bandWind, bandWave }) {
    const out = new Map();
    for (const z of zones) {
        let onset = null, windBand = 0, waveBand = 0, peakWind = 0, peakWave = 0;
        for (const { f, vt } of primary) {
            let wB = 0, vB = 0;
            if (hasWind) { wB = bandWind(f, z) || 0; }
            const waveFrame = hasWind ? waveByVt.get(vt.getTime()) : f;
            if (waveFrame) { vB = bandWave(waveFrame, z) || 0; }
            if (wB > peakWind) peakWind = wB;
            if (vB > peakWave) peakWave = vB;
            if (wB >= windCut || vB >= waveCut) { onset = vt; windBand = wB; waveBand = vB; break; }
        }
        out.set(z, { onset, windBand, waveBand, peakWind, peakWave });
    }
    return out;
}

function resEqual(a, b) {
    const ao = a.onset ? a.onset.getTime() : null;
    const bo = b.onset ? b.onset.getTime() : null;
    return ao === bo && a.windBand === b.windBand && a.waveBand === b.waveBand &&
        a.peakWind === b.peakWind && a.peakWave === b.peakWave;
}

// ── 무작위 시나리오 1건 생성 + 두 알고리즘 비교 ──────────────────────────────
async function runScenario(rng) {
    const hasWind = rng() < 0.8; // 20% 는 파고 단독(풍속 시퀀스 없음)
    const N = 1 + Math.floor(rng() * 14);   // 프레임 1~15
    const Z = 1 + Math.floor(rng() * 9);    // 해역 1~9
    const windCut = 20, waveCut = 3;

    // 프레임/해역
    const primary = [];
    for (let i = 0; i < N; i++) primary.push({ f: { id: 'w' + i }, vt: new Date(i * 3600000) });
    const zones = [];
    for (let j = 0; j < Z; j++) zones.push({ k: 'z' + j });

    // waveByVt: hasWind 일 때 일부 프레임은 파고 매칭 없음(누락) 모사
    const waveByVt = new Map();
    for (let i = 0; i < N; i++) {
        if (!hasWind || rng() < 0.85) waveByVt.set(primary[i].vt.getTime(), { id: 'v' + i });
    }

    // 합성 신호표: (프레임핸들 id, 해역 k) → 밴드값. 임계 근처로 분포시켜 onset 다양화.
    const windTbl = {}, waveTbl = {};
    const band = (cut) => {
        const r = rng();
        if (r < 0.55) return Math.floor(rng() * cut);          // 임계 미만
        if (r < 0.6) return 0;                                  // 0
        return cut + Math.floor(rng() * (cut + 5));             // 임계 이상
    };
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < Z; j++) {
            windTbl['w' + i + '|z' + j] = band(windCut);
            waveTbl['v' + i + '|z' + j] = band(waveCut);
        }
    }
    const bandWindByHandle = (handle, z) => windTbl[handle.id + '|' + z.k] || 0;
    const bandWaveByHandle = (handle, z) => waveTbl[handle.id + '|' + z.k] || 0;

    // 참조(zone-outer)
    const ref = refScanZoneOuter({
        primary, waveByVt, hasWind, zones, windCut, waveCut,
        bandWind: bandWindByHandle, bandWave: bandWaveByHandle,
    });

    // frame-outer(onsetScan) — decodeFrame 은 핸들 그대로 반환, 밴드는 디코드본(=핸들)에서 조회.
    const decoded = new Set();
    const got = await scanOnsets({
        primary, waveByVt, hasWind, zones, windCut, waveCut,
        decodeFrame: async (h) => { decoded.add(h.id); return h; },
        bandWind: (dec, z) => bandWindByHandle(dec, z),
        bandWave: (dec, z) => bandWaveByHandle(dec, z),
    });

    // (1) 결과 동치
    for (const z of zones) {
        if (!resEqual(ref.get(z), got.get(z))) {
            return { ok: false, why: 'result-mismatch', zone: z.k, ref: ref.get(z), got: got.get(z), hasWind, N, Z };
        }
    }

    // (2) 디코드 효율: 각 프레임 1회 + onset 전부 확정된 깊이까지만.
    //   기대 깊이 D = onset 없는 해역이 있으면 N-1, 아니면 max(onsetIndex).
    let anyNoOnset = false, maxOnsetIdx = -1;
    for (const z of zones) {
        const r = ref.get(z);
        if (!r.onset) { anyNoOnset = true; }
        else { maxOnsetIdx = Math.max(maxOnsetIdx, Math.round(r.onset.getTime() / 3600000)); }
    }
    const D = anyNoOnset ? (N - 1) : maxOnsetIdx;
    const expected = new Set();
    for (let i = 0; i <= D; i++) {
        if (hasWind) expected.add('w' + i);
        const wh = hasWind ? waveByVt.get(primary[i].vt.getTime()) : primary[i].f;
        if (wh) expected.add(wh.id);
    }
    // decoded ⊆ expected 이고 expected ⊆ decoded (정확히 일치)
    if (decoded.size !== expected.size) {
        return { ok: false, why: 'decode-count', decoded: [...decoded].sort(), expected: [...expected].sort(), hasWind, N, Z };
    }
    for (const id of expected) {
        if (!decoded.has(id)) return { ok: false, why: 'decode-missing', id, hasWind, N, Z };
    }
    return { ok: true };
}

(async () => {
    const rng = mulberry32(20260611);
    let fails = 0; let firstFail = null;
    const TRIALS = 5000;
    for (let t = 0; t < TRIALS; t++) {
        const r = await runScenario(rng);
        if (!r.ok) { fails++; if (!firstFail) firstFail = r; }
    }
    rec('equivalence_5000_random', fails === 0,
        fails === 0 ? '5000개 시나리오 결과·디코드효율 동치' : `${fails}건 실패, 첫 실패: ${JSON.stringify(firstFail)}`);

    // 고정 케이스: onset 없는 해역 → 전 프레임 디코드 / peak 누적 확인
    {
        const zones = [{ k: 'a' }];
        const primary = [0, 1, 2].map((i) => ({ f: { id: 'w' + i }, vt: new Date(i * 3600000) }));
        const tbl = { 'w0|a': 5, 'w1|a': 12, 'w2|a': 8 }; // 모두 windCut(20) 미만 → onset 없음, peak=12
        const got = await scanOnsets({
            primary, waveByVt: new Map(), hasWind: true, zones, windCut: 20, waveCut: 3,
            decodeFrame: async (h) => h,
            bandWind: (dec, z) => tbl[dec.id + '|' + z.k] || 0,
            bandWave: () => 0,
        });
        const r = got.get(zones[0]);
        rec('no_onset_peak', r.onset === null && r.peakWind === 12 && r.windBand === 0,
            JSON.stringify({ onset: r.onset, peakWind: r.peakWind, windBand: r.windBand }));
    }

    // 고정 케이스: 첫 임계초과에서 즉시 onset + 이후 프레임 미디코드
    {
        const zones = [{ k: 'a' }];
        const primary = [0, 1, 2, 3].map((i) => ({ f: { id: 'w' + i }, vt: new Date(i * 3600000) }));
        const tbl = { 'w0|a': 5, 'w1|a': 25, 'w2|a': 99, 'w3|a': 99 }; // onset at i=1
        const decoded = new Set();
        const got = await scanOnsets({
            primary, waveByVt: new Map(), hasWind: true, zones, windCut: 20, waveCut: 3,
            decodeFrame: async (h) => { decoded.add(h.id); return h; },
            bandWind: (dec, z) => tbl[dec.id + '|' + z.k] || 0,
            bandWave: () => 0,
        });
        const r = got.get(zones[0]);
        const pass = r.windBand === 25 && Math.round(r.onset.getTime() / 3600000) === 1 &&
            decoded.has('w0') && decoded.has('w1') && !decoded.has('w2') && !decoded.has('w3');
        rec('early_onset_stops_decode', pass,
            JSON.stringify({ windBand: r.windBand, decoded: [...decoded] }));
    }

    const allPass = results.every((r) => r.pass);
    const OUT = path.join(__dirname, 'onsetscan_test_integrated.json');
    fs.writeFileSync(OUT, JSON.stringify({
        generatedAt: new Date().toISOString(), allPass,
        passed: results.filter((r) => r.pass).length, total: results.length, results,
    }, null, 2));
    console.log('---------------------------------------------------');
    console.log((allPass ? 'ALL PASS' : 'SOME FAILED') +
        '  (' + results.filter((r) => r.pass).length + '/' + results.length + ')');
    console.log('결과 기록: ' + OUT);
    process.exit(allPass ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
