/**
 * ============================================================================
 * 파일명: local_server/scripts/apply_geo_sanity_deletions.js
 * 역할  : audit_accident_geo_sanity.js 가 찾은 두 후보(자기 관할서 폴리곤에서
 *         20해리 이상 이탈 · 해안선에서 10km 이상 내륙)를 실제로 원본에서
 *         삭제한다 — 사용자 확정 2026-08-31: "모두 삭제하자"(감사 결과 보고
 *         직후 지시, 두 후보 전부).
 * ----------------------------------------------------------------------------
 * [입력] local_server/scripts/_accident_raw/geo_sanity_candidates.json
 *   (audit_accident_geo_sanity.js 산출물, idx 는 그 실행 시점의 hk/person
 *   rows 배열 인덱스 — 그 사이 두 파일을 건드리지 않았으므로 그대로 유효)
 * [삭제 대상] hk: farCandidates ∪ inlandCandidates(source=hk) idx 합집합
 *            person: inlandCandidates(source=person) idx (person은 검사1 제외 —
 *            "인명사고는 관할이 없기때문에" 사용자 확정)
 * [실행] node local_server/scripts/apply_geo_sanity_deletions.js
 * [출력] client/accident_ships_hk.json · client/accident_persons.json 갱신(행 삭제)
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');
const CAND_PATH = path.join(__dirname, '_accident_raw', 'geo_sanity_candidates.json');

function main() {
    const cand = JSON.parse(fs.readFileSync(CAND_PATH, 'utf8'));
    const hkDeleteIdx = new Set();
    cand.farCandidates.forEach((c) => { if (c.source === 'hk') hkDeleteIdx.add(c.idx); });
    const personDeleteIdx = new Set();
    cand.inlandCandidates.forEach((c) => {
        if (c.source === 'hk') hkDeleteIdx.add(c.idx);
        else if (c.source === 'person') personDeleteIdx.add(c.idx);
    });

    const hkPath = path.join(CLIENT_DIR, 'accident_ships_hk.json');
    const personPath = path.join(CLIENT_DIR, 'accident_persons.json');
    const hkData = JSON.parse(fs.readFileSync(hkPath, 'utf8'));
    const personData = JSON.parse(fs.readFileSync(personPath, 'utf8'));

    const hkBefore = hkData.rows.length;
    hkData.rows = hkData.rows.filter((r, i) => !hkDeleteIdx.has(i));
    const personBefore = personData.rows.length;
    personData.rows = personData.rows.filter((r, i) => !personDeleteIdx.has(i));

    fs.writeFileSync(hkPath, JSON.stringify(hkData));
    fs.writeFileSync(personPath, JSON.stringify(personData));

    console.log('hk:', hkBefore, '→', hkData.rows.length, '(', hkDeleteIdx.size, '건 삭제)');
    console.log('person:', personBefore, '→', personData.rows.length, '(', personDeleteIdx.size, '건 삭제)');
}

main();
