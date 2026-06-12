'use strict';
/**
 * ============================================================================
 * analysis/wave_leadtime/nuriChartClient.js — 날씨누리(공개) 위험기상일기도 클라이언트
 * ============================================================================
 *
 *  dmdw(방재기상플랫폼, 인증 필요) 대신 기상청 날씨누리(www.weather.go.kr)의
 *  "공개" 해상일기도 API 로 동일 자료(KIM 연안 CoWW3 청별 해상풍/유의파고 GIF)를
 *  받는다. 인증/세션/자격증명 불필요. 게시도 dmdw 보다 빠름(발표 직후 가용).
 *
 *  [확인된 경로 — 2026-06]  (앱 해상일기도 탭 marine_chart.js 와 동일 출처)
 *    목록:   GET /w/wnuri-img/rest/cht/images/ocean-wave.do
 *            ?type=C&data=kim_cww3_[AREA]_<wind|wave>_&area=<청코드>
 *            → [{ name, url: "/w/repositary/image/cht/marine/kim_cww3_jeju_wind_s045_2026061212.gif" }]
 *    이미지: GET https://www.weather.go.kr<url>   (image/gif, 공개)
 *
 *  [엔진 호환]  predictionEngine 이 쓰는 chartClient 와 동일 인터페이스:
 *    listFrames({ headData, model, modelText, type }, baseTimeYmdhKST) → frames[]
 *    downloadFrame(frame) → Buffer
 *   - frame.tm 은 'KST 유효시각'(엔진 seq 가 ymdhToKstDate 로 해석) 으로 채운다.
 *   - 파일명 base 는 UTC(00/12). KST run 슬롯 = UTC base + 9h. 요청 슬롯과 목록의
 *     최신 base(보통 1개) 가 일치할 때만 frames 반환(불일치 → [], 엔진이 폴백).
 *  REGIONAL_OFFICES 는 chartClient 와 동일 카탈로그를 재노출(네트워크 무관 메타).
 * ============================================================================
 */
const https = require('https');
const { REGIONAL_OFFICES, NATIONAL_WAVE } = require('./chartClient');

const HOST = 'www.weather.go.kr';
const BASE = 'https://' + HOST;
const LIST_PATH = '/w/wnuri-img/rest/cht/images/ocean-wave.do';
const HTTP_TIMEOUT_MS = 15000;

const pad = (n) => String(n).padStart(2, '0');
const ymdh = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}`;
// 'YYYYMMDDHH'(UTC 또는 KST 벽시계) → UTC 필드에 담은 Date (getUTC* 로 그 벽시계 반환)
const ymdhToDate = (s) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), 0, 0));

function reqJson(path) {
    return new Promise((resolve) => {
        const r = https.request({
            method: 'GET', host: HOST, path,
            headers: {
                'User-Agent': 'Mozilla/5.0 (SEAGNAL/advisory)',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': BASE + '/w/index.do',
                'Accept': 'application/json, */*',
            }, timeout: HTTP_TIMEOUT_MS,
        }, (o) => { const c = []; o.on('data', (d) => c.push(d)); o.on('end', () => { try { resolve(JSON.parse(Buffer.concat(c).toString('utf8'))); } catch (_) { resolve(null); } }); });
        r.on('error', () => resolve(null)); r.on('timeout', () => r.destroy());
        r.end();
    });
}
function reqBuf(path) {
    return new Promise((resolve, reject) => {
        const r = https.request({
            method: 'GET', host: HOST, path,
            headers: { 'User-Agent': 'Mozilla/5.0 (SEAGNAL/advisory)', 'Referer': BASE + '/w/index.do', 'Accept': 'image/*,*/*' },
            timeout: HTTP_TIMEOUT_MS,
        }, (o) => {
            const c = []; o.on('data', (d) => c.push(d));
            o.on('end', () => {
                const ct = (o.headers['content-type'] || '').toLowerCase();
                if (o.statusCode !== 200 || ct.indexOf('image') === -1) return reject(new Error(`이미지 아님 (HTTP ${o.statusCode}, ${ct})`));
                resolve(Buffer.concat(c));
            });
        });
        r.on('error', reject); r.on('timeout', () => r.destroy(new Error('timeout')));
        r.end();
    });
}

// headData prefix(예: "0#12#3#/DATA/CHT/KIMA/#/kim_cww3_jeju_wind_") → { area, signal }
function parsePrefix(headData) {
    const prefix = String(headData || '').split('#/').pop() || '';
    const m = prefix.match(/kim_cww3_([a-z]+)_(wind|wave)_/);
    if (m) return { area: m[1], signal: m[2] };
    return null;
}

// 세션 없음 — no-op (엔진/도구가 chartClient 와 동일 호출을 해도 안전).
async function login() { return true; }
async function ensureSession() { return true; }

/**
 * 날씨누리 목록 → 엔진 호환 frames. baseTimeYmdhKST(09/21 KST 슬롯)와 목록 최신 base 가
 * 일치할 때만 반환(불일치 → []). frame.tm = KST 유효시각.
 */
async function listFrames({ headData }, baseTimeYmdhKST) {
    const pp = parsePrefix(headData);
    if (!pp) return [];
    const path = `${LIST_PATH}?type=C&data=kim_cww3_[AREA]_${pp.signal}_&area=${pp.area}&unit=km/h&leaflet=0&kmap=0`;
    const list = await reqJson(path);
    if (!Array.isArray(list)) return [];

    const want = new RegExp(`kim_cww3_${pp.area}_${pp.signal}_s(\\d{3})_(\\d{10})\\.gif`);
    const raw = [];
    for (const it of list) {
        const u = it && it.url; if (!u) continue;
        const m = u.match(want); if (!m) continue;
        raw.push({ step: +m[1], baseUtc: m[2], url: u.startsWith('/') ? BASE + u : u, fileName: u.split('/').pop() });
    }
    if (!raw.length) return [];

    // 목록 최신 base(UTC). KST 슬롯 = UTC base + 9h. 요청 슬롯과 다르면 [].
    const latestBaseUtc = raw.map((f) => f.baseUtc).sort().pop();
    const baseKstYmdh = ymdh(new Date(ymdhToDate(latestBaseUtc).getTime() + 9 * 3600 * 1000));
    if (baseTimeYmdhKST && String(baseTimeYmdhKST) !== baseKstYmdh) return [];

    const baseKstMs = ymdhToDate(baseKstYmdh).getTime();
    return raw
        .filter((f) => f.baseUtc === latestBaseUtc)
        .map((f) => ({
            // 유효시각(KST) = base(KST) + step h → 엔진 seq 가 ymdhToKstDate 로 읽음
            tm: ymdh(new Date(baseKstMs + f.step * 3600 * 1000)),
            url: f.url, fileName: f.fileName,
            stm: 's' + pad(f.step), ftHours: f.step,
        }))
        .sort((a, b) => a.ftHours - b.ftHours);
}

async function downloadFrame(frame) {
    const u = frame && frame.url ? frame.url : '';
    const path = u.startsWith(BASE) ? u.slice(BASE.length) : (u.startsWith('/') ? u : ('/' + u));
    return reqBuf(path);
}

module.exports = {
    REGIONAL_OFFICES, NATIONAL_WAVE,
    login, ensureSession, listFrames, downloadFrame,
    _parsePrefix: parsePrefix,
};
