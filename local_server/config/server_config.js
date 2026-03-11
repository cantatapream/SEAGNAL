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
app.use(express.json()); // POST 요청의 body를 JSON으로 자동 파싱

// ============================================================================
// 경로 상수
// ============================================================================
const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const SERVER_ROOT = path.join(__dirname, '..');

// 업로드 폴더가 없으면 자동 생성
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR);
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
    TIDE_USAGE: path.join(DATA_DIR, 'tide_usage.json')
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
