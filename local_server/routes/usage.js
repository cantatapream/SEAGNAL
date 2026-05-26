/**
 * ============================================================================
 * 파일명: routes/usage.js
 * 역할: 사용량 통계(Usage Analytics) 수집/조회 API
 * ============================================================================
 *
 * [설명]
 *   - POST /api/usage         → 클라이언트가 기능 사용을 보고(단건/다건). 즉시 200.
 *   - GET  /api/stats/usage   → 관리자 대시보드용 집계 조회 (일/월/연 + 소속별).
 *
 * [소속 소급 재분류]
 *   사용량은 services/usage_queue.js 에 deviceId 단위로만 저장된다(소속 미저장).
 *   조회 시점에 설문(data/surveys.json + survey_responses_*.json)에서
 *   "소속" 질문 응답을 읽어 deviceId → 소속 매핑을 만들고, 소속별로 합산한다.
 *   → 나중에 설문에 답하면 과거 사용 기록까지 자동으로 새 소속으로 재분류됨.
 *
 * [연계 파일]
 *   - services/usage_queue.js  → 메모리 큐 + 5초 비동기 flush
 *   - config/server_config.js  → DATA_DIR
 *   - server.js                → app.use(require('./routes/usage'))
 *   - js/utils.js              → window.trackUsage / trackUsageMany 가 POST /api/usage 호출
 *   - js/admin_collect.js      → renderUsageStatsContent() 가 GET /api/stats/usage 호출
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/server_config');
const usageQueue = require('../services/usage_queue');

// 서버 부팅 시 1회: 디스크에서 초기 상태 로드 + 5초 flush 타이머 시작 (idempotent).
usageQueue.init();

// ============================================================================
// 소속 카테고리 (표시 순서 우선; 실제 응답값에서 동적 도출하되 아래 순서 우선)
// ============================================================================
const AFFILIATION_ORDER = [
    '해양경찰',
    '어업종사자',
    '레저스포츠 활동자',
    '해양수산부',
    '해군',
    '지방자치단체',
    '공공기관',
    '기타(낚시객 등)',
    '소속 미정'
];
const UNASSIGNED = '소속 미정';

// ============================================================================
// deviceId → 소속 매핑 (설문 응답 기반, 조회 시점 계산 + 수 분 TTL 캐시)
// ============================================================================
let _affCache = null;       // { map: {deviceId: 소속}, builtAt: ms }
const AFF_CACHE_TTL_MS = 3 * 60 * 1000; // 3분

function _safeReadJson(filePath, fallback) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) { /* 무시 */ }
    return fallback;
}

/**
 * 설문에서 "소속" 질문을 찾아 deviceId → 소속 매핑을 만든다.
 * 여러 설문에 소속 문항이 있으면 모두 훑되, 최신 응답이 이긴다(submittedAt/responseId 기준).
 *
 * @returns {Object} { [deviceId]: 소속문자열 }
 */
function buildAffiliationMap() {
    const now = Date.now();
    if (_affCache && (now - _affCache.builtAt) < AFF_CACHE_TTL_MS) {
        return _affCache.map;
    }

    const map = {};
    try {
        const surveys = _safeReadJson(path.join(DATA_DIR, 'surveys.json'), []);
        if (Array.isArray(surveys)) {
            surveys.forEach(survey => {
                const questions = (survey && survey.questions) || [];
                // 질문 제목에 "소속" 포함된 문항(qId) 수집
                const affQids = questions
                    .filter(q => q && typeof q.title === 'string' && q.title.indexOf('소속') !== -1)
                    .map(q => q.qId);
                if (!affQids.length) return;

                const responses = _safeReadJson(
                    path.join(DATA_DIR, `survey_responses_${survey.id}.json`), []
                );
                if (!Array.isArray(responses)) return;

                // 최신 응답이 이기도록 시간순(오래된→최신) 정렬
                const sorted = responses.slice().sort(
                    (a, b) => (a.responseId || 0) - (b.responseId || 0)
                );
                sorted.forEach(r => {
                    if (!r || !r.deviceId || !r.answers) return;
                    for (let i = 0; i < affQids.length; i++) {
                        let ans = r.answers[affQids[i]];
                        if (Array.isArray(ans)) ans = ans[0]; // 단일선택형이지만 배열일 수 있음
                        if (ans !== undefined && ans !== null && String(ans).trim() !== '') {
                            map[r.deviceId] = String(ans).trim();
                        }
                    }
                });
            });
        }
    } catch (e) {
        console.error('[usage] 소속 매핑 생성 실패:', e && e.message);
    }

    _affCache = { map, builtAt: now };
    return map;
}

/** 응답값을 표준 카테고리로 정규화 (정확히 일치하지 않으면 그대로 두되, 미정만 통일) */
function normalizeAffiliation(value) {
    if (value === undefined || value === null || String(value).trim() === '') return UNASSIGNED;
    return String(value).trim();
}

// ============================================================================
// POST /api/usage  — 수집 (단건/다건)
// ============================================================================
/**
 * body: { deviceId, feature } 또는 { deviceId, features: [...] }
 * 서버가 수신 시각으로 KST 날짜를 계산해 usageQueue 에 누적. 200 즉시 응답.
 */
router.post('/api/usage', (req, res) => {
    try {
        const body = req.body || {};
        const deviceId = body.deviceId || 'anonymous';
        const now = new Date();
        const kstDate = new Date(now.getTime() + (9 * 60 * 60 * 1000));

        if (Array.isArray(body.features) && body.features.length) {
            usageQueue.applyUsageMany({ deviceId, features: body.features, kstDate });
        } else if (body.feature) {
            usageQueue.applyUsage({ deviceId, feature: body.feature, kstDate });
        }
        // 잘못된 본문이어도 클라이언트 동작에 영향 주지 않도록 항상 200.
        res.json({ ok: true });
    } catch (e) {
        // fire-and-forget 클라이언트와 짝을 맞추되, 서버 로그만 남김.
        console.error('[usage] 수집 실패:', e && e.message);
        res.json({ ok: false });
    }
});

// ============================================================================
// GET /api/stats/usage  — 조회 (집계)
// ============================================================================
/**
 * 쿼리:
 *   period      = daily | monthly | yearly  (기본 daily)
 *   start, end  = YYYY-MM-DD (없으면 전체 범위)
 *   affiliation = 소속명 (없거나 '전체'면 전체)
 *
 * 응답:
 *   {
 *     period, start, end, affiliation,
 *     affiliationOrder: [...],            // 표시 순서
 *     trend: [{ bucket, total }],         // 기간 추이 (선택 소속 기준)
 *     byAffiliation: { 소속: total },     // 소속 분포(도넛)
 *     byFeature: { featureKey: total },   // 기능별 누적(선택 소속 기준)
 *     totalEvents,                        // 총 정보제공 건수(선택 소속 기준)
 *     topFeature: { key, count },         // 최다 기능
 *     deviceCount, assignedDeviceCount, unassignedDeviceCount
 *   }
 */
router.get('/api/stats/usage', (req, res) => {
    try {
        const period = ['daily', 'monthly', 'yearly'].indexOf(req.query.period) !== -1
            ? req.query.period : 'daily';
        const start = req.query.start || '';
        const end = req.query.end || '';
        const affFilter = (req.query.affiliation && req.query.affiliation !== '전체')
            ? req.query.affiliation : null;

        const snapshot = usageQueue.getStatsSnapshot();   // { date: { deviceId: { feature: count } } }
        const affMap = buildAffiliationMap();             // { deviceId: 소속 }

        // ── 집계 누적기 ──
        const trendMap = {};          // bucket -> total (선택 소속 기준)
        const byAffiliation = {};     // 소속 -> total (선택 날짜범위 적용, 소속 필터는 미적용)
        const byFeature = {};         // feature -> total (선택 소속 기준)
        let totalEvents = 0;          // 선택 소속 기준 총 건수
        const deviceSet = {};         // 등장 deviceId 집합 (날짜필터 적용)

        function bucketOf(dateStr) {
            if (period === 'monthly') return dateStr.substring(0, 7);   // YYYY-MM
            if (period === 'yearly') return dateStr.substring(0, 4);    // YYYY
            return dateStr;                                             // YYYY-MM-DD
        }

        Object.keys(snapshot).forEach(dateStr => {
            if (start && dateStr < start) return;
            if (end && dateStr > end) return;
            const byDevice = snapshot[dateStr] || {};
            const bucket = bucketOf(dateStr);

            Object.keys(byDevice).forEach(deviceId => {
                const aff = normalizeAffiliation(affMap[deviceId]);
                deviceSet[deviceId] = aff;
                const features = byDevice[deviceId] || {};

                let deviceTotal = 0;
                Object.keys(features).forEach(fk => {
                    deviceTotal += features[fk] || 0;
                });

                // 소속 분포(도넛)는 항상 전체(필터 미적용 분포)로 집계
                byAffiliation[aff] = (byAffiliation[aff] || 0) + deviceTotal;

                // 선택 소속 필터: 추이/기능별/총건수는 필터 적용
                if (affFilter && aff !== affFilter) return;

                trendMap[bucket] = (trendMap[bucket] || 0) + deviceTotal;
                totalEvents += deviceTotal;
                Object.keys(features).forEach(fk => {
                    byFeature[fk] = (byFeature[fk] || 0) + (features[fk] || 0);
                });
            });
        });

        // 추이를 bucket 오름차순 배열로
        const trend = Object.keys(trendMap).sort().map(b => ({ bucket: b, total: trendMap[b] }));

        // 최다 기능
        let topFeature = { key: null, count: 0 };
        Object.keys(byFeature).forEach(fk => {
            if (byFeature[fk] > topFeature.count) topFeature = { key: fk, count: byFeature[fk] };
        });

        // 소속 분포를 표시 순서로 정렬한 배열도 함께 제공
        const affKeys = Object.keys(byAffiliation);
        affKeys.sort((a, b) => {
            const ia = AFFILIATION_ORDER.indexOf(a);
            const ib = AFFILIATION_ORDER.indexOf(b);
            const oa = ia === -1 ? AFFILIATION_ORDER.length : ia;
            const ob = ib === -1 ? AFFILIATION_ORDER.length : ib;
            if (oa !== ob) return oa - ob;
            return a.localeCompare(b);
        });
        const affiliationDistribution = affKeys.map(k => ({ name: k, total: byAffiliation[k] }));

        // 기기 수 통계 (날짜필터 범위 내 등장 기기 기준)
        let assignedDeviceCount = 0;
        let unassignedDeviceCount = 0;
        Object.keys(deviceSet).forEach(d => {
            if (deviceSet[d] === UNASSIGNED) unassignedDeviceCount++;
            else assignedDeviceCount++;
        });

        res.json({
            period,
            start,
            end,
            affiliation: affFilter || '전체',
            affiliationOrder: AFFILIATION_ORDER,
            trend,
            byAffiliation,
            affiliationDistribution,
            byFeature,
            totalEvents,
            topFeature,
            deviceCount: Object.keys(deviceSet).length,
            assignedDeviceCount,
            unassignedDeviceCount
        });
    } catch (e) {
        console.error('[usage] 조회 실패:', e && e.message);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
