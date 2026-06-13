'use strict';
/**
 * ============================================================================
 * advisory/overlayRenderer.js — 위험기상 일기도 오버레이(2레이어)
 * ============================================================================
 *
 * 카드 '일기도 보기'용 이미지를 두 레이어로 생성한다(면 채색 없음, 선만):
 *   - base  PNG(RGB)  : 일기도 + 특보구역 테두리(빨강 진한 실선, 고정)
 *   - blink PNG(RGBA) : 투명 배경 + 위험영역(임계초과) 경계(노랑 진한 점선)
 *                       프론트에서 겹쳐 올려 CSS 로 깜빡(opacity 맥동)시킨다.
 *                       → 깜빡 레이어가 위 = 위험영역 점선이 특보구역 실선 위.
 *
 * 선 가독성: 노랑/빨강이 일기도 풍속색(노/주/빨)에 묻히지 않도록 얇은 흰 외곽(halo).
 * 외부 이미지 라이브러리 불필요(zlib 직접).
 * ============================================================================
 */
const zlib = require('zlib');

const ZONE_COLOR = [25, 25, 25];     // 특보구역 테두리 — 검정 진한 실선
const DANGER_COLOR = [225, 0, 0];    // 위험영역 테두리 — 빨강 진한 점선
const HALO = [255, 255, 255];        // 흰 외곽(가독성)

// ── RGB 버퍼 픽셀/선 ────────────────────────────────────────────────────────
function setRgb(buf, w, h, x, y, c) {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const o = (y * w + x) * 3;
    buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2];
}
function lineRgb(buf, w, h, x0, y0, x1, y1, c, thick) {
    const t = Math.max(1, thick | 0);
    let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy;
    for (; ;) {
        for (let oy = 0; oy < t; oy++) for (let ox = 0; ox < t; ox++) setRgb(buf, w, h, x0 + ox, y0 + oy, c);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
    }
}
// 특보구역 폴리곤 테두리(흰 외곽 위 색선).
function drawZoneBorder(buf, w, h, cal, polys) {
    if (!Array.isArray(polys)) return;
    const draw = (color, thick) => {
        for (const poly of polys) {
            if (!Array.isArray(poly)) continue;
            for (const ring of poly) {
                if (!Array.isArray(ring)) continue;
                for (let i = 0; i < ring.length - 1; i++) {
                    lineRgb(buf, w, h,
                        Math.round(cal.xOf(ring[i][0])), Math.round(cal.yOf(ring[i][1])),
                        Math.round(cal.xOf(ring[i + 1][0])), Math.round(cal.yOf(ring[i + 1][1])),
                        color, thick);
                }
            }
        }
    };
    draw(HALO, 4);        // 흰 외곽
    draw(ZONE_COLOR, 2);  // 빨강 실선
}

// ── 위험영역 경계 픽셀 추출 ─────────────────────────────────────────────────
//   ge3 픽셀은 내부에 구멍이 많다(바람 화살표·격자·글자 픽셀이 풍속색이 아니라
//   임계초과로 분류되지 않아 빠짐). 그 구멍 가장자리까지 경계로 잡히면 점선이
//   영역 내부에 흩뿌려진다. → 구역(zone) 내부에서 '바깥과 연결되지 않은' 비위험
//   픽셀(=내부 구멍)을 메운 뒤(hole-fill) 바깥 윤곽선만 딴다.
function dangerBorderPixels(dangerIdx, zoneIdx, w, h) {
    if (!dangerIdx || !dangerIdx.length) return [];
    let danger = new Set(dangerIdx);
    let filled = danger;

    if (zoneIdx && zoneIdx.length) { // 배열/TypedArray 모두 허용(zonePixelIndices 는 Int32Array)
        const zone = new Set(zoneIdx);
        // 모폴로지 닫힘(팽창→침식, 반경 R) — 위험영역 내부 구멍(바람 화살표·격자
        //   픽셀이 임계초과로 분류되지 않아 생김)을 메운다. 그 구멍은 화살표 통로로
        //   바깥까지 이어져 flood 방식 hole-fill 은 무력하므로 closing 을 쓴다.
        //   외곽 크기는 보존되어 윤곽선만 깔끔히 남는다(점선이 내부에 흩뿌려지지 않음).
        const R = 4;
        const dil = new Set();
        for (const p of danger) {
            const x = p % w, y = (p / w) | 0;
            for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
                const q = (y + dy) * w + (x + dx);
                if (zone.has(q)) dil.add(q);
            }
        }
        const ero = new Set();
        for (const p of dil) {
            const x = p % w, y = (p / w) | 0;
            let ok = true;
            for (let dy = -R; dy <= R && ok; dy++) {
                for (let dx = -R; dx <= R; dx++) {
                    const q = (y + dy) * w + (x + dx);
                    if (zone.has(q) && !dil.has(q)) { ok = false; break; } // 구역 밖 이웃은 무시 → 구역 경계 보존
                }
            }
            if (ok) ero.add(p);
        }
        filled = ero;
    }

    const out = [];
    for (const p of filled) {
        const x = p % w, y = (p / w) | 0;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
            !filled.has(p - 1) || !filled.has(p + 1) || !filled.has(p - w) || !filled.has(p + w)) {
            out.push(p);
        }
    }
    return out;
}

// ── RGBA 픽셀(투명 레이어용) ────────────────────────────────────────────────
function setRgba(buf, w, h, x, y, c, a) {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const o = (y * w + x) * 4;
    buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = a;
}
// 위험영역 경계를 빨강 실선(흰 halo)으로 RGBA 버퍼에 그린다(내부는 투명).
//   halo 를 먼저 전부 깔고 그 위에 빨강을 올려야 선이 halo 에 덮이지 않는다.
function paintDangerOutline(rgba, w, h, border) {
    for (let k = 0; k < border.length; k++) { // 흰 halo 5x5 (반투명)
        const p = border[k]; const x = p % w, y = (p / w) | 0;
        for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) setRgba(rgba, w, h, x + ox, y + oy, HALO, 200);
    }
    for (let k = 0; k < border.length; k++) { // 빨강 실선 3x3 (불투명)
        const p = border[k]; const x = p % w, y = (p / w) | 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) setRgba(rgba, w, h, x + ox, y + oy, DANGER_COLOR, 255);
    }
}

// ── PNG 인코딩(RGB type2 / RGBA type6) ──────────────────────────────────────
let _crcTable = null;
function crc32(buf) {
    if (!_crcTable) {
        _crcTable = [];
        for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; _crcTable[n] = c >>> 0; }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) crc = _crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
}
function encodePng(w, h, buf, channels) {
    const ch = channels === 4 ? 4 : 3;
    const stride = w * ch + 1;
    const raw = Buffer.alloc(stride * h);
    for (let y = 0; y < h; y++) { raw[y * stride] = 0; buf.copy(raw, y * stride + 1, y * w * ch, (y + 1) * w * ch); }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = ch === 4 ? 6 : 2;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

/**
 * base 레이어 — 일기도 + 특보구역 테두리(빨강 실선). 면 채색 없음.
 * @returns {Buffer} RGB PNG
 */
function renderBaseLayer({ decoded, cal, polys }) {
    const { w, h, rgba } = decoded;
    const rgb = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) { rgb[i * 3] = rgba[i * 4]; rgb[i * 3 + 1] = rgba[i * 4 + 1]; rgb[i * 3 + 2] = rgba[i * 4 + 2]; }
    drawZoneBorder(rgb, w, h, cal, polys);
    return encodePng(w, h, rgb, 3);
}

/**
 * blink 레이어 — 투명 배경 + 위험영역 경계(노랑 점선). 프론트에서 깜빡 표시.
 *   dGE3(임계초과 픽셀 위치)의 외곽만 점선으로. 비면 null(레이어 없음).
 * @returns {Buffer|null} RGBA PNG
 */
function renderDangerLayer({ decoded, dGE3, zoneIdx }) {
    const { w, h } = decoded;
    const border = dangerBorderPixels(dGE3, zoneIdx, w, h);
    if (!border.length) return null;
    const rgba = Buffer.alloc(w * h * 4); // 전부 투명(alpha 0)
    paintDangerOutline(rgba, w, h, border);
    return encodePng(w, h, rgba, 4);
}

/**
 * 미리보기 — base + blink 를 한 장(RGB)에 합성(검증/캡처용). 운영 표출은 2레이어 사용.
 */
function renderPreview({ decoded, cal, polys, dGE3, zoneIdx }) {
    const { w, h, rgba } = decoded;
    const rgb = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) { rgb[i * 3] = rgba[i * 4]; rgb[i * 3 + 1] = rgba[i * 4 + 1]; rgb[i * 3 + 2] = rgba[i * 4 + 2]; }
    drawZoneBorder(rgb, w, h, cal, polys);
    const border = dangerBorderPixels(dGE3, zoneIdx, w, h);
    for (let k = 0; k < border.length; k++) { // 흰 halo
        const p = border[k]; const x = p % w, y = (p / w) | 0;
        for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) setRgb(rgb, w, h, x + ox, y + oy, HALO);
    }
    for (let k = 0; k < border.length; k++) { // 빨강 실선
        const p = border[k]; const x = p % w, y = (p / w) | 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) setRgb(rgb, w, h, x + ox, y + oy, DANGER_COLOR);
    }
    return encodePng(w, h, rgb, 3);
}

module.exports = { renderBaseLayer, renderDangerLayer, renderPreview, ZONE_COLOR, DANGER_COLOR };
