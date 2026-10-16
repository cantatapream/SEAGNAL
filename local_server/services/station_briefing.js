/**
 * ============================================================================
 * 파일명: local_server/services/station_briefing.js
 * 역할  : 「활동지점 안전 브리핑」 생성·저장·일정·설정을 맡는다. 정해진 시각(08:00·17:30·23:00 KST)과 특보가 바뀔 때(그 특보구역에 걸친 관할만)
 *         관할 입력을 모아(station_briefing_inputs) 규칙으로 판단하고(station_briefing_rules) 총평만 AI 로 쓴 뒤(station_briefing_ai) 날짜별 파일에 저장한다.
 *         관리자 설정(생성 방식·모델·노출 범위·묶음 단위·바뀐 곳만)과 노출 판정(관리자 기기에만 등)도 여기서 정한다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/station_briefing_rules.js · station_briefing_ai.js · station_briefing_inputs.js
 *                    · routes/risk_forecast.js(stores — 위험예측 화면과 같은 risk_store·marine_fusion 저장소를 함께 쓴다, 메모리 중복 방지)
 *                    · services/codex_bridge.js(VM) · services/gemini_client.js(Gemini) — 실제 어댑터는 처음 부를 때 require
 *                    · data/weather_alerts.json(특보 변경 감지 — 크롤러 결과, 읽기만) · data/station_briefing/(설정·상태·날짜별 브리핑·대표 위치 캐시)
 *  - 서버 API      : routes/station_briefing.js 가 이 모듈을 부른다
 *  - 나를 쓰는 곳  : routes/station_briefing.js · server.js(운영 start) · scripts/test_station_briefing.js(가짜 시계·어댑터)
 * [로드 순서] 서버 require 부작용 없음. start() 는 운영(FLY_ALLOC_ID)에서만 1분 점검을 켠다 — 서버 시작 때 계산·외부 호출을 하지 않는다(첫 점검은 1분 뒤).
 * ============================================================================
 */
'use strict';
const fs = require('fs'), path = require('path');
const R = require('./station_briefing_rules'), AI = require('./station_briefing_ai'), I = require('./station_briefing_inputs');
const DATA = path.join(__dirname, '..', 'data');
const MAX_ERRORS = 200;

// 관리자 「AI 브리핑」 설정의 선택지와 기본값(§11.6-15·16·17). 기본 노출 = 관리자에게만.
const CHOICES = Object.freeze({
    method: ['chatgpt', 'gemini', 'template'],
    chatgptModel: ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra'],   // codex_bridge.ANSWER_MODELS 에서 'gemini' 를 뺀 것(시험이 같은지 확인)
    geminiModel: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],  // 저장소의 다른 Gemini 호출이 쓰는 두 모델
    exposure: ['user', 'admin', 'off'],
    batchUnit: ['station', 'office', 'region'],
    onlyChanged: [true, false],
});
const DEFAULT_CONFIG = Object.freeze({ method: 'chatgpt', chatgptModel: 'gpt-6-luna', geminiModel: 'gemini-2.5-flash', exposure: 'admin', batchUnit: 'office', onlyChanged: true });

/**
 * 설정값을 선택지 안으로 정리한다(모르는 값은 기본값). 예: {method:'x',exposure:'user'} → {method:'chatgpt',exposure:'user',…}
 * @param {object} c @returns {object} [연계] ← readConfig·writeConfig
 */
function normConfig(c) { const o = {}; for (const [k, v] of Object.entries(DEFAULT_CONFIG)) o[k] = c && CHOICES[k].includes(c[k]) ? c[k] : v; return o; }
/**
 * 노출 판정(§11.6-15) — 특보 예측 표출 제어(routes/advisoryPrediction.js)와 같은 순서:
 *   user → 모두에게 / off → 아무에게도 / admin → ①등록된 관리자 기기(admin_devices.json — FCM 토큰 또는 웹푸시 endpoint 를 그대로 대조, advisory/displayControl.isAdminDevice)
 *   ②그 밖이면 관리자 로그인 토큰(X-Admin-Token — admin_auth.verifyToken, PC 처럼 기기 등록이 안 되는 관리자).
 * 예: decideExposure('admin', {deviceId:'tok1'}, {isAdminDevice:id=>id==='tok1'}) → {audience:'admin',display:true,by:'device'}
 * @param {string} exposure @param {object} who - {deviceId,adminToken} @param {object} fns - isAdminDevice·verifyToken @returns {object}
 * [연계] ← routes/station_briefing.js
 */
function decideExposure(exposure, who = {}, { isAdminDevice, verifyToken } = {}) {
    if (exposure === 'user') return { audience: 'user', display: true, by: 'all' };
    if (exposure !== 'admin') return { audience: 'off', display: false, by: null };
    try { if (who.deviceId && isAdminDevice && isAdminDevice(who.deviceId)) return { audience: 'admin', display: true, by: 'device' }; } catch (_) { /* 기기 목록 읽기 실패 — 아래 토큰으로 */ }
    try { if (who.adminToken && verifyToken && verifyToken(who.adminToken)) return { audience: 'admin', display: true, by: 'token' }; } catch (_) { /* 토큰 확인 실패 = 미인가 */ }
    return { audience: 'admin', display: false, by: null };
}
/**
 * 특보 트리에서 구역별 서명(종류·등급·발표·발효·해제예고·예비)을 만든다 — 서명이 바뀐 구역 = 특보가 바뀐 구역(예비·발표·발효·격상·격하·해제·해제예고 변경).
 * 예: warnSignatures(tree) → {'제주도북부앞바다': '[["V","주의보",…]]', '제주도북부앞바다중연안바다': '…'}
 * @param {object} tree - weather_alerts.json current @returns {object} zoneKey → 서명 [연계] ← tick
 */
function warnSignatures(tree) {
    const out = {}, f = (b) => b && typeof b === 'object' ? [b.wrnTp || b.wrnTpNm || '', b.wrnLvl || b.wrnLvlNm || '', b.tmFc || '', b.tmEf || '', b.clrNtcTm || b.tmCc || '', b.tmYn || ''] : null;
    (function walk(n) {
        if (!n || typeof n !== 'object') return;
        for (const [name, v] of Object.entries(n)) {
            if (!v || typeof v !== 'object') continue;
            if (Object.hasOwn(v, 'children') && (Object.hasOwn(v, 'current') || Object.hasOwn(v, 'upcoming'))) {
                out[R.zoneKey(name)] = JSON.stringify([f(v.current), f(v.upcoming)]);
                for (const [c, b] of Object.entries(v.children || {})) out[R.zoneKey(c)] = JSON.stringify([f(b)]);
            } else walk(v);
        }
    })(tree);
    return out;
}
/** 두 서명 묶음에서 바뀐 구역 열쇠. 예: ({a:'1'},{a:'2',b:'x'}) → ['a','b']. @returns {string[]} [연계] ← tick */
function changedZones(prev, next) { const ks = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]); return [...ks].filter((k) => (prev || {})[k] !== (next || {})[k]).sort(); }

/**
 * 실제 AI 어댑터(VM·Gemini). 시험은 가짜를 넣는다 — 이 함수는 운영에서만 불린다.
 * @returns {object} {vm:{available,call}, gemini:{available,call}} [연계] ← createService 기본값 / → codex_bridge.callRaw · gemini_client.callGeminiRaw
 */
function realAdapters() {
    return {
        vm: {
            available: () => { const c = require('./codex_bridge'); return c.ENABLED && c.workerAlive(); },
            call: async ({ prompt, model }) => { const r = await require('./codex_bridge').callRaw({ contents: prompt, config: { responseMimeType: 'application/json' }, caller: 'StationBriefing', model }); if (!r.success) throw new Error(r.error || 'VM 실패'); return r.response.text; },
        },
        gemini: {
            available: () => require('./gemini_client').hasAnyKey(),
            call: async ({ prompt, model }) => { const r = await require('./gemini_client').callGeminiRaw({ model, contents: prompt, config: { responseMimeType: 'application/json' }, caller: 'StationBriefing' }); if (!r.success) throw new Error(r.error || 'Gemini 실패'); const t = r.response && r.response.text; return typeof t === 'function' ? t.call(r.response) : t; },
        },
    };
}

/**
 * 브리핑 서비스를 만든다(시험은 폴더·시계·저장소·어댑터·관할 목록을 주입).
 * 예: const svc = createService({dir, clock, risk, marine, adapters}); await svc.run({kind:'morning'}); svc.pick({key, day:'auto'})
 * @param {object} o - dir·clock·risk·marine·adapters·loadStations·alertsFile·geocoder·tideDeps·spotsOf·hazardFeatures
 * @returns {object} run·tick·start·stop·pick·readConfig·writeConfig·status·stationList
 * [연계] ← forDefault·시험 / → R·AI·I
 */
function createService({ dir = path.join(DATA, 'station_briefing'), clock = Date.now, risk, marine, adapters, loadStations = () => I.loadStations(), alertsFile = path.join(DATA, 'weather_alerts.json'), geocoder = null, tideDeps, spotsOf, hazardFeatures, kma = () => I.kmaOutlook() } = {}) {
    let timer = null, running = null, stationsCache = null, ad = adapters;
    const fileCache = new Map();
    const p = (f) => path.join(dir, f);
    const stations = () => stationsCache || (stationsCache = loadStations());
    /** 설정 읽기. @returns {object} [연계] ← run·routes */
    function readConfig() { return normConfig(I.readJson(p('config.json'))); }
    /** 설정 쓰기(선택지 밖 값이면 400). 예: writeConfig({exposure:'user'}) → 저장된 설정 @param {object} patch @returns {object} [연계] ← routes PUT */
    function writeConfig(patch) {
        const cur = readConfig(), next = { ...cur };
        for (const [k, v] of Object.entries(patch || {})) { if (!CHOICES[k]) continue; if (!CHOICES[k].includes(v)) throw Object.assign(new Error('설정값 오류: ' + k), { status: 400 }); next[k] = v; }
        I.writeJson(p('config.json'), { ...next, updatedAt: R.isoKst(clock()) }); return next;
    }
    /** 상태 파일(만든 판·특보 서명·관할별 특보구역·마지막 실행·오류). @returns {object} [연계] ← run·tick·status */
    function state() { const s = I.readJson(p('state.json')) || {}; return { done: s.done || [], warnSig: s.warnSig || null, stationZones: s.stationZones || {}, lastRun: s.lastRun || null, errors: s.errors || [], alertsMtime: s.alertsMtime || null }; }
    function saveState(s) { I.writeJson(p('state.json'), s); }
    /** 날짜별 브리핑 파일 읽기(mtime 캐시). @param {string} date @returns {object|null} [연계] ← pick·run */
    function readDay(date) {
        const f = p('briefings_' + date + '.json'); let st; try { st = fs.statSync(f); } catch (_) { return null; }
        const c = fileCache.get(f); if (c && c.mtime === st.mtimeMs) return c.data;
        const data = I.readJson(f); fileCache.set(f, { mtime: st.mtimeMs, data }); while (fileCache.size > 4) fileCache.delete(fileCache.keys().next().value); return data;
    }
    /** 이틀 넘게 지난 날짜 파일을 지운다(오늘·내일·어제만 남김). @param {number} now [연계] ← run */
    function prune(now) { const keep = new Set([-1, 0, 1].map((d) => R.kstDate(now + d * 86400000))); try { for (const f of fs.readdirSync(dir)) { const m = f.match(/^briefings_(\d{4}-\d{2}-\d{2})\.json$/); if (m && !keep.has(m[1])) fs.unlinkSync(p(f)); } } catch (_) { /* 폴더 없음 */ } }
    /**
     * 브리핑을 만든다. kind: morning|evening|night(정시) · warning(특보 변경 — keys 관할만, 이미 있는 오늘·내일 판의 남은 칸) · manual(관리자 실행 — 화면이 지금 보일 날짜).
     * 예: await run({kind:'morning'}) → {ok:true, date:'2026-10-17', stations:97, stats:{…}, ms}
     * @param {object} o - kind·keys(대상 관할 열쇠, 없으면 전부)·zones(특보 변경 구역 — 기록용) @returns {Promise<object>}
     * [연계] ← tick·routes POST run / → I.gather·R.buildBriefing·AI.generate
     */
    async function run({ kind, keys = null, zones = null } = {}) {
        if (running) return { ok: false, skipped: 'busy' };
        running = (async () => {
            const t0 = Date.now(), now = clock(), config = readConfig(), all = stations(), st = state();
            const targets = keys ? all.filter((s) => keys.includes(s.key)) : all;
            const wins = [];
            if (kind === 'warning') { for (const d of [R.kstDate(now), R.kstDate(now + 86400000)]) { const day = readDay(d); if (!day) continue; const w = R.editionWindow('warning', now, d); if (w) wins.push(w); } }
            else if (kind === 'manual') { const d = R.displayDate(now), w = R.editionWindow(d === R.kstDate(now) ? 'morning' : 'night', now); wins.push({ ...w, kind: 'manual' }); }
            else wins.push(R.editionWindow(kind, now));
            const spots = spotsOf ? spotsOf() : risk.spots().spots, spotsBySt = I.assignSpots(all, spots);
            const hz = I.assignHazards(all, hazardFeatures ? hazardFeatures() : (I.readJson(path.join(I.CONFIG, 'coastal_hazard_zones.wgs84.geojson'))?.features || []));
            const landPoints = Object.fromEntries(all.map((s) => [s.key, (spotsBySt.get(s.key) || []).concat(hz.get(s.key) || [])]));
            const locations = await I.ensureLocations({ stations: all, landPoints, file: p('locations.json'), geocoder, now });
            const results = [];
            for (const win of wins) {
                const inputs = I.gather({ stations: targets, risk, marine, win, now, locations, hazards: hz, spotsBySt, tideDeps });
                const briefings = inputs.map((x) => R.buildBriefing(x, win, { generatedAt: R.isoKst(now) }));
                const day = readDay(win.targetDate) || { date: win.targetDate, stations: {} };
                const gen = await AI.generate({ briefings, config, previous: day.stations, adapters: ad || (ad = realAdapters()), kma: kma(), now });
                for (const b of briefings) { b.overview = gen.overviews[b.key] || b.overview; b.trigger = kind === 'warning' ? { kind, zones } : { kind }; day.stations[b.key] = b; }
                day.updatedAt = R.isoKst(now); I.writeJson(p('briefings_' + win.targetDate + '.json'), day); fileCache.delete(p('briefings_' + win.targetDate + '.json'));
                for (const x of inputs) st.stationZones[x.key] = [...new Set((x.sea.warnings || []).map((w) => R.zoneKey(w.zone)).concat((x.sea.regions || []).flatMap((r) => r.zones.map(R.zoneKey))))];
                st.errors = st.errors.concat(gen.errors.map((e) => ({ ...e, edition: win.kind, date: win.targetDate }))).slice(-MAX_ERRORS);
                results.push({ date: win.targetDate, stations: briefings.length, stats: gen.stats, errors: gen.errors.length });
            }
            prune(now);
            st.lastRun = { at: R.isoKst(now), kind, zones, results, ms: Date.now() - t0 };
            saveState(st);
            return { ok: true, results, ms: Date.now() - t0 };
        })();
        try { return await running; } finally { running = null; }
    }
    /**
     * 1분 점검: ①지금 만들 정시 판(R.dueEdition)이 있으면 만든다 ②특보 크롤러 결과가 바뀌었으면 구역 서명을 비교해, 바뀐 구역에 걸친 관할만 다시 만든다.
     * 처음 보는 서명(재시작 직후 상태 파일에 서명이 없음)은 기록만 하고 다시 만들지 않는다. 실행 중이면 이번 점검을 건너뛴다(서명은 다음에 다시 비교).
     * 예: await tick() → {edition:'2026-10-17|morning'} · {warning:['…|한림파출소'], zones:['제주도서부앞바다']} · {}
     * @returns {Promise<object>} [연계] ← start(1분) · 시험(가짜 시계)
     */
    async function tick() {
        if (running) return { busy: true };
        const now = clock(), out = {};
        const st = state(), due = R.dueEdition(now, st.done);
        if (due) { const r = await run({ kind: due.kind }); if (r.ok) { const s2 = state(); s2.done = s2.done.concat(due.key).slice(-12); saveState(s2); out.edition = due.key; } }
        let mtime = null; try { mtime = fs.statSync(alertsFile).mtimeMs; } catch (_) { return out; }
        const s3 = state(); if (s3.alertsMtime === mtime) return out;
        const tree = I.readJson(alertsFile)?.current; if (!tree) return out;
        const sig = warnSignatures(tree);
        if (!s3.warnSig) { s3.warnSig = sig; s3.alertsMtime = mtime; saveState(s3); return out; }
        const zs = changedZones(s3.warnSig, sig), hit = Object.entries(s3.stationZones).filter(([, z]) => z.some((k) => zs.includes(k))).map(([k]) => k);
        if (hit.length) { const r = await run({ kind: 'warning', keys: hit, zones: zs }); if (!r.ok) return out; out.warning = hit; out.zones = zs; }
        const s4 = state(); s4.warnSig = sig; s4.alertsMtime = mtime; saveState(s4);
        return out;
    }
    /** 운영(Fly)에서만 1분 점검을 켠다. @returns {boolean} [연계] ← server.js */
    function start() { if (!process.env.FLY_ALLOC_ID || timer) return false; timer = setInterval(() => { tick().catch((e) => console.error('[station_briefing] tick:', e && e.message)); }, 60000); timer.unref(); return true; }
    /**
     * 화면에 줄 브리핑을 고른다 — day auto 는 U58(21시 넘으면 다음 날). 다음 날 판(23:00 생성)이 아직 없으면 오늘 판을 주고 nextExpectedAt 을 붙인다.
     * 예: pick({key, day:'auto'}) at 21:30 → {date:'2026-10-17', briefing:오늘 판, fallback:true, wanted:'2026-10-18', nextExpectedAt:'2026-10-17T23:00:00+09:00'}
     * @param {object} o - key·day(auto|today|tomorrow) @returns {object} [연계] ← routes GET
     */
    function pick({ key, day = 'auto' }) {
        const now = clock(), today = R.kstDate(now), tomorrow = R.kstDate(now + 86400000);
        const wanted = day === 'today' ? today : day === 'tomorrow' ? tomorrow : R.displayDate(now);
        const b = readDay(wanted)?.stations?.[key] || null;
        if (b) return { date: wanted, briefing: b, fallback: false };
        if (wanted !== today && day === 'auto') { const t = readDay(today)?.stations?.[key] || null; return { date: today, briefing: t, fallback: !!t, wanted, nextExpectedAt: today + 'T23:00:00+09:00' }; }
        return { date: wanted, briefing: null, fallback: false };
    }
    /** 관리자 상태(설정·마지막 실행·최근 오류 50개·있는 날짜). @returns {object} [연계] ← routes GET status */
    function status() { const s = state(); let days = []; try { days = fs.readdirSync(dir).map((f) => (f.match(/^briefings_(\d{4}-\d{2}-\d{2})\.json$/) || [])[1]).filter(Boolean).sort(); } catch (_) { /* 폴더 없음 */ } return { config: readConfig(), choices: CHOICES, lastRun: s.lastRun, done: s.done, errors: s.errors.slice(-50).reverse(), days, running: !!running }; }
    /** 관할 목록(화면 설정용 — 폴리곤 없이). @returns {object[]} [연계] ← routes GET stations */
    function stationList() { const loc = I.readJson(p('locations.json'))?.stations || {}; return stations().map((s) => ({ key: s.key, name: s.name, office: s.office, region: s.region, seaOnly: s.seaOnly, location: loc[s.key]?.status === 'ok' ? { lat: loc[s.key].lat, lon: loc[s.key].lon, estimated: false } : { estimated: true } })); }
    return { run, tick, start, stop() { if (timer) clearInterval(timer); timer = null; }, pick, readConfig, writeConfig, status, stationList, stations, _state: state };
}
let def = null;
/**
 * 운영 기본 서비스 — 위험예측 라우트가 이미 만든 risk_store·marine_fusion 저장소를 함께 쓴다(같은 자료를 두 번 들고 있지 않게).
 * 대표 위치 카카오 검색은 운영(FLY_ALLOC_ID)에서만 켠다.
 * @returns {object} [연계] ← routes/station_briefing.js · server.js
 */
function forDefault() {
    if (def) return def;
    const { stores } = require('../routes/risk_forecast');
    def = createService({ risk: stores.risk, marine: stores.marine, geocoder: process.env.FLY_ALLOC_ID ? (a) => I.geocodeStation(a) : null });
    return def;
}

module.exports = { createService, forDefault, decideExposure, normConfig, warnSignatures, changedZones, realAdapters, CHOICES, DEFAULT_CONFIG, start: () => forDefault().start() };
