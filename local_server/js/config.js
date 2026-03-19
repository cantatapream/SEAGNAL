/**
 * ============================================================================
 * 파일명: js/config.js
 * 역할: 전역 설정(CONFIG), 해역 상수, 윈디 매핑, 해역 분류 체계
 * ============================================================================
 *
 * [설명]
 * 이 파일은 앱 전체에서 사용되는 설정값과 상수 데이터를 정의합니다.
 * - CONFIG: API 엔드포인트, CORS 설정, Mock 데이터 토글
 * - slideDown/slideUp: 아코디언 애니메이션 유틸리티
 * - BUOY_SVG_ICON: 부이 아이콘 SVG (인라인용)
 * - WINDY_URL_MAPPING: 44개 특보구역별 Windy 좌표 URL
 * - ZONE_COORDINATES: WINDY_URL_MAPPING에서 자동 추출한 위경도
 * - ZONE_CLASSIFICATION: 대분류 키워드 기반 해역 분류
 * - SEA_REGIONS: 대분류 → 중분류 2단계 해역 체계
 * - SUB_REGION_ZONES: 중분류 → 소분류(특보구역) 매핑
 * - getSubRegion(), getMainRegion(), getSeaArea(): 구역명 → 분류 변환 함수
 *
 * [로딩 순서] 1번째 (의존성 없음 - 다른 모든 모듈이 이 파일에 의존)
 * ============================================================================
 */

// Configuration
const CONFIG = {
    KMA_HUB_KEY: 'ZKEQU5ukRvGhEFObpBbxVw',

    // API 엔드포인트 (로컬 서버)
    API_BASE: '',  // 로컬 서버 기준 상대 경로 (빈 문자열)
    KMA_API_URL: 'api/warnings', // warnings.json (KMA + AFSO)
    BUOY_API_URL: 'api/buoys',   // buoys.json
    KMA_BUOY_API_URL: 'api/kma-buoys', // kma_buoys.json (최대/유의/평균 파고)
    NOTICE_API_URL: 'api/notice', // notice.json

    // CORS 프록시 설정 - 로컬 서버 사용으로 불필요
    USE_CORS_PROXY: false,
    CORS_PROXIES: [],
    CORS_PROXY: '',
    CORS_TIMEOUT: 5000,

    // 테스트 모드 - true로 설정하면 Mock 데이터 사용
    USE_MOCK_DATA: false
};

// ============================================================================
// 슬라이드 애니메이션 함수
// ============================================================================
function slideDown(element, duration = 300) {
    if (!element || element.style.display === 'block') return;

    element.style.display = 'block';
    element.style.overflow = 'hidden';
    const height = element.scrollHeight;
    element.style.height = '0';
    element.style.opacity = '0';
    element.style.transition = `height ${duration}ms ease, opacity ${duration}ms ease`;

    requestAnimationFrame(() => {
        element.style.height = height + 'px';
        element.style.opacity = '1';
    });

    setTimeout(() => {
        element.style.height = '';
        element.style.overflow = '';
        element.style.transition = '';
    }, duration);
}

function slideUp(element, duration = 300) {
    if (!element || element.style.display === 'none') return;

    element.style.overflow = 'hidden';
    element.style.height = element.scrollHeight + 'px';
    element.style.transition = `height ${duration}ms ease, opacity ${duration}ms ease`;

    requestAnimationFrame(() => {
        element.style.height = '0';
        element.style.opacity = '0';
    });

    setTimeout(() => {
        element.style.display = 'none';
        element.style.height = '';
        element.style.overflow = '';
        element.style.transition = '';
        element.style.opacity = '';
    }, duration);
}

/**
 * 부이 위치를 해구별 기상 지도에서 표시
 */
async function showBuoyLocationOnMap(buoyId) {
    // 부이 좌표 가져오기
    if (typeof BUOY_LOCATIONS === 'undefined' || !BUOY_LOCATIONS[buoyId]) {
        alert('부이 위치 정보를 찾을 수 없습니다.');
        return;
    }

    const buoyInfo = BUOY_LOCATIONS[buoyId];
    const lon = buoyInfo.lon;
    const lat = buoyInfo.lat;

    console.log(`📍 부이 ${buoyInfo.name} 위치: 경도 ${lon}, 위도 ${lat}`);

    // GPS → 픽셀 좌표 변환
    if (typeof gpsToPixel !== 'function') {
        alert('좌표 변환 함수를 사용할 수 없습니다.');
        return;
    }

    const pixel = gpsToPixel(lon, lat);
    console.log(`📍 픽셀 좌표: X=${pixel.x}, Y=${pixel.y}`);

    // 해구별 기상 탭으로 전환
    const seaZoneTab = document.querySelector('[data-target="sea-zone-section"]');
    if (seaZoneTab) {
        seaZoneTab.click();
    }

    // 탭 전환 대기
    await new Promise(r => setTimeout(r, 300));

    // ⭐ 지도가 초기화되지 않았으면 초기화 후 대기
    if (typeof window.initSeaZoneMap === 'function' && !document.getElementById('map-wrapper')) {
        console.log('📍 지도 초기화 중...');
        window.initSeaZoneMap();
        // 이미지 로드 대기 (최대 2초)
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 100));
            if (document.getElementById('map-wrapper')?.style.opacity === '1') break;
        }
    }

    // 추가 대기 (지도 렌더링 완료)
    await new Promise(r => setTimeout(r, 200));

    // ⭐ 부드러운 애니메이션으로 줌 및 이동
    if (typeof zoomToPixelWithMarkerAnimated === 'function') {
        zoomToPixelWithMarkerAnimated(pixel.x, pixel.y, 4.5, buoyId, buoyInfo.name);
    } else if (typeof zoomToPixelWithMarker === 'function') {
        // 기존 방식 (애니메이션 없이)
        zoomToPixelWithMarker(pixel.x, pixel.y, false, 4.5);
        // 부이 아이콘에 파란 글로우 효과 표시
        setTimeout(() => {
            showBlinkingMarker(pixel.x, pixel.y, buoyInfo.name, buoyId);
        }, 500);
    }
}

/**
 * 부이 아이콘 주변에 파란 글로우 효과 (전역 변수 상태 관리)
 */
function showBlinkingMarker(pixelX, pixelY, name, buoyId) {
    // CSS 애니메이션 스타일 추가
    if (!document.getElementById('buoy-highlight-style')) {
        const style = document.createElement('style');
        style.id = 'buoy-highlight-style';
        style.textContent = `
            .buoy-marker.highlighted {
                z-index: 2000 !important; /* 항상 맨 위 */
                animation: buoyBounce 1s ease-in-out infinite; /* 콩콩 뛰는 효과 */
            }

            @keyframes buoyBounce {
                0%, 100% { 
                    transform: translate(-50%, -100%) scale(1); 
                }
                50% { 
                    transform: translate(-50%, -100%) scale(1.6); /* 1.6배 확대 */
                }
            }
        `;
        document.head.appendChild(style);
    }

    // 전역 상태 설정
    window.highlightedBuoyId = buoyId;
    console.log(`📍 부이 하이라이트 설정: ${buoyId}`);

    // 즉시 업데이트하여 클래스 적용
    if (typeof updateBuoyVisibility === 'function') {
        updateBuoyVisibility();
    }

    // 5초 후 하이라이트 제거
    setTimeout(() => {
        if (window.highlightedBuoyId === buoyId) {
            window.highlightedBuoyId = null;
            if (typeof updateBuoyVisibility === 'function') {
                updateBuoyVisibility();
            }
        }
    }, 5000);
}

window.showBuoyLocationOnMap = showBuoyLocationOnMap;

// ============================================================================
// 특보구역별 윈디 URL 매핑
// ============================================================================
// 부이 SVG 아이콘 (seaZones.js와 동일한 디자인, 인라인용)
const BUOY_SVG_ICON = `
<svg width="18" height="22" viewBox="15 0 70 100" xmlns="http://www.w3.org/2000/svg" style="vertical-align: -6px; margin-right: -2px;">
    <g>
        <path d="M20 70 Q 50 85 80 70 L 80 60 L 20 60 Z" fill="#FDD835" stroke="#000" stroke-width="3"/>
        <ellipse cx="50" cy="60" rx="30" ry="10" fill="#FFEB3B" stroke="#000" stroke-width="2"/>
        <rect x="45" y="30" width="10" height="30" fill="#FBC02D" stroke="#000" stroke-width="2"/>
        <rect x="40" y="30" width="20" height="5" fill="#F57F17" stroke="#000" stroke-width="2"/>
        <circle cx="50" cy="25" r="5" fill="#F44336" stroke="#000" stroke-width="2"/>
        <path d="M50 25 L 60 15 M 50 25 L 40 15" stroke="#000" stroke-width="2"/>
        <rect x="25" y="50" width="12" height="8" fill="#1E88E5" stroke="#000" stroke-width="1" transform="rotate(-10 25 50)"/>
        <rect x="63" y="50" width="12" height="8" fill="#1E88E5" stroke="#000" stroke-width="1" transform="rotate(10 63 50)"/>
    </g>
</svg>`;

const WINDY_URL_MAPPING = {
    // 제주도 (7개)
    '제주도서부앞바다': 'https://www.windy.com/?33.290,126.080,10',
    '제주도북부앞바다': 'https://www.windy.com/?33.630,126.480,10',
    '제주도동부앞바다': 'https://www.windy.com/?33.520,127.020,10',
    '제주도남부앞바다': 'https://www.windy.com/?33.180,126.580,10',
    '제주도남서쪽안쪽먼바다': 'https://www.windy.com/?32.960,125.600,8',
    '제주도남동쪽안쪽먼바다': 'https://www.windy.com/?32.750,127.050,8',
    '제주도남쪽바깥먼바다': 'https://www.windy.com/?31.570,125.210,8',

    // 서해중부 (6개)
    '인천·경기북부앞바다': 'https://www.windy.com/?37.830,125.540,10',
    '인천·경기남부앞바다': 'https://www.windy.com/?37.350,125.970,10',
    '충남북부앞바다': 'https://www.windy.com/?36.730,126.050,10',
    '충남남부앞바다': 'https://www.windy.com/?36.200,126.370,10',
    '서해중부안쪽먼바다': 'https://www.windy.com/?36.880,125.240,8',
    '서해중부바깥먼바다': 'https://www.windy.com/?36.910,123.750,8',

    // 서해남부 (9개)
    '서해남부북쪽바깥먼바다': 'https://www.windy.com/?35.810,123.690,8',
    '서해남부북쪽안쪽먼바다': 'https://www.windy.com/?35.700,125.270,8',
    '전북북부앞바다': 'https://www.windy.com/?36.030,126.480,10',
    '전북남부앞바다': 'https://www.windy.com/?35.760,126.340,10',
    '전남북부서해앞바다': 'https://www.windy.com/?35.500,126.200,10',
    '전남중부서해앞바다': 'https://www.windy.com/?35.040,126.070,10',
    '서해남부남쪽바깥먼바다': 'https://www.windy.com/?33.950,123.560,8',
    '서해남부남쪽안쪽먼바다': 'https://www.windy.com/?34.560,125.110,8',
    '전남남부서해앞바다': 'https://www.windy.com/?34.870,126.250,10',

    // 남해서부 (4개)
    '남해서부서쪽먼바다': 'https://www.windy.com/?34.080,126.250,8',
    '전남서부남해앞바다': 'https://www.windy.com/?34.300,126.760,10',
    '전남동부남해앞바다': 'https://www.windy.com/?34.500,127.460,10',
    '남해서부동쪽먼바다': 'https://www.windy.com/?34.300,127.580,8',

    // 남해동부 (7개)
    '남해동부안쪽먼바다': 'https://www.windy.com/?34.080,128.900,8',
    '경남서부남해앞바다': 'https://www.windy.com/?34.580,128.170,10',
    '거제시동부앞바다': 'https://www.windy.com/?35.000,128.700,10',
    '경남중부남해앞바다': 'https://www.windy.com/?35.100,128.580,10',
    '부산앞바다': 'https://www.windy.com/?35.100,129.080,10',
    '울산앞바다': 'https://www.windy.com/?35.780,129.460,10',
    '남해동부바깥먼바다': 'https://www.windy.com/?33.200,130.540,8',

    // 동해남부 (6개)
    '동해남부남쪽안쪽먼바다': 'https://www.windy.com/?35.410,130.250,8',
    '동해남부남쪽바깥먼바다': 'https://www.windy.com/?34.500,131.270,8',
    '경북남부앞바다': 'https://www.windy.com/?36.000,129.620,10',
    '경북북부앞바다': 'https://www.windy.com/?36.750,129.520,10',
    '동해남부북쪽안쪽먼바다': 'https://www.windy.com/?36.160,130.410,8',
    '동해남부북쪽바깥먼바다': 'https://www.windy.com/?36.140,131.570,8',

    // 동해중부 (5개)
    '강원남부앞바다': 'https://www.windy.com/?37.390,129.360,10',
    '강원중부앞바다': 'https://www.windy.com/?37.790,129.070,10',
    '강원북부앞바다': 'https://www.windy.com/?38.360,128.660,10',
    '동해중부안쪽먼바다': 'https://www.windy.com/?37.960,129.870,8',
    '동해중부바깥먼바다': 'https://www.windy.com/?38.080,131.340,8'
};

// WINDY_URL_MAPPING에서 소해구별 좌표 자동 추출
const ZONE_COORDINATES = {};
for (const [zoneName, url] of Object.entries(WINDY_URL_MAPPING)) {
    const match = url.match(/\?(\d+\.?\d*),(\d+\.?\d*),/);
    if (match) {
        ZONE_COORDINATES[zoneName] = {
            lat: parseFloat(match[1]),
            lon: parseFloat(match[2])
        };
    }
}

// Windy 임베드 URL 생성 함수
function getWindyEmbedUrl(zoneName) {
    const url = WINDY_URL_MAPPING[zoneName];
    if (!url) return null;

    // URL에서 좌표와 줌 추출: https://www.windy.com/?lat,lon,zoom
    const match = url.match(/\?(\d+\.?\d*),(\d+\.?\d*),(\d+)/);
    if (!match) return null;

    const [, lat, lon, zoom] = match;
    return `https://embed.windy.com/embed2.html?lat=${lat}&lon=${lon}&zoom=${zoom}&level=surface&overlay=wind&product=ecmwf&menu=&message=true&marker=&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=m%2Fs&metricTemp=%C2%B0C&radarRange=-1`;
}
// ----------------------------------------------------------------------------
// Constants & Mappings
// ----------------------------------------------------------------------------

// 해역 분류 키워드 (기존 호환용 - 대분류 매칭)
const ZONE_CLASSIFICATION = {
    '동해': [
        '동해', '울릉도', '독도',
        '강원북부', '강원중부', '강원남부',  // 강원 앞바다
        '경북북부', '경북남부',  // 경북 앞바다
        '울산'  // 울산앞바다
    ],
    '서해': [
        '서해',
        '인천', '경기',  // 인천·경기 앞바다
        '충남',  // 충남북부/남부앞바다
        '전북',  // 전북북부/남부앞바다
        '전남북부서해', '전남중부서해', '전남남부서해'  // 전남 서해쪽
    ],
    '남해': [
        '남해',
        '부산', '거제', '경남',  // 부산, 거제, 경남 앞바다
        '전남서부남해', '전남동부남해'  // 전남 남해쪽
    ],
    '제주': [
        '제주', '추자도', '마라도', '가파도', '우도'
    ]
};

// ============================================================================
// 2단계 해역 분류 체계 (대분류 → 중분류 → 해역)
// ============================================================================

// 대분류 → 중분류 매핑
const SEA_REGIONS = {
    '동해': {
        subRegions: ['동해남부해상', '동해중부해상'],
        icon: '🌅',
        displayName: '동해 해역'
    },
    '서해': {
        subRegions: ['서해중부해상', '서해남부해상'],
        icon: '🌊',
        displayName: '서해 해역'
    },
    '남해': {
        subRegions: ['남해동부해상', '남해서부해상'],
        icon: '🏖️',
        displayName: '남해 해역'
    },
    '제주': {
        subRegions: ['제주해역'],
        icon: '🍊',
        displayName: '제주 해역'
    }
};

// 중분류 → 해역 목록 (메인 해역만, 연안바다/평수구역 제외)
const SUB_REGION_ZONES = {
    '동해남부해상': [
        '울산앞바다',
        '경북남부앞바다',
        '경북북부앞바다',
        '동해남부남쪽안쪽먼바다',
        '동해남부남쪽바깥먼바다',
        '동해남부북쪽안쪽먼바다',
        '동해남부북쪽바깥먼바다'
    ],
    '동해중부해상': [
        '강원북부앞바다',
        '강원중부앞바다',
        '강원남부앞바다',
        '동해중부안쪽먼바다',
        '동해중부바깥먼바다'
    ],
    '서해중부해상': [
        '인천·경기북부앞바다',
        '인천·경기남부앞바다',
        '충남북부앞바다',
        '충남남부앞바다',
        '서해중부안쪽먼바다',
        '서해중부바깥먼바다'
    ],
    '서해남부해상': [
        '전북북부앞바다',
        '전북남부앞바다',
        '전남북부서해앞바다',
        '전남중부서해앞바다',
        '전남남부서해앞바다',
        '서해남부북쪽안쪽먼바다',
        '서해남부북쪽바깥먼바다',
        '서해남부남쪽안쪽먼바다',
        '서해남부남쪽바깥먼바다'
    ],
    '남해동부해상': [
        '부산앞바다',
        '경남서부남해앞바다',
        '경남중부남해앞바다',
        '거제시동부앞바다',
        '남해동부안쪽먼바다',
        '남해동부바깥먼바다'
    ],
    '남해서부해상': [
        '전남서부남해앞바다',
        '전남동부남해앞바다',
        '남해서부서쪽먼바다',
        '남해서부동쪽먼바다'
    ],
    '제주해역': [
        '제주도북부앞바다',
        '제주도남부앞바다',
        '제주도동부앞바다',
        '제주도서부앞바다',
        '제주도남서쪽안쪽먼바다',
        '제주도남동쪽안쪽먼바다',
        '제주도남쪽바깥먼바다'
    ]
};

// 특보 구역명 → 중분류 찾기
function getSubRegion(zoneName) {
    if (!zoneName) return null;

    // 연안바다/평수구역은 상위 해역으로 처리 (중 앞부분만 추출)
    const cleanName = zoneName.replace(/중.*(연안바다|평수구역).*$/, '');

    for (const [subRegion, zones] of Object.entries(SUB_REGION_ZONES)) {
        if (zones.some(zone => cleanName.includes(zone) || zone.includes(cleanName) || cleanName === zone)) {
            return subRegion;
        }
    }

    // 키워드 기반 폴백 매칭
    if (zoneName.includes('울산') || zoneName.includes('경북') ||
        (zoneName.includes('동해') && (zoneName.includes('남부') || zoneName.includes('남쪽')))) {
        return '동해남부해상';
    }
    if (zoneName.includes('강원') || zoneName.includes('울릉') || zoneName.includes('독도') ||
        (zoneName.includes('동해') && (zoneName.includes('중부') || zoneName.includes('바깥')))) {
        return '동해중부해상';
    }
    if (zoneName.includes('인천') || zoneName.includes('경기') || zoneName.includes('충남') ||
        (zoneName.includes('서해') && zoneName.includes('중부'))) {
        return '서해중부해상';
    }
    if (zoneName.includes('전북') ||
        (zoneName.includes('전남') && zoneName.includes('서해')) ||
        (zoneName.includes('서해') && zoneName.includes('남부'))) {
        return '서해남부해상';
    }
    if (zoneName.includes('부산') || zoneName.includes('거제') || zoneName.includes('경남') ||
        (zoneName.includes('남해') && zoneName.includes('동부'))) {
        return '남해동부해상';
    }
    if ((zoneName.includes('전남') && zoneName.includes('남해')) ||
        (zoneName.includes('남해') && zoneName.includes('서부'))) {
        return '남해서부해상';
    }
    if (zoneName.includes('제주') || zoneName.includes('추자')) {
        return '제주해역';
    }

    return null;
}

// 중분류 → 대분류 찾기
function getMainRegion(subRegion) {
    for (const [main, data] of Object.entries(SEA_REGIONS)) {
        if (data.subRegions.includes(subRegion)) {
            return main;
        }
    }
    return '기타';
}

// 기존 호환용: 구역명 → 대분류 (동해/서해/남해/제주)
function getSeaArea(zoneName) {
    const subRegion = getSubRegion(zoneName);
    if (subRegion) {
        return getMainRegion(subRegion);
    }

    // 기존 ZONE_CLASSIFICATION 폴백
    for (const [sea, keywords] of Object.entries(ZONE_CLASSIFICATION)) {
        if (keywords.some(kw => zoneName.includes(kw))) {
            return sea;
        }
    }
    return '기타';
}

