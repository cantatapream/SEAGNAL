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
 *   - 동시성 풀(CONCURRENCY)로 앵커를 5~10개씩만 흘려보냄 → TideBED 과부하/
 *     UNKNOWN_ERROR 방지. 절대 전 앵커×5페이지 동시발사 금지.
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

// 동시성 풀 크기 (앵커 단위). 5~10 범위 권장. 한 앵커=최대 5페이지이므로
// 5 앵커 = 동시 ~25 요청. TideBED 부하/UNKNOWN_ERROR 방어선.
const CONCURRENCY = 5;
// 앵커 간 소량 슬립(ms) — 풀이 한 앵커 끝낼 때마다 다음 투입 전 약간 간격.
const ANCHOR_GAP_MS = 150;

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
// 단일 (앵커,날짜) 수집 + 저장
// ============================================================================
async function collectOne(anchor, yyyymmdd, opts = {}) {
    const verifyGrid = opts.verifyGrid !== false;
    const isoDate = isoDateOf(yyyymmdd);

    const { collectTideBedPages, getGridHash } = getTideCollector();

    // (선택) 격자 제공 해역 검증 — TideBED 미제공이면 skip 기록 후 종료.
    if (verifyGrid) {
        try {
            const hash = await getGridHash(anchor.lat, anchor.lon, yyyymmdd);
            if (!hash) {
                writeCurve(anchor, yyyymmdd, {
                    status: 'no_grid', curve: [], loadedPages: [], failedPages: [],
                    note: 'TideBED 격자 미제공 해역'
                });
                return { anchorId: anchor.id, date: yyyymmdd, status: 'no_grid' };
            }
        } catch (e) {
            // 격자 조회 실패는 수집 자체를 막지 않음 (계속 시도)
        }
    }

    const { items, loadedPages, failedPages } = await collectTideBedPages(anchor.lat, anchor.lon, String(yyyymmdd));

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
    const results = [];
    async function next() {
        while (idx < tasks.length) {
            const myIdx = idx++;
            try {
                results[myIdx] = await worker(tasks[myIdx]);
            } catch (e) {
                results[myIdx] = { error: e.message, task: tasks[myIdx] };
            }
            if (ANCHOR_GAP_MS > 0) await new Promise(r => setTimeout(r, ANCHOR_GAP_MS));
        }
    }
    const runners = [];
    for (let i = 0; i < Math.min(concurrency, tasks.length); i++) runners.push(next());
    await Promise.all(runners);
    return results;
}

// ============================================================================
// 중복 실행 락 + 부트스트랩 (배포/기동 시 자동 수집)
// ============================================================================
// 부팅 부트스트랩과 scheduler(KST 23:30) 가 겹쳐도 같은 곡선을 두 번 받지
// 않도록 모듈 단위 in-progress 락으로 직렬화한다. 진행 중이면 즉시 반환.
let _running = false;

/**
 * grid_meta/anchors 준비 여부를 확인하고, 비어 있으면 Phase 0 전처리
 * (build_tide_field.main)를 1회 실행해 생성한다.
 *   - 이미 앵커가 있으면 재빌드하지 않음 → 재배포 시 빌드 스킵.
 *   - BADA 실데이터가 없으면 build 가 빈 메타를 남기고 graceful 종료(앵커 0)
 *     → 본 함수는 false 반환(수집 skip). 로컬/데이터 부재 환경에서 안전.
 * @returns {Promise<boolean>} 앵커가 준비됐으면 true
 */
async function ensureBuilt(opts = {}) {
    const log = opts.log || ((...a) => console.log('[tide_field]', ...a));
    const existing = loadAnchors();
    if (existing && existing.length > 0) return true; // 이미 준비됨 → 재빌드 skip

    log('grid_meta/anchors 미준비 — Phase 0 전처리(build_tide_field) 1회 실행...');
    try {
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
 *   - fire-and-forget 로 호출할 것(서버 기동 비차단). 내부 동시성 5앵커 제한.
 */
async function bootstrapTideField(opts = {}) {
    const log = opts.log || ((...a) => console.log('[tide_field]', ...a));
    const built = await ensureBuilt({ log });
    if (!built) return { ok: false, reason: 'not_built' };
    return collectTideField({ ...opts, log });
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
        return { ok: true, collected: 0, skipped: anchorList.length * dates.length };
    }

    const t0 = Date.now();
    const results = await runPool(tasks, CONCURRENCY, (task) =>
        collectOne(task.anchor, task.date, { verifyGrid: opts.verifyGrid })
    );
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    const byStatus = {};
    for (const r of results) {
        const s = (r && r.status) || (r && r.error ? 'error' : 'unknown');
        byStatus[s] = (byStatus[s] || 0) + 1;
    }
    log(`수집 완료: ${tasks.length}건, ${elapsed}s, 상태 ${JSON.stringify(byStatus)}`);
    return { ok: true, collected: tasks.length, elapsedSec: +elapsed, byStatus };
}

module.exports = {
    collectTideField,
    bootstrapTideField,
    ensureBuilt,
    // 테스트/라우트용 보조 export
    windowDatesKST, isoDateOf, curvePath, isComplete, loadAnchors, collectOne
};
