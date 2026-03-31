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
const { dataCache } = require('../services/cache_manager');

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

/**
 * GET /api/fishing-debug
 * 바다낚시 수집 데이터 진단 정보를 반환합니다.
 * 날짜별 건수, 지역 수, 총 항목 수 등을 확인하여 수집 상태를 파악합니다.
 *
 * [연계]
 * - dataCache.fishingIndex → 메모리 캐시된 수집 데이터
 * - scheduler.js → collectFishingIndex()에서 수집한 원본 데이터
 */
router.get('/api/fishing-debug', (req, res) => {
    if (!dataCache.fishingIndex) {
        return res.json({ error: '데이터 없음' });
    }

    const data = dataCache.fishingIndex;
    const result = { updatedAt: data.updatedAt };

    // 갯바위/선상 각각의 날짜 분포 분석
    ['갯바위', '선상'].forEach(gubun => {
        const places = data[gubun] || {};
        const placeNames = Object.keys(places);
        const dateSet = new Set();
        const dateCounts = {};

        placeNames.forEach(name => {
            const forecasts = places[name].forecasts || {};
            Object.keys(forecasts).forEach(dateStr => {
                dateSet.add(dateStr);
                if (!dateCounts[dateStr]) dateCounts[dateStr] = { places: 0, slots: 0 };
                dateCounts[dateStr].places++;
                Object.keys(forecasts[dateStr]).forEach(slot => {
                    dateCounts[dateStr].slots++;
                });
            });
        });

        result[gubun] = {
            지역수: placeNames.length,
            지역목록: placeNames,
            날짜수: dateSet.size,
            날짜목록: Array.from(dateSet).sort(),
            날짜별현황: dateCounts
        };
    });

    res.json(result);
});

module.exports = router;
