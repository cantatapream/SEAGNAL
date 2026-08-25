/**
 * ============================================================================
 * 파일명: local_server/scripts/patch_new_accident_warn_flags.js
 * 역할  : build_tribunal_merge.js 가 심판원 통합(2026-08-25)으로 새로 추가한
 *         12,606건(2016 복원 1,268 + 2021~24 복원 6,498 + 2025 단독 3,840)의
 *         특보발표여부(warnFlags, row[12])를 계산해 채운다. 병합 당시엔 자리만
 *         맞추려고 빈 배열([])을 넣어뒀는데, build_accident_warn_flags.js 는
 *         모든 행에 무조건 push 하는 1회성 스크립트라 그대로 재실행하면
 *         스키마가 13→18로 다시 밀려 망가진다(이미 warnFlags 가 있는 기존
 *         23,421건까지 다시 덮어씀) — 그래서 새 행에만 좁혀 값을 채우는
 *         전용 스크립트를 따로 둔다.
 * [대상 식별] build_tribunal_merge.js 의 최종 조립이 `existingExtended.concat(
 *   restored2016, restored2124, rows2025)` 순서라, 기존 hk 23,421건이 항상
 *   배열 앞쪽에 그대로 남고 새 12,606건이 뒤에 이어 붙는다. 이 인덱스 경계
 *   (NEW_ROWS_START)로 "새 행"을 가른다 — 내용(warnFlags가 빈 배열인지)으로는
 *   구분 못 한다(기존 행도 실제로 특보가 없었으면 똑같이 빈 배열이라서).
 * [실행] node local_server/scripts/patch_new_accident_warn_flags.js
 *   (사전에 build_accident_warn_flags.js 안내대로
 *    `npm install --no-save @turf/turf` 필요 — 이미 설치돼 있으면 생략)
 * [연계] build_accident_warn_flags.js 의 buildIntervals/loadZoneFeatures/
 *        makeZoneFinders/makeFlagComputers 를 그대로 재사용(계산 로직 중복 방지)
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const { buildIntervals, loadZoneFeatures, makeZoneFinders, makeFlagComputers } =
    require('./build_accident_warn_flags.js');

const HK_JSON_PATH = path.join(__dirname, '..', '..', 'client', 'accident_ships_hk.json');
const NEW_ROWS_START = 23421; // build_tribunal_merge.js 실행 당시 기존 hk 행 수

function main() {
    console.log('[1/3] 통보문 CSV 파싱 -> 구간표 생성...');
    const intervals = buildIntervals();

    console.log('[2/3] 구역 지오메트리 로드...');
    const { seaFeatures, landFeatures } = loadZoneFeatures();
    const { findSeaZone, findNearLand } = makeZoneFinders(seaFeatures, landFeatures);
    const { computeHkFlags } = makeFlagComputers(intervals, findSeaZone, findNearLand);

    console.log('[3/3] 새 행 warnFlags 계산...');
    const hkData = JSON.parse(fs.readFileSync(HK_JSON_PATH, 'utf8'));
    if (hkData.rows.length <= NEW_ROWS_START) {
        console.error(`[ERROR] 전체 행 수(${hkData.rows.length})가 경계(${NEW_ROWS_START})보다 작거나 같음 — 이미 처리됐거나 파일이 예상과 다름`);
        process.exit(1);
    }

    const stats = {};
    let done = 0;
    for (let i = NEW_ROWS_START; i < hkData.rows.length; i++) {
        const row = hkData.rows[i];
        const flags = computeHkFlags(row);
        row[12] = flags;
        const k = flags.join('+') || '없음';
        stats[k] = (stats[k] || 0) + 1;
        done++;
    }
    console.log(`  새 행 ${done}건 완료 —`, stats);

    fs.writeFileSync(HK_JSON_PATH, JSON.stringify(hkData));
    console.log('완료:', HK_JSON_PATH);
}

if (require.main === module) main();
