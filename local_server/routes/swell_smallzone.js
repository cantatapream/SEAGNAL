/**
 * ============================================================================
 * routes/swell_smallzone.js
 * 소해구별 너울 위험등급 제공 API.
 *
 *   GET /api/swell-smallzone/status          → 캐시 상태(생산시각·프레임 수·소해구 수)
 *   GET /api/swell-smallzone                 → 지금 시각에 가장 가까운 예보의 소해구별 등급표
 *   GET /api/swell-smallzone?frame=3         → 그 예보시각(3번째)의 등급표
 *   GET /api/swell-smallzone?frame=0&coast=1 → 우리 해안 소해구(233개)만 골라서
 *   GET /api/swell-smallzone/cell?key=144-9  → 한 소해구의 예보 시계열
 *
 * 등급은 숫자 1~4 로 준다(1 관심 / 2 주의 / 3 경계 / 4 위험). 색·이름 표기는
 * 클라이언트(js/marine-life/swell/swell.js)가 정한다.
 *
 * [연계]
 *  - services/swell_smallzone.js → 수집·캐시
 *  - client/coastline_segments.json → coast=1 일 때 고를 소해구 목록의 출처
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const router = express.Router();
const sz = require('../services/swell_smallzone');

const SEG_PATH = path.join(__dirname, '..', '..', 'client', 'coastline_segments.json');

/** 해안 소해구 키 목록(파일에서 1회 읽어 캐시). 파일이 없으면 null. */
let _coastKeys = undefined;
function _loadCoastKeys() {
    if (_coastKeys !== undefined) return _coastKeys;
    try {
        const j = JSON.parse(fs.readFileSync(SEG_PATH, 'utf8'));
        _coastKeys = Array.isArray(j.zones) ? j.zones : null;
    } catch (e) {
        console.error('[swell-smallzone] coastline_segments.json 읽기 실패:', e.message);
        _coastKeys = null;
    }
    return _coastKeys;
}

router.get('/api/swell-smallzone/status', (req, res) => {
    res.json({ success: true, ...sz.getStatus() });
});

router.get('/api/swell-smallzone/cell', (req, res) => {
    const key = String(req.query.key || '');
    const out = sz.getCell(key);
    if (!out) return res.json({ success: false, error: '해당 소해구 자료 없음: ' + key });
    res.json({ success: true, ...out });
});

router.get('/api/swell-smallzone', (req, res) => {
    // frame 을 주지 않으면 지금 시각에 가장 가까운 예보시각을 쓴다.
    const frame = (req.query.frame == null || req.query.frame === '') ? null : (parseInt(req.query.frame, 10) || 0);
    const onlyCoast = req.query.coast === '1' || req.query.coast === 'true';
    const keys = onlyCoast ? _loadCoastKeys() : null;
    res.json({ success: true, ...sz.getFrame(frame, keys) });
});

module.exports = router;
