/**
 * calibrate_offices.js — 청별 차트 보정값 산출 (프레임박스 + 라벨범위 기반)
 *
 * [방법] 격자선 직접검출은 바다 많은 차트에서 불안정 → 대신:
 *   1) 검정 프레임 박스 {x0,x1,y0,y1} 검출 (안정적: 전폭/전고 솔리드 검정선)
 *   2) 각 청 축 라벨에서 읽은 '최외곽 라벨 위경도 범위' (LABEL_EXTENT)
 *   3) 규칙: 프레임 모서리 = 최외곽 라벨 ±0.5° (jeju 검증: frame x0=123.0=123.5-0.5 등)
 *   → 선형 보정. 구역 투영으로 검증.
 */
'use strict';
const fs = require('fs');
const { GifReader } = require('omggif');

const code = fs.readFileSync(__dirname + '/../../seaZoneCoordinates.js', 'utf8');
const _m = {}; eval(code + ';_m.Z=SEA_ZONE_COORDINATES;');
const ZONES = Object.values(_m.Z);

// 차트 축 라벨에서 1회 읽은 최외곽 라벨 범위 + 샘플 GIF
const LABEL_EXTENT = {
    jeju: { lon: [123.5, 128.5], lat: [31.5, 35.0], gif: '/tmp/jeju_sample.gif' },
    busn: { lon: [127.5, 130.5], lat: [34.0, 36.5], gif: '/tmp/chart_busn.gif' },
    gwju: { lon: [124.5, 127.5], lat: [33.5, 36.0], gif: '/tmp/chart_gwju.gif' },
    gawn: { lon: [128.0, 132.0], lat: [37.0, 39.5], gif: '/tmp/chart_gawn.gif' },
    dajn: { lon: [123.5, 126.5], lat: [36.5, 38.5], gif: '/tmp/chart_dajn.gif' },
};
const MARGIN = 0.5; // 프레임 모서리 = 최외곽 라벨 ± 0.5°

function decode(buf) {
    const r = new GifReader(buf); const w = r.width, h = r.height;
    const rgba = Buffer.alloc(w * h * 4); r.decodeAndBlitFrameRGBA(0, rgba);
    return { w, h, rgba };
}
const isBlk = (r, g, b) => Math.max(r, g, b) < 85 && (Math.max(r, g, b) - Math.min(r, g, b)) < 28;

// 프레임 박스: 상/하 = 최대 검정 가로선, 좌/우 = 최대 검정 세로선 (각 절반 영역에서 argmax)
function detectFrame(buf) {
    const { w, h, rgba } = decode(buf);
    const px = (x, y) => { const i = (y * w + x) * 4; return [rgba[i], rgba[i + 1], rgba[i + 2]]; };
    const rowC = new Array(h).fill(0), colC = new Array(w).fill(0);
    const xLo = Math.floor(w * 0.03), xHi = Math.floor(w * 0.9);
    const yLo = Math.floor(h * 0.02), yHi = Math.floor(h * 0.92);
    for (let y = 0; y < h; y++) for (let x = xLo; x < xHi; x++) if (isBlk(...px(x, y))) rowC[y]++;
    for (let x = 0; x < w; x++) for (let y = yLo; y < yHi; y++) if (isBlk(...px(x, y))) colC[x]++;
    const argmax = (arr, lo, hi) => { let bi = lo, bv = -1; for (let i = lo; i < hi; i++) if (arr[i] > bv) { bv = arr[i]; bi = i; } return bi; };
    const y0 = argmax(rowC, Math.floor(h * 0.02), Math.floor(h * 0.35));
    const y1 = argmax(rowC, Math.floor(h * 0.55), Math.floor(h * 0.95));
    const x0 = argmax(colC, Math.floor(w * 0.0), Math.floor(w * 0.2));
    const x1 = argmax(colC, Math.floor(w * 0.78), Math.floor(w * 0.92));
    return { w, h, x0, x1, y0, y1 };
}

function calibrate(oc) {
    const e = LABEL_EXTENT[oc];
    const f = detectFrame(fs.readFileSync(e.gif));
    const lonMin = e.lon[0] - MARGIN, lonMax = e.lon[1] + MARGIN;
    const latMin = e.lat[0] - MARGIN, latMax = e.lat[1] + MARGIN;
    // 선형: x0→lonMin, x1→lonMax ; y0→latMax, y1→latMin
    const lonPxPerDeg = (f.x1 - f.x0) / (lonMax - lonMin);
    const latPxPerDeg = (f.y1 - f.y0) / (latMax - latMin);
    const cal = {
        xRefDeg: lonMin, xRefPx: f.x0, lonPxPerDeg,
        yRefDeg: latMax, yRefPx: f.y0, latPxPerDeg,
        frame: { x0: f.x0 + 1, x1: f.x1 - 1, y0: f.y0 + 1, y1: f.y1 - 1 },
    };
    const xOf = (lon) => cal.xRefPx + (lon - cal.xRefDeg) * cal.lonPxPerDeg;
    const yOf = (lat) => cal.yRefPx - (lat - cal.yRefDeg) * cal.latPxPerDeg;
    const inZones = ZONES.filter((z) => z.lon >= lonMin && z.lon <= lonMax && z.lat >= latMin && z.lat <= latMax);
    console.log(`\n=== ${oc} ===  frame=${JSON.stringify(f)}`);
    console.log(`  도메인 lon[${lonMin}~${lonMax}] lat[${latMin}~${latMax}] pxPerLon=${lonPxPerDeg.toFixed(1)} pxPerLat=${latPxPerDeg.toFixed(1)} 포함구역=${inZones.length}`);
    console.log(`  "${oc}": ${JSON.stringify(cal)},`);
    inZones.sort((a, b) => b.lat - a.lat).forEach((z) =>
        console.log(`    ${z.name}(${z.lat},${z.lon}) → px(${Math.round(xOf(z.lon))},${Math.round(yOf(z.lat))})`));
    return cal;
}

const targets = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(LABEL_EXTENT);
const out = {};
targets.forEach((t) => { out[t] = calibrate(t); });
