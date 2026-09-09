/**
 * 갯바위(면) 데이터 생성 스크립트
 * 실행: node local_server/scripts/build_shore_rocks.js <갯바위_shapefile_디렉토리>
 *
 * 국립해양조사원 개방海(khoa.go.kr/oceanmap) 국가해양정보 마켓센터에서 받은
 * 위험정보 shapefile 중 TL_LEIHAZ_TROTSE_A(갯바위, 면)를 읽어, 한반도 범위로 걸러
 * 좌표계를 EPSG:5179(KGD2002 중부원점 TM) → EPSG:4326(WGS84) 로 변환한 뒤
 * client/shore_rocks.json 에 GeoJSON 으로 저장합니다.
 * (한 번 생성 후 영구 사용 — KHOA 데이터 갱신 시에만 재실행)
 *
 * [원본 데이터 특성 — 2026-09-09 전수 확인]
 *   · 9,959개 면, 자료 제작일(MNYMD) 2017-12-06.
 *   · 커버 범위는 경도 125.08~127.81 / 위도 34.05~37.62 — 서·남해만이고
 *     동해안·제주도에는 자료가 아예 없다.
 *   · 속성 23개 중 실제로 값이 있는 것은 일련번호·사각범위·대표좌표·제작일·시군구뿐.
 *     **높이(노출 높이·수심)에 해당하는 항목이 없어서 잠김 계산에는 쓸 수 없다.**
 *     이름(NOBJNM·OBJNAM)도 9,959개 전부 비어 있다.
 *   · 면적은 중앙값 18㎡(약 4m×4m), 41%가 10㎡ 미만이라 지도에서는 점에 가깝다.
 *     그래서 면만 그리면 안 보이고, 대표좌표에 마커를 얹어야 눈에 띈다.
 *
 * [간출암·노출암과의 관계 — 전수 대조 결과]
 *   · 노출암(hazard_rocks.json k=0)  : 475개가 갯바위 면 안에 들어간다(단순화 후 면 기준).
 *     같은 바위를 점(노출암)과 면(갯바위)으로 다르게 표현한 것이라, 이 475개는
 *     노출암 쪽에서 감추고 갯바위로만 보여준다(그 id 목록을 coveredExposedIds 로 넘긴다).
 *   · 간출암류(k=1,2,3)             : 면 안에 드는 것이 6개뿐이라 따로 처리하지 않는다.
 *     갯바위(사람이 걸어 들어가는 마른 바위)와 간출암(물 빠질 때만 드러나는 바위)은
 *     원래 있는 자리가 다르다.
 *
 * [출력 형식]
 *   { type, coveredExposedIds:[노출암 id...], features:[ {properties:{id, c:[lon,lat]}, geometry:Polygon} ] }
 *   - properties.c = 원본이 준 대표좌표(XCDNTS/YCDNTS). 마커를 여기에 찍는다.
 *     9,959개 중 면 밖으로 벗어나는 것은 26개뿐이고 그중 20m 넘게 벗어난 건 8개다.
 *   - 좌표는 2m 오차 안에서 단순화(Douglas-Peucker)한다 — 원본 그대로면 꼭짓점이
 *     128만 개(26MB)라 휴대폰이 무겁다. 단순화하면 18.1만 개(4.7MB)로 줄고,
 *     면적 중앙값이 18㎡라 2m 오차는 눈으로 구분되지 않는다.
 */
const fs = require('fs');
const path = require('path');

const KR_BBOX = { lonMin: 124, lonMax: 132, latMin: 32, latMax: 39 };
const SIMPLIFY_M = 2;          // 단순화 허용 오차(m)
const HAZARD_ROCKS_PATH = path.join(__dirname, '..', '..', 'client', 'hazard_rocks.json');
const OUT_PATH = path.join(__dirname, '..', '..', 'client', 'shore_rocks.json');

// ── EPSG:5179(KGD2002 중부원점 TM) → EPSG:4326 역변환 ──
//    build_hazard_rocks.js 와 같은 식(같은 원본 좌표계이므로 동일해야 한다).
function utmkToLonLat(x, y) {
    const a = 6378137.0, f = 1 / 298.257222101, e2 = f * (2 - f), k0 = 0.9996;
    const lon0 = 127.5 * Math.PI / 180, lat0 = 38.0 * Math.PI / 180;
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const M = (la) => a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * la
        - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * la)
        + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * la)
        - (35 * e2 ** 3 / 3072) * Math.sin(6 * la));
    const Mv = M(lat0) + (y - 2000000.0) / k0;
    const mu = Mv / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256));
    const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
        + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
        + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
    const ep2 = e2 / (1 - e2), C1 = ep2 * Math.cos(p1) ** 2, T1 = Math.tan(p1) ** 2;
    const N1 = a / Math.sqrt(1 - e2 * Math.sin(p1) ** 2);
    const R1 = a * (1 - e2) / (1 - e2 * Math.sin(p1) ** 2) ** 1.5;
    const D = (x - 1000000.0) / (N1 * k0);
    const lat = p1 - (N1 * Math.tan(p1) / R1) * (D ** 2 / 2
        - (5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * ep2) * D ** 4 / 24
        + (61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * ep2 - 3 * C1 ** 2) * D ** 6 / 720);
    const lon = lon0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6
        + (5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * ep2 + 24 * T1 ** 2) * D ** 5 / 120) / Math.cos(p1);
    return [lon * 180 / Math.PI, lat * 180 / Math.PI];
}

/**
 * 면(Polygon) shapefile 의 좌표 링을 레코드 순서대로 읽는다.
 * 예: readShpPolygons('tl_leihaz_trotse_a.shp') → [[[[x,y],...]], ...] (레코드마다 링 배열)
 * @param {string} shpPath - .shp 파일 경로
 * @returns {Array<Array<Array<number[]>>|null>} 레코드별 링 배열(면이 아니면 null)
 * [연계] ← main() — 갯바위 모양을 읽으려고 부른다. 점만 읽는 build_hazard_rocks.js 의
 *          readShpPoints 와 달리 이 파일은 Polygon(5) 이라 파서를 따로 둔다.
 */
function readShpPolygons(shpPath) {
    const buf = fs.readFileSync(shpPath);
    const out = [];
    let off = 100; // 파일 헤더 100바이트
    while (off < buf.length) {
        const clenWords = buf.readInt32BE(off + 4);
        off += 8; // 레코드 헤더(레코드번호+길이)
        const shapeType = buf.readInt32LE(off);
        if (shapeType !== 5) { out.push(null); off += clenWords * 2; continue; }
        // Polygon: [type 4][box 32][numParts 4][numPoints 4][parts 4*n][points 16*m]
        const nParts = buf.readInt32LE(off + 36), nPts = buf.readInt32LE(off + 40);
        const partStart = off + 44, ptStart = partStart + nParts * 4;
        const parts = [];
        for (let i = 0; i < nParts; i++) parts.push(buf.readInt32LE(partStart + i * 4));
        const rings = [];
        for (let i = 0; i < nParts; i++) {
            const s = parts[i], e = (i + 1 < nParts ? parts[i + 1] : nPts);
            const ring = [];
            for (let j = s; j < e; j++) {
                ring.push([buf.readDoubleLE(ptStart + j * 16), buf.readDoubleLE(ptStart + j * 16 + 8)]);
            }
            rings.push(ring);
        }
        out.push(rings);
        off += clenWords * 2;
    }
    return out;
}

// ── dBase(.dbf) 레코드를 필드명(대문자)→문자열 객체 배열로 읽기 ──
function readDbf(dbfPath) {
    const buf = fs.readFileSync(dbfPath);
    const nrec = buf.readUInt32LE(4);
    const hlen = buf.readUInt16LE(8);
    const rlen = buf.readUInt16LE(10);
    const fields = [];
    let off = 32;
    while (off < hlen - 1) {
        const raw = buf.slice(off, off + 11);
        const nulIdx = raw.indexOf(0);
        const name = raw.slice(0, nulIdx === -1 ? 11 : nulIdx).toString('utf8').toUpperCase();
        const len = buf.readUInt8(off + 16);
        fields.push({ name, len });
        off += 32;
    }
    const rows = [];
    off = hlen;
    for (let i = 0; i < nrec; i++) {
        let p = off + 1; // 삭제 플래그 1바이트 스킵
        const row = {};
        for (const f of fields) {
            row[f.name] = buf.slice(p, p + f.len).toString('utf8').trim();
            p += f.len;
        }
        rows.push(row);
        off += rlen;
    }
    return rows;
}

/**
 * 선(링)을 Douglas-Peucker 로 단순화한다 — 원래 모양에서 eps 이상 벗어나지 않게 꼭짓점을 줄인다.
 * 예: 39개 꼭짓점짜리 갯바위 윤곽을 2m 오차 허용으로 줄이면 대략 10여 개가 된다
 * @param {Array<number[]>} pts - [[lon,lat], ...]
 * @param {number} eps - 허용 오차(경위도 각도 단위)
 * @returns {Array<number[]>} 줄인 꼭짓점 목록
 * [연계] ← simplifyRing() — 파일 크기를 26MB 에서 4.7MB 로 줄이려고 부른다.
 */
function douglasPeucker(pts, eps) {
    if (pts.length < 3) return pts;
    const perp = (p, a, b) => {
        const dx = b[0] - a[0], dy = b[1] - a[1];
        if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
        return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    };
    let dmax = 0, idx = 0;
    for (let i = 1; i < pts.length - 1; i++) {
        const d = perp(pts[i], pts[0], pts[pts.length - 1]);
        if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > eps) {
        const left = douglasPeucker(pts.slice(0, idx + 1), eps);
        const right = douglasPeucker(pts.slice(idx), eps);
        return left.slice(0, -1).concat(right);
    }
    return [pts[0], pts[pts.length - 1]];
}

/**
 * 닫힌 링 하나를 단순화하고 좌표를 소수 5자리로 반올림한다.
 * 예: [[126.12345678,34.1234567],...] 39개 → [[126.12346,34.12346],...] 12개
 * @param {Array<number[]>} ring - 경위도 링(첫 점과 끝 점이 같은 닫힌 고리)
 * @returns {Array<number[]>} 단순화된 링(4점 미만이 되면 원본을 그대로 돌려준다)
 * [연계] ← main() — 폴리곤마다 불러 파일 크기를 줄인다.
 */
function simplifyRing(ring) {
    const eps = SIMPLIFY_M / 111000;           // m → 경위도 각도(대략)
    const s = douglasPeucker(ring, eps);
    const use = s.length >= 4 ? s : ring;      // 너무 줄어 면이 사라지면 원본 유지
    return use.map((p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]);
}

/**
 * 점이 링 안에 있는지 판정한다(ray casting).
 * 예: pointInRing([126.5,34.3], 갯바위링) → true
 * @param {number[]} pt - [lon, lat]
 * @param {Array<number[]>} ring - 경위도 링
 * @returns {boolean} 링 내부면 true
 * [연계] ← findCoveredExposed() — 갯바위 면 안에 든 노출암을 찾으려고 부른다.
 */
function pointInRing(pt, ring) {
    const [x, y] = pt;
    let inside = false;
    for (let i = 0, n = ring.length; i < n; i++) {
        const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % n];
        if ((y1 > y) !== (y2 > y)) {
            const xin = (x2 - x1) * (y - y1) / (y2 - y1) + x1;
            if (x < xin) inside = !inside;
        }
    }
    return inside;
}

/**
 * 갯바위 면 안에 들어가는 노출암(k=0)의 id 목록을 찾는다.
 * 예: findCoveredExposed(폴리곤들) → [12, 87, 91, ...]
 * @param {Array<Array<Array<number[]>>>} polys - 경위도 폴리곤(링 배열) 목록
 * @returns {number[]} 감출 노출암 id 목록(오름차순)
 * [연계] → client/hazard_rocks.json 을 읽는다 / ← main()
 *          같은 바위를 점(노출암)·면(갯바위)으로 이중 표시하지 않으려고 만든다.
 *          클라이언트(hazard_rocks.js)가 이 목록을 받아 노출암 레이어에서 뺀다.
 */
function findCoveredExposed(polys) {
    const rocks = JSON.parse(fs.readFileSync(HAZARD_ROCKS_PATH, 'utf8')).features
        .filter((f) => f.properties.k === 0)
        .map((f) => ({ id: f.properties.id, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }));

    // 폴리곤 bbox 를 0.01도 격자에 넣어 후보를 좁힌다(전수 대조는 9,959 × 4,287 이라 느리다).
    const CELL = 0.01;
    const grid = new Map();
    const boxes = polys.map((rings) => {
        const r = rings[0];
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
        for (const p of r) { if (p[0] < x1) x1 = p[0]; if (p[0] > x2) x2 = p[0]; if (p[1] < y1) y1 = p[1]; if (p[1] > y2) y2 = p[1]; }
        return [x1, y1, x2, y2];
    });
    boxes.forEach((bb, i) => {
        for (let gx = Math.floor(bb[0] / CELL); gx <= Math.floor(bb[2] / CELL); gx++) {
            for (let gy = Math.floor(bb[1] / CELL); gy <= Math.floor(bb[3] / CELL); gy++) {
                const k = gx + ',' + gy;
                if (!grid.has(k)) grid.set(k, []);
                grid.get(k).push(i);
            }
        }
    });

    const covered = [];
    for (const rock of rocks) {
        const gx = Math.floor(rock.lon / CELL), gy = Math.floor(rock.lat / CELL);
        const cand = grid.get(gx + ',' + gy) || [];
        for (const i of cand) {
            if (pointInRing([rock.lon, rock.lat], polys[i][0])) { covered.push(rock.id); break; }
        }
    }
    return covered.sort((a, b) => a - b);
}

function inKorea(lon, lat) {
    return lon > KR_BBOX.lonMin && lon < KR_BBOX.lonMax && lat > KR_BBOX.latMin && lat < KR_BBOX.latMax;
}

function main() {
    const dir = process.argv[2];
    if (!dir) {
        console.error('사용법: node build_shore_rocks.js <갯바위_shapefile_디렉토리>');
        process.exit(1);
    }
    const base = path.join(dir, 'TL_LEIHAZ_TROTSE_A');
    const shapes = readShpPolygons(base + '.shp');
    const rows = readDbf(base + '.dbf');

    const polys = [];       // 경위도 링 배열(단순화 전 — 노출암 판정에 씀)
    const centers = [];     // 대표좌표(마커 위치)
    let skipped = 0;
    for (let i = 0; i < rows.length; i++) {
        if (!shapes[i]) { skipped++; continue; }
        const rings = shapes[i].map((ring) => ring.map((p) => {
            const ll = utmkToLonLat(p[0], p[1]);
            return [ll[0], ll[1]];
        }));
        if (!rings[0].length || !inKorea(rings[0][0][0], rings[0][0][1])) { skipped++; continue; }
        const cx = parseFloat(rows[i].XCDNTS), cy = parseFloat(rows[i].YCDNTS);
        const c = (Number.isNaN(cx) || Number.isNaN(cy))
            ? [rings[0].reduce((a, p) => a + p[0], 0) / rings[0].length,
               rings[0].reduce((a, p) => a + p[1], 0) / rings[0].length]
            : utmkToLonLat(cx, cy);
        polys.push(rings);
        centers.push([Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5]);
    }

    // 단순화를 먼저 하고, 그 결과로 노출암 포함 여부를 판정한다.
    //   단순화 전 원본으로 판정하면 "감췄는데 화면의 면은 그 자리를 안 덮는" 지점이 생긴다
    //   (실측 191개). 화면에 그려지는 면과 판정 기준을 같게 맞춘다.
    const simplified = polys.map((rings) => rings.map(simplifyRing));
    const coveredExposedIds = findCoveredExposed(simplified);

    const features = simplified.map((rings, i) => ({
        type: 'Feature',
        properties: { id: i, c: centers[i] },
        geometry: { type: 'Polygon', coordinates: rings },
    }));

    const geojson = { type: 'FeatureCollection', coveredExposedIds, features };
    fs.writeFileSync(OUT_PATH, JSON.stringify(geojson));

    const vtx = features.reduce((a, f) => a + f.geometry.coordinates.reduce((b, r) => b + r.length, 0), 0);
    console.log(`갯바위(LEIHAZ_TROTSE): ${features.length}건 (한반도 밖·면 아님 제외 ${skipped}건)`);
    console.log(`꼭짓점 ${vtx.toLocaleString()}개 (${SIMPLIFY_M}m 단순화) / 갯바위에 덮이는 노출암 ${coveredExposedIds.length}개`);
    console.log(`저장 완료: ${OUT_PATH} (${(fs.statSync(OUT_PATH).size / 1024 / 1024).toFixed(1)}MB)`);
}

main();
