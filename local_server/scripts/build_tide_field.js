/**
 * ============================================================================
 * 파일명: scripts/build_tide_field.js
 * 역할: "서해·남해 물빠짐 예측" 오프라인 전처리 (Phase 0)
 * ============================================================================
 *
 * [무엇을 만드나]
 *   1) BADA2024 격자 수심(d, MSL 기준 m)을 서해·남해 박스로 필터 → 예측 셀
 *      (CELL_DEG 해상도) 로 다운샘플.
 *   2) 인접 바다셀 연결성 그래프 구축 → 연결성 컴포넌트(폐쇄 만/수로 단위) 부여.
 *      물길거리(BFS) 의 기반. (B안: 곶·섬 너머 직선 연결 방지)
 *   3) 앵커 선정: 서해·남해 표준항을 seed → BFS 물길거리 기준 그리디 커버링
 *      (ANCHOR_COVER_KM 안에 앵커 없는 셀에 앵커 추가) → 컴포넌트마다 최소 1개 보장.
 *   4) Z₀ 필드: 표준항 연간 조석표 MTL(고+저조 평균, cm→m) 을 물길거리 IDW 로
 *      각 셀·앵커에 보간.
 *   5) 산출물 저장:
 *      - data/tide_field/grid_meta.json  (셀 + 앵커 + 메타)
 *      - data/tide_field/anchors.json    (수집 대상 앵커 리스트)
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
    const file = path.join(__dirname, '..', 'tide_data', `tide_data_${year}.js`);
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

/** BADA 격자 1파일을 스트림으로 읽어 셀 누적기에 합산 */
function accumulateBathFile(filePath, cells) {
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
            if (!C.isWestSouthSea(lat, lon)) return;
            // [사전필터] 수심 > SHALLOW_MAX_M 은 어차피 안 드러나므로 제외 →
            //   100m 미세 격자에서 셀 수를 통제 (정확도 손해 없음).
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

async function loadBathymetryCells() {
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
            const kept = await accumulateBathFile(path.join(dir, f), cells);
            if (kept > 0) log(`  ${f}: 대상 해역 ${kept}점`);
        } catch (e) {
            warn(`  ${f} 읽기 실패: ${e.message}`);
        }
    }
    return { cells, fileCount: files.length };
}

/**
 * [DRYRUN] BADA 미존재 시 합성 셀 생성 — 파이프라인(연결성/앵커/Z₀) 로직 검증용.
 *   서해·남해 박스를 CELL_DEG 로 채우되, 가짜 수심을 "지어내지 않기 위해"
 *   depth=null 로 둔다(검증 목적임을 산출물에 synthetic:true 로 명시).
 */
function buildSyntheticCells() {
    const cells = new Map();
    // 합성 모드는 CELL_DEG 해상도의 "연속" 격자를 만든다 (연결성/컴포넌트/물길
    // BFS 가 현실처럼 빈틈 없이 동작하도록). 100m(0.001°)에선 셀이 폭증하므로
    // 검증용으로 인천 인근의 아주 작은 sub-box 만 채운다(표준항 인천 포함).
    //   (실데이터에선 BADA 점이 있는 셀만 자연스럽게 채워져 육지가 제외됨)
    const SYN_BOX = { lonMin: 126.5, lonMax: 126.66, latMin: 37.4, latMax: 37.5 };
    for (let lon = SYN_BOX.lonMin; lon <= SYN_BOX.lonMax; lon += CFG.CELL_DEG) {
        for (let lat = SYN_BOX.latMin; lat <= SYN_BOX.latMax; lat += CFG.CELL_DEG) {
            if (!C.isWestSouthSea(lat, lon)) continue;
            cells.set(cellKey(lat, lon), { sumDepth: 0, n: 0, synthetic: true });
        }
    }
    return cells;
}

// ============================================================================
// 3. 연결성 그래프 + 컴포넌트(물길) 라벨링
// ============================================================================
//
// 이웃: 셀 중심간 거리가 CELL_DEG * NEIGHBOR_TOL_FACTOR 이하인 8방향 인접 셀.
// 격자 인덱스 기반으로 (gx±1, gy±1) 후보만 검사하므로 O(N).

function buildAdjacency(cellMap) {
    const keys = Array.from(cellMap.keys());
    const adj = new Map(); // key -> [neighborKey...]
    for (const key of keys) {
        const { gx, gy } = parseCellKey(key);
        const nbrs = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const nk = `${gx + dx}_${gy + dy}`;
                if (cellMap.has(nk)) nbrs.push(nk);
            }
        }
        adj.set(key, nbrs);
    }
    return adj;
}

/** 연결성 컴포넌트 라벨링 (BFS). key -> componentId */
function labelComponents(cellMap, adj) {
    const comp = new Map();
    let cid = 0;
    for (const key of cellMap.keys()) {
        if (comp.has(key)) continue;
        cid++;
        const queue = [key];
        comp.set(key, cid);
        while (queue.length) {
            const cur = queue.shift();
            for (const nk of adj.get(cur) || []) {
                if (!comp.has(nk)) { comp.set(nk, cid); queue.push(nk); }
            }
        }
    }
    return { comp, componentCount: cid };
}

// ============================================================================
// 4. 물길거리 BFS (앵커 커버링·Z₀ IDW 입력)
// ============================================================================
//
// 한 시작 셀에서 인접 셀로 BFS 하며 누적 물길거리(중심간 Haversine 합) 계산.
// maxKm 를 넘으면 확장 중단. 반환: key -> waterwayKm.

function waterwayBFS(startKey, cellMap, adj, maxKm) {
    const dist = new Map();
    dist.set(startKey, 0);
    const start = cellCenterOf(startKey);
    // 우선순위 없는 BFS 근사 (격자 균일 → 큰 오차 없음). 정확도가 더 필요하면
    // Dijkstra 로 교체 가능(인터페이스 동일).
    const queue = [startKey];
    while (queue.length) {
        const cur = queue.shift();
        const curC = cellCenterOf(cur);
        const curD = dist.get(cur);
        for (const nk of adj.get(cur) || []) {
            const nc = cellCenterOf(nk);
            const step = C.haversineKm(curC.lat, curC.lon, nc.lat, nc.lon);
            const nd = curD + step;
            if (nd > maxKm) continue;
            if (!dist.has(nk) || nd < dist.get(nk)) {
                dist.set(nk, nd);
                queue.push(nk);
            }
        }
    }
    return dist;
}
function cellCenterOf(key) {
    const { gx, gy } = parseCellKey(key);
    return cellCenter(gx, gy);
}

// ============================================================================
// 5. 앵커 선정 (그리디 물길거리 커버링 + 컴포넌트별 최소 1개)
// ============================================================================
//
// seed: 서해·남해 표준항을 가장 가까운 바다셀에 스냅. 그 셀이 앵커.
// 그 후 "아직 ANCHOR_COVER_KM 물길 내 앵커가 없는 셀"이 있으면 그 중 하나를
// 새 앵커로 추가하는 그리디. 컴포넌트마다 최소 1개 앵커 보장.
//
// [적응형 densification 훅] 후보점 IDW vs 실제값 잔차로 추가하는 단계는
//   인터페이스만 마련(densifyHook). 1차는 10km 커버링으로 충분.

function nearestCellKey(lat, lon, cellMap) {
    let best = null, bestD = Infinity;
    // 격자 인덱스 근방부터 탐색 (정확 매칭 우선)
    const k0 = cellKey(lat, lon);
    if (cellMap.has(k0)) return k0;
    // 근방 ±5 셀 박스 탐색
    const { gx, gy } = parseCellKey(k0);
    for (let dx = -5; dx <= 5; dx++) {
        for (let dy = -5; dy <= 5; dy++) {
            const nk = `${gx + dx}_${gy + dy}`;
            if (!cellMap.has(nk)) continue;
            const c = cellCenterOf(nk);
            const d = C.haversineKm(lat, lon, c.lat, c.lon);
            if (d < bestD) { bestD = d; best = nk; }
        }
    }
    return best;
}

function selectAnchors(cellMap, adj, comp, stationsByCell, densifyHook) {
    const anchors = []; // {id, cellKey, lon, lat, stationCode, stationName}
    const anchorCellSet = new Set();
    let aid = 0;

    function addAnchor(cellK, station) {
        if (anchorCellSet.has(cellK)) return;
        const c = cellCenterOf(cellK);
        aid++;
        anchors.push({
            id: 'A' + String(aid).padStart(4, '0'),
            cellKey: cellK,
            lon: +c.lon.toFixed(5),
            lat: +c.lat.toFixed(5),
            stationCode: station ? station.code : null,
            stationName: station ? station.name : null,
            componentId: comp.get(cellK) || null
        });
        anchorCellSet.add(cellK);
    }

    // ── seed: 표준항 → 가장 가까운 셀 ───────────────────────────────
    for (const st of C.getRegionStations()) {
        const ck = nearestCellKey(st.lat, st.lon, cellMap);
        if (ck) addAnchor(ck, st);
    }
    log(`표준항 seed 앵커: ${anchors.length}개`);

    // ── 컴포넌트별 최소 1개 보장 ─────────────────────────────────────
    const coveredComponents = new Set(anchors.map(a => a.componentId));
    const byComponent = new Map();
    for (const key of cellMap.keys()) {
        const cid = comp.get(key);
        if (!byComponent.has(cid)) byComponent.set(cid, []);
        byComponent.get(cid).push(key);
    }
    for (const [cid, keys] of byComponent) {
        if (coveredComponents.has(cid)) continue;
        // 컴포넌트 중심에 가까운 셀 하나를 앵커로
        addAnchor(keys[Math.floor(keys.length / 2)], null);
        coveredComponents.add(cid);
    }
    log(`컴포넌트 보장 후 앵커: ${anchors.length}개 (컴포넌트 ${byComponent.size}개)`);

    // ── 그리디 커버링: 미커버 셀이 없을 때까지 ───────────────────────
    // 각 앵커에서 BFS(ANCHOR_COVER_KM) 로 커버 집합 계산 → 합집합.
    const covered = new Set();
    function markCovered(cellK) {
        const reach = waterwayBFS(cellK, cellMap, adj, CFG.ANCHOR_COVER_KM);
        for (const k of reach.keys()) covered.add(k);
    }
    for (const a of anchors) markCovered(a.cellKey);

    const allKeys = Array.from(cellMap.keys());
    let guard = 0;
    while (guard < 100000) {
        guard++;
        const uncovered = allKeys.find(k => !covered.has(k));
        if (!uncovered) break;
        addAnchor(uncovered, null);
        markCovered(uncovered);
    }
    log(`그리디 커버링 후 앵커: ${anchors.length}개 (전 셀 ${allKeys.length} 커버 완료)`);

    // ── 적응형 densification 훅 (1차 미사용) ─────────────────────────
    if (typeof densifyHook === 'function') {
        try { densifyHook({ anchors, addAnchor, cellMap, adj, comp }); }
        catch (e) { warn('densifyHook 오류(무시):', e.message); }
    }

    return anchors;
}

// ============================================================================
// 6. Z₀ 필드 (표준항 MTL 을 물길거리 IDW 로 셀/앵커에 보간)
// ============================================================================
//
// 표준항 셀(seed 앵커 중 stationCode 보유) 에 MTL(m) 을 부여한 뒤, 각 셀에서
// 가까운 표준항 셀들로 물길거리 IDW. 물길로 닿지 않으면(다른 컴포넌트) 직선거리
// fallback (희소 컴포넌트 방어).

function buildZ0Field(cellMap, adj, anchors, stationMTL) {
    // 표준항 셀: anchor.stationCode → MTL(m)
    const stationCells = []; // {cellKey, lat, lon, z0_m}
    for (const a of anchors) {
        if (!a.stationCode) continue;
        const m = stationMTL[a.stationCode] || findMTLByName(stationMTL, a.stationName);
        if (!m || m.mtl_cm == null) continue;
        stationCells.push({ cellKey: a.cellKey, lat: a.lat, lon: a.lon, z0_m: m.mtl_cm / 100 });
    }
    if (stationCells.length === 0) {
        warn('Z₀ seed(표준항 MTL) 0개 — Z₀ 보간 불가. (조석표 미로드?)');
        return new Map();
    }
    log(`Z₀ seed 표준항 셀: ${stationCells.length}개`);

    // 각 표준항 셀에서 BFS(INTERP_MAX_WATERWAY_KM*2) 로 물길거리 사전 계산
    const stationReach = stationCells.map(sc => ({
        sc,
        reach: waterwayBFS(sc.cellKey, cellMap, adj, CFG.INTERP_MAX_WATERWAY_KM * 2)
    }));

    const z0ByCell = new Map();
    for (const key of cellMap.keys()) {
        // 물길로 닿는 표준항만 IDW
        const contrib = [];
        for (const { sc, reach } of stationReach) {
            if (reach.has(key)) contrib.push({ d: reach.get(key), z0: sc.z0_m });
        }
        let z0;
        if (contrib.length > 0) {
            z0 = idw(contrib);
        } else {
            // fallback: 직선거리 IDW (최근접 3 표준항)
            const c = cellCenterOf(key);
            const lin = stationCells
                .map(sc => ({ d: C.haversineKm(c.lat, c.lon, sc.lat, sc.lon), z0: sc.z0_m }))
                .sort((a, b) => a.d - b.d).slice(0, 3);
            z0 = idw(lin);
        }
        z0ByCell.set(key, z0);
    }
    return z0ByCell;
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
        const w = d < 0.1 ? 1e6 : 1 / (d * d);
        wsum += w; vsum += w * z0;
    }
    return wsum > 0 ? vsum / wsum : null;
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
    log(`예측 셀: ${cellMap.size}개 (CELL_DEG=${CFG.CELL_DEG})`);

    // ── (3) 연결성/컴포넌트 ──────────────────────────────────────────
    const adj = buildAdjacency(cellMap);
    const { comp, componentCount } = labelComponents(cellMap, adj);
    log(`연결성 컴포넌트: ${componentCount}개`);

    // ── (4) 앵커 선정 ────────────────────────────────────────────────
    const anchors = selectAnchors(cellMap, adj, comp, null, null /* densifyHook 1차 미사용 */);

    // ── (5) Z₀ 필드 ─────────────────────────────────────────────────
    const z0ByCell = buildZ0Field(cellMap, adj, anchors, stationMTL);

    // ── 앵커에 Z₀ 부여 ───────────────────────────────────────────────
    for (const a of anchors) {
        a.z0_m = z0ByCell.has(a.cellKey) ? round3(z0ByCell.get(a.cellKey)) : null;
    }

    // ── 셀 배열 직렬화 (드러남 가능 셀만 출력) ───────────────────────
    //   [드러남 필터] 수심 < Z₀ + DRY_MARGIN_M 인 셀만 grid_meta 에 남긴다.
    //   그 외(절대 안 드러나는 깊은 셀)는 어차피 표출 안 되므로 제외 → 출력 크기 통제.
    //   합성(DRYRUN, depth=null)은 파이프라인 검증을 위해 그대로 유지.
    const cellArr = [];
    let droppedDeep = 0;
    for (const [key, v] of cellMap) {
        const z0 = z0ByCell.has(key) ? z0ByCell.get(key) : null;
        if (v.depth != null) {
            // 실데이터: Z₀ 없으면 판정 불가 → 제외. 깊으면(>Z₀+여유) 제외.
            if (z0 == null || v.depth >= z0 + CFG.DRY_MARGIN_M) { droppedDeep++; continue; }
        }
        const c = cellCenterOf(key);
        cellArr.push({
            key,
            lon: +c.lon.toFixed(5),
            lat: +c.lat.toFixed(5),
            depth: v.depth == null ? null : round3(v.depth),
            z0: z0 == null ? null : round3(z0),
            comp: comp.get(key) || null
        });
    }
    log(`드러남 가능 셀: ${cellArr.length}개 (깊어서 제외 ${droppedDeep}개)`);

    writeOutputs(cellArr, anchors, {
        year, fileCount, synthetic, empty: false,
        componentCount, cellDeg: CFG.CELL_DEG
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
            stationCode: a.stationCode, stationName: a.stationName,
            componentId: a.componentId, z0_m: a.z0_m
        }))
    }, null, 2), 'utf8');
    log(`저장: ${C.GRID_META_PATH} (셀 ${cellArr.length}, 앵커 ${anchors.length})`);
    log(`저장: ${C.ANCHORS_PATH}`);
}

// 모듈로도 import 가능하게 export (테스트/스케줄러 트리거 대비)
module.exports = { main, loadTideTable, buildStationMTL };

if (require.main === module) {
    main().catch(e => {
        console.error('[build_tide_field] 치명적 오류:', e);
        process.exit(1);
    });
}
