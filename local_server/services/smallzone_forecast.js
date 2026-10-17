/**
 * ============================================================================
 * 파일명: services/smallzone_forecast.js
 * 역할: 기상청 API허브 소해구 예보(marine_small_zone.php — 대해구 하나를 3×3 으로 나눈 소해구마다
 *       파고·파주기·파향·풍속·풍향)를 받아 두고 내준다. 브리핑용 대해구는 새 판이 나오면 미리 받아
 *       디스크에도 두고, 해구 기상전망 창에서 누른 대해구는 그때 받아 판이 바뀔 때까지 메모리에 둔다.
 *       (설계서 client/js/ocean-map/coastal-risk/coastal_safety_forecast.design.md §11.10.17)
 * ----------------------------------------------------------------------------
 * [출처 — 2026-10-17 실측]
 *   GET https://apihub.kma.go.kr/api/typ06/url/marine_small_zone.php
 *       ?tma_fc=YYYYMMDDHH(발표 UTC 00·12) &tma_ef=YYYYMMDDHH(발효 — 한 번에 하나)
 *       &Lzone=233,234(쉼표, 최대 40개) &Szone=0(전체 소해구) &disp=0 &help=0 &authKey=…
 *   응답 EUC-KR 표 #START7777 … #7777END. 열 TMA_FC TMA_EF LZONE SZONE LAT_LB … WH_SIG WVPRD_MAX WVDR WS WD VS RAIN TW SWELL.
 *   -999 = 결측(제주 233-1·233-2 처럼 육지 소해구는 전부 -999). 없는 대해구 번호는 오류 없이 줄만 빠진다.
 *   아직 안 나온 판은 #START7777 없이 「해구번호를 확인하여 주시기 바랍니다.」만 온다.
 *
 * [저장]
 *   브리핑용 판: 메모리 + data/smallzone_forecast.json.gz(지난 판은 덮어씀 — swell_smallzone.json.gz 와 같은 방식).
 *   창 클릭용: 메모리만. 판이 바뀌면 비우고, 대해구 100개를 넘으면 오래 안 쓴 것부터 버린다.
 *   상태 한 줄: data/smallzone_forecast_status.json(관리자 「데이터 수집현황」 카드가 읽는다).
 *
 * [인증키] 요청 주소에만 넣는다. 오류·로그·상태에는 키도 요청 주소도 남기지 않는다(mask).
 *
 * [연계]
 *  - 사용하는 파일 : services/risk_geo.js(점-다각형 판정) · config/coastal_safety/coastguard_stations.geojson(관할)
 *                    · client/marine_zone_area.json(대해구 0.5° 칸)
 *  - 서버 API      : routes/weather.js GET /api/marine-small-zone-forecasts/:lzone (get)
 *  - 마크업        : 없음
 *  - 나를 쓰는 곳  : scheduler.js(configure·대해구 예보 저장 직후 prefetch) · routes/weather.js(get)
 *                    · 시험 local_server/scripts/test_smallzone_forecast.js
 * [로드 순서] require 부작용 없음. 디스크 판은 처음 쓸 때 한 번 읽는다.
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const G = require('./risk_geo');

const ROOT = path.join(__dirname, '..');
const URL = 'https://apihub.kma.go.kr/api/typ06/url/marine_small_zone.php';
const CHUNK = 40;                       // API 한도: 대해구 40개까지(넘으면 「대해구는 40개 이하로…」)
const HOURS = Array.from({ length: 26 }, (_, i) => i * 3);   // +0~75시간 3시간 간격(대해구 수집과 같다)
const CONCURRENCY = 3;                  // 동시 요청 수(상대 서버 배려)
const RETRIES = 2;                      // 요청마다 최대 2번 더
const RETRY_WAIT_MS = 1500;
const TIMEOUT_MS = 15000;
const CLICK_MAX = 100;                  // 창 클릭용 대해구 상한(브리핑용은 세지 않는다)
// 브리핑 칸이 고르는 대해구는 칸 사각형과 가장 많이 겹치는 0.5° 칸이다(risk_sea_cells.describe). 칸 중심은 관할 안이지만
// 칸 사각형(사고 칸 약 0.045°×0.038°, 대각 약 0.059°)이 관할 밖으로 삐져나올 수 있고, 혼잡 칸은 자기 중심이 든 사고 칸을
// 기준으로 묶인다 — 그래서 관할에서 0.06° 안에 있는 대해구 칸까지 넣는다(시험이 실제 describe 로 확인).
const MARGIN_DEG = 0.06;

let opts = {
    fetchImpl: defaultFetch,
    getKey: () => null,
    dataDir: path.join(ROOT, 'data'),
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    stationsFile: path.join(ROOT, 'config', 'coastal_safety', 'coastguard_stations.geojson'),
    zonesFile: path.join(ROOT, '..', 'client', 'marine_zone_area.json'),
};

// 브리핑용 판 { baseTm, collectedAt, lzones:[], requests, failed, missingTimes:[], data:{lzone:{szone:[행]}} }
let brief = null;
let loaded = false;
let prefetching = null;                 // 돌고 있는 prefetch 의 약속(겹쳐 돌지 않게)
// 창 클릭용 { baseTm, map: Map(lzone → {data, at}) } — Map 의 넣은 순서 = 오래 안 쓴 순서
let click = { baseTm: null, map: new Map() };
const inflight = new Map();             // `${baseTm}|${lzone}` → 약속(같은 대해구 동시 요청은 하나로)
let lastError = null;                   // { at, message } — 키를 가린 글
let lastRun = null;                     // { at, baseTm, requests, failed, ok }
let briefList = null;

/**
 * 설정을 바꾼다(운영은 scheduler.js 가 키·fetch 를, 시험은 가짜 fetch·임시 폴더를 넣는다). 넣은 칸만 바뀐다.
 * 예: configure({ getKey: () => CONFIG.KMA_HUB_KEY })
 * @param {object} o - fetchImpl(url)→Response 비슷한 것 · getKey · dataDir · wait · stationsFile · zonesFile
 * [연계] ← scheduler.js(모듈 읽을 때 한 번) · 시험
 */
function configure(o = {}) { opts = { ...opts, ...o }; }

/** 시험용: 메모리 상태를 모두 비운다. [연계] ← test_smallzone_forecast */
function _reset() { brief = null; loaded = false; prefetching = null; click = { baseTm: null, map: new Map() }; inflight.clear(); lastError = null; lastRun = null; briefList = null; }

/**
 * 키와 요청 주소를 글에서 가린다 — 오류 글(Node fetch 의 cause 등)에 주소가 섞여 나와도 로그·상태·응답에 남지 않게.
 * 예: mask('… authKey=abc&x=1') → '… authKey=***&x=1'
 * @param {*} s @returns {string} [연계] ← fail·getStatus
 */
function mask(s) {
    let t = String(s == null ? '' : s);
    const key = opts.getKey();
    if (key) t = t.split(String(key)).join('***');
    return t.replace(/authKey=[^&\s"']*/gi, 'authKey=***').replace(/https?:\/\/apihub\.kma\.go\.kr[^\s"']*/gi, '(기상청 API허브 주소)');
}

/**
 * 기본 fetch — 서버 수집기(scheduler.js fetchWithTimeout)와 같은 Node 내장 fetch + AbortController 시간 제한.
 * @param {string} url @returns {Promise<Response>} [연계] ← fetchChunk
 */
async function defaultFetch(url) {
    const c = new AbortController();
    const id = setTimeout(() => c.abort(), TIMEOUT_MS);
    try { return await fetch(url, { signal: c.signal }); } finally { clearTimeout(id); }
}

/** UTC Date → "YYYYMMDDHH". 예: 2026-10-17T03Z → "2026101703". @param {Date} d @returns {string} */
function utcTm(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}`;
}

/** 발표시각에서 26개 발효시각을 만든다. 예: "2026101700" → ["2026101700","2026101703",…,"2026102003"]. @param {string} baseTm @returns {string[]} */
function efTimes(baseTm) {
    const b = Date.UTC(+baseTm.slice(0, 4), +baseTm.slice(4, 6) - 1, +baseTm.slice(6, 8), +baseTm.slice(8, 10));
    return HOURS.map((h) => utcTm(new Date(b + h * 3600000)));
}

/** 표 값 → 숫자. -999(결측)·숫자 아님 → null. 예: '-999.0' → null · '1.4' → 1.4 */
function num(v) { const n = parseFloat(v); return Number.isFinite(n) && n > -999 ? n : null; }

/**
 * 소해구 표 글을 행으로 바꾼다. 머리줄은 열 이름(TMA_EF·LZONE·SZONE·WH_SIG)이 함께 든 # 줄이다
 * (help=1 일 때 「#  2. TMA_EF : 발효시각」 같은 설명 줄이 있어 TMA_FC 하나로는 가리지 않는다).
 * 예: parseTable('#START7777\n# TMA_FC TMA_EF LZONE SZONE … \n2026101700 2026101703 233 3 … 1.4 5.7 92.6 7.7 92.3 …')
 *     → [{lzone:'233', szone:'3', tm:'2026101703', wh:1.4, wp:5.7, waveDir:92.6, ws:7.7, windDir:92.3}]
 * @param {string} text @returns {object[]|null} #START7777 이 없으면 null(실패로 본다)
 * [연계] ← fetchChunk — 대해구 예보 행(scheduler.js parseKmaTable)과 같은 필드 이름·단위
 */
function parseTable(text) {
    if (typeof text !== 'string' || !text.includes('#START7777')) return null;
    let header = null;
    const rows = [];
    for (const line of text.split('\n')) {
        if (line.startsWith('#')) {
            const cols = line.slice(1).trim().split(/\s+/);
            if (cols.includes('TMA_EF') && cols.includes('SZONE') && cols.includes('WH_SIG')) header = cols;
            continue;
        }
        if (!header) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length < header.length - 3) continue;
        const r = {};
        header.forEach((h, i) => { r[h] = parts[i]; });
        if (!/^\d+$/.test(r.LZONE || '') || !/^[1-9]$/.test(r.SZONE || '') || !/^\d{10}$/.test(r.TMA_EF || '')) continue;
        rows.push({ lzone: r.LZONE, szone: r.SZONE, tm: r.TMA_EF, wh: num(r.WH_SIG), wp: num(r.WVPRD_MAX), waveDir: num(r.WVDR), ws: num(r.WS), windDir: num(r.WD) });
    }
    return rows;
}

/**
 * 대해구 묶음(40개 이하) 하나의 한 발효시각을 받는다. 끊김·#START7777 없음은 최대 RETRIES 번 더 시도한다.
 * 예: await fetchChunk('2026101700','2026101703',['233','234']) → 행 18개
 * @param {string} baseTm @param {string} tmEf @param {string[]} lzones
 * @returns {Promise<object[]>} 행. 끝내 실패하면 throw(키를 가린 글)
 * [연계] ← fetchAll / → opts.fetchImpl · parseTable
 */
async function fetchChunk(baseTm, tmEf, lzones) {
    const key = opts.getKey();
    if (!key) throw new Error('인증키 없음');
    const url = `${URL}?tma_fc=${baseTm}&tma_ef=${tmEf}&Lzone=${lzones.join(',')}&Szone=0&disp=0&help=0&authKey=${encodeURIComponent(key)}`;
    let err = null;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
        if (attempt) await opts.wait(RETRY_WAIT_MS * attempt);
        try {
            const res = await opts.fetchImpl(url);
            const text = new TextDecoder('euc-kr').decode(await res.arrayBuffer());
            const rows = res.ok ? parseTable(text) : null;
            if (rows) return rows;
            err = new Error(res.ok ? '표 없음: ' + text.replace(/\s+/g, ' ').trim().slice(0, 60) : 'HTTP ' + res.status);
        } catch (e) {
            err = e;   // 끊김(Connection reset 등) — 아래에서 다시 시도하고, 끝내 실패하면 던진다
            console.warn(`[smallzone] ${tmEf} 대해구 ${lzones.length}개 요청 ${attempt + 1}번째 실패: ${mask(e.message)}`);
        }
    }
    throw new Error(mask(err && (err.cause && err.cause.message ? err.message + ' (' + err.cause.message + ')' : err.message)));
}

/**
 * 대해구 목록을 40개씩 나눠 26개 발효시각을 모두 받는다(동시 CONCURRENCY 개). 끝내 실패한 요청은 그 시각을 비워 둔다.
 * 예: await fetchAll('2026101700', ['233']) → { data:{'233':{'1':[26행],…}}, requests:26, failed:0, missingTimes:[], firstError:null }
 * @param {string} baseTm @param {string[]} lzones
 * @returns {Promise<{data:object, requests:number, failed:number, missingTimes:string[], firstError:string|null}>}
 * [연계] ← prefetch·get / → fetchChunk
 */
async function fetchAll(baseTm, lzones) {
    const chunks = [];
    for (let i = 0; i < lzones.length; i += CHUNK) chunks.push(lzones.slice(i, i + CHUNK));
    const jobs = [];
    for (const tm of efTimes(baseTm)) for (const c of chunks) jobs.push({ tm, c });
    const data = {}, missing = new Set();
    let failed = 0, firstError = null, next = 0;
    const worker = async () => {
        while (next < jobs.length) {
            const job = jobs[next++];
            try {
                for (const r of await fetchChunk(baseTm, job.tm, job.c)) {
                    const z = (data[r.lzone] = data[r.lzone] || {});
                    (z[r.szone] = z[r.szone] || []).push({ tm: r.tm, wh: r.wh, wp: r.wp, waveDir: r.waveDir, ws: r.ws, windDir: r.windDir });
                }
            } catch (e) {
                failed++; missing.add(job.tm); firstError = firstError || e.message;   // 그 시각은 비워 두고 status 에 남긴다
                console.warn(`[smallzone] ${job.tm} 대해구 ${job.c.length}개 끝내 실패 — 그 시각은 비워 둔다: ${e.message}`);
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
    for (const z of Object.values(data)) for (const rows of Object.values(z)) rows.sort((a, b) => a.tm.localeCompare(b.tm));
    return { data, requests: jobs.length, failed, missingTimes: [...missing].sort(), firstError };
}

/** 실패를 기록하고 로그에 남긴다(키 가림). [연계] ← prefetch·get */
function fail(where, message) {
    lastError = { at: new Date().toISOString(), message: mask(where + ': ' + message) };
    console.error('[smallzone] ' + lastError.message);
}

function cachePath() { return path.join(opts.dataDir, 'smallzone_forecast.json.gz'); }
function statusPath() { return path.join(opts.dataDir, 'smallzone_forecast_status.json'); }

/** 디스크의 브리핑용 판을 처음 쓸 때 한 번 읽는다(서버 재시작에도 남게). [연계] ← prefetch·get·getStatus */
function ensureLoaded() {
    if (loaded) return;
    loaded = true;
    try {
        if (!fs.existsSync(cachePath())) return;
        const obj = JSON.parse(zlib.gunzipSync(fs.readFileSync(cachePath())).toString('utf8'));
        if (obj && obj.fmt === 1 && obj.baseTm && obj.data) { delete obj.fmt; brief = obj; }
    } catch (e) { fail('저장된 판 읽기 실패', e.message); }
}

/** 관리자 카드가 읽는 상태 한 줄을 쓴다. [연계] ← prefetch / → services/data_collection_status(statusFile.message) */
function writeStatus(message) {
    try {
        fs.mkdirSync(opts.dataDir, { recursive: true });
        fs.writeFileSync(statusPath(), JSON.stringify({ lastRun: new Date().toISOString(), message: mask(message) }, null, 2));
    } catch (e) { console.error('[smallzone] 상태 파일 쓰기 실패:', e.message); }
}

/**
 * 관할 지도(97곳)와 대해구 0.5° 칸을 겹쳐, 브리핑이 쓸 수 있는 대해구 목록을 만든다(처음 한 번 계산해 둔다).
 * 대해구 칸을 MARGIN_DEG 만큼 넓혀 관할 다각형과 닿으면 넣는다 — 꼭짓점이 상자 안 · 상자 모서리가 다각형 안 · 변끼리 교차 중 하나.
 * 예: briefingLzones() → ['47','48',…] (숫자 순)
 * @returns {string[]}
 * [연계] ← scheduler.js(대해구 예보 저장 직후 prefetch 에 넘김) · 시험(브리핑 칸 major 가 빠짐없이 드는지)
 */
function briefingLzones() {
    if (briefList) return briefList;
    const st = JSON.parse(fs.readFileSync(opts.stationsFile, 'utf8')).features.filter((f) => ['Polygon', 'MultiPolygon'].includes(f.geometry && f.geometry.type));
    const zones = JSON.parse(fs.readFileSync(opts.zonesFile, 'utf8')).features.filter((f) => f.geometry);
    const polys = st.map((f) => {
        const rings = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).flat();
        const pts = rings.flat();
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        return { geometry: f.geometry, rings, bb: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
    });
    const cross = (a, b, c, d) => {
        const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
        return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
    };
    const out = new Set();
    for (const z of zones) {
        const pts = z.geometry.coordinates.flat(Infinity);
        const xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1);
        const r = [Math.min(...xs) - MARGIN_DEG, Math.min(...ys) - MARGIN_DEG, Math.max(...xs) + MARGIN_DEG, Math.max(...ys) + MARGIN_DEG];
        const corners = [[r[0], r[1]], [r[0], r[3]], [r[2], r[3]], [r[2], r[1]]];
        const inR = (p) => p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3];
        const hit = polys.some((p) => {
            if (p.bb[0] > r[2] || p.bb[2] < r[0] || p.bb[1] > r[3] || p.bb[3] < r[1]) return false;
            if (corners.some((c) => G.pointInGeometry(c, p.geometry))) return true;
            for (const ring of p.rings) {
                for (let i = 0; i < ring.length; i++) {
                    if (inR(ring[i])) return true;
                    if (i && corners.some((c, k) => cross(ring[i - 1], ring[i], c, corners[(k + 1) % 4]))) return true;
                }
            }
            return false;
        });
        if (hit) out.add(String(z.properties.marine_zone_no));
    }
    briefList = [...out].sort((a, b) => a - b);
    return briefList;
}

/**
 * 브리핑용 대해구를 그 판으로 미리 받아 메모리·디스크에 둔다. 이미 같은 판·같은 목록을 빠짐없이 받았으면 요청하지 않는다.
 * 일부 시각만 실패하면 받은 것만 저장하고 빠진 시각을 남긴다(다음 대해구 수집 — 30분 뒤 — 때 다시 받는다). 전부 실패하면 저장 판을 그대로 둔다.
 * 예: await prefetch(['233','234'], '2026101700') → { ok:true, skipped:false, baseTm, lzones:2, requests:26, failed:0, missingTimes:[] }
 * @param {string[]} lzones @param {string} baseTm - 대해구 수집의 validBaseTm
 * @returns {Promise<object>} 요약(scheduler 가 lastRunStatus.smallZone 에 쓴다)
 * [연계] ← scheduler.js collectZoneForecasts(저장 성공 직후, 기다리지 않는다) / → fetchAll
 */
function prefetch(lzones, baseTm) {
    ensureLoaded();
    const list = [...new Set((lzones || []).map(String))];
    if (!/^\d{10}$/.test(String(baseTm || '')) || !list.length) return Promise.resolve({ ok: false, skipped: true, reason: '판 또는 대해구 목록 없음' });
    if (prefetching) return prefetching;
    if (brief && brief.baseTm === baseTm && !brief.failed && list.every((z) => brief.lzones.includes(z))) {
        return Promise.resolve({ ok: true, skipped: true, baseTm, lzones: list.length, requests: 0, failed: 0, missingTimes: [] });
    }
    const t0 = Date.now();
    prefetching = (async () => {
        const r = await fetchAll(baseTm, list);
        const summary = { ok: r.failed === 0, skipped: false, baseTm, lzones: list.length, got: Object.keys(r.data).length, requests: r.requests, failed: r.failed, missingTimes: r.missingTimes, ms: Date.now() - t0 };
        lastRun = { at: new Date().toISOString(), ...summary };
        if (r.failed) fail('브리핑용 소해구 예보 ' + baseTm + ' 판 요청 ' + r.requests + '번 중 ' + r.failed + '번 실패', r.firstError);
        if (!Object.keys(r.data).length) {
            writeStatus('실패: ' + baseTm + ' 판 요청 ' + r.requests + '번 모두 실패 — ' + (r.firstError || '') + (brief ? ' (저장된 ' + brief.baseTm + ' 판 유지)' : ''));
            return summary;
        }
        brief = { baseTm, collectedAt: new Date().toISOString(), lzones: list, requests: r.requests, failed: r.failed, missingTimes: r.missingTimes, data: r.data };
        try {
            fs.mkdirSync(opts.dataDir, { recursive: true });
            const gz = zlib.gzipSync(Buffer.from(JSON.stringify({ fmt: 1, ...brief }), 'utf8'));
            fs.writeFileSync(cachePath(), gz);
            summary.bytes = gz.length;
        } catch (e) { fail('브리핑용 판 저장 실패', e.message); }
        writeStatus((r.failed ? '일부 실패: ' : '') + baseTm + ' 판 · 대해구 ' + list.length + '개(자료 ' + summary.got + '개) · 요청 ' + r.requests + '번 중 실패 ' + r.failed
            + (r.missingTimes.length ? ' · 빠진 발효시각 ' + r.missingTimes.length + '개(' + r.missingTimes.slice(0, 3).join(', ') + (r.missingTimes.length > 3 ? ' …' : '') + ')' : ''));
        console.log(`[smallzone] 브리핑용 ${baseTm} 판: 대해구 ${list.length}개 · 요청 ${r.requests} · 실패 ${r.failed} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
        return summary;
    })().finally(() => { prefetching = null; });
    return prefetching;
}

/**
 * 대해구 하나의 소해구 예보를 준다. 브리핑용 판에 있으면 그것, 없으면 받아서(26 요청) 창 클릭용 캐시에 넣고 준다.
 * 판(baseTm)이 바뀌면 창 클릭용 캐시를 비운다. 같은 대해구를 동시에 물으면 요청은 한 번만 한다.
 * 시각 일부가 빠진 결과는 주되 캐시에 넣지 않는다(다음 클릭 때 다시 받는다).
 * 예: await get('233','2026101700') → { baseTm:'2026101700', lzone:'233', data:{'1':[…26행],…'9':[…]}, missingTimes:[] }
 * @param {string} lzone @param {string} baseTm - 지금 대해구 예보 판(routes/weather.js 가 dataCache 에서 넘긴다)
 * @returns {Promise<object|null>} 그 대해구 줄이 응답에 없으면 null
 * @throws 요청이 모두 실패하면(키를 가린 글)
 * [연계] ← routes/weather.js GET /api/marine-small-zone-forecasts/:lzone / → fetchAll
 */
async function get(lzone, baseTm) {
    ensureLoaded();
    lzone = String(lzone);
    if (brief && brief.baseTm === baseTm && brief.data[lzone]) {
        return { baseTm, lzone, data: brief.data[lzone], missingTimes: brief.missingTimes || [] };
    }
    if (click.baseTm !== baseTm) click = { baseTm, map: new Map() };
    const hit = click.map.get(lzone);
    if (hit) { click.map.delete(lzone); click.map.set(lzone, hit); return { baseTm, lzone, data: hit, missingTimes: [] }; }
    const key = baseTm + '|' + lzone;
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
        const r = await fetchAll(baseTm, [lzone]);
        if (r.failed === r.requests) { fail('소해구 예보 ' + lzone + ' (' + baseTm + ' 판)', r.firstError); throw new Error(mask(r.firstError || '요청 실패')); }
        if (r.failed) fail('소해구 예보 ' + lzone + ' (' + baseTm + ' 판) 요청 ' + r.requests + '번 중 ' + r.failed + '번 실패', r.firstError);
        const data = r.data[lzone];
        if (!data) return null;
        if (!r.failed && click.baseTm === baseTm) {
            click.map.set(lzone, data);
            while (click.map.size > CLICK_MAX) click.map.delete(click.map.keys().next().value);
        }
        return { baseTm, lzone, data, missingTimes: r.missingTimes };
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
}

/**
 * 상태 요약 — 판·받은 시각·대해구 수·빠진 시각 수·마지막 오류(키 가림).
 * 예: getStatus() → { baseTm:'2026101700', collectedAt:'…', lzones:61, withData:61, requests:52, failed:0, missingTimes:0, lastError:null, click:{baseTm,cached:3}, running:false }
 * @returns {object} [연계] ← scheduler.js lastRunStatus.smallZone 의 메시지 · 시험
 */
function getStatus() {
    ensureLoaded();
    return {
        baseTm: brief ? brief.baseTm : null,
        collectedAt: brief ? brief.collectedAt : null,
        lzones: brief ? brief.lzones.length : 0,
        withData: brief ? Object.keys(brief.data).length : 0,
        requests: brief ? brief.requests : 0,
        failed: brief ? brief.failed : 0,
        missingTimes: brief ? (brief.missingTimes || []).length : 0,
        lastRun,
        lastError: lastError ? { at: lastError.at, message: mask(lastError.message) } : null,
        click: { baseTm: click.baseTm, cached: click.map.size },
        running: !!prefetching,
    };
}

module.exports = { configure, prefetch, get, getStatus, briefingLzones, parseTable, efTimes, mask, _reset, CHUNK, CLICK_MAX, MARGIN_DEG };
