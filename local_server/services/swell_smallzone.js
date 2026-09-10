/**
 * ============================================================================
 * 파일명: services/swell_smallzone.js
 * 역할: 소해구별 너울 위험등급(관심/주의/경계/위험) 수집·캐시·제공.
 *
 * [출처 — GeoServer WFS (무인증)]
 *   MMIS 화면의 소해구 색칠은 GeoServer 지도 타일(WMS)이다. 같은 레이어를 WFS 로
 *   부르면 그림 대신 원본 숫자가 GeoJSON 으로 온다 — 색을 역매칭할 필요가 없다.
 *     GET /geoserver/mmis/ows?service=WFS&version=1.0.0&request=GetFeature
 *         &typeName=mmis:marine_zone_swell&outputFormat=application/json
 *         &viewparams=fcst_time:<YYYYMMDDHHmmss>;mdl_data_prdct_time:<YYYYMMDDHHmmss>
 *   응답 한 칸의 속성:
 *     marine_zone_no "1_1" · zone_idx 1 · zone_sub_idx 1
 *     wh(유의파고 m) · wp(파주기 s) · wd(파향) · dngr_grde_lvl(1~4)
 *   전국 3,381 소해구(2026-09-10 실측). dngr_grde_lvl 은 이안류(ripcrnt-1h)와 같은
 *   필드로, scheduler.js 의 KMA_LEVEL_MAP(1 관심 / 2 주의 / 3 경계 / 4 위험)을 그대로 쓴다.
 *
 * [예보시각]
 *   GET /mmis_marine_api/v1/kma/mdl/swell/kim/3h/marinezone/forecast-times
 *     → { fctTm:[ "2026.09.10 15:00", ... 19개(3시간 간격) ], baseTm:"2026.09.09 21:00" }
 *   baseTm(생산시각)이 바뀔 때만 재수집한다(vsby_smallzone 이 RDPS 런으로 하는 것과 동일).
 *
 * [저장]
 *   메모리 상주 + data/swell_smallzone.json.gz. **날짜별로 쌓지 않고 최신 런만 덮어쓴다**
 *   (사용자 확정 2026-09-08: "해구 예보값을 매일 쌓을 수는 없어").
 *
 * [연계]
 *  - 사용하는 파일 : services/vsby_smallzone.js(소해구 키 유틸은 쓰지 않음 — WFS 가 키를 준다)
 *  - 나를 쓰는 곳  : routes/swell_smallzone.js · server.js(부팅 시 startAutoRefresh)
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const fetch = require('node-fetch');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const CACHE_PATH = path.join(DATA_DIR, 'swell_smallzone.json.gz');

const KMA_BASE = 'https://marine.kma.go.kr';
const FCT_TIMES_URL = `${KMA_BASE}/mmis_marine_api/v1/kma/mdl/swell/kim/3h/marinezone/forecast-times`;
const WFS_URL = `${KMA_BASE}/geoserver/mmis/ows`;
const WFS_TYPENAME = 'mmis:marine_zone_swell';

/** 등급 숫자 → 이름. 이안류(scheduler.js KMA_LEVEL_MAP)와 같은 규약. */
const LEVEL_NAMES = { 1: '관심', 2: '주의', 3: '경계', 4: '위험' };

const POLL_INTERVAL_MS = 60 * 60 * 1000;   // 생산시각 변경 폴링(1시간)
const FRAME_CONCURRENCY = 2;               // 예보시각 동시 호출 수(상대 서버 배려)
const FETCH_TIMEOUT_MS = 30000;

const _H = { Referer: `${KMA_BASE}/mmis/`, 'User-Agent': 'Mozilla/5.0 (SEAGNAL/swell)' };

// ── 캐시 ──
//  { baseTm, collectedAt, fctTimes:["2026.09.10 15:00", ...],
//    cells:{ "1-1": { lvl:[1,1,2,...], wh:[0.05,...], wp:[3.3,...] } } }
let _cache = { baseTm: null, collectedAt: null, fctTimes: [], cells: {} };
let _collecting = false;

// ────────────────────────────────────────────────────────────────────────────
// 1. 시각 변환
// ────────────────────────────────────────────────────────────────────────────
/**
 * MMIS 표기 시각을 WFS viewparams 형식으로 바꾼다.
 * 예: "2026.09.10 15:00" → "20260910150000"
 * @param {string} tm - "YYYY.MM.DD HH:mm"
 * @returns {string|null} 14자리 숫자 문자열. 형식이 아니면 null.
 * [연계] → collect() 가 viewparams 를 만들 때 부른다.
 */
function toViewParamTime(tm) {
    const m = /(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/.exec(String(tm || ''));
    if (!m) return null;
    return `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}00`;
}

/**
 * WFS 가 주는 소해구 번호를 우리 앱의 소해구 키로 바꾼다.
 * 예: "1_1" → "1-1" (vsby_smallzone.js 의 pointToCellKey 와 같은 표기)
 * @param {string} no - marine_zone_no ("<대해구>_<1~9>")
 * @returns {string|null} "대해구-서브". 형식이 아니면 null.
 * [연계] → collect() 가 응답을 캐시에 담을 때 부른다.
 */
function toCellKey(no) {
    const m = /^(\d+)_([1-9])$/.exec(String(no || ''));
    return m ? `${m[1]}-${m[2]}` : null;
}

// ────────────────────────────────────────────────────────────────────────────
// 2. MMIS 호출
// ────────────────────────────────────────────────────────────────────────────
/**
 * 너울 예보시각 목록과 생산시각을 받아온다.
 * 예: { fctTimes:["2026.09.10 15:00", ...19개], baseTm:"2026.09.09 21:00" }
 * @returns {Promise<{fctTimes:string[], baseTm:string|null}>}
 * [연계] → collect()·refreshIfStale() 이 "다시 받아야 하나"를 판단하려고 부른다.
 */
async function fetchForecastTimes() {
    const r = await fetch(FCT_TIMES_URL, { headers: _H, timeout: FETCH_TIMEOUT_MS });
    if (!r.ok) throw new Error('forecast-times ' + r.status);
    const j = await r.json();
    const d = (j && j.data) || {};
    return { fctTimes: d.fctTm || [], baseTm: d.baseTm || null };
}

/**
 * 한 예보시각의 전국 소해구 너울 등급을 WFS 로 받아온다.
 * 예: fetchFrame("20260910150000","20260909210000") → [{key:"1-1", lvl:1, wh:0.05, wp:3.3}, ...]
 * @param {string} fcstTime - 예보시각 14자리
 * @param {string} prdctTime - 생산시각 14자리
 * @returns {Promise<Array<{key:string,lvl:number|null,wh:number|null,wp:number|null}>>}
 * [연계] → collect() 가 예보시각마다 부른다. 도형(geometry)은 받지 않는다 —
 *          소해구 사각형은 client/marine_zone_area.json 으로 이미 계산할 수 있다.
 */
async function fetchFrame(fcstTime, prdctTime) {
    const qs = new URLSearchParams({
        service: 'WFS',
        version: '1.0.0',
        request: 'GetFeature',
        typeName: WFS_TYPENAME,
        outputFormat: 'application/json',
        propertyName: 'marine_zone_no,dngr_grde_lvl,wh,wp',
        viewparams: `fcst_time:${fcstTime};mdl_data_prdct_time:${prdctTime}`
    });
    const r = await fetch(`${WFS_URL}?${qs.toString()}`, { headers: _H, timeout: FETCH_TIMEOUT_MS });
    if (!r.ok) throw new Error('wfs ' + r.status);
    const j = await r.json();
    const out = [];
    for (const f of (j.features || [])) {
        const p = f.properties || {};
        const key = toCellKey(p.marine_zone_no);
        if (!key) continue;
        out.push({
            key,
            lvl: (p.dngr_grde_lvl == null) ? null : Number(p.dngr_grde_lvl),
            wh: (p.wh == null) ? null : Number(p.wh),
            wp: (p.wp == null) ? null : Number(p.wp)
        });
    }
    return out;
}

/** 동시성 제한 풀. 실패한 항목은 null 로 둔다(한 프레임 실패가 전체를 막지 않도록). */
async function _pool(items, conc, fn) {
    let i = 0;
    const out = new Array(items.length);
    const workers = Array.from({ length: Math.min(conc, items.length) }, async () => {
        while (i < items.length) {
            const idx = i++;
            out[idx] = await fn(items[idx], idx).catch(e => {
                console.error('[swell_sz] 프레임 실패:', e.message);
                return null;
            });
        }
    });
    await Promise.all(workers);
    return out;
}

// ────────────────────────────────────────────────────────────────────────────
// 3. 수집
// ────────────────────────────────────────────────────────────────────────────
/**
 * 전 예보시각 × 전 소해구 너울 등급을 받아 캐시에 넣는다.
 * 예: collect({ limitFrames: 1 }) → 첫 예보시각만 받아 구조 확인(저장 안 함)
 * @param {Object} [opts]
 * @param {number} [opts.limitFrames=0] - 앞 N개 예보시각만(시험용, 저장 생략)
 * @returns {Promise<Object>} 갱신된 캐시
 * [연계] ← startAutoRefresh()·refreshIfStale() / → fetchForecastTimes()·fetchFrame()
 */
async function collect({ limitFrames = 0 } = {}) {
    if (_collecting) { console.log('[swell_sz] 이미 수집 중 — skip'); return _cache; }
    _collecting = true;
    const t0 = Date.now();
    try {
        const ft = await fetchForecastTimes();
        const baseTm = ft.baseTm;
        let fctTimes = ft.fctTimes || [];
        if (limitFrames > 0) fctTimes = fctTimes.slice(0, limitFrames);
        if (!fctTimes.length) { console.error('[swell_sz] 예보시각 목록이 비어있음'); return _cache; }

        const prdct = toViewParamTime(baseTm);
        if (!prdct) { console.error('[swell_sz] 생산시각 형식 이상:', baseTm); return _cache; }

        const frames = await _pool(fctTimes, FRAME_CONCURRENCY,
            tm => {
                const fc = toViewParamTime(tm);
                if (!fc) throw new Error('예보시각 형식 이상: ' + tm);
                return fetchFrame(fc, prdct);
            });

        const n = fctTimes.length;
        const cells = {};
        for (let f = 0; f < frames.length; f++) {
            const rows = frames[f];
            if (!rows) continue;
            for (const row of rows) {
                let c = cells[row.key];
                if (!c) {
                    c = cells[row.key] = {
                        lvl: new Array(n).fill(null),
                        wh: new Array(n).fill(null),
                        wp: new Array(n).fill(null)
                    };
                }
                c.lvl[f] = row.lvl;
                c.wh[f] = row.wh;
                c.wp[f] = row.wp;
            }
        }
        if (!Object.keys(cells).length) { console.error('[swell_sz] 수집 결과가 비어있음 — 캐시 유지'); return _cache; }

        _cache = { baseTm, collectedAt: new Date().toISOString(), fctTimes, cells };
        if (limitFrames === 0) _saveCache();
        console.log(`[swell_sz] 수집 완료: ${n}프레임 × ${Object.keys(cells).length}소해구 `
            + `(${((Date.now() - t0) / 1000).toFixed(0)}s, baseTm=${baseTm})`);
        return _cache;
    } catch (e) {
        console.error('[swell_sz] 수집 실패:', e.message);
        return _cache;
    } finally {
        _collecting = false;
    }
}

/** 캐시를 gzip 으로 저장한다(재부팅 시 재수집 생략용). */
function _saveCache() {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        const gz = zlib.gzipSync(Buffer.from(JSON.stringify({ fmt: 1, ..._cache }), 'utf8'));
        fs.writeFileSync(CACHE_PATH, gz);
        console.log(`[swell_sz] 캐시 저장 ${(gz.length / 1024).toFixed(0)}KB`);
    } catch (e) { console.error('[swell_sz] 캐시 저장 실패:', e.message); }
}

/** 저장된 캐시를 읽어 메모리에 올린다. @returns {boolean} 성공 여부 */
function _loadCache() {
    try {
        if (!fs.existsSync(CACHE_PATH)) return false;
        const obj = JSON.parse(zlib.gunzipSync(fs.readFileSync(CACHE_PATH)).toString('utf8'));
        if (obj && obj.fmt !== 1) { console.log('[swell_sz] 구버전 캐시 포맷 — 무시(재수집)'); return false; }
        if (obj && obj.cells) {
            _cache = obj;
            if (!_cache.fctTimes) _cache.fctTimes = [];
            console.log(`[swell_sz] 캐시 로드: ${Object.keys(obj.cells).length}소해구, `
                + `${_cache.fctTimes.length}프레임, baseTm=${obj.baseTm}`);
            return true;
        }
    } catch (e) { console.error('[swell_sz] 캐시 로드 실패:', e.message); }
    return false;
}

/**
 * 생산시각이 바뀌었으면 다시 수집한다. 같으면 아무것도 하지 않는다.
 * 예: 1시간마다 불려서, baseTm 이 "2026.09.09 21:00" 그대로면 즉시 반환
 * @returns {Promise<boolean>} 재수집했으면 true
 * [연계] ← startAutoRefresh() 의 타이머 / → fetchForecastTimes()·collect()
 */
async function refreshIfStale() {
    try {
        const ft = await fetchForecastTimes();
        if (ft.baseTm && ft.baseTm === _cache.baseTm && Object.keys(_cache.cells).length) return false;
        await collect();
        return true;
    } catch (e) {
        console.error('[swell_sz] 생산시각 확인 실패:', e.message);
        return false;
    }
}

/** 캐시를 읽고, 없거나 낡았으면 한 번 수집한다(부팅 시 1회). */
async function init() {
    _loadCache();
    await refreshIfStale();
}

/** 1시간마다 생산시각을 확인해 바뀌었을 때만 재수집한다. */
function startAutoRefresh() {
    init().catch(e => console.error('[swell_sz] init 실패:', e.message));
    setInterval(() => { refreshIfStale().catch(() => { }); }, POLL_INTERVAL_MS);
}

// ────────────────────────────────────────────────────────────────────────────
// 4. 조회
// ────────────────────────────────────────────────────────────────────────────
/** 캐시 상태 요약. @returns {{baseTm,collectedAt,frames,cells}} */
function getStatus() {
    return {
        baseTm: _cache.baseTm,
        collectedAt: _cache.collectedAt,
        frames: (_cache.fctTimes || []).length,
        cells: Object.keys(_cache.cells || {}).length
    };
}

/**
 * 지금 시각(KST)에 가장 가까운 예보시각의 번호를 구한다.
 * 예: 지금이 16:20 이고 예보가 15:00·18:00 이면 0(15:00) 을 준다.
 * @returns {number} 프레임 번호. 자료가 없으면 0.
 * [연계] ← getFrame() 이 frame 을 지정받지 않았을 때 부른다.
 *          앱은 "지금 상황"을 보고 싶어 하는데 목록의 첫 예보시각은 이미 지난
 *          시각일 수 있어, 첫 칸을 그냥 쓰면 과거를 현재처럼 보여주게 된다.
 */
function nearestFrame() {
    const ft = _cache.fctTimes || [];
    if (!ft.length) return 0;
    const now = Date.now();
    let best = 0, bestDiff = Infinity;
    for (let i = 0; i < ft.length; i++) {
        const m = /(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/.exec(ft[i]);
        if (!m) continue;
        // 예보시각은 KST 표기다. UTC 기준으로 만든 뒤 9시간을 빼 실제 시각으로 맞춘다.
        const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - 9 * 3600000;
        const d = Math.abs(t - now);
        if (d < bestDiff) { bestDiff = d; best = i; }
    }
    return best;
}

/**
 * 지정 프레임(예보시각)의 소해구별 등급을 표로 만든다.
 * 예: getFrame(0) → { fctTm:"2026.09.10 15:00", levels:{ "1-1":1, "1-2":1, ... } }
 * @param {number|null} [frame=null] - null 이면 지금 시각에 가장 가까운 예보시각
 * @param {string[]|null} [onlyKeys=null] - 이 소해구들만 골라 담는다(해안 소해구 424개 등)
 * @returns {{baseTm:string|null, fctTm:string|null, frame:number, levels:Object, wh:Object}}
 * [연계] ← routes/swell_smallzone.js 의 GET /api/swell-smallzone
 */
function getFrame(frame = null, onlyKeys = null) {
    const ft = _cache.fctTimes || [];
    const want = (frame == null) ? nearestFrame() : (Number(frame) || 0);
    const f = Math.max(0, Math.min(ft.length - 1, want));
    const levels = {}, wh = {};
    const keys = onlyKeys && onlyKeys.length ? onlyKeys : Object.keys(_cache.cells || {});
    for (const k of keys) {
        const c = _cache.cells[k];
        if (!c) continue;
        const lv = c.lvl[f];
        if (lv != null) levels[k] = lv;
        if (c.wh[f] != null) wh[k] = c.wh[f];
    }
    return { baseTm: _cache.baseTm, fctTm: ft[f] || null, frame: f, levels, wh };
}

/**
 * 한 소해구의 예보 시계열을 준다.
 * 예: getCell("144-9") → { fctTimes:[...], lvl:[1,1,2,...], wh:[...], wp:[...] }
 * @param {string} key - 소해구 키 "대해구-서브"
 * @returns {Object|null} 없으면 null
 * [연계] ← routes/swell_smallzone.js 의 GET /api/swell-smallzone/cell
 */
function getCell(key) {
    const c = _cache.cells && _cache.cells[key];
    if (!c) return null;
    return { key, baseTm: _cache.baseTm, fctTimes: _cache.fctTimes || [], lvl: c.lvl, wh: c.wh, wp: c.wp };
}

module.exports = {
    init,
    startAutoRefresh,
    refreshIfStale,
    collect,
    getStatus,
    getFrame,
    nearestFrame,
    getCell,
    // 유틸
    LEVEL_NAMES,
    toViewParamTime,
    toCellKey,
    fetchForecastTimes,
    fetchFrame,
};
