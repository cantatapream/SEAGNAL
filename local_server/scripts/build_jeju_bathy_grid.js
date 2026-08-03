/**
 * ============================================================================
 * 파일명: scripts/build_jeju_bathy_grid.js
 * 역할: 노출암 고립판정(플러드필)용 제주 BADA 수심 격자 구축 (1회성 전처리)
 * ============================================================================
 *
 * [왜 서해·남해와 별도인가] 물빠짐(build_tide_field.js)은 제주를 대상 해역에서
 *   명시적으로 제외한다(JEJU_BBOX 는 isExcludedSea 조건 — 기존 물빠짐 지도 UI는
 *   그대로 서해·남해만). 이 스크립트는 제주 물빠짐 지도를 새로 만드는 게 아니라,
 *   고립판정 플러드필이 쓸 "제주 연안 드러남 가능 셀 + Z₀"만 별도 산출물로 만든다.
 *
 * [재사용] build_tide_field.js 의 순수 로직(BADA 로드, Z₀ IDW, 버킷 앵커)을
 *   그대로 가져다 쓰되, 대상 해역 필터와 표준항 목록만 제주로 바꾼다.
 *
 * [실행]
 *   node scripts/build_jeju_bathy_grid.js
 *   (data/bathymetry/ 에 실제 BADA 파일이 있어야 함 — build_tide_field.js 와 공유)
 *
 * [연계]
 *   - scripts/build_tide_field.js → loadBathymetryCells/z0AtPoint/buildBucketAnchors 재사용
 *   - services/tide_field_common.js → JEJU_BBOX, ALL_REFERENCE_STATIONS, CELL_DEG 등
 *   - 산출물: data/tide_field/grid_meta_jeju.json / anchors_jeju.json
 *     (서해·남해 grid_meta.json/anchors.json 과는 별도 파일 — 기존 물빠짐 파이프라인 무영향)
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

const C = require('../services/tide_field_common');
const CFG = C.TIDE_FIELD_CONFIG;
const TF = require('./build_tide_field');

function log(...a) { console.log('[build_jeju_bathy_grid]', ...a); }
function warn(...a) { console.warn('[build_jeju_bathy_grid]', ...a); }

const GRID_META_JEJU_PATH = path.join(C.TIDE_FIELD_DIR, 'grid_meta_jeju.json');
const ANCHORS_JEJU_PATH = path.join(C.TIDE_FIELD_DIR, 'anchors_jeju.json');

function isJeju(lat, lon) {
    return lat >= C.JEJU_BBOX.latMin && lat <= C.JEJU_BBOX.latMax &&
        lon >= C.JEJU_BBOX.lonMin && lon <= C.JEJU_BBOX.lonMax;
}

/** 제주 박스 안 표준항만(제주·서귀포·성산포·모슬포). Z₀ IDW seed 로 쓴다. */
function getJejuStations() {
    return C.ALL_REFERENCE_STATIONS.filter(s => isJeju(s.lat, s.lon));
}

function round3(x) { return x == null ? null : Math.round(x * 1000) / 1000; }

async function main() {
    const year = process.env.TIDE_FIELD_YEAR
        ? parseInt(process.env.TIDE_FIELD_YEAR, 10)
        : new Date(Date.now() + 9 * 3600000).getUTCFullYear();
    log(`시작 (year=${year})`);

    fs.mkdirSync(C.TIDE_FIELD_DIR, { recursive: true });

    // ── (1) 조석표 → 제주 표준항 MTL(=Z₀ seed) ──────────────────────
    const yearRows = TF.loadTideTable(year);
    const stationMTL = yearRows ? TF.buildStationMTL(yearRows) : {};
    const jejuStations = getJejuStations();
    log(`제주 표준항: ${jejuStations.map(s => s.name).join(', ') || '(없음)'} (${jejuStations.length}개)`);

    const z0Seeds = [];
    for (const st of jejuStations) {
        const m = stationMTL[st.code];
        if (!m || m.mtl_cm == null) continue;
        z0Seeds.push({ lat: st.lat, lon: st.lon, z0_m: m.mtl_cm / 100 });
    }
    log(`Z₀ seed: ${z0Seeds.length}개`);
    if (z0Seeds.length === 0) {
        warn('제주 표준항 MTL 0개(조석표 미로드/데이터 없음) — Z₀ 보간 불가. 종료.');
        writeOutputs([], [], { year, empty: true, reason: 'no_z0_seed' });
        return;
    }

    // ── (2) BADA 셀 로드(제주 박스 필터) ─────────────────────────────
    const loaded = await TF.loadBathymetryCells(isJeju);
    if (loaded.cells.size === 0) {
        warn('제주 해역 BADA 셀 0개 — data/bathymetry/ 에 실제 파일이 있는지 확인하세요.');
        writeOutputs([], [], { year, empty: true, reason: 'no_bathymetry' });
        return;
    }
    const cellMap = new Map(); // key -> avgDepth
    for (const [k, v] of loaded.cells) cellMap.set(k, v.sumDepth / v.n);
    log(`로드 셀(얕은 연안, 수심≤${CFG.SHALLOW_MAX_M}m): ${cellMap.size}개 (CELL_DEG=${CFG.CELL_DEG})`);

    // ── (3) 드러남 가능 셀 필터: depth < z0 + DRY_MARGIN_M ───────────
    const dryCells = [];
    for (const [key, depth0] of cellMap) {
        const { gx, gy } = TF.parseCellKey(key);
        const c = TF.cellCenter(gx, gy);
        const z0 = TF.z0AtPoint(c.lat, c.lon, z0Seeds);
        const depth = round3(depth0);
        if (z0 == null || !(depth < z0 + CFG.DRY_MARGIN_M)) continue;
        dryCells.push({ key, lon: +c.lon.toFixed(5), lat: +c.lat.toFixed(5), depth, z0: round3(z0), comp: null });
    }
    log(`예측(드러남) 셀: ${dryCells.length}개`);

    // ── (4) 버킷 앵커 (서해·남해와 동일 방식: 버킷=0.1°, 버킷당 최심 셀 대표) ──
    const anchors = TF.buildBucketAnchors(dryCells, z0Seeds);
    log(`앵커(버킷): ${anchors.length}개 (버킷=${CFG.ANCHOR_BUCKET_DEG}°≈10km)`);

    writeOutputs(dryCells, anchors, { year, empty: false });
    log('완료.');
}

function writeOutputs(cellArr, anchors, meta) {
    const gridMeta = {
        generated_at: new Date().toISOString(),
        region: 'jeju',
        region_bbox: C.JEJU_BBOX,
        cell_deg: CFG.CELL_DEG,
        build_version: CFG.BUILD_VERSION,
        physics: {
            formula_depth_m: 'depth = bathy_d + eta - Z0',
            expose_condition: 'eta < Z0 - bathy_d',
            note: 'eta(조위), Z0(평균해면고≈MTL): m 단위. bathy_d: BADA 수심 MSL 기준 m.'
        },
        meta,
        cell_count: cellArr.length,
        anchor_count: anchors.length,
        cells: cellArr
    };
    fs.writeFileSync(GRID_META_JEJU_PATH, JSON.stringify(gridMeta), 'utf8');
    fs.writeFileSync(ANCHORS_JEJU_PATH, JSON.stringify({
        generated_at: gridMeta.generated_at,
        count: anchors.length,
        anchors: anchors.map(a => ({ id: a.id, lon: a.lon, lat: a.lat, bucket: a.bucket || null, z0_m: a.z0_m }))
    }, null, 2), 'utf8');
    log(`저장: ${GRID_META_JEJU_PATH} (셀 ${cellArr.length}, 앵커 ${anchors.length})`);
    log(`저장: ${ANCHORS_JEJU_PATH}`);
}

module.exports = { main, isJeju, getJejuStations, GRID_META_JEJU_PATH, ANCHORS_JEJU_PATH };

if (require.main === module) {
    main().catch(e => {
        console.error('[build_jeju_bathy_grid] 치명적 오류:', e);
        process.exit(1);
    });
}
