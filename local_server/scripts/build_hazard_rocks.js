/**
 * 위험물(간출암·노출암) 데이터 생성 스크립트
 * 실행: node local_server/scripts/build_hazard_rocks.js <UWTROC_LV5_디렉토리> <LNDARE_LV5_디렉토리>
 *
 * 국립해양조사원 개방海(khoa.go.kr/oceanmap) 국가해양정보 마켓센터에서 받은
 * 전자해도 shapefile 중 TL_UWTROC_P_LV5(간출암·세암·암암)·TL_LNDARE_P_LV5(노출암)
 * lv5(가장 상세) 세트를 읽어, 한반도 범위로 걸러 좌표계를
 * EPSG:5179(KGD2002 중부원점 TM) → EPSG:4326(WGS84) 로 변환한 뒤
 * client/hazard_rocks.json 에 GeoJSON 으로 저장합니다.
 * (한 번 생성 후 영구 사용 — KHOA 데이터 갱신 시에만 재실행)
 *
 * [원본 데이터 특성 — 첨부 설명서 기준]
 *   VALSOU(측심값)는 음수일 때 "해도 기준면(약최저저조면) 위로 드러난 높이(m)".
 *   이 기준면은 우리 앱의 조위 데이터(TideBED/조석표)와 동일 기준면이라
 *   별도 보정 없이 직접 비교 가능(services/tide_field_common.js 주석 참고).
 */
const fs = require('fs');
const path = require('path');

const KR_BBOX = { lonMin: 124, lonMax: 132, latMin: 32, latMax: 39 };

// ── EPSG:5179(KGD2002 중부원점 TM) → EPSG:4326 역변환 ──
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

// ── shapefile(.shp) PointZ 좌표만 순서대로 읽기 ──
function readShpPoints(shpPath) {
    const buf = fs.readFileSync(shpPath);
    const pts = [];
    let off = 100; // 파일 헤더 100바이트
    while (off < buf.length) {
        off += 8; // 레코드 헤더(레코드번호+길이, big-endian) — 내용은 안 씀
        const shapeType = buf.readInt32LE(off);
        if (shapeType === 11) { // PointZ
            pts.push([buf.readDoubleLE(off + 4), buf.readDoubleLE(off + 12)]);
        } else {
            pts.push(null);
        }
        // 다음 레코드 위치: 방금 읽은 content length 를 다시 읽어야 하므로
        // 레코드 헤더의 content length(off-4 위치, big-endian, word 단위)로 이동
        const clenWords = buf.readInt32BE(off - 4);
        off += clenWords * 2;
    }
    return pts;
}

// ── dBase(.dbf) 레코드를 필드명→문자열 객체 배열로 읽기 ──
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
        const name = raw.slice(0, nulIdx === -1 ? 11 : nulIdx).toString('utf8');
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

function inKorea(lon, lat) {
    return lon > KR_BBOX.lonMin && lon < KR_BBOX.lonMax && lat > KR_BBOX.latMin && lat < KR_BBOX.latMax;
}
function round5(n) { return Math.round(n * 1e5) / 1e5; }

function loadLv5(dir, prefix) {
    const pts = readShpPoints(path.join(dir, prefix + '.shp'));
    const rows = readDbf(path.join(dir, prefix + '.dbf'));
    const out = [];
    for (let i = 0; i < rows.length; i++) {
        const pt = pts[i];
        if (!pt) continue;
        const [lon, lat] = utmkToLonLat(pt[0], pt[1]);
        if (!inKorea(lon, lat)) continue;
        out.push(Object.assign({}, rows[i], { lon: round5(lon), lat: round5(lat) }));
    }
    return out;
}

// WATLEV(수준면효과) 코드 → 종류 번호. 1=간출암 2=세암 3=암암 (0=노출암은 LNDARE 전용)
const WATLEV_KIND = { WTV004: 1, WTV005: 2, WTV003: 3 };

function main() {
    const [, , uwDir, lnDir] = process.argv;
    if (!uwDir || !lnDir) {
        console.error('사용법: node build_hazard_rocks.js <UWTROC_LV5_디렉토리> <LNDARE_LV5_디렉토리>');
        process.exit(1);
    }

    const uw = loadLv5(uwDir, 'tl_uwtroc_p_lv5');
    const ln = loadLv5(lnDir, 'tl_lndare_p_lv5');

    const features = [];
    let withValue = 0;
    let nextId = 0;
    for (const r of uw) {
        const kind = WATLEV_KIND[r.WATLEV] || 1;
        const props = { id: nextId++, k: kind };
        const v = parseFloat(r.VALSOU);
        if (r.VALSOU && r.VALSOU.indexOf('*') === -1 && !Number.isNaN(v)) {
            props.v = Math.round(Math.abs(v) * 10) / 10;
            withValue++;
        }
        features.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [r.lon, r.lat] } });
    }
    for (const r of ln) {
        features.push({ type: 'Feature', properties: { id: nextId++, k: 0 }, geometry: { type: 'Point', coordinates: [r.lon, r.lat] } });
    }

    const geojson = { type: 'FeatureCollection', features };
    const outPath = path.join(__dirname, '..', '..', 'client', 'hazard_rocks.json');
    fs.writeFileSync(outPath, JSON.stringify(geojson));

    console.log(`간출암류(UWTROC): ${uw.length}건 (수치 있음 ${withValue}건) / 노출암(LNDARE): ${ln.length}건`);
    console.log(`저장 완료: ${outPath} (${features.length}건, ${(fs.statSync(outPath).size / 1024).toFixed(0)}KB)`);
}

main();
