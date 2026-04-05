/**
 * ============================================================================
 * 파일명: routes/ocean4.js
 * 역할: 파고 데이터 API + 종합 해양 데이터 API
 * ============================================================================
 *
 * [설명]
 * 1) 파고 데이터: scheduler.js가 수집한 해구별 기상전망(zone_forecasts.json)에서
 *    특정 좌표에 해당하는 해구의 파고·파주기 데이터를 제공합니다.
 * 2) 종합 API: 수심, ROMS, 기상, 파고를 한 번에 병렬 호출하여 반환합니다.
 *
 * - GET /api/ocean/wave → 특정 좌표의 파고·파주기 조회
 * - GET /api/ocean/all  → 수심+ROMS+기상+파고 종합 데이터
 *
 * [연계 파일]
 * - ocean1.js → 이 파일을 router.use()로 연결
 * - data/zone_forecasts.json → 해구별 기상전망 캐시 데이터
 * - scheduler.js → zone_forecasts.json 생성 (해구별 예보 수집)
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/server_config');

// ============================================================================
// 해구 격자 매핑 (좌표 → 해구번호)
// ============================================================================

/**
 * 한반도 주변 해구(해상 예보 구역) 격자 정의
 *
 * 기상청 해구도를 기반으로 대략적인 경위도 범위를 매핑.
 * 좌표 → 해구번호로 변환하여 zone_forecasts.json에서 데이터를 조회.
 *
 * lzone: 해구 번호 (zone_forecasts.json의 키)
 * 범위: [위도하한, 위도상한, 경도하한, 경도상한]
 */
const SEA_ZONES = [
    // 서해 (Yellow Sea)
    { lzone: '474', bounds: [36.0, 38.0, 124.0, 126.0] },  // 서해 북부
    { lzone: '472', bounds: [34.5, 36.0, 124.0, 126.0] },  // 서해 중부
    { lzone: '471', bounds: [33.0, 34.5, 124.0, 126.0] },  // 서해 남부
    // 남해 (South Sea)
    { lzone: '480', bounds: [33.0, 34.5, 126.0, 128.0] },  // 남해 서부
    { lzone: '482', bounds: [33.0, 34.5, 128.0, 130.0] },  // 남해 동부
    // 동해 (East Sea)
    { lzone: '484', bounds: [34.5, 36.5, 129.0, 132.0] },  // 동해 남부
    { lzone: '486', bounds: [36.5, 38.5, 129.0, 132.0] },  // 동해 중부
    { lzone: '488', bounds: [38.5, 40.0, 128.0, 132.0] },  // 동해 북부
    // 제주 (Jeju)
    { lzone: '478', bounds: [32.0, 33.5, 125.0, 127.5] },  // 제주 해역
];

/**
 * 좌표로부터 가장 가까운 해구를 찾는 함수
 * 좌표가 해구 범위 안에 있으면 해당 해구 반환.
 * 범위 밖이면 중심점 거리가 가장 가까운 해구 반환.
 */
function findZoneByCoord(lat, lon) {
    // 범위 내 해구 우선 탐색
    for (const zone of SEA_ZONES) {
        const [ymin, ymax, xmin, xmax] = zone.bounds;
        if (lat >= ymin && lat <= ymax && lon >= xmin && lon <= xmax) {
            return zone.lzone;
        }
    }

    // 범위 밖이면 가장 가까운 해구 반환
    let closest = SEA_ZONES[0].lzone;
    let minDist = Infinity;
    for (const zone of SEA_ZONES) {
        const [ymin, ymax, xmin, xmax] = zone.bounds;
        const centerLat = (ymin + ymax) / 2;
        const centerLon = (xmin + xmax) / 2;
        const dist = Math.pow(lat - centerLat, 2) + Math.pow(lon - centerLon, 2);
        if (dist < minDist) {
            minDist = dist;
            closest = zone.lzone;
        }
    }
    return closest;
}

// ============================================================================
// API: 파고 데이터 조회
// ============================================================================

/**
 * GET /api/ocean/wave
 *
 * 특정 좌표의 파고·파주기를 조회합니다.
 *
 * [동작 흐름]
 * 1. 클릭 좌표(lat, lon)로 해당 해구번호 결정
 * 2. zone_forecasts.json에서 해당 해구 데이터 조회
 * 3. 현재 시각에 가장 가까운 예측 데이터 선택
 * 4. 유의파고(m), 최대파주기(s), 풍속(m/s), 풍향(도) 반환
 *
 * [요청 파라미터]
 * - lat (필수): 위도
 * - lon (필수): 경도
 *
 * [응답 예시]
 * {
 *   success: true,
 *   waveHeight: 1.2,    // 유의파고 (m)
 *   wavePeriod: 6.5,    // 최대파주기 (s)
 *   waveDir: 180,       // 파향 (도)
 *   windSpeed: 5.4,     // 풍속 (m/s)
 *   windDir: 270,       // 풍향 (도)
 *   zone: "480",
 *   forecastTime: "2026040512"
 * }
 */
router.get('/api/ocean/wave', (req, res) => {
    try {
        const lat = parseFloat(req.query.lat);
        const lon = parseFloat(req.query.lon);

        if (isNaN(lat) || isNaN(lon)) {
            return res.status(400).json({ success: false, error: '위도(lat)와 경도(lon)를 입력해주세요.' });
        }

        // 좌표 → 해구번호 변환
        const lzone = findZoneByCoord(lat, lon);

        // zone_forecasts.json 읽기
        const filePath = path.join(DATA_DIR, 'zone_forecasts.json');
        if (!fs.existsSync(filePath)) {
            return res.json({ success: false, error: '해구별 기상전망 데이터가 아직 수집되지 않았습니다.' });
        }

        const zoneData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const zoneItems = zoneData.data?.[lzone];

        if (!zoneItems || zoneItems.length === 0) {
            return res.json({ success: false, error: `해구 ${lzone}의 파고 데이터가 없습니다.` });
        }

        // 현재 시각에 가장 가까운 예측 데이터 선택
        const now = new Date();
        let closest = zoneItems[0];
        let minDiff = Infinity;

        zoneItems.forEach(item => {
            // tm 형식: "2026040512" (UTC) 또는 YYYYMMDDHHmm
            const tmStr = String(item.tm);
            const year = parseInt(tmStr.substring(0, 4));
            const month = parseInt(tmStr.substring(4, 6)) - 1;
            const day = parseInt(tmStr.substring(6, 8));
            const hour = parseInt(tmStr.substring(8, 10));
            const predTime = new Date(Date.UTC(year, month, day, hour));
            const diff = Math.abs(predTime.getTime() - now.getTime());
            if (diff < minDiff) {
                minDiff = diff;
                closest = item;
            }
        });

        res.json({
            success: true,
            waveHeight: closest.wh,
            wavePeriod: closest.wp,
            waveDir: closest.waveDir,
            windSpeed: closest.ws,
            windDir: closest.windDir,
            zone: lzone,
            forecastTime: String(closest.tm)
        });

    } catch (e) {
        console.error('[Ocean] 파고 조회 오류:', e.message);
        res.status(500).json({ success: false, error: '파고 데이터 조회 중 오류가 발생했습니다.' });
    }
});

// ============================================================================
// API: 종합 해양 데이터 (병렬 호출)
// ============================================================================

/**
 * GET /api/ocean/all
 *
 * 수심 + ROMS + 기상 + 파고를 한 번에 병렬 호출합니다.
 * 바텀시트에서 사용: 각 API를 개별 호출하는 대신 서버에서 모아서 반환.
 *
 * [요청 파라미터]
 * - lat (필수): 위도
 * - lon (필수): 경도
 *
 * [응답 예시]
 * {
 *   success: true,
 *   depth: { success: true, depth: 45.2, ... },
 *   roms: { success: true, crdir: 309, crsp: 0.95, wtem: 12.9, ... },
 *   weather: { success: true, windDir: 270, windSpeed: 5.2, ... },
 *   wave: { success: true, waveHeight: 1.2, ... }
 * }
 */
router.get('/api/ocean/all', async (req, res) => {
    try {
        const lat = req.query.lat;
        const lon = req.query.lon;

        if (!lat || !lon) {
            return res.status(400).json({ success: false, error: '위도(lat)와 경도(lon)를 입력해주세요.' });
        }

        // 서버 내부에서 자기 자신의 API를 호출 (localhost)
        // → 각 API의 로직을 중복하지 않고 재사용
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const query = `lat=${lat}&lon=${lon}`;

        const [depthRes, romsRes, weatherRes, waveRes] = await Promise.allSettled([
            fetchInternal(`${baseUrl}/api/ocean/depth?${query}`),
            fetchInternal(`${baseUrl}/api/ocean/roms?${query}`),
            fetchInternal(`${baseUrl}/api/ocean/weather?${query}`),
            fetchInternal(`${baseUrl}/api/ocean/wave?${query}`)
        ]);

        res.json({
            success: true,
            depth: depthRes.status === 'fulfilled' ? depthRes.value : { success: false, error: '수심 조회 실패' },
            roms: romsRes.status === 'fulfilled' ? romsRes.value : { success: false, error: 'ROMS 조회 실패' },
            weather: weatherRes.status === 'fulfilled' ? weatherRes.value : { success: false, error: '기상 조회 실패' },
            wave: waveRes.status === 'fulfilled' ? waveRes.value : { success: false, error: '파고 조회 실패' }
        });

    } catch (e) {
        console.error('[Ocean] 종합 데이터 조회 오류:', e.message);
        res.status(500).json({ success: false, error: '종합 데이터 조회 중 오류가 발생했습니다.' });
    }
});

/**
 * 내부 API 호출 헬퍼
 * localhost의 다른 엔드포인트를 호출하여 JSON 결과를 반환
 */
async function fetchInternal(url) {
    const response = await fetch(url);
    return response.json();
}

module.exports = router;
