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
// 1. 설정 및 서비스 초기화
// ============================================================================
const { app, PORT, staticRoot, UPLOAD_DIR } = require('./config/server_config');
const express = require('express');
const path = require('path');
const cron = require('node-cron');
const compression = require('compression');
const cloudBackup = require('./cloud_backup');

// 서비스 초기화 (import 시 자동으로 캐시 갱신 시작, 업로드 설정 완료)
require('./services/cache_manager');
require('./services/upload_manager');

// ============================================================================
// 1-A. HTTP 응답 압축 (gzip/brotli)
// ============================================================================
// [목적]
//   라우트/정적파일이 응답하기 전에 등록되어, 모든 텍스트 기반 응답
//   (HTML, JS, CSS, JSON 등) 을 자동으로 gzip 압축합니다.
//
// [효과 - A안 자체호스팅 보완]
//   외부 CDN 시절엔 CDN 이 자동 압축을 해줬는데, vendor/ 로 자체호스팅
//   하면서 이 혜택을 잃었음. 이 미들웨어로 회복:
//     ol.js        808KB → ~250KB (-69%)
//     hls.min.js   413KB → ~120KB (-71%)
//     fonts.css    340KB → ~50KB  (-85%)
//     기타 라이브러리 평균 -70%
//
// [자동 처리]
//   - 클라이언트 Accept-Encoding 헤더에 따라 gzip/deflate 협상
//   - text/html, application/javascript, text/css 등 텍스트 자동 압축
//   - woff2/png/jpg 등 이미 압축된 바이너리는 자동 스킵 (Content-Type 기반)
//   - 1KB 미만 작은 응답은 압축 안 함 (네트워크 비용 < CPU 비용)
//   - Vary: Accept-Encoding 헤더 자동 추가
//
// [등록 위치 중요]
//   express.static 과 모든 라우트보다 먼저 등록해야 그 응답들이 압축됨.
// ============================================================================
app.use(compression());

// ============================================================================
// 2. 정적 파일 서빙
// ============================================================================
// [중요] { index: false } 로 express.static 의 자동 디렉터리 인덱스 응답을 차단.
//        기본값(true) 이면 GET / 요청에 대해 staticRoot/index.html 을 자동으로
//        먼저 내려보내 버려서, 아래 routes/health.js 의 router.get('/') 가
//        호출되지 않음. → 기본 진입점을 index2.html 로 전환하려면 반드시 필요.
//        개별 파일 이름이 URL 로 오는 경우(예: /index.html, /index2.html) 는
//        이 옵션과 무관하게 그대로 서빙되므로 롤백 경로(/index.html)는 보존됨.
app.use(express.static(staticRoot, { index: false }));
app.use(express.static(path.join(staticRoot, 'assets'), { index: false }));
app.use('/images', express.static(path.join(staticRoot, 'images')));
app.use('/tide_data', express.static(path.join(staticRoot, 'tide_data')));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/uploads/reports', express.static(path.join(UPLOAD_DIR, 'reports')));

console.log(`🌍 Serving static files from: ${staticRoot}`);

// ============================================================================
// 3. 라우트 마운트
// ============================================================================
app.use(require('./routes/health'));
app.use(require('./routes/weather'));
app.use(require('./routes/tide'));
app.use(require('./routes/content'));
app.use(require('./routes/stats'));
app.use(require('./routes/archive'));
app.use(require('./routes/push'));
app.use(require('./routes/push_test'));
app.use(require('./routes/admin'));
app.use(require('./routes/survey'));
app.use(require('./routes/report'));
app.use(require('./routes/version'));
app.use(require('./routes/fishing'));  // 바다낚시 지수 API
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
app.use(require('./routes/ocean5'));        // 해저지형/기타 해양 API

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
    });
});
