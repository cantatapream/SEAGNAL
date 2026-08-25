/**
 * ============================================================================
 * 파일명: scripts/build_tribunal_merge.js
 * 역할  : 해양안전심판원 자료(2016~2025)를 해경(hk) 사고 데이터에 통합한다.
 *         2026-08-25 사용자 확정 설계를 그대로 구현 — 요약:
 *           - 2008~2015·2017~2020: 기존 hk 그대로(변경 없음)
 *           - 2016·2021~2024: 위치텍스트 빈값으로 삭제됐던 hk 원본 중,
 *             심판원 자료와 "완벽히 동일한 사고"(3km 이내 + 5분 이내, 사고유형
 *             불문)로 확인된 것만 복원 + 심판원의 선박용도·톤수·계절·사건번호를
 *             그 hk 행에 얹는다. 매칭 안 된 것은 삭제 상태 유지(부활 안 함).
 *             접촉/충돌이 서로 다르면 항상 "충돌"로 통일.
 *           - 2025: 해경 원본이 아예 없는 해라 심판원 자료를 단독으로 새 행에
 *             추가, 관할서는 법령 기반 21개 서 경계(coastguard_jurisdiction_faces.json)
 *             + 최근접이웃 보정으로 추정. 강릉해양경찰서(2025-03-31 개서)는
 *             그 날짜 이후 사고에만 적용(그 이전은 동해/속초로 판정).
 * ----------------------------------------------------------------------------
 * [입력]
 *   - client/accident_ships_hk.json (현재 서비스 중인 hk 원본, 2008~2020·2016 제외)
 *   - scripts/_accident_raw/hk_2016_2021_2024_prepurge.json (위치텍스트 삭제 이전
 *     스냅샷에서 2016·2021~2024년만 추출, git 이력에서 복구 — git 추적 안 함)
 *   - scripts/_accident_raw/TL_SHPACC_HS_STAT_2016_2020.csv (심판원 2016~2020
 *     통계 재구성본, 선박용도 포함 — 사용자 제공)
 *   - scripts/_accident_raw/TL_SHPACC_HS_NEW.csv (심판원 2021~2025 신규 CSV,
 *     사건번호·선박용도·톤수·계절 포함 — 사용자 제공)
 *   - config/coastguard_jurisdiction_faces.json (법령 "해양경찰청과 그 소속기관
 *     직제 시행규칙 [별표 2]" 2025-02-25 개정판을 좌표로 옮겨 재구성한 20개 서
 *     경계 — 순도 60% 이상만 수록, 나머지는 최근접이웃으로 보정)
 *   - config/coastguard_gangneung_zone.json (강릉 — 위 법령에 4점으로 완전히
 *     닫힌 도형으로 정의돼 있어 별도 신뢰 구간 판정 없이 그대로 사용)
 * [출력] client/accident_ships_hk.json — 행 스키마가 13개→17개로 확장됨:
 *   [lat, lon, ymd, hm, pos, typeCd, causeCd, shipCd, orgCd, rescue, death,
 *    missing, warnFlags, shipUse, tonnage, season, caseNo]
 *   뒤 4개(shipUse·tonnage·season·caseNo)는 심판원 매칭/단독 행에만 값이 있고
 *   나머지는 null — "정보 없음"을 그대로 null 로 표현(추측 채움 없음).
 * [실행] node local_server/scripts/build_tribunal_merge.js
 * [연계] client/js/marine-life/safety/accident_info.js 가 이 JSON 을 fetch
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

const RAW_DIR = path.join(__dirname, '_accident_raw');
const CONFIG_DIR = path.join(__dirname, '..', 'config');
const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');

const TYPE_LABELS = {
    ATY019: '접촉', ATY027: '충돌',
};

// ── CSV 파서(RFC4180 최소구현, build_accidents.js/build_tribunal_review.js 와 동일) ──
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
    const text = (encoding === 'utf8' ? buf.toString('utf8') : buf.toString('utf8')).replace(/^﻿/, '');
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

/** "그 시각으로부터 몇 분"(2000-01-01 기준 순수 경과분, 윤년 등 Date 객체가 알아서 처리). */
function toMinutes(y, mo, d, h, mi) {
    const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)));
    if (isNaN(dt.getTime())) return null;
    return dt.getTime() / 60000;
}

/** 도분초 3필드(선행 방위문자 포함 가능 — "N34"·"NN36"·"동E126" 등 표기가 섞여 있어
 * 앞쪽 문자 개수를 가정하지 않고 끝의 숫자만 뽑는다) → 십진도. dir 이 남/서면 음수. */
function dmsToDecimal(degStr, minStr, secStr, dir) {
    const m = String(degStr).match(/(\d+)$/);
    const deg = m ? parseFloat(m[1]) : NaN;
    const min = parseFloat(minStr || 0);
    const sec = parseFloat(secStr || 0);
    if (!Number.isFinite(deg)) return null;
    const val = deg + (Number.isFinite(min) ? min : 0) / 60 + (Number.isFinite(sec) ? sec : 0) / 3600;
    return (dir === '남' || dir === '서') ? -val : val;
}

// ── 점(ray casting) in 폴리곤 ────────────────────────────────────────────
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

/** 점에서 폴리곤 경계까지 최소 거리(대략, 위경도 유클리드 — 근접 판정용이라 충분). */
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

function main() {
    // ── 관할서 경계 데이터 로드 ──
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

    // ── 기존(현재 서비스) hk 자료 — kNN 학습셋으로도 재사용 ──
    const currentHk = JSON.parse(fs.readFileSync(path.join(CLIENT_DIR, 'accident_ships_hk.json'), 'utf8'));
    const trainPts = [];
    currentHk.rows.forEach((r) => {
        const name = ORG_LABEL_OF[r[8]];
        if (name) trainPts.push([r[0], r[1], name]);
    });

    function knn5(lat, lon) {
        const withDist = trainPts.map((t) => ({ d: (t[0] - lat) ** 2 + (t[1] - lon) ** 2, name: t[2] }));
        withDist.sort((a, b) => a.d - b.d);
        const votes = {};
        for (let i = 0; i < 5; i++) votes[withDist[i].name] = (votes[withDist[i].name] || 0) + 1;
        return Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
    }

    function classifyOrg(lat, lon, ymd) {
        const p = [lon, lat];
        if (ymd >= '20250331' && pointInPolygon(lon, lat, gangneung.coords)) return '강릉해양경찰서';
        let hit = null;
        for (const f of faces) {
            if (pointInPolygon(lon, lat, f.coords)) { hit = f; break; }
        }
        if (hit) return hit.owner;
        // 경계선 위에 정확히 걸친 경우 등 — 가장 가까운 신뢰 구간으로
        let best = null;
        for (const f of faces) {
            const d = distToPolygonBoundary(lon, lat, f.coords);
            if (d < 0.05 && (!best || d < best.d)) best = { d, owner: f.owner };
        }
        if (best) return best.owner;
        return knn5(lat, lon);
    }

    // ============ 1) 2016·2021~2024 hk 복원 + 심판원 매칭 ============
    const prepurge = JSON.parse(fs.readFileSync(path.join(RAW_DIR, 'hk_2016_2021_2024_prepurge.json'), 'utf8'));
    const hk2016 = prepurge.filter((r) => r[2].slice(0, 4) === '2016');
    const hk2124 = prepurge.filter((r) => ['2021', '2022', '2023', '2024'].includes(r[2].slice(0, 4)));

    const oldStat = readCsvAsRecords(path.join(RAW_DIR, 'TL_SHPACC_HS_STAT_2016_2020.csv'));
    const oldBucket = new Map();
    oldStat.forEach((row) => {
        const lat = dmsToDecimal(row['해양사고위치도위도'], row['해양사고위치분위도'], row['해양사고위치초위도'], row['해양사고위도구분']);
        const lon = dmsToDecimal(row['해양사고위치도경도'], row['해양사고위치분경도'], row['해양사고위치초경도'], row['해양사고경도구분']);
        const t = toMinutes(row['해양사고발생년'], row['해양사고발생월'], row['해양사고발생일'], row['해양사고발생시'] || 0, row['해양사고발생분'] || 0);
        if (t == null || lat == null) return;
        const bucket = Math.floor(t / 5);
        if (!oldBucket.has(bucket)) oldBucket.set(bucket, []);
        oldBucket.get(bucket).push({ t, lat, lon, type: row['해양사고발생종류'], shipUse: row['선박용도'] });
    });

    function matchAgainstBucket(bucket, lat, lon, t) {
        let best = null;
        for (const b of [Math.floor(t / 5) - 1, Math.floor(t / 5), Math.floor(t / 5) + 1]) {
            const cands = bucket.get(b) || [];
            for (const c of cands) {
                if (Math.abs(c.t - t) > 5) continue;
                const d = haversineKm(lat, lon, c.lat, c.lon);
                if (d <= 3 && (!best || d < best.d)) best = { d, ...c };
            }
        }
        return best;
    }

    function restoreRows(rows, bucket, extraFields) {
        const out = [];
        let matched = 0;
        rows.forEach((r) => {
            const ymd = r[2], hm = r[3];
            if (!hm || hm.indexOf(':') === -1) return;
            const [h, mi] = hm.split(':');
            const t = toMinutes(ymd.slice(0, 4), ymd.slice(4, 6), ymd.slice(6, 8), h, mi);
            if (t == null) return;
            const m = matchAgainstBucket(bucket, r[0], r[1], t);
            if (!m) return;
            matched++;
            const hkType = TYPE_LABELS[r[5]];
            const newRow = r.slice();
            if (hkType === '접촉' && m.type === '충돌') newRow[5] = 'ATY027';
            // 2016년 원본은 관할서 코드(orgCd) 자체가 전체 비어 있다(최초 빌드 커밋까지
            // 확인 — 원본 데이터 자체의 결손, 복원 과정에서 생긴 문제 아님). 공간추정으로 채운다.
            if (!newRow[8]) newRow[8] = ORG_CODE_OF[classifyOrg(newRow[0], newRow[1], newRow[2])] || 0;
            // 삭제 이전 스냅샷(prepurge)은 특보발표여부(warnFlags) 필드가 생기기 전 버전이라
            // 12개 필드뿐이다(현재 스키마는 13개) — 자리를 맞춰 빈 배열을 채워 넣는다.
            // 이 복원행들은 build_accident_warn_flags.js 재실행 전까지 특보 판정 대상에서
            // 빠진다(빈 배열=미계산, "특보 없음"과는 다름 — 필터 표시에 유의).
            newRow[12] = [];
            out.push(newRow.concat(extraFields(m)));
        });
        return { out, matched };
    }

    const { out: restored2016, matched: matched2016 } = restoreRows(hk2016, oldBucket, (m) => [m.shipUse, null, null, null]);
    console.log(`[2016 복원] ${matched2016}/${hk2016.length}건 매칭 → 복원`);

    const tribunal = readCsvAsRecords(path.join(RAW_DIR, 'TL_SHPACC_HS_NEW.csv'));
    const tribBucket = new Map();
    tribunal.forEach((row) => {
        const lat = dmsToDecimal(row['해양사고장소(위도)'], row['해양사고장소(위분)'], row['해양사고장소(위초)'], row['해양사고장소(위)']);
        const lon = dmsToDecimal(row['해양사고장소(경도)'], row['해양사고장소(경분)'], row['해양사고장소(경초)'], row['해양사고장소(경)']);
        const t = toMinutes(row['해양사고발생(년도)'], row['해양사고발생(월)'], row['해양사고발생(일)'], row['해양사고발생(시)'] || 0, row['해양사고발생(분)'] || 0);
        if (t == null || lat == null) return;
        const bucket = Math.floor(t / 5);
        if (!tribBucket.has(bucket)) tribBucket.set(bucket, []);
        const tonnageRaw = row['선박톤수'];
        const tonnage = tonnageRaw ? parseFloat(tonnageRaw) : null;
        tribBucket.get(bucket).push({
            t, lat, lon, type: row['해양사고종류1'], shipUse: row['선박용도(통계용)'],
            tonnage: Number.isFinite(tonnage) ? tonnage : null, season: row['계절'], caseNo: row['사건번호'],
            ymd: row['해양사고발생(년도)'] + row['해양사고발생(월)'].padStart(2, '0') + row['해양사고발생(일)'].padStart(2, '0'),
        });
    });

    const { out: restored2124, matched: matched2124 } = restoreRows(hk2124, tribBucket,
        (m) => [m.shipUse, m.tonnage, m.season, m.caseNo]);
    console.log(`[2021-2024 복원] ${matched2124}/${hk2124.length}건 매칭 → 복원`);

    // ============ 2) 2025 심판원 단독 ============
    const trib2025 = tribunal.filter((row) => row['해양사고발생(년도)'] === '2025');
    const rows2025 = [];
    let gangneungCount = 0;
    trib2025.forEach((row) => {
        const lat = dmsToDecimal(row['해양사고장소(위도)'], row['해양사고장소(위분)'], row['해양사고장소(위초)'], row['해양사고장소(위)']);
        const lon = dmsToDecimal(row['해양사고장소(경도)'], row['해양사고장소(경분)'], row['해양사고장소(경초)'], row['해양사고장소(경)']);
        if (lat == null || lon == null) return;
        const ymd = row['해양사고발생(년도)'] + row['해양사고발생(월)'].padStart(2, '0') + row['해양사고발생(일)'].padStart(2, '0');
        const h = row['해양사고발생(시)'] || '0', mi = row['해양사고발생(분)'] || '0';
        const hm = `${parseInt(h, 10)}:${String(parseInt(mi, 10)).padStart(2, '0')}`;
        const orgName = classifyOrg(lat, lon, ymd);
        if (orgName === '강릉해양경찰서') gangneungCount++;
        const orgCd = ORG_CODE_OF[orgName] || 0;
        const tonnageRaw = row['선박톤수'];
        const tonnage = tonnageRaw ? parseFloat(tonnageRaw) : null;
        rows2025.push([
            Math.round(lat * 100000) / 100000, Math.round(lon * 100000) / 100000, ymd, hm,
            null, null, null, null, orgCd, 0, 0, 0, [],
            row['선박용도(통계용)'], Number.isFinite(tonnage) ? tonnage : null, row['계절'], row['사건번호'],
        ]);
    });
    console.log(`[2025 단독] ${rows2025.length}건 추가(강릉 ${gangneungCount}건)`);

    // ============ 3) 최종 조립 ============
    const existingExtended = currentHk.rows.map((r) => r.concat([null, null, null, null]));
    const finalRows = existingExtended.concat(restored2016, restored2124, rows2025);

    fs.writeFileSync(path.join(CLIENT_DIR, 'accident_ships_hk.json'), JSON.stringify({ v: 1, rows: finalRows }));
    console.log(`[완료] 총 ${finalRows.length}건 저장 (기존 ${existingExtended.length} + 2016복원 ${restored2016.length} + 2021-24복원 ${restored2124.length} + 2025단독 ${rows2025.length})`);
}

main();
