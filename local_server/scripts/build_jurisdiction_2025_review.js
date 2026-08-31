/**
 * ============================================================================
 * 파일명: scripts/build_jurisdiction_2025_review.js
 * 역할  : 2025년 심판원 단독 행(3,840건)은 애초에 해경 원본 기록이 없어 관할서
 *         값 자체가 폴리곤 추정치(reclassify_after_polygon_fix.js classifyOrg())다
 *         — 그래서 "기록 vs 판정" 비교가 불가능하다(사용자 확정 2026-08-26). 대신
 *         그 추정 자체가 "얼마나 자신 있게 나온 값인지"로 등급을 매겨, 자신 없는
 *         (저신뢰) 건만 검수용으로 내보낸다. 신뢰 면 안에 명확히 찍혀 경계에서
 *         충분히 먼(고신뢰) 건은 사람이 볼 필요 없이 그대로 둔다.
 * ----------------------------------------------------------------------------
 * [등급 3단계 — classifyOrg 내부 판정 경로 그대로 노출]
 *   direct: 신뢰 면(순도 60% 이상) 안에 점이 직접 찍힘. 그중에서도 경계에서
 *     3.3km 미만이면(폴리곤 자체 정확도가 91.9%라 경계 근처는 오차와 구분 안 됨,
 *     audit_hk_jurisdiction_mismatch.js 와 같은 기준) 저신뢰로 같이 내보낸다.
 *   boundary: 어떤 신뢰 면에도 안 찍혔지만 경계에서 0.05도(≈5.5km) 이내라 가장
 *     가까운 면으로 보정된 것 — 사람 확인 필요.
 *   knn: 그마저도 없어 최근접이웃 5개 다수결로 정한 것 — 가장 불확실, 사람 확인 필요.
 * [날짜 게이트] classifyOrg 는 강릉(2025-03-31 개서) 외 신설서(평택·창원·보령·부안·
 *   울진·사천) 개서일 게이트를 그대로 포함 — 사고 발생 시점 기준으로 그 시점에 실제
 *   있던 서로 판정한다(2026-08-26 사용자 강조: "개소 시점을 고려해야"). 재구현이
 *   아니라 reclassify_after_polygon_fix.js 의 classifyOrg 를 그대로 복사해 등급만
 *   추가로 얹었다(판정 자체가 달라지면 안 됨).
 * [검수 범위 좁힘(2026-08-29 사용자 확정)] "2025 단독은 폴리곤 판정대로 하되,
 *   인천·속초·동해·강릉만 따로 검증" — orgCd 는 이미 classifyOrg 값이 그대로 최종
 *   값이다(reclassify_after_polygon_fix.js 가 write, 이 스크립트는 등급만 매김).
 *   그래서 저신뢰 전체(2,211건)를 다 검수 대상으로 내보내던 걸 그만두고, 그중
 *   판정된 관할서(owner)가 REVIEW_ONLY_ORGS 4곳인 것만 남긴다.
 * [실행] node local_server/scripts/build_jurisdiction_2025_review.js
 * [출력] client/accident_jurisdiction_2025_review.json —
 *   [[lat, lon, ymd, hm, typeCd, currentOrg, tier, distFromBoundaryKm, idx], ...]
 *   (direct 등급만 distFromBoundaryKm 이 의미 있음, boundary/knn 은 -1)
 * [연계] client/js/marine-life/safety/accident_info.js 의 관할서 검수 워크스루
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');
const CONFIG_DIR = path.join(__dirname, '..', 'config');

const ORG_CODE_OF = {
    속초해양경찰서: 1532418, 동해해양경찰서: 1532440, 포항해양경찰서: 1532466, 울산해양경찰서: 1532304,
    부산해양경찰서: 1532329, 창원해양경찰서: 1532357, 통영해양경찰서: 1532376, 여수해양경찰서: 1532170,
    완도해양경찰서: 1532199, 목포해양경찰서: 1532222, 군산해양경찰서: 1532255, 보령해양경찰서: 1532056,
    태안해양경찰서: 1532074, 평택해양경찰서: 1532098, 인천해양경찰서: 1532121, 제주해양경찰서: 1532508,
    서귀포해양경찰서: 1532530, 부안해양경찰서: 1532281, 울진해양경찰서: 1532609, 사천해양경찰서: 1532759,
    강릉해양경찰서: 1532865,
};
const ORG_LABEL_OF = Object.fromEntries(Object.entries(ORG_CODE_OF).map(([k, v]) => [v, k]));

function pointInPolygon(lon, lat, coords) {
    let inside = false;
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
        const xi = coords[i][0], yi = coords[i][1], xj = coords[j][0], yj = coords[j][1];
        const intersect = ((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
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
const CONFIDENT_KM_DEG = 0.03; // ≈3.3km — 나머지 검수 스크립트들과 동일 기준
const REVIEW_ONLY_ORGS = new Set(['인천해양경찰서', '속초해양경찰서', '동해해양경찰서', '강릉해양경찰서']);

function main() {
    const faces = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'coastguard_jurisdiction_faces.json'), 'utf8'));
    const gangneung = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'coastguard_gangneung_zone.json'), 'utf8'));
    const hkData = JSON.parse(fs.readFileSync(path.join(CLIENT_DIR, 'accident_ships_hk.json'), 'utf8'));

    const trainPts = [];
    hkData.rows.forEach((r) => {
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

    /** reclassify_after_polygon_fix.js 의 classifyOrg 와 판정 로직은 완전히 같되,
     * 최종 관할서 이름뿐 아니라 "어느 단계에서 정해졌는지"(tier)·거리도 같이 돌려준다. */
    function classifyOrgWithTier(lat, lon, ymd) {
        if (ymd >= gangneung.effective_from && pointInPolygon(lon, lat, gangneung.coords)) {
            return { owner: '강릉해양경찰서', tier: 'direct', distKm: -1 };
        }
        for (const f of faces) {
            if (!pointInPolygon(lon, lat, f.coords)) continue;
            const est = ESTABLISHED_YMD[f.owner];
            if (est && ymd < est) continue;
            const distDeg = distToPolygonBoundary(lon, lat, f.coords);
            return { owner: f.owner, tier: 'direct', distKm: Math.round(distDeg * 111 * 10) / 10 };
        }
        let best = null;
        for (const f of faces) {
            const est = ESTABLISHED_YMD[f.owner];
            if (est && ymd < est) continue;
            const d = distToPolygonBoundary(lon, lat, f.coords);
            if (d < 0.05 && (!best || d < best.d)) best = { d, owner: f.owner };
        }
        if (best) return { owner: best.owner, tier: 'boundary', distKm: -1 };
        return { owner: knn5(lat, lon), tier: 'knn', distKm: -1 };
    }

    const out = [];
    let total = 0;
    hkData.rows.forEach((row, idx) => {
        const ymd = String(row[2]);
        if (!(ymd.startsWith('2025') && row[16])) return; // 2025 심판원 단독행만
        total++;
        const { owner, tier, distKm } = classifyOrgWithTier(row[0], row[1], ymd);
        const lowConfidence = tier !== 'direct' || (distKm >= 0 && distKm < CONFIDENT_KM_DEG * 111);
        if (!lowConfidence) return;
        if (!REVIEW_ONLY_ORGS.has(owner)) return;
        out.push([row[0], row[1], row[2], row[3], row[5], owner, tier, distKm, idx]);
    });

    const outPath = path.join(CLIENT_DIR, 'accident_jurisdiction_2025_review.json');
    fs.writeFileSync(outPath, JSON.stringify({ v: 1, rows: out }));
    const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
    console.log(`[2025 단독 저신뢰 검수용] 전체 ${total}건 중 ${out.length}건 저장(${kb}KB)`);
}

main();
