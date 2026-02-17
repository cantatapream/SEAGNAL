// Configuration
const CONFIG = {
    KMA_HUB_KEY: 'ZKEQU5ukRvGhEFObpBbxVw',

    // API 엔드포인트 (로컬 서버)
    API_BASE: '',  // 로컬 서버 기준 상대 경로 (빈 문자열)
    KMA_API_URL: 'api/warnings', // warnings.json (KMA + AFSO)
    BUOY_API_URL: 'api/buoys',   // buoys.json
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
        english: 'East Sea'
    },
    '서해': {
        subRegions: ['서해중부해상', '서해남부해상'],
        icon: '🌊',
        english: 'West Sea'
    },
    '남해': {
        subRegions: ['남해동부해상', '남해서부해상'],
        icon: '🏖️',
        english: 'South Sea'
    },
    '제주': {
        subRegions: ['제주해역'],
        icon: '<img src="assets/dolhareubang_medium.png" style="width: 24px; vertical-align: bottom; margin-right: 2px;">',
        english: 'Jeju Sea',
        displayName: '제주해역'
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

// 연안바다/평수구역 매핑 (상위구역 → 하위구역)
const COASTAL_MAPPING = {
    // 🔵 동해남부 지역
    '울산앞바다': [
        { name: '평수구역', fullName: '울산앞바다중평수구역' },
        { name: '연안바다', fullName: '울산앞바다중연안바다' }
    ],
    '경북남부앞바다': [
        { name: '평수구역', fullName: '경북남부앞바다중평수구역' },
        { name: '연안바다', fullName: '경북남부앞바다중연안바다' }
    ],
    '경북북부앞바다': [
        { name: '연안바다', fullName: '경북북부앞바다중연안바다' }
    ],

    // 🔵 동해중부 지역
    '강원북부앞바다': [
        { name: '연안바다', fullName: '강원북부앞바다중연안바다' }
    ],
    '강원중부앞바다': [
        { name: '연안바다', fullName: '강원중부앞바다중연안바다' }
    ],
    '강원남부앞바다': [
        { name: '연안바다', fullName: '강원남부앞바다중연안바다' }
    ],
    '동해중부안쪽먼바다': [
        { name: '울릉읍연안바다', fullName: '울릉도울릉읍연안바다' },
        { name: '서면연안바다', fullName: '울릉도서면연안바다' },
        { name: '북면연안바다', fullName: '울릉도북면연안바다' }
    ],

    // 🔵 서해남부 지역
    '전북북부앞바다': [
        { name: '평수구역', fullName: '전북북부앞바다중평수구역' }
    ],
    '전북남부앞바다': [
        { name: '평수구역', fullName: '전북남부앞바다중평수구역' }
    ],
    '전남북부서해앞바다': [
        { name: '평수구역', fullName: '전남북부서해앞바다중평수구역' }
    ],
    '전남중부서해앞바다': [
        { name: '먼평수구역', fullName: '전남중부서해앞바다중먼평수구역' },
        { name: '앞평수구역', fullName: '전남중부서해앞바다중앞평수구역' }
    ],
    '전남남부서해앞바다': [
        { name: '평수구역', fullName: '전남남부서해앞바다중평수구역' }
    ],
    '서해남부남쪽안쪽먼바다': [
        { name: '조도부근평수구역', fullName: '서해남부남쪽안쪽먼바다중조도부근평수구역' }
    ],

    // 🔵 서해중부 지역
    '경기북부앞바다': [
        { name: '연안바다', fullName: '경기북부앞바다중연안바다' },
        { name: '평수구역', fullName: '경기북부앞바다중평수구역' }
    ],
    '인천·경기북부앞바다': [
        { name: '평수구역', fullName: '인천·경기북부앞바다중평수구역' }
    ],
    '인천·경기남부앞바다': [
        { name: '먼평수구역', fullName: '인천·경기남부앞바다중먼평수구역' },
        { name: '북부앞평수구역', fullName: '인천·경기남부앞바다중북부앞평수구역' },
        { name: '남부앞평수구역', fullName: '인천·경기남부앞바다중남부앞평수구역' }
    ],
    '충남북부앞바다': [
        { name: '천수만평수구역', fullName: '천수만평수구역' },
        { name: '안면도서쪽평수구역', fullName: '안면도서쪽평수구역' },
        { name: '당진평수구역', fullName: '당진평수구역' },
        { name: '태안·서산북쪽평수구역', fullName: '태안·서산북쪽평수구역' }
    ],
    '충남남부앞바다': [
        { name: '평수구역', fullName: '충남남부앞바다중평수구역' }
    ],

    // 🔵 남해동부 지역
    '부산앞바다': [
        { name: '동부평수구역', fullName: '부산앞바다중동부평수구역' },
        { name: '서부평수구역', fullName: '부산앞바다중서부평수구역' },
        { name: '연안바다', fullName: '부산앞바다중연안바다' }
    ],
    '경남서부남해앞바다': [
        { name: '동부평수구역', fullName: '경남서부남해앞바다중동부평수구역' },
        { name: '서부평수구역', fullName: '경남서부남해앞바다중서부평수구역' },
        { name: '남부평수구역', fullName: '경남서부남해앞바다중남부평수구역' },
        { name: '남해군연안바다', fullName: '경남서부남해앞바다중남해군연안바다' }
    ],
    '경남중부남해앞바다': [
        { name: '평수구역', fullName: '경남중부남해앞바다중평수구역' },
        { name: '연안바다', fullName: '경남중부남해앞바다중연안바다' }
    ],
    '거제시동부앞바다': [
        { name: '연안바다', fullName: '거제시동부앞바다중연안바다' }
    ],

    // 🔵 남해서부 지역
    '전남서부남해앞바다': [
        { name: '평수구역', fullName: '전남서부남해앞바다중평수구역' }
    ],
    '전남동부남해앞바다': [
        { name: '서부평수구역', fullName: '전남동부남해앞바다중서부평수구역' },
        { name: '동부평수구역', fullName: '전남동부남해앞바다중동부평수구역' }
    ],
    '남해서부서쪽먼바다': [
        { name: '추자도연안바다', fullName: '남해서부서쪽먼바다중추자도연안바다' }
    ],

    // 🔵 제주도 지역
    '제주도북부앞바다': [
        { name: '연안바다', fullName: '제주도북부앞바다중연안바다' }
    ],
    '제주도동부앞바다': [
        { name: '북동연안바다', fullName: '제주도동부앞바다중북동연안바다' },
        { name: '남동연안바다', fullName: '제주도동부앞바다중남동연안바다' },
        { name: '우도연안바다', fullName: '제주도동부앞바다중우도연안바다' }
    ],
    '제주도남부앞바다': [
        { name: '연안바다', fullName: '제주도남부앞바다중연안바다' }
    ],
    '제주도서부앞바다': [
        { name: '북서연안바다', fullName: '제주도서부앞바다중북서연안바다' },
        { name: '남서연안바다', fullName: '제주도서부앞바다중남서연안바다' },
        { name: '가파도연안바다', fullName: '제주도서부앞바다중가파도연안바다' }
    ]
};

// 부이 매핑 (특보구역 → 부이 목록)
// type: B=기상부이(풍속,온도,파고), C=파고부이(파고만), L=등표, F=연안방재, J=기상1호
const BUOY_MAPPING = {
    // === 서해 (West Sea) ===

    // 서해중부
    '인천·경기북부앞바다': [
        { id: '22525', name: '볼음도', type: 'C', lat: 37.61, lon: 126.13 },
        { id: '22496', name: '장봉도', type: 'C', lat: 37.49, lon: 126.35 },
        { id: '22522', name: '연평도', type: 'B', lat: 37.62, lon: 125.65 },
        { id: '955', name: '서수도', type: 'L', lat: 37.33, lon: 126.39 }
    ],
    '인천·경기남부앞바다': [
        { id: '22101', name: '덕적도', type: 'B', lat: 37.24, lon: 126.02 },
        { id: '22185', name: '인천', type: 'B', lat: 37.09, lon: 125.43 },
        { id: '22303', name: '풍도', type: 'B', lat: 37.16, lon: 126.41 },
        { id: '22461', name: '이작도', type: 'C', lat: 37.17, lon: 126.21 },
        { id: '22472', name: '자월도', type: 'C', lat: 37.30, lon: 126.16 },
        { id: '22509', name: '장안퇴', type: 'C', lat: 37.03, lon: 126.28 }
    ],
    '충남북부앞바다': [
        { id: '22444', name: '신진도', type: 'C', lat: 36.61, lon: 126.13 },
        { id: '22487', name: '천수만', type: 'C', lat: 36.47, lon: 126.44 },
        { id: '22488', name: '안면도', type: 'C', lat: 36.54, lon: 126.30 },
        { id: '22446', name: '내파수도', type: 'B', lat: 36.45, lon: 126.24 },
        { id: '956', name: '가대암', type: 'L', lat: 36.77, lon: 125.98 }
    ],
    '충남남부앞바다': [
        { id: '22108', name: '외연도', type: 'B', lat: 36.25, lon: 125.75 },
        { id: '22445', name: '삽시도', type: 'C', lat: 36.37, lon: 126.34 },
        { id: '22473', name: '서천', type: 'C', lat: 36.17, lon: 126.33 },
        { id: '22526', name: '녹도', type: 'C', lat: 36.26, lon: 126.21 }
    ],

    // 서해남부
    '전북북부앞바다': [
        { id: '22474', name: '군산', type: 'C', lat: 35.89, lon: 126.43 },
        { id: '22492', name: '비안도', type: 'C', lat: 35.74, lon: 126.35 },
        { id: '957', name: '십이동파', type: 'L', lat: 35.99, lon: 126.23 }
    ],
    '전북남부앞바다': [
        { id: '22186', name: '부안', type: 'B', lat: 35.66, lon: 125.81 },
        { id: '22497', name: '변산', type: 'C', lat: 35.66, lon: 126.46 },
        { id: '22504', name: '위도', type: 'C', lat: 35.66, lon: 126.26 },
        { id: '22510', name: '위도동부', type: 'B', lat: 35.64, lon: 126.36 },
        { id: '958', name: '갈매여', type: 'L', lat: 35.61, lon: 126.25 }
    ],
    '전남북부서해앞바다': [
        { id: '22475', name: '영광', type: 'C', lat: 35.44, lon: 126.18 },
        { id: '22494', name: '낙월', type: 'C', lat: 35.20, lon: 126.21 },
        { id: '22503', name: '불무도', type: 'C', lat: 34.32, lon: 126.17 }
    ],
    '전남중부서해앞바다': [
        { id: '22183', name: '신안', type: 'B', lat: 34.73, lon: 126.24 },
        { id: '22493', name: '자은', type: 'B', lat: 34.92, lon: 125.87 },
        { id: '22102', name: '칠발도', type: 'B', lat: 34.79, lon: 125.78 }
    ],
    '전남남부서해앞바다': [
        { id: '22500', name: '조도', type: 'C', lat: 34.29, lon: 126.11 },
        { id: '22481', name: '맹골수도', type: 'C', lat: 34.23, lon: 125.95 }
    ],

    // 서해 먼바다
    '서해중부안쪽먼바다': [
        { id: '22193', name: '서해143', type: 'B', lat: 37.00, lon: 124.50 }
    ],
    '서해중부바깥먼바다': [
        { id: '22191', name: '서해170', type: 'B', lat: 37.50, lon: 123.50 }
    ],
    '서해남부북쪽안쪽먼바다': [
        { id: '22489', name: '대치마도', type: 'B', lat: 35.02, lon: 126.03 },
        { id: '22299', name: '서해190', type: 'B', lat: 35.50, lon: 124.00 }
    ],
    '서해남부남쪽안쪽먼바다': [
        { id: '22297', name: '가거도', type: 'B', lat: 34.03, lon: 125.21 },
        { id: '22298', name: '홍도', type: 'B', lat: 34.75, lon: 125.25 },
        { id: '959', name: '해수서', type: 'L', lat: 34.26, lon: 126.03 }
    ],
    '서해남부남쪽바깥먼바다': [
        { id: '22192', name: '서해206', type: 'B', lat: 34.00, lon: 123.00 }
    ],

    // === 남해 (South Sea) ===

    '전남서부남해앞바다': [
        { id: '22477', name: '노화도', type: 'C', lat: 34.24, lon: 126.49 },
        { id: '22456', name: '청산도', type: 'C', lat: 34.14, lon: 126.74 }
    ],
    '전남동부남해앞바다': [
        { id: '22478', name: '고흥', type: 'C', lat: 34.38, lon: 127.18 },
        { id: '22466', name: '금오도', type: 'C', lat: 34.57, lon: 127.78 },
        { id: '22502', name: '나로도', type: 'C', lat: 34.43, lon: 127.59 },
        { id: '961', name: '간여암', type: 'L', lat: 34.29, lon: 127.86 }
    ],
    '경남서부남해앞바다': [
        { id: '22450', name: '두미도', type: 'C', lat: 34.71, lon: 128.15 },
        { id: '22501', name: '사량도', type: 'C', lat: 34.86, lon: 128.14 },
        { id: '22499', name: '연화도', type: 'C', lat: 34.67, lon: 128.37 },
        { id: '22498', name: '남해', type: 'C', lat: 34.70, lon: 127.99 }
    ],
    '경남중부남해앞바다': [
        { id: '22188', name: '통영', type: 'B', lat: 34.39, lon: 128.23 },
        { id: '22467', name: '한산도', type: 'C', lat: 34.71, lon: 128.50 }
    ],
    '거제시동부앞바다': [
        { id: '22104', name: '거제도', type: 'B', lat: 34.77, lon: 128.90 },
        { id: '22455', name: '해금강', type: 'C', lat: 34.74, lon: 128.69 },
        { id: '22512', name: '지심도', type: 'B', lat: 34.83, lon: 128.78 },
        { id: '22513', name: '이수도', type: 'B', lat: 34.97, lon: 128.76 },
        { id: '22484', name: '잠도', type: 'C', lat: 35.06, lon: 128.68 },
        { id: '22485', name: '소매물도', type: 'B', lat: 34.62, lon: 128.54 }
    ],
    '부산앞바다': [
        { id: '22460', name: '다대포', type: 'C', lat: 35.02, lon: 128.96 },
        { id: '22459', name: '오륙도', type: 'C', lat: 35.10, lon: 129.13 },
        { id: '22511', name: '기장', type: 'C', lat: 35.22, lon: 129.26 },
        { id: '984', name: '오륙도', type: 'L', lat: 35.09, lon: 129.13 }
    ],

    // 남해 먼바다
    '남해서부서쪽먼바다': [
        { id: '22184', name: '추자도', type: 'B', lat: 33.79, lon: 126.14 },
        { id: '22468', name: '추자도', type: 'C', lat: 33.97, lon: 126.28 }
    ],
    '남해서부동쪽먼바다': [
        { id: '22103', name: '거문도', type: 'B', lat: 34.00, lon: 127.50 },
        { id: '22507', name: '초도', type: 'C', lat: 34.15, lon: 127.22 },
        { id: '22309', name: '남해111', type: 'B', lat: 33.50, lon: 128.00 }
    ],
    '남해동부바깥먼바다': [
        { id: '22304', name: '남해244', type: 'B', lat: 33.50, lon: 129.50 }
    ],

    // === 제주도 (Jeju Sea) ===

    '제주도북부앞바다': [
        { id: '22457', name: '제주항', type: 'C', lat: 33.52, lon: 126.49 },
        { id: '22491', name: '김녕', type: 'C', lat: 33.58, lon: 126.76 },
        { id: '22514', name: '구엄', type: 'B', lat: 33.52, lon: 126.37 },
        { id: '22517', name: '하도', type: 'C', lat: 33.56, lon: 126.93 }
    ],
    '제주도서부앞바다': [
        { id: '22486', name: '협재', type: 'C', lat: 33.40, lon: 126.21 },
        { id: '22516', name: '신창', type: 'C', lat: 33.37, lon: 126.11 }
    ],
    '제주도동부앞바다': [
        { id: '22469', name: '우도', type: 'C', lat: 33.52, lon: 126.97 },
        { id: '22495', name: '신산', type: 'C', lat: 33.38, lon: 126.91 }
    ],
    '제주도남부앞바다': [
        { id: '22107', name: '마라도', type: 'B', lat: 33.08, lon: 126.03 },
        { id: '22458', name: '중문', type: 'C', lat: 33.23, lon: 126.39 },
        { id: '22515', name: '위미', type: 'C', lat: 33.22, lon: 126.71 },
        { id: '22187', name: '서귀포', type: 'B', lat: 33.13, lon: 127.02 },
        { id: '22505', name: '영락', type: 'C', lat: 33.24, lon: 126.19 },
        { id: '22476', name: '가파도', type: 'C', lat: 33.16, lon: 126.26 },
        { id: '960', name: '지귀도', type: 'L', lat: 33.22, lon: 126.65 },
        { id: '22003', name: '기상1호', type: 'J', lat: 33.23, lon: 126.57 }
    ],

    // 제주도 먼바다
    '제주도남서쪽안쪽먼바다': [
        { id: '22300', name: '남해239', type: 'B', lat: 32.50, lon: 125.50 }
    ],
    '제주도남쪽바깥먼바다': [
        { id: '22301', name: '남해465', type: 'B', lat: 31.50, lon: 127.00 }
    ],

    // === 동해 (East Sea) ===

    '울산앞바다': [
        { id: '22189', name: '울산', type: 'B', lat: 35.35, lon: 129.84 },
        { id: '22483', name: '간절곶', type: 'C', lat: 35.37, lon: 129.38 },
        { id: '22518', name: '당사', type: 'C', lat: 35.58, lon: 129.50 },
        { id: '963', name: '이덕서', type: 'L', lat: 35.57, lon: 129.48 }
    ],
    '경북남부앞바다': [
        { id: '22490', name: '월포', type: 'C', lat: 36.22, lon: 129.40 },
        { id: '22524', name: '구룡포', type: 'C', lat: 35.97, lon: 129.60 }
    ],
    '경북북부앞바다': [
        { id: '22465', name: '후포', type: 'C', lat: 36.72, lon: 129.49 }
    ],
    '강원남부앞바다': [
        { id: '22311', name: '삼척', type: 'B', lat: 37.46, lon: 129.32 },
        { id: '22479', name: '맹방', type: 'C', lat: 37.40, lon: 129.23 },
        { id: '22523', name: '죽변', type: 'B', lat: 37.10, lon: 129.46 }
    ],
    '강원중부앞바다': [
        { id: '22520', name: '강릉', type: 'B', lat: 37.80, lon: 129.06 },
        { id: '22451', name: '연곡', type: 'C', lat: 37.87, lon: 128.89 }
    ],
    '강원북부앞바다': [
        { id: '22310', name: '고성', type: 'B', lat: 38.32, lon: 128.64 },
        { id: '22471', name: '토성', type: 'C', lat: 38.28, lon: 128.58 }
    ],

    // 동해 먼바다
    '동해남부북쪽안쪽먼바다': [
        { id: '22106', name: '포항', type: 'B', lat: 36.35, lon: 129.78 },
        { id: '22190', name: '울진', type: 'B', lat: 36.91, lon: 129.87 },
        { id: '22302', name: '동해78', type: 'B', lat: 37.00, lon: 130.00 }
    ],
    '동해중부안쪽먼바다': [
        { id: '21229', name: '울릉도', type: 'B', lat: 37.46, lon: 131.11 },
        { id: '22105', name: '동해', type: 'B', lat: 37.54, lon: 130.00 },
        { id: '22464', name: '울릉읍', type: 'C', lat: 37.47, lon: 130.90 },
        { id: '22305', name: '동해57', type: 'B', lat: 38.37, lon: 129.60 },
        { id: '22442', name: '혈암', type: 'C', lat: 37.54, lon: 130.85 }
    ],
    '동해중부바깥먼바다': [
        { id: '22441', name: '독도', type: 'C', lat: 37.24, lon: 131.87 }
    ]
};


// 부이 타입 설명
const BUOY_TYPES = {
    'B': { name: '기상부이', measures: ['풍속', '기온', '파고'], icon: '🌊' },
    'C': { name: '파고부이', measures: ['파고'], icon: '📊' },
    'L': { name: '등표', measures: ['풍속', '기온'], icon: '🗼' },
    'F': { name: '연안방재', measures: ['풍속', '기온', '파고'], icon: '🏠' },
    'J': { name: '기상1호', measures: ['풍속', '기온', '파고', '기압'], icon: '🚢' }
};

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

    // 이미 한글 시간대가 포함되어 있으면 그대로 (위에서 변환된 값 포함)
    if (decoded.includes('새벽') || decoded.includes('아침') || decoded.includes('오전') ||
        decoded.includes('낮') || decoded.includes('오후') || decoded.includes('저녁') || decoded.includes('밤')) {
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

async function fetchAllData() {
    if (appState.isLoading) return;
    updateLoading(true);

    // [New] 방문객 카운트 업데이트
    updateVisitorStats();

    appState.apiStatus = { hub: 'loading', buoy: 'loading', coastal: 'loading' };
    updateApiStatusDisplay();

    // 초기화
    appState.coastalAlerts = {};
    appState.releasedCoastalZones = {};

    try {
        // 1. 부이 데이터 호출 (비동기 시작)
        const buoyPromise = fetchBuoyData();

        // 2. 특보 데이터 (crawler가 생성한 JSON 파일)
        const alertsResponse = await fetch('/api/weather-alerts?_t=' + Date.now());
        if (alertsResponse.ok) {
            const rootData = await alertsResponse.json();
            // JSON 계층 구조를 appState.alerts(평탄화된 배열)와 appState.coastalAlerts로 변환
            flattenAlertsData(rootData);
            appState.apiStatus.hub = 'success';
        } else {
            console.warn('Weather alerts fetch failed');
            appState.alerts = [];
            appState.apiStatus.hub = 'error';
        }

        appState.lastUpdated = new Date(); // 업데이트 시각 갱신

        // 3. 부이 데이터 대기
        const buoyData = await buoyPromise;
        appState.buoyData = buoyData || {};
        appState.apiStatus.buoy = Object.keys(appState.buoyData).length > 0 ? 'success' : 'warning';

        updateApiStatusDisplay();
        renderApp();
    } catch (error) {
        console.error('Critical Error in fetchAllData:', error);
        appState.hasApiError = true;
        updateApiStatusDisplay();
        renderApp();
    } finally {
        updateLoading(false);
    }
}






// --- Weather Alerts Processing Helper Functions ---

/**
 * weather_alerts.json 구조를 기존 UI 렌더링에 맞는 평탄화된 배열 구조로 변환
 * 데이터 깊이가 동적(제주는 3단계, 동해/서해/남해는 4단계)이므로 재귀적으로 탐색
 */
function flattenAlertsData(rootData) {
    const alerts = [];
    const coastalMap = {};
    const seas = rootData.current || {};
    // [Fix] 동일 zone 중복 처리 방지 (만약 JSON 구조에 중복 키가 존재하더라도 안전)
    const processedZones = new Set();

    // 재귀 탐색 함수
    function recursiveFind(obj) {
        for (const key in obj) {
            const val = obj[key];
            // 객체가 아니거나 null이면 패스
            if (!val || typeof val !== 'object') continue;

            // 'current' 또는 'upcoming' 키를 가지고 있다면 구역(Zone) 노드로 판단
            if (Object.prototype.hasOwnProperty.call(val, 'current') ||
                Object.prototype.hasOwnProperty.call(val, 'upcoming')) {

                const zoneName = key; // 키가 곧 구역명 (예: "울산앞바다", "제주도북부앞바다")
                const zoneData = val;

                // [Fix] 이미 처리한 zone은 건너뜀
                if (processedZones.has(zoneName)) continue;
                processedZones.add(zoneName);

                // 1. Current Alert (Active)
                if (zoneData.current) {
                    processSingleAlert(zoneName, zoneData.current, false, alerts, zoneData.children, coastalMap);
                }

                // 2. Upcoming Alert (Preliminary)
                if (zoneData.upcoming) {
                    processSingleAlert(zoneName, zoneData.upcoming, true, alerts, zoneData.children, coastalMap);
                }
            } else {
                // 구역 노드가 아니라면 하위로 더 탐색 (Grouping Node)
                recursiveFind(val);
            }
        }
    }

    // 탐색 시작
    recursiveFind(seas);

    appState.alerts = alerts;
    appState.coastalAlerts = coastalMap;
}

/**
 * 단일 특보 객체를 처리하고 연안바다 정보를 매핑
 */
function processSingleAlert(zoneName, alertObj, isUpcoming, alertsArr, childrenObj, coastalMap) {
    // alertObj 구조: { wrnTp, wrnLvl, tmFc, tmEf, tmYn }
    const displayLevel = transformLevel(alertObj.wrnLvl);

    // [핵심 수정] 시간 비교 로직 추가
    // tmEf(발효시각)를 파싱하여 현재 시각과 비교
    const now = getKfTime(); // YYYYMMDDHHmm 형식의 현재 시각
    const rawEf = (alertObj.tmEf || '').replace(/[^0-9]/g, ''); // 숫자만 추출

    // 미래 발효 여부 확인: 
    // 1. isUpcoming 파라미터가 true이면 무조건 예비/발표
    // 2. wrnLvl이 '예비'이면 무조건 예비
    // 3. tmEf가 유효하고(12자리), 현재 시각보다 미래이면 -> 아직 발효 전이므로 '발표(대기)' 상태로 취급
    let reallyUpcoming = isUpcoming || displayLevel === '예비';

    if (!reallyUpcoming && rawEf.length >= 12) {
        if (now < rawEf) {
            // 현재 시각이 발효 시각보다 작음 -> 미래 -> 예비(발표)로 취급
            reallyUpcoming = true;
        }
    }

    const alertItem = {
        zoneName: zoneName,
        regId: zoneName,
        warnType: alertObj.wrnTp,
        level: displayLevel === '예비' ? '주의보' : displayLevel,
        tmFc: alertObj.tmFc,
        tmEf: alertObj.tmEf,
        tmEd: alertObj.tmYn,
        command: reallyUpcoming ? '발표' : '발효', // 미래면 '발표', 지났으면 '발효'
        isPreliminary: reallyUpcoming,
        isCoastal: false,
        source: 'CRAWLER'
    };

    // 레벨 재조정: 화면 표시용
    if (displayLevel === '예비') {
        alertItem.level = '예비';
    }

    alertsArr.push(alertItem);

    // 연안바다(Children) 처리
    if (childrenObj) {
        for (const [childName, status] of Object.entries(childrenObj)) {
            // status가 'Y'인 경우 부모 특보 적용
            if (status === 'Y') {
                if (!coastalMap[childName]) coastalMap[childName] = [];
                // 부모 특보 정보를 상속받아 연안바다 특보 객체 생성
                const childAlert = {
                    ...alertItem,
                    zoneName: childName,
                    isCoastal: true,
                    parentZone: zoneName,
                    id: `auto_${childName}_${alertObj.wrnTp}_${reallyUpcoming ? 'pre' : 'act'}`
                };
                coastalMap[childName].push(childAlert);
            }
        }
    }
}

function transformLevel(lvl) {
    if (lvl === '주의') return '주의보';
    return lvl;
}


// --- BUOY API (해양관측 데이터) ---
async function fetchBuoyData() {
    // 로컬 서버 buoys.json 조회
    const url = CONFIG.BUOY_API_URL;

    // console.log('Fetching Buoy Data (Local):', url);

    try {
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const jsonData = await response.json();
        // buoys.json 구조: { updatedAt: ..., raw: "RAW TEXT" }
        const text = jsonData.raw || '';

        // console.log('Buoy Raw Response (first 500 chars):', text.substring(0, 500));
        // console.log('Buoys Updated At:', jsonData.updatedAt);

        const parsed = parseBuoyData(text);
        // console.log('Buoy Parsed:', Object.keys(parsed).length, 'stations');

        return parsed;
    } catch (e) {
        // console.warn(`Local Buoy Fetch failed:`, e.message);
        return getMockBuoyData();
    }

    return getMockBuoyData();
}

function parseBuoyData(text) {
    const lines = text.trim().split('\n');
    const buoyData = {};

    // console.log('Parsing buoy data, total lines:', lines.length);

    lines.forEach((line, idx) => {
        // 헤더/주석 라인 건너뛰기
        if (line.startsWith('#') || line.trim() === '') return;

        // 첫 몇 줄 디버깅
        if (idx < 3) {
            // console.log('Line', idx, ':', line.substring(0, 100));
        }

        // 공백으로 분리 (KMA API는 주로 공백 구분)
        const parts = line.split(/\s+/).map(p => p.trim()).filter(p => p);

        // sea_obs.php 응답 포맷:
        // TP, STN_ID, STN_KO, TM, WH, WD, WS, WS_GST, TW, TA, PA, HM
        if (parts.length < 6) return;

        try {
            // 실제 API 응답 형식 (콘솔에서 확인):
            // TP(0), TM(1), STN_ID(2), STN_KO(3), LON(4), LAT(5), WH(6), WD(7), WS(8), WS_GST(9), TW(10), TA(11), PA(12), HM(13)
            const tp = parts[0];
            const tm = parts[1];
            let stnId = parts[2].replace(/,/g, '').trim();  // 쉼표 제거!
            const stnName = parts[3] ? parts[3].replace(/,/g, '').trim() : stnId;

            // stnId 유효성 검사
            if (!stnId || stnId.length > 8 || stnId.length < 3) return;

            // -99는 결측값(관측 불가)이므로 null로 처리
            const parseValue = (val) => {
                const num = parseFloat(val);
                return (isNaN(num) || num <= -99) ? null : num;
            };

            // 올바른 인덱스 (LON=4, LAT=5 건너뛰고 WH=6부터)
            const wh = parseValue(parts[6]);      // 유의파고
            const wd = parseValue(parts[7]);      // 풍향
            const ws = parseValue(parts[8]);      // 풍속
            const wsGust = parseValue(parts[9]);  // 돌풍
            const tw = parseValue(parts[10]);     // 수온
            const ta = parseValue(parts[11]);     // 기온
            const pa = parseValue(parts[12]);     // 기압
            const hm = parseValue(parts[13]);     // 습도

            buoyData[stnId] = {
                id: stnId,
                name: stnName,
                tm: tm,
                waveHeight: wh,
                windDirection: wd,
                windSpeed: ws,
                windGust: wsGust,
                waterTemp: tw,
                airTemp: ta,
                pressure: pa,
                humidity: hm
            };

            // 처음 3개 파싱 결과 출력
            if (Object.keys(buoyData).length <= 3) {
                // console.log('✓ Parsed:', stnId, stnName, '파고:', wh, '풍속:', ws);
            }
        } catch (e) {
            // console.warn('Buoy parse error at line', idx, e);
        }
    });

    // console.log('Parsed buoy station IDs:', Object.keys(buoyData).slice(0, 10));

    return buoyData;
}

// 부이 데이터 없음 (API 실패 시)
function getMockBuoyData() {
    // console.log('Buoy API returned no data');
    return {};
}

// 풍향을 방위로 변환
function getWindDirectionText(degree) {
    if (degree === null || degree === undefined) return '-';
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
        'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const index = Math.round(degree / 22.5) % 16;
    return directions[index];
}


// 연안바다 및 제외 처리 함수 제거됨


// ----------------------------------------------------------------------------
// UI Rendering
// ----------------------------------------------------------------------------

// API 상태 표시 관리자 (롤링 대신 정적 표시)
const ApiStatusManager = {
    _injectStyles() {
        if (document.getElementById('api-status-styles')) return;
        const style = document.createElement('style');
        style.id = 'api-status-styles';
        style.textContent = `
            .api-status-wrapper {
                height: 24px;
                overflow: hidden;
                position: relative;
                margin-top: 5px;
                background: transparent;
                padding: 0;
                display: flex;
                align-items: center;
                border: none;
            }
            #api-rolling-list {
                list-style: none;
                padding: 0;
                margin: 0;
                width: 100%;
                height: 100%;
            }
            #api-rolling-list li {
                height: 24px;
                display: flex;
                align-items: center;
                justify-content: flex-start;
                gap: 6px;
                font-size: 0.85rem;
                color: #aaa;
                white-space: nowrap;
            }
            .status-update-time {
                color: #8ecfff;
            }
            .status-error {
                color: #ff5252;
                font-weight: 600;
            }
            .status-error i {
                margin-right: 4px;
            }
        `;
        document.head.appendChild(style);
    },

    update() {
        this._injectStyles();

        const list = document.getElementById('api-rolling-list');
        if (!list) return;

        // 에러 표시 로직 제거 (항상 시간 표시)
        const time = new Date(); // 항상 현재 시간 표시 (사용자 요청: 자동 업데이트 및 우측 시계와 동기화)
        const hours = time.getHours();
        const minutes = String(time.getMinutes()).padStart(2, '0');
        const ampm = hours < 12 ? '오전' : '오후';
        const displayHour = hours === 0 ? 12 : (hours > 12 ? hours - 12 : hours);

        const html = `<li><span class="status-update-time">최근 업데이트: ${ampm} ${displayHour}:${minutes}</span></li>`;

        list.innerHTML = html;
    }
};

function updateApiStatusDisplay() {
    ApiStatusManager.update();
}

// --- Accordion Logic ---
window.toggleMainAccordion = function () {
    const body = document.getElementById('main-accordion-body');
    const header = document.getElementById('main-accordion-header');
    if (body) body.classList.toggle('collapsed');
    if (header) header.classList.toggle('collapsed-state');
};

// --- 특보 정렬 함수 ---
// 정렬 우선순위: 1) 특보종류(태풍 > 지진해일 > 폭풍해일 > 풍랑), 2) 경보 > 주의보
// 3) 앞바다 > 먼바다, 4) 앞바다: 북부→남부→서부→동부, 5) 먼바다: 안쪽→바깥쪽
function sortAlertItems(items) {
    const TYPE_ORDER = { '태풍': 1, '지진해일': 2, '폭풍해일': 3, '풍랑': 4 };
    const DIRECTION_ORDER = { '북부': 1, '남부': 2, '서부': 3, '동부': 4 };
    const FAR_SEA_ORDER = { '안쪽': 1, '바깥': 2 };

    // 그룹화된 아이템(배열)인 경우 가장 높은 순위의 특보를 반환하는 헬퍼
    const getRepresentativeAlert = (item) => {
        if (!Array.isArray(item)) return item;
        if (item.length === 0) return null;

        // 그룹 내부 정렬 (가장 높은 우선순위가 0번으로)
        // [수정] 발효 중(Active) 알림이 발표 예정(Preliminary)보다 우선하도록 정렬
        const sorted = [...item].sort((a, b) => {
            // 0. 발효 상태 우선 (isPreliminary: false가 true보다 상단)
            // -> 현재 발효 중인 특보가 미래 발효 예정인 특보보다 먼저 표시되어야 함
            if (a.isPreliminary !== b.isPreliminary) {
                return a.isPreliminary ? 1 : -1; // active(false) first
            }

            const aTypeWeight = TYPE_ORDER[a.warnType] || 99;
            const bTypeWeight = TYPE_ORDER[b.warnType] || 99;
            if (aTypeWeight !== bTypeWeight) return aTypeWeight - bTypeWeight;

            if (a.level === '경보' && b.level !== '경보') return -1;
            if (a.level !== '경보' && b.level === '경보') return 1;

            return 0;
        });
        return sorted[0];
    };

    // 구역명에서 정렬 가중치 계산
    const getZoneSortWeight = (zoneName) => {
        if (!zoneName) return 9999;
        const isNearSea = zoneName.includes('앞바다');
        const isFarSea = zoneName.includes('먼바다');
        let seaTypeWeight = isNearSea ? 0 : (isFarSea ? 1000 : 500);

        let directionWeight = 99;
        for (const [dir, order] of Object.entries(DIRECTION_ORDER)) {
            if (zoneName.includes(dir)) {
                directionWeight = order;
                break;
            }
        }

        let farSeaWeight = 0;
        if (isFarSea) {
            if (zoneName.includes('안쪽')) farSeaWeight = 1;
            else if (zoneName.includes('바깥')) farSeaWeight = 2;
        }

        return seaTypeWeight + directionWeight * 10 + farSeaWeight;
    };

    const isWarning = (item) => {
        const rep = getRepresentativeAlert(item);
        return rep && rep.level === '경보';
    };

    return [...items].sort((a, b) => {
        const repA = getRepresentativeAlert(a);
        const repB = getRepresentativeAlert(b);

        if (!repA) return 1;
        if (!repB) return -1;

        // 0. [추가] 발효 상태 우선 (isPreliminary: false가 true보다 상단)
        // -> 현재 발효 중인 특보가 미래 발효 예정인 특보보다 먼저 표시되어야 함
        if (repA.isPreliminary !== repB.isPreliminary) {
            return repA.isPreliminary ? 1 : -1; // active(false) first
        }

        // 1. 특보 종류 우선순위 (태풍→지진해일→폭풍해일→풍랑)
        const aTypeWeight = TYPE_ORDER[repA.warnType] || 99;
        const bTypeWeight = TYPE_ORDER[repB.warnType] || 99;
        if (aTypeWeight !== bTypeWeight) {
            return aTypeWeight - bTypeWeight;
        }

        // 2. 경보가 주의보보다 상단
        const aIsWarning = isWarning(a);
        const bIsWarning = isWarning(b);
        if (aIsWarning && !bIsWarning) return -1;
        if (!aIsWarning && bIsWarning) return 1;

        // 3. 구역 정렬 (앞바다→먼바다, 방향순서)
        const aWeight = getZoneSortWeight(repA.zoneName);
        const bWeight = getZoneSortWeight(repB.zoneName);

        return aWeight - bWeight;
    });
}

function renderApp() {
    const seaSections = {
        '동해': document.getElementById('east-sea-list'),
        '서해': document.getElementById('west-sea-list'),
        '남해': document.getElementById('south-sea-list'),
        '제주': document.getElementById('jeju-sea-list')
    };

    const seaCounts = {
        '동해': document.getElementById('east-count'),
        '서해': document.getElementById('west-count'),
        '남해': document.getElementById('south-count'),
        '제주': document.getElementById('jeju-count')
    };

    // Clear content
    Object.values(seaSections).forEach(el => {
        if (el) el.innerHTML = '';
    });

    let counts = { '동해': 0, '서해': 0, '남해': 0, '제주': 0 };

    // Group by Sea (대분류) and SubRegion (중분류)
    const groups = {};        // 대분류별 그룹: { '동해': [[alert1, alert2], [alert3]], ... }
    const subGroups = {};     // 중분류별 그룹: { '동해남부해상': [[alert1, alert2]], ... }

    // [New] 동일 구역의 특보를 하나로 묶기
    const zoneAlertsMap = {};

    // 1. 메인 특보 데이터 기반으로 맵 구성
    appState.alerts.forEach(item => {
        if (item.isCoastal) return;
        if (typeof UserSettings !== 'undefined' && !UserSettings.isVisible(item.zoneName)) return;

        if (!zoneAlertsMap[item.zoneName]) {
            zoneAlertsMap[item.zoneName] = [];
        }
        zoneAlertsMap[item.zoneName].push(item);
    });

    // 2. [수정] 연안바다/평수구역 특보가 있는 경우, 해당 상위 구역(Parent)도 맵에 추가
    // (메인 특보가 없더라도 연안 특보를 보여주기 위해 카드를 생성해야 함)
    if (appState.coastalAlerts) {
        for (const [coastalName, alerts] of Object.entries(appState.coastalAlerts)) {
            if (alerts && alerts.length > 0) {
                // 이 연안구역이 속한 모든 상위 구역(Parent) 찾기
                for (const [parentName, subZones] of Object.entries(COASTAL_MAPPING)) {
                    // 공백 제거 및 부분 일치 비교 (KMA 데이터는 '평수구역'을 '평수구'로 줄여 보내는 경우가 많음)
                    const isMatch = subZones.some(sz => {
                        let szNorm = (sz.fullName || '').replace(/\s+/g, '');
                        let cNorm = coastalName.replace(/\s+/g, '');

                        // '평수구'로 끝나는 경우 '역'을 붙여서 비교 시도
                        if (cNorm.endsWith('평수구')) cNorm += '역';
                        if (szNorm.endsWith('평수구')) szNorm += '역';

                        return szNorm === cNorm || (szNorm.length > 5 && cNorm.length > 5 && (szNorm.startsWith(cNorm) || cNorm.startsWith(szNorm)));
                    });

                    if (isMatch) {
                        // 사용자가 설정에서 숨긴 구역은 건너뜀
                        if (typeof UserSettings !== 'undefined' && !UserSettings.isVisible(parentName)) continue;

                        if (!zoneAlertsMap[parentName]) {
                            // 메인 특보가 없는 경우 더미 객체 하나 추가 (구역명 보존 및 에러 방지용)
                            // dummy: true 속성을 통해 메인 특보가 없음을 createAlertElement에서 알 수 있음
                            zoneAlertsMap[parentName] = [{
                                zoneName: parentName,
                                isDummy: true,
                                // 기본값 설정
                                warnType: '',
                                level: '',
                                tmFc: '',
                                tmEf: '',
                                tmEd: ''
                            }];
                        }
                    }
                }
            }
        }
    }

    Object.keys(zoneAlertsMap).forEach(zoneName => {
        const items = zoneAlertsMap[zoneName];
        const subRegion = getSubRegion(zoneName) || '기타';
        const mainRegion = getMainRegion(subRegion);

        // 대분류 그룹에 배열(items) 추가
        if (!groups[mainRegion]) groups[mainRegion] = [];
        groups[mainRegion].push(items);

        // 중분류 그룹에 배열(items) 추가
        if (!subGroups[subRegion]) subGroups[subRegion] = [];
        subGroups[subRegion].push(items);
    });

    // console.log('Grouped items:', zoneAlertsMap);

    // Render with 2-level structure
    for (const [mainRegion, mainItems] of Object.entries(groups)) {
        if (!seaSections[mainRegion]) continue;

        const container = seaSections[mainRegion];

        // 해당 대분류의 중분류 목록
        const subRegionList = SEA_REGIONS[mainRegion]?.subRegions || [];

        // 제주는 중분류가 하나뿐이므로 서브헤더 없이 바로 렌더링
        if (mainRegion === '제주' || subRegionList.length <= 1) {
            // 정렬하여 렌더링
            const sortedItems = sortAlertItems(mainItems);
            sortedItems.forEach(item => {
                counts[mainRegion]++;
                container.appendChild(createAlertElement(item));
            });
        } else {
            // 중분류별로 서브 섹션 생성
            subRegionList.forEach(subRegion => {
                const subItems = subGroups[subRegion];
                if (!subItems || subItems.length === 0) return;

                // 서브 섹션 컨테이너
                const subSection = document.createElement('div');
                subSection.className = 'sub-region-section';
                subSection.style.marginBottom = '14px';

                // 서브 헤더 (중분류명) - 해역보다 작고, 특보구역보다 크게
                const subHeader = document.createElement('div');
                subHeader.className = 'sub-region-header';
                subHeader.style.cssText = `
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 14px 16px;
                    background: linear-gradient(135deg, rgba(30, 60, 114, 0.8), rgba(42, 82, 152, 0.6));
                    border-radius: 10px;
                    margin-bottom: 10px;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    border-left: 4px solid #4fc3f7;
                    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
                `;
                subHeader.innerHTML = `
                    <span style="font-size: 1.0rem; font-weight: 700; color: #fff;">${subRegion}</span>
                    <span style="background: rgba(255, 152, 0, 0.4); padding: 4px 12px; border-radius: 12px; font-size: 0.85rem; font-weight: 600; color: #ffd54f; margin-left: auto;">${subItems.length}개 해역</span>
                `;

                // 호버 효과 (그라디언트만 변경, 이동 없음)
                subHeader.onmouseenter = () => {
                    subHeader.style.background = 'linear-gradient(135deg, rgba(40, 80, 140, 0.9), rgba(52, 102, 180, 0.7))';
                };
                subHeader.onmouseleave = () => {
                    subHeader.style.background = 'linear-gradient(135deg, rgba(30, 60, 114, 0.8), rgba(42, 82, 152, 0.6))';
                };

                // 목록 컨테이너 (기본: 숨김)
                const listContainer = document.createElement('div');
                listContainer.className = 'sub-region-list';
                listContainer.style.display = 'none';
                listContainer.style.paddingLeft = '12px';

                // 토글 기능 (배타적 모드: 하나만 열림, 슬라이드 애니메이션)
                subHeader.onclick = () => {
                    const isCurrentlyHidden = listContainer.style.display === 'none';

                    // 같은 대분류 내 모든 중분류 아코디언 닫기 (애니메이션)
                    const parentSection = subSection.closest('.sea-section') || container;
                    parentSection.querySelectorAll('.sub-region-list').forEach(list => {
                        if (list !== listContainer && list.style.display !== 'none') {
                            slideUp(list);
                        }
                        const header = list.previousElementSibling;
                        if (header && list !== listContainer) {
                            header.style.marginLeft = '0';
                        }
                    });

                    // 클릭한 것이 닫혀있었다면 열기 (애니메이션)
                    if (isCurrentlyHidden) {
                        slideDown(listContainer);
                        subHeader.style.marginLeft = '4px';
                    } else {
                        slideUp(listContainer);
                        const icon = subHeader.querySelector('.fa-chevron-right');
                        if (icon) icon.style.transform = 'rotate(0deg)';
                        subHeader.style.marginLeft = '0';
                    }
                };

                // 아이템 추가 (정렬 적용)
                const sortedSubItems = sortAlertItems(subItems);
                sortedSubItems.forEach(item => {
                    counts[mainRegion]++;
                    listContainer.appendChild(createAlertElement(item));
                });

                subSection.appendChild(subHeader);
                subSection.appendChild(listContainer);
                container.appendChild(subSection);
            });
        }
    }

    const totalAlerts = appState.alerts.length;

    // --- Disable/Enable Sea Sections & Sort Order ---
    const alertContent = document.getElementById('alert-content');
    const errorMsg = document.getElementById('alert-error-message');
    const sections = []; // To store section elements with their counts logic

    // API 에러 처리
    if (appState.hasApiError) {
        if (errorMsg) errorMsg.classList.remove('hidden');

        // 모든 해역 섹션 숨기기 (count-badge 등은 무시됨)
        for (const [sea, section] of Object.entries(seaSections)) {
            if (section && section.parentElement) {
                section.parentElement.style.display = 'none';
            }
        }
        return; // 에러 상태에서는 여기서 렌더링 종료
    } else {
        // 정상 상태: 에러 메시지 숨기고 섹션 표시 복구
        if (errorMsg) errorMsg.classList.add('hidden');

        for (const [sea, section] of Object.entries(seaSections)) {
            if (section && section.parentElement) {
                section.parentElement.style.display = '';
            }
        }
    }

    for (const [sea, count] of Object.entries(counts)) {
        if (seaSections[sea]) {
            const sectionContainer = seaSections[sea].parentElement; // .sea-section

            if (sectionContainer) {
                // Store for sorting
                sections.push({ el: sectionContainer, count: count, id: sectionContainer.id });

                // Remove previous disabled state
                sectionContainer.classList.remove('disabled');
                const header = sectionContainer.querySelector('.sea-header');
                if (header) header.style.cursor = 'pointer';

                // Update count badge
                if (seaCounts[sea]) {
                    seaCounts[sea].textContent = `${count}개 해역`;

                    if (count === 0) {
                        // 특보가 없으면 아코디언 자체를 숨김
                        sectionContainer.style.display = 'none';
                    } else {
                        // 특보가 있으면 표시
                        sectionContainer.style.display = '';
                        seaCounts[sea].classList.remove('zero');
                        // Start collapsed (as requested)
                        sectionContainer.classList.remove('open');
                    }
                }
            }
        }
    }

    // Sort sections: Alerts (count > 0) first, No Alerts last
    // Keep original order relative to each group (e.g., East, West, South, Jeju)
    const originalOrder = ['east-sea-section', 'west-sea-section', 'south-sea-section', 'jeju-sea-section'];

    sections.sort((a, b) => {
        const hasAlertA = a.count > 0;
        const hasAlertB = b.count > 0;

        if (hasAlertA && !hasAlertB) return -1; // A comes first
        if (!hasAlertA && hasAlertB) return 1;  // B comes first

        // If same status, keep original relative order
        return originalOrder.indexOf(a.id) - originalOrder.indexOf(b.id);
    });

    // Re-append in new order
    if (alertContent) {
        sections.forEach(item => {
            alertContent.appendChild(item.el);
        });
    }

    // --- Global Badge & Accordion State Logic ---
    const globalStatusContainer = document.querySelector('.header-status'); // Use container to clear/add multiple badges
    const mainHeader = document.getElementById('main-accordion-header');
    const mainBody = document.getElementById('main-accordion-body');

    // [New] 필터링된 알림 목록 재구성 (여기서 다시 계산해야 정확함)
    const filteredAlerts = appState.alerts.filter(a => {
        if (typeof UserSettings !== 'undefined') {
            return UserSettings.isVisible(a.zoneName);
        }
        return true;
    });

    // Count Active vs Preliminary (필터링된 목록 기준)
    const activeSet = new Set();
    const prelimSet = new Set();

    filteredAlerts.forEach(a => {
        if (a.isDummy) return;

        // 특보 구역명 기준으로 중복 제거 (동일 구역에 여러 특보가 있을 수 있으나 구역 수 기준인지 확인 필요)
        // 사용자는 "발효 ##건"이라고 했으므로 단순 특보 건수를 세는 것이 맞을 수 있으나 
        // 기존에는 해역(Zone) 수를 셌음. 여기서는 해역별 카드 수와 일치시키는 것이 안전함.
        // 하지만 flattenAlertsData에서 current/upcoming을 분리했으므로, 
        // 한 해역에 current, upcoming이 둘 다 있으면 각각 별도의 아이템이 됨.

        if (a.isPreliminary) {
            prelimSet.add(a.zoneName);
        } else {
            // 발효 중 (주의보/경보)
            activeSet.add(a.zoneName);
        }
    });

    const activeCount = activeSet.size;
    const prelimCount = prelimSet.size;
    const totalCount = activeCount + prelimCount;

    // [New] 헤더 텍스트 변경 로직
    // 필터링 여부 확인: UserSettings.settings에 false가 하나라도 있으면 필터링된 것으로 간주
    let isFiltered = false;
    if (typeof UserSettings !== 'undefined') {
        const settingsValues = Object.values(UserSettings.settings);
        // 설정값이 하나라도 있고, 그 중 false인 것이 있으면 필터링 상태
        // (기본값은 undefined일 수 있으나 settings 객체에 저장된 값은 true/false임)
        if (settingsValues.length > 0 && settingsValues.includes(false)) {
            isFiltered = true;
        }
    }

    // 1. 특보 현황 헤더
    const sectionTitle = document.querySelector('#main-accordion-header .section-title');
    if (sectionTitle) {
        if (isFiltered) {
            sectionTitle.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> 관심해역별 특보현황';
        } else {
            sectionTitle.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> 해역별 특보현황';
        }
    }

    // 2. 기상 현황 헤더
    const statusTitle = document.querySelector('#marine-status-accordion-header .section-title');
    if (statusTitle) {
        if (isFiltered) {
            statusTitle.innerHTML = '<i class="fa-solid fa-sun" style="color: #FFD700;"></i> 관심해역별 기상현황';
        } else {
            statusTitle.innerHTML = '<i class="fa-solid fa-sun" style="color: #FFD700;"></i> 해역별 기상현황';
        }
    }

    if (globalStatusContainer) {
        // Clear existing badges (except icon)
        // We need to keep the icon
        const icon = document.getElementById('main-accordion-icon');
        globalStatusContainer.innerHTML = ''; // Clear all
        globalStatusContainer.style.gap = '5px'; // Override CSS gap (12px)

        if (totalCount > 0) {
            // Add Active Badge (Red) - "발효"
            if (activeCount > 0) {
                const activeBadge = document.createElement('span');
                activeBadge.className = 'status-badge warning';
                activeBadge.textContent = `발효 ${activeCount}건`;
                globalStatusContainer.appendChild(activeBadge);
            }

            // Add Preliminary Badge (Orange) - "발표"
            if (prelimCount > 0) {
                const prelimBadge = document.createElement('span');
                prelimBadge.className = 'status-badge orange'; // Custom orange class
                prelimBadge.textContent = `발표 ${prelimCount}건`;
                globalStatusContainer.appendChild(prelimBadge);
            }

            // Start Expanded (필터링된 상태에서도 알림이 있으면 펼쳐짐)
            if (mainBody && mainBody.classList.contains('collapsed')) {
                mainBody.classList.remove('collapsed');
                if (mainHeader) mainHeader.classList.remove('collapsed-state');
            }

            // 특보 있음: 빨간색 그라데이션 유지
            if (mainHeader) {
                mainHeader.style.background = 'linear-gradient(90deg, rgba(50, 20, 20, 0.6) 0%, rgba(127, 29, 29, 0.9) 100%)';
                mainHeader.style.borderColor = 'rgba(239, 68, 68, 0.3)';
            }
        } else {
            // No Alerts (Green)
            const safeBadge = document.createElement('span');
            safeBadge.className = 'status-badge safe';

            // 텍스트 조건부 변경
            if (isFiltered) {
                safeBadge.textContent = '관심해역 특보 없음';
            } else {
                safeBadge.textContent = '전 해역 특보없음';
            }

            safeBadge.style.marginRight = '6px';
            globalStatusContainer.appendChild(safeBadge);

            // Start Collapsed
            if (mainBody && !mainBody.classList.contains('collapsed')) {
                mainBody.classList.add('collapsed');
                if (mainHeader) mainHeader.classList.add('collapsed-state');
            }

            // 특보 없음: 초록색 그라데이션으로 변경
            if (mainHeader) {
                mainHeader.style.background = 'linear-gradient(90deg, rgba(20, 50, 30, 0.6) 0%, rgba(34, 139, 34, 0.8) 100%)';
                mainHeader.style.borderColor = 'rgba(34, 139, 34, 0.4)';
            }
        }

        // Re-append icon logic removed

    }

    // [New] 기상현황 아코디언 자동 제어 로직
    // 특보(filtered)가 없으면 기상현황을 열어주고, 있으면 기상현황을 닫음 (Focus 집중)
    const statusBody = document.getElementById('marine-status-accordion-body');
    const statusHeader = document.getElementById('marine-status-accordion-header');

    if (statusBody) {
        if (totalCount > 0) {
            // 특보 있음 -> 기상현황 닫기 (특보에 집중)
            if (!statusBody.classList.contains('collapsed')) {
                statusBody.classList.add('collapsed');
                // 헤더 상태 변경이 필요하다면 추가 (보통 collapsed-state 등)
            }
        } else {
            // 특보 없음 -> 기상현황 열기 (볼 게 없으므로 기상정보 제공)
            if (statusBody.classList.contains('collapsed')) {
                statusBody.classList.remove('collapsed');
            }
        }
    }

    // 전체 현황 업데이트 로그
    // console.log('Total alerts displayed:', totalAlerts);
}

function createAlertElement(items) {
    if (!Array.isArray(items)) items = [items];

    let zoneNameStr = '';
    let sortedAlerts = [];

    if (items.length > 0) {
        sortedAlerts = sortAlertItems(items);
        zoneNameStr = sortedAlerts[0].zoneName;
    }

    const data = sortedAlerts[0] || {};
    zoneNameStr = data.zoneName || '알 수 없는 구역';

    const template = document.getElementById('alert-item-template');
    const clone = template.content.cloneNode(true);
    const card = clone.querySelector('.alert-card');

    card.style.cssText = `
        padding: 10px 12px;
        margin-bottom: 6px;
        border-radius: 8px;
        background: rgba(30, 40, 60, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.08);
        transition: all 0.2s ease;
    `;

    // [Fix] 모바일 화면에서 해역명과 뱃지가 겹칠 경우 자연스럽게 줄바꿈 허용 (문제 2 해결)
    const header = clone.querySelector('.alert-header');
    if (header) {
        header.style.flexWrap = 'wrap';
        header.style.rowGap = '6px';
        header.style.alignItems = 'center';
    }

    const zoneName = clone.querySelector('.zone-name');
    zoneName.innerHTML = '';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = zoneNameStr;
    zoneName.appendChild(nameSpan);

    // 원본 이름에 추가 정보(해제예고 등)가 있다면 함께 표시
    if (data.originalZoneName && data.originalZoneName !== data.zoneName) {
        let extraText = data.originalZoneName.replace(data.zoneName, '').trim();
        if (extraText) {
            const extraSpan = document.createElement('span');
            extraSpan.style.fontSize = '0.75rem';
            extraSpan.style.color = '#aaa';
            extraSpan.style.marginLeft = '6px';
            extraSpan.style.fontWeight = '400';
            extraSpan.textContent = extraText;
            zoneName.appendChild(extraSpan);
        }
    }

    zoneName.style.cssText = `
        font-size: 0.9rem;
        font-weight: 600;
        color: #e0e0e0;
        display: flex;
        align-items: center;
        flex-wrap: wrap;
    `;

    const badgeContainer = clone.querySelector('.alert-badges');
    badgeContainer.style.display = 'flex';
    badgeContainer.style.gap = '4px';
    badgeContainer.style.flexWrap = 'wrap';

    const now = getKfTime();
    const targetZoneName = data.zoneName || '';

    const getAlertScore = (type, lvl) => {
        const TYPE_RANK = { '태풍': 100, '풍랑': 10, '강풍': 10, '해일': 10, '호우': 10, '대설': 10, '기타': 0 };
        const LVL_RANK = { '경보': 5, '주의보': 2, '예비': 1, '기타': 0, '해제': 0, '': 0 };
        const tScore = TYPE_RANK[type] || (type && type.includes('태풍') ? 100 : 10);
        const lScore = LVL_RANK[lvl] || 0;
        return tScore + lScore;
    };

    let ledgerEntry = null;
    const targetRegId = data.regId; // API 데이터의 regId

    // 1단계: regId로 정밀 매칭 시도
    if (appState.alertStateHistory && targetRegId && appState.alertStateHistory[targetRegId]) {
        ledgerEntry = appState.alertStateHistory[targetRegId];
    }

    // 2단계: 실패 시 명칭 기반 매칭 (Fallback)
    if (!ledgerEntry && appState.alertStateHistory) {
        const normalizeName = (s) => (s || '').replace(/[\s·.()]/g, '').trim();
        const normTarget = normalizeName(targetZoneName);

        for (const [regId, zoneData] of Object.entries(appState.alertStateHistory)) {
            const normKo = normalizeName(zoneData.korName || zoneData.regKo || '');
            if (normKo === normTarget) {
                ledgerEntry = zoneData;
                break;
            }
        }
    }

    let currentInView = null;
    let transitionBadge = null;
    let publishEntry = null; // 예정된 변경사항

    // [A안 적용] 장부에서 activeAlert와 upcomingAlert를 분리하여 참조
    // 마이그레이션 호환: current 필드가 있으면 구형 포맷으로 처리
    if (ledgerEntry) {
        // 신형 포맷 (activeAlert + upcomingAlert)
        if (ledgerEntry.activeAlert) {
            const curr = ledgerEntry.activeAlert;
            const currLevel = (curr.wrnLvl === '경보' || (curr.wrnLvl && curr.wrnLvl.includes('경보'))) ? '경보' :
                (curr.wrnLvl === '주의보' || (curr.wrnLvl && curr.wrnLvl.includes('주의'))) ? '주의보' :
                    (curr.wrnLvl === '예비' || (curr.wrnLvl && curr.wrnLvl.includes('예비'))) ? '예비' : '기타';

            currentInView = {
                warnType: curr.wrnTp || curr.warnType || '풍랑',
                level: currLevel,
                tmFc: curr.tmFc,
                tmEf: curr.tmEf,
                tmYn: curr.tmYn,
                rawTmEf: curr.rawTmEf || '',
                isFromHistory: true
            };
        }

        if (ledgerEntry.upcomingAlert) {
            const upcoming = ledgerEntry.upcomingAlert;
            const upLevel = (upcoming.wrnLvl === '경보' || (upcoming.wrnLvl && upcoming.wrnLvl.includes('경보'))) ? '경보' :
                (upcoming.wrnLvl === '주의보' || (upcoming.wrnLvl && upcoming.wrnLvl.includes('주의'))) ? '주의보' :
                    (upcoming.wrnLvl === '예비' || (upcoming.wrnLvl && upcoming.wrnLvl.includes('예비'))) ? '예비' : '기타';

            publishEntry = {
                warnType: upcoming.wrnTp || upcoming.warnType || '풍랑',
                level: upLevel,
                tmFc: upcoming.tmFc,
                tmEf: upcoming.tmEf,
                tmYn: upcoming.tmYn,
                rawTmEf: upcoming.rawTmEf || '',
                isFromHistory: true
            };
        }

        // 구형 포맷 호환 (current 필드가 있는 경우)
        if (!currentInView && !publishEntry && ledgerEntry.current) {
            const curr = ledgerEntry.current;
            const currLevel = (curr.wrnLvl === '경보' || (curr.wrnLvl && curr.wrnLvl.includes('경보'))) ? '경보' :
                (curr.wrnLvl === '주의보' || (curr.wrnLvl && curr.wrnLvl.includes('주의'))) ? '주의보' :
                    (curr.wrnLvl === '예비' || (curr.wrnLvl && curr.wrnLvl.includes('예비'))) ? '예비' : '기타';

            const currData = {
                warnType: curr.wrnTp || curr.warnType || '풍랑',
                level: currLevel,
                tmFc: curr.tmFc,
                tmEf: curr.tmEf,
                tmYn: curr.tmYn,
                rawTmEf: curr.rawTmEf || '',
                isFromHistory: true
            };

            if (curr.status === 'active') {
                currentInView = currData;
            } else if (curr.status === 'publish') {
                publishEntry = currData;
            }
        }
    }

    // [Fallback] 장부에 데이터가 없을 때만 API 데이터를 현재 상태로 간주
    // 장부에 데이터가 있으면 장부 기준으로 처리하므로 Fallback 불필요
    if (!ledgerEntry && !currentInView && data && !data.isDummy && data.warnType && data.level) {
        if (!data.isPreliminary) {
            currentInView = {
                ...data,
                level: (data.level === '경보' || (data.level && data.level.includes('경보'))) ? '경보' : '주의보'
            };
        }
    }

    // [단순화] 격상/격하 배지 계산 로직 제거됨

    let upcomingFromApi = [];
    const seenTmFc = new Set();

    // 1. 장부의 publishEntry가 있으면 가장 먼저 등록 (우선순위)
    if (publishEntry && publishEntry.tmFc) {
        seenTmFc.add(publishEntry.tmFc);
    }
    // currentInView도 기등록 처리
    if (currentInView && currentInView.tmFc) {
        seenTmFc.add(currentInView.tmFc);
    }

    sortedAlerts.forEach(alert => {
        if (!alert.warnType || !alert.level) return;
        const cleanEf = String(alert.tmEf || '').replace(/[^0-9]/g, '');
        const isFuture = cleanEf && cleanEf.length >= 12 && now < cleanEf;

        if (isFuture || alert.isPreliminary) {
            // 이미 장부 데이터(publishEntry/currentInView)로 처리된 동일 시각 데이터는 제외
            if (alert.tmFc && seenTmFc.has(alert.tmFc)) return;

            upcomingFromApi.push(alert);
            if (alert.tmFc) seenTmFc.add(alert.tmFc);
        }
    });



    if (currentInView) {
        const badge = document.createElement('span');
        badge.className = 'status-badge warning';
        badge.textContent = `${currentInView.warnType} ${currentInView.level}`;
        badgeContainer.appendChild(badge);


    }

    // [보정] API 파싱 오류나 장부 오류로 인해 예비특보와 주의보가 동시에 잡히는 경우
    // 장부(History) 여부와 상관없이, 예비특보가 존재하는데 주의보가 떠있다면(경보 제외)
    // 그리고 두 특보의 발표시각(tmFc)이 같다면, 이는 100% 동일 데이터를 잘못 해석한 것이다.
    if (publishEntry && currentInView) {
        // level 비교를 느슨하게 하여 '주의보' 뿐만 아니라 '주의' 등도 포함
        const curLvl = currentInView.level || '';
        const pubLvl = publishEntry.level || '';

        if (pubLvl.includes('예비') && !curLvl.includes('경보')) {
            // 발표 시각이 같으면 동일 알림의 중복 해석이므로 제거
            if (publishEntry.tmFc === currentInView.tmFc) {
                currentInView = null;
                activeFromApi = [];
            }
        }
    }


    // [수정] publishEntry(예정된 변경)가 있으면 배지 생성
    // [추가 수정] currentInView가 있으면 배지는 생성하지 않음 (current 우선)
    if (publishEntry) {
        let direction = '';
        if (currentInView) {
            const curScore = getAlertScore(currentInView.warnType, currentInView.level);
            const pubScore = getAlertScore(publishEntry.warnType, publishEntry.level);
            direction = curScore > pubScore ? '격하' : curScore < pubScore ? '격상' : '';
        }

        // [수정] currentInView가 없을 때만 예비 배지 생성
        if (!currentInView) {
            const badge = document.createElement('span');
            badge.className = 'status-badge preliminary';
            const cleanType = (publishEntry.warnType || '').replace('주의보', '').replace('경보', '').trim();
            badge.textContent = `${cleanType} 예비`;
            badgeContainer.appendChild(badge);
        }

        // 상세 영역 표시를 위해 리스트에 추가 (중복 방지는 위에서 처리됨)
        upcomingFromApi.unshift({
            ...publishEntry,
            _isUpcoming: true,
            _direction: direction
        });
    }

    // [중복 뱃지 생성 로직 제거됨] - 사용자 요청으로 Revert

    // 추가적인 upcoming 정보들 배지 생성
    // [수정] currentInView가 있으면 upcoming 배지는 생성하지 않음
    if (!currentInView) {
        upcomingFromApi.forEach(upcoming => {
            if (upcoming._isUpcoming) return; // 이미 publishEntry로 처리된 것 스킵

            const badge = document.createElement('span');
            badge.className = 'status-badge preliminary';
            const cleanType = (upcoming.warnType || '').replace('주의보', '').replace('경보', '').trim();
            badge.textContent = `${cleanType} 예비`;
            badgeContainer.appendChild(badge);
        });
    }

    if (badgeContainer.children.length === 0) {
        const safeBadge = document.createElement('span');
        safeBadge.className = 'status-badge safe';
        safeBadge.textContent = '관심해역 특보 없음';
        safeBadge.style.opacity = '0.6';
        badgeContainer.appendChild(safeBadge);
    }

    // 상세 정보 영역 표시용 데이터 리스트 구성
    const detailedAlertList = [];
    const seenDetailTmFc = new Set();

    // 1. 현재 발효 중인 특보 등록
    if (currentInView) {
        detailedAlertList.push({ ...currentInView, _isCurrent: true });
        if (currentInView.tmFc) seenDetailTmFc.add(currentInView.tmFc);
    }

    // 2. 다가오는(예비) 특보 등록
    upcomingFromApi.forEach(up => {
        // 이미 등록된 정보와 발표시각(tmFc)이 같으면 완벽한 중복이므로 제외
        if (up.tmFc && seenDetailTmFc.has(up.tmFc)) return;

        detailedAlertList.push({ ...up, _isUpcoming: true });
        if (up.tmFc) seenDetailTmFc.add(up.tmFc);
    });

    const details = clone.querySelector('.alert-details');
    details.innerHTML = '';

    const formatAlertTime = (timeStr) => {
        // [수정] 월 표기 제거 (예: "2월 10일" -> "10일")
        const formatted = formatWarningTime(timeStr);
        return formatted ? formatted.replace(/^\d+월\s*/, '').replace(/\s\d+월\s*/, ' ') : formatted;
    };

    const createRow = (label, value, color) => {
        const row = document.createElement('div');
        row.style.cssText = 'display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 0.85rem;';
        row.innerHTML = `<span style="color: #8b949e;">${label}</span><span style="color: ${color || '#e6edf3'}; font-weight: 500;">${value || '정보 없음'}</span>`;
        return row;
    };

    detailedAlertList.forEach((alert, idx) => {
        if (alert.isDummy) return;

        // [수정] 다가오는 특보인 경우: 현재 특보가 이미 위에 있을 때만(idx > 0) [다가오는 특보] 타이틀과 구분선 표시
        if (alert._isUpcoming) {
            if (idx > 0) {
                const divider = document.createElement('div');
                divider.style.cssText = 'height: 1px; background: rgba(255,255,255,0.1); margin: 12px 0 8px 0; border-top: 1px dashed rgba(255,255,255,0.05);';
                details.appendChild(divider);

                const upcomingHead = document.createElement('div');
                upcomingHead.style.cssText = 'color: #ffb74d; font-size: 0.75rem; font-weight: 700; margin-bottom: 6px; display: flex; align-items: center; gap: 4px;';

                // [수정] '예비' 레벨은 '주의보'로 치환하여 표시 ("예비 예정" -> "주의보 예정")
                let displayLevel = alert.level;
                if (displayLevel === '예비') displayLevel = '주의보';

                upcomingHead.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i> [다가오는 특보] ${alert.warnType} ${displayLevel} 예정`;
                details.appendChild(upcomingHead);
            }
        }
        // [수정] '현재 발효 중' 타이틀은 사용자 요청으로 인해 표시하지 않음 (공간 절약 및 디자인 깔끔화)

        details.appendChild(createRow('발표시각', formatAlertTime(alert.tmFc)));
        details.appendChild(createRow('발효시각', formatAlertTime(alert.tmEf)));
        let releaseTime = alert.tmYn || alert.tmEd || '';
        if (releaseTime.trim() === '일' || releaseTime.trim() === '') {
            releaseTime = '정보 없음';
        } else {
            // [수정] 월 표기 제거
            releaseTime = releaseTime.replace(/^\d+월\s*/, '').replace(/\s\d+월\s*/, ' ');
        }
        details.appendChild(createRow('해제예정', releaseTime, '#69f0ae'));
    });

    const findCoastalZones = (zName) => {
        if (!zName) return null;
        const norm = zName.replace(/[\s·.]/g, '');
        for (const [key, val] of Object.entries(COASTAL_MAPPING)) {
            if (key.replace(/[\s·.]/g, '') === norm) return val;
        }
        return null;
    };

    const coastalZones = findCoastalZones(data.zoneName);
    if (coastalZones && coastalZones.length > 0) {
        const coastalContainer = document.createElement('div');
        coastalContainer.className = 'coastal-zones';
        coastalContainer.style.marginTop = '12px';
        coastalContainer.style.borderTop = '1px solid rgba(255,255,255,0.1)';
        coastalContainer.style.paddingTop = '12px';

        const coastalTitle = document.createElement('div');
        coastalTitle.style.cssText = 'font-size: 0.85rem; color: #8b949e; margin-bottom: 8px;';
        coastalTitle.textContent = '연안바다/평수구역';
        coastalContainer.appendChild(coastalTitle);

        const findCoastalAlert = (fullName) => {
            const normalizedTarget = (fullName || '').replace(/\s+/g, '');
            for (const [key, alerts] of Object.entries(appState.coastalAlerts || {})) {
                const normalizedKey = key.replace(/\s+/g, '');
                if (normalizedKey === normalizedTarget) return alerts;
                // 부분 일치 허용 (구역/수구 등 truncation 대응)
                if (normalizedKey.length > 10 && normalizedTarget.length > 10) {
                    if (normalizedKey.startsWith(normalizedTarget) || normalizedTarget.startsWith(normalizedKey)) return alerts;
                }
            }
            return null;
        };

        const sortedCoastal = [...coastalZones].sort((a, b) => {
            const alertA = findCoastalAlert(a.fullName);
            const alertB = findCoastalAlert(b.fullName);
            if (alertA && !alertB) return -1;
            if (!alertA && alertB) return 1;
            return 0;
        });
        sortedCoastal.forEach(coastal => {
            const coastalAlert = findCoastalAlert(coastal.fullName);
            const coastalItem = createCoastalElement(coastal, coastalAlert, data.zoneName);
            coastalContainer.appendChild(coastalItem);
        });
        details.appendChild(coastalContainer);
    }

    const buoys = BUOY_MAPPING[data.zoneName];
    if (buoys && buoys.length > 0) {
        const buoyContainer = document.createElement('div');
        buoyContainer.className = 'buoy-section';
        buoyContainer.style.cssText = 'margin-top: 12px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 12px;';

        const buoyTitle = document.createElement('div');
        buoyTitle.style.cssText = 'font-size: 0.85rem; color: #8b949e; margin-bottom: 10px;';
        buoyTitle.innerHTML = BUOY_SVG_ICON + ' 관측부이 <span style="color:#69f0ae;font-size:0.75rem">(' + buoys.length + ')</span>';
        buoyContainer.appendChild(buoyTitle);

        const btnContainer = document.createElement('div');
        btnContainer.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px;';

        const infoArea = document.createElement('div');
        infoArea.className = 'buoy-info-area';
        infoArea.style.cssText = 'display: none; background: rgba(68, 138, 255, 0.1); border-radius: 8px; padding: 12px; border: 1px solid rgba(68, 138, 255, 0.2);';

        buoys.forEach(buoy => {
            const btn = document.createElement('button');
            btn.className = 'buoy-btn';
            btn.textContent = buoy.name;
            btn.style.cssText = 'padding: 6px 14px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.05); color: #ccc; font-size: 0.85rem; cursor: pointer; transition: all 0.2s;';
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (btn.classList.contains('active')) {
                    btn.classList.remove('active');
                    btn.style.backgroundColor = 'rgba(255,255,255,0.05)';
                    btn.style.color = '#ccc';
                    btn.style.borderColor = 'rgba(255,255,255,0.15)';
                    infoArea.style.display = 'none';
                    return;
                }
                btnContainer.querySelectorAll('.buoy-btn').forEach(b => {
                    b.classList.remove('active');
                    b.style.backgroundColor = 'rgba(255,255,255,0.05)';
                    b.style.color = '#ccc';
                    b.style.borderColor = 'rgba(255,255,255,0.15)';
                });
                btn.classList.add('active');
                btn.style.backgroundColor = 'rgba(68, 138, 255, 0.3)';
                btn.style.color = '#448aff';
                btn.style.borderColor = '#448aff';
                infoArea.style.display = 'block';
                displayBuoyInfo(buoy, infoArea);
            });
            btnContainer.appendChild(btn);
        });

        buoyContainer.appendChild(btnContainer);
        buoyContainer.appendChild(infoArea);
        details.appendChild(buoyContainer);
    }

    // 펼치기/접기
    card.style.cursor = 'pointer';
    card.addEventListener('click', (e) => {
        if (e.target.closest('.coastal-item') || e.target.closest('.buoy-btn') || e.target.closest('.buoy-info-area')) return;
        e.stopPropagation();

        const isCurrentlyHidden = details.classList.contains('hidden');

        // 1. 다른 모든 알림 카드를 닫음 (전체 문서 범위에서)
        document.querySelectorAll('.alert-details').forEach(otherDetails => {
            otherDetails.classList.add('hidden');
        });
        // Arrow rotation logic removed


        // 2. 현재 카드만 토글 (이전에 닫혀있었다면 열기)
        if (isCurrentlyHidden) {
            details.classList.remove('hidden');
            // arrow rotation removed

        }
    });

    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'card-action-btns';
    actionsContainer.style.cssText = 'display: flex; gap: 8px; margin-top: 15px;';

    // [수정] 해역별 기상현황과 동일한 조건 적용: ZONE_NAME_DISPLAY_MAP에 없는 해역에만 기상예보 버튼 표시
    const isMappedZone = typeof ZONE_NAME_DISPLAY_MAP !== 'undefined' && ZONE_NAME_DISPLAY_MAP[data.zoneName];
    if (typeof showSeaForecastTable === 'function' && !isMappedZone) {
        const forecastBtn = document.createElement('button');
        forecastBtn.innerHTML = '기상예보';
        forecastBtn.style.cssText = 'flex: 1; padding: 12px 8px; background: linear-gradient(135deg, #ffd54f, #ff9800, #f57c00); color: #1a1e2e; border: none; border-radius: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer; white-space: nowrap; transition: transform 0.2s; box-shadow: 0 2px 8px rgba(255, 152, 0, 0.3);';
        forecastBtn.addEventListener('click', (e) => { e.stopPropagation(); showSeaForecastTable(data.zoneName); });
        actionsContainer.appendChild(forecastBtn);
    }

    const zoneViewBtn = document.createElement('button');
    zoneViewBtn.innerHTML = '해구기상';
    zoneViewBtn.style.cssText = 'flex: 1; padding: 12px 8px; background: linear-gradient(135deg, #e94560, #0f3460); color: white; border: none; border-radius: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer; white-space: nowrap; transition: transform 0.2s;';
    zoneViewBtn.addEventListener('click', (e) => { e.stopPropagation(); if (typeof showZoneOverlay === 'function') showZoneOverlay(data.zoneName); });
    actionsContainer.appendChild(zoneViewBtn);


    if (WINDY_URL_MAPPING[data.zoneName]) {
        const windyBtn = document.createElement('button');
        windyBtn.innerHTML = '윈디';
        windyBtn.style.cssText = 'flex: 1; padding: 12px 8px; background: linear-gradient(135deg, #00c6ff, #0072ff); color: white; border: none; border-radius: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer; white-space: nowrap; transition: transform 0.2s;';
        windyBtn.addEventListener('click', (e) => { e.stopPropagation(); showWindyPopup(data.zoneName); });
        actionsContainer.appendChild(windyBtn);
    }

    details.appendChild(actionsContainer);
    return card;
}

function displayBuoyInfo(buoy, container) {
    container.innerHTML = '';

    // 디버그: 부이 ID와 데이터 유무 확인
    // console.log('🔍 부이 조회:', buoy.id, buoy.name, '| 데이터 존재:', !!appState.buoyData[buoy.id]);

    const buoyData = appState.buoyData[buoy.id];
    const typeInfo = BUOY_TYPES[buoy.type] || { name: '부이', icon: '📍' };

    // 헤더
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '12px';
    header.style.paddingBottom = '8px';
    header.style.borderBottom = '1px solid rgba(255,255,255,0.1)';

    const nameSpan = document.createElement('span');
    nameSpan.style.fontWeight = '600';
    nameSpan.style.fontSize = '0.95rem';
    nameSpan.style.color = '#e6edf3';
    nameSpan.style.display = 'flex';
    nameSpan.style.alignItems = 'center';
    nameSpan.style.gap = '6px';
    nameSpan.innerHTML = `${buoy.name} <span style="font-size:0.75rem;color:#8b949e">(${typeInfo.name})</span>`;

    // 위치 보기 버튼
    const locationBtn = document.createElement('button');
    locationBtn.innerHTML = '📍';
    locationBtn.title = '지도에서 위치 보기';
    locationBtn.style.cssText = `
        background: rgba(79, 195, 247, 0.2);
        border: 1px solid #4fc3f7;
        border-radius: 50%;
        width: 24px;
        height: 24px;
        cursor: pointer;
        font-size: 0.8rem;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
    `;
    locationBtn.onmouseenter = () => {
        locationBtn.style.background = 'rgba(79, 195, 247, 0.4)';
        locationBtn.style.transform = 'scale(1.1)';
    };
    locationBtn.onmouseleave = () => {
        locationBtn.style.background = 'rgba(79, 195, 247, 0.2)';
        locationBtn.style.transform = 'scale(1)';
    };
    locationBtn.onclick = (e) => {
        e.stopPropagation();
        showBuoyLocationOnMap(buoy.id);
    };
    nameSpan.appendChild(locationBtn);

    header.appendChild(nameSpan);
    container.appendChild(header);

    if (!buoyData) {
        const noData = document.createElement('div');
        noData.style.textAlign = 'center';
        noData.style.padding = '16px 10px';
        noData.style.color = '#ff9800';
        noData.style.backgroundColor = 'rgba(255, 152, 0, 0.1)';
        noData.style.borderRadius = '6px';
        noData.style.fontSize = '0.9rem';
        noData.innerHTML = '⚠️ 해당 부이에서는 기상정보가 관측되지 않았습니다.';
        container.appendChild(noData);
        return;
    }

    // 주요 데이터 (파고, 풍속, 수온)
    const mainData = document.createElement('div');
    mainData.style.display = 'flex';
    mainData.style.gap = '20px';
    mainData.style.marginBottom = '12px';
    mainData.style.flexWrap = 'wrap';

    if (buoyData.waveHeight !== null) {
        const waveBox = createDataBox('🌊 파고', buoyData.waveHeight, 'm', '#4fc3f7');
        mainData.appendChild(waveBox);
    }

    if (buoyData.windSpeed !== null) {
        const windDir = buoyData.windDirection !== null ? getWindDirectionText(buoyData.windDirection) : '';
        const windBox = createDataBox('💨 풍속', buoyData.windSpeed, `m/s ${windDir}`, '#81c784');
        mainData.appendChild(windBox);
    }

    if (buoyData.waterTemp !== null) {
        const tempBox = createDataBox('🌡️ 수온', buoyData.waterTemp, '°C', '#ffb74d');
        mainData.appendChild(tempBox);
    }

    container.appendChild(mainData);

    // 상세 데이터
    let detailHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.85rem;background:rgba(0,0,0,0.2);padding:10px;border-radius:6px">';

    if (buoyData.windGust !== null) {
        detailHTML += `<div><span style="color:#8b949e">돌풍</span> <span style="color:#fff">${buoyData.windGust} m/s</span></div>`;
    }
    if (buoyData.airTemp !== null) {
        detailHTML += `<div><span style="color:#8b949e">기온</span> <span style="color:#fff">${buoyData.airTemp}°C</span></div>`;
    }
    if (buoyData.pressure !== null) {
        detailHTML += `<div><span style="color:#8b949e">기압</span> <span style="color:#fff">${buoyData.pressure} hPa</span></div>`;
    }
    if (buoyData.humidity !== null) {
        detailHTML += `<div><span style="color:#8b949e">습도</span> <span style="color:#fff">${buoyData.humidity}%</span></div>`;
    }
    if (buoyData.tm) {
        detailHTML += `<div style="grid-column:1/-1;margin-top:4px;padding-top:4px;border-top:1px dashed rgba(255,255,255,0.1)"><span style="color:#8b949e">관측시간</span> <span style="color:#fff">${formatBuoyTime(buoyData.tm)}</span></div>`;
    }

    detailHTML += '</div>';

    const detailContainer = document.createElement('div');
    detailContainer.innerHTML = detailHTML;
    container.appendChild(detailContainer);
    detailContainer.innerHTML = detailHTML;
    container.appendChild(detailContainer);
}

// 연안바다 이미지 매핑
const COASTAL_ZONES_IMAGES = {
    "제주도북부앞바다": { "연안바다": "북부앞바다(연안바다).png" },
    "제주도남부앞바다": { "연안바다": "남부앞바다(연안바다).png" },
    "제주도동부앞바다": {
        "북동연안바다": "동부앞바다(북동연안바다).png",
        "남동연안바다": "동부앞바다(남동연안바다).png"
    },
    "제주도서부앞바다": {
        "북서연안바다": "서부앞바다(북서연안바다).png",
        "남서연안바다": "서부앞바다(남서연안바다).png"
    }
};

// 이미지 모달 표시 함수
function showImageModal(imageName, title) {
    // 기존 모달 제거
    const existing = document.getElementById('image-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'image-modal-overlay';
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.85); z-index: 10000;
        display: flex; align-items: center; justify-content: center;
        backdrop-filter: blur(5px);
    `;

    const content = document.createElement('div');
    content.style.cssText = `
        position: relative; max-width: 95%; max-height: 90%;
        background: #222; border-radius: 8px; overflow: hidden;
        box-shadow: 0 10px 25px rgba(0,0,0,0.5); border: 1px solid #444;
        display: flex; flex-direction: column;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
        padding: 12px 16px; background: #333; color: #fff; font-weight: bold;
        display: flex; justify-content: space-between; align-items: center;
        border-bottom: 1px solid #444; font-size: 1rem;
    `;
    header.innerHTML = `<span>🗺️ ${title}</span>`;

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = `
        background: none; border: none; color: #aaa; font-size: 1.2rem; cursor: pointer;
    `;
    closeBtn.onclick = () => overlay.remove();
    header.appendChild(closeBtn);

    const imgContainer = document.createElement('div');
    imgContainer.style.cssText = 'padding: 0; overflow: auto; display: flex; align-items: center; justify-content: center; background: #000;';

    const img = document.createElement('img');
    img.src = `연안바다_이미지/${imageName}`;
    img.style.cssText = 'max-width: 100%; max-height: 80vh; display: block;';
    img.onerror = () => { img.alt = '이미지를 불러올 수 없습니다.'; img.src = ''; img.style.color = '#fff'; img.style.padding = '20px'; };

    imgContainer.appendChild(img);
    content.appendChild(header);
    content.appendChild(imgContainer);
    overlay.appendChild(content);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
}

// 데이터 박스 생성 헬퍼
function createDataBox(label, value, unit, color) {
    const box = document.createElement('div');
    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    box.style.gap = '2px';

    const labelSpan = document.createElement('span');
    labelSpan.style.fontSize = '0.7rem';
    labelSpan.style.color = '#8b949e';
    labelSpan.textContent = label;

    const valueSpan = document.createElement('span');
    valueSpan.style.fontSize = '1.1rem';
    valueSpan.style.fontWeight = '700';
    valueSpan.style.color = color;
    valueSpan.innerHTML = `${value} <span style="font-size:0.75rem;font-weight:400;color:#8b949e">${unit}</span>`;

    box.appendChild(labelSpan);
    box.appendChild(valueSpan);

    return box;
}

// 부이 관측시간 포맷
function formatBuoyTime(tm) {
    if (!tm || tm.length < 12) return '-';
    const month = tm.substring(4, 6);
    const day = tm.substring(6, 8);
    const hour = tm.substring(8, 10);
    const minute = tm.substring(10, 12);
    return `${month}/${day} ${hour}:${minute}`;
}

// 연안바다/평수구역 요소 생성
function createCoastalElement(coastal, alertData, parentZoneName) {
    const item = document.createElement('div');
    item.className = 'coastal-item';
    item.style.padding = '8px 12px';
    item.style.marginBottom = '4px';
    item.style.borderRadius = '6px';
    item.style.backgroundColor = 'rgba(255,255,255,0.05)';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = coastal.name;
    nameSpan.style.fontSize = '0.9rem';
    nameSpan.style.fontWeight = '600'; // 좀 더 굵게
    header.appendChild(nameSpan);

    // [New] 지도 아이콘 버튼 추가 (가파도/우도 제외)
    // coastal.name 예: "북서연안바다", "연안바다" 등
    // parentZoneName 예: "제주도서부앞바다"
    if (parentZoneName && COASTAL_ZONES_IMAGES[parentZoneName]) {
        // 정확한 매칭을 위해 coastal.name 사용.
        // 예: 제주도서부앞바다 -> 북서연안바다

        let imageName = null;
        // coastal.name이 정확히 키와 일치하는지 확인
        if (COASTAL_ZONES_IMAGES[parentZoneName][coastal.name]) {
            imageName = COASTAL_ZONES_IMAGES[parentZoneName][coastal.name];
        }
        // 예외: "연안바다"라는 이름이 중복되므로 parentZoneName으로 구분된 데이터에서 찾음.
        // 데이터 구조상 parentZoneName 키 아래에 "연안바다" 키가 있으면 매칭됨.

        if (imageName) {
            const mapBtn = document.createElement('button');
            mapBtn.innerHTML = '🗺️'; // 지도 아이콘
            mapBtn.title = '구역 지도 보기';
            mapBtn.style.cssText = `
                background: none; border: 1px solid #555; border-radius: 4px;
                color: #ccc; cursor: pointer; margin-left: 8px; padding: 2px 6px;
                font-size: 0.8rem; vertical-align: middle; transition: background 0.2s;
            `;
            mapBtn.onmouseover = () => mapBtn.style.background = 'rgba(255,255,255,0.1)';
            mapBtn.onmouseout = () => mapBtn.style.background = 'none';
            mapBtn.onclick = (e) => {
                e.stopPropagation(); // 카드 확장 방지
                showImageModal(imageName, `${parentZoneName} ${coastal.name}`);
            };

            // 이름 옆에 추가 (badge 앞)
            // header flex 순서: Name - (Map) - Badge
            // 현재 구조: nameSpan - badge
            // insertBefore badge if exists, else append

            // Re-ordering logic:
            // Just append to header, but we want it Next to Name.
            // Let's make a left-side container.

            // Override header structure for layout
            header.innerHTML = ''; // Clear and rebuild

            const leftGroup = document.createElement('div');
            leftGroup.style.display = 'flex';
            leftGroup.style.alignItems = 'center';
            leftGroup.style.gap = '6px';

            leftGroup.appendChild(nameSpan);
            leftGroup.appendChild(mapBtn);

            header.appendChild(leftGroup);
        }
    }

    // 만약 지도가 없어서 mapBtn을 안 만들었다면 name만 있어도 rebuild 필요할 수 있음
    // 혹은 위 if문 밖에서 로직 처리.
    // 기존 로직 유지를 위해:
    if (header.children.length === 0) {
        // Re-append name only
        header.appendChild(nameSpan);
    }

    if (alertData && alertData.length > 0) {
        // 특보가 있는 경우 (배열 처리)
        const badgeContainer = document.createElement('div');
        badgeContainer.style.display = 'flex';
        badgeContainer.style.gap = '4px';
        badgeContainer.style.flexWrap = 'wrap';
        badgeContainer.style.justifyContent = 'flex-end';

        // 정렬 적용 (태풍 우선)
        const sortedAlerts = sortAlertItems(alertData);

        const now = getKfTime();

        // [문제4 해결] 장부에서 실제 발효 중인 특보 정보 확인
        let activeAlertFromLedger = null;
        let pendingAlert = null;

        sortedAlerts.forEach(alert => {
            const cleanEf = String(alert.tmEf || '').replace(/[^0-9]/g, '');
            const isAwaiting = cleanEf && cleanEf.length >= 12 && now < cleanEf;

            if (alert.isPreliminary || isAwaiting) {
                // 예비/대기 상태
                pendingAlert = alert;
            } else {
                // 발효 중 상태
                activeAlertFromLedger = alert;
            }
        });

        // [A안 적용] 발효 중인 특보 없고 예비만 있으면, 히스토리에서 찾지 않음
        // activeAlert가 null이면 발효 중인 특보 없음
        // 더 이상 히스토리에서 이전 발효 특보를 찾지 않음

        // 1. [A안 적용] 발효 중인 특보가 있으면 그것만 표시
        if (activeAlertFromLedger && !activeAlertFromLedger.isPreliminary) {
            const badge = document.createElement('span');
            badge.className = 'status-badge warning';
            badge.style.fontSize = '0.7rem';
            badge.style.padding = '1px 6px';
            badge.textContent = `${activeAlertFromLedger.warnType} ${activeAlertFromLedger.level}`;
            badgeContainer.appendChild(badge);
        }
        // 2. 발효 중인 특보가 없으면 예비/대기만 표시
        else if (pendingAlert) {
            const badge = document.createElement('span');
            badge.className = 'status-badge preliminary';
            badge.style.fontSize = '0.7rem';
            badge.style.padding = '1px 6px';
            // [수정] level이 '예비'이면 ' 예비' 중복 방지
            const cleanType = (pendingAlert.warnType || '').replace(/주의보|경보/g, '').trim();
            badge.textContent = `${cleanType} 예비`;
            badgeContainer.appendChild(badge);
        }

        // 3. 배지가 하나도 없으면 원래 로직 fallback
        if (badgeContainer.children.length === 0) {
            sortedAlerts.forEach(alert => {
                const badge = document.createElement('span');
                const cleanEf = String(alert.tmEf || '').replace(/[^0-9]/g, '');
                const isAwaiting = !alert.isPreliminary && cleanEf && cleanEf.length >= 12 && now < cleanEf;

                badge.className = `status-badge ${alert.isPreliminary || isAwaiting ? 'preliminary' : 'warning'}`;
                badge.style.fontSize = '0.7rem';
                badge.style.padding = '1px 6px';

                badge.textContent = (alert.isPreliminary || isAwaiting)
                    ? `${(alert.warnType || '').replace(/주의보|경보/g, '').trim()} 예비`
                    : `${alert.warnType} ${alert.level}`;

                badgeContainer.appendChild(badge);
            });
        }

        header.appendChild(badgeContainer);

        // 시각적 강조 (가장 높은 등급 기준)
        const hasWarning = sortedAlerts.some(a => !a.isPreliminary);
        item.style.borderLeft = `3px solid ${hasWarning ? '#ff6b6b' : '#ffb74d'}`;
        item.style.cursor = 'pointer';

        item.appendChild(header);

        // 상세 정보 영역 (모든 특보 정보를 순회하며 표시)
        const detailBox = document.createElement('div');
        detailBox.className = 'coastal-detail-box';
        detailBox.style.cssText = `
            display: none;
            margin-top: 8px;
            padding: 8px 10px;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 4px;
            font-size: 0.8rem;
            color: #aaa;
        `;

        // [수정] 범용 시각 포맷팅 함수 (글로벌 함수 활용)
        const formatWarningTimeLocal = (timeStr) => {
            return formatWarningTime(timeStr);
        };

        // [수정] 상세 정보 영역 표시 전 중복 제거 (종류와 등급이 같으면 하나만 표시)
        const uniqueCoastalAlerts = [];
        const coastalSeen = new Set();
        sortedAlerts.forEach(a => {
            const key = `${a.warnType}|${a.level}`;
            if (!coastalSeen.has(key)) {
                uniqueCoastalAlerts.push(a);
                coastalSeen.add(key);
            }
        });

        uniqueCoastalAlerts.forEach((alert, index) => {
            const tmFcFormatted = formatWarningTime(alert.tmFc);
            const tmEfFormatted = formatWarningTime(alert.tmEf);
            let tmEdFormatted = '정보 없음';
            if (alert.tmEd && alert.tmEd.trim().length > 2 && !alert.isPreliminary) {
                tmEdFormatted = formatWarningTime(alert.tmEd);
            }

            // [수정] 둘 이상의 서로 다른 특보 정보가 있을 때만 타이틀 표시
            if (uniqueCoastalAlerts.length > 1) {
                const alertTitle = document.createElement('div');
                alertTitle.style.cssText = `
                    margin-bottom: 6px;
                    padding-top: ${index > 0 ? '8px' : '0'};
                    border-top: ${index > 0 ? '1px dashed rgba(255,255,255,0.1)' : 'none'};
                    color: ${alert.isPreliminary ? '#ffb74d' : '#ff6b6b'};
                    font-weight: 700;
                    font-size: 0.75rem;
                `;
                // 명칭 구성: 예비 단계이면 '풍랑 주의보 예정' 등
                const isPrelim = alert.isPreliminary || (alert.rawTmEf && getKfTime() < alert.rawTmEf.replace(/[^0-9]/g, ''));
                alertTitle.textContent = `● ${alert.warnType} ${alert.level}${isPrelim ? ' 예정' : ''}`;
                detailBox.appendChild(alertTitle);
            }

            // [Fix] 3줄 평평한 구조 + 해제예정 All Green
            const createRow = (label, value, color) => `
                <div style="display: flex; justify-content: space-between; margin-bottom: 3px; font-size: 0.75rem;">
                    <span style="color: #777;">${label}</span>
                    <span style="color: ${color || '#e6edf3'}; font-weight: 500;">${value}</span>
                </div>`;

            const infoHtml =
                createRow('발표시각', tmFcFormatted) +
                createRow('발효시각', tmEfFormatted) +
                createRow('해제예정', tmEdFormatted, '#69f0ae'); // 무조건 초록색

            const infoContainer = document.createElement('div');
            infoContainer.innerHTML = infoHtml;
            // 마지막 요소가 아니면 마진
            if (index < uniqueCoastalAlerts.length - 1) {
                infoContainer.style.marginBottom = '10px';
            }
            detailBox.appendChild(infoContainer);
        });

        item.appendChild(detailBox);

        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = detailBox.style.display === 'block';
            detailBox.style.display = isVisible ? 'none' : 'block';
        });

    } else {
        // 특보가 없는 경우
        const noAlertBadge = document.createElement('span');
        noAlertBadge.style.fontSize = '0.75rem';
        noAlertBadge.style.color = '#69f0ae';
        noAlertBadge.style.padding = '2px 8px';
        noAlertBadge.style.backgroundColor = 'rgba(105, 240, 174, 0.1)';
        noAlertBadge.style.borderRadius = '4px';
        noAlertBadge.textContent = '특보 없음';
        header.appendChild(noAlertBadge);

        item.appendChild(header);
        item.style.opacity = '0.7';
    }

    return item;
}


window.toggleSection = function (id) {
    const list = document.getElementById(id);
    if (!list) return;

    const parent = list.parentElement;
    const isCurrentlyOpen = parent.classList.contains('open');

    // 1. 모든 해역 섹션을 닫음 (배타적 모드)
    const allSections = document.querySelectorAll('.sea-section');
    allSections.forEach(section => {
        section.classList.remove('open');
    });

    // 2. 이전에 닫혀있었다면, 현재 섹션만 열기
    if (!isCurrentlyOpen) {
        parent.classList.add('open');
    }
};

function updateLoading(isLoading) {
    appState.isLoading = isLoading;
    const indicator = document.getElementById('loading-indicator');
    const content = document.getElementById('alert-content');
    const headerStatus = document.querySelector('.header-status');

    if (isLoading) {
        if (indicator) indicator.classList.remove('hidden');
        if (content) content.classList.add('hidden');

        // 헤더 뱃지 영역에 스피너 표시
        if (headerStatus) {
            // 아이콘 보존을 위해 새로 생성
            headerStatus.innerHTML = `
                <span style="color: rgba(255,255,255,0.5); font-size: 0.85rem; margin-right: 8px;">
                    <i class="fa-solid fa-spinner fa-spin"></i>
                </span>
                <i id="main-accordion-icon" class="fa-solid fa-chevron-down"></i>
            `;
        }
    } else {
        if (indicator) indicator.classList.add('hidden');
        if (content) content.classList.remove('hidden');
        // 로딩 해제 시 뱃지는 renderApp()에서 렌더링되므로 여기서 처리 불필요
    }
}

function updateTimeDisplay() {
    const now = new Date();
    const dateEl = document.getElementById('current-date');
    const timeEl = document.getElementById('current-time');

    if (dateEl && timeEl) {
        const options = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
        dateEl.textContent = now.toLocaleDateString('ko-KR', options);
        timeEl.textContent = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    }
}

// ============================================================
// 🌊 해구별 기상정보 (APIHub)
// ============================================================

/**
 * 해구 데이터 조회 및 모달 표시
 * @param {string} zoneId 해구번호
 */

// 모달 닫기
window.closeSeaZoneModal = function () {
    // 진행 중인 요청 취소 (요청 ID 무효화)
    window._marineZoneRequestId = null;

    const modal = document.getElementById('sea-zone-modal');
    if (modal) {
        // 차트 인스턴스 정리 (메모리 누수 방지)
        const chartCanvas = document.getElementById('marineChart');
        if (chartCanvas) {
            const chartInstance = Chart.getChart(chartCanvas);
            if (chartInstance) chartInstance.destroy();
        }
        // 모달 완전 제거 (다음 호출 시 새로 생성)
        modal.remove();
    }
};

// 로컬 서버에서 해구별 데이터 받아오기
window.getMarineZoneData = async function (zoneId) {
    // 요청 ID 생성 (모달 닫기 시 취소 확인용)
    const requestId = Date.now() + '_' + zoneId;
    window._marineZoneRequestId = requestId;

    showMarineZoneModal(zoneId, null, true);

    // 대해구 번호 추출
    let lZone = zoneId;
    let isSmallZone = false;

    if (String(zoneId).includes('-')) {
        const parts = String(zoneId).split('-');
        lZone = parts[0];
        isSmallZone = true;
    }

    try {
        // 로컬 서버에서 데이터 가져오기
        const response = await fetch('/api/marine-zone-forecasts');
        if (!response.ok) throw new Error('로컬 서버 응답 오류');

        const json = await response.json();

        // 요청이 취소되었는지 확인
        if (requestId !== window._marineZoneRequestId) return;

        // 데이터 찾기
        const zoneData = json.data && json.data[lZone];

        if (zoneData && zoneData.length > 0) {
            // displayTime 추가
            const formattedData = zoneData.map(item => ({
                ...item,
                displayTime: formatMarineTime(item.tm)
            }));
            formattedData.baseTime = json.baseTmUtf;

            showMarineZoneModal(zoneId, formattedData, false, null, json.baseTmUtf);
        } else {
            showMarineZoneModal(zoneId, null, false,
                `해당 해구(${zoneId})의 데이터가 없습니다.<br>스케줄러가 데이터를 수집할 때까지 기다려주세요.`);
        }
    } catch (error) {
        // console.error('해구별 데이터 조회 오류:', error);
        if (requestId !== window._marineZoneRequestId) return;
        showMarineZoneModal(zoneId, null, false, `데이터 조회 중 오류: ${error.message}`);
    }
};

// 데이터 파싱 함수
function parseMarineZoneData(text) {
    const lines = text.trim().split('\n');
    const result = [];

    let headerIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('m/s') || lines[i].includes('sec') || lines[i].includes('deg')) {
            headerIndex = i;
            break;
        }
    }

    const startIndex = (headerIndex !== -1) ? headerIndex + 1 : 0;

    for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.length === 0 || line.startsWith('#') || line.startsWith('/')) continue;

        const parts = line.split(/\s+/);
        if (parts.length < 10) continue;

        const len = parts.length;
        const tm = parts[1];
        const wh = parseFloat(parts[len - 5]);
        const wp = parseFloat(parts[len - 4]);
        const waveDir = parseFloat(parts[len - 3]);
        const ws = parseFloat(parts[len - 2]);
        const windDir = parseFloat(parts[len - 1]);

        if (!isNaN(wh)) {
            result.push({
                tm: tm,
                displayTime: formatMarineTime(tm),
                wh: wh,
                wp: wp,
                waveDir: waveDir,
                ws: ws,
                windDir: windDir
            });
        }
    }
    return result;
}

// 시간 포맷팅 (YYYYMMDDHH -> MM.DD HH시)
function formatMarineTime(tm) {
    if (!tm || tm.length < 10) return tm;
    const mm = tm.substring(4, 6);
    const dd = tm.substring(6, 8);
    const hh = tm.substring(8, 10);
    return `${mm}.${dd} ${hh}시`;
}

// 현재 표시 중인 해구 정보 (Windy 연동용)
let currentZoneInfo = { zoneId: null, lat: null, lon: null };

/**
 * 해구 번호에서 경위도 추출
 * SEA_ZONES_DATA의 격자 키를 역으로 파싱하여 중심 경위도 계산
 */
function getZoneCoordinatesByZoneId(zoneId) {
    if (typeof SEA_ZONES_DATA === 'undefined' || typeof GRID_DATA === 'undefined') {
        // console.warn('SEA_ZONES_DATA 또는 GRID_DATA가 없습니다.');
        return null;
    }

    // SEA_ZONES_DATA에서 해당 zoneId를 가진 격자 키 찾기
    let foundKey = null;
    for (const [key, value] of Object.entries(SEA_ZONES_DATA)) {
        if (String(value) === String(zoneId)) {
            foundKey = key;
            break;
        }
    }

    if (!foundKey) {
        // [New] 소해구 ID 처리 (예: "244-1") - 픽셀 역산으로 좌표 추정
        if (typeof zoneId === 'string' && zoneId.includes('-')) {
            const parts = zoneId.split('-');
            if (parts.length === 2 && !isNaN(parts[1])) {
                const parentZoneNum = parts[0];
                const smallIdx = parseInt(parts[1], 10);

                // 부모 대해구 키 찾기
                let parentKey = null;
                for (const [key, value] of Object.entries(SEA_ZONES_DATA)) {
                    if (String(value) === String(parentZoneNum)) {
                        parentKey = key;
                        break;
                    }
                }

                if (parentKey) {
                    // 부모 격자 정보 파싱
                    const match = parentKey.match(/^(\d+)-(\d+)_(\d+)-(\d+)$/);
                    if (match && typeof GRID_DATA !== 'undefined') {
                        const lon1Key = match[1];
                        const lon2Key = match[2];
                        const lat1Key = match[3];
                        const lat2Key = match[4];

                        const x1 = GRID_DATA.lon[lon1Key]?.val;
                        const x2 = GRID_DATA.lon[lon2Key]?.val;
                        const y1 = GRID_DATA.lat[lat1Key]?.val;
                        const y2 = GRID_DATA.lat[lat2Key]?.val;

                        if (x1 != null && x2 != null && y1 != null && y2 != null) {
                            const width = x2 - x1;
                            const height = y2 - y1;
                            const cellW = width / 3;
                            const cellH = height / 3;

                            // 소해구 인덱스 (1~9) -> 행/열 (0~2)
                            // row 0: 1,2,3 / row 1: 4,5,6 / row 2: 7,8,9
                            const row = Math.floor((smallIdx - 1) / 3);
                            const col = (smallIdx - 1) % 3;

                            // 소해구 중심 픽셀
                            const centerX = x1 + col * cellW + cellW / 2;
                            const centerY = y1 + row * cellH + cellH / 2;

                            // 픽셀 -> GPS 변환
                            const gps = pixelToGps(centerX, centerY);
                            if (gps && gps.lat && gps.lon) {
                                // console.log(`소해구 ${zoneId} 좌표 계산됨:`, gps);
                                return { lat: gps.lat, lon: gps.lon };
                            }
                        }
                    }
                }
            }
        }

        // console.debug(`해구 ${zoneId}의 격자 키를 찾을 수 없습니다.`);
        return null;
    }

    // 격자 키 파싱: "lon1-lon2_lat1-lat2" 형식
    // 예: "125-129_65-62"
    const match = foundKey.match(/^(\d+)-(\d+)_(\d+)-(\d+)$/);
    if (!match) {
        // console.warn(`격자 키 파싱 실패: ${foundKey}`);
        return null;
    }

    const lon1Key = match[1];
    const lon2Key = match[2];
    const lat1Key = match[3];
    const lat2Key = match[4];

    // GRID_DATA에서 픽셀 좌표 가져오기
    const lon1Pixel = GRID_DATA.lon[lon1Key]?.val;
    const lon2Pixel = GRID_DATA.lon[lon2Key]?.val;
    const lat1Pixel = GRID_DATA.lat[lat1Key]?.val;
    const lat2Pixel = GRID_DATA.lat[lat2Key]?.val;

    if (lon1Pixel == null || lon2Pixel == null || lat1Pixel == null || lat2Pixel == null) {
        // console.warn(`GRID_DATA에서 값을 찾을 수 없습니다: ${foundKey}`);
        return null;
    }

    // 격자 중심 픽셀 좌표 계산
    const centerPixelX = (lon1Pixel + lon2Pixel) / 2;
    const centerPixelY = (lat1Pixel + lat2Pixel) / 2;

    // 픽셀 → GPS 좌표 변환 (함수 사용)
    const gps = pixelToGps(centerPixelX, centerPixelY);
    if (gps) {
        // console.log(`📍 해구 ${zoneId} 경위도: ${gps.lat.toFixed(2)}, ${gps.lon.toFixed(2)}`);
        return gps;
    }

    return null;
}

/**
 * 픽셀 좌표를 GPS 좌표(경도, 위도)로 변환
 * @param {number} x - 픽셀 X
 * @param {number} y - 픽셀 Y
 * @returns {{lat: number, lon: number}} GPS 좌표
 */
function pixelToGps(x, y) {
    if (typeof GRID_CALIBRATION_DATA === 'undefined') return null;

    // X -> Lon 변환
    let lon = null;
    const lonKeys = Object.keys(GRID_CALIBRATION_DATA.lon).map(Number).sort((a, b) => a - b);
    for (let i = 0; i < lonKeys.length - 1; i++) {
        const k1 = lonKeys[i];
        const k2 = lonKeys[i + 1];
        const x1 = GRID_CALIBRATION_DATA.lon[k1];
        const x2 = GRID_CALIBRATION_DATA.lon[k2];

        if (x >= x1 && x <= x2) {
            const ratio = (x - x1) / (x2 - x1);
            lon = k1 + (k2 - k1) * ratio;
            break;
        }
    }
    // 범위를 약간 벗어난 경우 가장자리 값 사용 (보외법 또는 클램핑)
    if (lon === null) {
        if (x < GRID_CALIBRATION_DATA.lon[lonKeys[0]]) lon = lonKeys[0];
        else if (x > GRID_CALIBRATION_DATA.lon[lonKeys[lonKeys.length - 1]]) lon = lonKeys[lonKeys.length - 1];
    }

    // Y -> Lat 변환 (Lat는 위쪽이 값이 큼, 픽셀 Y는 아래쪽이 큼)
    let lat = null;
    const latKeys = Object.keys(GRID_CALIBRATION_DATA.lat).map(Number).sort((a, b) => a - b); // 오름차순

    for (let i = 0; i < latKeys.length - 1; i++) {
        const k1 = latKeys[i];
        const k2 = latKeys[i + 1];

        // 주의: 위도가 높을수록(북쪽) 픽셀 Y값은 작음(위쪽)
        const y_at_k1 = GRID_CALIBRATION_DATA.lat[k1]; // 큰 Y (저위도)
        const y_at_k2 = GRID_CALIBRATION_DATA.lat[k2]; // 작은 Y (고위도)

        // 범위 체크 (y_at_k2 <= y <= y_at_k1)
        const minY = Math.min(y_at_k1, y_at_k2);
        const maxY = Math.max(y_at_k1, y_at_k2);

        if (y >= minY && y <= maxY) {
            // 역비율 계산
            const ratio = (y - y_at_k1) / (y_at_k2 - y_at_k1);
            lat = k1 + (k2 - k1) * ratio;
            break;
        }
    }

    // 범위 밖 처리
    if (lat === null) {
        // 간단히 가장 가까운 Y값의 위도 반환
        let minDiff = Infinity;
        let closestLat = latKeys[0];

        for (const k of latKeys) {
            const diff = Math.abs(y - GRID_CALIBRATION_DATA.lat[k]);
            if (diff < minDiff) {
                minDiff = diff;
                closestLat = k;
            }
        }
        lat = closestLat;
    }

    return { lon: lon || 126.5, lat: lat || 35.0 };
}

/**
 * 현재 해구의 Windy 팝업 열기 (새 창 대신 팝업 모달)
 */
function openZoneWindy() {
    if (!currentZoneInfo.lat || !currentZoneInfo.lon) {
        alert('해구 위치 정보를 찾을 수 없습니다.');
        return;
    }

    const lat = currentZoneInfo.lat.toFixed(3);
    const lon = currentZoneInfo.lon.toFixed(3);
    const zoneId = currentZoneInfo.zoneId;

    // embed.windy.com URL 생성
    const embedUrl = `https://embed.windy.com/embed2.html?lat=${lat}&lon=${lon}&zoom=7&level=surface&overlay=waves&product=ecmwf&menu=false&message=true&marker=&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=m%2Fs&metricTemp=%C2%B0C&radarRange=-1`;
    const windyUrl = `https://www.windy.com/waves?waves,${lat},${lon},8`;

    // 기존 모달 제거
    const existingModal = document.getElementById('zone-windy-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'zone-windy-modal';
    modal.innerHTML = `
        <div class="zone-windy-overlay" onclick="closeZoneWindyPopup()"></div>
        <div class="zone-windy-content">
            <div class="zone-windy-header">
                <h3><i class="fa-solid fa-wind"></i> ${zoneId}해구 기상전망 - Windy</h3>
                <button class="zone-windy-close" onclick="closeZoneWindyPopup()">✕</button>
            </div>
            <div class="zone-windy-iframe">
                <iframe src="${embedUrl}" frameborder="0" allowfullscreen></iframe>
            </div>
            <div class="zone-windy-footer">
                <a href="${windyUrl}" target="_blank" class="zone-windy-link">
                    🔗 새 탭에서 열기
                </a>
            </div>
        </div>
    `;

    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 20000;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    // ⭐ CSS 스타일 추가 (없으면 생성)
    if (!document.getElementById('zone-windy-modal-style')) {
        const style = document.createElement('style');
        style.id = 'zone-windy-modal-style';
        style.textContent = `
            .zone-windy-overlay {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.85);
                backdrop-filter: blur(5px);
            }
            .zone-windy-content {
                position: relative;
                width: 90%;
                max-width: 1200px;
                height: 85vh;
                background: #1a1e2e;
                border-radius: 16px;
                overflow: hidden;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
                animation: zoneWindyIn 0.3s ease-out;
                display: flex;
                flex-direction: column;
            }
            @keyframes zoneWindyIn {
                from {
                    opacity: 0;
                    transform: scale(0.9) translateY(20px);
                }
                to {
                    opacity: 1;
                    transform: scale(1) translateY(0);
                }
            }
            .zone-windy-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 16px 20px;
                background: linear-gradient(135deg, #00c6ff, #0072ff);
                color: white;
            }
            .zone-windy-header h3 {
                margin: 0;
                font-size: 1.1rem;
                font-weight: 600;
            }
            .zone-windy-close {
                background: rgba(255, 255, 255, 0.2);
                border: none;
                color: white;
                width: 32px;
                height: 32px;
                border-radius: 50%;
                font-size: 1.2rem;
                cursor: pointer;
                transition: all 0.2s;
            }
            .zone-windy-close:hover {
                background: rgba(255, 255, 255, 0.4);
                transform: scale(1.1);
            }
            .zone-windy-iframe {
                flex: 1;
                background: #0a0a0a;
            }
            .zone-windy-iframe iframe {
                width: 100%;
                height: 100%;
                border: none;
            }
            .zone-windy-footer {
                padding: 12px 20px;
                background: rgba(0, 0, 0, 0.3);
                text-align: center;
            }
            .zone-windy-link {
                color: #00c6ff;
                text-decoration: none;
                font-size: 0.9rem;
                transition: color 0.2s;
            }
            .zone-windy-link:hover {
                color: #66d9ff;
            }
            @media (max-width: 768px) {
                .zone-windy-content {
                    width: 95%;
                    height: 90vh;
                    border-radius: 12px;
                }
                .zone-windy-header {
                    padding: 12px 16px;
                }
                .zone-windy-header h3 {
                    font-size: 1rem;
                }
            }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(modal);
}

// Zone Windy 팝업 닫기
function closeZoneWindyPopup() {
    const modal = document.getElementById('zone-windy-modal');
    if (modal) modal.remove();
}

// Windy 함수 전역 노출
window.openZoneWindy = openZoneWindy;
window.closeZoneWindyPopup = closeZoneWindyPopup;

// 데이터 표시 및 차트/테이블 렌더링
function showMarineZoneModal(zoneId, data, isLoading, errorMessage, baseTime = null) {
    let modal = document.getElementById('sea-zone-modal');
    const isMobile = window.innerWidth <= 768;

    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'sea-zone-modal';
        modal.className = 'modal';
        modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); display:flex; justify-content:center; align-items:center; z-index:10000; padding:20px; box-sizing:border-box; backdrop-filter:blur(5px); opacity:0; transition:opacity 0.3s ease;';

        const modalWidth = isMobile ? '100%' : 'auto';
        const modalHeight = 'auto';
        const modalRadius = '16px';
        const modalMaxWidth = isMobile ? '100%' : '1400px';

        modal.innerHTML = `
        <div class="modal-content" style="background:#1e1e1e; width:${modalWidth}; min-width:${isMobile ? '0' : '600px'}; max-width:${modalMaxWidth}; max-height:90vh; height:${isMobile ? 'auto' : 'auto'}; border-radius:${modalRadius}; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 10px 40px rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.1); transform:translateY(20px); transition:transform 0.3s ease;">
            <div class="modal-header" style="background:#2c3e50; color:white; padding:12px 15px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #333; flex-shrink:0;">
                <div style="display:flex; align-items:center; gap:12px;">
                    <h3 style="margin:0; font-size:${isMobile ? '16px' : '18px'}; display:flex; align-items:center; gap:8px;">
                        <i class="fas fa-water"></i> <span id="zone-modal-title"></span>
                    </h3>
                    <button id="zone-windy-btn" onclick="openZoneWindy()" style="display:flex; align-items:center; gap:5px; background:linear-gradient(135deg, #00c6fb, #005bea); border:none; color:white; padding:6px 12px; border-radius:16px; font-size:${isMobile ? '12px' : '13px'}; font-weight:600; cursor:pointer; transition:all 0.2s; box-shadow:0 2px 8px rgba(0,91,234,0.3);" title="Windy에서 보기">
                        <i class="fas fa-wind"></i> Windy
                    </button>
                </div>
                <button onclick="closeSeaZoneModal()" style="background:none; border:none; color:#aaa; font-size:28px; cursor:pointer; padding:5px 10px; touch-action:manipulation;" title="닫기"><i class="fas fa-times"></i></button>
            </div>
            <div id="zone-modal-body" style="flex:1; padding:${isMobile ? '10px' : '15px'}; overflow:auto; color:#eee; font-family:'NotosansKR', sans-serif; -webkit-overflow-scrolling:touch;">
            </div>
        </div>`;
        document.body.appendChild(modal);
    }

    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    // 열기 애니메이션
    requestAnimationFrame(() => {
        modal.style.opacity = '1';
        const content = modal.querySelector('.modal-content');
        if (content) content.style.transform = 'translateY(0)';
    });

    const titleSpan = document.getElementById('zone-modal-title');
    if (titleSpan) titleSpan.textContent = `${zoneId}해구 기상전망`;

    // 현재 해구 정보 저장 (Windy 연동용)
    currentZoneInfo.zoneId = zoneId;
    const coords = getZoneCoordinatesByZoneId(zoneId);
    if (coords) {
        currentZoneInfo.lat = coords.lat;
        currentZoneInfo.lon = coords.lon;
    } else {
        // 좌표를 찾지 못한 경우 기본값 사용 (한반도 중심)
        currentZoneInfo.lat = 35.5;
        currentZoneInfo.lon = 127.0;
    }

    let baseTimeFormatted = '';
    if (baseTime) {
        const bt = String(baseTime);
        if (bt.length >= 10) {
            const y = bt.substring(0, 4);
            const m = bt.substring(4, 6);
            const d = bt.substring(6, 8);
            const h = bt.substring(8, 10);
            baseTimeFormatted = `${y}.${m}.${d} ${h}:00 발표`;
        } else {
            baseTimeFormatted = `발표시각: ${bt}`;
        }
    }

    const body = document.getElementById('zone-modal-body');
    if (!body) return;

    if (isLoading) {
        body.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%;">
            <i class="fas fa-spinner fa-spin fa-3x" style="color:#3498db; margin-bottom:20px;"></i>
            <div style="font-size:16px; color:#aaa;">기상청 데이터를 분석 중입니다...</div>
        </div>`;
        return;
    }

    if (errorMessage) {
        body.innerHTML = `
        <div style="text-align:center; padding:50px; color:#e74c3c;">
            <i class="fas fa-exclamation-triangle fa-3x" style="margin-bottom:15px;"></i>
            <h3>데이터 조회 실패</h3>
            <p>${errorMessage}</p>
        </div>`;
        return;
    }

    if (!data || data.length === 0) {
        body.innerHTML = '<div style="text-align:center; padding:50px;">데이터가 없습니다.</div>';
        return;
    }

    // 날짜별 그룹화
    const dateGroups = {};
    data.forEach(row => {
        const date = row.tm.substring(0, 8);
        if (!dateGroups[date]) dateGroups[date] = [];
        dateGroups[date].push(row);
    });

    // 테이블 HTML 생성
    // 테이블 HTML 생성
    let tableHTML = '<div id="marine-table-container" style="position:relative; overflow-x:auto; overflow-y:auto; -webkit-overflow-scrolling:touch; max-height:100%; touch-action:pan-x pan-y;"><table id="marine-zone-table" style="border-collapse:collapse; table-layout:fixed; font-size:12px; margin:0 auto; background:#1a1a1a;">';

    // 헤더: 날짜 행
    tableHTML += '<thead><tr style="background:#2c3e50; color:#fff; border-bottom:2px solid #3498db;">';
    tableHTML += `<th style="padding:5px 8px; border:1px solid #333; width:45px; min-width:45px; text-align:center; position:sticky; left:0; background:#2c3e50; z-index:2;">날짜</th>`;

    Object.keys(dateGroups).forEach(date => {
        const mm = date.substring(4, 6);
        const dd = date.substring(6, 8);
        const count = dateGroups[date].length;
        tableHTML += `<th colspan="${count}" style="padding:5px; border:1px solid #333; background:#34495e;">${mm}.${dd}.</th>`;
    });
    tableHTML += '</tr>';

    // 헤더: 시간 행
    tableHTML += '<tr style="background:#34495e; color:#ddd; border-bottom:1px solid #555;">';
    tableHTML += '<th style="padding:4px 8px; border:1px solid #333; text-align:center; position:sticky; left:0; background:#34495e; z-index:2;">시간</th>';

    const cellStyle = 'width:45px; min-width:45px; max-width:45px; box-sizing:border-box; padding:3px 0; border:1px solid #333; text-align:center;';

    data.forEach((row, index) => {
        const hh = row.tm.substring(8, 10);
        tableHTML += `<td id="time-cell-${index}" data-index="${index}" style="${cellStyle} font-weight:bold;">${hh}시</td>`;
    });
    tableHTML += '</tr></thead><tbody>';

    // 행 1: 풍향
    tableHTML += '<tr style="background:#1e1e1e; border-bottom:1px solid #333;">';
    tableHTML += '<th style="padding:4px 8px; border:1px solid #333; text-align:center; position:sticky; left:0; background:#2c3e50; z-index:1; color:#4fc3f7; font-size:10px;"> 풍향<br><span style="font-size:9px; font-weight:normal; color:#888;">(deg)</span></th>';
    data.forEach(row => {
        tableHTML += `<td style="${cellStyle}"><i class="fas fa-arrow-up" style="transform:rotate(${row.windDir}deg); color:#4fc3f7; font-size:14px;"></i></td>`;
    });
    tableHTML += '</tr>';

    // 행 2: 풍속
    tableHTML += '<tr style="background:#1a1a1a; border-bottom:1px solid #333;">';
    tableHTML += '<th style="padding:4px 8px; border:1px solid #333; text-align:center; position:sticky; left:0; background:#2c3e50; z-index:1; color:#ff7043; font-size:10px;"> 풍속<br><span style="font-size:9px; font-weight:normal; color:#888;">(m/s)</span></th>';
    data.forEach(row => {
        const color = getMarineWindColor(row.ws);
        tableHTML += `<td style="${cellStyle} color:${color}; font-weight:bold; font-size:11px;">${row.ws.toFixed(1)}</td>`;
    });
    tableHTML += '</tr>';

    // 행 3: 그래프
    const CHART_OFFSET_LEFT = 0;
    const CHART_WIDTH_ADJUST = -3;
    const cellWidth = 45;
    const chartWidth = (data.length * cellWidth) + CHART_WIDTH_ADJUST;

    tableHTML += '<tr style="background:#222;">';
    tableHTML += `<th style="padding:4px 6px; border:1px solid #333; text-align:center; position:sticky; left:0; background:#2c3e50; z-index:1; vertical-align:middle;">
    <div style="display:flex; flex-direction:column; gap:2px; font-size:9px; align-items:center;">
        <span style="color:#ff7043;">풍속</span>
        <span style="display:inline-block; width:20px; height:3px; background:#ff7043; border-radius:2px;"></span>
        <span style="color:#26c6da; margin-top:4px;">유의</span>
        <span style="color:#26c6da;">파고</span>
        <span style="display:inline-block; width:10px; height:10px; background:rgba(38,198,218,0.6); border:1px solid #26c6da; border-radius:2px;"></span>
    </div>
</th>`;
    tableHTML += `<td colspan="${data.length}" style="padding:0; border:1px solid #333; overflow:hidden; box-sizing:border-box;">`;
    tableHTML += `<div style="width:${chartWidth}px; height:140px; margin:0; padding-left:${CHART_OFFSET_LEFT}px; display:block; box-sizing:border-box;"><canvas id="marineChart" width="${chartWidth}" height="140" style="display:block;"></canvas></div>`;
    tableHTML += '</td></tr>';

    // 행 4: 유의파고
    tableHTML += '<tr style="background:#1a1a1a; border-bottom:1px solid #333;">';
    tableHTML += '<th style="padding:4px 8px; border:1px solid #333; text-align:center; position:sticky; left:0; background:#2c3e50; z-index:1; color:#26c6da; font-size:10px;"> 유의<br>파고<br><span style="font-size:9px; font-weight:normal; color:#888;">(m)</span></th>';
    data.forEach(row => {
        const color = getMarineWaveColor(row.wh);
        tableHTML += `<td style="${cellStyle} color:${color}; font-weight:bold; font-size:11px;">${row.wh.toFixed(1)}</td>`;
    });
    tableHTML += '</tr>';

    // 행 5: 파향
    tableHTML += '<tr style="background:#1e1e1e; border-bottom:1px solid #333;">';
    tableHTML += '<th style="padding:4px 8px; border:1px solid #333; text-align:center; position:sticky; left:0; background:#2c3e50; z-index:1; color:#81c784; font-size:10px;"> 파향<br><span style="font-size:9px; font-weight:normal; color:#888;">(deg)</span></th>';
    data.forEach(row => {
        tableHTML += `<td style="${cellStyle}"><i class="fas fa-location-arrow" style="transform:rotate(${row.waveDir}deg); color:#81c784; font-size:14px;"></i></td>`;
    });
    tableHTML += '</tr>';

    // 행 6: 파주기
    tableHTML += '<tr style="background:#1a1a1a;">';
    tableHTML += '<th style="padding:4px 8px; border:1px solid #333; text-align:center; position:sticky; left:0; background:#2c3e50; z-index:1; color:#9575cd; font-size:10px;"> 파주기<br><span style="font-size:9px; font-weight:normal; color:#888;">(sec)</span></th>';
    data.forEach(row => {
        tableHTML += `<td style="${cellStyle} color:#ccc; font-size:12px;">${row.wp.toFixed(1)}</td>`;
    });
    tableHTML += '</tr>';

    tableHTML += '</tbody></table></div>';

    // 스크롤 안내 메시지 (가운데 정렬)
    tableHTML += `<div style="text-align:center; font-size:0.95rem; color:#ffffff; padding:10px 0 4px; font-weight:500;">☜ 밀어서 더 많은 정보를 확인하세요 ☞</div>`;

    // 발표시각 우측 하단 표시
    if (baseTimeFormatted) {
        tableHTML += `<div style="text-align:right; font-size:11px; color:#8899aa; padding:4px 10px 5px;">${baseTimeFormatted}</div>`;
    }

    body.innerHTML = tableHTML;

    // 차트 그리기
    setTimeout(() => renderMarineChart(data), 100);
}

// 풍속 색상
function getMarineWindColor(ws) {
    if (ws >= 14) return '#ff5252';
    if (ws >= 9) return '#ffb74d';
    return '#4fc3f7';
}

// 파고 색상
function getMarineWaveColor(wh) {
    if (wh >= 3.0) return '#ff5252';
    if (wh >= 1.5) return '#ffb74d';
    return '#81c784';
}

// Chart.js 렌더링
function renderMarineChart(data) {
    const canvas = document.getElementById('marineChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const labels = data.map(d => d.displayTime);
    const windSpeed = data.map(d => d.ws);
    const waveHeight = data.map(d => d.wh);

    if (window.currentMarineChart) {
        window.currentMarineChart.destroy();
    }

    if (typeof ChartDataLabels !== 'undefined') {
        Chart.register(ChartDataLabels);
    }

    // [New] 커스텀 조정 플러그인 (오프셋 적용만 유지)
    const adjustmentPlugin = {
        id: 'adjustmentPlugin',
        beforeDatasetsDraw(chart) {
            // 오프셋 적용 Logic
            // index.html에 정의된 CHART_OFFSETS 값을 각 데이터 포인트의 X 좌표에 더함
            if (!window.CHART_OFFSETS) window.CHART_OFFSETS = [];

            chart.data.datasets.forEach((dataset, datasetIndex) => {
                const meta = chart.getDatasetMeta(datasetIndex);
                // bar(1)와 line(0) 모두 적용
                meta.data.forEach((element, index) => {
                    // [Fix] 오프셋 누적 문제 해결: 원래 위치 저장
                    if (typeof element.originalX === 'undefined') {
                        element.originalX = element.x;
                    }

                    const offset = window.CHART_OFFSETS[index] || 0;
                    // 항상 원래 위치 기준으로 오프셋 설정 (누적 방지)
                    element.x = element.originalX + offset;
                });
            });
        }
    };

    window.currentMarineChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '풍속 (m/s)',
                    data: windSpeed,
                    type: 'line',
                    borderColor: '#ff7043',
                    backgroundColor: 'rgba(255, 112, 67, 0.2)',
                    borderWidth: 2,
                    yAxisID: 'y_wind',
                    tension: 0.3,
                    pointRadius: 4,
                    pointBackgroundColor: '#ff7043',
                    // [Fix] 호버 시 애니메이션/스타일 변경 제거
                    pointHoverRadius: 4,
                    pointHoverBackgroundColor: '#ff7043',
                    pointHoverBorderColor: '#ff7043',
                    pointHoverBorderWidth: 0,
                    order: 1, // 라인이 위로 오도록
                    datalabels: {
                        display: true,
                        color: '#ff7043',
                        anchor: (context) => context.dataset.data[context.dataIndex] >= 9.0 ? 'start' : 'end',
                        align: (context) => context.dataset.data[context.dataIndex] >= 9.0 ? 'bottom' : 'top',
                        offset: 4,
                        font: { size: 9, weight: 'bold' },
                        formatter: (value) => value.toFixed(1)
                    }
                },
                {
                    label: '유의파고 (m)',
                    data: waveHeight,
                    type: 'bar',
                    backgroundColor: 'rgba(38, 198, 218, 0.6)',
                    borderColor: '#26c6da',
                    borderWidth: 1,
                    // [Fix] 호버 시 애니메이션/스타일 변경 제거
                    hoverBackgroundColor: 'rgba(38, 198, 218, 0.6)',
                    hoverBorderColor: '#26c6da',
                    hoverBorderWidth: 1,
                    yAxisID: 'y_wave',
                    borderRadius: 2,
                    categoryPercentage: 0.8, // 막대 너비 조정
                    barPercentage: 0.9,
                    maxBarThickness: 40,
                    order: 2,
                    datalabels: {
                        display: true,
                        color: '#fff',
                        anchor: 'center',
                        align: 'center',
                        font: { size: 9, weight: 'bold' },
                        formatter: (value) => value.toFixed(1)
                    }
                }
            ]
        },
        plugins: [ChartDataLabels, adjustmentPlugin],
        options: {
            animation: false,
            hover: { mode: null, animationDuration: 0 },
            responsive: false,
            maintainAspectRatio: false,
            layout: { padding: { left: 0, right: 0, top: 15, bottom: 0 } },
            interaction: {
                mode: 'index',
                intersect: false // 막대 근처만 클릭해도 인식되도록
            },
            plugins: {
                legend: { display: false },
                tooltip: { enabled: true }
            },
            scales: {
                x: {
                    display: false,
                    grid: { display: false },
                    offset: true // 중요: 막대가 틱 사이에 오도록
                },
                y_wind: { type: 'linear', display: false, position: 'left', beginAtZero: true },
                y_wave: { type: 'linear', display: false, position: 'right', beginAtZero: true }
            }
        }
    });
}

// ----------------------------------------------------------------------------
// [Adjustment Logic] 차트 위치 조정 기능 - 삭제됨 (오프셋 적용만 플러그인에서 처리)
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// Tab Navigation
// ----------------------------------------------------------------------------

window.switchMainTab = function (targetId) {
    const tabs = document.querySelectorAll('.tab-btn');
    const contents = document.querySelectorAll('.tab-content');

    // 모든 탭 비활성화
    tabs.forEach(t => t.classList.remove('active'));
    // 모든 컨텐츠 숨기기
    contents.forEach(c => c.classList.remove('active'));

    // 선택된 탭 활성화
    const tab = document.querySelector(`.tab-btn[data-target="${targetId}"]`);
    if (tab) tab.classList.add('active');

    const targetSection = document.getElementById(targetId);
    if (targetSection) {
        targetSection.classList.add('active');

        // 해구별 기상 탭이 활성화될 때 지도 초기화
        if (targetId === 'sea-zone-section') {
            setTimeout(() => {
                if (window.initSeaZoneMap) {
                    window.initSeaZoneMap();
                }
            }, 200);
        }

        // 공지사항 탭 로드
        if (targetId === 'promo-section') {
            if (typeof loadPromoPosts === 'function') setTimeout(loadPromoPosts, 100);
        }
    }
};

function initTabs() {
    // 탭 스타일 주입
    injectTabStyles();

    const tabs = document.querySelectorAll('.tab-btn');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetId = tab.getAttribute('data-target');
            window.switchMainTab(targetId);
        });
    });
}

function injectTabStyles() {
    if (document.getElementById('tab-styles')) return;

    const style = document.createElement('style');
    style.id = 'tab-styles';
    style.textContent = `
        /* 헤더 내부 탭 배치 */
        .main-header {
            padding-bottom: 0 !important;
        }
        
        .main-tabs {
            display: flex;
            justify-content: space-around;
            background: rgba(26, 26, 26, 0.95);
            border-top: 1px solid #333;
            border-bottom: 2px solid #333;
            margin: 7.5px 0 0 0;
            padding: 0;
        }
        .tab-btn {
            flex: 1;
            background: transparent;
            border: none;
            color: #888;
            padding: 7.5px 10px;
            font-size: 0.95rem;
            font-weight: 500;
            cursor: pointer;
            border-bottom: 3px solid transparent;
            transition: all 0.3s ease;
            font-family: 'Noto Sans KR', sans-serif;
        }
        .tab-btn:hover {
            color: #fff;
            background: rgba(52, 152, 219, 0.05);
        }
        .tab-btn.active {
            color: #fff;
            border-bottom: 3px solid #3498db;
            font-weight: 700;
            background: rgba(52, 152, 219, 0.1);
        }
        .tab-content {
            display: none;
            animation: fadeIn 0.3s ease-out;
        }
        .tab-content.active {
            display: block;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        /* 섹션 스타일 통일 */
        .alert-status-section,
        .sea-zone-section {
            background: transparent;
            padding: 0;
            margin: 0;
            border: none;
        }
        
        /* 지도 컨테이너 스타일 */
        .sea-zone-map-container {
            background: transparent;
            padding: 0;
            margin: 20px 0;
        }
        
        /* 지도 출처 정보 */
        .map-source {
            text-align: center;
            margin-top: 10px;
            padding: 8px 0;
        }
        .map-source a {
            color: #8b949e;
            text-decoration: none;
            font-size: 0.85rem;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            transition: color 0.2s;
        }
        .map-source a:hover {
            color: #3498db;
        }
        .map-source i {
            font-size: 0.75rem;
        }
        
        /* 구역 클릭 안내 메시지 애니메이션 */
        @keyframes slideUpFade {
            0% { 
                opacity: 0; 
                transform: translateY(15px);
            }
            15% { 
                opacity: 1; 
                transform: translateY(0);
            }
            85% { 
                opacity: 1; 
                transform: translateY(0);
            }
            100% { 
                opacity: 0; 
                transform: translateY(-10px);
            }
        }
    `;
    document.head.appendChild(style);
}

// ----------------------------------------------------------------------------
// Initialization
// ----------------------------------------------------------------------------

// [Fix] 모바일 UI 개선을 위한 전역 스타일 주입
function injectGlobalStyles() {
    if (document.getElementById('mobile-ui-fix-style')) return;
    const style = document.createElement('style');
    style.id = 'mobile-ui-fix-style';
    style.innerHTML = `
        /* [Mobile UI Fix] 뱃지 및 헤더 밀림 방지 */
        .status-badge {
            white-space: nowrap !important; /* 뱃지 텍스트 줄바꿈 방지 (덩어리로 넘기기) */
        }
        .main-accordion-header {
            flex-wrap: wrap !important; /* 헤더 줄바꿈 허용 */
            gap: 8px !important;
            align-items: center !important;
            height: auto !important; /* 높이 유동적 */
            padding-bottom: 12px !important; /* 줄바꿈 시 여백 확보 */
            padding-top: 12px !important;
        }
        .header-status {
            margin-left: auto !important; /* 우측 정렬 */
            justify-content: flex-end !important;
            display: flex !important;
            flex-wrap: wrap !important;
            gap: 5px !important;
        }
        .section-title {
            white-space: nowrap !important; /* 제목 텍스트 줄바꿈 방지 */
            margin-right: 8px !important; /* 제목과 뱃지 사이 간격 */
            max-width: 100%; /* 너무 길면 말줄임 등 처리 여지 */
        }
        .alert-header {
            flex-wrap: wrap !important; /* 카드 헤더 줄바꿈 허용 */
            align-items: center !important;
            gap: 8px !important;
        }
        .alert-badges {
            justify-content: flex-end !important; /* 뱃지 우측 정렬 */
            margin-left: auto !important;
            flex-wrap: wrap !important;
        }
        /* 뱃지가 다음 줄로 넘어갔을 때 간격 조정 */
        .alert-badges:empty {
            display: none !important;
        }
    `;
    document.head.appendChild(style);
}

// [Fix] 중복 DOMContentLoaded 방지 플래그 - 아래 7904번째 줄에 동일한 핸들러가 있으므로
// 이 핸들러에서는 fetchAllData를 호출하지 않고 초기화 작업만 수행
window.addEventListener('DOMContentLoaded', async () => {
    injectGlobalStyles(); // [Fix] 스타일 주입 호출
    initTabs(); // 탭 초기화
    updateTimeDisplay();
    setInterval(updateTimeDisplay, 60000);
});

window.toggleSection = toggleSection;
window.refreshData = fetchAllData;


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

    // API 코드 찾기
    const regId = getZoneCodeByName(zoneName);
    if (!regId) {
        contentArea.innerHTML = `<div style="text-align:center;padding:30px;color:#ff9800;">⚠️ 해당 구역의 예보 코드를 찾을 수 없습니다.<br><small style="color:#666;">(${zoneName})</small></div>`;
        return;
    }

    try {
        // 로컬 서버 API에서 데이터 가져오기
        const response = await fetch('/api/forecasts');
        if (!response.ok) throw new Error('로컬 서버 응답 오류');

        const json = await response.json();

        // regId로 데이터 찾기
        const items = json.data && json.data[regId];

        if (items && items.length > 0) {
            // 발표시각
            const tmFc = json.tmFc || (items[0] && items[0].tmFc);
            renderSeaForecastTableInModal(contentArea, items, displayName, tmFc);
        } else {
            contentArea.innerHTML = `<div style="text-align:center;padding:30px;color:#ff9800;">⚠️ 해당 구역(${regId})의 예보 데이터가 없습니다.<br><small style="color:#666;">스케줄러가 데이터를 수집할 때까지 기다려주세요.</small></div>`;
        }
    } catch (error) {
        // console.error('해상예보 조회 오류:', error);
        contentArea.innerHTML = `<div style="text-align:center;padding:30px;color:#ef5350;">❌ 데이터 조회 중 오류가 발생했습니다.<br><small>${error.message}</small></div>`;
    }
}



// 해상예보 테이블 렌더링 (모달용) - VilageFcstMsgService API 구조
function renderSeaForecastTableInModal(container, items, zoneName, tmFc = null) {
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

    // 테이블 스타일
    const tableStyle = `
        width: 100%;
        border-collapse: collapse;
        font-size: 0.85rem;
        min-width: 600px;
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

    let html = `<table style="${tableStyle}">`;

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
    html += `</tr>`;

    // 시간 헤더 행
    html += `<tr>
        <th style="${thStyle}; ${labelStyle}">시각</th>`;
    sortedDays.forEach(() => {
        html += `<th style="${thStyle}; font-size:0.8rem;">오전</th><th style="${thStyle}; font-size:0.8rem;">오후</th>`;
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
    html += `</tr>`;

    html += `</table>`;

    // 발표시각 포맷팅
    let tmFcText = '';
    if (tmFc) {
        const tmFcStr = String(tmFc);
        const year = tmFcStr.substring(0, 4);
        const month = tmFcStr.substring(4, 6);
        const day = tmFcStr.substring(6, 8);
        const hour = tmFcStr.substring(8, 10);
        const minute = tmFcStr.substring(10, 12);
        tmFcText = `${year}.${month}.${day} ${hour}:${minute} 발표`;
    }

    // 테이블과 발표시각 표시
    container.innerHTML = `
        <div style="position:relative;">
            <div style="overflow-x:auto;">${html}</div>
            <div style="text-align:center; font-size:0.95rem; color:#ffffff; padding:10px 0 4px; font-weight:500;">☜ 밀어서 더 많은 정보를 확인하세요 ☞</div>
            ${tmFcText ? `
                <div style="
                    text-align: right;
                    padding: 4px 5px 5px 5px;
                    font-size: 0.75rem;
                    color: #8899aa;
                ">${tmFcText}</div>
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
                    <ul class="info-list">
                        <li>국립해양조사원은 공식적으로 166개 <strong>"표준항 외 위치의 조석정보를 제공하지 않음"</strong></li>
                        <li>선택한 위치의 정보는 <strong>"표준항의 조석 관측･예측정보를 기준"</strong>으로 환경, 거리 등 요소를 <strong style="color: #448aff;">"자체 계산 로직에 반영"</strong>하여 산출한 결과임.</li>
                        <li>산출된 결과는 자체 계산 로직에 따라 계산된 값이므로 <strong style="color: #ff5252;">"실제와 오차가 있으므로 이 정보 이용에 따른 책임을 지지 않음."</strong></li>
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

// 헤더 클릭 시 전체 데이터 새로고침
async function handleHeaderRefresh() {
    // 기상정보 탭으로 강제 전환 (programmatic click 제거 -> switchMainTab 사용)
    window.switchMainTab("weather-alert-section");

    // 이미 로딩 중이면 무시
    if (appState.isLoading) return;

    try {
        await fetchAllData();
    } catch (e) {
        // console.error('Refresh failed:', e);
    }
}
window.handleHeaderRefresh = handleHeaderRefresh;

// ============================================================================
// 실시간 시간 표시 업데이트
// ============================================================================

/**
 * 우측 상단 시간 표시 업데이트
 */
function updateTimeDisplay() {
    const now = new Date();
    const dateEl = document.getElementById('current-date');
    const timeEl = document.getElementById('current-time');

    if (dateEl && timeEl) {
        const options = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
        dateEl.textContent = now.toLocaleDateString('ko-KR', options);
        timeEl.textContent = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    }

    // 좌측 상단 '최근 업데이트' 시간도 현재 시간으로 동기화
    // (사용자 요청: 아무것도 안 해도 자동 업데이트, 두 시간 동일하게)
    if (typeof ApiStatusManager !== 'undefined') {
        // appState.lastUpdated를 현재 시간으로 잠시 덮어쓰거나, 
        // ApiStatusManager.update()가 내부적으로 new Date()를 쓰도록 했으므로 그냥 호출만 하면 됨.
        // 단, ApiStatusManager.update()가 appState.lastUpdated를 우선 사용한다면 
        // 여기서 로직 변경이 필요할 수 있으나, 이전 스텝에서 new Date()를 fallback으로 넣었음.
        // 하지만 사용자가 "시간 기준이 동일하게"라고 했으므로 
        // ApiStatusManager가 표시하는 시간도 'current-time'과 완전히 같아야 함.

        // 가장 확실한 방법: ApiStatusManager 업데이트 시 appState.lastUpdated가 아닌 'now'를 쓰도록 유도
        // 이전 수정에서: const time = appState.lastUpdated || new Date(); 였음.
        // 업데이트 안 눌렀으면 lastUpdated는 갱신 안 됨 -> 구 시간이 뜸.
        // 따라서 "자동 업데이트"를 원한다면 그냥 현재 시간을 박아야 함.

        // ApiStatusManager.update() 내용을 보면 appState.lastUpdated가 있으면 그걸 씀.
        // 그러므로 강제로 현재 시간을 보여주려면 update 로직을 또 고쳐야 하거나,
        // 여기서 직접 DOM을 건드려야 함.

        // 하지만 더 좋은 방법:
        // ApiStatusManager.update()가 '실시간 시계' 역할을 하도록 변경했어야 함.
        // 이전 단계에서 수정한 ApiStatusManager.update()는 'lastUpdated'가 있으면 그걸 썼음.
        // 사용자는 "아무것도 하지 않아도 시간이 가길" 원함.
        // 즉 lastUpdated(데이터 갱신 시각)이 아니라 Current Time(현재 시각)을 원함.

        // 따라서 여기서 ApiStatusManager의 update를 호출하되, 
        // ApiStatusManager.update 내부에서 'lastUpdated' 의존성을 제거하고 항상 new Date()를 쓰게 해야 함.

        // 그러려면 이 함수에서 ApiStatusManager를 호출하기 전에, 
        // ApiStatusManager.update() 메소드를 다시 수정해야 함.
        // 일단 여기서는 호출만 추가. 다음 스텝이나 이번 스텝에서 ApiStatusManager도 고쳐야 함.
        if (window.ApiStatusManager) ApiStatusManager.update();
    }
}

// 시간 표시 초기화 및 1초마다 업데이트 (초 단위 동기화)
updateTimeDisplay();
setInterval(updateTimeDisplay, 1000);

// ============================================================================
// 윈디 팝업 기능
// ============================================================================

/**
 * 윈디 팝업 표시
 * @param {string} zoneName - 특보구역명
 */
function showWindyPopup(zoneName) {
    const embedUrl = getWindyEmbedUrl(zoneName);
    const windyUrl = WINDY_URL_MAPPING[zoneName];

    if (!embedUrl) {
        // console.warn('윈디 URL을 찾을 수 없습니다:', zoneName);
        return;
    }

    // 기존 팝업 제거
    const existingModal = document.getElementById('windy-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'windy-modal';
    modal.innerHTML = `
        <div class="windy-modal-overlay" onclick="closeWindyPopup()"></div>
        <div class="windy-modal-content">
            <div class="windy-modal-header">
                <h3>🌀 ${zoneName} - Windy</h3>
                <button class="windy-close-btn" onclick="closeWindyPopup()">✕</button>
            </div>
            <div class="windy-iframe-container">
                <iframe src="${embedUrl}" frameborder="0" allowfullscreen></iframe>
            </div>
            <div class="windy-modal-footer">
                <a href="${windyUrl}" target="_blank" class="windy-external-link">
                    🔗 새 탭에서 열기
                </a>
            </div>
        </div>
    `;

    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    // 스타일 추가
    const style = document.createElement('style');
    style.id = 'windy-modal-style';
    style.textContent = `
        .windy-modal-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(5px);
        }
        .windy-modal-content {
            position: relative;
            width: 90%;
            max-width: 1200px;
            height: 85vh;
            background: #1a1e2e;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
            animation: windyModalIn 0.3s ease-out;
            display: flex;
            flex-direction: column;
        }
        @keyframes windyModalIn {
            from {
                opacity: 0;
                transform: scale(0.9) translateY(20px);
            }
            to {
                opacity: 1;
                transform: scale(1) translateY(0);
            }
        }
        .windy-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 20px;
            background: linear-gradient(135deg, #00c6ff, #0072ff);
            color: white;
        }
        .windy-modal-header h3 {
            margin: 0;
            font-size: 1.1rem;
            font-weight: 600;
        }
        .windy-close-btn {
            background: rgba(255, 255, 255, 0.2);
            border: none;
            color: white;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            font-size: 1.2rem;
            cursor: pointer;
            transition: all 0.2s;
        }
        .windy-close-btn:hover {
            background: rgba(255, 255, 255, 0.4);
            transform: scale(1.1);
        }
        .windy-iframe-container {
            flex: 1;
            background: #0a0a0a;
        }
        .windy-iframe-container iframe {
            width: 100%;
            height: 100%;
            border: none;
        }
        .windy-modal-footer {
            padding: 12px 20px;
            background: rgba(0, 0, 0, 0.3);
            text-align: center;
        }
        .windy-external-link {
            color: #00c6ff;
            text-decoration: none;
            font-size: 0.9rem;
            transition: color 0.2s;
        }
        .windy-external-link:hover {
            color: #64d8ff;
            text-decoration: underline;
        }
        @media (max-width: 768px) {
            .windy-modal-content {
                width: 95%;
                height: 90vh;
                border-radius: 12px;
            }
            .windy-modal-header {
                padding: 12px 16px;
            }
            .windy-modal-header h3 {
                font-size: 1rem;
            }
        }
    `;

    // 기존 스타일 제거 후 추가
    const existingStyle = document.getElementById('windy-modal-style');
    if (existingStyle) existingStyle.remove();
    document.head.appendChild(style);

    document.body.appendChild(modal);

    // ESC 키로 닫기
    const handleEsc = (e) => {
        if (e.key === 'Escape') {
            closeWindyPopup();
            document.removeEventListener('keydown', handleEsc);
        }
    };
    document.addEventListener('keydown', handleEsc);
}

// ============================================================================
// 신규: 해역별 기상 현황 (특보 무관 전체 구역 표시)
// ============================================================================

function getSeaRegion(zoneName) {
    if (zoneName.includes('동해') || zoneName.includes('울산') || zoneName.includes('경북') || zoneName.includes('강원')) return 'east';
    if (zoneName.includes('서해') || zoneName.includes('인천') || zoneName.includes('경기') || zoneName.includes('충남') || zoneName.includes('전북')) return 'west';
    if (zoneName.includes('남해') || zoneName.includes('경남') || zoneName.includes('부산') || zoneName.includes('거제') || zoneName.includes('전남')) return 'south';
    if (zoneName.includes('제주')) return 'jeju';
    return 'other';
}

function renderBuoyButtonsForStatus(zoneName, container) {
    if (typeof BUOY_MAPPING === 'undefined' || !BUOY_MAPPING[zoneName]) return;

    const buoyContainer = document.createElement('div');
    buoyContainer.className = 'buoy-btn-container';
    buoyContainer.style.marginTop = '8px';
    buoyContainer.style.display = 'flex';
    buoyContainer.style.flexWrap = 'wrap';
    buoyContainer.style.gap = '6px';

    BUOY_MAPPING[zoneName].forEach(buoy => {
        const btn = document.createElement('button');
        btn.className = 'buoy-btn';

        let icon = 'fa-water';
        if (buoy.type === 'B') icon = 'fa-anchor';
        else if (buoy.type === 'C') icon = 'fa-wave-square';
        else if (buoy.type === 'L') icon = 'fa-lightbulb';

        btn.innerHTML = `<i class="fa-solid ${icon}"></i> ${buoy.name}`;
        btn.onclick = (e) => {
            e.stopPropagation();
            if (typeof fetchBuoyData === 'function') fetchBuoyData(buoy.id, buoy.name);
        };
        buoyContainer.appendChild(btn);
    });
    container.appendChild(buoyContainer);
}

function renderOtherButtonsForStatus(zoneName, container) {
    if (typeof ZONE_OVERLAY_CONFIG !== 'undefined' && ZONE_OVERLAY_CONFIG[zoneName]) {
        // 매핑된 구역인지 확인
        const isMappedZone = typeof ZONE_NAME_DISPLAY_MAP !== 'undefined' && ZONE_NAME_DISPLAY_MAP[zoneName];

        const btnContainer = document.createElement('div');
        btnContainer.style.cssText = `
            display: flex;
            gap: 8px;
            margin-top: 15px;
            flex-wrap: nowrap;
        `;

        // 1. 기상예보 버튼
        if (!isMappedZone) {
            const forecastBtn = document.createElement('button');
            forecastBtn.className = 'forecast-btn';
            forecastBtn.innerHTML = '기상예보';
            forecastBtn.style.cssText = `
                flex: 1;
                padding: 12px 8px;
                background: linear-gradient(135deg, #ffd54f, #ff9800, #f57c00);
                color: #1a1e2e;
                border: none;
                border-radius: 8px;
                font-size: 0.85rem;
                font-weight: 600;
                cursor: pointer;
                transition: transform 0.2s, box-shadow 0.2s;
                box-shadow: 0 2px 8px rgba(255, 152, 0, 0.3);
                white-space: nowrap;
            `;
            forecastBtn.addEventListener('mouseenter', () => {
                forecastBtn.style.transform = 'translateY(-2px)';
                forecastBtn.style.boxShadow = '0 4px 15px rgba(255, 152, 0, 0.5)';
            });
            forecastBtn.addEventListener('mouseleave', () => {
                forecastBtn.style.transform = 'translateY(0)';
                forecastBtn.style.boxShadow = '0 2px 8px rgba(255, 152, 0, 0.3)';
            });
            forecastBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (typeof showSeaForecastTable === 'function') showSeaForecastTable(zoneName);
            });
            btnContainer.appendChild(forecastBtn);
        }

        // 2. 해구별 기상전망 버튼
        const zoneViewBtn = document.createElement('button');
        zoneViewBtn.className = 'zone-view-btn';
        zoneViewBtn.innerHTML = '해구기상';
        zoneViewBtn.style.cssText = `
            flex: 1;
            padding: 12px 8px;
            background: linear-gradient(135deg, #e94560, #0f3460);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 0.85rem;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
            white-space: nowrap;
        `;
        zoneViewBtn.addEventListener('mouseenter', () => {
            zoneViewBtn.style.transform = 'translateY(-2px)';
            zoneViewBtn.style.boxShadow = '0 4px 15px rgba(233, 69, 96, 0.4)';
        });
        zoneViewBtn.addEventListener('mouseleave', () => {
            zoneViewBtn.style.transform = 'translateY(0)';
            zoneViewBtn.style.boxShadow = 'none';
        });
        zoneViewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof showZoneOverlay === 'function') showZoneOverlay(zoneName);
        });
        btnContainer.appendChild(zoneViewBtn);

        // 3. 윈디 버튼
        if (typeof WINDY_URL_MAPPING !== 'undefined' && WINDY_URL_MAPPING[zoneName]) {
            const windyBtn = document.createElement('button');
            windyBtn.className = 'windy-btn';
            windyBtn.innerHTML = '윈디';
            windyBtn.style.cssText = `
                flex: 1;
                padding: 12px 8px;
                background: linear-gradient(135deg, #00c6ff, #0072ff);
                color: white;
                border: none;
                border-radius: 8px;
                font-size: 0.85rem;
                font-weight: 600;
                cursor: pointer;
                transition: transform 0.2s, box-shadow 0.2s;
                white-space: nowrap;
            `;
            windyBtn.addEventListener('mouseenter', () => {
                windyBtn.style.transform = 'translateY(-2px)';
                windyBtn.style.boxShadow = '0 4px 15px rgba(0, 114, 255, 0.4)';
            });
            windyBtn.addEventListener('mouseleave', () => {
                windyBtn.style.transform = 'translateY(0)';
                windyBtn.style.boxShadow = 'none';
            });
            windyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (window.showWindyPopup) window.showWindyPopup(zoneName);
            });
            btnContainer.appendChild(windyBtn);
        }

        container.appendChild(btnContainer);
    }
}

async function renderMarineWeatherStatus() {
    const containers = {
        '동해': document.getElementById('status-east-sea-list'),
        '서해': document.getElementById('status-west-sea-list'),
        '남해': document.getElementById('status-south-sea-list'),
        '제주': document.getElementById('status-jeju-sea-list')
    };

    const countBadges = {
        '동해': document.getElementById('status-east-count'),
        '서해': document.getElementById('status-west-count'),
        '남해': document.getElementById('status-south-count'),
        '제주': document.getElementById('status-jeju-count')
    };

    const counts = { '동해': 0, '서해': 0, '남해': 0, '제주': 0 };

    if (!containers['동해']) return;

    // 컨테이너 초기화
    Object.values(containers).forEach(el => { if (el) el.innerHTML = ''; });

    if (typeof SEA_REGIONS === 'undefined' || typeof SUB_REGION_ZONES === 'undefined') return;

    // 대분류별로 처리
    for (const [mainRegion, regionData] of Object.entries(SEA_REGIONS)) {
        const container = containers[mainRegion];
        if (!container) continue;

        const subRegionList = regionData.subRegions || [];

        // 제주는 중분류가 하나이므로 서브헤더 없이 바로 렌더링
        if (mainRegion === '제주' || subRegionList.length <= 1) {
            const zones = subRegionList.length > 0 ? (SUB_REGION_ZONES[subRegionList[0]] || []) : [];
            zones.forEach(zoneName => {
                if (typeof UserSettings !== 'undefined' && !UserSettings.isVisible(zoneName)) return;
                counts[mainRegion]++;
                container.appendChild(createStatusCard(zoneName));
            });
        } else {
            // 중분류별 서브 섹션 생성
            subRegionList.forEach(subRegion => {
                const zones = SUB_REGION_ZONES[subRegion] || [];
                if (zones.length === 0) return;

                // 서브 섹션 컨테이너
                const subSection = document.createElement('div');
                subSection.className = 'sub-region-section';
                subSection.style.marginBottom = '14px';

                // 서브 헤더 (중분류명) - 특보현황과 동일한 스타일
                const subHeader = document.createElement('div');
                subHeader.className = 'sub-region-header';
                subHeader.style.cssText = `
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 14px 16px;
                    background: linear-gradient(135deg, rgba(30, 60, 114, 0.8), rgba(42, 82, 152, 0.6));
                    border-radius: 10px;
                    margin-bottom: 10px;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    border-left: 4px solid #4fc3f7;
                    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
                `;
                subHeader.innerHTML = `
                    <span style="font-size: 1.0rem; font-weight: 700; color: #fff;">${subRegion}</span>
                    <span style="background: rgba(79, 195, 247, 0.3); padding: 4px 12px; border-radius: 12px; font-size: 0.85rem; font-weight: 600; color: #4fc3f7; margin-left: auto;">${zones.length}개 해역</span>
                `;

                // 호버 효과
                subHeader.onmouseenter = () => {
                    subHeader.style.background = 'linear-gradient(135deg, rgba(40, 80, 140, 0.9), rgba(52, 102, 180, 0.7))';
                };
                subHeader.onmouseleave = () => {
                    subHeader.style.background = 'linear-gradient(135deg, rgba(30, 60, 114, 0.8), rgba(42, 82, 152, 0.6))';
                };

                // 목록 컨테이너 (기본: 숨김)
                const listContainer = document.createElement('div');
                listContainer.className = 'sub-region-list';
                listContainer.style.display = 'none';
                listContainer.style.paddingLeft = '12px';

                // 토글 기능 (배타적 모드: 하나만 열림, 슬라이드 애니메이션)
                subHeader.onclick = () => {
                    const isCurrentlyHidden = listContainer.style.display === 'none';

                    // 같은 대분류 내 모든 중분류 아코디언 닫기 (애니메이션)
                    const parentSection = subSection.closest('.sea-section') || container;
                    parentSection.querySelectorAll('.sub-region-list').forEach(list => {
                        if (list !== listContainer && list.style.display !== 'none') {
                            slideUp(list);
                        }
                        const header = list.previousElementSibling;
                        if (header && list !== listContainer) {

                        }
                    });

                    // 클릭한 것이 닫혀있었다면 열기 (애니메이션)
                    if (isCurrentlyHidden) {
                        slideDown(listContainer);

                    } else {
                        slideUp(listContainer);

                    }
                };

                // 구역 카드들 추가
                let visibleZoneCount = 0;
                zones.forEach(zoneName => {
                    if (typeof UserSettings !== 'undefined' && !UserSettings.isVisible(zoneName)) return;
                    counts[mainRegion]++;
                    visibleZoneCount++;
                    listContainer.appendChild(createStatusCard(zoneName));
                });

                // [Fix] 표시할 구역이 하나도 없으면 섹션 자체를 렌더링하지 않음
                if (visibleZoneCount > 0) {
                    // 뱃지 업데이트 (필터링된 개수 반영)
                    const countSpan = subHeader.querySelector('span:last-child');
                    if (countSpan) countSpan.textContent = `${visibleZoneCount}개 해역`;

                    subSection.appendChild(subHeader);
                    subSection.appendChild(listContainer);
                    container.appendChild(subSection);
                }
            });
        }
    }

    // 대분류 뱃지 업데이트 및 섹션 숨김 처리
    for (const [region, count] of Object.entries(counts)) {
        if (countBadges[region]) {
            countBadges[region].textContent = `${count}개 해역`;
        }

        // [New] 해당 해역에 표시할 구역이 하나도 없으면 대분류 섹션 자체를 숨김
        // 컨테이너 ID 매핑: 동해 -> status-east-sea-section
        const sectionIdMap = {
            '동해': 'status-east-sea-section',
            '서해': 'status-west-sea-section',
            '남해': 'status-south-sea-section',
            '제주': 'status-jeju-sea-section'
        };

        const sectionId = sectionIdMap[region];
        if (sectionId) {
            const section = document.getElementById(sectionId);
            if (section) {
                if (count > 0) {
                    section.classList.remove('hidden');
                    section.style.display = ''; // 원래 display 속성 복원 (CSS 클래스가 우선순위 밀릴 경우 대비)
                } else {
                    section.classList.add('hidden');
                    section.style.display = 'none'; // 확실하게 숨김
                }
            }
        }
    }
}

// 개별 구역 카드 생성 (기상 현황용) - 특보 현황과 100% 일치하도록 조정
function createStatusCard(zoneName) {
    const card = document.createElement('div');
    card.className = 'weather-status-card';
    card.style.cssText = `
        padding: 12px;
        margin-bottom: 6px;
        border-radius: 8px;
        background: rgba(30, 40, 60, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.08);
        transition: all 0.2s ease;
    `;

    // === 헤더 영역: 구역명 + 버튼들 ===
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
    `;

    // 구역명
    const zoneNameEl = document.createElement('span');
    zoneNameEl.textContent = zoneName;
    zoneNameEl.style.cssText = `
        font-size: 0.9rem;
        font-weight: 600;
        color: #e0e0e0;
        flex-shrink: 0;
    `;
    header.appendChild(zoneNameEl);

    // 버튼 컨테이너 (오른쪽 정렬)
    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = `
        display: flex;
        gap: 6px;
        margin-left: auto;
        flex-shrink: 0;
    `;

    const isMappedZone = typeof ZONE_NAME_DISPLAY_MAP !== 'undefined' && ZONE_NAME_DISPLAY_MAP[zoneName];

    // 기상예보 버튼
    if (!isMappedZone) {
        const forecastBtn = document.createElement('button');
        forecastBtn.textContent = '기상예보';
        forecastBtn.style.cssText = `
            padding: 5px 10px;
            background: linear-gradient(135deg, #ffd54f, #ff9800);
            color: #1a1e2e;
            border: none;
            border-radius: 6px;
            font-size: 0.75rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            white-space: nowrap;
        `;
        forecastBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof showSeaForecastTable === 'function') showSeaForecastTable(zoneName);
        });
        btnContainer.appendChild(forecastBtn);
    }

    // 해구별 기상전망 버튼
    const zoneViewBtn = document.createElement('button');
    zoneViewBtn.textContent = '해구기상';
    zoneViewBtn.style.cssText = `
        padding: 5px 10px;
        background: linear-gradient(135deg, #e94560, #0f3460);
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 0.75rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        white-space: nowrap;
    `;
    zoneViewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof showZoneOverlay === 'function') showZoneOverlay(zoneName);
    });
    btnContainer.appendChild(zoneViewBtn);

    // 윈디 버튼
    if (typeof WINDY_URL_MAPPING !== 'undefined' && WINDY_URL_MAPPING[zoneName]) {
        const windyBtn = document.createElement('button');
        windyBtn.innerHTML = '윈디';
        windyBtn.style.cssText = `
            padding: 5px 10px;
            background: linear-gradient(135deg, #00c6ff, #0072ff);
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 0.75rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            white-space: nowrap;
        `;
        windyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.showWindyPopup) window.showWindyPopup(zoneName);
        });
        btnContainer.appendChild(windyBtn);
    }

    header.appendChild(btnContainer);
    card.appendChild(header);

    // === 부이 정보 영역 (항상 표시) ===
    const buoys = typeof BUOY_MAPPING !== 'undefined' ? BUOY_MAPPING[zoneName] : null;
    if (buoys && buoys.length > 0) {
        const buoySection = document.createElement('div');
        buoySection.style.cssText = `
            margin-top: 10px;
            padding-top: 10px;
            border-top: 1px solid rgba(255,255,255,0.08);
        `;

        // 부이 헤더 + 버튼들을 한 줄에
        const buoyHeader = document.createElement('div');
        buoyHeader.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        `;

        const buoyLabel = document.createElement('span');
        buoyLabel.innerHTML = `${BUOY_SVG_ICON} 관측부이<span style="color:#69f0ae;font-size:0.7rem;margin-left:4px">(${buoys.length})</span>`;
        buoyLabel.style.cssText = `
            font-size: 0.8rem;
            color: #8b949e;
            flex-shrink: 0;
        `;
        buoyHeader.appendChild(buoyLabel);

        // 부이 버튼들
        buoys.forEach(buoy => {
            const btn = document.createElement('button');
            btn.textContent = buoy.name;
            btn.style.cssText = `
                padding: 4px 10px;
                border-radius: 12px;
                border: 1px solid rgba(255,255,255,0.15);
                background: rgba(255,255,255,0.05);
                color: #ccc;
                font-size: 0.75rem;
                cursor: pointer;
                transition: all 0.2s;
            `;

            btn.onclick = (e) => {
                e.stopPropagation();

                // 이미 활성화된 버튼 클릭 시 닫기
                if (btn.classList.contains('active')) {
                    btn.classList.remove('active');
                    btn.style.backgroundColor = 'rgba(255,255,255,0.05)';
                    btn.style.color = '#ccc';
                    btn.style.borderColor = 'rgba(255,255,255,0.15)';
                    const infoArea = buoySection.querySelector('.buoy-info-area');
                    if (infoArea) infoArea.style.display = 'none';
                    return;
                }

                // 다른 버튼 비활성화
                buoyHeader.querySelectorAll('button').forEach(b => {
                    b.classList.remove('active');
                    b.style.backgroundColor = 'rgba(255,255,255,0.05)';
                    b.style.color = '#ccc';
                    b.style.borderColor = 'rgba(255,255,255,0.15)';
                });

                // 현재 버튼 활성화
                btn.classList.add('active');
                btn.style.backgroundColor = 'rgba(68, 138, 255, 0.3)';
                btn.style.color = '#448aff';
                btn.style.borderColor = '#448aff';

                // 정보 표시 영역 찾기/생성
                let infoArea = buoySection.querySelector('.buoy-info-area');
                if (!infoArea) {
                    infoArea = document.createElement('div');
                    infoArea.className = 'buoy-info-area';
                    infoArea.style.cssText = `
                        margin-top: 10px;
                        background: rgba(68, 138, 255, 0.1);
                        border-radius: 8px;
                        padding: 12px;
                        border: 1px solid rgba(68, 138, 255, 0.2);
                    `;
                    buoySection.appendChild(infoArea);
                }

                if (typeof displayBuoyInfo === 'function') {
                    displayBuoyInfo(buoy, infoArea);
                    infoArea.style.display = 'block';
                }
            };
            buoyHeader.appendChild(btn);
        });

        buoySection.appendChild(buoyHeader);
        card.appendChild(buoySection);
    }

    return card;
}

window.toggleMarineStatusAccordion = function () {
    const body = document.getElementById('marine-status-accordion-body');
    const header = document.getElementById('marine-status-accordion-header');
    if (body) body.classList.toggle('collapsed');

    const icon = document.getElementById('marine-status-accordion-icon');
    if (icon) {
        if (body.classList.contains('collapsed')) {
            icon.style.transform = 'rotate(0deg)';
        } else {
            icon.style.transform = 'rotate(180deg)';
        }
    }
};

// 초기 실행
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(renderMarineWeatherStatus, 500); // 데이터 로드 시간 고려

    // 관리자 트리거 초기화 (15회 클릭)
    // 관리자 트리거 초기화 (15회 클릭) - LEGACY REMOVED
    // if (typeof initAdminTrigger === 'function') initAdminTrigger();

    // 공지사항 및 서버 상태 확인
    if (typeof checkNoticeStatus === 'function') checkNoticeStatus();
});


// 즉시 실행 시도


/**
 * 윈디 팝업 닫기
 */
function closeWindyPopup() {
    const modal = document.getElementById('windy-modal');
    if (modal) {
        modal.style.opacity = '0';
        modal.style.transition = 'opacity 0.2s';
        setTimeout(() => modal.remove(), 200);
    }
}

// 전역 함수로 등록
window.showWindyPopup = showWindyPopup;
window.closeWindyPopup = closeWindyPopup;

// ============================================================================
// ⚙️ 사용자 설정 (User Settings) - 관심 해역 필터링
// ============================================================================

const UserSettings = {
    STORAGE_KEY: 'weatherAppSettings_v1',
    settings: {}, // { '구역명': boolean } (true: 표시, false: 미표출)

    init() {
        try {
            const saved = localStorage.getItem(this.STORAGE_KEY);
            if (saved) {
                this.settings = JSON.parse(saved);
            }
        } catch (e) {
            // console.error('Settings load failed:', e);
        }
    },

    save() {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.settings));
        } catch (e) {
            // console.error('Settings save failed:', e);
        }
    },

    // 해당 구역이 표시 대상인지 확인 (계층 구조 확인)
    isVisible(zoneName) {
        if (!zoneName) return true;

        // 1. 대분류 확인
        const subRegion = getSubRegion(zoneName);
        const mainRegion = getMainRegion(subRegion);

        if (mainRegion && this.settings[mainRegion] === false) return false;

        // 2. 중분류 확인 (제주 제외)
        if (mainRegion !== '제주' && subRegion && this.settings[subRegion] === false) return false;

        // 3. 소분류 확인
        if (this.settings[zoneName] === false) return false;

        return true;
    },

    // 설정 값 가져오기 (기본값 true)
    get(key) {
        return this.settings[key] !== false;
    },

    // 설정 값 변경
    set(key, value) {
        this.settings[key] = value;
    },

    reset() {
        this.settings = {};
        this.save();
    }
};

// 초기화 실행
UserSettings.init();

// ----------------------------------------------------------------------------
// 설정 모달 관련 함수
// ----------------------------------------------------------------------------

// [New] 알림 설정 로직 (Notification Logic)
const NotificationSettings = {
    STORAGE_KEY: 'notificationSettings_v1',
    settings: {
        master: false,
        target: 'interest',
        announce: true,
        active: true,
        release: true,
        night: true
    },
    init() {
        try {
            const saved = localStorage.getItem(this.STORAGE_KEY);
            if (saved) Object.assign(this.settings, JSON.parse(saved));
        } catch (e) { }
    },
    save() {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.settings));
    },
    get() { return this.settings; },
    set(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
        this.save();

        // [추가] 서버로 설정 즉시 동기화 (네이티브인 경우)
        if (window.Capacitor && window.Capacitor.isNativePlatform()) {
            // window.subscribeUser 함수가 토큰과 설정을 함께 보냄
            if (typeof window.subscribeUser === 'function') {
                // 토큰은 내부적으로 다시 가져오거나 저장된 것을 사용 (이미 브릿지에 구현됨)
                window.subscribeUser();
            }
        }
    }
};
NotificationSettings.init();

function initNotificationUI() {
    const s = NotificationSettings.get();

    const master = document.getElementById('push-master-toggle');
    const radios = document.getElementsByName('push-target');
    const optAnnounce = document.getElementById('push-opt-announce');
    const optActive = document.getElementById('push-opt-active');
    const optRelease = document.getElementById('push-opt-release');
    const optNight = document.getElementById('push-opt-night');

    if (!master) return;

    // Load values
    master.checked = s.master;

    // [확실한 이벤트 바인딩]
    master.onclick = async (e) => {
        console.log('Push toggle clicked. Master checked:', e.target.checked);
        const willBeEnabled = e.target.checked;

        if (willBeEnabled) {
            // [Debug] 함수 존재 확인
            if (typeof window.checkPushPermission !== 'function') {
                console.error('Critical Error: checkPushPermission is not defined!');
                return;
            }

            const permission = await window.checkPushPermission();
            console.log('Permission result:', permission);

            if (permission === 'denied') {
                e.preventDefault();
                e.target.checked = false;

                if (confirm('현재 알림 권한이 거절되어 있습니다.\n푸시 알림을 받으시려면 휴대폰 설정에서 알림을 허용해 주셔야 합니다.\n\n설정 화면으로 이동하시겠습니까?')) {
                    window.openAppSettings();
                }
                return;
            } else if (permission === 'prompt') {
                if (window.Capacitor && window.Capacitor.Plugins.PushNotifications) {
                    const result = await window.Capacitor.Plugins.PushNotifications.requestPermissions();
                    if (result.receive !== 'granted') {
                        e.preventDefault();
                        e.target.checked = false;
                        return;
                    }
                }
            }
        }
        // 정상적인 경우 UI 업데이트
        updateMasterState(willBeEnabled);

        // [추가] 즉시 설정 저장 및 서버 동기화
        NotificationSettings.set({ master: willBeEnabled });
    };

    updateMasterState(s.master);

    // Radios
    radios.forEach(r => {
        // Set state
        if (r.value === s.target) r.checked = true;

        // Visual Update
        updateRadioVisual(r);

        // Click Event (Wrapper)
        const label = r.closest('label');
        if (label) label.onclick = () => {
            setTimeout(() => {
                radios.forEach(radio => updateRadioVisual(radio));
            }, 0);
        };
    });

    function updateRadioVisual(radio) {
        const content = radio.nextElementSibling;
        if (!content) return;
        if (radio.checked) {
            content.classList.add('active');
            content.style.background = 'var(--accent-blue)';
            content.style.color = 'white';
        } else {
            content.classList.remove('active');
            content.style.background = 'transparent';
            content.style.color = '#ccc';
        }
    }

    // Options
    if (optAnnounce) optAnnounce.checked = s.announce;
    if (optActive) optActive.checked = s.active;
    if (optRelease) optRelease.checked = s.release;
    if (optNight) optNight.checked = s.night;
}

function updateMasterState(isEnabled) {
    const details = document.getElementById('push-detail-settings');
    if (!details) return;
    if (isEnabled) {
        details.style.opacity = '1';
        details.style.pointerEvents = 'auto';
    } else {
        details.style.opacity = '0.4';
        details.style.pointerEvents = 'none';
    }
}

function saveNotificationUI() {
    const master = document.getElementById('push-master-toggle');
    if (!master) return;

    const target = document.querySelector('input[name="push-target"]:checked')?.value || 'interest';

    NotificationSettings.set({
        master: master.checked,
        target: target,
        announce: document.getElementById('push-opt-announce')?.checked ?? true,
        active: document.getElementById('push-opt-active')?.checked ?? true,
        release: document.getElementById('push-opt-release')?.checked ?? true,
        night: document.getElementById('push-opt-night')?.checked ?? true
    });
}

// [New] 설정 탭 전환 함수
window.switchSettingsTab = function (tabId) {
    console.log('Switching to tab:', tabId);

    // 모든 탭 버튼 비활성화
    document.querySelectorAll('.settings-tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    // 선택된 탭 버튼 활성화 (ID 기반으로 시도 후 안되면 기존 방식으로)
    const activeBtn = document.getElementById(`btn-${tabId}`) || document.querySelector(`.settings-tab-btn[onclick*="${tabId}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    // 모든 탭 컨텐츠 숨기기
    document.querySelectorAll('.settings-tab-content').forEach(content => {
        content.classList.remove('active');
        content.style.display = 'none'; // 명시적으로 숨김
    });
    // 선택된 탭 컨텐츠 보이기
    const activeContent = document.getElementById(tabId);
    if (activeContent) {
        activeContent.classList.add('active');
        activeContent.style.display = 'block'; // 명시적으로 보여줌
    }
};

function openSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;

    // UI 보이기
    modal.classList.remove('hidden');

    // [New] 탭 초기화 (관심해역 탭부터 시작)
    window.switchSettingsTab('tab-zones');

    renderSettingsList();
    initNotificationUI(); // [New] UI 초기화
}

function closeSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.add('hidden');
}

function saveSettingsAndClose() {
    UserSettings.save();
    saveNotificationUI(); // [New] 알림 설정 저장
    if (window.FontSizeManager) FontSizeManager.save(); // [New] 폰트 크기 저장
    closeSettingsModal();

    // [New] 서버에 푸시 구독 정보 업데이트 요청 (Zones 변경 반영)
    if (typeof window.subscribeUser === 'function') {
        console.log('🔄 Settings saved. Updating server subscription...');
        window.subscribeUser();
    }

    // 화면 갱신: 특보 및 기상현황
    renderApp();
    if (typeof renderMarineWeatherStatus === 'function') {
        renderMarineWeatherStatus();
    }
}

function resetSettings() {
    if (confirm('모든 설정을 초기화하여 전체 해역을 표시하시겠습니까?')) {
        UserSettings.reset();
        openSettingsModal(); // UI 갱신
    }
}

// 설정 목록 UI 생성 (상태 유지 기능 추가)
function renderSettingsList(expandedStates = null) {
    const container = document.getElementById('settings-list-container');
    if (!container) return;

    // 현재 열려있는 아코디언 상태 저장 (ID 기반)
    // expandedStates가 전달되지 않았을 때만 현재 DOM에서 상태 수집
    const currentExpanded = expandedStates || getExpandedAccordionIds(container);

    container.innerHTML = '';

    // 대분류 순회
    const mainRegions = ['동해', '서해', '남해', '제주'];

    mainRegions.forEach(mainRegion => {
        const regionData = SEA_REGIONS[mainRegion];
        if (!regionData) return;

        const isMainVisible = UserSettings.get(mainRegion);
        const mainId = `accordion-main-${mainRegion}`; // ID 생성

        // 1. 대분류 아코디언 섹션
        const section = document.createElement('div');
        section.className = 'setting-section';
        section.style.marginBottom = '15px';

        // [추가] 자식 해역들의 전체 통계 계산 (대분류용)
        let mainActive = 0;
        let mainTotal = 0;
        regionData.subRegions.forEach(sub => {
            if (SUB_REGION_ZONES[sub]) {
                mainTotal += SUB_REGION_ZONES[sub].length;
                mainActive += SUB_REGION_ZONES[sub].filter(z => UserSettings.get(z)).length;
            }
        });
        // 제주의 경우 소분류 직접 계산
        if (mainRegion === '제주' && SUB_REGION_ZONES['제주해역']) {
            mainTotal = SUB_REGION_ZONES['제주해역'].length;
            mainActive = SUB_REGION_ZONES['제주해역'].filter(z => UserSettings.get(z)).length;
        }
        const mainBadgeHtml = mainTotal > 0 ? `<span style="margin-left:8px; font-size:0.8rem; color:${mainActive > 0 ? 'var(--accent-blue)' : '#64748b'}; font-weight:normal; background:rgba(0,0,0,0.2); padding:2px 8px; border-radius:10px;">(${mainActive}/${mainTotal})</span>` : '';

        // 헤더
        const header = document.createElement('div');
        header.className = `setting-accordion-header ${isMainVisible ? '' : 'disabled-style'}`;
        header.innerHTML = `
            <div class="setting-label" style="font-weight: 700;">
                <i class="fa-solid fa-chevron-right arrow" style="font-size: 0.8rem; width: 20px; text-align: center; transition: transform 0.3s; transform: rotate(0deg);"></i>
                ${regionData.icon} ${regionData.displayName || mainRegion} <span style="font-size: 0.85em; font-weight: 400; color: rgba(255,255,255,0.6); margin-left: 6px;">(${regionData.english})</span>
                ${mainBadgeHtml}
            </div>
            <div class="switch-wrapper" onclick="event.stopPropagation()">
                <label class="switch">
                    <input type="checkbox" ${isMainVisible ? 'checked' : ''} onchange="toggleSetting('${mainRegion}', this.checked)">
                    <span class="slider"></span>
                </label>
            </div>
        `;

        const body = document.createElement('div');
        body.className = 'setting-accordion-body';
        body.id = mainId; // ID 부여

        // 상태 복원
        if (currentExpanded.has(mainId)) {
            body.classList.add('open');
            header.querySelector('.arrow').style.transform = 'rotate(90deg)';
        }

        // 헤더 클릭 이벤트
        header.onclick = (e) => {
            if (e.target.closest('.switch-wrapper')) return;
            const isOpen = body.classList.contains('open');
            const arrow = header.querySelector('.arrow');
            if (isOpen) {
                body.classList.remove('open');
                arrow.style.transform = 'rotate(0deg)';
            } else {
                body.classList.add('open');
                arrow.style.transform = 'rotate(90deg)';
            }
        };

        section.appendChild(header);
        section.appendChild(body);

        // 2. 하위 항목 생성
        if (mainRegion === '제주') {
            const zones = SUB_REGION_ZONES['제주해역'] || [];
            zones.forEach(zone => {
                body.appendChild(createSettingItem(zone, mainRegion));
            });
        } else {
            const subRegions = regionData.subRegions;
            subRegions.forEach(subRegion => {
                const subZones = SUB_REGION_ZONES[subRegion] || [];
                const isSubVisible = UserSettings.get(subRegion);
                const subId = `accordion-sub-${subRegion}`; // ID 생성

                const subSection = document.createElement('div');
                subSection.style.marginBottom = '8px';

                // 중분류 헤더
                const subHeader = document.createElement('div');
                subHeader.className = `setting-accordion-header ${isSubVisible && isMainVisible ? '' : 'disabled-style'}`;
                subHeader.style.padding = '10px 14px';
                subHeader.style.background = 'rgba(255, 255, 255, 0.05)';

                // [수정] 대분류가 꺼져있으면 중분류 비활성화 스타일 적용
                if (!isMainVisible) {
                    subHeader.style.opacity = '0.4';
                    subHeader.style.pointerEvents = 'none';
                }

                // [추가] 배지 계산 (선택된 해역 수 / 전체 해역 수)
                let activeCount = 0;
                let totalCount = 0;
                if (SUB_REGION_ZONES[subRegion]) {
                    totalCount = SUB_REGION_ZONES[subRegion].length;
                    activeCount = SUB_REGION_ZONES[subRegion].filter(z => UserSettings.get(z)).length;
                }
                const badgeHtml = totalCount > 0 ? `<span style="margin-left:6px; font-size:0.75rem; color:${activeCount > 0 ? 'var(--accent-blue)' : '#64748b'}; font-weight:normal; background:rgba(255,255,255,0.05); padding:2px 6px; border-radius:10px;">(${activeCount}/${totalCount})</span>` : '';

                subHeader.innerHTML = `
                    <div class="setting-label" style="font-size: 0.95rem;">
                        <i class="fa-solid fa-chevron-right arrow" style="font-size: 0.7rem; width: 15px; margin-right: 5px; transition: transform 0.3s;"></i>
                        ${subRegion} ${badgeHtml}
                    </div>
                    <div class="switch-wrapper" onclick="event.stopPropagation()">
                        <label class="switch" style="transform: scale(0.9);">
                            <input type="checkbox" ${isSubVisible ? 'checked' : ''} onchange="toggleSetting('${subRegion}', this.checked)">
                            <span class="slider"></span>
                        </label>
                    </div>
                `;

                const subBody = document.createElement('div');
                subBody.className = 'setting-accordion-body';
                subBody.id = subId; // ID 부여
                subBody.style.borderLeft = '1px dashed rgba(255,255,255,0.1)';

                // 상태 복원
                if (currentExpanded.has(subId)) {
                    subBody.classList.add('open');
                    subHeader.querySelector('.arrow').style.transform = 'rotate(90deg)';
                }

                subHeader.onclick = (e) => {
                    if (e.target.closest('.switch-wrapper')) return;
                    const isOpen = subBody.classList.contains('open');
                    const arrow = subHeader.querySelector('.arrow');
                    if (isOpen) {
                        subBody.classList.remove('open');
                        arrow.style.transform = 'rotate(0deg)';
                    } else {
                        subBody.classList.add('open');
                        arrow.style.transform = 'rotate(90deg)';
                    }
                };

                subSection.appendChild(subHeader);
                subSection.appendChild(subBody);

                subZones.forEach(zone => {
                    subBody.appendChild(createSettingItem(zone, subRegion));
                });

                body.appendChild(subSection);
            });
        }

        container.appendChild(section);
    });
}

// 현재 열려있는 아코디언 ID 수집
function getExpandedAccordionIds(container) {
    const expanded = new Set();
    const openBodies = container.querySelectorAll('.setting-accordion-body.open');
    openBodies.forEach(body => {
        if (body.id) expanded.add(body.id);
    });
    return expanded;
}

function createSettingItem(zoneName, parentKey) {
    const isVisible = UserSettings.get(zoneName);
    const parentVisible = UserSettings.get(parentKey);

    const div = document.createElement('div');
    div.className = 'setting-item';

    if (!parentVisible) {
        div.style.opacity = '0.4';
        div.style.pointerEvents = 'none';
    }

    div.innerHTML = `
        <div class="setting-label" style="font-size: 0.9rem; color: #ddd;">
            ${zoneName}
        </div>
        <label class="switch" style="transform: scale(0.8);">
            <input type="checkbox" ${isVisible ? 'checked' : ''} onchange="toggleSetting('${zoneName}', this.checked)">
            <span class="slider"></span>
        </label>
    `;
    return div;
}

function toggleSetting(key, isChecked) {
    // 1. 현재 항목 설정
    UserSettings.set(key, isChecked);

    // 2. 계층 구조에 따른 연동 (Cascading)

    // (A) 순방향 연동: 부모 -> 자식 (Parent -> Child)
    if (['동해', '서해', '남해', '제주'].includes(key)) {
        const regionData = SEA_REGIONS[key];
        if (regionData && regionData.subRegions) {
            regionData.subRegions.forEach(sub => {
                UserSettings.set(sub, isChecked);
                if (SUB_REGION_ZONES[sub]) {
                    SUB_REGION_ZONES[sub].forEach(zone => UserSettings.set(zone, isChecked));
                }
            });
        }
        if (key === '제주' && SUB_REGION_ZONES['제주해역']) {
            SUB_REGION_ZONES['제주해역'].forEach(zone => UserSettings.set(zone, isChecked));
        }
    } else if (SUB_REGION_ZONES[key]) {
        SUB_REGION_ZONES[key].forEach(zone => UserSettings.set(zone, isChecked));
    }

    // (B) [추가] 역방향 연동: 자식 -> 부모 (Child -> Parent ON)
    if (isChecked) {
        // [소분류 -> 중분류 & 대분류]
        for (const [subName, zones] of Object.entries(SUB_REGION_ZONES)) {
            if (zones.includes(key)) {
                UserSettings.set(subName, true); // 중분류 ON
                // 중분류에서 다시 대분류 찾기
                for (const [mainName, data] of Object.entries(SEA_REGIONS)) {
                    if (data.subRegions.includes(subName)) {
                        UserSettings.set(mainName, true); // 대분류 ON
                    }
                }
                break;
            }
        }
        // [중분류 -> 대분류]
        for (const [mainName, data] of Object.entries(SEA_REGIONS)) {
            if (data.subRegions.includes(key)) {
                UserSettings.set(mainName, true); // 대분류 ON
                break;
            }
        }
    }

    // 리스트 컨테이너의 스크롤 위치 저장
    const body = document.querySelector('#settings-modal .modal-body');
    const scrollPos = body ? body.scrollTop : 0;

    // **중요**: 현재 상태를 수집한 후 재렌더링에 전달
    const container = document.getElementById('settings-list-container');
    const expandedStates = getExpandedAccordionIds(container);

    renderSettingsList(expandedStates);

    if (body) body.scrollTop = scrollPos;
}

// 전역 노출
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.saveSettingsAndClose = saveSettingsAndClose;
window.resetSettings = resetSettings;
window.toggleSetting = toggleSetting;

// ============================================================
// 📍 내 주변 바다 기상전망 (GPS 기반)
// ============================================================

async function showMyLocationWeather() {
    const btn = document.getElementById('my-location-btn');
    if (!btn) return;

    // UI 업데이트
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 확인 중...';
    btn.disabled = true;

    if (!navigator.geolocation) {
        alert("이 브라우저는 위치 정보를 지원하지 않습니다.");
        btn.innerHTML = originalText;
        btn.disabled = false;
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (position) => {
            try {
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;

                // 1. 해구(Sea Zone) 판별
                const checkResult = findSeaZone(lon, lat);

                if (checkResult) {
                    // 해상임: 해당 해구의 기상전망 표출
                    if (window.showMarineZoneModal) {
                        // 모달 닫기 버튼 등이 겹칠 수 있으므로 기존 모달 정리
                        if (window.closeSeaZoneModal) window.closeSeaZoneModal();

                        // 데이터 조회 및 모달 열기
                        window.getMarineZoneData(checkResult.zoneId);
                    }
                } else {
                    // 육상임: 가장 가까운 해안 예보 구역 찾기
                    const nearestZone = findNearestZone(lat, lon);
                    if (nearestZone) {
                        if (window.showSeaForecastTable) {
                            showSeaForecastTable(nearestZone.name);
                        }
                    } else {
                        alert("가장 가까운 예보 구역을 찾을 수 없습니다.");
                    }
                }

            } catch (e) {
                // console.error("Loc logic error:", e);
                alert("위치 정보를 처리하는 중 오류가 발생했습니다.");
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        },
        (error) => {
            // console.error("Geo error:", error);
            let msg = "위치 정보를 가져올 수 없습니다.";
            if (error.code === 1) msg += "\n위치 정보 제공을 허용해주세요.";
            alert(msg);
            btn.innerHTML = originalText;
            btn.disabled = false;
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

// 헬퍼: GPS 좌표로 해구 정보(대해구, 소해구) 찾기
function findSeaZone(lon, lat) {
    if (typeof gpsToPixel !== 'function' || typeof GRID_DATA === 'undefined' || typeof SEA_ZONES_DATA === 'undefined') {
        // console.warn('필요한 데이터가 로드되지 않았습니다.');
        return null;
    }

    const pixel = gpsToPixel(lon, lat); // gridCalibrationData.js

    // 1. 격자(Grid) 찾기
    const lonKeys = Object.keys(GRID_DATA.lon).map(Number).sort((a, b) => a - b);
    const latKeys = Object.keys(GRID_DATA.lat).map(Number).sort((a, b) => a - b);

    let lonKey = null, latKey = null; // 구간 시작 키
    let lonNext = null, latNext = null; // 구간 끝 키

    for (let i = 0; i < lonKeys.length - 1; i++) {
        const x1 = GRID_DATA.lon[lonKeys[i]].val;
        const x2 = GRID_DATA.lon[lonKeys[i + 1]].val;
        if (pixel.x >= x1 && pixel.x < x2) {
            lonKey = lonKeys[i];
            lonNext = lonKeys[i + 1];
            break;
        }
    }

    for (let i = 0; i < latKeys.length - 1; i++) {
        const y1 = GRID_DATA.lat[latKeys[i]].val;
        const y2 = GRID_DATA.lat[latKeys[i + 1]].val;
        if (pixel.y >= y1 && pixel.y < y2) {
            latKey = latKeys[i];
            latNext = latKeys[i + 1];
            break;
        }
    }

    if (lonKey !== null && latKey !== null) {
        const gridKey = `${lonKey}-${lonNext}_${latKey}-${latNext}`;
        const zoneNum = SEA_ZONES_DATA[gridKey];

        if (zoneNum && zoneNum !== "0") {
            // 대해구 찾음. 이제 소해구(1~9) 계산
            const x1 = GRID_DATA.lon[lonKey].val;
            const y1 = GRID_DATA.lat[latKey].val;

            // 전체 격자 크기 계산
            const width = GRID_DATA.lon[lonNext].val - x1;
            const height = GRID_DATA.lat[latNext].val - y1;

            const cellW = width / 3;
            const cellH = height / 3;

            const localX = pixel.x - x1;
            const localY = pixel.y - y1;

            const col = Math.floor(localX / cellW);
            const row = Math.floor(localY / cellH);

            const safeCol = Math.max(0, Math.min(2, col));
            const safeRow = Math.max(0, Math.min(2, row));

            const subIdx = safeRow * 3 + safeCol + 1; // 1~9

            return {
                zoneNum: zoneNum,
                subIdx: subIdx,
                zoneId: `${zoneNum}-${subIdx}`
            };
        }
    }
    return null;
}

// 헬퍼: 가장 가까운 육상 예보 구역 찾기
function findNearestZone(lat, lon) {
    if (typeof ZONE_COORDINATES === 'undefined') return null;

    let minDist = Infinity;
    let nearest = null;

    for (const [name, coord] of Object.entries(ZONE_COORDINATES)) {
        const dist = getDistanceFromLatLonInKm(lat, lon, coord.lat, coord.lon);
        if (dist < minDist) {
            minDist = dist;
            nearest = { name: name, dist: dist };
        }
    }
    return nearest;
}

// 헬퍼: 거리 계산
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the earth in km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// ============================================================================
// 🛠️ 서버 점검 & 관리자 공지 시스템
// ============================================================================

let adminTriggerCount = 0;
let adminTriggerTimer = null;

// 1. 관리자 모드 진입 트리거 초기화
// 1. 관리자 모드 진입 트리거 초기화
// function initAdminTrigger() REMOVED
/*
function initAdminTrigger() {
    // [탭 15회 클릭 -> 통합 로그인 모달]
 
    // (1) 태풍정보 탭 -> 공지 팝업 관리
    const typhoonTab = document.querySelector('button[data-target="typhoon-section"]');
    if (typhoonTab) {
        let count = 0;
        let timer = null;
        typhoonTab.addEventListener('click', () => {
            count++;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => { count = 0; }, 2000);
 
            if (count >= 15) {
                count = 0;
                // 통합 로그인 모달 호출 (공지 모드)
                if (typeof showUnifiedLoginModal === 'function') {
                    showUnifiedLoginModal('notice', '공지 팝업 관리자 로그인', 'fa-bell');
                } else {
                    alert("관리자 모듈 로드 중...");
                }
            }
        });
    }
 
    // (2) 공지사항 탭 -> 게시글 관리
    const promoTab = document.querySelector('button[data-target="promo-section"]');
    if (promoTab) {
        let count = 0;
        let timer = null;
        promoTab.addEventListener('click', () => {
            count++;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => { count = 0; }, 2000);
 
            if (count >= 15) {
                count = 0;
                // 통합 로그인 모달 호출 (홍보 모드)
                if (typeof showUnifiedLoginModal === 'function') {
                    showUnifiedLoginModal('promo', '게시판 관리자 로그인', 'fa-bullhorn');
                } else {
                    alert("관리자 모듈 로드 중...");
                }
            }
        });
    }
 
    // (3) 해구기상 탭 -> API 관리
    const zoneTab = document.querySelector('button[data-target="sea-zone-section"]');
    if (zoneTab) {
        let count = 0;
        let timer = null;
        zoneTab.addEventListener('click', () => {
            count++;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => { count = 0; }, 2000);
 
            if (count >= 15) {
                count = 0;
                // 통합 로그인 모달 호출 (API 모드)
                if (typeof showUnifiedLoginModal === 'function') {
                    showUnifiedLoginModal('api', 'API 관리자 로그인', 'fa-server');
                } else {
                    alert("관리자 모듈 로드 중...");
                }
            }
        });
    }
}
*/

// 2. 앱 실행 시 공지사항 확인 (오프라인 캐싱 기능 추가)
async function checkNoticeStatus() {
    try {
        // 서버 연결 확인 (타임아웃 3초)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(CONFIG.NOTICE_API_URL, {
            signal: controller.signal,
            headers: { 'Cache-Control': 'no-cache' } // 캐시 방지
        });
        clearTimeout(timeoutId);

        if (!response.ok) throw new Error('Server Error');

        const noticeData = await response.json();

        // 1. 공지 활성화 상태라면
        if (noticeData.isActive) {
            // [New] 클라이언트 측 만료 시간 확인
            if (noticeData.expiresAt) {
                const now = new Date();
                const expDate = new Date(noticeData.expiresAt.replace(' ', 'T') + ':00');
                if (expDate <= now) {
                    // console.log('공지 기한 만료됨:', noticeData.expiresAt);
                    localStorage.removeItem('offline_notice_cache');
                    return;
                }
            }

            // [중요] 오프라인 대비: 로컬 스토리지에 공지 내용 저장
            localStorage.setItem('offline_notice_cache', JSON.stringify(noticeData));

            // "다시 보지 않기" 체크 확인
            const hiddenNoticeId = localStorage.getItem('hidden_notice_id');
            if (hiddenNoticeId !== String(noticeData.id)) {
                // 스플래시 화면 종료 대기
                const checkSplash = setInterval(() => {
                    const splash = document.getElementById('splash-screen');
                    if (!splash || getComputedStyle(splash).display === 'none') {
                        clearInterval(checkSplash);
                        showNoticePopup(noticeData); // 공지 팝업 호출
                    }
                }, 500);
            }
        }
        // 2. 공지 비활성화 상태라면
        else {
            // [중요] 저장된 공지 삭제 (서버에서 내려갔으므로)
            localStorage.removeItem('offline_notice_cache');
        }

    } catch (error) {
        // console.error('Connection Check Failed:', error);

        // 3. 서버 연결 실패 시, 캐시된 공지가 있는지 확인
        const cachedNotice = localStorage.getItem('offline_notice_cache');

        if (cachedNotice) {
            try {
                const noticeData = JSON.parse(cachedNotice);
                // 캐시된 공지 표시 (다시 보지 않기 체크 확인)
                const hiddenNoticeId = localStorage.getItem('hidden_notice_id');
                if (hiddenNoticeId !== String(noticeData.id)) {
                    // 스플래시 화면이 끝날 때까지 대기 후 표시
                    const checkSplash = setInterval(() => {
                        const splash = document.getElementById('splash-screen');
                        if (!splash || getComputedStyle(splash).display === 'none') {
                            clearInterval(checkSplash);
                            showNoticePopup(noticeData); // 공지 팝업 호출
                        }
                    }, 500);
                }
                return; // 캐시 공지를 띄웠으므로 점검 팝업은 스킵
            } catch (e) {
                // console.error('Cache parse error', e);
            }
        }

        // 4. 캐시된 공지도 없다면 기존 에러 처리
        if (navigator.onLine) {
            showMaintenancePopup(); // 서버 점검/다운
        } else {
            showNetworkErrorPopup(); // 사용자 인터넷 끊김
        }
    }
}

// 3. 관리자 비밀번호 입력 모달 (Legacy removed - using showUnifiedLoginModal)
// 3-1. 게시글 관리 모달 (Legacy removed - using showPromoManagementModal)

// 4. 공지사항 팝업 작성/관리 모달 (태풍정보 탭 15회 클릭 시)
async function showAdminNoticeModal() {
    // 공지 데이터 가져오기
    let notices = { active: [], expired: [] };
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/notices');
        if (res.ok) notices = await res.json();
    } catch (e) {
        // console.error(e);
        // 기존 단일 공지 호환
        try {
            const res2 = await fetch(CONFIG.NOTICE_API_URL);
            if (res2.ok) {
                const old = await res2.json();
                if (old.isActive) notices.active = [old];
            }
        } catch (e2) { }
    }

    // 시간 드롭다운 옵션 생성
    const hourOptions = Array.from({ length: 24 }, (_, i) =>
        `<option value="${i}">${String(i).padStart(2, '0')}시</option>`
    ).join('');
    const minuteOptions = Array.from({ length: 60 }, (_, i) =>
        `<option value="${i}">${String(i).padStart(2, '0')}분</option>`
    ).join('');

    // 현재 날짜 기본값
    const now = new Date();
    const defaultDate = now.toISOString().split('T')[0];

    const modalHtml = `
        <div class="notice-modal-overlay" id="admin-modal-overlay">
            <div class="notice-popup" style="background: #1f2937; width: 95%; max-width: 400px; max-height: 85vh; overflow-y: auto; border-radius: 10px;">
                <div class="notice-header" style="background: #4b5563; padding: 8px 12px; position: sticky; top: 0; z-index: 10;">
                    <span style="font-size: 0.9rem;">🔔 공지 팝업 관리</span>
                    <button class="notice-close-btn" onclick="document.getElementById('admin-modal-overlay').remove()" style="padding: 2px 8px; font-size: 1rem;">×</button>
                </div>
                <div class="notice-content" style="padding: 8px !important;">
                    
                    <!-- 현재 진행 중인 공지사항 -->
                    <div style="margin-bottom: 8px;">
                        <div style="background: #065f46; color: #a7f3d0; padding: 6px 8px; border-radius: 4px 4px 0 0; font-weight: 600; font-size: 0.8rem;">
                            <i class="fa-solid fa-bell"></i> 현재 진행 중인 공지사항
                        </div>
                        <div id="active-notices-list" style="background: #1e293b; border: 1px solid #334155; border-top: none; border-radius: 0 0 4px 4px;">
                            ${notices.active && notices.active.length > 0 ? notices.active.map(n => `
                                <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-bottom: 1px solid #334155;">
                                    <div style="flex: 1; min-width: 0;">
                                        <div style="font-size: 0.8rem; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${n.title || '제목 없음'}</div>
                                        <div style="font-size: 0.65rem; color: #64748b;">~ ${n.expiresAt || '기한 없음'}</div>
                                    </div>
                                    <div style="display: flex; gap: 3px; flex-shrink: 0;">
                                        <button onclick="editNotice(${n.id})" style="background: #3b82f6; color: white; border: none; padding: 3px 6px; border-radius: 3px; font-size: 0.65rem; cursor: pointer;">수정</button>
                                        <button onclick="deleteNoticeById(${n.id})" style="background: #ef4444; color: white; border: none; padding: 3px 6px; border-radius: 3px; font-size: 0.65rem; cursor: pointer;">삭제</button>
                                    </div>
                                </div>
                            `).join('') : '<div style="padding: 8px; text-align: center; color: #64748b; font-size: 0.75rem;">진행 중인 공지가 없습니다</div>'}
                        </div>
                    </div>

                    <!-- 자동 종료된 공지사항 -->
                    <div style="margin-bottom: 8px;">
                        <div style="background: #44403c; color: #d6d3d1; padding: 6px 8px; border-radius: 4px 4px 0 0; font-weight: 600; font-size: 0.8rem;">
                            <i class="fa-solid fa-clock-rotate-left"></i> 자동 종료된 공지사항
                        </div>
                        <div id="expired-notices-list" style="background: #1e293b; border: 1px solid #334155; border-top: none; border-radius: 0 0 4px 4px;">
                            ${notices.expired && notices.expired.length > 0 ? notices.expired.map(n => `
                                <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-bottom: 1px solid #334155;">
                                    <div style="flex: 1; min-width: 0;">
                                        <div style="font-size: 0.8rem; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${n.title || '제목 없음'}</div>
                                        <div style="font-size: 0.65rem; color: #64748b;">종료: ${n.expiresAt || '-'}</div>
                                    </div>
                                    <button onclick="reactivateNotice(${n.id})" style="background: #6366f1; color: white; border: none; padding: 3px 6px; border-radius: 3px; font-size: 0.65rem; cursor: pointer; flex-shrink: 0;">재등록</button>
                                </div>
                            `).join('') : '<div style="padding: 8px; text-align: center; color: #64748b; font-size: 0.75rem;">종료된 공지가 없습니다</div>'}
                        </div>
                    </div>

                    <!-- 공지사항 작성 -->
                    <div style="background: #1e293b; border: 1px solid #334155; border-radius: 4px; padding: 8px;">
                        <div style="font-weight: 600; font-size: 0.8rem; color: #e2e8f0; margin-bottom: 6px;">
                            <i class="fa-solid fa-pen"></i> 공지사항 작성
                        </div>
                        
                        <input type="hidden" id="notice-edit-id" value="">
                        
                        <div style="margin-bottom: 6px;">
                            <label style="display: block; font-size: 0.7rem; color: #94a3b8; margin-bottom: 2px;">게시글 제목</label>
                            <input type="text" id="notice-title" style="width: 100%; padding: 6px 8px; background: #0f172a; border: 1px solid #334155; border-radius: 4px; color: #e2e8f0; font-size: 0.85rem; box-sizing: border-box;" placeholder="예: 서버 점검 안내">
                        </div>
                        
                        <div style="margin-bottom: 6px;">
                            <label style="display: block; font-size: 0.7rem; color: #94a3b8; margin-bottom: 2px;">게시글 내용</label>
                            <textarea id="notice-content" style="width: 100%; height: 60px; padding: 6px 8px; background: #0f172a; border: 1px solid #334155; border-radius: 4px; color: #e2e8f0; font-size: 0.8rem; resize: none; box-sizing: border-box;" placeholder="내용을 입력하세요..."></textarea>
                        </div>
                        
                        <div style="margin-bottom: 8px;">
                            <label style="display: block; font-size: 0.7rem; color: #94a3b8; margin-bottom: 2px;">공지 종료 기한</label>
                            <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                                <input type="date" id="notice-expire-date" value="${defaultDate}" style="flex: 1; min-width: 110px; padding: 5px 6px; background: #0f172a; border: 1px solid #334155; border-radius: 4px; color: #e2e8f0; font-size: 0.8rem;">
                                <select id="notice-expire-hour" style="width: 60px; padding: 5px 3px; background: #0f172a; border: 1px solid #334155; border-radius: 4px; color: #e2e8f0; font-size: 0.8rem;">
                                    ${hourOptions}
                                </select>
                                <select id="notice-expire-minute" style="width: 60px; padding: 5px 3px; background: #0f172a; border: 1px solid #334155; border-radius: 4px; color: #e2e8f0; font-size: 0.8rem;">
                                    ${minuteOptions}
                                </select>
                            </div>
                        </div>
                        
                        <button onclick="saveNotice()" style="width: 100%; padding: 8px; background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; border: none; border-radius: 4px; font-weight: 600; font-size: 0.85rem; cursor: pointer;">
                            <i class="fa-solid fa-paper-plane"></i> 공지 등록
                        </button>
                    </div>
                    
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // 현재 시간 + 1시간으로 기본값 설정
    const nextHour = new Date(now.getTime() + 60 * 60 * 1000);
    document.getElementById('notice-expire-hour').value = nextHour.getHours();
    document.getElementById('notice-expire-minute').value = 0;
}

// 5. 공지사항 저장 (POST)
window.saveNotice = async function () {
    const editId = document.getElementById('notice-edit-id').value;
    const title = document.getElementById('notice-title').value;
    const content = document.getElementById('notice-content').value;
    const expireDate = document.getElementById('notice-expire-date').value;
    const expireHour = document.getElementById('notice-expire-hour').value;
    const expireMinute = document.getElementById('notice-expire-minute').value;

    if (!title || !content) {
        alert("제목과 내용을 모두 입력해주세요.");
        return;
    }

    if (!expireDate) {
        alert("공지 종료 기한을 설정해주세요.");
        return;
    }

    const expiresAt = `${expireDate} ${String(expireHour).padStart(2, '0')}:${String(expireMinute).padStart(2, '0')}`;

    const payload = {
        isActive: true,
        id: editId ? parseInt(editId) : Date.now(),
        title: title,
        content: content,
        expiresAt: expiresAt,
        updatedAt: new Date().toLocaleString()
    };

    await requestNoticeUpdate(payload);
};

// 6. 공지사항 삭제 (ID로)
window.deleteNoticeById = async function (id) {
    if (!confirm("이 공지를 삭제하시겠습니까?")) return;

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/notice/' + id, {
            method: 'DELETE'
        });
        if (res.ok) {
            alert("삭제되었습니다.");
            document.getElementById('admin-modal-overlay').remove();
            showAdminNoticeModal(); // 새로고침
        } else {
            // 기존 방식으로 폴백
            const payload = { isActive: false, id: id, title: "", content: "" };
            await requestNoticeUpdate(payload);
        }
    } catch (e) {
        alert("오류: " + e.message);
    }
};

// 6-1. 공지 수정 모드
window.editNotice = async function (id) {
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/notices');
        if (!res.ok) throw new Error('API 오류');
        const notices = await res.json();
        const notice = [...(notices.active || []), ...(notices.expired || [])].find(n => n.id === id);

        if (notice) {
            document.getElementById('notice-edit-id').value = notice.id;
            document.getElementById('notice-title').value = notice.title || '';
            document.getElementById('notice-content').value = notice.content || '';

            if (notice.expiresAt) {
                const parts = notice.expiresAt.split(' ');
                if (parts[0]) document.getElementById('notice-expire-date').value = parts[0];
                if (parts[1]) {
                    const timeParts = parts[1].split(':');
                    document.getElementById('notice-expire-hour').value = parseInt(timeParts[0]) || 0;
                    document.getElementById('notice-expire-minute').value = parseInt(timeParts[1]) || 0;
                }
            }

            // 스크롤을 작성 영역으로
            document.querySelector('#admin-modal-overlay .notice-content').scrollTop = 9999;
        }
    } catch (e) {
        // console.error(e);
        alert("공지 정보를 불러올 수 없습니다.");
    }
};

// 6-2. 종료된 공지 재등록
window.reactivateNotice = async function (id) {
    await editNotice(id);
    // 기한을 현재 시간 + 1일로 재설정
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    document.getElementById('notice-expire-date').value = tomorrow.toISOString().split('T')[0];
    document.getElementById('notice-expire-hour').value = 23;
    document.getElementById('notice-expire-minute').value = 59;
};

// 기존 deleteNotice 호환
window.deleteNotice = async function () {
    if (!confirm("현재 게시 중인 공지를 내리시겠습니까?")) return;
    const payload = { isActive: false, id: Date.now(), title: "", content: "" };
    await requestNoticeUpdate(payload);
};

async function requestNoticeUpdate(payload) {
    try {
        // 새로운 다중 공지 API 사용
        let res = await fetch(CONFIG.API_BASE + '/api/notices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // 실패 시 기존 단일 공지 API로 폴백
        if (!res.ok) {
            res = await fetch(CONFIG.NOTICE_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }

        if (res.ok) {
            alert("적용되었습니다.");
            document.getElementById('admin-modal-overlay').remove();
            // 모달 다시 열어서 목록 갱신
            showAdminNoticeModal();
        } else {
            alert("서버 저장 실패");
        }
    } catch (e) {
        alert("오류 발생: " + e.message);
    }
}

// 7. 일반 사용자용 공지 팝업
function showNoticePopup(noticeData) {
    // 이미 팝업이 있으면 제거
    const existing = document.getElementById('main-notice-popup');
    if (existing) existing.remove();

    const isMaintenance = noticeData.title.includes('점검');
    const headerClass = isMaintenance ? 'maintenance' : '';

    const html = `
        <div class="notice-modal-overlay" id="main-notice-popup">
            <div class="notice-popup">
                <div class="notice-header ${headerClass}">
                    <span>📢 ${noticeData.title}</span>
                </div>
                <div class="notice-content">
                    ${noticeData.content}
                </div>
                <div class="notice-footer">
                    <label class="notice-checkbox-label">
                        <input type="checkbox" id="notice-dont-show"> 다시 보지 않기
                    </label>
                    <button class="notice-close-btn" onclick="closeNoticePopup(${noticeData.id})">닫기</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
}

// 8. 팝업 닫기 ("다시 보지 않기" 처리)
window.closeNoticePopup = function (noticeId) {
    const checkbox = document.getElementById('notice-dont-show');
    if (checkbox && checkbox.checked) {
        localStorage.setItem('hidden_notice_id', String(noticeId));
    }
    const popup = document.getElementById('main-notice-popup');
    if (popup) popup.remove();
};

// 9. 하드코딩 팝업: 서버 점검 중 (연결 불가)
function showMaintenancePopup() {
    const html = `
        <div class="notice-modal-overlay" id="server-maintenance-popup" style="z-index:10000;">
            <div class="notice-popup">
                <div class="notice-header maintenance">
                    <span>🔌 서버 연결 불가</span>
                </div>
                <div class="notice-content" style="text-align: center;">
                    <i class="fa-solid fa-server fa-3x" style="color: #cbd5e1; margin-bottom: 15px;"></i>
                    <p>현재 서버와 연결할 수 없습니다.</p>
                    <p style="font-size: 0.9rem; color: #94a3b8;">
                        서버(PC) 전원이 꺼져 있거나<br>
                        점검 중일 수 있습니다.
                    </p>
                </div>
                <div class="notice-footer" style="justify-content: center;">
                    <button class="notice-close-btn" onclick="document.getElementById('server-maintenance-popup').remove(); location.reload();">
                        <i class="fa-solid fa-rotate-right"></i> 다시 시도
                    </button>
                </div>
            </div>
        </div>
    `;
    // 중복 방지
    if (!document.getElementById('server-maintenance-popup')) {
        document.body.insertAdjacentHTML('beforeend', html);
    }
}

// 10. 하드코딩 팝업: 네트워크 오류
function showNetworkErrorPopup() {
    const html = `
        <div class="notice-modal-overlay" id="network-error-popup" style="z-index:10000;">
            <div class="notice-popup">
                <div class="notice-header error">
                    <span>📶 네트워크 오류</span>
                </div>
                <div class="notice-content" style="text-align: center;">
                    <i class="fa-solid fa-wifi fa-3x" style="color: #cbd5e1; margin-bottom: 15px;"></i>
                    <p>인터넷 연결이 끊겨 있습니다.</p>
                    <p style="font-size: 0.9rem; color: #94a3b8;">
                        Wi-Fi 또는 데이터 설정을<br>확인해 주세요.
                    </p>
                </div>
                <div class="notice-footer" style="justify-content: center;">
                    <button class="notice-close-btn" onclick="document.getElementById('network-error-popup').remove(); location.reload();">
                        <i class="fa-solid fa-rotate-right"></i> 다시 시도
                    </button>
                </div>
            </div>
        </div>
    `;
    if (!document.getElementById('network-error-popup')) {
        document.body.insertAdjacentHTML('beforeend', html);
    }
}

// 전역 등록
window.showMyLocationWeather = showMyLocationWeather;

// ============================================================================
// [신규] 홍보정보 게시판 기능
// ============================================================================

// 전역 변수
let promoQuillEditor = null;
let currentEditingPromoId = null;
let currentAttachments = []; // [New] 현재 편집 중인 게시글의 첨부파일 목록

// [New] 첨부파일 목록 렌더링
function renderAttachmentList() {
    const listEl = document.getElementById('promo-attachment-list');
    if (!listEl) return;

    if (currentAttachments.length === 0) {
        listEl.innerHTML = '<div style="text-align:center; color:#64748b; font-size:0.85rem; padding:10px;">첨부된 파일이 없습니다</div>';
        return;
    }

    listEl.innerHTML = currentAttachments.map((file, idx) => `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:rgba(255,255,255,0.05); border-radius:6px; border:1px solid rgba(255,255,255,0.1);">
            <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
                <i class="fa-solid ${getFileIcon(file.originalName)}" style="color:#4fc3f7;"></i>
                <span style="font-size:0.85rem; color:#e2e8f0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${file.originalName}</span>
                <span style="font-size:0.75rem; color:#64748b;">(${formatFileSize(file.size || 0)})</span>
            </div>
            <button onclick="removeAttachment(${idx})" style="background:rgba(239,68,68,0.2); border:none; color:#f87171; width:24px; height:24px; border-radius:4px; cursor:pointer; font-size:0.8rem;">
                <i class="fa-solid fa-times"></i>
            </button>
        </div>
    `).join('');
}

// [New] 파일 아이콘 결정
function getFileIcon(filename) {
    const ext = (filename || '').split('.').pop().toLowerCase();
    const icons = {
        'xlsx': 'fa-file-excel', 'xls': 'fa-file-excel',
        'hwp': 'fa-file-lines',
        'pdf': 'fa-file-pdf',
        'doc': 'fa-file-word', 'docx': 'fa-file-word',
        'ppt': 'fa-file-powerpoint', 'pptx': 'fa-file-powerpoint',
        'zip': 'fa-file-zipper', 'rar': 'fa-file-zipper'
    };
    return icons[ext] || 'fa-file';
}

// [New] 파일 크기 포맷
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// [New] 첨부파일 제거
window.removeAttachment = function (index) {
    currentAttachments.splice(index, 1);
    renderAttachmentList();
};

// [New] 파일 업로드 핸들러
async function handleFileUpload(files) {
    const statusEl = document.getElementById('promo-file-upload-status');
    if (statusEl) statusEl.style.display = 'block';

    for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch(CONFIG.API_BASE + '/api/upload-file', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();

            if (data.success || data.url) {
                currentAttachments.push({
                    url: data.url,
                    filename: data.filename,
                    originalName: data.originalName || file.name,
                    size: data.size || file.size,
                    type: data.type || file.type
                });
            } else {
                alert('파일 업로드 실패: ' + (data.error || '알 수 없는 오류'));
            }
        } catch (e) {
            // console.error('파일 업로드 오류:', e);
            alert('파일 업로드 중 오류가 발생했습니다.');
        }
    }

    if (statusEl) statusEl.style.display = 'none';
    renderAttachmentList();
}

// 1. 게시글 목록 불러오기
async function loadPromoPosts() {
    const container = document.getElementById('promo-list');
    if (!container) return;

    // 로딩 스피너 표시
    container.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 0; color: #94a3b8;">
            <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 2rem; color: #38bdf8; margin-bottom: 15px;"></i>
            <div style="font-size: 0.95rem;">게시글을 불러오는 중입니다...</div>
        </div>
    `;

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/promo');
        if (!res.ok) throw new Error('API 오류');
        const posts = await res.json();
        updateNewBadges(posts); // [New] 뱃지 업데이트
        renderPromoPosts(posts);
    } catch (e) {
        // console.error('게시글 로드 실패:', e);
        container.innerHTML = `
            <div class="promo-empty">
                <i class="fa-solid fa-clipboard-list"></i>
                <p>게시글을 불러올 수 없습니다.</p>
            </div>
        `;
    }
}

// 24시간 이내 새 게시글 체크 및 뱃지 표시
function updateNewBadges(posts) {
    if (!posts || posts.length === 0) return;

    const now = new Date();
    const ONE_DAY = 24 * 60 * 60 * 1000; // 24시간 (ms)

    // 카테고리별 새 글 유무 상태
    const hasNew = {
        'ALL': false,
        'NOTICE': false,
        'LEGAL': false,
        'PROMO': false
    };

    posts.forEach(post => {
        // 날짜 파싱 (다양한 형식을 고려하여 안전하게 처리)
        // 예: "2026.01.01", "2026-01-01T...", etc.
        let postDateStr = post.createdAt;
        if (!postDateStr) return;

        // 점(.)을 하이픈(-)으로 변경하여 호환성 확보
        postDateStr = postDateStr.replace(/\./g, '-');

        const postDate = new Date(postDateStr);

        // 유효한 날짜인 경우에만 계산
        if (!isNaN(postDate.getTime())) {
            const diff = now - postDate;
            if (diff >= 0 && diff < ONE_DAY) { // 24시간 이내 (미래 날짜 제외)
                hasNew['ALL'] = true; // 전체에는 하나라도 있으면 표시
                if (hasNew.hasOwnProperty(post.category)) {
                    hasNew[post.category] = true;
                }
            }
        }
    });

    // 1. 메인 탭 (공지사항) 뱃지 업데이트
    const mainTabBtn = document.querySelector('.main-tabs .tab-btn[data-target="promo-section"]');
    if (mainTabBtn) {
        const existingBadge = mainTabBtn.querySelector('.new-badge');
        if (existingBadge) existingBadge.remove();

        if (hasNew['ALL']) {
            const badge = document.createElement('span');
            badge.className = 'new-badge';
            badge.textContent = 'N';
            mainTabBtn.appendChild(badge);
        }
    }

    // 2. 카테고리 필터 버튼 뱃지 업데이트
    // 순서: 전체(0), 공지사항(1), 법률정보(2), 홍보정보(3)
    const categoryBtns = document.querySelectorAll('.promo-tabs .promo-tab-btn');
    const mapping = ['ALL', 'NOTICE', 'LEGAL', 'PROMO'];

    categoryBtns.forEach((btn, index) => {
        if (index >= mapping.length) return;
        const category = mapping[index];

        const existingBadge = btn.querySelector('.new-badge');
        if (existingBadge) existingBadge.remove();

        if (hasNew[category]) {
            const badge = document.createElement('span');
            badge.className = 'new-badge';
            badge.textContent = 'N';
            btn.appendChild(badge);
        }
    });
}

// 2. 게시글 목록 렌더링
let allPromoPosts = []; // 전체 게시글 원본 데이터 저장
let currentPromoCategory = 'ALL'; // 현재 선택된 카테고리
let currentSearchKeyword = ''; // 현재 검색어
const PROMO_ITEMS_PER_PAGE = 10; // 페이지당 게시글 수
let currentPromoPage = 1; // 현재 페이지

function renderPromoPosts(posts) {
    // 렌더링 시 전역 변수 업데이트 (최초 로드 시)
    if (posts) allPromoPosts = posts;

    // 필터링 및 검색 로직 적용
    let displayPosts = allPromoPosts.filter(post => {
        // 1. 카테고리 필터
        if (currentPromoCategory !== 'ALL' && post.category !== currentPromoCategory) return false;
        // 2. 검색 필터
        if (currentSearchKeyword) {
            const keyword = currentSearchKeyword.toLowerCase();
            return (post.title || '').toLowerCase().includes(keyword) ||
                (post.content || '').toLowerCase().includes(keyword);
        }
        return true;
    });

    // 정렬 로직: 중요(Pinned) 게시글 상단 고정, 그 외는 최신순
    displayPosts.sort((a, b) => {
        // 둘 다 Pinned이면 날짜 비교
        if (a.isPinned && b.isPinned) return new Date(b.createdAt) - new Date(a.createdAt);
        // a만 Pinned이면 a가 먼저
        if (a.isPinned) return -1;
        // b만 Pinned이면 b가 먼저
        if (b.isPinned) return 1;
        // 둘 다 아니면 날짜 비교 (최신순)
        return new Date(b.createdAt) - new Date(a.createdAt);
    });

    // [추가] 페이지네이션 로직 적용
    const totalItems = displayPosts.length;
    const totalPages = Math.ceil(totalItems / PROMO_ITEMS_PER_PAGE);

    // 페이지 범위 보정
    if (currentPromoPage < 1) currentPromoPage = 1;
    if (currentPromoPage > totalPages && totalPages > 0) currentPromoPage = totalPages;

    const startIndex = (currentPromoPage - 1) * PROMO_ITEMS_PER_PAGE;
    const endIndex = startIndex + PROMO_ITEMS_PER_PAGE;
    const paginatedPosts = displayPosts.slice(startIndex, endIndex);

    const container = document.getElementById('promo-list');
    const paginationContainer = document.getElementById('promo-pagination'); // [추가]
    if (!container) return;

    if (!paginatedPosts || paginatedPosts.length === 0) {
        container.innerHTML = `
            <div class="promo-empty">
                <i class="fa-solid fa-clipboard-list"></i>
                <p>조건에 맞는 게시글이 없습니다.</p>
            </div>
        `;
        if (paginationContainer) paginationContainer.innerHTML = ''; // 빈 목록이면 페이지네이션 숨김
        return;
    }

    // 날짜 포맷 헬퍼 (함수 내부 이동: "yyyy.MM.dd HH:mm" 형태)
    function formatPromoDate(dateStr) {
        if (!dateStr) return '';
        const match = dateStr.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(오전|오후)\s*(\d{1,2}):(\d{2})/);
        if (match) {
            const [, year, month, day, ampm, hour, minute] = match;
            let h = parseInt(hour);
            if (ampm === '오후' && h !== 12) h += 12;
            if (ampm === '오전' && h === 12) h = 0;
            return `${year}.${month.padStart(2, '0')}.${day.padStart(2, '0')} ${String(h).padStart(2, '0')}:${minute}`;
        }
        // 기본적으로 날짜 형식이 이미 "YYYY.MM.DD HH:mm"으로 오는지 확인
        // 만약 서버에서 "YYYY.MM.DD HH:mm"으로 준다면 그대로 사용
        return dateStr;
    }

    // 카테고리 뱃지 생성 헬퍼
    function getCategoryBadge(category, isPinned) {
        // 중요 공지는 카테고리 무관 붉은색? or 카테고리별? -> 기획: 카테고리별 색상
        // [전체] 탭일 때만 뱃지 표시하거나, 항상 표시하거나.
        // 기획: "[전체] 탭에서만 나타나는 거지? 해당 테그가 게시글 왼쪽에 위치"

        if (currentPromoCategory !== 'ALL') return ''; // 개별 탭에서는 표시 X

        let badgeClass = 'promo-badge-gray';
        let badgeText = '알림';

        if (category === 'NOTICE') {
            badgeClass = 'promo-badge-red';
            badgeText = '공지';
        } else if (category === 'LEGAL') {
            badgeClass = 'promo-badge-blue';
            badgeText = '법률';
        } else if (category === 'PROMO') {
            badgeClass = 'promo-badge-green';
            badgeText = '홍보';
        }

        return `<span class="promo-badge ${badgeClass}">${badgeText}</span>`;
    }

    const now = new Date();
    const ONE_DAY = 24 * 60 * 60 * 1000;

    container.innerHTML = paginatedPosts.map(post => {
        const isPinnedClass = post.isPinned ? 'pinned-post' : '';
        const badgeHtml = getCategoryBadge(post.category, post.isPinned);
        const pinIcon = post.isPinned ? '<i class="fa-solid fa-thumbtack" style="color:#ff5252; margin-right:4px;"></i>' : '';

        // [New] 24시간 이내 새 글 뱃지 (리스트용)
        let newBadgeHtml = '';
        if (post.createdAt) {
            let pDate = new Date(post.createdAt.replace(/\./g, '-'));
            if (!isNaN(pDate.getTime()) && (now - pDate) >= 0 && (now - pDate) < ONE_DAY) {
                newBadgeHtml = '<span class="new-badge" style="vertical-align: middle; margin-left: 6px;">N</span>';
            }
        }

        // 카테고리 미지정 데이터 보정
        const category = post.category || 'PROMO';

        return `
        <div class="promo-item ${isPinnedClass}" onclick="openPromoDetail(${post.id})">
            <div class="promo-item-title">
                ${badgeHtml}
                ${pinIcon}
                ${escapeHtml(post.title)}${newBadgeHtml}
            </div>
            <div class="promo-item-meta">
                <span class="promo-item-date">${formatPromoDate(post.createdAt)}</span>
                <span class="promo-item-views"><i class="fa-regular fa-eye"></i> ${post.views || 0}</span>
            </div>
        </div>
        `;
    }).join('');

    renderPagination(totalPages); // [추가] 페이지네이션 버튼 렌더링
}

// [추가] 페이지네이션 UI 렌더링 함수
function renderPagination(totalPages) {
    const container = document.getElementById('promo-pagination');
    if (!container) return;

    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = '';

    // 이전 버튼
    if (currentPromoPage > 1) {
        html += `<button class="pagination-btn" onclick="changePromoPage(${currentPromoPage - 1})"><i class="fa-solid fa-chevron-left"></i></button>`;
    }

    // 페이지 번호 (최대 5개 표시 예시: 1 2 3 4 5)
    // 간단하게 구현: 전체 다 보여주되 너무 많으면 스크롤 등 (여기서는 전체 표시하되 스타일로 조정)
    // 혹은 현재 페이지 주변만 표시하는 로직 추가 가능
    for (let i = 1; i <= totalPages; i++) {
        if (i === currentPromoPage) {
            html += `<button class="pagination-btn active">${i}</button>`;
        } else {
            html += `<button class="pagination-btn" onclick="changePromoPage(${i})">${i}</button>`;
        }
    }

    // 다음 버튼
    if (currentPromoPage < totalPages) {
        html += `<button class="pagination-btn" onclick="changePromoPage(${currentPromoPage + 1})"><i class="fa-solid fa-chevron-right"></i></button>`;
    }

    container.innerHTML = html;
}

// [추가] 페이지 변경 핸들러
window.changePromoPage = function (page) {
    currentPromoPage = page;
    renderPromoPosts();
    // 페이지 이동 시 목록 상단으로 스크롤은 선택 사항 (필요 시 구현)
    // document.getElementById('promo-list').scrollIntoView({ behavior: 'smooth' });
};

// 2-1. 카테고리 필터링 함수
window.filterPromo = function (category) {
    currentPromoCategory = category;
    currentPromoPage = 1; // [수정] 필터 변경 시 1페이지로

    // 탭 UI 업데이트
    document.querySelectorAll('.promo-tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    // 현재 클릭된 버튼 찾아서 active (이벤트 타겟 대신 텍스트 비교 등으로 찾음)
    const btns = document.querySelectorAll('.promo-tab-btn');
    if (category === 'ALL') btns[0].classList.add('active');
    else if (category === 'NOTICE') btns[1].classList.add('active');
    else if (category === 'LEGAL') btns[2].classList.add('active');
    else if (category === 'PROMO') btns[3].classList.add('active');

    renderPromoPosts(); // 재렌더링
};

// 2-2. 검색 함수
window.searchPromo = function () {
    const input = document.getElementById('promo-search-input');
    if (input) {
        currentSearchKeyword = input.value.trim();
        currentPromoPage = 1; // [수정] 검색 시 1페이지로
        renderPromoPosts();
    }
}

// 2-1. 카테고리 필터링 함수
window.filterPromo = function (category) {
    currentPromoCategory = category;

    // 탭 UI 업데이트
    document.querySelectorAll('.promo-tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    // 현재 클릭된 버튼 찾아서 active (이벤트 타겟 대신 텍스트 비교 등으로 찾음)
    const btns = document.querySelectorAll('.promo-tab-btn');
    if (category === 'ALL') btns[0].classList.add('active');
    else if (category === 'NOTICE') btns[1].classList.add('active');
    else if (category === 'LEGAL') btns[2].classList.add('active');
    else if (category === 'PROMO') btns[3].classList.add('active');

    renderPromoPosts(); // 재렌더링
};

// 2-2. 검색 함수
window.searchPromo = function () {
    const input = document.getElementById('promo-search-input');
    if (input) {
        currentSearchKeyword = input.value.trim();
        renderPromoPosts();
    }
}

// 3. 게시글 상세 보기 열기
window.openPromoDetail = async function (postId) {
    const modal = document.getElementById('promo-detail-modal');
    if (!modal) return;

    try {
        // [수정] 상세 조회 API 호출 (조회수 자동 증가)
        const res = await fetch(CONFIG.API_BASE + '/api/promo/' + postId);
        if (!res.ok) {
            alert('게시글을 불러올 수 없습니다.');
            return;
        }
        const post = await res.json();

        // 목록의 조회수도 업데이트하기 위해 목록 새로고침 (백그라운드)
        loadPromoPosts();

        document.getElementById('promo-detail-title').textContent = post.title;
        document.getElementById('promo-detail-date').textContent = post.createdAt;
        document.getElementById('promo-detail-views').textContent = post.views || 0;

        const contentEl = document.getElementById('promo-detail-content');
        contentEl.innerHTML = post.content;

        // [New] 첨부파일 표시 (전용 컨테이너 사용 및 극소형 레이아웃)
        const attachmentContainer = document.getElementById('promo-detail-attachments');
        if (attachmentContainer) {
            attachmentContainer.innerHTML = ''; // 초기화
            if (post.attachments && post.attachments.length > 0) {
                const attachmentHtml = `
                    <div style="margin: 5px 15px 15px; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); max-width: 400px;">
                        <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 8px; display: flex; align-items: center; gap: 5px;">
                            <i class="fa-solid fa-paperclip"></i>
                            <span style="font-weight: 600;">첨부파일 (${post.attachments.length})</span>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            ${post.attachments.map(file => `
                                <a href="${file.url}" download="${file.originalName}" target="_blank" 
                                   style="display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: rgba(255,255,255,0.03); border-radius: 6px; text-decoration: none; border: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;">
                                    <i class="fa-solid ${getFileIcon(file.originalName)}" style="color: #4fc3f7; font-size: 1rem;"></i>
                                    <div style="flex: 1; min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 15px;">
                                        <span style="font-size: 0.85rem; color: #e2e8f0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${file.originalName}</span>
                                        <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                                            <span style="font-size: 0.75rem; color: #64748b;">${formatFileSize(file.size || 0)}</span>
                                            <i class="fa-solid fa-download" style="color: #4fc3f7; font-size: 0.85rem;"></i>
                                        </div>
                                    </div>
                                </a>
                            `).join('')}
                        </div>
                    </div>
                `;
                attachmentContainer.innerHTML = attachmentHtml;
            }
        }


        const images = contentEl.querySelectorAll('img');
        images.forEach(img => {
            // 이미 캐시되어 완료된 경우 패스
            if (img.complete) return;

            // 1. 이미지 숨김 및 투명도 설정 (페이드인 준비)
            const originalDisplay = img.style.display || 'block'; // Quill 이미지는 보통 block
            img.style.display = 'none';
            img.style.opacity = '0';
            img.style.transition = 'opacity 0.6s ease-out';
            img.style.maxWidth = '100%'; // 모바일 화면 넘침 방지

            // 2. 로딩 UI 생성
            const loader = document.createElement('div');
            loader.className = 'img-loader';
            loader.style.cssText = `
                display: flex; 
                flex-direction: column; 
                align-items: center; 
                justify-content: center; 
                padding: 40px; 
                background: rgba(255, 255, 255, 0.03); 
                border-radius: 8px; 
                margin: 10px 0;
                border: 1px dashed rgba(255, 255, 255, 0.1);
                min-height: 150px;
            `;
            loader.innerHTML = `
                <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 2rem; color: #4fc3f7; margin-bottom: 15px;"></i>
                <div style="font-size: 0.9rem; color: #a0aec0; font-weight: 500;">이미지를 불러오는 중입니다...</div>
            `;

            // 이미지 앞에 삽입
            img.parentNode.insertBefore(loader, img);

            // 3. 로드 완료 핸들러
            img.onload = () => {
                loader.remove();
                img.style.display = originalDisplay;
                // 리플로우 후 페이드인
                requestAnimationFrame(() => {
                    img.style.opacity = '1';
                });
            };

            // 4. 에러 핸들러
            img.onerror = () => {
                loader.innerHTML = `
                    <i class="fa-solid fa-triangle-exclamation" style="font-size: 2rem; color: #ef5350; margin-bottom: 10px;"></i>
                    <div style="color: #ef5350;">이미지를 불러올 수 없습니다.</div>
                `;
                // 에러난 이미지는 숨긴 상태 유지
            };
        });

        modal.classList.remove('hidden');
    } catch (e) {
        // console.error('상세 보기 오류:', e);
        alert('게시글을 불러올 수 없습니다.');
    }
};

// 4. 게시글 상세 보기 닫기 (YouTube 영상 정지 포함)
window.closePromoDetail = function () {
    const modal = document.getElementById('promo-detail-modal');
    if (modal) {
        // YouTube iframe 정지 (src 초기화로 영상 중단)
        const iframes = modal.querySelectorAll('iframe');
        iframes.forEach(iframe => {
            const src = iframe.src;
            iframe.src = ''; // 먼저 비우고
            iframe.src = src; // 다시 설정 (재생 중단됨)
        });
        modal.classList.add('hidden');
        // [New] 첨부파일 영역 초기화
        const attachmentContainer = document.getElementById('promo-detail-attachments');
        if (attachmentContainer) attachmentContainer.innerHTML = '';
    }
};

// 5. HTML 이스케이프 (XSS 방지)
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================================================
// [관리자] 홍보 게시판 관리 기능
// ============================================================================
// Legacy openPromoAdminPanel removed. Using showPromoManagementModal instead.

// 8. 새 글 작성 에디터 열기
window.openPromoEditor = function (editData = null) {
    // 기존 모달 닫기
    const adminModal = document.getElementById('admin-modal');
    if (adminModal) adminModal.classList.add('hidden');
    const promoMgmtModal = document.getElementById('promo-management-modal');
    if (promoMgmtModal) promoMgmtModal.remove();
    const unifiedModal = document.getElementById('unified-admin-modal');
    if (unifiedModal) unifiedModal.style.display = 'none'; // 편집 중에는 잠깐 숨김

    currentEditingPromoId = editData ? editData.id : null;

    // 에디터 모달 생성
    let editorModal = document.getElementById('promo-editor-modal');
    if (!editorModal) {
        const html = `
            <div id="promo-editor-modal" class="modal">
                <div class="modal-content promo-editor-modal-content">
                    <div class="modal-header">
                        <h3 id="promo-editor-header-title"><i class="fa-solid fa-pen-to-square"></i> 새 글 작성</h3>
                        <button class="modal-close" onclick="closePromoEditor()">&times;</button>
                    </div>
                    <div class="promo-editor-body">
                        <div style="display:flex; gap:10px; margin-bottom:15px;">
                            <select id="promo-editor-category" style="flex:1; padding:12px; background:#0f172a; border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff; font-size:1rem;">
                                <option value="NOTICE">📢 공지사항</option>
                                <option value="LEGAL">⚖️ 법률정보</option>
                                <option value="PROMO">🎉 홍보정보</option>
                            </select>
                            <label style="display:flex; align-items:center; gap:8px; padding:0 15px; background:rgba(255,82,82,0.1); border:1px solid rgba(255,82,82,0.3); border-radius:8px; cursor:pointer;">
                                <input type="checkbox" id="promo-editor-pinned">
                                <span style="font-size:0.9rem; color:#ff8a80; font-weight:600;"><i class="fa-solid fa-thumbtack"></i> 상단 고정</span>
                            </label>
                        </div>
                        <input type="text" id="promo-editor-title" class="promo-editor-title-input" placeholder="제목을 입력하세요">
                        <div id="promo-quill-editor"></div>
                        <!-- 이미지 업로드 진행률 표시 -->
                        <div id="promo-upload-progress" style="display:none; margin-top:10px; background:rgba(255,255,255,0.1); border-radius:4px; overflow:hidden; position:relative; height:24px; border:1px solid rgba(255,255,255,0.2);">
                            <div id="promo-upload-bar" style="width:0%; height:100%; background:linear-gradient(90deg, #4caf50, #8bc34a); transition:width 0.1s linear;"></div>
                            <div id="promo-upload-text" style="position:absolute; top:0; left:0; width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-size:0.85rem; color:#fff; font-weight:600; text-shadow:0 1px 2px rgba(0,0,0,0.5);">0%</div>
                        </div>
                        <!-- [New] 첨부파일 영역 -->
                        <div id="promo-attachment-section" style="margin-top:15px; padding:15px; background:rgba(0,0,0,0.2); border-radius:8px; border:1px dashed rgba(255,255,255,0.2);">
                            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
                                <span style="font-size:0.9rem; color:#94a3b8;"><i class="fa-solid fa-paperclip" style="margin-right:6px;"></i>첨부파일</span>
                                <label style="cursor:pointer; padding:6px 12px; background:rgba(79,195,247,0.2); border:1px solid rgba(79,195,247,0.4); border-radius:6px; font-size:0.8rem; color:#4fc3f7;">
                                    <i class="fa-solid fa-plus" style="margin-right:4px;"></i>파일 추가
                                    <input type="file" id="promo-file-input" style="display:none;" multiple accept=".xlsx,.xls,.hwp,.pdf,.doc,.docx,.ppt,.pptx,.zip">
                                </label>
                            </div>
                            <div id="promo-attachment-list" style="display:flex; flex-direction:column; gap:8px;">
                                <!-- 첨부된 파일 목록이 여기에 표시됨 -->
                            </div>
                            <div id="promo-file-upload-status" style="display:none; margin-top:10px; padding:8px; background:rgba(255,255,255,0.05); border-radius:4px; font-size:0.85rem; color:#aaa; text-align:center;">
                                <i class="fa-solid fa-spinner fa-spin"></i> 파일 업로드 중...
                            </div>
                        </div>
                    </div>
                    <div class="promo-editor-footer">
                        <button class="promo-btn-cancel" onclick="closePromoEditor()">취소</button>
                        <button class="promo-btn-save" onclick="savePromoPost()"><i class="fa-solid fa-check"></i> 저장</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);
        editorModal = document.getElementById('promo-editor-modal');
    }

    editorModal.classList.remove('hidden');

    // Quill 에디터 초기화 (한 번만)
    if (!promoQuillEditor) {
        promoQuillEditor = new Quill('#promo-quill-editor', {
            theme: 'snow',
            placeholder: '내용을 입력하세요...',
            modules: {
                toolbar: [
                    [{ 'header': [1, 2, 3, false] }],
                    ['bold', 'italic', 'underline', 'strike'],
                    [{ 'color': [] }, { 'background': [] }],
                    [{ 'align': [] }],
                    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                    ['link', 'image', 'video'],
                    ['clean']
                ]
            }
        });

        // 이미지 업로드 핸들러 (서버로 업로드)
        promoQuillEditor.getModule('toolbar').addHandler('image', function () {
            const input = document.createElement('input');
            input.setAttribute('type', 'file');
            input.setAttribute('accept', 'image/*');
            input.click();

            input.onchange = async () => {
                const file = input.files[0];
                if (!file) return;

                const formData = new FormData();
                formData.append('file', file);

                // Progress Bar 요소
                const progressContainer = document.getElementById('promo-upload-progress');
                const progressBar = document.getElementById('promo-upload-bar');
                const progressText = document.getElementById('promo-upload-text');

                progressContainer.style.display = 'block';
                progressBar.style.width = '0%';
                progressText.innerText = '준비 중...';

                // XHR 사용 (진행률 추적)
                const xhr = new XMLHttpRequest();
                xhr.open('POST', CONFIG.API_BASE + '/api/upload', true);

                xhr.upload.onprogress = function (e) {
                    if (e.lengthComputable) {
                        const percentComplete = Math.floor((e.loaded / e.total) * 100);
                        progressBar.style.width = percentComplete + '%';
                        progressText.innerText = `이미지 업로드 중: ${percentComplete}%`;
                    }
                };

                xhr.onload = function () {
                    if (xhr.status === 200) {
                        const data = JSON.parse(xhr.responseText);
                        if (data.url) {
                            const range = promoQuillEditor.getSelection(true);
                            promoQuillEditor.insertEmbed(range.index, 'image', data.url);
                        }
                    } else {
                        // console.error('업로드 실패:', xhr.statusText);
                        alert('이미지 업로드에 실패했습니다.');
                    }
                    // 완료 후 숨김 (잠시 후)
                    setTimeout(() => {
                        progressContainer.style.display = 'none';
                    }, 500);
                };

                xhr.onerror = function () {
                    // console.error('업로드 네트워크 오류');
                    alert('이미지 업로드 중 네트워크 오류가 발생했습니다.');
                    progressContainer.style.display = 'none';
                };

                xhr.send(formData);
            };
        });
    }

    // 수정 모드라면 기존 데이터 채우기
    document.getElementById('promo-editor-header-title').innerHTML = editData
        ? '<i class="fa-solid fa-pen-to-square"></i> 글 수정'
        : '<i class="fa-solid fa-pen-to-square"></i> 새 글 작성';
    document.getElementById('promo-editor-title').value = editData ? editData.title : '';
    document.getElementById('promo-editor-category').value = editData ? (editData.category || 'PROMO') : 'PROMO';
    document.getElementById('promo-editor-pinned').checked = editData ? (editData.isPinned || false) : false;
    promoQuillEditor.root.innerHTML = editData ? editData.content : '';

    // [New] 첨부파일 초기화
    currentAttachments = editData && editData.attachments ? [...editData.attachments] : [];
    renderAttachmentList();

    // [New] 파일 선택 이벤트 핸들러 등록
    const fileInput = document.getElementById('promo-file-input');
    if (fileInput) {
        fileInput.value = ''; // 초기화
        fileInput.onchange = (e) => {
            if (e.target.files && e.target.files.length > 0) {
                handleFileUpload(e.target.files);
            }
        };
    }
};

window.closePromoEditor = function () {
    const modal = document.getElementById('promo-editor-modal');
    if (modal) modal.classList.add('hidden');
    const unifiedModal = document.getElementById('unified-admin-modal');
    if (unifiedModal) unifiedModal.style.display = 'flex'; // 다시 표시
    currentEditingPromoId = null;
};

// 9. 게시글 저장
window.savePromoPost = async function () {
    const title = document.getElementById('promo-editor-title').value.trim();
    const content = promoQuillEditor.root.innerHTML;

    if (!title) {
        alert('제목을 입력해주세요.');
        return;
    }
    if (!content || content === '<p><br></p>') {
        alert('내용을 입력해주세요.');
        return;
    }

    const category = document.getElementById('promo-editor-category').value;
    const isPinned = document.getElementById('promo-editor-pinned').checked;

    const postData = {
        title: title,
        content: content,
        category: category,
        isPinned: isPinned,
        attachments: currentAttachments // [New] 첨부파일 배열
    };
    if (currentEditingPromoId) {
        postData.id = currentEditingPromoId;
    }

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/promo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(postData)
        });
        const result = await res.json();

        if (result.success) {
            alert(currentEditingPromoId ? '게시글이 수정되었습니다.' : '게시글이 등록되었습니다.');
            closePromoEditor();
            loadPromoPosts(); // 목록 새로고침
            if (typeof loadPromoListForAdmin === 'function') loadPromoListForAdmin();
            if (typeof loadUnifiedPromoList === 'function') loadUnifiedPromoList();
        } else {
            alert('저장 실패: ' + (result.error || '알 수 없는 오류'));
        }
    } catch (e) {
        // console.error('저장 오류:', e);
        alert('서버 오류로 저장에 실패했습니다.');
    }
};

// 10. 게시글 수정 (에디터 열기)
window.editPromoPost = async function (postId) {
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/promo');
        const posts = await res.json();
        const post = posts.find(p => String(p.id) === String(postId));
        if (post) {
            openPromoEditor(post);
        } else {
            alert('게시글을 찾을 수 없습니다.');
        }
    } catch (e) {
        // console.error('수정 로드 오류:', e);
    }
};

// 11. 게시글 삭제
window.deletePromoPost = async function (postId) {
    if (!confirm('정말로 이 게시글을 삭제하시겠습니까?')) return;

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/promo/' + postId, {
            method: 'DELETE'
        });
        const result = await res.json();

        if (result.success) {
            alert('삭제되었습니다.');
            if (typeof loadPromoListForAdmin === 'function') loadPromoListForAdmin();
            loadPromoPosts();
        } else {
            alert('삭제 실패: ' + (result.error || '알 수 없는 오류'));
        }
    } catch (e) {
        // console.error('삭제 오류:', e);
        alert('서버 오류로 삭제에 실패했습니다.');
    }
};

// 12. 탭 전환 시 게시글 로드 및 관리자 인증 (15회 클릭)
document.addEventListener('DOMContentLoaded', async function () {
    // [New] 네이티브 스플래시(=검정화면) 종료 -> 웹 스플래시 시작
    if (window.hideNativeSplash) {
        // 약간의 딜레이를 주어 흰색 플래시를 완전히 방지할 수도 있음
        setTimeout(() => window.hideNativeSplash(), 100);
    }

    let unifiedAdminClickCount = 0;
    let unifiedAdminClickTimer = null;

    // 스플래시 화면 노출 시작 시간
    const splashStartTime = Date.now();

    // [New] Capacitor 네이티브 환경 감지 (앱 접속 시 스플래시 스킵)
    const isNativeApp = window.Capacitor && window.Capacitor.isNativePlatform();

    // 스플래시 화면 제거 함수
    const hideSplash = () => {
        const splash = document.getElementById('splash-screen');
        if (splash) {
            // 앱/웹 모두 자연스러운 페이드 아웃 적용
            splash.classList.add('fade-out');
            setTimeout(() => {
                splash.remove();
                document.body.classList.remove('loading');
            }, 800); // splash.css의 transition 시간(0.8s)과 일치
        }
    };

    // 1. 데이터 로딩 대기
    try {
        await fetchAllData();
    } catch (e) {
        // console.error('Initial data fetch failed:', e);
    }

    // 2. 스플래시 종료 타이밍 결정
    // [수정] 앱에서도 웹 스플래시를 보여줌 (검정화면 -> 웹 스플래시 -> 메인)
    // 네이티브 스플래시는 0초(검정)로 지나가고, 웹 스플래시가 2초간 나옴
    const minSplashTime = 2000;
    const elapsedTime = Date.now() - splashStartTime;
    const delay = Math.max(0, minSplashTime - elapsedTime);

    setTimeout(hideSplash, delay);

    // [New] 푸시 알림 파라미터 확인 및 팝업 표시
    // checkForPushPopup 제거됨 (fix_popup_logic.js 이관)

    // === [New] 헤더 15회 클릭 시 통합 관리자 센터 진입 ===
    const headerContent = document.querySelector('.header-content');
    if (headerContent) {
        headerContent.addEventListener('click', function (e) {
            // 사용자 클릭만 카운트
            const isUserClick = e.detail > 0 || e.isTrusted;
            if (!isUserClick) return;

            unifiedAdminClickCount++;
            clearTimeout(unifiedAdminClickTimer);
            unifiedAdminClickTimer = setTimeout(() => { unifiedAdminClickCount = 0; }, 3000);

            if (unifiedAdminClickCount >= 15) {
                unifiedAdminClickCount = 0;
                showUnifiedLoginModal('alert', '통합 관리자 인증', 'fa-user-shield');
            }
        });
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            // 홍보정보 탭 - 게시글 로드
            if (this.dataset.target === 'promo-section') {
                setTimeout(() => loadPromoPosts(), 100);
            }
        });
    });
});

// ============================================================================
// [통합 관리자 시스템] Unified Admin System
// ============================================================================

const adminAuthenticated = {
    api: false,
    notice: false,
    promo: false,
    alert: false
};

// 1. 통합 로그인 모달 (Mode: 'api' | 'notice' | 'promo')
window.showUnifiedLoginModal = function (mode, title, icon) {
    const existing = document.getElementById('unified-admin-login-modal');
    if (existing) existing.remove();

    const iconColor = mode === 'api' ? '#4fc3f7' : (mode === 'notice' ? '#ffd54f' : (mode === 'promo' ? '#ff7043' : '#ef5350'));

    const modal = document.createElement('div');
    modal.id = 'unified-admin-login-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease-out;';

    modal.innerHTML = `
        <div style="background:#1e2435;border-radius:12px;padding:20px;max-width:320px;width:90%;text-align:center;box-shadow:0 10px 25px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.08);">
            <h3 style="color:#fff;margin:0 0 15px;font-size:1.1rem;display:flex;align-items:center;justify-content:center;gap:8px;">
                <i class="fa-solid ${icon}" style="color:${iconColor};"></i>${title}
            </h3>
            <input type="password" id="unified-admin-password" placeholder="관리자 비밀번호" 
                   style="width:100%;padding:12px;border:1px solid rgba(255,255,255,0.1);border-radius:8px;background:rgba(0,0,0,0.3);color:#fff;font-size:1rem;box-sizing:border-box;margin-bottom:15px;outline:none;text-align:center;">
            <div style="display:flex;gap:10px;">
                <button onclick="document.getElementById('unified-admin-login-modal').remove();" 
                        style="flex:1;padding:10px;background:rgba(255,255,255,0.05);border:none;border-radius:6px;color:#aaa;cursor:pointer;transition:background 0.2s;">취소</button>
                <button onclick="verifyUnifiedAdminPassword('${mode}');" 
                        style="flex:1;padding:10px;background:linear-gradient(135deg,${iconColor},${iconColor}cc);border:none;border-radius:6px;color:#1a1f2e;font-weight:600;cursor:pointer;box-shadow:0 4px 12px ${iconColor}33;">확인</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // 엔터키 지원
    setTimeout(() => {
        const input = document.getElementById('unified-admin-password');
        if (input) {
            input.focus();
            input.onkeydown = (e) => {
                if (e.key === 'Enter') verifyUnifiedAdminPassword(mode);
            };
        }
    }, 100);
};

window.verifyUnifiedAdminPassword = function (mode) {
    const input = document.getElementById('unified-admin-password');
    if (!input) return;

    const password = input.value;

    if (password === 'zaqxsw12!wlstjq') {
        // 모든 권한을 한 번에 부여 (통합 모달이므로)
        adminAuthenticated.api = true;
        adminAuthenticated.notice = true;
        adminAuthenticated.promo = true;
        adminAuthenticated.alert = true;

        document.getElementById('unified-admin-login-modal').remove();

        // 통합 관리자 모달 호출 (인증된 모드로 시작)
        showUnifiedAdminModal(mode);
    } else {
        alert('비밀번호가 일치하지 않습니다.');
        input.value = '';
        input.focus();
    }
};

// 2. 통합 관리자 모달 메인
window.showUnifiedAdminModal = function (initialTab = 'alert') {
    const existing = document.getElementById('unified-admin-modal');
    if (existing) existing.remove();

    const tabs = [
        { id: 'alert', name: '특보 알림', icon: 'fa-tower-broadcast' },
        { id: 'api', name: 'API 설정', icon: 'fa-server' },
        { id: 'notice', name: '공지 팝업', icon: 'fa-bell' },
        { id: 'promo', name: '게시글 관리', icon: 'fa-bullhorn' },
        { id: 'stats', name: '방문자 통계', icon: 'fa-chart-line' }
    ];

    const modal = document.createElement('div');
    modal.id = 'unified-admin-modal';

    modal.innerHTML = `
        <div class="unified-admin-wrapper">
            <div class="unified-admin-header">
                <h3><i class="fa-solid fa-user-shield"></i> SEAGNAL 통합 관리자 센터</h3>
                <button class="unified-admin-close" onclick="document.getElementById('unified-admin-modal').remove();">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            
            <div class="unified-admin-main-tabs">
                ${tabs.map(t => `
                    <button class="admin-main-tab" data-tab="${t.id}" onclick="switchUnifiedAdminTab('${t.id}')">
                        <i class="fa-solid ${t.icon}"></i>
                        <span>${t.name}</span>
                    </button>
                `).join('')}
            </div>
            
            <div class="unified-admin-body" id="unified-admin-body">
                <!-- 콘텐츠가 여기에 렌더링됨 -->
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // 초기 탭 활성화
    switchUnifiedAdminTab(initialTab);
};

window.switchUnifiedAdminTab = function (tabId) {
    // 탭 버튼 스타일 업데이트
    document.querySelectorAll('.admin-main-tab').forEach(btn => {
        if (btn.dataset.tab === tabId) btn.classList.add('active');
        else btn.classList.remove('active');
    });

    const body = document.getElementById('unified-admin-body');
    if (!body) return;

    // 기존 내용 비우기
    body.innerHTML = `
        <div style="text-align:center;padding:100px;color:#64748b;">
            <i class="fa-solid fa-circle-notch fa-spin fa-2x"></i>
            <p style="margin-top:15px;font-weight:600;">데이터를 불러오는 중...</p>
        </div>
    `;

    // 탭별 콘텐츠 렌더링
    setTimeout(async () => {
        if (tabId === 'alert') {
            renderUnifiedAlertContent(body);
        } else if (tabId === 'api') {
            renderUnifiedApiContent(body);
        } else if (tabId === 'notice') {
            renderUnifiedNoticeContent(body);
        } else if (tabId === 'promo') {
            renderUnifiedPromoContent(body);
        } else if (tabId === 'stats') {
            renderUnifiedStatsContent(body);
        }
    }, 100);
};

// (A) 특보 알림 섹션 렌더링
async function renderUnifiedAlertContent(container) {
    if (!adminAuthenticated.alert) return;

    // 기존 showAlertManagementModal의 UI 구조를 차용하되 통합 모달 내부에 맞게 조정
    const tabs = [
        { id: 'publish', name: '발표', icon: 'fa-bullhorn' },
        { id: 'active', name: '발효', icon: 'fa-check-circle' },
        { id: 'release', name: '해제', icon: 'fa-check' },
        { id: 'level', name: '격상/격하', icon: 'fa-arrow-up-right-dots' },
        { id: 'custom', name: '직접 발송', icon: 'fa-paper-plane' },
        { id: 'history', name: '발송 이력', icon: 'fa-history' }
    ];

    container.innerHTML = `
        <div class="admin-section-title" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <div>
                <i class="fa-solid fa-tower-broadcast" style="color:#ef4444;"></i> 실시간 특보 알림 관리
            </div>
            <button onclick="openAlertTestModal()" style="padding:8px 16px; background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; border:none; border-radius:8px; cursor:pointer; font-size:0.85rem; font-weight:600;">
                <i class="fa-solid fa-flask"></i> 특보 수집 테스트
            </button>
        </div>
        
        <div class="admin-sub-tabs">
            ${tabs.map(t => `
                <button class="alert-admin-tab" data-tab="${t.id}" onclick="switchAlertAdminTabInternal('${t.id}')">
                    ${t.name}
                </button>
            `).join('')}
        </div>
        
        <div id="alert-admin-inner-content">
            <!-- switchAlertAdminTabInternal에 의해 채워짐 -->
        </div>
    `;

    // 내부 탭 전환 함수 (전역 window 객체에 임시 등록하여 기존 로직 재활용)
    window.switchAlertAdminTabInternal = function (subTabId) {
        document.querySelectorAll('.alert-admin-tab').forEach(btn => {
            if (btn.dataset.tab === subTabId) btn.classList.add('active');
            else btn.classList.remove('active');
        });

        const innerContainer = document.getElementById('alert-admin-inner-content');
        if (innerContainer) window.renderAlertAdminContent(subTabId, innerContainer);
    };

    // 초기 서브탭: 발표
    switchAlertAdminTabInternal('publish');
}

// ============================================================================
// [특보 수집 테스트] 팝업 모달
// ============================================================================

window.openAlertTestModal = function () {
    const existing = document.getElementById('alert-test-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'alert-test-modal-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    overlay.innerHTML = `
        <div style="background:#1e293b;border-radius:16px;width:95%;max-width:900px;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;border:1px solid rgba(255,255,255,0.1);">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0;">
                <h3 style="margin:0;color:#fff;font-size:1.1rem;"><i class="fa-solid fa-flask" style="color:#8b5cf6;"></i> 특보 수집 테스트</h3>
                <button onclick="this.closest('#alert-test-modal-overlay').remove()" style="background:none;border:none;color:#94a3b8;font-size:1.3rem;cursor:pointer;">&times;</button>
            </div>
            <div style="display:flex;gap:0;border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0;">
                <button id="atm-tab-status" onclick="switchAlertTestTab('status')" class="atm-tab" style="flex:1;padding:12px;background:rgba(99,102,241,0.2);color:#a5b4fc;border:none;cursor:pointer;font-weight:600;font-size:0.9rem;border-bottom:2px solid #6366f1;">
                    <i class="fa-solid fa-database"></i> 수집 현황
                </button>
                <button id="atm-tab-collect" onclick="switchAlertTestTab('collect')" class="atm-tab" style="flex:1;padding:12px;background:transparent;color:#94a3b8;border:none;cursor:pointer;font-weight:600;font-size:0.9rem;border-bottom:2px solid transparent;">
                    <i class="fa-solid fa-download"></i> 통보문 수집
                </button>
            </div>
            <div id="atm-content" style="flex:1;overflow-y:auto;padding:20px;"></div>
        </div>
    `;
    document.body.appendChild(overlay);
    switchAlertTestTab('status');
};

window.switchAlertTestTab = function (tabId) {
    ['status', 'collect'].forEach(id => {
        const btn = document.getElementById('atm-tab-' + id);
        if (!btn) return;
        if (id === tabId) { btn.style.background = 'rgba(99,102,241,0.2)'; btn.style.color = '#a5b4fc'; btn.style.borderBottom = '2px solid #6366f1'; }
        else { btn.style.background = 'transparent'; btn.style.color = '#94a3b8'; btn.style.borderBottom = '2px solid transparent'; }
    });
    const content = document.getElementById('atm-content');
    if (tabId === 'status') renderATMStatus(content);
    else renderATMCollect(content);
};

// --- [수집 현황] 탭 ---
async function renderATMStatus(container) {
    container.innerHTML = '<div style="text-align:center;padding:30px;color:#94a3b8;">로딩 중...</div>';
    try {
        const [alertsRes, crawlRes] = await Promise.all([
            fetch('/api/weather-alerts').then(r => r.json()),
            fetch('/api/admin/crawl-status').then(r => r.json())
        ]);
        const isPaused = crawlRes.paused;
        container.innerHTML = `
            <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
                <button onclick="atmReset()" style="padding:8px 16px;background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:0.85rem;font-weight:600;">
                    <i class="fa-solid fa-trash-can"></i> 초기화
                </button>
                <button id="atm-crawl-toggle" onclick="atmCrawlToggle()" style="padding:8px 16px;background:linear-gradient(135deg,${isPaused ? '#22c55e,#16a34a' : '#f59e0b,#d97706'});color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:0.85rem;font-weight:600;">
                    <i class="fa-solid ${isPaused ? 'fa-play' : 'fa-pause'}"></i> ${isPaused ? '크롤링 시작' : '크롤링 정지'}
                </button>
                <button onclick="renderATMStatus(document.getElementById('atm-content'))" style="padding:8px 16px;background:rgba(255,255,255,0.1);color:#94a3b8;border:none;border-radius:8px;cursor:pointer;font-size:0.85rem;">
                    <i class="fa-solid fa-refresh"></i> 새로고침
                </button>
            </div>
            <div style="background:rgba(0,0,0,0.3);border-radius:10px;padding:16px;overflow:auto;max-height:55vh;">
                <pre style="margin:0;color:#e2e8f0;font-size:0.75rem;white-space:pre-wrap;word-break:break-all;font-family:'Courier New',monospace;">${JSON.stringify(alertsRes, null, 2)}</pre>
            </div>`;
    } catch (e) { container.innerHTML = '<div style="color:#ef4444;padding:20px;">오류: ' + e.message + '</div>'; }
}

window.atmReset = async function () {
    if (!confirm('특보 장부를 초기화하시겠습니까?\\n모든 수집 데이터가 삭제됩니다.')) return;
    try {
        const res = await fetch('/api/admin/alerts-reset', { method: 'POST' });
        const data = await res.json();
        alert(data.message || '초기화 완료');
        renderATMStatus(document.getElementById('atm-content'));
    } catch (e) { alert('초기화 실패: ' + e.message); }
};

window.atmCrawlToggle = async function () {
    try {
        await fetch('/api/admin/crawl-toggle', { method: 'POST' });
        renderATMStatus(document.getElementById('atm-content'));
    } catch (e) { alert('상태 변경 실패: ' + e.message); }
};

// --- [통보문 수집] 탭 ---
function renderATMCollect(container) {
    const today = new Date().toISOString().substring(0, 10);
    container.innerHTML = `
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:16px;flex-wrap:wrap;">
            <input type="date" id="atm-date-input" value="${today}" style="padding:8px 12px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.2);border-radius:8px;color:#fff;font-size:0.9rem;" />
            <button onclick="atmFetchReports()" style="padding:8px 16px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:0.85rem;font-weight:600;">
                <i class="fa-solid fa-search"></i> 조회
            </button>
            <button id="atm-collect-all-btn" onclick="atmCollectAll()" style="display:none;padding:8px 16px;background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:0.85rem;font-weight:600;">
                <i class="fa-solid fa-download"></i> 모두 수집
            </button>
        </div>
        <div id="atm-progress" style="display:none;margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                <span id="atm-progress-text" style="color:#a5b4fc;font-size:0.85rem;">0/0건 처리 중...</span>
                <span id="atm-progress-pct" style="color:#94a3b8;font-size:0.85rem;">0%</span>
            </div>
            <div style="background:rgba(0,0,0,0.3);border-radius:4px;height:6px;overflow:hidden;">
                <div id="atm-progress-bar" style="background:linear-gradient(90deg,#6366f1,#8b5cf6);height:100%;width:0%;transition:width 0.3s;border-radius:4px;"></div>
            </div>
        </div>
        <div id="atm-report-list" style="color:#94a3b8;font-size:0.9rem;">날짜를 선택하고 [조회] 버튼을 눌러주세요.</div>`;
}

window._atmResults = {};
window._atmReports = [];

window.atmFetchReports = async function () {
    const date = document.getElementById('atm-date-input').value;
    if (!date) return alert('날짜를 선택해주세요.');
    const listEl = document.getElementById('atm-report-list');
    listEl.innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8;">통보문 목록을 불러오는 중...</div>';
    try {
        const res = await fetch('/api/admin/reports?date=' + date);
        const data = await res.json();
        if (data.count === 0) {
            listEl.innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8;">해당 날짜에 [특보]/[예비] 통보문이 없습니다.</div>';
            document.getElementById('atm-collect-all-btn').style.display = 'none';
            return;
        }
        document.getElementById('atm-collect-all-btn').style.display = 'inline-block';
        window._atmReports = data.reports;
        window._atmResults = {};
        listEl.innerHTML = data.reports.map((r, i) => `
            <div id="atm-row-${i}" style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(0,0,0,0.2);border-radius:8px;margin-bottom:6px;flex-wrap:wrap;">
                <span style="flex:1;color:#e2e8f0;font-size:0.85rem;min-width:200px;">${r.title}</span>
                <span style="color:#64748b;font-size:0.7rem;word-break:break-all;">${r.id}</span>
                <div style="display:flex;gap:6px;flex-shrink:0;">
                    <button id="atm-cb-${i}" onclick="atmCollectOne(${i})" style="padding:5px 12px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:600;">수집</button>
                    <button id="atm-rb-${i}" onclick="atmShowResult(${i})" style="display:none;padding:5px 12px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:600;">결과</button>
                </div>
            </div>`).join('');
    } catch (e) { listEl.innerHTML = '<div style="color:#ef4444;padding:20px;">오류: ' + e.message + '</div>'; }
};

window.atmCollectOne = async function (i) {
    const report = window._atmReports[i];
    const btn = document.getElementById('atm-cb-' + i);
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 수집 중'; btn.style.background = 'rgba(255,255,255,0.1)';
    try {
        const res = await fetch('/api/admin/report-collect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportId: report.id, title: report.title }) });
        const data = await res.json();
        window._atmResults[i] = data;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> 완료'; btn.style.background = 'rgba(34,197,94,0.3)'; btn.style.color = '#86efac';
        document.getElementById('atm-rb-' + i).style.display = 'inline-block';
    } catch (e) { btn.innerHTML = '<i class="fa-solid fa-xmark"></i> 실패'; btn.style.background = 'rgba(239,68,68,0.3)'; btn.style.color = '#fca5a5'; }
};

window.atmCollectAll = async function () {
    const reports = window._atmReports;
    if (!reports || reports.length === 0) return;
    if (!confirm(reports.length + '건의 통보문을 모두 수집하시겠습니까?')) return;
    const progressEl = document.getElementById('atm-progress');
    const pText = document.getElementById('atm-progress-text');
    const pPct = document.getElementById('atm-progress-pct');
    const pBar = document.getElementById('atm-progress-bar');
    progressEl.style.display = 'block';
    for (let i = 0; i < reports.length; i++) {
        const pct = Math.round((i / reports.length) * 100);
        pText.textContent = (i + 1) + '/' + reports.length + '건 처리 중...';
        pPct.textContent = pct + '%'; pBar.style.width = pct + '%';
        await atmCollectOne(i);
    }
    pText.textContent = reports.length + '/' + reports.length + '건 완료!';
    pPct.textContent = '100%'; pBar.style.width = '100%';
};

// --- [결과 팝업] ---
window.atmShowResult = function (i) {
    const data = window._atmResults[i];
    if (!data) return alert('수집 결과가 없습니다.');
    const old = document.getElementById('atm-result-popup');
    if (old) old.remove();

    const popup = document.createElement('div');
    popup.id = 'atm-result-popup';
    popup.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.75);z-index:10001;display:flex;align-items:center;justify-content:center;';
    popup.onclick = (e) => { if (e.target === popup) popup.remove(); };

    const appliedBadge = data.applied
        ? '<span style="background:rgba(34,197,94,0.2);color:#86efac;padding:2px 8px;border-radius:4px;font-size:0.75rem;">장부 반영됨</span>'
        : '<span style="background:rgba(245,158,11,0.2);color:#fcd34d;padding:2px 8px;border-radius:4px;font-size:0.75rem;">미반영</span>';
    const kwBadges = (data.foundKeywords || []).map(kw => '<span style="background:rgba(99,102,241,0.2);color:#a5b4fc;padding:2px 6px;border-radius:4px;font-size:0.7rem;">' + kw + '</span>').join(' ');

    popup.innerHTML = `
        <div style="background:#1e293b;border-radius:14px;width:90%;max-width:750px;max-height:85vh;overflow:hidden;display:flex;flex-direction:column;border:1px solid rgba(255,255,255,0.1);">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.1);">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <h4 style="margin:0;color:#fff;font-size:0.95rem;">수집 결과</h4>${appliedBadge} ${kwBadges}
                </div>
                <button onclick="document.getElementById('atm-result-popup').remove()" style="background:none;border:none;color:#94a3b8;font-size:1.3rem;cursor:pointer;">&times;</button>
            </div>
            <div style="font-size:0.8rem;color:#94a3b8;padding:8px 18px 0;">${data.title || data.reportId || ''}</div>
            <div style="display:flex;gap:0;border-bottom:1px solid rgba(255,255,255,0.1);">
                <button id="atr-tab-json" onclick="atmSwitchResultTab('json')" style="flex:1;padding:10px;background:rgba(99,102,241,0.2);color:#a5b4fc;border:none;cursor:pointer;font-weight:600;font-size:0.85rem;border-bottom:2px solid #6366f1;">JSON</button>
                <button id="atr-tab-ai" onclick="atmSwitchResultTab('ai')" style="flex:1;padding:10px;background:transparent;color:#94a3b8;border:none;cursor:pointer;font-weight:600;font-size:0.85rem;border-bottom:2px solid transparent;">AI 분석</button>
            </div>
            <div id="atr-content" style="flex:1;overflow-y:auto;padding:16px;"></div>
        </div>`;
    document.body.appendChild(popup);
    window._atmCurResult = data;
    atmSwitchResultTab('json');
};

window.atmSwitchResultTab = function (tabId) {
    ['json', 'ai'].forEach(id => {
        const btn = document.getElementById('atr-tab-' + id);
        if (!btn) return;
        if (id === tabId) { btn.style.background = 'rgba(99,102,241,0.2)'; btn.style.color = '#a5b4fc'; btn.style.borderBottom = '2px solid #6366f1'; }
        else { btn.style.background = 'transparent'; btn.style.color = '#94a3b8'; btn.style.borderBottom = '2px solid transparent'; }
    });
    const ct = document.getElementById('atr-content');
    const d = window._atmCurResult;
    if (tabId === 'json') {
        const j = { reportId: d.reportId, title: d.title, applied: d.applied, foundKeywords: d.foundKeywords, aiResult: d.aiResult, message: d.message || '' };
        ct.innerHTML = '<div style="background:rgba(0,0,0,0.3);border-radius:10px;padding:14px;overflow:auto;"><pre style="margin:0;color:#e2e8f0;font-size:0.75rem;white-space:pre-wrap;word-break:break-all;font-family:Courier New,monospace;">' + JSON.stringify(j, null, 2) + '</pre></div>';
    } else {
        const aiArr = d.aiResult || [];
        const aiHtml = aiArr.length > 0 ? aiArr.map((ev, idx) => {
            const borderColor = ev.command === '해제' ? '#22c55e' : ev.command === '예비' ? '#f59e0b' : '#ef4444';
            const tmFcDisplay = d.reportId ? (function(rid) { var p=rid.split(':'); if(p.length>=2){var t=p[1]; if(t.length>=12) return t.substring(0,4)+'년 '+t.substring(4,6)+'월 '+t.substring(6,8)+'일 '+t.substring(8,10)+'시 '+t.substring(10,12)+'분';} return ''; })(d.reportId) : '';
            const tmEfDisplay = ev.tmEf || ev.time || '';
            const tmCcDisplay = ev.tmCc || ev.tmYn || '';
            return '<div style="background:rgba(0,0,0,0.2);border-radius:8px;padding:12px;margin-bottom:8px;border-left:3px solid ' + borderColor + ';">'
                + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">'
                + '<span style="font-weight:700;color:#fff;font-size:0.85rem;">#' + (idx+1) + ' ' + ev.type + '</span>'
                + '<span style="background:rgba(255,255,255,0.1);color:#e2e8f0;padding:2px 8px;border-radius:4px;font-size:0.75rem;">' + ev.command + '</span></div>'
                + '<div style="font-size:0.8rem;margin-bottom:4px;display:flex;gap:4px;"><span style="color:#8b949e;min-width:56px;">발표시각</span><span style="color:#94a3b8;">' + (tmFcDisplay || '정보 없음') + '</span></div>'
                + '<div style="font-size:0.8rem;margin-bottom:4px;display:flex;gap:4px;"><span style="color:#8b949e;min-width:56px;">발효시각</span><span style="color:#e2e8f0;font-weight:500;">' + (tmEfDisplay || '정보 없음') + '</span></div>'
                + '<div style="font-size:0.8rem;margin-bottom:6px;display:flex;gap:4px;"><span style="color:#8b949e;min-width:56px;">해제시각</span><span style="color:#69f0ae;">' + (tmCcDisplay || '정보 없음') + '</span></div>'
                + '<div style="color:#94a3b8;font-size:0.8rem;">구역: ' + (ev.zones||[]).join(', ') + '</div>'
                + '</div>';
        }).join('') : '<div style="color:#94a3b8;padding:10px;">AI 분석 결과가 없습니다.</div>';
        ct.innerHTML = '<div style="margin-bottom:16px;"><div style="color:#a5b4fc;font-weight:600;font-size:0.85rem;margin-bottom:8px;"><i class="fa-solid fa-robot"></i> AI 분석 결과 (' + aiArr.length + '건)</div>' + aiHtml + '</div>'
            + '<div><div style="color:#a5b4fc;font-weight:600;font-size:0.85rem;margin-bottom:8px;"><i class="fa-solid fa-file-lines"></i> 원문 텍스트</div>'
            + '<div style="background:rgba(0,0,0,0.3);border-radius:10px;padding:14px;overflow:auto;max-height:35vh;"><pre style="margin:0;color:#cbd5e1;font-size:0.75rem;white-space:pre-wrap;word-break:break-all;font-family:Courier New,monospace;">' + (d.rawText||'(내용 없음)') + '</pre></div></div>';
    }
};

// (B) API 설정 섹션 렌더링
// (B) API 설정 섹션 렌더링
async function renderUnifiedApiContent(container) {
    if (!adminAuthenticated.api) return;

    container.innerHTML = `
        <div class="admin-section-title">
            <i class="fa-solid fa-server" style="color:#38bdf8;"></i> API 수집 및 동기화 상태
        </div>
        
        <!-- API 상태 리스트 -->
        <div id="unified-api-status-list" style="margin-bottom:25px;">
            <!-- refreshUnifiedApiStatus에 의해 채워짐 -->
        </div>

        <!-- [New] TideBed API 관리 섹션 -->
        <div class="admin-section-title" style="margin-top:30px; border-top:1px solid rgba(255,255,255,0.05); padding-top:20px;">
            <i class="fa-solid fa-water" style="color:#60a5fa;"></i> 공공데이터포털 TideBed API 관리 현황
        </div>

        <div class="admin-card" style="padding:20px; background:rgba(15, 23, 42, 0.4); margin-bottom:15px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <div id="tidebed-usage-status" style="font-weight:700; color:#fff; font-size:1rem;">
                    API 호출 현황 : <span style="color:#38bdf8;">-회</span> / <span style="color:#94a3b8;">-회</span>
                </div>
                <button class="admin-action-btn admin-btn-primary" onclick="addTideBedKey()">
                    <i class="fa-solid fa-plus"></i> KEY 추가
                </button>
            </div>
            
            <details class="admin-accordion" style="background:rgba(0,0,0,0.2); border-radius:8px; border:1px solid rgba(255,255,255,0.05);">
                <summary style="padding:12px; cursor:pointer; color:#94a3b8; font-size:0.85rem; font-weight:600; list-style:none; display:flex; align-items:center; gap:8px;">
                    <i class="fa-solid fa-chevron-down" style="font-size:0.7rem;"></i> (API 키 등록 현황)
                </summary>
                <div id="tidebed-key-list" style="padding:10px; border-top:1px solid rgba(255,255,255,0.05);">
                    <!-- refreshUnifiedTideBedStatus에 의해 채워짐 -->
                </div>
            </details>
        </div>

        <!-- 인증키 설정 섹션 (하단 통합) -->
        <div class="admin-section-title" style="margin-top:30px; border-top:1px solid rgba(255,255,255,0.05); padding-top:20px;">
            <i class="fa-solid fa-key" style="color:#f59e0b;"></i> 기상청 API HUB (Auth Key)
        </div>
        
        <div class="admin-card" style="padding:20px; background:rgba(15, 23, 42, 0.4);">
            <div style="font-weight:600; color:#fff; margin-bottom:12px; font-size:0.85rem; display:flex; align-items:center; gap:8px;">
                <i class="fa-solid fa-bolt" style="color:#ff5722;"></i> 기상청 API HUB (Auth Key)
                <span style="font-size:0.7rem; color:#64748b; font-weight:400;">- 기상예보, 특보-HUB, 해구예보, 부이 공통</span>
            </div>
            <div style="display:flex; gap:10px; margin-bottom:15px;">
                <input type="password" id="unified-kma-hub-key" 
                    style="flex:1; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff; padding:12px; font-size:0.9rem; font-family:monospace;" 
                    placeholder="인증키를 입력하세요">
                <button onclick="toggleUnifiedKeyVisibility('unified-kma-hub-key')" 
                    style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#94a3b8; width:45px; cursor:pointer;" title="보기/숨기기">
                    <i class="fa-solid fa-eye"></i>
                </button>
            </div>
            <button class="admin-action-btn admin-btn-primary" style="width:100%; height:45px; font-size:0.9rem;" onclick="saveUnifiedApiConfig()">
                <i class="fa-solid fa-save"></i> 인증키 설정 저장하기
            </button>
            <div style="margin-top:10px; font-size:0.7rem; color:#64748b; text-align:center;">
                <i class="fa-solid fa-circle-info"></i> 인증키를 변경하면 다음 데이터 수집 시점부터 적용됩니다.
            </div>
        </div>

        <div style="text-align:center; margin-top:20px;">
            <button class="admin-action-btn" style="background:none; border:1px solid rgba(255,255,255,0.1); color:#64748b;" onclick="refreshUnifiedApiStatus()">
                <i class="fa-solid fa-rotate"></i> 상태 데이터 새로고침
            </button>
        </div>
    `;

    // 인증키 보기 토글
    window.toggleUnifiedKeyVisibility = function (id) {
        const input = document.getElementById(id);
        const btn = event.currentTarget;
        const icon = btn.querySelector('i');
        if (input.type === 'password') {
            input.type = 'text';
            icon.classList.replace('fa-eye', 'fa-eye-slash');
        } else {
            input.type = 'password';
            icon.classList.replace('fa-eye-slash', 'fa-eye');
        }
    };

    // [New] TideBed API 키 추가 (커스텀 모달 사용)
    window.addTideBedKey = function () {
        const modal = document.createElement('div');
        modal.id = 'tidebed-add-key-modal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:20000;background:rgba(0,0,0,0.8);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:20px;';

        modal.innerHTML = `
            <div style="background:#1e2435; border-radius:16px; width:100%; max-width:400px; padding:25px; border:1px solid rgba(255,255,255,0.1); box-shadow:0 25px 50px rgba(0,0,0,0.5);">
                <h3 style="color:#fff; margin:0 0 20px; display:flex; align-items:center; gap:10px;">
                    <i class="fa-solid fa-key" style="color:#38bdf8;"></i> TideBED API 키 추가
                </h3>
                
                <div style="margin-bottom:15px;">
                    <label style="display:block; color:#94a3b8; font-size:0.8rem; margin-bottom:6px;">새 인증키 (Service Key)</label>
                    <input type="text" id="new-tidebed-key" placeholder="API Key를 입력하세요" 
                           style="width:100%; padding:12px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff; font-size:0.9rem; font-family:monospace; box-sizing:border-box;">
                </div>

                <div style="margin-bottom:15px;">
                    <label style="display:block; color:#94a3b8; font-size:0.8rem; margin-bottom:6px;">만료 일자</label>
                    <input type="text" id="new-tidebed-expiry" placeholder="예: 2028-02-11" 
                           style="width:100%; padding:12px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff; font-size:0.9rem; box-sizing:border-box;">
                </div>

                <div style="margin-bottom:25px;">
                    <label style="display:block; color:#94a3b8; font-size:0.8rem; margin-bottom:6px;">닉네임 (소유자)</label>
                    <input type="text" id="new-tidebed-owner" placeholder="예: JIN" 
                           style="width:100%; padding:12px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff; font-size:0.9rem; box-sizing:border-box;">
                </div>

                <div style="display:flex; gap:12px;">
                    <button onclick="document.getElementById('tidebed-add-key-modal').remove()" 
                            style="flex:1; padding:12px; background:rgba(255,255,255,0.05); border:none; border-radius:8px; color:#94a3b8; cursor:pointer; font-weight:600;">취소</button>
                    <button id="tidebed-key-save-btn" style="flex:1; padding:12px; background:linear-gradient(135deg,#38bdf8,#2563eb); border:none; border-radius:8px; color:#fff; cursor:pointer; font-weight:700;">저장하기</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('tidebed-key-save-btn').onclick = async () => {
            const key = document.getElementById('new-tidebed-key').value.trim();
            const expiry = document.getElementById('new-tidebed-expiry').value.trim();
            const owner = document.getElementById('new-tidebed-owner').value.trim();

            if (!key) return alert('인증키를 입력해주세요.');

            try {
                const res = await fetch(CONFIG.API_BASE + '/api/tidebed/key', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key, expiry, owner })
                });
                if (res.ok) {
                    alert('인증키가 성공적으로 추가되었습니다.');
                    modal.remove();
                    refreshUnifiedTideBedStatus();
                } else {
                    const data = await res.json();
                    alert(data.error || '추가 실패');
                }
            } catch (e) { alert('에러: ' + e.message); }
        };
    };

    // [New] TideBed API 키 삭제
    window.deleteTideBedKey = async function (index) {
        if (!confirm('정말 이 인증키를 삭제하시겠습니까?')) return;
        try {
            const res = await fetch(CONFIG.API_BASE + `/api/tidebed/key/${index}`, { method: 'DELETE' });
            if (res.ok) {
                alert('삭제되었습니다.');
                refreshUnifiedTideBedStatus();
            } else {
                const data = await res.json();
                alert(data.error || '삭제 실패');
            }
        } catch (e) { alert('에러: ' + e.message); }
    };

    // [New] TideBed API 상태 새로고침
    window.refreshUnifiedTideBedStatus = async function () {
        const usageEl = document.getElementById('tidebed-usage-status');
        const listEl = document.getElementById('tidebed-key-list');
        if (!usageEl || !listEl) return;

        try {
            const res = await fetch(CONFIG.API_BASE + '/api/tidebed/config');
            const data = await res.json();

            // 상단 요약
            usageEl.innerHTML = `API 호출 현황 : <span style="color:#38bdf8;">${data.totalUsed.toLocaleString()}회</span> / <span style="color:#94a3b8;">${data.totalLimit.toLocaleString()}회</span>`;

            // 목록 렌더링
            listEl.innerHTML = `
                <div class="admin-accordion-content">
                    ${data.keys.map((k, i) => `
                        <div class="tidebed-key-item">
                            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                                <div style="flex:1;">
                                    <div style="font-size:0.75rem; font-weight:700; color:#fff; margin-bottom:6px; display:flex; align-items:center; gap:8px;">
                                        <i class="fa-solid fa-key" style="color:${data.currentIndex === i ? '#10b981' : '#64748b'}; font-size:0.6rem;"></i>
                                        ${i + 1}번 KEY ${data.currentIndex === i ? '<span style="padding:2px 6px; background:rgba(16,185,129,0.1); color:#10b981; border-radius:4px; font-size:0.65rem;">사용 중</span>' : ''}
                                    </div>
                                    <div style="display:flex; align-items:center; gap:8px; background:rgba(0,0,0,0.2); padding:8px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.05);">
                                        <input type="password" value="${k.fullKey}" id="tidebed-key-${i}" readonly
                                            style="flex:1; background:transparent; border:none; color:#38bdf8; font-size:0.85rem; font-family:monospace; outline:none; padding:0;">
                                        <button onclick="toggleTideBedKeyItemVisibility(${i})" style="background:none; border:none; color:#94a3b8; cursor:pointer;" title="보기/숨기기">
                                            <i class="fa-solid fa-eye"></i>
                                        </button>
                                    </div>
                                    <div style="margin-top:8px; display:flex; flex-direction:column; gap:4px;">
                                        <div style="display:flex; justify-content:space-between; align-items:center;">
                                            <span style="font-size:0.7rem; color:#64748b;">일일 호출: <b style="color:#cbd5e1;">${k.used.toLocaleString()}</b> / 10,000</span>
                                            <button onclick="deleteTideBedKey(${i})" style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.2); color:#ef4444; border-radius:6px; padding:4px 8px; font-size:0.7rem; cursor:pointer;">
                                                <i class="fa-solid fa-trash-can" style="margin-right:4px;"></i> 삭제
                                            </button>
                                        </div>
                                        <div style="font-size:0.7rem; color:#64748b; padding:6px 0; border-top:1px solid rgba(255,255,255,0.03); display:flex; gap:10px;">
                                            <span>📅 만료: <b style="color:#94a3b8;">${k.expiry}</b></span>
                                            <span>👤 소유: <b style="color:#94a3b8;">${k.owner}</b></span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` || '<div style="color:#64748b; font-size:0.8rem; text-align:center; padding:10px;">등록된 키가 없습니다.</div>';

        } catch (e) {
            console.error('TideBed 상태 로드 실패:', e);
        }
    };

    window.toggleTideBedKeyItemVisibility = function (i) {
        const input = document.getElementById(`tidebed-key-${i}`);
        const icon = event.currentTarget.querySelector('i');
        if (input.type === 'password') {
            input.type = 'text';
            icon.classList.replace('fa-eye', 'fa-eye-slash');
        } else {
            input.type = 'password';
            icon.classList.replace('fa-eye-slash', 'fa-eye');
        }
    };

    // 인증키 저장
    window.saveUnifiedApiConfig = async function () {
        const hubKey = document.getElementById('unified-kma-hub-key').value;
        if (!hubKey) return alert('KMA HUB 인증키를 입력해주세요.');

        try {
            const res = await fetch(CONFIG.API_BASE + '/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ KMA_HUB_KEY: hubKey })
            });
            if (res.ok) {
                alert('설정이 저장되었습니다.');
                refreshUnifiedApiStatus();
            } else { alert('저장 실패'); }
        } catch (e) { alert('에러: ' + e.message); }
    };

    window.refreshUnifiedApiStatus = async function () {
        const listContainer = document.getElementById('unified-api-status-list');
        const hubInput = document.getElementById('unified-kma-hub-key');
        if (!listContainer) return;

        try {
            // 1. 현재 설정된 인증키 먼저 로드
            const configRes = await fetch(CONFIG.API_BASE + '/api/config');
            const config = await configRes.json();
            if (hubInput && config.KMA_HUB_KEY) hubInput.value = config.KMA_HUB_KEY;

            // 2. 상태 리스트 로드
            const res = await fetch(CONFIG.API_BASE + '/api/status');
            const status = await res.json();
            const apiItems = [
                { key: 'general', name: '기상 예보', icon: 'fa-sun', color: '#ffd54f' },
                { key: 'warnings_hub', name: '특보 - HUB (KMA)', icon: 'fa-bolt', color: '#ff5722' },
                { key: 'zone', name: '해구별 예보', icon: 'fa-map-location-dot', color: '#29b6f6' },
                { key: 'buoys', name: '관측 부이', icon: 'fa-anchor', color: '#26a69a' }
            ];

            listContainer.innerHTML = apiItems.map(api => {
                const s = status[api.key] || { lastRun: '-', status: '정보 없음', message: '' };
                const isSuccess = s.status === '성공';
                const statusColor = isSuccess ? '#10b981' : (s.status === '실패' ? '#ef4444' : '#64748b');

                return `
                    <div class="admin-card" style="display:flex; justify-content:space-between; align-items:center; padding:12px 15px;">
                        <div style="display:flex; align-items:center; gap:12px;">
                            <div style="width:36px; height:36px; background:rgba(255,255,255,0.05); border-radius:10px; display:flex; align-items:center; justify-content:center;">
                                <i class="fa-solid ${api.icon}" style="color:${api.color}; font-size:1rem;"></i>
                            </div>
                            <div>
                                <div style="font-weight:700; color:#fff; font-size:0.9rem;">${api.name}</div>
                                <div style="font-size:0.7rem; color:#64748b;">최종 실행: ${s.lastRun}</div>
                            </div>
                        </div>
                        <div style="display:flex; align-items:center; gap:10px;">
                            <span style="padding:3px 10px; border-radius:30px; font-size:0.65rem; font-weight:800; background:${statusColor}22; color:${statusColor}; border:1px solid ${statusColor}44;">
                                ${s.status}
                            </span>
                            <button class="admin-action-btn" style="padding:6px 10px; font-size:0.7rem;" onclick="forceUpdateApiUnified('${api.key}')">
                                <i class="fa-solid fa-play"></i> 수동 호출
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        } catch (e) {
            listContainer.innerHTML = '<div style="color:#ef4444;text-align:center;padding:20px;">API 상태를 불러오지 못했습니다.</div>';
        }
    };

    window.forceUpdateApiUnified = async function (type) {
        if (!confirm(`${type} API 수집을 강제로 실행하시겠습니까?`)) return;
        try {
            await fetch(CONFIG.API_BASE + '/api/force-update/' + type, { method: 'POST' });
            alert('요청되었습니다.');
            refreshUnifiedApiStatus();
        } catch (e) { alert('오류 발생'); }
    };

    refreshUnifiedApiStatus();
    refreshUnifiedTideBedStatus();
}

// (C) 공지 팝업 섹션 렌더링
async function renderUnifiedNoticeContent(container) {
    if (!adminAuthenticated.notice) return;

    container.innerHTML = `
        <div class="admin-section-title">
            <i class="fa-solid fa-bell" style="color:#fbbf24;"></i> 서비스 상단 공지 팝업 관리
        </div>
        
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px; margin-bottom:20px;">
            <div class="admin-card">
                <div style="font-weight:700; color:#fff; margin-bottom:12px; font-size:0.9rem;">진행 중인 공지</div>
                <div id="unified-active-notices" style="max-height:200px; overflow-y:auto;"></div>
            </div>
            <div class="admin-card">
                <div style="font-weight:700; color:#fff; margin-bottom:12px; font-size:0.9rem;">최근 종료된 공지</div>
                <div id="unified-expired-notices" style="max-height:200px; overflow-y:auto;"></div>
            </div>
        </div>
        
        <div class="admin-card" id="notice-form-container">
            <div style="font-weight:700; color:#fff; margin-bottom:15px; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:10px;">
                <i class="fa-solid fa-plus-circle"></i> 공지사항 작성 및 수정
            </div>
            <input type="hidden" id="uni-notice-id" value="">
            <div style="margin-bottom:12px;">
                <input type="text" id="uni-notice-title" placeholder="공지 제목" style="width:100%; padding:10px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff; outline:none;">
            </div>
            <div style="margin-bottom:12px;">
                <textarea id="uni-notice-content" placeholder="공지 상세 내용" style="width:100%; height:80px; padding:10px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff; outline:none; resize:none;"></textarea>
            </div>
            <div style="display:flex; gap:10px; margin-bottom:15px;">
                <input type="date" id="uni-notice-date" style="flex:1; padding:8px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff;">
                <select id="uni-notice-hour" style="width:70px; padding:8px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff;"></select>
                <select id="uni-notice-min" style="width:70px; padding:8px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff;"></select>
            </div>
            <button class="admin-action-btn admin-btn-primary" style="width:100%;" onclick="saveNoticeUnified()">
                <i class="fa-solid fa-save"></i> 공지사항 저장
            </button>
        </div>
    `;

    // 시간 옵션 채우기
    const hSelect = document.getElementById('uni-notice-hour');
    const mSelect = document.getElementById('uni-notice-min');
    for (let i = 0; i < 24; i++) hSelect.innerHTML += `<option value="${i}">${String(i).padStart(2, '0')}시</option>`;
    for (let i = 0; i < 60; i += 10) mSelect.innerHTML += `<option value="${i}">${String(i).padStart(2, '0')}분</option>`;

    window.refreshUnifiedNoticeList = async function () {
        try {
            const res = await fetch(CONFIG.API_BASE + '/api/notices');
            const data = await res.json();

            const activeEl = document.getElementById('unified-active-notices');
            const expiredEl = document.getElementById('unified-expired-notices');

            activeEl.innerHTML = (data.active || []).map(n => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:8px; border-bottom:1px solid rgba(255,255,255,0.03);">
                    <div style="font-size:0.85rem; color:#e2e8f0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">${n.title}</div>
                    <div style="display:flex; gap:5px;">
                        <button onclick="editNoticeUnified(${n.id})" style="background:none; border:none; color:#38bdf8; cursor:pointer; font-size:0.8rem;">수정</button>
                        <button onclick="deleteNoticeUnified(${n.id})" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:0.8rem;">삭제</button>
                    </div>
                </div>
            `).join('') || '<div style="color:#64748b; font-size:0.8rem; padding:10px;">활성 공지 없음</div>';

            expiredEl.innerHTML = (data.expired || []).map(n => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:8px; border-bottom:1px solid rgba(255,255,255,0.03);">
                    <div style="font-size:0.85rem; color:#94a3b8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">${n.title}</div>
                    <button onclick="editNoticeUnified(${n.id})" style="background:none; border:none; color:#38bdf8; cursor:pointer; font-size:0.8rem;">복사</button>
                </div>
            `).join('') || '<div style="color:#64748b; font-size:0.8rem; padding:10px;">종료 이력 없음</div>';
        } catch (e) { }
    };

    window.saveNoticeUnified = async function () {
        const payload = {
            id: document.getElementById('uni-notice-id').value || Date.now(),
            title: document.getElementById('uni-notice-title').value,
            content: document.getElementById('uni-notice-content').value,
            expiresAt: `${document.getElementById('uni-notice-date').value} ${document.getElementById('uni-notice-hour').value.padStart(2, '0')}:${document.getElementById('uni-notice-min').value.padStart(2, '0')}`,
            isActive: true
        };
        if (!payload.title || !payload.content) return alert('내용을 입력하세요.');
        const res = await fetch(CONFIG.API_BASE + '/api/notices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (res.ok) { alert('저장되었습니다.'); refreshUnifiedNoticeList(); }
    };

    refreshUnifiedNoticeList();
}

// 통합 모달 전용 공지사항 수정
window.editNoticeUnified = async function (id) {
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/notices');
        const data = await res.json();
        const allNotices = [...(data.active || []), ...(data.expired || [])];
        const target = allNotices.find(n => n.id === id);

        if (target) {
            document.getElementById('uni-notice-id').value = target.id;
            document.getElementById('uni-notice-title').value = target.title;
            document.getElementById('uni-notice-content').value = target.content;

            if (target.expiresAt) {
                const parts = target.expiresAt.split(' ');
                document.getElementById('uni-notice-date').value = parts[0];
                if (parts[1]) {
                    const timeParts = parts[1].split(':');
                    document.getElementById('uni-notice-hour').value = parseInt(timeParts[0]);
                    document.getElementById('uni-notice-min').value = parseInt(timeParts[1]);
                }
            }
            document.getElementById('uni-notice-title').focus();
            // 폼으로 스크롤
            document.getElementById('notice-form-container').scrollIntoView({ behavior: 'smooth' });
        }
    } catch (e) { }
};

// 통합 모달 전용 공지사항 삭제
window.deleteNoticeUnified = async function (id) {
    if (!confirm("이 공지를 삭제하시겠습니까?")) return;
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/notice/' + id, { method: 'DELETE' });
        if (res.ok) {
            alert("삭제되었습니다.");
            refreshUnifiedNoticeList();
        } else {
            alert("삭제 실패");
        }
    } catch (e) {
        alert("오류: " + e.message);
    }
};

// (D) 게시글 관리 섹션 렌더링
async function renderUnifiedPromoContent(container) {
    if (!adminAuthenticated.promo) return;

    container.innerHTML = `
        <div class="admin-section-title">
            <i class="fa-solid fa-bullhorn" style="color:#f87171;"></i> 정보광장(게시글) 관리
        </div>
        
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
            <div style="color:#94a3b8; font-size:0.85rem;">최근 등록된 게시글 목록입니다.</div>
            <button class="admin-action-btn admin-btn-primary" onclick="openPromoEditor()">
                <i class="fa-solid fa-plus"></i> 새 게시글 작성
            </button>
        </div>
        
        <div id="unified-promo-list-container">
            <!-- loadUnifiedPromoList 에 의해 채워짐 -->
        </div>
    `;

    window.loadUnifiedPromoList = async function () {
        const listEl = document.getElementById('unified-promo-list-container');
        if (!listEl) return;
        try {
            const res = await fetch(CONFIG.API_BASE + '/api/promo');
            const posts = await res.json();

            listEl.innerHTML = posts.map(post => `
                <div class="admin-card" style="margin-bottom:10px; padding:12px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="flex:1;">
                            <span style="font-size:0.75rem; padding:2px 6px; border-radius:4px; background:rgba(255,255,255,0.1); color:#94a3b8; margin-right:10px;">${post.category || '홍보'}</span>
                            <span style="font-weight:700; color:#fff; font-size:0.95rem;">${post.title}</span>
                            <div style="font-size:0.75rem; color:#64748b; margin-top:4px;">${post.createdAt} | 조회수: ${post.views || 0}</div>
                        </div>
                        <div style="display:flex; gap:10px;">
                            <button class="admin-action-btn" style="padding:5px 10px; font-size:0.75rem;" onclick="editPromoPost(${post.id})">
                                <i class="fa-solid fa-edit"></i> 수정
                            </button>
                            <button class="admin-action-btn admin-btn-danger" style="padding:5px 10px; font-size:0.75rem;" onclick="deletePromoPostUnified(${post.id})">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `).join('') || '<div style="text-align:center; padding:40px; color:#64748b;">등록된 게시글이 없습니다.</div>';
        } catch (e) { }
    };

    window.deletePromoPostUnified = async function (id) {
        if (!confirm('정말 삭제하시겠습니까?')) return;
        await fetch(CONFIG.API_BASE + '/api/promo/' + id, { method: 'DELETE' });
        loadUnifiedPromoList();
    };

    loadUnifiedPromoList();
}

// (E) 방문자 통계 섹션 렌더링
let visitorChart = null;
async function renderUnifiedStatsContent(container) {
    container.innerHTML = `
        <div class="admin-section-title" style="display:flex; justify-content:space-between; align-items:center;">
             <div><i class="fa-solid fa-chart-line" style="color:#a78bfa;"></i> 방문자 통계 분석</div>
             <div style="font-size:0.75rem; color:#64748b;">KST 기준 데이터</div>
        </div>
        
        <div id="stats-loading" style="text-align:center; padding:50px; color:#64748b;">
            <i class="fa-solid fa-circle-notch fa-spin fa-2x"></i>
            <p style="margin-top:10px;">통계 데이터를 분석 중입니다...</p>
        </div>
        
        <div id="stats-dashboard" style="display:none;">
            <!-- 상단 요약 카드 -->
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:12px; margin-bottom:20px;">
                <div class="admin-card" style="padding:15px; text-align:center; border-left:4px solid #3b82f6;">
                    <div style="font-size:0.75rem; color:#94a3b8; margin-bottom:5px;">오늘 방문</div>
                    <div id="stat-today" style="font-size:1.2rem; font-weight:800; color:#fff;">0</div>
                </div>
                <div class="admin-card" style="padding:15px; text-align:center; border-left:4px solid #10b981;">
                    <div style="font-size:0.75rem; color:#94a3b8; margin-bottom:5px;">어제 방문</div>
                    <div id="stat-yesterday" style="font-size:1.2rem; font-weight:800; color:#fff;">0</div>
                </div>
                <div class="admin-card" style="padding:15px; text-align:center; border-left:4px solid #f59e0b;">
                    <div style="font-size:0.75rem; color:#94a3b8; margin-bottom:5px;">최근 7일 합계</div>
                    <div id="stat-week" style="font-size:1.2rem; font-weight:800; color:#fff;">0</div>
                </div>
                <div class="admin-card" style="padding:15px; text-align:center; border-left:4px solid #f87171;">
                    <div style="font-size:0.75rem; color:#94a3b8; margin-bottom:5px;">이번 달 합계</div>
                    <div id="stat-month" style="font-size:1.2rem; font-weight:800; color:#fff;">0</div>
                </div>
            </div>

            <!-- 필터 제어바 -->
            <div style="background:rgba(255,255,255,0.03); padding:12px; border-radius:12px; margin-bottom:20px; display:flex; gap:8px; align-items:center; flex-wrap:wrap; border:1px solid rgba(255,255,255,0.05);">
                <div style="display:flex; background:rgba(0,0,0,0.2); padding:3px; border-radius:8px;">
                    ${['hourly', 'daily', 'monthly'].map(p => `
                        <button onclick="window.updateStatsType('${p}')" id="btn-stats-${p}"
                                style="padding:6px 12px; border:none; border-radius:6px; background:transparent; color:#94a3b8; font-size:0.8rem; font-weight:600; cursor:pointer; transition:0.2s;">
                            ${p === 'hourly' ? '시간별(오늘)' : (p === 'daily' ? '일별' : '월별')}
                        </button>
                    `).join('')}
                </div>
                <div id="stats-date-group" style="display:flex; align-items:center; gap:8px; margin-left:auto;">
                    <input type="date" id="stats-start-date" style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:6px; color:#fff; padding:4px 8px; font-size:0.8rem;">
                    <span style="color:#475569;">~</span>
                    <input type="date" id="stats-end-date" style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:6px; color:#fff; padding:4px 8px; font-size:0.8rem;">
                    <button onclick="window.refreshStatsDash()" style="background:#3b82f6; border:none; color:#fff; padding:5px 10px; border-radius:6px; font-size:0.8rem; font-weight:600; cursor:pointer;">적용</button>
                </div>
            </div>

            <!-- 그래프 영역 -->
            <div class="admin-card" style="padding:20px; margin-bottom:20px; height:320px; position:relative;">
                <canvas id="visitor-main-chart"></canvas>
            </div>

            <!-- 상세 데이터 표 -->
            <div class="admin-card" style="overflow:hidden;">
                <div style="padding:12px 16px; background:rgba(255,255,255,0.02); border-bottom:1px solid rgba(255,255,255,0.05); font-weight:700; font-size:0.85rem; color:#94a3b8;">
                    상세 데이터 내역
                </div>
                <div style="max-height:300px; overflow-y:auto;">
                    <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
                        <thead style="position:sticky; top:0; background:#1e293b; color:#64748b; text-align:left;">
                            <tr>
                                <th style="padding:10px 16px; border-bottom:1px solid rgba(255,255,255,0.05);">날짜/시간</th>
                                <th style="padding:10px 16px; border-bottom:1px solid rgba(255,255,255,0.05); text-align:right;">방문수</th>
                                <th style="padding:10px 16px; border-bottom:1px solid rgba(255,255,255,0.05); text-align:right;">비중</th>
                            </tr>
                        </thead>
                        <tbody id="stats-table-body" style="color:#cbd5e1;"></tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    // 날짜 기본값 설정 (최근 30일)
    const now = new Date();
    const kstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    const kst30DaysAgo = new Date(kstNow.getTime() - (30 * 24 * 60 * 60 * 1000));

    const endStr = kstNow.toISOString().split('T')[0];
    const startStr = kst30DaysAgo.toISOString().split('T')[0];

    document.getElementById('stats-start-date').value = startStr;
    document.getElementById('stats-end-date').value = endStr;

    let statsType = 'daily';
    let rawData = {};

    window.updateStatsType = function (type) {
        statsType = type;
        document.querySelectorAll('[id^="btn-stats-"]').forEach(btn => {
            if (btn.id === `btn-stats-${type}`) {
                btn.style.background = '#3b82f6';
                btn.style.color = '#fff';
            } else {
                btn.style.background = 'transparent';
                btn.style.color = '#94a3b8';
            }
        });

        // 시간별일 때는 날짜 선택기 비활성화 (오늘 고정)
        const dateGroup = document.getElementById('stats-date-group');
        if (type === 'hourly') dateGroup.style.opacity = '0.3', dateGroup.style.pointerEvents = 'none';
        else dateGroup.style.opacity = '1', dateGroup.style.pointerEvents = 'all';

        refreshStatsDash();
    };

    window.refreshStatsDash = function () {
        processStatsAndRender(rawData, statsType);
    };

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/stats/visitors');
        rawData = await res.json();

        document.getElementById('stats-loading').style.display = 'none';
        document.getElementById('stats-dashboard').style.display = 'block';

        // 요약 정보 계산
        updateStatsSummary(rawData);

        // 초기 렌더링 (일별)
        window.updateStatsType('daily');
    } catch (e) {
        container.innerHTML += `<div style="color:#ef4444; text-align:center; padding:20px;">데이터 로드 실패: ${e.message}</div>`;
    }
}

function updateStatsSummary(data) {
    const kstNow = new Date(new Date().getTime() + (9 * 60 * 60 * 1000));
    const todayStr = kstNow.toISOString().split('T')[0];
    const yesterdayStr = new Date(kstNow.getTime() - 86400000).toISOString().split('T')[0];

    // 1. 오늘
    document.getElementById('stat-today').textContent = (data[todayStr]?.total || 0).toLocaleString();
    // 2. 어제
    document.getElementById('stat-yesterday').textContent = (data[yesterdayStr]?.total || 0).toLocaleString();

    // 3. 최근 7일
    let weekTotal = 0;
    for (let i = 0; i < 7; i++) {
        const d = new Date(kstNow.getTime() - (i * 86400000)).toISOString().split('T')[0];
        weekTotal += (data[d]?.total || 0);
    }
    document.getElementById('stat-week').textContent = weekTotal.toLocaleString();

    // 4. 이번 달
    let monthTotal = 0;
    const thisMonthPrefix = todayStr.substring(0, 7);
    Object.keys(data).forEach(k => {
        if (k.startsWith(thisMonthPrefix)) monthTotal += (data[k].total || 0);
    });
    document.getElementById('stat-month').textContent = monthTotal.toLocaleString();
}

function processStatsAndRender(data, type) {
    let labels = [];
    let values = [];
    let tableData = [];

    const startVal = document.getElementById('stats-start-date').value;
    const endVal = document.getElementById('stats-end-date').value;

    if (type === 'hourly') {
        const kstNow = new Date(new Date().getTime() + (9 * 60 * 60 * 1000));
        const todayStr = kstNow.toISOString().split('T')[0];
        const dayData = data[todayStr] || { hourly: {} };

        for (let i = 0; i < 24; i++) {
            const h = String(i).padStart(2, '0');
            labels.push(`${h}시`);
            const v = dayData.hourly[h] || 0;
            values.push(v);
            tableData.push({ label: `${h}:00 ~ ${h}:59`, value: v });
        }
    } else if (type === 'daily') {
        const start = new Date(startVal);
        const end = new Date(endVal);
        let current = new Date(start);

        while (current <= end) {
            const dStr = current.toISOString().split('T')[0];
            labels.push(dStr.substring(5)); // MM-DD
            const v = data[dStr]?.total || 0;
            values.push(v);
            tableData.push({ label: dStr, value: v });
            current.setDate(current.getDate() + 1);
        }
    } else if (type === 'monthly') {
        // 최근 12개월 추출 또는 연도별 집계
        const yearMonths = {};
        Object.keys(data).forEach(k => {
            const ym = k.substring(0, 7);
            yearMonths[ym] = (yearMonths[ym] || 0) + (data[k].total || 0);
        });
        const sortedYM = Object.keys(yearMonths).sort().slice(-12);
        sortedYM.forEach(ym => {
            labels.push(ym);
            values.push(yearMonths[ym]);
            tableData.push({ label: ym, value: yearMonths[ym] });
        });
    }

    // 차트 그리기
    renderVisitorChart(labels, values, type);

    // 테이블 업데이트
    const tbody = document.getElementById('stats-table-body');
    const total = values.reduce((a, b) => a + b, 0);

    // 최근 순으로 정렬하여 표출 (일별/월별일 때만)
    if (type !== 'hourly') tableData.reverse();

    tbody.innerHTML = tableData.map(item => {
        const percent = total > 0 ? ((item.value / total) * 100).toFixed(1) : 0;
        return `
            <tr>
                <td style="padding:10px 16px; border-bottom:1px solid rgba(255,255,255,0.03);">${item.label}</td>
                <td style="padding:10px 16px; border-bottom:1px solid rgba(255,255,255,0.03); text-align:right; font-weight:700;">${item.value.toLocaleString()}</td>
                <td style="padding:10px 16px; border-bottom:1px solid rgba(255,255,255,0.03); text-align:right; color:#64748b;">${percent}%</td>
            </tr>
        `;
    }).join('');
}

function renderVisitorChart(labels, values, type) {
    const ctx = document.getElementById('visitor-main-chart').getContext('2d');

    if (visitorChart) visitorChart.destroy();

    const isLine = type !== 'bar';
    const mainColor = '#22c55e'; // Vibrant Green (Emerald)

    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(34, 197, 94, 0.4)');
    gradient.addColorStop(1, 'rgba(34, 197, 94, 0)');

    visitorChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: '방문자 수',
                data: values,
                borderColor: mainColor,
                borderWidth: 3,
                backgroundColor: gradient,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#fff',
                pointBorderColor: mainColor,
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        plugins: [{
            id: 'glow',
            beforeDatasetDraw: (chart, args) => {
                const { ctx } = chart;
                ctx.save();
                ctx.shadowBlur = 15;
                ctx.shadowColor = mainColor;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 0;
            },
            afterDatasetDraw: (chart) => {
                chart.ctx.restore();
            }
        }],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1e293b',
                    titleColor: '#fff',
                    bodyColor: '#cbd5e1',
                    padding: 12,
                    cornerRadius: 8,
                    displayColors: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#64748b', font: { size: 10 } }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#64748b', font: { size: 10 } }
                }
            }
        }
    });
}

// 기존 관리 함수들 리다이렉션 (하위 호환성 유지)
window.showNoticeManagementModal = () => showUnifiedAdminModal('notice');
window.showPromoManagementModal = () => showUnifiedAdminModal('promo');
window.showApiManagementModal = () => showUnifiedAdminModal('api');
window.showAlertManagementModal = () => showUnifiedAdminModal('alert');

// 2. 관리 모달 구현체들 (기존 함수는 이제 helper로 사용되거나 제거 가능)

// (A) 공지 팝업 관리
window.showNoticeManagementModal = async function () {
    if (!adminAuthenticated.notice) return;

    // 공지 데이터 로드
    let notices = { active: [], expired: [] };
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/notices');
        if (res.ok) notices = await res.json();
    } catch (e) {
        // console.error(e);
        try {
            const res2 = await fetch(CONFIG.NOTICE_API_URL);
            if (res2.ok) {
                const old = await res2.json();
                if (old.isActive) notices.active = [old];
            }
        } catch (e2) { }
    }

    const existingModal = document.getElementById('notice-management-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'notice-management-modal';
    modal.className = 'notice-popup';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.8);';

    // 시간 옵션
    const hourOptions = Array.from({ length: 24 }, (_, i) => `<option value="${i}">${String(i).padStart(2, '0')}시</option>`).join('');
    const minuteOptions = Array.from({ length: 60 }, (_, i) => `<option value="${i}">${String(i).padStart(2, '0')}분</option>`).join('');
    const now = new Date();
    const defaultDate = now.toISOString().split('T')[0];
    const nextHour = new Date(now.getTime() + 60 * 60 * 1000);

    modal.innerHTML = `
        <div style="background:linear-gradient(135deg,#1a1f2e,#252b3b);border-radius:16px;max-width:480px;width:95%;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
            <div style="background:linear-gradient(135deg,#ffd54f,#ffb300);padding:16px 20px;border-radius:16px 16px 0 0;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10;">
                <h3 style="margin:0;color:#1a1f2e;font-size:1.1rem;display:flex;align-items:center;gap:10px;">
                    <i class="fa-solid fa-bell"></i> 공지 팝업 관리
                </h3>
                <button onclick="document.getElementById('notice-management-modal').remove();" 
                        style="background:rgba(0,0,0,0.2);border:none;color:#1a1f2e;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:1.2rem;">×</button>
            </div>
            
            <div style="padding:16px;" id="notice-management-content">
                
                <!-- 현재 진행 중인 공지사항 -->
                <div style="margin-bottom: 20px;">
                    <div style="background: rgba(6, 95, 70, 0.5); color: #a7f3d0; padding: 8px 12px; border-radius: 8px 8px 0 0; font-weight: 600; font-size: 0.9rem; border: 1px solid rgba(167, 243, 208, 0.2); border-bottom: none;">
                        <i class="fa-solid fa-circle-check" style="margin-right:6px;"></i> 현재 진행 중인 공지
                    </div>
                    <div id="active-notices-list" style="background: rgba(30, 41, 59, 0.6); border: 1px solid rgba(167, 243, 208, 0.2); border-radius: 0 0 8px 8px; max-height: 150px; overflow-y: auto;">
                        ${notices.active && notices.active.length > 0 ? notices.active.map(n => `
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                                <div style="flex: 1; min-width: 0; padding-right: 10px;">
                                    <div style="font-size: 0.9rem; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px;">${n.title || '제목 없음'}</div>
                                    <div style="font-size: 0.75rem; color: #94a3b8;"><i class="fa-regular fa-clock"></i> ~ ${n.expiresAt || '기한 없음'}</div>
                                </div>
                                <div style="display: flex; gap: 6px; flex-shrink: 0;">
                                    <button onclick="editNotice(${n.id})" style="background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4); padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; cursor: pointer;">수정</button>
                                    <button onclick="deleteNoticeById(${n.id})" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; cursor: pointer;">삭제</button>
                                </div>
                            </div>
                        `).join('') : '<div style="padding: 16px; text-align: center; color: #64748b; font-size: 0.85rem;">진행 중인 공지가 없습니다</div>'}
                    </div>
                </div>

                <!-- 종료된 공지사항 -->
                <div style="margin-bottom: 20px;">
                    <div style="background: rgba(68, 64, 60, 0.5); color: #d6d3d1; padding: 8px 12px; border-radius: 8px 8px 0 0; font-weight: 600; font-size: 0.9rem; border: 1px solid rgba(214, 211, 209, 0.2); border-bottom: none;">
                        <i class="fa-solid fa-clock-rotate-left" style="margin-right:6px;"></i> 종료된 공지
                    </div>
                    <div id="expired-notices-list" style="background: rgba(30, 41, 59, 0.6); border: 1px solid rgba(214, 211, 209, 0.2); border-radius: 0 0 8px 8px; max-height: 150px; overflow-y: auto;">
                        ${notices.expired && notices.expired.length > 0 ? notices.expired.map(n => `
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                                <div style="flex: 1; min-width: 0; padding-right: 10px;">
                                    <div style="font-size: 0.9rem; color: #cbd5e1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px;">${n.title || '제목 없음'}</div>
                                    <div style="font-size: 0.75rem; color: #64748b;">종료: ${n.expiresAt || '-'}</div>
                                </div>
                                <button onclick="reactivateNotice(${n.id})" style="background: rgba(99, 102, 241, 0.2); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.4); padding: 4px 10px; border-radius: 6px; font-size: 0.75rem; cursor: pointer; flex-shrink: 0;">재등록</button>
                            </div>
                        `).join('') : '<div style="padding: 16px; text-align: center; color: #64748b; font-size: 0.85rem;">종료된 공지가 없습니다</div>'}
                    </div>
                </div>

                <!-- 작성 폼 -->
                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 16px;">
                    <div style="font-weight: 600; font-size: 0.95rem; color: #e2e8f0; margin-bottom: 12px; display:flex; align-items:center; gap:8px;">
                        <i class="fa-solid fa-pen-nib" style="color:#ffd54f;"></i> 새 공지 작성 / 수정
                    </div>
                    
                    <input type="hidden" id="notice-edit-id" value="">
                    
                    <div style="margin-bottom: 12px;">
                        <label style="display: block; font-size: 0.8rem; color: #94a3b8; margin-bottom: 6px;">제목</label>
                        <input type="text" id="notice-title" style="width: 100%; padding: 10px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff; font-size: 0.95rem; box-sizing: border-box;" placeholder="예: 서버 점검 안내">
                    </div>
                    
                    <div style="margin-bottom: 12px;">
                        <label style="display: block; font-size: 0.8rem; color: #94a3b8; margin-bottom: 6px;">내용</label>
                        <textarea id="notice-content" style="width: 100%; height: 80px; padding: 10px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff; font-size: 0.9rem; resize: none; box-sizing: border-box;" placeholder="내용을 입력하세요..."></textarea>
                    </div>
                    
                    <div style="margin-bottom: 16px;">
                        <label style="display: block; font-size: 0.8rem; color: #94a3b8; margin-bottom: 6px;">종료 일시</label>
                        <div style="display: flex; gap: 8px;">
                            <input type="date" id="notice-expire-date" value="${defaultDate}" style="flex: 2; padding: 8px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff;">
                            <select id="notice-expire-hour" style="flex: 1; padding: 8px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff;">${hourOptions}</select>
                            <select id="notice-expire-minute" style="flex: 1; padding: 8px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff;">${minuteOptions}</select>
                        </div>
                    </div>
                    
                    <button onclick="saveNotice()" style="width: 100%; padding: 12px; background: linear-gradient(135deg, #ffd54f, #ffb300); color: #1a1e2e; border: none; border-radius: 8px; font-weight: 600; font-size: 0.95rem; cursor: pointer; transition: transform 0.2s;">
                        <i class="fa-solid fa-paper-plane" style="margin-right:6px;"></i> 공지 등록하기
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // 기본 시간 설정
    document.getElementById('notice-expire-hour').value = nextHour.getHours();
    document.getElementById('notice-expire-minute').value = 0;
};

// (B) 게시판 관리 - 오렌지 테마 모달 (왼쪽 목록 팝업)
window.showPromoManagementModal = async function () {
    if (!adminAuthenticated.promo) return;

    const existingModal = document.getElementById('promo-management-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'promo-management-modal';
    modal.className = 'notice-popup';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.8);';

    modal.innerHTML = `
        <div style="background:linear-gradient(135deg,#1a1f2e,#252b3b);border-radius:16px;max-width:500px;width:95%;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
            <div style="background:linear-gradient(135deg,#ff7043,#e64a19);padding:16px 20px;border-radius:16px 16px 0 0;display:flex;align-items:center;justify-content:space-between;">
                <h3 style="margin:0;color:#fff;font-size:1.1rem;display:flex;align-items:center;gap:10px;">
                    <i class="fa-solid fa-bullhorn"></i> 게시판 관리
                </h3>
                <button onclick="document.getElementById('promo-management-modal').remove();" 
                        style="background:rgba(255,255,255,0.2);border:none;color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:1.2rem;">×</button>
            </div>
            <div style="padding:16px;" id="promo-management-content">
                <div style="text-align:center;padding:30px;color:#aaa;">
                    <i class="fa-solid fa-spinner fa-spin fa-2x"></i>
                    <p style="margin-top:10px;">게시글 목록을 불러오는 중...</p>
                </div>
            </div>
            <div style="padding:12px 16px;background:rgba(0,0,0,0.2);border-radius:0 0 16px 16px;text-align:center;">
                <button onclick="openPromoEditor();" 
                        style="padding:10px 20px;background:linear-gradient(135deg,#ff7043,#e64a19);border:none;border-radius:8px;color:#fff;font-weight:600;cursor:pointer;font-size:0.9rem;">
                    <i class="fa-solid fa-plus" style="margin-right:6px;"></i>새 게시글 작성
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    await loadPromoListForAdmin();
};

async function loadPromoListForAdmin() {
    const content = document.getElementById('promo-management-content');
    if (!content) return;

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/promo');
        const posts = await res.json();

        if (!posts || posts.length === 0) {
            content.innerHTML = `
                <div style="text-align:center;padding:30px;color:#888;">
                    <i class="fa-solid fa-inbox fa-2x"></i>
                    <p style="margin-top:10px;">등록된 게시글이 없습니다.</p>
                </div>
            `;
            return;
        }

        let html = '';
        posts.forEach(post => {
            const date = post.createdAt ? new Date(post.createdAt).toLocaleDateString('ko-KR') : '-';
            html += `
                <div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:12px;margin-bottom:10px;border:1px solid rgba(255,255,255,0.1);">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                        <div style="color:#fff;font-weight:600;font-size:0.95rem;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${post.title || '제목 없음'}</div>
                        <span style="color:#888;font-size:0.75rem;margin-left:10px;">${date}</span>
                    </div>
                    <div style="display:flex;gap:8px;justify-content:flex-end;">
                        <button onclick="editPromoPost(${post.id}); document.getElementById('promo-management-modal').remove();" 
                                style="background:rgba(79,195,247,0.15);border:1px solid rgba(79,195,247,0.3);color:#4fc3f7;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:0.75rem;">
                            <i class="fa-solid fa-edit"></i> 수정
                        </button>
                        <button onclick="deletePromoPostFromAdmin(${post.id});" 
                                style="background:rgba(244,67,54,0.15);border:1px solid rgba(244,67,54,0.3);color:#f44336;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:0.75rem;">
                            <i class="fa-solid fa-trash"></i> 삭제
                        </button>
                    </div>
                </div>
            `;
        });
        content.innerHTML = html;
    } catch (e) {
        content.innerHTML = `
            <div style="text-align:center;padding:30px;color:#f44336;">
                <i class="fa-solid fa-exclamation-circle fa-2x"></i>
                <p style="margin-top:10px;">게시글 목록을 불러올 수 없습니다.</p>
            </div>
        `;
    }
}

async function deletePromoPostFromAdmin(postId) {
    if (!confirm('정말로 이 게시글을 삭제하시겠습니까?')) return;

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/promo/' + postId, { method: 'DELETE' });
        const result = await res.json();
        if (result.success) {
            loadPromoListForAdmin();
            loadPromoPosts();
        } else {
            alert('삭제 실패');
        }
    } catch (e) {
        alert('삭제 중 오류 발생: ' + e.message);
    }
}

// 헬퍼: 공지 수정 모드
window.editNotice = async function (id) {
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/notices');
        const data = await res.json();
        const allNotices = [...(data.active || []), ...(data.expired || [])];
        const target = allNotices.find(n => n.id === id);

        if (target) {
            document.getElementById('notice-edit-id').value = target.id;
            document.getElementById('notice-title').value = target.title;
            document.getElementById('notice-content').value = target.content;

            if (target.expiresAt) {
                const [datePart, timePart] = target.expiresAt.split(' ');
                document.getElementById('notice-expire-date').value = datePart;
                if (timePart) {
                    const [h, m] = timePart.split(':');
                    document.getElementById('notice-expire-hour').value = parseInt(h);
                    document.getElementById('notice-expire-minute').value = parseInt(m);
                }
            }
            document.getElementById('notice-title').focus();
        }
    } catch (e) {
        // console.error('수정 데이터 로드 실패:', e);
    }
};

window.reactivateNotice = function (id) {
    editNotice(id);
};

// (추가) 공지 저장/삭제 함수
window.saveNotice = async function () {
    const editId = document.getElementById('notice-edit-id').value;
    const title = document.getElementById('notice-title').value;
    const content = document.getElementById('notice-content').value;
    const expireDate = document.getElementById('notice-expire-date').value;
    const expireHour = document.getElementById('notice-expire-hour').value;
    const expireMinute = document.getElementById('notice-expire-minute').value;

    if (!title || !content) {
        alert("제목과 내용을 모두 입력해주세요.");
        return;
    }

    if (!expireDate) {
        alert("공지 종료 기한을 설정해주세요.");
        return;
    }

    const expiresAt = `${expireDate} ${String(expireHour).padStart(2, '0')}:${String(expireMinute).padStart(2, '0')}`;

    const payload = {
        isActive: true,
        id: editId ? parseInt(editId) : Date.now(),
        title: title,
        content: content,
        expiresAt: expiresAt,
        updatedAt: new Date().toLocaleString()
    };

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/notices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            alert('공지가 저장되었습니다.');
            document.getElementById('notice-management-modal').remove();
            showNoticeManagementModal(); // 새로고침
        } else {
            alert('저장 실패');
        }
    } catch (e) {
        alert('오류 발생: ' + e.message);
    }
};

window.deleteNoticeById = async function (id) {
    if (!confirm("이 공지를 삭제하시겠습니까?")) return;

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/notice/' + id, { method: 'DELETE' });
        if (res.ok) {
            alert("삭제되었습니다.");
            document.getElementById('notice-management-modal').remove();
            showNoticeManagementModal();
        } else {
            alert("삭제 실패");
        }
    } catch (e) {
        alert("오류: " + e.message);
    }
};

// (C) API 관리
window.showApiManagementModal = async function () {
    if (!adminAuthenticated.api) return;

    const existingModal = document.getElementById('api-management-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'api-management-modal';
    modal.className = 'notice-popup';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.8);';

    modal.innerHTML = `
        <div style="background:linear-gradient(135deg,#1a1f2e,#252b3b);border-radius:16px;max-width:480px;width:95%;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
            <div style="background:linear-gradient(135deg,#4fc3f7,#0288d1);padding:16px 20px;border-radius:16px 16px 0 0;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10;">
                <h3 style="margin:0;color:#fff;font-size:1.1rem;display:flex;align-items:center;gap:10px;">
                    <i class="fa-solid fa-server"></i> API 관리 현황
                </h3>
                <button onclick="document.getElementById('api-management-modal').remove();" 
                        style="background:rgba(255,255,255,0.2);border:none;color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:1.2rem;">×</button>
            </div>
            <div style="padding:16px;" id="api-status-content">
                <div style="text-align:center;padding:40px;color:#aaa;">
                    <i class="fa-solid fa-spinner fa-spin fa-2x"></i>
                    <p style="margin-top:10px;">API 상태를 불러오는 중...</p>
                </div>
            </div>
            <div style="padding:12px 16px;background:rgba(0,0,0,0.2);border-radius:0 0 16px 16px;text-align:center;">
                <button onclick="refreshApiStatus();" style="padding:8px 16px;background:rgba(79,195,247,0.2);border:1px solid #4fc3f7;border-radius:6px;color:#4fc3f7;cursor:pointer;font-size:0.85rem;">
                    <i class="fa-solid fa-refresh"></i> 전체 새로고침
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    await refreshApiStatus();
};

window.refreshApiStatus = async function () {
    const content = document.getElementById('api-status-content');
    if (!content) return;

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/status');
        const status = await res.json();

        const apiItems = [
            { key: 'general', name: '기상 예보', icon: 'fa-sun', color: '#ffd54f' },
            { key: 'warnings_hub', name: '특보 - HUB (KMA)', icon: 'fa-bolt', color: '#ff5722' },
            { key: 'zone', name: '해구별 예보', icon: 'fa-map-location-dot', color: '#29b6f6' },
            { key: 'buoys', name: '관측 부이', icon: 'fa-anchor', color: '#26a69a' }
        ];

        let html = '';
        apiItems.forEach(api => {
            const s = status[api.key] || { lastRun: '-', status: '정보 없음', message: '' };
            const isSuccess = s.status === '성공';
            const statusColor = isSuccess ? '#4caf50' : (s.status === '실패' ? '#f44336' : '#9e9e9e');

            html += `
                <div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:12px;margin-bottom:10px;border:1px solid rgba(255,255,255,0.1);">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                        <div style="display:flex;align-items:center;gap:10px;">
                            <div style="width:36px;height:36px;background:rgba(${hexToRgb(api.color)},0.2);border-radius:8px;display:flex;align-items:center;justify-content:center;">
                                <i class="fa-solid ${api.icon}" style="color:${api.color};font-size:1rem;"></i>
                            </div>
                            <div>
                                <div style="color:#fff;font-weight:600;font-size:0.95rem;">${api.name}</div>
                                <div style="color:#888;font-size:0.75rem;">${s.message || ''}</div>
                            </div>
                        </div>
                        <span style="background:${statusColor};color:#fff;padding:3px 8px;border-radius:12px;font-size:0.7rem;font-weight:600;">${s.status}</span>
                    </div>
                    <div style="display:flex;align-items:center;justify-content:space-between;">
                        <div style="color:#aaa;font-size:0.75rem;">
                            <i class="fa-regular fa-clock" style="margin-right:4px;"></i>
                            ${s.lastRun || '호출 기록 없음'}
                        </div>
                        <button onclick="forceUpdateApi('${api.key}')" 
                                style="background:rgba(79,195,247,0.15);border:1px solid rgba(79,195,247,0.3);color:#4fc3f7;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:0.75rem;font-weight:500;">
                            <i class="fa-solid fa-rotate"></i> 수동 호출
                        </button>
                    </div>
                </div>
            `;
        });

        content.innerHTML = html;
    } catch (e) {
        content.innerHTML = `
            <div style="text-align:center;padding:30px;color:#f44336;">
                <i class="fa-solid fa-exclamation-circle fa-2x"></i>
                <p style="margin-top:10px;">API 상태를 불러올 수 없습니다.</p>
            </div>
        `;
    }
};

window.forceUpdateApi = async function (type) {
    const btn = event.target.closest('button');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>...';
    btn.disabled = true;

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/force-update/' + type, { method: 'POST' });
        const result = await res.json();

        if (result.success) {
            btn.innerHTML = '<i class="fa-solid fa-check"></i> 완료';
            setTimeout(() => { refreshApiStatus(); }, 1000);
        } else {
            throw new Error(result.error || '실패');
        }
    } catch (e) {
        btn.innerHTML = '<i class="fa-solid fa-times"></i> 에러';
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }, 2000);
    }
};

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? `${parseInt(result[1], 16)},${parseInt(result[2], 16)},${parseInt(result[3], 16)}` : '255,255,255';
}

// ============================================================================
// [New] 페이지 초기 로드 시 공지사항 뱃지 미리 업데이트
// ============================================================================
(async function initPromoBadges() {
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/promo');
        if (res.ok) {
            const posts = await res.json();
            updateNewBadges(posts);
            // console.log('[Init] 공지사항 뱃지 초기화 완료');
        }
    } catch (e) {
        // console.warn('[Init] 공지사항 뱃지 초기화 실패:', e.message);
    }
})();

// ============================================================================
// [New] 폰트 크기 설정 기능
// ============================================================================
const FontSizeManager = {
    STORAGE_KEY: 'user_font_size',

    // 폰트 크기 오프셋 (기존 반응형 크기에 더함)
    OFFSETS: {
        small: 0,    // 기존 반응형 그대로
        medium: 2,   // +2px
        large: 4     // +4px
    },

    // 현재 설정 가져오기
    get() {
        return localStorage.getItem(this.STORAGE_KEY) || 'medium';
    },

    // 설정 저장
    set(size) {
        if (!this.OFFSETS.hasOwnProperty(size)) size = 'medium';
        localStorage.setItem(this.STORAGE_KEY, size);
        this.apply(size);
    },

    // CSS 적용
    apply(size) {
        if (!size) size = this.get();
        const offset = this.OFFSETS[size] || 0;

        // 현재 뷰포트 기반 기본 폰트 크기 계산
        const viewportWidth = window.innerWidth;
        let baseFontSize;

        if (viewportWidth < 360) {
            baseFontSize = 13;
        } else if (viewportWidth < 400) {
            baseFontSize = 14;
        } else if (viewportWidth < 431) {
            baseFontSize = 15;
        } else {
            baseFontSize = 16;
        }

        // 오프셋 적용
        const finalFontSize = baseFontSize + offset;
        document.documentElement.style.fontSize = finalFontSize + 'px';

        // data 속성 추가 (디버깅용)
        document.documentElement.setAttribute('data-font-size', size);

        console.log(`[FontSize] 적용: ${size} (base: ${baseFontSize}px + offset: ${offset}px = ${finalFontSize}px)`);
    },

    // 설정 모달 UI 초기화
    initUI() {
        const radios = document.querySelectorAll('input[name="font-size"]');
        const current = this.get();

        radios.forEach(radio => {
            const content = radio.nextElementSibling;

            // 현재 값 반영
            if (radio.value === current) {
                radio.checked = true;
                if (content) {
                    content.style.background = 'var(--accent-blue)';
                    content.style.color = 'white';
                    content.classList.add('active');
                }
            } else {
                radio.checked = false;
                if (content) {
                    content.style.background = '';
                    content.style.color = '#ccc';
                    content.classList.remove('active');
                }
            }

            // 클릭 이벤트
            radio.addEventListener('change', () => {
                // 모든 라디오 스타일 초기화
                radios.forEach(r => {
                    const c = r.nextElementSibling;
                    if (c) {
                        c.style.background = '';
                        c.style.color = '#ccc';
                        c.classList.remove('active');
                    }
                });

                // 선택된 라디오 스타일 적용
                if (content) {
                    content.style.background = 'var(--accent-blue)';
                    content.style.color = 'white';
                    content.classList.add('active');
                }

                // 즉시 미리보기 적용
                this.apply(radio.value);
            });
        });
    },

    // 저장 (saveSettingsAndClose에서 호출)
    save() {
        const selected = document.querySelector('input[name="font-size"]:checked');
        if (selected) {
            this.set(selected.value);
        }
    }
};

// 페이지 로드 시 폰트 크기 적용
FontSizeManager.apply();

// 설정 모달 열릴 때 UI 초기화
const _originalOpenSettingsModal = window.openSettingsModal;
window.openSettingsModal = function () {
    if (_originalOpenSettingsModal) _originalOpenSettingsModal();
    setTimeout(() => FontSizeManager.initUI(), 100);
};

// 전역 노출
window.FontSizeManager = FontSizeManager;

// [Note] 특보 알림 상세 팝업 기능은 fix_popup_logic.js에서 처리하므로 삭제됨

// ============================================================================
// (D) 특보 알림 관리 (Alert Management)
// ============================================================================

// Mock Data Storage for Demo
let MOCK_ALERT_HISTORY = [];

function generateMockAlertHistory() {
    // Generate data based on the MD file scenarios
    const now = new Date();

    // 1. Publish (발표)
    MOCK_ALERT_HISTORY.push({
        id: 'pub_1',
        tab: 'publish', // also shown in general history
        type: 'auto',
        time: '26.01.03 07:00',
        pushStatus: 'sent',
        pushTime: '15:30',
        title: '풍랑주의보 발표',
        zones: ['울산앞바다', '경북남부앞바다'],
        grade: 'warning',
        items: [
            { zone: '울산앞바다', tmEf: '26.01.03 09:00', tmRl: '26.01.03 18:00' },
            { zone: '경북남부앞바다', tmEf: '26.01.03 09:00', tmRl: '26.01.03 18:00' }
        ]
    });

    MOCK_ALERT_HISTORY.push({
        id: 'pub_2',
        tab: 'publish',
        type: 'auto',
        time: '26.01.03 07:00',
        pushStatus: 'pending',
        pushTime: null,
        title: '풍랑주의보 발표',
        zones: ['부산앞바다', '거제시동부앞바다'],
        grade: 'advisory',
        items: [
            { zone: '부산앞바다', tmEf: '26.01.03 10:00', tmRl: '26.01.03 20:00' },
            { zone: '거제시동부앞바다', tmEf: '26.01.03 10:00', tmRl: '26.01.03 22:00' }
        ]
    });

    MOCK_ALERT_HISTORY.push({
        id: 'act_1',
        tab: 'active',
        type: 'auto',
        time: '26.01.03 09:00',
        badge: 'active',
        pushStatus: 'sent',
        pushTime: '09:00',
        title: '풍랑경보 발효',
        zones: ['인천·경기북부앞바다'],
        grade: 'warning',
        items: [
            { zone: '인천·경기북부앞바다', tmRl: '26.01.03 18:00' }
        ]
    });

    MOCK_ALERT_HISTORY.push({
        id: 'lvl_1',
        tab: 'level',
        type: 'auto',
        time: '26.01.03 15:00',
        badge: 'upgrade',
        pushStatus: 'sent',
        pushTime: '15:00',
        title: '풍랑주의보 → 풍랑경보',
        zones: ['제주도북부앞바다'],
        grade: 'warning',
        items: [
            { zone: '제주도북부앞바다', tmRl: '26.01.03 22:00' }
        ]
    });

    // Custom History (Manually Sent)
    MOCK_ALERT_HISTORY.push({
        id: 'cust_1',
        tab: 'custom_history',
        type: 'manual',
        time: '26.01.03 15:30',
        pushStatus: 'sent',
        count: 245,
        target: '전남서부남해앞바다, 전남동부남해앞바다',
        title: '긴급 해양 안전 공지',
        content: '현재 남해 서부 해역에 강한 돌풍이 예상되오니 소형 선박은 안전한 곳으로 대피하시기 바랍니다.'
    });

    MOCK_ALERT_HISTORY.push({
        id: 'cust_2',
        tab: 'custom_history',
        type: 'manual',
        time: '26.01.02 09:00',
        pushStatus: 'sent',
        count: 512,
        target: '전체 해역',
        title: '시스템 점검 안내',
        content: '26.01.02 10:00 ~ 12:00 서비스 점검 예정입니다. 이용에 불편을 드려 죄송합니다.'
    });
}

// Generate once
generateMockAlertHistory();

window.showAlertManagementModal = function () {
    if (!adminAuthenticated.alert) return;

    const existingModal = document.getElementById('alert-management-modal');
    if (existingModal) existingModal.remove();

    const tabs = [
        { id: 'publish', name: '발표', icon: 'fa-bullhorn' },
        { id: 'active', name: '발효', icon: 'fa-check-circle' },
        { id: 'release', name: '해제', icon: 'fa-check' },
        { id: 'level', name: '격상/격하', icon: 'fa-arrow-up-right-dots' },
        { id: 'custom', name: '직접 발송', icon: 'fa-paper-plane' },
        { id: 'history', name: '발송 이력', icon: 'fa-history' }
    ];

    let activeTab = 'publish'; // default

    const modal = document.createElement('div');
    modal.id = 'alert-management-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.8);backdrop-filter:blur(4px);animation:fadeIn 0.2s;';

    modal.innerHTML = `
        <div style="background:linear-gradient(135deg,#1e293b,#0f172a);border-radius:16px;width:95%;max-width:600px;max-height:85vh;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(255,255,255,0.1);">
            <!-- Header (Fixed) -->
            <div style="background:linear-gradient(135deg,#ef4444,#b91c1c);padding:16px 20px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;position:sticky;top:0;z-index:10;">
                <h3 style="margin:0;color:#fff;font-size:1.1rem;font-weight:700;display:flex;align-items:center;gap:10px;text-shadow:0 1px 2px rgba(0,0,0,0.2);">
                    <i class="fa-solid fa-tower-broadcast"></i> 해양특보 알림 관리
                </h3>
                <button onclick="document.getElementById('alert-management-modal').remove();" 
                        style="background:rgba(255,255,255,0.2);border:none;color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:1.2rem;display:flex;align-items:center;justify-content:center;transition:background 0.2s;">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            
            <!-- Tabs (Fixed & No Scroll) -->
            <div style="display:flex;background:rgba(0,0,0,0.2);padding:0;border-bottom:1px solid rgba(255,255,255,0.1);position:sticky;z-index:10;backdrop-filter:blur(10px);width:100%;">
                ${tabs.map(t => `
                    <button class="alert-admin-tab" 
                            data-tab="${t.id}"
                            onclick="window.switchAlertAdminTab('${t.id}')"
                            style="flex:1;padding:12px 2px;border:none;background:transparent;color:#94a3b8;cursor:pointer;font-weight:600;font-size:0.75rem;transition:all 0.2s;white-space:nowrap;border-bottom:2px solid transparent;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-width:0;">
                         <i class="fa-solid ${t.icon}" style="font-size:0.9rem;"></i>
                         <span>${t.name}</span>
                    </button>
                `).join('')}
            </div>

            <!-- Content Area (Scrollable) -->
            <div id="alert-management-content" style="padding:20px;flex:1;overflow-y:auto;background:#0f172a;">
                <div style="text-align:center;padding:40px;color:#64748b;">
                    <i class="fa-solid fa-circle-notch fa-spin"></i> 데이터를 불러오는 중...
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Initial render
    window.switchAlertAdminTab(activeTab);
};

window.switchAlertAdminTab = function (tabId) {
    // Update tab styles
    document.querySelectorAll('.alert-admin-tab').forEach(btn => {
        if (btn.dataset.tab === tabId) {
            btn.style.color = '#fff';
            btn.style.borderBottomColor = '#ef4444';
            btn.style.background = 'rgba(255,255,255,0.05)';
        } else {
            btn.style.color = '#94a3b8';
            btn.style.borderBottomColor = 'transparent';
            btn.style.background = 'transparent';
        }
    });

    // CONTENT RENDER
    window.renderAlertAdminContent(tabId);
};

window.renderAlertAdminContent = async function (tabId, targetContainer = null) {
    const container = targetContainer || document.getElementById('alert-management-content');
    if (!container) return;

    if (tabId === 'custom') {
        window.renderCustomPushTab(container);
        return;
    }
    if (tabId === 'history') {
        window.renderHistoryTab(container);
        return;
    }

    // 1. Fetch Push History for status verification
    let pushHistory = [];
    try {
        const hRes = await fetch('/api/push-history');
        if (hRes.ok) pushHistory = await hRes.json();
    } catch (e) { }

    // 2. Prepare Data
    // [수정] 해양특보 알림 관리에서는 메인 해역 특보만 취급 (연안바다/평수구역 제외)
    const allAlerts = [
        ...appState.alerts
    ].filter(a => !a.isCoastal && !a.zoneName.includes('연안바다') && !a.zoneName.includes('평수구역'));

    // Filter by Tab
    let filteredItems = [];
    if (tabId === 'publish') {
        // [수정] 발표 탭: 신규 발표(1)나 시각 변경(2)만 포함. 등급 변경(명령6 혹은 command:'변경')은 제외하여 격상 탭으로 유도.
        filteredItems = allAlerts.filter(a =>
            (a.isPreliminary || a.command === '1' || a.command === '발표' || a.command === '2' || a.command === '시각변경') &&
            !(a.command === '변경' || a.command === '변경발표' || a.command === '6')
        );
    } else if (tabId === 'active') {
        // [수정] 발효 탭: 해제(3)가 아닌 모든 데이터를 포함
        filteredItems = allAlerts.filter(a => a.command !== '3' && a.command !== '해제');
    } else if (tabId === 'release') {
        filteredItems = allAlerts.filter(a =>
            a.command === '3' ||
            a.command === '해제' ||
            (!a.isPreliminary && a.tmEd && a.tmEd.trim() !== '' && a.tmEd !== '정보 없음' && a.tmEd !== '미정' && !a.tmEd.includes('00일'))
        );
    } else if (tabId === 'level') {
        // [수정] 격상/격하 탭: command가 '변경'이거나 '6'인 모든 건(예정 포함)을 여기서 관리
        filteredItems = allAlerts.filter(a => a.command === '변경' || a.command === '변경발표' || a.command === '6');
    }

    // [추가] 데이터 무결성 보장: 동일 해역/특보에 대해 가장 최신 데이터(발표시각 기준)만 남김
    const uniqueAlertMap = new Map();
    filteredItems.forEach(item => {
        const uniqueKey = `${item.zoneName}_${item.warnType}_${item.level}`;
        const existing = uniqueAlertMap.get(uniqueKey);

        // 시간 비교를 위해 숫자만 추출
        const itemTime = String(item.tmFc || '').replace(/[^0-9]/g, '');
        const existingTime = existing ? String(existing.tmFc || '').replace(/[^0-9]/g, '') : '';

        if (!existing || itemTime > existingTime) {
            uniqueAlertMap.set(uniqueKey, item);
        }
    });
    const finalizedItems = Array.from(uniqueAlertMap.values());

    // 3. 1단계 그룹화 (시간 + 특보종류)
    const cardGroups = {};
    const nowStr = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace(/[-T:Z]/g, '').substring(0, 12);

    finalizedItems.forEach(item => {
        // 격상/격하 여부 판단
        const isLevelChange = item.command === '변경' || item.level?.includes('경보');
        const statusType = item.level?.includes('경보') ? '격상' : (item.level?.includes('주의보') && item.command === '변경' ? '격하' : '정규');

        // 날짜 정규화 함수 (비교용)
        const getCompareValue = (dStr) => {
            if (!dStr || dStr === '정보 없음' || dStr === '미정' || dStr.trim() === '일') return '999999999999';
            let numeric = dStr.replace(/[^0-9]/g, '');
            if (numeric.length === 12) return numeric;

            // 한글 포함 시각 (예: 06일 오전(09시~12시)) 처리
            const dayMatch = dStr.match(/(\d+)일/);
            const hourMatch = dStr.match(/\((\d+)시/);
            if (dayMatch) {
                const now = new Date();
                const year = now.getFullYear();
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const day = dayMatch[1].padStart(2, '0');
                // 범위의 시작 시각을 기준으로 비교 (09시~12시 -> 09시)
                const hour = hourMatch ? hourMatch[1].padStart(2, '0') : '00';
                return `${year}${month}${day}${hour}00`;
            }
            if (!numeric || numeric.length === 0) return '999999999999';
            return numeric.padEnd(12, '0');
        };

        const efCompare = getCompareValue(item.tmEf);
        const edCompare = getCompareValue(item.tmEd);

        // 실제 상황 판단 (현재 시점 기준)
        // [수정] 장부에서 '발표(upcoming)' 상태라면 시간이 지났어도 강제로 Active가 아닌 것으로 간주함
        const isActuallyActive = item.isPreliminary ? false : (efCompare <= nowStr);
        const isActuallyReleased = (item.isPreliminary || !isActuallyActive) ? false : (edCompare <= nowStr);

        // [핵심 로직] 탭별 대기/라이브 판단
        const isWaiting = tabId === 'release'
            ? (edCompare > nowStr)
            : (item.isPreliminary || efCompare > nowStr);

        const typeKey = `${item.warnType}${item.level}`;
        // [핵심 변경] 그룹 키에서 시각 제거하여 동일 특보 종류는 무조건 하나의 카드로 통합
        // [수정] 그룹 키에 시각 정보를 포함하여 동일한 종류라도 시각이 다르면 분리
        // (발표/발효/해제 시각을 모두 고려하여 유니크하게 분리)
        // [Primary Key] - Used for grouping cards
        // [Primary Key] - Used for grouping cards
        let primaryTime = item.tmFc; // Default (Publish/Level)
        if (tabId === 'active') primaryTime = item.tmEf; // Active tab uses tmEf
        else if (tabId === 'release') primaryTime = item.tmYn || item.tmEd || '정보 없음'; // Release tab uses Release Time

        const groupKey = `${statusType}_${typeKey}_${primaryTime}`;

        // [Sub Key] - Used for separating lists inside a card
        let subKey = 'default';
        if (tabId === 'publish') subKey = item.tmEf; // Split by Effective Time
        else if (tabId === 'active') subKey = item.tmEd || '정보 없음'; // Split by Release Time

        const isTimeChanged = item.command === '2' || item.command === '시각변경';

        // Time Validation & Format
        let headerTimeDisplay = isNaN(Number(primaryTime)) ? (primaryTime === '정보 없음' ? '해제 시각 미정' : primaryTime) : primaryTime;
        if (primaryTime && primaryTime.length === 12 && !isNaN(Number(primaryTime))) {
            headerTimeDisplay = `26.${primaryTime.substring(4, 6)}.${primaryTime.substring(6, 8)} ${primaryTime.substring(8, 10)}:${primaryTime.substring(10, 12)}`;
        }

        if (!cardGroups[groupKey]) {
            cardGroups[groupKey] = {
                key: groupKey,
                headerTime: headerTimeDisplay,
                rawTime: primaryTime,
                tmFc: item.tmFc, // Keep for push log matching
                statusType: statusType,
                typeName: item.warnType,
                level: item.level,
                isPreliminary: item.isPreliminary,
                isTimeChanged: isTimeChanged,
                // [Fix] Add missing status flags to object
                isWaiting: isWaiting,
                isActuallyActive: isActuallyActive,
                isActuallyReleased: isActuallyReleased,
                subGroups: {}
            };
        }

        if (!cardGroups[groupKey].subGroups[subKey]) {
            cardGroups[groupKey].subGroups[subKey] = {
                tmEf: item.tmEf,
                tmYn: item.tmEd,
                // Fix: Ensure tmFc is correctly assigned from item
                tmFc: item.tmFc,
                zones: []
            };
        }

        const fullName = item.zoneName.split('(')[0].trim();
        if (!cardGroups[groupKey].subGroups[subKey].zones.includes(fullName)) {
            cardGroups[groupKey].subGroups[subKey].zones.push(fullName);
        }
    });

    const sortedGroups = Object.values(cardGroups).sort((a, b) => {
        if (a.isWaiting !== b.isWaiting) return a.isWaiting ? 1 : -1;
        return String(b.rawTime).localeCompare(String(a.rawTime));
    });

    if (sortedGroups.length === 0) {
        container.innerHTML = `
            <div style="text-align:center;padding:60px 20px;color:#64748b;">
                <i class="fa-solid fa-clipboard-check" style="font-size:3rem;margin-bottom:15px;opacity:0.3;"></i>
                <p style="font-size:1.1rem;font-weight:600;">현재 해당 탭의 특보 데이터가 없습니다.</p>
                <p style="font-size:0.85rem;margin-top:5px;">기상청 데이터가 수집되면 자동으로 타임라인이 형성됩니다.</p>
            </div>
        `;
        return;
    }

    let html = '';
    sortedGroups.forEach(group => {
        let timeDisplay = group.headerTime;
        const isSent = pushHistory.some(h => {
            // 탭 매칭
            const tabMatch = (group.isLevelChange ? h.tab === 'level' : (h.tab === tabId || h.tab.startsWith(tabId)));
            if (!tabMatch) return false;

            // [New] 기준시각(tmRef)이 있으면 우선 매칭 (자동 발송 시 심어짐)
            // 이제 groupKey가 시각별로 분리되었으므로 tmRef 비교가 정확해짐
            if (h.tmRef && group.tmFc && h.tmRef === group.tmFc) return true;

            // [Fallback] 기존 내용 기반 매칭 (수동 발송 등)
            // [수정] 종류와 시각뿐만 아니라 탭(tabId) 정보가 일치해야 함 (이미지 3 오판독 방지)
            const contentMatch = h.content?.includes(group.typeName) && h.time?.includes(group.headerTime?.substring(4, 10));
            return contentMatch && (h.tab === tabId || h.tab?.startsWith(tabId));
        });

        const sentLog = isSent ? pushHistory.find(h => {
            const tabMatch = (group.isLevelChange ? h.tab === 'level' : (h.tab === tabId || h.tab?.startsWith(tabId)));
            if (!tabMatch) return false;
            if (h.tmRef && group.tmFc && h.tmRef === group.tmFc) return true;
            return h.content?.includes(group.typeName) && h.time?.includes(group.headerTime?.substring(4, 10));
        }) : null;

        const isAuto = sentLog?.type === 'auto';
        let statusText = '';
        const pushResult = isSent ? (isAuto ? '자동 발송완료' : '수동 발송완료') : '발송 대기';

        if (tabId === 'active' || tabId === 'level') {
            if (group.isTimeChanged) {
                statusText = `<span style="color:#38bdf8;"><i class="fa-solid fa-clock-rotate-left"></i> 시각 변경</span> <span style="color:rgba(255,255,255,0.2);margin:0 5px;">|</span> <span style="color:${isSent ? '#22c55e' : '#94a3b8'};">${pushResult}</span>`;
            } else if (group.isWaiting) {
                statusText = `<span style="color:#f59e0b;"><i class="fa-solid fa-hourglass-start"></i> 발효 대기 중</span>`;
            } else if (group.isActuallyReleased) {
                statusText = `<span style="color:#22c55e;"><i class="fa-solid fa-check-double"></i> 해제 완료</span> <span style="color:rgba(255,255,255,0.2);margin:0 5px;">|</span> <span style="color:${isSent ? '#22c55e' : '#94a3b8'};">${pushResult}</span>`;
            } else {
                let liveLabel = '발효 중';
                if (group.isLevelChange) {
                    liveLabel = `${group.level}로 ${group.statusType}`;
                }
                statusText = `<span style="color:#ef4444;"><i class="fa-solid fa-satellite-dish"></i> ${liveLabel}</span> <span style="color:rgba(255,255,255,0.2);margin:0 5px;">|</span> <span style="color:${isSent ? '#22c55e' : '#94a3b8'};">${pushResult}</span>`;
            }
        } else if (tabId === 'release') {
            if (group.isWaiting) {
                statusText = `<span style="color:#10b981;"><i class="fa-solid fa-clock"></i> 해제 예정</span> <span style="color:rgba(255,255,255,0.2);margin:0 5px;">|</span> <span style="color:${isSent ? '#22c55e' : '#94a3b8'};">${pushResult}</span>`;
            } else {
                statusText = `<span style="color:#22c55e;"><i class="fa-solid fa-check-double"></i> 해제 완료</span> <span style="color:rgba(255,255,255,0.2);margin:0 5px;">|</span> <span style="color:${isSent ? '#22c55e' : '#94a3b8'};">${pushResult}</span>`;
            }
        } else if (tabId === 'publish') {
            if (group.isActuallyActive) {
                statusText = `<span style="color:#22c55e;">발효 완료</span> <span style="color:rgba(255,255,255,0.2);margin:0 5px;">|</span> <span style="color:${isSent ? '#22c55e' : '#94a3b8'};">${pushResult}</span>`;
            } else {
                statusText = `<span style="color:#f59e0b;"><i class="fa-solid fa-hourglass-start"></i> 발효 대기</span> <span style="color:rgba(255,255,255,0.2);margin:0 5px;">|</span> <span style="color:${isSent ? '#22c55e' : '#94a3b8'};">${pushResult}</span>`;
            }
        } else {
            statusText = isSent ? '수동 발송완료' : '발송 대기';
        }

        const statusBadge = `<div style="font-size:0.75rem;font-weight:700;display:flex;align-items:center;">${statusText}</div>`;

        let displayLevel = group.level || '';
        if ((displayLevel === '예비' || group.isPreliminary) && (tabId === 'active' || tabId === 'release' || tabId === 'level' || tabId === 'publish')) {
            displayLevel = '주의보';
        }

        let tabSymbol = '🔔'; let tabLabel = '발표';
        if (tabId === 'active') { tabSymbol = '⚠️'; tabLabel = '발효'; }
        else if (tabId === 'release') { tabSymbol = '✅'; tabLabel = '해제'; }
        else if (tabId === 'level') {
            const isUp = (group.level || '').includes('경보');
            tabSymbol = isUp ? '🔺' : '🔻'; tabLabel = isUp ? '격상' : '격하';
            if (group.typeName.includes('태풍')) tabSymbol = '🌀';
        }

        const fullTitle = `${group.typeName}${displayLevel}`;
        const displayLabelText = (fullTitle.includes(tabLabel)) ? '' : tabLabel;

        html += `
            <div style="background:rgba(30,41,59,0.5);border:1px solid rgba(255,255,255,0.1);border-radius:12px;margin-bottom:18px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.1);">
                <div style="padding:12px 16px;background:rgba(255,255,255,0.03);display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.05);">
                    <div style="font-size:0.85rem;font-weight:700;color:#cbd5e1;display:flex;align-items:center;">
                        <i class="fa-regular fa-calendar-check" style="margin-right:8px;"></i> ${timeDisplay}
                        <span style="color:rgba(255,255,255,0.1);margin:0 10px;">|</span>
                        ${statusBadge}
                    </div>
                    ${((tabId === 'active' || tabId === 'release' || tabId === 'level') && group.isWaiting) ? '' :
                (tabId === 'active' && group.isLevelChange) ? `
                        <div style="background:rgba(255,255,255,0.05);color:#64748b;padding:5px 12px;border-radius:6px;font-size:0.7rem;font-weight:700;border:1px solid rgba(255,255,255,0.05);">
                            격상/격하 탭에서 관리
                        </div>
                      ` : `
                        <button onclick="window.sendManualPushFromGroup('${group.key}', '${tabId}')" 
                                style="background:${isSent ? '#475569' : '#ef4444'};color:#fff;border:none;padding:5px 12px;border-radius:6px;font-size:0.75rem;font-weight:800;cursor:pointer;">
                            수동발송
                        </button>
                    `}
                </div>
                <div style="padding:16px;">
                    <div style="font-size:1.05rem; color:#fff; font-weight:800; margin-bottom:15px; display:flex; align-items:center; gap:8px;">
                        ${group.isTimeChanged ? '🕐' : tabSymbol} 
                        ${fullTitle} 
                        ${group.isTimeChanged ?
                (tabId === 'publish' ? '발효시각 변경' : '해제시각 변경') :
                (group.isWaiting && tabId === 'level' ? (group.statusType + ' 예정') : displayLabelText)}
                    </div>
                    ${(() => {
                // [해제] 탭인 경우: 모든 subGroups의 해역을 하나로 합쳐서 간단히 노출
                if (tabId === 'release') {
                    const allZones = [];
                    Object.values(group.subGroups).forEach(sub => {
                        sub.zones.forEach(z => {
                            if (!allZones.includes(z)) allZones.push(z);
                        });
                    });

                    return `
                                <div style="line-height:1.6;">
                                    <div style="color:#e2e8f0;font-size:0.85rem;font-weight:600;margin-bottom:4px;">
                                        ㅇ 대상해역(${allZones.length}): <span style="font-weight:400;color:#94a3b8;">${allZones.join(', ')}</span>
                                    </div>
                                </div>
                            `;
                }

                // [발표/발효/격상] 탭인 경우: subGroups(시간별) 순회하여 출력
                const keys = Object.keys(group.subGroups).sort();
                return keys.map(k => {
                    const sub = group.subGroups[k];
                    const uniqueZones = Array.from(new Set(sub.zones));
                    const zStr = uniqueZones.join(', ');
                    const count = uniqueZones.length;

                    let subInfo = '';
                    if (tabId === 'active') {
                        const ed = typeof formatDate === 'function' ? formatDate(sub.tmYn) : sub.tmYn;
                        subInfo = `<div style="color:#94a3b8;font-size:0.85rem;margin-top:2px;">- 해제예정: <span style="color:#69f0ae;">${ed}</span></div>`;
                    } else if (tabId === 'publish') {
                        const ef = typeof formatDate === 'function' ? formatDate(sub.tmEf) : sub.tmEf;
                        subInfo = `<div style="color:#94a3b8;font-size:0.85rem;margin-top:2px;">- 발효예정: <span style="color:#fff;">${ef}</span></div>`;
                    } else if (tabId === 'level') {
                        const ed = typeof formatDate === 'function' ? formatDate(sub.tmYn) : sub.tmYn;
                        subInfo = `<div style="color:#94a3b8;font-size:0.85rem;margin-top:2px;">- 해제예정: <span style="color:#69f0ae;">${ed}</span></div>`;
                    }

                    return `
                                <div style="margin-bottom:12px; padding-bottom:12px; border-bottom:1px dashed rgba(255,255,255,0.1);">
                                    <div style="font-size:0.95rem; line-height:1.4;">
                                        <span style="color:#cbd5e1; font-weight:600;">ㅇ 대상해역(${count}):</span>
                                        <span style="color:#e2e8f0;">${zStr}</span>
                                    </div>
                                    ${subInfo}
                                </div>
                            `;
                }).join('');
            })()}
                </div>
            </div>
        `;
    });
    // [추가] 중요! 수동 발송을 위해 cardGroups 데이터를 전역에 저장 (sendManualPushFromGroup 에서 사용)
    window._currentAdminCardGroups = cardGroups;

    container.innerHTML = html;
};

// [수동 발송 핸들러]
window.sendManualPushFromGroup = async function (groupKey, tabId) {
    if (!confirm('해당 그룹의 시나리오 메시지를 정말 수동으로 발송하시겠습니까?')) return;

    // 1. 그룹 정보 조회
    const groups = window._currentAdminCardGroups;
    if (!groups || !groups[groupKey]) {
        return alert('오류: 그룹 정보를 찾을 수 없습니다. 페이지를 새로고침 해주세요.');
    }
    const group = groups[groupKey];

    // 2. 데이터 페이로드 구성 (서버에서 사용자별 필터링 후 텍스트 생성)
    // 텍스트 생성 로직(클라이언트)은 제거하고, 원본 데이터만 구조화하여 전송함.

    const typeName = group.typeName; // 예: 풍랑, 태풍
    const level = group.level || ''; // 예: 주의보, 경보

    // items 배열 생성: { zones: [], tmEf: '', tmEd: '', tmYn: '' }
    const items = Object.values(group.subGroups).map(sub => ({
        zones: sub.zones, // 배열 그대로 전송
        tmFc: group.headerTime?.replace(/[^0-9]/g, '') || '', // 발표시각
        tmEf: sub.tmEf,
        tmEd: sub.tmEd,
        tmYn: sub.tmEd // 서버 문구 생성기에서 사용하는 필드명(해제예정)으로도 전송
    }));

    // 3. 발송 요청 (Custom Push API)
    try {
        // 로딩 표시
        const btn = document.activeElement;
        const originalText = btn ? btn.innerText : '';
        if (btn) btn.innerText = '전송 중...';

        const res = await fetch('/api/push-custom', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                isManualGroupSend: true,
                payload: {
                    templateId: (tabId === 'level' && group.isWaiting) ? 'level_scheduled' : tabId, // active, release, level, publish
                    typeName: typeName,
                    level: level,
                    items: items,
                    isTimeChanged: group.isTimeChanged
                }
            })
        });

        if (res.ok) {
            alert('성공적으로 발송 요청되었습니다.');
            // UI 갱신 (해당 탭 다시 로드)
            window.switchAlertAdminTab(tabId);
        } else {
            const err = await res.text();
            alert('발송 실패: ' + err);
            if (btn) btn.innerText = originalText;
        }
    } catch (e) {
        alert('네트워크 오류: ' + e.message);
        const btn = document.activeElement;
        if (btn) btn.innerText = originalText;
    }
};

window.renderCustomPushTab = async function (container) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> 로딩 중...</div>';

    // Fetch real history
    let history = [];
    try {
        const histRes = await fetch('/api/push-history');
        if (histRes.ok) history = await histRes.json();
    } catch (e) {
        console.warn('History load fail, using empty.');
    }

    // Build regions object for accordion
    const regions = {};
    if (typeof SUB_REGION_ZONES !== 'undefined') {
        for (const [subName, zones] of Object.entries(SUB_REGION_ZONES)) {
            const mainName = typeof getMainRegion === 'function' ? getMainRegion(subName) : '기타';
            if (!regions[mainName]) regions[mainName] = {};
            regions[mainName][subName] = zones;
        }
    }

    let accordionHtml = '';
    Object.entries(regions).forEach(([main, subs], mainIdx) => {
        const isJeju = main.includes('제주');

        accordionHtml += `
            <div style="margin-bottom:10px;border:1px solid rgba(255,255,255,0.05);border-radius:10px;overflow:hidden;background:rgba(255,255,255,0.02);">
                <div style="padding:12px;background:rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:space-between;">
                    <div style="display:flex;align-items:center;gap:10px;flex:1;">
                        <input type="checkbox" class="main-region-checkbox" data-main="${mainIdx}" 
                               onchange="window.toggleMainRegionZones(${mainIdx}, this.checked)"
                               style="width:16px;height:16px;cursor:pointer;">
                        <span onclick="window.toggleAdminAccordion('main-${mainIdx}')" style="font-weight:700;color:#fff;font-size:0.95rem;cursor:pointer;flex:1;">${main}</span>
                    </div>
                    <i class="fa-solid fa-chevron-down" id="icon-main-${mainIdx}" onclick="window.toggleAdminAccordion('main-${mainIdx}')" style="font-size:0.8rem;transition:transform 0.2s;cursor:pointer;color:#94a3b8;padding:5px;"></i>
                </div>
                <div id="content-main-${mainIdx}" style="display:none;padding:10px;background:rgba(0,0,0,0.2);">
                    ${isJeju ? `
                        <!-- 제주 특화: 중분류 없이 바로 소해구 목록 -->
                        <div style="display:flex;flex-wrap:wrap;gap:8px;">
                            ${Object.values(subs)[0].map(z => `
                                <label style="display:inline-flex;align-items:center;background:rgba(255,255,255,0.05);padding:5px 10px;border-radius:6px;cursor:pointer;font-size:0.85rem;color:#cbd5e1;border:1px solid rgba(255,255,255,0.05);">
                                    <input type="checkbox" class="zone-checkbox main-group-${mainIdx}" value="${z}" style="margin-right:6px;" onchange="window.updateTargetCount()"> ${z}
                                </label>
                            `).join('')}
                        </div>
                    ` : Object.entries(subs).map(([sub, zones], subIdx) => `
                        <div style="margin-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.03);padding-bottom:10px;">
                            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                                <input type="checkbox" class="sub-region-checkbox main-group-${mainIdx}" data-sub="${mainIdx}-${subIdx}"
                                       onchange="window.toggleSubRegionZones(${mainIdx}, ${subIdx}, this.checked)"
                                       style="width:14px;height:14px;cursor:pointer;">
                                <span onclick="window.toggleAdminAccordion('sub-${mainIdx}-${subIdx}')" style="font-size:0.85rem;color:#3b82f6;font-weight:600;cursor:pointer;">${sub}</span>
                            </div>
                            <div id="content-sub-${mainIdx}-${subIdx}" style="display:flex;flex-wrap:wrap;gap:6px;padding-left:24px;">
                                ${zones.map(z => `
                                    <label style="display:inline-flex;align-items:center;background:rgba(255,255,255,0.05);padding:4px 8px;border-radius:4px;cursor:pointer;font-size:0.8rem;color:#cbd5e1;border:1px solid transparent;">
                                        <input type="checkbox" class="zone-checkbox main-group-${mainIdx} sub-group-${mainIdx}-${subIdx}" value="${z}" style="margin-right:5px;" onchange="window.updateTargetCount()"> ${z}
                                    </label>
                                `).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    });

    container.innerHTML = `
        <div style="background:rgba(255,255,255,0.03);border-radius:12px;padding:16px;margin-bottom:20px;border:1px solid rgba(255,255,255,0.08);">
            <div style="font-weight:600;color:#fff;margin-bottom:15px;font-size:1rem;display:flex;align-items:center;gap:8px;">
                <i class="fa-solid fa-envelope"></i> 커스텀 알림 발송
            </div>
            
            <div style="margin-bottom:15px;">
                <label style="display:block;color:#94a3b8;font-size:0.85rem;margin-bottom:10px;">발송 대상 해역 선택 (Hierarchy)</label>
                <div style="background:rgba(0,0,0,0.3);padding:15px;border-radius:12px;max-height:350px;overflow-y:auto;border:1px solid rgba(255,255,255,0.05);">
                    <div style="margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;gap:10px;">
                        <input type="checkbox" id="check-all-zones" onchange="window.toggleAllZones(this.checked)" 
                               style="width:18px;height:18px;cursor:pointer;">
                        <label for="check-all-zones" style="cursor:pointer;font-size:0.9rem;color:#fff;font-weight:700;">전체 해역 선택</label>
                    </div>
                    ${accordionHtml}
                </div>
            </div>

            <div style="margin-bottom:15px;">
                <label style="display:block;color:#94a3b8;font-size:0.85rem;margin-bottom:6px;">알림 제목</label>
                <input type="text" id="custom-push-title" placeholder="예: 🌊 긴급 해양 안전 안내" 
                       oninput="window.updateCustomPushPreview()"
                       style="width:100%;padding:12px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;box-sizing:border-box;outline:none;">
            </div>

            <div style="margin-bottom:15px;">
                <label style="display:block;color:#94a3b8;font-size:0.85rem;margin-bottom:6px;">알림 내용</label>
                <textarea id="custom-push-content" placeholder="직접 작성하실 알림 내용을 입력해주세요." 
                          oninput="window.updateCustomPushPreview()"
                          style="width:100%;height:100px;padding:12px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;resize:none;box-sizing:border-box;outline:none;line-height:1.4;"></textarea>
                <div style="text-align:right;font-size:0.75rem;color:#64748b;margin-top:4px;" id="custom-push-char-count">0 / 500자</div>
            </div>

            <!-- 미리보기 (Fixed Layout) -->
            <div style="background:rgba(0,0,0,0.3);padding:20px;border-radius:16px;margin-bottom:20px;border:1px solid rgba(255,255,255,0.05);">
                <div style="font-size:0.8rem;color:#94a3b8;margin-bottom:12px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Smartphone Preview</div>
                <div style="background:#fff;border-radius:20px;padding:16px;box-shadow:0 10px 25px rgba(0,0,0,0.3);position:relative;">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                        <div style="width:28px;height:28px;background:#1e293b;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:0.75rem;">🌊</div>
                        <div style="font-weight:800;color:#1e293b;font-size:0.95rem;flex:1;">SEA:GNAL</div>
                        <div style="font-size:0.75rem;color:#94a3b8;">지금</div>
                    </div>
                    <div id="preview-title" style="font-weight:800;margin-bottom:4px;color:#000;font-size:1.05rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">(제목 미리보기)</div>
                    <div id="preview-content" style="color:#475569;font-size:1rem;line-height:1.4;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;">(내용 미리보기)</div>
                </div>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;">
                <div style="font-size:0.95rem;color:#cbd5e1;">발송 대상: <span style="font-weight:800;color:#3b82f6;" id="target-zone-count">0</span>개 구역</div>
                <div style="display:flex;gap:12px;">
                    <button onclick="window.switchAlertAdminTab('custom')" style="padding:12px 20px;background:rgba(255,255,255,0.08);border:none;border-radius:10px;color:#cbd5e1;cursor:pointer;font-weight:600;">초기화</button>
                    <button onclick="window.confirmCustomPush()" style="padding:12px 28px;background:linear-gradient(135deg,#ef4444,#b91c1c);border:none;border-radius:10px;color:#fff;font-weight:700;cursor:pointer;box-shadow:0 10px 20px rgba(239,68,68,0.3);">푸시 발송하기</button>
                </div>
            </div>
            
            <!-- Custom Confirm Overlay -->
            <div id="custom-push-confirm-overlay" style="display:none;position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:100;border-radius:16px;backdrop-filter:blur(8px);align-items:center;justify-content:center;padding:20px;">
                <div style="background:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:30px;width:100%;max-width:320px;text-align:center;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);">
                    <div style="font-size:3rem;margin-bottom:20px;">📢</div>
                    <div style="color:#fff;font-size:1.2rem;font-weight:700;margin-bottom:12px;">푸시 발송 최종 확인</div>
                    <div style="color:#94a3b8;font-size:0.9rem;line-height:1.6;margin-bottom:25px;">
                        정말 <span id="confirm-target-text" style="color:#3b82f6;font-weight:700;"></span>으로<br>알림을 발송하시겠습니까?
                    </div>
                    <div style="display:flex;gap:10px;">
                        <button onclick="document.getElementById('custom-push-confirm-overlay').style.display='none'" style="flex:1;padding:12px;background:rgba(255,255,255,0.05);border:none;border-radius:10px;color:#cbd5e1;cursor:pointer;font-weight:600;">취소</button>
                        <button id="final-send-btn" onclick="window.executeCustomPush()" style="flex:1;padding:12px;background:#ef4444;border:none;border-radius:10px;color:#fff;cursor:pointer;font-weight:700;">지금 발송</button>
                    </div>
                </div>
            </div>
        </div>
    `;
};

// [History State]
let historyFilter = { cat: 'all', type: 'all' };

window.renderHistoryTab = async function (container) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> 로딩 중...</div>';

    try {
        const histRes = await fetch('/api/push-history');
        const history = histRes.ok ? await histRes.json() : [];

        // Apply Filters
        const filtered = history.filter(h => {
            const catMatch = historyFilter.cat === 'all' || h.tab === historyFilter.cat;
            const typeMatch = historyFilter.type === 'all' || h.type === historyFilter.type;
            return catMatch && typeMatch;
        });

        const categories = [
            { id: 'all', name: '전체' },
            { id: 'publish', name: '발표' },
            { id: 'active', name: '발효' },
            { id: 'release', name: '해제' },
            { id: 'level', name: '격상/격하' },
            { id: 'custom', name: '직접 발송' }
        ];

        let html = `
            <div style="margin-bottom:20px;">
                <!-- Level 1: Category Filter -->
                <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:12px;margin-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.05);">
                    ${categories.map(c => `
                        <button onclick="window.updateHistoryFilter('cat', '${c.id}')" 
                                style="padding:6px 12px;border:none;border-radius:20px;background:${historyFilter.cat === c.id ? '#ef4444' : 'rgba(255,255,255,0.05)'};color:${historyFilter.cat === c.id ? '#fff' : '#94a3b8'};font-size:0.8rem;white-space:nowrap;cursor:pointer;font-weight:600;">
                            ${c.name}
                        </button>
                    `).join('')}
                </div>

                <!-- Level 2: Type Filter (Auto/Manual) -->
                ${historyFilter.cat !== 'custom' ? `
                    <div style="display:flex;gap:10px;margin-bottom:20px;padding-left:4px;">
                        ${['all', 'auto', 'manual'].map(t => `
                            <label style="display:flex;align-items:center;gap:6px;color:${historyFilter.type === t ? '#fff' : '#64748b'};font-size:0.85rem;cursor:pointer;font-weight:600;">
                                <input type="radio" name="hist-type" value="${t}" ${historyFilter.type === t ? 'checked' : ''} 
                                       onchange="window.updateHistoryFilter('type', '${t}')"
                                       style="width:14px;height:14px;cursor:pointer;"> 
                                ${t === 'all' ? '전체' : (t === 'auto' ? '자동' : '수동')}
                            </label>
                        `).join('')}
                    </div>
                ` : ''}

                <!-- Management Controls -->
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;padding:0 6px;">
                    <div style="display:flex;gap:12px;align-items:center;">
                        <input type="checkbox" id="hist-check-all" onchange="window.toggleAllHistoryChecks(this.checked)" style="width:16px;height:16px;cursor:pointer;">
                        <label for="hist-check-all" style="color:#94a3b8;font-size:0.85rem;cursor:pointer;">전체 선택</label>
                    </div>
                    <button onclick="window.deleteSelectedHistory()" style="padding:6px 12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);color:#ef4444;border-radius:6px;font-size:0.8rem;cursor:pointer;font-weight:600;">선택 삭제</button>
                </div>

                <!-- History List -->
                <div id="history-items-container">
                    ${filtered.map(h => `
                        <div style="background:rgba(255,255,255,0.03);border-radius:12px;padding:14px;margin-bottom:12px;border:1px solid rgba(255,255,255,0.05);position:relative;">
                            <div style="position:absolute;top:14px;left:14px;">
                                <input type="checkbox" class="hist-item-check" data-id="${h.id}" style="width:15px;height:15px;cursor:pointer;">
                            </div>
                            <div style="margin-left:30px;">
                                <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                                    <span style="color:#64748b;font-size:0.75rem;">${h.time}</span>
                                    <div style="display:flex;gap:6px;">
                                        <span style="padding:2px 8px;border-radius:4px;font-size:0.7rem;font-weight:700;background:${h.type === 'manual' ? 'rgba(59,130,246,0.1)' : 'rgba(34,197,94,0.1)'};color:${h.type === 'manual' ? '#3b82f6' : '#22c55e'};">
                                            ${h.type === 'manual' ? '👤 수동' : '🤖 자동'}
                                        </span>
                                        <button onclick="window.deleteSingleHistory(${h.id})" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:0.8rem;"><i class="fa-solid fa-trash-can"></i></button>
                                    </div>
                                </div>
                                <div style="color:#fff;font-weight:700;margin-bottom:4px;font-size:0.95rem;">${h.title}</div>
                                <div style="color:#94a3b8;font-size:0.85rem;line-height:1.4;margin-bottom:8px;">${h.content}</div>
                                <div style="font-size:0.7rem;color:#475569;background:rgba(0,0,0,0.2);padding:6px 10px;border-radius:6px;">
                                    <i class="fa-solid fa-location-dot" style="margin-right:4px;"></i> 대상: ${h.target.length > 50 ? h.target.substring(0, 50) + '...' : h.target}
                                </div>
                            </div>
                        </div>
                    `).join('')}
                    ${filtered.length === 0 ? '<div style="text-align:center;padding:50px;color:#64748b;">이력이 없습니다.</div>' : ''}
                </div>
                
                ${history.length > 0 ? `
                    <div style="text-align:center;margin-top:20px;">
                        <button onclick="window.clearAllHistory()" style="background:none;border:none;color:#64748b;font-size:0.8rem;text-decoration:underline;cursor:pointer;">전체 이력 초기화</button>
                    </div>
                ` : ''}
            </div>
        `;
        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = `<div style="text-align:center;padding:40px;color:#ef4444;">오류 발생: ${e.message}</div>`;
    }
};

window.updateHistoryFilter = function (key, val) {
    historyFilter[key] = val;
    // If category is custom, type must be manual/all (but custom is always manual)
    if (historyFilter.cat === 'custom') historyFilter.type = 'all';

    // [Fix] 통합 관리자 센터 대응: 두 가지 가능한 ID를 모두 체크
    const container = document.getElementById('alert-admin-inner-content') || document.getElementById('alert-management-content');
    if (container) window.renderHistoryTab(container);
};

window.toggleAllHistoryChecks = function (checked) {
    document.querySelectorAll('.hist-item-check').forEach(cb => cb.checked = checked);
};

window.deleteSingleHistory = async function (id) {
    if (!confirm('해당 이력을 삭제하시겠습니까?')) return;
    try {
        const res = await fetch(`/api/push-history/${id}`, { method: 'DELETE' });
        if (res.ok) {
            const container = document.getElementById('alert-admin-inner-content') || document.getElementById('alert-management-content');
            if (container) window.renderHistoryTab(container);
        }
    } catch (e) { alert('삭제 실패: ' + e.message); }
};

window.deleteSelectedHistory = async function () {
    const checked = Array.from(document.querySelectorAll('.hist-item-check:checked')).map(cb => parseInt(cb.dataset.id));
    if (checked.length === 0) return alert('삭제할 항목을 선택해주세요.');
    if (!confirm(`${checked.length}개의 항목을 삭제하시겠습니까?`)) return;

    try {
        const res = await fetch('/api/push-history', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: checked })
        });
        if (res.ok) {
            const container = document.getElementById('alert-admin-inner-content') || document.getElementById('alert-management-content');
            if (container) window.renderHistoryTab(container);
        }
    } catch (e) { alert('삭제 실패: ' + e.message); }
};

window.clearAllHistory = async function () {
    if (!confirm('정말로 모든 발송 이력을 영구적으로 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) return;
    try {
        const res = await fetch('/api/push-history', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
        if (res.ok) {
            const container = document.getElementById('alert-admin-inner-content') || document.getElementById('alert-management-content');
            if (container) window.renderHistoryTab(container);
        }
    } catch (e) { alert('삭제 실패: ' + e.message); }
};

window.toggleMainRegionZones = function (mainIdx, checked) {
    document.querySelectorAll(`.main-group-${mainIdx}`).forEach(cb => {
        cb.checked = checked;
    });
    window.updateTargetCount();
};

window.toggleSubRegionZones = function (mainIdx, subIdx, checked) {
    document.querySelectorAll(`.sub-group-${mainIdx}-${subIdx}`).forEach(cb => {
        cb.checked = checked;
    });
    window.updateTargetCount();
};

window.toggleAdminAccordion = function (id) {
    const content = document.getElementById('content-' + id);
    const icon = document.getElementById('icon-' + id);
    if (!content) return;

    const isHidden = content.style.display === 'none';
    content.style.display = isHidden ? 'block' : 'none';
    if (icon) {
        if (id.startsWith('main')) {
            icon.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
        } else {
            icon.className = isHidden ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-right';
        }
    }
};

window.toggleAllZones = function (checked) {
    document.querySelectorAll('.zone-checkbox, .main-region-checkbox, .sub-region-checkbox').forEach(cb => {
        cb.checked = checked;
    });
    window.updateTargetCount();
};

window.updateTargetCount = function () {
    const checked = document.querySelectorAll('.zone-checkbox:checked');
    const targetCountEl = document.getElementById('target-zone-count');
    if (targetCountEl) targetCountEl.textContent = checked.length;
};

window.updateCustomPushPreview = function () {
    const titleVal = document.getElementById('custom-push-title').value;
    const contentVal = document.getElementById('custom-push-content').value;

    const previewTitle = document.getElementById('preview-title');
    const previewContent = document.getElementById('preview-content');
    const charCount = document.getElementById('custom-push-char-count');

    if (previewTitle) previewTitle.textContent = titleVal || '(제목 미리보기)';
    if (previewContent) previewContent.textContent = contentVal || '(내용 미리보기)';
    if (charCount) charCount.textContent = `${contentVal.length} / 500자`;
};

window.confirmCustomPush = function () {
    const title = document.getElementById('custom-push-title').value.trim();
    const content = document.getElementById('custom-push-content').value.trim();
    const checked = document.querySelectorAll('.zone-checkbox:checked');
    const allChecked = document.getElementById('check-all-zones').checked;

    if (checked.length === 0 && !allChecked) {
        alert('발송 대상 해역을 선택해주세요.');
        return;
    }
    if (!title || !content) {
        alert('제목과 내용을 입력해주세요.');
        return;
    }

    const targetText = allChecked ? '전체 해역' : `${checked.length}개 해역`;
    document.getElementById('confirm-target-text').textContent = targetText;
    document.getElementById('custom-push-confirm-overlay').style.display = 'flex';
};

window.executeCustomPush = async function () {
    const title = document.getElementById('custom-push-title').value.trim();
    const content = document.getElementById('custom-push-content').value.trim();
    const checked = document.querySelectorAll('.zone-checkbox:checked');
    const allChecked = document.getElementById('check-all-zones').checked;
    const targetZones = allChecked ? '전체 해역' : Array.from(checked).map(cb => cb.value).join(', ');

    const btn = document.getElementById('final-send-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 발송 중...';

    try {
        const response = await fetch('/api/push-custom', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, content, targetZones })
        });
        const result = await response.json();

        if (result.success) {
            alert(`✅ 푸시 발송 완료\n성공: ${result.successCount}건 / 실패: ${result.failCount}건`);
            window.switchAlertAdminTab('custom');
        } else {
            alert('❌ 발송 실패: ' + (result.error || '알 수 없는 오류'));
            document.getElementById('custom-push-confirm-overlay').style.display = 'none';
        }
    } catch (e) {
        alert('❌ 서버 통신 오류: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = '지금 발송';
    }
};

// (Redundant declarations removed)


// ============================================================================
// [�ű�] �湮�� ī���� UI ������Ʈ
// ============================================================================
window.updateVisitorStats = async function () {
    try {
        // [수정] 세션당 1회만 카운트를 증가시키도록 로직 개선
        const hasVisited = sessionStorage.getItem('v1_visited');
        const url = hasVisited ? '/api/visit?inc=false' : '/api/visit';

        const response = await fetch(url);
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();

        // 처음 방문(카운트 증가)인 경우 세션에 기록
        if (!hasVisited) {
            sessionStorage.setItem('v1_visited', 'true');
        }

        const todayEl = document.getElementById('today-count');
        const totalEl = document.getElementById('total-count');

        if (todayEl) todayEl.textContent = data.today.toLocaleString();
        if (totalEl) totalEl.textContent = data.total.toLocaleString();
    } catch (e) {
        console.error('Failed to update visitor stats:', e);
    }
};

// [Final Cleanup] 헤더 로고의 좀비 리스너 제거 및 관리자 트리거 방지
document.addEventListener('DOMContentLoaded', () => {
    const headerContent = document.querySelector('.header-content');
    if (headerContent) {
        // 기존 리스너(addEventListener로 추가된 것들) 제거를 위해 복제 후 교체
        const newHeader = headerContent.cloneNode(true);
        headerContent.parentNode.replaceChild(newHeader, headerContent);

        // 새로 교체된 헤더에 호버 힌트만 추가 (관리자 연타 안내 제거)
        newHeader.setAttribute('title', '전체 데이터 새로고침');
    }
});

// 헤더 클릭 시 데이터 새로고침
window.handleHeaderRefresh = function () {
    console.log('🔄 헤더 클릭: 전체 데이터 새로고침');
    fetchAllData();
    if (typeof renderMarineWeatherStatus === 'function') renderMarineWeatherStatus();
};

/**
 * [추가] 기상청 링크 클릭 핸들러 (모바일 앱 대응)
 * 앱 환경이면 팝업창으로, 웹이면 새 창으로 열기
 */
window.handleKmaLinkClick = function (event, url, title) {
    // 모바일 네이티브 플랫폼(Android 등)인지 확인
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        event.preventDefault(); // 기본 링크 이동 방지
        window.openKmaIframeModal(url, title);
        return false;
    }
    return true; // 일반 웹 브라우저는 target="_blank"로 열림
};

/**
 * 기상청 전용 아이프레임 모달 열기
 */
window.openKmaIframeModal = function (url, title) {
    // 기존 모달 제거
    const existing = document.getElementById('kma-iframe-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'kma-iframe-modal';
    modal.className = 'kma-iframe-modal';
    modal.innerHTML = `
        <div class="kma-iframe-overlay" onclick="window.closeKmaIframeModal()"></div>
        <div class="kma-iframe-content">
            <div class="kma-iframe-header">
                <h3><i class="fa-solid fa-cloud-sun"></i> ${title} - 기상청</h3>
                <button class="kma-iframe-close" onclick="window.closeKmaIframeModal()">✕</button>
            </div>
            <div class="kma-iframe-body">
                <iframe src="${url}" frameborder="0" allowfullscreen></iframe>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden'; // 배경 스크롤 방지
};

/**
 * 기상청 아이프레임 모달 닫기
 */
window.closeKmaIframeModal = function () {
    const modal = document.getElementById('kma-iframe-modal');
    if (modal) {
        modal.classList.add('fade-out'); // 애니메이션 위해 클래스 추가 (선택사항)
        setTimeout(() => {
            modal.remove();
            document.body.style.overflow = '';
        }, 150);
    }
};

/**
 * SEAGNAL 커스텀 시스템 모달 (Alert 대체용)
 */
window.showSeagnalModal = function (title, message, type = 'info') {
    // 기존 모달 제거
    const existing = document.getElementById('seagnal-custom-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'seagnal-custom-modal';
    modal.className = 'seagnal-modal';

    const icon = type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-info';
    const iconClass = type === 'error' ? 'error' : '';

    modal.innerHTML = `
        <div class="seagnal-modal-overlay" onclick="window.closeSeagnalModal()"></div>
        <div class="seagnal-modal-content">
            <div class="seagnal-modal-icon ${iconClass}">
                <i class="fa-solid ${icon}"></i>
            </div>
            <div class="seagnal-modal-title">${title}</div>
            <div class="seagnal-modal-message">${message.replace(/\n/g, '<br>')}</div>
            <button class="seagnal-modal-btn" onclick="window.closeSeagnalModal()">확인</button>
        </div>
    `;

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';
};

window.closeSeagnalModal = function () {
    const modal = document.getElementById('seagnal-custom-modal');
    if (modal) {
        modal.classList.add('fade-out');
        setTimeout(() => {
            modal.remove();
            document.body.style.overflow = '';
        }, 200);
    }
};

