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
const fetch = require('node-fetch');
const { DATA_DIR } = require('../config/server_config');

// ============================================================================
// 한국 해양 서비스 커버리지 + zone_coords 캐시
// ============================================================================

/**
 * 한국 해역 서비스 범위 (한국 EEZ 대략 기준)
 * 이 범위를 벗어나면 파고·바람 데이터를 제공하지 않음 (일본 연안 등 제외)
 */
const KOREA_SEA = { minLat: 32.0, maxLat: 42.0, minLon: 122.0, maxLon: 132.5 };

/**
 * zone_coords.json 캐시 (요청마다 파일 읽기 방지)
 * { '1': { lat, lon }, '2': { lat, lon }, ... }
 */
let _zoneCoordsCache = null;
function getZoneCoords() {
    if (_zoneCoordsCache !== null) return _zoneCoordsCache;
    try {
        const p = path.join(__dirname, '..', 'zone_coords.json');
        _zoneCoordsCache = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
    } catch (e) { _zoneCoordsCache = {}; }
    return _zoneCoordsCache;
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

        // zone_forecasts.json 읽기
        const filePath = path.join(DATA_DIR, 'zone_forecasts.json');
        if (!fs.existsSync(filePath)) {
            return res.json({ success: false, error: '해구별 기상전망 데이터가 아직 수집되지 않았습니다.' });
        }
        const zoneData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        // zone_coords.json 기준 최단거리 소해구 선택
        // (오버레이와 동일한 해구를 사용하여 색상-바텀시트 값 일치)
        const zoneCoords = getZoneCoords();
        let lzone = null, minZoneDist = Infinity;
        for (const zoneId of Object.keys(zoneData.data || {})) {
            const c = zoneCoords[zoneId];
            if (!c) continue;
            const dist = (lat - c.lat) ** 2 + (lon - c.lon) ** 2;
            if (dist < minZoneDist) { minZoneDist = dist; lzone = zoneId; }
        }

        if (!lzone) {
            return res.json({ success: false, error: '해당 위치의 파고 데이터가 없습니다.' });
        }

        const zoneItems = zoneData.data[lzone];
        if (!zoneItems || zoneItems.length === 0) {
            return res.json({ success: false, error: '해당 해구의 파고 데이터가 없습니다.' });
        }

        // 선택된 시각 기준으로 예측 데이터 선택 (time 파라미터 없으면 현재 시각)
        const now = req.query.time ? new Date(req.query.time) : new Date();
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

        // 6시간 초과: 해당 시각에 유효한 예보 없음 → 카드 숨김 트리거
        if (minDiff > 6 * 3600 * 1000) {
            return res.json({ success: false, error: '해당 시각의 파고 예보 데이터가 없습니다.' });
        }

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
// API: 전 해구 예보 데이터 (오버레이용)
// ============================================================================

/**
 * GET /api/ocean/zone-forecasts
 *
 * 모든 소해구의 파고·바람 예보를 반환합니다.
 * ocean_overlay.js의 바람/파고 오버레이 시각화에 사용됩니다.
 * zone_coords.json의 소해구 좌표를 함께 반환하여 정확한 위치에 표출합니다.
 *
 * [요청 파라미터]
 * - time (선택): ISO 날짜 문자열. 없으면 현재 시각 기준.
 */
router.get('/api/ocean/zone-forecasts', (req, res) => {
    try {
        const filePath = path.join(DATA_DIR, 'zone_forecasts.json');
        if (!fs.existsSync(filePath)) {
            return res.json({ success: false, error: '해구별 기상전망 데이터가 없습니다.' });
        }

        // 소해구 좌표 로드 (캐시 활용)
        const coordsMap = getZoneCoords();

        const zoneData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const targetTime = req.query.time ? new Date(req.query.time) : new Date();

        const result = {};
        Object.keys(zoneData.data).forEach(lzone => {
            const items = zoneData.data[lzone];
            if (!items || items.length === 0) return;

            const coords = coordsMap[lzone];
            if (!coords) return; // 좌표 없는 해구 제외

            let closest = items[0], minDiff = Infinity;
            items.forEach(item => {
                const s = String(item.tm);
                const predTime = new Date(Date.UTC(
                    parseInt(s.substring(0, 4)), parseInt(s.substring(4, 6)) - 1,
                    parseInt(s.substring(6, 8)), parseInt(s.substring(8, 10))
                ));
                const diff = Math.abs(predTime.getTime() - targetTime.getTime());
                if (diff < minDiff) { minDiff = diff; closest = item; }
            });

            // -999는 KMA 결측값 → 제외 (양쪽 모두 유효해야 포함)
            const wh = closest.wh;
            const ws = closest.ws;
            if (wh == null || wh < 0) return;
            if (ws == null || ws < 0) return;

            const entry = {
                wh: wh,
                wp: (closest.wp != null && closest.wp >= 0) ? closest.wp : null,
                waveDir: closest.waveDir || 0,
                ws: ws,
                windDir: closest.windDir || 0,
                tm: String(closest.tm)
            };
            // 신규 포맷: lat/lon 직접 포함
            if (coords.lat != null && coords.lon != null) {
                entry.lat = coords.lat;
                entry.lon = coords.lon;
            } else if (coords.bounds) {
                entry.bounds = coords.bounds;
            }
            result[lzone] = entry;
        });

        // 슬라이더 최대값: 전 해구 중 가장 늦은 예보 시각 기준으로 남은 시간 계산
        // zone_forecasts 데이터는 3시간 간격이므로 3h 단위로 내림
        let maxForecastHours = 72;
        try {
            let maxDataMs = 0;
            Object.keys(zoneData.data).forEach(lzone => {
                const items = zoneData.data[lzone];
                if (!items || items.length === 0) return;
                const lastItem = items[items.length - 1];
                const s = String(lastItem.tm);
                const predTime = new Date(Date.UTC(
                    parseInt(s.substring(0, 4)), parseInt(s.substring(4, 6)) - 1,
                    parseInt(s.substring(6, 8)), parseInt(s.substring(8, 10))
                ));
                if (predTime.getTime() > maxDataMs) maxDataMs = predTime.getTime();
            });
            if (maxDataMs > 0) {
                const diffMs = maxDataMs - Date.now();
                const raw = Math.floor(diffMs / 3600000 / 3) * 3; // 3h 내림
                maxForecastHours = Math.max(0, Math.min(75, raw));
            }
        } catch (e) { /* 계산 실패 시 기본값 72 유지 */ }

        res.json({ success: true, zones: result, maxForecastHours: maxForecastHours });
    } catch (e) {
        console.error('[Ocean] zone-forecasts 오류:', e.message);
        res.status(500).json({ success: false, error: '데이터 조회 오류' });
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
