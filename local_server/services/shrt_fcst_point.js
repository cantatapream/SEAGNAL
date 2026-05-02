/**
 * ============================================================================
 * 파일명: services/shrt_fcst_point.js
 * 역할: KMA 단기예보 (sky/pty/pop/pcp/sno) 의 임의 lat/lon 점 데이터를 PNG raster
 *       에서 픽셀 sampling 으로 추출 + 임계값 역매핑하여 종합 JSON 으로 반환
 * ============================================================================
 *
 * [언제 쓰이나?]
 *   /api/shrt-fcst-point 라우트가 이 모듈의 sampleFiveAt(lat, lon, fctTm) 을 호출.
 *   클라이언트(js/shrt_forecast_layer.js)가 사용자가 지도를 클릭한 좌표 + 슬라이더
 *   현재 시각을 보내면, 서버가 5개 카테고리 PNG 를 fetch + 메모리 디코딩 + 1픽셀
 *   추출 + 색상→값 변환 후 종합 JSON 으로 응답.
 *
 * [동작 원리 — 초보자 안내]
 *   1) KMA imgList(shrtType) 로 해당 카테고리의 이미지 URL 목록과 시각 목록을 받음.
 *   2) 사용자가 지정한 fctTm (예: "2026.05.03 14:00") 에 해당하는 이미지 URL 선택.
 *   3) 그 PNG 를 서버가 직접 fetch (CORS 무관, 브라우저는 못함).
 *   4) PNG 를 메모리에서 디코딩 (pngjs 라이브러리) → 픽셀 RGBA 버퍼.
 *   5) lat/lon 을 PNG 의 픽셀 좌표 (x, y) 로 변환 (PNG extent 는 KMA 가 정해둠).
 *   6) (x, y) 의 RGBA 픽셀을 읽음 → 알파 0 이면 "예보 없음".
 *   7) RGB 가 우리 LEGEND_PALETTE 의 어느 색에 가장 가까운지 유클리드 거리로 매칭.
 *   8) 그 색의 임계값 (예: pop 24%) 을 반환.
 *
 * [캐시]
 *   같은 PNG 를 매 요청마다 fetch + 디코딩하면 느리고 KMA 부담도 큼.
 *   `(shrtType, fctTm)` 키로 디코딩된 픽셀 버퍼를 메모리에 60분 TTL 캐시.
 *   사용자가 슬라이더를 움직이며 여러 번 클릭해도 거의 즉답 (<10ms).
 *
 * [의존]
 *   - node-fetch v2 (이미 설치되어 있음)
 *   - pngjs v7 (이번에 추가 설치)
 *
 * ============================================================================
 */
'use strict';

const fetch = require('node-fetch');
const { PNG } = require('pngjs');

// ─────────────────────────────────────────────────────────────────────────────
// KMA 설정 — js/shrt_forecast_layer.js 와 1:1 동일해야 함
// ─────────────────────────────────────────────────────────────────────────────
const KMA_BASE = 'https://marine.kma.go.kr';
const IMG_LIST_URL = KMA_BASE + '/mmis_marine_api/v1/kma/shrt/netcdf/imgList';

// PNG 의 지리적 범위 (EPSG:4326 lon-lat) — KMA 가 정해둔 GEMD raster 의 extent.
// 이 사각형 영역이 PNG 의 좌상단(0,0) ~ 우하단(W-1, H-1) 픽셀에 매핑됨.
const EXTENT_LON_MIN = 123.2770767211914;
const EXTENT_LON_MAX = 132.8739022435368;
const EXTENT_LAT_MIN = 31.580740724291122;
const EXTENT_LAT_MAX = 43.44957733154297;

// PNG 크기 (KMA 가 항상 같은 크기로 보냄)
const PNG_W = 959;
const PNG_H = 1186;

// ─────────────────────────────────────────────────────────────────────────────
// 색상 팔레트 — js/shrt_forecast_layer.js 의 POP_COLORS / PCP_COLORS / SNO_COLORS
//   와 1:1 동일. KMA chunk-common.js 에서 추출한 정확한 hex 시퀀스.
// 임계값은 KMA 가 정의한 단계 시작값 (각 색이 표시되기 시작하는 값).
// ─────────────────────────────────────────────────────────────────────────────

// POP — 강수확률 25 단계, 0~100% 4% 간격
const POP_COLORS = [
    '#ffea6e','#ffdc1f','#f9cd00','#e0b900','#ccaa00',
    '#69fc69','#1ef31e','#00d500','#00a400','#008000',
    '#87d9ff','#3ec1ff','#07abff','#008dde','#0077b3',
    '#b3b4de','#8081c7','#4c4eb1','#1f219d','#000390',
    '#da87ff','#c23eff','#ad07ff','#9200e4','#7f00bf'
];
const POP_THRESHOLDS = [0,4,8,12,16,20,24,28,32,36,40,44,48,52,56,60,64,68,72,76,80,84,88,92,96];
const POP_MAX = 100;

// PCP — 강수량 30 단계 mm
const PCP_COLORS = [
    '#ffea6e','#ffdc1f','#f9cd00','#e0b900','#ccaa00',
    '#69fc69','#1ef31e','#00d500','#00a400','#008000',
    '#87d9ff','#3ec1ff','#07abff','#008dde','#0077b3',
    '#b3b4de','#8081c7','#4c4eb1','#1f219d','#000390',
    '#da87ff','#c23eff','#ad07ff','#9200e4','#7f00bf',
    '#fa8585','#f63e3e','#ee0b0b','#d50000','#bf0000'
];
const PCP_THRESHOLDS = [0,0.2,0.4,0.6,0.8,1,1.5,2,3,4,5,6,7,8,9,10,14,18,22,26,30,40,50,60,70,80,160,320,480,640];
const PCP_MAX = 700;

// SNO — 적설 30 단계 cm
const SNO_COLORS = [
    '#ffea6e','#ffdc1f','#f9cd00','#e0b900','#ccaa00',
    '#69fc69','#1ef31e','#00d500','#00a400','#008000',
    '#87d9ff','#3ec1ff','#07abff','#008dde','#0077b3',
    '#b3b4de','#8081c7','#4c4eb1','#1f219d','#000390',
    '#da87ff','#c23eff','#ad07ff','#9200e4','#7f00bf',
    '#fa8585','#f63e3e','#ee0b0b','#d50000','#bf0000'
];
const SNO_THRESHOLDS = [0.1,0.2,0.4,0.6,0.8,1,1.5,2,3,4,5,6,7,8,9,10,12,14,16,18,20,25,30,35,40,45,50,60,70,80];
const SNO_MAX = 90;

// SKY — 카테고리 3종. KMA raster 색상 중심값 (rgba 의 rgb 부분).
// alpha 가 변하지만 rgb 는 동일하므로 매칭은 rgb 만 사용.
const SKY_PALETTE = [
    { rgb: [255, 255, 255], label: '맑음' },
    { rgb: [174, 200, 224], label: '구름많음' },
    { rgb: [56,  120, 152], label: '흐림' }
];

// PTY — 강수형태 3종
const PTY_PALETTE = [
    { rgb: [0x60, 0xd4, 0x7e], label: '비' },
    { rgb: [0x3d, 0xc4, 0xe6], label: '비/눈' },
    { rgb: [0x8e, 0x8e, 0xe6], label: '눈' }
];

// 공통 매핑 테이블
const PALETTES = {
    pop: { colors: POP_COLORS, thresholds: POP_THRESHOLDS, max: POP_MAX, unit: '%' },
    pcp: { colors: PCP_COLORS, thresholds: PCP_THRESHOLDS, max: PCP_MAX, unit: 'mm' },
    sno: { colors: SNO_COLORS, thresholds: SNO_THRESHOLDS, max: SNO_MAX, unit: 'cm' }
};

// ─────────────────────────────────────────────────────────────────────────────
// 내부 캐시
// ─────────────────────────────────────────────────────────────────────────────

const TTL_MS = 60 * 60 * 1000;     // 60 분 (KMA 단기예보 갱신 주기)
const MAX_CACHE_ENTRIES = 200;     // 5 카테고리 × 약 40 frame ≈ 200 안정범위

// imgList 결과 캐시 — { key=shrtType, value={ts, frames:[{url,fct_tm}], fctMap:{tm→url}} }
const _imgListCache = new Map();
const IMG_LIST_TTL = 5 * 60 * 1000;  // 5 분 (KMA 가 새 frame 발표하면 최대 5 분 후 반영)

// 디코딩된 PNG 픽셀 캐시 — { key="shrtType|fct_tm", value={ts, w, h, data: Buffer} }
const _pngCache = new Map();

function _evictOldest(map, max) {
    if (map.size <= max) return;
    // Map 은 insert 순서를 유지 — 가장 먼저 넣은 키가 가장 오래된 것
    const firstKey = map.keys().next().value;
    map.delete(firstKey);
}

// ─────────────────────────────────────────────────────────────────────────────
// hex → [r, g, b]
// ─────────────────────────────────────────────────────────────────────────────
function _hexToRgb(hex) {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
    if (!m) return [0, 0, 0];
    const v = parseInt(m[1], 16);
    return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}
const _POP_RGB = POP_COLORS.map(_hexToRgb);
const _PCP_RGB = PCP_COLORS.map(_hexToRgb);
const _SNO_RGB = SNO_COLORS.map(_hexToRgb);

// ─────────────────────────────────────────────────────────────────────────────
// imgList fetch — 카테고리별 시각/URL 목록
// ─────────────────────────────────────────────────────────────────────────────
async function _getImgList(shrtType) {
    const cached = _imgListCache.get(shrtType);
    if (cached && Date.now() - cached.ts < IMG_LIST_TTL) return cached;

    const url = `${IMG_LIST_URL}?shrtType=${encodeURIComponent(shrtType)}`;
    const res = await fetch(url, { timeout: 15000 });
    if (!res.ok) throw new Error(`KMA imgList ${shrtType} HTTP ${res.status}`);
    const j = await res.json();
    if (!j || j.code !== '0000' || !j.data) throw new Error(`KMA imgList ${shrtType} bad response`);
    const times = j.data.fct_tm_list || [];
    const imgs  = j.data.img_list || [];
    const n = Math.min(times.length, imgs.length);
    const frames = [];
    const fctMap = {};
    for (let i = 0; i < n; i++) {
        frames.push({ fct_tm: times[i], url: imgs[i] });
        fctMap[times[i]] = imgs[i];
    }
    const entry = { ts: Date.now(), frames, fctMap };
    _imgListCache.set(shrtType, entry);
    return entry;
}

// ─────────────────────────────────────────────────────────────────────────────
// PNG fetch + 디코딩 (캐시)
// ─────────────────────────────────────────────────────────────────────────────
async function _getPng(shrtType, fctTm) {
    const key = `${shrtType}|${fctTm}`;
    const cached = _pngCache.get(key);
    if (cached && Date.now() - cached.ts < TTL_MS) return cached;

    const list = await _getImgList(shrtType);
    const imgUrl = list.fctMap[fctTm];
    if (!imgUrl) {
        // fctTm 이 정확히 일치하지 않으면 가장 가까운 시각 자동 선택 (실험적 보호장치)
        const nearest = list.frames.find(f => f.fct_tm === fctTm)
                     || list.frames[0];
        if (!nearest) throw new Error(`No frame for ${shrtType} ${fctTm}`);
        return _getPng(shrtType, nearest.fct_tm);
    }

    const fullUrl = KMA_BASE + imgUrl;
    const res = await fetch(fullUrl, { timeout: 20000 });
    if (!res.ok) throw new Error(`PNG fetch ${shrtType}@${fctTm} HTTP ${res.status}`);
    const buf = await res.buffer();
    // pngjs 동기 디코딩
    const png = PNG.sync.read(buf);
    const entry = {
        ts: Date.now(),
        w: png.width,
        h: png.height,
        data: png.data    // Buffer of length w*h*4 (RGBA per pixel)
    };
    _pngCache.set(key, entry);
    _evictOldest(_pngCache, MAX_CACHE_ENTRIES);
    return entry;
}

// ─────────────────────────────────────────────────────────────────────────────
// lat/lon → PNG 픽셀 좌표 (정수)
//   PNG 의 (0,0) 픽셀이 KMA extent 의 (lon_min, lat_max) 즉 좌상단을 나타냄.
//   y 가 위→아래로 증가하므로 lat 은 max → min 방향.
// ─────────────────────────────────────────────────────────────────────────────
function _lonLatToPixel(lon, lat, w, h) {
    if (lon < EXTENT_LON_MIN || lon > EXTENT_LON_MAX) return null;
    if (lat < EXTENT_LAT_MIN || lat > EXTENT_LAT_MAX) return null;
    const x = Math.round((lon - EXTENT_LON_MIN) / (EXTENT_LON_MAX - EXTENT_LON_MIN) * (w - 1));
    const y = Math.round((EXTENT_LAT_MAX - lat) / (EXTENT_LAT_MAX - EXTENT_LAT_MIN) * (h - 1));
    if (x < 0 || x >= w || y < 0 || y >= h) return null;
    return { x, y };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3x3 mode-filter sampling
//   클릭 정확히 색 경계 픽셀일 가능성 → 주변 3x3 의 픽셀 9개 중 알파 > 0 인 것
//   들의 RGB 다수결 → 가장 빈도 높은 색을 채택. anti-aliasing 영향 완화.
// 반환: { r, g, b, a } (a 는 9개 중 알파 0 이 아닌 픽셀의 평균 알파)
// 알파 > 0 픽셀이 하나도 없으면 null (= 데이터 없음)
// ─────────────────────────────────────────────────────────────────────────────
function _sampleArea(data, w, h, cx, cy) {
    const counts = new Map();   // "r,g,b" → count
    let alphaSum = 0, alphaCnt = 0;
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            const x = cx + dx, y = cy + dy;
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            const idx = (y * w + x) * 4;
            const a = data[idx + 3];
            if (a === 0) continue;
            const r = data[idx], g = data[idx + 1], b = data[idx + 2];
            const key = `${r},${g},${b}`;
            counts.set(key, (counts.get(key) || 0) + 1);
            alphaSum += a; alphaCnt++;
        }
    }
    if (alphaCnt === 0) return null;
    // 가장 빈도 높은 색
    let bestKey = '0,0,0', bestCnt = -1;
    for (const [k, v] of counts) {
        if (v > bestCnt) { bestCnt = v; bestKey = k; }
    }
    const [r, g, b] = bestKey.split(',').map(Number);
    return { r, g, b, a: Math.round(alphaSum / alphaCnt) };
}

// ─────────────────────────────────────────────────────────────────────────────
// RGB → 가장 가까운 팔레트 색상 인덱스 (유클리드 거리)
// distance 가 너무 크면 (≥ 60) 매칭 실패로 -1 반환
// ─────────────────────────────────────────────────────────────────────────────
function _matchPalette(r, g, b, paletteRgb, maxDist) {
    let bestI = -1, bestD = Infinity;
    for (let i = 0; i < paletteRgb.length; i++) {
        const [pr, pg, pb] = paletteRgb[i];
        const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
        if (d < bestD) { bestD = d; bestI = i; }
    }
    if (bestD > (maxDist || 60) ** 2) return -1;
    return bestI;
}

// ─────────────────────────────────────────────────────────────────────────────
// 정량형 (pop/pcp/sno) sampling — 색 → 임계값
// ─────────────────────────────────────────────────────────────────────────────
async function _sampleQuant(shrtType, fctTm, lon, lat) {
    const png = await _getPng(shrtType, fctTm);
    const px = _lonLatToPixel(lon, lat, png.w, png.h);
    if (!px) return { value: null, reason: 'out_of_extent' };
    const sample = _sampleArea(png.data, png.w, png.h, px.x, px.y);
    if (!sample) return { value: null, reason: 'no_data' };  // alpha 0 ─ 예보 없음
    const palette = (shrtType === 'pop') ? _POP_RGB
                  : (shrtType === 'pcp') ? _PCP_RGB
                  : _SNO_RGB;
    const thresholds = (shrtType === 'pop') ? POP_THRESHOLDS
                     : (shrtType === 'pcp') ? PCP_THRESHOLDS
                     : SNO_THRESHOLDS;
    const idx = _matchPalette(sample.r, sample.g, sample.b, palette);
    if (idx < 0) {
        // 매칭 실패 — 디버깅 위해 sampling 한 RGB 도 함께 반환.
        // 일반적으로 anti-aliasing 색이거나 KMA raster 의 "데이터 없음 영역" 의
        // 반투명 색 (예: 적설 PNG 가 0cm 인 지역에 미세한 색 잔재) 임.
        return {
            value: null,
            reason: 'palette_mismatch',
            rgb: [sample.r, sample.g, sample.b],
            alpha: sample.a
        };
    }
    return {
        value: thresholds[idx],
        rgb: [sample.r, sample.g, sample.b],
        alpha: sample.a,
        bandIdx: idx
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 카테고리형 (sky/pty) sampling — 색 → 라벨
// ─────────────────────────────────────────────────────────────────────────────
async function _sampleCategory(shrtType, fctTm, lon, lat) {
    const png = await _getPng(shrtType, fctTm);
    const px = _lonLatToPixel(lon, lat, png.w, png.h);
    if (!px) return { label: null, reason: 'out_of_extent' };
    const sample = _sampleArea(png.data, png.w, png.h, px.x, px.y);
    if (!sample) return { label: null, reason: 'no_data' };
    const palette = (shrtType === 'sky') ? SKY_PALETTE : PTY_PALETTE;
    const idx = _matchPalette(sample.r, sample.g, sample.b, palette.map(p => p.rgb), 80);
    if (idx < 0) return { label: null, reason: 'palette_mismatch' };
    return { label: palette[idx].label, rgb: [sample.r, sample.g, sample.b] };
}

// ─────────────────────────────────────────────────────────────────────────────
// 외부 API — 5개 카테고리 한꺼번에 sampling
//
// @param {number} lat  - 위도 (EPSG:4326)
// @param {number} lon  - 경도 (EPSG:4326)
// @param {string} fctTm - "YYYY.MM.DD HH:mm" 형식 (KMA imgList 응답과 동일 포맷).
//                        클라이언트(js/shrt_forecast_layer.js) 에서 슬라이더 현재
//                        frame 의 label 을 그대로 전달.
// @returns {Promise<Object>} 종합 데이터:
//   {
//     fct_tm: "2026.05.03 14:00",
//     sky: { label: '구름많음', rgb: [r,g,b] }     | null,
//     pty: { label: '비',     rgb: [r,g,b] }     | null,
//     pop: { value: 24, rgb, alpha, bandIdx }    | { value: null, reason },
//     pcp: { value: 0.8, ... }                   | ...,
//     sno: { value: null, reason: 'no_data' }    | ...,
//     extent_check: true,
//     errors: { sky?: '...' }   // 카테고리별 에러 (있으면)
//   }
// ─────────────────────────────────────────────────────────────────────────────
async function sampleFiveAt(lat, lon, fctTm) {
    const errors = {};
    const out = { fct_tm: fctTm, lat, lon };
    // 5 카테고리 병렬 sampling
    const [sky, pty, pop, pcp, sno] = await Promise.all([
        _sampleCategory('sky', fctTm, lon, lat).catch(e => { errors.sky = e.message; return null; }),
        _sampleCategory('pty', fctTm, lon, lat).catch(e => { errors.pty = e.message; return null; }),
        _sampleQuant('pop', fctTm, lon, lat).catch(e => { errors.pop = e.message; return null; }),
        _sampleQuant('pcp', fctTm, lon, lat).catch(e => { errors.pcp = e.message; return null; }),
        _sampleQuant('sno', fctTm, lon, lat).catch(e => { errors.sno = e.message; return null; })
    ]);
    out.sky = sky; out.pty = pty; out.pop = pop; out.pcp = pcp; out.sno = sno;
    if (Object.keys(errors).length) out.errors = errors;
    return out;
}

module.exports = { sampleFiveAt };
