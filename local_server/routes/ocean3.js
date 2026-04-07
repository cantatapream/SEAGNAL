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
