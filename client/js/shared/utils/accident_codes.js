/**
 * ============================================================================
 * 파일명: js/shared/utils/accident_codes.js
 * 역할  : "사고정보" 기능(선박사고(심판원)·인명사고)의 _CD 코드값 → 한글 라벨 매핑
 *         상수. 선박(해경) 전용이던 발생원인·선박종류·관할해경서 라벨은 2026-08-20
 *         해경 소스 제외로 함께 삭제했다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : 없음 (순수 상수 정의, mappings.js 와 동일한 패턴)
 *  - 서버 API      : 없음
 *  - 나를 쓰는 곳  : js/marine-life/safety/accident_info.js (마커 팝업·통계 패널
 *                    라벨 표시에 accidentLabel() 로 조회)
 * [로드 순서] js/shared/utils/mappings.js 다음 (같은 "상수 전용" 그룹)
 *
 * [출처] 사용자가 제공한 국립해양조사원 개방海 데이터셋의
 *   "개방해 데이터셋 테이블정의서.xlsx" → 코드정의서 시트에서 1회 수동 추출.
 *   원본 xlsx(약 22MB, 선박사고 zip 3개에 동봉)는 레포에 커밋하지 않는다 —
 *   hazard_rocks.js 가 국립해양조사원 전자해도를 1회만 소비해 정적 데이터를
 *   만드는 것과 같은 방식(local_server/scripts/build_accidents.js 참고).
 * ============================================================================
 */

// 사고유형(ACDNT_TYPE_CD) — 선박(해경)·선박(심판원)·인명 3개 소스가 같은 코드 공간을 공유한다.
// ATY001~008 은 인명사고 유형, ATY009~041 은 주로 선박사고 유형이다.
const ACCIDENT_TYPE_LABELS = {
    ATY001: '익수자', ATY002: '추락자', ATY003: '고립자', ATY004: '응급환자',
    ATY005: '변사자', ATY006: '자살자', ATY007: '표류자', ATY008: '기타(인명)',
    ATY009: '기관고장', ATY010: '기관손상', ATY011: '기타(선박)',
    ATY012: '선체결함 또는 수밀문·개구부 결함', ATY013: '속구손상', ATY014: '시설물손상',
    ATY015: '안전저해', ATY016: '운항저해', ATY017: '인명사상', ATY018: '전복',
    ATY019: '접촉', ATY020: '조난', ATY021: '조타장치손상', ATY022: '좌주',
    ATY023: '좌초', ATY024: '추진기손상', ATY025: '추진기장애', ATY026: '추진축계손상',
    ATY027: '충돌', ATY028: '침몰', ATY029: '침수', ATY030: '키손상', ATY031: '타기고장',
    ATY032: '폭발', ATY033: '표류', ATY034: '해양오염', ATY035: '행방불명',
    ATY036: '화재', ATY037: '침수침몰', ATY038: '기타', ATY039: '방향상실',
    ATY040: '부유물감김', ATY041: '좌초/좌주'
};

// 사고해역(ACDNT_SEAR1_CD) — 선박(심판원) 전용. 원인·선박종류 컬럼이 없는 대신
// 이 필드로 "사고발생상세"의 두 번째 탭(해역별)을 구성한다.
const ACCIDENT_SEA_AREA_LABELS = {
    OCC001: '개항 및 진입수로', OCC002: '남해공해', OCC003: '남해영해', OCC004: '동남아',
    OCC005: '동해공해', OCC006: '동해영해', OCC007: '서해공해', OCC008: '서해영해',
    OCC009: '원양', OCC010: '일본수역', OCC011: '기타'
};

/**
 * 코드값을 한글 라벨로 바꾼다. 매핑에 없는 코드는 원래 코드를 그대로 돌려준다
 * (화면에 "undefined" 가 뜨는 것보다 원본 코드가 뜨는 편이 디버깅에 낫다).
 * @param {Object} table - 위 ACCIDENT_*_LABELS 중 하나
 * @param {string|number} code - _CD 원본 값
 * @returns {string} 한글 라벨 또는 원본 코드
 * @example accidentLabel(ACCIDENT_TYPE_LABELS, 'ATY027') // '충돌'
 * [연계] accident_info.js 의 마커 팝업·통계 패널이 호출
 */
function accidentLabel(table, code) {
    if (code == null || code === '') return '-';
    return (table && table[code] != null) ? table[code] : String(code);
}

// 사고유형(ACDNT_TYPE_CD) → 마커 아이콘 이미지(120x120, 사용자 제공 이미지,
// client/images/accident_markers/ 에 있음). 여러 유형이 비슷한 그림을 공유한다
// (예: 기관고장·기관손상·운항저해는 모두 ship_engine_trouble.png).
// 사용자 확정(2026-08-18): 인명사상→응급환자 그림, 표류(선박)→익수자 그림,
// 안전저해→기타(선박) 그림으로 대체. [연계] accident_info.js singleStyleFor·clusterStyleFn
const ACCIDENT_TYPE_ICONS = {
    ATY001: '/images/accident_markers/person_drowning.png',
    ATY002: '/images/accident_markers/person_fallen.png',
    ATY003: '/images/accident_markers/person_isolated.png',
    ATY004: '/images/accident_markers/person_emergency.png',
    ATY005: '/images/accident_markers/person_deceased.png',
    ATY006: '/images/accident_markers/person_suicide.png',
    ATY007: '/images/accident_markers/person_drowning.png', // 표류자 — 익수자와 공유
    ATY008: '/images/accident_markers/person_misc.png',
    ATY009: '/images/accident_markers/ship_engine_trouble.png',
    ATY010: '/images/accident_markers/ship_engine_trouble.png',
    ATY011: '/images/accident_markers/ship_misc.png',
    ATY015: '/images/accident_markers/ship_misc.png', // 안전저해 — 이미지 없어 기타(선박)로 대체
    ATY016: '/images/accident_markers/ship_engine_trouble.png',
    ATY017: '/images/accident_markers/person_emergency.png', // 인명사상 — 이미지 없어 응급환자로 대체
    ATY018: '/images/accident_markers/ship_capsized.png',
    ATY019: '/images/accident_markers/ship_collision.png',
    ATY021: '/images/accident_markers/ship_propulsion_damage.png',
    ATY022: '/images/accident_markers/ship_grounded.png',
    ATY023: '/images/accident_markers/ship_stranded.png',
    ATY024: '/images/accident_markers/ship_propulsion_damage.png',
    ATY025: '/images/accident_markers/ship_propulsion_damage.png',
    ATY026: '/images/accident_markers/ship_propulsion_damage.png',
    ATY027: '/images/accident_markers/ship_collision.png',
    ATY028: '/images/accident_markers/ship_sunk.png',
    ATY029: '/images/accident_markers/ship_flooded.png',
    ATY030: '/images/accident_markers/ship_propulsion_damage.png',
    ATY031: '/images/accident_markers/ship_propulsion_damage.png',
    ATY032: '/images/accident_markers/ship_explosion.png',
    ATY033: '/images/accident_markers/person_drowning.png', // 표류(선박) — 이미지 없어 익수자로 대체
    ATY034: '/images/accident_markers/ship_pollution.png',
    ATY035: '/images/accident_markers/ship_missing.png',
    ATY036: '/images/accident_markers/ship_fire.png',
    ATY037: '/images/accident_markers/ship_sunk.png',
    ATY038: '/images/accident_markers/ship_misc.png',
    ATY039: '/images/accident_markers/ship_lost_direction.png',
    ATY040: '/images/accident_markers/ship_entangled.png',
    ATY041: '/images/accident_markers/ship_stranded.png'
};

// 사고유형 중 지도에 아예 표출하지 않을 코드(사용자 확정 2026-08-18: 대응 이미지가
// 없고 대체할 만한 이미지도 마땅치 않아 제외 — 선체결함/속구손상/시설물손상/조난).
// [연계] accident_info.js ensureRawFeatures 가 이 목록에 있는 사고를 필터링
const ACCIDENT_TYPE_EXCLUDED = { ATY012: true, ATY013: true, ATY014: true, ATY020: true };

// ── 주/야간 판정 ────────────────────────────────────────────────────────
// 원본 데이터에 주/야간 구분 컬럼이 없어 시각 정보로 근사한다.

// 선박(심판원) OCRN_TMZ_CD(4시간 구간 코드)로 주간 여부 판정.
// TMZ001(0-4시)·TMZ006(20-24시) 만 야간으로, 나머지(4~20시)는 주간으로 근사한다
// (06~18시 기준과 정확히 일치하진 않지만 4시간 구간이 그보다 더 세밀하진 않다).
const ACCIDENT_TMZ_NIGHT_CODES = { TMZ001: true, TMZ006: true };

/**
 * 선박(심판원) OCRN_TMZ_CD 로 주간 여부 판정.
 * @param {string} tmzCd
 * @returns {boolean}
 */
function accidentIsDaytimeFromTmz(tmzCd) {
    return !ACCIDENT_TMZ_NIGHT_CODES[tmzCd];
}
