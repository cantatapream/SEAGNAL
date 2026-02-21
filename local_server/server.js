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
const cloudBackup = require('./cloud_backup');

// 서비스 초기화 (import 시 자동으로 캐시 갱신 시작, 업로드 설정 완료)
require('./services/cache_manager');
require('./services/upload_manager');

// ============================================================================
// 2. 정적 파일 서빙
// ============================================================================
app.use(express.static(staticRoot));
app.use(express.static(path.join(staticRoot, 'assets')));
app.use('/images', express.static(path.join(staticRoot, 'images')));
app.use('/tide_data', express.static(path.join(staticRoot, 'tide_data')));
app.use('/uploads', express.static(UPLOAD_DIR));

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

// ============================================================================
// 4. 정기 작업 (Daily Cloud Backup)
// ============================================================================
// 매일 KST 00:05 (UTC 15:05)에 클라우드 백업 자동 실행
cron.schedule('5 15 * * *', () => {
    console.log('⏰ [Daily Schedule] 클라우드 백업 작업을 시작합니다.');
    cloudBackup.performBackup();
});

// ============================================================================
// 5. 서버 시작
// ============================================================================
app.listen(PORT, () => {
    console.log(`\n=================================================`);
    console.log(`🚀 서버 실행 중! Port: ${PORT}`);
    console.log(`📡 접속 주소: http://localhost:${PORT}/index.html`);
    console.log(`✅ 라우트 모듈: health, weather, tide, content, stats, archive, push, admin, survey`);
    console.log(`=================================================\n`);
});
