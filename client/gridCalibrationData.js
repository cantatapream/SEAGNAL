// 경도/위도 격자 캘리브레이션 데이터
// GPS 좌표 → 픽셀 좌표 변환용
// 경도(X): 43개, 위도(Y): 42개
// 이미지 크기: 2225 x 2659

const GRID_CALIBRATION_DATA = {
    "lon": {
        "119": 72,
        "119.5": 122,
        "120": 172,
        "120.5": 222,
        "121": 271,
        "121.5": 321,
        "122": 371,
        "122.5": 420,
        "123": 470,
        "123.5": 520,
        "124": 569,
        "124.5": 619,
        "125": 669,
        "125.5": 719,
        "126": 768,
        "126.5": 818,
        "127": 868,
        "127.5": 917,
        "128": 966,
        "128.5": 1016,
        "129": 1066,
        "129.5": 1116,
        "130": 1166,
        "130.5": 1215,
        "131": 1265,
        "131.5": 1314,
        "132": 1364,
        "132.5": 1414,
        "133": 1464,
        "133.5": 1514,
        "134": 1563,
        "134.5": 1613,
        "135": 1663,
        "135.5": 1713,
        "136": 1762,
        "136.5": 1812,
        "137": 1862,
        "137.5": 1911,
        "138": 1961,
        "138.5": 2011,
        "139": 2060,
        "139.5": 2110,
        "140": 2159
    },
    "lat": {
        "24.5": 2568,
        "25": 2514,
        "25.5": 2459,
        "26": 2405,
        "26.5": 2350,
        "27": 2295,
        "27.5": 2238,
        "28": 2183,
        "28.5": 2127,
        "29": 2070,
        "29.5": 2013,
        "30": 1956,
        "30.5": 1899,
        "31": 1842,
        "31.5": 1784,
        "32": 1726,
        "32.5": 1667,
        "33": 1608,
        "33.5": 1549,
        "34": 1491,
        "34.5": 1430,
        "35": 1370,
        "35.5": 1309,
        "36": 1249,
        "36.5": 1187,
        "37": 1125,
        "37.5": 1064,
        "38": 1000,
        "38.5": 938,
        "39": 874,
        "39.5": 811,
        "40": 745,
        "40.5": 681,
        "41": 615,
        "41.5": 549,
        "42": 483,
        "42.5": 417,
        "43": 349,
        "43.5": 281,
        "44": 212,
        "44.5": 143,
        "45": 73
    }
};

/**
 * GPS 좌표(경도, 위도)를 이미지 픽셀 좌표로 변환
 * @param {number} lon - 경도 (예: 126.5)
 * @param {number} lat - 위도 (예: 35.2)
 * @returns {{x: number, y: number}} 픽셀 좌표
 */
function gpsToPixel(lon, lat) {
    // 경도 → X 픽셀
    const lonKeys = Object.keys(GRID_CALIBRATION_DATA.lon)
        .map(k => parseFloat(k))
        .sort((a, b) => a - b);

    let x = 0;
    for (let i = 0; i < lonKeys.length - 1; i++) {
        if (lon >= lonKeys[i] && lon <= lonKeys[i + 1]) {
            const x1 = GRID_CALIBRATION_DATA.lon[lonKeys[i]];
            const x2 = GRID_CALIBRATION_DATA.lon[lonKeys[i + 1]];
            const ratio = (lon - lonKeys[i]) / (lonKeys[i + 1] - lonKeys[i]);
            x = x1 + (x2 - x1) * ratio;
            break;
        }
    }

    // 위도 → Y 픽셀
    const latKeys = Object.keys(GRID_CALIBRATION_DATA.lat)
        .map(k => parseFloat(k))
        .sort((a, b) => a - b);

    let y = 0;
    for (let i = 0; i < latKeys.length - 1; i++) {
        if (lat >= latKeys[i] && lat <= latKeys[i + 1]) {
            const y1 = GRID_CALIBRATION_DATA.lat[latKeys[i]];
            const y2 = GRID_CALIBRATION_DATA.lat[latKeys[i + 1]];
            const ratio = (lat - latKeys[i]) / (latKeys[i + 1] - latKeys[i]);
            y = y1 + (y2 - y1) * ratio;
            break;
        }
    }

    return { x: Math.round(x), y: Math.round(y) };
}

/**
 * GPS 좌표로 해구 번호 조회
 * @param {number} lon - 경도
 * @param {number} lat - 위도
 * @returns {string|null} 해구 번호 또는 null
 */
function getSeaZoneByGPS(lon, lat) {
    const pixel = gpsToPixel(lon, lat);

    // GRID_DATA와 SEA_ZONES_DATA를 사용하여 해구 번호 찾기
    // seaZones.js의 getGridKeyByPixel 함수와 유사한 로직
    if (typeof GRID_DATA !== 'undefined' && typeof SEA_ZONES_DATA !== 'undefined') {
        // 경도 범위 찾기
        const lonKeys = Object.keys(GRID_DATA.lon).map(Number).sort((a, b) => a - b);
        let lonStart = null, lonEnd = null;
        for (let i = 0; i < lonKeys.length - 1; i++) {
            const x1 = GRID_DATA.lon[lonKeys[i]].val;
            const x2 = GRID_DATA.lon[lonKeys[i + 1]].val;
            if (pixel.x >= x1 && pixel.x < x2) {
                lonStart = lonKeys[i];
                lonEnd = lonKeys[i + 1];
                break;
            }
        }

        // 위도 범위 찾기
        const latKeys = Object.keys(GRID_DATA.lat).map(Number).sort((a, b) => a - b);
        let latStart = null, latEnd = null;
        for (let i = 0; i < latKeys.length - 1; i++) {
            const y1 = GRID_DATA.lat[latKeys[i]].val;
            const y2 = GRID_DATA.lat[latKeys[i + 1]].val;
            if (pixel.y >= y1 && pixel.y < y2) {
                latStart = latKeys[i];
                latEnd = latKeys[i + 1];
                break;
            }
        }

        if (lonStart && latStart) {
            const gridKey = `${lonStart}-${lonEnd}_${latStart}-${latEnd}`;
            return SEA_ZONES_DATA[gridKey] || null;
        }
    }

    return null;
}
