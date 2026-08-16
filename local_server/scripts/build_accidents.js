/**
 * ============================================================================
 * 파일명: scripts/build_accidents.js
 * 역할  : 국립해양조사원 개방海 "선박사고(해경)·선박사고(심판원)·인명사고" 원본
 *         CSV(EUC-KR)를 읽어, 지도에 바로 쓸 수 있는 컴팩트 JSON 3개로 변환한다.
 * ----------------------------------------------------------------------------
 * [입력] scripts/_accident_raw/ (git 추적 안 함, .gitignore 참고) 에 아래 3개를 둔다.
 *   - TL_SHPACC_HK_P.csv  (선박사고(해양경찰서).zip 안의 CSV)
 *   - TL_SHPACC_HS_P.csv  (선박사고(해양안전심판원).zip 안의 CSV)
 *   - TL_NSHPAC.csv       (인명사고(25년).zip 안의 CSV)
 * [출력] client/accident_ships_hk.json · accident_ships_hs.json · accident_persons.json
 *   → hazard_rocks.json 과 동일하게 client/ 루트에 두어 정적 서빙(서버 코드 변경 불필요).
 *
 * [컬럼명 → 배열 인덱스] (라벨 변환은 여기서 안 함 — client/js/shared/utils/accident_codes.js
 *   가 화면에 그릴 때 코드값을 한글로 바꾼다. mappings.js 와 동일하게 "원본 코드 저장,
 *   표시할 때 변환" 방식 — 코드표가 갱신돼도 데이터를 다시 안 만들어도 된다.)
 *   HK(선박·해경)     : [lat, lon, ymd, hm, pos, typeCd, causeCd, shipCd, orgCd, rescue, death, missing]
 *   HS(선박·심판원)   : [lat, lon, yr, mm, day, hr, mn, tmzCd, acdntNo, shipNm, typeCd, sear1Cd]
 *   Person(인명)      : [lat, lon, ymd, pos, typeCd, orgCd, prsn, rescue, death, missing]
 *
 * [좌표]
 *   - HK·HS 는 CSV 에 이미 WGS84 십진도 컬럼(ORGNL_XCDNT=위도, ORGNL_YCDNT=경도 —
 *     이름과 달리 X 가 위도다. ORGNL_LAT/ORGNL_LOT(도분초) 값과 대조해 확인함)이 있어
 *     그대로 쓴다.
 *   - Person 은 그 컬럼이 없고 XCDNT/YCDNT 가 KGD2002 통합좌표계(TM, EPSG:5179 상당,
 *     .prj 파일 그대로 옮김) 투영좌표(m)라서 proj4 로 WGS84 역변환한다.
 *
 * [실행] node scripts/build_accidents.js
 * [연계] client/js/marine-life/safety/accident_info.js 가 이 3개 JSON 을 fetch
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');
const proj4 = require('proj4');

const RAW_DIR = path.join(__dirname, '_accident_raw');
const OUT_DIR = path.join(__dirname, '..', '..', 'client');

// KGD2002 Unified Coordinate System — TL_NSHPAC.prj 를 그대로 proj4 문자열로 옮김.
const KGD2002_UNIFIED = '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 ' +
    '+x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs';

// 대한민국 대략 범위 밖 좌표는 원본 오류로 보고 제외(안전장치).
const KOREA_BOUNDS = { latMin: 30, latMax: 40, lonMin: 122, lonMax: 134 };

/**
 * RFC4180 최소 구현 CSV 파서. 따옴표로 감싼 필드 안의 쉼표·줄바꿈을 처리한다
 * (선박(심판원) ACDNT_CN 컬럼에 쉼표 포함 자유문장이 있어 단순 split(',') 불가).
 * @param {string} text - 디코딩된 CSV 전체 텍스트
 * @returns {Array<Array<string>>} 행 배열(0번째 행 = 헤더)
 */
function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else field += c;
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ',') {
            row.push(field); field = '';
        } else if (c === '\r') {
            // no-op, \n 에서 행을 닫는다
        } else if (c === '\n') {
            row.push(field); field = '';
            rows.push(row); row = [];
        } else {
            field += c;
        }
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));
}

/**
 * EUC-KR CSV 파일을 읽어 {컬럼명: 값} 객체 배열로 돌려준다.
 * @param {string} filePath
 * @returns {Array<Object>}
 */
function readCsvAsRecords(filePath) {
    const buf = fs.readFileSync(filePath);
    const text = iconv.decode(buf, 'euc-kr');
    const rows = parseCsv(text);
    const header = rows[0];
    return rows.slice(1).map((r) => {
        const obj = {};
        header.forEach((h, i) => { obj[h] = r[i]; });
        return obj;
    });
}

function inKorea(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon) &&
        lat >= KOREA_BOUNDS.latMin && lat <= KOREA_BOUNDS.latMax &&
        lon >= KOREA_BOUNDS.lonMin && lon <= KOREA_BOUNDS.lonMax;
}

/** 위경도로서 물리적으로 유효한 값인가(0,0 널섬 제외). */
function isPlausibleLatLon(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon) &&
        lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 &&
        !(Math.abs(lat) < 1 && Math.abs(lon) < 1);
}

/**
 * 선박(해경)·선박(심판원) ORGNL_XCDNT/ORGNL_YCDNT 를 [lat, lon] 으로 정규화한다.
 * 대부분 행은 X=위도·Y=경도(도분초 컬럼과 대조로 확인한 원래 규칙)지만, 선박
 * (심판원) 데이터의 약 31%(13,104/42,120건)는 X·Y 가 뒤바뀌어 들어있다(원본 데이터
 * 자체의 오류 — 위도값이 90 을 넘는 등 물리적으로 불가능해 검증 중 발견). X=위도로
 * 봤을 때 불가능하면 Y=위도로 다시 시도하고, 둘 다 불가능하면 null(제외)한다.
 * @param {number} x - ORGNL_XCDNT
 * @param {number} y - ORGNL_YCDNT
 * @returns {[number, number] | null} [lat, lon]
 */
function resolveOrgnlLatLon(x, y) {
    if (isPlausibleLatLon(x, y)) return [round5(x), round5(y)];
    if (isPlausibleLatLon(y, x)) return [round5(y), round5(x)];
    return null;
}

function toInt(v) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
}

/** 선박(해경) — TL_SHPACC_HK_P.csv */
function buildShipsHk() {
    const records = readCsvAsRecords(path.join(RAW_DIR, 'TL_SHPACC_HK_P.csv'));
    let skipped = 0;
    const rows = records.map((r) => {
        const latLon = resolveOrgnlLatLon(parseFloat(r.ORGNL_XCDNT), parseFloat(r.ORGNL_YCDNT));
        if (!latLon) { skipped++; return null; }
        const [lat, lon] = latLon;
        return [lat, lon, r.OCRN_YMD || '', r.OCRN_HM || '', r.ACDNT_PSTN || '',
            r.ACDNT_TYPE_CD || '', r.OCRN_CAUS_CD || '', r.SHIP_KND_CD || '',
            toInt(r.CMPTNC_KCGOFC_CD), toInt(r.RSCU_PRSN), toInt(r.DTH_PRSN), toInt(r.MISG_PRSN)];
    }).filter(Boolean);
    writeJson('accident_ships_hk.json', rows);
    console.log(`[선박·해경] ${rows.length}건 저장, ${skipped}건 좌표 불가 제외 (전체 ${records.length}건)`);
}

/** 선박(심판원) — TL_SHPACC_HS_P.csv */
function buildShipsHs() {
    const records = readCsvAsRecords(path.join(RAW_DIR, 'TL_SHPACC_HS_P.csv'));
    let skipped = 0;
    const rows = records.map((r) => {
        const latLon = resolveOrgnlLatLon(parseFloat(r.ORGNL_XCDNT), parseFloat(r.ORGNL_YCDNT));
        if (!latLon) { skipped++; return null; }
        const [lat, lon] = latLon;
        return [lat, lon, toInt(r.OCRN_YR), toInt(r.OCRN_MM), toInt(r.OCRN_DAY),
            toInt(r.OCRN_HR), toInt(r.OCRN_MN), r.OCRN_TMZ_CD || '',
            r.ACDNT_NO || '', r.SHIP_NM || '', r.ACDNT_TYPE_CD || '', r.ACDNT_SEAR1_CD || ''];
    }).filter(Boolean);
    writeJson('accident_ships_hs.json', rows);
    console.log(`[선박·심판원] ${rows.length}건 저장, ${skipped}건 좌표 불가 제외 (전체 ${records.length}건)`);
}

/** 인명사고 — TL_NSHPAC.csv (좌표가 TM 투영이라 proj4 역변환 필요) */
function buildPersons() {
    const records = readCsvAsRecords(path.join(RAW_DIR, 'TL_NSHPAC.csv'));
    let skipped = 0;
    const rows = records.map((r) => {
        const x = parseFloat(r.XCDNT), y = parseFloat(r.YCDNT);
        if (!Number.isFinite(x) || !Number.isFinite(y)) { skipped++; return null; }
        const [lon, lat] = proj4(KGD2002_UNIFIED, proj4.WGS84, [x, y]);
        const rLat = round5(lat), rLon = round5(lon);
        if (!inKorea(rLat, rLon)) { skipped++; return null; }
        return [rLat, rLon, r.OCRN_YMD || '', r.ACDNT_PSTN || '', r.ACDNT_TYPE_CD || '',
            toInt(r.CMPTNC_KCGOFC_CD), toInt(r.ACDNT_PRSN), toInt(r.RSCU_PRSN),
            toInt(r.DTH_PRSN), toInt(r.MISG_PRSN)];
    }).filter(Boolean);
    writeJson('accident_persons.json', rows);
    console.log(`[인명] ${rows.length}건 저장, ${skipped}건 좌표변환 실패/범위 밖 제외 (전체 ${records.length}건)`);
}

function round5(n) {
    return Number.isFinite(n) ? Math.round(n * 100000) / 100000 : NaN;
}

function writeJson(filename, rows) {
    const outPath = path.join(OUT_DIR, filename);
    fs.writeFileSync(outPath, JSON.stringify({ v: 1, rows }));
    const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
    console.log(`  → ${outPath} (${kb}KB)`);
}

function main() {
    if (!fs.existsSync(RAW_DIR)) {
        console.error(`[build_accidents] 원본 CSV 폴더가 없습니다: ${RAW_DIR}`);
        console.error('선박사고(해양경찰서)/(해양안전심판원)/인명사고 zip 안의 CSV 3개를 이 폴더에 두고 다시 실행하세요.');
        process.exit(1);
    }
    buildShipsHk();
    buildShipsHs();
    buildPersons();
}

main();
