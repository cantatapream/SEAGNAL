/**
 * ============================================================================
 * 파일명: routes/typhoon_foreign.js
 * 역할: 해외 기관 태풍 자료를 우리 태풍 탭이 쓰는 형식으로 바꿔 내주는 API.
 *       지금은 미국 JTWC(합동태풍경보센터) 하나 — Xweather 를 거쳐 받는다.
 * ============================================================================
 *
 * - GET /api/typhoon/foreign?src=jtwc → 활성 태풍 + 통보(자문) 1건 + 예보 프레임
 *
 * [왜 서버에서 바꾸나]
 * 화면(ocean_typhoon.js)은 기상청 통보문 형식(프레임 배열)에 맞춰 이미 다 짜여 있다.
 * 해외 자료를 그 형식으로 **서버에서** 맞춰 내주면 화면 코드를 거의 안 고쳐도 된다.
 *
 * [기상청과 다른 점 — 그대로 옮길 수 없는 것들]
 *   1. 중심기압: JTWC 는 시점별 기압을 주지 않는다(태풍 전체의 생애 최저만).
 *      → pressure 는 null 로 둔다. 없는 값을 지어내지 않는다.
 *   2. 70% 확률반경: 없다(대신 오차 원뿔을 주는데 이번 단계에서는 쓰지 않는다).
 *      → radProb 는 null. 화면에서 그 체크박스는 꺼진다.
 *   3. 풍속반경: 기상청은 "장반경 + 단반경 + 단반경 방위" 세 값인데,
 *      JTWC 는 **북동·남동·남서·북서 네 방향 거리**를 준다.
 *      → 가장 먼 쪽을 장반경, 가장 가까운 쪽을 단반경과 그 방위로 옮긴다(근사).
 *        네 값 중 최대·최소는 그대로 살아나고 그 사이는 화면의 기존 S-커브로 이어진다.
 *        원본 네 값은 radQuad34 / radQuad50 로 함께 실어 보낸다(나중에 정확히 그릴 때 쓴다).
 *   4. 풍속 평균 시간: JTWC 1분 · 기상청 10분. 같은 태풍도 숫자가 다르다.
 *      → 강도(grade)는 풍속을 **10분 평균으로 환산(×0.88)한 뒤** 기상청 임계값에 넣는다.
 *        폭풍 종류(stormType)는 풍속이 아예 없을 때만 쓴다 — 종류 코드만으로는
 *        기상청 6단계로 못 나눈다(JTWC 의 TS 한 칸이 기상청 '약'과 '중'에 걸쳐 있다).
 *
 * [시각] Xweather 는 UTC+10 기준 문자열로 준다. 여기서 한국시각(KST) 문자열로 바꿔 보낸다.
 *
 * [인증키] process.env.XWEATHER_CLIENT_ID / XWEATHER_CLIENT_SECRET (Fly secrets).
 *   미설정 시 success:false + reason:'no_key' → 화면이 "준비 중"으로 처리한다.
 *
 * [호출수] 무료 등급 월 15,000회. 상류가 6시간마다 갱신되므로 30분 캐시면 충분하다.
 *
 * [연계 파일]
 * - server.js → app.use() 로 등록
 * - client/js/typhoon/ocean_typhoon.js → 출처 드롭다운에서 "미국(JTWC)" 선택 시 호출
 * ============================================================================
 */

'use strict';

const express = require('express');
const router = express.Router();

const CLIENT_ID = process.env.XWEATHER_CLIENT_ID || '';
const CLIENT_SECRET = process.env.XWEATHER_CLIENT_SECRET || '';
const BASE = 'https://data.api.xweather.com/tropicalcyclones';
const HTTP_TIMEOUT_MS = 10000;
const TTL_MS = 30 * 60 * 1000;          // 상류가 6시간마다 갱신 — 30분이면 충분
const KST_OFFSET_MS = 9 * 3600 * 1000;

if (!CLIENT_ID || !CLIENT_SECRET) {
    console.log('[typhoon-foreign] XWEATHER 키 미설정 — 해외 태풍 출처 비활성 (앱은 정상).');
}

let cache = null;   // { at: ms, data: 응답객체 }

/** epoch ms → 우리 프레임의 시각 문자열 "YYYYMMDDHHmm" (한국시각 기준). */
function toKstStamp(ms) {
    const d = new Date(ms + KST_OFFSET_MS);
    const p = n => String(n).padStart(2, '0');
    return String(d.getUTCFullYear()) + p(d.getUTCMonth() + 1) + p(d.getUTCDate())
         + p(d.getUTCHours()) + p(d.getUTCMinutes());
}

/**
 * Xweather 가 준 시각 조각에서 epoch ms 를 꺼낸다.
 * 예: { timestamp: 1790100000 } → 1790100000000
 * @param {Object} o - timestamp(초) 또는 dateTimeISO 를 가진 객체
 * @returns {number|null}
 */
function pickMs(o) {
    if (!o) return null;
    if (typeof o.timestamp === 'number') return o.timestamp * 1000;
    if (o.dateTimeISO) {
        const t = Date.parse(o.dateTimeISO);
        if (!isNaN(t)) return t;
    }
    return null;
}

/**
 * JTWC 폭풍 종류 → 우리 강도(0~5). 풍속이 없을 때만 쓰는 보조 수단.
 * 예: 'TY' → 3
 * [한계] 종류 코드는 기상청 6단계보다 칸이 굵다 — JTWC 의 'TS'(34~63노트) 하나가
 *   기상청 '약'과 '중'에 걸쳐 있다. 그래서 풍속이 있으면 gradeOfWind 를 먼저 쓴다.
 * [모르는 코드] null 을 돌려준다. 0(열대저압부)으로 떨어뜨리면 센 태풍이
 *   가장 약한 등급으로 보인다 — 실제로 허리케인 Polo(920hPa)가 그렇게 나왔다.
 * @param {string} t - stormType (TD/TS/STS/TY/STY/HU 등)
 * @returns {number|null} 0(열대저압부) ~ 5(초강력), 모르는 코드면 null
 */
function gradeOfStormType(t) {
    switch (String(t || '').toUpperCase()) {
        case 'TD': return 0;    // 열대저압부
        case 'TS': return 1;    // 열대폭풍
        case 'STS': return 2;   // 강한 열대폭풍
        case 'TY': return 3;    // 태풍
        case 'STY': return 5;   // 슈퍼 태풍
        case 'H': return 3;     // 허리케인 — 실제로 오는 코드(2026-09-22 운영 응답에서 확인)
        case 'HU': return 3;    // 허리케인(다른 해역 표기)
        default: return null;
    }
}

/** 1분 평균 → 10분 평균 환산계수(WMO 전통값). [출처] WMO 1993 · Harper et al. 2010 */
const MIN1_TO_MIN10 = 0.88;

/**
 * JTWC 풍속(1분 평균 m/s) → 기상청 강도(0~5).
 * 예: gradeOfWind(74) → 5 (74×0.88=65.1 m/s → 초강력)
 * [왜 환산하나] 기상청 임계값 17/25/33/44/54 m/s 는 **10분 평균** 기준이다.
 *   JTWC 의 1분 평균을 그대로 넣으면 한 단계 높게 나온다.
 * @param {number} ms - 1분 평균 최대풍속(m/s)
 * @returns {number|null} 0~5, 숫자가 아니면 null
 */
function gradeOfWind(ms) {
    if (typeof ms !== 'number' || !isFinite(ms)) return null;
    const w = ms * MIN1_TO_MIN10;
    if (w >= 54) return 5;
    if (w >= 44) return 4;
    if (w >= 33) return 3;
    if (w >= 25) return 2;
    if (w >= 17) return 1;
    return 0;
}

/** 네 방향 중심 방위(도) — 사분면 대표 방향. */
const QUAD_DIR = { ne: 'NE', se: 'SE', sw: 'SW', nw: 'NW' };

/**
 * 풍속반경 배열에서 원하는 등급(노트)의 사분면 거리(km)를 꺼낸다.
 * 예: pickQuad(windRadii, 34) → { ne: 166.68, se: 351.88, sw: 370.4, nw: 240.76 }
 * @param {Array} radii - details.windRadii
 * @param {number} kts - 34 또는 50
 * @returns {Object|null} 네 방향 거리(km), 없으면 null
 */
function pickQuad(radii, kts) {
    if (!Array.isArray(radii)) return null;
    const hit = radii.find(r => r && r.windSpeedKTS === kts);
    if (!hit || !hit.quadrants) return null;
    const out = {};
    let any = false;
    ['ne', 'se', 'sw', 'nw'].forEach(k => {
        const v = hit.quadrants[k] && hit.quadrants[k].distanceKM;
        out[k] = (typeof v === 'number' && isFinite(v)) ? Math.round(v) : 0;
        if (out[k] > 0) any = true;
    });
    return any ? out : null;
}

/**
 * 네 방향 거리 → 우리 형식의 (장반경, 단반경, 단반경 방위).
 * 예: {ne:167, se:352, sw:370, nw:241} → { long:370, short:167, dir:'NE' }
 * 가장 먼 쪽·가장 가까운 쪽은 그대로 살아나고, 그 사이는 화면이 S-커브로 잇는다(근사).
 * @param {Object|null} q - pickQuad 결과
 * @returns {{long:number, short:number, dir:string}|null}
 */
function quadToAsym(q) {
    if (!q) return null;
    const keys = ['ne', 'se', 'sw', 'nw'];
    let maxK = keys[0], minK = keys[0];
    keys.forEach(k => {
        if (q[k] > q[maxK]) maxK = k;
        if (q[k] < q[minK]) minK = k;
    });
    if (!(q[maxK] > 0)) return null;
    return { long: q[maxK], short: q[minK], dir: QUAD_DIR[minK] };
}

/**
 * Xweather 의 한 시점(현재 또는 예보) → 우리 프레임 한 칸.
 * @param {Object} node - position 또는 forecast[i]
 * @param {boolean} isCurrent - 관측 현재 위치인가
 * @returns {Object|null} 우리 프레임(lat/lon 없으면 null)
 */
function toFrame(node, isCurrent) {
    if (!node) return null;
    const d = node.details || {};
    const loc = node.loc || (node.location && Array.isArray(node.location.coordinates)
        ? { long: node.location.coordinates[0], lat: node.location.coordinates[1] } : null);
    if (!loc || typeof loc.lat !== 'number' || typeof loc.long !== 'number') return null;

    const q34 = pickQuad(d.windRadii, 34);
    const q50 = pickQuad(d.windRadii, 50);
    const a34 = quadToAsym(q34);
    const a50 = quadToAsym(q50);
    const mv = d.movement || {};
    const ms = pickMs(node);
    const windMs = (typeof d.windSpeedMPS === 'number') ? d.windSpeedMPS : null;

    return {
        time: ms ? toKstStamp(ms) : null,
        lat: loc.lat,
        lon: loc.long,
        pressure: (typeof d.pressureMB === 'number') ? d.pressureMB : null,   // 보통 null 로 온다
        windMs: windMs,
        windKmh: (typeof d.windSpeedKPH === 'number') ? d.windSpeedKPH : null,
        gustMs: (typeof d.gustSpeedMPS === 'number') ? d.gustSpeedMPS : null,
        dir: mv.direction || '',
        speedKmh: (typeof mv.speedKPH === 'number') ? mv.speedKPH : null,
        radStrong: a34 ? a34.long : null,
        radStrongS: a34 ? a34.short : null,
        radStrongD: a34 ? a34.dir : '',
        radStorm: a50 ? a50.long : null,
        radStormS: a50 ? a50.short : null,
        radStormD: a50 ? a50.dir : '',
        radQuad34: q34,          // 원본 네 방향 값(정확히 그릴 때 쓰려고 함께 보낸다)
        radQuad50: q50,
        radProb: null,           // JTWC 는 70% 확률반경을 주지 않는다
        // 풍속이 있으면 풍속으로, 없으면 폭풍 종류로. 둘 다 없으면 null(화면이 0으로 그린다).
        grade: (gradeOfWind(windMs) != null) ? gradeOfWind(windMs) : gradeOfStormType(d.stormType),
        stormType: d.stormType || '',   // 원본 코드 — 등급이 이상할 때 무엇을 받았는지 보이게 둔다
        size: '',
        isCurrent: !!isCurrent
    };
}

/** 상류 호출 + 30분 캐시. 실패하면 null. */
async function fetchActive() {
    if (cache && (Date.now() - cache.at) < TTL_MS) return cache.data;
    const url = `${BASE}/?client_id=${encodeURIComponent(CLIENT_ID)}`
              + `&client_secret=${encodeURIComponent(CLIENT_SECRET)}&limit=10`;
    let json = null;
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
        if (!res.ok) { console.log(`[typhoon-foreign] 상류 응답 ${res.status}`); return null; }
        json = await res.json();
    } catch (e) {
        console.log(`[typhoon-foreign] 호출 실패: ${e.message}`);
        return null;
    }
    if (!json || json.success !== true) {
        const code = json && json.error && json.error.code;
        // 활성 태풍이 없을 때도 success:false(warn_no_data)로 오므로 실패로 보지 않는다.
        if (code && String(code).indexOf('warn_no_data') < 0) {
            console.log(`[typhoon-foreign] 상류 오류: ${code}`);
            return null;
        }
        json = { response: [] };
    }
    cache = { at: Date.now(), data: json };
    return json;
}

/**
 * GET /api/typhoon/foreign?src=jtwc
 * 성공: { success:true, src:'jtwc', label:'미국(JTWC)', updatedAt, year, hasActive, typhoons:[…] }
 *   typhoons[i] = { seq, name, nameEn, latestTmFc, bulletins:[{ code,label,isLatest,current,forecast[] }] }
 *   — 기상청 응답과 같은 모양이라 화면(ocean_typhoon.js)이 그대로 그린다.
 * 실패: { success:false, reason:'no_key'|'bad_src'|'upstream' }
 */
router.get('/api/typhoon/foreign', async (req, res) => {
    res.set('Cache-Control', 'public, max-age=600');

    const src = String(req.query.src || 'jtwc').toLowerCase();
    if (src !== 'jtwc') return res.json({ success: false, reason: 'bad_src' });
    if (!CLIENT_ID || !CLIENT_SECRET) return res.json({ success: false, reason: 'no_key' });

    const raw = await fetchActive();
    if (!raw) return res.json({ success: false, reason: 'upstream' });

    const list = Array.isArray(raw.response) ? raw.response : [];
    const typhoons = [];

    list.forEach(st => {
        const prof = st.profile || {};
        const pos = st.position || {};
        const cur = toFrame(pos, true);
        const forecast = (Array.isArray(st.forecast) ? st.forecast : [])
            .map(f => toFrame(f, false))
            .filter(Boolean);
        if (!cur && !forecast.length) return;

        const det = (pos.details) || {};
        const adv = det.advisoryNumber || '';
        const stamp = (cur && cur.time) || (forecast[0] && forecast[0].time) || '';
        const label = '[ JTWC ] ' + (adv ? '제' + adv + '호 자문' : '최신 자문')
                    + (stamp ? ' / ' + stamp.slice(4, 6) + '.' + stamp.slice(6, 8) + '. '
                             + stamp.slice(8, 10) + ':' + stamp.slice(10, 12) + ' 기준(KST)' : '');

        typhoons.push({
            seq: String(st.id || prof.name || ''),
            name: prof.name || '(이름 없음)',
            nameEn: prof.name || '',
            latestTmFc: stamp,
            bulletins: [{
                code: String(st.id || '') + '_' + (adv || '0'),
                label: label,
                kind: 'TYP',
                isLatest: true,
                current: cur,
                forecast: forecast,
                // 화면 안내(i 버튼)가 그대로 쓰는 자리 — 기관 차이를 여기서 알린다.
                rem: 'JTWC(미국 합동태풍경보센터) 자료입니다. 풍속은 1분 평균이라 기상청(10분 평균)보다 높게 나옵니다.'
                   + '|강도(약~초강력)는 그 풍속을 10분 평균으로 환산해 기상청 기준에 맞춘 값입니다.'
                   + '|중심기압과 70% 확률반경은 제공되지 않습니다.'
                   + '|강풍·폭풍반경은 네 방향 값 중 가장 먼 쪽·가까운 쪽으로 옮겨 그린 근사입니다.',
                other: 'Xweather 를 통해 받은 JTWC 자료 · 6시간마다 갱신'
            }]
        });
    });

    res.json({
        success: true,
        src: 'jtwc',
        label: '미국(JTWC)',
        updatedAt: new Date().toISOString(),
        year: new Date(Date.now() + KST_OFFSET_MS).getUTCFullYear(),
        hasActive: typhoons.length > 0,
        typhoons: typhoons
    });
});

// 변환 규칙은 화면 없이도 고정해 둔다.
// [연계] → local_server/scripts/test_typhoon_source.js (verify_all.sh SUITES 등록)
router._toFrame = toFrame;
router._clearCache = function () { cache = null; };   // 시험에서 30분 캐시를 비울 때만 쓴다
router._quadToAsym = quadToAsym;
router._pickQuad = pickQuad;
router._gradeOfStormType = gradeOfStormType;
router._gradeOfWind = gradeOfWind;
router._toKstStamp = toKstStamp;

module.exports = router;
