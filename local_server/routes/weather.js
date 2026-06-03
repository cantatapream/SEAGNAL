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
// [성능 캐시] 해구별 기상전망(5.86MB) 응답을 데이터 갱신 시 1회만 미리 gzip/brotli
//   압축해 메모리에 보관하기 위해 Node 내장 zlib 을 사용한다. (요청당 실시간 압축 제거)
const zlib = require('zlib');
const { DATA_DIR } = require('../config/server_config');
const { dataCache, refreshCache } = require('../services/cache_manager');
const scheduler = require('../scheduler');
const regionalForecastCollector = require('../regional_forecast_collector');
const marineClient = require('../services/marine_client');   // [통보문] ef/list (해역별 통보문 PDF) 조회용
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
//   객체  → { ...dmdw, tmFc: 종합기상 객체의 tmFc }          (V3 — tmFc 영구 유지)
//   null  → 그대로 유지 (자식 비활성)
//   객체 + dmdw 부재 → 객체 그대로 (V3 종합기상 출처만)
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
                    const bulletinState = node.children[childKey];
                    if (dmdwState && typeof dmdwState === 'object') {
                        // [V3] 머지 정책: tmFc 는 종합기상 우선(영구 유지), 그 외는 dmdw 우선.
                        //   - 종합기상 객체 + dmdw 객체 모두 존재: tmFc 종합기상, 나머지 dmdw.
                        //   - 종합기상 'Y' (후방호환) 또는 부재: dmdw 그대로.
                        const bulletinTmFc = (bulletinState && typeof bulletinState === 'object')
                            ? (bulletinState.tmFc || '') : '';
                        const merged = {
                            ...dmdwState,
                            source: 'BULLETIN_TEXT+DMDW'
                        };
                        if (bulletinTmFc) {
                            merged.tmFc = bulletinTmFc;
                        }
                        node.children[childKey] = merged;
                    }
                    // dmdw 에 없으면 종합기상 객체/null/'Y' 그대로 유지 (V3 종합기상 출처만 노출).
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
        // [캐시 정책] no-cache + must-revalidate
        //   기존: max-age=86400 (24h) — geojson 갱신 시 클라이언트가 OLD URL 응답을
        //         24h 동안 캐시해 새 _holedGeometry 가 안 닿는 사고 발생 (V3.3+S13-F 직후).
        //   변경: no-cache 로 매 요청 서버 revalidate. ETag/Last-Modified 기반 304
        //         (32 bytes) 처리되어 비용 거의 없음. 변경 시 즉시 200 with 새 데이터.
        //   효과: 클라이언트 ?v= 캐시버스트 키에 의존하지 않게 됨 → 향후 갱신 시
        //         수동 v 키 bump 불필요 (배포만 하면 다음 요청부터 새 데이터).
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
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
        // [캐시 정책] 위 /api/warn-zones 와 동일 사유 — no-cache + must-revalidate.
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
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

// ============================================================================
// [성능 캐시] marine-zone-forecasts 응답 JSON 문자열 + 사전 압축본 캐시
// ----------------------------------------------------------------------------
// 역할:
//   /api/marine-zone-forecasts 요청이 들어올 때마다 5.86MB 짜리 객체를
//   JSON.stringify() 하는 비용(요청당 약 50~150ms CPU)을 제거하기 위해,
//   미리 만들어둔 JSON 문자열을 메모리에 보관해 두고 그대로 재사용한다.
//
//   [추가 — 압축본 사전 생성]
//   여기에 더해, gzip / brotli 로 "미리 압축한 버퍼" 까지 함께 만들어 둔다.
//   기존에는 응답 문자열(5.86MB)을 그대로 보내면 compression() 미들웨어가
//   "매 요청마다 실시간 gzip 압축"(요청당 약 50~100ms CPU)을 수행했다.
//   전원 푸시 후 200~300명이 동시에 들어오면 이 압축 CPU 가 누적되어 10~20초가
//   되고, "특보구역 평균 파고/풍속"(zone_avg.js) 표시가 1~3초 지연됐다.
//   → 데이터 갱신 시(하루 2회)에만 1회 미리 압축해 두고, 요청 시에는 그 버퍼를
//     그대로 전송하면 요청당 압축 CPU 가 0 이 된다.
//
// 비유:
//   "식당 카운터에 메뉴판 1장(원본)뿐 아니라, 우편 발송용으로 미리 접어서
//    봉투에 넣어둔 버전(gzip)·진공 압축한 버전(brotli)까지 같이 준비해 둔다.
//    손님이 '압축본 주세요' 하면 그때 접는 게 아니라 이미 접어둔 걸 그대로 건넴.
//    메뉴(=zone_forecasts.json 파일)가 바뀌면 그때만 셋 다 다시 만든다."
//
// 동작 원리:
//   - dataCache.lastUpdate.zoneForecasts (= 파일 mtime) 이 변하지 않았으면
//     캐시된 문자열/압축본을 그대로 반환 → stringify·압축 모두 생략
//   - 파일이 갱신되면 (하루 2회: 09:30, 21:30 KST) mtime 이 변하므로
//     다음 첫 요청 1건에서만 새로 stringify + gzip + brotli 후 캐시 갱신
//
// compression 미들웨어와의 관계 (이중 압축 방지):
//   라우트가 응답에 Content-Encoding(gzip/br) 헤더를 직접 붙이면,
//   compression() 미들웨어는 표준 동작상 "이미 인코딩된 응답" 으로 보고
//   재압축을 건너뛴다. (server_config.js 주석의 A 케이스와 동일 원리)
//   따라서 사전 압축본을 보내도 이중 압축 위험이 없다.
//
// 메모리 비용:
//   원본 문자열 약 5.86 MB + gzip 약 0.45 MB + brotli 약 0.45 MB ≈ 6.8 MB.
//   (fly.io 1GB 머신 기준 약 0.7% — 무시 가능)
// ============================================================================
const _zoneForecastsCache = {
    responseJson: null,    // 캐시된 JSON 문자열 (압축 미지원 클라이언트 fallback 용)
    gzipBuffer: null,      // zlib.gzipSync 로 미리 압축한 버퍼 (gzip 지원 클라이언트용)
    brotliBuffer: null,    // zlib.brotliCompressSync 로 미리 압축한 버퍼 (br 지원용)
    builtAtMtime: 0        // 이 캐시를 만들 때의 zone_forecasts.json mtime (ms)
};

// ----------------------------------------------------------------------------
// [이슈 3 — Thundering Herd 보호 플래그]
// ----------------------------------------------------------------------------
// 데이터 갱신 직후, 한꺼번에 들어온 동시 요청들이 모두 캐시 미스로 판정되어
// 각각 5.86MB JSON.stringify() + gzip + brotli 압축을 시도하면 수백 ms 동안
// 이벤트 루프가 막혀 다른 요청의 응답이 지연되는 현상을 방지한다.
//
// 작동 방식:
//   - 빌드(stringify+압축)가 진행 중인 동안 들어온 요청은, "옛 캐시" 가 남아
//     있다면 그것을 반환한다 (= stale-while-revalidate). 사용자가 보는 데이터는
//     그 짧은 빌드 시간만큼만 옛것이며 다음 요청부터는 새 캐시가 응답된다.
//   - Node.js 단일 스레드이므로 stringify+압축이 동기적으로 atomic 하게 끝난다.
//     따라서 동기 함수 내에서 플래그가 누수될 일은 거의 없지만, 만에 하나
//     예외를 던지더라도 try/finally 로 플래그를 반드시 해제한다.
//   - 압축까지 포함해서 in-progress 보호 범위를 확장했다 (압축 비용도 보호 대상).
// ----------------------------------------------------------------------------
let _stringifyInProgress = false;

/**
 * 해구별 기상전망 응답 캐시(원본 문자열 + gzip/brotli 사전 압축본)를 반환한다.
 *
 * [동작 흐름]
 *   1) 메모리에 데이터 자체가 없으면 (수집 전) null 반환 → 호출자가 404 처리
 *   2) 파일 mtime 이 캐시 빌드 시점과 같으면 캐시 객체 그대로 반환 (stringify·압축 생략)
 *   3) mtime 이 다르면 (= 스케줄러가 새 데이터 받음) 새로 stringify + gzip + brotli
 *      후 캐시 갱신
 *
 * [왜 mtime 으로 판단하나?]
 *   cache_manager.js (5초마다 실행) 가 zone_forecasts.json 파일의 mtime 을
 *   체크해서 dataCache.lastUpdate.zoneForecasts 에 저장한다.
 *   따라서 이 값만 비교하면 "데이터가 바뀌었나?" 를 추가 stat 호출 없이 알 수 있다.
 *
 * [반환값]
 *   - object: _zoneForecastsCache 객체 ({ responseJson, gzipBuffer, brotliBuffer, ... })
 *             호출자는 Accept-Encoding 헤더를 보고 적절한 필드를 골라 전송한다.
 *   - null:   데이터 미수집 상태 (호출자가 404 처리해야 함)
 *
 * [압축 빌드 방식]
 *   - gzip:   level = Z_BEST_COMPRESSION (9). 5.86MB → 약 0.45MB.
 *   - brotli: quality = 5. 5.86MB → 약 0.45MB.
 *             brotli quality 11 은 크기 이득이 미미한 반면 빌드 시간이 수 초로
 *             길어 데이터 갱신 직후 stale 윈도우를 키우므로, 빌드 시간이 짧으면서
 *             gzip 보다 약간 작은 quality 5 를 선택했다.
 *
 * [성능]
 *   첫 호출 or 데이터 갱신 직후: stringify + gzip + brotli 1회 수행 (수백 ms).
 *   이후 모든 호출: 캐시 적중 → 즉시 반환 (약 0.001ms), 요청당 압축 CPU 0.
 *
 * [동시성]
 *   Node.js 단일 스레드 특성상 별도 락 불필요.
 *   200~1000명 동시 첫 요청 시에도 실제로는 1건이 빌드하는 동안 나머지는
 *   옛 캐시(있으면)를 받거나 큐에서 대기 → 첫 건 완료되면 캐시 적중되어 즉시 응답.
 */
function getZoneForecastsResponse() {
    // [1] 데이터 미수집 → null (호출자가 404 응답)
    if (!dataCache.zoneForecasts) return null;

    // [2] 현재 파일 mtime 확인 (cache_manager 가 5초마다 갱신해 둔 값)
    const currentMtime = dataCache.lastUpdate.zoneForecasts || 0;

    // [3] 캐시 적중 — 마지막으로 빌드했을 때와 mtime 동일 → 캐시 객체 그대로 반환
    if (_zoneForecastsCache.responseJson
        && _zoneForecastsCache.builtAtMtime === currentMtime) {
        return _zoneForecastsCache;
    }

    // [3-B] Thundering Herd 보호 — 빌드(stringify+압축) 진행 중이고 옛 캐시가
    //       남아 있으면 그 옛 캐시를 반환한다 (stale-while-revalidate).
    //       동시 요청 N 건이 모두 빌드를 다시 돌리는 사태를 막아준다.
    //       옛 캐시조차 없는 "최초 빌드" 상황에서는 이 분기를 통과해 [4] 로 진행.
    if (_stringifyInProgress && _zoneForecastsCache.responseJson) {
        return _zoneForecastsCache;
    }

    // [4] 캐시 미스 — 데이터가 바뀌었거나 첫 호출.
    //     stringify → gzip → brotli 를 한 번에 만들어 캐시에 채운다.
    //     try/finally 로 플래그를 반드시 해제 (예외 누수 시에도 영구 true 방지).
    _stringifyInProgress = true;
    try {
        const json = JSON.stringify(dataCache.zoneForecasts);
        // 압축 버퍼는 한 변수에 모아 빌드한 뒤 한꺼번에 캐시에 대입한다.
        // (중간에 한 단계라도 예외가 나면 캐시를 "부분 갱신" 하지 않도록 — 아래 catch 처리)
        let gzipBuffer = null;
        let brotliBuffer = null;
        try {
            // gzip — 거의 모든 브라우저/앱이 지원하는 기본 압축.
            gzipBuffer = zlib.gzipSync(json, {
                level: zlib.constants.Z_BEST_COMPRESSION
            });
            // brotli — gzip 보다 약간 더 작음. quality 5 로 빌드 시간/크기 균형.
            brotliBuffer = zlib.brotliCompressSync(json, {
                params: {
                    [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
                    // 입력 크기를 알려주면 brotli 가 윈도우를 적절히 잡아 약간 더 빠르고 작아진다.
                    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: Buffer.byteLength(json)
                }
            });
        } catch (compressErr) {
            // [압축 실패 fallback] 압축이 실패해도 서비스가 죽으면 안 된다.
            //   원본 문자열만 캐시하고 압축본은 null 로 둔다 → 라우트는 비압축으로 응답
            //   (compression() 미들웨어가 실시간 압축으로 안전망 역할). 다음 데이터
            //   갱신 때 다시 압축을 시도한다.
            console.error('[zone-forecasts] 사전 압축 실패 — 비압축 fallback:', compressErr && compressErr.message);
            gzipBuffer = null;
            brotliBuffer = null;
        }
        _zoneForecastsCache.responseJson = json;
        _zoneForecastsCache.gzipBuffer = gzipBuffer;
        _zoneForecastsCache.brotliBuffer = brotliBuffer;
        _zoneForecastsCache.builtAtMtime = currentMtime;
    } finally {
        _stringifyInProgress = false;
    }
    return _zoneForecastsCache;
}

// 4. 해구별 기상전망
//    [수집 주기] 하루 2회 (09:30, 21:30 KST), zone_forecasts.json
//    [응답 크기] 약 5.86 MB (압축 후 ~700 KB) — 큰 응답이라 캐시 효과 큼
//    [HTTP 캐시] 정상 응답에만 max-age=1800 (30분), 빈 응답은 no-store.
//                zone_avg.js 는 자체 cache:'no-store' 로 강제 우회 — 영향 없음.
//
//    [성능 캐시 적용]
//      getZoneForecastsResponse() 가 미리 stringify 해둔 JSON 문자열 + 미리 압축한
//      gzip/brotli 버퍼를 담은 캐시 객체를 반환하므로,
//        1) 요청마다 5.86MB 객체를 직렬화하는 비용(약 50~150ms CPU) 제거
//        2) 요청마다 compression() 미들웨어가 실시간 압축하는 비용(약 50~100ms CPU) 제거
//      파일 mtime 이 바뀌었을 때만 1회 새로 stringify + 압축 함.
//
//    [기존 동작과의 차이]
//      이전: res.send(문자열) → compression() 미들웨어가 매 요청 실시간 gzip 압축.
//      변경: Accept-Encoding 을 보고 미리 압축한 버퍼를 res.end() 로 직접 전송.
//            응답에 Content-Encoding 헤더를 직접 붙이므로 compression() 미들웨어는
//            "이미 인코딩됨" 으로 보고 재압축을 건너뛴다(이중 압축 없음).
//
//    [응답 형식 — 100% 동일 보장]
//      압축 해제 후 바이트열은 기존 res.json(dataCache.zoneForecasts) / JSON.stringify
//      결과와 완전히 동일하다. 브라우저/fetch 는 Content-Encoding 을 보고 자동으로
//      압축을 풀므로 zone_avg.js / surfing1.js 의 r.json() 파싱에 변화 없음.
//      압축 미지원(드문) 클라이언트는 원본 문자열로 fallback.
//
//    [HEAD 요청] res.end(buffer) 사용 시 Express 가 HEAD 메서드면 body 를 보내지
//      않는다. Content-Length 는 buffer 전송 시 자동 설정되지만, 헤더 정확성을
//      위해 명시적으로 설정한다.
//
//    [호출 클라이언트]
//      - js/zone_avg.js   : 해구 평균값 계산 (자체 no-store 캐시 우회)
//      - js/surfing1.js   : 서핑 관련 화면
//      (단일 해구 모달은 별도 /api/marine-zone-forecasts/:zoneId 라우트 사용 — 무관)
router.get('/api/marine-zone-forecasts', (req, res) => {
    const cache = getZoneForecastsResponse();
    if (!cache || !cache.responseJson) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(404).json({ error: '데이터 준비 중' });
    }
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // 동일 URL 이라도 Accept-Encoding 에 따라 응답 본문이 달라지므로 캐시 키에 포함.
    res.setHeader('Vary', 'Accept-Encoding');

    const accept = req.headers['accept-encoding'] || '';

    // [1] brotli 우선 — 지원하고 사전 압축본이 있으면 그대로 전송.
    if (cache.brotliBuffer && /\bbr\b/.test(accept)) {
        res.setHeader('Content-Encoding', 'br');
        res.setHeader('Content-Length', cache.brotliBuffer.length);
        return res.end(cache.brotliBuffer);
    }
    // [2] gzip — 거의 모든 클라이언트가 지원.
    if (cache.gzipBuffer && /\bgzip\b/.test(accept)) {
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Content-Length', cache.gzipBuffer.length);
        return res.end(cache.gzipBuffer);
    }
    // [3] 압축 미지원(또는 압축 빌드 실패) → 원본 문자열.
    //     Content-Encoding 을 붙이지 않으므로 compression() 미들웨어가 필요 시
    //     실시간 압축하는 안전망으로 동작한다.
    return res.send(cache.responseJson);
});

// ============================================================================
// 4-α. 해구별 기상전망 — "단일 해구" 응답 (모달용 경량 엔드포인트)
// ----------------------------------------------------------------------------
// [왜 추가했나? — 4순위 작업]
//   기존 /api/marine-zone-forecasts 는 전체 1,330개 해구 × 시계열 = 약 5.86 MB
//   (압축 후 ~452 KB) 응답을 내려준다.
//   그런데 marine.js 의 해구 모달은 사용자가 클릭한 "단 1개 해구" 만 보여주므로
//   나머지 1,329개 해구 데이터는 전부 버려진다.
//   이를 줄이기 위해 :zoneId 경로 파라미터로 받은 1개 해구만 잘라서 응답하는
//   경량 라우트를 별도로 둔다.
//
// [기존 라우트와의 관계 — 둘 다 유지]
//   - /api/marine-zone-forecasts          : 전체 dump (zone_avg.js, surfing1.js 가 사용)
//   - /api/marine-zone-forecasts/:zoneId  : 단일 해구 (marine.js 모달이 사용) ← 이 라우트
//   두 라우트 모두 같은 dataCache.zoneForecasts 를 참조하므로 데이터 일관성 보장.
//
// [응답 구조 — 기존과 100% 호환]
//   {
//     "baseTmUtf": "<기존 값>",          // 기준 시각 (전체 응답과 동일)
//     "updatedAt": "<기존 값>",          // 갱신 시각 (전체 응답과 동일)
//     "data": { "<zoneId>": [...] }     // 해당 zone 의 시계열 배열만 포함
//   }
//   클라이언트는 기존과 동일하게 json.data[zoneId] 로 꺼내 쓸 수 있다.
//
// [캐시 설계 — 별도 객체 캐시를 두지 않는 이유]
//   응답 크기가 약 30 KB 수준이라 JSON.stringify 비용이 1~2 ms 로 매우 가볍다.
//   1,330개 zone × 30 KB ≈ 40 MB 캐시를 메모리에 박아두는 건 낭비이므로
//   매 요청마다 그때그때 직렬화한다. (Cache-Control 30분으로 브라우저/CDN 단에서 캐싱)
//
// [404 처리]
//   - dataCache.zoneForecasts 자체가 null  → 데이터 미수집 (스케줄러 부팅 직전)
//   - data[zoneId] 가 없거나 빈 배열       → 존재하지 않는 해구번호
//   둘 다 404 로 응답하여 클라이언트가 동일하게 에러 처리하도록 한다.
//
// [HTTP 캐시] 기존 라우트와 동일하게 max-age=1800 (30분)
//
// [호출 클라이언트]
//   - js/marine.js : 해구 모달 (5.86 MB → 30 KB, ~99.5% 절감)
// ============================================================================
router.get('/api/marine-zone-forecasts/:zoneId', (req, res) => {
    // [1] 데이터 미수집 — 스케줄러가 아직 zone_forecasts.json 을 못 읽었을 때
    if (!dataCache.zoneForecasts || !dataCache.zoneForecasts.data) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(404).json({ error: '데이터 준비 중' });
    }

    // [2] 경로 파라미터에서 해구번호 추출 (URL 디코딩은 express 가 자동 처리)
    const zoneId = req.params.zoneId;
    const zoneSeries = dataCache.zoneForecasts.data[zoneId];

    // [3] 해당 해구 데이터가 없거나 빈 배열 → 404
    //     (소해구 "123-4" 등 잘못된 키가 들어와도 여기서 안전하게 차단)
    if (!Array.isArray(zoneSeries) || zoneSeries.length === 0) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(404).json({ error: '해당 해구의 데이터가 없습니다.' });
    }

    // [4] 기존 응답 구조와 동일한 형태로 감싸서 전송 (data[zoneId] 키 패턴 유지)
    //     marine.js 가 json.data[lZone] 으로 꺼내 쓰는 기존 로직을 그대로 사용할 수 있게 함
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.json({
        baseTmUtf: dataCache.zoneForecasts.baseTmUtf,
        updatedAt: dataCache.zoneForecasts.updatedAt,
        data: { [zoneId]: zoneSeries }
    });
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

// 6-b. 해역별 통보문 이력 (특보 구역 옆 📋 버튼용)
//   MMIS ntfctn/list 는 해역 식별자가 없어 해역별 조회 불가 → ef/list 로 구성한다.
//   ef/list row 는 해역명(kor_nm)·발표시각(tm_fc)·종류/등급/발표구분(warn_*_nm)·관할청
//   (prdc_go)·원문 PDF 경로(file_nm)를 부모 해역별로 제공한다(자식=연안/평수 행은 없음).
//   원문 PDF 는 marine.kma.go.kr 공개 경로(무인증)라 클라이언트가 iframe 모달로 열람한다.
//
//   [전국 vs 지방청 — 중요] 같은 발효를 본청(108, 전국 통합)과 관할 지방청이 각각 통보문
//   PDF 로 낸다. 실측 확인: 전국(108) PDF 는 부모 해역만 담고 '연안바다/평수구역'이 없으나,
//   관할 지방청 PDF 에는 그 해역의 연안바다/평수구역까지 들어있다. 따라서 사용자에게는
//   **관할 지방청 통보문을 우선** 링크하고(연안/평수 내용 포함), 지방청 PDF 가 없는 발효만
//   전국(108)으로 폴백한다. 해역의 관할 지방청은 ef/list 빈도로 식별(그 해역을 가장 자주
//   통보한 비-108 prdc_go = 관할청; 인접청은 가끔만 등장). 한 발효는 1건으로 dedup.
let _zoneBulletinCache = { at: 0, rows: null, homeByZone: null };
const ZONE_BULLETIN_TTL_MS = 10 * 60 * 1000;   // 10분 — ef/list 인증 호출 부담 완화
const MARINE_PDF_HOST = 'https://marine.kma.go.kr';
const NATIONAL_GO = '108';                      // 본청(전국 통합 통보문) — 연안/평수 미포함

// [해역 → 관할 지방청 prdc_go] PDF 원문 내용검증으로 생성한 정적 매핑(1차 진실).
//   생성법: 각 해역의 후보 비-108 청 PDF 를 받아 'kor_nm' 이 실제 들어있는 청을 채택.
//   빈도 휴리스틱만으로는 동률 해역(예: 울산앞바다 143:2·159:2)에서 그 해역이 아예 없는
//   인접청 PDF 를 고를 수 있어(143 PDF엔 '울산' 없음) 이를 결정적으로 고정한다.
//   값 '108' = 지방청 PDF 에서 해역명이 확인 안 돼 전국(본청)으로 폴백하는 해역.
//   미등록(신규) 해역은 아래 빈도 휴리스틱(homeByZone)으로 best-effort 폴백.
const { ZONE_HOME_OFFICE } = require('../config/zone_home_office');   // [공유] 단일 출처 정적 매핑
// [자식-only 통보문 보강] ef/list 에 없는 자식(연안/평수) 변경 통보문을 크롤러가 매칭·저장한 것.
let childBulletin = null;
try { childBulletin = require('../services/child_bulletin'); }
catch (e) { console.warn('[zone-bulletins] child_bulletin 로드 실패 — 자식 병합 비활성:', e && e.message); }

const _zbNorm = (s) => String(s || '').replace(/\s+/g, '');

async function _getZoneBulletinData() {
    const now = Date.now();
    if (_zoneBulletinCache.rows && (now - _zoneBulletinCache.at) < ZONE_BULLETIN_TTL_MS) {
        return _zoneBulletinCache;
    }
    const kst = new Date(now + 9 * 3600000);
    const ymd = (off) => {
        const d = new Date(kst.getTime() + off * 86400000);
        return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    };
    const rows = await marineClient.fetchWarnEfList({ warn_tp: '', st_tm: ymd(-30), ed_tm: ymd(1) });
    const safe = Array.isArray(rows) ? rows : [];
    // 해역별 관할 지방청 = 비-108 prdc_go 중 최빈값
    const cnt = {};   // zoneNorm -> { prdc_go -> 횟수 }
    for (const r of safe) {
        const z = _zbNorm(r.kor_nm); if (!z) continue;
        const g = String(r.prdc_go || ''); if (!g) continue;
        (cnt[z] = cnt[z] || {})[g] = (cnt[z][g] || 0) + 1;
    }
    const homeByZone = {};
    for (const z of Object.keys(cnt)) {
        const non = Object.keys(cnt[z]).filter((g) => g !== NATIONAL_GO);
        if (non.length) { non.sort((a, b) => cnt[z][b] - cnt[z][a]); homeByZone[z] = non[0]; }
    }
    _zoneBulletinCache = { at: now, rows: safe, homeByZone };
    return _zoneBulletinCache;
}

router.get('/api/zone-bulletins', async (req, res) => {
    const zone = String(req.query.zone || '').trim();
    if (!zone) return res.status(400).json({ error: 'zone 파라미터 필요', bulletins: [] });
    try {
        const { rows, homeByZone } = await _getZoneBulletinData();
        const z = _zbNorm(zone);
        // 관할 지방청: PDF 내용검증 정적 매핑 우선 → 미등록이면 빈도 휴리스틱. (108=전국 폴백 해역)
        const home = ZONE_HOME_OFFICE[z] || homeByZone[z] || null;
        // 발효(이벤트) 단위로 묶고, 관할 지방청 > 그 외 지방청 > 전국(108) 순으로 PDF 선택
        const groups = new Map();   // key -> rows[]
        for (const r of rows) {
            if (_zbNorm(r.kor_nm) !== z) continue;
            const tmFc = String(r.tm_fc || '').trim();
            const cmd = String(r.warn_cmd_nm || '').trim();
            const tp = String(r.warn_tp_nm || '').trim();
            const lvl = String(r.warn_lvl_nm || '').trim();
            const key = tmFc + '|' + tp + '|' + lvl + '|' + cmd;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(r);
        }
        const bulletins = [];
        for (const cands of groups.values()) {
            const pick =
                (home && cands.find((r) => String(r.prdc_go) === home)) ||   // 1순위: 관할 지방청
                cands.find((r) => String(r.prdc_go) !== NATIONAL_GO) ||       // 2순위: 그 외 지방청
                cands[0];                                                     // 3순위: 전국(108) 폴백
            const r = pick;
            const tp = String(r.warn_tp_nm || '').trim();
            const lvl = String(r.warn_lvl_nm || '').trim();
            const cmd = String(r.warn_cmd_nm || '').trim();
            const fileNm = String(r.file_nm || '').trim();
            bulletins.push({
                time: String(r.tm_fc || '').trim(),
                title: (tp + lvl + (cmd ? ' ' + cmd : '')).trim(),
                pdfUrl: fileNm ? (MARINE_PDF_HOST + fileNm) : '',
                file_nm: fileNm,
                national: String(r.prdc_go) === NATIONAL_GO,   // true 면 전국 폴백(연안/평수 미포함 가능)
                childOnly: false                                // ef/list = 부모 통보문
            });
        }
        // [자식-only 통보문 합집합] (SPEC §8) ef/list 부모 ∪ 크롤러가 매칭·저장한 자식 통보문.
        //   부모 ef 행이 없는 "자식만 바뀐" 통보문(예: 연안바다 해제)을 목록에 반영.
        if (childBulletin && typeof childBulletin.getChildBulletinsForZone === 'function') {
            try {
                const childBs = childBulletin.getChildBulletinsForZone(zone) || [];
                for (const cb of childBs) bulletins.push(cb);
            } catch (e) {
                console.warn('[zone-bulletins] 자식 통보문 병합 실패 (무영향):', e && e.message);
            }
        }
        // file_nm 기준 dedup — 같은 PDF 가 ef(부모)·자식 양쪽으로 들어오면 1건으로. file_nm
        //   없는 항목(ef 폴백 등)은 time|title 로 보조 dedup. 중복 시 자식 통보문(연안/평수 포함) 우선.
        const seen = new Map();
        for (const b of bulletins) {
            const k = b.file_nm ? ('f:' + b.file_nm) : ('t:' + b.time + '|' + b.title);
            const prev = seen.get(k);
            if (!prev) { seen.set(k, b); continue; }
            if (!prev.childOnly && b.childOnly) seen.set(k, b);
        }
        const merged = Array.from(seen.values());
        merged.sort((a, b) => (a.time < b.time ? 1 : (a.time > b.time ? -1 : 0)));   // 최신 발표 우선
        res.json({ zone, count: merged.length, bulletins: merged.slice(0, 50) });
    } catch (e) {
        console.error('[zone-bulletins] ef/list 조회 실패:', e && e.message);
        res.status(502).json({ error: '통보문 조회 실패', bulletins: [] });
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
