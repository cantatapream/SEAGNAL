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
// [관리자 푸시] 독립 서비스 모듈 (순환 참조 방지)
const { sendAdminPush } = require('../services/admin_push');

const COLLECT_FAILURES_FILE = path.join(DATA_DIR, 'collect_failures.json');
const COLLECT_CACHE_DIR = path.join(DATA_DIR, 'collect_cache');
const MAINTENANCE_FILE = path.join(DATA_DIR, 'maintenance_config.json');
const WORK_MODE_FILE = path.join(DATA_DIR, 'work_mode_config.json');
const TEST_ALERTS_FILE = path.join(DATA_DIR, 'weather_alerts_test.json');
// [관리자 기기 등록] 관리자 푸시 알림을 받을 기기 목록 (subscriptions.json과 완전 별도)
const ADMIN_DEVICES_FILE = path.join(DATA_DIR, 'admin_devices.json');
// [검토 필요 통보문] "내용 없음" 통보문 등 자동 처리 불가 통보문 저장
const REVIEW_NEEDED_FILE = path.join(DATA_DIR, 'review_needed.json');

/** 관리자 테스트 모드 시 사용할 장부 파일 경로 반환 */
function getOutputFile(testMode) {
    return testMode ? TEST_ALERTS_FILE : weatherAlertsCrawler.CONFIG.OUTPUT_FILE;
}

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
        const { testMode } = req.body || {};
        const outputFile = getOutputFile(testMode);
        const freshForm = weatherAlertsCrawler.createFullForm();
        freshForm.updatedAt = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        fs.writeFileSync(outputFile, JSON.stringify(freshForm, null, 2), 'utf8');
        console.log(`[Admin] 특보 장부 초기화 완료${testMode ? ' (테스트 모드)' : ''}`);
        res.json({ success: true, message: testMode ? '테스트 장부가 초기화되었습니다.' : '특보 장부가 초기화되었습니다.', testMode: !!testMode });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================================
// 통보문 수집 (날짜별 목록 조회 + 단일/일괄 수집)
// ============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// 특정 날짜 통보문 목록 조회 (제목에 [특보]/[예비]/[해설] 포함 필터링)
//
// [9 광역 수집 정책 — 정책 01_COLLECTION_SCOPE.md]
//   기존 stn=108 (전국) 1회 호출 → 9 광역 병렬 호출로 변경.
//   stn 파라미터 옵션:
//     - 미지정 또는 stn=all → 9 광역 모두 합산 (dedup)
//     - stn={광역코드}      → 해당 광역만 조회
//   응답에 r.stn (어느 광역에서 발견되었는지) 정보 포함.
// ─────────────────────────────────────────────────────────────────────────────
const STN_CODES_FULL = [105, 109, 133, 143, 146, 156, 159, 184];

router.get('/api/admin/reports', async (req, res) => {
    try {
        const date = req.query.date; // YYYY-MM-DD
        if (!date) return res.status(400).json({ error: 'date 파라미터가 필요합니다 (YYYY-MM-DD)' });

        // stn 파라미터: 'all' / 미지정 / 특정 광역 코드
        let targetStns = STN_CODES_FULL.slice();
        if (req.query.stn && req.query.stn !== 'all') {
            const s = parseInt(req.query.stn, 10);
            if (!isNaN(s)) targetStns = [s];
        }

        const fetchPage = (stn, pageIndex) => {
            return new Promise((resolve, reject) => {
                const url = `https://www.weather.go.kr/w/special-report/list.do?stn=${stn}&date=${date}&pageIndex=${pageIndex}`;
                https.get(url, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                }, (resp) => {
                    const chunks = [];
                    resp.on('data', c => chunks.push(c));
                    resp.on('end', () => resolve({ stn, html: Buffer.concat(chunks).toString('utf8') }));
                }).on('error', reject);
            });
        };

        // 각 (광역, 페이지) 조합을 병렬로 호출
        const stnPagePairs = [];
        for (const stn of targetStns) {
            for (let page = 1; page <= 3; page++) {
                stnPagePairs.push({ stn, page });
            }
        }
        const settled = await Promise.allSettled(
            stnPagePairs.map(({ stn, page }) => fetchPage(stn, page))
        );

        const allReports = [];
        const seenIds = new Set();
        const stnCounts = {};  // 광역별 카운트

        for (let i = 0; i < settled.length; i++) {
            const { stn, page } = stnPagePairs[i];
            if (settled[i].status === 'rejected') continue;
            const html = settled[i].value.html;
            const selectMatch = html.match(/<select id="select-list"[^>]*>([\s\S]*?)<\/select>/);
            if (!selectMatch) continue;

            const pattern = /<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g;
            let match;
            while ((match = pattern.exec(selectMatch[1])) !== null) {
                const id = match[1];
                const title = match[2].trim();
                if (seenIds.has(id)) continue;
                if (id.includes(':') && (title.includes('[특보]') || title.includes('[예비]') || title.includes('[해설]'))) {
                    const parts = id.split(':');
                    if (parts.length >= 2) {
                        const idDate = parts[1].substring(0, 8);
                        const reqDate = date.replace(/-/g, '');
                        if (idDate === reqDate) {
                            seenIds.add(id);
                            allReports.push({ id, title, stn });
                            stnCounts[stn] = (stnCounts[stn] || 0) + 1;
                        }
                    }
                }
            }
        }

        res.json({ date, reports: allReports, count: allReports.length, stnCounts });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// 광역별 통보문 통계 (수집/실패/대기 카운트 — 사이드바용)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/api/admin/reports-stats', async (req, res) => {
    try {
        const date = req.query.date;
        if (!date) return res.status(400).json({ error: 'date 파라미터가 필요합니다 (YYYY-MM-DD)' });

        const STN_NAMES = {
            105: '강원특별자치도',
            109: '서울·인천·경기도',
            133: '대전·세종·충청남도',
            143: '대구·경상북도',
            146: '전북특별자치도',
            156: '광주·전라남도',
            159: '부산·울산·경상남도',
            184: '제주특별자치도'
        };
        const STN_ABBR = {
            105: '강원', 109: '서울인천경기', 133: '대전세종충남',
            143: '대구경북', 146: '전북', 156: '광주전남',
            159: '부산울산경남', 184: '제주'
        };

        // 자기 자신의 reports 엔드포인트를 재사용 — 내부 호출하지 않고 동일 로직
        const fetchPage = (stn, pageIndex) => {
            return new Promise((resolve) => {
                const url = `https://www.weather.go.kr/w/special-report/list.do?stn=${stn}&date=${date}&pageIndex=${pageIndex}`;
                https.get(url, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                }, (resp) => {
                    const chunks = [];
                    resp.on('data', c => chunks.push(c));
                    resp.on('end', () => resolve({ stn, html: Buffer.concat(chunks).toString('utf8') }));
                }).on('error', () => resolve({ stn, html: '' }));
            });
        };

        // 광역별 통보문 ID 추출 (간단 카운트)
        const stnPageResults = await Promise.all(
            STN_CODES_FULL.flatMap(stn => [1, 2, 3].map(p => fetchPage(stn, p)))
        );

        const stns = {};
        const reqDateCompact = date.replace(/-/g, '');
        const allSeen = new Set();
        for (const { stn, html } of stnPageResults) {
            const selectMatch = html.match(/<select id="select-list"[^>]*>([\s\S]*?)<\/select>/);
            if (!selectMatch) continue;

            const pattern = /<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g;
            let match;
            while ((match = pattern.exec(selectMatch[1])) !== null) {
                const id = match[1];
                const title = match[2].trim();
                if (allSeen.has(`${stn}:${id}`)) continue;
                allSeen.add(`${stn}:${id}`);
                if (id.includes(':') && (title.includes('[특보]') || title.includes('[예비]') || title.includes('[해설]'))) {
                    const parts = id.split(':');
                    if (parts.length >= 2 && parts[1].substring(0, 8) === reqDateCompact) {
                        if (!stns[stn]) {
                            stns[stn] = { name: STN_NAMES[stn], abbr: STN_ABBR[stn], total: 0 };
                        }
                        stns[stn].total++;
                    }
                }
            }
        }

        // 빠진 광역은 0건으로 채움
        for (const stn of STN_CODES_FULL) {
            if (!stns[stn]) stns[stn] = { name: STN_NAMES[stn], abbr: STN_ABBR[stn], total: 0 };
        }

        // 전체 합산
        const total = Object.values(stns).reduce((s, v) => s + v.total, 0);
        res.json({ date, total, stns });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 단일 통보문 수집 (AI 분석 포함, 장부 반영)
router.post('/api/admin/report-collect', async (req, res) => {
    try {
        const { reportId, title, referenceTime, skipPush, testMode, adminToken, stn } = req.body;
        if (!reportId) return res.status(400).json({ error: 'reportId가 필요합니다' });

        // 1. 통보문 본문 가져오기 — 정책 01: 광역(stn) 일치 필수
        //    KMA 서버는 stn 이 reportId 광역과 다르면 reportId 무시하고 최신 통보문 반환
        const rawText = await reportProcessor.fetchReportDetail(reportId, { stn });
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

        // 3. AI 분석 (번호별 항목 분리 포함)
        const baseDate = extractTmFcFromReportId(reportId);
        const aiParsed = await aiParser.parseNoticeWithAI(rawText, baseDate);
        const aiResult = aiParsed.data || [];
        const aiError = aiParsed.error || null;
        const separatedText = aiParsed.separatedText || null;

        // 4. 장부에 반영
        let applied = false;
        let pushResult = null;
        try {
            const outputFile = getOutputFile(testMode);
            // 테스트 모드: 테스트 장부가 없으면 운영 장부를 복사하여 시작
            if (testMode && !fs.existsSync(outputFile)) {
                const prodFile = weatherAlertsCrawler.CONFIG.OUTPUT_FILE;
                if (fs.existsSync(prodFile)) {
                    fs.copyFileSync(prodFile, outputFile);
                    console.log('[Admin] 테스트 모드: 운영 장부를 테스트 장부로 복사');
                }
            }
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
                    console.log(`[Admin] 수집 → 변경 ${changes.length}건 감지, 푸시 발송 생략 (토글 OFF)`);
                } else {
                    try {
                        const pushOptions = (testMode && adminToken) ? { adminToken } : {};
                        await pushSender.processChanges(changes, pushOptions);
                        pushResult = { sent: true, changeCount: changes.length, testMode: !!testMode };
                        console.log(`[Admin] 수집 → 변경 ${changes.length}건 감지, 푸시 발송 완료${testMode ? ' (테스트→관리자만)' : ''}`);
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
                // [processedReportIds 정리] 30일 이상 지난 ID만 삭제
                // report_alert_processor.js와 동일한 기준 적용 — lastTs 기준 정리 시
                // 자동 크롤러가 보관 중인 ID까지 삭제되어 재수집이 발생할 수 있음
                if (fullForm.processedReportIds) {
                    const cleanupNow = new Date();
                    const CLEANUP_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30일
                    fullForm.processedReportIds = fullForm.processedReportIds.filter(id => {
                        const ts = (id.split(':')[1] || '').substring(0, 12);
                        if (ts.length >= 12) {
                            const idDate = new Date(`${ts.substring(0,4)}-${ts.substring(4,6)}-${ts.substring(6,8)}T${ts.substring(8,10)}:${ts.substring(10,12)}:00+09:00`);
                            return (cleanupNow - idDate) < CLEANUP_THRESHOLD_MS;
                        }
                        return true; // 파싱 불가한 ID는 유지
                    });
                }
                fs.writeFileSync(outputFile, JSON.stringify(fullForm, null, 2), 'utf8');
            }
        } catch (applyErr) {
            console.error('[Admin] 장부 반영 오류:', applyErr.message);
        }

        const responseData = { success: true, reportId, title, rawText, separatedText, aiResult, foundKeywords, applied, aiError, pushResult };

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

        // 3) 수집 실패 목록에서 failedIds 수집
        const failedIds = new Set();
        if (fs.existsSync(COLLECT_FAILURES_FILE)) {
            try {
                const failures = JSON.parse(fs.readFileSync(COLLECT_FAILURES_FILE, 'utf8'));
                failures.forEach(f => { if (f.reportId) failedIds.add(f.reportId); });
            } catch (_) { /* 파손 무시 */ }
        }

        res.json({ processedIds: Array.from(processedIds), failedIds: Array.from(failedIds) });
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

router.post('/api/admin/collect-failures', async (req, res) => {
    try {
        const { reportId, title, error, retriesUsed } = req.body;
        let failures = [];
        if (fs.existsSync(COLLECT_FAILURES_FILE)) {
            try { failures = JSON.parse(fs.readFileSync(COLLECT_FAILURES_FILE, 'utf8')); } catch (e) { failures = []; }
        }
        // 중복 저장 방지: 이미 같은 통보문이 기록되어 있으면 푸시도 발송하지 않음
        if (!failures.some(f => f.reportId === reportId)) {
            failures.push({ reportId, title, error, retriesUsed, failedAt: new Date().toISOString() });
            fs.writeFileSync(COLLECT_FAILURES_FILE, JSON.stringify(failures, null, 2), 'utf8');
            console.log(`[Admin] 수집 실패 기록: ${reportId} (${retriesUsed}회 시도)`);

            // [관리자 푸시] AI 수집 실패 발생 시 등록된 관리자 기기에 알림 발송
            sendAdminPush(
                '⚠️ AI 수집 실패',
                `${title || reportId} - ${retriesUsed}회 시도 후 실패`
            ).catch(err => console.error('[Admin] 수집 실패 푸시 발송 오류:', err.message));
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
// 검토 필요 통보문 관리 (review_needed.json)
// ============================================================================

// [조회] 검토 필요 통보문 목록 반환
router.get('/api/admin/review-needed', (req, res) => {
    try {
        if (!fs.existsSync(REVIEW_NEEDED_FILE)) return res.json([]);
        const data = JSON.parse(fs.readFileSync(REVIEW_NEEDED_FILE, 'utf8'));
        res.json(data);
    } catch (e) { res.json([]); }
});

// [확인완료] 특정 통보문을 관리자가 확인 처리 (반복 푸시 중단 조건)
router.post('/api/admin/review-needed/acknowledge', (req, res) => {
    try {
        const { reportId } = req.body;
        if (!reportId) return res.status(400).json({ error: 'reportId가 필요합니다.' });

        if (!fs.existsSync(REVIEW_NEEDED_FILE)) return res.json({ success: false, message: '검토 필요 항목 없음' });

        let reviews = JSON.parse(fs.readFileSync(REVIEW_NEEDED_FILE, 'utf8'));
        const target = reviews.find(r => r.reportId === reportId);
        if (target) {
            target.acknowledged = true;
            target.acknowledgedAt = new Date().toISOString();
            fs.writeFileSync(REVIEW_NEEDED_FILE, JSON.stringify(reviews, null, 2), 'utf8');
            console.log(`[Admin] 검토 필요 통보문 확인완료: ${reportId}`);
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// [전체 확인완료] 모든 검토 필요 통보문 확인 처리
router.post('/api/admin/review-needed/acknowledge-all', (req, res) => {
    try {
        if (!fs.existsSync(REVIEW_NEEDED_FILE)) return res.json({ success: true });

        let reviews = JSON.parse(fs.readFileSync(REVIEW_NEEDED_FILE, 'utf8'));
        const now = new Date().toISOString();
        reviews.forEach(r => {
            if (!r.acknowledged) {
                r.acknowledged = true;
                r.acknowledgedAt = now;
            }
        });
        fs.writeFileSync(REVIEW_NEEDED_FILE, JSON.stringify(reviews, null, 2), 'utf8');
        console.log('[Admin] 모든 검토 필요 통보문 확인완료 처리');
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// [삭제] 검토 필요 통보문 전체 삭제 (초기화)
router.delete('/api/admin/review-needed', (req, res) => {
    try {
        if (fs.existsSync(REVIEW_NEEDED_FILE)) fs.unlinkSync(REVIEW_NEEDED_FILE);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================================
// Gemini API 키 상태 조회 (공용 클라이언트)
// ============================================================================

router.get('/api/admin/gemini-status', (req, res) => {
    try {
        const geminiClient = require('../services/gemini_client');
        const keys = geminiClient.getKeysStatus();
        res.json({ keys, count: keys.length });
    } catch (e) {
        console.error('[Admin] gemini-status 조회 오류:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ============================================================================
// 재시도 대기열 관리 (pendingRetries in weather_alerts.json)
// → AI 분석 실패(429, 빈 양식 등)로 10분/1분 간격 재시도 중인 통보문 목록
// → 관리자가 '특보 수정' 탭에서 수동 반영한 경우 수동으로 대기열에서 제거 필요
// ============================================================================

// [조회] 현재 재시도 대기 중인 통보문 목록
router.get('/api/admin/pending-retries', (req, res) => {
    try {
        const outputFile = weatherAlertsCrawler.CONFIG.OUTPUT_FILE;
        if (!fs.existsSync(outputFile)) return res.json([]);
        const fullForm = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
        const pendingRetries = fullForm.pendingRetries || {};
        const now = Date.now();
        const items = Object.keys(pendingRetries).map(reportId => {
            const entry = pendingRetries[reportId];
            const firstSeenMs = entry.firstSeen ? new Date(entry.firstSeen).getTime() : now;
            return {
                reportId,
                title: entry.title || reportId,
                reason: entry.reason || 'EMPTY_CONTENT',
                firstSeen: entry.firstSeen || null,
                lastRetry: entry.lastRetry || null,
                lastNoticeSent: entry.lastNoticeSent || null,
                retryCount: entry.retryCount || 0,
                elapsedMs: now - firstSeenMs
            };
        });
        // 최초 감지 시각 오래된 순
        items.sort((a, b) => (a.firstSeen || '').localeCompare(b.firstSeen || ''));
        res.json(items);
    } catch (e) {
        console.error('[Admin] pending-retries 조회 오류:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// [원문 조회] 특정 통보문의 기상청 원문 텍스트
router.get('/api/admin/pending-retries/:reportId/raw', async (req, res) => {
    try {
        const reportId = req.params.reportId;
        const stn = req.query.stn;
        if (!reportId) return res.status(400).json({ error: 'reportId가 필요합니다.' });
        // 정책 01: stn 일치 필수 (없으면 fallback 108)
        const rawText = await reportProcessor.fetchReportDetail(reportId, { stn });
        res.json({ reportId, rawText: rawText || '' });
    } catch (e) {
        console.error('[Admin] 원문 조회 오류:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// [제거] 특정 통보문을 재시도 대기열에서 제거
// → 관리자가 '특보 수정' 탭 등으로 이미 수동 반영한 경우 사용
// → pendingRetries에서 삭제 + processedReportIds에 등록(다음 크롤링에서 재인식 방지)
router.delete('/api/admin/pending-retries/:reportId', (req, res) => {
    try {
        const reportId = req.params.reportId;
        if (!reportId) return res.status(400).json({ error: 'reportId가 필요합니다.' });
        const outputFile = weatherAlertsCrawler.CONFIG.OUTPUT_FILE;
        if (!fs.existsSync(outputFile)) return res.status(404).json({ error: '장부 파일 없음' });
        const fullForm = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
        if (!fullForm.pendingRetries || !fullForm.pendingRetries[reportId]) {
            return res.status(404).json({ error: '대기열에 해당 항목이 없습니다.' });
        }
        // pendingRetries에서 제거
        const removed = fullForm.pendingRetries[reportId];
        delete fullForm.pendingRetries[reportId];
        // processedReportIds에 등록하여 다음 크롤링에서 재인식 방지
        if (!fullForm.processedReportIds) fullForm.processedReportIds = [];
        if (!fullForm.processedReportIds.includes(reportId)) {
            fullForm.processedReportIds.push(reportId);
        }
        fs.writeFileSync(outputFile, JSON.stringify(fullForm, null, 2), 'utf8');
        console.log(`[Admin] 재시도 대기열에서 제거: ${reportId} (${removed.title || ''})`);
        res.json({ success: true, reportId, removedEntry: removed });
    } catch (e) {
        console.error('[Admin] pending-retries 제거 오류:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ============================================================================
// 수동 특보 등록/해제
// ============================================================================

// 수동 특보 등록 (zone tree 직접 주입)
router.post('/api/admin/manual-alert', (req, res) => {
    try {
        const { zoneName, warnType, level, command, tmFc, tmEf, tmCc, skipPush, testMode, adminToken } = req.body;

        if (!zoneName || !warnType || !level || !command) {
            return res.status(400).json({ error: '필수 항목 누락: zoneName, warnType, level, command' });
        }

        // 1. weather_alerts.json 로드 (테스트 모드 시 별도 파일)
        const outputFile = getOutputFile(testMode);
        if (testMode && !fs.existsSync(outputFile)) {
            const prodFile = weatherAlertsCrawler.CONFIG.OUTPUT_FILE;
            if (fs.existsSync(prodFile)) fs.copyFileSync(prodFile, outputFile);
        }
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
            const rangeMatch = tmEf.match(/(\d{4})년\s*(\d{2})월\s*(\d{2})일\s*(?:새벽|아침|오전|낮|오후|늦은 오후|저녁|밤)\((\d{2})시/);
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
                    const pushOptions = (testMode && adminToken) ? { adminToken } : {};
                    pushSender.processChanges(changes, pushOptions);
                    pushResult = { sent: true, changeCount: changes.length, testMode: !!testMode };
                    console.log(`[Admin] 수동 특보 → 변경 ${changes.length}건 감지, 푸시 발송${testMode ? ' (테스트→관리자만)' : ''}`);
                } catch (pushErr) {
                    pushResult = { sent: false, error: pushErr.message };
                }
            }
        }

        // 6.5. 자식해역 inherit 자동 동기화 — 부모 시각이 수동으로 바뀌었으므로
        //      그 산하 inherit 자식들의 시각도 부모 따라 갱신.
        //      (정책 02 §3-2 — source: "inherit" 자식 자동 동기화)
        try {
            function syncWalk(node, parentName) {
                if (!node || typeof node !== 'object') return;
                if (node.current !== undefined && node.children) {
                    node.children = subregionLedger.syncInheritChildren(node.current, node.children);
                }
                for (const [k, v] of Object.entries(node)) {
                    if (v && typeof v === 'object') syncWalk(v, k);
                }
            }
            syncWalk(fullForm.current);
        } catch (e) {
            console.error('[Admin] 자식 동기화 오류:', e.message);
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
        const { zoneName, skipPush, testMode, adminToken } = req.body;
        if (!zoneName) return res.status(400).json({ error: 'zoneName 필수' });

        const outputFile = getOutputFile(testMode);
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
                const pushOptions = (testMode && adminToken) ? { adminToken } : {};
                pushSender.processChanges(changes, pushOptions).catch(err => console.error(`[Push] 오류: ${err.message}`));
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
// 자식해역 수동 수정 — 정책 07_MANUAL_EDIT_UI.md
// ============================================================================
//
// 통보문 자동 수집 외에 관리자가 수동으로 자식해역 status·시각을 조정할 수 있는 API.
// status 값: "Y" | null | "EXCLUDED" | "PENDING"
// 사용자 원칙 검증: 부모 current null 인데 자식 Y 시도 시 차단 (정책 02 §1).
//
// 변경 시 사용자 푸시 발송 X (정책 02 §7-2 — 자식해역 변화는 사용자 푸시 없음).
// 변경 이력은 data/manual_edit_history.json 에 누적 기록.

const subregionLedger = require('../services/subregion_ledger');
const childAlertValidator = require('../services/child_alert_validator');
const subregionAdminPush = require('../services/subregion_admin_push');

const MANUAL_EDIT_HISTORY_FILE = path.join(__dirname, '..', 'data', 'manual_edit_history.json');

/**
 * 트리에서 부모해역 노드 찾기 (DFS)
 */
function findZoneNode(tree, parentZoneName) {
    if (!tree || typeof tree !== 'object') return null;
    if (tree.current !== undefined && tree.children !== undefined) {
        // 부모 노드 자체일 가능성 (zoneName 은 트리 상위에서 알아야 하므로 호출자 책임)
    }
    for (const [key, val] of Object.entries(tree)) {
        if (key === 'current' || key === 'upcoming' || key === 'history' || key === 'children' || key === 'missingCount') continue;
        if (key === parentZoneName && val && val.current !== undefined && val.children) {
            return val;
        }
        if (val && typeof val === 'object') {
            const found = findZoneNode(val, parentZoneName);
            if (found) return found;
        }
    }
    return null;
}

/**
 * 변경 이력 기록
 */
function appendEditHistory(record) {
    try {
        let history = { items: [] };
        if (fs.existsSync(MANUAL_EDIT_HISTORY_FILE)) {
            history = JSON.parse(fs.readFileSync(MANUAL_EDIT_HISTORY_FILE, 'utf8'));
        }
        const entry = {
            id: `edit_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            timestamp: new Date().toISOString(),
            ...record
        };
        history.items.push(entry);
        // 최근 1000건만 유지 (오래된 것 trim)
        if (history.items.length > 1000) history.items = history.items.slice(-1000);
        fs.writeFileSync(MANUAL_EDIT_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
    } catch (e) {
        console.error('[Admin] manual-edit-history 기록 실패:', e.message);
    }
}

/**
 * 단일 자식해역 수정
 * Body: { parentZone, childZone, status, alertData?, testMode?, adminToken? }
 */
router.put('/api/admin/manual-child-alert', (req, res) => {
    try {
        const { parentZone, childZone, status, alertData = {}, testMode } = req.body;
        if (!parentZone || !childZone) {
            return res.status(400).json({ error: 'parentZone, childZone 필수' });
        }

        const outputFile = getOutputFile(testMode);
        if (!fs.existsSync(outputFile)) return res.status(404).json({ error: '장부 파일 없음' });

        const fullForm = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
        const parentNode = findZoneNode(fullForm.current || fullForm, parentZone);
        if (!parentNode) return res.status(404).json({ error: `부모해역을 찾을 수 없음: ${parentZone}` });
        if (!parentNode.children) parentNode.children = {};

        // 사용자 원칙 검증
        const validation = childAlertValidator.validateChildStatus({
            parentCurrent: parentNode.current,
            targetChildStatus: status
        });
        if (!validation.allowed) {
            // [케이스 ④ — 사용자 원칙 위반 발송 (정책 06 ④)]
            subregionAdminPush.sendPrincipleViolation({
                reportId: 'manual-edit',
                stn: null,
                parentRegion: parentZone,
                childRegion: childZone
            });
            return res.status(409).json({
                error: 'PRINCIPLE_VIOLATION',
                reason: validation.reason,
                correctedStatus: validation.correctedStatus
            });
        }

        // status 적용 — 시각 단조성 위반 시 콜백 발송 (케이스 ⑧)
        if (status === null || status === undefined) {
            parentNode.children[childZone] = null;
        } else {
            parentNode.children[childZone] = subregionLedger.makeChildObject(
                parentNode.children[childZone],
                {
                    status,
                    source: alertData.source || 'report',
                    wrnTp: alertData.wrnTp || (parentNode.current && parentNode.current.wrnTp) || null,
                    wrnLvl: alertData.wrnLvl || (parentNode.current && parentNode.current.wrnLvl) || null,
                    tmFc: alertData.tmFc || (parentNode.current && parentNode.current.tmFc) || null,
                    tmEf: alertData.tmEf || (parentNode.current && parentNode.current.tmEf) || null,
                    tmCc: alertData.tmCc || (parentNode.current && parentNode.current.tmCc) || null,
                    sourceReportId: 'manual-edit',
                    modifiedBy: 'admin-manual'
                },
                {
                    parentRegion: parentZone,
                    childRegion: childZone,
                    violationCallback: (info) => {
                        subregionAdminPush.sendTimeMonotonicity({
                            reportId: 'manual-edit',
                            stn: null,
                            parentRegion: info.parentRegion,
                            childRegion: info.childRegion,
                            previousTmEf: info.previousTmEf,
                            newTmEf: info.newTmEf
                        });
                    }
                }
            );
        }

        fs.writeFileSync(outputFile, JSON.stringify(fullForm, null, 2), 'utf8');
        appendEditHistory({
            type: 'child-alert-update',
            parentZone, childZone, status, alertData,
            testMode: !!testMode
        });

        res.json({ success: true, parentZone, childZone, status });
    } catch (e) {
        console.error('[Admin] manual-child-alert 오류:', e.message);
        res.status(500).json({ error: e.message });
    }
});

/**
 * 다중 자식해역 일괄 수정 — 체크박스 다중 선택
 * Body: { parentZone, children: [...], status, alertData?, testMode? }
 */
router.put('/api/admin/manual-child-alert/bulk', (req, res) => {
    try {
        const { parentZone, children, status, alertData = {}, testMode } = req.body;
        if (!parentZone || !Array.isArray(children) || children.length === 0) {
            return res.status(400).json({ error: 'parentZone, children 배열 필수' });
        }

        const outputFile = getOutputFile(testMode);
        if (!fs.existsSync(outputFile)) return res.status(404).json({ error: '장부 파일 없음' });

        const fullForm = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
        const parentNode = findZoneNode(fullForm.current || fullForm, parentZone);
        if (!parentNode) return res.status(404).json({ error: `부모해역을 찾을 수 없음: ${parentZone}` });
        if (!parentNode.children) parentNode.children = {};

        // 사용자 원칙 일괄 검증
        const bulkValidation = childAlertValidator.validateBulkChildStatus({
            parentCurrent: parentNode.current,
            targetChildStatus: status,
            children
        });

        // [케이스 ④ — 차단된 자식들에 대해 위반 알림 (정책 06 ④)]
        if (bulkValidation.blockedChildren && bulkValidation.blockedChildren.length > 0) {
            for (const blockedChild of bulkValidation.blockedChildren) {
                subregionAdminPush.sendPrincipleViolation({
                    reportId: 'manual-edit-bulk',
                    stn: null,
                    parentRegion: parentZone,
                    childRegion: blockedChild
                });
            }
        }

        let appliedCount = 0;
        const appliedChildren = [];
        for (const childZone of bulkValidation.allowedChildren) {
            if (status === null || status === undefined) {
                parentNode.children[childZone] = null;
            } else {
                parentNode.children[childZone] = subregionLedger.makeChildObject(
                    parentNode.children[childZone],
                    {
                        status,
                        source: alertData.source || 'report',
                        wrnTp: alertData.wrnTp || (parentNode.current && parentNode.current.wrnTp) || null,
                        wrnLvl: alertData.wrnLvl || (parentNode.current && parentNode.current.wrnLvl) || null,
                        tmFc: alertData.tmFc || (parentNode.current && parentNode.current.tmFc) || null,
                        tmEf: alertData.tmEf || (parentNode.current && parentNode.current.tmEf) || null,
                        tmCc: alertData.tmCc || (parentNode.current && parentNode.current.tmCc) || null,
                        sourceReportId: 'manual-edit-bulk',
                        modifiedBy: 'admin-manual'
                    },
                    {
                        parentRegion: parentZone,
                        childRegion: childZone,
                        violationCallback: (info) => {
                            subregionAdminPush.sendTimeMonotonicity({
                                reportId: 'manual-edit-bulk',
                                stn: null,
                                parentRegion: info.parentRegion,
                                childRegion: info.childRegion,
                                previousTmEf: info.previousTmEf,
                                newTmEf: info.newTmEf
                            });
                        }
                    }
                );
            }
            appliedCount++;
            appliedChildren.push(childZone);
        }

        fs.writeFileSync(outputFile, JSON.stringify(fullForm, null, 2), 'utf8');
        appendEditHistory({
            type: 'child-alert-bulk-update',
            parentZone,
            children: appliedChildren,
            status, alertData,
            skipped: bulkValidation.blockedChildren,
            testMode: !!testMode
        });

        res.json({
            success: true,
            applied: appliedCount,
            skipped: bulkValidation.blockedChildren.length,
            skippedChildren: bulkValidation.blockedChildren,
            reason: bulkValidation.reason || null
        });
    } catch (e) {
        console.error('[Admin] manual-child-alert/bulk 오류:', e.message);
        res.status(500).json({ error: e.message });
    }
});

/**
 * 사용자 원칙 사전 검증 — 모달 열기 전 호출
 * GET /api/admin/check-child-principle?parentZone=...&status=Y
 */
router.get('/api/admin/check-child-principle', (req, res) => {
    try {
        const { parentZone, status, testMode } = req.query;
        if (!parentZone || !status) return res.status(400).json({ error: 'parentZone, status 필수' });

        const outputFile = getOutputFile(testMode === 'true');
        if (!fs.existsSync(outputFile)) return res.status(404).json({ error: '장부 파일 없음' });

        const fullForm = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
        const parentNode = findZoneNode(fullForm.current || fullForm, parentZone);
        if (!parentNode) return res.status(404).json({ error: `부모해역 미존재: ${parentZone}` });

        const validation = childAlertValidator.validateChildStatus({
            parentCurrent: parentNode.current,
            targetChildStatus: status
        });
        res.json({
            allowed: validation.allowed,
            reason: validation.reason || null,
            parentCurrent: parentNode.current
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * 부모해역의 자식해역 현재 status 조회 — 어드민 카드 동적 표시용
 * GET /api/admin/child-status?parentZone=...
 *
 * 응답: { parentZone, children: { [childName]: { status, wrnTp, wrnLvl, tmEf, ... } } }
 */
router.get('/api/admin/child-status', (req, res) => {
    try {
        const { parentZone, testMode } = req.query;
        if (!parentZone) return res.status(400).json({ error: 'parentZone 필수' });

        const outputFile = getOutputFile(testMode === 'true');
        if (!fs.existsSync(outputFile)) return res.status(404).json({ error: '장부 파일 없음' });

        const fullForm = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
        const parentNode = findZoneNode(fullForm.current || fullForm, parentZone);
        if (!parentNode) return res.status(404).json({ error: `부모해역 미존재: ${parentZone}` });

        res.json({
            parentZone,
            parentCurrent: parentNode.current || null,
            children: parentNode.children || {}
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * 자식해역 삭제 (status null 적용)
 * DELETE /api/admin/manual-child-alert?parentZone=...&childZone=...
 */
router.delete('/api/admin/manual-child-alert', (req, res) => {
    try {
        const { parentZone, childZone, testMode } = req.query;
        if (!parentZone || !childZone) return res.status(400).json({ error: 'parentZone, childZone 필수' });

        const outputFile = getOutputFile(testMode === 'true');
        if (!fs.existsSync(outputFile)) return res.status(404).json({ error: '장부 파일 없음' });

        const fullForm = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
        const parentNode = findZoneNode(fullForm.current || fullForm, parentZone);
        if (!parentNode || !parentNode.children) return res.status(404).json({ error: '부모해역 또는 자식해역 미존재' });

        parentNode.children[childZone] = null;
        fs.writeFileSync(outputFile, JSON.stringify(fullForm, null, 2), 'utf8');

        appendEditHistory({
            type: 'child-alert-delete',
            parentZone, childZone,
            testMode: testMode === 'true'
        });

        res.json({ success: true });
    } catch (e) {
        console.error('[Admin] manual-child-alert DELETE 오류:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ============================================================================
// 전체 통보문 일괄 수집
// ============================================================================
router.post('/api/admin/reports-collect-all', async (req, res) => {
    try {
        const { reports, referenceTimeMode, testMode, adminToken } = req.body;
        if (!reports || !Array.isArray(reports)) return res.status(400).json({ error: 'reports 배열이 필요합니다' });

        const results = [];
        for (const report of reports) {
            try {
                // 정책 01: report.stn 전달 필수 (없으면 fallback 108)
                const rawText = await reportProcessor.fetchReportDetail(report.id, { stn: report.stn });
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
                const outputFile = getOutputFile(testMode);
                // 테스트 모드: 테스트 장부가 없으면 운영 장부를 복사하여 시작
                if (testMode && !fs.existsSync(outputFile)) {
                    const prodFile = weatherAlertsCrawler.CONFIG.OUTPUT_FILE;
                    if (fs.existsSync(prodFile)) {
                        fs.copyFileSync(prodFile, outputFile);
                    }
                }
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
                    // [processedReportIds 정리] 30일 이상 지난 ID만 삭제
                    // report_alert_processor.js와 동일한 기준 적용
                    if (fullForm.processedReportIds) {
                        const cleanupNow = new Date();
                        const CLEANUP_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30일
                        fullForm.processedReportIds = fullForm.processedReportIds.filter(id => {
                            const ts = (id.split(':')[1] || '').substring(0, 12);
                            if (ts.length >= 12) {
                                const idDate = new Date(`${ts.substring(0,4)}-${ts.substring(4,6)}-${ts.substring(6,8)}T${ts.substring(8,10)}:${ts.substring(10,12)}:00+09:00`);
                                return (cleanupNow - idDate) < CLEANUP_THRESHOLD_MS;
                            }
                            return true; // 파싱 불가한 ID는 유지
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

// ============================================================================
// 관리자 테스트 모드 관리
// ============================================================================

// 테스트 장부 데이터 조회 (수집 현황 탭에서 사용)
router.get('/api/admin/test-alerts', (req, res) => {
    try {
        if (fs.existsSync(TEST_ALERTS_FILE)) {
            res.json(JSON.parse(fs.readFileSync(TEST_ALERTS_FILE, 'utf8')));
        } else {
            res.json(null);
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 테스트 장부 정리 (관리자 모드 OFF 시 호출)
router.post('/api/admin/test-cleanup', (req, res) => {
    try {
        if (fs.existsSync(TEST_ALERTS_FILE)) {
            fs.unlinkSync(TEST_ALERTS_FILE);
            console.log('[Admin] 테스트 장부 삭제 완료');
        }
        res.json({ success: true, message: '테스트 데이터가 정리되었습니다.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================================================
// 점검 모드 관리
// ============================================================================

/** 점검 모드 상태 조회 (관리자용) */
router.get('/api/admin/maintenance', (req, res) => {
    try {
        if (fs.existsSync(MAINTENANCE_FILE)) {
            const config = JSON.parse(fs.readFileSync(MAINTENANCE_FILE, 'utf8'));
            res.json(config);
        } else {
            res.json({ active: false, title: '', content: '', startedAt: null });
        }
    } catch (e) {
        res.json({ active: false, title: '', content: '', startedAt: null });
    }
});

/** 점검 모드 설정 (시작/종료/내용 변경) */
router.post('/api/admin/maintenance', (req, res) => {
    try {
        const { active, title, content, blockPush, blockedFeatures } = req.body;
        let config = { active: false, title: '', content: '', startedAt: null, startedBy: 'admin', blockPush: true, blockedFeatures: [] };

        if (fs.existsSync(MAINTENANCE_FILE)) {
            try { config = JSON.parse(fs.readFileSync(MAINTENANCE_FILE, 'utf8')); } catch (_) {}
        }

        if (typeof active === 'boolean') config.active = active;
        if (typeof title === 'string') config.title = title;
        if (typeof content === 'string') config.content = content;
        if (typeof blockPush === 'boolean') config.blockPush = blockPush;
        // [추가] blockedFeatures 함께 갱신
        //  관리자 화면이 라디오 "전체 차단" 을 선택하고 점검 시작 버튼을 누르면
        //  blockedFeatures: [] 빈 배열이 함께 전송되어 이전에 남아있던 선택값을
        //  비워야 사용자 측 가드(blockedFeatures.length > 0 일 때 차단 화면 스킵)
        //  가 풀려 정상적인 전체 차단 화면이 표시됨.
        if (Array.isArray(blockedFeatures)) config.blockedFeatures = blockedFeatures;

        if (active === true) {
            config.startedAt = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        } else if (active === false) {
            config.startedAt = null;
        }

        fs.writeFileSync(MAINTENANCE_FILE, JSON.stringify(config, null, 2), 'utf8');
        console.log(`[Admin] 점검 모드 ${config.active ? '시작' : '종료'}: ${config.title || '(제목 없음)'}`);
        res.json({ success: true, config });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================================================
// 앱 버전 관리
// ============================================================================

const APP_VERSION_FILE = path.join(__dirname, '..', 'app_version.json');

/** 앱 버전 정보 수정 */
router.post('/api/admin/app-version', (req, res) => {
    try {
        const { latestVersion, latestVersionCode, updateMessage } = req.body;

        if (!latestVersion || latestVersionCode === undefined) {
            return res.status(400).json({ error: 'latestVersion과 latestVersionCode는 필수입니다.' });
        }

        // 기존 파일 읽기
        let config = {};
        if (fs.existsSync(APP_VERSION_FILE)) {
            try { config = JSON.parse(fs.readFileSync(APP_VERSION_FILE, 'utf8')); } catch (_) {}
        }

        // 값 업데이트
        config.latestVersion = latestVersion;
        config.latestVersionCode = parseInt(latestVersionCode, 10);
        if (typeof updateMessage === 'string') config.updateMessage = updateMessage;

        fs.writeFileSync(APP_VERSION_FILE, JSON.stringify(config, null, 2), 'utf8');
        console.log(`[Admin] 앱 버전 업데이트: v${latestVersion} (code: ${latestVersionCode})`);
        res.json({ success: true, config });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/** 점검 모드 상태 조회 (일반 사용자용 - 공개 API) */
router.get('/api/maintenance-status', (req, res) => {
    try {
        if (fs.existsSync(MAINTENANCE_FILE)) {
            const config = JSON.parse(fs.readFileSync(MAINTENANCE_FILE, 'utf8'));
            res.json({ active: config.active, title: config.title, content: config.content, blockedFeatures: config.blockedFeatures || [] });
        } else {
            res.json({ active: false });
        }
    } catch (e) {
        res.json({ active: false });
    }
});

// ============================================================================
// 운영 병행 모드 관리
// ============================================================================

const DEFAULT_WORK_MESSAGE = `현재 관리자가 SEA:GNAL의 쾌적한 사용 및 운영을 위하여 기능 개선작업을 진행 중입니다.
작업 중에는 표출 오류, 서버 멈춤 등 기타 문제가 일시적으로 발생할 수 있습니다.
하지만 작업 소요시간은 오래 걸리지 않으니 사용 중 문제가 발생하지 않도록 신속하게 마무리하겠습니다.
이용해주셔서 감사합니다.`;

function loadWorkModeConfig() {
    try {
        if (fs.existsSync(WORK_MODE_FILE)) {
            return JSON.parse(fs.readFileSync(WORK_MODE_FILE, 'utf8'));
        }
    } catch (e) { /* 무시 */ }
    return { active: false, content: '', estimatedEnd: '', startedAt: null };
}

/** 운영 병행 모드 상태 조회 (관리자용) */
router.get('/api/admin/work-mode', (req, res) => {
    res.json(loadWorkModeConfig());
});

/** 운영 병행 모드 설정 */
router.post('/api/admin/work-mode', (req, res) => {
    try {
        const { active, content, estimatedEnd } = req.body;
        const config = loadWorkModeConfig();

        if (typeof active === 'boolean') config.active = active;
        if (typeof content === 'string') config.content = content;
        if (typeof estimatedEnd === 'string') config.estimatedEnd = estimatedEnd;

        if (active === true) {
            config.startedAt = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        } else if (active === false) {
            config.startedAt = null;
        }

        fs.writeFileSync(WORK_MODE_FILE, JSON.stringify(config, null, 2), 'utf8');
        console.log(`[Admin] 운영 병행 모드 ${config.active ? '시작' : '종료'}`);
        res.json({ success: true, config });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/** 운영 병행 모드 상태 조회 (공개 API) */
router.get('/api/work-mode-status', (req, res) => {
    const config = loadWorkModeConfig();
    res.json({ active: config.active, content: config.content, estimatedEnd: config.estimatedEnd });
});

// ============================================================================
// 점검 모드 - 선택적 기능 차단
// ============================================================================

/** 점검 모드 설정 (선택적 차단 포함) - 기존 POST 확장 */
router.post('/api/admin/maintenance-features', (req, res) => {
    try {
        const { blockedFeatures } = req.body;
        let config = { active: false, title: '', content: '', startedAt: null, startedBy: 'admin', blockedFeatures: [] };

        if (fs.existsSync(MAINTENANCE_FILE)) {
            try { config = JSON.parse(fs.readFileSync(MAINTENANCE_FILE, 'utf8')); } catch (_) {}
        }

        if (Array.isArray(blockedFeatures)) config.blockedFeatures = blockedFeatures;

        fs.writeFileSync(MAINTENANCE_FILE, JSON.stringify(config, null, 2), 'utf8');
        console.log(`[Admin] 선택적 차단 기능 업데이트: ${(config.blockedFeatures || []).join(', ') || '없음'}`);
        res.json({ success: true, config });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/** 점검/차단 상태 통합 조회 (공개 API - 기존 maintenance-status 확장) */
router.get('/api/block-status', (req, res) => {
    try {
        let maintenance = { active: false, blockedFeatures: [] };
        if (fs.existsSync(MAINTENANCE_FILE)) {
            const config = JSON.parse(fs.readFileSync(MAINTENANCE_FILE, 'utf8'));
            maintenance = { active: config.active, title: config.title, content: config.content, blockedFeatures: config.blockedFeatures || [] };
        }
        const workMode = loadWorkModeConfig();
        res.json({
            maintenance,
            workMode: { active: workMode.active, content: workMode.content, estimatedEnd: workMode.estimatedEnd }
        });
    } catch (e) {
        res.json({ maintenance: { active: false, blockedFeatures: [] }, workMode: { active: false } });
    }
});

// ============================================================================
// 외부 저장소 사용량 조회 API
// ============================================================================

/**
 * GET /api/admin/storage-usage
 * Cloudinary와 Google Cloud Storage의 사용량을 조회하여 반환합니다.
 *
 * [응답 구조]
 * {
 *   cloudinary: {
 *     available: true/false,          // Cloudinary 설정 여부
 *     storage: { used: bytes, limit: bytes },   // 저장 공간
 *     bandwidth: { used: bytes, limit: bytes },  // 월간 대역폭
 *     resources: number,              // 총 파일 수
 *     error: string (실패 시)
 *   },
 *   gcs: {
 *     available: true/false,          // Google Cloud Storage 설정 여부
 *     storage: { used: bytes, limit: 5368709120 (5GB) },  // 저장 공간
 *     fileCount: number,              // 총 파일 수
 *     latestBackup: string,           // 최근 백업 날짜
 *     error: string (실패 시)
 *   }
 * }
 *
 * [연계]
 * - services/upload_manager.js → Cloudinary SDK 인스턴스 제공
 * - cloud_backup.js → Google Cloud Storage 버킷 정보
 * - js/admin_collect.js → 관리자 "외부 저장소" 탭에서 이 API를 호출하여 게이지 바 표시
 */
router.get('/api/admin/storage-usage', async (req, res) => {
    const result = {
        cloudinary: { available: false },
        gcs: { available: false }
    };

    // ── Cloudinary 사용량 조회 ──
    // upload_manager.js에서 Cloudinary SDK 인스턴스를 가져와서 Admin API 호출
    try {
        const { getCloudinary } = require('../services/upload_manager');
        const cloudinary = getCloudinary();

        if (cloudinary) {
            // cloudinary.api.usage()는 현재 계정의 저장 공간, 대역폭, 크레딧, 변환 수 등을 반환
            const usage = await cloudinary.api.usage();

            // Cloudinary 무료(Free) 플랜은 바이트 단위 한도(limit)를 0으로 반환하는 경우가 있음
            // 이 경우 알려진 무료 플랜 기본값(25GB)을 사용
            const FREE_LIMIT_BYTES = 25 * 1024 * 1024 * 1024;  // 25 GB
            const storageLimit = usage.storage?.limit || FREE_LIMIT_BYTES;
            const bandwidthLimit = usage.bandwidth?.limit || FREE_LIMIT_BYTES;

            result.cloudinary = {
                available: true,
                storage: {
                    used: usage.storage?.usage || 0,          // 현재 사용 중인 저장 공간 (바이트)
                    limit: storageLimit                        // 저장 한도 (바이트, 무료 플랜 기본 25GB)
                },
                bandwidth: {
                    used: usage.bandwidth?.usage || 0,         // 이번 달 사용한 대역폭 (바이트)
                    limit: bandwidthLimit                      // 월간 대역폭 한도 (바이트, 무료 플랜 기본 25GB)
                },
                // 크레딧 정보: Cloudinary 무료 플랜은 매달 25 크레딧을 제공하며
                // 저장(1GB=1크레딧), 대역폭(1GB=1크레딧), 변환(1000건=1크레딧) 합산으로 소비
                credits: {
                    used: usage.credits?.usage || 0,          // 이번 달 사용한 크레딧 수
                    limit: usage.credits?.limit || 25          // 월간 크레딧 한도 (무료 플랜 기본 25)
                },
                transformations: {
                    used: usage.transformations?.usage || 0,   // 이번 달 변환 횟수
                    limit: usage.transformations?.limit || 25000  // 월간 변환 한도 (무료 플랜 기본 25,000건)
                },
                resources: usage.resources || 0,               // 총 파일(리소스) 수
                plan: usage.plan || 'Free'                     // 현재 플랜 이름
            };
        }
    } catch (e) {
        result.cloudinary = { available: true, error: e.message };
    }

    // ── Google Cloud Storage 사용량 조회 ──
    // cloud_backup.js의 버킷에서 파일 목록을 가져와 크기를 합산
    try {
        const backupKeyPath = path.join(__dirname, '..', 'serviceAccountKey_Backup.json');
        if (fs.existsSync(backupKeyPath)) {
            const { Storage } = require('@google-cloud/storage');
            const keyData = JSON.parse(fs.readFileSync(backupKeyPath, 'utf8'));
            const storage = new Storage({ keyFilename: backupKeyPath, projectId: keyData.project_id });
            const bucket = storage.bucket('seagnal-server-backup');

            // 버킷 내 모든 파일 목록을 조회하여 크기 합산
            const [files] = await bucket.getFiles();
            let totalSize = 0;
            let latestDate = '';

            files.forEach(file => {
                totalSize += parseInt(file.metadata.size || 0);
                // 파일명에서 백업 날짜 추출 (backup_YYYYMMDD/filename.json)
                const match = file.name.match(/backup_(\d{8})/);
                if (match && match[1] > latestDate) {
                    latestDate = match[1];
                }
            });

            // 최근 백업 날짜를 읽기 쉬운 형식으로 변환 (20260402 → 2026-04-02)
            const formattedDate = latestDate
                ? `${latestDate.slice(0, 4)}-${latestDate.slice(4, 6)}-${latestDate.slice(6, 8)}`
                : '-';

            result.gcs = {
                available: true,
                storage: {
                    used: totalSize,                           // 현재 사용 중인 저장 공간 (바이트)
                    limit: 5 * 1024 * 1024 * 1024              // 무료 한도 5GB (바이트)
                },
                fileCount: files.length,                       // 총 파일 수
                latestBackup: formattedDate                    // 가장 최근 백업 날짜
            };
        }
    } catch (e) {
        result.gcs = { available: true, error: e.message };
    }

    res.json(result);
});

// ============================================================================
// 구독자 zones 정리 (대분류/중분류 제거)
// ============================================================================

/**
 * POST /api/admin/cleanup-subscription-zones
 * 기존 구독자의 zones에서 대분류(동해/서해/남해/제주)와
 * 중분류(동해남부해상, 남해동부해상 등)를 제거하여 소분류만 남김.
 * 대분류/중분류가 포함되면 expandToMinorZones에서 의도하지 않은 해역까지
 * 확장되어 관심해역 외 푸시가 발송되는 버그 방지.
 */
router.post('/api/admin/cleanup-subscription-zones', (req, res) => {
    // 제거 대상: 대분류 4개 + 중분류 7개
    const PARENT_ZONES = new Set([
        '동해', '서해', '남해', '제주',
        '동해남부해상', '동해중부해상', '서해중부해상', '서해남부해상',
        '남해동부해상', '남해서부해상', '제주해역'
    ]);

    const subsFile = path.join(DATA_DIR, 'subscriptions.json');
    try {
        if (!fs.existsSync(subsFile)) {
            return res.json({ success: true, message: '구독자 파일 없음', updated: 0 });
        }
        const subs = JSON.parse(fs.readFileSync(subsFile, 'utf8'));
        if (!Array.isArray(subs)) {
            return res.json({ success: true, message: '구독자 데이터가 배열이 아님', updated: 0 });
        }

        let updatedCount = 0;
        for (const sub of subs) {
            if (!Array.isArray(sub.zones)) continue;
            const before = sub.zones.length;
            // 대분류/중분류 제거, 소분류만 유지
            sub.zones = sub.zones.filter(z => !PARENT_ZONES.has(z));
            if (sub.zones.length !== before) {
                updatedCount++;
            }
        }

        fs.writeFileSync(subsFile, JSON.stringify(subs, null, 2), 'utf8');
        console.log(`[Admin] 구독자 zones 정리 완료: ${updatedCount}명 갱신`);
        res.json({
            success: true,
            message: `구독자 zones 정리 완료`,
            total: subs.length,
            updated: updatedCount
        });
    } catch (e) {
        console.error('[Admin] 구독자 zones 정리 오류:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ============================================================================
// 관리자 기기 등록/해제 (관리자 전용 푸시 알림 대상 관리)
// ============================================================================
// subscriptions.json(일반 사용자 구독)과 완전 별도로 admin_devices.json 사용.
// 관리자 센터에서 [등록]하면 해당 기기로 수집 오류/검토 필요 푸시 알림을 받을 수 있음.

/**
 * POST /api/admin/register-device
 * 현재 기기를 관리자 푸시 알림 대상으로 등록.
 * body: { token: "FCM토큰" } 또는 { subscription: { endpoint: "..." } }
 */
router.post('/api/admin/register-device', (req, res) => {
    const { token, subscription } = req.body;
    // FCM 토큰 또는 Web Push 구독 정보 중 하나는 필수
    if (!token && !(subscription && subscription.endpoint)) {
        return res.status(400).json({ error: '토큰 또는 구독 정보가 필요합니다.' });
    }

    try {
        let devices = [];
        if (fs.existsSync(ADMIN_DEVICES_FILE)) {
            devices = JSON.parse(fs.readFileSync(ADMIN_DEVICES_FILE, 'utf8'));
        }

        // 등록 기기 식별: FCM이면 토큰, Web Push면 endpoint로 구분
        const deviceId = token || subscription.endpoint;
        const deviceType = token ? 'fcm' : 'web';

        // 이미 등록된 기기인지 확인 (중복 방지)
        const exists = devices.some(d => {
            if (d.type === 'fcm') return d.token === deviceId;
            return d.subscription && d.subscription.endpoint === deviceId;
        });

        if (exists) {
            return res.json({ success: true, message: '이미 등록된 기기입니다.', alreadyRegistered: true });
        }

        // 새 기기 등록
        const newDevice = {
            type: deviceType,
            token: token || undefined,
            subscription: subscription || undefined,
            registeredAt: new Date().toISOString()
        };
        devices.push(newDevice);
        fs.writeFileSync(ADMIN_DEVICES_FILE, JSON.stringify(devices, null, 2), 'utf8');
        console.log(`[Admin] 관리자 기기 등록: ${deviceType} (총 ${devices.length}대)`);
        res.json({ success: true, message: '관리자 기기 등록 완료', totalDevices: devices.length });
    } catch (e) {
        console.error('[Admin] 관리자 기기 등록 오류:', e.message);
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/admin/unregister-device
 * 현재 기기를 관리자 푸시 알림 대상에서 해제.
 * body: { token: "FCM토큰" } 또는 { subscription: { endpoint: "..." } }
 */
router.post('/api/admin/unregister-device', (req, res) => {
    const { token, subscription } = req.body;
    if (!token && !(subscription && subscription.endpoint)) {
        return res.status(400).json({ error: '토큰 또는 구독 정보가 필요합니다.' });
    }

    try {
        let devices = [];
        if (fs.existsSync(ADMIN_DEVICES_FILE)) {
            devices = JSON.parse(fs.readFileSync(ADMIN_DEVICES_FILE, 'utf8'));
        }

        const deviceId = token || subscription.endpoint;
        const before = devices.length;

        // 해당 기기만 목록에서 제거
        devices = devices.filter(d => {
            if (d.type === 'fcm') return d.token !== deviceId;
            return !(d.subscription && d.subscription.endpoint === deviceId);
        });

        fs.writeFileSync(ADMIN_DEVICES_FILE, JSON.stringify(devices, null, 2), 'utf8');
        const removed = before - devices.length;
        console.log(`[Admin] 관리자 기기 해제: ${removed}대 제거 (남은 ${devices.length}대)`);
        res.json({ success: true, message: '관리자 기기 해제 완료', removed, totalDevices: devices.length });
    } catch (e) {
        console.error('[Admin] 관리자 기기 해제 오류:', e.message);
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /api/admin/device-status
 * 현재 기기가 관리자로 등록되어 있는지 확인.
 * query: ?token=FCM토큰 또는 ?endpoint=WebPush엔드포인트
 */
router.get('/api/admin/device-status', (req, res) => {
    const { token, endpoint } = req.query;
    if (!token && !endpoint) {
        return res.json({ registered: false });
    }

    try {
        let devices = [];
        if (fs.existsSync(ADMIN_DEVICES_FILE)) {
            devices = JSON.parse(fs.readFileSync(ADMIN_DEVICES_FILE, 'utf8'));
        }

        const deviceId = token || endpoint;
        const found = devices.some(d => {
            if (d.type === 'fcm') return d.token === deviceId;
            return d.subscription && d.subscription.endpoint === deviceId;
        });

        res.json({ registered: found, totalDevices: devices.length });
    } catch (e) {
        res.json({ registered: false });
    }
});

module.exports = router;
