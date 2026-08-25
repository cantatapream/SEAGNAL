/**
 * ============================================================================
 * 파일명: scripts/build_jurisdiction_mismatch_review.js
 * 역할  : audit_hk_jurisdiction_mismatch.js 와 같은 판정 로직(서로 다른 스크립트라
 *         각자 사본을 갖는 이 저장소 관례)으로 "확실한" 관할서 불일치 후보를 뽑아
 *         client/ 에 검수용 정적 JSON 으로 내보낸다 — 사고정보 "관할서 불일치 검수"
 *         레이어(사고정보 버튼 20회 연타)가 지도 위에서 사람이 직접 눈으로 보고
 *         맞는 관할서를 클릭해 고르는 용도(2026-08-25, "경찰서명을 클릭하면서
 *         검수하도록 하자"). 울진·속초는 폴리곤 수정으로 이미 해소돼(재감사 1.6%·
 *         0.0%) 남은 후보는 대부분 제주⇄서귀포·부산⇄울산 등 19개 서 사이 불일치.
 * ----------------------------------------------------------------------------
 * [출력 행의 idx] client/accident_ships_hk.json rows 배열의 인덱스를 그대로 담는다
 *   (apply_jurisdiction_review.js 가 검수 결과를 그 인덱스로 되찾아 orgCd 를 고침).
 *   이 스크립트를 다시 돌리거나 hk 에서 행을 추가/삭제하면 인덱스가 밀리므로,
 *   검수 도중엔 accident_ships_hk.json 을 건드리지 말 것(⚠경합위험 — 프로젝트
 *   CLAUDE.md 병렬 작업 안전 규칙과 같은 이유).
 * [실행] node local_server/scripts/build_jurisdiction_mismatch_review.js
 * [출력] client/accident_jurisdiction_mismatch.json —
 *   [[lat, lon, ymd, hm, typeCd, recorded, expected, distFromBoundaryKm, idx], ...]
 * [연계] client/js/marine-life/safety/accident_info.js 의
 *   ensureJurisdictionReviewLayers() 가 fetch
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');
const CONFIG_DIR = path.join(__dirname, '..', 'config');

// audit_hk_jurisdiction_mismatch.js 와 동일(주석 포함 원본 참고) — 관할서 코드→라벨.
const ORG_LABEL_OF = {
    1532418: '속초해양경찰서', 1532440: '동해해양경찰서', 1532466: '포항해양경찰서', 1532304: '울산해양경찰서',
    1532329: '부산해양경찰서', 1532357: '창원해양경찰서', 1532376: '통영해양경찰서', 1532170: '여수해양경찰서',
    1532199: '완도해양경찰서', 1532222: '목포해양경찰서', 1532255: '군산해양경찰서', 1532056: '보령해양경찰서',
    1532074: '태안해양경찰서', 1532098: '평택해양경찰서', 1532121: '인천해양경찰서', 1532508: '제주해양경찰서',
    1532530: '서귀포해양경찰서', 1532281: '부안해양경찰서', 1532609: '울진해양경찰서', 1532759: '사천해양경찰서',
    1532865: '강릉해양경찰서',
    1750163: '속초해양경찰서', 1750186: '동해해양경찰서', 1750213: '포항해양경찰서', 1750259: '울산해양경찰서',
    1750283: '부산해양경찰서', 1750311: '창원해양경찰서', 1750329: '통영해양경찰서', 1750374: '여수해양경찰서',
    1750403: '완도해양경찰서', 1750426: '목포해양경찰서', 1750461: '군산해양경찰서', 1750494: '보령해양경찰서',
    1750511: '태안해양경찰서', 1750533: '평택해양경찰서', 1750556: '인천해양경찰서', 1750608: '제주해양경찰서',
    1750612: '제주해양경찰서', 1750631: '서귀포해양경찰서', 1750632: '서귀포해양경찰서',
};

const ESTABLISHED_YMD = {
    평택해양경찰서: '20110401', 창원해양경찰서: '20121227', 보령해양경찰서: '20140401',
    부안해양경찰서: '20160421', 울진해양경찰서: '20171128', 강릉해양경찰서: '20250331',
};

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

const CONFIDENT_KM_DEG = 0.03; // ≈3.3km — audit_hk_jurisdiction_mismatch.js 와 동일 기준

function main() {
    const faces = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'coastguard_jurisdiction_faces.json'), 'utf8'));
    const gangneung = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'coastguard_gangneung_zone.json'), 'utf8'));
    const hkData = JSON.parse(fs.readFileSync(path.join(CLIENT_DIR, 'accident_ships_hk.json'), 'utf8'));

    function findExpected(lat, lon, ymd) {
        if (ymd >= gangneung.effective_from && pointInPolygon(lon, lat, gangneung.coords)) {
            return { owner: '강릉해양경찰서', coords: gangneung.coords, preEstablish: false };
        }
        for (const f of faces) {
            if (!pointInPolygon(lon, lat, f.coords)) continue;
            const est = ESTABLISHED_YMD[f.owner];
            if (est && ymd < est) return { owner: f.owner, coords: f.coords, preEstablish: true };
            return { owner: f.owner, coords: f.coords, preEstablish: false };
        }
        return null;
    }

    const out = [];
    hkData.rows.forEach((row, idx) => {
        const [lat, lon, ymd] = row;
        if (String(ymd).startsWith('2025')) return; // 심판원 단독 — 사용자 확정 제외
        const recordedCd = row[8];
        const recordedName = ORG_LABEL_OF[recordedCd];
        if (recordedName === '사천해양경찰서') return; // 사천 폴리곤 없음 — 비교 불가

        const hit = findExpected(lat, lon, ymd);
        if (hit == null || hit.preEstablish) return;
        if (hit.owner === recordedName) return;
        const distDeg = distToPolygonBoundary(lon, lat, hit.coords);
        if (distDeg < CONFIDENT_KM_DEG) return; // 경계 근처 — 폴리곤 오차와 구분 안 됨(V5-9와 같은 기준)

        out.push([
            Math.round(lat * 100000) / 100000, Math.round(lon * 100000) / 100000, row[2], row[3],
            row[5], recordedName || String(recordedCd), hit.owner,
            Math.round(distDeg * 111 * 10) / 10, idx,
        ]);
    });

    const outPath = path.join(CLIENT_DIR, 'accident_jurisdiction_mismatch.json');
    fs.writeFileSync(outPath, JSON.stringify({ v: 1, rows: out }));
    const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
    console.log(`[관할서 불일치 검수용] ${out.length}건 저장(${kb}KB)`);
}

main();
