/**
 * ============================================================================
 * 파일명: local_server/scripts/build_ship_accidents_v2.js
 * 역할  : 선박사고(해경·심판원) 데이터를 원본 CSV부터 전면 재구축한다.
 *         기존 build_tribunal_merge.js(2026-08-25, 1회성)는 이미 삭제됐던
 *         2016·2021-2024 hk 일부만 복원하는 방식이었는데, 그 원본 삭제 자체가
 *         손실이 큰 임시조치(prepurge 스냅샷 의존)였다는 게 이번 조사로 드러나
 *         (8,894건 유실 확인) 처음부터 원본 CSV로 다시 만든다.
 * ----------------------------------------------------------------------------
 * [2026-09-01 사용자 확정 설계]
 *   - 2008~2024: TL_SHPACC_HK_P.csv(해경)·TL_SHPACC_HS_P.csv(심판원) 원본,
 *     ERR_CD 빈 값만(khoa 라이브 지도와 동일 — build_accidents.js buildPersons
 *     의 ERR_CD 필터와 같은 근거, 이번 세션에 선박사고 두 레이어도 라이브=CSV
 *     서브미터 정밀도로 재확인함). 라이브 API 재조회 불필요 — CSV 가 더 풍부.
 *   - 2025: 해경 원본이 아예 없어(HK CSV 최신년도가 2024) 심판원 신규 CSV
 *     (TL_SHPACC_HS_NEW.csv, 2021~2025 별도 제공분)의 2025년만 단독 사용.
 *   - 해경↔심판원 중복판정: 3km 이내 + 5분 이내(정밀 시각 필드 기준, 라이브
 *     데이터의 날짜만으로는 이 정밀도가 안 나옴) — 1:1 그리디 매칭(가까운 거리부터
 *     확정, 이미 매칭된 쪽은 제외) — build_tribunal_merge.js matchAgainstBucket 과
 *     같은 3km/5분 버킷 탐색을 재사용하되, 여기선 1:1 전역 매칭으로 확장.
 *   - 사고유형: 매칭된 것 중 해경=접촉·심판원=충돌(또는 반대) 처럼 접촉/충돌
 *     쌍이 갈리면 충돌로 통일(기존 build_tribunal_merge.js 선례 확장). 해경만
 *     있고(매칭 안 됨) 유형이 접촉/충돌 쌍 중 하나면 접촉으로(심판원 미확인 상태
 *     이므로 보수적으로) 반영. 심판원만 있는 데이터는 심판원 자체 유형(공식 CSV에
 *     ATY0xx 코드가 이미 있음 — 해경과 같은 코드공간 공유, 텍스트 매핑 불필요)
 *     그대로 사용, 강제 변환 없음.
 *   - 관할서(orgCd): 해경 있는 행(매칭·해경단독)은 해경 원본 CMPTNC_KCGOFC_CD
 *     그대로. 심판원단독 행(공식 CSV에 관할서 필드 없음)은 법령 기반 21개 서
 *     경계 폴리곤(classifyOrg, build_tribunal_merge.js 그대로 재사용)으로 추정.
 *   - 선박용도·톤수·계절·사망/실종: 심판원 공식 CSV(TL_SHPACC_HS_P.csv)엔 이
 *     필드들이 아예 없다(선박명 자유텍스트만 있음) — 대신 보조 심판원 사례DB
 *     파일(2016~2020 통계 재구성본·2021~2025 신규본)을 날짜+좌표+5분/3km로
 *     한 번 더 매칭해 얹는다("최대한 매칭해서 정보사항을 많이 표출" 사용자
 *     확정). 이 매칭은 구조적 중복판정(해경↔심판원)과 별개 — 매칭·해경단독·
 *     심판원단독 모든 행에 적용 가능하나, 2008~2015년은 보조 파일 자체가 없어
 *     "정보없음"(null) 유지. 2025 단독행은 이 보조파일이 원천 데이터라 매칭 없이
 *     자기 자신의 선박용도·톤수·계절·사망/실종 컬럼을 그대로 쓴다.
 *   - 사건번호(caseNo): 불필요(사용자 확정) — 기존 17번째 필드 제거. 다만
 *     accident_info.js 의 "심판원 검수 팝업"(REVIEW_MODE, ensureHkRowByCaseNo)이
 *     r[16]=caseNo 로 병합여부를 표시하던 기능은 이 필드가 없어져 항상
 *     "미병합"으로만 보인다(관리자 전용 비밀 진입 화면, 공개 지도 기능 아님 —
 *     이 스크립트를 만든 시점에 사용자에게 별도 보고).
 * ----------------------------------------------------------------------------
 * [출력 스키마] client/accident_ships_hk.json — 16개 필드(기존 17개에서 caseNo 제거):
 *   [lat, lon, ymd, hm, pos, typeCd, causeCd, shipCd, orgCd, rescue, death,
 *    missing, warnFlags, shipUse, tonnage, season]
 *   warnFlags 는 전부 [](미계산) — build_accident_warn_flags.js 로 별도 재계산 필요
 *   (그 스크립트는 기존 행 재계산값이 달라지면 중단하는 자기검증이 있어, 이 전면
 *   재구축 이후엔 그 검증을 다시 보고 판단해야 함 — 사용자에게 별도 보고).
 * [실행] node local_server/scripts/build_ship_accidents_v2.js
 * [연계] client/js/marine-life/safety/accident_info.js
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

const RAW_DIR = path.join(__dirname, '_accident_raw');
const CONFIG_DIR = path.join(__dirname, '..', 'config');
const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');

const TYPE_LABELS = { ATY019: '접촉', ATY027: '충돌' };

// 심판원 CSV "해양사고종류1" 텍스트 → hk 사고유형코드(ATY0xx). 2025 단독행(공식
// CSV에 없어 텍스트만 있는 유일한 경우)에만 쓴다 — build_tribunal_merge.js 와 동일.
const SEA_TYPE_TO_ATY = {
    충돌: 'ATY027', 침몰: 'ATY028', 전복: 'ATY018', 화재: 'ATY036', 좌초: 'ATY023',
    폭발: 'ATY032', 접촉: 'ATY019', 침수: 'ATY029', 기관손상: 'ATY010',
    조타장치손상: 'ATY021', 운항저해: 'ATY016', 추진축계손상: 'ATY026',
    해양오염: 'ATY034', 부유물감김: 'ATY040', 안전사고: 'ATY017',
    시설물손상: 'ATY014', 속구손상: 'ATY013', 행방불명: 'ATY035', 기타: 'ATY038',
    '선체결함 또는 수밀문, 개구부 결함': 'ATY012',
};
function mapSeaTypeToAty(text) {
    if (!text) return null;
    const base = text.replace(/\([^)]*\)\s*$/, '').trim();
    return SEA_TYPE_TO_ATY[base] || null;
}

// ── CSV 파서(RFC4180 최소구현, build_accidents.js/build_tribunal_merge.js 와 동일) ──
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
            // no-op
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

function readCsvAsRecords(filePath, encoding) {
    const buf = fs.readFileSync(filePath);
    const text = (encoding === 'euckr' ? iconv.decode(buf, 'euc-kr') : buf.toString('utf8')).replace(/^﻿/, '');
    const rows = parseCsv(text);
    const header = rows[0].map((h) => h.trim());
    return rows.slice(1).map((r) => {
        const obj = {};
        header.forEach((h, i) => { obj[h] = r[i]; });
        return obj;
    });
}

function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371.0;
    const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
    const dphi = (lat2 - lat1) * Math.PI / 180;
    const dl = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

function toMinutes(y, mo, d, h, mi) {
    const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)));
    if (isNaN(dt.getTime())) return null;
    return dt.getTime() / 60000;
}

/** 도분초 3필드 → 십진도, 방위문자로 부호 결정. dirSouth/dirWest 는 그 표기 체계의
 * "남"/"서"에 해당하는 문자(한글 파일은 '남'/'서', 공식 CSV는 영문 'S'/'W'). */
function dmsToDecimal(degStr, minStr, secStr, dir, dirSouth, dirWest) {
    const m = String(degStr).match(/(\d+)$/);
    const deg = m ? parseFloat(m[1]) : NaN;
    const min = parseFloat(minStr || 0);
    const sec = parseFloat(secStr || 0);
    if (!Number.isFinite(deg)) return null;
    const val = deg + (Number.isFinite(min) ? min : 0) / 60 + (Number.isFinite(sec) ? sec : 0) / 3600;
    return (dir === dirSouth || dir === dirWest) ? -val : val;
}

function round5(n) { return Number.isFinite(n) ? Math.round(n * 100000) / 100000 : NaN; }
function toIntOrNull(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }
function toFloatOrNull(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }

// ── 점(ray casting) in 폴리곤 / 경계까지 거리 (build_tribunal_merge.js 그대로) ──
function pointInPolygon(lon, lat, coords) {
    let inside = false;
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
        const xi = coords[i][0], yi = coords[i][1];
        const xj = coords[j][0], yj = coords[j][1];
        const intersect = ((yi > lat) !== (yj > lat)) &&
            (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}
function distToPolygonBoundary(lon, lat, coords) {
    let best = Infinity;
    for (let i = 0; i < coords.length; i++) {
        const [x1, y1] = coords[i];
        const [x2, y2] = coords[(i + 1) % coords.length];
        const dx = x2 - x1, dy = y2 - y1;
        const len2 = dx * dx + dy * dy;
        let t = len2 > 0 ? ((lon - x1) * dx + (lat - y1) * dy) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        const px = x1 + t * dx, py = y1 + t * dy;
        const d = Math.hypot(lon - px, lat - py);
        if (d < best) best = d;
    }
    return best;
}

/** 5분 버킷 인덱스에 넣고, ±1버킷까지 뒤져 3km/5분 이내 최적(최소거리) 후보를 찾는다. */
function buildBucket(items, tKey) {
    const bucket = new Map();
    items.forEach((it, idx) => {
        const t = it[tKey];
        if (t == null) return;
        const b = Math.floor(t / 5);
        if (!bucket.has(b)) bucket.set(b, []);
        bucket.get(b).push(idx);
    });
    return bucket;
}
function candidatesInBucket(bucket, items, lat, lon, t, maxKm) {
    const out = [];
    const b0 = Math.floor(t / 5);
    for (const b of [b0 - 1, b0, b0 + 1]) {
        const idxs = bucket.get(b) || [];
        for (const idx of idxs) {
            const it = items[idx];
            if (Math.abs(it.t - t) > 5) continue;
            const d = haversineKm(lat, lon, it.lat, it.lon);
            if (d <= maxKm) out.push({ idx, d });
        }
    }
    return out;
}
function bestCandidate(bucket, items, lat, lon, t, maxKm) {
    const cands = candidatesInBucket(bucket, items, lat, lon, t, maxKm);
    if (!cands.length) return null;
    cands.sort((a, b) => a.d - b.d);
    return items[cands[0].idx];
}

function main() {
    // ── 관할서 경계 폴리곤 + 코드/라벨 표 (build_tribunal_merge.js 그대로) ──
    const faces = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'coastguard_jurisdiction_faces.json'), 'utf8'));
    const gangneung = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'coastguard_gangneung_zone.json'), 'utf8'));
    const ORG_CODE_OF = {
        속초해양경찰서: 1532418, 동해해양경찰서: 1532440, 포항해양경찰서: 1532466, 울산해양경찰서: 1532304,
        부산해양경찰서: 1532329, 창원해양경찰서: 1532357, 통영해양경찰서: 1532376, 여수해양경찰서: 1532170,
        완도해양경찰서: 1532199, 목포해양경찰서: 1532222, 군산해양경찰서: 1532255, 보령해양경찰서: 1532056,
        태안해양경찰서: 1532074, 평택해양경찰서: 1532098, 인천해양경찰서: 1532121, 제주해양경찰서: 1532508,
        서귀포해양경찰서: 1532530, 부안해양경찰서: 1532281, 울진해양경찰서: 1532609, 사천해양경찰서: 1532759,
        강릉해양경찰서: 1532865,
    };
    const ORG_LABEL_OF = {
        1532418: '속초해양경찰서', 1532440: '동해해양경찰서', 1532466: '포항해양경찰서', 1532304: '울산해양경찰서',
        1532329: '부산해양경찰서', 1532357: '창원해양경찰서', 1532376: '통영해양경찰서', 1532170: '여수해양경찰서',
        1532199: '완도해양경찰서', 1532222: '목포해양경찰서', 1532255: '군산해양경찰서', 1532056: '보령해양경찰서',
        1532074: '태안해양경찰서', 1532098: '평택해양경찰서', 1532121: '인천해양경찰서', 1532508: '제주해양경찰서',
        1532530: '서귀포해양경찰서', 1532281: '부안해양경찰서', 1532609: '울진해양경찰서', 1532759: '사천해양경찰서',
        1750163: '속초해양경찰서', 1750186: '동해해양경찰서', 1750213: '포항해양경찰서', 1750259: '울산해양경찰서',
        1750283: '부산해양경찰서', 1750311: '창원해양경찰서', 1750329: '통영해양경찰서', 1750374: '여수해양경찰서',
        1750403: '완도해양경찰서', 1750426: '목포해양경찰서', 1750461: '군산해양경찰서', 1750494: '보령해양경찰서',
        1750511: '태안해양경찰서', 1750533: '평택해양경찰서', 1750556: '인천해양경찰서', 1750608: '제주해양경찰서',
        1750612: '제주해양경찰서', 1750631: '서귀포해양경찰서', 1750632: '서귀포해양경찰서',
    };

    // ── 관할서 kNN 학습셋 — hk 원본(ERR_CD 필터 후) 좌표로 학습 ──
    const hkRecordsRaw = readCsvAsRecords(path.join(RAW_DIR, 'TL_SHPACC_HK_P.csv'), 'euckr')
        .filter((r) => (r.ERR_CD || '').trim() === '');
    const trainPts = [];
    hkRecordsRaw.forEach((r) => {
        const orgCd = toIntOrNull(r.CMPTNC_KCGOFC_CD);
        const name = orgCd != null ? ORG_LABEL_OF[orgCd] : null;
        const lat = toFloatOrNull(r.ORGNL_XCDNT), lon = toFloatOrNull(r.ORGNL_YCDNT);
        if (name && lat != null && lon != null) trainPts.push([lat, lon, name]);
    });
    function knn5(lat, lon) {
        const withDist = trainPts.map((t) => ({ d: (t[0] - lat) ** 2 + (t[1] - lon) ** 2, name: t[2] }));
        withDist.sort((a, b) => a.d - b.d);
        const votes = {};
        for (let i = 0; i < 5; i++) votes[withDist[i].name] = (votes[withDist[i].name] || 0) + 1;
        return Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
    }
    const ESTABLISHED_YMD = {
        평택해양경찰서: '20110401', 창원해양경찰서: '20121227', 보령해양경찰서: '20140401',
        부안해양경찰서: '20160421', 울진해양경찰서: '20171128', 사천해양경찰서: '20220331',
    };
    function classifyOrg(lat, lon, ymd) {
        if (ymd >= '20250331' && pointInPolygon(lon, lat, gangneung.coords)) return '강릉해양경찰서';
        let hit = null;
        for (const f of faces) {
            if (!pointInPolygon(lon, lat, f.coords)) continue;
            const est = ESTABLISHED_YMD[f.owner];
            if (est && ymd < est) continue;
            hit = f; break;
        }
        if (hit) return hit.owner;
        let best = null;
        for (const f of faces) {
            const est = ESTABLISHED_YMD[f.owner];
            if (est && ymd < est) continue;
            const d = distToPolygonBoundary(lon, lat, f.coords);
            if (d < 0.05 && (!best || d < best.d)) best = { d, owner: f.owner };
        }
        if (best) return best.owner;
        return knn5(lat, lon);
    }

    // ============ 1) 해경(hk) 2008-2024, ERR_CD 필터 ============
    const hk = hkRecordsRaw.map((r) => {
        const lat = toFloatOrNull(r.ORGNL_XCDNT), lon = toFloatOrNull(r.ORGNL_YCDNT);
        if (lat == null || lon == null) return null;
        const hm = r.OCRN_HM || '';
        let t = null;
        if (hm.indexOf(':') !== -1 && r.OCRN_YMD && r.OCRN_YMD.length === 8) {
            const [h, mi] = hm.split(':');
            t = toMinutes(r.OCRN_YMD.slice(0, 4), r.OCRN_YMD.slice(4, 6), r.OCRN_YMD.slice(6, 8), h, mi);
        }
        return {
            lat: round5(lat), lon: round5(lon), ymd: r.OCRN_YMD || '', hm, pos: r.ACDNT_PSTN || '',
            typeCd: r.ACDNT_TYPE_CD || null, causeCd: r.OCRN_CAUS_CD || null, shipCd: r.SHIP_KND_CD || null,
            orgCd: toIntOrNull(r.CMPTNC_KCGOFC_CD), rescue: toIntOrNull(r.RSCU_PRSN) || 0,
            death: toIntOrNull(r.DTH_PRSN) || 0, missing: toIntOrNull(r.MISG_PRSN) || 0, t,
        };
    }).filter(Boolean);
    const hkBucket = buildBucket(hk, 't');
    console.log(`[해경 원본] ERR_CD 필터 후 ${hk.length}건 (전체 ${hkRecordsRaw.length}건)`);

    // ============ 2) 심판원(hs) 공식 CSV 2008-2024, ERR_CD 필터, DMS 좌표 ============
    const hsRecordsRaw = readCsvAsRecords(path.join(RAW_DIR, 'TL_SHPACC_HS_P.csv'), 'euckr')
        .filter((r) => (r.ERR_CD || '').trim() === '');
    const hs = hsRecordsRaw.map((r) => {
        const lat = dmsToDecimal(r.LAT_DGR, r.LAT_MN, r.LAT_SEC, r.LAT_AZM, 'S', 'W');
        const lon = dmsToDecimal(r.LOT_DGR, r.LOT_MN, r.LOT_SEC, r.LOT_AZM, 'S', 'W');
        if (lat == null || lon == null) return null;
        const y = r.OCRN_YR, mo = r.OCRN_MM, d = r.OCRN_DAY, h = r.OCRN_HR || '0', mi = r.OCRN_MN || '0';
        const t = toMinutes(y, mo, d, h, mi);
        const ymd = String(y) + String(mo).padStart(2, '0') + String(d).padStart(2, '0');
        const hm = `${parseInt(h, 10)}:${String(parseInt(mi, 10)).padStart(2, '0')}`;
        return { lat: round5(lat), lon: round5(lon), ymd, hm, typeCd: r.ACDNT_TYPE_CD || null, t };
    }).filter(Boolean);
    console.log(`[심판원 공식] ERR_CD 필터 후 ${hs.length}건 (전체 ${hsRecordsRaw.length}건)`);

    // ============ 3) 해경↔심판원 1:1 그리디 매칭(3km/5분) ============
    const pairs = [];
    hs.forEach((h, hsIdx) => {
        if (h.t == null) return;
        const cands = candidatesInBucket(hkBucket, hk, h.lat, h.lon, h.t, 3);
        cands.forEach((c) => pairs.push({ hsIdx, hkIdx: c.idx, d: c.d }));
    });
    pairs.sort((a, b) => a.d - b.d);
    const hkMatchedTo = new Map(); // hkIdx -> hsIdx
    const hsMatchedTo = new Map(); // hsIdx -> hkIdx
    pairs.forEach((p) => {
        if (hkMatchedTo.has(p.hkIdx) || hsMatchedTo.has(p.hsIdx)) return;
        hkMatchedTo.set(p.hkIdx, p.hsIdx);
        hsMatchedTo.set(p.hsIdx, p.hkIdx);
    });
    console.log(`[매칭] ${hkMatchedTo.size}건 (해경 ${hk.length}건 중, 심판원 ${hs.length}건 중)`);

    // ============ 4) 보조 심판원 사례DB(2016-2020·2021-2025) — 선박용도/톤수/계절/사상자 보강용 ============
    const oldStat = readCsvAsRecords(path.join(RAW_DIR, 'TL_SHPACC_HS_STAT_2016_2020.csv'), 'utf8');
    const oldItems = oldStat.map((row) => {
        const lat = dmsToDecimal(row['해양사고위치도위도'], row['해양사고위치분위도'], row['해양사고위치초위도'], row['해양사고위도구분'], '남', '서');
        const lon = dmsToDecimal(row['해양사고위치도경도'], row['해양사고위치분경도'], row['해양사고위치초경도'], row['해양사고경도구분'], '남', '서');
        const t = toMinutes(row['해양사고발생년'], row['해양사고발생월'], row['해양사고발생일'], row['해양사고발생시'] || 0, row['해양사고발생분'] || 0);
        if (t == null || lat == null) return null;
        return {
            t, lat, lon, shipUse: row['선박용도'] || null,
            death: toIntOrNull(row['사망']), missing: toIntOrNull(row['실종']),
        };
    }).filter(Boolean);
    const oldBucket = buildBucket(oldItems, 't');

    const tribNew = readCsvAsRecords(path.join(RAW_DIR, 'TL_SHPACC_HS_NEW.csv'), 'utf8');
    const newItems = tribNew.map((row) => {
        const lat = dmsToDecimal(row['해양사고장소(위도)'], row['해양사고장소(위분)'], row['해양사고장소(위초)'], row['해양사고장소(위)'], '남', '서');
        const lon = dmsToDecimal(row['해양사고장소(경도)'], row['해양사고장소(경분)'], row['해양사고장소(경초)'], row['해양사고장소(경)'], '남', '서');
        const t = toMinutes(row['해양사고발생(년도)'], row['해양사고발생(월)'], row['해양사고발생(일)'], row['해양사고발생(시)'] || 0, row['해양사고발생(분)'] || 0);
        if (t == null || lat == null) return null;
        return {
            t, lat, lon, shipUse: row['선박용도(통계용)'] || null,
            tonnage: toFloatOrNull(row['선박톤수']), season: row['계절'] || null,
            death: toIntOrNull(row['사망합계(선원_여객_기타)']), missing: toIntOrNull(row['실종합계(선원_여객_기타)']),
        };
    }).filter(Boolean);
    const newBucket = buildBucket(newItems, 't');

    /** 연도에 맞는 보조 파일에서 선박용도/톤수/계절/사상자를 매칭해온다.
     * 2008~2015 는 보조 파일 자체가 없어 항상 null(정보없음) — 추측 채움 없음. */
    function enrichFromSupplement(lat, lon, ymd, t) {
        if (t == null) return null;
        const year = ymd.slice(0, 4);
        if (year >= '2016' && year <= '2020') {
            const m = bestCandidate(oldBucket, oldItems, lat, lon, t, 3);
            if (m) return { shipUse: m.shipUse, tonnage: null, season: null, death: m.death, missing: m.missing };
        } else if (year >= '2021' && year <= '2024') {
            const m = bestCandidate(newBucket, newItems, lat, lon, t, 3);
            if (m) return { shipUse: m.shipUse, tonnage: m.tonnage, season: m.season, death: m.death, missing: m.missing };
        }
        return null;
    }

    // ============ 5) 최종 행 조립 ============
    const rows = [];
    let typeUnifiedToCollision = 0, typeDowngradedToContact = 0;
    let supEnrichedMatched = 0, supEnrichedHkOnly = 0, supEnrichedHsOnly = 0;

    // 5-a) 매칭된 해경 행 — hk 필드 기준 + 필요 시 유형 통일 + 보조파일 선박용도 보강
    hk.forEach((h, hkIdx) => {
        const hsIdx = hkMatchedTo.get(hkIdx);
        let typeCd = h.typeCd;
        let shipUse = null, tonnage = null, season = null;
        if (hsIdx != null) {
            const hsType = hs[hsIdx].typeCd;
            const pair = new Set([TYPE_LABELS[typeCd], TYPE_LABELS[hsType]]);
            if (pair.has('접촉') && pair.has('충돌') && typeCd !== hsType) {
                typeCd = 'ATY027';
                typeUnifiedToCollision++;
            }
        }
        const sup = enrichFromSupplement(h.lat, h.lon, h.ymd, h.t);
        if (sup) {
            shipUse = sup.shipUse; tonnage = sup.tonnage; season = sup.season;
            if (hsIdx != null) supEnrichedMatched++; else supEnrichedHkOnly++;
        }
        if (hsIdx == null && typeCd === 'ATY027') {
            typeCd = 'ATY019';
            typeDowngradedToContact++;
        }
        rows.push([
            h.lat, h.lon, h.ymd, h.hm, h.pos, typeCd, h.causeCd, h.shipCd, h.orgCd || 0,
            h.rescue, h.death, h.missing, [], shipUse, tonnage, season,
        ]);
    });

    // 5-b) 심판원단독 행(2008-2024, 해경 매칭 안 됨) — 폴리곤 관할 + 보조파일 보강
    let hsOnlyCount = 0;
    hs.forEach((r, hsIdx) => {
        if (hsMatchedTo.has(hsIdx)) return;
        hsOnlyCount++;
        const orgName = classifyOrg(r.lat, r.lon, r.ymd);
        const orgCd = ORG_CODE_OF[orgName] || 0;
        const sup = enrichFromSupplement(r.lat, r.lon, r.ymd, r.t);
        let shipUse = null, tonnage = null, season = null, death = null, missing = null;
        if (sup) {
            shipUse = sup.shipUse; tonnage = sup.tonnage; season = sup.season;
            death = sup.death; missing = sup.missing;
            supEnrichedHsOnly++;
        }
        rows.push([
            r.lat, r.lon, r.ymd, r.hm, null, r.typeCd, null, null, orgCd,
            null, death, missing, [], shipUse, tonnage, season,
        ]);
    });
    console.log(`[심판원단독 2008-2024] ${hsOnlyCount}건`);

    // 5-c) 2025 심판원 단독 — 신규 CSV 자체가 원천(선박용도/톤수/계절/사상자 직접 사용)
    const trib2025 = tribNew.filter((row) => row['해양사고발생(년도)'] === '2025');
    let gangneungCount = 0;
    const unmappedTypes = {};
    let rows2025 = 0;
    trib2025.forEach((row) => {
        const lat = dmsToDecimal(row['해양사고장소(위도)'], row['해양사고장소(위분)'], row['해양사고장소(위초)'], row['해양사고장소(위)'], '남', '서');
        const lon = dmsToDecimal(row['해양사고장소(경도)'], row['해양사고장소(경분)'], row['해양사고장소(경초)'], row['해양사고장소(경)'], '남', '서');
        if (lat == null || lon == null) return;
        const ymd = row['해양사고발생(년도)'] + row['해양사고발생(월)'].padStart(2, '0') + row['해양사고발생(일)'].padStart(2, '0');
        const h = row['해양사고발생(시)'] || '0', mi = row['해양사고발생(분)'] || '0';
        const hm = `${parseInt(h, 10)}:${String(parseInt(mi, 10)).padStart(2, '0')}`;
        const orgName = classifyOrg(lat, lon, ymd);
        if (orgName === '강릉해양경찰서') gangneungCount++;
        const orgCd = ORG_CODE_OF[orgName] || 0;
        const typeCd = mapSeaTypeToAty(row['해양사고종류1']);
        if (!typeCd && row['해양사고종류1']) unmappedTypes[row['해양사고종류1']] = (unmappedTypes[row['해양사고종류1']] || 0) + 1;
        const tonnage = toFloatOrNull(row['선박톤수']);
        rows.push([
            round5(lat), round5(lon), ymd, hm, null, typeCd, null, null, orgCd,
            null, toIntOrNull(row['사망합계(선원_여객_기타)']), toIntOrNull(row['실종합계(선원_여객_기타)']),
            [], row['선박용도(통계용)'] || null, tonnage, row['계절'] || null,
        ]);
        rows2025++;
    });
    console.log(`[2025 단독] ${rows2025}건 추가(강릉 ${gangneungCount}건)`);
    if (Object.keys(unmappedTypes).length) console.log('[2025 단독] 사고유형 매핑 안 된 텍스트:', unmappedTypes);

    console.log(`[유형 조정] 매칭 후 접촉/충돌 충돌로 통일 ${typeUnifiedToCollision}건, 해경단독 접촉/충돌 접촉으로 하향 ${typeDowngradedToContact}건`);
    console.log(`[보조파일 보강] 매칭행 ${supEnrichedMatched}건·해경단독 ${supEnrichedHkOnly}건·심판원단독(08-24) ${supEnrichedHsOnly}건`);

    fs.writeFileSync(path.join(CLIENT_DIR, 'accident_ships_hk.json'), JSON.stringify({ v: 1, rows }));
    console.log(`[완료] 총 ${rows.length}건 저장 (해경계열 ${hk.length} + 심판원단독 08-24 ${hsOnlyCount} + 2025단독 ${rows2025})`);
}

main();
