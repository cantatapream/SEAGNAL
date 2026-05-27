/**
 * routes/typhoon.js — 태풍 통보문/예보 데이터 API
 *
 * GET /api/typhoon
 *   typhoon_crawler.js 가 저장한 data/typhoon.json 을 그대로 응답.
 *   파일이 없거나 태풍이 없으면 { hasActive:false } 형태로 응답(프론트가 버튼 비활성 처리).
 */
'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/server_config');

const TYPHOON_FILE = path.join(DATA_DIR, 'typhoon.json');

router.get('/api/typhoon', (req, res) => {
    try {
        if (!fs.existsSync(TYPHOON_FILE)) {
            return res.json({ updatedAt: null, hasActive: false, typhoons: [], active: null, bulletins: [] });
        }
        const data = JSON.parse(fs.readFileSync(TYPHOON_FILE, 'utf8'));
        res.set('Cache-Control', 'public, max-age=60');
        res.json(data);
    } catch (err) {
        res.status(500).json({ hasActive: false, error: err.message });
    }
});

module.exports = router;
