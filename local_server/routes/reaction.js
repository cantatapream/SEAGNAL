/**
 * ============================================================================
 * 파일명: routes/reaction.js
 * 역할: 게시글 리액션 API (❤️ 하트 / 👍 따봉 / 😮 놀람)
 * ============================================================================
 *
 * - GET  /api/reactions?postId=xxx&deviceId=xxx  → 리액션 수 + 내 리액션 조회
 * - POST /api/reactions                          → 리액션 등록/취소 (토글)
 *
 * [데이터 구조] data/reactions.json
 * {
 *   "postId": {
 *     "heart":  ["deviceId1", "deviceId2"],
 *     "thumbs": ["deviceId3"],
 *     "wow":    []
 *   }
 * }
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/server_config');

const REACTIONS_FILE = path.join(DATA_DIR, 'reactions.json');

function getReactions() {
    try {
        if (!fs.existsSync(REACTIONS_FILE)) return {};
        return JSON.parse(fs.readFileSync(REACTIONS_FILE, 'utf8') || '{}');
    } catch (e) { return {}; }
}

function saveReactions(data) {
    fs.writeFileSync(REACTIONS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ============================================================================
// 리액션 조회
// ============================================================================

/**
 * GET /api/reactions?postId=xxx&deviceId=xxx
 * 특정 게시글의 리액션 수와 내 리액션 타입을 반환한다.
 */
router.get('/api/reactions', (req, res) => {
    const { postId, deviceId } = req.query;
    if (!postId) return res.status(400).json({ error: 'postId가 필요합니다.' });

    const all = getReactions();
    const pr = all[String(postId)] || { heart: [], thumbs: [], wow: [] };

    let myReaction = null;
    if (deviceId) {
        ['heart', 'thumbs', 'wow'].forEach(type => {
            if ((pr[type] || []).includes(deviceId)) myReaction = type;
        });
    }

    res.json({
        heartCount: (pr.heart || []).length,
        thumbsCount: (pr.thumbs || []).length,
        wowCount: (pr.wow || []).length,
        myReaction
    });
});

// ============================================================================
// 리액션 토글 (등록/취소)
// ============================================================================

/**
 * POST /api/reactions
 * Body: { postId, deviceId, type: 'heart'|'thumbs'|'wow' }
 *
 * 이미 같은 타입이면 취소(제거), 다른 타입이면 교체, 없으면 등록.
 */
router.post('/api/reactions', (req, res) => {
    const { postId, deviceId, type } = req.body;
    if (!postId || !deviceId || !type) {
        return res.status(400).json({ error: '필수 항목이 누락되었습니다.' });
    }
    if (!['heart', 'thumbs', 'wow'].includes(type)) {
        return res.status(400).json({ error: '유효하지 않은 리액션 타입입니다.' });
    }

    const all = getReactions();
    const pid = String(postId);
    if (!all[pid]) all[pid] = { heart: [], thumbs: [], wow: [] };
    const pr = all[pid];
    ['heart', 'thumbs', 'wow'].forEach(t => { if (!pr[t]) pr[t] = []; });

    // 현재 내 리액션 타입 확인
    const currentType = ['heart', 'thumbs', 'wow'].find(t => pr[t].includes(deviceId)) || null;

    // 모든 타입에서 제거
    ['heart', 'thumbs', 'wow'].forEach(t => {
        pr[t] = pr[t].filter(d => d !== deviceId);
    });

    // 같은 타입이면 토글 OFF (이미 제거됨), 다른 타입이면 추가
    if (currentType !== type) {
        pr[type].push(deviceId);
    }

    saveReactions(all);

    const myReaction = currentType !== type ? type : null;
    res.json({
        success: true,
        heartCount: pr.heart.length,
        thumbsCount: pr.thumbs.length,
        wowCount: pr.wow.length,
        myReaction
    });
});

module.exports = router;
