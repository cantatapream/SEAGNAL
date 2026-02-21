/**
 * ============================================================================
 * 파일명: routes/survey.js
 * 역할: 설문조사 CRUD, 응답 수집, CSV 다운로드 API
 * ============================================================================
 *
 * [설명]
 * - GET    /api/surveys              → 설문 목록 조회 (관리자: 전체, 사용자: active만)
 * - POST   /api/surveys              → 설문 생성
 * - PUT    /api/surveys/:id          → 설문 수정
 * - DELETE /api/surveys/:id          → 설문 삭제
 * - POST   /api/surveys/:id/close    → 설문 조기 마감
 * - POST   /api/surveys/:id/duplicate→ 설문 복제
 * - GET    /api/surveys/:id/responses→ 응답 데이터 조회
 * - POST   /api/surveys/:id/respond  → 설문 응답 제출
 * - GET    /api/surveys/:id/csv      → CSV 다운로드
 * - GET    /api/surveys/active       → 현재 진행 중인 설문 (사용자용)
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

function writeSurveys(surveys) {
    fs.writeFileSync(SURVEYS_FILE, JSON.stringify(surveys, null, 2), 'utf8');
}

function getResponsesFile(surveyId) {
    return path.join(DATA_DIR, `survey_responses_${surveyId}.json`);
}

function readResponses(surveyId) {
    const file = getResponsesFile(surveyId);
    if (!fs.existsSync(file)) return [];
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return [];
    }
}

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
router.get('/api/surveys', (req, res) => {
    try {
        let surveys = readSurveys();
        surveys = surveys.map(s => {
            s = autoUpdateStatus(s);
            s.responseCount = readResponses(s.id).length;
            return s;
        });
        // 기한 만료로 상태 변경된 것 저장
        writeSurveys(surveys);
        res.json(surveys);
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
router.get('/api/surveys/:id/responses', (req, res) => {
    try {
        const id = Number(req.params.id);
        const responses = readResponses(id);
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
