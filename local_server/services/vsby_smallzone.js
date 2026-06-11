/**
 * ============================================================================
 * 파일명: services/vsby_smallzone.js
 * 역할: 해구별 시정(視程) 데이터 수집·캐시·제공.
 *
 * [소해구 시정 — 래스터 색 추출 방식]
 *   MMIS 는 소해구 시정 "숫자"를 3시간 간격(지점상세)으로만 제공한다. 그러나
 *   같은 KIM RDPS 시정 모델의 고해상도 PNG(바다안개→시정예측)는 1시간 간격으로
 *   제공되며, 이를 각 소해구 중심 좌표에서 픽셀 샘플 → 범례(VSBY_STOPS) 색
 *   역매칭하면 "소해구별 1시간 시정(km, 11단계 버킷)"을 전 해역에 대해 얻는다.
 *   - RDPS imgList(무인증): GET /mmis_marine_api/v1/kma/mdl/rdps/imgList
 *       → { fct_tm_list:[...], img_list:["/resources/mdl/khope/mvis/.../*.png", ...] }
 *   - PNG 본체(무인증): https://marine.kma.go.kr + img_list[i]
 *   - PNG 배치: EPSG:4326, extent = MMIS 번들 검증값(아래 VSBY_EXTENT).
 *   런(생산시각)은 img 경로의 RDPS_<YYYYMMDDHH>_VIS 에서 추출 → 바뀔 때만 재수집.
 *
 * [대해구 시정 — 숫자(정밀)]
 *   해구별 기상전망에서 "대해구" 클릭 시 선 차트는 정밀 숫자가 필요하므로
 *   대해구 1시간 시계열(marine_zone/vs, 로그인)을 별도 제공(getMajorSeries).
 *
 * [캐시 / 영속성]
 *   메모리 상주 + data/vsby_smallzone.json.gz(gzip). 부팅 시 로드, 런 동일하면
 *   재수집 생략(재부팅·머지 안전).
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const fetch = require('node-fetch');
const marine = require('./marine_client');

// jimp 는 지연·가드 로드 — 미설치/로드 실패해도 서버 부팅을 막지 않는다(래스터 수집만 비활성).
//   (package.json 에 jimp 가 없거나 프로덕션 설치 누락 시에도 require 단계 크래시 방지)
let _Jimp = undefined;
function _ensureJimp() {
    if (_Jimp !== undefined) return _Jimp;
    try { _Jimp = require('jimp').Jimp || null; }
    catch (e) { console.error('[vsby_sz] jimp 로드 실패 — 래스터 수집 비활성:', e.message); _Jimp = null; }
    return _Jimp;
}

const ROOT = path.join(__dirname, '..');
const GEO_PATH = path.join(ROOT, 'marine_zone_area.json');
const MAP_PATH = path.join(ROOT, 'assets', 'zone_grid_map.json');
const DATA_DIR = path.join(ROOT, 'data');
const CACHE_PATH = path.join(DATA_DIR, 'vsby_smallzone.json.gz');

const KMA_BASE = 'https://marine.kma.go.kr';
const API_V1 = '/mmis_marine_api/v1/kma';
const IMGLIST_URL = `${KMA_BASE}${API_V1}/mdl/rdps/imgList`;
const majorSeriesPath = (no) => `${API_V1}/mdl/marine_zone/vs/${no}/list`;   // 대해구 1시간 숫자(로그인)

const DOWNLOAD_CONCURRENCY = 6;            // PNG 동시 다운로드
const POLL_INTERVAL_MS = 60 * 60 * 1000;   // 런 변경 폴링(1시간)

// RDPS 시정 PNG 배치 (EPSG:4326) — MMIS 번들서 검증한 정확값.
const VSBY_EXTENT = [123.2770767211914, 31.580740724291122, 132.8739022435368, 43.44957733154297];
// 범례(km → RGB) — vsby_forecast_layer.js VSBY_STOPS 와 동일.
const VSBY_STOPS = [
    { v: 0.0, c: [255, 43, 214] }, { v: 0.2, c: [230, 0, 0] }, { v: 0.6, c: [255, 127, 0] },
    { v: 1.0, c: [255, 181, 71] }, { v: 2.0, c: [255, 232, 0] }, { v: 3.0, c: [200, 214, 0] },
    { v: 5.0, c: [22, 180, 26] }, { v: 7.0, c: [111, 223, 111] }, { v: 10.0, c: [31, 182, 214] },
    { v: 14.0, c: [47, 123, 230] }, { v: 20.0, c: [255, 255, 255] }
];

// ── 캐시 ──
//  { baseTm, collectedAt, fctTimes:[...], cells:{ "144-9":[km,km,...](프레임별) } }
let _cache = { baseTm: null, collectedAt: null, fctTimes: [], cells: {} };
let _collecting = false;

// ────────────────────────────────────────────────────────────────────────────
// 1. 격자 / 소해구 중심좌표
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

/** "144-9" → {lat,lon} 소해구 중심. */
function smallZoneCenter(key) {
    const [parent, subStr] = String(key).split('-');
    const s = parseInt(subStr, 10);
    const b = _loadCellBox()[parent];
    if (!b || !(s >= 1 && s <= 9)) return null;
    const r = Math.floor((s - 1) / 3), c = (s - 1) % 3;
    const dlon = (b.lonMax - b.lonMin) / 3, dlat = (b.latMax - b.latMin) / 3;
    return { lat: +(b.latMax - (r + 0.5) * dlat).toFixed(4), lon: +(b.lonMin + (c + 0.5) * dlon).toFixed(4) };
}

/** 전 소해구 중심 [{key,lon,lat}] (1331 대해구 × 9 ≈ 12000). */
let _allCenters = null;
function allSmallZoneCenters() {
    if (_allCenters) return _allCenters;
    const box = _loadCellBox();
    const out = [];
    for (const no of Object.keys(box)) {
        const b = box[no];
        const dlon = (b.lonMax - b.lonMin) / 3, dlat = (b.latMax - b.latMin) / 3;
        for (let s = 1; s <= 9; s++) {
            const r = Math.floor((s - 1) / 3), c = (s - 1) % 3;
            out.push({
                key: `${no}-${s}`,
                lon: b.lonMin + (c + 0.5) * dlon,
                lat: b.latMax - (r + 0.5) * dlat
            });
        }
    }
    _allCenters = out;
    return out;
}

/** 임의 점 → 소해구 키 "부모-서브". 격자 밖이면 null. */
function pointToCellKey(lat, lon) {
    const box = _loadCellBox();
    let parent = null, pb = null;
    for (const no of Object.keys(box)) {
        const b = box[no];
        if (lon >= b.lonMin && lon < b.lonMax && lat >= b.latMin && lat < b.latMax) { parent = no; pb = b; break; }
    }
    if (!parent) return null;
    const dlon = (pb.lonMax - pb.lonMin) / 3, dlat = (pb.latMax - pb.latMin) / 3;
    let c = Math.max(0, Math.min(2, Math.floor((lon - pb.lonMin) / dlon)));
    let r = Math.max(0, Math.min(2, Math.floor((pb.latMax - lat) / dlat)));
    return `${parent}-${r * 3 + c + 1}`;
}

/** 임의 점 → 대해구 번호. */
function pointToMajorNo(lat, lon) {
    const box = _loadCellBox();
    for (const no of Object.keys(box)) {
        const b = box[no];
        if (lon >= b.lonMin && lon < b.lonMax && lat >= b.latMin && lat < b.latMax) return no;
    }
    return null;
}

// ────────────────────────────────────────────────────────────────────────────
// 2. 래스터 샘플 헬퍼
// ────────────────────────────────────────────────────────────────────────────
/** lon/lat → PNG 픽셀 (extent 안일 때만). */
function _lonLatToPx(lon, lat, W, H) {
    const E = VSBY_EXTENT;
    if (lon < E[0] || lon > E[2] || lat < E[1] || lat > E[3]) return null;
    const x = Math.round((lon - E[0]) / (E[2] - E[0]) * (W - 1));
    const y = Math.round((E[3] - lat) / (E[3] - E[1]) * (H - 1));
    if (x < 0 || x >= W || y < 0 || y >= H) return null;
    return { x, y };
}

/** (x,y) 3x3 최빈 불투명 RGB → 최근접 VSBY_STOPS km. 무데이터면 null. */
function _sampleKm(data, W, H, x, y) {
    const counts = {};
    let best = null, bestN = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const i = (yy * W + xx) * 4;
        if (data[i + 3] < 128) continue;           // 투명 무시
        const k = data[i] + ',' + data[i + 1] + ',' + data[i + 2];
        counts[k] = (counts[k] || 0) + 1;
        if (counts[k] > bestN) { bestN = counts[k]; best = [data[i], data[i + 1], data[i + 2]]; }
    }
    if (!best) return null;
    let bi = 0, bd = Infinity;
    for (let i = 0; i < VSBY_STOPS.length; i++) {
        const C = VSBY_STOPS[i].c;
        const d = (best[0] - C[0]) ** 2 + (best[1] - C[1]) ** 2 + (best[2] - C[2]) ** 2;
        if (d < bd) { bd = d; bi = i; }
    }
    return VSBY_STOPS[bi].v;
}

// ────────────────────────────────────────────────────────────────────────────
// 3. RDPS imgList / 수집
// ────────────────────────────────────────────────────────────────────────────
const _H = { Referer: `${KMA_BASE}/mmis/`, 'User-Agent': 'Mozilla/5.0 (SEAGNAL/vsby)' };

/** imgList → { fctTimes:[...], imgs:[...], baseTm } (무인증). */
async function fetchImgList() {
    const r = await fetch(IMGLIST_URL, { headers: _H, timeout: 15000 });
    if (!r.ok) throw new Error('imgList ' + r.status);
    const j = await r.json();
    const fctTimes = (j.data && j.data.fct_tm_list) || [];
    const imgs = (j.data && j.data.img_list) || [];
    const m = /RDPS_(\d{10})_VIS/.exec(imgs[0] || '');
    return { fctTimes, imgs, baseTm: m ? m[1] : (fctTimes[0] || null) };
}

/** 한 PNG 다운로드 → Buffer. */
async function _downloadPng(imgPath) {
    const r = await fetch(KMA_BASE + imgPath, { headers: _H, timeout: 20000 });
    if (!r.ok) throw new Error('png ' + r.status);
    return Buffer.from(await r.arrayBuffer());
}

/** 동시성 제한 풀. */
async function _pool(items, conc, fn) {
    let i = 0; const out = new Array(items.length);
    const workers = Array.from({ length: Math.min(conc, items.length) }, async () => {
        while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx).catch(() => null); }
    });
    await Promise.all(workers);
    return out;
}

/**
 * 전 소해구 × 전 프레임(1시간) 래스터 샘플 → 캐시.
 * opts.limitFrames: 앞 N 프레임만(테스트용, 저장 안 함).
 */
async function collect({ baseTm = null, limitFrames = 0 } = {}) {
    if (_collecting) { console.log('[vsby_sz] 이미 수집 중 — skip'); return _cache; }
    const Jimp = _ensureJimp();
    if (!Jimp) { console.warn('[vsby_sz] jimp 없음 — 래스터 수집 생략(대해구 폴백만 동작)'); return _cache; }
    _collecting = true;
    const t0 = Date.now();
    try {
        const il = await fetchImgList();
        const bt = baseTm || il.baseTm;
        let imgs = il.imgs, fctTimes = il.fctTimes;
        if (limitFrames > 0) { imgs = imgs.slice(0, limitFrames); fctTimes = fctTimes.slice(0, limitFrames); }
        if (!imgs.length) { console.error('[vsby_sz] imgList 비어있음'); return _cache; }

        // 1) PNG 전부 버퍼로 다운로드(동시성)
        const bufs = await _pool(imgs, DOWNLOAD_CONCURRENCY, p => _downloadPng(p));

        // 2) 첫 유효 이미지로 W/H 확정 → 전 소해구 픽셀좌표 1회 계산
        const centers = allSmallZoneCenters();
        let W = 0, H = 0;
        for (const b of bufs) { if (b) { const im = await Jimp.read(b); W = im.bitmap.width; H = im.bitmap.height; break; } }
        if (!W) { console.error('[vsby_sz] 유효 PNG 없음'); return _cache; }
        const px = centers.map(c => _lonLatToPx(c.lon, c.lat, W, H));   // null = extent 밖

        // 3) 프레임별 디코드 + 전 소해구 샘플 (메모리 위해 순차 디코드)
        const cells = {};
        for (let f = 0; f < bufs.length; f++) {
            const buf = bufs[f];
            if (!buf) continue;
            let img; try { img = await Jimp.read(buf); } catch (e) { continue; }
            const data = img.bitmap.data;
            for (let ci = 0; ci < centers.length; ci++) {
                const p = px[ci]; if (!p) continue;
                const km = _sampleKm(data, W, H, p.x, p.y);
                if (km == null) continue;
                const key = centers[ci].key;
                let arr = cells[key]; if (!arr) { arr = cells[key] = new Array(bufs.length).fill(null); }
                arr[f] = km;
            }
        }
        // 4) 전부 null 인 셀(육지/도메인밖) 제거
        for (const k of Object.keys(cells)) if (cells[k].every(v => v == null)) delete cells[k];

        _cache = { baseTm: bt, collectedAt: new Date().toISOString(), fctTimes, cells };
        if (limitFrames === 0) _saveCache();
        const nCells = Object.keys(cells).length;
        console.log(`[vsby_sz] 래스터 수집 완료: ${imgs.length}프레임 × ${nCells}셀 (${((Date.now() - t0) / 1000).toFixed(0)}s, baseTm=${bt})`);
        return _cache;
    } catch (e) {
        console.error('[vsby_sz] 수집 실패:', e.message);
        return _cache;
    } finally {
        _collecting = false;
    }
}

function _saveCache() {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        const gz = zlib.gzipSync(Buffer.from(JSON.stringify({ fmt: 2, ..._cache }), 'utf8'));
        fs.writeFileSync(CACHE_PATH, gz);
        console.log(`[vsby_sz] 캐시 저장 ${(gz.length / 1024).toFixed(0)}KB`);
    } catch (e) { console.error('[vsby_sz] 캐시 저장 실패:', e.message); }
}

function _loadCache() {
    try {
        if (!fs.existsSync(CACHE_PATH)) return false;
        const obj = JSON.parse(zlib.gunzipSync(fs.readFileSync(CACHE_PATH)).toString('utf8'));
        if (obj && obj.fmt !== 2) { console.log('[vsby_sz] 구버전 캐시 포맷 — 무시(재수집)'); return false; }
        if (obj && obj.cells) {
            _cache = obj;
            if (!_cache.fctTimes) _cache.fctTimes = [];
            console.log(`[vsby_sz] 캐시 로드: ${Object.keys(obj.cells).length}셀, ${(_cache.fctTimes || []).length}프레임, baseTm=${obj.baseTm}`);
            return true;
        }
    } catch (e) { console.error('[vsby_sz] 캐시 로드 실패:', e.message); }
    return false;
}

// ────────────────────────────────────────────────────────────────────────────
// 4. 대해구 1시간 숫자(정밀) — 선 차트용 (로그인)
// ────────────────────────────────────────────────────────────────────────────
const _majorCache = {};
async function getMajorSeries(no) {
    if (!no) return null;
    const cached = _majorCache[no];
    if (cached && cached.baseTm === _cache.baseTm) return { no, baseTm: _cache.baseTm, series: cached.series, cached: true };
    try {
        const j = await marine.getAuthedJson(majorSeriesPath(no));
        const arr = j.data || j.payload || [];
        const series = (Array.isArray(arr) ? arr : [])
            .filter(r => r && r.vs != null && (r.fct_tm || r.fctTm))
            .map(r => ({ t: r.fct_tm || r.fctTm, v: Math.round(Number(r.vs) * 10) / 10 }));
        _majorCache[no] = { baseTm: _cache.baseTm, series };
        return { no, baseTm: _cache.baseTm, series, cached: false };
    } catch (e) { return { no, baseTm: _cache.baseTm, series: [], cached: false }; }
}
async function getMajorByPoint(lat, lon) {
    const no = pointToMajorNo(Number(lat), Number(lon));
    if (!no) return null;
    return getMajorSeries(no);
}

// ────────────────────────────────────────────────────────────────────────────
// 5. 공개 API
// ────────────────────────────────────────────────────────────────────────────
function init() { _loadCache(); }

async function refreshIfStale() {
    let il;
    try { il = await fetchImgList(); } catch (e) { console.error('[vsby_sz] imgList 확인 실패:', e.message); return; }
    const empty = !_cache || !Object.keys(_cache.cells || {}).length;
    if (!il.baseTm) { if (empty) console.log('[vsby_sz] baseTm 미확인 + 캐시 없음'); return; }
    if (!empty && _cache.baseTm === il.baseTm) return;   // 최신
    console.log(`[vsby_sz] 갱신 필요 (캐시 ${_cache.baseTm} → 현재 ${il.baseTm})`);
    await collect({ baseTm: il.baseTm });
}

let _autoStarted = false;
function startAutoRefresh() {
    if (_autoStarted) return;
    _autoStarted = true;
    init();
    setTimeout(() => { refreshIfStale().catch(e => console.error('[vsby_sz] 초기 갱신 실패:', e.message)); }, 8000);
    setInterval(() => { refreshIfStale().catch(e => console.error('[vsby_sz] 주기 갱신 실패:', e.message)); }, POLL_INTERVAL_MS);
    console.log('[vsby_sz] 자동 갱신 시작 (래스터, 폴링 1시간)');
}

function getStatus() {
    return {
        baseTm: _cache.baseTm,
        collectedAt: _cache.collectedAt,
        cellCount: Object.keys(_cache.cells || {}).length,
        frameCount: (_cache.fctTimes || []).length,
        cached: fs.existsSync(CACHE_PATH)
    };
}

/** 셀 km 배열 → [{t,v}] (fctTimes 와 1:1). */
function _series(key) {
    const arr = _cache.cells[key];
    if (!arr) return null;
    const ft = _cache.fctTimes || [];
    const out = [];
    for (let i = 0; i < arr.length; i++) if (arr[i] != null) out.push({ t: ft[i] || null, v: arr[i] });
    return out;
}

/** cellKeys → { key:[{t,v}] } (래스터만, 없는 셀 생략 — 내부/상태용). */
function getCells(cellKeys) {
    const out = {};
    for (const k of cellKeys || []) { const s = _series(k); if (s && s.length) out[k] = s; }
    return out;
}

/**
 * 소해구 시계열 — 래스터 우선, 없으면 부모 대해구 1시간 숫자로 폴백(100% 커버).
 * @returns {Promise<{series:[{t,v}], source:'raster'|'major'|'none'}>}
 */
async function _seriesWithFallback(key) {
    const s = _series(key);
    if (s && s.length) return { series: s, source: 'raster' };
    const parent = String(key).split('-')[0];
    const mj = await getMajorSeries(parent);
    if (mj && mj.series && mj.series.length) return { series: mj.series, source: 'major' };
    return { series: [], source: 'none' };
}

/** 특보구역 코드 → 그 구역 smallZones 시정 묶음 (래스터+대해구 폴백 → 100% 커버). */
async function getZone(zoneCode) {
    let map; try { map = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8')); } catch (e) { return null; }
    const z = map[zoneCode];
    if (!z) return null;
    const cells = {}; const fallback = {};
    for (const k of z.smallZones || []) {
        const r = await _seriesWithFallback(k);
        if (r.series.length) { cells[k] = r.series; if (r.source === 'major') fallback[k] = true; }
    }
    return { zone: zoneCode, name: z.name, baseTm: _cache.baseTm, cells, fallback };
}

/** 소해구 키 → 시정 시계열 (래스터 우선, 대해구 폴백). */
async function getCellLazy(key) {
    const r = await _seriesWithFallback(key);
    return { cell: key, baseTm: _cache.baseTm, series: r.series, source: r.source };
}

/** 임의 해점 → 그 점이 속한 소해구 시정 (래스터 우선, 대해구 폴백). */
async function getByPoint(lat, lon) {
    const key = pointToCellKey(Number(lat), Number(lon));
    if (!key) return null;
    return getCellLazy(key);
}

function allMappedSmallZones() {
    const map = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
    const set = new Set();
    for (const code of Object.keys(map)) (map[code].smallZones || []).forEach(s => set.add(String(s)));
    return [...set];
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
    getMajorSeries,
    getMajorByPoint,
    // 유틸
    smallZoneCenter,
    pointToCellKey,
    pointToMajorNo,
    allSmallZoneCenters,
    allMappedSmallZones,
    fetchImgList,
};
