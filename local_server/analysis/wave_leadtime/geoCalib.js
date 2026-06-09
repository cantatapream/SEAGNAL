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
// 청별 affine 보정 — 프레임박스(검출) + 최외곽 라벨범위 ±0.5° 규칙으로 산출.
//   (calibrate_offices.js 로 derive. 차트 축 라벨에서 라벨범위 1회 확인)
//   xOf(lon)=xRefPx+(lon-xRefDeg)*lonPxPerDeg, yOf(lat)=yRefPx-(lat-yRefDeg)*latPxPerDeg
// ----------------------------------------------------------------------------
const CALIB = {
    // 제주청 123.5~128.5E,31.5~35N (검증: 2025-12-21 강풍 남쪽구역 5.5m 포착)
    jeju: { xRefDeg: 123, xRefPx: 1, lonPxPerDeg: 121.17, yRefDeg: 35.5, yRefPx: 29, latPxPerDeg: 121.33, frame: { x0: 2, x1: 727, y0: 30, y1: 574 } },
    // 부산청 127.5~130.5E,34~36.5N
    busn: { xRefDeg: 127, xRefPx: 1, lonPxPerDeg: 181.75, yRefDeg: 37, yRefPx: 29, latPxPerDeg: 155.71, frame: { x0: 2, x1: 727, y0: 30, y1: 573 } },
    // 광주청 124.5~127.5E,33.5~36N
    gwju: { xRefDeg: 124, xRefPx: 1, lonPxPerDeg: 181.75, yRefDeg: 36.5, yRefPx: 29, latPxPerDeg: 129.71, frame: { x0: 2, x1: 727, y0: 30, y1: 482 } },
    // 강원청 128~132E,37~39.5N (대구·경북 동해 해역도 이 차트 도메인에 포함 → degu 도 사용)
    gawn: { xRefDeg: 127.5, xRefPx: 1, lonPxPerDeg: 145.4, yRefDeg: 40, yRefPx: 28, latPxPerDeg: 132.29, frame: { x0: 2, x1: 727, y0: 29, y1: 490 } },
    // 대전청 123.5~126.5E,36.5~38.5N
    dajn: { xRefDeg: 123, xRefPx: 1, lonPxPerDeg: 181.75, yRefDeg: 39, yRefPx: 29, latPxPerDeg: 182.0, frame: { x0: 2, x1: 727, y0: 30, y1: 574 } },
};

// 청(CSV 지역) → 분석에 사용할 차트 청코드.
//   대부분 자기 차트. degu(대구·경북)는 전용 차트가 APPM(구모델, archive 비어있음)이라
//   gawn(강원) 차트 도메인이 동해 중·남부북쪽을 포함하므로 그것으로 대체.
const OFFICE_CHART = { jeju: 'jeju', busn: 'busn', gwju: 'gwju', gawn: 'gawn', dajn: 'dajn', degu: 'gawn' };

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

module.exports = { CALIB, OFFICE_CHART, calibFor, decode, analyzeZone };
