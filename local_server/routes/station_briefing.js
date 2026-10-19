/**
 * ============================================================================
 * 파일명: local_server/routes/station_briefing.js
 * 역할  : 「연안 안전 브리핑」(종전 이름 「활동지점 안전 브리핑」) API — 관할 목록·관할 브리핑(노출 판정 거침 · 공개 시각 전 판은 숨김)과 관리자 설정·상태·즉시 실행·미리보기(공개 예정 판 포함).
 *         노출 기본값은 「관리자에게만」: 관리자로 등록된 기기(admin_devices.json)나 관리자 로그인 토큰일 때만 내용을 준다.
 *         계약(응답 필드·예시)은 client/js/ocean-map/coastal-risk/briefing.contract.md.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/station_briefing.js(forDefault — 생성·저장·설정) · advisory/displayControl.js(isAdminDevice — 특보 예측 표출 제어와 같은 기기 판정)
 *                    · services/beach_weather.js(linesForSpots — 연안 카드 해수욕장 안내 줄 beach, 응답 때 붙임 · 설계서 §18)
 *                    · services/admin_auth.js(verifyToken·requireAdminToken — 관리자 API 인증, 쓸 때 require)
 *  - 서버 API      : GET /api/station-briefing/stations · GET /api/station-briefing/areas(관할 구역 — 설정 화면 지도) · GET /api/station-briefing
 *                    GET /api/station-briefing/now(「지금 밀집」만 — 화면이 1분마다, since 가 같으면 unchanged, §11.10.24)
 *                    GET·PUT /api/admin/station-briefing/config · GET /api/admin/station-briefing/status(?only=progress — 진행 게이지용 가벼운 응답) · POST /api/admin/station-briefing/run
 *                    GET /api/admin/station-briefing/stations · GET /api/admin/station-briefing/preview(관리자 미리보기 — 노출 범위와 무관)
 *                    POST /api/admin/station-briefing/download(오류 md 를 잠깐 맡기고 한 번 쓰는 열쇠를 받음) · GET /api/station-briefing/download/:token(그 열쇠로 파일 한 번 받기 — 앱 안 WebView 는
 *                    내려받기를 못 해 시스템 브라우저로 이 주소를 연다, §11.10.7. 관리자 머리글을 못 붙이므로 관리자 경로 밖이고, 열쇠 = 128비트 무작위·5분·한 번)
 *  - 마크업        : 없음(화면: client/js/forecast/station-briefing/ · client/js/admin/admin_station_briefing.js)
 *  - 나를 쓰는 곳  : server.js(app.use) · scripts/test_station_briefing.js(가짜 서비스·판정) · scripts/test_station_briefing_ui.js(화면 시험)
 * [로드 순서] server.js 에서 routes/admin 보다 먼저 등록한다(관리자 경로 인증을 이 라우터가 직접 건다 — routes/risk_errors 와 같은 관례).
 * ============================================================================
 */
'use strict';
const express = require('express'), crypto = require('crypto'), R = require('../services/station_briefing_rules');   // R.nextPublishAt(§11.10.9 ⑦)
// 앱 안(Capacitor WebView)용 md 내려받기 중계(§11.10.7) — admin_collect 의 PNG·CSV 저장(routes/usage.js /api/stats/usage/image)과 같은 원리: 맡기고 → 열쇠 → 시스템 브라우저가 GET.
// 메모리에만 5분, 한 번 받으면 지운다. 크기 상한: 오류 보관 상한 5,000건 × 한 줄 수백 바이트 ≈ 수 MB 라 5MB(전역 express.json 상한과 같다).
const DOWNLOAD_TTL_MS = 5 * 60000, DOWNLOAD_MAX = 20;

/**
 * 라우터를 만든다(시험은 서비스·기기 판정·토큰 확인·인증 미들웨어를 바꿔 넣는다).
 * 예: createRouter({service: 가짜, isAdminDevice: id=>id==='t1', verifyToken: ()=>false, authorize: (q,s,n)=>n()}) · clock = 지금(ms — 시험이 가짜 시계로, nextPublishAt)
 * @param {object} o @returns {Router} [연계] ← server.js / → station_briefing.decideExposure·pick
 */
function createRouter({
    service = null,
    isAdminDevice = (id) => require('../advisory/displayControl').isAdminDevice(id),
    verifyToken = (t) => require('../services/admin_auth').verifyToken(t),
    authorize = (req, res, next) => require('../services/admin_auth').requireAdminToken(req, res, next),
    nowLine = null,
    clock = () => Date.now(),
    beachLines = (ids, date) => require('../services/beach_weather').forDefault().linesForSpots(ids, date),
} = {}) {
    const router = express.Router(), SB = require('../services/station_briefing'), downloads = new Map();   // token → {name, text, exp}
    const svc = () => service || SB.forDefault();
    /** 요청에서 기기 식별(관리자 기기 판정용)·관리자 토큰을 꺼낸다 — advisoryPrediction 과 같은 이름(adminToken·endpoint 쿼리, X-Admin-Device·X-Admin-Token 헤더). */
    const who = (req) => ({ deviceId: (req.query && (req.query.adminToken || req.query.endpoint)) || req.get('X-Admin-Device') || '', adminToken: req.get('X-Admin-Token') || (req.query && req.query.adminAuthToken) || '' });
    const gate = (req) => SB.decideExposure(svc().readConfig().exposure, who(req), { isAdminDevice, verifyToken });
    /** 브리핑 연안 카드 관광지마다 해수욕장 안내 줄(§18). 실패하면 빈 표(브리핑은 그대로). 예: beachOf({date:'2026-10-18', briefing:{land:{cards:[{link:{spotId:'a'}}]}}}) → {a:[{kind,text,name,concl}]}(§18.11) */
    const beachOf = (r) => { try { const ids = ((r && r.briefing && r.briefing.land && r.briefing.land.cards) || []).map((c) => c && c.link && c.link.spotId).filter(Boolean); return ids.length ? beachLines(ids, r.date) || {} : {}; } catch (_) { console.error('[station_briefing] 해수욕장 안내 줄 실패'); return {}; } };
    const fail = (res, e) => res.status(e.status || 500).set('Cache-Control', 'no-store').json({ ok: false, error: e.status ? e.message : '브리핑 처리 실패' });

    router.get('/api/station-briefing/stations', (req, res) => {
        try { const g = gate(req); res.set('Cache-Control', 'no-store').json({ ok: true, audience: g.audience, display: g.display, stations: g.display ? svc().stationList() : [] }); } catch (e) { fail(res, e); }
    });
    // 설정 화면 「지도에서 선택하기」의 관할 구역(2026-10-17) — 관할 목록과 같은 노출 판정. 지도 탭을 열 때만 부른다(약 158KB, 압축 약 33KB).
    router.get('/api/station-briefing/areas', (req, res) => {
        try { const g = gate(req); res.set('Cache-Control', 'no-store').json({ ok: true, audience: g.audience, display: g.display, areas: g.display ? svc().stationAreas() : [] }); } catch (e) { fail(res, e); }
    });
    router.get('/api/station-briefing', (req, res) => {
        try {
            const g = gate(req), key = req.query.station, day = req.query.day || 'auto';
            res.set('Cache-Control', 'no-store');
            if (!g.display) return res.json({ ok: true, audience: g.audience, display: false, briefing: null });
            if (typeof key !== 'string' || !key) return res.status(400).json({ ok: false, error: '관할(station) 필요' });
            if (!['auto', 'today', 'tomorrow'].includes(day)) return res.status(400).json({ ok: false, error: 'day 는 auto·today·tomorrow' });
            if (!svc().stations().some((s) => s.key === key)) return res.status(404).json({ ok: false, error: '관할 없음' });
            const r = svc().pick({ key, day });
            let now = null; try { now = nowLine ? nowLine(key, r) : null; } catch (_) { now = null; }
            // beach(설계서 §18, 2026-10-18) = 연안 카드 관광지 id → 해수욕장 안내 줄(개장·입수 참고). 저장된 판은 고치지 않고 응답 때 붙인다(늘 최신 예보·수온 — AI 입력에는 없음).
            const beach = beachOf(r);
            // nextPublishAt(§11.10.9 ⑦) = 다음 정시 판 공개 시각 — 화면 머리 「(다음 브리핑 갱신 HH:MM 또는 특보 변경 시)」
            res.json({ ok: true, audience: g.audience, display: true, ...r, now, beach, nextPublishAt: R.nextPublishAt(clock()) });
        } catch (e) { fail(res, e); }
    });
    // 「지금 밀집」만 다시(§11.10.24 — 2026-10-18 사용자 *"실시간으로 데이터를 업데이트 시킬 수 있는 거 아닌가? … 시간도 계속 바뀌어가면서"*).
    //   화면이 브리핑을 보고 있는 동안 1분마다 부른다 — 브리핑 본문 없이 now 만. since = 화면이 가진 now.at(실시간 선박 자료 시각).
    //   실시간 자료 시각이 그대로면 {unchanged:true}(관할 척수 계산을 하지 않는다), 바뀌었으면 브리핑 GET 과 같은 now(nowLine 같은 함수), 낡았거나 오늘 판이 아니면 null.
    router.get('/api/station-briefing/now', (req, res) => {
        try {
            const g = gate(req), key = req.query.station, day = req.query.day || 'auto', since = typeof req.query.since === 'string' ? req.query.since : '';
            res.set('Cache-Control', 'no-store');
            if (!g.display) return res.json({ ok: true, audience: g.audience, display: false, now: null });
            if (typeof key !== 'string' || !key) return res.status(400).json({ ok: false, error: '관할(station) 필요' });
            if (!['auto', 'today', 'tomorrow'].includes(day)) return res.status(400).json({ ok: false, error: 'day 는 auto·today·tomorrow' });
            if (!svc().stations().some((s) => s.key === key)) return res.status(404).json({ ok: false, error: '관할 없음' });
            let now = null; try { now = nowLine ? nowLine(key, svc().pick({ key, day }), { since }) : null; } catch (_) { now = null; }
            res.json({ ok: true, audience: g.audience, display: true, now });
        } catch (e) { fail(res, e); }
    });
    // 오류 md 한 번 받기(§11.10.7 — 앱 안에서 [md로 저장]). 열쇠가 없거나 지났으면 404 글.
    router.get('/api/station-briefing/download/:token', (req, res) => {
        const now = Date.now(), d = downloads.get(String(req.params.token || ''));
        for (const [k, v] of downloads) if (v.exp < now) downloads.delete(k);
        res.set('Cache-Control', 'no-store');
        if (!d || d.exp < now) return res.status(404).type('text/plain; charset=utf-8').send('파일이 만료됐거나 이미 받았습니다 — 관리자 화면에서 [md로 저장]을 다시 누르세요.');
        downloads.delete(String(req.params.token));
        res.set('Content-Type', 'text/markdown; charset=utf-8').set('Content-Disposition', "attachment; filename=\"" + d.name + "\"; filename*=UTF-8''" + encodeURIComponent(d.name)).send(d.text);
    });
    const admin = '/api/admin/station-briefing';
    router.use(admin, authorize);
    router.get(admin + '/config', (req, res) => { try { const s = svc().status(); res.set('Cache-Control', 'no-store').json({ ok: true, config: s.config, choices: s.choices }); } catch (e) { fail(res, e); } });
    // 「AI 브리핑」 탭의 관할 하나 미리보기(화면 2단계, 2026-10-16) — 노출 범위가 「노출 안 함」이어도 관리자는 목록·브리핑을 본다(공개 경로는 노출 판정을 거친다).
    router.get(admin + '/stations', (req, res) => { try { res.set('Cache-Control', 'no-store').json({ ok: true, stations: svc().stationList() }); } catch (e) { fail(res, e); } });
    router.get(admin + '/preview', (req, res) => {
        try {
            const key = req.query.station, day = req.query.day || 'auto';
            res.set('Cache-Control', 'no-store');
            if (typeof key !== 'string' || !key) return res.status(400).json({ ok: false, error: '관할(station) 필요' });
            if (!['auto', 'today', 'tomorrow'].includes(day)) return res.status(400).json({ ok: false, error: 'day 는 auto·today·tomorrow' });
            if (!svc().stations().some((s) => s.key === key)) return res.status(404).json({ ok: false, error: '관할 없음' });
            const r = svc().pick({ key, day, withPending: true });
            res.json({ ok: true, ...r, beach: beachOf(r), nextPublishAt: R.nextPublishAt(clock()) });   // 공개 예정 판(§11.10.4)이 있으면 그것을 「예정」으로(pending·publishAt)
        } catch (e) { fail(res, e); }
    });
    router.put(admin + '/config', express.json({ limit: '8kb' }), (req, res) => { try { res.json({ ok: true, config: svc().writeConfig(req.body || {}) }); } catch (e) { fail(res, e); } });
    // ?only=progress — 진행 게이지가 실행 중 2.5초마다 부른다(§11.10.7). 전체 status 는 최근 3일 오류 전부를 실어 무거워 진행만 준다.
    router.get(admin + '/status', (req, res) => { try { res.set('Cache-Control', 'no-store').json({ ok: true, ...(req.query.only === 'progress' ? svc().progressNow() : svc().status()) }); } catch (e) { fail(res, e); } });
    // 오류 md 맡기기(§11.10.7) — {name:'station_briefing_errors_20261017_1831.md', text} → {token}. 이름은 영문·숫자·_-. 와 .md 만(머리글에 그대로 넣으므로).
    router.post(admin + '/download', express.json({ limit: '5mb' }), (req, res) => {
        try {
            const b = req.body || {}, name = typeof b.name === 'string' && /^[A-Za-z0-9_.-]{1,80}\.md$/.test(b.name) ? b.name : 'station_briefing_errors.md';
            if (typeof b.text !== 'string' || !b.text) return res.status(400).json({ ok: false, error: '글(text) 필요' });
            const now = Date.now(); for (const [k, v] of downloads) if (v.exp < now) downloads.delete(k);
            while (downloads.size >= DOWNLOAD_MAX) downloads.delete(downloads.keys().next().value);   // 오래된 것부터 — 메모리 안전망
            const token = crypto.randomBytes(16).toString('hex'); downloads.set(token, { name, text: b.text, exp: now + DOWNLOAD_TTL_MS });
            res.set('Cache-Control', 'no-store').json({ ok: true, token, path: '/api/station-briefing/download/' + token, expiresInSec: DOWNLOAD_TTL_MS / 1000 });
        } catch (e) { fail(res, e); }
    });
    // 실행 중이면 409 + 지금 상태(독립 검토 B11) — 예전에는 202 「시작함」이라고 답하고 실제로는 건너뛰었다.
    router.post(admin + '/run', (req, res) => {
        try {
            const st = svc().status();
            if (st.running) return res.status(409).set('Cache-Control', 'no-store').json({ ok: false, started: false, running: true, error: '이미 실행 중', lastRun: st.lastRun || null });
            const p = svc().run({ kind: 'manual' });
            p.then((r) => { if (r && r.skipped) console.warn('[station_briefing] 관리자 실행 건너뜀: ' + r.skipped); }, (e) => console.error('[station_briefing] 관리자 실행 실패:', e && e.message));
            res.status(202).json({ ok: true, started: true });
        } catch (e) { fail(res, e); }
    });
    return router;
}
/**
 * 「지금 밀집」 글 — 두 줄(줄바꿈 \n, 화면 .sb-now 는 white-space:pre-line). 2026-10-17 사용자 결정(설계서 §11.10.9): 원문 *"교통칸 6개는 … 이해가 잘 안 되잖아 … 해역 격자 6개라고 하면 안 될까?
 * 적절한 표현이 있으면 그렇게 해도 돼"* → 「선박이 있는 해역 격자 N개」. gridCount = 실시간 선박 교통 응답(MTIS, sea_realtime_collector)에서 이 관할에 든 격자(GR4 칸, 0.025° — 약 2.3×2.8km) 줄 수
 * (marine_fusion.briefing current.gridCount = rows.length). 공단 응답은 배가 없는 칸을 보내지 않는다 — 2026-10-15 운영 응답 3,890칸 중 0척 칸 0개(traffic_history.design.md 정정 기록).
 * 둘째 줄은 14척 이상인 가장 붐비는 해역(있을 때만). 종전 「지금(20:45 기준) … 35척(교통 칸 7개) — … 27척으로 충돌·접촉 주의」 한 줄.
 * 예: nowLineText({at:'20:45', count:35, gridCount:7, busiest:{name:'죽변항 북서방 0.7해리 해역(69-9해구)', count:27}})
 *     → '20:45 기준 관할 해역 선박 35척 · 선박이 있는 해역 격자 7개\n죽변항 북서방 0.7해리 해역(69-9해구) 27척 — 충돌·접촉 주의' · 시각 없음 → '지금 관할 해역 선박 …'
 * @param {object} o - {at:'HH:MM'|'', count, gridCount, busiest:{name,count}|null} @returns {string} [연계] ← defaultNowLine · scripts/test_station_briefing.js
 */
function nowLineText({ at, count, gridCount, busiest }) {
    return (at ? at + ' 기준' : '지금') + ' 관할 해역 선박 ' + count + '척 · 선박이 있는 해역 격자 ' + gridCount + '개' + (busiest ? '\n' + busiest.name + ' ' + busiest.count + '척 — 충돌·접촉 주의' : '');
}
/**
 * 「지금 밀집」 한 줄(§11.6-8 Q6 — 브리핑을 열 때 규칙 문장, AI 없음, 오늘 판에서만). 해상 통합 briefing() 의 지금 척수를 쓴다. 글은 nowLineText(§11.10.9 — 두 줄).
 * 예: '14:05 기준 관할 해역 선박 37척 · 선박이 있는 해역 격자 12개\n한림항 북서방 1.2해리 해역(232-2해구) 18척 — 충돌·접촉 주의'
 * §11.10.24: o.since(화면이 가진 now.at)가 지금 실시간 자료 시각과 같고 자료가 정상이면 {unchanged:true, at} — GET /now 가 1분마다 불러도 관할 척수 계산은 새 자료 때만.
 * @param {string} key @param {object} r - pick 결과 @param {object} [o] - {since} @returns {object|null} [연계] ← 기본 라우터(GET 브리핑·GET /now) / → marine_fusion.tables(자료 시각)·briefing·nowLineText
 */
function defaultNowLine(key, r, o) {
    const SB = require('../services/station_briefing');
    const now = Date.now(); if (!r.briefing || r.date !== R.kstDate(now)) return null;
    const st = SB.forDefault().stations().find((s) => s.key === key); if (!st) return null;
    const { stores } = require('./risk_forecast');
    // §11.10.24 가벼운 다시 묻기(GET /now): 화면이 가진 자료 시각(since)과 실시간 자료 시각이 같고 자료가 정상이면 관할 척수를 다시 세지 않는다
    if (o && o.since) { const s = stores.marine.tables().status; if (s && s.status === 'ok' && (s.sourceAt || s.collectedAt) === o.since) return { unchanged: true, at: o.since }; }
    return nowLineFrom(stores.marine.briefing(st.idx, R.isoKst(now)));
}
/**
 * 해상 통합 관할 브리핑(marine_fusion.briefing) 결과 하나로 「지금 밀집」 객체를 만든다(순수 — 시험이 가짜 결과로 부른다).
 * §11.10.9 ⑥(2026-10-17 사용자 *"관할 해역 선박 27척 이렇게 나오는 부분에 하이퍼링크 처리해서 팝업으로 해당 관할이 나오고, 그 지도의 선박이 있는 격자를 표시한 뒤 그 격자 안에 선박수를 표출"*):
 *   cells = 같은 스냅숏의 선박이 있는 격자 [{id, box, count}](current.cells — 합 = count, 수 = gridCount), busiest.id = 가장 붐비는 해역 위치(point)가 든 격자 — 화면 팝업 지도가 그 격자를 깜빡인다.
 * 예: nowLineFrom({current:{status:'ok',count:35,gridCount:7,cells:[…],sourceAt:'2026-10-17T20:45:00+09:00'}, regions:[{location:'죽변항 북서방 0.7해리 해역(69-9해구)', point:{lon,lat}, current:{count:27}}]})
 *     → {at:'2026-10-17T20:45:00+09:00', count:35, gridCount:7, cells:[…], busiest:{name:'죽변항 …', count:27, id:'GR4_…'}, text:'20:45 기준 …\n죽변항 … 27척 — 충돌·접촉 주의'}
 * @param {object} b - marine_fusion.briefing 결과 @returns {object|null} 실시간 자료가 낡거나 없으면 null [연계] ← defaultNowLine / → nowLineText
 */
function nowLineFrom(b) {
    if (!b || !b.current || b.current.status !== 'ok' || b.current.count === null) return null;
    const busy = (b.regions || []).filter((x) => x.current && !x.current.harbor && x.current.count >= 14)   // 항구 칸(정박·계류)은 붐비는 해역이 아니다 — 2026-10-19 사용자 「예보 혼잡까지 전부」
        .sort((a, c) => c.current.count - a.current.count)[0];
    const at = (b.current.sourceAt || b.current.collectedAt || '').slice(11, 16), cells = Array.isArray(b.current.cells) ? b.current.cells : [];
    const p = busy && busy.point, cell = p ? cells.find((c) => p.lon >= c.box[0] && p.lon <= c.box[2] && p.lat >= c.box[1] && p.lat <= c.box[3]) : null;
    const busiest = busy ? { name: busy.location, count: busy.current.count, id: cell ? cell.id : null } : null;
    return { at: b.current.sourceAt || b.current.collectedAt || null, count: b.current.count, gridCount: b.current.gridCount, cells, busiest, text: nowLineText({ at, count: b.current.count, gridCount: b.current.gridCount, busiest }) };
}
const router = createRouter({ nowLine: defaultNowLine });
module.exports = router; module.exports.createRouter = createRouter; module.exports.nowLineText = nowLineText; module.exports.nowLineFrom = nowLineFrom;
