/**
 * ============================================================================
 * 파일명: js/shared/utils/accident_codes.js
 * 역할  : "사고정보" 기능(선박사고·인명사고)의 _CD 코드값 → 한글 라벨 매핑 상수.
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

// 사고해역(ACDNT_SEAR1_CD) — 선박(심판원) 전용. 원인·선박종류 컬럼이 없는 대신
// 이 필드로 "사고발생상세"의 두 번째 탭(해역별)을 구성한다.
const ACCIDENT_SEA_AREA_LABELS = {
    OCC001: '개항 및 진입수로', OCC002: '남해공해', OCC003: '남해영해', OCC004: '동남아',
    OCC005: '동해공해', OCC006: '동해영해', OCC007: '서해공해', OCC008: '서해영해',
    OCC009: '원양', OCC010: '일본수역', OCC011: '기타'
};

// 관할해경서(CMPTNC_KCGOFC_CD) — 선박(해경)·인명 공용.
const ACCIDENT_ORG_LABELS = {
    1532418: '속초해양경찰서', 1532440: '동해해양경찰서', 1532466: '포항해양경찰서',
    1532304: '울산해양경찰서', 1532329: '부산해양경찰서', 1532357: '창원해양경찰서',
    1532376: '통영해양경찰서', 1532170: '여수해양경찰서', 1532199: '완도해양경찰서',
    1532222: '목포해양경찰서', 1532255: '군산해양경찰서', 1532056: '보령해양경찰서',
    1532074: '태안해양경찰서', 1532098: '평택해양경찰서', 1532121: '인천해양경찰서',
    1532508: '제주해양경찰서', 1532530: '서귀포해양경찰서', 1532281: '부안해양경찰서',
    1532609: '울진해양경찰서', 1532759: '사천해양경찰서', 1750000: '국민안전처'
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
