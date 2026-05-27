/**
 * routes/typhoon.js — 태풍 통보문/예보 데이터 API
 *
 *  GET /api/typhoon
 *    typhoon_crawler.js 가 저장한 data/typhoon.json(현재 연도 활성 태풍들 + 통보문 표)을
 *    그대로 응답 — 기본(즉시) 표출용. 파일 없으면 { hasActive:false }.
 *
 *  [연도/태풍/통보문 드롭다운용 on-demand — dmdw 라이브 조회 + 짧은 캐시]
 *  GET /api/typhoon/list?year=YYYY            → { year, typhoons:[{seq,name}] }
 *  GET /api/typhoon/bulletins?year=YYYY&seq=N → { bulletins:[{code,label,kind,tmFc,seq,isLatest}] }
 *  GET /api/typhoon/bulletin?year=YYYY&code=  → { code, current, forecast, name, nameEn }
 */
'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/server_config');
const typhoon = require('../typhoon_crawler');

const TYPHOON_FILE = path.join(DATA_DIR, 'typhoon.json');

// 간단한 메모리 TTL 캐시 (dmdw 부하/지연 완화)
const _cache = new Map();
function cached(key, ttlMs, fn) {
    const e = _cache.get(key);
    if (e && Date.now() - e.t < ttlMs) return Promise.resolve(e.v);
    return Promise.resolve(fn()).then(v => { _cache.set(key, { t: Date.now(), v }); return v; });
}

function parseYear(q) {
    const y = parseInt(q, 10);
    const now = new Date().getFullYear();
    if (!Number.isFinite(y) || y < 2001 || y > now + 1) return now;
    return y;
}

router.get('/api/typhoon', (req, res) => {
    try {
        if (!fs.existsSync(TYPHOON_FILE)) {
            return res.json({ updatedAt: null, hasActive: false, typhoons: [] });
        }
        const data = JSON.parse(fs.readFileSync(TYPHOON_FILE, 'utf8'));
        res.set('Cache-Control', 'public, max-age=60');
        res.json(data);
    } catch (err) {
        res.status(500).json({ hasActive: false, error: err.message });
    }
});

router.get('/api/typhoon/list', async (req, res) => {
    try {
        if (!typhoon.enabled) return res.json({ year: parseYear(req.query.year), typhoons: [] });
        const year = parseYear(req.query.year);
        const typhoons = await cached('list_' + year, 5 * 60 * 1000, () => typhoon.getTyphoonList(year));
        res.json({ year, typhoons });
    } catch (err) {
        res.status(500).json({ typhoons: [], error: err.message });
    }
});

router.get('/api/typhoon/bulletins', async (req, res) => {
    try {
        if (!typhoon.enabled) return res.json({ bulletins: [] });
        const year = parseYear(req.query.year);
        const seq = String(req.query.seq || '').replace(/[^0-9]/g, '');
        if (!seq) return res.status(400).json({ bulletins: [], error: 'seq required' });
        const bulletins = await cached('bul_' + year + '_' + seq, 3 * 60 * 1000, () => typhoon.getBulletinList(year, seq));
        res.json({ year, seq, bulletins });
    } catch (err) {
        res.status(500).json({ bulletins: [], error: err.message });
    }
});

router.get('/api/typhoon/bulletin', async (req, res) => {
    try {
        if (!typhoon.enabled) return res.status(404).json({ error: 'disabled' });
        const year = parseYear(req.query.year);
        const code = String(req.query.code || '');
        if (!/^[0-9_]+$/.test(code)) return res.status(400).json({ error: 'invalid code' });
        const data = await cached('one_' + year + '_' + code, 10 * 60 * 1000, () => typhoon.getBulletin(year, code));
        if (!data) return res.status(404).json({ error: 'not found' });
        res.set('Cache-Control', 'public, max-age=120');
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
