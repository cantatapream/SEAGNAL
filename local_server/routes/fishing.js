/**
 * ============================================================================
 * 파일명: routes/fishing.js
 * 역할: 바다낚시 지수 데이터 API 라우트
 * ============================================================================
 *
 * [설명]
 * 이 파일은 바다낚시 지수 데이터를 클라이언트에 제공하는 API 엔드포인트입니다.
 * - GET /api/fishing-index → 바다낚시 지수 전체 데이터 (fishing_index.json)
 *
 * [연계 파일]
 * - scheduler.js → collectFishingIndex()가 수집하여 fishing_index.json 저장
 * - services/cache_manager.js → dataCache.fishingIndex로 메모리 캐시
 * - server.js → app.use()로 이 라우터 등록
 * - js/fishing.js (프론트엔드) → fetch('/api/fishing-index')로 데이터 요청
 *
 * [초보자를 위한 안내]
 * 이 API는 프론트엔드의 바다낚시 지도에서 호출됩니다.
 * 응답 데이터에는 갯바위/선상별 전국 낚시 포인트의 위치(좌표),
 * 날짜별 오전/오후 예보(종합지수, 파고, 수온, 어종별 지수 등)가 포함됩니다.
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { dataCache } = require('../services/cache_manager');

// ============================================================================
// 해양생활기상 API 만료일 관리
// ============================================================================

/**
 * 만료일 설정 파일 경로 (data/marine_life_expiry.json)
 * - 각 해양생활 지수별 API 만료일을 저장
 * - admin 페이지에서 조회/수정 시 이 파일을 읽고 쓰기
 */
const EXPIRY_FILE = path.join(__dirname, '..', 'data', 'marine_life_expiry.json');

/**
 * 만료일 설정 파일 로드
 * @returns {Object} { indexes: [{ type, name, expiry }, ...] }
 * [연계] GET /api/marine-life/expiry, PUT /api/marine-life/expiry/:type 에서 호출
 */
function loadExpiryConfig() {
    try {
        return JSON.parse(fs.readFileSync(EXPIRY_FILE, 'utf8'));
    } catch (e) {
        // 파일이 없거나 파싱 실패 시 기본 구조 반환
        return {
            indexes: [
                { type: 'fishing', name: '바다낚시', expiry: '-' },
                { type: 'surfing', name: '서핑', expiry: '-' },
                { type: 'mudflat', name: '갯벌체험', expiry: '-' },
                { type: 'swimming', name: '해수욕', expiry: '-' },
                { type: 'scuba', name: '스쿠버다이빙', expiry: '-' },
                { type: 'sea-parting', name: '바닷길', expiry: '-' }
            ]
        };
    }
}

/**
 * 만료일 설정 파일 저장
 * @param {Object} config - { indexes: [...] } 구조의 설정 데이터
 * [연계] PUT /api/marine-life/expiry/:type 에서 호출
 */
function saveExpiryConfig(config) {
    fs.writeFileSync(EXPIRY_FILE, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * GET /api/marine-life/expiry
 * 전체 해양생활 지수별 만료일 현황을 반환합니다.
 *
 * [응답 구조]
 * { indexes: [{ type: "fishing", name: "바다낚시", expiry: "2026-12-31" }, ...] }
 *
 * [연계] admin_collect.js → refreshMarineLifeExpiry() 에서 호출
 */
router.get('/api/marine-life/expiry', (req, res) => {
    res.json(loadExpiryConfig());
});

/**
 * PUT /api/marine-life/expiry/:type
 * 특정 지수의 만료일을 수정합니다.
 *
 * [요청 바디] { expiry: "2026-12-31" }
 * [URL 파라미터] :type - 지수 타입 (fishing, surfing, mudflat, swimming, scuba, sea-parting)
 *
 * [연계] admin_collect.js → editMarineLifeExpiry() 에서 호출
 */
router.put('/api/marine-life/expiry/:type', (req, res) => {
    const { type } = req.params;
    const { expiry } = req.body;

    if (!expiry) return res.status(400).json({ error: '만료일을 입력해주세요.' });

    const config = loadExpiryConfig();
    const target = config.indexes.find(i => i.type === type);

    if (!target) return res.status(404).json({ error: '존재하지 않는 지수 타입입니다.' });

    target.expiry = expiry;
    saveExpiryConfig(config);
    res.json({ success: true });
});

/**
 * GET /api/fishing-index
 * 바다낚시 지수 전체 데이터를 반환합니다.
 *
 * [응답 구조]
 * {
 *   updatedAt: "2026.03.31 09:00",        // 수집 시각
 *   갯바위: {                              // 갯바위 낚시 데이터
 *     "거제도": {
 *       lat: 34.xxx, lot: 128.xxx,         // 위치 좌표
 *       forecasts: {                       // 날짜별 예보
 *         "20260331": {
 *           "오전": { totalIndex, items, minWvhgt, ... },
 *           "오후": { ... }
 *         }
 *       },
 *       etcFishList: "부시리,광어,..."     // 기타어종 목록
 *     }
 *   },
 *   선상: { ... }                          // 선상 낚시 데이터 (어종별 상세 없음)
 * }
 */
router.get('/api/fishing-index', (req, res) => {
    // 캐시된 데이터가 있으면 바로 응답
    if (dataCache.fishingIndex) {
        return res.json(dataCache.fishingIndex);
    }
    // 아직 수집되지 않은 경우 (서버 시작 직후 등)
    res.status(404).json({ error: '바다낚시 지수 데이터 준비 중' });
});

// ============================================================================
// 서핑지수 API
// ============================================================================

/**
 * GET /api/surfing-index
 * 서핑지수 전체 데이터를 반환합니다.
 *
 * [응답 구조]
 * {
 *   updatedAt: "2026.04.02 09:00",
 *   beaches: {
 *     "경포해수욕장": {
 *       lat, lot, zone: "63", alert: "강원북부앞바다",
 *       forecasts: {
 *         "20260402": {
 *           "오전": { avgWvhgt, avgWvpd, avgWspd, avgWtem, grades: { 초급, 중급, 상급 } },
 *           "오후": { ... }
 *         },
 *         "20260405": { "일": { ... } }   // D+3 이후 종일
 *       }
 *     }
 *   }
 * }
 *
 * [연계] scheduler.js → collectSurfingIndex() → surfing_index.json
 *        js/surfing1.js → fetch('/api/surfing-index')
 */
router.get('/api/surfing-index', (req, res) => {
    if (dataCache.surfingIndex) {
        return res.json(dataCache.surfingIndex);
    }
    res.status(404).json({ error: '서핑지수 데이터 준비 중' });
});

// ============================================================================
// 바다갈라짐 체험지수 API
// ============================================================================

/**
 * GET /api/sea-split-index
 * 바다갈라짐 체험지수 전체 데이터를 반환합니다.
 *
 * [응답 구조]
 * {
 *   updatedAt: '수집 시점',
 *   allPlaces: ['진도','무창포',...],   // 14개 전체 지점명
 *   places: { '실미도': { lat, lot, forecasts: { '2026-04-01': [...] } }, ... }
 * }
 *
 * [연계] scheduler.js → collectSeaSplitIndex()가 sea_split_index.json으로 저장
 *        js/sea_parting.js (프론트엔드) → fetch('/api/sea-split-index')로 요청
 */
router.get('/api/sea-split-index', (req, res) => {
    // 캐시된 데이터가 있으면 바로 응답
    if (dataCache.seaSplitIndex) {
        return res.json(dataCache.seaSplitIndex);
    }
    // 아직 수집되지 않은 경우
    res.status(404).json({ error: '바다갈라짐 체험지수 데이터 준비 중' });
});

// ============================================================================
// 갯벌체험 지수 API
// ============================================================================

/**
 * GET /api/mudflat-index
 * 갯벌체험 지수 전체 데이터를 반환합니다.
 *
 * [응답 구조]
 * {
 *   updatedAt: '수집 시점',
 *   allPlaces: ['우전마을','백미리마을',...],  // 37개 전체 지점명
 *   places: { '신리마을': { lat, lot, forecasts: { '2026-06-07': [...] } }, ... }
 * }
 *
 * [연계] scheduler.js → collectMudflatIndex()가 mudflat_index.json으로 저장
 *        js/mudflat.js (프론트엔드) → fetch('/api/mudflat-index')로 요청
 */
router.get('/api/mudflat-index', (req, res) => {
    // 캐시된 데이터가 있으면 바로 응답
    if (dataCache.mudflatIndex) {
        return res.json(dataCache.mudflatIndex);
    }
    // 아직 수집되지 않은 경우
    res.status(404).json({ error: '갯벌체험 지수 데이터 준비 중' });
});

// ============================================================================
// 스킨스쿠버 지수 API
// ============================================================================

/**
 * GET /api/scuba-index
 * 스킨스쿠버 지수 전체 데이터를 반환합니다. (바다낚시와 동일한 지도형 구조)
 *
 * [응답 구조]
 * {
 *   updatedAt: "2026.06.07 09:10",
 *   places: { "동명항": { lat, lot, forecasts: { "20260607": { "오전": {...}, "오후": {...} } } }, ... }
 * }
 *
 * [연계] scheduler.js → collectScubaIndex()가 scuba_index.json으로 저장
 *        js/scuba.js (프론트엔드) → fetch('/api/scuba-index')로 요청
 */
router.get('/api/scuba-index', (req, res) => {
    if (dataCache.scubaIndex) {
        return res.json(dataCache.scubaIndex);
    }
    res.status(404).json({ error: '스킨스쿠버 지수 데이터 준비 중' });
});

module.exports = router;
