/**
 * ============================================================================
 * 파일명: routes/survey.js
 * 역할: 설문조사 CRUD, 응답 수집, CSV 다운로드 백엔드 API
 * ============================================================================
 *
 * [개요 - 초보자 안내]
 * 이 파일은 SEAGNAL(바다날씨) 앱의 "설문조사" 기능을 위한 백엔드(서버) API입니다.
 * 관리자가 설문을 만들고, 사용자가 응답하고, 결과를 분석하는 모든 서버 로직이 여기에 있습니다.
 *
 * 설문 데이터는 data/surveys.json 파일에 저장되고,
 * 각 설문의 응답은 data/survey_responses_{설문ID}.json 파일에 별도 저장됩니다.
 *
 * [전체 시스템 흐름]
 * 1. 관리자 → admin_survey.js(프론트)에서 설문 생성/수정/마감
 *    → 이 파일의 POST/PUT/DELETE /api/surveys API 호출
 * 2. 사용자 → survey_user.js(프론트)가 앱 접속 시 GET /api/surveys/active 호출
 *    → 미완료 설문이 있으면 팝업 표시
 *    → 응답 제출 시 POST /api/surveys/:id/respond 호출
 * 3. 관리자 → 결과 확인 시 GET /api/surveys/:id/responses 호출
 *    → CSV 다운로드 시 GET /api/surveys/:id/csv 호출
 *
 * [API 엔드포인트 목록]
 * - GET    /api/surveys              → 설문 목록 조회 (관리자용, 전체)
 * - GET    /api/surveys/active       → 현재 진행 중인 설문 (사용자용)
 * - POST   /api/surveys              → 설문 생성 (관리자)
 * - PUT    /api/surveys/:id          → 설문 수정 (관리자)
 * - DELETE /api/surveys/:id          → 설문 삭제 (관리자)
 * - POST   /api/surveys/:id/close    → 설문 조기 마감 (관리자)
 * - POST   /api/surveys/:id/duplicate→ 설문 복제 (관리자)
 * - GET    /api/surveys/:id/responses→ 응답 데이터 조회 (관리자)
 * - POST   /api/surveys/:id/respond  → 설문 응답 제출 (사용자)
 * - GET    /api/surveys/:id/csv      → CSV 다운로드 (관리자)
 *
 * [연계 파일]
 * - config/server_config.js  → DATA_DIR 경로 설정 (surveys.json 저장 위치)
 * - server.js                → app.use()로 이 라우터를 Express 앱에 등록
 * - js/admin_survey.js       → 관리자 화면에서 이 API를 호출하는 프론트엔드
 * - js/survey_user.js        → 사용자 팝업에서 이 API를 호출하는 프론트엔드
 * - data/surveys.json        → 설문 메타데이터 저장소
 * - data/survey_responses_*.json → 각 설문별 응답 저장소
 *
 * [로딩 순서]
 * server.js 시작 → require('./routes/survey') → Express 라우터 등록
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/server_config');

const SURVEYS_FILE = path.join(DATA_DIR, 'surveys.json');

// ============================================================================
// 헬퍼 함수
// ============================================================================

function readSurveys() {
    if (!fs.existsSync(SURVEYS_FILE)) return [];
    try {
        return JSON.parse(fs.readFileSync(SURVEYS_FILE, 'utf8'));
    } catch (e) {
        return [];
    }
}

/** 설문 마스터 목록(전체 설문 메타) 을 SURVEYS_FILE 에 동기 저장. */
function writeSurveys(surveys) {
    fs.writeFileSync(SURVEYS_FILE, JSON.stringify(surveys, null, 2), 'utf8');
}

/**
 * 특정 설문(surveyId) 의 응답 모음 파일 경로 반환.
 * 파일명 규칙: survey_responses_<surveyId>.json (DATA_DIR 안).
 * 응답을 설문별 분리 저장하여 큰 응답 데이터셋을 효율적으로 관리.
 */
function getResponsesFile(surveyId) {
    return path.join(DATA_DIR, `survey_responses_${surveyId}.json`);
}

/**
 * 특정 설문의 응답 배열을 동기 읽기. 파일 없거나 JSON 파싱 실패 시 빈 배열.
 * 응답 등록/조회 핸들러가 모두 이 헬퍼를 통해 접근.
 */
function readResponses(surveyId) {
    const file = getResponsesFile(surveyId);
    if (!fs.existsSync(file)) return [];
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return [];
    }
}

/** 특정 설문의 응답 배열을 indent 2 로 동기 저장. */
function writeResponses(surveyId, responses) {
    fs.writeFileSync(getResponsesFile(surveyId), JSON.stringify(responses, null, 2), 'utf8');
}

// KST 현재 시각 ISO 문자열
function kstNow() {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().replace('Z', '+09:00');
}

// 설문 상태 자동 업데이트 (기한 만료 체크)
function autoUpdateStatus(survey) {
    if (survey.status === 'active' && survey.endDate) {
        const now = new Date();
        const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
        const end = new Date(survey.endDate + 'T23:59:59');
        if (kstNow > end) {
            survey.status = 'closed';
        }
    }
    return survey;
}

// ============================================================================
// API 엔드포인트
// ============================================================================

// 설문 목록 조회 (전체)
// - 기본(쿼리 없음): 기존 raw 배열 반환 — 하위호환 (관리자 결과탭/이력탭/사용자측 등 기존 호출자)
// - ?page= 동반 시: { data, pagination } 새 포맷. 현재 페이지(slice 결과) 에 대해서만
//   readResponses() 로 응답 카운트를 산출하여 디스크 IO 절감.
router.get('/api/surveys', (req, res) => {
    try {
        let surveys = readSurveys();
        // 1차: 상태 자동 갱신만 (응답 카운트는 페이지별로 별도 계산)
        surveys = surveys.map(s => autoUpdateStatus(s));
        writeSurveys(surveys);

        // 최신 먼저 (id 역순 — Date.now() 기반이므로 생성순서와 일치)
        surveys.sort((a, b) => (b.id || 0) - (a.id || 0));

        if (req.query.page != null) {
            const page = Math.max(1, parseInt(req.query.page, 10) || 1);
            const rawLimit = parseInt(req.query.limit, 10) || 25;
            const limit = Math.min(200, Math.max(1, rawLimit));
            const total = surveys.length;
            const totalPages = Math.max(1, Math.ceil(total / limit));
            const offset = (page - 1) * limit;
            // 현재 페이지에 해당하는 설문만 응답 카운트 산출 → 전체 N개 → limit 개로 IO 절감
            const pageData = surveys.slice(offset, offset + limit)
                .map(s => ({ ...s, responseCount: readResponses(s.id).length }));
            return res.json({
                data: pageData,
                pagination: { page, limit, total, totalPages }
            });
        }

        // 하위호환: 기존 raw array — 전체 responseCount 포함
        const withCounts = surveys.map(s => ({ ...s, responseCount: readResponses(s.id).length }));
        res.json(withCounts);
    } catch (e) {
        console.error('설문 목록 조회 실패:', e);
        res.status(500).json({ error: '조회 실패' });
    }
});

// 현재 활성 설문 조회 (사용자용)
router.get('/api/surveys/active', (req, res) => {
    try {
        let surveys = readSurveys();
        surveys = surveys.map(autoUpdateStatus);
        writeSurveys(surveys);
        const active = surveys.filter(s => s.status === 'active');
        res.json(active);
    } catch (e) {
        res.status(500).json({ error: '조회 실패' });
    }
});

// 설문 생성
router.post('/api/surveys', (req, res) => {
    try {
        const surveys = readSurveys();
        const data = req.body;

        const newSurvey = {
            id: Date.now(),
            title: data.title || '새 설문조사',
            description: data.description || '',
            status: data.status || 'draft',
            createdAt: kstNow(),
            startDate: data.startDate || '',
            endDate: data.endDate || '',
            allowAnonymous: data.allowAnonymous !== false,
            allowMultipleSubmit: data.allowMultipleSubmit || false,
            questions: data.questions || [],
            responseCount: 0
        };

        surveys.unshift(newSurvey);
        writeSurveys(surveys);

        res.json({ success: true, survey: newSurvey });
    } catch (e) {
        console.error('설문 생성 실패:', e);
        res.status(500).json({ error: '생성 실패' });
    }
});

// 설문 수정
router.put('/api/surveys/:id', (req, res) => {
    try {
        const surveys = readSurveys();
        const id = Number(req.params.id);
        const idx = surveys.findIndex(s => s.id === id);

        if (idx === -1) return res.status(404).json({ error: '설문을 찾을 수 없습니다.' });

        const data = req.body;
        surveys[idx] = {
            ...surveys[idx],
            title: data.title !== undefined ? data.title : surveys[idx].title,
            description: data.description !== undefined ? data.description : surveys[idx].description,
            status: data.status !== undefined ? data.status : surveys[idx].status,
            startDate: data.startDate !== undefined ? data.startDate : surveys[idx].startDate,
            endDate: data.endDate !== undefined ? data.endDate : surveys[idx].endDate,
            allowAnonymous: data.allowAnonymous !== undefined ? data.allowAnonymous : surveys[idx].allowAnonymous,
            allowMultipleSubmit: data.allowMultipleSubmit !== undefined ? data.allowMultipleSubmit : surveys[idx].allowMultipleSubmit,
            questions: data.questions !== undefined ? data.questions : surveys[idx].questions,
            updatedAt: kstNow()
        };

        writeSurveys(surveys);
        res.json({ success: true, survey: surveys[idx] });
    } catch (e) {
        console.error('설문 수정 실패:', e);
        res.status(500).json({ error: '수정 실패' });
    }
});

// 설문 삭제
router.delete('/api/surveys/:id', (req, res) => {
    try {
        let surveys = readSurveys();
        const id = Number(req.params.id);
        const idx = surveys.findIndex(s => s.id === id);

        if (idx === -1) return res.status(404).json({ error: '설문을 찾을 수 없습니다.' });

        surveys.splice(idx, 1);
        writeSurveys(surveys);

        // 응답 파일도 삭제
        const respFile = getResponsesFile(id);
        if (fs.existsSync(respFile)) fs.unlinkSync(respFile);

        res.json({ success: true });
    } catch (e) {
        console.error('설문 삭제 실패:', e);
        res.status(500).json({ error: '삭제 실패' });
    }
});

// 설문 조기 마감
router.post('/api/surveys/:id/close', (req, res) => {
    try {
        const surveys = readSurveys();
        const id = Number(req.params.id);
        const idx = surveys.findIndex(s => s.id === id);

        if (idx === -1) return res.status(404).json({ error: '설문을 찾을 수 없습니다.' });

        surveys[idx].status = 'closed';
        surveys[idx].closedAt = kstNow();
        writeSurveys(surveys);

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: '마감 실패' });
    }
});

// 설문 복제
router.post('/api/surveys/:id/duplicate', (req, res) => {
    try {
        const surveys = readSurveys();
        const id = Number(req.params.id);
        const original = surveys.find(s => s.id === id);

        if (!original) return res.status(404).json({ error: '설문을 찾을 수 없습니다.' });

        const duplicate = {
            ...original,
            id: Date.now(),
            title: original.title + ' (복사본)',
            status: 'draft',
            createdAt: kstNow(),
            startDate: '',
            endDate: '',
            responseCount: 0
        };

        surveys.unshift(duplicate);
        writeSurveys(surveys);

        res.json({ success: true, survey: duplicate });
    } catch (e) {
        res.status(500).json({ error: '복제 실패' });
    }
});

// 응답 조회 (관리자용)
// - 기본(쿼리 없음): 기존 raw 배열 반환 — 하위호환 (결과/분석 탭의 차트 집계 등)
// - ?page= 동반 시: { data, pagination } 새 포맷. responseId 역순(최신 먼저).
router.get('/api/surveys/:id/responses', (req, res) => {
    try {
        const id = Number(req.params.id);
        const responses = readResponses(id);
        // 최신 먼저
        responses.sort((a, b) => (b.responseId || 0) - (a.responseId || 0));

        if (req.query.page != null) {
            const page = Math.max(1, parseInt(req.query.page, 10) || 1);
            const rawLimit = parseInt(req.query.limit, 10) || 50;
            const limit = Math.min(500, Math.max(1, rawLimit));
            const total = responses.length;
            const totalPages = Math.max(1, Math.ceil(total / limit));
            const offset = (page - 1) * limit;
            return res.json({
                data: responses.slice(offset, offset + limit),
                pagination: { page, limit, total, totalPages }
            });
        }

        res.json(responses);
    } catch (e) {
        res.status(500).json({ error: '응답 조회 실패' });
    }
});

// 설문 응답 제출 (사용자용)
router.post('/api/surveys/:id/respond', (req, res) => {
    try {
        const id = Number(req.params.id);
        const surveys = readSurveys();
        const survey = surveys.find(s => s.id === id);

        if (!survey) return res.status(404).json({ error: '설문을 찾을 수 없습니다.' });
        if (survey.status !== 'active') return res.status(400).json({ error: '현재 응답을 받지 않는 설문입니다.' });

        const responses = readResponses(id);
        const data = req.body;

        // 중복 응답 체크
        if (!survey.allowMultipleSubmit && data.deviceId) {
            const existing = responses.find(r => r.deviceId === data.deviceId);
            if (existing) return res.status(400).json({ error: '이미 응답한 설문입니다.' });
        }

        const newResponse = {
            responseId: Date.now(),
            surveyId: id,
            submittedAt: kstNow(),
            deviceId: data.deviceId || 'anonymous',
            answers: data.answers || {}
        };

        responses.push(newResponse);
        writeResponses(id, responses);

        // 응답 수 업데이트
        const idx = surveys.findIndex(s => s.id === id);
        if (idx !== -1) {
            surveys[idx].responseCount = responses.length;
            writeSurveys(surveys);
        }

        res.json({ success: true, responseId: newResponse.responseId });
    } catch (e) {
        console.error('응답 제출 실패:', e);
        res.status(500).json({ error: '응답 제출 실패' });
    }
});

// ============================================================================
// 백업 복구 API (관리자용)
// ============================================================================

// 복구 가능한 백업 날짜 목록 조회
router.get('/api/surveys/backup/dates', async (req, res) => {
    try {
        const restore = require('../cloud_restore');
        const dates = await restore.listBackupDates();
        res.json({ success: true, dates });
    } catch (e) {
        console.error('백업 목록 조회 실패:', e);
        res.status(500).json({ error: '백업 목록 조회 실패: ' + e.message });
    }
});

// 특정 날짜 백업의 설문 파일 미리보기
router.get('/api/surveys/backup/preview/:date', async (req, res) => {
    try {
        const restore = require('../cloud_restore');
        const dateFolder = `backup_${req.params.date}`;
        const result = await restore.restoreSurveyData(dateFolder, true);
        res.json(result);
    } catch (e) {
        console.error('백업 미리보기 실패:', e);
        res.status(500).json({ error: '미리보기 실패: ' + e.message });
    }
});

// 설문 데이터가 있는 최신 백업 자동 탐색
router.get('/api/surveys/backup/latest', async (req, res) => {
    try {
        const restore = require('../cloud_restore');
        const latest = await restore.findLatestSurveyBackup();
        if (!latest) {
            return res.json({ success: false, message: '설문 데이터가 있는 백업을 찾을 수 없습니다.' });
        }
        res.json({ success: true, ...latest });
    } catch (e) {
        console.error('최신 백업 탐색 실패:', e);
        res.status(500).json({ error: '탐색 실패: ' + e.message });
    }
});

// 백업에서 설문 데이터 복구 실행
router.post('/api/surveys/backup/restore/:date', async (req, res) => {
    try {
        const restore = require('../cloud_restore');
        const dateFolder = `backup_${req.params.date}`;
        console.log(`🔄 [Restore] ${dateFolder}에서 설문 데이터 복구 시작...`);
        const result = await restore.restoreSurveyData(dateFolder, false);
        console.log(`✅ [Restore] 복구 완료: ${result.message}`);
        res.json(result);
    } catch (e) {
        console.error('복구 실행 실패:', e);
        res.status(500).json({ error: '복구 실패: ' + e.message });
    }
});

// CSV 다운로드
router.get('/api/surveys/:id/csv', (req, res) => {
    try {
        const id = Number(req.params.id);
        const surveys = readSurveys();
        const survey = surveys.find(s => s.id === id);

        if (!survey) return res.status(404).json({ error: '설문을 찾을 수 없습니다.' });

        const responses = readResponses(id);
        const questions = survey.questions || [];

        // BOM for Excel Korean support
        let csv = '\uFEFF';

        // 헤더 행
        const headers = ['응답번호', '제출일시'];
        questions.forEach(q => {
            headers.push(q.title || `Q${q.qId}`);
        });
        csv += headers.map(h => `"${h.replace(/"/g, '""')}"`).join(',') + '\n';

        // 데이터 행
        responses.forEach((r, idx) => {
            const row = [
                idx + 1,
                r.submittedAt ? r.submittedAt.replace('T', ' ').substring(0, 19) : ''
            ];
            questions.forEach(q => {
                const answer = r.answers[q.qId];
                if (Array.isArray(answer)) {
                    row.push(answer.join('; '));
                } else if (answer !== undefined && answer !== null) {
                    row.push(String(answer));
                } else {
                    row.push('');
                }
            });
            csv += row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',') + '\n';
        });

        const filename = encodeURIComponent(survey.title || 'survey') + '_' + new Date().toISOString().slice(0, 10) + '.csv';
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    } catch (e) {
        console.error('CSV 다운로드 실패:', e);
        res.status(500).json({ error: 'CSV 생성 실패' });
    }
});

module.exports = router;
