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
 *         §11.10.10(2026-10-17): 「관할 내 잠기는 바위(간출암) N곳」 링크 → 팝업 지도(관할 경계 + 바위 마커) → 마커 → 해양안전 「위험지형」과 같은 간출암 조석 곡선 상자(HazardRockTidePanel,
 *                                /api/hazard-rocks/tide-curve 는 시험값으로 가로챔) · 해양안전 위험지형 팝업도 같은 함수로 그대로 뜨는지 · (고립 주의) 「과거 고립 사고(N개소 M건)」 화살표 없음 · 「지점명 | 발생 현황」
 *                                · 「아직 이 관할의 브리핑이 없습니다」·관리자 미리보기 「예정 — …」 안내 없음(briefing_rocks_popup_360.png).
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
            weather: { 232: { label: '232해구', rows: [[6, 0.8, 5], [9, 1.0, 6], [12, 1.4, 9], [15, 2.4, 13], [18, 2.6, 14], [21, 1.8, 10]].map(([h, wh, ws]) => ({ at: at(h), wh, ws })) } },
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
 * §11.10.3 재료를 한림 입력에 덧붙인다 — 실제 한림 관할 도형(정리판 → areaOf), 해역 칸 상자, 232해구 상자, 해양사고 위험예보만 '주의'인 해역 하나(해구 예보가 없는 231해구 — 기상 근거가 겹치지 않게,
 * 지속 칸이 1칸이라 첫 해역 카드는 그대로 A:1001 — 바로가기 시험), 관광지 고립 사고 수.
 * 예: mapInputs(hallimInput()) → {..., area:[[[…]]], sea:{regions:[…box], weather:{232:{box}}}, land:{spots:[…isolation]}}
 * @param {Object} inp @returns {Object} [연계] ← makeBriefings(한림만)
 */
function mapInputs(inp) {
    const hl = I.loadStations().find((s) => s.name === '한림파출소'), sq = (lon, lat) => [lon - 0.0125, lat - 0.0125, lon + 0.0125, lat + 0.0125];
    const regions = inp.sea.regions.map((r) => ({ ...r, box: r.rid === 'A:1001' ? [126.525, 33.55, 126.55, 33.575] : sq(r.lon, r.lat) }))
        .concat([{ rid: 'A:1003', gridId: null, accidentGridId: '1003', lat: 33.35, lon: 126.2, box: [126.18, 33.33, 126.22, 33.37], haegu: { major: 231, sub: 6, label: '231-6' }, ref: { name: '모슬포', distNm: 6.0, bearingWord: '북서' }, zone: null, zones: [], slots: { [at(9)]: { accident: '주의' } }, history: { count: 0 } }]);
    const iso = { '50110|협재해수욕장': 2, '50110|한림항': 1 }, years = { '50110|협재해수욕장': { 2022: 1, 2024: 1 }, '50110|한림항': { 2023: 1 } };
    // §11.10.10 — 잠기는 바위 2곳(collectTide 꼴 items: hazard_rocks.json id·위치·간출 높이·그날 잠기는 시각 — 시험값, 한림항 앞)
    const rocks = { count: 2, first: '02:40', last: '16:41', items: [{ id: 812, lat: 33.4205, lon: 126.2560, v: 0.9, times: ['02:40'] }, { id: 77, lat: 33.4105, lon: 126.2350, v: 1.4, times: ['03:10', '16:41'] }] };
    return { ...inp, area: I.areaOf(hl.geometry), sea: { ...inp.sea, regions, weather: { 232: { ...inp.sea.weather[232], box: I.haeguBox(232) } } }, tide: { ...inp.tide, rocks },
        land: { ...inp.land, spots: inp.land.spots.map((x) => ({ ...x, isolation: iso[x.id] || 0, isolationYears: years[x.id] || {} })) } };
}
const WIN = R.editionWindow('morning', Date.parse(at(8)));
/** 날짜 파일 하나를 쓴다(실제 서비스가 pick 으로 읽는다). @param {string} date @param {Object} stations [연계] ← 준비 */
function writeDay(date, stations) { fs.writeFileSync(path.join(dir, 'briefings_' + date + '.json'), JSON.stringify({ date, stations })); }
function makeBriefings() {
    const h = R.buildBriefing({ ...mapInputs(hallimInput()), zoneWeather: I.collectZoneWeather({ lat: 33.41, lon: 126.26 }, REGIONAL) }, WIN, { generatedAt: '2026-10-17T13:10:00+09:00' });
    h.trigger = { kind: 'warning', zones: ['제주도서부앞바다'] }; h.edition = 'warning';
    // AI 분석 문단(§11.10.4 — 3~5문장). 해상 분석에 HTML 문자열을 넣어 textContent 로만 들어가는지 본다.
    h.overview = { land: '협재해수욕장은 방문객이 평소의 1.8배로 예상돼 주의 수준입니다. 해안 바람 9m/s로 튜브가 떠밀릴 수 있습니다. 따라서 협재해수욕장 주변 연안사고에 주의가 요구됩니다.', sea: XSS + ' 15시부터 파고가 높아집니다. 21시부터 예비특보 구역에 들어갑니다. 따라서 비양도 주변 해역 운항에 주의가 요구됩니다.', source: 'chatgpt', model: 'gpt-6-luna' };
    h.sea.cards[0].advice = XSS + h.sea.cards[0].advice;   // §11.10.13: 규칙 v14 카드는 sentence 대신 [권고](advice)를 그린다
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
        const hzReq = [], HZ = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'coastal_safety', 'coastal_hazard_zones.wgs84.geojson'), 'utf8'));
        const store = { sources: () => inputs.sources, marineInputs: () => inputs,
            meta: () => { const a = { coast: T.timeline(clock.now, 3, 2, 21), sea: T.timeline(clock.now, 1, 2, 23) }; return { now: T.isoKst(clock.now), versions: { spots: 'v1', cells: 1, accident: 'v1' }, timeline: { sea: { times: a.sea }, accident: { times: a.coast }, coast: { times: a.coast } }, sources: inputs.sources }; },
            spots: () => ({ spots }), cells: () => ({ cells: [cell] }), accidentCells: () => ({ v: 'v1', cells: [acc] }), accidentFrame: () => ({ v: 'v1', cells: [[0, .001, '주의']] }),
            frame: (sea) => sea ? { cells: [[0, 0, 1, '낮음']], spots: [], borders: [] } : { spots: spots.map((s) => [s.i, 3]), borders: [] },
            coastDayFrame: () => ({ spots: spots.map((s) => [s.i, 3]), degraded: [] }),
            coastDayDetail: (id, t) => ({ title: '연안 ' + id, subtitle: { lat: 33.394, lon: 126.239 }, clickable: false, t }), islands: () => ({ features: [] }),
            // §11.10.20 연안 카드 [위치 보기] — 실제 위험구역 자료(coastal_hazard_zones.wgs84.geojson)에서 그 id(name)만(risk_store.hazards 와 같은 거르기), 요청 ids 를 남긴다
            hazards: (ids) => { hzReq.push(ids.join(',')); return { type: 'FeatureCollection', features: HZ.features.filter((f) => ids.includes(f.properties.name)) }; } };
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
            // §11.10.16 소절(C): 화면은 「총평과 권고」만 펼친 채 시작한다. 기존 시험들은 칸 안 내용의 위치·크기·넘침을 재므로, 그린 직후 칸을 모두 펼쳐 둔다
            //   (닫힌 칸은 max-height 0·overflow hidden 이라 가로 넘침 같은 검사가 헛돌 수 있다). 처음 상태 자체는 window.__sbKeepDefault = true 로 끄고 [§11.10.16-C] 가 본다.
            await page.addInitScript(() => {
                Object.defineProperty(window, 'StationBriefingRender', { configurable: true, get() { return undefined; }, set(v) {
                    const orig = v.render; v.render = function (box) { const r = orig.apply(this, arguments); if (!window.__sbKeepDefault && box) box.querySelectorAll('.sb-sec:not(.open)').forEach((x) => { x.classList.add('open'); x.querySelector('.marine-forecast-sub-header').setAttribute('aria-expanded', 'true'); }); return r; };
                    Object.defineProperty(window, 'StationBriefingRender', { value: v, writable: true, configurable: true }); } });
            });
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
        await check('본문 — 총평 「가」 모양(칩 「연안/해상 ○○」 — §11.10.16 부터 「필요」 없음·결론·AI 분석 문단·접힌 분석 근거(누르면 (근거)·(권고))·지금 밀집은 해상 분석 아래·(기상)·(물때)) · 「특별 상황」 칸 없음(§11.10.16 소절) · 해상 시간 막대(⚑) · 해역 카드 · 연안 카드 · 상시 위험 장소 · 조석 게이지 · 기준 시각·참고 정보', async () => {
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
                    special: qa('.sb-special-title').map((e) => e.textContent), wxbox: (() => { const x = q('[data-sb-summary="sea"] [data-sb-warnbox="basis"]'); return x ? { rows: x.querySelectorAll('tbody tr').length } : null; })(), slots: qa('.sb-slot').length, flags: qa('.sb-slot[data-event]').length, seaCards: qa('[data-sb-card="sea"]').length,
                    landCards: qa('[data-sb-card="land"]').length, links: qa('.sb-link').length, constant: (q('details.sb-constant summary') || {}).textContent || '', landSecTitle: (q('[data-sb-sec="land"] .marine-forecast-sub-title') || {}).textContent,
                    gauge: !!q('.sb-tide .ocean-tide-progress-track'), peaks: qa('.sb-tide .ocean-tide-peak-row').length, tideText: qa('.sb-tide-text').map((e) => e.textContent),
                    foot: (q('.sb-foot') || {}).textContent || '', edition: (q('.sb-edition') || {}).textContent || '', title: document.getElementById('station-briefing-title').textContent };
            });
            const s0 = await grab();
            assert.deepEqual(s0.secs, ['overview', 'sea', 'land', 'tide'], '「특별 상황」 칸 없음(§11.10.16 소절 D)');
            assert.deepEqual(s0.parts, ['land', 'sea', 'weather', 'tide'], '연안 덩어리 → 해상 덩어리 → (기상) → (물때)'); assert.equal(s0.oldPara, 0, '새 브리핑은 옛 문단을 그리지 않음'); assert.equal(s0.cms, 0, '종전 「해설」 칸 없음');
            assert.deepEqual(s0.land.kids, ['conclusion', 'analysis', 'sb-sum-advice sb-adv', 'basis-btn', 'basis-panel']); assert.deepEqual(s0.sea.kids, ['conclusion', 'analysis', 'sb-sum-advice sb-adv', 'now', 'basis-btn', 'basis-panel'], '분석 문단 → (권고) → 지금 밀집 → 근거 배지(§11.10.9 ⑤)');
            assert.deepEqual(s0.con.map((x) => x.chip + '|' + x.head), ['연안 주의|' + B.h.summary.land.headline, '해상 주의|오늘 한림파출소 관할 해상의 단계는 "주의"입니다.']);   // §11.10.16 — 「필요」 없음 assert.ok(s0.con.every((x) => Number(x.w) >= 700), '결론은 굵게');
            assert.deepEqual([s0.land.btn, s0.land.exp, s0.land.hidden, s0.land.basis.length, s0.sea.btn, s0.sea.exp, s0.sea.hidden], ['연안 분석 근거 상세 보기', 'false', true, 0, '해상 분석 근거 상세 보기', 'false', true], '분석 근거는 처음에 접혀 있다(§11.10.9 — 알약 배지 「… 상세 보기」)');
            assert.deepEqual([s0.land.tag, s0.land.anSrc, s0.sea.tag, s0.sea.anSrc], ['AI 분석 · ChatGPT', 'chatgpt', 'AI 분석 · ChatGPT', 'chatgpt']);
            const spL = SPLIT(B.h.overview.land); assert.ok(spL, '고정 AI 문단은 「따라서」로 끝난다');
            assert.equal(s0.land.an, 'AI 분석 · ChatGPT ' + spL.body); assert.deepEqual([s0.land.adv, s0.land.advSrc], ['[권고] ' + spL.advice, 'analysis'], '마지막 「따라서 …」는 (권고) 줄 — 「따라서」 없이'); assert.ok(s0.now.includes('37척'));
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
            assert.deepEqual(s.land.ks, [], '근거 칸에서는 (권고)를 뺐다(§11.10.9 ⑤) · 맨 위 「(근거)」 제목 줄도 없음(§11.10.20 덧붙임 — 사용자 「(근거) 빼자」)'); assert.deepEqual(s.land.basis, B.h.summary.land.basis); assert.equal(s.land.advice, undefined);
            assert.ok(s.land.basis.some((x) => x.includes('방문객 평소의 1.8배(예상)')), '예상 표기 — ' + s.land.basis.join(' / '));
            assert.deepEqual(s.sea.ks, [], '「(근거)」 제목 줄 없음(§11.10.20 덧붙임)'); assert.deepEqual(s.sea.basis, B.h.summary.sea.basis);
            assert.ok(!s.basisOld, '옛 「근거 ▸」(details) 없음'); assert.equal(s.source, null, '§11.10.9 — 맨 아래 「분석 문단은 ChatGPT가 썼습니다 …」 줄 없음(이름표만)');
            assert.equal(s.special.length, 0, '「특별 상황」 칸 없음(§11.10.16 소절 D)');
            assert.ok(B.h.special.length >= 2 && s.wxbox && s.wxbox.rows === B.h.summary.sea.warnings.rows.length, '해제 예고·예비특보는 해상 근거 안 「기상특보 현황」 상자(§11.10.16 소절 E2) ' + JSON.stringify(s.wxbox));
            assert.equal(s.slots, B.h.sea.timeBar.length); assert.equal(s.flags, B.h.sea.timeBar.filter((x) => x.events.length).length); assert.ok(s.flags >= 1);
            assert.equal(s.seaCards, B.h.sea.cards.length); assert.equal(s.landCards, B.h.land.cards.length); assert.equal(s.links, s.seaCards + s.landCards);
            assert.ok(s.constant.startsWith('상시 위험 장소'));
            assert.ok(s.gauge, '오늘 판이라 해양종합정보와 같은 진행 게이지'); assert.equal(s.peaks, 4); assert.ok(s.tideText[0].includes('저조 뒤부터 물이 차오릅니다'), s.tideText[0]);
            // §11.10.20: 「기준 시각 … 판」·「다루는 시간」 줄 없음 · 노란 안내(옛 「참고 정보이며 …」 대체) · 2026-10-18 「데이터 출처 보기」 삭제(출처는 [기준 상세]에만)
            assert.equal(s.foot, '※각종 정보(API, 기상정보 등) 기반 AI 분석 결과로, 실제 현장상황과 다를 수 있습니다.', s.foot);   // §11.10.28 앞 「※」 칸
            assert.equal(s.edition, '10월 17일 13:10 기준 브리핑 (다음 갱신 17:30 또는 특보 변경 시)', '§11.10.9 ⑦ — 판 종류·생성 시각 없이, 제목과 같은 시각 + 다음 갱신');
            assert.ok(s.title.startsWith(/\d{2}:\d{2}/.exec(s.edition)[0] + ' '), '제목 시각 = 머리 글 시각 — ' + s.title);
            await page.evaluate(() => { document.querySelectorAll('#station-briefing-content button[data-sb-x^="basis-"]').forEach((x) => { if (x.getAttribute('aria-expanded') === 'true') x.click(); }); });
        });
        await check('서버 글은 textContent — HTML 문자열이 글자로 보이고 img 가 생기지 않는다', async () => {
            const r = await page.evaluate(() => ({ imgs: document.querySelectorAll('#station-briefing-content img').length, xss: window.__xss || null, sea: document.querySelector('[data-sb-analysis="sea"]').textContent, card: [...document.querySelector('[data-sb-card="sea"]').querySelectorAll(':scope > .sb-row')].pop().querySelector('.sb-row-v').textContent }));
            assert.equal(r.imgs, 0); assert.equal(r.xss, null); assert.ok(r.sea.includes('<img src=x onerror=')); assert.ok(r.card.startsWith('<img'), r.card);
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
                out.li = rb.parentElement.firstChild.textContent + rb.textContent; out.cap = !!t.querySelector('caption'); const lv = t.querySelector('.sb-raised-lv'), us = t.querySelector('.sb-raised-usual'); out.lvStyle = lv ? [getComputedStyle(lv).fontWeight, lv.style.color !== ''] : null; out.usColor = us ? getComputedStyle(us).color : null; out.chips = t.querySelectorAll('.sb-chip').length;
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
            // 2026-10-18 「시안이 기준이 되어야 해.」(Main.dc.html) — 위 3곳 + 「[나머지 N곳 — …]」 · 설명 줄 없음 · 칩 없음(평소 흐린 글·단계 말 굵게 단계 색)
            assert.deepEqual(r.head, ['관광지', '평소', '오늘(예상)']); assert.equal(rz.rows.length, B.h.land.attentionSpots, '서버 자료는 관심 이상 관광지 전부');
            const top = rz.rows.slice(0, 3).map((x) => [x.name, '평소 수준', x.word + x.reason]), rest = rz.rows.slice(3);
            const restTxt = rest.length ? '[나머지 ' + rest.length + '곳 — ' + [[3, '경계'], [2, '주의'], [1, '관심']].map(([k, w]) => [w, rest.filter((x) => x.rank === k).length]).filter(([, n]) => n).map(([w, n]) => w + ' ' + n + '곳').join(' · ') + ']' : null;
            assert.deepEqual(r.rows, restTxt ? top.concat([[restTxt]]) : top); assert.ok(r.li.startsWith(B.h.summary.land.basis[0].slice(0, 20)), r.li);
            assert.deepEqual([r.cap, r.chips, r.lvStyle, r.usColor], [false, 0, ['800', true], 'rgb(147, 160, 184)']);
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
            // §11.10.11 사용자 결정 「아예 빼 받지 못함 안내 넣지 말고」 — 뽑지 못함·못 받음도 칸째 없음(머리·안내·출처 줄 없음)
            for (const k of ['unparsed', 'missing']) { assert.deepEqual(v[k].heads, ['제주도서부앞바다 기상 현황'], k + ' — 특이사항 칸째 없음'); assert.ok(!v[k].text.includes('특이사항') && !v[k].text.includes('뽑지 못했') && !v[k].text.includes('확인하지 못했') && !v[k].text.includes('단기 전망 ('), k + ' — ' + v[k].text); }
            assert.deepEqual(v.far.heads[0], '동해중부안쪽먼바다 기상 현황'); assert.ok(!v.far.text.includes('115.9km') && !v.far.text.includes('떨어져'), '먼 구역 거리 안내 없음 — ' + v.far.text);
            assert.ok(!v.dist.text.includes('약 0.1km') && !v.dist.text.includes('대표 위치'), v.dist.text);
            await page.setViewportSize({ width: 412, height: 915 });
        });
        await check('[§11.10.9 ④⑤] 분석 문단 강조(특보 예정 = 굵게 노랑 · 발효 = 굵게 빨강 · 장소 주어·방문객 배수 굵게 · 단계 말 = 그 단계 색) · 마지막 「따라서 …」 → (권고) 줄(근거 칸 (권고)와 같은 모양) · 근거 칸 (권고) 없음 · 문단이 없으면 서버 권고 · 「따라서」가 없는 옛 문단은 근거 칸 (권고) 그대로', async () => {
            const base = JSON.parse(JSON.stringify(B.h));
            const r = await page.evaluate(({ base, now }) => {
                const R = window.StationBriefingRender, box = document.createElement('div'), out = {}; box.className = 'sb-wrap'; document.getElementById('station-briefing-content').appendChild(box);
                const b = JSON.parse(JSON.stringify(base));
                b.overview.land = "하트해변은 연안 위험지수 '매우 높음'으로 경계 수준이며, 방문객이 평소의 2.4배로 예상됩니다. 위험구역이 있고, 풍랑주의보 예비특보가 10월 18일 06~12시에 발효될 예정이어서 연안 상황 변화에 유의해야 합니다. 봉평해수욕장과 후정해수욕장은 연안 위험지수 '높음'으로 주의 수준이며, 방문객이 각각 평소의 2.2배와 2.8배로 예상됩니다. 따라서 하트해변에는 경계가, 봉평해수욕장과 후정해수욕장에는 주의가 요구됩니다.";   // §11.10.16 꼴(시안)
                b.overview.sea = '제주도북부앞바다에는 풍랑주의보가 발효 중이어서 물결이 높습니다. 둘째 문장입니다. 따라서 비양도 주변 해역 운항에 주의가 요구됩니다.';
                b.land.attentionAll = (b.land.attentionAll || []).concat(['하트해변', '봉평해수욕장', '후정해수욕장'].map((n) => ({ name: n, rank: 2 })));
                R.render(box, { ok: true, briefing: b }, { now });
                const an = box.querySelector('[data-sb-analysis="land"]'), sea = box.querySelector('[data-sb-analysis="sea"]');
                const spans = (e) => [...e.querySelectorAll('.sb-hl')].map((x) => ({ t: x.textContent, c: [...x.classList].filter((k) => /^sb-hl-/.test(k) && k !== 'sb-hl-red').map((k) => k.slice(6))[0], red: x.classList.contains('sb-hl-red'), color: getComputedStyle(x).color, w: getComputedStyle(x).fontWeight, link: x.tagName === 'BUTTON' }));   // §11.10.16 E1: 특보 토막은 링크 단추(같은 종류 이름·색)
                out.land = spans(an); out.sea = spans(sea); out.landText = an.textContent; out.html = an.innerHTML.includes('<img'); out.band4 = window.RiskFormat.BAND_COLORS['매우 높음'];
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
            assert.deepEqual(pick(r.land), ['b:하트해변은', "lv:'매우 높음'", 'lv:경계', 'b:방문객이 평소의 2.4배로 예상', 'warn-pre:풍랑주의보 예비특보가 10월 18일 06~12시에 발효될 예정', 'b:봉평해수욕장과 후정해수욕장은', "lv:'높음'", 'lv:주의', 'b:방문객이 각각 평소의 2.2배와 2.8배로 예상'], '「경계 수준」의 「경계」도 단계 색(§11.10.16 — 시안)');
            const col = (c) => 'rgb(' + c.join(', ') + ')';
            assert.equal(r.land.find((x) => x.c === 'warn-pre').color, col([242, 194, 48]), '예비특보·예정 = 노랑(위험예측 4색의 「다소 높음」)');
            // §11.10.11: 문단 글자의 빨강만 #e34842(227,72,66 — 대비 4.5 이상), 노랑·주황은 4색 그대로
            assert.equal(r.land.find((x) => x.t === "'매우 높음'").color, col([227, 72, 66])); assert.equal(r.land.find((x) => x.t === "'높음'").color, col([251, 146, 60]));
            assert.ok(r.land.every((x) => Number(x.w) >= 700), '모두 굵게');
            assert.deepEqual(pick(r.sea), ['warn-on:풍랑주의보가 발효 중'], '발효 = 빨강'); assert.equal(r.sea[0].color, col([227, 72, 66]));
            assert.ok(!r.landText.includes('따라서'), '마지막 「따라서」 문장은 문단에서 빠진다');
            // §11.10.20 덧붙임 8·11: 머리 「[권고]」 · 본문 속 등급 말만 등급 색(경계 빨강·주의 주황) — 그 밖(장소 이름)은 강조 없음
            assert.equal(r.adv, '[권고] 하트해변에는 경계가, 봉평해수욕장과 후정해수욕장에는 주의가 요구됩니다.'); assert.equal(r.advSpans, 2, '[권고] 상자 안 강조 = 등급 말 둘');
            assert.equal(r.basisAdv, false, '근거 칸 (권고) 없음');
            assert.deepEqual([r.old.inline, r.old.basis], [false, '[권고] ' + B.h.summary.land.advice], '「따라서」가 없는 옛 문단 — 문단 그대로·근거 칸 (권고) 그대로');
            assert.deepEqual(r.newStyle, r.old.style, '본문 (권고) = 근거 칸 (권고)와 같은 색·굵기');
            assert.deepEqual(r.none, ['summary', '[권고] ' + B.h.summary.land.advice], '문단이 없으면 서버 권고를 결론 아래에');
            const lum = (c) => { const v = (c.match(/\d+/g) || []).slice(0, 3).map(Number).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
            const cr = (fg) => { const a = lum(fg), b = lum(r.bg); return +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2); };
            console.log('   [대비] 바탕 ' + r.bg + ' — 노랑 ' + cr('rgb(242, 194, 48)') + ' · 주황 ' + cr('rgb(251, 146, 60)') + ' · 빨강(문단) ' + cr(r.sea[0].color) + '(4색 빨강 ' + cr('rgb(224, 50, 44)') + ') · 굵은 흰 글 ' + cr('rgb(248, 250, 252)'));
            // §11.10.11 고정: 문단 빨강(발효·경계)은 그 카드 바탕 위 WCAG AA 4.5 이상 · 앱 전체 4색(지도·배지)은 바꾸지 않음
            assert.deepEqual(r.land.concat(r.sea).filter((x) => x.red).map((x) => x.t), ["'매우 높음'", '경계', '풍랑주의보가 발효 중'], '.sb-hl-red = 경계 단계·발효만');
            assert.equal(r.bg, 'rgb(10, 16, 31)', '대비를 잰 바탕(어두운 카드)'); assert.ok(cr(r.sea[0].color) >= 4.5 && cr(r.land.find((x) => x.t === "'매우 높음'").color) >= 4.5, '빨강 대비 ' + cr(r.sea[0].color));
            assert.equal(r.band4, '#e0322c', '위험예측 4색 「매우 높음」 그대로');
        });
        await check('[§11.10.9 ⑥] 팝업 지도 — 분석 문단의 대해구 이름·「관할 해역 선박 N척」·붐비는 해역 이름이 링크 · 누르면 가운데 창(role=dialog·aria-modal) 지도(관할 경계 + 대해구 테두리 / 선박 격자 + 칸 안 척수 / 그 격자 깜빡임) · ✕·Esc·바깥으로 닫힘 · 360px', async () => {
            await page.setViewportSize({ width: 360, height: 780 }); await openAcc(page);
            const hg = B.h.summary.sea.haegu; assert.ok(Array.isArray(hg) && hg.length === 1 && hg[0].major === '232' && hg[0].box.length === 4, JSON.stringify(hg));
            const base = JSON.parse(JSON.stringify(B.h));
            const r = await page.evaluate(({ base, now, hgName, nowObj }) => {
                const R = window.StationBriefingRender, box = document.getElementById('station-briefing-content'), out = {};
                const b = JSON.parse(JSON.stringify(base)); b.overview.sea = hgName + '는 유의파고 2.6m·풍속 14m/s로 물결이 높고 바람이 매우 강할 것으로 예상됩니다. 2320해구 같은 다른 번호는 링크가 아닙니다. 따라서 비양도 주변 해역 운항에 주의가 필요합니다.';
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
            assert.deepEqual(r.links.filter((l) => !l.startsWith('warn:')), ['haegu:' + hg[0].name, 'now-all:관할 해역 선박 37척', 'now-busiest:한림항 북서방 1.2해리 해역(232-2해구)', 'rocks:잠기는 바위(간출암) 2곳', 'rocks:잠기는 바위(간출암) 2곳'], '2320해구 은 링크가 아님 · (물때)·조석 칸의 잠기는 바위 링크(§11.10.10)');
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
        // §11.10.13(2026-10-17 사용자 *"이 텍스트는 아래 또 나오니까 필요없는거 아니니? 개별로 나오잖아"*): 칸 아래 설명 줄과 칸 누르기를 없앴다 — 칸은 그림(role=img)과 aria-label 만
        await check('시간 막대 칸 색 = 위험예측 4색(단계 순위) · 칸 아래 설명 줄 없음 · 칸은 누르는 단추가 아님(role=img·aria-label 「HH시 단계」) — §11.10.13', async () => {
            const r = await page.evaluate(() => { const bs = [...document.querySelectorAll('.sb-slot')]; return bs.map((b) => [b.dataset.rank, getComputedStyle(b).backgroundColor]); });
            const want = { 0: 'rgb(47, 179, 107)', 1: 'rgb(242, 194, 48)', 2: 'rgb(251, 146, 60)', 3: 'rgb(224, 50, 44)' };
            r.forEach(([rank, bg]) => assert.equal(bg, want[rank], rank + ' 칸 색'));
            await page.evaluate(() => document.querySelectorAll('.sb-slot')[3].click());
            const d = await page.evaluate(() => { const bs = [...document.querySelectorAll('.sb-slot')], b = bs[3], sr = b.getBoundingClientRect(), h = b.querySelector('.sb-slot-h').getBoundingClientRect();
                return { detail: document.querySelectorAll('.sb-slot-detail').length, buttons: document.querySelectorAll('.sb-timebar button').length, roles: [...new Set(bs.map((x) => x.getAttribute('role')))], labels: bs.map((x) => x.getAttribute('aria-label')), pressed: bs.filter((x) => x.hasAttribute('aria-pressed')).length, cursor: getComputedStyle(b).cursor,
                    group: document.querySelector('.sb-timebar').getAttribute('aria-label'), dx: Math.abs((sr.left + sr.right) / 2 - (h.left + h.right) / 2), dy: Math.abs((sr.top + sr.bottom) / 2 - (h.top + h.bottom) / 2), legend: !!document.querySelector('.sb-timebar-wrap .sb-legend') }; });
            assert.equal(d.detail, 0, '설명 줄 없음'); assert.equal(d.buttons, 0, '칸은 단추가 아님'); assert.deepEqual(d.roles, ['img']); assert.equal(d.pressed, 0); assert.notEqual(d.cursor, 'pointer');
            d.labels.forEach((l, i) => assert.ok(l.startsWith(B.h.sea.timeBar[i].label + ' ' + B.h.sea.timeBar[i].word), l));
            assert.ok(d.labels.some((l) => l.includes('특보 사건 있음')), '⚑ 칸은 aria-label 에 「특보 사건 있음」'); assert.equal(d.group, '해상 시간 막대 — 3시간 칸별 관할 최고 단계'); assert.ok(d.legend, '범례는 그대로');
            assert.ok(d.dx <= 1 && d.dy <= 1, '칸 글자는 가운데(종전 button 모양) — ' + d.dx + '/' + d.dy);
        });
        // §11.10.13: 해역 카드 줄 순서·이름 — 사용자 *"[사고현황('21~'25년)] 충돌 5건, 전복 2건, 좌초 1건 | 인명피해 사망 0명, 실종 0명"* · *"오늘 예상보다는 [기상 예보] 라고 표현"* · *"[권고] … 이렇게 마지막에 표현"*
        await check('[§11.10.13] 해역 카드(규칙 v14·v15 판 — 배지 없음) — [사고현황(\'21~\'25년)] → [기상 예보] → [그 밖의 근거] → 「… 많이 기록되었습니다」 → 맨 끝 [권고] · 「기준」·[특성]·[오늘 예상] 없음 · 옛 판(규칙 v13 전) 카드는 종전 모양', async () => {
            const grabCard = () => page.evaluate(() => { const card = document.querySelector('[data-sb-card="sea"]');
                // 바로가기 단추(sb-link)는 render 옵션(onLink)이 있을 때만 — 이 자리(앞 사례가 옵션 없이 다시 그림)에서는 없으므로 빼고 견준다
                return { kids: [...card.children].map((e) => e.classList.contains('sb-row') ? 'row:' + e.querySelector('.sb-row-k').textContent : e.classList[0]).filter((k) => k !== 'sb-link'),
                    rows: [...card.querySelectorAll(':scope > .sb-row')].map((e) => [e.querySelector('.sb-row-k').textContent, e.querySelector(':scope > :not(.sb-row-k)').textContent, [...e.querySelectorAll('li')].map((x) => x.textContent)]),
                    note: (card.querySelector(':scope > .sb-sentence') || {}).textContent || null, acc: (card.querySelector(':scope > .sb-acc-line') || {}).textContent || null }; });
            // §11.10.15: 지금 판(규칙 v16)은 출처별 배지 카드 — 이 사례는 그 전 판(v14·v15 — badges 없음)이 종전 모양 그대로인지 본다(배지 카드는 아래 [§11.10.15])
            const v15 = JSON.parse(JSON.stringify(B.h)); for (const c of v15.sea.cards) delete c.badges;
            await page.evaluate(({ b, now }) => window.StationBriefingRender.render(document.getElementById('station-briefing-content'), { ok: true, briefing: b, now: null }, { now }), { b: v15, now: clock.now });
            const c0 = B.h.sea.cards[0], r = await grabCard();
            const wx = c0.today.weatherLines.concat(c0.today.forecast ? [c0.today.forecast] : []);
            // §11.10.22 B: [사고현황] 이름표 다음 줄에 내용(.sb-acc-line — 연안 카드와 같은 모양)
            assert.deepEqual(r.kids, ['sb-card-head', 'sb-tags', 'row:[' + c0.traits.label + ']', 'sb-acc-line', 'row:[기상 예보]'].concat(c0.today.otherLines.length ? ['row:[그 밖의 근거]'] : []).concat(c0.historyNote ? ['sb-sentence'] : []).concat(['row:[권고]']));
            assert.equal(c0.traits.label, "사고현황('21~'25년)"); assert.equal(r.rows[0][1], '', '이름표 줄에는 내용 없음(§11.10.22 B)'); assert.equal(r.acc, c0.traits.text); assert.ok(/인명피해 사망 \d+명, 실종 \d+명$/.test(r.acc), r.acc);
            assert.deepEqual(r.rows[1][2].length ? r.rows[1][2] : [r.rows[1][1]], wx); assert.ok(wx.length >= 1);
            assert.ok(!/기준/.test(r.acc + r.rows[1][1]), '사고현황·기상 예보 줄에 「기준」 없음');
            assert.ok(!r.rows.some((x) => x[1].includes(c0.sourceLabel) && !x[0].startsWith('[권고')), '꼬리표(sourceLabel)와 같은 근거 줄은 되풀이하지 않음');
            assert.equal(r.note, c0.historyNote); assert.ok(/^이 해역에서는 집계 기간 중 .+ 사고가 많이 기록되었습니다\.$/.test(r.note), r.note);
            assert.equal(r.rows[r.rows.length - 1][0], '[권고]'); assert.equal(r.rows[r.rows.length - 1][1], c0.advice);
            // 옛 판 카드(advice 없음) — 종전 [특성]·[오늘 예상]·문장
            const old = JSON.parse(JSON.stringify(B.h)); for (const c of old.sea.cards) { delete c.advice; delete c.historyNote; c.traits.text = '2021~2025년 선박사고 18건(충돌 7·침수 5) · 제주도서부앞바다 · 232-2해구'; c.sentence = '옛 문장'; }
            await page.evaluate(({ b, now }) => window.StationBriefingRender.render(document.getElementById('station-briefing-content'), { ok: true, briefing: b, now: null }, { now }), { b: old, now: clock.now });
            const o = await grabCard();
            assert.deepEqual(o.kids, ['sb-card-head', 'sb-tags', 'row:[특성]', 'row:[오늘 예상]', 'sb-sentence']); assert.equal(o.note, '옛 문장');
            await page.evaluate(({ b, now }) => window.StationBriefingRender.render(document.getElementById('station-briefing-content'), { ok: true, briefing: b, now: null }, { now }), { b: B.h, now: clock.now });
        });
        // ── §11.10.15(2026-10-17 사용자 결정 — 승인 시안 Sea.dc.html 카드 A~D): 해역 카드 출처별 배지(글자 색 = 그 예보 등급 색) + 상세 줄 · 사고 한 줄은 [사고현황] 바로 아래 ──
        await check('[§11.10.15] 해역 카드 출처별 배지 — A KOMSA 단독(상세 없음) · B 풍랑주의보(기상청) · C 섞임(경계 + 혼잡 매우높음, 배지마다 상세 줄) · D 혼잡만(카드 관심인데 배지 빨강) · 순서 배지 → [사고현황] → 사고 한 줄 → [기상 예보] → [권고] · 꼬리표·노란 시간 칩·[그 밖의 근거] 없음 · textContent · 360px · 옛 판 후퇴', async () => {
            const yWin = R.editionWindow('evening', Date.parse('2026-10-17T17:10:00+09:00'));
            const reg = (i, slots, extra = {}) => ({ rid: 'A:' + i, lat: 33.4 + i * 0.01, lon: 126.9, haegu: { major: 223, sub: i, label: '223-' + i }, ref: { name: '성산포', distNm: i + 1, bearingWord: '북' }, zone: null, zones: [], slots,
                history: { from: '2021-01-01', to: '2025-12-31', count: 3, types: { 충돌: 2, 좌초: 1 }, death: 0, missing: 0 }, ...extra });
            const cong = (level, index, h) => ({ level, index, at: at(h) });
            const fxIn = { key: 'k|배지시험', name: '배지시험파출소', office: 'o', region: 'r', seaOnly: true, sources: { accident: 'ok', congestion: 'ok', zoneForecasts: 'ok', warnings: 'ok' }, places: [], land: null, tide: null,
                sea: { reviewedCells: 4, regions: [
                    reg(1, { [at(18)]: { accident: '주의' }, [at(21)]: { accident: '주의' } }),
                    reg(2, {}, { zone: { name: '제주도동부앞바다', kind: 'main' } }),
                    reg(3, { [at(18)]: { accident: '주의', congestion: cong('매우높음', 45.14, 18) }, [at(21)]: { accident: '경계', congestion: cong('매우높음', 32.91, 21) } }),
                    reg(4, { [at(18)]: { congestion: cong('매우높음', 45.14, 18) }, [at(21)]: { congestion: cong('매우높음', 32.91, 21) } }),
                    reg(5, {}, { haegu: { major: 232, sub: 5, label: '232-5' } }),   // 해구 예보 카드(시안 ④판 2 — 승인 시안 값 그대로)
                ], weather: { 223: { label: '223해구', rows: [[15, 1.2, 9], [18, 1.7, 11.1], [21, 1.5, 10]].map(([h, wh, ws]) => ({ at: at(h), wh, ws })) },
                    232: { label: '232해구', rows: [[15, 2.4, 13], [18, 2.6, 14], [21, 2.2, 12]].map(([h, wh, ws]) => ({ at: at(h), wh, ws })) } },
                warnings: [{ zone: '제주도동부앞바다', kind: '앞바다', type: '풍랑', level: '주의보', state: '발효', effective: { start: at(21), end: at(21), range: false }, release: null }] } };
            const fx = R.buildBriefing(fxIn, yWin, { generatedAt: '2026-10-17T17:10:00+09:00' });
            const byHaegu = (n) => fx.sea.cards.find((c) => c.name.includes('(' + (n === 5 ? '232-' : '223-') + n + '해구)'));
            assert.ok(byHaegu(3).today.otherLines.length > 0, '서버 otherLines 는 있다(AI 입력용) — 화면 배지 카드는 그리지 않는다');
            await page.setViewportSize({ width: 360, height: 780 }); await openAcc(page);
            const xss = JSON.parse(JSON.stringify(fx)), xa = xss.sea.cards.find((c) => c.name.includes('(223-1해구)')); xa.badges[0].text = XSS + xa.badges[0].text; xa.badges[0].detail = [{ title: XSS, head: ['시각', '등급'], rows: [['18시', { text: XSS, rank: 2 }]] }];
            const r = await page.evaluate(async ({ fx, xss, now }) => {
                const R = window.StationBriefingRender, box = document.getElementById('station-briefing-content'), out = {};
                const sec = () => box.querySelector('[data-sb-sec="sea"]');
                const grab = () => [...sec().querySelectorAll('[data-sb-card="sea"]')].map((card) => ({
                    name: card.querySelector('.sb-card-name').textContent, chip: card.querySelector('.sb-card-head .sb-chip').textContent,
                    kids: [...card.children].map((e) => e.classList.contains('sb-row') ? 'row:' + e.querySelector('.sb-row-k').textContent : e.classList[0]).filter((k) => k !== 'sb-link'),
                    seq: [...card.querySelectorAll('.sb-srcbs > *')].map((e) => e.classList.contains('sb-srcb') ? 'B:' + e.textContent : e.querySelector('table') ? 'T:' + e.querySelector('.sb-srcb-dt').textContent + '|' + [...e.querySelectorAll('th')].map((x) => x.textContent).join(',') + '|' + [...e.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((x) => x.textContent).join(',')).join('/') : 'D:' + e.textContent),
                    grades: [...card.querySelectorAll('.sb-srcb-tbl td[data-rank]')].map((td) => [td.textContent, td.dataset.rank, getComputedStyle(td).color, getComputedStyle(td).fontWeight]),
                    badges: [...card.querySelectorAll('.sb-srcb')].map((b) => ({ rank: b.dataset.rank, src: b.dataset.sbSrc, color: getComputedStyle(b).color, bg: getComputedStyle(b).backgroundColor, bgImg: getComputedStyle(b).backgroundImage })),
                    tags: card.querySelectorAll('.sb-tags, .sb-tag').length, other: [...card.querySelectorAll('.sb-row-k')].some((k) => k.textContent === '[그 밖의 근거]'),
                    note: (card.querySelector(':scope > .sb-sentence') || {}).textContent || null, advice: [...card.querySelectorAll(':scope > .sb-row')].pop().querySelector('.sb-row-v').textContent }));
                const rgb = (c) => { const e = document.createElement('i'); e.style.color = c; document.body.appendChild(e); const v = getComputedStyle(e).color; e.remove(); return v; };
                out.c = [0, 1, 2, 3].map((x) => rgb(R.colorOf(x)));
                R.render(box, { ok: true, briefing: fx }, { now, showSea: true, showLand: false, onLink: () => {} }); await new Promise((res) => setTimeout(res, 300));
                out.cards = grab();
                // 360px — 보이는 단계(처음 = 경계 → 카드 C)의 배지·상세 줄이 카드 안 · 페이지 가로 넘침 없음 · 주의 단추 → 카드 A·B
                const fit = () => [...sec().querySelectorAll('.sb-card')].filter((c) => c.offsetParent !== null).map((card) => { const cb = card.getBoundingClientRect(); return [...card.querySelectorAll('.sb-srcb, .sb-srcb-det, .sb-srcb-tbl')].every((b) => { const bb = b.getBoundingClientRect(); return bb.width > 0 && bb.left >= cb.left - 0.5 && bb.right <= cb.right + 0.5; }); });
                out.fit3 = fit(); out.page = document.documentElement.scrollWidth; out.vw = innerWidth;
                // 시안 ④판 — 관심 단추(해구 예보 카드 E·혼잡 카드 D)에서도 표가 카드 안 · 표 상자 넘침 없음(가로 스크롤이 생기지 않을 만큼 좁지 않음)
                const t1 = [...sec().querySelectorAll('[role="tab"]')].find((t) => t.textContent.indexOf('관심') === 0); t1.click();
                out.fit1 = fit(); out.tblw = [...sec().querySelectorAll('.sb-srcb-tblw')].filter((w) => w.offsetParent !== null).map((w) => [w.scrollWidth, w.clientWidth]);
                out.page1 = document.documentElement.scrollWidth;
                // 스크린샷용 — 카드 A·C·해구 예보 카드(E)만 한 장에(단계 묶음 숨김을 잠시 풀고 나머지 카드는 숨김)
                sec().querySelectorAll('[role="tabpanel"]').forEach((p) => { p.hidden = false; });
                [...sec().querySelectorAll('[data-sb-card="sea"]')].forEach((c) => { const n = c.querySelector('.sb-card-name').textContent; c.style.display = /\((223-1|223-3|232-5)해구\)/.test(n) ? '' : 'none'; });
                const sea = sec(); sea.scrollIntoView(); out.shot = true;
                return out;
            }, { fx, xss: null, now: clock.now });
            await page.waitForTimeout(200); await clean(page); await page.locator('[data-sb-sec="sea"]').screenshot({ path: path.join(SHOT, 'briefing_badges_360.png') });
            await page.evaluate(({ fx, now }) => window.StationBriefingRender.render(document.getElementById('station-briefing-content'), { ok: true, briefing: fx }, { now, showSea: true, showLand: false, onLink: () => {} }), { fx, now: clock.now });
            const r2 = await page.evaluate(async ({ fx, xss, now }) => {
                const R = window.StationBriefingRender, box = document.getElementById('station-briefing-content'), sec = () => box.querySelector('[data-sb-sec="sea"]'), out = {};
                const tab = [...sec().querySelectorAll('[role="tab"]')].find((t) => t.textContent.indexOf('주의') === 0); tab.click();
                out.fit2 = [...sec().querySelectorAll('.sb-card')].filter((c) => c.offsetParent !== null).map((card) => { const cb = card.getBoundingClientRect(); return [...card.querySelectorAll('.sb-srcb')].every((b) => { const bb = b.getBoundingClientRect(); return bb.width > 0 && bb.right <= cb.right + 0.5; }); });
                // 서버 글은 textContent 로만(계약 §5) — 배지·상세 줄에 HTML 문자열
                R.render(box, { ok: true, briefing: xss }, { now, showSea: true, showLand: false, onLink: () => {} });
                out.imgs = box.querySelectorAll('img').length; out.xss = window.__xss || null; out.xtext = [...box.querySelectorAll('.sb-srcb, .sb-srcb-dt, .sb-srcb-tbl td')].map((e) => e.textContent).filter((t) => t.indexOf('<img') === 0);
                // 규칙 v16 판(상세가 글 줄 — 「KOMSA 해양사고 위험예보 — 18시 '주의' · 21시 '경계'」)은 종전처럼 한 줄(표 없음)
                const v16 = JSON.parse(JSON.stringify(fx)); v16.sea.cards.forEach((c) => (c.badges || []).forEach((g) => { g.detail = g.detail.map((d) => d.title + ' — ' + d.rows.map((r) => r.map((x) => x && typeof x === 'object' ? x.text : x).join(' ')).join(' · ')); }));
                R.render(box, { ok: true, briefing: v16 }, { now, showSea: true, showLand: false, onLink: () => {} });
                const vc = [...sec().querySelectorAll('[data-sb-card="sea"]')].find((c) => c.querySelector('.sb-card-name').textContent.includes('(223-3해구)'));
                out.v16 = { tables: box.querySelectorAll('.sb-srcb-tbl').length, lines: [...vc.querySelectorAll('p.sb-srcb-det')].map((e) => e.textContent) };
                // 옛 판(배지 자료 없음 — 규칙 v15 전) → 종전 꼬리표·노란 시간 칩·줄 순서
                const old = JSON.parse(JSON.stringify(fx)); old.sea.cards.forEach((c) => { delete c.badges; });
                R.render(box, { ok: true, briefing: old }, { now, showSea: true, showLand: false, onLink: () => {} });
                const oc = [...sec().querySelectorAll('[data-sb-card="sea"]')].find((c) => c.querySelector('.sb-card-name').textContent.includes('(223-3해구)'));
                out.old = { srcbs: box.querySelectorAll('.sb-srcbs').length, kids: [...oc.children].map((e) => e.classList.contains('sb-row') ? 'row:' + e.querySelector('.sb-row-k').textContent : e.classList[0]).filter((k) => k !== 'sb-link'), tags: [...oc.querySelectorAll('.sb-tag')].map((t) => t.textContent) };
                return out;
            }, { fx, xss, now: clock.now });
            const by = (n) => r.cards.find((c) => c.name.includes('(' + (n === 5 ? '232-' : '223-') + n + '해구)'));
            const [, c1, c2] = r.c, RED = 'rgb(227, 72, 66)';
            // 카드 딱지(앱 단계)는 그대로
            assert.deepEqual([1, 2, 3, 4, 5].map((n) => by(n).chip), ['주의', '주의', '경계', '관심', '관심']);
            assert.deepEqual(by(1).seq, ["B:18~24시 해양사고 위험예보 '주의'(KOMSA)"], 'A — KOMSA 단독, 상세 없음(시안 A · ④판 3 「가. 되풀이면 빼기」)');
            assert.deepEqual(by(2).seq, ['B:21~24시 풍랑주의보(기상청)'], 'B — 기상 출처 · 특보 등급 말 없음(④판 1)');
            assert.deepEqual(by(3).seq, ["B:21~24시 해양사고 위험예보 '경계'(KOMSA)", 'T:KOMSA 해양사고 위험예보|시각,등급|18시,주의/21시,경계', "B:18~24시 혼잡 예보 '매우높음'(KOMSA)", 'T:KOMSA 혼잡 예보|시각,혼잡지수|18시,45.14 (매우높음)/21시,32.91 (매우높음)'], 'C — 섞임: 배지마다 바로 아래 상세 표(④판 4)');
            assert.deepEqual(by(4).seq, ["B:18~24시 혼잡 예보 '매우높음'(KOMSA)", 'T:KOMSA 혼잡 예보|시각,혼잡지수|18시,45.14 (매우높음)/21시,32.91 (매우높음)'], 'D — 혼잡만');
            assert.deepEqual(by(5).seq, ["B:15~24시 해구 예보 유의파고 '높음'·풍속 '매우 강함'(기상청)", 'T:232해구 예보|시각,유의파고,풍속|15시,2.4m (높음),13m/s (강함)/18시,2.6m (높음),14m/s (매우 강함)/21시,2.2m (높음),12m/s (강함)'], 'E — 해구 예보: 배지는 바다 상태 말, 숫자는 표(④판 2)');
            // 등급 칸 = 그 등급 색 굵게(주의 주황 · 경계 빨강 — 배지와 같은 규칙)
            assert.deepEqual(by(3).grades.map((g) => g.slice(0, 3)), [['주의', '2', c2], ['경계', '3', RED], ['45.14 (매우높음)', '3', RED], ['32.91 (매우높음)', '3', RED]], '혼잡지수 칸도 단계 말·색(§11.10.20 덧붙임 21) · 표 칸 따옴표 없음(사용자 「표 안에서는 \'와 같은 것은 빼도록 해줘.」)'); assert.ok(by(3).grades.every((g) => Number(g[3]) >= 700), '등급 칸 굵게');
            // 글자 색 = 그 예보 등급(주의 주황 · 경계·혼잡 매우높음 빨강 — 카드 D 는 관심인데 배지 빨강) · 바탕은 어두운 한 색(등급 색 바탕 아님)
            assert.deepEqual([by(1), by(2), by(3), by(4), by(5)].map((c) => c.badges.map((b) => b.color)), [[c2], [c2], [RED, RED], [RED], [r.c[1]]]);
            assert.deepEqual([...new Set(r.cards.flatMap((c) => c.badges.map((b) => b.bg + '|' + b.bgImg)))], ['rgb(11, 19, 36)|none']);
            assert.notEqual(c1, RED);
            const lum = (s) => { const [rr, gg, bb] = s.match(/\d+/g).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * rr + 0.7152 * gg + 0.0722 * bb; };
            const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
            for (const col of [c1, c2, RED]) assert.ok(ratio(col, 'rgb(11, 19, 36)') >= 4.5, '배지 글자 대비 4.5 이상 — ' + col + ' ' + ratio(col, 'rgb(11, 19, 36)').toFixed(2));
            // 줄 순서 — 배지 → [사고현황] → 사고 한 줄(사용자 「이 문구는 사고현황 아래쪽으로 가야함」) → [기상 예보] → [권고] · 꼬리표·시간 칩·[그 밖의 근거] 없음
            for (const n of [1, 2, 3, 4, 5]) {
                const c = by(n), s = byHaegu(n);
                assert.deepEqual(c.kids, ['sb-card-head', 'sb-srcbs', "row:[사고현황('21~'25년)]", 'sb-acc-line', 'sb-sentence', 'row:[기상 예보]', 'row:[권고]'], n + ' 줄 순서 ' + c.kids.join());   // §11.10.22 B — 내용은 이름표 다음 줄
                assert.equal(c.tags, 0, '꼬리표·노란 시간 칩 없음'); assert.equal(c.other, false, '[그 밖의 근거] 없음(배지·상세 줄에 있음)');
                assert.equal(c.note, '이 해역에서는 집계 기간 중 충돌 사고가 많이 기록되었습니다.'); assert.equal(c.advice, s.advice);
                assert.ok(s.advice.includes(s.badges[0].basis), '[권고] 근거 = 배지 꼴 — ' + s.advice);
            }
            assert.ok(r.fit3.length === 1 && r.fit3.every(Boolean) && r2.fit2.length === 2 && r2.fit2.every(Boolean), '360px 배지·상세 줄이 카드 안 ' + JSON.stringify([r.fit3, r2.fit2]));
            assert.ok(r.page <= r.vw + 1, '페이지 가로 넘침 없음 ' + r.page + '/' + r.vw);
            assert.ok(r.fit1.length === 2 && r.fit1.every(Boolean) && r.page1 <= r.vw + 1, '360px 관심 단추 — 해구 예보 표가 카드 안 ' + JSON.stringify([r.fit1, r.page1]));
            assert.ok(r.tblw.length === 2 && r.tblw.every(([sw, cw]) => sw <= cw + 1), '360px 표 상자 안 넘침 없음 ' + JSON.stringify(r.tblw));
            assert.deepEqual([r2.imgs, r2.xss, r2.xtext.length], [0, null, 3], '배지·상세 표 제목·칸의 HTML 문자열은 글자로');
            assert.deepEqual(r2.v16, { tables: 0, lines: ['KOMSA 해양사고 위험예보 — 18시 주의 · 21시 경계', 'KOMSA 혼잡 예보 — 18시 45.14 (매우높음) · 21시 32.91 (매우높음)'] }, '규칙 v16 판(상세가 글 줄)은 종전 한 줄');
            assert.equal(r2.old.srcbs, 0, '옛 판 — 배지 없음');
            assert.deepEqual(r2.old.kids, ['sb-card-head', 'sb-tags', "row:[사고현황('21~'25년)]", 'sb-acc-line', 'row:[기상 예보]', 'row:[그 밖의 근거]', 'sb-sentence', 'row:[권고]'], '옛 판 — 종전 줄 순서(§11.10.13)');
            assert.deepEqual(r2.old.tags, [byHaegu(3).sourceLabel, byHaegu(3).window], '옛 판 — 꼬리표·시간 칩');
            await page.setViewportSize({ width: 412, height: 915 });
            await page.evaluate(({ b, now }) => window.StationBriefingRender.render(document.getElementById('station-briefing-content'), { ok: true, briefing: b, now: null }, { now }), { b: B.h, now: clock.now });
        });
        // ── §11.10.19(2026-10-17 사용자 *"소해구 기준으로 기상이 표출되어야 함."*): 해역 카드의 해구 예보 배지·상세 표 제목·[기상 예보] 꼬리가 소해구 값 · 소해구 예보가 없는 해역은 대해구 ──
        await check('[§11.10.19] 해역 카드 — 소해구 값이면 표 제목 「232-5해구 예보」·[기상 예보] 「(232-5해구 예보)」 · 소해구 없는 해역은 「(232해구 예보)」 · 대해구만 넘는 해역(소해구는 미만)은 카드 없음', async () => {
            const yWin = R.editionWindow('evening', Date.parse('2026-10-17T17:10:00+09:00'));
            const reg = (i, slots) => ({ rid: 'A:' + i, lat: 33.4 + i * 0.01, lon: 126.2, haegu: { major: 232, sub: i, label: '232-' + i }, ref: { name: '모슬포', distNm: i + 1, bearingWord: '서' }, zone: null, zones: [], slots, history: { count: 0 } });
            const sw = (k, list) => ({ label: k + '해구', major: '232', sub: Number(k.split('-')[1]), baseTm: '2026101700', rows: yWin.slots.map((s) => { const r = list.find(([h]) => at(h) === s); return { at: s, wh: r ? r[1] : null, ws: r ? r[2] : null, forecastAt: r ? s : null }; }) });
            const fxIn = { key: 'k|소해구시험', name: '소해구시험파출소', office: 'o', region: 'r', seaOnly: true, sources: { accident: 'ok', congestion: 'ok', zoneForecasts: 'ok', warnings: 'ok' }, places: [], land: null, tide: null,
                sea: { reviewedCells: 3, regions: [reg(5, {}), reg(6, { [at(18)]: { accident: '주의' } }), reg(7, {})],
                    weather: { 232: { label: '232해구', rows: [[15, 1.2, 9], [18, 2.2, 12.5], [21, 1.5, 10]].map(([h, wh, ws]) => ({ at: at(h), wh, ws })) } },
                    weatherSmall: { '232-5': sw('232-5', [[15, 2.4, 13], [18, 2.6, 14], [21, 2.2, 12]]), '232-7': sw('232-7', [[15, 1.1, 8], [18, 1.6, 10], [21, 1.4, 9]]) }, warnings: [] } };
            const fx = R.buildBriefing(fxIn, yWin, { generatedAt: '2026-10-17T17:10:00+09:00' });
            await page.setViewportSize({ width: 360, height: 780 }); await openAcc(page);
            const r = await page.evaluate(async ({ fx, now }) => {
                const box = document.getElementById('station-briefing-content');
                window.StationBriefingRender.render(box, { ok: true, briefing: fx }, { now, showSea: true, showLand: false, onLink: () => {} }); await new Promise((res) => setTimeout(res, 200));
                return [...box.querySelectorAll('[data-sb-sec="sea"] [data-sb-card="sea"]')].map((card) => ({
                    name: card.querySelector('.sb-card-name').textContent,
                    seq: [...card.querySelectorAll('.sb-srcbs > *')].map((e) => e.classList.contains('sb-srcb') ? 'B:' + e.textContent : e.querySelector('table') ? 'T:' + e.querySelector('.sb-srcb-dt').textContent + '|' + [...e.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((x) => x.textContent).join(',')).join('/') : 'D:' + e.textContent),
                    wx: ([...card.querySelectorAll('.sb-row')].find((x) => x.querySelector('.sb-row-k').textContent === '[기상 예보]') || { querySelector: () => ({ textContent: null }) }).querySelector('.sb-row-v').textContent }));
            }, { fx, now: clock.now });
            const by = (n) => r.find((c) => c.name.includes('(232-' + n + '해구)'));
            assert.deepEqual(r.map((c) => c.name.match(/\((232-\d)해구\)/)[1]).sort(), ['232-5', '232-6'], '232-7 은 대해구(18시 2.2m·12.5m/s)로는 관심이지만 소해구 값이 미만 — 카드 없음');
            assert.deepEqual(by(5).seq, ["B:15~24시 해구 예보 유의파고 '높음'·풍속 '매우 강함'(기상청)", 'T:232-5해구 예보|15시,2.4m (높음),13m/s (강함)/18시,2.6m (높음),14m/s (매우 강함)/21시,2.2m (높음),12m/s (강함)'], '배지·표 = 소해구 값');
            assert.ok(/\(유의파고 2\.6m·풍속 14m\/s, 232-5해구 예보\)\.$|유의파고 2\.6m·풍속 14m\/s로 .*\(232-5해구 예보\)\.$/.test(by(5).wx), by(5).wx);
            assert.ok(/232해구 예보\)\.$/.test(by(6).wx), '소해구 예보가 없는 해역은 대해구 — ' + by(6).wx);
            assert.ok(by(6).seq.some((x) => x.startsWith('T:232해구 예보|18시,2.2m (높음),12.5m/s (강함)')), '대해구 값의 배지 표 제목 「232해구 예보」 — ' + by(6).seq.join(' / '));
            await page.setViewportSize({ width: 412, height: 915 });
            await page.evaluate(({ b, now }) => window.StationBriefingRender.render(document.getElementById('station-briefing-content'), { ok: true, briefing: b, now: null }, { now }), { b: B.h, now: clock.now });
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
            for (const k of ['07:30 · 17:30 · 23:00', '40분 전(06:50 · 16:50 · 22:20)', '그때까지는 이전 판', '덮지 않습니다', '21시가 넘으면 다음 날', '오늘 밤~내일', '공단 안내로는 경계 상위 5%·주의 상위 5~15% 구간', '만들기 시작한 시각이 든 3시간 칸부터', '기상청 해제 시각', '해제 예고로만', '사고 확률이 아닙니다', '관심 이상인 곳을 모두', '최대 12곳', '이안류를 관측하는 해수욕장만', '8m/s 이상', '다음 정시 판에 반영', '조석 칸이 없습니다', '「확인 불가」(회색)', '1.2~1.3배', '저조 뒤부터 물이 차오릅니다',
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
        await check('브리핑 없음 — 공개 시각 안내(07:30·17:30·23:00, 20분 전부터 만들기)만 · 「아직 이 관할의 브리핑이 없습니다」 줄 없음(§11.10.10 F) — 칸은 비지 않음 · 제목 시각 없음', async () => {
            await pickStation(page, AEWOL); await page.waitForSelector('#station-briefing-content [data-sb-empty]');
            assert.ok((await content(page)).includes('07:30 · 17:30 · 23:00에 보입니다') && (await content(page)).includes('40분 전(06:50 · 16:50 · 22:20)'), await content(page));
            assert.ok(!(await content(page)).includes('아직 이 관할의 브리핑이 없습니다'), '§11.10.10 F');
            const e = await page.$eval('#station-briefing-content [data-sb-empty]', (x) => ({ t: x.innerText.trim().length, h: x.getBoundingClientRect().height })); assert.ok(e.t > 20 && e.h > 20, '빈 칸이 아님 ' + JSON.stringify(e));
            assert.equal(await page.$eval('#station-briefing-title', (e) => e.textContent), 'AI 연안 안전 브리핑', '판이 없으면 시각 없이');
        });
        await check('21시 넘음 — 내일 판이 없으면 다음 예정 시각(nextExpectedAt) 안내 · 오늘 판이 있으면 오늘 판(§11.10.9 ⑦ 부터 「아직 없어」 상자 없이 머리 글 괄호에 다음 갱신)', async () => {
            clock.now = Date.parse('2026-10-17T21:30:00+09:00');
            await page.evaluate(() => window.StationBriefing.load()); await page.waitForFunction(() => document.getElementById('station-briefing-content').innerText.includes('다음 브리핑 공개'));
            assert.ok((await content(page)).includes('다음 브리핑 공개: 10월 17일(토) 23:00'));
            await pickStation(page, HALLIM); await page.waitForSelector('[data-sb-sec="overview"]');
            const t = await content(page); assert.ok(!t.includes('아직 없어') && !t.includes('보여 드립니다'), '§11.10.9 ⑦ — 「…아직 없어 … 보여 드립니다」 상자 없음: ' + t.slice(0, 200));
            assert.equal(await page.$eval('#station-briefing-content .sb-edition', (e) => e.textContent), '10월 17일 13:10 기준 브리핑 (다음 갱신 23:00 또는 특보 변경 시)');
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
            await page.waitForSelector('[data-sb-next]'); assert.ok((await page.$eval('[data-sb-next]', (e) => e.textContent)).includes('10-17 17:30 공개(16:50부터 만들기)'), await page.$eval('[data-sb-next]', (e) => e.textContent));
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
        await check('[§11.10.21] 상태 상자 — 「관광지 자료 확인 불가」 판별(0이면 「없음」 · 펼치면 관할·관광지 이름 · 옛 실행은 「기록 없음」) · 정시 판 소요 표(최근 6회 · 분:초 · 공개 전/뒤 · 마감 · 특보·관리자 실행 뺌) · 360px 넘침 없음', async () => {
            const run = (at0, kind, ms, pub, res) => ({ at: at0, kind, method: 'chatgpt', ms, publishAt: pub, results: res });
            const r1 = (o) => [{ date: '2026-10-17', stations: 4, stats: { ai: 4, reused: 0, template: 0, deadline: 0, ...o.stats }, errors: o.errors || 0, ...(o.spotFail ? { spotFail: o.spotFail } : {}) }];
            const failList = { stations: 2, spots: 3, list: [{ office: '제주해양경찰서', station: '한림파출소', spots: ['금능해수욕장', '협재해수욕장'] }, { office: '부산해양경찰서', station: '남항파출소', spots: ['자갈치'] }] };
            const edition = run('2026-10-17T07:10:00+09:00', 'morning', 754000, '2026-10-17T07:30:00+09:00', r1({ stats: { ai: 2, reused: 1, template: 1, deadline: 1 }, errors: 2, spotFail: failList }));
            const manual = run('2026-10-17T09:40:00+09:00', 'manual', 300000, '2026-10-17T09:40:00+09:00', r1({ spotFail: { stations: 0, spots: 0, list: [] } }));
            const cnt = (f) => ({ stations: f.stations, spots: f.spots });
            const runs = [run('2026-10-15T07:10:00+09:00', 'morning', 500000, '2026-10-15T07:30:00+09:00', r1({})), run('2026-10-15T17:10:00+09:00', 'evening', 610000, '2026-10-15T17:30:00+09:00', r1({})),
                run('2026-10-15T22:40:00+09:00', 'night', 905000, '2026-10-15T23:00:00+09:00', r1({})), run('2026-10-16T07:10:00+09:00', 'morning', 1260000, '2026-10-16T07:30:00+09:00', r1({ stats: { deadline: 2, template: 2, ai: 2 } })),
                run('2026-10-16T17:10:00+09:00', 'evening', 600000, '2026-10-16T17:30:00+09:00', r1({})), run('2026-10-16T18:00:00+09:00', 'warning', 90000, '2026-10-16T18:00:00+09:00', r1({})),
                run('2026-10-16T22:40:00+09:00', 'night', 700000, '2026-10-16T23:00:00+09:00', r1({})), { ...edition, results: edition.results.map((x) => ({ ...x, spotFail: cnt(x.spotFail) })) }, { ...manual, results: manual.results.map((x) => ({ ...x, spotFail: cnt(x.spotFail) })) }];
            fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ errors: ERRS, lastRun: manual, lastEdition: edition, runs }));
            const refresh = () => page.evaluate(() => [...document.querySelectorAll('[data-sb-status] button')].find((b) => b.textContent === '새로고침').click());
            await refresh(); await page.waitForSelector('[data-sb-edition-row]');
            const r = await page.evaluate(() => ({
                sf: [...document.querySelectorAll('[data-sb-spotfail-row]')].map((x) => x.textContent),
                sum: document.querySelector('[data-sb-spotfail] details summary').textContent, open: document.querySelector('[data-sb-spotfail] details').open,
                rows: [...document.querySelectorAll('[data-sb-edition-row]')].map((tr) => [...tr.children].map((td) => td.textContent)),
                head: [...document.querySelectorAll('[data-sb-edition-times] th')].map((x) => x.textContent), title: document.querySelector('[data-sb-edition-times] .sba-k').textContent,
                note: document.querySelector('[data-sb-edition-times]').textContent }));
            assert.equal(r.sf.length, 2, r.sf.join(' / '));
            assert.equal(r.sf[0], '마지막 실행 · 10-17 09:40 · 관리자 즉시 실행 · 10-17 판관광지 자료 확인 불가: 없음', '0이면 「없음」(조용히 빠지지 않게)');
            assert.ok(r.sf[1].startsWith('마지막 정시 판 · 10-17 07:10 · 07:30 판 · 10-17 판'), r.sf[1]);
            assert.deepStrictEqual([r.sum, r.open], ['관광지 자료 확인 불가: 2관할 · 관광지 3곳', false]);
            await tap(page, '[data-sb-spotfail] details summary');
            assert.deepStrictEqual(await page.$$eval('[data-sb-spotfail] details li', (e) => e.map((x) => x.textContent)), ['제주해양경찰서 한림파출소 — 금능해수욕장, 협재해수욕장', '부산해양경찰서 남항파출소 — 자갈치']);
            assert.deepStrictEqual(r.head, ['판(시작)', '소요(분:초)', '결과', '마감']); assert.equal(r.title, '정시 판 소요 시간 — 최근 6회까지');
            assert.equal(r.rows.length, 6, '정시 판만 최근 6회(특보 변경·관리자 실행·7번째 옛 판 뺌)');
            assert.deepStrictEqual(r.rows[0], ['07:30 판10-17 07:10', '12:34공개 7:26 전 끝남', '4곳 · AI 2 · 재사용 1 · 규칙 1 · 오류 2', '걸림규칙으로 1곳']);
            assert.deepStrictEqual(r.rows[3], ['07:30 판10-16 07:10', '21:00공개 1:00 뒤 끝남', '4곳 · AI 2 · 재사용 0 · 규칙 2 · 오류 0', '걸림규칙으로 2곳']);
            assert.deepStrictEqual(r.rows.map((x) => x[0].slice(-11)), ['10-17 07:10', '10-16 22:40', '10-16 17:10', '10-16 07:10', '10-15 22:40', '10-15 17:10'], '최근 것부터');
            assert.equal(r.rows[1][3], '안 걸림'); assert.ok(r.note.includes('마감 = 시작 뒤 20분과 공개 시각 중 이른 때'), r.note);
            await page.setViewportSize({ width: 360, height: 780 }); await page.waitForTimeout(200);
            const ov = await page.evaluate(() => ['[data-sb-status]', '[data-sb-spotfail]', '[data-sb-edition-times]'].map((q) => { const e = document.querySelector(q); return [q, e.scrollWidth, e.clientWidth]; }).concat([['table', document.querySelector('[data-sb-edition-times] table').getBoundingClientRect().right, document.querySelector('[data-sb-edition-times]').getBoundingClientRect().right], ['page', document.documentElement.scrollWidth, document.documentElement.clientWidth]]));
            for (const [q, a, b] of ov) assert.ok(a <= b + 1, '360px 가로 넘침 없음 ' + q + ' ' + a + '>' + b);
            for (const [q, f] of [['[data-sb-spotfail]', 'admin_ai_briefing_spotfail_360.png'], ['[data-sb-edition-times]', 'admin_ai_briefing_times_360.png']]) { await page.locator(q).scrollIntoViewIfNeeded(); await page.locator(q).screenshot({ path: path.join(SHOT, f) }); }
            await page.setViewportSize({ width: 1280, height: 900 });
            // 이 기록 전 실행(spotFail 없음) — 0 으로 보이지 않고 「기록 없음」, 정시 판 기록이 없으면 표 대신 안내
            fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ errors: ERRS, lastRun: { ...manual, results: r1({}) } }));
            await refresh(); await page.waitForFunction(() => !document.querySelector('[data-sb-edition-row]') && document.querySelector('[data-sb-edition-times]'));
            assert.ok((await page.$eval('[data-sb-spotfail]', (e) => e.textContent)).includes('관광지 자료 확인 불가: 기록 없음(이 기능 전 실행)'));
            assert.ok((await page.$eval('[data-sb-edition-times]', (e) => e.textContent)).includes('최근 3일 정시 판 기록 없음'));
            fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ errors: ERRS }));
            await refresh(); await page.waitForFunction(() => (document.querySelector('[data-sb-lastrun]') || {}).textContent === '기록 없음');
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
        await check('[§11.10.4] 관리자 미리보기 — 공개 시각 전 판(pending)은 머리 글 「… 17:30 기준 브리핑」으로 보이고(§11.10.10 F — 「예정 — …」 안내 상자 없음), 같은 때 사용자 경로는 지금 판 그대로 · 상태 「공개 예정」', async () => {
            const ev = JSON.parse(JSON.stringify(B.h)); ev.edition = 'evening'; ev.trigger = { kind: 'evening' }; ev.generatedAt = '2026-10-17T17:10:00+09:00'; ev.publishAt = '2026-10-17T17:30:00+09:00';
            fs.writeFileSync(path.join(dir, 'briefings_2026-10-17.json'), JSON.stringify({ date: '2026-10-17', stations: { [HALLIM]: B.h, [BUSAN]: B.b, [MOKPO]: B.m }, pending: { [HALLIM]: ev } }));
            const user = await http('/api/station-briefing?station=' + encodeURIComponent(HALLIM) + '&adminToken=admin-push-token');
            assert.deepEqual([user.body.briefing.edition, user.body.pending], ['warning', undefined], '사용자에게는 공개 시각까지 지금 판');
            await tap(page, '[data-sb-preview-go]'); await page.waitForFunction(() => { const e = document.querySelector('[data-sb-preview-out] .sb-edition'); return e && e.textContent.startsWith('10월 17일 17:30'); });
            const r = await page.evaluate(() => ({ note: !!document.querySelector('[data-sb-preview-out] [data-sb-pending]'), text: document.querySelector('[data-sb-preview-out]').textContent, ed: document.querySelector('[data-sb-preview-out] .sb-edition').textContent }));
            assert.ok(!r.note && !r.text.includes('예정 — ') && !r.text.includes('공개될 판입니다'), '§11.10.10 F — 「예정 — …」 안내 없음'); assert.ok(r.ed.startsWith('10월 17일 17:30 기준 브리핑 (다음 갱신 '), r.ed);
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
        await check('[UI-A1] 카드가 많은 관할(해역 10·관광지 10·상시 12 — 2026-10-17 부터 카드 상한 없음)·360px — 아코디언 본문이 잘리지 않고 꼬리(출처·「안전을 보장하지 않습니다」)까지 보인다', async () => {
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
        // ── §11.10.14(2026-10-17 사용자 결정) — 「해상 분석」·「연안 분석」 머리 오른쪽 단계별 개수 배지 + 칸 안 단계 단추(하나만 고름) ──
        await check('[§11.10.14 → §11.10.16] 해상·연안 분석 — 머리 배지 「주의 5」「관심 1」(경계→주의→관심 · 단계 색 · 접어도 보임 · 꺾쇠와 안 겹침) · 단계 단추(처음 = 가장 높은 단계 · 누르면 그 단계 카드만 · 화살표 키) · 공통 줄은 그대로 · 단계 하나면 단추 없음 · 다시 그리면 처음으로 · 360px', async () => {
            await page.setViewportSize({ width: 360, height: 780 }); await openAcc(page);
            const base = JSON.parse(JSON.stringify(B.h));
            const r = await page.evaluate(async ({ base, now }) => {
                const R = window.StationBriefingRender, box = document.getElementById('station-briefing-content'), out = {};
                const one = (src, rank, word, name) => Object.assign(JSON.parse(JSON.stringify(src)), { rank, word, name });
                const fx = JSON.parse(JSON.stringify(base)), s0 = base.sea.cards[0], l0 = base.land.cards[0];
                // 서버 순서(단계 높은 순)를 일부러 섞어 둔다 — 단계 안 순서는 받은 순서 그대로여야 한다. 단계 말은 옛 판 꼴 「주의 필요」 — 화면이 「주의」로 줄인다(§11.10.16 levelWord)
                fx.sea.cards = [one(s0, 2, '주의 필요', '주의해역1'), one(s0, 2, '주의 필요', '주의해역2'), one(s0, 1, '관심 필요', '관심해역1'), one(s0, 2, '주의 필요', '주의해역3'), one(s0, 2, '주의 필요', '주의해역4'), one(s0, 2, '주의 필요', '주의해역5')];
                fx.land.cards = [one(l0, 1, '관심 필요', '관심곳1'), one(l0, 2, '주의 필요', '주의곳1'), one(l0, 3, '경계 필요', '경계곳1'), one(l0, 2, '주의 필요', '주의곳2')];
                R.render(box, { ok: true, briefing: fx }, { now, showSea: true, showLand: true, onLink: () => {} });
                await new Promise((res) => setTimeout(res, 300));
                const rgb = (c) => { const e = document.createElement('i'); e.style.background = c; document.body.appendChild(e); const v = getComputedStyle(e).backgroundColor; e.remove(); return v; };
                const sec = (k) => box.querySelector('[data-sb-sec="' + k + '"]');
                const head = (k) => { const h = sec(k).querySelector('.marine-forecast-sub-header'), bd = h.querySelector('[data-sb-sec-badges]'), ic = h.querySelector('.marine-forecast-sub-icon'), t = h.querySelector('.marine-forecast-sub-title');
                    const hb = h.getBoundingClientRect(), bb = bd.getBoundingClientRect(), ib = ic.getBoundingClientRect(), tb = t.getBoundingClientRect();
                    return { kids: [...h.children].map((c) => c.classList.contains('sb-sec-badges') ? 'badges' : c.classList.contains('marine-forecast-sub-title') ? 'title' : 'icon'),
                        badges: [...bd.children].map((c) => c.textContent), bg: [...bd.children].map((c) => getComputedStyle(c).backgroundColor), ranks: [...bd.children].map((c) => Number(c.dataset.rank)),
                        noOverlap: bb.right <= ib.left + 0.5 && tb.right <= bb.left + 0.5, inside: bb.top >= hb.top - 0.5 && bb.bottom <= hb.bottom + 0.5 && bb.width > 0 }; };
                const tabs = (k) => { const bar = sec(k).querySelector('[data-sb-tabs="' + k + '"]'); if (!bar) return null;
                    const ts = [...bar.querySelectorAll('[role="tab"]')];
                    return { role: bar.getAttribute('role'), text: ts.map((t) => t.textContent), sel: ts.map((t) => t.getAttribute('aria-selected')), tabIndex: ts.map((t) => t.tabIndex),
                        bg: ts.map((t) => getComputedStyle(t).backgroundColor), border: ts.map((t) => getComputedStyle(t).borderTopColor),
                        shown: [...sec(k).querySelectorAll('.sb-card')].filter((c) => c.offsetParent !== null).map((c) => c.querySelector('.sb-card-name').textContent),
                        all: sec(k).querySelectorAll('.sb-card').length, panels: [...sec(k).querySelectorAll('[role="tabpanel"]')].map((p) => p.getAttribute('aria-labelledby') === document.getElementById(p.id.replace(/-p(\d+)$/, '-t$1')).id && document.getElementById(p.id.replace(/-p(\d+)$/, '-t$1')).getAttribute('aria-controls') === p.id),
                        overflowX: getComputedStyle(bar).overflowX, below: (() => { const cnt = sec(k).querySelector(k === 'sea' ? '.sb-timebar-wrap' : '.sb-sec-head'); return !!(cnt.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING); })() }; };
                out.colors = [0, 1, 2, 3].map((x) => rgb(R.colorOf(x)));
                out.seaHead = head('sea'); out.landHead = head('land'); out.sea0 = tabs('sea'); out.land0 = tabs('land');
                out.common = { count: !sec('sea').querySelector('[data-sb-sea-count]') && !sec('land').querySelector('[data-sb-land-count]'), bar: sec('sea').querySelectorAll('.sb-slot').length, barShown: !!(sec('sea').querySelector('.sb-timebar') || {}).offsetParent };
                // 누르기 — 관심 단추 → 관심 카드만(공통 줄·막대는 그대로)
                sec('sea').querySelectorAll('[role="tab"]')[1].click(); out.sea1 = tabs('sea');
                out.common1 = { count: !sec('sea').querySelector('[data-sb-sea-count]'), barShown: !!(sec('sea').querySelector('.sb-timebar') || {}).offsetParent, open: sec('sea').classList.contains('open') };
                // 화살표 키(연안: 경계 → 오른쪽 → 주의, End → 관심, Home → 경계, 왼쪽 → 맨 끝으로 돈다)
                const lt = () => [...sec('land').querySelectorAll('[role="tab"]')], key = (k) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
                lt()[0].focus(); key('ArrowRight'); out.kRight = [tabs('land').sel, document.activeElement === lt()[1], tabs('land').shown];
                key('End'); out.kEnd = tabs('land').shown; key('Home'); out.kHome = tabs('land').shown; key('ArrowLeft'); out.kLeft = tabs('land').shown;
                // 360px — 페이지 가로 넘침 없음 · 단추 줄은 넘치면 가로 스크롤(줄 자체는 칸 안)
                const lb = sec('land').querySelector('[data-sb-tabs]').getBoundingClientRect(), sb = sec('land').querySelector('.sb-sec-body').getBoundingClientRect();
                out.w360 = { page: document.documentElement.scrollWidth, inside: lb.left >= sb.left - 0.5 && lb.right <= sb.right + 0.5 };
                // 접은 머리에도 배지(사용자 — 「접혀 있을 때도」)
                sec('sea').querySelector('.marine-forecast-sub-header').click(); await new Promise((res) => setTimeout(res, 450));
                out.closed = { open: sec('sea').classList.contains('open'), head: head('sea') }; sec('sea').querySelector('.marine-forecast-sub-header').click();
                // 다시 그리기(판 바뀜) → 가장 높은 단계로 돌아온다
                R.render(box, { ok: true, briefing: fx }, { now, showSea: true, showLand: true, onLink: () => {} }); out.reSea = tabs('sea').sel; out.reLand = tabs('land').sel;
                // 단계 하나(주의만) → 단추 없음·카드 모두 · 카드 없음 → 배지 없음
                const f2 = JSON.parse(JSON.stringify(fx)); f2.sea.cards = f2.sea.cards.filter((c) => c.rank === 2); f2.land.cards = [];
                R.render(box, { ok: true, briefing: f2 }, { now, showSea: true, showLand: true, onLink: () => {} });
                out.single = { tabs: !!sec('sea').querySelector('[data-sb-tabs]'), badges: [...sec('sea').querySelectorAll('[data-sb-sec-badges] .sb-chip')].map((c) => c.textContent), cards: [...sec('sea').querySelectorAll('.sb-card')].filter((c) => c.offsetParent !== null).length,
                    landBadges: !!sec('land').querySelector('[data-sb-sec-badges]'), landTabs: !!sec('land').querySelector('[data-sb-tabs]') };
                // 해상만 관할(land 없음) — 연안 칸은 이유 한 줄, 배지 없음
                const f3 = JSON.parse(JSON.stringify(fx)); f3.land = null; f3.seaOnlyReason = '해상만';
                R.render(box, { ok: true, briefing: f3 }, { now, showSea: true, showLand: false, onLink: () => {} }); out.seaOnly = { landBadges: !!sec('land').querySelector('[data-sb-sec-badges]'), seaTabs: !!sec('sea').querySelector('[data-sb-tabs]') };
                R.render(box, { ok: true, briefing: fx }, { now, showSea: true, showLand: true, onLink: () => {} });   // 스크린샷용(아래)
                return out;
            }, { base, now: clock.now });
            const [, c1, c2, c3] = r.colors;
            assert.deepEqual(r.seaHead.kids, ['title', 'badges', 'icon'], '배지는 제목과 꺾쇠 사이(오른쪽)');
            assert.deepEqual(r.seaHead.badges, ['주의 5', '관심 1'], '§11.10.16 — 「경계 1, 주의 5, 관심 1 처럼」(단위·「필요」 없음)'); assert.deepEqual(r.seaHead.bg, [c2, c1], '배지 색 = 단계 색(chip)');
            assert.deepEqual(r.landHead.badges, ['경계 1', '주의 2', '관심 1'], '연안 — 경계 → 주의 → 관심(§11.10.16 단위 없음)'); assert.deepEqual(r.landHead.bg, [c3, c2, c1]);
            assert.ok(r.seaHead.noOverlap && r.seaHead.inside && r.landHead.noOverlap && r.landHead.inside, '360px 머리 — 제목·배지·꺾쇠 안 겹침 ' + JSON.stringify([r.seaHead, r.landHead]));
            assert.deepEqual([r.sea0.role, r.sea0.text, r.sea0.sel, r.sea0.tabIndex], ['tablist', ['주의 5', '관심 1'], ['true', 'false'], [0, -1]], '처음 = 가장 높은 단계(주의)');
            assert.deepEqual(r.sea0.shown, ['주의해역1', '주의해역2', '주의해역3', '주의해역4', '주의해역5'], '주의 카드만 · 받은 순서 그대로'); assert.equal(r.sea0.all, 6, '카드는 모두 만들어 둔다(숨김만)');
            assert.deepEqual([r.sea0.bg, r.sea0.border], [[c2, 'rgba(0, 0, 0, 0)'], [c2, c1]], '고른 단추 = 단계 색 채움, 나머지 = 단계 색 테두리'); assert.ok(r.sea0.panels.every(Boolean) && r.sea0.below, 'tab↔tabpanel 연결 · 단추는 시간 막대 아래(검토 줄은 §11.10.16 에 없앰)');
            assert.deepEqual([r.common.count, r.common.barShown, r.common.bar > 0], [true, true, true], '「관할 해역 N칸 검토」·「관광지 N곳 검토」 줄 없음(§11.10.16) · 시간 막대는 그대로');
            assert.deepEqual([r.sea1.sel, r.sea1.shown, r.sea1.bg], [['false', 'true'], ['관심해역1'], ['rgba(0, 0, 0, 0)', c1]], '관심 단추 → 관심 카드만');
            assert.deepEqual([r.common1.count, r.common1.barShown, r.common1.open], [true, true, true], '공통 줄·시간 막대는 단계와 무관 · 단추를 눌러도 칸이 접히지 않음');
            assert.deepEqual(r.land0.shown, ['경계곳1']); assert.deepEqual(r.kRight, [['false', 'true', 'false'], true, ['주의곳1', '주의곳2']], '→ 다음 단계 + 초점 이동');
            assert.deepEqual([r.kEnd, r.kHome, r.kLeft], [['관심곳1'], ['경계곳1'], ['관심곳1']]);
            assert.ok(r.w360.page <= 360 && r.w360.inside && r.land0.overflowX === 'auto', '360px 가로 넘침 없음 · 단추 줄은 가로 스크롤 ' + JSON.stringify(r.w360));
            assert.deepEqual([r.closed.open, r.closed.head.badges, r.closed.head.noOverlap], [false, ['주의 5', '관심 1'], true], '접은 머리에도 배지');
            assert.deepEqual([r.reSea, r.reLand], [['true', 'false'], ['true', 'false', 'false']], '다시 그리면 가장 높은 단계로');
            assert.deepEqual(r.single, { tabs: false, badges: ['주의 5'], cards: 5, landBadges: false, landTabs: false }, '단계 하나 → 단추 없음 · 카드 없음 → 배지 없음');
            assert.deepEqual(r.seaOnly, { landBadges: false, seaTabs: true });
            await page.locator('#station-briefing-content [data-sb-sec="sea"]').screenshot({ path: path.join(SHOT, 'briefing_levels_sea_360.png') });
            await page.locator('#station-briefing-content [data-sb-sec="land"]').screenshot({ path: path.join(SHOT, 'briefing_levels_land_360.png') });
            // 되돌려 놓기 — 뒤 시험들이 보는 본문(지금 밀집 now 포함한 실제 응답)으로 다시 그린다([UI-A1] 과 같은 방식)
            await page.evaluate(() => window.StationBriefingRender.render(document.getElementById('station-briefing-content'), JSON.parse(JSON.stringify(window.StationBriefing._state.resp)), { showSea: true, showLand: true, onLink: () => {} }));
            await page.setViewportSize({ width: 412, height: 915 });
        });
        // §11.10.16(2026-10-17 사용자 시안 댓글): 「다.」 문장 끝 줄바꿈 · 어절 단위 줄끊기(keep-all) · 「•」 목록 걸린 들여쓰기 · (물때) 간출암 두 줄 · 단계 이름 「필요」 없음
        await check('[§11.10.16] 문장 줄바꿈(「다.」 뒤 <br>, 글은 그대로 — 「2.4배」·「1.5~3.0m」·「다.」」 안 자름) · 분석 문단 문장마다 새 줄 · (물때) 「…잠깁니다.」 다음 줄 「바위 위 …」(링크 그대로) · 브리핑 전체 keep-all·긴 URL 360px 안 넘침 · 「•」 목록 둘째 줄 = 첫 글자 위치 · 칩 「연안 주의」·「주의」 · 옛 판 「주의 필요」도 「주의」', async () => {
            await page.setViewportSize({ width: 360, height: 780 }); await openAcc(page);
            const base = JSON.parse(JSON.stringify(B.h)), URL = 'https://www.example.com/very/long/path/without/any/spaces/for/wrapping/test/1234567890abcdefghijklmnopqrstuvwxyz';
            const r = await page.evaluate(async ({ base, now, URL }) => {
                const R = window.StationBriefingRender, box = document.getElementById('station-briefing-content'), out = {};
                // ① appendText 단위 — textContent 는 그대로, <br> 수
                const t = (s) => { const d = document.createElement('p'); R.appendText(d, s); return { same: d.textContent === s, br: d.querySelectorAll('br').length, parts: [...d.childNodes].map((n) => n.nodeName === 'BR' ? '|' : n.textContent) }; };
                out.unit = {
                    two: t('물에 잠깁니다. 바위 위 낚시·채취 중 고립에 주의가 요구됩니다.'), num: t('방문객이 평소의 2.4배로 예상됩니다.'), range: t('파고 1.5~3.0m로 높아집니다. 다음 문장입니다.'),
                    glued: t('바람이 셉니다.두번째 문장입니다.'), quote: t('「물결이 높겠습니다.」 내용이 있습니다.'), paren: t('(예상됩니다.) 그다음'), end: t('끝 문장입니다.'), empty: t(''),
                };
                // ② 화면 — 분석 문단·(물때)·카드에 긴 URL
                const fx = JSON.parse(JSON.stringify(base));
                fx.overview.land = '협재해수욕장은 방문객이 평소의 1.8배로 예상돼 주의 수준입니다. 해안 바람 9m/s로 튜브가 떠밀릴 수 있습니다. 위험구역 기록이 있습니다. 따라서 협재해수욕장 주변 연안사고에 주의가 요구됩니다.';
                fx.sea.cards[0].advice = fx.sea.cards[0].advice + ' ' + URL;
                fx.summary.land.basis = fx.summary.land.basis.concat(['긴 영문 ' + URL]);
                fx.sea.cards = fx.sea.cards.map((c, i) => i === 1 ? Object.assign(c, { word: '관심 필요' }) : c);   // 옛 판 단계 말 하나 섞기
                R.render(box, { ok: true, briefing: fx }, { now, showSea: true, showLand: true, onLink: () => {} });
                await new Promise((res) => setTimeout(res, 200));
                const an = box.querySelector('[data-sb-analysis="land"]');
                // §11.10.20 덧붙임 3: 이름표는 자기 줄 · 문장마다 「•」 줄(li) — 줄마다 첫 글자 왼쪽이 같고(새 줄 첫머리), 이름표보다 아래
                const lis = [...an.querySelectorAll('li')], tg = an.querySelector('.sb-an-tag');
                out.an = { br: an.querySelectorAll('br').length, li: lis.length, lines: an.innerText.split('\n').map((x) => x.trim()).filter(Boolean), text: an.textContent, bullet: lis.length ? getComputedStyle(lis[0]).listStyleType : null,
                    tagAbove: !!tg && lis.length > 0 && tg.getBoundingClientRect().bottom <= lis[0].getBoundingClientRect().top + 1 };
                const leftOf = (node, off) => { const rg = document.createRange(); rg.setStart(node, off); rg.setEnd(node, off + 1); return rg.getClientRects()[0].left; };
                out.an.starts = lis.map((li) => { const tn = document.createTreeWalker(li, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.textContent.trim() ? 1 : 3 }).nextNode(); return Math.round(leftOf(tn, 0) - lis[0].getBoundingClientRect().left); });
                const tideP = [...box.querySelectorAll('[data-sb-part="tide"] .sb-sum-tide')].find((p) => p.hasAttribute('data-sb-rocks'));
                out.tide = { lines: tideP.innerText.split('\n').map((x) => x.trim()), link: (tideP.querySelector('[data-sb-maplink="rocks"]') || {}).textContent || null, text: tideP.textContent };
                // keep-all — 브리핑 안 글이 든 모든 요소
                const els = [...box.querySelectorAll('*')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
                out.wb = [...new Set(els.map((e) => getComputedStyle(e).wordBreak))]; out.ow = [...new Set(els.map((e) => getComputedStyle(e).overflowWrap))];
                // 카드 펼쳐 둔 채 가로 넘침
                box.querySelector('[data-sb-x="basis-land"]').click(); await new Promise((res) => setTimeout(res, 100));
                out.w = { page: document.documentElement.scrollWidth, card: [...box.querySelectorAll('.sb-card')].every((c) => c.scrollWidth <= c.clientWidth + 1), box: box.scrollWidth <= box.clientWidth + 1 };
                // 「•」 목록 걸린 들여쓰기 — 두 줄 이상인 목록 줄마다 둘째 줄부터의 왼쪽 = 첫 줄 글의 왼쪽
                const hang = (li) => { const w = document.createTreeWalker(li, NodeFilter.SHOW_TEXT), lefts = []; let n; while ((n = w.nextNode())) { if (n.parentElement.closest('.sb-x-panel') || !n.textContent.trim()) continue; const rg = document.createRange(); rg.selectNodeContents(n); [...rg.getClientRects()].forEach((q) => { if (q.width > 1) lefts.push({ l: Math.round(q.left), t: Math.round(q.top) }); }); }
                    const rows = {}; lefts.forEach((q) => { rows[q.t] = Math.min(rows[q.t] === undefined ? 1e9 : rows[q.t], q.l); }); const ls = Object.keys(rows).sort((a, b) => a - b).map((k) => rows[k]); return ls; };
                out.lists = [...box.querySelectorAll('.sb-sum-basis > li, .sb-wx-rows > li, .sb-wx-notes > li')].map(hang).filter((ls) => ls.length >= 2);
                out.listStyle = [...new Set([...box.querySelectorAll('.sb-list > li')].map((li) => getComputedStyle(li).listStylePosition + '/' + getComputedStyle(li).display))];
                // 칩·단추·배지
                out.chips = [...box.querySelectorAll('.sb-conclusion > .sb-chip:not([data-sb-komsa])')].map((c) => c.textContent); out.komsa = [...box.querySelectorAll('[data-sb-komsa]')].map((c) => c.textContent);
                out.cardChips = [...box.querySelectorAll('[data-sb-card="sea"] .sb-card-head .sb-chip')].map((c) => c.textContent);
                out.legend = [...box.querySelectorAll('.sb-legend-k')].map((k) => k.textContent);
                out.anyNeed = /(?:관심|주의|경계) 필요/.test([...box.querySelectorAll('.sb-chip, .sb-lvl-tab, .sb-legend-k, .sb-headline')].map((e) => e.textContent).join(' '));
                return out;
            }, { base, now: clock.now, URL });
            const U = r.unit;
            assert.deepEqual([U.two.same, U.two.br, U.two.parts], [true, 1, ['물에 잠깁니다. ', '|', '바위 위 낚시·채취 중 고립에 주의가 요구됩니다.']], '「다. 」 뒤 <br> — 빈칸은 <br> 앞에 남아 글은 그대로');
            assert.deepEqual([U.num.br, U.range.br, U.range.parts[0]], [0, 1, '파고 1.5~3.0m로 높아집니다. '], '숫자의 점(2.4배·1.5~3.0m)은 자르지 않음');
            assert.deepEqual([U.glued.br, U.glued.parts], [1, ['바람이 셉니다.', '|', '두번째 문장입니다.']], '「다.」 뒤에 한글이 바로 붙어도 자름(검증 sentences 와 같은 규칙)');
            assert.deepEqual([U.quote.br, U.paren.br, U.end.br, U.empty.br, U.end.same, U.empty.same], [0, 0, 0, 0, true, true], '「다.」 뒤 닫는 따옴표·괄호·글 끝은 자르지 않음');
            // §11.10.20 덧붙임 3(사용자 *"AI 분석 CHAT GPT 다음줄부터 본문이 시작되도록 하고, 각 문장마다 근거에 들어간것처럼 점으로 시작되도록"*) — <br> 대신 문장마다 「•」 줄
            assert.deepEqual([r.an.br, r.an.li, r.an.bullet, r.an.tagAbove], [0, 3, 'disc', true], '분석 문단 세 문장 → 「•」 줄 셋(마지막 「따라서」는 [권고] 상자로 빠짐) · 이름표는 자기 줄');
            assert.deepEqual(r.an.lines, ['AI 분석 · ChatGPT', '협재해수욕장은 방문객이 평소의 1.8배로 예상돼 주의 수준입니다.', '해안 바람 9m/s로 튜브가 떠밀릴 수 있습니다.', '위험구역 기록이 있습니다.'], '이름표 줄 + 문장마다 새 줄');
            assert.ok(r.an.starts.every((x) => Math.abs(x) <= 1), '새 문장은 줄 첫머리에서 시작 ' + JSON.stringify(r.an.starts));
            assert.equal(r.an.text, 'AI 분석 · ChatGPT 협재해수욕장은 방문객이 평소의 1.8배로 예상돼 주의 수준입니다. 해안 바람 9m/s로 튜브가 떠밀릴 수 있습니다. 위험구역 기록이 있습니다.', '글(textContent)은 그대로');
            assert.deepEqual([r.tide.lines, r.tide.link], [['관할 내 잠기는 바위(간출암) 2곳이 02:40~16:41 사이 물에 잠깁니다.', '바위 위 낚시·채취 중 고립에 주의가 요구됩니다.'], '잠기는 바위(간출암) 2곳'], '(물때) 간출암 두 줄 · 링크 그대로');
            assert.deepEqual([r.wb, r.ow], [['keep-all'], ['anywhere']], '브리핑 안 모든 글 — 어절 단위(keep-all)·긴 낱말만 아무 데서나(anywhere)');
            assert.deepEqual(r.w, { page: 360, card: true, box: true }, '360px — 긴 URL 이 있어도 가로로 넘치지 않음');
            assert.ok(r.lists.length >= 2, '두 줄 넘는 목록 줄이 있어야 잰다 — ' + r.lists.length);
            r.lists.forEach((ls) => assert.ok(ls.slice(1).every((x) => Math.abs(x - ls[0]) <= 1), '걸린 들여쓰기 — 둘째 줄부터 첫 글자 위치 ' + JSON.stringify(ls)));
            assert.deepEqual(r.listStyle, ['outside/list-item'], '목록 표지(•)는 글 밖(outside)');
            assert.deepEqual([r.chips, r.komsa], [['연안 주의', '해상 주의'], ['1개 해역 주의(KOMSA 예보)']]); assert.ok(r.cardChips.every((x) => !/필요/.test(x)) && r.cardChips.includes('관심'), '옛 판 「관심 필요」도 「관심」 — ' + r.cardChips.join());
            assert.deepEqual(r.legend.slice(0, 4), ['평소 수준', '관심', '주의', '경계'], '시간 막대 범례'); assert.equal(r.anyNeed, false);
            await page.locator('#station-briefing-content [data-sb-sec="overview"]').screenshot({ path: path.join(SHOT, 'briefing_text_360.png') });
            await page.evaluate(() => window.StationBriefingRender.render(document.getElementById('station-briefing-content'), JSON.parse(JSON.stringify(window.StationBriefing._state.resp)), { showSea: true, showLand: true, onLink: () => {} }));
            await page.setViewportSize({ width: 412, height: 915 });
        });
        // ── §11.10.16 소절 추가 결정(2026-10-17): B 카드 상한 없음 · C 처음 펼침은 「총평과 권고」만 · D 「특별 상황」 칸 없음 ──
        await check('[§11.10.16-B] 카드 상한 없음 — 서버 규칙으로 해역 13·관광지 12(관심 이상) → 카드 13·12 · 머리 배지 수 = 단계 단추 수 = 그 단계 카드 수 = 단계별 전체 수 · 단추마다 그 단계 카드 전부', async () => {
            const inp = mapInputs(hallimInput()), r0 = inp.sea.regions[0], s0 = inp.land.spots[0];
            inp.sea.regions = Array.from({ length: 13 }, (_, i) => ({ ...JSON.parse(JSON.stringify(r0)), rid: 'A:' + (3000 + i), accidentGridId: String(3000 + i), lat: 33.30 + i * 0.004, slots: i % 3 ? { [at(9)]: { accident: '주의' } } : { [at(9)]: { congestion: { level: '높음', index: 11, at: at(9) } } } }));
            inp.land.spots = Array.from({ length: 12 }, (_, i) => ({ ...JSON.parse(JSON.stringify(s0)), id: '50110|가상' + i, name: '가상관광지' + String(i).padStart(2, '0'), index: i < 4 ? 72 : 41, band: i < 4 ? '높음' : '다소 높음' }));
            const bb = R.buildBriefing(inp, WIN, { generatedAt: '2026-10-17T13:10:00+09:00' });
            assert.deepEqual([bb.sea.attentionRegions, bb.sea.cards.length, bb.land.attentionSpots, bb.land.cards.length], [13, 13, 12, 12]);
            const want = (cards) => [3, 2, 1].map((k) => [k, cards.filter((c) => c.rank === k).length]).filter(([, n]) => n);
            const r = await page.evaluate(async ({ bb, now }) => {
                const R = window.StationBriefingRender, box = document.getElementById('station-briefing-content');
                R.render(box, { ok: true, briefing: bb }, { now, showSea: true, showLand: true, onLink: () => {} });
                const one = (k) => { const sec = box.querySelector('[data-sb-sec="' + k + '"]'), tabs = [...sec.querySelectorAll('[role="tab"]')];
                    const badges = [...sec.querySelectorAll('[data-sb-sec-badges] .sb-chip')].map((c) => [Number(c.dataset.rank), c.textContent]);
                    const per = tabs.length ? tabs.map((t) => { t.click(); return [t.textContent, [...sec.querySelectorAll('.sb-card')].filter((c) => c.offsetParent !== null).length]; }) : [['', [...sec.querySelectorAll('.sb-card')].length]];
                    return { badges, per, all: sec.querySelectorAll('.sb-card').length }; };
                return { sea: one('sea'), land: one('land') };
            }, { bb, now: clock.now });
            for (const [k, cards] of [['sea', bb.sea.cards], ['land', bb.land.cards]]) {
                const w = want(cards), word = { 1: '관심', 2: '주의', 3: '경계' };
                assert.equal(r[k].all, cards.length, k + ' 카드 전부 ' + r[k].all);
                assert.deepEqual(r[k].badges, w.map(([rk, n]) => [rk, word[rk] + ' ' + n]), k + ' 머리 배지 수 = 단계별 카드 수');
                if (w.length > 1) assert.deepEqual(r[k].per, w.map(([rk, n]) => [word[rk] + ' ' + n, n]), k + ' 단추마다 그 단계 카드 전부');
            }
            assert.equal(r.land.badges.reduce((a, [, t]) => a + Number(t.split(' ')[1]), 0), bb.land.attentionSpots, '연안 배지 합 = 관심 이상 전체 수');
            await page.evaluate(() => window.StationBriefingRender.render(document.getElementById('station-briefing-content'), JSON.parse(JSON.stringify(window.StationBriefing._state.resp)), { showSea: true, showLand: true, onLink: () => {} }));   // 되돌려 놓기(지금 밀집 now 포함 실제 응답)
        });
        await check('[§11.10.16-C] 처음 상태 — 「총평과 권고」만 펼침(aria-expanded true), 해상 분석·연안 분석·조석은 접힘(aria-expanded false·본문 높이 0) · 머리를 누르면 펼침 · 다시 그리면 다시 처음 상태(펼친 것을 기억하지 않음 — 종전과 같음)', async () => {
            const r = await page.evaluate(async ({ b, now }) => {
                window.__sbKeepDefault = true;
                const R = window.StationBriefingRender, box = document.getElementById('station-briefing-content');
                const st = () => [...box.querySelectorAll('[data-sb-sec]')].map((x) => [x.dataset.sbSec, x.classList.contains('open'), x.querySelector('.marine-forecast-sub-header').getAttribute('aria-expanded'), x.querySelector('.sb-sec-body').clientHeight > 4]);   // 접힌 칸은 위 여백(4px)만 남는다
                R.render(box, { ok: true, briefing: b }, { now, showSea: true, showLand: true, onLink: () => {} }); await new Promise((res) => setTimeout(res, 500));
                const out = { first: st() };
                box.querySelector('[data-sb-sec="sea"] .marine-forecast-sub-header').click(); await new Promise((res) => setTimeout(res, 500)); out.clicked = st();
                R.render(box, { ok: true, briefing: b }, { now, showSea: true, showLand: true, onLink: () => {} }); await new Promise((res) => setTimeout(res, 500)); out.again = st();
                window.__sbKeepDefault = false;
                return out;
            }, { b: B.h, now: clock.now });
            const first = [['overview', true, 'true', true], ['sea', false, 'false', false], ['land', false, 'false', false], ['tide', false, 'false', false]];
            assert.deepEqual(r.first, first, JSON.stringify(r.first));
            assert.deepEqual(r.clicked[1], ['sea', true, 'true', true], '머리를 누르면 펼침');
            assert.deepEqual(r.again, first, '다시 그리면 처음 상태');
            await page.evaluate(() => window.StationBriefingRender.render(document.getElementById('station-briefing-content'), JSON.parse(JSON.stringify(window.StationBriefing._state.resp)), { showSea: true, showLand: true, onLink: () => {} }));   // 되돌려 놓기(지금 밀집 now 포함 실제 응답)
        });
        await check('[§11.10.16-D·E] 「특별 상황」 칸 없음 · 해상 근거 안 「기상특보 현황」 상자(창과 같은 상자 — ✕·맨 아래 문장 없음) 4행 전부 · 예비특보 칸 노랑 굵게 · 표 칸 따옴표 없음 · 360px 넘침 없음 · 옛 판(§11.10.1 결론 칸 모양)도 칸 없음', async () => {
            await page.setViewportSize({ width: 360, height: 780 });
            const inp = mapInputs(hallimInput());
            inp.sea.warnings = (inp.sea.warnings || []).concat([
                { zone: '제주도남부앞바다', kind: '앞바다', type: '강풍', level: '주의보', state: '발효', effective: { start: '2026-10-16T20:00:00+09:00', end: '2026-10-16T20:00:00+09:00', range: false }, release: { start: at(12), end: at(12), range: false }, issued: { start: '2026-10-16T14:00:00+09:00', end: '2026-10-16T14:00:00+09:00', range: false } },
                { zone: '제주도남쪽먼바다', kind: '먼바다', type: '풍랑', level: '주의보', state: '예비', effective: { start: at(18), end: at(18), range: false }, release: null }]);
            const bb = R.buildBriefing(inp, WIN, { generatedAt: '2026-10-17T13:10:00+09:00' }), Wt = bb.summary.sea.warnings;
            assert.equal(Wt.rows.length, 4);
            const old = JSON.parse(JSON.stringify(bb)); delete old.summary.analysis;   // §11.10.1 판(결론 칸 — summaryBodyV2)
            const r = await page.evaluate(async ({ bb, old, now }) => {
                const R = window.StationBriefingRender, box = document.getElementById('station-briefing-content'), out = {};
                R.render(box, { ok: true, briefing: bb }, { now, showSea: true, showLand: true, onLink: () => {} });
                const x = box.querySelector('button[data-sb-x="basis-sea"]'); if (x && x.getAttribute('aria-expanded') !== 'true') x.click();
                out.secs = [...box.querySelectorAll('[data-sb-sec]')].map((e) => e.dataset.sbSec); out.special = box.querySelectorAll('.sb-special, [data-sb-sec="special"]').length;
                const wb = box.querySelector('[data-sb-summary="sea"] [data-sb-warnbox="basis"]');
                out.box = wb && { title: wb.querySelector('.sb-wxbox-t').textContent, head: [...wb.querySelectorAll('th')].map((e) => e.textContent), rows: [...wb.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent).join('|')),
                    iss: (wb.querySelector('.sb-wxbox-iss') || {}).textContent, close: !!wb.querySelector('[data-sb-map-close]'), note: !!wb.querySelector('[data-sb-warn-note]'),
                    pre: [...wb.querySelectorAll('td.sb-srcb-grade')].map((td) => [td.textContent, getComputedStyle(td).color, getComputedStyle(td).fontWeight]),
                    radius: parseFloat(getComputedStyle(wb).borderTopLeftRadius), fit: (() => { const r0 = wb.getBoundingClientRect(), t = wb.querySelector('.sb-srcb-tblw'); return r0.right <= innerWidth + 0.5 && t.scrollWidth <= t.clientWidth + 1; })() };
                out.page = document.documentElement.scrollWidth; out.vw = innerWidth;
                out.text = box.textContent;
                const rgb = (c) => { const e = document.createElement('i'); e.style.color = c; document.body.appendChild(e); const v = getComputedStyle(e).color; e.remove(); return v; }; out.yellow = rgb(R.colorOf(1));
                R.render(box, { ok: true, briefing: old }, { now, showSea: true, showLand: true, onLink: () => {} });
                out.oldSecs = [...box.querySelectorAll('[data-sb-sec]')].map((e) => e.dataset.sbSec); out.oldSpecial = box.querySelectorAll('.sb-special').length;
                return out;
            }, { bb, old, now: clock.now });
            assert.deepEqual([r.secs.includes('special'), r.special, r.oldSecs.includes('special'), r.oldSpecial], [false, 0, false, 0]);
            assert.deepEqual([r.box.title, r.box.head, r.box.close, r.box.note], ['기상특보 현황', ['특보구역', '특보', '시각'], false, false], '근거 안 상자 — ✕·맨 아래 문장 없음');
            assert.deepEqual(r.box.rows, ['제주도북부앞바다|풍랑주의보|06~09시 해제 예고', '제주도남부앞바다|강풍주의보|12:00 해제 예고', '제주도서부앞바다|풍랑주의보 예비특보|21~24시 발효 예정', '제주도남쪽먼바다|풍랑주의보 예비특보|18:00 발효 예정']);
            assert.equal(r.box.iss, '기상청 10월 16일 14:00 발표');
            assert.ok(r.box.pre.length === 2 && r.box.pre.every(([, c, w]) => c === r.yellow && Number(w) >= 700), '예비특보 칸 노랑 굵게 ' + JSON.stringify(r.box.pre));
            assert.ok(r.box.radius >= 10 && r.box.fit && r.page <= r.vw + 1, '둥근 상자 · 360px 넘침 없음 ' + JSON.stringify([r.box.radius, r.box.fit, r.page]));
            assert.ok(!r.text.includes(R.RELEASE_LINES[0]), '종전 「특별 상황」 두 줄은 화면에 없음');
            await page.evaluate(() => window.StationBriefingRender.render(document.getElementById('station-briefing-content'), JSON.parse(JSON.stringify(window.StationBriefing._state.resp)), { showSea: true, showLand: true, onLink: () => {} }));   // 되돌려 놓기(지금 밀집 now 포함 실제 응답)
            await page.setViewportSize({ width: 412, height: 915 });
        });
        await check('[§11.10.16-E1] 분석 문단의 특보 말 → 「기상특보 현황」 창 — 「풍랑주의보 해제 예고」·「예비특보」가 링크(aria-haspopup=dialog · 강조색 노랑 + 밑줄) · 창 = 제목·표 「특보구역 | 특보 | 시각」 행 수·발표·맨 아래 문장(「이틀 동안 … 많았습니다」 굵게 · 「1.2~1.3배」 노랑) · ✕·Esc·바깥 닫힘·초점 · 360px · 특보 말이 없으면 「(특보) …」 한 줄 폴백 · 연안 쪽 링크는 연안 특보 표', async () => {
            await page.setViewportSize({ width: 360, height: 780 });
            const inp = mapInputs(hallimInput());
            inp.land.spots[0] = { ...inp.land.spots[0], warnZone: '제주도', notices: { effective: [], prelim: ['강풍주의보'], windMs: 9, detail: [{ name: '강풍주의보', state: '예비', issued: { start: at(5), end: at(5), range: false }, effective: { start: at(18), end: at(18), range: false }, release: null }] } };
            const bb = R.buildBriefing(inp, WIN, { generatedAt: '2026-10-17T13:10:00+09:00' });
            assert.ok(bb.summary.land.warnings && bb.summary.sea.warnings, '연안·해상 표 둘 다');
            bb.overview = { land: '협재해수욕장은 연안 위험지수 \'높음\'으로 주의 수준이고, 방문객이 평소의 1.8배로 예상됩니다. 강풍주의보 예비특보가 있어 연안 상황 변화에 유의해야 합니다. 따라서 협재해수욕장 주변 연안사고에 주의가 요구됩니다.',
                sea: '232해구 예보는 15시부터 유의파고 2.4m로 높아질 것으로 예상됩니다. 풍랑주의보 해제 예고와 예비특보가 있어 상황 변화에 유의해야 합니다. 따라서 비양도 주변 해역 운항에 주의가 요구됩니다.', source: 'chatgpt', model: 'x' };
            const r = await page.evaluate(async ({ bb, now }) => {
                const R = window.StationBriefingRender, box = document.getElementById('station-briefing-content'), out = {}, sleep = (ms) => new Promise((res) => setTimeout(res, ms));
                R.render(box, { ok: true, briefing: bb }, { now, showSea: true, showLand: true, onLink: () => {} });
                const lk = (k) => [...box.querySelectorAll('[data-sb-analysis="' + k + '"] [data-sb-maplink="warn"]')];
                out.seaLinks = lk('sea').map((b) => [b.textContent, b.getAttribute('aria-haspopup'), getComputedStyle(b).color, getComputedStyle(b).textDecorationLine, getComputedStyle(b).fontWeight]);
                out.landLinks = lk('land').map((b) => b.textContent); out.fb0 = box.querySelectorAll('[data-sb-warn-fallback]').length;
                const rgb = (c) => { const e = document.createElement('i'); e.style.color = c; document.body.appendChild(e); const v = getComputedStyle(e).color; e.remove(); return v; }; out.yellow = rgb(R.colorOf(1));
                const dlg = () => { const d = document.querySelector('[data-sb-map-popup="warn"]'); if (!d) return null; const bx = d.querySelector('.sb-dlg-box'), wb = d.querySelector('[data-sb-warnbox="dialog"]'), rr = wb.getBoundingClientRect(), note = wb.querySelector('[data-sb-warn-note]'), em = note && note.querySelector('.sb-wxbox-em'), num = note && note.querySelector('.sb-wxbox-num');
                    return { role: bx.getAttribute('role'), modal: bx.getAttribute('aria-modal'), label: bx.getAttribute('aria-label'), named: document.getElementById(bx.getAttribute('aria-labelledby')).textContent, title: wb.querySelector('.sb-wxbox-t').textContent,
                        head: [...wb.querySelectorAll('th')].map((e) => e.textContent), rows: wb.querySelectorAll('tbody tr').length, zones: [...wb.querySelectorAll('tbody tr td:first-child')].map((e) => e.textContent), iss: (wb.querySelector('.sb-wxbox-iss') || {}).textContent || null,
                        note: note ? note.textContent : null, em: em ? [em.textContent, getComputedStyle(em).fontWeight] : null, num: num ? [num.textContent, getComputedStyle(num).color] : null,
                        focus: !!document.activeElement && document.activeElement.hasAttribute('data-sb-map-close'), left: Math.round(rr.left), right: Math.round(innerWidth - rr.right), fit: (() => { const t = wb.querySelector('.sb-srcb-tblw'); return t.scrollWidth <= t.clientWidth + 1; })() }; };
                lk('sea')[0].click(); await sleep(50); out.sea = dlg();
                document.querySelector('[data-sb-map-popup]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); out.afterEsc = !!document.querySelector('[data-sb-map-popup]');
                lk('sea')[1].click(); await sleep(50); document.querySelector('[data-sb-map-close]').click(); out.afterX = !!document.querySelector('[data-sb-map-popup]');
                lk('land')[0].click(); await sleep(50); out.land = dlg(); document.querySelector('.sb-dlg-dim').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); out.afterDim = !!document.querySelector('[data-sb-map-popup]');
                // 폴백 — 해상 문단에 특보 말이 없으면 문단 아래 「(특보) 해제 예고 1곳 · 예비특보 1곳」 한 줄(그 글이 링크)
                const nb = JSON.parse(JSON.stringify(bb)); nb.overview.sea = '232해구 예보는 15시부터 유의파고 2.4m로 높아질 것으로 예상됩니다. 둘째 문장입니다. 따라서 비양도 주변 해역 운항에 주의가 요구됩니다.';
                R.render(box, { ok: true, briefing: nb }, { now, showSea: true, showLand: true, onLink: () => {} });
                const fb = box.querySelector('[data-sb-summary="sea"] [data-sb-warn-fallback]');
                out.fb = fb && { text: fb.textContent, after: fb.previousElementSibling && fb.previousElementSibling.getAttribute('data-sb-analysis'), link: !!fb.querySelector('[data-sb-maplink="warn"]') };
                if (fb) { fb.querySelector('button').click(); await sleep(50); out.fbOpen = !!document.querySelector('[data-sb-map-popup="warn"]'); document.querySelector('[data-sb-map-close]').click(); }
                return out;
            }, { bb, now: clock.now });
            assert.deepEqual(r.seaLinks.map((x) => x[0]), ['풍랑주의보 해제 예고', '예비특보']);
            assert.ok(r.seaLinks.every(([, hp, c, dec, w]) => hp === 'dialog' && c === r.yellow && /underline/.test(dec) && Number(w) >= 700), JSON.stringify(r.seaLinks));
            assert.deepEqual([r.landLinks, r.fb0], [['강풍주의보 예비특보'], 0], '연안 문단도 링크 · 특보 말이 있으면 폴백 없음');
            const S = r.sea;
            assert.deepEqual([S.role, S.modal, S.label, S.named, S.title, S.head], ['dialog', 'true', '기상특보 현황', '기상특보 현황', '기상특보 현황', ['특보구역', '특보', '시각']]);
            assert.deepEqual([S.rows, S.iss], [bb.summary.sea.warnings.rows.length, bb.summary.sea.warnings.issued]);
            assert.equal(S.note, '특보가 풀리면 출항이 몰릴 수 있으며, 2020~2025년 특보 해제 뒤 이틀 동안 전복·침몰·침수·표류 사고가 평소보다 약 1.2~1.3배 많았습니다.');
            assert.deepEqual(S.em, ['이틀 동안 전복·침몰·침수·표류 사고가 평소보다 약 1.2~1.3배 많았습니다', S.em[1]]); assert.ok(Number(S.em[1]) >= 700, '굵게');
            assert.deepEqual(S.num, ['1.2~1.3배', r.yellow], '수치 노랑');
            assert.ok(S.focus && S.left >= 16 && S.right >= 16 && S.fit, '초점 ✕ · 360px 좌우 여백 · 표 넘침 없음 ' + JSON.stringify([S.focus, S.left, S.right, S.fit]));
            assert.deepEqual([r.afterEsc, r.afterX, r.afterDim], [false, false, false], 'Esc·✕·바깥으로 닫힘');
            assert.deepEqual([r.land.zones, r.land.note], [['제주도'], null], '연안 링크 = 연안 특보 표(그 관광지 특보구역) · 해제 소식이 없으면 맨 아래 문장 없음');
            assert.deepEqual(r.fb, { text: '(특보) 해제 예고 1곳 · 예비특보 1곳', after: 'sea', link: true }, '폴백 한 줄'); assert.ok(r.fbOpen);
            // 스크린샷 — 문단 링크(해상) · 「기상특보 현황」 창 · 근거 안 상자(360px)
            await page.evaluate(({ bb, now }) => { const box = document.getElementById('station-briefing-content'); window.StationBriefingRender.render(box, { ok: true, briefing: bb }, { now, showSea: true, showLand: true, onLink: () => {} }); const x = box.querySelector('button[data-sb-x="basis-sea"]'); if (x) x.click(); box.querySelector('[data-sb-summary="sea"]').scrollIntoView(); }, { bb, now: clock.now });
            await clean(page); await page.locator('#station-briefing-content [data-sb-summary="sea"]').screenshot({ path: path.join(SHOT, 'briefing_warn_basis_360.png') });
            await page.evaluate(() => document.querySelector('[data-sb-analysis="sea"] [data-sb-maplink="warn"]').click()); await page.waitForTimeout(150);
            await page.screenshot({ path: path.join(SHOT, 'briefing_warn_popup_360.png') }); await page.evaluate(() => document.querySelector('[data-sb-map-close]').click());
            await page.evaluate(() => window.StationBriefingRender.render(document.getElementById('station-briefing-content'), JSON.parse(JSON.stringify(window.StationBriefing._state.resp)), { showSea: true, showLand: true, onLink: () => {} }));
            await page.setViewportSize({ width: 412, height: 915 });
        });
        await check('[§11.10.16 소절] 카드 「[이름표] 글」 줄 걸린 들여쓰기 — 해역·연안 카드의 [권고]·[사고현황]·[기상 예보]·[특성]·[오늘 예상] 글이 두 줄 넘으면 둘째 줄도 이름표 오른쪽 글 시작 x 에서(360px)', async () => {
            await page.setViewportSize({ width: 360, height: 780 });
            const r = await page.evaluate(() => {
                const box = document.getElementById('station-briefing-content'), out = [];
                box.querySelectorAll('[data-sb-card] .sb-row').forEach((row) => {
                    const k = row.querySelector('.sb-row-k'), v = row.children[1]; if (!k || !v) return;
                    const rg = document.createRange(); rg.selectNodeContents(v);
                    const lines = []; [...rg.getClientRects()].filter((q) => q.width > 0.5).forEach((q) => { const l = lines.find((x) => Math.abs(x.top - q.top) < 3); if (l) l.left = Math.min(l.left, q.left); else lines.push({ top: q.top, left: q.left }); });
                    if (lines.length < 2) return;
                    out.push({ card: row.closest('[data-sb-card]').dataset.sbCard, k: k.textContent, lefts: lines.map((x) => Math.round(x.left * 10) / 10), kRight: Math.round(k.getBoundingClientRect().right * 10) / 10 });
                });
                return { rows: out, page: document.documentElement.scrollWidth, vw: innerWidth };
            });
            const sea = r.rows.filter((x) => x.card === 'sea'), land = r.rows.filter((x) => x.card === 'land');
            assert.ok(sea.some((x) => x.k === '[권고]') && land.length > 0, '두 줄 넘는 줄이 해역([권고])·연안 카드에 있어야 의미가 있다 ' + JSON.stringify(r.rows.map((x) => x.card + x.k)));
            for (const x of r.rows) assert.ok(x.lefts.every((l) => Math.abs(l - x.lefts[0]) <= 1) && x.lefts[0] > x.kRight, x.card + ' ' + x.k + ' 줄마다 글 시작 x ' + JSON.stringify(x));
            assert.ok(r.page <= r.vw + 1);
            await page.setViewportSize({ width: 412, height: 915 });
        });
        await check('[UI-B1·B3·B5·B6·B10·B14] 총평 단계 < 해상 분석 단계면 한 줄 · 지난 칸 흐리게 · 검토 줄·「자료 확인 불가」 줄 없음(§11.10.16 — 종전 「카드는 10곳까지」) · 내일 판 「내일」 · 출처 한 벌 · 지난 예정 시각은 「준비 중」', async () => {
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
                out.counts = box.querySelectorAll('[data-sb-sea-count], [data-sb-land-count]').length; out.secText = box.querySelector('[data-sb-sec="sea"]').textContent + box.querySelector('[data-sb-sec="land"]').textContent;
                const f1 = JSON.parse(JSON.stringify(b1)); f1.land.failedSpots = 2; R.render(box, { ok: true, briefing: f1 }, { now }); out.failed = (box.querySelector('[data-sb-land-failed]') || {}).textContent || null; out.failedText = box.querySelector('[data-sb-sec="land"]').textContent;
                R.render(box, { ok: true, briefing: b1 }, { now }); out.noFailed = !box.querySelector('[data-sb-land-failed]');
                out.past = [...box.querySelectorAll('.sb-slot')].map((x) => x.dataset.past === 'true'); out.pastOpacity = getComputedStyle(box.querySelector('.sb-slot-past')).opacity;
                out.legend = box.querySelector('.sb-legend').textContent; out.labels = (b1.sea.timeBar || []).map((s) => s.label);
                // §11.10.20 → 2026-10-18 꼬리 「데이터 출처 보기」 삭제 — 본문에 출처 버튼·표 없음(출처는 [기준 상세]에만)
                out.srcInBody = box.querySelectorAll('button[data-sb-x="sources"], [data-sb-sources], .sb-src-tbl').length + (/데이터 출처 보기/.test(box.textContent) ? 1 : 0);
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
            assert.deepEqual(r.badges.map((x) => x.split(':').slice(0, 2).join(':')), ["2:1개 해역 주의(KOMSA 예보)"], '배지 수 = summary.sea.accidentOnly(근거 줄과 같은 수) ' + r.badges.join(' / '));
            assert.equal(B.h.summary.sea.accidentOnly.reduce((a, g) => a + g.count, 0), B.h.sea.attentionRegions - B.h.sea.overviewRegions, '배지 수 합 = 위험예보만 해역 수');
            assert.ok(r.badgeNext, '배지는 「해상 ○○」 칩 바로 오른쪽, 결론 글 앞');
            assert.deepEqual(r.oldBadges, ['1개 해역 주의(KOMSA 예보)'], '옛 판 — 카드로 셈');
            assert.equal(r.oldShort, 0, '옛 판에 카드가 모자라면 배지 없음(지어내지 않음)');
            assert.deepEqual(r.v2Badges, ['1개 해역 주의(KOMSA 예보)'], '§11.10.1 판(결론 칸)에도 배지');
            assert.ok(r.noNote, '위험예보만 해역이 없으면 배지·줄 없음');
            assert.deepEqual([r.oldNoteLine, r.oldNote], [true, ''], '옛 판 note 가 있어도 위험예보만 해역 줄 풀이는 보이지 않음');
            // §11.10.16(사용자 *"이 문구 굳이 넣을 필요없음"*): 「관할 해역 N칸 검토 · 관심 이상 …」·「관광지 N곳 검토 …」 줄 없음
            assert.deepEqual([r.counts, /칸 검토|곳 검토|카드는 단계 높은 순/.test(r.secText)], [0, false], r.secText.slice(0, 200));
            // §11.10.16 소절 A(사용자 *"아예 확인 불가도 빼."*): 「관광지 N곳 자료 확인 불가」 줄도 없음(종전 [data-sb-land-failed] 줄) — failedSpots 가 있어도
            assert.deepEqual([r.failed, r.noFailed, /자료 확인 불가/.test(r.failedText)], [null, true, false], r.failedText.slice(0, 200));
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
            // 출처는 [기준 상세] 표 한 곳(SOURCES — 줄마다 구분·자료·출처·쓰는 곳, §11.10.20) · 2026-10-18 본문 꼬리 「데이터 출처 보기」 삭제
            assert.equal(r.srcInBody, 0, '본문에 「데이터 출처 보기」 버튼·표 없음');
            assert.deepEqual([...new Set(r.sources.map((x) => x[3]))], ['해상', '기상', '연안', '물때'], '해상·기상·연안·물때 묶음 순서');
            assert.ok(r.sources.some((x) => x[1] === '해양경찰청 선박사고 기록(국립해양조사원 개방海 제공)' && x[0].includes('2021~2025')));
            assert.ok(r.sources.some((x) => x[0].includes('익수·추락·고립·표류·기타') && x[0].includes('앞바다 500m') && x[0].includes('2020~2024')));
            assert.ok(r.sources.some((x) => x[1].includes('Gemini 보충')));
            await tap(page, '#station-briefing-content .sb-basis-btn'); await page.waitForSelector('.rf-modal .rf-basis');
            const rows = await page.evaluate(() => { const t = [...document.querySelectorAll('.rf-basis-body table')].find((x) => x.textContent.includes('쓰는 곳')); return [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent)); });
            assert.deepEqual(rows, r.sources.map((x) => [x[3], x[0], x[1], x[2]]), '[기준 상세] 출처 표 = SOURCES 전부 그대로(첫 칸 구분 — §11.10.20)');
            await page.keyboard.press('Escape');
        });
        // ── §11.10.3(2026-10-17 사용자 결정) — (고립 주의) 지점 표 · 해상 근거 칸·이름 · 근거 줄 ▸ 미니 지도(관할 + 깜빡이는 칸) · [기준 상세] ──
        await check('[§11.10.3 → §11.10.10] (물때) 아래 (고립 주의) — 「과거 고립 사고(N개소 M건)」 버튼(화살표 없음 · aria-expanded·aria-controls) → 「지점명 | 발생 현황」 표 전부(합 많은 순 · 연도별) · 다시 누르면 접힘 · 「물이 차오르기 전에」·「공통」·「공식 사고예보」 없음 · 단위 칸', async () => {
            await openAcc(page); await openBasis(page, 'land'); await openBasis(page, 'sea');   // 근거·권고 글은 접힌 「분석 근거」 안(§11.10.4)
            const r = await page.evaluate(() => {
                const c = document.getElementById('station-briefing-content'), iso = c.querySelector('[data-sb-part="tide"] [data-sb-isolation]'), btn = iso && iso.querySelector('button[data-sb-x="iso"]');
                const out = { line: iso ? iso.querySelector('.sb-iso-line').textContent : '', btn: btn ? btn.textContent : '', arrow: btn ? btn.querySelectorAll('.sb-x-arrow, .sb-x-chev').length : -1, exp0: btn && btn.getAttribute('aria-expanded'), ctl: btn && btn.getAttribute('aria-controls') };
                btn.click();
                const panel = document.getElementById(out.ctl);
                out.exp1 = btn.getAttribute('aria-expanded'); out.hidden1 = panel.hidden;
                out.head = [...panel.querySelectorAll('thead th')].map((x) => x.textContent); out.rows = [...panel.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((x) => x.textContent).join('|'));
                out.caption = (panel.querySelector('caption') || {}).textContent || '';
                btn.click(); out.exp2 = btn.getAttribute('aria-expanded'); out.hidden2 = panel.hidden; out.empty2 = panel.childElementCount === 0;
                out.text = c.textContent; out.sum = c.querySelector('[data-sb-sec="overview"]').textContent;
                return out;
            });
            assert.equal(B.h.summary.isolation.text, '[고립 주의] 저조 시간(06:12·18:40) 전후 과거 고립 사고(2개소 3건)으로 확인 및 주의가 요구됩니다.');
            assert.equal(r.line, '[고립 주의] 저조 시간(06:12·18:40) 전후 과거 고립 사고(2개소 3건)으로 확인 및 주의가 요구됩니다.', '버튼은 문장 안 그 자리 · 화살표 없음(§11.10.10 D)');
            assert.deepEqual([r.btn, r.arrow, r.exp0, r.exp1, r.hidden1, r.exp2, r.hidden2, r.empty2], ['과거 고립 사고(2개소 3건)', 0, 'false', 'true', false, 'false', true, true]);
            assert.deepEqual(r.head, ['지점명', '발생 현황']); assert.deepEqual(r.rows, ['협재해수욕장|22년(1건), 24년(1건)', '한림항|23년(1건)']);
            assert.equal(r.caption, '2020~2024 연안사고 기록 중 고립(관광지 구역 + 앞바다 500m)');
            for (const no of ['차오르기 전에', '공통', '공식 사고예보', '겹치지 않아']) assert.ok(!r.text.includes(no), no);
            for (const no of ['물가 접근', '시경 ']) assert.ok(!r.sum.includes(no), no + ' — 총평에는 없음(해역·관광지 카드 문장은 그대로)');
            assert.ok(r.text.includes('관할 해역 3칸 중 위험이 높아진 해역 2칸') && r.text.includes("해양사고 위험예보(KOMSA) 기준 등급 '주의'인 해역 1칸") && r.text.includes('주변 연안사고에 주의가 요구됩니다.'), r.text.slice(0, 600));
        });
        await check('[§11.10.3] 해상 근거 ▸ — 위험이 높아진 해역·해양사고 위험예보만·232해구 줄이 버튼, 누르면 바로 아래 지도(관할 경계 + 그 칸 테두리 깜빡임), 접거나 다시 그리면 깜빡임이 멈춘다', async () => {
            const r = await page.evaluate(async () => {
                const sleep = (ms) => new Promise((res) => setTimeout(res, ms)), R = window.StationBriefingRender, c = document.getElementById('station-briefing-content');
                const btns = [...c.querySelectorAll('[data-sb-summary="sea"] button.sb-x-btn[data-sb-x^="map-"]')], out = { keys: btns.map((b) => b.dataset.sbX), texts: btns.map((b) => b.textContent) };
                out.note = (c.querySelector('[data-sb-basis="accidentOnly"] .sb-basis-note') || {}).textContent || '';
                const nowEl = c.querySelector('[data-sb-summary="sea"] > [data-sb-now]'); out.now = !!nowEl && nowEl.previousElementSibling.hasAttribute('data-sb-advice') && ((e) => e.hasAttribute('data-sb-analysis') || (e.hasAttribute('data-sb-warn-fallback') && e.previousElementSibling.hasAttribute('data-sb-analysis')))(nowEl.previousElementSibling.previousElementSibling) && nowEl.nextElementSibling.classList.contains('sb-basis-x');   // §11.10.9 ⑤ — 분석 문단 → (권고) → 지금
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
            assert.ok(r.texts[2].startsWith('232해구 예보 15시부터 유의파고 2.4m·풍속 13m/s로 높아짐(예상)'), r.texts[2]);
            assert.equal(r.note, '', '풀이 줄 「(한국해양교통안전공단 예보에서는 …)」 없음(§11.10.12)');
            assert.ok(r.now, '「지금 … 선박 N척」은 해상 분석 문단 바로 아래(분석 근거 칸 위 — §11.10.4)');
            const hl = [2, 1, 1];
            r.each.forEach((o, i) => {
                assert.deepEqual([o.exp, o.next, o.map, o.area, o.hl, o.blink, o.count1, o.exp2, o.blink2, o.count2, o.empty], ['true', true, 'ol', 1, hl[i], 'on', 1, 'false', 'off', 0, true], JSON.stringify(o));
                assert.ok(o.h >= 190 && o.h <= 210, '지도 높이 약 200px — ' + o.h); assert.ok(o.fits, '관할 전체가 보이게 맞춤');
                assert.equal(o.base, 'khoa', '바탕은 관심해역 고르기 지도와 같은 해아름 바다지도(이 시험은 타일 요청을 막아 바탕이 비어 보인다)');
                assert.ok(/^[01]>[01]$/.test(o.phases) && o.phases !== '1>', '깜빡임 진행 ' + o.phases); assert.ok(o.cap.includes('한림파출소 관할 해역'), o.cap);
            });
            assert.ok(r.each[2].cap.includes('232해구'), r.each[2].cap);
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
            assert.ok(kb.right <= kb.vw && kb.text === '1개 해역 주의(KOMSA 예보)', JSON.stringify(kb));
            await page.locator('#station-briefing-content [data-sb-summary="sea"] .sb-conclusion').screenshot({ path: path.join(SHOT, 'briefing_komsa_badge_380.png') });
            await page.evaluate(() => { document.querySelector('#station-briefing-content button[data-sb-x="map-accidentOnly"]').click(); const i = document.querySelector('#station-briefing-content button[data-sb-x="iso"]'); i.click(); i.scrollIntoView({ block: 'center' }); });
            await page.waitForTimeout(200); await clean(page);
            await page.locator('#station-briefing-content [data-sb-part="tide"]').screenshot({ path: path.join(SHOT, 'briefing_isolation_380.png') });
            await page.evaluate(() => document.querySelector('#station-briefing-content button[data-sb-x="iso"]').click());
            await page.setViewportSize({ width: 412, height: 915 });
        });
        await check('[§11.10.10 ABC] 「관할 내 잠기는 바위(간출암) 2곳」 — 그 글만 링크 → 가운데 팝업 지도(관할 경계 + 바위 2개, 위험지형과 같은 간출암 그림) → 마커를 누르면 해양안전 「위험지형」과 같은 간출암 조석 곡선 상자(같은 id 로 /api/hazard-rocks/tide-curve) · Esc 는 상자 먼저 · ✕ · 360px', async () => {
            await page.setViewportSize({ width: 360, height: 780 }); await openAcc(page);
            const seen = [];
            const curve = (day) => ({ success: true, ready: true, date: 20261017 + day, region: 'jeju', valsouCm: 90, points: Array.from({ length: 145 }, (_, i) => ({ t: String(Math.floor(i / 6) % 24).padStart(2, '0') + ':' + String((i % 6) * 10).padStart(2, '0'), cm: Math.round(150 + 120 * Math.cos(i / 145 * 4 * Math.PI)) })), peaks: [{ t: '06:12', cm: 30, type: 'low' }, { t: '12:30', cm: 270, type: 'high' }], prevPeaks: [], submergedAt: ['02:40'] });
            await page.route('**/api/hazard-rocks/tide-curve*', (rt) => { const u = new URL(rt.request().url()); seen.push(u.searchParams.get('id') + ':' + u.searchParams.get('day')); return rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(curve(Number(u.searchParams.get('day')))) }); });
            assert.equal(B.h.summary.tide[1], '관할 내 잠기는 바위(간출암) 2곳이 02:40~16:41 사이 물에 잠깁니다. 바위 위 낚시·채취 중 고립에 주의가 요구됩니다.');
            assert.deepEqual(B.h.summary.rocks.rows.map((x) => x.id), [812, 77]);
            const r1 = await page.evaluate(() => {
                const c = document.getElementById('station-briefing-content'), p = c.querySelector('[data-sb-part="tide"] [data-sb-rocks]'), lk = p && p.querySelector('[data-sb-maplink="rocks"]');
                const t = c.querySelector('.sb-tide [data-sb-rocks] [data-sb-maplink="rocks"]');
                const out = { line: p ? p.textContent : '', link: lk ? lk.textContent : '', haspopup: lk && lk.getAttribute('aria-haspopup'), tideSec: !!t, api: typeof window.HazardRockTidePanel };
                lk.click();
                const d = document.querySelector('[data-sb-map-popup="rocks"]'), m = d && d.querySelector('.sb-minimap');
                out.title = d ? d.querySelector('.sb-dlg-title').textContent : ''; out.points = m && m.dataset.sbMapPoints; out.icon = m && m.dataset.sbMapIcon; out.area = m && m.dataset.sbMapArea; out.cap = d ? d.querySelector('.sb-minimap-cap').textContent : '';
                return out;
            });
            assert.equal(r1.line, B.h.summary.tide[1]); assert.equal(r1.link, '잠기는 바위(간출암) 2곳'); assert.equal(r1.haspopup, 'dialog'); assert.ok(r1.tideSec, '아래 조석 칸의 같은 줄도 링크'); assert.equal(r1.api, 'object');
            assert.deepEqual([r1.title, r1.points, r1.icon, r1.area], ['한림파출소 관할 내 잠기는 바위(간출암) 2곳', '2', 'hazard-rocks', '1']); assert.ok(r1.cap.includes('바위 그림') && r1.cap.includes('한림파출소 관할 해역'), r1.cap);
            await page.waitForTimeout(400);
            // 마커(id 812)의 화면 위치를 지도에서 재서 실제로 누른다(OL 클릭)
            const pt = await page.evaluate(() => { const m = document.querySelector('[data-sb-map-popup="rocks"] .sb-minimap'), H = m._sbMap, f = H.points.getFeatures().find((x) => x.get('row').id === 812), px = H.map.getPixelFromCoordinate(f.getGeometry().getCoordinates()), rc = m.getBoundingClientRect(); return { x: rc.left + px[0], y: rc.top + px[1], inside: px[0] > 0 && px[1] > 0 && px[0] < rc.width && px[1] < rc.height }; });
            assert.ok(pt.inside, '마커가 지도 안에 보임 ' + JSON.stringify(pt));
            await page.mouse.click(pt.x, pt.y); await page.waitForSelector('[data-sb-map-popup="rocks"] .sb-rockbox'); await page.waitForFunction(() => { const b = document.querySelector('.sb-rockbox .rtp-body'); return b && b.style.display !== 'none' && document.querySelector('.sb-rockbox .rtp-svg').childElementCount > 0; });
            await page.waitForTimeout(200);
            const r2 = await page.evaluate(() => {
                const b = document.querySelector('.sb-rockbox'), rc = b.getBoundingClientRect(), m = document.querySelector('[data-sb-map-popup="rocks"] .sb-minimap');
                const struct = (e) => [...e.children].map((x) => x.className.baseVal !== undefined ? 'svg' : x.className).join('|');
                return { id: b.dataset.sbRockbox, cls: b.className, title: b.querySelector('.rtp-title').textContent, day: b.querySelector('.rtp-daylabel').textContent, prevDis: b.querySelector('.rtp-prev').disabled, struct: struct(b), card: b.querySelector('.rtp-tidecard').textContent.includes('조석'), sel: m.dataset.sbMapSel,
                    left: Math.round(rc.left), right: Math.round(innerWidth - rc.right), top: Math.round(rc.top), bottom: Math.round(innerHeight - rc.bottom), focus: document.activeElement && document.activeElement.classList.contains('rtp-close'), pe: getComputedStyle(b).pointerEvents };
            });
            assert.deepEqual([r2.id, r2.title, r2.day, r2.prevDis, r2.sel, r2.focus, r2.pe], ['812', '간출암 · 저조 시 0.9m 노출', '오늘 (10/17)', true, '812', true, 'auto']);
            assert.ok(r2.cls.includes('hazard-rock-popup') && r2.cls.includes('rock-tide-popup'), '해양안전 위험지형 팝업과 같은 모양 클래스');
            assert.equal(r2.struct, 'rtp-header|rtp-daynav|rtp-loading ocean-tide-loading|rtp-body', '해양안전 팝업과 같은 상자 짜임(mountTidePanel)'); assert.ok(r2.card, '아래 조석 카드');
            assert.deepEqual(seen.slice().sort(), ['812:0', '812:1', '812:2'], '같은 바위 id 로 오늘·내일·모레를 받는다');
            assert.ok(r2.left >= 0 && r2.right >= 0 && r2.top >= 0 && r2.bottom >= 0, '360px 화면 안 ' + JSON.stringify(r2));
            await clean(page); await page.screenshot({ path: path.join(SHOT, 'briefing_rocks_popup_360.png') });
            // 다음 날짜 · Esc 는 상자만 · 다른 마커 · ✕ · 창 닫으면 상자도
            const r3 = await page.evaluate(async () => {
                const sleep = (ms) => new Promise((res) => setTimeout(res, ms)), out = {};
                document.querySelector('.sb-rockbox .rtp-next').click(); out.day1 = document.querySelector('.sb-rockbox .rtp-daylabel').textContent;
                document.querySelector('[data-sb-map-popup]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                out.boxAfterEsc = !!document.querySelector('.sb-rockbox'); out.popAfterEsc = !!document.querySelector('[data-sb-map-popup="rocks"]'); out.selAfter = document.querySelector('[data-sb-map-popup="rocks"] .sb-minimap').dataset.sbMapSel || null;
                return out;
            });
            assert.deepEqual(r3, { day1: '내일 (10/18)', boxAfterEsc: false, popAfterEsc: true, selAfter: null }, 'Esc 는 상자만 닫고 지도 창은 남는다 · 마커 고리 지움');
            const pt2 = await page.evaluate(() => { const m = document.querySelector('[data-sb-map-popup="rocks"] .sb-minimap'), H = m._sbMap, f = H.points.getFeatures().find((x) => x.get('row').id === 77), px = H.map.getPixelFromCoordinate(f.getGeometry().getCoordinates()), rc = m.getBoundingClientRect(); return { x: rc.left + px[0], y: rc.top + px[1] }; });
            await page.mouse.click(pt2.x, pt2.y); await page.waitForSelector('.sb-rockbox[data-sb-rockbox="77"]');
            const r4 = await page.evaluate(() => {
                const out = { title: document.querySelector('.sb-rockbox .rtp-title').textContent, n: document.querySelectorAll('.sb-rockbox').length };
                document.querySelector('.sb-rockbox .rtp-close').click(); out.afterX = !!document.querySelector('.sb-rockbox'); out.pop = !!document.querySelector('[data-sb-map-popup="rocks"]');
                return out;
            });
            assert.deepEqual(r4, { title: '간출암 · 저조 시 1.4m 노출', n: 1, afterX: false, pop: true });
            await page.mouse.click(pt.x, pt.y); await page.waitForSelector('.sb-rockbox');
            const r5 = await page.evaluate(() => { document.querySelector('[data-sb-map-close]').click(); return { box: !!document.querySelector('.sb-rockbox'), pop: !!document.querySelector('[data-sb-map-popup]'), blink: window.StationBriefingRender.blinking() }; });
            assert.deepEqual(r5, { box: false, pop: false, blink: 0 }, '창을 닫으면 상자도 닫힌다');
            // 해양안전 「위험지형」 팝업 경로도 같은 함수(mountTidePanel)로 그대로 — ol.Overlay 요소 안에 같은 짜임·제목, 같은 API
            seen.length = 0;
            const r6 = await page.evaluate(async () => {
                const sleep = (ms) => new Promise((res) => setTimeout(res, ms)), host = document.createElement('div'); host.style.cssText = 'position:fixed;left:0;top:0;width:360px;height:600px'; document.body.appendChild(host);
                const ol = window.ol, map = new ol.Map({ target: host, layers: [], view: new ol.View({ center: ol.proj.fromLonLat([126.256, 33.4205]), zoom: 15 }) });
                const el = document.createElement('div'); el.className = 'hazard-rock-popup rock-tide-popup';
                const p = window.HazardRockTidePanel.mount(el, { rockId: 812, v: 0.9, lon: 126.256, lat: 33.4205, onClose: function () {} }); await sleep(300);
                const struct = [...el.children].map((x) => x.className).join('|'), t = el.querySelector('.rtp-title').textContent; p.close(); map.setTarget(null); host.remove();
                return { struct, t };
            });
            assert.deepEqual(r6, { struct: 'rtp-header|rtp-daynav|rtp-loading ocean-tide-loading|rtp-body', t: '간출암 · 저조 시 0.9m 노출' });
            await page.unroute('**/api/hazard-rocks/tide-curve*');
            await page.setViewportSize({ width: 412, height: 915 });
        });
        await check('[§11.10.3] [기준 상세] — 해양사고 위험예보(공단·3시간·단계)·칸 크기·결론에 넣지 않는 이유·「특보 가능성 기준」은 풍랑주의보 기준이 아님·지도 펼침·고립 지점 표', async () => {
            await tap(page, '#station-briefing-content .sb-basis-btn'); await page.waitForSelector('.rf-modal .rf-basis');
            const body = await page.evaluate(() => document.querySelector('.rf-basis-body').innerText);
            for (const k of ['해양사고 위험예보는 한국해양교통안전공단', '칸마다 3시간 간격', '낮음·보통·주의·경계', '약 3.9~4.2km', '혼잡 예보 칸(약 2.3×2.8km)', '같은 3시간 칸에', '선박 몰림', '특보 가능성 기준(유의파고 2m·풍속 12m/s)', '기상청 풍랑주의보 기준이 아닙니다', '풍속 14m/s 이상이 3시간 이상 지속되거나 유의파고가 3m를 초과', '이 기준을 넘을 때만', '깜빡이는 빨간 테두리', '고립', '지점명 | 발생 현황']) assert.ok(body.includes(k), k);
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
        // ── §11.10.20(2026-10-18 사용자 결정 — 시안 Land.dc.html ⑥판, 원문 「좋아. 이대로 반영토록 하자.」 + 같은 날 덧붙임 2~15) ──
        //   실제 자료로 만든 관광지 둘(위험구역 id·종류 = risk_spots.json, 사고 = coast_accidents.json): 모충사(위험구역 3 · 사고 0건 · 항목 하나) · 이호테우해변(해수욕장 · 위험구역 4 · 사고 6건 · 항목 둘)
        const G = (() => {
            const cfg = path.join(__dirname, '..', 'config', 'coastal_safety'), spotsJ = JSON.parse(fs.readFileSync(path.join(cfg, 'risk_spots.json'), 'utf8')), accJ = JSON.parse(fs.readFileSync(path.join(cfg, 'coast_accidents.json'), 'utf8'));
            const HT = ['연안사고 위험구역', '사망사고 발생구역', '연안사고 다발구역'];
            const detailOf = (id, top, rows, notices) => { const p = spotsJ.spots.find((x) => x.id === id), zones = p.hazard.zones.map((z) => ({ id: z.id, class: z['구역분류'] }));
                return { t: at(15), daily: { peakAt: at(15) }, missing: [], ...top, rows: [{ key: 'hazard', count: zones.length, byType: HT.map((c) => ({ class: c, count: zones.filter((z) => z.class === c).length })), zones }].concat(rows), notices, history: { available: true, from: accJ._about.period[0], to: accJ._about.period[1], accidents: accJ.spots[id] || [] } }; };
            const D = { '50110|모충사': detailOf('50110|모충사', { index: 69, band: '높음' }, [{ key: 'people', ratio: 1.6, score: 0.5, missing: false }], []),
                '50110|이호테우해변': detailOf('50110|이호테우해변', { index: 56, band: '다소 높음' }, [{ key: 'people', ratio: 1.2, score: 0.2, missing: false }], [{ key: 'drift', windMs: 11 }]) };
            const L = I.collectLand([{ id: '50110|모충사', name: '모충사', lat: 33.5161, lon: 126.5455, beach: false }, { id: '50110|이호테우해변', name: '이호테우해변', lat: 33.4974, lon: 126.4531, beach: true }], [], { risk: { coastDayDetail: (id) => D[id] }, t: at(8) });
            const g = R.buildBriefing({ ...mapInputs(hallimInput()), zoneWeather: I.collectZoneWeather({ lat: 33.41, lon: 126.26 }, REGIONAL), land: L }, WIN, { generatedAt: '2026-10-17T13:10:00+09:00' });
            // 총평 문단(시안 Main.dc.html 해상 문단 + 「따라서」) — 문장마다 「•」·핵심 구절 굵게·등급 말 색·[권고] 상자를 본다
            g.overview = { source: 'chatgpt', model: 'x', land: '모충사는 방문객이 평소의 1.6배로 예상돼 주의 수준입니다. 위험구역 기록이 있습니다. 이호테우해변은 관심 수준입니다. 따라서 모충사에는 주의가, 이호테우해변에는 관심이 요구됩니다.',
                sea: "경북북부앞바다(75해구)는 유의파고 0.8m·풍속 4.8m/s로 잔잔한 바다일 것으로 예상됩니다. 다만, 기상청 전망에 따르면 오늘 밤부터 동해상에 바람이 강하게 불고 물결이 높아질 수 있어 상황 변화에 유의해야 합니다. 해양사고 위험예보(KOMSA 기준)만 '주의'인 해역이 있지만, 위험이 높아진 해역은 없는 것으로 나타났습니다. 따라서 한림파출소 관할 해역 운항에는 주의가 요구됩니다." };
            return g;
        })();
        const L20 = await device({ admin: true, width: 360, height: 780 }); await pickStation(L20, HALLIM); await openAcc(L20);
        /** G 를 새 상자에 그린다(실제 index2 CSS 아래 — 아코디언 본문 안). */
        const draw20 = (bb, extra) => L20.evaluate(({ bb, now, extra }) => { const R = window.StationBriefingRender, c = document.getElementById('station-briefing-content'); c.textContent = ''; const box = document.createElement('div'); box.className = 'sb-wrap'; box.id = 'sb20'; c.appendChild(box);
            R.render(box, { ok: true, briefing: bb, now: extra || null }, { now, onLink: () => {} }); box.querySelectorAll('.sb-sec:not(.open)').forEach((x) => x.classList.add('open')); box.querySelectorAll('[role="tabpanel"][hidden]').forEach((x) => { x.hidden = false; }); }, { bb, now: clock.now, extra });   // 단계 묶음 숨김도 풀어 두 카드를 함께 잰다
        await check('[§11.10.20-UI1] 연안 카드(모충사형·이호테우형, 360px) — 줄 순서 배지 → [위험구역] 「N개소」 → [사고현황(\'20~\'24년)] 「총 N건」 → 한 줄 → (많이 기록) → [오늘 예상](하나면 점 없음) → [권고] 상자 → 오른쪽 「위험예측에서 보기 ›」 · 배지 색 · 「총 0건」 글자·「총 6건」 링크 → 표 · 「물가 접근」 없음 · 넘침 없음', async () => {
            await draw20(G);
            const r = await L20.evaluate(() => {
                const box = document.getElementById('sb20'), cards = [...box.querySelectorAll('[data-sb-card="land"]')], card = (n) => cards.find((c) => c.querySelector('.sb-card-name').textContent === n);
                const kids = (c) => [...c.children].map((e) => e.classList.contains('sb-card-head') ? 'head' : e.classList.contains('sb-landbs') ? 'badges' : e.classList.contains('sb-adv') ? 'advice' : e.classList.contains('sb-row') ? 'row:' + e.querySelector('.sb-row-k').textContent : e.classList.contains('sb-x-panel') ? 'panel' : e.hasAttribute('data-sb-acc-line') ? 'line' : e.classList.contains('sb-link') ? 'link' : e.className);
                const one = (c) => { const adv = c.querySelector('.sb-adv'), k = adv.querySelector('.sb-advk'), v = adv.querySelector('.sb-adv-v'), cs = getComputedStyle(adv), today = [...c.querySelectorAll('.sb-row')].find((x) => x.querySelector('.sb-row-k').textContent === '[오늘 예상]');
                    const tot = [...c.querySelectorAll('.sb-row')].find((x) => /^\[사고현황/.test(x.querySelector('.sb-row-k').textContent)), lk = c.querySelector('.sb-link'), cr = c.getBoundingClientRect();
                    const rg = document.createRange(); rg.selectNodeContents(v); const lines = []; [...rg.getClientRects()].filter((q) => q.width > 0.5).forEach((q) => { const l = lines.find((x) => Math.abs(x.top - q.top) < 3); if (l) l.left = Math.min(l.left, q.left); else lines.push({ top: q.top, left: q.left }); });
                    return { kids: kids(c), badges: [...c.querySelectorAll('.sb-landbs .sb-srcb')].map((x) => x.textContent + '|' + getComputedStyle(x).color), today: today && { ul: !!today.querySelector('ul'), text: today.children[1].textContent },
                        total: tot && { tag: tot.children[1].tagName, text: tot.children[1].textContent, exp: tot.children[1].getAttribute('aria-expanded') }, line: (c.querySelector('[data-sb-acc-line]') || {}).textContent, note: [...c.querySelectorAll(':scope > .sb-sentence')].map((x) => x.textContent),
                        adv: { text: adv.textContent, bg: cs.backgroundColor, border: cs.borderTopColor, radius: cs.borderTopLeftRadius, k: getComputedStyle(k).color, kShrink: getComputedStyle(k).flexShrink, v: getComputedStyle(v).color, w: getComputedStyle(v).fontWeight, lvs: [...v.querySelectorAll('.sb-hl-lv')].map((x) => x.textContent + '|' + getComputedStyle(x).color), lefts: lines.map((x) => Math.round(x.left)), vLeft: Math.round(v.getBoundingClientRect().left), fs: getComputedStyle(adv).fontSize, rowFs: getComputedStyle(tot).fontSize },
                        linkRight: lk ? Math.round(cr.right - lk.getBoundingClientRect().right) : null, linkLeft: lk ? Math.round(lk.getBoundingClientRect().left - cr.left) : null, overflow: c.scrollWidth - c.clientWidth };
                };
                const out = { m: one(card('모충사')), i: one(card('이호테우해변')), text: box.textContent, page: document.documentElement.scrollWidth, vw: innerWidth };
                // 이호테우 「총 6건」 → 표 열고 닫기
                const ib = [...card('이호테우해변').querySelectorAll('button[data-sb-x="land-acc"]')][0]; ib.click(); const pn = document.getElementById(ib.getAttribute('aria-controls'));
                out.accTable = { exp: ib.getAttribute('aria-expanded'), title: (pn.querySelector('.sb-wxbox-t') || {}).textContent, head: [...pn.querySelectorAll('thead th')].map((x) => x.textContent), rows: [...pn.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((x) => x.textContent).join('|')), over: pn.scrollWidth - pn.clientWidth };
                ib.click(); out.accClosed = [ib.getAttribute('aria-expanded'), pn.hidden];
                ib.click(); return out;
            });
            assert.deepEqual(r.m.kids, ['head', 'badges', 'row:[위험구역]', 'panel', "row:[사고현황('20~'24년)]", 'line', 'row:[오늘 예상]', 'advice', 'link'], '모충사 줄 순서(사고 0건 → 한 줄 「많이 기록」 없음)');
            assert.deepEqual(r.i.kids, ['head', 'badges', 'row:[위험구역]', 'panel', "row:[사고현황('20~'24년)]", 'line', 'panel', 'sb-sentence', 'row:[오늘 예상]', 'advice', 'link'], '이호테우 줄 순서(표 → 「이곳에서는 … 많이 기록」)');
            assert.deepEqual(r.m.badges, ["연안 위험지수 69 '높음'|rgb(251, 146, 60)"], '배지 글자 = 띠 색(높음 주황) · 해수욕장 아님');
            assert.deepEqual(r.i.badges, ["연안 위험지수 56 '다소 높음'|rgb(242, 194, 48)", '해수욕장|rgb(203, 213, 225)'], '다소 높음 노랑 + 「해수욕장」 배지([특성] 끝에서 옮김)');
            assert.deepEqual(r.m.today, { ul: false, text: '사람 평소의 1.6배' }, '항목 하나면 점 없이');
            assert.deepEqual([r.i.today.ul, r.i.today.text], [true, '사람 평소의 1.2배해안 바람 11m/s(튜브·물놀이기구 표류 주의)'], '둘 이상이면 「•」 목록');
            assert.deepEqual(r.m.total, { tag: 'B', text: '총 0건', exp: null }, '0건이면 링크 아닌 굵은 글자'); assert.equal(r.m.line, '기록된 연안사고 없음'); assert.deepEqual(r.m.note, []);
            assert.deepEqual(r.i.total, { tag: 'BUTTON', text: '총 6건', exp: 'false' }, 'N>0 이면 링크(처음 닫힘)'); assert.equal(r.i.line, '익수 3건, 표류 2건, 추락 1건 | 인명피해 사망 2명, 실종 0명');
            assert.deepEqual(r.i.note, ['이곳에서는 집계 기간 중 익수 사고가 많이 기록되었습니다.']);
            assert.deepEqual(r.accTable, { exp: 'true', title: '연안사고 발생 현황', head: ['연도', '사고 종류', '건수'], rows: ['2020년|익수|2건', '2020년|추락|1건', '2020년|표류|1건', '2021년|익수|1건', '2024년|표류|1건'], over: 0 });
            assert.deepEqual(r.accClosed, ['false', true], '다시 누르면 닫힘');
            assert.equal(r.m.adv.text, '[권고]방문객이 평소보다 많을 것으로 예상되어 연안 활동 시 주의가 요구됩니다.');
            assert.equal(r.i.adv.text, '[권고]방문객이 늘고 바람이 강해 튜브·물놀이기구가 표류할 수 있으므로, 연안 활동 시 관심이 요구됩니다.');
            for (const c of [r.m, r.i]) {
                assert.deepEqual([c.adv.bg, c.adv.border, c.adv.radius, c.adv.k, c.adv.kShrink, c.adv.v, c.adv.w], ['rgba(255, 200, 60, 0.1)', 'rgba(255, 200, 60, 0.38)', '10px', 'rgb(255, 215, 94)', '0', 'rgb(255, 255, 255)', '800'], '[권고] 상자(덧붙임 9) — 머리 노랑·본문 흰색 굵게');
                assert.equal(c.adv.fs, c.adv.rowFs, '글자 크기는 카드 줄 그대로'); assert.ok(c.adv.lefts.every((x) => Math.abs(x - c.adv.vLeft) <= 1), '둘째 줄 = 본문 첫 글자 위치 ' + JSON.stringify(c.adv));
                assert.ok(c.linkRight <= 13 && c.linkLeft > 60, '「위험예측에서 보기 ›」 오른쪽 끝(덧붙임 13) ' + c.linkRight + '/' + c.linkLeft); assert.equal(c.overflow, 0);
            }
            assert.ok(r.i.adv.lefts.length >= 2, '이호테우 [권고]는 360px 에서 두 줄 이상(들여쓰기를 잴 수 있음)');
            assert.deepEqual([r.m.adv.lvs, r.i.adv.lvs], [['주의|rgb(251, 146, 60)'], ['관심|rgb(242, 194, 48)']], '[권고] 속 등급 말 = 등급 색');
            assert.ok(!r.text.includes('물가 접근') && !r.text.includes('[특성]'), '「물가 접근」·[특성] 없음');
            assert.ok(r.page <= r.vw + 1, '360px 가로 넘침 없음 ' + r.page);
            for (const [n, f] of [['모충사', 'land_mochungsa_360.png'], ['이호테우해변', 'land_ihotaewoo_360.png']]) {
                const loc = L20.locator('#sb20 [data-sb-card="land"]', { hasText: n }); await loc.scrollIntoViewIfNeeded(); await clean(L20); await loc.screenshot({ path: path.join(SHOT, f) });
            }
        });
        await check('[§11.10.20-UI2] [위험구역] 「3개소」 → 표 「구역 종류 | 개소 수 | [위치 보기]」 → 그 줄 아래 지도(GET /api/risk-forecast/hazard-zones?ids= — 그 종류 폴리곤 전부 깜빡임 + 관광지 점) · 다시 누르면 닫히고 깜빡임 멈춤 · 움직임 줄이기면 깜빡임 없음 · 자료 없는 id 는 안내', async () => {
            hzReq.length = 0;
            const open = await L20.evaluate(() => { const c = [...document.querySelectorAll('#sb20 [data-sb-card="land"]')].find((x) => x.querySelector('.sb-card-name').textContent === '모충사'), b = c.querySelector('button[data-sb-x="land-hazard"]');
                const o = { link: b.textContent, exp0: b.getAttribute('aria-expanded'), w: getComputedStyle(b).fontWeight }; b.click(); const pn = document.getElementById(b.getAttribute('aria-controls'));
                o.title = pn.querySelector('.sb-wxbox-t').textContent; o.head = [...pn.querySelectorAll('thead th')].map((x) => x.textContent); o.rows = [...pn.querySelectorAll('tbody tr[data-sb-hz-row]')].map((tr) => [...tr.children].map((x) => x.textContent).join('|'));
                o.mapRows = [...pn.querySelectorAll('tr.sb-hz-maprow')].map((x) => x.hidden); pn.querySelector('button[data-sb-x="land-hazard-map"]').click(); o.mapRows2 = [...pn.querySelectorAll('tr.sb-hz-maprow')].map((x) => x.hidden); return o; });
            assert.deepEqual([open.link, open.exp0, open.w], ['3개소', 'false', '800']);
            assert.deepEqual([open.title, open.head, open.rows], ['위험구역', ['구역 종류', '개소 수', ''], ['연안사고 위험구역|1개소|위치 보기', '사망사고 발생구역|1개소|위치 보기', '연안사고 다발구역|1개소|위치 보기']], '표 칸 따옴표 없음');
            assert.deepEqual([open.mapRows, open.mapRows2], [[true, true, true], [false, true, true]], '누른 줄 바로 아래만 펼침');
            await L20.waitForSelector('#sb20 [data-sb-x-panel="land-hazard-map"] .sb-minimap[data-sb-map="ol"]');
            await L20.waitForTimeout(700);
            const m = await L20.evaluate(() => { const mm = document.querySelector('#sb20 [data-sb-x-panel="land-hazard-map"] .sb-minimap'), r = mm.getBoundingClientRect(); return { hl: mm.dataset.sbMapHl, area: mm.dataset.sbMapArea, spot: mm.dataset.sbMapSpot, blink: mm.dataset.sbBlink, phase: mm.dataset.sbBlinkPhase || null, h: Math.round(r.height), cap: mm.parentElement.querySelector('.sb-minimap-cap').textContent, n: window.StationBriefingRender.blinking(), page: document.documentElement.scrollWidth, vw: innerWidth }; });
            assert.deepEqual(hzReq, ['제주-2'], '그 종류 id 로 받는다(연안사고 위험구역 = 제주-2)');
            assert.deepEqual([m.hl, m.area, m.spot, m.blink, m.n], ['1', '0', '1', 'on', 1], '폴리곤 1 · 관할 선 없음 · 관광지 점 · 깜빡임 ' + JSON.stringify(m));
            assert.ok(m.h >= 190 && m.h <= 210 && m.cap === '빨간 테두리(깜빡임) = 연안사고 위험구역 1개소 · 흰 점 = 모충사' && m.page <= m.vw + 1, JSON.stringify(m));
            await L20.evaluate(() => document.querySelector('#sb20 [data-sb-x-panel="land-hazard-map"] .sb-minimap').scrollIntoView({ block: 'center' })); await clean(L20);
            await L20.locator('#sb20 [data-sb-card="land"]', { hasText: '모충사' }).screenshot({ path: path.join(SHOT, 'land_hazard_map_360.png') });
            const closed = await L20.evaluate(() => { const b = document.querySelector('#sb20 button[data-sb-x="land-hazard-map"]'); b.click(); return { row: b.closest('tbody').querySelector('tr.sb-hz-maprow').hidden, n: window.StationBriefingRender.blinking() }; });
            assert.deepEqual(closed, { row: true, n: 0 }, '닫으면 지도 줄 숨김·깜빡임 멈춤');
            // 이호테우 연안사고 위험구역 2개소 = 폴리곤 2(다수 함께) · 움직임 줄이기 → static
            await L20.emulateMedia({ reducedMotion: 'reduce' }); hzReq.length = 0;
            await L20.evaluate(() => { const c = [...document.querySelectorAll('#sb20 [data-sb-card="land"]')].find((x) => x.querySelector('.sb-card-name').textContent === '이호테우해변'); c.querySelector('button[data-sb-x="land-hazard"]').click(); c.querySelector('button[data-sb-x="land-hazard-map"]').click(); });
            await L20.waitForFunction(() => [...document.querySelectorAll('#sb20 .sb-minimap[data-sb-map="ol"]')].some((x) => x.dataset.sbMapHl === '2'));
            const st = await L20.evaluate(() => { const mm = [...document.querySelectorAll('#sb20 .sb-minimap[data-sb-map="ol"]')].find((x) => x.dataset.sbMapHl === '2'); return { blink: mm.dataset.sbBlink, n: window.StationBriefingRender.blinking() }; });
            assert.deepEqual([hzReq, st], [['제주-12,제주-15'], { blink: 'static', n: 0 }], '같은 종류 여럿 함께 · 움직임 줄이기면 깜빡임 없음');
            await L20.emulateMedia({ reducedMotion: 'no-preference' });
            // 자료 없는 id — 조용히 비우지 않고 안내
            const bad = JSON.parse(JSON.stringify(G)); bad.land.cards[0].hazardTable.rows[0].ids = ['없는구역-1']; await draw20(bad);
            await L20.evaluate(() => { const c = document.querySelector('#sb20 [data-sb-card="land"]'); c.querySelector('button[data-sb-x="land-hazard"]').click(); c.querySelector('button[data-sb-x="land-hazard-map"]').click(); });
            await L20.waitForFunction(() => /위험구역 위치 자료가 없습니다/.test((document.querySelector('#sb20 [data-sb-zone-wait]') || {}).textContent || ''));
        });
        await check('[§11.10.20-UI3] 맨 아래 — 「기준 시각」·「다루는 시간」 줄 없음 · 「데이터 출처 보기」 없음(2026-10-18 삭제 — 출처는 [기준 상세]) · 노란 안내 한 문장(br 없음 · 어절 단위 줄바꿈 keep-all) 「각종 정보(API, 기상정보 등) 기반 AI 분석 결과로, 실제 현장상황과 다를 수 있습니다.」 · 옛 판(b.notice 옛 글)도 새 안내 · 360px 넘침 없음', async () => {
            const old = JSON.parse(JSON.stringify(G)); old.notice = '참고 정보이며 안전을 보장하지 않습니다.'; await draw20(old);
            const r = await L20.evaluate(() => { const f = document.querySelector('#sb20 .sb-foot'), nt = f.querySelector('[data-sb-notice]'), o = { src: document.querySelectorAll('#sb20 button[data-sb-x="sources"], #sb20 [data-sb-sources], #sb20 .sb-src-tbl').length, kids: [...f.children].map((x) => x.className), noteBr: nt.querySelectorAll('br').length, note: nt.querySelector('.sb-notice-t').textContent, wb: getComputedStyle(nt).wordBreak, color: getComputedStyle(nt).color, w: getComputedStyle(nt).fontWeight, text: f.textContent,
                    kids2: [...nt.children].map((x) => [x.className, x.className === 'sb-notice-k' ? x.textContent + '|' + x.getAttribute('aria-hidden') : '']), fs: parseFloat(getComputedStyle(nt).fontSize), lh: parseFloat(getComputedStyle(nt).lineHeight) };
                const tx = nt.querySelector('.sb-notice-t'), kL = nt.querySelector('.sb-notice-k').getBoundingClientRect().left, rt = document.createRange(); rt.selectNodeContents(tx);
                o.lefts = [...new Set([...rt.getClientRects()].filter((q) => q.width > 0.5).map((q) => Math.round(q.left)))]; o.tL = Math.round(tx.getBoundingClientRect().left); o.kL = Math.round(kL);
                const rg = document.createRange(); rg.selectNodeContents(nt); o.lines = new Set([...rg.getClientRects()].map((x) => Math.round(x.top))).size; o.over = f.scrollWidth - f.clientWidth; o.page = document.documentElement.scrollWidth; o.vw = innerWidth; return o; });
            assert.deepEqual([r.src, r.kids], [0, ['sb-notice']], '출처 버튼·표 없음 → 안내만');
            assert.deepEqual([r.noteBr, r.note, r.wb, r.color, r.w], [0, '각종 정보(API, 기상정보 등) 기반 AI 분석 결과로, 실제 현장상황과 다를 수 있습니다.', 'keep-all', 'rgb(255, 210, 63)', '400'], '노란 안내 한 문장(옛 판 b.notice 대신) · §11.10.28 굵게 뺌');
            // §11.10.28 *"텍스트 크기 3포인트정도 크게 … 볼드는 빼고 텍스트 맨앞에 당구장 표시 처럼"* · *"줄간격을 좀 더 좁혀줘 지금의 1/2정도로"* — 약 16.5px · 줄높이 약 21px · 「※」 칸 + 글 칸(둘째 줄도 ※ 뒤 글자 시작)
            assert.deepEqual(r.kids2, [['sb-notice-k', '※|true'], ['sb-notice-t', '']], '「※」 칸 + 글 칸');
            assert.ok(Math.abs(r.fs - 16.5) < 0.3 && Math.abs(r.lh - 21) < 0.5, '글자 약 16.5px·줄높이 약 21px ' + r.fs + '/' + r.lh);
            assert.ok(r.lines >= 2 && r.tL > r.kL && r.lefts.length === 1 && r.lefts[0] === r.tL, '줄마다 글 칸 시작(※ 오른쪽) ' + JSON.stringify([r.kL, r.tL, r.lefts]));
            assert.ok(!/기준 시각|다루는 시간|참고 정보이며|출처:|데이터 출처 보기/.test(r.text), r.text);
            assert.equal(r.over, 0); assert.ok(r.page <= r.vw + 1); console.log('    안내 줄 수(360px):', r.lines);
            await L20.evaluate(() => document.querySelector('#sb20 .sb-foot').scrollIntoView({ block: 'center' })); await clean(L20);
            await L20.locator('#sb20 .sb-foot').screenshot({ path: path.join(SHOT, 'land_sources_360.png') });
        });
        await check('[§11.10.20-UI4] 총평 덧붙임 — 분석 문단 이름표 자기 줄·문장마다 「•」 · 핵심 구절 굵게(바다 상태·전망 위험 구절·「위험이 높아진 해역은 없는」) · 「\'주의\'」 주황 굵게 · [권고] 상자(머리 「[권고]」 노랑·본문 흰색·등급 말 색·두 칸 — 둘째 줄 본문 첫 글자) · 「물때」 괄호 없음 · 근거 「이름 — 내용」 두 칸 · 「(근거)」 제목 없음 · 선박 상자 두 줄 「•」/한 줄 점 없음 · 글 링크 단추 text-align left', async () => {
            await draw20(G, { text: '10:00 기준 관할 해역 선박 37척 · 선박이 있는 해역 격자 12개\n한림항 북서방 1.2해리 해역(232-2해구) 18척 — 충돌·접촉 주의', count: 37, cells: [{ id: 'GR4_A', box: [126.2, 33.4, 126.225, 33.425], count: 18 }], busiest: { name: '한림항 북서방 1.2해리 해역(232-2해구)', count: 18, id: 'GR4_A' } });
            const r = await L20.evaluate(() => {
                const box = document.getElementById('sb20'), sea = box.querySelector('[data-sb-analysis="sea"]'), lis = [...sea.querySelectorAll('li')], tag = sea.querySelector('.sb-an-tag');
                const adv = box.querySelector('[data-sb-summary="land"] > [data-sb-advice]'), k = adv.querySelector('.sb-advk'), v = adv.querySelector('.sb-adv-v'), cs = getComputedStyle(adv);
                const rg = document.createRange(); rg.selectNodeContents(v); const lines = []; [...rg.getClientRects()].filter((q) => q.width > 0.5).forEach((q) => { const l = lines.find((x) => Math.abs(x.top - q.top) < 3); if (l) l.left = Math.min(l.left, q.left); else lines.push({ top: q.top, left: q.left }); });
                const xb = box.querySelector('button[data-sb-x="basis-land"]'); xb.click(); const pn = document.getElementById(xb.getAttribute('aria-controls'));
                const kv = [...pn.querySelectorAll('.sb-basis-kv')].map((x) => { const vv = x.querySelector('.sb-basis-v'), r2 = document.createRange(); r2.selectNodeContents(vv); const ls = []; [...r2.getClientRects()].filter((q) => q.width > 0.5).forEach((q) => { const l = ls.find((y) => Math.abs(y.top - q.top) < 3); if (l) l.left = Math.min(l.left, q.left); else ls.push({ top: q.top, left: q.left }); });
                    return { k: x.querySelector('.sb-basis-k').textContent, shrink: getComputedStyle(x.querySelector('.sb-basis-k')).flexShrink, lefts: ls.map((y) => Math.round(y.left)), vLeft: Math.round(vv.getBoundingClientRect().left) }; });
                const now = box.querySelector('[data-sb-now]');
                const btns = [...box.querySelectorAll('button.sb-x-btn, button.sb-maplink')].filter((b) => !b.classList.contains('sb-x-pill') && !b.classList.contains('sb-hz-loc'));
                return { tagAbove: tag.getBoundingClientRect().bottom <= lis[0].getBoundingClientRect().top + 1, li: lis.length, bullet: getComputedStyle(lis[0]).listStyleType, liText: lis.map((x) => x.textContent.trim()),
                    bold: [...sea.querySelectorAll('.sb-hl-b')].map((x) => x.textContent), lv: [...sea.querySelectorAll('.sb-hl-lv')].map((x) => x.textContent + '|' + getComputedStyle(x).color + '|' + getComputedStyle(x).fontWeight),
                    adv: { text: adv.textContent, disp: cs.display, gap: cs.columnGap, pad: cs.padding, radius: cs.borderTopLeftRadius, bg: cs.backgroundColor, border: cs.borderTopColor, k: getComputedStyle(k).color, kw: getComputedStyle(k).fontWeight, shrink: getComputedStyle(k).flexShrink, v: getComputedStyle(v).color, vmin: getComputedStyle(v).minWidth, lv: [...v.querySelectorAll('.sb-hl-lv')].map((x) => x.textContent + '|' + getComputedStyle(x).color), lefts: lines.map((x) => Math.round(x.left)), vLeft: Math.round(v.getBoundingClientRect().left) },
                    tideHead: (box.querySelector('[data-sb-part="tide"] > .sb-sum-k') || {}).textContent, basisK: [...pn.querySelectorAll('.sb-sum-k')].map((x) => x.textContent), kv,
                    now: { ul: !!now.querySelector('ul.sb-now-list'), li: now.querySelectorAll('li').length, color: getComputedStyle(now.querySelector('li')).color, links: [...now.querySelectorAll('[data-sb-maplink]')].map((x) => x.textContent) },
                    align: [...new Set(btns.map((b) => getComputedStyle(b).textAlign))], nBtn: btns.length, page: document.documentElement.scrollWidth, vw: innerWidth };
            });
            assert.ok(r.tagAbove && r.li === 3 && r.bullet === 'disc', '이름표 자기 줄 + 「•」 세 줄(마지막 「따라서」는 [권고]) ' + JSON.stringify(r.liText));
            assert.deepEqual(r.bold, ['유의파고 0.8m·풍속 4.8m/s로 잔잔한 바다', '오늘 밤부터 동해상에 바람이 강하게 불고 물결이 높아질 수 있어', '위험이 높아진 해역은 없는'], '핵심 구절 굵게(덧붙임 4)');
            assert.deepEqual(r.lv, ["'주의'|rgb(251, 146, 60)|800"], "「'주의'」 주황 굵게(덧붙임 5)");
            assert.equal(r.adv.text, '[권고] 모충사에는 주의가, 이호테우해변에는 관심이 요구됩니다.');
            assert.deepEqual([r.adv.disp, r.adv.gap, r.adv.pad, r.adv.radius, r.adv.bg, r.adv.border, r.adv.k, r.adv.kw, r.adv.shrink, r.adv.v, r.adv.vmin], ['flex', '4px', '10px 12px', '12px', 'rgba(255, 200, 60, 0.1)', 'rgba(255, 200, 60, 0.38)', 'rgb(255, 215, 94)', '800', '0', 'rgb(255, 255, 255)', '0px'], '[권고] 상자(덧붙임 6·7·8·11)');
            assert.deepEqual(r.adv.lv, ['주의|rgb(251, 146, 60)', '관심|rgb(242, 194, 48)'], '[권고] 속 등급 말 색');
            assert.ok(r.adv.lefts.length >= 2 && r.adv.lefts.every((x) => Math.abs(x - r.adv.vLeft) <= 1), '둘째 줄 = 본문 첫 글자(「모」) 위치 ' + JSON.stringify(r.adv));
            assert.equal(r.tideHead, '물때', '덧붙임 10 — 괄호 없음'); assert.deepEqual(r.basisK, [], '「(근거)」 제목 줄 없음(덧붙임 2)');
            assert.ok(r.kv.length >= 2 && r.kv.every((x) => x.shrink === '0' && x.lefts.every((l) => Math.abs(l - x.vLeft) <= 1)) && r.kv.some((x) => x.lefts.length >= 2), '근거 「이름 — 내용」 두 칸(덧붙임 12) ' + JSON.stringify(r.kv));
            assert.deepEqual([r.now.ul, r.now.li, r.now.color, r.now.links], [true, 2, 'rgb(165, 243, 252)', ['관할 해역 선박 37척', '한림항 북서방 1.2해리 해역(232-2해구)']], '선박 상자 두 줄 → 「•」(덧붙임 14), 하늘색·링크 그대로');
            assert.ok(r.nBtn >= 4 && r.align.length === 1 && r.align[0] === 'left', '글 링크 단추 text-align left(덧붙임 15) ' + JSON.stringify(r.align)); assert.ok(r.page <= r.vw + 1);
            await L20.evaluate(() => document.querySelector('#sb20 [data-sb-summary="sea"]').scrollIntoView({ block: 'start' })); await clean(L20);
            await L20.locator('#sb20 [data-sb-sec="overview"]').screenshot({ path: path.join(SHOT, 'summary_overview_360.png') });
            // 선박 상자 한 줄이면 점 없음
            await draw20(G, { text: '10:00 기준 관할 해역 선박 3척 · 선박이 있는 해역 격자 2개', count: 3, cells: [], busiest: null });
            assert.deepEqual(await L20.evaluate(() => { const n = document.querySelector('#sb20 [data-sb-now]'); return [n.querySelectorAll('ul, li').length, n.textContent]; }), [0, '10:00 기준 관할 해역 선박 3척 · 선박이 있는 해역 격자 2개'], '단독이면 점 없음');
        });
        await check('[§11.10.20-UI6] 덧붙임 17·19·20·21·22·23·24 — 근거 「이름 —」 흰 굵게·수치·등급 = 관광지 단계 색·예비특보 노랑 · 해역 [기상 예보] 수치·바다 상태 말 흰 굵게 · 배지 상세 표 등급 칸·혼잡지수 칸 단계 색 굵게 · 표 머리 칸 흰 굵게 · 결론 「"주의"」 단계 색 · 긴 괄호 묶음은 통째로 다음 줄(360px)', async () => {
            const g2 = JSON.parse(JSON.stringify(G)); g2.summary.land.basis.push('풍랑주의보 예비특보(10월 18일 06~12시 발효 예정)');
            g2.land.cards.push({ ...JSON.parse(JSON.stringify(g2.land.cards[0])), name: '옛판관광지', advice: undefined, accidents: undefined, indexBadge: undefined, hazardTable: undefined, sourceLabel: "연안 위험지수 69 '높음'", traits: { text: '위험구역 3곳(연안사고 위험구역 1·사망사고 발생구역 1·연안사고 다발구역 1)' }, sentence: '옛 문장' });
            g2.sea.cards[0].historyNote = '이 해역에서는 집계 기간 중 충돌·전복 사고가 많이 기록되었습니다.';   // 유형 둘(덧붙임 25 보충)
            assert.ok(B.h.summary.isolation.text.startsWith('[고립 주의] '), '서버 글 머리 「[고립 주의]」(덧붙임 29) ' + B.h.summary.isolation.text);
            g2.summary.isolation = { ...JSON.parse(JSON.stringify(B.h.summary.isolation)), text: B.h.summary.isolation.text.replace('[고립 주의]', '(고립 주의)') };   // 옛 판 글 — 화면이 같은 꼴로
            await draw20(g2);
            const r = await L20.evaluate(() => {
                const box = document.getElementById('sb20'), out = {};
                out.head = [...box.querySelectorAll('.sb-conclusion .sb-headline .sb-hl-lv')].map((x) => x.textContent + '|' + getComputedStyle(x).color + '|' + getComputedStyle(x).fontWeight);
                const xb = box.querySelector('button[data-sb-x="basis-land"]'); xb.click(); const pn = document.getElementById(xb.getAttribute('aria-controls'));
                out.kv = [...pn.querySelectorAll('.sb-basis-kv')].map((x) => ({ k: x.querySelector('.sb-basis-k').textContent, kc: getComputedStyle(x.querySelector('.sb-basis-k')).color, kw: getComputedStyle(x.querySelector('.sb-basis-k')).fontWeight, v: [...x.querySelectorAll('.sb-bv')].map((b) => b.textContent + '|' + getComputedStyle(b).color) }));
                out.warnLine = [...pn.querySelectorAll('li > .sb-bv')].map((b) => b.textContent + '|' + getComputedStyle(b).color);
                const rz = pn.querySelector('button[data-sb-x="raised"]'); if (rz) rz.click();
                box.querySelectorAll('button[data-sb-x="land-acc"], button[data-sb-x="land-hazard"]').forEach((b) => b.click());
                const sea = [...box.querySelectorAll('[data-sb-card="sea"]')];
                out.fv = sea.flatMap((c) => [...c.querySelectorAll('.sb-fv')].map((b) => b.textContent + '|' + getComputedStyle(b).color + '|' + getComputedStyle(b).fontWeight));
                out.fvText = sea.map((c) => { const rw = [...c.querySelectorAll('.sb-row')].find((x) => x.querySelector('.sb-row-k').textContent === '[기상 예보]'); return rw ? rw.children[1].textContent : null; }).filter(Boolean);
                out.grade = [...box.querySelectorAll('[data-sb-card="sea"] .sb-srcb-tbl td[data-rank]')].map((td) => td.closest('.sb-srcb-tab').querySelector('.sb-srcb-dt').textContent + '|' + td.textContent + '|' + td.dataset.rank + '|' + getComputedStyle(td).color + '|' + getComputedStyle(td).fontWeight);
                out.th = [...new Set([...box.querySelectorAll('th')].filter((x) => x.offsetParent).map((x) => getComputedStyle(x).color + '|' + getComputedStyle(x).fontWeight))]; out.thN = [...box.querySelectorAll('th')].filter((x) => x.offsetParent).length;
                const oc = [...box.querySelectorAll('[data-sb-card="land"]')].find((c) => c.querySelector('.sb-card-name').textContent === '옛판관광지'), tr = [...oc.querySelectorAll('.sb-row')].find((x) => x.querySelector('.sb-row-k').textContent === '[특성]'), pr = tr.querySelector('.sb-paren'), vv = tr.children[1];
                const first = document.createRange(); first.setStart(vv.firstChild, 0); first.setEnd(vv.firstChild, 1);
                out.paren = { text: pr.textContent, disp: getComputedStyle(pr).display, left: Math.round(pr.getBoundingClientRect().left), vLeft: Math.round(vv.getBoundingClientRect().left), below: pr.getBoundingClientRect().top > first.getBoundingClientRect().top + 2 };
                out.notes = [...box.querySelectorAll('[data-sb-card] > .sb-sentence')].filter((x) => x.querySelector('.sb-acc-type')).map((x) => [...x.querySelectorAll('.sb-acc-type')].map((b) => b.textContent + '|' + getComputedStyle(b).color + '|' + getComputedStyle(b).fontWeight).join(' / ') + ' :: ' + x.textContent);
                // 덧붙임 26·27·28·29 — [사고현황] 「유형 N건」 흰·사망 빨강·실종 주황(0명도) · [오늘 예상] 수치 흰 · [고립 주의]
                out.acc = [...box.querySelectorAll('[data-sb-card] .sb-acc-n, [data-sb-card] .sb-acc-death, [data-sb-card] .sb-acc-missing')].map((b) => b.textContent + '|' + getComputedStyle(b).color + '|' + getComputedStyle(b).fontWeight);
                out.num = [...box.querySelectorAll('[data-sb-card="land"] .sb-row')].filter((x) => x.querySelector('.sb-row-k').textContent === '[오늘 예상]').flatMap((x) => [...x.querySelectorAll('b.sb-hl-b')].map((b) => b.textContent + '|' + getComputedStyle(b).color));
                out.iso = (box.querySelector('[data-sb-isolation] .sb-iso-line') || {}).textContent || null;
                out.page = document.documentElement.scrollWidth; out.vw = innerWidth;
                return out;
            });
            assert.deepEqual(r.head, ['"주의"|rgb(251, 146, 60)|800', '"주의"|rgb(251, 146, 60)|800'], '결론 단계 말 = 단계 색 굵게(덧붙임 23) — 연안·해상');
            const mo = r.kv.find((x) => x.k === '모충사 — '), ih = r.kv.find((x) => x.k === '이호테우해변 — ');
            assert.ok(mo && ih && mo.kc === 'rgb(255, 255, 255)' && mo.kw === '800', '지명 흰 굵게(덧붙임 17) ' + JSON.stringify(r.kv));
            assert.deepEqual(mo.v, ['69(높음, 예상)|rgb(251, 146, 60)', '1.6배|rgb(251, 146, 60)'], '모충사(주의) 수치·등급 = 주황');
            assert.deepEqual(ih.v, ['56(다소 높음, 예상)|rgb(242, 194, 48)', '1.2배|rgb(242, 194, 48)', '11m/s|rgb(242, 194, 48)'], '이호테우(관심) = 노랑');
            assert.deepEqual(r.warnLine, ['풍랑주의보 예비특보|rgb(242, 194, 48)'], '공통 예비특보 줄 — 특보 이름만 노랑');
            assert.ok(r.fv.some((x) => /^유의파고 [\d.]+m·풍속 [\d.]+m\/s\|rgb\(248, 250, 252\)\|800$/.test(x)) && r.fv.some((x) => /^물결이 높아지고 바람이 매우 강해질\|rgb\(248, 250, 252\)\|800$/.test(x)) && r.fv.some((x) => /^잔잔하다가\|/.test(x)), '해역 [기상 예보] 수치·바다 상태 말 흰 굵게(덧붙임 19) ' + JSON.stringify(r.fv) + ' / ' + JSON.stringify(r.fvText));
            const want = { 1: 'rgb(242, 194, 48)', 2: 'rgb(251, 146, 60)', 3: 'rgb(227, 72, 66)' };
            assert.ok(r.grade.length >= 2 && r.grade.every((x) => { const [, , rk, col, w] = x.split('|'); return col === want[rk] && Number(w) >= 700; }), '배지 상세 표 등급·혼잡지수 칸 = 단계 색 굵게(덧붙임 20·21) ' + JSON.stringify(r.grade));
            assert.ok(r.grade.some((x) => /^KOMSA 혼잡 예보\|12\.3 \(높음\)\|2\|/.test(x)) && r.grade.some((x) => /^KOMSA 해양사고 위험예보\|주의\|2\|/.test(x)), '혼잡지수 「12.3 (높음)」 주황 · 위험예보 「주의」 주황 ' + JSON.stringify(r.grade));
            assert.ok(r.thN >= 8 && r.th.length === 1 && r.th[0] === 'rgb(255, 255, 255)|800', '표 머리 칸 흰 굵게(덧붙임 22) ' + JSON.stringify(r.th) + ' ' + r.thN);
            assert.deepEqual([r.paren.text, r.paren.disp, r.paren.below], ['(연안사고 위험구역 1·사망사고 발생구역 1·연안사고 다발구역 1)', 'inline-block', true], '긴 괄호 묶음 통째로 다음 줄(덧붙임 24)');
            assert.ok(r.notes.includes('익수 사고|rgb(248, 250, 252)|800 :: 이곳에서는 집계 기간 중 익수 사고가 많이 기록되었습니다.'), '유형 하나 — 「익수 사고」 흰 굵게(덧붙임 25) ' + JSON.stringify(r.notes));
            assert.ok(r.notes.includes('충돌|rgb(248, 250, 252)|800 / 전복 사고|rgb(248, 250, 252)|800 :: 이 해역에서는 집계 기간 중 충돌·전복 사고가 많이 기록되었습니다.'), '유형 둘 — 각각 흰 굵게 ' + JSON.stringify(r.notes));
            const W = 'rgb(248, 250, 252)';
            assert.ok(r.acc.includes('익수 3건|' + W + '|800') && r.acc.includes('사망 2명|rgb(227, 72, 66)|800') && r.acc.includes('실종 0명|rgb(251, 146, 60)|800'), '이호테우 [사고현황] 한 줄 — 유형 흰·사망(2명) 빨강·실종(0명) 주황(덧붙임 26·27) ' + JSON.stringify(r.acc));
            assert.ok(r.acc.some((x) => /^충돌 \d+건\|/.test(x)) && r.acc.includes('사망 1명|rgb(227, 72, 66)|800') && r.acc.filter((x) => /^실종 0명\|rgb\(251, 146, 60\)/.test(x)).length >= 2, '해역 카드 [사고현황](한림 사망 1명·실종 0명) ' + JSON.stringify(r.acc));
            assert.ok(r.num.includes('1.6배|' + W) && r.num.includes('1.2배|' + W) && r.num.includes('11m/s|' + W) && !r.num.some((x) => /사람|바람/.test(x)), '[오늘 예상] 수치만 흰 굵게(덧붙임 28) ' + JSON.stringify(r.num));
            assert.ok(r.iso && r.iso.startsWith('[고립 주의] ') && !r.iso.includes('(고립 주의)'), '옛 판 「(고립 주의)」도 화면은 「[고립 주의]」(덧붙임 29) ' + r.iso);
            assert.ok(Math.abs(r.paren.left - r.paren.vLeft) <= 1, '다음 줄은 글 칸 첫 글자 위치에서 ' + JSON.stringify(r.paren)); assert.ok(r.page <= r.vw + 1);
            await L20.evaluate(() => { const c = [...document.querySelectorAll('#sb20 [data-sb-card="land"]')].find((x) => x.querySelector('.sb-card-name').textContent === '옛판관광지'); c.scrollIntoView({ block: 'center' }); }); await clean(L20);
            await L20.locator('#sb20 [data-sb-card="land"]', { hasText: '옛판관광지' }).screenshot({ path: path.join(SHOT, 'land_paren_wrap_360.png') });
            await L20.evaluate(() => document.querySelector('#sb20 [data-sb-card="sea"]').scrollIntoView({ block: 'start' })); await clean(L20);
            await L20.locator('#sb20 [data-sb-card="sea"]').first().screenshot({ path: path.join(SHOT, 'sea_card_colors_360.png') });
        });
        // ── §11.10.22(2026-10-18 사용자 결정) B·A·C 화면 — 해역 카드 [사고현황] 두 줄 · 해구 표기 · 유의파고 ──
        await check('[§11.10.22-UI] 해역 카드 [사고현황(\'21~\'25년)] 내용은 이름표 다음 줄(#39 — 연안 카드와 같은 .sb-acc-line, 이름표와 같은 왼쪽) · [기상 예보] 「유의파고 …」 굵게·「(N해구 예보)」 · 「대해구 N」·「소해구 N-N」·「최대 파고」 글 없음 · 데이터 출처 「해구별 3시간 예보(유의파고·풍속)」 · 360px 넘침 없음', async () => {
            await draw20(G);
            const r = await L20.evaluate(() => {
                const box = document.getElementById('sb20'), out = {};
                out.cards = [...box.querySelectorAll('[data-sb-card="sea"]')].map((c) => {
                    const row = [...c.querySelectorAll(':scope > .sb-row')].find((x) => /^\[사고현황/.test(x.querySelector('.sb-row-k').textContent)), line = row && row.nextElementSibling;
                    const k = row.querySelector('.sb-row-k').getBoundingClientRect(), lb = line.getBoundingClientRect(), rg = document.createRange(); rg.selectNodeContents(line); const lr = rg.getClientRects()[0];
                    const fx = [...c.querySelectorAll(':scope > .sb-row')].find((x) => x.querySelector('.sb-row-k').textContent === '[기상 예보]');
                    return { label: row.querySelector('.sb-row-k').textContent, rowV: row.children[1] ? row.children[1].textContent : null, lineCls: line.className, lineAttr: line.getAttribute('data-sb-acc-line'), line: line.textContent,
                        below: lb.top >= k.bottom - 1, left: Math.round(lr.left) - Math.round(k.left), n: [...line.querySelectorAll('.sb-acc-n')].map((b) => getComputedStyle(b).fontWeight), fs: getComputedStyle(line).fontSize,
                        fx: fx ? fx.children[1].textContent : null, fxB: fx ? [...fx.querySelectorAll('.sb-fv')].map((b) => b.textContent) : [] };
                });
                const land = box.querySelector('[data-sb-card="land"] [data-sb-acc-line]'); out.landFs = land ? getComputedStyle(land).fontSize : null;
                out.text = box.textContent; out.src = window.StationBriefingRender.SOURCES.map((x) => x[0]).filter((x) => /해구별 3시간 예보/.test(x));   // 출처는 [기준 상세] 표(SOURCES) — 본문 「데이터 출처 보기」 2026-10-18 삭제
                out.page = document.documentElement.scrollWidth; out.vw = innerWidth;
                return out;
            });
            assert.ok(r.cards.length >= 1 && r.cards.some((c) => / \d+건/.test(c.line)) && r.cards.some((c) => c.fx !== null), '해역 카드(사고 건수·[기상 예보]가 있는 카드 포함)');
            for (const c of r.cards) {
                assert.ok(/^\[사고현황\(/.test(c.label), c.label); assert.deepEqual([c.rowV, c.lineCls, c.lineAttr, c.below, c.left], ['', 'sb-acc-line', 'sea', true, 0], '이름표 줄에는 내용 없음 → 다음 줄 첫 글자가 이름표 「[」 위치 ' + JSON.stringify(c));
                assert.ok(!/ \d+건/.test(c.line) || (c.n.length && c.n.every((w) => Number(w) >= 700)), '「유형 N건」 흰 굵게 그대로 ' + c.line);
                assert.equal(c.fs, r.landFs, '연안 카드 사고현황 아래 줄과 같은 글자 크기');
                if (c.fx !== null) assert.ok(c.fxB.some((b) => /^유의파고 [\d.]+m·풍속 [\d.]+m\/s$/.test(b)) && /[(\s]\d+(?:-\d)?해구 예보\)\.$/.test(c.fx), '[기상 예보] ' + c.fx + ' / ' + JSON.stringify(c.fxB));
            }
            assert.ok(!/[대소]해구 \d|최대 파고/.test(r.text), '화면 글에 「대해구 N」·「소해구 N-N」·「최대 파고」 없음');
            assert.deepEqual(r.src, ['해구별 3시간 예보(유의파고·풍속)']); assert.ok(r.page <= r.vw + 1, '360px 가로 넘침 없음 ' + r.page);
            await L20.evaluate(() => document.querySelector('#sb20 [data-sb-card="sea"]').scrollIntoView({ block: 'start' })); await clean(L20);
            await L20.locator('#sb20 [data-sb-card="sea"]').first().screenshot({ path: path.join(SHOT, 'sea_acc_line_360.png') });
        });
        // ── §11.10.23(2026-10-18 사용자 확정 「좋아 이렇게 하자.」 — 시안 Traffic.dc.html ⑦판): 해역 카드 [최근 14일 선박 동향] ──
        await check('[§11.10.23-UI] 해역 카드 [최근 14일 선박 동향] — 자리(…많이 기록되었습니다 → 이 줄 → [기상 예보] → [권고]) · 글 그대로(textContent) · 글자 색 #9ee3f2 · 둘째 줄은 글 칸 시작(걸린 들여쓰기) · 360px 넘침 없음 · 서버 null·옛 판(필드 없음)은 줄 없음 · 데이터 출처 한 줄', async () => {
            const g3 = JSON.parse(JSON.stringify(G)), cs = g3.sea.cards;
            cs.forEach((c, i) => { c.traffic = i === 0 ? R.trafficRow({ dailyAvg: 5.2, peak: { from: '06', to: '09', avg: 12.4 } }) : i === 1 ? R.trafficRow({ dailyAvg: 9.1, peak: null }) : i === 2 ? null : undefined; if (c.traffic === undefined) delete c.traffic; });
            cs[0].historyNote = cs[0].historyNote || '이 해역에서는 집계 기간 중 충돌 사고가 많이 기록되었습니다.';
            await draw20(g3);
            const r = await L20.evaluate(() => {
                const box = document.getElementById('sb20'), out = {};
                box.querySelectorAll('[data-sb-sec="sea"] [role="tabpanel"]').forEach((p) => { p.hidden = false; });
                const cards = [...box.querySelectorAll('[data-sb-card="sea"]')];
                out.cards = cards.map((c) => {
                    const tr = c.querySelector('[data-sb-traffic]');
                    const o = { kids: [...c.children].map((e) => e.classList.contains('sb-row') ? 'row:' + e.querySelector('.sb-row-k').textContent : e.classList[0]).filter((k) => k !== 'sb-link'), has: !!tr };
                    if (tr) {
                        const k = tr.querySelector('.sb-row-k'), v = tr.querySelector('.sb-traffic'), rg = document.createRange(); rg.selectNodeContents(v);
                        const lines = [...rg.getClientRects()].map((x) => [Math.round(x.left), Math.round(x.top)]), tops = [...new Set(lines.map((x) => x[1]))];
                        o.text = v.textContent; o.color = getComputedStyle(v).color; o.kColor = getComputedStyle(k).color; o.vLeft = Math.round(v.getBoundingClientRect().left); o.kRight = Math.round(k.getBoundingClientRect().right);
                        o.lefts = tops.map((tp) => Math.min(...lines.filter((x) => x[1] === tp).map((x) => x[0]))); o.inCard = tr.getBoundingClientRect().right <= c.getBoundingClientRect().right + 0.5;
                    }
                    return o;
                });
                out.src = window.StationBriefingRender.SOURCES.map((x) => [x[3], x[0], x[1]].join('|')).filter((x) => x.includes('선박 동향'));   // [기준 상세] 출처 표(SOURCES)
                out.page = document.documentElement.scrollWidth; out.vw = innerWidth;
                return out;
            });
            const [c0, c1, c2, c3] = r.cards;
            assert.ok(c0.has && c1.has && !c2.has && (!c3 || !c3.has), '서버 null(c2)·필드 없음(c3, 옛 판)은 줄 없음 ' + JSON.stringify(r.cards.map((c) => c.has)));
            const i = c0.kids.indexOf('row:[최근 14일 선박 동향]');
            assert.deepEqual(c0.kids.slice(i - 1, i + 3), ['sb-sentence', 'row:[최근 14일 선박 동향]', 'row:[기상 예보]', 'row:[권고]'], '자리 ' + c0.kids.join());
            assert.ok(c0.kids.indexOf('sb-acc-line') < i, '[사고현황] 아래');
            assert.equal(c0.text, '이 해역 하루 평균 5척 · 06~09시 가장 많음(평균 12척)'); assert.equal(c1.text, '이 해역 하루 평균 9척 · 뚜렷하게 붐비는 시간대 없음');
            assert.deepEqual([c0.color, c0.kColor], ['rgb(158, 227, 242)', 'rgb(148, 163, 184)'], '글 #9ee3f2 · 이름표는 다른 줄과 같은 회색');
            for (const c of [c0, c1]) {
                assert.ok(c.lefts.length >= 2, '360px 에서 두 줄 이상(걸린 들여쓰기를 볼 수 있게) ' + JSON.stringify(c.lefts));
                assert.ok(c.lefts.every((x) => Math.abs(x - c.vLeft) <= 1) && c.vLeft > c.kRight, '둘째 줄도 글 칸 첫 글자 위치(이름표 오른쪽) ' + JSON.stringify(c));
                assert.ok(c.inCard, '카드 안');
                assert.ok(!/필요|'/.test(c.text));
            }
            assert.deepEqual(r.src, ['해상|최근 14일 선박 동향|한국해양교통안전공단 MTIS 실시간(앱이 30분 단위로 쌓음)'], '데이터 출처 한 줄');
            assert.ok(r.page <= r.vw + 1, '360px 가로 넘침 없음 ' + r.page);
            // 서버 글은 textContent 로만(계약 §5)
            const x = JSON.parse(JSON.stringify(g3)); x.sea.cards[0].traffic.text = XSS + '이 해역'; await draw20(x);
            const xs = await L20.evaluate(() => ({ imgs: document.querySelectorAll('#sb20 img').length, flag: window.__xss || null, t: (document.querySelector('#sb20 [data-sb-traffic] .sb-traffic') || {}).textContent }));
            assert.deepEqual([xs.imgs, xs.flag, xs.t.startsWith('<img')], [0, null, true]);
            await draw20(g3); await L20.evaluate(() => { document.querySelectorAll('#sb20 [data-sb-sec="sea"] [role="tabpanel"]').forEach((p) => { p.hidden = false; }); document.querySelector('#sb20 [data-sb-traffic]').closest('[data-sb-card]').scrollIntoView({ block: 'start' }); }); await clean(L20);
            await L20.locator('#sb20 [data-sb-card="sea"]').first().screenshot({ path: path.join(SHOT, 'sea_traffic_line_360.png') });
        });
        await check('[§11.10.27-UI] (기상) 칸 칠하기(360px) — 오전·오후 줄 수치 흰 굵게(「구름많음」·「풍향 …」 그대로) · 특이사항 수치·시간 범위 흰 굵게, 「풍랑 예비특보」 노랑, 「매우 강한 바람」·「돌풍과 천둥·번개」·「높아짐」 흰 굵게 · 「오늘 오전」 이름표·출처 줄 그대로 · textContent = 서버 글 · 넘침 없음', async () => {
            // 사용자가 보여 준 화면 글 그대로(2026-10-18 *"여기도 주요 수치나 그런거는 색상 또는 텍스트 스타일이 달랐으면 좋겠는데 ? 다른데 반영된 것 처럼"*)
            const W = { zone: '제주도북부앞바다', missing: false, rows: [{ label: '오늘 오전', text: '구름많음 · 파고 1.0~2.5m · 풍속 8~13m/s · 풍향 남→남서', ok: true }, { label: '오늘 오후', text: '흐림 · 파고 1.0~2.5m · 풍속 8~13m/s · 풍향 남서→서', ok: true }],
                source: '제주지방기상청 단기 해상예보 (10.18 05:00 발표)', bulletinMissing: false, notesFound: true, notesSource: '제주지방기상청 단기 전망 (10.18 04:30 발표)',
                notes: ['오늘 밤까지 순간풍속 20m/s의 매우 강한 바람', '풍랑 예비특보: 오늘 새벽(00~06시) 제주도앞바다(북부앞바다 제외) — 물결 1.5~3.0m로 높아짐', '오늘 제주도해상과 남해서부서쪽먼바다 돌풍과 천둥·번개(곳에 따라)'] };
            const g = JSON.parse(JSON.stringify(G)); g.summary.weather = W; await draw20(g);
            const r = await L20.evaluate(() => {
                const p = document.querySelector('#sb20 [data-sb-part="weather"]'), R = window.StationBriefingRender, tmp = document.createElement('i'); tmp.style.color = R.colorOf(1); p.appendChild(tmp); const yellow = getComputedStyle(tmp).color; tmp.remove();
                const line = (li) => ({ text: li.textContent, hl: [...li.querySelectorAll('.sb-hl')].map((b) => [b.textContent, b.getAttribute('data-sb-wx-k'), getComputedStyle(b).color, getComputedStyle(b).fontWeight].join('|')),
                    label: li.firstElementChild && !li.firstElementChild.classList.contains('sb-hl') ? [li.firstElementChild.textContent, getComputedStyle(li.firstElementChild).color] : null });
                return { rows: [...p.querySelectorAll('.sb-wx-rows > li')].map(line), notes: [...p.querySelectorAll('.sb-wx-notes > li')].map(line), yellow, white: getComputedStyle(p.querySelector('.sb-hl-b')).color, base: getComputedStyle(p.querySelector('.sb-wx-rows > li')).color,
                    smalls: [...p.querySelectorAll('.sb-small')].map((e) => [e.textContent, e.children.length]), page: document.documentElement.scrollWidth, vw: innerWidth };
            });
            const W8 = r.white + '|800', Y8 = r.yellow + '|800';
            assert.equal(r.white, 'rgb(248, 250, 252)', '흰 = .sb-hl-b(#f8fafc)'); assert.notEqual(r.yellow, r.white, '노랑 = colorOf(1)(분석 문단 예비특보와 같은 색)');
            assert.deepEqual(r.rows.map((x) => x.text), W.rows.map((x) => x.label + ' ' + x.text), 'textContent = 이름표 + 서버 글');
            for (const x of r.rows) {
                assert.deepEqual(x.hl, ['1.0~2.5m|num|' + W8, '8~13m/s|num|' + W8], '줄 수치만 흰 굵게 ' + JSON.stringify(x.hl));
                assert.deepEqual(x.label, [x.text.slice(0, 6), r.base], '「오늘 오전/오후」 이름표 그대로(글 칸 색 굵게 — 칠하지 않음)');
            }
            assert.deepEqual(r.notes.map((x) => x.text), W.notes, 'textContent = 서버 글');
            assert.deepEqual(r.notes.map((x) => x.hl), [
                ['20m/s|num|' + W8, '매우 강한 바람|risk|' + W8],
                ['풍랑 예비특보|warn|' + Y8, '00~06시|num|' + W8, '1.5~3.0m|num|' + W8, '높아짐|risk|' + W8],
                ['돌풍과 천둥·번개|risk|' + W8]], JSON.stringify(r.notes.map((x) => x.hl)));
            assert.deepEqual(r.smalls, [[W.source, 0], [W.notesSource, 0]], '출처 줄 그대로(회색 작은 글, 칠하지 않음)');
            assert.ok(r.page <= r.vw + 1, '360px 가로 넘침 없음 ' + r.page);
            await L20.evaluate(() => document.querySelector('#sb20 [data-sb-part="weather"]').scrollIntoView({ block: 'start' })); await clean(L20);
            await L20.locator('#sb20 [data-sb-part="weather"]').screenshot({ path: path.join(SHOT, 'weather_box_colors_360.png') });
            // 경보·주의보 색 · 서버 글은 textContent 로만(계약 §5)
            const g2 = JSON.parse(JSON.stringify(g)); g2.summary.weather.notes = ['풍랑주의보 발효 중 · 강풍경보', XSS + ' 순간풍속 25m/s']; await draw20(g2);
            const x2 = await L20.evaluate(() => { const n = [...document.querySelectorAll('#sb20 .sb-wx-notes > li')];
                return { warn: [...n[0].querySelectorAll('[data-sb-wx-k="warn"]')].map((b) => [b.textContent, b.getAttribute('data-rank'), getComputedStyle(b).color]), orange: (() => { const t = document.createElement('i'); t.style.color = window.StationBriefingRender.colorOf(2); n[0].appendChild(t); const c = getComputedStyle(t).color; t.remove(); return c; })(),
                    imgs: document.querySelectorAll('#sb20 img').length, flag: window.__xss || null, t: n[1].textContent }; });
            assert.deepEqual(x2.warn, [['풍랑주의보 발효 중', '2', x2.orange], ['강풍경보', '3', 'rgb(227, 72, 66)']], '주의보 주황 · 경보 밝힌 빨강(.sb-hl-red) ' + JSON.stringify(x2.warn));
            assert.deepEqual([x2.imgs, x2.flag, x2.t], [0, null, XSS + ' 순간풍속 25m/s']);
        });
        await check('[§11.10.20-UI5] 옛 판 후퇴 — 규칙 v17 연안 카드(advice·accidents 없음)는 종전 꼬리표·[특성]·문장 그대로([오늘 예상] 하나면 점 없음) · 해역 카드 [권고]도 같은 상자(덧붙임 9 — 글자 크기 카드 그대로, 특보 이름 속 글자는 칠하지 않음)', async () => {
            const old = JSON.parse(JSON.stringify(G)); old.rulesVersion = 'station-briefing-rules-v17';
            old.land.cards.forEach((c) => { delete c.indexBadge; delete c.hazardTable; delete c.accidents; delete c.advice; c.sentence = c.name + ' — ' + c.today.changes.join(', ') + '. 물가 접근에 주의가 필요합니다.'; });
            await draw20(old);
            const r = await L20.evaluate(() => { const c = document.querySelector('#sb20 [data-sb-card="land"]'), sea = document.querySelector('#sb20 [data-sb-card="sea"]'), sa = sea && sea.querySelector('.sb-adv');
                return { kids: [...c.children].map((e) => e.className), tag: (c.querySelector('.sb-tag') || {}).textContent, ul: !!c.querySelector('.sb-row ul'), sentence: (c.querySelector('.sb-sentence') || {}).textContent,
                    seaAdv: sa && { k: sa.querySelector('.sb-advk').textContent, kc: getComputedStyle(sa.querySelector('.sb-advk')).color, bg: getComputedStyle(sa).backgroundColor, fs: getComputedStyle(sa).fontSize, rowFs: getComputedStyle(sea.querySelector('.sb-row:not(.sb-adv)')).fontSize, lv: [...sa.querySelectorAll('.sb-hl-lv')].map((x) => x.textContent), last: sa === [...sea.querySelectorAll(':scope > .sb-row')].pop() } }; });
            assert.deepEqual(r.kids.slice(0, 5), ['sb-card-head', 'sb-tags', 'sb-row', 'sb-row', 'sb-sentence'], '옛 판: 꼬리표 → [특성] → [오늘 예상] → 문장'); assert.ok(r.tag && !r.ul && r.sentence.includes('물가 접근'), JSON.stringify(r));
            assert.deepEqual([r.seaAdv.k, r.seaAdv.kc, r.seaAdv.bg, r.seaAdv.fs === r.seaAdv.rowFs, r.seaAdv.last], ['[권고]', 'rgb(255, 215, 94)', 'rgba(255, 200, 60, 0.1)', true, true], '해역 카드 [권고] 상자 ' + JSON.stringify(r.seaAdv));
            assert.ok(r.seaAdv.lv.every((x) => /^(경계|주의|관심|'[^']+')$/.test(x)), '특보 이름 속 글자는 칠하지 않음 ' + JSON.stringify(r.seaAdv.lv));
            await L20.context().close();
        });
        await check('[§11.10.30-UI] 「해상 분석」 칸 해구 흐름 줄(.sb-weather) — 「기준」 없음·끝 마침표 하나(사용자 「그냥 11.9m/s입니다.로 끝내」) · 넘지 않음 「222해구 예보는 유의파고 1.7m·풍속 11.9m/s입니다.」 · 넘음 「…, 21시부터 낮아집니다.」 · 해상 분석 칸 글 어디에도 「기준」 없음', async () => {
            const low = mapInputs(hallimInput()); low.sea.weather = { 222: { label: '222해구', rows: [[15, 1.2, 9], [18, 1.7, 11.9], [21, 1.5, 10]].map(([h, wh, ws]) => ({ at: at(h), wh, ws })) } };
            const bl = R.buildBriefing(low, WIN, { generatedAt: '2026-10-17T13:10:00+09:00' });
            const g = await device({ admin: true, width: 360, height: 780 }); await pickStation(g, HALLIM); await openAcc(g);
            const r = await g.evaluate(async ({ list, now }) => {
                const R = window.StationBriefingRender, box = document.getElementById('station-briefing-content'), out = [];
                for (const b of list) {
                    R.render(box, { ok: true, briefing: b }, { now, showSea: true, showLand: true, onLink: () => {} });
                    const sec = box.querySelector('[data-sb-sec="sea"]'), w = sec && sec.querySelector('.sb-weather');
                    out.push({ w: w ? w.textContent : null, sea: sec ? sec.textContent : '' });
                }
                return out;
            }, { list: [bl, B.h], now: clock.now });
            assert.equal(r[0].w, '222해구 예보는 유의파고 1.7m·풍속 11.9m/s입니다.', '사용자 화면 문장(종전 「…로 기준(유의파고 2m·풍속 12m/s) 미만입니다」)');
            assert.ok(/^232해구 예보는 15시부터 유의파고 2\.4m·풍속 13m\/s로 높아집니다\(12시 유의파고 1\.4m·풍속 9m\/s\), 21시부터 낮아집니다\.$/.test(r[1].w), r[1].w);
            for (const x of r) { assert.ok(!/\.\./.test(x.w), '이중 마침표 없음 ' + x.w); assert.ok(x.sea.length > 100 && !/기준/.test(x.sea), '해상 분석 칸 글에 「기준」 없음 — ' + (x.sea.match(/.{30}기준.{20}/) || [''])[0]); }
            await g.context().close();
        });
        await check('실행 오류 없음', async () => { assert.deepEqual(errors, []); });
    } catch (e) { console.error('❌ 준비 실패', e && e.stack); fail++; }
    finally { if (browser) await browser.close(); if (server) server.close(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 임시 폴더 */ } }
    console.log('스크린샷: ' + SHOT);
    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();
