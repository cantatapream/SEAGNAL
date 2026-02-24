/**
 * ============================================================================
 * 파일명: routes/admin.js
 * 역할: 관리자 전용 API 라우트 (크롤링 제어, 통보문 수집, 수동 특보)
 * ============================================================================
 *
 * [설명]
 * 이 파일은 관리자(운영자)가 사용하는 특보 수집/관리 API를 모아놓은 라우터입니다.
 * - GET /api/admin/crawl-status → 크롤링 상태 조회
 * - POST /api/admin/crawl-toggle → 크롤링 정지/시작 토글
 * - POST /api/admin/alerts-reset → 특보 장부 초기화
 * - GET /api/admin/reports → 특정 날짜 통보문 목록 조회
 * - POST /api/admin/report-collect → 단일 통보문 AI 분석 + 장부 반영
 * - CRUD /api/admin/collect-failures → 수집 실패 정보 관리
 * - POST /api/admin/manual-alert → 수동 특보 등록 (zone tree 직접 주입)
 * - POST /api/admin/manual-alert-release → 수동 특보 해제
 * - POST /api/admin/reports-collect-all → 전체 통보문 일괄 수집
 *
 * [연계 파일]
 * - weather_alerts_crawler.js → 장부 구조 생성, 상태 전환, 변경 감지
 * - report_alert_processor.js → 통보문 가져오기, zone tree 업데이트
 * - ai_report_parser.js → 통보문 AI 분석
 * - push_sender.js → 변경 시 푸시 발송
 * - scheduler.js → 크롤링 정지/시작 제어
 *
 * [초보자를 위한 안내]
 * 이 앱은 기상청 통보문을 주기적으로 크롤링하여 특보 상태를 관리합니다.
 * 하지만 자동 수집이 실패하거나 AI 분석이 잘못될 수 있어서,
 * 관리자가 직접 통보문을 수집하거나 수동으로 특보를 등록/해제할 수 있습니다.
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const https = require('https');
const { DATA_DIR } = require('../config/server_config');

// 외부 모듈 (server.js와 동일 레벨)
const weatherAlertsCrawler = require('../weather_alerts_crawler');
const reportProcessor = require('../report_alert_processor');
const aiParser = require('../ai_report_parser');
const pushSender = require('../push_sender');
const scheduler = require('../scheduler');

const COLLECT_FAILURES_FILE = path.join(DATA_DIR, 'collect_failures.json');
const COLLECT_CACHE_DIR = path.join(DATA_DIR, 'collect_cache');

// ============================================================================
// 헬퍼 함수
// ============================================================================

/** reportId에서 발표시각 문자열 추출 (예: "2026년 02월 06일 12시 00분") */
function extractTmFcFromReportId(reportId) {
    const parts = reportId.split(':');
    if (parts.length >= 2) {
        const ts = parts[1];
        if (ts.length >= 12) {
            return `${ts.substring(0, 4)}년 ${ts.substring(4, 6)}월 ${ts.substring(6, 8)}일 ${ts.substring(8, 10)}시 ${ts.substring(10, 12)}분`;
        }
    }
    return '';
}

/** reportId에서 기준시각(ISO) 추출 (resolvePendingStatuses용) */
function extractRefTimeFromReportId(reportId) {
    const parts = (reportId || '').split(':');
    if (parts.length >= 2 && parts[1].length >= 12) {
        const ts = parts[1];
        return new Date(`${ts.substring(0,4)}-${ts.substring(4,6)}-${ts.substring(6,8)}T${ts.substring(8,10)}:${ts.substring(10,12)}:00+09:00`).toISOString();
    }
    return null;
}

// ============================================================================
// 크롤링 제어
// ============================================================================

// 크롤링 상태 조회
router.get('/api/admin/crawl-status', (req, res) => {
    res.json({ paused: scheduler.getCrawlPaused() });
});

// 크롤링 정지/시작 토글
router.post('/api/admin/crawl-toggle', (req, res) => {
    const current = scheduler.getCrawlPaused();
    scheduler.setCrawlPaused(!current);
    const newState = scheduler.getCrawlPaused();
    console.log(`[Admin] 크롤링 상태 변경: ${newState ? '정지' : '실행'}`);
    res.json({ paused: newState });
});

// ============================================================================
// 특보 장부 관리
// ============================================================================

// 특보 장부 초기화
router.post('/api/admin/alerts-reset', (req, res) => {
    try {
        const freshForm = weatherAlertsCrawler.createFullForm();
        freshForm.updatedAt = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        fs.writeFileSync(weatherAlertsCrawler.CONFIG.OUTPUT_FILE, JSON.stringify(freshForm, null, 2), 'utf8');
        console.log('[Admin] 특보 장부 초기화 완료');
        res.json({ success: true, message: '특보 장부가 초기화되었습니다.' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================================
// 통보문 수집 (날짜별 목록 조회 + 단일/일괄 수집)
// ============================================================================

// 특정 날짜 통보문 목록 조회 (제목에 [특보]/[예비] 포함 필터링)
router.get('/api/admin/reports', async (req, res) => {
    try {
        const date = req.query.date; // YYYY-MM-DD
        if (!date) return res.status(400).json({ error: 'date 파라미터가 필요합니다 (YYYY-MM-DD)' });

        const fetchPage = (pageIndex) => {
            return new Promise((resolve, reject) => {
                const url = `https://www.weather.go.kr/w/special-report/list.do?stn=108&date=${date}&pageIndex=${pageIndex}`;
                https.get(url, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                }, (resp) => {
                    const chunks = [];
                    resp.on('data', c => chunks.push(c));
                    resp.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
                }).on('error', reject);
            });
        };

        const allReports = [];
        const seenIds = new Set();
        for (let page = 1; page <= 3; page++) {
            const html = await fetchPage(page);
            const selectMatch = html.match(/<select id="select-list"[^>]*>([\s\S]*?)<\/select>/);
            if (!selectMatch) break;

            const pattern = /<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g;
            let match;
            while ((match = pattern.exec(selectMatch[1])) !== null) {
                const id = match[1];
                const title = match[2].trim();
                if (seenIds.has(id)) continue;
                if (id.includes(':') && (title.includes('[특보]') || title.includes('[예비]'))) {
                    const parts = id.split(':');
                    if (parts.length >= 2) {
                        const idDate = parts[1].substring(0, 8);
                        const reqDate = date.replace(/-/g, '');
                        if (idDate === reqDate) {
                            seenIds.add(id);
                            allReports.push({ id, title });
                        }
                    }
                }
            }
            if (allReports.length === 0 && page === 1) break;
        }

        res.json({ date, reports: allReports, count: allReports.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 단일 통보문 수집 (AI 분석 포함, 장부 반영)
router.post('/api/admin/report-collect', async (req, res) => {
    try {
        const { reportId, title, referenceTime, skipPush } = req.body;
        if (!reportId) return res.status(400).json({ error: 'reportId가 필요합니다' });

        // 1. 통보문 본문 가져오기
        const rawText = await reportProcessor.fetchReportDetail(reportId);
        if (!rawText) return res.json({ success: false, rawText: '', aiResult: [], message: '통보문 내용을 가져올 수 없습니다.' });

        // 2. 키워드 필터링
        const RELEVANT_KEYWORDS = ['풍랑', '태풍', '지진해일', '폭풍해일'];
        const foundKeywords = RELEVANT_KEYWORDS.filter(kw => rawText.includes(kw));

        if (foundKeywords.length === 0) {
            return res.json({
                success: true, reportId, title, rawText,
                aiResult: [], foundKeywords: [],
                message: '해상 특보 키워드(풍랑/태풍/지진해일/폭풍해일)가 포함되지 않은 통보문입니다.',
                applied: false
            });
        }

        // 3. AI 분석
        const baseDate = extractTmFcFromReportId(reportId);
        const aiParsed = await aiParser.parseNoticeWithAI(rawText, baseDate);
        const aiResult = aiParsed.data || [];
        const aiError = aiParsed.error || null;

        // 4. 장부에 반영
        let applied = false;
        let pushResult = null;
        try {
            const outputFile = weatherAlertsCrawler.CONFIG.OUTPUT_FILE;
            let fullForm;
            if (fs.existsSync(outputFile)) {
                const existing = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
                fullForm = {
                    updatedAt: null,
                    lastReportId: existing.lastReportId || null,
                    processedReportIds: existing.processedReportIds || [],
                    previous: JSON.parse(JSON.stringify(existing.current || {})),
                    current: existing.current || {}
                };
            } else {
                fullForm = weatherAlertsCrawler.createFullForm();
            }

            const refTime = referenceTime || null;

            // 이벤트 적용 전 상태 전환 (upcoming → current)
            weatherAlertsCrawler.resolvePendingStatuses(fullForm.current, null, refTime);

            for (const event of aiResult) {
                event.reportId = reportId;
                event.tmFc = extractTmFcFromReportId(reportId);
                event.title = title || '';
                event.zones.forEach(zoneName => {
                    if (reportProcessor.updateZoneStatus(fullForm.current, zoneName, event, refTime)) {
                        applied = true;
                    }
                });
            }

            // 이벤트 적용 후 재실행
            weatherAlertsCrawler.resolvePendingStatuses(fullForm.current, null, refTime);

            // 변경 감지 및 저장
            const changes = weatherAlertsCrawler.detectChanges(fullForm.previous, fullForm.current);
            if (changes.length > 0) {
                applied = true;
                if (skipPush) {
                    pushResult = { sent: false, skipped: true, changeCount: changes.length };
                    console.log(`[Admin] 테스트 수집 → 변경 ${changes.length}건 감지, 푸시 발송 생략 (토글 OFF)`);
                } else {
                    try {
                        await pushSender.processChanges(changes);
                        pushResult = { sent: true, changeCount: changes.length };
                        console.log(`[Admin] 테스트 수집 → 변경 ${changes.length}건 감지, 푸시 발송 완료`);
                    } catch (pushErr) {
                        pushResult = { sent: false, error: pushErr.message };
                        console.error(`[Admin] 푸시 발송 오류:`, pushErr.message);
                    }
                }
                fullForm.updatedAt = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
                if (reportId > (fullForm.lastReportId || '')) fullForm.lastReportId = reportId;
                // [Fix] 처리 완료 ID 추적 (동시 발표 통보문 재수집 방지)
                if (!fullForm.processedReportIds) fullForm.processedReportIds = [];
                if (!fullForm.processedReportIds.includes(reportId)) fullForm.processedReportIds.push(reportId);
                // processedReportIds 정리: 최신 타임스탬프 이상만 유지
                const adminLatestTs = (fullForm.lastReportId || '').split(':')[1]?.substring(0, 12) || '';
                if (adminLatestTs) {
                    fullForm.processedReportIds = fullForm.processedReportIds.filter(id => {
                        const ts = (id.split(':')[1] || '').substring(0, 12);
                        return ts >= adminLatestTs;
                    });
                }
                fs.writeFileSync(outputFile, JSON.stringify(fullForm, null, 2), 'utf8');
            }
        } catch (applyErr) {
            console.error('[Admin] 장부 반영 오류:', applyErr.message);
        }

        const responseData = { success: true, reportId, title, rawText, aiResult, foundKeywords, applied, aiError, pushResult };

        // 수집 결과를 캐시에 저장 (재조회 시 AI 토큰 소모 방지)
        try {
            if (!fs.existsSync(COLLECT_CACHE_DIR)) fs.mkdirSync(COLLECT_CACHE_DIR, { recursive: true });
            const cacheFileName = reportId.replace(/[/:]/g, '_') + '.json';
            fs.writeFileSync(path.join(COLLECT_CACHE_DIR, cacheFileName), JSON.stringify(responseData, null, 2), 'utf8');
        } catch (cacheErr) {
            console.error('[Admin] 수집 캐시 저장 오류:', cacheErr.message);
        }

        res.json(responseData);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================================
// 이미 수집된 통보문 조회 (AI 토큰 소모 방지)
// ============================================================================

/** 처리된 reportId 목록 반환 (zone tree history + 수집 캐시 통합) */
router.get('/api/admin/processed-reports', (req, res) => {
    try {
        const outputFile = weatherAlertsCrawler.CONFIG.OUTPUT_FILE;
        const processedIds = new Set();

        // 1) zone tree의 모든 history에서 reportId 수집
        if (fs.existsSync(outputFile)) {
            const data = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
            function traverse(obj) {
                if (!obj || typeof obj !== 'object') return;
                if (Array.isArray(obj)) return;
                if (obj.history && Array.isArray(obj.history)) {
                    obj.history.forEach(h => { if (h.reportId) processedIds.add(h.reportId); });
                }
                for (const val of Object.values(obj)) {
                    if (val && typeof val === 'object') traverse(val);
                }
            }
            traverse(data.current);
            traverse(data.previous);
        }

        // 2) 수집 캐시에서 reportId 보완 (해제로 history가 초기화되어도 캐시는 유지됨)
        if (fs.existsSync(COLLECT_CACHE_DIR)) {
            const cacheFiles = fs.readdirSync(COLLECT_CACHE_DIR).filter(f => f.endsWith('.json'));
            for (const file of cacheFiles) {
                try {
                    const cached = JSON.parse(fs.readFileSync(path.join(COLLECT_CACHE_DIR, file), 'utf8'));
                    if (cached.reportId) processedIds.add(cached.reportId);
                } catch (_) { /* 파손된 캐시 무시 */ }
            }
        }

        res.json({ processedIds: Array.from(processedIds) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/** 캐시된 수집 결과 반환 (AI 재분석 없이) */
router.get('/api/admin/report-cache/:reportId', (req, res) => {
    try {
        const reportId = req.params.reportId;
        if (!fs.existsSync(COLLECT_CACHE_DIR)) return res.json({ cached: false });

        const cacheFileName = reportId.replace(/[/:]/g, '_') + '.json';
        const cachePath = path.join(COLLECT_CACHE_DIR, cacheFileName);

        if (!fs.existsSync(cachePath)) return res.json({ cached: false });

        const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        res.json({ cached: true, data: cached });
    } catch (e) {
        res.json({ cached: false });
    }
});

// ============================================================================
// 수집 실패 정보 관리
// ============================================================================

router.get('/api/admin/collect-failures', (req, res) => {
    try {
        if (!fs.existsSync(COLLECT_FAILURES_FILE)) return res.json([]);
        const data = JSON.parse(fs.readFileSync(COLLECT_FAILURES_FILE, 'utf8'));
        res.json(data);
    } catch (e) { res.json([]); }
});

router.post('/api/admin/collect-failures', (req, res) => {
    try {
        const { reportId, title, error, retriesUsed } = req.body;
        let failures = [];
        if (fs.existsSync(COLLECT_FAILURES_FILE)) {
            try { failures = JSON.parse(fs.readFileSync(COLLECT_FAILURES_FILE, 'utf8')); } catch (e) { failures = []; }
        }
        if (!failures.some(f => f.reportId === reportId)) {
            failures.push({ reportId, title, error, retriesUsed, failedAt: new Date().toISOString() });
            fs.writeFileSync(COLLECT_FAILURES_FILE, JSON.stringify(failures, null, 2), 'utf8');
            console.log(`[Admin] 수집 실패 기록: ${reportId} (${retriesUsed}회 시도)`);
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/admin/collect-failures', (req, res) => {
    try {
        if (fs.existsSync(COLLECT_FAILURES_FILE)) fs.unlinkSync(COLLECT_FAILURES_FILE);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================================
// 수동 특보 등록/해제
// ============================================================================

// 수동 특보 등록 (zone tree 직접 주입)
router.post('/api/admin/manual-alert', (req, res) => {
    try {
        const { zoneName, warnType, level, command, tmFc, tmEf, tmCc, skipPush } = req.body;

        if (!zoneName || !warnType || !level || !command) {
            return res.status(400).json({ error: '필수 항목 누락: zoneName, warnType, level, command' });
        }

        // 1. weather_alerts.json 로드
        const outputFile = weatherAlertsCrawler.CONFIG.OUTPUT_FILE;
        let fullForm;
        if (fs.existsSync(outputFile)) {
            const existing = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
            fullForm = {
                updatedAt: null,
                lastReportId: existing.lastReportId || null,
                processedReportIds: existing.processedReportIds || [],
                previous: JSON.parse(JSON.stringify(existing.current || {})),
                current: existing.current || {}
            };
        } else {
            fullForm = weatherAlertsCrawler.createFullForm();
        }

        // 2. 이벤트 구성
        const isYebi = level === '예비';
        const typeStr = isYebi ? `${warnType}예비특보` : `${warnType}${level}`;
        const manualReportId = `manual:${Date.now()}`;

        // 범위형 tmEf에서 parseKmaTime 호환용 시작시각 추출
        let timeForParsing = tmEf || '';
        if (tmEf) {
            const rangeMatch = tmEf.match(/(\d{4})년\s*(\d{2})월\s*(\d{2})일\s*(?:새벽|오전|오후|밤)\((\d{2})시/);
            if (rangeMatch) {
                timeForParsing = `${rangeMatch[1]}년 ${rangeMatch[2]}월 ${rangeMatch[3]}일 ${rangeMatch[4]}시 00분`;
            }
        }

        const event = {
            type: typeStr,
            command: command,
            reportId: manualReportId,
            tmFc: tmFc || new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
            tmEf: tmEf || '',
            time: timeForParsing,
            tmCc: tmCc || '',
            zones: [zoneName]
        };

        // 3. 상태 전환 선행 실행 (upcoming → current)
        weatherAlertsCrawler.resolvePendingStatuses(fullForm.current);

        // 4. zone tree에 이벤트 적용
        let applied = false;
        if (reportProcessor.updateZoneStatus(fullForm.current, zoneName, event)) {
            applied = true;
        }

        // 5. 이벤트 적용 후 재실행
        weatherAlertsCrawler.resolvePendingStatuses(fullForm.current);

        // 6. 변경 감지 및 푸시
        let pushResult = null;
        const changes = weatherAlertsCrawler.detectChanges(fullForm.previous, fullForm.current);
        if (changes.length > 0) {
            applied = true;
            if (skipPush) {
                pushResult = { sent: false, skipped: true, changeCount: changes.length };
                console.log(`[Admin] 수동 특보 → 변경 ${changes.length}건 감지, 푸시 생략`);
            } else {
                try {
                    pushSender.processChanges(changes);
                    pushResult = { sent: true, changeCount: changes.length };
                    console.log(`[Admin] 수동 특보 → 변경 ${changes.length}건 감지, 푸시 발송`);
                } catch (pushErr) {
                    pushResult = { sent: false, error: pushErr.message };
                }
            }
        }

        // 7. 저장
        fullForm.updatedAt = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        fs.writeFileSync(outputFile, JSON.stringify(fullForm, null, 2), 'utf8');
        console.log(`[Admin] 수동 특보 저장: ${zoneName} ${typeStr} ${command}`);

        res.json({ success: true, applied, zoneName, type: typeStr, command, pushResult, reportId: manualReportId });
    } catch (e) {
        console.error('[Admin] 수동 특보 등록 오류:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// 수동 특보 해제
router.post('/api/admin/manual-alert-release', (req, res) => {
    try {
        const { zoneName, skipPush } = req.body;
        if (!zoneName) return res.status(400).json({ error: 'zoneName 필수' });

        const outputFile = weatherAlertsCrawler.CONFIG.OUTPUT_FILE;
        if (!fs.existsSync(outputFile)) return res.status(404).json({ error: '장부 파일 없음' });

        const existing = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
        const fullForm = {
            updatedAt: null,
            lastReportId: existing.lastReportId || null,
            processedReportIds: existing.processedReportIds || [],
            previous: JSON.parse(JSON.stringify(existing.current || {})),
            current: existing.current || {}
        };

        // zone tree에서 해당 해역 찾아서 직접 해제
        function findAndRelease(obj, target) {
            if (!obj || typeof obj !== 'object') return false;
            for (const [key, value] of Object.entries(obj)) {
                if (key === target && value && 'current' in value) {
                    value.current = null;
                    value.upcoming = null;
                    value.history = [];
                    return true;
                }
                if (key === 'children' || key === 'history' || key === 'missingCount') continue;
                if (findAndRelease(value, target)) return true;
            }
            return false;
        }

        const released = findAndRelease(fullForm.current, zoneName);

        if (released) {
            const changes = weatherAlertsCrawler.detectChanges(fullForm.previous, fullForm.current);
            if (changes.length > 0 && !skipPush) {
                pushSender.processChanges(changes).catch(err => console.error(`[Push] 오류: ${err.message}`));
            }
            fullForm.updatedAt = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
            fs.writeFileSync(outputFile, JSON.stringify(fullForm, null, 2), 'utf8');
            console.log(`[Admin] 수동 해제: ${zoneName}`);
        }

        res.json({ success: true, released, zoneName });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================================================
// 전체 통보문 일괄 수집
// ============================================================================
router.post('/api/admin/reports-collect-all', async (req, res) => {
    try {
        const { reports, referenceTimeMode } = req.body;
        if (!reports || !Array.isArray(reports)) return res.status(400).json({ error: 'reports 배열이 필요합니다' });

        const results = [];
        for (const report of reports) {
            try {
                const rawText = await reportProcessor.fetchReportDetail(report.id);
                const RELEVANT_KEYWORDS = ['풍랑', '태풍', '지진해일', '폭풍해일'];
                const foundKeywords = RELEVANT_KEYWORDS.filter(kw => rawText.includes(kw));

                if (foundKeywords.length === 0) {
                    results.push({ reportId: report.id, title: report.title, aiResult: [], foundKeywords: [], applied: false, message: '키워드 미포함' });
                    continue;
                }

                const baseDate = extractTmFcFromReportId(report.id);
                const aiParsed = await aiParser.parseNoticeWithAI(rawText, baseDate);
                const aiResult = aiParsed.data || [];
                const aiError = aiParsed.error || null;

                // 장부 반영
                let applied = false;
                const outputFile = weatherAlertsCrawler.CONFIG.OUTPUT_FILE;
                let fullForm;
                if (fs.existsSync(outputFile)) {
                    const existing = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
                    fullForm = {
                        updatedAt: null,
                        lastReportId: existing.lastReportId || null,
                        processedReportIds: existing.processedReportIds || [],
                        previous: JSON.parse(JSON.stringify(existing.current || {})),
                        current: existing.current || {}
                    };
                } else {
                    fullForm = weatherAlertsCrawler.createFullForm();
                }

                const refTime = (referenceTimeMode === 'auto') ? extractRefTimeFromReportId(report.id) : null;

                weatherAlertsCrawler.resolvePendingStatuses(fullForm.current, null, refTime);

                for (const event of aiResult) {
                    event.reportId = report.id;
                    event.tmFc = extractTmFcFromReportId(report.id);
                    event.title = report.title || '';
                    event.zones.forEach(zoneName => {
                        if (reportProcessor.updateZoneStatus(fullForm.current, zoneName, event, refTime)) {
                            applied = true;
                        }
                    });
                }

                weatherAlertsCrawler.resolvePendingStatuses(fullForm.current, null, refTime);

                const changes = weatherAlertsCrawler.detectChanges(fullForm.previous, fullForm.current);
                if (changes.length > 0 || applied) {
                    fullForm.updatedAt = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
                    if (report.id > (fullForm.lastReportId || '')) fullForm.lastReportId = report.id;
                    // [Fix] 처리 완료 ID 추적
                    if (!fullForm.processedReportIds) fullForm.processedReportIds = [];
                    if (!fullForm.processedReportIds.includes(report.id)) fullForm.processedReportIds.push(report.id);
                    const batchLatestTs = (fullForm.lastReportId || '').split(':')[1]?.substring(0, 12) || '';
                    if (batchLatestTs) {
                        fullForm.processedReportIds = fullForm.processedReportIds.filter(id => {
                            const ts = (id.split(':')[1] || '').substring(0, 12);
                            return ts >= batchLatestTs;
                        });
                    }
                    fs.writeFileSync(outputFile, JSON.stringify(fullForm, null, 2), 'utf8');
                }

                results.push({ reportId: report.id, title: report.title, rawText, aiResult, foundKeywords, applied, aiError });
            } catch (itemErr) {
                results.push({ reportId: report.id, title: report.title, error: itemErr.message, applied: false });
            }
        }

        res.json({ success: true, totalCount: reports.length, results });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
