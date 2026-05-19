/**
 * ============================================================================
 * 파일명: services/visit_queue.js
 * 역할: 방문자 통계 비동기 큐 (메모리 카운터 + 5초 주기 디스크 flush)
 * ============================================================================
 *
 * [무엇을 하는 모듈인가요? — 비개발자용 비유]
 *   - 가게에 손님이 올 때마다 그때그때 출입대장(파일)을 펴서 한 줄씩
 *     기록하면, 손님이 많을수록 점원이 펜을 들 시간이 줄어 줄이 길어집니다.
 *   - 이 모듈은 점원 옆에 "메모지" (메모리 카운터) 를 둡니다.
 *     1) 손님이 오면 메모지에 즉시 +1 합니다.   (요청은 즉시 응답)
 *     2) 5초마다 한 번씩 메모지를 보고 출입대장(JSON 파일)을 한꺼번에
 *        업데이트합니다.                       (디스크 쓰기는 묶어서)
 *   - 서버가 종료될 때(SIGTERM/SIGINT) 메모지를 마지막으로 출입대장에
 *     반영합니다(flushSync).  → 종료 시점 데이터 손실 0.
 *
 * [원래 어떻게 동작했나요?]
 *   - routes/stats.js 의 /api/visit 핸들러가 요청마다
 *     fs.writeFileSync(VISITORS, ...) 와 fs.writeFileSync(VISITORS_STATS, ...)
 *     를 호출하여 디스크에 동기적으로 기록했습니다.
 *   - 통계 파일이 누적될수록 매 요청당 15~20ms 의 이벤트 루프 블로킹이
 *     발생하여, 푸시 직후 동시 방문이 몰릴 때 다른 API 응답까지 같이
 *     느려졌습니다.
 *
 * [왜 이렇게 바꿨나요?]
 *   - 사용자 결정사항: 부작용 2 옵션 B (flush 주기 5초)
 *     → 통계 표시 지연을 최소화하면서 디스크 쓰기 빈도를 1/N 로 줄임.
 *   - 응답 본문은 메모리 카운터의 최신값을 즉시 반환하므로,
 *     사용자가 새로 고침해도 카운트가 곧바로 올라간 것을 볼 수 있음.
 *   - 디스크 flush 는 백그라운드에서 비동기로 진행 → 이벤트 루프 차단 없음.
 *
 * [공개 API]
 *   - init()                       → 서버 부팅 시 1회 호출. 디스크에서 초기 상태 로드.
 *   - getVisitorSnapshot()         → 현재 메모리 카운터({today,total,...})를 얕은 복사로 반환.
 *   - getStatsSnapshot()           → 현재 메모리 상세 통계({date:{total,hourly}})를 깊은 복사로 반환.
 *   - applyVisit({kstDate,isAdmin}) → 방문 +1 적용 후 갱신된 visitorData snapshot 반환.
 *   - flushSync()                  → 동기적으로 디스크에 즉시 반영 (graceful shutdown 용).
 *   - stop()                       → 5초 타이머 정리 (테스트/종료 용).
 *
 * [연계 파일]
 *   - routes/stats.js → /api/visit, /api/stats/visitors 에서 본 모듈 사용
 *   - server.js       → SIGTERM/SIGINT 핸들러에서 flushSync() 호출
 *   - config/server_config.js → FILES.VISITORS, FILES.VISITORS_STATS 경로 사용
 * ============================================================================
 */

const fs = require('fs');
const fsp = fs.promises;
const { FILES } = require('../config/server_config');

// ----------------------------------------------------------------------------
// 내부 상태
// ----------------------------------------------------------------------------
// 메모리에 들고 있는 방문자 카운터. 디스크 파일(visitors.json) 의 1:1 사본.
let visitorData = { today: 0, total: 0, lastDate: '' };
// 메모리에 들고 있는 시간대별 상세 통계. 디스크 파일(visitors_stats.json) 의 1:1 사본.
let statsData = {};

// dirty 플래그: 메모리가 디스크보다 새로워서 flush 가 필요함.
let visitorDirty = false;
let statsDirty = false;

// 동시 flush 방지용 플래그. true 인 동안에는 새 flush 를 시작하지 않음.
// (마지막 dirty 만 다음 주기에 처리되어도 데이터는 누적값이라 문제없음)
let isFlushing = false;

// setInterval 핸들. stop() 에서 정리.
let flushTimer = null;
let initialized = false;

// flush 주기 (사용자 결정사항: 5초)
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
        console.error(`[visit_queue] 초기 로드 실패 (${filePath}):`, e && e.message);
    }
    return fallback;
}

/**
 * 서버 부팅 시 1회 호출. 디스크에서 visitors.json / visitors_stats.json 을
 * 메모리에 로드하고 5초 flush 타이머를 시작합니다.
 *
 * 두 번째 이후 호출은 무시(idempotent).
 */
function init() {
    if (initialized) return;
    initialized = true;

    const v = _safeReadJson(FILES.VISITORS, null);
    if (v && typeof v === 'object') {
        visitorData = Object.assign({ today: 0, total: 0, lastDate: '' }, v);
    }
    const s = _safeReadJson(FILES.VISITORS_STATS, null);
    if (s && typeof s === 'object') {
        statsData = s;
    }

    // 5초마다 dirty 인 부분만 디스크에 비동기 기록.
    // unref() 처리하지 않음 — 타이머가 떠있어도 서버는 listen 으로 살아있음.
    flushTimer = setInterval(() => {
        _flushAsync().catch(err => {
            // 어떤 이유로든 throw 가 새어 나오는 일이 없도록 한 번 더 방어.
            console.error('[visit_queue] flushAsync 예외:', err && err.message);
        });
    }, FLUSH_INTERVAL_MS);
}

// ----------------------------------------------------------------------------
// 공개 API: 스냅샷 조회
// ----------------------------------------------------------------------------
/**
 * 현재 메모리 카운터를 얕은 복사로 반환.
 * 호출 측에서 객체를 수정해도 내부 상태에 영향을 주지 않도록 항상 복사본을 줍니다.
 */
function getVisitorSnapshot() {
    return Object.assign({}, visitorData);
}

/**
 * 현재 상세 통계 전체를 깊은 복사로 반환.
 * /api/stats/visitors 응답으로 그대로 사용 가능.
 */
function getStatsSnapshot() {
    // JSON 직렬화/역직렬화로 안전한 deep copy.
    // (관리자 페이지에서만 사용되므로 호출 빈도가 낮아 비용 부담 없음)
    try {
        return JSON.parse(JSON.stringify(statsData));
    } catch (e) {
        return {};
    }
}

// ----------------------------------------------------------------------------
// 공개 API: 방문 +1
// ----------------------------------------------------------------------------
/**
 * 방문 +1 적용 후 갱신된 visitorData 의 snapshot 을 반환합니다.
 * (디스크 쓰기는 하지 않고 메모리만 갱신 — flush 타이머가 5초 뒤에 묶어서 기록)
 *
 * @param {Object} opts
 * @param {Date}    opts.kstDate  한국 시간 기준 Date 객체
 * @param {boolean} opts.isAdmin  관리자 기기 여부 (true 면 하루 1회만 카운트)
 * @returns {Object|null} 카운트 변경된 경우 갱신된 snapshot, 변경 없으면 null
 */
function applyVisit({ kstDate, isAdmin }) {
    const todayStr = kstDate.toISOString().split('T')[0];
    const hourStr = String(kstDate.getUTCHours()).padStart(2, '0');

    // 관리자 모드: 오늘 이미 관리자로 방문 기록이 있으면 카운트 증가 안 함.
    if (isAdmin && visitorData.adminLastDate === todayStr) {
        return null;
    }

    // 날짜가 바뀌었으면 today 카운터를 1 로 초기화하고 lastDate 갱신.
    if (visitorData.lastDate !== todayStr) {
        visitorData.today = 1;
        visitorData.lastDate = todayStr;
    } else {
        visitorData.today += 1;
    }
    visitorData.total += 1;

    if (isAdmin) {
        visitorData.adminLastDate = todayStr;
    }

    // 시간대별 상세 통계도 메모리에서 갱신.
    if (!statsData[todayStr]) {
        statsData[todayStr] = { total: 0, hourly: {} };
    }
    statsData[todayStr].total = (statsData[todayStr].total || 0) + 1;
    statsData[todayStr].hourly[hourStr] = (statsData[todayStr].hourly[hourStr] || 0) + 1;

    visitorDirty = true;
    statsDirty = true;

    return Object.assign({}, visitorData);
}

// ----------------------------------------------------------------------------
// 내부: 비동기 flush (5초 타이머용)
// ----------------------------------------------------------------------------
/**
 * dirty 인 파일만 비동기로 디스크에 기록합니다.
 * 동시 진입 방지(isFlushing) 와 부분 실패 격리를 보장합니다.
 */
async function _flushAsync() {
    if (isFlushing) return;
    if (!visitorDirty && !statsDirty) return;

    isFlushing = true;
    // flush 시작 시점에 dirty 를 false 로 내려두고, 실패 시 다시 true 로 복귀.
    // → flush 도중에 들어온 새 방문은 다음 주기에 자연스럽게 반영됨.
    const writingVisitor = visitorDirty;
    const writingStats = statsDirty;
    visitorDirty = false;
    statsDirty = false;

    try {
        if (writingVisitor) {
            // 메모리 상태를 그 시점 그대로 직렬화 (V8 단일 스레드라 원자적).
            const body = JSON.stringify(visitorData, null, 2);
            try {
                await fsp.writeFile(FILES.VISITORS, body, 'utf8');
            } catch (e) {
                console.error('[visit_queue] visitors.json 기록 실패:', e && e.message);
                visitorDirty = true; // 다음 주기에 재시도
            }
        }
        if (writingStats) {
            const body = JSON.stringify(statsData, null, 2);
            try {
                await fsp.writeFile(FILES.VISITORS_STATS, body, 'utf8');
            } catch (e) {
                console.error('[visit_queue] visitors_stats.json 기록 실패:', e && e.message);
                statsDirty = true; // 다음 주기에 재시도
            }
        }
    } finally {
        isFlushing = false;
    }
}

// ----------------------------------------------------------------------------
// 공개 API: 동기 flush (graceful shutdown 용)
// ----------------------------------------------------------------------------
/**
 * 종료 직전에 메모리 상태를 동기적으로 디스크에 기록합니다.
 * SIGTERM/SIGINT 핸들러에서 호출되어 데이터 손실을 0 으로 만들어 줍니다.
 *
 * 비동기 flush 가 진행 중이더라도 메모리는 단일 스레드라 그 순간의
 * 메모리 상태를 다시 한 번 동기로 덮어쓰면 안전합니다.
 */
function flushSync() {
    try {
        // 종료 시점이므로 dirty 와 관계없이 무조건 메모리 상태를 기록.
        // (혹시 flushAsync 가 도중에 실패해서 dirty 가 떠 있어도 최종 반영됨)
        fs.writeFileSync(FILES.VISITORS, JSON.stringify(visitorData, null, 2), 'utf8');
        fs.writeFileSync(FILES.VISITORS_STATS, JSON.stringify(statsData, null, 2), 'utf8');
        visitorDirty = false;
        statsDirty = false;
    } catch (e) {
        console.error('[visit_queue] flushSync 실패:', e && e.message);
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
    getVisitorSnapshot,
    getStatsSnapshot,
    applyVisit,
    flushSync,
    stop,
    // 테스트 / 디버깅용 (외부에서 적극 사용 금지)
    _internal: {
        get isFlushing() { return isFlushing; },
        get visitorDirty() { return visitorDirty; },
        get statsDirty() { return statsDirty; }
    }
};
