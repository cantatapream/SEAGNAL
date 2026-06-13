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

const ZONE_COLOR = [225, 30, 30];    // 특보구역 테두리 — 빨강 진한 실선
const DANGER_COLOR = [255, 215, 0];  // 위험영역 테두리 — 노랑 진한 점선
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

// ── 위험영역 경계 픽셀 추출(ge3 픽셀 집합의 외곽) ─────────────────────────────
function dangerBorderPixels(dangerIdx, w, h) {
    if (!Array.isArray(dangerIdx) || !dangerIdx.length) return [];
    const set = new Set(dangerIdx);
    const out = [];
    for (let k = 0; k < dangerIdx.length; k++) {
        const p = dangerIdx[k];
        const x = p % w, y = (p / w) | 0;
        // 4방향 중 하나라도 집합 밖(또는 화면 끝)이면 경계.
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
            !set.has(p - 1) || !set.has(p + 1) || !set.has(p - w) || !set.has(p + w)) {
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
// 위험영역 경계를 노랑 점선(흰 halo)으로 RGBA 버퍼에 그린다.
function paintDangerDash(rgba, w, h, border) {
    const DASH = 11, ON = 6; // 점선 주기(켜짐 ON / 전체 DASH)
    for (let k = 0; k < border.length; k++) {
        const p = border[k];
        const x = p % w, y = (p / w) | 0;
        if (((x + y) % DASH) >= ON) continue; // 점선 OFF 구간 건너뜀
        // 흰 halo 3x3 (반투명)
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) setRgba(rgba, w, h, x + ox, y + oy, HALO, 210);
        // 노랑 core 2x2 (불투명)
        for (let oy = 0; oy <= 1; oy++) for (let ox = 0; ox <= 1; ox++) setRgba(rgba, w, h, x + ox, y + oy, DANGER_COLOR, 255);
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
function renderDangerLayer({ decoded, dGE3 }) {
    const { w, h } = decoded;
    const border = dangerBorderPixels(dGE3, w, h);
    if (!border.length) return null;
    const rgba = Buffer.alloc(w * h * 4); // 전부 투명(alpha 0)
    paintDangerDash(rgba, w, h, border);
    return encodePng(w, h, rgba, 4);
}

/**
 * 미리보기 — base + blink 를 한 장(RGB)에 합성(검증/캡처용). 운영 표출은 2레이어 사용.
 */
function renderPreview({ decoded, cal, polys, dGE3 }) {
    const { w, h, rgba } = decoded;
    const rgb = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) { rgb[i * 3] = rgba[i * 4]; rgb[i * 3 + 1] = rgba[i * 4 + 1]; rgb[i * 3 + 2] = rgba[i * 4 + 2]; }
    drawZoneBorder(rgb, w, h, cal, polys);
    const border = dangerBorderPixels(dGE3, w, h);
    const DASH = 11, ON = 6;
    for (let k = 0; k < border.length; k++) {
        const p = border[k]; const x = p % w, y = (p / w) | 0;
        if (((x + y) % DASH) >= ON) continue;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) setRgb(rgb, w, h, x + ox, y + oy, HALO);
        for (let oy = 0; oy <= 1; oy++) for (let ox = 0; ox <= 1; ox++) setRgb(rgb, w, h, x + ox, y + oy, DANGER_COLOR);
    }
    return encodePng(w, h, rgb, 3);
}

module.exports = { renderBaseLayer, renderDangerLayer, renderPreview, ZONE_COLOR, DANGER_COLOR };
