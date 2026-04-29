/**
 * ============================================================================
 * 파일명: routes/cctv_seafog.js
 * 역할: 해양수산부 국립해양조사원 해무 CCTV 스틸컷 데이터 수집 및 API 제공
 * ============================================================================
 *
 * [설명]
 * 이 파일은 두 가지 역할을 합니다:
 *
 * 1. 데이터 수집 (10분마다 자동 실행)
 *    공공데이터포털 "해무 CCTV 스틸컷 조회" API를 호출하여
 *    9개 항구의 최근 스틸컷 이미지 URL을 메모리에 캐시합니다.
 *    → API는 10분 단위로 스틸컷을 업데이트하므로, 같은 주기로 수집합니다.
 *
 * 2. API 제공 (GET /api/seafog-cctv)
 *    프론트엔드(cctv4.js)가 마커 클릭 시 호출하여
 *    특정 항구(obsName)의 스틸컷 배열을 즉시 응답 받습니다.
 *    → 프론트엔드가 공공API를 직접 호출하면 CORS 오류가 발생하므로
 *       서버가 대신 가져온 뒤 클라이언트에게 전달합니다.
 *
 * [데이터 흐름]
 *   공공API (10분마다) → 메모리 캐시 → GET /api/seafog-cctv → 프론트엔드
 *
 * [응답 항목]
 *   - sfogObsvtrNm : 관측소명 (예: "부산항(북항)")
 *   - imgDt        : 촬영 일시 (예: "2026-04-05 09:30")
 *   - uri          : 이미지 URL (khoa.go.kr)
 *
 * [연계 파일]
 *   - server.js        → app.use(require('./routes/cctv_seafog')) 로 등록
 *   - js/cctv4.js      → fetch('/api/seafog-cctv?obs=대산항') 으로 호출
 *   - js/cctv1.js      → seafog 프로바이더의 obsName 값과 매칭
 * ============================================================================
 */

const express  = require('express');
const router   = express.Router();
const cron     = require('node-cron');
const fetch    = require('node-fetch');
// [신규] 신선도 모듈 — 자체 메모리 캐시(_lastUpdated) 를 freshness 의 외부 source 로 등록하여
//        /api/seafog-cctv 응답에 X-Data-Updated-At / X-Data-Age-Seconds / X-Data-Fresh 헤더 부착
//        + stale 시 fetchSeafogData() 백그라운드 트리거. (POLICY 의 키 'cctv' 사용)
const freshness = require('../services/freshness');

// ============================================================================
// 상수 정의
// ============================================================================

/**
 * 공공데이터포털 API 서비스키
 * 국립해양조사원 해무 CCTV 스틸컷 조회 API 전용 키입니다.
 */
const SERVICE_KEY = 'PmxnR43icJwR7yzKjG612RncLikLD1RvZpPLgEJqUUx0vGQncdfuT9VjiqBlgiXMdcjyKopi4yvUPaPbcdIUfg%3D%3D';

/**
 * 공공API 요청 URL
 * - numOfRows=300: 최대 300건 (9개 지점 × 4장 = 36건이므로 충분)
 * - type=json: JSON 형식으로 응답
 */
const API_URL = `https://apis.data.go.kr/1192136/seafogCctv/GetSeafogCctvApiService` +
    `?serviceKey=${SERVICE_KEY}&type=json&numOfRows=300`;

/**
 * 수집 타이밍: 매 10분 정각 + 1분 후
 * 공공API는 :00, :10, :20, :30, :40, :50 분에 스틸컷을 업데이트합니다.
 * 1분 뒤인 :01, :11, :21, :31, :41, :51 분에 수집하면 항상 최신 이미지를 가져옵니다.
 *
 * cron 표현식 '1,11,21,31,41,51 * * * *'
 *   = 매 시간 1분, 11분, 21분, 31분, 41분, 51분에 실행
 */
const COLLECT_INTERVAL_CRON = '1,11,21,31,41,51 * * * *';

// ============================================================================
// 메모리 캐시
// ============================================================================

/**
 * 지점별 스틸컷 배열을 저장하는 캐시 객체
 *
 * 구조:
 *   {
 *     "대산항": [
 *       { sfogObsvtrNm: "대산항", imgDt: "2026-04-05 09:00", uri: "https://..." },
 *       { sfogObsvtrNm: "대산항", imgDt: "2026-04-05 09:10", uri: "https://..." },
 *       ...
 *     ],
 *     "목포항": [ ... ],
 *     ...
 *   }
 *
 * 키: sfogObsvtrNm (관측소명 문자열)
 * 값: imgDt 오름차순 정렬된 스틸컷 배열 (최대 4장)
 */
let _cache = {};

/**
 * 마지막 수집 성공 시각 (ISO 문자열)
 * 클라이언트 응답에 포함하여 데이터 신선도를 알 수 있게 합니다.
 */
let _lastUpdated = null;

/**
 * 마지막 수집 성공/실패 여부
 */
let _lastStatus = '대기 중';

// ============================================================================
// 데이터 수집 함수
// ============================================================================

/**
 * 공공데이터포털 해무 CCTV API를 호출하여 캐시를 갱신합니다.
 *
 * [수집 과정]
 * 1. API 호출 → 최대 300건 JSON 응답
 * 2. 지점명(sfogObsvtrNm)으로 그룹화
 * 3. 각 그룹을 imgDt 오름차순 정렬 (오래된 것 → 최신 순)
 * 4. 메모리 캐시(_cache)에 저장
 *
 * [호출 시점]
 * - 서버 시작 시 즉시 1회
 * - 이후 10분마다 cron으로 자동 호출
 */
async function fetchSeafogData() {
    console.log('[해무CCTV] 스틸컷 데이터 수집 시작...');
    try {
        const res = await fetch(API_URL, { timeout: 15000 });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json();

        // API 응답 구조 검증
        const items = json?.body?.items?.item;
        if (!Array.isArray(items)) {
            throw new Error('응답 items 배열 없음');
        }

        // 지점명별로 그룹화
        const grouped = {};
        for (const item of items) {
            const obs = item.sfogObsvtrNm;
            if (!obs) continue;
            if (!grouped[obs]) grouped[obs] = [];
            grouped[obs].push({
                sfogObsvtrNm: obs,
                imgDt: item.imgDt,   // "2026-04-05 09:30"
                uri:   item.uri      // "https://khoa.go.kr/..."
            });
        }

        // 각 지점의 스틸컷을 imgDt 오름차순 정렬 (오래된 것이 앞, 최신이 뒤)
        for (const obs of Object.keys(grouped)) {
            grouped[obs].sort((a, b) => a.imgDt.localeCompare(b.imgDt));
        }

        // 캐시 갱신
        _cache       = grouped;
        _lastUpdated = new Date().toISOString();
        _lastStatus  = 'success';

        const stationCount = Object.keys(grouped).length;
        const totalImages  = items.length;
        console.log(`[해무CCTV] 수집 완료 — ${stationCount}개 지점, 총 ${totalImages}장`);

    } catch (err) {
        _lastStatus = `error: ${err.message}`;
        console.error('[해무CCTV] 수집 실패:', err.message);
        // 실패해도 기존 캐시는 유지 (이전 데이터 활용)
    }
}

// ============================================================================
// 신선도 모듈에 외부 source 등록
// ============================================================================
// CCTV 데이터는 cache_manager 의 dataCache 에 들어가지 않고 자체 메모리(_cache)
// 에 저장되므로, freshness.registerSource() 로 직접 등록한다.
// - getUpdatedAt: _lastUpdated(ISO 문자열)를 ms epoch 으로 변환해 반환
// - maxAgeMs: 20분 (수집 주기 10분 × 2)
// - refreshFn: stale 감지 시 백그라운드(60초 debounce)로 fetchSeafogData() 호출
freshness.registerSource(
    'cctv',
    () => (_lastUpdated ? new Date(_lastUpdated).getTime() : null),
    {
        maxAgeMs: 20 * 60 * 1000,
        refreshFn: () => fetchSeafogData()
    }
);

// ============================================================================
// 10분 주기 cron 등록
// ============================================================================
// [중요] 과거에는 require 시점에 fetchSeafogData() 를 즉시 호출했으나,
//        외부 API 응답 지연이 서버 startup 을 늦추는 문제가 있었다.
//        대신 server.js 가 app.listen() 콜백에서 module.exports.kickoffInitialFetch
//        를 호출하여 listen 이후에 백그라운드로 첫 수집을 시작한다.

/**
 * 10분마다 자동 수집
 * - '1,11,21,31,41,51 * * * *' = 매 시간 1분, 11분, ... 51분에 실행
 * - 공공API가 10분 단위로 스틸컷을 업데이트하므로 주기를 일치시킵니다.
 */
cron.schedule(COLLECT_INTERVAL_CRON, fetchSeafogData);

// ============================================================================
// API 엔드포인트
// ============================================================================

/**
 * GET /api/seafog-cctv
 *
 * 해무 CCTV 스틸컷 데이터를 반환합니다.
 *
 * [쿼리 파라미터]
 *   obs (선택): 관측소명 필터 (예: ?obs=대산항)
 *               지정하지 않으면 전체 지점 반환
 *
 * [응답 구조]
 *   {
 *     ok: true,
 *     lastUpdated: "2026-04-05T09:35:00.000Z",
 *     stations: {
 *       "대산항": [
 *         { sfogObsvtrNm: "대산항", imgDt: "2026-04-05 09:00", uri: "https://..." },
 *         { sfogObsvtrNm: "대산항", imgDt: "2026-04-05 09:10", uri: "https://..." },
 *         { sfogObsvtrNm: "대산항", imgDt: "2026-04-05 09:20", uri: "https://..." },
 *         { sfogObsvtrNm: "대산항", imgDt: "2026-04-05 09:30", uri: "https://..." }
 *       ]
 *     }
 *   }
 *
 * [프론트엔드 사용 예시 — cctv4.js]
 *   fetch('/api/seafog-cctv?obs=대산항')
 *     .then(r => r.json())
 *     .then(data => {
 *       const images = data.stations['대산항']; // 4장 배열
 *     });
 */
router.get('/api/seafog-cctv', (req, res) => {
    const obs = req.query.obs; // 관측소명 필터 (선택)

    // [HTTP 캐시] max-age=180 (3분) — CCTV 스틸컷은 10분 주기 갱신
    //   브라우저/앱이 3분간 자체 캐시 사용 → 동일 이미지 반복 조회 시 서버 부담 ↓
    res.setHeader('Cache-Control', 'public, max-age=180');

    // [신선도] 응답 직전에 표준 헤더 부착 + stale 시 백그라운드 재수집 트리거
    freshness.applyFreshnessHeaders(res, 'cctv');
    freshness.triggerRefreshIfStale('cctv');

    // 캐시가 비어 있으면 수집 중 안내
    if (Object.keys(_cache).length === 0) {
        return res.json({
            ok: false,
            message: '데이터 수집 중입니다. 잠시 후 다시 시도해 주세요.',
            lastUpdated: _lastUpdated,
            stations: {}
        });
    }

    // obs 파라미터가 있으면 해당 지점만, 없으면 전체 반환
    let stations;
    if (obs) {
        // 관측소명 정확히 일치하는 데이터만 반환
        stations = _cache[obs] ? { [obs]: _cache[obs] } : {};
    } else {
        stations = _cache;
    }

    res.json({
        ok: true,
        lastUpdated: _lastUpdated,
        stations
    });
});

// router 객체에 부가 함수를 attach 하여 export.
// - kickoffInitialFetch: server.js 의 app.listen() 콜백에서 호출되어
//   listen 이후 백그라운드로 첫 데이터 수집을 시작한다.
//   (require 시점에 호출하면 외부 API 응답이 startup 을 지연시키므로 분리.)
module.exports = router;
module.exports.kickoffInitialFetch = fetchSeafogData;
