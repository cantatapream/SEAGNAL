/**
 * ============================================================================
 * 파일명: routes/ocean2.js
 * 역할: ROMS(해양수치예측모델) 유향·유속·수온 API
 * ============================================================================
 *
 * [설명]
 * 국립해양조사원(KHOA)의 ROMS 수치예측모델 API를 호출하여
 * 특정 좌표의 유향(해류 방향), 유속(해류 속도), 수온 데이터를 제공합니다.
 * 72시간 예측 데이터를 1시간 간격으로 제공합니다.
 *
 * - GET /api/ocean/roms      → 특정 좌표의 현재 유향·유속·수온 조회
 * - GET /api/ocean/roms-grid → 지도 뷰포트 범위의 격자 데이터 (오버레이용)
 *
 * [외부 API]
 * 엔드포인트: https://apis.data.go.kr/1192136/roms/GetRomsApiService
 * 인증키: api_config.json의 ROMS_SERVICE_KEY
 * 제한: 경위도 범위 최대 1도
 *
 * [연계 파일]
 * - ocean1.js → 이 파일을 router.use()로 연결
 * - data/api_config.json → ROMS API 인증키
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { DATA_DIR } = require('../config/server_config');

// ROMS API 기본 URL
const ROMS_API_URL = 'https://apis.data.go.kr/1192136/roms/GetRomsApiService';

/**
 * API 설정 파일에서 ROMS 인증키를 읽어오는 함수
 * - 매 요청마다 파일을 읽어 키가 변경되어도 즉시 반영
 * - 키가 없으면 빈 문자열 반환
 */
function getRomsKey() {
    // 1순위: 환경변수 (Fly.io secret 등)
    if (process.env.ROMS_SERVICE_KEY) {
        return process.env.ROMS_SERVICE_KEY;
    }
    // 2순위: api_config.json 파일
    try {
        const config = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'api_config.json'), 'utf8'));
        return config.ROMS_SERVICE_KEY || '';
    } catch (e) {
        return '';
    }
}

// ============================================================================
// API: 특정 좌표의 ROMS 데이터 조회
// ============================================================================

/**
 * GET /api/ocean/roms
 *
 * 특정 좌표의 유향·유속·수온을 조회합니다.
 *
 * [동작 흐름]
 * 1. 클릭 좌표(lat, lon)를 받음
 * 2. 좌표 기준 ±0.05도 범위로 ROMS API 호출
 *    (작은 범위로 호출하여 가장 가까운 예측점 1개를 얻음)
 * 3. 현재 시각에 가장 가까운 예측 데이터를 선택
 * 4. 유향(도), 유속(cm/s), 수온(°C) 반환
 *
 * [요청 파라미터]
 * - lat (필수): 위도
 * - lon (필수): 경도
 *
 * [응답 예시]
 * {
 *   success: true,
 *   predcDt: "2026-04-05 12:00:00",
 *   crdir: 309.68,        // 유향 (도, 0=북, 90=동, 180=남, 270=서)
 *   crsp: 0.95,           // 유속 (cm/s)
 *   wtem: 12.93,          // 수온 (°C)
 *   lat: 34.02873,
 *   lon: 126.01516
 * }
 */
router.get('/api/ocean/roms', async (req, res) => {
    try {
        const lat = parseFloat(req.query.lat);
        const lon = parseFloat(req.query.lon);

        if (isNaN(lat) || isNaN(lon)) {
            return res.status(400).json({ success: false, error: '위도(lat)와 경도(lon)를 입력해주세요.' });
        }

        const serviceKey = getRomsKey();
        if (!serviceKey) {
            return res.status(500).json({ success: false, error: 'ROMS API 키가 설정되지 않았습니다.' });
        }

        // 클릭 좌표 기준 ±0.05도 범위로 API 호출
        // → 가장 가까운 예측점 하나를 찾기 위한 최소 범위
        const delta = 0.05;
        // 공공데이터포털 API 키는 URLSearchParams로 인코딩하면 안 됨 (=,%2B 등 깨짐)
        const url = `${ROMS_API_URL}?serviceKey=${serviceKey}&type=json&ymin=${(lat - delta).toFixed(2)}&ymax=${(lat + delta).toFixed(2)}&xmin=${(lon - delta).toFixed(2)}&xmax=${(lon + delta).toFixed(2)}&numOfRows=300`;

        const response = await fetch(url);
        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (parseErr) {
            console.error('[Ocean] ROMS 응답 파싱 실패:', text.substring(0, 200));
            return res.json({ success: false, error: 'ROMS API 응답 형식 오류' });
        }

        // API 응답 구조 확인
        // 정상: { header: { resultCode: "00" }, body: { items: { item: [...] } } }
        const header = data.header || data.response?.header;
        if (!header || header.resultCode !== '00') {
            return res.json({ success: false, error: 'ROMS 데이터를 가져올 수 없습니다.' });
        }

        const body = data.body || data.response?.body;
        const items = body?.items?.item;

        if (!items || items.length === 0) {
            return res.json({ success: false, error: '해당 좌표의 ROMS 데이터가 없습니다.' });
        }

        // 현재 시각에 가장 가까운 예측 데이터 선택
        // ROMS는 1시간 간격으로 72시간 예측을 제공
        const now = new Date();
        let closest = items[0];
        let minTimeDiff = Infinity;

        items.forEach(item => {
            // 예측일시 파싱: "2026-04-05 12:00:00" → Date 객체
            const predTime = new Date(item.predcDt.replace(' ', 'T') + '+09:00'); // KST
            const diff = Math.abs(predTime.getTime() - now.getTime());
            if (diff < minTimeDiff) {
                minTimeDiff = diff;
                closest = item;
            }
        });

        res.json({
            success: true,
            predcDt: closest.predcDt,
            crdir: closest.crdir,    // 유향 (도)
            crsp: closest.crsp,      // 유속 (cm/s)
            wtem: closest.wtem,      // 수온 (°C)
            lat: closest.lat,
            lon: closest.lot         // ROMS API에서는 경도를 "lot"으로 표기
        });

    } catch (e) {
        console.error('[Ocean] ROMS 조회 오류:', e.message);
        res.status(500).json({ success: false, error: 'ROMS 데이터 조회 중 오류가 발생했습니다.' });
    }
});

// ============================================================================
// API: 뷰포트 범위의 ROMS 그리드 데이터 (모드 B 오버레이용)
// ============================================================================

/**
 * GET /api/ocean/roms-grid
 *
 * 지도 뷰포트 범위의 ROMS 격자 데이터를 반환합니다.
 * 모드 B에서 해류 색상 오버레이를 그리는 데 사용됩니다.
 *
 * [동작 흐름]
 * 1. 뷰포트 범위(ymin, ymax, xmin, xmax)를 받음
 * 2. 범위가 1도를 초과하면 여러 번 나눠서 호출
 * 3. 특정 시각(time)의 데이터만 필터링
 * 4. 격자점 배열 반환
 *
 * [요청 파라미터]
 * - ymin, ymax (필수): 위도 범위
 * - xmin, xmax (필수): 경도 범위
 * - time (선택): 조회할 시각 (ISO 형식, 기본값: 현재)
 *
 * [응답 예시]
 * {
 *   success: true,
 *   items: [
 *     { lat: 34.02, lon: 126.01, crdir: 309.68, crsp: 0.95, wtem: 12.93 },
 *     ...
 *   ]
 * }
 */
router.get('/api/ocean/roms-grid', async (req, res) => {
    try {
        const ymin = parseFloat(req.query.ymin);
        const ymax = parseFloat(req.query.ymax);
        const xmin = parseFloat(req.query.xmin);
        const xmax = parseFloat(req.query.xmax);
        const timeStr = req.query.time || null;

        if (isNaN(ymin) || isNaN(ymax) || isNaN(xmin) || isNaN(xmax)) {
            return res.status(400).json({ success: false, error: '범위 파라미터(ymin, ymax, xmin, xmax)를 입력해주세요.' });
        }

        const serviceKey = getRomsKey();
        if (!serviceKey) {
            return res.status(500).json({ success: false, error: 'ROMS API 키가 설정되지 않았습니다.' });
        }

        // 조회할 시각 결정 (기본: 현재 시각에 가장 가까운 정각)
        const targetTime = timeStr ? new Date(timeStr) : new Date();

        // ROMS API는 경위도 범위 최대 1도 제한
        // → 뷰포트가 1도를 초과하면 여러 블록으로 나눠서 호출
        const latBlocks = splitRange(ymin, ymax, 1.0);
        const lonBlocks = splitRange(xmin, xmax, 1.0);

        // 모든 블록을 병렬로 호출
        const promises = [];
        for (const [latMin, latMax] of latBlocks) {
            for (const [lonMin, lonMax] of lonBlocks) {
                promises.push(fetchRomsBlock(serviceKey, latMin, latMax, lonMin, lonMax));
            }
        }

        const results = await Promise.all(promises);
        const allItems = results.flat();

        // 특정 시각의 데이터만 필터링
        // → 현재 시각에 가장 가까운 예측 시간대의 데이터만 선택
        const filtered = filterByTime(allItems, targetTime);

        res.json({
            success: true,
            time: targetTime.toISOString(),
            items: filtered
        });

    } catch (e) {
        console.error('[Ocean] ROMS 그리드 조회 오류:', e.message);
        res.status(500).json({ success: false, error: 'ROMS 그리드 데이터 조회 중 오류가 발생했습니다.' });
    }
});

// ============================================================================
// 내부 유틸리티 함수
// ============================================================================

/**
 * 범위를 maxSize 단위로 분할
 * 예: splitRange(33.5, 36.2, 1.0) → [[33.5,34.5], [34.5,35.5], [35.5,36.2]]
 *
 * ROMS API가 최대 1도 범위만 허용하므로
 * 넓은 뷰포트를 여러 블록으로 나눠서 호출해야 함
 */
function splitRange(min, max, maxSize) {
    const blocks = [];
    let current = min;
    while (current < max) {
        const end = Math.min(current + maxSize, max);
        blocks.push([current, end]);
        current = end;
    }
    return blocks;
}

/**
 * 하나의 블록(경위도 범위)에 대해 ROMS API를 호출하는 함수
 *
 * @param {string} serviceKey - API 인증키
 * @param {number} ymin - 최저위도
 * @param {number} ymax - 최고위도
 * @param {number} xmin - 최저경도
 * @param {number} xmax - 최고경도
 * @returns {Array} ROMS 데이터 항목 배열
 */
async function fetchRomsBlock(serviceKey, ymin, ymax, xmin, xmax) {
    try {
        const url = `${ROMS_API_URL}?serviceKey=${serviceKey}&type=json&ymin=${ymin.toFixed(2)}&ymax=${ymax.toFixed(2)}&xmin=${xmin.toFixed(2)}&xmax=${xmax.toFixed(2)}&numOfRows=300`;

        const response = await fetch(url);
        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            console.error('[Ocean] ROMS 블록 파싱 실패:', text.substring(0, 200));
            return [];
        }

        const body = data.body || data.response?.body;
        const items = body?.items?.item;

        if (!items) return [];
        return Array.isArray(items) ? items : [items];
    } catch (e) {
        console.error('[Ocean] ROMS 블록 호출 실패:', e.message);
        return [];
    }
}

/**
 * 특정 시각에 가장 가까운 예측 시간의 데이터만 필터링
 *
 * ROMS 데이터는 같은 좌표에 72개(72시간)의 시간별 데이터가 있으므로
 * 현재 보고 싶은 시각의 데이터만 골라냄
 *
 * @param {Array} items - 전체 ROMS 데이터 배열
 * @param {Date} targetTime - 조회할 시각
 * @returns {Array} 필터링된 데이터 배열 (좌표당 1개)
 */
function filterByTime(items, targetTime) {
    if (!items.length) return [];

    // 가용한 예측 시간 목록에서 targetTime에 가장 가까운 시간 찾기
    const uniqueTimes = [...new Set(items.map(i => i.predcDt))];
    let closestTime = uniqueTimes[0];
    let minDiff = Infinity;

    uniqueTimes.forEach(t => {
        const predTime = new Date(t.replace(' ', 'T') + '+09:00');
        const diff = Math.abs(predTime.getTime() - targetTime.getTime());
        if (diff < minDiff) {
            minDiff = diff;
            closestTime = t;
        }
    });

    // 해당 시간의 데이터만 반환 (좌표당 1개씩)
    return items
        .filter(i => i.predcDt === closestTime)
        .map(i => ({
            lat: i.lat,
            lon: i.lot,    // ROMS API에서 경도는 "lot"으로 표기
            crdir: i.crdir,
            crsp: i.crsp,
            wtem: i.wtem
        }));
}

module.exports = router;
