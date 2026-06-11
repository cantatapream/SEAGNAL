/**
 * ============================================================================
 * analysis/wave_leadtime/zonePolygon.js — 특보구역 폴리곤 내부 샘플링
 * ============================================================================
 *
 * 기존 analyzeZone 은 "중심점 + 반경 원"으로 샘플해 옆 구역까지 침범하고
 * 면적비율이 의미를 잃었다(이벤트 면적비율 중앙값 3%). 이 모듈은 실제
 * 특보구역 폴리곤(assets/warn_zones.geojson) 내부만 샘플해:
 *   - maxBand (세기) + areaFraction = pixelsGE3 / sampled (구역 내 임계초과 면적비율)
 * 을 "그 구역" 기준으로 산출한다.
 *
 * 성능: 폴리곤→픽셀 멤버십은 (calib·폴리곤 고정 시) 불변이므로 구역별로 1회만
 *   zonePixelIndices() 로 미리 구해두고, 매 프레임은 analyzeByIndices() 로
 *   그 인덱스만 훑는다(point-in-polygon 재계산 없음).
 *
 * MultiPolygon + 홀 지원. 폴리곤 없는 구역(최북단 4)은 loadZonePolygons 에 없으니
 * 호출측이 기존 analyzeZone(원형)으로 폴백한다. 반환은 analyzeZone 호환 + areaFraction.
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

// 이름 정규화: 공백·중점·마침표 제거 (geojson "동해남부 남쪽 안쪽먼바다" ↔ ZONES 무공백)
function normName(s) {
    return String(s == null ? '' : s).replace(/[\s·.]/g, '').trim();
}

/** warn_zones.geojson → Map<정규화이름, MultiPolygon coordinates(lon/lat)>. 실패 시 빈 Map. */
function loadZonePolygons(geojsonPath) {
    const out = new Map();
    try {
        const p = geojsonPath || path.resolve(__dirname, '..', '..', 'assets', 'warn_zones.geojson');
        const gj = JSON.parse(fs.readFileSync(p, 'utf8'));
        for (const f of (gj.features || [])) {
            const name = f && f.properties && f.properties.name;
            const geom = f && f.geometry;
            if (!name || !geom) continue;
            let polys;
            if (geom.type === 'MultiPolygon') polys = geom.coordinates;
            else if (geom.type === 'Polygon') polys = [geom.coordinates];
            else continue;
            out.set(normName(name), polys);
        }
    } catch (_) { /* 빈 맵 */ }
    return out;
}

// ── point-in-polygon (픽셀공간, ray casting) ─────────────────────────────────
function pointInRing(px, py, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        const intersect = ((yi > py) !== (yj > py)) &&
            (px < (xj - xi) * (py - yi) / (yj - yi + 0e0) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}
// projected polygon(픽셀): [outerRing, hole1, ...]. 내부=outer 안 && 어떤 홀에도 없음.
function pointInPolygonWithHoles(px, py, rings) {
    if (!rings.length || !pointInRing(px, py, rings[0])) return false;
    for (let k = 1; k < rings.length; k++) if (pointInRing(px, py, rings[k])) return false;
    return true;
}

/**
 * 폴리곤을 픽셀공간으로 투영하고, 프레임 내부에서 폴리곤에 드는 픽셀 인덱스(p=y*w+x)를
 * 1회 산출한다. (구역별 1회만 호출 → 프레임마다 재사용)
 * @returns {Int32Array|null}
 */
function zonePixelIndices(calib, polys, w, h) {
    const fr = calib.frame;
    if (!Array.isArray(polys) || polys.length === 0) return null;
    const pxPolys = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const poly of polys) {
        const rings = [];
        for (const ring of poly) {
            const pr = [];
            for (const pt of ring) {
                const x = calib.xOf(pt[0]), y = calib.yOf(pt[1]);
                pr.push([x, y]);
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
            rings.push(pr);
        }
        pxPolys.push(rings);
    }
    if (!isFinite(minX)) return null;
    const x0 = Math.max(fr.x0, Math.floor(minX)), x1 = Math.min(fr.x1, Math.ceil(maxX));
    const y0 = Math.max(fr.y0, Math.floor(minY)), y1 = Math.min(fr.y1, Math.ceil(maxY));
    if (x0 > x1 || y0 > y1) return null;
    const idx = [];
    for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
            for (const rings of pxPolys) {
                if (pointInPolygonWithHoles(x, y, rings)) { idx.push(y * w + x); break; }
            }
        }
    }
    return Int32Array.from(idx);
}

/**
 * 미리 구한 픽셀 인덱스로 한 프레임의 밴드/면적비율 산출.
 * @returns {{maxBand,pixelsGE3,pixelsGE5,sampled,areaFraction,histogram}|null}
 */
function analyzeByIndices(decoded, indices, opt = {}) {
    if (!indices || indices.length === 0) return null;
    const { w, h, rgba } = decoded;
    const mask = (opt.mask && opt.mask.length === w * h) ? opt.mask : null;
    const minBandPixels = opt.minBandPixels != null ? opt.minBandPixels : 12;
    const classify = opt.classify;
    if (typeof classify !== 'function') return null;
    const ge3Level = opt.ge3Level != null ? opt.ge3Level : 3.0;
    const ge5Level = opt.ge5Level != null ? opt.ge5Level : 5.0;
    const hist = new Map();
    let sampled = 0, ge3 = 0, ge5 = 0;
    for (let k = 0; k < indices.length; k++) {
        const p = indices[k];
        if (mask && mask[p]) continue;
        const i = p * 4;
        const band = classify(rgba[i], rgba[i + 1], rgba[i + 2]);
        if (band == null) continue;
        sampled++;
        hist.set(band, (hist.get(band) || 0) + 1);
        if (band >= ge3Level) ge3++;
        if (band >= ge5Level) ge5++;
    }
    let maxBand = 0;
    for (const [band, n] of hist) if (n >= minBandPixels && band > maxBand) maxBand = band;
    return {
        maxBand, pixelsGE3: ge3, pixelsGE5: ge5, sampled,
        areaFraction: sampled ? ge3 / sampled : 0,
        histogram: Object.fromEntries([...hist.entries()].sort((a, b) => a[0] - b[0])),
    };
}

/** 편의: 인덱스 미리계산 없이 한 번에 (구역별 1회 분석용). */
function analyzeZonePolygon(decoded, calib, polys, opt = {}) {
    const idx = zonePixelIndices(calib, polys, decoded.w, decoded.h);
    return analyzeByIndices(decoded, idx, opt);
}

module.exports = {
    loadZonePolygons, zonePixelIndices, analyzeByIndices, analyzeZonePolygon,
    pointInRing, pointInPolygonWithHoles, normName,
};
