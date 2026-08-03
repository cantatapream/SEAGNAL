/**
 * ============================================================================
 * 파일명: server.js
 * 역할: SEAGNAL 서버의 메인 진입점 (Entry Point)
 * ============================================================================
 *
 * [설명]
 * 이 파일은 서버의 시작점으로, 아래 역할만 수행합니다:
 * 1. Express 앱 설정 및 미들웨어 등록
 * 2. 정적 파일 서빙 경로 설정
 * 3. 라우트 모듈 마운트 (routes/*.js)
 * 4. 정기 작업 등록 (클라우드 백업)
 * 5. 서버 시작
 *
 * 모든 비즈니스 로직은 routes/ 및 services/ 디렉토리에 분리되어 있습니다.
 *
 * [파일 구조]
 * server.js (이 파일)
 * ├── config/server_config.js   → app, 경로 상수, 환경 설정
 * ├── services/cache_manager.js → 데이터 캐시 (자동 갱신)
 * ├── services/upload_manager.js→ 파일 업로드 설정
 * ├── routes/health.js          → 헬스체크, 메인 페이지
 * ├── routes/weather.js         → 기상 특보/전망 API
 * ├── routes/tide.js            → 조석 데이터 API
 * ├── routes/content.js         → 공지/홍보/이미지 API
 * ├── routes/stats.js           → 방문자 통계 API
 * ├── routes/archive.js         → 아카이브(백업) API
 * ├── routes/push.js            → 푸시 구독/발송 API
 * ├── routes/push_test.js       → 푸시 테스트 시나리오
 * └── routes/admin.js           → 관리자 기능 API
 * ============================================================================
 */

// ============================================================================
// 0. 서버 로그 파일 기록 시작 (console.* tee → 영속 볼륨, 2일 보관)
//    관리자센터 > 점검 > "서버로그" 탭에서 조회. 최대한 일찍 init 해 이후 로그를 포착.
// ============================================================================
try { require('./services/server_logger').init(); } catch (_e) { /* 로깅 실패해도 서버는 정상 기동 */ }

// ============================================================================
// 1. 설정 및 서비스 초기화
// ============================================================================
const { app, PORT, staticRoot, UPLOAD_DIR } = require('./config/server_config');
const express = require('express');
const path = require('path');
const { spawn } = require('child_process');
const cron = require('node-cron');
const expressStaticGzip = require('express-static-gzip');
const cloudBackup = require('./cloud_backup');

// ============================================================================
// 백그라운드 정적 자원 사전 압축 프로세스 핸들 (graceful shutdown 에서 cleanup)
// ----------------------------------------------------------------------------
// build-gzip.js 는 더 이상 npm prestart 훅으로 동기 실행되지 않는다 (옵션 B).
// 대신 app.listen() 직후 spawn 으로 자식 프로세스에서 실행하여 서버 부팅과
// 헬스체크를 막지 않는다. 빌드 완료 전 들어온 요청은 express-static-gzip
// 의 자동 fallback 으로 원본 파일이 응답되므로 정상 처리된다 (= 첫 사용자
// 일부는 비압축 응답을 받을 수 있음, 의도된 trade-off).
//
// 핸들을 전역으로 보관해 SIGTERM/SIGINT 수신 시 자식도 함께 종료한다.
// ============================================================================
let _buildGzipChild = null;

// 서비스 초기화 (import 시 자동으로 캐시 갱신 시작, 업로드 설정 완료)
require('./services/cache_manager');
require('./services/upload_manager');

// [KHOA 정기 수집 — 2026-05]
//   부팅 시 gzip 디스크 백업(data/khoa_stream_cache.json.gz)을 읽어 메모리
//   캐시 복원 — 컨테이너 재시작 후 첫 사용자 요청도 캐시 hit 되도록.
//   이후 30분 주기 갱신은 scheduler.js 가 담당.
try {
    require('./services/khoa_stream_cache').hydrateFromDisk();
} catch (e) {
    console.warn('[startup] KHOA 캐시 hydrate 실패:', e && e.message);
}

// ============================================================================
// 1-A. HTTP 응답 압축 (gzip/brotli)
// ============================================================================
// [현재 구조 — 5순위 작업으로 변경됨]
//   compression() 미들웨어는 이제 config/server_config.js 에서 단 1회만
//   등록되며, 정적 자원 경로(/assets/, /js/, /css/, /images/, /tide_data/)
//   는 filter 에서 제외됨. 즉 동적 응답(/, /api/*, /uploads/* 등) 만
//   실시간 gzip 압축한다.
//
//   정적 자원은 아래 2. 의 expressStaticGzip 이 빌드 타임에 미리 만들어 둔
//   .gz / .br (build-gzip.js 가 prestart 에서 생성) 를 그대로 전송하므로
//   서버는 더 이상 매 요청마다 압축할 필요가 없다 → 요청당 80~100ms CPU 절약.
// ============================================================================

// ============================================================================
// 2. 정적 파일 서빙 (사전 압축 .gz / .br 우선)
// ============================================================================
// [왜 바꿨나]
//   기존엔 express.static + compression() 이 매 요청마다 정적 자원을
//   실시간 gzip 압축했음. CPU 1 코어를 차지하는 무거운 작업이라 동시
//   접속자가 늘면 서버 응답이 느려졌다.
//
//   express-static-gzip 은 같은 디렉토리에 미리 만들어 둔 <원본>.br /
//   <원본>.gz 가 있으면, 클라이언트의 Accept-Encoding 헤더에 맞춰
//   그 압축본을 그대로 전송한다 (Content-Encoding 헤더 자동 부착).
//   미리 만들어 둔 파일이 없으면 자동으로 원본을 응답하므로 fallback 안전.
//
// [동작 원리 — express-static-gzip]
//   요청: GET /js/forecast.js,  Accept-Encoding: br, gzip
//   → forecast.js.br 존재 시 그 파일 + Content-Encoding: br
//   → 없으면 forecast.js.gz + Content-Encoding: gzip
//   → 그것도 없으면 forecast.js 원본
//   → ETag / Last-Modified 는 원본 기준으로 정확히 설정됨 → 304 정상 동작
//
// [중요 — index: false]
//   GET / 요청에 대해 staticRoot/index.html 을 자동으로 응답해 버리면
//   routes/health.js 의 동적 점검 인젝션이 무시된다. 따라서 모든 정적
//   루트에 { index: false } 를 그대로 유지.
//
// [/uploads — 사전 압축 제외]
//   업로드는 사용자 동적 파일이라 빌드 시 압축 대상이 아니다. 따라서
//   기존 express.static + compression() 으로 실시간 응답 / 압축 유지.
//
// [hotfix — 사전 압축본 응답 활성화 (lazy rebind)]
//   원인 진단: express-static-gzip 은 미들웨어 생성 시점(=서버 부팅 시점)
//   에 root 디렉토리를 1회 스캔하여 .br/.gz 파일 목록을 메모리 캐시에
//   담아 둔다. 그 후엔 캐시에 없는 파일은 절대 압축본으로 응답하지 않는다.
//   본 프로젝트는 build-gzip.js 를 Dockerfile 빌드 단계가 아닌 런타임
//   app.listen() 직후 spawn 으로 비동기 실행하므로, 미들웨어가 생성될
//   때는 .br/.gz 파일이 존재하지 않아 캐시가 빈 채로 굳어 버린다.
//   → 5순위 작업의 사전 압축본은 디스크에 정상 생성되지만 미들웨어가
//      메모리 캐시 기준으로만 매칭하므로 응답에 단 한 번도 적용되지 않음.
//   해결: 미들웨어 인스턴스를 변경 가능한 reference 로 감싼 wrapper 를
//        라우터에 등록한다. build-gzip 자식 프로세스 종료 시 reload()
//        를 호출해 미들웨어를 새로 만들어 reference 만 교체 — 라우터
//        스택 구조는 그대로 유지되므로 다른 라우트 / 미들웨어에 영향 0.
//
// [orderPreference: 'gzip']
//   express-static-gzip 내부에서 gzip 의 encodingName 은 표준값 'gzip'
//   으로 등록된다 (fileExtension 은 'gz'). preference 도 동일 표준값
//   을 써야 매칭된다. 과거 'gz' 는 indexOf 매칭 실패로 우선순위 영향
//   이 없어졌고, 결과적으로 brotli 만 우선 동작했었다 (gzip 클라이언트
//   는 무의미한 fallback 경로로 흘러갔음).
// ============================================================================
const STATIC_GZIP_OPTS = {
    enableBrotli: true,
    orderPreference: ['br', 'gzip'],        // brotli 우선, 없으면 gzip (표준 encodingName)
    index: false,                           // 동적 GET / 우선 보장
    serveStatic: {
        // ┌── 초보자용 설명 ─────────────────────────────────────────────────┐
        // │ [이 함수가 하는 일] 브라우저가 폰트·이미지·자바스크립트(js) 같은    │
        // │   '정적 파일'을 하나 요청할 때마다 아래 setHeaders 함수가 호출됩니다.│
        // │   하는 일은 딱 하나 — 그 파일에 "네 안에 얼마나 오래 보관해도 돼"   │
        // │   라는 '보관 기간표'(Cache-Control 헤더)를 붙여 함께 보내는 것입니다.│
        // │ [왜 필요한가] 기간표가 없으면 브라우저가 매번 같은 파일을 새로       │
        // │   내려받아 화면이 느려집니다. 반대로 무조건 오래 보관하라고 하면,    │
        // │   우리가 파일을 고쳐 다시 올려도 사용자에겐 옛 파일이 계속 보여      │
        // │   버그가 안 고쳐집니다. 그래서 '잘 안 바뀌는 글꼴은 길게, 자주       │
        // │   바뀌는 코드는 매번 확인'하도록 파일 종류별로 다르게 붙입니다.      │
        // │ [용어 한 줄] no-cache = "보관은 하되 쓰기 전에 바뀐 거 없는지 한 번  │
        // │   물어봐",  immutable = "한 번 받으면 안 바뀌니 다시 묻지도 마".     │
        // │ [어디와 연결되나] 이 파일들을 실제로 요청하는 쪽은 index2.html 의    │
        // │   <link>·<script> 태그입니다. index2.html 이 "이 글꼴 줘"라고 하면   │
        // │   이 함수가 "1년 보관 OK" 같은 라벨을 붙여 돌려주는 식으로 짝을 이룹니다.│
        // └────────────────────────────────────────────────────────────────┘
        //
        // [정책] 확장자별 Cache-Control 분류 (사전 압축 .gz/.br 접미사 제거 후 판정).
        //   1) js/css/html/json → no-cache: "캐시하되 사용 전 ETag 재검증". 변경 없으면
        //      304(본문 없음)라 저렴하고, 배포 즉시 새 코드 반영 + 버전 스큐 방지.
        //      (벤더 JS/CSS 도 여기 포함 — 콘텐츠 해시가 없으므로 immutable 금지)
        //   2) 폰트(woff2 등) → 1년 immutable: 파일명이 구글 콘텐츠 해시라 in-place 교체
        //      불가 → 배포(SW 캐시 wipe) 후에도 HTTP 캐시 잔존, 재검증·재다운로드 없음.
        //      [예외] FontAwesome 폰트는 고정 파일명(fa-solid-900.woff2 등)이고 css 가
        //      버전 쿼리 없이 참조 → 업그레이드 시 in-place 교체되므로 immutable 금지(no-cache).
        //   3) 이미지 → 7일 캐시(가끔 교체되므로 만료 후 재검증).
        //   4) 그 외 → 안전하게 no-cache.
        //   [주의] fonts.css 자체는 .css(1번)라 no-cache — 폰트 '파일'만 immutable.
        setHeaders: function (res, filePath) {
            var p = filePath.replace(/\.(gz|br)$/i, '');
            if (/\.(js|css|html|json)$/i.test(p)) {
                res.setHeader('Cache-Control', 'no-cache');
            } else if (/[\\/]fontawesome[\\/].*\.(woff2?|ttf|otf|eot)$/i.test(p)) {
                res.setHeader('Cache-Control', 'no-cache');
            } else if (/\.(woff2?|ttf|otf|eot)$/i.test(p)) {
                res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            } else if (/\.(png|jpe?g|gif|webp|avif|svg|ico)$/i.test(p)) {
                res.setHeader('Cache-Control', 'public, max-age=604800');
            } else {
                res.setHeader('Cache-Control', 'no-cache');
            }
        }
    }
};

/**
 * Lazy-rebindable expressStaticGzip wrapper.
 * 라우터 스택에는 동일한 wrapper 함수 1개가 등록되어 절대 자리를 옮기지 않는다.
 * 내부 reference (`active`) 만 갈아끼우는 방식으로 캐시를 통째로 갱신한다.
 *
 * @param {string} root         정적 자원 루트 디렉토리
 * @param {object} opts         expressStaticGzip 옵션
 * @returns {{handler: Function, reload: Function}}
 */
function createLazyStaticGzip(root, opts) {
    let active = expressStaticGzip(root, opts);
    const handler = function lazyStaticGzipHandler(req, res, next) {
        return active(req, res, next);
    };
    const reload = function reloadStaticGzipCache() {
        try {
            active = expressStaticGzip(root, opts);
        } catch (e) {
            console.error(`[static-gzip] reload 실패 (${root}):`, e && e.message);
        }
    };
    return { handler, reload };
}

const _staticRootGzip   = createLazyStaticGzip(staticRoot,                              STATIC_GZIP_OPTS);
const _assetsGzip       = createLazyStaticGzip(path.join(staticRoot, 'assets'),         STATIC_GZIP_OPTS);
const _imagesGzip       = createLazyStaticGzip(path.join(staticRoot, 'images'),         STATIC_GZIP_OPTS);
const _tideDataGzip     = createLazyStaticGzip(path.join(staticRoot, 'tide_data'),      STATIC_GZIP_OPTS);

app.use(_staticRootGzip.handler);
app.use(_assetsGzip.handler);
app.use('/images', _imagesGzip.handler);
app.use('/tide_data', _tideDataGzip.handler);

/**
 * build-gzip 자식 프로세스 종료 시 호출 — 디스크에 새로 생성된 .br/.gz 파일을
 * 미들웨어 메모리 캐시에 반영하기 위해 4개 인스턴스를 모두 재생성한다.
 */
function reloadAllStaticGzipMiddlewares() {
    _staticRootGzip.reload();
    _assetsGzip.reload();
    _imagesGzip.reload();
    _tideDataGzip.reload();
    console.log('[static-gzip] 사전 압축 파일 캐시를 갱신했습니다 (4 mounts).');
}

// /uploads — 동적 업로드 파일은 사전 압축 대상이 아니므로 그대로 express.static.
// compression() 필터(/assets·/js·/css·/images·/tide_data 만 제외)에는 포함되어
// 텍스트형 업로드(예: .json) 응답 시 실시간 압축이 정상 적용된다.
// [STEP 7 호환] index2.html 이 <script src="services/..."> 로 로드하는 서버·클라
// 공용 모듈 2종만 명시적으로 서빙. staticRoot 가 client/ 로 분리되어 server 코드는
// 더 이상 통째로 정적 서빙되지 않으므로(보안 개선), 이 2개 URL 만 유지한다.
app.get('/services/typhoon_radius.js', (req, res) => res.sendFile(path.join(__dirname, 'services', 'typhoon_radius.js')));
app.get('/services/typhoon_message.js', (req, res) => res.sendFile(path.join(__dirname, 'services', 'typhoon_message.js')));

app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/uploads/reports', express.static(path.join(UPLOAD_DIR, 'reports')));

console.log(`🌍 Serving static files from: ${staticRoot}`);

// ============================================================================
// 3. 라우트 마운트
// ============================================================================
app.use(require('./routes/health'));
app.use(require('./routes/weather'));
app.use(require('./routes/advisoryPrediction'));  // 특보 예측 상태 조회 API (관심해역 필터, 읽기 전용)
app.use(require('./routes/tide'));
app.use(require('./routes/content'));
app.use(require('./routes/stats'));
app.use(require('./routes/usage'));         // 사용량 통계(Usage Analytics) 수집/조회 API
app.use(require('./routes/archive'));
app.use(require('./routes/push'));
app.use(require('./routes/push_test'));
app.use(require('./routes/location_alert'));  // 위치기반 특보 경보 동의 기록 API (④)
app.use(require('./routes/admin'));
app.use(require('./routes/survey'));
app.use(require('./routes/report'));
app.use(require('./routes/version'));
app.use(require('./routes/fishing'));  // 바다낚시 지수 API
app.use(require('./routes/typhoon'));  // 태풍 통보문/예보 API (방재기상플랫폼 기반)
app.use(require('./routes/marine_chart'));  // 해상일기도 GIF 메타데이터 프록시 (KMA 날씨누리)
app.use(require('./routes/comment')); // 게시글 댓글 API
app.use(require('./routes/reaction')); // 게시글 리액션 API
app.use(require('./routes/comment_report')); // 댓글 신고 API
// 해무 CCTV 스틸컷 API (국립해양조사원).
// router 모듈에 attach 된 kickoffInitialFetch 를 listen 콜백에서 호출하기 위해 참조 유지.
const cctvSeafogRouter = require('./routes/cctv_seafog');
app.use(cctvSeafogRouter);
app.use(require('./routes/ocean1'));        // 해양종합정보 API (수심/ROMS/기상/파고/저질)
app.use(require('./routes/ocean2'));        // ROMS 격자/저질 API
app.use(require('./routes/ocean3'));        // 해양현황 날씨/바람 API (zone_forecasts 기반)
app.use(require('./routes/ocean4'));        // 해양현황 파고/zone-forecasts 오버레이 API
app.use(require('./routes/vsby_smallzone')); // 해구별예측(소해구) 시정 캐시 API
app.use(require('./routes/tide_field'));    // 서해·남해 물빠짐(갯벌 노출) 예측 API (Phase 2)
app.use(require('./routes/hazard_rocks'));  // 간출암 잠김경고 API (3시간 이내 잠기는 암초)
app.use(require('./routes/navigational_warning'));  // 항행경보 현황 API (국립해양조사원)
app.use(require('./routes/assistant'));     // AI 음성/텍스트 비서 (자연어 질문 → 실데이터 답변)
app.use(require('./routes/legal'));          // 해양법령 챗봇(나리야) — 관리자 리뷰 검증 API + 현 DB 답변

// ============================================================================
// 4. 정기 작업 (Daily Cloud Backup)
// ============================================================================
// 매일 KST 23:55 (UTC 14:55)에 구독자 수 스냅샷 기록
// → 하루가 끝나기 직전의 구독자 수를 기록하여 일별 추이 분석에 사용
// [연계] services/subscriber_snapshot.js → takeSnapshot()
// [연계] routes/push.js → /api/subscriber-history API에서 조회
// [연계] js/admin.js → 구독 현황 탭의 추이 차트/증감 카드에서 활용
const subscriberSnapshot = require('./services/subscriber_snapshot');
cron.schedule('55 14 * * *', () => {
    console.log('⏰ [Daily Schedule] 구독자 스냅샷 기록을 시작합니다.');
    subscriberSnapshot.takeSnapshot();
});
// [이동됨] 서버 시작 시 오늘 스냅샷이 없으면 즉시 기록하던 호출은 require 단계에서
//          파일 I/O 를 동기적으로 수행하여 startup 을 늘리는 원인이었다.
//          → app.listen() 콜백 안으로 이동하여 listen 이후에 비동기로 실행한다.
//          누락 방지 효과는 동일 (listen 직후 한 번 실행).

// 매일 KST 00:05 (UTC 15:05)에 클라우드 백업 자동 실행
cron.schedule('5 15 * * *', () => {
    console.log('⏰ [Daily Schedule] 클라우드 백업 작업을 시작합니다.');
    cloudBackup.performBackup();
});

// 매일 KST 00:01 (UTC 15:01)에 제보 데이터 정리 + 조석 일일 카운트 리셋 + 만료 차단 해제
cron.schedule('1 15 * * *', () => {
    console.log('⏰ [Daily Schedule] 제보/차단/조석 일일 정리 작업을 시작합니다.');
    try {
        const reportRouter = require('./routes/report');
        if (reportRouter.cleanupExpiredReports) reportRouter.cleanupExpiredReports();
        if (reportRouter.cleanupExpiredBlocks) reportRouter.cleanupExpiredBlocks();
    } catch (e) { console.error('제보 정리 오류:', e.message); }
    try {
        const tideRouter = require('./routes/tide');
        if (tideRouter.resetDailyTideUsage) tideRouter.resetDailyTideUsage();
    } catch (e) { console.error('조석 카운트 리셋 오류:', e.message); }
});

// ============================================================================
// 4.5 Graceful shutdown — Fly.io SIGTERM 대응
// ----------------------------------------------------------------------------
// Fly.io / 컨테이너 환경은 종료 시 SIGTERM 을 먼저 보낸 뒤 약간의 grace period
// 후 SIGKILL. beforeExit 만으로는 SIGTERM 직후 강제 종료 시 디바운스 보류 중인
// tideBedConfig 변경이 누락될 수 있다. SIGTERM 핸들에서 즉시 flush 수행.
// ============================================================================
function _gracefulShutdown(signal) {
    try {
        const tideCollector = require('./services/tide_collector');
        if (typeof tideCollector.saveTideBedConfig === 'function') {
            tideCollector.saveTideBedConfig({ flush: true });
        }
    } catch (e) {
        console.error('[shutdown] saveTideBedConfig flush 실패:', e && e.message);
    }
    // [추가] 방문 통계 메모리 큐를 디스크에 동기 flush.
    //   - routes/stats.js 의 /api/visit 는 더 이상 매 요청마다 디스크에 쓰지 않고,
    //     services/visit_queue.js 의 메모리 카운터만 갱신합니다 (5초마다 비동기 flush).
    //   - 따라서 SIGTERM 직후 flush 가 안 되면 최대 5초치 카운트가 유실될 수 있어,
    //     여기서 동기 flushSync 로 보장합니다. 데이터 손실 0.
    try {
        const visitQueue = require('./services/visit_queue');
        if (typeof visitQueue.flushSync === 'function') {
            visitQueue.flushSync();
        }
    } catch (e) {
        console.error('[shutdown] visitQueue flushSync 실패:', e && e.message);
    }
    // [추가] 사용량 통계 메모리 큐도 동기 flush — visit_queue 와 동일 이유(최대 5초 유실 방지).
    try {
        const usageQueue = require('./services/usage_queue');
        if (typeof usageQueue.flushSync === 'function') {
            usageQueue.flushSync();
        }
    } catch (e) {
        console.error('[shutdown] usageQueue flushSync 실패:', e && e.message);
    }
    // [추가] 백그라운드 빌드(build-gzip) 자식 프로세스가 아직 살아있다면 함께 종료.
    //   - 부팅 직후 종료가 빠르게 일어나면 압축이 진행 중일 수 있고, 좀비 프로세스로
    //     남으면 컨테이너 종료 grace period 가 지나 SIGKILL 로 강제 종료될 위험이 있다.
    //   - SIGTERM 을 먼저 보내 정상 종료 기회를 주고, 핸들 참조를 끊는다.
    try {
        if (_buildGzipChild && _buildGzipChild.exitCode === null && !_buildGzipChild.killed) {
            _buildGzipChild.kill('SIGTERM');
            console.log('🛑 [shutdown] build-gzip 자식 프로세스 SIGTERM 전송.');
        }
    } catch (e) {
        console.error('[shutdown] build-gzip 종료 실패:', e && e.message);
    }
    console.log(`🛑 ${signal} 수신 — graceful shutdown.`);
    process.exit(0);
}
process.on('SIGTERM', () => _gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => _gracefulShutdown('SIGINT'));

// ============================================================================
// 5. 서버 시작
// ============================================================================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n=================================================`);
    console.log(`🚀 서버 실행 중! Port: ${PORT}`);
    console.log(`📡 접속 주소: http://localhost:${PORT}/ (기본 index2.html, 구버전은 /index.html)`);
    console.log(`✅ 라우트 모듈: health, weather, tide, content, stats, archive, push, admin, survey, report, version`);
    console.log(`=================================================\n`);

    // ============================================================================
    // listen 이후 백그라운드 초기화
    // ============================================================================
    // listen 을 막지 않기 위해 다음 tick 에서 비동기로 실행한다.
    // - subscriberSnapshot.takeSnapshot(): 오늘 스냅샷 누락 방지용 즉시 1회 기록 (파일 I/O)
    // - cctvSeafogRouter.kickoffInitialFetch(): 해무 CCTV 첫 수집 (외부 API 호출)
    // 각 작업의 실패는 console.error 로만 기록하고 다른 작업/응답에 영향 주지 않는다.
    setImmediate(() => {
        try {
            subscriberSnapshot.takeSnapshot();
        } catch (e) {
            console.error('[startup] subscriberSnapshot 실패:', e && e.message);
        }
        try {
            if (cctvSeafogRouter && typeof cctvSeafogRouter.kickoffInitialFetch === 'function') {
                const p = cctvSeafogRouter.kickoffInitialFetch();
                if (p && typeof p.catch === 'function') {
                    p.catch(err => console.error('[startup] CCTV 초기수집 실패:', err && err.message));
                }
            }
        } catch (e) {
            console.error('[startup] CCTV 초기수집 트리거 실패:', e && e.message);
        }

        // 해구별예측(소해구) 시정 캐시: 디스크 로드 + 런 변경 시에만 수집(자동 갱신).
        try {
            require('./services/vsby_smallzone').startAutoRefresh();
        } catch (e) {
            console.error('[startup] vsby_smallzone 자동갱신 시작 실패:', e && e.message);
        }

        // ====================================================================
        // [물빠짐 예측] 배포/기동 시 자동 부트스트랩 (Fly 운영 환경 한정)
        // --------------------------------------------------------------------
        //   - grid_meta/anchors 없으면 Phase 0 전처리(BADA→격자/앵커/Z₀) 1회 실행.
        //   - 이어서 롤링 윈도우(오늘~+2일, KST) 곡선 수집. 곡선 캐시는 Fly 영속
        //     볼륨에 저장되므로, 재배포·머지해도 부족분만 받고 나머지는 스킵.
        //     (collectTideField 내부 in-progress 락으로 scheduler 23:30 과 중복 방지)
        //   - fire-and-forget — 서버 기동/응답을 막지 않음.
        //   - 로컬/개발(FLY_ALLOC_ID 미설정)에서는 자동 실행하지 않는다(라이브
        //     TideBED 호출·쿼터 보호). 로컬은 npm run build-tide-field + 수동 수집.
        // ====================================================================
        if (process.env.FLY_ALLOC_ID) {
            try {
                const tideFieldCollector = require('./services/tide_field_collector');
                // [ENOSPC 회복] 부트스트랩(ensureBuilt 가 디스크 쓰기 시도) 전에, 윈도우 밖
                //   과거 곡선 파일을 먼저 정리한다. 삭제는 공간이 필요 없으므로 볼륨이 꽉 찼어도
                //   동작 → 디스크를 즉시 회복시킨 뒤 수집/프리컴퓨트가 정상 쓰기 가능해진다.
                try {
                    const purged = tideFieldCollector.purgeStaleCurves();
                    if (purged > 0) console.log(`🧹 [startup] 윈도우 밖 곡선 파일 ${purged}개 정리(디스크 회복)`);
                } catch (e) { console.error('[startup] 곡선 정리 실패:', e && e.message); }
                console.log('🌊 [startup] 물빠짐 예측 부트스트랩 시작 (전처리 보장 → 롤링 수집)...');
                Promise.resolve(tideFieldCollector.bootstrapTideField())
                    .then(r => console.log(`🌊 [startup] 물빠짐 부트스트랩 결과: ${JSON.stringify(r)}`))
                    .catch(err => console.error('[startup] 물빠짐 부트스트랩 실패:', err && err.message));
            } catch (e) {
                console.error('[startup] 물빠짐 부트스트랩 트리거 실패:', e && e.message);
            }
        }

        // ====================================================================
        // [옵션 B] 정적 자원 사전 압축(build-gzip) 백그라운드 실행
        // --------------------------------------------------------------------
        // 과거: package.json 의 prestart 훅에서 동기 실행 (~26초 소요).
        //       Fly.io 헬스체크가 부팅 30초 내에 응답을 기대하므로 빠듯했다.
        // 현재: listen() 완료 후 자식 프로세스에서 비동기로 실행.
        //   - 서버는 즉시 응답 가능 → 헬스체크 안전.
        //   - 빌드 완료 전 정적 자원 요청이 오면 .gz/.br 가 없어
        //     express-static-gzip 이 원본 파일로 자동 fallback (정상 응답).
        //   - mtime 비교로 이미 최신이면 빠르게 종료하므로 재시작 부담 미미.
        //   - 자식 stdout/stderr 는 메인 로그로 그대로 흘려보낸다.
        //   - 자식 실패해도 서버는 계속 가동 (압축본 없는 상태로 동작).
        // ====================================================================
        try {
            _buildGzipChild = spawn(process.execPath, [path.join(__dirname, 'build-gzip.js')], {
                cwd: __dirname,
                stdio: ['ignore', 'inherit', 'inherit'],
                env: process.env,
            });
            _buildGzipChild.on('exit', (code, signal) => {
                if (signal) {
                    console.log(`[build-gzip] 자식 프로세스 종료 (signal=${signal})`);
                } else if (code === 0) {
                    console.log('[build-gzip] 자식 프로세스 정상 종료');
                } else {
                    console.error(`[build-gzip] 자식 프로세스 비정상 종료 (code=${code})`);
                }
                _buildGzipChild = null;
                // [hotfix] build-gzip 가 새로 만든 .br/.gz 파일을 미들웨어 메모리
                // 캐시에 반영. 부팅 시점엔 캐시가 비어 사전 압축본이 응답되지 않
                // 았으나, 본 호출 이후부턴 정상적으로 .br/.gz 가 송출된다.
                // signal 종료(SIGTERM) 의 경우엔 builder 가 도중에 죽었을 수 있으나
                // 부분 결과라도 캐시에 반영하는 것이 안전 (없는 파일은 fallthrough).
                try {
                    reloadAllStaticGzipMiddlewares();
                } catch (e) {
                    console.error('[static-gzip] reload 호출 실패:', e && e.message);
                }
            });
            _buildGzipChild.on('error', (err) => {
                console.error('[build-gzip] spawn 오류:', err && err.message);
                _buildGzipChild = null;
            });
            console.log(`[build-gzip] 백그라운드 빌드 시작 (pid=${_buildGzipChild.pid})`);
        } catch (e) {
            console.error('[startup] build-gzip spawn 실패:', e && e.message);
            _buildGzipChild = null;
        }
    });
});
