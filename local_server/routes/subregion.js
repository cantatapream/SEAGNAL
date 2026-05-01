/**
 * [자식해역 API 라우트]
 *
 * 자식해역 라이프사이클 / 오류 로그 조회 및 ack 처리.
 *
 * 모든 라우트는 페이지 무관하게 응답하나, 클라이언트 측에서
 * window.__SEAGNAL_PAGE === 'index1' 가드로 호출 자체를 제한합니다.
 *
 * 근거:
 * - 02_DATA_MODEL/05_error_log_schema.md
 * - 03_OPERATIONS/04_admin_ui.md
 */

'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/server_config');

const router = express.Router();

const LIFECYCLE_FILE = path.join(DATA_DIR, 'subregion_lifecycle.json');
const ERROR_LOG_FILE = path.join(DATA_DIR, 'subregion_error_log.json');
const ALIAS_MAP_FILE = path.join(DATA_DIR, 'region_alias_map.json');

function loadJson(filePath, defaultValue) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        return defaultValue;
    }
}

function saveJsonAtomic(filePath, data) {
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
}

// ============================================================================
// GET /api/subregion/state
// ============================================================================
router.get('/api/subregion/state', (req, res) => {
    const state = loadJson(LIFECYCLE_FILE, {
        schema_version: '1.0',
        lastUpdated: null,
        subregions: {},
        stats: { totalActive: 0, totalEstimated: 0, lastSuccessfulPoll: null }
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json(state);
});

// ============================================================================
// GET /api/subregion/alias-map  (선택, 디버깅/UI 용)
// ============================================================================
router.get('/api/subregion/alias-map', (req, res) => {
    const m = loadJson(ALIAS_MAP_FILE, null);
    if (!m) {
        return res.status(500).json({ error: 'alias_map_not_loaded' });
    }
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(m);
});

// ============================================================================
// GET /api/subregion/error-log
// ============================================================================
router.get('/api/subregion/error-log', (req, res) => {
    const log = loadJson(ERROR_LOG_FILE, {
        schema_version: '1.0',
        lastUpdated: null,
        errors: [],
        stats: { totalErrors: 0, unacknowledged: 0, byType: {} }
    });

    // 필터링 옵션
    const { errorType, acknowledged } = req.query;
    let errors = log.errors;
    if (errorType) {
        errors = errors.filter(e => e.errorType === errorType);
    }
    if (acknowledged === 'true') {
        errors = errors.filter(e => e.acknowledged);
    } else if (acknowledged === 'false') {
        errors = errors.filter(e => !e.acknowledged);
    }

    res.setHeader('Cache-Control', 'no-store');
    res.json({
        schema_version: log.schema_version,
        lastUpdated: log.lastUpdated,
        errors: errors,
        stats: log.stats
    });
});

// ============================================================================
// POST /api/subregion/error-ack
// ============================================================================
router.post('/api/subregion/error-ack', (req, res) => {
    const { errorId, adminId } = req.body || {};
    if (!errorId) {
        return res.status(400).json({ error: 'errorId is required' });
    }

    const log = loadJson(ERROR_LOG_FILE, null);
    if (!log) {
        return res.status(500).json({ error: 'error_log_not_loaded' });
    }

    const entry = log.errors.find(e => e.id === errorId);
    if (!entry) {
        return res.status(404).json({ error: 'errorId not found' });
    }

    entry.acknowledged = true;
    entry.acknowledgedAt = new Date().toISOString();
    entry.acknowledgedBy = adminId || 'unknown';

    log.lastUpdated = new Date().toISOString();
    log.stats.unacknowledged = log.errors.filter(e => !e.acknowledged).length;

    saveJsonAtomic(ERROR_LOG_FILE, log);
    res.json({ success: true, id: errorId });
});

// ============================================================================
// POST /api/subregion/error-ack-all
// ============================================================================
router.post('/api/subregion/error-ack-all', (req, res) => {
    const { adminId } = req.body || {};

    const log = loadJson(ERROR_LOG_FILE, null);
    if (!log) {
        return res.status(500).json({ error: 'error_log_not_loaded' });
    }

    const now = new Date().toISOString();
    let count = 0;
    for (const entry of log.errors) {
        if (!entry.acknowledged) {
            entry.acknowledged = true;
            entry.acknowledgedAt = now;
            entry.acknowledgedBy = adminId || 'unknown';
            count++;
        }
    }

    log.lastUpdated = now;
    log.stats.unacknowledged = 0;

    saveJsonAtomic(ERROR_LOG_FILE, log);
    res.json({ success: true, acknowledgedCount: count });
});

module.exports = router;
