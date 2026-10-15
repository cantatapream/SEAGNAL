/**
 * 파일명: local_server/services/sea_traffic_history.js
 * 역할  : 5분마다 받는 GR4 칸별 척수를 칸·시간마다 「그 1시간 5분 값들의 평균」 한 값으로 묶어 날짜별 압축 파일에
 *         1년 보관하고, 메모리에는 최근 15일치만 둔다(2주 교통량 그래프 + 여유). 조회 API 응답도 여기서 만든다.
 *         사용자 2026-10-15: 「교통량 그래프를 2주 단위로 표출하도록 하자. 그리고 배경에 특보도 표출하고.」
 *         앞선 합의: 칸 번호·날짜·시간·척수만 기록, 1년치는 디스크(Fly 볼륨) 날짜별 파일, 메모리에는 최근분만.
 * [연계] sea_realtime_collector.collect → add() (공식 API v2 의 grid_id·vmtc 만 쓴다, MTIS 웹 수집 없음)
 *        → data/risk_forecast/traffic_history/YYYY-MM-DD.json.gz (완성된 시간) · open.json.gz (진행 중인 1시간 합계)
 *        · routes/risk_forecast.js GET /api/risk-forecast/sea/traffic-history → createApi().query
 *        · warn_zone_cells.zonesOfCell(칸→특보구역) · sea_warning_history.list(특보 발효 구간)
 *        · 설계·응답 형식: client/js/marine-life/risk-forecast/traffic_history.design.md
 * [로드 순서] 서버 require 부작용 없음. 첫 사용(add·조회) 때 디스크에서 최근 15일과 진행 중 합계를 읽는다(재시작 복구).
 */
'use strict';
const fs = require('fs'), path = require('path');
const io = require('./risk_collector_io');
const HOUR = 3600000, DAY = 86400000, KST = 9 * HOUR;
const KEEP_DAYS = 365, MEMORY_DAYS = 15, MAX_TENTHS = 65534;
const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.json\.gz$/;
const DEFINITION = '그 1시간(KST 정시~다음 정시 전) 동안 받은 5분 값(API 등록시각 regDt 기준)의 평균 척수, 소수 첫째 자리. 받지 못한 5분은 0으로 세지 않고 빼고 평균한다.';

/** KST 시각을 1시간 열쇠로 바꾼다. 예: 2026-10-15T06:10:06Z → '2026-10-15T15' @param {number} ms @returns {string} [연계] ← add·flush·series */
function hourKey(ms) { return new Date(ms + KST).toISOString().slice(0, 13); }

/**
 * 한 저장 폴더의 1시간 교통량 이력 저장소를 만든다.
 * 예: const h=createHistory({dir}); h.add({sourceAt:'2026-10-15T15:10:06+09:00',rows:[{id:'GR4_F4K23_P4',count:3}]});
 * @param {object} options - dir(risk_forecast 폴더), clock(시험용 시계 주입)
 * @returns {object} add, flush, series, prune, _memory
 * [연계] ← forDir(수집기·API 가 같은 폴더면 같은 인스턴스) / io.write 로 임시파일→rename 원자 저장
 */
function createHistory({ dir = io.DEFAULT_DIR, clock = Date.now } = {}) {
    const folder = path.join(dir, 'traffic_history'), openFile = path.join(folder, 'open.json.gz');
    const ids = [], index = new Map();           // 칸 번호 ↔ 번호표(메모리 공용)
    const days = new Map();                      // 'YYYY-MM-DD' → Map(시 → {n, idx:Uint32Array, val:Uint16Array(0.1척)})
    let open = null, loaded = false;             // open: {hour, at:[regDt…], cells:Map(id→[합,개수])}

    /** 칸 번호의 번호표를 얻는다(없으면 붙인다). 예: 'GR4_F4K23_P4' → 0 @param {string} id @returns {number} [연계] ← ingestDay·finalize */
    function idOf(id) { let i = index.get(id); if (i === undefined) { i = ids.length; ids.push(id); index.set(id, i); } return i; }
    /** 한 시간의 [번호표, 0.1척] 쌍을 번호표 순 형식 배열로 만든다(이진 탐색용). @param {Array} pairs @param {number} n 5분 표본 수 @returns {object} [연계] ← ingestDay·finalize */
    function packHour(pairs, n) {
        pairs.sort((a, b) => a[0] - b[0]);
        const idx = new Uint32Array(pairs.length), val = new Uint16Array(pairs.length);
        pairs.forEach(([i, v], k) => { idx[k] = i; val[k] = v; });
        return { n, idx, val };
    }
    /** 날짜 파일 내용을 메모리에 올린다. 예: {date,ids,hours:[{h:15,n:12,c:[2.3,null,…]}]} @param {object} data @returns {boolean} 받아들였는지 [연계] ← load·ensureDay */
    function ingestDay(data) {
        if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data.date) || !Array.isArray(data.ids) || !Array.isArray(data.hours)) return false;
        const local = data.ids.map((id) => idOf(String(id))), m = new Map();
        for (const hr of data.hours) {
            if (!Number.isInteger(hr?.h) || hr.h < 0 || hr.h > 23 || !Array.isArray(hr.c)) continue;
            const pairs = [];
            hr.c.forEach((v, j) => { if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && j < local.length) pairs.push([local[j], Math.min(MAX_TENTHS, Math.round(v * 10))]); });
            m.set(hr.h, packHour(pairs, Number.isInteger(hr.n) ? hr.n : 0));
        }
        days.set(data.date, m);
        return true;
    }
    /** 그 날짜가 메모리에 없으면 파일에서 올린다(없으면 빈 날). @param {string} date @returns {Map} [연계] ← finalize */
    function ensureDay(date) {
        if (!days.has(date) && !ingestDay(io.read(path.join(folder, date + '.json.gz')))) days.set(date, new Map());
        return days.get(date);
    }
    /** 첫 사용 때 최근 15일 파일과 진행 중 합계를 읽는다(재시작 복구). @returns {void} [연계] ← add·flush·series */
    function load() {
        if (loaded) return; loaded = true;
        const now = clock();
        for (let k = MEMORY_DAYS - 1; k >= 0; k--) ingestDay(io.read(path.join(folder, io.day(now - k * DAY) + '.json.gz')));
        const o = io.read(openFile);
        if (o && /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(o.hour) && Array.isArray(o.at) && Array.isArray(o.cells))
            open = { hour: o.hour, at: o.at.map(String), cells: new Map(o.cells.filter((c) => Array.isArray(c) && c.length === 3).map(([id, s, n]) => [String(id), [Number(s), Number(n)]])) };
    }
    /** 메모리의 한 날짜를 파일로 쓴다(그날 나온 칸 합집합 + 시간별 같은 순서 배열, 없음=null). @param {string} date @returns {void} [연계] ← finalize */
    function writeDay(date) {
        const m = days.get(date), used = new Set();
        for (const r of m.values()) for (const i of r.idx) used.add(i);
        const order = [...used].sort((a, b) => a - b), pos = new Map(order.map((i, k) => [i, k]));
        const hours = [...m.keys()].sort((a, b) => a - b).map((h) => {
            const r = m.get(h), c = new Array(order.length).fill(null);
            r.idx.forEach((i, k) => { c[pos.get(i)] = r.val[k] / 10; });
            return { h, n: r.n, c };
        });
        io.write(path.join(folder, date + '.json.gz'), { v: 1, date, unit: '척', definition: DEFINITION, ids: order.map((i) => ids[i]), hours });
    }
    /** 진행 중이던 1시간을 평균으로 확정해 날짜 파일에 쓰고 합계 파일을 지운다. @returns {void} [연계] ← add(다음 시간 값이 오면)·flush(시계가 그 시간을 지나면) */
    function finalize() {
        const o = open; open = null;
        const date = o.hour.slice(0, 10), h = Number(o.hour.slice(11, 13)), m = ensureDay(date);
        if (!m.has(h) && o.at.length) {
            const pairs = [];
            for (const [id, [s, n]] of o.cells) if (n > 0 && Number.isFinite(s)) pairs.push([idOf(id), Math.min(MAX_TENTHS, Math.round(s / n * 10))]);
            m.set(h, packHour(pairs, o.at.length));
            writeDay(date);
        }
        try { fs.unlinkSync(openFile); } catch (_) { /* 이미 없음 */ }
        prune();
    }
    /**
     * 메모리는 최근 15일, 디스크는 365일 넘은 날짜 파일을 지운다. 예: 오늘 2026-10-15 → 2025-10-14 이전 파일 삭제
     * @returns {string[]} 지운 파일 이름 [연계] ← finalize(1시간에 한 번)
     */
    function prune() {
        const now = clock(), keepMem = io.day(now - (MEMORY_DAYS - 1) * DAY), keepDisk = io.day(now - KEEP_DAYS * DAY), removed = [];
        for (const d of [...days.keys()]) if (d < keepMem) days.delete(d);
        let names = [];
        try { names = fs.readdirSync(folder); } catch (_) { return removed; }
        for (const f of names) { const m = DAY_FILE.exec(f); if (m && m[1] < keepDisk) { try { fs.unlinkSync(path.join(folder, f)); removed.push(f); } catch (_) { /* 다음 정리 때 다시 */ } } }
        return removed;
    }
    /**
     * 5분 수집 한 벌을 그 시간 합계에 더한다. 같은 등록시각은 한 번만, 이미 확정된 시간·지난 시간은 무시한다.
     * 예: add({sourceAt:'2026-10-15T15:10:06+09:00', rows:[{id:'GR4_F4K23_P4',count:3}]}) → {ok:true,hour:'2026-10-15T15'}
     * @param {object} sample - sourceAt(KST ISO, API regDt), rows([{id,count}]) @returns {object} 결과
     * [연계] ← sea_realtime_collector.collect(정상 저장 직후) / 시간이 바뀌면 finalize
     */
    function add({ sourceAt, rows }) {
        load();
        const t = Date.parse(sourceAt);
        if (!Number.isFinite(t) || !Array.isArray(rows)) return { ok: false, reason: 'invalid sample' };
        const key = hourKey(t);
        if (open && key < open.hour) return { ok: false, reason: 'older hour' };
        if (open && key > open.hour) finalize();
        if (days.get(key.slice(0, 10))?.has(Number(key.slice(11, 13)))) return { ok: false, reason: 'hour already closed' };
        if (!open) open = { hour: key, at: [], cells: new Map() };
        if (open.at.includes(sourceAt)) return { ok: true, duplicate: true, hour: key };
        open.at.push(sourceAt);
        for (const r of rows) {
            if (!r || typeof r.id !== 'string' || !Number.isFinite(r.count) || r.count < 0) continue;
            const c = open.cells.get(r.id);
            if (c) { c[0] += r.count; c[1]++; } else open.cells.set(r.id, [r.count, 1]);
        }
        io.write(openFile, { v: 1, hour: open.hour, at: open.at, cells: [...open.cells].map(([id, [s, n]]) => [id, s, n]) });
        return { ok: true, hour: key, samples: open.at.length };
    }
    /** 시계가 진행 중 시간을 지났으면 확정한다(수집이 멈춰도 마지막 시간이 열린 채 남지 않게). @returns {void} [연계] ← series / 조회 때 */
    function flush() { load(); if (open && hourKey(clock()) > open.hour) finalize(); }
    /**
     * 한 칸의 1시간 척수를 시작 시각부터 hours 개 꺼낸다(메모리 15일 안). 예: series('GR4_…', t0, 336) → {values:[2.3,null,…], samples:[12,0,…]}
     * @param {string} id - 칸 번호 @param {number} from - 시작 정시(ms) @param {number} hours - 개수
     * @returns {object} values(척, 없으면 null)·samples(그 시간 5분 표본 수 — 0이면 수집 자체가 없던 시간)
     * [연계] ← createApi.query
     */
    function series(id, from, hours) {
        flush();
        const i = index.get(id), values = [], samples = [];
        for (let k = 0; k < hours; k++) {
            const key = hourKey(from + k * HOUR), r = days.get(key.slice(0, 10))?.get(Number(key.slice(11, 13)));
            samples.push(r ? r.n : 0);
            let v = null;
            if (r && i !== undefined) { let lo = 0, hi = r.idx.length - 1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (r.idx[mid] === i) { v = r.val[mid] / 10; break; } if (r.idx[mid] < i) lo = mid + 1; else hi = mid - 1; } }
            values.push(v);
        }
        return { values, samples };
    }
    /** 시험·실측용: 메모리에 든 날짜 목록과 진행 중 시간. @returns {object} [연계] ← test_traffic_history·measure_traffic_history */
    function _memory() { load(); return { days: [...days.keys()].sort(), open: open && { hour: open.hour, samples: open.at.length }, cells: ids.length }; }
    return { add, flush, series, prune: () => { load(); return prune(); }, _memory };
}

const instances = new Map();
/** 폴더마다 하나의 저장소를 돌려준다(수집기와 API 가 같은 메모리를 쓰게). 예: forDir(io.DEFAULT_DIR) @param {string} dir @returns {object} [연계] ← sea_realtime_collector·createApi */
function forDir(dir = io.DEFAULT_DIR) { if (!instances.has(dir)) instances.set(dir, createHistory({ dir })); return instances.get(dir); }

/**
 * 조회 API 본체를 만든다: 한 칸의 최근 N일(KST 달력일, 오늘 포함) 1시간 척수 + 그 칸이 든 특보구역들의 같은 기간 특보 구간.
 * 예: createApi().query({cell:'GR4_F4K23_P4',days:'14'}) → {cell, days:14, start, hours:336, traffic:{values,samples}, zones, warnings}
 * @param {object} options - history·warnings·zonesOfCell·clock 주입(시험용) @returns {object} query
 * [연계] ← routes/risk_forecast.js / → series · warn_zone_cells.zonesOfCell · sea_warning_history.list
 */
function createApi({ history, warnings, zonesOfCell, clock = Date.now } = {}) {
    /** 요청을 검사하고 응답을 만든다. 잘못된 칸·기간은 status 400. @param {object} q - cell, days @returns {object} [연계] ← GET /api/risk-forecast/sea/traffic-history */
    function query(q = {}) {
        const bad = (m) => Object.assign(new Error(m), { status: 400 });
        const cell = typeof q.cell === 'string' ? q.cell : '';
        const zones = (zonesOfCell || require('./warn_zone_cells').zonesOfCell)(cell);
        if (!zones) throw bad('GR4 칸 번호 필요(예: GR4_F4K23_P4)');
        const days = q.days === undefined ? 14 : Number(q.days);
        if (!Number.isInteger(days) || days < 1 || days > MEMORY_DAYS) throw bad('days 는 1~' + MEMORY_DAYS + ' 정수');
        const now = clock(), start = Date.parse(io.day(now - (days - 1) * DAY) + 'T00:00:00+09:00'), hours = days * 24, end = start + hours * HOUR;
        const traffic = (history || forDir()).series(cell, start, hours);
        const list = [zones.main, zones.sub].filter(Boolean);
        const w = (warnings || require('./sea_warning_history').forDir()).list({ zones: list.map((z) => z.name), from: start, to: Math.min(end, now) });
        return {
            cell, center: zones.center, days, start: io.iso(start), end: io.iso(end), stepMinutes: 60, hours, asOf: io.iso(now),
            traffic: { definition: DEFINITION, currentHour: hourKey(now) + ':00', values: traffic.values, samples: traffic.samples },
            zones: { main: zones.main && { name: zones.main.name, code: zones.main.code, kind: zones.main.kind }, sub: zones.sub && { name: zones.sub.name, code: zones.sub.code, kind: zones.sub.kind } },
            warnings: w.intervals, warningsCheckedAt: w.checkedAt
        };
    }
    return { query };
}

module.exports = { createHistory, forDir, createApi, hourKey, DEFINITION, KEEP_DAYS, MEMORY_DAYS };
