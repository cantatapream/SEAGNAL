/**
 * ============================================================================
 * 파일명: services/hazard_rocks_tide_common.js
 * 역할: "간출암 잠김경고" 제주 앵커 곡선 수집의 공용 경로·설정
 * ============================================================================
 *
 * [무엇을 위한 모듈인가]
 *   물빠짐(tide_field) 은 서해·남해만 다루고 제주·동해를 대상 해역에서 제외한다
 *   (BADA 갯벌 셀 기반 설계라 제주와 무관). 간출암 잠김경고는 서해·남해는 물빠짐
 *   앵커를 그대로 재사용하지만, 제주는 커버리지가 없어 간출암 실제 위치 기준으로
 *   별도 앵커·곡선을 이 모듈이 정의하는 경로에 수집한다(동해는 TideBED 미제공
 *   해역이라 대상에서 아예 제외 — client/tide_data 정적 조석표를 프론트에서 재사용).
 *
 * [연계]
 *   - scripts/build_hazard_rock_anchors.js → 이 경로에 anchors.json 생성
 *   - services/hazard_rocks_tide_collector.js → 이 경로에 곡선 저장
 *   - services/tide_field_common.js → JEJU_BBOX, haversineKm 재사용
 * ============================================================================
 */

'use strict';

const path = require('path');
const { DATA_DIR } = require('../config/server_config');

const HAZARD_ROCKS_TIDE_DIR = path.join(DATA_DIR, 'hazard_rocks');
const HR_ANCHORS_PATH = path.join(HAZARD_ROCKS_TIDE_DIR, 'anchors.json');
const HR_CURVES_DIR = path.join(HAZARD_ROCKS_TIDE_DIR, 'curves');

// 물빠짐과 동일한 버킷 크기(~10km) — 앵커 밀도를 동일한 기준으로 맞춘다.
const ANCHOR_BUCKET_DEG = 0.1;
// 수집 윈도우(오늘~+N-1일, KST) — 물빠짐과 동일(3일, 당일+익일 조석 판단에 충분).
const WINDOW_DAYS = 3;

module.exports = {
    HAZARD_ROCKS_TIDE_DIR, HR_ANCHORS_PATH, HR_CURVES_DIR,
    ANCHOR_BUCKET_DEG, WINDOW_DAYS
};
