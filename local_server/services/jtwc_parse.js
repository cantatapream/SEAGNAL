/**
 * ============================================================================
 * 파일명: services/jtwc_parse.js
 * 역할 : JTWC(미 합동태풍경보센터)가 공개하는 글자 통보문을 우리 태풍 프레임으로 옮긴다.
 * ============================================================================
 *
 * [왜 이 파일이 생겼는가]
 *   처음에는 JTWC 자료를 Xweather 라는 중계 업체를 거쳐 받았다. 그런데 그 이용약관
 *   (Vaisala General Conditions §2.2·§2.3)이 받은 자료를 "내부 업무용"으로만 쓰도록
 *   제한하고, 제3자에게 배포·공개하는 것을 명시적으로 금지한다. 우리 앱은 일반에
 *   공개돼 있으므로 그 경로로는 쓸 수 없다.
 *   JTWC 자료 자체는 미국 정부 저작물이라 저작권이 없고 누구나 쓸 수 있다.
 *   그래서 중계를 빼고 JTWC 가 공개하는 원본 통보문을 직접 읽는다.
 *
 * [원본이 어떻게 생겼나]
 *   https://www.metoc.navy.mil/jtwc/products/wp2526web.txt
 *     WTPN31 PGTW 250300
 *     SUBJ/TROPICAL STORM 25W (SURIGAE) WARNING NR 008//
 *        WARNING POSITION:
 *        250000Z --- NEAR 19.9N 130.7E
 *          MOVEMENT PAST SIX HOURS - 305 DEGREES AT 11 KTS
 *        MAX SUSTAINED WINDS - 040 KT, GUSTS 050 KT
 *        RADIUS OF 034 KT WINDS - 060 NM NORTHEAST QUADRANT
 *                                 000 NM SOUTHEAST QUADRANT ...
 *        FORECASTS:
 *        12 HRS, VALID AT:
 *        251200Z --- 20.9N 129.1E
 *        ...
 *     REMARKS:
 *        ... MINIMUM CENTRAL PRESSURE AT 250000Z IS 1003 MB. ...
 *
 * [단위] 거리는 해리(NM), 풍속은 노트(KT), 시각은 UTC 의 "일일시시분분Z".
 *   우리 형식은 km · m/s · 한국시각 문자열이라 여기서 전부 바꾼다.
 *
 * [주요 함수]
 *   parseWarning(text)          통보문 한 장 → { seq, name, advisory, current, forecast, … }
 *   parseAdvisory(text)         해역 기상정보(ABPW10·ABIO10) → 활동 중인 태풍 번호·이름
 *   fileBase(code, year)        '25W' + 2026 → 'wp2526' (제품 파일 이름)
 *
 * [연계]
 *   → local_server/routes/typhoon_foreign.js 가 이 모듈로 해독한다
 *   → local_server/scripts/test_typhoon_source.js 가 실제 통보문으로 고정한다
 * ============================================================================
 */

'use strict';

const KM_PER_NM = 1.852;
const MS_PER_KT = 0.514444;
const KST_OFFSET_MS = 9 * 3600 * 1000;

/** 해리 → km (반올림). 값이 없으면 null. */
function nmToKm(nm) {
    if (typeof nm !== 'number' || !isFinite(nm)) return null;
    return Math.round(nm * KM_PER_NM);
}

/** 노트 → m/s (반올림). 값이 없으면 null. */
function ktToMs(kt) {
    if (typeof kt !== 'number' || !isFinite(kt)) return null;
    return Math.round(kt * MS_PER_KT);
}

/**
 * JTWC 의 "일일시시분분Z"(UTC)를 우리 프레임의 한국시각 문자열로 바꾼다.
 * 예: toKstStamp('251200', 2026, 8) → '202609252100'  (9/25 12Z = 9/25 21시 KST)
 * [왜 연·월을 따로 받나] 원문에는 날짜(일)까지만 있고 연·월이 없다. 통보문 발표
 *   시각을 기준으로 채우되, 달을 넘어가면(예: 30일 발표 → 02일 예보) 다음 달로 넘긴다.
 * @param {string} ddhhmm - '251200' 같은 6자리
 * @param {number} baseYear - 기준 연도(발표 시각)
 * @param {number} baseMonth - 기준 월(0~11, 발표 시각)
 * @param {number} baseDay - 기준 일(발표 시각)
 * @returns {string|null} 'YYYYMMDDHHmm'(KST), 못 읽으면 null
 */
function toKstStamp(ddhhmm, baseYear, baseMonth, baseDay) {
    const m = /^(\d{2})(\d{2})(\d{2})$/.exec(String(ddhhmm || ''));
    if (!m) return null;
    const day = +m[1], hh = +m[2], mm = +m[3];
    let y = baseYear, mo = baseMonth;
    // 예보는 앞으로만 간다 — 날짜가 기준일보다 작아지면 달이 넘어간 것이다.
    if (day < baseDay - 15) { mo += 1; if (mo > 11) { mo = 0; y += 1; } }
    const utc = Date.UTC(y, mo, day, hh, mm);
    if (isNaN(utc)) return null;
    const d = new Date(utc + KST_OFFSET_MS);
    const p = n => String(n).padStart(2, '0');
    return String(d.getUTCFullYear()) + p(d.getUTCMonth() + 1) + p(d.getUTCDate())
         + p(d.getUTCHours()) + p(d.getUTCMinutes());
}

/**
 * '19.9N 130.7E' 같은 위경도 → { lat, lon }. 남위·서경은 음수로 바꾼다.
 * 예: parseLatLon('19.9N 130.7E') → { lat: 19.9, lon: 130.7 }
 *     parseLatLon('14.6N 155.8W') → { lat: 14.6, lon: -155.8 }
 * @param {string} s
 * @returns {{lat:number, lon:number}|null}
 */
function parseLatLon(s) {
    const m = /(\d+(?:\.\d+)?)\s*([NS])\s+(\d+(?:\.\d+)?)\s*([EW])/i.exec(String(s || ''));
    if (!m) return null;
    let lat = parseFloat(m[1]), lon = parseFloat(m[3]);
    if (m[2].toUpperCase() === 'S') lat = -lat;
    if (m[4].toUpperCase() === 'W') lon = -lon;
    return { lat: lat, lon: lon };
}

/** 방위(도) → 16방위 글자. 예: 305 → 'NW' */
const DIR16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
               'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
function degToDir(deg) {
    if (typeof deg !== 'number' || !isFinite(deg)) return '';
    return DIR16[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

/**
 * 한 토막(현재 또는 예보 한 시점) 안에서 "RADIUS OF 034 KT WINDS - …" 네 줄을 읽는다.
 * 예: → { 34: {ne:111, se:0, sw:0, nw:130}, 50: {...} }  (단위 km)
 * [왜 토막으로 자르나] 한 통보문에 같은 문구가 시점마다 반복된다. 토막을 먼저 나눠야
 *   어느 시점의 반경인지 섞이지 않는다.
 * @param {string} block - 한 시점 토막의 원문
 * @returns {Object} { 34?:{ne,se,sw,nw}, 50?:…, 64?:… } — km 단위, 없으면 빈 객체
 */
function parseRadii(block) {
    const out = {};
    const re = /RADIUS OF (\d{3}) KT WINDS\s*-\s*(\d{3})\s*NM NORTHEAST QUADRANT\s+(\d{3})\s*NM SOUTHEAST QUADRANT\s+(\d{3})\s*NM SOUTHWEST QUADRANT\s+(\d{3})\s*NM NORTHWEST QUADRANT/g;
    let m;
    while ((m = re.exec(block)) !== null) {
        out[+m[1]] = {
            ne: nmToKm(+m[2]), se: nmToKm(+m[3]),
            sw: nmToKm(+m[4]), nw: nmToKm(+m[5])
        };
    }
    return out;
}

/**
 * 네 방향 거리 → 우리 형식의 (장반경, 단반경, 단반경 방위).
 * 예: {ne:111, se:0, sw:0, nw:130} → { long:130, short:0, dir:'SE' }
 * [왜 남기나] 화면은 네 방향 값이 있으면 그걸로 정확히 그리지만, 말풍선 글자와
 *   기상청 프레임 호환을 위해 장·단반경도 함께 채워 둔다(Xweather 경로와 같은 규칙).
 * @param {Object|null} q
 * @returns {{long:number, short:number, dir:string}|null}
 */
const QUAD_DIR = { ne: 'NE', se: 'SE', sw: 'SW', nw: 'NW' };
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
 * JTWC 폭풍 종류 글자 → 우리 강도(0~5). 풍속이 없을 때만 쓰는 보조 수단.
 * 예: 'SUPER TYPHOON' → 5 · 'TROPICAL DEPRESSION' → 0
 * @param {string} t - SUBJ 줄의 종류 부분
 * @returns {number|null} 모르는 표현이면 null
 */
function gradeOfStormType(t) {
    const s = String(t || '').toUpperCase();
    if (s.indexOf('SUPER TYPHOON') >= 0) return 5;
    if (s.indexOf('TYPHOON') >= 0) return 3;
    if (s.indexOf('HURRICANE') >= 0) return 3;
    if (s.indexOf('TROPICAL DEPRESSION') >= 0) return 0;
    if (s.indexOf('TROPICAL STORM') >= 0) return 1;
    return null;
}

/** 1분 평균 → 10분 평균 환산계수(WMO 전통값). [출처] WMO 1993 · Harper et al. 2010 */
const MIN1_TO_MIN10 = 0.88;

/**
 * JTWC 풍속(1분 평균 m/s) → 기상청 강도(0~5).
 * 예: gradeOfWind(46) → 4 (46×0.88=40.5 m/s → 매우 강)
 * [왜 환산하나] 기상청 임계값 17/25/33/44/54 m/s 는 10분 평균 기준이다.
 * @param {number} ms
 * @returns {number|null}
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

/** 한 토막에서 "MAX SUSTAINED WINDS - 040 KT, GUSTS 050 KT" 를 읽는다. */
function parseWinds(block) {
    const m = /MAX SUSTAINED WINDS\s*-\s*(\d{3})\s*KT(?:,\s*GUSTS\s*(\d{3})\s*KT)?/.exec(block);
    if (!m) return { kt: null, gustKt: null };
    return { kt: +m[1], gustKt: m[2] ? +m[2] : null };
}

/**
 * 통보문 한 장을 우리 프레임 형식으로 옮긴다.
 * 예: parseWarning(wp2526web.txt 내용) →
 *     { seq:'wp2526', name:'SURIGAE', advisory:'008', current:{…}, forecast:[…] }
 * [무엇을 안 하나] 오차 원뿔은 이 통보문에 없다. 없는 것을 지어내지 않는다.
 * @param {string} text - web.txt 원문
 * @returns {Object|null} 못 읽으면 null
 */
function parseWarning(text) {
    const src = String(text || '');
    // SUBJ/TROPICAL STORM 25W (SURIGAE) WARNING NR 008//
    const subj = /SUBJ\/(.+?)\s+(\d{2}[A-Z])\s*(?:\(([^)]*)\))?\s*WARNING NR\s*(\d+)/i.exec(src);
    if (!subj) return null;
    const stormType = subj[1].trim();
    const code = subj[2].toUpperCase();          // '25W'
    const name = (subj[3] || '').trim();         // 'SURIGAE'
    const advisory = String(+subj[4]);           // '8'

    // 전문 머리(WTPN31 PGTW 250300) — 발표 시각의 '일'을 기준일로 쓴다.
    const hdr = /^\s*\w{4}\d{2}\s+\w{4}\s+(\d{2})(\d{4})/m.exec(src);
    const issuedDay = hdr ? +hdr[1] : null;
    // REMARKS 의 '25SEP26' 에서 연·월을 읽는다.
    const MONS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const dstamp = /(\d{2})([A-Z]{3})(\d{2})/.exec(src);
    if (!dstamp || issuedDay === null) return null;
    const baseMonth = MONS.indexOf(dstamp[2].toUpperCase());
    const baseYear = 2000 + (+dstamp[3]);
    if (baseMonth < 0) return null;

    const stamp = (ddhhmm) => toKstStamp(ddhhmm, baseYear, baseMonth, issuedDay);

    // 중심기압 — REMARKS 에 현재 시점 값만 있다. 예보 시점 기압은 주지 않는다.
    const pm = /MINIMUM\s+CENTRAL\s+PRESSURE\s+AT\s+\d{6}Z\s+IS\s+(\d{3,4})\s*MB/i.exec(src.replace(/\s+/g, ' '));
    const pressure = pm ? +pm[1] : null;

    /** 토막 하나 → 프레임 한 칸. */
    function toFrame(block, timeStr, isCurrent) {
        const loc = parseLatLon(block);
        if (!loc) return null;
        const w = parseWinds(block);
        const rad = parseRadii(block);
        const q34 = rad[34] || null, q50 = rad[50] || null, q64 = rad[64] || null;
        const a34 = quadToAsym(q34), a50 = quadToAsym(q50);
        const windMs = ktToMs(w.kt);
        const mv = /MOVEMENT PAST SIX HOURS\s*-\s*(\d{3})\s*DEGREES AT\s*(\d{2,3})\s*KTS/i.exec(block)
                || /VECTOR TO \d+ HR POSIT:\s*(\d{3})\s*DEG\/\s*(\d{2,3})\s*KTS/i.exec(block);
        return {
            time: timeStr,
            lat: loc.lat,
            lon: loc.lon,
            // 기압은 현재 시점에만 있다. 예보 시점은 JTWC 가 발표하지 않는다.
            pressure: isCurrent ? pressure : null,
            windMs: windMs,
            windKmh: (w.kt != null) ? Math.round(w.kt * 1.852) : null,
            gustMs: ktToMs(w.gustKt),
            dir: mv ? degToDir(+mv[1]) : '',
            speedKmh: mv ? Math.round(+mv[2] * 1.852) : null,
            radStrong: a34 ? a34.long : null,
            radStrongS: a34 ? a34.short : null,
            radStrongD: a34 ? a34.dir : '',
            radStorm: a50 ? a50.long : null,
            radStormS: a50 ? a50.short : null,
            radStormD: a50 ? a50.dir : '',
            radQuad34: q34,
            radQuad50: q50,
            radQuad64: q64,       // JTWC 는 64노트(태풍급)까지 준다 — 중계 경로에는 없던 값
            radProb: null,        // 70% 확률반경은 JTWC 가 발표하지 않는다
            grade: (gradeOfWind(windMs) != null) ? gradeOfWind(windMs) : gradeOfStormType(stormType),
            stormType: stormType,
            size: '',
            isCurrent: !!isCurrent
        };
    }

    // ── 현재 위치 ────────────────────────────────────────────────────────────
    //   'WARNING POSITION:' 부터 'FORECASTS:' 직전까지가 현재 시점 토막이다.
    const curBlock = (/WARNING POSITION:([\s\S]*?)(?:FORECASTS:|REMARKS:|$)/i.exec(src) || [])[1] || '';
    const curTime = (/^\s*(\d{6})Z\s*---/m.exec(curBlock) || [])[1];
    const current = curTime ? toFrame(curBlock, stamp(curTime), true) : null;

    // ── 예보 시점들 ──────────────────────────────────────────────────────────
    //   '12 HRS, VALID AT:' 로 시작하는 토막을 차례로 자른다.
    const forecast = [];
    const fcRe = /(\d{1,3})\s*HRS,\s*VALID AT:\s*\n\s*(\d{6})Z\s*---([\s\S]*?)(?=\n\s*\d{1,3}\s*HRS,\s*VALID AT:|\nREMARKS:|$)/gi;
    let fm;
    while ((fm = fcRe.exec(src)) !== null) {
        const f = toFrame(fm[3], stamp(fm[2]), false);
        if (f) forecast.push(f);
    }

    if (!current && !forecast.length) return null;

    return {
        code: code,                                  // '25W'
        seq: fileBase(code, baseYear),               // 'wp2526'
        name: name || code,
        advisory: advisory,
        stormType: stormType,
        issuedKst: current ? current.time : (forecast[0] && forecast[0].time) || '',
        pressure: pressure,
        current: current,
        forecast: forecast
    };
}

/**
 * JTWC 태풍 번호 → 제품 파일 이름의 앞부분.
 * 예: fileBase('25W', 2026) → 'wp2526'  ·  fileBase('17E', 2026) → 'ep1726'
 * [해역 글자] W=북서태평양 · E=동태평양 · C=중태평양 · A/B=인도양 · S/P=남반구
 * @param {string} code - '25W' 같은 번호
 * @param {number} year
 * @returns {string} 못 읽으면 ''
 */
const BASIN_OF_LETTER = { W: 'wp', E: 'ep', C: 'cp', A: 'io', B: 'io', S: 'sh', P: 'sh' };
function fileBase(code, year) {
    const m = /^(\d{1,2})([A-Z])$/.exec(String(code || '').toUpperCase());
    if (!m) return '';
    const basin = BASIN_OF_LETTER[m[2]];
    if (!basin) return '';
    return basin + String(m[1]).padStart(2, '0') + String(year).slice(2);
}

/**
 * 해역 기상정보(ABPW10 / ABIO10)에서 지금 활동 중인 태풍을 뽑는다.
 * 예: '(1) AT 24SEP26 0000Z, TROPICAL STORM 25W (SURIGAE) WAS LOCATED NEAR …'
 *       → [{ code:'25W', name:'SURIGAE', stormType:'TROPICAL STORM' }]
 * [왜 이 글인가] 2026-09-25 확인: 우리 서버에서 jtwc.html 과 products/ 폴더 목록은
 *   둘 다 403 이다. 반면 products/ 안의 **파일**은 받아진다. 이 글도 그 폴더의
 *   파일이라 받아지고, 활동 중인 태풍을 이름·번호와 함께 나열한다.
 *   그래서 번호를 하나씩 두드려 보지 않아도 된다.
 * [없을 때] 'TROPICAL CYCLONE SUMMARY: NONE.' 이면 아무것도 안 나온다 — 빈 배열.
 * @param {string} text - abpwweb.txt 또는 abioweb.txt 원문
 * @returns {Array} [{ code, name, stormType }] — 중복 없이
 */
function parseAdvisory(text) {
    const src = String(text || '').replace(/\s+/g, ' ');
    const out = [];
    const seen = {};
    const re = /(SUPER TYPHOON|TYPHOON|TROPICAL STORM|TROPICAL DEPRESSION|SUBTROPICAL STORM|HURRICANE)\s+(\d{2}[A-Z])\b\s*(?:\(([^)]*)\))?/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        const code = m[2].toUpperCase();
        if (seen[code]) continue;
        seen[code] = true;
        out.push({ stormType: m[1].trim(), code: code, name: (m[3] || '').trim() || code });
    }
    return out;
}

module.exports = {
    parseWarning,
    parseAdvisory,
    fileBase,
    // 아래는 시험에서 규칙을 하나씩 고정하려고 연다.
    _nmToKm: nmToKm,
    _ktToMs: ktToMs,
    _toKstStamp: toKstStamp,
    _parseLatLon: parseLatLon,
    _parseRadii: parseRadii,
    _quadToAsym: quadToAsym,
    _gradeOfWind: gradeOfWind,
    _gradeOfStormType: gradeOfStormType,
    _degToDir: degToDir
};
