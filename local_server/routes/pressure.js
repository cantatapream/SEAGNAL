/**
 * ============================================================================
 * 파일명: routes/pressure.js
 * 역할: 바텀시트 "기압" 카드가 쓰는 좌표·시각별 해면기압(hPa) 조회 API.
 *       OpenWeather 의 현재날씨(2.5/weather) 와 3시간 간격 5일 예보(2.5/forecast)
 *       두 가지를 시각에 따라 갈라 쓰고, 격자·시간 단위로 캐시해 호출수를 아낀다.
 * ============================================================================
 *
 * [왜 이 파일이 있나]
 * 우리 기존 해양 데이터(기상청·KHOA)에는 해면기압이 없다. 어민에게 기압은
 * 날씨 변화를 읽는 기본 지표라, 외부 소스(OpenWeather)로 이 값만 따로 받아온다.
 *
 * - GET /api/ocean/pressure?lat=&lon=&ts= → 그 좌표·그 시각의 기압 1개
 *
 * [시각에 따라 소스가 갈린다]
 *   요청 시각 ts 가 지금부터 ±90분 안  → 현재날씨(2.5/weather)
 *   그보다 미래(최대 5일)             → 3시간 간격 예보(2.5/forecast) 중 가장 가까운 시각
 *   5일 밖 / 과거                      → success:false (클라이언트가 카드를 숨김)
 *   과거를 안 주는 이유: OpenWeather 무료 플랜에 과거 데이터 API 가 없다(가입 안내 메일 명시).
 *
 * [인증키] process.env.OPENWEATHER_API_KEY (Fly secrets).
 *   미설정 시 success:false + reason:'no_key' 로 응답하고 카드가 숨겨진다.
 *   서버 기동 시 한 번 경고를 남겨, 키가 빠진 것이 조용히 묻히지 않게 한다.
 *
 * [호출수] 무료 플랜 한도는 분당 60회·월 100만회.
 *   좌표를 0.1°(약 11km) 격자로 뭉개고 현재날씨 10분·예보 1시간 캐시를 둬,
 *   같은 해역을 여러 사람이 눌러도 상류 호출이 늘지 않게 한다.
 *
 * [연계 파일]
 * - server.js → app.use()로 이 라우터 등록
 * - client/js/ocean-map/bottom-sheet/ocean_bottom_sheet5.js → fetchPressure() 가 호출
 * ============================================================================
 */

const express = require('express');
const router = express.Router();

const API_KEY = process.env.OPENWEATHER_API_KEY || '';
const BASE = 'https://api.openweathermap.org/data/2.5';
const HTTP_TIMEOUT_MS = 8000;

// 현재날씨로 답할 수 있는 시간 폭 (이 밖이면 예보에서 고른다)
const NOW_WINDOW_MS = 90 * 60 * 1000;
// 예보 한 칸(3시간)의 절반 — 요청 시각과 이만큼까지 떨어진 칸은 "그 시각"으로 인정
const SLOT_TOLERANCE_MS = 90 * 60 * 1000;

const CURRENT_TTL_MS = 10 * 60 * 1000;
const FORECAST_TTL_MS = 60 * 60 * 1000;
// 캐시 항목 상한 — 없으면 사용자가 지도를 누른 좌표 수만큼 무한히 쌓여 서버 메모리가 샌다.
const MAX_CACHE_ENTRIES = 500;

if (!API_KEY) {
    console.log('[pressure] OPENWEATHER_API_KEY 미설정 — 기압 카드 비활성 (앱은 정상, 카드만 숨겨짐).');
}

// 캐시: key → { at: 받은시각ms, data: 응답JSON }
const cache = new Map();

/**
 * 캐시에서 꺼내거나, 없으면 OpenWeather 를 호출해 담는다.
 * 예: cached('weather', 'https://…/weather?…', 600000) → { main: { pressure: 1008, … } }
 * @param {string} key - 캐시 키 (격자좌표 + 종류)
 * @param {string} url - 호출할 주소
 * @param {number} ttlMs - 이 시간 안이면 재호출하지 않는다
 * @returns {Promise<Object|null>} 응답 JSON, 실패 시 null
 * [연계] ← fetchCurrent/fetchForecast (같은 파일) — 같은 해역 반복 클릭으로 상류 호출이
 *          늘지 않게 하기 위해 둘 다 이 함수를 거친다.
 */
async function cached(key, url, ttlMs) {
    const hit = cache.get(key);
    if (hit && (Date.now() - hit.at) < ttlMs) return hit.data;

    let data = null;
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
        if (!res.ok) {
            console.log(`[pressure] 상류 응답 ${res.status} — ${key}`);
            return null;
        }
        data = await res.json();
    } catch (e) {
        console.log(`[pressure] 호출 실패(${key}): ${e.message}`);
        return null;
    }

    // 오래된 것부터 버려 상한 유지 (Map 은 넣은 순서를 지킨다)
    if (cache.size >= MAX_CACHE_ENTRIES) {
        const oldest = cache.keys().next().value;
        cache.delete(oldest);
    }
    cache.set(key, { at: Date.now(), data });
    return data;
}

/** 좌표를 0.1° 격자로 뭉갠 캐시 키 조각. 예: (35.13, 129.07) → "35.1,129.1" */
function gridKey(lat, lon) {
    return lat.toFixed(1) + ',' + lon.toFixed(1);
}

/** 응답의 main 에서 해면기압(hPa)을 고른다. sea_level 이 있으면 그쪽이 더 정확하다. */
function pickPressure(main) {
    if (!main) return null;
    const v = (main.sea_level != null) ? main.sea_level : main.pressure;
    return (typeof v === 'number' && isFinite(v)) ? Math.round(v) : null;
}

/** 현재날씨 조회 — 지금 기압용. */
function fetchCurrent(lat, lon) {
    const g = gridKey(lat, lon);
    const url = `${BASE}/weather?lat=${g.split(',')[0]}&lon=${g.split(',')[1]}&appid=${API_KEY}`;
    return cached('cur:' + g, url, CURRENT_TTL_MS);
}

/** 3시간 간격 5일 예보 조회 — 미래 시각 기압용. */
function fetchForecast(lat, lon) {
    const g = gridKey(lat, lon);
    const url = `${BASE}/forecast?lat=${g.split(',')[0]}&lon=${g.split(',')[1]}&appid=${API_KEY}`;
    return cached('fct:' + g, url, FORECAST_TTL_MS);
}

/**
 * 예보 목록(3시간 간격)에서 요청 시각에 가장 가까운 칸을 고른다.
 * 예: 목록이 03·06·09시이고 ts 가 07:20 이면 06시 칸을 돌려준다.
 * @param {Array} list - OpenWeather forecast 의 list (각 항목에 dt, main)
 * @param {number} tsMs - 원하는 시각(epoch ms)
 * @returns {{pressure:number, validAtMs:number}|null} 허용 오차 밖이면 null
 * [연계] ← GET /api/ocean/pressure 핸들러 — 바텀시트 슬라이더가 옮긴 시각의 값을
 *          찾기 위해 부른다.
 */
function nearestSlot(list, tsMs) {
    if (!Array.isArray(list)) return null;
    let best = null;
    let bestGap = Infinity;
    for (const item of list) {
        if (!item || typeof item.dt !== 'number') continue;
        const gap = Math.abs(item.dt * 1000 - tsMs);
        if (gap < bestGap) { bestGap = gap; best = item; }
    }
    if (!best || bestGap > SLOT_TOLERANCE_MS) return null;
    const p = pickPressure(best.main);
    return (p == null) ? null : { pressure: p, validAtMs: best.dt * 1000 };
}

/**
 * GET /api/ocean/pressure?lat=&lon=&ts=
 *   ts 는 epoch ms (바텀시트가 보고 있는 시각). 없으면 지금.
 * 성공: { success:true, pressure:1008, validAt:"2026-09-20T06:00:00.000Z", source:"current"|"forecast" }
 * 실패: { success:false, reason:"no_key"|"bad_param"|"out_of_range"|"upstream" }
 *   실패 시 클라이언트는 카드를 숨긴다(다른 카드들과 같은 정책).
 */
router.get('/api/ocean/pressure', async (req, res) => {
    res.set('Cache-Control', 'public, max-age=300');

    if (!API_KEY) return res.json({ success: false, reason: 'no_key' });

    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    if (!isFinite(lat) || !isFinite(lon)) {
        return res.json({ success: false, reason: 'bad_param' });
    }

    const now = Date.now();
    const ts = req.query.ts ? parseInt(req.query.ts, 10) : now;
    if (!isFinite(ts)) return res.json({ success: false, reason: 'bad_param' });

    // (1) 지금 근처 → 현재날씨
    if (Math.abs(ts - now) <= NOW_WINDOW_MS) {
        const data = await fetchCurrent(lat, lon);
        const p = data ? pickPressure(data.main) : null;
        if (p != null) {
            return res.json({
                success: true, pressure: p, source: 'current',
                validAt: new Date((data.dt ? data.dt * 1000 : now)).toISOString()
            });
        }
        return res.json({ success: false, reason: 'upstream' });
    }

    // (2) 과거 → 무료 플랜에 과거 데이터 API 가 없다
    if (ts < now) return res.json({ success: false, reason: 'out_of_range' });

    // (3) 미래 → 3시간 간격 예보에서 가장 가까운 칸
    const data = await fetchForecast(lat, lon);
    if (!data) return res.json({ success: false, reason: 'upstream' });
    const slot = nearestSlot(data.list, ts);
    if (!slot) return res.json({ success: false, reason: 'out_of_range' });

    return res.json({
        success: true, pressure: slot.pressure, source: 'forecast',
        validAt: new Date(slot.validAtMs).toISOString()
    });
});

// 계산 규칙(어느 예보 칸을 고르나 · 어느 기압 값을 쓰나)은 화면 없이도 고정해 둔다.
// [연계] → local_server/scripts/test_pressure_card.js (verify_all.sh SUITES 등록)
router._pickPressure = pickPressure;
router._nearestSlot = nearestSlot;

module.exports = router;
