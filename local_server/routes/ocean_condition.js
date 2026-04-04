/**
 * ============================================================================
 * 파일명: routes/ocean_condition.js
 * 역할: 해황예보도 캐시 데이터를 프론트엔드에 제공하는 API 라우트
 * ============================================================================
 *
 * [설명]
 * ocean_condition_collector.js가 디스크에 저장해둔 캐시 데이터(JSON, 이미지)를
 * 프론트엔드에서 요청할 때 제공하는 API 엔드포인트입니다.
 *
 * 모든 데이터는 우리 서버의 디스크(data/ocean_cache/)에서 직접 읽어 응답하므로
 * 외부 API 호출이 발생하지 않습니다.
 *
 * [API 목록]
 * GET /api/ocean-condition/areas           → 지역 코드 목록 (드롭다운용)
 * GET /api/ocean-condition/data/:areaCode  → 특정 지역의 예보 데이터 (JSON)
 * GET /api/ocean-condition/image/:filename → 캐시된 예보도 이미지 (PNG)
 * GET /api/ocean-condition/status          → 캐시 상태 조회 (관리자용)
 *
 * [연계 파일]
 * - ocean_condition_collector.js → 캐시 디렉토리 경로 및 지역 코드 제공
 * - js/ocean_condition.js (프론트엔드) → 이 API를 호출하여 화면에 표출
 * - server.js → app.use()로 이 라우터 등록
 *
 * [초보자를 위한 안내]
 * Express Router: URL 경로와 처리 함수를 연결해주는 도구
 * 예: GET /api/ocean-condition/areas 요청이 오면 → getAreas 함수 실행
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// 해황예보도 수집기 모듈 (캐시 경로, 지역 코드 등 참조)
const oceanCollector = require('../ocean_condition_collector');

// ============================================================================
// 1. 지역 코드 목록 API
// ============================================================================
/**
 * GET /api/ocean-condition/areas
 *
 * 프론트엔드의 지역 선택 드롭다운을 구성하는 데 사용됩니다.
 * 20개 지역의 영문코드와 한글명을 반환합니다.
 *
 * [응답 예시]
 * {
 *   "areas": {
 *     "korea": "전국",
 *     "busan": "부산",
 *     ...
 *   }
 * }
 *
 * [호출 위치] js/ocean_condition.js → 탭 최초 진입 시
 */
router.get('/api/ocean-condition/areas', (req, res) => {
    res.json({ areas: oceanCollector.getAreaCodes() });
});

// ============================================================================
// 2. 특정 지역 예보 데이터 API
// ============================================================================
/**
 * GET /api/ocean-condition/data/:areaCode
 *
 * 캐시된 JSON 파일을 읽어서 프론트엔드에 반환합니다.
 * 프론트에서는 이 데이터의 item 목록으로 날짜/시간 버튼을 구성하고,
 * 각 항목의 imgFileNm을 이미지 API 경로와 조합하여 이미지를 표출합니다.
 *
 * [URL 파라미터]
 * - areaCode: 지역코드 (예: 'korea', 'busan', 'jeju')
 *
 * [응답 예시]
 * {
 *   "header": { "resultCode": "00", "resultMsg": "NORMAL_SERVICE" },
 *   "body": {
 *     "items": {
 *       "item": [
 *         {
 *           "ofcBrnchId": "korea",
 *           "ofcBrnchNm": "전국",
 *           "ofcFrcstYmd": "20260404",
 *           "ofcFrcstTm": "09",
 *           "imgFileNm": "do_korea_20260404_09.png",
 *           "imgFilePath": "https://www.khoa.go.kr/..."
 *         },
 *         ...
 *       ]
 *     }
 *   }
 * }
 *
 * [호출 위치] js/ocean_condition.js → 지역 선택 변경 시
 */
router.get('/api/ocean-condition/data/:areaCode', (req, res) => {
    const { areaCode } = req.params;
    const cacheDir = oceanCollector.getCacheDir();
    const filePath = path.join(cacheDir, `${areaCode}.json`);

    // 유효한 지역코드인지 검증 (보안: 경로 조작 방지)
    const validAreas = oceanCollector.getAreaCodes();
    if (!validAreas[areaCode]) {
        return res.status(400).json({ error: '유효하지 않은 지역코드입니다.' });
    }

    // 캐시 파일 존재 여부 확인
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({
            error: '데이터 준비 중입니다. 잠시 후 다시 시도해주세요.',
            code: 'CACHE_NOT_READY'
        });
    }

    // 캐시 파일을 직접 응답 (fs.readFile + JSON.parse 대신 sendFile로 효율적 전송)
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.sendFile(filePath);
});

// ============================================================================
// 3. 예보도 이미지 API
// ============================================================================
/**
 * GET /api/ocean-condition/image/:filename
 *
 * 캐시된 해황예보도 이미지(PNG)를 반환합니다.
 * 프론트엔드에서 <img src="/api/ocean-condition/image/do_korea_20260404_09.png">
 * 형태로 호출합니다.
 *
 * [URL 파라미터]
 * - filename: 이미지 파일명 (예: 'do_korea_20260404_09.png')
 *
 * [보안]
 * - 파일명에 '..' 또는 '/' 포함 시 차단 (경로 순회 공격 방지)
 * - .png 확장자만 허용
 *
 * [호출 위치] js/ocean_condition.js → 이미지 표출 시
 */
router.get('/api/ocean-condition/image/:filename', (req, res) => {
    const { filename } = req.params;

    // 보안: 경로 순회 공격 방지 (../../../etc/passwd 같은 시도 차단)
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: '잘못된 파일명입니다.' });
    }

    // 보안: PNG 파일만 허용
    if (!filename.endsWith('.png')) {
        return res.status(400).json({ error: 'PNG 파일만 요청 가능합니다.' });
    }

    const cacheDir = oceanCollector.getCacheDir();
    const imagePath = path.join(cacheDir, 'images', filename);

    if (!fs.existsSync(imagePath)) {
        return res.status(404).json({
            error: '이미지를 찾을 수 없습니다.',
            code: 'IMAGE_NOT_FOUND'
        });
    }

    // 이미지 캐시 헤더 설정 (브라우저에서도 1시간 캐싱)
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Content-Type', 'image/png');
    res.sendFile(imagePath);
});

// ============================================================================
// 4. 캐시 상태 조회 API
// ============================================================================
/**
 * GET /api/ocean-condition/status
 *
 * 현재 캐시 상태를 반환합니다.
 * 관리자 페이지나 디버깅 시 캐시가 정상적으로 구성되어 있는지 확인하는 용도입니다.
 *
 * [응답 예시]
 * {
 *   "latestDate": "20260404",
 *   "collectedAt": "2026-04-04T00:05:30.123Z",
 *   "totalAreas": 20,
 *   "totalImages": 1060,
 *   "failedImages": 0
 * }
 *
 * [호출 위치] 관리자 페이지 또는 디버깅용
 */
router.get('/api/ocean-condition/status', (req, res) => {
    res.json(oceanCollector.getCacheStatus());
});

module.exports = router;
