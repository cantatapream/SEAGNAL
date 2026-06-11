/**
 * ============================================================================
 * 파일명: scripts/precompute_tide_field.js
 * 역할: "서해·남해 물빠짐 예측" 서버 사이드 프리컴퓨트 (Phase 1.5)
 * ============================================================================
 *
 * [무엇을 / 왜]
 *   지금까지 라우트(routes/tide_field.js)는 사용자가 시각을 고를 때마다 셀별
 *   조위(η) IDW 보간 + 노출 판정을 "매 요청마다" 계산했다(무겁고 첫 재생 시
 *   로딩 지연). 이 스크립트는 수집(tide_field_collector) 직후 1회 실행되어,
 *   윈도우 전 프레임(날짜 × 시각) × 전 셀의 "물깊이(cm)"를 미리 계산해
 *   바이너리(frames.bin)로 저장한다. 라우트는 그걸 꺼내 쓰기만 하므로
 *   요청이 가벼워지고(η 계산 제거) 사용자는 즉시·무로딩으로 본다.
 *
 * [계산 — 라우트 cellDepthM 과 동일한 물리 모델]
 *   - 셀→앵커 인덱스: 같은 cellKey 가 아니라(라우트도 그렇다) 직선거리
 *     ≤ INTERP_MAX_KM 이내, 가까운 순 최대 INTERP_MAX_ANCHORS 개.
 *   - η(t) = Σ(1/d²·η)/Σ(1/d²)  (가까운 앵커 곡선 IDW, cm)
 *   - 물깊이(m) = depth(BADA, MSL) + η/100 − Z₀.  → cm 로 환산해 Int16 저장.
 *   - 미정(곡선 없음 / depth·z0 null / 보간 불가) = sentinel(-32768).
 *
 * [산출물 — 원자적 tmp→rename]
 *   - data/tide_field/frames.bin       : numFrames × numCells × Int16 LE.
 *       (frame f, cell c → 오프셋 (f*numCells + c)*2 바이트)
 *   - data/tide_field/frames_meta.json : { generated_at, grid_generated_at,
 *       build_version, cell_deg, step_minutes, window_dates, num_frames,
 *       num_cells, frames:[{date,minute}...] }  (frames 순서 = frames.bin 순서)
 *   셀 순서는 grid_meta.cells 순서 그대로 → 라우트가 배열 인덱스로 바로 조회.
 *
 * [신선도]
 *   frames_meta 가 이미 최신(grid_generated_at·build_version·cell_deg·
 *   step_minutes·window_dates 일치)이면 재계산 없이 skip.
 *
 * [실행]
 *   node scripts/precompute_tide_field.js
 *   (tide_field_collector.spawnPrecompute 가 수집 직후 자식 프로세스로 spawn)
 *
 *   환경변수:
 *     TIDE_FIELD_DRYRUN=1  grid_meta/곡선이 없거나 비어도 graceful (검증용).
 *
 * [연계]
 *   - services/tide_field_common.js   → 경로/설정/게이팅·유틸 (path 만 의존)
 *   - scripts/build_tide_field.js     → grid_meta.json/anchors.json 생성
 *   - routes/tide_field.js            → frames.bin 을 읽어 η 재계산 없이 응답
 *   - services/tide_field_collector.js→ 수집 후 spawnPrecompute 로 본 스크립트 실행
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

const C = require('../services/tide_field_common');
const CFG = C.TIDE_FIELD_CONFIG;

const SENTINEL = -32768; // 미정/곡선없음/depth·z0 null

function log(...a) { console.log('[precompute_tide_field]', ...a); }
function warn(...a) { console.warn('[precompute_tide_field]', ...a); }

// ============================================================================
// 날짜 유틸 (KST) — collector.windowDatesKST 와 동일 로직 (의존성 최소화 위해 복제)
// ============================================================================
function windowDatesKST(nDays) {
    const nowKst = new Date(Date.now() + 9 * 3600000);
    const out = [];
    for (let i = 0; i < nDays; i++) {
        const d = new Date(nowKst.getTime() + i * 86400000);
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        out.push(parseInt(`${y}${m}${day}`, 10));
    }
    return out;
}

// ============================================================================
// 앵커 로드
// ============================================================================
function loadAnchors() {
    if (!fs.existsSync(C.ANCHORS_PATH)) return null;
    try {
        const j = JSON.parse(fs.readFileSync(C.ANCHORS_PATH, 'utf8'));
        return Array.isArray(j.anchors) ? j.anchors : null;
    } catch (e) {
        warn('anchors.json 로드 실패:', e.message);
        return null;
    }
}

function curvePath(anchorId, yyyymmdd) {
    return path.join(C.CURVES_DIR, `${anchorId}_${yyyymmdd}.json`);
}

// ============================================================================
// 셀→앵커 인덱스 (라우트 buildCellAnchorIndex 와 동일 로직)
//   직선거리 ≤ INTERP_MAX_KM, 가까운 순 최대 INTERP_MAX_ANCHORS 개.
// ============================================================================
function buildCellAnchorIndex(cells, anchors) {
    const idx = new Map(); // cellKey -> [{anchor, distKm}]
    for (const cell of cells) {
        const scored = [];
        for (const a of anchors) {
            const d = C.haversineKm(cell.lat, cell.lon, a.lat, a.lon);
            if (d <= CFG.INTERP_MAX_KM) scored.push({ anchor: a, distKm: d });
        }
        scored.sort((x, y) => x.distKm - y.distKm);
        idx.set(cell.key, scored.slice(0, CFG.INTERP_MAX_ANCHORS));
    }
    return idx;
}

// ============================================================================
// 앵커 곡선 캐시 (라우트 loadAnchorCurve 와 동일) — anchorId+date → Float32Array[1440](cm)
// ============================================================================
const _curveCache = new Map(); // `${anchorId}_${date}` -> Float32Array|null

function hhmmToMin(t) {
    if (!t || typeof t !== 'string') return null;
    const [h, m] = t.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
}

function loadAnchorCurve(anchorId, yyyymmdd) {
    const key = `${anchorId}_${yyyymmdd}`;
    if (_curveCache.has(key)) return _curveCache.get(key);
    const p = curvePath(anchorId, yyyymmdd);
    let j;
    try { j = JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { _curveCache.set(key, null); return null; }
    if (!j || j.status === 'no_grid' || !Array.isArray(j.curve) || j.curve.length === 0) {
        _curveCache.set(key, null);
        return null;
    }
    const byMinute = new Float32Array(1440).fill(NaN);
    for (const pt of j.curve) {
        const m = hhmmToMin(pt.t);
        if (m != null && pt.h != null) byMinute[m] = pt.h; // cm
    }
    _curveCache.set(key, byMinute);
    return byMinute;
}

/** 앵커 곡선에서 특정 분의 η(cm) — 결측 시 인접 분 선형보간 (라우트 etaCmAt 동일) */
function etaCmAt(byMinute, minute) {
    if (!byMinute) return null;
    let v = byMinute[minute];
    if (!isNaN(v)) return v;
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

/** 단일 셀의 그 시각 물깊이(m) — 미정이면 null. (라우트 cellDepthM 과 동일) */
function cellDepthM(cell, refs, yyyymmdd, snapped) {
    const d = cell.depth, z0 = cell.z0;
    if (d == null || z0 == null) return null;
    let wsum = 0, vsum = 0;
    for (const { anchor, distKm } of refs) {
        const byMinute = loadAnchorCurve(anchor.id, yyyymmdd);
        const eta = etaCmAt(byMinute, snapped);
        if (eta == null) continue;
        const w = distKm < 0.1 ? 1e6 : 1 / (distKm * distKm);
        wsum += w; vsum += w * eta;
    }
    if (wsum === 0) return null;
    return d + (vsum / wsum) / 100 - z0;
}

// ============================================================================
// 신선도 체크
// ============================================================================
function arraysEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

function isUpToDate(meta, gridGeneratedAt, windowDates) {
    if (!fs.existsSync(C.FRAMES_META)) return false;
    let fm;
    try { fm = JSON.parse(fs.readFileSync(C.FRAMES_META, 'utf8')); }
    catch (e) { return false; }
    return fm
        && fm.grid_generated_at === gridGeneratedAt
        && fm.build_version === CFG.BUILD_VERSION
        && fm.cell_deg === (meta.cell_deg || CFG.CELL_DEG)
        && fm.step_minutes === CFG.STEP_MINUTES
        && arraysEqual(fm.window_dates, windowDates);
}

// ============================================================================
// 메인
// ============================================================================
async function main() {
    const DRYRUN = process.env.TIDE_FIELD_DRYRUN === '1';
    log(`시작 (dryrun=${DRYRUN})`);

    // ── grid_meta 로드 ────────────────────────────────────────────────
    if (!fs.existsSync(C.GRID_META_PATH)) {
        warn('grid_meta.json 없음 — 먼저 build_tide_field.js 실행 필요. 종료(no-op).');
        return;
    }
    let meta;
    try { meta = JSON.parse(fs.readFileSync(C.GRID_META_PATH, 'utf8')); }
    catch (e) { warn('grid_meta.json 파싱 실패:', e.message, '— 종료.'); return; }

    if (meta.meta && meta.meta.empty) {
        warn('grid_meta 가 비어 있음(meta.empty) — 프리컴퓨트할 셀 없음. 종료(no-op).');
        return;
    }
    const cells = Array.isArray(meta.cells) ? meta.cells : [];
    if (cells.length === 0) {
        warn('grid_meta.cells 0개 — 종료(no-op).');
        return;
    }

    const anchors = loadAnchors() || [];
    const gridGeneratedAt = meta.generated_at || null;
    const cellDeg = meta.cell_deg || CFG.CELL_DEG;
    const windowDates = windowDatesKST(CFG.WINDOW_DAYS);

    // ── 신선도 체크 ──────────────────────────────────────────────────
    if (isUpToDate(meta, gridGeneratedAt, windowDates)) {
        log('frames_meta 가 이미 최신(grid_generated_at·build_version·cell_deg·step_minutes·window_dates 일치) — skip.');
        return;
    }

    // ── 셀→앵커 인덱스 ────────────────────────────────────────────────
    const cellAnchorIdx = buildCellAnchorIndex(cells, anchors);

    // ── 프레임 목록 = 날짜 × (0..1439 step STEP_MINUTES) ──────────────
    const step = CFG.STEP_MINUTES;
    const minutes = [];
    for (let m = 0; m < 1440; m += step) minutes.push(m);
    const frames = [];
    for (const date of windowDates) {
        for (const minute of minutes) frames.push({ date, minute });
    }
    const numFrames = frames.length;
    const numCells = cells.length;

    log(`프리컴퓨트: ${numFrames}프레임 × ${numCells}셀 (날짜 ${windowDates.length} × 시각 ${minutes.length}, step=${step}분) ...`);

    // ── 계산 → Int16(cm) 버퍼 ────────────────────────────────────────
    const buf = Buffer.allocUnsafe(numFrames * numCells * 2);
    let defined = 0;
    for (let f = 0; f < numFrames; f++) {
        const { date, minute } = frames[f];
        // STEP_MINUTES 격자로 이미 정렬돼 있어 snapped == minute 이지만,
        // 라우트 snapMinute 와 정합되도록 동일 식으로 산출한다.
        const snapped = Math.round(minute / step) * step % 1440;
        const base = f * numCells * 2;
        for (let c = 0; c < numCells; c++) {
            const cell = cells[c];
            const refs = cellAnchorIdx.get(cell.key) || [];
            const dm = cellDepthM(cell, refs, date, snapped); // m or null
            let v = SENTINEL;
            if (dm != null) {
                let cm = Math.round(dm * 100);
                // Int16 범위 클램프(물깊이는 대략 -1500~+800cm 라 안전하지만 방어적으로).
                if (cm > 32767) cm = 32767;
                else if (cm < -32767) cm = -32767; // SENTINEL(-32768) 과 충돌 회피
                v = cm;
                defined++;
            }
            buf.writeInt16LE(v, base + c * 2);
        }
        if ((f + 1) % 24 === 0 || f === numFrames - 1) {
            log(`  진행 ${f + 1}/${numFrames} 프레임 (정의된 셀값 누적 ${defined})`);
        }
    }

    // ── 출력 (원자적 tmp→rename) ─────────────────────────────────────
    fs.mkdirSync(C.TIDE_FIELD_DIR, { recursive: true });

    const framesMeta = {
        generated_at: new Date().toISOString(),
        grid_generated_at: gridGeneratedAt,
        build_version: CFG.BUILD_VERSION,
        cell_deg: cellDeg,
        step_minutes: step,
        window_dates: windowDates,
        num_frames: numFrames,
        num_cells: numCells,
        frames
    };

    const binTmp = C.FRAMES_BIN + '.tmp';
    const metaTmp = C.FRAMES_META + '.tmp';
    fs.writeFileSync(binTmp, buf);
    fs.writeFileSync(metaTmp, JSON.stringify(framesMeta), 'utf8');
    fs.renameSync(binTmp, C.FRAMES_BIN);
    fs.renameSync(metaTmp, C.FRAMES_META);

    const mb = (buf.length / (1024 * 1024)).toFixed(2);
    log(`저장: frames.bin (${mb}MB, ${numFrames}×${numCells} Int16), frames_meta.json`);
    log(`완료. 정의된 셀값 ${defined} / ${numFrames * numCells} (sentinel ${numFrames * numCells - defined})`);
}

module.exports = { main };

if (require.main === module) {
    main().catch(e => {
        console.error('[precompute_tide_field] 치명적 오류:', e);
        process.exit(1);
    });
}
