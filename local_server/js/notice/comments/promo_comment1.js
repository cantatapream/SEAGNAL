/**
 * ============================================================================
 * 파일명: js/promo_comment1.js
 * 역할: 게시글 댓글 시스템 - 공통 유틸리티 (닉네임, 기기ID, 헬퍼)
 * 로딩 순서: promo.js 다음 (promo_comment2~5.js 보다 먼저)
 * ============================================================================
 *
 * [이 파일이 담당하는 것]
 * - 해양 테마 랜덤 닉네임 생성 및 localStorage 저장
 * - 기기 ID 조회 (기존 seagnal_device_id 재사용)
 * - 관리자 모드 여부 확인
 * - 날짜 포맷 헬퍼
 * - 현재 열려있는 게시글 ID 관리
 *
 * [연계 파일]
 * - promo_comment2.js → 댓글 렌더링
 * - promo_comment3.js → 댓글 등록/수정/삭제
 * - promo_comment4.js → 관리자 기능 (답글, 원문보기)
 * - promo_comment5.js → 댓글 섹션 초기화 진입점
 * ============================================================================
 */

// ============================================================================
// 전역 상태 변수
// ============================================================================

/** 현재 열려있는 게시글 ID (댓글 API 호출 시 사용) */
var _currentCommentPostId = null;

/** 현재 게시글의 댓글 허용 여부 */
var _currentAllowComments = false;

/** 서버에서 불러온 전체 댓글 목록 (렌더링/수정 시 참조) */
var _commentsList = [];

// ============================================================================
// 해양 테마 닉네임 생성
// ============================================================================

/**
 * 해양 테마 닉네임 구성 단어 목록
 * 형식: [수식어] + [해양명사] + [3자리 숫자]
 * 예시: 파란돌고래742, 깊은오징어391, 맑은해파리056
 */
var _NICKNAME_ADJECTIVES = [
    '파란', '깊은', '맑은', '넓은', '잔잔한',
    '거센', '투명한', '청명한', '푸른', '고요한',
    '빛나는', '신비한', '용감한', '씩씩한', '빠른'
];

var _NICKNAME_NOUNS = [
    '돌고래', '오징어', '해파리', '고래', '문어',
    '상어', '갈치', '참치', '가오리', '복어',
    '성게', '전복', '소라', '조개', '불가사리',
    '해마', '물개', '갈매기', '바닷가재', '대게'
];

/**
 * 랜덤 해양 닉네임을 생성하여 반환한다.
 * 생성 후 localStorage에 저장하여 동일 기기에서 항상 같은 닉네임 사용.
 * 이미 저장된 닉네임이 있으면 그대로 반환.
 * @returns {string} 닉네임 (예: "파란돌고래742")
 */
function getOrCreateNickname() {
    // 기존 닉네임이 있으면 재사용 (닉네임은 기기당 1개 고정)
    var saved = localStorage.getItem('seagnal_comment_nickname');
    if (saved) return saved;

    // 새 닉네임 생성
    var adj = _NICKNAME_ADJECTIVES[Math.floor(Math.random() * _NICKNAME_ADJECTIVES.length)];
    var noun = _NICKNAME_NOUNS[Math.floor(Math.random() * _NICKNAME_NOUNS.length)];
    var num = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    var nickname = adj + noun + num;

    localStorage.setItem('seagnal_comment_nickname', nickname);
    return nickname;
}

// ============================================================================
// 기기 ID 조회
// ============================================================================

/**
 * 현재 기기의 고유 ID를 반환한다.
 * 기존 제보/설문 시스템과 동일한 seagnal_device_id 키를 사용.
 * 없으면 새로 생성하여 저장.
 * @returns {string} 기기 ID
 */
function getCommentDeviceId() {
    var id = localStorage.getItem('seagnal_device_id');
    if (!id) {
        // UUID v4 형식으로 생성
        id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0;
            var v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
        localStorage.setItem('seagnal_device_id', id);
    }
    return id;
}

// ============================================================================
// 관리자 여부 확인
// ============================================================================

/**
 * 현재 사용자가 관리자 모드인지 확인한다.
 * promo.js의 관리자 인증과 동일한 localStorage 키 사용.
 * @returns {boolean}
 */
function isAdminMode() {
    return localStorage.getItem('seagnal_admin_mode') === 'true';
}

// ============================================================================
// 날짜 포맷 헬퍼
// ============================================================================

/**
 * "YYYY.MM.DD HH:mm" 형식의 날짜 문자열에서 "MM.DD HH:mm" 형식으로 줄여서 반환.
 * 댓글 항목의 날짜 표시에 사용 (화면이 좁으므로 년도 생략).
 * @param {string} dateStr - "2026.04.02 14:30" 형식의 날짜
 * @returns {string} "04.02 14:30" 형식
 */
function formatCommentDate(dateStr) {
    if (!dateStr) return '';
    // "YYYY.MM.DD HH:mm" → "MM.DD HH:mm"
    var match = dateStr.match(/\d{4}\.(\d{2}\.\d{2}\s+\d{2}:\d{2})/);
    if (match) return match[1];
    return dateStr;
}

/**
 * HTML 특수문자를 이스케이프하여 XSS 공격을 방지한다.
 * 댓글 내용 출력 시 반드시 사용.
 * @param {string} text - 원본 텍스트
 * @returns {string} 이스케이프된 텍스트
 */
function escapeCommentHtml(text) {
    var div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}
