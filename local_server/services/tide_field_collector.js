/**
 * ============================================================================
 * 파일명: services/tide_field_collector.js
 * 역할: "물빠짐 예측" 앵커 곡선 배치 수집기 (Phase 1)
 * ============================================================================
 *
 * [무엇을 하나]
 *   anchors.json 의 앵커들을 순회하며, 오늘~오늘+2일(앞으로 3일, KST) 의
 *   TideBED 1분 조위곡선을 수집하여 디스크에 영속 저장한다.
 *     data/tide_field/curves/{anchorId}_{YYYYMMDD}.json
 *
 * [핵심 정책]
 *   - collectTideBedPages(lat,lon,reqDate) 재사용 (3키 라운드로빈·페이지 재시도 내장).
 *     → 해양종합정보 바텀시트(해점 클릭)가 서버에서 쓰는 것과 동일한 수집 1차 함수.
 *   - [포인트별 순차 수집] CONCURRENCY=1. 바텀시트가 "한 번에 한 점씩" 클릭하는
 *     것과 동일하게 (앵커,날짜)를 하나씩 처리. 절대 여러 점을 동시 발사하지 않는다.
 *     (과거 동시 발사 → apis.data.go.kr 가 HTML 차단 페이지 반환 → 수집 전멸)
 *   - 회로 차단기: 연속 하드 실패 누적 시 중단(점검/차단 추정) → 다음 사이클 재시도.
 *   - 롤링 윈도우 + 부족분만 재호출: 이미 완전 수집된 (앵커,날짜)는 건너뜀.
 *     완전 = 파일 존재 + loadedPages 5개 + failedPages 없음.
 *     최초 실행=자동 3일, 이후 1일/일, 다운타임 self-heal.
 *   - getGridHash 로 앵커가 TideBED 격자 제공 해역인지 검증(미제공이면 skip 기록).
 *
 * [개발 중 주의] 대규모 라이브 수집을 함부로 트리거하지 말 것(쿼터/네트워크).
 *   라이브 배치는 운영에서 scheduler 가 KST 23:30 1회 실행한다.
 *   여기서는 함수 구현 + 소량/드라이런 검증까지만.
 *
 * [연계]
 *   - services/tide_collector.js → collectTideBedPages, getGridHash, getAdjacentDates
 *   - services/tide_field_common.js → 경로/설정
 *   - peak_finder.js → 곡선 요약(피크) 산출
 *   - scheduler.js → KST 23:30 1일 1회 호출
 *   - routes/tide_field.js → 저장된 곡선을 읽어 η(t) 보간
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const C = require('./tide_field_common');
const CFG = C.TIDE_FIELD_CONFIG;
const { findTidePeaks } = require('../peak_finder');

// tide_collector 는 server_config(→dotenv/express) 체인을 끌어온다. 실제 수집
// 시점에만 필요하므로 lazy-require 로 둔다. 덕분에 helper(날짜/경로/완전성)만
// 쓰는 라우트·테스트는 무거운 의존성 없이 이 모듈을 import 할 수 있다.
let _tc = null;
function getTideCollector() {
    if (!_tc) _tc = require('./tide_collector');
    return _tc;
}

// [포인트별 순차 수집] 동시성 = 1. 해양종합정보 바텀시트가 해점을 "한 번에
//   한 점씩" 클릭하는 것과 동일하게, 한 (앵커,날짜)를 끝낸 뒤 다음으로 넘어간다.
//   한 (앵커,날짜)당 내부 5페이지만 병렬(단건 클릭과 동일 수준)이라 게이트웨이
//   버스트가 없다. 과거 CONCURRENCY=5(동시 ~25요청)는 apis.data.go.kr 가
//   HTML 차단 페이지(<!DOCTYPE>)를 반환하게 만들어 수집이 전멸했다.
const CONCURRENCY = 1;
// 각 (앵커,날짜) 사이 슬립(ms) — 연속 클릭처럼 약간의 간격을 둬 버스트 완화.
const ANCHOR_GAP_MS = 350;
// 회로 차단기: 연속 하드 실패(게이트웨이 HTML/무응답)가 이만큼 누적되면 수집을
//   중단한다. KHOA 점검·차단으로 추정 → 다음 사이클(부트스트랩/스케줄러)에
//   부족분만 자동 재시도. 수천 건을 끝까지 때리며 로그 도배하는 것을 방지.
const FAIL_ABORT_THRESHOLD = 8;
// [사용자 우선] 사용자 조석 요청(바텀시트)과 TideBED 키 충돌 회피. 사용자 활동 중
//   에는 각 앵커 수집 직전 키를 양보(대기)한다. 폴링 간격·앵커당 최대 양보시간.
//   (연속 사용자 활동이 길어도 MAX_USER_YIELD_MS 후엔 진행해 수집이 멈추지 않게 함)
const USER_YIELD_POLL_MS = 500;
const MAX_USER_YIELD_MS = 30000;

// ============================================================================
// 날짜 유틸 (KST)
// ============================================================================
/** KST 기준 오늘~+N-1일 의 YYYYMMDD 정수 배열 반환 */
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
function isoDateOf(yyyymmdd) {
    const s = String(yyyymmdd);
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
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
        console.warn('[tide_field_collector] anchors.json 로드 실패:', e.message);
        return null;
    }
}

function curvePath(anchorId, yyyymmdd) {
    return path.join(C.CURVES_DIR, `${anchorId}_${yyyymmdd}.json`);
}

/** 곡선 파일 전체 삭제(재빌드로 앵커 위치가 바뀔 때 옛 곡선 폐기용). 삭제 수 반환. */
function clearCurves() {
    let n = 0;
    try {
        const files = fs.readdirSync(C.CURVES_DIR);
        for (const f of files) {
            if (f.endsWith('.json')) { try { fs.unlinkSync(path.join(C.CURVES_DIR, f)); n++; } catch (e) {} }
        }
    } catch (e) { /* 폴더 없음 */ }
    return n;
}

/**
 * [곡선 retention] 윈도우(오늘~+N-1일, KST) 밖 날짜의 곡선 파일을 삭제한다.
 *   배경: 곡선 파일은 `{anchorId}_{YYYYMMDD}.json` 로 날짜별 생성되는데, 과거 날짜
 *   파일을 지우는 로직이 없어 매일 누적 → fly 영속 볼륨 ENOSPC(디스크 풀) 발생.
 *   시스템(수집/프리컴퓨트/라우트/status)은 windowDatesKST(WINDOW_DAYS) 날짜만 읽으므로,
 *   윈도우 밖 날짜 파일은 死데이터 → 삭제해도 안전(과거 날짜는 절대 재참조 안 됨).
 *   - 삭제 기준은 파일명에 박힌 날짜(YYYYMMDD)다 — mtime 이 아님(윈도우 내 파일이
 *     며칠 전 쓰였어도 오삭제하지 않게 정확히 판정).
 *   - 곡선 파일 형식(`_(\d{8})\.json$`)이 아닌 파일은 건드리지 않는다(보존).
 *   - 삭제는 디스크 공간을 요구하지 않으므로 볼륨이 꽉 차도 동작한다(회복 수단).
 *   - 절대 throw 하지 않는다(파일별 try/catch). 삭제한 파일 수 반환.
 */
function purgeStaleCurves(logFn) {
    const lg = typeof logFn === 'function' ? logFn : ((...a) => console.log('[tide_field]', ...a));
    let removed = 0, kept = 0;
    try {
        const dateSet = new Set(windowDatesKST(CFG.WINDOW_DAYS).map(String));
        let files = [];
        try { files = fs.readdirSync(C.CURVES_DIR); } catch (e) { return 0; } // 폴더 없음
        for (const f of files) {
            const m = f.match(/_(\d{8})\.json$/);
            if (!m) continue;                              // 곡선 파일 형식 아님 → 보존
            if (dateSet.has(m[1])) { kept++; continue; }   // 윈도우 내 → 보존
            try { fs.unlinkSync(path.join(C.CURVES_DIR, f)); removed++; } catch (e) { /* noop */ }
        }
        if (removed > 0) {
            lg(`곡선 retention 정리: 윈도우 밖 ${removed}개 삭제 (보존 ${kept}개, 윈도우=${[...dateSet].join(',')})`);
        }
    } catch (e) { /* 절대 throw 안 함 */ }
    return removed;
}

/**
 * (앵커,날짜) 가 이미 완전 수집되었는지 판정.
 * 완전 = 파일 존재 + loadedPages 5개 + failedPages 없음 + 곡선 길이 충분.
 */
function isComplete(anchorId, yyyymmdd) {
    const p = curvePath(anchorId, yyyymmdd);
    if (!fs.existsSync(p)) return false;
    try {
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        const lp = Array.isArray(j.loadedPages) ? j.loadedPages.length : 0;
        const fp = Array.isArray(j.failedPages) ? j.failedPages.length : 0;
        const ok = j.status === 'complete' && lp >= 5 && fp === 0 &&
            Array.isArray(j.curve) && j.curve.length >= 1300;
        return ok;
    } catch (e) {
        return false;
    }
}

// ============================================================================
// 앵커 격자 보정 (nudge) — no_grid 앵커를 인근 격자 셀로 이동
// ============================================================================
// TideBED 조석격자는 연안·조간대 위주라, 버킷에서 "가장 깊은 드러남 셀"로 뽑힌
// 앵커가 깊은 수로에 놓이면 격자가 없어 no_grid 가 된다. 이때 인근(반경
// NUDGE_RADIUS_KM)의 더 얕은 격자 셀(= 조간대, 격자 존재 확률 높음)을 가까운 순으로
// getGridHash 탐색해 첫 적중 좌표로 "수집 좌표"만 옮긴다. 앵커의 논리적 위치(보간
// 기하)는 그대로 두므로 재빌드가 불필요하고, 2~3km 내 이동이라 조위 위상 차이는 무시
// 가능하다. 물빠짐(노출)은 조간대에서 일어나므로 인근 조간대 곡선이 오히려 대표성이 높다.
const NUDGE_RADIUS_KM = 3;        // 기본 탐색 반경(km) — 남해 등(조차 작아 노출 적음)
const NUDGE_RADIUS_KM_WEST = 5;   // 서해 탐색 반경(km) — 조차 커 갯벌 노출 큼, 더 멀리 탐색
const NUDGE_MAX_PROBES = 8;       // 앵커당 최대 getGridHash 탐색 횟수(API 부담 상한)
const NUDGE_MAX_PROBES_WEST = 16; // 서해(넓은 반경)는 후보가 많아 탐색 횟수 상향
const NUDGE_MAX_RETRIES = 3;      // 격자 못 찾은 앵커 재탐색 상한(일시 오류 자가복구 후 포기)

// 서해(황해) 앵커 판정 — 조차가 커 갯벌 노출이 큰 서해안만 5km 확장 대상.
//   남해 동부(부산·거제 등)는 조차가 작아 노출이 거의 없어 확장 불필요.
//   경계: 남서단(진도·해남) 부근 — 경도 126.5°W 서쪽 + 위도 34.5°N 이북.
function isWestSeaAnchor(lat, lon) {
    return lon < 126.5 && lat > 34.5;
}

// grid_meta 셀 1회 로드(캐시) — 후보 셀 탐색용. [{lon,lat,depth}]
let _gridCells = null;
function loadGridCells() {
    if (_gridCells !== null) return _gridCells;
    try {
        const j = JSON.parse(fs.readFileSync(C.GRID_META_PATH, 'utf8'));
        _gridCells = Array.isArray(j.cells) ? j.cells : [];
    } catch (e) { _gridCells = []; }
    return _gridCells;
}

// 격자 보정 캐시(사이드카) 로드/저장 — build_version 불일치면 폐기(앵커 위치 변동).
//   값: {lon,lat}(이동 좌표=영구) | {noGrid:true,tries:n,radiusKm:r}(미발견, 해당
//   반경에서 n회 재탐색 후 포기 — 반경이 더 커지면 다시 재탐색).
let _probeOverrides = null;
function loadProbeOverrides() {
    if (_probeOverrides !== null) return _probeOverrides;
    try {
        const j = JSON.parse(fs.readFileSync(C.PROBE_OVERRIDE_PATH, 'utf8'));
        _probeOverrides = (j && j.build_version === CFG.BUILD_VERSION && j.overrides && typeof j.overrides === 'object')
            ? j.overrides : {};
    } catch (e) { _probeOverrides = {}; }
    return _probeOverrides;
}
function saveProbeOverrides() {
    if (!_probeOverrides) return;
    try {
        fs.mkdirSync(C.TIDE_FIELD_DIR, { recursive: true });
        const out = { build_version: CFG.BUILD_VERSION, updated_at: new Date().toISOString(), overrides: _probeOverrides };
        const tmp = C.PROBE_OVERRIDE_PATH + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(out), 'utf8');
        fs.renameSync(tmp, C.PROBE_OVERRIDE_PATH);
    } catch (e) { /* 캐시 저장 실패는 치명적 아님 */ }
}
/** 재빌드(앵커 위치 변동) 시 보정 캐시·격자 캐시 폐기. */
function clearProbeOverrides() {
    _probeOverrides = null; _gridCells = null;
    try { if (fs.existsSync(C.PROBE_OVERRIDE_PATH)) fs.unlinkSync(C.PROBE_OVERRIDE_PATH); } catch (e) {}
}

/**
 * no_grid 앵커를 인근 격자 셀로 보정(nudge). 캐시에 결과가 있으면 재탐색 없이 반환.
 *   - 적중 좌표는 영구 캐시. 미발견은 tries 누적하며 NUDGE_MAX_RETRIES 까지 재탐색
 *     (일시 게이트웨이 오류로 인한 오탐을 다음 사이클에 자가복구), 이후 포기(null).
 *   @returns {Promise<{lon,lat}|null>} 이동 좌표(격자 적중) 또는 null(보정 불가)
 */
async function resolveNudge(anchor, yyyymmdd, log) {
    // 지역별 반경: 서해(조차 큼)는 5km·탐색 16회, 그 외는 3km·8회.
    const west = isWestSeaAnchor(anchor.lat, anchor.lon);
    const radiusKm = west ? NUDGE_RADIUS_KM_WEST : NUDGE_RADIUS_KM;
    const maxProbes = west ? NUDGE_MAX_PROBES_WEST : NUDGE_MAX_PROBES;

    const cache = loadProbeOverrides();
    const cur = cache[anchor.id];
    if (cur && cur.lon != null) return { lon: cur.lon, lat: cur.lat };  // 적중(영구)

    // 미발견 캐시 처리: 같은(또는 더 큰) 반경으로 이미 포기했으면 재탐색 안 함.
    //   반경이 커졌으면(서해 3→5km 등) tries 리셋해 새 반경으로 다시 탐색.
    const prevRadius = (cur && cur.noGrid) ? (cur.radiusKm || NUDGE_RADIUS_KM) : 0;
    const tries = (cur && cur.noGrid && prevRadius >= radiusKm) ? (cur.tries || 0) : 0;
    if (prevRadius >= radiusKm && tries >= NUDGE_MAX_RETRIES) return null;  // 포기(반경 불변)

    // 후보: 반경 내 격자 셀, 가까운 순(앵커 자신 좌표는 이미 no_grid 라 제외).
    const cand = [];
    for (const c of loadGridCells()) {
        if (c.lon == null || c.lat == null) continue;
        const dKm = C.haversineKm(anchor.lat, anchor.lon, c.lat, c.lon);
        if (dKm > 0.05 && dKm <= radiusKm) cand.push({ lon: c.lon, lat: c.lat, dKm });
    }
    cand.sort((a, b) => a.dKm - b.dKm);

    const { getGridHash } = getTideCollector();
    let found = null;
    const n = Math.min(maxProbes, cand.length);
    for (let i = 0; i < n; i++) {
        const qLat = Math.round(cand[i].lat * 100000) / 100000;
        const qLon = Math.round(cand[i].lon * 100000) / 100000;
        let hash = null;
        try { hash = await getGridHash(qLat, qLon, yyyymmdd); } catch (e) { hash = null; }
        if (hash) { found = { lon: qLon, lat: qLat, distKm: Math.round(cand[i].dKm * 100) / 100 }; break; }
    }

    if (found) {
        cache[anchor.id] = { lon: found.lon, lat: found.lat };
        if (log) log(`  ↳ 보정: ${anchor.id} no_grid → 인근 격자(${found.distKm}km, R${radiusKm}) 이동 (${found.lat},${found.lon})`);
    } else {
        cache[anchor.id] = { noGrid: true, tries: tries + 1, radiusKm };
        if (log) log(`  ↳ 보정: ${anchor.id} 반경 ${radiusKm}km 내 격자 없음 (시도 ${tries + 1}/${NUDGE_MAX_RETRIES})`);
    }
    saveProbeOverrides();
    return found ? { lon: found.lon, lat: found.lat } : null;
}

// ============================================================================
// 단일 (앵커,날짜) 수집 + 저장
// ============================================================================
async function collectOne(anchor, yyyymmdd, opts = {}) {
    const verifyGrid = opts.verifyGrid !== false;
    const isoDate = isoDateOf(yyyymmdd);

    // [좌표 양자화 — 바텀시트와 동일] 5소수점(≈1m) round. 부동소수점 noise 로
    //   같은 격자에서 다른 lat/lon 이 전송돼 서버 grid hash 캐시가 false-miss
    //   나는 것을 막는다 (ocean_bottom_sheet3.js fetchTideKhoa 와 동일 처리).
    const qLat = Math.round(anchor.lat * 100000) / 100000;
    const qLon = Math.round(anchor.lon * 100000) / 100000;

    const { collectTideBedPages, getGridHash } = getTideCollector();
    const log = opts.log;

    // 수집에 사용할 좌표(기본=앵커). no_grid 보정(nudge) 시 인근 격자 좌표로 교체.
    let cLat = qLat, cLon = qLon, nudged = null;

    // (선택) 격자 제공 해역 검증 — TideBED 미제공이면 인근 격자로 보정, 실패 시 skip.
    if (verifyGrid) {
        let hash = null;
        try { hash = await getGridHash(qLat, qLon, yyyymmdd); }
        catch (e) { hash = null; /* 조회 실패는 막지 않음 — 아래 보정/진행 */ }
        if (!hash) {
            // 앵커 자체는 격자 미제공 → 인근 격자 셀로 보정 시도(캐시·자가복구).
            nudged = (opts.nudge !== false) ? await resolveNudge(anchor, yyyymmdd, log) : null;
            if (!nudged) {
                writeCurve(anchor, yyyymmdd, {
                    status: 'no_grid', curve: [], loadedPages: [], failedPages: [],
                    note: 'TideBED 격자 미제공 해역(인근 보정 실패)'
                });
                return { anchorId: anchor.id, date: yyyymmdd, status: 'no_grid' };
            }
            cLat = Math.round(nudged.lat * 100000) / 100000;
            cLon = Math.round(nudged.lon * 100000) / 100000;
        }
    }

    const { items, loadedPages, failedPages } = await collectTideBedPages(cLat, cLon, String(yyyymmdd));

    // [하드 실패] 한 페이지도 못 받음(게이트웨이 HTML/무응답 추정) → 파일을
    //   쓰지 않고 'failed' 반환. 빈 파일 littering 방지 + 다음 사이클 깨끗한 재시도.
    //   회로 차단기(runPool)가 이 status 를 세어 연속 실패 시 수집을 중단한다.
    if (!loadedPages || loadedPages.length === 0) {
        return { anchorId: anchor.id, date: yyyymmdd, status: 'failed', count: 0 };
    }

    // 해당 날짜 레코드만 추출 + 1분 곡선 [{t:'HH:MM', h(cm)}] 으로 경량화
    const dayItems = (items || []).filter(it => {
        const dt = it.slctdDt || it.obsrvnDt || '';
        return dt.startsWith(isoDate);
    });
    const curve = dayItems.map(it => {
        const dt = it.slctdDt || it.obsrvnDt;
        const hhmm = dt.includes(' ') ? dt.split(' ')[1].slice(0, 5) : dt.slice(11, 16);
        const h = parseFloat(it.slctdHgt != null ? it.slctdHgt : it.obsrvnHgt);
        return { t: hhmm, h: isNaN(h) ? null : h };
    }).filter(p => p.h != null).sort((a, b) => a.t.localeCompare(b.t));

    const peaks = findTidePeaks(items || [], isoDate);

    const complete = loadedPages.length >= 5 && failedPages.length === 0 && curve.length >= 1300;
    const rec = {
        status: complete ? 'complete' : 'partial',
        loadedPages, failedPages,
        count: curve.length,
        // 곡선(1분) + 피크 요약 동시 저장. 라우트는 곡선으로 보간, 피크는 클릭 표시용.
        peaks: {
            lowTide1: peaks.lowTide1, lowTide2: peaks.lowTide2,
            highTide1: peaks.highTide1, highTide2: peaks.highTide2
        },
        // 보정된 경우 실제 수집 좌표 기록(디버그/투명성). 라우트는 앵커 원위치로 보간.
        ...(nudged ? { nudgedTo: { lon: cLon, lat: cLat } } : {}),
        curve
    };
    writeCurve(anchor, yyyymmdd, rec);
    return { anchorId: anchor.id, date: yyyymmdd, status: rec.status, count: curve.length };
}

function writeCurve(anchor, yyyymmdd, rec) {
    fs.mkdirSync(C.CURVES_DIR, { recursive: true });
    const out = {
        anchorId: anchor.id,
        lon: anchor.lon, lat: anchor.lat,
        stationCode: anchor.stationCode || null,
        date: yyyymmdd,
        collected_at: new Date().toISOString(),
        ...rec
    };
    // 원자적 쓰기 (tmp → rename) — 부분 쓰기 중 라우트가 읽는 race 방지.
    const p = curvePath(anchor.id, yyyymmdd);
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(out), 'utf8');
    fs.renameSync(tmp, p);
}

// ============================================================================
// 동시성 풀
// ============================================================================
async function runPool(tasks, concurrency, worker) {
    let idx = 0;
    let consecFail = 0;   // 연속 하드 실패 카운터 (회로 차단기)
    let aborted = false;  // 차단기 발동 시 true → 잔여 태스크 중단
    const results = [];
    async function next() {
        while (idx < tasks.length && !aborted) {
            const myIdx = idx++;
            let r;
            try {
                r = await worker(tasks[myIdx]);
            } catch (e) {
                r = { error: e.message, task: tasks[myIdx], status: 'failed' };
            }
            results[myIdx] = r;
            // 회로 차단기: 연속 하드 실패 누적 시 중단 (게이트웨이 점검/차단 추정).
            //   no_grid(정상적 미제공)·complete·partial 은 실패로 세지 않는다.
            if (r && r.status === 'failed') {
                consecFail++;
                if (consecFail >= FAIL_ABORT_THRESHOLD) aborted = true;
            } else {
                consecFail = 0;
            }
            if (ANCHOR_GAP_MS > 0) await new Promise(res => setTimeout(res, ANCHOR_GAP_MS));
        }
    }
    const runners = [];
    for (let i = 0; i < Math.min(concurrency, tasks.length); i++) runners.push(next());
    await Promise.all(runners);
    return { results, aborted };
}

// ============================================================================
// 중복 실행 락 + 부트스트랩 (배포/기동 시 자동 수집)
// ============================================================================
// 부팅 부트스트랩과 scheduler(KST 23:30) 가 겹쳐도 같은 곡선을 두 번 받지
// 않도록 모듈 단위 in-progress 락으로 직렬화한다. 진행 중이면 즉시 반환.
let _running = false;

/** grid_meta.json 을 읽어 {build_version, cell_deg} 반환(없거나 파싱 실패면 null). */
function readGridMetaInfo() {
    if (!fs.existsSync(C.GRID_META_PATH)) return null;
    try {
        const j = JSON.parse(fs.readFileSync(C.GRID_META_PATH, 'utf8'));
        return { build_version: j.build_version, cell_deg: j.cell_deg, empty: !!(j.meta && j.meta.empty) };
    } catch (e) {
        return null;
    }
}

/**
 * grid_meta/anchors 준비 여부를 확인하고, 미준비/구버전이면 Phase 0 전처리
 * (build_tide_field.main)를 1회 실행해 생성한다.
 *   - 앵커가 있고 build_version·cell_deg 가 현재 CFG 와 일치하면 재빌드 skip.
 *   - build_version 이 다르거나 cell_deg 가 다르면 강제 재빌드. → 운영 볼륨에
 *     남은 옛 100m/5만앵커(구버전) 산출물을 새 버킷 앵커 빌드로 자동 교체한다.
 *   - BADA 실데이터가 없으면 build 가 빈 메타를 남기고 graceful 종료(앵커 0)
 *     → 본 함수는 false 반환(수집 skip). 로컬/데이터 부재 환경에서 안전.
 * @returns {Promise<boolean>} 앵커가 준비됐으면 true
 */
async function ensureBuilt(opts = {}) {
    const log = opts.log || ((...a) => console.log('[tide_field]', ...a));
    const existing = loadAnchors();
    const info = readGridMetaInfo();
    const versionOk = info && info.build_version === CFG.BUILD_VERSION && info.cell_deg === CFG.CELL_DEG;

    if (existing && existing.length > 0 && versionOk) {
        return true; // 이미 준비됨 + 버전·해상도 일치 → 재빌드 skip
    }
    if (existing && existing.length > 0 && !versionOk) {
        log(`기존 산출물이 구버전(build_version=${info && info.build_version}, cell_deg=${info && info.cell_deg}) — ` +
            `현재(v=${CFG.BUILD_VERSION}, cell_deg=${CFG.CELL_DEG})로 강제 재빌드.`);
    } else {
        log('grid_meta/anchors 미준비 — Phase 0 전처리(build_tide_field) 1회 실행...');
    }

    try {
        // [중요] 재빌드는 앵커 대표 셀 위치를 바꿀 수 있다. 그러면 같은 anchorId 라도
        //   날짜마다 다른 위치의 곡선이 섞여 자정에 조위가 불연속(급변)이 된다.
        //   → 재빌드 전 옛 곡선을 모두 폐기하고 새 위치에서 전부 새로 수집한다.
        const cleared = clearCurves();
        clearProbeOverrides();  // 앵커 위치가 바뀌면 옛 격자 보정 좌표도 무효
        if (cleared) log(`재빌드 — 옛 곡선 ${cleared}개 폐기(앵커 위치 변동) → 전부 새로 수집`);
        const builder = require('../scripts/build_tide_field');
        await builder.main({ log });
    } catch (e) {
        log(`⚠️ 전처리 실행 실패: ${e && e.message}`);
        return false;
    }
    const after = loadAnchors();
    const ok = !!(after && after.length > 0);
    if (!ok) log('전처리 후에도 앵커 없음 (BADA 수심 데이터 부재 가능) — 수집 skip');
    return ok;
}

/**
 * 배포/서버 기동 시 1회 자동 실행: 전처리 보장 → 롤링 윈도우 수집.
 *   - 곡선 캐시가 이미 있으면 collectTideField 가 부족분만 받으므로 재배포 시
 *     사실상 no-op (캐시는 Fly 영속 볼륨에 저장되어 재배포 후에도 유지됨).
 *   - fire-and-forget 로 호출할 것(서버 기동 비차단). 포인트별 순차 수집(동시성 1).
 */
// ============================================================================
// [킬스위치] 물빠짐 수집 전면 중단 (현재 해제됨)
// ============================================================================
//   과거 100m 앵커 폭발(166k 작업) 대응으로 수집을 전면 중단했었다. 이제 앵커가
//   버킷 기반(연결성 그래프와 무관, 수백 개로 고정)으로 재설계되어 폭발이 구조적으로
//   불가능하므로 수집을 재개한다(false). ensureBuilt 가 build_version/cell_deg 로
//   옛 100m/5만앵커 산출물을 자동 재빌드 교체한 뒤 수집한다.
const COLLECT_DISABLED = false;

async function bootstrapTideField(opts = {}) {
    const log = opts.log || ((...a) => console.log('[tide_field]', ...a));
    if (COLLECT_DISABLED) {
        log('물빠짐 수집 비활성화(킬스위치) — 부트스트랩 skip');
        return { ok: true, skipped: 'disabled' };
    }
    const built = await ensureBuilt({ log });
    if (!built) return { ok: false, reason: 'not_built' };
    return collectTideField({ ...opts, log });
}

// ============================================================================
// 프리컴퓨트 spawn (수집 직후 자식 프로세스로 1회)
// ============================================================================
/**
 * scripts/precompute_tide_field.js 를 자식 프로세스로 fire-and-forget 실행.
 *   - 수집이 정상 완료된 직후 호출되어, 전 프레임×전 셀의 물깊이를 미리 계산해
 *     frames.bin/frames_meta.json 으로 저장한다(라우트가 η 재계산 없이 사용).
 *   - 자식 프로세스라 메인 이벤트 루프(수집/서버)를 막지 않는다(핵심).
 *   - 예외 안전: spawn 실패해도 수집 결과·서버에 영향 없음(라우트는 폴백).
 */
function spawnPrecompute(log) {
    const _log = log || ((...a) => console.log('[tide_field_collector]', ...a));
    if (COLLECT_DISABLED) return; // 킬스위치면 프리컴퓨트도 skip
    try {
        const script = path.join(__dirname, '..', 'scripts', 'precompute_tide_field.js');
        const cwd = path.join(__dirname, '..'); // local_server 루트
        const child = spawn(process.execPath, [script], {
            cwd,
            stdio: ['ignore', 'inherit', 'inherit'],
            env: process.env
        });
        child.on('error', (e) => _log(`⚠️ 프리컴퓨트 spawn 오류: ${e && e.message}`));
        child.on('exit', (code) => _log(`프리컴퓨트 종료(code=${code})`));
        _log('프리컴퓨트 자식 프로세스 시작(fire-and-forget)');
    } catch (e) {
        _log(`⚠️ 프리컴퓨트 spawn 실패(무시): ${e && e.message}`);
    }
}

// ============================================================================
// 메인: 롤링 윈도우 수집 (중복 실행 락 래퍼)
// ============================================================================
/**
 * @param {Object} opts
 *   - limitAnchors: 수집할 앵커 수 상한 (개발/드라이런용)
 *   - dates: 강제 날짜 배열 (기본: 오늘~+2일 KST)
 *   - force: true 면 완전 수집된 것도 다시 수집
 *   - verifyGrid: 격자 검증 여부 (기본 true)
 *   - log: 로거 (기본 console.log)
 */
async function collectTideField(opts = {}) {
    const log = opts.log || ((...a) => console.log('[tide_field_collector]', ...a));
    if (COLLECT_DISABLED) {
        log('물빠짐 수집 비활성화(킬스위치) — skip');
        return { ok: true, skipped: 'disabled' };
    }
    if (_running) {
        log('이미 수집이 진행 중 — 중복 실행 skip');
        return { ok: true, skipped: 'already_running' };
    }
    _running = true;
    try {
        return await _collectTideFieldInner(opts);
    } finally {
        _running = false;
    }
}

async function _collectTideFieldInner(opts = {}) {
    const log = opts.log || ((...a) => console.log('[tide_field_collector]', ...a));
    const anchors = loadAnchors();
    if (!anchors || anchors.length === 0) {
        log('anchors.json 없음/비어있음 — 먼저 scripts/build_tide_field.js 를 실행하세요. (skip)');
        return { ok: false, reason: 'no_anchors' };
    }

    const dates = opts.dates || windowDatesKST(CFG.WINDOW_DAYS);
    let anchorList = anchors;
    if (opts.limitAnchors && opts.limitAnchors < anchors.length) {
        anchorList = anchors.slice(0, opts.limitAnchors);
    }

    // 부족분만 추리기 (force 가 아니면)
    const tasks = [];
    for (const a of anchorList) {
        for (const d of dates) {
            if (opts.force || !isComplete(a.id, d)) tasks.push({ anchor: a, date: d });
        }
    }
    log(`수집 대상 (앵커,날짜): ${tasks.length}건 (앵커 ${anchorList.length} × 날짜 ${dates.length}, 완전 수집분 제외)`);

    if (tasks.length === 0) {
        // 이미 전부 완전 수집됨 — 그래도 프리컴퓨트는 보장(없거나 stale 일 수 있음).
        //   precompute 스크립트가 자체 신선도 체크로 불필요 시 즉시 skip 한다.
        spawnPrecompute(log);
        return { ok: true, collected: 0, skipped: anchorList.length * dates.length };
    }

    const t0 = Date.now();
    const total = tasks.length;
    let progress = 0;
    const tcMod = getTideCollector();
    const { results, aborted } = await runPool(tasks, CONCURRENCY, async (task) => {
        // [사용자 우선] 최근 사용자 조석 요청이 있으면 TideBED 키를 양보 — 사용자
        //   활동이 끝날 때까지(USER_ACTIVE_WINDOW_MS 경과) 또는 최대 대기시간까지
        //   이 앵커 수집을 미룬다. CONCURRENCY=1 이라 앵커 사이에서 안전하게 멈춤.
        if (tcMod && typeof tcMod.isUserActive === 'function') {
            let yielded = 0, didYield = false;
            while (tcMod.isUserActive() && yielded < MAX_USER_YIELD_MS) {
                didYield = true;
                await new Promise(res => setTimeout(res, USER_YIELD_POLL_MS));
                yielded += USER_YIELD_POLL_MS;
            }
            if (didYield) log(`  ⏸ 사용자 요청 우선 — 키 양보 ${(yielded / 1000).toFixed(1)}s 후 진행`);
        }
        progress++;
        log(`▶ [${progress}/${total}] 앵커 ${task.anchor.id} (${task.anchor.lat.toFixed(3)},${task.anchor.lon.toFixed(3)}) 날짜 ${task.date} 수집 중...`);
        const r = await collectOne(task.anchor, task.date, { verifyGrid: opts.verifyGrid, nudge: opts.nudge, log });
        log(`  ↳ [${progress}/${total}] → ${r.status}${r.count != null ? ` (${r.count}분)` : ''}`);
        return r;
    });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    const byStatus = {};
    let done = 0;
    for (const r of results) {
        if (!r) continue;
        done++;
        const s = r.status || (r.error ? 'error' : 'unknown');
        byStatus[s] = (byStatus[s] || 0) + 1;
    }
    if (aborted) {
        log(`⛔ 회로 차단기 발동 — 연속 ${FAIL_ABORT_THRESHOLD}회 하드 실패(게이트웨이 점검/차단 추정). ` +
            `수집 중단(${done}/${tasks.length} 처리). 다음 사이클에 부족분만 자동 재시도.`);
    }
    log(`수집 종료: 처리 ${done}/${tasks.length}건, ${elapsed}s, 상태 ${JSON.stringify(byStatus)}`);
    // 수집 직후 프리컴퓨트(자식 프로세스, fire-and-forget). 회로 차단(aborted)으로
    //   부분 수집됐어도 최신 곡선으로 프레임을 갱신해 두는 편이 낫다(폴백 안전).
    spawnPrecompute(log);
    // [retention] 수집 직후 윈도우 밖(과거 날짜) 곡선 파일 정리 → 볼륨 누적/ENOSPC 방지.
    try { purgeStaleCurves(log); } catch (e) { /* 정리 실패는 수집 결과에 영향 없음 */ }
    return { ok: true, collected: done, total: tasks.length, aborted, elapsedSec: +elapsed, byStatus };
}

/**
 * 수집 진행 현황 (경량 — readdir 1회). 라우트 /api/tide-field/status 용.
 *   collected = 현재 윈도우(오늘~+2일) 날짜의 곡선 파일 수(완전/부분/no_grid 포함 근사).
 *   total = 앵커수 × 날짜수. running = 수집 진행 중 여부.
 */
function getStatus() {
    const anchors = loadAnchors() || [];
    const dates = windowDatesKST(CFG.WINDOW_DAYS);
    const total = anchors.length * dates.length;
    const dateSet = new Set(dates.map(String));
    let files = [];
    try { files = fs.readdirSync(C.CURVES_DIR); } catch (e) { /* 폴더 없음 */ }
    const collected = files.filter(f => {
        const m = f.match(/_(\d{8})\.json$/);
        return m && dateSet.has(m[1]);
    }).length;
    return {
        running: _running,
        anchors: anchors.length,
        windowDays: dates.length,
        total,
        collected: Math.min(collected, total),
        remaining: Math.max(0, total - collected),
        percent: total > 0 ? Math.round((Math.min(collected, total) / total) * 1000) / 10 : 0
    };
}

// 앵커 대표 상태 우선순위(클수록 좋음) + 윈도우 날짜의 곡선 파일에서 대표 상태 산출.
const STATUS_RANK = { missing: 0, no_grid: 1, partial: 2, complete: 3 };
function anchorBestStatus(anchorId, dates) {
    let best = 'missing';
    for (const ymd of dates) {
        const p = curvePath(anchorId, ymd);
        if (!fs.existsSync(p)) continue;
        let st = 'missing';
        try {
            const j = JSON.parse(fs.readFileSync(p, 'utf8'));
            st = j && typeof j.status === 'string' ? j.status : 'missing';
        } catch (e) { st = 'missing'; }
        if (!(st in STATUS_RANK)) st = 'missing';  // 알 수 없는 상태(예: failed)는 missing
        if (STATUS_RANK[st] > STATUS_RANK[best]) best = st;
    }
    return best;
}

/**
 * 앵커 데이터 확보 현황 — 각 앵커의 "실제 수집 좌표"(보정 시 이동된 좌표) + 대표 상태.
 *   15회 제스처 오버레이가 "몇 개 해점의 데이터를 실제로 확보했는지" 증명하는 용도.
 *   - 보정(nudge)된 앵커는 lon/lat 이 이동된 수집 좌표(origLon/origLat = 원위치).
 *   - secured = 데이터 확보(complete|partial) 앵커 수. 라우트 /api/tide-field/anchors 용.
 *   반환: { count, secured, nudged, anchors:[{id,lon,lat,origLon,origLat,nudged,status}] }
 */
function getAnchorReport() {
    const anchors = loadAnchors() || [];
    const dates = windowDatesKST(CFG.WINDOW_DAYS);
    const overrides = loadProbeOverrides();
    let secured = 0, nudgedCount = 0;
    const out = [];
    for (const a of anchors) {
        const status = anchorBestStatus(a.id, dates);
        const ov = overrides[a.id];
        const nudged = !!(ov && ov.lon != null);
        if (status === 'complete' || status === 'partial') secured++;
        if (nudged) nudgedCount++;
        out.push({
            id: a.id,
            lon: nudged ? ov.lon : a.lon,   // 실제 수집 좌표(보정 반영)
            lat: nudged ? ov.lat : a.lat,
            origLon: a.lon, origLat: a.lat, // 논리 위치(보간 기준)
            nudged, status
        });
    }
    return { count: anchors.length, secured, nudged: nudgedCount, anchors: out };
}

/**
 * no_grid 진단 — 어느 앵커가 TideBED 격자 미제공(no_grid) 구역인지 좌표와 함께 보고.
 *   앵커별 대표 상태(complete>partial>no_grid>missing)를 집계. 라우트 /api/tide-field/nogrid 용.
 *   반환: { anchors, windowDays, summary, no_grid_count, no_grid:[{id,lon,lat}], generated_at }
 */
function getNoGridReport() {
    const anchors = loadAnchors() || [];
    const dates = windowDatesKST(CFG.WINDOW_DAYS);
    const summary = { complete: 0, partial: 0, no_grid: 0, failed: 0, missing: 0 };
    const noGrid = [];
    for (const a of anchors) {
        const best = anchorBestStatus(a.id, dates);
        summary[best] = (summary[best] || 0) + 1;
        if (best === 'no_grid') noGrid.push({ id: a.id, lon: a.lon, lat: a.lat });
    }
    return {
        anchors: anchors.length,
        windowDays: dates.length,
        summary,
        no_grid_count: noGrid.length,
        no_grid: noGrid,
        generated_at: new Date().toISOString()
    };
}

module.exports = {
    collectTideField,
    bootstrapTideField,
    ensureBuilt,
    spawnPrecompute,
    getStatus,
    getNoGridReport,
    getAnchorReport,
    purgeStaleCurves,
    // 테스트/라우트용 보조 export
    windowDatesKST, isoDateOf, curvePath, isComplete, loadAnchors, collectOne
};
