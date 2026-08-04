/**
 * 해안선 근접 정밀 육지 밴드 생성 스크립트
 * 실행: node local_server/scripts/build_fine_land_band.js
 *
 * [배경] coastline_cells.json 은 KHOA 해안선을 150m 격자로 래스터화한
 *   "선(경계)" 데이터일 뿐, 안쪽이 육지인지 채워진 정보가 없다. 반면
 *   ocean_overlay.js 가 쓰는 land_mask_korea.json(육지 폴리곤)은 10km급
 *   저해상도라 해안선 근처에서 오버레이가 육지를 침범하거나 각지게 잘린다.
 *
 * [방법] land_mask_korea.json(신뢰 가능하지만 저해상도)으로 "확실히 바다"인
 *   씨앗 좌표를 자동 채취 → coastline_cells.json을 벽으로 삼아 4방향
 *   플러드필로 도달 가능한 칸(바다)/그렇지 못한 칸(육지)을 150m 해상도로
 *   재분류한다. 해안선에서 BAND_CELLS 칸(≈3km) 이내의 육지 칸만 내보내
 *   (먼 내륙은 기존 저해상도 마스크로 충분) 용량을 억제한다.
 *
 * [연계]
 *   - services/tide_field_common.js → REGION_BBOX, JEJU_BBOX, CELL_DEG 재사용
 *   - data/tide_field/coastline_cells.json → 해안선 벽(입력)
 *   - client/land_mask_korea.json → 씨앗 채취용 저해상도 육지 폴리곤(입력)
 *   - (출력) data/tide_field/fine_land_band.json → routes/ocean1.js 가 서빙
 */
'use strict';

const fs = require('fs');
const path = require('path');
const TFC = require('../services/tide_field_common');

const CELL_DEG = TFC.TIDE_FIELD_CONFIG.CELL_DEG;
const BAND_CELLS = 20; // 해안선에서 이 칸 수(≈3km) 이내 육지만 정밀 마스크로 내보냄
const DILATE_RADIUS = 2; // 원본 해안선 래스터의 세그먼트 간 미세한 끊김을 메우는 벽 팽창 반경
const SEED_STEP_DEG = 0.05; // 씨앗 후보 샘플링 간격(≈5.5km)

const COASTLINE_CELLS_PATH = path.join(TFC.TIDE_FIELD_DIR, 'coastline_cells.json');
const LAND_MASK_PATH = path.join(__dirname, '..', '..', 'client', 'land_mask_korea.json');
const OUT_PATH = path.join(TFC.TIDE_FIELD_DIR, 'fine_land_band.json');

const BOXES = [TFC.REGION_BBOX, TFC.JEJU_BBOX];

/** 점 p 가 다각형 ring 내부인지(ray casting). */
function pointInRing(lon, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        const intersect = ((yi > lat) !== (yj > lat)) &&
            (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function ringBbox(ring) {
    let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity;
    for (const [lon, lat] of ring) {
        if (lon < lonMin) lonMin = lon;
        if (lon > lonMax) lonMax = lon;
        if (lat < latMin) latMin = lat;
        if (lat > latMax) latMax = lat;
    }
    return { lonMin, lonMax, latMin, latMax };
}

function isSeaByCoarseMask(lon, lat, ringsWithBbox) {
    for (const { ring, bbox } of ringsWithBbox) {
        if (lon < bbox.lonMin || lon > bbox.lonMax || lat < bbox.latMin || lat > bbox.latMax) continue;
        if (pointInRing(lon, lat, ring)) return false; // 육지 폴리곤 내부 → 바다 아님
    }
    return true;
}

function gridBounds(box) {
    const gxMin = Math.round(box.lonMin / CELL_DEG);
    const gxMax = Math.round(box.lonMax / CELL_DEG);
    const gyMin = Math.round(box.latMin / CELL_DEG);
    const gyMax = Math.round(box.latMax / CELL_DEG);
    return { gxMin, gxMax, gyMin, gyMax, width: gxMax - gxMin + 1, height: gyMax - gyMin + 1 };
}

/** box 하나에 대해 (벽 마킹 → 바다 씨앗 플러드필 → 해안선 밴드 폭 계산) 수행, 밴드 내 육지 run 목록 반환. */
function processBox(box, wallKeys, ringsWithBbox, log) {
    const b = gridBounds(box);
    const { gxMin, gyMin, width, height } = b;
    const size = width * height;
    log(`  격자 ${width}x${height} = ${size.toLocaleString()}칸`);

    const WALL = 2, SEA = 1;
    const state = new Uint8Array(size); // 0=미상(육지후보) 1=바다 2=벽(해안선)
    const idx = (gx, gy) => (gy - gyMin) * width + (gx - gxMin);

    let wallCount = 0;
    const wallSeeds = [];
    for (const key of wallKeys) {
        const us = key.indexOf('_');
        const gx = parseInt(key.slice(0, us), 10);
        const gy = parseInt(key.slice(us + 1), 10);
        if (gx < b.gxMin || gx > b.gxMax || gy < b.gyMin || gy > b.gyMax) continue;
        state[idx(gx, gy)] = WALL;
        wallSeeds.push(gx, gy);
        wallCount++;
    }
    log(`  벽(해안선) 원본 칸: ${wallCount.toLocaleString()}`);

    // [경계 봉인] KHOA 해안선은 남한(서해·남해)만 있고 북한·동해 쪽은 애초에 없다.
    //   그 방향엔 벽이 아예 없으니 바다 씨앗이 거기로 새어나가 북한 육지를 거쳐
    //   한반도 전체 내륙을 "바다"로 오염시킨다(실측: 팽창해도 육지 판정 2만6천칸
    //   붕괴 — 서울·대전·광주·전주 등 완전 내륙까지 도달함을 확인). tide_field_common
    //   이 이미 정의한 "우리 운영 범위 밖" 경계(isExcludedSea)를 그대로 벽으로 막는다.
    const BOUNDARY = 3;
    let boundaryCount = 0;
    for (let gy = b.gyMin; gy <= b.gyMax; gy++) {
        const lat = gy * CELL_DEG;
        for (let gx = b.gxMin; gx <= b.gxMax; gx++) {
            const i = idx(gx, gy);
            if (state[i] !== 0) continue;
            const lon = gx * CELL_DEG;
            if (TFC.isExcludedSea(lat, lon)) { state[i] = BOUNDARY; boundaryCount++; }
        }
    }
    log(`  운영범위 밖 봉인 칸: ${boundaryCount.toLocaleString()}`);

    // [팽창] 원본 해안선 래스터가 세그먼트 경계 등에서 실제로 끊겨 있는 지점이 있어
    //   (실측: 팽창 없이 채우면 육지 판정이 3만 칸대로 붕괴 — 명백한 누수), DILATE_RADIUS
    //   칸 반경으로 벽을 두껍게 만들어 자잘한 끊김을 메운다. hazard_rocks_isolation.js의
    //   NEIGHBOR_BUFFER_CELLS(해안선 정합 오차 흡수)와 같은 발상.
    for (let k = 0; k < wallSeeds.length; k += 2) {
        const gx = wallSeeds[k], gy = wallSeeds[k + 1];
        for (let dx = -DILATE_RADIUS; dx <= DILATE_RADIUS; dx++) {
            for (let dy = -DILATE_RADIUS; dy <= DILATE_RADIUS; dy++) {
                const nx = gx + dx, ny = gy + dy;
                if (nx < b.gxMin || nx > b.gxMax || ny < b.gyMin || ny > b.gyMax) continue;
                state[idx(nx, ny)] = WALL;
            }
        }
    }
    let dilatedWallCount = 0;
    for (let i = 0; i < size; i++) if (state[i] === WALL) dilatedWallCount++;
    log(`  벽(해안선) 팽창 후 칸: ${dilatedWallCount.toLocaleString()} (반경 ${DILATE_RADIUS}칸)`);

    // --- 씨앗 채취: 저해상도 육지 폴리곤 기준 "확실히 바다"인 점만 ---
    // [4방향 채우기] 해안선 벽은 샘플 간격(≤0.5칸)상 대각선으로만 이어질 수 있어
    //   8방향 채우기를 쓰면 그 대각선 틈으로 새어나간다(실측: 육지 판정이 11,210칸
    //   으로 붕괴). 4방향 채우기라야 대각선-only 벽에서도 안전하게 막힌다.
    const NB4 = [[-1,0],[1,0],[0,-1],[0,1]];
    let qHead = 0;
    const queue = new Int32Array(size);
    let qTail = 0;
    let seedCount = 0;

    for (let lon = box.lonMin; lon <= box.lonMax; lon += SEED_STEP_DEG) {
        for (let lat = box.latMin; lat <= box.latMax; lat += SEED_STEP_DEG) {
            if (!isSeaByCoarseMask(lon, lat, ringsWithBbox)) continue;
            const gx = Math.round(lon / CELL_DEG), gy = Math.round(lat / CELL_DEG);
            if (gx < b.gxMin || gx > b.gxMax || gy < b.gyMin || gy > b.gyMax) continue;
            const i = idx(gx, gy);
            if (state[i] !== 0) continue; // 이미 벽이거나 이미 바다로 마킹됨
            state[i] = SEA;
            queue[qTail++] = i;
            seedCount++;
        }
    }
    log(`  씨앗(확실히 바다) 칸: ${seedCount.toLocaleString()}`);

    // --- 4방향 멀티소스 플러드필: 벽을 넘지 않고 도달 가능한 칸 = 바다 ---
    while (qHead < qTail) {
        const i = queue[qHead++];
        const gy = gyMin + Math.floor(i / width);
        const gx = gxMin + (i % width);
        for (const [dx, dy] of NB4) {
            const nx = gx + dx, ny = gy + dy;
            if (nx < b.gxMin || nx > b.gxMax || ny < b.gyMin || ny > b.gyMax) continue;
            const ni = idx(nx, ny);
            if (state[ni] !== 0) continue;
            state[ni] = SEA;
            queue[qTail++] = ni;
        }
    }

    let seaCount = 0, landCount = 0;
    for (let i = 0; i < size; i++) {
        if (state[i] === SEA) seaCount++;
        else if (state[i] === 0) landCount++;
    }
    log(`  분류 완료 — 바다: ${seaCount.toLocaleString()}, 육지(미도달): ${landCount.toLocaleString()}, 벽: ${wallCount.toLocaleString()}`);

    // --- 해안선(벽)에서 BAND_CELLS 칸 이내까지 BFS로 거리 전개 ---
    const depth = new Int16Array(size).fill(-1);
    qHead = 0; qTail = 0;
    for (let i = 0; i < size; i++) {
        if (state[i] === WALL) { depth[i] = 0; queue[qTail++] = i; }
    }
    while (qHead < qTail) {
        const i = queue[qHead++];
        const d = depth[i];
        if (d >= BAND_CELLS) continue;
        const gy = gyMin + Math.floor(i / width);
        const gx = gxMin + (i % width);
        for (const [dx, dy] of NB4) {
            const nx = gx + dx, ny = gy + dy;
            if (nx < b.gxMin || nx > b.gxMax || ny < b.gyMin || ny > b.gyMax) continue;
            const ni = idx(nx, ny);
            if (depth[ni] !== -1) continue;
            depth[ni] = d + 1;
            queue[qTail++] = ni;
        }
    }

    // --- 밴드 내 육지(미도달) + 벽 칸만 행(gy)별로 run-length 압축해 내보냄 ---
    const runs = [];
    for (let gy = b.gyMin; gy <= b.gyMax; gy++) {
        let runStart = null;
        for (let gx = b.gxMin; gx <= b.gxMax; gx++) {
            const i = idx(gx, gy);
            const inBand = depth[i] !== -1 && depth[i] <= BAND_CELLS && (state[i] === 0 || state[i] === WALL);
            if (inBand) {
                if (runStart === null) runStart = gx;
            } else if (runStart !== null) {
                runs.push([gy, runStart, gx - 1]);
                runStart = null;
            }
        }
        if (runStart !== null) runs.push([gy, runStart, b.gxMax]);
    }
    return runs;
}

function main() {
    const log = (...a) => console.log('[build_fine_land_band]', ...a);

    log('coastline_cells.json 로드...');
    const coastlineData = JSON.parse(fs.readFileSync(COASTLINE_CELLS_PATH, 'utf8'));
    const wallKeys = coastlineData.cells;
    log(`벽 칸 총 ${wallKeys.length.toLocaleString()}개`);

    log('land_mask_korea.json 로드(씨앗 채취용)...');
    const landMask = JSON.parse(fs.readFileSync(LAND_MASK_PATH, 'utf8'));
    const ringsWithBbox = landMask.rings.map(ring => ({ ring, bbox: ringBbox(ring) }));

    let allRuns = [];
    for (const box of BOXES) {
        log(`박스 처리: lon[${box.lonMin},${box.lonMax}] lat[${box.latMin},${box.latMax}]`);
        const runs = processBox(box, wallKeys, ringsWithBbox, log);
        log(`  → run ${runs.length.toLocaleString()}개`);
        allRuns = allRuns.concat(runs);
    }

    let cellTotal = 0;
    for (const [, gxStart, gxEnd] of allRuns) cellTotal += (gxEnd - gxStart + 1);

    fs.writeFileSync(OUT_PATH, JSON.stringify({
        generated_at: new Date().toISOString(),
        cell_deg: CELL_DEG,
        band_cells: BAND_CELLS,
        run_count: allRuns.length,
        cell_count: cellTotal,
        runs: allRuns
    }));
    const size = fs.statSync(OUT_PATH).size;
    log(`저장 완료: ${OUT_PATH}`);
    log(`run ${allRuns.length.toLocaleString()}개, 칸 ${cellTotal.toLocaleString()}개, 파일 크기 ${(size / 1024).toFixed(1)} KB`);
}

module.exports = { main, pointInRing, gridBounds, processBox };

if (require.main === module) {
    main();
}
