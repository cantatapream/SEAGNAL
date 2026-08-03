/**
 * ============================================================================
 * 파일명: scripts/build_tide_field.js
 * 역할: "서해·남해 물빠짐 예측" 오프라인 전처리 (Phase 0)
 * ============================================================================
 *
 * [무엇을 만드나 — 앵커를 연결성 그래프에서 완전히 분리 (폭발 방지)]
 *   1) BADA2024 격자 수심(d, MSL 기준 m)을 서해·남해 박스로 필터 → 예측 셀
 *      (CELL_DEG=0.001 ≈ 100m). 로드 시 수심 > SHALLOW_MAX_M(8m) 셀은 버린다
 *      (드러날 수 있는 얕은 연안만 → 셀 수 통제).
 *   2) Z₀ 필드: 표준항 연간 조석표 MTL(고+저조 평균, cm→m) 을 "직선거리 IDW"
 *      (가까운 표준항 3~4개, 1/d²) 로 각 셀·앵커에 보간. (물길 BFS 제거)
 *   3) 드러남 가능 셀 필터: depth != null && z0 != null && depth < z0 + DRY_MARGIN_M
 *      (합성 DRYRUN depth=null 은 통과시킨다).
 *   4) 버킷 앵커: 드러남 셀을 ANCHOR_BUCKET_DEG(0.1° ≈ 10km) 버킷으로 묶어
 *      버킷마다 대표 1개(버킷 내 최심 셀)를 앵커로. → 앵커 수 = 버킷 수 ≈ 수백 개.
 *      격자 파편화와 무관하게 폭발하지 않는다. (컴포넌트/그리디 커버링 제거)
 *   5) 산출물 저장:
 *      - data/tide_field/grid_meta.json  (드러남 셀 + 메타, cell_deg/build_version)
 *      - data/tide_field/anchors.json    (수집 대상 버킷 앵커 리스트)
 *
 * [실행]
 *   node scripts/build_tide_field.js
 *   (npm: package.json 에 "build-tide-field" 스크립트 추가됨 → npm run build-tide-field)
 *
 *   환경변수:
 *     TIDE_FIELD_YEAR=2026   Z₀ 산출에 쓸 조석표 연도 (기본: 올해 KST)
 *     TIDE_FIELD_DRYRUN=1    BADA 미존재 시에도 합성 격자로 파이프라인 검증
 *
 * [주의] 이 체크아웃엔 실제 BADA 파일이 없다(운영 Fly.io 볼륨에만 존재).
 *   파일이 없으면 명확히 로그 후, DRYRUN 이 아니면 종료(크래시 X). 가짜 수심을
 *   지어내지 않는다.
 *
 * [연계]
 *   - services/tide_field_common.js → 게이팅·표준항·유틸·설정 (단일 소스)
 *   - services/tide_field_collector.js → anchors.json 을 읽어 곡선 수집
 *   - routes/tide_field.js → grid_meta.json + 곡선으로 예측
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const C = require('../services/tide_field_common');
const CFG = C.TIDE_FIELD_CONFIG;

// ============================================================================
// 0. 유틸: 로그
// ============================================================================
function log(...a) { console.log('[build_tide_field]', ...a); }
function warn(...a) { console.warn('[build_tide_field]', ...a); }

// ============================================================================
// 1. 조석표(연간) 로드 → 표준항별 MTL(=Z₀ seed) 계산
// ============================================================================
//
// tide_data/tide_data_{year}.js 는 브라우저 전역(window.TIDE_DATA_STORAGE) 에
// 데이터를 싣는다. Node 에서는 최소 window 셰임을 만들고 vm 으로 평가해 읽는다.
function loadTideTable(year) {
    const file = path.join(__dirname, '..', '..', 'client', 'tide_data', `tide_data_${year}.js`); // STEP 7
    if (!fs.existsSync(file)) {
        warn(`조석표 파일 없음: ${file}`);
        return null;
    }
    const src = fs.readFileSync(file, 'utf8');
    const sandbox = { window: {} };
    try {
        const vm = require('vm');
        vm.createContext(sandbox);
        vm.runInContext(src, sandbox, { filename: file, timeout: 10000 });
    } catch (e) {
        warn(`조석표 평가 실패: ${e.message}`);
        return null;
    }
    const storage = sandbox.window.TIDE_DATA_STORAGE;
    if (!storage || !storage[String(year)]) {
        warn(`조석표에 ${year} 데이터 없음`);
        return null;
    }
    return storage[String(year)];
}

/**
 * 표준항별 연평균 MTL(cm) 계산 → stationCode/이름 으로 매핑.
 * 연중 모든 날짜의 MTL 을 평균(조위 변동의 연 평균면 ≈ Z₀).
 */
function buildStationMTL(yearRows) {
    const acc = {}; // code -> {sum, n, name}
    for (const row of yearRows) {
        const mtl = C.rowMTL(row);
        if (mtl == null) continue;
        const code = row.stationCode || row.stationName;
        if (!acc[code]) acc[code] = { sum: 0, n: 0, name: row.stationName, code: row.stationCode };
        acc[code].sum += mtl;
        acc[code].n += 1;
    }
    const out = {};
    for (const k of Object.keys(acc)) {
        out[k] = { mtl_cm: acc[k].sum / acc[k].n, name: acc[k].name, code: acc[k].code };
    }
    return out;
}

// ============================================================================
// 2. BADA 격자 로드 → 서해·남해 셀로 다운샘플
// ============================================================================
//
// 파일명 규칙: lat{위도정수}lat_lon{경도정수}, CSV "경도,위도,수심(m)".
// 셀 키는 CELL_DEG 격자에 양자화한 정수 인덱스. 한 셀에 여러 BADA 점이
// 떨어지면 수심을 평균(혹은 중앙값 대용 평균)한다.

function cellKey(lat, lon) {
    const gx = Math.round(lon / CFG.CELL_DEG);
    const gy = Math.round(lat / CFG.CELL_DEG);
    return `${gx}_${gy}`;
}
function cellCenter(gx, gy) {
    return { lon: gx * CFG.CELL_DEG, lat: gy * CFG.CELL_DEG };
}
function parseCellKey(key) {
    const [gx, gy] = key.split('_').map(Number);
    return { gx, gy };
}

/** BADA 격자 1파일을 스트림으로 읽어 셀 누적기에 합산. filterFn(lat,lon)→bool 로 대상 해역 교체 가능(기본 서해·남해). */
function accumulateBathFile(filePath, cells, filterFn) {
    filterFn = filterFn || C.isWestSouthSea;
    return new Promise((resolve, reject) => {
        let kept = 0;
        const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
        rl.on('line', (line) => {
            const parts = line.split(',');
            if (parts.length < 3) return;
            const lon = parseFloat(parts[0]);
            const lat = parseFloat(parts[1]);
            const depth = parseFloat(parts[2]);
            if (isNaN(lon) || isNaN(lat) || isNaN(depth)) return;
            if (!filterFn(lat, lon)) return;
            // [수심 사전필터] 드러날 수 있는 얕은 연안만. 깊은 수로/먼바다는 버려
            //   셀 수를 통제한다(100m 격자 폭발 방지의 1차 게이트).
            if (depth > CFG.SHALLOW_MAX_M) return;
            const key = cellKey(lat, lon);
            let c = cells.get(key);
            if (!c) { c = { sumDepth: 0, n: 0 }; cells.set(key, c); }
            c.sumDepth += depth;
            c.n += 1;
            kept++;
        });
        rl.on('close', () => resolve(kept));
        rl.on('error', reject);
    });
}

async function loadBathymetryCells(filterFn) {
    const dir = C.BATHYMETRY_DIR;
    const cells = new Map(); // key -> {sumDepth, n}
    if (!fs.existsSync(dir)) {
        warn(`BADA 수심 폴더 없음: ${dir}`);
        return { cells, fileCount: 0 };
    }
    const files = fs.readdirSync(dir).filter(f => f.startsWith('lat'));
    if (files.length === 0) {
        warn(`BADA 수심 파일 0개: ${dir}`);
        return { cells, fileCount: 0 };
    }
    log(`BADA 수심 파일 ${files.length}개 로드 시작...`);
    for (const f of files) {
        try {
            const kept = await accumulateBathFile(path.join(dir, f), cells, filterFn);
            if (kept > 0) log(`  ${f}: 대상 해역 ${kept}점`);
        } catch (e) {
            warn(`  ${f} 읽기 실패: ${e.message}`);
        }
    }
    return { cells, fileCount: files.length };
}

/**
 * [DRYRUN] BADA 미존재 시 합성 셀 생성 — 파이프라인(Z₀/드러남필터/버킷앵커) 검증용.
 *   인천 인근 작은 sub-box 를 CELL_DEG(0.001 ≈ 100m) 로 채우되, 가짜 수심을
 *   "지어내지 않기 위해" depth=null 로 둔다(검증 목적임을 synthetic:true 로 명시).
 *   depth=null 셀은 드러남 필터를 통과시키므로(아래 main 참고) 버킷 앵커 검증이
 *   가능하다. 박스가 여러 0.1° 버킷에 걸치도록 0.25°×0.25° 로 잡아 버킷 앵커가
 *   복수(수개~수십 개) 나오는 것을 로그로 확인할 수 있게 한다.
 */
function buildSyntheticCells() {
    const cells = new Map();
    const SYN_BOX = { lonMin: 126.45, lonMax: 126.70, latMin: 37.30, latMax: 37.55 };
    for (let lon = SYN_BOX.lonMin; lon <= SYN_BOX.lonMax; lon += CFG.CELL_DEG) {
        for (let lat = SYN_BOX.latMin; lat <= SYN_BOX.latMax; lat += CFG.CELL_DEG) {
            if (!C.isWestSouthSea(lat, lon)) continue;
            cells.set(cellKey(lat, lon), { sumDepth: 0, n: 0, synthetic: true });
        }
    }
    return cells;
}

function cellCenterOf(key) {
    const { gx, gy } = parseCellKey(key);
    return cellCenter(gx, gy);
}

// ============================================================================
// 3. Z₀ 필드 (표준항 MTL 을 "직선거리 IDW" 로 셀에 보간)
// ============================================================================
//
// [설계] 물길 BFS 를 쓰지 않는다. 표준항 좌표(MTL 보유)에서 각 셀까지의 직선
//   거리로 가까운 표준항 3~4개를 골라 1/d² 가중 평균. Z₀ 는 광역에서 완만히
//   변하는 평균해면고라 직선거리 보간으로 충분하며, 격자 파편화·연결성과 무관.

/** 표준항 MTL → seed 좌표 목록 [{lat, lon, z0_m}] */
function buildStationZ0Seeds(stationMTL) {
    const seeds = [];
    for (const st of C.getRegionStations()) {
        const m = stationMTL[st.code] || findMTLByName(stationMTL, st.name);
        if (!m || m.mtl_cm == null) continue;
        seeds.push({ lat: st.lat, lon: st.lon, z0_m: m.mtl_cm / 100 });
    }
    return seeds;
}

/** 한 지점(lat,lon) 의 Z₀ 를 직선거리 IDW(최근접 INTERP_MAX_ANCHORS개) 로 계산 */
function z0AtPoint(lat, lon, seeds) {
    if (!seeds || seeds.length === 0) return null;
    const near = seeds
        .map(s => ({ d: C.haversineKm(lat, lon, s.lat, s.lon), z0: s.z0_m }))
        .sort((a, b) => a.d - b.d)
        .slice(0, CFG.INTERP_MAX_ANCHORS);
    return idw(near);
}

function findMTLByName(stationMTL, name) {
    if (!name) return null;
    for (const k of Object.keys(stationMTL)) {
        if (stationMTL[k].name === name) return stationMTL[k];
    }
    return null;
}

/** 거리역제곱 IDW. contrib: [{d(km), z0(m)}] */
function idw(contrib) {
    let wsum = 0, vsum = 0;
    for (const { d, z0 } of contrib) {
        if (z0 == null) continue;
        const w = d < 0.1 ? 1e6 : 1 / (d * d);
        wsum += w; vsum += w * z0;
    }
    return wsum > 0 ? vsum / wsum : null;
}

// ============================================================================
// 4. 버킷 앵커 생성 (폭발 불가 — 연결성 그래프와 무관)
// ============================================================================
//
// [설계] 드러남 후보 셀을 ANCHOR_BUCKET_DEG(0.1° ≈ 10km) 격자 버킷으로 묶고,
//   버킷마다 대표 1개(버킷 내 수심이 가장 깊은 셀 = TideBED 격자 제공 가능성↑)를
//   앵커로 삼는다. 앵커 수 = 드러남 셀이 있는 버킷 수 ≈ 수백 개(해안 연장 비례).
//   격자가 5만 조각으로 파편화돼도 버킷 수는 변하지 않으므로 폭발하지 않는다.
//
// @param dryCells [{key, lat, lon, depth, z0}]  드러남 후보 셀 배열
// @param seeds Z₀ seed (앵커 z0 계산용)
// @returns [{id, lon, lat, stationCode:null, stationName:null, componentId:null, z0_m}]
function buildBucketAnchors(dryCells, seeds) {
    const B = CFG.ANCHOR_BUCKET_DEG;
    const buckets = new Map(); // bucketKey -> best cell
    for (const cell of dryCells) {
        const bx = Math.floor(cell.lon / B);
        const by = Math.floor(cell.lat / B);
        const bk = `${bx}_${by}`;
        const prev = buckets.get(bk);
        // 대표 선정: depth 가 가장 깊은(큰) 셀. depth=null(합성)은 0 으로 취급.
        const score = cell.depth == null ? 0 : cell.depth;
        if (!prev || score > prev._score) {
            buckets.set(bk, Object.assign({}, cell, { _score: score, _bucket: bk }));
        }
    }

    // 버킷키 정렬로 결정적(deterministic) id 부여
    const bkeys = Array.from(buckets.keys()).sort();
    const anchors = [];
    let aid = 0;
    for (const bk of bkeys) {
        const cell = buckets.get(bk);
        aid++;
        anchors.push({
            id: 'A' + String(aid).padStart(4, '0'),
            bucket: bk,
            lon: +cell.lon.toFixed(5),
            lat: +cell.lat.toFixed(5),
            stationCode: null,
            stationName: null,
            componentId: null,
            z0_m: round3(cell.z0 != null ? cell.z0 : z0AtPoint(cell.lat, cell.lon, seeds))
        });
    }
    return anchors;
}

// ============================================================================
// 7. 메인
// ============================================================================
async function main() {
    const DRYRUN = process.env.TIDE_FIELD_DRYRUN === '1';
    const year = process.env.TIDE_FIELD_YEAR
        ? parseInt(process.env.TIDE_FIELD_YEAR, 10)
        : new Date(Date.now() + 9 * 3600000).getUTCFullYear();
    log(`시작 (year=${year}, dryrun=${DRYRUN})`);

    // 산출 디렉토리 보장
    fs.mkdirSync(C.TIDE_FIELD_DIR, { recursive: true });
    fs.mkdirSync(C.CURVES_DIR, { recursive: true });

    // ── (1) 조석표 → 표준항 MTL ──────────────────────────────────────
    const yearRows = loadTideTable(year);
    const stationMTL = yearRows ? buildStationMTL(yearRows) : {};
    log(`표준항 MTL 산출: ${Object.keys(stationMTL).length}개 항`);

    // ── (2) BADA 셀 로드 ─────────────────────────────────────────────
    let cellMap, fileCount = 0, synthetic = false;
    const loaded = await loadBathymetryCells();
    fileCount = loaded.fileCount;
    if (loaded.cells.size === 0) {
        if (DRYRUN) {
            warn('BADA 셀 0개 → DRYRUN 합성 격자로 파이프라인 검증 진행 (수심 null).');
            cellMap = buildSyntheticCells();
            synthetic = true;
        } else {
            warn('BADA 수심 데이터가 없어 격자를 만들 수 없습니다. 운영 볼륨(data/bathymetry/)에서 실행하거나 TIDE_FIELD_DRYRUN=1 로 합성 검증하세요.');
            warn('가짜 수심을 생성하지 않고 종료합니다 (크래시 아님).');
            // 빈 산출물이라도 메타는 남겨 라우트가 503(준비중)을 명확히 응답하도록 한다.
            writeOutputs([], [], { year, fileCount, synthetic: false, empty: true, reason: 'no_bathymetry' });
            return;
        }
    } else {
        // 셀 평균 수심 확정
        cellMap = new Map();
        for (const [k, v] of loaded.cells) {
            cellMap.set(k, { depth: v.synthetic ? null : v.sumDepth / v.n, synthetic: !!v.synthetic });
        }
    }
    if (synthetic) {
        // 합성 셀맵을 표준 형태로
        const m = new Map();
        for (const [k] of cellMap) m.set(k, { depth: null, synthetic: true });
        cellMap = m;
    }
    log(`로드 셀(얕은 연안, 수심≤${CFG.SHALLOW_MAX_M}m): ${cellMap.size}개 (CELL_DEG=${CFG.CELL_DEG})`);

    // ── (3) Z₀ 필드 (직선거리 IDW) ───────────────────────────────────
    const z0Seeds = buildStationZ0Seeds(stationMTL);
    log(`Z₀ seed 표준항: ${z0Seeds.length}개`);
    if (z0Seeds.length === 0) {
        warn('Z₀ seed(표준항 MTL) 0개 — z0 보간 불가(조석표 미로드). 모든 셀 z0=null.');
    }

    // ── (4) 드러남 가능 셀 필터 ──────────────────────────────────────
    //   조건: depth != null && z0 != null && depth < z0 + DRY_MARGIN_M
    //   (합성 DRYRUN: depth=null 은 통과시켜 파이프라인을 검증한다)
    const dryCells = [];
    for (const [key, v] of cellMap) {
        const c = cellCenterOf(key);
        const z0 = z0AtPoint(c.lat, c.lon, z0Seeds);
        const depth = v.depth == null ? null : round3(v.depth);
        const pass = synthetic
            ? true                              // 합성: depth=null → 검증용 통과
            : (depth != null && z0 != null && depth < z0 + CFG.DRY_MARGIN_M);
        if (!pass) continue;
        dryCells.push({
            key,
            lon: +c.lon.toFixed(5),
            lat: +c.lat.toFixed(5),
            depth,
            z0: round3(z0),
            comp: null
        });
    }
    log(`예측(드러남) 셀: ${dryCells.length}개`);

    // ── (5) 버킷 앵커 생성 (폭발 불가) ───────────────────────────────
    const anchors = buildBucketAnchors(dryCells, z0Seeds);
    log(`앵커(버킷): ${anchors.length}개 (버킷=${CFG.ANCHOR_BUCKET_DEG}°≈10km, 드러남 셀이 있는 버킷마다 1개)`);

    writeOutputs(dryCells, anchors, {
        year, fileCount, synthetic, empty: false,
        cellDeg: CFG.CELL_DEG
    });
    log('완료.');
}

function round3(x) { return x == null ? null : Math.round(x * 1000) / 1000; }

/**
 * grid_meta.json + anchors.json 저장.
 */
function writeOutputs(cellArr, anchors, meta) {
    const gridMeta = {
        generated_at: new Date().toISOString(),
        region_bbox: C.REGION_BBOX,
        cell_deg: CFG.CELL_DEG,
        build_version: CFG.BUILD_VERSION,
        step_minutes: CFG.STEP_MINUTES,
        window_days: CFG.WINDOW_DAYS,
        physics: {
            // 결합식 / 노출 조건 (라우트·문서 정합용)
            formula_depth_m: 'depth = bathy_d + eta - Z0',
            expose_condition: 'eta < Z0 - bathy_d',
            note: 'eta(조위), Z0(평균해면고≈MTL): m 단위. bathy_d: BADA 수심 MSL 기준 m.'
        },
        meta,
        cell_count: cellArr.length,
        anchor_count: anchors.length,
        cells: cellArr
    };
    fs.writeFileSync(C.GRID_META_PATH, JSON.stringify(gridMeta), 'utf8');
    fs.writeFileSync(C.ANCHORS_PATH, JSON.stringify({
        generated_at: gridMeta.generated_at,
        count: anchors.length,
        anchors: anchors.map(a => ({
            id: a.id, lon: a.lon, lat: a.lat,
            bucket: a.bucket || null,
            stationCode: a.stationCode || null, stationName: a.stationName || null,
            componentId: a.componentId || null, z0_m: a.z0_m
        }))
    }, null, 2), 'utf8');
    log(`저장: ${C.GRID_META_PATH} (셀 ${cellArr.length}, 앵커 ${anchors.length})`);
    log(`저장: ${C.ANCHORS_PATH}`);
}

// 모듈로도 import 가능하게 export (테스트/스케줄러 트리거 대비)
// [제주 재사용] loadBathymetryCells/z0AtPoint/buildBucketAnchors/cellCenter/parseCellKey 는
//   지역 특정 로직이 없는 순수 함수라 build_jeju_bathy_grid.js 가 그대로 가져다 쓴다.
module.exports = {
    main, loadTideTable, buildStationMTL,
    loadBathymetryCells, z0AtPoint, buildBucketAnchors,
    cellKey, cellCenter, parseCellKey
};

if (require.main === module) {
    main().catch(e => {
        console.error('[build_tide_field] 치명적 오류:', e);
        process.exit(1);
    });
}
