/**
 * ============================================================================
 * 파일명: routes/weather.js
 * 역할: 기상 특보 및 전망 데이터 API 라우트
 * ============================================================================
 *
 * [설명]
 * 이 파일은 기상 관련 데이터를 클라이언트에 제공하는 API 엔드포인트를 관리합니다.
 * - GET /api/weather-alerts → 기상 특보 현황 (weather_alerts.json)
 * - GET /api/buoys → 부이 관측 데이터
 * - GET /api/status → API 수집 상태
 * - POST /api/force-update/:type → 수동 데이터 업데이트
 * - GET/POST /api/config → API 인증키 설정
 * - GET /api/forecasts → 일반 기상 전망
 * - GET /api/marine-zone-forecasts → 해구별 기상 전망
 * - GET /api/bulletin-cache/:reportId → 통보문 캐시 조회 (특보 히스토리 팝업용)
 *
 * [연계 파일]
 * - services/cache_manager.js → dataCache에서 캐시된 데이터 응답
 * - config/server_config.js → DATA_DIR 경로 사용
 * - scheduler.js → 수집 상태 조회 및 수동 업데이트 실행
 * - server.js → app.use()로 이 라우터 등록
 *
 * [초보자를 위한 안내]
 * 이 API들은 프론트엔드(app.js)에서 fetch()로 호출되어
 * 사용자에게 기상 특보, 부이 데이터, 전망 정보를 보여주는 데 사용됩니다.
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/server_config');
const { dataCache, refreshCache } = require('../services/cache_manager');
const scheduler = require('../scheduler');
const regionalForecastCollector = require('../regional_forecast_collector');

// 1. 특보 정보 (통합 크롤러 데이터)
router.get('/api/weather-alerts', (req, res) => {
    try {
        const filePath = path.join(DATA_DIR, 'weather_alerts.json');
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'weather_alerts.json not found' });
        }
        res.sendFile(filePath);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 2. 부이 정보
router.get('/api/buoys', (req, res) => {
    if (dataCache.buoys) res.json(dataCache.buoys);
    else res.status(404).json({ error: '데이터 준비 중' });
});

// 2-1. 부이 상세 파고 정보 (kma_buoy.php)
router.get('/api/kma-buoys', (req, res) => {
    if (dataCache.kmaBuoys) res.json(dataCache.kmaBuoys);
    else res.status(404).json({ error: '데이터 준비 중' });
});

// 2-2. API 상태 확인
router.get('/api/status', (req, res) => {
    res.json(scheduler.getStatus());
});

// 2-1. 수동 업데이트 (SSE 스트리밍 진행 상황)
router.get('/api/force-update/:type/stream', async (req, res) => {
    const type = req.params.type;
    console.log(`🔄 수동 업데이트 SSE 요청: ${type}`);

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });

    const onProgress = (data) => {
        if (data.type === type) {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
    };
    scheduler.collectProgress.on('progress', onProgress);

    req.on('close', () => {
        scheduler.collectProgress.off('progress', onProgress);
    });

    try {
        if (type === 'buoys') {
            await scheduler.collectBuoys();
            await scheduler.collectKmaBuoys();
        }
        else if (type === 'general') {
            await scheduler.collectGeneralForecasts();
            await scheduler.collectMidTermSeaForecasts();
            // 지방기상청 단기예보도 함께 수집 (진행률 포함)
            await regionalForecastCollector.collectRegionalForecasts(scheduler.collectProgress);
        }
        else if (type === 'zone') await scheduler.collectZoneForecasts();
        // 해양생활기상(바다낚시 지수) 수동 수집 — admin 페이지에서 호출
        else if (type === 'fishing') await scheduler.collectFishingIndex();
        else {
            res.write(`data: ${JSON.stringify({ error: '잘못된 타입' })}\n\n`);
            res.end();
            return;
        }

        refreshCache();
        res.write(`data: ${JSON.stringify({ done: true, status: scheduler.getStatus()[type] })}\n\n`);
    } catch (e) {
        res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    } finally {
        scheduler.collectProgress.off('progress', onProgress);
        res.end();
    }
});

// 2-1-b. 수동 업데이트 (기존 POST 호환)
router.post('/api/force-update/:type', async (req, res) => {
    const type = req.params.type;
    console.log(`🔄 수동 업데이트 요청: ${type}`);
    try {
        if (type === 'buoys') {
            await scheduler.collectBuoys();
            await scheduler.collectKmaBuoys();
        }
        else if (type === 'general') {
            await scheduler.collectGeneralForecasts();
            await scheduler.collectMidTermSeaForecasts();
            // 지방기상청 단기예보도 함께 수집
            await regionalForecastCollector.collectRegionalForecasts();
        }
        else if (type === 'zone') await scheduler.collectZoneForecasts();
        // 해양생활기상(바다낚시 지수) 수동 수집 — POST 호환 엔드포인트
        else if (type === 'fishing') await scheduler.collectFishingIndex();
        else return res.status(400).json({ error: '잘못된 타입' });

        refreshCache();
        res.json({ success: true, status: scheduler.getStatus()[type] });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 2-1-c. 지방청 수집 디버그 로그 조회
router.get('/api/regional-debug', (req, res) => {
    const debugDir = require('path').join(__dirname, '..', 'data', 'debug_pdf');
    const fs = require('fs');
    const result = { debugDir, exists: fs.existsSync(debugDir), files: [], contents: {} };
    try {
        if (result.exists) {
            result.files = fs.readdirSync(debugDir);
            for (const f of result.files) {
                try {
                    result.contents[f] = fs.readFileSync(require('path').join(debugDir, f), 'utf8');
                } catch (_) {}
            }
        }
    } catch (e) {
        result.error = e.message;
    }
    res.json(result);
});

// 2-2. API 인증키 설정 조회
router.get('/api/config', (req, res) => {
    try {
        res.json(scheduler.getConfig());
    } catch (e) {
        res.status(500).json({ error: '설정 조회 실패' });
    }
});

// 2-2. API 인증키 설정 저장
router.post('/api/config', (req, res) => {
    try {
        const success = scheduler.updateConfig(req.body);
        if (success) res.json({ success: true });
        else res.status(500).json({ error: '저장 실패' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 3. 기상 전망
router.get('/api/forecasts', (req, res) => {
    if (dataCache.forecasts) res.json(dataCache.forecasts);
    else res.status(404).json({ error: '데이터 준비 중' });
});

// 4. 해구별 기상전망
router.get('/api/marine-zone-forecasts', (req, res) => {
    if (dataCache.zoneForecasts) res.json(dataCache.zoneForecasts);
    else res.status(404).json({ error: '데이터 준비 중' });
});

// 4-1. 중기해상예보
router.get('/api/mid-term-sea-forecasts', (req, res) => {
    if (dataCache.midTermSeaForecasts) res.json(dataCache.midTermSeaForecasts);
    else res.status(404).json({ error: '데이터 준비 중' });
});

// 5. 해상 기상 전망 (초단기/단기)
router.get('/api/marine-forecast', (req, res) => {
    try {
        const filePath = path.join(DATA_DIR, 'marine_forecast.json');
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'marine_forecast.json not found' });
        }
        res.sendFile(filePath);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 5-1. 지방기상청 단기예보 (종합 전망 + 기온)
router.get('/api/regional-forecast', (req, res) => {
    try {
        const filePath = path.join(DATA_DIR, 'regional_forecast.json');
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'regional_forecast.json not found' });
        }
        res.sendFile(filePath);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 5-2. 먼바다 해상예보 (PDF 파싱 데이터)
router.get('/api/regional-marine-forecast', (req, res) => {
    try {
        const data = regionalForecastCollector.loadMarineForecasts();
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 5-3. 앞바다 해상예보 (PDF 파싱 데이터)
router.get('/api/regional-coastal-forecast', (req, res) => {
    try {
        const data = regionalForecastCollector.loadCoastalForecasts();
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 6. 통보문 캐시 조회 (특보 히스토리 팝업 → 아코디언 펼침 시 호출)
// collect_cache 디렉토리에 저장된 통보문별 AI 분석 결과를 반환
// reportId 예: "met:202602162000:141" → 파일명: "met_202602162000_141.json"
router.get('/api/bulletin-cache/:reportId', (req, res) => {
    try {
        const reportId = decodeURIComponent(req.params.reportId);
        const cacheFileName = reportId.replace(/[/:]/g, '_') + '.json';
        const cachePath = path.join(DATA_DIR, 'collect_cache', cacheFileName);

        if (!fs.existsSync(cachePath)) {
            return res.status(404).json({ error: '캐시 데이터 없음', reportId });
        }

        const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        res.json(cacheData);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 7. 해상 전망 캐시 목록 조회 (초단기/단기 전망 통보문 수집 결과)
const marineForecast = require('../marine_forecast_processor');

router.get('/api/forecast-cache/list', (req, res) => {
    try {
        res.json(marineForecast.listForecastCaches());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 8. 해상 전망 캐시 상세 조회 (원문 + 코드 추출 + AI 분석 결과)
router.get('/api/forecast-cache/:reportId', (req, res) => {
    try {
        const reportId = decodeURIComponent(req.params.reportId);
        const data = marineForecast.loadForecastCache(reportId);
        if (!data) return res.status(404).json({ error: '캐시 데이터 없음', reportId });
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 9. 해상 전망 재수집 (관리자용)
router.post('/api/marine-forecast/refresh', async (req, res) => {
    try {
        await marineForecast.collectMarineForecasts();
        res.json({ success: true, message: '해상 기상 전망 재수집 완료' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 10. 개별 전망 통보문 수집 (관리자용 - 특정 reportId 수집)
router.post('/api/admin/forecast-collect', async (req, res) => {
    try {
        const { reportId, title } = req.body;
        if (!reportId) return res.status(400).json({ success: false, error: 'reportId 필요' });

        // 통보문 상세 조회
        const parts = reportId.split(':');
        const dateStr = parts[1] || '';
        const dateParam = dateStr.substring(0, 4) + '-' + dateStr.substring(4, 6) + '-' + dateStr.substring(6, 8);
        const url = `https://www.weather.go.kr/w/special-report/list.do?stn=108&date=${dateParam}`;

        // fetchForecastDetail을 직접 호출하기 위해 내부 함수 재현
        const https = require('https');
        const fetchHtml = (u) => new Promise((resolve, reject) => {
            https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (resp) => {
                const chunks = [];
                resp.on('data', c => chunks.push(c));
                resp.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
            }).on('error', reject);
        });

        // 상세 페이지에서 원문 가져오기 (기상청은 list.do에 reportId를 전달하여 상세 조회)
        const detailUrl = `https://www.weather.go.kr/w/special-report/list.do?prevStn=108&stn=108&date=${dateParam}&reportId=${reportId}`;
        const html = await fetchHtml(detailUrl);

        // 전망 기간 추출
        let forecastPeriod = '';
        const periodMatch = html.match(/※\s*(\d{1,2}월\s*\d{1,2}일[^<]*?까지의\s*전망[^<.]*\.?)/);
        if (periodMatch) forecastPeriod = '※ ' + periodMatch[1].replace(/\s+/g, ' ').trim();

        // 발표 시각 추출
        let publishTime = '';
        const ts = parts[1] || '';
        if (ts.length >= 12) publishTime = `${ts.substring(4, 6)}.${ts.substring(6, 8)}. ${ts.substring(8, 10)}:${ts.substring(10, 12)}`;

        // 본문 텍스트 추출
        let contentHtml = '';
        const patterns = [
            /<div class="cmp-view-content">([\s\S]*?)<\/div>\s*<\/section>/,
            /<div class="cmp-view-content">([\s\S]*?)<\/div>\s*<\/div>/,
            /<div class="cmp-view-content">([\s\S]*)<\/div>/,
        ];
        for (const p of patterns) {
            const m = html.match(p);
            if (m && m[1] && m[1].trim().length > 20) { contentHtml = m[1]; break; }
        }

        let rawText = contentHtml
            .replace(/<p[^>]*>/g, '\n').replace(/<\/p>/g, '\n').replace(/<br\s*\/?>/g, '\n')
            .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
            .replace(/[ ]+/g, ' ').trim();

        // 카테고리 추출
        const codeCategories = marineForecast.extractCategories(rawText);
        const hasContent = Object.keys(codeCategories).length > 0;

        // AI 분석
        let aiResult = null;
        const hasMarineKeywords = /강풍|바다\s*안개|해상|너울/.test(rawText);
        if (hasContent && hasMarineKeywords) {
            aiResult = await marineForecast.analyzeWithAI(rawText, codeCategories);
        }

        // 최종 카테고리 결정
        const finalCategories = (aiResult && aiResult.categories) ? aiResult.categories : (hasContent ? codeCategories : null);

        // 전망 타입 판별
        const isUltraShort = /초단기/.test(title || '');
        const typeLabel = isUltraShort ? '초단기전망' : '단기전망';

        const forecastData = {
            reportId, title: title || '', type: typeLabel,
            publishTime, forecastPeriod, rawText,
            codeCategories: hasContent ? codeCategories : null,
            aiResult, categories: finalCategories,
            hasContent: hasContent || !!(aiResult && aiResult.categories && Object.keys(aiResult.categories).length > 0)
        };

        // 캐시 저장
        marineForecast.saveForecastCache(reportId, forecastData);

        // marine_forecast.json도 갱신 (프론트 표출용)
        try {
            const dataFilePath = path.join(__dirname, '..', 'data', 'marine_forecast.json');
            let forecasts = { ultraShort: null, shortTerm: null, updatedAt: '' };
            if (fs.existsSync(dataFilePath)) {
                forecasts = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));
            }
            if (isUltraShort) {
                forecasts.ultraShort = forecastData;
            } else {
                forecasts.shortTerm = forecastData;
            }
            forecasts.updatedAt = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
            const dataDir = path.dirname(dataFilePath);
            if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
            fs.writeFileSync(dataFilePath, JSON.stringify(forecasts, null, 2), 'utf8');
        } catch (updateErr) {
            console.error('[Admin] marine_forecast.json 갱신 오류:', updateErr.message);
        }

        res.json({ success: true, data: forecastData });
    } catch (e) {
        console.error('[Admin] 전망 수집 오류:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
