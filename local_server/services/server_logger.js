/**
 * ============================================================================
 * 파일명: services/server_logger.js
 * 역할: 서버 console.* 출력을 영속 볼륨에 일별 파일로 기록(tee) + 기간 조회 API
 * ============================================================================
 *
 * [목적]
 *   매번 fly.io 로그에 들어가지 않고도, 앱 통합관리자센터 > 점검 > "서버로그"
 *   하위탭에서 서버 로그를 기간(분 단위)으로 조회·복사할 수 있게 한다.
 *
 * [동작]
 *   - init(): console.log/info/warn/error 를 래핑해 (1) 원래 출력 그대로 + (2)
 *     타임스탬프(KST) 붙여 메모리 버퍼에 적재. 1초마다 또는 버퍼가 차면 일별 파일에 flush.
 *   - 저장 위치: DATA_DIR/server_logs/YYYY-MM-DD.log  (fly 영속 볼륨 seagnal_data).
 *   - 보관: 3일(당일 포함 최근 3개 일자)만 유지, 오래된 파일 자동 삭제.
 *   - 용량 상한: 일자별 파일 MAX_DAY_BYTES 초과 시 추가 기록 중단(마커 1회) — 볼륨 보호.
 *   - getLogs({from,to,level,q,limit}): 기간/레벨/검색어 필터링 결과 반환.
 *
 * [안전성]
 *   - console 래퍼는 절대 throw 하지 않는다(파일 IO 실패해도 원래 콘솔은 항상 동작).
 *   - init() 멱등(중복 호출 무시).
 *
 * [연계] server.js(최상단 init), routes/admin.js(GET /api/admin/server-log)
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const util = require('util');

let _initDone = false;
let LOG_DIR = null;

const RETENTION_DAYS = 3;          // 당일 포함 최근 3개 일자 유지
const MAX_DAY_BYTES = 12 * 1024 * 1024; // 일자별 파일 상한 12MB (3일 ≈ 36MB 상한)
const FLUSH_MS = 1000;             // 1초마다 flush
const BUFFER_MAX = 200;            // 버퍼가 200줄 차면 즉시 flush
const QUERY_LIMIT_MAX = 5000;      // 조회 1회 최대 반환 줄 수

let _buffer = [];                  // { day, line } 적재
let _dayBytes = {};                // { 'YYYY-MM-DD': bytesWrittenToday }
let _capMarked = {};               // { day: true } — 상한 도달 마커 1회만
let _flushTimer = null;
const _origConsole = {};

/** KST(UTC+9) Date 객체. */
function _kstNow() {
    return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

/** KST 기준 'YYYY-MM-DD'. */
function _kstDay(d) {
    const k = d || _kstNow();
    return k.toISOString().slice(0, 10);
}

/** KST 기준 'YYYY-MM-DD HH:mm:ss'. */
function _kstStamp(d) {
    const k = d || _kstNow();
    return k.toISOString().slice(0, 19).replace('T', ' ');
}

function _dayFile(day) {
    return path.join(LOG_DIR, day + '.log');
}

/** 오래된(보관기간 초과) 로그 파일 삭제. */
function _purgeOld() {
    try {
        const files = fs.readdirSync(LOG_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.log$/.test(f));
        if (files.length <= RETENTION_DAYS) return;
        files.sort(); // 날짜 오름차순
        const remove = files.slice(0, files.length - RETENTION_DAYS);
        for (const f of remove) {
            try { fs.unlinkSync(path.join(LOG_DIR, f)); } catch (_e) { /* noop */ }
            delete _dayBytes[f.replace('.log', '')];
            delete _capMarked[f.replace('.log', '')];
        }
    } catch (_e) { /* noop */ }
}

/** 버퍼 → 일자별 파일 flush. 절대 throw 하지 않음. */
function _flush() {
    if (_buffer.length === 0) return;
    const batch = _buffer;
    _buffer = [];
    // 일자별로 묶어서 append
    const byDay = {};
    for (const item of batch) {
        (byDay[item.day] = byDay[item.day] || []).push(item.line);
    }
    for (const day of Object.keys(byDay)) {
        try {
            if (_dayBytes[day] == null) {
                // 최초: 기존 파일 크기 반영
                try { _dayBytes[day] = fs.statSync(_dayFile(day)).size; } catch (_e) { _dayBytes[day] = 0; }
            }
            if (_dayBytes[day] >= MAX_DAY_BYTES) {
                if (!_capMarked[day]) {
                    _capMarked[day] = true;
                    try { fs.appendFileSync(_dayFile(day), `[${_kstStamp()}] [WARN] [server_logger] 일자 로그 용량 상한(${MAX_DAY_BYTES} bytes) 도달 — 이후 기록 생략\n`); } catch (_e) { /* noop */ }
                }
                continue;
            }
            const text = byDay[day].join('\n') + '\n';
            fs.appendFileSync(_dayFile(day), text);
            _dayBytes[day] += Buffer.byteLength(text);
        } catch (_e) { /* 파일 IO 실패는 무시 — 콘솔 출력은 이미 끝남 */ }
    }
}

/** console 인자들을 한 줄 문자열로. */
function _fmt(args) {
    try {
        return util.format.apply(null, args);
    } catch (_e) {
        try { return String(args[0]); } catch (_e2) { return '[unformattable]'; }
    }
}

function _record(level, args) {
    try {
        const msg = _fmt(args).replace(/\r?\n/g, ' ⏎ '); // 멀티라인 → 한 줄(파싱 단순화)
        const line = `[${_kstStamp()}] [${level}] ${msg}`;
        _buffer.push({ day: _kstDay(), line });
        if (_buffer.length >= BUFFER_MAX) _flush();
    } catch (_e) { /* 절대 throw 안 함 */ }
}

/**
 * console.* 래핑 + flush 타이머 시작. 멱등.
 */
function init() {
    if (_initDone) return;
    _initDone = true;
    try {
        const { DATA_DIR } = require('../config/server_config');
        LOG_DIR = path.join(DATA_DIR, 'server_logs');
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    } catch (e) {
        // config 로드 실패 시 로깅 비활성(원래 콘솔만 동작)
        _initDone = false;
        return;
    }

    ['log', 'info', 'warn', 'error'].forEach(function (m) {
        _origConsole[m] = console[m].bind(console);
        const level = m === 'log' ? 'INFO' : m.toUpperCase();
        console[m] = function () {
            _origConsole[m].apply(console, arguments);
            _record(level, Array.prototype.slice.call(arguments));
        };
    });

    _purgeOld();
    _flushTimer = setInterval(function () {
        _flush();
        // 자정(KST) 넘어가며 새 파일 생기면 오래된 것 정리
        _purgeOld();
    }, FLUSH_MS);
    if (_flushTimer.unref) _flushTimer.unref();

    // 종료 시 잔여 버퍼 flush
    const onExit = function () { try { _flush(); } catch (_e) { /* noop */ } };
    process.on('exit', onExit);
    process.on('SIGINT', function () { onExit(); process.exit(0); });
    process.on('SIGTERM', function () { onExit(); process.exit(0); });

    console.log('[server_logger] 서버 로그 파일 기록 시작 (3일 보관, dir=' + LOG_DIR + ')');
}

/**
 * 기간/레벨/검색 필터 로그 조회.
 * @param {object} opts
 *   from, to : 'YYYY-MM-DD HH:mm' (KST) 문자열 또는 'YYYY-MM-DD HH:mm:ss'. 생략 시 무제한.
 *   level    : 'ERROR'|'WARN'|'INFO' (이상 포함은 안 함, 정확히 그 레벨) 또는 'ALL'/생략.
 *   q        : 부분일치 검색어(대소문자 무시). 생략 가능.
 *   limit    : 최대 반환 줄(기본 2000, 최대 QUERY_LIMIT_MAX).
 * @returns {{ok:true, total:number, returned:number, lines:string[]}}
 */
function getLogs(opts) {
    opts = opts || {};
    _flush(); // 버퍼 잔여분 먼저 내림
    if (!LOG_DIR) return { ok: true, total: 0, returned: 0, lines: [] };

    const norm = function (s) {
        if (!s) return null;
        s = String(s).trim().replace('T', ' ');
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) s += ':00';
        return s; // 문자열 사전식 비교 (동일 포맷이므로 시간순)
    };
    const from = norm(opts.from);
    const to = norm(opts.to);
    const level = (opts.level && opts.level !== 'ALL') ? String(opts.level).toUpperCase() : null;
    const q = opts.q ? String(opts.q).toLowerCase() : null;
    let limit = Number(opts.limit) || 2000;
    if (limit > QUERY_LIMIT_MAX) limit = QUERY_LIMIT_MAX;

    // 대상 일자 파일 선정 (from~to 의 날짜 범위와 겹치는 파일)
    let files;
    try {
        files = fs.readdirSync(LOG_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort();
    } catch (_e) { return { ok: true, total: 0, returned: 0, lines: [] }; }

    const fromDay = from ? from.slice(0, 10) : null;
    const toDay = to ? to.slice(0, 10) : null;
    files = files.filter(f => {
        const d = f.slice(0, 10);
        if (fromDay && d < fromDay) return false;
        if (toDay && d > toDay) return false;
        return true;
    });

    const matched = [];
    const stampRe = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] \[([A-Z]+)\]/;
    let total = 0;
    for (const f of files) {
        let content;
        try { content = fs.readFileSync(path.join(LOG_DIR, f), 'utf8'); } catch (_e) { continue; }
        const lines = content.split('\n');
        for (const line of lines) {
            if (!line) continue;
            const m = stampRe.exec(line);
            if (m) {
                const ts = m[1], lv = m[2];
                if (from && ts < from) continue;
                if (to && ts > to) continue;
                if (level && lv !== level) continue;
                if (q && line.toLowerCase().indexOf(q) === -1) continue;
                total++;
                matched.push(line);
            } else {
                // 타임스탬프 없는(이론상 없음) 라인은 직전 매칭에 종속 — 검색어만 적용
                if (matched.length && (!q || line.toLowerCase().indexOf(q) !== -1)) {
                    matched.push(line);
                }
            }
        }
    }
    // 최신순으로 limit 만큼 (뒤에서 자름)
    const returnedLines = matched.length > limit ? matched.slice(matched.length - limit) : matched;
    return { ok: true, total: total, returned: returnedLines.length, lines: returnedLines };
}

module.exports = { init, getLogs };
