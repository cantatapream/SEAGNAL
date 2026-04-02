/**
 * ============================================================================
 * 파일명: routes/content.js
 * 역할: 공지사항, 홍보 게시판, 파일 업로드 API 라우트
 * ============================================================================
 *
 * [설명]
 * 이 파일은 콘텐츠 관련 CRUD(생성/조회/수정/삭제) API를 관리합니다.
 * - 공지사항: GET/POST /api/notice, GET/POST /api/notices, DELETE /api/notice/:id
 * - 홍보 게시판: GET/POST /api/promo, GET /api/promo/:id, DELETE /api/promo/:id
 * - 파일 업로드: POST /api/upload (이미지), POST /api/upload-file (문서)
 *
 * [연계 파일]
 * - services/cache_manager.js → dataCache.notice, dataCache.promo 캐시 업데이트
 * - services/upload_manager.js → upload(이미지), uploadFile(문서) 미들웨어
 * - config/server_config.js → DATA_DIR 경로
 * - server.js → app.use()로 이 라우터 등록
 *
 * [초보자를 위한 안내]
 * 공지사항은 관리자가 작성하여 앱 상단에 팝업으로 표시되는 알림입니다.
 * 홍보 게시판은 관련 기관/단체의 홍보 글을 게시하는 공간입니다.
 * 파일 업로드는 이미지(jpg, png 등)와 문서(엑셀, 한글, PDF)를 지원합니다.
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/server_config');
const { dataCache } = require('../services/cache_manager');
const { upload } = require('../services/upload_manager');

// ============================================================================
// 공지사항 API
// ============================================================================

// 단일 공지사항 조회
router.get('/api/notice', (req, res) => {
    if (dataCache.notice) res.json(dataCache.notice);
    else res.json({ isActive: false });
});

// 단일 공지사항 저장/수정
router.post('/api/notice', (req, res) => {
    const newNotice = req.body;

    if (typeof newNotice.isActive !== 'boolean') {
        return res.status(400).json({ error: '잘못된 데이터 형식' });
    }

    try {
        const filePath = path.join(DATA_DIR, 'notice.json');
        fs.writeFileSync(filePath, JSON.stringify(newNotice, null, 2), 'utf8');

        dataCache.notice = newNotice;
        dataCache.lastUpdate.notice = Date.now();

        res.json({ success: true, message: '공지사항이 저장되었습니다.' });
    } catch (e) {
        console.error('공지 저장 실패:', e);
        res.status(500).json({ error: '저장 실패' });
    }
});

// 다중 공지사항 목록 조회 (활성/만료 분리)
router.get('/api/notices', (req, res) => {
    try {
        const filePath = path.join(DATA_DIR, 'notices.json');
        let notices = [];

        if (fs.existsSync(filePath)) {
            notices = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } else {
            if (dataCache.notice && dataCache.notice.isActive) {
                notices = [dataCache.notice];
            }
        }

        const now = new Date();
        const active = [];
        const expired = [];

        notices.forEach(n => {
            if (n.expiresAt) {
                const expDate = new Date(n.expiresAt.replace(' ', 'T') + ':00');
                if (isNaN(expDate.getTime())) {
                    // 날짜 파싱 실패 시 isActive 기준으로 분류
                    (n.isActive ? active : expired).push(n);
                } else if (expDate > now && n.isActive !== false) {
                    active.push(n);
                } else {
                    expired.push(n);
                }
            } else if (n.isActive) {
                active.push(n);
            } else {
                expired.push(n);
            }
        });

        res.json({ active, expired });
    } catch (e) {
        console.error('공지 목록 조회 실패:', e);
        res.json({ active: [], expired: [] });
    }
});

// 다중 공지사항 저장/수정
router.post('/api/notices', (req, res) => {
    const newNotice = req.body;

    try {
        const filePath = path.join(DATA_DIR, 'notices.json');
        let notices = [];

        if (fs.existsSync(filePath)) {
            notices = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }

        const existingIdx = notices.findIndex(n => String(n.id) === String(newNotice.id));
        if (existingIdx >= 0) {
            notices[existingIdx] = newNotice;
        } else {
            notices.unshift(newNotice);
        }

        fs.writeFileSync(filePath, JSON.stringify(notices, null, 2), 'utf8');

        if (newNotice.isActive) {
            const singlePath = path.join(DATA_DIR, 'notice.json');
            fs.writeFileSync(singlePath, JSON.stringify(newNotice, null, 2), 'utf8');
            dataCache.notice = newNotice;
        }

        res.json({ success: true });
    } catch (e) {
        console.error('공지 저장 실패:', e);
        res.status(500).json({ error: '저장 실패' });
    }
});

// 공지사항 삭제
router.delete('/api/notice/:id', (req, res) => {
    const id = req.params.id; // 문자열 그대로 유지 (타입 불일치 방지)

    try {
        const filePath = path.join(DATA_DIR, 'notices.json');
        let notices = [];

        if (fs.existsSync(filePath)) {
            notices = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }

        notices = notices.filter(n => String(n.id) !== String(id));
        fs.writeFileSync(filePath, JSON.stringify(notices, null, 2), 'utf8');

        // 현재 활성 공지(notice.json / dataCache)가 삭제 대상이면 함께 정리
        if (dataCache.notice && String(dataCache.notice.id) === String(id)) {
            dataCache.notice = { isActive: false };
            const singlePath = path.join(DATA_DIR, 'notice.json');
            fs.writeFileSync(singlePath, JSON.stringify({ isActive: false }, null, 2), 'utf8');
        }

        res.json({ success: true });
    } catch (e) {
        console.error('공지 삭제 실패:', e);
        res.status(500).json({ error: '삭제 실패' });
    }
});

// ============================================================================
// 게시판(카테고리) 관리 API
// ============================================================================

// 게시판 목록 조회
router.get('/api/boards', (req, res) => {
    if (dataCache.boards) res.json(dataCache.boards);
    else {
        // 파일에서 직접 로드 시도
        const filePath = path.join(DATA_DIR, 'boards.json');
        if (fs.existsSync(filePath)) {
            try {
                const boards = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                dataCache.boards = boards;
                res.json(boards);
            } catch (e) {
                res.json([]);
            }
        } else {
            res.json([]);
        }
    }
});

// 게시판 저장 (추가/수정)
router.post('/api/boards', (req, res) => {
    const boardData = req.body;
    if (!boardData.name) {
        return res.status(400).json({ error: '게시판 이름은 필수입니다.' });
    }

    try {
        const filePath = path.join(DATA_DIR, 'boards.json');
        let boards = [];

        if (fs.existsSync(filePath)) {
            boards = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }

        if (boardData.id) {
            // 수정
            const index = boards.findIndex(b => b.id === boardData.id);
            if (index !== -1) {
                boards[index] = { ...boards[index], ...boardData };
            } else {
                return res.status(404).json({ error: '게시판을 찾을 수 없습니다.' });
            }
        } else {
            // 신규: ID는 대문자 영문으로 생성
            const newId = 'BOARD_' + Date.now();
            const maxOrder = boards.reduce((max, b) => Math.max(max, b.sortOrder || 0), 0);
            const newBoard = {
                id: newId,
                name: boardData.name,
                badgeText: boardData.badgeText || boardData.name.substring(0, 2),
                badgeColor: boardData.badgeColor || '#94a3b8',
                sortOrder: maxOrder + 1,
                isDefault: false,
                createdAt: new Date().toISOString()
            };
            boards.push(newBoard);
        }

        fs.writeFileSync(filePath, JSON.stringify(boards, null, 2), 'utf8');
        dataCache.boards = boards;
        dataCache.lastUpdate.boards = Date.now();

        res.json({ success: true, boards });
    } catch (e) {
        console.error('게시판 저장 실패:', e);
        res.status(500).json({ error: '저장 실패' });
    }
});

// 게시판 순서 일괄 변경
router.post('/api/boards/reorder', (req, res) => {
    const { order } = req.body; // [{ id, sortOrder }, ...]
    if (!Array.isArray(order)) {
        return res.status(400).json({ error: '올바른 순서 데이터가 필요합니다.' });
    }

    try {
        const filePath = path.join(DATA_DIR, 'boards.json');
        let boards = [];

        if (fs.existsSync(filePath)) {
            boards = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }

        order.forEach(item => {
            const board = boards.find(b => b.id === item.id);
            if (board) board.sortOrder = item.sortOrder;
        });

        boards.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

        fs.writeFileSync(filePath, JSON.stringify(boards, null, 2), 'utf8');
        dataCache.boards = boards;
        dataCache.lastUpdate.boards = Date.now();

        res.json({ success: true, boards });
    } catch (e) {
        console.error('게시판 순서 변경 실패:', e);
        res.status(500).json({ error: '순서 변경 실패' });
    }
});

// 게시판 삭제
router.delete('/api/boards/:id', (req, res) => {
    const id = req.params.id;

    try {
        const filePath = path.join(DATA_DIR, 'boards.json');
        let boards = [];

        if (fs.existsSync(filePath)) {
            boards = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }

        const target = boards.find(b => b.id === id);
        if (!target) {
            return res.status(404).json({ error: '게시판을 찾을 수 없습니다.' });
        }

        // 해당 게시판에 속한 게시글 수 확인
        const promoPath = path.join(DATA_DIR, 'promo.json');
        let posts = [];
        if (fs.existsSync(promoPath)) {
            posts = JSON.parse(fs.readFileSync(promoPath, 'utf8'));
        }
        const postsInBoard = posts.filter(p => p.category === id);
        if (postsInBoard.length > 0) {
            return res.status(400).json({
                error: `이 게시판에 ${postsInBoard.length}개의 게시글이 있습니다. 게시글을 먼저 삭제하거나 다른 게시판으로 이동해주세요.`
            });
        }

        boards = boards.filter(b => b.id !== id);
        fs.writeFileSync(filePath, JSON.stringify(boards, null, 2), 'utf8');
        dataCache.boards = boards;
        dataCache.lastUpdate.boards = Date.now();

        res.json({ success: true });
    } catch (e) {
        console.error('게시판 삭제 실패:', e);
        res.status(500).json({ error: '삭제 실패' });
    }
});

// ============================================================================
// 홍보 게시판 API
// ============================================================================

// 게시글 목록 조회
router.get('/api/promo', (req, res) => {
    if (dataCache.promo) res.json(dataCache.promo);
    else res.json([]);
});

// 게시글 상세 조회 (조회수 증가)
router.get('/api/promo/:id', (req, res) => {
    const id = req.params.id;
    try {
        const filePath = path.join(DATA_DIR, 'promo.json');
        let posts = [];
        if (fs.existsSync(filePath)) {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            if (fileContent) posts = JSON.parse(fileContent);
        }

        const index = posts.findIndex(p => String(p.id) === String(id));
        if (index === -1) {
            return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });
        }

        // 조회수 증가 로직
        // - 관리자 기기(?admin=true)인 경우: 하루에 1회만 조회수 증가
        //   → 해당 게시글의 adminViewDate가 오늘이면 증가하지 않음
        // - 일반 사용자인 경우: 기존과 동일하게 매번 +1
        const isAdmin = req.query.admin === 'true';
        const now = new Date();
        const kstDate = new Date(now.getTime() + (9 * 60 * 60 * 1000));
        const todayStr = kstDate.toISOString().split('T')[0];

        let shouldIncView = true;
        if (isAdmin && posts[index].adminViewDate === todayStr) {
            // 관리자가 오늘 이미 이 게시글을 조회한 적 있으면 조회수 증가 안 함
            shouldIncView = false;
        }

        if (shouldIncView) {
            posts[index].views = (posts[index].views || 0) + 1;
            if (isAdmin) {
                // 관리자 조회 날짜 기록 (하루 1회 제한용, 화면에는 표시되지 않음)
                posts[index].adminViewDate = todayStr;
            }
        }

        fs.writeFileSync(filePath, JSON.stringify(posts, null, 2), 'utf8');

        dataCache.promo = posts;
        dataCache.lastUpdate.promo = Date.now();

        res.json(posts[index]);
    } catch (e) {
        console.error('상세 조회 실패:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

// 게시글 저장/수정
router.post('/api/promo', (req, res) => {
    const postData = req.body;
    if (!postData.title || !postData.content) {
        return res.status(400).json({ error: '제목과 내용은 필수입니다.' });
    }

    try {
        const filePath = path.join(DATA_DIR, 'promo.json');
        let posts = [];

        if (fs.existsSync(filePath)) {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            if (fileContent) posts = JSON.parse(fileContent);
        }

        // KST 시간 포맷 헬퍼
        const getKstString = () => {
            const now = new Date();
            const kstOffset = 9 * 60 * 60 * 1000;
            const kstDate = new Date(now.getTime() + kstOffset);
            const yyyy = kstDate.getUTCFullYear();
            const mm = String(kstDate.getUTCMonth() + 1).padStart(2, '0');
            const dd = String(kstDate.getUTCDate()).padStart(2, '0');
            const hh = String(kstDate.getUTCHours()).padStart(2, '0');
            const min = String(kstDate.getUTCMinutes()).padStart(2, '0');
            return `${yyyy}.${mm}.${dd} ${hh}:${min}`;
        };

        if (postData.id) {
            // 수정
            const index = posts.findIndex(p => String(p.id) === String(postData.id));
            if (index !== -1) {
                posts[index] = {
                    ...posts[index],
                    ...postData,
                    category: postData.category || posts[index].category || 'PROMO',
                    isPinned: postData.isPinned !== undefined ? postData.isPinned : (posts[index].isPinned || false),
                    attachments: postData.attachments || posts[index].attachments || [],
                    updatedAt: getKstString()
                };
            } else {
                return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });
            }
        } else {
            // 신규
            const newPost = {
                id: Date.now(),
                title: postData.title,
                content: postData.content,
                category: postData.category || 'PROMO',
                isPinned: postData.isPinned || false,
                attachments: postData.attachments || [],
                createdAt: getKstString(),
                updatedAt: getKstString(),
                views: 0
            };
            posts.unshift(newPost);
        }

        fs.writeFileSync(filePath, JSON.stringify(posts, null, 2), 'utf8');

        dataCache.promo = posts;
        dataCache.lastUpdate.promo = Date.now();

        res.json({ success: true, message: '게시글이 저장되었습니다.' });
    } catch (e) {
        console.error('게시글 저장 실패:', e);
        res.status(500).json({ error: '저장 실패' });
    }
});

// 게시글 삭제
router.delete('/api/promo/:id', (req, res) => {
    const id = req.params.id;
    try {
        const filePath = path.join(DATA_DIR, 'promo.json');
        let posts = [];
        if (fs.existsSync(filePath)) {
            posts = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }

        const initialLength = posts.length;
        posts = posts.filter(p => String(p.id) !== String(id));

        if (posts.length === initialLength) {
            return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });
        }

        fs.writeFileSync(filePath, JSON.stringify(posts, null, 2), 'utf8');
        dataCache.promo = posts;

        res.json({ success: true, message: '삭제되었습니다.' });
    } catch (e) {
        console.error('삭제 실패:', e);
        res.status(500).json({ error: '삭제 실패' });
    }
});

// ============================================================================
// 파일 업로드 API
// ============================================================================

// 이미지 업로드
router.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: '파일이 없습니다.' });
    }

    let fileUrl;
    if (req.file.path && /^https?:\/\//.test(req.file.path)) {
        fileUrl = req.file.path;
    } else {
        fileUrl = `/uploads/${req.file.filename}`;
    }

    res.json({ url: fileUrl, filename: req.file.filename, originalName: req.file.originalname });
});

// 문서 파일 업로드 (엑셀, 한글, PDF 등)
router.post('/api/upload-file', (req, res, next) => {
    const uploadHandler = global.uploadFile || upload;
    uploadHandler.single('file')(req, res, (err) => {
        if (err) {
            console.error('파일 업로드 오류:', err);
            return res.status(500).json({ error: '파일 업로드 실패: ' + err.message });
        }

        if (!req.file) {
            return res.status(400).json({ error: '파일이 없습니다.' });
        }

        // 한글 파일명 깨짐 방지
        let originalName = req.file.originalname;
        try {
            originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
        } catch (e) {
            console.warn('파일명 인코딩 변환 실패:', e.message);
        }

        let fileUrl;
        if (req.file.path && /^https?:\/\//.test(req.file.path)) {
            fileUrl = req.file.path;
        } else {
            fileUrl = `/uploads/${req.file.filename}`;
        }

        const fileSize = req.file.size || 0;

        res.json({
            success: true,
            url: fileUrl,
            filename: req.file.filename,
            originalName: originalName,
            size: fileSize,
            type: req.file.mimetype || 'application/octet-stream'
        });
    });
});

module.exports = router;
