/**
 * ============================================================================
 * 파일명: services/jeju_isolation_tide_collector.js
 * 역할: "노출암 고립판정" 제주 촘촘 격자 앵커 1분 조위곡선 배치 수집기
 * ============================================================================
 *
 * [무엇을 하나] scripts/build_jeju_bathy_grid.js 가 만든 제주 BADA 수심 격자
 *   앵커(anchors_jeju.json, 버킷 0.1°≈10km 단위 — 서해·남해 물빠짐과 동일 밀도)를
 *   순회하며, 오늘~+2일(KST) TideBED 1분 조위곡선을 수집해 저장한다.
 *     data/tide_field/curves_jeju/{anchorId}_{YYYYMMDD}.json
 *
 * [기존 "간출암 잠김경고" 제주 17개 앵커와 다른 것] hazard_rocks_tide_collector.js는
 *   간출암(k=1) 잠김경고용 앵커 17개만 수집한다. 이 모듈은 노출암(k=0) 고립판정
 *   플러드필이 필요로 하는 "촘촘한 수심 격자"(anchors_jeju.json, 서해·남해 물빠짐과
 *   동일한 버킷 밀도)의 조위곡선을 별도로 수집한다 — 서로 다른 용도, 다른 파일.
 *
 * [핵심 정책 — 물빠짐/간출암과 동일하게 맞춤]
 *   - collectTideBedPages 재사용, CONCURRENCY=1(순차 수집, TideBED 키 공유).
 *   - 롤링 윈도우 + 부족분만 재수집.
 *   - 앵커 개수가 적어(수십 개 규모) 물빠짐의 인근 격자 보정(nudge)은 두지 않는다
 *     (hazard_rocks_tide_collector.js 와 동일한 단순화 판단).
 *
 * [격자 자체가 없으면] anchors_jeju.json/grid_meta_jeju.json 은 BADA 원본 수심
 *   파일(data/bathymetry/, 운영 볼륨에만 존재)이 있어야 만들어진다. 로컬처럼
 *   BADA 가 없는 환경에서는 ensureGridBuilt() 가 빈 결과를 남기고 수집을 안전하게
 *   skip한다(크래시 아님) — tide_field_collector.ensureBuilt() 와 동일한 패턴.
 *
 * [연계]
 *   - scripts/build_jeju_bathy_grid.js → anchors_jeju.json/grid_meta_jeju.json 생성
 *   - services/tide_collector.js → collectTideBedPages, getGridHash
 *   - scheduler.js → KST 23:30, 제주 간출암 앵커 수집 직후 이어서(순차) 호출
 *   - server.js    → 서버 기동 시 제주 간출암 보충 뒤 부족분만 보충(2026-10-18)
 *   - services/tide_curve_edges.js → 새벽·밤 가장자리 메우기·완전 판정(2026-10-18)
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const C = require('./tide_field_common');
const { findTidePeaks } = require('../peak_finder');
const Edges = require('./tide_curve_edges');

let _tc = null;
function getTideCollector() {
    if (!_tc) _tc = require('./tide_collector');
    return _tc;
}

const CURVES_DIR_JEJU = path.join(C.TIDE_FIELD_DIR, 'curves_jeju');
const WINDOW_DAYS = C.TIDE_FIELD_CONFIG.WINDOW_DAYS;

const CONCURRENCY = 1;
const ANCHOR_GAP_MS = 350;
const FAIL_ABORT_THRESHOLD = 8;
// [사용자 우선 — 2026-10-18] 바텀시트 사용자 조석 요청이 최근(10초) 있었으면 앵커 사이에서 키를 양보한다.
//   tide_field_collector 와 같은 규칙·같은 값(0.5초마다 확인, 앵커당 최대 30초). 예전엔 이 수집기에만
//   양보가 없었다 — 23:30 에만 돌 땐 드물었지만, 서버 기동 때도 부족분을 채우게 되면서 넣었다.
const USER_YIELD_POLL_MS = 500;
const MAX_USER_YIELD_MS = 30000;

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

/** anchors_jeju.json 로드. 파일 없거나 비어있으면 null(수집기가 안전하게 skip). */
function loadAnchors() {
    const { ANCHORS_JEJU_PATH } = require('../scripts/build_jeju_bathy_grid');
    if (!fs.existsSync(ANCHORS_JEJU_PATH)) return null;
    try {
        const j = JSON.parse(fs.readFileSync(ANCHORS_JEJU_PATH, 'utf8'));
        return Array.isArray(j.anchors) ? j.anchors : null;
    } catch (e) {
        console.warn('[jeju_isolation_tide_collector] anchors_jeju.json 로드 실패:', e.message);
        return null;
    }
}

function curvePath(anchorId, yyyymmdd) {
    return path.join(CURVES_DIR_JEJU, `${anchorId}_${yyyymmdd}.json`);
}

/** (앵커,날짜) 완전 수집 여부 — 5페이지·실패 0·1300분 이상 + 새벽·밤 빈칸 15분 이하(2026-10-18,
 *  tide_curve_edges.isFullDay — hazard_rocks_tide_collector.isComplete 와 같은 기준). */
function isComplete(anchorId, yyyymmdd) {
    const j = Edges.readJson(curvePath(anchorId, yyyymmdd));
    return !!j && j.status === 'complete' && Edges.isFullDay(j);
}

/** 윈도우 밖(과거 날짜) 곡선 파일 정리 — 물빠짐/간출암과 동일 취지(볼륨 누적 방지). */
function purgeStaleCurves(logFn) {
    const lg = typeof logFn === 'function' ? logFn : ((...a) => console.log('[jeju_isolation_tide]', ...a));
    let removed = 0;
    try {
        const dateSet = new Set(windowDatesKST(WINDOW_DAYS).map(String));
        let files = [];
        try { files = fs.readdirSync(CURVES_DIR_JEJU); } catch (e) { return 0; }
        for (const f of files) {
            const m = f.match(/_(\d{8})\.json$/);
            if (!m) continue;
            if (dateSet.has(m[1])) continue;
            try { fs.unlinkSync(path.join(CURVES_DIR_JEJU, f)); removed++; } catch (e) { /* noop */ }
        }
        if (removed > 0) lg(`곡선 retention 정리: 윈도우 밖 ${removed}개 삭제`);
    } catch (e) { /* 절대 throw 안 함 */ }
    return removed;
}

async function collectOne(anchor, yyyymmdd, opts = {}) {
    const isoDate = isoDateOf(yyyymmdd);
    const qLat = Math.round(anchor.lat * 100000) / 100000;
    const qLon = Math.round(anchor.lon * 100000) / 100000;
    const { collectTideBedPages, lookupGridHash } = getTideCollector();
    // [새벽 빈칸 메우기 — 2026-10-18] hazard_rocks_tide_collector.collectOne 과 같은 방식(services/tide_curve_edges.js).
    const edgeIo = {
        readNeighbor: (ymd) => Edges.readJson(curvePath(anchor.id, ymd)),
        // 못 받았으면 null(빈 배열과 구분 — fillEdges 가 장애로 센다)
        fetchPage: (reqYmd, page) => collectTideBedPages(qLat, qLon, String(reqYmd), [page]).then(r => (r && r.loadedPages && r.loadedPages.length) ? r.items : null)
    };
    const reuse = opts.force ? null : Edges.reusableOwnDay(Edges.readJson(curvePath(anchor.id, yyyymmdd)));
    if (reuse) {
        const filled = await Edges.fillEdges(reuse.curve, yyyymmdd, edgeIo);
        const rec = { ...reuse, curve: filled.curve, count: filled.curve.length };
        const complete = Edges.isFullDay(rec);
        writeCurve(anchor, yyyymmdd, { ...rec, status: complete ? 'complete' : 'partial' });
        return { anchorId: anchor.id, date: yyyymmdd, status: complete ? 'complete' : 'partial', count: rec.count, edgeOnly: true, edgeFailed: !complete && filled.fetchFailed > 0 };
    }

    // [격자 조회 실패 ≠ 격자 미제공 — 2026-10-18 독립 검토 C-1] 일시 장애면 파일을 건드리지 않고 'failed'
    //   (연속 실패 차단기가 센다). 예전엔 둘이 같아서 곡선이 있던 파일을 no_grid 빈 파일로 덮었다.
    let g = { hash: null, error: true };
    try { g = await lookupGridHash(qLat, qLon, yyyymmdd); } catch (e) {
        console.warn('[조석] 격자 조회 실패 — 파일을 그대로 두고 다음에 다시:', qLat, qLon, e && e.message);
    }
    if (g.error) return { anchorId: anchor.id, date: yyyymmdd, status: 'failed', reason: 'grid_lookup_failed' };
    const hash = g.hash;
    if (!hash) {
        // 격자 미제공이라는 답이 왔어도, 이미 곡선이 있는 파일은 빈 파일로 덮지 않는다(같은 좌표가 어제까지 격자가 있었다).
        const prevRec = Edges.readJson(curvePath(anchor.id, yyyymmdd));
        if (prevRec && Array.isArray(prevRec.curve) && prevRec.curve.length) {
            return { anchorId: anchor.id, date: yyyymmdd, status: 'no_grid', kept: true };
        }
        writeCurve(anchor, yyyymmdd, {
            status: 'no_grid', curve: [], loadedPages: [], failedPages: [],
            note: 'TideBED 격자 미제공 해역'
        });
        return { anchorId: anchor.id, date: yyyymmdd, status: 'no_grid' };
    }

    const { items, loadedPages, failedPages } = await collectTideBedPages(qLat, qLon, String(yyyymmdd));
    if (!loadedPages || loadedPages.length === 0) {
        return { anchorId: anchor.id, date: yyyymmdd, status: 'failed', count: 0 };
    }

    // 그날 몫은 곡선, 옆날 몫(조시차만큼 넘친 꼬리)은 spill — 옆날 파일이 새벽·밤 빈칸을 메우는 데 쓴다.
    const split = Edges.splitByDay(items, yyyymmdd);
    const filled = await Edges.fillEdges(split.curve, yyyymmdd, edgeIo);
    const curve = filled.curve;
    const edgeFailed = filled.fetchFailed > 0;

    const peaks = findTidePeaks(items || [], isoDate);
    const complete = Edges.isFullDay({ loadedPages, failedPages, curve });
    writeCurve(anchor, yyyymmdd, {
        status: complete ? 'complete' : 'partial',
        loadedPages, failedPages, count: curve.length,
        peaks: {
            lowTide1: peaks.lowTide1, lowTide2: peaks.lowTide2,
            highTide1: peaks.highTide1, highTide2: peaks.highTide2
        },
        spill: split.spill,
        curve
    });
    return { anchorId: anchor.id, date: yyyymmdd, status: complete ? 'complete' : 'partial', count: curve.length, edgeFailed: !complete && edgeFailed };
}

function writeCurve(anchor, yyyymmdd, rec) {
    fs.mkdirSync(CURVES_DIR_JEJU, { recursive: true });
    const out = {
        anchorId: anchor.id, lon: anchor.lon, lat: anchor.lat,
        date: yyyymmdd, collected_at: new Date().toISOString(),
        ...rec
    };
    const p = curvePath(anchor.id, yyyymmdd);
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(out), 'utf8');
    fs.renameSync(tmp, p);
}

async function runPool(tasks, concurrency, worker) {
    let idx = 0, consecFail = 0, aborted = false;
    const results = [];
    async function next() {
        while (idx < tasks.length && !aborted) {
            const myIdx = idx++;
            let r;
            try { r = await worker(tasks[myIdx]); }
            catch (e) { r = { error: e.message, status: 'failed' }; }
            results[myIdx] = r;
            // 가장자리 페이지를 못 받은 것도 장애로 센다(2026-10-18 독립 검토 B-D1 — 예전엔 'partial' 로 돌아와
            //   차단기를 우회해, 장애 중 기동하면 전수를 끝까지 두드렸다).
            if (r && (r.status === 'failed' || r.edgeFailed)) {
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

/**
 * anchors_jeju.json/grid_meta_jeju.json 이 없으면 자동으로 만든다
 * (scripts/build_jeju_bathy_grid.js 실행) — tide_field_collector.ensureBuilt() 와
 * 동일 패턴. BADA 원본(data/bathymetry/)이 있는 운영 볼륨에서만 실제 격자가
 * 만들어지고, 없는 환경(로컬 등)에서는 빈 결과로 graceful 종료한다.
 * @returns {Array|null} 준비된 앵커 배열, 실패/데이터없음이면 null
 */
async function ensureGridBuilt(log) {
    let anchors = loadAnchors();
    if (anchors && anchors.length > 0) return anchors;
    log('anchors_jeju.json 없음/비어있음 — build_jeju_bathy_grid.js 로 격자 생성 시도...');
    try {
        await require('../scripts/build_jeju_bathy_grid').main();
    } catch (e) {
        log(`⚠️ 제주 격자 생성 실패: ${e.message}`);
        return null;
    }
    anchors = loadAnchors();
    if (!anchors || anchors.length === 0) {
        log('제주 격자 생성 후에도 앵커 없음(BADA 수심 데이터 부재 가능) — 수집 skip');
        return null;
    }
    return anchors;
}

let _running = false;

/**
 * 롤링 윈도우 수집(중복 실행 락). scheduler.js 가 제주 간출암(17개) 수집 완료
 * 직후 이어서 호출한다(동시 TideBED 발사 금지 — 순차 실행).
 * @param {Object} opts - { dates, force, log }
 */
async function collectJejuIsolationTides(opts = {}) {
    const log = opts.log || ((...a) => console.log('[jeju_isolation_tide_collector]', ...a));
    if (_running) {
        log('이미 수집이 진행 중 — 중복 실행 skip');
        return { ok: true, skipped: 'already_running' };
    }
    _running = true;
    try {
        return await _collectInner(opts);
    } finally {
        _running = false;
    }
}

async function _collectInner(opts) {
    const log = opts.log || ((...a) => console.log('[jeju_isolation_tide_collector]', ...a));
    const anchors = await ensureGridBuilt(log);
    if (!anchors || anchors.length === 0) {
        return { ok: false, reason: 'no_anchors' };
    }
    const dates = opts.dates || windowDatesKST(WINDOW_DAYS);
    const tasks = [];
    for (const a of anchors) {
        for (const d of dates) {
            if (opts.force || !isComplete(a.id, d)) tasks.push({ anchor: a, date: d });
        }
    }
    log(`수집 대상 (앵커,날짜): ${tasks.length}건 (앵커 ${anchors.length} × 날짜 ${dates.length}, 완전 수집분 제외)`);
    if (tasks.length === 0) return { ok: true, collected: 0, skipped: anchors.length * dates.length };

    const t0 = Date.now();
    let progress = 0;
    const tcMod = getTideCollector();
    const { results, aborted } = await runPool(tasks, CONCURRENCY, async (task) => {
        if (tcMod && typeof tcMod.isUserActive === 'function') {
            let yielded = 0;
            while (tcMod.isUserActive() && yielded < MAX_USER_YIELD_MS) {
                await new Promise(res => setTimeout(res, USER_YIELD_POLL_MS));
                yielded += USER_YIELD_POLL_MS;
            }
            if (yielded) log(`  ⏸ 사용자 요청 우선 — 키 양보 ${(yielded / 1000).toFixed(1)}s 후 진행`);
        }
        progress++;
        log(`▶ [${progress}/${tasks.length}] 앵커 ${task.anchor.id} (${task.anchor.lat.toFixed(3)},${task.anchor.lon.toFixed(3)}) 날짜 ${task.date} 수집 중...`);
        const r = await collectOne(task.anchor, task.date, { log });
        log(`  ↳ [${progress}/${tasks.length}] → ${r.status}${r.count != null ? ` (${r.count}분)` : ''}`);
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
        log(`⛔ 회로 차단기 발동 — 연속 ${FAIL_ABORT_THRESHOLD}회 하드 실패. 수집 중단(${done}/${tasks.length} 처리).`);
    }
    log(`수집 종료: 처리 ${done}/${tasks.length}건, ${elapsed}s, 상태 ${JSON.stringify(byStatus)}`);
    try { purgeStaleCurves(log); } catch (e) { /* 정리 실패는 수집 결과에 영향 없음 */ }
    return { ok: true, collected: done, total: tasks.length, aborted, elapsedSec: +elapsed, byStatus };
}

module.exports = {
    collectJejuIsolationTides,
    windowDatesKST, isoDateOf, curvePath, isComplete, loadAnchors, collectOne, CURVES_DIR_JEJU
};
