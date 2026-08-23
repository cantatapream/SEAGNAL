/**
 * ============================================================================
 * 파일명: js/shared/utils/accident_codes.js
 * 역할  : "사고정보" 기능(선박사고·인명사고)의 _CD 코드값 → 한글 라벨 매핑 상수.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : 없음 (순수 상수 정의, mappings.js 와 동일한 패턴)
 *  - 서버 API      : 없음
 *  - 나를 쓰는 곳  : js/marine-life/safety/accident_info.js (마커 팝업·통계 패널
 *                    라벨 표시에 accidentLabel() 로 조회), accident_geocode_review.js
 *                    (검수화면 관할 라벨 표시)
 * [로드 순서] js/shared/utils/mappings.js 다음 (같은 "상수 전용" 그룹)
 *
 * [출처] 사용자가 제공한 국립해양조사원 개방海 데이터셋의
 *   "개방해 데이터셋 테이블정의서.xlsx" → 코드정의서 시트에서 1회 수동 추출.
 *   원본 xlsx(약 22MB, 선박사고 zip 3개에 동봉)는 레포에 커밋하지 않는다 —
 *   hazard_rocks.js 가 국립해양조사원 전자해도를 1회만 소비해 정적 데이터를
 *   만드는 것과 같은 방식(local_server/scripts/build_accidents.js 참고).
 * [ACCIDENT_ORG_LABELS 1750xxx 계열 보강(2026-08-23)] 처음엔 현재(1532xxx) 21개
 *   해경서 코드만 추출해, 실제 hk 데이터의 45%(2014~2017 "국민안전처" 시절 코드로
 *   남은 옛 기록)가 관할 라벨에 이름 대신 원본 숫자가 그대로 뜨는 문제가 있었다.
 *   같은 xlsx를 사용자가 다시 첨부해줘 "기관코드" 시트의 이전기관코드 필드로
 *   1750xxx(옛 코드) ↔ 1532xxx(현재 코드) 대응을 확인하고 채웠다(추측 없이 원본
 *   근거로만 — 코드 41개, 커버리지 100%). orgCd=0(원본 CSV 빈 값)은 "관할 미상".
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

// 발생원인(OCRN_CAUS_CD) — 선박(해경) 전용. 선박(심판원)·인명 CSV엔 이 컬럼이 없다.
const ACCIDENT_CAUSE_LABELS = {
    ACC004: '기타(인명)', ACC005: '관리소홀', ACC006: '기관고장', ACC007: '기관손상',
    ACC008: '기상악화', ACC009: '기타', ACC010: '별표', ACC011: '연료고갈',
    ACC012: '운항부주의', ACC013: '원인미상', ACC014: '재질불량', ACC015: '적재불량',
    ACC016: '전복', ACC017: '정비불량', ACC018: '좌초', ACC019: '충돌', ACC020: '침수',
    ACC021: '화기취급부주의', ACC022: '안전부주의'
};

// 선박종류(SHIP_KND_CD) — 선박(해경) 전용. 선박(심판원) CSV엔 이 컬럼이 없다.
const ACCIDENT_SHIP_KIND_LABELS = {
    KIN002: '고무보트', KIN003: '관공선', KIN004: '낚시어선', KIN005: '모터보트',
    KIN006: '수상오토바이', KIN007: '어선', KIN008: '여객선', KIN009: '예부선',
    KIN010: '요트', KIN011: '유도선', KIN012: '유조선', KIN013: '화물선',
    KIN014: '기타(레저선박)', KIN015: '기타', KIN016: '기타(통선)'
};

// 관할해경서(CMPTNC_KCGOFC_CD) — 선박(해경)·인명 공용.
// 1532xxx = 현재(해양경찰청) 코드, 1750xxx = 2014~2017 "국민안전처" 시절 같은 서에
// 붙었던 예전 코드(데이터가 2008~현재를 아우르다 보니 같은 서가 시기별로 다른
// 코드로 남아있음) — 코드정의서(사용자 제공 xlsx)의 "이전기관코드" 필드로 확인해
// 같은 서로 매핑. 1750612·1750632는 제주·서귀포 산하 부서 코드라 그 서로 매핑.
const ACCIDENT_ORG_LABELS = {
    1532418: '속초해양경찰서', 1532440: '동해해양경찰서', 1532466: '포항해양경찰서',
    1532304: '울산해양경찰서', 1532329: '부산해양경찰서', 1532357: '창원해양경찰서',
    1532376: '통영해양경찰서', 1532170: '여수해양경찰서', 1532199: '완도해양경찰서',
    1532222: '목포해양경찰서', 1532255: '군산해양경찰서', 1532056: '보령해양경찰서',
    1532074: '태안해양경찰서', 1532098: '평택해양경찰서', 1532121: '인천해양경찰서',
    1532508: '제주해양경찰서', 1532530: '서귀포해양경찰서', 1532281: '부안해양경찰서',
    1532609: '울진해양경찰서', 1532759: '사천해양경찰서', 1750000: '국민안전처',
    1750163: '속초해양경찰서', 1750186: '동해해양경찰서', 1750213: '포항해양경찰서',
    1750259: '울산해양경찰서', 1750283: '부산해양경찰서', 1750311: '창원해양경찰서',
    1750329: '통영해양경찰서', 1750374: '여수해양경찰서', 1750403: '완도해양경찰서',
    1750426: '목포해양경찰서', 1750461: '군산해양경찰서', 1750494: '보령해양경찰서',
    1750511: '태안해양경찰서', 1750533: '평택해양경찰서', 1750556: '인천해양경찰서',
    1750608: '제주해양경찰서', 1750612: '제주해양경찰서', 1750631: '서귀포해양경찰서',
    1750632: '서귀포해양경찰서',
    0: '관할 미상' // build_accidents.js 의 toInt() 가 원본 CSV 빈 값을 0으로 채운 것 — 실제 미상
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
// 원본 데이터에 주/야간 구분 컬럼이 없어 시각 정보로 근사한다. 06:00~18:00 을
// 주간으로 보는 통상 관례를 그대로 쓴다(기상청 등 다른 화면과 다를 수 있음 —
// "통계용 근사치"라는 점을 통계 패널 문구에 명시할 것).
const ACCIDENT_DAY_START_HOUR = 6;
const ACCIDENT_DAY_END_HOUR = 18; // 이 시각 미만까지 주간(18시부터 야간)

/**
 * 선박(해경) OCRN_HM("6:05" 형식)으로 주간 여부 판정.
 * @param {string} hm
 * @returns {boolean}
 */
function accidentIsDaytimeFromHM(hm) {
    if (!hm) return true;
    const hour = parseInt(String(hm).split(':')[0], 10);
    if (isNaN(hour)) return true;
    return hour >= ACCIDENT_DAY_START_HOUR && hour < ACCIDENT_DAY_END_HOUR;
}
