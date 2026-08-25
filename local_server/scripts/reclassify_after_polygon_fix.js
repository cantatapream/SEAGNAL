/**
 * ============================================================================
 * 파일명: scripts/reclassify_after_polygon_fix.js
 * 역할  : coastguard_jurisdiction_faces.json 재구성(울진·속초 폴리곤 수정,
 *         2026-08-25) 이후 두 가지를 반영하는 1회성 스크립트.
 *   ① 그 폴리곤으로 관할서(orgCd)를 "추정"해서 채웠던 행만 재분류
 *      (build_tribunal_merge.js classifyOrg() 가 쓰인 행 — 2016년 복원행
 *      전체(원본 orgCd 자체가 없어 전량 추정) + 2025년 심판원 단독행 전체).
 *      2021~2024 복원행과 그 외 원본 hk 행은 orgCd 가 원본에 있던 값이라
 *      대상 아님(건드리면 안 됨 — 외과수술식 변경).
 *   ② audit_hk_jurisdiction_mismatch.js 로 확인한 "속초 기록, 확실한 불일치"
 *      59건 삭제(사용자 확정 2026-08-25 — "남은 59건은 삭제하고"). 전부 폴리곤
 *      경계에서 12km 이상(대부분 원양 수십~90km) 떨어진 확실한 오분류이고,
 *      2건 제외 전부 좌표가 속초 관할과 무관한 원거리(인천 앞바다·포항 앞바다
 *      등)라 폴리곤을 더 넓혀서 흡수할 수 있는 성격이 아님.
 * ----------------------------------------------------------------------------
 * [classifyOrg 재구현] build_tribunal_merge.js 의 최신 버전(날짜 게이트 포함)과
 *   동일 로직 — 서로 다른 스크립트라 각자 사본을 갖는 이 저장소 관례를 따름.
 * [실행] node local_server/scripts/reclassify_after_polygon_fix.js
 * [입력] client/accident_ships_hk.json, local_server/config/coastguard_jurisdiction_faces.json,
 *   local_server/config/coastguard_gangneung_zone.json,
 *   local_server/scripts/_accident_raw/hk_jurisdiction_mismatch_candidates.json
 *   (audit_hk_jurisdiction_mismatch.js 최신 실행 결과 — git 추적 안 함, 이 스크립트
 *   실행 전에 먼저 audit 를 재실행해 최신 상태여야 함)
 * [출력] client/accident_ships_hk.json 갱신(재분류 반영 + 59건 삭제)
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');
const CONFIG_DIR = path.join(__dirname, '..', 'config');
const RAW_DIR = path.join(__dirname, '_accident_raw');

const ORG_CODE_OF = {
    속초해양경찰서: 1532418, 동해해양경찰서: 1532440, 포항해양경찰서: 1532466, 울산해양경찰서: 1532304,
    부산해양경찰서: 1532329, 창원해양경찰서: 1532357, 통영해양경찰서: 1532376, 여수해양경찰서: 1532170,
    완도해양경찰서: 1532199, 목포해양경찰서: 1532222, 군산해양경찰서: 1532255, 보령해양경찰서: 1532056,
    태안해양경찰서: 1532074, 평택해양경찰서: 1532098, 인천해양경찰서: 1532121, 제주해양경찰서: 1532508,
    서귀포해양경찰서: 1532530, 부안해양경찰서: 1532281, 울진해양경찰서: 1532609, 사천해양경찰서: 1532759,
    강릉해양경찰서: 1532865,
};

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

const ESTABLISHED_YMD = {
    평택해양경찰서: '20110401', 창원해양경찰서: '20121227', 보령해양경찰서: '20140401',
    부안해양경찰서: '20160421', 울진해양경찰서: '20171128', 사천해양경찰서: '20220331',
};

function main() {
    const faces = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'coastguard_jurisdiction_faces.json'), 'utf8'));
    const gangneung = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'coastguard_gangneung_zone.json'), 'utf8'));
    const hkData = JSON.parse(fs.readFileSync(path.join(CLIENT_DIR, 'accident_ships_hk.json'), 'utf8'));

    const trainPts = [];
    hkData.rows.forEach((r) => {
        const name = Object.keys(ORG_CODE_OF).find((k) => ORG_CODE_OF[k] === r[8]);
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

    // ── ① 재분류 대상: 2016년 복원행 전체 + 2025년 심판원 단독행 전체 ──
    let reclassified = 0, changed = 0;
    const changeLog = {};
    hkData.rows.forEach((r) => {
        const ymd = String(r[2]);
        const is2016 = ymd.startsWith('2016');
        const is2025Tribunal = ymd.startsWith('2025') && r[16];
        if (!is2016 && !is2025Tribunal) return;
        reclassified++;
        const newOwner = classifyOrg(r[0], r[1], ymd);
        const newCd = ORG_CODE_OF[newOwner] || 0;
        if (newCd !== r[8]) {
            changed++;
            const k = `${r[8]}→${newCd}`;
            changeLog[k] = (changeLog[k] || 0) + 1;
            r[8] = newCd;
        }
    });
    console.log(`[재분류] 대상 ${reclassified}건 중 ${changed}건 orgCd 변경`);
    if (changed) console.log('  변경 내역(orgCd 코드 기준):', changeLog);

    // ── ② 확실한 속초 오분류 59건 삭제 ──
    const candPath = path.join(RAW_DIR, 'hk_jurisdiction_mismatch_candidates.json');
    const candidates = JSON.parse(fs.readFileSync(candPath, 'utf8'));
    const delIdx = new Set(
        candidates.filter((c) => c.confident && c.recorded === '속초해양경찰서').map((c) => c.idx)
    );
    console.log(`[삭제] 속초 확실한 오분류 ${delIdx.size}건`);
    const before = hkData.rows.length;
    hkData.rows = hkData.rows.filter((r, i) => !delIdx.has(i));
    console.log(`[삭제] ${before} → ${hkData.rows.length}건 (${before - hkData.rows.length}건 삭제)`);

    fs.writeFileSync(path.join(CLIENT_DIR, 'accident_ships_hk.json'), JSON.stringify(hkData));
    console.log('[완료] client/accident_ships_hk.json 갱신');
}

main();
