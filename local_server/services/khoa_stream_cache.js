/**
 * ============================================================================
 * 파일명: services/khoa_stream_cache.js
 * 역할: KHOA 해아름 stream-vector 데이터의 서버측 가공·압축·캐시·디스크 백업
 * ============================================================================
 *
 * [설명]
 *   국립해양조사원(KHOA) 의 dynamic-stream-vector 응답을 한 번만 외부에서 받아
 *   - 결측점(s/d/temp 모두 0) 필터
 *   - 불필요 필드(salt, zeta) 제거 — lat/lon/s/d/temp 5필드만 보관
 *   - 양자화: s→0.01, d→정수, temp→0.1 단위 (전송 바이트 절감 + JSON 가독)
 *   - 5×5 가우시안 평활화 (cm/s 환산 후 crsp/crdir 기준으로 1회 통과)
 *   - 메모리 캐시 (key='YYYYMMDD_HH') + gzip 디스크 백업 (cold start 대응)
 *   - In-flight 중복제거: 같은 (date,hour) 동시 요청은 하나의 Promise 공유
 *
 * [기존 routes/ocean1.js 와의 차이]
 *   기존: 원본 KHOA JSON 의 점 리스트(salt/zeta 포함)를 그대로 메모리 캐시 →
 *         매 클라이언트가 ~1MB JSON 을 받아 직접 가공/평활화.
 *   변경: 서버에서 가공·평활·양자화·필터링 완료 → 클라이언트는 즉시 렌더.
 *
 * [공개 API]
 *   - getStream(date, hour) : Promise<{ ts, points, meta, _failed?, _reason? }>
 *       points 는 가공 후의 [{ lat, lon, s, d, temp }] 배열 (s 는 m/s, d 는 deg,
 *       temp 는 °C). routes/ocean1.js 는 이 모듈을 통해 데이터를 얻는다.
 *   - refreshCycle(opts) : 현재 시각 ~ +72h (총 73 슬롯) 를 ~500ms 간격으로
 *       순차 fetch. scheduler.js 가 30분 주기로 호출.
 *   - hydrateFromDisk() : 부팅 시 gzip 백업을 읽어 메모리 캐시 복원.
 *   - getCacheSnapshot() : 디버그용 — 현재 캐시 상태(키, 점 수) 요약.
 *
 * [API 응답 호환]
 *   /api/ocean/khoa-stream-vector 와 /api/ocean/khoa-stream-nearest 는
 *   각각 ocean_overlay.js (s, d, temp) 와 ocean_bottom_sheet5.js (s, d, temp 만)
 *   를 사용한다. salt/zeta 는 클라이언트에서 미사용 — 안전하게 제거 가능.
 *   호환을 위해 nearest 응답은 기존 필드(crdir, crsp, wtem) 형태 유지.
 *
 * [연계]
 *   - routes/ocean1.js   : 메모리 캐시 + fetch 로직을 이 모듈로 이관
 *   - scheduler.js       : refreshCycle() 을 30분 주기 cron 으로 호출
 *   - server.js          : startup 단계에서 hydrateFromDisk() 호출
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { DATA_DIR } = require('../config/server_config');

// ============================================================================
// 설정
// ============================================================================

const KHOA_STREAM_BASE =
    'https://www.khoa.go.kr/oceandata/oceaninfo/prediction/dynamic-stream-vector.do';

// 메모리 캐시 TTL — 30분(스케줄러 주기) + 여유 30분. 스케줄러가 정상 동작
// 중이면 매 30분마다 덮어쓰므로 TTL 만료 자체는 발생하지 않는다.
const CACHE_TTL_MS = 60 * 60 * 1000;

// upstream 실패는 30초간 캐시 — 외부 KHOA 폭주 차단
const FAIL_TTL_MS = 30 * 1000;

// 디스크 백업 파일 경로
const DISK_BACKUP_PATH = path.join(DATA_DIR, 'khoa_stream_cache.json.gz');

// [stale 보호] KHOA 가 장시간(>1h) 다운된 후 서버 재시작 시 캐시 전부 만료 →
// 빈 화면 노출 위험. MAX_STALE_MS(24h) 이내라면 stale flag 와 함께라도 복원해
// "오래된 데이터지만 일단 표시" → "아무것도 안 보임" 보다 사용자 경험 우수.
const MAX_STALE_MS = 24 * 60 * 60 * 1000;

// 스케줄러 순차 fetch 시 KHOA 부하 회피용 슬립
const SEQUENTIAL_DELAY_MS = 500;

// 스케줄러 1회 사이클이 미리 채울 시간 범위 (현재 시각 포함, 총 73 슬롯)
const REFRESH_HOURS_AHEAD = 72;

// ============================================================================
// 메모리 캐시 상태
// ============================================================================

// 캐시 entry: { ts, points: [{lat,lon,s,d,temp}], meta }
const _cache = new Map();

// upstream 실패 캐시: { ts, reason }
const _failCache = new Map();

// In-flight Promise dedup — 같은 키에 대한 동시 외부 fetch 차단
const _khoaPending = new Map();

function _cacheKey(date, hour) { return date + '_' + hour; }

// ============================================================================
// 양자화 / 평활화 / 가공
// ============================================================================

/** 0.01 단위 반올림 — s(m/s) 용 (1.234 → 1.23) */
function _q01(v) {
    if (typeof v !== 'number' || !isFinite(v)) return 0;
    return Math.round(v * 100) / 100;
}
/** 0.1 단위 반올림 — temp(°C) 용 (18.456 → 18.5) */
function _q1(v) {
    if (typeof v !== 'number' || !isFinite(v)) return 0;
    return Math.round(v * 10) / 10;
}
/** 정수 반올림(0~359 범위로 정규화) — d(deg) 용 */
function _qDeg(v) {
    if (typeof v !== 'number' || !isFinite(v)) return 0;
    let r = Math.round(v);
    if (r < 0) r = ((r % 360) + 360) % 360;
    if (r >= 360) r = r % 360;
    return r;
}

/**
 * 5×5 가우시안 평활화 (ocean_overlay.js:_smoothCurrentGrid5x5 의 서버 포팅).
 *
 * 입력/출력 모두 [{ lat, lon, s, d, temp }] 배열.
 *   - s(m/s): 가중평균 (가중치 합 = 256)
 *   - d(deg): sin/cos 분해 후 가중합 → atan2 로 재합성 (0/360 경계 안전)
 *   - temp(°C): s 와 동일 패턴 가중평균
 *
 * 이웃 격자가 없는 셀(육지·격자 끝)은 자기 자신만으로 평균이 잡혀
 * 사실상 원본 값을 유지한다. 가중치 36(자기)/256 = 14% 비중.
 */
function _smoothGrid5x5(points) {
    if (!Array.isArray(points) || points.length === 0) return points;

    const W = [
        [1,  4,  6,  4, 1],
        [4, 16, 24, 16, 4],
        [6, 24, 36, 24, 6],
        [4, 16, 24, 16, 4],
        [1,  4,  6,  4, 1]
    ];

    // 정렬된 unique lon/lat → 격자 인덱스
    const lonSet = new Set();
    const latSet = new Set();
    for (let i = 0; i < points.length; i++) {
        lonSet.add(points[i].lon);
        latSet.add(points[i].lat);
    }
    const lonArr = Array.from(lonSet).sort((a, b) => a - b);
    const latArr = Array.from(latSet).sort((a, b) => a - b);
    const lonIdx = new Map();
    const latIdx = new Map();
    for (let i = 0; i < lonArr.length; i++) lonIdx.set(lonArr[i], i);
    for (let i = 0; i < latArr.length; i++) latIdx.set(latArr[i], i);
    const grid = new Map();
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        grid.set(lonIdx.get(p.lon) + '_' + latIdx.get(p.lat), p);
    }

    const out = new Array(points.length);
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const li = lonIdx.get(p.lon);
        const lj = latIdx.get(p.lat);
        let sumS = 0, sumT = 0, sumX = 0, sumY = 0, sumW = 0;
        for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
                const np = grid.get((li + dx) + '_' + (lj + dy));
                if (!np) continue;
                const w = W[dy + 2][dx + 2];
                sumS += (np.s || 0) * w;
                sumT += (np.temp || 0) * w;
                const rad = ((np.d || 0) * Math.PI) / 180;
                sumX += Math.sin(rad) * w;
                sumY += Math.cos(rad) * w;
                sumW += w;
            }
        }
        if (sumW === 0) {
            out[i] = { lat: p.lat, lon: p.lon, s: p.s, d: p.d, temp: p.temp };
            continue;
        }
        let newDir = (Math.atan2(sumX, sumY) * 180) / Math.PI;
        if (newDir < 0) newDir += 360;
        out[i] = {
            lat: p.lat,
            lon: p.lon,
            // 평활화 후 즉시 양자화 — 디스크/네트워크 바이트 절감
            s: _q01(sumS / sumW),
            d: _qDeg(newDir),
            temp: _q1(sumT / sumW)
        };
    }
    return out;
}

/**
 * KHOA 원본 응답 → 가공된 points 배열.
 *
 * 1) salt/zeta 등 미사용 필드 제거 → s/d/temp 만 보관
 * 2) 결측 격자(s/d/temp 모두 0)는 제거 — 육지/유효범위 밖
 *    (단 salt/zeta 가 있던 시절의 nearest 결측 조건과 일치하도록 보수적 검사)
 * 3) 양자화 적용
 * 4) 5×5 가우시안 평활화 1회 통과
 *
 * [지역 컷오프 없음] — 한반도 전 해역 그대로 유지. 일부 모바일 환경에서는
 * 응답 크기가 부담일 수 있으나, 양자화 후 1MB 가 ~300KB 까지 줄어 충분히
 * 감당 가능. 게다가 gzip 전송이 라우트에서 적용되므로 wire size 는 더 작아진다.
 */
function _normalizeRawPoints(rawArr) {
    const filtered = [];
    for (let i = 0; i < rawArr.length; i++) {
        const r = rawArr[i];
        if (!r || typeof r.lat !== 'number' || typeof r.lon !== 'number') continue;
        const s = typeof r.s === 'number' ? r.s : 0;
        const d = typeof r.d === 'number' ? r.d : 0;
        const temp = typeof r.temp === 'number' ? r.temp : 0;
        // 결측 격자 제거 (s/d/temp 모두 0 → 육지)
        if (s === 0 && d === 0 && temp === 0) continue;
        filtered.push({
            lat: r.lat,
            lon: r.lon,
            s: _q01(s),
            d: _qDeg(d),
            temp: _q1(temp)
        });
    }
    // 한 번에 평활화 (이미 양자화된 값 위에서 1회) → 그대로 캐시
    return _smoothGrid5x5(filtered);
}

// ============================================================================
// upstream fetch (raw)
// ============================================================================

async function _fetchUpstream(date, hour) {
    const upstream = KHOA_STREAM_BASE +
        '?obsCheck=EYS&pre_date=' + encodeURIComponent(date) +
        '&pre_hour=' + encodeURIComponent(hour);

    const fetchFn = global.fetch || require('node-fetch');
    const headers = {
        'Referer': 'https://www.khoa.go.kr/oceandata/oceaninfo/prediction/predictionDynamicStream.do',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'X-Requested-With': 'XMLHttpRequest',
        'Origin': 'https://www.khoa.go.kr'
    };

    const r = await fetchFn(upstream, { redirect: 'follow', headers: headers });
    if (!r.ok) {
        const body = await r.text();
        // [2026-05] 진단 강화 — 300자 → 1000자 (KHOA 가 보내는 HTML 오류 페이지
        // 의 전체 골격을 보기 위함)
        console.error('[KHOA-Stream] upstream', r.status, 'url:', upstream, 'body:', body.slice(0, 1000));
        throw new Error('khoa upstream ' + r.status);
    }

    const text = await r.text();
    if (!text || !text.trim()) {
        console.error('[KHOA-Stream] upstream returned empty body. url:', upstream);
        throw new Error('khoa empty body');
    }
    let json;
    try {
        json = JSON.parse(text);
    } catch (parseErr) {
        // [2026-05] 진단 강화 — 300자 → 1000자
        console.error('[KHOA-Stream] JSON parse fail. body:', text.slice(0, 1000));
        throw new Error('khoa response not JSON');
    }
    const hasAnyContainer = ['data', 'dataList', 'list', 'points', 'result', 'items']
        .some(k => json && Object.prototype.hasOwnProperty.call(json, k));
    if (!hasAnyContainer || json.success === false) {
        // [2026-05] 진단 강화 — 300자 → 1000자
        console.error('[KHOA-Stream] partial response — no data container. body:', text.slice(0, 1000));
        throw new Error('khoa partial response');
    }

    // KHOA data 컨테이너는 보통 2차원 배열 / 평면 배열 / 별도 키 — 모두 대응
    const flat = [];
    function _consume(arr) {
        for (const item of arr) {
            if (!item) continue;
            if (Array.isArray(item)) { _consume(item); continue; }
            if (typeof item.lat === 'number' && typeof item.lon === 'number') {
                flat.push(item);
            }
        }
    }
    const candidates = [json.data, json.dataList, json.list, json.points, json.result, json.items];
    for (const c of candidates) {
        if (Array.isArray(c)) _consume(c);
        if (flat.length > 0) break;
    }
    return { rawPoints: flat, meta: json.meta || {} };
}

// ============================================================================
// 공개 API: getStream — 캐시 우선, 미스 시 외부 fetch + 가공
// ============================================================================

/**
 * (date, hour) 의 가공된 KHOA stream 데이터 반환.
 * 메모리 캐시 hit → 즉시.
 * 미스 → upstream fetch + 가공 + 캐시 저장.
 * 동일 키 동시 요청 → 단일 Promise 공유 (in-flight dedup).
 */
async function getStream(date, hour) {
    const key = _cacheKey(date, hour);

    // 1) 메모리 캐시 hit
    const cached = _cache.get(key);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
        return cached;
    }

    // 2) 실패 캐시 hit — stale 폴백 우선, 없으면 빈 응답
    //    KHOA 일시 장애 + 디스크 hydrate 로 옛 데이터 보유 시: 빈 화면 대신
    //    옛 데이터라도 stale 플래그 부착해 노출 (사용자 경험 우수).
    const failed = _failCache.get(key);
    if (failed && (Date.now() - failed.ts) < FAIL_TTL_MS) {
        if (cached && (Date.now() - cached.ts) < MAX_STALE_MS) {
            return { ts: cached.ts, points: cached.points, meta: cached.meta,
                     stale: true, _failed: true, _reason: failed.reason };
        }
        return { ts: Date.now(), points: [], meta: {}, _failed: true, _reason: failed.reason };
    }

    // 3) In-flight dedup — 같은 키 동시 요청은 하나의 Promise 공유
    if (_khoaPending.has(key)) {
        return _khoaPending.get(key);
    }

    const promise = (async () => {
        try {
            const { rawPoints, meta } = await _fetchUpstream(date, hour);
            const points = _normalizeRawPoints(rawPoints);
            const entry = { ts: Date.now(), points, meta };
            _cache.set(key, entry);
            // 실패 캐시 잔재 정리 — 정상 복구 시 다음 폴링이 즉시 hit 되도록
            _failCache.delete(key);
            return entry;
        } catch (e) {
            _failCache.set(key, { ts: Date.now(), reason: e.message });
            // [stale 폴백] upstream 실패해도 24h 이내 옛 데이터 보유 시 그것 반환.
            // 호출자(routes/ocean1.js) 가 success:true 로 처리하되 stale 플래그로 구분 가능.
            if (cached && (Date.now() - cached.ts) < MAX_STALE_MS) {
                return { ts: cached.ts, points: cached.points, meta: cached.meta,
                         stale: true, _failed: true, _reason: e.message };
            }
            // 정말 폴백할 데이터도 없을 때만 throw → 호출자가 success:false 만듦
            throw e;
        } finally {
            // in-flight 항목은 성공/실패 무관 즉시 제거
            _khoaPending.delete(key);
        }
    })();

    _khoaPending.set(key, promise);
    return promise;
}

// ============================================================================
// 디스크 백업 (gzip JSON)
// ============================================================================

/**
 * 현재 메모리 캐시 전체를 gzip JSON 으로 디스크 백업.
 * 형식: { savedAt, entries: { 'YYYYMMDD_HH': { ts, points, meta } } }
 * 동기 write (fsync 없음) — 캐시 갱신 직후 호출이라 큰 임팩트 없음.
 */
function persistToDisk() {
    try {
        const entries = {};
        for (const [k, v] of _cache.entries()) {
            entries[k] = { ts: v.ts, points: v.points, meta: v.meta };
        }
        const payload = JSON.stringify({ savedAt: Date.now(), entries });
        const gz = zlib.gzipSync(payload);
        // 디렉토리 보장
        if (!fs.existsSync(DATA_DIR)) {
            try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) { /* 다른 일꾼이 그새 같은 폴더를 만들었으면 던진다 — 있으면 된 것이라 그대로 쓴다 */ }
        }
        // [원자적 쓰기] 부팅 직후 fire-and-forget refreshCycle 과 cron tick 이 우연히
        // 겹쳐 persistToDisk 가 동시에 호출돼도 파일이 깨지지 않도록 tmp → rename 패턴.
        // rename(2) 은 POSIX 에서 원자적 — 어느 시점에 누가 읽어도 항상 완성된 파일.
        const tmpPath = DISK_BACKUP_PATH + '.tmp';
        fs.writeFileSync(tmpPath, gz);
        fs.renameSync(tmpPath, DISK_BACKUP_PATH);
    } catch (e) {
        console.warn('[KHOA-Cache] 디스크 백업 실패:', e.message);
    }
}

/**
 * 부팅 시 디스크 백업을 메모리 캐시로 복원.
 * 파일 없으면 no-op. 손상되거나 TTL 초과 entry 는 무시.
 */
function hydrateFromDisk() {
    try {
        if (!fs.existsSync(DISK_BACKUP_PATH)) return 0;
        const gz = fs.readFileSync(DISK_BACKUP_PATH);
        const payload = JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
        const entries = payload && payload.entries;
        if (!entries) return 0;
        let restored = 0, stale = 0;
        const now = Date.now();
        for (const k of Object.keys(entries)) {
            const e = entries[k];
            if (!e || !Array.isArray(e.points)) continue;
            if (typeof e.ts !== 'number') continue;
            const age = now - e.ts;
            // 24시간 초과 → 정말 너무 오래된 데이터, 폐기.
            if (age > MAX_STALE_MS) continue;
            // 1시간 이내 → 신선 (정상 entry).
            // 1~24시간 → stale 플래그 부여하여 복원 (다음 refreshCycle 가 덮어쓰기 전까지
            //   빈 화면 대신 옛 데이터라도 노출).
            const isStale = age > CACHE_TTL_MS;
            _cache.set(k, {
                ts: e.ts,
                points: e.points,
                meta: e.meta || {},
                stale: isStale || undefined
            });
            if (isStale) stale++;
            restored++;
        }
        console.log('[KHOA-Cache] 디스크 백업 복원: ' + restored + ' 슬롯' +
            (stale > 0 ? ' (그 중 ' + stale + ' 슬롯은 1h 초과 stale)' : ''));
        return restored;
    } catch (e) {
        console.warn('[KHOA-Cache] 디스크 백업 복원 실패:', e.message);
        return 0;
    }
}

// ============================================================================
// 정기 수집 사이클 (scheduler.js 가 30분 주기로 호출)
// ============================================================================

/** ms 슬립 — 외부 KHOA 부하 회피용 (busy-wait 아님) */
function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Date → KHOA 의 (YYYYMMDD, HH) — KST 기준 */
function _toDateHour(d) {
    // 컨테이너 TZ=Asia/Seoul 가정 (Dockerfile 에서 ENV TZ=Asia/Seoul 설정)
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    return { date: y + m + day, hour: h };
}

// [동시 실행 가드] 부팅 직후 fire-and-forget refreshCycle 과 분 단위 cron tick 이
// 우연히 겹치는 경우(또는 한 사이클이 30분을 넘기는 비정상 상황) 두 사이클이 동시에
// 돌면 KHOA 부담이 두 배가 되고 캐시 갱신 순서가 꼬일 수 있다. 한 번에 한 사이클만
// 보장하기 위한 단순 부울 락.
let _refreshInProgress = false;

/**
 * 현재 시각 ~ +REFRESH_HOURS_AHEAD 시각까지 (현재 포함 총 73 슬롯) 순차 fetch.
 *
 * 각 슬롯 사이 ~500ms 슬립 → KHOA 폭주 회피.
 * 슬롯 실패는 다음 슬롯으로 그냥 진행 — _failCache 가 30초 후 자동 재시도 허용.
 *
 * 마지막에 persistToDisk() 1회 호출 — 매 슬롯마다 쓰면 디스크 I/O 가 큼.
 *
 * 중복 호출 방지: _refreshInProgress 가 true 면 즉시 skip + 로그.
 */
async function refreshCycle(opts) {
    const log = (opts && opts.log) || console.log;
    if (_refreshInProgress) {
        log('[KHOA-Cache] 정기 수집 skip — 이전 사이클 진행 중');
        return { ok: 0, fail: 0, elapsedMs: 0, skipped: true };
    }
    _refreshInProgress = true;
    const t0 = Date.now();
    log('[KHOA-Cache] 정기 수집 시작 (73 슬롯, ~' +
        Math.round(REFRESH_HOURS_AHEAD * SEQUENTIAL_DELAY_MS / 1000) + '초 예상)');

    const base = new Date();
    let ok = 0, fail = 0;
    try {
        for (let off = 0; off <= REFRESH_HOURS_AHEAD; off++) {
            const t = new Date(base.getTime() + off * 3600 * 1000);
            const { date, hour } = _toDateHour(t);
            try {
                await getStream(date, hour);
                ok++;
            } catch (e) {
                fail++;
                // 개별 슬롯 실패는 noisy 하므로 첫 3건만 출력
                if (fail <= 3) log('[KHOA-Cache] 슬롯 실패 ' + date + ' ' + hour + ': ' + e.message);
            }
            if (off < REFRESH_HOURS_AHEAD) {
                await _sleep(SEQUENTIAL_DELAY_MS);
            }
        }
        persistToDisk();
    } finally {
        // 예외/중단 무관 항상 락 해제 — 다음 cron tick 이 정상 진행되도록
        _refreshInProgress = false;
    }
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    log('[KHOA-Cache] 정기 수집 완료: 성공 ' + ok + ' / 실패 ' + fail + ' (소요 ' + elapsed + '초)');
    return { ok, fail, elapsedMs: Date.now() - t0 };
}

// ============================================================================
// 디버그 / 관리자용
// ============================================================================

function getCacheSnapshot() {
    const out = {};
    for (const [k, v] of _cache.entries()) {
        out[k] = { ts: v.ts, count: v.points.length };
    }
    return { entries: out, failKeys: Array.from(_failCache.keys()) };
}

module.exports = {
    getStream,
    refreshCycle,
    hydrateFromDisk,
    persistToDisk,
    getCacheSnapshot,
    // 테스트/내부용
    _normalizeRawPoints,
    _smoothGrid5x5
};
