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
 *
 * [출력]
 *   client/coastline_segments.json
 *     { generated_at, cell_deg, zones:["144-9",...], segments:[ { z:"144-9", c:[lon,lat,...] } ] }
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

/** 우리가 다루는 한국 범위(이 밖의 해안선은 버린다). */
const BBOX = { lonMin: 124.0, lonMax: 132.0, latMin: 32.0, latMax: 39.0 };

/** 좌표 소수 자릿수. 4자리 ≈ 11m — 해안선 표시에 충분하고 용량이 절반이 된다. */
const COORD_DIGITS = 4;

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

/** 좌표를 COORD_DIGITS 자리로 반올림한다(용량 절약). */
function rd(v) { return Number(v.toFixed(COORD_DIGITS)); }

// ────────────────────────────────────────────────────────────────────────────
/**
 * 해안선 폴리곤을 소해구별 조각으로 잘라 파일로 쓴다.
 * 예: 링 1,873개 → 조각 수천 개 + 소해구 424개
 * @returns {void}
 * [연계] ← 명령줄 실행 / → loadZoneBoxes()·zoneKeyOf()
 */
function build() {
    const t0 = Date.now();
    const { box, grid } = loadZoneBoxes();
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
    const kept = segments.filter(s => s.c.length >= 4);

    const out = {
        generated_at: new Date().toISOString(),
        source: 'client/land_mask_korea.json + client/marine_zone_area.json',
        bbox: BBOX,
        coord_digits: COORD_DIGITS,
        zones: Array.from(zoneSet).sort(),
        segments: kept
    };
    fs.writeFileSync(OUT_PATH, JSON.stringify(out));

    const bytes = fs.statSync(OUT_PATH).size;
    console.log(`[coastline_segments] 해안선 점 ${ptsIn}개(격자 밖 ${ptsSkipped}개 제외)`);
    console.log(`[coastline_segments] 조각 ${kept.length}개 · 소해구 ${out.zones.length}개`);
    console.log(`[coastline_segments] 저장 ${OUT_PATH} (${(bytes / 1024).toFixed(0)}KB, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

if (require.main === module) build();

module.exports = { build, zoneKeyOf, loadZoneBoxes };
