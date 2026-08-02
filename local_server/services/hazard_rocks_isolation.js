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
 * [해안선-BADA 정합 오차 흡수 — 조위 검사를 우회하지 않는다] 해안선(KHOA 실측)과
 *   BADA 수심 격자(별도 실측)는 독립 조사라 경계에서 셀이 정확히 안 맞을 수 있다.
 *   [초기 버그 — 수정됨] 처음엔 해안선 주변 1칸을 "무조건 항상 마른 땅"으로
 *   미리 채워 넣었는데, 이건 틀렸다 — 해안선(약최고고조면) 바로 바깥(바다 쪽)은
 *   "밀물 때만 잠기는 조간대"이지 "항상 마른 땅"이 아니다. 그 구간까지 조위 검사
 *   없이 항상 다닐 수 있다고 치면, 실제로는 밀물 때 끊길 수 있는 해안 인접 바위가
 *   전부 "항상 안전"으로 뭉개진다 — 실제 로컬 검증에서 노출암의 76%가 조위와
 *   무관하게 "항상 연결"로 나와 이 버그를 발견했다(사용자 지적으로 재검토).
 *   [수정 후] 무조건 마른 땅은 해안선 셀 "그 자체"뿐(정의상 맞음). 해안선 인근
 *   NEIGHBOR_BUFFER_CELLS 칸은 오직 "해안선에서 후보 격자로 최초 진입할 때 그
 *   칸을 인접한 것으로 봐줄지"에만 쓰이고, 그 칸이 실제로 그 시각 드러났는지
 *   (isExposedFn)는 예외 없이 그대로 검사한다 — 즉 버퍼는 연결 판정을 건너뛰게
 *   하지 않고, "얼마나 멀리 떨어진 후보 칸까지 해안선과 인접했다고 볼지"만 정한다.
 *   버퍼 크기는 실측(로컬 데이터, 서해·남해 해안선 3,904점 샘플)으로 물빠짐 후보
 *   셀까지 최근접 거리 중앙값 138m 확인 → NEIGHBOR_BUFFER_CELLS=1(150m)로 근사.
 *   꼬리(90%=744m, 99%=1.7km)는 오차가 아니라 그 해안 구간에 애초에 인접 갯벌
 *   (얕은 물)이 없다는 뜻 — 그런 곳의 노출암은 조위와 무관하게 "항상 도보 접근
 *   불가(보트 필요)"로 나오는 게 맞는 동작이다.
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

/** 셀 키를 중심으로 반경 radius(칸, 체비셰프 거리) 안의 모든 셀 키(자기 자신 제외). */
function cellsWithinRadius(key, radius) {
    const { gx, gy } = parseCellKey(key);
    const out = [];
    for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
            if (dx === 0 && dy === 0) continue;
            out.push((gx + dx) + '_' + (gy + dy));
        }
    }
    return out;
}

/**
 * 플러드필로 "육지에서 그 시각에 도달 가능한" 셀 집합을 구한다.
 *
 * [무조건 마른 땅] coastlineSeedKeys 그 자체뿐(약최고고조면 정의상 항상 드러남).
 * [해안선→후보격자 최초 진입] 해안선 셀 기준 NEIGHBOR_BUFFER_CELLS 칸 안의 후보
 *   셀은 "인접했다"고 봐주지만(정합 오차 흡수), 그 시각에 실제로 드러났는지
 *   (isExposedFn)는 그대로 검사한다 — 버퍼가 조위 검사를 건너뛰게 하지 않는다.
 * [이후 확산] 후보 셀 사이는 1칸(8방향) 인접만 인정 — 후보 격자 자체는 촘촘
 *   (CELL_DEG 간격)해 별도 버퍼가 필요 없다.
 *
 * @param {Iterable<string>} coastlineSeedKeys  해안선 시드 셀 키(항상 마른 땅)
 * @param {(key:string)=>boolean} isExposedFn  그 시각에 해당 셀이 드러났는지
 * @param {Iterable<string>} candidateKeys  물빠짐 격자의 드러남가능 후보 셀 키 전체
 *   (이 집합 밖=깊은 바다·미대상 해역은 애초에 플러드필이 통과할 수 없다)
 * @returns {Set<string>} 도달 가능(연결) 셀 키 집합 — 해안선 시드 포함
 */
function floodFillReachable(coastlineSeedKeys, isExposedFn, candidateKeys) {
    const candidateSet = candidateKeys instanceof Set ? candidateKeys : new Set(candidateKeys);
    const coastSet = coastlineSeedKeys instanceof Set ? coastlineSeedKeys : new Set(coastlineSeedKeys);
    const reachable = new Set(coastSet);
    const queue = [];

    // 해안선 → 후보격자 최초 진입 (버퍼 반경, 조위 검사 유지)
    for (const seed of coastSet) {
        for (const n of cellsWithinRadius(seed, NEIGHBOR_BUFFER_CELLS)) {
            if (reachable.has(n)) continue;
            if (!candidateSet.has(n)) continue;
            if (!isExposedFn(n)) continue;
            reachable.add(n);
            queue.push(n);
        }
    }

    // 이후 확산: 후보 셀끼리는 1칸 인접만, 조위 검사 계속 유지
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
 * @param {number} [searchRadiusCells=1]  노출암 근처 몇 칸까지 "인근 셀"로 볼지
 * @returns {Map<string|number, boolean>} rock.id -> isolated(true=고립)
 */
function classifyRocks(rocks, reachableKeys, searchRadiusCells) {
    const R = searchRadiusCells == null ? 1 : searchRadiusCells;
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
    cellKeyOf, parseCellKey, neighborsOf, cellsWithinRadius,
    floodFillReachable, classifyRocks
};
