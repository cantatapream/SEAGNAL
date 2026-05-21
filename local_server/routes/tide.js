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

/** 조석 검색 사용량(deviceId 별 일일 카운트) 을 FILES.TIDE_USAGE 에 동기 저장. */
function saveTideUsage(usage) {
    fs.writeFileSync(FILES.TIDE_USAGE, JSON.stringify(usage, null, 2), 'utf8');
}

/** 현재 KST 일자 'YYYY-MM-DD' 반환. checkTideRateLimit 의 일일 키. */
function getTodayKST() {
    const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return now.toISOString().slice(0, 10);
}

/**
 * 조석 검색 일일 호출 한도(TIDE_DAILY_LIMIT) 검사 — 디바이스 단위 rate limit.
 *
 * [동작]
 *   - usage[YYYY-MM-DD][deviceId] 카운터 사용
 *   - 한도 초과 시 자동으로 FILES.BLOCKS 에 tideBlocks 항목 추가 (자동 차단)
 *   - 미초과면 카운터 +1 후 { allowed: true }
 *
 * @param {string} deviceId - 클라이언트 디바이스 식별자 (없으면 free pass)
 * @returns {{allowed: boolean, reason?: string}}
 */
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
    // ❹ 클라이언트 격자ID 캐시 — body 에 동봉되어 오면 KHOA 사전 조회 1회 절감.
    // 잘못된 값을 보내도 후속 KHOA 호출이 그 격자에서 실패할 뿐 다른 사용자에 영향 없음.
    const clientGridHash = req.body && req.body.gridHash ? String(req.body.gridHash) : null;

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
        // ❹ 클라이언트가 caching 한 gridHash 를 보내왔다면 KHOA 사전 조회 skip.
        let gridHash;
        let gridHashRefreshed = false; // 클라이언트 캐시 무효 감지 → 자동 갱신 시 true
        if (clientGridHash) {
            gridHash = clientGridHash;
            console.log(`⚡ 클라이언트 격자 캐시 사용: ${gridHash} (KHOA 사전 조회 skip)`);
        } else {
            gridHash = await tideCollector.getGridHash(lat, lon, date);
        }
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

        const computeFiles = () => {
            const fileMap = {};
            const toCollect = [];
            for (const pair of datePairs) {
                const fileName = `tide_${pair.date}_${gridHash}.json`;
                fileMap[pair.key] = fileName;
                // [캐시 확인] 메모리 캐시(tideCache LRU)만 사용.
                //   디스크 파일 캐시는 제거됨 — 사용자가 매번 다른 위치를 클릭하므로
                //   디스크 캐시 적중률이 낮고 파일이 누적되는 부담이 더 컸음.
                //   메모리 캐시는 같은 사용자 / 동일 격자 재클릭 시 빠른 응답 보장.
                if (!tideCache.has(fileName)) {
                    toCollect.push({ key: pair.key, date: pair.date, fileName });
                }
            }
            return { fileMap, toCollect };
        };

        let { fileMap, toCollect } = computeFiles();

        // ❹+ 클라이언트 gridHash 자동 invalidate
        //   클라이언트가 동봉한 gridHash 가 더 이상 유효하지 않을 때
        //   (KHOA 격자 정책 변경 / 더 정확한 격자 분할 등) 클라이언트 localStorage 의
        //   잘못된 gridHash 가 영구히 남아 같은 좌표 클릭 시 매번 실패가 발생하는 문제 방지.
        //
        //   전략: clientGridHash 가 있어도 모든 파일이 cache MISS 면 (= 새 수집 필요)
        //         서버가 직접 getGridHash 를 1회 호출해 검증. 결과가 다르면 fresh 값으로
        //         교체하고 응답에 gridHashRefreshed:true + 새 gridHash 동봉.
        //         클라이언트는 이 값을 받아 localStorage 갱신 (또는 invalidGridHash:true
        //         로도 같은 효과 — 본 구현은 자동 복구 방식 채택).
        //   비용: cache hit 면 검증 skip (즐겨찾기 재방문 fast path 100% 보존).
        //         cache miss 면 어차피 collectTideBedData 가 KHOA 5페이지 호출하므로
        //         추가 1회 (numOfRows=1) 는 무시할만한 추가 비용.
        if (clientGridHash && toCollect.length === datePairs.length) {
            try {
                const verified = await tideCollector.getGridHash(lat, lon, date);
                if (verified && verified !== clientGridHash) {
                    console.warn(`♻️ clientGridHash 불일치 감지: ${clientGridHash} → ${verified} (자동 갱신)`);
                    gridHash = verified;
                    gridHashRefreshed = true;
                    ({ fileMap, toCollect } = computeFiles());
                } else if (!verified) {
                    // 검증 결과 자체가 실패 — 단순 KHOA 일시 장애일 수 있으니 기존 값 유지.
                    console.warn(`⚠️ clientGridHash 검증 실패 (KHOA 응답 없음). 기존값 유지.`);
                }
            } catch (e) {
                console.warn(`⚠️ clientGridHash 검증 중 예외: ${e.message}`);
            }
        }

        // [boundary 최적화 2026-05]
        //   기존 캐시 entry 가 loadedPages.length < 5 (boundary 만 받은 부분 캐시) 인데
        //   슬라이더가 그 날을 직접 조회하는 시점 (= 그 날이 current 로 들어오는 시점)
        //   에는 전체 5페이지 fetch 가 필요. 따라서 partial 캐시는 "재수집 대상" 으로
        //   재분류 → toCollect 에 강제 포함.
        //   neighbor 위치(prev/next) 로 다시 들어왔을 때는 이미 boundary peak 가 잡힌
        //   상태라 추가 호출 없이 그대로 사용 → 호출 절감 효과 보존.
        for (const pair of datePairs) {
            const fileName = `tide_${pair.date}_${gridHash}.json`;
            const cached = tideCache.get(fileName);
            if (!cached) continue;
            const lp = cached.loadedPages;
            const isPartial = Array.isArray(lp) && lp.length < 5;
            // 슬라이더가 이 날을 직접 조회 (= current) 인 경우만 강제 재수집
            if (isPartial && pair.key === 'today' && !toCollect.find(t => t.fileName === fileName)) {
                console.log(`♻️ ${fileName}: 부분 캐시(loadedPages=[${lp.join(',')}]) — 슬라이더 직접 조회 → 전체 재수집`);
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
        // gridHashRefreshed:true 인 경우 클라이언트는 localStorage gridHashCache:v1 의
        // 해당 좌표 항목을 새 gridHash 로 갱신해야 함 (ocean_bottom_sheet3.js 참조).
        res.json({
            success: true,
            gridHash,
            gridHashRefreshed,
            files: fileMap,
            cached: 3 - toCollect.length,
            collecting: toCollect.length
        });

        // 4단계: 백그라운드에서 필요한 날짜만 수집 (Padding Analysis)
        // ── boundary 최적화 (2026-05) ──────────────────────────────────
        //   변경 전: 어제 5페이지 + 오늘 5페이지 + 내일 5페이지 = 15 페이지 동시 호출.
        //            TideBED 부하 ↑ → UNKNOWN_ERROR 빈발 → 평균 latency 10~14초.
        //   변경 후: ① 1차 — today 5페이지 + yesterday Page 5 + tomorrow Page 1 = 7페이지 병렬
        //            ② today raw 도착 → 첫·마지막 peak 의 minutes 추출
        //            ③ M2 반주기 372분(6h12m) 기반 boundary 추정 → 어제/내일 누락 페이지 결정
        //            ④ 누락 페이지 추가 호출 (대부분 0~2 페이지)
        //            ⑤ today 'complete-quick' → 이웃 분석 → today 'complete' 재분석
        //   클라이언트 폴링/상태 인터페이스 100% 호환 (status 'complete-quick'/'complete'/'error').
        //
        //   어제/내일은 ocean_bottom_sheet3.js:731-743 / interpolateLevel(line 1203) 이
        //   yPeaks.last() / tPeaks.first() 1개씩만 사용 → boundary 부근 페이지만 받아도 됨.
        (async () => {
            try {
                const allNeededDays = [adj.prev, adj.current, adj.next];
                const rawItemsMap = {};       // day → items array
                const loadedPagesMap = {};    // day → Set of loaded page numbers

                // 캐시 안에 이미 complete 으로 있는 raw 는 즉시 채워 놓고 시작.
                //   loadedPages 가 명시되어 있으면 그대로, 명시 없으면 (boundary
                //   최적화 도입 이전 캐시 = legacy 'complete') 5페이지 모두 로드된
                //   것으로 간주 → 불필요한 재 fetch 차단.
                for (const dayValue of allNeededDays) {
                    const fname = `tide_${dayValue}_${gridHash}.json`;
                    const cached = tideCache.has(fname) ? tideCache.get(fname) : null;
                    if (cached && cached.tideBedStatus === 'complete') {
                        rawItemsMap[dayValue] = cached.tideBedData || [];
                        loadedPagesMap[dayValue] = new Set(
                            Array.isArray(cached.loadedPages) ? cached.loadedPages : [1, 2, 3, 4, 5]
                        );
                    }
                }

                // ── 페이지 시간대 매핑 ────────────────────────────────
                // Page1: 0..299, Page2: 300..599, Page3: 600..899, Page4: 900..1199, Page5: 1200..1439
                const PAGE_BOUNDARY_MARGIN = 30; // ±30분 마진
                const PAGE_BOUNDARIES = [300, 600, 900, 1200]; // 페이지 사이 경계 분
                function pagesForMinute(minute) {
                    if (minute < 0) minute = 0;
                    if (minute > 1439) minute = 1439;
                    const basePage = Math.min(5, Math.floor(minute / 300) + 1);
                    const set = new Set([basePage]);
                    for (let i = 0; i < PAGE_BOUNDARIES.length; i++) {
                        const b = PAGE_BOUNDARIES[i];
                        if (Math.abs(minute - b) <= PAGE_BOUNDARY_MARGIN) {
                            // boundary 좌(=i+1) / 우(=i+2) 두 페이지 모두 포함
                            set.add(i + 1);
                            set.add(i + 2);
                        }
                    }
                    return [...set].filter(p => p >= 1 && p <= 5);
                }

                // peak 의 분(minutes) 추출 — peak_finder 반환 형식의 time 필드 ('YYYY-MM-DD HH:MM' 또는 'HH:MM')
                function peakTimeToMinutes(peakObj) {
                    if (!peakObj || !peakObj.time) return null;
                    const s = String(peakObj.time);
                    const m = s.match(/(\d{1,2}):(\d{2})/);
                    if (!m) return null;
                    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
                }

                // 단일 페이지 셀렉터로 raw 확보 (race 안전 — 진행중 Promise 캐시)
                const _pageFetchPromise = {}; // key: `${day}|${page}` → Promise
                async function fetchPagesForDay(dayValue, pages) {
                    const todo = pages.filter(p => !(loadedPagesMap[dayValue] && loadedPagesMap[dayValue].has(p)));
                    if (todo.length === 0) return;
                    // 진행중 중복 fetch 방지 — 페이지 단위로 dedup
                    const dedup = todo.filter(p => !_pageFetchPromise[`${dayValue}|${p}`]);
                    const reuse = todo.filter(p => _pageFetchPromise[`${dayValue}|${p}`]);
                    let promise;
                    if (dedup.length > 0) {
                        promise = tideCollector
                            .collectTideBedPages(lat, lon, String(dayValue), dedup)
                            .then(({ items, loadedPages }) => {
                                if (!rawItemsMap[dayValue]) rawItemsMap[dayValue] = [];
                                if (!loadedPagesMap[dayValue]) loadedPagesMap[dayValue] = new Set();
                                rawItemsMap[dayValue] = rawItemsMap[dayValue].concat(items || []);
                                (loadedPages || []).forEach(p => loadedPagesMap[dayValue].add(p));
                            });
                        dedup.forEach(p => { _pageFetchPromise[`${dayValue}|${p}`] = promise; });
                    }
                    // 진행중 페이지 promise 도 같이 await
                    const awaits = reuse.map(p => _pageFetchPromise[`${dayValue}|${p}`]);
                    if (promise) awaits.push(promise);
                    await Promise.all(awaits);
                }

                async function analyzeAndSave(item, opts) {
                    opts = opts || {};
                    const dateInt = item.date;
                    const itemAdj = tideCollector.getAdjacentDates(dateInt);
                    // ❸ padding 12h 확대 (3h → 12h, 180 → 720) — 자정 ±12h 피크 detect 가능
                    const paddedItems = [
                        ...(rawItemsMap[itemAdj.prev] || []).slice(-720),
                        ...(rawItemsMap[dateInt] || []),
                        ...(rawItemsMap[itemAdj.next] || []).slice(0, 720)
                    ];
                    const isNeighbor = (dateInt === adj.prev || dateInt === adj.next);
                    const lpSet = loadedPagesMap[dateInt];
                    const loadedPagesArr = lpSet ? [...lpSet].sort((a, b) => a - b) : null;
                    await tideCollector.collectAndSaveTideData(
                        lat, lon, dateInt, time, item.fileName, paddedItems,
                        { isNeighbor, loadedPages: loadedPagesArr }
                    );

                    if (opts.quick) {
                        const cached = tideCache.get(item.fileName);
                        if (cached && cached.tideBedStatus === 'complete') {
                            cached.tideBedStatus = 'complete-quick';
                            tideCache.set(item.fileName, cached);
                        }
                    }
                }

                const todayItem = toCollect.find(it => it.date === adj.current);
                const neighborItems = toCollect.filter(it => it.date !== adj.current);
                const isNeighborMissing = (day) => toCollect.some(it => it.date === day);

                // ── ① 1차 호출 (병렬, 최대 7페이지) ──
                //    today: 전체 5 페이지 (게이지 표시 대상)
                //    yesterday: Page 5 (1200..1439 → 어제 마지막 peak 가 자주 위치)
                //    tomorrow:  Page 1 (0..299 → 내일 첫 peak 가 자주 위치)
                //  Promise 변수를 분리해 보관 — todayChain 은 todayFetchP 만 await,
                //  neighborChain 은 모든 neighborFetchP* 까지 await.
                const todayFetchP = todayItem
                    ? fetchPagesForDay(adj.current, [1, 2, 3, 4, 5])
                    : Promise.resolve();
                const yesterdayInitP = isNeighborMissing(adj.prev)
                    ? fetchPagesForDay(adj.prev, [5])
                    : Promise.resolve();
                const tomorrowInitP = isNeighborMissing(adj.next)
                    ? fetchPagesForDay(adj.next, [1])
                    : Promise.resolve();

                // ── ② today 우선 분석 (quick) ──
                let todayQuickDone = false;
                const todayChain = todayItem
                    ? todayFetchP.then(async () => {
                        const neighborsReady = !!(rawItemsMap[adj.prev] && rawItemsMap[adj.next]);
                        await analyzeAndSave(todayItem, { quick: !neighborsReady });
                        todayQuickDone = true;
                        console.log(`⚡ [Quick] today(${adj.current}) 분석 완료 ${neighborsReady ? '(이웃 동시 도착 → final)' : '(quick — 이웃 대기)'}`);
                    })
                    : Promise.resolve();

                // ── ③ today peak 기반 boundary 추정 → 어제/내일 누락 페이지 추가 호출 ──
                //   M2 반주기 372분 (6h12m) — 6h12.4m. 보수적으로 정수 사용.
                const M2_HALF_PERIOD = 372;
                const neighborChain = todayChain.then(async () => {
                    // todayChain 후 cached today 에서 peak 추출 (todayItem 없어도 fileMap.today 로 조회)
                    const todayFileName = fileMap.today;
                    const todayCached = todayFileName ? tideCache.get(todayFileName) : null;

                    // 피크 minutes — highTide1..4, lowTide1..4 시간 필드에서 추출
                    let firstPeakMin = null, lastPeakMin = null;
                    if (todayCached) {
                        const allTimes = [
                            todayCached.highTide1, todayCached.highTide2, todayCached.highTide3, todayCached.highTide4,
                            todayCached.lowTide1, todayCached.lowTide2, todayCached.lowTide3, todayCached.lowTide4
                        ].map(peakTimeToMinutes).filter(v => v !== null);
                        if (allTimes.length > 0) {
                            firstPeakMin = Math.min(...allTimes);
                            lastPeakMin = Math.max(...allTimes);
                        }
                    }

                    // ── yesterday boundary 페이지 결정 ──
                    let yesterdayExtraPages = [];
                    if (isNeighborMissing(adj.prev)) {
                        if (firstPeakMin !== null) {
                            const yEst = firstPeakMin - M2_HALF_PERIOD;
                            // 음수: 어제 시각 = yEst + 1440 (정상 케이스 — 어제 23시 부근)
                            // 양수: 오늘 자정 직후의 첫 피크가 매우 늦은 시각. 어제 마지막 피크는
                            //       어제 내 어느 위치 (yEst). pagesForMinute 가 그대로 처리.
                            const yMin = (yEst < 0) ? (yEst + 1440) : yEst;
                            yesterdayExtraPages = pagesForMinute(yMin);
                            console.log(`📐 yesterday boundary: todayFirstPeak=${firstPeakMin}min → yEst=${yEst} → yMin=${yMin} → pages=[${yesterdayExtraPages.join(',')}]`);
                        } else {
                            // fallback — today peak 추출 실패 시 전체 5페이지 호출 (안전)
                            yesterdayExtraPages = [1, 2, 3, 4, 5];
                            console.warn(`📐 yesterday boundary: today peak 추출 실패 → fallback 전체 5페이지`);
                        }
                    }

                    // ── tomorrow boundary 페이지 결정 ──
                    let tomorrowExtraPages = [];
                    if (isNeighborMissing(adj.next)) {
                        if (lastPeakMin !== null) {
                            const tEst = lastPeakMin + M2_HALF_PERIOD;
                            // >= 1440: 내일 시각 = tEst - 1440 (정상)
                            // < 1440: 비정상 — todayLastPeak 가 더 있어야 함. 보수적으로 minute 0 사용.
                            const tMin = (tEst >= 1440) ? (tEst - 1440) : 0;
                            tomorrowExtraPages = pagesForMinute(tMin);
                            console.log(`📐 tomorrow boundary: todayLastPeak=${lastPeakMin}min → tEst=${tEst} → tMin=${tMin} → pages=[${tomorrowExtraPages.join(',')}]`);
                        } else {
                            tomorrowExtraPages = [1, 2, 3, 4, 5];
                            console.warn(`📐 tomorrow boundary: today peak 추출 실패 → fallback 전체 5페이지`);
                        }
                    }

                    // ── ④ 누락 페이지 추가 호출 (yesterday Page 5 / tomorrow Page 1 은 ① 에서 이미 발사됨) ──
                    const extraFetches = [];
                    if (yesterdayExtraPages.length > 0) {
                        extraFetches.push(fetchPagesForDay(adj.prev, yesterdayExtraPages));
                    }
                    if (tomorrowExtraPages.length > 0) {
                        extraFetches.push(fetchPagesForDay(adj.next, tomorrowExtraPages));
                    }
                    // ① 의 yesterday Page5 / tomorrow Page1 도 아직 진행중이면 함께 await
                    await Promise.all([yesterdayInitP, tomorrowInitP].concat(extraFetches));

                    // ── ⑤ 이웃 분석 + today final 재분석 ──
                    await Promise.all(neighborItems.map(it => analyzeAndSave(it)));

                    if (todayItem && todayQuickDone) {
                        const cached = tideCache.get(todayItem.fileName);
                        if (cached && cached.tideBedStatus === 'complete-quick') {
                            await analyzeAndSave(todayItem);
                            console.log(`✓ today(${adj.current}) padded 재분석 → 'complete' 갱신`);
                        }
                    }
                    console.log(`🎉 [Boundary 최적화] 이웃 ${neighborItems.length}일치 분석 완료 (총 추가 페이지: yesterday=[${yesterdayExtraPages.join(',')}], tomorrow=[${tomorrowExtraPages.join(',')}])`);
                });

                Promise.all([todayChain, neighborChain])
                    .catch(err => console.error('❌ 백그라운드 수집 오류:', err.message));
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
    // 키 등록은 중요 영속화 — flush 로 즉시 저장 (디바운스 우회)
    tideCollector.saveTideBedConfig({ flush: true });
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
    // 키 삭제는 중요 영속화 — flush 로 즉시 저장
    tideCollector.saveTideBedConfig({ flush: true });
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
