/**
 * ============================================================================
 * 파일명: local_server/scripts/build_coastline_segments.js
 * 역할: 해안선을 짧은 조각으로 잘라 "이 조각은 몇 번 소해구다"를 미리 붙여둔다.
 *       앱은 이 파일 + 소해구별 너울 등급만 받아 해안선을 색칠한다.
 *
 * [왜 미리 만드나]
 *   해안선 점이 한국 범위에만 약 2만 개다. 앱이 켜질 때마다 "이 점이 어느 소해구냐"를
 *   2만 번 계산하면 휴대폰이 버벅인다. 답이 절대 변하지 않는 계산이므로 한 번만 해서
 *   파일로 굳혀 둔다(너울 등급만 3시간마다 바뀐다).
 *
 * [입력]
 *   client/land_mask_korea.json   → { rings: [[[lon,lat],...], ...] } 해안선 폴리곤
 *   client/marine_zone_area.json  → 대해구(0.5°) 경계. 소해구는 이것을 3×3 으로 나눈 칸.
 *   local_server/data/tide_field/coastline_cells.json
 *                                 → 국립해양조사원 전자해도 해안선(우리나라 것만).
 *                                    "이 해안선이 우리나라 것인가"를 가리는 데 쓴다.
 *
 * [왜 우리나라 것만 남기나]
 *   land_mask_korea.json 은 이름과 달리 잘라낸 상자 안의 모든 육지를 담고 있다 —
 *   일본 규슈·고토열도, 중국 산둥, 북한 해안이 함께 들어 있다. 이것을 그대로 쓰면
 *   기상청 너울 모델이 일본 앞바다까지 덮고 있어서 **일본 해안선에도 색이 칠해진다.**
 *   (2026-09-10 실서비스에서 실제로 그렇게 나온 것을 확인하고 고쳤다.)
 *   그래서 전자해도 해안선에서 KEEP_KM 이내인 조각만 남긴다.
 *
 * [출력]
 *   client/coastline_segments.json
 *     { generated_at, cell_deg, zones:["144-9",...], zone_centers:{"144-9":[lon,lat],...},
 *       segments:[ { z:"144-9", c:[lon,lat,...] } ] }
 *   - segments 의 c 는 [lon,lat,lon,lat,...] 평면 배열(용량 절약)
 *   - 한 조각은 같은 소해구에 속하는 연속된 해안선 점들이다. 소해구가 바뀌면 조각을 끊고,
 *     경계에서 색이 끊겨 보이지 않도록 다음 조각이 앞 조각의 끝점부터 시작한다.
 *
 * [실행]
 *   node local_server/scripts/build_coastline_segments.js
 *
 * [연계]
 *  - 나를 쓰는 곳 : client/js/marine-life/swell/swell.js (fetch 로 읽어 지도에 그림)
 *  - 같이 쓰는 것 : routes/swell_smallzone.js (coast=1 일 때 zones 목록을 사용)
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');
const LAND_PATH = path.join(CLIENT_DIR, 'land_mask_korea.json');
const ZONE_PATH = path.join(CLIENT_DIR, 'marine_zone_area.json');
const OUT_PATH = path.join(CLIENT_DIR, 'coastline_segments.json');
const KHOA_COAST_PATH = path.join(__dirname, '..', 'data', 'tide_field', 'coastline_cells.json');

/** 우리가 다루는 한국 범위(이 밖의 해안선은 버린다). */
const BBOX = { lonMin: 124.0, lonMax: 132.0, latMin: 32.0, latMax: 39.0 };

/** 좌표 소수 자릿수. 4자리 ≈ 11m — 해안선 표시에 충분하고 용량이 절반이 된다. */
const COORD_DIGITS = 4;

/**
 * 전자해도 해안선에서 이 거리 안에 있으면 "우리나라 해안"으로 본다(km).
 * 두 자료(성긴 land_mask / 정밀한 전자해도)가 어긋나는 폭을 흡수할 만큼 넉넉하되,
 * 가장 가까운 남의 해안(쓰시마 ↔ 부산 약 50km)보다는 훨씬 작아야 한다.
 * 실측: 1km 56.5% · 5km 57.8% · 10km 58.6% — 3~10km 사이에서 결과가 거의 안 변한다.
 */
const KEEP_KM = 5;

/**
 * 전자해도 해안선 자료가 못 담는 우리 섬 — 여기 안이면 거리와 무관하게 남긴다.
 * coastline_cells.json 은 경도 124.59~129.59 범위라 울릉도·독도가 빠져 있다.
 * (독도는 land_mask 해상도에서 조각이 잡히지 않아 실제로는 남는 것이 없지만,
 *  자료가 정밀해지면 자동으로 들어오도록 함께 적어 둔다.)
 */
const EXTRA_KEEP_BOXES = [
    { name: '울릉도', lonMin: 130.75, lonMax: 131.00, latMin: 37.40, latMax: 37.60 },
    { name: '독도',   lonMin: 131.80, lonMax: 131.95, latMin: 37.20, latMax: 37.30 }
];

/**
 * 이웃한 두 점이 이보다 멀면 다른 해안으로 보고 선을 끊는다(도 단위, 약 5.5km).
 * 큰 링(유라시아 대륙)이 한국 범위를 들락날락할 때 엉뚱한 직선이 생기는 것을 막는다.
 */
const MAX_GAP_DEG = 0.05;

// ────────────────────────────────────────────────────────────────────────────
/**
 * 대해구 경계 파일을 읽어 "번호 → 사각형" 표와 "격자 원점 → 번호" 표를 만든다.
 * 예: box["1"] = {lonMin:131.5, latMin:42.5, lonMax:132.0, latMax:43.0}
 * @returns {{box:Object, grid:Map}} box=번호별 사각형, grid=0.5° 격자 원점("131.5,42.5")→번호
 * [연계] → zoneKeyOf() 가 점 하나를 소해구에 넣을 때 쓴다.
 */
function loadZoneBoxes() {
    const geo = JSON.parse(fs.readFileSync(ZONE_PATH, 'utf8'));
    const box = {};
    const grid = new Map();
    for (const f of geo.features) {
        const no = String(f.properties.marine_zone_no);
        let ring = f.geometry.coordinates;
        while (Array.isArray(ring[0]) && Array.isArray(ring[0][0])) ring = ring[0];
        let loMin = Infinity, loMax = -Infinity, laMin = Infinity, laMax = -Infinity;
        for (const [lo, la] of ring) {
            if (lo < loMin) loMin = lo;
            if (lo > loMax) loMax = lo;
            if (la < laMin) laMin = la;
            if (la > laMax) laMax = la;
        }
        box[no] = { lonMin: loMin, lonMax: loMax, latMin: laMin, latMax: laMax };
        grid.set(`${Math.round(loMin * 2) / 2},${Math.round(laMin * 2) / 2}`, no);
    }
    return { box, grid };
}

/**
 * 점 하나가 속한 소해구 키를 구한다.
 * 예: zoneKeyOf(131.55, 42.9, ...) → "1-1" (대해구 1번의 북서쪽 첫 칸)
 * @param {number} lon 경도
 * @param {number} lat 위도
 * @param {Object} box 번호별 대해구 사각형
 * @param {Map} grid 격자 원점 → 대해구 번호
 * @returns {string|null} "대해구-서브(1~9)". 격자 밖이면 null.
 * [연계] ← build() 가 해안선 점마다 부른다.
 *          1~9 배치(좌상단부터 가로 우선)는 services/vsby_smallzone.js 의
 *          smallZoneCenter() 및 MMIS 의 zone_sub_idx 와 같다.
 */
function zoneKeyOf(lon, lat, box, grid) {
    const lo0 = Math.floor(lon * 2) / 2;
    const la0 = Math.floor(lat * 2) / 2;
    const no = grid.get(`${lo0},${la0}`);
    if (!no) return null;
    const b = box[no];
    const dlon = (b.lonMax - b.lonMin) / 3;
    const dlat = (b.latMax - b.latMin) / 3;
    const c = Math.max(0, Math.min(2, Math.floor((lon - b.lonMin) / dlon)));
    const r = Math.max(0, Math.min(2, Math.floor((b.latMax - lat) / dlat)));
    return `${no}-${r * 3 + c + 1}`;
}

/**
 * 소해구 키에서 그 칸의 한가운데 좌표를 구한다.
 * 예: zoneCenterOf("47-6", ...) → [128.42, 38.67]
 * @param {string} key "대해구-서브(1~9)"
 * @param {Object} box 번호별 대해구 사각형
 * @returns {[number,number]|null} [경도, 위도]. 대해구를 모르면 null.
 * [연계] ← build() 가 zone_centers 를 만들 때 부른다.
 *          → client/js/marine-life/swell/swell.js 가 이 좌표들로 등급을 부드럽게
 *            섞는다(가까운 소해구 여럿의 거리가중 평균). 그래서 칸 경계에서 색이
 *            뚝 끊기지 않는다. 칸 배치(1~9)는 zoneKeyOf() 와 같은 규칙이다.
 */
function zoneCenterOf(key, box) {
    const dash = key.lastIndexOf('-');
    const no = key.slice(0, dash);
    const sub = parseInt(key.slice(dash + 1), 10);
    const b = box[no];
    if (!b || !(sub >= 1 && sub <= 9)) return null;
    const c = (sub - 1) % 3;
    const r = Math.floor((sub - 1) / 3);
    const dlon = (b.lonMax - b.lonMin) / 3;
    const dlat = (b.latMax - b.latMin) / 3;
    return [
        +(b.lonMin + (c + 0.5) * dlon).toFixed(COORD_DIGITS),
        +(b.latMax - (r + 0.5) * dlat).toFixed(COORD_DIGITS)
    ];
}

/**
 * 전자해도 해안선(우리나라)을 0.1° 칸으로 색인해 둔다.
 * 예: idx.get("1266_374") → 그 칸 안의 해안선 점 [[126.61,37.45], ...]
 * @returns {Map<string, Array<[number,number]>>}
 * [연계] → isKoreanCoast() 가 가까운 점을 빨리 찾으려고 쓴다.
 *          점 9만 5천 개를 매번 다 훑으면 20만 번 × 9만 5천 = 너무 느리다.
 */
function loadKhoaCoastIndex() {
    const j = JSON.parse(fs.readFileSync(KHOA_COAST_PATH, 'utf8'));
    const deg = j.cell_deg;
    const idx = new Map();
    for (const k of j.cells) {
        const t = k.split('_');
        const x = Number(t[0]) * deg, y = Number(t[1]) * deg;
        const gk = `${Math.floor(x / 0.1)}_${Math.floor(y / 0.1)}`;
        let arr = idx.get(gk);
        if (!arr) { arr = []; idx.set(gk, arr); }
        arr.push([x, y]);
    }
    return idx;
}

/**
 * 이 점이 우리나라 해안인지 본다.
 * 예: isKoreanCoast(129.16, 35.16, idx) → true (해운대, 전자해도 해안선 0.17km)
 *     isKoreanCoast(129.9, 33.0, idx)  → false (일본 고토열도)
 * @param {number} lon 경도
 * @param {number} lat 위도
 * @param {Map} idx loadKhoaCoastIndex() 결과
 * @returns {boolean}
 * [연계] ← build() 가 조각마다 부른다.
 *          land_mask_korea.json 에 일본·중국·북한 해안이 섞여 있어서 가려내야 한다.
 */
function isKoreanCoast(lon, lat, idx) {
    for (const b of EXTRA_KEEP_BOXES) {
        if (lon >= b.lonMin && lon <= b.lonMax && lat >= b.latMin && lat <= b.latMax) return true;
    }
    // 위도 1° ≈ 111km, 경도 1° ≈ 88.8km(북위 36° 부근) 로 근사한다.
    const lim = KEEP_KM * KEEP_KM;
    const span = Math.ceil(KEEP_KM / 8.88);   // 0.1° ≈ 8.88km → 훑을 칸 수
    const gx = Math.floor(lon / 0.1), gy = Math.floor(lat / 0.1);
    for (let dx = -span; dx <= span; dx++) {
        for (let dy = -span; dy <= span; dy++) {
            const arr = idx.get(`${gx + dx}_${gy + dy}`);
            if (!arr) continue;
            for (const [px, py] of arr) {
                const ex = (px - lon) * 88.8, ey = (py - lat) * 111.0;
                if (ex * ex + ey * ey <= lim) return true;
            }
        }
    }
    return false;
}

/** 좌표를 COORD_DIGITS 자리로 반올림한다(용량 절약). */
function rd(v) { return Number(v.toFixed(COORD_DIGITS)); }

// ────────────────────────────────────────────────────────────────────────────
/**
 * 해안선 폴리곤을 소해구별 조각으로 잘라 파일로 쓴다.
 * 예: 링 1,873개 → (우리나라 해안만) 조각 1,100여 개 + 소해구 230여 개
 * @returns {void}
 * [연계] ← 명령줄 실행 / → loadZoneBoxes()·zoneKeyOf()
 */
function build() {
    const t0 = Date.now();
    const { box, grid } = loadZoneBoxes();
    const khoaIdx = loadKhoaCoastIndex();
    const rings = JSON.parse(fs.readFileSync(LAND_PATH, 'utf8')).rings;

    const segments = [];
    const zoneSet = new Set();
    let ptsIn = 0, ptsSkipped = 0;

    for (const ring of rings) {
        let cur = null;      // { z, c:[...] } 만들고 있는 조각
        let prev = null;     // 직전에 채택한 점 [lon,lat]

        for (const p of ring) {
            const lon = p[0], lat = p[1];
            const inBox = lon >= BBOX.lonMin && lon <= BBOX.lonMax
                && lat >= BBOX.latMin && lat <= BBOX.latMax;
            if (!inBox) { cur = null; prev = null; continue; }

            const z = zoneKeyOf(lon, lat, box, grid);
            if (!z) { ptsSkipped++; cur = null; prev = null; continue; }
            ptsIn++;

            // 직전 점과 너무 멀면(다른 섬으로 건너뛴 것) 선을 끊는다.
            const jumped = prev && (Math.abs(lon - prev[0]) > MAX_GAP_DEG || Math.abs(lat - prev[1]) > MAX_GAP_DEG);

            if (!cur || cur.z !== z || jumped) {
                const started = [];
                // 소해구만 바뀐 경우(건너뛴 게 아니면) 앞 조각의 끝점부터 이어 그려
                // 경계에서 선이 끊겨 보이지 않게 한다.
                if (cur && !jumped && prev) started.push(rd(prev[0]), rd(prev[1]));
                cur = { z, c: started };
                segments.push(cur);
                zoneSet.add(z);
            }
            cur.c.push(rd(lon), rd(lat));
            prev = [lon, lat];
        }
    }

    // 점이 1개뿐인 조각은 선이 되지 않으므로 버린다.
    const drawable = segments.filter(s => s.c.length >= 4);

    // 우리나라 해안이 아닌 조각(일본·중국·북한)을 걸러낸다.
    //   조각 안의 점이 하나라도 우리 해안이면 그 조각을 남긴다 — 조각은 짧고(중앙값 6점),
    //   한 조각이 두 나라에 걸칠 일은 없다.
    const kept = [];
    let dropped = 0;
    for (const s of drawable) {
        let ours = false;
        for (let i = 0; i < s.c.length && !ours; i += 2) {
            if (isKoreanCoast(s.c[i], s.c[i + 1], khoaIdx)) ours = true;
        }
        if (ours) kept.push(s); else dropped++;
    }
    // 살아남은 조각들의 소해구만 다시 모은다(등급 API 가 이 목록으로 걸러 받는다).
    const finalZones = new Set(kept.map(s => s.z));
    const zoneKeys = Array.from(finalZones).sort();

    // 소해구 한가운데 좌표 — 앱이 등급을 부드럽게 섞을 때 쓴다.
    const centers = {};
    for (const k of zoneKeys) {
        const c = zoneCenterOf(k, box);
        if (c) centers[k] = c;
    }

    const out = {
        generated_at: new Date().toISOString(),
        source: 'client/land_mask_korea.json + client/marine_zone_area.json'
            + ' (우리나라 해안 판정: local_server/data/tide_field/coastline_cells.json)',
        bbox: BBOX,
        keep_km: KEEP_KM,
        coord_digits: COORD_DIGITS,
        zones: zoneKeys,
        zone_centers: centers,
        segments: kept
    };
    fs.writeFileSync(OUT_PATH, JSON.stringify(out));

    const bytes = fs.statSync(OUT_PATH).size;
    console.log(`[coastline_segments] 해안선 점 ${ptsIn}개(격자 밖 ${ptsSkipped}개 제외)`);
    console.log(`[coastline_segments] 우리나라 해안이 아니라 걸러낸 조각 ${dropped}개`
        + ` (일본·중국·북한 — 전자해도 해안선에서 ${KEEP_KM}km 초과)`);
    console.log(`[coastline_segments] 조각 ${kept.length}개 · 소해구 ${out.zones.length}개`
        + ` (한가운데 좌표 ${Object.keys(centers).length}개)`);
    console.log(`[coastline_segments] 저장 ${OUT_PATH} (${(bytes / 1024).toFixed(0)}KB, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

if (require.main === module) build();

module.exports = { build, zoneKeyOf, loadZoneBoxes };
