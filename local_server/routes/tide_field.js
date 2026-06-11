/**
 * ============================================================================
 * 파일명: routes/tide_field.js
 * 역할: "서해·남해 물빠짐(갯벌 노출) 예측" 엔진 라우트 (Phase 2)
 * ============================================================================
 *
 * [엔드포인트]
 *   GET /api/tide-field/meta
 *     → { region_bbox, time_start(ISO), time_end(ISO), step_minutes,
 *         anchor_count, cell_count, generated_at }
 *       사용 가능한 3일 시간범위·격자 메타.
 *
 *   GET /api/tide-field?time=<ISO8601>[&bbox=lonMin,latMin,lonMax,latMax]
 *     → { time, step_minutes, cells: [{lon,lat,state,depth_m}] }
 *       드러남(state=1) 셀만 반환. depth_m=그 시각 물깊이(드러나면 ≤0).
 *
 * [계산 — 앵커가 버킷 기반(연결성 그래프 제거)]
 *   1) 셀별 η(t) = 직선거리 IDW. 직선거리 ≤ INTERP_MAX_KM 이내 가까운 앵커
 *      최대 INTERP_MAX_ANCHORS개 곡선에서 1/d² 보간. (컴포넌트 제약 없음)
 *   2) 물깊이 = d(BADA, MSL m) + η(t)(m) − Z₀(m).
 *   3) 드러남: 물깊이 < 0 → state=1 만 반환. 잠김/미정은 제외(대역폭 절감).
 *   4) bbox 후보 셀만 계산(타일 인덱스). 후보 초과 시 스트라이드 서브샘플.
 *
 * [데이터 준비 안 됨]
 *   grid_meta.json / 곡선이 없으면 503 + 명확한 메시지(준비중). 크래시 X.
 *
 * [연계]
 *   - services/tide_field_common.js → 경로/설정/게이팅
 *   - services/tide_field_collector.js → 곡선 경로/완전성 헬퍼
 *   - scripts/build_tide_field.js → grid_meta.json/anchors.json 생성
 *   - js/tide_field.js → 프론트 레이어가 이 API 소비
 *   - server.js → app.use(require('./routes/tide_field'))
 * ============================================================================
 */

'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');

const C = require('./../services/tide_field_common');
const CFG = C.TIDE_FIELD_CONFIG;
const TFC = require('./../services/tide_field_collector');

// ============================================================================
// 그리드 메타 + 앵커 인덱스 (lazy load + mtime 기반 자동 갱신)
// ============================================================================
let _meta = null;          // grid_meta.json 파싱본
let _metaMtime = 0;
let _anchors = null;       // anchors.json 의 anchors 배열
let _cellAnchorIdx = null; // cellKey -> [{anchor, distKm}] (직선거리 이내)
let _cellTileIdx = null;   // 타일키 -> [cell...] (bbox 후보 선택용)

// ── 프리컴퓨트(frames.bin) 캐시 ───────────────────────────────────────
//   수집 직후 precompute_tide_field.js 가 전 프레임(날짜×시각)×전 셀의
//   물깊이(cm, Int16 LE)를 미리 계산해 둔다. 라우트는 η 재계산 없이 읽어 쓴다.
//   유효하지 않으면(없음/stale/스키마 불일치) 폴백으로 cellDepthM 을 쓴다(무중단).
const FRAMES_SENTINEL = -32768;
let _framesBuf = null;     // Buffer (numFrames × numCells × Int16 LE)
let _framesMeta = null;    // frames_meta.json 파싱본
let _framesBinMtime = 0;
let _framesMetaMtime = 0;
let _framesValid = false;  // 현재 grid_meta/CFG 와 정합해 사용 가능한가
let _frameIndex = null;    // `${date}_${minute}` -> frame index

// bbox 후보 셀 상한. 초과 시 스트라이드 서브샘플로 줄여 계산·렌더량을 통제한다.
//   모바일 벡터 렌더 버벅임 완화 위해 보수적으로(14000). 만(灣) 단위 줌인이면
//   100m 전부, 줌아웃하면 서브샘플 개요.
const MAX_CANDIDATE_CELLS = 14000;
// 셀 타일 인덱스 격자 크기 (도). 0.1° 버킷 — bbox 와 겹치는 타일만 훑는다.
const TILE_DEG = 0.1;

function loadMetaIfNeeded() {
    if (!fs.existsSync(C.GRID_META_PATH)) { _meta = null; return false; }
    let stat;
    try { stat = fs.statSync(C.GRID_META_PATH); } catch (e) { return false; }
    if (_meta && stat.mtimeMs === _metaMtime) return true; // 캐시 유효

    try {
        _meta = JSON.parse(fs.readFileSync(C.GRID_META_PATH, 'utf8'));
        _metaMtime = stat.mtimeMs;
    } catch (e) {
        console.error('[tide_field] grid_meta.json 파싱 실패:', e.message);
        _meta = null;
        return false;
    }
    // 각 셀에 배열 인덱스(_i) 부여 — frames.bin 의 cell 인덱스와 동일(셀 순서 보존).
    if (Array.isArray(_meta.cells)) {
        for (let i = 0; i < _meta.cells.length; i++) _meta.cells[i]._i = i;
    }
    _anchors = TFC.loadAnchors() || [];
    buildCellAnchorIndex();
    buildCellTileIndex();
    // grid_meta 갱신 → 프리컴퓨트 캐시도 다시 검증/로드.
    loadFramesIfNeeded(true);
    // 메타 갱신 시 시각 캐시 무효화
    _timeCache.clear();
    return true;
}

/**
 * 프리컴퓨트 산출물(frames.bin + frames_meta.json)을 로드/검증.
 *   mtime 캐시. 유효성: build_version·cell_deg·step_minutes·grid_generated_at 가
 *   현재 grid_meta/CFG 와 일치하고 num_cells == _meta.cells.length 면 사용.
 *   불일치/없음/파싱실패면 _framesValid=false → 라우트가 cellDepthM 폴백.
 * @param {boolean} force grid_meta 갱신 시 강제 재검증
 */
function loadFramesIfNeeded(force) {
    try {
        if (!fs.existsSync(C.FRAMES_META) || !fs.existsSync(C.FRAMES_BIN)) {
            _framesValid = false; _framesBuf = null; _framesMeta = null; _frameIndex = null;
            return;
        }
        let mstat, bstat;
        try { mstat = fs.statSync(C.FRAMES_META); bstat = fs.statSync(C.FRAMES_BIN); }
        catch (e) { _framesValid = false; return; }
        if (!force && _framesMeta &&
            mstat.mtimeMs === _framesMetaMtime && bstat.mtimeMs === _framesBinMtime) {
            return; // 캐시 유효
        }

        let fm;
        try { fm = JSON.parse(fs.readFileSync(C.FRAMES_META, 'utf8')); }
        catch (e) {
            console.warn('[tide_field] frames_meta.json 파싱 실패 — 폴백:', e.message);
            _framesValid = false; _framesBuf = null; _framesMeta = null; _frameIndex = null;
            return;
        }

        // ── 유효성 검증 ──
        const cellCount = (_meta && Array.isArray(_meta.cells)) ? _meta.cells.length : -1;
        const gridGen = _meta ? (_meta.generated_at || null) : null;
        const cellDeg = _meta ? (_meta.cell_deg || CFG.CELL_DEG) : CFG.CELL_DEG;
        const valid = fm
            && fm.build_version === CFG.BUILD_VERSION
            && fm.cell_deg === cellDeg
            && fm.step_minutes === CFG.STEP_MINUTES
            && fm.grid_generated_at === gridGen
            && fm.num_cells === cellCount
            && Array.isArray(fm.frames);
        if (!valid) {
            console.warn('[tide_field] frames_meta 스키마/메타 불일치 — 프리컴퓨트 미사용(폴백).');
            _framesValid = false; _framesBuf = null; _framesMeta = null; _frameIndex = null;
            _framesMetaMtime = mstat.mtimeMs; _framesBinMtime = bstat.mtimeMs;
            return;
        }

        const buf = fs.readFileSync(C.FRAMES_BIN);
        const expectedBytes = fm.num_frames * fm.num_cells * 2;
        if (buf.length !== expectedBytes) {
            console.warn(`[tide_field] frames.bin 크기 불일치(${buf.length}≠${expectedBytes}) — 폴백.`);
            _framesValid = false; _framesBuf = null; _framesMeta = null; _frameIndex = null;
            _framesMetaMtime = mstat.mtimeMs; _framesBinMtime = bstat.mtimeMs;
            return;
        }

        // (date,minute) → frame index 맵
        const idx = new Map();
        for (let i = 0; i < fm.frames.length; i++) {
            const fr = fm.frames[i];
            idx.set(`${fr.date}_${fr.minute}`, i);
        }

        _framesBuf = buf;
        _framesMeta = fm;
        _frameIndex = idx;
        _framesMetaMtime = mstat.mtimeMs;
        _framesBinMtime = bstat.mtimeMs;
        _framesValid = true;
        console.log(`[tide_field] 프리컴퓨트 로드: ${fm.num_frames}프레임 × ${fm.num_cells}셀 (${(buf.length / 1048576).toFixed(2)}MB)`);
    } catch (e) {
        console.warn('[tide_field] frames 로드 실패 — 폴백:', e.message);
        _framesValid = false; _framesBuf = null; _framesMeta = null; _frameIndex = null;
    }
}

/**
 * 각 셀이 참조할 앵커 목록을 사전 계산.
 *   조건: 직선거리 ≤ INTERP_MAX_KM. 컴포넌트 제약 없음(앵커가 버킷 기반이라
 *   연결성 위상이 없다). 가까운 순 최대 INTERP_MAX_ANCHORS 개.
 */
function buildCellAnchorIndex() {
    _cellAnchorIdx = new Map();
    if (!_meta || !Array.isArray(_meta.cells)) return;

    for (const cell of _meta.cells) {
        const scored = [];
        for (const a of _anchors) {
            const d = C.haversineKm(cell.lat, cell.lon, a.lat, a.lon);
            if (d <= CFG.INTERP_MAX_KM) scored.push({ anchor: a, distKm: d });
        }
        scored.sort((x, y) => x.distKm - y.distKm);
        _cellAnchorIdx.set(cell.key, scored.slice(0, CFG.INTERP_MAX_ANCHORS));
    }
}

/** 셀 타일 인덱스 (0.1° 버킷). bbox 후보 셀을 O(bbox 타일 수) 로 추린다. */
function tileKey(lon, lat) {
    return `${Math.floor(lon / TILE_DEG)}_${Math.floor(lat / TILE_DEG)}`;
}
function buildCellTileIndex() {
    _cellTileIdx = new Map();
    if (!_meta || !Array.isArray(_meta.cells)) return;
    for (const cell of _meta.cells) {
        const tk = tileKey(cell.lon, cell.lat);
        let arr = _cellTileIdx.get(tk);
        if (!arr) { arr = []; _cellTileIdx.set(tk, arr); }
        arr.push(cell);
    }
}

/** bbox 와 겹치는 타일의 셀 중 bbox 내부 셀만 반환. bbox 없으면 전 셀. */
function cellsInBbox(bbox) {
    if (!_meta || !Array.isArray(_meta.cells)) return [];
    if (!bbox) return _meta.cells;
    const [lonMin, latMin, lonMax, latMax] = bbox;
    const out = [];
    const txMin = Math.floor(lonMin / TILE_DEG), txMax = Math.floor(lonMax / TILE_DEG);
    const tyMin = Math.floor(latMin / TILE_DEG), tyMax = Math.floor(latMax / TILE_DEG);
    for (let tx = txMin; tx <= txMax; tx++) {
        for (let ty = tyMin; ty <= tyMax; ty++) {
            const arr = _cellTileIdx.get(`${tx}_${ty}`);
            if (!arr) continue;
            for (const cell of arr) {
                if (cell.lon >= lonMin && cell.lon <= lonMax &&
                    cell.lat >= latMin && cell.lat <= latMax) out.push(cell);
            }
        }
    }
    return out;
}

// ============================================================================
// 앵커 곡선 캐시 (anchorId+date → 분→cm Map 변환본)
// ============================================================================
const _curveCache = new Map(); // `${anchorId}_${yyyymmdd}` -> { mtimeMs, byMinute: Float arr[1440] }

function loadAnchorCurve(anchorId, yyyymmdd) {
    const key = `${anchorId}_${yyyymmdd}`;
    const p = TFC.curvePath(anchorId, yyyymmdd);
    let stat;
    try { stat = fs.statSync(p); } catch (e) { return null; }
    const cached = _curveCache.get(key);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.byMinute;

    let j;
    try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
    if (!j || j.status === 'no_grid' || !Array.isArray(j.curve) || j.curve.length === 0) {
        _curveCache.set(key, { mtimeMs: stat.mtimeMs, byMinute: null });
        return null;
    }
    // 분(0..1439) 인덱스 배열로 변환 (빠른 조회). 결측 분은 NaN.
    const byMinute = new Float32Array(1440).fill(NaN);
    for (const pt of j.curve) {
        const m = hhmmToMin(pt.t);
        if (m != null && pt.h != null) byMinute[m] = pt.h; // cm
    }
    _curveCache.set(key, { mtimeMs: stat.mtimeMs, byMinute });
    return byMinute;
}

function hhmmToMin(t) {
    if (!t || typeof t !== 'string') return null;
    const [h, m] = t.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
}

/** 앵커 곡선에서 특정 분의 η(cm) — 결측 시 인접 분 선형보간 */
function etaCmAt(byMinute, minute) {
    if (!byMinute) return null;
    let v = byMinute[minute];
    if (!isNaN(v)) return v;
    // 좌우 가까운 값 탐색 (최대 ±15분)
    let lo = null, hi = null;
    for (let d = 1; d <= 15; d++) {
        if (lo == null && minute - d >= 0 && !isNaN(byMinute[minute - d])) lo = { m: minute - d, v: byMinute[minute - d] };
        if (hi == null && minute + d < 1440 && !isNaN(byMinute[minute + d])) hi = { m: minute + d, v: byMinute[minute + d] };
        if (lo && hi) break;
    }
    if (lo && hi) {
        const f = (minute - lo.m) / (hi.m - lo.m);
        return lo.v + f * (hi.v - lo.v);
    }
    return lo ? lo.v : (hi ? hi.v : null);
}

// ============================================================================
// 시각 파싱 (KST 윈도우 내 YYYYMMDD + 분)
// ============================================================================
function parseTimeToKst(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    // KST 로 변환
    const kst = new Date(d.getTime() + 9 * 3600000);
    const y = kst.getUTCFullYear();
    const mo = String(kst.getUTCMonth() + 1).padStart(2, '0');
    const day = String(kst.getUTCDate()).padStart(2, '0');
    const minute = kst.getUTCHours() * 60 + kst.getUTCMinutes();
    return { yyyymmdd: parseInt(`${y}${mo}${day}`, 10), minute };
}

// ============================================================================
// 시각별 곡선 캐시 (computeField 는 후보 셀에 따라 결과가 달라 결과 캐시는 두지
//   않는다. 곡선(_curveCache)·앵커 인덱스 캐시로 충분히 빠르다.)
// ============================================================================
const _timeCache = new Map(); // 호환용 placeholder (loadMetaIfNeeded 가 clear 호출)

function snapMinute(minute) {
    const step = CFG.STEP_MINUTES;
    return Math.round(minute / step) * step % 1440;
}

/**
 * 주어진 후보 셀들의 한 시각 상태 계산 → 드러남(state=1) 셀만 반환.
 * @param {number} yyyymmdd
 * @param {number} minute
 * @param {Array} cells  후보 셀(_meta.cells 의 부분집합)
 * @returns {Array<{lon,lat,state,depth_m}>}  state=1(드러남) 만
 */
function computeField(yyyymmdd, minute, cells) {
    const snapped = snapMinute(minute);
    const out = [];
    for (const cell of cells) {
        const dm = getDepthM(cell, yyyymmdd, snapped);
        if (dm == null || dm >= 0) continue;   // 미정/잠김 제외, 드러남(<0)만
        out.push({ lon: cell.lon, lat: cell.lat, state: 1, depth_m: Math.round(dm * 100) / 100 });
    }
    return out;
}

/** 단일 셀의 그 시각 물깊이(m) — 미정이면 null. (집계·computeField 공용) */
function cellDepthM(cell, yyyymmdd, snapped) {
    const d = cell.depth, z0 = cell.z0;       // BADA 수심·Z₀ (m). null 가능.
    if (d == null || z0 == null) return null;
    const refs = _cellAnchorIdx.get(cell.key) || [];
    let wsum = 0, vsum = 0;
    for (const { anchor, distKm } of refs) {
        const byMinute = loadAnchorCurve(anchor.id, yyyymmdd);
        const eta = etaCmAt(byMinute, snapped);
        if (eta == null) continue;
        const w = distKm < 0.1 ? 1e6 : 1 / (distKm * distKm);
        wsum += w; vsum += w * eta;
    }
    if (wsum === 0) return null;               // 보간 곡선 없음 — 미정
    return d + (vsum / wsum) / 100 - z0;       // 물깊이(m)
}

/**
 * 셀의 그 시각 물깊이(m) 조회 — 프리컴퓨트 우선, 없으면 cellDepthM 폴백.
 *   프리컴퓨트 사용 가능 + 해당 (date,snapped) 프레임 존재 → frames.bin Int16(cm)/100.
 *     sentinel(-32768)이면 null.
 *   그 외(미사용/stale/해당 프레임 없음) → 기존 cellDepthM (무중단 폴백).
 * @param {Object} cell  _meta.cells 원소 (cell._i = frames.bin 의 cell 인덱스)
 * @param {number} yyyymmdd
 * @param {number} snapped  STEP_MINUTES 격자로 스냅된 분
 */
function getDepthM(cell, yyyymmdd, snapped) {
    if (_framesValid && _framesBuf && _frameIndex) {
        const f = _frameIndex.get(`${yyyymmdd}_${snapped}`);
        if (f != null) {
            const ci = cell._i;
            if (ci != null && ci >= 0 && ci < _framesMeta.num_cells) {
                const cm = _framesBuf.readInt16LE((f * _framesMeta.num_cells + ci) * 2);
                if (cm === FRAMES_SENTINEL) return null;
                return cm / 100;
            }
        }
        // 해당 프레임/셀 인덱스가 없으면 폴백.
    }
    return cellDepthM(cell, yyyymmdd, snapped);
}

// ============================================================================
// 라우트
// ============================================================================

/** GET /api/tide-field/meta */
router.get('/api/tide-field/meta', (req, res) => {
    if (!loadMetaIfNeeded() || !_meta) {
        return res.status(503).json({
            success: false,
            ready: false,
            error: '물빠짐 예측 데이터가 아직 준비되지 않았습니다. (grid_meta 미생성)'
        });
    }
    if (_meta.meta && _meta.meta.empty) {
        return res.status(503).json({
            success: false, ready: false,
            error: '물빠짐 격자가 비어 있습니다 (수심 데이터 없음). 운영 볼륨에서 build_tide_field.js 실행 필요.'
        });
    }

    // 시간 범위 = 오늘 00:00 KST ~ +WINDOW_DAYS일 (KST). ISO(UTC) 로 표기.
    const dates = TFC.windowDatesKST(CFG.WINDOW_DAYS);
    const startStr = String(dates[0]);
    const endStr = String(dates[dates.length - 1]);
    // KST 자정 → UTC = 전일 15:00Z
    const timeStartISO = kstMidnightToISO(startStr, 0);
    const timeEndISO = kstMidnightToISO(endStr, 1440); // 마지막 날 24:00

    res.set('Cache-Control', 'public, max-age=300');
    res.json({
        success: true,
        ready: true,
        region_bbox: _meta.region_bbox || C.REGION_BBOX,
        time_start: timeStartISO,
        time_end: timeEndISO,
        step_minutes: CFG.STEP_MINUTES,   // 시각 간격은 설정값(=요청시 정합) 사용 — 재빌드 불필요
        window_days: _meta.window_days || CFG.WINDOW_DAYS,
        anchor_count: _meta.anchor_count || (_anchors ? _anchors.length : 0),
        cell_count: _meta.cell_count || (_meta.cells ? _meta.cells.length : 0),
        generated_at: _meta.generated_at || null
    });
});

/** GET /api/tide-field?time=ISO[&bbox=lonMin,latMin,lonMax,latMax] */
router.get('/api/tide-field', (req, res) => {
    if (!loadMetaIfNeeded() || !_meta || (_meta.meta && _meta.meta.empty)) {
        return res.status(503).json({
            success: false, ready: false,
            error: '물빠짐 예측 데이터가 아직 준비되지 않았습니다.'
        });
    }

    const timeQ = req.query.time;
    const parsed = timeQ ? parseTimeToKst(timeQ) : parseTimeToKst(new Date().toISOString());
    if (!parsed) {
        return res.status(400).json({ success: false, error: 'time(ISO8601) 형식이 올바르지 않습니다.' });
    }

    // 윈도우 밖 시각이면 거부 (수집되지 않은 날짜)
    const validDates = TFC.windowDatesKST(CFG.WINDOW_DAYS);
    if (!validDates.includes(parsed.yyyymmdd)) {
        return res.status(400).json({
            success: false,
            error: `요청 시각이 예측 윈도우(${validDates[0]}~${validDates[validDates.length - 1]}) 밖입니다.`
        });
    }

    // ── bbox 후보 셀 선택 (타일 인덱스) ──────────────────────────────
    let bbox = null;
    if (req.query.bbox) {
        const b = String(req.query.bbox).split(',').map(Number);
        if (b.length === 4 && b.every(n => !isNaN(n))) bbox = b;
    }
    const candidates = cellsInBbox(bbox);

    // ── 면적 보존 집계: 줌과 무관하게 "실제 드러난 면적"을 일관되게 표출 ──────
    //   버킷을 통째로 칠하면(이전 방식) 작은 갯벌이 큰 버킷으로 부풀려져 축척마다
    //   면적이 달라진다. 대신 버킷의 드러난 셀 "면적"만큼만 타일 크기(s)를 정한다:
    //     드러난면적 ≈ (드러난 비율 f) × (버킷 내 드러남가능 셀 수 n) × fineDeg²
    //     타일 한 변 s = √(드러난면적)  → 줌이 달라도 같은 면적으로 표출.
    //   노출 비율 f 는 버킷에서 M개만 샘플 계산(계산량 통제).
    const snapped = snapMinute(parsed.minute);
    const fineDeg = (_meta.cell_deg || CFG.CELL_DEG);
    const fineArea = fineDeg * fineDeg;

    let aggDeg = parseFloat(req.query.agg);
    if (!(aggDeg > fineDeg)) aggDeg = fineDeg;

    let cells;
    let cellDegUsed = fineDeg;
    if (aggDeg > fineDeg * 1.4) {
        // 버킷별 셀 그룹 + 무게중심
        const buckets = new Map();
        for (const c of candidates) {
            if (c.depth == null || c.z0 == null) continue;
            const k = Math.floor(c.lon / aggDeg) + '_' + Math.floor(c.lat / aggDeg);
            let b = buckets.get(k);
            if (!b) { b = { cells: [], sumLon: 0, sumLat: 0 }; buckets.set(k, b); }
            b.cells.push(c); b.sumLon += c.lon; b.sumLat += c.lat;
        }
        const M = 8;
        cells = [];
        for (const b of buckets.values()) {
            const n = b.cells.length;
            const step = Math.max(1, Math.floor(n / M));
            let sampled = 0, exposed = 0, depthSum = 0;
            for (let i = 0; i < n; i += step) {
                const dm = getDepthM(b.cells[i], parsed.yyyymmdd, snapped);
                if (dm == null) continue;
                sampled++;
                if (dm < 0) { exposed++; depthSum += dm; }
            }
            if (!sampled || !exposed) continue;
            const frac = exposed / sampled;
            const side = Math.sqrt(frac * n * fineArea);   // 면적 보존 타일 한 변(도)
            cells.push({
                lon: +(b.sumLon / n).toFixed(5),
                lat: +(b.sumLat / n).toFixed(5),
                s: +side.toFixed(6),
                state: 1, depth_m: Math.round((depthSum / exposed) * 100) / 100
            });
        }
        cellDegUsed = aggDeg;
    } else {
        cells = computeField(parsed.yyyymmdd, parsed.minute, candidates);
        for (const c of cells) c.s = fineDeg;   // 미세 셀은 fineDeg 크기
    }

    res.set('Cache-Control', 'public, max-age=120');
    res.json({
        success: true,
        time: timeQ || new Date().toISOString(),
        date: parsed.yyyymmdd,
        step_minutes: CFG.STEP_MINUTES,
        cell_deg: cellDegUsed,
        candidate_count: candidates.length,
        count: cells.length,
        precomputed: _framesValid,   // 디버그: 프리컴퓨트 사용 여부
        cells
    });
});

function kstMidnightToISO(yyyymmdd, addMinutes) {
    const s = String(yyyymmdd);
    const y = +s.slice(0, 4), mo = +s.slice(4, 6) - 1, d = +s.slice(6, 8);
    // KST 자정의 UTC ms = Date.UTC(y,mo,d,0,0) - 9h
    const utcMs = Date.UTC(y, mo, d, 0, 0) - 9 * 3600000 + (addMinutes || 0) * 60000;
    return new Date(utcMs).toISOString();
}

/**
 * GET /api/tide-field/status
 * 수집 진행 현황 — 총 (앵커×날짜) 중 몇 건 수집됐는지 + 진행 여부.
 * 브라우저로 폴링하며 "몇 개 중 몇 번째" 확인용.
 */
router.get('/api/tide-field/status', (req, res) => {
    try {
        res.json({ success: true, ...TFC.getStatus() });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * GET /api/tide-field/nogrid
 * TideBED 격자 미제공(no_grid) 앵커를 좌표와 함께 보고 (운영 진단용).
 *   - summary: 앵커별 대표 상태 집계(complete/partial/no_grid/failed/missing)
 *   - no_grid: 격자 미제공 앵커 [{id,lon,lat}] — 지도에 찍어 빈 구역 파악·앵커 보정 판단.
 */
router.get('/api/tide-field/nogrid', (req, res) => {
    try {
        res.json({ success: true, ...TFC.getNoGridReport() });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * GET /api/tide-field/anchors
 * 앵커 포인트 목록 (프론트 15회 클릭 제스처 — 데이터 확보 해점 증명).
 *   - lon/lat: 실제 수집 좌표(보정 시 이동된 좌표). origLon/origLat: 논리 위치.
 *   - status: complete|partial|no_grid|missing, nudged: 보정 이동 여부.
 *   - secured: 데이터 확보(complete|partial) 해점 수, nudged: 보정 이동 해점 수.
 */
router.get('/api/tide-field/anchors', (req, res) => {
    try {
        res.json({ success: true, ...TFC.getAnchorReport() });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * GET /api/tide-field/debug?lat=&lon=
 * 한 지점의 조위(η)·물깊이 시계열을 전 프레임(3일)에 대해 반환 + 자동 분석.
 *   - 자정(날짜 경계)에서 η가 비현실적으로 점프하는지(maxJumpCm)
 *   - 특정 날짜의 곡선이 결측인지(missingByDate: anchorsUsed=0 프레임 수)
 *   → "급변"이 데이터(곡선 결측/불연속) 문제인지 모델(이진) 문제인지 판별용.
 */
router.get('/api/tide-field/debug', (req, res) => {
    if (!loadMetaIfNeeded() || !_meta || !Array.isArray(_meta.cells) || (_meta.meta && _meta.meta.empty)) {
        return res.status(503).json({ success: false, ready: false });
    }
    const lat = parseFloat(req.query.lat), lon = parseFloat(req.query.lon);
    if (isNaN(lat) || isNaN(lon)) return res.status(400).json({ success: false, error: 'lat/lon 필요' });

    // 가장 가까운 셀
    let nearest = null, nd = Infinity;
    for (const cell of _meta.cells) {
        const d = (cell.lat - lat) * (cell.lat - lat) + (cell.lon - lon) * (cell.lon - lon);
        if (d < nd) { nd = d; nearest = cell; }
    }
    if (!nearest) return res.json({ success: false, error: '셀 없음' });
    const refs = _cellAnchorIdx.get(nearest.key) || [];
    const dates = TFC.windowDatesKST(CFG.WINDOW_DAYS);
    const step = CFG.STEP_MINUTES;

    const series = [];
    for (const ymd of dates) {
        for (let m = 0; m < 1440; m += step) {
            let wsum = 0, vsum = 0, nUsed = 0;
            for (const { anchor, distKm } of refs) {
                const bm = loadAnchorCurve(anchor.id, ymd);
                const eta = etaCmAt(bm, m);
                if (eta == null) continue;
                const w = distKm < 0.1 ? 1e6 : 1 / (distKm * distKm);
                wsum += w; vsum += w * eta; nUsed++;
            }
            const etaCm = wsum > 0 ? vsum / wsum : null;
            const depthM = (etaCm != null && nearest.depth != null && nearest.z0 != null)
                ? nearest.depth + etaCm / 100 - nearest.z0 : null;
            series.push({
                date: ymd, min: m,
                etaCm: etaCm == null ? null : Math.round(etaCm),
                depthM: depthM == null ? null : Math.round(depthM * 100) / 100,
                anchorsUsed: nUsed
            });
        }
    }
    // 자동 분석: 인접 프레임 η 최대 점프 + 날짜별 결측 수
    let maxJumpCm = 0, jumpAt = null;
    for (let i = 1; i < series.length; i++) {
        if (series[i].etaCm != null && series[i - 1].etaCm != null) {
            const j = Math.abs(series[i].etaCm - series[i - 1].etaCm);
            if (j > maxJumpCm) { maxJumpCm = j; jumpAt = { from: series[i - 1], to: series[i] }; }
        }
    }
    const missingByDate = {};
    for (const s of series) if (s.anchorsUsed === 0) missingByDate[s.date] = (missingByDate[s.date] || 0) + 1;

    res.json({
        success: true,
        cell: { lat: nearest.lat, lon: nearest.lon, depth: nearest.depth, z0: nearest.z0 },
        anchorCount: refs.length,
        anchors: refs.map(r => ({ id: r.anchor.id, distKm: Math.round(r.distKm * 10) / 10 })),
        analysis: { maxJumpCm, jumpAt, missingByDate, stepMinutes: step },
        series
    });
});

module.exports = router;
