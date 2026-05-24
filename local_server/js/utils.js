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

/**
 * KMA 형식 또는 ISO 일자 문자열을 한국어 표기로 변환 ("YYYY년 MM월 DD일 HH시 mm분").
 * 빈 값/잘못된 값은 '정보 없음' 반환. 화면 표시용 일관 포맷팅.
 *
 * @param {string} dateStr - "YYYYMMDDHHmm" 또는 "YYYY-MM-DD HH:mm" 등
 * @returns {string}
 */
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
    if (!tmEf || String(tmEf).trim() === '' || tmEf === '0' || tmEf === '000000000000') {
        return '정보 없음';
    }

    let s = String(tmEf)
        .replace(/&#40;/g, '(').replace(/&#41;/g, ')')
        .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
        .trim();

    // ── 상대 일자 라벨 (KST 기준, 미래만): 오늘/내일/모레/글피/그글피, 그 이후 없음 ──
    const relLabel = (y, mo, d) => {
        if (!y || !mo || !d) return '';
        const now = new Date(Date.now() + 9 * 3600000); // KST 달력일 (기기 TZ 무관)
        const diff = Math.round(
            (Date.UTC(y, mo - 1, d) - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86400000
        );
        if (diff < 0) return '';
        return ['오늘', '내일', '모레', '글피', '그글피'][diff] || '';
    };
    const dateLabel = (y, mo, d) => {
        const l = relLabel(y, mo, d);
        return `${mo}월 ${d}일${l ? '(' + l + ')' : ''}`;
    };
    // 범위: 끝 0시→24시. degenerate(시작==끝, 예비 6시간 단위)면 6시간 블록 스냅.
    // 명시적 3h/6h 범위(시작≠끝)는 그대로 보존(해제예고 등).
    const fmtRange = (sh, eh) => {
        sh = ((sh % 24) + 24) % 24;
        eh = (eh === 0 || eh === 24) ? 24 : ((eh % 24) + 24) % 24;
        if (sh === eh) { const bs = Math.floor(sh / 6) * 6; sh = bs; eh = bs + 6; }
        return `${sh}시~${eh}시`;
    };
    const fmtExact = (hh, mm) => `${hh}시` + (mm ? ` ${mm}분` : ''); // 분·초 제거(0이면 시만)

    // ── 날짜 + 시간부 분리 ──
    let Y = null, Mo = null, D = null, rest = null, m;
    if (m = s.match(/^(\d{4})\s*[-.\/년]\s*(\d{1,2})\s*[-.\/월]\s*(\d{1,2})\s*일?\s*(.*)$/)) {
        Y = +m[1]; Mo = +m[2]; D = +m[3]; rest = m[4].trim();
    } else if (/^\d{12}$/.test(s)) {
        Y = +s.slice(0, 4); Mo = +s.slice(4, 6); D = +s.slice(6, 8);
        const hh = +s.slice(8, 10), mm = +s.slice(10, 12);
        // [레거시] 58/59분 = KMA 범위코드 → 해당 시간대 범위로 복원
        if (mm === 58 || mm === 59) {
            rest = (hh >= 18) ? '18~24시' : (hh >= 12) ? '12~18시'
                 : (hh >= 9) ? '09~12시' : (hh >= 6) ? '06~09시' : '00~06시';
        } else {
            rest = `${s.slice(8, 10)}:${s.slice(10, 12)}`;
        }
    } else if (m = s.match(/^(\d{1,2})\s*일\s*(.*)$/)) {
        D = +m[1]; rest = m[2].trim(); // 연/월 없음 → 라벨·월 생략
    } else {
        rest = s;
    }

    // ── 시간부 파싱 ──
    let timeStr = '';
    if (rest) {
        let rm;
        if (rm = rest.match(/(\d{1,2})\s*시?\s*[~∼]\s*(\d{1,2})\s*시/)) {
            timeStr = fmtRange(parseInt(rm[1], 10), parseInt(rm[2], 10));   // 범위 (3h/6h 보존, degenerate만 스냅)
        } else if (rm = rest.match(/(\d{1,2}):(\d{2})/)) {
            timeStr = fmtExact(parseInt(rm[1], 10), parseInt(rm[2], 10));    // HH:MM[:SS]
        } else if (rm = rest.match(/(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/)) {
            timeStr = fmtExact(parseInt(rm[1], 10), rm[2] ? parseInt(rm[2], 10) : 0); // H시 [M분]
        } else {
            timeStr = rest;
        }
    }

    // ── 조립 ──
    if (Mo && D) {
        if (D === 0 || Mo === 0) return '정보 없음';
        return `${dateLabel(Y, Mo, D)}${timeStr ? ' ' + timeStr : ''}`.trim();
    }
    if (D) return `${D}일${timeStr ? ' ' + timeStr : ''}`.trim();
    return timeStr || s;
}


/**
 * 현재 KST 시각을 KMA 형식 "YYYYMMDDHHmm" 12자리 문자열로 반환.
 * tmEf/tmFc 등 KMA 시간 필드와 직접 비교하여 미래/과거 판정에 사용.
 *
 * @returns {string} 예: "202604301530"
 */
function getKfTime() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    return `${y}${m}${d}${h}${min}`;
}

/**
 * 외부 URL 을 CORS 프록시(CONFIG.CORS_PROXY) 로 감싸 반환.
 * CONFIG.USE_CORS_PROXY 가 false 면 원본 URL 그대로.
 *
 * [용도] 브라우저 CORS 제약을 회피해야 하는 외부 KMA/KHOA API 호출 시 사용.
 *
 * @param {string} url
 * @returns {string}
 */
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

