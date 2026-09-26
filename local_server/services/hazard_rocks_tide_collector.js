/**
 * ============================================================================
 * 파일명: services/hazard_rocks_tide_collector.js
 * 역할: "간출암 잠김경고" 제주 앵커 곡선 배치 수집기
 * ============================================================================
 *
 * [무엇을 하나]
 *   hazard_rocks_tide_common 이 정한 anchors.json(제주 간출암 버킷, 17개)을
 *   순회하며, 오늘~+2일(KST) TideBED 1분 조위곡선을 수집해 디스크에 저장한다.
 *     data/hazard_rocks/curves/{anchorId}_{YYYYMMDD}.json
 *
 * [핵심 정책 — 물빠짐(tide_field_collector)과 동일하게 맞춤]
 *   - collectTideBedPages(lat,lon,reqDate) 재사용, CONCURRENCY=1(순차 수집).
 *     TideBED 키를 물빠짐 수집과 공유하므로 동시 발사를 피해야 한다 — 이
 *     모듈은 scheduler.js 에서 물빠짐 수집이 끝난 "직후" 이어서 호출된다
 *     (같은 23:30 배치 슬롯, 순차 실행 — 동시 호출 금지).
 *   - 롤링 윈도우 + 부족분만 재수집. getGridHash 로 격자 제공 여부 확인,
 *     미제공이면 no_grid 로 기록만 하고 넘어간다(제주는 앵커가 17개뿐이라
 *     물빠짐처럼 인근 격자로 보정(nudge)하는 복잡한 로직은 두지 않는다).
 *
 * [연계]
 *   - services/tide_collector.js → collectTideBedPages, getGridHash
 *   - services/hazard_rocks_tide_common.js → 경로/설정
 *   - services/hazard_rocks_submersion.js → 저장된 곡선을 읽어 η(t) 보간
 *   - scheduler.js → KST 23:30, 물빠짐 수집 직후 1회 호출
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HRC = require('./hazard_rocks_tide_common');
const { findTidePeaks } = require('../peak_finder');
const prevPeaks = require('./hazard_rocks_prev_peaks');

let _tc = null;
function getTideCollector() {
    if (!_tc) _tc = require('./tide_collector');
    return _tc;
}

const CONCURRENCY = 1;
const ANCHOR_GAP_MS = 350;
const FAIL_ABORT_THRESHOLD = 8;

/** KST 기준 오늘~+nDays-1일의 YYYYMMDD 정수 배열 반환. */
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
/** YYYYMMDD 정수 → "YYYY-MM-DD" 문자열 (TideBED 응답의 날짜 필드와 대조용). */
function isoDateOf(yyyymmdd) {
    const s = String(yyyymmdd);
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/**
 * build_hazard_rock_anchors.js 가 만든 제주 앵커 목록(anchors.json)을 로드.
 * @returns {Array|null} 파일이 없거나 비어있으면 null(수집기가 안전하게 skip)
 */
function loadAnchors() {
    if (!fs.existsSync(HRC.HR_ANCHORS_PATH)) return null;
    try {
        const j = JSON.parse(fs.readFileSync(HRC.HR_ANCHORS_PATH, 'utf8'));
        return Array.isArray(j.anchors) ? j.anchors : null;
    } catch (e) {
        console.warn('[hazard_rocks_tide_collector] anchors.json 로드 실패:', e.message);
        return null;
    }
}

/** 앵커+날짜 1건의 곡선 파일 경로. [연계] hazard_rocks_submersion.js 가 이 경로로 읽는다. */
function curvePath(anchorId, yyyymmdd) {
    return path.join(HRC.HR_CURVES_DIR, `${anchorId}_${yyyymmdd}.json`);
}

/** (앵커,날짜) 가 이미 완전 수집됐는지 — 완전 = 5페이지 전부+실패 없음+1300분 이상. */
function isComplete(anchorId, yyyymmdd) {
    const p = curvePath(anchorId, yyyymmdd);
    if (!fs.existsSync(p)) return false;
    try {
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        const lp = Array.isArray(j.loadedPages) ? j.loadedPages.length : 0;
        const fp = Array.isArray(j.failedPages) ? j.failedPages.length : 0;
        return j.status === 'complete' && lp >= 5 && fp === 0 &&
            Array.isArray(j.curve) && j.curve.length >= 1300;
    } catch (e) {
        return false;
    }
}

/** 윈도우 밖(과거 날짜) 곡선 파일 정리 — 물빠짐과 동일 취지(볼륨 누적 방지). */
function purgeStaleCurves(logFn) {
    const lg = typeof logFn === 'function' ? logFn : ((...a) => console.log('[hazard_rocks_tide]', ...a));
    let removed = 0;
    try {
        const dateSet = new Set(windowDatesKST(HRC.WINDOW_DAYS).map(String));
        let files = [];
        try { files = fs.readdirSync(HRC.HR_CURVES_DIR); } catch (e) { return 0; }
        for (const f of files) {
            const m = f.match(/_(\d{8})\.json$/);
            if (!m) continue;
            if (dateSet.has(m[1])) continue;
            try { fs.unlinkSync(path.join(HRC.HR_CURVES_DIR, f)); removed++; } catch (e) { /* noop */ }
        }
        if (removed > 0) lg(`곡선 retention 정리: 윈도우 밖 ${removed}개 삭제`);
    } catch (e) { /* 절대 throw 안 함 */ }
    return removed;
}

/**
 * 앵커 1개 · 날짜 1개의 TideBED 1분 조위곡선을 수집해 파일로 저장.
 * 격자 미제공(no_grid)이면 곧장 기록만 하고 반환 — 물빠짐과 달리 인근 격자
 * 보정(nudge)은 하지 않는다(제주는 앵커가 17개뿐이라 그 정도로 충분히 단순).
 */
async function collectOne(anchor, yyyymmdd, opts = {}) {
    const isoDate = isoDateOf(yyyymmdd);
    const qLat = Math.round(anchor.lat * 100000) / 100000;
    const qLon = Math.round(anchor.lon * 100000) / 100000;
    const { collectTideBedPages, getGridHash } = getTideCollector();

    let hash = null;
    try { hash = await getGridHash(qLat, qLon, yyyymmdd); } catch (e) {
        // ★조용히 넘어가지 않는다 (3-44). 격자 조회가 죽으면 **「그 해역엔 조석 격자가 없다」와
        //   똑같이** 처리된다 — 미제공 해역과 조회 실패가 구분되지 않았다.
        console.warn('[조석] 격자 조회 실패 — 「격자 미제공」과 같이 처리된다:', qLat, qLon, e && e.message);
        hash = null;
    }
    if (!hash) {
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
    writeCurve(anchor, yyyymmdd, {
        status: complete ? 'complete' : 'partial',
        loadedPages, failedPages, count: curve.length,
        peaks: {
            lowTide1: peaks.lowTide1, lowTide2: peaks.lowTide2,
            highTide1: peaks.highTide1, highTide2: peaks.highTide2
        },
        curve
    });
    return { anchorId: anchor.id, date: yyyymmdd, status: complete ? 'complete' : 'partial', count: curve.length };
}

/** 곡선 레코드를 원자적으로 저장(tmp 파일 후 rename) — 부분 쓰기 중 읽기 race 방지. */
function writeCurve(anchor, yyyymmdd, rec) {
    fs.mkdirSync(HRC.HR_CURVES_DIR, { recursive: true });
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

/**
 * 동시성 풀 실행기 — (앵커,날짜) 작업을 concurrency 개씩 처리하며, 연속
 * 하드 실패가 FAIL_ABORT_THRESHOLD 를 넘으면 중단(회로 차단, 다음 배치에 재시도).
 */
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

let _running = false;

/**
 * 롤링 윈도우 수집(중복 실행 락). scheduler.js 가 물빠짐 수집 완료 직후
 * 이어서 호출한다(동시 TideBED 발사 금지 — 물빠짐과 순차 실행).
 * @param {Object} opts - { dates, force, log }
 */
async function collectHazardRockTides(opts = {}) {
    const log = opts.log || ((...a) => console.log('[hazard_rocks_tide_collector]', ...a));
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

/**
 * anchors.json 이 없으면 자동으로 만든다(build_hazard_rock_anchors.js 실행).
 * [왜 필요한가] fly.toml 이 local_server/data 전체를 볼륨 마운트하므로, 커밋해
 *   둔 anchors.json 이 있어도 운영 배포에서는 빈 볼륨에 가려 안 보인다(물빠짐의
 *   anchors.json/grid_meta.json 도 같은 이유로 tide_field_collector.ensureBuilt() 가
 *   기동 시 자동 재생성한다 — 여기서도 그 패턴을 그대로 따른다). BADA 같은 무거운
 *   원본 의존이 없고 client/hazard_rocks.json(Docker 이미지에 포함)만 있으면 되므로
 *   매 수집 시도 때 안전하게 재확인해도 비용이 크지 않다.
 * @returns {Array|null} 생성/로드된 앵커 배열, 실패 시 null
 */
function ensureAnchorsBuilt(log) {
    let anchors = loadAnchors();
    if (anchors && anchors.length > 0) return anchors;
    log('anchors.json 없음/비어있음 — build_hazard_rock_anchors.js 로 자동 생성...');
    try {
        require('../scripts/build_hazard_rock_anchors').main();
    } catch (e) {
        log(`⚠️ 앵커 자동 생성 실패: ${e.message}`);
        return null;
    }
    anchors = loadAnchors();
    return (anchors && anchors.length > 0) ? anchors : null;
}

/** collectHazardRockTides 의 실제 작업 — 완전 수집분을 제외한 (앵커,날짜)만 순차 수집. */
async function _collectInner(opts) {
    const log = opts.log || ((...a) => console.log('[hazard_rocks_tide_collector]', ...a));
    const anchors = ensureAnchorsBuilt(log);
    if (!anchors || anchors.length === 0) {
        log('anchors.json 자동 생성도 실패 — client/hazard_rocks.json 확인 필요. (skip)');
        return { ok: false, reason: 'no_anchors' };
    }
    const dates = opts.dates || windowDatesKST(HRC.WINDOW_DAYS);
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
    const { results, aborted } = await runPool(tasks, CONCURRENCY, async (task) => {
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
    // [어제 극값 요약] 곡선을 지우기 전에 그날 극값만 따로 남긴다 — 서해·남해 수집기와 같은 이유.
    //   [연계] services/hazard_rocks_prev_peaks.js → hazard_rocks_submersion.getTideCurve
    try {
        const r = prevPeaks.captureWindow('hr', dates, anchors.map(a => a.id), curvePath, log);
        log(`극값 요약: ${r.captured}일 저장, 옛 파일 ${r.pruned}개 정리`);
    } catch (e) { log(`⚠️ 극값 요약 실패(수집 결과에는 영향 없음): ${e.message}`); }
    try { purgeStaleCurves(log); } catch (e) { /* 정리 실패는 수집 결과에 영향 없음 */ }
    return { ok: true, collected: done, total: tasks.length, aborted, elapsedSec: +elapsed, byStatus };
}

module.exports = {
    collectHazardRockTides,
    windowDatesKST, isoDateOf, curvePath, isComplete, loadAnchors, collectOne
};
