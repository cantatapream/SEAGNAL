/**
 * ============================================================================
 * 파일명: routes/ocean1.js
 * 역할: 해양종합정보 메인 라우터 + 수심 조회 API
 * ============================================================================
 *
 * [설명]
 * 해양종합정보 지도에서 사용하는 API의 메인 진입점입니다.
 * 이 파일은 수심 조회 기능을 직접 제공하고,
 * 나머지 해양 API들(ocean2~5)을 하나로 묶어 등록합니다.
 *
 * - GET /api/ocean/depth → 특정 좌표의 수심 조회 (BADA2024 격자 데이터)
 *
 * [연계 파일]
 * - ocean2.js → ROMS 유향유속/수온 API
 * - ocean3.js → 기상청 풍향속 API
 * - ocean4.js → 파고 + 종합 데이터 API
 * - ocean5.js → 저질 AI 판독 API
 * - server.js → app.use()로 이 라우터 등록
 * - data/bathymetry/ → BADA2024 수심 격자 파일 (Fly.io Volume에 저장)
 *
 * [수심 데이터 구조]
 * bathymetry/ 폴더에 "lat{위도정수}_lon{경도정수}" 파일이 59개 있음
 * 각 파일은 CSV 형식: 경도,위도,수심(m)
 * 예: 125.407856,30.999858,63.930301
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { DATA_DIR } = require('../config/server_config');

// ============================================================================
// 수심 데이터 관련 설정
// ============================================================================

// 수심 데이터 파일이 저장된 폴더 경로
// [연계] Fly.io Volume → /app/local_server/data/bathymetry/
const BATHYMETRY_DIR = path.join(DATA_DIR, 'bathymetry');

// 사용 가능한 수심 파일 목록을 서버 시작 시 한번 읽어서 캐시
// → 매 요청마다 폴더를 읽지 않아도 되므로 성능 향상
let availableFiles = new Set();

/**
 * 서버 시작 시 수심 파일 목록 로드
 * - bathymetry/ 폴더에서 "lat숫자_lon숫자" 형태의 파일만 등록
 * - 파일이 없어도 에러 없이 빈 Set으로 유지 (내륙 좌표 등 대비)
 */
function loadBathymetryFileList() {
    try {
        if (fs.existsSync(BATHYMETRY_DIR)) {
            const files = fs.readdirSync(BATHYMETRY_DIR);
            files.forEach(f => {
                if (f.startsWith('lat')) {
                    availableFiles.add(f);
                }
            });
            console.log(`[Ocean] 수심 데이터 파일 ${availableFiles.size}개 감지`);
        } else {
            console.warn('[Ocean] 수심 데이터 폴더 없음:', BATHYMETRY_DIR);
        }
    } catch (e) {
        console.error('[Ocean] 수심 파일 목록 로드 실패:', e.message);
    }
}

// 서버 시작 시 파일 목록 로드
loadBathymetryFileList();

// ============================================================================
// API: 수심 조회
// ============================================================================

/**
 * GET /api/ocean/depth
 *
 * 특정 좌표의 수심을 BADA2024 격자 데이터에서 조회합니다.
 *
 * [동작 흐름]
 * 1. 클릭 좌표(lat, lon)를 받음
 * 2. 좌표의 정수 부분으로 해당 파일 결정 (예: 34.5, 126.3 → "lat34_lon126")
 * 3. 파일을 한 줄씩 읽으며 가장 가까운 격자점 검색
 * 4. 가장 가까운 점의 수심값 반환
 *
 * [요청 파라미터]
 * - lat (필수): 위도 (예: 34.5)
 * - lon (필수): 경도 (예: 126.3)
 *
 * [응답 예시]
 * { success: true, depth: 45.2, nearestLat: 34.498, nearestLon: 126.301, distance: 0.003 }
 */
router.get('/api/ocean/depth', async (req, res) => {
    try {
        const lat = parseFloat(req.query.lat);
        const lon = parseFloat(req.query.lon);

        // 파라미터 유효성 검사
        if (isNaN(lat) || isNaN(lon)) {
            return res.status(400).json({ success: false, error: '위도(lat)와 경도(lon)를 입력해주세요.' });
        }

        // 좌표의 정수 부분으로 파일명 결정
        // 예: lat=34.5, lon=126.3 → "lat34lat_lon126"
        // (Fly.io 볼륨의 실제 파일명 규칙: lat{N}lat_lon{M})
        const latKey = Math.floor(lat);
        const lonKey = Math.floor(lon);
        const fileName = `lat${latKey}lat_lon${lonKey}`;

        // 해당 파일이 존재하는지 캐시된 목록에서 확인
        if (!availableFiles.has(fileName)) {
            return res.json({ success: false, error: '해당 해역의 수심 데이터가 없습니다.' });
        }

        const filePath = path.join(BATHYMETRY_DIR, fileName);

        // 파일을 한 줄씩 읽으며 가장 가까운 격자점 탐색
        // - 전체 파일을 메모리에 올리지 않고 스트림으로 읽어 메모리 절약
        // - 각 줄의 좌표와 클릭 좌표의 거리를 계산하여 최솟값 추적
        const result = await findNearestDepth(filePath, lat, lon);

        if (result) {
            res.json({
                success: true,
                depth: result.depth,
                nearestLat: result.lat,
                nearestLon: result.lon,
                distance: result.distance
            });
        } else {
            res.json({ success: false, error: '수심 데이터를 찾을 수 없습니다.' });
        }
    } catch (e) {
        console.error('[Ocean] 수심 조회 오류:', e.message);
        res.status(500).json({ success: false, error: '수심 조회 중 오류가 발생했습니다.' });
    }
});

/**
 * 수심 파일에서 가장 가까운 격자점을 찾는 함수
 *
 * [동작 방식]
 * - 파일을 한 줄씩 스트림으로 읽음 (메모리 효율적)
 * - 각 줄: "경도,위도,수심" 형태의 CSV
 * - 클릭 좌표와의 유클리드 거리 계산
 * - 가장 가까운 점의 수심을 반환
 *
 * @param {string} filePath - 수심 파일 경로
 * @param {number} targetLat - 클릭한 위도
 * @param {number} targetLon - 클릭한 경도
 * @returns {Object|null} { lat, lon, depth, distance }
 */
function findNearestDepth(filePath, targetLat, targetLon) {
    return new Promise((resolve, reject) => {
        let nearest = null;
        let minDistSq = Infinity; // 거리의 제곱 (제곱근 계산 생략으로 성능 향상)

        const rl = readline.createInterface({
            input: fs.createReadStream(filePath),
            crlfDelay: Infinity
        });

        rl.on('line', (line) => {
            // 각 줄 파싱: "경도,위도,수심"
            const parts = line.split(',');
            if (parts.length < 3) return;

            const lon = parseFloat(parts[0]);
            const lat = parseFloat(parts[1]);
            const depth = parseFloat(parts[2]);

            if (isNaN(lon) || isNaN(lat) || isNaN(depth)) return;

            // 유클리드 거리의 제곱 (제곱근 생략 → 비교만 하면 되므로)
            const dLat = lat - targetLat;
            const dLon = lon - targetLon;
            const distSq = dLat * dLat + dLon * dLon;

            if (distSq < minDistSq) {
                minDistSq = distSq;
                nearest = { lat, lon, depth, distance: Math.sqrt(distSq) };
            }
        });

        rl.on('close', () => resolve(nearest));
        rl.on('error', (err) => reject(err));
    });
}

// ============================================================================
// API: 해양종합정보 설정 (프론트엔드에서 KHOA 맵 키 조회용)
// ============================================================================

/**
 * GET /api/ocean/config
 * 해양종합정보 프론트엔드에서 필요한 설정값을 반환합니다.
 * - KHOA_MAP_KEY: 해아름 지도 타일 API 키
 */
router.get('/api/ocean/config', (req, res) => {
    try {
        const config = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'api_config.json'), 'utf8'));
        res.json({
            KHOA_MAP_KEY: config.KHOA_MAP_KEY || ''
        });
    } catch (e) {
        res.json({ KHOA_MAP_KEY: '' });
    }
});

// ============================================================================
// KHOA 해아름 WMS 프록시
// ============================================================================
// KHOA WMS는 HTTPS → HTTP 302 리다이렉트를 보내서 브라우저가 mixed-content로
// 차단합니다. 서버에서 대신 받아 PNG만 클라이언트에 전달합니다.
//
// GET /api/ocean/khoa-wms?layer=BASEMAP_RLTM3857&BBOX=...&WIDTH=256&...
router.get('/api/ocean/khoa-wms', async (req, res) => {
    try {
        const layer = req.query.layer;
        if (!layer || !/^[A-Z0-9_]+$/i.test(layer)) {
            return res.status(400).send('invalid layer');
        }

        const params = new URLSearchParams();
        for (const k of Object.keys(req.query)) {
            if (k === 'layer') continue;
            params.append(k, req.query[k]);
        }

        // HTTP로 직접 요청 (KHOA가 어차피 302로 HTTP로 보냄)
        const upstream = 'http://www.khoa.go.kr/oceanmap/' + layer +
            '/wmsVectordata.do?' + params.toString();

        const fetchFn = global.fetch || require('node-fetch');
        const r = await fetchFn(upstream, {
            redirect: 'follow',
            headers: {
                'Referer': 'http://www.khoa.go.kr/oceanmap/main.do',
                'User-Agent': 'Mozilla/5.0'
            }
        });

        if (!r.ok) {
            return res.status(r.status).send('upstream error');
        }
        const buf = Buffer.from(await r.arrayBuffer());
        res.set('Content-Type', r.headers.get('content-type') || 'image/png');
        res.set('Cache-Control', 'public, max-age=86400');
        res.send(buf);
    } catch (e) {
        console.error('[KHOA-WMS proxy] error:', e.message);
        res.status(500).send('proxy error');
    }
});

// ============================================================================
// KHOA 해아름 dynamic-stream-vector 프록시 + 메모리 캐시
// ============================================================================
//
// 해아름 사이트가 내부적으로 사용하는 ROMS 격자 JSON을 그대로 가져온다.
// 한 번 호출 시 한국 전 해역 약 1만 격자점의 (lat, lon, s, d, temp, salt, zeta)
// 가 ~1MB JSON 으로 한꺼번에 온다. 공공데이터포털 ROMS API 를 좌표마다
// 따로 부르던 기존 방식보다 훨씬 빠르고, 시각화에도 그대로 쓸 수 있다.
//
// GET /api/ocean/khoa-stream-vector?date=YYYYMMDD&hour=HH
//   → 원본 JSON 그대로 (오버레이용)
// GET /api/ocean/khoa-stream-nearest?lat=&lon=&date=&hour=
//   → 주어진 좌표에 가장 가까운 점 1개 (단일 좌표 조회용)

const KHOA_STREAM_BASE =
    'https://www.khoa.go.kr/oceandata/oceaninfo/prediction/dynamic-stream-vector.do';

// 메모리 캐시: { 'YYYYMMDD_HH': { ts, points: [{lat,lon,s,d,temp,...}], meta } }
const _khoaCache = new Map();
const KHOA_CACHE_TTL_MS = 60 * 60 * 1000; // 1시간

// [실패 캐시 — 2026-05]
//   KHOA upstream 이 일시 장애(500 등)일 때 매 사용자 요청마다 외부 호출 →
//   소스 폭주 + 콘솔 노이즈. 같은 (date, hour) 의 실패는 30초간 캐시해 즉시
//   빈 응답 반환 → 우리 서버에서 폭주 자체를 차단.
const _khoaFailCache = new Map();
const KHOA_FAIL_TTL_MS = 30 * 1000; // 30초

/** KHOA stream-vector 캐시 키 생성 — 'YYYYMMDD_HH' 형식. _khoaCache.get/set 의 키. */
function _cacheKey(date, hour) { return date + '_' + hour; }

/**
 * KHOA 해아름 stream-vector(전 해역 격자) 데이터를 fetch. 1시간 TTL 메모리 캐시 적용.
 * 같은 (date, hour) 조합은 1시간 동안 외부 API 한 번만 호출.
 *
 * [반환] { features, lonList, latList, gridLookup, ts } 형식 객체.
 * [연계] /api/ocean/khoa-stream-vector, /api/ocean/khoa-stream-nearest 두 라우트가 사용.
 */
async function _fetchKhoaStream(date, hour) {
    const key = _cacheKey(date, hour);
    const cached = _khoaCache.get(key);
    if (cached && (Date.now() - cached.ts) < KHOA_CACHE_TTL_MS) {
        return cached;
    }
    // 실패 캐시 hit → 즉시 빈 결과 반환 (외부 호출 안 함)
    const failed = _khoaFailCache.get(key);
    if (failed && (Date.now() - failed.ts) < KHOA_FAIL_TTL_MS) {
        return { ts: Date.now(), points: [], meta: {}, _failed: true, _reason: failed.reason };
    }

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
    let r = await fetchFn(upstream, { redirect: 'follow', headers: headers });
    if (!r.ok) {
        const body = await r.text();
        console.error('[KHOA-Stream] upstream', r.status, 'url:', upstream, 'body:', body.slice(0, 300));
        throw new Error('khoa upstream ' + r.status);
    }
    const text = await r.text();
    // [부분 응답 처리 — 2026-05] KHOA 가 200 OK 를 주면서 body 가 비어있거나
    // 잘린 응답을 내려보내는 경우가 있음. JSON.parse 가 throw 되면 catch 로 가지만,
    // 0-byte / whitespace 만 들어온 경우를 명시적으로 빠른 실패로 분기해
    // _khoaFailCache 와 동일한 30초 실패 경로로 들어가도록 한다.
    if (!text || !text.trim()) {
        console.error('[KHOA-Stream] upstream returned empty body. url:', upstream);
        throw new Error('khoa empty body');
    }
    let json;
    try {
        json = JSON.parse(text);
    } catch (parseErr) {
        console.error('[KHOA-Stream] JSON parse fail. body:', text.slice(0, 300));
        throw new Error('khoa response not JSON');
    }
    // [부분 응답 처리 — 2026-05] 200 OK + 유효 JSON 이지만 data/dataList/list 등
    // 데이터 컨테이너 자체가 없거나 명시적으로 success:false 면 부분 응답으로 간주.
    // (0-points 정상 케이스(육지 격자 등) 와는 구분 — data 키가 존재하면 통과시킨다.)
    const hasAnyContainer = ['data', 'dataList', 'list', 'points', 'result', 'items']
        .some(k => json && Object.prototype.hasOwnProperty.call(json, k));
    if (!hasAnyContainer || json.success === false) {
        console.error('[KHOA-Stream] partial response — no data container. body:', text.slice(0, 300));
        throw new Error('khoa partial response');
    }

    // data 는 보통 2차원 배열, 또는 1차원 배열, 또는 다른 키 이름일 수 있음.
    // 여러 형태를 모두 대응한다.
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
    if (flat.length === 0) {
        console.warn('[KHOA-Stream] no points parsed. top-level keys:',
            Object.keys(json).join(','),
            'data type:', Array.isArray(json.data) ? ('array len ' + json.data.length) : typeof json.data);
        if (Array.isArray(json.data) && json.data.length > 0) {
            console.warn('[KHOA-Stream] data[0] type:', Array.isArray(json.data[0]) ? ('array len ' + json.data[0].length) : typeof json.data[0]);
            console.warn('[KHOA-Stream] data[0] sample:', JSON.stringify(json.data[0]).slice(0, 300));
        }
    }

    const entry = {
        ts: Date.now(),
        points: flat,
        meta: json.meta || {},
        // 디버그: 점이 0개일 때만 응답에 원본 구조 힌트를 같이 실어 보낸다.
        _debug: flat.length === 0 ? {
            topKeys: Object.keys(json),
            dataType: Array.isArray(json.data) ? ('array len ' + json.data.length) : typeof json.data,
            dataSample: Array.isArray(json.data) && json.data.length > 0
                ? JSON.stringify(json.data[0]).slice(0, 400)
                : JSON.stringify(json.data || null).slice(0, 400)
        } : null
    };
    _khoaCache.set(key, entry);
    return entry;
}

// 현재 시각 → KHOA 가 받아들이는 (YYYYMMDD, HH) 로 변환
function _defaultDateHour(qDate, qHour) {
    if (qDate && qHour != null) {
        // parseInt로 정수 파싱: '11:1', '11:00', '9' 모두 안전하게 처리
        // padStart는 길이 이상의 문자열을 그대로 통과시키므로 parseInt 필수
        const hourInt = parseInt(qHour, 10);
        const hourSafe = (!isNaN(hourInt) && hourInt >= 0 && hourInt <= 23)
            ? String(hourInt).padStart(2, '0')
            : String(new Date().getHours()).padStart(2, '0');
        return { date: String(qDate), hour: hourSafe };
    }
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    return { date: y + m + day, hour: h };
}

/**
 * [GET /api/ocean/khoa-stream-vector]
 * KHOA 해아름 stream-vector 격자 데이터를 클라이언트에 그대로 전달.
 * query: ?date=YYYYMMDD&hour=HH (생략 시 현재 시각).
 * 응답: 격자 features 배열 + 격자 인덱스. ocean_overlay.js (파티클) 가 사용.
 */
router.get('/api/ocean/khoa-stream-vector', async (req, res) => {
    let date, hour;
    try {
        ({ date, hour } = _defaultDateHour(req.query.date, req.query.hour));
        const entry = await _fetchKhoaStream(date, hour);
        res.set('Cache-Control', 'public, max-age=600');
        res.json({
            success: true,
            date: date,
            hour: hour,
            count: entry.points.length,
            meta: entry.meta,
            points: entry.points,
            _debug: entry._debug || undefined
        });
    } catch (e) {
        // [2026-05] KHOA upstream 장애는 우리 책임이 아니므로 status 200 으로
        // 반환해 클라이언트 콘솔의 500 에러 노이즈를 제거. success:false 본문 유지.
        // 실패 30초 캐시로 같은 (date, hour) 반복 요청 시 외부 호출 폭주 차단.
        if (date && hour) {
            _khoaFailCache.set(_cacheKey(date, hour), { ts: Date.now(), reason: e.message });
        }
        console.warn('[KHOA-Stream] upstream 실패 (외부 KHOA 문제):', e.message);
        res.status(200).json({ success: false, error: e.message, upstreamFailed: true });
    }
});

/**
 * [GET /api/ocean/khoa-stream-nearest]
 * KHOA stream-vector 격자에서 ?lat=&lon= 좌표에 가장 가까운 점 1개 반환.
 * ocean_bottom_sheet5.js fetchRoms 가 호출 — 단일 좌표 조회 최적화 경로.
 * 응답: { success, wtem, crsp, crdir } 또는 { success: false }.
 */
router.get('/api/ocean/khoa-stream-nearest', async (req, res) => {
    let date, hour;
    try {
        const lat = parseFloat(req.query.lat);
        const lon = parseFloat(req.query.lon);
        if (isNaN(lat) || isNaN(lon)) {
            return res.status(400).json({ success: false, error: 'lat/lon 필수' });
        }
        ({ date, hour } = _defaultDateHour(req.query.date, req.query.hour));
        const entry = await _fetchKhoaStream(date, hour);

        let best = null;
        let bestD = Infinity;
        for (const p of entry.points) {
            // 결측점 제외 (육지 등)
            if (p.s === 0 && p.d === 0 && p.temp === 0 && p.salt === 0 && p.zeta === 0) continue;
            const dLat = p.lat - lat;
            const dLon = p.lon - lon;
            const dist = dLat * dLat + dLon * dLon;
            if (dist < bestD) { bestD = dist; best = p; }
        }
        if (!best) {
            return res.json({ success: false, error: '주변 격자점 없음' });
        }
        // 클라이언트 기존 포맷 호환: crdir(deg), crsp(cm/s), wtem(°C)
        res.json({
            success: true,
            date: date,
            hour: hour,
            lat: best.lat,
            lon: best.lon,
            crdir: best.d,
            crsp: best.s * 100, // m/s → cm/s
            wtem: best.temp,
            salt: best.salt,
            zeta: best.zeta
        });
    } catch (e) {
        // [2026-05] KHOA upstream 장애는 우리 책임이 아니므로 status 200 반환 +
        // 30초 실패 캐시 (외부 호출 폭주 차단). 클라이언트는 기존대로 success:false 처리.
        if (date && hour) {
            _khoaFailCache.set(_cacheKey(date, hour), { ts: Date.now(), reason: e.message });
        }
        console.warn('[KHOA-Nearest] upstream 실패 (외부 KHOA 문제):', e.message);
        res.status(200).json({ success: false, error: e.message, upstreamFailed: true });
    }
});

// ============================================================================
// 육지 마스크 API — 한반도 주변 사전 생성된 육지 폴리곤
// ============================================================================
// land_mask_korea.json: 사전 클리핑된 정적 파일 (CDN 다운로드 불필요)
// 재생성: node local_server/scripts/generate_land_mask.js

const _LAND_MASK_PATH = path.join(__dirname, '..', 'land_mask_korea.json');
let _landMaskData = null; // 서버 기동 후 최초 1회 파일 읽기 후 메모리 유지

/**
 * [GET /api/ocean/land-mask]
 * 한반도 육지 마스크 GeoJSON 반환 — 파티클이 육지에 표시되지 않도록
 * ocean_overlay.js 의 sampleAt 이 격자 점이 육지 안인지 검사할 때 사용.
 * 캐시: _landMaskData 메모리 캐시 (서버 시작 시 1회 로드).
 */
router.get('/api/ocean/land-mask', (req, res) => {
    try {
        if (!_landMaskData) {
            if (!fs.existsSync(_LAND_MASK_PATH)) {
                return res.status(404).json({ success: false, error: 'land_mask_korea.json 없음' });
            }
            _landMaskData = JSON.parse(fs.readFileSync(_LAND_MASK_PATH, 'utf8'));
            console.log('[LandMask] 파일 로드 완료, rings:', _landMaskData.rings.length);
        }
        res.set('Cache-Control', 'public, max-age=86400');
        res.json({ success: true, rings: _landMaskData.rings });
    } catch (e) {
        console.error('[LandMask] error:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================================
// 하위 라우터 연결 (ocean2~5)
// ============================================================================
// 각 파일이 존재할 때만 안전하게 로드
// → 개발 중 파일이 아직 없어도 서버가 정상 기동됨

try { router.use(require('./ocean2')); } catch (e) { console.warn('[Ocean] ocean2.js 로드 실패:', e.message); }
try { router.use(require('./ocean3')); } catch (e) { console.warn('[Ocean] ocean3.js 로드 실패:', e.message); }
try { router.use(require('./ocean4')); } catch (e) { console.warn('[Ocean] ocean4.js 로드 실패:', e.message); }

module.exports = router;
