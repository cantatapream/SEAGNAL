/**
 * ============================================================================
 * 파일명: config/server_config.js
 * 역할: SEAGNAL 서버의 전역 설정을 관리하는 모듈
 * ============================================================================
 *
 * [설명]
 * 이 파일은 서버 전체에서 사용되는 공통 설정값들을 한 곳에 모아 관리합니다.
 * - 서버 포트, 데이터 디렉토리 경로, 업로드 디렉토리 경로 등
 * - Fly.io 환경 감지 (클라우드 vs 로컬 구분)
 * - Express 앱 인스턴스 생성 및 기본 미들웨어 설정
 *
 * [연계 파일]
 * - server.js (메인 엔트리) → 이 모듈에서 app, 경로 상수 등을 가져와 사용
 * - routes/*.js (모든 라우트) → DATA_DIR, UPLOAD_DIR 등 경로 상수 사용
 * - services/*.js (모든 서비스) → DATA_DIR, IS_FLY_IO 등 환경 설정 사용
 *
 * [초보자를 위한 안내]
 * Express.js는 Node.js 웹 서버 프레임워크입니다.
 * 이 파일에서 Express 앱을 생성하고 CORS(다른 도메인에서의 접근 허용),
 * JSON 파싱(POST 요청의 본문을 자동으로 JavaScript 객체로 변환) 등
 * 기본적인 미들웨어를 설정합니다.
 * ============================================================================
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// ============================================================================
// Express 앱 생성 및 기본 미들웨어
// ============================================================================
const app = express();
app.use(cors());
// [limit: 50mb]
// Quill 에디터에 이미지를 paste 로 붙여넣으면 content HTML 안에 base64
// 인코딩된 <img src="data:image/...;base64,..."> 가 인라인 삽입됨. 1MB 이미지
// 하나만 붙여도 base64 로 ~1.3MB 이 되어, Express 기본 body 한도 100kb 를
// 크게 초과해 413 Payload Too Large 로 저장이 실패함.
// 이미지 인라인 방식을 유지하면서 게시글·댓글 등 대용량 JSON 본문을 허용하도록
// 50mb 로 상향 (단일 게시글 기준 충분히 넉넉). urlencoded 도 동일 한도 적용.
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ============================================================================
// 경로 상수
// ============================================================================
const DATA_DIR = path.join(__dirname, '..', 'data');
// 업로드 디렉토리를 data/ 안에 배치하여 Fly.io 볼륨(영구 저장소)에 포함시킴
// → 컨테이너 재생성(배포/재시작) 시에도 업로드된 파일이 소멸되지 않음
// fly.toml의 [[mounts]] destination = '/app/local_server/data' 범위 내에 위치
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const SERVER_ROOT = path.join(__dirname, '..');

// 업로드 폴더가 없으면 자동 생성 (data/uploads/)
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ============================================================================
// 환경 감지
// ============================================================================
const IS_FLY_IO = !!process.env.FLY_APP_NAME;
const PORT = 3001;

// 정적 파일 루트 경로 결정
// Fly.io 환경과 로컬 환경 모두 대응
const staticRoot = process.env.FLY_ALLOC_ID
    ? SERVER_ROOT
    : (fs.existsSync(path.join(SERVER_ROOT, 'index.html')) ? SERVER_ROOT : path.join(SERVER_ROOT, '..'));

// ============================================================================
// 데이터 파일 경로 상수 (JSON 파일들)
// ============================================================================
const FILES = {
    VISITORS: path.join(DATA_DIR, 'visitors.json'),
    VISITORS_STATS: path.join(DATA_DIR, 'visitors_stats.json'),
    COLLECT_FAILURES: path.join(DATA_DIR, 'collect_failures.json'),
    SUBSCRIPTIONS: path.join(DATA_DIR, 'subscriptions.json'),
    PUSH_HISTORY: path.join(DATA_DIR, 'custom_push_history.json'),
    TIDEBED_CONFIG: path.join(DATA_DIR, 'tidebed_config.json'),
    SURVEYS: path.join(DATA_DIR, 'surveys.json'),
    REPORTS: path.join(DATA_DIR, 'reports.json'),
    BLOCKS: path.join(DATA_DIR, 'blocks.json'),
    TIDE_USAGE: path.join(DATA_DIR, 'tide_usage.json'),
    // 구독자 일별 스냅샷: 매일 자정(KST)에 구독자 수를 기록하여 증감 추이 분석에 사용
    // [연계] services/subscriber_snapshot.js → 스냅샷 기록
    // [연계] routes/push.js → /api/subscriber-history API에서 조회
    SUBSCRIBER_STATS: path.join(DATA_DIR, 'subscriber_stats.json'),
    // 구독/해지 이벤트 로그: 신규 구독, 수동 해지, 만료 토큰 자동 정리를 일별로 집계
    // [연계] routes/push.js → 구독/해지 발생 시 기록 + /api/subscriber-events API에서 조회
    // [연계] js/admin.js → 구독 현황 탭의 이탈률 카드에서 활용
    SUBSCRIBER_EVENTS: path.join(DATA_DIR, 'subscriber_events.json')
};

module.exports = {
    app,
    express,
    fs,
    path,
    DATA_DIR,
    UPLOAD_DIR,
    SERVER_ROOT,
    IS_FLY_IO,
    PORT,
    staticRoot,
    FILES
};
