/**
 * [push_counter] — 누적 푸시 발송 카운터.
 *
 * 배경:
 *   routes/push.js 의 push_history (custom_push_history.json) 는 500건으로 capped.
 *   관리자 UI 의 "총 N회 M개 푸시 발송" 표시는 history.length / Σh.count 로 계산되어
 *   500건을 넘어가면 더이상 증가하지 않음.
 *
 * 해결:
 *   별도 누적 counter 파일 (data/push_counter.json) 을 유지.
 *   - totalSends: 발송 cycle 수 (sendCustomPush 호출 1회 = 1 send)
 *   - totalCount: 발송된 push 총 개수 (수신자 수 합산)
 *   기존 history 파일은 그대로 유지 (이력 확인용). counter 는 별도로 atomic write.
 *
 * 부팅 시 counter 파일이 없으면 push_history.json 으로부터 1회 마이그레이션.
 */

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/server_config');

const COUNTER_FILE = path.join(DATA_DIR, 'push_counter.json');
const COUNTER_TMP = COUNTER_FILE + '.tmp';
const HISTORY_FILE = path.join(DATA_DIR, 'custom_push_history.json');

let _cache = null;       // in-memory cache
let _saveTimer = null;   // debounced save

function _readDisk() {
    try {
        if (fs.existsSync(COUNTER_FILE)) {
            const raw = fs.readFileSync(COUNTER_FILE, 'utf8');
            const j = JSON.parse(raw);
            return {
                totalSends: Number.isFinite(j.totalSends) ? j.totalSends : 0,
                totalCount: Number.isFinite(j.totalCount) ? j.totalCount : 0
            };
        }
    } catch (e) {
        console.warn('[push_counter] 디스크 읽기 실패 (무시):', e && e.message);
    }
    return null;
}

function _migrateFromHistory() {
    try {
        if (!fs.existsSync(HISTORY_FILE)) return { totalSends: 0, totalCount: 0 };
        const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return { totalSends: 0, totalCount: 0 };
        const totalSends = arr.length;
        const totalCount = arr.reduce((s, h) => s + (Number(h.count) || 0), 0);
        console.log('[push_counter] 초기 마이그레이션 — history ' + totalSends + '건 → totalSends=' + totalSends + ', totalCount=' + totalCount);
        return { totalSends, totalCount };
    } catch (e) {
        console.warn('[push_counter] 마이그레이션 실패 (0으로 초기화):', e && e.message);
        return { totalSends: 0, totalCount: 0 };
    }
}

function _ensureLoaded() {
    if (_cache) return _cache;
    const disk = _readDisk();
    if (disk) {
        _cache = disk;
    } else {
        // 최초 1회 — 기존 push_history.json 으로부터 마이그레이션
        _cache = _migrateFromHistory();
        _saveSync();
    }
    return _cache;
}

function _saveSync() {
    try {
        const dir = path.dirname(COUNTER_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(COUNTER_TMP, JSON.stringify(_cache, null, 2), 'utf8');
        fs.renameSync(COUNTER_TMP, COUNTER_FILE);
    } catch (e) {
        console.warn('[push_counter] 디스크 저장 실패 (무시):', e && e.message);
    }
}

function _saveDebounced() {
    if (_saveTimer) return;
    _saveTimer = setTimeout(() => {
        _saveTimer = null;
        _saveSync();
    }, 500);
}

/**
 * 발송 1회 카운트 — sends=1 + count 수신자 수.
 * 어떤 push 경로든 (custom/admin/dmdw) 동일 함수 호출.
 *
 * @param {number} count - 이번 발송에서 도달한 수신자 수 (sent 수 또는 device 수)
 */
function incrementSend(count) {
    const c = _ensureLoaded();
    c.totalSends = (c.totalSends || 0) + 1;
    c.totalCount = (c.totalCount || 0) + (Number(count) || 0);
    _saveDebounced();
}

/**
 * counter 값 조회.
 */
function get() {
    const c = _ensureLoaded();
    return { totalSends: c.totalSends || 0, totalCount: c.totalCount || 0 };
}

/**
 * 테스트/관리자 reset 용 — 수동 set (counter 보정).
 */
function set(totalSends, totalCount) {
    _cache = {
        totalSends: Number.isFinite(totalSends) ? totalSends : 0,
        totalCount: Number.isFinite(totalCount) ? totalCount : 0
    };
    _saveSync();
}

module.exports = {
    incrementSend,
    get,
    set,
    COUNTER_FILE
};
