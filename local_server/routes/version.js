/**
 * ============================================================================
 * 파일명: routes/version.js
 * 역할: 앱 버전 확인 API
 * ============================================================================
 *
 * [설명]
 * 모바일 앱이 시작될 때 이 API를 호출하여 최신 버전을 확인합니다.
 * 현재 앱 버전이 latestVersion보다 낮으면 업데이트 팝업을 표시합니다.
 *
 * [사용법]
 * 새 앱 버전을 Play Store에 출시한 후:
 * 1. app_version.json의 latestVersion을 새 버전으로 수정
 * 2. latestVersionCode도 build.gradle의 versionCode와 맞춤
 * 3. 서버 재배포 → 기존 사용자에게 자동으로 업데이트 팝업 표시
 *
 * [연계 파일]
 * - app_version.json → 버전 정보 저장
 * - capacitor-plugins.js → 앱에서 이 API를 호출하여 버전 비교
 * - server.js → app.use()로 이 라우터 등록
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { staticRoot } = require('../config/server_config');

// 앱 버전 정보 API
router.get('/api/app-version', (req, res) => {
    try {
        const versionFilePath = path.join(staticRoot, 'app_version.json');
        if (!fs.existsSync(versionFilePath)) {
            return res.status(404).json({ error: 'app_version.json not found' });
        }
        const versionData = JSON.parse(fs.readFileSync(versionFilePath, 'utf8'));
        res.json(versionData);
    } catch (e) {
        console.error('[Version API] Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
