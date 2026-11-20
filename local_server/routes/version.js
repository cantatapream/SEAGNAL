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
 * [사용법] (2026-11-20 바뀜)
 * 새 앱 버전을 Play Store에 출시한 후: 관리자 센터 → 버전 탭에서 latestVersion·versionCode·업데이트 메시지를 넣고 [적용].
 * 그 즉시 옛 앱 사용자에게 업데이트 안내 창이 뜬다. 서버를 다시 배포해도 값이 남는다(local_server/data — services/app_version_store.js).
 * 되돌리기도 같은 곳에서 [적용] 한 번이면 된다. ★저장소의 client/app_version.json 은 처음 값일 뿐 — 한 번 적용한 뒤에는 고쳐도 반영되지 않는다.
 *
 * [연계 파일]
 * - services/app_version_store.js → 버전 정보 읽기(data/app_version.json, 없으면 client/app_version.json)
 * - capacitor-plugins.js → 앱에서 이 API를 호출하여 버전 비교
 * - server.js → app.use()로 이 라우터 등록
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const appVersionStore = require('../services/app_version_store');

// 앱 버전 정보 API — 앱이 켤 때마다 부른다(capacitor-plugins.js checkAppUpdate)
router.get('/api/app-version', (req, res) => {
    try {
        const versionData = appVersionStore.read();
        if (!versionData) {
            return res.status(404).json({ error: 'app_version.json not found' });
        }
        res.set('Cache-Control', 'no-store'); // 관리자 [적용]이 바로 보이도록 — 중간 캐시가 옛 값을 붙잡지 않게
        res.json(versionData);
    } catch (e) {
        console.error('[Version API] Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
