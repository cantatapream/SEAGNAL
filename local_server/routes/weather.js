/**
 * ============================================================================
 * 파일명: routes/weather.js
 * 역할: 기상 특보 및 전망 데이터 API 라우트
 * ============================================================================
 *
 * [설명]
 * 이 파일은 기상 관련 데이터를 클라이언트에 제공하는 API 엔드포인트를 관리합니다.
 * - GET /api/weather-alerts → 기상 특보 현황 (weather_alerts.json)
 * - GET /api/buoys → 부이 관측 데이터
 * - GET /api/status → API 수집 상태
 * - POST /api/force-update/:type → 수동 데이터 업데이트
 * - GET/POST /api/config → API 인증키 설정
 * - GET /api/forecasts → 일반 기상 전망
 * - GET /api/marine-zone-forecasts → 해구별 기상 전망
 * - GET /api/bulletin-cache/:reportId → 통보문 캐시 조회 (특보 히스토리 팝업용)
 *
 * [연계 파일]
 * - services/cache_manager.js → dataCache에서 캐시된 데이터 응답
 * - config/server_config.js → DATA_DIR 경로 사용
 * - scheduler.js → 수집 상태 조회 및 수동 업데이트 실행
 * - server.js → app.use()로 이 라우터 등록
 *
 * [초보자를 위한 안내]
 * 이 API들은 프론트엔드(app.js)에서 fetch()로 호출되어
 * 사용자에게 기상 특보, 부이 데이터, 전망 정보를 보여주는 데 사용됩니다.
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/server_config');
const { dataCache, refreshCache } = require('../services/cache_manager');
const scheduler = require('../scheduler');
const regionalForecastCollector = require('../regional_forecast_collector');
// [신규] 캐시 신선도 검사 + 응답 헤더 부착 + 백그라운드 재수집 트리거
//        services/freshness.js 의 POLICY 에 정의된 데이터(특보/부이/해상기상전망)에 한해
//        응답 헤더(X-Data-Updated-At, X-Data-Age-Seconds, X-Data-Fresh)를 자동 부착하고,
//        허용 묵음 시간을 넘긴 경우 백그라운드(60초 debounce)로 재수집을 트리거한다.
//        응답 body 형식은 변경하지 않으므로 기존 클라이언트 호환성에 영향 없음.
const freshness = require('../services/freshness');

// ============================================================================
// [신규] dmdw 자식 해역 데이터 머지 헬퍼
// ----------------------------------------------------------------------------
// 역할: weather_alerts.json (부모 해역 트리) 의 children 필드를
//       dmdw_alerts.json (자식 해역 상세) 데이터로 덮어쓴 머지 결과를 반환.
//
// 동작 원칙:
//  1. 부모 노드가 발효 중(current !== null) 일 때만 자식 머지 — "무기한 대기 게이트"
//     (부모 통보문이 아직 안 잡혔는데 dmdw 만 먼저 잡은 자식은 노출 보류)
//  2. 디스크 weather_alerts.json 은 절대 수정하지 않음 — 메모리에서만 머지
//     (기존 weather_alerts_crawler.js 의 사전삭제 방어 로직 영향 0)
//  3. dmdw_alerts.json 부재/깨짐 → 머지 skip, 원본 그대로 반환
//
// 머지 후 children 값 변화:
//   "Y"   → { wrnTp, wrnLvl, tmFc, tmEf, parentZone, ... }  (dmdw 데이터로 교체)
//   null  → 그대로 유지 (자식 비활성)
//   "Y" + dmdw 자식 부재 → "Y" 그대로 (기존 동작 fallback)
// ============================================================================
function mergeDmdwChildren(weatherTree, dmdwAlerts) {
    if (!dmdwAlerts || !dmdwAlerts.children || typeof dmdwAlerts.children !== 'object') {
        return weatherTree; // dmdw 데이터 없거나 비정상 → 원본 그대로
    }
    // [S9-C] 백필 미완료 시 자식 머지 보류 — 부모만 응답.
    //  서버 재시작 직후 dmdw 가 직전 24시간 데이터를 백필하는 동안 자식 정보가
    //  불완전할 수 있으므로 일관성을 위해 머지를 잠시 미룬다.
    //  사용자 정책 (해석 ①·A 옵션): 부모 데이터는 끊김 없이 응답, 자식만 ~10~80초
    //  후 백필 완료 시점에 다음 폴링에서 자연 합류.
    if (dmdwAlerts.backfillReady !== true) {
        return weatherTree;
    }
    const dmdwChildren = dmdwAlerts.children;

    // 재귀 함수: tree 의 모든 노드를 훑으며 "current/children 필드를 가진" 부모 노드 발견 시 머지
    function walk(node) {
        if (!node || typeof node !== 'object') return;
        // 이 노드가 zone 노드인가? (current 또는 upcoming + children 보유)
        const hasZoneShape = Object.prototype.hasOwnProperty.call(node, 'current')
                          && Object.prototype.hasOwnProperty.call(node, 'children');
        if (hasZoneShape) {
            // 게이트: 부모 발효 중일 때만 머지 (current 가 객체)
            const parentActive = node.current !== null && typeof node.current === 'object';
            if (parentActive && node.children && typeof node.children === 'object') {
                for (const childKey of Object.keys(node.children)) {
                    const dmdwState = dmdwChildren[childKey];
                    if (dmdwState && typeof dmdwState === 'object') {
                        // dmdw 가 이 자식의 정밀 상태를 알고 있음 → 덮어쓰기
                        node.children[childKey] = dmdwState;
                    }
                    // dmdw 에 없으면 기존 "Y"/null 그대로 유지 (부모 상속 fallback)
                }
            }
        }
        // 자식 노드들 재귀 (zone 노드든 그룹 노드든 무관)
        for (const v of Object.values(node)) {
            if (v && typeof v === 'object' && !Array.isArray(v)) walk(v);
        }
    }
    if (weatherTree && weatherTree.current && typeof weatherTree.current === 'object') {
        walk(weatherTree.current);
    }
    return weatherTree;
}

// ============================================================================
// [S10-D] /api/weather-alerts 하이브리드 메모리 캐시 (M4 + M6 동시 해결)
// ----------------------------------------------------------------------------
// [배경]
//  매 요청마다 weather_alerts.json + dmdw_alerts.json 두 파일을 디스크에서
//  sync read 하고 머지·stringify 하면, Node.js 단일 스레드 특성상 동시 요청이
//  많아질 때 누적 지연이 커진다 (사용자 100명 동시 ≈ 100~300ms 지연, 1000명
//  ≈ 4초). 사용자 트래픽이 늘어날수록 명확한 병목.
//
// [방식 — 하이브리드 (변경 감지 + stat 캐시)]
//  1) 응답 결과(JSON string)를 메모리에 보관.
//  2) 매 요청 시 (현재 시각 - 마지막 stat 시각) < 1초 → stat 도 생략, 캐시 즉시 반환.
//  3) 1초 지난 첫 요청 시 stat 1회 → 두 파일 mtime 이 캐시한 시각과 같으면 캐시 유지.
//                              → mtime 다르면 read + merge + stringify → 캐시 갱신.
//
// [성능 — 사용자 1000명 동시 시점]
//  무캐시:    1000 × read 2회 ≈ 4초
//  하이브리드: 1000 × 메모리 응답 ≈ 10ms (1초 안의 첫 요청만 stat)
//
// [M6 자동 해결]
//  캐시를 string 으로 보관 → mergeDmdwChildren 이 mutate 해도 다음 캐시 갱신 시
//  새 JSON.parse 객체에 적용되므로 격리. 객체 mutate 부작용 0.
//
// [데이터 신선도]
//  최대 1초 stale 가능 (stat 캐시 구간). 우리 데이터는 분 단위 갱신이라
//  1초 차이는 의미 없음.
// ============================================================================
const STAT_CACHE_TTL_MS = 1000;  // stat 호출 자체도 1초 캐시
const _weatherCache = {
    responseJson: null,    // 캐시된 응답 JSON 문자열 (res.send 대상)
    weatherMtime: 0,       // 캐시 만들 때의 weather_alerts.json mtime (ms)
    dmdwMtime: 0,          // 캐시 만들 때의 dmdw_alerts.json mtime (ms)
    lastStatAt: 0          // 마지막 stat 호출 시각 (Date.now ms)
};

/**
 * 캐시된 응답을 반환하거나 필요 시 새로 빌드.
 *  - null 반환 시: weather_alerts.json 부재 또는 파싱 실패 → 호출자가 fallback 처리
 *  - string 반환 시: 그대로 res.send 가능 (Content-Type: application/json)
 */
function getWeatherAlertsResponse() {
    const now = Date.now();

    // [1단계] stat 도 1초 캐시 — 최근 1초 안에 검사했으면 stat 도 생략
    if (_weatherCache.responseJson && (now - _weatherCache.lastStatAt) < STAT_CACHE_TTL_MS) {
        return _weatherCache.responseJson;
    }

    // [2단계] stat 으로 두 파일 mtime 확인 (파일 내용은 안 읽음 — 매우 가벼움)
    const weatherPath = path.join(DATA_DIR, 'weather_alerts.json');
    const dmdwPath = path.join(DATA_DIR, 'dmdw_alerts.json');

    let weatherMtime = 0;
    try { weatherMtime = fs.statSync(weatherPath).mtimeMs; } catch (e) { /* 파일 없음 */ }
    let dmdwMtime = 0;
    try { dmdwMtime = fs.statSync(dmdwPath).mtimeMs; } catch (e) { /* 파일 없음 — 0 유지 */ }

    _weatherCache.lastStatAt = now;

    // [3단계] mtime 변경 없으면 캐시 그대로 반환
    if (_weatherCache.responseJson
        && weatherMtime === _weatherCache.weatherMtime
        && dmdwMtime === _weatherCache.dmdwMtime) {
        return _weatherCache.responseJson;
    }

    // [4단계] 파일이 바뀜 — 새로 read + merge + stringify
    if (weatherMtime === 0) {
        // weather_alerts.json 자체 부재 → null 반환 → 호출자가 404 처리
        return null;
    }

    let weatherTree;
    try {
        weatherTree = JSON.parse(fs.readFileSync(weatherPath, 'utf8'));
    } catch (parseErr) {
        console.log(`[/api/weather-alerts] parse fail (${parseErr.message}) → fallback`);
        return null; // 호출자 fallback (sendFile)
    }

    if (dmdwMtime > 0) {
        try {
            const dmdwAlerts = JSON.parse(fs.readFileSync(dmdwPath, 'utf8'));
            mergeDmdwChildren(weatherTree, dmdwAlerts);
        } catch (mergeErr) {
            console.log(`[/api/weather-alerts] dmdw merge skip (${mergeErr.message})`);
        }
    }

    _weatherCache.responseJson = JSON.stringify(weatherTree);
    _weatherCache.weatherMtime = weatherMtime;
    _weatherCache.dmdwMtime = dmdwMtime;
    return _weatherCache.responseJson;
}

// 1. 특보 정보 (통합 크롤러 데이터)
//    [신선도] cacheKey='warnings' — 1분 주기 수집, 5분 안쪽이면 fresh.
//             stale 감지 시 weatherAlertsCrawler.run() 을 백그라운드로 트리거.
//    [HTTP 캐시] max-age=30 — 30초 동안은 브라우저/앱이 자체 캐시 사용 → 서버 부담 ↓
//                특보는 1분 주기 수집이라 30초 캐시 시 최대 묵음 약 30초.
//    [서버 메모리 캐시] 1초 stat 캐시 + mtime 변경 감지 — 동시 트래픽 폭주 시 결정적.
router.get('/api/weather-alerts', (req, res) => {
    try {
        // 응답 헤더는 res.send / res.json / res.sendFile 호출 전에 부착해야 함
        res.setHeader('Cache-Control', 'public, max-age=30');
        freshness.applyFreshnessHeaders(res, 'warnings');
        freshness.triggerRefreshIfStale('warnings');

        const cachedJson = getWeatherAlertsResponse();
        if (cachedJson === null) {
            // 캐시 빌드 실패 — fallback: 원본 파일 직접 전송 (이전 동작)
            const filePath = path.join(DATA_DIR, 'weather_alerts.json');
            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ error: 'weather_alerts.json not found' });
            }
            return res.sendFile(filePath);
        }

        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.send(cachedJson);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 1-1. 해상 예특보구역 폴리곤 (정적 GeoJSON)
//      해양종합정보 지도의 "특보구역" 토글 버튼이 호출
//      KMA marine 포털(geoserver/mmis/wms)의 mmis:shp_wrn_poly 레이어를
//      WFS GetFeature 로 1회 받아 저장한 GeoJSON. 행정 경계 변경 시에만 갱신.
//      [경로 주의] DATA_DIR(=local_server/data) 은 Fly.io persistent volume
//                  으로 마운트되어 있어 이미지에 포함된 정적 파일이 가려진다.
//                  → assets/ 디렉터리에서 읽어야 production 에서도 노출됨.
router.get('/api/warn-zones', (req, res) => {
    try {
        const filePath = path.join(__dirname, '..', 'assets', 'warn_zones.geojson');
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'warn_zones.geojson not found' });
        }
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.sendFile(filePath);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 1-1b. 해상 단기예보(sterm) 전용 zone polygon 모음
//        KMA marine.kma.go.kr 의 WFS mmis:fcst_area 에서 sterm 발표 zone(44개)
//        + 자식 영역(평수구역/연안바다 등) 까지 포함해 총 112 feature.
//        properties.sterm_parent → sea/sterm/list 응답의 kor_nm 와 매칭 키.
//        [용도] js/shrt_forecast_layer.js 에서 단기예보 zone fill 용 polygon 으로 사용.
//        [근거] warn_zones.geojson 의 polygon 은 polygon 단순화 정도가 거칠어
//               marine.kma.go.kr 와 외곽선이 다름 → KMA 원본 폴리곤으로 보정.
router.get('/api/sea-sterm-zones', (req, res) => {
    try {
        const filePath = path.join(__dirname, '..', 'assets', 'sea_sterm_zones.geojson');
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'sea_sterm_zones.geojson not found' });
        }
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.sendFile(filePath);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 1-2. 해상 예특보구역의 자식 구역 (연안바다/평수구역) 폴리곤
//      KMA mmis:warnArea2Poly202106 레이어 (WFS) 의 GeoJSON.
//      특보구역 토글이 켜진 상태에서 충분히 줌인하면 표시됨.
router.get('/api/warn-zones-sub', (req, res) => {
    try {
        const filePath = path.join(__dirname, '..', 'assets', 'warn_zones_sub.geojson');
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'warn_zones_sub.geojson not found' });
        }
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.sendFile(filePath);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 2. 부이 정보 (sea_obs.php — J타입 baseline)
//    [신선도] cacheKey='buoys' — 30분 주기 수집, 60분 안쪽이면 fresh.
//             stale 감지 시 scheduler.collectBuoys() 를 백그라운드로 트리거.
//    [HTTP 캐시] 정상 응답에만 max-age=300 (5분) 부착.
//                "데이터 준비 중" 404 응답은 no-store 로 캐시 차단 →
//                실제 데이터가 곧 준비되어도 사용자가 옛 404 를 계속 보지 않도록 보호.
router.get('/api/buoys', (req, res) => {
    freshness.applyFreshnessHeaders(res, 'buoys');
    freshness.triggerRefreshIfStale('buoys');
    if (!dataCache.buoys) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(404).json({ error: '데이터 준비 중' });
    }
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(dataCache.buoys);
});

// 2-1. 부이 상세 파고 정보 (kma_buoy.php)
//
// [DEPRECATED 2026-04-25]
//   더 이상 갱신되지 않는 캐시(scheduler.collectKmaBuoys 가 noop 처리됨).
//   라우트 자체는 외부 호환을 위해 유지하되, dataCache.kmaBuoys 는 마지막 성공
//   시점의 stale 데이터일 수 있음. 신규 정보는 /api/marine-buoys 로 이동.
router.get('/api/kma-buoys', (req, res) => {
    if (dataCache.kmaBuoys) res.json(dataCache.kmaBuoys);
    else res.status(404).json({ error: '데이터 준비 중' });
});

// 2-2. marine.kma.go.kr JSON endpoint 캐시 응답 (신규 2026-04-25)
//   - 매시 정시 +3분 KST 에 scheduler.collectMarine* 가 저장한 JSON 을 그대로 반환
//   - 클라이언트(js/data.js fetchMarineBuoyData)가 sea_obs baseline 위에 머지
// [신선도] marine 부이 3종 — 모두 매시 정시 +3분에 수집(60분 주기), 90분 안쪽이면 fresh.
//          stale 감지 시 각자의 scheduler.collectMarine*() 를 백그라운드로 트리거.
// [HTTP 캐시] 정상 응답에만 max-age=600 (10분) 부착, "데이터 준비 중" 404 는 no-store.
router.get('/api/marine-buoys', (req, res) => {
    freshness.applyFreshnessHeaders(res, 'marineBuoys');
    freshness.triggerRefreshIfStale('marineBuoys');
    if (!dataCache.marineBuoys) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(404).json({ error: '데이터 준비 중' });
    }
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.json(dataCache.marineBuoys);
});
/**
 * [GET /api/marine-wh-buoys]
 * 파고 부이(WH = Wave Height) 메타 데이터 응답. dataCache.marineWhBuoys 사용.
 * 부이 마커 표시 + 상세 모달의 항목 결정 데이터.
 */
router.get('/api/marine-wh-buoys', (req, res) => {
    freshness.applyFreshnessHeaders(res, 'marineWhBuoys');
    freshness.triggerRefreshIfStale('marineWhBuoys');
    if (!dataCache.marineWhBuoys) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(404).json({ error: '데이터 준비 중' });
    }
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.json(dataCache.marineWhBuoys);
});
/**
 * [GET /api/marine-lh-buoys]
 * 등표(LH = Light House) 부이 메타 데이터 응답. dataCache.marineLhBuoys 사용.
 * 등표는 일반 부이보다 항해 안전 우선이라 별도 분리 제공.
 */
router.get('/api/marine-lh-buoys', (req, res) => {
    freshness.applyFreshnessHeaders(res, 'marineLhBuoys');
    freshness.triggerRefreshIfStale('marineLhBuoys');
    if (!dataCache.marineLhBuoys) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(404).json({ error: '데이터 준비 중' });
    }
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.json(dataCache.marineLhBuoys);
});
/**
 * [GET /api/marine-vs]
 * 가시거리(VS = Visibility) 관측 데이터 응답. 안개/시정 정보용.
 * 안개구역 + CCTV 안개 표출과 연계.
 */
router.get('/api/marine-vs', (req, res) => {
    // 시정계 station — 본 단계에선 캐시·라우트만, UI 표시는 후속 작업
    if (dataCache.marineVs) res.json(dataCache.marineVs);
    else res.status(404).json({ error: '데이터 준비 중' });
});

// 2-2. API 상태 확인
router.get('/api/status', (req, res) => {
    res.json(scheduler.getStatus());
});

// 2-1. 수동 업데이트 (SSE 스트리밍 진행 상황)
router.get('/api/force-update/:type/stream', async (req, res) => {
    const type = req.params.type;
    console.log(`🔄 수동 업데이트 SSE 요청: ${type}`);

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });

    const onProgress = (data) => {
        if (data.type === type) {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
    };
    scheduler.collectProgress.on('progress', onProgress);

    // 30초마다 하트비트 전송 — Fly.io 프록시 60초 idle timeout 방지
    // SSE 규격에서 ':'로 시작하는 줄은 코멘트로 클라이언트에서 무시됨
    const heartbeat = setInterval(() => {
        try { res.write(': keepalive\n\n'); } catch (_) {}
    }, 30000);

    req.on('close', () => {
        clearInterval(heartbeat);
        scheduler.collectProgress.off('progress', onProgress);
    });

    try {
        if (type === 'buoys') {
            // [2026-04-25] sea_obs.php(J타입 baseline) 유지 + marine 4종(B/C/L + 시정계).
            //   collectKmaBuoys 는 DEPRECATED — 호출해도 즉시 return (호환 유지).
            await scheduler.collectBuoys();
            await scheduler.collectKmaBuoys();           // noop (deprecated)
            await scheduler.collectMarineBuoys();
            await scheduler.collectMarineWhBuoys();
            await scheduler.collectMarineLhBuoys();
            await scheduler.collectMarineVs();
        }
        else if (type === 'general') {
            await scheduler.collectGeneralForecasts();
            await scheduler.collectMidTermSeaForecasts();
            // 지방기상청 단기예보도 함께 수집 (진행률 포함)
            await regionalForecastCollector.collectRegionalForecasts(scheduler.collectProgress);
        }
        else if (type === 'zone') await scheduler.collectZoneForecasts();
        // 해양생활기상 수동 수집 — 바다낚시 지수 + 바다갈라짐 체험지수 + 서핑지수를 순차적으로 함께 수집
        // 관리자 페이지에서 "해양생활기상" 수동 호출 시 세 API가 한번에 실행됨
        else if (type === 'fishing') {
            await scheduler.collectFishingIndex();
            await scheduler.collectSeaSplitIndex();
            await scheduler.collectSurfingIndex();
        }
        else {
            res.write(`data: ${JSON.stringify({ error: '잘못된 타입' })}\n\n`);
            res.end();
            return;
        }

        refreshCache();
        res.write(`data: ${JSON.stringify({ done: true, status: scheduler.getStatus()[type] })}\n\n`);
    } catch (e) {
        res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    } finally {
        clearInterval(heartbeat);
        scheduler.collectProgress.off('progress', onProgress);
        res.end();
    }
});

// 2-1-b. 수동 업데이트 (기존 POST 호환)
router.post('/api/force-update/:type', async (req, res) => {
    const type = req.params.type;
    console.log(`🔄 수동 업데이트 요청: ${type}`);
    try {
        if (type === 'buoys') {
            // [2026-04-25] 위 SSE 분기와 동일 — marine 4종 추가, kma_buoy 는 noop 유지
            await scheduler.collectBuoys();
            await scheduler.collectKmaBuoys();
            await scheduler.collectMarineBuoys();
            await scheduler.collectMarineWhBuoys();
            await scheduler.collectMarineLhBuoys();
            await scheduler.collectMarineVs();
        }
        else if (type === 'general') {
            await scheduler.collectGeneralForecasts();
            await scheduler.collectMidTermSeaForecasts();
            // 지방기상청 단기예보도 함께 수집
            await regionalForecastCollector.collectRegionalForecasts();
        }
        else if (type === 'zone') await scheduler.collectZoneForecasts();
        // 해양생활기상 수동 수집 (POST 호환) — 바다낚시 지수 + 바다갈라짐 + 서핑지수를 순차 실행
        else if (type === 'fishing') {
            await scheduler.collectFishingIndex();
            await scheduler.collectSeaSplitIndex();
            await scheduler.collectSurfingIndex();
        }
        else return res.status(400).json({ error: '잘못된 타입' });

        refreshCache();
        res.json({ success: true, status: scheduler.getStatus()[type] });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 2-1-c. 지방청 수집 디버그 로그 조회
router.get('/api/regional-debug', (req, res) => {
    const debugDir = require('path').join(__dirname, '..', 'data', 'debug_pdf');
    const fs = require('fs');
    const result = { debugDir, exists: fs.existsSync(debugDir), files: [], contents: {} };
    try {
        if (result.exists) {
            result.files = fs.readdirSync(debugDir);
            for (const f of result.files) {
                try {
                    result.contents[f] = fs.readFileSync(require('path').join(debugDir, f), 'utf8');
                } catch (_) {}
            }
        }
    } catch (e) {
        result.error = e.message;
    }
    res.json(result);
});


// 2-2. API 인증키 설정 조회
router.get('/api/config', (req, res) => {
    try {
        res.json(scheduler.getConfig());
    } catch (e) {
        res.status(500).json({ error: '설정 조회 실패' });
    }
});

// 2-2. API 인증키 설정 저장
router.post('/api/config', (req, res) => {
    try {
        const success = scheduler.updateConfig(req.body);
        if (success) res.json({ success: true });
        else res.status(500).json({ error: '저장 실패' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 3. 기상 전망 (일반예보 — 하루 2회 수집: 05:15, 17:15)
//    [HTTP 캐시] 정상 응답에만 max-age=1800 (30분) 부착, "데이터 준비 중" 404 는 no-store.
router.get('/api/forecasts', (req, res) => {
    if (!dataCache.forecasts) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(404).json({ error: '데이터 준비 중' });
    }
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.json(dataCache.forecasts);
});

// 4. 해구별 기상전망
//    [수집 주기] 하루 2회 (09:30, 21:30 KST), zone_forecasts.json
//    [응답 크기] 약 3.18 MB (압축 후 ~452 KB) — 큰 응답이라 캐시 효과 큼
//    [HTTP 캐시] 정상 응답에만 max-age=1800 (30분), 빈 응답은 no-store.
//                zone_avg.js 는 자체 cache:'no-store' 로 강제 우회 — 영향 없음.
router.get('/api/marine-zone-forecasts', (req, res) => {
    if (!dataCache.zoneForecasts) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(404).json({ error: '데이터 준비 중' });
    }
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.json(dataCache.zoneForecasts);
});

// 4-1. 중기해상예보
//    [수집 주기] 하루 2회 (06:15, 18:15 KST), mid_term_sea_forecasts.json
//    [HTTP 캐시] 정상 응답에만 max-age=1800 (30분), 빈 응답은 no-store.
router.get('/api/mid-term-sea-forecasts', (req, res) => {
    if (!dataCache.midTermSeaForecasts) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(404).json({ error: '데이터 준비 중' });
    }
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.json(dataCache.midTermSeaForecasts);
});

// 5. 해상 기상 전망 (초단기/단기)
//    [신선도] cacheKey='marineForecasts' — 매 10분 수집, 30분 안쪽이면 fresh.
//             stale 감지 시 marine_forecast_processor.collectMarineForecasts() 를 백그라운드로 트리거.
//    [HTTP 캐시] max-age=180 (3분) — 10분 주기 수집의 1/3.3, 신선도와 캐시 효과 균형
router.get('/api/marine-forecast', (req, res) => {
    try {
        const filePath = path.join(DATA_DIR, 'marine_forecast.json');
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'marine_forecast.json not found' });
        }
        res.setHeader('Cache-Control', 'public, max-age=180');
        freshness.applyFreshnessHeaders(res, 'marineForecasts');
        freshness.triggerRefreshIfStale('marineForecasts');
        res.sendFile(filePath);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 5-1. 지방기상청 단기 전망 + 해상예보(먼바다/앞바다)
//    [수집 주기]
//      - 단기 전망(summary/temperature): 통보문 — KST 04:01~04:56 / 16:01~16:56 5분 간격
//      - PDF marine/coastal           : KST 05:10 / 11:10 / 17:10
//      두 수집기가 같은 regional_forecast.json 을 partial-merge 로 공유.
//    [HTTP 캐시] max-age=60 (1분).
//      통보문 발표(04:30, 16:20~16:30) 직후 1분 안에 사용자 화면에 반영되도록 단축.
//      이전엔 600초(10분)라 04:31 갱신 데이터가 최대 04:35~04:39 까지 옛 값으로
//      보이는 문제가 있었음. JSON 정적 송출이라 1분 캐시도 부담 없음.
router.get('/api/regional-forecast', (req, res) => {
    try {
        const filePath = path.join(DATA_DIR, 'regional_forecast.json');
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'regional_forecast.json not found' });
        }
        res.setHeader('Cache-Control', 'public, max-age=60');
        res.sendFile(filePath);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 5-2. 먼바다 해상예보 (PDF 파싱 데이터)
router.get('/api/regional-marine-forecast', (req, res) => {
    try {
        const data = regionalForecastCollector.loadMarineForecasts();
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 5-3. 앞바다 해상예보 (PDF 파싱 데이터)
router.get('/api/regional-coastal-forecast', (req, res) => {
    try {
        const data = regionalForecastCollector.loadCoastalForecasts();
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 6. 통보문 캐시 조회 (특보 히스토리 팝업 → 아코디언 펼침 시 호출)
// collect_cache 디렉토리에 저장된 통보문별 AI 분석 결과를 반환
// reportId 예: "met:202602162000:141" → 파일명: "met_202602162000_141.json"
router.get('/api/bulletin-cache/:reportId', (req, res) => {
    try {
        const reportId = decodeURIComponent(req.params.reportId);
        const cacheFileName = reportId.replace(/[/:]/g, '_') + '.json';
        const cachePath = path.join(DATA_DIR, 'collect_cache', cacheFileName);

        if (!fs.existsSync(cachePath)) {
            return res.status(404).json({ error: '캐시 데이터 없음', reportId });
        }

        const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        res.json(cacheData);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 7. 해상 전망 캐시 목록 조회 (초단기/단기 전망 통보문 수집 결과)
const marineForecast = require('../marine_forecast_processor');

router.get('/api/forecast-cache/list', (req, res) => {
    try {
        res.json(marineForecast.listForecastCaches());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 8. 해상 전망 캐시 상세 조회 (원문 + 코드 추출 + AI 분석 결과)
router.get('/api/forecast-cache/:reportId', (req, res) => {
    try {
        const reportId = decodeURIComponent(req.params.reportId);
        const data = marineForecast.loadForecastCache(reportId);
        if (!data) return res.status(404).json({ error: '캐시 데이터 없음', reportId });
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 9. 해상 전망 재수집 (관리자용)
router.post('/api/marine-forecast/refresh', async (req, res) => {
    try {
        await marineForecast.collectMarineForecasts();
        res.json({ success: true, message: '해상 기상 전망 재수집 완료' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 10. 개별 전망 통보문 수집 (관리자용 - 특정 reportId 수집)
router.post('/api/admin/forecast-collect', async (req, res) => {
    try {
        const { reportId, title } = req.body;
        if (!reportId) return res.status(400).json({ success: false, error: 'reportId 필요' });

        // 통보문 상세 조회
        const parts = reportId.split(':');
        const dateStr = parts[1] || '';
        const dateParam = dateStr.substring(0, 4) + '-' + dateStr.substring(4, 6) + '-' + dateStr.substring(6, 8);
        const url = `https://www.weather.go.kr/w/special-report/list.do?stn=108&date=${dateParam}`;

        // fetchForecastDetail을 직접 호출하기 위해 내부 함수 재현
        const https = require('https');
        const fetchHtml = (u) => new Promise((resolve, reject) => {
            https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (resp) => {
                const chunks = [];
                resp.on('data', c => chunks.push(c));
                resp.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
            }).on('error', reject);
        });

        // 상세 페이지에서 원문 가져오기 (기상청은 list.do에 reportId를 전달하여 상세 조회)
        const detailUrl = `https://www.weather.go.kr/w/special-report/list.do?prevStn=108&stn=108&date=${dateParam}&reportId=${reportId}`;
        const html = await fetchHtml(detailUrl);

        // 전망 기간 추출
        let forecastPeriod = '';
        const periodMatch = html.match(/※\s*(\d{1,2}월\s*\d{1,2}일[^<]*?까지의\s*전망[^<.]*\.?)/);
        if (periodMatch) forecastPeriod = '※ ' + periodMatch[1].replace(/\s+/g, ' ').trim();

        // 발표 시각 추출
        let publishTime = '';
        const ts = parts[1] || '';
        if (ts.length >= 12) publishTime = `${ts.substring(4, 6)}.${ts.substring(6, 8)}. ${ts.substring(8, 10)}:${ts.substring(10, 12)}`;

        // 본문 텍스트 추출
        let contentHtml = '';
        const patterns = [
            /<div class="cmp-view-content">([\s\S]*?)<\/div>\s*<\/section>/,
            /<div class="cmp-view-content">([\s\S]*?)<\/div>\s*<\/div>/,
            /<div class="cmp-view-content">([\s\S]*)<\/div>/,
        ];
        for (const p of patterns) {
            const m = html.match(p);
            if (m && m[1] && m[1].trim().length > 20) { contentHtml = m[1]; break; }
        }

        let rawText = contentHtml
            .replace(/<p[^>]*>/g, '\n').replace(/<\/p>/g, '\n').replace(/<br\s*\/?>/g, '\n')
            .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
            .replace(/[ ]+/g, ' ').trim();

        // 카테고리 추출
        const codeCategories = marineForecast.extractCategories(rawText);
        const hasContent = Object.keys(codeCategories).length > 0;

        // AI 분석
        let aiResult = null;
        const hasMarineKeywords = /강풍|바다\s*안개|해상|너울/.test(rawText);
        if (hasContent && hasMarineKeywords) {
            aiResult = await marineForecast.analyzeWithAI(rawText, codeCategories);
        }

        // 최종 카테고리 결정
        const finalCategories = (aiResult && aiResult.categories) ? aiResult.categories : (hasContent ? codeCategories : null);

        // 전망 타입 판별
        const isUltraShort = /초단기/.test(title || '');
        const typeLabel = isUltraShort ? '초단기전망' : '단기전망';

        const forecastData = {
            reportId, title: title || '', type: typeLabel,
            publishTime, forecastPeriod, rawText,
            codeCategories: hasContent ? codeCategories : null,
            aiResult, categories: finalCategories,
            hasContent: hasContent || !!(aiResult && aiResult.categories && Object.keys(aiResult.categories).length > 0)
        };

        // 캐시 저장
        marineForecast.saveForecastCache(reportId, forecastData);

        // marine_forecast.json도 갱신 (프론트 표출용)
        try {
            const dataFilePath = path.join(__dirname, '..', 'data', 'marine_forecast.json');
            let forecasts = { ultraShort: null, shortTerm: null, updatedAt: '' };
            if (fs.existsSync(dataFilePath)) {
                forecasts = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));
            }
            if (isUltraShort) {
                forecasts.ultraShort = forecastData;
            } else {
                forecasts.shortTerm = forecastData;
            }
            forecasts.updatedAt = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
            const dataDir = path.dirname(dataFilePath);
            if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
            fs.writeFileSync(dataFilePath, JSON.stringify(forecasts, null, 2), 'utf8');
        } catch (updateErr) {
            console.error('[Admin] marine_forecast.json 갱신 오류:', updateErr.message);
        }

        res.json({ success: true, data: forecastData });
    } catch (e) {
        console.error('[Admin] 전망 수집 오류:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. KMA 단기예보 PNG 프록시 (천기 — 클라이언트 픽셀 sampling 용)
// ─────────────────────────────────────────────────────────────────────────────
//
// [무엇을 하나?]
//   KMA marine.kma.go.kr 의 단기예보 PNG 를 그대로 클라이언트로 흘려보내되
//   브라우저가 canvas getImageData 를 쓸 수 있도록 CORS 헤더를 부착.
//   서버는 디코딩하지 않고 단순히 byte stream 을 통과시킴 → 메모리/CPU 부담 0.
//
// [왜 필요한가?]
//   천기 클릭 팝업은 클릭한 좌표의 5개 카테고리 데이터를 추출해야 함.
//   KMA PNG 는 응답에 Access-Control-Allow-Origin 헤더가 없어서 브라우저
//   canvas 에 그리면 "tainted canvas" 가 되어 getImageData 가 차단됨.
//   우리 서버가 같은 PNG 를 받아 CORS 헤더를 추가해 재전송하면 브라우저가
//   crossOrigin="anonymous" 로 로드하여 canvas 픽셀 추출 가능.
//
// [요청 파라미터]
//   - path (필수): KMA PNG 의 path. 보안 위해 prefix 를 화이트리스트로 제한.
//                  예: /resources/fct/shrt_gemd_img/202605/03/14/DFS_..._POP_H024.png
//
// [캐시]
//   - HTTP Cache-Control: public, max-age=3600 → 브라우저가 1시간 자동 캐시.
//     같은 PNG 재방문 시 우리 서버 / KMA 호출 0 회.
//
// [의존]
//   - node-fetch (transitive 의존, 다른 라우트에서도 이미 사용)
const _kmaPngFetch = require('node-fetch');
router.get('/api/kma-png-proxy', async (req, res) => {
    try {
        const path = (req.query.path || '').trim();
        // 보안: KMA 의 단기예보 PNG 경로만 허용 (다른 임의 경로 프록시 방지)
        if (!path.startsWith('/resources/fct/shrt_gemd_img/')) {
            return res.status(400).send('invalid path');
        }
        const upstreamUrl = 'https://marine.kma.go.kr' + path;
        const upstream = await _kmaPngFetch(upstreamUrl, { timeout: 20000 });
        if (!upstream.ok) return res.status(502).send('upstream ' + upstream.status);
        res.set({
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=3600',
            'Access-Control-Allow-Origin': '*'
        });
        // node-fetch v2 의 res.body 는 Node.js Readable stream — pipe 로 그대로 흘림
        upstream.body.pipe(res);
    } catch (e) {
        console.error('[kma-png-proxy] 실패:', e.message);
        res.status(500).send('proxy error');
    }
});

module.exports = router;
