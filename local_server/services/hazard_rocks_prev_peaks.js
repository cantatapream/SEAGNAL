/**
 * ============================================================================
 * 파일명: services/hazard_rocks_prev_peaks.js
 * 역할: 간출암 조석 곡선 팝업이 쓰는 "어제 극값" 요약 저장·조회
 * ============================================================================
 *
 * [무엇을 위한 모듈인가 — 초보자용]
 *   간출암 마커를 누르면 뜨는 조석 팝업 아래쪽 "조석" 카드는 고조·저조 옆에
 *   "직전 물때보다 몇 cm 변했나"(▲+155 / ▼−187)를 적는다. 그런데 **그날 시간순
 *   첫 물때**의 변화량은 "어제 마지막 물때"와 비교해야 나온다.
 *   앵커(조위 참조지점) 곡선 파일은 "오늘~모레" 3일치만 보관하고 어제 것은
 *   매일 밤 수집 직후 지우기 때문에(tide_field_collector.purgeStaleCurves 등),
 *   지금까지 "오늘" 화면에서는 첫 물때 변화량이 늘 빈칸이었다.
 *
 *   그래서 **곡선 전체(앵커·하루당 약 33KB)를 하루 더 보관하는 대신, 그날의
 *   극값만(앵커·하루당 수백 바이트) 따로 요약해 남긴다.** 다음 날 그 요약을
 *   읽으면 "어제 마지막 물때"를 알 수 있다. (사용자 확정 2026-09-09)
 *
 * [저장 형태]
 *   data/hazard_rocks/prev_peaks/<집합>_<YYYYMMDD>.json
 *     집합: 'tf'(서해·남해 = 물빠짐 앵커) · 'hr'(제주 = 간출암 전용 앵커)
 *     내용: { date, generated_at, peaks: { <앵커id>: [{t:"HH:MM", cm, type}] } }
 *   ⚠집합별로 파일을 나눈 이유: 두 수집기가 같은 파일에 쓰면 경합 위험이 있다
 *     (CLAUDE.md 병렬 작업 안전 규칙). 나눠 두면 각자 자기 파일만 쓴다.
 *
 * [동해는 이 모듈을 쓰지 않는다]
 *   동해는 앵커 곡선을 수집하지 않고 연간 조석표(client/tide_data)로 그 자리에서
 *   계산하므로, 어제 극값도 저장 없이 바로 구할 수 있다
 *   (hazard_rocks_submersion.js 의 stationExtremaOfDay).
 *
 * [연계]
 *   - services/tide_field_collector.js      → 수집 직후 capture() 호출(서해·남해)
 *   - services/hazard_rocks_tide_collector.js → 수집 직후 capture() 호출(제주)
 *   - services/hazard_rocks_submersion.js   → getTideCurve 가 load() 로 어제 극값 조회
 *   - scripts/test_hazard_rocks_tide.js     → 이 모듈의 왕복 저장·정리 검사
 *   - peak_finder.js                        → findPeaksInSamples(극값 규칙 — 팝업 오늘 극값과 같은 함수, 2026-10-18)
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');
const HRC = require('./hazard_rocks_tide_common');

/** 요약 파일이 쌓이는 디렉토리. */
const PREV_PEAKS_DIR = path.join(HRC.HAZARD_ROCKS_TIDE_DIR, 'prev_peaks');
/** 며칠치를 남길지 — 어제 하나만 있으면 되지만, 수집이 하루 걸러 실패해도
 *  버틸 수 있게 여유를 둔다(하루치가 수백 KB 이하라 부담이 없다). */
const KEEP_DAYS = 5;
/** 곡선을 이 간격(분)으로 훑어 극값을 찾는다 — 팝업이 오늘 곡선을 만들 때와 같은 값.
 *  [연계] hazard_rocks_submersion.js CURVE_SAMPLE_STEP_MIN 과 반드시 같아야 한다. */
const SAMPLE_STEP_MIN = 10;
// 극값을 고르는 규칙은 peak_finder.findPeaksInSamples 하나를 팝업(오늘 극값)과 같이 쓴다(2026-10-18 —
//   예전엔 이 파일과 hazard_rocks_submersion.js 가 같은 "평탄 구간을 모르는" 복사본을 따로 가졌다).
const { findPeaksInSamples } = require('../peak_finder');

/**
 * 요약 파일 경로를 만든다.
 * 예: filePath('tf', 20260908) → ".../prev_peaks/tf_20260908.json"
 * @param {string} setId - 앵커 집합 id ('tf' | 'hr')
 * @param {number|string} ymd - 날짜(YYYYMMDD)
 * @returns {string} 파일 경로
 * [연계] ← capture()/load()/prune() 전부 이 함수로 경로를 만든다.
 */
function filePath(setId, ymd) {
    return path.join(PREV_PEAKS_DIR, `${setId}_${ymd}.json`);
}

/**
 * 1분 간격 곡선 배열을 SAMPLE_STEP_MIN 간격으로 훑어 극값(고조/저조)을 찾는다.
 * 예: 하루치 곡선 → [{t:"07:30", cm:232.4, type:"high"}, ...]
 * @param {Array<{t:string,h:number}>} curve - 곡선 파일의 curve 배열("HH:MM" + 조위cm)
 * @param {Array<{t:string,h:number}>=} prevCurve - 전날 곡선(있으면 뒤쪽 12시간을 앞에 붙여 자정 근처 극값을 잡는다)
 * @param {Array<{t:string,h:number}>=} nextCurve - 다음날 곡선(있으면 앞쪽 12시간을 뒤에 붙인다)
 * @returns {Array<{t:string,cm:number,type:'high'|'low'}>} 시각순 극값(그날 00:00~23:59 것만)
 * [연계] ← capture() — 저장 직전에 곡선에서 극값만 뽑아내기 위함.
 *   → peak_finder.findPeaksInSamples — 팝업 "오늘" 극값(getTideCurve)과 같은 규칙.
 *   ⚠팝업이 "오늘" 극값을 만들 때는 여러 앵커를 IDW로 섞은 뒤 극값을 찾는데,
 *     여기서는 앵커 하나씩 따로 찾는다(섞기 전). 그래서 어제 값은 오늘 값과
 *     계산 순서가 달라 수 cm 차이가 날 수 있다 — 저장량을 줄이려고 감수한 부분.
 */
function extremaOfCurve(curve, prevCurve, nextCurve) {
    if (!Array.isArray(curve) || !curve.length) return [];
    // 곡선("HH:MM") → SAMPLE_STEP_MIN 간격 표본 {m, cm}. offset 은 전날 -1440·다음날 +1440.
    const toSamples = (c, offset, keep) => {
        const byMinute = new Array(1440).fill(null);
        for (const pt of (Array.isArray(c) ? c : [])) {
            if (!pt || pt.h == null) continue;
            const s = String(pt.t);
            const hh = parseInt(s.slice(0, 2), 10), mm = parseInt(s.slice(3, 5), 10);
            if (isNaN(hh) || isNaN(mm)) continue;
            byMinute[hh * 60 + mm] = pt.h;
        }
        const out = [];
        for (let m = 0; m < 1440; m += SAMPLE_STEP_MIN) {
            if (byMinute[m] != null && keep(m)) out.push({ m: m + offset, cm: Math.round(byMinute[m] * 10) / 10 });
        }
        return out;
    };
    const own = toSamples(curve, 0, () => true);
    if (own.length < 3) return [];
    const samples = toSamples(prevCurve, -1440, m => m >= 720).concat(own, toSamples(nextCurve, 1440, m => m < 720));
    return findPeaksInSamples(samples).map((p) => ({
        t: `${String(Math.floor(p.m / 60)).padStart(2, '0')}:${String(p.m % 60).padStart(2, '0')}`,
        cm: p.cm,
        type: p.type
    }));
}

/**
 * 한 앵커 집합의 하루치 극값을 요약 파일로 저장한다(있으면 덮어쓴다).
 * 예: capture('tf', 20260909, ['A0001','A0002'], TFCollector.curvePath)
 * @param {string} setId - 앵커 집합 id ('tf' | 'hr')
 * @param {number} ymd - 날짜(YYYYMMDD)
 * @param {Array<string>} anchorIds - 그 집합의 앵커 id 목록
 * @param {function(string, number): string} curvePathFn - (앵커id, 날짜) → 곡선 파일 경로
 * @param {function=} logFn - 로그 함수(선택)
 * @returns {{date:number, anchors:number, peaks:number}} 저장 결과 요약
 * [연계] ← tide_field_collector.js / hazard_rocks_tide_collector.js 수집 직후 호출.
 *   곡선 파일이 지워지기 전에 남겨야 하므로 purgeStaleCurves 보다 먼저 부른다.
 */
function capture(setId, ymd, anchorIds, curvePathFn, logFn) {
    const lg = typeof logFn === 'function' ? logFn : (() => {});
    const peaks = {};
    let nPeaks = 0;
    for (const id of anchorIds || []) {
        let j;
        try { j = JSON.parse(fs.readFileSync(curvePathFn(id, ymd), 'utf8')); } catch (e) { continue; }
        // 옆날 곡선이 남아 있으면 앞뒤 12시간을 붙여 자정 근처 극값도 잡는다(없으면 그날만 — 종전과 같음).
        const near = (delta) => {
            const d = new Date(Date.UTC(+String(ymd).slice(0, 4), +String(ymd).slice(4, 6) - 1, +String(ymd).slice(6, 8) + delta));
            const nymd = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
            try { return JSON.parse(fs.readFileSync(curvePathFn(id, nymd), 'utf8')).curve; } catch (e) { return null; }
        };
        const ex = extremaOfCurve(j && j.curve, near(-1), near(1));
        if (!ex.length) continue;
        peaks[id] = ex;
        nPeaks += ex.length;
    }
    fs.mkdirSync(PREV_PEAKS_DIR, { recursive: true });
    const out = { date: ymd, generated_at: new Date().toISOString(), peaks };
    const p = filePath(setId, ymd);
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(out), 'utf8');   // 원자적 쓰기(tmp→rename)
    fs.renameSync(tmp, p);
    lg(`극값 요약 저장(${setId}/${ymd}): 앵커 ${Object.keys(peaks).length}곳, 극값 ${nPeaks}개`);
    return { date: ymd, anchors: Object.keys(peaks).length, peaks: nPeaks };
}

/**
 * 저장해 둔 하루치 극값을 읽는다(두 집합을 합쳐 하나의 표로).
 * 예: load(20260908) → { A0001: [{t:"01:30",cm:77,type:"low"}, ...], HRJ001: [...] }
 * @param {number|string} ymd - 날짜(YYYYMMDD)
 * @returns {Object<string, Array<{t:string,cm:number,type:string}>>} 앵커id → 극값 배열
 *   (파일이 없으면 빈 객체 — 호출부는 "어제 값 없음"으로 다루면 된다)
 * [연계] ← hazard_rocks_submersion.js getTideCurve — day=0 일 때만 조회.
 */
function load(ymd) {
    const merged = {};
    for (const setId of ['tf', 'hr']) {
        let j;
        try { j = JSON.parse(fs.readFileSync(filePath(setId, ymd), 'utf8')); } catch (e) { continue; }
        if (!j || !j.peaks) continue;
        for (const id of Object.keys(j.peaks)) merged[id] = j.peaks[id];
    }
    return merged;
}

/**
 * 오래된 요약 파일을 지운다(KEEP_DAYS 일치만 남긴다).
 * 예: prune([20260909, 20260908]) → 그 두 날짜 외 파일 삭제
 * @param {Array<number|string>} keepYmds - 남길 날짜 목록
 * @returns {number} 지운 파일 수
 * [연계] ← 수집기가 capture 직후 호출 — 요약 파일이 무한정 쌓이지 않게 한다.
 */
function prune(keepYmds) {
    const keep = new Set((keepYmds || []).map(String));
    let removed = 0;
    let files = [];
    try { files = fs.readdirSync(PREV_PEAKS_DIR); } catch (e) { return 0; }
    for (const f of files) {
        const m = f.match(/^(?:tf|hr)_(\d{8})\.json$/);
        if (!m || keep.has(m[1])) continue;
        try { fs.unlinkSync(path.join(PREV_PEAKS_DIR, f)); removed++; } catch (e) { /* noop */ }
    }
    return removed;
}

/**
 * 수집기가 한 번에 부르는 묶음 — 오늘·내일·모레 곡선의 극값을 저장하고 옛 파일을 정리한다.
 * 예: captureWindow('tf', [20260909,20260910,20260911], ids, curvePath, log)
 * @param {string} setId - 앵커 집합 id ('tf' | 'hr')
 * @param {Array<number>} dates - 수집 윈도우 날짜들(오늘·내일·모레)
 * @param {Array<string>} anchorIds - 앵커 id 목록
 * @param {function(string, number): string} curvePathFn - 곡선 파일 경로 함수
 * @param {function=} logFn - 로그 함수(선택)
 * @returns {{captured:number, pruned:number}} 저장한 날짜 수와 지운 파일 수
 * [연계] ← 두 수집기가 수집 종료 직후 이 함수 하나만 부른다(호출부를 한 줄로 유지).
 *   남기는 날짜: 이번 윈도우(3일) + 그 앞 KEEP_DAYS-3 일 → 어제 요약이 지워지지 않는다.
 */
function captureWindow(setId, dates, anchorIds, curvePathFn, logFn) {
    let captured = 0;
    for (const ymd of dates || []) {
        try { capture(setId, ymd, anchorIds, curvePathFn, logFn); captured++; } catch (e) { /* 한 날짜 실패가 나머지를 막지 않는다 */ }
    }
    // 남길 날짜 = 윈도우 첫날 기준 과거 KEEP_DAYS 일 ~ 윈도우 마지막날
    const keep = [];
    const base = dates && dates.length ? String(dates[0]) : null;
    if (base) {
        const d0 = new Date(Date.UTC(+base.slice(0, 4), +base.slice(4, 6) - 1, +base.slice(6, 8)));
        for (let i = -KEEP_DAYS; i <= 2; i++) {
            const d = new Date(d0.getTime() + i * 86400000);
            keep.push(d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate());
        }
    }
    const pruned = keep.length ? prune(keep) : 0;
    return { captured, pruned };
}

module.exports = {
    PREV_PEAKS_DIR, KEEP_DAYS, SAMPLE_STEP_MIN,
    filePath, extremaOfCurve, capture, load, prune, captureWindow
};
