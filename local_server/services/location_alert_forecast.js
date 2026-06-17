/**
 * ============================================================================
 * services/location_alert_forecast.js — 위치기반 경보: 구역별 "예측 기상(최악)" 산출
 * ============================================================================
 * 설계 문서: 00_docs/LOCATION_BASED_ALERT_DESIGN.md
 *
 * 위치기반 해상특보 안전경보는 단말 GPS 가 서버로 오지 않는다(개인정보). 따라서
 * "예측 기상" 도 단말이 자기 위치로 직접 조회하면 위치(개략)가 유출되므로,
 * **서버가 구역별로 미리 계산**하여 스냅샷에 주입한다. 단말은 자기 구역의
 * forecast 문자열만 꺼내 표시한다.
 *
 * 데이터 출처 = 앱의 "기상예보" 버튼과 동일:
 *   - 앞바다: regional_forecast_collector.loadCoastalForecasts()
 *   - 먼바다(구역명에 '먼바다' 포함): regional_forecast_collector.loadMarineForecasts()
 *   각 period: { date:'YYYYMMDD', period:'am'|'pm', wind:'동~남동 / 4~8', weather, waveHeight:'0.5~1.0' }
 *   - 중기(선택, 파고만): dataCache.midTermSeaForecasts (= /api/mid-term-sea-forecasts).
 *
 * 최악(특보 기간 중) 선정 규칙(상품 확정):
 *   1) 날짜별 am/pm 중 더 나쁜 쪽: 파고 max 높은 쪽, 동률이면 풍속 max 높은 쪽.
 *   2) 날짜들 중 최악: 파고 max 높은 날, 동률이면 풍속 max 높은 날.
 *   3) 중기는 단기보다 파고 max 가 "엄격히 더 클 때만" 사용(파고만, 풍향/풍속 없음).
 *   4) 데이터 없음/파싱 실패 → null(줄 생략). 절대 throw 하지 않음.
 *
 * 반환: { day:'20', summary:'남동풍 4~12m/s, 파고 1.0~2.0m' } | null
 *
 * 데이터 접근자는 주입 가능(테스트 시 mock period 배열 — 이 개발환경엔 실제 데이터 파일 없음).
 * ============================================================================
 */
'use strict';

// 풍속/방향: "동~남동 / 4~8" → { dir:'동', windRange:'4~8', windMax:8 }
const WIND_PATTERN = /^([가-힣~]+)\s*\/\s*(\d+~\d+)$/;

/** 파고 문자열의 최대 수치. "0.5~1.0"→1.0, "0.5"→0.5, "-"/빈값→null. */
function waveMax(s) {
    if (s == null) return null;
    const str = String(s).trim();
    if (!str || str === '-') return null;
    const nums = str.match(/\d+(?:\.\d+)?/g);
    if (!nums || !nums.length) return null;
    let mx = -Infinity;
    for (const n of nums) {
        const v = parseFloat(n);
        if (Number.isFinite(v) && v > mx) mx = v;
    }
    return mx === -Infinity ? null : mx;
}

/** wind 문자열 파싱 → { dir, windRange, windMax } | null. */
function parseWind(s) {
    if (s == null) return null;
    const str = String(s).trim();
    if (!str) return null;
    const m = str.match(WIND_PATTERN);
    if (!m) return null;
    const dirGroup = m[1];           // 예: "동~남동" 또는 "남동"
    const windRange = m[2];          // 예: "4~8"
    const dir = dirGroup.split('~')[0].trim(); // 첫 토큰
    const wm = waveMax(windRange);   // 풍속 max(범위 둘째 수치)
    if (!dir) return null;
    return { dir, windRange, windMax: wm == null ? -Infinity : wm };
}

/** YYYYMMDD → 일(앞 0 제거) 문자열. 실패 시 null. */
function dayOfDate(dateStr) {
    if (dateStr == null) return null;
    const s = String(dateStr);
    const m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return null;
    const d = parseInt(m[3], 10);
    if (!Number.isFinite(d)) return null;
    return String(d);
}

/**
 * 단기 period 배열 → 날짜별 최악(am/pm 중 나쁜 쪽) 후, 전체 최악 날짜 1건.
 * 반환 { date, dir, windRange, windMax, waveStr, waveMax } | null.
 */
function worstShortTerm(periods) {
    if (!Array.isArray(periods) || !periods.length) return null;
    // 날짜별로 묶기
    const byDate = {};
    for (const p of periods) {
        if (!p || p.date == null) continue;
        const wv = waveMax(p.waveHeight);
        const wind = parseWind(p.wind);
        const cand = {
            date: String(p.date),
            waveStr: (p.waveHeight != null && String(p.waveHeight).trim() && String(p.waveHeight).trim() !== '-')
                ? String(p.waveHeight).trim() : null,
            waveMax: wv == null ? -Infinity : wv,
            dir: wind ? wind.dir : null,
            windRange: wind ? wind.windRange : null,
            windMax: wind ? wind.windMax : -Infinity,
        };
        // 표시할 게 전혀 없으면 건너뛰기(파고도 풍속도 없음)
        if (cand.waveMax === -Infinity && !cand.windRange) continue;
        const prev = byDate[cand.date];
        if (!prev || isWorse(cand, prev)) byDate[cand.date] = cand;
    }
    let best = null;
    for (const k of Object.keys(byDate)) {
        const c = byDate[k];
        if (!best || isWorse(c, best)) best = c;
    }
    return best;
}

/** a 가 b 보다 나쁜가: 파고 max 큰 쪽, 동률이면 풍속 max 큰 쪽. */
function isWorse(a, b) {
    if (a.waveMax !== b.waveMax) return a.waveMax > b.waveMax;
    return a.windMax > b.windMax;
}

/**
 * 중기 해상예보(파고만) 최악 1건 산출. (forecast.js 의 parseMidTermSeaData 로직 포팅)
 *  midTerm = { tmFc:'YYYYMMDDHHmm'|number, data:{ [regId]: item } } (= /api/mid-term-sea-forecasts)
 *  regId = getMidTermRegId(zoneName)
 * 반환 { date:'YYYYMMDD', waveStr, waveMax } | null
 */
function worstMidTerm(zoneName, midTerm) {
    try {
        if (!midTerm || !midTerm.data) return null;
        const regId = midTermRegId(zoneName);
        if (!regId) return null;
        const item = midTerm.data[regId];
        if (!item) return null;
        const tmFcStr = String(midTerm.tmFc || '');
        if (tmFcStr.length < 8) return null;
        const baseY = parseInt(tmFcStr.substring(0, 4), 10);
        const baseM = parseInt(tmFcStr.substring(4, 6), 10) - 1;
        const baseD = parseInt(tmFcStr.substring(6, 8), 10);
        if (!Number.isFinite(baseY) || !Number.isFinite(baseM) || !Number.isFinite(baseD)) return null;

        let best = null; // { date, waveStr, waveMax }
        const consider = (d, whA, whB) => {
            const str = formatMidWave(whA, whB);
            const wv = waveMax(str);
            if (wv == null) return;
            const dt = new Date(baseY, baseM, baseD);
            dt.setDate(dt.getDate() + d);
            const dateStr = `${dt.getFullYear()}${pad2(dt.getMonth() + 1)}${pad2(dt.getDate())}`;
            const cand = { date: dateStr, waveStr: str, waveMax: wv };
            if (!best || cand.waveMax > best.waveMax) best = cand;
        };
        // 4~7일: am/pm 분리
        for (let d = 4; d <= 7; d++) {
            consider(d, item[`wh${d}AAm`], item[`wh${d}BAm`]);
            consider(d, item[`wh${d}APm`], item[`wh${d}BPm`]);
        }
        // 8~10일: 일 단위
        for (let d = 8; d <= 10; d++) {
            consider(d, item[`wh${d}A`], item[`wh${d}B`]);
        }
        return best;
    } catch (_) {
        return null;
    }
}

function pad2(n) { return String(n).padStart(2, '0'); }

/** 중기 파고 범위 포맷: A=최소, B=최대 → "0.5~1.0" | "1.0" | null. */
function formatMidWave(whA, whB) {
    const a = parseFloat(whA);
    const b = parseFloat(whB);
    const aOk = Number.isFinite(a);
    const bOk = Number.isFinite(b);
    if (!aOk && !bOk) return null;
    if (!aOk) return midNum(b);
    if (!bOk) return midNum(a);
    if (a === b) return midNum(a);
    return `${midNum(a)}~${midNum(b)}`;
}
function midNum(v) { return Number.isInteger(v) ? `${v}.0` : String(v); }

// 구역명 → 중기해상예보 regId (forecast.js 의 ZONE_NAME_TO_MID_TERM_REG_ID 포팅, 주요 권역).
const ZONE_NAME_TO_MID_TERM_REG_ID = {
    '서해북부앞바다': '12A10000', '서해북부먼바다': '12A10000',
    '인천·경기북부앞바다': '12A20000', '경기북부앞바다': '12A20000',
    '인천·경기남부앞바다': '12A20000', '충남북부앞바다': '12A20000',
    '충남남부앞바다': '12A20000', '서해중부앞바다': '12A20000',
    '서해중부먼바다': '12A20000', '서해중부안쪽먼바다': '12A20000',
    '서해중부바깥먼바다': '12A20000',
    '전북북부앞바다': '12A30000', '전북남부앞바다': '12A30000',
    '전남북부서해앞바다': '12A30000', '전남중부서해앞바다': '12A30000',
    '전남남부서해앞바다': '12A30000', '서해남부앞바다': '12A30000',
    '서해남부먼바다': '12A30000', '서해남부북쪽안쪽먼바다': '12A30000',
    '서해남부북쪽바깥먼바다': '12A30000', '서해남부남쪽안쪽먼바다': '12A30000',
    '서해남부남쪽바깥먼바다': '12A30000',
    '전남서부남해앞바다': '12B10000', '전남동부남해앞바다': '12B10000',
    '남해서부앞바다': '12B10000', '남해서부먼바다': '12B10000',
    '남해서부서쪽먼바다': '12B10000', '남해서부동쪽먼바다': '12B10000',
    '제주도서부앞바다': '12B10000', '제주도북부앞바다': '12B10000',
    '제주도동부앞바다': '12B10000', '제주도남부앞바다': '12B10000',
    '제주도앞바다': '12B10000', '제주도남쪽먼바다': '12B10000',
    '제주도남서쪽안쪽먼바다': '12B10000', '제주도남동쪽안쪽먼바다': '12B10000',
    '제주도남쪽바깥먼바다': '12B10000',
    '경남서부남해앞바다': '12B20000', '경남중부남해앞바다': '12B20000',
    '부산앞바다': '12B20000', '거제시동부앞바다': '12B20000',
    '남해동부앞바다': '12B20000', '남해동부먼바다': '12B20000',
    '남해동부안쪽먼바다': '12B20000', '남해동부바깥먼바다': '12B20000',
    '울산앞바다': '12C10000', '경북남부앞바다': '12C10000',
    '경북북부앞바다': '12C10000', '동해남부앞바다': '12C10000',
    '동해남부먼바다': '12C10000', '동해남부남쪽안쪽먼바다': '12C10000',
    '동해남부남쪽바깥먼바다': '12C10000', '동해남부북쪽안쪽먼바다': '12C10000',
    '동해남부북쪽바깥먼바다': '12C10000',
    '강원남부앞바다': '12C20000', '강원중부앞바다': '12C20000',
    '강원북부앞바다': '12C20000', '동해중부앞바다': '12C20000',
    '동해중부먼바다': '12C20000', '동해중부안쪽먼바다': '12C20000',
    '동해중부바깥먼바다': '12C20000',
    '동해북부앞바다': '12C30000', '동해북부먼바다': '12C30000',
};
function midTermRegId(zoneName) {
    return ZONE_NAME_TO_MID_TERM_REG_ID[zoneName] || null;
}

// ── 기본 데이터 접근자(런타임). 데이터 파일/캐시 미존재 시 빈 결과로 흡수. ──
function _defaultLoadCoastal() {
    try { return require('../regional_forecast_collector.js').loadCoastalForecasts() || {}; }
    catch (_) { return {}; }
}
function _defaultLoadMarine() {
    try { return require('../regional_forecast_collector.js').loadMarineForecasts() || {}; }
    catch (_) { return {}; }
}
function _defaultMidTerm() {
    try {
        const dc = require('./cache_manager.js').dataCache;
        return (dc && dc.midTermSeaForecasts) || null;
    } catch (_) { return null; }
}

/**
 * 구역명 → "예측 기상(최악)" { day, summary } | null.
 * @param zoneName 특보 구역명
 * @param deps {loadCoastal, loadMarine, midTerm} 테스트 주입용(생략 시 런타임 데이터)
 *   - loadCoastal/loadMarine: () => { [zoneName]: { periods:[...] } }
 *   - midTerm: { tmFc, data } | null  (또는 함수 () => 그 객체)
 */
function worstForZone(zoneName, deps) {
    try {
        if (!zoneName || typeof zoneName !== 'string') return null;
        const d = deps || {};
        const isMarine = zoneName.indexOf('먼바다') >= 0;
        const loader = isMarine
            ? (d.loadMarine || _defaultLoadMarine)
            : (d.loadCoastal || _defaultLoadCoastal);

        let zoneEntry = null;
        try {
            const all = (typeof loader === 'function') ? loader() : loader;
            zoneEntry = all && all[zoneName];
        } catch (_) { zoneEntry = null; }

        const periods = zoneEntry && Array.isArray(zoneEntry.periods) ? zoneEntry.periods : null;
        const shortWorst = worstShortTerm(periods);

        // 중기(파고만): 단기보다 엄격히 더 클 때만 사용
        let midRaw = (d.midTerm !== undefined) ? d.midTerm : _defaultMidTerm();
        if (typeof midRaw === 'function') {
            try { midRaw = midRaw(); } catch (_) { midRaw = null; }
        }
        const midWorst = worstMidTerm(zoneName, midRaw);

        const shortWave = shortWorst ? shortWorst.waveMax : -Infinity;
        const useMid = midWorst && midWorst.waveMax > (shortWave === -Infinity ? -Infinity : shortWave)
            && (!shortWorst || midWorst.waveMax > shortWave);

        if (useMid && midWorst) {
            const day = dayOfDate(midWorst.date);
            const wavePart = midWorst.waveStr ? `파고 ${midWorst.waveStr}m` : null;
            if (!wavePart) return null;
            return { day, summary: wavePart };
        }

        if (!shortWorst) return null;
        const day = dayOfDate(shortWorst.date);
        const parts = [];
        if (shortWorst.dir && shortWorst.windRange) {
            parts.push(`${shortWorst.dir}풍 ${shortWorst.windRange}m/s`);
        }
        if (shortWorst.waveStr) {
            parts.push(`파고 ${shortWorst.waveStr}m`);
        }
        if (!parts.length) return null;
        return { day, summary: parts.join(', ') };
    } catch (_) {
        return null;
    }
}

module.exports = {
    worstForZone,
    // 테스트/재사용용 내부 헬퍼 노출
    _internals: {
        waveMax, parseWind, dayOfDate, worstShortTerm, worstMidTerm,
        formatMidWave, midTermRegId, isWorse,
    },
};
