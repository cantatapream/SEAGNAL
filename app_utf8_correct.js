// Configuration
const CONFIG = {
    KMA_HUB_KEY: 'ZKEQU5ukRvGhEFObpBbxVw',

    // API ?붾뱶?ъ씤??(濡쒖뺄 ?쒕쾭)
    API_BASE: '',  // 濡쒖뺄 ?쒕쾭 湲곗? ?곷? 寃쎈줈 (鍮?臾몄옄??
    KMA_API_URL: 'api/warnings', // warnings.json (KMA + AFSO)
    BUOY_API_URL: 'api/buoys',   // buoys.json
    NOTICE_API_URL: 'api/notice', // notice.json

    // CORS ?꾨줉???ㅼ젙 - 濡쒖뺄 ?쒕쾭 ?ъ슜?쇰줈 遺덊븘??
    USE_CORS_PROXY: false,
    CORS_PROXIES: [],
    CORS_PROXY: '',
    CORS_TIMEOUT: 5000,

    // ?뚯뒪??紐⑤뱶 - true濡??ㅼ젙?섎㈃ Mock ?곗씠???ъ슜
    USE_MOCK_DATA: false
};

// ============================================================================
// ?щ씪?대뱶 ?좊땲硫붿씠???⑥닔
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
 * 遺???꾩튂瑜??닿뎄蹂?湲곗긽 吏?꾩뿉???쒖떆
 */
async function showBuoyLocationOnMap(buoyId) {
    // 遺??醫뚰몴 媛?몄삤湲?
    if (typeof BUOY_LOCATIONS === 'undefined' || !BUOY_LOCATIONS[buoyId]) {
        alert('遺???꾩튂 ?뺣낫瑜?李얠쓣 ???놁뒿?덈떎.');
        return;
    }

    const buoyInfo = BUOY_LOCATIONS[buoyId];
    const lon = buoyInfo.lon;
    const lat = buoyInfo.lat;

    console.log(`?뱧 遺??${buoyInfo.name} ?꾩튂: 寃쎈룄 ${lon}, ?꾨룄 ${lat}`);

    // GPS ???쎌? 醫뚰몴 蹂??
    if (typeof gpsToPixel !== 'function') {
        alert('醫뚰몴 蹂???⑥닔瑜??ъ슜?????놁뒿?덈떎.');
        return;
    }

    const pixel = gpsToPixel(lon, lat);
    console.log(`?뱧 ?쎌? 醫뚰몴: X=${pixel.x}, Y=${pixel.y}`);

    // ?닿뎄蹂?湲곗긽 ??쑝濡??꾪솚
    const seaZoneTab = document.querySelector('[data-target="sea-zone-section"]');
    if (seaZoneTab) {
        seaZoneTab.click();
    }

    // ???꾪솚 ?湲?
    await new Promise(r => setTimeout(r, 300));

    // 狩?吏?꾧? 珥덇린?붾릺吏 ?딆븯?쇰㈃ 珥덇린?????湲?
    if (typeof window.initSeaZoneMap === 'function' && !document.getElementById('map-wrapper')) {
        console.log('?뱧 吏??珥덇린??以?..');
        window.initSeaZoneMap();
        // ?대?吏 濡쒕뱶 ?湲?(理쒕? 2珥?
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 100));
            if (document.getElementById('map-wrapper')?.style.opacity === '1') break;
        }
    }

    // 異붽? ?湲?(吏???뚮뜑留??꾨즺)
    await new Promise(r => setTimeout(r, 200));

    // 狩?遺?쒕윭???좊땲硫붿씠?섏쑝濡?以?諛??대룞
    if (typeof zoomToPixelWithMarkerAnimated === 'function') {
        zoomToPixelWithMarkerAnimated(pixel.x, pixel.y, 4.5, buoyId, buoyInfo.name);
    } else if (typeof zoomToPixelWithMarker === 'function') {
        // 湲곗〈 諛⑹떇 (?좊땲硫붿씠???놁씠)
        zoomToPixelWithMarker(pixel.x, pixel.y, false, 4.5);
        // 遺???꾩씠肄섏뿉 ?뚮? 湲濡쒖슦 ?④낵 ?쒖떆
        setTimeout(() => {
            showBlinkingMarker(pixel.x, pixel.y, buoyInfo.name, buoyId);
        }, 500);
    }
}

/**
 * 遺???꾩씠肄?二쇰????뚮? 湲濡쒖슦 ?④낵 (?꾩뿭 蹂???곹깭 愿由?
 */
function showBlinkingMarker(pixelX, pixelY, name, buoyId) {
    // CSS ?좊땲硫붿씠???ㅽ???異붽?
    if (!document.getElementById('buoy-highlight-style')) {
        const style = document.createElement('style');
        style.id = 'buoy-highlight-style';
        style.textContent = `
            .buoy-marker.highlighted {
                z-index: 2000 !important; /* ??긽 留???*/
                animation: buoyBounce 1s ease-in-out infinite; /* 肄⑹쉘 ?곕뒗 ?④낵 */
            }

            @keyframes buoyBounce {
                0%, 100% { 
                    transform: translate(-50%, -100%) scale(1); 
                }
                50% { 
                    transform: translate(-50%, -100%) scale(1.6); /* 1.6諛??뺣? */
                }
            }
        `;
        document.head.appendChild(style);
    }

    // ?꾩뿭 ?곹깭 ?ㅼ젙
    window.highlightedBuoyId = buoyId;
    console.log(`?뱧 遺???섏씠?쇱씠???ㅼ젙: ${buoyId}`);

    // 利됱떆 ?낅뜲?댄듃?섏뿬 ?대옒???곸슜
    if (typeof updateBuoyVisibility === 'function') {
        updateBuoyVisibility();
    }

    // 5珥????섏씠?쇱씠???쒓굅
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
// ?밸낫援ъ뿭蹂??덈뵒 URL 留ㅽ븨
// ============================================================================
// 遺??SVG ?꾩씠肄?(seaZones.js? ?숈씪???붿옄?? ?몃씪?몄슜)
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
    // ?쒖＜??(7媛?
    '?쒖＜?꾩꽌遺?욌컮??: 'https://www.windy.com/?33.290,126.080,10',
    '?쒖＜?꾨턿遺?욌컮??: 'https://www.windy.com/?33.630,126.480,10',
    '?쒖＜?꾨룞遺?욌컮??: 'https://www.windy.com/?33.520,127.020,10',
    '?쒖＜?꾨궓遺?욌컮??: 'https://www.windy.com/?33.180,126.580,10',
    '?쒖＜?꾨궓?쒖そ?덉そ癒쇰컮??: 'https://www.windy.com/?32.960,125.600,8',
    '?쒖＜?꾨궓?숈そ?덉そ癒쇰컮??: 'https://www.windy.com/?32.750,127.050,8',
    '?쒖＜?꾨궓履쎈컮源λ㉫諛붾떎': 'https://www.windy.com/?31.570,125.210,8',

    // ?쒗빐以묐? (6媛?
    '?몄쿇쨌寃쎄린遺곷??욌컮??: 'https://www.windy.com/?37.830,125.540,10',
    '?몄쿇쨌寃쎄린?⑤??욌컮??: 'https://www.windy.com/?37.350,125.970,10',
    '異⑸궓遺곷??욌컮??: 'https://www.windy.com/?36.730,126.050,10',
    '異⑸궓?⑤??욌컮??: 'https://www.windy.com/?36.200,126.370,10',
    '?쒗빐以묐??덉そ癒쇰컮??: 'https://www.windy.com/?36.880,125.240,8',
    '?쒗빐以묐?諛붽묑癒쇰컮??: 'https://www.windy.com/?36.910,123.750,8',

    // ?쒗빐?⑤? (9媛?
    '?쒗빐?⑤?遺곸そ諛붽묑癒쇰컮??: 'https://www.windy.com/?35.810,123.690,8',
    '?쒗빐?⑤?遺곸そ?덉そ癒쇰컮??: 'https://www.windy.com/?35.700,125.270,8',
    '?꾨턿遺곷??욌컮??: 'https://www.windy.com/?36.030,126.480,10',
    '?꾨턿?⑤??욌컮??: 'https://www.windy.com/?35.760,126.340,10',
    '?꾨궓遺곷??쒗빐?욌컮??: 'https://www.windy.com/?35.500,126.200,10',
    '?꾨궓以묐??쒗빐?욌컮??: 'https://www.windy.com/?35.040,126.070,10',
    '?쒗빐?⑤??⑥そ諛붽묑癒쇰컮??: 'https://www.windy.com/?33.950,123.560,8',
    '?쒗빐?⑤??⑥そ?덉そ癒쇰컮??: 'https://www.windy.com/?34.560,125.110,8',
    '?꾨궓?⑤??쒗빐?욌컮??: 'https://www.windy.com/?34.870,126.250,10',

    // ?⑦빐?쒕? (4媛?
    '?⑦빐?쒕??쒖そ癒쇰컮??: 'https://www.windy.com/?34.080,126.250,8',
    '?꾨궓?쒕??⑦빐?욌컮??: 'https://www.windy.com/?34.300,126.760,10',
    '?꾨궓?숇??⑦빐?욌컮??: 'https://www.windy.com/?34.500,127.460,10',
    '?⑦빐?쒕??숈そ癒쇰컮??: 'https://www.windy.com/?34.300,127.580,8',

    // ?⑦빐?숇? (7媛?
    '?⑦빐?숇??덉そ癒쇰컮??: 'https://www.windy.com/?34.080,128.900,8',
    '寃쎈궓?쒕??⑦빐?욌컮??: 'https://www.windy.com/?34.580,128.170,10',
    '嫄곗젣?쒕룞遺?욌컮??: 'https://www.windy.com/?35.000,128.700,10',
    '寃쎈궓以묐??⑦빐?욌컮??: 'https://www.windy.com/?35.100,128.580,10',
    '遺?곗븵諛붾떎': 'https://www.windy.com/?35.100,129.080,10',
    '?몄궛?욌컮??: 'https://www.windy.com/?35.780,129.460,10',
    '?⑦빐?숇?諛붽묑癒쇰컮??: 'https://www.windy.com/?33.200,130.540,8',

    // ?숉빐?⑤? (6媛?
    '?숉빐?⑤??⑥そ?덉そ癒쇰컮??: 'https://www.windy.com/?35.410,130.250,8',
    '?숉빐?⑤??⑥そ諛붽묑癒쇰컮??: 'https://www.windy.com/?34.500,131.270,8',
    '寃쎈턿?⑤??욌컮??: 'https://www.windy.com/?36.000,129.620,10',
    '寃쎈턿遺곷??욌컮??: 'https://www.windy.com/?36.750,129.520,10',
    '?숉빐?⑤?遺곸そ?덉そ癒쇰컮??: 'https://www.windy.com/?36.160,130.410,8',
    '?숉빐?⑤?遺곸そ諛붽묑癒쇰컮??: 'https://www.windy.com/?36.140,131.570,8',

    // ?숉빐以묐? (5媛?
    '媛뺤썝?⑤??욌컮??: 'https://www.windy.com/?37.390,129.360,10',
    '媛뺤썝以묐??욌컮??: 'https://www.windy.com/?37.790,129.070,10',
    '媛뺤썝遺곷??욌컮??: 'https://www.windy.com/?38.360,128.660,10',
    '?숉빐以묐??덉そ癒쇰컮??: 'https://www.windy.com/?37.960,129.870,8',
    '?숉빐以묐?諛붽묑癒쇰컮??: 'https://www.windy.com/?38.080,131.340,8'
};

// WINDY_URL_MAPPING?먯꽌 ?뚰빐援щ퀎 醫뚰몴 ?먮룞 異붿텧
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

// Windy ?꾨쿋??URL ?앹꽦 ?⑥닔
function getWindyEmbedUrl(zoneName) {
    const url = WINDY_URL_MAPPING[zoneName];
    if (!url) return null;

    // URL?먯꽌 醫뚰몴? 以?異붿텧: https://www.windy.com/?lat,lon,zoom
    const match = url.match(/\?(\d+\.?\d*),(\d+\.?\d*),(\d+)/);
    if (!match) return null;

    const [, lat, lon, zoom] = match;
    return `https://embed.windy.com/embed2.html?lat=${lat}&lon=${lon}&zoom=${zoom}&level=surface&overlay=wind&product=ecmwf&menu=&message=true&marker=&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=m%2Fs&metricTemp=%C2%B0C&radarRange=-1`;
}
// ----------------------------------------------------------------------------
// Constants & Mappings
// ----------------------------------------------------------------------------

// ?댁뿭 遺꾨쪟 ?ㅼ썙??(湲곗〈 ?명솚??- ?遺꾨쪟 留ㅼ묶)
const ZONE_CLASSIFICATION = {
    '?숉빐': [
        '?숉빐', '?몃쫱??, '?낅룄',
        '媛뺤썝遺곷?', '媛뺤썝以묐?', '媛뺤썝?⑤?',  // 媛뺤썝 ?욌컮??
        '寃쎈턿遺곷?', '寃쎈턿?⑤?',  // 寃쎈턿 ?욌컮??
        '?몄궛'  // ?몄궛?욌컮??
    ],
    '?쒗빐': [
        '?쒗빐',
        '?몄쿇', '寃쎄린',  // ?몄쿇쨌寃쎄린 ?욌컮??
        '異⑸궓',  // 異⑸궓遺곷?/?⑤??욌컮??
        '?꾨턿',  // ?꾨턿遺곷?/?⑤??욌컮??
        '?꾨궓遺곷??쒗빐', '?꾨궓以묐??쒗빐', '?꾨궓?⑤??쒗빐'  // ?꾨궓 ?쒗빐履?
    ],
    '?⑦빐': [
        '?⑦빐',
        '遺??, '嫄곗젣', '寃쎈궓',  // 遺?? 嫄곗젣, 寃쎈궓 ?욌컮??
        '?꾨궓?쒕??⑦빐', '?꾨궓?숇??⑦빐'  // ?꾨궓 ?⑦빐履?
    ],
    '?쒖＜': [
        '?쒖＜', '異붿옄??, '留덈씪??, '媛?뚮룄', '?곕룄'
    ]
};

// ============================================================================
// 2?④퀎 ?댁뿭 遺꾨쪟 泥닿퀎 (?遺꾨쪟 ??以묐텇瑜????댁뿭)
// ============================================================================

// ?遺꾨쪟 ??以묐텇瑜?留ㅽ븨
const SEA_REGIONS = {
    '?숉빐': {
        subRegions: ['?숉빐?⑤??댁긽', '?숉빐以묐??댁긽'],
        icon: '?똿',
        english: 'East Sea'
    },
    '?쒗빐': {
        subRegions: ['?쒗빐以묐??댁긽', '?쒗빐?⑤??댁긽'],
        icon: '?뙄',
        english: 'West Sea'
    },
    '?⑦빐': {
        subRegions: ['?⑦빐?숇??댁긽', '?⑦빐?쒕??댁긽'],
        icon: '?룚截?,
        english: 'South Sea'
    },
    '?쒖＜': {
        subRegions: ['?쒖＜?댁뿭'],
        icon: '<img src="assets/dolhareubang_medium.png" style="width: 24px; vertical-align: bottom; margin-right: 2px;">',
        english: 'Jeju Sea',
        displayName: '?쒖＜?댁뿭'
    }
};

// 以묐텇瑜????댁뿭 紐⑸줉 (硫붿씤 ?댁뿭留? ?곗븞諛붾떎/?됱닔援ъ뿭 ?쒖쇅)
const SUB_REGION_ZONES = {
    '?숉빐?⑤??댁긽': [
        '?몄궛?욌컮??,
        '寃쎈턿?⑤??욌컮??,
        '寃쎈턿遺곷??욌컮??,
        '?숉빐?⑤??⑥そ?덉そ癒쇰컮??,
        '?숉빐?⑤??⑥そ諛붽묑癒쇰컮??,
        '?숉빐?⑤?遺곸そ?덉そ癒쇰컮??,
        '?숉빐?⑤?遺곸そ諛붽묑癒쇰컮??
    ],
    '?숉빐以묐??댁긽': [
        '媛뺤썝遺곷??욌컮??,
        '媛뺤썝以묐??욌컮??,
        '媛뺤썝?⑤??욌컮??,
        '?숉빐以묐??덉そ癒쇰컮??,
        '?숉빐以묐?諛붽묑癒쇰컮??
    ],
    '?쒗빐以묐??댁긽': [
        '?몄쿇쨌寃쎄린遺곷??욌컮??,
        '?몄쿇쨌寃쎄린?⑤??욌컮??,
        '異⑸궓遺곷??욌컮??,
        '異⑸궓?⑤??욌컮??,
        '?쒗빐以묐??덉そ癒쇰컮??,
        '?쒗빐以묐?諛붽묑癒쇰컮??
    ],
    '?쒗빐?⑤??댁긽': [
        '?꾨턿遺곷??욌컮??,
        '?꾨턿?⑤??욌컮??,
        '?꾨궓遺곷??쒗빐?욌컮??,
        '?꾨궓以묐??쒗빐?욌컮??,
        '?꾨궓?⑤??쒗빐?욌컮??,
        '?쒗빐?⑤?遺곸そ?덉そ癒쇰컮??,
        '?쒗빐?⑤?遺곸そ諛붽묑癒쇰컮??,
        '?쒗빐?⑤??⑥そ?덉そ癒쇰컮??,
        '?쒗빐?⑤??⑥そ諛붽묑癒쇰컮??
    ],
    '?⑦빐?숇??댁긽': [
        '遺?곗븵諛붾떎',
        '寃쎈궓?쒕??⑦빐?욌컮??,
        '寃쎈궓以묐??⑦빐?욌컮??,
        '嫄곗젣?쒕룞遺?욌컮??,
        '?⑦빐?숇??덉そ癒쇰컮??,
        '?⑦빐?숇?諛붽묑癒쇰컮??
    ],
    '?⑦빐?쒕??댁긽': [
        '?꾨궓?쒕??⑦빐?욌컮??,
        '?꾨궓?숇??⑦빐?욌컮??,
        '?⑦빐?쒕??쒖そ癒쇰컮??,
        '?⑦빐?쒕??숈そ癒쇰컮??
    ],
    '?쒖＜?댁뿭': [
        '?쒖＜?꾨턿遺?욌컮??,
        '?쒖＜?꾨궓遺?욌컮??,
        '?쒖＜?꾨룞遺?욌컮??,
        '?쒖＜?꾩꽌遺?욌컮??,
        '?쒖＜?꾨궓?쒖そ?덉そ癒쇰컮??,
        '?쒖＜?꾨궓?숈そ?덉そ癒쇰컮??,
        '?쒖＜?꾨궓履쎈컮源λ㉫諛붾떎'
    ]
};

// ?밸낫 援ъ뿭紐???以묐텇瑜?李얘린
function getSubRegion(zoneName) {
    if (!zoneName) return null;

    // ?곗븞諛붾떎/?됱닔援ъ뿭? ?곸쐞 ?댁뿭?쇰줈 泥섎━ (以??욌?遺꾨쭔 異붿텧)
    const cleanName = zoneName.replace(/以?*(?곗븞諛붾떎|?됱닔援ъ뿭).*$/, '');

    for (const [subRegion, zones] of Object.entries(SUB_REGION_ZONES)) {
        if (zones.some(zone => cleanName.includes(zone) || zone.includes(cleanName) || cleanName === zone)) {
            return subRegion;
        }
    }

    // ?ㅼ썙??湲곕컲 ?대갚 留ㅼ묶
    if (zoneName.includes('?몄궛') || zoneName.includes('寃쎈턿') ||
        (zoneName.includes('?숉빐') && (zoneName.includes('?⑤?') || zoneName.includes('?⑥そ')))) {
        return '?숉빐?⑤??댁긽';
    }
    if (zoneName.includes('媛뺤썝') || zoneName.includes('?몃쫱') || zoneName.includes('?낅룄') ||
        (zoneName.includes('?숉빐') && (zoneName.includes('以묐?') || zoneName.includes('諛붽묑')))) {
        return '?숉빐以묐??댁긽';
    }
    if (zoneName.includes('?몄쿇') || zoneName.includes('寃쎄린') || zoneName.includes('異⑸궓') ||
        (zoneName.includes('?쒗빐') && zoneName.includes('以묐?'))) {
        return '?쒗빐以묐??댁긽';
    }
    if (zoneName.includes('?꾨턿') ||
        (zoneName.includes('?꾨궓') && zoneName.includes('?쒗빐')) ||
        (zoneName.includes('?쒗빐') && zoneName.includes('?⑤?'))) {
        return '?쒗빐?⑤??댁긽';
    }
    if (zoneName.includes('遺??) || zoneName.includes('嫄곗젣') || zoneName.includes('寃쎈궓') ||
        (zoneName.includes('?⑦빐') && zoneName.includes('?숇?'))) {
        return '?⑦빐?숇??댁긽';
    }
    if ((zoneName.includes('?꾨궓') && zoneName.includes('?⑦빐')) ||
        (zoneName.includes('?⑦빐') && zoneName.includes('?쒕?'))) {
        return '?⑦빐?쒕??댁긽';
    }
    if (zoneName.includes('?쒖＜') || zoneName.includes('異붿옄')) {
        return '?쒖＜?댁뿭';
    }

    return null;
}

// 以묐텇瑜????遺꾨쪟 李얘린
function getMainRegion(subRegion) {
    for (const [main, data] of Object.entries(SEA_REGIONS)) {
        if (data.subRegions.includes(subRegion)) {
            return main;
        }
    }
    return '湲고?';
}

// 湲곗〈 ?명솚?? 援ъ뿭紐????遺꾨쪟 (?숉빐/?쒗빐/?⑦빐/?쒖＜)
function getSeaArea(zoneName) {
    const subRegion = getSubRegion(zoneName);
    if (subRegion) {
        return getMainRegion(subRegion);
    }

    // 湲곗〈 ZONE_CLASSIFICATION ?대갚
    for (const [sea, keywords] of Object.entries(ZONE_CLASSIFICATION)) {
        if (keywords.some(kw => zoneName.includes(kw))) {
            return sea;
        }
    }
    return '湲고?';
}

// ?곗븞諛붾떎/?됱닔援ъ뿭 留ㅽ븨 (?곸쐞援ъ뿭 ???섏쐞援ъ뿭)
const COASTAL_MAPPING = {
    // ?뵷 ?숉빐?⑤? 吏??
    '?몄궛?욌컮??: [
        { name: '?됱닔援ъ뿭', fullName: '?몄궛?욌컮?ㅼ쨷?됱닔援ъ뿭' },
        { name: '?곗븞諛붾떎', fullName: '?몄궛?욌컮?ㅼ쨷?곗븞諛붾떎' }
    ],
    '寃쎈턿?⑤??욌컮??: [
        { name: '?됱닔援ъ뿭', fullName: '寃쎈턿?⑤??욌컮?ㅼ쨷?됱닔援ъ뿭' },
        { name: '?곗븞諛붾떎', fullName: '寃쎈턿?⑤??욌컮?ㅼ쨷?곗븞諛붾떎' }
    ],
    '寃쎈턿遺곷??욌컮??: [
        { name: '?곗븞諛붾떎', fullName: '寃쎈턿遺곷??욌컮?ㅼ쨷?곗븞諛붾떎' }
    ],

    // ?뵷 ?숉빐以묐? 吏??
    '媛뺤썝遺곷??욌컮??: [
        { name: '?곗븞諛붾떎', fullName: '媛뺤썝遺곷??욌컮?ㅼ쨷?곗븞諛붾떎' }
    ],
    '媛뺤썝以묐??욌컮??: [
        { name: '?곗븞諛붾떎', fullName: '媛뺤썝以묐??욌컮?ㅼ쨷?곗븞諛붾떎' }
    ],
    '媛뺤썝?⑤??욌컮??: [
        { name: '?곗븞諛붾떎', fullName: '媛뺤썝?⑤??욌컮?ㅼ쨷?곗븞諛붾떎' }
    ],
    '?숉빐以묐??덉そ癒쇰컮??: [
        { name: '?몃쫱?띿뿰?덈컮??, fullName: '?몃쫱?꾩슱由됱쓭?곗븞諛붾떎' },
        { name: '?쒕㈃?곗븞諛붾떎', fullName: '?몃쫱?꾩꽌硫댁뿰?덈컮?? },
        { name: '遺곷㈃?곗븞諛붾떎', fullName: '?몃쫱?꾨턿硫댁뿰?덈컮?? }
    ],

    // ?뵷 ?쒗빐?⑤? 吏??
    '?꾨턿遺곷??욌컮??: [
        { name: '?됱닔援ъ뿭', fullName: '?꾨턿遺곷??욌컮?ㅼ쨷?됱닔援ъ뿭' }
    ],
    '?꾨턿?⑤??욌컮??: [
        { name: '?됱닔援ъ뿭', fullName: '?꾨턿?⑤??욌컮?ㅼ쨷?됱닔援ъ뿭' }
    ],
    '?꾨궓遺곷??쒗빐?욌컮??: [
        { name: '?됱닔援ъ뿭', fullName: '?꾨궓遺곷??쒗빐?욌컮?ㅼ쨷?됱닔援ъ뿭' }
    ],
    '?꾨궓以묐??쒗빐?욌컮??: [
        { name: '癒쇳룊?섍뎄??, fullName: '?꾨궓以묐??쒗빐?욌컮?ㅼ쨷癒쇳룊?섍뎄?? },
        { name: '?욏룊?섍뎄??, fullName: '?꾨궓以묐??쒗빐?욌컮?ㅼ쨷?욏룊?섍뎄?? }
    ],
    '?꾨궓?⑤??쒗빐?욌컮??: [
        { name: '?됱닔援ъ뿭', fullName: '?꾨궓?⑤??쒗빐?욌컮?ㅼ쨷?됱닔援ъ뿭' }
    ],
    '?쒗빐?⑤??⑥そ?덉そ癒쇰컮??: [
        { name: '議곕룄遺洹쇳룊?섍뎄??, fullName: '?쒗빐?⑤??⑥そ?덉そ癒쇰컮?ㅼ쨷議곕룄遺洹쇳룊?섍뎄?? }
    ],

    // ?뵷 ?쒗빐以묐? 吏??
    '寃쎄린遺곷??욌컮??: [
        { name: '?곗븞諛붾떎', fullName: '寃쎄린遺곷??욌컮?ㅼ쨷?곗븞諛붾떎' },
        { name: '?됱닔援ъ뿭', fullName: '寃쎄린遺곷??욌컮?ㅼ쨷?됱닔援ъ뿭' }
    ],
    '?몄쿇쨌寃쎄린遺곷??욌컮??: [
        { name: '?됱닔援ъ뿭', fullName: '?몄쿇쨌寃쎄린遺곷??욌컮?ㅼ쨷?됱닔援ъ뿭' },
        { name: '?곗븞諛붾떎', fullName: '?몄쿇쨌寃쎄린遺곷??욌컮?ㅼ쨷?곗븞諛붾떎' }
    ],
    '?몄쿇쨌寃쎄린?⑤??욌컮??: [
        { name: '癒쇳룊?섍뎄??, fullName: '?몄쿇쨌寃쎄린?⑤??욌컮?ㅼ쨷癒쇳룊?섍뎄?? },
        { name: '遺곷??욏룊?섍뎄??, fullName: '?몄쿇쨌寃쎄린?⑤??욌컮?ㅼ쨷遺곷??욏룊?섍뎄?? },
        { name: '?⑤??욏룊?섍뎄??, fullName: '?몄쿇쨌寃쎄린?⑤??욌컮?ㅼ쨷?⑤??욏룊?섍뎄?? }
    ],
    '異⑸궓遺곷??욌컮??: [
        { name: '泥쒖닔留뚰룊?섍뎄??, fullName: '泥쒖닔留뚰룊?섍뎄?? },
        { name: '?덈㈃?꾩꽌履쏀룊?섍뎄??, fullName: '?덈㈃?꾩꽌履쏀룊?섍뎄?? },
        { name: '?뱀쭊?됱닔援ъ뿭', fullName: '?뱀쭊?됱닔援ъ뿭' },
        { name: '?쒖븞쨌?쒖궛遺곸そ?됱닔援ъ뿭', fullName: '?쒖븞쨌?쒖궛遺곸そ?됱닔援ъ뿭' }
    ],
    '異⑸궓?⑤??욌컮??: [
        { name: '?됱닔援ъ뿭', fullName: '異⑸궓?⑤??욌컮?ㅼ쨷?됱닔援ъ뿭' }
    ],

    // ?뵷 ?⑦빐?숇? 吏??
    '遺?곗븵諛붾떎': [
        { name: '?숇??됱닔援ъ뿭', fullName: '遺?곗븵諛붾떎以묐룞遺?됱닔援ъ뿭' },
        { name: '?쒕??됱닔援ъ뿭', fullName: '遺?곗븵諛붾떎以묒꽌遺?됱닔援ъ뿭' },
        { name: '?곗븞諛붾떎', fullName: '遺?곗븵諛붾떎以묒뿰?덈컮?? }
    ],
    '寃쎈궓?쒕??⑦빐?욌컮??: [
        { name: '?숇??됱닔援ъ뿭', fullName: '寃쎈궓?쒕??⑦빐?욌컮?ㅼ쨷?숇??됱닔援ъ뿭' },
        { name: '?쒕??됱닔援ъ뿭', fullName: '寃쎈궓?쒕??⑦빐?욌컮?ㅼ쨷?쒕??됱닔援ъ뿭' },
        { name: '?⑤??됱닔援ъ뿭', fullName: '寃쎈궓?쒕??⑦빐?욌컮?ㅼ쨷?⑤??됱닔援ъ뿭' },
        { name: '?⑦빐援곗뿰?덈컮??, fullName: '寃쎈궓?쒕??⑦빐?욌컮?ㅼ쨷?⑦빐援곗뿰?덈컮?? }
    ],
    '寃쎈궓以묐??⑦빐?욌컮??: [
        { name: '?됱닔援ъ뿭', fullName: '寃쎈궓以묐??⑦빐?욌컮?ㅼ쨷?됱닔援ъ뿭' },
        { name: '?곗븞諛붾떎', fullName: '寃쎈궓以묐??⑦빐?욌컮?ㅼ쨷?곗븞諛붾떎' }
    ],
    '嫄곗젣?쒕룞遺?욌컮??: [
        { name: '?곗븞諛붾떎', fullName: '嫄곗젣?쒕룞遺?욌컮?ㅼ쨷?곗븞諛붾떎' }
    ],

    // ?뵷 ?⑦빐?쒕? 吏??
    '?꾨궓?쒕??⑦빐?욌컮??: [
        { name: '?됱닔援ъ뿭', fullName: '?꾨궓?쒕??⑦빐?욌컮?ㅼ쨷?됱닔援ъ뿭' }
    ],
    '?꾨궓?숇??⑦빐?욌컮??: [
        { name: '?쒕??됱닔援ъ뿭', fullName: '?꾨궓?숇??⑦빐?욌컮?ㅼ쨷?쒕??됱닔援ъ뿭' },
        { name: '?숇??됱닔援ъ뿭', fullName: '?꾨궓?숇??⑦빐?욌컮?ㅼ쨷?숇??됱닔援ъ뿭' }
    ],
    '?⑦빐?쒕??쒖そ癒쇰컮??: [
        { name: '異붿옄?꾩뿰?덈컮??, fullName: '?⑦빐?쒕??쒖そ癒쇰컮?ㅼ쨷異붿옄?꾩뿰?덈컮?? }
    ],

    // ?뵷 ?쒖＜??吏??
    '?쒖＜?꾨턿遺?욌컮??: [
        { name: '?곗븞諛붾떎', fullName: '?쒖＜?꾨턿遺?욌컮?ㅼ쨷?곗븞諛붾떎' }
    ],
    '?쒖＜?꾨룞遺?욌컮??: [
        { name: '遺곷룞?곗븞諛붾떎', fullName: '?쒖＜?꾨룞遺?욌컮?ㅼ쨷遺곷룞?곗븞諛붾떎' },
        { name: '?⑤룞?곗븞諛붾떎', fullName: '?쒖＜?꾨룞遺?욌컮?ㅼ쨷?⑤룞?곗븞諛붾떎' },
        { name: '?곕룄?곗븞諛붾떎', fullName: '?쒖＜?꾨룞遺?욌컮?ㅼ쨷?곕룄?곗븞諛붾떎' }
    ],
    '?쒖＜?꾨궓遺?욌컮??: [
        { name: '?곗븞諛붾떎', fullName: '?쒖＜?꾨궓遺?욌컮?ㅼ쨷?곗븞諛붾떎' }
    ],
    '?쒖＜?꾩꽌遺?욌컮??: [
        { name: '遺곸꽌?곗븞諛붾떎', fullName: '?쒖＜?꾩꽌遺?욌컮?ㅼ쨷遺곸꽌?곗븞諛붾떎' },
        { name: '?⑥꽌?곗븞諛붾떎', fullName: '?쒖＜?꾩꽌遺?욌컮?ㅼ쨷?⑥꽌?곗븞諛붾떎' },
        { name: '媛?뚮룄?곗븞諛붾떎', fullName: '?쒖＜?꾩꽌遺?욌컮?ㅼ쨷媛?뚮룄?곗븞諛붾떎' }
    ]
};

// 遺??留ㅽ븨 (?밸낫援ъ뿭 ??遺??紐⑸줉)
// type: B=湲곗긽遺???띿냽,?⑤룄,?뚭퀬), C=?뚭퀬遺???뚭퀬留?, L=?깊몴, F=?곗븞諛⑹옱, J=湲곗긽1??
const BUOY_MAPPING = {
    // === ?쒗빐 (West Sea) ===

    // ?쒗빐以묐?
    '?몄쿇쨌寃쎄린遺곷??욌컮??: [
        { id: '22525', name: '蹂쇱쓬??, type: 'C', lat: 37.61, lon: 126.13 },
        { id: '22496', name: '?λ큺??, type: 'C', lat: 37.49, lon: 126.35 },
        { id: '22522', name: '?고룊??, type: 'B', lat: 37.62, lon: 125.65 },
        { id: '955', name: '?쒖닔??, type: 'L', lat: 37.33, lon: 126.39 }
    ],
    '?몄쿇쨌寃쎄린?⑤??욌컮??: [
        { id: '22101', name: '?뺤쟻??, type: 'B', lat: 37.24, lon: 126.02 },
        { id: '22185', name: '?몄쿇', type: 'B', lat: 37.09, lon: 125.43 },
        { id: '22303', name: '?띾룄', type: 'B', lat: 37.16, lon: 126.41 },
        { id: '22461', name: '?댁옉??, type: 'C', lat: 37.17, lon: 126.21 },
        { id: '22472', name: '?먯썡??, type: 'C', lat: 37.30, lon: 126.16 },
        { id: '22509', name: '?μ븞??, type: 'C', lat: 37.03, lon: 126.28 }
    ],
    '異⑸궓遺곷??욌컮??: [
        { id: '22444', name: '?좎쭊??, type: 'C', lat: 36.61, lon: 126.13 },
        { id: '22487', name: '泥쒖닔留?, type: 'C', lat: 36.47, lon: 126.44 },
        { id: '22488', name: '?덈㈃??, type: 'C', lat: 36.54, lon: 126.30 },
        { id: '22446', name: '?댄뙆?섎룄', type: 'B', lat: 36.45, lon: 126.24 },
        { id: '956', name: '媛???, type: 'L', lat: 36.77, lon: 125.98 }
    ],
    '異⑸궓?⑤??욌컮??: [
        { id: '22108', name: '?몄뿰??, type: 'B', lat: 36.25, lon: 125.75 },
        { id: '22445', name: '?쎌떆??, type: 'C', lat: 36.37, lon: 126.34 },
        { id: '22473', name: '?쒖쿇', type: 'C', lat: 36.17, lon: 126.33 },
        { id: '22526', name: '?밸룄', type: 'C', lat: 36.26, lon: 126.21 }
    ],

    // ?쒗빐?⑤?
    '?꾨턿遺곷??욌컮??: [
        { id: '22474', name: '援곗궛', type: 'C', lat: 35.89, lon: 126.43 },
        { id: '22492', name: '鍮꾩븞??, type: 'C', lat: 35.74, lon: 126.35 },
        { id: '957', name: '??씠?숉뙆', type: 'L', lat: 35.99, lon: 126.23 }
    ],
    '?꾨턿?⑤??욌컮??: [
        { id: '22186', name: '遺??, type: 'B', lat: 35.66, lon: 125.81 },
        { id: '22497', name: '蹂??, type: 'C', lat: 35.66, lon: 126.46 },
        { id: '22504', name: '?꾨룄', type: 'C', lat: 35.66, lon: 126.26 },
        { id: '22510', name: '?꾨룄?숇?', type: 'B', lat: 35.64, lon: 126.36 },
        { id: '958', name: '媛덈ℓ??, type: 'L', lat: 35.61, lon: 126.25 }
    ],
    '?꾨궓遺곷??쒗빐?욌컮??: [
        { id: '22475', name: '?곴킅', type: 'C', lat: 35.44, lon: 126.18 },
        { id: '22494', name: '?숈썡', type: 'C', lat: 35.20, lon: 126.21 },
        { id: '22503', name: '遺덈Т??, type: 'C', lat: 34.32, lon: 126.17 }
    ],
    '?꾨궓以묐??쒗빐?욌컮??: [
        { id: '22183', name: '?좎븞', type: 'B', lat: 34.73, lon: 126.24 },
        { id: '22493', name: '?먯?', type: 'B', lat: 34.92, lon: 125.87 },
        { id: '22102', name: '移좊컻??, type: 'B', lat: 34.79, lon: 125.78 }
    ],
    '?꾨궓?⑤??쒗빐?욌컮??: [
        { id: '22500', name: '議곕룄', type: 'C', lat: 34.29, lon: 126.11 },
        { id: '22481', name: '留밴낏?섎룄', type: 'C', lat: 34.23, lon: 125.95 }
    ],

    // ?쒗빐 癒쇰컮??
    '?쒗빐以묐??덉そ癒쇰컮??: [
        { id: '22193', name: '?쒗빐143', type: 'B', lat: 37.00, lon: 124.50 }
    ],
    '?쒗빐以묐?諛붽묑癒쇰컮??: [
        { id: '22191', name: '?쒗빐170', type: 'B', lat: 37.50, lon: 123.50 }
    ],
    '?쒗빐?⑤?遺곸そ?덉そ癒쇰컮??: [
        { id: '22489', name: '?移섎쭏??, type: 'B', lat: 35.02, lon: 126.03 },
        { id: '22299', name: '?쒗빐190', type: 'B', lat: 35.50, lon: 124.00 }
    ],
    '?쒗빐?⑤??⑥そ?덉そ癒쇰컮??: [
        { id: '22297', name: '媛嫄곕룄', type: 'B', lat: 34.03, lon: 125.21 },
        { id: '22298', name: '?띾룄', type: 'B', lat: 34.75, lon: 125.25 },
        { id: '959', name: '?댁닔??, type: 'L', lat: 34.26, lon: 126.03 }
    ],
    '?쒗빐?⑤??⑥そ諛붽묑癒쇰컮??: [
        { id: '22192', name: '?쒗빐206', type: 'B', lat: 34.00, lon: 123.00 }
    ],

    // === ?⑦빐 (South Sea) ===

    '?꾨궓?쒕??⑦빐?욌컮??: [
        { id: '22477', name: '?명솕??, type: 'C', lat: 34.24, lon: 126.49 },
        { id: '22456', name: '泥?궛??, type: 'C', lat: 34.14, lon: 126.74 }
    ],
    '?꾨궓?숇??⑦빐?욌컮??: [
        { id: '22478', name: '怨좏씎', type: 'C', lat: 34.38, lon: 127.18 },
        { id: '22466', name: '湲덉삤??, type: 'C', lat: 34.57, lon: 127.78 },
        { id: '22502', name: '?섎줈??, type: 'C', lat: 34.43, lon: 127.59 },
        { id: '961', name: '媛꾩뿬??, type: 'L', lat: 34.29, lon: 127.86 }
    ],
    '寃쎈궓?쒕??⑦빐?욌컮??: [
        { id: '22450', name: '?먮???, type: 'C', lat: 34.71, lon: 128.15 },
        { id: '22501', name: '?щ웾??, type: 'C', lat: 34.86, lon: 128.14 },
        { id: '22499', name: '?고솕??, type: 'C', lat: 34.67, lon: 128.37 },
        { id: '22498', name: '?⑦빐', type: 'C', lat: 34.70, lon: 127.99 }
    ],
    '寃쎈궓以묐??⑦빐?욌컮??: [
        { id: '22188', name: '?듭쁺', type: 'B', lat: 34.39, lon: 128.23 },
        { id: '22467', name: '?쒖궛??, type: 'C', lat: 34.71, lon: 128.50 }
    ],
    '嫄곗젣?쒕룞遺?욌컮??: [
        { id: '22104', name: '嫄곗젣??, type: 'B', lat: 34.77, lon: 128.90 },
        { id: '22455', name: '?닿툑媛?, type: 'C', lat: 34.74, lon: 128.69 },
        { id: '22512', name: '吏?щ룄', type: 'B', lat: 34.83, lon: 128.78 },
        { id: '22513', name: '?댁닔??, type: 'B', lat: 34.97, lon: 128.76 },
        { id: '22484', name: '?좊룄', type: 'C', lat: 35.06, lon: 128.68 },
        { id: '22485', name: '?뚮ℓ臾쇰룄', type: 'B', lat: 34.62, lon: 128.54 }
    ],
    '遺?곗븵諛붾떎': [
        { id: '22460', name: '?ㅻ???, type: 'C', lat: 35.02, lon: 128.96 },
        { id: '22459', name: '?ㅻ쪠??, type: 'C', lat: 35.10, lon: 129.13 },
        { id: '22511', name: '湲곗옣', type: 'C', lat: 35.22, lon: 129.26 },
        { id: '984', name: '?ㅻ쪠??, type: 'L', lat: 35.09, lon: 129.13 }
    ],

    // ?⑦빐 癒쇰컮??
    '?⑦빐?쒕??쒖そ癒쇰컮??: [
        { id: '22184', name: '異붿옄??, type: 'B', lat: 33.79, lon: 126.14 },
        { id: '22468', name: '異붿옄??, type: 'C', lat: 33.97, lon: 126.28 }
    ],
    '?⑦빐?쒕??숈そ癒쇰컮??: [
        { id: '22103', name: '嫄곕Ц??, type: 'B', lat: 34.00, lon: 127.50 },
        { id: '22507', name: '珥덈룄', type: 'C', lat: 34.15, lon: 127.22 },
        { id: '22309', name: '?⑦빐111', type: 'B', lat: 33.50, lon: 128.00 }
    ],
    '?⑦빐?숇?諛붽묑癒쇰컮??: [
        { id: '22304', name: '?⑦빐244', type: 'B', lat: 33.50, lon: 129.50 }
    ],

    // === ?쒖＜??(Jeju Sea) ===

    '?쒖＜?꾨턿遺?욌컮??: [
        { id: '22457', name: '?쒖＜??, type: 'C', lat: 33.52, lon: 126.49 },
        { id: '22491', name: '源??, type: 'C', lat: 33.58, lon: 126.76 },
        { id: '22514', name: '援ъ뾼', type: 'B', lat: 33.52, lon: 126.37 },
        { id: '22517', name: '?섎룄', type: 'C', lat: 33.56, lon: 126.93 }
    ],
    '?쒖＜?꾩꽌遺?욌컮??: [
        { id: '22486', name: '?묒옱', type: 'C', lat: 33.40, lon: 126.21 },
        { id: '22516', name: '?좎갹', type: 'C', lat: 33.37, lon: 126.11 }
    ],
    '?쒖＜?꾨룞遺?욌컮??: [
        { id: '22469', name: '?곕룄', type: 'C', lat: 33.52, lon: 126.97 },
        { id: '22495', name: '?좎궛', type: 'C', lat: 33.38, lon: 126.91 }
    ],
    '?쒖＜?꾨궓遺?욌컮??: [
        { id: '22107', name: '留덈씪??, type: 'B', lat: 33.08, lon: 126.03 },
        { id: '22458', name: '以묐Ц', type: 'C', lat: 33.23, lon: 126.39 },
        { id: '22515', name: '?꾨?', type: 'C', lat: 33.22, lon: 126.71 },
        { id: '22187', name: '?쒓???, type: 'B', lat: 33.13, lon: 127.02 },
        { id: '22505', name: '?곷씫', type: 'C', lat: 33.24, lon: 126.19 },
        { id: '22476', name: '媛?뚮룄', type: 'C', lat: 33.16, lon: 126.26 },
        { id: '960', name: '吏洹??, type: 'L', lat: 33.22, lon: 126.65 },
        { id: '22003', name: '湲곗긽1??, type: 'J', lat: 33.23, lon: 126.57 }
    ],

    // ?쒖＜??癒쇰컮??
    '?쒖＜?꾨궓?쒖そ?덉そ癒쇰컮??: [
        { id: '22300', name: '?⑦빐239', type: 'B', lat: 32.50, lon: 125.50 }
    ],
    '?쒖＜?꾨궓履쎈컮源λ㉫諛붾떎': [
        { id: '22301', name: '?⑦빐465', type: 'B', lat: 31.50, lon: 127.00 }
    ],

    // === ?숉빐 (East Sea) ===

    '?몄궛?욌컮??: [
        { id: '22189', name: '?몄궛', type: 'B', lat: 35.35, lon: 129.84 },
        { id: '22483', name: '媛꾩젅怨?, type: 'C', lat: 35.37, lon: 129.38 },
        { id: '22518', name: '?뱀궗', type: 'C', lat: 35.58, lon: 129.50 },
        { id: '963', name: '?대뜒??, type: 'L', lat: 35.57, lon: 129.48 }
    ],
    '寃쎈턿?⑤??욌컮??: [
        { id: '22490', name: '?뷀룷', type: 'C', lat: 36.22, lon: 129.40 },
        { id: '22524', name: '援щ！??, type: 'C', lat: 35.97, lon: 129.60 }
    ],
    '寃쎈턿遺곷??욌컮??: [
        { id: '22465', name: '?꾪룷', type: 'C', lat: 36.72, lon: 129.49 }
    ],
    '媛뺤썝?⑤??욌컮??: [
        { id: '22311', name: '?쇱쿃', type: 'B', lat: 37.46, lon: 129.32 },
        { id: '22479', name: '留밸갑', type: 'C', lat: 37.40, lon: 129.23 },
        { id: '22523', name: '二쎈?', type: 'B', lat: 37.10, lon: 129.46 }
    ],
    '媛뺤썝以묐??욌컮??: [
        { id: '22520', name: '媛뺣쫱', type: 'B', lat: 37.80, lon: 129.06 },
        { id: '22451', name: '?곌끝', type: 'C', lat: 37.87, lon: 128.89 }
    ],
    '媛뺤썝遺곷??욌컮??: [
        { id: '22310', name: '怨좎꽦', type: 'B', lat: 38.32, lon: 128.64 },
        { id: '22471', name: '?좎꽦', type: 'C', lat: 38.28, lon: 128.58 }
    ],

    // ?숉빐 癒쇰컮??
    '?숉빐?⑤?遺곸そ?덉そ癒쇰컮??: [
        { id: '22106', name: '?ы빆', type: 'B', lat: 36.35, lon: 129.78 },
        { id: '22190', name: '?몄쭊', type: 'B', lat: 36.91, lon: 129.87 },
        { id: '22302', name: '?숉빐78', type: 'B', lat: 37.00, lon: 130.00 }
    ],
    '?숉빐以묐??덉そ癒쇰컮??: [
        { id: '21229', name: '?몃쫱??, type: 'B', lat: 37.46, lon: 131.11 },
        { id: '22105', name: '?숉빐', type: 'B', lat: 37.54, lon: 130.00 },
        { id: '22464', name: '?몃쫱??, type: 'C', lat: 37.47, lon: 130.90 },
        { id: '22305', name: '?숉빐57', type: 'B', lat: 38.37, lon: 129.60 },
        { id: '22442', name: '?덉븫', type: 'C', lat: 37.54, lon: 130.85 }
    ],
    '?숉빐以묐?諛붽묑癒쇰컮??: [
        { id: '22441', name: '?낅룄', type: 'C', lat: 37.24, lon: 131.87 }
    ]
};


// 遺??????ㅻ챸
const BUOY_TYPES = {
    'B': { name: '湲곗긽遺??, measures: ['?띿냽', '湲곗삩', '?뚭퀬'], icon: '?뙄' },
    'C': { name: '?뚭퀬遺??, measures: ['?뚭퀬'], icon: '?뱤' },
    'L': { name: '?깊몴', measures: ['?띿냽', '湲곗삩'], icon: '?뿼' },
    'F': { name: '?곗븞諛⑹옱', measures: ['?띿냽', '湲곗삩', '?뚭퀬'], icon: '?룧' },
    'J': { name: '湲곗긽1??, measures: ['?띿냽', '湲곗삩', '?뚭퀬', '湲곗븬'], icon: '?슓' }
};

// Global State
let appState = {
    alerts: [],
    coastalAlerts: {}, // ?곗븞諛붾떎 ?밸낫 ???
    buoyData: {},      // 遺???곗씠?????
    lastUpdated: null,
    isLoading: false,
    apiStatus: { hub: 'pending', buoy: 'pending', coastal: 'pending' },
    hasApiError: false // API ?몄텧 ?ㅽ뙣 ?щ?
};
window.appState = appState; // Expose to global window object


// ----------------------------------------------------------------------------
// Utilities
// ----------------------------------------------------------------------------

function getSeaArea(zoneName) {
    if (!zoneName) return '湲고?';
    for (const [sea, keywords] of Object.entries(ZONE_CLASSIFICATION)) {
        if (keywords.some(k => zoneName.includes(k))) return sea;
    }
    return '湲고?';
}

function formatDate(dateStr) {
    if (!dateStr || dateStr.trim() === '') return '?뺣낫 ?놁쓬';

    let decoded = String(dateStr)
        .replace(/&#40;/g, '(')
        .replace(/&#41;/g, ')')
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .trim();

    // ?쒓컙???ㅼ쟾/?ㅽ썑 ?뺤떇?쇰줈 蹂?섑븯???ы띁 ?⑥닔
    const formatHourToAmPm = (hourStr, minStr = '00') => {
        const hour = parseInt(hourStr, 10);
        let text = '';
        if (hour === 0) text = '?ㅼ쟾 12??;
        else if (hour < 12) text = `?ㅼ쟾 ${hour}??;
        else if (hour === 12) text = '?ㅽ썑 12??;
        else text = `?ㅽ썑 ${hour - 12}??;

        if (minStr !== '00') text += ` ${parseInt(minStr, 10)}遺?;
        return text;
    };

    // YYYY.MM.DD.HH:MM ?뺤떇 泥섎━ (?? 2025.12.24.04:00) - AFSO ?뺤떇
    const dotMatch = decoded.match(/^(\d{4})\.(\d{2})\.(\d{2})\.(\d{2}):(\d{2})$/);
    if (dotMatch) {
        const [, , month, date, hour, min] = dotMatch;
        return `${month}/${date} ${formatHourToAmPm(hour, min)}`;
    }

    // YYYY.MM.DD. ?띿뒪???뺤떇 泥섎━ (?? 2025.12.12. ?덈꼍(00??06??)
    const textMatch = decoded.match(/^(\d{4})\.(\d{2})\.(\d{2})\.\s*(.+)$/);
    if (textMatch) {
        const [, , month, date, text] = textMatch;
        return `${month}/${date} ${text}`;
    }

    // 湲곗〈 MM/DD HH:MM ?뺤떇?대㈃ 洹몃?濡?
    if (decoded.includes('/')) return decoded;

    // ?대? ?쒓? ?쒓컙?媛 ?ы븿?섏뼱 ?덉쑝硫?洹몃?濡?
    if (decoded.includes('?덈꼍') || decoded.includes('?꾩묠') || decoded.includes('?ㅼ쟾') ||
        decoded.includes('??) || decoded.includes('?ㅽ썑') || decoded.includes('???) || decoded.includes('諛?)) {
        return decoded;
    }

    // YYYYMMDDHHMM ?뺤떇 泥섎━ (KMA Hub ?뺤떇)
    return formatWarningTime(dateStr, false);
}

// ?쒓컙 ?щ㎎ 蹂??(諛쒗슚/?댁젣 ?쒓컙? 泥섎━)
function formatWarningTime(tmEf, isEndTime = false) {
    // null?닿굅??鍮?臾몄옄?댁씠硫?"?뺣낫 ?놁쓬" 諛섑솚
    if (!tmEf || tmEf.trim() === '' || tmEf === '0' || tmEf === '000000000000') {
        return '?뺣낫 ?놁쓬';
    }

    // "00??濡??쒖옉?섍굅???좏슚?섏? ?딆? ?좎쭨 泥섎━
    if (tmEf.startsWith('00??) || tmEf === '00??) {
        return '?뺣낫 ?놁쓬';
    }

    // ?대? ?쒓?濡??щ㎎??寃쎌슦 洹몃?濡?諛섑솚
    if (tmEf.includes('?덈꼍') || tmEf.includes('?꾩묠') || tmEf.includes('?ㅼ쟾') ||
        tmEf.includes('??) || tmEf.includes('?ㅽ썑') || tmEf.includes('???) || tmEf.includes('諛?)) {
        return tmEf;
    }

    const cleanStr = String(tmEf).replace(/[^0-9]/g, '');

    // ?レ옄 ?뺤떇???꾨땲嫄곕굹 湲몄씠媛 遺議깊븳 寃쎌슦
    if (cleanStr.length < 12) {
        return '?뺣낫 ?놁쓬';
    }

    try {
        const month = cleanStr.substring(4, 6);
        const day = cleanStr.substring(6, 8);
        const hour = cleanStr.substring(8, 10);
        const minute = cleanStr.substring(10, 12);

        // ?쒓컙? 踰붿쐞 ?뺤씤 (遺꾩씠 58 ?먮뒗 59??寃쎌슦 = ?쒓컙? 踰붿쐞)
        if (minute === '58' || minute === '59') {
            let timeRange = '';

            if (hour === '02') {
                timeRange = '?덈꼍(00??03??';
            } else if (hour === '05') {
                timeRange = minute === '59' ? '?덈꼍(03??06??' : '?덈꼍(00??06??';
            } else if (hour === '08') {
                timeRange = '?꾩묠(06??09??';
            } else if (hour === '11') {
                timeRange = minute === '59' ? '?ㅼ쟾(09??12??' : '?ㅼ쟾(06??12??';
            } else if (hour === '14') {
                timeRange = minute === '58' ? '?ㅽ썑(12??18??' : '??12??15??';
            } else if (hour === '17') {
                timeRange = minute === '59' ? '????ㅽ썑(15??18??' : '?ㅽ썑(12??18??';
            } else if (hour === '20') {
                timeRange = '???18??21??';
            } else if (hour === '23') {
                timeRange = minute === '59' ? '諛?21??24??' : '諛?18??24??';
            } else {
                // 留ㅽ븨?섏? ?딆? 寃쎌슦 ?뺥솗???쒓컙 ?쒖떆
                return `${month}/${day} ${hour}:${minute}`;
            }

            return `${month}/${day} ${timeRange}`;
        } else {
            // ?뺥솗???쒓컙??寃쎌슦
            const hourNum = parseInt(hour, 10);
            let timeText = '';

            if (hourNum < 12) {
                timeText = `?ㅼ쟾 ${hourNum === 0 ? '12' : hourNum}??;
            } else {
                timeText = `?ㅽ썑 ${hourNum === 12 ? '12' : hourNum - 12}??;
            }

            // 遺꾩씠 00???꾨땶 寃쎌슦 遺꾨룄 ?쒖떆
            if (minute !== '00') {
                timeText += ` ${parseInt(minute, 10)}遺?;
            }

            return `${month}/${day} ${timeText}`;
        }

    } catch (e) {
        // console.error('?쒓컙 ?щ㎎ 蹂???ㅻ쪟:', e, 'tmEf:', tmEf);
        return '?뺣낫 ?놁쓬';
    }
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
 * HTML ?뷀떚?곕? ?붿퐫?⑺븯???좏떥由ы떚 ?⑥닔
 * &#40; -> (, &#41; -> ) ??
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

    // [New] 諛⑸Ц媛?移댁슫???낅뜲?댄듃
    updateVisitorStats();

    appState.apiStatus = { hub: 'loading', buoy: 'loading', coastal: 'loading' };
    updateApiStatusDisplay();

    // 珥덇린?? ?곗븞諛붾떎 愿???곹깭 由ъ뀑
    appState.coastalAlerts = {};
    appState.releasedCoastalZones = {};

    // ?뚯뒪??紐⑤뱶: Mock ?밸낫 ?곗씠???ъ슜 + ?ㅼ젣 遺??API ?몄텧
    if (CONFIG.USE_MOCK_DATA) {
        // console.log('?㎦ ?뚯뒪??紐⑤뱶: Mock ?밸낫 ?곗씠??+ ?ㅼ젣 遺??API');
        appState.alerts = getMockAlerts();
        appState.apiStatus = { hub: 'success', buoy: 'loading' };
        updateApiStatusDisplay();

        // 遺???곗씠?곕뒗 ?ㅼ젣 API?먯꽌 媛?몄삤湲?
        try {
            const buoyData = await fetchBuoyData();
            appState.buoyData = buoyData;
            appState.apiStatus.buoy = Object.keys(buoyData).length > 0 ? 'success' : 'error';
            // console.log('??遺??API ?깃났:', Object.keys(buoyData).length, '媛?遺???곗씠??);
        } catch (e) {
            // console.error('??遺??API ?ㅽ뙣:', e.message);
            appState.buoyData = getMockBuoyData();
            appState.apiStatus.buoy = 'error';
        }

        appState.lastUpdated = new Date();
        updateApiStatusDisplay();
        renderApp();
        updateLoading(false);
        return;
    }

    try {
        // 1?④퀎: 遺???곗씠??蹂꾨룄 ?몄텧
        const buoyPromise = fetchBuoyData();

        // 2?④퀎: KMA Hub API? AFSO API ?숈떆 ?몄텧 (癒쇱? ??寃?癒쇱? ?쒖떆)
        let hubAlerts = [];
        let afsoMainAlerts = [];
        let coastalAlerts = {};
        let hubSuccess = false;
        let afsoSuccess = false;
        let firstResponder = null;

        const hubPromise = fetchKmaHubData().then(data => {
            hubAlerts = data || [];
            hubSuccess = true; // [?섏젙] 0嫄댁씠?대룄 API ?깃났
            return { type: 'hub', data: hubAlerts, success: hubSuccess };
        }).catch(e => {
            // console.error('??KMA Hub API Error:', e.message);
            return { type: 'hub', data: [], success: false };
        });

        const afsoPromise = fetchAfsoData().then(data => {
            afsoMainAlerts = data?.mainAlerts || [];
            coastalAlerts = data?.coastalAlerts || {};
            afsoSuccess = true; // [?섏젙] 0嫄댁씠?대룄 API ?깃났
            return { type: 'afso', data: afsoMainAlerts, coastal: coastalAlerts, success: afsoSuccess };
        }).catch(e => {
            // console.error('??AFSO API Error:', e.message);
            return { type: 'afso', data: [], coastal: {}, success: false };
        });

        // 癒쇱? ?묐떟??API 寃곌낵 利됱떆 ?쒖떆
        const firstResult = await Promise.race([hubPromise, afsoPromise]);
        firstResponder = firstResult.type;

        // console.log(`?? 泥?踰덉㎏ ?묐떟: ${firstResponder.toUpperCase()} API`);

        // 泥?踰덉㎏ 寃곌낵濡?利됱떆 ?붾㈃ ?낅뜲?댄듃
        if (firstResult.type === 'hub' && firstResult.success) {
            appState.alerts = firstResult.data;
            appState.apiStatus.hub = 'success';
            // console.log('?뱻 Hub ?곗씠??癒쇱? ?쒖떆:', firstResult.data.length, '媛?);
        } else if (firstResult.type === 'afso' && firstResult.success) {
            appState.alerts = firstResult.data;
            appState.coastalAlerts = firstResult.coastal;
            appState.apiStatus.coastal = 'success';
            // console.log('?뱻 AFSO ?곗씠??癒쇱? ?쒖떆:', firstResult.data.length, '媛?);
        }

        // 泥?踰덉㎏ 寃곌낵 ?덉쑝硫?利됱떆 ?뚮뜑留?
        if (firstResult.success) {
            appState.lastUpdated = new Date();
            updateApiStatusDisplay();
            renderApp();
        }

        // ??踰덉㎏ API 寃곌낵 ?湲?
        const secondPromise = firstResponder === 'hub' ? afsoPromise : hubPromise;
        const secondResult = await secondPromise;

        // console.log(`?? ??踰덉㎏ ?묐떟: ${secondResult.type.toUpperCase()} API`);

        // ?댁젣 hubAlerts, afsoMainAlerts, coastalAlerts 紐⑤몢 梨꾩썙吏?
        // 遺???곗씠?곕뒗 諛깃렇?쇱슫?쒖뿉??泥섎━ (?ㅽ뵆?섏떆 ?湲??쒓컙 ?⑥텞)
        buoyPromise.then(data => {
            appState.buoyData = data || {};
            appState.apiStatus.buoy = Object.keys(appState.buoyData).length > 0 ? 'success' : 'warning';
            // console.log('??Buoy Data Loaded (Background):', Object.keys(appState.buoyData).length, 'stations');
            updateApiStatusDisplay();
            renderApp(); // 遺???뺣낫 諛섏쁺?섏뿬 ?ㅼ떆 ?뚮뜑留?
        }).catch(e => {
            // console.error('??Buoy API Error (Background):', e.message);
            appState.apiStatus.buoy = 'error';
            updateApiStatusDisplay();
        });

        // 3?④퀎: ?곗씠??鍮꾧탳 諛?理쒖쥌 寃곗젙
        let finalAlerts = [];
        let dataSource = '';

        // Hub媛 鍮??곗씠?곗씤 寃쎌슦 ??AFSO ?ъ슜
        if (hubAlerts.length === 0) {
            finalAlerts = afsoMainAlerts;
            dataSource = 'AFSO (Hub 鍮??곗씠??';
            // console.log('?좑툘 KMA Hub API 鍮??곗씠??- AFSO API ?ъ슜');
        }
        // AFSO媛 鍮??곗씠?곗씤 寃쎌슦 ??Hub ?ъ슜
        else if (afsoMainAlerts.length === 0) {
            finalAlerts = hubAlerts;
            dataSource = 'HUB (AFSO 鍮??곗씠??';
            // console.log('?좑툘 AFSO API 鍮??곗씠??- Hub API ?ъ슜');
        }
        // ?????곗씠?곌? ?덈뒗 寃쎌슦 ??鍮꾧탳?섏뿬 Hub ?곗꽑
        else {
            // ?곗씠??鍮꾧탳
            const hubMap = new Map();
            const afsoMap = new Map();
            hubAlerts.forEach(a => hubMap.set(a.zoneName, a));
            afsoMainAlerts.forEach(a => afsoMap.set(a.zoneName, a));

            let isDifferent = false;

            // 媛쒖닔 鍮꾧탳
            if (hubAlerts.length !== afsoMainAlerts.length) {
                isDifferent = true;
            } else {
                // ?댁슜 鍮꾧탳
                for (const [zoneName, hubAlert] of hubMap) {
                    const afsoAlert = afsoMap.get(zoneName);
                    if (!afsoAlert || hubAlert.warnType !== afsoAlert.warnType || hubAlert.level !== afsoAlert.level) {
                        isDifferent = true;
                        break;
                    }
                }
            }

            if (isDifferent) {
                // ?곸씠??寃쎌슦 ??Hub ?곗꽑
                finalAlerts = hubAlerts;
                dataSource = 'HUB (?곗씠???곸씠 - Hub ?곗꽑)';
                // console.log('?뱧 ?곗씠???곸씠 ??Hub API ?곗꽑 ?곸슜');
            } else {
                // ?숈씪??寃쎌슦 ???꾩옱 ?쒖떆???곹깭 ?좎? (泥?踰덉㎏ ?묐떟 ?좎?)
                finalAlerts = firstResponder === 'hub' ? hubAlerts : afsoMainAlerts;
                dataSource = `${firstResponder.toUpperCase()} (?곗씠???숈씪 - ?좎?)`;
                // console.log('???곗씠???숈씪 ???꾩옱 ?곹깭 ?좎?');
            }
        }

        // 理쒖쥌 ?곗씠?????
        appState.alerts = finalAlerts;
        // appState.buoyData??諛깃렇?쇱슫?쒖뿉???ㅼ젙??
        appState.coastalAlerts = coastalAlerts;

        // API ?곹깭 ?낅뜲?댄듃
        appState.apiStatus.hub = hubSuccess ? 'success' : 'error';
        appState.apiStatus.buoy = appState.apiStatus.buoy || 'loading'; // 諛깃렇?쇱슫?쒖뿉???낅뜲?댄듃??
        appState.apiStatus.coastal = afsoSuccess ? 'success' : 'error';

        // [?섏젙] ?밸낫媛 0嫄댁씤 寃껋? ?먮윭媛 ?꾨떂. API ?몄텧???????ㅽ뙣?덉쓣 ?뚮쭔 ?먮윭濡?泥섎━.
        appState.hasApiError = (!hubSuccess && !afsoSuccess);

        // console.log('=== API Results (Progressive) ===');
        // console.log('First Responder:', firstResponder.toUpperCase());
        // console.log('KMA Hub API:', hubSuccess ? 'SUCCESS' : 'FAILED/EMPTY', `(${hubAlerts.length} items)`);
        // console.log('AFSO API:', afsoSuccess ? 'SUCCESS' : 'FAILED', `(${afsoMainAlerts.length} main, ${Object.keys(coastalAlerts).length} coastal)`);
        // console.log('Final Data Source:', dataSource);
        // console.log('Final Alerts:', finalAlerts.length, 'items');
        // console.log('Buoy Data: (Loading in Background)');

        appState.lastUpdated = new Date();
        updateApiStatusDisplay();
        renderApp();
    } catch (error) {
        // console.error('Critical Error in fetchAllData:', error);
        appState.apiStatus = { hub: 'error', buoy: 'error', coastal: 'error' };
        appState.hasApiError = true;
        updateApiStatusDisplay();
        renderApp();
    } finally {
        updateLoading(false);
    }
}

// --- KMA HUB API (wrn_now_data.php) ---
async function fetchKmaHubData() {
    // wrn_now_data.php ?곗씠??(濡쒖뺄 ?쒕쾭?먯꽌 ?섏쭛??warnings.json)
    // ?뚮씪誘명꽣(tm2, mode ?????대? ?섏쭛???곗씠?곗뿉 諛섏쁺?섏뼱 ?덇굅??濡쒖뺄 ?뚯씪?먮뒗 臾댁쓽誘명븿
    const url = CONFIG.KMA_API_URL;

    // console.log('Fetching KMA Hub (Local):', url);

    try {
        // [Cache Busting] 釉뚮씪?곗? 罹먯떆 諛⑹?瑜??꾪빐 ??꾩뒪?ы봽 異붽?
        const response = await fetch(`${url}?_t=${Date.now()}`);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        // 濡쒖뺄 ?쒕쾭??UTF-8 JSON??諛섑솚??(scheduler.js媛 ?대? ?붿퐫?⑺븿)
        const jsonData = await response.json();

        // warnings.json 援ъ“: { updatedAt: ..., kma: "RAW TEXT", afso: {...} }
        let text = jsonData.kma || '';

        // [Fix] ?쒕쾭?먯꽌 EUC-KR ?붿퐫???ㅽ뙣 ??Base64濡??꾨떖諛쏆븘 釉뚮씪?곗??먯꽌 ?섑뻾
        if (text.startsWith('BASE64:')) {
            try {
                const base64 = text.substring(7); // Remove 'BASE64:'
                const binaryString = atob(base64);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                text = new TextDecoder('euc-kr').decode(bytes);
                // console.log('??Hub Data: Base64 -> EUC-KR Decodng Success');
            } catch (e) {
                // console.error('??Base64 Decoding Failed:', e);
            }
        }

        // console.log(`Hub Raw Response Info: Length=${text.length}, UpdatedAt=${jsonData.updatedAt}`);
        // console.log('Hub Raw Response (first 1000 chars):', text.substring(0, 1000));
        // console.log('Data Updated At:', jsonData.updatedAt);

        const parsed = parseHubText(text);
        // console.log('Hub Parsed:', parsed.length, 'items');

        return parsed;
    } catch (e) {
        // console.warn(`Local Fetch failed:`, e.message);
        return getMockAlerts();
    }

    return getMockAlerts();
}


function parseHubText(text) {
    const lines = text.trim().split('\n');
    const alerts = [];
    const seenZones = new Set(); // 以묐났 諛⑹?

    // ?댁젣???곗븞諛붾떎/?됱닔援ъ뿭 ?섏쭛 (?쒖쇅 泥섎━??
    appState.releasedCoastalZones = appState.releasedCoastalZones || {};

    // console.log('Parsing', lines.length, 'lines');

    lines.forEach((line, idx) => {
        // ?ㅻ뜑/二쇱꽍 ?쇱씤 嫄대꼫?곌린
        if (line.startsWith('#') || line.trim() === '') return;

        // ?쇳몴濡?遺꾨━
        const parts = line.split(',').map(p => p.trim());

        // wrn_now_data.php ?묐떟 ?щ㎎:
        // 0: regUp (?곸쐞援ъ뿭肄붾뱶)
        // 1: regUpName (?곸쐞援ъ뿭紐?
        // 2: regId (?밸낫援ъ뿭肄붾뱶)
        // 3: regName (?밸낫援ъ뿭紐? - ?쒓?!
        // 4: tmFc (諛쒗몴?쒓컖)
        // 5: tmEf (諛쒗슚?쒓컖)
        // 6: wrnType (?밸낫醫낅쪟) - ?띾옉, ?쒗뭾, 媛뺥뭾, ?댁씪 ???쒓?!
        // 7: level (?밸낫?섏?) - 二쇱쓽, 寃쎈낫, ?덈퉬
        // 8: cmd (紐낅졊) - 諛쒗몴, ?댁젣 ??
        // 9: edTm (?댁젣?덉젙?쒓컖)

        if (parts.length < 10) {
            // console.log(`Line ${idx} skipped (not enough parts):`, parts.length);
            return;
        }

        const regId = parts[2];
        const regName = parts[3];
        const tmFc = parts[4];
        const tmEf = parts[5];
        const wrnType = parts[6];
        const level = parts[7];
        const cmd = parts[8];
        const edTm = parts[9];

        // ?댁긽 ?밸낫留??꾪꽣留?(?띾옉, ?쒗뭾, ?댁씪, 吏吏꾪빐?? - 媛뺥뭾 ?쒖쇅
        const marineTypes = ['?띾옉', '?쒗뭾', '?댁씪', '吏吏꾪빐??];
        if (!marineTypes.includes(wrnType)) {
            return;
        }

        // ?댁씪 ?밸낫 紐낇솗?? API?먯꽌 '?댁씪'濡??ㅻ㈃ '??뭾?댁씪'濡?蹂??
        let displayWarnType = wrnType;
        if (wrnType === '?댁씪') {
            displayWarnType = '??뭾?댁씪';
        }

        // ?곗븞諛붾떎 ?щ? ?뺤씤
        const isCoastal = regName.includes('?곗븞諛붾떎') || regName.includes('?됱닔援ъ뿭');

        // 狩??댁젣 紐낅졊 泥섎━: ?곗븞諛붾떎/?됱닔援ъ뿭???댁젣???곕줈 湲곕줉
        if (cmd === '?댁젣') {
            if (isCoastal) {
                // ?곸쐞 ?댁뿭 李얘린 (?? "?쒖＜?꾩꽌遺?욌컮?ㅼ쨷?⑥꽌?곗븞諛붾떎" ??"?쒖＜?꾩꽌遺?욌컮??)
                let parentZone = null;
                for (const [mainZone, subZones] of Object.entries(COASTAL_MAPPING)) {
                    for (const sub of subZones) {
                        if (sub.fullName === regName) {
                            parentZone = mainZone;
                            break;
                        }
                    }
                    if (parentZone) break;
                }

                // ?먮뒗 "以? ?욌?遺?異붿텧
                if (!parentZone) {
                    const match = regName.match(/^(.+)以?.+)(?곗븞諛붾떎|?됱닔援ъ뿭)$/);
                    if (match) {
                        parentZone = match[1];
                    }
                }

                if (parentZone) {
                    if (!appState.releasedCoastalZones[parentZone]) {
                        appState.releasedCoastalZones[parentZone] = [];
                    }
                    // ?곗븞諛붾떎 ?대쫫 異붿텧 (?? "?쒖＜?꾩꽌遺?욌컮?ㅼ쨷?⑥꽌?곗븞諛붾떎" ??"?⑥꽌?곗븞諛붾떎")
                    const shortName = regName.replace(parentZone + '以?, '');
                    if (!appState.releasedCoastalZones[parentZone].includes(shortName)) {
                        appState.releasedCoastalZones[parentZone].push(shortName);
                        // console.log(`?뵑 ?곗븞諛붾떎 ?댁젣 媛먯?: ${regName} (?곸쐞: ${parentZone})`);
                    }
                }
            }
            // return; // [?섏젙] ?댁젣 紐낅졊?대룄 alerts???ы븿?쒖폒??愿由??⑤꼸?먯꽌 ?뺤씤 媛??
        }

        // 以묐났 泥댄겕 (媛숈? 援ъ뿭 + 媛숈? ?밸낫 醫낅쪟)
        const key = `${regId}_${wrnType}`;
        if (seenZones.has(key)) {
            return;
        }
        seenZones.add(key);

        // ?밸낫 ?섏? 蹂??
        const isPreliminary = (level === '?덈퉬' || cmd === '?덈낫');
        let levelText = level;
        if (isPreliminary) {
            levelText = '?덈퉬';
        } else if (level === '二쇱쓽') {
            levelText = '二쇱쓽蹂?;
        } else if (level === '寃쎈낫') {
            levelText = '寃쎈낫';
        }

        const alertData = {
            id: `${regId}_${wrnType}_${tmFc}`,
            zoneCode: regId,
            zoneName: regName,
            warnType: displayWarnType,  // ?먮낯 wrnType ???蹂?섎맂 ?쒖떆紐??ъ슜
            level: levelText,
            command: cmd,
            tmFc: tmFc,
            tmEf: tmEf,
            tmEd: edTm,
            isPreliminary: isPreliminary,
            isCoastal: isCoastal,
            source: 'HUB'
        };

        // 1. ?쒖쇅 ?뺣낫 ?뚯떛 (?? "?쒖＜?꾩꽌遺?욌컮???⑥꽌?곗븞諛붾떎 ?쒖쇅)")
        const exclusionParsed = parseExclusionFromZoneName(regName);
        if (exclusionParsed.excluded.length > 0) {
            alertData.zoneName = exclusionParsed.cleanZoneName;
            alertData.tempExclusions = exclusionParsed.excluded; // fetchAllData?먯꽌 ?ъ슜
        } else {
            // 2. ?쒖쇅 ?뺣낫媛 ?녿떎硫? ?쇰컲 愿꾪샇(?댁젣?덇퀬 ?? ?쒓굅
            const cleanNameMatch = regName.match(/^(.+?)\s*\(.*?\)$/);
            if (cleanNameMatch) {
                alertData.originalZoneName = regName;
                alertData.zoneName = cleanNameMatch[1].trim();
            }
        }

        // ?곗븞諛붾떎??蹂꾨룄 ???
        if (isCoastal) {
            if (!appState.coastalAlerts[alertData.zoneName]) {
                appState.coastalAlerts[alertData.zoneName] = [];
            }
            appState.coastalAlerts[alertData.zoneName].push(alertData);
        } else {
            alerts.push(alertData);
        }

        // console.log(`Added: ${alertData.zoneName} - ${wrnType}${levelText} ${isCoastal ? '(?곗븞)' : ''}`);
    });

    // console.log('Total main alerts:', alerts.length);
    // console.log('Total coastal alerts:', Object.keys(appState.coastalAlerts).length);
    // console.log('Released coastal zones:', appState.releasedCoastalZones);
    return alerts;
}

// --- MOCK DATA 鍮꾪솢?깊솕 (API ?ㅽ뙣 ??鍮??곗씠??諛섑솚) ---
function getMockAlerts() {
    // console.log('?좑툘 API ?곌껐 ?ㅽ뙣 - ?밸낫 ?곗씠???놁쓬');
    // ?붾? ?곗씠???쒓굅??- ?ㅼ젣 API ?곗씠?곕쭔 ?쒖떆
    appState.coastalAlerts = {};
    return [];
}

/**
 * 援ъ뿭紐낆뿉??"?쒖쇅" ?뺣낫 ?뚯떛
 */
function parseExclusionFromZoneName(zoneName) {
    if (!zoneName) return { cleanZoneName: '', excluded: [] };

    const match = zoneName.match(/^(.+?)\((.+??쒖쇅)\)$/);

    if (!match) {
        return { cleanZoneName: zoneName.trim(), excluded: [] };
    }

    const cleanZoneName = match[1].trim();
    const exclusionText = match[2].trim();

    const excludedPart = exclusionText.replace(/\s*?쒖쇅\s*$/, '');

    const excludedNames = excludedPart
        .split(/[쨌,??/)
        .map(name => name.trim())
        .filter(name => name.length > 0);

    // console.log(`?뵇 ?쒖쇅 ?뺣낫 ?뚯떛: "${zoneName}" ??援ъ뿭: "${cleanZoneName}", ?쒖쇅: [${excludedNames.join(', ')}]`);

    return { cleanZoneName, excluded: excludedNames };
}

// --- AFSO API (硫붿씤 ?댁뿭 + ?곗븞諛붾떎/?됱닔援ъ뿭 ?밸낫 議고쉶) ---
async function fetchAfsoData() {
    // 濡쒖뺄 ?쒕쾭??warnings.json???ы븿??afso ?곗씠???ъ슜
    const url = CONFIG.KMA_API_URL; // warnings.json

    // console.log('Fetching AFSO Data (Local):', url);

    try {
        // [Cache Busting] 釉뚮씪?곗? 罹먯떆 諛⑹?瑜??꾪빐 ??꾩뒪?ы봽 異붽?
        const response = await fetch(`${url}?_t=${Date.now()}`);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const jsonData = await response.json();
        const data = jsonData.afso; // warnings.json ?댁쓽 afso 媛앹껜

        if (!data) {
            // console.warn('AFSO Data missing in local file');
            return { mainAlerts: [], coastalAlerts: {} };
        }

        const metData = data.data?.metData || data.metData;

        if (!metData || metData.length === 0) {
            // console.warn('AFSO API: metData媛 ?놁뒿?덈떎.');
            return { mainAlerts: [], coastalAlerts: {} };
        }

        // console.log('AFSO API: 珥?, metData.length, '媛???ぉ ?섏떊');

        const mainAlerts = [];
        const coastalAlerts = {};
        const seenMain = new Set();

        for (const item of metData) {
            const regKo = (item.regKo || '').replace(/\s+/g, '').trim();

            // ?밸낫媛 ?녿뒗 寃쎌슦 嫄대꼫?곌린
            if (!item.wrnTp || item.wrnTp.trim() === '') {
                continue;
            }

            // ?섏? 諛??덈퉬 ?щ? 蹂??
            const isPreliminary = item.wrnLvl === '1';
            let level = item.wrnLvlName || '';
            if (isPreliminary) {
                level = '?덈퉬';
            } else if (level === '二쇱쓽') {
                level = '二쇱쓽蹂?;
            } else if (level === '寃쎈낫') {
                level = '寃쎈낫';
            }

            const warnType = item.wrnTp === '?댁씪' ? '??뭾?댁씪' : item.wrnTp;

            // ?곗븞諛붾떎/?됱닔援ъ뿭?몄? ?뺤씤
            const isCoastal = regKo.includes('?곗븞諛붾떎') || regKo.includes('?됱닔援?);

            // ?됱닔援ъ뿭 ?띿뒪???섎┝ 蹂댁젙
            let zoneName = regKo;
            if (zoneName.endsWith('?됱닔援?) && !zoneName.endsWith('?됱닔援ъ뿭')) {
                zoneName = zoneName + '??;
            }

            if (isCoastal) {
                // ?곗븞諛붾떎/?됱닔援ъ뿭? coastalAlerts?????
                if (!coastalAlerts[zoneName]) {
                    coastalAlerts[zoneName] = [];
                }

                // 以묐났 泥댄겕 (媛숈? 援ъ뿭 + 媛숈? ?밸낫 醫낅쪟)
                const isExists = coastalAlerts[zoneName].some(a => a.warnType === warnType);
                if (!isExists) {
                    coastalAlerts[zoneName].push({
                        id: `afso_${item.regId}_${item.wrnTp}`,
                        zoneName: zoneName,
                        warnType: warnType,
                        level: level,
                        command: item.wrnCmd || '諛쒗몴',
                        tmFc: decodeHtmlEntities(item.tmFc || ''),
                        tmEf: decodeHtmlEntities(item.tmEf || ''),
                        tmEd: decodeHtmlEntities(item.tmEd || ''),
                        isPreliminary: isPreliminary,
                        isCoastal: true,
                        source: 'AFSO'
                    });
                    // console.log(`?뙄 ?곗븞/?됱닔援ъ뿭: ${zoneName} - ${warnType} ${level}`);
                }
            } else {
                // 硫붿씤 ?댁뿭? mainAlerts?????(以묐났 諛⑹?)
                const key = `${zoneName}_${warnType}`;
                if (!seenMain.has(key)) {
                    seenMain.add(key);
                    mainAlerts.push({
                        id: `afso_${item.regId}_${item.wrnTp}`,
                        zoneName: zoneName,
                        warnType: warnType,
                        level: level,
                        command: item.wrnCmd || '諛쒗몴',
                        tmFc: decodeHtmlEntities(item.tmFc || ''),
                        tmEf: decodeHtmlEntities(item.tmEf || ''),
                        tmEd: decodeHtmlEntities(item.tmEd || ''),
                        isPreliminary: isPreliminary,
                        isCoastal: false,
                        source: 'AFSO'
                    });
                    // console.log(`?뙄 硫붿씤 ?댁뿭: ${zoneName} - ${warnType} ${level}`);
                }
            }
        }

        // console.log('AFSO API: 硫붿씤 ?댁뿭', mainAlerts.length, '媛? ?곗븞/?됱닔援ъ뿭', Object.keys(coastalAlerts).length, '媛?異붿텧');
        return { mainAlerts, coastalAlerts };

    } catch (e) {
        // console.error('AFSO API Error:', e.message);
        return { mainAlerts: [], coastalAlerts: {} };
    }
}

// --- BUOY API (?댁뼇愿痢??곗씠?? ---
async function fetchBuoyData() {
    // 濡쒖뺄 ?쒕쾭 buoys.json 議고쉶
    const url = CONFIG.BUOY_API_URL;

    // console.log('Fetching Buoy Data (Local):', url);

    try {
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const jsonData = await response.json();
        // buoys.json 援ъ“: { updatedAt: ..., raw: "RAW TEXT" }
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
        // ?ㅻ뜑/二쇱꽍 ?쇱씤 嫄대꼫?곌린
        if (line.startsWith('#') || line.trim() === '') return;

        // 泥?紐?以??붾쾭源?
        if (idx < 3) {
            // console.log('Line', idx, ':', line.substring(0, 100));
        }

        // 怨듬갚?쇰줈 遺꾨━ (KMA API??二쇰줈 怨듬갚 援щ텇)
        const parts = line.split(/\s+/).map(p => p.trim()).filter(p => p);

        // sea_obs.php ?묐떟 ?щ㎎:
        // TP, STN_ID, STN_KO, TM, WH, WD, WS, WS_GST, TW, TA, PA, HM
        if (parts.length < 6) return;

        try {
            // ?ㅼ젣 API ?묐떟 ?뺤떇 (肄섏넄?먯꽌 ?뺤씤):
            // TP(0), TM(1), STN_ID(2), STN_KO(3), LON(4), LAT(5), WH(6), WD(7), WS(8), WS_GST(9), TW(10), TA(11), PA(12), HM(13)
            const tp = parts[0];
            const tm = parts[1];
            let stnId = parts[2].replace(/,/g, '').trim();  // ?쇳몴 ?쒓굅!
            const stnName = parts[3] ? parts[3].replace(/,/g, '').trim() : stnId;

            // stnId ?좏슚??寃??
            if (!stnId || stnId.length > 8 || stnId.length < 3) return;

            // -99??寃곗륫媛?愿痢?遺덇?)?대?濡?null濡?泥섎━
            const parseValue = (val) => {
                const num = parseFloat(val);
                return (isNaN(num) || num <= -99) ? null : num;
            };

            // ?щ컮瑜??몃뜳??(LON=4, LAT=5 嫄대꼫?곌퀬 WH=6遺??
            const wh = parseValue(parts[6]);      // ?좎쓽?뚭퀬
            const wd = parseValue(parts[7]);      // ?랁뼢
            const ws = parseValue(parts[8]);      // ?띿냽
            const wsGust = parseValue(parts[9]);  // ?뚰뭾
            const tw = parseValue(parts[10]);     // ?섏삩
            const ta = parseValue(parts[11]);     // 湲곗삩
            const pa = parseValue(parts[12]);     // 湲곗븬
            const hm = parseValue(parts[13]);     // ?듬룄

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

            // 泥섏쓬 3媛??뚯떛 寃곌낵 異쒕젰
            if (Object.keys(buoyData).length <= 3) {
                // console.log('??Parsed:', stnId, stnName, '?뚭퀬:', wh, '?띿냽:', ws);
            }
        } catch (e) {
            // console.warn('Buoy parse error at line', idx, e);
        }
    });

    // console.log('Parsed buoy station IDs:', Object.keys(buoyData).slice(0, 10));

    return buoyData;
}

// 遺???곗씠???놁쓬 (API ?ㅽ뙣 ??
function getMockBuoyData() {
    // console.log('Buoy API returned no data');
    return {};
}

// ?랁뼢??諛⑹쐞濡?蹂??
function getWindDirectionText(degree) {
    if (degree === null || degree === undefined) return '-';
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
        'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const index = Math.round(degree / 22.5) % 16;
    return directions[index];
}


// ============================================================================
// ?곗븞諛붾떎 ?쒖쇅 濡쒖쭅 (Coastal Exclusion Logic)
// ============================================================================
// 
// ?듭떖 ?먮━:
// 1. 硫붿씤 ?댁뿭(?? "?쒖＜?꾩꽌遺?욌컮??)???밸낫媛 諛쒗슚?섎㈃
//    ???대떦 ?댁뿭???랁븳 紐⑤뱺 ?곗븞諛붾떎/?됱닔援ъ뿭???먮룞?쇰줈 ?밸낫 ?곸슜
// 2. ?? "?쒖쇅" 臾멸뎄媛 ?덉쑝硫??대떦 ?곗븞諛붾떎/?됱닔援ъ뿭? ?밸낫?먯꽌 ?쒖쇅
//    ?? "?쒖＜?꾩꽌遺?욌컮???⑥꽌?곗븞諛붾떎 ?쒖쇅)" 
//    ???⑥꽌?곗븞諛붾떎留??쒖쇅, ?섎㉧吏(遺곸꽌?곗븞諛붾떎, 媛?뚮룄?곗븞諛붾떎)???밸낫 諛쒗슚
// ============================================================================

/**
 * 硫붿씤 ?댁뿭 ?밸낫瑜?湲곕컲?쇰줈 ?곗븞諛붾떎/?됱닔援ъ뿭 ?밸낫 ?곹깭瑜??먮룞 ?앹꽦
 * 
 * @param {Object} exclusionInfo - ?쒖쇅 ?뺣낫 媛앹껜 (?댁뿭紐????쒖쇅???곗븞諛붾떎 紐⑸줉)
 *   ?? { '?쒖＜?꾩꽌遺?욌컮??: ['?⑥꽌?곗븞諛붾떎'], '?쒖＜?꾨룞遺?욌컮??: ['?곕룄?곗븞諛붾떎', '?⑤룞?곗븞諛붾떎'] }
 */
function processCoastalWarningStatus(exclusionInfo = {}) {
    // console.log('=== ?곗븞諛붾떎 ?밸낫 ?곹깭 泥섎━ ?쒖옉 ===');
    // console.log('?쒖쇅 ?뺣낫:', exclusionInfo);

    // 媛?硫붿씤 ?댁뿭 ?밸낫?????泥섎━
    for (const mainAlert of appState.alerts) {
        const mainZoneName = mainAlert.zoneName;
        const warnType = mainAlert.warnType;
        const level = mainAlert.level;

        // COASTAL_MAPPING?먯꽌 ?대떦 硫붿씤 ?댁뿭???곗븞諛붾떎/?됱닔援ъ뿭 李얘린
        const subZones = COASTAL_MAPPING[mainZoneName];
        if (!subZones || subZones.length === 0) {
            continue; // ?곗븞諛붾떎媛 ?녿뒗 ?댁뿭? 臾댁떆
        }

        // ?쒖쇅???곗븞諛붾떎 紐⑸줉 媛?몄삤湲?
        const excludedNames = exclusionInfo[mainZoneName] || [];

        // console.log(`?뱧 ${mainZoneName} (${warnType} ${level}):`);
        // console.log(`   - ?섏쐞 援ъ뿭: ${subZones.map(s => s.name).join(', ')}`);
        // console.log(`   - ?쒖쇅 援ъ뿭: ${excludedNames.length > 0 ? excludedNames.join(', ') : '?놁쓬'}`);

        // 媛??곗븞諛붾떎/?됱닔援ъ뿭??????밸낫 ?곹깭 寃곗젙
        for (const subZone of subZones) {
            const fullName = subZone.fullName;
            const shortName = subZone.name;

            // ?쒖쇅 ?щ? ?뺤씤 (?ㅼ뼇???⑦꽩 留ㅼ묶)
            const isExcluded = excludedNames.some(excluded => {
                const normalizedExcluded = excluded.replace(/\s+/g, '').replace(/?곗븞諛붾떎$/, '').replace(/?됱닔援ъ뿭$/, '');
                const normalizedShort = shortName.replace(/\s+/g, '').replace(/?곗븞諛붾떎$/, '').replace(/?됱닔援ъ뿭$/, '');
                const normalizedFull = fullName.replace(/\s+/g, '');

                return normalizedExcluded === normalizedShort ||
                    normalizedExcluded === normalizedFull ||
                    fullName.includes(excluded) ||
                    shortName.includes(excluded);
            });

            if (isExcluded) {
                // ?쒖쇅??寃쎌슦: coastalAlerts?먯꽌 ?쒓굅 (?대? ?덈떎硫?
                if (appState.coastalAlerts[fullName]) {
                    delete appState.coastalAlerts[fullName];
                    // console.log(`   ???쒖쇅: ${fullName}`);
                }
            } else {
                // ?쒖쇅?섏? ?딆? 寃쎌슦: coastalAlerts??異붽? (?녿떎硫?
                const alertKey = `${fullName}_${warnType}`;
                if (!appState.coastalAlerts[fullName] ||
                    appState.coastalAlerts[fullName].warnType !== warnType) {
                    appState.coastalAlerts[fullName] = {
                        id: `auto_${fullName}_${warnType}`,
                        zoneName: fullName,
                        warnType: warnType,
                        level: level,
                        command: mainAlert.command || '諛쒗몴',
                        tmFc: mainAlert.tmFc,
                        tmEf: mainAlert.tmEf,
                        tmEd: mainAlert.tmEd,
                        isPreliminary: mainAlert.isPreliminary,
                        isCoastal: true,
                        source: 'AUTO_FROM_MAIN',
                        parentZone: mainZoneName
                    };
                    // console.log(`   ???곸슜: ${fullName}`);
                }
            }
        }
    }

    // console.log('=== ?곗븞諛붾떎 ?밸낫 ?곹깭 泥섎━ ?꾨즺 ===');
    // console.log('理쒖쥌 ?곗븞諛붾떎 ?밸낫 ??', Object.keys(appState.coastalAlerts).length);
}

/**
 * 援ъ뿭紐낆뿉??"?쒖쇅" ?뺣낫 ?뚯떛
 * ?? "?쒖＜?꾩꽌遺?욌컮???⑥꽌?곗븞諛붾떎 ?쒖쇅)" ??{ '?쒖＜?꾩꽌遺?욌컮??: ['?⑥꽌?곗븞諛붾떎'] }
 * ?? "?쒖＜?꾨룞遺?욌컮??遺곷룞쨌?⑤룞?곗븞諛붾떎 ?쒖쇅)" ??{ '?쒖＜?꾨룞遺?욌컮??: ['遺곷룞?곗븞諛붾떎', '?⑤룞?곗븞諛붾떎'] }
 * 
 * @param {string} zoneName - ?밸낫 援ъ뿭紐?(?쒖쇅 ?뺣낫 ?ы븿 媛??
 * @returns {Object} - { cleanZoneName: '?뺤젣??援ъ뿭紐?, excluded: ['?쒖쇅???곗븞諛붾떎 紐⑸줉'] }
 */
function parseExclusionFromZoneName(zoneName) {
    if (!zoneName) return { cleanZoneName: '', excluded: [] };

    // 愿꾪샇 ?덉쓽 ?쒖쇅 ?뺣낫 異붿텧
    // ?⑦꽩: "援ъ뿭紐??쒖쇅 ?뺣낫)"
    const match = zoneName.match(/^(.+?)\((.+??쒖쇅)\)$/);

    if (!match) {
        return { cleanZoneName: zoneName.trim(), excluded: [] };
    }

    const cleanZoneName = match[1].trim();
    const exclusionText = match[2].trim();

    // "?쒖쇅" ?욎쓽 ?곗븞諛붾떎 ?대쫫 異붿텧
    // ?? "?⑥꽌?곗븞諛붾떎 ?쒖쇅", "遺곷룞쨌?⑤룞?곗븞諛붾떎 ?쒖쇅", "遺곸꽌?곗븞諛붾떎, 媛?뚮룄?곗븞諛붾떎 ?쒖쇅"
    const excludedPart = exclusionText.replace(/\s*?쒖쇅\s*$/, '');

    // 援щ텇?먮줈 遺꾨━ (쨌, ,, ??
    const excludedNames = excludedPart
        .split(/[쨌,??/)
        .map(name => name.trim())
        .filter(name => name.length > 0);

    // console.log(`?뵇 ?쒖쇅 ?뺣낫 ?뚯떛: "${zoneName}" ??援ъ뿭: "${cleanZoneName}", ?쒖쇅: [${excludedNames.join(', ')}]`);

    return { cleanZoneName, excluded: excludedNames };
}

/**
 * WthrInfo t1 ?꾨뱶 ?먮뒗 Portal ?띿뒪?몄뿉???꾩껜 ?쒖쇅 ?뺣낫 異붿텧
 * 
 * @param {string} text - ?밸낫 ?꾪솴 ?띿뒪??
 * @returns {Object} - ?댁뿭蹂??쒖쇅 ?뺣낫 { '?댁뿭紐?: ['?쒖쇅???곗븞諛붾떎/?됱닔援ъ뿭 紐⑸줉'] }
 */
function parseAllExclusionInfo(text) {
    const exclusionInfo = {};

    if (!text) return exclusionInfo;

    // "援ъ뿭紐??곗븞諛붾떎 ?쒖쇅)" ?먮뒗 "援ъ뿭紐??됱닔援ъ뿭 ?쒖쇅)" ?⑦꽩 李얘린
    // ?? "?쒖＜?꾩꽌遺?욌컮??遺곸꽌?곗븞諛붾떎 ?쒖쇅)", "?몄쿇쨌寃쎄린?⑤??욌컮??癒쇳룊?섍뎄???쒖쇅)"
    // ?? "異⑸궓遺곷??욌컮??泥쒖닔留뚰룊?섍뎄??룸떦吏꾪룊?섍뎄???쒖쇅)"
    const pattern = /([媛-?Ｂ?+(?:?욌컮??癒쇰컮??)\(([^)]+(?:?곗븞諛붾떎|?됱닔援ъ뿭)[^)]*?쒖쇅)\)/g;
    let match;

    while ((match = pattern.exec(text)) !== null) {
        const zoneName = match[1];
        const exclusionText = match[2];

        // "?쒖쇅" ?욎쓽 ?곗븞諛붾떎/?됱닔援ъ뿭 ?대쫫 異붿텧
        const excludedPart = exclusionText.replace(/\s*?쒖쇅\s*$/g, '');

        // 援щ텇?먮줈 遺꾨━ (쨌, ,, ??
        const excludedNames = excludedPart
            .split(/[쨌,??/)
            .map(name => {
                let cleaned = name.trim();
                // "?곗븞諛붾떎" ?먮뒗 "?됱닔援ъ뿭" ?묐??ш? ?놁쑝硫?異붽?
                if (cleaned && !cleaned.endsWith('?곗븞諛붾떎') && !cleaned.endsWith('?됱닔援ъ뿭')) {
                    // ?먮낯 ?띿뒪?몄뿉???대뼡 ??낆씤吏 ?뺤씤
                    if (exclusionText.includes('?됱닔援ъ뿭') && !exclusionText.includes('?곗븞諛붾떎')) {
                        cleaned += '?됱닔援ъ뿭';
                    } else if (exclusionText.includes('?곗븞諛붾떎') && !exclusionText.includes('?됱닔援ъ뿭')) {
                        cleaned += '?곗븞諛붾떎';
                    }
                    // ?????덇굅???놁쑝硫??먮낯 洹몃?濡??좎?
                }
                return cleaned;
            })
            .filter(name => name.length > 0);

        if (excludedNames.length > 0) {
            // 湲곗〈 ??ぉ??異붽? (媛숈? ?댁뿭???щ윭 ?쒖쇅 ?뺣낫媛 ?덉쓣 ???덉쓬)
            if (exclusionInfo[zoneName]) {
                exclusionInfo[zoneName].push(...excludedNames);
            } else {
                exclusionInfo[zoneName] = excludedNames;
            }
            // console.log(`?뱥 ?쒖쇅 ?뺣낫 異붿텧: ${zoneName} ??[${excludedNames.join(', ')}]`);
        }
    }

    return exclusionInfo;
}

/**
 * 硫붿씤 ?댁뿭???밸낫媛 ?덉쓣 ?? ?대떦 ?곗븞諛붾떎???밸낫 ?곹깭 ?뺤씤
 * 
 * @param {string} coastalZoneName - ?곗븞諛붾떎 ?꾩껜 ?대쫫 (?? "?쒖＜?꾩꽌遺?욌컮?ㅼ쨷?⑥꽌?곗븞諛붾떎")
 * @param {string} warnType - ?밸낫 醫낅쪟 (?띾옉, ?쒗뭾, ?댁씪)
 * @returns {Object|null} - ?밸낫 ?뺣낫 ?먮뒗 null (?밸낫 ?놁쓬)
 */
function getCoastalWarningStatus(coastalZoneName, warnType) {
    // 1. coastalAlerts??吏곸젒 ?덈뒗吏 ?뺤씤
    const directAlert = appState.coastalAlerts[coastalZoneName];
    if (directAlert && directAlert.warnType === warnType) {
        return directAlert;
    }

    // 2. ?곸쐞 ?댁뿭 李얘린
    let parentZoneName = null;
    for (const [mainZone, subZones] of Object.entries(COASTAL_MAPPING)) {
        for (const sub of subZones) {
            if (sub.fullName === coastalZoneName) {
                parentZoneName = mainZone;
                break;
            }
        }
        if (parentZoneName) break;
    }

    if (!parentZoneName) return null;

    // 3. ?곸쐞 ?댁뿭???밸낫媛 ?덈뒗吏 ?뺤씤
    const parentAlert = appState.alerts.find(a =>
        a.zoneName === parentZoneName && a.warnType === warnType
    );

    if (!parentAlert) return null;

    // 4. ?곸쐞 ?댁뿭???밸낫媛 ?덉쑝硫??곗븞諛붾떎???밸낫 諛쒗슚
    // (processCoastalWarningStatus?먯꽌 ?쒖쇅 泥섎━媛 ?대? ?섏뼱 ?덉뼱????
    return {
        ...parentAlert,
        zoneName: coastalZoneName,
        isCoastal: true,
        source: 'INHERITED_FROM_MAIN',
        parentZone: parentZoneName
    };
}

// ----------------------------------------------------------------------------
// UI Rendering
// ----------------------------------------------------------------------------

// API ?곹깭 ?쒖떆 愿由ъ옄 (濡ㅻ쭅 ????뺤쟻 ?쒖떆)
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

        // ?먮윭 ?쒖떆 濡쒖쭅 ?쒓굅 (??긽 ?쒓컙 ?쒖떆)
        const time = new Date(); // ??긽 ?꾩옱 ?쒓컙 ?쒖떆 (?ъ슜???붿껌: ?먮룞 ?낅뜲?댄듃 諛??곗륫 ?쒓퀎? ?숆린??
        const hours = time.getHours();
        const minutes = String(time.getMinutes()).padStart(2, '0');
        const ampm = hours < 12 ? '?ㅼ쟾' : '?ㅽ썑';
        const displayHour = hours === 0 ? 12 : (hours > 12 ? hours - 12 : hours);

        const html = `<li><span class="status-update-time">理쒓렐 ?낅뜲?댄듃: ${ampm} ${displayHour}:${minutes}</span></li>`;

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

// --- ?밸낫 ?뺣젹 ?⑥닔 ---
// ?뺣젹 ?곗꽑?쒖쐞: 1) ?밸낫醫낅쪟(?쒗뭾 > 吏吏꾪빐??> ??뭾?댁씪 > ?띾옉), 2) 寃쎈낫 > 二쇱쓽蹂?
// 3) ?욌컮??> 癒쇰컮?? 4) ?욌컮?? 遺곷??믩궓遺?믪꽌遺?믩룞遺, 5) 癒쇰컮?? ?덉そ?믩컮源μそ
function sortAlertItems(items) {
    const TYPE_ORDER = { '?쒗뭾': 1, '吏吏꾪빐??: 2, '??뭾?댁씪': 3, '?띾옉': 4 };
    const DIRECTION_ORDER = { '遺곷?': 1, '?⑤?': 2, '?쒕?': 3, '?숇?': 4 };
    const FAR_SEA_ORDER = { '?덉そ': 1, '諛붽묑': 2 };

    // 洹몃９?붾맂 ?꾩씠??諛곗뿴)??寃쎌슦 媛???믪? ?쒖쐞???밸낫瑜?諛섑솚?섎뒗 ?ы띁
    const getRepresentativeAlert = (item) => {
        if (!Array.isArray(item)) return item;
        if (item.length === 0) return null;

        // 洹몃９ ?대? ?뺣젹 (媛???믪? ?곗꽑?쒖쐞媛 0踰덉쑝濡?
        const sorted = [...item].sort((a, b) => {
            const aTypeWeight = TYPE_ORDER[a.warnType] || 99;
            const bTypeWeight = TYPE_ORDER[b.warnType] || 99;
            if (aTypeWeight !== bTypeWeight) return aTypeWeight - bTypeWeight;

            if (a.level === '寃쎈낫' && b.level !== '寃쎈낫') return -1;
            if (a.level !== '寃쎈낫' && b.level === '寃쎈낫') return 1;

            return 0;
        });
        return sorted[0];
    };

    // 援ъ뿭紐낆뿉???뺣젹 媛以묒튂 怨꾩궛
    const getZoneSortWeight = (zoneName) => {
        if (!zoneName) return 9999;
        const isNearSea = zoneName.includes('?욌컮??);
        const isFarSea = zoneName.includes('癒쇰컮??);
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
            if (zoneName.includes('?덉そ')) farSeaWeight = 1;
            else if (zoneName.includes('諛붽묑')) farSeaWeight = 2;
        }

        return seaTypeWeight + directionWeight * 10 + farSeaWeight;
    };

    const isWarning = (item) => {
        const rep = getRepresentativeAlert(item);
        return rep && rep.level === '寃쎈낫';
    };

    return [...items].sort((a, b) => {
        const repA = getRepresentativeAlert(a);
        const repB = getRepresentativeAlert(b);

        if (!repA) return 1;
        if (!repB) return -1;

        // 1. ?밸낫 醫낅쪟 ?곗꽑?쒖쐞 (?쒗뭾?믪?吏꾪빐?쇄넂??뭾?댁씪?믫뭾??
        const aTypeWeight = TYPE_ORDER[repA.warnType] || 99;
        const bTypeWeight = TYPE_ORDER[repB.warnType] || 99;
        if (aTypeWeight !== bTypeWeight) {
            return aTypeWeight - bTypeWeight;
        }

        // 2. 寃쎈낫媛 二쇱쓽蹂대낫???곷떒
        const aIsWarning = isWarning(a);
        const bIsWarning = isWarning(b);
        if (aIsWarning && !bIsWarning) return -1;
        if (!aIsWarning && bIsWarning) return 1;

        // 3. 援ъ뿭 ?뺣젹 (?욌컮?ㅲ넂癒쇰컮?? 諛⑺뼢?쒖꽌)
        const aWeight = getZoneSortWeight(repA.zoneName);
        const bWeight = getZoneSortWeight(repB.zoneName);

        return aWeight - bWeight;
    });
}

function renderApp() {
    const seaSections = {
        '?숉빐': document.getElementById('east-sea-list'),
        '?쒗빐': document.getElementById('west-sea-list'),
        '?⑦빐': document.getElementById('south-sea-list'),
        '?쒖＜': document.getElementById('jeju-sea-list')
    };

    const seaCounts = {
        '?숉빐': document.getElementById('east-count'),
        '?쒗빐': document.getElementById('west-count'),
        '?⑦빐': document.getElementById('south-count'),
        '?쒖＜': document.getElementById('jeju-count')
    };

    // Clear content
    Object.values(seaSections).forEach(el => {
        if (el) el.innerHTML = '';
    });

    let counts = { '?숉빐': 0, '?쒗빐': 0, '?⑦빐': 0, '?쒖＜': 0 };

    // Group by Sea (?遺꾨쪟) and SubRegion (以묐텇瑜?
    const groups = {};        // ?遺꾨쪟蹂?洹몃９: { '?숉빐': [[alert1, alert2], [alert3]], ... }
    const subGroups = {};     // 以묐텇瑜섎퀎 洹몃９: { '?숉빐?⑤??댁긽': [[alert1, alert2]], ... }

    // [New] ?숈씪 援ъ뿭???밸낫瑜??섎굹濡?臾띔린
    const zoneAlertsMap = {};

    // 1. 硫붿씤 ?밸낫 ?곗씠??湲곕컲?쇰줈 留?援ъ꽦
    appState.alerts.forEach(item => {
        if (item.isCoastal) return;
        if (typeof UserSettings !== 'undefined' && !UserSettings.isVisible(item.zoneName)) return;

        if (!zoneAlertsMap[item.zoneName]) {
            zoneAlertsMap[item.zoneName] = [];
        }
        zoneAlertsMap[item.zoneName].push(item);
    });

    // 2. [?섏젙] ?곗븞諛붾떎/?됱닔援ъ뿭 ?밸낫媛 ?덈뒗 寃쎌슦, ?대떦 ?곸쐞 援ъ뿭(Parent)??留듭뿉 異붽?
    // (硫붿씤 ?밸낫媛 ?녿뜑?쇰룄 ?곗븞 ?밸낫瑜?蹂댁뿬二쇨린 ?꾪빐 移대뱶瑜??앹꽦?댁빞 ??
    if (appState.coastalAlerts) {
        for (const [coastalName, alerts] of Object.entries(appState.coastalAlerts)) {
            if (alerts && alerts.length > 0) {
                // ???곗븞援ъ뿭???랁븳 紐⑤뱺 ?곸쐞 援ъ뿭(Parent) 李얘린
                for (const [parentName, subZones] of Object.entries(COASTAL_MAPPING)) {
                    // 怨듬갚 ?쒓굅 ??鍮꾧탳?섏뿬 留ㅼ묶?섎뒗 ?쒕툕援ъ뿭 ?뺤씤
                    const isMatch = subZones.some(sz => (sz.fullName || '').replace(/\s+/g, '') === coastalName.replace(/\s+/g, ''));

                    if (isMatch) {
                        // ?ъ슜?먭? ?ㅼ젙?먯꽌 ?④릿 援ъ뿭? 嫄대꼫?
                        if (typeof UserSettings !== 'undefined' && !UserSettings.isVisible(parentName)) continue;

                        if (!zoneAlertsMap[parentName]) {
                            // 硫붿씤 ?밸낫媛 ?녿뒗 寃쎌슦 ?붾? 媛앹껜 ?섎굹 異붽? (援ъ뿭紐?蹂댁〈 諛??먮윭 諛⑹???
                            // dummy: true ?띿꽦???듯빐 硫붿씤 ?밸낫媛 ?놁쓬??createAlertElement?먯꽌 ?????덉쓬
                            zoneAlertsMap[parentName] = [{
                                zoneName: parentName,
                                isDummy: true,
                                // 湲곕낯媛??ㅼ젙
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
        const subRegion = getSubRegion(zoneName) || '湲고?';
        const mainRegion = getMainRegion(subRegion);

        // ?遺꾨쪟 洹몃９??諛곗뿴(items) 異붽?
        if (!groups[mainRegion]) groups[mainRegion] = [];
        groups[mainRegion].push(items);

        // 以묐텇瑜?洹몃９??諛곗뿴(items) 異붽?
        if (!subGroups[subRegion]) subGroups[subRegion] = [];
        subGroups[subRegion].push(items);
    });

    // console.log('Grouped items:', zoneAlertsMap);

    // Render with 2-level structure
    for (const [mainRegion, mainItems] of Object.entries(groups)) {
        if (!seaSections[mainRegion]) continue;

        const container = seaSections[mainRegion];

        // ?대떦 ?遺꾨쪟??以묐텇瑜?紐⑸줉
        const subRegionList = SEA_REGIONS[mainRegion]?.subRegions || [];

        // ?쒖＜??以묐텇瑜섍? ?섎굹肉먯씠誘濡??쒕툕?ㅻ뜑 ?놁씠 諛붾줈 ?뚮뜑留?
        if (mainRegion === '?쒖＜' || subRegionList.length <= 1) {
            // ?뺣젹?섏뿬 ?뚮뜑留?
            const sortedItems = sortAlertItems(mainItems);
            sortedItems.forEach(item => {
                counts[mainRegion]++;
                container.appendChild(createAlertElement(item));
            });
        } else {
            // 以묐텇瑜섎퀎濡??쒕툕 ?뱀뀡 ?앹꽦
            subRegionList.forEach(subRegion => {
                const subItems = subGroups[subRegion];
                if (!subItems || subItems.length === 0) return;

                // ?쒕툕 ?뱀뀡 而⑦뀒?대꼫
                const subSection = document.createElement('div');
                subSection.className = 'sub-region-section';
                subSection.style.marginBottom = '14px';

                // ?쒕툕 ?ㅻ뜑 (以묐텇瑜섎챸) - ?댁뿭蹂대떎 ?묎퀬, ?밸낫援ъ뿭蹂대떎 ?ш쾶
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
                    <i class="fa-solid fa-chevron-right" style="font-size: 0.85rem; color: #4fc3f7; transition: transform 0.3s;"></i>
                    <span style="font-size: 1.0rem; font-weight: 700; color: #fff;">${subRegion}</span>
                    <span style="background: rgba(255, 152, 0, 0.4); padding: 4px 12px; border-radius: 12px; font-size: 0.85rem; font-weight: 600; color: #ffd54f; margin-left: auto;">${subItems.length}媛??댁뿭</span>
                `;

                // ?몃쾭 ?④낵 (洹몃씪?붿뼵?몃쭔 蹂寃? ?대룞 ?놁쓬)
                subHeader.onmouseenter = () => {
                    subHeader.style.background = 'linear-gradient(135deg, rgba(40, 80, 140, 0.9), rgba(52, 102, 180, 0.7))';
                };
                subHeader.onmouseleave = () => {
                    subHeader.style.background = 'linear-gradient(135deg, rgba(30, 60, 114, 0.8), rgba(42, 82, 152, 0.6))';
                };

                // 紐⑸줉 而⑦뀒?대꼫 (湲곕낯: ?④?)
                const listContainer = document.createElement('div');
                listContainer.className = 'sub-region-list';
                listContainer.style.display = 'none';
                listContainer.style.paddingLeft = '12px';

                // ?좉? 湲곕뒫 (諛고???紐⑤뱶: ?섎굹留??대┝, ?щ씪?대뱶 ?좊땲硫붿씠??
                subHeader.onclick = () => {
                    const isCurrentlyHidden = listContainer.style.display === 'none';

                    // 媛숈? ?遺꾨쪟 ??紐⑤뱺 以묐텇瑜??꾩퐫?붿뼵 ?リ린 (?좊땲硫붿씠??
                    const parentSection = subSection.closest('.sea-section') || container;
                    parentSection.querySelectorAll('.sub-region-list').forEach(list => {
                        if (list !== listContainer && list.style.display !== 'none') {
                            slideUp(list);
                        }
                        const header = list.previousElementSibling;
                        if (header && list !== listContainer) {
                            const icon = header.querySelector('.fa-chevron-right');
                            if (icon) icon.style.transform = 'rotate(0deg)';
                            header.style.marginLeft = '0';
                        }
                    });

                    // ?대┃??寃껋씠 ?ロ??덉뿀?ㅻ㈃ ?닿린 (?좊땲硫붿씠??
                    if (isCurrentlyHidden) {
                        slideDown(listContainer);
                        const icon = subHeader.querySelector('.fa-chevron-right');
                        if (icon) icon.style.transform = 'rotate(90deg)';
                        subHeader.style.marginLeft = '4px';
                    } else {
                        slideUp(listContainer);
                        const icon = subHeader.querySelector('.fa-chevron-right');
                        if (icon) icon.style.transform = 'rotate(0deg)';
                        subHeader.style.marginLeft = '0';
                    }
                };

                // ?꾩씠??異붽? (?뺣젹 ?곸슜)
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

    // API ?먮윭 泥섎━
    if (appState.hasApiError) {
        if (errorMsg) errorMsg.classList.remove('hidden');

        // 紐⑤뱺 ?댁뿭 ?뱀뀡 ?④린湲?(count-badge ?깆? 臾댁떆??
        for (const [sea, section] of Object.entries(seaSections)) {
            if (section && section.parentElement) {
                section.parentElement.style.display = 'none';
            }
        }
        return; // ?먮윭 ?곹깭?먯꽌???ш린???뚮뜑留?醫낅즺
    } else {
        // ?뺤긽 ?곹깭: ?먮윭 硫붿떆吏 ?④린怨??뱀뀡 ?쒖떆 蹂듦뎄
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
                    seaCounts[sea].textContent = `${count}媛??댁뿭`;

                    if (count === 0) {
                        // ?밸낫媛 ?놁쑝硫??꾩퐫?붿뼵 ?먯껜瑜??④?
                        sectionContainer.style.display = 'none';
                    } else {
                        // ?밸낫媛 ?덉쑝硫??쒖떆
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

    // [New] ?꾪꽣留곷맂 ?뚮┝ 紐⑸줉 ?ш뎄??(?ш린???ㅼ떆 怨꾩궛?댁빞 ?뺥솗??
    const filteredAlerts = appState.alerts.filter(a => {
        if (typeof UserSettings !== 'undefined') {
            return UserSettings.isVisible(a.zoneName);
        }
        return true;
    });

    // Count Active vs Preliminary (?꾪꽣留곷맂 紐⑸줉 湲곗?)
    const now = getKfTime();
    const activeCount = filteredAlerts.filter(a => {
        if (a.isPreliminary) return false;
        const cleanEf = String(a.tmEf || '').replace(/[^0-9]/g, '');
        if (cleanEf && cleanEf.length >= 12 && now < cleanEf) return false; // 諛쒗슚 ?湲?以묒씤 寃쎌슦 ?쒖꽦?먯꽌 ?쒖쇅
        return true;
    }).length;

    const prelimCount = filteredAlerts.filter(a => {
        if (a.isPreliminary) return true;
        const cleanEf = String(a.tmEf || '').replace(/[^0-9]/g, '');
        return !!(cleanEf && cleanEf.length >= 12 && now < cleanEf); // 諛쒗슚 ?湲?以묒씤 寃쎌슦 ?덈퉬/?湲곕줈 痍④툒
    }).length;

    const totalCount = activeCount + prelimCount;

    // [New] ?ㅻ뜑 ?띿뒪??蹂寃?濡쒖쭅
    // ?꾪꽣留??щ? ?뺤씤: UserSettings.settings??false媛 ?섎굹?쇰룄 ?덉쑝硫??꾪꽣留곷맂 寃껋쑝濡?媛꾩＜
    let isFiltered = false;
    if (typeof UserSettings !== 'undefined') {
        const settingsValues = Object.values(UserSettings.settings);
        // ?ㅼ젙媛믪씠 ?섎굹?쇰룄 ?덇퀬, 洹?以?false??寃껋씠 ?덉쑝硫??꾪꽣留??곹깭
        // (湲곕낯媛믪? undefined?????덉쑝??settings 媛앹껜????λ맂 媛믪? true/false??
        if (settingsValues.length > 0 && settingsValues.includes(false)) {
            isFiltered = true;
        }
    }

    // 1. ?밸낫 ?꾪솴 ?ㅻ뜑
    const sectionTitle = document.querySelector('#main-accordion-header .section-title');
    if (sectionTitle) {
        if (isFiltered) {
            sectionTitle.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> 吏?뺥빐??퀎 ?밸낫?꾪솴';
        } else {
            sectionTitle.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ?댁뿭蹂??밸낫?꾪솴';
        }
    }

    // 2. 湲곗긽 ?꾪솴 ?ㅻ뜑
    const statusTitle = document.querySelector('#marine-status-accordion-header .section-title');
    if (statusTitle) {
        if (isFiltered) {
            statusTitle.innerHTML = '<i class="fa-solid fa-sun" style="color: #FFD700;"></i> 吏?뺥빐??퀎 湲곗긽?꾪솴';
        } else {
            statusTitle.innerHTML = '<i class="fa-solid fa-sun" style="color: #FFD700;"></i> ?댁뿭蹂?湲곗긽?꾪솴';
        }
    }

    if (globalStatusContainer) {
        // Clear existing badges (except icon)
        // We need to keep the icon
        const icon = document.getElementById('main-accordion-icon');
        globalStatusContainer.innerHTML = ''; // Clear all
        globalStatusContainer.style.gap = '5px'; // Override CSS gap (12px)

        if (totalCount > 0) {
            // Add Active Badge (Red) - "諛쒗슚"
            if (activeCount > 0) {
                const activeBadge = document.createElement('span');
                activeBadge.className = 'status-badge warning';
                activeBadge.textContent = `諛쒗슚 ${activeCount}嫄?;
                globalStatusContainer.appendChild(activeBadge);
            }

            // Add Preliminary Badge (Orange) - "諛쒗몴"
            if (prelimCount > 0) {
                const prelimBadge = document.createElement('span');
                prelimBadge.className = 'status-badge orange'; // Custom orange class
                prelimBadge.textContent = `諛쒗몴 ${prelimCount}嫄?;
                globalStatusContainer.appendChild(prelimBadge);
            }

            // Start Expanded (?꾪꽣留곷맂 ?곹깭?먯꽌???뚮┝???덉쑝硫??쇱퀜吏?
            if (mainBody && mainBody.classList.contains('collapsed')) {
                mainBody.classList.remove('collapsed');
                if (mainHeader) mainHeader.classList.remove('collapsed-state');
            }

            // ?밸낫 ?덉쓬: 鍮④컙??洹몃씪?곗씠???좎?
            if (mainHeader) {
                mainHeader.style.background = 'linear-gradient(90deg, rgba(50, 20, 20, 0.6) 0%, rgba(127, 29, 29, 0.9) 100%)';
                mainHeader.style.borderColor = 'rgba(239, 68, 68, 0.3)';
            }
        } else {
            // No Alerts (Green)
            const safeBadge = document.createElement('span');
            safeBadge.className = 'status-badge safe';

            // ?띿뒪??議곌굔遺 蹂寃?
            if (isFiltered) {
                safeBadge.textContent = '吏?뺥빐???밸낫 ?놁쓬';
            } else {
                safeBadge.textContent = '???댁뿭 ?밸낫?놁쓬';
            }

            safeBadge.style.marginRight = '6px';
            globalStatusContainer.appendChild(safeBadge);

            // Start Collapsed
            if (mainBody && !mainBody.classList.contains('collapsed')) {
                mainBody.classList.add('collapsed');
                if (mainHeader) mainHeader.classList.add('collapsed-state');
            }

            // ?밸낫 ?놁쓬: 珥덈줉??洹몃씪?곗씠?섏쑝濡?蹂寃?
            if (mainHeader) {
                mainHeader.style.background = 'linear-gradient(90deg, rgba(20, 50, 30, 0.6) 0%, rgba(34, 139, 34, 0.8) 100%)';
                mainHeader.style.borderColor = 'rgba(34, 139, 34, 0.4)';
            }
        }

        // Re-append icon
        if (icon) {
            globalStatusContainer.appendChild(icon);
        } else {
            // Create if missing (shouldn't happen usually)
            const newIcon = document.createElement('i');
            newIcon.id = 'main-accordion-icon';
            newIcon.className = 'fa-solid fa-chevron-down';
            globalStatusContainer.appendChild(newIcon);
        }
    }

    // [New] 湲곗긽?꾪솴 ?꾩퐫?붿뼵 ?먮룞 ?쒖뼱 濡쒖쭅
    // ?밸낫(filtered)媛 ?놁쑝硫?湲곗긽?꾪솴???댁뼱二쇨퀬, ?덉쑝硫?湲곗긽?꾪솴???レ쓬 (Focus 吏묒쨷)
    const statusBody = document.getElementById('marine-status-accordion-body');
    const statusHeader = document.getElementById('marine-status-accordion-header');

    if (statusBody) {
        if (totalCount > 0) {
            // ?밸낫 ?덉쓬 -> 湲곗긽?꾪솴 ?リ린 (?밸낫??吏묒쨷)
            if (!statusBody.classList.contains('collapsed')) {
                statusBody.classList.add('collapsed');
                // ?ㅻ뜑 ?곹깭 蹂寃쎌씠 ?꾩슂?섎떎硫?異붽? (蹂댄넻 collapsed-state ??
            }
        } else {
            // ?밸낫 ?놁쓬 -> 湲곗긽?꾪솴 ?닿린 (蹂?寃??놁쑝誘濡?湲곗긽?뺣낫 ?쒓났)
            if (statusBody.classList.contains('collapsed')) {
                statusBody.classList.remove('collapsed');
            }
        }
    }

    // ?꾩껜 ?꾪솴 ?낅뜲?댄듃 濡쒓렇
    // console.log('Total alerts displayed:', totalAlerts);
}

function createAlertElement(items) {
    if (!Array.isArray(items)) items = [items];

    // [?섏젙] items媛 鍮꾩뼱?덈뒗 寃쎌슦(?곗븞 ?밸낫留??덈뒗 寃쎌슦)瑜??꾪븳 湲곕낯 ?곗씠??援ъ꽦
    let zoneNameStr = '';
    let sortedAlerts = [];

    if (items.length > 0) {
        sortedAlerts = sortAlertItems(items);
        zoneNameStr = sortedAlerts[0].zoneName;
    } else {
        // items媛 鍮꾩뼱?덈떎硫? renderApp?먯꽌 ?꾨떖??items??而ㅼ뒪? ?띿꽦?대굹 
        // ?뚮뜑留??쒖젏???뺣낫瑜??쒖슜?댁빞 ?? (?꾩옱 renderApp?먯꽌 items媛 鍮꾩뼱?덉쓣 ???덉쓬)
        // items???ㅼ젣濡쒕뒗 zoneAlertsMap[zoneName] ??
        // items??zoneName ?뺣낫瑜?誘몃━ ?ъ뼱?먭굅?? ?⑥닔 ?쒓렇?덉쿂瑜?蹂寃쏀빐????
        // ?쇰떒 renderApp?먯꽌 鍮?諛곗뿴 ????붾? 媛앹껜瑜??섎굹 ?ｋ뒗 諛⑹떇?쇰줈 泥섎━?섎뒗 寃??덉쟾??
        // (renderApp ?섏젙 ?덉젙)
    }

    const data = sortedAlerts[0] || {};
    zoneNameStr = data.zoneName || '?????녿뒗 援ъ뿭';

    const template = document.getElementById('alert-item-template');
    const clone = template.content.cloneNode(true);
    const card = clone.querySelector('.alert-card');

    // 移대뱶 ?ㅽ???(而댄뙥?명븯寃?- 以묐텇瑜섎낫???묎쾶)
    card.style.cssText = `
        padding: 10px 12px;
        margin-bottom: 6px;
        border-radius: 8px;
        background: rgba(30, 40, 60, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.08);
        transition: all 0.2s ease;
    `;

    // 援ъ뿭紐?(而댄뙥?명븯寃?
    const zoneName = clone.querySelector('.zone-name');
    zoneName.innerHTML = ''; // 珥덇린??

    const nameSpan = document.createElement('span');
    nameSpan.textContent = zoneNameStr;
    zoneName.appendChild(nameSpan);

    // ?먮낯 ?대쫫??異붽? ?뺣낫(?댁젣?덇퀬 ??媛 ?덈떎硫??④퍡 ?쒖떆
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

    // 諭껋? (蹂듭닔 ?밸낫 吏??
    const badgeContainer = clone.querySelector('.alert-badges');
    badgeContainer.style.display = 'flex';
    badgeContainer.style.gap = '4px';
    badgeContainer.style.flexWrap = 'wrap';

    if (sortedAlerts.length > 0) {
        const now = getKfTime();
        sortedAlerts.forEach(alert => {
            if (alert.warnType && alert.level) {
                const badge = document.createElement('span');

                // [New] 諛쒗슚 ?쒓컖??誘몃옒??寃쎌슦 '?덇퀬(?湲?' ?곹깭濡??쒖떆
                const cleanEf = String(alert.tmEf || '').replace(/[^0-9]/g, '');
                const isAwaiting = !alert.isPreliminary && cleanEf && cleanEf.length >= 12 && now < cleanEf;

                badge.className = `status-badge ${alert.isPreliminary || isAwaiting ? 'preliminary' : 'warning'}`;

                // [Fix] ?덈퉬?밸낫??寃쎌슦 '[?밸낫紐? ?덈퉬'濡??쒖텧 (?? ?띾옉 ?덈퉬)
                if (alert.isPreliminary || isAwaiting) {
                    const cleanType = (alert.warnType || '').replace('二쇱쓽蹂?, '').replace('寃쎈낫', '').trim();
                    badge.textContent = `${cleanType} ?덈퉬`;
                } else {
                    badge.textContent = `${alert.warnType} ${alert.level}`;
                }
                badgeContainer.appendChild(badge);

                // 紐낅졊 諭껋? (諛쒗몴, ?移???- 諛쒗몴???쒖쇅)
                if (alert.command && alert.command !== '諛쒗몴') {
                    const cmdBadge = document.createElement('span');
                    cmdBadge.className = 'status-badge safe';
                    cmdBadge.textContent = alert.command;
                    badgeContainer.appendChild(cmdBadge);
                }
            }
        });
    } else {
        // 硫붿씤 ?밸낫媛 ?녿뒗 寃쎌슦 "?밸낫 ?놁쓬" ?쒖떆
        const safeBadge = document.createElement('span');
        safeBadge.className = 'status-badge safe';
        safeBadge.textContent = '吏?뺥빐???밸낫 ?놁쓬';
        safeBadge.style.opacity = '0.6';
        badgeContainer.appendChild(safeBadge);
    }

    // ?쒓컙 ?뺣낫 (蹂듭닔 ?밸낫 吏??- 媛??밸낫蹂꾨줈 ?뱀뀡 ?앹꽦)
    const details = clone.querySelector('.alert-details');
    details.innerHTML = ''; // 湲곗〈 ?쒗뵆由?援ъ“ 珥덇린?????숈쟻 ?앹꽦

    sortedAlerts.forEach(alert => {
        // [異붽?] ?붾? ?곗씠?곗씤 寃쎌슦 ?쒓컙 ?뺣낫 ?뱀뀡???앹꽦?섏? ?딆쓬
        if (alert.isDummy) return;

        const timeBox = document.createElement('div');
        timeBox.className = 'alert-time-box';
        timeBox.style.cssText = `
            background: rgba(0, 0, 0, 0.2);
            border-radius: 8px;
            padding: 12px;
            margin-bottom: 12px;
            border: 1px solid rgba(255, 255, 255, 0.05);
        `;

        // [?섏젙] ?밸낫媛 2媛??댁긽???뚮쭔 媛쒕퀎 ??댄?(諭껋?) ?쒖떆 - ?⑥씪 ?밸낫??寃쎌슦 以묐났 ?쒓굅
        if (sortedAlerts.length > 1) {
            const alertTitle = document.createElement('div');
            alertTitle.style.cssText = `
                display: inline-block;
                margin-bottom: 10px;
                padding: 2px 8px;
                border-radius: 4px;
                font-size: 0.85rem;
                font-weight: 700;
                background: ${alert.isPreliminary ? 'rgba(255, 183, 77, 0.2)' : 'rgba(255, 107, 107, 0.2)'};
                color: ${alert.isPreliminary ? '#ffb74d' : '#ff6b6b'};
                border: 1px solid ${alert.isPreliminary ? 'rgba(255, 183, 77, 0.3)' : 'rgba(255, 107, 107, 0.3)'};
            `;
            alertTitle.textContent = `${alert.warnType} ${alert.level}${alert.command && alert.command !== '諛쒗몴' ? ` (${alert.command})` : ''}`;
            timeBox.appendChild(alertTitle);
        }

        // ?쒓컙 ?뺣낫 ?됰뱾
        const createRow = (label, value, color) => {
            const row = document.createElement('div');
            row.style.cssText = 'display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 0.85rem;';
            row.innerHTML = `
                <span style="color: #8b949e;">${label}</span>
                <span style="color: ${color || '#e6edf3'}; font-weight: 500;">${value}</span>
            `;
            return row;
        };

        const releaseTimeRaw = alert.tmEd && alert.tmEd.trim() !== '' ? alert.tmEd : '';
        let releaseTime = '?뺣낫 ?놁쓬';
        if (releaseTimeRaw && !releaseTimeRaw.startsWith('00??)) {
            releaseTime = formatDate(releaseTimeRaw);
        }

        timeBox.appendChild(createRow('諛쒗몴?쒓컖', formatDate(alert.tmFc) || '?뺣낫 ?놁쓬'));
        timeBox.appendChild(createRow('諛쒗슚?쒓컖', formatDate(alert.tmEf) || '?뺣낫 ?놁쓬'));
        timeBox.appendChild(createRow('?댁젣?덉젙', releaseTime, '#69f0ae'));

        details.appendChild(timeBox);
    });

    // ?곗븞諛붾떎/?됱닔援ъ뿭 ?쒖떆 (癒쇱?)
    // [?섏젙] 援ъ뿭紐?留ㅼ묶 ??怨듬갚 ?쒓굅 諛??좎뿰??留ㅼ묶 ?곸슜
    const findCoastalZones = (zName) => {
        if (!zName) return null;
        const norm = zName.replace(/[\s쨌.]/g, '');
        for (const [key, val] of Object.entries(COASTAL_MAPPING)) {
            if (key.replace(/[\s쨌.]/g, '') === norm) return val;
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
        coastalTitle.style.fontSize = '0.85rem';
        coastalTitle.style.color = '#8b949e';
        coastalTitle.style.marginBottom = '8px';
        coastalTitle.textContent = '?곗븞諛붾떎/?됱닔援ъ뿭';
        coastalContainer.appendChild(coastalTitle);

        // 怨듬갚 臾닿? 留ㅼ묶 ?⑥닔
        const findCoastalAlert = (fullName) => {
            const normalizedTarget = (fullName || '').replace(/\s+/g, '');
            for (const [key, alerts] of Object.entries(appState.coastalAlerts || {})) {
                const normalizedKey = key.replace(/\s+/g, '');
                if (normalizedKey === normalizedTarget) {
                    return alerts; // ?댁젣 諛곗뿴??諛섑솚??
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

    // 遺???뺣낫 ?쒖떆 (踰꾪듉 諛⑹떇) - ?곗븞諛붾떎 ?꾨옒
    const buoys = BUOY_MAPPING[data.zoneName];
    if (buoys && buoys.length > 0) {
        const buoyContainer = document.createElement('div');
        buoyContainer.className = 'buoy-section';
        buoyContainer.style.marginTop = '12px';
        buoyContainer.style.borderTop = '1px solid rgba(255,255,255,0.1)';
        buoyContainer.style.paddingTop = '12px';

        const buoyTitle = document.createElement('div');
        buoyTitle.style.fontSize = '0.85rem';
        buoyTitle.style.color = '#8b949e';
        buoyTitle.style.marginBottom = '10px';
        buoyTitle.innerHTML = BUOY_SVG_ICON + ' 愿痢〓???<span style="color:#69f0ae;font-size:0.75rem">(' + buoys.length + ')</span>';
        buoyContainer.appendChild(buoyTitle);

        // 踰꾪듉 而⑦뀒?대꼫
        const btnContainer = document.createElement('div');
        btnContainer.style.display = 'flex';
        btnContainer.style.flexWrap = 'wrap';
        btnContainer.style.gap = '8px';
        btnContainer.style.marginBottom = '10px';

        // ?뺣낫 ?쒖떆 ?곸뿭
        const infoArea = document.createElement('div');
        infoArea.className = 'buoy-info-area';
        infoArea.style.display = 'none';
        infoArea.style.backgroundColor = 'rgba(68, 138, 255, 0.1)';
        infoArea.style.borderRadius = '8px';
        infoArea.style.padding = '12px';
        infoArea.style.border = '1px solid rgba(68, 138, 255, 0.2)';

        buoys.forEach(buoy => {
            const btn = document.createElement('button');
            btn.className = 'buoy-btn';
            btn.textContent = buoy.name;
            btn.style.padding = '6px 14px';
            btn.style.borderRadius = '16px';
            btn.style.border = '1px solid rgba(255,255,255,0.15)';
            btn.style.backgroundColor = 'rgba(255,255,255,0.05)';
            btn.style.color = '#ccc';
            btn.style.fontSize = '0.85rem';
            btn.style.cursor = 'pointer';
            btn.style.transition = 'all 0.2s';

            btn.addEventListener('click', (e) => {
                e.stopPropagation();

                // ?대? ?쒖꽦?붾맂 踰꾪듉 ?대┃ ???リ린
                if (btn.classList.contains('active')) {
                    btn.classList.remove('active');
                    btn.style.backgroundColor = 'rgba(255,255,255,0.05)';
                    btn.style.color = '#ccc';
                    btn.style.borderColor = 'rgba(255,255,255,0.15)';
                    infoArea.style.display = 'none';
                    return;
                }

                // ?ㅻⅨ 踰꾪듉 鍮꾪솢?깊솕
                btnContainer.querySelectorAll('.buoy-btn').forEach(b => {
                    b.classList.remove('active');
                    b.style.backgroundColor = 'rgba(255,255,255,0.05)';
                    b.style.color = '#ccc';
                    b.style.borderColor = 'rgba(255,255,255,0.15)';
                });

                // ?꾩옱 踰꾪듉 ?쒖꽦??
                btn.classList.add('active');
                btn.style.backgroundColor = 'rgba(68, 138, 255, 0.3)';
                btn.style.color = '#448aff';
                btn.style.borderColor = '#448aff';

                // 遺???뺣낫 ?쒖떆
                displayBuoyInfo(buoy, infoArea);
                infoArea.style.display = 'block';
            });

            btnContainer.appendChild(btn);
        });

        buoyContainer.appendChild(btnContainer);
        buoyContainer.appendChild(infoArea);
        details.appendChild(buoyContainer);
    }

    // ?쇱튂湲??묎린
    card.style.cursor = 'pointer';
    card.addEventListener('click', (e) => {
        if (e.target.closest('.coastal-item') || e.target.closest('.buoy-btn') || e.target.closest('.buoy-info-area')) return;
        e.stopPropagation();

        const isCurrentlyHidden = details.classList.contains('hidden');

        // 1. ?ㅻⅨ 紐⑤뱺 ?뚮┝ 移대뱶瑜??レ쓬 (?꾩껜 臾몄꽌 踰붿쐞?먯꽌)
        document.querySelectorAll('.alert-details').forEach(otherDetails => {
            otherDetails.classList.add('hidden');
        });
        document.querySelectorAll('.detail-arrow').forEach(otherArrow => {
            otherArrow.style.transform = 'rotate(0deg)';
        });

        // 2. ?꾩옱 移대뱶留??좉? (?댁쟾???ロ??덉뿀?ㅻ㈃ ?닿린)
        if (isCurrentlyHidden) {
            details.classList.remove('hidden');
            const arrow = card.querySelector('.detail-arrow');
            arrow.style.transform = 'rotate(90deg)';
        }
    });

    // ?뿺截?踰꾪듉 而⑦뀒?대꼫 (湲곗긽?덈낫 + ?닿뎄蹂??덉긽 湲곗긽)
    if (typeof ZONE_OVERLAY_CONFIG !== 'undefined' && ZONE_OVERLAY_CONFIG[data.zoneName]) {
        // 留ㅽ븨??援ъ뿭?몄? ?뺤씤 (癒쇰컮???듯빀 援ъ뿭 ??- ?덈낫 ?곗씠?곌? ?녿뒗 援ъ뿭)
        const isMappedZone = typeof ZONE_NAME_DISPLAY_MAP !== 'undefined' && ZONE_NAME_DISPLAY_MAP[data.zoneName];

        const btnContainer = document.createElement('div');
        btnContainer.style.cssText = `
            display: flex;
            gap: 8px;
            margin-top: 15px;
            flex-wrap: nowrap;
        `;

        // 湲곗긽?덈낫 踰꾪듉 (留ㅽ븨??援ъ뿭???꾨땶 寃쎌슦?먮쭔 ?쒖떆)
        if (!isMappedZone) {
            const forecastBtn = document.createElement('button');
            forecastBtn.className = 'forecast-btn';
            forecastBtn.innerHTML = '?截?湲곗긽?덈낫';
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
                showSeaForecastTable(data.zoneName);
            });
            btnContainer.appendChild(forecastBtn);
        }

        // ?닿뎄蹂??덉긽 湲곗긽 踰꾪듉
        const zoneViewBtn = document.createElement('button');
        zoneViewBtn.className = 'zone-view-btn';
        zoneViewBtn.innerHTML = '?뿺截??닿뎄蹂?湲곗긽?꾨쭩';
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
            if (typeof showZoneOverlay === 'function') {
                showZoneOverlay(data.zoneName);
            }
        });

        btnContainer.appendChild(zoneViewBtn);

        // ?덈뵒 踰꾪듉 (Windy URL???덈뒗 援ъ뿭留?
        if (WINDY_URL_MAPPING[data.zoneName]) {
            const windyBtn = document.createElement('button');
            windyBtn.className = 'windy-btn';
            windyBtn.innerHTML = '<i class="fa-solid fa-wind"></i> ?덈뵒';
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
                showWindyPopup(data.zoneName);
            });
            btnContainer.appendChild(windyBtn);
        }

        details.appendChild(btnContainer);
    }

    return card;
}

// 遺???뺣낫 ?쒖떆 (踰꾪듉 ?대┃ ???몄텧)
function displayBuoyInfo(buoy, container) {
    container.innerHTML = '';

    // ?붾쾭洹? 遺??ID? ?곗씠???좊Т ?뺤씤
    // console.log('?뵇 遺??議고쉶:', buoy.id, buoy.name, '| ?곗씠??議댁옱:', !!appState.buoyData[buoy.id]);

    const buoyData = appState.buoyData[buoy.id];
    const typeInfo = BUOY_TYPES[buoy.type] || { name: '遺??, icon: '?뱧' };

    // ?ㅻ뜑
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

    // ?꾩튂 蹂닿린 踰꾪듉
    const locationBtn = document.createElement('button');
    locationBtn.innerHTML = '?뱧';
    locationBtn.title = '吏?꾩뿉???꾩튂 蹂닿린';
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
        noData.innerHTML = '?좑툘 ?대떦 遺?댁뿉?쒕뒗 湲곗긽?뺣낫媛 愿痢〓릺吏 ?딆븯?듬땲??';
        container.appendChild(noData);
        return;
    }

    // 二쇱슂 ?곗씠??(?뚭퀬, ?띿냽, ?섏삩)
    const mainData = document.createElement('div');
    mainData.style.display = 'flex';
    mainData.style.gap = '20px';
    mainData.style.marginBottom = '12px';
    mainData.style.flexWrap = 'wrap';

    if (buoyData.waveHeight !== null) {
        const waveBox = createDataBox('?뙄 ?뚭퀬', buoyData.waveHeight, 'm', '#4fc3f7');
        mainData.appendChild(waveBox);
    }

    if (buoyData.windSpeed !== null) {
        const windDir = buoyData.windDirection !== null ? getWindDirectionText(buoyData.windDirection) : '';
        const windBox = createDataBox('?뮜 ?띿냽', buoyData.windSpeed, `m/s ${windDir}`, '#81c784');
        mainData.appendChild(windBox);
    }

    if (buoyData.waterTemp !== null) {
        const tempBox = createDataBox('?뙜截??섏삩', buoyData.waterTemp, '째C', '#ffb74d');
        mainData.appendChild(tempBox);
    }

    container.appendChild(mainData);

    // ?곸꽭 ?곗씠??
    let detailHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.85rem;background:rgba(0,0,0,0.2);padding:10px;border-radius:6px">';

    if (buoyData.windGust !== null) {
        detailHTML += `<div><span style="color:#8b949e">?뚰뭾</span> <span style="color:#fff">${buoyData.windGust} m/s</span></div>`;
    }
    if (buoyData.airTemp !== null) {
        detailHTML += `<div><span style="color:#8b949e">湲곗삩</span> <span style="color:#fff">${buoyData.airTemp}째C</span></div>`;
    }
    if (buoyData.pressure !== null) {
        detailHTML += `<div><span style="color:#8b949e">湲곗븬</span> <span style="color:#fff">${buoyData.pressure} hPa</span></div>`;
    }
    if (buoyData.humidity !== null) {
        detailHTML += `<div><span style="color:#8b949e">?듬룄</span> <span style="color:#fff">${buoyData.humidity}%</span></div>`;
    }
    if (buoyData.tm) {
        detailHTML += `<div style="grid-column:1/-1;margin-top:4px;padding-top:4px;border-top:1px dashed rgba(255,255,255,0.1)"><span style="color:#8b949e">愿痢≪떆媛?/span> <span style="color:#fff">${formatBuoyTime(buoyData.tm)}</span></div>`;
    }

    detailHTML += '</div>';

    const detailContainer = document.createElement('div');
    detailContainer.innerHTML = detailHTML;
    container.appendChild(detailContainer);
    detailContainer.innerHTML = detailHTML;
    container.appendChild(detailContainer);
}

// ?곗븞諛붾떎 ?대?吏 留ㅽ븨
const COASTAL_ZONES_IMAGES = {
    "?쒖＜?꾨턿遺?욌컮??: { "?곗븞諛붾떎": "遺곷??욌컮???곗븞諛붾떎).png" },
    "?쒖＜?꾨궓遺?욌컮??: { "?곗븞諛붾떎": "?⑤??욌컮???곗븞諛붾떎).png" },
    "?쒖＜?꾨룞遺?욌컮??: {
        "遺곷룞?곗븞諛붾떎": "?숇??욌컮??遺곷룞?곗븞諛붾떎).png",
        "?⑤룞?곗븞諛붾떎": "?숇??욌컮???⑤룞?곗븞諛붾떎).png"
    },
    "?쒖＜?꾩꽌遺?욌컮??: {
        "遺곸꽌?곗븞諛붾떎": "?쒕??욌컮??遺곸꽌?곗븞諛붾떎).png",
        "?⑥꽌?곗븞諛붾떎": "?쒕??욌컮???⑥꽌?곗븞諛붾떎).png"
    }
};

// ?대?吏 紐⑤떖 ?쒖떆 ?⑥닔
function showImageModal(imageName, title) {
    // 湲곗〈 紐⑤떖 ?쒓굅
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
    header.innerHTML = `<span>?뿺截?${title}</span>`;

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '??;
    closeBtn.style.cssText = `
        background: none; border: none; color: #aaa; font-size: 1.2rem; cursor: pointer;
    `;
    closeBtn.onclick = () => overlay.remove();
    header.appendChild(closeBtn);

    const imgContainer = document.createElement('div');
    imgContainer.style.cssText = 'padding: 0; overflow: auto; display: flex; align-items: center; justify-content: center; background: #000;';

    const img = document.createElement('img');
    img.src = `?곗븞諛붾떎_?대?吏/${imageName}`;
    img.style.cssText = 'max-width: 100%; max-height: 80vh; display: block;';
    img.onerror = () => { img.alt = '?대?吏瑜?遺덈윭?????놁뒿?덈떎.'; img.src = ''; img.style.color = '#fff'; img.style.padding = '20px'; };

    imgContainer.appendChild(img);
    content.appendChild(header);
    content.appendChild(imgContainer);
    overlay.appendChild(content);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
}

// ?곗씠??諛뺤뒪 ?앹꽦 ?ы띁
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

// 遺??愿痢≪떆媛??щ㎎
function formatBuoyTime(tm) {
    if (!tm || tm.length < 12) return '-';
    const month = tm.substring(4, 6);
    const day = tm.substring(6, 8);
    const hour = tm.substring(8, 10);
    const minute = tm.substring(10, 12);
    return `${month}/${day} ${hour}:${minute}`;
}

// ?곗븞諛붾떎/?됱닔援ъ뿭 ?붿냼 ?앹꽦
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
    nameSpan.style.fontWeight = '600'; // 醫 ??援듦쾶
    header.appendChild(nameSpan);

    // [New] 吏???꾩씠肄?踰꾪듉 異붽? (媛?뚮룄/?곕룄 ?쒖쇅)
    // coastal.name ?? "遺곸꽌?곗븞諛붾떎", "?곗븞諛붾떎" ??
    // parentZoneName ?? "?쒖＜?꾩꽌遺?욌컮??
    if (parentZoneName && COASTAL_ZONES_IMAGES[parentZoneName]) {
        // ?뺥솗??留ㅼ묶???꾪빐 coastal.name ?ъ슜. 
        // ?? ?쒖＜?꾩꽌遺?욌컮??-> 遺곸꽌?곗븞諛붾떎

        let imageName = null;
        // coastal.name???뺥솗???ㅼ? ?쇱튂?섎뒗吏 ?뺤씤
        if (COASTAL_ZONES_IMAGES[parentZoneName][coastal.name]) {
            imageName = COASTAL_ZONES_IMAGES[parentZoneName][coastal.name];
        }
        // ?덉쇅: "?곗븞諛붾떎"?쇰뒗 ?대쫫??以묐났?섎?濡?parentZoneName?쇰줈 援щ텇???곗씠?곗뿉??李얠쓬.
        // ?곗씠??援ъ“??parentZoneName ???꾨옒??"?곗븞諛붾떎" ?ㅺ? ?덉쑝硫?留ㅼ묶??

        if (imageName) {
            const mapBtn = document.createElement('button');
            mapBtn.innerHTML = '?뿺截?; // 吏???꾩씠肄?
            mapBtn.title = '援ъ뿭 吏??蹂닿린';
            mapBtn.style.cssText = `
                background: none; border: 1px solid #555; border-radius: 4px;
                color: #ccc; cursor: pointer; margin-left: 8px; padding: 2px 6px;
                font-size: 0.8rem; vertical-align: middle; transition: background 0.2s;
            `;
            mapBtn.onmouseover = () => mapBtn.style.background = 'rgba(255,255,255,0.1)';
            mapBtn.onmouseout = () => mapBtn.style.background = 'none';
            mapBtn.onclick = (e) => {
                e.stopPropagation(); // 移대뱶 ?뺤옣 諛⑹?
                showImageModal(imageName, `${parentZoneName} ${coastal.name}`);
            };

            // ?대쫫 ?놁뿉 異붽? (badge ??
            // header flex ?쒖꽌: Name - (Map) - Badge
            // ?꾩옱 援ъ“: nameSpan - badge
            // insertBefore badge if exists, else append

            // Re-ordering logic:
            // Just append to header, but we want it Next to Name.
            // Let's wrapping Name + Btn in a container or just insert after Name.
            // Header is flex -> space-between. Name is left, Badge is right.
            // We want Map btn next to Badge(right) or next to Name(left)?
            // User said "?곗븞諛붾떎 ?ㅻⅨ履쎌뿉 吏???꾩씠肄섏쓣 ?ｊ퀬". Let's put it next to name.

            // But header uses space-between. Name is one child. Badge is another.
            // If we add mapBtn, it will be in middle.
            // Better: NameSpan includes the button? No.
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

    // 留뚯빟 吏?꾧? ?놁뼱??mapBtn????留뚮뱾?덈떎硫?name留??덉뼱??rebuild ?꾩슂?????덉쓬
    // ?뱀? ??if臾?諛뽰뿉??濡쒖쭅 泥섎━.
    // 湲곗〈 濡쒖쭅 ?좎?瑜??꾪빐:
    if (header.children.length === 0) {
        // Re-append name only
        header.appendChild(nameSpan);
    }

    if (alertData && alertData.length > 0) {
        // ?밸낫媛 ?덈뒗 寃쎌슦 (諛곗뿴 泥섎━)
        const badgeContainer = document.createElement('div');
        badgeContainer.style.display = 'flex';
        badgeContainer.style.gap = '4px';
        badgeContainer.style.flexWrap = 'wrap';
        badgeContainer.style.justifyContent = 'flex-end';

        // ?뺣젹 ?곸슜 (?쒗뭾 ?곗꽑)
        const sortedAlerts = sortAlertItems(alertData);

        const now = getKfTime();
        sortedAlerts.forEach(alert => {
            const badge = document.createElement('span');

            // [New] 諛쒗슚 ?쒓컖??誘몃옒??寃쎌슦 '?덇퀬(?湲?' ?곹깭濡??쒖떆
            const cleanEf = String(alert.tmEf || '').replace(/[^0-9]/g, '');
            const isAwaiting = !alert.isPreliminary && cleanEf && cleanEf.length >= 12 && now < cleanEf;

            badge.className = `status-badge ${alert.isPreliminary || isAwaiting ? 'preliminary' : 'warning'}`;
            badge.style.fontSize = '0.7rem'; // ?고듃 ?쎄컙 異뺤냼
            badge.style.padding = '1px 6px';

            badge.textContent = `${alert.warnType} ${alert.level}`;

            badgeContainer.appendChild(badge);
        });
        header.appendChild(badgeContainer);

        // ?쒓컖??媛뺤“ (媛???믪? ?깃툒 湲곗?)
        const hasWarning = sortedAlerts.some(a => !a.isPreliminary);
        item.style.borderLeft = `3px solid ${hasWarning ? '#ff6b6b' : '#ffb74d'}`;
        item.style.cursor = 'pointer';

        item.appendChild(header);

        // ?곸꽭 ?뺣낫 ?곸뿭 (紐⑤뱺 ?밸낫 ?뺣낫瑜??쒗쉶?섎ŉ ?쒖떆)
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

        // ?쒓컖 ?щ㎎???⑥닔 (?댁옣)
        const formatAfsoTime = (timeStr) => {
            if (!timeStr || timeStr.trim() === '') return '?뺣낫 ?놁쓬';
            let decoded = timeStr.replace(/&#40;/g, '(').replace(/&#41;/g, ')').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim();
            const formatHourToAmPm = (hourStr, minStr = '00') => {
                const hour = parseInt(hourStr, 10);
                let text = (hour === 0) ? '?ㅼ쟾 12?? : (hour < 12) ? `?ㅼ쟾 ${hour}?? : (hour === 12) ? '?ㅽ썑 12?? : `?ㅽ썑 ${hour - 12}??;
                if (minStr !== '00') text += ` ${parseInt(minStr, 10)}遺?;
                return text;
            };
            const dotMatch = decoded.match(/^(\d{4})\.(\d{2})\.(\d{2})\.(\d{2}):(\d{2})$/);
            if (dotMatch) return `${dotMatch[2]}/${dotMatch[3]} ${formatHourToAmPm(dotMatch[4], dotMatch[5])}`;
            const textMatch = decoded.match(/^(\d{4})\.(\d{2})\.(\d{2})\.\s*(.+)$/);
            if (textMatch) return `${textMatch[2]}/${textMatch[3]} ${textMatch[4]}`;
            if (decoded.includes('/')) return decoded;
            if (/^\d{12,}$/.test(decoded)) return `${decoded.substring(4, 6)}/${decoded.substring(6, 8)} ${formatHourToAmPm(decoded.substring(8, 10), decoded.substring(10, 12))}`;
            return decoded;
        };

        sortedAlerts.forEach((alert, index) => {
            const tmFcFormatted = formatAfsoTime(alert.tmFc);
            const tmEfFormatted = formatAfsoTime(alert.tmEf);
            let tmEdFormatted = '?뺣낫 ?놁쓬';
            if (alert.tmEd && alert.tmEd.trim().length > 2 && !alert.isPreliminary) {
                tmEdFormatted = formatAfsoTime(alert.tmEd);
            }

            // [?섏젙] ?⑥씪 ?밸낫??寃쎌슦 ?대? ??댄?(諭껋? ?뺥깭) ?④?
            if (sortedAlerts.length > 1) {
                const alertTitle = document.createElement('div');
                alertTitle.style.cssText = `
                    margin-bottom: 6px;
                    padding-top: ${index > 0 ? '8px' : '0'};
                    border-top: ${index > 0 ? '1px dashed rgba(255,255,255,0.1)' : 'none'};
                    color: ${alert.isPreliminary ? '#ffb74d' : '#ff6b6b'};
                    font-weight: 700;
                    font-size: 0.75rem;
                `;
                alertTitle.textContent = `??${alert.warnType} ${alert.level}`;
                detailBox.appendChild(alertTitle);
            }

            const infoHtml = `
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 0.75rem;">
                    <span style="color: #777;">諛쒗몴: ${tmFcFormatted}</span>
                    <span style="color: #777;">諛쒗슚: ${tmEfFormatted}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 0.75rem;">
                    <span style="color: #777;">?댁젣?덉젙</span>
                    <span style="color: ${tmEdFormatted === '誘몄젙' ? '#777' : '#69f0ae'};">${tmEdFormatted}</span>
                </div>
            `;
            const infoContainer = document.createElement('div');
            infoContainer.innerHTML = infoHtml;
            detailBox.appendChild(infoContainer);
        });

        item.appendChild(detailBox);

        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = detailBox.style.display === 'block';
            detailBox.style.display = isVisible ? 'none' : 'block';
        });

    } else {
        // ?밸낫媛 ?녿뒗 寃쎌슦
        const noAlertBadge = document.createElement('span');
        noAlertBadge.style.fontSize = '0.75rem';
        noAlertBadge.style.color = '#69f0ae';
        noAlertBadge.style.padding = '2px 8px';
        noAlertBadge.style.backgroundColor = 'rgba(105, 240, 174, 0.1)';
        noAlertBadge.style.borderRadius = '4px';
        noAlertBadge.textContent = '?밸낫 ?놁쓬';
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

    // 1. 紐⑤뱺 ?댁뿭 ?뱀뀡???レ쓬 (諛고???紐⑤뱶)
    const allSections = document.querySelectorAll('.sea-section');
    allSections.forEach(section => {
        section.classList.remove('open');
    });

    // 2. ?댁쟾???ロ??덉뿀?ㅻ㈃, ?꾩옱 ?뱀뀡留??닿린
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

        // ?ㅻ뜑 諭껋? ?곸뿭???ㅽ뵾???쒖떆
        if (headerStatus) {
            // ?꾩씠肄?蹂댁〈???꾪빐 ?덈줈 ?앹꽦
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
        // 濡쒕뵫 ?댁젣 ??諭껋???renderApp()?먯꽌 ?뚮뜑留곷릺誘濡??ш린??泥섎━ 遺덊븘??
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
// ?뙄 ?닿뎄蹂?湲곗긽?뺣낫 (APIHub)
// ============================================================

/**
 * ?닿뎄 ?곗씠??議고쉶 諛?紐⑤떖 ?쒖떆
 * @param {string} zoneId ?닿뎄踰덊샇
 */

// 紐⑤떖 ?リ린
window.closeSeaZoneModal = function () {
    // 吏꾪뻾 以묒씤 ?붿껌 痍⑥냼 (?붿껌 ID 臾댄슚??
    window._marineZoneRequestId = null;

    const modal = document.getElementById('sea-zone-modal');
    if (modal) {
        // 李⑦듃 ?몄뒪?댁뒪 ?뺣━ (硫붾え由??꾩닔 諛⑹?)
        const chartCanvas = document.getElementById('marineChart');
        if (chartCanvas) {
            const chartInstance = Chart.getChart(chartCanvas);
            if (chartInstance) chartInstance.destroy();
        }
        // 紐⑤떖 ?꾩쟾 ?쒓굅 (?ㅼ쓬 ?몄텧 ???덈줈 ?앹꽦)
        modal.remove();
    }
};

// 濡쒖뺄 ?쒕쾭?먯꽌 ?닿뎄蹂??곗씠??諛쏆븘?ㅺ린
window.getMarineZoneData = async function (zoneId) {
    // ?붿껌 ID ?앹꽦 (紐⑤떖 ?リ린 ??痍⑥냼 ?뺤씤??
    const requestId = Date.now() + '_' + zoneId;
    window._marineZoneRequestId = requestId;

    showMarineZoneModal(zoneId, null, true);

    // ??닿뎄 踰덊샇 異붿텧
    let lZone = zoneId;
    let isSmallZone = false;

    if (String(zoneId).includes('-')) {
        const parts = String(zoneId).split('-');
        lZone = parts[0];
        isSmallZone = true;
    }

    try {
        // 濡쒖뺄 ?쒕쾭?먯꽌 ?곗씠??媛?몄삤湲?
        const response = await fetch('/api/marine-zone-forecasts');
        if (!response.ok) throw new Error('濡쒖뺄 ?쒕쾭 ?묐떟 ?ㅻ쪟');

        const json = await response.json();

        // ?붿껌??痍⑥냼?섏뿀?붿? ?뺤씤
        if (requestId !== window._marineZoneRequestId) return;

        // ?곗씠??李얘린
        const zoneData = json.data && json.data[lZone];

        if (zoneData && zoneData.length > 0) {
            // displayTime 異붽?
            const formattedData = zoneData.map(item => ({
                ...item,
                displayTime: formatMarineTime(item.tm)
            }));
            formattedData.baseTime = json.baseTmUtf;

            showMarineZoneModal(zoneId, formattedData, false, null, json.baseTmUtf);
        } else {
            showMarineZoneModal(zoneId, null, false,
                `?대떦 ?닿뎄(${zoneId})???곗씠?곌? ?놁뒿?덈떎.<br>?ㅼ?以꾨윭媛 ?곗씠?곕? ?섏쭛???뚭퉴吏 湲곕떎?ㅼ＜?몄슂.`);
        }
    } catch (error) {
        // console.error('?닿뎄蹂??곗씠??議고쉶 ?ㅻ쪟:', error);
        if (requestId !== window._marineZoneRequestId) return;
        showMarineZoneModal(zoneId, null, false, `?곗씠??議고쉶 以??ㅻ쪟: ${error.message}`);
    }
};

// ?곗씠???뚯떛 ?⑥닔
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

// ?쒓컙 ?щ㎎??(YYYYMMDDHH -> MM.DD HH??
function formatMarineTime(tm) {
    if (!tm || tm.length < 10) return tm;
    const mm = tm.substring(4, 6);
    const dd = tm.substring(6, 8);
    const hh = tm.substring(8, 10);
    return `${mm}.${dd} ${hh}??;
}

// ?꾩옱 ?쒖떆 以묒씤 ?닿뎄 ?뺣낫 (Windy ?곕룞??
let currentZoneInfo = { zoneId: null, lat: null, lon: null };

/**
 * ?닿뎄 踰덊샇?먯꽌 寃쎌쐞??異붿텧
 * SEA_ZONES_DATA??寃⑹옄 ?ㅻ? ??쑝濡??뚯떛?섏뿬 以묒떖 寃쎌쐞??怨꾩궛
 */
function getZoneCoordinatesByZoneId(zoneId) {
    if (typeof SEA_ZONES_DATA === 'undefined' || typeof GRID_DATA === 'undefined') {
        // console.warn('SEA_ZONES_DATA ?먮뒗 GRID_DATA媛 ?놁뒿?덈떎.');
        return null;
    }

    // SEA_ZONES_DATA?먯꽌 ?대떦 zoneId瑜?媛吏?寃⑹옄 ??李얘린
    let foundKey = null;
    for (const [key, value] of Object.entries(SEA_ZONES_DATA)) {
        if (String(value) === String(zoneId)) {
            foundKey = key;
            break;
        }
    }

    if (!foundKey) {
        // [New] ?뚰빐援?ID 泥섎━ (?? "244-1") - ?쎌? ??궛?쇰줈 醫뚰몴 異붿젙
        if (typeof zoneId === 'string' && zoneId.includes('-')) {
            const parts = zoneId.split('-');
            if (parts.length === 2 && !isNaN(parts[1])) {
                const parentZoneNum = parts[0];
                const smallIdx = parseInt(parts[1], 10);

                // 遺紐???닿뎄 ??李얘린
                let parentKey = null;
                for (const [key, value] of Object.entries(SEA_ZONES_DATA)) {
                    if (String(value) === String(parentZoneNum)) {
                        parentKey = key;
                        break;
                    }
                }

                if (parentKey) {
                    // 遺紐?寃⑹옄 ?뺣낫 ?뚯떛
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

                            // ?뚰빐援??몃뜳??(1~9) -> ????(0~2)
                            // row 0: 1,2,3 / row 1: 4,5,6 / row 2: 7,8,9
                            const row = Math.floor((smallIdx - 1) / 3);
                            const col = (smallIdx - 1) % 3;

                            // ?뚰빐援?以묒떖 ?쎌?
                            const centerX = x1 + col * cellW + cellW / 2;
                            const centerY = y1 + row * cellH + cellH / 2;

                            // ?쎌? -> GPS 蹂??
                            const gps = pixelToGps(centerX, centerY);
                            if (gps && gps.lat && gps.lon) {
                                // console.log(`?뚰빐援?${zoneId} 醫뚰몴 怨꾩궛??`, gps);
                                return { lat: gps.lat, lon: gps.lon };
                            }
                        }
                    }
                }
            }
        }

        // console.debug(`?닿뎄 ${zoneId}??寃⑹옄 ?ㅻ? 李얠쓣 ???놁뒿?덈떎.`);
        return null;
    }

    // 寃⑹옄 ???뚯떛: "lon1-lon2_lat1-lat2" ?뺤떇
    // ?? "125-129_65-62"
    const match = foundKey.match(/^(\d+)-(\d+)_(\d+)-(\d+)$/);
    if (!match) {
        // console.warn(`寃⑹옄 ???뚯떛 ?ㅽ뙣: ${foundKey}`);
        return null;
    }

    const lon1Key = match[1];
    const lon2Key = match[2];
    const lat1Key = match[3];
    const lat2Key = match[4];

    // GRID_DATA?먯꽌 ?쎌? 醫뚰몴 媛?몄삤湲?
    const lon1Pixel = GRID_DATA.lon[lon1Key]?.val;
    const lon2Pixel = GRID_DATA.lon[lon2Key]?.val;
    const lat1Pixel = GRID_DATA.lat[lat1Key]?.val;
    const lat2Pixel = GRID_DATA.lat[lat2Key]?.val;

    if (lon1Pixel == null || lon2Pixel == null || lat1Pixel == null || lat2Pixel == null) {
        // console.warn(`GRID_DATA?먯꽌 媛믪쓣 李얠쓣 ???놁뒿?덈떎: ${foundKey}`);
        return null;
    }

    // 寃⑹옄 以묒떖 ?쎌? 醫뚰몴 怨꾩궛
    const centerPixelX = (lon1Pixel + lon2Pixel) / 2;
    const centerPixelY = (lat1Pixel + lat2Pixel) / 2;

    // ?쎌? ??GPS 醫뚰몴 蹂??(?⑥닔 ?ъ슜)
    const gps = pixelToGps(centerPixelX, centerPixelY);
    if (gps) {
        // console.log(`?뱧 ?닿뎄 ${zoneId} 寃쎌쐞?? ${gps.lat.toFixed(2)}, ${gps.lon.toFixed(2)}`);
        return gps;
    }

    return null;
}

/**
 * ?쎌? 醫뚰몴瑜?GPS 醫뚰몴(寃쎈룄, ?꾨룄)濡?蹂??
 * @param {number} x - ?쎌? X
 * @param {number} y - ?쎌? Y
 * @returns {{lat: number, lon: number}} GPS 醫뚰몴
 */
function pixelToGps(x, y) {
    if (typeof GRID_CALIBRATION_DATA === 'undefined') return null;

    // X -> Lon 蹂??
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
    // 踰붿쐞瑜??쎄컙 踰쀬뼱??寃쎌슦 媛?μ옄由?媛??ъ슜 (蹂댁쇅踰??먮뒗 ?대옩??
    if (lon === null) {
        if (x < GRID_CALIBRATION_DATA.lon[lonKeys[0]]) lon = lonKeys[0];
        else if (x > GRID_CALIBRATION_DATA.lon[lonKeys[lonKeys.length - 1]]) lon = lonKeys[lonKeys.length - 1];
    }

    // Y -> Lat 蹂??(Lat???꾩そ??媛믪씠 ?? ?쎌? Y???꾨옒履쎌씠 ??
    let lat = null;
    const latKeys = Object.keys(GRID_CALIBRATION_DATA.lat).map(Number).sort((a, b) => a - b); // ?ㅻ쫫李⑥닚

    for (let i = 0; i < latKeys.length - 1; i++) {
        const k1 = latKeys[i];
        const k2 = latKeys[i + 1];

        // 二쇱쓽: ?꾨룄媛 ?믪쓣?섎줉(遺곸そ) ?쎌? Y媛믪? ?묒쓬(?꾩そ)
        const y_at_k1 = GRID_CALIBRATION_DATA.lat[k1]; // ??Y (??꾨룄)
        const y_at_k2 = GRID_CALIBRATION_DATA.lat[k2]; // ?묒? Y (怨좎쐞??

        // 踰붿쐞 泥댄겕 (y_at_k2 <= y <= y_at_k1)
        const minY = Math.min(y_at_k1, y_at_k2);
        const maxY = Math.max(y_at_k1, y_at_k2);

        if (y >= minY && y <= maxY) {
            // ??퉬??怨꾩궛
            const ratio = (y - y_at_k1) / (y_at_k2 - y_at_k1);
            lat = k1 + (k2 - k1) * ratio;
            break;
        }
    }

    // 踰붿쐞 諛?泥섎━
    if (lat === null) {
        // 媛꾨떒??媛??媛源뚯슫 Y媛믪쓽 ?꾨룄 諛섑솚
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
 * ?꾩옱 ?닿뎄??Windy ?앹뾽 ?닿린 (??李?????앹뾽 紐⑤떖)
 */
function openZoneWindy() {
    if (!currentZoneInfo.lat || !currentZoneInfo.lon) {
        alert('?닿뎄 ?꾩튂 ?뺣낫瑜?李얠쓣 ???놁뒿?덈떎.');
        return;
    }

    const lat = currentZoneInfo.lat.toFixed(3);
    const lon = currentZoneInfo.lon.toFixed(3);
    const zoneId = currentZoneInfo.zoneId;

    // embed.windy.com URL ?앹꽦
    const embedUrl = `https://embed.windy.com/embed2.html?lat=${lat}&lon=${lon}&zoom=7&level=surface&overlay=waves&product=ecmwf&menu=false&message=true&marker=&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=m%2Fs&metricTemp=%C2%B0C&radarRange=-1`;
    const windyUrl = `https://www.windy.com/waves?waves,${lat},${lon},8`;

    // 湲곗〈 紐⑤떖 ?쒓굅
    const existingModal = document.getElementById('zone-windy-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'zone-windy-modal';
    modal.innerHTML = `
        <div class="zone-windy-overlay" onclick="closeZoneWindyPopup()"></div>
        <div class="zone-windy-content">
            <div class="zone-windy-header">
                <h3><i class="fa-solid fa-wind"></i> ${zoneId}?닿뎄 湲곗긽?꾨쭩 - Windy</h3>
                <button class="zone-windy-close" onclick="closeZoneWindyPopup()">??/button>
            </div>
            <div class="zone-windy-iframe">
                <iframe src="${embedUrl}" frameborder="0" allowfullscreen></iframe>
            </div>
            <div class="zone-windy-footer">
                <a href="${windyUrl}" target="_blank" class="zone-windy-link">
                    ?뵕 ????뿉???닿린
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

    // 狩?CSS ?ㅽ???異붽? (?놁쑝硫??앹꽦)
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

// Zone Windy ?앹뾽 ?リ린
function closeZoneWindyPopup() {
    const modal = document.getElementById('zone-windy-modal');
    if (modal) modal.remove();
}

// Windy ?⑥닔 ?꾩뿭 ?몄텧
window.openZoneWindy = openZoneWindy;
window.closeZoneWindyPopup = closeZoneWindyPopup;

// ?곗씠???쒖떆 諛?李⑦듃/?뚯씠釉??뚮뜑留?
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
                    <button id="zone-windy-btn" onclick="openZoneWindy()" style="display:flex; align-items:center; gap:5px; background:linear-gradient(135deg, #00c6fb, #005bea); border:none; color:white; padding:6px 12px; border-radius:16px; font-size:${isMobile ? '12px' : '13px'}; font-weight:600; cursor:pointer; transition:all 0.2s; box-shadow:0 2px 8px rgba(0,91,234,0.3);" title="Windy?먯꽌 蹂닿린">
                        <i class="fas fa-wind"></i> Windy
                    </button>
                </div>
                <button onclick="closeSeaZoneModal()" style="background:none; border:none; color:#aaa; font-size:28px; cursor:pointer; padding:5px 10px; touch-action:manipulation;" title="?リ린"><i class="fas fa-times"></i></button>
            </div>
            <div id="zone-modal-body" style="flex:1; padding:${isMobile ? '10px' : '15px'}; overflow:auto; color:#eee; font-family:'NotosansKR', sans-serif; -webkit-overflow-scrolling:touch;">
            </div>
        </div>`;
        document.body.appendChild(modal);
    }

    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    // ?닿린 ?좊땲硫붿씠??
    requestAnimationFrame(() => {
        modal.style.opacity = '1';
        const content = modal.querySelector('.modal-content');
        if (content) content.style.transform = 'translateY(0)';
    });

    const titleSpan = document.getElementById('zone-modal-title');
    if (titleSpan) titleSpan.textContent = `${zoneId}?닿뎄 湲곗긽?꾨쭩`;

    // ?꾩옱 ?닿뎄 ?뺣낫 ???(Windy ?곕룞??
    currentZoneInfo.zoneId = zoneId;
    const coords = getZoneCoordinatesByZoneId(zoneId);
    if (coords) {
        currentZoneInfo.lat = coords.lat;
        currentZoneInfo.lon = coords.lon;
    } else {
        // 醫뚰몴瑜?李얠? 紐삵븳 寃쎌슦 湲곕낯媛??ъ슜 (?쒕컲??以묒떖)
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
            baseTimeFormatted = `${y}.${m}.${d} ${h}:00 諛쒗몴`;
        } else {
            baseTimeFormatted = `諛쒗몴?쒓컖: ${bt}`;
        }
    }

    const body = document.getElementById('zone-modal-body');
    if (!body) return;

    if (isLoading) {
        body.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%;">
            <i class="fas fa-spinner fa-spin fa-3x" style="color:#3498db; margin-bottom:20px;"></i>
            <div style="font-size:16px; color:#aaa;">湲곗긽泥??곗씠?곕? 遺꾩꽍 以묒엯?덈떎...</div>
        </div>`;
        return;
    }

    if (errorMessage) {
        body.innerHTML = `
        <div style="text-align:center; padding:50px; color:#e74c3c;">
            <i class="fas fa-exclamation-triangle fa-3x" style="margin-bottom:15px;"></i>
            <h3>?곗씠??議고쉶 ?ㅽ뙣</h3>
            <p>${errorMessage}</p>
        </div>`;
        return;
    }

    if (!data || data.length === 0) {
        body.innerHTML = '<div style="text-align:center; padding:50px;">?곗씠?곌? ?놁뒿?덈떎.</div>';
        return;
    }

    // ?좎쭨蹂?洹몃９??
    const dateGroups = {};
    data.forEach(row => {
        const date = row.tm.substring(0, 8);
        if (!dateGroups[date]) dateGroups[date] = [];
        dateGroups[date].push(row);
    });

    // ?뚯씠釉?HTML ?앹꽦
    // ?뚯씠釉?HTML ?앹꽦
    let tableHTML = '<div id="marine-table-container" style="position:relative; overflow-x:auto; overflow-y:auto; -webkit-overflow-scrolling:touch; max-height:100%; touch-action:pan-x pan-y;"><table id="marine-zone-table" style="border-collapse:collapse; table-layout:fixed; font-size:12px; margin:0 auto; background:#1a1a1a;">';

    // ?ㅻ뜑: ?좎쭨 ??
    tableHTML += '<thead><tr style="background:#2c3e50; color:#fff; border-bottom:2px solid #3498db;">';
    tableHTML += `<th style="padding:5px 8px; border:1px solid #333; width:45px; min-width:45px; text-align:center; position:sticky; left:0; background:#2c3e50; z-index:2;">?좎쭨</th>`;

    Object.keys(dateGroups).forEach(date => {
        const mm = date.substring(4, 6);
        const dd = date.substring(6, 8);
        const count = dateGroups[date].length;
        tableHTML += `<th colspan="${count}" style="padding:5px; border:1px solid #333; background:#34495e;">${mm}.${dd}.</th>`;
    });
    tableHTML += '</tr>';

    // ?ㅻ뜑: ?쒓컙 ??
    tableHTML += '<tr style="background:#34495e; color:#ddd; border-bottom:1px solid #555;">';
    tableHTML += '<th style="padding:4px 8px; border:1px solid #333; text-align:center; position:sticky; left:0; background:#34495e; z-index:2;">?쒓컙</th>';

    const cellStyle = 'width:45px; min-width:45px; max-width:45px; box-sizing:border-box; padding:3px 0; border:1px solid #333; text-align:center;';

    data.forEach((row, index) => {
        const hh = row.tm.substring(8, 10);
        tableHTML += `<td id="time-cell-${index}" data-index="${index}" style="${cellStyle} font-weight:bold;">${hh}??/td>`;
    });
    tableHTML += '</tr></thead><tbody>';

    // ??1: ?랁뼢
    tableHTML += '<tr style="background:#1e1e1e; border-bottom:1px solid #333;">';
    tableHTML += '<th style="padding:4px 8px; border:1px solid #333; text-align:center; position:sticky; left:0; background:#2c3e50; z-index:1; color:#4fc3f7; font-size:10px;"> ?랁뼢<br><span style="font-size:9px; font-weight:normal; color:#888;">(deg)</span></th>';
    data.forEach(row => {
        tableHTML += `<td style="${cellStyle}"><i class="fas fa-arrow-up" style="transform:rotate(${row.windDir}deg); color:#4fc3f7; font-size:14px;"></i></td>`;
    });
    tableHTML += '</tr>';

    // ??2: ?띿냽
    tableHTML += '<tr style="background:#1a1a1a; border-bottom:1px solid #333;">';
    tableHTML += '<th style="padding:4px 8px; border:1px solid #333; text-align:center; position:sticky; left:0; background:#2c3e50; z-index:1; color:#ff7043; font-size:10px;"> ?띿냽<br><span style="font-size:9px; font-weight:normal; color:#888;">(m/s)</span></th>';
    data.forEach(row => {
        const color = getMarineWindColor(row.ws);
        tableHTML += `<td style="${cellStyle} color:${color}; font-weight:bold; font-size:11px;">${row.ws.toFixed(1)}</td>`;
    });
    tableHTML += '</tr>';

    // ??3: 洹몃옒??
    const CHART_OFFSET_LEFT = 0;
    const CHART_WIDTH_ADJUST = -3;
    const cellWidth = 45;
    const chartWidth = (data.length * cellWidth) + CHART_WIDTH_ADJUST;

    tableHTML += '<tr style="background:#222;">';
    tableHTML += `<th style="padding:4px 6px; border:1px solid #333; text-align:center; position:sticky; left:0; background:#2c3e50; z-index:1; vertical-align:middle;">
    <div style="display:flex; flex-direction:column; gap:2px; font-size:9px; align-items:center;">
        <span style="color:#ff7043;">?띿냽</span>
        <span style="display:inline-block; width:20px; height:3px; background:#ff7043; border-radius:2px;"></span>
        <span style="color:#26c6da; margin-top:4px;">?좎쓽</span>
        <span style="color:#26c6da;">?뚭퀬</span>
        <span style="display:inline-block; width:10px; height:10px; background:rgba(38,198,218,0.6); border:1px solid #26c6da; border-radius:2px;"></span>
    </div>
</th>`;
    tableHTML += `<td colspan="${data.length}" style="padding:0; border:1px solid #333; overflow:hidden; box-sizing:border-box;">`;
    tableHTML += `<div style="width:${chartWidth}px; height:140px; margin:0; padding-left:${CHART_OFFSET_LEFT}px; display:block; box-sizing:border-box;"><canvas id="marineChart" width="${chartWidth}" height="140" style="display:block;"></canvas></div>`;
    tableHTML += '</td></tr>';

    // ??4: ?좎쓽?뚭퀬
    tableHTML += '<tr style="background:#1a1a1a; border-bottom:1px solid #333;">';
    tableHTML += '<th style="padding:4px 8px; border:1px solid #333; text-align:center; position:sticky; left:0; background:#2c3e50; z-index:1; color:#26c6da; font-size:10px;"> ?좎쓽<br>?뚭퀬<br><span style="font-size:9px; font-weight:normal; color:#888;">(m)</span></th>';
    data.forEach(row => {
        const color = getMarineWaveColor(row.wh);
        tableHTML += `<td style="${cellStyle} color:${color}; font-weight:bold; font-size:11px;">${row.wh.toFixed(1)}</td>`;
    });
    tableHTML += '</tr>';

    // ??5: ?뚰뼢
    tableHTML += '<tr style="background:#1e1e1e; border-bottom:1px solid #333;">';
    tableHTML += '<th style="padding:4px 8px; border:1px solid #333; text-align:center; position:sticky; left:0; background:#2c3e50; z-index:1; color:#81c784; font-size:10px;"> ?뚰뼢<br><span style="font-size:9px; font-weight:normal; color:#888;">(deg)</span></th>';
    data.forEach(row => {
        tableHTML += `<td style="${cellStyle}"><i class="fas fa-location-arrow" style="transform:rotate(${row.waveDir}deg); color:#81c784; font-size:14px;"></i></td>`;
    });
    tableHTML += '</tr>';

    // ??6: ?뚯＜湲?
    tableHTML += '<tr style="background:#1a1a1a;">';
    tableHTML += '<th style="padding:4px 8px; border:1px solid #333; text-align:center; position:sticky; left:0; background:#2c3e50; z-index:1; color:#9575cd; font-size:10px;"> ?뚯＜湲?br><span style="font-size:9px; font-weight:normal; color:#888;">(sec)</span></th>';
    data.forEach(row => {
        tableHTML += `<td style="${cellStyle} color:#ccc; font-size:12px;">${row.wp.toFixed(1)}</td>`;
    });
    tableHTML += '</tr>';

    tableHTML += '</tbody></table></div>';

    // 諛쒗몴?쒓컖 ?곗륫 ?섎떒 ?쒖떆
    if (baseTimeFormatted) {
        tableHTML += `<div style="text-align:right; font-size:11px; color:#8899aa; padding:8px 10px 5px; background:linear-gradient(to top, #1e1e1e 80%, rgba(30,30,30,0)); position:sticky; bottom:0; right:0;">${baseTimeFormatted}</div>`;
    }

    body.innerHTML = tableHTML;

    // 李⑦듃 洹몃━湲?
    setTimeout(() => renderMarineChart(data), 100);
}

// ?띿냽 ?됱긽
function getMarineWindColor(ws) {
    if (ws >= 14) return '#ff5252';
    if (ws >= 9) return '#ffb74d';
    return '#4fc3f7';
}

// ?뚭퀬 ?됱긽
function getMarineWaveColor(wh) {
    if (wh >= 3.0) return '#ff5252';
    if (wh >= 1.5) return '#ffb74d';
    return '#81c784';
}

// Chart.js ?뚮뜑留?
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

    // [New] 而ㅼ뒪? 議곗젙 ?뚮윭洹몄씤 (?ㅽ봽???곸슜留??좎?)
    const adjustmentPlugin = {
        id: 'adjustmentPlugin',
        beforeDatasetsDraw(chart) {
            // ?ㅽ봽???곸슜 Logic
            // index.html???뺤쓽??CHART_OFFSETS 媛믪쓣 媛??곗씠???ъ씤?몄쓽 X 醫뚰몴???뷀븿
            if (!window.CHART_OFFSETS) window.CHART_OFFSETS = [];

            chart.data.datasets.forEach((dataset, datasetIndex) => {
                const meta = chart.getDatasetMeta(datasetIndex);
                // bar(1)? line(0) 紐⑤몢 ?곸슜
                meta.data.forEach((element, index) => {
                    // [Fix] ?ㅽ봽???꾩쟻 臾몄젣 ?닿껐: ?먮옒 ?꾩튂 ???
                    if (typeof element.originalX === 'undefined') {
                        element.originalX = element.x;
                    }

                    const offset = window.CHART_OFFSETS[index] || 0;
                    // ??긽 ?먮옒 ?꾩튂 湲곗??쇰줈 ?ㅽ봽???ㅼ젙 (?꾩쟻 諛⑹?)
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
                    label: '?띿냽 (m/s)',
                    data: windSpeed,
                    type: 'line',
                    borderColor: '#ff7043',
                    backgroundColor: 'rgba(255, 112, 67, 0.2)',
                    borderWidth: 2,
                    yAxisID: 'y_wind',
                    tension: 0.3,
                    pointRadius: 4,
                    pointBackgroundColor: '#ff7043',
                    // [Fix] ?몃쾭 ???좊땲硫붿씠???ㅽ???蹂寃??쒓굅
                    pointHoverRadius: 4,
                    pointHoverBackgroundColor: '#ff7043',
                    pointHoverBorderColor: '#ff7043',
                    pointHoverBorderWidth: 0,
                    order: 1, // ?쇱씤???꾨줈 ?ㅻ룄濡?
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
                    label: '?좎쓽?뚭퀬 (m)',
                    data: waveHeight,
                    type: 'bar',
                    backgroundColor: 'rgba(38, 198, 218, 0.6)',
                    borderColor: '#26c6da',
                    borderWidth: 1,
                    // [Fix] ?몃쾭 ???좊땲硫붿씠???ㅽ???蹂寃??쒓굅
                    hoverBackgroundColor: 'rgba(38, 198, 218, 0.6)',
                    hoverBorderColor: '#26c6da',
                    hoverBorderWidth: 1,
                    yAxisID: 'y_wave',
                    borderRadius: 2,
                    categoryPercentage: 0.8, // 留됰? ?덈퉬 議곗젙
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
                intersect: false // 留됰? 洹쇱쿂留??대┃?대룄 ?몄떇?섎룄濡?
            },
            plugins: {
                legend: { display: false },
                tooltip: { enabled: true }
            },
            scales: {
                x: {
                    display: false,
                    grid: { display: false },
                    offset: true // 以묒슂: 留됰?媛 ???ъ씠???ㅻ룄濡?
                },
                y_wind: { type: 'linear', display: false, position: 'left', beginAtZero: true },
                y_wave: { type: 'linear', display: false, position: 'right', beginAtZero: true }
            }
        }
    });
}

// ----------------------------------------------------------------------------
// [Adjustment Logic] 李⑦듃 ?꾩튂 議곗젙 湲곕뒫 - ??젣??(?ㅽ봽???곸슜留??뚮윭洹몄씤?먯꽌 泥섎━)
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// Tab Navigation
// ----------------------------------------------------------------------------

function initTabs() {
    // ???ㅽ???二쇱엯
    injectTabStyles();

    const tabs = document.querySelectorAll('.tab-btn');
    const contents = document.querySelectorAll('.tab-content');
    let seaZoneInitialized = false; // 吏??珥덇린???щ? ?뚮옒洹?

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetId = tab.getAttribute('data-target');

            // 紐⑤뱺 ??鍮꾪솢?깊솕
            tabs.forEach(t => t.classList.remove('active'));
            // 紐⑤뱺 而⑦뀗痢??④린湲?
            contents.forEach(c => c.classList.remove('active'));

            // ?좏깮?????쒖꽦??
            tab.classList.add('active');
            const targetSection = document.getElementById(targetId);
            if (targetSection) {
                targetSection.classList.add('active');

                // ?닿뎄蹂?湲곗긽 ??씠 ?쒖꽦?붾맆 ??吏??珥덇린??
                if (targetId === 'sea-zone-section') {
                    console.log('Refreshing Sea Zone Map...');
                    // ??씠 ?쒖꽦?붾릺??蹂댁씠???곹깭媛 ????吏??珥덇린??
                    setTimeout(() => {
                        if (window.initSeaZoneMap) {
                            window.initSeaZoneMap();
                        }
                    }, 200); // ?쎄컙??吏?곗쓣 二쇱뼱 CSS媛 ?곸슜????珥덇린??
                }
            }
        });
    });
}

function injectTabStyles() {
    if (document.getElementById('tab-styles')) return;

    const style = document.createElement('style');
    style.id = 'tab-styles';
    style.textContent = `
        /* ?ㅻ뜑 ?대? ??諛곗튂 */
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
        
        /* ?뱀뀡 ?ㅽ????듭씪 */
        .alert-status-section,
        .sea-zone-section {
            background: transparent;
            padding: 0;
            margin: 0;
            border: none;
        }
        
        /* 吏??而⑦뀒?대꼫 ?ㅽ???*/
        .sea-zone-map-container {
            background: transparent;
            padding: 0;
            margin: 20px 0;
        }
        
        /* 吏??異쒖쿂 ?뺣낫 */
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
        
        /* 援ъ뿭 ?대┃ ?덈궡 硫붿떆吏 ?좊땲硫붿씠??*/
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

window.addEventListener('DOMContentLoaded', async () => {
    // console.log('=== Marine Weather Alert System Starting ===');
    // console.log('Using wrn_now_data.php API');
    // console.log('Config:', CONFIG);

    initTabs(); // ??珥덇린??
    updateTimeDisplay();

    // ?ㅽ뵆?섏떆 ?붾㈃ ?몄텧 ?쒖옉 ?쒓컙
    const splashStartTime = Date.now();

    // ?ㅽ뵆?섏떆 ?붾㈃ ?쒓굅 ?⑥닔
    const hideSplash = () => {
        const splash = document.getElementById('splash-screen');
        if (splash) {
            splash.classList.add('fade-out');
            setTimeout(() => {
                splash.remove();
                document.body.classList.remove('loading');
            }, 800); // splash.css??transition ?쒓컙(0.8s)怨??쇱튂
        }
    };

    // 1. ?곗씠??濡쒕뵫 ?湲?
    try {
        await fetchAllData();
    } catch (e) {
        console.error('Initial data fetch failed:', e);
    }

    // 2. 理쒖냼 ?몄텧 ?쒓컙(2珥? 蹂댁옣 ???쒓굅
    const minSplashTime = 1500;
    const elapsedTime = Date.now() - splashStartTime;
    const delay = Math.max(0, minSplashTime - elapsedTime);

    setTimeout(hideSplash, delay);

    // Auto-refresh every 5 minutes (Disabled via user request)
    // setInterval(fetchAllData, 5 * 60 * 1000);
    setInterval(updateTimeDisplay, 60000);
});

window.toggleSection = toggleSection;
window.refreshData = fetchAllData;


// ==================== ?댁긽?덈낫 ?뚯씠釉??쒖떆 ====================


// ?댁긽?덈낫 API ??
const SEA_FORECAST_API_KEY = 'ZKEQU5ukRvGhEFObpBbxVw';

// ?좎뵪 肄붾뱶
const SEA_WEATHER_CODES = {
    'DB01': '?截?, 'DB02': '?뙟截?, 'DB03': '??, 'DB04': '?곻툘'
};

// ?랁뼢 ?쒓? 蹂??
const SEA_WIND_DIRS = {
    'N': '遺?, 'NNE': '遺곷턿??, 'NE': '遺곷룞', 'ENE': '?숇턿??,
    'E': '??, 'ESE': '?숇궓??, 'SE': '?⑤룞', 'SSE': '?⑤궓??,
    'S': '??, 'SSW': '?⑤궓??, 'SW': '?⑥꽌', 'WSW': '?쒕궓??,
    'W': '??, 'WNW': '?쒕턿??, 'NW': '遺곸꽌', 'NNW': '遺곷턿??
};

// ?밸낫 援ъ뿭紐????덈낫 ?쒖떆紐?留ㅽ븨 (UI???쒖떆???대쫫)
const ZONE_NAME_DISPLAY_MAP = {
    // ?쒖＜ 癒쇰컮???듯빀
    '?쒖＜?꾨궓?쒖そ?덉そ癒쇰컮??: '?쒖＜?꾨궓履쎈㉫諛붾떎',
    '?쒖＜?꾨궓?숈そ?덉そ癒쇰컮??: '?쒖＜?꾨궓履쎈㉫諛붾떎',
    '?쒖＜?꾨궓履쎈컮源λ㉫諛붾떎': '?쒖＜?꾨궓履쎈㉫諛붾떎',

    // ?쒗빐以묐?
    '?몄쿇쨌寃쎄린遺곷??욌컮??: '寃쎄린遺곷??욌컮??,
    '?쒗빐以묐??덉そ癒쇰컮??: '?쒗빐以묐?癒쇰컮??,
    '?쒗빐以묐?諛붽묑癒쇰컮??: '?쒗빐以묐?癒쇰컮??,

    // ?쒗빐?⑤? 癒쇰컮???듯빀
    '?쒗빐?⑤?遺곸そ諛붽묑癒쇰컮??: '?쒗빐?⑤?癒쇰컮??,
    '?쒗빐?⑤?遺곸そ?덉そ癒쇰컮??: '?쒗빐?⑤?癒쇰컮??,
    '?쒗빐?⑤??⑥そ諛붽묑癒쇰컮??: '?쒗빐?⑤?癒쇰컮??,
    '?쒗빐?⑤??⑥そ?덉そ癒쇰컮??: '?쒗빐?⑤?癒쇰컮??,

    // ?⑦빐?쒕? 癒쇰컮???듯빀
    '?⑦빐?쒕??쒖そ癒쇰컮??: '?⑦빐?쒕?癒쇰컮??,
    '?⑦빐?쒕??숈そ癒쇰컮??: '?⑦빐?쒕?癒쇰컮??,

    // ?⑦빐?숇? 癒쇰컮???듯빀
    '?⑦빐?숇??덉そ癒쇰컮??: '?⑦빐?숇?癒쇰컮??,
    '?⑦빐?숇?諛붽묑癒쇰컮??: '?⑦빐?숇?癒쇰컮??,

    // ?숉빐?⑤? 癒쇰컮???듯빀
    '?숉빐?⑤??⑥そ?덉そ癒쇰컮??: '?숉빐?⑤?癒쇰컮??,
    '?숉빐?⑤??⑥そ諛붽묑癒쇰컮??: '?숉빐?⑤?癒쇰컮??,
    '?숉빐?⑤?遺곸そ?덉そ癒쇰컮??: '?숉빐?⑤?癒쇰컮??,
    '?숉빐?⑤?遺곸そ諛붽묑癒쇰컮??: '?숉빐?⑤?癒쇰컮??,

    // ?숉빐以묐? 癒쇰컮???듯빀
    '?숉빐以묐??덉そ癒쇰컮??: '?숉빐以묐?癒쇰컮??,
    '?숉빐以묐?諛붽묑癒쇰컮??: '?숉빐以묐?癒쇰컮??
};

// ?밸낫 援ъ뿭紐????덈낫 API 援ъ뿭肄붾뱶 留ㅽ븨
const ZONE_NAME_TO_CODE = {
    // === ?쒖＜ ===
    '?쒖＜?꾩꽌遺?욌컮??: '12B10304',
    '?쒖＜?꾨턿遺?욌컮??: '12B10302',
    '?쒖＜?꾨룞遺?욌컮??: '12B10301',
    '?쒖＜?꾨궓遺?욌컮??: '12B10303',
    '?쒖＜?꾩븵諛붾떎': '12B10300',
    '?쒖＜?꾨궓履쎈㉫諛붾떎': '12B10400',
    '?쒖＜?꾨궓?쒖そ?덉そ癒쇰컮??: '12B10400',
    '?쒖＜?꾨궓?숈そ?덉そ癒쇰컮??: '12B10400',
    '?쒖＜?꾨궓履쎈컮源λ㉫諛붾떎': '12B10400',

    // === ?쒗빐以묐? ===
    '?몄쿇쨌寃쎄린遺곷??욌컮??: '12A20101',
    '寃쎄린遺곷??욌컮??: '12A20101',
    '?몄쿇쨌寃쎄린?⑤??욌컮??: '12A20102',
    '異⑸궓遺곷??욌컮??: '12A20103',
    '異⑸궓?⑤??욌컮??: '12A20104',
    '?쒗빐以묐??욌컮??: '12A20100',
    '?쒗빐以묐?癒쇰컮??: '12A20200',
    '?쒗빐以묐??덉そ癒쇰컮??: '12A20200',
    '?쒗빐以묐?諛붽묑癒쇰컮??: '12A20200',

    // === ?쒗빐?⑤? ===
    '?꾨턿遺곷??욌컮??: '22A30101',
    '?꾨턿?⑤??욌컮??: '22A30102',
    '?꾨궓遺곷??쒗빐?욌컮??: '22A30103',
    '?꾨궓以묐??쒗빐?욌컮??: '22A30104',
    '?꾨궓?⑤??쒗빐?욌컮??: '22A30105',
    '?쒗빐?⑤??욌컮??: '12A30100',
    '?쒗빐?⑤?癒쇰컮??: '12A30200',
    '?쒗빐?⑤?遺곸そ諛붽묑癒쇰컮??: '12A30200',
    '?쒗빐?⑤?遺곸そ?덉そ癒쇰컮??: '12A30200',
    '?쒗빐?⑤??⑥そ諛붽묑癒쇰컮??: '12A30200',
    '?쒗빐?⑤??⑥そ?덉そ癒쇰컮??: '12A30200',

    // === ?쒗빐遺곷? ===
    '?쒗빐遺곷??욌컮??: '12A10100',
    '?쒗빐遺곷?癒쇰컮??: '12A10200',

    // === ?⑦빐?쒕? ===
    '?꾨궓?쒕??⑦빐?욌컮??: '12B10101',
    '?꾨궓?숇??⑦빐?욌컮??: '12B10102',
    '?⑦빐?쒕??욌컮??: '12B10100',
    '?⑦빐?쒕?癒쇰컮??: '12B10200',
    '?⑦빐?쒕??쒖そ癒쇰컮??: '12B10200',
    '?⑦빐?쒕??숈そ癒쇰컮??: '12B10200',

    // === ?⑦빐?숇? ===
    '寃쎈궓?쒕??⑦빐?욌컮??: '12B20101',
    '寃쎈궓以묐??⑦빐?욌컮??: '12B20102',
    '遺?곗븵諛붾떎': '12B20103',
    '嫄곗젣?쒕룞遺?욌컮??: '12B20104',
    '?⑦빐?숇??욌컮??: '12B20100',
    '?⑦빐?숇?癒쇰컮??: '12B20200',
    '?⑦빐?숇??덉そ癒쇰컮??: '12B20200',
    '?⑦빐?숇?諛붽묑癒쇰컮??: '12B20200',

    // === ?숉빐?⑤? ===
    '?몄궛?욌컮??: '12C10101',
    '寃쎈턿?⑤??욌컮??: '12C10102',
    '寃쎈턿遺곷??욌컮??: '12C10103',
    '?숉빐?⑤??욌컮??: '12C10100',
    '?숉빐?⑤?癒쇰컮??: '12C10200',
    '?숉빐?⑤??⑥そ?덉そ癒쇰컮??: '12C10200',
    '?숉빐?⑤??⑥そ諛붽묑癒쇰컮??: '12C10200',
    '?숉빐?⑤?遺곸そ?덉そ癒쇰컮??: '12C10200',
    '?숉빐?⑤?遺곸そ諛붽묑癒쇰컮??: '12C10200',

    // === ?숉빐以묐? ===
    '媛뺤썝?⑤??욌컮??: '12C20101',
    '媛뺤썝以묐??욌컮??: '12C20102',
    '媛뺤썝遺곷??욌컮??: '12C20103',
    '?숉빐以묐??욌컮??: '12C20100',
    '?숉빐以묐?癒쇰컮??: '12C20200',
    '?숉빐以묐??덉そ癒쇰컮??: '12C20200',
    '?숉빐以묐?諛붽묑癒쇰컮??: '12C20200',

    // === ?숉빐遺곷? ===
    '?숉빐遺곷??욌컮??: '12C30100',
    '?숉빐遺곷?癒쇰컮??: '12C30200'
};

// 援ъ뿭紐낆쑝濡?API 肄붾뱶 李얘린 (媛쒖꽑??踰꾩쟾)
function getZoneCodeByName(zoneName) {
    // 0. 留ㅽ븨 ?뚯씠釉붿뿉??癒쇱? 李얘린
    if (ZONE_NAME_TO_CODE[zoneName]) {
        return ZONE_NAME_TO_CODE[zoneName];
    }

    if (typeof SEA_ZONE_COORDINATES === 'undefined') return null;

    // ?뺢퇋???⑥닔 (怨듬갚 ?쒓굅, ?뱀닔臾몄옄 ?쒓굅)
    const normalize = (str) => str.replace(/\s+/g, '').replace(/[쨌]/g, '');
    const normalizedInput = normalize(zoneName);

    // 1. ?뺥솗???쇱튂
    for (const [code, zone] of Object.entries(SEA_ZONE_COORDINATES)) {
        if (zone.name === zoneName) {
            return code;
        }
    }

    // 2. ?뺢퇋?????쇱튂
    for (const [code, zone] of Object.entries(SEA_ZONE_COORDINATES)) {
        if (normalize(zone.name) === normalizedInput) {
            return code;
        }
    }

    // 3. 遺遺??쇱튂 (?낅젰??API ?대쫫???ы븿?섍굅?? API ?대쫫???낅젰???ы븿)
    for (const [code, zone] of Object.entries(SEA_ZONE_COORDINATES)) {
        const normalizedZone = normalize(zone.name);
        if (normalizedInput.includes(normalizedZone) || normalizedZone.includes(normalizedInput)) {
            return code;
        }
    }

    // 4. ?댁긽 ??諛붾떎 蹂?????ъ떆??
    const converted = zoneName.replace('?댁긽', '諛붾떎');
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

    console.warn('援ъ뿭 肄붾뱶瑜?李얠쓣 ???놁쓬:', zoneName);
    return null;
}

// ?댁긽?덈낫 ?앹뾽 紐⑤떖 ?쒖떆
async function showSeaForecastTable(zoneName) {
    // 留ㅽ븨???쒖떆 ?대쫫 媛?몄삤湲?
    const displayName = ZONE_NAME_DISPLAY_MAP[zoneName] || zoneName;

    // 湲곗〈 紐⑤떖???덉쑝硫??쒓굅
    const existingModal = document.getElementById('sea-forecast-modal');
    if (existingModal) {
        existingModal.remove();
    }

    // 紐⑤떖 ?앹꽦
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

    // 紐⑤떖 而⑦뀗痢?
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

    // ?ㅻ뜑
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
            <span style="font-size:1.5rem;">?截?/span>
            <div>
                <div style="font-size:1.1rem;font-weight:700;color:#1a1e2e;">${displayName}</div>
                <div style="font-size:0.85rem;color:rgba(0,0,0,0.6);">湲곗긽?덈낫</div>
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
        ">횞</button>
    `;

    // 而⑦뀗痢??곸뿭
    const contentArea = document.createElement('div');
    contentArea.id = 'forecast-content-area';
    contentArea.style.cssText = `
        padding: 20px;
        overflow-x: auto;
    `;
    contentArea.innerHTML = `
        <div style="text-align:center;padding:40px;color:#8899aa;">
            <div style="width:40px;height:40px;border:3px solid #3a4459;border-top-color:#ffd54f;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 15px;"></div>
            <p>?덈낫 ?곗씠?곕? 議고쉶?섍퀬 ?덉뒿?덈떎...</p>
        </div>
        <style>
            @keyframes spin { to { transform: rotate(360deg); } }
        </style>
    `;

    modalContent.appendChild(header);
    modalContent.appendChild(contentArea);
    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // ?닿린 ?좊땲硫붿씠??
    requestAnimationFrame(() => {
        modal.style.background = 'rgba(0, 0, 0, 0.8)';
        modalContent.style.transform = 'scale(1) translateY(0)';
        modalContent.style.opacity = '1';
    });

    // 紐⑤떖 ?リ린 ?⑥닔
    const closeModal = () => {
        modal.style.background = 'rgba(0, 0, 0, 0)';
        modalContent.style.transform = 'scale(0.9) translateY(20px)';
        modalContent.style.opacity = '0';
        setTimeout(() => modal.remove(), 300);
        document.removeEventListener('keydown', escHandler);
    };

    // ?リ린 踰꾪듉 ?대깽??
    document.getElementById('close-forecast-modal').onclick = closeModal;

    // 諛곌꼍 ?대┃ ???リ린
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };

    // ESC ?ㅻ줈 ?リ린
    const escHandler = (e) => {
        if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', escHandler);

    // API 肄붾뱶 李얘린
    const regId = getZoneCodeByName(zoneName);
    if (!regId) {
        contentArea.innerHTML = `<div style="text-align:center;padding:30px;color:#ff9800;">?좑툘 ?대떦 援ъ뿭???덈낫 肄붾뱶瑜?李얠쓣 ???놁뒿?덈떎.<br><small style="color:#666;">(${zoneName})</small></div>`;
        return;
    }

    try {
        // 濡쒖뺄 ?쒕쾭 API?먯꽌 ?곗씠??媛?몄삤湲?
        const response = await fetch('/api/forecasts');
        if (!response.ok) throw new Error('濡쒖뺄 ?쒕쾭 ?묐떟 ?ㅻ쪟');

        const json = await response.json();

        // regId濡??곗씠??李얘린
        const items = json.data && json.data[regId];

        if (items && items.length > 0) {
            // 諛쒗몴?쒓컖
            const tmFc = json.tmFc || (items[0] && items[0].tmFc);
            renderSeaForecastTableInModal(contentArea, items, displayName, tmFc);
        } else {
            contentArea.innerHTML = `<div style="text-align:center;padding:30px;color:#ff9800;">?좑툘 ?대떦 援ъ뿭(${regId})???덈낫 ?곗씠?곌? ?놁뒿?덈떎.<br><small style="color:#666;">?ㅼ?以꾨윭媛 ?곗씠?곕? ?섏쭛???뚭퉴吏 湲곕떎?ㅼ＜?몄슂.</small></div>`;
        }
    } catch (error) {
        // console.error('?댁긽?덈낫 議고쉶 ?ㅻ쪟:', error);
        contentArea.innerHTML = `<div style="text-align:center;padding:30px;color:#ef5350;">???곗씠??議고쉶 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.<br><small>${error.message}</small></div>`;
    }
}



// ?댁긽?덈낫 ?뚯씠釉??뚮뜑留?(紐⑤떖?? - VilageFcstMsgService API 援ъ“
function renderSeaForecastTableInModal(container, items, zoneName, tmFc = null) {
    const today = new Date();
    const dayNames = ['??, '??, '??, '??, '紐?, '湲?, '??];

    // numEf瑜??좎쭨/?쒓컙?쇰줈 蹂??
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

    // ?좎쭨蹂?洹몃９??
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

    // ?뚯씠釉??ㅽ???
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

    // ?좎쭨 ?ㅻ뜑 ??
    html += `<tr>
        <th style="${thStyle}; ${labelStyle}">?좎쭨</th>`;
    sortedDays.forEach((dayKey, idx) => {
        const d = dateGroups[dayKey].date;
        const dayLabels = ['?ㅻ뒛', '?댁씪', '紐⑤젅', ''];
        const label = dayLabels[idx] || '';
        const dateStr = `${d.getDate()}??${dayNames[d.getDay()]})`;
        html += `<th colspan="2" style="${thStyle}">${dateStr}<br><small style="opacity:0.7">${label}</small></th>`;
    });
    html += `</tr>`;

    // ?쒓컙 ?ㅻ뜑 ??
    html += `<tr>
        <th style="${thStyle}; ${labelStyle}">?쒓컖</th>`;
    sortedDays.forEach(() => {
        html += `<th style="${thStyle}; font-size:0.8rem;">?ㅼ쟾</th><th style="${thStyle}; font-size:0.8rem;">?ㅽ썑</th>`;
    });
    html += `</tr>`;

    // ?좎뵪 ??
    html += `<tr>
        <th style="${tdStyle}; ${labelStyle}">?좎뵪</th>`;
    sortedDays.forEach(dayKey => {
        const group = dateGroups[dayKey];
        ['am', 'pm'].forEach(period => {
            const f = group[period];
            if (f) {
                const icon = SEA_WEATHER_CODES[f.wfCd] || '??;
                html += `<td style="${tdStyle}"><span style="font-size:1.3rem">${icon}</span></td>`;
            } else {
                html += `<td style="${tdStyle}">-</td>`;
            }
        });
    });
    html += `</tr>`;

    // ?뚭퀬 ??
    html += `<tr>
        <th style="${tdStyle}; ${labelStyle}">?뚭퀬<small style="display:block;font-size:0.7rem;color:#8899aa">(m)</small></th>`;
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

    // ?띿냽 ??
    html += `<tr>
        <th style="${tdStyle}; ${labelStyle}">?띿냽<small style="display:block;font-size:0.7rem;color:#8899aa">(m/s)</small></th>`;
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

    // ?랁뼢 ??
    html += `<tr>
        <th style="${tdStyle}; ${labelStyle}">?랁뼢</th>`;
    sortedDays.forEach(dayKey => {
        const group = dateGroups[dayKey];
        ['am', 'pm'].forEach(period => {
            const f = group[period];
            if (f && f.wd1) {
                const wd1 = SEA_WIND_DIRS[f.wd1] || f.wd1;
                const wd2 = SEA_WIND_DIRS[f.wd2] || f.wd2;
                html += `<td style="${tdStyle}">${wd1}??{wd2}</td>`;
            } else {
                html += `<td style="${tdStyle}">-</td>`;
            }
        });
    });
    html += `</tr>`;

    // ?덈낫 ??
    html += `<tr>
        <th style="${tdStyle}; ${labelStyle}">?덈낫</th>`;
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

    // 諛쒗몴?쒓컖 ?щ㎎??
    let tmFcText = '';
    if (tmFc) {
        const tmFcStr = String(tmFc);
        const year = tmFcStr.substring(0, 4);
        const month = tmFcStr.substring(4, 6);
        const day = tmFcStr.substring(6, 8);
        const hour = tmFcStr.substring(8, 10);
        const minute = tmFcStr.substring(10, 12);
        tmFcText = `${year}.${month}.${day} ${hour}:${minute} 諛쒗몴`;
    }

    // ?뚯씠釉붽낵 諛쒗몴?쒓컖 ?쒖떆
    container.innerHTML = `
        <div style="position:relative;">
            <div style="overflow-x:auto;">${html}</div>
            ${tmFcText ? `
                <div style="
                    text-align: right;
                    padding: 10px 5px 5px 5px;
                    font-size: 0.75rem;
                    color: #8899aa;
                    position: sticky;
                    right: 0;
                    bottom: 0;
                    background: linear-gradient(to right, transparent, #1a1e2e 30%);
                ">${tmFcText}</div>
            ` : ''}
        </div>
    `;
}

// ?꾩뿭 ?⑥닔濡??깅줉
window.showSeaForecastTable = showSeaForecastTable;

// ===== ?닿뎄蹂?湲곗긽?뺣낫 ?댁슜?덈궡 ?앹뾽 =====

/**
 * ?닿뎄蹂?湲곗긽?뺣낫 ?댁슜?덈궡 ?앹뾽 ?쒖떆
 */
function showSeaZoneInfoPopup() {
    // 湲곗〈 紐⑤떖 ?덉쑝硫??쒓굅
    const existing = document.getElementById('sea-zone-info-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'sea-zone-info-modal';
    modal.className = 'sea-zone-info-modal';
    modal.innerHTML = `
        <div class="sea-zone-info-overlay" onclick="closeSeaZoneInfoPopup()"></div>
        <div class="sea-zone-info-content">
            <div class="sea-zone-info-header">
                <h3><i class="fa-solid fa-circle-info"></i> ?댁슜?덈궡</h3>
                <button class="sea-zone-info-close" onclick="closeSeaZoneInfoPopup()" title="?リ린">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="sea-zone-info-body">
                <div class="info-section">
                    <div class="info-section-title">
                        <i class="fa-solid fa-database"></i> ?쒓났?뺣낫 (湲곗긽泥?API)
                    </div>
                    <ul class="info-list">
                        <li>媛???닿뎄節μ냼?닿뎄蹂?湲곗긽?꾨쭩 (留ㅼ씪 00?? 12??諛쒗몴)</li>
                        <li>媛?遺?대퀎 愿痢??곗씠??(留ㅼ떆媛?諛쒗몴)</li>
                    </ul>
                </div>
                <div class="info-section">
                    <div class="info-section-title">
                        <i class="fa-solid fa-triangle-exclamation"></i> ?좎쓽?ы빆
                    </div>
                    <ul class="info-list">
                        <li>寃쎌쐞???ㅼ감 媛?μ꽦 怨좊젮 ??빐?⑸룄 ?ъ슜遺덇?</li>
                        <li>媛??밸낫援ъ뿭 諛?遺?대뒗 ??듭쟻 ?꾩튂濡??쒖텧</li>
                        <li>?곗븞諛붾떎 諛??됱닔援ъ뿭???꾩튂?뺣낫 誘명몴異?/li>
                    </ul>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // ?좊땲硫붿씠?섏쓣 ?꾪빐 ?쎄컙???쒕젅????show ?대옒??異붽?
    requestAnimationFrame(() => {
        modal.classList.add('show');
    });
}

/**
 * ?닿뎄蹂?湲곗긽?뺣낫 ?댁슜?덈궡 ?앹뾽 ?リ린
 */
function closeSeaZoneInfoPopup() {
    const modal = document.getElementById('sea-zone-info-modal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => modal.remove(), 300);
    }
}

// ?꾩뿭 ?⑥닔濡??깅줉
window.showSeaZoneInfoPopup = showSeaZoneInfoPopup;
window.closeSeaZoneInfoPopup = closeSeaZoneInfoPopup;

// ===== ?댁뿭蹂??밸낫 ?꾪솴 ?댁슜?덈궡 ?앹뾽 =====

/**
 * ?댁뿭蹂??밸낫 ?꾪솴 ?댁슜?덈궡 ?앹뾽 ?쒖떆
 */
function showWeatherAlertInfoPopup() {
    // 湲곗〈 紐⑤떖 ?덉쑝硫??쒓굅
    const existing = document.getElementById('weather-alert-info-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'weather-alert-info-modal';
    modal.className = 'sea-zone-info-modal';
    modal.innerHTML = `
        <div class="sea-zone-info-overlay" onclick="closeWeatherAlertInfoPopup()"></div>
        <div class="sea-zone-info-content">
            <div class="sea-zone-info-header">
                <h3><i class="fa-solid fa-circle-info"></i> ?댁슜?덈궡</h3>
                <button class="sea-zone-info-close" onclick="closeWeatherAlertInfoPopup()" title="?リ린">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="sea-zone-info-body">
                <div class="info-section">
                    <div class="info-section-title">
                        <i class="fa-solid fa-database"></i> ?쒓났?뺣낫 (湲곗긽泥?API ??
                    </div>
                    <ul class="info-list">
                        <li>媛??댁뿭 ?밸낫援ъ뿭蹂??밸낫(?쒗뭾, ?띾옉, ??뭾?댁씪, 吏吏꾪빐?? ?꾪솴 諛?蹂寃쎌궗??/li>
                        <li>?밸낫援ъ뿭 ???꾩튂 以묒씤 遺?댁쓽 愿痢??곗씠??(留ㅼ떆媛?諛쒗몴)</li>
                        <li>?욌컮?ㅼ쓽 湲곗긽?덈낫 (05?? 17??諛쒗몴)</li>
                        <li>?닿뎄蹂?湲곗긽?꾨쭩</li>
                    </ul>
                </div>
                <div class="info-section">
                    <div class="info-section-title">
                        <i class="fa-solid fa-triangle-exclamation"></i> ?좎쓽?ы빆
                    </div>
                    <ul class="info-list">
                        <li>湲곗긽?밸낫 : 湲곗긽泥?뿉??諛쒗몴?섎뒗 ?뺣낫瑜?湲곕컲?쇰줈 ?쒓났?섎굹, 湲곗긽泥??덊럹?댁? 湲곗긽?뺣낫 ?섏떆 ?뺤씤 ?붾쭩</li>
                        <li>異쒗빆 媛?μ뿬遺 ???먮떒 ??諛섎뱶???좉퀬湲곌?(?뚯텧?? 異쒖옣???????뺤씤 ?붾쭩</li>
                    </ul>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // ?좊땲硫붿씠?섏쓣 ?꾪빐 ?쎄컙???쒕젅????show ?대옒??異붽?
    requestAnimationFrame(() => {
        modal.classList.add('show');
    });
}

/**
 * ?댁뿭蹂??밸낫 ?꾪솴 ?댁슜?덈궡 ?앹뾽 ?リ린
 */
function closeWeatherAlertInfoPopup() {
    const modal = document.getElementById('weather-alert-info-modal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => modal.remove(), 300);
    }
}

// ?꾩뿭 ?⑥닔濡??깅줉
window.showWeatherAlertInfoPopup = showWeatherAlertInfoPopup;
window.closeWeatherAlertInfoPopup = closeWeatherAlertInfoPopup;

// ===== 臾????뺣낫 ?댁슜?덈궡 ?앹뾽 =====

/**
 * 臾????뺣낫 ?댁슜?덈궡 ?앹뾽 ?쒖떆
 */
function showTideInfoPopup() {
    // 湲곗〈 紐⑤떖 ?덉쑝硫??쒓굅
    const existing = document.getElementById('tide-info-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'tide-info-modal';
    modal.className = 'sea-zone-info-modal';
    modal.innerHTML = `
        <div class="sea-zone-info-overlay" onclick="closeTideInfoPopup()"></div>
        <div class="sea-zone-info-content">
            <div class="sea-zone-info-header">
                <h3><i class="fa-solid fa-circle-info"></i> ?댁슜?덈궡</h3>
                <button class="sea-zone-info-close" onclick="closeTideInfoPopup()" title="?リ린">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="sea-zone-info-body">
                <div class="info-section">
                    <div class="info-section-title">
                        <i class="fa-solid fa-database"></i> ?쒓났?뺣낫 (援?┰?댁뼇議곗궗??議곗꽍?덈낫 API 湲곕컲)
                    </div>
                    <ul class="info-list">
                        <li>議곗꽍?뺣낫, ?쇱텧節λぐ, ?붿텧節λぐ, ?붾졊 諛?諛앷린, ??紐⑥뼇 ?뺣낫</li>
                    </ul>
                </div>
                <div class="info-section">
                    <div class="info-section-title">
                        <i class="fa-solid fa-triangle-exclamation"></i> ?좎쓽?ы빆
                    </div>
                    <ul class="info-list">
                        <li>援?┰?댁뼇議곗궗?먯? 怨듭떇?곸쑝濡?166媛?<strong>"?쒖??????꾩튂??議곗꽍?뺣낫瑜??쒓났?섏? ?딆쓬"</strong></li>
                        <li>?좏깮???꾩튂???뺣낫??<strong>"?쒖???쓽 議곗꽍 愿痢∽쉈?덉륫?뺣낫瑜?湲곗?"</strong>?쇰줈 ?섍꼍, 嫄곕━ ???붿냼瑜?<strong style="color: #448aff;">"?먯껜 怨꾩궛 濡쒖쭅??諛섏쁺"</strong>?섏뿬 ?곗텧??寃곌낵??</li>
                        <li>?곗텧??寃곌낵???먯껜 怨꾩궛 濡쒖쭅???곕씪 怨꾩궛??媛믪씠誘濡?<strong style="color: #ff5252;">"?ㅼ젣? ?ㅼ감媛 ?덉쑝誘濡????뺣낫 ?댁슜???곕Ⅸ 梨낆엫??吏吏 ?딆쓬."</strong></li>
                    </ul>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // ?좊땲硫붿씠?섏쓣 ?꾪빐 ?쎄컙???쒕젅????show ?대옒??異붽?
    requestAnimationFrame(() => {
        modal.classList.add('show');
    });
}

/**
 * 臾????뺣낫 ?댁슜?덈궡 ?앹뾽 ?リ린
 */
function closeTideInfoPopup() {
    const modal = document.getElementById('tide-info-modal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => modal.remove(), 300);
    }
}

// ?꾩뿭 ?⑥닔濡??깅줉
window.showTideInfoPopup = showTideInfoPopup;
window.closeTideInfoPopup = closeTideInfoPopup;

// ?ㅻ뜑 ?대┃ ???꾩껜 ?곗씠???덈줈怨좎묠
async function handleHeaderRefresh() {
    // 湲곗긽?뺣낫 ??쑝濡?媛뺤젣 ?꾪솚
    const weatherTab = document.querySelector('.tab-btn[data-target="weather-alert-section"]');
    if (weatherTab) {
        weatherTab.click();
    }

    // ?대? 濡쒕뵫 以묒씠硫?臾댁떆
    if (appState.isLoading) return;

    try {
        await fetchAllData();
    } catch (e) {
        // console.error('Refresh failed:', e);
    }
}
window.handleHeaderRefresh = handleHeaderRefresh;

// ============================================================================
// ?ㅼ떆媛??쒓컙 ?쒖떆 ?낅뜲?댄듃
// ============================================================================

/**
 * ?곗륫 ?곷떒 ?쒓컙 ?쒖떆 ?낅뜲?댄듃
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

    // 醫뚯륫 ?곷떒 '理쒓렐 ?낅뜲?댄듃' ?쒓컙???꾩옱 ?쒓컙?쇰줈 ?숆린??
    // (?ъ슜???붿껌: ?꾨Т寃껊룄 ???대룄 ?먮룞 ?낅뜲?댄듃, ???쒓컙 ?숈씪?섍쾶)
    if (typeof ApiStatusManager !== 'undefined') {
        // appState.lastUpdated瑜??꾩옱 ?쒓컙?쇰줈 ?좎떆 ??뼱?곌굅?? 
        // ApiStatusManager.update()媛 ?대??곸쑝濡?new Date()瑜??곕룄濡??덉쑝誘濡?洹몃깷 ?몄텧留??섎㈃ ??
        // ?? ApiStatusManager.update()媛 appState.lastUpdated瑜??곗꽑 ?ъ슜?쒕떎硫?
        // ?ш린??濡쒖쭅 蹂寃쎌씠 ?꾩슂?????덉쑝?? ?댁쟾 ?ㅽ뀦?먯꽌 new Date()瑜?fallback?쇰줈 ?ｌ뿀??
        // ?섏?留??ъ슜?먭? "?쒓컙 湲곗????숈씪?섍쾶"?쇨퀬 ?덉쑝誘濡?
        // ApiStatusManager媛 ?쒖떆?섎뒗 ?쒓컙??'current-time'怨??꾩쟾??媛숈븘????

        // 媛???뺤떎??諛⑸쾿: ApiStatusManager ?낅뜲?댄듃 ??appState.lastUpdated媛 ?꾨땶 'now'瑜??곕룄濡??좊룄
        // ?댁쟾 ?섏젙?먯꽌: const time = appState.lastUpdated || new Date(); ???
        // ?낅뜲?댄듃 ???뚮??쇰㈃ lastUpdated??媛깆떊 ????-> 援??쒓컙????
        // ?곕씪??"?먮룞 ?낅뜲?댄듃"瑜??먰븳?ㅻ㈃ 洹몃깷 ?꾩옱 ?쒓컙??諛뺤븘????

        // ApiStatusManager.update() ?댁슜??蹂대㈃ appState.lastUpdated媛 ?덉쑝硫?洹멸구 ?.
        // 洹몃윭誘濡?媛뺤젣濡??꾩옱 ?쒓컙??蹂댁뿬二쇰젮硫?update 濡쒖쭅????怨좎퀜???섍굅??
        // ?ш린??吏곸젒 DOM??嫄대뱶?ㅼ빞 ??

        // ?섏?留???醫뗭? 諛⑸쾿:
        // ApiStatusManager.update()媛 '?ㅼ떆媛??쒓퀎' ??븷???섎룄濡?蹂寃쏀뻽?댁빞 ??
        // ?댁쟾 ?④퀎?먯꽌 ?섏젙??ApiStatusManager.update()??'lastUpdated'媛 ?덉쑝硫?洹멸구 ?쇱쓬.
        // ?ъ슜?먮뒗 "?꾨Т寃껊룄 ?섏? ?딆븘???쒓컙??媛湲? ?먰븿.
        // 利?lastUpdated(?곗씠??媛깆떊 ?쒓컖)???꾨땲??Current Time(?꾩옱 ?쒓컖)???먰븿.

        // ?곕씪???ш린??ApiStatusManager??update瑜??몄텧?섎릺, 
        // ApiStatusManager.update ?대??먯꽌 'lastUpdated' ?섏〈?깆쓣 ?쒓굅?섍퀬 ??긽 new Date()瑜??곌쾶 ?댁빞 ??

        // 洹몃윭?ㅻ㈃ ???⑥닔?먯꽌 ApiStatusManager瑜??몄텧?섍린 ?꾩뿉, 
        // ApiStatusManager.update() 硫붿냼?쒕? ?ㅼ떆 ?섏젙?댁빞 ??
        // ?쇰떒 ?ш린?쒕뒗 ?몄텧留?異붽?. ?ㅼ쓬 ?ㅽ뀦?대굹 ?대쾲 ?ㅽ뀦?먯꽌 ApiStatusManager??怨좎퀜????
        if (window.ApiStatusManager) ApiStatusManager.update();
    }
}

// ?쒓컙 ?쒖떆 珥덇린??諛?1珥덈쭏???낅뜲?댄듃 (珥??⑥쐞 ?숆린??
updateTimeDisplay();
setInterval(updateTimeDisplay, 1000);

// ============================================================================
// ?덈뵒 ?앹뾽 湲곕뒫
// ============================================================================

/**
 * ?덈뵒 ?앹뾽 ?쒖떆
 * @param {string} zoneName - ?밸낫援ъ뿭紐?
 */
function showWindyPopup(zoneName) {
    const embedUrl = getWindyEmbedUrl(zoneName);
    const windyUrl = WINDY_URL_MAPPING[zoneName];

    if (!embedUrl) {
        // console.warn('?덈뵒 URL??李얠쓣 ???놁뒿?덈떎:', zoneName);
        return;
    }

    // 湲곗〈 ?앹뾽 ?쒓굅
    const existingModal = document.getElementById('windy-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'windy-modal';
    modal.innerHTML = `
        <div class="windy-modal-overlay" onclick="closeWindyPopup()"></div>
        <div class="windy-modal-content">
            <div class="windy-modal-header">
                <h3>?? ${zoneName} - Windy</h3>
                <button class="windy-close-btn" onclick="closeWindyPopup()">??/button>
            </div>
            <div class="windy-iframe-container">
                <iframe src="${embedUrl}" frameborder="0" allowfullscreen></iframe>
            </div>
            <div class="windy-modal-footer">
                <a href="${windyUrl}" target="_blank" class="windy-external-link">
                    ?뵕 ????뿉???닿린
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

    // ?ㅽ???異붽?
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

    // 湲곗〈 ?ㅽ????쒓굅 ??異붽?
    const existingStyle = document.getElementById('windy-modal-style');
    if (existingStyle) existingStyle.remove();
    document.head.appendChild(style);

    document.body.appendChild(modal);

    // ESC ?ㅻ줈 ?リ린
    const handleEsc = (e) => {
        if (e.key === 'Escape') {
            closeWindyPopup();
            document.removeEventListener('keydown', handleEsc);
        }
    };
    document.addEventListener('keydown', handleEsc);
}

// ============================================================================
// ?좉퇋: ?댁뿭蹂?湲곗긽 ?꾪솴 (?밸낫 臾닿? ?꾩껜 援ъ뿭 ?쒖떆)
// ============================================================================

function getSeaRegion(zoneName) {
    if (zoneName.includes('?숉빐') || zoneName.includes('?몄궛') || zoneName.includes('寃쎈턿') || zoneName.includes('媛뺤썝')) return 'east';
    if (zoneName.includes('?쒗빐') || zoneName.includes('?몄쿇') || zoneName.includes('寃쎄린') || zoneName.includes('異⑸궓') || zoneName.includes('?꾨턿')) return 'west';
    if (zoneName.includes('?⑦빐') || zoneName.includes('寃쎈궓') || zoneName.includes('遺??) || zoneName.includes('嫄곗젣') || zoneName.includes('?꾨궓')) return 'south';
    if (zoneName.includes('?쒖＜')) return 'jeju';
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
        // 留ㅽ븨??援ъ뿭?몄? ?뺤씤
        const isMappedZone = typeof ZONE_NAME_DISPLAY_MAP !== 'undefined' && ZONE_NAME_DISPLAY_MAP[zoneName];

        const btnContainer = document.createElement('div');
        btnContainer.style.cssText = `
            display: flex;
            gap: 8px;
            margin-top: 15px;
            flex-wrap: nowrap;
        `;

        // 1. 湲곗긽?덈낫 踰꾪듉
        if (!isMappedZone) {
            const forecastBtn = document.createElement('button');
            forecastBtn.className = 'forecast-btn';
            forecastBtn.innerHTML = '?截?湲곗긽?덈낫';
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

        // 2. ?닿뎄蹂?湲곗긽?꾨쭩 踰꾪듉
        const zoneViewBtn = document.createElement('button');
        zoneViewBtn.className = 'zone-view-btn';
        zoneViewBtn.innerHTML = '?뿺截??닿뎄蹂?湲곗긽?꾨쭩';
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

        // 3. ?덈뵒 踰꾪듉
        if (typeof WINDY_URL_MAPPING !== 'undefined' && WINDY_URL_MAPPING[zoneName]) {
            const windyBtn = document.createElement('button');
            windyBtn.className = 'windy-btn';
            windyBtn.innerHTML = '?? ?덈뵒';
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
        '?숉빐': document.getElementById('status-east-sea-list'),
        '?쒗빐': document.getElementById('status-west-sea-list'),
        '?⑦빐': document.getElementById('status-south-sea-list'),
        '?쒖＜': document.getElementById('status-jeju-sea-list')
    };

    const countBadges = {
        '?숉빐': document.getElementById('status-east-count'),
        '?쒗빐': document.getElementById('status-west-count'),
        '?⑦빐': document.getElementById('status-south-count'),
        '?쒖＜': document.getElementById('status-jeju-count')
    };

    const counts = { '?숉빐': 0, '?쒗빐': 0, '?⑦빐': 0, '?쒖＜': 0 };

    if (!containers['?숉빐']) return;

    // 而⑦뀒?대꼫 珥덇린??
    Object.values(containers).forEach(el => { if (el) el.innerHTML = ''; });

    if (typeof SEA_REGIONS === 'undefined' || typeof SUB_REGION_ZONES === 'undefined') return;

    // ?遺꾨쪟蹂꾨줈 泥섎━
    for (const [mainRegion, regionData] of Object.entries(SEA_REGIONS)) {
        const container = containers[mainRegion];
        if (!container) continue;

        const subRegionList = regionData.subRegions || [];

        // ?쒖＜??以묐텇瑜섍? ?섎굹?대?濡??쒕툕?ㅻ뜑 ?놁씠 諛붾줈 ?뚮뜑留?
        if (mainRegion === '?쒖＜' || subRegionList.length <= 1) {
            const zones = subRegionList.length > 0 ? (SUB_REGION_ZONES[subRegionList[0]] || []) : [];
            zones.forEach(zoneName => {
                if (typeof UserSettings !== 'undefined' && !UserSettings.isVisible(zoneName)) return;
                counts[mainRegion]++;
                container.appendChild(createStatusCard(zoneName));
            });
        } else {
            // 以묐텇瑜섎퀎 ?쒕툕 ?뱀뀡 ?앹꽦
            subRegionList.forEach(subRegion => {
                const zones = SUB_REGION_ZONES[subRegion] || [];
                if (zones.length === 0) return;

                // ?쒕툕 ?뱀뀡 而⑦뀒?대꼫
                const subSection = document.createElement('div');
                subSection.className = 'sub-region-section';
                subSection.style.marginBottom = '14px';

                // ?쒕툕 ?ㅻ뜑 (以묐텇瑜섎챸) - ?밸낫?꾪솴怨??숈씪???ㅽ???
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
                    <i class="fa-solid fa-chevron-right" style="font-size: 0.85rem; color: #4fc3f7; transition: transform 0.3s;"></i>
                    <span style="font-size: 1.0rem; font-weight: 700; color: #fff;">${subRegion}</span>
                    <span style="background: rgba(79, 195, 247, 0.3); padding: 4px 12px; border-radius: 12px; font-size: 0.85rem; font-weight: 600; color: #4fc3f7; margin-left: auto;">${zones.length}媛??댁뿭</span>
                `;

                // ?몃쾭 ?④낵
                subHeader.onmouseenter = () => {
                    subHeader.style.background = 'linear-gradient(135deg, rgba(40, 80, 140, 0.9), rgba(52, 102, 180, 0.7))';
                };
                subHeader.onmouseleave = () => {
                    subHeader.style.background = 'linear-gradient(135deg, rgba(30, 60, 114, 0.8), rgba(42, 82, 152, 0.6))';
                };

                // 紐⑸줉 而⑦뀒?대꼫 (湲곕낯: ?④?)
                const listContainer = document.createElement('div');
                listContainer.className = 'sub-region-list';
                listContainer.style.display = 'none';
                listContainer.style.paddingLeft = '12px';

                // ?좉? 湲곕뒫 (諛고???紐⑤뱶: ?섎굹留??대┝, ?щ씪?대뱶 ?좊땲硫붿씠??
                subHeader.onclick = () => {
                    const isCurrentlyHidden = listContainer.style.display === 'none';

                    // 媛숈? ?遺꾨쪟 ??紐⑤뱺 以묐텇瑜??꾩퐫?붿뼵 ?リ린 (?좊땲硫붿씠??
                    const parentSection = subSection.closest('.sea-section') || container;
                    parentSection.querySelectorAll('.sub-region-list').forEach(list => {
                        if (list !== listContainer && list.style.display !== 'none') {
                            slideUp(list);
                        }
                        const header = list.previousElementSibling;
                        if (header && list !== listContainer) {
                            const icon = header.querySelector('.fa-chevron-right');
                            if (icon) icon.style.transform = 'rotate(0deg)';
                        }
                    });

                    // ?대┃??寃껋씠 ?ロ??덉뿀?ㅻ㈃ ?닿린 (?좊땲硫붿씠??
                    if (isCurrentlyHidden) {
                        slideDown(listContainer);
                        const icon = subHeader.querySelector('.fa-chevron-right');
                        if (icon) icon.style.transform = 'rotate(90deg)';
                    } else {
                        slideUp(listContainer);
                        const icon = subHeader.querySelector('.fa-chevron-right');
                        if (icon) icon.style.transform = 'rotate(0deg)';
                    }
                };

                // 援ъ뿭 移대뱶??異붽?
                let visibleZoneCount = 0;
                zones.forEach(zoneName => {
                    if (typeof UserSettings !== 'undefined' && !UserSettings.isVisible(zoneName)) return;
                    counts[mainRegion]++;
                    visibleZoneCount++;
                    listContainer.appendChild(createStatusCard(zoneName));
                });

                // [Fix] ?쒖떆??援ъ뿭???섎굹???놁쑝硫??뱀뀡 ?먯껜瑜??뚮뜑留곹븯吏 ?딆쓬
                if (visibleZoneCount > 0) {
                    // 諭껋? ?낅뜲?댄듃 (?꾪꽣留곷맂 媛쒖닔 諛섏쁺)
                    const countSpan = subHeader.querySelector('span:last-child');
                    if (countSpan) countSpan.textContent = `${visibleZoneCount}媛??댁뿭`;

                    subSection.appendChild(subHeader);
                    subSection.appendChild(listContainer);
                    container.appendChild(subSection);
                }
            });
        }
    }

    // ?遺꾨쪟 諭껋? ?낅뜲?댄듃 諛??뱀뀡 ?④? 泥섎━
    for (const [region, count] of Object.entries(counts)) {
        if (countBadges[region]) {
            countBadges[region].textContent = `${count}媛??댁뿭`;
        }

        // [New] ?대떦 ?댁뿭???쒖떆??援ъ뿭???섎굹???놁쑝硫??遺꾨쪟 ?뱀뀡 ?먯껜瑜??④?
        // 而⑦뀒?대꼫 ID 留ㅽ븨: ?숉빐 -> status-east-sea-section
        const sectionIdMap = {
            '?숉빐': 'status-east-sea-section',
            '?쒗빐': 'status-west-sea-section',
            '?⑦빐': 'status-south-sea-section',
            '?쒖＜': 'status-jeju-sea-section'
        };

        const sectionId = sectionIdMap[region];
        if (sectionId) {
            const section = document.getElementById(sectionId);
            if (section) {
                if (count > 0) {
                    section.classList.remove('hidden');
                    section.style.display = ''; // ?먮옒 display ?띿꽦 蹂듭썝 (CSS ?대옒?ㅺ? ?곗꽑?쒖쐞 諛由?寃쎌슦 ?鍮?
                } else {
                    section.classList.add('hidden');
                    section.style.display = 'none'; // ?뺤떎?섍쾶 ?④?
                }
            }
        }
    }
}

// 媛쒕퀎 援ъ뿭 移대뱶 ?앹꽦 (湲곗긽 ?꾪솴?? - ?밸낫 ?꾪솴怨?100% ?쇱튂?섎룄濡?議곗젙
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

    // === ?ㅻ뜑 ?곸뿭: 援ъ뿭紐?+ 踰꾪듉??===
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
    `;

    // 援ъ뿭紐?
    const zoneNameEl = document.createElement('span');
    zoneNameEl.textContent = zoneName;
    zoneNameEl.style.cssText = `
        font-size: 0.9rem;
        font-weight: 600;
        color: #e0e0e0;
        flex-shrink: 0;
    `;
    header.appendChild(zoneNameEl);

    // 踰꾪듉 而⑦뀒?대꼫 (?ㅻⅨ履??뺣젹)
    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = `
        display: flex;
        gap: 6px;
        margin-left: auto;
        flex-shrink: 0;
    `;

    const isMappedZone = typeof ZONE_NAME_DISPLAY_MAP !== 'undefined' && ZONE_NAME_DISPLAY_MAP[zoneName];

    // 湲곗긽?덈낫 踰꾪듉
    if (!isMappedZone) {
        const forecastBtn = document.createElement('button');
        forecastBtn.textContent = '?截?湲곗긽?덈낫';
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

    // ?닿뎄蹂?湲곗긽?꾨쭩 踰꾪듉
    const zoneViewBtn = document.createElement('button');
    zoneViewBtn.textContent = '?뿺截??닿뎄蹂?湲곗긽?꾨쭩';
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

    // ?덈뵒 踰꾪듉
    if (typeof WINDY_URL_MAPPING !== 'undefined' && WINDY_URL_MAPPING[zoneName]) {
        const windyBtn = document.createElement('button');
        windyBtn.innerHTML = '<i class=\"fa-solid fa-wind\"></i> ?덈뵒';
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

    // === 遺???뺣낫 ?곸뿭 (??긽 ?쒖떆) ===
    const buoys = typeof BUOY_MAPPING !== 'undefined' ? BUOY_MAPPING[zoneName] : null;
    if (buoys && buoys.length > 0) {
        const buoySection = document.createElement('div');
        buoySection.style.cssText = `
            margin-top: 10px;
            padding-top: 10px;
            border-top: 1px solid rgba(255,255,255,0.08);
        `;

        // 遺???ㅻ뜑 + 踰꾪듉?ㅼ쓣 ??以꾩뿉
        const buoyHeader = document.createElement('div');
        buoyHeader.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        `;

        const buoyLabel = document.createElement('span');
        buoyLabel.innerHTML = `${BUOY_SVG_ICON} 愿痢〓???span style="color:#69f0ae;font-size:0.7rem;margin-left:4px">(${buoys.length})</span>`;
        buoyLabel.style.cssText = `
            font-size: 0.8rem;
            color: #8b949e;
            flex-shrink: 0;
        `;
        buoyHeader.appendChild(buoyLabel);

        // 遺??踰꾪듉??
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

                // ?대? ?쒖꽦?붾맂 踰꾪듉 ?대┃ ???リ린
                if (btn.classList.contains('active')) {
                    btn.classList.remove('active');
                    btn.style.backgroundColor = 'rgba(255,255,255,0.05)';
                    btn.style.color = '#ccc';
                    btn.style.borderColor = 'rgba(255,255,255,0.15)';
                    const infoArea = buoySection.querySelector('.buoy-info-area');
                    if (infoArea) infoArea.style.display = 'none';
                    return;
                }

                // ?ㅻⅨ 踰꾪듉 鍮꾪솢?깊솕
                buoyHeader.querySelectorAll('button').forEach(b => {
                    b.classList.remove('active');
                    b.style.backgroundColor = 'rgba(255,255,255,0.05)';
                    b.style.color = '#ccc';
                    b.style.borderColor = 'rgba(255,255,255,0.15)';
                });

                // ?꾩옱 踰꾪듉 ?쒖꽦??
                btn.classList.add('active');
                btn.style.backgroundColor = 'rgba(68, 138, 255, 0.3)';
                btn.style.color = '#448aff';
                btn.style.borderColor = '#448aff';

                // ?뺣낫 ?쒖떆 ?곸뿭 李얘린/?앹꽦
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

// 珥덇린 ?ㅽ뻾
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(renderMarineWeatherStatus, 500); // ?곗씠??濡쒕뱶 ?쒓컙 怨좊젮

    // 愿由ъ옄 ?몃━嫄?珥덇린??(15???대┃)
    // 愿由ъ옄 ?몃━嫄?珥덇린??(15???대┃) - LEGACY REMOVED
    // if (typeof initAdminTrigger === 'function') initAdminTrigger();

    // 怨듭??ы빆 諛??쒕쾭 ?곹깭 ?뺤씤
    if (typeof checkNoticeStatus === 'function') checkNoticeStatus();
});


// 利됱떆 ?ㅽ뻾 ?쒕룄


/**
 * ?덈뵒 ?앹뾽 ?リ린
 */
function closeWindyPopup() {
    const modal = document.getElementById('windy-modal');
    if (modal) {
        modal.style.opacity = '0';
        modal.style.transition = 'opacity 0.2s';
        setTimeout(() => modal.remove(), 200);
    }
}

// ?꾩뿭 ?⑥닔濡??깅줉
window.showWindyPopup = showWindyPopup;
window.closeWindyPopup = closeWindyPopup;

// ============================================================================
// ?숋툘 ?ъ슜???ㅼ젙 (User Settings) - 愿???댁뿭 ?꾪꽣留?
// ============================================================================

const UserSettings = {
    STORAGE_KEY: 'weatherAppSettings_v1',
    settings: {}, // { '援ъ뿭紐?: boolean } (true: ?쒖떆, false: 誘명몴異?

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

    // ?대떦 援ъ뿭???쒖떆 ??곸씤吏 ?뺤씤 (怨꾩링 援ъ“ ?뺤씤)
    isVisible(zoneName) {
        if (!zoneName) return true;

        // 1. ?遺꾨쪟 ?뺤씤
        const subRegion = getSubRegion(zoneName);
        const mainRegion = getMainRegion(subRegion);

        if (mainRegion && this.settings[mainRegion] === false) return false;

        // 2. 以묐텇瑜??뺤씤 (?쒖＜ ?쒖쇅)
        if (mainRegion !== '?쒖＜' && subRegion && this.settings[subRegion] === false) return false;

        // 3. ?뚮텇瑜??뺤씤
        if (this.settings[zoneName] === false) return false;

        return true;
    },

    // ?ㅼ젙 媛?媛?몄삤湲?(湲곕낯媛?true)
    get(key) {
        return this.settings[key] !== false;
    },

    // ?ㅼ젙 媛?蹂寃?
    set(key, value) {
        this.settings[key] = value;
    },

    reset() {
        this.settings = {};
        this.save();
    }
};

// 珥덇린???ㅽ뻾
UserSettings.init();

// ----------------------------------------------------------------------------
// ?ㅼ젙 紐⑤떖 愿???⑥닔
// ----------------------------------------------------------------------------

// [New] ?뚮┝ ?ㅼ젙 濡쒖쭅 (Notification Logic)
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

        // [異붽?] ?쒕쾭濡??ㅼ젙 利됱떆 ?숆린??(?ㅼ씠?곕툕??寃쎌슦)
        if (window.Capacitor && window.Capacitor.isNativePlatform()) {
            // window.subscribeUser ?⑥닔媛 ?좏겙怨??ㅼ젙???④퍡 蹂대깂
            if (typeof window.subscribeUser === 'function') {
                // ?좏겙? ?대??곸쑝濡??ㅼ떆 媛?몄삤嫄곕굹 ??λ맂 寃껋쓣 ?ъ슜 (?대? 釉뚮┸吏??援ы쁽??
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

    // [?뺤떎???대깽??諛붿씤??
    master.onclick = async (e) => {
        console.log('Push toggle clicked. Master checked:', e.target.checked);
        const willBeEnabled = e.target.checked;

        if (willBeEnabled) {
            // [Debug] ?⑥닔 議댁옱 ?뺤씤
            if (typeof window.checkPushPermission !== 'function') {
                console.error('Critical Error: checkPushPermission is not defined!');
                return;
            }

            const permission = await window.checkPushPermission();
            console.log('Permission result:', permission);

            if (permission === 'denied') {
                e.preventDefault();
                e.target.checked = false;

                if (confirm('?꾩옱 ?뚮┝ 沅뚰븳??嫄곗젅?섏뼱 ?덉뒿?덈떎.\n?몄떆 ?뚮┝??諛쏆쑝?쒕젮硫??대????ㅼ젙?먯꽌 ?뚮┝???덉슜??二쇱뀛???⑸땲??\n\n?ㅼ젙 ?붾㈃?쇰줈 ?대룞?섏떆寃좎뒿?덇퉴?')) {
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
        // ?뺤긽?곸씤 寃쎌슦 UI ?낅뜲?댄듃
        updateMasterState(willBeEnabled);

        // [異붽?] 利됱떆 ?ㅼ젙 ???諛??쒕쾭 ?숆린??
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

function openSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;

    renderSettingsList();
    initNotificationUI(); // [New] UI 珥덇린??
    modal.classList.remove('hidden');
}

function closeSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.add('hidden');
}

function saveSettingsAndClose() {
    UserSettings.save();
    saveNotificationUI(); // [New] ?뚮┝ ?ㅼ젙 ???
    if (window.FontSizeManager) FontSizeManager.save(); // [New] ?고듃 ?ш린 ???
    closeSettingsModal();

    // [New] ?쒕쾭???몄떆 援щ룆 ?뺣낫 ?낅뜲?댄듃 ?붿껌 (Zones 蹂寃?諛섏쁺)
    if (typeof window.subscribeUser === 'function') {
        console.log('?봽 Settings saved. Updating server subscription...');
        window.subscribeUser();
    }

    // ?붾㈃ 媛깆떊: ?밸낫 諛?湲곗긽?꾪솴
    renderApp();
    if (typeof renderMarineWeatherStatus === 'function') {
        renderMarineWeatherStatus();
    }
}

function resetSettings() {
    if (confirm('紐⑤뱺 ?ㅼ젙??珥덇린?뷀븯???꾩껜 ?댁뿭???쒖떆?섏떆寃좎뒿?덇퉴?')) {
        UserSettings.reset();
        openSettingsModal(); // UI 媛깆떊
    }
}

// ?ㅼ젙 紐⑸줉 UI ?앹꽦 (?곹깭 ?좎? 湲곕뒫 異붽?)
function renderSettingsList(expandedStates = null) {
    const container = document.getElementById('settings-list-container');
    if (!container) return;

    // ?꾩옱 ?대젮?덈뒗 ?꾩퐫?붿뼵 ?곹깭 ???(ID 湲곕컲)
    // expandedStates媛 ?꾨떖?섏? ?딆븯???뚮쭔 ?꾩옱 DOM?먯꽌 ?곹깭 ?섏쭛
    const currentExpanded = expandedStates || getExpandedAccordionIds(container);

    container.innerHTML = '';

    // ?遺꾨쪟 ?쒗쉶
    const mainRegions = ['?숉빐', '?쒗빐', '?⑦빐', '?쒖＜'];

    mainRegions.forEach(mainRegion => {
        const regionData = SEA_REGIONS[mainRegion];
        if (!regionData) return;

        const isMainVisible = UserSettings.get(mainRegion);
        const mainId = `accordion-main-${mainRegion}`; // ID ?앹꽦

        // 1. ?遺꾨쪟 ?꾩퐫?붿뼵 ?뱀뀡
        const section = document.createElement('div');
        section.className = 'setting-section';
        section.style.marginBottom = '15px';

        // [異붽?] ?먯떇 ?댁뿭?ㅼ쓽 ?꾩껜 ?듦퀎 怨꾩궛 (?遺꾨쪟??
        let mainActive = 0;
        let mainTotal = 0;
        regionData.subRegions.forEach(sub => {
            if (SUB_REGION_ZONES[sub]) {
                mainTotal += SUB_REGION_ZONES[sub].length;
                mainActive += SUB_REGION_ZONES[sub].filter(z => UserSettings.get(z)).length;
            }
        });
        // ?쒖＜??寃쎌슦 ?뚮텇瑜?吏곸젒 怨꾩궛
        if (mainRegion === '?쒖＜' && SUB_REGION_ZONES['?쒖＜?댁뿭']) {
            mainTotal = SUB_REGION_ZONES['?쒖＜?댁뿭'].length;
            mainActive = SUB_REGION_ZONES['?쒖＜?댁뿭'].filter(z => UserSettings.get(z)).length;
        }
        const mainBadgeHtml = mainTotal > 0 ? `<span style="margin-left:8px; font-size:0.8rem; color:${mainActive > 0 ? 'var(--accent-blue)' : '#64748b'}; font-weight:normal; background:rgba(0,0,0,0.2); padding:2px 8px; border-radius:10px;">(${mainActive}/${mainTotal})</span>` : '';

        // ?ㅻ뜑
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
        body.id = mainId; // ID 遺??

        // ?곹깭 蹂듭썝
        if (currentExpanded.has(mainId)) {
            body.classList.add('open');
            header.querySelector('.arrow').style.transform = 'rotate(90deg)';
        }

        // ?ㅻ뜑 ?대┃ ?대깽??
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

        // 2. ?섏쐞 ??ぉ ?앹꽦
        if (mainRegion === '?쒖＜') {
            const zones = SUB_REGION_ZONES['?쒖＜?댁뿭'] || [];
            zones.forEach(zone => {
                body.appendChild(createSettingItem(zone, mainRegion));
            });
        } else {
            const subRegions = regionData.subRegions;
            subRegions.forEach(subRegion => {
                const subZones = SUB_REGION_ZONES[subRegion] || [];
                const isSubVisible = UserSettings.get(subRegion);
                const subId = `accordion-sub-${subRegion}`; // ID ?앹꽦

                const subSection = document.createElement('div');
                subSection.style.marginBottom = '8px';

                // 以묐텇瑜??ㅻ뜑
                const subHeader = document.createElement('div');
                subHeader.className = `setting-accordion-header ${isSubVisible && isMainVisible ? '' : 'disabled-style'}`;
                subHeader.style.padding = '10px 14px';
                subHeader.style.background = 'rgba(255, 255, 255, 0.05)';

                // [?섏젙] ?遺꾨쪟媛 爰쇱졇?덉쑝硫?以묐텇瑜?鍮꾪솢?깊솕 ?ㅽ????곸슜
                if (!isMainVisible) {
                    subHeader.style.opacity = '0.4';
                    subHeader.style.pointerEvents = 'none';
                }

                // [異붽?] 諛곗? 怨꾩궛 (?좏깮???댁뿭 ??/ ?꾩껜 ?댁뿭 ??
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
                subBody.id = subId; // ID 遺??
                subBody.style.borderLeft = '1px dashed rgba(255,255,255,0.1)';

                // ?곹깭 蹂듭썝
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

// ?꾩옱 ?대젮?덈뒗 ?꾩퐫?붿뼵 ID ?섏쭛
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
    // 1. ?꾩옱 ??ぉ ?ㅼ젙
    UserSettings.set(key, isChecked);

    // 2. 怨꾩링 援ъ“???곕Ⅸ ?곕룞 (Cascading)

    // (A) ?쒕갑???곕룞: 遺紐?-> ?먯떇 (Parent -> Child)
    if (['?숉빐', '?쒗빐', '?⑦빐', '?쒖＜'].includes(key)) {
        const regionData = SEA_REGIONS[key];
        if (regionData && regionData.subRegions) {
            regionData.subRegions.forEach(sub => {
                UserSettings.set(sub, isChecked);
                if (SUB_REGION_ZONES[sub]) {
                    SUB_REGION_ZONES[sub].forEach(zone => UserSettings.set(zone, isChecked));
                }
            });
        }
        if (key === '?쒖＜' && SUB_REGION_ZONES['?쒖＜?댁뿭']) {
            SUB_REGION_ZONES['?쒖＜?댁뿭'].forEach(zone => UserSettings.set(zone, isChecked));
        }
    } else if (SUB_REGION_ZONES[key]) {
        SUB_REGION_ZONES[key].forEach(zone => UserSettings.set(zone, isChecked));
    }

    // (B) [異붽?] ??갑???곕룞: ?먯떇 -> 遺紐?(Child -> Parent ON)
    if (isChecked) {
        // [?뚮텇瑜?-> 以묐텇瑜?& ?遺꾨쪟]
        for (const [subName, zones] of Object.entries(SUB_REGION_ZONES)) {
            if (zones.includes(key)) {
                UserSettings.set(subName, true); // 以묐텇瑜?ON
                // 以묐텇瑜섏뿉???ㅼ떆 ?遺꾨쪟 李얘린
                for (const [mainName, data] of Object.entries(SEA_REGIONS)) {
                    if (data.subRegions.includes(subName)) {
                        UserSettings.set(mainName, true); // ?遺꾨쪟 ON
                    }
                }
                break;
            }
        }
        // [以묐텇瑜?-> ?遺꾨쪟]
        for (const [mainName, data] of Object.entries(SEA_REGIONS)) {
            if (data.subRegions.includes(key)) {
                UserSettings.set(mainName, true); // ?遺꾨쪟 ON
                break;
            }
        }
    }

    // 由ъ뒪??而⑦뀒?대꼫???ㅽ겕濡??꾩튂 ???
    const body = document.querySelector('#settings-modal .modal-body');
    const scrollPos = body ? body.scrollTop : 0;

    // **以묒슂**: ?꾩옱 ?곹깭瑜??섏쭛?????щ젋?붾쭅???꾨떖
    const container = document.getElementById('settings-list-container');
    const expandedStates = getExpandedAccordionIds(container);

    renderSettingsList(expandedStates);

    if (body) body.scrollTop = scrollPos;
}

// ?꾩뿭 ?몄텧
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.saveSettingsAndClose = saveSettingsAndClose;
window.resetSettings = resetSettings;
window.toggleSetting = toggleSetting;

// ============================================================
// ?뱧 ??二쇰? 諛붾떎 湲곗긽?꾨쭩 (GPS 湲곕컲)
// ============================================================

async function showMyLocationWeather() {
    const btn = document.getElementById('my-location-btn');
    if (!btn) return;

    // UI ?낅뜲?댄듃
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ?뺤씤 以?..';
    btn.disabled = true;

    if (!navigator.geolocation) {
        alert("??釉뚮씪?곗????꾩튂 ?뺣낫瑜?吏?먰븯吏 ?딆뒿?덈떎.");
        btn.innerHTML = originalText;
        btn.disabled = false;
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (position) => {
            try {
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;

                // 1. ?닿뎄(Sea Zone) ?먮퀎
                const checkResult = findSeaZone(lon, lat);

                if (checkResult) {
                    // ?댁긽?? ?대떦 ?닿뎄??湲곗긽?꾨쭩 ?쒖텧
                    if (window.showMarineZoneModal) {
                        // 紐⑤떖 ?リ린 踰꾪듉 ?깆씠 寃뱀튌 ???덉쑝誘濡?湲곗〈 紐⑤떖 ?뺣━
                        if (window.closeSeaZoneModal) window.closeSeaZoneModal();

                        // ?곗씠??議고쉶 諛?紐⑤떖 ?닿린
                        window.getMarineZoneData(checkResult.zoneId);
                    }
                } else {
                    // ?≪긽?? 媛??媛源뚯슫 ?댁븞 ?덈낫 援ъ뿭 李얘린
                    const nearestZone = findNearestZone(lat, lon);
                    if (nearestZone) {
                        if (window.showSeaForecastTable) {
                            showSeaForecastTable(nearestZone.name);
                        }
                    } else {
                        alert("媛??媛源뚯슫 ?덈낫 援ъ뿭??李얠쓣 ???놁뒿?덈떎.");
                    }
                }

            } catch (e) {
                // console.error("Loc logic error:", e);
                alert("?꾩튂 ?뺣낫瑜?泥섎━?섎뒗 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.");
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        },
        (error) => {
            // console.error("Geo error:", error);
            let msg = "?꾩튂 ?뺣낫瑜?媛?몄삱 ???놁뒿?덈떎.";
            if (error.code === 1) msg += "\n?꾩튂 ?뺣낫 ?쒓났???덉슜?댁＜?몄슂.";
            alert(msg);
            btn.innerHTML = originalText;
            btn.disabled = false;
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

// ?ы띁: GPS 醫뚰몴濡??닿뎄 ?뺣낫(??닿뎄, ?뚰빐援? 李얘린
function findSeaZone(lon, lat) {
    if (typeof gpsToPixel !== 'function' || typeof GRID_DATA === 'undefined' || typeof SEA_ZONES_DATA === 'undefined') {
        // console.warn('?꾩슂???곗씠?곌? 濡쒕뱶?섏? ?딆븯?듬땲??');
        return null;
    }

    const pixel = gpsToPixel(lon, lat); // gridCalibrationData.js

    // 1. 寃⑹옄(Grid) 李얘린
    const lonKeys = Object.keys(GRID_DATA.lon).map(Number).sort((a, b) => a - b);
    const latKeys = Object.keys(GRID_DATA.lat).map(Number).sort((a, b) => a - b);

    let lonKey = null, latKey = null; // 援ш컙 ?쒖옉 ??
    let lonNext = null, latNext = null; // 援ш컙 ????

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
            // ??닿뎄 李얠쓬. ?댁젣 ?뚰빐援?1~9) 怨꾩궛
            const x1 = GRID_DATA.lon[lonKey].val;
            const y1 = GRID_DATA.lat[latKey].val;

            // ?꾩껜 寃⑹옄 ?ш린 怨꾩궛
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

// ?ы띁: 媛??媛源뚯슫 ?≪긽 ?덈낫 援ъ뿭 李얘린
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

// ?ы띁: 嫄곕━ 怨꾩궛
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
// ?썱截??쒕쾭 ?먭? & 愿由ъ옄 怨듭? ?쒖뒪??
// ============================================================================

let adminTriggerCount = 0;
let adminTriggerTimer = null;

// 1. 愿由ъ옄 紐⑤뱶 吏꾩엯 ?몃━嫄?珥덇린??
// 1. 愿由ъ옄 紐⑤뱶 吏꾩엯 ?몃━嫄?珥덇린??
// function initAdminTrigger() REMOVED
/*
function initAdminTrigger() {
    // [??15???대┃ -> ?듯빀 濡쒓렇??紐⑤떖]

    // (1) ?쒗뭾?뺣낫 ??-> 怨듭? ?앹뾽 愿由?
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
                // ?듯빀 濡쒓렇??紐⑤떖 ?몄텧 (怨듭? 紐⑤뱶)
                if (typeof showUnifiedLoginModal === 'function') {
                    showUnifiedLoginModal('notice', '怨듭? ?앹뾽 愿由ъ옄 濡쒓렇??, 'fa-bell');
                } else {
                    alert("愿由ъ옄 紐⑤뱢 濡쒕뱶 以?..");
                }
            }
        });
    }

    // (2) 怨듭??ы빆 ??-> 寃뚯떆湲 愿由?
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
                // ?듯빀 濡쒓렇??紐⑤떖 ?몄텧 (?띾낫 紐⑤뱶)
                if (typeof showUnifiedLoginModal === 'function') {
                    showUnifiedLoginModal('promo', '寃뚯떆??愿由ъ옄 濡쒓렇??, 'fa-bullhorn');
                } else {
                    alert("愿由ъ옄 紐⑤뱢 濡쒕뱶 以?..");
                }
            }
        });
    }

    // (3) ?닿뎄湲곗긽 ??-> API 愿由?
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
                // ?듯빀 濡쒓렇??紐⑤떖 ?몄텧 (API 紐⑤뱶)
                if (typeof showUnifiedLoginModal === 'function') {
                    showUnifiedLoginModal('api', 'API 愿由ъ옄 濡쒓렇??, 'fa-server');
                } else {
                    alert("愿由ъ옄 紐⑤뱢 濡쒕뱶 以?..");
                }
            }
        });
    }
}
*/

// 2. ???ㅽ뻾 ??怨듭??ы빆 ?뺤씤 (?ㅽ봽?쇱씤 罹먯떛 湲곕뒫 異붽?)
async function checkNoticeStatus() {
    try {
        // ?쒕쾭 ?곌껐 ?뺤씤 (??꾩븘??3珥?
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(CONFIG.NOTICE_API_URL, {
            signal: controller.signal,
            headers: { 'Cache-Control': 'no-cache' } // 罹먯떆 諛⑹?
        });
        clearTimeout(timeoutId);

        if (!response.ok) throw new Error('Server Error');

        const noticeData = await response.json();

        // 1. 怨듭? ?쒖꽦???곹깭?쇰㈃
        if (noticeData.isActive) {
            // [New] ?대씪?댁뼵??痢?留뚮즺 ?쒓컙 ?뺤씤
            if (noticeData.expiresAt) {
                const now = new Date();
                const expDate = new Date(noticeData.expiresAt.replace(' ', 'T') + ':00');
                if (expDate <= now) {
                    // console.log('怨듭? 湲고븳 留뚮즺??', noticeData.expiresAt);
                    localStorage.removeItem('offline_notice_cache');
                    return;
                }
            }

            // [以묒슂] ?ㅽ봽?쇱씤 ?鍮? 濡쒖뺄 ?ㅽ넗由ъ???怨듭? ?댁슜 ???
            localStorage.setItem('offline_notice_cache', JSON.stringify(noticeData));

            // "?ㅼ떆 蹂댁? ?딄린" 泥댄겕 ?뺤씤
            const hiddenNoticeId = localStorage.getItem('hidden_notice_id');
            if (hiddenNoticeId !== String(noticeData.id)) {
                // ?ㅽ뵆?섏떆 ?붾㈃ 醫낅즺 ?湲?
                const checkSplash = setInterval(() => {
                    const splash = document.getElementById('splash-screen');
                    if (!splash || getComputedStyle(splash).display === 'none') {
                        clearInterval(checkSplash);
                        showNoticePopup(noticeData); // 怨듭? ?앹뾽 ?몄텧
                    }
                }, 500);
            }
        }
        // 2. 怨듭? 鍮꾪솢?깊솕 ?곹깭?쇰㈃
        else {
            // [以묒슂] ??λ맂 怨듭? ??젣 (?쒕쾭?먯꽌 ?대젮媛붿쑝誘濡?
            localStorage.removeItem('offline_notice_cache');
        }

    } catch (error) {
        // console.error('Connection Check Failed:', error);

        // 3. ?쒕쾭 ?곌껐 ?ㅽ뙣 ?? 罹먯떆??怨듭?媛 ?덈뒗吏 ?뺤씤
        const cachedNotice = localStorage.getItem('offline_notice_cache');

        if (cachedNotice) {
            try {
                const noticeData = JSON.parse(cachedNotice);
                // 罹먯떆??怨듭? ?쒖떆 (?ㅼ떆 蹂댁? ?딄린 泥댄겕 ?뺤씤)
                const hiddenNoticeId = localStorage.getItem('hidden_notice_id');
                if (hiddenNoticeId !== String(noticeData.id)) {
                    // ?ㅽ뵆?섏떆 ?붾㈃???앸궇 ?뚭퉴吏 ?湲????쒖떆
                    const checkSplash = setInterval(() => {
                        const splash = document.getElementById('splash-screen');
                        if (!splash || getComputedStyle(splash).display === 'none') {
                            clearInterval(checkSplash);
                            showNoticePopup(noticeData); // 怨듭? ?앹뾽 ?몄텧
                        }
                    }, 500);
                }
                return; // 罹먯떆 怨듭?瑜??꾩썱?쇰?濡??먭? ?앹뾽? ?ㅽ궢
            } catch (e) {
                // console.error('Cache parse error', e);
            }
        }

        // 4. 罹먯떆??怨듭????녿떎硫?湲곗〈 ?먮윭 泥섎━
        if (navigator.onLine) {
            showMaintenancePopup(); // ?쒕쾭 ?먭?/?ㅼ슫
        } else {
            showNetworkErrorPopup(); // ?ъ슜???명꽣???딄?
        }
    }
}

// 3. 愿由ъ옄 鍮꾨?踰덊샇 ?낅젰 紐⑤떖 (Legacy removed - using showUnifiedLoginModal)
// 3-1. 寃뚯떆湲 愿由?紐⑤떖 (Legacy removed - using showPromoManagementModal)

// 4. 怨듭??ы빆 ?앹뾽 ?묒꽦/愿由?紐⑤떖 (?쒗뭾?뺣낫 ??15???대┃ ??
async function showAdminNoticeModal() {
    // 怨듭? ?곗씠??媛?몄삤湲?
    let notices = { active: [], expired: [] };
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/notices');
        if (res.ok) notices = await res.json();
    } catch (e) {
        // console.error(e);
        // 湲곗〈 ?⑥씪 怨듭? ?명솚
        try {
            const res2 = await fetch(CONFIG.NOTICE_API_URL);
            if (res2.ok) {
                const old = await res2.json();
                if (old.isActive) notices.active = [old];
            }
        } catch (e2) { }
    }

    // ?쒓컙 ?쒕∼?ㅼ슫 ?듭뀡 ?앹꽦
    const hourOptions = Array.from({ length: 24 }, (_, i) =>
        `<option value="${i}">${String(i).padStart(2, '0')}??/option>`
    ).join('');
    const minuteOptions = Array.from({ length: 60 }, (_, i) =>
        `<option value="${i}">${String(i).padStart(2, '0')}遺?/option>`
    ).join('');

    // ?꾩옱 ?좎쭨 湲곕낯媛?
    const now = new Date();
    const defaultDate = now.toISOString().split('T')[0];

    const modalHtml = `
        <div class="notice-modal-overlay" id="admin-modal-overlay">
            <div class="notice-popup" style="background: #1f2937; width: 95%; max-width: 400px; max-height: 85vh; overflow-y: auto; border-radius: 10px;">
                <div class="notice-header" style="background: #4b5563; padding: 8px 12px; position: sticky; top: 0; z-index: 10;">
                    <span style="font-size: 0.9rem;">?뵒 怨듭? ?앹뾽 愿由?/span>
                    <button class="notice-close-btn" onclick="document.getElementById('admin-modal-overlay').remove()" style="padding: 2px 8px; font-size: 1rem;">횞</button>
                </div>
                <div class="notice-content" style="padding: 8px !important;">
                    
                    <!-- ?꾩옱 吏꾪뻾 以묒씤 怨듭??ы빆 -->
                    <div style="margin-bottom: 8px;">
                        <div style="background: #065f46; color: #a7f3d0; padding: 6px 8px; border-radius: 4px 4px 0 0; font-weight: 600; font-size: 0.8rem;">
                            <i class="fa-solid fa-bell"></i> ?꾩옱 吏꾪뻾 以묒씤 怨듭??ы빆
                        </div>
                        <div id="active-notices-list" style="background: #1e293b; border: 1px solid #334155; border-top: none; border-radius: 0 0 4px 4px;">
                            ${notices.active && notices.active.length > 0 ? notices.active.map(n => `
                                <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-bottom: 1px solid #334155;">
                                    <div style="flex: 1; min-width: 0;">
                                        <div style="font-size: 0.8rem; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${n.title || '?쒕ぉ ?놁쓬'}</div>
                                        <div style="font-size: 0.65rem; color: #64748b;">~ ${n.expiresAt || '湲고븳 ?놁쓬'}</div>
                                    </div>
                                    <div style="display: flex; gap: 3px; flex-shrink: 0;">
                                        <button onclick="editNotice(${n.id})" style="background: #3b82f6; color: white; border: none; padding: 3px 6px; border-radius: 3px; font-size: 0.65rem; cursor: pointer;">?섏젙</button>
                                        <button onclick="deleteNoticeById(${n.id})" style="background: #ef4444; color: white; border: none; padding: 3px 6px; border-radius: 3px; font-size: 0.65rem; cursor: pointer;">??젣</button>
                                    </div>
                                </div>
                            `).join('') : '<div style="padding: 8px; text-align: center; color: #64748b; font-size: 0.75rem;">吏꾪뻾 以묒씤 怨듭?媛 ?놁뒿?덈떎</div>'}
                        </div>
                    </div>

                    <!-- ?먮룞 醫낅즺??怨듭??ы빆 -->
                    <div style="margin-bottom: 8px;">
                        <div style="background: #44403c; color: #d6d3d1; padding: 6px 8px; border-radius: 4px 4px 0 0; font-weight: 600; font-size: 0.8rem;">
                            <i class="fa-solid fa-clock-rotate-left"></i> ?먮룞 醫낅즺??怨듭??ы빆
                        </div>
                        <div id="expired-notices-list" style="background: #1e293b; border: 1px solid #334155; border-top: none; border-radius: 0 0 4px 4px;">
                            ${notices.expired && notices.expired.length > 0 ? notices.expired.map(n => `
                                <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-bottom: 1px solid #334155;">
                                    <div style="flex: 1; min-width: 0;">
                                        <div style="font-size: 0.8rem; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${n.title || '?쒕ぉ ?놁쓬'}</div>
                                        <div style="font-size: 0.65rem; color: #64748b;">醫낅즺: ${n.expiresAt || '-'}</div>
                                    </div>
                                    <button onclick="reactivateNotice(${n.id})" style="background: #6366f1; color: white; border: none; padding: 3px 6px; border-radius: 3px; font-size: 0.65rem; cursor: pointer; flex-shrink: 0;">?щ벑濡?/button>
                                </div>
                            `).join('') : '<div style="padding: 8px; text-align: center; color: #64748b; font-size: 0.75rem;">醫낅즺??怨듭?媛 ?놁뒿?덈떎</div>'}
                        </div>
                    </div>

                    <!-- 怨듭??ы빆 ?묒꽦 -->
                    <div style="background: #1e293b; border: 1px solid #334155; border-radius: 4px; padding: 8px;">
                        <div style="font-weight: 600; font-size: 0.8rem; color: #e2e8f0; margin-bottom: 6px;">
                            <i class="fa-solid fa-pen"></i> 怨듭??ы빆 ?묒꽦
                        </div>
                        
                        <input type="hidden" id="notice-edit-id" value="">
                        
                        <div style="margin-bottom: 6px;">
                            <label style="display: block; font-size: 0.7rem; color: #94a3b8; margin-bottom: 2px;">寃뚯떆湲 ?쒕ぉ</label>
                            <input type="text" id="notice-title" style="width: 100%; padding: 6px 8px; background: #0f172a; border: 1px solid #334155; border-radius: 4px; color: #e2e8f0; font-size: 0.85rem; box-sizing: border-box;" placeholder="?? ?쒕쾭 ?먭? ?덈궡">
                        </div>
                        
                        <div style="margin-bottom: 6px;">
                            <label style="display: block; font-size: 0.7rem; color: #94a3b8; margin-bottom: 2px;">寃뚯떆湲 ?댁슜</label>
                            <textarea id="notice-content" style="width: 100%; height: 60px; padding: 6px 8px; background: #0f172a; border: 1px solid #334155; border-radius: 4px; color: #e2e8f0; font-size: 0.8rem; resize: none; box-sizing: border-box;" placeholder="?댁슜???낅젰?섏꽭??.."></textarea>
                        </div>
                        
                        <div style="margin-bottom: 8px;">
                            <label style="display: block; font-size: 0.7rem; color: #94a3b8; margin-bottom: 2px;">怨듭? 醫낅즺 湲고븳</label>
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
                            <i class="fa-solid fa-paper-plane"></i> 怨듭? ?깅줉
                        </button>
                    </div>
                    
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // ?꾩옱 ?쒓컙 + 1?쒓컙?쇰줈 湲곕낯媛??ㅼ젙
    const nextHour = new Date(now.getTime() + 60 * 60 * 1000);
    document.getElementById('notice-expire-hour').value = nextHour.getHours();
    document.getElementById('notice-expire-minute').value = 0;
}

// 5. 怨듭??ы빆 ???(POST)
window.saveNotice = async function () {
    const editId = document.getElementById('notice-edit-id').value;
    const title = document.getElementById('notice-title').value;
    const content = document.getElementById('notice-content').value;
    const expireDate = document.getElementById('notice-expire-date').value;
    const expireHour = document.getElementById('notice-expire-hour').value;
    const expireMinute = document.getElementById('notice-expire-minute').value;

    if (!title || !content) {
        alert("?쒕ぉ怨??댁슜??紐⑤몢 ?낅젰?댁＜?몄슂.");
        return;
    }

    if (!expireDate) {
        alert("怨듭? 醫낅즺 湲고븳???ㅼ젙?댁＜?몄슂.");
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

// 6. 怨듭??ы빆 ??젣 (ID濡?
window.deleteNoticeById = async function (id) {
    if (!confirm("??怨듭?瑜???젣?섏떆寃좎뒿?덇퉴?")) return;

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/notice/' + id, {
            method: 'DELETE'
        });
        if (res.ok) {
            alert("??젣?섏뿀?듬땲??");
            document.getElementById('admin-modal-overlay').remove();
            showAdminNoticeModal(); // ?덈줈怨좎묠
        } else {
            // 湲곗〈 諛⑹떇?쇰줈 ?대갚
            const payload = { isActive: false, id: id, title: "", content: "" };
            await requestNoticeUpdate(payload);
        }
    } catch (e) {
        alert("?ㅻ쪟: " + e.message);
    }
};

// 6-1. 怨듭? ?섏젙 紐⑤뱶
window.editNotice = async function (id) {
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/notices');
        if (!res.ok) throw new Error('API ?ㅻ쪟');
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

            // ?ㅽ겕濡ㅼ쓣 ?묒꽦 ?곸뿭?쇰줈
            document.querySelector('#admin-modal-overlay .notice-content').scrollTop = 9999;
        }
    } catch (e) {
        // console.error(e);
        alert("怨듭? ?뺣낫瑜?遺덈윭?????놁뒿?덈떎.");
    }
};

// 6-2. 醫낅즺??怨듭? ?щ벑濡?
window.reactivateNotice = async function (id) {
    await editNotice(id);
    // 湲고븳???꾩옱 ?쒓컙 + 1?쇰줈 ?ъ꽕??
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    document.getElementById('notice-expire-date').value = tomorrow.toISOString().split('T')[0];
    document.getElementById('notice-expire-hour').value = 23;
    document.getElementById('notice-expire-minute').value = 59;
};

// 湲곗〈 deleteNotice ?명솚
window.deleteNotice = async function () {
    if (!confirm("?꾩옱 寃뚯떆 以묒씤 怨듭?瑜??대━?쒓쿋?듬땲源?")) return;
    const payload = { isActive: false, id: Date.now(), title: "", content: "" };
    await requestNoticeUpdate(payload);
};

async function requestNoticeUpdate(payload) {
    try {
        // ?덈줈???ㅼ쨷 怨듭? API ?ъ슜
        let res = await fetch(CONFIG.API_BASE + '/api/notices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // ?ㅽ뙣 ??湲곗〈 ?⑥씪 怨듭? API濡??대갚
        if (!res.ok) {
            res = await fetch(CONFIG.NOTICE_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }

        if (res.ok) {
            alert("?곸슜?섏뿀?듬땲??");
            document.getElementById('admin-modal-overlay').remove();
            // 紐⑤떖 ?ㅼ떆 ?댁뼱??紐⑸줉 媛깆떊
            showAdminNoticeModal();
        } else {
            alert("?쒕쾭 ????ㅽ뙣");
        }
    } catch (e) {
        alert("?ㅻ쪟 諛쒖깮: " + e.message);
    }
}

// 7. ?쇰컲 ?ъ슜?먯슜 怨듭? ?앹뾽
function showNoticePopup(noticeData) {
    // ?대? ?앹뾽???덉쑝硫??쒓굅
    const existing = document.getElementById('main-notice-popup');
    if (existing) existing.remove();

    const isMaintenance = noticeData.title.includes('?먭?');
    const headerClass = isMaintenance ? 'maintenance' : '';

    const html = `
        <div class="notice-modal-overlay" id="main-notice-popup">
            <div class="notice-popup">
                <div class="notice-header ${headerClass}">
                    <span>?뱼 ${noticeData.title}</span>
                </div>
                <div class="notice-content">
                    ${noticeData.content}
                </div>
                <div class="notice-footer">
                    <label class="notice-checkbox-label">
                        <input type="checkbox" id="notice-dont-show"> ?ㅼ떆 蹂댁? ?딄린
                    </label>
                    <button class="notice-close-btn" onclick="closeNoticePopup(${noticeData.id})">?リ린</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
}

// 8. ?앹뾽 ?リ린 ("?ㅼ떆 蹂댁? ?딄린" 泥섎━)
window.closeNoticePopup = function (noticeId) {
    const checkbox = document.getElementById('notice-dont-show');
    if (checkbox && checkbox.checked) {
        localStorage.setItem('hidden_notice_id', String(noticeId));
    }
    const popup = document.getElementById('main-notice-popup');
    if (popup) popup.remove();
};

// 9. ?섎뱶肄붾뵫 ?앹뾽: ?쒕쾭 ?먭? 以?(?곌껐 遺덇?)
function showMaintenancePopup() {
    const html = `
        <div class="notice-modal-overlay" id="server-maintenance-popup" style="z-index:10000;">
            <div class="notice-popup">
                <div class="notice-header maintenance">
                    <span>?뵆 ?쒕쾭 ?곌껐 遺덇?</span>
                </div>
                <div class="notice-content" style="text-align: center;">
                    <i class="fa-solid fa-server fa-3x" style="color: #cbd5e1; margin-bottom: 15px;"></i>
                    <p>?꾩옱 ?쒕쾭? ?곌껐?????놁뒿?덈떎.</p>
                    <p style="font-size: 0.9rem; color: #94a3b8;">
                        ?쒕쾭(PC) ?꾩썝??爰쇱졇 ?덇굅??br>
                        ?먭? 以묒씪 ???덉뒿?덈떎.
                    </p>
                </div>
                <div class="notice-footer" style="justify-content: center;">
                    <button class="notice-close-btn" onclick="document.getElementById('server-maintenance-popup').remove(); location.reload();">
                        <i class="fa-solid fa-rotate-right"></i> ?ㅼ떆 ?쒕룄
                    </button>
                </div>
            </div>
        </div>
    `;
    // 以묐났 諛⑹?
    if (!document.getElementById('server-maintenance-popup')) {
        document.body.insertAdjacentHTML('beforeend', html);
    }
}

// 10. ?섎뱶肄붾뵫 ?앹뾽: ?ㅽ듃?뚰겕 ?ㅻ쪟
function showNetworkErrorPopup() {
    const html = `
        <div class="notice-modal-overlay" id="network-error-popup" style="z-index:10000;">
            <div class="notice-popup">
                <div class="notice-header error">
                    <span>?벛 ?ㅽ듃?뚰겕 ?ㅻ쪟</span>
                </div>
                <div class="notice-content" style="text-align: center;">
                    <i class="fa-solid fa-wifi fa-3x" style="color: #cbd5e1; margin-bottom: 15px;"></i>
                    <p>?명꽣???곌껐???딄꺼 ?덉뒿?덈떎.</p>
                    <p style="font-size: 0.9rem; color: #94a3b8;">
                        Wi-Fi ?먮뒗 ?곗씠???ㅼ젙??br>?뺤씤??二쇱꽭??
                    </p>
                </div>
                <div class="notice-footer" style="justify-content: center;">
                    <button class="notice-close-btn" onclick="document.getElementById('network-error-popup').remove(); location.reload();">
                        <i class="fa-solid fa-rotate-right"></i> ?ㅼ떆 ?쒕룄
                    </button>
                </div>
            </div>
        </div>
    `;
    if (!document.getElementById('network-error-popup')) {
        document.body.insertAdjacentHTML('beforeend', html);
    }
}

// ?꾩뿭 ?깅줉
window.showMyLocationWeather = showMyLocationWeather;

// ============================================================================
// [?좉퇋] ?띾낫?뺣낫 寃뚯떆??湲곕뒫
// ============================================================================

// ?꾩뿭 蹂??
let promoQuillEditor = null;
let currentEditingPromoId = null;
let currentAttachments = []; // [New] ?꾩옱 ?몄쭛 以묒씤 寃뚯떆湲??泥⑤??뚯씪 紐⑸줉

// [New] 泥⑤??뚯씪 紐⑸줉 ?뚮뜑留?
function renderAttachmentList() {
    const listEl = document.getElementById('promo-attachment-list');
    if (!listEl) return;

    if (currentAttachments.length === 0) {
        listEl.innerHTML = '<div style="text-align:center; color:#64748b; font-size:0.85rem; padding:10px;">泥⑤????뚯씪???놁뒿?덈떎</div>';
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

// [New] ?뚯씪 ?꾩씠肄?寃곗젙
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

// [New] ?뚯씪 ?ш린 ?щ㎎
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// [New] 泥⑤??뚯씪 ?쒓굅
window.removeAttachment = function (index) {
    currentAttachments.splice(index, 1);
    renderAttachmentList();
};

// [New] ?뚯씪 ?낅줈???몃뱾??
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
                alert('?뚯씪 ?낅줈???ㅽ뙣: ' + (data.error || '?????녿뒗 ?ㅻ쪟'));
            }
        } catch (e) {
            // console.error('?뚯씪 ?낅줈???ㅻ쪟:', e);
            alert('?뚯씪 ?낅줈??以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.');
        }
    }

    if (statusEl) statusEl.style.display = 'none';
    renderAttachmentList();
}

// 1. 寃뚯떆湲 紐⑸줉 遺덈윭?ㅺ린
async function loadPromoPosts() {
    const container = document.getElementById('promo-list');
    if (!container) return;

    // 濡쒕뵫 ?ㅽ뵾???쒖떆
    container.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 0; color: #94a3b8;">
            <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 2rem; color: #38bdf8; margin-bottom: 15px;"></i>
            <div style="font-size: 0.95rem;">寃뚯떆湲??遺덈윭?ㅻ뒗 以묒엯?덈떎...</div>
        </div>
    `;

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/promo');
        if (!res.ok) throw new Error('API ?ㅻ쪟');
        const posts = await res.json();
        updateNewBadges(posts); // [New] 諭껋? ?낅뜲?댄듃
        renderPromoPosts(posts);
    } catch (e) {
        // console.error('寃뚯떆湲 濡쒕뱶 ?ㅽ뙣:', e);
        container.innerHTML = `
            <div class="promo-empty">
                <i class="fa-solid fa-clipboard-list"></i>
                <p>寃뚯떆湲??遺덈윭?????놁뒿?덈떎.</p>
            </div>
        `;
    }
}

// 24?쒓컙 ?대궡 ??寃뚯떆湲 泥댄겕 諛?諭껋? ?쒖떆
function updateNewBadges(posts) {
    if (!posts || posts.length === 0) return;

    const now = new Date();
    const ONE_DAY = 24 * 60 * 60 * 1000; // 24?쒓컙 (ms)

    // 移댄뀒怨좊━蹂???湲 ?좊Т ?곹깭
    const hasNew = {
        'ALL': false,
        'NOTICE': false,
        'LEGAL': false,
        'PROMO': false
    };

    posts.forEach(post => {
        // ?좎쭨 ?뚯떛 (?ㅼ뼇???뺤떇??怨좊젮?섏뿬 ?덉쟾?섍쾶 泥섎━)
        // ?? "2026.01.01", "2026-01-01T...", etc.
        let postDateStr = post.createdAt;
        if (!postDateStr) return;

        // ??.)???섏씠??-)?쇰줈 蹂寃쏀븯???명솚???뺣낫
        postDateStr = postDateStr.replace(/\./g, '-');

        const postDate = new Date(postDateStr);

        // ?좏슚???좎쭨??寃쎌슦?먮쭔 怨꾩궛
        if (!isNaN(postDate.getTime())) {
            const diff = now - postDate;
            if (diff >= 0 && diff < ONE_DAY) { // 24?쒓컙 ?대궡 (誘몃옒 ?좎쭨 ?쒖쇅)
                hasNew['ALL'] = true; // ?꾩껜?먮뒗 ?섎굹?쇰룄 ?덉쑝硫??쒖떆
                if (hasNew.hasOwnProperty(post.category)) {
                    hasNew[post.category] = true;
                }
            }
        }
    });

    // 1. 硫붿씤 ??(怨듭??ы빆) 諭껋? ?낅뜲?댄듃
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

    // 2. 移댄뀒怨좊━ ?꾪꽣 踰꾪듉 諭껋? ?낅뜲?댄듃
    // ?쒖꽌: ?꾩껜(0), 怨듭??ы빆(1), 踰뺣쪧?뺣낫(2), ?띾낫?뺣낫(3)
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

// 2. 寃뚯떆湲 紐⑸줉 ?뚮뜑留?
let allPromoPosts = []; // ?꾩껜 寃뚯떆湲 ?먮낯 ?곗씠?????
let currentPromoCategory = 'ALL'; // ?꾩옱 ?좏깮??移댄뀒怨좊━
let currentSearchKeyword = ''; // ?꾩옱 寃?됱뼱
const PROMO_ITEMS_PER_PAGE = 10; // ?섏씠吏??寃뚯떆湲 ??
let currentPromoPage = 1; // ?꾩옱 ?섏씠吏

function renderPromoPosts(posts) {
    // ?뚮뜑留????꾩뿭 蹂???낅뜲?댄듃 (理쒖큹 濡쒕뱶 ??
    if (posts) allPromoPosts = posts;

    // ?꾪꽣留?諛?寃??濡쒖쭅 ?곸슜
    let displayPosts = allPromoPosts.filter(post => {
        // 1. 移댄뀒怨좊━ ?꾪꽣
        if (currentPromoCategory !== 'ALL' && post.category !== currentPromoCategory) return false;
        // 2. 寃???꾪꽣
        if (currentSearchKeyword) {
            const keyword = currentSearchKeyword.toLowerCase();
            return (post.title || '').toLowerCase().includes(keyword) ||
                (post.content || '').toLowerCase().includes(keyword);
        }
        return true;
    });

    // ?뺣젹 濡쒖쭅: 以묒슂(Pinned) 寃뚯떆湲 ?곷떒 怨좎젙, 洹??몃뒗 理쒖떊??
    displayPosts.sort((a, b) => {
        // ????Pinned?대㈃ ?좎쭨 鍮꾧탳
        if (a.isPinned && b.isPinned) return new Date(b.createdAt) - new Date(a.createdAt);
        // a留?Pinned?대㈃ a媛 癒쇱?
        if (a.isPinned) return -1;
        // b留?Pinned?대㈃ b媛 癒쇱?
        if (b.isPinned) return 1;
        // ?????꾨땲硫??좎쭨 鍮꾧탳 (理쒖떊??
        return new Date(b.createdAt) - new Date(a.createdAt);
    });

    // [異붽?] ?섏씠吏?ㅼ씠??濡쒖쭅 ?곸슜
    const totalItems = displayPosts.length;
    const totalPages = Math.ceil(totalItems / PROMO_ITEMS_PER_PAGE);

    // ?섏씠吏 踰붿쐞 蹂댁젙
    if (currentPromoPage < 1) currentPromoPage = 1;
    if (currentPromoPage > totalPages && totalPages > 0) currentPromoPage = totalPages;

    const startIndex = (currentPromoPage - 1) * PROMO_ITEMS_PER_PAGE;
    const endIndex = startIndex + PROMO_ITEMS_PER_PAGE;
    const paginatedPosts = displayPosts.slice(startIndex, endIndex);

    const container = document.getElementById('promo-list');
    const paginationContainer = document.getElementById('promo-pagination'); // [異붽?]
    if (!container) return;

    if (!paginatedPosts || paginatedPosts.length === 0) {
        container.innerHTML = `
            <div class="promo-empty">
                <i class="fa-solid fa-clipboard-list"></i>
                <p>議곌굔??留욌뒗 寃뚯떆湲???놁뒿?덈떎.</p>
            </div>
        `;
        if (paginationContainer) paginationContainer.innerHTML = ''; // 鍮?紐⑸줉?대㈃ ?섏씠吏?ㅼ씠???④?
        return;
    }

    // ?좎쭨 ?щ㎎ ?ы띁 (?⑥닔 ?대? ?대룞: "yyyy.MM.dd HH:mm" ?뺥깭)
    function formatPromoDate(dateStr) {
        if (!dateStr) return '';
        const match = dateStr.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(?ㅼ쟾|?ㅽ썑)\s*(\d{1,2}):(\d{2})/);
        if (match) {
            const [, year, month, day, ampm, hour, minute] = match;
            let h = parseInt(hour);
            if (ampm === '?ㅽ썑' && h !== 12) h += 12;
            if (ampm === '?ㅼ쟾' && h === 12) h = 0;
            return `${year}.${month.padStart(2, '0')}.${day.padStart(2, '0')} ${String(h).padStart(2, '0')}:${minute}`;
        }
        // 湲곕낯?곸쑝濡??좎쭨 ?뺤떇???대? "YYYY.MM.DD HH:mm"?쇰줈 ?ㅻ뒗吏 ?뺤씤
        // 留뚯빟 ?쒕쾭?먯꽌 "YYYY.MM.DD HH:mm"?쇰줈 以?ㅻ㈃ 洹몃?濡??ъ슜
        return dateStr;
    }

    // 移댄뀒怨좊━ 諭껋? ?앹꽦 ?ы띁
    function getCategoryBadge(category, isPinned) {
        // 以묒슂 怨듭???移댄뀒怨좊━ 臾닿? 遺됱??? or 移댄뀒怨좊━蹂? -> 湲고쉷: 移댄뀒怨좊━蹂??됱긽
        // [?꾩껜] ??씪 ?뚮쭔 諭껋? ?쒖떆?섍굅?? ??긽 ?쒖떆?섍굅??
        // 湲고쉷: "[?꾩껜] ??뿉?쒕쭔 ?섑??섎뒗 嫄곗?? ?대떦 ?뚭렇媛 寃뚯떆湲 ?쇱そ???꾩튂"

        if (currentPromoCategory !== 'ALL') return ''; // 媛쒕퀎 ??뿉?쒕뒗 ?쒖떆 X

        let badgeClass = 'promo-badge-gray';
        let badgeText = '?뚮┝';

        if (category === 'NOTICE') {
            badgeClass = 'promo-badge-red';
            badgeText = '怨듭?';
        } else if (category === 'LEGAL') {
            badgeClass = 'promo-badge-blue';
            badgeText = '踰뺣쪧';
        } else if (category === 'PROMO') {
            badgeClass = 'promo-badge-green';
            badgeText = '?띾낫';
        }

        return `<span class="promo-badge ${badgeClass}">${badgeText}</span>`;
    }

    const now = new Date();
    const ONE_DAY = 24 * 60 * 60 * 1000;

    container.innerHTML = paginatedPosts.map(post => {
        const isPinnedClass = post.isPinned ? 'pinned-post' : '';
        const badgeHtml = getCategoryBadge(post.category, post.isPinned);
        const pinIcon = post.isPinned ? '<i class="fa-solid fa-thumbtack" style="color:#ff5252; margin-right:4px;"></i>' : '';

        // [New] 24?쒓컙 ?대궡 ??湲 諭껋? (由ъ뒪?몄슜)
        let newBadgeHtml = '';
        if (post.createdAt) {
            let pDate = new Date(post.createdAt.replace(/\./g, '-'));
            if (!isNaN(pDate.getTime()) && (now - pDate) >= 0 && (now - pDate) < ONE_DAY) {
                newBadgeHtml = '<span class="new-badge" style="vertical-align: middle; margin-left: 6px;">N</span>';
            }
        }

        // 移댄뀒怨좊━ 誘몄????곗씠??蹂댁젙
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

    renderPagination(totalPages); // [異붽?] ?섏씠吏?ㅼ씠??踰꾪듉 ?뚮뜑留?
}

// [異붽?] ?섏씠吏?ㅼ씠??UI ?뚮뜑留??⑥닔
function renderPagination(totalPages) {
    const container = document.getElementById('promo-pagination');
    if (!container) return;

    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = '';

    // ?댁쟾 踰꾪듉
    if (currentPromoPage > 1) {
        html += `<button class="pagination-btn" onclick="changePromoPage(${currentPromoPage - 1})"><i class="fa-solid fa-chevron-left"></i></button>`;
    }

    // ?섏씠吏 踰덊샇 (理쒕? 5媛??쒖떆 ?덉떆: 1 2 3 4 5)
    // 媛꾨떒?섍쾶 援ы쁽: ?꾩껜 ??蹂댁뿬二쇰릺 ?덈Т 留롮쑝硫??ㅽ겕濡???(?ш린?쒕뒗 ?꾩껜 ?쒖떆?섎릺 ?ㅽ??쇰줈 議곗젙)
    // ?뱀? ?꾩옱 ?섏씠吏 二쇰?留??쒖떆?섎뒗 濡쒖쭅 異붽? 媛??
    for (let i = 1; i <= totalPages; i++) {
        if (i === currentPromoPage) {
            html += `<button class="pagination-btn active">${i}</button>`;
        } else {
            html += `<button class="pagination-btn" onclick="changePromoPage(${i})">${i}</button>`;
        }
    }

    // ?ㅼ쓬 踰꾪듉
    if (currentPromoPage < totalPages) {
        html += `<button class="pagination-btn" onclick="changePromoPage(${currentPromoPage + 1})"><i class="fa-solid fa-chevron-right"></i></button>`;
    }

    container.innerHTML = html;
}

// [異붽?] ?섏씠吏 蹂寃??몃뱾??
window.changePromoPage = function (page) {
    currentPromoPage = page;
    renderPromoPosts();
    // ?섏씠吏 ?대룞 ??紐⑸줉 ?곷떒?쇰줈 ?ㅽ겕濡ㅼ? ?좏깮 ?ы빆 (?꾩슂 ??援ы쁽)
    // document.getElementById('promo-list').scrollIntoView({ behavior: 'smooth' });
};

// 2-1. 移댄뀒怨좊━ ?꾪꽣留??⑥닔
window.filterPromo = function (category) {
    currentPromoCategory = category;
    currentPromoPage = 1; // [?섏젙] ?꾪꽣 蹂寃???1?섏씠吏濡?

    // ??UI ?낅뜲?댄듃
    document.querySelectorAll('.promo-tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    // ?꾩옱 ?대┃??踰꾪듉 李얠븘??active (?대깽???寃?????띿뒪??鍮꾧탳 ?깆쑝濡?李얠쓬)
    const btns = document.querySelectorAll('.promo-tab-btn');
    if (category === 'ALL') btns[0].classList.add('active');
    else if (category === 'NOTICE') btns[1].classList.add('active');
    else if (category === 'LEGAL') btns[2].classList.add('active');
    else if (category === 'PROMO') btns[3].classList.add('active');

    renderPromoPosts(); // ?щ젋?붾쭅
};

// 2-2. 寃???⑥닔
window.searchPromo = function () {
    const input = document.getElementById('promo-search-input');
    if (input) {
        currentSearchKeyword = input.value.trim();
        currentPromoPage = 1; // [?섏젙] 寃????1?섏씠吏濡?
        renderPromoPosts();
    }
}

// 2-1. 移댄뀒怨좊━ ?꾪꽣留??⑥닔
window.filterPromo = function (category) {
    currentPromoCategory = category;

    // ??UI ?낅뜲?댄듃
    document.querySelectorAll('.promo-tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    // ?꾩옱 ?대┃??踰꾪듉 李얠븘??active (?대깽???寃?????띿뒪??鍮꾧탳 ?깆쑝濡?李얠쓬)
    const btns = document.querySelectorAll('.promo-tab-btn');
    if (category === 'ALL') btns[0].classList.add('active');
    else if (category === 'NOTICE') btns[1].classList.add('active');
    else if (category === 'LEGAL') btns[2].classList.add('active');
    else if (category === 'PROMO') btns[3].classList.add('active');

    renderPromoPosts(); // ?щ젋?붾쭅
};

// 2-2. 寃???⑥닔
window.searchPromo = function () {
    const input = document.getElementById('promo-search-input');
    if (input) {
        currentSearchKeyword = input.value.trim();
        renderPromoPosts();
    }
}

// 3. 寃뚯떆湲 ?곸꽭 蹂닿린 ?닿린
window.openPromoDetail = async function (postId) {
    const modal = document.getElementById('promo-detail-modal');
    if (!modal) return;

    try {
        // [?섏젙] ?곸꽭 議고쉶 API ?몄텧 (議고쉶???먮룞 利앷?)
        const res = await fetch(CONFIG.API_BASE + '/api/promo/' + postId);
        if (!res.ok) {
            alert('寃뚯떆湲??遺덈윭?????놁뒿?덈떎.');
            return;
        }
        const post = await res.json();

        // 紐⑸줉??議고쉶?섎룄 ?낅뜲?댄듃?섍린 ?꾪빐 紐⑸줉 ?덈줈怨좎묠 (諛깃렇?쇱슫??
        loadPromoPosts();

        document.getElementById('promo-detail-title').textContent = post.title;
        document.getElementById('promo-detail-date').textContent = post.createdAt;
        document.getElementById('promo-detail-views').textContent = post.views || 0;

        const contentEl = document.getElementById('promo-detail-content');
        contentEl.innerHTML = post.content;

        // [New] 泥⑤??뚯씪 ?쒖떆 (?꾩슜 而⑦뀒?대꼫 ?ъ슜 諛?洹뱀냼???덉씠?꾩썐)
        const attachmentContainer = document.getElementById('promo-detail-attachments');
        if (attachmentContainer) {
            attachmentContainer.innerHTML = ''; // 珥덇린??
            if (post.attachments && post.attachments.length > 0) {
                const attachmentHtml = `
                    <div style="margin: 5px 15px 15px; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); max-width: 400px;">
                        <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 8px; display: flex; align-items: center; gap: 5px;">
                            <i class="fa-solid fa-paperclip"></i>
                            <span style="font-weight: 600;">泥⑤??뚯씪 (${post.attachments.length})</span>
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
            // ?대? 罹먯떆?섏뼱 ?꾨즺??寃쎌슦 ?⑥뒪
            if (img.complete) return;

            // 1. ?대?吏 ?④? 諛??щ챸???ㅼ젙 (?섏씠?쒖씤 以鍮?
            const originalDisplay = img.style.display || 'block'; // Quill ?대?吏??蹂댄넻 block
            img.style.display = 'none';
            img.style.opacity = '0';
            img.style.transition = 'opacity 0.6s ease-out';
            img.style.maxWidth = '100%'; // 紐⑤컮???붾㈃ ?섏묠 諛⑹?

            // 2. 濡쒕뵫 UI ?앹꽦
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
                <div style="font-size: 0.9rem; color: #a0aec0; font-weight: 500;">?대?吏瑜?遺덈윭?ㅻ뒗 以묒엯?덈떎...</div>
            `;

            // ?대?吏 ?욎뿉 ?쎌엯
            img.parentNode.insertBefore(loader, img);

            // 3. 濡쒕뱶 ?꾨즺 ?몃뱾??
            img.onload = () => {
                loader.remove();
                img.style.display = originalDisplay;
                // 由ы뵆濡쒖슦 ???섏씠?쒖씤
                requestAnimationFrame(() => {
                    img.style.opacity = '1';
                });
            };

            // 4. ?먮윭 ?몃뱾??
            img.onerror = () => {
                loader.innerHTML = `
                    <i class="fa-solid fa-triangle-exclamation" style="font-size: 2rem; color: #ef5350; margin-bottom: 10px;"></i>
                    <div style="color: #ef5350;">?대?吏瑜?遺덈윭?????놁뒿?덈떎.</div>
                `;
                // ?먮윭???대?吏???④릿 ?곹깭 ?좎?
            };
        });

        modal.classList.remove('hidden');
    } catch (e) {
        // console.error('?곸꽭 蹂닿린 ?ㅻ쪟:', e);
        alert('寃뚯떆湲??遺덈윭?????놁뒿?덈떎.');
    }
};

// 4. 寃뚯떆湲 ?곸꽭 蹂닿린 ?リ린 (YouTube ?곸긽 ?뺤? ?ы븿)
window.closePromoDetail = function () {
    const modal = document.getElementById('promo-detail-modal');
    if (modal) {
        // YouTube iframe ?뺤? (src 珥덇린?붾줈 ?곸긽 以묐떒)
        const iframes = modal.querySelectorAll('iframe');
        iframes.forEach(iframe => {
            const src = iframe.src;
            iframe.src = ''; // 癒쇱? 鍮꾩슦怨?
            iframe.src = src; // ?ㅼ떆 ?ㅼ젙 (?ъ깮 以묐떒??
        });
        modal.classList.add('hidden');
        // [New] 泥⑤??뚯씪 ?곸뿭 珥덇린??
        const attachmentContainer = document.getElementById('promo-detail-attachments');
        if (attachmentContainer) attachmentContainer.innerHTML = '';
    }
};

// 5. HTML ?댁뒪耳?댄봽 (XSS 諛⑹?)
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================================================
// [愿由ъ옄] ?띾낫 寃뚯떆??愿由?湲곕뒫
// ============================================================================
// Legacy openPromoAdminPanel removed. Using showPromoManagementModal instead.

// 8. ??湲 ?묒꽦 ?먮뵒???닿린
window.openPromoEditor = function (editData = null) {
    // 湲곗〈 紐⑤떖 ?リ린
    const adminModal = document.getElementById('admin-modal');
    if (adminModal) adminModal.classList.add('hidden');
    const promoMgmtModal = document.getElementById('promo-management-modal');
    if (promoMgmtModal) promoMgmtModal.remove();

    currentEditingPromoId = editData ? editData.id : null;

    // ?먮뵒??紐⑤떖 ?앹꽦
    let editorModal = document.getElementById('promo-editor-modal');
    if (!editorModal) {
        const html = `
            <div id="promo-editor-modal" class="modal">
                <div class="modal-content promo-editor-modal-content">
                    <div class="modal-header">
                        <h3 id="promo-editor-header-title"><i class="fa-solid fa-pen-to-square"></i> ??湲 ?묒꽦</h3>
                        <button class="modal-close" onclick="closePromoEditor()">&times;</button>
                    </div>
                    <div class="promo-editor-body">
                        <div style="display:flex; gap:10px; margin-bottom:15px;">
                            <select id="promo-editor-category" style="flex:1; padding:12px; background:#0f172a; border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff; font-size:1rem;">
                                <option value="NOTICE">?뱼 怨듭??ы빆</option>
                                <option value="LEGAL">?뽳툘 踰뺣쪧?뺣낫</option>
                                <option value="PROMO">?럦 ?띾낫?뺣낫</option>
                            </select>
                            <label style="display:flex; align-items:center; gap:8px; padding:0 15px; background:rgba(255,82,82,0.1); border:1px solid rgba(255,82,82,0.3); border-radius:8px; cursor:pointer;">
                                <input type="checkbox" id="promo-editor-pinned">
                                <span style="font-size:0.9rem; color:#ff8a80; font-weight:600;"><i class="fa-solid fa-thumbtack"></i> ?곷떒 怨좎젙</span>
                            </label>
                        </div>
                        <input type="text" id="promo-editor-title" class="promo-editor-title-input" placeholder="?쒕ぉ???낅젰?섏꽭??>
                        <div id="promo-quill-editor"></div>
                        <!-- ?대?吏 ?낅줈??吏꾪뻾瑜??쒖떆 -->
                        <div id="promo-upload-progress" style="display:none; margin-top:10px; background:rgba(255,255,255,0.1); border-radius:4px; overflow:hidden; position:relative; height:24px; border:1px solid rgba(255,255,255,0.2);">
                            <div id="promo-upload-bar" style="width:0%; height:100%; background:linear-gradient(90deg, #4caf50, #8bc34a); transition:width 0.1s linear;"></div>
                            <div id="promo-upload-text" style="position:absolute; top:0; left:0; width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-size:0.85rem; color:#fff; font-weight:600; text-shadow:0 1px 2px rgba(0,0,0,0.5);">0%</div>
                        </div>
                        <!-- [New] 泥⑤??뚯씪 ?곸뿭 -->
                        <div id="promo-attachment-section" style="margin-top:15px; padding:15px; background:rgba(0,0,0,0.2); border-radius:8px; border:1px dashed rgba(255,255,255,0.2);">
                            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
                                <span style="font-size:0.9rem; color:#94a3b8;"><i class="fa-solid fa-paperclip" style="margin-right:6px;"></i>泥⑤??뚯씪</span>
                                <label style="cursor:pointer; padding:6px 12px; background:rgba(79,195,247,0.2); border:1px solid rgba(79,195,247,0.4); border-radius:6px; font-size:0.8rem; color:#4fc3f7;">
                                    <i class="fa-solid fa-plus" style="margin-right:4px;"></i>?뚯씪 異붽?
                                    <input type="file" id="promo-file-input" style="display:none;" multiple accept=".xlsx,.xls,.hwp,.pdf,.doc,.docx,.ppt,.pptx,.zip">
                                </label>
                            </div>
                            <div id="promo-attachment-list" style="display:flex; flex-direction:column; gap:8px;">
                                <!-- 泥⑤????뚯씪 紐⑸줉???ш린???쒖떆??-->
                            </div>
                            <div id="promo-file-upload-status" style="display:none; margin-top:10px; padding:8px; background:rgba(255,255,255,0.05); border-radius:4px; font-size:0.85rem; color:#aaa; text-align:center;">
                                <i class="fa-solid fa-spinner fa-spin"></i> ?뚯씪 ?낅줈??以?..
                            </div>
                        </div>
                    </div>
                    <div class="promo-editor-footer">
                        <button class="promo-btn-cancel" onclick="closePromoEditor()">痍⑥냼</button>
                        <button class="promo-btn-save" onclick="savePromoPost()"><i class="fa-solid fa-check"></i> ???/button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);
        editorModal = document.getElementById('promo-editor-modal');
    }

    editorModal.classList.remove('hidden');

    // Quill ?먮뵒??珥덇린??(??踰덈쭔)
    if (!promoQuillEditor) {
        promoQuillEditor = new Quill('#promo-quill-editor', {
            theme: 'snow',
            placeholder: '?댁슜???낅젰?섏꽭??..',
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

        // ?대?吏 ?낅줈???몃뱾??(?쒕쾭濡??낅줈??
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

                // Progress Bar ?붿냼
                const progressContainer = document.getElementById('promo-upload-progress');
                const progressBar = document.getElementById('promo-upload-bar');
                const progressText = document.getElementById('promo-upload-text');

                progressContainer.style.display = 'block';
                progressBar.style.width = '0%';
                progressText.innerText = '以鍮?以?..';

                // XHR ?ъ슜 (吏꾪뻾瑜?異붿쟻)
                const xhr = new XMLHttpRequest();
                xhr.open('POST', CONFIG.API_BASE + '/api/upload', true);

                xhr.upload.onprogress = function (e) {
                    if (e.lengthComputable) {
                        const percentComplete = Math.floor((e.loaded / e.total) * 100);
                        progressBar.style.width = percentComplete + '%';
                        progressText.innerText = `?대?吏 ?낅줈??以? ${percentComplete}%`;
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
                        // console.error('?낅줈???ㅽ뙣:', xhr.statusText);
                        alert('?대?吏 ?낅줈?쒖뿉 ?ㅽ뙣?덉뒿?덈떎.');
                    }
                    // ?꾨즺 ???④? (?좎떆 ??
                    setTimeout(() => {
                        progressContainer.style.display = 'none';
                    }, 500);
                };

                xhr.onerror = function () {
                    // console.error('?낅줈???ㅽ듃?뚰겕 ?ㅻ쪟');
                    alert('?대?吏 ?낅줈??以??ㅽ듃?뚰겕 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.');
                    progressContainer.style.display = 'none';
                };

                xhr.send(formData);
            };
        });
    }

    // ?섏젙 紐⑤뱶?쇰㈃ 湲곗〈 ?곗씠??梨꾩슦湲?
    document.getElementById('promo-editor-header-title').innerHTML = editData
        ? '<i class="fa-solid fa-pen-to-square"></i> 湲 ?섏젙'
        : '<i class="fa-solid fa-pen-to-square"></i> ??湲 ?묒꽦';
    document.getElementById('promo-editor-title').value = editData ? editData.title : '';
    document.getElementById('promo-editor-category').value = editData ? (editData.category || 'PROMO') : 'PROMO';
    document.getElementById('promo-editor-pinned').checked = editData ? (editData.isPinned || false) : false;
    promoQuillEditor.root.innerHTML = editData ? editData.content : '';

    // [New] 泥⑤??뚯씪 珥덇린??
    currentAttachments = editData && editData.attachments ? [...editData.attachments] : [];
    renderAttachmentList();

    // [New] ?뚯씪 ?좏깮 ?대깽???몃뱾???깅줉
    const fileInput = document.getElementById('promo-file-input');
    if (fileInput) {
        fileInput.value = ''; // 珥덇린??
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
    currentEditingPromoId = null;
};

// 9. 寃뚯떆湲 ???
window.savePromoPost = async function () {
    const title = document.getElementById('promo-editor-title').value.trim();
    const content = promoQuillEditor.root.innerHTML;

    if (!title) {
        alert('?쒕ぉ???낅젰?댁＜?몄슂.');
        return;
    }
    if (!content || content === '<p><br></p>') {
        alert('?댁슜???낅젰?댁＜?몄슂.');
        return;
    }

    const category = document.getElementById('promo-editor-category').value;
    const isPinned = document.getElementById('promo-editor-pinned').checked;

    const postData = {
        title: title,
        content: content,
        category: category,
        isPinned: isPinned,
        attachments: currentAttachments // [New] 泥⑤??뚯씪 諛곗뿴
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
            alert(currentEditingPromoId ? '寃뚯떆湲???섏젙?섏뿀?듬땲??' : '寃뚯떆湲???깅줉?섏뿀?듬땲??');
            closePromoEditor();
            loadPromoPosts(); // 紐⑸줉 ?덈줈怨좎묠
            if (typeof loadPromoListForAdmin === 'function') loadPromoListForAdmin();
        } else {
            alert('????ㅽ뙣: ' + (result.error || '?????녿뒗 ?ㅻ쪟'));
        }
    } catch (e) {
        // console.error('????ㅻ쪟:', e);
        alert('?쒕쾭 ?ㅻ쪟濡???μ뿉 ?ㅽ뙣?덉뒿?덈떎.');
    }
};

// 10. 寃뚯떆湲 ?섏젙 (?먮뵒???닿린)
window.editPromoPost = async function (postId) {
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/promo');
        const posts = await res.json();
        const post = posts.find(p => String(p.id) === String(postId));
        if (post) {
            openPromoEditor(post);
        } else {
            alert('寃뚯떆湲??李얠쓣 ???놁뒿?덈떎.');
        }
    } catch (e) {
        // console.error('?섏젙 濡쒕뱶 ?ㅻ쪟:', e);
    }
};

// 11. 寃뚯떆湲 ??젣
window.deletePromoPost = async function (postId) {
    if (!confirm('?뺣쭚濡???寃뚯떆湲????젣?섏떆寃좎뒿?덇퉴?')) return;

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/promo/' + postId, {
            method: 'DELETE'
        });
        const result = await res.json();

        if (result.success) {
            alert('??젣?섏뿀?듬땲??');
            if (typeof loadPromoListForAdmin === 'function') loadPromoListForAdmin();
            loadPromoPosts();
        } else {
            alert('??젣 ?ㅽ뙣: ' + (result.error || '?????녿뒗 ?ㅻ쪟'));
        }
    } catch (e) {
        // console.error('??젣 ?ㅻ쪟:', e);
        alert('?쒕쾭 ?ㅻ쪟濡???젣???ㅽ뙣?덉뒿?덈떎.');
    }
};

// 12. ???꾪솚 ??寃뚯떆湲 濡쒕뱶 諛?愿由ъ옄 ?몄쬆 (15???대┃)
document.addEventListener('DOMContentLoaded', async function () {
    // [New] ?ㅼ씠?곕툕 ?ㅽ뵆?섏떆(=寃?뺥솕硫? 醫낅즺 -> ???ㅽ뵆?섏떆 ?쒖옉
    if (window.hideNativeSplash) {
        // ?쎄컙???쒕젅?대? 二쇱뼱 ?곗깋 ?뚮옒?쒕? ?꾩쟾??諛⑹????섎룄 ?덉쓬
        setTimeout(() => window.hideNativeSplash(), 100);
    }

    let typhoonTabClickCount = 0;
    let typhoonTabClickTimer = null;
    let promoTabClickCount = 0;
    let promoTabClickTimer = null;
    let zoneTabClickCount = 0;
    let zoneTabClickTimer = null;
    let weatherAlertTabClickCount = 0;
    let weatherAlertTabClickTimer = null;

    // ?ㅽ뵆?섏떆 ?붾㈃ ?몄텧 ?쒖옉 ?쒓컙
    const splashStartTime = Date.now();

    // [New] Capacitor ?ㅼ씠?곕툕 ?섍꼍 媛먯? (???묒냽 ???ㅽ뵆?섏떆 ?ㅽ궢)
    const isNativeApp = window.Capacitor && window.Capacitor.isNativePlatform();

    // ?ㅽ뵆?섏떆 ?붾㈃ ?쒓굅 ?⑥닔
    const hideSplash = () => {
        const splash = document.getElementById('splash-screen');
        if (splash) {
            // ????紐⑤몢 ?먯뿰?ㅻ윭???섏씠???꾩썐 ?곸슜
            splash.classList.add('fade-out');
            setTimeout(() => {
                splash.remove();
                document.body.classList.remove('loading');
            }, 800); // splash.css??transition ?쒓컙(0.8s)怨??쇱튂
        }
    };

    // 1. ?곗씠??濡쒕뵫 ?湲?
    try {
        await fetchAllData();
    } catch (e) {
        // console.error('Initial data fetch failed:', e);
    }

    // 2. ?ㅽ뵆?섏떆 醫낅즺 ??대컢 寃곗젙
    // [?섏젙] ?깆뿉?쒕룄 ???ㅽ뵆?섏떆瑜?蹂댁뿬以?(寃?뺥솕硫?-> ???ㅽ뵆?섏떆 -> 硫붿씤)
    // ?ㅼ씠?곕툕 ?ㅽ뵆?섏떆??0珥?寃??濡?吏?섍?怨? ???ㅽ뵆?섏떆媛 2珥덇컙 ?섏샂
    const minSplashTime = 2000;
    const elapsedTime = Date.now() - splashStartTime;
    const delay = Math.max(0, minSplashTime - elapsedTime);

    setTimeout(hideSplash, delay);

    // [New] ?몄떆 ?뚮┝ ?뚮씪誘명꽣 ?뺤씤 諛??앹뾽 ?쒖떆
    checkForPushPopup();

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            // ?띾낫?뺣낫 ??- 寃뚯떆湲 濡쒕뱶
            if (this.dataset.target === 'promo-section') {
                setTimeout(() => loadPromoPosts(), 100);
            }

            // === 湲곗긽?뺣낫 ??15???대┃ ???밸낫 ?뚮┝ 愿由?紐⑤떖 ===
            if (this.dataset.target === 'weather-alert-section') {
                weatherAlertTabClickCount++;
                clearTimeout(weatherAlertTabClickTimer);
                weatherAlertTabClickTimer = setTimeout(() => { weatherAlertTabClickCount = 0; }, 3000);

                if (weatherAlertTabClickCount >= 15) {
                    weatherAlertTabClickCount = 0;
                    showUnifiedLoginModal('alert', '?밸낫 ?뚮┝ 愿由ъ옄 ?몄쬆', 'fa-tower-broadcast');
                }
            }

            // === ?닿뎄湲곗긽 ??15???대┃ ??API 愿由?紐⑤떖 ===
            if (this.dataset.target === 'sea-zone-section') {
                zoneTabClickCount++;
                clearTimeout(zoneTabClickTimer);
                zoneTabClickTimer = setTimeout(() => { zoneTabClickCount = 0; }, 3000);

                if (zoneTabClickCount >= 15) {
                    zoneTabClickCount = 0;
                    showUnifiedLoginModal('api', 'API 愿由ъ옄 ?몄쬆', 'fa-server');
                }
            }

            // === ?쒗뭾?뺣낫 ??15???대┃ ??怨듭? ?앹뾽 愿由?紐⑤떖 ===
            if (this.dataset.target === 'typhoon-section') {
                typhoonTabClickCount++;
                clearTimeout(typhoonTabClickTimer);
                typhoonTabClickTimer = setTimeout(() => { typhoonTabClickCount = 0; }, 3000);

                if (typhoonTabClickCount >= 15) {
                    typhoonTabClickCount = 0;
                    showUnifiedLoginModal('notice', '怨듭? ?앹뾽 愿由ъ옄 ?몄쬆', 'fa-bell');
                }
            }

            // === 怨듭??ы빆 ??15???대┃ ??寃뚯떆湲 愿由?紐⑤떖 ===
            if (this.dataset.target === 'promo-section') {
                promoTabClickCount++;
                clearTimeout(promoTabClickTimer);
                promoTabClickTimer = setTimeout(() => { promoTabClickCount = 0; }, 3000);

                if (promoTabClickCount >= 15) {
                    promoTabClickCount = 0;
                    showUnifiedLoginModal('promo', '寃뚯떆湲 愿由ъ옄 ?몄쬆', 'fa-bullhorn');
                }
            }
        });
    });
});

// ============================================================================
// [?듯빀 愿由ъ옄 ?쒖뒪?? Unified Admin System
// ============================================================================

const adminAuthenticated = {
    api: false,
    notice: false,
    promo: false,
    alert: false
};

// 1. ?듯빀 濡쒓렇??紐⑤떖 (Mode: 'api' | 'notice' | 'promo')
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
            <input type="password" id="unified-admin-password" placeholder="愿由ъ옄 鍮꾨?踰덊샇" 
                   style="width:100%;padding:12px;border:1px solid rgba(255,255,255,0.1);border-radius:8px;background:rgba(0,0,0,0.3);color:#fff;font-size:1rem;box-sizing:border-box;margin-bottom:15px;outline:none;text-align:center;">
            <div style="display:flex;gap:10px;">
                <button onclick="document.getElementById('unified-admin-login-modal').remove();" 
                        style="flex:1;padding:10px;background:rgba(255,255,255,0.05);border:none;border-radius:6px;color:#aaa;cursor:pointer;transition:background 0.2s;">痍⑥냼</button>
                <button onclick="verifyUnifiedAdminPassword('${mode}');" 
                        style="flex:1;padding:10px;background:linear-gradient(135deg,${iconColor},${iconColor}cc);border:none;border-radius:6px;color:#1a1f2e;font-weight:600;cursor:pointer;box-shadow:0 4px 12px ${iconColor}33;">?뺤씤</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // ?뷀꽣??吏??
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
        adminAuthenticated[mode] = true;
        document.getElementById('unified-admin-login-modal').remove();

        if (mode === 'api') {
            showApiManagementModal();
        } else if (mode === 'notice') {
            showNoticeManagementModal();
        } else if (mode === 'promo') {
            showPromoManagementModal();
        } else if (mode === 'alert') {
            showAlertManagementModal();
        }
    } else {
        alert('鍮꾨?踰덊샇媛 ?쇱튂?섏? ?딆뒿?덈떎.');
        input.value = '';
        input.focus();
    }
};

// 2. 愿由?紐⑤떖 援ы쁽泥대뱾

// (A) 怨듭? ?앹뾽 愿由?
window.showNoticeManagementModal = async function () {
    if (!adminAuthenticated.notice) return;

    // 怨듭? ?곗씠??濡쒕뱶
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

    // ?쒓컙 ?듭뀡
    const hourOptions = Array.from({ length: 24 }, (_, i) => `<option value="${i}">${String(i).padStart(2, '0')}??/option>`).join('');
    const minuteOptions = Array.from({ length: 60 }, (_, i) => `<option value="${i}">${String(i).padStart(2, '0')}遺?/option>`).join('');
    const now = new Date();
    const defaultDate = now.toISOString().split('T')[0];
    const nextHour = new Date(now.getTime() + 60 * 60 * 1000);

    modal.innerHTML = `
        <div style="background:linear-gradient(135deg,#1a1f2e,#252b3b);border-radius:16px;max-width:480px;width:95%;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
            <div style="background:linear-gradient(135deg,#ffd54f,#ffb300);padding:16px 20px;border-radius:16px 16px 0 0;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10;">
                <h3 style="margin:0;color:#1a1f2e;font-size:1.1rem;display:flex;align-items:center;gap:10px;">
                    <i class="fa-solid fa-bell"></i> 怨듭? ?앹뾽 愿由?
                </h3>
                <button onclick="document.getElementById('notice-management-modal').remove();" 
                        style="background:rgba(0,0,0,0.2);border:none;color:#1a1f2e;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:1.2rem;">횞</button>
            </div>
            
            <div style="padding:16px;" id="notice-management-content">
                
                <!-- ?꾩옱 吏꾪뻾 以묒씤 怨듭??ы빆 -->
                <div style="margin-bottom: 20px;">
                    <div style="background: rgba(6, 95, 70, 0.5); color: #a7f3d0; padding: 8px 12px; border-radius: 8px 8px 0 0; font-weight: 600; font-size: 0.9rem; border: 1px solid rgba(167, 243, 208, 0.2); border-bottom: none;">
                        <i class="fa-solid fa-circle-check" style="margin-right:6px;"></i> ?꾩옱 吏꾪뻾 以묒씤 怨듭?
                    </div>
                    <div id="active-notices-list" style="background: rgba(30, 41, 59, 0.6); border: 1px solid rgba(167, 243, 208, 0.2); border-radius: 0 0 8px 8px; max-height: 150px; overflow-y: auto;">
                        ${notices.active && notices.active.length > 0 ? notices.active.map(n => `
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                                <div style="flex: 1; min-width: 0; padding-right: 10px;">
                                    <div style="font-size: 0.9rem; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px;">${n.title || '?쒕ぉ ?놁쓬'}</div>
                                    <div style="font-size: 0.75rem; color: #94a3b8;"><i class="fa-regular fa-clock"></i> ~ ${n.expiresAt || '湲고븳 ?놁쓬'}</div>
                                </div>
                                <div style="display: flex; gap: 6px; flex-shrink: 0;">
                                    <button onclick="editNotice(${n.id})" style="background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4); padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; cursor: pointer;">?섏젙</button>
                                    <button onclick="deleteNoticeById(${n.id})" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; cursor: pointer;">??젣</button>
                                </div>
                            </div>
                        `).join('') : '<div style="padding: 16px; text-align: center; color: #64748b; font-size: 0.85rem;">吏꾪뻾 以묒씤 怨듭?媛 ?놁뒿?덈떎</div>'}
                    </div>
                </div>

                <!-- 醫낅즺??怨듭??ы빆 -->
                <div style="margin-bottom: 20px;">
                    <div style="background: rgba(68, 64, 60, 0.5); color: #d6d3d1; padding: 8px 12px; border-radius: 8px 8px 0 0; font-weight: 600; font-size: 0.9rem; border: 1px solid rgba(214, 211, 209, 0.2); border-bottom: none;">
                        <i class="fa-solid fa-clock-rotate-left" style="margin-right:6px;"></i> 醫낅즺??怨듭?
                    </div>
                    <div id="expired-notices-list" style="background: rgba(30, 41, 59, 0.6); border: 1px solid rgba(214, 211, 209, 0.2); border-radius: 0 0 8px 8px; max-height: 150px; overflow-y: auto;">
                        ${notices.expired && notices.expired.length > 0 ? notices.expired.map(n => `
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                                <div style="flex: 1; min-width: 0; padding-right: 10px;">
                                    <div style="font-size: 0.9rem; color: #cbd5e1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px;">${n.title || '?쒕ぉ ?놁쓬'}</div>
                                    <div style="font-size: 0.75rem; color: #64748b;">醫낅즺: ${n.expiresAt || '-'}</div>
                                </div>
                                <button onclick="reactivateNotice(${n.id})" style="background: rgba(99, 102, 241, 0.2); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.4); padding: 4px 10px; border-radius: 6px; font-size: 0.75rem; cursor: pointer; flex-shrink: 0;">?щ벑濡?/button>
                            </div>
                        `).join('') : '<div style="padding: 16px; text-align: center; color: #64748b; font-size: 0.85rem;">醫낅즺??怨듭?媛 ?놁뒿?덈떎</div>'}
                    </div>
                </div>

                <!-- ?묒꽦 ??-->
                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 16px;">
                    <div style="font-weight: 600; font-size: 0.95rem; color: #e2e8f0; margin-bottom: 12px; display:flex; align-items:center; gap:8px;">
                        <i class="fa-solid fa-pen-nib" style="color:#ffd54f;"></i> ??怨듭? ?묒꽦 / ?섏젙
                    </div>
                    
                    <input type="hidden" id="notice-edit-id" value="">
                    
                    <div style="margin-bottom: 12px;">
                        <label style="display: block; font-size: 0.8rem; color: #94a3b8; margin-bottom: 6px;">?쒕ぉ</label>
                        <input type="text" id="notice-title" style="width: 100%; padding: 10px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff; font-size: 0.95rem; box-sizing: border-box;" placeholder="?? ?쒕쾭 ?먭? ?덈궡">
                    </div>
                    
                    <div style="margin-bottom: 12px;">
                        <label style="display: block; font-size: 0.8rem; color: #94a3b8; margin-bottom: 6px;">?댁슜</label>
                        <textarea id="notice-content" style="width: 100%; height: 80px; padding: 10px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff; font-size: 0.9rem; resize: none; box-sizing: border-box;" placeholder="?댁슜???낅젰?섏꽭??.."></textarea>
                    </div>
                    
                    <div style="margin-bottom: 16px;">
                        <label style="display: block; font-size: 0.8rem; color: #94a3b8; margin-bottom: 6px;">醫낅즺 ?쇱떆</label>
                        <div style="display: flex; gap: 8px;">
                            <input type="date" id="notice-expire-date" value="${defaultDate}" style="flex: 2; padding: 8px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff;">
                            <select id="notice-expire-hour" style="flex: 1; padding: 8px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff;">${hourOptions}</select>
                            <select id="notice-expire-minute" style="flex: 1; padding: 8px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff;">${minuteOptions}</select>
                        </div>
                    </div>
                    
                    <button onclick="saveNotice()" style="width: 100%; padding: 12px; background: linear-gradient(135deg, #ffd54f, #ffb300); color: #1a1e2e; border: none; border-radius: 8px; font-weight: 600; font-size: 0.95rem; cursor: pointer; transition: transform 0.2s;">
                        <i class="fa-solid fa-paper-plane" style="margin-right:6px;"></i> 怨듭? ?깅줉?섍린
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // 湲곕낯 ?쒓컙 ?ㅼ젙
    document.getElementById('notice-expire-hour').value = nextHour.getHours();
    document.getElementById('notice-expire-minute').value = 0;
};

// (B) 寃뚯떆??愿由?- ?ㅻ젋吏 ?뚮쭏 紐⑤떖 (?쇱そ 紐⑸줉 ?앹뾽)
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
                    <i class="fa-solid fa-bullhorn"></i> 寃뚯떆??愿由?
                </h3>
                <button onclick="document.getElementById('promo-management-modal').remove();" 
                        style="background:rgba(255,255,255,0.2);border:none;color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:1.2rem;">횞</button>
            </div>
            <div style="padding:16px;" id="promo-management-content">
                <div style="text-align:center;padding:30px;color:#aaa;">
                    <i class="fa-solid fa-spinner fa-spin fa-2x"></i>
                    <p style="margin-top:10px;">寃뚯떆湲 紐⑸줉??遺덈윭?ㅻ뒗 以?..</p>
                </div>
            </div>
            <div style="padding:12px 16px;background:rgba(0,0,0,0.2);border-radius:0 0 16px 16px;text-align:center;">
                <button onclick="openPromoEditor();" 
                        style="padding:10px 20px;background:linear-gradient(135deg,#ff7043,#e64a19);border:none;border-radius:8px;color:#fff;font-weight:600;cursor:pointer;font-size:0.9rem;">
                    <i class="fa-solid fa-plus" style="margin-right:6px;"></i>??寃뚯떆湲 ?묒꽦
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
                    <p style="margin-top:10px;">?깅줉??寃뚯떆湲???놁뒿?덈떎.</p>
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
                        <div style="color:#fff;font-weight:600;font-size:0.95rem;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${post.title || '?쒕ぉ ?놁쓬'}</div>
                        <span style="color:#888;font-size:0.75rem;margin-left:10px;">${date}</span>
                    </div>
                    <div style="display:flex;gap:8px;justify-content:flex-end;">
                        <button onclick="editPromoPost(${post.id}); document.getElementById('promo-management-modal').remove();" 
                                style="background:rgba(79,195,247,0.15);border:1px solid rgba(79,195,247,0.3);color:#4fc3f7;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:0.75rem;">
                            <i class="fa-solid fa-edit"></i> ?섏젙
                        </button>
                        <button onclick="deletePromoPostFromAdmin(${post.id});" 
                                style="background:rgba(244,67,54,0.15);border:1px solid rgba(244,67,54,0.3);color:#f44336;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:0.75rem;">
                            <i class="fa-solid fa-trash"></i> ??젣
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
                <p style="margin-top:10px;">寃뚯떆湲 紐⑸줉??遺덈윭?????놁뒿?덈떎.</p>
            </div>
        `;
    }
}

async function deletePromoPostFromAdmin(postId) {
    if (!confirm('?뺣쭚濡???寃뚯떆湲????젣?섏떆寃좎뒿?덇퉴?')) return;

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/promo/' + postId, { method: 'DELETE' });
        const result = await res.json();
        if (result.success) {
            loadPromoListForAdmin();
            loadPromoPosts();
        } else {
            alert('??젣 ?ㅽ뙣');
        }
    } catch (e) {
        alert('??젣 以??ㅻ쪟 諛쒖깮: ' + e.message);
    }
}

// ?ы띁: 怨듭? ?섏젙 紐⑤뱶
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
        // console.error('?섏젙 ?곗씠??濡쒕뱶 ?ㅽ뙣:', e);
    }
};

window.reactivateNotice = function (id) {
    editNotice(id);
};

// (異붽?) 怨듭? ?????젣 ?⑥닔
window.saveNotice = async function () {
    const editId = document.getElementById('notice-edit-id').value;
    const title = document.getElementById('notice-title').value;
    const content = document.getElementById('notice-content').value;
    const expireDate = document.getElementById('notice-expire-date').value;
    const expireHour = document.getElementById('notice-expire-hour').value;
    const expireMinute = document.getElementById('notice-expire-minute').value;

    if (!title || !content) {
        alert("?쒕ぉ怨??댁슜??紐⑤몢 ?낅젰?댁＜?몄슂.");
        return;
    }

    if (!expireDate) {
        alert("怨듭? 醫낅즺 湲고븳???ㅼ젙?댁＜?몄슂.");
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
            alert('怨듭?媛 ??λ릺?덉뒿?덈떎.');
            document.getElementById('notice-management-modal').remove();
            showNoticeManagementModal(); // ?덈줈怨좎묠
        } else {
            alert('????ㅽ뙣');
        }
    } catch (e) {
        alert('?ㅻ쪟 諛쒖깮: ' + e.message);
    }
};

window.deleteNoticeById = async function (id) {
    if (!confirm("??怨듭?瑜???젣?섏떆寃좎뒿?덇퉴?")) return;

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/notice/' + id, { method: 'DELETE' });
        if (res.ok) {
            alert("??젣?섏뿀?듬땲??");
            document.getElementById('notice-management-modal').remove();
            showNoticeManagementModal();
        } else {
            alert("??젣 ?ㅽ뙣");
        }
    } catch (e) {
        alert("?ㅻ쪟: " + e.message);
    }
};

// (C) API 愿由?
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
                    <i class="fa-solid fa-server"></i> API 愿由??꾪솴
                </h3>
                <button onclick="document.getElementById('api-management-modal').remove();" 
                        style="background:rgba(255,255,255,0.2);border:none;color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:1.2rem;">횞</button>
            </div>
            <div style="padding:16px;" id="api-status-content">
                <div style="text-align:center;padding:40px;color:#aaa;">
                    <i class="fa-solid fa-spinner fa-spin fa-2x"></i>
                    <p style="margin-top:10px;">API ?곹깭瑜?遺덈윭?ㅻ뒗 以?..</p>
                </div>
            </div>
            <div style="padding:12px 16px;background:rgba(0,0,0,0.2);border-radius:0 0 16px 16px;text-align:center;">
                <button onclick="refreshApiStatus();" style="padding:8px 16px;background:rgba(79,195,247,0.2);border:1px solid #4fc3f7;border-radius:6px;color:#4fc3f7;cursor:pointer;font-size:0.85rem;">
                    <i class="fa-solid fa-refresh"></i> ?꾩껜 ?덈줈怨좎묠
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
            { key: 'general', name: '湲곗긽 ?덈낫', icon: 'fa-sun', color: '#ffd54f' },
            { key: 'warnings_hub', name: '?밸낫 - HUB (KMA)', icon: 'fa-bolt', color: '#ff5722' },
            { key: 'warnings_afso', name: '?밸낫 - AFSO (?곗븞)', icon: 'fa-water', color: '#ff9800' },
            { key: 'zone', name: '?닿뎄蹂??덈낫', icon: 'fa-map-location-dot', color: '#29b6f6' },
            { key: 'buoys', name: '愿痢?遺??, icon: 'fa-anchor', color: '#26a69a' }
        ];

        let html = '';
        apiItems.forEach(api => {
            const s = status[api.key] || { lastRun: '-', status: '?뺣낫 ?놁쓬', message: '' };
            const isSuccess = s.status === '?깃났';
            const statusColor = isSuccess ? '#4caf50' : (s.status === '?ㅽ뙣' ? '#f44336' : '#9e9e9e');

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
                            ${s.lastRun || '?몄텧 湲곕줉 ?놁쓬'}
                        </div>
                        <button onclick="forceUpdateApi('${api.key}')" 
                                style="background:rgba(79,195,247,0.15);border:1px solid rgba(79,195,247,0.3);color:#4fc3f7;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:0.75rem;font-weight:500;">
                            <i class="fa-solid fa-rotate"></i> ?섎룞 ?몄텧
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
                <p style="margin-top:10px;">API ?곹깭瑜?遺덈윭?????놁뒿?덈떎.</p>
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
            btn.innerHTML = '<i class="fa-solid fa-check"></i> ?꾨즺';
            setTimeout(() => { refreshApiStatus(); }, 1000);
        } else {
            throw new Error(result.error || '?ㅽ뙣');
        }
    } catch (e) {
        btn.innerHTML = '<i class="fa-solid fa-times"></i> ?먮윭';
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
// [New] ?섏씠吏 珥덇린 濡쒕뱶 ??怨듭??ы빆 諭껋? 誘몃━ ?낅뜲?댄듃
// ============================================================================
(async function initPromoBadges() {
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/promo');
        if (res.ok) {
            const posts = await res.json();
            updateNewBadges(posts);
            // console.log('[Init] 怨듭??ы빆 諭껋? 珥덇린???꾨즺');
        }
    } catch (e) {
        // console.warn('[Init] 怨듭??ы빆 諭껋? 珥덇린???ㅽ뙣:', e.message);
    }
})();

// ============================================================================
// [New] ?고듃 ?ш린 ?ㅼ젙 湲곕뒫
// ============================================================================
const FontSizeManager = {
    STORAGE_KEY: 'user_font_size',

    // ?고듃 ?ш린 ?ㅽ봽??(湲곗〈 諛섏쓳???ш린???뷀븿)
    OFFSETS: {
        small: 0,    // 湲곗〈 諛섏쓳??洹몃?濡?
        medium: 2,   // +2px
        large: 4     // +4px
    },

    // ?꾩옱 ?ㅼ젙 媛?몄삤湲?
    get() {
        return localStorage.getItem(this.STORAGE_KEY) || 'medium';
    },

    // ?ㅼ젙 ???
    set(size) {
        if (!this.OFFSETS.hasOwnProperty(size)) size = 'medium';
        localStorage.setItem(this.STORAGE_KEY, size);
        this.apply(size);
    },

    // CSS ?곸슜
    apply(size) {
        if (!size) size = this.get();
        const offset = this.OFFSETS[size] || 0;

        // ?꾩옱 酉고룷??湲곕컲 湲곕낯 ?고듃 ?ш린 怨꾩궛
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

        // ?ㅽ봽???곸슜
        const finalFontSize = baseFontSize + offset;
        document.documentElement.style.fontSize = finalFontSize + 'px';

        // data ?띿꽦 異붽? (?붾쾭源낆슜)
        document.documentElement.setAttribute('data-font-size', size);

        console.log(`[FontSize] ?곸슜: ${size} (base: ${baseFontSize}px + offset: ${offset}px = ${finalFontSize}px)`);
    },

    // ?ㅼ젙 紐⑤떖 UI 珥덇린??
    initUI() {
        const radios = document.querySelectorAll('input[name="font-size"]');
        const current = this.get();

        radios.forEach(radio => {
            const content = radio.nextElementSibling;

            // ?꾩옱 媛?諛섏쁺
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

            // ?대┃ ?대깽??
            radio.addEventListener('change', () => {
                // 紐⑤뱺 ?쇰뵒???ㅽ???珥덇린??
                radios.forEach(r => {
                    const c = r.nextElementSibling;
                    if (c) {
                        c.style.background = '';
                        c.style.color = '#ccc';
                        c.classList.remove('active');
                    }
                });

                // ?좏깮???쇰뵒???ㅽ????곸슜
                if (content) {
                    content.style.background = 'var(--accent-blue)';
                    content.style.color = 'white';
                    content.classList.add('active');
                }

                // 利됱떆 誘몃━蹂닿린 ?곸슜
                this.apply(radio.value);
            });
        });
    },

    // ???(saveSettingsAndClose?먯꽌 ?몄텧)
    save() {
        const selected = document.querySelector('input[name="font-size"]:checked');
        if (selected) {
            this.set(selected.value);
        }
    }
};

// ?섏씠吏 濡쒕뱶 ???고듃 ?ш린 ?곸슜
FontSizeManager.apply();

// ?ㅼ젙 紐⑤떖 ?대┫ ??UI 珥덇린??
const _originalOpenSettingsModal = window.openSettingsModal;
window.openSettingsModal = function () {
    if (_originalOpenSettingsModal) _originalOpenSettingsModal();
    setTimeout(() => FontSizeManager.initUI(), 100);
};

// ?꾩뿭 ?몄텧
window.FontSizeManager = FontSizeManager;

// ============================================================================
// [New] ?밸낫 ?뚮┝ ?곸꽭 ?앹뾽 湲곕뒫
// ============================================================================
const AlertDetailPopup = {
    // ?숈젅湲??뺤씤 (11??~ 3??
    isWinterPeriod(dateStr) {
        if (!dateStr) return false;
        // 臾몄옄濡????쒓컖(?? "01/05 ?ㅽ썑...")??寃쎌슦 ?꾩옱 ??湲곗??쇰줈 ?먮떒
        if (typeof dateStr === 'string' && (dateStr.includes('/') || dateStr.includes('?ㅽ썑'))) {
            const now = new Date();
            const month = now.getMonth() + 1;
            return month >= 11 || month <= 3;
        }
        if (dateStr.length < 6) return false;
        const month = parseInt(dateStr.substring(4, 6));
        return month >= 11 || month <= 3;
    },

    // ?좎쭨 ?щ㎎ (?レ옄硫??щ㎎?? ?꾨땲硫?洹몃?濡??좎?)
    formatDateTime(dateStr) {
        if (!dateStr) return '?뺣낫 ?놁쓬';
        // ?レ옄濡쒕쭔 援ъ꽦??12?먮━ ?뺤떇???꾨땲硫??? "01/05 ?ㅽ썑...") 洹몃?濡?諛섑솚
        if (typeof dateStr !== 'string' || !/^\d{12}$/.test(dateStr)) return dateStr;
        const y = dateStr.substring(0, 4);
        const m = dateStr.substring(4, 6);
        const d = dateStr.substring(6, 8);
        const h = dateStr.substring(8, 10);
        const min = dateStr.substring(10, 12);
        return `${y}-${m}-${d} ${h}:${min}`;
    },

    // ?댁뿭紐낆쓣 留곹겕濡?蹂??
    createZoneLinks(zones, status) {
        if (!zones || zones.length === 0) return '?대떦 ?댁뿭';
        return zones.map(zone =>
            `<a href="#" class="alert-zone-link" data-zone="${zone}" data-status="${status}" style="color: var(--accent-blue); text-decoration: underline; cursor: pointer;">${zone}</a>`
        ).join(', ');
    },

    // 硫붿떆吏 ?앹꽦
    generateMessage(data) {
        let { alertType, status, tmFc, tmEf, tmYn, zones, prevAlertType } = data;
        const isWinter = this.isWinterPeriod(tmEf);
        const timeStrLong = this.formatDateTime(tmFc || tmEf);
        const effectTimeStr = this.formatDateTime(tmEf);
        const zoneLinks = this.createZoneLinks(zones, status);

        // [?섏젙] ?⑹뼱 紐낇솗?? '?띾옉'?대굹 '?띾옉?덈퉬'??臾몃㎘??'?띾옉二쇱쓽蹂?濡??쒖텧
        if (alertType.includes('?띾옉') && !alertType.includes('寃쎈낫')) {
            alertType = '?띾옉二쇱쓽蹂?;
        }
        if (prevAlertType && prevAlertType.includes('?띾옉') && !prevAlertType.includes('寃쎈낫')) {
            prevAlertType = '?띾옉二쇱쓽蹂?;
        }

        let message = '';

        // 1. ?띾옉/?띾옉二쇱쓽蹂??띾옉?덈퉬 - 諛쒗몴 (Publish)
        if (alertType.includes('?띾옉') && status === 'publish') {
            if (isWinter) {
                // ?숈젅湲?(Winter inside)
                message = `
??${timeStrLong}遺濡?${zoneLinks}??${alertType}媛 '諛쒗몴'?섏뿀?듬땲??
諛쒗슚 ?덉젙 ?쇱떆???깆쓽 ?곸꽭?댁슜?먯꽌 ?뺤씤?댁＜?쒓퀬, 諛쒗슚 ??30??誘몃쭔 ?댁꽑? 異쒗빆 諛?議곗뾽???쒗븳?섎땲 ?ъ쟾???덉쟾吏?濡??대룞 諛???쇰컮?띾땲??
* 15???댁긽 異쒗빆 媛??議곌굔? 媛源뚯슫 ?댁뼇寃쎌같 ?뚯텧??臾몄쓽

??異쒗빆 諛?議곗뾽 ?쒗븳 ?꾨컲 ???댁꽑?덉쟾議곗뾽踰???9議곗뿉 ?곕씪 ?댁뾽?덇? ?뺤? ???됱젙泥섎텇 ??곸씠 ?????덉뒿?덈떎.

??異쒗빆 ?쒗븳怨?愿??臾몄쓽??媛源뚯슫 ?댁뼇寃쎌같 ?뚯텧?뚮줈 臾몄쓽諛붾엻?덈떎.`;
            } else if (['寃쎈낫', '?쒗뭾'].some(t => alertType.includes(t))) {
                // ?띾옉寃쎈낫/?쒗뭾 媛뺥븳 ?밸낫??鍮꾨룞?덇린?먮룄 紐⑤뱺 ?댁꽑 ?쒗븳 臾멸뎄 ?곗꽑
                message = `
??${timeStrLong}遺濡?${zoneLinks}??${alertType}媛 '諛쒗몴'?섏뿀?듬땲??

??諛쒗슚 ?덉젙 ?쇱떆???깆쓽 ?곸꽭?댁슜?먯꽌 ?뺤씤?댁＜?쒓퀬, 諛쒗슚 ??紐⑤뱺 ?댁꽑? 異쒗빆 諛?議곗뾽???쒗븳?⑸땲?? ?대떦 ?댁뿭 諛??멸렐 ?댁뿭????빐?섎뒗 ?댁꽑? ?랁엳 ?덉쟾吏?濡???쇳빐二쇱떆湲?諛붾엻?덈떎.

??異쒗빆 諛?議곗뾽 ?쒗븳 ?꾨컲 ???댁꽑?덉쟾議곗뾽踰???9議곗뿉 ?곕씪 ?댁뾽?덇? ?뺤? ???됱젙泥섎텇 ??곸씠 ?????덉뒿?덈떎.

??異쒗빆 ?쒗븳怨?愿??臾몄쓽??媛源뚯슫 ?닿꼍 ?뚯텧?뚮줈 臾몄쓽諛붾엻?덈떎.`;
            } else {
                // 鍮꾨룞?덇린 (Winter outside)
                message = `
??${timeStrLong}遺濡?${zoneLinks}??${alertType}媛 '諛쒗몴'?섏뿀?듬땲??
?대떦 諛쒗몴??${effectTimeStr}遺濡?'諛쒗슚'???덉젙?대ŉ, 諛쒗슚 ??15??誘몃쭔 ?댁꽑? 異쒗빆 諛?議곗뾽???쒗븳?섎땲 ?ъ쟾???덉쟾吏?濡??대룞 諛???쇰컮?띾땲??

??異쒗빆 諛?議곗뾽 ?쒗븳 ?꾨컲 ???댁꽑?덉쟾議곗뾽踰???9議곗뿉 ?곕씪 ?댁뾽?덇? ?뺤? ???됱젙泥섎텇 ??곸씠 ?????덉뒿?덈떎.

??異쒗빆 ?쒗븳怨?愿??臾몄쓽??媛源뚯슫 ?닿꼍 ?뚯텧?뚮줈 臾몄쓽諛붾엻?덈떎.`;
            }
        }
        // 2. ?띾옉/?띾옉二쇱쓽蹂?- 諛쒗슚 (Active)
        else if (alertType.includes('?띾옉') && status === 'active') {
            if (isWinter) {
                // ?숈젅湲?
                message = `
??${timeStrLong}遺濡?${zoneLinks}??${alertType}媛 '諛쒗슚'?섏뿀?듬땲??
30??誘몃쭔 ?댁꽑? 異쒗빆 諛?議곗뾽???쒗븳?섎땲 議곗뾽 以묒씤 ?댁꽑? ?덉쟾吏?濡??대룞 諛???쇰컮?띾땲??
* 15???댁긽 異쒗빆 媛??議곌굔? 媛源뚯슫 ?댁뼇寃쎌같 ?뚯텧??臾몄쓽

???댁젣 ?덉젙 ?쇱떆???깆쓽 ?곸꽭?댁슜?먯꽌 ?뺤씤?댁＜?쒓퀬, ?ㅼ젣 ?띾옉二쇱쓽蹂??댁젣 ?쒓컖 ?댄썑遺??紐⑤뱺 ?댁꽑? 利됱떆 異쒗빆??媛?ν븯?ㅻ땲, ?섏떆濡?湲곗긽?밸낫瑜??뺤씤諛붾엻?덈떎.

??異쒗빆 諛?議곗뾽 ?쒗븳 ?꾨컲 ???댁꽑?덉쟾議곗뾽踰???9議곗뿉 ?곕씪 ?댁뾽?덇? ?뺤? ???됱젙泥섎텇 ??곸씠 ?????덉뒿?덈떎.

??異쒗빆 ?쒗븳怨?愿??臾몄쓽??媛源뚯슫 ?닿꼍 ?뚯텧?뚮줈 臾몄쓽諛붾엻?덈떎.`;
            } else {
                // 鍮꾨룞?덇린
                message = `
??${timeStrLong}遺濡?${zoneLinks}??${alertType}媛 '諛쒗슚'?섏뿀?듬땲??
15??誘몃쭔 ?댁꽑? 異쒗빆 諛?議곗뾽???쒗븳?섎땲 議곗뾽 以묒씤 ?댁꽑? ?덉쟾吏?濡??대룞 諛???쇰컮?띾땲??

???댁젣 ?덉젙 ?쇱떆???깆쓽 ?곸꽭?댁슜?먯꽌 ?뺤씤?댁＜?쒓퀬, ?ㅼ젣 ?띾옉二쇱쓽蹂??댁젣 ?쒓컖 ?댄썑遺??紐⑤뱺 ?댁꽑? 利됱떆 異쒗빆??媛?ν븯?ㅻ땲, ?섏떆濡?湲곗긽?밸낫瑜??뺤씤諛붾엻?덈떎.

??異쒗빆 諛?議곗뾽 ?쒗븳 ?꾨컲 ???댁꽑?덉쟾議곗뾽踰???9議곗뿉 ?곕씪 ?댁뾽?덇? ?뺤? ???됱젙泥섎텇 ??곸씠 ?????덉뒿?덈떎.

??異쒗빆 ?쒗븳怨?愿??臾몄쓽??媛源뚯슫 ?닿꼍 ?뚯텧?뚮줈 臾몄쓽諛붾엻?덈떎.`;
            }
        }
        // 2-1. ?띾옉寃쎈낫, ?쒗뭾二쇱쓽蹂? ?쒗뭾寃쎈낫 - 諛쒗슚 (Active) [?좉퇋 異붽?]
        else if (['寃쎈낫', '?쒗뭾'].some(t => alertType.includes(t)) && status === 'active') {
            message = `
??${timeStrLong}遺濡?${zoneLinks}??${alertType}媛 '諛쒗슚'?섏뿀?듬땲??

??紐⑤뱺 ?댁꽑? 異쒗빆 諛?議곗뾽???쒗븳?⑸땲?? ?대떦 ?댁뿭 諛??멸렐 ?댁뿭????빐?섎뒗 ?댁꽑? ?랁엳 ?덉쟾吏?濡???쇳빐二쇱떆湲?諛붾엻?덈떎.

??異쒗빆 諛?議곗뾽 ?쒗븳 ?꾨컲 ???댁꽑?덉쟾議곗뾽踰???9議곗뿉 ?곕씪 ?댁뾽?덇? ?뺤? ???됱젙泥섎텇 ??곸씠 ?????덉뒿?덈떎.

??異쒗빆 ?쒗븳怨?愿??臾몄쓽??媛源뚯슫 ?닿꼍 ?뚯텧?뚮줈 臾몄쓽諛붾엻?덈떎.`;
        }
        // 3. ?댁젣 (Release)
        else if (status === 'release') {
            message = `
??${timeStrLong}遺濡?${zoneLinks}??${alertType}媛 '?댁젣'?섏뿀?듬땲?? ?댁꽑??異쒗빆 諛?議곗뾽??媛?ν븯?? 異쒗빆 ??異쒗빆吏 諛?議곗뾽吏 ?댁긽?곹깭瑜??뺤씤?섏떆???덉쟾??異쒗빆怨?議곗뾽???섎룄濡??밸??쒕┰?덈떎.

??異쒗빆 ?쒗븳怨?愿??臾몄쓽??媛源뚯슫 ?닿꼍 ?뚯텧?뚮줈 臾몄쓽諛붾엻?덈떎.`;
        }
        // 4. 寃⑹긽/寃⑺븯 (Upgrade/Downgrade)
        else if (status === 'upgrade' || status === 'downgrade') {
            const levelWord = status === 'upgrade' ? '寃⑹긽' : '寃⑺븯';

            // [Fix] 寃⑹긽/寃⑺븯 ?꾩쓽 理쒖쥌 ?밸낫媛 '?띾옉二쇱쓽蹂???寃쎌슦? '寃쎈낫/?쒗뭾'??寃쎌슦瑜?援щ텇?섏뿬 ?덈궡
            if (alertType.includes('?띾옉') && !alertType.includes('寃쎈낫')) {
                // ?띾옉二쇱쓽蹂대줈 蹂??寃쎌슦 (二쇰줈 寃쎈낫->二쇱쓽蹂?寃⑺븯 ??
                if (isWinter) {
                    message = `
??${timeStrLong}遺濡?${zoneLinks}??${prevAlertType || '?밸낫'}媛 ${alertType}?쇰줈 ${levelWord}?섏뿀?듬땲??
30??誘몃쭔 ?댁꽑? 異쒗빆 諛?議곗뾽???쒗븳?섎땲 議곗뾽 以묒씤 ?댁꽑? ?덉쟾吏?濡??대룞 諛???쇰컮?띾땲??
* 15???댁긽 異쒗빆 媛??議곌굔? 媛源뚯슫 ?댁뼇寃쎌같 ?뚯텧??臾몄쓽

???댁젣 ?덉젙 ?쇱떆???깆쓽 ?곸꽭?댁슜?먯꽌 ?뺤씤?댁＜?쒓퀬, ?ㅼ젣 ?띾옉二쇱쓽蹂??댁젣 ?쒓컖 ?댄썑遺??紐⑤뱺 ?댁꽑? 利됱떆 異쒗빆??媛?ν븯?ㅻ땲, ?섏떆濡?湲곗긽?밸낫瑜??뺤씤諛붾엻?덈떎.

??異쒗빆 諛?議곗뾽 ?쒗븳 ?꾨컲 ???댁꽑?덉쟾議곗뾽踰???9議곗뿉 ?곕씪 ?댁뾽?덇? ?뺤? ???됱젙泥섎텇 ??곸씠 ?????덉뒿?덈떎.

??異쒗빆 ?쒗븳怨?愿??臾몄쓽??媛源뚯슫 ?닿꼍 ?뚯텧?뚮줈 臾몄쓽諛붾엻?덈떎.`;
                } else {
                    message = `
??${timeStrLong}遺濡?${zoneLinks}??${prevAlertType || '?밸낫'}媛 ${alertType}?쇰줈 ${levelWord}?섏뿀?듬땲??
15??誘몃쭔 ?댁꽑? 異쒗빆 諛?議곗뾽???쒗븳?섎땲 議곗뾽 以묒씤 ?댁꽑? ?덉쟾吏?濡??대룞 諛???쇰컮?띾땲??

???댁젣 ?덉젙 ?쇱떆???깆쓽 ?곸꽭?댁슜?먯꽌 ?뺤씤?댁＜?쒓퀬, ?ㅼ젣 ?띾옉二쇱쓽蹂??댁젣 ?쒓컖 ?댄썑遺??紐⑤뱺 ?댁꽑? 利됱떆 異쒗빆??媛?ν븯?ㅻ땲, ?섏떆濡?湲곗긽?밸낫瑜??뺤씤諛붾엻?덈떎.

??異쒗빆 諛?議곗뾽 ?쒗븳 ?꾨컲 ???댁꽑?덉쟾議곗뾽踰???9議곗뿉 ?곕씪 ?댁뾽?덇? ?뺤? ???됱젙泥섎텇 ??곸씠 ?????덉뒿?덈떎.

??異쒗빆 ?쒗븳怨?愿??臾몄쓽??媛源뚯슫 ?닿꼍 ?뚯텧?뚮줈 臾몄쓽諛붾엻?덈떎.`;
                }
            } else {
                // 寃쎈낫???쒗뭾?쇰줈 寃⑹긽/寃⑺븯??寃쎌슦 (紐⑤뱺 ?댁꽑 ?쒗븳)
                message = `
??${timeStrLong}遺濡?${zoneLinks}??${prevAlertType || '?밸낫'}媛 ${alertType}?쇰줈 ${levelWord}?섏뿀?듬땲??

??紐⑤뱺 ?댁꽑? 異쒗빆 諛?議곗뾽???쒗븳?⑸땲?? ?대떦 ?댁뿭 諛??멸렐 ?댁뿭????빐?섎뒗 ?댁꽑? ?랁엳 ?덉쟾吏?濡???쇳빐二쇱떆湲?諛붾엻?덈떎.

??異쒗빆 諛?議곗뾽 ?쒗븳 ?꾨컲 ???댁꽑?덉쟾議곗뾽踰???9議곗뿉 ?곕씪 ?댁뾽?덇? ?뺤? ???됱젙泥섎텇 ??곸씠 ?????덉뒿?덈떎.

??異쒗빆 ?쒗븳怨?愿??臾몄쓽??媛源뚯슫 ?닿꼍 ?뚯텧?뚮줈 臾몄쓽諛붾엻?덈떎.`;
            }
        }
        // 5. ?띾옉寃쎈낫, ?쒗뭾二쇱쓽蹂? ?쒗뭾寃쎈낫 - 諛쒗몴 (Publish)
        else if (['寃쎈낫', '?쒗뭾'].some(t => alertType.includes(t)) && status === 'publish') {
            message = `
??${timeStrLong}遺濡?${zoneLinks}??${alertType}媛 '諛쒗몴'?섏뿀?듬땲??

??諛쒗슚 ?덉젙 ?쇱떆???깆쓽 ?곸꽭?댁슜?먯꽌 ?뺤씤?댁＜?쒓퀬, 諛쒗슚 ??紐⑤뱺 ?댁꽑? 異쒗빆 諛?議곗뾽???쒗븳?⑸땲?? ?대떦 ?댁뿭 諛??멸렐 ?댁뿭????빐?섎뒗 ?댁꽑? ?랁엳 ?덉쟾吏?濡???쇳빐二쇱떆湲?諛붾엻?덈떎.

??異쒗빆 諛?議곗뾽 ?쒗븳 ?꾨컲 ???댁꽑?덉쟾議곗뾽踰???9議곗뿉 ?곕씪 ?댁뾽?덇? ?뺤? ???됱젙泥섎텇 ??곸씠 ?????덉뒿?덈떎.

??異쒗빆 ?쒗븳怨?愿??臾몄쓽??媛源뚯슫 ?닿꼍 ?뚯텧?뚮줈 臾몄쓽諛붾엻?덈떎.`;
        }
        // 6. 湲고? (湲곕낯??
        else {
            message = `
??${timeStrLong}遺濡?${zoneLinks}??${alertType}媛 諛쒖깮?덉뒿?덈떎.

???먯꽭???댁슜? ?깆쓽 湲곗긽?밸낫 ??뿉???뺤씤?댁＜?몄슂.`;
        }

        return message.trim();
    },

    // ?앹뾽 ?쒖떆
    show(data) {
        const message = this.generateMessage(data);

        // 湲곗〈 ?앹뾽 ?쒓굅
        const existing = document.getElementById('alert-detail-popup');
        if (existing) existing.remove();

        // ?쒕ぉ 諛??꾩씠肄??ㅼ젙
        let title = '湲곗긽?밸낫???곕Ⅸ ?덉쟾沅뚭퀬';
        let iconColor = '#f59e0b'; // 二쇳솴??(湲곕낯)

        if (data.status === 'release') {
            title = '湲곗긽?밸낫 ?댁젣 ?뚮┝';
            iconColor = '#10b981'; // 珥덈줉??(?댁젣)
        }

        // ?앹뾽 ?앹꽦
        const popup = document.createElement('div');
        popup.id = 'alert-detail-popup';
        popup.innerHTML = `
            <div class="alert-popup-overlay" onclick="AlertDetailPopup.close()"></div>
            <div class="alert-popup-content">
                <div class="alert-popup-header">
                    <h3><i class="fa-solid fa-triangle-exclamation" style="color: ${iconColor};"></i> ${title}</h3>
                    <button class="alert-popup-close" onclick="AlertDetailPopup.close()">??/button>
                </div>
                <div class="alert-popup-body">
                    ${message.replace(/\n/g, '<br>')}
                </div>
                <div class="alert-popup-footer">
                    <button onclick="AlertDetailPopup.close()" style="padding: 10px 24px; background: var(--accent-blue); color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer;">?뺤씤</button>
                </div>
            </div>
        `;

        // ?ㅽ???異붽?
        if (!document.getElementById('alert-popup-style')) {
            const style = document.createElement('style');
            style.id = 'alert-popup-style';
            style.textContent = `
                #alert-detail-popup {
                    position: fixed;
                    inset: 0;
                    z-index: 10000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                }
                .alert-popup-overlay {
                    position: absolute;
                    inset: 0;
                    background: rgba(0,0,0,0.7);
                }
                .alert-popup-content {
                    position: relative;
                    background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
                    border-radius: 16px;
                    border: 1px solid rgba(255,255,255,0.1);
                    max-width: 500px;
                    width: 100%;
                    max-height: 80vh;
                    overflow: hidden;
                    animation: alertPopupIn 0.3s ease-out;
                }
                @keyframes alertPopupIn {
                    from { opacity: 0; transform: scale(0.9) translateY(20px); }
                    to { opacity: 1; transform: scale(1) translateY(0); }
                }
                .alert-popup-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 16px 20px;
                    border-bottom: 1px solid rgba(255,255,255,0.1);
                }
                .alert-popup-header h3 {
                    margin: 0;
                    font-size: 1.1rem;
                    color: #fff;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .alert-popup-close {
                    background: none;
                    border: none;
                    color: #94a3b8;
                    font-size: 1.2rem;
                    cursor: pointer;
                }
                .alert-popup-body {
                    padding: 20px;
                    color: #e2e8f0;
                    font-size: 0.95rem;
                    line-height: 1.7;
                    max-height: 50vh;
                    overflow-y: auto;
                }
                .alert-popup-footer {
                    padding: 16px 20px;
                    border-top: 1px solid rgba(255,255,255,0.1);
                    display: flex;
                    justify-content: center;
                }
                .alert-zone-link:hover {
                    color: #60a5fa !important;
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(popup);

        // ?댁뿭 留곹겕 ?대┃ ?대깽??
        popup.querySelectorAll('.alert-zone-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const zoneName = e.target.dataset.zone;
                const status = e.target.dataset.status; // status 媛?몄삤湲?
                this.close();
                this.scrollToZone(zoneName, status);
            });
        });
    },

    // ?앹뾽 ?リ린
    close() {
        const popup = document.getElementById('alert-detail-popup');
        if (popup) popup.remove();
    },

    // ?댁뿭 ?꾩퐫?붿뼵?쇰줈 ?ㅽ겕濡?諛??쇱튂湲?
    scrollToZone(zoneName, status) {
        const tabId = 'weather-alert-section';
        let cardClass = '.alert-card';

        // 1. ???대룞
        const tab = document.querySelector(`[data-target="${tabId}"]`);
        if (tab) tab.click();

        // DOM ?뚮뜑留?諛????꾪솚 ?쒓컙 ?뺣낫
        setTimeout(() => {
            // 2. 硫붿씤 ?꾩퐫?붿뼵 媛뺤젣 ?닿린
            if (status === 'release') {
                cardClass = '.weather-status-card';
                const marineBody = document.getElementById('marine-status-accordion-body');
                if (marineBody && marineBody.classList.contains('collapsed')) {
                    if (typeof toggleMarineStatusAccordion === 'function') toggleMarineStatusAccordion();
                    else {
                        marineBody.classList.remove('collapsed');
                        marineBody.style.maxHeight = 'none';
                    }
                }
            } else {
                const mainBody = document.getElementById('main-accordion-body');
                if (mainBody && mainBody.classList.contains('collapsed')) {
                    if (typeof toggleMainAccordion === 'function') toggleMainAccordion();
                    else {
                        mainBody.classList.remove('collapsed');
                        mainBody.style.maxHeight = 'none';
                    }
                }
            }

            // 3. ???移대뱶 李얘린
            const cards = document.querySelectorAll(cardClass);
            let targetCard = null;

            cards.forEach(card => {
                if (card.textContent.includes(zoneName)) {
                    targetCard = card;
                }
            });

            if (targetCard) {
                // 4. ?곸쐞 吏??퀎 ?꾩퐫?붿뼵 媛뺤젣 ?닿린
                const seaSection = targetCard.closest('.sea-section');
                if (seaSection && !seaSection.classList.contains('open')) {
                    const header = seaSection.querySelector('.sea-header');
                    if (header) header.click();
                }

                const subRegionSection = targetCard.closest('.sub-region-section');
                if (subRegionSection) {
                    const list = subRegionSection.querySelector('.sub-region-list');
                    if (list && list.style.display === 'none') {
                        const header = subRegionSection.querySelector('.sub-region-header');
                        if (header) header.click();
                    }
                }

                if (status !== 'release') {
                    const details = targetCard.querySelector('.alert-details');
                    const arrow = targetCard.querySelector('.detail-arrow');
                    if (details && details.classList.contains('hidden')) {
                        details.classList.remove('hidden');
                        if (arrow) arrow.style.transform = 'rotate(90deg)';
                    }
                }

                // 5. ?ㅽ겕濡?諛??섏씠?쇱씠??
                targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                targetCard.style.boxShadow = '0 0 20px 5px rgba(255, 215, 0, 0.8)';
                setTimeout(() => { targetCard.style.boxShadow = ''; }, 3000);
            }
        }, 500);
    }
};

// [New] ?몄떆 ?뚮┝ ?뚮씪誘명꽣 泥댄겕 ?⑥닔 (遺꾩꽍/?섏젙蹂?
function checkForPushPopup() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('popup') === 'true') {
        const alertType = params.get('alertType') || '';

        // [Fix] 吏吏꾪빐????뭾?댁씪??寃쎌슦 ?앹뾽 ?ㅺ퀎 ?놁쓬 -> ?앹뾽???쒖떆?섏? ?딆쓬
        if (alertType.includes('?댁씪')) {
            return;
        }

        const data = {
            alertType: alertType,
            status: params.get('status'),
            tmFc: params.get('tmFc'),
            tmEf: params.get('tmEf'),
            tmYn: params.get('tmYn'),
            zones: params.get('zones') ? params.get('zones').split(',') : [],
            prevAlertType: params.get('prevAlertType')
        };

        // ?곗씠?곌? 異⑸텇??濡쒕뱶?????쒖떆?섍린 ?꾪빐 ?쎄컙??吏??
        setTimeout(() => {
            if (typeof AlertDetailPopup !== 'undefined') {
                AlertDetailPopup.show(data);
            }
        }, 500);
    }
}

// ?꾩뿭 ?몄텧
window.AlertDetailPopup = AlertDetailPopup;

// ============================================================================
// (D) ?밸낫 ?뚮┝ 愿由?(Alert Management)
// ============================================================================

// Mock Data Storage for Demo
let MOCK_ALERT_HISTORY = [];

function generateMockAlertHistory() {
    // Generate data based on the MD file scenarios
    const now = new Date();

    // 1. Publish (諛쒗몴)
    MOCK_ALERT_HISTORY.push({
        id: 'pub_1',
        tab: 'publish', // also shown in general history
        type: 'auto',
        time: '26.01.03 07:00',
        pushStatus: 'sent',
        pushTime: '15:30',
        title: '?띾옉二쇱쓽蹂?諛쒗몴',
        zones: ['?몄궛?욌컮??, '寃쎈턿?⑤??욌컮??],
        grade: 'warning',
        items: [
            { zone: '?몄궛?욌컮??, tmEf: '26.01.03 09:00', tmRl: '26.01.03 18:00' },
            { zone: '寃쎈턿?⑤??욌컮??, tmEf: '26.01.03 09:00', tmRl: '26.01.03 18:00' }
        ]
    });

    MOCK_ALERT_HISTORY.push({
        id: 'pub_2',
        tab: 'publish',
        type: 'auto',
        time: '26.01.03 07:00',
        pushStatus: 'pending',
        pushTime: null,
        title: '?띾옉二쇱쓽蹂?諛쒗몴',
        zones: ['遺?곗븵諛붾떎', '嫄곗젣?쒕룞遺?욌컮??],
        grade: 'advisory',
        items: [
            { zone: '遺?곗븵諛붾떎', tmEf: '26.01.03 10:00', tmRl: '26.01.03 20:00' },
            { zone: '嫄곗젣?쒕룞遺?욌컮??, tmEf: '26.01.03 10:00', tmRl: '26.01.03 22:00' }
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
        title: '?띾옉寃쎈낫 諛쒗슚',
        zones: ['?몄쿇쨌寃쎄린遺곷??욌컮??],
        grade: 'warning',
        items: [
            { zone: '?몄쿇쨌寃쎄린遺곷??욌컮??, tmRl: '26.01.03 18:00' }
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
        title: '?띾옉二쇱쓽蹂????띾옉寃쎈낫',
        zones: ['?쒖＜?꾨턿遺?욌컮??],
        grade: 'warning',
        items: [
            { zone: '?쒖＜?꾨턿遺?욌컮??, tmRl: '26.01.03 22:00' }
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
        target: '?꾨궓?쒕??⑦빐?욌컮?? ?꾨궓?숇??⑦빐?욌컮??,
        title: '湲닿툒 ?댁뼇 ?덉쟾 怨듭?',
        content: '?꾩옱 ?⑦빐 ?쒕? ?댁뿭??媛뺥븳 ?뚰뭾???덉긽?섏삤???뚰삎 ?좊컯? ?덉쟾??怨녹쑝濡???쇳븯?쒓린 諛붾엻?덈떎.'
    });

    MOCK_ALERT_HISTORY.push({
        id: 'cust_2',
        tab: 'custom_history',
        type: 'manual',
        time: '26.01.02 09:00',
        pushStatus: 'sent',
        count: 512,
        target: '?꾩껜 ?댁뿭',
        title: '?쒖뒪???먭? ?덈궡',
        content: '26.01.02 10:00 ~ 12:00 ?쒕퉬???먭? ?덉젙?낅땲?? ?댁슜??遺덊렪???쒕젮 二꾩넚?⑸땲??'
    });
}

// Generate once
generateMockAlertHistory();

window.showAlertManagementModal = function () {
    if (!adminAuthenticated.alert) return;

    const existingModal = document.getElementById('alert-management-modal');
    if (existingModal) existingModal.remove();

    const tabs = [
        { id: 'publish', name: '諛쒗몴', icon: 'fa-bullhorn' },
        { id: 'active', name: '諛쒗슚', icon: 'fa-check-circle' },
        { id: 'release', name: '?댁젣', icon: 'fa-check' },
        { id: 'level', name: '寃⑹긽/寃⑺븯', icon: 'fa-arrow-up-right-dots' },
        { id: 'custom', name: '吏곸젒 諛쒖넚', icon: 'fa-paper-plane' },
        { id: 'history', name: '諛쒖넚 ?대젰', icon: 'fa-history' }
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
                    <i class="fa-solid fa-tower-broadcast"></i> ?댁뼇?밸낫 ?뚮┝ 愿由?
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
                    <i class="fa-solid fa-circle-notch fa-spin"></i> ?곗씠?곕? 遺덈윭?ㅻ뒗 以?..
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

window.renderAlertAdminContent = async function (tabId) {
    const container = document.getElementById('alert-management-content');
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
    // [?섏젙] ?댁뼇?밸낫 ?뚮┝ 愿由ъ뿉?쒕뒗 硫붿씤 ?댁뿭 ?밸낫留?痍④툒 (?곗븞諛붾떎/?됱닔援ъ뿭 ?쒖쇅)
    const allAlerts = [
        ...appState.alerts
    ].filter(a => !a.isCoastal && !a.zoneName.includes('?곗븞諛붾떎') && !a.zoneName.includes('?됱닔援ъ뿭'));

    // Filter by Tab
    let filteredItems = [];
    if (tabId === 'publish') {
        filteredItems = allAlerts.filter(a => a.isPreliminary || a.command === '1' || a.command === '諛쒗몴');
    } else if (tabId === 'active') {
        // [?섏젙] 諛쒗슚 ?? ?댁젣(3)媛 ?꾨땶 紐⑤뱺 ?곗씠?곕? ?ы븿?섎릺, ?쒓컙蹂寃?2) ?ы븿
        filteredItems = allAlerts.filter(a => a.command !== '3' && a.command !== '?댁젣');
    } else if (tabId === 'release') {
        filteredItems = allAlerts.filter(a =>
            a.command === '3' ||
            a.command === '?댁젣' ||
            (!a.isPreliminary && a.tmEd && a.tmEd.trim() !== '' && a.tmEd !== '?뺣낫 ?놁쓬' && a.tmEd !== '誘몄젙' && !a.tmEd.includes('00??))
        );
    } else if (tabId === 'level') {
        // [?섏젙] 寃⑹긽/寃⑺븯 ?? command媛 '蹂寃??대㈃?? ?깃툒?대굹 醫낅쪟??蹂?붽? ?덉긽?섎뒗 嫄??꾪꽣留?(二쇱쓽蹂?寃쎈낫 ?ы븿)
        filteredItems = allAlerts.filter(a => a.command === '蹂寃? || a.command === '蹂寃쎈컻??);
        // ?쒓컙 蹂寃?2)? ?쒖쇅?섍퀬 ?ㅼ젣 媛뺣룄 蹂?붽? ?덈뒗 寃껊쭔 ?ш린???몄텧?섎룄濡?異뷀썑 蹂닿컯
        filteredItems = filteredItems.filter(a =>
            a.level && (a.level.includes('寃쎈낫') || a.level.includes('二쇱쓽蹂?)) &&
            a.command !== '2' && a.command !== '?쒓컖蹂寃?
        );
    }

    // [異붽?] ?곗씠??臾닿껐??蹂댁옣: ?숈씪 ?댁뿭/?밸낫?????媛??理쒖떊 ?곗씠??諛쒗몴?쒓컖 湲곗?)留??④?
    const uniqueAlertMap = new Map();
    filteredItems.forEach(item => {
        const uniqueKey = `${item.zoneName}_${item.warnType}_${item.level}`;
        const existing = uniqueAlertMap.get(uniqueKey);

        // ?쒓컙 鍮꾧탳瑜??꾪빐 ?レ옄留?異붿텧
        const itemTime = String(item.tmFc || '').replace(/[^0-9]/g, '');
        const existingTime = existing ? String(existing.tmFc || '').replace(/[^0-9]/g, '') : '';

        if (!existing || itemTime > existingTime) {
            uniqueAlertMap.set(uniqueKey, item);
        }
    });
    const finalizedItems = Array.from(uniqueAlertMap.values());

    // 3. 1?④퀎 洹몃９??(?쒓컙 + ?밸낫醫낅쪟)
    const cardGroups = {};
    const nowStr = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace(/[-T:Z]/g, '').substring(0, 12);

    finalizedItems.forEach(item => {
        // 寃⑹긽/寃⑺븯 ?щ? ?먮떒
        const isLevelChange = item.command === '蹂寃? || item.level?.includes('寃쎈낫');
        const statusType = item.level?.includes('寃쎈낫') ? '寃⑹긽' : (item.level?.includes('二쇱쓽蹂?) && item.command === '蹂寃? ? '寃⑺븯' : '?뺢퇋');

        // ?좎쭨 ?뺢퇋???⑥닔 (鍮꾧탳??
        const getCompareValue = (dStr) => {
            if (!dStr || dStr === '?뺣낫 ?놁쓬' || dStr === '誘몄젙') return '999999999999';
            let numeric = dStr.replace(/[^0-9]/g, '');
            if (numeric.length === 12) return numeric;

            // ?쒓? ?ы븿 ?쒓컖 (?? 06???ㅼ쟾(09??12??) 泥섎━
            const dayMatch = dStr.match(/(\d+)??);
            const hourMatch = dStr.match(/\((\d+)??);
            if (dayMatch) {
                const now = new Date();
                const year = now.getFullYear();
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const day = dayMatch[1].padStart(2, '0');
                // 踰붿쐞???쒖옉 ?쒓컖??湲곗??쇰줈 鍮꾧탳 (09??12??-> 09??
                const hour = hourMatch ? hourMatch[1].padStart(2, '0') : '00';
                return `${year}${month}${day}${hour}00`;
            }
            return numeric.padEnd(12, '0');
        };

        const efCompare = getCompareValue(item.tmEf);
        const edCompare = getCompareValue(item.tmEd);

        // ?ㅼ젣 ?곹솴 ?먮떒 (?꾩옱 ?쒖젏 湲곗?)
        const isActuallyActive = efCompare <= nowStr;
        const isActuallyReleased = edCompare <= nowStr;

        // [?듭떖 濡쒖쭅] ??퀎 ?湲??쇱씠釉??먮떒
        const isWaiting = tabId === 'release'
            ? (edCompare > nowStr)
            : (efCompare > nowStr);

        // ?ㅻ뜑???쒖떆???쒓컙 寃곗젙
        let headerTime = '';
        if (isWaiting && (tabId === 'active' || tabId === 'release')) {
            const targetTime = tabId === 'active' ? item.tmEf : item.tmEd;
            headerTime = (typeof formatDate === 'function' && targetTime) ? formatDate(targetTime) : item.tmFc;
            if (headerTime.includes('2026')) headerTime = headerTime.replace('2026.', '');
        } else {
            const targetTime = tabId === 'active' ? item.tmEf : (tabId === 'release' ? item.tmEd : item.tmFc);
            if (targetTime && targetTime.length === 12) {
                headerTime = `26.${targetTime.substring(4, 6)}.${targetTime.substring(6, 8)} ${targetTime.substring(8, 10)}:${targetTime.substring(10, 12)}`;
            } else {
                headerTime = targetTime;
            }
        }

        const typeKey = `${item.warnType}${item.level}`;
        // 洹몃９ ???ㅼ젙 (?쒓컖蹂寃??곹깭 異붽?)
        let statusKey = isWaiting ? 'WAIT' : (statusType !== '?뺢퇋' ? `LEVEL_${statusType}` : 'LIVE');
        if (item.command === '2' || item.command === '蹂寃쎈컻??) statusKey = 'TIME_CHANGED';
        const groupKey = `${statusKey}_${headerTime}_${typeKey}`;

        if (!cardGroups[groupKey]) {
            cardGroups[groupKey] = {
                key: groupKey,
                headerTime: headerTime,
                isWaiting: isWaiting,
                isActuallyActive: isActuallyActive,
                isActuallyReleased: isActuallyReleased,
                isTimeChanged: item.command === '2' || item.command === '蹂寃쎈컻??,
                isLevelChange: statusType !== '?뺢퇋',
                statusType: statusType,
                typeName: item.warnType,
                level: item.level,
                isPreliminary: item.isPreliminary,
                subGroups: {}
            };
        }

        const subKey = `${item.tmEf}_${item.tmEd || 'none'}`;
        if (!cardGroups[groupKey].subGroups[subKey]) {
            cardGroups[groupKey].subGroups[subKey] = {
                tmEf: item.tmEf,
                tmEd: item.tmEd,
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
        return String(b.headerTime).localeCompare(String(a.headerTime));
    });

    if (sortedGroups.length === 0) {
        container.innerHTML = `
            <div style="text-align:center;padding:60px 20px;color:#64748b;">
                <i class="fa-solid fa-clipboard-check" style="font-size:3rem;margin-bottom:15px;opacity:0.3;"></i>
                <p style="font-size:1.1rem;font-weight:600;">?꾩옱 ?대떦 ??쓽 ?밸낫 ?곗씠?곌? ?놁뒿?덈떎.</p>
                <p style="font-size:0.85rem;margin-top:5px;">湲곗긽泥??곗씠?곌? ?섏쭛?섎㈃ ?먮룞?쇰줈 ??꾨씪?몄씠 ?뺤꽦?⑸땲??</p>
            </div>
        `;
        return;
    }

    let html = '';
    sortedGroups.forEach(group => {
        let timeDisplay = group.headerTime;
        const isSent = pushHistory.some(h => {
            // ??留ㅼ묶
            const tabMatch = (group.isLevelChange ? h.tab === 'level' : h.tab === tabId);
            if (!tabMatch) return false;

            // [New] 湲곗??쒓컖(tmRef)???덉쑝硫??곗꽑 留ㅼ묶 (?먮룞 諛쒖넚 ???ъ뼱吏?
            if (h.tmRef && group.headerTime && h.tmRef === group.headerTime) return true;

            // [Fallback] 湲곗〈 ?댁슜 湲곕컲 留ㅼ묶 (?섎룞 諛쒖넚 ??
            return h.content?.includes(group.typeName) && h.time?.includes(group.headerTime?.substring(4, 10));
        });

        const sentLog = isSent ? pushHistory.find(h =>
            (group.isLevelChange ? h.tab === 'level' : h.tab === tabId) &&
            ((h.tmRef && group.headerTime && h.tmRef === group.headerTime) || (h.content?.includes(group.typeName) && h.time?.includes(group.headerTime?.substring(4, 10))))
        ) : null;

        const isAuto = sentLog?.type === 'auto';
        let statusText = '';
        const pushResult = isSent ? (isAuto ? '?먮룞 諛쒖넚?꾨즺' : '?섎룞 諛쒖넚?꾨즺') : '諛쒖넚 ?湲?;

        if (tabId === 'active' || tabId === 'level') {
            if (group.isTimeChanged) {
                statusText = `<span style="color:#38bdf8;"><i class="fa-solid fa-clock-rotate-left"></i> ?쒓컖 蹂寃?/span> <span style="color:rgba(255,255,255,0.2);margin:0 5px;">|</span> <span style="color:${isSent ? '#22c55e' : '#94a3b8'};">${pushResult}</span>`;
            } else if (group.isWaiting) {
                statusText = `<span style="color:#f59e0b;"><i class="fa-solid fa-hourglass-start"></i> 諛쒗슚 ?湲?以?/span>`;
            } else if (group.isActuallyReleased) {
                statusText = `<span style="color:#22c55e;"><i class="fa-solid fa-check-double"></i> ?댁젣 ?꾨즺</span> <span style="color:rgba(255,255,255,0.2);margin:0 5px;">|</span> <span style="color:${isSent ? '#22c55e' : '#94a3b8'};">${pushResult}</span>`;
            } else {
                let liveLabel = '諛쒗슚 以?;
                if (group.isLevelChange) {
                    liveLabel = `${group.level}濡?${group.statusType}`;
                }
                statusText = `<span style="color:#ef4444;"><i class="fa-solid fa-satellite-dish"></i> ${liveLabel}</span> <span style="color:rgba(255,255,255,0.2);margin:0 5px;">|</span> <span style="color:${isSent ? '#22c55e' : '#94a3b8'};">${pushResult}</span>`;
            }
        } else if (tabId === 'release') {
            if (group.isWaiting) {
                statusText = `<span style="color:#10b981;"><i class="fa-solid fa-clock"></i> ?댁젣 ?덉젙</span>`;
            } else {
                statusText = `<span style="color:#22c55e;"><i class="fa-solid fa-check-double"></i> ?댁젣 ?꾨즺</span> <span style="color:rgba(255,255,255,0.2);margin:0 5px;">|</span> <span style="color:${isSent ? '#22c55e' : '#94a3b8'};">${pushResult}</span>`;
            }
        } else if (tabId === 'publish') {
            if (group.isActuallyActive) {
                statusText = `<span style="color:#22c55e;">諛쒗슚 ?꾨즺</span> <span style="color:rgba(255,255,255,0.2);margin:0 5px;">|</span> <span style="color:${isSent ? '#22c55e' : '#94a3b8'};">${pushResult}</span>`;
            } else {
                statusText = isSent
                    ? `<span style="color:#22c55e;"><i class="fa-solid fa-check"></i> ?섎룞 諛쒖넚?꾨즺</span>`
                    : `<span style="color:#94a3b8;"><i class="fa-solid fa-hourglass-half"></i> 諛쒖넚 ?湲?/span>`;
            }
        } else {
            statusText = isSent ? '?섎룞 諛쒖넚?꾨즺' : '諛쒖넚 ?湲?;
        }

        const statusBadge = `<div style="font-size:0.75rem;font-weight:700;display:flex;align-items:center;">${statusText}</div>`;

        let displayLevel = group.level || '';
        if (displayLevel === '?덈퉬' && (tabId === 'active' || tabId === 'release' || tabId === 'level')) {
            displayLevel = '二쇱쓽蹂?;
        }

        let tabSymbol = '?뵒'; let tabLabel = '諛쒗몴';
        if (tabId === 'active') { tabSymbol = '?좑툘'; tabLabel = '諛쒗슚'; }
        else if (tabId === 'release') { tabSymbol = '??; tabLabel = '?댁젣'; }
        else if (tabId === 'level') {
            const isUp = (group.level || '').includes('寃쎈낫');
            tabSymbol = isUp ? '?뵼' : '?뵽'; tabLabel = isUp ? '寃⑹긽' : '寃⑺븯';
            if (group.typeName.includes('?쒗뭾')) tabSymbol = '??';
        } else if (group.isPreliminary) { tabSymbol = '?윝'; tabLabel = '?덈퉬'; }

        const fullTitle = `${group.typeName}${displayLevel}`;
        const displayLabelText = (fullTitle.includes(tabLabel) || (tabLabel === '諛쒗몴' && group.isPreliminary)) ? '' : tabLabel;

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
                            寃⑹긽/寃⑺븯 ??뿉??愿由?
                        </div>
                      ` : `
                        <button onclick="window.sendManualPushFromGroup('${group.key}', '${tabId}')" 
                                style="background:#ef4444;color:#fff;border:none;padding:5px 12px;border-radius:6px;font-size:0.75rem;font-weight:800;cursor:pointer;">
                            ${isSent ? '?섎룞 諛쒖넚?꾨즺' : '?몄떆 諛쒖넚'}
                        </button>
                    `}
                </div>
                <div style="padding:16px;">
                    <div style="font-size:1.05rem;color:#fff;font-weight:800;margin-bottom:15px;display:flex;align-items:center;gap:8px;">
                        ${tabSymbol} ${fullTitle} ${displayLabelText}
                    </div>
                    ${(() => {
                // [?댁젣] ??씤 寃쎌슦: 紐⑤뱺 subGroups???댁뿭???섎굹濡??⑹퀜??媛꾨떒???몄텧
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
                                        ????곹빐??${allZones.length}): <span style="font-weight:400;color:#94a3b8;">${allZones.join(', ')}</span>
                                    </div>
                                </div>
                            `;
                }

                // [洹?????: 湲곗〈 subGroup蹂??뚮뜑留??좎?
                return Object.values(group.subGroups).map(sub => {
                    const efTime = typeof formatDate === 'function' ? formatDate(sub.tmEf) : sub.tmEf;
                    const edTime = typeof formatDate === 'function' ? formatDate(sub.tmEd) : (sub.tmEd || '?뺣낫 ?놁쓬');
                    const uniqueZones = Array.from(new Set(sub.zones));
                    const zoneList = uniqueZones.join(', ');
                    const zoneCount = uniqueZones.length;
                    const showEf = !(tabId === 'active' && group.isActuallyActive);

                    return `
                                <div style="line-height:1.6; margin-bottom: 12px;">
                                    <div style="color:#e2e8f0;font-size:0.85rem;font-weight:600;margin-bottom:4px;">
                                        ????곹빐??${zoneCount}): <span style="font-weight:400;color:#94a3b8;">${zoneList}</span>
                                    </div>
                                    <div style="font-size:0.8rem;color:#64748b;padding-left:15px;display:flex;flex-direction:column;gap:2px;">
                                        ${showEf ? `<span>- 諛쒗슚?덉젙: <span style="color:#cbd5e1;">${efTime}</span></span>` : ''}
                                        <span>- ?댁젣?덉젙: <span style="color:#cbd5e1;">${edTime}</span></span>
                                    </div>
                                </div>
                            `;
                }).join('');
            })()}
                </div>
            </div>
        `;
    });
    // [異붽?] 以묒슂! ?섎룞 諛쒖넚???꾪빐 cardGroups ?곗씠?곕? ?꾩뿭?????(sendManualPushFromGroup ?먯꽌 ?ъ슜)
    window._currentAdminCardGroups = cardGroups;

    container.innerHTML = html;
};

// [?섎룞 諛쒖넚 ?몃뱾??
window.sendManualPushFromGroup = async function (groupKey, tabId) {
    if (!confirm('?대떦 洹몃９???쒕굹由ъ삤 硫붿떆吏瑜??뺣쭚 ?섎룞?쇰줈 諛쒖넚?섏떆寃좎뒿?덇퉴?')) return;

    // 1. 洹몃９ ?뺣낫 議고쉶
    const groups = window._currentAdminCardGroups;
    if (!groups || !groups[groupKey]) {
        return alert('?ㅻ쪟: 洹몃９ ?뺣낫瑜?李얠쓣 ???놁뒿?덈떎. ?섏씠吏瑜??덈줈怨좎묠 ?댁＜?몄슂.');
    }
    const group = groups[groupKey];

    // 2. ?곗씠???섏씠濡쒕뱶 援ъ꽦 (?쒕쾭?먯꽌 ?ъ슜?먮퀎 ?꾪꽣留????띿뒪???앹꽦)
    // ?띿뒪???앹꽦 濡쒖쭅(?대씪?댁뼵??? ?쒓굅?섍퀬, ?먮낯 ?곗씠?곕쭔 援ъ“?뷀븯???꾩넚??

    const typeName = group.typeName; // ?? ?띾옉, ?쒗뭾
    const level = group.level || ''; // ?? 二쇱쓽蹂? 寃쎈낫

    // items 諛곗뿴 ?앹꽦: { zones: [], tmEf: '', tmEd: '', tmYn: '' }
    const items = Object.values(group.subGroups).map(sub => ({
        zones: sub.zones, // 諛곗뿴 洹몃?濡??꾩넚
        tmFc: group.headerTime?.replace(/[^0-9]/g, '') || '', // 諛쒗몴?쒓컖
        tmEf: sub.tmEf,
        tmEd: sub.tmEd,
        tmYn: sub.tmEd // ?쒕쾭 臾멸뎄 ?앹꽦湲곗뿉???ъ슜?섎뒗 ?꾨뱶紐??댁젣?덉젙)?쇰줈???꾩넚
    }));

    // 3. 諛쒖넚 ?붿껌 (Custom Push API)
    try {
        // 濡쒕뵫 ?쒖떆
        const btn = document.activeElement;
        const originalText = btn ? btn.innerText : '';
        if (btn) btn.innerText = '?꾩넚 以?..';

        const res = await fetch('/api/push-custom', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                isManualGroupSend: true,
                payload: {
                    templateId: tabId, // active, release, level, publish
                    typeName: typeName,
                    level: level,
                    items: items
                }
            })
        });

        if (res.ok) {
            alert('?깃났?곸쑝濡?諛쒖넚 ?붿껌?섏뿀?듬땲??');
            // UI 媛깆떊 (?대떦 ???ㅼ떆 濡쒕뱶)
            window.switchAlertAdminTab(tabId);
        } else {
            const err = await res.text();
            alert('諛쒖넚 ?ㅽ뙣: ' + err);
            if (btn) btn.innerText = originalText;
        }
    } catch (e) {
        alert('?ㅽ듃?뚰겕 ?ㅻ쪟: ' + e.message);
        const btn = document.activeElement;
        if (btn) btn.innerText = originalText;
    }
};

window.renderCustomPushTab = async function (container) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> 濡쒕뵫 以?..</div>';

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
            const mainName = typeof getMainRegion === 'function' ? getMainRegion(subName) : '湲고?';
            if (!regions[mainName]) regions[mainName] = {};
            regions[mainName][subName] = zones;
        }
    }

    let accordionHtml = '';
    Object.entries(regions).forEach(([main, subs], mainIdx) => {
        const isJeju = main.includes('?쒖＜');

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
                        <!-- ?쒖＜ ?뱁솕: 以묐텇瑜??놁씠 諛붾줈 ?뚰빐援?紐⑸줉 -->
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
                <i class="fa-solid fa-envelope"></i> 而ㅼ뒪? ?뚮┝ 諛쒖넚
            </div>
            
            <div style="margin-bottom:15px;">
                <label style="display:block;color:#94a3b8;font-size:0.85rem;margin-bottom:10px;">諛쒖넚 ????댁뿭 ?좏깮 (Hierarchy)</label>
                <div style="background:rgba(0,0,0,0.3);padding:15px;border-radius:12px;max-height:350px;overflow-y:auto;border:1px solid rgba(255,255,255,0.05);">
                    <div style="margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;gap:10px;">
                        <input type="checkbox" id="check-all-zones" onchange="window.toggleAllZones(this.checked)" 
                               style="width:18px;height:18px;cursor:pointer;">
                        <label for="check-all-zones" style="cursor:pointer;font-size:0.9rem;color:#fff;font-weight:700;">?꾩껜 ?댁뿭 ?좏깮</label>
                    </div>
                    ${accordionHtml}
                </div>
            </div>

            <div style="margin-bottom:15px;">
                <label style="display:block;color:#94a3b8;font-size:0.85rem;margin-bottom:6px;">?뚮┝ ?쒕ぉ</label>
                <input type="text" id="custom-push-title" placeholder="?? ?뙄 湲닿툒 ?댁뼇 ?덉쟾 ?덈궡" 
                       oninput="window.updateCustomPushPreview()"
                       style="width:100%;padding:12px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;box-sizing:border-box;outline:none;">
            </div>

            <div style="margin-bottom:15px;">
                <label style="display:block;color:#94a3b8;font-size:0.85rem;margin-bottom:6px;">?뚮┝ ?댁슜</label>
                <textarea id="custom-push-content" placeholder="吏곸젒 ?묒꽦?섏떎 ?뚮┝ ?댁슜???낅젰?댁＜?몄슂." 
                          oninput="window.updateCustomPushPreview()"
                          style="width:100%;height:100px;padding:12px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;resize:none;box-sizing:border-box;outline:none;line-height:1.4;"></textarea>
                <div style="text-align:right;font-size:0.75rem;color:#64748b;margin-top:4px;" id="custom-push-char-count">0 / 500??/div>
            </div>

            <!-- 誘몃━蹂닿린 (Fixed Layout) -->
            <div style="background:rgba(0,0,0,0.3);padding:20px;border-radius:16px;margin-bottom:20px;border:1px solid rgba(255,255,255,0.05);">
                <div style="font-size:0.8rem;color:#94a3b8;margin-bottom:12px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Smartphone Preview</div>
                <div style="background:#fff;border-radius:20px;padding:16px;box-shadow:0 10px 25px rgba(0,0,0,0.3);position:relative;">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                        <div style="width:28px;height:28px;background:#1e293b;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:0.75rem;">?뙄</div>
                        <div style="font-weight:800;color:#1e293b;font-size:0.95rem;flex:1;">SEA:GNAL</div>
                        <div style="font-size:0.75rem;color:#94a3b8;">吏湲?/div>
                    </div>
                    <div id="preview-title" style="font-weight:800;margin-bottom:4px;color:#000;font-size:1.05rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">(?쒕ぉ 誘몃━蹂닿린)</div>
                    <div id="preview-content" style="color:#475569;font-size:1rem;line-height:1.4;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;">(?댁슜 誘몃━蹂닿린)</div>
                </div>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;">
                <div style="font-size:0.95rem;color:#cbd5e1;">諛쒖넚 ??? <span style="font-weight:800;color:#3b82f6;" id="target-zone-count">0</span>媛?援ъ뿭</div>
                <div style="display:flex;gap:12px;">
                    <button onclick="window.switchAlertAdminTab('custom')" style="padding:12px 20px;background:rgba(255,255,255,0.08);border:none;border-radius:10px;color:#cbd5e1;cursor:pointer;font-weight:600;">珥덇린??/button>
                    <button onclick="window.confirmCustomPush()" style="padding:12px 28px;background:linear-gradient(135deg,#ef4444,#b91c1c);border:none;border-radius:10px;color:#fff;font-weight:700;cursor:pointer;box-shadow:0 10px 20px rgba(239,68,68,0.3);">?몄떆 諛쒖넚?섍린</button>
                </div>
            </div>
            
            <!-- Custom Confirm Overlay -->
            <div id="custom-push-confirm-overlay" style="display:none;position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:100;border-radius:16px;backdrop-filter:blur(8px);align-items:center;justify-content:center;padding:20px;">
                <div style="background:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:30px;width:100%;max-width:320px;text-align:center;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);">
                    <div style="font-size:3rem;margin-bottom:20px;">?뱼</div>
                    <div style="color:#fff;font-size:1.2rem;font-weight:700;margin-bottom:12px;">?몄떆 諛쒖넚 理쒖쥌 ?뺤씤</div>
                    <div style="color:#94a3b8;font-size:0.9rem;line-height:1.6;margin-bottom:25px;">
                        ?뺣쭚 <span id="confirm-target-text" style="color:#3b82f6;font-weight:700;"></span>?쇰줈<br>?뚮┝??諛쒖넚?섏떆寃좎뒿?덇퉴?
                    </div>
                    <div style="display:flex;gap:10px;">
                        <button onclick="document.getElementById('custom-push-confirm-overlay').style.display='none'" style="flex:1;padding:12px;background:rgba(255,255,255,0.05);border:none;border-radius:10px;color:#cbd5e1;cursor:pointer;font-weight:600;">痍⑥냼</button>
                        <button id="final-send-btn" onclick="window.executeCustomPush()" style="flex:1;padding:12px;background:#ef4444;border:none;border-radius:10px;color:#fff;cursor:pointer;font-weight:700;">吏湲?諛쒖넚</button>
                    </div>
                </div>
            </div>
        </div>
    `;
};

// [History State]
let historyFilter = { cat: 'all', type: 'all' };

window.renderHistoryTab = async function (container) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> 濡쒕뵫 以?..</div>';

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
            { id: 'all', name: '?꾩껜' },
            { id: 'publish', name: '諛쒗몴' },
            { id: 'active', name: '諛쒗슚' },
            { id: 'release', name: '?댁젣' },
            { id: 'level', name: '寃⑹긽/寃⑺븯' },
            { id: 'custom', name: '吏곸젒 諛쒖넚' }
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
                                ${t === 'all' ? '?꾩껜' : (t === 'auto' ? '?먮룞' : '?섎룞')}
                            </label>
                        `).join('')}
                    </div>
                ` : ''}

                <!-- Management Controls -->
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;padding:0 6px;">
                    <div style="display:flex;gap:12px;align-items:center;">
                        <input type="checkbox" id="hist-check-all" onchange="window.toggleAllHistoryChecks(this.checked)" style="width:16px;height:16px;cursor:pointer;">
                        <label for="hist-check-all" style="color:#94a3b8;font-size:0.85rem;cursor:pointer;">?꾩껜 ?좏깮</label>
                    </div>
                    <button onclick="window.deleteSelectedHistory()" style="padding:6px 12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);color:#ef4444;border-radius:6px;font-size:0.8rem;cursor:pointer;font-weight:600;">?좏깮 ??젣</button>
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
                                            ${h.type === 'manual' ? '?뫀 ?섎룞' : '?쨼 ?먮룞'}
                                        </span>
                                        <button onclick="window.deleteSingleHistory(${h.id})" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:0.8rem;"><i class="fa-solid fa-trash-can"></i></button>
                                    </div>
                                </div>
                                <div style="color:#fff;font-weight:700;margin-bottom:4px;font-size:0.95rem;">${h.title}</div>
                                <div style="color:#94a3b8;font-size:0.85rem;line-height:1.4;margin-bottom:8px;">${h.content}</div>
                                <div style="font-size:0.7rem;color:#475569;background:rgba(0,0,0,0.2);padding:6px 10px;border-radius:6px;">
                                    <i class="fa-solid fa-location-dot" style="margin-right:4px;"></i> ??? ${h.target.length > 50 ? h.target.substring(0, 50) + '...' : h.target}
                                </div>
                            </div>
                        </div>
                    `).join('')}
                    ${filtered.length === 0 ? '<div style="text-align:center;padding:50px;color:#64748b;">?대젰???놁뒿?덈떎.</div>' : ''}
                </div>
                
                ${history.length > 0 ? `
                    <div style="text-align:center;margin-top:20px;">
                        <button onclick="window.clearAllHistory()" style="background:none;border:none;color:#64748b;font-size:0.8rem;text-decoration:underline;cursor:pointer;">?꾩껜 ?대젰 珥덇린??/button>
                    </div>
                ` : ''}
            </div>
        `;
        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = `<div style="text-align:center;padding:40px;color:#ef4444;">?ㅻ쪟 諛쒖깮: ${e.message}</div>`;
    }
};

window.updateHistoryFilter = function (key, val) {
    historyFilter[key] = val;
    // If category is custom, type must be manual/all (but custom is always manual)
    if (historyFilter.cat === 'custom') historyFilter.type = 'all';
    window.renderHistoryTab(document.getElementById('alert-management-content'));
};

window.toggleAllHistoryChecks = function (checked) {
    document.querySelectorAll('.hist-item-check').forEach(cb => cb.checked = checked);
};

window.deleteSingleHistory = async function (id) {
    if (!confirm('?대떦 ?대젰????젣?섏떆寃좎뒿?덇퉴?')) return;
    try {
        const res = await fetch(`/api/push-history/${id}`, { method: 'DELETE' });
        if (res.ok) window.renderHistoryTab(document.getElementById('alert-management-content'));
    } catch (e) { alert('??젣 ?ㅽ뙣: ' + e.message); }
};

window.deleteSelectedHistory = async function () {
    const checked = Array.from(document.querySelectorAll('.hist-item-check:checked')).map(cb => parseInt(cb.dataset.id));
    if (checked.length === 0) return alert('??젣????ぉ???좏깮?댁＜?몄슂.');
    if (!confirm(`${checked.length}媛쒖쓽 ??ぉ????젣?섏떆寃좎뒿?덇퉴?`)) return;

    try {
        const res = await fetch('/api/push-history', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: checked })
        });
        if (res.ok) window.renderHistoryTab(document.getElementById('alert-management-content'));
    } catch (e) { alert('??젣 ?ㅽ뙣: ' + e.message); }
};

window.clearAllHistory = async function () {
    if (!confirm('?뺣쭚濡?紐⑤뱺 諛쒖넚 ?대젰???곴뎄?곸쑝濡???젣?섏떆寃좎뒿?덇퉴?\n???묒뾽? ?섎룎由????놁뒿?덈떎.')) return;
    try {
        const res = await fetch('/api/push-history', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
        if (res.ok) window.renderHistoryTab(document.getElementById('alert-management-content'));
    } catch (e) { alert('??젣 ?ㅽ뙣: ' + e.message); }
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

    if (previewTitle) previewTitle.textContent = titleVal || '(?쒕ぉ 誘몃━蹂닿린)';
    if (previewContent) previewContent.textContent = contentVal || '(?댁슜 誘몃━蹂닿린)';
    if (charCount) charCount.textContent = `${contentVal.length} / 500??;
};

window.confirmCustomPush = function () {
    const title = document.getElementById('custom-push-title').value.trim();
    const content = document.getElementById('custom-push-content').value.trim();
    const checked = document.querySelectorAll('.zone-checkbox:checked');
    const allChecked = document.getElementById('check-all-zones').checked;

    if (checked.length === 0 && !allChecked) {
        alert('諛쒖넚 ????댁뿭???좏깮?댁＜?몄슂.');
        return;
    }
    if (!title || !content) {
        alert('?쒕ぉ怨??댁슜???낅젰?댁＜?몄슂.');
        return;
    }

    const targetText = allChecked ? '?꾩껜 ?댁뿭' : `${checked.length}媛??댁뿭`;
    document.getElementById('confirm-target-text').textContent = targetText;
    document.getElementById('custom-push-confirm-overlay').style.display = 'flex';
};

window.executeCustomPush = async function () {
    const title = document.getElementById('custom-push-title').value.trim();
    const content = document.getElementById('custom-push-content').value.trim();
    const checked = document.querySelectorAll('.zone-checkbox:checked');
    const allChecked = document.getElementById('check-all-zones').checked;
    const targetZones = allChecked ? '?꾩껜 ?댁뿭' : Array.from(checked).map(cb => cb.value).join(', ');

    const btn = document.getElementById('final-send-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 諛쒖넚 以?..';

    try {
        const response = await fetch('/api/push-custom', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, content, targetZones })
        });
        const result = await response.json();

        if (result.success) {
            alert(`???몄떆 諛쒖넚 ?꾨즺\n?깃났: ${result.successCount}嫄?/ ?ㅽ뙣: ${result.failCount}嫄?);
            window.switchAlertAdminTab('custom');
        } else {
            alert('??諛쒖넚 ?ㅽ뙣: ' + (result.error || '?????녿뒗 ?ㅻ쪟'));
            document.getElementById('custom-push-confirm-overlay').style.display = 'none';
        }
    } catch (e) {
        alert('???쒕쾭 ?듭떊 ?ㅻ쪟: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = '吏湲?諛쒖넚';
    }
};

// (Redundant declarations removed)


// ============================================================================
// [신규] 방문객 카운터 UI 업데이트
// ============================================================================
window.updateVisitorStats = async function() {
    try {
        const response = await fetch('/api/visit');
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();
        
        const todayEl = document.getElementById('today-count');
        const totalEl = document.getElementById('total-count');
        
        if (todayEl) todayEl.textContent = data.today.toLocaleString();
        if (totalEl) totalEl.textContent = data.total.toLocaleString();
    } catch (e) {
        console.error('Failed to update visitor stats:', e);
    }
};
