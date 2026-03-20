/**
 * ============================================================================
 * 파일명: js/forecast.js
 * 역할: 해상예보 테이블, 정보 팝업(해구별/특보/조석)
 * ============================================================================
 *
 * [설명]
 * - SEA_FORECAST_API_KEY, SEA_WEATHER_CODES 등: 해상예보 API 상수
 * - renderSeaForecastTableInModal(): 해상예보 테이블 렌더링
 * - showSeaZoneInfoPopup(): 해구별 기상 안내 팝업
 * - showWeatherAlertInfoPopup(): 특보 안내 팝업
 * - showTideInfoPopup(): 조석 안내 팝업
 *
 * [로딩 순서] 9번째 (settings.js 이후)
 * [참고] handleHeaderRefresh, updateTimeDisplay → app_init.js로 이동됨
 * ============================================================================
 */

// ==================== 해상예보 테이블 표시 ====================


// 해상예보 API 키
const SEA_FORECAST_API_KEY = 'ZKEQU5ukRvGhEFObpBbxVw';

// 날씨 코드
const SEA_WEATHER_CODES = {
    'DB01': '☀️', 'DB02': '🌤️', 'DB03': '⛅', 'DB04': '☁️'
};

// 풍향 한글 변환
const SEA_WIND_DIRS = {
    'N': '북', 'NNE': '북북동', 'NE': '북동', 'ENE': '동북동',
    'E': '동', 'ESE': '동남동', 'SE': '남동', 'SSE': '남남동',
    'S': '남', 'SSW': '남남서', 'SW': '남서', 'WSW': '서남서',
    'W': '서', 'WNW': '서북서', 'NW': '북서', 'NNW': '북북서'
};

// 먼바다 구역명 → 해구번호 직접 매핑
const FAR_SEA_ZONE_ID_MAP = {
    '동해남부남쪽안쪽먼바다': 94,
    '동해남부남쪽바깥먼바다': 367,
    '동해남부북쪽안쪽먼바다': 77,
    '동해남부북쪽바깥먼바다': 80,
    '동해중부안쪽먼바다': 57,
    '동해중부바깥먼바다': 60,
    '서해중부안쪽먼바다': 162,
    '서해중부바깥먼바다': 149,
    '서해남부북쪽안쪽먼바다': 192,
    '서해남부북쪽바깥먼바다': 189,
    '서해남부남쪽안쪽먼바다': 209,
    '서해남부남쪽바깥먼바다': 216,
    '남해동부안쪽먼바다': 112,
    '남해동부바깥먼바다': 381,
    '남해서부서쪽먼바다': 222,
    '남해서부동쪽먼바다': 224,
    '제주도남서쪽안쪽먼바다': 230,
    '제주도남동쪽안쪽먼바다': 244,
    '제주도남쪽바깥먼바다': 463
};

// 풍향 각도(degree) → 한글 16방위 변환 (먼바다 해구 기상용)
function degreeToWindDir(deg) {
    if (deg === null || deg === undefined || isNaN(deg)) return '-';
    deg = ((deg % 360) + 360) % 360;
    const dirs = ['북', '북북동', '북동', '동북동', '동', '동남동', '남동', '남남동',
                  '남', '남남서', '남서', '서남서', '서', '서북서', '북서', '북북서'];
    return dirs[Math.round(deg / 22.5) % 16];
}

// UTC tm 문자열(YYYYMMDDHH) → KST Date 변환
function tmToKstDate(tm) {
    const s = String(tm);
    const utc = new Date(Date.UTC(
        parseInt(s.substring(0, 4)), parseInt(s.substring(4, 6)) - 1,
        parseInt(s.substring(6, 8)), parseInt(s.substring(8, 10)), 0, 0
    ));
    return new Date(utc.getTime() + 9 * 60 * 60 * 1000);
}

// 파고 값 포맷 (1.0 → "1", 0.5 → "0.5")
function formatWaveHeight(v) {
    return v % 1 === 0 ? String(Math.round(v)) : String(parseFloat(v.toFixed(1)));
}

// 특보 구역명 → 예보 표시명 매핑 (UI에 표시할 이름)
const ZONE_NAME_DISPLAY_MAP = {
    // 제주 먼바다 통합
    '제주도남서쪽안쪽먼바다': '제주도남쪽먼바다',
    '제주도남동쪽안쪽먼바다': '제주도남쪽먼바다',
    '제주도남쪽바깥먼바다': '제주도남쪽먼바다',

    // 서해중부
    '인천·경기북부앞바다': '경기북부앞바다',
    '서해중부안쪽먼바다': '서해중부먼바다',
    '서해중부바깥먼바다': '서해중부먼바다',

    // 서해남부 먼바다 통합
    '서해남부북쪽바깥먼바다': '서해남부먼바다',
    '서해남부북쪽안쪽먼바다': '서해남부먼바다',
    '서해남부남쪽바깥먼바다': '서해남부먼바다',
    '서해남부남쪽안쪽먼바다': '서해남부먼바다',

    // 남해서부 먼바다 통합
    '남해서부서쪽먼바다': '남해서부먼바다',
    '남해서부동쪽먼바다': '남해서부먼바다',

    // 남해동부 먼바다 통합
    '남해동부안쪽먼바다': '남해동부먼바다',
    '남해동부바깥먼바다': '남해동부먼바다',

    // 동해남부 먼바다 통합
    '동해남부남쪽안쪽먼바다': '동해남부먼바다',
    '동해남부남쪽바깥먼바다': '동해남부먼바다',
    '동해남부북쪽안쪽먼바다': '동해남부먼바다',
    '동해남부북쪽바깥먼바다': '동해남부먼바다',

    // 동해중부 먼바다 통합
    '동해중부안쪽먼바다': '동해중부먼바다',
    '동해중부바깥먼바다': '동해중부먼바다'
};

// 특보 구역명 → 예보 API 구역코드 매핑
const ZONE_NAME_TO_CODE = {
    // === 제주 ===
    '제주도서부앞바다': '12B10304',
    '제주도북부앞바다': '12B10302',
    '제주도동부앞바다': '12B10301',
    '제주도남부앞바다': '12B10303',
    '제주도앞바다': '12B10300',
    '제주도남쪽먼바다': '12B10400',
    '제주도남서쪽안쪽먼바다': '12B10400',
    '제주도남동쪽안쪽먼바다': '12B10400',
    '제주도남쪽바깥먼바다': '12B10400',

    // === 서해중부 ===
    '인천·경기북부앞바다': '12A20101',
    '경기북부앞바다': '12A20101',
    '인천·경기남부앞바다': '12A20102',
    '충남북부앞바다': '12A20103',
    '충남남부앞바다': '12A20104',
    '서해중부앞바다': '12A20100',
    '서해중부먼바다': '12A20200',
    '서해중부안쪽먼바다': '12A20200',
    '서해중부바깥먼바다': '12A20200',

    // === 서해남부 ===
    '전북북부앞바다': '22A30101',
    '전북남부앞바다': '22A30102',
    '전남북부서해앞바다': '22A30103',
    '전남중부서해앞바다': '22A30104',
    '전남남부서해앞바다': '22A30105',
    '서해남부앞바다': '12A30100',
    '서해남부먼바다': '12A30200',
    '서해남부북쪽바깥먼바다': '12A30200',
    '서해남부북쪽안쪽먼바다': '12A30200',
    '서해남부남쪽바깥먼바다': '12A30200',
    '서해남부남쪽안쪽먼바다': '12A30200',

    // === 서해북부 ===
    '서해북부앞바다': '12A10100',
    '서해북부먼바다': '12A10200',

    // === 남해서부 ===
    '전남서부남해앞바다': '12B10101',
    '전남동부남해앞바다': '12B10102',
    '남해서부앞바다': '12B10100',
    '남해서부먼바다': '12B10200',
    '남해서부서쪽먼바다': '12B10200',
    '남해서부동쪽먼바다': '12B10200',

    // === 남해동부 ===
    '경남서부남해앞바다': '12B20101',
    '경남중부남해앞바다': '12B20102',
    '부산앞바다': '12B20103',
    '거제시동부앞바다': '12B20104',
    '남해동부앞바다': '12B20100',
    '남해동부먼바다': '12B20200',
    '남해동부안쪽먼바다': '12B20200',
    '남해동부바깥먼바다': '12B20200',

    // === 동해남부 ===
    '울산앞바다': '12C10101',
    '경북남부앞바다': '12C10102',
    '경북북부앞바다': '12C10103',
    '동해남부앞바다': '12C10100',
    '동해남부먼바다': '12C10200',
    '동해남부남쪽안쪽먼바다': '12C10200',
    '동해남부남쪽바깥먼바다': '12C10200',
    '동해남부북쪽안쪽먼바다': '12C10200',
    '동해남부북쪽바깥먼바다': '12C10200',

    // === 동해중부 ===
    '강원남부앞바다': '12C20101',
    '강원중부앞바다': '12C20102',
    '강원북부앞바다': '12C20103',
    '동해중부앞바다': '12C20100',
    '동해중부먼바다': '12C20200',
    '동해중부안쪽먼바다': '12C20200',
    '동해중부바깥먼바다': '12C20200',

    // === 동해북부 ===
    '동해북부앞바다': '12C30100',
    '동해북부먼바다': '12C30200'
};

// 구역명 → 중기해상예보 regId 매핑
const ZONE_NAME_TO_MID_TERM_REG_ID = {
    // 서해북부
    '서해북부앞바다': '12A10000', '서해북부먼바다': '12A10000',
    // 서해중부
    '인천·경기북부앞바다': '12A20000', '경기북부앞바다': '12A20000',
    '인천·경기남부앞바다': '12A20000', '충남북부앞바다': '12A20000',
    '충남남부앞바다': '12A20000', '서해중부앞바다': '12A20000',
    '서해중부먼바다': '12A20000', '서해중부안쪽먼바다': '12A20000',
    '서해중부바깥먼바다': '12A20000',
    // 서해남부
    '전북북부앞바다': '12A30000', '전북남부앞바다': '12A30000',
    '전남북부서해앞바다': '12A30000', '전남중부서해앞바다': '12A30000',
    '전남남부서해앞바다': '12A30000', '서해남부앞바다': '12A30000',
    '서해남부먼바다': '12A30000', '서해남부북쪽안쪽먼바다': '12A30000',
    '서해남부북쪽바깥먼바다': '12A30000', '서해남부남쪽안쪽먼바다': '12A30000',
    '서해남부남쪽바깥먼바다': '12A30000',
    // 남해서부
    '전남서부남해앞바다': '12B10000', '전남동부남해앞바다': '12B10000',
    '남해서부앞바다': '12B10000', '남해서부먼바다': '12B10000',
    '남해서부서쪽먼바다': '12B10000', '남해서부동쪽먼바다': '12B10000',
    // 제주도 (남해서부 권역)
    '제주도서부앞바다': '12B10000', '제주도북부앞바다': '12B10000',
    '제주도동부앞바다': '12B10000', '제주도남부앞바다': '12B10000',
    '제주도앞바다': '12B10000', '제주도남쪽먼바다': '12B10000',
    '제주도남서쪽안쪽먼바다': '12B10000', '제주도남동쪽안쪽먼바다': '12B10000',
    '제주도남쪽바깥먼바다': '12B10000',
    // 남해동부
    '경남서부남해앞바다': '12B20000', '경남중부남해앞바다': '12B20000',
    '부산앞바다': '12B20000', '거제시동부앞바다': '12B20000',
    '남해동부앞바다': '12B20000', '남해동부먼바다': '12B20000',
    '남해동부안쪽먼바다': '12B20000', '남해동부바깥먼바다': '12B20000',
    // 동해남부
    '울산앞바다': '12C10000', '경북남부앞바다': '12C10000',
    '경북북부앞바다': '12C10000', '동해남부앞바다': '12C10000',
    '동해남부먼바다': '12C10000', '동해남부남쪽안쪽먼바다': '12C10000',
    '동해남부남쪽바깥먼바다': '12C10000', '동해남부북쪽안쪽먼바다': '12C10000',
    '동해남부북쪽바깥먼바다': '12C10000',
    // 동해중부
    '강원남부앞바다': '12C20000', '강원중부앞바다': '12C20000',
    '강원북부앞바다': '12C20000', '동해중부앞바다': '12C20000',
    '동해중부먼바다': '12C20000', '동해중부안쪽먼바다': '12C20000',
    '동해중부바깥먼바다': '12C20000',
    // 동해북부
    '동해북부앞바다': '12C30000', '동해북부먼바다': '12C30000'
};

// 중기해상예보 regId 찾기 (displayName 또는 원본 zoneName 모두 시도)
function getMidTermRegId(zoneName) {
    if (ZONE_NAME_TO_MID_TERM_REG_ID[zoneName]) return ZONE_NAME_TO_MID_TERM_REG_ID[zoneName];
    const displayName = ZONE_NAME_DISPLAY_MAP[zoneName] || zoneName;
    if (ZONE_NAME_TO_MID_TERM_REG_ID[displayName]) return ZONE_NAME_TO_MID_TERM_REG_ID[displayName];
    return null;
}

// 중기해상예보 날씨 텍스트 → 이모지 변환
const MID_TERM_WEATHER_EMOJI = {
    '맑음': '☀️',
    '구름많음': '⛅',
    '구름많고 비': '🌧️',
    '구름많고 눈': '🌨️',
    '구름많고 비/눈': '🌧️',
    '구름많고 소나기': '🌦️',
    '흐림': '☁️',
    '흐리고 비': '🌧️',
    '흐리고 눈': '🌨️',
    '흐리고 비/눈': '🌧️',
    '흐리고 소나기': '🌦️'
};

function midTermWeatherToEmoji(text) {
    if (!text || text === '-') return '-';
    return MID_TERM_WEATHER_EMOJI[text] || '❓';
}

// 중기해상예보 파고 범위 포맷 (A=최소, B=최대)
function formatMidTermWaveHeight(whA, whB) {
    if ((whA === undefined || whA === null) && (whB === undefined || whB === null)) return '-';
    const a = parseFloat(whA);
    const b = parseFloat(whB);
    if (isNaN(a) && isNaN(b)) return '-';
    if (isNaN(a)) return `${formatWaveHeight(b)}m`;
    if (isNaN(b)) return `${formatWaveHeight(a)}m`;
    if (a === b) return `${formatWaveHeight(a)}m`;
    return `${formatWaveHeight(a)}~${formatWaveHeight(b)}m`;
}

// 중기해상예보 데이터를 날짜별 오전/오후 배열로 변환
function parseMidTermSeaData(item, baseDate) {
    const days = [];
    // 4~7일: 오전/오후 분리
    // API 필드: wh{d}AAm/wh{d}BAm (오전 최소/최대), wh{d}APm/wh{d}BPm (오후 최소/최대)
    for (let d = 4; d <= 7; d++) {
        const date = new Date(baseDate);
        date.setDate(date.getDate() + d);
        days.push({
            date: date,
            dayOffset: d,
            am: {
                wh: formatMidTermWaveHeight(item[`wh${d}AAm`], item[`wh${d}BAm`]),
                wf: item[`wf${d}Am`] || '-'
            },
            pm: {
                wh: formatMidTermWaveHeight(item[`wh${d}APm`], item[`wh${d}BPm`]),
                wf: item[`wf${d}Pm`] || '-'
            }
        });
    }
    // 8~10일: 하루 단위 (오전/오후 동일 값)
    // API 필드: wh{d}A (최소), wh{d}B (최대)
    for (let d = 8; d <= 10; d++) {
        const date = new Date(baseDate);
        date.setDate(date.getDate() + d);
        const daily = {
            wh: formatMidTermWaveHeight(item[`wh${d}A`], item[`wh${d}B`]),
            wf: item[`wf${d}`] || '-'
        };
        days.push({
            date: date,
            dayOffset: d,
            am: daily,
            pm: daily
        });
    }
    return days;
}

// 구역명으로 API 코드 찾기 (개선된 버전)
function getZoneCodeByName(zoneName) {
    // 0. 매핑 테이블에서 먼저 찾기
    if (ZONE_NAME_TO_CODE[zoneName]) {
        return ZONE_NAME_TO_CODE[zoneName];
    }

    if (typeof SEA_ZONE_COORDINATES === 'undefined') return null;

    // 정규화 함수 (공백 제거, 특수문자 제거)
    const normalize = (str) => str.replace(/\s+/g, '').replace(/[·]/g, '');
    const normalizedInput = normalize(zoneName);

    // 1. 정확한 일치
    for (const [code, zone] of Object.entries(SEA_ZONE_COORDINATES)) {
        if (zone.name === zoneName) {
            return code;
        }
    }

    // 2. 정규화 후 일치
    for (const [code, zone] of Object.entries(SEA_ZONE_COORDINATES)) {
        if (normalize(zone.name) === normalizedInput) {
            return code;
        }
    }

    // 3. 부분 일치 (입력이 API 이름을 포함하거나, API 이름이 입력을 포함)
    for (const [code, zone] of Object.entries(SEA_ZONE_COORDINATES)) {
        const normalizedZone = normalize(zone.name);
        if (normalizedInput.includes(normalizedZone) || normalizedZone.includes(normalizedInput)) {
            return code;
        }
    }

    // 4. 해상 → 바다 변환 후 재시도
    const converted = zoneName.replace('해상', '바다');
    if (converted !== zoneName) {
        if (ZONE_NAME_TO_CODE[converted]) {
            return ZONE_NAME_TO_CODE[converted];
        }
        for (const [code, zone] of Object.entries(SEA_ZONE_COORDINATES)) {
            if (zone.name === converted || normalize(zone.name) === normalize(converted)) {
                return code;
            }
        }
    }

    console.warn('구역 코드를 찾을 수 없음:', zoneName);
    return null;
}

// 해상예보 팝업 모달 표시
async function showSeaForecastTable(zoneName) {
    // 매핑된 표시 이름 가져오기
    const displayName = ZONE_NAME_DISPLAY_MAP[zoneName] || zoneName;

    // 기존 모달이 있으면 제거
    const existingModal = document.getElementById('sea-forecast-modal');
    if (existingModal) {
        existingModal.remove();
    }

    // 모달 생성
    const modal = document.createElement('div');
    modal.id = 'sea-forecast-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
        padding: 20px;
        box-sizing: border-box;
        transition: background 0.3s ease;
    `;

    // 모달 컨텐츠
    const modalContent = document.createElement('div');
    modalContent.className = 'forecast-modal-content';
    modalContent.style.cssText = `
        background: linear-gradient(145deg, #1a1e2e, #232a3c);
        border-radius: 16px;
        max-width: 900px;
        width: 100%;
        max-height: 90vh;
        overflow: hidden;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        border: 1px solid rgba(255, 255, 255, 0.1);
        transform: scale(0.9) translateY(20px);
        opacity: 0;
        transition: transform 0.3s ease, opacity 0.3s ease;
    `;

    // 헤더
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px 24px;
        background: linear-gradient(135deg, #ffd54f, #ff9800);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    `;
    header.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;">
            <span style="font-size:1.5rem;">☀️</span>
            <div>
                <div style="font-size:1.1rem;font-weight:700;color:#1a1e2e;">${displayName}</div>
                <div style="font-size:0.85rem;color:rgba(0,0,0,0.6);">기상예보</div>
            </div>
        </div>
        <button id="close-forecast-modal" style="
            background: rgba(0,0,0,0.2);
            border: none;
            color: #1a1e2e;
            font-size: 1.5rem;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.2s;
        ">×</button>
    `;

    // 컨텐츠 영역
    const contentArea = document.createElement('div');
    contentArea.id = 'forecast-content-area';
    contentArea.style.cssText = `
        padding: 20px;
        overflow-x: auto;
    `;
    contentArea.innerHTML = `
        <div style="text-align:center;padding:40px;color:#8899aa;">
            <div style="width:40px;height:40px;border:3px solid #3a4459;border-top-color:#ffd54f;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 15px;"></div>
            <p>예보 데이터를 조회하고 있습니다...</p>
        </div>
        <style>
            @keyframes spin { to { transform: rotate(360deg); } }
        </style>
    `;

    modalContent.appendChild(header);
    modalContent.appendChild(contentArea);
    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // 열기 애니메이션
    requestAnimationFrame(() => {
        modal.style.background = 'rgba(0, 0, 0, 0.8)';
        modalContent.style.transform = 'scale(1) translateY(0)';
        modalContent.style.opacity = '1';
    });

    // 모달 닫기 함수
    const closeModal = () => {
        modal.style.background = 'rgba(0, 0, 0, 0)';
        modalContent.style.transform = 'scale(0.9) translateY(20px)';
        modalContent.style.opacity = '0';
        setTimeout(() => modal.remove(), 300);
        document.removeEventListener('keydown', escHandler);
    };

    // 닫기 버튼 이벤트
    document.getElementById('close-forecast-modal').onclick = closeModal;

    // 배경 클릭 시 닫기
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };

    // ESC 키로 닫기
    const escHandler = (e) => {
        if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', escHandler);

    // 먼바다 여부 확인
    const isFarSea = zoneName && zoneName.includes('먼바다');

    // 중기해상예보 데이터 병렬 조회
    const midTermRegId = getMidTermRegId(zoneName);
    let midTermData = null;
    let midTermTmFc = null;
    const midTermPromise = midTermRegId ? fetch('/api/mid-term-sea-forecasts').then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null);

    if (isFarSea) {
        // 먼바다: 해구별 기상전망 데이터로 예보 생성
        try {
            const zoneId = FAR_SEA_ZONE_ID_MAP[zoneName];
            if (!zoneId) {
                contentArea.innerHTML = `<div style="text-align:center;padding:30px;color:#ff9800;">⚠️ 해당 구역의 해구 정보를 찾을 수 없습니다.<br><small style="color:#666;">(${zoneName})</small></div>`;
                return;
            }

            const [response, midTermJson] = await Promise.all([
                fetch('/api/marine-zone-forecasts'),
                midTermPromise
            ]);
            if (!response.ok) throw new Error('해구별 기상전망 데이터 조회 실패');

            const json = await response.json();
            const zoneData = json.data && json.data[String(zoneId)];

            if (midTermJson && midTermJson.data && midTermRegId) {
                midTermData = midTermJson.data[midTermRegId];
                midTermTmFc = midTermJson.tmFc;
            }

            if (zoneData && zoneData.length > 0) {
                const baseTm = json.baseTmUtf;
                renderFarSeaForecastTable(contentArea, zoneData, displayName, baseTm, midTermData, midTermTmFc);
            } else {
                contentArea.innerHTML = `<div style="text-align:center;padding:30px;color:#ff9800;">⚠️ 해구(${zoneId}) 예보 데이터가 없습니다.<br><small style="color:#666;">스케줄러가 데이터를 수집할 때까지 기다려주세요.</small></div>`;
            }
        } catch (error) {
            contentArea.innerHTML = `<div style="text-align:center;padding:30px;color:#ef5350;">❌ 데이터 조회 중 오류가 발생했습니다.<br><small>${error.message}</small></div>`;
        }
    } else {
        // 앞바다: 기존 단기예보 API 데이터 사용
        const regId = getZoneCodeByName(zoneName);
        if (!regId) {
            contentArea.innerHTML = `<div style="text-align:center;padding:30px;color:#ff9800;">⚠️ 해당 구역의 예보 코드를 찾을 수 없습니다.<br><small style="color:#666;">(${zoneName})</small></div>`;
            return;
        }

        try {
            const [response, midTermJson] = await Promise.all([
                fetch('/api/forecasts'),
                midTermPromise
            ]);
            if (!response.ok) throw new Error('로컬 서버 응답 오류');

            const json = await response.json();
            const items = json.data && json.data[regId];

            if (midTermJson && midTermJson.data && midTermRegId) {
                midTermData = midTermJson.data[midTermRegId];
                midTermTmFc = midTermJson.tmFc;
            }

            if (items && items.length > 0) {
                const tmFc = json.tmFc || (items[0] && items[0].tmFc);
                renderSeaForecastTableInModal(contentArea, items, displayName, tmFc, midTermData, midTermTmFc);
            } else {
                contentArea.innerHTML = `<div style="text-align:center;padding:30px;color:#ff9800;">⚠️ 해당 구역(${regId})의 예보 데이터가 없습니다.<br><small style="color:#666;">스케줄러가 데이터를 수집할 때까지 기다려주세요.</small></div>`;
            }
        } catch (error) {
            contentArea.innerHTML = `<div style="text-align:center;padding:30px;color:#ef5350;">❌ 데이터 조회 중 오류가 발생했습니다.<br><small>${error.message}</small></div>`;
        }
    }
}



// 중기예보 발표시각 포맷 (YYYYMMDDHHMM → "M월 DD일 HH:MM")
function formatMidTermTmFc(tmFc) {
    if (!tmFc) return '';
    const s = String(tmFc);
    const month = parseInt(s.substring(4, 6));
    const day = s.substring(6, 8);
    const hour = s.substring(8, 10);
    const minute = s.substring(10, 12);
    return `${month}월 ${day}일 ${hour}:${minute}`;
}

// 단기예보 발표시각 포맷 (YYYYMMDDHHMM → "M월 DD일 HH:MM")
function formatShortTermTmFc(tmFc) {
    if (!tmFc) return '';
    const s = String(tmFc);
    const month = parseInt(s.substring(4, 6));
    const day = s.substring(6, 8);
    const hour = s.substring(8, 10);
    const minute = s.substring(10, 12);
    return `${month}월 ${day}일 ${hour}:${minute}`;
}

// 중기예보 셀 렌더링 헬퍼 (단기 테이블에 중기 컬럼 추가용)
// field: 'wf_icon' (날씨 이모지), 'wf_text' (예보 텍스트), 'wh' (파고), 'ws', 'wd'
function renderMidTermCell(midDay, period, field, tdStyle) {
    if (!midDay) return `<td style="${tdStyle}">-</td>`;
    const data = midDay[period];
    if (!data) return `<td style="${tdStyle}">-</td>`;

    if (field === 'wf_icon') {
        const wf = data.wf;
        if (!wf || wf === '-') return `<td style="${tdStyle}">-</td>`;
        const emoji = midTermWeatherToEmoji(wf);
        return `<td style="${tdStyle}"><span style="font-size:1.3rem">${emoji}</span></td>`;
    } else if (field === 'wf_text') {
        const wf = data.wf;
        if (!wf || wf === '-') return `<td style="${tdStyle}">-</td>`;
        return `<td style="${tdStyle}; font-size:0.75rem; color:#8899aa; white-space:normal; max-width:80px; line-height:1.3;">${wf}</td>`;
    } else if (field === 'wh') {
        const val = data.wh;
        if (!val || val === '-') return `<td style="${tdStyle}">-</td>`;
        return `<td style="${tdStyle}; color:#4db6ac; font-weight:600;">${val}</td>`;
    } else if (field === 'ws') {
        const val = data.ws;
        if (!val || val === '-') return `<td style="${tdStyle}">-</td>`;
        return `<td style="${tdStyle}; color:#ff9800; font-weight:600;">${val}</td>`;
    } else if (field === 'wd') {
        const val = data.wd;
        if (!val || val === '-') return `<td style="${tdStyle}">-</td>`;
        return `<td style="${tdStyle}">${val}</td>`;
    }
    return `<td style="${tdStyle}">-</td>`;
}

// 해상예보 테이블 렌더링 (모달용) - VilageFcstMsgService API 구조
function renderSeaForecastTableInModal(container, items, zoneName, tmFc = null, midTermData = null, midTermTmFc = null) {
    const today = new Date();
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

    // numEf를 날짜/시간으로 변환
    const forecasts = items.map(item => {
        const numEf = parseInt(item.numEf) || 0;
        const dayOffset = Math.floor(numEf / 2);
        const isAM = numEf % 2 === 1;

        const date = new Date(today);
        date.setDate(date.getDate() + dayOffset);

        return {
            ...item,
            date: date,
            dayOffset: dayOffset,
            period: isAM ? 'am' : 'pm'
        };
    });

    // 날짜별 그룹화
    const dateGroups = {};
    forecasts.forEach(f => {
        if (!dateGroups[f.dayOffset]) {
            dateGroups[f.dayOffset] = {
                date: f.date,
                am: null,
                pm: null
            };
        }
        dateGroups[f.dayOffset][f.period] = f;
    });

    const sortedDays = Object.keys(dateGroups).sort((a, b) => a - b).slice(0, 4);

    // 중기예보 데이터 파싱 (4일~10일)
    let midTermDays = [];
    if (midTermData && midTermTmFc) {
        const tmFcStr = String(midTermTmFc);
        const baseDate = new Date(
            parseInt(tmFcStr.substring(0, 4)),
            parseInt(tmFcStr.substring(4, 6)) - 1,
            parseInt(tmFcStr.substring(6, 8))
        );
        midTermDays = parseMidTermSeaData(midTermData, baseDate);
    }

    // 테이블 스타일 (컬럼 수에 따른 min-width 동적 계산)
    const totalDayCols = sortedDays.length + midTermDays.length;
    const tableMinWidth = 60 + totalDayCols * 120; // 라벨열 60px + 각 일자 120px(오전60+오후60)
    const tableStyle = `
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        font-size: 0.85rem;
        min-width: ${tableMinWidth}px;
    `;

    const thStyle = `
        padding: 10px 6px;
        text-align: center;
        background: #2a3347;
        color: #fff;
        font-weight: 600;
        border-bottom: 2px solid #4fc3f7;
    `;

    const tdStyle = `
        padding: 8px 6px;
        text-align: center;
        border-bottom: 1px solid #3a4459;
        color: #e0e6ed;
    `;

    const labelStyle = `
        background: #1e2433;
        text-align: left;
        padding-left: 12px;
        color: #4fc3f7;
        font-weight: 500;
        border-right: 1px solid #3a4459;
        width: 60px;
    `;

    // 중기 구분을 위한 스타일 (약간 어두운 배경)
    const midThStyle = `
        padding: 10px 6px;
        text-align: center;
        background: #232a3c;
        color: #fff;
        font-weight: 600;
        border-bottom: 2px solid #7c4dff;
    `;

    const midTdStyle = `
        padding: 8px 6px;
        text-align: center;
        border-bottom: 1px solid #3a4459;
        color: #c0c8d4;
    `;

    let html = `<table style="${tableStyle}">`;
    // colgroup으로 컬럼 폭 균등 지정
    html += `<colgroup><col style="width:60px;">`;
    for (let i = 0; i < totalDayCols * 2; i++) {
        html += `<col style="width:${Math.floor((tableMinWidth - 60) / (totalDayCols * 2))}px;">`;
    }
    html += `</colgroup>`;

    // 날짜 헤더 행
    html += `<tr>
        <th style="${thStyle}; ${labelStyle}">날짜</th>`;
    sortedDays.forEach((dayKey, idx) => {
        const d = dateGroups[dayKey].date;
        const dayLabels = ['오늘', '내일', '모레', ''];
        const label = dayLabels[idx] || '';
        const dateStr = `${d.getDate()}일(${dayNames[d.getDay()]})`;
        html += `<th colspan="2" style="${thStyle}">${dateStr}<br><small style="opacity:0.7">${label}</small></th>`;
    });
    midTermDays.forEach(mid => {
        const d = mid.date;
        const dateStr = `${d.getDate()}일(${dayNames[d.getDay()]})`;
        html += `<th colspan="2" style="${midThStyle}">${dateStr}</th>`;
    });
    html += `</tr>`;

    // 시간 헤더 행
    html += `<tr>
        <th style="${thStyle}; ${labelStyle}">시각</th>`;
    sortedDays.forEach(() => {
        html += `<th style="${thStyle}; font-size:0.8rem;">오전</th><th style="${thStyle}; font-size:0.8rem;">오후</th>`;
    });
    midTermDays.forEach(() => {
        html += `<th style="${midThStyle}; font-size:0.8rem;">오전</th><th style="${midThStyle}; font-size:0.8rem;">오후</th>`;
    });
    html += `</tr>`;

    // 날씨 행
    html += `<tr>
        <th style="${tdStyle}; ${labelStyle}">날씨</th>`;
    sortedDays.forEach(dayKey => {
        const group = dateGroups[dayKey];
        ['am', 'pm'].forEach(period => {
            const f = group[period];
            if (f) {
                const icon = SEA_WEATHER_CODES[f.wfCd] || '❓';
                html += `<td style="${tdStyle}"><span style="font-size:1.3rem">${icon}</span></td>`;
            } else {
                html += `<td style="${tdStyle}">-</td>`;
            }
        });
    });
    midTermDays.forEach(mid => {
        ['am', 'pm'].forEach(period => {
            html += renderMidTermCell(mid, period, 'wf_icon', midTdStyle);
        });
    });
    html += `</tr>`;

    // 파고 행
    html += `<tr>
        <th style="${tdStyle}; ${labelStyle}">파고<small style="display:block;font-size:0.7rem;color:#8899aa">(m)</small></th>`;
    sortedDays.forEach(dayKey => {
        const group = dateGroups[dayKey];
        ['am', 'pm'].forEach(period => {
            const f = group[period];
            if (f && f.wh1 !== undefined) {
                html += `<td style="${tdStyle}; color:#4db6ac; font-weight:600;">${f.wh1}~${f.wh2}m</td>`;
            } else {
                html += `<td style="${tdStyle}">-</td>`;
            }
        });
    });
    midTermDays.forEach(mid => {
        ['am', 'pm'].forEach(period => {
            html += renderMidTermCell(mid, period, 'wh', midTdStyle);
        });
    });
    html += `</tr>`;

    // 풍속 행
    html += `<tr>
        <th style="${tdStyle}; ${labelStyle}">풍속<small style="display:block;font-size:0.7rem;color:#8899aa">(m/s)</small></th>`;
    sortedDays.forEach(dayKey => {
        const group = dateGroups[dayKey];
        ['am', 'pm'].forEach(period => {
            const f = group[period];
            if (f && f.ws1 !== undefined) {
                html += `<td style="${tdStyle}; color:#ff9800; font-weight:600;">${f.ws1}~${f.ws2}m/s</td>`;
            } else {
                html += `<td style="${tdStyle}">-</td>`;
            }
        });
    });
    midTermDays.forEach(mid => {
        ['am', 'pm'].forEach(period => {
            html += renderMidTermCell(mid, period, 'ws', midTdStyle);
        });
    });
    html += `</tr>`;

    // 풍향 행
    html += `<tr>
        <th style="${tdStyle}; ${labelStyle}">풍향</th>`;
    sortedDays.forEach(dayKey => {
        const group = dateGroups[dayKey];
        ['am', 'pm'].forEach(period => {
            const f = group[period];
            if (f && f.wd1) {
                const wd1 = SEA_WIND_DIRS[f.wd1] || f.wd1;
                const wd2 = SEA_WIND_DIRS[f.wd2] || f.wd2;
                html += `<td style="${tdStyle}">${wd1}→${wd2}</td>`;
            } else {
                html += `<td style="${tdStyle}">-</td>`;
            }
        });
    });
    midTermDays.forEach(mid => {
        ['am', 'pm'].forEach(period => {
            html += renderMidTermCell(mid, period, 'wd', midTdStyle);
        });
    });
    html += `</tr>`;

    // 예보 행
    html += `<tr>
        <th style="${tdStyle}; ${labelStyle}">예보</th>`;
    sortedDays.forEach(dayKey => {
        const group = dateGroups[dayKey];
        ['am', 'pm'].forEach(period => {
            const f = group[period];
            if (f && f.wf) {
                html += `<td style="${tdStyle}; font-size:0.75rem; color:#8899aa; white-space:normal; max-width:80px; line-height:1.3;">${f.wf}</td>`;
            } else {
                html += `<td style="${tdStyle}">-</td>`;
            }
        });
    });
    midTermDays.forEach(mid => {
        ['am', 'pm'].forEach(period => {
            html += renderMidTermCell(mid, period, 'wf_text', midTdStyle);
        });
    });
    html += `</tr>`;

    html += `</table>`;

    // 발표시각 포맷팅 (단기 + 중기, 각각 별도 줄)
    let shortTermLine = '';
    let midTermLine = '';
    if (tmFc) {
        const shortTermText = formatShortTermTmFc(tmFc);
        shortTermLine = `단기예보(1일~3일) ${shortTermText} 발표`;
    }
    if (midTermTmFc) {
        const midText = formatMidTermTmFc(midTermTmFc);
        midTermLine = `중기예보(4일~10일) ${midText} 발표`;
    }

    // 테이블과 발표시각 표시
    container.innerHTML = `
        <div style="position:relative;">
            <div style="overflow-x:auto;">${html}</div>
            <div style="text-align:center; font-size:0.95rem; color:#ffffff; padding:10px 0 4px; font-weight:500;">☜ 밀어서 더 많은 정보를 확인하세요 ☞</div>
            ${(shortTermLine || midTermLine) ? `
                <div style="
                    text-align: right;
                    padding: 4px 5px 5px 5px;
                    font-size: 0.75rem;
                    color: #8899aa;
                    line-height: 1.8;
                ">${shortTermLine}${(shortTermLine && midTermLine) ? '<br>' : ''}${midTermLine}</div>
            ` : ''}
        </div>
    `;
}

// 먼바다 기상예보 테이블 렌더링 (해구별 기상전망 데이터 기반)
function renderFarSeaForecastTable(container, zoneData, zoneName, baseTmUtf, midTermData = null, midTermTmFc = null) {
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

    // UTC tm → KST로 변환하여 날짜별/시간대별 그룹화
    const dataByDate = {};
    zoneData.forEach(d => {
        const kst = tmToKstDate(d.tm);
        const dateKey = `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, '0')}${String(kst.getUTCDate()).padStart(2, '0')}`;
        const hour = kst.getUTCHours();

        if (!dataByDate[dateKey]) {
            dataByDate[dateKey] = {
                date: new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate())),
                am: [], pm: []
            };
        }

        if ([0, 3, 6, 9].includes(hour)) {
            dataByDate[dateKey].am.push({ ...d, kstHour: hour });
        } else if ([12, 15, 18, 21].includes(hour)) {
            dataByDate[dateKey].pm.push({ ...d, kstHour: hour });
        }
    });

    // 오늘(KST) 기준으로 4일치 선택
    const now = new Date();
    const kstNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + (9 * 3600000));
    const todayKey = `${kstNow.getFullYear()}${String(kstNow.getMonth() + 1).padStart(2, '0')}${String(kstNow.getDate()).padStart(2, '0')}`;
    const todayDate = new Date(Date.UTC(kstNow.getFullYear(), kstNow.getMonth(), kstNow.getDate()));

    const sortedDates = Object.keys(dataByDate).sort();
    let startIdx = sortedDates.indexOf(todayKey);
    if (startIdx < 0) {
        startIdx = sortedDates.findIndex(d => d >= todayKey);
        if (startIdx < 0) startIdx = 0;
    }
    const selectedDates = sortedDates.slice(startIdx, startIdx + 4);

    if (selectedDates.length === 0) {
        container.innerHTML = `<div style="text-align:center;padding:30px;color:#ff9800;">⚠️ 표시할 수 있는 예보 데이터가 없습니다.</div>`;
        return;
    }

    // 오전/오후 데이터 가공
    function processSlot(items) {
        if (!items || items.length === 0) return null;
        items.sort((a, b) => a.kstHour - b.kstHour);

        const whValues = items.map(i => i.wh).filter(v => !isNaN(v) && v !== null);
        const wsValues = items.map(i => i.ws).filter(v => !isNaN(v) && v !== null);

        if (whValues.length === 0 && wsValues.length === 0) return null;

        const whMin = Math.min(...whValues);
        const whMax = Math.max(...whValues);
        const wsMin = Math.round(Math.min(...wsValues));
        const wsMax = Math.round(Math.max(...wsValues));

        const firstDir = degreeToWindDir(items[0].windDir);
        const lastDir = degreeToWindDir(items[items.length - 1].windDir);
        const windDir = firstDir === lastDir ? firstDir : `${firstDir}→${lastDir}`;

        return {
            wh: whMin === whMax ? `${formatWaveHeight(whMin)}m` : `${formatWaveHeight(whMin)}~${formatWaveHeight(whMax)}m`,
            ws: wsMin === wsMax ? `${wsMin}m/s` : `${wsMin}~${wsMax}m/s`,
            windDir: windDir
        };
    }

    const processedDays = selectedDates.map(dateKey => ({
        dateKey,
        date: dataByDate[dateKey].date,
        am: processSlot(dataByDate[dateKey].am),
        pm: processSlot(dataByDate[dateKey].pm)
    }));

    // 중기예보 데이터 파싱 (4일~10일)
    let midTermDays = [];
    if (midTermData && midTermTmFc) {
        const tmFcStr = String(midTermTmFc);
        const baseDate = new Date(
            parseInt(tmFcStr.substring(0, 4)),
            parseInt(tmFcStr.substring(4, 6)) - 1,
            parseInt(tmFcStr.substring(6, 8))
        );
        midTermDays = parseMidTermSeaData(midTermData, baseDate);
    }

    // 테이블 렌더링 (앞바다와 동일한 스타일, 컬럼 수에 따른 min-width 동적 계산)
    const totalDayCols = processedDays.length + midTermDays.length;
    const tableMinWidth = 60 + totalDayCols * 120;
    const tableStyle = `width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 0.85rem; min-width: ${tableMinWidth}px;`;
    const thStyle = `padding: 10px 6px; text-align: center; background: #2a3347; color: #fff; font-weight: 600; border-bottom: 2px solid #4fc3f7;`;
    const tdStyle = `padding: 8px 6px; text-align: center; border-bottom: 1px solid #3a4459; color: #e0e6ed;`;
    const labelStyle = `background: #1e2433; text-align: left; padding-left: 12px; color: #4fc3f7; font-weight: 500; border-right: 1px solid #3a4459; width: 60px;`;

    // 중기 구분을 위한 스타일
    const midThStyle = `padding: 10px 6px; text-align: center; background: #232a3c; color: #fff; font-weight: 600; border-bottom: 2px solid #7c4dff;`;
    const midTdStyle = `padding: 8px 6px; text-align: center; border-bottom: 1px solid #3a4459; color: #c0c8d4;`;

    let html = `<table style="${tableStyle}">`;
    // colgroup으로 컬럼 폭 균등 지정
    html += `<colgroup><col style="width:60px;">`;
    for (let i = 0; i < totalDayCols * 2; i++) {
        html += `<col style="width:${Math.floor((tableMinWidth - 60) / (totalDayCols * 2))}px;">`;
    }
    html += `</colgroup>`;

    // 날짜 헤더 행
    html += `<tr><th style="${thStyle}; ${labelStyle}">날짜</th>`;
    processedDays.forEach(day => {
        const d = day.date;
        const dayOffset = Math.round((d.getTime() - todayDate.getTime()) / (24 * 3600000));
        const dayLabels = { 0: '오늘', 1: '내일', 2: '모레' };
        const label = dayLabels[dayOffset] || '';
        const dateStr = `${d.getUTCDate()}일(${dayNames[d.getUTCDay()]})`;
        html += `<th colspan="2" style="${thStyle}">${dateStr}<br><small style="opacity:0.7">${label}</small></th>`;
    });
    midTermDays.forEach(mid => {
        const d = mid.date;
        const dateStr = `${d.getDate()}일(${dayNames[d.getDay()]})`;
        html += `<th colspan="2" style="${midThStyle}">${dateStr}</th>`;
    });
    html += `</tr>`;

    // 시각 헤더 행
    html += `<tr><th style="${thStyle}; ${labelStyle}">시각</th>`;
    processedDays.forEach(() => {
        html += `<th style="${thStyle}; font-size:0.8rem;">오전</th><th style="${thStyle}; font-size:0.8rem;">오후</th>`;
    });
    midTermDays.forEach(() => {
        html += `<th style="${midThStyle}; font-size:0.8rem;">오전</th><th style="${midThStyle}; font-size:0.8rem;">오후</th>`;
    });
    html += `</tr>`;

    // 날씨 행 (먼바다 해구기상은 데이터 없음, 중기는 이모지 표시)
    html += `<tr><th style="${tdStyle}; ${labelStyle}">날씨</th>`;
    processedDays.forEach(() => {
        html += `<td style="${tdStyle}">-</td><td style="${tdStyle}">-</td>`;
    });
    midTermDays.forEach(mid => {
        ['am', 'pm'].forEach(period => {
            html += renderMidTermCell(mid, period, 'wf_icon', midTdStyle);
        });
    });
    html += `</tr>`;

    // 파고 행
    html += `<tr><th style="${tdStyle}; ${labelStyle}">파고<small style="display:block;font-size:0.7rem;color:#8899aa">(m)</small></th>`;
    processedDays.forEach(day => {
        ['am', 'pm'].forEach(period => {
            const d = day[period];
            html += d ? `<td style="${tdStyle}; color:#4db6ac; font-weight:600;">${d.wh}</td>` : `<td style="${tdStyle}">-</td>`;
        });
    });
    midTermDays.forEach(mid => {
        ['am', 'pm'].forEach(period => {
            html += renderMidTermCell(mid, period, 'wh', midTdStyle);
        });
    });
    html += `</tr>`;

    // 풍속 행
    html += `<tr><th style="${tdStyle}; ${labelStyle}">풍속<small style="display:block;font-size:0.7rem;color:#8899aa">(m/s)</small></th>`;
    processedDays.forEach(day => {
        ['am', 'pm'].forEach(period => {
            const d = day[period];
            html += d ? `<td style="${tdStyle}; color:#ff9800; font-weight:600;">${d.ws}</td>` : `<td style="${tdStyle}">-</td>`;
        });
    });
    midTermDays.forEach(mid => {
        ['am', 'pm'].forEach(period => {
            html += renderMidTermCell(mid, period, 'ws', midTdStyle);
        });
    });
    html += `</tr>`;

    // 풍향 행
    html += `<tr><th style="${tdStyle}; ${labelStyle}">풍향</th>`;
    processedDays.forEach(day => {
        ['am', 'pm'].forEach(period => {
            const d = day[period];
            html += d ? `<td style="${tdStyle}">${d.windDir}</td>` : `<td style="${tdStyle}">-</td>`;
        });
    });
    midTermDays.forEach(mid => {
        ['am', 'pm'].forEach(period => {
            html += renderMidTermCell(mid, period, 'wd', midTdStyle);
        });
    });
    html += `</tr>`;

    // 예보 행 (먼바다 해구기상은 데이터 없음, 중기는 날씨 텍스트 표시)
    html += `<tr><th style="${tdStyle}; ${labelStyle}">예보</th>`;
    processedDays.forEach(() => {
        html += `<td style="${tdStyle}">-</td><td style="${tdStyle}">-</td>`;
    });
    midTermDays.forEach(mid => {
        ['am', 'pm'].forEach(period => {
            html += renderMidTermCell(mid, period, 'wf_text', midTdStyle);
        });
    });
    html += `</tr>`;

    html += `</table>`;

    // 발표시각 포맷팅 (해구기상 + 중기, 각각 별도 줄)
    let shortTermLine = '';
    let midTermLine = '';
    if (baseTmUtf) {
        const baseKst = tmToKstDate(baseTmUtf);
        const month = baseKst.getUTCMonth() + 1;
        const day = String(baseKst.getUTCDate()).padStart(2, '0');
        const hour = String(baseKst.getUTCHours()).padStart(2, '0');
        shortTermLine = `해구기상정보(1일~3일) ${month}월 ${day}일 ${hour}:00 발표`;
    }
    if (midTermTmFc) {
        const midText = formatMidTermTmFc(midTermTmFc);
        midTermLine = `중기예보(4일~10일) ${midText} 발표`;
    }

    container.innerHTML = `
        <div style="position:relative;">
            <div style="overflow-x:auto;">${html}</div>
            <div style="text-align:center; font-size:0.95rem; color:#ffffff; padding:10px 0 4px; font-weight:500;">☜ 밀어서 더 많은 정보를 확인하세요 ☞</div>
            ${(shortTermLine || midTermLine) ? `
                <div style="
                    text-align: right;
                    padding: 4px 5px 5px 5px;
                    font-size: 0.75rem;
                    color: #8899aa;
                    line-height: 1.8;
                ">${shortTermLine}${(shortTermLine && midTermLine) ? '<br>' : ''}${midTermLine}</div>
            ` : ''}
        </div>
    `;
}

// 전역 함수로 등록
window.showSeaForecastTable = showSeaForecastTable;

// ===== 해구별 기상정보 이용안내 팝업 =====

/**
 * 해구별 기상정보 이용안내 팝업 표시
 */
function showSeaZoneInfoPopup() {
    // 기존 모달 있으면 제거
    const existing = document.getElementById('sea-zone-info-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'sea-zone-info-modal';
    modal.className = 'sea-zone-info-modal';
    modal.innerHTML = `
        <div class="sea-zone-info-overlay" onclick="closeSeaZoneInfoPopup()"></div>
        <div class="sea-zone-info-content">
            <div class="sea-zone-info-header">
                <h3><i class="fa-solid fa-circle-info"></i> 이용안내</h3>
                <button class="sea-zone-info-close" onclick="closeSeaZoneInfoPopup()" title="닫기">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="sea-zone-info-body">
                <div class="info-section">
                    <div class="info-section-title">
                        <i class="fa-solid fa-database"></i> 제공정보 (기상청 API)
                    </div>
                    <ul class="info-list">
                        <li>각 대해구･소해구별 기상전망 (매일 00시, 12시 발표)</li>
                        <li>각 부이별 관측 데이터 (매시간 발표)</li>
                    </ul>
                </div>
                <div class="info-section">
                    <div class="info-section-title">
                        <i class="fa-solid fa-triangle-exclamation"></i> 유의사항
                    </div>
                    <ul class="info-list">
                        <li>경위도 오차 가능성 고려 항해용도 사용불가</li>
                        <li>각 특보구역 및 부이는 대략적 위치로 표출</li>
                        <li>연안바다 및 평수구역의 위치정보 미표출</li>
                    </ul>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // 애니메이션을 위해 약간의 딜레이 후 show 클래스 추가
    requestAnimationFrame(() => {
        modal.classList.add('show');
    });
}

/**
 * 해구별 기상정보 이용안내 팝업 닫기
 */
function closeSeaZoneInfoPopup() {
    const modal = document.getElementById('sea-zone-info-modal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => modal.remove(), 300);
    }
}

// 전역 함수로 등록
window.showSeaZoneInfoPopup = showSeaZoneInfoPopup;
window.closeSeaZoneInfoPopup = closeSeaZoneInfoPopup;

// ===== 해역별 특보 현황 이용안내 팝업 =====

/**
 * 해역별 특보 현황 이용안내 팝업 표시
 */
function showWeatherAlertInfoPopup() {
    // 기존 모달 있으면 제거
    const existing = document.getElementById('weather-alert-info-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'weather-alert-info-modal';
    modal.className = 'sea-zone-info-modal';
    modal.innerHTML = `
        <div class="sea-zone-info-overlay" onclick="closeWeatherAlertInfoPopup()"></div>
        <div class="sea-zone-info-content">
            <div class="sea-zone-info-header">
                <h3><i class="fa-solid fa-circle-info"></i> 이용안내</h3>
                <button class="sea-zone-info-close" onclick="closeWeatherAlertInfoPopup()" title="닫기">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="sea-zone-info-body">
                <div class="info-section">
                    <div class="info-section-title">
                        <i class="fa-solid fa-database"></i> 제공정보 (기상청 API 등)
                    </div>
                    <ul class="info-list">
                        <li>각 해역 특보구역별 특보(태풍, 풍랑, 폭풍해일, 지진해일) 현황 및 변경사항</li>
                        <li>특보구역 내 위치 중인 부이의 관측 데이터 (매시간 발표)</li>
                        <li>앞바다의 기상예보 (05시, 17시 발표)</li>
                        <li>해구별 기상전망</li>
                    </ul>
                </div>
                <div class="info-section">
                    <div class="info-section-title">
                        <i class="fa-solid fa-triangle-exclamation"></i> 유의사항
                    </div>
                    <ul class="info-list">
                        <li>기상특보 : 기상청에서 발표하는 정보를 기반으로 제공하나, 기상청 홈페이지 기상정보 수시 확인 요망</li>
                        <li>출항 가능여부 등 판단 시 반드시 신고기관(파출소, 출장소 등)에 확인 요망</li>
                    </ul>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // 애니메이션을 위해 약간의 딜레이 후 show 클래스 추가
    requestAnimationFrame(() => {
        modal.classList.add('show');
    });
}

/**
 * 해역별 특보 현황 이용안내 팝업 닫기
 */
function closeWeatherAlertInfoPopup() {
    const modal = document.getElementById('weather-alert-info-modal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => modal.remove(), 300);
    }
}

// 전역 함수로 등록
window.showWeatherAlertInfoPopup = showWeatherAlertInfoPopup;
window.closeWeatherAlertInfoPopup = closeWeatherAlertInfoPopup;

// ===== 물 때 정보 이용안내 팝업 =====

/**
 * 물 때 정보 이용안내 팝업 표시
 */
function showTideInfoPopup() {
    // 기존 모달 있으면 제거
    const existing = document.getElementById('tide-info-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'tide-info-modal';
    modal.className = 'sea-zone-info-modal';
    modal.innerHTML = `
        <div class="sea-zone-info-overlay" onclick="closeTideInfoPopup()"></div>
        <div class="sea-zone-info-content">
            <div class="sea-zone-info-header">
                <h3><i class="fa-solid fa-circle-info"></i> 이용안내</h3>
                <button class="sea-zone-info-close" onclick="closeTideInfoPopup()" title="닫기">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="sea-zone-info-body">
                <div class="info-section">
                    <div class="info-section-title">
                        <i class="fa-solid fa-database"></i> 제공정보 (국립해양조사원 조석예보 API 기반)
                    </div>
                    <ul class="info-list">
                        <li>조석정보, 일출･몰, 월출･몰, 월령 및 밝기, 달 모양 정보</li>
                    </ul>
                </div>
                <div class="info-section">
                    <div class="info-section-title">
                        <i class="fa-solid fa-triangle-exclamation"></i> 유의사항
                    </div>
                    <div style="color: #cbd5e1; font-size: 0.9rem; line-height: 1.7; padding: 0 4px;">
                        <p style="margin: 0 0 12px 0;">국립해양조사원에서 제공하는 <strong style="color: #60a5fa;">TideBed</strong> 기반의 조석 예측정보를 제공합니다.</p>
                        <p style="margin: 0 0 8px 0; color: #94a3b8; font-size: 0.85rem;">TideBed의 조석 예측정보 제공 방식:</p>
                        <ol style="margin: 0 0 14px 0; padding-left: 20px; color: #cbd5e1;">
                            <li style="margin-bottom: 6px;">대한민국의 해역을 일정한 기준에 따라 다수의 격자로 나눔</li>
                            <li style="margin-bottom: 6px;">각 격자에 기준이 되는 표준항의 조석 관측소를 지정 <span style="color: #94a3b8;">(전국 166개)</span></li>
                            <li style="margin-bottom: 6px;">관측소의 관측 값에 격자의 위치에 따른 조고비, 조고시 등 요소를 반영 및 계산하여 조석 예측정보 산출</li>
                        </ol>
                        <p style="margin: 0; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08);">
                            <strong style="color: #fbbf24;">예측정보는 비교적 정확하나,</strong> <strong style="color: #ff5252;">실제와 오차가 있을 수 있으므로 정보 이용에 따른 책임을 지지 않습니다.</strong>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // 애니메이션을 위해 약간의 딜레이 후 show 클래스 추가
    requestAnimationFrame(() => {
        modal.classList.add('show');
    });
}

/**
 * 물 때 정보 이용안내 팝업 닫기
 */
function closeTideInfoPopup() {
    const modal = document.getElementById('tide-info-modal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => modal.remove(), 300);
    }
}

// 전역 함수로 등록
window.showTideInfoPopup = showTideInfoPopup;
window.closeTideInfoPopup = closeTideInfoPopup;

// [이동됨] handleHeaderRefresh → app_init.js
// [이동됨] updateTimeDisplay → app_init.js

