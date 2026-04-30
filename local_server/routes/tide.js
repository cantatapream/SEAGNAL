/**
 * ============================================================================
 * 파일명: routes/tide.js
 * 역할: 조석(조위) 데이터 API 라우트
 * ============================================================================
 *
 * [설명]
 * 이 파일은 조석(밀물/썰물) 관련 데이터를 제공하는 API 엔드포인트를 관리합니다.
 * - GET /data/:filename → 조석 캐시 데이터 조회 (메모리 우선, 파일 폴백)
 * - POST /api/save_tide_input → 조석 데이터 수집 요청 (격자 캐싱 + 3일 패딩 분석)
 * - GET /api/tidebed/config → TideBED API 키 관리 현황 조회
 * - POST /api/tidebed/key → 새 API 키 등록
 * - DELETE /api/tidebed/key/:index → API 키 삭제
 *
 * [연계 파일]
 * - services/tide_collector.js → TideBED API 호출, 데이터 수집/분석 로직
 * - services/cache_manager.js → tideCache(LRU 캐시)에서 데이터 조회
 * - config/server_config.js → DATA_DIR, IS_FLY_IO 환경 설정
 * - server.js → app.use()로 이 라우터 등록
 *
 * [초보자를 위한 안내]
 * 조석 데이터는 공공데이터포털의 TideBED API에서 가져옵니다.
 * 사용자가 지도에서 특정 위치를 클릭하면, 해당 위치의 위도/경도로
 * 3일치(전일/당일/익일) 조석 예측 데이터를 수집하고,
 * 고조(만조)와 저조(간조) 시각을 자동으로 분석합니다.
 * 이미 수집된 데이터는 메모리 캐시에 보관하여 빠르게 응답합니다.
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch'); // 서버→서버 HTTP 요청용 (Kakao REST API 호출에 사용)
// IS_FLY_IO 는 디스크 캐시 분기에 사용되었으나 디스크 캐시 제거로 미사용 → import 에서 제외.
const { DATA_DIR, FILES } = require('../config/server_config');
const { tideCache } = require('../services/cache_manager');
const tideCollector = require('../services/tide_collector');

// ============================================================================
// 조석 조회 횟수 제한 (동일 사용자 15회/일)
// ============================================================================
const TIDE_DAILY_LIMIT = 15;

function getTideUsage() {
    try {
        if (fs.existsSync(FILES.TIDE_USAGE)) {
            return JSON.parse(fs.readFileSync(FILES.TIDE_USAGE, 'utf8'));
        }
    } catch (e) { /* 무시 */ }
    return {};
}

function saveTideUsage(usage) {
    fs.writeFileSync(FILES.TIDE_USAGE, JSON.stringify(usage, null, 2), 'utf8');
}

function getTodayKST() {
    const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return now.toISOString().slice(0, 10);
}

function checkTideRateLimit(deviceId) {
    if (!deviceId) return { allowed: true };

    const today = getTodayKST();
    const usage = getTideUsage();

    if (!usage[today]) usage[today] = {};
    const count = usage[today][deviceId] || 0;

    if (count >= TIDE_DAILY_LIMIT) {
        // 차단 관리에 자동 등록
        try {
            const blocksPath = FILES.BLOCKS;
            let blocks = { reportBlocks: [], tideBlocks: [], appBlocks: [] };
            if (fs.existsSync(blocksPath)) {
                blocks = JSON.parse(fs.readFileSync(blocksPath, 'utf8'));
            }
            const existing = blocks.tideBlocks.find(b => b.deviceId === deviceId);
            if (!existing) {
                const endOfDay = new Date(Date.now() + 9 * 60 * 60 * 1000);
                endOfDay.setHours(23, 59, 59, 999);
                blocks.tideBlocks.push({
                    deviceId,
                    reason: '과도 조회 (자동)',
                    duration: '1d',
                    blockedAt: new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString(),
                    until: endOfDay.toISOString(),
                    dailyCount: count + 1
                });
                fs.writeFileSync(blocksPath, JSON.stringify(blocks, null, 2), 'utf8');
                console.log(`🚫 [Tide] 조석 조회 제한 초과: ${deviceId} (${count + 1}회)`);
            }
        } catch (e) {
            console.error('[Tide] 차단 등록 오류:', e.message);
        }
        return { allowed: false, count };
    }

    // 카운트 증가
    usage[today][deviceId] = count + 1;
    saveTideUsage(usage);
    return { allowed: true, count: count + 1 };
}

// ============================================================================
// 조석 캐시 데이터 조회 (메모리 → 파일 폴백)
// ============================================================================
router.get('/data/:filename', (req, res, next) => {
    const filename = req.params.filename;

    // 1. 메모리 캐시에 데이터가 있으면 즉시 반환
    if (tideCache.has(filename)) {
        return res.json(tideCache.get(filename));
    }

    // 2. 없으면 다음 미들웨어(static file handler)로 넘김
    next();
});

// ============================================================================
// 조석 데이터 수집 요청 (격자 캐싱 + 3일 패딩 분석)
// ============================================================================
router.post('/api/save_tide_input', async (req, res) => {
    const { date, time, lat, lon, deviceId } = req.body;

    // 조석 조회 횟수 제한 체크
    if (deviceId) {
        const rateCheck = checkTideRateLimit(deviceId);
        if (!rateCheck.allowed) {
            return res.status(429).json({
                success: false,
                error: '일일 조석 조회 횟수(15회)를 초과했습니다. 자정에 초기화됩니다.',
                dailyCount: rateCheck.count
            });
        }
    }

    console.log(`📡 Tide Input Received: Date=${date}, Time=${time}, Lat=${lat}, Lon=${lon}`);

    try {
        // 1단계: 격자 해시 조회 (1건 사전 조회)
        const gridHash = await tideCollector.getGridHash(lat, lon, date);
        if (!gridHash) {
            console.error('❌ 격자 해시를 확인할 수 없습니다.');
            res.json({ success: false, error: 'Grid hash unavailable' });
            return;
        }

        const adj = tideCollector.getAdjacentDates(date);
        console.log(`📅 격자: ${gridHash}, 날짜: 전일=${adj.prev}, 당일=${adj.current}, 익일=${adj.next}`);

        // 2단계: 3일치 파일명 결정 및 캐시 확인
        const datePairs = [
            { key: 'yesterday', date: adj.prev },
            { key: 'today', date: adj.current },
            { key: 'tomorrow', date: adj.next }
        ];

        const fileMap = {};
        const toCollect = [];

        for (const pair of datePairs) {
            const fileName = `tide_${pair.date}_${gridHash}.json`;
            // (디스크 캐시 제거로 filePath 미사용 — fileName 만 메모리 캐시 키 + 클라이언트 폴링 식별자로 사용)
            fileMap[pair.key] = fileName;

            let cached = false;

            // [캐시 확인] 메모리 캐시(tideCache LRU)만 사용.
            //   디스크 파일 캐시는 제거됨 — 사용자가 매번 다른 위치를 클릭하므로
            //   디스크 캐시 적중률이 낮고 파일이 누적되는 부담이 더 컸음.
            //   메모리 캐시는 같은 사용자 / 동일 격자 재클릭 시 빠른 응답 보장.
            if (tideCache.has(fileName)) {
                cached = true;
            }

            if (!cached) {
                toCollect.push({ key: pair.key, date: pair.date, fileName });
            }
        }

        console.log(`📦 캐시 히트: ${3 - toCollect.length}건, 수집 필요: ${toCollect.length}건`);

        // 3단계: collecting 상태 초기화 (메모리 캐시에만 — 디스크 저장 제거됨)
        for (const item of toCollect) {
            const initData = {
                requestDate: item.date,
                requestTime: time,
                latitude: lat,
                longitude: lon,
                timestamp: new Date().toISOString(),
                tideBedStatus: 'collecting...',
                tideBedData: []
            };

            // 메모리 캐시(tideCache LRU)에만 저장. 디스크 파일 저장 제거.
            tideCache.set(item.fileName, initData);
        }

        // 클라이언트에 즉시 응답 (격자 해시 + 파일명 포함)
        res.json({
            success: true,
            gridHash,
            files: fileMap,
            cached: 3 - toCollect.length,
            collecting: toCollect.length
        });

        // 4단계: 백그라운드에서 필요한 날짜만 수집 (Padding Analysis)
        // ── today 우선 수집 전략 ────────────────────────────────────
        // 사용자 체감 개선을 위해 today raw 와 today 패딩 분석을 우선 직렬화.
        // 이웃(yesterday/tomorrow) 미도착 상태의 today 분석은 padding 0 으로
        // 진행 (대부분 시간대 피크는 정확. 새벽/심야 첫·마지막 피크만 약간 차이).
        // → today 'complete' 가 ~1초 안에 도착 → 클라이언트 즉시 4피크 표시.
        // yesterday/tomorrow 는 백그라운드로 진행 → 도착 시 게이지 그려짐.
        (async () => {
            try {
                const allNeededDays = [adj.prev, adj.current, adj.next];
                const rawItemsMap = {};

                // 캐시 안에 이미 있는 raw 는 즉시 채워 놓고 시작
                for (const dayValue of allNeededDays) {
                    const fname = `tide_${dayValue}_${gridHash}.json`;
                    // 메모리 캐시(tideCache)만 확인. 디스크 캐시 제거됨 (main 정책).
                    if (tideCache.has(fname) && tideCache.get(fname).tideBedStatus === 'complete') {
                        rawItemsMap[dayValue] = tideCache.get(fname).tideBedData;
                    }
                }

                // 단일 날짜 raw 확보 헬퍼 (캐시 없으면 KHOA API 호출)
                async function ensureRaw(dayValue) {
                    if (rawItemsMap[dayValue]) return;
                    rawItemsMap[dayValue] = await tideCollector.collectTideBedData(lat, lon, String(dayValue));
                }

                // 단일 날짜 패딩 분석 + 'complete' 저장 헬퍼
                async function analyzeAndSave(item) {
                    const dateInt = item.date;
                    const itemAdj = tideCollector.getAdjacentDates(dateInt);
                    // 이웃 raw 가 없으면 빈 배열 → padding 0 으로 단독 분석
                    const paddedItems = [
                        ...(rawItemsMap[itemAdj.prev] || []).slice(-180),
                        ...(rawItemsMap[dateInt] || []),
                        ...(rawItemsMap[itemAdj.next] || []).slice(0, 180)
                    ];
                    await tideCollector.collectAndSaveTideData(lat, lon, dateInt, time, item.fileName, paddedItems);
                }

                // ── ① today 우선 (직렬) ──────────────────────────────
                const todayItem = toCollect.find(it => it.date === adj.current);
                if (todayItem) {
                    await ensureRaw(adj.current);    // today raw
                    await analyzeAndSave(todayItem); // padding 없이 단독 분석 → 'complete'
                    console.log(`⚡ [Quick] today(${adj.current}) 우선 분석 완료 — 클라이언트 즉시 사용 가능`);
                }

                // ── ② 이웃(yesterday/tomorrow) 병렬, 백그라운드 ─────
                const neighborItems = toCollect.filter(it => it.date !== adj.current);
                const neighborDays = [adj.prev, adj.next].filter(d => !rawItemsMap[d]);
                Promise.all(neighborDays.map(ensureRaw))
                    .then(() => Promise.all(neighborItems.map(analyzeAndSave)))
                    .then(() => {
                        console.log(`🎉 [Padding Analysis] 이웃 ${neighborItems.length}일치 분석 완료`);
                    })
                    .catch(err => console.error('❌ 이웃 백그라운드 수집 오류:', err.message));
            } catch (err) {
                console.error('❌ 백그라운드 수집 오류:', err.message);
            }
        })();

    } catch (e) {
        console.error('Failed to save tide input:', e);
        res.status(500).json({ error: 'Failed to save data' });
    }
});

// ============================================================================
// TideBED API 키 관리 엔드포인트
// ============================================================================

// 키 현황 조회
router.get('/api/tidebed/config', (req, res) => {
    const config = tideCollector.tideBedConfig;
    res.json({
        currentIndex: config.currentIndex,
        keys: config.keys.map((k, i) => ({
            id: i + 1,
            fullKey: k.key,
            used: k.used || 0,
            expiry: k.expiry || '-',
            owner: k.owner || '-'
        })),
        totalLimit: config.keys.length * 10000,
        totalUsed: config.keys.reduce((acc, k) => acc + (k.used || 0), 0)
    });
});

// 새 키 등록
router.post('/api/tidebed/key', (req, res) => {
    const { key, expiry, owner } = req.body;
    const config = tideCollector.tideBedConfig;
    if (!key) return res.status(400).json({ error: '인증키가 없습니다.' });

    if (config.keys.some(k => k.key === key)) {
        return res.status(400).json({ error: '이미 등록된 인증키입니다.' });
    }

    config.keys.push({ key, used: 0, expiry: expiry || '-', owner: owner || '-' });
    tideCollector.saveTideBedConfig();
    res.json({ success: true, count: config.keys.length });
});

// 키 삭제
router.delete('/api/tidebed/key/:index', (req, res) => {
    const index = parseInt(req.params.index);
    const config = tideCollector.tideBedConfig;
    if (isNaN(index) || index < 0 || index >= config.keys.length) {
        return res.status(400).json({ error: '잘못된 인덱스입니다.' });
    }

    if (config.keys.length <= 1) {
        return res.status(400).json({ error: '최소 하나 이상의 키가 필요합니다.' });
    }

    config.keys.splice(index, 1);
    if (config.currentIndex >= index && config.currentIndex > 0) {
        config.currentIndex--;
    }
    tideCollector.saveTideBedConfig();
    res.json({ success: true });
});

// ============================================================================
// 위치 검색 프록시 (Kakao 로컬 키워드 검색 REST API)
// ============================================================================
// [역할]
// 클라이언트(브라우저)가 직접 Kakao API를 호출하면 도메인 인증 실패로 막힙니다.
// 이 엔드포인트가 중간에서 대신 Kakao에 요청하고 결과만 클라이언트에 전달합니다.
// REST API 키는 환경변수(KAKAO_REST_API_KEY)로 관리하여 소스코드에 노출되지 않습니다.
//
// [요청]  GET /api/search-place?q=속초항
// [응답]  { documents: [ { place_name, address_name, x, y }, ... ] }
// ============================================================================
router.get('/api/search-place', async (req, res) => {
    // 검색어 유효성 검사 (2글자 미만 거부)
    const query = (req.query.q || '').trim();
    if (query.length < 2) {
        return res.status(400).json({ error: '검색어를 2글자 이상 입력해주세요.' });
    }

    // 환경변수에서 Kakao REST API 키 읽기
    const apiKey = process.env.KAKAO_REST_API_KEY;
    if (!apiKey) {
        console.warn('[search-place] KAKAO_REST_API_KEY 환경변수가 설정되지 않았습니다.');
        return res.status(503).json({ error: '검색 서비스가 설정되어 있지 않습니다.' });
    }

    try {
        // Kakao 키워드 장소 검색 API 호출 (최대 7개 결과)
        const kakaoUrl = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&size=7`;
        const kakaoRes = await fetch(kakaoUrl, {
            headers: { Authorization: `KakaoAK ${apiKey}` }
        });

        if (!kakaoRes.ok) {
            console.error(`[search-place] Kakao API 오류: ${kakaoRes.status}`);
            return res.status(502).json({ error: 'Kakao 검색 API 오류가 발생했습니다.' });
        }

        const data = await kakaoRes.json();
        // 필요한 필드만 추려서 반환 (place_name, address_name, x=경도, y=위도)
        const results = (data.documents || []).map(d => ({
            place_name:   d.place_name,
            address_name: d.address_name,
            x: d.x, // 경도
            y: d.y  // 위도
        }));
        res.json({ documents: results });

    } catch (err) {
        console.error('[search-place] 서버 오류:', err.message);
        res.status(500).json({ error: '검색 중 서버 오류가 발생했습니다.' });
    }
});

// 일일 조석 조회 카운트 리셋 (자정에 호출)
function resetDailyTideUsage() {
    const today = getTodayKST();
    const usage = getTideUsage();
    // 오늘 이전 날짜 데이터 삭제
    Object.keys(usage).forEach(date => {
        if (date < today) delete usage[date];
    });
    saveTideUsage(usage);
    console.log('🔄 [Tide] 일일 조석 조회 카운트 정리 완료');
}

module.exports = router;
module.exports.resetDailyTideUsage = resetDailyTideUsage;
