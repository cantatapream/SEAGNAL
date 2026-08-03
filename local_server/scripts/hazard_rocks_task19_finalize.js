/**
 * ============================================================================
 * 파일명: scripts/hazard_rocks_task19_finalize.js
 * 역할: Task #19 산출물(isolation_sweep_full.json)과 300m 근접 1,000개 OCR
 *       결과(nearshore_isolation_review_1000.json)를 union해 최종 고립판정
 *       후보군을 만든다. HAZARD_ROCKS_HANDOFF_BRIEF.md "다음 단계 1" 완결.
 *
 * [union 원칙]
 *   - 근접-해안(300m 이내, nearshore review 대상)은 물리 스윕이 신뢰 불가
 *     (해안선 인접 버퍼 때문에 항상 "연결"로 나옴 — 사람이 alwaysIsolatedFlag
 *     로 남긴 10건 전부가 스윕에서 always_connected로 나온 것으로 실측 확인,
 *     HAZARD_ROCKS_HANDOFF.md §6.3 BADA 근접-해안 신뢰도 문제와 동일 원인).
 *     → 이 구간은 사람 판단(alwaysIsolatedFlag)을 그대로 채택.
 *   - 근접-해안이 아닌 나머지는 물리 스윕 분류(always_isolated/transition)를
 *     그대로 신뢰(코스트라인에서 충분히 떨어져 격자 버퍼 편향의 영향이 작음).
 *
 * [출력 카테고리]
 *   - transition: 물리 스윕이 확인한 조석에 따른 연결↔고립 전환(최우선 후보)
 *   - always_isolated_far: 근접-해안 아닌 곳에서 스윕이 확인한 상시 고립
 *   - always_isolated_nearshore_human: 근접-해안 중 사람이 "항상 고립"로 판단(alwaysIsolatedFlag)
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'hazard_rocks');
const sweep = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'isolation_sweep_full.json'), 'utf8'));
const nearshore = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'nearshore_isolation_review_1000.json'), 'utf8'));
const nearshoreById = new Map(nearshore.map(r => [r.id, r]));

const transition = sweep.rocks.filter(r => r.category === 'transition');
const alwaysIsolatedFar = sweep.rocks.filter(r => r.category === 'always_isolated' && !r.inNearshoreReview1000);
const alwaysIsolatedNearshoreHuman = sweep.rocks
    .filter(r => r.inNearshoreReview1000)
    .map(r => ({ ...r, review: nearshoreById.get(r.id) }))
    .filter(r => r.review && r.review.alwaysIsolatedFlag);

const out = {
    generated_at: new Date().toISOString(),
    source: {
        sweep: 'isolation_sweep_full.json',
        nearshore_review: 'nearshore_isolation_review_1000.json',
    },
    summary: {
        transition: transition.length,
        always_isolated_far: alwaysIsolatedFar.length,
        always_isolated_nearshore_human: alwaysIsolatedNearshoreHuman.length,
        total_priority_candidates: transition.length + alwaysIsolatedFar.length + alwaysIsolatedNearshoreHuman.length,
    },
    transition,
    always_isolated_far: alwaysIsolatedFar,
    always_isolated_nearshore_human: alwaysIsolatedNearshoreHuman.map(r => ({
        id: r.id, lon: r.lon, lat: r.lat,
        humanMemo: r.review.humanMemo, region: r.review.region,
    })),
};

const outPath = path.join(DATA_DIR, 'isolation_candidates_final.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log('저장:', outPath);
console.log('summary:', out.summary);
