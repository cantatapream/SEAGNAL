'use strict';
/**
 * run_zonepolygon_test.js — zonePolygon 샘플러 검증.
 *   합성 프레임/폴리곤으로 sampled·maxBand·areaFraction 정확도 + 실제 geojson 로드 확인.
 * 실행: node analysis/wave_leadtime/run_zonepolygon_test.js
 */
const { loadZonePolygons, analyzeZonePolygon, pointInRing } = require('./zonePolygon');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

// ── 1) point-in-ring 기본 ────────────────────────────────────────────────────
const sq = [[1.5, 1.5], [5.5, 1.5], [5.5, 5.5], [1.5, 5.5], [1.5, 1.5]];
ok('pip_inside', pointInRing(3, 3, sq) === true);
ok('pip_outside', pointInRing(0, 0, sq) === false);
ok('pip_outside2', pointInRing(6, 3, sq) === false);

// ── 2) analyzeZonePolygon — 합성 프레임 ──────────────────────────────────────
// 10x10, calib=identity, 정사각 폴리곤 lon/lat[1.5..5.5] → 내부 픽셀 x,y∈{2,3,4,5}=16개.
// 모든 R=10, 그 중 x,y∈{3,4,5} 9픽셀만 R=30. classify=R. ge3Level=20, minBandPixels=5.
(function () {
    const w = 10, h = 10;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let p = 0; p < w * h; p++) rgba[p * 4] = 10; // 모두 R=10
    for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) rgba[(y * w + x) * 4] = 30; // 9픽셀 R=30
    const decoded = { w, h, rgba };
    const calib = { xOf: (lon) => lon, yOf: (lat) => lat, frame: { x0: 0, x1: 9, y0: 0, y1: 9 } };
    const polys = [[[[1.5, 1.5], [5.5, 1.5], [5.5, 5.5], [1.5, 5.5], [1.5, 1.5]]]];
    const classify = (r) => r; // 밴드 = R 값
    const a = analyzeZonePolygon(decoded, calib, polys, { classify, ge3Level: 20, ge5Level: 40, minBandPixels: 5 });
    ok('poly_sampled16', a && a.sampled === 16, a && ('sampled=' + a.sampled));
    ok('poly_maxBand30', a && a.maxBand === 30, a && ('maxBand=' + a.maxBand));
    ok('poly_ge3_9', a && a.pixelsGE3 === 9, a && ('ge3=' + a.pixelsGE3));
    ok('poly_areaFrac', a && Math.abs(a.areaFraction - 9 / 16) < 1e-9, a && ('frac=' + a.areaFraction));

    // 마스크로 high 픽셀 4개 가리면 ge3=5, frac=5/12
    const mask = new Uint8Array(w * h);
    let masked = 0;
    for (let y = 3; y <= 4; y++) for (let x = 3; x <= 4; x++) { mask[y * w + x] = 1; masked++; }
    const b = analyzeZonePolygon(decoded, calib, polys, { classify, ge3Level: 20, ge5Level: 40, minBandPixels: 5, mask });
    ok('poly_mask_sampled', b && b.sampled === 16 - masked, b && ('sampled=' + b.sampled));
    ok('poly_mask_ge3', b && b.pixelsGE3 === 9 - masked, b && ('ge3=' + b.pixelsGE3));
})();

// ── 3) 폴리곤 밖이면 sampled 적음(침범 없음) ─────────────────────────────────
(function () {
    const w = 10, h = 10;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let p = 0; p < w * h; p++) rgba[p * 4] = 30; // 전부 high
    const decoded = { w, h, rgba };
    const calib = { xOf: (lon) => lon, yOf: (lat) => lat, frame: { x0: 0, x1: 9, y0: 0, y1: 9 } };
    // 작은 폴리곤(2x2 영역)만 → 전부 high여도 sampled 는 폴리곤 내부(~4)만
    const polys = [[[[2.5, 2.5], [4.5, 2.5], [4.5, 4.5], [2.5, 4.5], [2.5, 2.5]]]];
    const a = analyzeZonePolygon(decoded, calib, polys, { classify: (r) => r, ge3Level: 20, ge5Level: 40, minBandPixels: 1 });
    ok('poly_no_bleed', a && a.sampled <= 9, a && ('sampled=' + a.sampled)); // 전체 100 아님
})();

// ── 4) 실제 geojson 로드 ─────────────────────────────────────────────────────
(function () {
    const m = loadZonePolygons();
    ok('geojson_loaded', m.size >= 40, 'size=' + m.size);
    const { normName } = require('./zonePolygon');
    ok('has_jeju_far', m.has(normName('제주도남쪽바깥먼바다')), '제주도남쪽바깥먼바다 폴리곤');
    ok('has_donghae_far', m.has(normName('동해남부남쪽안쪽먼바다')), '동해남부남쪽안쪽먼바다 폴리곤(정규화)');
})();

console.log('---------------------------------------------------');
console.log((fail === 0 ? 'ALL PASS' : 'SOME FAILED') + '  (' + pass + '/' + (pass + fail) + ')');
process.exit(fail === 0 ? 0 : 1);
