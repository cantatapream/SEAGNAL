/**
 * ============================================================================
 * 파일명: local_server/routes/data_collection.js
 * 역할  : 관리자 「데이터 수집현황 → 수집 목록」에 데이터별 공식 갱신·우리 수집 시각·기준 시각·다음 기대 시각·상태를 준다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/admin_auth(기존 X-Admin-Token 검사) · services/data_collection_status(계산)
 *  - 서버 API      : GET /api/admin/data-collection
 *  - 마크업        : 없음
 *  - 나를 쓰는 곳  : server.js(등록) · client/js/admin/admin_data_status.js(화면) · 검사 test_data_collection_status
 * [로드 순서] server.js 에서 routes/admin 보다 먼저 등록한다(routes/risk_errors 와 같은 자리 — 자체 인증).
 * ============================================================================
 */
'use strict';
const express = require('express'),
    adminAuth = require('../services/admin_auth'),
    { createStatus } = require('../services/data_collection_status');

/**
 * 라우터를 만든다. 검사에서는 계산기와 인증을 바꿔 끼운다.
 * 예: createRouter({ status: createStatus({dataDir: tmp}), authorize: (q, s, n) => n() })
 * @param {object} [o] @param {object} [o.status] - list() 를 가진 계산기 @param {function} [o.authorize] - 미들웨어
 * @returns {import('express').Router}
 * [연계] ← server.js / → data_collection_status.list
 */
function createRouter({ status = createStatus(), authorize = adminAuth.requireAdminToken } = {}) {
    const router = express.Router(),
        base = '/api/admin/data-collection';
    router.get(base, authorize, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            res.json(await status.list());
        } catch (e) {
            // 목록표 손상 등 — 빈 목록으로 감추지 않고 실패를 그대로 알린다.
            console.warn('[data_collection] 수집현황 계산 실패:', e && e.message);
            res.status(503).json({ ok: false, error: '수집현황을 읽지 못했습니다' });
        }
    });
    return router;
}
module.exports = createRouter();
module.exports.createRouter = createRouter;
