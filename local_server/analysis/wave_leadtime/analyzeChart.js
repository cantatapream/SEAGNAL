/**
 * ============================================================================
 * analyzeChart.js — 위험기상일기도 GIF → 유의파고 등급 분포 산출
 * ============================================================================
 *
 * 한 장의 차트(GIF Buffer)를 디코딩해, 해역 픽셀의 유의파고 등급 히스토그램과
 * 임계 초과 면적 비율을 계산한다. 각 청별 국지 차트는 이미 그 청 관할 해역으로
 * 줌되어 있으므로, "차트 내 해역에서 관측되는 최대 등급/임계 초과 면적"이
 * 그 청 해역의 악기상 강도 프록시가 된다.
 *
 * 산출 지표:
 *   - maxBand      : 차트 내 (유의미 면적 이상으로) 존재하는 최대 유의파고 등급(m)
 *   - areaGE3      : 유의파고 ≥ 3.0m (풍랑주의보급) 픽셀 / 전체 해역 픽셀
 *   - areaGE5      : 유의파고 ≥ 5.0m (풍랑경보급) 픽셀 / 전체 해역 픽셀
 *   - seaPixels    : 분류된 해역 픽셀 수
 *   - histogram    : 등급(m) → 픽셀 수
 *
 * maxBand 판정 시 라벨/노이즈 1~2px 오분류를 배제하기 위해 최소 면적
 * (MIN_BAND_PIXELS) 이상인 등급만 인정한다.
 * ============================================================================
 */
'use strict';

const { GifReader } = require('omggif');
const { classify } = require('./palette');

const MIN_BAND_PIXELS = 60; // 이 픽셀 수 미만의 등급은 maxBand 판정에서 무시(노이즈/라벨)

/**
 * @param {Buffer} gifBuf
 * @param {object} [opt] {
 *    cropBottom: 하단 N px 제외(범례·캡션 텍스트 영역),
 *    mask: Uint8Array(w*h, 1=정적요소) — staticMask.js 산출, 해당 픽셀 분석 제외
 * }
 */
function analyze(gifBuf, opt = {}) {
    const reader = new GifReader(gifBuf);
    const w = reader.width, h = reader.height;
    const rgba = Buffer.alloc(w * h * 4);
    reader.decodeAndBlitFrameRGBA(0, rgba);
    const mask = (opt.mask && opt.mask.length === w * h) ? opt.mask : null;

    // 하단 캡션(VALID/TIME 빨강 텍스트)·우측 범례는 분석에서 제외.
    //  - 범례: 오른쪽 ~8% 컬럼 제외
    //  - 캡션: 하단 ~10% 행 제외. 캡션 텍스트는 매 프레임 내용이 달라 RGB 불변
    //    마스크로 못 잡으므로 크롭으로 제거(빨강·분홍 글자가 ≥4.5m 로 오분류되던 주범).
    const xMax = Math.floor(w * 0.92);
    const yMax = h - Math.max(0, opt.cropBottom != null ? opt.cropBottom : Math.floor(h * 0.10));

    const hist = new Map();
    let seaPixels = 0, ge3 = 0, ge5 = 0;
    for (let y = 0; y < yMax; y++) {
        for (let x = 0; x < xMax; x++) {
            const p = y * w + x;
            if (mask && mask[p]) continue; // 정적 요소(범례·캡션·마커) 제외
            const i = p * 4;
            const band = classify(rgba[i], rgba[i + 1], rgba[i + 2]);
            if (band == null) continue;
            seaPixels++;
            hist.set(band, (hist.get(band) || 0) + 1);
            if (band >= 3.0) ge3++;
            if (band >= 5.0) ge5++;
        }
    }

    // 최소 면적 이상인 등급 중 최대값
    let maxBand = 0;
    for (const [band, n] of hist) {
        if (n >= MIN_BAND_PIXELS && band > maxBand) maxBand = band;
    }

    return {
        width: w, height: h,
        seaPixels,
        maxBand,
        areaGE3: seaPixels ? ge3 / seaPixels : 0,
        areaGE5: seaPixels ? ge5 / seaPixels : 0,
        pixelsGE3: ge3,
        pixelsGE5: ge5,
        histogram: Object.fromEntries([...hist.entries()].sort((a, b) => a[0] - b[0])),
    };
}

module.exports = { analyze, MIN_BAND_PIXELS };
