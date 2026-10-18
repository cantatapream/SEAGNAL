/**
 * ============================================================================
 * 파일명: local_server/services/beach_weather_collector.js
 * 역할  : 기상청 「전국 해수욕장 날씨 조회서비스」에서 해수욕장 419곳(몰운대 제외)의 단기예보와 수온 관측을
 *         발표 15분 뒤(02:15·05:15·…·23:15 KST)에 받아, 판단에 필요한 값만(오늘·내일 48시간 × 기온·하늘·강수형태·
 *         강수확률·파고·풍속 + 낮 최고기온, 수온은 가장 최근 관측 1개) 메모리와 작은 파일(재시작 대비)에 둔다.
 *         원본 응답(한 곳 835항목)은 쌓지 않는다(사용자 2026-10-18 — 메모리 1GB 단일 머신).
 * ----------------------------------------------------------------------------
 * [사용자 결정 2026-10-18 원문 — 설계서 coastal_safety_forecast.design.md §18]
 *   *"이틀치를 받아와서 … 다음날이 도래했을 때 기상정보가 바뀌었을 때는 새로 갱신된 기상정보 데이터를 기준으로
 *    … 데이터가 갱신되는 시점을 확인해서 그거에 따라서 정보를 수집"*
 *   → 발표(02·05·08·11·14·17·20·23시, 활용가이드 「각 10분 뒤부터 제공」)마다 15분에 받고, 새 판이 덮는 시각만 바꾼다
 *     (지난 시각은 앞 판 값이 남는다 — 「이틀치」 창은 오늘 00시~내일 23시).
 * [실패] 한 곳 실패 = 그 곳 이전 값 유지. 연속 BREAK_AFTER 번 실패(접속 차단 등)면 그 회차를 멈춘다(나머지 곳에 묻지 않음).
 *        회차가 실패하면 그 발표 안에서 30분마다 다시 시도한다. 오래된 값(2 발표 넘게 못 받음)은 판단에서 뺀다 —
 *        그 판정은 services/beach_weather.js(화면에 틀린 값을 조용히 보이지 않게).
 *        수집 실패 기록: services/collect_fail_alert(beachForecast·beachWaterTemp — 푸시 없이 기록만, 데이터 수집현황 카드).
 * [시간 제한] 요청마다 연결 5초·전체 15초(tide_collector.js TIDEBED_TIMEOUTS 와 같은 값 — 2026-10-18 조석 수정의 근거 그대로).
 * [호출량] 단기예보 419 × 8 = 하루 3,352회 · 수온 419 × 8 = 3,352회(기능별 하루 10,000회 한도 — DAY_LIMIT 9,000 에서 멈춤).
 * [인증키] 공공데이터포털 키(api_config.json ROMS_SERVICE_KEY — risk_collector_io.publicKey). 키·주소는 로그·파일·오류에 남기지 않는다.
 * [연계]
 *  - 사용하는 파일 : services/risk_collector_io.js(publicKey·write·read·day·iso) · services/collect_fail_alert.js(report)
 *                    · config/coastal_safety/beach_weather_static.json(수집할 해수욕장 번호 — build_beach_weather_static.py)
 *  - 저장          : data/beach_weather/forecast.json · watertemp.json · status.json
 *  - 나를 쓰는 곳  : server.js(운영 start) · services/beach_weather.js(forecast·waterTemp 읽기) · 시험 scripts/test_beach_weather.js
 *  - 관리자        : config/data_collection_manifest.json 의 beachForecast·beachWaterTemp
 * [로드 순서] require 부작용 없음. 파일은 처음 읽을 때 한 번. start 는 운영(FLY_ALLOC_ID)에서만 1분 점검을 건다.
 * ============================================================================
 */
'use strict';
const fs = require('fs'), path = require('path'), https = require('https'), http = require('http');
const io = require('./risk_collector_io');

const BASE_URL = 'https://apis.data.go.kr/1360000/BeachInfoservice';
const ISSUE_HOURS = [2, 5, 8, 11, 14, 17, 20, 23];   // 활용가이드 「#발표시각정보 — 단기예보(KST)」
const READY_MIN = 10;                                // 「API 제공 시간(~이후)」 = 발표 10분 뒤
const COLLECT_MIN = 15;                              // 사용자 지시: 발표 15분 뒤
const RETRY_MS = 30 * 60000;                         // 회차 실패 시 같은 발표 안에서 다시
const TIMEOUTS = { connectMs: 5000, totalMs: 15000 }; // 시험이 짧게 바꿔 쓴다
const GAP_MS = 150;                                  // 한 곳씩 순차·짧은 간격(활용가이드 초당 최대 30tps — 그보다 한참 느리게)
const BREAK_AFTER = 5;                               // 연속 실패면 그 회차 멈춤
const DAY_LIMIT = 9000;                              // 기능별 하루 10,000회 한도보다 아래
const HOURS = 48;
// 남기는 항목과 정수로 줄여 담는 배율(Int16Array — 칸 하나 2바이트). 결측 = MISS.
const CATS = ['TMP', 'SKY', 'PTY', 'POP', 'WAV', 'WSD'];
const SCALE = { TMP: 10, SKY: 1, PTY: 1, POP: 1, WAV: 10, WSD: 10 };
const MISS = -32768;
const KST = 9 * 3600000, HOUR = 3600000, DAY = 24 * HOUR;

/** 'YYYYMMDD'+'HHmm' → ms(KST 로 읽음). 예: kstMs('20261018','1100') → 2026-10-18T02:00Z. @returns {number} NaN 이면 형식 오류 */
function kstMs(ymd, hm) {
    if (!/^\d{8}$/.test(String(ymd)) || !/^\d{4}$/.test(String(hm))) return NaN;
    return Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8), +hm.slice(0, 2), +hm.slice(2, 4)) - KST;
}
/** ms → {ymd:'YYYYMMDD', hm:'HHmm', date:'YYYY-MM-DD', h} (KST). @param {number} ms */
function kstParts(ms) {
    const s = new Date(ms + KST).toISOString();
    return { ymd: s.slice(0, 10).replace(/-/g, ''), hm: s.slice(11, 13) + s.slice(14, 16), date: s.slice(0, 10), h: +s.slice(11, 13), m: +s.slice(14, 16) };
}

/**
 * 지금 받을 수 있는 가장 최근 단기예보 발표 시각(ms). 발표 10분 뒤부터 제공(활용가이드).
 * 예: 10-18 14:09 KST → 10-18 11:00 · 14:10 → 14:00 · 10-18 01:00 → 10-17 23:00
 * @param {number} now @returns {number} [연계] ← collect(base_date·base_time)·beach_weather(낡음 판정)·tick
 */
function issueAt(now) {
    const dayStart = Math.floor((now + KST) / DAY) * DAY - KST;
    for (let d = 0; d <= 1; d++) for (let i = ISSUE_HOURS.length - 1; i >= 0; i--) {
        const t = dayStart - d * DAY + ISSUE_HOURS[i] * HOUR;
        if (t + READY_MIN * 60000 <= now) return t;
    }
    return dayStart - DAY + 23 * HOUR;
}

/** 이 분(KST)이 정기 수집 시각인가(02:15·05:15·…·23:15). 예: isCollectMinute(10-18 14:15 KST) → true. [연계] ← tick */
function isCollectMinute(now) { const p = kstParts(now); return p.m === COLLECT_MIN && ISSUE_HOURS.includes(p.h); }

/** 예보 값 글 → 숫자. 결측(+900 이상·-900 이하, 활용가이드)·숫자 아님 → null. 예: '0.5' → 0.5 · '강수없음' → null · '-999' → null */
function num(v) { const n = parseFloat(v); return Number.isFinite(n) && n < 900 && n > -900 ? n : null; }

/**
 * 연결 5초·전체 15초 두 기한을 건 GET(tide_collector.fetchTideBedPage 와 같은 방식). 응답 본문 글을 준다.
 * 실패는 고정 분류 글만 던진다(주소·키가 오류에 섞이지 않게): '연결 시간 초과' · '전체 시간 초과' · '연결 실패' · 'HTTP 503'.
 * 예: await httpGet('https://…') → '{"response":…}'
 * @param {string} url @param {object} [o] - lib(시험: 가짜 http) @returns {Promise<string>}
 * [연계] ← fetchJson(기본) / 시험 test_beach_weather 「시간 제한」
 */
function httpGet(url, o = {}) {
    const lib = o.lib || (url.startsWith('https:') ? https : http);
    return new Promise((resolve, reject) => {
        let settled = false, connected = false, timedOut = null;
        const done = (err, v) => { if (settled) return; settled = true; clearTimeout(ct); clearTimeout(tt); err ? reject(err) : resolve(v); };
        const req = lib.get(url, (res) => {
            connected = true;
            if (res.statusCode !== 200) { res.resume(); return done(new Error('HTTP ' + res.statusCode)); }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => done(null, Buffer.concat(chunks).toString('utf8')));
            res.on('error', () => done(new Error(timedOut || '연결 실패')));
        });
        const ct = setTimeout(() => { if (!connected) { timedOut = '연결 시간 초과'; req.destroy(new Error(timedOut)); } }, TIMEOUTS.connectMs);
        const tt = setTimeout(() => { timedOut = timedOut || '전체 시간 초과'; req.destroy(new Error(timedOut)); }, TIMEOUTS.totalMs);
        req.on('socket', (s) => { if (!s.connecting) connected = true; else { s.once('connect', () => { connected = true; }); s.once('secureConnect', () => { connected = true; }); } });
        req.on('error', () => done(new Error(timedOut || '연결 실패')));
    });
}

/**
 * 공공데이터포털 응답 글을 해석한다. 정상(resultCode 00) → body, 자료 없음(03) → null, 그 밖 → 던짐(고정 글).
 * 예: parseBody('{"response":{"header":{"resultCode":"00"},"body":{…}}}') → body
 * @param {string} text @returns {object|null} [연계] ← fetchForecast·fetchTw
 */
function parseBody(text) {
    let j;
    try { j = JSON.parse(text); } catch (_) {
        // 키 오류·한도 초과는 XML(OpenAPI_ServiceResponse)로 온다 — 코드 이름만 남긴다
        const m = /<returnReasonCode>(\d+)<\/returnReasonCode>/.exec(String(text));
        throw new Error(m ? 'API 오류 코드 ' + m[1] : '응답 해석 실패');
    }
    const h = j && j.response && j.response.header, code = h ? String(h.resultCode) : '';
    if (code === '03') return null;
    if (code !== '00') throw new Error(code ? 'API 오류 코드 ' + code.slice(0, 6) : '응답 해석 실패');
    return j.response.body || null;
}

/** body.items.item → 배열. @param {object} body @returns {object[]} */
function itemsOf(body) { const v = body && body.items && body.items.item; return Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : []; }

/**
 * 한 해수욕장의 단기예보 응답(items)을 48칸 창(d0 00시 ~ d0+1 23시)에 덮어쓴다. 응답이 준 칸·항목만 바꾸고 나머지(지난 시각)는 둔다.
 * 낮 최고기온(TMX)은 날짜별 하나. 예: merge(entry, items, '2026-10-18') → 바꾼 칸 수
 * @param {{base:string,v:Int16Array,tmx:number[]}} e @param {object[]} items @param {string} d0 - 창 첫날(YYYY-MM-DD)
 * @returns {number} [연계] ← collect / 시험 「이틀치 덮어쓰기」
 */
function merge(e, items, d0) {
    const start = Date.parse(d0 + 'T00:00:00+09:00');
    let n = 0;
    for (const it of items) {
        const at = kstMs(String(it.fcstDate), String(it.fcstTime));
        if (!Number.isFinite(at)) continue;
        const idx = Math.round((at - start) / HOUR);
        if (it.category === 'TMX') { const d = Math.floor(idx / 24); if (d === 0 || d === 1) { const x = num(it.fcstValue); e.tmx[d] = x === null ? null : x; n++; } continue; }
        const c = CATS.indexOf(it.category);
        if (c < 0 || idx < 0 || idx >= HOURS) continue;
        const x = num(it.fcstValue);
        e.v[idx * CATS.length + c] = x === null ? MISS : Math.round(x * SCALE[CATS[c]]);
        n++;
    }
    return n;
}

/** 창을 새 첫날로 옮긴다(하루 지나면 어제 「내일」이 오늘). 예: shift(e, 1) → 24칸 앞으로 · 2일 이상 → 전부 결측. @param {object} e @param {number} days */
function shift(e, days) {
    if (days <= 0) return;
    const W = CATS.length;
    if (days >= 2) { e.v.fill(MISS); e.tmx = [null, null]; return; }
    e.v.copyWithin(0, 24 * W, HOURS * W); e.v.fill(MISS, 24 * W);
    e.tmx = [e.tmx[1], null];
}

/** 빈 해수욕장 칸. @returns {{base:null,v:Int16Array,tmx:Array}} */
function blank() { return { base: null, v: new Int16Array(HOURS * CATS.length).fill(MISS), tmx: [null, null] }; }

/**
 * 수집기를 만든다(시험은 임시 폴더·가짜 시계·가짜 요청을 넣는다).
 * @param {object} [o] - dir · clock · beachNums(번호 배열) · getKey · fetchText(url)→Promise<string> · wait(ms) · gapMs · alert(id, outcome)
 * @returns {object} collect·tick·start·stop·forecast(n)·waterTemp(n)·meta()·sizes()
 * [연계] ← 모듈 기본 싱글톤(server.js·beach_weather.js) / 시험
 */
function createCollector(o = {}) {
    const dir = o.dir || path.join(__dirname, '..', 'data', 'beach_weather');
    const clock = o.clock || Date.now;
    const getKey = o.getKey || io.publicKey;
    const fetchText = o.fetchText || ((url) => httpGet(url));
    const wait = o.wait || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const gapMs = o.gapMs === undefined ? GAP_MS : o.gapMs;
    const alert = o.alert || ((id, outcome) => require('./collect_fail_alert').report(id, outcome));
    const beachNums = o.beachNums || (() => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'coastal_safety', 'beach_weather_static.json'), 'utf8')).beaches.map((b) => b.n));
    const F = path.join(dir, 'forecast.json'), T = path.join(dir, 'watertemp.json'), S = path.join(dir, 'status.json');
    let fc = null, tw = null, status = null, running = null, timer = null, nums = null;

    /** 파일에서 처음 한 번 읽는다(재시작 대비). 형식이 다르면 빈 상태. [연계] ← 모든 읽기 */
    function load() {
        if (fc) return;
        fc = { d0: null, collectedAt: null, issueAt: null, beaches: new Map() };
        const f = io.read(F);
        if (f && f.fmt === 1 && /^\d{4}-\d{2}-\d{2}$/.test(f.d0 || '') && f.beaches) {
            fc.d0 = f.d0; fc.collectedAt = f.collectedAt || null; fc.issueAt = f.issueAt || null;
            for (const [k, a] of Object.entries(f.beaches)) {
                if (!Array.isArray(a) || a.length !== 3 + HOURS * CATS.length) continue;
                const e = blank(); e.base = typeof a[0] === 'string' ? a[0] : null; e.tmx = [a[1], a[2]];
                for (let i = 0; i < HOURS * CATS.length; i++) e.v[i] = Number.isInteger(a[3 + i]) ? a[3 + i] : MISS;
                fc.beaches.set(+k, e);
            }
        }
        const t = io.read(T);
        tw = { collectedAt: (t && t.collectedAt) || null, beaches: new Map() };
        if (t && t.fmt === 1 && t.beaches) for (const [k, a] of Object.entries(t.beaches)) if (Array.isArray(a) && typeof a[0] === 'string' && Number.isFinite(a[1])) tw.beaches.set(+k, { tm: a[0], tw: a[1] });
        status = io.read(S) || {};
    }
    function saveForecast() {
        const beaches = {};
        for (const [k, e] of fc.beaches) { const a = [e.base, e.tmx[0], e.tmx[1]]; for (let i = 0; i < e.v.length; i++) a.push(e.v[i] === MISS ? null : e.v[i]); beaches[k] = a; }
        io.write(F, { fmt: 1, collectedAt: fc.collectedAt, issueAt: fc.issueAt, d0: fc.d0, cats: CATS, scale: SCALE, beaches });
    }
    function saveTw() {
        const beaches = {}; let latest = null;
        for (const [k, x] of tw.beaches) { beaches[k] = [x.tm, x.tw]; if (!latest || x.tm > latest) latest = x.tm; }
        io.write(T, { fmt: 1, collectedAt: tw.collectedAt, latestTm: latest ? io.iso(kstMs(latest.slice(0, 8), latest.slice(8, 12))) : null, beaches });
    }

    /** 공공데이터포털 주소를 만든다(키는 여기서만 붙는다). [연계] ← fetchForecast·fetchTw */
    function url(op, params) {
        let key = getKey();
        if (!key) throw new Error('인증키 없음');
        try { key = decodeURIComponent(key); } catch (_) { /* 이미 풀린 키 */ }
        const u = new URL(BASE_URL + '/' + op);
        for (const [k, v] of Object.entries({ serviceKey: key, dataType: 'JSON', ...params })) u.searchParams.set(k, v);
        return u.toString();
    }
    /** 오늘 호출 수를 센다(하루 한도). 넘으면 던진다. [연계] ← fetchForecast·fetchTw */
    function count(kind) {
        const d = io.day(clock());
        if (!status.calls || status.calls.date !== d) status.calls = { date: d, forecast: 0, tw: 0 };
        if (status.calls[kind] >= DAY_LIMIT) throw new Error('하루 호출 한도');
        status.calls[kind]++;
    }
    /** 한 해수욕장 단기예보(모든 페이지). 1000행 한 번이면 보통 끝(실측 835항목). @returns {Promise<{base:string,items:object[]}|null>} */
    async function fetchForecast(n, base) {
        const p = kstParts(base), items = [];
        for (let page = 1; page <= 4; page++) {
            count('forecast');
            const body = parseBody(await fetchText(url('getVilageFcstBeach', { numOfRows: 1000, pageNo: page, base_date: p.ymd, base_time: p.hm, beach_num: n })));
            if (!body) return null;
            const got = itemsOf(body); items.push(...got);
            if (!got.length || items.length >= Number(body.totalCount || 0)) break;
        }
        return { base: p.ymd + p.hm, items };
    }
    /** 한 해수욕장 수온 관측(지금 시각 기준 가장 최근 1개). @returns {Promise<{tm:string,tw:number}|null>} */
    async function fetchTw(n, now) {
        count('tw');
        const p = kstParts(now);
        const body = parseBody(await fetchText(url('getTwBuoyBeach', { numOfRows: 10, pageNo: 1, beach_num: n, searchTime: p.ymd + String(p.h).padStart(2, '0') + '00' })));
        let best = null;
        for (const it of itemsOf(body)) {
            const tm = String(it.tm || ''), v = num(it.tw);
            if (!/^\d{12}$/.test(tm) || v === null || kstMs(tm.slice(0, 8), tm.slice(8, 12)) > now + 10 * 60000) continue;
            if (!best || tm > best.tm) best = { tm, tw: v };
        }
        return best;
    }

    /**
     * 한 회차: 창을 오늘로 옮기고 → 단기예보 419곳 → 수온 419곳(한 곳씩, gapMs 간격). 실패한 곳은 이전 값 그대로.
     * 연속 BREAK_AFTER 번 실패하면 그 단계를 멈춘다(접속 차단 때 419곳 × 15초를 기다리지 않게).
     * 예: await collect() → { ok:true, issue:'202610181400', forecast:{ok:419,fail:0,nodata:0,broken:false}, tw:{…}, ms }
     * @returns {Promise<object>} [연계] ← tick·start / → fetchForecast·fetchTw·merge·alert
     */
    function collect() {
        if (running) return running;
        running = (async () => {
            load();
            const t0 = clock(), base = issueAt(t0), d0 = kstParts(t0).date;
            if (!nums) nums = typeof beachNums === 'function' ? beachNums() : beachNums;
            if (fc.d0 && fc.d0 !== d0) { const days = Math.round((Date.parse(d0) - Date.parse(fc.d0)) / DAY); for (const e of fc.beaches.values()) shift(e, days); }
            fc.d0 = d0;
            const run = async (kind, one) => {
                const r = { ok: 0, fail: 0, nodata: 0, broken: false, error: null };
                let streak = 0;
                for (const n of nums) {
                    if (streak >= BREAK_AFTER) { r.broken = true; break; }
                    try { (await one(n)) ? r.ok++ : r.nodata++; streak = 0; }
                    catch (e) {
                        r.fail++; streak++; r.error = r.error || String(e.message).slice(0, 40);
                        // 회차마다 첫 실패 한 줄만(419곳 줄줄이 찍지 않게 — 나머지는 회차 끝 요약 줄의 실패 수). 오류 글은 고정 분류라 주소·키가 없다.
                        if (r.fail === 1) console.warn('[beach_weather] ' + kind + ' 첫 실패(해수욕장 ' + n + '): ' + r.error);
                        if (e.message === '하루 호출 한도' || e.message === '인증키 없음') { r.broken = true; break; }
                    }
                    if (gapMs) await wait(gapMs);
                }
                return r;
            };
            const f = await run('forecast', async (n) => {
                const got = await fetchForecast(n, base);
                if (!got || !got.items.length) return false;
                const e = fc.beaches.get(n) || blank();
                if (merge(e, got.items, d0) === 0) return false;
                e.base = got.base; fc.beaches.set(n, e);
                return true;
            });
            if (f.ok) { fc.collectedAt = io.iso(clock()); fc.issueAt = io.iso(base); saveForecast(); }
            const now2 = clock();
            const w = await run('tw', async (n) => {
                const got = await fetchTw(n, now2);
                if (!got) return false;
                const old = tw.beaches.get(n);
                if (!old || got.tm >= old.tm) tw.beaches.set(n, got);
                return true;
            });
            if (w.ok) { tw.collectedAt = io.iso(clock()); saveTw(); }
            const fFail = f.broken || f.ok === 0, wFail = w.broken || w.ok === 0;
            status = { ...status, lastRun: io.iso(t0), issue: kstParts(base).ymd + kstParts(base).hm, forecast: f, tw: w, ms: clock() - t0,
                ok: !fFail, failStreak: fFail ? (status.failStreak || 0) + 1 : 0, twFailStreak: wFail ? (status.twFailStreak || 0) + 1 : 0,
                message: `발표 ${kstParts(base).hm.slice(0, 2)}시 · 예보 성공 ${f.ok}·실패 ${f.fail}·자료 없음 ${f.nodata}${f.broken ? '·중단' : ''} · 수온 성공 ${w.ok}·실패 ${w.fail}·자료 없음 ${w.nodata}${w.broken ? '·중단' : ''}` };
            try { io.write(S, status); } catch (e) { console.error('[beach_weather] 상태 저장 실패:', e.code || 'write'); }
            const err = (r) => new Error(r.error || (r.broken ? '연결 실패' : '빈 응답'));
            await alert('beachForecast', fFail ? { ok: false, error: err(f) } : { ok: true });
            await alert('beachWaterTemp', wFail ? { ok: false, error: err(w) } : { ok: true });
            console.log('[beach_weather] ' + status.message);
            return { ok: !fFail, issue: status.issue, forecast: f, tw: w, ms: status.ms };
        })().finally(() => { running = null; });
        return running;
    }

    /**
     * 1분 점검: 정기 시각(02:15·…·23:15)이거나, 이번 발표 회차가 실패했고 30분이 지났으면 받는다.
     * 예: 14:15 → collect · 14:16 → null · (14:15 실패) 14:45 → collect
     * @returns {Promise<object>|null} [연계] ← start(setInterval)
     */
    function tick() {
        load();
        const now = clock(), cur = kstParts(issueAt(now)), last = Date.parse(status.lastRun);
        if (isCollectMinute(now) && !(Number.isFinite(last) && now - last < 60000)) return collect();
        if (status.issue === cur.ymd + cur.hm && status.ok === false && Number.isFinite(last) && now - last >= RETRY_MS) return collect();
        return null;
    }
    /** 운영만 자동. 시작 때 이번 발표를 아직 받지 않았으면 한 번 받는다. @returns {boolean} [연계] ← server.js */
    function start() {
        if (!process.env.FLY_ALLOC_ID || timer) return false;
        load();
        const cur = kstParts(issueAt(clock()));
        if (status.issue !== cur.ymd + cur.hm) collect().catch((e) => console.error('[beach_weather] 시작 수집 실패:', e && e.message));
        timer = setInterval(() => { const p = tick(); if (p) p.catch((e) => console.error('[beach_weather] 점검 실패:', e && e.message)); }, 60000);
        timer.unref();
        return true;
    }

    /**
     * 한 해수욕장 예보 창을 읽는다(판단용). 예: forecast(1) → { d0:'2026-10-18', base:'202610181400', at:(i,cat)→값|null, tmx:[27,null] } · 없으면 null
     * @param {number} n @returns {object|null} [연계] ← beach_weather.dayWeather
     */
    function forecast(n) {
        load();
        const e = fc.beaches.get(+n);
        if (!e || !e.base || !fc.d0) return null;
        return { d0: fc.d0, base: e.base, tmx: e.tmx.slice(), at: (i, cat) => { const c = CATS.indexOf(cat); if (c < 0 || i < 0 || i >= HOURS) return null; const x = e.v[i * CATS.length + c]; return x === MISS ? null : x / SCALE[cat]; } };
    }
    /** 한 해수욕장 최근 수온 관측. 예: waterTemp(1) → {tm:'202610181400', tw:21.4} · 없으면 null. [연계] ← beach_weather.waterTemp */
    function waterTemp(n) { load(); const x = tw.beaches.get(+n); return x ? { ...x } : null; }
    /** 상태(관리자·시험). [연계] ← 시험 */
    function meta() { load(); return { d0: fc.d0, collectedAt: fc.collectedAt, issueAt: fc.issueAt, beaches: fc.beaches.size, tw: tw.beaches.size, status: { ...status } }; }
    /** 시험용: 예보를 직접 넣는다(가짜 응답 없이 판단 시험). [연계] ← test_beach_weather */
    function _put(n, base, d0, items) { load(); if (fc.d0 !== d0) { fc.beaches.clear(); fc.d0 = d0; } const e = fc.beaches.get(n) || blank(); merge(e, items, d0); e.base = base; fc.beaches.set(n, e); }
    function _putTw(n, tm, v) { load(); tw.beaches.set(n, { tm, tw: v }); }
    return { collect, tick, start, stop() { if (timer) clearInterval(timer); timer = null; }, forecast, waterTemp, meta, _put, _putTw, _reload() { fc = null; tw = null; status = null; } };
}

let def = null;
/** 운영 기본 수집기(한 벌). [연계] ← server.js · beach_weather.forDefault */
function forDefault() { return def || (def = createCollector()); }

module.exports = { createCollector, forDefault, start: () => forDefault().start(), issueAt, isCollectMinute, merge, shift, blank, num, parseBody, httpGet, kstParts, kstMs,
    TIMEOUTS, ISSUE_HOURS, CATS, SCALE, MISS, HOURS, BREAK_AFTER, DAY_LIMIT, BASE_URL };
