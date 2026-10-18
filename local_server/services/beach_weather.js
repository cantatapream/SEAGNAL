/**
 * ============================================================================
 * 파일명: local_server/services/beach_weather.js
 * 역할  : 연안 관광지마다 3km 안 가장 가까운 기상청 해수욕장의 날씨·수온으로 「물에 들어가는 사람이 있을 수 있다」는
 *         참고 안내 줄과, 해수부 개장 일정 줄을 만든다(연안 시트·연안 안전 브리핑 연안 카드). 위험 점수·단계에는 넣지 않는다.
 * ----------------------------------------------------------------------------
 * [사용자 결정 2026-10-18 원문 — 설계서 coastal_safety_forecast.design.md §18]
 *   *"기상청 해수욕장 데이터와 기상을 고려해서 입수가 괜찮은지 … 입수한 사람이 있을 수 있다는 알림 문구"* ·
 *   *"개장 일정 폐장 일정 관련해서는 해수부를 기준으로만 … 해수부 기준에 없는 것은 별도로 표시할 필요는 없을 것 같아"* ·
 *   *"나머지는 개장 정보 없음으로 표시하지 말고 … 개장 정보가 있다 없다를 이야기하지 말고"* · 문구 *"네가 맞춰놓은 문구로"* ·
 *   *"개장 예정은 5일 전부터 표시하면 될 것 같고, 내일 판단도 오늘 수온값을 쓴다고 하면 그렇게 해야 될 것 같아.
 *    수온 관측 없는 해수욕장이 있다면 소해구 예보 수온으로 대신해도 돼. 필요한 것만 남기는 방식으로 설계해."*
 * [판단] 그날(오늘·내일 각각) 낮 09~18시 칸 — 파고·풍속은 그중 최댓값, 비는 한 칸이라도 있으면, 낮 최고 = 기상청 TMX(없으면 그 칸 기온 최댓값).
 *        수온 = 해수욕장 부이 관측(12시간 안) → 없으면 소해구 예보 수온(그날 낮 최솟값) → 없으면 줄 없음. 내일도 오늘 수온을 쓴다.
 *        비교는 화면에 쓰는 숫자(수온·기온·풍속 정수, 파고 소수 한 자리)로 한다 — 문장과 판정이 어긋나지 않게.
 * [연계]
 *  - 사용하는 파일 : config/coastal_safety/beach_weather_static.json(해수욕장·관광지 연결·해수부 개장 — build_beach_weather_static.py)
 *                    · services/beach_weather_collector.js(forecast·waterTemp·issueAt) · services/smallzone_forecast.js(twNear)
 *  - 나를 쓰는 곳  : routes/risk_forecast.js GET /api/risk-forecast/coast/spot(beach 줄) · routes/station_briefing.js GET /api/station-briefing(beach 표)
 *                    · 시험 local_server/scripts/test_beach_weather.js
 *  - 브리핑 AI 입력(station_briefing_ai.js)에는 넣지 않는다(설계서 §18 — 이번 결정).
 * [로드 순서] require 부작용 없음. 정적 표는 처음 쓸 때 한 번 읽는다.
 * ============================================================================
 */
'use strict';
const fs = require('fs'), path = require('path');
const C = require('./beach_weather_collector');

const DAY_FROM = 9, DAY_TO = 18;               // 낮 판단 칸(KST, 끝 포함)
const STALE_ISSUES_MS = 6 * 3600000;           // 기대 발표보다 6시간 넘게 옛 판(= 2 발표 넘게 못 받음)이면 쓰지 않는다
const TW_MAX_AGE_MS = 12 * 3600000;            // 부이 수온 관측이 이보다 오래되면 소해구 예보로 넘어간다
const RAIN_POP = 60;                           // 강수확률 이 이상인 칸도 「비」로 본다(보수적 기본값 — 설계서 §18)
const OPEN_SOON_DAYS = 5;                      // 사용자 확정 *"개장 예정은 5일 전부터 표시하면 될 것 같고"*
const GOOD = { tw: 20, tmax: 25, wav: 1, wsd: 7 }, MAYBE = { tw: 18, tmax: 23 };

/** 한글 받침이 있으면 a, 없으면 b. 예: josa('협재해수욕장','이','가') → '협재해수욕장이' · josa('멍비치','이','가') → '멍비치가' */
function josa(word, a, b) {
    const c = String(word).charCodeAt(String(word).length - 1);
    return word + (c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 === 0 ? b : a);
}
/** 파고 글. 예: 0.5 → '0.5m' · 1 → '1m' · 1.84 → '1.8m' */
function mText(v) { return String(Math.round(v * 10) / 10) + 'm'; }
/** 'YYYY-MM-DD' → 'M.D'. 예: '2026-07-10' → '7.10' */
function md(d) { return +d.slice(5, 7) + '.' + +d.slice(8, 10); }
/** 'YYYY-MM-DD' → 'M월 D일'. 예: '2026-07-10' → '7월 10일' */
function mdKo(d) { return +d.slice(5, 7) + '월 ' + +d.slice(8, 10) + '일'; }
/** 날짜 차(일). 예: dayDiff('2026-07-10','2026-07-05') → 5 */
function dayDiff(a, b) { return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000); }

/**
 * 그날 낮 날씨를 접는다. 예보 창(d0~d0+1)에 그날이 없거나, 판이 낡았거나, 항목이 하나라도 없으면 null.
 * 예: dayWeather(f, '2026-10-18', now) → { tmax:27, wav:0.5, wsd:4, rain:false }
 * @param {object|null} f - collector.forecast(n) @param {string} date @param {number} now @returns {object|null}
 * [연계] ← lines / 시험 「오래된 값 숨김」·「낮 최댓값」
 */
function dayWeather(f, date, now) {
    if (!f || !f.base) return null;
    const baseMs = C.kstMs(f.base.slice(0, 8), f.base.slice(8, 12));
    if (!Number.isFinite(baseMs) || C.issueAt(now) - baseMs > STALE_ISSUES_MS) return null;
    const d = dayDiff(date, f.d0);
    if (d !== 0 && d !== 1) return null;
    let wav = null, wsd = null, tmp = null, ptySeen = false, rain = false;
    for (let h = DAY_FROM; h <= DAY_TO; h++) {
        const i = d * 24 + h, w = f.at(i, 'WAV'), s = f.at(i, 'WSD'), t = f.at(i, 'TMP'), p = f.at(i, 'PTY'), pop = f.at(i, 'POP');
        if (w !== null) wav = wav === null ? w : Math.max(wav, w);
        if (s !== null) wsd = wsd === null ? s : Math.max(wsd, s);
        if (t !== null) tmp = tmp === null ? t : Math.max(tmp, t);
        if (p !== null) { ptySeen = true; if (p > 0) rain = true; }
        if (pop !== null && pop >= RAIN_POP) rain = true;
    }
    const tmax = Number.isFinite(f.tmx[d]) ? f.tmx[d] : tmp;
    if (wav === null || wsd === null || tmax === null || !ptySeen) return null;
    return { tmax, wav, wsd, rain };
}

/**
 * 입수 판단. 화면 숫자로 반올림한 값으로 비교한다.
 * 좋음 = 수온 20↑·낮 최고 25↑·비 없음·파고 1m↓·풍속 7m/s↓ / 거친 날 = 수온·기온은 좋음 기준 이상인데 파고 1m 초과·풍속 7m/s 초과·비 중 하나↑ /
 * 있을 수 있음 = 수온 18↑·낮 최고 23↑ 이고 위 둘이 아님 / 그 밖 null.
 * 예: decide({tw:22,tmax:27,wav:0.5,wsd:4,rain:false}) → {kind:'good',…} · ({tw:22,tmax:27,wav:1.8,…}) → {kind:'rough', bad:['wave']}
 * @param {object} x - {tw,tmax,wav,wsd,rain} @returns {object|null} {kind, tw, tmax, wav, wsd, bad} [연계] ← lines / 시험 「경계값」
 */
function decide(x) {
    if (!x) return null;
    const tw = Math.round(x.tw), tmax = Math.round(x.tmax), wav = Math.round(x.wav * 10) / 10, wsd = Math.round(x.wsd);
    const warm = tw >= GOOD.tw && tmax >= GOOD.tmax;
    const bad = [];
    if (wav > GOOD.wav) bad.push('wave');
    if (wsd > GOOD.wsd) bad.push('wind');
    if (x.rain) bad.push('rain');
    const r = { tw, tmax, wav, wsd, bad };
    if (warm && !bad.length) return { kind: 'good', ...r };
    if (warm) return { kind: 'rough', ...r };
    if (tw >= MAYBE.tw && tmax >= MAYBE.tmax) return { kind: 'maybe', ...r };
    return null;
}

/**
 * 판단 결과를 확정 문구로 쓴다(사용자 확정 — 이 글자 그대로, 숫자만 바뀜). 거친 날의 나쁜 항목이 여럿이면 앞 항목은 「-고」로 잇는다
 *   (「파도가 1.8m로 높고 바람이 초속 9m로 강해」·「바람이 초속 9m로 강하고 비가 예보되어」). 순서 = 파도 → 바람 → 비.
 * 예: swimText('협재해수욕장(1.2km)', {kind:'good',tw:22,tmax:27,wav:0.5}) → '협재해수욕장(1.2km) — 수온 22℃ · 낮 최고 27℃ · 파도 0.5m로 바닷물에 들어가 물놀이하기 좋은 날씨입니다. 물에 들어가는 사람이 많을 수 있습니다.'
 * @param {string} label - 「이름(거리)」 @param {object} r - decide 결과 @returns {string} [연계] ← lines / 시험 「문구」
 */
function swimText(label, r) {
    if (r.kind === 'good') return `${label} — 수온 ${r.tw}℃ · 낮 최고 ${r.tmax}℃ · 파도 ${mText(r.wav)}로 바닷물에 들어가 물놀이하기 좋은 날씨입니다. 물에 들어가는 사람이 많을 수 있습니다.`;
    if (r.kind === 'maybe') return `${label} — 수온 ${r.tw}℃ · 낮 최고 ${r.tmax}℃로 물놀이하기에 아주 좋은 날씨는 아니지만, 바닷물에 들어가는 사람이 있을 수 있습니다.`;
    const part = { wave: [`파도가 ${mText(r.wav)}로 높고`, `파도가 ${mText(r.wav)}로 높아`], wind: [`바람이 초속 ${r.wsd}m로 강하고`, `바람이 초속 ${r.wsd}m로 강해`], rain: ['비가 예보되고', '비가 예보되어'] };
    const why = r.bad.map((k, i) => part[k][i === r.bad.length - 1 ? 1 : 0]).join(' ');
    return `${label} — 수온 ${r.tw}℃로 따뜻하지만 ${why} 물에 들어가기에 적절하지 않습니다. 그래도 물에 들어가는 사람이 있을 수 있습니다.`;
}

/**
 * 해수부 개장 일정 줄(해수부 지정·기상청과 연결된 곳만 — 그 밖은 아무 말 없음). D = 보는 날짜, T = 오늘.
 *   D < 개장: 개장 5일 전부터 「…이 7월 10일 개장 예정이라 개장 후 사람이 많이 몰릴 수 있습니다.」
 *   D = 개장: 오늘이면 「…이 오늘 개장해 사람이 많이 몰릴 수 있습니다.」, 내일 보기면 예정 글(오늘 기준으로는 아직 예정)
 *   개장 < D ≤ 폐장: 「…이 개장 기간(7.10~8.23)이라 사람이 많이 몰릴 수 있습니다.」 · 폐장 뒤: null
 * 예: openText('협재해수욕장', {open:'2026-07-10',close:'2026-08-23'}, '2026-07-05', '2026-07-05') → 예정 글 · ('…','2026-07-04',…) → null
 * @param {string} name @param {object|null} o - {open, close} @param {string} date - D @param {string} today - T @returns {string|null}
 * [연계] ← lines / 시험 「개장 날짜 경계」
 */
function openText(name, o, date, today) {
    if (!o || !o.open || !o.close) return null;
    const subj = josa(name, '이', '가');
    if (date < o.open) return dayDiff(o.open, date) <= OPEN_SOON_DAYS ? `${subj} ${mdKo(o.open)} 개장 예정이라 개장 후 사람이 많이 몰릴 수 있습니다.` : null;
    if (date === o.open) return date === today ? `${subj} 오늘 개장해 사람이 많이 몰릴 수 있습니다.` : `${subj} ${mdKo(o.open)} 개장 예정이라 개장 후 사람이 많이 몰릴 수 있습니다.`;
    if (date <= o.close) return `${subj} 개장 기간(${md(o.open)}~${md(o.close)})이라 사람이 많이 몰릴 수 있습니다.`;
    return null;
}

/**
 * 서비스를 만든다(시험은 표·수집기·소해구·시계를 바꿔 넣는다).
 * @param {object} [o] - table(정적 표 객체) · collector(forecast·waterTemp) · smallTw(lat,lon,date,now)→{tw}|null · clock
 * @returns {{linesFor:function, linesForSpots:function, waterTemp:function}}
 * [연계] ← forDefault(라우트) / 시험
 */
function createBeachWeather(o = {}) {
    const clock = o.clock || Date.now;
    const collector = o.collector || C.forDefault();
    const smallTw = o.smallTw || ((lat, lon, date, now) => require('./smallzone_forecast').twNear(lat, lon, date, now));
    let table = o.table || null, byNum = null;
    function T() {
        if (!table) table = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'coastal_safety', 'beach_weather_static.json'), 'utf8'));
        if (!byNum) byNum = new Map(table.beaches.map((b) => [b.n, b]));
        return table;
    }
    /**
     * 그 해수욕장의 오늘 수온. 순서: 부이 관측(12시간 안) → 소해구 예보 수온(오늘 낮 최솟값, 20km 안) → null.
     * 예: waterTemp(b, now) → { tw:21.4, from:'buoy' } · { tw:20.8, from:'smallzone', zone:'233-5' } · null
     * @param {object} b - 정적 표 해수욕장 @param {number} now @returns {object|null} [연계] ← linesFor
     */
    function waterTemp(b, now) {
        const x = collector.waterTemp(b.n);
        if (x && /^\d{12}$/.test(x.tm)) {
            const at = C.kstMs(x.tm.slice(0, 8), x.tm.slice(8, 12));
            if (now - at <= TW_MAX_AGE_MS && at <= now + 10 * 60000) return { tw: x.tw, from: 'buoy', tm: x.tm };
        }
        let s = null;
        try { s = smallTw(b.lat, b.lon, C.kstParts(now).date, now); } catch (_) { s = null; }
        return s && Number.isFinite(s.tw) ? { tw: s.tw, from: 'smallzone', zone: s.zone } : null;
    }
    /**
     * 관광지 하나·날짜 하나의 안내 줄(개장 줄 → 입수 줄). 연결 해수욕장이 없거나 오늘·내일이 아니면 빈 배열.
     * 예: linesFor('64110|협재해수욕장', '2026-07-12') → ['협재해수욕장이 개장 기간(7.10~8.23)이라 …', '협재해수욕장 — 수온 22℃ · …']
     * @param {string} spotId @param {string} date - KST YYYY-MM-DD @returns {string[]} [연계] ← linesForSpots·라우트
     */
    function linesFor(spotId, date) {
        const t = T(), link = t.links[spotId], now = clock(), today = C.kstParts(now).date;
        if (!link || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return [];
        const d = dayDiff(date, today);
        if (d !== 0 && d !== 1) return [];
        const b = byNum.get(link.n);
        if (!b) return [];
        const out = [], op = openText(b.name, t.open[String(b.n)], date, today);
        if (op) out.push(op);
        const wx = dayWeather(collector.forecast(b.n), date, now), tw = wx ? waterTemp(b, now) : null;
        const r = wx && tw ? decide({ ...wx, tw: tw.tw }) : null;
        if (r) out.push(swimText(link.self ? b.name : `${b.name}(${Math.max(0.1, Math.round(link.m / 100) / 10).toFixed(1)}km)`, r));
        return out;
    }
    /** 여러 관광지 한 번에(브리핑 연안 카드). 예: linesForSpots(['a','b'], '2026-10-18') → { a:[…] } (빈 줄 관광지는 뺌). @returns {object} */
    function linesForSpots(ids, date) {
        const out = {};
        for (const id of new Set(ids || [])) { const l = linesFor(id, date); if (l.length) out[id] = l; }
        return out;
    }
    return { linesFor, linesForSpots, waterTemp: (n, now = clock()) => { T(); const b = byNum.get(+n); return b ? waterTemp(b, now) : null; } };
}

let def = null;
/** 운영 기본(정적 표·기본 수집기·소해구 저장 판). [연계] ← routes/risk_forecast.js·routes/station_briefing.js */
function forDefault() { return def || (def = createBeachWeather()); }

module.exports = { createBeachWeather, forDefault, dayWeather, decide, swimText, openText, josa,
    DAY_FROM, DAY_TO, STALE_ISSUES_MS, TW_MAX_AGE_MS, RAIN_POP, OPEN_SOON_DAYS, GOOD, MAYBE };
