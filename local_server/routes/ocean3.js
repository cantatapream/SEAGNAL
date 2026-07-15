/**
 * ============================================================================
 * 파일명: routes/ocean3.js
 * 역할: 기상청 융합기상 API (풍향·풍속·기온·강수)
 * ============================================================================
 *
 * [설명]
 * 기상청 API Hub의 융합기상실황(지상) 데이터를 호출하여
 * 특정 좌표의 풍향, 풍속, 기온, 강수유무를 제공합니다.
 * 해양 위 임의 좌표에서도 보간된 기상 데이터를 얻을 수 있습니다.
 *
 * - GET /api/ocean/weather → 특정 좌표의 풍향·풍속·기온·강수 조회
 *
 * [외부 API]
 * 엔드포인트: https://apihub.kma.go.kr/api/typ01/url/sfc_nc_var.php
 * 인증키: api_config.json의 KMA_HUB_KEY
 * 응답형식: CSV (텍스트)
 *
 * [연계 파일]
 * - ocean1.js → 이 파일을 router.use()로 연결
 * - data/api_config.json → KMA API 인증키
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { DATA_DIR } = require('../config/server_config');

// 기상청 융합기상실황 API URL
const KMA_SFC_URL = 'https://apihub.kma.go.kr/api/typ01/url/sfc_nc_var.php';

// ============================================================================
// 한국 해역 서비스 커버리지 + zone_coords 캐시 (ocean4.js와 동일 방식)
// ============================================================================
const KOREA_SEA3 = { minLat: 32.0, maxLat: 42.0, minLon: 122.0, maxLon: 132.5 };

let _zoneCoordsCache3 = null;
/**
 * zone_coords.json (특보구역 → 좌표 매핑) 을 lazy 로드 + 메모리 캐시.
 * 파일 없거나 파싱 실패 시 빈 객체 — 다음 호출도 같은 빈 객체 반환 (재시도 안 함).
 *
 * [용도] ocean3 라우트가 좌표 → 특보구역 변환 시 사용.
 */
function getZoneCoords3() {
    if (_zoneCoordsCache3 !== null) return _zoneCoordsCache3;
    try {
        const p = path.join(__dirname, '..', '..', 'client', 'zone_coords.json'); // STEP 7
        _zoneCoordsCache3 = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
    } catch (e) { _zoneCoordsCache3 = {}; }
    return _zoneCoordsCache3;
}

/**
 * zone_forecasts.json에서 특정 시각에 가장 가까운 항목 반환.
 * zone_coords.json 기반 최단거리 소해구 사용 (ocean4.js와 동일 방식).
 * time: JavaScript Date 객체
 */
function getZoneForecastAt(lat, lon, time) {
    const filePath = path.join(DATA_DIR, 'zone_forecasts.json');
    if (!fs.existsSync(filePath)) return null;
    const zoneData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    // zone_coords.json 기반 최단거리 소해구 선택
    const zoneCoords = getZoneCoords3();
    let lzone = null, minZoneDist = Infinity;
    for (const zoneId of Object.keys(zoneData.data || {})) {
        const c = zoneCoords[zoneId];
        if (!c) continue;
        const dist = (lat - c.lat) ** 2 + (lon - c.lon) ** 2;
        if (dist < minZoneDist) { minZoneDist = dist; lzone = zoneId; }
    }
    if (!lzone) return null;

    const items = zoneData.data[lzone];
    if (!items || items.length === 0) return null;

    let closest = items[0], minDiff = Infinity;
    items.forEach(item => {
        const s = String(item.tm);
        const predTime = new Date(Date.UTC(
            parseInt(s.substring(0, 4)), parseInt(s.substring(4, 6)) - 1,
            parseInt(s.substring(6, 8)), parseInt(s.substring(8, 10))
        ));
        const diff = Math.abs(predTime.getTime() - time.getTime());
        if (diff < minDiff) { minDiff = diff; closest = item; }
    });

    // 6시간 초과: 유효한 예보 없음 → null 반환 (카드 숨김 트리거)
    if (minDiff > 6 * 3600 * 1000) return null;

    return closest;
}

/**
 * API 설정 파일에서 KMA 인증키를 읽어오는 함수
 */
function getKmaKey() {
    try {
        const config = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'api_config.json'), 'utf8'));
        return config.KMA_HUB_KEY || '';
    } catch (e) {
        return '';
    }
}

// ============================================================================
// API: 특정 좌표의 기상 데이터 조회
// ============================================================================

/**
 * GET /api/ocean/weather
 *
 * 특정 좌표의 풍향·풍속·기온·강수를 조회합니다.
 *
 * [동작 흐름]
 * 1. 클릭 좌표(lat, lon)를 받음
 * 2. 현재 시각 기준 최근 1시간 범위로 API 호출
 * 3. CSV 응답을 파싱하여 최신 관측값 추출
 * 4. 풍향(도), 풍속(m/s), 기온(°C), 강수유무 반환
 *
 * [요청 파라미터]
 * - lat (필수): 위도
 * - lon (필수): 경도
 *
 * [응답 예시]
 * {
 *   success: true,
 *   windDir: 270,        // 풍향 (도)
 *   windSpeed: 5.2,      // 풍속 (m/s)
 *   temperature: 14.3,   // 기온 (°C)
 *   rainfall: 0,         // 강수유무 (0: 없음, 1~: 있음)
 *   obsTime: "202604051200"
 * }
 */
router.get('/api/ocean/weather', async (req, res) => {
    try {
        const lat = parseFloat(req.query.lat);
        const lon = parseFloat(req.query.lon);

        if (isNaN(lat) || isNaN(lon)) {
            return res.status(400).json({ success: false, error: '위도(lat)와 경도(lon)를 입력해주세요.' });
        }

        // time 파라미터가 있으면 zone_forecasts.json에서 바람 예보 데이터 반환
        // (KMA 융합기상 API는 실시간 관측만 지원하므로 과거/미래는 예보 데이터 사용)
        if (req.query.time) {
            const targetTime = new Date(req.query.time);
            const fc = getZoneForecastAt(lat, lon, targetTime);
            if (fc) {
                return res.json({
                    success: true,
                    windDir: fc.windDir,
                    windSpeed: fc.ws,
                    temperature: null,   // 해구 예보에 기온 없음
                    rainfall: null,
                    obsTime: String(fc.tm),
                    source: 'forecast'
                });
            }
            return res.json({ success: false, error: '해당 시각의 바람 예보 데이터가 없습니다.' });
        }

        const authKey = getKmaKey();
        if (!authKey) {
            return res.status(500).json({ success: false, error: 'KMA API 키가 설정되지 않았습니다.' });
        }

        // 현재 시각 기준 조회 시간 범위 설정 (최근 1시간)
        // KMA API는 KST 기준 YYYYMMDDHHmm 형식 사용
        const now = new Date();
        const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000); // UTC → KST
        const tm2 = formatKstTime(kstNow);

        const oneHourAgo = new Date(kstNow.getTime() - 60 * 60 * 1000);
        const tm1 = formatKstTime(oneHourAgo);

        // KMA API 키는 URLSearchParams 인코딩 없이 직접 구성
        const url = `${KMA_SFC_URL}?tm1=${tm1}&tm2=${tm2}&lon=${lon.toFixed(4)}&lat=${lat.toFixed(4)}&obs=wd_10m,ws_10m,rn_ox,ta&itv=60&authKey=${authKey}`;

        const response = await fetch(url);
        const text = await response.text();

        // CSV 응답 파싱
        const parsed = parseKmaCsv(text);

        if (!parsed) {
            return res.json({ success: false, error: '기상 데이터를 파싱할 수 없습니다.' });
        }

        res.json({
            success: true,
            windDir: parsed.wd_10m,
            windSpeed: parsed.ws_10m,
            temperature: parsed.ta,
            rainfall: parsed.rn_ox,
            obsTime: parsed.tm
        });

    } catch (e) {
        console.error('[Ocean] 기상 조회 오류:', e.message);
        res.status(500).json({ success: false, error: '기상 데이터 조회 중 오류가 발생했습니다.' });
    }
});

// ============================================================================
// 내부 유틸리티 함수
// ============================================================================

/**
 * KST Date 객체를 YYYYMMDDHHmm 형식 문자열로 변환
 */
function formatKstTime(kstDate) {
    const y = kstDate.getUTCFullYear();
    const m = String(kstDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(kstDate.getUTCDate()).padStart(2, '0');
    const h = String(kstDate.getUTCHours()).padStart(2, '0');
    const mi = String(kstDate.getUTCMinutes()).padStart(2, '0');
    return `${y}${m}${d}${h}${mi}`;
}

/**
 * 기상청 CSV 응답을 파싱하여 최신 관측값을 추출
 *
 * [CSV 응답 형식 예시]
 * # sfc_nc_var
 * # tm, lon, lat, wd_10m, ws_10m, rn_ox, ta
 * 202604051200, 126.5000, 34.5000, 270.0, 5.2, 0.0, 14.3
 *
 * - '#'으로 시작하는 줄은 헤더/주석
 * - 데이터 줄은 쉼표로 구분
 * - 여러 줄이 있으면 마지막(최신) 줄 사용
 */
function parseKmaCsv(text) {
    const lines = text.trim().split('\n');

    // 데이터 줄만 추출 (#으로 시작하지 않고 빈 줄이 아닌 것)
    const dataLines = lines.filter(line => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith('#');
    });

    if (dataLines.length === 0) return null;

    // 마지막 줄(최신 데이터) 사용
    const lastLine = dataLines[dataLines.length - 1];
    const parts = lastLine.split(',').map(s => s.trim());

    // 최소 7개 필드 필요: tm, lon, lat, wd_10m, ws_10m, rn_ox, ta
    if (parts.length < 7) return null;

    const wd = parseFloat(parts[3]);
    const ws = parseFloat(parts[4]);
    const rn = parseFloat(parts[5]);
    const ta = parseFloat(parts[6]);

    // 모든 값이 유효한지 확인
    if (isNaN(wd) && isNaN(ws) && isNaN(ta)) return null;

    return {
        tm: parts[0],
        wd_10m: isNaN(wd) ? null : wd,
        ws_10m: isNaN(ws) ? null : ws,
        rn_ox: isNaN(rn) ? null : rn,
        ta: isNaN(ta) ? null : ta
    };
}

module.exports = router;
