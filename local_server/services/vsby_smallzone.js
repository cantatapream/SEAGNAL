/**
 * ============================================================================
 * 파일명: services/vsby_smallzone.js
 * 역할: MMIS "해구별예측 → 시정"(소해구 단위) 값을 수집·캐시·제공.
 *
 * [데이터 소스 — 검증 완료]
 *   - 소해구 시정(점단위): GET kma/fct/netcdf/small-area/latlon/data/detail?lat&lon
 *       → payload.marine_zone = [{ marineZoneNo:"144_9", fctTm, vs(km), ... }]
 *       (로그인 필요 — marine_client.getAuthedJson 사용)
 *   - 모델 런(생산시각): GET kma/mdl/marine_zone/small-area/fct-tm/list/vs
 *       → payload[0].mdl_data_prdct_time  (이게 바뀔 때만 재수집)
 *
 * [수집 범위]
 *   assets/zone_grid_map.json 의 모든 특보구역 smallZones 합집합(고유 소해구)만.
 *   각 소해구 중심 lat/lon 으로 1회씩 호출(레이트리밋은 marine_client 가 200ms 보장).
 *
 * [캐시 / 영속성]
 *   - 메모리 상주(즉시 추출) + data/vsby_smallzone.json.gz 로 gzip 저장.
 *   - 부팅 시 gz 로드 → 캐시 baseTm 이 현재 런과 같으면 재수집 안 함(재부팅·머지 안전).
 *
 * [표기 규칙은 클라이언트 책임] 단위 km, 20km 상한 클램프 / >10km 투명+텍스트만.
 *   본 모듈은 원값(vs, 소수1자리)을 보관하고, 클램프/색은 표시 단계에서 처리.
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const https = require('https');
const marine = require('./marine_client');

const COLLECT_CONCURRENCY = 12;   // 동시 수집 요청 수 (MMIS 응답 ~2s 대비 벽시계 단축, 0실패 확인)
const POLL_INTERVAL_MS = 60 * 60 * 1000;   // 모델 런 변경 폴링 주기(1시간)

const ROOT = path.join(__dirname, '..');
const GEO_PATH = path.join(ROOT, 'marine_zone_area.json');
const MAP_PATH = path.join(ROOT, 'assets', 'zone_grid_map.json');
const DATA_DIR = path.join(ROOT, 'data');
const CACHE_PATH = path.join(DATA_DIR, 'vsby_smallzone.json.gz');

const API_V1 = '/mmis_marine_api/v1/kma';
const TIMES_PATH = `${API_V1}/mdl/marine_zone/small-area/fct-tm/list/vs`;
const detailPath = (lat, lon) =>
    `${API_V1}/fct/netcdf/small-area/latlon/data/detail?lat=${lat}&lon=${lon}`;

// ── 메모리 캐시 ──
//   { baseTm, collectedAt, cells: { "144-9": [ {t:"2026.06.12 01:00", v:3.2}, ... ] } }
let _cache = { baseTm: null, collectedAt: null, cells: {} };
let _collecting = false;

// ────────────────────────────────────────────────────────────────────────────
// 1. 소해구 중심좌표 (에디터 subBox 와 동일 규칙: subNo=row*3+col+1, row0=북)
// ────────────────────────────────────────────────────────────────────────────
let _cellBox = null;
function _loadCellBox() {
    if (_cellBox) return _cellBox;
    const geo = JSON.parse(fs.readFileSync(GEO_PATH, 'utf8'));
    _cellBox = {};
    for (const f of geo.features) {
        const no = String(f.properties.marine_zone_no);
        let ring = f.geometry.coordinates;
        while (Array.isArray(ring[0]) && Array.isArray(ring[0][0])) ring = ring[0];
        let loMin = Infinity, loMax = -Infinity, laMin = Infinity, laMax = -Infinity;
        for (const [lo, la] of ring) {
            loMin = Math.min(loMin, lo); loMax = Math.max(loMax, lo);
            laMin = Math.min(laMin, la); laMax = Math.max(laMax, la);
        }
        _cellBox[no] = { lonMin: loMin, lonMax: loMax, latMin: laMin, latMax: laMax };
    }
    return _cellBox;
}

/** "144-9" → {lat, lon} 소해구 중심. 부모 없거나 sub 범위 밖이면 null. */
function smallZoneCenter(key) {
    const [parent, subStr] = String(key).split('-');
    const s = parseInt(subStr, 10);
    const box = _loadCellBox()[parent];
    if (!box || !(s >= 1 && s <= 9)) return null;
    const r = Math.floor((s - 1) / 3), c = (s - 1) % 3;
    const dlon = (box.lonMax - box.lonMin) / 3, dlat = (box.latMax - box.latMin) / 3;
    const lon = box.lonMin + (c + 0.5) * dlon;
    const lat = box.latMax - (r + 0.5) * dlat;
    return { lat: +lat.toFixed(4), lon: +lon.toFixed(4) };
}

/** 임의 점(lat/lon) → 그 점이 속한 소해구 키 "부모-서브". 격자 밖이면 null. */
function pointToCellKey(lat, lon) {
    const box = _loadCellBox();
    let parent = null, pb = null;
    for (const no of Object.keys(box)) {
        const b = box[no];
        if (lon >= b.lonMin && lon < b.lonMax && lat >= b.latMin && lat < b.latMax) { parent = no; pb = b; break; }
    }
    if (!parent) return null;
    const dlon = (pb.lonMax - pb.lonMin) / 3, dlat = (pb.latMax - pb.latMin) / 3;
    let c = Math.floor((lon - pb.lonMin) / dlon); c = Math.max(0, Math.min(2, c));
    let r = Math.floor((pb.latMax - lat) / dlat); r = Math.max(0, Math.min(2, r));
    return `${parent}-${r * 3 + c + 1}`;
}

/** zone_grid_map 의 모든 smallZones 합집합(고유, 정렬). */
function allMappedSmallZones() {
    const map = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
    const set = new Set();
    for (const code of Object.keys(map)) {
        (map[code].smallZones || []).forEach(s => set.add(String(s)));
    }
    return [...set].sort((a, b) => {
        const [pa, sa] = a.split('-').map(Number), [pb, sb] = b.split('-').map(Number);
        return pa - pb || sa - sb;
    });
}

// ────────────────────────────────────────────────────────────────────────────
// 2. MMIS 호출
// ────────────────────────────────────────────────────────────────────────────
/** 현재 모델 런(생산시각) 문자열. 실패 시 null. */
async function fetchBaseTm() {
    try {
        const j = await marine.getAuthedJson(TIMES_PATH);
        const arr = j.payload || j.data || [];
        return (arr[0] && (arr[0].mdl_data_prdct_time || arr[0].mdlDataPrdctTime)) || null;
    } catch (e) {
        console.error('[vsby_sz] baseTm 조회 실패:', e.message);
        return null;
    }
}

/** raw https GET(JSON) — 인증 헤더 주입. { status, json } 반환. */
function _httpGetJson(urlPath, headers) {
    return new Promise((resolve, reject) => {
        const req = https.request({
            host: marine.HOST, path: urlPath, method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; SEAGNAL/vsby)',
                'Accept': 'application/json',
                'Referer': `https://${marine.HOST}/mmis/`,
                ...headers
            }, timeout: 20000
        }, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf8');
                let json = null; try { json = JSON.parse(body); } catch (e) { }
                resolve({ status: res.statusCode, body, json });
            });
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.end();
    });
}

/** 시정 시계열 파싱. LOGIN 오류면 'LOGIN' 문자열 반환(상위에서 재로그인). */
function _parseSeries(res) {
    if (res && typeof res.body === 'string' && /"type"\s*:\s*"LOGIN"/.test(res.body)) return 'LOGIN';
    const p = (res && res.json && (res.json.payload || res.json.data)) || {};
    const arr = p.marine_zone || p.marineZone || [];
    if (!Array.isArray(arr) || !arr.length) return null;
    return arr
        .filter(r => r && (r.vs != null) && (r.fctTm || r.fct_tm))
        .map(r => ({ t: r.fctTm || r.fct_tm, v: Math.round(Number(r.vs) * 10) / 10 }));
}

/** 한 소해구 시정 시계열 [{t,v}] (marine_client 단발 경로 — 테스트/소량용). */
async function fetchCellSeries(key) {
    const c = smallZoneCenter(key);
    if (!c) return null;
    try {
        const j = await marine.getAuthedJson(detailPath(c.lat, c.lon));
        return _parseSeries({ json: j, body: JSON.stringify(j) });
    } catch (e) { return null; }
}

/** 동시성 제한 map: items 를 conc 개씩 병렬 처리. */
async function _mapPool(items, conc, fn) {
    let i = 0;
    const workers = Array.from({ length: Math.min(conc, items.length) }, async () => {
        while (i < items.length) {
            const idx = i++;
            await fn(items[idx], idx);
        }
    });
    await Promise.all(workers);
}

// ────────────────────────────────────────────────────────────────────────────
// 3. 수집 / 캐시
// ────────────────────────────────────────────────────────────────────────────
/**
 * 매핑 소해구 전체 수집. opts.limit 지정 시 앞 N개만(테스트용).
 * 동시 수집 방지. 성공 시 _cache 갱신 + 디스크 저장.
 */
async function collect({ limit = 0, baseTm = null, concurrency = COLLECT_CONCURRENCY } = {}) {
    if (_collecting) { console.log('[vsby_sz] 이미 수집 중 — skip'); return _cache; }
    _collecting = true;
    const t0 = Date.now();
    try {
        const bt = baseTm || await fetchBaseTm();
        let keys = allMappedSmallZones();
        if (limit > 0) keys = keys.slice(0, limit);

        let headers = await marine.getAuthHeaders();
        let reloginInFlight = null;   // 토큰 만료 시 1회만 재로그인
        const cells = {};
        let ok = 0, fail = 0;

        await _mapPool(keys, concurrency, async (key) => {
            const c = smallZoneCenter(key);
            if (!c) { fail++; return; }
            for (let attempt = 0; attempt < 2; attempt++) {
                let res;
                try { res = await _httpGetJson(detailPath(c.lat, c.lon), headers); }
                catch (e) { fail++; return; }
                const series = _parseSeries(res);
                if (series === 'LOGIN') {
                    // 공유 재로그인 (동시 다발 401 → 한 번만)
                    if (!reloginInFlight) reloginInFlight = marine.relogin().finally(() => { reloginInFlight = null; });
                    try { headers = await reloginInFlight; } catch (e) { fail++; return; }
                    continue;   // 재시도
                }
                if (series && series.length) { cells[key] = series; ok++; }
                else fail++;
                return;
            }
            fail++;
        });

        _cache = { baseTm: bt, collectedAt: new Date().toISOString(), cells };
        if (limit === 0) _saveCache();   // 부분(테스트) 수집은 저장하지 않음
        console.log(`[vsby_sz] 수집 완료 ${ok}성공/${fail}실패 (${((Date.now() - t0) / 1000).toFixed(0)}s, conc=${concurrency}, baseTm=${bt})`);
        return _cache;
    } finally {
        _collecting = false;
    }
}

function _saveCache() {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        const gz = zlib.gzipSync(Buffer.from(JSON.stringify(_cache), 'utf8'));
        fs.writeFileSync(CACHE_PATH, gz);
        console.log(`[vsby_sz] 캐시 저장 ${(gz.length / 1024).toFixed(0)}KB → ${CACHE_PATH}`);
    } catch (e) {
        console.error('[vsby_sz] 캐시 저장 실패:', e.message);
    }
}

function _loadCache() {
    try {
        if (!fs.existsSync(CACHE_PATH)) return false;
        const buf = zlib.gunzipSync(fs.readFileSync(CACHE_PATH));
        const obj = JSON.parse(buf.toString('utf8'));
        if (obj && obj.cells) {
            _cache = obj;
            console.log(`[vsby_sz] 캐시 로드: ${Object.keys(obj.cells).length}셀, baseTm=${obj.baseTm}`);
            return true;
        }
    } catch (e) {
        console.error('[vsby_sz] 캐시 로드 실패:', e.message);
    }
    return false;
}

// ────────────────────────────────────────────────────────────────────────────
// 4. 공개 API
// ────────────────────────────────────────────────────────────────────────────
/** 부팅 시 1회. 디스크 캐시 로드만(수집은 refreshIfStale 가 판단). */
function init() {
    _loadCache();
}

/** 현재 런과 캐시 baseTm 비교 → 다르거나 캐시 비었으면 수집. */
async function refreshIfStale() {
    if (!marine.AUTH_ENABLED) { console.log('[vsby_sz] 자격증명 없음 — 수집 생략'); return; }
    const cur = await fetchBaseTm();
    const empty = !_cache || !Object.keys(_cache.cells || {}).length;
    if (!cur) { if (empty) console.log('[vsby_sz] baseTm 미확인 + 캐시 없음'); return; }
    if (!empty && _cache.baseTm === cur) return;   // 최신 → 재수집 불필요
    console.log(`[vsby_sz] 갱신 필요 (캐시 baseTm=${_cache.baseTm} → 현재 ${cur})`);
    await collect({ baseTm: cur });
}

function getStatus() {
    return {
        baseTm: _cache.baseTm,
        collectedAt: _cache.collectedAt,
        cellCount: Object.keys(_cache.cells || {}).length,
        cached: fs.existsSync(CACHE_PATH)
    };
}

/** cellKeys(["144-9",...]) → { "144-9": [{t,v}], ... } (없는 셀은 생략). */
function getCells(cellKeys) {
    const out = {};
    for (const k of cellKeys || []) if (_cache.cells[k]) out[k] = _cache.cells[k];
    return out;
}

/**
 * [B1 지연 로딩] 한 소해구 시정 — 캐시 우선, 없으면 MMIS 즉시 1회 수집 후 캐시.
 *  - 같은 셀 재요청은 캐시 히트(즉시). 1회 호출이 전체 시각 시계열을 주므로 슬라이더 즉시.
 *  @returns {Promise<{cell, baseTm, series, cached}|null>}
 */
async function getCellLazy(key) {
    if (!key) return null;
    if (_cache.cells[key]) {
        return { cell: key, baseTm: _cache.baseTm, series: _cache.cells[key], cached: true };
    }
    const series = await fetchCellSeries(key);   // 셀 중심좌표로 MMIS 1회 호출
    if (series && series.length) {
        _cache.cells[key] = series;              // 런 캐시에 적재(다음 호출부터 즉시)
        return { cell: key, baseTm: _cache.baseTm, series, cached: false };
    }
    return { cell: key, baseTm: _cache.baseTm, series: [], cached: false };
}

/** [B1] 임의 해점(lat/lon) → 그 점이 속한 소해구의 시정(지연 로딩). */
async function getByPoint(lat, lon) {
    const key = pointToCellKey(Number(lat), Number(lon));
    if (!key) return null;
    return getCellLazy(key);
}

/** 특보구역 코드 → 그 구역 smallZones 의 시정 시계열 묶음. */
function getZone(zoneCode) {
    let map;
    try { map = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8')); } catch (e) { return null; }
    const z = map[zoneCode];
    if (!z) return null;
    return {
        zone: zoneCode,
        name: z.name,
        baseTm: _cache.baseTm,
        cells: getCells(z.smallZones || [])
    };
}

let _autoStarted = false;
/**
 * 서버 기동 시 1회 호출. 디스크 캐시 로드 → 즉시 1회 갱신 점검 → 이후 1시간마다 폴링.
 * (모델 런이 바뀐 경우에만 실제 수집 — 평상시 부하 0)
 */
function startAutoRefresh() {
    if (_autoStarted) return;
    _autoStarted = true;
    init();
    // 기동 직후 비동기 점검 (서버 listen 을 막지 않음)
    setTimeout(() => { refreshIfStale().catch(e => console.error('[vsby_sz] 초기 갱신 실패:', e.message)); }, 8000);
    setInterval(() => { refreshIfStale().catch(e => console.error('[vsby_sz] 주기 갱신 실패:', e.message)); }, POLL_INTERVAL_MS);
    console.log('[vsby_sz] 자동 갱신 시작 (폴링 1시간, 런 변경 시에만 수집)');
}

module.exports = {
    init,
    startAutoRefresh,
    refreshIfStale,
    collect,
    getStatus,
    getCells,
    getZone,
    getCellLazy,
    getByPoint,
    // 내부 유틸(테스트/라우트 보조)
    pointToCellKey,
    smallZoneCenter,
    allMappedSmallZones,
    fetchBaseTm,
    fetchCellSeries,
};
