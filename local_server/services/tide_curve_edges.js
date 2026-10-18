/**
 * ============================================================================
 * 파일명: services/tide_curve_edges.js
 * 역할: 앵커 조위 곡선(하루치 파일)의 새벽·밤 가장자리 빈칸을 메운다 — 세 앵커 수집기 공용
 * ============================================================================
 *
 * [왜 필요한가 — 초보자용]
 *   TideBED 는 날짜 D 를 물으면 "기준 관측소 시각(obsrvnDt) 00:00~23:59" 1440줄을 준다.
 *   우리가 쓰는 그 지점의 시각(slctdDt)은 거기에 조시차(josi)를 더한 값이라, 예컨대 한림
 *   「+1시간6분」이면 slctdDt 가 D 01:06 ~ D+1 01:05 가 된다(사용자가 공공데이터포털
 *   미리보기로 확인 — 첫 줄 obsrvnDt 00:00 / slctdDt 01:06 / josi "+1시간6분").
 *   수집기는 slctdDt 가 D 인 줄만 남겼으므로 **D 00:00~01:05 가 늘 비었고**, 같은 요청에
 *   들어 있던 D+1 00:00~01:05(꼬리)는 버렸다. 빈 새벽은 다른 기준점 값만으로 채워져
 *   곡선이 01:00 에 뚝 떨어졌다(운영 id=410: 00:50 179.2 → 01:00 161).
 *   조시차가 음수인 지점이면 반대로 그날 밤 끝이 빈다.
 *
 * [어떻게 메우나 — API 호출을 늘리지 않는 쪽 우선]
 *   ① 버리던 꼬리를 파일에 남긴다: 곡선 파일에 spill = { "YYYYMMDD": [{t,h}] } (옆날 몫, 하루 66줄 안팎).
 *   ② 날짜 D 를 저장할 때 옆날 파일(D-1·D+1)의 spill[D] 를 가져와 빈 분을 채운다(호출 0회).
 *      매일 밤 새로 받는 날은 "모레" 하나뿐이고, 그 전날("내일") 파일은 전날 밤 이미 받아 두었으므로
 *      조시차가 양수인 지점은 평소 호출이 늘지 않는다.
 *   ③ 그래도 EDGE_TOL_MIN 분보다 길게 비면 옆날 요청의 해당 쪽 한 페이지만 받는다(1회):
 *      앞이 비면 D-1 의 5페이지(obsrvnDt 20:00~23:59 → slctdDt 가 D 새벽), 뒤가 비면 D+1 의 1페이지.
 *      — 처음 기동해 전날 파일이 없을 때, 조시차가 음수인 지점의 밤 끝, 옛 파일(spill 없음) 고칠 때.
 *   ④ 하루치(5페이지·1300분 이상)는 이미 받아 둔 파일인데 가장자리만 빈 경우엔 하루치를
 *      다시 받지 않고(5~6회 절약) 가장자리만 ②·③으로 메운다(reusableOwnDay).
 *
 * [완전 판정] 예전: 5페이지·실패 0·1300분 이상. → 지금: 거기에 더해 **처음 분 ≤ 00:15 이고
 *   마지막 분 ≥ 23:44** (EDGE_TOL_MIN=15). 1300분 기준만으로는 앞쪽 66분이 비어도 "완전"이라
 *   다시 받지 않았다. 15분은 곡선을 읽는 쪽(etaCmAt)이 앞뒤 ±15분 안의 값으로 메우는 폭과 같다.
 *
 * [연계]
 *   - services/tide_field_collector.js          → collectOne 이 이 모듈로 하루치 곡선을 만든다(서해·남해)
 *   - services/hazard_rocks_tide_collector.js   → 같음(제주 간출암 17앵커)
 *   - services/jeju_isolation_tide_collector.js → 같음(제주 고립판정 격자)
 *   - services/hazard_rocks_submersion.js·routes/tide_field.js·scripts/precompute_tide_field.js
 *       → 저장된 curve 만 읽는다(spill 은 안 읽음 — 읽는 쪽은 바꾸지 않았다)
 *   - scripts/test_tide_edges.js → 이 모듈 시험
 * ============================================================================
 */

'use strict';

const fs = require('fs');

/** 하루 곡선 앞뒤에 이만큼(분)까지 비어 있는 것은 허용 — etaCmAt(±15분 보간)이 메우는 폭과 같다. */
const EDGE_TOL_MIN = 15;
/** 하루치를 받았다고 보는 최소 분 수 — 세 수집기가 쓰던 기준 그대로. */
const MIN_DAY_POINTS = 1300;
/** 옆날 요청에서 가장자리를 담은 페이지(numOfRows=300 기준). 앞 빈칸 = 전날 5페이지, 뒤 빈칸 = 다음날 1페이지. */
const HEAD_FROM_PREV_PAGE = 5;
const TAIL_FROM_NEXT_PAGE = 1;

/**
 * YYYYMMDD 정수에 delta 일을 더한다.
 * 예: addDays(20261031, 1) → 20261101
 * @param {number} ymd @param {number} delta @returns {number}
 * [연계] ← fillEdges(옆날 파일·옆날 요청 날짜)
 */
function addDays(ymd, delta) {
    const s = String(ymd);
    const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8) + delta));
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

/** "HH:MM" → 분(0~1439). 형식이 아니면 NaN. */
function minuteOf(t) {
    const s = String(t);
    return parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(3, 5), 10);
}

/**
 * TideBED 응답 줄을 slctdDt 날짜별로 나눈다 — 그날 몫은 곡선, 옆날(±1일) 몫은 spill.
 * 예: D 요청(josi +66분) → curve = D 01:06~23:59(1374분), spill = { D+1: 00:00~01:05(66분) }
 * @param {Array<Object>} items - TideBED item 배열(slctdDt·slctdHgt, 없으면 obsrvnDt·obsrvnHgt)
 * @param {number} ymd - 그날(YYYYMMDD)
 * @returns {{curve:Array<{t:string,h:number}>, spill:Object<string,Array<{t:string,h:number}>>}} 시각순, 같은 분은 하나만
 * [연계] ← 세 수집기 collectOne(그날 몫) · fillEdges(옆날 한 페이지에서 그날 몫만 고를 때)
 */
function splitByDay(items, ymd) {
    const byDay = new Map();   // ymd → Map(t → h)
    const near = new Set([addDays(ymd, -1), ymd, addDays(ymd, 1)]);
    for (const it of items || []) {
        const dt = String((it && (it.slctdDt || it.obsrvnDt)) || '');
        const m = dt.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
        if (!m) continue;
        const h = parseFloat(it.slctdHgt != null ? it.slctdHgt : it.obsrvnHgt);
        if (isNaN(h)) continue;
        const d = +(m[1] + m[2] + m[3]);
        if (!near.has(d)) continue;
        if (!byDay.has(d)) byDay.set(d, new Map());
        const day = byDay.get(d);
        if (!day.has(`${m[4]}:${m[5]}`)) day.set(`${m[4]}:${m[5]}`, h);
    }
    const toList = (mp) => [...(mp || new Map()).entries()].map(([t, h]) => ({ t, h })).sort((a, b) => a.t.localeCompare(b.t));
    const spill = {};
    for (const [d, mp] of byDay) if (d !== ymd) spill[String(d)] = toList(mp);
    return { curve: toList(byDay.get(ymd)), spill };
}

/**
 * 곡선 앞뒤가 얼마나 비었나(분).
 * 예: 01:06~23:59 → {head:66, tail:0} · 빈 곡선 → {head:1440, tail:1440}
 * @param {Array<{t:string}>} curve - 시각순 곡선 @returns {{head:number, tail:number}}
 * [연계] ← fillEdges(메울지 판단) · edgesOk(완전 판정)
 */
function edgeGaps(curve) {
    if (!Array.isArray(curve) || !curve.length) return { head: 1440, tail: 1440 };
    return { head: minuteOf(curve[0].t), tail: 1439 - minuteOf(curve[curve.length - 1].t) };
}

/** 앞뒤 빈칸이 둘 다 EDGE_TOL_MIN 이하인가. */
function edgesOk(curve) {
    const g = edgeGaps(curve);
    return g.head <= EDGE_TOL_MIN && g.tail <= EDGE_TOL_MIN;
}

/** curve 에 없는 분만 extra 에서 더해 시각순으로 돌려준다(있는 값은 덮지 않는다). */
function mergeMissing(curve, extra) {
    const have = new Set((curve || []).map(p => p.t));
    const add = (extra || []).filter(p => p && p.h != null && !have.has(p.t));
    if (!add.length) return curve;
    return curve.concat(add).sort((a, b) => a.t.localeCompare(b.t));
}

/**
 * 하루치가 "완전"한가 — 5페이지·실패 0·1300분 이상 + 앞뒤 빈칸 15분 이하.
 * 예: 옛 파일(01:06~23:59, complete) → false(앞 66분 빔) · 메운 파일(00:00~23:59) → true
 * @param {Object} j - 곡선 파일 내용 @returns {boolean}
 * [연계] ← 세 수집기 isComplete(다시 받을지) · collectOne(status 정할 때 — j.status 없이 부름)
 */
function isFullDay(j) {
    if (!j) return false;
    const lp = Array.isArray(j.loadedPages) ? j.loadedPages.length : 0;
    const fp = Array.isArray(j.failedPages) ? j.failedPages.length : 0;
    return lp >= 5 && fp === 0 && Array.isArray(j.curve) && j.curve.length >= MIN_DAY_POINTS && edgesOk(j.curve);
}

/**
 * 이미 하루치(5페이지·1300분 이상)를 받아 둔 파일이면 그 곡선을 돌려준다 — 가장자리만 메우면 되므로 하루치를 다시 받지 않는다.
 * 예: 옛 파일(complete, 01:06~23:59, spill 없음) → {curve, spill:{}, loadedPages, failedPages, peaks, nudgedTo}
 * @param {Object|null} j - 기존 곡선 파일 내용(없으면 null)
 * @returns {Object|null} 다시 쓸 수 있으면 그 내용, 아니면 null(하루치를 새로 받아야 함)
 * [연계] ← 세 수집기 collectOne 첫머리
 */
function reusableOwnDay(j) {
    if (!j || j.status === 'no_grid' || !Array.isArray(j.curve)) return null;
    const lp = Array.isArray(j.loadedPages) ? j.loadedPages.length : 0;
    const fp = Array.isArray(j.failedPages) ? j.failedPages.length : 0;
    if (lp < 5 || fp !== 0 || j.curve.length < MIN_DAY_POINTS) return null;
    return { curve: j.curve, spill: j.spill || {}, loadedPages: j.loadedPages, failedPages: j.failedPages, peaks: j.peaks, nudgedTo: j.nudgedTo };
}

/** 곡선 파일을 읽는다(없거나 깨졌으면 null). */
function readJson(p) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

/**
 * 그날 곡선의 새벽·밤 빈칸을 메운다 — 먼저 옆날 파일의 spill(호출 0회), 그래도 15분 넘게 비면 옆날 한 페이지(1회).
 * 예: 한림(josi +66) D 곡선 01:06~ → 전날 파일 spill[D] 로 00:00~01:05 채움 → 00:00~23:59
 * @param {Array<{t:string,h:number}>} curve - 그날 몫 곡선(시각순)
 * @param {number} ymd - 그날(YYYYMMDD)
 * @param {{readNeighbor:function(number):Object|null, fetchPage:function(number, number):Promise<Array|null>}} io
 *   readNeighbor(옆날 ymd) → 그 앵커의 옆날 곡선 파일 내용 · fetchPage(요청 날짜, 페이지) → TideBED item 배열
 * @returns {Promise<{curve:Array<{t:string,h:number}>, fromSpill:number, fetched:number}>}
 *   fromSpill = 옆날 파일에서 채운 분 수, fetched = 옆날 페이지를 받은 횟수(0~2)
 * [연계] ← 세 수집기 collectOne → splitByDay(받은 한 페이지에서 그날 몫만)
 */
async function fillEdges(curve, ymd, io) {
    let out = curve || [];
    const before = out.length;
    for (const d of [-1, 1]) {
        const nb = io.readNeighbor(addDays(ymd, d));
        if (nb && nb.spill && Array.isArray(nb.spill[String(ymd)])) out = mergeMissing(out, nb.spill[String(ymd)]);
    }
    const fromSpill = out.length - before;
    let fetched = 0;
    const plan = [
        { gap: 'head', reqYmd: addDays(ymd, -1), page: HEAD_FROM_PREV_PAGE },
        { gap: 'tail', reqYmd: addDays(ymd, 1), page: TAIL_FROM_NEXT_PAGE }
    ];
    for (const p of plan) {
        if (edgeGaps(out)[p.gap] <= EDGE_TOL_MIN) continue;
        let items = null;
        try { items = await io.fetchPage(p.reqYmd, p.page); }
        catch (e) {
            // 조용히 넘기지 않는다 — 빈칸은 그대로 남고 "완전" 아님으로 저장돼 다음 수집 때 다시 시도된다.
            console.warn(`[조석 곡선] ${ymd} ${p.gap === 'head' ? '새벽' : '밤 끝'} 빈칸 메우기 실패(옆날 ${p.reqYmd} ${p.page}페이지):`, e && e.message);
            items = null;
        }
        fetched++;
        if (Array.isArray(items) && items.length) out = mergeMissing(out, splitByDay(items, ymd).curve);
    }
    return { curve: out, fromSpill, fetched };
}

module.exports = {
    EDGE_TOL_MIN, MIN_DAY_POINTS, HEAD_FROM_PREV_PAGE, TAIL_FROM_NEXT_PAGE,
    addDays, splitByDay, edgeGaps, edgesOk, mergeMissing, isFullDay, reusableOwnDay, readJson, fillEdges
};
