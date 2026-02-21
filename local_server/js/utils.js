/**
 * ============================================================================
 * 파일명: js/utils.js
 * 역할: 전역 상태(appState), 유틸리티 함수, 날짜/시간 포맷팅
 * ============================================================================
 *
 * [설명]
 * - appState: 앱의 중앙 상태 객체 (특보, 부이, API 상태 등)
 * - getSeaArea(): 구역명 → 대분류(동해/서해/남해/제주) 변환
 * - formatDate(), formatWarningTime(): 날짜/시간 포맷팅
 * - getKfTime(): 한국 시간 계산
 * - getProxiedUrl(): CORS 프록시 URL 생성
 * - decodeHtmlEntities(): HTML 엔티티 디코딩
 *
 * [로딩 순서] 3번째 (config.js, mappings.js 이후)
 * ============================================================================
 */

// Global State
let appState = {
    alerts: [],
    coastalAlerts: {}, // 연안바다 특보 저장
    buoyData: {},      // 부이 데이터 저장
    alertStateHistory: {}, // [New] 구역별 특보 히스토리 (alert_state.json)
    lastUpdated: null,
    isLoading: false,
    apiStatus: { hub: 'pending', buoy: 'pending', coastal: 'pending' },
    hasApiError: false // API 호출 실패 여부
};
window.appState = appState; // Expose to global window object


// ----------------------------------------------------------------------------
// Utilities
// ----------------------------------------------------------------------------

function getSeaArea(zoneName) {
    if (!zoneName) return '기타';
    for (const [sea, keywords] of Object.entries(ZONE_CLASSIFICATION)) {
        if (keywords.some(k => zoneName.includes(k))) return sea;
    }
    return '기타';
}

function formatDate(dateStr) {
    if (!dateStr || dateStr.trim() === '') return '정보 없음';

    let decoded = String(dateStr)
        .replace(/&#40;/g, '(')
        .replace(/&#41;/g, ')')
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .trim();

    // [수정] '일' 또는 숫자가 전혀 포함되지 않은 완전한 텍스트 쓰레기값만 필터링
    // 단, '오전', '오후', '~' 등이 포함된 유효한 기간 텍스트는 허용
    if (decoded === '일' || (!/\d/.test(decoded) && !decoded.includes('오전') && !decoded.includes('오후'))) {
        return '정보 없음';
    }

    // [추가] '00일'로 시작하거나 포함된 무효한 날짜 처리
    if (decoded.includes('00일') || decoded.startsWith('00')) {
        // 단, '00시' 같은 경우는 제외해야 하므로 더 정밀하게 체크
        if (decoded.includes('00일') || decoded === '00') {
            return '정보 없음';
        }
    }

    // 시간을 오전/오후 형식으로 변환하는 헬퍼 함수
    const formatHourToAmPm = (hourStr, minStr = '00') => {
        const hour = parseInt(hourStr, 10);
        let text = '';
        if (hour === 0) text = '오전 12시';
        else if (hour < 12) text = `오전 ${hour}시`;
        else if (hour === 12) text = '오후 12시';
        else text = `오후 ${hour - 12}시`;

        if (minStr !== '00') text += ` ${parseInt(minStr, 10)}분`;
        return text;
    };

    // YYYY.MM.DD.HH:MM 형식 처리 (예: 2025.12.24.04:00) - AFSO 형식
    const dotMatch = decoded.match(/^(\d{4})\.(\d{2})\.(\d{2})\.(\d{2}):(\d{2})$/);
    if (dotMatch) {
        const [, , month, date, hour, min] = dotMatch;
        return `${month}/${date} ${formatHourToAmPm(hour, min)}`;
    }

    // YYYY.MM.DD. 텍스트 형식 처리 (예: 2025.12.12. 새벽(00시~06시))
    const textMatch = decoded.match(/^(\d{4})\.(\d{2})\.(\d{2})\.\s*(.+)$/);
    if (textMatch) {
        const [, , month, date, text] = textMatch;
        return `${month}/${date} ${text}`;
    }

    // 기존 MM/DD HH:MM 형식이면 그대로
    if (decoded.includes('/')) return decoded;

    // 이미 한글 시간대가 포함되어 있으면 그대로
    if (decoded.includes('새벽') || decoded.includes('아침') || decoded.includes('오전') ||
        decoded.includes('낮') || decoded.includes('오후') || decoded.includes('저녁') || decoded.includes('밤')) {
        return decoded;
    }

    // YYYYMMDDHHMM 형식 처리 (KMA Hub 형식)
    return formatWarningTime(dateStr, false);
}

// 시간 포맷 변환 (발효/해제 시간대 처리)
// 시간 포맷 변환 (발효/해제 시간대 처리)
function formatWarningTime(tmEf, isEndTime = false) {
    if (!tmEf || tmEf.trim() === '' || tmEf === '0' || tmEf === '000000000000') {
        return '정보 없음';
    }

    let decoded = String(tmEf)
        .replace(/&#40;/g, '(')
        .replace(/&#41;/g, ')')
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .trim();

    // [수정] 2026-02-07 밤(18~24시)와 같은 하이브리드 형식을 2월 7일 밤(18~24시)로 변환
    const hybridMatch = decoded.match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/);
    if (hybridMatch) {
        const m = parseInt(hybridMatch[2], 10);
        const d = parseInt(hybridMatch[3], 10);
        const rest = hybridMatch[4];
        decoded = `${m}월 ${d}일${rest}`;
    }

    // 이미 한글 시간대가 포함되어 있으면 연도/월 정리 후 반환 (위에서 변환된 값 포함)
    if (decoded.includes('새벽') || decoded.includes('아침') || decoded.includes('오전') ||
        decoded.includes('낮') || decoded.includes('오후') || decoded.includes('저녁') || decoded.includes('밤')) {
        // "2026년 02월 15일 오전(06시~12시)" → "2월 15일 오전(06시~12시)"
        const koMatch = decoded.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*(.*)/);
        if (koMatch) {
            return `${parseInt(koMatch[2])}월 ${parseInt(koMatch[3])}일 ${koMatch[4]}`.trim();
        }
        return decoded;
    }

    const cleanStr = decoded.replace(/[^0-9]/g, '');
    if (cleanStr.length === 0) return '정보 없음';

    // YYYYMMDDHHmm (12자리) 처리
    if (cleanStr.length >= 10) {
        const month = cleanStr.length >= 12 ? cleanStr.substring(4, 6) : cleanStr.substring(0, 2);
        const day = cleanStr.length >= 12 ? cleanStr.substring(6, 8) : cleanStr.substring(2, 4);
        const hourOrInt = cleanStr.substring(8, 10);
        const minuteOrInt = cleanStr.length >= 12 ? cleanStr.substring(10, 12) : '00';

        const hh = parseInt(hourOrInt, 10);
        const mm = parseInt(minuteOrInt, 10);

        // [Smart Fix] 58/59분 코드를 범위형 텍스트로 변환
        if (mm === 58 || mm === 59) {
            const datePart = `${parseInt(month)}월 ${parseInt(day)}일`;
            if (hh >= 18 && hh <= 23) return `${datePart} 밤(18시~24시)`;
            if (hh >= 12 && hh < 18) return `${datePart} 오후(12시~18시)`;
            if (hh >= 9 && hh < 12) return `${datePart} 오전(09시~12시)`;
            if (hh >= 6 && hh < 9) return `${datePart} 아침(06시~09시)`;
            if (hh >= 0 && hh < 6) return `${datePart} 새벽(00시~06시)`;
        }

        // 일반 시각 포맷팅
        if (day === '00' || day === '0') return '정보 없음';
        let ampm = hh < 12 ? '오전' : '오후';
        let hour12 = hh === 0 ? 12 : (hh > 12 ? hh - 12 : hh);
        let timeStr = `${parseInt(month)}월 ${parseInt(day)}일 ${ampm} ${hour12}시`;
        if (mm !== 0) timeStr += ` ${mm}분`;
        return timeStr;
    }

    return decoded;
}


function getKfTime() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    return `${y}${m}${d}${h}${min}`;
}

function getProxiedUrl(url) {
    if (CONFIG.USE_CORS_PROXY) {
        return CONFIG.CORS_PROXY + encodeURIComponent(url);
    }
    return url;
}

// ----------------------------------------------------------------------------
// API Fetching
// ----------------------------------------------------------------------------

/**
 * HTML 엔티티를 디코딩하는 유틸리티 함수
 * &#40; -> (, &#41; -> ) 등
 */
function decodeHtmlEntities(text) {
    if (!text) return '';
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
}

