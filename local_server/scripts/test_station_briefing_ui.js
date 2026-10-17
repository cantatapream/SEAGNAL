/**
 * ============================================================================
 * 파일명: local_server/scripts/test_station_briefing_ui.js
 * 역할  : 「활동지점 안전 브리핑」 2단계(화면)를 실제 Chromium 으로 index2.html 전체를 띄워 눌러 본다 —
 *         (2026-10-17 §11.10.4 부터 화면 이름은 「연안 안전 브리핑」 — 이 첫 설명줄은 규칙집 검사 목록(gen_rulebook)이 그대로 옮겨 적는 줄이라 두었다)
 *         일반 기기(아코디언 없음 = 지금 화면) · 관리자 기기(아코디언·설정 흐름: 선택·건너뛰기·숨김·설정 팝업 재표시) ·
 *         본문 각 칸과 상태(해상만·자료 확인 불가·틀(AI 해설 없음)·브리핑 없음·다음 판 예정) · 「총평과 권고」 새 모양(결론·근거·권고·물때·AI 해설 — §11.10)과 옛 브리핑 문단 대체 · 서버 글은 textContent(HTML 문자열이 글자로) ·
 *         관할 고르기 탭 두 개(지도에서 선택하기 — 해역 단추·관할 폴리곤 지도 실제 클릭 · 파출소로 선택하기 — 지방청→경찰서→파출소 아코디언·찾기 펼침, 2026-10-17) ·
 *         관할을 누르면 가운데 확인 창(「○○해양경찰서 ○○파출소 — 이 관할을 선택하셨습니까? 저장하시겠습니까?」 [취소]·[저장] — 취소·Esc·바깥·뒤로가기는 되돌림, 늦은 click 무시, 2026-10-17) ·
 *         아래 단추 줄 없음 · 머리 오른쪽 [건너뛰기]/[취소] · 해상·연안 보기 두 칸 한 줄(360px) ·
 *         [위험예측에서 보기 ›] 로 위험예측 시트 열림 · N 뱃지 · [기준 상세] 창 · 관리자 「AI 브리핑」 탭(설정 저장·노출 범위 전환·지금 다시 만들기 409·미리보기·최근 3일 오류 목록 [복사]·[md로 저장]).
 *         §11.10.3(2026-10-17): (물때) 아래 (고립 주의) 「사고 지점(N개소)」 표 펼침 · 해상 근거 ▸ 미니 지도(관할 경계 + 칸·해구 테두리 깜빡임 — 접기·떼기·움직임 줄이기) · [기준 상세] 「해상 근거 읽는 법」.
 *         §11.10.4(2026-10-17): 제목 「HH:MM AI 연안 안전 브리핑」 · 「가」 모양(결론 → 분석 문단(이름표 AI 분석·규칙 분석) → 접힌 「연안/해상 분석 근거」 → (기상) → (물때)) · 칩 「연안 ○○ 필요」 ·
 *         지금 밀집 줄은 해상 분석 아래 · 관리자 미리보기 공개 예정 판 「예정」 · 오류 시도 번호 · 이름 바꿈.
 *         380px·1280px 스크린샷을 SB_SHOT_DIR(없으면 임시 폴더)에 남긴다(펼친 지도 briefing_sea_map_380.png · 고립 표 briefing_isolation_380.png · 새 모양 briefing_layout_380.png·briefing_layout_open_380.png 포함).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 시험 대상     : client/js/forecast/station-briefing/*.js(station_briefing_picker.js 고르기 탭 포함) · client/js/admin/admin_station_briefing.js · admin.js(AI 하위 탭) · settings.js(설정 팝업 칸)
 *                    · marine-life/risk-forecast/risk_forecast.js(RiskForecast.openAt·goTo) · ocean-map/bottom-sheet/ocean_bottom_sheet3.js(OS.tideGaugeHtml)
 *  - 서버          : 실제 routes/station_briefing.js(createRouter) + 실제 services/station_briefing.js(createService — 임시 폴더, 실행만 가짜)
 *                    · 실제 routes/risk_forecast.js + 가짜 위험예측 저장소. 브리핑 본문은 실제 규칙(station_briefing_rules.buildBriefing)으로 만든다.
 *  - 나를 쓰는 곳  : scripts/refactor/verify_all.sh SUITES
 * [로드 순서] 독립 검사. 3001 서버·외부 호출·실제 AI·카카오 없음 — 자체 express(임의 포트), 127.0.0.1 밖 요청은 모두 끊는다.
 *             시각 고정: 서버 시계와 브라우저 시계(page.clock.setFixedTime) 모두 2026-10-17 10:05 KST(과거) — 실행 시각과 무관.
 * [실행] NODE_PATH=/opt/node-tools/node_modules:/home/user/SEAGNAL/local_server/node_modules node local_server/scripts/test_station_briefing_ui.js
 * ============================================================================
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), express = require('express'), { chromium } = require('playwright-core');
const root = path.join(__dirname, '../..'), R = require('../services/station_briefing_rules'), SB = require('../services/station_briefing'), { createRouter } = require('../routes/station_briefing');
const RF = require('../routes/risk_forecast'), M = require('../services/marine_fusion'), T = require('../services/risk_time'), io = require('../services/risk_collector_io');
const I = require('../services/station_briefing_inputs');
// 화면의 splitAdvice(§11.10.9 ⑤)를 vm 으로 읽어 기대값을 만든다(마지막 「따라서 …」 → (권고) 줄)
const SPLIT = (() => { const sb = { window: {} }; require('vm').runInNewContext(fs.readFileSync(path.join(__dirname, '../../client/js/forecast/station-briefing/station_briefing_render.js'), 'utf8'), sb); return sb.window.StationBriefingRender.splitAdvice; })();
// (기상) 칸 입력(§11.10.1) — 단기 해상예보는 loadCoastalForecasts 꼴(시험값), 단기 전망은 사용자가 붙여 준 10-17 제주 통보문(고정 자료 그대로)
const REGIONAL = { coastal: { 제주도서부앞바다: { officeName: '제주지방기상청', publishTime: '10.17. 05:00', periods: [
    { date: '20261017', period: 'am', weather: '구름많음', waveHeight: '0.5~1.5', wind: '동~남동 / 7~11' }, { date: '20261017', period: 'pm', weather: '구름많음', waveHeight: '0.5~1.5', wind: '남동 / 7~11' }] } },
offices: { 184: { officeName: '제주지방기상청', bulletinPublishTime: '2026.10.17 04:40', summary: fs.readFileSync(path.join(__dirname, 'fixtures', 'station_briefing', 'jeju_bulletin_20261017.txt'), 'utf8') } }, zoneOffice: { 제주도서부앞바다: '184' } };
let pass = 0, fail = 0;
/** 사례 하나. 실패도 모두 찍고 끝에 요약. @param {string} name @param {function} fn [연계] ← 아래 시나리오 */
async function check(name, fn) { try { await fn(); console.log('✅', name); pass++; } catch (e) { console.error('❌', name, e && e.message); fail++; } }

const pad = (n) => String(n).padStart(2, '0'), at = (h, d = '2026-10-17') => `${d}T${pad(h)}:00:00+09:00`;
const clock = { now: Date.parse('2026-10-17T10:05:00+09:00') };
const HALLIM = '제주해양경찰서|한림파출소', AEWOL = '제주해양경찰서|애월파출소', MOKPO = '목포해양경찰서|남항파출소', BUSAN = '부산해양경찰서|남항파출소';
const XSS = '<img src=x onerror="window.__xss=1">';
const SHOT = process.env.SB_SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'sb-shot-'));
fs.mkdirSync(SHOT, { recursive: true });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ui-'));
const CELL = { id: 'GR4_F4K23_P4', lat: 33.5625, lon: 126.5375 };

/** 한림파출소 입력(가짜 숫자 — test_station_briefing.js 의 고정 자료와 같은 꼴, 첫 해역 칸만 위험예측 가짜 칸에 맞춤). @returns {Object} */
function hallimInput() {
    return {
        key: HALLIM, name: '한림파출소', office: '제주해양경찰서', region: '제주지방해양경찰청', seaOnly: false,
        location: { lat: 33.41, lon: 126.26, source: 'estimate', estimated: true }, sources: { accident: 'ok', congestion: 'ok', zoneForecasts: 'ok', warnings: 'ok' },
        sea: {
            reviewedCells: 52,
            regions: [
                { rid: 'A:1001', gridId: CELL.id, accidentGridId: '1001', lat: CELL.lat, lon: CELL.lon, haegu: { major: 232, sub: 2, label: '232-2' }, ref: { name: '화순항', distNm: 13.3, bearingWord: '북북서' }, zone: { name: '제주도서부앞바다', kind: 'main' }, zones: ['제주도서부앞바다'],
                    slots: { [at(15)]: { accident: '주의', congestion: { level: '높음', index: 12.3, at: at(15) } }, [at(18)]: { accident: '주의', congestion: null } }, history: { from: '2021-01-01', to: '2025-12-31', count: 18, topTypes: [{ type: '충돌', count: 7 }, { type: '침수', count: 5 }], death: 1, missing: 0 } },
                { rid: 'T:GR4_9', gridId: 'GR4_9', accidentGridId: null, lat: 33.48, lon: 126.33, haegu: { major: 232, sub: 3, label: '232-3' }, ref: { name: '제주', distNm: 7.0, bearingWord: '서' }, zone: { name: '제주도북부앞바다', kind: 'main' }, zones: ['제주도북부앞바다'],
                    slots: { [at(12)]: { accident: null, congestion: { level: '높음', index: 11, at: at(13) } } }, history: { count: 0 } },
            ],
            weather: { 232: { label: '대해구 232', rows: [[6, 0.8, 5], [9, 1.0, 6], [12, 1.4, 9], [15, 2.4, 13], [18, 2.6, 14], [21, 1.8, 10]].map(([h, wh, ws]) => ({ at: at(h), wh, ws })) } },
            warnings: [
                { zone: '제주도북부앞바다', kind: '앞바다', type: '풍랑', level: '주의보', state: '발효', effective: { start: '2026-10-16T21:00:00+09:00', end: '2026-10-16T21:00:00+09:00', range: false }, release: { start: at(6), end: at(9), range: true } },
                { zone: '제주도서부앞바다', kind: '앞바다', type: '풍랑', level: '주의보', state: '예비', effective: { start: at(21), end: '2026-10-18T00:00:00+09:00', range: true }, release: null },
            ],
        },
        places: [{ name: '비양도', lat: 33.4067, lon: 126.2275 }, { name: '협재해수욕장', lat: 33.394, lon: 126.239 }, { name: '한림항', lat: 33.414, lon: 126.264 }],
        land: {
            spots: [
                { id: '50110|협재해수욕장', name: '협재해수욕장', lat: 33.394, lon: 126.239, beach: true, index: 72, band: '높음', peakAt: at(15), people: { ratio: 1.8, score: 0.82 }, event: null, swell: null, rip: null, notices: { effective: [], prelim: [], windMs: 9 }, hazard: { count: 4, byType: [{ class: '사망사고 발생구역', count: 1 }, { class: '연안사고 위험구역', count: 3 }] }, history: { count: 6, from: '2020-01-01', to: '2024-12-31', topTypes: [{ type: '표류', count: 4 }] }, missing: [] },
                { id: '50110|한림항', name: '한림항', lat: 33.414, lon: 126.264, beach: false, index: 30, band: '다소 높음', peakAt: at(6), people: { ratio: 0.9, score: 0 }, event: null, swell: null, rip: null, notices: { effective: [], prelim: [], windMs: null }, hazard: { count: 3, byType: [{ class: '사망사고 발생구역', count: 3 }] }, history: { count: 2, from: '2020-01-01', to: '2024-12-31', topTypes: [{ type: '추락', count: 2 }] }, missing: [] },
            ],
            hazardOnly: [{ id: '한림-9', place: '한림항 방파제', class: '사망사고 발생구역', shape: '방파제', lat: 33.415, lon: 126.262 }],
        },
        tide: { anchorId: 'J7', distKm: 3.2, date: '2026-10-17', region: 'jeju', curve: [], peaks: [{ type: 'high', t: '00:50', cm: 210 }, { type: 'low', t: '06:12', cm: 20 }, { type: 'high', t: '12:30', cm: 200 }, { type: 'low', t: '18:40', cm: 25 }], prevPeak: { type: 'low', t: '18:20', cm: 22 }, nextPeak: { type: 'high', t: '00:55', cm: 205 }, rocks: { count: 1, first: '07:10', last: '18:40' } },
    };
}
/**
 * §11.10.3 재료를 한림 입력에 덧붙인다 — 실제 한림 관할 도형(정리판 → areaOf), 해역 칸 상자, 대해구 232 상자, 해양사고 위험예보만 '주의'인 해역 하나(해구 예보가 없는 대해구 231 — 기상 근거가 겹치지 않게,
 * 지속 칸이 1칸이라 첫 해역 카드는 그대로 A:1001 — 바로가기 시험), 관광지 고립 사고 수.
 * 예: mapInputs(hallimInput()) → {..., area:[[[…]]], sea:{regions:[…box], weather:{232:{box}}}, land:{spots:[…isolation]}}
 * @param {Object} inp @returns {Object} [연계] ← makeBriefings(한림만)
 */
function mapInputs(inp) {
    const hl = I.loadStations().find((s) => s.name === '한림파출소'), sq = (lon, lat) => [lon - 0.0125, lat - 0.0125, lon + 0.0125, lat + 0.0125];
    const regions = inp.sea.regions.map((r) => ({ ...r, box: r.rid === 'A:1001' ? [126.525, 33.55, 126.55, 33.575] : sq(r.lon, r.lat) }))
        .concat([{ rid: 'A:1003', gridId: null, accidentGridId: '1003', lat: 33.35, lon: 126.2, box: [126.18, 33.33, 126.22, 33.37], haegu: { major: 231, sub: 6, label: '231-6' }, ref: { name: '모슬포', distNm: 6.0, bearingWord: '북서' }, zone: null, zones: [], slots: { [at(9)]: { accident: '주의' } }, history: { count: 0 } }]);
    const iso = { '50110|협재해수욕장': 2, '50110|한림항': 1 };
    return { ...inp, area: I.areaOf(hl.geometry), sea: { ...inp.sea, regions, weather: { 232: { ...inp.sea.weather[232], box: I.haeguBox(232) } } },
        land: { ...inp.land, spots: inp.land.spots.map((x) => ({ ...x, isolation: iso[x.id] || 0 })) } };
}
const WIN = R.editionWindow('morning', Date.parse(at(8)));
/** 날짜 파일 하나를 쓴다(실제 서비스가 pick 으로 읽는다). @param {string} date @param {Object} stations [연계] ← 준비 */
function writeDay(date, stations) { fs.writeFileSync(path.join(dir, 'briefings_' + date + '.json'), JSON.stringify({ date, stations })); }
function makeBriefings() {
    const h = R.buildBriefing({ ...mapInputs(hallimInput()), zoneWeather: I.collectZoneWeather({ lat: 33.41, lon: 126.26 }, REGIONAL) }, WIN, { generatedAt: '2026-10-17T13:10:00+09:00' });
    h.trigger = { kind: 'warning', zones: ['제주도서부앞바다'] }; h.edition = 'warning';
    // AI 분석 문단(§11.10.4 — 3~5문장). 해상 분석에 HTML 문자열을 넣어 textContent 로만 들어가는지 본다.
    h.overview = { land: '협재해수욕장은 방문객이 평소의 1.8배로 예상돼 주의 필요 수준입니다. 해안 바람 9m/s로 튜브가 떠밀릴 수 있습니다. 따라서 협재해수욕장 주변 연안사고에 주의가 필요합니다.', sea: XSS + ' 15시부터 파고가 높아집니다. 21시부터 예비특보 구역에 들어갑니다. 따라서 비양도 주변 해역 운항에 주의가 필요합니다.', source: 'chatgpt', model: 'gpt-6-luna' };
    h.sea.cards[0].sentence = XSS + h.sea.cards[0].sentence;
    const busanIn = { ...hallimInput(), zoneWeather: null, key: BUSAN, name: '남항파출소', office: '부산해양경찰서', region: '남해지방해양경찰청', sources: { accident: 'ok', congestion: 'stale', zoneForecasts: 'stale', warnings: 'ok' }, tide: null,
        sea: { reviewedCells: 30, regions: [], weather: {}, warnings: [] }, land: { spots: [], hazardOnly: [{ id: '남항-1', place: '남항 물양장', class: '연안사고 위험구역', shape: '항포구' }] }, places: [] };
    const b = R.buildBriefing(busanIn, WIN, { generatedAt: '2026-10-17T07:10:00+09:00' }); b.trigger = { kind: 'morning' }; b.publishAt = '2026-10-17T07:30:00+09:00';   // §11.10.4 새 판 꼴(07:10 만들기 → 07:30 공개)
    const mokpoIn = { ...hallimInput(), key: MOKPO, name: '남항파출소', office: '목포해양경찰서', region: '서해지방해양경찰청', seaOnly: true, land: null, tide: null };
    const m = R.buildBriefing(mokpoIn, WIN, { generatedAt: at(8) }); m.trigger = { kind: 'morning' };
    return { h, b, m };
}

(async () => {
    let browser, server; const B = makeBriefings();
    try {
        writeDay('2026-10-17', { [HALLIM]: B.h, [BUSAN]: B.b, [MOKPO]: B.m });
        const stationsFx = [
            { key: HALLIM, name: '한림파출소', office: '제주해양경찰서', region: '제주지방해양경찰청', seaOnly: false, idx: 0 },
            { key: AEWOL, name: '애월파출소', office: '제주해양경찰서', region: '제주지방해양경찰청', seaOnly: false, idx: 1 },
            { key: BUSAN, name: '남항파출소', office: '부산해양경찰서', region: '남해지방해양경찰청', seaOnly: false, idx: 2 },
            { key: MOKPO, name: '남항파출소', office: '목포해양경찰서', region: '서해지방해양경찰청', seaOnly: true, idx: 3 },
        ];
        // 고르기 지도(2026-10-17)용 관할 폴리곤 — 실제 정리판(coastguard_stations.geojson)의 같은 관할 도형을 붙인다(해역 규칙도 실제 특보구역 도형으로 돈다).
        //   애월파출소는 정리판에 없는 시험용 관할이라 도형이 없다 → 「지도에 구역이 없는 관할」 경로(목록 탭으로만 고름)를 함께 본다.
        const realSt = I.loadStations(); stationsFx.forEach((s) => { const r = realSt.find((x) => x.key === s.key); if (r) s.geometry = r.geometry; });
        assert.deepEqual(stationsFx.filter((s) => !s.geometry).map((s) => s.key), [AEWOL]);
        // 지금 밀집 격자(§11.10.9 ⑥ — routes nowLineFrom 꼴: 같은 스냅숏의 선박이 있는 격자, 합 37척) — 한림 앞바다 근처 상자(시험값)
        const NOW_CELLS = { cells: [{ id: 'GR4_A', box: [126.2, 33.4, 126.225, 33.425], count: 18 }, { id: 'GR4_B', box: [126.225, 33.4, 126.25, 33.425], count: 12 }, { id: 'GR4_C', box: [126.15, 33.375, 126.175, 33.4], count: 7 }], busiest: { name: '한림항 북서방 1.2해리 해역(232-2해구)', count: 18, id: 'GR4_A' } };
        const real = SB.createService({ dir, clock: () => clock.now, loadStations: () => stationsFx });
        const ctl = { running: false, runs: 0 };
        const service = { ...real, run: async () => { ctl.runs++; return { ok: true }; }, status: () => ({ ...real.status(), running: ctl.running, progress: ctl.running ? ctl.progress || null : null }), progressNow: () => ({ running: ctl.running, progress: ctl.running ? ctl.progress || null : null }) };
        const reqLog = [];
        const sbRouter = createRouter({ service, isAdminDevice: (id) => id === 'admin-push-token', verifyToken: (t) => t === 'admin-login',
            authorize: (req, res, next) => req.get('X-Admin-Token') === 'admin-login' ? next() : res.status(401).json({ ok: false, error: '관리자 인증 필요' }),
            clock: () => clock.now,   // nextPublishAt(§11.10.9 ⑦)도 가짜 시계로
            nowLine: (key, r) => key === HALLIM && r.briefing ? { at: '2026-10-17T10:00:00+09:00', count: 37, gridCount: 12, busiest: null, text: '10:00 기준 관할 해역 선박 37척 · 선박이 있는 해역 격자 12개\n한림항 북서방 1.2해리 해역(232-2해구) 18척 — 충돌·접촉 주의', ...NOW_CELLS } : null });

        // ── 위험예측 가짜 저장소(test_life_safety_tab_keep.js 와 같은 꼴) — 바로가기가 실제 위험예측 화면·시트를 연다 ──
        const geometry = { type: 'Polygon', coordinates: [[[126.525, 33.55], [126.55, 33.55], [126.55, 33.575], [126.525, 33.575], [126.525, 33.55]]] };
        const cell = { id: CELL.id, i: 0, lat: CELL.lat, lon: CELL.lon, geometry, haegu: { label: '232-2', major: 232, sub: 2 }, ref: { name: '화순항', bearingWord: '북북서', distNm: 13.3 } }, acc = { ...cell, id: '1001' };
        const at0 = T.isoKst(clock.now);
        io.write(path.join(dir, 'sea_realtime.json.gz'), { v: 'v1', cells: [cell], rows: [[0, 21, .2]], collectedAt: at0, sourceAt: null, source: 'MTIS realtime API' });
        const frames = {}; for (const t of T.timeline(clock.now, 3, 3, 21)) frames[t.slice(0, 13).replace(/[-T]/g, '') + '00'] = [[0, .002, '주의']];
        const inputs = { version: 1, cells: { cells: [cell] }, congestion: { frames: {} }, accident: { cells: [acc], frames }, sources: { accident: { status: 'ok' }, congestion: { status: 'ok' }, zoneForecasts: { status: 'ok' } }, weather: () => ({ wh: 2, ws: 12, wp: 4, wd: 241, forecastAt: at0 }) };
        const ring = (x, y) => [[x, y], [x + .01, y], [x + .01, y + .01], [x, y + .01], [x, y]];
        const spots = [{ id: '50110|협재해수욕장', i: 0, lat: 33.394, lon: 126.239, name: '협재해수욕장', cell: ring(126.234, 33.389) }];
        const store = { sources: () => inputs.sources, marineInputs: () => inputs,
            meta: () => { const a = { coast: T.timeline(clock.now, 3, 2, 21), sea: T.timeline(clock.now, 1, 2, 23) }; return { now: T.isoKst(clock.now), versions: { spots: 'v1', cells: 1, accident: 'v1' }, timeline: { sea: { times: a.sea }, accident: { times: a.coast }, coast: { times: a.coast } }, sources: inputs.sources }; },
            spots: () => ({ spots }), cells: () => ({ cells: [cell] }), accidentCells: () => ({ v: 'v1', cells: [acc] }), accidentFrame: () => ({ v: 'v1', cells: [[0, .001, '주의']] }),
            frame: (sea) => sea ? { cells: [[0, 0, 1, '낮음']], spots: [], borders: [] } : { spots: spots.map((s) => [s.i, 3]), borders: [] },
            coastDayFrame: () => ({ spots: spots.map((s) => [s.i, 3]), degraded: [] }),
            coastDayDetail: (id, t) => ({ title: '연안 ' + id, subtitle: { lat: 33.394, lon: 126.239 }, clickable: false, t }), islands: () => ({ features: [] }) };
        const marine = M.createStore({ risk: store, dir, clock: () => clock.now, stations: [{ properties: { name: '한림파출소' }, geometry }], accidents: [], describe: () => cell });

        const app = express();
        app.use((req, res, next) => { if (req.path.startsWith('/api/station-briefing') || req.path.startsWith('/api/admin/station-briefing')) reqLog.push({ path: req.path, q: req.query, dev: req.get('X-Admin-Device') || null, tok: req.get('X-Admin-Token') || null }); next(); });
        app.use(sbRouter);
        app.use(RF.createRouter({ store, marine }));
        app.get('/', (req, res) => res.sendFile(path.join(root, 'client/index2.html')));
        app.use(express.static(path.join(root, 'client')));
        app.use('/api', (req, res) => res.status(404).json({ ok: false }));
        server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r)); const base = 'http://127.0.0.1:' + server.address().port;

        // ── 서버 경로(브라우저 없이) — 관리자 미리보기 경로는 노출 범위와 무관, 토큰 없으면 401 ──
        const http = async (p, init) => { const r = await fetch(base + p, init); return { status: r.status, body: await r.json().catch(() => null) }; };
        await check('서버: 일반 요청은 display:false·빈 목록 · 관리자 기기(쿼리 adminToken)·관리자 토큰은 display:true', async () => {
            let r = await http('/api/station-briefing/stations'); assert.deepEqual([r.status, r.body.display, r.body.stations.length, r.body.audience], [200, false, 0, 'admin']);
            r = await http('/api/station-briefing/stations?adminToken=admin-push-token'); assert.deepEqual([r.body.display, r.body.stations.length], [true, 4]);
            r = await http('/api/station-briefing/stations', { headers: { 'X-Admin-Token': 'admin-login' } }); assert.equal(r.body.display, true);
            r = await http('/api/station-briefing?station=' + encodeURIComponent(HALLIM)); assert.deepEqual([r.body.display, r.body.briefing], [false, null]);
        });
        await check('서버: 관할 구역(/areas) — 일반 요청은 빈 목록, 관리자 기기는 관할마다 해역(seas)·폴리곤(소수 넷째 자리)', async () => {
            let r = await http('/api/station-briefing/areas'); assert.deepEqual([r.status, r.body.display, r.body.areas.length], [200, false, 0]);
            r = await http('/api/station-briefing/areas?adminToken=admin-push-token'); assert.equal(r.body.display, true);
            const seas = Object.fromEntries(r.body.areas.map((a) => [a.key, a.seas]));
            assert.deepEqual(seas, { [HALLIM]: ['제주'], [BUSAN]: ['남해'], [MOKPO]: ['서해'] }, JSON.stringify(seas) + ' — 도형 없는 애월은 빠짐');
            const flat = r.body.areas.flatMap((a) => a.geometry.coordinates.flat(Infinity)); assert.ok(flat.length > 8 && flat.every((v) => Math.round(v * 1e4) / 1e4 === v), '좌표 소수 넷째 자리');
        });
        await check('서버: 관리자 /stations·/preview — 토큰 없으면 401, 노출 「노출 안 함」이어도 관리자는 미리보기', async () => {
            assert.equal((await http('/api/admin/station-briefing/preview?station=' + encodeURIComponent(HALLIM))).status, 401);
            real.writeConfig({ exposure: 'off' });
            const hd = { headers: { 'X-Admin-Token': 'admin-login' } };
            const st = await http('/api/admin/station-briefing/stations', hd); assert.deepEqual([st.status, st.body.stations.length], [200, 4]);
            const pv = await http('/api/admin/station-briefing/preview?station=' + encodeURIComponent(HALLIM), hd); assert.deepEqual([pv.status, pv.body.briefing.key], [200, HALLIM]);
            assert.equal((await http('/api/admin/station-briefing/preview?station=없는곳', hd)).status, 404);
            assert.equal((await http('/api/admin/station-briefing/preview', hd)).status, 400);
            assert.equal((await http('/api/station-briefing/stations', { headers: { 'X-Admin-Token': 'admin-login' } })).body.display, false, '공개 경로는 노출 판정 그대로(off)');
            real.writeConfig({ exposure: 'admin' });
        });

        browser = await chromium.launch({ ...((process.env.PW_CHROME || process.env.SIM_CHROMIUM || process.env.CHROMIUM_EXECUTABLE) ? { executablePath: process.env.PW_CHROME || process.env.SIM_CHROMIUM || process.env.CHROMIUM_EXECUTABLE } : {}), headless: true, args: ['--no-sandbox'] });
        const errors = [];
        /** 이 시험이 주지 않는 자료(/api/weather-alerts 등) 때문에 뜨는 연결 끊김 팝업·스플래시를 치운다 — 스크린샷에 브리핑만 보이게. */
        const clean = (page) => page.evaluate(() => ['server-maintenance-popup', 'network-error-popup', 'splash-screen', 'main-notice-popup'].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); }));
        /** 새 기기(새 브라우저 문맥 — 저장소 비어 있음). admin 이면 관리자 모드 + 푸시 토큰(관리자 기기). @returns {Promise<Page>} */
        const device = async ({ admin = false, width = 412, height = 915, login = false } = {}) => {
            const ctx = await browser.newContext({ viewport: { width, height }, timezoneId: 'Asia/Seoul' }), page = await ctx.newPage();
            page.on('pageerror', (e) => errors.push(e.message));
            await page.route('**/*', (r) => r.request().url().startsWith(base) ? r.continue() : r.abort());
            await page.clock.setFixedTime(new Date(clock.now));
            await page.addInitScript(({ admin, login }) => { try { if (!sessionStorage.getItem('__sb_init')) { sessionStorage.setItem('__sb_init', '1'); if (admin) { localStorage.setItem('seagnal_admin_mode', 'true'); localStorage.setItem('push_token', 'admin-push-token'); } if (login) localStorage.setItem('seagnal_admin_token', 'admin-login'); } } catch (e) { /* 저장소 없음 */ } }, { admin, login });
            await page.goto(base + '/'); await page.waitForFunction(() => window.StationBriefing && typeof window.switchMainTab === 'function'); await page.waitForTimeout(900);
            await clean(page);
            return page;
        };
        /** 요소를 눌러 본다 — 화면 위 안내 팝업(점검·스플래시 등 이 시험이 띄우지 않는 덮개)에 가려지지 않게 DOM click(test_life_safety_tab_keep 과 같은 방식). */
        const tap = async (page, sel) => { await page.waitForSelector(sel); await page.evaluate((sel) => document.querySelector(sel).click(), sel); };
        /** 고르기 지도에서 관할 폴리곤 안쪽 점의 화면 좌표(지도를 화면 가운데로 스크롤한 뒤) — 실제 마우스로 누르기 위해. @returns {Promise<number[]>} */
        const polyPoint = async (pg, key) => {
            await pg.waitForFunction((k) => { const P = window.StationBriefingPicker, m = P && P._map(), l = P && P._layer(); return m && l && l.getSource().getFeatureById(k) && m.getSize() && m.getSize()[1] > 0; }, key, { timeout: 8000 });
            return pg.evaluate((k) => {
                const m = window.StationBriefingPicker._map(), g = window.StationBriefingPicker._layer().getSource().getFeatureById(k).getGeometry();
                m.getTargetElement().scrollIntoView({ block: 'center' }); m.renderSync();
                const c = g.getType() === 'Polygon' ? g.getInteriorPoint().getCoordinates() : g.getInteriorPoints().getCoordinates()[0], px = m.getPixelFromCoordinate([c[0], c[1]]), r = m.getTargetElement().getBoundingClientRect();
                return [r.left + px[0], r.top + px[1]];
            }, key);
        };
        const vis = (page, id) => page.evaluate((id) => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none' && !e.hidden; }, id);
        const content = (page) => page.evaluate(() => document.getElementById('station-briefing-content').innerText);
        const openAcc = async (page) => { await page.evaluate(() => { const b = document.getElementById('station-briefing-accordion-body'); if (b.classList.contains('collapsed')) window.toggleStationBriefingAccordion(); }); await page.waitForTimeout(400); };
        const pickStation = async (page, key, opts = {}) => {
            await page.evaluate(() => window.openStationBriefingSetup()); await page.waitForSelector('[data-sb-setup]');
            // 해상·연안 칸을 먼저 정하고(누르면 곧 확인 창 → 저장이라) 관할을 누른 뒤 가운데 확인 창의 [저장]
            if (opts.sea === false) await page.evaluate(() => { const c = document.querySelector('[data-sb-show="showSea"]'); c.checked = false; c.dispatchEvent(new Event('change')); });
            if (opts.land === false) await page.evaluate(() => { const c = document.querySelector('[data-sb-show="showLand"]'); c.checked = false; c.dispatchEvent(new Event('change')); });
            await page.evaluate((key) => document.querySelector('.sb-station-btn[data-key="' + key + '"]').click(), key);
            await page.waitForSelector('[data-sb-pick-dialog] [data-sb-save]');
            await page.evaluate(() => document.querySelector('[data-sb-pick-dialog] [data-sb-save]').click());
        };
        /** 가운데 확인 창 상태(없으면 null). @returns {Promise<Object|null>} */
        const dlgState = (pg) => pg.evaluate(() => {
            const d = document.querySelector('[data-sb-pick-dialog]'); if (!d) return null;
            const box = d.querySelector('[role="dialog"]');
            return { modal: box.getAttribute('aria-modal'), title: document.getElementById(box.getAttribute('aria-labelledby')).textContent, text: document.getElementById(box.getAttribute('aria-describedby')).textContent,
                buttons: [...box.querySelectorAll('button')].map((b) => b.textContent), focus: !!document.activeElement && document.activeElement.hasAttribute('data-sb-save'),
                stack: window.PopupStack ? window.PopupStack.list().includes('sb-pick-dialog') : null, note: (box.querySelector('.sb-dlg-note') || {}).textContent || '' };
        });

        // ── 1. 일반 기기 ──
        const logFrom = reqLog.length; let page = await device();
        await check('일반 기기 — 아코디언·⚙·설정 팝업 칸이 없다(지금 화면과 같음), 관리자 정보도 보내지 않는다', async () => {
            assert.equal(await vis(page, 'station-briefing-accordion-header'), false); assert.equal(await vis(page, 'station-briefing-accordion-body'), false);
            const mine = reqLog.slice(logFrom), last = mine.filter((r) => r.path === '/api/station-briefing/stations').pop(); assert.ok(last, '노출 판정을 물었다'); assert.equal(last.q.adminToken, undefined); assert.equal(last.tok, null);
            assert.equal(mine.some((r) => r.path === '/api/station-briefing'), false, '브리핑 본문은 묻지 않는다');
            await page.evaluate(() => window.openSettingsModal()); await page.waitForTimeout(400);
            assert.equal(await vis(page, 'station-briefing-settings'), false, '설정 팝업에도 칸이 없다');
            const order = await page.evaluate(() => [...document.querySelectorAll('#weather-alert-section > .main-accordion-header')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.id));
            assert.ok(!order.includes('station-briefing-accordion-header'));
        });
        await clean(page); await page.screenshot({ path: path.join(SHOT, 'general_412.png') });
        await page.context().close();

        // ── 2. 관리자 기기 — 설정 흐름 ──
        page = await device({ admin: true });
        await check('관리자 기기 — 「기상청 해상 기상 전망」 바로 아래 아코디언, 설정 전 안내 + [설정하기], ⚙ 숨김', async () => {
            assert.equal(await vis(page, 'station-briefing-accordion-header'), true);
            const prev = await page.evaluate(() => document.getElementById('station-briefing-accordion-header').previousElementSibling.id); assert.equal(prev, 'marine-forecast-accordion-body');
            const last = reqLog.filter((r) => r.path === '/api/station-briefing/stations').pop(); assert.equal(last.q.adminToken, 'admin-push-token', '특보 예측과 같은 adminToken 쿼리');
            assert.equal(await vis(page, 'station-briefing-settings-btn'), false);
            await openAcc(page); const t = await content(page); assert.ok(t.includes('연안 안전 브리핑 지역이 설정되지 않았습니다'), t); assert.ok(await page.$('#station-briefing-setup-btn'));
        });
        await check('설정 → 관할 목록이 경찰서별 묶음, 남항 두 곳은 경찰서로 구분, 해상만 표시 · 이름으로 찾기', async () => {
            await tap(page, '#station-briefing-setup-btn'); await page.waitForSelector('[data-sb-setup]');
            await tap(page, '[data-sb-tab="list"]');
            const offices = await page.$$eval('.sb-office', (e) => e.map((x) => x.textContent)); assert.deepEqual(offices, ['제주해양경찰서', '부산해양경찰서', '목포해양경찰서']);
            const namhang = await page.$$eval('.sb-station-btn', (e) => e.filter((x) => x.textContent.startsWith('남항파출소')).map((x) => x.dataset.key)); assert.deepEqual(namhang.sort(), [BUSAN, MOKPO].sort());
            assert.ok((await page.$eval('.sb-station-btn[data-key="' + MOKPO + '"]', (e) => e.textContent)).includes('해상만'));
            await page.fill('.sb-search', '애월'); assert.deepEqual(await page.$$eval('.sb-station-btn', (e) => e.map((x) => x.dataset.key)), [AEWOL]); await page.fill('.sb-search', '');
        });
        // ── 2-1. 관할 고르기 탭 두 개(2026-10-17 사용자 요청 — station_briefing_picker.js) ──
        const tabState = (pg) => pg.evaluate(() => [...document.querySelectorAll('[data-sb-setup] [role="tab"]')].map((t) => ({ k: t.dataset.sbTab, text: t.textContent, sel: t.getAttribute('aria-selected'), panelHidden: document.getElementById(t.getAttribute('aria-controls')).hidden, role: document.getElementById(t.getAttribute('aria-controls')).getAttribute('role') })));
        await check('고르기 탭 두 개 — role=tab·aria-selected, 처음은 「지도에서 선택하기」, 누르면 패널이 바뀐다', async () => {
            await page.evaluate(() => window.openStationBriefingSetup()); await page.waitForSelector('[data-sb-setup]');
            assert.equal(await page.$eval('[data-sb-setup] [role="tablist"]', (e) => e.getAttribute('aria-label')), '관할 고르는 방법');
            assert.deepEqual(await tabState(page), [{ k: 'map', text: '지도에서 선택하기', sel: 'true', panelHidden: false, role: 'tabpanel' }, { k: 'list', text: '파출소로 선택하기', sel: 'false', panelHidden: true, role: 'tabpanel' }]);
            await tap(page, '[data-sb-tab="list"]');
            assert.deepEqual((await tabState(page)).map((t) => [t.k, t.sel, t.panelHidden]), [['map', 'false', true], ['list', 'true', false]]);
            await tap(page, '[data-sb-tab="map"]');
            assert.deepEqual((await tabState(page)).map((t) => [t.k, t.sel, t.panelHidden]), [['map', 'true', false], ['list', 'false', true]]);
        });
        await check('「파출소로 선택하기」 — 지방청 아코디언(접힘) → 누르면 소속 해양경찰서 → 누르면 파출소 칩 → 칩을 눌러 고름', async () => {
            await tap(page, '[data-sb-tab="list"]');
            const st = () => page.evaluate(() => ({ regions: [...document.querySelectorAll('.sb-region')].map((b) => [b.textContent, b.getAttribute('aria-expanded'), document.getElementById(b.getAttribute('aria-controls')).hidden]),
                offices: [...document.querySelectorAll('.sb-office')].filter((b) => b.offsetParent).map((b) => [b.textContent, b.getAttribute('aria-expanded')]), chips: [...document.querySelectorAll('.sb-station-btn')].filter((b) => b.offsetParent).map((b) => b.dataset.key) }));
            let s = await st();
            assert.deepEqual(s.regions, [['제주지방해양경찰청', 'false', true], ['남해지방해양경찰청', 'false', true], ['서해지방해양경찰청', 'false', true]]); assert.deepEqual([s.offices, s.chips], [[], []], '처음엔 모두 접힘(고른 관할 없음)');
            await tap(page, '.sb-region[data-sb-acc="r|제주지방해양경찰청"]'); s = await st();
            assert.equal(s.regions[0][1], 'true'); assert.deepEqual(s.offices, [['제주해양경찰서', 'false']]); assert.deepEqual(s.chips, []);
            await tap(page, '.sb-office[data-sb-acc="o|제주지방해양경찰청|제주해양경찰서"]'); s = await st();
            assert.deepEqual(s.offices, [['제주해양경찰서', 'true']]); assert.deepEqual(s.chips, [HALLIM, AEWOL]);
            await tap(page, '.sb-station-btn[data-key="' + AEWOL + '"]');
            assert.equal(await page.$eval('.sb-picked', (e) => e.textContent), '선택: 애월파출소 · 제주해양경찰서');
            assert.equal(await page.$eval('.sb-station-btn[data-key="' + AEWOL + '"]', (e) => e.getAttribute('aria-pressed')), 'true');
            // 목록 탭도 지도 탭과 같은 가운데 확인 창(2026-10-17) — [취소]면 누르기 전(고른 것 없음)으로 돌아가 다른 관할을 누를 수 있다
            assert.deepEqual(await dlgState(page), { modal: 'true', title: '제주해양경찰서 애월파출소', text: '이 관할을 선택하셨습니까? 저장하시겠습니까?', buttons: ['취소', '저장'], focus: true, stack: true, note: '' });
            await tap(page, '[data-sb-pick-cancel]');
            assert.equal(await dlgState(page), null, '취소하면 창이 닫힌다');
            assert.equal(await page.$eval('.sb-picked', (e) => e.textContent), '선택한 관할 없음');
            assert.equal(await page.$eval('.sb-station-btn[data-key="' + AEWOL + '"]', (e) => e.getAttribute('aria-pressed')), 'false');
            assert.equal(await page.evaluate(() => (JSON.parse(localStorage.getItem('seagnal_station_briefing_v1') || '{}')).station || null), null, '저장하지 않았다');
            await tap(page, '.sb-region[data-sb-acc="r|제주지방해양경찰청"]'); s = await st(); assert.deepEqual([s.regions[0][1], s.chips], ['false', []], '다시 누르면 접힘');
        });
        await check('찾기 — 글자를 넣으면 맞는 지방청·경찰서가 저절로 펼쳐지고, 지우면 고른 관할 묶음만 펼친다', async () => {
            await page.fill('.sb-search', '남항');
            const r = await page.evaluate(() => ({ exp: [...document.querySelectorAll('.sb-acc-btn')].map((b) => [b.textContent, b.getAttribute('aria-expanded')]), chips: [...document.querySelectorAll('.sb-station-btn')].filter((b) => b.offsetParent).map((b) => b.dataset.key) }));
            assert.deepEqual(r.exp, [['남해지방해양경찰청', 'true'], ['부산해양경찰서', 'true'], ['서해지방해양경찰청', 'true'], ['목포해양경찰서', 'true']]); assert.deepEqual(r.chips, [BUSAN, MOKPO]);
            await page.fill('.sb-search', '');
            const e2 = await page.evaluate(() => [...document.querySelectorAll('.sb-acc-btn')].filter((b) => b.getAttribute('aria-expanded') === 'true').map((b) => b.textContent));
            assert.deepEqual(e2, [], '애월은 [취소]해 고른 관할이 없다 — 펼친 묶음 없음(고른 관할 묶음 펼침은 끝의 「다시 열어도 그대로」에서 본다)');
        });
        await page.setViewportSize({ width: 380, height: 844 }); await page.evaluate(() => document.querySelector('[data-sb-setup]').scrollIntoView()); await clean(page); await page.screenshot({ path: path.join(SHOT, 'picker_list_380.png') });
        await page.setViewportSize({ width: 412, height: 915 });
        await check('「지도에서 선택하기」 — 해역 단추 4개(온보딩과 같은 이름) → 제주 → 지도에 제주 관할 폴리곤(한림, 이름표 「한림」) · 도형 없는 애월은 목록 탭 안내', async () => {
            await tap(page, '[data-sb-tab="map"]');
            assert.deepEqual(await page.$$eval('.sb-sea-btn', (e) => e.map((x) => [x.dataset.sea, x.textContent])), [['동해', '🌅 동해 해역'], ['서해', '🌊 서해 해역'], ['남해', '🏖️ 남해 해역'], ['제주', '🍊 제주 해역']]);
            await tap(page, '.sb-sea-btn[data-sea="제주"]');
            await page.waitForFunction(() => { const l = window.StationBriefingPicker._layer(); return l && l.getSource().getFeatures().length; }, null, { timeout: 8000 });
            const r = await page.evaluate(() => ({ title: document.querySelector('[data-sb-panel="map"] .sb-pick-title').textContent, keys: window.StationBriefingPicker._layer().getSource().getFeatures().map((f) => f.get('key')).sort(), labels: window.StationBriefingPicker._layer().getSource().getFeatures().map((f) => f.get('label')).sort(), hint: document.querySelector('[data-sb-map-hint]').textContent, h: document.querySelector('[data-sb-map]').getBoundingClientRect().height }));
            assert.equal(r.title, '제주 파출소 관할을 선택해주세요'); assert.deepEqual(r.keys, [HALLIM]); assert.deepEqual(r.labels, ['한림']);
            assert.ok(r.h >= 240, '지도 높이 ' + r.h);
            assert.equal(r.hint, '아직 이 지도에서 고른 관할이 없습니다. 지도를 눌러 고르세요. (지도에 구역이 없는 관할 1곳은 「파출소로 선택하기」에서 고를 수 있습니다.)', '목록에서 고른 애월은 도형이 없어 지도에 없다');
        });
        const mapPickState = (pg) => pg.evaluate((k) => { const l = window.StationBriefingPicker._layer(), f = l.getSource().getFeatureById(k), st = l.getStyleFunction()(f); return { picked: document.querySelector('.sb-picked').textContent, hint: document.querySelector('[data-sb-map-hint]').textContent, chip: document.querySelector('.sb-station-btn[data-key="' + k + '"]').getAttribute('aria-pressed'), fill: st.getFill().getColor() }; }, HALLIM);
        const NOPICK = { picked: '선택한 관할 없음', hint: '아직 이 지도에서 고른 관할이 없습니다. 지도를 눌러 고르세요. (지도에 구역이 없는 관할 1곳은 「파출소로 선택하기」에서 고를 수 있습니다.)', chip: 'false', fill: 'rgba(13,24,48,0.10)' };
        await check('지도 폴리곤을 누르면(실제 지도 클릭) 칠해지고 가운데 확인 창 「제주해양경찰서 한림파출소 — 이 관할을 선택하셨습니까? 저장하시겠습니까?」 [취소] [저장](초점 [저장]·뒤로가기 등록)', async () => {
            const [x, y] = await polyPoint(page, HALLIM); await page.mouse.click(x, y);
            await page.waitForSelector('[data-sb-pick-dialog]', { timeout: 3000 });
            assert.deepEqual(await mapPickState(page), { picked: '선택: 한림파출소 · 제주해양경찰서', hint: '고른 관할: 한림파출소 · 제주해양경찰서 (지도에 구역이 없는 관할 1곳은 「파출소로 선택하기」에서 고를 수 있습니다.)', chip: 'true', fill: 'rgba(68,138,255,0.45)' });
            assert.deepEqual(await dlgState(page), { modal: 'true', title: '제주해양경찰서 한림파출소', text: '이 관할을 선택하셨습니까? 저장하시겠습니까?', buttons: ['취소', '저장'], focus: true, stack: true, note: '' });
            assert.equal(await page.evaluate(() => document.querySelectorAll('[data-sb-setup] [data-sb-save], [data-sb-setup] .sb-actions').length), 0, '아래 [저장]·[건너뛰기]·[취소] 줄은 없다');
        });
        await check('확인 창 — 지도를 누른 손가락의 늦은 click(창 안에서 누르지 않은 click)은 무시 · Esc = 취소(칠·「선택」·지도 아래 줄이 누르기 전으로)', async () => {
            await page.evaluate(() => document.querySelector('[data-sb-pick-dialog] [data-sb-save]').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
            assert.ok(await dlgState(page), '늦은 click 으로 저장되지 않는다');
            assert.equal(await page.evaluate(() => (JSON.parse(localStorage.getItem('seagnal_station_briefing_v1') || '{}')).station || null), null);
            await page.keyboard.press('Escape');
            assert.equal(await dlgState(page), null); assert.deepEqual(await mapPickState(page), NOPICK);
            assert.equal(await page.evaluate(() => window.PopupStack.list().includes('sb-pick-dialog')), false, '뒤로가기 등록 해제');
        });
        await check('확인 창 — 바깥(어두운 곳) 누름 = 취소 · 하드웨어 뒤로가기(PopupStack) = 취소 · 취소 뒤 다른 관할을 다시 누를 수 있다', async () => {
            let [x, y] = await polyPoint(page, HALLIM); await page.mouse.click(x, y); await page.waitForSelector('[data-sb-pick-dialog]', { timeout: 3000 });
            await page.mouse.click(4, 4);   // 화면 왼쪽 위 = 창 바깥(어두운 곳)
            assert.equal(await dlgState(page), null, '바깥 누름'); assert.deepEqual(await mapPickState(page), NOPICK);
            [x, y] = await polyPoint(page, HALLIM); await page.mouse.click(x, y); await page.waitForSelector('[data-sb-pick-dialog]', { timeout: 3000 });
            assert.equal(await page.evaluate(() => window.PopupStack.popLast()), true);
            assert.equal(await dlgState(page), null, '뒤로가기'); assert.deepEqual(await mapPickState(page), NOPICK);
        });
        await page.setViewportSize({ width: 380, height: 844 }); await page.waitForTimeout(300); await page.evaluate(() => document.querySelector('[data-sb-setup]').scrollIntoView()); await clean(page); await page.screenshot({ path: path.join(SHOT, 'picker_map_380.png') });
        await check('[‹ 해역 다시 고르기] → 해역 단추 · 남해 → 부산 남항만(목포 남항은 서해) · 380px 가로 넘침 없음', async () => {
            await tap(page, '[data-sb-sea-back]'); assert.equal(await page.$$eval('.sb-sea-btn', (e) => e.length), 4);
            assert.equal(await page.evaluate(() => window.StationBriefingPicker._map()), null, '지도 정리');
            await clean(page); await page.screenshot({ path: path.join(SHOT, 'picker_seas_380.png') });
            await tap(page, '.sb-sea-btn[data-sea="남해"]');
            await page.waitForFunction(() => { const l = window.StationBriefingPicker._layer(); return l && l.getSource().getFeatures().length; }, null, { timeout: 8000 });
            assert.deepEqual(await page.evaluate(() => window.StationBriefingPicker._layer().getSource().getFeatures().map((f) => f.get('key'))), [BUSAN]);
            const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: innerWidth })); assert.ok(w.doc <= w.vw + 1, JSON.stringify(w));
            await tap(page, '[data-sb-sea-back]');
        });
        await check('360px — 「해상 브리핑 보기」·「연안 브리핑 보기」 두 칸이 한 줄 · 머리 오른쪽 [건너뛰기] · 확인 창이 화면 안(좌우 여백)', async () => {
            await page.setViewportSize({ width: 360, height: 780 }); await page.waitForTimeout(200);
            const r = await page.evaluate(() => { const ls = [...document.querySelectorAll('[data-sb-setup] .sb-toggle')].map((l) => l.getBoundingClientRect()); const out = document.querySelector('[data-sb-setup] .sb-setup-head [data-sb-skip]');
                return { n: ls.length, sameLine: ls.length === 2 && Math.abs(ls[0].top - ls[1].top) < 2, labels: [...document.querySelectorAll('[data-sb-setup] .sb-toggle')].map((l) => l.textContent), out: out && out.textContent, doc: document.documentElement.scrollWidth, vw: innerWidth }; });
            assert.deepEqual([r.n, r.sameLine, r.labels, r.out], [2, true, ['해상 브리핑 보기', '연안 브리핑 보기'], '건너뛰기'], JSON.stringify(r)); assert.ok(r.doc <= r.vw + 1, JSON.stringify(r));
            await tap(page, '[data-sb-tab="list"]'); await page.fill('.sb-search', '한림'); await tap(page, '.sb-station-btn[data-key="' + HALLIM + '"]'); await page.waitForSelector('[data-sb-pick-dialog]');
            const b = await page.evaluate(() => { const x = document.querySelector('[data-sb-pick-dialog] [role="dialog"]').getBoundingClientRect(); return { l: x.left, r: x.right, t: x.top, btm: x.bottom, vw: innerWidth, vh: innerHeight }; });
            assert.ok(b.l >= 16 - 0.5 && b.r <= b.vw - 16 + 0.5 && b.t > 0 && b.btm < b.vh, JSON.stringify(b));
            await clean(page); await page.screenshot({ path: path.join(SHOT, 'picker_dialog_360.png') });
            await tap(page, '[data-sb-pick-cancel]'); await page.fill('.sb-search', ''); await tap(page, '[data-sb-tab="map"]');
        });
        await page.setViewportSize({ width: 412, height: 915 });
        await page.setViewportSize({ width: 380, height: 844 }); await clean(page); await page.screenshot({ path: path.join(SHOT, 'setup_380.png'), fullPage: false });
        await page.evaluate(() => document.getElementById('station-briefing-accordion-header').scrollIntoView()); await clean(page); await page.screenshot({ path: path.join(SHOT, 'setup_380.png') });
        await page.setViewportSize({ width: 412, height: 915 });
        await check('건너뛰기(관할 없을 때 머리 오른쪽 — 아래 단추 줄은 없앰) → 「더 이상 표시하지 않을까요?」 → 아니요 → 설정 전 안내로', async () => {
            assert.equal(await page.evaluate(() => !!document.querySelector('[data-sb-setup] .sb-setup-head [data-sb-skip]') && !document.querySelector('[data-sb-setup] [data-sb-cancel]')), true, '관할이 없으면 [건너뛰기]만');
            await tap(page, '[data-sb-skip]'); await page.waitForSelector('[data-sb-confirm]');
            assert.ok((await content(page)).includes('이 아코디언을 더 이상 표시하지 않을까요?'));
            await tap(page, '[data-sb-hide-no]'); assert.ok((await content(page)).includes('연안 안전 브리핑 지역이 설정되지 않았습니다'));
            assert.equal(await vis(page, 'station-briefing-accordion-header'), true);
        });
        await check('관할을 골랐어도 해상·육상 둘 다 끄면 = 둘 다 건너뛴 것 → 묻기 → 예 → 숨김 + 「오른쪽 위 설정 버튼」 안내', async () => {
            await pickStation(page, HALLIM, { sea: false, land: false }); await page.waitForSelector('[data-sb-confirm]');
            await tap(page, '[data-sb-hide-yes]'); await page.waitForTimeout(300);
            assert.equal(await vis(page, 'station-briefing-accordion-header'), false); assert.equal(await vis(page, 'station-briefing-accordion-body'), false);
            const modal = await page.evaluate(() => (document.getElementById('seagnal-custom-modal') || {}).innerText || ''); assert.ok(modal.includes('오른쪽 위 설정') && modal.includes('다시 표시'), modal);
            const p = await page.evaluate(() => JSON.parse(localStorage.getItem('seagnal_station_briefing_v1'))); assert.deepEqual([p.hidden, p.station], [true, null]);
            await page.evaluate(() => window.closeSeagnalModal && window.closeSeagnalModal());
        });
        await check('설정 팝업(오른쪽 위 ⚙) — 「연안 안전 브리핑」 칸이 보이고 스위치를 켜면 아코디언이 다시 보인다', async () => {
            await page.evaluate(() => window.openSettingsModal()); await page.waitForTimeout(500);
            assert.equal(await vis(page, 'station-briefing-settings'), true);
            const txt = await page.$eval('#station-briefing-settings', (e) => e.innerText); assert.ok(txt.includes('관리자 기기에만') && txt.includes('설정되지 않음'), txt);
            assert.equal(await page.$eval('#opt-station-briefing-show', (e) => e.checked), false);
            await page.evaluate(() => document.getElementById('opt-station-briefing-show').click()); await page.waitForTimeout(200);
            assert.equal(await vis(page, 'station-briefing-accordion-header'), true);
        });
        await clean(page); await page.screenshot({ path: path.join(SHOT, 'settings_popup_412.png') });
        await check('설정 팝업 [관할 설정] → 팝업 닫고 아코디언 펼쳐 관할 고르기 → 한림 저장 → 브리핑·⚙', async () => {
            await tap(page, '#station-briefing-settings-edit'); await page.waitForSelector('[data-sb-setup]');
            assert.equal(await page.evaluate(() => document.getElementById('settings-modal').classList.contains('hidden')), true);
            await page.evaluate((k) => document.querySelector('.sb-station-btn[data-key="' + k + '"]').click(), HALLIM); await tap(page, '[data-sb-save]');
            await page.waitForSelector('[data-sb-sec="overview"]'); assert.equal(await vis(page, 'station-briefing-settings-btn'), true);
            const p = await page.evaluate(() => JSON.parse(localStorage.getItem('seagnal_station_briefing_v1'))); assert.deepEqual([p.station, p.showSea, p.showLand, p.hidden], [HALLIM, true, true, false]);
        });

        // ── 3. 본문 ──
        // 「가」 모양(§11.10.4) — 결론 → 분석 문단 → 접힌 분석 근거(연안·해상) → (기상) → (물때). 근거·권고는 펼쳐야 보인다.
        const openBasis = (pg, kind) => pg.evaluate((k) => { const x = document.querySelector('#station-briefing-content button[data-sb-x="basis-' + k + '"]'); if (x && x.getAttribute('aria-expanded') !== 'true') x.click(); }, kind);
        await check('본문 — 총평 「가」 모양(칩 「연안/해상 ○○ 필요」·결론·AI 분석 문단·접힌 분석 근거(누르면 (근거)·(권고))·지금 밀집은 해상 분석 아래·(기상)·(물때)) · 특별 상황 · 해상 시간 막대(⚑) · 해역 카드 · 연안 카드 · 상시 위험 장소 · 조석 게이지 · 기준 시각·참고 정보', async () => {
            const grab = () => page.evaluate(() => {
                const q = (s) => document.querySelector('#station-briefing-content ' + s), qa = (s) => [...document.querySelectorAll('#station-briefing-content ' + s)];
                const line = (li) => { const c = li.cloneNode(true); c.querySelectorAll('.sb-x-arrow, .sb-basis-note, .sb-x-panel').forEach((x) => x.remove()); return c.textContent; };
                const blk = (k) => { const e = q('[data-sb-summary="' + k + '"]'); if (!e) return null; const x = e.querySelector('button[data-sb-x="basis-' + k + '"]'), pn = x && document.getElementById(x.getAttribute('aria-controls'));
                    return { kids: [...e.children].map((c) => c.getAttribute('data-sb-analysis') ? 'analysis' : c.hasAttribute('data-sb-now') ? 'now' : c.classList.contains('sb-conclusion') ? 'conclusion' : c.classList.contains('sb-basis-x') ? 'basis-btn' : c.classList.contains('sb-x-panel') ? 'basis-panel' : c.className),
                        btn: x ? x.textContent : null, exp: x && x.getAttribute('aria-expanded'), hidden: pn && pn.hidden, ks: pn ? [...pn.querySelectorAll('.sb-sum-k')].map((y) => y.textContent.trim()) : [], basis: pn ? [...pn.querySelectorAll('.sb-sum-basis > li')].map(line) : [], advice: pn ? (pn.querySelector('.sb-sum-advice') || {}).textContent : null,
                        adv: (e.querySelector(':scope > [data-sb-advice]') || {}).textContent || null, advSrc: (e.querySelector(':scope > [data-sb-advice]') || { dataset: {} }).dataset.sbAdvice || null,
                        an: (e.querySelector('[data-sb-analysis]') || {}).textContent, anSrc: e.querySelector('[data-sb-analysis]') && e.querySelector('[data-sb-analysis]').dataset.sbAnalysisSource, tag: (e.querySelector('.sb-an-tag') || {}).textContent }; };
                const con = qa('.sb-conclusion').map((e) => ({ chip: e.querySelector('.sb-chip').textContent, head: e.querySelector('.sb-headline').textContent, w: getComputedStyle(e.querySelector('.sb-headline')).fontWeight }));
                const wx = q('[data-sb-part="weather"]');
                return { secs: qa('[data-sb-sec]').map((e) => e.dataset.sbSec), land: blk('land'), sea: blk('sea'), parts: qa('[data-sb-part]').map((e) => e.dataset.sbPart), con, oldPara: qa('[data-sb-overview]').length, cms: qa('[data-sb-commentary]').length,
                    wx: { title: wx.querySelector('[data-sb-wx-head="weather"]').textContent, notesHead: (wx.querySelector('[data-sb-wx-head="notes"]') || {}).textContent || null, rows: [...wx.querySelectorAll('.sb-wx-rows li')].map((x) => x.textContent), notes: [...wx.querySelectorAll('.sb-wx-notes li')].map((x) => x.textContent), text: wx.textContent },
                    tideLines: qa('[data-sb-part="tide"] .sb-sum-tide').map((x) => x.textContent),
                    now: (q('[data-sb-summary="sea"] [data-sb-now]') || {}).textContent || '', basisOld: !!q('details.sb-basis'), source: (q('[data-sb-source]') || {}).dataset ? q('[data-sb-source]').dataset.sbSource : null,
                    special: qa('.sb-special-title').map((e) => e.textContent), slots: qa('.sb-slot').length, flags: qa('.sb-slot[data-event]').length, seaCards: qa('[data-sb-card="sea"]').length,
                    landCards: qa('[data-sb-card="land"]').length, links: qa('.sb-link').length, constant: (q('details.sb-constant summary') || {}).textContent || '', landSecTitle: (q('[data-sb-sec="land"] .marine-forecast-sub-title') || {}).textContent,
                    gauge: !!q('.sb-tide .ocean-tide-progress-track'), peaks: qa('.sb-tide .ocean-tide-peak-row').length, tideText: qa('.sb-tide-text').map((e) => e.textContent),
                    foot: (q('.sb-foot') || {}).textContent || '', edition: (q('.sb-edition') || {}).textContent || '', title: document.getElementById('station-briefing-title').textContent };
            });
            const s0 = await grab();
            assert.deepEqual(s0.secs, ['overview', 'special', 'sea', 'land', 'tide']);
            assert.deepEqual(s0.parts, ['land', 'sea', 'weather', 'tide'], '연안 덩어리 → 해상 덩어리 → (기상) → (물때)'); assert.equal(s0.oldPara, 0, '새 브리핑은 옛 문단을 그리지 않음'); assert.equal(s0.cms, 0, '종전 「해설」 칸 없음');
            assert.deepEqual(s0.land.kids, ['conclusion', 'analysis', 'sb-sum-advice', 'basis-btn', 'basis-panel']); assert.deepEqual(s0.sea.kids, ['conclusion', 'analysis', 'sb-sum-advice', 'now', 'basis-btn', 'basis-panel'], '분석 문단 → (권고) → 지금 밀집 → 근거 배지(§11.10.9 ⑤)');
            assert.deepEqual(s0.con.map((x) => x.chip + '|' + x.head), ['연안 주의 필요|' + B.h.summary.land.headline, '해상 주의 필요|오늘 한림파출소 관할 해상의 단계는 "주의 필요"입니다.']); assert.ok(s0.con.every((x) => Number(x.w) >= 700), '결론은 굵게');
            assert.deepEqual([s0.land.btn, s0.land.exp, s0.land.hidden, s0.land.basis.length, s0.sea.btn, s0.sea.exp, s0.sea.hidden], ['연안 분석 근거 상세 보기', 'false', true, 0, '해상 분석 근거 상세 보기', 'false', true], '분석 근거는 처음에 접혀 있다(§11.10.9 — 알약 배지 「… 상세 보기」)');
            assert.deepEqual([s0.land.tag, s0.land.anSrc, s0.sea.tag, s0.sea.anSrc], ['AI 분석 · ChatGPT', 'chatgpt', 'AI 분석 · ChatGPT', 'chatgpt']);
            const spL = SPLIT(B.h.overview.land); assert.ok(spL, '고정 AI 문단은 「따라서」로 끝난다');
            assert.equal(s0.land.an, 'AI 분석 · ChatGPT ' + spL.body); assert.deepEqual([s0.land.adv, s0.land.advSrc], ['(권고) ' + spL.advice, 'analysis'], '마지막 「따라서 …」는 (권고) 줄 — 「따라서」 없이'); assert.ok(s0.now.includes('37척'));
            assert.equal(s0.title, '13:10 AI 연안 안전 브리핑', '특보 변경 판 = 만든 시각'); assert.equal(s0.landSecTitle, '연안 분석');
            await openBasis(page, 'land'); await openBasis(page, 'sea');
            const s = await grab();
            assert.deepEqual([s.land.exp, s.land.hidden, s.sea.exp, s.sea.hidden], ['true', false, 'true', false]);
            assert.equal(s.wx.title, '제주도서부앞바다 기상 현황'); assert.equal(s.wx.notesHead, '특이사항');
            assert.deepEqual(s.wx.rows, ['오늘 오전 구름많음 · 파고 0.5~1.5m · 풍속 7~11m/s · 풍향 동→남동', '오늘 오후 구름많음 · 파고 0.5~1.5m · 풍속 7~11m/s · 풍향 남동']);
            assert.deepEqual(s.wx.notes, B.h.summary.weather.notes); assert.ok(s.wx.notes.length >= 1, '특이사항 글은 서버 규칙 값 그대로(§11.10.2 — 문구는 test_station_briefing.js 가 고정)');
            assert.ok(s.wx.text.includes('제주지방기상청 단기 해상예보 (10.17 05:00 발표)') && s.wx.text.includes('제주지방기상청 단기 전망 (10.17 04:40 발표)'), s.wx.text);
            assert.ok(!s.wx.text.includes('(기상)') && !s.wx.text.includes('(특이사항)') && !s.wx.text.includes('가장 가까운 특보구역'), '§11.10.9 — 「(기상)」·거리 줄 없음: ' + s.wx.text);
            assert.deepEqual(s.tideLines, B.h.tide.text, '물때는 공용 칸');
            assert.deepEqual(s.land.ks, ['(근거)'], '근거 칸에서는 (권고)를 뺐다(§11.10.9 ⑤)'); assert.deepEqual(s.land.basis, B.h.summary.land.basis); assert.equal(s.land.advice, undefined);
            assert.ok(s.land.basis.some((x) => x.includes('방문객 평소의 1.8배(예상)')), '예상 표기 — ' + s.land.basis.join(' / '));
            assert.deepEqual(s.sea.ks, ['(근거)']); assert.deepEqual(s.sea.basis, B.h.summary.sea.basis);
            assert.ok(!s.basisOld, '옛 「근거 ▸」(details) 없음'); assert.equal(s.source, null, '§11.10.9 — 맨 아래 「분석 문단은 ChatGPT가 썼습니다 …」 줄 없음(이름표만)');
            assert.ok(s.special.some((t) => t.includes('해제 예고')) && s.special.some((t) => t.includes('예비특보')), s.special.join('|'));
            assert.equal(s.slots, B.h.sea.timeBar.length); assert.equal(s.flags, B.h.sea.timeBar.filter((x) => x.events.length).length); assert.ok(s.flags >= 1);
            assert.equal(s.seaCards, B.h.sea.cards.length); assert.equal(s.landCards, B.h.land.cards.length); assert.equal(s.links, s.seaCards + s.landCards);
            assert.ok(s.constant.startsWith('상시 위험 장소'));
            assert.ok(s.gauge, '오늘 판이라 해양종합정보와 같은 진행 게이지'); assert.equal(s.peaks, 4); assert.ok(s.tideText[0].includes('저조 뒤부터 물이 차오릅니다'), s.tideText[0]);
            assert.ok(s.foot.includes('참고 정보이며 안전을 보장하지 않습니다') && s.foot.includes('기준 시각 10월 17일(토) 13:10'), s.foot);
            assert.equal(s.edition, '10월 17일 13:10 기준 브리핑 (다음 브리핑 갱신 17:30 또는 특보 변경 시)', '§11.10.9 ⑦ — 판 종류·생성 시각 없이, 제목과 같은 시각 + 다음 갱신');
            assert.ok(s.title.startsWith(/\d{2}:\d{2}/.exec(s.edition)[0] + ' '), '제목 시각 = 머리 글 시각 — ' + s.title);
            await page.evaluate(() => { document.querySelectorAll('#station-briefing-content button[data-sb-x^="basis-"]').forEach((x) => { if (x.getAttribute('aria-expanded') === 'true') x.click(); }); });
        });
        await check('서버 글은 textContent — HTML 문자열이 글자로 보이고 img 가 생기지 않는다', async () => {
            const r = await page.evaluate(() => ({ imgs: document.querySelectorAll('#station-briefing-content img').length, xss: window.__xss || null, sea: document.querySelector('[data-sb-analysis="sea"]').textContent, card: document.querySelector('[data-sb-card="sea"] .sb-sentence').textContent }));
            assert.equal(r.imgs, 0); assert.equal(r.xss, null); assert.ok(r.sea.includes('<img src=x onerror=')); assert.ok(r.card.startsWith('<img'));
        });
        await check('[§11.10.4] 제목·순서·이름표 — 「HH:MM AI 연안 안전 브리핑」(정시 판 = 공개 시각, 특보·관리자 판 = 만든 시각) · 화면 순서 결론→분석→근거(연안)→결론→분석→지금→근거(해상)→(기상)→(물때) · 「AI 분석 · Gemini」·「규칙 분석」', async () => {
            const base = JSON.parse(JSON.stringify(B.h));
            const r = await page.evaluate(({ base, now }) => {
                const R = window.StationBriefingRender, box = document.createElement('div'), out = {}; box.className = 'sb-wrap'; document.body.appendChild(box);
                const t = (b) => R.titleText(b);
                out.titles = [t({ edition: 'morning', publishAt: '2026-10-17T07:30:00+09:00', generatedAt: '2026-10-17T07:10:04+09:00' }), t({ edition: 'evening', publishAt: '2026-10-17T17:30:00+09:00', generatedAt: '2026-10-17T17:10:00+09:00' }), t({ edition: 'night', publishAt: '2026-10-17T23:00:00+09:00', generatedAt: '2026-10-17T22:40:00+09:00' }), t({ edition: 'warning', publishAt: '2026-10-17T13:12:00+09:00', generatedAt: '2026-10-17T13:12:40+09:00' }), t({ edition: 'manual', generatedAt: '2026-10-17T09:41:00+09:00' }), t(null)];
                R.render(box, { ok: true, briefing: base, now: { text: '지금(10:00 기준) 관할 해역 선박 37척' } }, { now });
                const order = ['[data-sb-summary="land"] .sb-conclusion', '[data-sb-analysis="land"]', '[data-sb-x="basis-land"]', '[data-sb-summary="sea"] .sb-conclusion', '[data-sb-analysis="sea"]', '[data-sb-now]', '[data-sb-x="basis-sea"]', '[data-sb-part="weather"]', '[data-sb-part="tide"]'].map((s) => box.querySelector(s));
                out.found = order.map((e) => !!e); out.inOrder = order.every((e, i) => i === 0 || (order[i - 1] && e && (order[i - 1].compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING)));
                const g = JSON.parse(JSON.stringify(base)); g.overview = { ...g.overview, source: 'gemini', model: 'gemini-2.5-flash' }; R.render(box, { ok: true, briefing: g }, { now });
                out.gem = [...box.querySelectorAll('.sb-an-tag')].map((e) => e.textContent); out.gemSrc = box.querySelector('[data-sb-analysis]').dataset.sbAnalysisSource + '|' + box.querySelectorAll('[data-sb-source]').length;
                const tp = JSON.parse(JSON.stringify(base)); tp.overview = { land: null, sea: null, source: 'template', model: null }; R.render(box, { ok: true, briefing: tp }, { now });
                out.rule = [...box.querySelectorAll('[data-sb-analysis]')].map((e) => e.dataset.sbAnalysisSource + '|' + e.textContent);
                box.remove(); return out;
            }, { base, now: clock.now });
            assert.deepEqual(r.titles, ['07:30 AI 연안 안전 브리핑', '17:30 AI 연안 안전 브리핑', '23:00 AI 연안 안전 브리핑', '13:12 AI 연안 안전 브리핑', '09:41 AI 연안 안전 브리핑', 'AI 연안 안전 브리핑']);
            assert.ok(r.found.every(Boolean) && r.inOrder, JSON.stringify(r.found));
            assert.deepEqual([r.gem, r.gemSrc], [['AI 분석 · Gemini', 'AI 분석 · Gemini'], 'gemini|0']);
            assert.deepEqual(r.rule, ['rule|규칙 분석 ' + SPLIT(base.summary.analysis.land).body, 'rule|규칙 분석 ' + SPLIT(base.summary.analysis.sea).body], 'AI 실패 → 서버 규칙 분석 문단(제목은 그대로 — 마지막 「따라서」 문장은 (권고) 줄)');
            // 380px 새 모양 스크린샷 — 처음(근거 접힘)과 해상 분석 근거를 편 모습
            await page.setViewportSize({ width: 380, height: 844 }); await openAcc(page); await page.waitForTimeout(250); await clean(page);
            await page.evaluate(() => { document.getElementById('station-briefing-accordion-header').scrollIntoView(); window.scrollBy(0, -150); document.querySelectorAll('*').forEach((e) => { if (e.scrollTop && e.contains(document.getElementById('station-briefing-accordion-header'))) e.scrollTop -= 150; }); });
            await page.waitForTimeout(150); await clean(page); await page.screenshot({ path: path.join(SHOT, 'briefing_title_380.png') });   // 제목 「13:10 AI 연안 안전 브리핑」이 보이는 화면
            await page.locator('#station-briefing-content [data-sb-sec="overview"]').screenshot({ path: path.join(SHOT, 'briefing_layout_380.png') });
            await openBasis(page, 'sea'); await page.waitForTimeout(150); await clean(page);
            await page.locator('#station-briefing-content [data-sb-sec="overview"]').screenshot({ path: path.join(SHOT, 'briefing_layout_open_380.png') });
            const wide = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: innerWidth })); assert.ok(wide.doc <= wide.vw + 1, JSON.stringify(wide));
            await page.evaluate(() => { const x = document.querySelector('#station-briefing-content button[data-sb-x="basis-sea"]'); if (x.getAttribute('aria-expanded') === 'true') x.click(); });
            await page.setViewportSize({ width: 412, height: 915 });
        });
        await check('[§11.10.9] 사용자 결정 — 분석 근거 알약 배지(오른쪽·꺾쇠 뒤집힘·aria-expanded) · 「평소보다 위험이 높아진 곳 N곳」 표(전부) · 「○○ 기상 현황」 머리 = 결론 줄 모양 · 거리 줄 없음 · 특이사항 없으면 칸째 없음 · 맨 아래 출처 줄 없음 · 지금 밀집 두 줄', async () => {
            await page.setViewportSize({ width: 380, height: 844 }); await openAcc(page);
            const r = await page.evaluate(() => {
                const c = document.getElementById('station-briefing-content'), out = {}, x = c.querySelector('button[data-sb-x="basis-land"]'), row = x.parentElement, chev = x.querySelector('.sb-x-chev');
                const br = x.getBoundingClientRect(), rr = row.getBoundingClientRect(), cs = getComputedStyle(x);
                out.pill = { cls: x.classList.contains('sb-x-pill'), right: Math.abs(br.right - rr.right) <= 1, left: br.left - rr.left, radius: parseFloat(cs.borderTopLeftRadius), deco: cs.textDecorationLine, chev: !!chev, arrow: !!x.querySelector('.sb-x-arrow') };
                chev.style.transition = 'none'; out.t0 = getComputedStyle(chev).transform; x.click(); out.t1 = getComputedStyle(chev).transform; out.exp = x.getAttribute('aria-expanded');   // 전환을 끄고 바로 잰다(시험만)
                const rb = c.querySelector('button[data-sb-x="raised"]'); out.rb = rb ? rb.childNodes[0].textContent : null; out.rbExp0 = rb && rb.getAttribute('aria-expanded'); rb.click();
                const t = c.querySelector('[data-sb-raised-table]'); out.rbExp1 = rb.getAttribute('aria-expanded'); out.panelFor = rb.getAttribute('aria-controls') === t.parentElement.id;
                out.head = [...t.querySelectorAll('th')].map((e) => e.textContent); out.rows = [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent));
                out.li = rb.parentElement.firstChild.textContent + rb.textContent; out.cap = t.querySelector('caption').textContent;
                const wh = c.querySelector('[data-sb-wx-head="weather"]'), hl = c.querySelector('[data-sb-summary="sea"] .sb-headline'), g = (e) => { const z = getComputedStyle(e); return [z.fontSize, z.fontWeight, z.color]; };
                out.wxStyle = [g(wh), g(hl), wh.className.includes('sb-headline')]; out.notesHead = g(c.querySelector('[data-sb-wx-head="notes"]'));
                const now = c.querySelector('[data-sb-now]'); out.now = now.innerText; out.nowWs = getComputedStyle(now).whiteSpace;
                out.src = c.querySelectorAll('[data-sb-source]').length;
                return out;
            });
            assert.deepEqual([r.pill.cls, r.pill.right, r.pill.radius >= 10, r.pill.deco, r.pill.chev, r.pill.arrow], [true, true, true, 'none', true, false], JSON.stringify(r.pill));
            assert.ok(r.pill.left > 40, '오른쪽 정렬(왼쪽에 빈자리) ' + r.pill.left); assert.notEqual(r.t0, r.t1, '펼치면 꺾쇠가 뒤집힌다'); assert.equal(r.exp, 'true');
            const rz = B.h.summary.land.raised;
            assert.equal(r.rb, rz.link); assert.deepEqual([r.rbExp0, r.rbExp1, r.panelFor], ['false', 'true', true]);
            assert.deepEqual(r.head, ['관광지', '평소', '오늘(예상)']); assert.equal(r.rows.length, rz.rows.length); assert.equal(rz.rows.length, B.h.land.attentionSpots, '관심 이상 관광지 전부');
            assert.deepEqual(r.rows, rz.rows.map((x) => [x.name, '평소 수준', x.word + x.reason])); assert.ok(r.li.startsWith(B.h.summary.land.basis[0].slice(0, 20)), r.li); assert.ok(r.cap.includes('평소 수준'), r.cap);
            await page.locator('#station-briefing-content [data-sb-summary="land"]').screenshot({ path: path.join(SHOT, 'briefing_raised_380.png') });
            assert.deepEqual(r.wxStyle[0], r.wxStyle[1], '「기상 현황」 머리 = 결론 줄과 같은 크기·굵기·색'); assert.ok(r.wxStyle[2]); assert.deepEqual(r.notesHead, r.wxStyle[1]);
            assert.deepEqual(r.now.split('\n'), ['10:00 기준 관할 해역 선박 37척 · 선박이 있는 해역 격자 12개', '한림항 북서방 1.2해리 해역(232-2해구) 18척 — 충돌·접촉 주의'], '두 줄'); assert.equal(r.nowWs, 'pre-line');
            assert.equal(r.src, 0);
            await page.locator('#station-briefing-content [data-sb-sec="overview"]').screenshot({ path: path.join(SHOT, 'briefing_919_380.png') });
            await page.evaluate(() => document.querySelectorAll('#station-briefing-content button[data-sb-x="basis-land"]').forEach((x) => { if (x.getAttribute('aria-expanded') === 'true') x.click(); }));
            // 특이사항 세 경우 + 먼 구역 안내(울릉 등) — 같은 렌더러로
            const base = JSON.parse(JSON.stringify(B.h));
            const v = await page.evaluate(({ base, now }) => {
                const R = window.StationBriefingRender, box = document.createElement('div'), out = {}; box.className = 'sb-wrap'; document.body.appendChild(box);
                const wx = (W) => { const b = JSON.parse(JSON.stringify(base)); Object.assign(b.summary.weather, W); R.render(box, { ok: true, briefing: b }, { now }); const p = box.querySelector('[data-sb-part="weather"]'); return { heads: [...p.querySelectorAll('[data-sb-wx-head]')].map((e) => e.textContent), text: p.textContent }; };
                out.none = wx({ notes: [], notesFound: false });
                out.unparsed = wx({ notes: [], notesFound: true });
                out.missing = wx({ notes: [], bulletinMissing: true, notesSource: null });
                out.far = wx({ zone: '동해중부안쪽먼바다', kind: 'far', distKm: 0, note: '가장 가까운 앞바다 특보구역(강원남부앞바다)이 약 115.9km 떨어져 있어 파출소가 있는 먼바다 특보구역 예보입니다' });
                out.dist = wx({ distKm: 0.1, note: null });
                box.remove(); return out;
            }, { base, now: clock.now });
            assert.deepEqual(v.none.heads, ['제주도서부앞바다 기상 현황'], '특이사항이 없으면 칸째 없음'); assert.ok(!v.none.text.includes('특이사항') && !v.none.text.includes('없습니다') && !v.none.text.includes('단기 전망 ('), v.none.text);
            assert.deepEqual(v.unparsed.heads, ['제주도서부앞바다 기상 현황', '특이사항']); assert.ok(v.unparsed.text.includes('뽑지 못했습니다'), '뽑지 못한 것은 「없음」처럼 숨기지 않음(L-291)');
            assert.deepEqual(v.missing.heads, ['제주도서부앞바다 기상 현황', '특이사항']); assert.ok(v.missing.text.includes('단기 전망 자료를 확인하지 못했습니다'));
            assert.deepEqual(v.far.heads[0], '동해중부안쪽먼바다 기상 현황'); assert.ok(!v.far.text.includes('115.9km') && !v.far.text.includes('떨어져'), '먼 구역 거리 안내 없음 — ' + v.far.text);
            assert.ok(!v.dist.text.includes('약 0.1km') && !v.dist.text.includes('대표 위치'), v.dist.text);
            await page.setViewportSize({ width: 412, height: 915 });
        });
        await check('[§11.10.9 ④⑤] 분석 문단 강조(특보 예정 = 굵게 노랑 · 발효 = 굵게 빨강 · 장소 주어·방문객 배수 굵게 · 단계 말 = 그 단계 색) · 마지막 「따라서 …」 → (권고) 줄(근거 칸 (권고)와 같은 모양) · 근거 칸 (권고) 없음 · 문단이 없으면 서버 권고 · 「따라서」가 없는 옛 문단은 근거 칸 (권고) 그대로', async () => {
            const base = JSON.parse(JSON.stringify(B.h));
            const r = await page.evaluate(({ base, now }) => {
                const R = window.StationBriefingRender, box = document.createElement('div'), out = {}; box.className = 'sb-wrap'; document.getElementById('station-briefing-content').appendChild(box);
                const b = JSON.parse(JSON.stringify(base));
                b.overview.land = "하트해변은 연안 위험지수 '매우 높음'으로 경계 필요 수준이며, 방문객이 평소의 2.4배로 예상됩니다. 위험구역이 있고, 풍랑주의보 예비특보가 10월 18일 06~12시에 발효될 예정이어서 연안 상황 변화에 유의해야 합니다. 봉평해수욕장과 후정해수욕장은 연안 위험지수 '높음'으로 주의 필요 수준이며, 방문객이 각각 평소의 2.2배와 2.8배로 예상됩니다. 따라서 하트해변에는 경계가, 봉평해수욕장과 후정해수욕장에는 주의가 필요합니다.";
                b.overview.sea = '제주도북부앞바다에는 풍랑주의보가 발효 중이어서 물결이 높습니다. 둘째 문장입니다. 따라서 비양도 주변 해역 운항에 주의가 필요합니다.';
                b.land.attentionAll = (b.land.attentionAll || []).concat(['하트해변', '봉평해수욕장', '후정해수욕장'].map((n) => ({ name: n, rank: 2 })));
                R.render(box, { ok: true, briefing: b }, { now });
                const an = box.querySelector('[data-sb-analysis="land"]'), sea = box.querySelector('[data-sb-analysis="sea"]');
                const spans = (e) => [...e.querySelectorAll('.sb-hl')].map((x) => ({ t: x.textContent, c: x.className.replace('sb-hl sb-hl-', ''), color: getComputedStyle(x).color, w: getComputedStyle(x).fontWeight }));
                out.land = spans(an); out.sea = spans(sea); out.landText = an.textContent; out.html = an.innerHTML.includes('<img');
                let e = an; while (e && !/rgb\(|rgba\([^)]*, 1\)/.test(getComputedStyle(e).backgroundColor === 'rgba(0, 0, 0, 0)' ? '' : getComputedStyle(e).backgroundColor)) e = e.parentElement; out.bg = e ? getComputedStyle(e).backgroundColor : null;   // 글자 뒤 첫 불투명 바탕(대비 보고용)
                const adv = box.querySelector('[data-sb-summary="land"] > [data-sb-advice]'), basisAdv = box.querySelector('[data-sb-summary="land"] .sb-x-panel .sb-sum-advice');
                out.adv = adv.textContent; out.advSpans = adv.querySelectorAll('.sb-hl').length;
                const x = box.querySelector('button[data-sb-x="basis-land"]'); x.click(); const pAdv = document.getElementById(x.getAttribute('aria-controls')).querySelector('.sb-sum-advice'); out.basisAdv = !!pAdv; x.click();
                // 근거 칸의 (권고)와 같은 모양: 옛 문단(「따라서」로 끝나지 않음)이면 근거 칸 (권고)가 남는다 — 그 둘의 글 색·굵기 비교
                const o = JSON.parse(JSON.stringify(base)); o.overview.land = '옛 문단입니다. 셋째도 없습니다.'; R.render(box, { ok: true, briefing: o }, { now });
                const ox = box.querySelector('button[data-sb-x="basis-land"]'); ox.click(); const oAdv = document.getElementById(ox.getAttribute('aria-controls')).querySelector('.sb-sum-advice');
                out.old = { inline: !!box.querySelector('[data-sb-summary="land"] > [data-sb-advice]'), basis: oAdv ? oAdv.textContent : null, style: oAdv ? [getComputedStyle(oAdv).color, getComputedStyle(oAdv).fontWeight] : null };
                R.render(box, { ok: true, briefing: b }, { now }); const nAdv = box.querySelector('[data-sb-summary="land"] > [data-sb-advice]'); out.newStyle = [getComputedStyle(nAdv).color, getComputedStyle(nAdv).fontWeight];
                // 문단이 아예 없으면(AI·규칙 둘 다 없음) 서버 권고를 결론 아래에
                const z = JSON.parse(JSON.stringify(base)); z.overview = { land: null, sea: null, source: 'template', model: null }; z.summary.analysis = { land: null, sea: null }; R.render(box, { ok: true, briefing: z }, { now });
                const zAdv = box.querySelector('[data-sb-summary="land"] > [data-sb-advice]'); out.none = zAdv ? [zAdv.dataset.sbAdvice, zAdv.textContent] : null;
                box.remove(); return out;
            }, { base, now: clock.now });
            const pick = (arr) => arr.map((x) => x.c + ':' + x.t);
            assert.deepEqual(pick(r.land), ['b:하트해변은', "lv:'매우 높음'", 'lv:경계 필요', 'b:방문객이 평소의 2.4배로 예상', 'warn-pre:풍랑주의보 예비특보가 10월 18일 06~12시에 발효될 예정', 'b:봉평해수욕장과 후정해수욕장은', "lv:'높음'", 'lv:주의 필요', 'b:방문객이 각각 평소의 2.2배와 2.8배로 예상']);
            const col = (c) => 'rgb(' + c.join(', ') + ')';
            assert.equal(r.land.find((x) => x.c === 'warn-pre').color, col([242, 194, 48]), '예비특보·예정 = 노랑(위험예측 4색의 「다소 높음」)');
            assert.equal(r.land.find((x) => x.t === "'매우 높음'").color, col([224, 50, 44])); assert.equal(r.land.find((x) => x.t === "'높음'").color, col([251, 146, 60]));
            assert.ok(r.land.every((x) => Number(x.w) >= 700), '모두 굵게');
            assert.deepEqual(pick(r.sea), ['warn-on:풍랑주의보가 발효 중'], '발효 = 빨강'); assert.equal(r.sea[0].color, col([224, 50, 44]));
            assert.ok(!r.landText.includes('따라서'), '마지막 「따라서」 문장은 문단에서 빠진다');
            assert.equal(r.adv, '(권고) 하트해변에는 경계가, 봉평해수욕장과 후정해수욕장에는 주의가 필요합니다.'); assert.equal(r.advSpans, 0, '(권고) 줄 안은 강조 없음(근거 칸 (권고) 모양 그대로)');
            assert.equal(r.basisAdv, false, '근거 칸 (권고) 없음');
            assert.deepEqual([r.old.inline, r.old.basis], [false, '(권고) ' + B.h.summary.land.advice], '「따라서」가 없는 옛 문단 — 문단 그대로·근거 칸 (권고) 그대로');
            assert.deepEqual(r.newStyle, r.old.style, '본문 (권고) = 근거 칸 (권고)와 같은 색·굵기');
            assert.deepEqual(r.none, ['summary', '(권고) ' + B.h.summary.land.advice], '문단이 없으면 서버 권고를 결론 아래에');
            const lum = (c) => { const v = (c.match(/\d+/g) || []).slice(0, 3).map(Number).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
            const cr = (fg) => { const a = lum(fg), b = lum(r.bg); return +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2); };
            console.log('   [대비] 바탕 ' + r.bg + ' — 노랑 ' + cr('rgb(242, 194, 48)') + ' · 주황 ' + cr('rgb(251, 146, 60)') + ' · 빨강 ' + cr('rgb(224, 50, 44)') + ' · 굵은 흰 글 ' + cr('rgb(248, 250, 252)'));
        });
        await check('[§11.10.9 ⑥] 팝업 지도 — 분석 문단의 대해구 이름·「관할 해역 선박 N척」·붐비는 해역 이름이 링크 · 누르면 가운데 창(role=dialog·aria-modal) 지도(관할 경계 + 대해구 테두리 / 선박 격자 + 칸 안 척수 / 그 격자 깜빡임) · ✕·Esc·바깥으로 닫힘 · 360px', async () => {
            await page.setViewportSize({ width: 360, height: 780 }); await openAcc(page);
            const hg = B.h.summary.sea.haegu; assert.ok(Array.isArray(hg) && hg.length === 1 && hg[0].major === '232' && hg[0].box.length === 4, JSON.stringify(hg));
            const base = JSON.parse(JSON.stringify(B.h));
            const r = await page.evaluate(({ base, now, hgName, nowObj }) => {
                const R = window.StationBriefingRender, box = document.getElementById('station-briefing-content'), out = {};
                const b = JSON.parse(JSON.stringify(base)); b.overview.sea = hgName + '는 최대 파고 2.6m·풍속 14m/s로 물결이 높고 바람이 매우 강할 것으로 예상됩니다. 대해구 2320 같은 다른 번호는 링크가 아닙니다. 따라서 비양도 주변 해역 운항에 주의가 필요합니다.';
                R.render(box, { ok: true, briefing: b, now: nowObj }, { now });
                out.links = [...box.querySelectorAll('[data-sb-maplink]')].map((x) => x.dataset.sbMaplink + ':' + x.textContent);
                const pop = () => { const d = document.querySelector('[data-sb-map-popup]'); if (!d) return null; const m = d.querySelector('.sb-minimap'), bx = d.querySelector('.sb-dlg-box'), rr = bx.getBoundingClientRect();
                    return { key: d.dataset.sbMapPopup, role: bx.getAttribute('role'), modal: bx.getAttribute('aria-modal'), title: d.querySelector('.sb-dlg-title').textContent, map: m.dataset.sbMap, area: m.dataset.sbMapArea, hl: m.dataset.sbMapHl, cells: m.dataset.sbMapCells, labels: m.dataset.sbMapLabels, blink: m.dataset.sbBlink,
                        h: Math.round(m.getBoundingClientRect().height), vh: innerHeight, left: Math.round(rr.left), right: Math.round(innerWidth - rr.right), focus: document.activeElement && document.activeElement.hasAttribute('data-sb-map-close') }; };
                box.querySelector('[data-sb-maplink="haegu"]').click(); out.haegu = pop();
                document.querySelector('[data-sb-map-popup]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); out.afterEsc = !!document.querySelector('[data-sb-map-popup]'); out.blinkAfter = R.blinking();
                box.querySelector('[data-sb-maplink="now-all"]').click(); out.all = pop(); document.querySelector('[data-sb-map-close]').click(); out.afterX = !!document.querySelector('[data-sb-map-popup]');
                box.querySelector('[data-sb-maplink="now-busiest"]').click(); out.busiest = pop();
                return out;
            }, { base, now: clock.now, hgName: hg[0].name, nowObj: { at: '2026-10-17T10:00:00+09:00', count: 37, gridCount: 3, text: '10:00 기준 관할 해역 선박 37척 · 선박이 있는 해역 격자 3개\n한림항 북서방 1.2해리 해역(232-2해구) 18척 — 충돌·접촉 주의', ...NOW_CELLS } });
            assert.deepEqual(r.links, ['haegu:' + hg[0].name, 'now-all:관할 해역 선박 37척', 'now-busiest:한림항 북서방 1.2해리 해역(232-2해구)'], '대해구 2320 은 링크가 아님');
            assert.deepEqual([r.haegu.key, r.haegu.role, r.haegu.modal, r.haegu.title, r.haegu.map, r.haegu.area, r.haegu.hl, r.haegu.cells, r.haegu.focus], ['haegu', 'dialog', 'true', hg[0].name, 'ol', '1', '1', '0', true]);
            assert.ok(r.haegu.h >= r.haegu.vh * 0.55 && r.haegu.h <= r.haegu.vh * 0.7, '지도 높이 약 62vh — ' + r.haegu.h + '/' + r.haegu.vh); assert.ok(r.haegu.left >= 16 && r.haegu.right >= 16, '360px 좌우 여백 ' + r.haegu.left + '/' + r.haegu.right);
            assert.equal(r.afterEsc, false, 'Esc 로 닫힘'); assert.equal(r.blinkAfter, 0, '닫으면 깜빡임 멈춤');
            assert.deepEqual([r.all.key, r.all.hl, r.all.cells, r.all.labels], ['now-all', '0', '3', '18,12,7'], '선박이 있는 격자마다 칸 안 척수'); assert.equal(r.afterX, false, '✕ 로 닫힘');
            assert.deepEqual([r.busiest.key, r.busiest.hl, r.busiest.cells, r.busiest.labels, r.busiest.blink], ['now-busiest', '1', '3', '18,12,7', 'on'], '그 격자는 깜빡이고 다른 격자도 숫자와 함께(흐리게)');
            await page.waitForTimeout(400); await clean(page); await page.screenshot({ path: path.join(SHOT, 'briefing_now_popup_360.png') });
            await page.evaluate(() => { const d = document.querySelector('[data-sb-map-popup] .sb-dlg-dim'); d.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); });
            assert.equal(await page.evaluate(() => !!document.querySelector('[data-sb-map-popup]')), false, '바깥(어두운 바탕)을 누르면 닫힘');
            await page.evaluate(({ base, now }) => window.StationBriefingRender.render(document.getElementById('station-briefing-content'), { ok: true, briefing: base, now: null }, { now }), { base, now: clock.now });
            await page.setViewportSize({ width: 412, height: 915 });
        });
        await check('시간 막대 칸 색 = 위험예측 4색(단계 순위), 칸을 누르면 설명 줄', async () => {
            const r = await page.evaluate(() => { const bs = [...document.querySelectorAll('.sb-slot')]; return bs.map((b) => [b.dataset.rank, getComputedStyle(b).backgroundColor]); });
            const want = { 0: 'rgb(47, 179, 107)', 1: 'rgb(242, 194, 48)', 2: 'rgb(251, 146, 60)', 3: 'rgb(224, 50, 44)' };
            r.forEach(([rank, bg]) => assert.equal(bg, want[rank], rank + ' 칸 색'));
            await page.evaluate(() => document.querySelectorAll('.sb-slot')[3].click());
            const d = await page.$eval('.sb-slot-detail', (e) => e.textContent); assert.ok(d.startsWith(B.h.sea.timeBar[3].label), d);
        });
        await openAcc(page); await page.evaluate(() => document.getElementById('station-briefing-accordion-header').scrollIntoView());
        for (const [w, h] of [[380, 844], [1280, 900]]) { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(250); await clean(page); await page.screenshot({ path: path.join(SHOT, 'briefing_top_' + w + '.png') }); await page.locator('#station-briefing-content').screenshot({ path: path.join(SHOT, 'briefing_' + w + '.png') }); }
        await page.setViewportSize({ width: 380, height: 844 });
        await check('380px 에서 가로로 넘치지 않는다(본문 폭 ≤ 화면 폭)', async () => {
            const r = await page.evaluate(() => ({ sw: document.getElementById('station-briefing-content').scrollWidth, cw: document.getElementById('station-briefing-content').clientWidth, doc: document.documentElement.scrollWidth, vw: innerWidth }));
            assert.ok(r.sw <= r.cw + 1, JSON.stringify(r)); assert.ok(r.doc <= r.vw + 1, JSON.stringify(r));
        });
        await check('[기준 상세] — 위험예측과 같은 창(고정 머리·표 가로 스크롤), 제목 「연안 안전 브리핑」·주요 규칙 문구(§11.10.4 — 07:30·20분 전 만들기·분석 문단·VM 3번 → Gemini → 규칙 분석)', async () => {
            await tap(page, '#station-briefing-content .sb-basis-btn'); await page.waitForSelector('.rf-modal .rf-basis');
            const r = await page.evaluate(() => ({ title: document.querySelector('.rf-basis-head h3').textContent, body: document.querySelector('.rf-basis-body').innerText, tbl: document.querySelectorAll('.rf-basis-body .rf-tbl').length, close: !!document.querySelector('.rf-basis-head .mclose') }));
            assert.equal(r.title, '연안 안전 브리핑'); assert.ok(r.close); assert.equal(r.tbl, 3);
            for (const k of ['07:30 · 17:30 · 23:00', '20분 전(07:10 · 17:10 · 22:40)', '그때까지는 이전 판', '덮지 않습니다', '21시가 넘으면 다음 날', '오늘 밤~내일', '공단 안내로는 경계 상위 5%·주의 상위 5~15% 구간', '만들기 시작한 시각이 든 3시간 칸부터', '기상청 해제 시각', '해제 예고로만', '사고 확률이 아닙니다', '단계 높은 순 10곳까지', '최대 12곳', '이안류를 관측하는 해수욕장만', '8m/s 이상', '다음 정시 판에 반영', '조석 칸이 없습니다', '「확인 불가」(회색)', '1.2~1.3배', '저조 뒤부터 물이 차오릅니다',
                '연안 분석·해상 분석', '3~5문장', '최대 3번', 'Gemini 로 한 번', '규칙 분석', '「AI 분석 · ChatGPT」', '「연안 분석 근거 상세 보기」', '선박이 있는 해역 격자', '관광지 | 평소 | 오늘(예상)', '잔잔한 바다일 것으로 예상됩니다', '14m/s 이상 매우 강함', '07:30 판은 오늘 오전·오후', '참고 정보이며 안전을 보장하지 않습니다']) assert.ok(r.body.includes(k), k);
            for (const no of ['활동지점', '최대 20분', '틀 문장', '해설(육상']) assert.ok(!r.body.includes(no), no);
        });
        await clean(page); await page.screenshot({ path: path.join(SHOT, 'basis_380.png') });
        await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(200); await clean(page); await page.screenshot({ path: path.join(SHOT, 'basis_1280.png') });
        await page.keyboard.press('Escape'); await page.setViewportSize({ width: 412, height: 915 });

        // ── 4. N 뱃지 ──
        await check('N 뱃지 — 특보 변경 판을 아직 펼쳐 보지 않았으면 머리에 .new-badge, 펼치면 사라지고 다시 켜도 없다(기기 저장)', async () => {
            await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('seagnal_station_briefing_v1')); p.seen = {}; localStorage.setItem('seagnal_station_briefing_v1', JSON.stringify(p)); });
            await page.reload(); await page.waitForFunction(() => window.StationBriefing); await page.waitForSelector('#station-briefing-badge-slot .new-badge', { timeout: 5000 });
            assert.equal(await page.$eval('#station-briefing-badge-slot .new-badge', (e) => e.textContent), 'N');
            await tap(page, '#station-briefing-accordion-header'); await page.waitForTimeout(300);
            assert.equal(await page.$('#station-briefing-badge-slot .new-badge'), null);
            await page.reload(); await page.waitForFunction(() => window.StationBriefing); await page.waitForTimeout(900);
            assert.equal(await page.$('#station-briefing-badge-slot .new-badge'), null);
        });

        // ── 5. 바로가기 ──
        await check('[위험예측에서 보기 ›](육상 카드) → 해양안전생활 > 해양안전 · 위험예측 켜짐 · 그 관광지 시트', async () => {
            await openAcc(page);
            await page.evaluate(() => document.querySelector('[data-sb-card="land"] .sb-link').click());
            await page.waitForFunction(() => { const a = window._riskForecastApp; return a && a.getState().selected && a.getState().selected.id === '50110|협재해수욕장'; }, null, { timeout: 15000 });
            await page.waitForFunction(() => document.getElementById('risk-forecast-sheet').classList.contains('open'), null, { timeout: 5000 });
            const s = await page.evaluate(() => ({ tab: document.body.getAttribute('data-active-tab'), safety: document.body.classList.contains('ls-safety'), btn: document.getElementById('ocean-risk-forecast-toggle-btn').classList.contains('active'), locked: document.getElementById('ocean-risk-forecast-toggle-btn').classList.contains('rf-preview-locked'), st: window._riskForecastApp.getState() }));
            assert.deepEqual([s.tab, s.safety, s.btn, s.locked, s.st.enabled, s.st.coast, s.st.selected.kind], ['ocean-life-group', true, true, false, true, true, 'coast']);
        });
        await check('[위험예측에서 보기 ›](해역 카드) → 해상 층 켜짐 · 그 칸(GR4 id·좌표) · 그 시각(15시) 시트', async () => {
            await page.evaluate(() => window.switchMainTab('weather-group')); await page.waitForTimeout(500); await openAcc(page);
            await page.evaluate(() => document.querySelector('[data-sb-card="sea"] .sb-link').click());
            await page.waitForFunction((id) => { const a = window._riskForecastApp; const s = a && a.getState(); return s && s.enabled && s.sea && s.selected && s.selected.id === id; }, CELL.id, { timeout: 15000 });
            await page.waitForFunction(() => document.getElementById('risk-forecast-sheet').classList.contains('open'), null, { timeout: 5000 });
            const s = await page.evaluate(() => window._riskForecastApp.getState());
            assert.deepEqual([s.selected.kind, s.selected.location, s.t], ['marine', { lon: CELL.lon, lat: CELL.lat }, at(15)]);
        });
        await clean(page); await page.screenshot({ path: path.join(SHOT, 'shortcut_sea_412.png') });
        await page.context().close();

        // ── 6. 상태들 ──
        page = await device({ admin: true });
        await check('해상만 관할(목포 남항) — 육상 보기 칸이 꺼지고 이유 표시, 본문은 해상만(육상 칸 대신 이유 한 줄)', async () => {
            await page.evaluate(() => window.openStationBriefingSetup()); await page.waitForSelector('[data-sb-setup]');
            await page.evaluate((k) => document.querySelector('.sb-station-btn[data-key="' + k + '"]').click(), MOKPO);
            const r = await page.evaluate(() => ({ dis: document.querySelector('[data-sb-show="showLand"]').disabled, on: document.querySelector('[data-sb-show="showLand"]').checked, note: document.querySelector('.sb-toggles .sb-small').textContent }));
            assert.deepEqual([r.dis, r.on], [true, false]); assert.ok(r.note.includes('해상 브리핑만'));
            assert.ok((await dlgState(page)).note.includes('해상 브리핑만'), '확인 창에도 해상만 안내');
            await tap(page, '[data-sb-save]'); await page.waitForSelector('[data-sb-sec="overview"]');
            const t = await page.evaluate(() => ({ land: !!document.querySelector('[data-sb-summary="land"]'), sec: [...document.querySelectorAll('[data-sb-sec]')].map((e) => e.dataset.sbSec), landSec: (document.querySelector('[data-sb-sec="land"]') || {}).innerText || '' }));
            assert.equal(t.land, false); assert.ok(t.sec.includes('sea')); assert.ok(t.landSec.includes('해상만'), t.landSec);
            // 해상만 관할 때문에 꺼진(잠긴) 연안 칸은 다른 관할을 누르면 다시 켜지고, [취소]하면 누르기 전(잠김·꺼짐)으로
            await page.evaluate(() => window.openStationBriefingSetup()); await page.waitForSelector('[data-sb-setup]');
            const land = () => page.evaluate(() => { const c = document.querySelector('[data-sb-show="showLand"]'); return [c.disabled, c.checked]; });
            assert.deepEqual(await land(), [true, false]);
            assert.equal(await page.evaluate(() => !!document.querySelector('[data-sb-setup] .sb-setup-head [data-sb-cancel]') && !document.querySelector('[data-sb-setup] [data-sb-skip]')), true, '이미 설정했으면 [취소]만');
            await page.evaluate((k) => document.querySelector('.sb-station-btn[data-key="' + k + '"]').click(), HALLIM); await page.waitForSelector('[data-sb-pick-dialog]');
            assert.deepEqual(await land(), [false, true]);
            await tap(page, '[data-sb-pick-cancel]'); assert.deepEqual(await land(), [true, false]);
            await tap(page, '[data-sb-cancel]'); await page.waitForSelector('[data-sb-sec="overview"]');
            assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('seagnal_station_briefing_v1')).station), MOKPO, '[취소]는 바꾸지 않는다');
        });
        await check('자료 확인 불가(부산 남항) — 해상 단계 「확인 불가(일부)」(회색)·빠진 자료 이름 · AI 실패(틀)면 서버 규칙 분석 문단 + 이름표 「규칙 분석」 · 제목 「07:30 AI 연안 안전 브리핑」', async () => {
            await pickStation(page, BUSAN); await page.waitForSelector('[data-sb-sec="sea"]');
            await openBasis(page, 'sea');
            const r = await page.evaluate(() => { const c = document.querySelector('[data-sb-sec="sea"] .sb-sec-head .sb-chip'), an = document.querySelector('[data-sb-analysis="sea"]'); return { word: c.textContent, bg: getComputedStyle(c).backgroundColor, miss: document.querySelector('[data-sb-sec="sea"] .sb-miss').textContent, src: document.querySelectorAll('[data-sb-source]').length, fs: parseFloat(getComputedStyle(document.querySelector('[data-sb-wx-missing]')).fontSize), body: parseFloat(getComputedStyle(document.querySelector('[data-sb-summary="sea"] .sb-headline')).fontSize), wxMiss: (document.querySelector('[data-sb-wx-missing]') || {}).textContent || null, cm: document.querySelectorAll('[data-sb-commentary]').length, basis: [...document.querySelectorAll('[data-sb-summary="sea"] .sb-sum-basis li')].map((x) => x.textContent), an: an.textContent, anSrc: an.dataset.sbAnalysisSource, tag: an.querySelector('.sb-an-tag').textContent, title: document.getElementById('station-briefing-title').textContent, chip: document.querySelector('[data-sb-summary="sea"] .sb-conclusion .sb-chip').textContent }; });
            assert.equal(r.word, '확인 불가(일부)'); assert.equal(r.bg, 'rgb(100, 116, 139)'); assert.ok(r.miss.includes('혼잡 예보') && r.miss.includes('해구 예보'), r.miss);
            assert.equal(r.src, 0, '§11.10.9 — 맨 아래 「규칙 분석 — …」 줄 없음(문단 앞 이름표 「규칙 분석」만)');
            assert.deepEqual([r.tag, r.anSrc, r.an], ['규칙 분석', 'rule', '규칙 분석 ' + SPLIT(B.b.summary.analysis.sea).body]); assert.ok(r.an.includes('확인하지 못한 자료(혼잡 예보·해구 예보)'), r.an);
            assert.equal(r.title, '07:30 AI 연안 안전 브리핑', '정시 판 = 공개 시각(만든 시각 07:10 이 아님)'); assert.equal(r.chip, '해상 확인 불가(일부)');
            assert.equal(r.wxMiss, '기상예보 자료를 확인하지 못했습니다.', '기상 자료가 없으면 지어내지 않고 밝힘'); assert.ok(r.fs < r.body, '작은 글씨'); assert.equal(r.cm, 0, '해설 칸 없음');
            assert.ok(r.basis.some((x) => x.startsWith('확인하지 못한 자료: 혼잡 예보·해구 예보')), r.basis.join(' / '));
        });
        await check('육상 끄기 — 해상만 보이게 저장하면 육상 문단·육상 분석 칸이 없다', async () => {
            await pickStation(page, HALLIM, { land: false }); await page.waitForSelector('[data-sb-sec="overview"]');
            const r = await page.evaluate(() => ({ sec: [...document.querySelectorAll('[data-sb-sec]')].map((e) => e.dataset.sbSec), land: !!document.querySelector('[data-sb-summary="land"]') }));
            assert.deepEqual([r.sec.includes('land'), r.land, r.sec.includes('sea')], [false, false, true]);
        });
        await check('브리핑 없음 — 「아직 이 관할의 브리핑이 없습니다」 + 공개 시각 안내(07:30·17:30·23:00, 20분 전부터 만들기) · 제목 시각 없음', async () => {
            await pickStation(page, AEWOL); await page.waitForFunction(() => document.getElementById('station-briefing-content').innerText.includes('아직 이 관할의 브리핑이 없습니다'));
            assert.ok((await content(page)).includes('07:30 · 17:30 · 23:00에 보입니다') && (await content(page)).includes('20분 전(07:10 · 17:10 · 22:40)'), await content(page));
            assert.equal(await page.$eval('#station-briefing-title', (e) => e.textContent), 'AI 연안 안전 브리핑', '판이 없으면 시각 없이');
        });
        await check('21시 넘음 — 내일 판이 없으면 다음 예정 시각(nextExpectedAt) 안내 · 오늘 판이 있으면 오늘 판(§11.10.9 ⑦ 부터 「아직 없어」 상자 없이 머리 글 괄호에 다음 갱신)', async () => {
            clock.now = Date.parse('2026-10-17T21:30:00+09:00');
            await page.evaluate(() => window.StationBriefing.load()); await page.waitForFunction(() => document.getElementById('station-briefing-content').innerText.includes('다음 브리핑 공개'));
            assert.ok((await content(page)).includes('다음 브리핑 공개: 10월 17일(토) 23:00'));
            await pickStation(page, HALLIM); await page.waitForSelector('[data-sb-sec="overview"]');
            const t = await content(page); assert.ok(!t.includes('아직 없어') && !t.includes('보여 드립니다'), '§11.10.9 ⑦ — 「…아직 없어 … 보여 드립니다」 상자 없음: ' + t.slice(0, 200));
            assert.equal(await page.$eval('#station-briefing-content .sb-edition', (e) => e.textContent), '10월 17일 13:10 기준 브리핑 (다음 브리핑 갱신 23:00 또는 특보 변경 시)');
            clock.now = Date.parse('2026-10-17T10:05:00+09:00');
        });
        await page.context().close();

        // ── 7. 관리자 「AI 브리핑」 탭 ──
        // 오류 목록(§11.10 — 최근 3일 전부): 10-14(3일 전) 1건은 보이지 않고, 나머지 3건(이유에 「|」·줄바꿈 포함)이 최근 것부터.
        const ERRS = [{ at: '2026-10-14T23:00:00+09:00', stage: 'call', provider: 'vm', stations: [], reason: '오래된 오류' },
            { at: '2026-10-15T08:01:00+09:00', stage: 'validate', provider: 'chatgpt', stations: [HALLIM], reason: 'place:제주도', edition: 'morning', date: '2026-10-15' },
            { at: '2026-10-16T17:31:00+09:00', stage: 'call', provider: 'vm', stations: [HALLIM, AEWOL, BUSAN, MOKPO], reason: 'VM 작업자 연결 없음', edition: 'evening', date: '2026-10-16' },
            { at: '2026-10-17T08:02:00+09:00', stage: 'validate', provider: 'gemini', stations: [AEWOL], reason: 'number:hangul:두 곳|x\n둘째 줄', edition: 'morning', date: '2026-10-17', attempt: 4 }];
        fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ errors: ERRS }));
        page = await device({ admin: true, login: true });
        await check('관리자 → AI → 「AI 브리핑」 하위 탭 — 설정 칸(방식·모델·노출·묶음·바뀐 곳만)·상태·미리보기', async () => {
            await page.evaluate(() => { window.showUnifiedAdminModal('ai'); }); await page.waitForSelector('#ai-subtab-bar button[data-aisub="briefing"]');
            await tap(page, '#ai-subtab-bar button[data-aisub="briefing"]'); await page.waitForSelector('[data-sb-config] [data-field="exposure"]');
            const fields = await page.$$eval('[data-sb-config] [data-field]', (e) => e.map((x) => x.dataset.field)); assert.deepEqual(fields, ['method', 'chatgptModel', 'geminiModel', 'exposure', 'batchUnit', 'onlyChanged']);
            assert.equal(await page.$eval('[data-field="exposure"] [aria-pressed="true"]', (e) => e.textContent), '관리자에게만');
            assert.deepEqual(await page.$$eval('[data-field="chatgptModel"] button', (e) => e.map((x) => x.textContent)), ['GPT Luna', 'GPT Sol', 'GPT Astra']);
            await page.waitForSelector('[data-sb-next]'); assert.ok((await page.$eval('[data-sb-next]', (e) => e.textContent)).includes('10-17 17:30 공개(17:10부터 만들기)'), await page.$eval('[data-sb-next]', (e) => e.textContent));
            assert.ok((await page.$eval('[data-sb-admin] .admin-section-title', (e) => e.textContent)).includes('AI 브리핑 — 연안 안전 브리핑'));
            assert.equal(await page.$eval('#ai-subtab-bar button[data-aisub="briefing"]', (e) => e.textContent), 'AI 브리핑', '하위 탭 이름은 그대로(옛 이름을 보이지 않음)');
            assert.equal(await page.evaluate(() => localStorage.getItem('seagnal_ai_subtab')), 'briefing');
        });
        await check('[§11.10.7] 오류 — 실행마다 드롭다운(기본 = 가장 최근 실행, 3일 전 것 없음) · 고른 실행만 관할별·한글 풀이 · [복사]·[md로 저장]은 고른 실행만(실패하면 보이는 안내)', async () => {
            await page.waitForSelector('[data-sb-errors] [data-sb-err-run]');
            const opts = await page.$$eval('[data-sb-err-run] option', (e) => e.map((x) => x.textContent));
            assert.deepEqual(opts, ['10-17 08:02 · 07:30 판 · 오류 1', '10-16 17:31 · 17:30 판 · 오류 1', '10-15 08:01 · 07:30 판 · 오류 1'], opts.join(' / '));
            const li = await page.$$eval('[data-sb-err-list] li', (e) => e.map((x) => x.textContent));
            assert.equal(li.length, 1, li.join(' / ')); assert.ok(li[0].startsWith('4번째 시도(Gemini) — 한글 셈말 「두 곳|x'), li[0]);
            assert.ok((await page.$eval('[data-sb-err-station]', (e) => e.textContent)).startsWith('애월파출소제주해양경찰서오류 1'));
            assert.ok((await page.$eval('[data-sb-err-scope]', (e) => e.textContent)).includes('고른 실행(10-17 08:02 · 07:30 판)의 오류 1건만'));
            // 복사 — 클립보드를 가짜로 바꿔 받은 글을 본다(고른 실행 1건만)
            await page.evaluate(() => { window.__copied = null; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied = t; } } }); });
            await tap(page, '[data-sb-err-copy]'); await page.waitForFunction(() => document.querySelector('[data-sb-err-msg]').textContent.startsWith('복사했습니다'));
            let md = await page.evaluate(() => window.__copied), lines = md.split('\n');
            assert.equal(lines[0], '# 연안 안전 브리핑 — AI 브리핑 오류(10-17 08:02 시작 · 07:30 판)'); assert.ok(lines.includes('- 건수: 1건') && lines.some((l) => /^- 만든 시각: 2026-10-17 \d\d:\d\d KST$/.test(l)), md);
            assert.ok(lines.includes('| 시각(KST) | 판 | 단계 | 공급자 | 관할 | 이유 | 풀이 |'));
            assert.ok(lines.some((l) => l.startsWith('| 2026-10-17 08:02:00 | 07:30 판 · 2026-10-17 | validate · 4번째 | gemini | 제주해양경찰서 애월파출소 | number:hangul:두 곳\\|x 둘째 줄 | 4번째 시도(Gemini) — 한글 셈말 「두 곳\\|x 둘째 줄」')), '「|」·줄바꿈은 표를 깨지 않게 · 시도 번호(§11.10.4) · 풀이 — ' + md);
            // 다른 실행 고르기 — 여러 관할에 걸친 호출 오류는 「여러 관할 4곳」으로
            await page.selectOption('[data-sb-err-run]', '2026-10-16T17:31:00+09:00');
            assert.ok((await page.$eval('[data-sb-err-list]', (e) => e.textContent)).includes('여러 관할 4곳'));
            assert.ok((await page.$eval('[data-sb-err-list] li', (e) => e.textContent)).startsWith('AI 호출 실패 — ChatGPT(VM) 작업자 연결이 없어 건너뜀'));
            await tap(page, '[data-sb-err-copy]'); await page.waitForFunction(() => document.querySelector('[data-sb-err-msg]').textContent.startsWith('복사했습니다'));
            md = await page.evaluate(() => window.__copied);
            assert.ok(md.includes('| 2026-10-16 17:31:00 | 17:30 판 · 2026-10-16 | call | vm | 제주해양경찰서 한림파출소, 제주해양경찰서 애월파출소, 부산해양경찰서 남항파출소, 목포해양경찰서 남항파출소 | VM 작업자 연결 없음 |'), 'md 에는 관할 전부 — ' + md);
            assert.ok(!md.includes('2026-10-17 08:02'), '고른 실행만');
            // 복사 실패(클립보드 거부 + 옛 방식도 실패) → 보이는 안내
            await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('권한 없음'); } } }); document.execCommand = () => false; });
            await tap(page, '[data-sb-err-copy]'); await page.waitForFunction(() => document.querySelector('[data-sb-err-msg]').textContent.startsWith('복사하지 못했습니다'));
            assert.ok((await page.$eval('[data-sb-err-msg]', (e) => e.textContent)).includes('[md로 저장]'));
            // md 로 저장(브라우저) — Blob·a[download] 를 가로채 본다. 파일 이름은 그 실행 시작 시각
            await page.evaluate(() => { window.__blobs = []; URL.createObjectURL = (b) => { window.__blobs.push(b); return 'blob:sb-test'; }; const oc = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.hasAttribute('data-sb-err-download')) { window.__dl = { name: this.download, href: this.href }; return; } return oc.call(this); }; });
            await tap(page, '[data-sb-err-md]'); await page.waitForFunction(() => document.querySelector('[data-sb-err-msg]').textContent.startsWith('내려받기를 시작했습니다'));
            const dl = await page.evaluate(async () => ({ ...window.__dl, type: window.__blobs[0].type, text: await window.__blobs[0].text() }));
            assert.equal(dl.name, 'station_briefing_errors_20261016_1731.md'); assert.equal(dl.href, 'blob:sb-test'); assert.equal(dl.type, 'text/markdown;charset=utf-8');
            assert.equal(dl.text.split('\n').filter((l) => l.startsWith('| 2026-')).length, 1); assert.ok(dl.text.startsWith('# 연안 안전 브리핑 — AI 브리핑 오류(10-16 17:31 시작 · 17:30 판)'));
            // md 로 저장(앱 안 — Capacitor) — 서버에 맡기고 시스템 브라우저로 그 주소를 연다. 그 주소는 한 번 받으면 끝
            await page.evaluate(() => { window.__opened = null; window.__capOrig = window.Capacitor; window.Capacitor = { isNativePlatform: () => true, Plugins: { Browser: { open: async ({ url }) => { window.__opened = url; } } } }; });
            await tap(page, '[data-sb-err-md]'); await page.waitForFunction(() => document.querySelector('[data-sb-err-msg]').textContent.startsWith('휴대폰 브라우저를 열어'));
            const opened = await page.evaluate(() => window.__opened); assert.ok(/\/api\/station-briefing\/download\/[0-9a-f]{32}$/.test(opened), opened);
            const got = await page.evaluate(async (u) => { const r = await fetch(u); return { status: r.status, cd: r.headers.get('content-disposition'), text: await r.text() }; }, opened);
            assert.equal(got.status, 200); assert.ok(got.cd.includes('station_briefing_errors_20261016_1731.md')); assert.ok(got.text.startsWith('# 연안 안전 브리핑 — AI 브리핑 오류(10-16 17:31 시작 · 17:30 판)'));
            // 앱 안인데 브라우저 플러그인이 없으면 — 저장했다고 하지 않고 글을 띄운다
            await page.evaluate(() => { window.Capacitor = { isNativePlatform: () => true, Plugins: {} }; });
            await tap(page, '[data-sb-err-md]'); await page.waitForFunction(() => document.querySelector('[data-sb-err-msg]').textContent.startsWith('이 앱 화면에서는 파일로 바로 저장할 수 없습니다'));
            assert.ok((await page.$eval('[data-sb-err-text]', (e) => e.value)).startsWith('# 연안 안전 브리핑'));
            await page.evaluate(() => { window.Capacitor = window.__capOrig; if (window.Capacitor === undefined) delete window.Capacitor; });   // 원래 것(웹 Capacitor 코어가 만든 것일 수 있음)으로 되돌림
        });
        await check('[§11.10.7] 진행 게이지 — 실행 중이면 전체 막대(가운데 = 지금 하는 곳)·단계·묶음 칩·관할 칩, 끝나면 저절로 상태를 다시 그림 · 설정 칸 이름 흰색', async () => {
            const pr = SB.newProgress({ at: '2026-10-17T10:00:00+09:00', kind: 'manual', unit: 'office', stations: 3, windows: ['2026-10-17'] });
            SB.stepProgress(pr, 'locate-done'); SB.stepProgress(pr, 'gather', { window: 0 }); SB.stepProgress(pr, 'ai', { window: 0, method: 'chatgpt' });
            SB.onAiProgress(pr, { type: 'plan', batches: [{ name: '제주해양경찰서', stations: [{ key: HALLIM, name: '한림파출소', state: 'waiting' }, { key: AEWOL, name: '애월파출소', state: 'waiting' }] }, { name: '부산해양경찰서', stations: [{ key: BUSAN, name: '남항파출소', state: 'done' }] }] });
            SB.onAiProgress(pr, { type: 'call', batch: '제주해양경찰서', keys: [HALLIM, AEWOL], provider: 'chatgpt', attempt: 1 });
            SB.onAiProgress(pr, { type: 'station', key: HALLIM, state: 'done', attempt: 1 });
            ctl.progress = pr; ctl.running = true;
            await page.evaluate(() => [...document.querySelectorAll('[data-sb-status] button')].find((b) => b.textContent === '새로고침').click());
            await page.waitForSelector('[data-sb-progress-now]');
            const r = await page.evaluate(() => ({ now: document.querySelector('[data-sb-progress-now]').textContent, pct: document.querySelector('[data-sb-progress-pct]').textContent, pill: document.querySelector('[data-sb-running]').textContent,
                batches: [...document.querySelectorAll('[data-sb-progress-batches] button')].map((b) => [b.textContent, b.dataset.state, b.getAttribute('aria-pressed')]),
                sts: [...document.querySelectorAll('[data-sb-progress-stations] .sba-st')].map((x) => [x.textContent.trim(), x.dataset.state]) }));
            assert.equal(r.now, '제주해양경찰서 · 한림파출소·애월파출소 — ChatGPT 1번째 시도'); assert.equal(r.pct, '80% (4/5)'); assert.equal(r.pill, '실행 중');
            assert.deepEqual(r.batches, [['제주 1/2', 'running', 'true'], ['부산 1/1', 'done', 'false']]);
            assert.deepEqual(r.sts, [['✓ 한림', 'done'], ['애월', 'running']]);
            await page.setViewportSize({ width: 360, height: 780 }); await page.waitForTimeout(200);
            assert.ok(await page.evaluate(() => document.querySelector('[data-sb-progress]').scrollWidth <= document.querySelector('[data-sb-progress]').clientWidth + 1), '360px 에서 가로 넘침 없음');
            await page.locator('[data-sb-status]').screenshot({ path: path.join(SHOT, 'admin_ai_briefing_progress_360.png') });
            assert.equal(await page.$eval('[data-sb-config] [data-field="method"] .sba-label', (e) => getComputedStyle(e).color), 'rgb(248, 250, 252)', '칸 이름 흰색(#f8fafc)');
            ctl.running = false; ctl.progress = null;
            await page.waitForFunction(() => document.querySelector('[data-sb-running]').textContent === '대기 중', null, { timeout: 8000 });
            assert.equal(await page.evaluate(() => document.querySelector('[data-sb-progress]').hidden), true, '끝나면 게이지 숨김');
            await page.setViewportSize({ width: 1280, height: 900 });
        });
        await check('설정 저장 — 방식 「틀」·묶음 「지방청」·바뀐 곳만 끄기 → 서버 config 에 저장', async () => {
            await tap(page, '[data-field="method"] [data-value="template"]'); await page.waitForFunction(() => document.querySelector('[data-sb-msg]').textContent.startsWith('저장됨'));
            await tap(page, '[data-field="batchUnit"] [data-value="region"]'); await page.waitForFunction(() => document.querySelector('[data-sb-msg]').textContent.includes('지방청'));
            await tap(page, '[data-field="onlyChanged"] [data-value="false"]'); await page.waitForFunction(() => document.querySelector('[data-sb-msg]').textContent.includes('매번 새로'));
            const c = real.readConfig(); assert.deepEqual([c.method, c.batchUnit, c.onlyChanged], ['template', 'region', false]);
            assert.equal(await page.$eval('[data-field="chatgptModel"]', (e) => e.style.opacity), '0.45', '틀이면 모델 줄이 흐리다');
            assert.ok(reqLog.some((r) => r.path === '/api/admin/station-briefing/config' && r.tok === 'admin-login'), '관리자 토큰 자동 첨부');
        });
        await check('노출 범위 전환 — 「사용자에게」면 일반 기기에도 아코디언, 「노출 안 함」이면 관리자 기기에도 없다', async () => {
            await tap(page, '[data-field="exposure"] [data-value="user"]'); await page.waitForFunction(() => document.querySelector('[data-sb-msg]').textContent.includes('사용자에게'));
            const g = await device(); assert.equal(await vis(g, 'station-briefing-accordion-header'), true, '일반 기기에 보임'); await g.context().close();
            await tap(page, '[data-field="exposure"] [data-value="off"]'); await page.waitForFunction(() => document.querySelector('[data-sb-msg]').textContent.includes('노출 안 함'));
            const a = await device({ admin: true }); assert.equal(await vis(a, 'station-briefing-accordion-header'), false, '관리자 기기에도 없음'); await a.context().close();
            await tap(page, '[data-field="exposure"] [data-value="admin"]'); await page.waitForFunction(() => document.querySelector('[data-sb-msg]').textContent.includes('관리자에게만'));
            assert.equal(real.readConfig().exposure, 'admin');
        });
        await check('[지금 다시 만들기] — 202 시작 안내 · 실행 중이면 409 「이미 실행 중」', async () => {
            await tap(page, '[data-sb-run]'); await page.waitForFunction(() => document.querySelector('[data-sb-run-msg]').textContent.startsWith('시작했습니다')); assert.equal(ctl.runs, 1);
            ctl.running = true; await tap(page, '[data-sb-run]'); await page.waitForFunction(() => document.querySelector('[data-sb-run-msg]').textContent.startsWith('이미 실행 중')); assert.equal(ctl.runs, 1, '실행 중이면 다시 부르지 않는다');
            ctl.running = false;
        });
        await check('관할 하나 미리보기 — 노출 범위와 무관, 사용자 화면과 같은 렌더러(바로가기 없음)', async () => {
            real.writeConfig({ exposure: 'off' });
            real.writeConfig({ exposure: 'off' });
            await page.selectOption('[data-sb-preview-station]', HALLIM); await tap(page, '[data-sb-preview-go]');
            await page.waitForSelector('[data-sb-preview-out] [data-sb-sec="overview"]');
            const r = await page.evaluate(() => ({ st: document.querySelector('[data-sb-preview-out] .sb-station').textContent, links: document.querySelectorAll('[data-sb-preview-out] .sb-link').length, pending: !!document.querySelector('[data-sb-preview-out] [data-sb-pending]') }));
            assert.ok(r.st.startsWith('한림파출소')); assert.equal(r.links, 0); assert.equal(r.pending, false);
            real.writeConfig({ exposure: 'admin' });
        });
        await check('[§11.10.4] 관리자 미리보기 — 공개 시각 전 판(pending)은 「예정 — … 17:30에 공개될 판」으로 보이고, 같은 때 사용자 경로는 지금 판 그대로 · 상태 「공개 예정」', async () => {
            const ev = JSON.parse(JSON.stringify(B.h)); ev.edition = 'evening'; ev.trigger = { kind: 'evening' }; ev.generatedAt = '2026-10-17T17:10:00+09:00'; ev.publishAt = '2026-10-17T17:30:00+09:00';
            fs.writeFileSync(path.join(dir, 'briefings_2026-10-17.json'), JSON.stringify({ date: '2026-10-17', stations: { [HALLIM]: B.h, [BUSAN]: B.b, [MOKPO]: B.m }, pending: { [HALLIM]: ev } }));
            const user = await http('/api/station-briefing?station=' + encodeURIComponent(HALLIM) + '&adminToken=admin-push-token');
            assert.deepEqual([user.body.briefing.edition, user.body.pending], ['warning', undefined], '사용자에게는 공개 시각까지 지금 판');
            await tap(page, '[data-sb-preview-go]'); await page.waitForSelector('[data-sb-preview-out] [data-sb-pending]');
            const r = await page.evaluate(() => ({ note: document.querySelector('[data-sb-preview-out] [data-sb-pending]').textContent, ed: document.querySelector('[data-sb-preview-out] .sb-edition').textContent }));
            assert.ok(r.note.startsWith('예정 — 10월 17일(토) 17:30에 공개될 판입니다') && r.note.includes('이전 판(10월 17일(토) 13:10 생성)'), r.note); assert.ok(r.ed.startsWith('10월 17일 17:30 기준 브리핑 (다음 브리핑 갱신 '), r.ed);
            await page.evaluate(() => [...document.querySelectorAll('[data-sb-status] button')].find((b) => b.textContent === '새로고침').click()); await page.waitForSelector('[data-sb-pending-status]');
            assert.ok((await page.$eval('[data-sb-pending-status]', (e) => e.textContent)).includes('10-17 17:30 — 1곳(그때까지 사용자에게는 이전 판)'));
            writeDay('2026-10-17', { [HALLIM]: B.h, [BUSAN]: B.b, [MOKPO]: B.m });
        });
        for (const [w, h] of [[380, 844], [1280, 900]]) { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(250); await clean(page); await page.locator('#unified-admin-body').screenshot({ path: path.join(SHOT, 'admin_ai_briefing_' + w + '.png') }); }
        await page.context().close();

        // ── 8. 2단계 화면 독립 검토(review_ui1·review_ui2, 2026-10-16) — 결함마다 1:1 ──
        const toastText = (page) => page.evaluate(() => (document.getElementById('ocean-ui-toast') || {}).textContent || '');
        page = await device({ admin: true, width: 360, height: 780 });
        await pickStation(page, HALLIM); await page.waitForSelector('[data-sb-sec="overview"]'); await openAcc(page);
        await check('[UI-A1] 카드 최대치(해역 10·관광지 10·상시 12)·360px — 아코디언 본문이 잘리지 않고 꼬리(출처·「안전을 보장하지 않습니다」)까지 보인다', async () => {
            const r = await page.evaluate(async () => {
                const S = window.StationBriefing._state, resp = JSON.parse(JSON.stringify(S.resp)), b = resp.briefing;
                const dup = (arr, n) => Array.from({ length: n }, (_, i) => JSON.parse(JSON.stringify(arr[i % arr.length])));
                b.sea.cards = dup(b.sea.cards, 10); b.land.cards = dup(b.land.cards, 10); b.land.constant = dup(b.land.constant, 12);
                const box = document.getElementById('station-briefing-content');
                window.StationBriefingRender.render(box, resp, { showSea: true, showLand: true, onLink: () => {} });
                box.querySelectorAll('details').forEach((d) => { d.open = true; });
                await new Promise((res) => setTimeout(res, 700));
                const body = document.getElementById('station-briefing-accordion-body'), nb = box.querySelector('.sb-notice').getBoundingClientRect(), bb = body.getBoundingClientRect();
                const secs = [...box.querySelectorAll('.sb-sec-body')].map((e) => e.scrollHeight - e.clientHeight);
                return { content: box.scrollHeight, bodyClient: body.clientHeight, bodyScroll: body.scrollHeight, maxH: getComputedStyle(body).maxHeight, notice: nb.bottom, bodyBottom: bb.bottom, secs, cards: box.querySelectorAll('.sb-card').length };
            });
            assert.equal(r.cards, 20); assert.ok(r.content > 8000, '시험 자료가 옛 상한(8000px)을 넘어야 의미가 있다 — ' + r.content);
            assert.equal(r.maxH, 'none'); assert.ok(r.bodyScroll <= r.bodyClient + 1, JSON.stringify(r)); assert.ok(r.notice <= r.bodyBottom + 1, JSON.stringify(r));
            assert.ok(r.secs.every((d) => d <= 1), '안쪽 칸도 잘리지 않음 ' + r.secs.join(','));
            // 접으면 기존처럼 0 으로
            await page.evaluate(() => window.toggleStationBriefingAccordion()); await page.waitForTimeout(500);
            assert.equal(await page.evaluate(() => document.getElementById('station-briefing-accordion-body').clientHeight), 0);
            await openAcc(page);
        });
        await check('[UI-B1·B3·B5·B6·B10·B14] 총평 단계 < 해상 분석 단계면 한 줄 · 지난 칸 흐리게 · 「카드는 10곳까지」 · 내일 판 「내일」 · 출처 한 벌 · 지난 예정 시각은 「준비 중」', async () => {
            const base = JSON.parse(JSON.stringify(B.h));
            const r = await page.evaluate(({ base, now }) => {
                const R = window.StationBriefingRender, out = {}, box = document.createElement('div'); box.className = 'sb-wrap'; document.body.appendChild(box);
                const b1 = JSON.parse(JSON.stringify(base)); b1.sea.level = { rank: 3, word: '경계 필요' }; b1.sea.overviewLevel = { rank: 0, word: '평소 수준' };
                b1.sea.attentionRegions = 12; b1.sea.overviewRegions = 11; b1.land.attentionSpots = 13;
                R.render(box, { ok: true, briefing: b1 }, { now });
                // §11.10.12: 노란 안내 한 줄([data-sb-level-note])은 없어지고 해상 칩 오른쪽 KOMSA 배지(summary.sea.accidentOnly 수)
                out.note = !!box.querySelector('[data-sb-level-note]');
                out.badges = [...box.querySelectorAll('[data-sb-summary="sea"] .sb-conclusion [data-sb-komsa]')].map((x) => x.dataset.sbKomsa + ':' + x.textContent + ':' + x.style.background);
                out.badgeNext = (() => { const x = box.querySelector('[data-sb-summary="sea"] .sb-conclusion [data-sb-komsa]'); return !!x && x.previousElementSibling.classList.contains('sb-chip') && x.previousElementSibling.textContent.startsWith('해상 ') && x.nextElementSibling.classList.contains('sb-headline'); })();
                out.seaCount = box.querySelector('[data-sb-sea-count]').textContent; out.landCount = box.querySelector('[data-sb-land-count]').textContent;
                out.past = [...box.querySelectorAll('.sb-slot')].map((x) => x.dataset.past === 'true'); out.pastOpacity = getComputedStyle(box.querySelector('.sb-slot-past')).opacity;
                out.legend = box.querySelector('.sb-legend').textContent; out.labels = (b1.sea.timeBar || []).map((s) => s.label);
                out.foot = box.querySelector('[data-sb-foot-source]').textContent;
                // 옛 판(summary.sea.accidentOnly 없음) — 카드에 위험예보만 해역이 모두 있을 때만 카드로 센다 · 모자라면 배지 없음
                const o1 = JSON.parse(JSON.stringify(base)); delete o1.summary.sea.accidentOnly; R.render(box, { ok: true, briefing: o1 }, { now });
                out.oldBadges = [...box.querySelectorAll('[data-sb-komsa]')].map((x) => x.textContent);
                const o2 = JSON.parse(JSON.stringify(o1)); o2.sea.attentionRegions += 1; R.render(box, { ok: true, briefing: o2 }, { now });
                out.oldShort = box.querySelectorAll('[data-sb-komsa]').length;
                const o3 = JSON.parse(JSON.stringify(o1)); delete o3.summary.analysis; R.render(box, { ok: true, briefing: o3 }, { now });
                out.v2Badges = [...box.querySelectorAll('[data-sb-part="conclusion"] .sb-levels [data-sb-komsa]')].map((x) => x.textContent);
                // 옛 판 근거 줄에 풀이(note)가 있어도 위험예보만 해역 줄 풀이는 보이지 않는다(§11.10.12)
                const o4 = JSON.parse(JSON.stringify(base)); o4.summary.sea.detail.forEach((d) => { if (d.key === 'accidentOnly') d.note = '(한국해양교통안전공단 예보에서는 …)'; }); R.render(box, { ok: true, briefing: o4 }, { now });
                box.querySelector('[data-sb-x="basis-sea"]').click(); out.oldNote = (box.querySelector('[data-sb-basis="accidentOnly"] .sb-basis-note') || {}).textContent || ''; out.oldNoteLine = !!box.querySelector('[data-sb-basis="accidentOnly"]');
                const b2 = JSON.parse(JSON.stringify(base)); b2.sea.overviewLevel = { rank: b2.sea.level.rank, word: b2.sea.level.word };
                b2.summary.sea.accidentOnly = []; R.render(box, { ok: true, briefing: b2 }, { now }); out.noNote = !box.querySelector('[data-sb-level-note]') && !box.querySelector('[data-sb-komsa]');
                const b3 = JSON.parse(JSON.stringify(base)); b3.land.cards = []; b3.targetDate = '2026-10-18'; b3.generatedAt = '2026-10-17T23:00:00+09:00';
                R.render(box, { ok: true, briefing: b3 }, { now }); out.tomorrow = box.querySelector('[data-sb-land-none]').textContent;
                b3.targetDate = '2026-10-17'; b3.generatedAt = '2026-10-17T08:00:00+09:00'; R.render(box, { ok: true, briefing: b3 }, { now }); out.today = box.querySelector('[data-sb-land-none]').textContent;
                // §11.10 전에 저장된 브리핑(summary 없음 — 10-16·10-17 파일): 종전 문단·「근거 ▸」 모양 그대로
                const old = JSON.parse(JSON.stringify(base)); delete old.summary; old.overview = { land: '오늘 한림파출소 관할 육상은 주의 필요입니다. 따라서 협재해수욕장 주변 물가 접근에 주의가 필요합니다. 셋째 문장입니다.', sea: '오늘 한림파출소 관할 해상은 주의 필요입니다. 둘째. 셋째.', source: 'template', model: null };
                R.render(box, { ok: true, briefing: old }, { now });
                out.old = { paras: [...box.querySelectorAll('[data-sb-overview]')].map((e) => e.dataset.sbOverview + ':' + e.textContent), sum: box.querySelectorAll('[data-sb-summary]').length, basis: !!box.querySelector('details.sb-basis'), src: (box.querySelector('[data-sb-source]') || {}).textContent };
                // §11.10 판(10-17 낮에 저장 — summary 는 있지만 weather 칸이 없고 물때는 육상 덩어리 안) — 그 모양 그대로
                const v1 = JSON.parse(JSON.stringify(base)); delete v1.summary.weather; delete v1.summary.tide; delete v1.summary.analysis; v1.summary.land.tide = ['06:12 저조 뒤부터 물이 차오릅니다'];
                R.render(box, { ok: true, briefing: v1 }, { now });
                out.v1 = { parts: box.querySelectorAll('[data-sb-part]').length, landHead: (box.querySelector('[data-sb-summary="land"] .sb-headline') || {}).textContent || '', landTide: [...box.querySelectorAll('[data-sb-summary="land"] .sb-sum-tide')].map((x) => x.textContent) };
                // §11.10.1 판(10-17 저녁까지 저장 — summary.weather 는 있고 analysis 없음): 그 모양(결론 → 기상 → 물때 → 근거 → 해설) 그대로, 칩은 「연안」 이름표
                const v2 = JSON.parse(JSON.stringify(base)); delete v2.summary.analysis; delete v2.publishAt; v2.edition = 'morning'; v2.generatedAt = '2026-10-17T08:00:00+09:00';
                R.render(box, { ok: true, briefing: v2 }, { now });
                out.v2 = { parts: [...box.querySelectorAll('[data-sb-part]')].map((e) => e.dataset.sbPart), label: (box.querySelector('[data-sb-part="conclusion"] .sb-level-k') || {}).textContent, cm: box.querySelectorAll('[data-sb-commentary]').length, analysis: box.querySelectorAll('[data-sb-analysis]').length, title: R.titleText(v2), edition: box.querySelector('.sb-edition').textContent };
                R.render(box, { ok: true, briefing: null, nextExpectedAt: '2026-10-17T08:00:00+09:00' }, { now }); out.passed = box.textContent;
                R.render(box, { ok: true, briefing: null, nextExpectedAt: '2026-10-17T17:30:00+09:00' }, { now }); out.ahead = box.textContent;
                box.remove();
                out.sources = R.SOURCES;
                return out;
            }, { base, now: clock.now });
            assert.equal(r.note, false, '노란 안내 한 줄은 없다(§11.10.12)');
            assert.deepEqual(r.badges.map((x) => x.split(':').slice(0, 2).join(':')), ["2:1개 해역 주의 필요(KOMSA 예보)"], '배지 수 = summary.sea.accidentOnly(근거 줄과 같은 수) ' + r.badges.join(' / '));
            assert.equal(B.h.summary.sea.accidentOnly.reduce((a, g) => a + g.count, 0), B.h.sea.attentionRegions - B.h.sea.overviewRegions, '배지 수 합 = 위험예보만 해역 수');
            assert.ok(r.badgeNext, '배지는 「해상 ○○」 칩 바로 오른쪽, 결론 글 앞');
            assert.deepEqual(r.oldBadges, ['1개 해역 주의 필요(KOMSA 예보)'], '옛 판 — 카드로 셈');
            assert.equal(r.oldShort, 0, '옛 판에 카드가 모자라면 배지 없음(지어내지 않음)');
            assert.deepEqual(r.v2Badges, ['1개 해역 주의 필요(KOMSA 예보)'], '§11.10.1 판(결론 칸)에도 배지');
            assert.ok(r.noNote, '위험예보만 해역이 없으면 배지·줄 없음');
            assert.deepEqual([r.oldNoteLine, r.oldNote], [true, ''], '옛 판 note 가 있어도 위험예보만 해역 줄 풀이는 보이지 않음');
            assert.ok(r.seaCount.includes('관할 해역 ' + base.sea.reviewedRegions + '칸 검토 · 관심 이상 12칸(그중 해양사고 위험예보만 위험 단계인 해역 1칸 — 총평에는 올리지 않음)') && r.seaCount.includes('카드는 단계 높은 순 ' + base.sea.cards.length + '곳까지'), r.seaCount);
            assert.ok(r.landCount.includes('관심 이상 13곳 중 카드는 단계 높은 순'), r.landCount);
            // 10:05 에 본다 — 06~09시 칸은 끝났고 09~12시 칸은 아직(만드는 시각이 든 칸)
            assert.deepEqual(r.past, r.labels.map((l) => l === '06시')); assert.equal(r.pastOpacity, '0.4'); assert.ok(r.legend.includes('흐린 칸 = 이미 지난 시간'));
            assert.ok(r.tomorrow.startsWith('내일 평소와 달라진 요소'), r.tomorrow); assert.ok(r.today.startsWith('오늘 평소와 달라진 요소'), r.today);
            assert.ok(r.passed.includes('다음 브리핑을 준비 중입니다(10월 17일(토) 08:00 공개 예정)'), r.passed);
            assert.deepEqual([r.v2.parts, r.v2.label, r.v2.cm, r.v2.analysis, r.v2.title], [['conclusion', 'weather', 'tide', 'land', 'sea', 'commentary'], '연안', 2, 0, '08:00 AI 연안 안전 브리핑'], '§11.10.1 판(분석 문단 없음)은 그 모양 그대로 · 옛 정시 판 제목 시각 = 만든 시각');
            assert.equal(r.v2.edition, '10월 17일 08:00 기준 브리핑', '옛 정시 판(공개 시각 없음) = 만든 시각 · nextPublishAt 없으면 괄호 없음');
            assert.deepEqual([r.old.sum, r.old.basis], [0, true], '옛 브리핑은 새 모양 대신 종전 문단 + 근거 접힘');
            assert.deepEqual([r.v1.parts, r.v1.landHead, r.v1.landTide], [0, base.summary.land.headline, ['06:12 저조 뒤부터 물이 차오릅니다']], '§11.10 판 브리핑은 그 모양(육상 덩어리 안 물때) 그대로');
            assert.ok(r.old.paras[0].startsWith('land:연안 오늘 한림파출소 관할 육상은') && r.old.paras[1].startsWith('sea:해상 '), r.old.paras.join(' / ')); assert.ok(r.old.src.includes('기본 문장(틀)'), r.old.src);
            assert.ok(r.ahead.includes('다음 브리핑 공개: 10월 17일(토) 17:30'), r.ahead);
            // 출처 한 벌 — 꼬리 출처 줄 = [기준 상세] 표(같은 SOURCES)
            for (const [what, who] of r.sources) assert.ok(r.foot.includes(what + ' — ' + who), what);
            assert.ok(r.sources.some((x) => x[1] === '해양경찰청 선박사고 기록(국립해양조사원 개방海 제공)' && x[0].includes('2021~2025')));
            assert.ok(r.sources.some((x) => x[0].includes('익수·추락·고립·표류·기타') && x[0].includes('앞바다 500m') && x[0].includes('2020~2024')));
            assert.ok(r.sources.some((x) => x[1].includes('Gemini 보충')));
            await tap(page, '#station-briefing-content .sb-basis-btn'); await page.waitForSelector('.rf-modal .rf-basis');
            const rows = await page.evaluate(() => { const t = [...document.querySelectorAll('.rf-basis-body table')].find((x) => x.textContent.includes('쓰는 곳')); return [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent)); });
            assert.deepEqual(rows, r.sources, '[기준 상세] 출처 표 = 꼬리 출처 줄과 같은 목록');
            await page.keyboard.press('Escape');
        });
        // ── §11.10.3(2026-10-17 사용자 결정) — (고립 주의) 지점 표 · 해상 근거 칸·이름 · 근거 줄 ▸ 미니 지도(관할 + 깜빡이는 칸) · [기준 상세] ──
        await check('[§11.10.3] (물때) 아래 (고립 주의) — 「사고 지점(N개소)」 버튼(aria-expanded·aria-controls) → 「지점명 | 발생 건수」 표 전부(건수 많은 순) · 다시 누르면 접힘 · 「물이 차오르기 전에」·「공통」·「공식 사고예보」 없음 · 단위 칸', async () => {
            await openAcc(page); await openBasis(page, 'land'); await openBasis(page, 'sea');   // 근거·권고 글은 접힌 「분석 근거」 안(§11.10.4)
            const r = await page.evaluate(() => {
                const c = document.getElementById('station-briefing-content'), iso = c.querySelector('[data-sb-part="tide"] [data-sb-isolation]'), btn = iso && iso.querySelector('button[data-sb-x="iso"]');
                const out = { line: iso ? iso.querySelector('.sb-iso-line').textContent : '', btn: btn ? btn.textContent : '', exp0: btn && btn.getAttribute('aria-expanded'), ctl: btn && btn.getAttribute('aria-controls') };
                btn.click();
                const panel = document.getElementById(out.ctl);
                out.exp1 = btn.getAttribute('aria-expanded'); out.hidden1 = panel.hidden;
                out.head = [...panel.querySelectorAll('thead th')].map((x) => x.textContent); out.rows = [...panel.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((x) => x.textContent).join('|'));
                out.caption = (panel.querySelector('caption') || {}).textContent || '';
                btn.click(); out.exp2 = btn.getAttribute('aria-expanded'); out.hidden2 = panel.hidden; out.empty2 = panel.childElementCount === 0;
                out.text = c.textContent; out.sum = c.querySelector('[data-sb-sec="overview"]').textContent;
                return out;
            });
            assert.equal(B.h.summary.isolation.text, '(고립 주의) 저조 시간(06:12·18:40) 전후 사고 지점(2개소) 확인 및 주의가 필요합니다.');
            assert.equal(r.line, '(고립 주의) 저조 시간(06:12·18:40) 전후 사고 지점(2개소) ▸ 확인 및 주의가 필요합니다.', '버튼(▸)은 문장 안 그 자리');
            assert.deepEqual([r.btn, r.exp0, r.exp1, r.hidden1, r.exp2, r.hidden2, r.empty2], ['사고 지점(2개소) ▸', 'false', 'true', false, 'false', true, true]);
            assert.deepEqual(r.head, ['지점명', '발생 건수']); assert.deepEqual(r.rows, ['협재해수욕장|2건', '한림항|1건']);
            assert.equal(r.caption, '2020~2024 연안사고 기록 중 고립(관광지 구역 + 앞바다 500m)');
            for (const no of ['차오르기 전에', '공통', '공식 사고예보', '겹치지 않아']) assert.ok(!r.text.includes(no), no);
            for (const no of ['물가 접근', '시경 ']) assert.ok(!r.sum.includes(no), no + ' — 총평에는 없음(해역·관광지 카드 문장은 그대로)');
            assert.ok(r.text.includes('관할 해역 3칸 중 위험이 높아진 해역 2칸') && r.text.includes("해양사고 위험예보(KOMSA) 기준 등급 '주의'인 해역 1칸") && r.text.includes('주변 연안사고에 주의가 필요합니다.'), r.text.slice(0, 600));
        });
        await check('[§11.10.3] 해상 근거 ▸ — 위험이 높아진 해역·해양사고 위험예보만·대해구 232 줄이 버튼, 누르면 바로 아래 지도(관할 경계 + 그 칸 테두리 깜빡임), 접거나 다시 그리면 깜빡임이 멈춘다', async () => {
            const r = await page.evaluate(async () => {
                const sleep = (ms) => new Promise((res) => setTimeout(res, ms)), R = window.StationBriefingRender, c = document.getElementById('station-briefing-content');
                const btns = [...c.querySelectorAll('[data-sb-summary="sea"] button.sb-x-btn[data-sb-x^="map-"]')], out = { keys: btns.map((b) => b.dataset.sbX), texts: btns.map((b) => b.textContent) };
                out.note = (c.querySelector('[data-sb-basis="accidentOnly"] .sb-basis-note') || {}).textContent || '';
                const nowEl = c.querySelector('[data-sb-summary="sea"] > [data-sb-now]'); out.now = !!nowEl && nowEl.previousElementSibling.hasAttribute('data-sb-advice') && nowEl.previousElementSibling.previousElementSibling.hasAttribute('data-sb-analysis') && nowEl.nextElementSibling.classList.contains('sb-basis-x');   // §11.10.9 ⑤ — 분석 문단 → (권고) → 지금
                const one = async (b) => {
                    b.click(); await sleep(50);
                    const panel = document.getElementById(b.getAttribute('aria-controls')), m = panel.querySelector('.sb-minimap'), sb = m && m._sbMap;
                    const o = { exp: b.getAttribute('aria-expanded'), next: panel.parentElement === b.parentElement && !panel.hidden, map: m && m.dataset.sbMap, h: m && m.getBoundingClientRect().height,
                        area: sb ? sb.area.getFeatures().length : -1, hl: sb ? sb.hl.getFeatures().length : -1, blink: m && m.dataset.sbBlink, base: m && m.dataset.sbMapBase, count1: R.blinking(), cap: (panel.querySelector('.sb-minimap-cap') || {}).textContent || '' };
                    const p0 = m.dataset.sbBlinkPhase || '1'; await sleep(1300); o.phases = p0 + '>' + (m.dataset.sbBlinkPhase || '');
                    // 지도가 관할 전체를 담는다(관할 경계 상자가 지도 화면 안)
                    const ext = sb.map.getView().calculateExtent(sb.map.getSize()), ae = sb.area.getExtent(); o.fits = ext[0] <= ae[0] && ext[1] <= ae[1] && ext[2] >= ae[2] && ext[3] >= ae[3];
                    b.click(); o.exp2 = b.getAttribute('aria-expanded'); o.blink2 = m.dataset.sbBlink; o.count2 = R.blinking(); o.empty = panel.childElementCount === 0;
                    return o;
                };
                out.each = []; for (const b of btns) out.each.push(await one(b));
                // 펼친 채로 그 칸이 화면에서 떨어지면(본문을 다시 그림 — 새 판·관할 변경) 깜빡임이 스스로 멈춘다
                btns[0].click(); await sleep(50); out.before = R.blinking();
                const m0 = c.querySelector('.sb-minimap'), pn = m0.closest('.sb-x-panel'), li = pn.parentElement; pn.remove(); await sleep(800); out.afterDetach = R.blinking(); out.detachBlink = m0.dataset.sbBlink;
                li.appendChild(pn); btns[0].click(); out.afterClose = R.blinking();   // 되돌려 놓고 접기 — 이미 멈춘 지도를 두 번 세지 않는다
                return out;
            });
            assert.deepEqual(r.keys, ['map-overview', 'map-accidentOnly', 'map-haegu'], r.texts.join(' / '));
            assert.deepEqual(r.texts.map((t) => t.replace(/ ▸$/, '')), [B.h.summary.sea.basis[0], B.h.summary.sea.basis[1], B.h.summary.sea.basis[2]]);
            // §11.10.12: 위험예보만 해역 줄 = 「해양사고 위험예보(KOMSA) 기준 등급 '주의'인 해역 1칸」, 화살표 없음(다른 두 줄은 ▸ 그대로)
            assert.deepEqual([r.texts[1], r.texts[0].endsWith(' ▸'), r.texts[2].endsWith(' ▸')], ["해양사고 위험예보(KOMSA) 기준 등급 '주의'인 해역 1칸", true, true]);
            assert.ok(r.texts[2].startsWith('대해구 232 예보 15시부터 파고 2.4m·풍속 13m/s로 높아짐(예상)'), r.texts[2]);
            assert.equal(r.note, '', '풀이 줄 「(한국해양교통안전공단 예보에서는 …)」 없음(§11.10.12)');
            assert.ok(r.now, '「지금 … 선박 N척」은 해상 분석 문단 바로 아래(분석 근거 칸 위 — §11.10.4)');
            const hl = [2, 1, 1];
            r.each.forEach((o, i) => {
                assert.deepEqual([o.exp, o.next, o.map, o.area, o.hl, o.blink, o.count1, o.exp2, o.blink2, o.count2, o.empty], ['true', true, 'ol', 1, hl[i], 'on', 1, 'false', 'off', 0, true], JSON.stringify(o));
                assert.ok(o.h >= 190 && o.h <= 210, '지도 높이 약 200px — ' + o.h); assert.ok(o.fits, '관할 전체가 보이게 맞춤');
                assert.equal(o.base, 'khoa', '바탕은 관심해역 고르기 지도와 같은 해아름 바다지도(이 시험은 타일 요청을 막아 바탕이 비어 보인다)');
                assert.ok(/^[01]>[01]$/.test(o.phases) && o.phases !== '1>', '깜빡임 진행 ' + o.phases); assert.ok(o.cap.includes('한림파출소 관할 해역'), o.cap);
            });
            assert.ok(r.each[2].cap.includes('대해구 232'), r.each[2].cap);
            assert.equal(r.each[1].cap, "빨간 테두리(깜빡임) = KOMSA 기준 등급 '주의' 해역 · 파란 선 = 한림파출소 관할 해역", '§11.10.12 캡션');
            assert.deepEqual([r.before, r.afterDetach, r.detachBlink, r.afterClose], [1, 0, 'off', 0], '떼어 낸 지도는 다음 깜빡임에서 스스로 멈춘다');
        });
        await check('[§11.10.3] 움직임 줄이기 설정이면 깜빡이지 않고 굵은 테두리로만(static) · 380px 펼친 지도 스크린샷', async () => {
            await openBasis(page, 'sea');
            await page.emulateMedia({ reducedMotion: 'reduce' });
            const r = await page.evaluate(async () => {
                const b = document.querySelector('#station-briefing-content [data-sb-summary="sea"] button[data-sb-x="map-overview"]'); b.click(); await new Promise((res) => setTimeout(res, 700));
                const m = document.getElementById(b.getAttribute('aria-controls')).querySelector('.sb-minimap'); const o = { blink: m.dataset.sbBlink, phase: m.dataset.sbBlinkPhase || null, n: window.StationBriefingRender.blinking() }; b.click(); return o;
            });
            assert.deepEqual(r, { blink: 'static', phase: null, n: 0 });
            await page.emulateMedia({ reducedMotion: 'no-preference' });
            await page.setViewportSize({ width: 380, height: 844 });
            await page.evaluate(() => { const b = document.querySelector('#station-briefing-content [data-sb-summary="sea"] button[data-sb-x="map-accidentOnly"]'); b.click(); b.scrollIntoView({ block: 'center' }); });
            await page.waitForTimeout(600); await clean(page);
            const wide = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: innerWidth })); assert.ok(wide.doc <= wide.vw + 1, JSON.stringify(wide));
            await page.locator('#station-briefing-content [data-sb-summary="sea"]').screenshot({ path: path.join(SHOT, 'briefing_sea_map_380.png') });
            // §11.10.12 — 「해상 ○○」 칩 오른쪽 KOMSA 배지가 380px 에서 화면 안(넘치면 다음 줄로)
            const kb = await page.evaluate(() => { const x = document.querySelector('#station-briefing-content [data-sb-summary="sea"] .sb-conclusion [data-sb-komsa]'); x.scrollIntoView({ block: 'center' }); const r = x.getBoundingClientRect(); return { right: r.right, vw: innerWidth, text: x.textContent }; });
            assert.ok(kb.right <= kb.vw && kb.text === '1개 해역 주의 필요(KOMSA 예보)', JSON.stringify(kb));
            await page.locator('#station-briefing-content [data-sb-summary="sea"] .sb-conclusion').screenshot({ path: path.join(SHOT, 'briefing_komsa_badge_380.png') });
            await page.evaluate(() => { document.querySelector('#station-briefing-content button[data-sb-x="map-accidentOnly"]').click(); const i = document.querySelector('#station-briefing-content button[data-sb-x="iso"]'); i.click(); i.scrollIntoView({ block: 'center' }); });
            await page.waitForTimeout(200); await clean(page);
            await page.locator('#station-briefing-content [data-sb-part="tide"]').screenshot({ path: path.join(SHOT, 'briefing_isolation_380.png') });
            await page.evaluate(() => document.querySelector('#station-briefing-content button[data-sb-x="iso"]').click());
            await page.setViewportSize({ width: 412, height: 915 });
        });
        await check('[§11.10.3] [기준 상세] — 해양사고 위험예보(공단·3시간·단계)·칸 크기·결론에 넣지 않는 이유·「특보 가능성 기준」은 풍랑주의보 기준이 아님·지도 펼침·고립 지점 표', async () => {
            await tap(page, '#station-briefing-content .sb-basis-btn'); await page.waitForSelector('.rf-modal .rf-basis');
            const body = await page.evaluate(() => document.querySelector('.rf-basis-body').innerText);
            for (const k of ['해양사고 위험예보는 한국해양교통안전공단', '칸마다 3시간 간격', '낮음·보통·주의·경계', '약 3.9~4.2km', '혼잡 예보 칸(약 2.3×2.8km)', '같은 3시간 칸에', '선박 몰림', '특보 가능성 기준(파고 2m·풍속 12m/s)', '기상청 풍랑주의보 기준이 아닙니다', '풍속 14m/s 이상이 3시간 이상 지속되거나 유의파고가 3m를 초과', '이 기준을 넘을 때만', '깜빡이는 빨간 테두리', '고립', '지점명 | 발생 건수']) assert.ok(body.includes(k), k);
            assert.ok(!body.includes('공식 사고예보'), '[기준 상세]도 「해양사고 위험예보」');
            await page.keyboard.press('Escape');
        });
        await check('[UI-A7] 바로가기 — 위험예측에 없는 연안 날짜면 다른 날짜를 열지 않고 안내(토스트), 실패는 false', async () => {
            const r = await page.evaluate(() => window.StationBriefing.openInRisk({ kind: 'coast', id: '50110|협재해수욕장', date: '2026-10-25', location: { lon: 126.239, lat: 33.394 } }));
            assert.equal(r, false);
            const sel = await page.evaluate(() => { const a = window._riskForecastApp; return a && a.getState().selected; });
            assert.equal(sel, null, '다른 날짜의 시트를 조용히 열지 않는다');
            const t = await toastText(page); assert.ok(t.includes('이 관광지(10월 25일(일))') && t.includes('열지 못했습니다'), t);
        });
        await page.context().close();

        await check('[UI-A4] 설정 팝업 [관할 설정] — 저장하지 않은 관심해역 변경이 있으면 묻는다: 취소 → 팝업에 남고 변경 그대로 · 확인 → 저장하고 이동', async () => {
            const pg = await device({ admin: true });
            await pg.evaluate(() => window.openSettingsModal()); await pg.waitForTimeout(500);
            assert.equal(await pg.evaluate(() => window.settingsModalHasUnsaved()), false, '열자마자는 변경 없음(알림 칸 포함)');
            const changed = await pg.evaluate(() => { const c = document.querySelector('#settings-list-container input[type=checkbox]'); c.click(); return JSON.stringify(UserSettings.settings); });
            assert.equal(await pg.evaluate(() => window.settingsModalHasUnsaved()), true);
            const asked = [];
            pg.once('dialog', (d) => { asked.push(d.message()); d.dismiss(); });
            await pg.evaluate(() => document.getElementById('station-briefing-settings-edit').click()); await pg.waitForTimeout(300);
            assert.ok(asked[0] && asked[0].includes('저장하지 않은 변경'), String(asked[0]));
            assert.deepEqual(await pg.evaluate(() => [document.getElementById('settings-modal').classList.contains('hidden'), JSON.stringify(UserSettings.settings), !!document.querySelector('[data-sb-setup]')]), [false, changed, false], '취소 — 팝업·변경 그대로, 관할 고르기로 가지 않음');
            pg.once('dialog', (d) => d.accept());
            await pg.evaluate(() => document.getElementById('station-briefing-settings-edit').click()); await pg.waitForSelector('[data-sb-setup]');
            assert.deepEqual(await pg.evaluate(() => [document.getElementById('settings-modal').classList.contains('hidden'), localStorage.getItem('weatherAppSettings_v1')]), [true, changed], '확인 — 저장하고 관할 고르기');
            await pg.context().close();
        });

        await check('[UI-A5] 관리자 기기에서 노출 판정 조회가 잠깐 실패해도 아코디언이 사라지지 않고, 처음부터 실패하면 짧게 다시 물어 보인다', async () => {
            const pg = await device({ admin: true });
            assert.equal(await vis(pg, 'station-briefing-accordion-header'), true);
            let fails = 1;
            await pg.route('**/api/station-briefing/stations*', (rt) => fails-- > 0 ? rt.fulfill({ status: 503, body: '{}' }) : rt.continue());
            await pg.evaluate(() => window.StationBriefing.refresh()); await pg.waitForTimeout(300);
            assert.equal(await vis(pg, 'station-briefing-accordion-header'), true, '직전 판정(보임) 유지');
            await pg.context().close();
            // 처음 조회가 실패하는 기기 — 5초 뒤 다시 물어 보인다
            const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, timezoneId: 'Asia/Seoul' }), p2 = await ctx.newPage();
            p2.on('pageerror', (e) => errors.push(e.message));
            let first = 1;
            await p2.route('**/*', (rt) => { const u = rt.request().url(); if (!u.startsWith(base)) return rt.abort(); if (u.includes('/api/station-briefing/stations') && first-- > 0) return rt.fulfill({ status: 503, body: '{}' }); return rt.continue(); });
            await p2.clock.setFixedTime(new Date(clock.now));
            await p2.addInitScript(() => { localStorage.setItem('seagnal_admin_mode', 'true'); localStorage.setItem('push_token', 'admin-push-token'); });
            await p2.goto(base + '/'); await p2.waitForFunction(() => window.StationBriefing); await p2.waitForTimeout(800);
            assert.equal(await vis(p2, 'station-briefing-accordion-header'), false, '처음 실패 — 아직 안 보임');
            await p2.waitForFunction(() => getComputedStyle(document.getElementById('station-briefing-accordion-header')).display !== 'none', null, { timeout: 9000 });
            await ctx.close();
        });

        await check('[UI-A8] 관리자 모드를 끄면 다음 갱신을 기다리지 않고 바로 아코디언이 사라진다(노출 「관리자에게만」)', async () => {
            const pg = await device({ admin: true });
            assert.equal(await vis(pg, 'station-briefing-accordion-header'), true);
            await pg.evaluate(() => window._toggleAdminMode(false)); await pg.waitForTimeout(500);
            assert.equal(await vis(pg, 'station-briefing-accordion-header'), false);
            await pg.evaluate(() => window._toggleAdminMode(true)); await pg.waitForTimeout(500);
            assert.equal(await vis(pg, 'station-briefing-accordion-header'), true, '다시 켜면 바로 보임');
            await pg.context().close();
        });

        await check('[UI-A6] 점검 차단 — 「연안 안전 브리핑」 개별 차단: 일반 기기는 덮개 + 몸 숨김(정기 갱신에도 그대로), 관리자는 머리를 누르면 열림, 해제하면 노출 판정대로', async () => {
            real.writeConfig({ exposure: 'user' });
            const g = await device();
            await g.evaluate(() => window.applyFeatureBlocks(['station-briefing'])); await g.waitForTimeout(100);
            assert.ok(await g.$('#station-briefing-accordion-header .feature-block-overlay'), '머리에 점검 덮개');
            await g.evaluate(() => window.StationBriefing.refresh()); await g.waitForTimeout(400);
            assert.equal(await vis(g, 'station-briefing-accordion-body'), false, '정기 갱신이 몸을 되살리지 않는다');
            await g.evaluate(() => window.applyFeatureBlocks([])); await g.waitForTimeout(100);
            assert.deepEqual([!!(await g.$('#station-briefing-accordion-header .feature-block-overlay')), await vis(g, 'station-briefing-accordion-body')], [false, true]);
            await g.context().close();
            real.writeConfig({ exposure: 'admin' });
            const n = await device();
            await n.evaluate(() => { window.applyFeatureBlocks(['station-briefing']); window.applyFeatureBlocks([]); }); await n.waitForTimeout(100);
            assert.equal(await vis(n, 'station-briefing-accordion-body'), false, '차단을 풀어도 노출 판정이 「안 보임」이면 몸은 숨김 그대로');
            await n.context().close();
            const a = await device({ admin: true });
            await a.evaluate(() => window.applyFeatureBlocks(['station-briefing'])); await a.waitForTimeout(100);
            assert.equal(await vis(a, 'station-briefing-accordion-body'), false);
            await a.evaluate(() => document.getElementById('station-briefing-accordion-header').onclick(new MouseEvent('click'))); await a.waitForTimeout(400);
            assert.deepEqual(await a.evaluate(() => { const b = document.getElementById('station-briefing-accordion-body'); return [getComputedStyle(b).display !== 'none', b.classList.contains('collapsed')]; }), [true, false], '관리자는 차단 외관이어도 열린다');
            await a.context().close();
        });

        await check('[UI-A2] 일반 기기(노출 「사용자에게」) — [위험예측에서 보기 ›] 가 위험예측 미리보기 잠금을 풀지 않고, 탭도 옮기지 않고 안내', async () => {
            real.writeConfig({ exposure: 'user' });
            const g = await device();
            await pickStation(g, HALLIM); await g.waitForSelector('[data-sb-sec="overview"]'); await openAcc(g);
            const tab0 = await g.evaluate(() => document.body.getAttribute('data-active-tab'));
            await g.evaluate(() => document.querySelector('[data-sb-card="land"] .sb-link').click()); await g.waitForTimeout(700);
            const r = await g.evaluate(() => ({ locked: document.getElementById('ocean-risk-forecast-toggle-btn').classList.contains('rf-preview-locked'), tab: document.body.getAttribute('data-active-tab'), app: !!window._riskForecastApp }));
            assert.deepEqual([r.locked, r.tab, r.app], [true, tab0, false]);
            assert.ok((await toastText(g)).includes('미리보기'), await toastText(g));
            assert.equal(await g.evaluate(() => window.RiskForecast.openAt({ kind: 'coast', id: '50110|협재해수욕장' })), false, 'openAt 도 일반 기기 잠금을 풀지 않는다');
            assert.equal(await g.evaluate(() => document.getElementById('ocean-risk-forecast-toggle-btn').classList.contains('rf-preview-locked')), true);
            await g.context().close();
            real.writeConfig({ exposure: 'admin' });
        });

        await check('[UI-A3] 「노출 안 함」으로 바꾸면 열려 있는 기기(관할 미설정 포함)도 10분 정기 갱신에 사라진다', async () => {
            real.writeConfig({ exposure: 'user' });
            const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, timezoneId: 'Asia/Seoul' }), p3 = await ctx.newPage();
            p3.on('pageerror', (e) => errors.push(e.message));
            await p3.route('**/*', (rt) => rt.request().url().startsWith(base) ? rt.continue() : rt.abort());
            await p3.clock.install({ time: new Date(clock.now) });
            await p3.goto(base + '/'); await p3.waitForFunction(() => window.StationBriefing); await p3.clock.runFor(3000); await p3.waitForTimeout(800);
            assert.equal(await vis(p3, 'station-briefing-accordion-header'), true, '관할 미설정 일반 기기에 보임');
            real.writeConfig({ exposure: 'off' });
            await p3.clock.runFor(11 * 60 * 1000); await p3.waitForTimeout(1200);
            assert.equal(await vis(p3, 'station-briefing-accordion-header'), false, '10분 안에 사라짐');
            await ctx.close();
            real.writeConfig({ exposure: 'admin' });
        });
        await check('지도에서 고른 관할이 저장되고(이 기기) 다시 열어도 그대로 — 지도 탭으로 고르고 [저장] → 새로고침 → 브리핑·설정 화면에 선택 유지', async () => {
            const g = await device({ admin: true }); await openAcc(g);
            await g.evaluate(() => window.openStationBriefingSetup()); await g.waitForSelector('[data-sb-setup]');
            await tap(g, '.sb-sea-btn[data-sea="제주"]'); const [x, y] = await polyPoint(g, HALLIM); await g.mouse.click(x, y);
            await g.waitForFunction(() => document.querySelector('.sb-picked').textContent.startsWith('선택: 한림파출소'), null, { timeout: 3000 });
            await g.click('[data-sb-pick-dialog] [data-sb-save]'); await g.waitForSelector('[data-sb-sec="overview"]');   // 실제 마우스로 창의 [저장]
            assert.equal(await g.evaluate(() => !document.querySelector('[data-sb-pick-dialog]') && !window.PopupStack.list().includes('sb-pick-dialog')), true, '저장하면 창이 닫힌다');
            assert.equal(await g.evaluate(() => JSON.parse(localStorage.getItem('seagnal_station_briefing_v1')).station), HALLIM);
            await g.reload(); await g.waitForFunction(() => window.StationBriefing); await g.waitForTimeout(900); await clean(g); await openAcc(g);
            await g.waitForSelector('[data-sb-sec="overview"]');
            await g.evaluate(() => window.openStationBriefingSetup()); await g.waitForSelector('[data-sb-setup]');
            assert.equal(await g.$eval('.sb-picked', (e) => e.textContent), '선택: 한림파출소 · 제주해양경찰서');
            assert.equal(await g.$eval('.sb-station-btn[data-key="' + HALLIM + '"]', (e) => e.getAttribute('aria-pressed')), 'true');
            await tap(g, '[data-sb-tab="list"]');
            assert.deepEqual(await g.evaluate(() => [...document.querySelectorAll('.sb-acc-btn')].filter((b) => b.getAttribute('aria-expanded') === 'true').map((b) => b.textContent)), ['제주지방해양경찰청', '제주해양경찰서'], '목록 탭에는 지금 관할 묶음이 펼쳐져 있다');
            await tap(g, '[data-sb-cancel]'); await g.waitForSelector('[data-sb-sec="overview"]');
            await g.context().close();
        });
        await check('실행 오류 없음', async () => { assert.deepEqual(errors, []); });
    } catch (e) { console.error('❌ 준비 실패', e && e.stack); fail++; }
    finally { if (browser) await browser.close(); if (server) server.close(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 임시 폴더 */ } }
    console.log('스크린샷: ' + SHOT);
    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();
