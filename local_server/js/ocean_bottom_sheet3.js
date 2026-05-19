/**
 * ============================================================================
 * 파일명: js/ocean_bottom_sheet3.js
 * 역할: 바텀시트 조석 카드 — TideBED 폴링 + 3모드 렌더링(loading/error/detail)
 * ============================================================================
 *
 * [표시 형식 (이미지 기반)]
 *   ┌────────────────────────────────────────────────────┐
 *   │ ≋ 조석                            [표준항 보간 결과] │
 *   │ ┌────────────────────────────────────────────────┐ │
 *   │ │ 고조 12:42  ●━━━○────  저조 19:23              │ │
 *   │ │              05:37                             │ │
 *   │ │       현재 예상 조위 179cm ▼                   │ │
 *   │ │ ┌──┐                                           │ │
 *   │ │ │고│ 01:19 (226cm) ▲ +175                      │ │
 *   │ │ │조│ 12:42 (187cm) ▲  +77                      │ │
 *   │ │ └──┘                                           │ │
 *   │ │ ┌──┐                                           │ │
 *   │ │ │저│ 07:46 (110cm) ▼ -116                      │ │
 *   │ │ │조│ 19:23  (63cm) ▼ -124                      │ │
 *   │ │ └──┘                                           │ │
 *   │ └────────────────────────────────────────────────┘ │
 *   └────────────────────────────────────────────────────┘
 *
 * [데이터 소스]
 * - POST /api/save_tide_input  → { success, files: { yesterday/today/tomorrow }, cached }
 * - GET  /data/{filename}      → 일별 TideBED 결과 (highTide1~4, lowTide1~4, analysis)
 *
 * [동해북부 우회]
 * - lat ≥ 36 && lon ≥ 128 인 좌표는 ocean_bottom_sheet4.js의 tryEastSeaIdw()로 처리
 * ============================================================================
 */

(function () {
    'use strict';

    var OS = window.OceanSheet = window.OceanSheet || {};

    var POLL_INTERVAL_MS = 500;
    var POLL_MAX_TRIES = 120; // 60초

    /* --------------------------------------------------------------
     * ❷ 첫 렌더 성공 플래그 — 폴링 중 'error' 응답으로 카드 사라짐 방지.
     * renderTideData 가 한 번이라도 호출되면 true. 시트 close / 좌표 변경 /
     * 날짜 변경 시 OS.resetTideFirstRender() 로 reset.
     * ------------------------------------------------------------ */
    var _tideFirstRenderSucceeded = false;
    OS.markTideFirstRender = function () { _tideFirstRenderSucceeded = true; };
    OS.resetTideFirstRender = function () { _tideFirstRenderSucceeded = false; };
    OS.tideFirstRenderSucceeded = function () { return _tideFirstRenderSucceeded; };

    /* --------------------------------------------------------------
     * ❹ 클라이언트 격자ID 캐시 — KHOA 외부 호출 1회 절감.
     * key = pointKey(lat,lon) (5소수점 양자화), value = { gridHash, fileName }.
     *
     * 정책:
     *  - 비즐겨찾기: 메모리에만 (시트 닫히면 사실상 폐기 — 다른 좌표 선택 시 누적)
     *  - 즐겨찾기: localStorage 'gridHashCache:v1' 영속 (TTL 30일)
     *    격자ID 는 KHOA 가 거의 안 바꿈 → 긴 TTL 안전.
     * ------------------------------------------------------------ */
    var _gridHashByPoint = {};
    var GRID_HASH_LS_KEY = 'gridHashCache:v1';
    var GRID_HASH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30일

    function gridPointKey(lat, lon) {
        var qLat = Math.round(lat * 100000) / 100000;
        var qLon = Math.round(lon * 100000) / 100000;
        return qLat + ',' + qLon;
    }

    function loadGridHashLS() {
        try {
            var raw = localStorage.getItem(GRID_HASH_LS_KEY);
            if (!raw) return;
            var obj = JSON.parse(raw);
            if (!obj || typeof obj !== 'object') return;
            var now = Date.now();
            var changed = false;
            Object.keys(obj).forEach(function (k) {
                var v = obj[k];
                if (!v || !v.ts || (now - v.ts) > GRID_HASH_TTL_MS) {
                    delete obj[k];
                    changed = true;
                    return;
                }
                _gridHashByPoint[k] = { gridHash: v.gridHash, fileName: v.fileName };
            });
            if (changed) {
                localStorage.setItem(GRID_HASH_LS_KEY, JSON.stringify(obj));
            }
        } catch (e) { /* localStorage 미사용 환경 */ }
    }
    loadGridHashLS();

    // isFavoritePoint 는 아래 차등 캐싱 섹션(라인 ~186) 에서 단일 정의됨.
    // 두 정의가 동일 헬퍼 의미로 통일됨 — window.oceanFav.locationFindNear (500m 반경) 위임.
    // (이전 버전에 OS.isFavoriteCoord / window.Favorites.isFavorite fallback 분기가
    //  있었으나 실제 코드베이스에 존재하지 않는 API 였으므로 제거. 차등 캐싱 헬퍼와
    //  완전 동일한 판정으로 격자ID 캐시 영속화 정책 일관성 확보.)

    function persistGridHashIfFavorite(lat, lon, gridHash, fileName) {
        if (!isFavoritePoint(lat, lon)) return;
        try {
            var raw = localStorage.getItem(GRID_HASH_LS_KEY);
            var obj = raw ? JSON.parse(raw) : {};
            if (!obj || typeof obj !== 'object') obj = {};
            obj[gridPointKey(lat, lon)] = {
                gridHash: gridHash, fileName: fileName, ts: Date.now()
            };
            localStorage.setItem(GRID_HASH_LS_KEY, JSON.stringify(obj));
        } catch (e) {}
    }

    function rememberGridHash(lat, lon, gridHash, fileName) {
        if (!gridHash) return;
        var k = gridPointKey(lat, lon);
        _gridHashByPoint[k] = { gridHash: gridHash, fileName: fileName || null };
        persistGridHashIfFavorite(lat, lon, gridHash, fileName);
    }

    /**
     * 격자ID 캐시(메모리 + localStorage) 의 특정 좌표 항목을 즉시 제거.
     *
     * 사용 시점:
     *   - 서버가 invalidGridHash:true 응답으로 stale gridHash 보고 시
     *   - (gridHashRefreshed:true 경로는 rememberGridHash() 가 새 값으로 덮어쓰므로
     *      별도 forget 불필요 — 단, 비즐겨찾기 시 localStorage 에 남은 stale 항목은
     *      forgetGridHash 로 제거)
     */
    function forgetGridHash(lat, lon) {
        var k = gridPointKey(lat, lon);
        delete _gridHashByPoint[k];
        try {
            var raw = localStorage.getItem(GRID_HASH_LS_KEY);
            if (raw) {
                var obj = JSON.parse(raw);
                if (obj && typeof obj === 'object' && obj[k]) {
                    delete obj[k];
                    localStorage.setItem(GRID_HASH_LS_KEY, JSON.stringify(obj));
                }
            }
        } catch (e) { /* ignore */ }
    }

    function lookupGridHash(lat, lon) {
        return _gridHashByPoint[gridPointKey(lat, lon)] || null;
    }

    /* --------------------------------------------------------------
     * [조석 멀티 데이 캐시 — 2026-05]
     *
     * 사용자 의도:
     *   1) 같은 해점 + 같은 날 시간 이동:
     *      조석 정보(고저조 시각/조위) 변화 X, 게이지/예상조위만 변화 → API 호출 X
     *   2) 같은 해점 + 다른 날짜 갔다가 처음 캐시한 날짜로 복귀:
     *      처음 캐시한 데이터 그대로 재사용 → API 호출 X
     *   3) 같은 해점에서 새 날짜 첫 방문:
     *      API 호출 후 days[dayKey] 에 누적 저장 (이전 날짜 캐시 유지)
     *   4) 다른 해점 선택:
     *      캐시 통째 reset
     *
     * 구조:
     *   OS.state._tideMultiDayCache = {
     *       lat:  Number,   // 캐시 키 — 좌표 변경 시 통째 invalidate
     *       lon:  Number,
     *       days: {
     *           'YYYY-MM-DD': {
     *               data:      Object,   // /data/tide_*.json 원본 (renderTideData 입력)
     *               isIdw:     Boolean,  // 동해북부 IDW 결과 여부
     *               neighbors: Object    // { yesterday, tomorrow, lat, lon }
     *           }, ...
     *       }
     *   }
     *
     *   renderTideData 가 매번 peaks 를 재계산하므로 raw data 만 보관하면 충분.
     *   별도로 다음/현재/이전 day 의 peaks 가 필요한 게이지 계산은
     *   refreshTideGaugeForTime 에서 days[dayKey], days[prevKey], days[nextKey] 를
     *   조합해 동적으로 산출한다.
     *
     * [차등 캐싱 — 2026-05 사용자 합의]
     *   - 비즐겨찾기 해점: 메모리 캐시(OS.state._tideMultiDayCache)만 사용.
     *     바텀시트 닫힐 때 dropMemoryCacheIfNotFavorite() 에서 폐기.
     *   - 즐겨찾기 해점: localStorage('tideCache:v1') 에 영속 저장.
     *     dayKey 만료(어제/오늘/내일 이외) 자동 purge, 50 point LRU evict.
     *   - 즐겨찾기 추가/해제 시 promoteMemoryCacheToPersist / dropFromPersist 호출.
     * ------------------------------------------------------------ */

    /* localStorage 영속 캐시 — 즐겨찾기 해점 전용. 키 형식:
     *   { '<lat5>_<lon5>': { days: { 'YYYY-MM-DD': {data,isIdw,neighbors}, ... },
     *                        lastUsed: <ms> }, ... }
     */
    var PERSIST_KEY = 'tideCache:v1';
    var MAX_PERSIST_POINTS = 50;

    /** 좌표 양자화 키 — 5소수점 (≈1m). pointKey 와 round 가 동일해야 캐시 hit. */
    function pointKey(lat, lon) {
        return (Math.round(lat * 100000) / 100000) + '_' +
               (Math.round(lon * 100000) / 100000);
    }

    /**
     * 즐겨찾기 해점인지 동기 판정.
     * ocean_cctv.js 의 window.oceanFav.locationFindNear 는 반경 500m 매칭.
     * 미로드(예: index1) 환경에서는 항상 false → localStorage 미사용.
     */
    function isFavoritePoint(lat, lon) {
        try {
            if (window.oceanFav && typeof window.oceanFav.locationFindNear === 'function') {
                return !!window.oceanFav.locationFindNear(lat, lon);
            }
        } catch (e) { /* ignore */ }
        return false;
    }

    /**
     * localStorage 에서 영속 캐시 load — 만료 dayKey 자동 purge.
     * 만료 기준: dayKey < 어제 (yKey). 오늘/내일 이후만 유지.
     */
    function loadPersistCache() {
        try {
            var raw = localStorage.getItem(PERSIST_KEY);
            if (!raw) return {};
            var parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return {};
            var today = new Date();
            var yKey = dayKeyOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));
            var changed = false;
            for (var pk in parsed) {
                if (!Object.prototype.hasOwnProperty.call(parsed, pk)) continue;
                var pt = parsed[pk];
                if (!pt || !pt.days) { delete parsed[pk]; changed = true; continue; }
                for (var dk in pt.days) {
                    if (!Object.prototype.hasOwnProperty.call(pt.days, dk)) continue;
                    if (dk < yKey) { delete pt.days[dk]; changed = true; }
                }
                if (!Object.keys(pt.days).length) {
                    delete parsed[pk];
                    changed = true;
                }
            }
            if (changed) savePersistCache(parsed);
            return parsed;
        } catch (e) {
            return {};
        }
    }

    /** localStorage 에 영속 캐시 save — quota 초과 등 실패는 silent. */
    function savePersistCache(obj) {
        try { localStorage.setItem(PERSIST_KEY, JSON.stringify(obj)); }
        catch (e) { /* quota 초과 등 silent */ }
    }

    /**
     * 즐겨찾기 신규 추가 시 호출 — 메모리 캐시 _tideMultiDayCache 통째 localStorage 로 승격.
     * (lat,lon) 이 현재 메모리 캐시 좌표와 일치할 때만 승격. 좌표는 5소수점 round.
     */
    OS.promoteMemoryCacheToPersist = function (lat, lon) {
        var c = OS.state && OS.state._tideMultiDayCache;
        if (!c) return;
        var rLat = Math.round(lat * 100000) / 100000;
        var rLon = Math.round(lon * 100000) / 100000;
        var cLat = Math.round(c.lat * 100000) / 100000;
        var cLon = Math.round(c.lon * 100000) / 100000;
        if (rLat !== cLat || rLon !== cLon) return;
        var persist = loadPersistCache();
        var pk = pointKey(lat, lon);
        var daysCopy = {};
        for (var k in c.days) {
            if (Object.prototype.hasOwnProperty.call(c.days, k)) daysCopy[k] = c.days[k];
        }
        persist[pk] = { days: daysCopy, lastUsed: Date.now() };
        // LRU evict — 50 point 초과 시 lastUsed 오래된 항목부터 제거
        var entries = Object.keys(persist).map(function (k) {
            return [k, persist[k].lastUsed || 0];
        });
        if (entries.length > MAX_PERSIST_POINTS) {
            entries.sort(function (a, b) { return b[1] - a[1]; });
            for (var i = MAX_PERSIST_POINTS; i < entries.length; i++) {
                delete persist[entries[i][0]];
            }
        }
        savePersistCache(persist);

        // 격자ID 캐시도 함께 영속화 (즐겨찾기 신규 추가 시 메모리 → localStorage 승격).
        // 메모리에 _gridHashByPoint 항목이 있으면 gridHashCache:v1 에 즉시 기록.
        try {
            var ghKey = gridPointKey(lat, lon);
            var gh = _gridHashByPoint[ghKey];
            if (gh && gh.gridHash) {
                var ghRaw = localStorage.getItem(GRID_HASH_LS_KEY);
                var ghObj = ghRaw ? JSON.parse(ghRaw) : {};
                if (!ghObj || typeof ghObj !== 'object') ghObj = {};
                ghObj[ghKey] = {
                    gridHash: gh.gridHash, fileName: gh.fileName || null, ts: Date.now()
                };
                localStorage.setItem(GRID_HASH_LS_KEY, JSON.stringify(ghObj));
            }
        } catch (e) { /* ignore */ }
    };

    /** 즐겨찾기 해제 시 호출 — localStorage 의 해당 좌표 항목 삭제.
     *  격자ID 캐시(gridHashCache:v1) 의 동일 좌표 항목도 함께 제거. */
    OS.dropFromPersist = function (lat, lon) {
        var persist = loadPersistCache();
        delete persist[pointKey(lat, lon)];
        savePersistCache(persist);
        // 격자ID 영속 캐시도 함께 삭제 (즐겨찾기 해제 = 영속 보존할 이유 없음)
        try {
            var raw = localStorage.getItem(GRID_HASH_LS_KEY);
            if (raw) {
                var obj = JSON.parse(raw);
                if (obj && typeof obj === 'object') {
                    delete obj[gridPointKey(lat, lon)];
                    localStorage.setItem(GRID_HASH_LS_KEY, JSON.stringify(obj));
                }
            }
        } catch (e) { /* ignore */ }
    };

    /**
     * 바텀시트 닫힐 때 호출 — 비즐겨찾기 해점이면 메모리 캐시 폐기.
     * 즐겨찾기 해점은 메모리 캐시 그대로 유지 (다음 오픈 시 prefill 없이 즉시 hit).
     * _tideRenderState 는 항상 clear (다른 좌표 재오픈 시 stale 차단).
     */
    OS.dropMemoryCacheIfNotFavorite = function () {
        if (OS.state) {
            var c = OS.state._tideMultiDayCache;
            if (c && !isFavoritePoint(c.lat, c.lon)) {
                OS.state._tideMultiDayCache = null;
            }
            OS.state._tideRenderState = null;
        }
    };

    /**
     * 좌표가 즐겨찾기면 localStorage 에서 메모리 캐시로 prefill.
     * 시트 오픈 시 다른 좌표일 때 호출 — _tideMultiDayCache 가 null 인 상태에서
     * localStorage 항목이 있으면 그 days 를 메모리에 복사 (API 호출 skip 가능).
     */
    OS.prefillMemoryCacheFromPersist = function (lat, lon) {
        if (!OS.state) return;
        if (!isFavoritePoint(lat, lon)) return;
        var persist = loadPersistCache();
        var pk = pointKey(lat, lon);
        var pt = persist[pk];
        if (!pt || !pt.days || !Object.keys(pt.days).length) return;
        var daysCopy = {};
        for (var k in pt.days) {
            if (Object.prototype.hasOwnProperty.call(pt.days, k)) daysCopy[k] = pt.days[k];
        }
        OS.state._tideMultiDayCache = { lat: lat, lon: lon, days: daysCopy };
        // lastUsed 갱신 — LRU evict 기준
        pt.lastUsed = Date.now();
        savePersistCache(persist);
    };
    /** dateObj → 'YYYY-MM-DD' (0-padded). dayKey 비교용. */
    function dayKeyOf(dateObj) {
        return dateObj.getFullYear() + '-' +
            String(dateObj.getMonth() + 1).padStart(2, '0') + '-' +
            String(dateObj.getDate()).padStart(2, '0');
    }

    /** dayKey 'YYYY-MM-DD' → Date(0시 정각). dayDiff 산출용. */
    function dayKeyToDate(key) {
        var parts = key.split('-');
        return new Date(parseInt(parts[0], 10),
            parseInt(parts[1], 10) - 1,
            parseInt(parts[2], 10));
    }

    /** dateObj 기준 ±N 일 dayKey 산출. neighbors 조합용. */
    function shiftDayKey(dateObj, deltaDays) {
        var d = new Date(dateObj.getFullYear(), dateObj.getMonth(),
            dateObj.getDate() + deltaDays);
        return dayKeyOf(d);
    }

    /**
     * 좌표 (lat, lon) + dayKey 에 해당하는 캐시 엔트리 조회.
     * 우선순위: 메모리 _tideMultiDayCache → localStorage (즐겨찾기 영속 캐시).
     * 좌표는 5소수점 round 로 비교 (부동소수점 noise 로 인한 false-miss 방지).
     */
    function getCachedDay(lat, lon, key) {
        var rLat = Math.round(lat * 100000) / 100000;
        var rLon = Math.round(lon * 100000) / 100000;
        var c = OS.state && OS.state._tideMultiDayCache;
        if (c) {
            var cLat = Math.round(c.lat * 100000) / 100000;
            var cLon = Math.round(c.lon * 100000) / 100000;
            if (cLat === rLat && cLon === rLon) {
                var m = c.days[key];
                if (m) return m;
            }
        }
        // localStorage (즐겨찾기 영속 캐시) — 메모리 hit 없을 때만 fallback
        try {
            var persist = loadPersistCache();
            var pt = persist[pointKey(lat, lon)];
            if (pt && pt.days && pt.days[key]) return pt.days[key];
        } catch (e) { /* ignore */ }
        return null;
    }

    /**
     * 캐시에 (lat, lon, dayKey, entry) 저장.
     * 좌표가 다르면 days 통째 reset 후 새 좌표로 시작.
     * 즐겨찾기 해점이면 localStorage 에도 동시 저장 (50 point LRU evict 적용).
     */
    function putCachedDay(lat, lon, key, entry) {
        if (!OS.state) return;
        var rLat = Math.round(lat * 100000) / 100000;
        var rLon = Math.round(lon * 100000) / 100000;
        var c = OS.state._tideMultiDayCache;
        if (c) {
            var cLat = Math.round(c.lat * 100000) / 100000;
            var cLon = Math.round(c.lon * 100000) / 100000;
            if (cLat !== rLat || cLon !== rLon) c = null;
        }
        if (!c) {
            c = OS.state._tideMultiDayCache = { lat: lat, lon: lon, days: {} };
        }
        c.days[key] = entry;

        // 즐겨찾기 해점이면 localStorage 에도 저장
        if (isFavoritePoint(lat, lon)) {
            try {
                var persist = loadPersistCache();
                var pk = pointKey(lat, lon);
                if (!persist[pk]) persist[pk] = { days: {}, lastUsed: Date.now() };
                persist[pk].days[key] = entry;
                persist[pk].lastUsed = Date.now();
                // LRU evict — 50 point 초과 시 lastUsed 오래된 항목부터 제거
                var entries = Object.keys(persist).map(function (k) {
                    return [k, persist[k].lastUsed || 0];
                });
                if (entries.length > MAX_PERSIST_POINTS) {
                    entries.sort(function (a, b) { return b[1] - a[1]; });
                    for (var i = MAX_PERSIST_POINTS; i < entries.length; i++) {
                        delete persist[entries[i][0]];
                    }
                }
                savePersistCache(persist);
            } catch (e) { /* ignore quota */ }
        }
    }

    /**
     * (lat, lon, dayKey) 가 캐시되어 있는지 외부에서 조회.
     * STL.onRelease 가 cache hit 여부 판단해 풀 fetch skip 결정에 사용.
     * 메모리 + localStorage 둘 다 확인 (즐겨찾기 해점은 영속 캐시 hit 가능).
     */
    OS.hasTideCacheFor = function (lat, lon, dateObj) {
        return !!getCachedDay(lat, lon, dayKeyOf(dateObj));
    };

    /* --------------------------------------------------------------
     * 외부 진입점: 조석 카드 로딩 시작
     *
     * [캐시 적용]
     *   동일 (lat, lon, dayKey) 조합이 캐시되어 있으면 즉시 renderTideData 만
     *   호출하고 API 호출은 skip. neighbors (어제/내일 데이터) 도 캐시에서 조합.
     * ------------------------------------------------------------ */
    OS.fetchTideForSheet = function (lat, lon, dateObj) {
        // 캐시 hit — API 호출 없이 즉시 렌더
        var key = dayKeyOf(dateObj);
        var cached = getCachedDay(lat, lon, key);
        if (cached) {
            // neighbors 도 캐시에서 동적으로 조합 (저장 시점 neighbors 가 stale 일 수 있음).
            // 저장된 neighbors 가 있으면 우선 사용, 없으면 days[prev/next] 에서 조합.
            var neighbors = cached.neighbors || {};
            var yKey = shiftDayKey(dateObj, -1);
            var tKey = shiftDayKey(dateObj, +1);
            var yCached = getCachedDay(lat, lon, yKey);
            var tCached = getCachedDay(lat, lon, tKey);
            var mergedNeighbors = {
                yesterday: (yCached && yCached.data) || neighbors.yesterday || null,
                tomorrow:  (tCached && tCached.data) || neighbors.tomorrow  || null,
                lat: lat, lon: lon
            };
            OS.renderTideData(cached.data, cached.isIdw, dateObj, mergedNeighbors);
            return;
        }

        OS.renderTideLoading();

        // 동해북부 우회 (4.js)
        if (lat >= 36 && lon >= 128 && typeof OS.tryEastSeaIdw === 'function') {
            OS.tryEastSeaIdw(lat, lon, dateObj, function (result, errMsg) {
                if (result && result.today) {
                    OS.renderTideData(result.today, /*isIdw=*/true, dateObj, {
                        yesterday: result.yesterday,
                        tomorrow: result.tomorrow,
                        lat: lat, lon: lon   // 서해 판별용 좌표 전달
                    });
                } else {
                    OS.renderTideError(errMsg ||
                        '동해 북부 표준항 보간을 위한 근거 데이터가 부족합니다.');
                }
            });
            return;
        }

        // 일반 KHOA TideBED 호출
        OS.fetchTideKhoa(lat, lon, dateObj);
    };

    /* --------------------------------------------------------------
     * KHOA TideBED 호출 + 3일치 폴링
     * ------------------------------------------------------------ */
    OS.fetchTideKhoa = function (lat, lon, dateObj) {
        var dateInt = OS.formatDateInt(dateObj);
        // [좌표 양자화 2026-05] 부동소수점 noise 로 같은 격자에서 다른 lat/lon 이
        // 전송돼 서버 캐시(grid hash) 도 같은 격자임에도 false-miss 가 나는 것을
        // 막기 위해 5소수점(≈1m) round. pointKey() 와 동일한 quantization 사용.
        var qLat = Math.round(lat * 100000) / 100000;
        var qLon = Math.round(lon * 100000) / 100000;
        var body = { lat: qLat, lon: qLon, date: dateInt, time: nowHHMM() };

        // ❹ 클라이언트 격자 캐시 — 있으면 body 에 동봉, 서버는 KHOA 호출 skip
        var cachedGrid = lookupGridHash(lat, lon);
        if (cachedGrid) {
            body.gridHash = cachedGrid.gridHash;
            if (cachedGrid.fileName) body.fileName = cachedGrid.fileName;
        }

        fetch('/api/save_tide_input', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
            .then(function (r) { return r.json(); })
            .then(function (resp) {
                // ❹+ 서버가 clientGridHash 무효 감지 → 자동 갱신을 알려온 경우.
                //   기존 localStorage 항목은 stale 이므로 우선 제거 후 새 값으로 재기록.
                //   (비즐겨찾기 좌표 시 rememberGridHash 는 localStorage 영속화를 skip 하므로
                //    forgetGridHash 로 명시적으로 stale 항목을 지운다.)
                if (resp && resp.success && resp.gridHashRefreshed) {
                    try { forgetGridHash(lat, lon); } catch (e) {}
                }
                // 서버가 명시적으로 invalidGridHash 시그널을 보낸 경우 (호환용 — 현재 서버는
                //   주로 gridHashRefreshed 경로로 응답하지만, 미래 호환 위해 처리 유지.)
                if (resp && resp.invalidGridHash) {
                    try { forgetGridHash(lat, lon); } catch (e) {}
                }
                // ❹ 응답의 gridHash 저장 (즐겨찾기면 localStorage 영속화)
                if (resp && resp.success && resp.gridHash) {
                    var fname = (resp.files && resp.files.today) || null;
                    rememberGridHash(lat, lon, resp.gridHash, fname);
                }
                if (!resp.success) {
                    var em = (resp.error || '') + '';
                    if (em.indexOf('Grid hash unavailable') >= 0) {
                        OS.renderTideError('국립해양조사원 조석 예측정보가 제공되지 않는 해역입니다.');
                    } else {
                        OS.renderTideError('조석 예측정보 조회에 실패했습니다.');
                    }
                    return;
                }
                if (!resp.files || !resp.files.today) {
                    OS.renderTideError('조석 데이터 응답이 비어 있습니다.');
                    return;
                }
                // tide.js의 loadAllThreeDays와 동일하게 3일치(어제/오늘/내일)를 모두 폴링
                pollThreeDayFiles(resp.files, dateObj);
            })
            .catch(function () {
                OS.renderTideError('조석 데이터 요청 중 오류가 발생했습니다.');
            });

        // -- 내부: 3일치(어제/오늘/내일) 폴링 ---------------------
        // tide.js와 같은 방식으로 today를 우선 받아 즉시 렌더하고,
        // 어제/내일은 백그라운드로 계속 폴링하여 cross-day 보강.
        function pollThreeDayFiles(files, dateObj) {
            var tries = 0;
            var collected = { yesterday: null, today: null, tomorrow: null };

            // 단일 파일 폴링.
            // 인정 상태:
            //   'complete'        — final 결과 (padding 분석 완료) — 더 이상 폴링 안 함
            //   'complete (IDW)'  — IDW 보간 결과 — final 로 간주
            //   'complete-quick'  — today 우선 분석 임시 결과 (이웃 padding 없음).
            //                       collected 에 저장하되 다음 loop 에서 다시 가져와
            //                       final 'complete' 도착 시 갱신.
            //   'error'           — 백엔드 수집 실패. collected 에 저장 후 빠른 실패 처리.
            function fetchOne(key) {
                var fname = files[key];
                if (!fname) return Promise.resolve();
                // final 'complete' 또는 'error' 면 더 이상 폴링 안 함
                var cur = collected[key];
                if (cur && (cur.tideBedStatus === 'complete'
                            || cur.tideBedStatus === 'complete (IDW)'
                            || cur.tideBedStatus === 'error')) {
                    return Promise.resolve();
                }
                return fetch('/data/' + fname)
                    .then(function (r) { return r.json(); })
                    .then(function (d) {
                        if (!d) return;
                        if (d.tideBedStatus === 'complete'
                            || d.tideBedStatus === 'complete (IDW)'
                            || d.tideBedStatus === 'complete-quick'
                            || d.tideBedStatus === 'error') {
                            collected[key] = d;
                        }
                    })
                    .catch(function () {});
            }

            (function loop() {
                Promise.all([fetchOne('yesterday'), fetchOne('today'), fetchOne('tomorrow')])
                    .then(function () {
                        // ❷ today 가 'error' 라도 이미 첫 렌더 성공했으면 무시
                        // (폴링 재 fetch 중 server padded 빈 결과로 'error' 덮어쓰기 보호).
                        if (collected.today && collected.today.tideBedStatus === 'error') {
                            if (_tideFirstRenderSucceeded) {
                                // 이미 화면에 카드 정상 표시 중 → error 무시, 폴링도 더 안 함
                                return;
                            }
                            OS.renderTideError('조석 데이터 수집에 실패했습니다.');
                            return;
                        }
                        if (collected.today) {
                            // 오늘 데이터 + 현재까지 모인 이웃 데이터로 렌더
                            OS.renderTideData(collected.today, /*isIdw=*/false, dateObj, {
                                yesterday: collected.yesterday,
                                tomorrow: collected.tomorrow,
                                lat: lat, lon: lon   // 서해 판별용 좌표 전달
                            });
                            // ❷ 첫 렌더 성공 마킹
                            _tideFirstRenderSucceeded = true;
                            // 추가 폴링이 필요한 조건:
                            //   - today 가 'complete-quick' (이웃 도착 후 final 'complete' 기다림)
                            //   - 또는 yesterday/tomorrow 미도착
                            var stillPolling = (
                                collected.today.tideBedStatus === 'complete-quick'
                                || !collected.yesterday
                                || !collected.tomorrow
                            );
                            if (stillPolling && ++tries < POLL_MAX_TRIES) {
                                setTimeout(loop, POLL_INTERVAL_MS);
                            }
                            return;
                        }
                        if (++tries < POLL_MAX_TRIES) {
                            setTimeout(loop, POLL_INTERVAL_MS);
                        } else {
                            OS.renderTideError('조석 데이터 수집 시간이 초과되었습니다.');
                        }
                    });
            })();
        }
    };

    /* --------------------------------------------------------------
     * 렌더링 1) 로딩 (조석정보 탭과 동일 양식)
     * ------------------------------------------------------------ */
    OS.renderTideLoading = function () {
        var card = document.getElementById('ocean-card-tide');
        if (!card) return;
        card.style.display = '';
        card.innerHTML =
            '<div class="ocean-tide-wrap">' +
              '<div class="ocean-tide-title-row">' +
                '<div class="ocean-tide-title"><i class="fa-solid fa-water"></i> 조석</div>' +
              '</div>' +
              '<div class="ocean-tide-loading">' +
                '<div class="ocean-tide-spinner"></div>' +
                '<div class="ocean-tide-spinner-text">' +
                  '국립해양조사원으로부터 TideBED 기반<br>' +
                  '조석 예측정보를 불러오고 있습니다.' +
                '</div>' +
                '<div class="ocean-tide-spinner-sub">약 3~5초 소요됩니다</div>' +
              '</div>' +
            '</div>';
    };

    /* --------------------------------------------------------------
     * 렌더링 2) 에러 (격자 밖/육지 등) — 카드 자체를 숨김
     * 조석 예측정보를 제공하지 않는 해역에서는 해당 란을 아예 표시하지 않음.
     * ------------------------------------------------------------ */
    OS.renderTideError = function (msg) {
        var card = document.getElementById('ocean-card-tide');
        if (!card) return;
        card.style.display = 'none';
    };

    /* --------------------------------------------------------------
     * 렌더링 3) 상세 (4피크 + 현재 조위 + 헤더 진행바)
     *
     * @param {Object} data       /data/tide_*.json 응답 형식
     *                            (highTide1~4, lowTide1~4, analysis)
     * @param {boolean} isIdw     동해북부 IDW 보간 결과 여부
     * @param {Date} dateObj      이 카드가 표시 중인 날짜
     * ------------------------------------------------------------ */
    OS.renderTideData = function (data, isIdw, dateObj, neighbors) {
        var card = document.getElementById('ocean-card-tide');
        if (!card) return;

        var peaks = collectPeaks(data); // [{type, minutes, level}]
        if (peaks.length === 0) {
            OS.renderTideError('조석 분석 데이터가 비어 있습니다.');
            return;
        }
        peaks.sort(function (a, b) { return a.minutes - b.minutes; });

        // 어제/내일 피크 (cross-day 보강용) — tide.js loadAllThreeDays와 동일
        var yPeaks = (neighbors && neighbors.yesterday) ? collectPeaks(neighbors.yesterday) : [];
        var tPeaks = (neighbors && neighbors.tomorrow)  ? collectPeaks(neighbors.tomorrow)  : [];
        yPeaks.sort(function (a, b) { return a.minutes - b.minutes; });
        tPeaks.sort(function (a, b) { return a.minutes - b.minutes; });

        var todayMode = OS.isToday(dateObj);
        // [시트 슬라이더 연계] dateObj 는 슬라이더가 가리키는 시각 (value=0 → real now,
        // value=N≥3 → floor3(now)+N*h). 같은 날 안에서 시각만 변할 때 게이지/예상조위
        // 라벨이 그 시각 기준으로 표기되어야 하므로 nowMin 은 실제 now() 가 아닌
        // dateObj 의 minutes-of-day 사용.
        var nowMin = dateObj.getHours() * 60 + dateObj.getMinutes();

        // 직전·다음 피크 계산 — tide.js getTideProgress와 동일한 fallback 트리
        // (1) 일반: 오늘 피크들 사이
        // (2) 새벽: prev = 어제 마지막 피크 (-1440 보정)
        // (3) 심야: next = 내일 첫 피크 (+1440 보정)
        var prevPeak = null, nextPeak = null;
        if (todayMode) {
            for (var i = 0; i < peaks.length; i++) {
                if (peaks[i].minutes > nowMin) {
                    nextPeak = peaks[i];
                    if (i > 0) {
                        prevPeak = peaks[i - 1];
                    } else if (yPeaks.length > 0) {
                        var yLast = yPeaks[yPeaks.length - 1];
                        prevPeak = { type: yLast.type, level: yLast.level, minutes: yLast.minutes - 1440 };
                    }
                    break;
                }
            }
            // 다음 피크 없음 → 내일 첫 피크
            if (!nextPeak) {
                if (peaks.length > 0) prevPeak = peaks[peaks.length - 1];
                if (tPeaks.length > 0) {
                    var tFirst = tPeaks[0];
                    nextPeak = { type: tFirst.type, level: tFirst.level, minutes: tFirst.minutes + 1440 };
                }
            }
            // 게이지 길이 검증 (tide.js 2370행과 동일: >780 또는 ≤0이면 무효)
            if (prevPeak && nextPeak) {
                var dur = nextPeak.minutes - prevPeak.minutes;
                if (dur > 780 || dur <= 0) {
                    prevPeak = null;
                    nextPeak = null;
                }
            } else {
                prevPeak = null;
                nextPeak = null;
            }
        }

        // 4피크 리스트의 ±차이값: tide.js processCurrentDay와 동일
        // - 첫 피크는 어제 마지막 반대 피크 기준
        // - 마지막 피크는 내일 첫 반대 피크 기준 (오늘에 같은 종류 피크가 더 없을 때)
        var yLastHigh = lastOfType(yPeaks, 'high');
        var yLastLow  = lastOfType(yPeaks, 'low');
        var tFirstHigh = firstOfType(tPeaks, 'high');
        var tFirstLow  = firstOfType(tPeaks, 'low');
        for (var j = 0; j < peaks.length; j++) {
            var p = peaks[j];
            var dprev = null;
            // (a) 오늘 배열 안에서 직전 반대 피크
            for (var k = j - 1; k >= 0; k--) {
                if (peaks[k].type !== p.type) { dprev = peaks[k]; break; }
            }
            // (b) 없으면 어제 마지막 반대 피크
            if (!dprev) {
                dprev = (p.type === 'high') ? yLastLow : yLastHigh;
            }
            // (c) 그래도 없으면 내일 첫 반대 피크 (배열 양끝 보호)
            if (!dprev) {
                dprev = (p.type === 'high') ? tFirstLow : tFirstHigh;
            }
            p.diff = dprev ? (p.level - dprev.level) : null;
        }

        // ❸ 모든 피크 표시 (각 최대 4개) — slice(0,2) cap 제거
        var highs = peaks.filter(function (p) { return p.type === 'high'; }).slice(0, 4);
        var lows  = peaks.filter(function (p) { return p.type === 'low'; }).slice(0, 4);

        // 현재 조위 (오늘만) — 게이지 바로 위 정 가운데에 삽입.
        // [시트 슬라이더 연계] 라벨은 슬라이더 시각의 HH:MM 그대로 표기.
        // 예: 슬라이더 value=0 (real now 07:42) → "07:42 예상 조위"
        // 예: 슬라이더 value=3 (09:00) → "09:00 예상 조위"
        var currentHtml = '';
        if (todayMode && prevPeak && nextPeak) {
            var curLevel = interpolateLevel(prevPeak, nextPeak, nowMin);
            var rising = nextPeak.type === 'high';
            var lblHH = String(dateObj.getHours()).padStart(2, '0');
            var lblMM = String(dateObj.getMinutes()).padStart(2, '0');
            var labelText = lblHH + ':' + lblMM + ' 예상 조위';
            currentHtml =
                '<div class="ocean-tide-current-top">' +
                  '<span class="ocean-tide-current-label">' + labelText + '</span>' +
                  '<span class="ocean-tide-current-val">' + Math.round(curLevel) + ' cm</span>' +
                  '<span class="ocean-tide-current-arrow ' + (rising ? 'is-up' : 'is-down') + '">' +
                    (rising ? '▲' : '▼') +
                  '</span>' +
                '</div>';
        }

        // 일조부등 판별: 하루에 고조 1회·저조 1회(총 2피크 이하)인 경우
        // → 조석 게이지(진행 막대) 없이 고조/저조 목록만 표시
        var isDiurnal = (peaks.length <= 2);

        // 헤더: "다음" 피크 / "그 다음" 피크 (오늘 + 반일조 해역에서만 진행 막대 표시).
        // nowMin 명시 전달 (dateObj 시각 기준) — 슬라이더 시간 변경 시 진행바 위치 일치.
        var headHtml = isDiurnal ? '' : renderHeadHtml(prevPeak, nextPeak, todayMode, peaks, currentHtml, nowMin);

        // 4피크 리스트
        var peaksHtml =
            '<div class="ocean-tide-peaks">' +
              renderPeakGroup('고조', 'is-high', highs, '▲') +
              renderPeakGroup('저조', 'is-low',  lows,  '▼') +
            '</div>';

        var idwBadge = isIdw
            ? '<div class="ocean-tide-idw-badge">표준항 보간 결과</div>' : '';

        // 물때 산출: tide.js의 computeMulddae() 전역 함수를 사용
        // peaks(오늘), yPeaks(어제), tPeaks(내일) 피크 배열과 M2/S2 조화상수를 전달
        // 날짜가 바뀔 때마다 renderTideData가 다시 호출되므로 자동으로 갱신됨
        var mulddaeBadgeHtml = '';
        if (typeof computeMulddae === 'function') {
            var tbRow0 = (data.tideBedData && data.tideBedData.length > 0)
                ? data.tideBedData[0]
                : null;
            // neighbors에 담아온 좌표로 서해 여부 판별
            var sheetLat = (neighbors && typeof neighbors.lat === 'number') ? neighbors.lat : null;
            var sheetLon = (neighbors && typeof neighbors.lon === 'number') ? neighbors.lon : null;
            var mulddaeInfo = computeMulddae(
                peaks,     // 오늘 피크 [{type, minutes, level}]
                yPeaks,    // 어제 피크 (방향 판단용)
                tPeaks,    // 내일 피크 (평균 대조차 추정 보조)
                tbRow0,    // M2/S2 조화상수 행
                dateObj,   // 기준 날짜 (월령 계산용)
                sheetLat,  // 위도 (서해 판별)
                sheetLon   // 경도 (서해 판별)
            );
            if (mulddaeInfo) {
                // '조석' 타이틀 옆에 소괄호 형태로 표시: ≋ 조석  (1물)
                mulddaeBadgeHtml =
                    '<span class="ocean-tide-mulddae-badge">(' + mulddaeInfo.label + ')</span>';
            }
        }

        card.style.display = '';
        card.innerHTML =
            '<div class="ocean-tide-wrap">' +
              '<div class="ocean-tide-title-row">' +
                '<div class="ocean-tide-title"><i class="fa-solid fa-water"></i> 조석' +
                  mulddaeBadgeHtml +
                '</div>' +
                idwBadge +
              '</div>' +
              headHtml +
              peaksHtml +
            '</div>';

        // [멀티 데이 캐시 저장 — 2026-05]
        // 같은 해점에서 방문한 모든 날짜를 누적 보관.
        //   - 같은 날 시간 이동: refreshTideGaugeForTime 이 캐시의 peaks 로 게이지만 재계산
        //   - 다른 날 방문했다가 복귀: fetchTideForSheet 진입 시 캐시 hit → API skip
        //   - 다른 좌표로 이동: putCachedDay 가 좌표 불일치 감지하면 days 통째 reset
        //
        // raw data + neighbors 를 그대로 저장 — 재방문 시 renderTideData 가 동일한
        // 입력으로 호출되어 동일한 DOM 을 생성. peaks 자체도 OS.state._tideRenderState 에
        // 저장 (게이지 부분 갱신용; 매 렌더 시 갱신).
        var cacheLat = OS.state.lat;
        var cacheLon = OS.state.lon;
        putCachedDay(cacheLat, cacheLon, dayKeyOf(dateObj), {
            data: data,
            isIdw: !!isIdw,
            neighbors: neighbors || null
        });

        // [Bonus 캐시] 같은 호출에서 폴링된 yesterday/tomorrow raw data 도 별도 dayKey 로 저장.
        // 사용자가 슬라이더로 어제/내일 이동 시 즉시 캐시 hit (API skip).
        // 이미 명시적으로 그 dayKey 가 캐시되어 있으면 덮어쓰지 않음 (그 날의 풀 render 결과
        // 가 더 정확한 isIdw/neighbors 를 갖고 있을 수 있음).
        if (neighbors) {
            if (neighbors.yesterday) {
                var yKey = shiftDayKey(dateObj, -1);
                if (!getCachedDay(cacheLat, cacheLon, yKey)) {
                    putCachedDay(cacheLat, cacheLon, yKey, {
                        data: neighbors.yesterday,
                        isIdw: !!isIdw,
                        neighbors: null  // 어제의 어제/내일은 별도 fetch 없이는 알 수 없음
                    });
                }
            }
            if (neighbors.tomorrow) {
                var tKey = shiftDayKey(dateObj, +1);
                if (!getCachedDay(cacheLat, cacheLon, tKey)) {
                    putCachedDay(cacheLat, cacheLon, tKey, {
                        data: neighbors.tomorrow,
                        isIdw: !!isIdw,
                        neighbors: null
                    });
                }
            }
        }

        // [게이지 부분 갱신용 작업 캐시]
        // refreshTideGaugeForTime 은 "현재 카드에 표시 중인 날짜" 의 peaks 가 필요.
        // 매번 days 에서 재계산해도 되지만, 직전 렌더 결과를 보관해 두면 부분 갱신이
        // 즉각적 (peaks 재추출 skip). 좌표/dayKey 도 함께 저장해 stale 차단.
        OS.state._tideRenderState = {
            peaks: peaks.slice(),
            yPeaks: yPeaks.slice(),
            tPeaks: tPeaks.slice(),
            dataDayKey: dayKeyOf(dateObj),
            lat: OS.state.lat,
            lon: OS.state.lon
        };

        // ❷ 첫 렌더 성공 표시 — 이후 폴링에서 'error' 와도 카드 유지
        _tideFirstRenderSucceeded = true;
    };

    /* --------------------------------------------------------------
     * 시트 슬라이더 release 시 호출 — 조석 API 호출 없이
     * 게이지/예상조위/라벨/진행%/남은시간만 갱신.
     *
     * [캐시 정책 — 2026-05 멀티 데이]
     *   사용자 의도: "같은 해점이면 슬라이더 어디로 가도 캐시 사용 (API 호출 X)".
     *
     *   처리 분기:
     *   - sheetDate 가 _tideRenderState.dataDayKey 와 같은 날 (현재 카드에 그려진 날):
     *       카드 DOM 그대로 두고 게이지(label/val/arrow/fill/marker/remain) 만 부분 갱신.
     *   - sheetDate 가 카드 표시 날짜와 다르지만 _tideMultiDayCache 에 있는 경우:
     *       fetchTideForSheet 가 캐시 hit 으로 풀 renderTideData 호출 → 새 날짜 카드 그림.
     *       이 함수는 false 반환해 호출자가 fetchTideForSheet 경로로 가도록 유도.
     *       (반환값은 "이미 처리 완료" 의미가 아니라 "부분 갱신으로 처리 완료" 의미.)
     *   - 캐시 자체 없음/좌표 mismatch: false 반환.
     *
     * @param {Date} sheetDate - 슬라이더가 가리키는 새 시각
     * @returns {boolean} 게이지 부분 갱신만으로 처리 완료된 경우 true.
     *                    (false 면 호출자가 fetchTideForSheet 로 풀 재렌더 필요 — 캐시 hit 이어도
     *                     API 는 안 나가지만 renderTideData 풀 호출이 필요.)
     * ------------------------------------------------------------ */
    OS.refreshTideGaugeForTime = function (sheetDate) {
        var renderState = OS.state && OS.state._tideRenderState;
        if (!renderState) return false;

        // [좌표 일치 검증] 다른 좌표로 시트 재오픈된 직후 슬라이더 release 시
        // 이전 좌표의 stale peaks 로 게이지 표시되지 않도록 차단.
        if (renderState.lat !== OS.state.lat || renderState.lon !== OS.state.lon) return false;

        // 현재 카드에 그려진 날짜와 sheetDate 가 같은 날인지 확인.
        // 다르면 부분 갱신으로 처리 불가 — false 반환해 호출자가 풀 renderTideData 경로로 보냄.
        // (단, fetchTideForSheet 는 multi-day cache 적중 시 API 호출 없이 즉시 렌더하므로
        // 사용자가 느끼는 비용은 DOM 재구성뿐.)
        if (renderState.dataDayKey !== dayKeyOf(sheetDate)) return false;

        var peaks = renderState.peaks;
        var yPeaksLocal = renderState.yPeaks;
        var tPeaksLocal = renderState.tPeaks;

        // 게이지는 오늘만 표시 — 미래/과거 일 때는 캐시로 처리는 성공이지만 게이지 갱신은 skip.
        if (!OS.isToday(sheetDate)) return true;

        var nowMin = sheetDate.getHours() * 60 + sheetDate.getMinutes();
        if (!peaks || peaks.length === 0) return true;

        // prev/next 피크 — renderTideData 와 동일 알고리즘
        var prevPeak = null, nextPeak = null;
        for (var i = 0; i < peaks.length; i++) {
            if (peaks[i].minutes > nowMin) {
                nextPeak = peaks[i];
                if (i > 0) {
                    prevPeak = peaks[i - 1];
                } else if (yPeaksLocal && yPeaksLocal.length > 0) {
                    var yLast = yPeaksLocal[yPeaksLocal.length - 1];
                    prevPeak = { type: yLast.type, level: yLast.level, minutes: yLast.minutes - 1440 };
                }
                break;
            }
        }
        if (!nextPeak) {
            if (peaks.length > 0) prevPeak = peaks[peaks.length - 1];
            if (tPeaksLocal && tPeaksLocal.length > 0) {
                var tFirst = tPeaksLocal[0];
                nextPeak = { type: tFirst.type, level: tFirst.level, minutes: tFirst.minutes + 1440 };
            }
        }
        if (!prevPeak || !nextPeak) return true;
        var dur = nextPeak.minutes - prevPeak.minutes;
        if (dur > 780 || dur <= 0) return true;

        var curLevel = interpolateLevel(prevPeak, nextPeak, nowMin);
        var rising = nextPeak.type === 'high';
        var pctVal = ((nowMin - prevPeak.minutes) / dur) * 100;
        if (pctVal < 0) pctVal = 0;
        if (pctVal > 100) pctVal = 100;

        // DOM 부분 갱신 — card scope 안에서만 (전역 querySelector 충돌 방지)
        var card = document.getElementById('ocean-card-tide');
        if (!card) return true;
        var labelEl  = card.querySelector('.ocean-tide-current-label');
        var valEl    = card.querySelector('.ocean-tide-current-val');
        var arrowEl  = card.querySelector('.ocean-tide-current-arrow');
        var fillEl   = card.querySelector('.ocean-tide-progress-fill');
        var markerEl = card.querySelector('.ocean-tide-progress-marker');
        var remainEl = card.querySelector('.ocean-tide-progress-remain');

        if (labelEl) {
            var hh = String(sheetDate.getHours()).padStart(2, '0');
            var mm = String(sheetDate.getMinutes()).padStart(2, '0');
            labelEl.textContent = hh + ':' + mm + ' 예상 조위';
        }
        if (valEl) valEl.textContent = Math.round(curLevel) + ' cm';
        if (arrowEl) {
            arrowEl.classList.toggle('is-up', rising);
            arrowEl.classList.toggle('is-down', !rising);
            arrowEl.textContent = rising ? '▲' : '▼';
        }
        var gradient = rising
            ? 'linear-gradient(90deg, #991b1b 0%, #ef4444 100%)'
            : 'linear-gradient(90deg, #1e3a8a 0%, #3b82f6 100%)';
        if (fillEl) {
            fillEl.style.width = pctVal.toFixed(1) + '%';
            fillEl.style.background = gradient;
        }
        if (markerEl) markerEl.style.left = pctVal.toFixed(1) + '%';
        if (remainEl) {
            var remainStr = formatRemain(Math.max(0, nextPeak.minutes - nowMin));
            remainEl.textContent =
                (rising ? '고조까지' : '저조까지') + ' 남은시간 ' + remainStr;
        }
        return true;
    };

    /* --------------------------------------------------------------
     * 내부: 헤더 (좌:다음피크 / 가운데:진행막대 / 우:그 다음 피크)
     * ------------------------------------------------------------ */
    function renderHeadHtml(prevPeak, nextPeak, todayMode, peaks, currentHtml, nowMinArg) {
        // 어제/내일 보기 (todayMode=false) — 게이지 영역 자체 없음.
        if (!todayMode) return '';

        // 오늘 보기인데 직전·다음 피크 계산 불가 — 일반적으로 다음 두 경우:
        //  ① 새벽/심야 — 어제(yesterday) 또는 내일(tomorrow) 의 피크가 필요한데
        //     아직 폴링에서 도착 안 함 (조석 점진 로딩 중)
        //  ② 이웃 데이터 도착 후에도 듀레이션 무효(>780분 또는 ≤0)
        // 첫 케이스는 곧 도착할 가능성이 큼 → 게이지 자리에 로딩 스피너 표시.
        // 4피크 리스트는 별도로 정상 표시되므로 사용자는 이미 핵심 정보(고조/저조 시각)
        // 를 볼 수 있고, 게이지만 잠시 후 채워짐.
        if (!prevPeak || !nextPeak) {
            return (
                '<div class="ocean-tide-head ocean-tide-head-loading">' +
                  '<div class="ocean-tide-gauge-spinner"></div>' +
                  '<div class="ocean-tide-gauge-spinner-text">게이지 정보를 불러오는 중...</div>' +
                '</div>'
            );
        }

        // tide.js와 동일: 좌측=직전(prev) 피크, 우측=다음(next) 피크
        var leftCls = prevPeak.type === 'high' ? 'is-high' : 'is-low';
        var leftLabelText = prevPeak.type === 'high' ? '고조' : '저조';
        var leftTimeText = minutesToHHMM(prevPeak.minutes);

        var rightCls = nextPeak.type === 'high' ? 'is-high' : 'is-low';
        var rightLabelText = nextPeak.type === 'high' ? '고조' : '저조';
        var rightTimeText = minutesToHHMM(nextPeak.minutes);

        // nowMinArg 미전달 시 (구 호출 호환) 실제 now 사용
        var nowMin = (typeof nowMinArg === 'number') ? nowMinArg : nowMinutes();
        var pct = ((nowMin - prevPeak.minutes) / (nextPeak.minutes - prevPeak.minutes)) * 100;
        if (pct < 0) pct = 0;
        if (pct > 100) pct = 100;

        var remainMin = Math.max(0, nextPeak.minutes - nowMin);
        var remainStr = formatRemain(remainMin);
        var remainText = (nextPeak.type === 'high' ? '고조까지' : '저조까지') + ' 남은시간 ' + remainStr;

        // tide.js getTideProgressHTML과 동일한 색상 테마
        // - rising(다음=고조): #991b1b → #ef4444 빨강 그라데이션
        // - falling(다음=저조): #1e3a8a → #3b82f6 파랑 그라데이션
        var rising = nextPeak.type === 'high';
        var gradient = rising
            ? 'linear-gradient(90deg, #991b1b 0%, #ef4444 100%)'
            : 'linear-gradient(90deg, #1e3a8a 0%, #3b82f6 100%)';

        var centerHtml = currentHtml || '<div class="ocean-tide-current-top"></div>';

        return (
            '<div class="ocean-tide-head">' +
              // 게이지 상단: 고조 라벨 / 현재 예상 조위 / 저조 라벨
              '<div class="ocean-tide-head-labels">' +
                '<div class="ocean-tide-head-side ' + leftCls + '">' +
                  '<div class="ocean-tide-head-label-text">' + leftLabelText + '</div>' +
                '</div>' +
                centerHtml +
                '<div class="ocean-tide-head-side ' + rightCls + '">' +
                  '<div class="ocean-tide-head-label-text">' + rightLabelText + '</div>' +
                '</div>' +
              '</div>' +
              // 게이지
              '<div class="ocean-tide-progress-track">' +
                '<div class="ocean-tide-progress-fill" style="width:' + pct.toFixed(1) + '%; background:' + gradient + ';"></div>' +
                '<div class="ocean-tide-progress-marker" style="left:' + pct.toFixed(1) + '%"></div>' +
              '</div>' +
              // 게이지 하단: 좌시각 / 남은시간(가운데) / 우시각
              '<div class="ocean-tide-head-times">' +
                '<div class="ocean-tide-head-time ' + leftCls + '">' + leftTimeText + '</div>' +
                '<div class="ocean-tide-progress-remain">' + remainText + '</div>' +
                '<div class="ocean-tide-head-time ' + rightCls + '">' + rightTimeText + '</div>' +
              '</div>' +
            '</div>'
        );
    }

    /* --------------------------------------------------------------
     * 내부: 4피크 그룹 렌더 (고조 2건 또는 저조 2건)
     * ------------------------------------------------------------ */
    function renderPeakGroup(labelText, cls, list, arrow) {
        if (list.length === 0) return '';
        var rowsHtml = list.map(function (p) {
            var diff = p.diff;
            var sign = '';
            var digits = '';
            if (diff != null) {
                var rounded = Math.round(diff);
                sign = (rounded > 0) ? '+' : (rounded < 0 ? '−' : '');
                digits = String(Math.abs(rounded));
            }
            return (
                '<div class="ocean-tide-peak-row">' +
                  '<div class="ocean-tide-peak-left">' +
                    '<span class="ocean-tide-peak-time">' + minutesToHHMM(p.minutes) + '</span>' +
                    '<span class="ocean-tide-peak-cm">(' + Math.round(p.level) + ' cm)</span>' +
                  '</div>' +
                  '<div class="ocean-tide-peak-right ' + cls + '">' +
                    '<span class="ocean-tide-peak-arrow">' + arrow + '</span>' +
                    '<span class="ocean-tide-peak-sign">' + sign + '</span>' +
                    '<span class="ocean-tide-peak-digits">' + digits + '</span>' +
                  '</div>' +
                '</div>'
            );
        }).join('');
        return (
            '<div class="ocean-tide-peak-group">' +
              '<div class="ocean-tide-peak-label ' + cls + '">' + labelText + '</div>' +
              '<div class="ocean-tide-peak-rows">' + rowsHtml + '</div>' +
            '</div>'
        );
    }

    /* --------------------------------------------------------------
     * 내부: highTide1~4 / lowTide1~4 → 통일 배열로
     * ------------------------------------------------------------ */
    function collectPeaks(data) {
        var arr = [];
        for (var i = 1; i <= 4; i++) {
            var hi = data['highTide' + i];
            if (hi && hi.time) {
                arr.push({ type: 'high', minutes: hhmmToMinutes(hi.time), level: parseFloat(hi.height || hi.level || 0) });
            }
            var lo = data['lowTide' + i];
            if (lo && lo.time) {
                arr.push({ type: 'low', minutes: hhmmToMinutes(lo.time), level: parseFloat(lo.height || lo.level || 0) });
            }
        }
        // 폴백: data.analysis 배열 형식도 처리
        if (arr.length === 0 && Array.isArray(data.analysis)) {
            data.analysis.forEach(function (p) {
                arr.push({
                    type: p.type === 'high' ? 'high' : 'low',
                    minutes: hhmmToMinutes(p.time),
                    level: parseFloat(p.level || 0)
                });
            });
        }
        return arr;
    }

    /* --------------------------------------------------------------
     * 내부: 특정 type의 첫/마지막 피크 (cross-day 변화량 계산용)
     * ------------------------------------------------------------ */
    function firstOfType(arr, type) {
        for (var i = 0; i < arr.length; i++) if (arr[i].type === type) return arr[i];
        return null;
    }
    /**
     * 배열을 뒤에서부터 훑어 마지막으로 type 이 일치하는 항목 반환.
     * firstOfType 의 역순. 만조/간조 분기 시 "오늘 마지막 만조" 추적용.
     */
    function lastOfType(arr, type) {
        for (var i = arr.length - 1; i >= 0; i--) if (arr[i].type === type) return arr[i];
        return null;
    }

    /* --------------------------------------------------------------
     * 내부: 사인 보간으로 두 피크 사이의 현재 조위를 추정
     * ------------------------------------------------------------ */
    function interpolateLevel(prevPeak, nextPeak, currentMin) {
        var span = nextPeak.minutes - prevPeak.minutes;
        if (span <= 0) return prevPeak.level;
        var t = (currentMin - prevPeak.minutes) / span; // 0~1
        // cosine 보간 (조위 곡선 근사)
        var blend = (1 - Math.cos(t * Math.PI)) / 2;
        return prevPeak.level + (nextPeak.level - prevPeak.level) * blend;
    }

    /* --------------------------------------------------------------
     * 내부 유틸
     * ------------------------------------------------------------ */
    function nowHHMM() {
        var d = new Date();
        return String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
    }
    /**
     * 현재 시각을 "0시 0분으로부터의 분" 단위로 반환 (0~1439).
     * 조석 피크와 비교용 — interpolateLevel 의 currentMin 계산.
     */
    function nowMinutes() {
        var d = new Date();
        return d.getHours() * 60 + d.getMinutes();
    }
    /**
     * "HH:MM" 또는 "HHMM" 문자열을 분(0~1439)으로 변환.
     * ':' 포함 여부로 두 포맷 모두 지원.
     *
     * @param {string|null} s
     * @returns {number}
     */
    function hhmmToMinutes(s) {
        if (!s) return 0;
        s = String(s);
        if (s.indexOf(':') >= 0) {
            var p = s.split(':');
            return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
        }
        s = s.padStart(4, '0');
        return parseInt(s.substring(0, 2), 10) * 60 + parseInt(s.substring(2, 4), 10);
    }
    /**
     * 분(0 또는 외 값)을 "HH:MM" 으로 변환. 음수·1440+ 값도 24h 모듈로 정규화.
     * 자정 넘김(cross-day) 보정으로 안전.
     */
    function minutesToHHMM(m) {
        // cross-day 보정으로 음수 또는 1440 이상 값이 들어올 수 있음 → 24h 모듈로
        var n = ((m % 1440) + 1440) % 1440;
        var h = Math.floor(n / 60);
        var mm = n % 60;
        return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    }
    /**
     * 분 단위 잔여 시간을 "HH:MM" 으로 포맷 ("다음 만조까지 02:14" 등).
     * minutesToHHMM 과 비슷하지만 모듈로 처리 안 함 (잔여시간은 0 이상이 보장됨).
     */
    function formatRemain(m) {
        var h = Math.floor(m / 60);
        var mm = m % 60;
        return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    }
    /**
     * HTML 안전 escape — 사용자 입력이 들어가는 위치(메시지/이름 등) 에 사용.
     * &, <, >, ", ' 5종 모두 처리.
     */
    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
        });
    }
})();
