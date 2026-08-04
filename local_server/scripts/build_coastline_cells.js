/**
 * 해안선 → 물빠짐 격자 셀 변환 스크립트 (고립판정 플러드필의 "항상 마른 땅" 시드)
 * 실행: node local_server/scripts/build_coastline_cells.js <인공해안선.shp> <자연해안선.shp>
 *
 * 국립해양조사원 전자해도 TL_COALNE_ARTIF(인공해안선)·TL_COALNE_NATURE(자연해안선)
 * — 약최고고조면(밀물이 아무리 차도 안 잠기는 선) 기준 — 를 물빠짐(tide_field)이
 * 쓰는 CELL_DEG(0.0015°≈150m) 격자로 변환해, 그 선이 지나가는 칸을 "항상 마른
 * 땅(육지)" 시드 셀로 저장한다.
 *
 * [왜 필요한가] 물빠짐 격자(BADA 기반)는 갯벌처럼 "잠겼다 드러났다 하는" 얕은
 *   칸만 다루고, 진짜 육지(항상 마른 땅)는 아예 셀 자체가 없다. 노출암이 밀물에
 *   "고립"됐는지 판정하려면 육지에서 출발해 그 시각에 드러난 갯벌 칸만 타고
 *   퍼져나가는 플러드필이 필요한데, 그 출발점(육지)이 바로 이 시드 셀이다.
 *
 * [기준면에 대해] 해안선은 약최고고조면(수치가 아니라 선이라 Z₀ 같은 보정 대상이
 *   아님) 기준이라, "밀물이 최고조여도 절대 안 잠기는 경계"라는 뜻 — 플러드필의
 *   "항상 마른 땅" 정의와 정확히 들어맞는다. 다만 이 해안선(KHOA 실측)과 BADA
 *   수심 격자(별도 실측)는 독립 조사라 경계에서 정확히 안 맞을 수 있어, 플러드필
 *   쪽에서 인접 셀(반경 1~2칸) 버퍼로 흡수해야 한다(이 스크립트의 몫이 아님).
 *
 * [연계]
 *   - services/tide_field_common.js → CELL_DEG, REGION_BBOX, JEJU_BBOX 재사용
 *   - (예정) services/hazard_rocks_isolation.js → 이 산출물을 플러드필 시드로 사용
 */
'use strict';

const fs = require('fs');
const path = require('path');
const TFC = require('../services/tide_field_common');

const CELL_DEG = TFC.TIDE_FIELD_CONFIG.CELL_DEG;

/** EPSG:5179(KGD2002 중부원점 TM) → WGS84 lon/lat. build_hazard_rocks.js 와 동일 공식. */
function utmkToLonLat(x, y) {
    const a = 6378137.0, f = 1 / 298.257222101, k0 = 0.9996;
    const lon0 = 127.5 * Math.PI / 180, lat0 = 38.0 * Math.PI / 180;
    const e2 = f * (2 - f);
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const M = (la) => a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * la
        - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * la)
        + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * la)
        - (35 * e2 ** 3 / 3072) * Math.sin(6 * la));
    const Mv = M(lat0) + (y - 2000000.0) / k0;
    const mu = Mv / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256));
    const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
        + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
        + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
    const ep2 = e2 / (1 - e2), C1 = ep2 * Math.cos(p1) ** 2, T1 = Math.tan(p1) ** 2;
    const N1 = a / Math.sqrt(1 - e2 * Math.sin(p1) ** 2);
    const R1 = a * (1 - e2) / (1 - e2 * Math.sin(p1) ** 2) ** 1.5;
    const D = (x - 1000000.0) / (N1 * k0);
    const lat = p1 - (N1 * Math.tan(p1) / R1) * (D ** 2 / 2
        - (5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * ep2) * D ** 4 / 24
        + (61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * ep2 - 3 * C1 ** 2) * D ** 6 / 720);
    const lon = lon0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6
        + (5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * ep2 + 24 * T1 ** 2) * D ** 5 / 120) / Math.cos(p1);
    return [lon * 180 / Math.PI, lat * 180 / Math.PI];
}

/** PolyLineZ(shapeType=13) 레코드를 [[ [lon,lat], ... ], ...] (part별 점열) 로 파싱. */
function readPolylineParts(shpPath) {
    const buf = fs.readFileSync(shpPath);
    const records = [];
    let off = 100;
    while (off < buf.length) {
        const contentLenWords = buf.readInt32BE(off + 4);
        off += 8;
        const shapeType = buf.readInt32LE(off);
        if (shapeType === 0) { off += 4; continue; } // Null shape
        if (shapeType !== 13 && shapeType !== 3) throw new Error('예상 밖 shapeType: ' + shapeType);
        const numParts = buf.readInt32LE(off + 36);
        const numPoints = buf.readInt32LE(off + 40);
        const partsStart = off + 44;
        const pointsStart = partsStart + numParts * 4;
        const parts = [];
        for (let i = 0; i < numParts; i++) {
            const startIdx = buf.readInt32LE(partsStart + i * 4);
            const endIdx = (i + 1 < numParts) ? buf.readInt32LE(partsStart + (i + 1) * 4) : numPoints;
            const pts = [];
            for (let p = startIdx; p < endIdx; p++) {
                const x = buf.readDoubleLE(pointsStart + p * 16);
                const y = buf.readDoubleLE(pointsStart + p * 16 + 8);
                pts.push(utmkToLonLat(x, y));
            }
            parts.push(pts);
        }
        records.push(parts);
        off += contentLenWords * 2; // 콘텐츠(shapeType 포함) 길이만큼 이동 — off 는 이미 콘텐츠 시작점
    }
    return records;
}

function cellKey(lon, lat) {
    const gx = Math.round(lon / CELL_DEG), gy = Math.round(lat / CELL_DEG);
    return gx + '_' + gy;
}

/** 관심 영역(서해·남해 + 제주) 밖 좌표는 건너뛴다 — 산출물 크기 절감. */
function inScope(lon, lat) {
    const R = TFC.REGION_BBOX, J = TFC.JEJU_BBOX;
    const inRegion = lon >= R.lonMin && lon <= R.lonMax && lat >= R.latMin && lat <= R.latMax;
    const inJeju = lon >= J.lonMin && lon <= J.lonMax && lat >= J.latMin && lat <= J.latMax;
    return inRegion || inJeju;
}

/** 두 점 사이를 CELL_DEG 간격보다 촘촘히 샘플링하며 지나가는 셀을 전부 수집. */
function rasterizeSegment(lon1, lat1, lon2, lat2, seedSet) {
    const distDeg = Math.max(Math.abs(lon2 - lon1), Math.abs(lat2 - lat1));
    const steps = Math.max(1, Math.ceil(distDeg / (CELL_DEG * 0.5)));
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const lon = lon1 + (lon2 - lon1) * t, lat = lat1 + (lat2 - lat1) * t;
        if (!inScope(lon, lat)) continue;
        seedSet.add(cellKey(lon, lat));
    }
}

function main() {
    const [, , artifShp, natureShp] = process.argv;
    if (!artifShp || !natureShp) {
        console.error('사용법: node build_coastline_cells.js <인공해안선.shp> <자연해안선.shp>');
        process.exit(1);
    }
    const log = (...a) => console.log('[build_coastline_cells]', ...a);

    const seedSet = new Set();
    for (const [label, shpPath] of [['인공', artifShp], ['자연', natureShp]]) {
        log(`${label}해안선 파싱 중... (${shpPath})`);
        const records = readPolylineParts(shpPath);
        let segCount = 0;
        for (const parts of records) {
            for (const pts of parts) {
                for (let i = 1; i < pts.length; i++) {
                    rasterizeSegment(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], seedSet);
                    segCount++;
                }
            }
        }
        log(`  ${label}해안선: 레코드 ${records.length}개, 선분 ${segCount}개 처리`);
    }
    log(`시드 셀 총 ${seedSet.size.toLocaleString()}개 (서해·남해+제주 범위 내)`);

    const outPath = path.join(TFC.TIDE_FIELD_DIR, 'coastline_cells.json');
    fs.mkdirSync(TFC.TIDE_FIELD_DIR, { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({
        generated_at: new Date().toISOString(),
        cell_deg: CELL_DEG,
        count: seedSet.size,
        cells: Array.from(seedSet)
    }));
    log(`저장 완료: ${outPath}`);
}

module.exports = { main, utmkToLonLat, readPolylineParts, cellKey, inScope };

if (require.main === module) {
    main();
}
