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
 *       state: 0=잠김, 1=드러남. depth_m=그 시각 물깊이(드러나면 ≤0).
 *
 * [계산]
 *   1) 셀별 η(t) = 물길거리 제약 IDW. "같은 연결성 컴포넌트 + INTERP_MAX_WATERWAY_KM
 *      이내" 앵커 곡선에서 보간 (곶·섬 너머 앵커 배제 — 컴포넌트 라벨이 보장).
 *   2) 물깊이 = d(BADA, MSL m) + η(t)(m) − Z₀(m).
 *   3) state: 물깊이 < 0 → 드러남(1), 아니면 잠김(0). (η < Z₀ − d 와 동치)
 *   4) 시각별 결과 캐시(성능).
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
let _cellAnchorIdx = null; // cellKey -> [{anchor, distKm}] (같은 comp + 거리 이내)

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
    _anchors = TFC.loadAnchors() || [];
    buildCellAnchorIndex();
    // 메타 갱신 시 시각 캐시 무효화
    _timeCache.clear();
    return true;
}

/**
 * 각 셀이 참조할 앵커 목록을 사전 계산.
 *   조건: 같은 연결성 컴포넌트(comp) + 직선거리 ≤ INTERP_MAX_WATERWAY_KM.
 *   컴포넌트 라벨이 곶·섬 너머 연결을 이미 차단하므로, 같은 comp 안에서는
 *   직선거리로 근사해도 물길 위상이 보존된다. 가까운 순 최대 INTERP_MAX_ANCHORS 개.
 */
function buildCellAnchorIndex() {
    _cellAnchorIdx = new Map();
    if (!_meta || !Array.isArray(_meta.cells)) return;

    // 컴포넌트별 앵커 버킷
    const anchorsByComp = new Map();
    for (const a of _anchors) {
        const cid = a.componentId == null ? '_' : a.componentId;
        if (!anchorsByComp.has(cid)) anchorsByComp.set(cid, []);
        anchorsByComp.get(cid).push(a);
    }

    for (const cell of _meta.cells) {
        const cid = cell.comp == null ? '_' : cell.comp;
        const pool = anchorsByComp.get(cid) || [];
        const scored = [];
        for (const a of pool) {
            const d = C.haversineKm(cell.lat, cell.lon, a.lat, a.lon);
            if (d <= CFG.INTERP_MAX_WATERWAY_KM) scored.push({ anchor: a, distKm: d });
        }
        scored.sort((x, y) => x.distKm - y.distKm);
        _cellAnchorIdx.set(cell.key, scored.slice(0, CFG.INTERP_MAX_ANCHORS));
    }
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
// 시각별 결과 캐시
// ============================================================================
const _timeCache = new Map(); // `${yyyymmdd}_${snappedMinute}` -> cells[]
const TIME_CACHE_MAX = 200;

function snapMinute(minute) {
    const step = CFG.STEP_MINUTES;
    return Math.round(minute / step) * step % 1440;
}

/**
 * 한 시각의 전 셀 상태 계산.
 * @returns {Array<{lon,lat,state,depth_m}>}
 */
function computeField(yyyymmdd, minute) {
    const snapped = snapMinute(minute);
    const ck = `${yyyymmdd}_${snapped}`;
    if (_timeCache.has(ck)) return _timeCache.get(ck);

    const out = [];
    for (const cell of _meta.cells) {
        const refs = _cellAnchorIdx.get(cell.key) || [];
        // η(t) IDW (cm)
        let wsum = 0, vsum = 0;
        for (const { anchor, distKm } of refs) {
            const byMinute = loadAnchorCurve(anchor.id, yyyymmdd);
            const eta = etaCmAt(byMinute, snapped);
            if (eta == null) continue;
            const w = distKm < 0.1 ? 1e6 : 1 / (distKm * distKm);
            wsum += w; vsum += w * eta;
        }
        if (wsum === 0) {
            // 이 셀에 보간 가능한 곡선 없음 → 미정(state=-1). 프론트는 미표시.
            out.push({ lon: cell.lon, lat: cell.lat, state: -1, depth_m: null });
            continue;
        }
        const etaM = (vsum / wsum) / 100; // cm → m
        const d = cell.depth;             // BADA 수심 (MSL, m). null 가능(합성/결측).
        const z0 = cell.z0;               // Z₀ (m). null 가능.
        if (d == null || z0 == null) {
            out.push({ lon: cell.lon, lat: cell.lat, state: -1, depth_m: null });
            continue;
        }
        const depthM = d + etaM - z0;     // 물깊이(m)
        const state = depthM < 0 ? 1 : 0; // 드러남 / 잠김
        out.push({ lon: cell.lon, lat: cell.lat, state, depth_m: Math.round(depthM * 100) / 100 });
    }

    // LRU 흉내 (단순 FIFO)
    if (_timeCache.size >= TIME_CACHE_MAX) {
        const firstKey = _timeCache.keys().next().value;
        _timeCache.delete(firstKey);
    }
    _timeCache.set(ck, out);
    return out;
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
        step_minutes: _meta.step_minutes || CFG.STEP_MINUTES,
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

    let cells = computeField(parsed.yyyymmdd, parsed.minute);

    // bbox 필터 (선택) — 뷰포트 전송량 절감
    if (req.query.bbox) {
        const b = String(req.query.bbox).split(',').map(Number);
        if (b.length === 4 && b.every(n => !isNaN(n))) {
            const [lonMin, latMin, lonMax, latMax] = b;
            cells = cells.filter(c => c.lon >= lonMin && c.lon <= lonMax && c.lat >= latMin && c.lat <= latMax);
        }
    }

    // state=-1(미정) 셀은 전송 제외 — 프론트가 표시하지 않으므로 대역폭 절감.
    const visible = cells.filter(c => c.state >= 0);

    res.set('Cache-Control', 'public, max-age=120');
    res.json({
        success: true,
        time: timeQ || new Date().toISOString(),
        date: parsed.yyyymmdd,
        step_minutes: CFG.STEP_MINUTES,
        count: visible.length,
        cells: visible
    });
});

function kstMidnightToISO(yyyymmdd, addMinutes) {
    const s = String(yyyymmdd);
    const y = +s.slice(0, 4), mo = +s.slice(4, 6) - 1, d = +s.slice(6, 8);
    // KST 자정의 UTC ms = Date.UTC(y,mo,d,0,0) - 9h
    const utcMs = Date.UTC(y, mo, d, 0, 0) - 9 * 3600000 + (addMinutes || 0) * 60000;
    return new Date(utcMs).toISOString();
}

module.exports = router;
