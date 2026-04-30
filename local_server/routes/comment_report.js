/**
 * ============================================================================
 * 파일명: routes/comment_report.js
 * 역할: 댓글 신고 API
 * ============================================================================
 *
 * - POST  /api/comment-reports                  → 댓글 신고 접수
 * - GET   /api/comment-reports                  → 전체 신고 목록 조회 (관리자용)
 * - GET   /api/comment-reports/pending-count    → 대기중 신고 건수
 * - PATCH /api/comment-reports/:id/status       → 신고 처리 상태 변경
 *
 * [데이터 구조] data/comment_reports.json
 * {
 *   id: string,              // "cr_타임스탬프_랜덤"
 *   commentId: string,       // 신고된 댓글 ID
 *   postId: string,          // 해당 게시글 ID
 *   reason: string,          // 신고 사유
 *   reporterDeviceId: string,// 신고자 기기 ID
 *   commentNickname: string, // 신고된 댓글 작성자 닉네임
 *   commentContent: string,  // 신고된 댓글 내용 (스냅샷)
 *   status: string,          // 'pending'|'deleted'|'blocked'|'ignored'|'done'
 *   createdAt: string,       // "YYYY.MM.DD HH:mm"
 *   processedAt: string|null,
 *   processNote: string|null
 * }
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/server_config');

const COMMENT_REPORTS_FILE = path.join(DATA_DIR, 'comment_reports.json');

/**
 * 관리자 기기 푸시 알림 서비스
 * 댓글 신고 접수 시 관리자에게 푸시 알림을 보내는 데 사용
 *
 * [연계] services/admin_push.js → sendAdminPush(title, body, data)
 */
let sendAdminPush;
try {
    sendAdminPush = require('../services/admin_push').sendAdminPush;
} catch (e) { /* admin_push 서비스 미설치 시 무시 */ }

/** 댓글 신고 목록을 COMMENT_REPORTS_FILE 에서 읽기. 파일 없거나 파싱 실패 시 빈 배열. */
function getCommentReports() {
    try {
        if (!fs.existsSync(COMMENT_REPORTS_FILE)) return [];
        return JSON.parse(fs.readFileSync(COMMENT_REPORTS_FILE, 'utf8') || '[]');
    } catch (e) { return []; }
}

/** 댓글 신고 목록을 indent 2 로 동기 저장. */
function saveCommentReports(reports) {
    fs.writeFileSync(COMMENT_REPORTS_FILE, JSON.stringify(reports, null, 2), 'utf8');
}

/**
 * 현재 시각을 KST 기준 'YYYY-MM-DD HH:mm:ss' 형식으로 반환.
 * 댓글 신고 등록 시 createdAt 등 타임스탬프 포맷 통일.
 */
function getKstString() {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const yyyy = kst.getUTCFullYear();
    const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(kst.getUTCDate()).padStart(2, '0');
    const hh = String(kst.getUTCHours()).padStart(2, '0');
    const min = String(kst.getUTCMinutes()).padStart(2, '0');
    return `${yyyy}.${mm}.${dd} ${hh}:${min}`;
}

// ============================================================================
// 대기중 신고 건수 조회 (중요: /pending-count 먼저 등록해야 /:id와 충돌 없음)
// ============================================================================

router.get('/api/comment-reports/pending-count', (req, res) => {
    const reports = getCommentReports();
    const count = reports.filter(r => r.status === 'pending').length;
    res.json({ count });
});

// ============================================================================
// 전체 신고 목록 조회 (관리자용)
// ============================================================================

router.get('/api/comment-reports', (req, res) => {
    const reports = getCommentReports();
    reports.sort((a, b) => {
        const da = new Date(a.createdAt.replace(/\./g, '-'));
        const db = new Date(b.createdAt.replace(/\./g, '-'));
        return db - da;
    });
    res.json(reports);
});

// ============================================================================
// 댓글 신고 접수
// ============================================================================

router.post('/api/comment-reports', (req, res) => {
    const { commentId, postId, reason, reporterDeviceId, commentNickname, commentContent } = req.body;

    if (!commentId || !reason || !reporterDeviceId) {
        return res.status(400).json({ error: '필수 항목이 누락되었습니다.' });
    }

    const reports = getCommentReports();

    // 중복 신고 방지
    const existing = reports.find(r =>
        r.commentId === commentId && r.reporterDeviceId === String(reporterDeviceId)
    );
    if (existing) {
        return res.status(400).json({ error: '이미 신고한 댓글입니다.' });
    }

    const rand = Math.floor(Math.random() * 9000) + 1000;
    const newReport = {
        id: `cr_${Date.now()}_${rand}`,
        commentId: String(commentId),
        postId: String(postId || ''),
        reason: String(reason),
        reporterDeviceId: String(reporterDeviceId),
        commentNickname: String(commentNickname || ''),
        commentContent: String(commentContent || '').substring(0, 300), // 300자 제한
        status: 'pending',
        createdAt: getKstString(),
        processedAt: null,
        processNote: null
    };

    reports.push(newReport);
    saveCommentReports(reports);

    // 관리자 기기에 댓글 신고 접수 푸시 알림 발송
    if (sendAdminPush) {
        var reasonText = String(reason).substring(0, 30);
        sendAdminPush(
            '🚨 새 댓글 신고 접수',
            `사유: ${reasonText}`,
            { type: 'comment_report', reportId: newReport.id }
        ).catch(function(e) { console.error('[CommentReport] 관리자 푸시 발송 실패:', e.message); });
    }

    res.json({ success: true });
});

// ============================================================================
// 신고 처리 상태 변경 (관리자용)
// ============================================================================

router.patch('/api/comment-reports/:id/status', (req, res) => {
    const { id } = req.params;
    const { status, processNote } = req.body;

    const VALID_STATUSES = ['deleted', 'blocked', 'ignored', 'done'];
    if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ error: '유효하지 않은 상태값입니다.' });
    }

    const reports = getCommentReports();
    const idx = reports.findIndex(r => r.id === id);
    if (idx === -1) {
        return res.status(404).json({ error: '신고를 찾을 수 없습니다.' });
    }

    reports[idx] = {
        ...reports[idx],
        status,
        processNote: processNote || null,
        processedAt: getKstString()
    };

    saveCommentReports(reports);
    res.json({ success: true });
});

module.exports = router;
