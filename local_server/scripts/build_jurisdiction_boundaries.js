/**
 * ============================================================================
 * 파일명: scripts/build_jurisdiction_boundaries.js
 * 역할  : 관할해경서 경계 폴리곤(local_server/config/coastguard_jurisdiction_faces.json
 *         + coastguard_gangneung_zone.json)을 그대로 client/ 로 내보낸다 — 사고정보
 *         "관할서 불일치 검수" 레이어(사고정보 버튼 20회 연타)가 지도 위에 경계선을
 *         그려 보여주는 용도(2026-08-25, "제주 서귀포, 부산 울산 라인을 지도에
 *         그려줘"). config/ 는 서버가 클라이언트에 직접 서빙하지 않아, 다른 폴리곤
 *         레이어(access_control_zones.json 등)와 같은 방식으로 client/ 에 정적
 *         복사본을 둔다 — source of truth 는 여전히 config/ 두 파일.
 * [실행] node local_server/scripts/build_jurisdiction_boundaries.js
 * [출력] client/coastguard_jurisdiction_boundaries.json — [{owner, coords}, ...]
 *   (purity·n 등 내부용 필드는 뺀다 — 클라이언트는 선만 그리면 됨)
 * [연계] client/js/marine-life/safety/accident_info.js 의
 *   ensureJurisdictionReviewLayers() 가 fetch
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, '..', 'config');
const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');

function main() {
    const faces = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'coastguard_jurisdiction_faces.json'), 'utf8'));
    const gangneung = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'coastguard_gangneung_zone.json'), 'utf8'));

    const out = faces.map((f) => ({ owner: f.owner, coords: f.coords }));
    out.push({ owner: gangneung.name, coords: gangneung.coords });

    const outPath = path.join(CLIENT_DIR, 'coastguard_jurisdiction_boundaries.json');
    fs.writeFileSync(outPath, JSON.stringify(out));
    const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
    console.log(`[관할 경계] ${out.length}개 면 저장(${kb}KB)`);
}

main();
