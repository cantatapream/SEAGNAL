/**
 * ============================================================================
 * 파일명: routes/health.js
 * 역할: 서버 상태 확인(헬스체크) 및 메인 페이지 라우트
 * ============================================================================
 *
 * [설명]
 * 이 파일은 서버의 기본적인 상태를 확인하는 API를 제공합니다.
 * - GET / → 메인 페이지(index2.html) 제공
 *           (기존 index.html 은 파일 그대로 보존되어 /index.html 직접 URL 로
 *            계속 접근 가능 — 롤백/구버전 비교 용도)
 * - GET /api/health → 서버 상태 확인 (Fly.io 모니터링 등에서 사용)
 *
 * [연계 파일]
 * - config/server_config.js → staticRoot(정적 파일 경로) 사용
 * - server.js → app.use()로 이 라우터 등록
 *
 * [초보자를 위한 안내]
 * "헬스체크"란 서버가 정상적으로 작동하고 있는지 확인하는 간단한 API입니다.
 * Fly.io 같은 클라우드 서비스는 이 API를 주기적으로 호출하여
 * 서버가 살아있는지 자동으로 확인합니다.
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { staticRoot } = require('../config/server_config');

// 메인 페이지 제공 — 해양종합정보 페이지 신규 공개에 따라 index2.html 를 기본 진입점으로 사용.
// 구 버전(index.html) 은 파일을 그대로 유지하므로 /index.html 로 직접 접근 가능 (express.static).
router.get('/', (req, res) => {
    const flyPath = path.join(staticRoot, 'index2.html');
    if (fs.existsSync(flyPath)) {
        res.sendFile(flyPath);
    } else {
        res.status(404).send('index2.html 파일을 찾을 수 없습니다.');
    }
});

// 서버 상태 확인 API
router.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
