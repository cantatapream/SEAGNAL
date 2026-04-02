/**
 * ============================================================================
 * 파일명: routes/comment.js
 * 역할: 게시글 댓글 시스템 API (댓글 CRUD)
 * ============================================================================
 *
 * [설명]
 * - GET  /api/comments             → 댓글 목록 조회 (?postId=xxx, ?admin=true)
 * - POST /api/comments             → 댓글/답글 등록
 * - PATCH /api/comments/:id        → 댓글 수정 (본인 or 관리자)
 * - DELETE /api/comments/:id       → 댓글 삭제 (soft delete, 원문 보존)
 *
 * [데이터 구조] data/comments.json
 * {
 *   id: string,           // "c_타임스탬프_랜덤"
 *   postId: string,       // 게시글 ID (promo.json의 id)
 *   parentId: string|null,// null=최상위댓글, 댓글ID=답글
 *   authorType: string,   // "user" | "admin"
 *   deviceId: string,     // 기기 식별자 (사용자 구분용)
 *   nickname: string,     // 닉네임 (관리자는 "관리자")
 *   content: string,      // 현재 댓글 내용
 *   isSecret: boolean,    // 비밀 댓글 여부 (작성자+관리자만 내용 열람 가능)
 *   isDeleted: boolean,   // soft delete 여부
 *   deletedBy: string|null, // null | "user" | "admin"
 *   originalContent: string|null, // 삭제 전 원문 (관리자 원문 보기용)
 *   isEdited: boolean,    // 수정 여부
 *   createdAt: string,    // "YYYY.MM.DD HH:mm"
 *   updatedAt: string     // "YYYY.MM.DD HH:mm"
 * }
 *
 * [연계 파일]
 * - config/server_config.js → DATA_DIR 경로
 * - server.js → app.use()로 이 라우터 등록
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/server_config');

// 댓글 데이터 파일 경로
const COMMENTS_FILE = path.join(DATA_DIR, 'comments.json');

// ============================================================================
// 내부 헬퍼 함수
// ============================================================================

/**
 * 댓글 JSON 파일에서 전체 댓글 목록을 읽어온다.
 * 파일이 없거나 파싱 오류 시 빈 배열 반환.
 */
function getComments() {
    try {
        if (!fs.existsSync(COMMENTS_FILE)) return [];
        const raw = fs.readFileSync(COMMENTS_FILE, 'utf8');
        return JSON.parse(raw || '[]');
    } catch (e) {
        console.error('[comment] 댓글 파일 읽기 실패:', e);
        return [];
    }
}

/**
 * 댓글 목록 전체를 JSON 파일에 저장한다.
 * @param {Array} comments - 저장할 댓글 배열
 */
function saveComments(comments) {
    fs.writeFileSync(COMMENTS_FILE, JSON.stringify(comments, null, 2), 'utf8');
}

/**
 * 한국 표준시(KST) 기준 현재 시각을 "YYYY.MM.DD HH:mm" 형식으로 반환한다.
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

/**
 * 댓글 고유 ID를 생성한다.
 * 형식: "c_타임스탬프_랜덤4자리"
 */
function generateCommentId() {
    const rand = Math.floor(Math.random() * 9000) + 1000;
    return `c_${Date.now()}_${rand}`;
}

// ============================================================================
// 댓글 목록 조회
// ============================================================================

/**
 * GET /api/comments?postId=xxx[&admin=true]
 *
 * 특정 게시글의 댓글 목록을 반환한다.
 * - 일반 사용자: 삭제된 댓글의 원문(originalContent)은 포함되지 않음
 * - 관리자(?admin=true): 삭제된 댓글의 originalContent 포함하여 반환
 *
 * 반환 데이터는 createdAt 오름차순(오래된 순)으로 정렬된다.
 */
router.get('/api/comments', (req, res) => {
    const { postId, admin } = req.query;
    if (!postId) {
        return res.status(400).json({ error: 'postId가 필요합니다.' });
    }

    const isAdmin = admin === 'true';
    const comments = getComments();

    // 요청한 기기 ID (비밀 댓글 열람 권한 판별용)
    const requestDeviceId = req.query.deviceId || '';

    // 해당 게시글의 댓글만 필터링
    let postComments = comments.filter(c => String(c.postId) === String(postId));

    // 시간순(오래된 순) 정렬
    postComments.sort((a, b) => new Date(a.createdAt.replace(/\./g, '-')) - new Date(b.createdAt.replace(/\./g, '-')));

    // 일반 사용자에게는 원문 정보 및 비밀 댓글 내용 제어
    if (!isAdmin) {
        postComments = postComments.map(c => {
            if (c.isDeleted) {
                // 삭제된 댓글은 원문 숨김
                const { originalContent, ...safe } = c;
                return safe;
            }
            // 비밀 댓글: 작성자 본인이 아니면 내용 숨김
            if (c.isSecret && c.deviceId !== requestDeviceId) {
                return { ...c, content: '__SECRET__' }; // 클라이언트에서 "비밀 댓글입니다." 처리
            }
            return c;
        });
    }

    res.json(postComments);
});

// ============================================================================
// 댓글 등록
// ============================================================================

/**
 * POST /api/comments
 * Body: { postId, parentId?, authorType, deviceId, nickname, content }
 *
 * 새 댓글 또는 답글을 등록한다.
 * - parentId 없음 → 최상위 댓글
 * - parentId 있음 → 해당 댓글의 답글 (관리자만 가능하도록 클라이언트에서 제한)
 */
router.post('/api/comments', (req, res) => {
    const { postId, parentId, authorType, deviceId, nickname, content, isSecret } = req.body;

    // 필수값 검증
    if (!postId || !deviceId || !nickname || !content || !content.trim()) {
        return res.status(400).json({ error: '필수 항목이 누락되었습니다.' });
    }

    // 내용 길이 제한 (최대 500자)
    if (content.trim().length > 500) {
        return res.status(400).json({ error: '댓글은 500자 이내로 작성해주세요.' });
    }

    const comments = getComments();

    // parentId가 있으면 해당 댓글이 존재하는지 확인
    if (parentId) {
        const parent = comments.find(c => c.id === parentId);
        if (!parent) {
            return res.status(404).json({ error: '답글을 달 댓글을 찾을 수 없습니다.' });
        }
    }

    const now = getKstString();
    const newComment = {
        id: generateCommentId(),
        postId: String(postId),
        parentId: parentId || null,
        authorType: authorType || 'user',   // "user" | "admin"
        deviceId: String(deviceId),
        nickname: nickname,
        content: content.trim(),
        isSecret: isSecret === true || isSecret === 'true', // 비밀 댓글 여부
        isDeleted: false,
        deletedBy: null,
        originalContent: null,
        isEdited: false,
        createdAt: now,
        updatedAt: now
    };

    comments.push(newComment);
    saveComments(comments);

    res.json({ success: true, comment: newComment });
});

// ============================================================================
// 댓글 수정
// ============================================================================

/**
 * PATCH /api/comments/:id
 * Body: { content, deviceId, isAdmin? }
 *
 * 댓글 내용을 수정한다.
 * - 사용자: deviceId가 일치해야만 수정 가능 (본인 댓글)
 * - 관리자: isAdmin=true 이면 deviceId 검증 없이 수정 가능
 * 수정 후 isEdited=true, updatedAt 갱신
 */
router.patch('/api/comments/:id', (req, res) => {
    const { id } = req.params;
    const { content, deviceId, isAdmin } = req.body;

    if (!content || !content.trim()) {
        return res.status(400).json({ error: '수정할 내용이 필요합니다.' });
    }
    if (content.trim().length > 500) {
        return res.status(400).json({ error: '댓글은 500자 이내로 작성해주세요.' });
    }

    const comments = getComments();
    const idx = comments.findIndex(c => c.id === id);

    if (idx === -1) {
        return res.status(404).json({ error: '댓글을 찾을 수 없습니다.' });
    }

    const comment = comments[idx];

    // 삭제된 댓글은 수정 불가
    if (comment.isDeleted) {
        return res.status(400).json({ error: '삭제된 댓글은 수정할 수 없습니다.' });
    }

    // 권한 검증: 관리자가 아니면 deviceId가 일치해야 함
    if (!isAdmin && comment.deviceId !== String(deviceId)) {
        return res.status(403).json({ error: '수정 권한이 없습니다.' });
    }

    comments[idx] = {
        ...comment,
        content: content.trim(),
        isEdited: true,
        updatedAt: getKstString()
    };

    saveComments(comments);
    res.json({ success: true, comment: comments[idx] });
});

// ============================================================================
// 댓글 삭제 (soft delete)
// ============================================================================

/**
 * DELETE /api/comments/:id
 * Body: { deviceId, isAdmin?, deletedBy }
 *
 * 댓글을 소프트 삭제한다. 실제로 제거하지 않고 isDeleted=true로 표시.
 * - originalContent: 삭제 전 원문을 보존 (관리자 원문 보기용)
 * - deletedBy: "user" 또는 "admin" → 화면에 다른 메시지 표시
 * - 사용자: deviceId 일치 시만 가능
 * - 관리자: isAdmin=true 이면 무조건 가능
 */
router.delete('/api/comments/:id', (req, res) => {
    const { id } = req.params;
    const { deviceId, isAdmin, deletedBy } = req.body;

    const comments = getComments();
    const idx = comments.findIndex(c => c.id === id);

    if (idx === -1) {
        return res.status(404).json({ error: '댓글을 찾을 수 없습니다.' });
    }

    const comment = comments[idx];

    // 이미 삭제된 댓글
    if (comment.isDeleted) {
        return res.status(400).json({ error: '이미 삭제된 댓글입니다.' });
    }

    // 권한 검증
    if (!isAdmin && comment.deviceId !== String(deviceId)) {
        return res.status(403).json({ error: '삭제 권한이 없습니다.' });
    }

    // soft delete: 원문 보존, 삭제 표시
    comments[idx] = {
        ...comment,
        isDeleted: true,
        deletedBy: deletedBy || (isAdmin ? 'admin' : 'user'),
        originalContent: comment.content, // 원문 보존
        content: '',                       // 본문 비움
        updatedAt: getKstString()
    };

    saveComments(comments);
    res.json({ success: true });
});

module.exports = router;
