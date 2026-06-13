/**
 * ============================================================================
 * advisory/crossReference.js — 특보 예측 ↔ 기상청 단기 해상예보 교차참조
 * ============================================================================
 *
 * 우리 자체 예측(predictionEngine 산출)에, 같은 해역·같은 시간대의 기상청
 * "공식 단기 해상예보"(먼바다/앞바다 PDF 파싱값) 숫자를 그대로 병기한다.
 *
 *   ※ 판정(일치/불일치) 없음. 풍속·파고 숫자만 옆에 보여주고, 사용자가
 *     우리 예측과 직접 눈으로 비교하게 한다. 매칭 실패(해역·시간대 예보 없음)
 *     시에는 아무 것도 붙이지 않아, 프론트가 그 줄을 통째로 숨긴다.
 *
 * [데이터 출처]
 *   regional_forecast_collector.loadMarineForecasts()  → 먼바다 { zoneName: {periods} }
 *   regional_forecast_collector.loadCoastalForecasts() → 앞바다 { zoneName: {periods} }
 *   각 period: { date:'YYYYMMDD'(KST), period:'am'|'pm', wind:'북동~동 / 7~11',
 *               weather, waveHeight:'0.5~1.0' }
 *
 * [시간 매칭]
 *   예측 onsetISO(실제 UTC) → KST 벽시계로 변환 → date(YYYYMMDD)+오전/오후 슬롯.
 *   같은 zone 의 같은 슬롯 period 를 찾아 풍속/파고를 뽑는다.
 *   (오전=KST 00~12시, 오후=12~24시. 엔진 onsetLabel 의 시간대 구분과 일치.)
 *
 * [설계 원칙]
 *   - 순수 매칭 로직(IO 무관)과 디스크 로더를 분리 → 네트워크 0 으로 테스트 가능.
 *   - 어떤 입력에도 throw 하지 않고 graceful(매칭 실패 → 원본 그대로) 동작.
 *   - 원본 prediction 을 변형(mutate)하지 않음. 매칭 시에만 얕은 복사로 kmaForecast 부착.
 *
 * [부착 필드] prediction.kmaForecast = {
 *     windSpeed: '7~11' | null,     // m/s 범위 문자열(방향 제외)
 *     waveHeight: '0.5~1.0' | null, // m 범위/단일 문자열
 *     periodLabel: '6/13(토) 오후',  // 매칭된 기상청 예보 시간대
 *     publishTime: '...' | null,    // 기상청 발표시각(있으면)
 *   }
 *   windSpeed·waveHeight 가 둘 다 비면 부착하지 않는다(표출할 숫자가 없음).
 * ============================================================================
 */
'use strict';

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
const MS_TO_KT = 1 / 0.514444;

// 구역 → 발표청명(과거 통보문 발표청 컬럼으로 검증, 2023~2026 풍랑 이력 24구역).
//   여기 없는 구역(풍랑 이력 희소)은 발표청명 생략(null).
const ZONE_OFFICE_NAME = {
    '제주도남쪽바깥먼바다': '제주지방기상청', '제주도남동쪽안쪽먼바다': '제주지방기상청',
    '제주도남서쪽안쪽먼바다': '제주지방기상청', '제주도남부앞바다': '제주지방기상청',
    '제주도동부앞바다': '제주지방기상청', '남해서부서쪽먼바다': '제주지방기상청',
    '남해동부안쪽먼바다': '부산지방기상청', '남해동부바깥먼바다': '부산지방기상청',
    '동해남부남쪽안쪽먼바다': '부산지방기상청', '동해남부남쪽바깥먼바다': '부산지방기상청',
    '경남서부남해앞바다': '부산지방기상청', '경남중부남해앞바다': '부산지방기상청',
    '서해남부남쪽안쪽먼바다': '광주지방기상청', '서해남부남쪽바깥먼바다': '광주지방기상청',
    '서해남부북쪽안쪽먼바다': '광주지방기상청', '서해남부북쪽바깥먼바다': '광주지방기상청',
    '남해서부동쪽먼바다': '광주지방기상청', '전남중부서해앞바다': '광주지방기상청',
    '동해중부안쪽먼바다': '강원지방기상청', '동해중부바깥먼바다': '강원지방기상청',
    '동해남부북쪽안쪽먼바다': '대구지방기상청', '동해남부북쪽바깥먼바다': '대구지방기상청',
    '서해중부안쪽먼바다': '수도권기상청', '서해중부바깥먼바다': '수도권기상청',
};

/** "13~17"(m/s) → "25~33kt(13~17m/s)". 단일값 "12" → "23kt(12m/s)". 실패 시 원본 m/s. */
function windToKtMs(msStr) {
    if (msStr == null) return null;
    const s = String(msStr).trim();
    const m = s.match(/^(\d+(?:\.\d+)?)(?:\s*~\s*(\d+(?:\.\d+)?))?$/);
    if (!m) return s ? s + 'm/s' : null;
    const lo = Math.round(parseFloat(m[1]) * MS_TO_KT);
    if (m[2] != null) {
        const hi = Math.round(parseFloat(m[2]) * MS_TO_KT);
        return `${lo}~${hi}kt(${m[1]}~${m[2]}m/s)`;
    }
    return `${lo}kt(${m[1]}m/s)`;
}

/** 발표시각 문자열 → "06월 10일 17:00 발표". 알 수 없는 형식이면 원문, 빈값이면 null. */
function formatPublish(s) {
    if (s == null) return null;
    const str = String(s).trim();
    if (!str) return null;
    const m = str.match(/(\d{4})\D?(\d{2})\D?(\d{2})\D?(\d{2})\D?(\d{2})/);
    if (m) return `${m[2]}월 ${m[3]}일 ${m[4]}:${m[5]} 발표`;
    return str;
}

/** zone 키 정규화 (trim). null/undefined 안전. */
function zoneKey(z) {
    return z == null ? '' : String(z).trim();
}

/**
 * onsetISO(실제 UTC ISO) → 기상청 예보 슬롯 { date:'YYYYMMDD', period:'am'|'pm' } (KST).
 *   KST 벽시계 = UTC + 9h. getUTC* 로 KST 필드를 읽는다(서버 TZ 비의존).
 * @param {string} onsetISO
 * @returns {{date:string, period:'am'|'pm', mo:number, da:number, wd:string}|null}
 */
function onsetToSlot(onsetISO) {
    if (!onsetISO) return null;
    const ms = Date.parse(onsetISO);
    if (!isFinite(ms)) return null;
    const d = new Date(ms + 9 * 3600 * 1000); // KST 벽시계
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth() + 1;
    const da = d.getUTCDate();
    const h = d.getUTCHours();
    const pad = (n) => String(n).padStart(2, '0');
    return {
        date: `${y}${pad(mo)}${pad(da)}`,
        period: h < 12 ? 'am' : 'pm',
        mo, da, wd: WEEKDAY[d.getUTCDay()],
    };
}

/**
 * 기상청 wind 문자열에서 풍속 범위만 추출.
 *   "북동~동 / 7~11" → "7~11",  "7~11" → "7~11",  "-"/빈값 → null.
 * @param {string} windStr
 * @returns {string|null}
 */
function parseWindSpeed(windStr) {
    if (windStr == null) return null;
    const s = String(windStr).trim();
    if (!s || s === '-') return null;
    // "방향 / 속도" 형태면 마지막 '/' 뒤를 속도로 본다.
    const slash = s.lastIndexOf('/');
    const tail = slash >= 0 ? s.slice(slash + 1) : s;
    const m = tail.match(/(\d+(?:\.\d+)?\s*~\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?)/);
    if (!m) return null;
    return m[1].replace(/\s+/g, '');
}

/**
 * 기상청 waveHeight 문자열 정규화. "0.5~1.0"/"0.5" 그대로, "-"/빈값 → null.
 * @param {string} waveStr
 * @returns {string|null}
 */
function parseWaveHeight(waveStr) {
    if (waveStr == null) return null;
    const s = String(waveStr).trim();
    if (!s || s === '-') return null;
    const m = s.match(/(\d+(?:\.\d+)?\s*~\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?)/);
    if (!m) return null;
    return m[1].replace(/\s+/g, '');
}

/**
 * 한 해역의 기상청 예보(periods)에서 onset 슬롯에 해당하는 풍속/파고를 뽑는다.
 * @param {{periods?:Array, publishTime?:string}} zoneForecast
 * @param {string} onsetISO
 * @returns {{windSpeed:string|null, waveHeight:string|null, periodLabel:string,
 *            publishTime:string|null}|null}  매칭/표출값 없으면 null.
 */
function buildKmaForecast(zoneForecast, onsetISO, zoneName) {
    if (!zoneForecast || typeof zoneForecast !== 'object') return null;
    const periods = Array.isArray(zoneForecast.periods) ? zoneForecast.periods : [];
    if (periods.length === 0) return null;

    const slot = onsetToSlot(onsetISO);
    if (!slot) return null;

    const hit = periods.find((p) =>
        p && String(p.date) === slot.date && p.period === slot.period);
    if (!hit) return null;

    const windSpeed = parseWindSpeed(hit.wind);
    const waveHeight = parseWaveHeight(hit.waveHeight);
    if (windSpeed == null && waveHeight == null) return null; // 표출할 숫자 없음

    const band = slot.period === 'am' ? '오전' : '오후';
    const publishTime = zoneForecast.publishTime != null ? zoneForecast.publishTime : null;
    return {
        windSpeed,                          // 원본 m/s 범위(하위호환)
        windKtMs: windToKtMs(windSpeed),    // "25~33kt(13~17m/s)" 병기
        waveHeight,
        periodLabel: `${slot.mo}/${slot.da}(${slot.wd}) ${band}`,
        office: zoneName ? (ZONE_OFFICE_NAME[String(zoneName).trim()] || null) : null,
        publishTime,
        publishLabel: formatPublish(publishTime),
    };
}

/**
 * predictions 배열에 교차참조(kmaForecast)를 부착한 새 배열을 반환.
 *   - 매칭/표출값 없는 항목은 원본 객체 참조를 그대로 둔다(불필요한 복사 회피).
 *   - 입력을 변형하지 않는다.
 * @param {Array} predictions
 * @param {Object} forecastMap  { zoneName: {periods, publishTime, ...} }
 * @returns {Array}
 */
function enrichPredictions(predictions, bulletinMap) {
    if (!Array.isArray(predictions)) return predictions;
    // 단일 출처: 날씨누리 list.do [해설] 단기전망 통보문(zone→{sentence,wind,wave,publishTime}).
    //   풍속/파고 숫자·문장·발표시각 모두 통보문에서 온다. (PDF 단기예보 병기는 폐지)
    const bmap = (bulletinMap && typeof bulletinMap === 'object') ? bulletinMap : {};
    return predictions.map((p) => {
        if (!p || typeof p !== 'object') return p;
        const key = zoneKey(p.zone);
        const b = bmap[key];
        if (!b) return p;
        const windKtMs = windToKtMs(b.wind);          // "9~14" → "17~27kt(9~14m/s)"
        const waveHeight = parseWaveHeight(b.wave);   // "1.5~3.0" 그대로
        const outlook = (typeof b.sentence === 'string' && b.sentence.trim()) ? b.sentence.trim() : null;
        if (!windKtMs && !waveHeight && !outlook) return p; // 표출할 게 없음
        const kma = {
            windSpeed: b.wind || null,
            windKtMs,
            waveHeight,
            periodLabel: null,                        // 통보문은 시간대 슬롯이 없음(해역당 1건)
            office: ZONE_OFFICE_NAME[key] || null,
            publishTime: b.publishTime || null,
            publishLabel: formatPublish(b.publishTime),
            outlook,
        };
        return Object.assign({}, p, { kmaForecast: kma });
    });
}

/**
 * 디스크에서 기상청 단기 해상예보(먼바다+앞바다)를 합쳐 zone→예보 맵을 만든다.
 *   regional_forecast_collector 가 없거나 실패하면 빈 객체({})를 반환(graceful).
 * @returns {Object} { zoneName: {periods, publishTime, ...} }
 */
function loadForecastMap() {
    try {
        const collector = require('../regional_forecast_collector');
        const marine = (typeof collector.loadMarineForecasts === 'function')
            ? collector.loadMarineForecasts() : {};
        const coastal = (typeof collector.loadCoastalForecasts === 'function')
            ? collector.loadCoastalForecasts() : {};
        // 먼바다·앞바다 키는 서로 겹치지 않음. 합치되 먼바다 우선.
        return Object.assign({}, coastal || {}, marine || {});
    } catch (_) {
        return {};
    }
}

/**
 * 구역 → 단기전망 문장 맵 로드 (regional_forecast.json 의 marineOutlooks —
 * 통보문 AI 추출). 묶음 구역명(예: 제주도전해상)은 ZONE_GROUP_MAP 으로 자식
 * 구역에 펼치되, 정확일치 문장이 이미 있으면 덮어쓰지 않는다. 실패 시 {}.
 * @returns {Object} { zoneName: sentence }
 */
function loadOutlookMap() {
    const out = {};
    try {
        const fs = require('fs');
        const path = require('path');
        const file = path.join(__dirname, '..', 'data', 'regional_forecast.json');
        const store = JSON.parse(fs.readFileSync(file, 'utf8'));
        let GROUP = {};
        try { GROUP = require('../ai_report_parser').ZONE_GROUP_MAP || {}; } catch (_) { GROUP = {}; }
        const exact = {}, expanded = {};
        for (const entry of Object.values(store)) {
            if (!entry || !Array.isArray(entry.marineOutlooks)) continue;
            for (const o of entry.marineOutlooks) {
                if (!o || typeof o.zone !== 'string' || typeof o.sentence !== 'string') continue;
                const z = o.zone.trim(), st = o.sentence.trim();
                if (!z || !st) continue;
                exact[z] = st;
                const members = GROUP[z];
                if (Array.isArray(members)) for (const m of members) {
                    if (typeof m === 'string' && m.trim()) expanded[m.trim()] = st;
                }
            }
        }
        Object.assign(out, expanded, exact); // 정확일치 우선
    } catch (_) { /* graceful */ }
    return out;
}

/**
 * 구역 → 통보문 전망 레코드 맵. regional_forecast.json 의 marineOutlooks
 * (통보문 [해설] 단기전망 AI 추출: zone/sentence/wind/wave) + entry.bulletinPublishTime.
 *   { zoneName: { sentence, wind, wave, publishTime } }
 *   묶음 구역명은 ZONE_GROUP_MAP 으로 자식에 펼치되 정확일치 우선. 실패 시 {}.
 * @returns {Object}
 */
function loadBulletinMap() {
    const out = {};
    try {
        const fs = require('fs');
        const path = require('path');
        const file = path.join(__dirname, '..', 'data', 'regional_forecast.json');
        const store = JSON.parse(fs.readFileSync(file, 'utf8'));
        let GROUP = {};
        try { GROUP = require('../ai_report_parser').ZONE_GROUP_MAP || {}; } catch (_) { GROUP = {}; }
        const exact = {}, expanded = {};
        for (const entry of Object.values(store)) {
            if (!entry || !Array.isArray(entry.marineOutlooks)) continue;
            const pub = entry.bulletinPublishTime || null;
            for (const o of entry.marineOutlooks) {
                if (!o || typeof o.zone !== 'string') continue;
                const z = o.zone.trim();
                if (!z) continue;
                const rec = {
                    sentence: (typeof o.sentence === 'string' && o.sentence.trim()) ? o.sentence.trim() : null,
                    wind: (typeof o.wind === 'string' && o.wind.trim()) ? o.wind.trim() : null,
                    wave: (typeof o.wave === 'string' && o.wave.trim()) ? o.wave.trim() : null,
                    publishTime: pub,
                };
                if (!rec.sentence && !rec.wind && !rec.wave) continue;
                exact[z] = rec;
                const members = GROUP[z];
                if (Array.isArray(members)) for (const m of members) {
                    if (typeof m === 'string' && m.trim()) expanded[m.trim()] = rec;
                }
            }
        }
        Object.assign(out, expanded, exact); // 정확일치 우선
    } catch (_) { /* graceful */ }
    return out;
}

module.exports = {
    onsetToSlot,
    parseWindSpeed,
    parseWaveHeight,
    windToKtMs,
    formatPublish,
    buildKmaForecast,
    enrichPredictions,
    loadForecastMap,
    loadOutlookMap,
    loadBulletinMap,
    ZONE_OFFICE_NAME,
};
