/**
 * ============================================================================
 * 파일명: local_server/services/data_collection_status.js
 * 역할  : 데이터 목록표(config/data_collection_manifest.json)의 한 줄마다 「공식 갱신 · 우리 수집 시각 ·
 *         지금 반영된 자료의 기준 시각 · 다음 기대 시각 · 상태」를 실제 상태 파일·오류현황에서 읽어 만든다.
 *         관리자 → 점검 → 데이터 수집현황 → 「수집 목록」 화면이 이 결과를 그대로 그린다.
 *         읽을 곳이 없으면 지어내지 않고 null(화면 「기록 없음」)로 둔다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/risk_history_sources.readMetadata(큰 JSON·gzip 의 최상위 칸만 흘려 읽기)
 *                    services/risk_error_history(위험예측 원천의 현재 상태 — 오류현황과 같은 판정)
 *                    scheduler.js getStatus(이미 불러온 경우만 — require 하면 수집이 시작되므로 직접 부르지 않는다)
 *                    services/collect_fail_alert.records(이안류·MMIS 수집 실패 기록 — data/collect_fail_alert.json)
 *  - 서버 API      : routes/data_collection.js GET /api/admin/data-collection
 *  - 마크업        : 없음
 *  - 나를 쓰는 곳  : routes/data_collection.js · 검사 local_server/scripts/test_data_collection_status.js
 * [로드 순서] require 부작용 없음. 파일은 list() 호출 때만 읽는다(파일 서명이 같으면 다시 파싱하지 않음).
 * ============================================================================
 */
'use strict';
const fs = require('fs'),
    path = require('path');
const { readMetadata } = require('./risk_history_sources');

const ROOT = path.join(__dirname, '..', '..'),
    DEFAULT_MANIFEST = path.join(__dirname, '..', 'config', 'data_collection_manifest.json'),
    DEFAULT_DATA = path.join(__dirname, '..', 'data'),
    HOUR = 3600000,
    DAY = 24 * HOUR,
    KST = 9 * HOUR;
// 상태 판정 순서: 화면 배지 색과 같은 뜻. 오래됨(노랑)은 「다음 기대 시각이 지났는데 새 자료가 없다」.
const STATES = ['ok', 'offseason', 'partial', 'stale', 'missing', 'error'];

/** ms → KST ISO. 예: 0 → '1970-01-01T09:00:00+09:00'. @param {number} ms @returns {string|null} */
function isoKst(ms) {
    return Number.isFinite(ms) ? new Date(ms + KST).toISOString().slice(0, 19) + '+09:00' : null;
}

/**
 * 파일에 적힌 시각을 형식에 맞춰 ms 로 바꾼다. 형식을 모르거나 어긋나면 NaN(지어내지 않는다).
 * 예: parseTime('2026. 10. 15. 오후 9:30:12','koLocale') → 2026-10-15T21:30:12+09:00
 *     parseTime('2026101512','utcYmdh') → 2026-10-15T21:00+09:00 · parseTime('2026.09.09 21:00','kstDot') → KST 21시
 * @param {*} v - 파일 값 @param {string} format - iso|epochMs|koLocale|utcYmdh|kstDot|raw
 * @returns {number} ms 또는 NaN
 * [연계] ← itemStatus(수집 시각·기준 시각) — scheduler.js 는 toLocaleString('ko-KR') 문자열을 쓴다(getNowStr)
 */
function parseTime(v, format) {
    if (format === 'epochMs') return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
    if (typeof v !== 'string') return NaN;
    if (format === 'iso') return /^\d{4}-\d{2}-\d{2}T/.test(v) ? Date.parse(v) : NaN;
    if (format === 'utcYmdh') {
        const m = /^(\d{4})(\d{2})(\d{2})(\d{2})$/.exec(v);
        return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4]) : NaN;
    }
    if (format === 'kstDot') {
        const m = /^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2})$/.exec(v);
        return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - KST : NaN;
    }
    if (format === 'koLocale') {
        // 실제 파일에 「오전/오후」와 「AM/PM」 두 꼴이 다 있다(로케일 자료 차이). 24시간 꼴도 받아 준다.
        const m = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(?:(오전|오후|AM|PM)\s*)?(\d{1,2}):(\d{2}):(\d{2})$/.exec(v.trim());
        if (!m) return NaN;
        let h = +m[5];
        if (m[4]) {
            if (h > 12) return NaN;
            const pm = m[4] === '오후' || m[4] === 'PM';
            h = (h % 12) + (pm ? 12 : 0);
        }
        return Date.UTC(+m[1], +m[2] - 1, +m[3], h, +m[6], +m[7]) - KST;
    }
    return NaN;
}

/**
 * 일정표에서 기준 시각 다음(또는 같거나 다음)의 첫 수집 회차를 구한다. 정할 수 없으면 null.
 * 예: nextRun({times:['09:30','21:30']}, 10-15 09:31 KST) → 10-15 21:30 KST
 *     nextRun({minutes:[5,35]}, 12:06) → 12:35 · nextRun({everyMinutes:5}, 12:06) → 12:10
 * @param {object} s - manifest 의 schedule @param {number} after - 기준 ms @param {boolean} [inclusive] - 같은 시각도 인정
 * @returns {number|null}
 * [연계] ← nextExpected
 */
function nextRun(s, after, inclusive = false) {
    if (!Number.isFinite(after)) return null;
    const ok = (t) => (inclusive ? t >= after : t > after);
    if (s.everyMinutes) {
        const step = s.everyMinutes * 60000;
        let t = Math.ceil(after / step) * step;
        if (!ok(t)) t += step;
        return t;
    }
    if (s.intervalMinutes) return after + s.intervalMinutes * 60000;
    if (Array.isArray(s.minutes) && s.minutes.length) {
        const start = Math.floor(after / HOUR) * HOUR,
            mins = [...s.minutes].sort((a, b) => a - b);
        for (let h = 0; h <= 1; h++)
            for (const m of mins) {
                const t = start + h * HOUR + m * 60000;
                if (ok(t)) return t;
            }
        return null;
    }
    if (Array.isArray(s.times) && s.times.length) {
        const dayStart = Math.floor((after + KST) / DAY) * DAY - KST,
            mins = s.times.map((hm) => +hm.slice(0, 2) * 60 + +hm.slice(3, 5)).sort((a, b) => a - b);
        for (let d = 0; d <= 2; d++)
            for (const m of mins) {
                const t = dayStart + d * DAY + m * 60000;
                if (ok(t)) return t;
            }
    }
    return null;
}

/**
 * 「다음 기대 시각」을 정한다 — 이 시각(+여유)이 지났는데 새 자료가 없으면 오래됨이다.
 * 예: 해구 예보 판 00UTC(09시 KST)·주기 12시간 → 21시 이후 첫 회차 21:30 KST.
 *     하루 1번(oncePerDay) 혼잡예보를 10-15 04:00 에 받았으면 → 10-16 04:00.
 * @param {object} s - schedule @param {object} st - state @param {{collectedAt:number, checkedAt:number, basisAt:number, now:number}} t
 * @returns {{at:number|null, from:string}} from: 무엇을 기준으로 셌나(화면 설명용)
 * [연계] ← itemStatus
 */
function nextExpected(s, st, t) {
    const from = s.nextFrom || 'collected';
    if (from === 'none') return { at: null, from: 'none' };
    if (from === 'checked' && Number.isFinite(t.checkedAt))
        return { at: nextRun(s, t.checkedAt), from: 'checked' };
    if (st.basisCycleHours && Number.isFinite(t.basisAt))
        return { at: nextRun(s, t.basisAt + st.basisCycleHours * HOUR, true), from: 'basis' };
    // 받은 기록이 없으면 일정표상 지금 다음 회차만 알려 준다(이것으로 오래됨을 판정하지는 않는다 — 상태는 「자료 없음」).
    if (!Number.isFinite(t.collectedAt)) return { at: Number.isFinite(t.now) ? nextRun(s, t.now) : null, from: 'schedule' };
    if (s.oncePerDay) {
        const nextDay = Math.floor((t.collectedAt + KST) / DAY) * DAY - KST + DAY;
        return { at: nextRun(s, nextDay, true), from: 'collected' };
    }
    return { at: nextRun(s, t.collectedAt), from: 'collected' };
}

/**
 * 근거 한 건을 화면용으로 푼다. 파일 근거는 quote 를 찾아 지금 줄 번호를 센다(줄이 밀려도 낡지 않게).
 * 예: {file:'local_server/scheduler.js', quote:"if (min === 3 …"} → {ref:'local_server/scheduler.js:2618', quote}
 * @param {object} e - {file,quote}|{url}|{note} @param {Map} cache - 파일 내용 캐시 @param {string} root
 * @returns {object}
 * [연계] ← list / 검사가 모든 quote 가 실제로 있는지 따로 확인한다(test_data_collection_status)
 */
function resolveRef(e, cache, root) {
    if (!e || typeof e !== 'object') return null;
    if (e.url) return { url: String(e.url) };
    if (e.note) return { note: String(e.note) };
    if (!e.file || !e.quote) return null;
    if (!cache.has(e.file)) {
        let text = null;
        try {
            text = fs.readFileSync(path.join(root, e.file), 'utf8');
        } catch (_) {
            /* 파일이 없으면 줄 번호 없이 경로만 낸다 */
        }
        cache.set(e.file, text);
    }
    const text = cache.get(e.file),
        i = text ? text.indexOf(e.quote) : -1;
    if (i < 0) return { ref: e.file, quote: e.quote, missing: true };
    return { ref: e.file + ':' + (text.slice(0, i).split('\n').length), quote: e.quote };
}

/**
 * 수집현황 계산기를 만든다. 검사에서는 임시 폴더·고정 시계·가짜 오류현황을 넣는다.
 * @param {object} [o]
 * @param {string} [o.manifestFile] @param {string} [o.dataDir] @param {string} [o.root] - 근거 파일 기준 폴더(저장소 뿌리)
 * @param {function} [o.clock] - ms @param {function} [o.riskCurrent] - () => 오류현황 current 행 배열
 * @param {function} [o.schedulerStatus] - () => scheduler.getStatus() 결과 또는 null
 * @param {function} [o.collectFails] - () => collect_fail_alert.records() 결과(항목 id → {streak, since, reason, pushError, pushErrorAt})
 * @returns {{list: function(): Promise<object>}}
 * [연계] ← routes/data_collection.js(운영 기본값) / 검사
 */
function createStatus({
    manifestFile = DEFAULT_MANIFEST,
    dataDir = DEFAULT_DATA,
    root = ROOT,
    clock = Date.now,
    riskCurrent = defaultRiskCurrent,
    schedulerStatus = defaultSchedulerStatus,
    collectFails = defaultCollectFails,
} = {}) {
    const metaCache = new Map(),
        refCache = new Map();

    /** 큰 파일도 최상위 칸만 읽는다. 같은 서명(mtime·크기·inode)이면 다시 파싱하지 않는다. */
    async function readFields(rel, fields) {
        const file = path.join(dataDir, rel),
            key = file + '|' + fields.join(',');
        let st;
        try {
            st = fs.statSync(file);
        } catch (_) {
            metaCache.delete(key);
            return null;
        }
        const sig = [st.mtimeMs, st.size, st.ino].join(':'),
            hit = metaCache.get(key);
        if (hit && hit.sig === sig) return hit.data;
        const data = await readMetadata(file, new Set(fields));
        metaCache.set(key, { sig, data });
        return data;
    }

    /** 목록표 한 줄의 현재 상태를 만든다. [연계] ← list */
    async function itemStatus(item, rows, sched, now, fails) {
        const st = item.state || {},
            s = item.schedule || {},
            month = isoKst(now).slice(0, 7).replace('-', ''),
            rel = st.file ? st.file.replace('{month}', month) : null,
            fields = [st.collectedField, st.basisField].filter(Boolean),
            meta = rel && fields.length ? await readFields(rel, fields) : null,
            details = [],
            stateFrom = [];
        if (rel) stateFrom.push('data/' + rel + (fields.length ? ' (' + fields.join('·') + ')' : ''));
        let row = null;
        if (st.risk) {
            const mine = rows.filter((r) => r && r.source === st.risk),
                scope = isoKst(now).slice(0, 7);
            row = mine.find((r) => r.scope === 'global' || r.scope === scope) || mine.sort((a, b) => String(b.scope).localeCompare(String(a.scope)))[0] || null;
            stateFrom.push('오류현황 원천 ' + st.risk + (row ? '' : ' (기록 없음)'));
        }
        let collectedAt = meta ? parseTime(meta[st.collectedField], st.collectedFormat) : NaN;
        if (!Number.isFinite(collectedAt) && row) collectedAt = Date.parse(row.updatedAt || row.lastSuccess);
        const basisRaw = meta && st.basisField ? meta[st.basisField] : null,
            basisAt = st.basisField ? parseTime(basisRaw, st.basisFormat) : NaN;
        let checkedAt = NaN;
        if (st.checkedFile) {
            const c = await readFields(st.checkedFile, [st.checkedField]);
            checkedAt = c ? Date.parse(c[st.checkedField]) : NaN;
            stateFrom.push('data/' + st.checkedFile + ' (' + st.checkedField + ')');
        } else if (row && row.checkedAt) checkedAt = Date.parse(row.checkedAt);
        if (st.statusFile) {
            const f = await readFields(st.statusFile, ['message', 'failStreak', 'lastRun']);
            if (f && typeof f.message === 'string') details.push(f.message);
            else if (f && Number.isInteger(f.failStreak) && f.failStreak > 0) details.push('연속 확인 실패 ' + f.failStreak + '회');
            if (st.statusFile !== st.checkedFile) stateFrom.push('data/' + st.statusFile);
        }
        const next = nextExpected(s, st, { collectedAt, checkedAt, basisAt, now }),
            grace = (item.graceMinutes || 30) * 60000,
            overdue = next.at !== null && next.from !== 'schedule' && now > next.at + grace;
        let status, reason;
        if (row && STATES.includes(row.status)) {
            status = row.status;
            reason = '오류현황 판정';
            if (row.code && row.code !== row.status) details.push('분류 ' + row.code);
            if (row.detail) details.push(row.detail);
        } else {
            status = Number.isFinite(collectedAt) ? 'ok' : 'missing';
            reason = Number.isFinite(collectedAt) ? '수집 시각 기록' : '읽을 수 있는 수집 기록 없음';
        }
        if (overdue && ['ok', 'offseason', 'partial'].includes(status)) {
            status = 'stale';
            reason = '다음 기대 시각(' + isoKst(next.at).slice(5, 16).replace('T', ' ') + ' KST)이 지났는데 새 ' + (next.from === 'basis' ? '판이' : next.from === 'checked' ? '확인이' : '자료가') + ' 없음';
        }
        const run = st.scheduler && sched ? sched[st.scheduler] : null;
        if (run && run.status === '실패') {
            details.push('마지막 시도 실패: ' + String(run.message || '').slice(0, 120));
            if (status === 'stale' || status === 'missing') {
                status = 'error';
                reason = '마지막 시도 실패 + 새 자료 없음';
            }
        }
        if (st.scheduler) stateFrom.push('scheduler.getStatus().' + st.scheduler + (sched ? '' : ' (이 프로세스에 수집기 없음)'));
        // 이안류·MMIS 수집 실패 기록(재기동에도 남는다, services/collect_fail_alert). statusFile 이 있는 항목(시정 예측)은 그 파일이
        //   이미 「연속 확인 실패 N회」를 보이고 오류현황이 3회 기준으로 판정하므로 실패 한 줄·판정은 겹쳐 하지 않는다.
        //   ★연속 실패 중(1회 이상)이면 파일 시각과 무관하게 빨강(검토 3, 2026-10-15): 이안류는 전 지점 호출이 실패해도
        //   수집기가 새 시각으로 파일을 써서(정보없음 13곳) 시각만 보면 정상으로 남았다. 모든 기록 대상 항목에 같게 적용한다.
        const cf = fails ? fails[item.id] : null;
        if (cf && !st.statusFile && cf.streak > 0) {
            details.push('마지막 수집 실패: ' + (cf.reason || '기타 오류') + ' (연속 ' + cf.streak + '회' +
                (cf.since ? ', ' + isoKst(Date.parse(cf.since)).slice(5, 16).replace('T', ' ') + ' KST부터' : '') + ')');
            status = 'error';
            reason = '수집 실패 중(연속 ' + cf.streak + '회)';
        }
        // 관리자 푸시가 전달되지 않았으면(기기 없음·발송 오류·개발 환경) 한 줄 — 시정 예측 포함 모든 항목(검토 4).
        if (cf && cf.pushError)
            details.push('관리자 푸시 미전달: ' + cf.pushError + (cf.pushErrorAt ? ' (' + isoKst(Date.parse(cf.pushErrorAt)).slice(5, 16).replace('T', ' ') + ' KST)' : ''));
        if (cf && ((!st.statusFile && cf.streak > 0) || cf.pushError)) stateFrom.push('data/collect_fail_alert.json');
        const off = item.official || {};
        return {
            id: item.id,
            stage: item.stage,
            name: item.name,
            provider: item.provider,
            endpoint: item.endpoint || null,
            official: {
                kind: off.kind || null,
                text: off.kind ? off.text : '확인 필요',
                evidence: (off.evidence || []).map((e) => resolveRef(e, refCache, root)).filter(Boolean),
                reference: (off.reference || []).map((e) => resolveRef(e, refCache, root)).filter(Boolean),
            },
            schedule: {
                text: s.text || null,
                evidence: (s.evidence || []).map((e) => resolveRef(e, refCache, root)).filter(Boolean),
            },
            collectedAt: isoKst(collectedAt),
            checkedAt: isoKst(checkedAt),
            basis: {
                label: st.basisLabel || (st.basisField ? '판' : null),
                at: isoKst(basisAt),
                raw: basisRaw === null || basisRaw === undefined ? null : String(basisRaw).slice(0, 40),
            },
            nextExpectedAt: isoKst(next.at),
            nextFrom: next.from,
            nextNote: next.at === null ? s.nextNote || null : null,
            status,
            reason,
            detail: details.length ? details.join(' · ').slice(0, 300) : null,
            stateFrom,
        };
    }

    /**
     * 목록표 전체의 현재 상태를 만든다.
     * 예: { ok:true, now:'…+09:00', providers:[…], counts:{items:28, stage1:11, stage2:17, needCheck:18}, items:[…] }
     * @returns {Promise<object>}
     * [연계] ← routes/data_collection.js
     */
    async function list() {
        const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')),
            now = clock();
        let rows = [],
            sched = null;
        try {
            rows = (await riskCurrent()) || [];
        } catch (_) {
            // 오류현황 파일이 손상돼도 목록 자체는 보여 준다 — 위험예측 카드는 파일에서 읽은 시각만으로 판정된다.
            console.warn('[data_collection] 오류현황 현재 상태를 읽지 못함 — 위험예측 원천은 파일 시각만으로 판정');
            rows = [];
        }
        try {
            sched = schedulerStatus() || null;
        } catch (_) {
            console.warn('[data_collection] scheduler 상태를 읽지 못함 — 2단계 실패 판정 없이 시각만 본다');
            sched = null;
        }
        let fails = null;
        try {
            fails = collectFails() || null;
        } catch (_) {
            console.warn('[data_collection] 수집 실패 기록을 읽지 못함 — 이안류·MMIS 실패 한 줄 없이 시각만 본다');
            fails = null;
        }
        const items = [];
        for (const item of manifest.items) items.push(await itemStatus(item, rows, sched, now, fails));
        return {
            ok: true,
            now: isoKst(now),
            providers: manifest.providers,
            counts: {
                items: items.length,
                stage1: items.filter((i) => i.stage === 1).length,
                stage2: items.filter((i) => i.stage === 2).length,
                needCheck: items.filter((i) => !i.official.kind).length,
            },
            items,
        };
    }
    return { list };
}

/** 운영 기본: 위험예측 오류현황의 현재 상태(1분 감시 결과)를 그대로 쓴다. [연계] → risk_error_history.list */
function defaultRiskCurrent() {
    return require('./risk_error_history').list({ page: 1, limit: 1 }).current;
}
/** 이안류·MMIS 수집 실패 기록(파일). require 부작용 없음. [연계] → collect_fail_alert.records */
function defaultCollectFails() {
    return require('./collect_fail_alert').records();
}
/** scheduler.js 를 이미 다른 곳(routes/weather.js)이 불러온 경우만 상태를 읽는다 — 여기서 require 하면 수집이 시작된다. */
function defaultSchedulerStatus() {
    const loaded = require.cache[require.resolve('../scheduler')];
    return loaded && typeof loaded.exports.getStatus === 'function' ? loaded.exports.getStatus() : null;
}

module.exports = { createStatus, parseTime, nextRun, nextExpected, resolveRef, isoKst, STATES };
