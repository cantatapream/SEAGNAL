/**
 * ============================================================================
 * 파일명: services/ecmwf_bufr.js
 * 역할 : 유럽중기예보센터(ECMWF)가 공개하는 태풍 경로 파일(BUFR)을 풀어 우리 태풍
 *        프레임으로 옮긴다.
 * ============================================================================
 *
 * [어디서 받나 — 2026-09-26 실제로 받아 확인]
 *   https://data.ecmwf.int/forecasts/YYYYMMDD/HHz/ifs/0p25/oper/YYYYMMDDHH0000-360h-oper-tf.bufr
 *   00·12 UTC 두 번, 태풍이 있을 때만 올라온다. 한 파일에 전 세계 태풍이 메시지 하나씩
 *   들어 있다(2026-09-25 12z 파일: 25개 — 실제 태풍 6개 + 발생 예상 자리 19개).
 *   이용 조건: CC-BY-4.0 + ECMWF 이용약관 — 출처를 밝히면 재배포·상업 이용 가능
 *   (https://www.ecmwf.int/en/forecasts/datasets/open-data).
 *
 * [BUFR 이 무엇인가] 세계기상기구(WMO)가 정한 이진(0과 1) 형식이다. 글자로 읽을 수 없고,
 *   '어느 칸이 몇 비트이고 어떻게 숫자로 바꾸는지'를 표로 알아야 풀린다.
 *   보통은 ECMWF 의 ecCodes 라는 도구로 푸는데, 우리 서버(노드)에는 없다.
 *
 * [왜 직접 푸나] ecCodes 를 서버 이미지에 넣으려면 파이썬 꾸러미를 새로 깔아야 하는데,
 *   그 빌드를 이 작업 공간에서 시험할 수 없어 배포 때 깨질 위험이 있다. 반면 이 파일은
 *   **틀이 한 가지뿐**이다(WMO 템플릿 3-16-082 · 비압축 · 메시지당 1건). 그 틀 하나만
 *   정확히 풀면 된다. 각 칸의 비트 폭·배율·기준값은 ecCodes 에서 그대로 뽑아 옮겼고
 *   (마스터 표 35판), ecCodes 가 푼 값과 **전 칸 대조**하는 시험을 둔다
 *   (scripts/test_typhoon_ecmwf.js — 정답지 fixtures/ecmwf_oper_tf_oracle.json).
 *
 * [틀이 다르면 풀지 않는다] 템플릿·압축·표 판·건수 중 하나라도 다르면 그 메시지는
 *   건너뛴다 — 비트가 한 칸만 어긋나도 뒤가 전부 엉뚱한 숫자가 되므로, 추측으로 풀지 않는다.
 *
 * [틀의 모양 — 3-16-082]
 *   머리    센터·서브센터·생성앱·태풍번호(3자)·이름(10자)·섭동기법·앙상블번호·종류·연월일시분
 *   처음    ①관측 중심(구분1) ②모델 분석 중심(구분5)+해면기압 ③최대풍 위치(구분3)+풍속
 *           ④풍속 기준 3개(18·26·33 m/s) × 네 사분면 반경
 *   반복    (지연반복 횟수 1칸) × [시간구분·예보시간 + 중심+기압 + 최대풍 위치+풍속 + ④]
 *
 * [주요 함수]
 *   decodeMessages(buf)   파일 전체 → 메시지별 원자료 배열(틀이 안 맞는 것은 null)
 *   toTyphoon(rec)        원자료 하나 → { id, name, baseKst, frames } (가짜 자리면 null)
 *
 * [연계]
 *   → local_server/routes/typhoon_foreign.js 가 이 모듈로 해독한다
 *   → local_server/scripts/test_typhoon_ecmwf.js
 * ============================================================================
 */

'use strict';

const jtwc = require('./jtwc_parse');   // 네 방향 반경 → 장·단반경 규칙을 같이 쓴다

const KST_OFFSET_MS = 9 * 3600 * 1000;
const TEMPLATE_316082 = (3 << 14) | (16 << 8) | 82;   // F=3 X=16 Y=082 를 16비트로
const MASTER_TABLE_VERSION = 35;

// 칸 정의 — [이름, 비트, 배율, 기준값]. ecCodes 2.49.0 이 이 파일에서 보고한 값 그대로다.
const E = {
    centre: ['centre', 8, 0, 0],
    subCentre: ['subCentre', 8, 0, 0],
    genApp: ['genApp', 8, 0, 0],
    technique: ['technique', 8, 0, 0],
    member: ['member', 10, 0, 0],
    ensType: ['ensType', 8, 0, 0],
    year: ['year', 12, 0, 0],
    month: ['month', 4, 0, 0],
    day: ['day', 6, 0, 0],
    hour: ['hour', 5, 0, 0],
    minute: ['minute', 6, 0, 0],
    sig: ['sig', 4, 0, 0],              // 0-08-005 기상 속성 구분(1=중심 3=최대풍 위치 5=모델 분석)
    lat: ['lat', 15, 2, -9000],         // 0-05-002
    lon: ['lon', 16, 2, -18000],        // 0-06-002
    pmsl: ['pmsl', 14, -1, 0],          // 0-10-051 해면기압(Pa)
    wind: ['wind', 12, 1, 0],           // 0-11-012 10m 풍속(m/s)
    thr: ['thr', 8, 0, 0],              // 0-19-003 풍속 기준(m/s)
    bearing: ['bearing', 16, 2, 0],     // 0-05-021 방위(도)
    radius: ['radius', 15, -2, 0],      // 0-19-004 반경(m)
    timeSig: ['timeSig', 5, 0, 0],      // 0-08-021
    period: ['period', 12, 0, -2048],   // 0-04-024 예보 시간(h)
    repl: ['repl', 8, 0, 0]             // 0-31-001 지연반복 횟수
};

/** 비트 단위로 읽는 도우미. */
function BitReader(buf, startByte, endByte) {
    this.buf = buf; this.pos = startByte * 8; this.end = endByte * 8;
}
BitReader.prototype.read = function (n) {
    if (this.pos + n > this.end) throw new Error('bits_overflow');
    let v = 0;
    for (let i = 0; i < n; i++) {
        const byte = this.buf[(this.pos + i) >> 3];
        v = v * 2 + ((byte >> (7 - ((this.pos + i) & 7))) & 1);
    }
    this.pos += n;
    return v;
};

/**
 * 숫자 칸 하나를 읽는다. 비트가 전부 1이면 '값 없음' → null.
 * 예: 위도 15비트 raw=11130, 기준 -9000, 배율 2 → (11130-9000)/100 = 21.3
 */
function readNum(br, def) {
    const width = def[1], scale = def[2], ref = def[3];
    const raw = br.read(width);
    if (raw === Math.pow(2, width) - 1) return null;
    const v = (raw + ref) / Math.pow(10, scale);
    return Math.round(v * 1e6) / 1e6;   // 부동소수 찌꺼기 정리
}
/** 글자 칸(8비트 × n자). 전부 1이면 null. */
function readChars(br, n) {
    let s = '', allOnes = true;
    for (let i = 0; i < n; i++) {
        const c = br.read(8);
        if (c !== 255) allOnes = false;
        s += String.fromCharCode(c);
    }
    return allOnes ? null : s.trim();
}

/** 위치 한 칸(구분·위도·경도). */
function readLoc(br) {
    return { sig: readNum(br, E.sig), lat: readNum(br, E.lat), lon: readNum(br, E.lon) };
}
/** 풍속 기준 3개 × 네 사분면 반경. [{thr, quads:[{b1,b2,r}×4]}×3] */
function readRadii(br) {
    const out = [];
    for (let t = 0; t < 3; t++) {
        const thr = readNum(br, E.thr);
        const quads = [];
        for (let q = 0; q < 4; q++) {
            quads.push({ b1: readNum(br, E.bearing), b2: readNum(br, E.bearing), r: readNum(br, E.radius) });
        }
        out.push({ thr: thr, quads: quads });
    }
    return out;
}

/**
 * 메시지 한 개를 푼다. 틀이 우리가 아는 것과 다르면 null.
 * @param {Buffer} buf - 파일 전체
 * @param {number} at - 'BUFR' 가 시작하는 위치
 * @returns {{rec:Object|null, next:number}} 다음 메시지 위치와 함께
 */
function decodeOne(buf, at) {
    const total = buf.readUIntBE(at + 4, 3);
    const edition = buf[at + 7];
    const next = at + total;
    if (edition !== 4 || next > buf.length) return { rec: null, next: Math.max(next, at + 8) };

    let p = at + 8;                                  // 1절
    const s1len = buf.readUIntBE(p, 3);
    const masterVer = buf[p + 13];
    const hasS2 = (buf[p + 9] & 0x80) !== 0;
    p += s1len;
    if (hasS2) p += buf.readUIntBE(p, 3);            // 2절(있으면 건너뜀)

    const s3len = buf.readUIntBE(p, 3);              // 3절 — 틀 확인
    const subsets = buf.readUInt16BE(p + 4);
    const compressed = (buf[p + 6] & 0x40) !== 0;
    const ndesc = (s3len - 7) >> 1;
    const desc0 = buf.readUInt16BE(p + 7);
    p += s3len;
    if (masterVer !== MASTER_TABLE_VERSION || subsets !== 1 || compressed ||
        ndesc < 1 || desc0 !== TEMPLATE_316082) {
        return { rec: null, next: next };
    }

    const s4len = buf.readUIntBE(p, 3);              // 4절 — 자료
    const br = new BitReader(buf, p + 4, p + s4len);
    try {
        const rec = {
            centre: readNum(br, E.centre),
            subCentre: readNum(br, E.subCentre),
            genApp: readNum(br, E.genApp),
            id: readChars(br, 3),
            name: readChars(br, 10),
            technique: readNum(br, E.technique),
            member: readNum(br, E.member),
            ensType: readNum(br, E.ensType),
            date: [readNum(br, E.year), readNum(br, E.month), readNum(br, E.day),
                   readNum(br, E.hour), readNum(br, E.minute)]
        };
        // 처음 시점
        const obs = readLoc(br);
        const ana = readLoc(br); ana.pmsl = readNum(br, E.pmsl);
        const mw = readLoc(br); mw.wind = readNum(br, E.wind);
        rec.initial = { obs: obs, ana: ana, maxWind: mw, radii: readRadii(br) };
        // 반복 시점
        const n = readNum(br, E.repl);
        rec.periods = [];
        for (let i = 0; i < (n || 0); i++) {
            const timeSig = readNum(br, E.timeSig);
            const period = readNum(br, E.period);
            const c = readLoc(br); c.pmsl = readNum(br, E.pmsl);
            const m = readLoc(br); m.wind = readNum(br, E.wind);
            rec.periods.push({ timeSig: timeSig, period: period, centre: c, maxWind: m, radii: readRadii(br) });
        }
        return { rec: rec, next: next };
    } catch (e) {
        return { rec: null, next: next };               // 비트가 모자라면 틀이 다른 것 — 버린다
    }
}

/**
 * 파일 전체를 메시지별로 푼다.
 * 예: decodeMessages(oper-tf.bufr) → [{ id:'15E', name:'NOLO', … }, …, { id:'32W', name:'SURIGAE', … }]
 * @param {Buffer} buf
 * @returns {Array} 메시지 순서대로. 틀이 안 맞은 메시지는 null
 */
function decodeMessages(buf) {
    const out = [];
    if (!Buffer.isBuffer(buf)) return out;
    let at = buf.indexOf('BUFR');
    while (at >= 0 && at + 8 <= buf.length) {
        const r = decodeOne(buf, at);
        out.push(r.rec);
        at = buf.indexOf('BUFR', r.next);
    }
    return out;
}

/** 풍속 기준 하나의 네 사분면 반경(m) → {ne,se,sw,nw} km. 전부 없으면 null. */
function quadsToKm(entry) {
    if (!entry) return null;
    const q = {};
    let any = false;
    entry.quads.forEach((x) => {
        // 방위 쌍(0→90 북동, 90→180 남동, 180→270 남서, 270→0 북서)으로 사분면을 정한다.
        const key = ({ 0: 'ne', 90: 'se', 180: 'sw', 270: 'nw' })[x.b1];
        if (!key) return;
        if (x.r !== null) any = true;
        q[key] = (x.r === null) ? 0 : Math.round(x.r / 1000);
    });
    return any ? q : null;
}
/** 풍속 기준값(m/s)으로 해당 칸을 찾는다. */
function radiiAt(radii, thr) {
    return (radii || []).find(r => r.thr === thr) || null;
}

/** UTC 각 조각 + 시간 → 한국시각 문자열. */
function kstStamp(date, plusHours) {
    const ms = Date.UTC(date[0], date[1] - 1, date[2], date[3], date[4]) + (plusHours || 0) * 3600 * 1000;
    const d = new Date(ms + KST_OFFSET_MS);
    const p = (n) => String(n).padStart(2, '0');
    return String(d.getUTCFullYear()) + p(d.getUTCMonth() + 1) + p(d.getUTCDate())
         + p(d.getUTCHours()) + p(d.getUTCMinutes());
}

/**
 * 모델 풍속(m/s) → 기상청 강도(0~5). 환산하지 않는다.
 * [주의] 이 파일의 풍속은 관측처럼 '몇 분 평균'이 정해진 값이 아니라 모델이 계산한 10m
 *   바람이다. 어느 평균에 맞춰 환산할 근거가 없어 그대로 기상청 기준에 대 보고,
 *   화면 안내문에 '참고용'이라고 밝힌다.
 */
function gradeOfWind(ms) {
    if (typeof ms !== 'number' || !isFinite(ms)) return null;
    if (ms >= 54) return 5;
    if (ms >= 44) return 4;
    if (ms >= 33) return 3;
    if (ms >= 25) return 2;
    if (ms >= 17) return 1;
    return 0;
}

/** 한 시점 → 우리 프레임. */
function toFrame(time, lat, lon, pmsl, wind, radii, isCurrent) {
    const q34 = quadsToKm(radiiAt(radii, 18));   // 18 m/s ≈ 34노트
    const q50 = quadsToKm(radiiAt(radii, 26));   // 26 m/s ≈ 50노트
    const q64 = quadsToKm(radiiAt(radii, 33));   // 33 m/s ≈ 64노트
    const a34 = jtwc._quadToAsym(q34), a50 = jtwc._quadToAsym(q50);
    return {
        time: time,
        lat: lat,
        lon: lon,
        pressure: (pmsl !== null) ? Math.round(pmsl / 100) : null,   // Pa → hPa
        windMs: (wind !== null) ? Math.round(wind) : null,
        windKmh: (wind !== null) ? Math.round(wind * 3.6) : null,
        gustMs: null,             // 이 파일에는 돌풍이 없다
        dir: '',
        speedKmh: null,           // 이동 속력·방향도 없다 — 위치로 계산하지 않는다
        radStrong: a34 ? a34.long : null,
        radStrongS: a34 ? a34.short : null,
        radStrongD: a34 ? a34.dir : '',
        radStorm: a50 ? a50.long : null,
        radStormS: a50 ? a50.short : null,
        radStormD: a50 ? a50.dir : '',
        radQuad34: q34,
        radQuad50: q50,
        radQuad64: q64,
        radProb: null,            // 결정론 예측 하나라 70% 확률반경이 없다
        grade: gradeOfWind(wind),
        stormType: '',
        size: '',
        isCurrent: !!isCurrent
    };
}

/**
 * 원자료 하나 → 태풍. 관측 위치가 없는 '발생 예상 자리'(70W·71E …)는 null.
 * [처음 시점의 위치] 관측 중심(구분1)을 쓴다 — 다른 기관과 같은 '지금 위치'다.
 *   기압은 모델 분석(구분5)에, 풍속은 최대풍 위치(구분3)에 붙어 온다.
 * @param {Object} rec - decodeMessages 결과 하나
 * @returns {{id,name,baseKst,frames}|null}
 */
function toTyphoon(rec) {
    if (!rec || !rec.initial) return null;
    const i0 = rec.initial;
    // [관측 위치가 없으면 버린다] '70W·71E …' 같은 발생 예상 자리는 관측 중심이 비어 있고
    //   모델 분석 위치만 있다. 모델 위치로 채우면 이미 있는 태풍(수리개 등)이 번호만 바꿔
    //   한 번 더 나온다 — 2026-09-25 12z 파일에서 71W 가 수리개와 같은 값으로 겹쳤다.
    const lat0 = i0.obs.lat, lon0 = i0.obs.lon;
    if (lat0 === null || lon0 === null) return null;
    if (!/^\d{2}[A-Z]$/.test(String(rec.id || ''))) return null;

    const frames = [toFrame(kstStamp(rec.date, 0), lat0, lon0, i0.ana.pmsl, i0.maxWind.wind, i0.radii, true)];
    rec.periods.forEach((pd) => {
        if (pd.period === null || pd.centre.lat === null || pd.centre.lon === null) return;   // 소멸 뒤는 빈 칸
        frames.push(toFrame(kstStamp(rec.date, pd.period), pd.centre.lat, pd.centre.lon,
                            pd.centre.pmsl, pd.maxWind.wind, pd.radii, false));
    });
    return {
        id: rec.id,
        name: String(rec.name || rec.id).toUpperCase(),
        baseKst: kstStamp(rec.date, 0),
        frames: frames
    };
}

module.exports = {
    decodeMessages,
    toTyphoon,
    _kstStamp: kstStamp,
    _gradeOfWind: gradeOfWind,
    _quadsToKm: quadsToKm
};
