/**
 * ============================================================================
 * 파일명: routes/report.js
 * 역할: 사용자 제보 시스템 API (제보 CRUD, 답변, 차단 관리)
 * ============================================================================
 *
 * [설명]
 * - POST /api/reports            → 제보 등록 (사진 첨부 최대 3장, 5MB)
 * - GET  /api/reports            → 제보 목록 조회 (관리자용)
 * - GET  /api/reports/:id        → 제보 상세 조회
 * - POST /api/reports/:id/answer → 답변 작성 (푸시 옵션)
 * - DELETE /api/reports/:id      → 제보 삭제 (첨부파일 포함)
 * - POST /api/reports/bulk-delete → 일괄 삭제
 * - GET  /api/reports/pending-count → 미읽음(isRead=false) 접수 제보 건수
 * - PATCH /api/reports/:id/read    → 제보 읽음 처리 (isRead=true)
 * - GET  /api/reports/pending-answer → 미확인 답변 조회 (사용자용)
 * - POST /api/reports/dismiss-answer → 답변 확인 처리 (사용자용)
 * - POST /api/blocks             → 차단 등록
 * - GET  /api/blocks             → 차단 목록 조회
 * - DELETE /api/blocks/:deviceId/:type → 차단 해제
 * - GET  /api/blocks/check/:deviceId  → 차단 상태 확인 (사용자용)
 *
 * [연계 파일]
 * - config/server_config.js → FILES.REPORTS, FILES.BLOCKS 경로
 * - services/upload_manager.js → multer 이미지 업로드
 * - routes/push.js → FCM 푸시 발송 참조
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { DATA_DIR, UPLOAD_DIR, FILES } = require('../config/server_config');

// Firebase Admin (푸시 알림용)
let firebaseAdmin;
try {
    firebaseAdmin = require('firebase-admin');
} catch (e) { /* Firebase 미설치 시 무시 */ }

/**
 * 관리자 기기 푸시 알림 서비스
 * 제보/신고 접수 시 관리자에게 푸시 알림을 보내는 데 사용
 *
 * [연계] services/admin_push.js → sendAdminPush(title, body, data)
 * [연계] POST /api/reports → 제보 등록 성공 후 호출
 */
let sendAdminPush;
try {
    sendAdminPush = require('../services/admin_push').sendAdminPush;
} catch (e) { /* admin_push 서비스 미설치 시 무시 */ }

// ============================================================================
// 이미지 업로드 설정 (제보 전용, 최대 3장, 5MB)
// ============================================================================
const REPORT_UPLOAD_DIR = path.join(UPLOAD_DIR, 'reports');
if (!fs.existsSync(REPORT_UPLOAD_DIR)) {
    fs.mkdirSync(REPORT_UPLOAD_DIR, { recursive: true });
}

const reportStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, REPORT_UPLOAD_DIR),
    filename: (req, file, cb) => {
        file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
        cb(null, Date.now() + '_' + file.originalname);
    }
});

const reportUpload = multer({
    storage: reportStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif|webp/;
        const ext = allowed.test(path.extname(file.originalname).toLowerCase());
        const mime = allowed.test(file.mimetype);
        cb(null, ext && mime);
    }
}).array('attachments', 3); // 최대 3장

// 답변 이미지 업로드 (최대 3장)
const answerUpload = multer({
    storage: reportStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif|webp/;
        const ext = allowed.test(path.extname(file.originalname).toLowerCase());
        const mime = allowed.test(file.mimetype);
        cb(null, ext && mime);
    }
}).array('answerAttachments', 3);

// ============================================================================
// 유틸리티 함수
// ============================================================================
function readJSON(filePath, defaultValue) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) {
        console.error(`[Report] JSON 읽기 오류 (${filePath}):`, e.message);
    }
    return defaultValue;
}

function writeJSON(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error(`[Report] JSON 쓰기 오류 (${filePath}):`, e.message);
    }
}

function getReports() {
    return readJSON(FILES.REPORTS, []);
}

function saveReports(reports) {
    writeJSON(FILES.REPORTS, reports);
}

function getBlocks() {
    return readJSON(FILES.BLOCKS, { reportBlocks: [], tideBlocks: [], appBlocks: [] });
}

function saveBlocks(blocks) {
    writeJSON(FILES.BLOCKS, blocks);
}

function generateReportId() {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const seq = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    return `rpt_${dateStr}_${seq}`;
}

function getKSTNow() {
    return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00');
}

// ============================================================================
// 제보 등록 (POST /api/reports)
// ============================================================================
router.post('/api/reports', (req, res) => {
    reportUpload(req, res, (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ error: '파일 크기는 5MB 이하만 가능합니다.' });
            }
            if (err.code === 'LIMIT_UNEXPECTED_FILE') {
                return res.status(400).json({ error: '사진은 최대 3장까지 첨부할 수 있습니다.' });
            }
            return res.status(500).json({ error: '파일 업로드 오류' });
        }

        const { deviceId, category, title, content } = req.body;

        if (!deviceId || !category || !title || !content) {
            return res.status(400).json({ error: '필수 항목이 누락되었습니다.' });
        }

        if (title.length > 50) {
            return res.status(400).json({ error: '제목은 50자 이내로 작성해주세요.' });
        }

        if (content.length > 1000) {
            return res.status(400).json({ error: '내용은 1000자 이내로 작성해주세요.' });
        }

        // 차단 확인
        const blocks = getBlocks();
        const isReportBlocked = blocks.reportBlocks.some(b => b.deviceId === deviceId && (b.until === 'permanent' || new Date(b.until) > new Date()));
        const isAppBlocked = blocks.appBlocks.some(b => b.deviceId === deviceId && (b.until === 'permanent' || new Date(b.until) > new Date()));

        if (isReportBlocked || isAppBlocked) {
            return res.status(403).json({ error: '제보가 제한된 상태입니다.' });
        }

        const attachments = (req.files || []).map(f => f.filename);

        const report = {
            id: generateReportId(),
            deviceId,
            category,
            title,
            content,
            attachments,
            status: '접수',
            createdAt: getKSTNow(),
            answer: null,
            answeredAt: null,
            answerRead: false,  // 사용자가 관리자 답변을 읽었는지 여부
            isRead: false       // 관리자가 이 제보를 열람했는지 여부 (읽으면 뱃지에서 제외)
        };

        const reports = getReports();
        reports.unshift(report); // 최신순 정렬을 위해 앞에 추가
        saveReports(reports);

        console.log(`📩 [Report] 새 제보 등록: ${report.id} (${category})`);

        // 관리자 기기에 제보 접수 푸시 알림 발송
        // 관리자가 앱을 열지 않아도 새 제보를 인지할 수 있도록 함
        if (sendAdminPush) {
            sendAdminPush(
                '📢 새 제보 접수',
                `[${category}] ${title}`,
                { type: 'new_report', reportId: report.id }
            ).catch(function(e) { console.error('[Report] 관리자 푸시 발송 실패:', e.message); });
        }

        res.json({ success: true, id: report.id });
    });
});

// ============================================================================
// 제보 목록 조회 - 관리자용 (GET /api/reports)
// ============================================================================
router.get('/api/reports', (req, res) => {
    const reports = getReports();
    const { status, category, deviceId } = req.query;

    let filtered = reports;
    if (deviceId) {
        filtered = filtered.filter(r => r.deviceId === deviceId);
    }
    if (status) {
        filtered = filtered.filter(r => r.status === status);
    }
    if (category) {
        filtered = filtered.filter(r => r.category === category);
    }

    res.json(filtered);
});

// ============================================================================
// 미읽음 제보 건수 (GET /api/reports/pending-count)
// 관리자가 아직 열람하지 않은 '접수' 상태의 제보 건수를 반환합니다.
// - isRead가 false이거나 undefined인 제보(기존 데이터 포함)를 미읽음으로 처리합니다.
// - 이 값이 헤더의 봉투 아이콘 뱃지 숫자로 사용됩니다.
// ============================================================================
router.get('/api/reports/pending-count', (req, res) => {
    const reports = getReports();
    // isRead가 false이거나 없는(기존 데이터) 경우 모두 미읽음으로 처리
    const count = reports.filter(r => r.status === '접수' && !r.isRead).length;
    res.json({ count });
});

// ============================================================================
// 제보 읽음 처리 (PATCH /api/reports/:id/read)
// 관리자가 제보 상세를 열람할 때 호출됩니다.
// isRead를 true로 설정하여 뱃지 카운트에서 제외합니다.
// 이미 읽은 제보를 다시 호출해도 오류 없이 성공 응답합니다(멱등성 보장).
// ============================================================================
router.patch('/api/reports/:id/read', (req, res) => {
    const { id } = req.params;
    const reports = getReports();
    const report = reports.find(r => r.id === id);

    if (!report) return res.status(404).json({ error: '제보를 찾을 수 없습니다.' });

    // 이미 읽은 경우에도 성공 응답 (중복 호출 안전)
    if (!report.isRead) {
        report.isRead = true;
        saveReports(reports);
    }

    res.json({ success: true });
});

// ============================================================================
// 미확인 답변 조회 - 사용자용 (GET /api/reports/pending-answer)
// ============================================================================
/**
 * 미확인 답변 조회 (사용자용)
 *
 * [동작]
 * 1. 최초 답변 미확인 건 → hasAnswer: true, type: "answer"
 * 2. 추가 답변 미확인 건 → hasAnswer: true, type: "additionalAnswer"
 * 3. 둘 다 없으면 → hasAnswer: false
 *
 * 최초 답변이 미확인이면 우선 표시, 확인 후 추가 답변 미확인 건 표시
 *
 * [연계] report_user.js → checkReportAnswer()에서 앱 시작 시 호출
 */
router.get('/api/reports/pending-answer', (req, res) => {
    const { deviceId } = req.query;
    if (!deviceId) return res.status(400).json({ error: 'deviceId 필요' });

    const reports = getReports();

    // 1순위: 최초 답변 미확인
    const pending = reports.find(r =>
        r.deviceId === deviceId &&
        r.status === '답변완료' &&
        r.answer &&
        !r.answerRead
    );

    if (pending) {
        return res.json({
            hasAnswer: true,
            type: 'answer',
            reportId: pending.id,
            title: pending.title,
            answer: pending.answer,
            answeredAt: pending.answeredAt,
            answerAttachments: pending.answerAttachments || []
        });
    }

    // 2순위: 추가 답변 미확인
    const pendingAdditional = reports.find(r =>
        r.deviceId === deviceId &&
        r.additionalAnswer &&
        r.additionalAnswerRead === false
    );

    if (pendingAdditional) {
        return res.json({
            hasAnswer: true,
            type: 'additionalAnswer',
            reportId: pendingAdditional.id,
            title: pendingAdditional.title,
            answer: pendingAdditional.additionalAnswer,
            answeredAt: pendingAdditional.additionalAnsweredAt,
            answerAttachments: []
        });
    }

    res.json({ hasAnswer: false });
});

// ============================================================================
// 답변 확인 처리 - 사용자용 (POST /api/reports/dismiss-answer)
// ============================================================================
/**
 * 답변 확인 처리 (사용자용)
 *
 * [동작]
 * type 파라미터에 따라 최초 답변 또는 추가 답변을 확인 처리
 * - type이 없거나 "answer" → answerRead = true (기존 동작)
 * - type이 "additionalAnswer" → additionalAnswerRead = true
 *
 * [연계] report_user.js → _dismissReportAnswer()에서 호출
 */
router.post('/api/reports/dismiss-answer', (req, res) => {
    const { deviceId, reportId, type } = req.body;
    if (!deviceId || !reportId) return res.status(400).json({ error: '필수 항목 누락' });

    const reports = getReports();
    const report = reports.find(r => r.id === reportId && r.deviceId === deviceId);
    if (!report) return res.status(404).json({ error: '제보를 찾을 수 없습니다.' });

    if (type === 'additionalAnswer') {
        report.additionalAnswerRead = true;
    } else {
        report.answerRead = true;
    }
    saveReports(reports);
    res.json({ success: true });
});

// ============================================================================
// 제보 상세 조회 (GET /api/reports/:id)
// ============================================================================
router.get('/api/reports/:id', (req, res) => {
    const reports = getReports();
    const report = reports.find(r => r.id === req.params.id);
    if (!report) return res.status(404).json({ error: '제보를 찾을 수 없습니다.' });
    res.json(report);
});

// ============================================================================
// 제보 이미지 다운로드 (GET /api/reports/:id/download/:filename)
// ============================================================================
router.get('/api/reports/:id/download/:filename', (req, res) => {
    const reports = getReports();
    const report = reports.find(r => r.id === req.params.id);
    if (!report) return res.status(404).json({ error: '제보를 찾을 수 없습니다.' });

    const filename = req.params.filename;
    const allAttachments = [...(report.attachments || []), ...(report.answerAttachments || [])];
    if (!allAttachments.includes(filename)) {
        return res.status(404).json({ error: '첨부파일을 찾을 수 없습니다.' });
    }

    const filePath = path.join(REPORT_UPLOAD_DIR, filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: '파일이 존재하지 않습니다.' });
    }

    res.download(filePath, filename);
});

// ============================================================================
// 답변 작성 (POST /api/reports/:id/answer)
// ============================================================================
router.post('/api/reports/:id/answer', (req, res) => {
    answerUpload(req, res, async (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: '파일 크기는 5MB 이하만 가능합니다.' });
            return res.status(500).json({ error: '파일 업로드 오류' });
        }

        const { answer, sendPush, existingAttachments } = req.body;
        if (!answer) return res.status(400).json({ error: '답변 내용을 입력해주세요.' });

        const reports = getReports();
        const report = reports.find(r => r.id === req.params.id);
        if (!report) return res.status(404).json({ error: '제보를 찾을 수 없습니다.' });

        // 기존 답변 이미지 중 삭제된 것 정리
        const keepExisting = existingAttachments
            ? (Array.isArray(existingAttachments) ? existingAttachments : [existingAttachments])
            : [];
        const oldAttachments = report.answerAttachments || [];
        const removedAttachments = oldAttachments.filter(f => !keepExisting.includes(f));
        deleteAttachments(removedAttachments);

        // 새 이미지 파일명
        const newAttachments = (req.files || []).map(f => f.filename);

        report.answer = answer;
        report.answeredAt = getKSTNow();
        report.status = '답변완료';
        report.answerRead = false;
        report.answerAttachments = [...keepExisting, ...newAttachments];
        saveReports(reports);

        // 푸시 알림 발송
        if (sendPush === 'true' || sendPush === true) {
            try {
                await sendReportPush(report.deviceId, '제보에 대한 답변이 도착했습니다.');
            } catch (e) {
                console.error('[Report] 푸시 발송 실패:', e.message);
            }
        }

        console.log(`✅ [Report] 답변 완료: ${report.id} (push: ${sendPush === 'true'}, images: ${report.answerAttachments.length})`);
        res.json({ success: true });
    });
});

// ============================================================================
// 사용자 추가 의견 등록 (POST /api/reports/:id/user-comment)
// ============================================================================
/**
 * 사용자가 관리자 답변을 확인한 후 1회에 한해 추가 의견을 보내는 API
 *
 * [제한 조건]
 * - 관리자 답변이 있어야 함 (answer 필드 존재)
 * - 이미 추가 의견을 보낸 적이 있으면 거부 (1회 제한)
 * - deviceId가 제보 작성자와 일치해야 함
 *
 * [동작]
 * 1. 추가 의견 텍스트를 report.userComment에 저장
 * 2. 작성 시각을 report.userCommentAt에 저장
 * 3. 관리자 기기에 푸시 알림 발송 ("사용자 추가 의견 접수")
 *
 * [연계] report_user.js → 사용자 제보 상세 화면 하단의 추가 의견 작성란
 * [연계] admin_report.js → 관리자 제보 상세에서 추가 의견 표시
 */
router.post('/api/reports/:id/user-comment', (req, res) => {
    const { deviceId, comment } = req.body;
    if (!deviceId || !comment) return res.status(400).json({ error: '필수 항목이 누락되었습니다.' });
    if (comment.length > 1000) return res.status(400).json({ error: '추가 의견은 1000자 이내로 작성해주세요.' });

    const reports = getReports();
    const report = reports.find(r => r.id === req.params.id && r.deviceId === deviceId);
    if (!report) return res.status(404).json({ error: '제보를 찾을 수 없습니다.' });

    // 답변이 없으면 추가 의견 불가
    if (!report.answer) return res.status(400).json({ error: '관리자 답변이 없는 제보에는 추가 의견을 작성할 수 없습니다.' });

    // 이미 추가 의견을 보낸 경우 거부 (1회 제한)
    if (report.userComment) return res.status(400).json({ error: '이미 추가 의견을 보냈습니다.' });

    report.userComment = comment;
    report.userCommentAt = getKSTNow();
    saveReports(reports);

    console.log(`💬 [Report] 사용자 추가 의견: ${report.id}`);

    // 관리자 기기에 푸시 알림
    if (sendAdminPush) {
        sendAdminPush(
            '💬 사용자 추가 의견 접수',
            `[${report.category}] ${report.title}`,
            { type: 'user_comment', reportId: report.id }
        ).catch(function(e) { console.error('[Report] 관리자 푸시 발송 실패:', e.message); });
    }

    res.json({ success: true });
});

// ============================================================================
// 관리자 추가 답변 작성 (POST /api/reports/:id/additional-answer)
// ============================================================================
/**
 * 관리자가 사용자의 추가 의견에 대해 추가 답변을 작성하는 API
 *
 * [제한 조건]
 * - 사용자 추가 의견이 있어야 함 (userComment 필드 존재)
 *
 * [동작]
 * 1. 추가 답변 텍스트를 report.additionalAnswer에 저장
 * 2. 작성 시각을 report.additionalAnsweredAt에 저장
 * 3. additionalAnswerRead = false 설정 (사용자 미확인 상태)
 * 4. 사용자에게 푸시 알림 발송 (옵션)
 *
 * [연계] admin_report.js → 관리자 제보 상세 화면의 추가 답변 작성란
 * [연계] report_user.js → 사용자 제보 상세에서 추가 답변 표시
 */
router.post('/api/reports/:id/additional-answer', async (req, res) => {
    const { answer, sendPush: pushFlag } = req.body;
    if (!answer) return res.status(400).json({ error: '추가 답변 내용을 입력해주세요.' });

    const reports = getReports();
    const report = reports.find(r => r.id === req.params.id);
    if (!report) return res.status(404).json({ error: '제보를 찾을 수 없습니다.' });

    if (!report.userComment) return res.status(400).json({ error: '사용자 추가 의견이 없어 추가 답변을 작성할 수 없습니다.' });

    report.additionalAnswer = answer;
    report.additionalAnsweredAt = getKSTNow();
    report.additionalAnswerRead = false;
    saveReports(reports);

    // 푸시 알림 발송 (옵션)
    if (pushFlag === 'true' || pushFlag === true) {
        try {
            await sendReportPush(report.deviceId, '추가 의견에 대한 답변이 도착했습니다.');
        } catch (e) {
            console.error('[Report] 푸시 발송 실패:', e.message);
        }
    }

    console.log(`✅ [Report] 추가 답변 완료: ${report.id}`);
    res.json({ success: true });
});

// ============================================================================
// 제보 삭제 (DELETE /api/reports/:id)
// ============================================================================
router.delete('/api/reports/:id', (req, res) => {
    let reports = getReports();
    const report = reports.find(r => r.id === req.params.id);
    if (!report) return res.status(404).json({ error: '제보를 찾을 수 없습니다.' });

    // 첨부파일 삭제 (제보 이미지 + 답변 이미지)
    deleteAttachments(report.attachments);
    deleteAttachments(report.answerAttachments);

    reports = reports.filter(r => r.id !== req.params.id);
    saveReports(reports);

    console.log(`🗑️ [Report] 제보 삭제: ${req.params.id}`);
    res.json({ success: true });
});

// ============================================================================
// 일괄 삭제 (POST /api/reports/bulk-delete)
// ============================================================================
router.post('/api/reports/bulk-delete', (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: '삭제할 제보 ID 목록이 필요합니다.' });
    }

    let reports = getReports();
    const toDelete = reports.filter(r => ids.includes(r.id));

    // 첨부파일 삭제 (제보 이미지 + 답변 이미지)
    toDelete.forEach(r => {
        deleteAttachments(r.attachments);
        deleteAttachments(r.answerAttachments);
    });

    reports = reports.filter(r => !ids.includes(r.id));
    saveReports(reports);

    console.log(`🗑️ [Report] 일괄 삭제: ${ids.length}건`);
    res.json({ success: true, deleted: ids.length });
});

// ============================================================================
// 차단 등록 (POST /api/blocks)
// ============================================================================
router.post('/api/blocks', (req, res) => {
    const { deviceId, type, reason, duration } = req.body;

    if (!deviceId || !type || !reason || !duration) {
        return res.status(400).json({ error: '필수 항목이 누락되었습니다.' });
    }

    const validTypes = ['report', 'app', 'tide'];
    if (!validTypes.includes(type)) {
        return res.status(400).json({ error: '유효하지 않은 차단 유형입니다.' });
    }

    // 차단 종료일 계산
    let until;
    if (duration === 'permanent') {
        until = 'permanent';
    } else {
        const durationMap = {
            '1d': 1, '7d': 7, '30d': 30, '90d': 90, '180d': 180
        };
        const days = durationMap[duration];
        if (!days) return res.status(400).json({ error: '유효하지 않은 차단 기간입니다.' });
        const endDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
        until = endDate.toISOString();
    }

    const blocks = getBlocks();
    const blockKey = type === 'report' ? 'reportBlocks' : (type === 'app' ? 'appBlocks' : 'tideBlocks');

    // 이미 차단되어 있으면 업데이트
    const existingIdx = blocks[blockKey].findIndex(b => b.deviceId === deviceId);
    const blockEntry = {
        deviceId,
        reason,
        duration,
        blockedAt: getKSTNow(),
        until
    };

    if (existingIdx !== -1) {
        blocks[blockKey][existingIdx] = blockEntry;
    } else {
        blocks[blockKey].push(blockEntry);
    }

    saveBlocks(blocks);

    console.log(`🚫 [Block] ${type} 차단 등록: ${deviceId} (${duration})`);
    res.json({ success: true });
});

// ============================================================================
// 차단 목록 조회 (GET /api/blocks)
// ============================================================================
router.get('/api/blocks', (req, res) => {
    const blocks = getBlocks();
    const { type } = req.query;

    if (type) {
        const blockKey = type === 'report' ? 'reportBlocks' : (type === 'app' ? 'appBlocks' : 'tideBlocks');
        return res.json(blocks[blockKey] || []);
    }

    res.json(blocks);
});

// ============================================================================
// 차단 해제 (DELETE /api/blocks/:deviceId/:type)
// ============================================================================
router.delete('/api/blocks/:deviceId/:type', (req, res) => {
    const { deviceId, type } = req.params;
    const validTypes = ['report', 'app', 'tide'];
    if (!validTypes.includes(type)) {
        return res.status(400).json({ error: '유효하지 않은 차단 유형입니다.' });
    }

    const blocks = getBlocks();
    const blockKey = type === 'report' ? 'reportBlocks' : (type === 'app' ? 'appBlocks' : 'tideBlocks');
    const before = blocks[blockKey].length;
    blocks[blockKey] = blocks[blockKey].filter(b => b.deviceId !== deviceId);

    if (blocks[blockKey].length === before) {
        return res.status(404).json({ error: '해당 차단 정보를 찾을 수 없습니다.' });
    }

    saveBlocks(blocks);

    console.log(`✅ [Block] ${type} 차단 해제: ${deviceId}`);
    res.json({ success: true });
});

// ============================================================================
// 차단 상태 확인 - 사용자용 (GET /api/blocks/check/:deviceId)
// ============================================================================
router.get('/api/blocks/check/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    const blocks = getBlocks();
    const now = new Date();

    const isActive = (block) => block.until === 'permanent' || new Date(block.until) > now;

    const reportBlock = blocks.reportBlocks.find(b => b.deviceId === deviceId && isActive(b));
    const appBlock = blocks.appBlocks.find(b => b.deviceId === deviceId && isActive(b));
    const tideBlock = blocks.tideBlocks.find(b => b.deviceId === deviceId && isActive(b));

    res.json({
        reportBlocked: !!reportBlock,
        appBlocked: !!appBlock,
        appBlockReason: appBlock ? appBlock.reason : null,
        appBlockUntil: appBlock ? appBlock.until : null,
        tideBlocked: !!tideBlock
    });
});

// ============================================================================
// 헬퍼: 첨부파일 삭제
// ============================================================================
function deleteAttachments(attachments) {
    if (!attachments || !Array.isArray(attachments)) return;
    attachments.forEach(filename => {
        const filePath = path.join(REPORT_UPLOAD_DIR, filename);
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (e) {
            console.error(`[Report] 파일 삭제 실패: ${filename}`, e.message);
        }
    });
}

// ============================================================================
// 헬퍼: FCM 푸시 발송 (deviceId 기반)
// ============================================================================
async function sendReportPush(deviceId, body) {
    if (!firebaseAdmin || firebaseAdmin.apps.length === 0) {
        console.warn('[Report] Firebase 미초기화, 푸시 발송 불가');
        return;
    }

    // subscriptions.json에서 deviceId와 매칭되는 FCM 토큰 찾기
    // deviceId는 localStorage 기반이므로 subscriptions에 deviceId 필드가 있어야 함
    // 현재 구조에서는 subscribe 시 deviceId를 함께 저장하도록 확장 필요
    // 임시: subscriptions.json에서 deviceId 필드로 검색
    const SUBS_FILE = FILES.SUBSCRIPTIONS || path.join(DATA_DIR, 'subscriptions.json');

    try {
        if (!fs.existsSync(SUBS_FILE)) return;
        const subs = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
        const matched = subs.filter(s => s.deviceId === deviceId);

        for (const sub of matched) {
            if (sub.type === 'fcm' && sub.token) {
                try {
                    await firebaseAdmin.messaging().send({
                        token: sub.token,
                        notification: {
                            title: 'SEAGNAL',
                            body: body
                        },
                        data: {
                            type: 'report_answer',
                            url: 'https://seagnal-server.fly.dev/?popup=report_answer'
                        },
                        android: { priority: 'high' },
                        apns: { headers: { 'apns-priority': '10' } }
                    });
                    console.log(`📤 [Report] 푸시 발송 성공: ${deviceId}`);
                } catch (e) {
                    console.error(`[Report] FCM 발송 실패:`, e.message);
                }
            }
        }
    } catch (e) {
        console.error('[Report] 푸시 발송 중 오류:', e.message);
    }
}

// ============================================================================
// 90일 경과 제보 자동 삭제 (외부에서 호출)
// ============================================================================
function cleanupExpiredReports() {
    const reports = getReports();
    const now = new Date();
    const RETENTION_DAYS = 90;

    const expired = reports.filter(r => {
        const created = new Date(r.createdAt);
        const diff = (now - created) / (1000 * 60 * 60 * 24);
        return diff > RETENTION_DAYS;
    });

    if (expired.length === 0) return 0;

    // 첨부파일 삭제 (제보 이미지 + 답변 이미지)
    expired.forEach(r => {
        deleteAttachments(r.attachments);
        deleteAttachments(r.answerAttachments);
    });

    const remaining = reports.filter(r => {
        const created = new Date(r.createdAt);
        const diff = (now - created) / (1000 * 60 * 60 * 24);
        return diff <= RETENTION_DAYS;
    });

    saveReports(remaining);
    console.log(`🧹 [Report] 90일 경과 제보 ${expired.length}건 자동 삭제`);
    return expired.length;
}

// 만료된 차단 자동 해제
function cleanupExpiredBlocks() {
    const blocks = getBlocks();
    const now = new Date();
    let cleaned = 0;

    ['reportBlocks', 'tideBlocks', 'appBlocks'].forEach(key => {
        const before = blocks[key].length;
        blocks[key] = blocks[key].filter(b =>
            b.until === 'permanent' || new Date(b.until) > now
        );
        cleaned += before - blocks[key].length;
    });

    if (cleaned > 0) {
        saveBlocks(blocks);
        console.log(`🧹 [Block] 만료 차단 ${cleaned}건 자동 해제`);
    }
    return cleaned;
}

module.exports = router;
module.exports.cleanupExpiredReports = cleanupExpiredReports;
module.exports.cleanupExpiredBlocks = cleanupExpiredBlocks;
