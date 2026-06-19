/**
 * ============================================================================
 * routes/advisoryDemo.js — "특보 예측 시연" 기기 폴링용 공개 라우트
 * ============================================================================
 *
 * 관리자 등록 기기(유저 앱)가 폴링해 시연 목업을 화면에 덮어 표출하기 위한
 * 읽기 전용 공개 엔드포인트. (제어용 on/off·표출은 /api/admin/advisory-demo/*
 * 에서 관리자 토큰 인증 하에 수행 — routes/admin.js)
 *
 *   GET /api/advisory-demo/active     → { testMode, scenarioId, payload|null }
 *   GET /api/advisory-demo/scenarios  → [{ id, title, desc }]
 *
 * payload 는 /api/advisory-prediction 응답과 동일 형태라, 클라이언트가 그대로
 * renderAdvisoryPrediction 에 넘길 수 있다. 시연 OFF/미표출 시 payload:null.
 * 모든 처리는 graceful — 오류 시에도 200 + 안전한 기본값.
 * ============================================================================
 */
'use strict';

const express = require('express');
const router = express.Router();

let demo;
try { demo = require('../advisory/demoScenarios'); } catch (_) { demo = null; }

router.get('/api/advisory-demo/active', (req, res) => {
    res.set('Cache-Control', 'no-cache, must-revalidate');
    res.set('Content-Type', 'application/json; charset=utf-8');
    try {
        const state = demo ? demo.pollState() : { testMode: false, scenarioId: null, payload: null };
        return res.status(200).send(JSON.stringify(state));
    } catch (_) {
        return res.status(200).send(JSON.stringify({ testMode: false, scenarioId: null, payload: null }));
    }
});

router.get('/api/advisory-demo/scenarios', (req, res) => {
    res.set('Cache-Control', 'no-cache, must-revalidate');
    res.set('Content-Type', 'application/json; charset=utf-8');
    try {
        return res.status(200).send(JSON.stringify(demo ? demo.listScenarios() : []));
    } catch (_) {
        return res.status(200).send(JSON.stringify([]));
    }
});

module.exports = router;
