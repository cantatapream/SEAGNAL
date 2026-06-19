/**
 * ============================================================================
 * staticMask.js — 청별 '정적 요소' 마스크 자동 생성
 * ============================================================================
 *
 * [문제]  각 청 국지 차트(GIF)에는 날씨와 무관한 고정 색상요소가 있다:
 *   - 우측 범례 색상막대(주황/빨강/보라 스와치)
 *   - 하단 빨강 캡션(VALID:/TIME:)
 *   - 고정 마커(부이 지점 red dot, 저기압 'L' 등)
 *  이들이 유의파고 ≥3m 로 오분류되어 모든 프레임에 동일한 false positive 를 남긴다.
 *  (음성 대조군 검증: 잔잔한 날도 ≥4.5m 가 ~320px 상시 존재)
 *
 * [해법 — RGB 불변성]
 *  서로 충분히 떨어진 N개의 프레임에서 '픽셀 RGB 가 거의 변하지 않는' 곳은 고정 크롬
 *  (범례 스와치·빨강 캡션·고정 마커)이다. 바다 픽셀은 날짜마다 색이 변한다.
 *  → 'RGB 불변 AND ≥3m 색으로 분류되는' 픽셀만 정적 마스크로 만든다.
 *    (단순 ≥3m 교집합은 안티앨리어싱 깜빡임으로 정적 요소를 놓쳐 부정확했음)
 *
 *  청별 차트 해상도는 고정이므로 마스크는 (w×h) Uint8 비트맵. 디스크 캐시.
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { GifReader } = require('omggif');
const { classify } = require('./palette');
const { listFrames, downloadFrame } = require('./chartClient');

const MASK_DIR = path.join(__dirname, 'cache', 'mask');
fs.mkdirSync(MASK_DIR, { recursive: true });

// 마스크 산출용 기준 프레임의 base 슬롯(서로 다른 달/계절로 분산) + 예보시간.
// archive 에 없는 슬롯은 건너뛰고 가용한 것 N개를 모은다.
const REF_SLOTS = [
    '2026010921', '2026021509', '2026032121', '2026042609',
    '2026050921', '2026053009', '2025121521', '2025110921',
];
const REF_FT = 24;            // +24h 프레임 사용(실황보다 라벨 안정적)
const NEED_REFS = 5;          // 최소 기준 프레임 수
const RGB_CONST_TOL = 12;     // 채널별 RGB 변동폭 이 값 이하 → '불변(고정 크롬)'

function decodeRGBA(buf) {
    const r = new GifReader(buf);
    const w = r.width, h = r.height;
    const rgba = Buffer.alloc(w * h * 4);
    r.decodeAndBlitFrameRGBA(0, rgba);
    return { w, h, rgba };
}

/**
 * 청 코드별 마스크 확보(캐시 우선). 반환 { w, h, mask: Uint8Array(1=정적) } 또는 null.
 */
async function getStaticMask(officeCode, officeMeta, opt = {}) {
    // 신호별(파고/풍속) 분류기·임계·prefix·캐시키 파라미터화. 기본=파고.
    const signal = opt.signal || 'wave';
    const classifyFn = opt.classify || classify;
    const ge3Level = opt.ge3Level != null ? opt.ge3Level : 3.0;
    const cacheFile = path.join(MASK_DIR, `mask_${officeCode}_${signal}_${ge3Level}.json`);
    if (!opt.rebuild && fs.existsSync(cacheFile)) {
        const j = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        return { w: j.w, h: j.h, mask: Uint8Array.from(j.mask) };
    }
    let prefix = opt.prefix || officeMeta.prefixKIM || officeMeta.prefixAPPM;
    const model = officeMeta.prefixKIM ? 'KIMA' : 'APPM';
    const headData = `0#12#3#/DATA/CHT/${model === 'KIMA' ? 'KIMA' : 'APPM'}/#/${prefix}`;

    const refs = [];
    for (const slot of REF_SLOTS) {
        let frames;
        try { frames = await listFrames({ headData, model, modelText: officeMeta.name, type: 'wave' }, slot); }
        catch (e) { continue; }
        if (!frames || !frames.length) continue;
        const fr = frames.find((x) => x.ftHours === REF_FT) || frames[Math.floor(frames.length / 2)];
        try { refs.push(decodeRGBA(await downloadFrame(fr))); } catch (e) { /* skip */ }
    }
    if (refs.length < NEED_REFS) {
        console.log(`[mask] ${officeCode}: 기준 프레임 부족(${refs.length}/${NEED_REFS}) — 마스크 없이 진행`);
        return null;
    }
    const { w, h } = refs[0];
    const valid = refs.filter((r) => r.w === w && r.h === h); // 해상도 일치분만
    const mask = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) {
        const i = p * 4;
        let rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
        let rs = 0, gs = 0, bs = 0;
        for (const r of valid) {
            const R = r.rgba[i], G = r.rgba[i + 1], B = r.rgba[i + 2];
            if (R < rmin) rmin = R; if (R > rmax) rmax = R;
            if (G < gmin) gmin = G; if (G > gmax) gmax = G;
            if (B < bmin) bmin = B; if (B > bmax) bmax = B;
            rs += R; gs += G; bs += B;
        }
        // RGB 가 거의 불변(고정 크롬)인가?
        const constant = (rmax - rmin) <= RGB_CONST_TOL && (gmax - gmin) <= RGB_CONST_TOL && (bmax - bmin) <= RGB_CONST_TOL;
        if (!constant) continue;
        // 그 불변색이 임계 이상으로 분류되는 색이면 정적 마스크(범례·캡션·마커)
        const n = valid.length;
        const band = classifyFn(Math.round(rs / n), Math.round(gs / n), Math.round(bs / n));
        if (band != null && band >= ge3Level) mask[p] = 1;
    }
    const cnt = mask.reduce((s, v) => s + v, 0);
    console.log(`[mask] ${officeCode}/${signal}: ${valid.length}개 기준프레임 RGB불변 → 정적픽셀 ${cnt}개 (${w}x${h})`);
    fs.writeFileSync(cacheFile, JSON.stringify({ w, h, refs: valid.length, staticPixels: cnt, mask: Array.from(mask) }));
    return { w, h, mask };
}

module.exports = { getStaticMask };
