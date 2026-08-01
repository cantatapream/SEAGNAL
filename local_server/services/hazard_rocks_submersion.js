/**
 * ============================================================================
 * 파일명: services/hazard_rocks_submersion.js
 * 역할: 간출암 잠김경고 — 조위와 VALSOU(간출 높이)를 비교해 "완전히 잠기는 시각" 산출
 * ============================================================================
 *
 * [무엇을 하나]
 *   client/hazard_rocks.json 의 간출암(k=1, VALSOU 있음)마다 위치로 해역을 나눠
 *   서로 다른 조위원(源)에서 η(t)(조위, cm)를 구하고, η(t)가 VALSOU(cm)를 아래→위로
 *   가로지르는(=잠기는) 시각을 오늘~+2일(KST) 윈도우 전체에서 찾아 저장한다.
 *     - 서해·남해: 물빠짐(tide_field) 앵커 곡선 재사용 (직선거리 IDW)
 *     - 제주:      hazard_rocks_tide_collector 가 수집한 전용 앵커 곡선 (동일 IDW)
 *     - 동해(위도≥36·경도≥128): TideBED 미제공 해역 — client/tide_data 연간
 *       조석표(표준항 만조/간조 시각·조고)를 읽어 표준항 IDW 보간 후, 두 극값
 *       사이를 반정현파(half-cosine)로 근사해 교차시각을 해석적으로 구한다
 *       (tide.js 의 findNearestStationsWithData/interpolateTideByIDW 와 동일 가중치).
 *     - 그 외(북한서해·동해 외해 등 미커버 해역)는 계산하지 않고 건너뛴다.
 *
 *   결과는 암초마다 "잠기는 시각(ISO)" 목록으로 data/hazard_rocks/submersion.json
 *   에 저장한다. 무거운 스캔(분단위 × 3일)은 이 함수(computeAllCrossings)에서
 *   1회만 하고, 실제 API 응답(getUpcomingWarnings)은 저장된 시각과 "지금"을
 *   빼는 가벼운 연산만 한다.
 *
 * [실행 시점]
 *   scheduler.js 가 KST 23:30 물빠짐→제주 앵커 수집이 끝난 직후 1회 호출한다
 *   (조위 곡선이 그 시점에 갱신되므로 그 직후 재계산해야 최신 3일 윈도우 반영).
 *
 * [연계]
 *   - services/tide_field_common.js       → 해역 게이팅(JEJU_BBOX 등), haversineKm
 *   - services/tide_field_collector.js    → 서해·남해 앵커·곡선 경로
 *   - services/hazard_rocks_tide_collector.js → 제주 앵커·곡선 경로
 *   - scripts/build_tide_field.js         → loadTideTable(year) 재사용(동해 표준항)
 *   - routes/hazard_rocks.js              → getUpcomingWarnings() 를 API로 노출
 *   - scheduler.js                        → KST 23:30, 곡선 수집 직후 1회 호출
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

const TFC = require('./tide_field_common');
const TFCollector = require('./tide_field_collector');
const HRC = require('./hazard_rocks_tide_common');
const HRCollector = require('./hazard_rocks_tide_collector');

const HAZARD_ROCKS_JSON = path.join(__dirname, '..', '..', 'client', 'hazard_rocks.json');
const SUBMERSION_PATH = path.join(HRC.HAZARD_ROCKS_TIDE_DIR, 'submersion.json');

// 서해·남해/제주 IDW 보간 — 물빠짐(tide_field)과 동일 기준(직선거리 25km 내 최대 4개).
const INTERP_MAX_KM = 25;
const INTERP_MAX_ANCHORS = 4;
// 경고 창(분) — 잠기기 3시간 전부터 표시.
const WARNING_WINDOW_MIN = 180;

const EAST_SEA_LAT = 36.0;
const EAST_SEA_LON = 128.0;

// ============================================================================
// 간출암 목록 로드
// ============================================================================
/**
 * hazard_rocks.json 에서 간출암(k=1, VALSOU 있음)만 골라 {id,lon,lat,v} 배열로.
 * v(간출 높이, m)가 없는 암초는 잠김 시각을 정의할 기준이 없어 제외한다.
 * [연계] id 는 build_hazard_rocks.js 가 부여한 순번 — hazard_rocks.js(프론트)의
 *   feature.get('id') 와 매칭해 어느 마커에 경고를 표시할지 결정한다.
 */
function loadRocks() {
    const g = JSON.parse(fs.readFileSync(HAZARD_ROCKS_JSON, 'utf8'));
    const out = [];
    for (const f of g.features) {
        if (!f.properties || f.properties.k !== 1 || f.properties.v == null) continue; // 간출암만(VALSOU 있음)
        const [lon, lat] = f.geometry.coordinates;
        out.push({ id: f.properties.id, lon, lat, v: f.properties.v });
    }
    return out;
}

/**
 * 좌표로 어떤 조위원(源)을 쓸지 결정. 순서 중요: 동해부터 검사해야 한다
 * (isWestSouthSea 는 이미 동해·제주를 제외하므로 순서를 바꿔도 결과는 같지만,
 * "동해 우선 판정"이 tide.js 의 processEastSeaNorthException 조건과 그대로 대응).
 * @returns {'eastsea'|'westsouth'|'jeju'|'skip'} skip = 계산 안 함(미커버 해역)
 */
function classifyRegion(lat, lon) {
    if (lat >= EAST_SEA_LAT && lon >= EAST_SEA_LON) return 'eastsea';
    if (TFC.isWestSouthSea(lat, lon)) return 'westsouth';
    const J = TFC.JEJU_BBOX;
    if (lat >= J.latMin && lat <= J.latMax && lon >= J.lonMin && lon <= J.lonMax) return 'jeju';
    return 'skip';
}

// ============================================================================
// 서해·남해/제주 — 앵커 곡선 IDW (물빠짐 라우트의 loadAnchorCurve/etaCmAt과 동일 로직)
// ============================================================================
const _curveCache = new Map(); // curvePath -> {mtimeMs, byMinute:Float32Array(1440)|null}

/**
 * 앵커 1개의 하루치 곡선 파일을 읽어 분(0~1439)→조위(cm) 배열로 변환(mtime 캐시).
 * [연계] curvePathFn 은 호출부가 서해·남해(TFCollector.curvePath)와 제주
 *   (HRCollector.curvePath) 중 어느 앵커 곡선 디렉토리를 볼지 골라 넘긴다.
 */
function loadCurveByMinute(curvePathFn, anchorId, yyyymmdd) {
    const p = curvePathFn(anchorId, yyyymmdd);
    let stat;
    try { stat = fs.statSync(p); } catch (e) { return null; }
    const cached = _curveCache.get(p);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.byMinute;

    let j;
    try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
    if (!j || j.status === 'no_grid' || !Array.isArray(j.curve) || j.curve.length === 0) {
        _curveCache.set(p, { mtimeMs: stat.mtimeMs, byMinute: null });
        return null;
    }
    const byMinute = new Float32Array(1440).fill(NaN);
    for (const pt of j.curve) {
        const [hh, mm] = String(pt.t).split(':').map(Number);
        if (!isNaN(hh) && !isNaN(mm) && pt.h != null) byMinute[hh * 60 + mm] = pt.h;
    }
    _curveCache.set(p, { mtimeMs: stat.mtimeMs, byMinute });
    return byMinute;
}

/** 결측 분은 인접 분(최대 ±15분) 선형보간 — 물빠짐 라우트 etaCmAt과 동일. */
function etaCmAt(byMinute, minute) {
    if (!byMinute) return null;
    const v = byMinute[minute];
    if (!isNaN(v)) return v;
    let lo = null, hi = null;
    for (let d = 1; d <= 15; d++) {
        if (lo == null && minute - d >= 0 && !isNaN(byMinute[minute - d])) lo = { m: minute - d, v: byMinute[minute - d] };
        if (hi == null && minute + d < 1440 && !isNaN(byMinute[minute + d])) hi = { m: minute + d, v: byMinute[minute + d] };
        if (lo && hi) break;
    }
    if (lo && hi) return lo.v + ((minute - lo.m) / (hi.m - lo.m)) * (hi.v - lo.v);
    return lo ? lo.v : (hi ? hi.v : null);
}

/**
 * 암초 1곳의 그 순간 조위(cm) — 가까운 앵커 여러 개(refs)를 거리역제곱(1/d²)
 * 가중평균(IDW)한다. 물빠짐 라우트(routes/tide_field.js)의 cellDepthM 과 동일 공식.
 * @returns {number|null} 참조 곡선이 하나도 없으면 null
 */
function combinedEtaCm(refs, curvePathFn, yyyymmdd, minute) {
    let wsum = 0, vsum = 0;
    for (const { id, distKm } of refs) {
        const bm = loadCurveByMinute(curvePathFn, id, yyyymmdd);
        const eta = etaCmAt(bm, minute);
        if (eta == null) continue;
        const w = distKm < 0.1 ? 1e6 : 1 / (distKm * distKm);
        wsum += w; vsum += w * eta;
    }
    return wsum > 0 ? vsum / wsum : null;
}

/** 암초 좌표 기준 25km 이내 가장 가까운 앵커 최대 4개(거리 포함) — combinedEtaCm 입력용. */
function nearestRefs(lat, lon, anchors) {
    return anchors
        .map(a => ({ id: a.id, distKm: TFC.haversineKm(lat, lon, a.lat, a.lon) }))
        .filter(r => r.distKm <= INTERP_MAX_KM)
        .sort((a, b) => a.distKm - b.distKm)
        .slice(0, INTERP_MAX_ANCHORS);
}

/** 앵커 곡선 IDW로 윈도우 전체(분단위)를 스캔해 target(cm) 상향 교차(=잠김) 절대분 목록 반환. */
function scanAnchorCrossings(refs, curvePathFn, dates, targetCm) {
    const crossings = [];
    let prevAbsMin = null, prevEta = null;
    for (let di = 0; di < dates.length; di++) {
        const ymd = dates[di];
        for (let m = 0; m < 1440; m++) {
            const eta = combinedEtaCm(refs, curvePathFn, ymd, m);
            const absMin = di * 1440 + m;
            if (eta != null) {
                if (prevEta != null && prevEta < targetCm && targetCm <= eta) {
                    const frac = (targetCm - prevEta) / (eta - prevEta);
                    crossings.push(prevAbsMin + frac);
                }
                prevAbsMin = absMin; prevEta = eta;
            }
        }
    }
    return crossings;
}

// ============================================================================
// 동해 — 표준항 연간 조석표(만조/간조 극값) IDW + 반정현파 교차 해석
// ============================================================================
const _yearTableCache = new Map();
/**
 * client/tide_data/tide_data_{year}.js(연간 조석표) 를 표준항×날짜 행 배열로 로드.
 * [연계] scripts/build_tide_field.js 의 loadTideTable() 을 그대로 재사용한다
 *   (파일이 브라우저 전역(window.TIDE_DATA_STORAGE) 형태라 vm 으로 평가해 읽는
 *   로더가 이미 있어 중복 구현하지 않음). 연도별 1회 로드 후 캐시.
 */
function getYearTable(year) {
    if (_yearTableCache.has(year)) return _yearTableCache.get(year);
    const buildTideField = require('../scripts/build_tide_field');
    const rows = buildTideField.loadTideTable(year) || [];
    _yearTableCache.set(year, rows);
    return rows;
}
const _dateRowsCache = new Map();
/** 특정 날짜(YYYYMMDD)의 표준항 조석 행을 stationCode/stationName → row 맵으로. */
function getRowsForDate(yyyymmdd) {
    const key = String(yyyymmdd);
    if (_dateRowsCache.has(key)) return _dateRowsCache.get(key);
    const year = Math.floor(yyyymmdd / 10000);
    const map = new Map();
    for (const row of getYearTable(year)) {
        if (row.date !== yyyymmdd) continue;
        if (row.stationCode) map.set(row.stationCode, row);
        if (row.stationName && !map.has(row.stationName)) map.set(row.stationName, row);
    }
    _dateRowsCache.set(key, map);
    return map;
}
/**
 * 암초 좌표에서 가까운 표준항 중 그 날짜 데이터를 보유한 곳만 N개(기본 3) 반환.
 * [연계] client/tide.js 의 findNearestStationsWithData 를 서버(Node)에서 그대로
 *   재현 — 동해 조석 조회 UI 가 이미 쓰는 것과 동일한 선정 방식이라야 결과가
 *   사용자가 화면에서 보는 조석 정보와 어긋나지 않는다.
 */
function findNearestStationsWithData(lat, lon, yyyymmdd, count) {
    const rows = getRowsForDate(yyyymmdd);
    const scored = [];
    for (const st of TFC.ALL_REFERENCE_STATIONS) {
        const row = (st.code && rows.get(st.code)) || rows.get(st.name);
        if (!row) continue;
        scored.push({ st, row, distKm: TFC.haversineKm(lat, lon, st.lat, st.lon) });
    }
    scored.sort((a, b) => a.distKm - b.distKm);
    return scored.slice(0, count || 3);
}
/** 시각 문자열("HHMM"|"HH:MM")을 0시 기준 분(0~1439)으로. tide.js 와 동일 규칙. */
function timeToMinutes(t) {
    if (t == null) return null;
    const s = String(t);
    if (s.includes(':')) { const [h, m] = s.split(':').map(Number); return h * 60 + m; }
    const str = s.padStart(4, '0');
    return parseInt(str.slice(0, 2), 10) * 60 + parseInt(str.slice(2, 4), 10);
}
/** 표준항이 1곳뿐일 때(IDW 불필요) 그 항의 만조×4+간조×4 극값을 시각순으로. */
function stationOwnPoints(row) {
    const points = [];
    for (const kind of ['highTide', 'lowTide']) {
        for (let i = 1; i <= 4; i++) {
            const timeKey = `${kind}${i}Time`, levelKey = `${kind}${i}Level`;
            if (row[timeKey] === undefined || row[levelKey] === undefined) continue;
            points.push({ minuteOfDay: timeToMinutes(row[timeKey]), levelCm: Math.round(Number(row[levelKey])) });
        }
    }
    points.sort((a, b) => a.minuteOfDay - b.minuteOfDay);
    return points;
}
/** tide.js interpolateTideByIDW 와 동일 가중치(시각·조고 각각 1/거리² IDW)로 극값 블렌드. */
function idwBlendExtrema(scored) {
    const primary = scored[0].row;
    const points = [];
    for (const kind of ['highTide', 'lowTide']) {
        for (let i = 1; i <= 4; i++) {
            const timeKey = `${kind}${i}Time`, levelKey = `${kind}${i}Level`;
            if (primary[timeKey] === undefined) continue;
            const withTime = scored.filter(s => s.row[timeKey] !== undefined);
            const withLevel = scored.filter(s => s.row[levelKey] !== undefined);
            if (!withTime.length || !withLevel.length) continue;
            const tw = withTime.map(s => s.distKm < 0.1 ? 1e6 : 1 / (s.distKm * s.distKm));
            const twSum = tw.reduce((a, b) => a + b, 0);
            const avgMin = withTime.reduce((sum, s, idx) => sum + timeToMinutes(s.row[timeKey]) * (tw[idx] / twSum), 0);
            const lw = withLevel.map(s => s.distKm < 0.1 ? 1e6 : 1 / (s.distKm * s.distKm));
            const lwSum = lw.reduce((a, b) => a + b, 0);
            const avgLevel = withLevel.reduce((sum, s, idx) => sum + Number(s.row[levelKey]) * (lw[idx] / lwSum), 0);
            points.push({ minuteOfDay: Math.round(avgMin), levelCm: Math.round(avgLevel) });
        }
    }
    points.sort((a, b) => a.minuteOfDay - b.minuteOfDay);
    return points;
}
/** 두 극값(t1,h1)→(t2,h2) 사이를 반정현파로 근사, target(cm) 상향 교차 절대분. */
function halfCosineCrossing(t1, h1, t2, h2, target) {
    if (h2 === h1) return null;
    const ratio = Math.max(-1, Math.min(1, 1 - 2 * (target - h1) / (h2 - h1)));
    const x = Math.acos(ratio) / Math.PI;
    return t1 + x * (t2 - t1);
}
/**
 * 동해 암초 1곳의 잠김(상향 교차) 절대분 목록 — 윈도우 전체 극값을 이어 붙이고
 * 만조로 오르는 구간(rising)에서 target(cm)을 지나는 지점을 반정현파로 계산.
 * @param {Array<number>} dates windowDatesKST() 결과(YYYYMMDD 정수 배열)
 * @param {number} targetCm 암초 VALSOU(cm) — 이 높이를 넘으면 잠김
 * @returns {Array<number>} 절대분(윈도우 시작일 0시 기준) 목록
 */
function scanEastSeaCrossings(lat, lon, dates, targetCm) {
    const extrema = [];
    for (let di = 0; di < dates.length; di++) {
        const scored = findNearestStationsWithData(lat, lon, dates[di], 3);
        if (!scored.length) continue;
        const pts = scored.length === 1 ? stationOwnPoints(scored[0].row) : idwBlendExtrema(scored);
        for (const p of pts) extrema.push({ absMin: di * 1440 + p.minuteOfDay, levelCm: p.levelCm });
    }
    const crossings = [];
    for (let i = 1; i < extrema.length; i++) {
        const a = extrema[i - 1], b = extrema[i];
        if (b.levelCm > a.levelCm && a.levelCm < targetCm && targetCm <= b.levelCm) {
            const cross = halfCosineCrossing(a.absMin, a.levelCm, b.absMin, b.levelCm, targetCm);
            if (cross != null) crossings.push(cross);
        }
    }
    return crossings;
}

// ============================================================================
// 메인: 전체 암초 잠김 교차시각 계산 + 저장
// ============================================================================
/** 윈도우 시작일(KST 0시) 기준 절대분 → ISO(UTC) 문자열. */
function absMinToISO(startYmd, absMin) {
    const s = String(startYmd);
    const y = +s.slice(0, 4), mo = +s.slice(4, 6) - 1, d = +s.slice(6, 8);
    const kstMidnightUtcMs = Date.UTC(y, mo, d, 0, 0) - 9 * 3600000;
    return new Date(kstMidnightUtcMs + absMin * 60000).toISOString();
}

/**
 * 전체 간출암의 잠김 교차시각을 오늘~+2일(KST) 윈도우 전체에서 계산해 저장.
 * 무거운 연산(분단위 스캔) — scheduler.js 가 야간 배치 직후 1회만 호출한다.
 */
async function computeAllCrossings(opts = {}) {
    const log = opts.log || ((...a) => console.log('[hazard_rocks_submersion]', ...a));
    const rocks = loadRocks();
    const dates = HRCollector.windowDatesKST(HRC.WINDOW_DAYS);
    const wsAnchors = TFCollector.loadAnchors() || [];
    const jejuAnchors = HRCollector.loadAnchors() || [];

    const crossings = {};
    const counts = { westsouth: 0, jeju: 0, eastsea: 0, skip: 0 };

    for (const rock of rocks) {
        const region = classifyRegion(rock.lat, rock.lon);
        counts[region] = (counts[region] || 0) + 1;
        if (region === 'skip') continue;
        const targetCm = rock.v * 100;

        let absMins = [];
        if (region === 'westsouth' || region === 'jeju') {
            const anchors = region === 'westsouth' ? wsAnchors : jejuAnchors;
            const curvePathFn = region === 'westsouth' ? TFCollector.curvePath : HRCollector.curvePath;
            const refs = nearestRefs(rock.lat, rock.lon, anchors);
            if (!refs.length) continue;
            absMins = scanAnchorCrossings(refs, curvePathFn, dates, targetCm);
        } else if (region === 'eastsea') {
            absMins = scanEastSeaCrossings(rock.lat, rock.lon, dates, targetCm);
        }

        if (absMins.length) {
            crossings[rock.id] = absMins.map(m => absMinToISO(dates[0], m));
        }
    }

    const out = { generated_at: new Date().toISOString(), window_start: dates[0], crossings };
    fs.mkdirSync(HRC.HAZARD_ROCKS_TIDE_DIR, { recursive: true });
    const tmp = SUBMERSION_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(out), 'utf8');
    fs.renameSync(tmp, SUBMERSION_PATH);
    log(`잠김시각 계산 완료: 서남해 ${counts.westsouth}, 제주 ${counts.jeju}, 동해 ${counts.eastsea}, 미커버 제외 ${counts.skip} ` +
        `→ 교차시각 보유 암초 ${Object.keys(crossings).length}개`);
    return out;
}

// ============================================================================
// 조회: 지금부터 3시간 이내 잠기는 암초만
// ============================================================================
/**
 * @param {number} [now] - 기준 시각(ms). 기본 Date.now().
 * @returns {{ready:boolean, generated_at:string|null, warnings:Object<string,number>}}
 *   warnings: { rockId: etaMin(분, 0<etaMin<=180) }
 */
function getUpcomingWarnings(now) {
    now = now || Date.now();
    let data;
    try { data = JSON.parse(fs.readFileSync(SUBMERSION_PATH, 'utf8')); }
    catch (e) { return { ready: false, generated_at: null, warnings: {} }; }

    const warnings = {};
    for (const [id, isoList] of Object.entries(data.crossings || {})) {
        let best = null;
        for (const iso of isoList) {
            const etaMin = (new Date(iso).getTime() - now) / 60000;
            if (etaMin > 0 && etaMin <= WARNING_WINDOW_MIN && (best == null || etaMin < best)) best = etaMin;
        }
        if (best != null) warnings[id] = Math.round(best);
    }
    return { ready: true, generated_at: data.generated_at || null, warnings };
}

module.exports = {
    computeAllCrossings, getUpcomingWarnings,
    // 테스트/디버그용 보조 export
    classifyRegion, loadRocks
};
