/**
 * 역할: 위험예측 자료의 오류·누락·낡음·복구를 비밀 없이 유한 이력으로 보관한다.
 * [연계] risk_collector_io.status / risk_history_sources의 작은 상태 자료 / server.js 상태 감시 → routes/risk_errors.
 * [로드 순서] require만으로 감시하지 않는다. 운영 서버에서 start를 호출한다.
 */
'use strict';
const fs = require('fs'),
    path = require('path'),
    io = require('./risk_collector_io');
const SOURCES = [
    'warnings',
    'gale',
    'zoneForecasts',
    'swell',
    'ripCurrent',
    'congestion',
    'accident',
    'tourConcentration',
    'events',
    'realtime',
    'visibility', // 해구별 시정 예측(RDPS 래스터) — risk_history_sources.visibilitySource
];
const STATES = ['ok', 'offseason', 'missing', 'stale', 'error'],
    BAD = ['missing', 'stale', 'error'];
const STAMP =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;
/** 실제 ISO 시각만 보관한다. 예: URL이나 자유문장은 null. @param {unknown} value @returns {string|null} [연계] ← clean */
function stamp(value) {
    return typeof value === 'string' &&
        STAMP.test(value) &&
        Number.isFinite(Date.parse(value))
        ? value
        : null;
}
/** 고정 원천·월만 허용한다. 예: events_202610→events/2026-10. @param {string} name @param {string} month @returns {object|null} [연계] ← collector/sources */
function identity(name, month) {
    const m = /^events_(\d{4})(\d{2})$/.exec(name);
    if (m) {
        name = 'events';
        month = m[1] + '-' + m[2];
    }
    if (!SOURCES.includes(name)) return null;
    if (name === 'events' && !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month || ''))
        return null;
    return { source: name, scope: name === 'events' ? month : 'global' };
}
/** 파일에 있던 값도 다시 검사하고 비밀·자유 텍스트는 버린다. @param {object} row @returns {object|null} [연계] ← load */
/** 관리자에게 보일 상세 한 줄을 다듬는다. 예: 문자열만, 200자까지. @param {*} v @returns {string|null} [연계] ← clean·update */
function detailText(v) {
    return typeof v === 'string' && v ? v.slice(0, 200) : null;
}
function clean(row) {
    if (
        !row ||
        !identity(row.source, row.scope) ||
        !STATES.includes(row.status) ||
        !stamp(row.firstAt) ||
        !stamp(row.lastAt)
    )
        return null;
    const id = identity(row.source, row.scope),
        out = {
            ...id,
            status: row.status,
            code: BAD.includes(row.status)
                ? row.status === 'error'
                    ? io.errorName({ message: row.code || '' })
                    : row.status
                : null,
            firstAt: row.firstAt,
            lastAt: row.lastAt,
        };
    for (const key of [
        'lastSuccess',
        'updatedAt',
        'createdAt',
        'checkedAt',
        'recoveredAt',
    ])
        out[key] = stamp(row[key]);
    out.detail = detailText(row.detail);
    return out;
}
/** 검사에서는 임시 폴더와 시계를 쓴다. 예: 반복 감시는 한 건 유지. @param {object} options @returns {object} [연계] ← singleton/검사 */
function createHistory({
    dir = io.DEFAULT_DIR,
    clock = Date.now,
    maxRecords = 2000,
    retentionDays = 30,
    maxBytes = 1024 * 1024,
} = {}) {
    const file = path.join(dir, 'error_history.json');
    let timer = null,
        watchGeneration = 0;
    /** 저장 파일의 상한과 형태를 검증한다. @returns {object} [연계] ← list/update */
    function load() {
        if (!fs.existsSync(file))
            return { v: 1, current: {}, events: [], observedAt: null };
        if (fs.statSync(file).size > maxBytes)
            throw Error('history unavailable');
        const data = io.read(file);
        if (
            !data ||
            data.v !== 1 ||
            !data.current ||
            typeof data.current !== 'object' ||
            Array.isArray(data.current) ||
            !Array.isArray(data.events) ||
            data.events.length > maxRecords
        )
            throw Error('history unavailable');
        const current = {};
        for (const row of Object.values(data.current)) {
            const c = clean(row);
            if (!c) throw Error('history unavailable');
            current[c.source + ':' + c.scope] = c;
        }
        if (Object.keys(current).length > 40)
            throw Error('history unavailable');
        const events = data.events.map((row) => {
            const c = clean(row);
            if (!c || !['opened', 'changed', 'recovered'].includes(row.phase))
                throw Error('history unavailable');
            return { ...c, phase: row.phase };
        });
        return { v: 1, current, events, observedAt: stamp(data.observedAt) };
    }
    /** 읽기·변경·쓰기를 기존 공유 잠금으로 보호한다. 실패는 수집 결과를 변경하지 않는다. @param {Array} rows @returns {boolean} [연계] ← observe/recordCollector */
    function update(rows) {
        let release;
        try {
            release = io.acquireLock(file + '.lock');
            if (!release) return false;
            const data = load(),
                now = clock(),
                at = io.iso(now);
            for (const row of rows) {
                const id = identity(row.source, row.scope);
                if (!id || !STATES.includes(row.status)) continue;
                const key = id.source + ':' + id.scope,
                    previous = data.current[key],
                    bad = BAD.includes(row.status),
                    code = bad
                        ? row.status === 'error'
                            ? io.errorName({ message: row.code || '' })
                            : row.status
                        : null;
                const next = {
                    ...id,
                    status: row.status,
                    code,
                    firstAt:
                        previous &&
                        previous.status === row.status &&
                        previous.code === code
                            ? previous.firstAt
                            : at,
                    lastAt: at,
                    lastSuccess:
                        stamp(row.lastSuccess) || previous?.lastSuccess || null,
                    updatedAt:
                        stamp(row.updatedAt) ||
                        stamp(row.collectedAt) ||
                        previous?.updatedAt ||
                        null,
                    createdAt: stamp(row.createdAt),
                    checkedAt: stamp(row.checkedAt),
                    recoveredAt: bad ? null : previous?.recoveredAt || null,
                    detail: detailText(row.detail),
                };
                if (
                    bad &&
                    (!previous ||
                        previous.status !== row.status ||
                        previous.code !== code)
                )
                    data.events.push({
                        ...next,
                        phase:
                            previous && BAD.includes(previous.status)
                                ? 'changed'
                                : 'opened',
                    });
                else if (!bad && previous && BAD.includes(previous.status)) {
                    next.recoveredAt = at;
                    data.events.push({
                        ...next,
                        firstAt: previous.firstAt,
                        phase: 'recovered',
                    });
                }
                data.current[key] = next;
            }
            // 현재 행사 월도 유한하게 유지한다. 과거 월 문제는 보관 기간 안의 이력에서 조회한다.
            const globals = Object.values(data.current).filter(
                    (r) => r.source !== 'events'
                ),
                months = Object.values(data.current)
                    .filter((r) => r.source === 'events')
                    .sort((a, b) => b.scope.localeCompare(a.scope))
                    .slice(0, 4);
            data.current = Object.fromEntries(
                globals.concat(months).map((r) => [r.source + ':' + r.scope, r])
            );
            data.observedAt = at;
            data.events = data.events
                .filter(
                    (e) =>
                        Date.parse(e.lastAt) >= now - retentionDays * 86400000
                )
                .slice(-maxRecords);
            while (
                Buffer.byteLength(JSON.stringify(data)) > maxBytes &&
                data.events.length
            )
                data.events.shift();
            if (Buffer.byteLength(JSON.stringify(data)) > maxBytes)
                return false;
            io.write(file, data);
            return true;
        } catch (_) {
            console.warn('[risk_history] 이력 저장 실패');
            return false;
        } finally {
            if (release) release();
        }
    }
    /** 원천 상태를 이용자 접속과 무관하게 관찰한다. 예: offseason은 정상. @param {object} sources @returns {boolean} [연계] ← timer */
    function observeSources(sources) {
        const rows = [];
        for (const source of SOURCES) {
            const s = sources?.[source];
            if (!s) continue;
            if (source === 'events') {
                for (const [scope, value] of Object.entries(s.months || {}))
                    rows.push({
                        ...value,
                        source,
                        scope,
                        code: value.lastError,
                    });
            } else
                rows.push({ ...s, source, scope: 'global', code: s.lastError });
        }
        return update(rows);
    }
    /** 실제 수집 결과를 월별로 정규화한다. 예: 행사 공통/월 상태파일은 중복 이력 없음. @param {string} name @param {object} status @returns {boolean} [연계] ← io.status */
    function recordCollector(name, status) {
        const id = identity(name, status.month);
        if (!id) return false;
        return update([{ ...status, ...id, code: status.lastError }]);
    }
    /** 관리자에게 최신순 페이지를 준다. 원천·상태 조건은 이력과 현재 상태 둘 다에 건다
     * (2026-10-15 — 이전에는 이력만 걸러 현재 상태 목록이 필터와 무관하게 전부 보였다). 기간 조건은 이력에만.
     * @param {object} filter @returns {object} [연계] ← authenticated route */
    function list({ source, status, page = 1, limit = 30, from, to } = {}) {
        const data = load(),
            current = Object.values(data.current).filter(
                (r) =>
                    (!source || r.source === source) &&
                    (!status || r.status === status)
            ),
            events = data.events
                .filter(
                    (r) =>
                        (!source || r.source === source) &&
                        (!status || r.status === status) &&
                        (!from || Date.parse(r.lastAt) >= Date.parse(from)) &&
                        (!to || Date.parse(r.lastAt) <= Date.parse(to))
                )
                .reverse(),
            total = events.length,
            totalPages = Math.max(1, Math.ceil(total / limit));
        page = Math.min(page, totalPages);
        return {
            ok: true,
            observedAt: data.observedAt,
            current,
            data: events.slice((page - 1) * limit, page * limit),
            pagination: { page, limit, total, totalPages },
        };
    }
    /** 독립 감시를 운영에서만 시작한다. 예: 기존 sources 규칙으로 낡음 경계를 확인. @param {function} readSources @returns {boolean} [연계] ← server.js */
    /** 화면용 큰 저장소 대신 시각·상태만 보관하는 작은 읽기 함수를 사용한다.
     * 첫 관찰은 다음 1분 주기이며 수집기 실패는 io.status 연결로 즉시 기록한다. */
    function start(readSources) {
        if (!process.env.FLY_ALLOC_ID || timer) return false;
        if (!readSources)
            readSources = require('./risk_history_sources').createReader();
        const generation = ++watchGeneration;
        let checking = false;
        const tick = async () => {
            if (checking) return;
            checking = true;
            try {
                const sources =
                    typeof readSources === 'function'
                        ? await readSources(true)
                        : await readSources.sources(true);
                if (generation === watchGeneration) observeSources(sources);
            } catch (_) {
                console.warn('[risk_history] 상태 확인 실패');
            } finally {
                checking = false;
            }
        };
        timer = setInterval(tick, 60000);
        timer.unref();
        return true;
    }
    return {
        observeSources,
        recordCollector,
        list,
        start,
        stop() {
            watchGeneration++;
            if (timer) clearInterval(timer);
            timer = null;
        },
    };
}
module.exports = { ...createHistory(), createHistory, SOURCES, STATES };
