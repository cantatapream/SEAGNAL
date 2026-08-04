/**
 * ============================================================================
 * 파일명: routes/seaway.js
 * 역할: 항로 GeoJSON(/seaway_zones.json) 을 "갱신본 우선"으로 서빙하는 라우트.
 * ============================================================================
 *
 * [엔드포인트]
 *   GET /seaway_zones.json
 *     → data/seaway_zones.json 이 있으면 그 내용(월간 점검으로 갱신된 최신본)
 *     → 없으면 next() — 배포본 client/seaway_zones.json 이 정적 서빙된다
 *
 * [왜 라우트가 필요한가 — 초보자를 위한 안내]
 *   항로 데이터는 매월 말일에 원본과 대조해 갱신되는데(services/seaway_refresh.js),
 *   갱신 결과를 배포 파일인 client/ 에 쓰면 다음 배포 때 되돌아가 버린다. 그래서
 *   갱신본은 배포와 무관한 볼륨(local_server/data/)에 저장하고, 이 라우트가 그
 *   갱신본을 먼저 내보낸다. 갱신본이 아직 없으면(=원본이 한 번도 안 바뀌었으면)
 *   기존 배포본을 그대로 쓰면 되므로 next() 로 넘긴다.
 *
 * [등록 위치 주의]
 *   server.js 에서 이 라우트는 반드시 client 정적 서빙(expressStaticGzip) 보다
 *   앞줄에 등록해야 한다. 뒤에 두면 정적 파일이 먼저 응답해 이 라우트가 아예
 *   호출되지 않는다.
 *
 * [연계]
 *   - services/seaway_refresh.js → data/seaway_zones.json 을 만드는 쪽
 *   - client/js/marine-life/safety/seaway.js → fetch('/seaway_zones.json') 로 소비
 *   - server.js → app.use(require('./routes/seaway'))
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const router = express.Router();

const { DATA_DIR } = require('../config/server_config');

const REFRESHED_FILE = path.join(DATA_DIR, 'seaway_zones.json');

/** GET /seaway_zones.json — 갱신본이 있으면 그것, 없으면 정적 배포본으로 폴백 */
router.get('/seaway_zones.json', (req, res, next) => {
    try {
        if (!fs.existsSync(REFRESHED_FILE)) return next();
        res.type('application/json').send(fs.readFileSync(REFRESHED_FILE, 'utf8'));
    } catch (e) {
        // 갱신본이 깨졌더라도 지도가 항로를 아예 못 그리는 일이 없도록 정적 배포본으로 넘긴다.
        console.error(`[seaway] 갱신본 서빙 실패 — 배포본으로 폴백: ${e.message}`);
        next();
    }
});

module.exports = router;
