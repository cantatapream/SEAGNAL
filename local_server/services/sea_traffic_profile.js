/**
 * ============================================================================
 * 파일명: local_server/services/sea_traffic_profile.js
 * 역할  : 관할 브리핑의 해역마다 「최근 14일 선박 동향」(하루 평균 N척 · 가장 많은 3시간대 평균 N척)을 계산한다.
 *         30분 척수 이력(sea_traffic_history)에서 해역 안 실시간 칸의 척수를 더하고, 해상 풍랑·태풍 주의보·경보가
 *         발효 중이던 30분은 빼고, 3시간 묶음마다 쓸 수 있는 날 14일을 어제부터 최대 42일 전까지 거슬러 모은다.
 *         사용자(브리핑 선박 동향 대화): 「나도 카드별 한줄로 사용하고자 하는거야.」 「12일 이상 값이 있는 경우 기준 좋아. 특보 뺴고 좋아.」
 *         「가로 하자. 이름표 짚은 방식 좋아. 그냥 최근 14일로 하자., 그리고 평균 1척 미만으로 가자.」
 *         「그 시간만 빼야하겠고, 예비특보는 빼지말아.」 「육상특보는 넣지마.」 — 규칙 전문은 traffic_history.design.md 「브리핑 해역별 최근 14일 동향」
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/sea_traffic_history.js(dayRows — 날짜별 30분 척수, 메모리 15일·디스크 365일)
 *                    · services/sea_warning_history.js(list — 특보 발효 구간) · services/warn_zone_cells.js(zoneKey — 구역 이름 표기 차이 흡수)
 *                    · services/risk_geo.js(pointInGeometry) · data/risk_forecast/sea_realtime.json.gz(실시간 칸 위치표 — sea_realtime_collector 가 씀)
 *  - 서버 API      : 없음(1단계 — 계산만. 브리핑 연결은 2단계)
 *  - 나를 쓰는 곳  : scripts/test_sea_traffic_profile.js (2단계에서 station_briefing_inputs.collectSea 가 profiles 를 부를 예정)
 * [로드 순서] 서버 require 부작용 없음. 첫 profiles 호출 때 칸 위치표·특보 구간·필요한 날짜만 읽는다.
 * ============================================================================
 */
'use strict';
const path = require('path');
const io = require('./risk_collector_io'), G = require('./risk_geo');
const { zoneKey } = require('./warn_zone_cells');
const DAY = 86400000, SLOT = 30 * 60000, BLOCKS = 8, PER_BLOCK = 6, SLOTS = 48;
const WANT_DAYS = 14, MAX_BACK = 42, MIN_USABLE = 3;          // 묶음마다 유효한 날 14개 · 어제부터 42일 전까지 · 30분 6칸 중 3칸 이상
const MIN_DAILY_TENTHS = 10, PEAK_MIN_TENTHS = 70;            // 하루 평균 1.0척 미만 숨김 · 최다 묶음 7.0척 이상(0.1척 단위 정수로 판정)
const WARN_TYPES = new Set(['풍랑', '태풍']), WARN_LEVELS = new Set(['주의보', '경보']);
const MAX_TENTHS = 65535;                                     // 해역 한 30분 합계 상한(6,553.5척 — 전국 실시간 총수가 약 8천 척이라 한 해역이 닿지 않는다)

/** 도형의 경위도 상자. 예: 사각형 Polygon → [서,남,동,북] @param {object} g - Polygon·MultiPolygon @returns {number[]} [연계] ← membersOf */
function bounds(g) { const a = g.coordinates.flat(Infinity), xs = a.filter((_, i) => i % 2 === 0), ys = a.filter((_, i) => i % 2 === 1); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
/** 칸 번호 목록의 짧은 지문(FNV-1a 32비트). 칸 묶음이 바뀌면 날짜별 합계를 다시 낸다. 예: ['GR4_A','GR4_B'] → 1234567 @param {string[]} ids @returns {number} [연계] ← membersOf */
function signature(ids) { let h = 0x811c9dc5; for (const ch of ids.join(',')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h; }
/** 3시간 묶음 이름표. 예: 2 → {from:'06',to:'09'} @param {number} b - 0~7 @returns {object} [연계] ← finish */
function blockName(b) { return { from: String(b * 3).padStart(2, '0'), to: String(b * 3 + 3).padStart(2, '0') }; }

/**
 * 해역별 최근 14일 동향 계산기를 만든다(입력은 모두 주입 — 시험에서 가짜 자료·시계를 넣는다).
 * 예: const p=createProfile({cells,readDay,warnings,clock}); p.profiles([{key:'A:123',geometry,zones:['제주도북부앞바다']}])
 *     → Map{'A:123' → {days:14, oldest:'2026-10-03', dailyAvg:5.2, blocks:[8개], peak:{from:'06',to:'09',avg:12.4}|null, cells:12} | null}
 * @param {object} o - cells(()→[{id,lon,lat}] 실시간 칸 위치표) · readDay((date)→sea_traffic_history.dayRows 꼴|null)
 *                     · warnings(({zones,from,to})→{intervals} — sea_warning_history.list 꼴) · clock(()→ms)
 * @returns {object} profiles, _stats
 * [연계] ← forDir(운영 기본 연결) · test_sea_traffic_profile / → readDay·warnings·cells
 */
function createProfile({ cells, readDay, warnings, clock = Date.now }) {
    let today = null, index = null, reads = 0;
    const members = new Map(), results = new Map();
    const dayCache = new Map();   // 'YYYY-MM-DD' → {n:Uint8Array(48) 그 30분 5분 표본 수, sums:Map(해역 키 → {sig, v:Uint16Array(48) 해역 칸 척수 합 0.1척})}

    /** 날짜(KST)가 바뀌었으면 그날 결과·칸 묶음을 비우고, 42일보다 오래된 날짜 합계를 버린다. @returns {void} [연계] ← profiles */
    function roll() {
        const d = io.day(clock());
        if (d === today) return;
        today = d; index = null; members.clear(); results.clear();
        const oldest = io.day(clock() - MAX_BACK * DAY);
        for (const k of [...dayCache.keys()]) if (k < oldest) dayCache.delete(k);
    }
    /** 실시간 칸 위치표를 0.1도 칸으로 나눠 둔다(하루 한 번). 표가 비면 null — 다음 호출에서 다시 읽는다. @returns {Map|null} [연계] ← membersOf */
    function cellIndex() {
        if (index) return index;
        const map = new Map();
        for (const c of cells() || []) {
            if (!c || typeof c.id !== 'string' || !c.id.startsWith('GR4_') || !Number.isFinite(c.lon) || !Number.isFinite(c.lat)) continue;
            const k = Math.floor(c.lon * 10) + ',' + Math.floor(c.lat * 10);
            if (!map.has(k)) map.set(k, []); map.get(k).push(c);
        }
        return map.size ? (index = map) : null;
    }
    /**
     * 해역 도형에 중심이 드는 실시간 칸 전부(하루 한 번 셈). 예: 공식 사고 5km 칸 → 약 30~40칸 · 먼바다(위치표에 칸 없음) → []
     * @param {object} r - {key, geometry} @param {Map} idx - cellIndex @returns {object} {ids, sig}
     * [연계] ← profiles / 혼잡 예보 칸 목록만 쓰면 배의 약 20%가 빠진다는 실측(설계 문서) 때문에 위치표 전체에서 찾는다
     */
    function membersOf(r, idx) {
        if (members.has(r.key)) return members.get(r.key);
        const ids = [];
        if (r.geometry && Array.isArray(r.geometry.coordinates)) {
            const b = bounds(r.geometry);
            for (let x = Math.floor(b[0] * 10); x <= Math.floor(b[2] * 10); x++) for (let y = Math.floor(b[1] * 10); y <= Math.floor(b[3] * 10); y++)
                for (const c of idx.get(x + ',' + y) || []) if (c.lon >= b[0] && c.lon <= b[2] && c.lat >= b[1] && c.lat <= b[3] && G.pointInGeometry([c.lon, c.lat], r.geometry)) ids.push(c.id);
        }
        ids.sort();
        const m = { ids, sig: signature(ids) };
        members.set(r.key, m);
        return m;
    }
    /**
     * 한 날짜의 30분별 해역 척수 합을 준다. 이미 셈한 해역은 재사용하고, 처음 보는 해역(또는 칸 묶음이 바뀐 해역)이 있을 때만 그날 기록을 읽는다.
     * 예: sumsFor('2026-10-10', 상태목록) → {n:[6,6,…], sums:Map{'A:123' → {sig, v:[41,38,…]}}} (v 는 0.1척, 응답에 칸 없음 = 0)
     * @param {string} date @param {object[]} list - profiles 의 해역 상태 @returns {object}
     * [연계] ← profiles / → readDay(sea_traffic_history.dayRows — 메모리 15일, 그 밖은 디스크) — 「한 번 읽은 날은 재사용」
     */
    function sumsFor(date, list) {
        let e = dayCache.get(date);
        if (!e) { e = { n: new Uint8Array(SLOTS), sums: new Map() }; dayCache.set(date, e); }
        const miss = list.filter((x) => e.sums.get(x.r.key)?.sig !== x.m.sig);
        if (!miss.length) return e;
        const byCell = new Map();
        for (const x of miss) {
            const v = new Uint16Array(SLOTS);
            e.sums.set(x.r.key, { sig: x.m.sig, v });
            for (const id of x.m.ids) { if (!byCell.has(id)) byCell.set(id, []); byCell.get(id).push(v); }
        }
        const raw = readDay(date); reads++;
        if (raw && Array.isArray(raw.slots)) {
            const local = raw.ids.map((id) => byCell.get(id) || null);
            for (const sl of raw.slots) {
                e.n[sl.s] = Math.min(255, sl.n);
                for (let j = 0; j < sl.idx.length; j++) { const t = local[sl.idx[j]]; if (t) for (const v of t) v[sl.s] = Math.min(MAX_TENTHS, v[sl.s] + sl.tenths[j]); }
            }
        }
        return e;
    }
    /**
     * 모은 14일로 결과를 만든다. 판정은 화면에 보일 0.1척 반올림 값으로 한다(보이는 숫자와 규칙이 어긋나지 않게).
     * 예: 묶음 평균 [2,2,12.4,…] → {dailyAvg:5.2, peak:{from:'06',to:'09',avg:12.4}} · 한 묶음이라도 14일 미달·하루 평균 1.0 미만·칸 0개 → null
     * @param {object} x - 해역 상태 @returns {object|null} [연계] ← profiles
     */
    function finish(x) {
        if (!x.m.ids.length || x.n.some((c) => c < WANT_DAYS)) return null;
        const avg = x.total.map((t) => t / WANT_DAYS), dailyT = Math.round(avg.reduce((a, b) => a + b, 0) / BLOCKS * 10);
        if (dailyT < MIN_DAILY_TENTHS) return null;
        const tenths = avg.map((a) => Math.round(a * 10));
        let top = 0; tenths.forEach((t, b) => { if (t > tenths[top]) top = b; });            // 동률이면 이른 시각
        const blocks = tenths.map((t, b) => ({ ...blockName(b), avg: t / 10 }));
        const peak = tenths[top] >= PEAK_MIN_TENTHS && tenths[top] * 2 >= dailyT * 3 ? { ...blocks[top] } : null;
        return { days: WANT_DAYS, oldest: x.oldest.reduce((a, d) => (d < a ? d : a)), dailyAvg: dailyT / 10, blocks, peak, cells: x.m.ids.length };
    }
    /**
     * 해역들의 최근 14일 동향을 준다(그날 처음 묻는 해역만 계산하고, 나머지는 그날 캐시).
     * - 해역 30분 값 = 해역 칸 척수 합(응답 받은 30분에 칸이 없으면 0, 수집 실패 30분(n=0)은 뺌)
     * - 쓸 수 있는 30분 = 수집됨 그리고 해역 특보구역(zones)에 해상 풍랑·태풍 주의보·경보가 그 30분과 겹치지 않음(예비·육상특보는 빼지 않는다)
     * - 하루·묶음 값 = 쓸 수 있는 30분 평균, 6칸 중 3칸 미만이면 그날 그 묶음 무효 → 묶음마다 유효한 날 14개를 어제부터 42일 전까지
     * 예: profiles([{key:'A:123',geometry,zones:['제주도북부앞바다','…연안바다']}]) → Map{'A:123' → 결과|null}
     * @param {object[]} regions - {key(해역 열쇠 — collectSea 의 rid), geometry(경위도 Polygon — 사고 칸 도형, 사고 칸 없는 교통 묶음은 그 ±0.0125도 상자), zones(특보구역 이름들)}
     * @returns {Map} 해역 키 → 결과|null
     * [연계] ← (2단계) station_briefing_inputs.collectSea / → membersOf·sumsFor·warnings·finish
     */
    function profiles(regions) {
        roll();
        const out = new Map(), todo = [];
        for (const r of regions || []) { if (results.has(r.key)) out.set(r.key, results.get(r.key)); else todo.push(r); }
        if (!todo.length) return out;
        const idx = cellIndex();
        if (!idx) { for (const r of todo) out.set(r.key, null); return out; }      // 위치표가 아직 없음 — 캐시하지 않고 다음 호출에서 다시
        const now = clock(), from = Date.parse(io.day(now - MAX_BACK * DAY) + 'T00:00:00+09:00');
        const names = [...new Set(todo.flatMap((r) => r.zones || []))];
        const intervals = (names.length ? warnings({ zones: names, from, to: now }).intervals || [] : [])
            .filter((w) => WARN_TYPES.has(w.type) && WARN_LEVELS.has(w.level))
            .map((w) => ({ key: zoneKey(w.zone), start: Date.parse(w.start), end: w.end === null ? Infinity : Date.parse(w.end) }));
        const st = todo.map((r) => {
            const keys = new Set((r.zones || []).map(zoneKey));
            return { r, m: membersOf(r, idx), ivs: intervals.filter((w) => keys.has(w.key)), n: new Array(BLOCKS).fill(0), total: new Array(BLOCKS).fill(0), oldest: new Array(BLOCKS).fill(null) };
        });
        const live = st.filter((x) => x.m.ids.length);
        for (let k = 1; k <= MAX_BACK; k++) {
            const active = live.filter((x) => x.n.some((c) => c < WANT_DAYS));
            if (!active.length) break;                                            // 필요한 날짜만 읽는다
            const date = io.day(now - k * DAY), base = Date.parse(date + 'T00:00:00+09:00'), e = sumsFor(date, active);
            for (const x of active) {
                const v = e.sums.get(x.r.key).v, ivs = x.ivs.filter((w) => w.start < base + DAY && w.end > base);
                for (let b = 0; b < BLOCKS; b++) {
                    if (x.n[b] >= WANT_DAYS) continue;
                    let sum = 0, cnt = 0;
                    for (let s = b * PER_BLOCK; s < (b + 1) * PER_BLOCK; s++) {
                        const t0 = base + s * SLOT;
                        if (!e.n[s] || ivs.some((w) => w.start < t0 + SLOT && w.end > t0)) continue;
                        sum += v[s]; cnt++;
                    }
                    if (cnt < MIN_USABLE) continue;
                    x.n[b]++; x.total[b] += sum / cnt / 10; x.oldest[b] = date;
                }
            }
        }
        for (const x of st) { const res = finish(x); results.set(x.r.key, res); out.set(x.r.key, res); }
        return out;
    }
    /** 시험·실측용: 날짜 기록 읽은 횟수·캐시한 날짜 수·그날 결과 수. @returns {object} [연계] ← test_sea_traffic_profile */
    function _stats() { return { reads, cachedDays: dayCache.size, results: results.size }; }
    return { profiles, _stats };
}

const instances = new Map();
/**
 * 폴더마다 하나의 계산기(운영 연결): 칸 위치표 = sea_realtime.json.gz 의 cells, 기록 = sea_traffic_history.forDir(dir).dayRows,
 * 특보 = sea_warning_history.forDir(dir).list. 예: forDir().profiles(regions)
 * @param {string} dir @returns {object} [연계] ← (2단계) 브리핑 수집 / 수집기·조회 API 와 같은 이력 인스턴스를 쓴다(forDir)
 */
function forDir(dir = io.DEFAULT_DIR) {
    if (!instances.has(dir)) instances.set(dir, createProfile({
        cells: () => io.read(path.join(dir, 'sea_realtime.json.gz'))?.cells || [],
        readDay: (date) => require('./sea_traffic_history').forDir(dir).dayRows(date),
        warnings: (q) => require('./sea_warning_history').forDir(dir).list(q)
    }));
    return instances.get(dir);
}

module.exports = { createProfile, forDir, WANT_DAYS, MAX_BACK };
