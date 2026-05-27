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

    // [1회 마이그레이션] 바텀시트 개별 집계분을 'sheet.bottom_sheet' 통합으로 묶음.
    _migrateBottomSheetOnce();

    // [1회 보정] 운영자 확인 기준 바텀시트 실제 사용 = 13세션(천문/월령/조석=13 = 바텀시트 세션 수).
    //   마이그레이션 MAX 는 슬라이더 갱신까지 포함된 수심/수온(24)에 끌려 부풀 수 있으므로 13으로 고정.
    //   1회만 총합을 13으로 맞추고, 이후 실제 사용분은 그 위에 정상 누적(마커로 재실행 방지).
    _calibrateBottomSheetTotalOnce(13);

    // [1회 보정] 바텀시트 13세션분이 공유 항목(바람/조류/파고/천기 각각)에 중복 가산돼 있어
    //   각 공유 키에서 13씩 차감한다(0 미만으로는 내려가지 않음).
    _subtractPerSharedKeyOnce(13);

    // [1회 마이그레이션] 'ocean.typhoon_play'(태풍 재생)를 'ocean.typhoon'(태풍)으로 합침.
    //   태풍 기능 내 동작을 '태풍' 하나로 집계하기로 변경 → 기존 분리 집계분을 합산.
    _migrateTyphoonPlayOnce();

    flushTimer = setInterval(() => {
        _flushAsync().catch(err => {
            console.error('[usage_queue] flushAsync 예외:', err && err.message);
        });
    }, FLUSH_INTERVAL_MS);
}

// ----------------------------------------------------------------------------
// 1회 마이그레이션: 바텀시트 개별 집계 → 'sheet.bottom_sheet' 통합
// ----------------------------------------------------------------------------
// 과거엔 바텀시트의 각 요소(조석/천문/월령/수심/수온)를 따로 +1 했으나, 이제는
// 바텀시트로 데이터를 얻으면 1건으로 통합한다. 기존 데이터도 같은 개념으로 묶는다.
//   - 한 번의 바텀시트 열림이 각 요소를 1씩 올렸으므로, (날짜×기기)별로 그 요소들의
//     "최댓값"을 바텀시트 사용 횟수의 근사로 보고 sheet.bottom_sheet 에 합산한다(합이 아닌 최댓값).
//   - 공유키(ocean.current/wind/wave, shrt.*)는 오버레이/천기도 버튼과 섞여 있어
//     바텀시트분만 분리할 수 없으므로 과거 데이터는 그대로 둔다(향후 바텀시트는 더 이상 가산 안 함).
//   - 마커 파일로 1회만 실행.
function _migrateBottomSheetOnce() {
    const markerPath = FILES.USAGE_STATS + '.migrations.json';
    const marker = _safeReadJson(markerPath, {}) || {};
    if (marker.bottomSheetMerged) return;

    const EXCL = ['sheet.tide', 'sheet.astro', 'sheet.moon', 'sheet.depth', 'sheet.water_temp'];
    let changed = false;
    try {
        Object.keys(usageData).forEach(dateStr => {
            const byDev = usageData[dateStr];
            if (!byDev || typeof byDev !== 'object') return;
            Object.keys(byDev).forEach(dev => {
                const feats = byDev[dev];
                if (!feats || typeof feats !== 'object') return;
                let mx = 0, found = false;
                EXCL.forEach(k => {
                    if (feats[k] != null) {
                        found = true;
                        if (feats[k] > mx) mx = feats[k];
                        delete feats[k];
                    }
                });
                if (found && mx > 0) {
                    feats['sheet.bottom_sheet'] = (feats['sheet.bottom_sheet'] || 0) + mx;
                    changed = true;
                }
            });
        });
    } catch (e) {
        console.error('[usage_queue] 바텀시트 마이그레이션 실패:', e && e.message);
    }

    // 데이터를 먼저 디스크에 반영한 뒤 마커 기록 (정합성).
    if (changed) {
        try {
            fs.writeFileSync(FILES.USAGE_STATS, JSON.stringify(usageData, null, 2), 'utf8');
        } catch (e) {
            console.error('[usage_queue] 마이그레이션 데이터 기록 실패:', e && e.message);
        }
    }
    try {
        fs.writeFileSync(markerPath, JSON.stringify({ bottomSheetMerged: true, at: new Date().toISOString() }, null, 2), 'utf8');
        console.log('[usage_queue] 바텀시트 통합 마이그레이션 완료' + (changed ? ' (데이터 갱신됨)' : ' (변경 없음)'));
    } catch (e) {
        console.error('[usage_queue] 마이그레이션 마커 기록 실패:', e && e.message);
    }
}

// ----------------------------------------------------------------------------
// 1회 마이그레이션: 'ocean.typhoon_play' → 'ocean.typhoon' 합산 후 원본 삭제
// ----------------------------------------------------------------------------
function _migrateTyphoonPlayOnce() {
    const markerPath = FILES.USAGE_STATS + '.migrations.json';
    const marker = _safeReadJson(markerPath, {}) || {};
    if (marker.typhoonPlayMerged) return;

    let changed = false;
    try {
        Object.keys(usageData).forEach(dateStr => {
            const byDev = usageData[dateStr];
            if (!byDev || typeof byDev !== 'object') return;
            Object.keys(byDev).forEach(dev => {
                const feats = byDev[dev];
                if (!feats || typeof feats !== 'object') return;
                if (feats['ocean.typhoon_play'] != null) {
                    feats['ocean.typhoon'] = (feats['ocean.typhoon'] || 0) + feats['ocean.typhoon_play'];
                    delete feats['ocean.typhoon_play'];
                    changed = true;
                }
            });
        });
    } catch (e) {
        console.error('[usage_queue] 태풍 재생 마이그레이션 실패:', e && e.message);
    }

    if (changed) {
        try { fs.writeFileSync(FILES.USAGE_STATS, JSON.stringify(usageData, null, 2), 'utf8'); }
        catch (e) { console.error('[usage_queue] 태풍 마이그레이션 기록 실패:', e && e.message); }
    }
    try {
        marker.typhoonPlayMerged = true;
        marker.typhoonPlayMergedAt = new Date().toISOString();
        fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2), 'utf8');
        console.log('[usage_queue] 태풍 재생 통합 마이그레이션 완료' + (changed ? ' (데이터 갱신됨)' : ' (변경 없음)'));
    } catch (e) {
        console.error('[usage_queue] 태풍 마이그레이션 마커 기록 실패:', e && e.message);
    }
}

// ----------------------------------------------------------------------------
// 1회 보정: 'sheet.bottom_sheet' 총합을 운영자 확인값(target)으로 맞춤
// ----------------------------------------------------------------------------
// 마이그레이션(최댓값 근사)이 실제와 다를 수 있어, 운영자가 확인한 실제 누적(현재 기준)으로
// 1회 보정한다. 기존 버킷(날짜×기기) 분포는 최대한 보존하며 차이만 가감한다.
//   - 현재 총합 > target : 큰 버킷부터 줄여서 target 로.
//   - 현재 총합 < target : 가장 큰 버킷(없으면 오늘/anonymous 생성)에 부족분 가산.
//   - 마커로 1회만 실행. 이후 실제 사용분은 이 값 위에 정상 누적.
function _calibrateBottomSheetTotalOnce(target) {
    const markerPath = FILES.USAGE_STATS + '.migrations.json';
    const marker = _safeReadJson(markerPath, {}) || {};
    if (marker.bottomSheetCalibrated) return;

    try {
        const buckets = [];
        Object.keys(usageData).forEach(dateStr => {
            const byDev = usageData[dateStr];
            if (!byDev || typeof byDev !== 'object') return;
            Object.keys(byDev).forEach(dev => {
                const feats = byDev[dev];
                if (feats && typeof feats === 'object' && feats['sheet.bottom_sheet'] > 0) {
                    buckets.push(feats);
                }
            });
        });
        let total = buckets.reduce((s, f) => s + f['sheet.bottom_sheet'], 0);

        if (total !== target) {
            buckets.sort((a, b) => b['sheet.bottom_sheet'] - a['sheet.bottom_sheet']);
            if (total > target) {
                let need = total - target;
                for (let i = 0; i < buckets.length && need > 0; i++) {
                    const take = Math.min(need, buckets[i]['sheet.bottom_sheet']);
                    buckets[i]['sheet.bottom_sheet'] -= take;
                    need -= take;
                }
            } else { // total < target
                const add = target - total;
                if (buckets.length) {
                    buckets[0]['sheet.bottom_sheet'] += add;
                } else {
                    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().split('T')[0];
                    if (!usageData[today]) usageData[today] = {};
                    if (!usageData[today]['anonymous']) usageData[today]['anonymous'] = {};
                    usageData[today]['anonymous']['sheet.bottom_sheet'] = target;
                }
            }
            try {
                fs.writeFileSync(FILES.USAGE_STATS, JSON.stringify(usageData, null, 2), 'utf8');
            } catch (e) {
                console.error('[usage_queue] 바텀시트 보정 데이터 기록 실패:', e && e.message);
            }
            console.log('[usage_queue] 바텀시트 총합 보정: ' + total + ' → ' + target);
        }
    } catch (e) {
        console.error('[usage_queue] 바텀시트 보정 실패:', e && e.message);
    }

    marker.bottomSheetCalibrated = true;
    marker.bottomSheetCalibratedAt = new Date().toISOString();
    marker.bottomSheetTarget = target;
    try {
        fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2), 'utf8');
    } catch (e) {
        console.error('[usage_queue] 보정 마커 기록 실패:', e && e.message);
    }
}

// ----------------------------------------------------------------------------
// 1회 보정: 공유 항목 각각에서 바텀시트 중복분(amount) 차감
// ----------------------------------------------------------------------------
// 바텀시트가 과거에 공유 항목(바람/조류/파고/천기 요소)에도 함께 가산됐으므로, 각 공유 키에서
// 바텀시트 세션 수(amount=13)만큼 차감해 "버튼으로 본 순수 사용량"만 남긴다.
//   - 키별로 (날짜×기기) 버킷을 큰 값부터 차감, 0 미만으로는 내려가지 않음.
//   - 마커로 1회만 실행.
function _subtractPerSharedKeyOnce(amount) {
    const markerPath = FILES.USAGE_STATS + '.migrations.json';
    const marker = _safeReadJson(markerPath, {}) || {};
    if (marker.sharedBottomSheetSubtracted) return;

    const SHARED = [
        'ocean.current', 'ocean.wind', 'ocean.wave',
        'shrt.rain_prob', 'shrt.rain_amount', 'shrt.snow', 'shrt.sky', 'shrt.temp_air'
    ];
    try {
        SHARED.forEach(key => {
            const entries = [];
            Object.keys(usageData).forEach(dateStr => {
                const byDev = usageData[dateStr];
                if (!byDev || typeof byDev !== 'object') return;
                Object.keys(byDev).forEach(dev => {
                    const feats = byDev[dev];
                    if (feats && typeof feats === 'object' && feats[key] > 0) entries.push(feats);
                });
            });
            entries.sort((a, b) => b[key] - a[key]);
            let need = amount;
            for (let i = 0; i < entries.length && need > 0; i++) {
                const take = Math.min(need, entries[i][key]);
                entries[i][key] -= take;
                need -= take;
            }
        });
        try {
            fs.writeFileSync(FILES.USAGE_STATS, JSON.stringify(usageData, null, 2), 'utf8');
        } catch (e) {
            console.error('[usage_queue] 공유키 차감 데이터 기록 실패:', e && e.message);
        }
        console.log('[usage_queue] 공유 항목 각각에서 바텀시트 중복분 ' + amount + ' 차감 완료');
    } catch (e) {
        console.error('[usage_queue] 공유키 차감 실패:', e && e.message);
    }

    marker.sharedBottomSheetSubtracted = true;
    marker.sharedBottomSheetSubtractedAt = new Date().toISOString();
    marker.sharedBottomSheetSubtractedAmount = amount;
    try {
        fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2), 'utf8');
    } catch (e) {
        console.error('[usage_queue] 공유키 차감 마커 기록 실패:', e && e.message);
    }
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
