/**
 * ============================================================================
 * geoCalib.js — 청별 차트 위경도 ↔ 픽셀 보정 + 특보구역(부모) 투영 분석
 * ============================================================================
 *
 * dmdw 위험기상일기도(청별 국지 CoWW3)는 고정 템플릿이라 청마다 1회 보정하면 된다.
 * 차트의 위경도 격자선(축 라벨)을 기준으로 affine 보정식을 하드코딩한다:
 *   - 프레임 박스(검정 외곽선)와 내부 1.0° 격자선(검정 실선) 위치를 검출해 derive.
 *   - x = xRefPx + (lon - xRefDeg) * pxPerDeg
 *     y = yRefPx - (lat - yRefDeg) * pxPerDeg   (y는 위도 증가 시 감소)
 *
 * 이 보정으로 seaZoneCoordinates.js 의 '부모 특보구역' 위경도를 차트 픽셀로 투영하고,
 * 그 주변 원형영역의 유의파고 등급을 분석한다(구역별 maxBand).
 *
 * [사용자 합의] 이미지에 연안바다/평수구역 경계선이 없으므로 자식 해역은 구분하지 않고
 *   부모 특보구역(예: 제주도남동쪽안쪽먼바다) 단위로만 매칭한다.
 * ============================================================================
 */
'use strict';

const { GifReader } = require('omggif');
const { classify } = require('./palette');

// ----------------------------------------------------------------------------
// 청별 affine 보정 (차트 격자선에서 1회 derive — 프레임/격자선 검출 + 축 라벨 기준)
//   pxPerDeg: 1.0° 당 픽셀. xRef/yRef: 기준 격자선의 (도, 픽셀).
//   extent: 디버그용 프레임 도메인(프레임 박스 모서리의 위경도).
// ----------------------------------------------------------------------------
const CALIB = {
    // 제주청 CoWW3-JEJU: 프레임 x[1..728] y[29..574], 내부 1.0°선 x=122→124E, y=211→34N.
    //   → 도메인 123.0~129.0E, 31.0~35.5N. 검증: 제주 북부/남부 구역 상하 순서 정상.
    jeju: { xRefDeg: 124, xRefPx: 122, lonPxPerDeg: 121, yRefDeg: 34, yRefPx: 211, latPxPerDeg: 121,
            frame: { x0: 2, x1: 727, y0: 30, y1: 573 } },
};

function calibFor(officeCode) {
    const c = CALIB[officeCode];
    if (!c) return null;
    return {
        xOf: (lon) => c.xRefPx + (lon - c.xRefDeg) * c.lonPxPerDeg,
        yOf: (lat) => c.yRefPx - (lat - c.yRefDeg) * c.latPxPerDeg,
        lonAt: (x) => c.xRefDeg + (x - c.xRefPx) / c.lonPxPerDeg,
        latAt: (y) => c.yRefDeg - (y - c.yRefPx) / c.latPxPerDeg,
        frame: c.frame,
    };
}

function decode(buf) {
    const r = new GifReader(buf);
    const w = r.width, h = r.height;
    const rgba = Buffer.alloc(w * h * 4);
    r.decodeAndBlitFrameRGBA(0, rgba);
    return { w, h, rgba };
}

/**
 * 차트 GIF + 보정 + 구역 위경도 → 그 구역 주변 원형영역(반경 radiusPx)의 유의파고 분석.
 *  마스크(정적요소) 적용. 프레임 밖이면 null.
 * @returns { maxBand, pixelsGE3, pixelsGE5, sampled, cx, cy } | null
 */
function analyzeZone(decoded, calib, zone, opt = {}) {
    const { w, h, rgba } = decoded;
    const radius = opt.radiusPx != null ? opt.radiusPx : 26; // ~0.2° 반경
    const mask = (opt.mask && opt.mask.length === w * h) ? opt.mask : null;
    const minBandPixels = opt.minBandPixels != null ? opt.minBandPixels : 12;
    const cx = Math.round(calib.xOf(zone.lon));
    const cy = Math.round(calib.yOf(zone.lat));
    const fr = calib.frame;
    if (cx < fr.x0 || cx > fr.x1 || cy < fr.y0 || cy > fr.y1) return null;

    const hist = new Map();
    let sampled = 0, ge3 = 0, ge5 = 0;
    const r2 = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
        const y = cy + dy;
        if (y < fr.y0 || y > fr.y1) continue;
        for (let dx = -radius; dx <= radius; dx++) {
            if (dx * dx + dy * dy > r2) continue;
            const x = cx + dx;
            if (x < fr.x0 || x > fr.x1) continue;
            const p = y * w + x;
            if (mask && mask[p]) continue;
            const i = p * 4;
            const band = classify(rgba[i], rgba[i + 1], rgba[i + 2]);
            if (band == null) continue;
            sampled++;
            hist.set(band, (hist.get(band) || 0) + 1);
            if (band >= 3.0) ge3++;
            if (band >= 5.0) ge5++;
        }
    }
    let maxBand = 0;
    for (const [band, n] of hist) if (n >= minBandPixels && band > maxBand) maxBand = band;
    return { maxBand, pixelsGE3: ge3, pixelsGE5: ge5, sampled, cx, cy,
             histogram: Object.fromEntries([...hist.entries()].sort((a, b) => a[0] - b[0])) };
}

module.exports = { CALIB, calibFor, decode, analyzeZone };
