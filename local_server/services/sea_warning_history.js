/**
 * 파일명: local_server/services/sea_warning_history.js
 * 역할  : 특보 크롤러가 매 주기 써 두는 결과(data/weather_alerts.json 의 current 트리)를 읽어, 해상 특보의
 *         「발효 시작~해제」 구간을 구역별·종류별·등급별로 기록한다(1년 보관). 등급이 바뀌면(주의보↔경보) 그 시점에 나눈다.
 *         사용자 2026-10-15: 「특보는 발효를 기준으로 발효시간, 해제시간으로 시작과 끝을 보는거야. 경보에서 주의보로
 *         격하되어 발효되거나 격상된 경우에는 그 시점을 기준으로 배경에 표출하는 것이고.」 → 예비특보는 발효가 아니라 뺀다.
 * [연계] marine_warning_crawler._writeWeatherAlertsJson(결과 파일 — 크롤러는 고치지 않고 읽기만)
 *        → data/risk_forecast/warning_history.json · risk_time.parseMmisTime(글자 시각 해석)
 *        · warn_zone_cells.zoneKey·zoneKind(구역 이름 열쇠·앞바다/먼바다/연안바다/평수구역)
 *        · 나를 쓰는 곳: sea_traffic_history.createApi(조회 API) · server.js 위험예측 수집기 시작 목록(start)
 * [로드 순서] 서버 require 부작용 없음. start() 는 Fly 운영에서만 1분마다 결과 파일이 바뀌었는지 보고 기록한다.
 */
'use strict';
const fs = require('fs'), path = require('path');
const io = require('./risk_collector_io'), T = require('./risk_time');
const { zoneKey, zoneKind } = require('./warn_zone_cells');
const DAY = 86400000, KEEP_DAYS = 365;
const DATA = path.join(__dirname, '..', 'data');

/** 등급 글자를 주의보/경보로 가른다(예비·해제·빈 값은 null = 발효 아님). 예: '경보' → '경보', '예비' → null @param {string} s @returns {string|null} [연계] ← extract */
function levelOf(s) { const v = String(s || ''); return /예비|해제/.test(v) ? null : /경보/.test(v) ? '경보' : /주의보/.test(v) ? '주의보' : null; }
/** 종류 이름을 한글로 맞춘다(한글 이름이 빠져 코드만 온 블록 대비 — 같은 특보가 'V'·'풍랑' 두 구간으로 갈리지 않게).
 * 예: 'V' → '풍랑', 'T' → '태풍', '풍랑' → '풍랑' @param {string} s @returns {string} [연계] ← extract / 코드표는 marine_warning_crawler.js REALTIME_TARGET_TP 주석(V=풍랑·T=태풍·W=강풍·O=폭풍해일) */
function typeOf(s) { const v = String(s || ''); return { V: '풍랑', T: '태풍', O: '폭풍해일', W: '강풍' }[v.toUpperCase()] || v; }
/** 글자 시각이 정확한 한 시각이면 ms, 범위·자연어면 null. 예: '2026년 10월 15일 06시 00분' → ms @param {string} text @param {number} anchor @returns {number|null} [연계] ← apply */
function exactTime(text, anchor) { const r = T.parseMmisTime(text, anchor); return r && !r.range ? r.start : null; }

/**
 * current 트리에서 지금 발효 중인 해상 특보를 꺼낸다(부모 구역 current + 자식 연안바다·평수구역).
 * 예: {동해:{…:{울산앞바다:{current:{wrnTp:'풍랑',wrnLvl:'주의보',tmEf:'…'},children:{'울산앞바다중연안바다':{…}}}}}}
 *     → [{zone:'울산앞바다',role:'main',kind:'앞바다',type:'풍랑',level:'주의보',tmEf,clr}, …]
 * @param {object} tree - weather_alerts.json 의 current @returns {object[]} 발효 목록
 * [연계] ← observe / 크롤러가 이미 예비를 upcoming 으로 따로 두므로 current·자식의 주의보/경보만 본다
 */
function extract(tree) {
    const out = [];
    const push = (zone, role, b) => {
        const level = b && levelOf(b.wrnLvlNm || b.wrnLvl);
        if (!level) return;
        out.push({ zone, role, kind: zoneKind(zone, role === 'sub'), type: typeOf(b.wrnTpNm || b.wrnTp), level, tmEf: String(b.tmEf || ''), clr: String(b.clrNtcTm || b.tmCc || '') });
    };
    (function walk(n) {
        if (!n || typeof n !== 'object') return;
        for (const [name, v] of Object.entries(n)) {
            if (!v || typeof v !== 'object') continue;
            if (Object.hasOwn(v, 'current') && Object.hasOwn(v, 'children')) {
                push(name, 'main', v.current);
                for (const [child, b] of Object.entries(v.children || {})) push(child, 'sub', b);
            } else walk(v);
        }
    })(tree);
    return out;
}

/**
 * 한 폴더의 특보 구간 기록기를 만든다.
 * 예: const r=createRecorder({dir,alertsFile}); r.observe(); r.list({zones:['울산앞바다'],from,to})
 * @param {object} options - dir(기록 폴더), alertsFile(크롤러 결과), clock(시험용 시계)
 * @returns {object} observe, list, start, stop, _state
 * [연계] ← forDir·start / 관측 시각은 결과 파일의 수정시각(크롤러가 그 상태를 본 시각)
 */
function createRecorder({ dir = io.DEFAULT_DIR, alertsFile = path.join(DATA, 'weather_alerts.json'), clock = Date.now } = {}) {
    const file = path.join(dir, 'warning_history.json');
    let state = null, timer = null;
    /** 기록 파일을 한 번 읽는다(재시작 복구). @returns {object} [연계] ← observe·list */
    function load() {
        if (state) return state;
        const d = io.read(file);
        state = d && Array.isArray(d.intervals) ? d : { v: 1, checkedAt: null, sourceMtime: null, intervals: [] };
        return state;
    }
    /**
     * 이번 관측의 발효 목록을 열린 구간과 맞춰 구간을 열고·닫고·나눈다.
     * - 새로 보임: 시작 = 발효시각(tmEf)이 정확한 시각이고 관측 시각 이전이면 그 시각, 아니면 처음 본 시각.
     * - 등급이 바뀜: 그 시점에서 나눈다 = 새 tmEf 가 (이전 시작, 관측] 안의 정확한 시각이면 그 시각, 아니면 관측 시각.
     * - 사라짐: 끝 = 마지막에 본 해제시각(clrNtcTm)이 [시작, 관측] 안의 정확한 시각이면 그 시각, 아니면 사라진 걸 본 시각.
     * - 잠깐 사라졌다 같은 등급·같은 발효시각 글자로 다시 보이면 같은 특보로 보고 구간을 다시 연다.
     * @param {object[]} active - extract 결과 @param {number} obs - 관측 시각(ms) @returns {void}
     * [연계] ← observe / startBy·endBy 에 어느 근거로 정했는지 남긴다(화면이 「추정」을 구분할 수 있게)
     */
    function apply(active, obs) {
        const s = load(), now = new Map(active.map((a) => [a.zone + '|' + a.type, a]));
        const openMap = new Map(s.intervals.filter((x) => x.end === null).map((x) => [x.zone + '|' + x.type, x]));
        const close = (x, t, by) => { x.end = io.iso(t); x.endBy = by; };
        const begin = (a, t, by) => { s.intervals.push({ zone: a.zone, role: a.role, kind: a.kind, type: a.type, level: a.level, start: io.iso(t), startBy: by, end: null, endBy: null, _tmEf: a.tmEf, _clr: a.clr }); };
        for (const [key, x] of openMap) {
            if (now.has(key)) continue;
            const st = Date.parse(x.start), c = exactTime(x._clr, obs);
            if (c !== null && c >= st && c <= obs) close(x, c, 'clrNtcTm'); else close(x, obs, 'observed');
        }
        for (const [key, a] of now) {
            const x = openMap.get(key);
            if (x && x.level === a.level) { if (a.clr) x._clr = a.clr; continue; }
            if (x) {
                const st = Date.parse(x.start), e = exactTime(a.tmEf, obs), t = e !== null && e > st && e <= obs ? e : obs;
                close(x, t, 'levelChange');
                begin(a, t, e === t ? 'tmEf' : 'observed');
                continue;
            }
            const last = s.intervals.filter((y) => y.zone === a.zone && y.type === a.type && y.end !== null).at(-1);
            if (last && last.level === a.level && last.endBy !== 'levelChange' && a.tmEf && last._tmEf === a.tmEf) { last.end = null; last.endBy = null; if (a.clr) last._clr = a.clr; continue; }
            const e = exactTime(a.tmEf, obs);
            if (e !== null && e <= obs) begin(a, e, 'tmEf'); else begin(a, obs, 'observed');
        }
    }
    /**
     * 크롤러 결과 파일이 바뀌었으면 읽어 구간을 갱신하고 저장한다(1년 넘게 끝난 구간은 지운다).
     * 예: observe() → {ok:true,open:3} · 파일이 그대로면 {ok:true,unchanged:true} · 없거나 깨지면 {ok:false} (기록은 그대로)
     * @returns {object} 결과 [연계] ← start(1분마다) · 시험
     */
    function observe() {
        const s = load();
        let st;
        try { st = fs.statSync(alertsFile); } catch (_) { return { ok: false, error: 'alerts missing' }; }
        if (s.sourceMtime === st.mtimeMs) return { ok: true, unchanged: true };
        let tree;
        try { tree = JSON.parse(fs.readFileSync(alertsFile, 'utf8')).current; } catch (_) { return { ok: false, error: 'alerts unreadable' }; }
        if (!tree || typeof tree !== 'object') return { ok: false, error: 'alerts unreadable' };
        const obs = st.mtimeMs;
        apply(extract(tree), obs);
        const cut = clock() - KEEP_DAYS * DAY;
        s.intervals = s.intervals.filter((x) => x.end === null || Date.parse(x.end) >= cut);
        s.sourceMtime = obs; s.checkedAt = io.iso(obs);
        io.write(file, s);
        return { ok: true, open: s.intervals.filter((x) => x.end === null).length };
    }
    /**
     * 구역들의 특보 구간 중 [from,to) 와 겹치는 것을 시작 순으로 돌려준다(내부 칸 _tmEf·_clr 은 뺀다).
     * 예: list({zones:['울산앞바다중 연안바다'],from,to}) → {checkedAt, intervals:[{zone,role,kind,type,level,start,startBy,end,endBy}]}
     * @param {object} q - zones(구역 이름 — 띄어쓰기·가운뎃점 표기 무관), from·to(ms) @returns {object}
     * [연계] ← sea_traffic_history.createApi.query
     */
    function list({ zones = [], from = -Infinity, to = Infinity } = {}) {
        const s = load(), keys = new Set(zones.map(zoneKey));
        const intervals = s.intervals.filter((x) => keys.has(zoneKey(x.zone)) && Date.parse(x.start) < to && (x.end === null || Date.parse(x.end) > from))
            .map(({ _tmEf, _clr, ...x }) => x).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
        return { checkedAt: s.checkedAt, intervals };
    }
    /** Fly 운영에서만 1분마다 observe 를 돌린다. @returns {boolean} 시작 여부 [연계] ← server.js 위험예측 수집기 시작 목록 */
    function start() {
        if (!process.env.FLY_ALLOC_ID || timer) return false;
        const tick = () => { try { observe(); } catch (e) { io.reportError('warning history', e); } };
        tick(); timer = setInterval(tick, 60000); timer.unref();
        return true;
    }
    return { observe, list, start, stop() { if (timer) clearInterval(timer); timer = null; }, _state: load };
}

const instances = new Map();
/** 폴더마다 하나의 기록기. 예: forDir() → 운영 기록기 @param {string} dir @returns {object} [연계] ← start·createApi */
function forDir(dir = io.DEFAULT_DIR) { if (!instances.has(dir)) instances.set(dir, createRecorder({ dir })); return instances.get(dir); }

module.exports = { createRecorder, forDir, extract, levelOf, start: () => forDir().start() };
