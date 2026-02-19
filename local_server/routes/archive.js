/**
 * ============================================================================
 * 파일명: routes/archive.js
 * 역할: 아카이브 데이터 조회 및 다운로드 API 라우트
 * ============================================================================
 *
 * [설명]
 * 이 파일은 과거 특보/기상 데이터의 아카이브(보관 파일)를 조회하고
 * 다운로드할 수 있는 API를 제공합니다.
 * - GET /api/archive/list → 아카이브 파일 목록 조회
 * - GET /api/archive/download/:filename → 특정 파일 다운로드
 *
 * [연계 파일]
 * - config/server_config.js → DATA_DIR 경로 사용
 * - server.js → app.use()로 이 라우터 등록
 *
 * [초보자를 위한 안내]
 * 아카이브는 과거에 수집된 기상 데이터를 JSON 파일로 보관한 것입니다.
 * data/archive/ 폴더에 해역별로 저장되며, 추후 분석에 활용됩니다.
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/server_config');

// 아카이브 목록 조회
router.get('/api/archive/list', (req, res) => {
    try {
        const ARCHIVE_DIR = path.join(DATA_DIR, 'archive');
        if (!fs.existsSync(ARCHIVE_DIR)) {
            return res.json([]);
        }
        const files = fs.readdirSync(ARCHIVE_DIR)
            .filter(f => f.endsWith('.json'))
            .map(f => {
                const stats = fs.statSync(path.join(ARCHIVE_DIR, f));
                return {
                    name: f.replace('.json', ''),
                    filename: f,
                    size: stats.size,
                    updatedAt: stats.mtime
                };
            });
        res.json(files);
    } catch (e) {
        res.status(500).json({ error: '아카이브 목록 조회 실패: ' + e.message });
    }
});

// 아카이브 파일 다운로드
router.get('/api/archive/download/:filename', (req, res) => {
    try {
        let filename = req.params.filename;
        // 보안 필터링 (디렉토리 탐색 방지)
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return res.status(400).send('Invalid filename');
        }

        if (!filename.endsWith('.json')) filename += '.json';
        const filePath = path.join(DATA_DIR, 'archive', filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).send('해당 아카이브 파일을 찾을 수 없습니다.');
        }

        res.download(filePath, filename);
    } catch (e) {
        res.status(500).send('다운로드 중 오류 발생: ' + e.message);
    }
});

module.exports = router;
