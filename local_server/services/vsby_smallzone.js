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
 *   ⚠(2026-10-15 확인) imgList 가 HTTP 200 · 0바이트를 돌려준다(헤더·쿠키를 바꿔도 같음,
 *     MMIS 화면 번들도 같은 주소를 무인증 GET 으로 부름 · gdps/imgList 도 0바이트).
 *     확인 실패는 getStatus().lastCheckOk/lastCheckError/failStreak/failSince 로 드러난다.
 *
 * [대해구 시정 — 소해구 래스터 집계(완전 래스터화)]
 *   해구별 기상전망에서 "대해구" 클릭 시 선 차트는 그 대해구에 속한 9개 소해구
 *   래스터를 프레임별 최악값(min km)으로 집계해 제공(getMajorForGraph). 종전
 *   marine_zone/vs(로그인) 숫자는 RDPS 래스터와 크게 어긋나 제거 — 단일 제품 통일.
 *
 * [캐시 / 영속성]
 *   메모리 상주 + data/vsby_smallzone.json.gz(gzip). 부팅 시 로드, 런 동일하면
 *   재수집 생략(재부팅·머지 안전).
 *   imgList 확인 결과(연속 실패 수 failStreak 등)는 data/vsby_check_state.json 에 남겨
 *   재기동 뒤에도 이어 센다(2026-10-15). 연속 3번 실패하면 관리자 푸시(services/collect_fail_alert).
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const fetch = require('node-fetch');

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
const GEO_PATH = path.join(ROOT, '..', 'client', 'marine_zone_area.json'); // STEP 7: client/ 로 이동
const MAP_PATH = path.join(ROOT, '..', 'client', 'assets', 'zone_grid_map.json'); // STEP 7
const DATA_DIR = path.join(ROOT, 'data');
const CACHE_PATH = path.join(DATA_DIR, 'vsby_smallzone.json.gz');

const KMA_BASE = 'https://marine.kma.go.kr';
const API_V1 = '/mmis_marine_api/v1/kma';
const IMGLIST_URL = `${KMA_BASE}${API_V1}/mdl/rdps/imgList`;

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

/**
 * imgList → { fctTimes:[...], imgs:[...], baseTm } (무인증).
 * 응답이 비었거나 JSON 이 아니면 HTTP 상태·길이·형식을 담아 throw 한다.
 *   (2026-10-15) 기상청이 HTTP 200 · 0바이트를 돌려줘 r.json() 이 「Unexpected end of JSON
 *   input」만 남겼다 — 잘린 응답인지 빈 응답인지 로그로 구분이 안 됐다.
 * @returns {Promise<{fctTimes:string[], imgs:string[], baseTm:string|null}>}
 * [연계] ← refreshIfStale(1시간 폴링) · collect
 */
async function fetchImgList() {
    const r = await fetch(IMGLIST_URL, { headers: _H, timeout: 15000 });
    if (!r.ok) throw new Error('imgList ' + r.status);
    const text = await r.text();
    const ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '없음';
    if (!text.length) throw new Error(`imgList 빈 응답 (HTTP ${r.status}, 0바이트, content-type=${ct})`);
    let j;
    try { j = JSON.parse(text); }
    catch (e) { throw new Error(`imgList JSON 아님 (HTTP ${r.status}, ${text.length}바이트, content-type=${ct}): ${e.message}`); }
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
            let img;
            try { img = await Jimp.read(buf); } catch (e) {
                // ★조용히 넘어가지 않는다 (3-44). 한 프레임을 건너뛰면 **그 시각 값이 통째로 빠지는데**
                //   「그 시각엔 자료가 없었다」와 겉으로 똑같았다.
                console.warn(`[vsby] 프레임 ${f} 디코드 실패 — 그 시각 값 없이 이어간다:`, e && e.message);
                continue;
            }
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
// 4. 대해구 시정 — 소해구 래스터 집계(완전 래스터화)
//    종전 marine_zone/vs(MMIS 로그인) 숫자 폴백은 RDPS 래스터와 크게 어긋나(맑음 vs
//    안개) 한 화면에서 상반돼 보이는 문제가 있어 제거. 대해구/소해구/오버레이를
//    모두 동일한 RDPS 바다안개 래스터 제품으로 통일한다.
// ────────────────────────────────────────────────────────────────────────────
/**
 * 대해구 번호 → 9개 소해구 래스터를 프레임별 "최악값(min km)"으로 집계 → [{t,v}].
 * 안개가 일부 소해구에만 끼어도 대해구 전체를 보수적으로 나쁘게 표기한다.
 * 래스터 미수집/무데이터(범위 밖)면 빈 배열.
 */
function majorRasterSeries(no) {
    const ft = _cache.fctTimes || [];
    if (!ft.length) return [];
    const arrs = [];
    for (let s = 1; s <= 9; s++) { const a = _cache.cells[`${no}-${s}`]; if (a) arrs.push(a); }
    if (!arrs.length) return [];
    const out = [];
    for (let i = 0; i < ft.length; i++) {
        let m = null;
        for (const a of arrs) { const v = a[i]; if (v == null) continue; if (m == null || v < m) m = v; }
        if (m != null) out.push({ t: ft[i] || null, v: m });
    }
    return out;
}

/** [선 차트] 대해구 시정 — 소해구 9칸 래스터 최악값 집계(완전 래스터). 범위 밖이면 빈 series. */
async function getMajorForGraph(no) {
    if (!no) return null;
    return { no, baseTm: _cache.baseTm, series: majorRasterSeries(no), source: 'raster' };
}
async function getMajorForGraphByPoint(lat, lon) {
    const no = pointToMajorNo(Number(lat), Number(lon));
    if (!no) return null;
    return getMajorForGraph(no);
}

// ────────────────────────────────────────────────────────────────────────────
// 5. 공개 API
// ────────────────────────────────────────────────────────────────────────────
function init() { _loadCache(); _loadCheckState(); }

// 마지막 imgList 확인 결과 — getStatus 로 노출. 확인이 계속 실패해도 캐시는 옛 런을 그대로
//   내주므로, 이것이 없으면 「갱신이 멈췄다」가 콘솔 한 줄 말고는 어디에도 안 보였다(2026-10-15).
let _lastCheck = { at: null, ok: null, error: null, failStreak: 0, failSince: null };

// [확인 결과 영속화 — 2026-10-15 사용자 지시 ⓐ] 위 _lastCheck 는 메모리라 재기동·배포마다 연속 실패 수가 0 으로
//   돌아갔다. 그러면 장애 중 재기동할 때마다 관리자 오류현황이 「수집 실패」에서 빠졌다가 약 2시간(3회 확인) 뒤
//   다시 들어왔다(00_docs/operations/risk-forecast-error-history.md 「한계」). 확인할 때마다 작은 파일에 남기고
//   init 에서 되읽는다. data/ 는 운영에서 영속 볼륨(fly.toml [[mounts]] → /app/local_server/data)이다.
//   검사는 VSBY_CHECK_STATE_FILE 로 임시 경로를 준다(실제 data/ 를 건드리지 않게).
const CHECK_STATE_PATH = process.env.VSBY_CHECK_STATE_FILE || path.join(DATA_DIR, 'vsby_check_state.json');

/**
 * 마지막 imgList 확인 결과를 파일에 원자적으로 쓴다. 실패해도 수집은 계속한다(콘솔 한 줄).
 * 예: { at:'2026-10-15T12:00:00.000Z', ok:false, error:'imgList 빈 응답 …', failStreak:2, failSince:'…' }
 * @returns {void}
 * [연계] ← refreshIfStale(확인할 때마다) / → _loadCheckState(재기동 때 되읽음)
 */
function _saveCheckState() {
    const tmp = CHECK_STATE_PATH + '.' + process.pid + '.tmp';
    try {
        fs.mkdirSync(path.dirname(CHECK_STATE_PATH), { recursive: true });
        fs.writeFileSync(tmp, JSON.stringify({ v: 1, ..._lastCheck }));
        fs.renameSync(tmp, CHECK_STATE_PATH);
    } catch (e) {
        try { fs.unlinkSync(tmp); } catch (_) { /* 임시 파일이 없으면 정리할 것도 없다 */ }
        console.error('[vsby_sz] 확인 상태 저장 실패:', e.message);
    }
}

/**
 * 저장해 둔 확인 결과를 되읽는다. 형식이 어긋나면 버리고 처음(0회)부터 센다.
 * 예: 파일 { failStreak:2, … } → 재기동 직후 getStatus().failStreak === 2
 * @returns {boolean} 되읽었으면 true
 * [연계] ← init(startAutoRefresh) / → getStatus → risk_history_sources.visibilitySource(3회 기준)
 */
function _loadCheckState() {
    try {
        if (!fs.existsSync(CHECK_STATE_PATH)) return false;
        const o = JSON.parse(fs.readFileSync(CHECK_STATE_PATH, 'utf8'));
        const iso = (v) => v === null || (typeof v === 'string' && Number.isFinite(Date.parse(v)));
        if (!o || o.v !== 1 || !iso(o.at) || !iso(o.failSince) || ![true, false, null].includes(o.ok) ||
            !(o.error === null || typeof o.error === 'string') || !Number.isInteger(o.failStreak) || o.failStreak < 0) {
            console.error('[vsby_sz] 확인 상태 파일 형식이 맞지 않아 무시');
            return false;
        }
        _lastCheck = { at: o.at, ok: o.ok, error: o.error === null ? null : o.error.slice(0, 300), failStreak: o.failStreak, failSince: o.failSince };
        return true;
    } catch (e) {
        console.error('[vsby_sz] 확인 상태 읽기 실패:', e.message);
        return false;
    }
}

/**
 * 1시간마다 imgList 로 런을 확인하고, 바뀌었으면 수집한다. 확인 결과(연속 실패 수)는 파일에 남기고
 * collect_fail_alert 에 알린다 — 연속 3번 실패면 관리자 푸시, 그 뒤 성공하면 복구 푸시(2026-10-15).
 * ⚠imgList 확인이 성공한 뒤의 PNG 수집 실패(collect)는 여기 연속 실패 수에 들어가지 않는다.
 * @returns {Promise<void>}
 * [연계] ← startAutoRefresh 타이머 / → fetchImgList · _saveCheckState · collect · services/collect_fail_alert.report
 */
async function refreshIfStale() {
    let il;
    const at = new Date().toISOString();
    try { il = await fetchImgList(); } catch (e) {
        console.error('[vsby_sz] imgList 확인 실패:', e.message);
        _lastCheck = { at, ok: false, error: e.message, failStreak: _lastCheck.failStreak + 1, failSince: _lastCheck.failSince || at };
        _saveCheckState();
        // 관리자 푸시 — 시정 예측만 연속 3번 실패해야 보낸다(사용자 확정 2026-10-15 「(나)」). 세는 수는 위 영속 failStreak.
        require('./collect_fail_alert').report('visibility', { ok: false, error: e, streak: _lastCheck.failStreak, since: _lastCheck.failSince });
        return;
    }
    _lastCheck = { at, ok: true, error: null, failStreak: 0, failSince: null };
    _saveCheckState();
    require('./collect_fail_alert').report('visibility', { ok: true });   // 실패 알림을 보냈던 경우에만 「복구」 푸시
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

/**
 * 캐시·갱신 상태. 예: { baseTm:'2026101100', lastFctTm:'2026.10.14 16:00', lastCheckOk:false, failStreak:3, ... }
 * lastFctTm 이 지금보다 과거면 화면에 나갈 앞날 예측이 하나도 없다는 뜻이다.
 * @returns {object}
 * [연계] → routes/vsby_smallzone.js GET /api/vsby-smallzone/status
 *        → risk_history_sources.visibilitySource (관리자 점검 → 데이터 수집현황 → 현재 원천 상태, 1분 감시)
 */
function getStatus() {
    const ft = _cache.fctTimes || [];
    return {
        baseTm: _cache.baseTm,
        collectedAt: _cache.collectedAt,
        cellCount: Object.keys(_cache.cells || {}).length,
        frameCount: ft.length,
        lastFctTm: ft.length ? ft[ft.length - 1] : null,
        lastCheckAt: _lastCheck.at,
        lastCheckOk: _lastCheck.ok,
        lastCheckError: _lastCheck.error,
        failStreak: _lastCheck.failStreak,
        failSince: _lastCheck.failSince,
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
 * 소해구 시계열 — 해당 셀 래스터 우선, 없으면 부모 대해구 래스터 집계(형제 8칸)로
 * 폴백. 완전 래스터화 — marine_zone/vs(로그인) 의존 없음. 부모도 래스터 0이면 none.
 * @returns {{series:[{t,v}], source:'raster'|'major-raster'|'none'}}
 */
function _seriesWithFallback(key) {
    const s = _series(key);
    if (s && s.length) return { series: s, source: 'raster' };
    const parent = String(key).split('-')[0];
    const pr = majorRasterSeries(parent);
    if (pr.length) return { series: pr, source: 'major-raster' };
    return { series: [], source: 'none' };
}

/** 특보구역 코드 → 그 구역 smallZones 시정 묶음 (래스터+대해구 폴백 → 100% 커버). */
async function getZone(zoneCode) {
    let map; try { map = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8')); } catch (e) { return null; }
    const z = map[zoneCode];
    if (!z) return null;
    const cells = {}; const fallback = {};
    for (const k of z.smallZones || []) {
        const r = _seriesWithFallback(k);
        if (r.series.length) { cells[k] = r.series; if (r.source === 'major-raster') fallback[k] = true; }
    }
    return { zone: zoneCode, name: z.name, baseTm: _cache.baseTm, cells, fallback };
}

/** 소해구 키 → 시정 시계열 (셀 래스터 우선, 부모 대해구 래스터 집계 폴백). */
function getCellLazy(key) {
    const r = _seriesWithFallback(key);
    return { cell: key, baseTm: _cache.baseTm, series: r.series, source: r.source };
}

/** 임의 해점 → 그 점이 속한 소해구 시정 (셀 래스터 우선, 부모 대해구 래스터 집계 폴백). */
function getByPoint(lat, lon) {
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
    getMajorForGraph,
    getMajorForGraphByPoint,
    // 유틸
    smallZoneCenter,
    pointToCellKey,
    pointToMajorNo,
    allSmallZoneCenters,
    allMappedSmallZones,
    fetchImgList,
};
