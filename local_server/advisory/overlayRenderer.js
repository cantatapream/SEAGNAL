'use strict';
/**
 * ============================================================================
 * advisory/overlayRenderer.js — 위험기상 일기도 오버레이 PNG 생성
 * ============================================================================
 *
 * 일기도(청별 풍속/파고 GIF) 디코드 결과 위에, 특보구역 폴리곤 테두리와
 * "위험영역"(임계 초과 픽셀)을 등급색으로 그려 PNG 버퍼를 만든다.
 *   - 사용자가 "이 구역의 이 부분 때문에 예측이 떴구나"를 눈으로 보게 한다.
 *   - 전체 청 차트 그대로(크롭 없음). 외부 이미지 라이브러리 불필요(zlib 직접).
 *
 * [설계] 무거운 GIF 디코드는 호출측(예측 사이클 자식 프로세스)이 책임지고,
 *   본 모듈은 디코드 결과(decoded)만 받아 합성→PNG 인코딩한다(순수, IO 없음).
 *
 * @example
 *   const png = renderZoneOverlay({ decoded, cal, polys, dGE3, dGE5, gradeKey });
 *   fs.writeFileSync(out, png);
 * ============================================================================
 */
const zlib = require('zlib');

// 등급색 — 일기도 풍속 팔레트(파·녹·노·주·빨)와 겹치지 않는 대비색.
//   높음=자홍(마젠타), 관심=보라. 어느 배경 위에서도 식별된다.
const GRADE_COLOR = {
    high: [235, 0, 140],
    watch: [150, 60, 235],
};
const BORDER_HALO = [255, 255, 255]; // 테두리 흰색 외곽(가독성)

// ── 픽셀 합성 헬퍼 ──────────────────────────────────────────────────────────
function blendIndices(rgb, indices, color, alpha) {
    if (!Array.isArray(indices) || !indices.length) return;
    const [cr, cg, cb] = color;
    const a = alpha, ia = 1 - alpha;
    for (let k = 0; k < indices.length; k++) {
        const o = indices[k] * 3;
        rgb[o] = (rgb[o] * ia + cr * a) | 0;
        rgb[o + 1] = (rgb[o + 1] * ia + cg * a) | 0;
        rgb[o + 2] = (rgb[o + 2] * ia + cb * a) | 0;
    }
}
function setPx(rgb, w, h, x, y, c) {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const o = (y * w + x) * 3;
    rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2];
}
// 두께 thick(px) 의 선(Bresenham + 주변 채움).
function drawLine(rgb, w, h, x0, y0, x1, y1, c, thick) {
    const t = Math.max(1, thick | 0);
    let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy;
    for (; ;) {
        for (let oy = 0; oy < t; oy++) for (let ox = 0; ox < t; ox++) setPx(rgb, w, h, x0 + ox, y0 + oy, c);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
    }
}
function drawPolygonBorder(rgb, w, h, cal, polys, color, thick) {
    if (!Array.isArray(polys)) return;
    for (const poly of polys) {
        if (!Array.isArray(poly)) continue;
        for (const ring of poly) {
            if (!Array.isArray(ring)) continue;
            for (let i = 0; i < ring.length - 1; i++) {
                const x0 = Math.round(cal.xOf(ring[i][0])), y0 = Math.round(cal.yOf(ring[i][1]));
                const x1 = Math.round(cal.xOf(ring[i + 1][0])), y1 = Math.round(cal.yOf(ring[i + 1][1]));
                drawLine(rgb, w, h, x0, y0, x1, y1, color, thick);
            }
        }
    }
}

// ── PNG 인코딩(24bit RGB, zlib) ─────────────────────────────────────────────
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
function encodePng(w, h, rgb) {
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; // 8bit, RGB
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

/**
 * 위험기상 일기도 오버레이 PNG 생성.
 * @param {object} p
 * @param {{w,h,rgba}} p.decoded  일기도 디코드 결과
 * @param {{xOf:(lon)=>number, yOf:(lat)=>number}} p.cal  경위도→픽셀 보정
 * @param {Array} p.polys  특보구역 폴리곤([[ring...]])
 * @param {number[]} p.dGE3  위험영역(임계초과) 픽셀 인덱스 — 연한 색칠
 * @param {number[]} p.dGE5  경보급 픽셀 인덱스 — 진한 색칠
 * @param {'high'|'watch'} p.gradeKey  등급(색 결정)
 * @returns {Buffer} PNG
 */
function renderZoneOverlay({ decoded, cal, polys, dGE3, dGE5, gradeKey }) {
    const { w, h, rgba } = decoded;
    const rgb = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) { rgb[i * 3] = rgba[i * 4]; rgb[i * 3 + 1] = rgba[i * 4 + 1]; rgb[i * 3 + 2] = rgba[i * 4 + 2]; }
    const color = GRADE_COLOR[gradeKey] || GRADE_COLOR.watch;
    // 위험영역 색칠 — 해당 구역 폴리곤 내부의 임계초과 픽셀에만(dGE3/dGE5 는 이미
    //   그 구역 인덱스로 한정 → 인접 구역엔 칠하지 않음). 배경 풍속색과 대비되도록
    //   진하게: ge3(거침) 0.45, ge5(경보) 0.75. ge5 를 나중에 칠해 위로 덮음.
    blendIndices(rgb, dGE3, color, 0.45);
    blendIndices(rgb, dGE5, color, 0.75);
    // 구역 테두리 — 흰색 외곽(4px) 위에 등급색(2px) → 어떤 배경에서도 또렷.
    drawPolygonBorder(rgb, w, h, cal, polys, BORDER_HALO, 4);
    drawPolygonBorder(rgb, w, h, cal, polys, color, 2);
    return encodePng(w, h, rgb);
}

module.exports = { renderZoneOverlay, encodePng, GRADE_COLOR };
