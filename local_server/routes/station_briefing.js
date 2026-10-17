/**
 * ============================================================================
 * 파일명: local_server/routes/station_briefing.js
 * 역할  : 「활동지점 안전 브리핑」 API — 관할 목록·관할 브리핑(노출 판정 거침)과 관리자 설정·상태·즉시 실행.
 *         노출 기본값은 「관리자에게만」: 관리자로 등록된 기기(admin_devices.json)나 관리자 로그인 토큰일 때만 내용을 준다.
 *         계약(응답 필드·예시)은 client/js/ocean-map/coastal-risk/briefing.contract.md.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/station_briefing.js(forDefault — 생성·저장·설정) · advisory/displayControl.js(isAdminDevice — 특보 예측 표출 제어와 같은 기기 판정)
 *                    · services/admin_auth.js(verifyToken·requireAdminToken — 관리자 API 인증, 쓸 때 require)
 *  - 서버 API      : GET /api/station-briefing/stations · GET /api/station-briefing/areas(관할 구역 — 설정 화면 지도) · GET /api/station-briefing
 *                    GET·PUT /api/admin/station-briefing/config · GET /api/admin/station-briefing/status · POST /api/admin/station-briefing/run
 *                    GET /api/admin/station-briefing/stations · GET /api/admin/station-briefing/preview(관리자 미리보기 — 노출 범위와 무관)
 *  - 마크업        : 없음(화면: client/js/forecast/station-briefing/ · client/js/admin/admin_station_briefing.js)
 *  - 나를 쓰는 곳  : server.js(app.use) · scripts/test_station_briefing.js(가짜 서비스·판정) · scripts/test_station_briefing_ui.js(화면 시험)
 * [로드 순서] server.js 에서 routes/admin 보다 먼저 등록한다(관리자 경로 인증을 이 라우터가 직접 건다 — routes/risk_errors 와 같은 관례).
 * ============================================================================
 */
'use strict';
const express = require('express');

/**
 * 라우터를 만든다(시험은 서비스·기기 판정·토큰 확인·인증 미들웨어를 바꿔 넣는다).
 * 예: createRouter({service: 가짜, isAdminDevice: id=>id==='t1', verifyToken: ()=>false, authorize: (q,s,n)=>n()})
 * @param {object} o @returns {Router} [연계] ← server.js / → station_briefing.decideExposure·pick
 */
function createRouter({
    service = null,
    isAdminDevice = (id) => require('../advisory/displayControl').isAdminDevice(id),
    verifyToken = (t) => require('../services/admin_auth').verifyToken(t),
    authorize = (req, res, next) => require('../services/admin_auth').requireAdminToken(req, res, next),
    nowLine = null,
} = {}) {
    const router = express.Router(), SB = require('../services/station_briefing');
    const svc = () => service || SB.forDefault();
    /** 요청에서 기기 식별(관리자 기기 판정용)·관리자 토큰을 꺼낸다 — advisoryPrediction 과 같은 이름(adminToken·endpoint 쿼리, X-Admin-Device·X-Admin-Token 헤더). */
    const who = (req) => ({ deviceId: (req.query && (req.query.adminToken || req.query.endpoint)) || req.get('X-Admin-Device') || '', adminToken: req.get('X-Admin-Token') || (req.query && req.query.adminAuthToken) || '' });
    const gate = (req) => SB.decideExposure(svc().readConfig().exposure, who(req), { isAdminDevice, verifyToken });
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
            res.json({ ok: true, audience: g.audience, display: true, ...r, now });
        } catch (e) { fail(res, e); }
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
            res.json({ ok: true, ...svc().pick({ key, day }) });
        } catch (e) { fail(res, e); }
    });
    router.put(admin + '/config', express.json({ limit: '8kb' }), (req, res) => { try { res.json({ ok: true, config: svc().writeConfig(req.body || {}) }); } catch (e) { fail(res, e); } });
    router.get(admin + '/status', (req, res) => { try { res.set('Cache-Control', 'no-store').json({ ok: true, ...svc().status() }); } catch (e) { fail(res, e); } });
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
 * 「지금 밀집」 한 줄(§11.6-8 Q6 — 브리핑을 열 때 규칙 문장, AI 없음, 오늘 판에서만). 해상 통합 briefing() 의 지금 척수를 쓴다.
 * 예: '지금(14:05 기준) 관할 해역 선박 37척(교통 칸 12개) — 한림항 북서방 1.2해리 해역(232-2해구) 18척으로 충돌·접촉 주의'
 * @param {string} key @param {object} r - pick 결과 @returns {object|null} [연계] ← 기본 라우터 / → marine_fusion.briefing
 */
function defaultNowLine(key, r) {
    const SB = require('../services/station_briefing'), R = require('../services/station_briefing_rules');
    const now = Date.now(); if (!r.briefing || r.date !== R.kstDate(now)) return null;
    const st = SB.forDefault().stations().find((s) => s.key === key); if (!st) return null;
    const { stores } = require('./risk_forecast'), b = stores.marine.briefing(st.idx, R.isoKst(now));
    if (!b.current || b.current.status !== 'ok' || b.current.count === null) return null;
    const busy = (b.regions || []).filter((x) => x.current && x.current.count >= 14).sort((a, c) => c.current.count - a.current.count)[0];
    const at = (b.current.sourceAt || b.current.collectedAt || '').slice(11, 16);
    return { at: b.current.sourceAt || b.current.collectedAt || null, count: b.current.count, gridCount: b.current.gridCount, busiest: busy ? { name: busy.location, count: busy.current.count } : null,
        text: '지금' + (at ? '(' + at + ' 기준)' : '') + ' 관할 해역 선박 ' + b.current.count + '척(교통 칸 ' + b.current.gridCount + '개)' + (busy ? ' — ' + busy.location + ' ' + busy.current.count + '척으로 충돌·접촉 주의' : '') };
}
const router = createRouter({ nowLine: defaultNowLine });
module.exports = router; module.exports.createRouter = createRouter;
