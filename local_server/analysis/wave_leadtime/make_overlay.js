'use strict';
/**
 * make_overlay.js — 일기도(제주 풍속 GIF) 위에 특보구역 폴리곤(warn vs sterm)을
 *   CALIB 좌표로 투영해 그려, 폴리곤이 실제 일기도 해역/해안선과 정합하는지 눈으로 검증.
 *   PNG 직접 인코딩(zlib 내장). 외부 이미지 라이브러리 불필요.
 *
 * 실행: node make_overlay.js <gif파일명>
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { decode } = require('./geoCalib');
const { CALIB } = require('./geoCalib');
const { loadZonePolygons, normName } = require('./zonePolygon');
const { ZONES } = require('./zones');

const GIF = path.join(__dirname, 'cache', 'gif');
const STERM = path.resolve(__dirname, '..', '..', 'assets', 'sea_sterm_zones.geojson');
const fn = process.argv[2] || 'kim_cww3_jeju_wind_s000_2023060300.gif';

// jeju CALIB (predictionConfig 와 동일식)
const c = CALIB.jeju;
const xOf = lon => Math.round(c.xRefPx + (lon - c.xRefDeg) * c.lonPxPerDeg);
const yOf = lat => Math.round(c.yRefPx - (lat - c.yRefDeg) * c.latPxPerDeg);

const warnMap = loadZonePolygons();
const stermMap = loadZonePolygons(STERM, { nameKeys: ['sterm_parent'], aliases: new Map([['경기북부앞바다', '인천경기북부앞바다']]) });

const dec = decode(fs.readFileSync(path.join(GIF, fn)));
const { w, h, rgba } = dec;
// rgba → rgb 버퍼 (배경 일기도)
const rgb = Buffer.alloc(w * h * 3);
for (let i = 0; i < w * h; i++) { rgb[i * 3] = rgba[i * 4]; rgb[i * 3 + 1] = rgba[i * 4 + 1]; rgb[i * 3 + 2] = rgba[i * 4 + 2]; }

function setpx(x, y, r, g, b) { if (x < 0 || y < 0 || x >= w || y >= h) return; const p = (y * w + x) * 3; rgb[p] = r; rgb[p + 1] = g; rgb[p + 2] = b; }
function dot(x, y, r, g, b, rad = 2) { for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) setpx(x + dx, y + dy, r, g, b); }
function line(x0, y0, x1, y1, r, g, b) {
    let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy;
    for (; ;) { setpx(x0, y0, r, g, b); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
}
function drawPolys(polys, r, g, b) {
    if (!polys) return;
    for (const poly of polys) for (const ring of poly) {
        for (let i = 0; i < ring.length - 1; i++) line(xOf(ring[i][0]), yOf(ring[i][1]), xOf(ring[i + 1][0]), yOf(ring[i + 1][1]), r, g, b);
    }
}

// 제주 차트 도메인 구역 중심 + warn(빨강) + sterm(청록) 폴리곤
const inFrame = z => { const x = xOf(z.lon), y = yOf(z.lat); return x >= c.frame.x0 && x <= c.frame.x1 && y >= c.frame.y0 && y <= c.frame.y1; };
const domain = ZONES.filter(z => inFrame(z) && (warnMap.has(normName(z.name)) || stermMap.has(normName(z.name))));
console.log(`프레임 ${w}x${h}, 도메인 구역 ${domain.length}개`);
for (const z of domain) {
    const nm = normName(z.name);
    drawPolys(warnMap.get(nm), 255, 40, 40);     // warn = 빨강
    drawPolys(stermMap.get(nm), 0, 220, 255);    // sterm = 청록
    const cx = xOf(z.lon), cy = yOf(z.lat);
    dot(cx, cy, 255, 255, 0, 3);                 // 구역 중심 = 노랑
    console.log(`  ${z.name}: 중심px(${cx},${cy})  warn조각 ${(warnMap.get(nm) || []).length}  sterm조각 ${(stermMap.get(nm) || []).length}`);
}

// CALIB 기준 경위도 격자(초록): 일기도 자체 눈금과 겹치면 CALIB 정확.
for (let lon = 120; lon <= 134; lon++) {
    const x = xOf(lon); const major = lon % 2 === 0;
    for (let y = 0; y < h; y++) setpx(x, y, 0, major ? 200 : 110, 0);
}
for (let lat = 28; lat <= 42; lat++) {
    const y = yOf(lat); const major = lat % 2 === 0;
    for (let x = 0; x < w; x++) setpx(x, y, 0, major ? 200 : 110, 0);
}

// PNG 인코딩 (+ 2x nearest 확대)
const SC = 2;
const bigW = w * SC, bigH = h * SC;
const big = Buffer.alloc(bigW * bigH * 3);
for (let y = 0; y < bigH; y++) for (let x = 0; x < bigW; x++) {
    const sp = ((y / SC | 0) * w + (x / SC | 0)) * 3, dp = (y * bigW + x) * 3;
    big[dp] = rgb[sp]; big[dp + 1] = rgb[sp + 1]; big[dp + 2] = rgb[sp + 2];
}
let crcTable = null;
function crc32(buf) {
    if (!crcTable) { crcTable = []; for (let n = 0; n < 256; n++) { let cc = n; for (let k = 0; k < 8; k++) cc = cc & 1 ? 0xedb88320 ^ (cc >>> 1) : cc >>> 1; crcTable[n] = cc >>> 0; } }
    let crc = 0xffffffff; for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const t = Buffer.from(type); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0); return Buffer.concat([len, t, data, crc]); }
const raw = Buffer.alloc((bigW * 3 + 1) * bigH);
for (let y = 0; y < bigH; y++) { raw[y * (bigW * 3 + 1)] = 0; big.copy(raw, y * (bigW * 3 + 1) + 1, y * bigW * 3, (y + 1) * bigW * 3); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(bigW, 0); ihdr.writeUInt32BE(bigH, 4); ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
const outPath = path.join(__dirname, 'reports', 'overlay_jeju.png');
fs.writeFileSync(outPath, png);
console.log('saved:', outPath);
