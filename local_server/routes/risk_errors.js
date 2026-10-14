/**
 * 역할: 관리자에게만 위험예측 오류·누락·낡음·복구 이력을 제공한다.
 * [연계] 기존 admin_auth / risk_error_history → 관리자 AI 사고예측 오류현황.
 * [로드 순서] server.js에서 기존 admin 라우터보다 먼저 등록해 중복 인증을 피한다.
 */
'use strict';
const express = require('express'),
    historyDefault = require('../services/risk_error_history'),
    adminAuth = require('../services/admin_auth');
/** 기존 토큰 인증을 독립 라우터에도 적용한다. @param {object} options @returns {Router} [연계] ← server.js/검사 */
function createRouter({
    history = historyDefault,
    authorize = adminAuth.requireAdminToken,
} = {}) {
    const router = express.Router(),
        base = '/api/admin/risk-forecast/errors';
    router.use(base, authorize);
    router.get(base, (req, res) => {
        res.set('Cache-Control', 'no-store');
        const q = req.query,
            source = q.source || undefined,
            status = q.status || undefined,
            page = q.page === undefined ? 1 : Number(q.page),
            limit = q.limit === undefined ? 30 : Number(q.limit),
            from = q.from || undefined,
            to = q.to || undefined;
        const date = (s) =>
            typeof s === 'string' &&
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(
                s
            ) &&
            Number.isFinite(Date.parse(s));
        if (
            (source && !historyDefault.SOURCES.includes(source)) ||
            (status && !historyDefault.STATES.includes(status)) ||
            !Number.isInteger(page) ||
            page < 1 ||
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > 100 ||
            (from && !date(from)) ||
            (to && !date(to)) ||
            (from && to && Date.parse(from) > Date.parse(to))
        )
            return res
                .status(400)
                .json({ ok: false, error: '잘못된 이력 조회 조건' });
        try {
            res.json(history.list({ source, status, page, limit, from, to }));
        } catch (_) {
            res.status(503).json({
                ok: false,
                error: '오류 이력을 읽지 못했습니다',
            });
        }
    });
    return router;
}
module.exports = createRouter();
module.exports.createRouter = createRouter;
