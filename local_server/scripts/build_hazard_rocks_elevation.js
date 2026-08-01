/**
 * 노출암(k=0) 높이 보강 스크립트
 * 실행: node local_server/scripts/build_hazard_rocks_elevation.js <표고점.shp> <표고점.dbf>
 *
 * 국토지리정보원 "연속수치지형도 표고점"(브이월드 다운로드 카탈로그,
 * dsId=30245, table_id=N3P_F0020000) 데이터에서 노출암 좌표 근처의 표고점을
 * 찾아 client/hazard_rocks.json 의 노출암(k=0)에 높이(v)를 채워 넣는다.
 *
 * [왜 필요한가] KHOA 전자해도 원본(TL_LNDARE_P_LV5)에는 노출암 높이 필드가
 *   아예 없다(직접 확인함). 반면 이 표고점은 육지 지형도 데이터라 바다 위
 *   암초를 재려는 목적이 아니지만, 해안에 아주 가까운 노출암은 우연히 그
 *   근처에 표고점이 찍혀 있는 경우가 많다(실측 검증: 노출암 4,287개 중
 *   67.8%가 100m 이내에 표고점 보유).
 *
 * [매칭 방법 — 왜 "가장 가까운 것"만 쓰면 안 되는가]
 *   가까운 표고점이 노출암 자체가 아니라 바로 옆 절벽·언덕을 잰 것일 수
 *   있다(실측 사례: 64.8m 거리에 100.9m 높이 — 작은 바위일 리 없음).
 *   그래서 반경 내 후보 중 "높이가 그럴듯한(0~MAX_PLAUSIBLE_H_M)" 것만
 *   추려 그중 가장 가까운 것을 채택한다.
 *
 * [기준면 보정 — 반드시 필요]
 *   이 표고점(NUME)은 해발고도(평균해수면 MSL 기준)다. 반면 간출암의 VALSOU는
 *   약최저저조면(해도 기준면) 기준이라 서로 다른 면이다(약최저저조면이
 *   평균해수면보다 낮음). 그대로 섞어 쓰면 같은 "높이"가 서로 다른 것을
 *   가리키게 된다. 그래서 물빠짐(tide_field) 이 이미 쓰는 Z₀(평균해면고,
 *   표준항 조석표 고조·저조 평균)를 표고점 좌표마다 IDW 보간해 더한다:
 *     약최저저조면 기준 높이 = NUME(평균해수면 기준) + Z₀(그 지점)
 *
 * [연계]
 *   - scripts/build_hazard_rocks.js  → client/hazard_rocks.json 원본 생성(이 스크립트는 그 위에 v만 채움)
 *   - scripts/build_tide_field.js    → loadTideTable/buildStationMTL 재사용(Z₀ 산출)
 *   - services/tide_field_common.js  → ALL_REFERENCE_STATIONS, haversineKm 재사용
 *   - client/js/marine-life/safety/hazard_rocks.js → popupText() 가 v 있으면 수치 표시
 *
 * [원본 데이터 비커밋] 표고점 shp/dbf 는 500MB+ 라 저장소에 넣지 않는다.
 *   이 스크립트를 실행할 때만 로컬에 두고 처리 후 지우면 된다(build_hazard_rocks.js 와 동일 정책).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const TFC = require('../services/tide_field_common');

const RADIUS_M = 100;          // 표고점 탐색 반경
const MAX_PLAUSIBLE_H_M = 20;  // 노출암으로 그럴듯한 최대 높이(이보다 크면 절벽/언덕으로 간주)
const CELL_M = 200;            // 공간 그리드 셀 크기

/** WGS84 lon/lat → EPSG:5179(KGD2002 중부원점 TM) x,y(m). build_hazard_rocks.js 의 역변환과 짝. */
function lonLatToUtmk(lon, lat) {
    const a = 6378137.0, f = 1 / 298.257222101, k0 = 0.9996;
    const e2 = f * (2 - f);
    const lon0 = 127.5 * Math.PI / 180, lat0 = 38.0 * Math.PI / 180;
    const phi = lat * Math.PI / 180, lam = lon * Math.PI / 180;
    const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
    const T = Math.tan(phi) ** 2;
    const C = e2 / (1 - e2) * Math.cos(phi) ** 2;
    const A = (lam - lon0) * Math.cos(phi);
    const M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi
        - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
        + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi)
        - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
    const M0 = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * lat0
        - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * lat0)
        + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * lat0)
        - (35 * e2 ** 3 / 3072) * Math.sin(6 * lat0));
    const x = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T ** 2 + 72 * C - 58 * (e2 / (1 - e2))) * A ** 5 / 120) + 1000000.0;
    const y = k0 * (M - M0 + N * Math.tan(phi) * (A ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24 + (61 - 58 * T + T ** 2 + 600 * C - 330 * (e2 / (1 - e2))) * A ** 6 / 720)) + 2000000.0;
    return [x, y];
}

/** 표고점 .shp(Point) → Float64Array [x0,y0,x1,y1,...] */
function readShpPoints(shpPath) {
    const buf = fs.readFileSync(shpPath);
    const pts = [];
    let off = 100;
    while (off < buf.length) {
        off += 8;
        const shapeType = buf.readInt32LE(off);
        if (shapeType === 1) { pts.push(buf.readDoubleLE(off + 4), buf.readDoubleLE(off + 12)); off += 20; }
        else if (shapeType === 0) { off += 4; }
        else throw new Error('예상 밖 shapeType: ' + shapeType);
    }
    return Float64Array.from(pts);
}

/** 표고점 .dbf 의 NUME(고도, m) 필드만 레코드 순서대로 추출 */
function readDbfNume(dbfPath) {
    const buf = fs.readFileSync(dbfPath);
    const nrec = buf.readUInt32LE(4);
    const hlen = buf.readUInt16LE(8);
    const rlen = buf.readUInt16LE(10);
    const fields = [];
    let off = 32;
    while (off < hlen - 1) {
        const raw = buf.slice(off, off + 11);
        const nulIdx = raw.indexOf(0);
        const name = raw.slice(0, nulIdx === -1 ? 11 : nulIdx).toString('utf8');
        const len = buf.readUInt8(off + 16);
        fields.push({ name, len });
        off += 32;
    }
    const numeField = fields.find(f => f.name === 'NUME');
    if (!numeField) throw new Error('NUME 필드를 찾을 수 없음: ' + JSON.stringify(fields));
    let fieldOff = 1;
    for (const f of fields) { if (f === numeField) break; fieldOff += f.len; }
    const nume = new Float64Array(nrec);
    off = hlen;
    for (let i = 0; i < nrec; i++) {
        const s = buf.slice(off + fieldOff, off + fieldOff + numeField.len).toString('utf8').trim();
        nume[i] = s ? parseFloat(s) : NaN;
        off += rlen;
    }
    return nume;
}

/** 표고점 좌표를 200m 그리드로 버킷팅 — 반경 검색을 O(1) 근처 셀만 훑도록 */
function buildGrid(pts, n) {
    const grid = new Map();
    for (let i = 0; i < n; i++) {
        const gx = Math.floor(pts[i * 2] / CELL_M), gy = Math.floor(pts[i * 2 + 1] / CELL_M);
        const key = gx + '_' + gy;
        let arr = grid.get(key);
        if (!arr) { arr = []; grid.set(key, arr); }
        arr.push(i);
    }
    return grid;
}

function candidatesWithin(grid, pts, qx, qy, radiusM) {
    const gx0 = Math.floor(qx / CELL_M), gy0 = Math.floor(qy / CELL_M);
    const rCells = Math.ceil(radiusM / CELL_M) + 1;
    const out = [];
    for (let dx = -rCells; dx <= rCells; dx++) {
        for (let dy = -rCells; dy <= rCells; dy++) {
            const arr = grid.get((gx0 + dx) + '_' + (gy0 + dy));
            if (!arr) continue;
            for (const i of arr) {
                const ddx = pts[i * 2] - qx, ddy = pts[i * 2 + 1] - qy;
                const d = Math.sqrt(ddx * ddx + ddy * ddy);
                if (d <= radiusM) out.push({ idx: i, distM: d });
            }
        }
    }
    return out;
}

/**
 * Z₀(평균해면고, m) — 좌표 근처 표준항 조석표 MTL 을 직선거리 IDW(최근접 4개)로 보간.
 * [연계] build_tide_field.js 의 z0AtPoint 와 동일 공식(파일 분리 재사용 대신 직접
 *   반영한 이유: 이 스크립트는 표고점 처리가 주 목적이라 물빠짐 전처리 파이프라인
 *   전체를 끌어오지 않고 필요한 계산만 가볍게 재현한다).
 */
function buildZ0Interpolator(stationMTL) {
    const seeds = [];
    for (const st of TFC.ALL_REFERENCE_STATIONS) {
        const m = stationMTL[st.code] || Object.values(stationMTL).find(x => x.name === st.name);
        if (!m || m.mtl_cm == null) continue;
        seeds.push({ lat: st.lat, lon: st.lon, z0_m: m.mtl_cm / 100 });
    }
    return function z0AtPoint(lat, lon) {
        const near = seeds.map(s => ({ d: TFC.haversineKm(lat, lon, s.lat, s.lon), z0: s.z0_m }))
            .sort((a, b) => a.d - b.d).slice(0, 4);
        let wsum = 0, vsum = 0;
        for (const { d, z0 } of near) { const w = d < 0.1 ? 1e6 : 1 / (d * d); wsum += w; vsum += w * z0; }
        return wsum > 0 ? vsum / wsum : null;
    };
}

function main() {
    const [, , shpPath, dbfPath] = process.argv;
    if (!shpPath || !dbfPath) {
        console.error('사용법: node build_hazard_rocks_elevation.js <표고점.shp> <표고점.dbf>');
        process.exit(1);
    }
    const log = (...a) => console.log('[build_hazard_rocks_elevation]', ...a);

    log('표고점 로드 중...');
    const pts = readShpPoints(shpPath);
    const n = pts.length / 2;
    const nume = readDbfNume(dbfPath);
    if (nume.length !== n) throw new Error(`shp(${n})/dbf(${nume.length}) 레코드 수 불일치`);
    log(`표고점 ${n.toLocaleString()}개 로드 완료`);

    log('공간 그리드 구축 중...');
    const grid = buildGrid(pts, n);

    log('Z₀ 보간용 표준항 MTL 계산 중...');
    const buildTideField = require('./build_tide_field');
    const year = new Date(Date.now() + 9 * 3600000).getUTCFullYear();
    const rows = buildTideField.loadTideTable(year);
    if (!rows) throw new Error(`조석표(${year}) 로드 실패 — client/tide_data/tide_data_${year}.js 확인 필요`);
    const stationMTL = buildTideField.buildStationMTL(rows);
    const z0AtPoint = buildZ0Interpolator(stationMTL);

    const hazardRocksPath = path.join(__dirname, '..', '..', 'client', 'hazard_rocks.json');
    const geojson = JSON.parse(fs.readFileSync(hazardRocksPath, 'utf8'));

    let matched = 0, noCandidate = 0, rejectedImplausible = 0;
    for (const f of geojson.features) {
        if (f.properties.k !== 0) continue; // 노출암만
        const [lon, lat] = f.geometry.coordinates;
        const [x, y] = lonLatToUtmk(lon, lat);
        const cands = candidatesWithin(grid, pts, x, y, RADIUS_M);
        if (cands.length === 0) { noCandidate++; continue; }
        const plausible = cands
            .map(c => ({ ...c, h: nume[c.idx] }))
            .filter(c => c.h > 0 && c.h <= MAX_PLAUSIBLE_H_M)
            .sort((a, b) => a.distM - b.distM);
        if (plausible.length === 0) { rejectedImplausible++; continue; }
        const z0 = z0AtPoint(lat, lon);
        const heightMsl = plausible[0].h;
        const heightChartDatum = z0 != null ? heightMsl + z0 : heightMsl;
        f.properties.v = Math.round(heightChartDatum * 10) / 10;
        matched++;
    }

    log(`매칭 완료: 확정 ${matched}개, 후보없음 ${noCandidate}개, 높이비타당 기각 ${rejectedImplausible}개`);
    fs.writeFileSync(hazardRocksPath, JSON.stringify(geojson));
    log(`저장 완료: ${hazardRocksPath}`);
}

module.exports = { main, lonLatToUtmk, readShpPoints, readDbfNume };

if (require.main === module) {
    main();
}
