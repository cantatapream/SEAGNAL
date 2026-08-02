/**
 * ============================================================================
 * 파일명: services/hazard_rocks_isolation.js
 * 역할: 노출암 고립판정 — 해안선 시드 플러드필 (순수 알고리즘)
 * ============================================================================
 *
 * [핵심 아이디어] 노출암 자체가 잠기는 게 아니라, 해안선까지 이어지는 갯벌
 *   길이 밀물에 잠겨 "끊기는" 상황을 판정한다. 해안선(coastline_cells.json,
 *   약최고고조면 기준 — 항상 마른 땅)을 시작점으로, 그 시각에 물빠짐 격자에서
 *   "드러난"(exposed) 셀만 타고 퍼져나가는 플러드필을 1회 수행해 "육지에서
 *   걸어서 도달 가능한 셀 집합"을 구한다. 노출암 주변에 이 집합에 속한 셀이
 *   하나도 없으면 그 노출암은 그 시각에 고립된 것으로 본다.
 *
 * [셀당 1회] 플러드필은 전체 격자에 대해 시각마다 1번만 계산하면 되고, 노출암
 *   개수와 무관하다(암초별로 반복 계산하지 않음).
 *
 * [해안선-BADA 정합 오차 흡수] 해안선(KHOA 실측)과 BADA 수심 격자(별도 실측)는
 *   독립 조사라 경계에서 셀이 정확히 안 맞을 수 있다 — 해안선 시드 주변
 *   NEIGHBOR_BUFFER_CELLS 칸도 초기 시드로 같이 포함해 흡수한다.
 *
 * [데이터 소스 비의존] 이 모듈은 "그 시각에 이 셀이 드러났는가"를 판단하는
 *   isExposedFn(cellKey) 콜백을 주입받는다 — tide_field 의 실시각 조위 계산과
 *   결합하는 방법(운영 연동)은 이 모듈의 관심사가 아니다. 순수 그래프 탐색만
 *   담당해 실데이터 없이도(합성 exposure 로) 단위 검증할 수 있게 분리했다.
 *
 * [연계]
 *   - scripts/build_coastline_cells.js → coastline_cells.json (해안선 시드 산출)
 *   - services/tide_field_common.js → CELL_DEG (물빠짐과 동일 격자 해상도 공유)
 *   - (예정) routes/tide_field.js 의 실시각 노출 판정과 연동 — 아직 미연동
 * ============================================================================
 */
'use strict';

const TFC = require('./tide_field_common');
const CELL_DEG = TFC.TIDE_FIELD_CONFIG.CELL_DEG;

// 해안선 시드 주변 몇 칸까지 "항상 마른 땅" 취급할지(정합 오차 흡수).
const NEIGHBOR_BUFFER_CELLS = 1;

function cellKeyOf(lon, lat) {
    const gx = Math.round(lon / CELL_DEG), gy = Math.round(lat / CELL_DEG);
    return gx + '_' + gy;
}

function parseCellKey(key) {
    const [gx, gy] = key.split('_').map(Number);
    return { gx, gy };
}

/** 셀 키의 8방향 인접 셀 키 목록. */
function neighborsOf(key) {
    const { gx, gy } = parseCellKey(key);
    const out = [];
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            out.push((gx + dx) + '_' + (gy + dy));
        }
    }
    return out;
}

/**
 * 해안선 시드에 NEIGHBOR_BUFFER_CELLS 만큼 인접 셀을 더해 정합 오차를 흡수한다.
 * @param {Iterable<string>} coastlineSeedKeys
 * @returns {Set<string>} 버퍼가 포함된 시드 집합
 */
function bufferedSeeds(coastlineSeedKeys) {
    let frontier = new Set(coastlineSeedKeys);
    const seeds = new Set(frontier);
    for (let i = 0; i < NEIGHBOR_BUFFER_CELLS; i++) {
        const next = new Set();
        for (const key of frontier) {
            for (const n of neighborsOf(key)) {
                if (!seeds.has(n)) { seeds.add(n); next.add(n); }
            }
        }
        frontier = next;
    }
    return seeds;
}

/**
 * 플러드필로 "육지에서 그 시각에 도달 가능한" 셀 집합을 구한다.
 * @param {Iterable<string>} coastlineSeedKeys  해안선 시드 셀 키(항상 마른 땅)
 * @param {(key:string)=>boolean} isExposedFn  그 시각에 해당 셀이 드러났는지
 * @param {Iterable<string>} candidateKeys  물빠짐 격자의 드러남가능 후보 셀 키 전체
 *   (이 집합 밖=깊은 바다·미대상 해역은 애초에 플러드필이 통과할 수 없다)
 * @returns {Set<string>} 도달 가능(연결) 셀 키 집합 — 해안선 시드(+버퍼) 포함
 */
function floodFillReachable(coastlineSeedKeys, isExposedFn, candidateKeys) {
    const candidateSet = candidateKeys instanceof Set ? candidateKeys : new Set(candidateKeys);
    const reachable = bufferedSeeds(coastlineSeedKeys);
    const queue = Array.from(reachable);
    while (queue.length) {
        const cur = queue.pop();
        for (const n of neighborsOf(cur)) {
            if (reachable.has(n)) continue;
            if (!candidateSet.has(n)) continue;   // 후보 격자 밖(깊은 바다 등)은 통과 불가
            if (!isExposedFn(n)) continue;         // 그 시각에 드러나지 않으면 통과 불가
            reachable.add(n);
            queue.push(n);
        }
    }
    return reachable;
}

/**
 * 노출암별 고립 여부 판정 — 각 노출암 주변 searchRadiusCells 칸 안에 도달
 * 가능(reachable) 셀이 하나라도 있으면 연결, 없으면 고립.
 * @param {Array<{id, lon, lat}>} rocks  노출암 좌표 목록
 * @param {Set<string>} reachableKeys  floodFillReachable() 결과
 * @param {number} [searchRadiusCells=2]  노출암 근처 몇 칸까지 "인근 셀"로 볼지
 * @returns {Map<string|number, boolean>} rock.id -> isolated(true=고립)
 */
function classifyRocks(rocks, reachableKeys, searchRadiusCells) {
    const R = searchRadiusCells == null ? 2 : searchRadiusCells;
    const result = new Map();
    for (const rock of rocks) {
        const gx = Math.round(rock.lon / CELL_DEG), gy = Math.round(rock.lat / CELL_DEG);
        let connected = false;
        for (let dx = -R; dx <= R && !connected; dx++) {
            for (let dy = -R; dy <= R && !connected; dy++) {
                if (reachableKeys.has((gx + dx) + '_' + (gy + dy))) connected = true;
            }
        }
        result.set(rock.id, !connected);
    }
    return result;
}

module.exports = {
    CELL_DEG, NEIGHBOR_BUFFER_CELLS,
    cellKeyOf, parseCellKey, neighborsOf, bufferedSeeds,
    floodFillReachable, classifyRocks
};
