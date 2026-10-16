/**
 * 역할: 위험예측 자료의 오류·누락·낡음·일부 실패·복구를 비밀 없이 유한 이력으로 보관한다.
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
    'stationBriefing', // 활동지점 안전 브리핑 생성(우리 서버) — station_briefing.historyRow(실행 실패·낡음·AI 총평 대신 틀), 2026-10-16 결정 6
];
// partial(일부 실패): 수집은 성공해 자료는 쓰이지만 일부가 빠졌다 — 지금은 행사 수집에서 실패한 부분이 있을 때뿐이다
//   (사용자 2026-10-15 「공식 행사는 저장해놔야지. 그리고 우리 앱에 저장실패했다는 내용을 알려야하겠지?」). 원천 상태 파일은 ok 로 두고
//   (risk_store 는 error 인 달의 행사를 쓰지 않는다) failedProvinceCount>0 인 ok 행만 여기서 partial 로 바꾼다 — statusOf.
//   failedProvinceCount 는 이름과 달리 「실패한 부분 수」다: Gemini·카카오로 실패한 시도 수 + 공식 목록(TourAPI·공식 행사 위치 연결) 실패면 1(2026-10-15 D7).
// partial 의 분류(code)는 수집기가 상태 파일 partialCode 로 원인을 준다(3차 검토 F5 — 종전엔 늘 「Gemini 일부 실패」라 원인이 바뀌어도 사건이 안 남았다).
//   자유 텍스트를 받지 않도록 아래 고정 이름만 받는다. 「Gemini 일부 실패」는 이 변경 전 이력 파일에 남아 있는 옛 이름이라 읽기만 허용한다.
const STATES = ['ok', 'offseason', 'partial', 'missing', 'stale', 'error'],
    BAD = ['partial', 'missing', 'stale', 'error'],
    PARTIAL_DEFAULT = '행사 일부 실패',
    PARTIAL_CODES = [
        PARTIAL_DEFAULT,
        'Gemini 일부 실패',
        ...['Gemini', '카카오', '공식 목록', 'Gemini·카카오', 'Gemini·공식 목록', '카카오·공식 목록', 'Gemini·카카오·공식 목록'].map(
            (c) => PARTIAL_DEFAULT + ' — ' + c
        ),
        // 활동지점 안전 브리핑: AI 방식인데 일부 관할이 틀 총평으로 대체됨(station_briefing.HISTORY_PARTIAL_CODE 와 같은 글자 — 2026-10-16 결정 6)
        '브리핑 일부 실패 — AI 총평 대신 틀',
    ],
    // 1분 감시가 더 보지 않는 지난 달 행사의 문제 상태를 닫을 때의 상세(3차 검토 F2). 닫힌 달은 offseason(수집하지 않는 기간)으로 바뀐다.
    PAST_MONTH_NOTE = '지난 달 — 더 수집하지 않음';
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
/** 수집 결과 행의 이력 상태를 정한다. 예: {status:'ok',failedProvinceCount:2} → partial, 그 밖은 그대로.
 * @param {object} row - 수집기 상태(recordCollector) 또는 관찰 행(observeSources) @returns {string}
 * [연계] ← update / 수집기(coastal_events_collector)가 상태 파일에 남긴 숫자 — 관찰 경로는 risk_store 월 상태로 같은 숫자가 온다.
 */
function statusOf(row) {
    return row.status === 'ok' && Number(row.failedProvinceCount) > 0
        ? 'partial'
        : row.status;
}
/** 문제 상태의 고정 분류. 예: error → io.errorName, partial → raw 가 PARTIAL_CODES 면 그것(예 '행사 일부 실패 — 카카오'), 아니면 '행사 일부 실패', stale → 'stale', ok → null.
 * @param {string} status @param {string} raw - 원천 lastError(partial 이면 수집기 partialCode) @returns {string|null} [연계] ← clean·update
 */
function codeOf(status, raw) {
    if (!BAD.includes(status)) return null;
    if (status === 'error') return io.errorName({ message: raw || '' });
    if (status === 'partial')
        return PARTIAL_CODES.includes(raw) ? raw : PARTIAL_DEFAULT;
    return status;
}
/** 관리자에게 보일 상세 한 줄을 다듬는다. 예: 문자열만, 200자까지. @param {*} v @returns {string|null} [연계] ← clean·update */
function detailText(v) {
    return typeof v === 'string' && v ? v.slice(0, 200) : null;
}
/** 파일에 있던 값도 다시 검사하고 비밀·자유 텍스트는 버린다. @param {object} row @returns {object|null} [연계] ← load */
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
            code: codeOf(row.status, row.code),
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
    /** 읽기·변경·쓰기를 기존 공유 잠금으로 보호한다. 실패는 수집 결과를 변경하지 않는다.
     * @param {Array} rows @param {string} [closeBefore] - 이 달(YYYY-MM)보다 앞선 행사 달을 현재 목록에서 닫는다(observeSources 만 준다)
     * @returns {boolean} [연계] ← observe/recordCollector */
    function update(rows, closeBefore) {
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
                const status = statusOf(row),
                    key = id.source + ':' + id.scope,
                    previous = data.current[key],
                    bad = BAD.includes(status),
                    // partial 분류는 수집기 partialCode. 그 칸이 없는 행(옛 상태 파일 등)은 앞 partial 분류를 잇는다 — 감시가 분류를 바꿔 가짜 「문제 변경」을 만들지 않게.
                    code = codeOf(
                        status,
                        status === 'partial'
                            ? PARTIAL_CODES.includes(row.partialCode)
                                ? row.partialCode
                                : previous?.status === 'partial'
                                  ? previous.code
                                  : null
                            : row.code
                    );
                const next = {
                    ...id,
                    status,
                    code,
                    firstAt:
                        previous &&
                        previous.status === status &&
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
                    // 행 자체에 detail 칸이 없으면(예: risk_store 의 행사 월 상태 — 1분마다 관찰) 수집기가 남긴 상세를 지우지 않는다(2026-10-15).
                    detail:
                        row.detail === undefined
                            ? previous?.detail || null
                            : detailText(row.detail),
                };
                if (
                    bad &&
                    (!previous ||
                        previous.status !== status ||
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
            // 지난 달 닫기(3차 검토 F2): 1분 감시가 보는 행사 달(오늘·다음 날들의 달)보다 앞선 달은 수집기도 더 수집하지 않는다(tick 은 당월·다음 달만).
            //   그 달에 남은 문제 상태(일부 실패·실패·없음·낡음)는 아무도 갱신하지 않아 현재 목록에 약 3개월(최근 4개 달 상한) 고정됐다.
            //   → offseason(수집하지 않는 기간, 문제 아님)으로 바꾸고 기존 의미 체계대로 문제가 끝난 사건(recovered)을 남긴 뒤 현재 목록에서 뺀다.
            //   관리자 화면은 recovered+offseason 을 「수집 종료」로 보인다(admin.js). 원래 문제는 opened/changed 사건으로 이력에 남는다.
            if (closeBefore)
                for (const [key, r] of Object.entries(data.current)) {
                    if (r.source !== 'events' || r.scope >= closeBefore) continue;
                    if (BAD.includes(r.status))
                        data.events.push({
                            ...r,
                            status: 'offseason',
                            code: null,
                            lastAt: at,
                            recoveredAt: at,
                            detail: detailText(
                                PAST_MONTH_NOTE + '(마지막 상태: ' + (r.code || r.status) + ')'
                            ),
                            phase: 'recovered',
                        });
                    delete data.current[key];
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
        // 감시가 보는 가장 이른 행사 달(그리고 지금 KST 달을 넘지 않게) — 그보다 앞선 달은 닫는다(update). 행사 달 목록이 없으면 닫지 않는다.
        //   예: 11-01 감시 months {2026-11} → 2026-10 이하를 닫는다. 감시 달이 다음 달뿐이어도 지금 달은 닫지 않는다.
        const watched = Object.keys(sources?.events?.months || {})
                .filter((m) => /^\d{4}-(?:0[1-9]|1[0-2])$/.test(m))
                .sort(),
            nowMonth = io.iso(clock()).slice(0, 7),
            closeBefore = watched.length
                ? watched[0] < nowMonth
                    ? watched[0]
                    : nowMonth
                : null;
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
        return update(rows, closeBefore);
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
