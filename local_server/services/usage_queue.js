/**
 * ============================================================================
 * 파일명: services/usage_queue.js
 * 역할: 사용량 통계(Usage Analytics) 비동기 큐
 *       (메모리 카운터 + 5초 주기 디스크 flush)
 * ============================================================================
 *
 * [무엇을 하는 모듈인가요?]
 *   - services/visit_queue.js 와 동일한 "메모지 + 묶음 기록" 패턴을 사용한다.
 *   - 클라이언트가 `POST /api/usage` 로 기능 사용을 보낼 때마다 메모리 카운터를
 *     +1 하고(요청은 즉시 200 응답), 5초마다 한 번씩 디스크(usage_stats.json)에
 *     묶어서 기록한다. 서버 종료 시 flushSync 로 마지막 상태를 동기 저장한다.
 *
 * [데이터 모델 — ★소속 소급 재분류를 위해 기기 단위 저장★]
 *   usageData = {
 *     "YYYY-MM-DD": {            // KST 날짜 (수신 시각으로 서버가 계산)
 *       "<deviceId>": {          // 소속(직군)은 절대 박지 않는다!
 *         "<featureKey>": <count>
 *       }
 *     }
 *   }
 *   - 소속(직군)은 저장하지 않는다. 조회 시점(routes/usage.js)에 설문 응답으로
 *     deviceId → 소속을 매핑해 합산한다. → "소속 미정이던 사람이 나중에 설문에
 *     답하면 과거 기록까지 자동으로 새 소속으로 재분류"되는 효과.
 *
 * [공개 API]
 *   - init()                         → 부팅 시 1회. 디스크 로드 + 5초 flush 타이머.
 *   - applyUsage({deviceId,feature,kstDate}) → 단건 +1.
 *   - applyUsageMany({deviceId,features,kstDate}) → 다건 +1 (바텀시트 등).
 *   - getStatsSnapshot()             → 전체 통계 deep copy 반환 (조회용).
 *   - flushSync()                    → 종료 시 동기 저장.
 *   - stop()                         → 5초 타이머 정리.
 *
 * [연계 파일]
 *   - routes/usage.js          → /api/usage, /api/stats/usage 에서 본 모듈 사용
 *   - server.js                → SIGTERM/SIGINT 핸들러에서 flushSync() 호출
 *   - config/server_config.js  → FILES.USAGE_STATS 경로 사용
 *   - cloud_backup.js          → usage_stats.json 을 매일 GCS 백업
 * ============================================================================
 */

const fs = require('fs');
const fsp = fs.promises;
const { FILES } = require('../config/server_config');

// ----------------------------------------------------------------------------
// 내부 상태
// ----------------------------------------------------------------------------
// 메모리에 들고 있는 사용량 카운터. 디스크 파일(usage_stats.json) 의 1:1 사본.
let usageData = {};

// dirty 플래그: 메모리가 디스크보다 새로워서 flush 가 필요함.
let usageDirty = false;

// 동시 flush 방지용 플래그.
let isFlushing = false;

// setInterval 핸들. stop() 에서 정리.
let flushTimer = null;
let initialized = false;

// flush 주기 (visit_queue 와 동일: 5초)
const FLUSH_INTERVAL_MS = 5000;

// ----------------------------------------------------------------------------
// 헬퍼: JSON 동기 로드 (서버 부팅 시에만 1회 사용)
// ----------------------------------------------------------------------------
function _safeReadJson(filePath, fallback) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) {
        console.error(`[usage_queue] 초기 로드 실패 (${filePath}):`, e && e.message);
    }
    return fallback;
}

/**
 * 서버 부팅 시 1회 호출. 디스크에서 usage_stats.json 을 메모리에 로드하고
 * 5초 flush 타이머를 시작한다. 두 번째 이후 호출은 무시(idempotent).
 */
function init() {
    if (initialized) return;
    initialized = true;

    const u = _safeReadJson(FILES.USAGE_STATS, null);
    if (u && typeof u === 'object') {
        usageData = u;
    }

    flushTimer = setInterval(() => {
        _flushAsync().catch(err => {
            console.error('[usage_queue] flushAsync 예외:', err && err.message);
        });
    }, FLUSH_INTERVAL_MS);
}

// ----------------------------------------------------------------------------
// 공개 API: 스냅샷 조회
// ----------------------------------------------------------------------------
/**
 * 현재 전체 통계를 deep copy 로 반환.
 * (관리자 조회에서만 사용되므로 호출 빈도가 낮아 비용 부담 없음)
 */
function getStatsSnapshot() {
    try {
        return JSON.parse(JSON.stringify(usageData));
    } catch (e) {
        return {};
    }
}

// ----------------------------------------------------------------------------
// 내부: 단건 +1 (날짜/기기/feature)
// ----------------------------------------------------------------------------
function _bump(dateStr, deviceId, feature) {
    if (!dateStr || !feature) return;
    const dev = deviceId || 'anonymous';
    if (!usageData[dateStr]) usageData[dateStr] = {};
    if (!usageData[dateStr][dev]) usageData[dateStr][dev] = {};
    usageData[dateStr][dev][feature] = (usageData[dateStr][dev][feature] || 0) + 1;
    usageDirty = true;
}

// ----------------------------------------------------------------------------
// 공개 API: 사용 +1 (단건/다건)
// ----------------------------------------------------------------------------
/**
 * 단건 사용 +1. 디스크 쓰기는 하지 않고 메모리만 갱신(5초 뒤 묶어서 flush).
 *
 * @param {Object} opts
 * @param {string} opts.deviceId  기기 식별자 (없으면 'anonymous')
 * @param {string} opts.feature   featureKey 예: 'buoy.info_view'
 * @param {Date}   opts.kstDate   한국 시간 기준 Date 객체
 */
function applyUsage({ deviceId, feature, kstDate }) {
    try {
        const dateStr = kstDate.toISOString().split('T')[0];
        _bump(dateStr, deviceId, feature);
    } catch (e) {
        console.error('[usage_queue] applyUsage 실패:', e && e.message);
    }
}

/**
 * 다건 사용 +1 (바텀시트처럼 여러 요소가 동시에 표출될 때).
 *
 * @param {Object}   opts
 * @param {string}   opts.deviceId
 * @param {string[]} opts.features  featureKey 배열
 * @param {Date}     opts.kstDate
 */
function applyUsageMany({ deviceId, features, kstDate }) {
    try {
        if (!Array.isArray(features) || !features.length) return;
        const dateStr = kstDate.toISOString().split('T')[0];
        for (let i = 0; i < features.length; i++) {
            _bump(dateStr, deviceId, features[i]);
        }
    } catch (e) {
        console.error('[usage_queue] applyUsageMany 실패:', e && e.message);
    }
}

// ----------------------------------------------------------------------------
// 내부: 비동기 flush (5초 타이머용)
// ----------------------------------------------------------------------------
async function _flushAsync() {
    if (isFlushing) return;
    if (!usageDirty) return;

    isFlushing = true;
    usageDirty = false; // flush 도중 들어온 새 카운트는 다음 주기에 반영
    try {
        const body = JSON.stringify(usageData, null, 2);
        try {
            await fsp.writeFile(FILES.USAGE_STATS, body, 'utf8');
        } catch (e) {
            console.error('[usage_queue] usage_stats.json 기록 실패:', e && e.message);
            usageDirty = true; // 다음 주기에 재시도
        }
    } finally {
        isFlushing = false;
    }
}

// ----------------------------------------------------------------------------
// 공개 API: 동기 flush (graceful shutdown 용)
// ----------------------------------------------------------------------------
function flushSync() {
    try {
        fs.writeFileSync(FILES.USAGE_STATS, JSON.stringify(usageData, null, 2), 'utf8');
        usageDirty = false;
    } catch (e) {
        console.error('[usage_queue] flushSync 실패:', e && e.message);
    }
}

/**
 * 타이머 정리. 테스트나 명시적 종료가 필요할 때만 사용.
 */
function stop() {
    if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = null;
    }
}

module.exports = {
    init,
    applyUsage,
    applyUsageMany,
    getStatsSnapshot,
    flushSync,
    stop,
    // 테스트 / 디버깅용
    _internal: {
        get isFlushing() { return isFlushing; },
        get usageDirty() { return usageDirty; }
    }
};
