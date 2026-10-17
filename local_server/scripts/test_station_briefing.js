/**
 * ============================================================================
 * 파일명: local_server/scripts/test_station_briefing.js
 * 역할  : 「활동지점 안전 브리핑」(파출소 관할) 서버 1단계 시험 — 고정 입력(가짜 자료)으로 규칙·AI 순서·검증·저장·일정·노출을 결정론적으로 확인한다.
 *         실제 AI·카카오·기상청 호출 없음(가짜 어댑터·가짜 fetch), 임시 폴더만 쓴다, 서버를 띄우지 않는다(라우터만 임시 포트).
 *         끝부분 「[A1]…[C9]」 = 독립 검토 3건(규칙·AI·운영, 2026-10-16)의 결함마다 1:1 회귀 — 모두 고치기 전 코드에서 실패함을 확인했다.
 *         맨 끝 「[§11.10.3-1]…[§11.10.3-5]」 = 2026-10-17 사용자 결정(설계서 §11.10.3 — (고립 주의) 지점 표·육상 권고·해상 근거 칸·해양사고 위험예보·해구 줄은 넘을 때만·지도 재료) 1:1 — 고치기 전 코드(6ec172ffa)에서 5건 모두 실패.
 *         그 앞 「[§11.10.2-1]…[§11.10.2-12]」 = §11.10·§11.10.1 독립 검토 12건(설계서 §11.10.2) 1:1 — 고치기 전 코드(cebb4cbe0)에서 12건 모두 실패함을 확인했다.
 *         그 앞 「[§11.10.1]」 = 같은 날 후속 결정((기상) 칸 — 가장 가까운 앞바다 단기 해상예보 오전·오후, 단기 전망 대상일 특이사항(사용자가 붙여 준 통보문 fixtures/station_briefing/), 물때 공용, 「예상」) 1:1 — 고치기 전 코드(8afdce39f)에서 6건 모두 실패.
 *         그 앞 「[§11.10]」 = 2026-10-17 사용자 결정(총평 = 서버 결론·근거·권고 + AI 해설 1~2문장 · 개수 버그 · 너울 · 해역 이름·셈말 허용 · 관리자 오류 3일 보관) 1:1 — 고치기 전 코드에서 4건 모두 실패함을 확인했다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/station_briefing_rules.js · station_briefing_ai.js · station_briefing_inputs.js · station_briefing.js · routes/station_briefing.js
 *                    · client/js/forecast/station-briefing/station_briefing_render.js(notesEmptyText)·client/js/admin/admin_station_briefing.js(errorsMarkdown) — vm 으로 읽어 순수 함수만
 *                    · config/coastal_safety/coastguard_stations.geojson(관할 97곳 — 해상만 19곳 셈)
 *  - 나를 쓰는 곳  : scripts/refactor/verify_all.sh SUITES
 * [로드 순서] 독립 실행: node local_server/scripts/test_station_briefing.js
 * ============================================================================
 */
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const R = require('../services/station_briefing_rules'), AI = require('../services/station_briefing_ai'), I = require('../services/station_briefing_inputs'), SB = require('../services/station_briefing');
let pass = 0, fail = 0;
async function check(name, fn) { try { await fn(); pass++; console.log('✅ ' + name); } catch (e) { fail++; console.log('❌ ' + name + ' — ' + (e && e.message)); } }
// 문단 모양(문장 수 3~5·마지막 「따라서 … 필요합니다」 — 2026-10-17 §11.10.4)을 뺀 검증 결과. 숫자·지명·단계·금지어 같은 다른 규칙을 짧은 글로 보는 기존 사례가 쓴다
// (그 사례들은 1~2문장 해설 시절에 쓰여 모양만 바뀐 규칙에 걸린다 — 모양 자체는 「AI 응답 검증」·[§11.10.2-9]·[§11.10.4-*] 가 AI.validateOverview 로 직접 본다).
const vo = (o, si) => { const errors = AI.validateOverview(o, si).errors.filter((e) => !/^shape:(?:land|sea)-(?:sentences-\d+|no-conclusion)$/.test(e)); return { ok: errors.length === 0, errors }; };
const pad = (n) => String(n).padStart(2, '0'), at = (h, d = '2026-10-17') => `${d}T${pad(h)}:00:00+09:00`;
const T0 = Date.parse(at(8)); // 2026-10-17(토) 08:00 KST

/** 한림파출소 고정 입력(숫자는 시험용 가짜). */
function hallim() {
    return {
        key: '제주해양경찰서|한림파출소', name: '한림파출소', office: '제주해양경찰서', region: '제주지방해양경찰청', seaOnly: false,
        location: { lat: 33.41, lon: 126.26, source: 'estimate', estimated: true }, sources: { accident: 'ok', congestion: 'ok', zoneForecasts: 'ok', warnings: 'ok' },
        sea: {
            reviewedCells: 52,
            regions: [
                { rid: 'A:1001', gridId: 'GR4_1', accidentGridId: '1001', lat: 33.43, lon: 126.22, haegu: { major: 232, sub: 2, label: '232-2' }, ref: { name: '화순항', distNm: 13.3, bearingWord: '북북서' }, zone: { name: '제주도서부앞바다', kind: 'main' }, zones: ['제주도서부앞바다'],
                    slots: { [at(15)]: { accident: '주의', congestion: { level: '높음', index: 12.3, at: at(15) } }, [at(18)]: { accident: '주의', congestion: null } }, history: { from: '2021-01-01', to: '2025-12-31', count: 18, topTypes: [{ type: '충돌', count: 7 }, { type: '침수', count: 5 }], death: 1, missing: 0 } },
                { rid: 'A:1002', gridId: null, accidentGridId: '1002', lat: 33.25, lon: 126.20, haegu: { major: 232, sub: 5, label: '232-5' }, ref: { name: '모슬포', distNm: 4.0, bearingWord: '북서' }, zone: null, zones: [],
                    slots: { [at(9)]: { accident: '주의' } }, history: { from: '2021-01-01', to: '2025-12-31', count: 3, topTypes: [{ type: '좌초', count: 2 }], death: 0, missing: 0 } },
                { rid: 'T:GR4_9', gridId: 'GR4_9', accidentGridId: null, lat: 33.48, lon: 126.33, haegu: { major: 232, sub: 3, label: '232-3' }, ref: { name: '제주', distNm: 7.0, bearingWord: '서' }, zone: { name: '제주도북부앞바다', kind: 'main' }, zones: ['제주도북부앞바다'],
                    slots: { [at(12)]: { accident: null, congestion: { level: '높음', index: 11, at: at(13) } } }, history: { count: 0 } },
            ],
            weather: { 232: { label: '대해구 232', rows: [[6, 0.8, 5], [9, 1.0, 6], [12, 1.4, 9], [15, 2.4, 13], [18, 2.6, 14], [21, 1.8, 10]].map(([h, wh, ws]) => ({ at: at(h), wh, ws })) } },
            warnings: [
                { zone: '제주도북부앞바다', kind: '앞바다', type: '풍랑', level: '주의보', state: '발효', effective: { start: '2026-10-16T21:00:00+09:00', end: '2026-10-16T21:00:00+09:00', range: false }, release: { start: at(6), end: at(9), range: true } },
                { zone: '제주도서부앞바다', kind: '앞바다', type: '풍랑', level: '주의보', state: '예비', effective: { start: at(21), end: '2026-10-18T00:00:00+09:00', range: true }, release: null },
            ],
        },
        places: [{ name: '비양도', lat: 33.4067, lon: 126.2275 }, { name: '협재해수욕장', lat: 33.394, lon: 126.239 }, { name: '금능해수욕장', lat: 33.390, lon: 126.235 }, { name: '한림항', lat: 33.414, lon: 126.264 }],
        land: {
            spots: [
                { id: '50110|협재해수욕장', name: '협재해수욕장', lat: 33.394, lon: 126.239, beach: true, index: 72, band: '높음', peakAt: at(15), people: { ratio: 1.8, score: 0.82 }, event: null, swell: null, rip: null, notices: { effective: [], prelim: [], windMs: 9 }, hazard: { count: 4, byType: [{ class: '사망사고 발생구역', count: 1 }, { class: '연안사고 다발구역', count: 2 }, { class: '연안사고 위험구역', count: 1 }] }, history: { count: 6, from: '2020-01-01', to: '2024-12-31', topTypes: [{ type: '표류', count: 4 }] }, missing: [] },
                { id: '50110|금능해수욕장', name: '금능해수욕장', lat: 33.390, lon: 126.235, beach: true, index: 41, band: '다소 높음', peakAt: at(15), people: { ratio: 1.3, score: 0.37 }, event: null, swell: null, rip: null, notices: { effective: [], prelim: [], windMs: null }, hazard: { count: 2, byType: [{ class: '연안사고 위험구역', count: 2 }] }, history: { count: 8, from: '2020-01-01', to: '2024-12-31', topTypes: [{ type: '표류', count: 6 }] }, missing: [] },
                { id: '50110|한림항', name: '한림항', lat: 33.414, lon: 126.264, beach: false, index: 30, band: '다소 높음', peakAt: at(6), people: { ratio: 0.9, score: 0 }, event: null, swell: null, rip: null, notices: { effective: [], prelim: [], windMs: null }, hazard: { count: 3, byType: [{ class: '사망사고 발생구역', count: 3 }] }, history: { count: 2, from: '2020-01-01', to: '2024-12-31', topTypes: [{ type: '추락', count: 2 }] }, missing: [] },
                { id: '50110|판포포구', name: '판포포구', lat: 33.36, lon: 126.20, beach: false, index: 12, band: '평소 수준', peakAt: at(6), people: { ratio: 1.2, score: 0.26 }, event: null, swell: null, rip: null, notices: { effective: [], prelim: [], windMs: null }, hazard: { count: 1, byType: [{ class: '연안사고 위험구역', count: 1 }] }, history: null, missing: [] },
            ],
            hazardOnly: [{ id: '한림-9', place: '한림항 방파제', class: '사망사고 발생구역', shape: '방파제', lat: 33.415, lon: 126.262 }],
        },
        tide: null,
    };
}
const WIN = R.editionWindow('morning', T0);

(async () => {
    // ── 일정·창 ──
    await check('창: 08:00 판 = 오늘 06~21시 6칸 · 23:00 판 = 오늘 21시~내일 21시 9칸(「오늘 밤~내일」) · 23시 판을 놓쳐 01:10 에 만들면 그날 8칸', () => {
        assert.deepStrictEqual(WIN.slots.map((s) => s.slice(11, 13)), ['06', '09', '12', '15', '18', '21']);
        assert.equal(WIN.targetDate, '2026-10-17');
        const n = R.editionWindow('night', Date.parse(at(23)));
        assert.equal(n.targetDate, '2026-10-18'); assert.equal(n.slots.length, 9); assert.equal(n.from, at(21)); assert.equal(n.to, '2026-10-19T00:00:00+09:00');
        const late = R.editionWindow('night', Date.parse('2026-10-17T01:10:00+09:00'));
        assert.equal(late.targetDate, '2026-10-17'); assert.equal(late.slots.length, 8);
    });
    // 2026-10-17 §11.10.4: 만들기 시작 07:10·17:10·22:40(공개 07:30·17:30·23:00 — [§11.10.4-1] 이 공개 시각을 본다). 종전 시작 = 공개 = 08:00·17:30·23:00.
    await check('정시 판(가짜 시계): 07:10 아침 · 17:09 없음 · 17:10 저녁 · 22:40 밤 · 같은 판은 한 번만 · 서버가 꺼져 있었으면 다음 판 전까지 늦게', () => {
        const done = new Set(['2026-10-16|night']);
        assert.equal(R.dueEdition(Date.parse('2026-10-17T07:09:00+09:00'), done), null);
        const m = R.dueEdition(Date.parse('2026-10-17T07:10:00+09:00'), done); assert.equal(m.kind, 'morning'); assert.equal(m.key, '2026-10-17|morning'); done.add(m.key);
        assert.equal(R.dueEdition(Date.parse('2026-10-17T17:09:00+09:00'), done), null);
        const e = R.dueEdition(Date.parse('2026-10-17T17:10:00+09:00'), done); assert.equal(e.kind, 'evening'); done.add(e.key);
        assert.equal(R.dueEdition(Date.parse('2026-10-17T22:39:00+09:00'), done), null);
        const n = R.dueEdition(Date.parse('2026-10-17T22:40:00+09:00'), done); assert.equal(n.kind, 'night');
        assert.equal(R.dueEdition(Date.parse(at(13)), new Set(['2026-10-16|night'])).kind, 'morning', '08시 판을 놓치면 13시에라도');
        assert.equal(R.dueEdition(Date.parse('2026-10-17T03:00:00+09:00'), new Set()).key, '2026-10-16|night', '23시 판을 놓치면 새벽에');
    });
    await check('21시 넘으면 다음 날 판(U58): 20:59 → 오늘, 21:00 → 내일', () => {
        assert.equal(R.displayDate(Date.parse('2026-10-17T20:59:00+09:00')), '2026-10-17');
        assert.equal(R.displayDate(Date.parse(at(21))), '2026-10-18');
    });

    // ── 해상 규칙 ──
    const b = R.buildBriefing(hallim(), WIN, { generatedAt: R.isoKst(T0) });
    await check('단계 규칙: 사고예보 경계→3·주의→2·경보→3·주의보→2·혼잡 높음→1·파고 2m/풍속 12m/s→1·특보 중이면 기상 「관심」 생략·자료 낡으면 안 씀', () => {
        const ok = { accident: true, congestion: true, zoneForecasts: true, warnings: true }, s = Date.parse(at(9)), e = s + 3 * 3600000;
        assert.equal(R.slotOf({ accident: '경계' }, s, e, ok).rank, 3);
        assert.equal(R.slotOf({ accident: '주의' }, s, e, ok).rank, 2);
        assert.equal(R.slotOf({ accident: '보통' }, s, e, ok).rank, 0);
        assert.equal(R.slotOf({ congestion: { level: '높음', index: 10 } }, s, e, ok).rank, 1);
        assert.equal(R.slotOf({ congestion: { level: '보통', index: 9.9 } }, s, e, ok).rank, 0);
        assert.equal(R.slotOf({ wh: 2.0, ws: 3 }, s, e, ok).rank, 1); assert.equal(R.slotOf({ wh: 1.9, ws: 11.9 }, s, e, ok).rank, 0);
        const w = (level, state = '발효') => ({ zone: 'Z', type: '풍랑', level, state, effective: { start: at(0), end: at(0), range: false }, release: null });
        assert.equal(R.slotOf({ warnings: [w('경보')] }, s, e, ok).rank, 3);
        const wx = R.slotOf({ warnings: [w('주의보')], wh: 3, ws: 15 }, s, e, ok);
        assert.equal(wx.rank, 2); assert.ok(!wx.sources.some((x) => x.kind === 'weather'), '특보 중엔 해구 기상 「관심」 근거를 따로 붙이지 않음');
        assert.equal(R.slotOf({ accident: '경계', congestion: { level: '매우높음', index: 30 } }, s, e, { ...ok, accident: false, congestion: false }).rank, 0, '낡은 원천은 쓰지 않음');
        const pre = { ...w('경보', '예비'), effective: { start: at(12), end: at(18), range: true } };
        assert.equal(R.slotOf({ warnings: [pre] }, s, e, ok).rank, 0, '예비는 발효 예정 시각 전엔 단계 없음');
        assert.equal(R.slotOf({ warnings: [pre] }, Date.parse(at(12)), Date.parse(at(15)), ok).rank, 3, '예비 경보는 예정 시각부터 경계(U21)');
    });
    await check('「주의」 거르기(§11.6-17①): 공식 사고예보 「주의」만 있는 칸은 총평 단계 0 — 기상·혼잡이 겹친 칸만 총평에', () => {
        const ok = { accident: true, congestion: true, zoneForecasts: true, warnings: true }, s = Date.parse(at(9)), e = s + 3 * 3600000;
        assert.equal(R.slotOf({ accident: '주의' }, s, e, ok).overviewRank, 0);
        assert.equal(R.slotOf({ accident: '주의', congestion: { level: '높음', index: 12 } }, s, e, ok).overviewRank, 2);
        assert.equal(R.slotOf({ accident: '주의', wh: 2.5 }, s, e, ok).overviewRank, 2);
        const r2 = b.sea.cards.find((c) => c.rid === 'A:1002');
        assert.equal(r2.rank, 2); assert.equal(r2.window, '09~12시');
        assert.equal(r2.overviewRank, 1, '같은 해역의 15시 이후 파고 근거(관심)만 총평 후보'); assert.equal(r2.overview.window, '15~21시');
        // 2026-10-17 §11.10: 총평 후보 3곳까지 — 모슬포 해역은 15시 이후 파고 근거(관심)로 들어가고, 「주의」(사고예보만)로는 들어가지 않는다.
        assert.deepStrictEqual(b.sea.overviewTop.map((c) => c.rid), ['A:1001', 'T:GR4_9', 'A:1002']);
        const mos = b.summary.sea.basis.find((x) => x.includes('모슬포'));
        assert.ok(mos && mos.includes('해구 예보 파고') && !mos.includes("공식 사고예보 '주의'"), '순위만 주의인 해역은 그 근거로 총평에 없음 — ' + mos);
    });
    await check('해역 묶기·순위·창: 단계 > 지속 칸 > 근거 겹침 > 과거 사고 · 관할 검토 칸 수 · 관심 이상 해역 수', () => {
        assert.deepStrictEqual(b.sea.cards.map((c) => c.rid), ['A:1001', 'T:GR4_9', 'A:1002']);
        const r1 = b.sea.cards[0];
        assert.equal(r1.rank, 2); assert.equal(r1.word, '주의 필요'); assert.equal(r1.window, '15~24시'); assert.equal(r1.peakAt, at(15));
        assert.equal(b.sea.reviewedCells, 52); assert.equal(b.sea.attentionRegions, 3); assert.equal(b.sea.level.word, '주의 필요');
        assert.ok(r1.traits.text.includes('2021~2025년 선박사고 18건(충돌 7·침수 5), 사망 1·실종 0'), r1.traits.text);
        assert.ok(r1.today.lines.includes("15~18시 혼잡 예보 '높음'(15시 혼잡지수 12.3) → 충돌·접촉 주의"), r1.today.lines.join(' / '));
        assert.equal(r1.overview.label, "해양사고 위험예보 '주의'(15~21시)·제주도서부앞바다 풍랑주의보 예비특보(발효 예정 시각 이후)(21~24시)");
        assert.equal(r1.link.accidentGridId, '1001'); assert.equal(r1.link.t, at(15));
    });
    await check('해역 이름 10km 규칙: 한림(주요지명 화순항 24.6km) → 관광지 「비양도」 기준점, 가까운 주요지명은 그대로', () => {
        const r1 = b.sea.cards[0];
        assert.ok(r1.name.startsWith('비양도 ') && r1.name.endsWith('해리 해역(232-2해구)'), r1.name); assert.equal(r1.nameBaseKind, 'place');
        assert.equal(b.sea.cards.find((c) => c.rid === 'A:1002').name, '모슬포 북서방 4.0해리 해역(232-5해구)');
        const near = R.regionName({ lat: 33.44, lon: 126.24, ref: { name: '화순항', distNm: 5.0, bearingWord: '북' }, haegu: { label: '232-2' } }, [{ name: '비양도', lat: 33.4067, lon: 126.2275 }]);
        assert.equal(near.baseKind, 'ref', '주요지명이 10km 안이면 바꾸지 않음');
        const none = R.regionName({ lat: 33.44, lon: 126.24, ref: { name: '화순항', distNm: 13.3, bearingWord: '북북서' }, haegu: { label: '232-2' } }, []);
        assert.equal(none.name, '화순항 북북서방 13.3해리 해역(232-2해구)', '관할 안 기준점이 없으면 주요지명 그대로');
    });
    await check('해구 3시간 흐름 「몇 시부터」: 15시부터 파고 2.4m·풍속 13m/s(앞 칸 12시 값) · 21시부터 기준 아래', () => {
        assert.equal(b.sea.weather.onsetAt, at(15));
        assert.equal(b.sea.weather.text, '대해구 232 예보는 15시부터 파고 2.4m·풍속 13m/s로 높아집니다(12시 파고 1.4m·풍속 9m/s), 21시부터 기준 아래로 내려갑니다');
    });
    await check('특보 해제 칸(§11.6-7 + 결정 1): 「HH~HH시 해제 예고」(기상청 시각 그대로, 「더 일찍 풀릴 수 있음」 없음) + 출항 안내 + 1.2~1.3배, 1.4·1.31 은 없음', () => {
        const rel = b.special.find((x) => x.kind === 'release');
        assert.equal(rel.title, '제주도북부앞바다 풍랑주의보 — 06~09시 해제 예고');
        assert.ok(!/더 일찍/.test(JSON.stringify(b)), '브리핑 어디에도 「더 일찍 풀릴 수 있음」 없음');
        assert.deepStrictEqual(rel.lines, ['해제 뒤 출항이 이어질 수 있습니다.', '2020~2025년 특보 해제 뒤 이틀 동안 전복·침몰·침수·표류 사고가 평소보다 약 1.2~1.3배 많았습니다.']);
        const all = JSON.stringify(b);
        assert.ok(!/1\.4배|1\.31배|첫 아침/.test(all));
        const pre = b.special.find((x) => x.kind === 'prewarn');
        assert.equal(pre.title, '제주도서부앞바다 풍랑주의보 예비특보 — 21~24시 발효 예정');
        const exact = R.warningEvents([{ zone: 'Z앞바다', type: '풍랑', level: '경보', state: '발효', effective: null, release: { start: '2026-10-18T06:30:00+09:00', end: '2026-10-18T06:30:00+09:00', range: false } }], R.editionWindow('night', Date.parse(at(23))));
        assert.equal(exact.special[0].title, 'Z앞바다 풍랑경보 — 06:30 해제 예고');
        const outside = R.warningEvents([{ zone: 'Z', type: '풍랑', level: '주의보', state: '발효', effective: null, release: { start: '2026-10-19T06:00:00+09:00', end: '2026-10-19T09:00:00+09:00', range: true } }], WIN);
        assert.equal(outside.special.length, 0, '창 밖 해제 예고는 칸을 만들지 않음');
    });
    await check('해상 시간 막대: 3시간 칸마다 관할 최고 단계·해역·사건(해제 예고 06시·예비 21시)', () => {
        assert.deepStrictEqual(b.sea.timeBar.map((s) => [s.label, s.rank]), [['06시', 2], ['09시', 2], ['12시', 1], ['15시', 2], ['18시', 2], ['21시', 2]]);
        assert.ok(b.sea.timeBar[0].events.some((e) => e.kind === 'release')); assert.ok(b.sea.timeBar[5].events.some((e) => e.kind === 'prewarn'));
        // 결정 4: 해제 뒤 「관심」은 해상 1시간 — 해제 예고 06~09시(끝 09시) 뒤 09~10시가 걸친 09시 칸만, 12시 칸은 아님(종전 12시간 규칙이면 12시도 붙었다).
        const r3 = b.sea.cards.find((c) => c.rid === 'T:GR4_9'), lab = (h) => r3.today.slots.find((x) => x.at === at(h)).labels;
        assert.ok(lab(9).some((l) => l.includes('해제 뒤')), '09시 칸 = 해제 뒤 1시간'); assert.ok(!lab(12).some((l) => l.includes('해제 뒤')), '12시 칸은 해제 뒤 아님');
        assert.ok(!b.sea.timeBar[2].labels.some((l) => l.includes('해제 뒤'))); assert.ok(b.sea.timeBar[1].region.startsWith('모슬포'), '막대는 순위만 「주의」인 칸도 보인다(분석)');
        assert.ok(b.sea.timeBar[3].region.startsWith('비양도 '));
        const night = R.buildBriefing(hallim(), R.editionWindow('night', Date.parse(at(23))), { generatedAt: R.isoKst(Date.parse(at(23))) });
        assert.equal(night.sea.timeBar[0].label, '10월 17일 21시', '23시 판의 오늘 밤 칸은 날짜를 붙임');
    });

    // ── 육상 규칙 ──
    await check('오늘 바뀐 요소: 사람 많음·행사·너울 12초·이안류 주의·특보·떠밀림 / 결정 2: 지수 단계도 주의·경계(바뀐 요소가 있을 때만), 출처 꼬리표 / 평소 수준+사람만 = 상시 위험', () => {
        const ppl = { ratio: 3, score: 1.5 };
        const k = (x) => { const j = R.landSpot(x, '2026-10-17'); return [j.rank, j.sourceLabel]; };
        assert.deepStrictEqual(k({ band: '매우 높음', index: 100, people: ppl, notices: {} }), [3, "연안 위험지수 100 '매우 높음'"], '지수 100 + 바뀐 요소 → 경계');
        assert.deepStrictEqual(k({ band: '높음', index: 72, people: ppl, notices: {} }), [2, "연안 위험지수 72 '높음'"], '지수 높음 + 바뀐 요소 → 주의');
        assert.deepStrictEqual(k({ band: '다소 높음', index: 40, people: ppl, notices: {} }), [1, "연안 위험지수 40 '다소 높음'"], '다소 높음 + 바뀐 요소 → 관심');
        assert.deepStrictEqual(k({ band: '매우 높음', index: 100, notices: {} }), [0, null], '바뀐 요소가 없으면 지수가 높아도 상시 위험(총평 밖)');
        assert.deepStrictEqual(k({ band: '매우 높음', index: 100, notices: { effective: ['풍랑주의보'] } }), [3, "연안 위험지수 100 '매우 높음'"], '특보(주의보)도 바뀐 요소 — 지수 경계가 더 높으면 지수');
        assert.deepStrictEqual(k({ band: '높음', index: 70, notices: { effective: ['풍랑주의보'] } }), [2, '풍랑주의보'], '같은 단계면 특보 이름이 출처');
        assert.deepStrictEqual(k({ band: '평소 수준', index: 10, released: [{ name: '풍랑주의보', at: at(7) }], notices: {} }), [1, '풍랑주의보 해제 뒤(07:00 해제)'], '결정 4: 해제 뒤 3시간 관심');
        assert.deepStrictEqual(k({ band: '높음', index: 80, released: [{ name: '풍랑주의보', at: at(7) }], notices: {} }), [1, '풍랑주의보 해제 뒤(07:00 해제)'], '해제 뒤는 「오늘 바뀐 요소」로 세지 않음 — 지수 높음이어도 관심');
        assert.equal(R.landSpot({ band: '높음', notices: { effective: ['풍랑주의보'] } }).rank, 2);
        assert.equal(R.landSpot({ band: '평소 수준', notices: { effective: ['강풍경보'] } }).rank, 3);
        assert.equal(R.landSpot({ band: '평소 수준', notices: { prelim: ['풍랑주의보'] } }).rank, 1);
        assert.equal(R.landSpot({ band: '평소 수준', people: { ratio: 1.2, score: 0.2 }, notices: {} }).rank, 0);
        const all = R.landSpot({ band: '다소 높음', people: { ratio: 1.5, score: 0.5 }, event: { name: '협재 축제' }, swell: { periodS: 12 }, rip: { level: '주의' }, notices: { effective: [], prelim: [], windMs: 9 } });
        assert.deepStrictEqual(all.changes.map((c) => c.kind), ['people', 'event', 'swell', 'rip', 'drift']);
        assert.equal(R.landSpot({ band: '다소 높음', swell: { periodS: 11.9 }, rip: { level: '관심' }, notices: {} }).changes.length, 0);
        assert.deepStrictEqual(b.land.cards.map((c) => c.name), ['협재해수욕장', '금능해수욕장']);
        assert.deepStrictEqual(b.land.constant.map((c) => c.name), ['한림항', '판포포구', '한림항 방파제']);
        assert.equal(b.land.constant.find((c) => c.name === '판포포구').changedButLow, true);
        assert.equal(b.land.cards[0].today.text, '사람 평소의 1.8배 · 해안 바람 9m/s(튜브·물놀이기구 떠밀림 주의)');
        assert.deepStrictEqual(b.land.cards.map((c) => [c.word, c.sourceLabel]), [['주의 필요', "연안 위험지수 72 '높음'"], ['관심 필요', "연안 위험지수 41 '다소 높음'"]]);
        assert.deepStrictEqual([b.land.level.word, b.land.level.source], ['주의 필요', "연안 위험지수 72 '높음'"]);
    });
    await check('결정 1 육상 특보 문구도 기상청 시각 그대로 — 발효 「(해제 예고, 발표)」·예비 「(발효 예정, 발표)」, 시각 없으면 이름만', () => {
        const j = R.landSpot({ band: '평소 수준', notices: { effective: ['풍랑주의보'], prelim: ['강풍주의보', '태풍주의보'], detail: [
            { name: '풍랑주의보', state: '발효', issued: { start: '2026-10-16T14:00:00+09:00', end: '2026-10-16T14:00:00+09:00', range: false }, effective: null, release: { start: at(6), end: at(9), range: true } },
            { name: '강풍주의보', state: '예비', issued: null, effective: { start: '2026-10-18T03:00:00+09:00', end: '2026-10-18T03:00:00+09:00', range: false }, release: null }] } }, '2026-10-17');
        assert.deepStrictEqual(j.changes.map((c) => c.text), ['풍랑주의보 발효(06~09시 해제 예고, 10월 16일 14:00 발표)', '강풍주의보 예비특보(10월 18일 03:00 발효 예정)', '태풍주의보 예비특보']);
    });
    await check('전남 19곳(여수바다 포함)은 해상만 — 정리판 97곳에서 셈 · 육상 null · 틀 총평 육상 없음', () => {
        const st = I.loadStations();
        assert.equal(st.length, 97);
        const so = st.filter((s) => s.seaOnly);
        assert.equal(so.length, 19); assert.ok(so.some((s) => s.name === '여수바다파출소'));
        assert.deepStrictEqual([...new Set(so.map((s) => s.office))].sort(), ['목포해양경찰서', '여수해양경찰서', '완도해양경찰서']);
        assert.equal(new Set(st.map((s) => s.key)).size, 97, '열쇠(경찰서|파출소)는 남항 둘도 겹치지 않음');
        const x = R.buildBriefing({ ...hallim(), key: '목포해양경찰서|남항파출소', name: '남항파출소', office: '목포해양경찰서', seaOnly: true, sea: { reviewedCells: 0, regions: [], weather: {}, warnings: [] }, land: null }, WIN, { generatedAt: R.isoKst(T0) });
        assert.equal(x.land, null); assert.equal(x.overview.land, null); assert.equal(x.seaOnly, true);
        assert.equal(x.summary.land, null, '해상만 관할은 육상 총평 없음'); assert.ok(x.summary.sea.headline.includes('관할 해상의 단계는'));
        assert.ok(vo({ land: null, sea: '오늘은 바람이 약합니다.' }, AI.stationInput(x)).ok);
    });
    await check('해망(관광지 0곳)은 위험구역만으로 상시 위험 장소 · 총평 근거에 상시 위험 장소', () => {
        const x = R.buildBriefing({ ...hallim(), key: '군산해양경찰서|해망파출소', name: '해망파출소', office: '군산해양경찰서', sea: { reviewedCells: 12, regions: [], weather: {}, warnings: [] }, places: [], land: { spots: [], hazardOnly: [{ id: '해망-1', place: '해망동 물양장', class: '연안사고 위험구역', shape: '항포구' }, { id: '해망-2', place: '비응항 방파제', class: '사망사고 발생구역', shape: '방파제' }] } }, WIN, { generatedAt: R.isoKst(T0) });
        assert.equal(x.land.cards.length, 0); assert.deepStrictEqual(x.land.constant.map((c) => c.name), ['해망동 물양장', '비응항 방파제']);
        assert.deepStrictEqual(x.summary.land.basis, ['관할 관광지 0곳 — 평소와 달라진 요소(사람·행사·너울·이안류·특보·바람)가 확인되지 않았습니다', '상시 위험 장소: 해망동 물양장·비응항 방파제']);
        assert.equal(x.summary.land.advice, '관할 연안사고에 평소처럼 관심이 필요합니다.');
        const v = vo({ land: '해망동 물양장 주변은 평소와 같습니다.', sea: '바람이 약합니다.' }, AI.stationInput(x)); assert.ok(v.ok, v.errors.join(','));
    });
    await check('조석 문구(서해, 결정 5): 가장 가까운 앵커 곡선 → 「HH:MM 저조 뒤부터 물이 차오릅니다(HH:MM 고조) — …」 + 잠기는 바위 + 게이지 곡선(10분)·전후 물때', () => {
        const curve = Array.from({ length: 1440 }, (_, m) => ({ t: pad(Math.floor(m / 60)) + ':' + pad(m % 60), h: Math.round(300 + 330 * Math.cos((m - 750) / 1440 * 4 * Math.PI)) }));
        const files = { '20261017': { status: 'complete', curve, peaks: { lowTide1: { time: '06:12', height: -12 }, lowTide2: { time: '18:40', height: 20 }, highTide1: { time: '12:30', height: 650 }, highTide2: { time: '00:50', height: 610 } } }, '20261016': { curve, peaks: { lowTide2: { time: '17:55', height: 10 }, highTide2: { time: '23:59', height: 600 } } } };
        const geom = { type: 'Polygon', coordinates: [[[126.0, 36.6], [126.0, 36.75], [126.2, 36.75], [126.2, 36.6], [126.0, 36.6]]] };
        const t = I.collectTide({ lat: 36.674, lon: 126.13 }, '2026-10-17', geom, { anchors: [{ id: 'A9', lat: 36.9, lon: 126.0 }, { id: 'A7', lat: 36.68, lon: 126.14 }], readCurve: (id, ymd) => id === 'A7' ? files[ymd] || null : null, rocks: [{ id: 5, lat: 36.66, lon: 126.12, v: 1.2 }, { id: 6, lat: 37.5, lon: 126.12, v: 1 }], crossings: { '5': ['2026-10-16T22:10:00.000Z', '2026-10-17T09:40:00.000Z'], '6': ['2026-10-16T22:00:00.000Z'] } });
        assert.equal(t.anchorId, 'A7'); assert.equal(t.curve.length, 144); assert.equal(t.prevPeak.t, '23:59'); assert.equal(t.nextPeak, null);
        assert.deepStrictEqual(t.peaks.map((p) => p.type + p.t), ['high00:50', 'low06:12', 'high12:30', 'low18:40']);
        assert.deepStrictEqual(t.rocks, { count: 1, first: '07:10', last: '18:40' });
        const sec = R.tideSection(t, WIN);
        // 문구는 창(아침 판 06~24시)에 걸친 밀물(저조 → 다음 고조)만 — 00:50 고조는 창 앞이라 빠진다(게이지 peaks 에는 그대로). 18:40 저조 뒤 고조는 다음 날 곡선이 없어 시각 없이.
        assert.equal(sec.text[0], '06:12 저조 뒤부터 물이 차오릅니다(12:30 고조) · 18:40 저조 뒤부터 물이 차오릅니다.');
        assert.equal(R.tideSection({ ...t, nextPeak: { type: 'high', t: '00:55', cm: 600 } }, WIN).text[0], '06:12 저조 뒤부터 물이 차오릅니다(12:30 고조) · 18:40 저조 뒤부터 물이 차오릅니다(10월 18일 00:55 고조).', '다음 날 첫 고조는 nextPeak(날짜 붙임)');
        assert.equal(sec.gauge.peaks.length, 4);
        assert.ok(sec.text[1].startsWith('관할 안 잠기는 바위(간출암) 1곳이 07:10~18:40 사이 물에 잠깁니다'));
        // 결정 5: 제주 관할도 — 제주 촘촘 격자 앵커(jeju_isolation) 곡선, 없으면 간출암 앵커(hazard_rocks). 물빠짐 앵커(서해·남해)는 쓰지 않는다.
        const jg = { type: 'Polygon', coordinates: [[[126.15, 33.3], [126.15, 33.5], [126.35, 33.5], [126.35, 33.3], [126.15, 33.3]]] }, seen = [];
        const jt = I.collectTide({ lat: 33.41, lon: 126.26 }, '2026-10-17', jg, { anchors: [{ id: 'A7', lat: 33.41, lon: 126.26 }], jejuAnchors: [{ id: 'J9', lat: 33.6, lon: 126.6 }, { id: 'J1', lat: 33.42, lon: 126.27 }], readCurve: (id, ymd, src) => { seen.push(src + ':' + id); return files[ymd] || null; }, rocks: [], crossings: {} });
        assert.deepStrictEqual([jt.region, jt.anchorSource, jt.anchorId, jt.curve.length], ['jeju', 'jeju', 'J1', 144]); assert.ok(seen.every((x) => x === 'jeju:J1'), seen.join(','));
        assert.ok(R.tideSection(jt, WIN).text[0].startsWith('06:12 저조 뒤부터 물이 차오릅니다(12:30 고조)'), '제주도 서해·남해와 같은 문구');
        const hr = I.collectTide({ lat: 33.41, lon: 126.26 }, '2026-10-17', jg, { jejuAnchors: [], hrAnchors: [{ id: 'H3', lat: 33.40, lon: 126.25 }], readCurve: (id, ymd, src) => src === 'hr' ? files[ymd] || null : null, rocks: [], crossings: {} });
        assert.deepStrictEqual([hr.region, hr.anchorSource, hr.anchorId], ['jeju', 'hr', 'H3'], '제주 격자가 없으면 간출암 앵커');
        assert.equal(I.collectTide({ lat: 37.5, lon: 129.1 }, '2026-10-17', geom, { anchors: [{ id: 'E', lat: 37.5, lon: 129.1 }], jejuAnchors: [], hrAnchors: [], readCurve: () => files['20261017'] }), null, '동해는 없음');
        assert.equal(I.collectTide({ lat: 36.674, lon: 126.13 }, '2026-10-17', geom, { anchors: [{ id: 'A1', lat: 37.2, lon: 126.13 }], readCurve: () => files['20261017'] }), null, '25km 안 앵커가 없으면 없음');
    });

    // ── 수집(가짜 저장소 — 실제 risk_store 응답 모양) ──
    await check('수집·해상: 같은 공식 사고 칸에 든 교통 칸은 한 해역 · 3시간 중 가장 높은 혼잡 · 검토 칸 수 · 특보는 그 관할 구역만', () => {
        const box = (x0, y0, d) => ({ type: 'Polygon', coordinates: [[[x0, y0], [x0, y0 + d], [x0 + d, y0 + d], [x0 + d, y0], [x0, y0]]] });
        const A = { i: 0, id: '9001', lat: 33.425, lon: 126.225, haegu: { major: 232, sub: 2, label: '232-2' }, ref: { name: '화순항', distNm: 13.3, bearingWord: '북북서' }, warnZone: '제주도서부앞바다', warnSubZone: null, geometry: box(126.2, 33.4, 0.05) };
        const ta = { id: 'GR4_a', lon: 126.22, lat: 33.42, haegu: A.haegu, ref: A.ref, warnZone: '제주도서부앞바다' }, tb = { id: 'GR4_b', lon: 126.28, lat: 33.48, haegu: { major: 232, sub: 3, label: '232-3' }, ref: { name: '제주', distNm: 7, bearingWord: '서' }, warnZone: '제주도북부앞바다', warnSubZone: '제주도북부앞바다중연안바다' };
        const wtree = { 남해: { 제주도해상: { 제주도서부앞바다: { current: { wrnTp: 'V', wrnLvl: '주의보', tmFc: '2026년 10월 17일 05시 00분', tmEf: '2026년 10월 17일 06시 00분', clrNtcTm: '18일 오전(09시~12시)' }, upcoming: null, children: {} }, 동해남부앞바다: { current: { wrnTp: 'V', wrnLvl: '경보', tmEf: '2026년 10월 17일 06시 00분' }, upcoming: null, children: {} } } } };
        const risk = { marineInputs: () => ({ accident: { cells: [A], frames: { '202610171500': [[0, 0.5, '주의']] } }, cells: { cells: [ta, tb] }, congestion: { frames: { '202610171500': [{ gridId: 'GR4_a', congestionIndex: 5, congestionLevel: '보통' }], '202610171600': [{ gridId: 'GR4_a', congestionIndex: 12, congestionLevel: '높음' }] } }, warnings: { current: wtree }, sources: { accident: { status: 'ok' }, congestion: { status: 'stale' }, zoneForecasts: { status: 'ok' }, warnings: { status: 'ok' } }, weather: (major, t) => ({ wh: 1, ws: 5, forecastAt: t }) }) };
        const marine = { stationAt: () => ({ id: '0' }), cellHistory: (g, k) => ({ count: k === 'grid:9001' ? 4 : 0 }) };
        const st = [{ key: 'K', idx: '0' }];
        const r = I.collectSea(st, { risk, marine, win: WIN, now: T0 }), s = r.bySt.get('K');
        assert.equal(s.reviewedCells, 3);
        assert.deepStrictEqual(s.regions.map((x) => x.rid).sort(), ['A:9001', 'T:GR4_b']);
        const ra = s.regions.find((x) => x.rid === 'A:9001');
        assert.deepStrictEqual(ra.slots[at(15)], { accident: '주의', congestion: { level: '높음', index: 12, at: at(16) } });
        assert.equal(ra.history.count, 4); assert.equal(ra.gridId, 'GR4_a');
        assert.deepStrictEqual(s.regions.find((x) => x.rid === 'T:GR4_b').zone, { name: '제주도북부앞바다중연안바다', kind: 'sub' });
        assert.deepStrictEqual(s.warnings.map((w) => w.zone + w.level + w.state), ['제주도서부앞바다주의보발효'], '관할 밖 구역(동해남부앞바다) 특보는 빠짐');
        assert.deepStrictEqual(s.warnings[0].release, { start: '2026-10-18T09:00:00+09:00', end: '2026-10-18T12:00:00+09:00', range: true });
        assert.equal(r.sources.congestion, 'stale', '원천 상태를 그대로 넘겨 규칙이 「확인 불가」로 뺀다');
        assert.equal(s.weather[232].rows.length, 6);
    });
    await check('수집·특보 트리: 부모 발효·부모 예비(upcoming)·자식 「예비」를 각각 읽고, 못 읽은 시각은 null', () => {
        const tree = { 남해: { x: { 제주도북부앞바다: { current: { wrnTp: 'V', wrnLvl: '주의보', tmFc: '2026년 10월 17일 05시 00분', tmEf: '2026년 10월 17일 06시 00분', clrNtcTm: '0' }, upcoming: { wrnTp: 'V', wrnLvl: '경보', tmFc: '2026년 10월 17일 05시 00분', tmEf: '17일 밤(21시~24시)' }, children: { '제주도북부앞바다중연안바다': { wrnTp: 'V', wrnLvl: '예비', tmFc: '2026년 10월 17일 05시 00분', tmEf: '17일 오후(15시~18시)' } } } } } };
        const w = I.warningsFromTree(tree, new Set(['제주도북부앞바다', '제주도북부앞바다중연안바다']), T0);
        assert.deepStrictEqual(w.map((x) => [x.zone, x.level, x.state, x.effective && x.effective.start.slice(11, 16), x.release]), [['제주도북부앞바다', '주의보', '발효', '06:00', null], ['제주도북부앞바다', '경보', '예비', '21:00', null], ['제주도북부앞바다중연안바다', '주의보', '예비', '15:00', null]]);
    });
    await check('수집·육상: 연안 하루 값(coastDayDetail 모양)에서 사람·행사·너울·이안류·특보·떠밀림·위험구역·연안사고를 뽑고, 관광지에 붙은 위험구역은 상시 목록에서 뺀다', () => {
        const detail = { t: at(15), index: 72, band: '높음', missing: ['rip'], daily: { peakAt: at(15) },
            rows: [{ key: 'people', ratio: 1.8, score: 0.82, missing: false }, { key: 'hazard', count: 2, byType: [{ class: '사망사고 발생구역', count: 1, score: 0.5 }, { class: '연안사고 위험구역', count: 1 }], zones: [{ id: '한림-1' }, { id: '한림-2' }] }, { key: 'event', name: '협재 축제', weekend: true, events: [{}] }, { key: 'month', month: 10 }, { key: 'swell', periodS: 12.5, score: 0.3 }, { key: 'rip', level: '주의', score: 0.3 }],
            notices: [{ key: 'warning', effective: ['풍랑주의보'], prelim: ['강풍주의보'] }, { key: 'drift', windMs: 9 }],
            history: { available: true, from: '2020-01-01', to: '2024-12-31', accidents: [{ type: '익수' }, { type: '표류' }, { type: '표류' }] } };
        const risk = { coastDayDetail: (id, t) => { if (id === 'bad') throw Object.assign(new Error('관광지 없음'), { status: 404 }); assert.equal(t, at(8)); return detail; } };
        const L = I.collectLand([{ id: 'x', name: '협재해수욕장', lat: 1, lon: 2, beach: true }, { id: 'bad', name: '없는곳' }], [{ id: '한림-1', place: 'a' }, { id: '한림-9', place: '한림항 방파제' }], { risk, t: at(8) });
        const s = L.spots[0];
        assert.deepStrictEqual([s.people, s.event, s.swell, s.rip, s.notices, s.released], [{ ratio: 1.8, score: 0.82 }, { name: '협재 축제', weekend: true }, { periodS: 12.5 }, { level: '주의' }, { effective: ['풍랑주의보'], prelim: ['강풍주의보'], windMs: 9, detail: [] }, []]);
        assert.deepStrictEqual(s.history, { count: 3, from: '2020-01-01', to: '2024-12-31', topTypes: [{ type: '표류', count: 2 }, { type: '익수', count: 1 }] });
        assert.deepStrictEqual(s.hazard, { count: 2, byType: [{ class: '사망사고 발생구역', count: 1 }, { class: '연안사고 위험구역', count: 1 }] });
        assert.deepStrictEqual(L.spots[1].missing, ['detail']);
        assert.deepStrictEqual(L.hazardOnly.map((z) => z.id), ['한림-9']);
        assert.equal(R.landSpot(s).rank, 2, '주의보 발효 → 주의 필요');
    });

    // ── 총평·AI ──
    await check('[§11.10] 총평과 권고 = 서버 결론·근거·권고·물때(summary) — 결론 한 줄 · 지수는 그 장소 줄에 · 해역 3곳 · 권고에 「따라서」 없음 · 틀이면 AI 해설 없음', () => {
        const L = b.summary.land, S = b.summary.sea;
        assert.equal(L.headline, '오늘 한림파출소 관할 연안의 단계는 "주의 필요"입니다.');
        // 2026-10-17 후속(§11.10.1): 예보·예측에서 온 근거는 「예상」, 「사람」 → 「방문객」, 물때는 공용 summary.tide 로(육상 덩어리에서 뺌)
        assert.deepStrictEqual(L.basis, ['관할 관광지 4곳 중 평소보다 위험이 높아진 곳 2곳 (주의 1곳 · 관심 1곳)', '협재해수욕장 — 연안 위험지수 72(높음, 예상), 방문객 평소의 1.8배(예상), 해안 바람 9m/s(예상, 튜브·물놀이기구 떠밀림 주의)', '금능해수욕장 — 연안 위험지수 41(다소 높음, 예상), 방문객 평소의 1.3배(예상)']);
        assert.equal(L.advice, '협재해수욕장·금능해수욕장 주변 연안사고에 주의가 필요합니다.'); assert.equal(L.tide, undefined); assert.deepStrictEqual(b.summary.tide, []);
        assert.equal(S.headline, '오늘 한림파출소 관할 해상의 단계는 "주의 필요"입니다.');
        // §11.10.3: 칸 = 검토한 해역 묶음(고정 자료 3곳 — reviewedCells 52 는 사고 칸·혼잡 칸을 따로 센 값이라 쓰지 않음) · 해구 줄은 기준을 넘을 때만 「…로 높아짐(예상)」
        assert.equal(S.basis[0], '관할 해역 3칸 중 위험이 높아진 해역 3칸');
        assert.equal(S.basis[1], '대해구 232 예보 15시부터 파고 2.4m·풍속 13m/s로 높아짐(예상), 21시부터 기준 아래로 내려감');
        assert.ok(S.basis[2].startsWith('15~24시 비양도 ') && S.basis[2].includes("— 해양사고 위험예보 '주의'(15~21시 예상)·제주도서부앞바다 풍랑주의보 예비특보(발효 예정 시각 이후)(21~24시)"), S.basis[2]);
        assert.ok(S.basis.includes('제주도북부앞바다 풍랑주의보 — 06~09시 해제 예고') && S.basis.includes('제주도서부앞바다 풍랑주의보 예비특보 — 21~24시 발효 예정'), S.basis.join(' / '));
        assert.ok(S.advice.startsWith('15~24시 비양도 ') && S.advice.endsWith('해리 해역 운항에 주의가 필요합니다.') && !/따라서/.test(S.advice + L.advice), S.advice);
        assert.ok(!JSON.stringify(b.summary).includes('관심 이상'), '「관심 이상」 용어를 쓰지 않음');
        assert.deepStrictEqual([b.overview.land, b.overview.sea, b.overview.source], [null, null, 'template'], '틀(AI 없음)이면 해설 없음');
        assert.equal(b.rulesVersion, 'station-briefing-rules-v10'); assert.equal(typeof R.templateOverview, 'undefined', '종전 틀 총평 문단은 없앰');
    });
    const si = AI.stationInput(b);
    // AI 분석 문단 견본(2026-10-17 §11.10.4 — 3~5문장, 마지막 「따라서 … 필요합니다」. 그 전 §11.10 해설은 1~2문장): 허용 숫자·지명·단계만 쓴 글. 아래 검사들이 이것을 조금씩 바꿔 실패를 만든다.
    const good = { land: '협재해수욕장은 사람이 평소의 1.8배로 붐벼 물가 접근에 주의가 필요합니다. 해안 바람 9m/s로 튜브가 떠밀릴 수 있습니다. 따라서 협재해수욕장 주변 연안사고에 주의가 필요합니다.', sea: '15시부터 파고 2.4m로 높아져 15~24시 비양도 주변 해역 운항에 주의가 필요합니다. 21시부터는 제주도서부앞바다 풍랑주의보 예비특보 시각에 들어갑니다. 따라서 비양도 주변 해역 운항에 주의가 필요합니다.' };
    await check('AI 응답 검증: 숫자·N배·지명·단계 말·공식 단계 이름·금지어·문장 수(3~5 — §11.10.4)·마지막 「따라서」·해상만 관할 · 필수 포함 검사 없음', () => {
        const bad = (o, code) => { const v = AI.validateOverview({ ...good, ...o }, si); assert.ok(!v.ok && v.errors.some((e) => e.startsWith(code)), code + ' 기대, 실제 ' + v.errors.join(',')); };
        bad({ sea: good.sea.replace('2.4m', '3.7m') }, 'number:3.7');
        bad({ sea: good.sea + ' 이 해역은 평소보다 사고가 2배 많습니다.' }, 'multiplier');
        bad({ sea: good.sea.replace('비양도', '서귀포항 부근 비양도') }, 'place:서귀포항');
        bad({ sea: good.sea.replace('주의가 필요합니다.', '경계가 필요합니다.') }, 'level:경계');
        bad({ sea: good.sea.replace('들어갑니다.', "들어가고 공식 사고예보가 '경계'입니다.") }, "label:'경계'");
        bad({ land: good.land.replace('물가 접근에', '순찰과 물가 접근에') }, 'forbidden:순찰');
        bad({ land: good.land.replace('있습니다.', '있으나 안전합니다.') }, 'forbidden:안전');
        bad({ sea: '짧습니다. 따라서 관심이 필요합니다.' }, 'shape:sea-sentences-2');
        bad({ sea: '하나. 둘. 셋. 넷. 다섯. 따라서 관심이 필요합니다.' }, 'shape:sea-sentences-6');
        bad({ sea: good.sea.replace('따라서 비양도 주변 해역 운항에 주의가 필요합니다.', '비양도 주변 해역 운항에 주의가 필요합니다.') }, 'shape:sea-no-conclusion');
        bad({ land: null }, 'shape:land-missing');
        const so = { ...si, land: null };
        assert.ok(vo({ sea: good.sea, land: '육상 글입니다.' }, so).errors.includes('shape:land-not-allowed'));
        assert.ok(AI.validateOverview(good, si).ok, AI.validateOverview(good, si).errors.join(','));
        assert.deepStrictEqual(AI.validateOverview({ ...good, sea: '오후에는 바람이 강해집니다. 저녁에는 물결이 높아집니다. 따라서 해상 변화에 관심이 필요합니다.' }, si).errors, [], '첫 해역 이름 없어도 통과(필수 포함 검사 없앰)');
        assert.equal(si.required, undefined); assert.deepStrictEqual([AI.MIN_S, AI.MAX_S, AI.MAX_CHARS], [3, 5, 420]);
        // 배수는 문단별(독립 검토 B3): 해상 = 해제 칸 1.2·1.3, 육상 = 사람 배수 1.8 — 서로 섞이지 않는다.
        assert.deepStrictEqual(si.allowed_multiplier_keys.sea, ['1.2_1.3|배', '1.2|배', '1.3|배'].map((k) => k.replace('_', '~')).sort());
        assert.ok(si.allowed_multiplier_keys.land.includes('1.8|배') && !si.allowed_multiplier_keys.sea.includes('1.8|배') && !si.allowed_multiplier_keys.land.includes('1.2|배'));
        // 2026-10-17 §11.10: 총평 후보가 3곳까지라 모슬포 해역(15시 이후 파고 — 관심)도 후보 → 허용 지명. 후보가 아닌 해역 이름이 빠지는 것은 [결정3]·[A5] 가 본다.
        assert.ok(si.allowed_places.includes(b.sea.overviewTop[2].name) && b.sea.overviewTop[2].name.startsWith('모슬포'), '총평 후보 3곳째 해역 이름도 허용');
    });
    const stationsFor = (n) => Array.from({ length: n }, (_, i) => { const x = hallim(); x.key = (i < 2 ? '제주해양경찰서' : '서귀포해양경찰서') + '|파출소' + i; x.office = i < 2 ? '제주해양경찰서' : '서귀포해양경찰서'; return R.buildBriefing(x, WIN, { generatedAt: R.isoKst(T0) }); });
    const respond = (list, tweak = (o) => o) => JSON.stringify({ stations: list.map((s) => ({ id: s.id, ...tweak({ land: good.land, sea: good.sea }, s.id) })) });
    const idsIn = (prompt) => JSON.parse(prompt.slice(prompt.indexOf('\n{') + 1)).stations;
    const cfg = { method: 'chatgpt', chatgptModel: 'gpt-6-luna', geminiModel: 'gemini-2.5-flash', batchUnit: 'office', onlyChanged: true };
    await check('AI 순서: VM 먼저(해양경찰서별 묶음 2회) → 모델 전달 → 출처 chatgpt', async () => {
        const calls = [];
        const ad = { vm: { available: () => true, call: async ({ prompt, model }) => { calls.push(['vm', model, idsIn(prompt).length]); return '```json\n' + respond(idsIn(prompt)) + '\n```'; } }, gemini: { available: () => true, call: async () => { calls.push(['gemini']); throw new Error('불리면 안 됨'); } } };
        const r = await AI.generate({ briefings: stationsFor(3), config: cfg, adapters: ad, now: T0 });
        assert.deepStrictEqual(calls, [['vm', 'gpt-6-luna', 2], ['vm', 'gpt-6-luna', 1]]);
        assert.ok(Object.values(r.overviews).every((o) => o.source === 'chatgpt' && o.model === 'gpt-6-luna'));
        assert.equal(r.stats.ai, 3);
    });
    await check('AI 순서: VM 꺼짐 → Gemini · Gemini 도 실패 → 틀(오류 기록) · 방식 「틀」이면 호출 없음', async () => {
        const calls = [];
        const ad = { vm: { available: () => false, call: async () => { calls.push('vm'); return ''; } }, gemini: { available: () => true, call: async ({ prompt, model }) => { calls.push('gemini:' + model); return respond(idsIn(prompt)); } } };
        const r = await AI.generate({ briefings: stationsFor(1), config: cfg, adapters: ad, now: T0 });
        assert.deepStrictEqual(calls, ['gemini:gemini-2.5-flash']); assert.equal(Object.values(r.overviews)[0].source, 'gemini');
        assert.ok(r.errors.some((e) => e.provider === 'vm' && e.reason === 'VM 작업자 연결 없음'));
        const calls2 = [];
        const ad2 = { vm: { available: () => true, call: async () => { calls2.push('vm'); throw new Error('codex 시간초과'); } }, gemini: { available: () => true, call: async () => { calls2.push('gemini'); throw new Error('HTTP 503'); } } };
        const r2 = await AI.generate({ briefings: stationsFor(1), config: cfg, adapters: ad2, now: T0 });
        // §11.10.4: VM 최대 3번(여기선 3번 잇달아 실패 → 차단기) → Gemini 한 번 → 규칙 분석(종전 「VM→Gemini 를 1회 더」 ['vm','gemini','vm','gemini'])
        assert.deepStrictEqual(calls2, ['vm', 'vm', 'vm', 'gemini'], 'VM 3번 → Gemini 1번');
        const o = Object.values(r2.overviews)[0]; assert.equal(o.source, 'template'); assert.deepStrictEqual([o.land, o.sea], [null, null], '해설 없음(종전 틀 문단 대체)');
        assert.ok(r2.errors.some((e) => e.stage === 'call' && e.reason === 'codex 시간초과'));
        let n = 0; const r3 = await AI.generate({ briefings: stationsFor(2), config: { ...cfg, method: 'template' }, adapters: { vm: { available: () => true, call: async () => { n++; } } }, now: T0 });
        assert.equal(n, 0); assert.equal(r3.stats.template, 2);
    });
    await check('검증 실패: 그 관할만 VM 으로 다시(§11.10.4 — 최대 3번) → 그래도 실패면 규칙 분석, 다른 관할은 AI 그대로 · 다시 시도 성공이면 AI', async () => {
        let round = 0;
        const ad = { vm: { available: () => true, call: async ({ prompt }) => { round++; return respond(idsIn(prompt), (o, id) => id.endsWith('파출소0') ? { ...o, sea: o.sea + ' 순찰이 필요합니다.' } : o); } } };
        const r = await AI.generate({ briefings: stationsFor(2), config: { ...cfg, batchUnit: 'station' }, adapters: ad, now: T0 });
        assert.equal(round, 4, '관할0 VM 세 번(§11.10.4 — Gemini 어댑터 없음) + 관할1 한 번');
        assert.equal(r.overviews['제주해양경찰서|파출소0'].source, 'template'); assert.equal(r.overviews['제주해양경찰서|파출소1'].source, 'chatgpt');
        assert.ok(r.errors.filter((e) => e.stage === 'validate').length === 3 && r.errors.every((e) => e.stage !== 'validate' || e.reason.includes('forbidden:순찰')));
        let k = 0;
        const ad2 = { vm: { available: () => true, call: async ({ prompt }) => { k++; return respond(idsIn(prompt), (o) => k === 1 ? { ...o, sea: o.sea.replace('2.4m', '9.9m') } : o); } } };
        const r2 = await AI.generate({ briefings: stationsFor(1), config: cfg, adapters: ad2, now: T0 });
        assert.equal(Object.values(r2.overviews)[0].source, 'chatgpt'); assert.equal(r2.stats.retried, 1);
    });
    await check('묶음 단위: 파출소 3회 · 해양경찰서 2회 · 지방청 1회', async () => {
        for (const [unit, want] of [['station', 3], ['office', 2], ['region', 1]]) {
            let n = 0; const ad = { vm: { available: () => true, call: async ({ prompt }) => { n++; return respond(idsIn(prompt)); } } };
            await AI.generate({ briefings: stationsFor(3), config: { ...cfg, batchUnit: unit }, adapters: ad, now: T0 }); assert.equal(n, want, unit);
        }
    });
    await check('입력 해시 재사용: 같은 입력이면 지난 AI 총평 재사용(호출 0) · 한 관할만 바뀌면 그 관할만 · 「바뀐 곳만」 끄면 전부', async () => {
        let n = 0; const ad = { vm: { available: () => true, call: async ({ prompt }) => { n += idsIn(prompt).length; return respond(idsIn(prompt)); } } };
        const first = await AI.generate({ briefings: stationsFor(3), config: cfg, adapters: ad, now: T0 });
        const prev = Object.fromEntries(Object.entries(first.overviews).map(([k, o]) => [k, { overview: o }]));
        n = 0; const again = await AI.generate({ briefings: stationsFor(3), config: cfg, previous: prev, adapters: ad, now: T0 });
        assert.equal(n, 0); assert.equal(again.stats.reused, 3); assert.ok(Object.values(again.overviews).every((o) => o.reused));
        const changed = stationsFor(3); const x = hallim(); x.key = changed[1].key; x.office = '제주해양경찰서'; x.land.spots[0].people.ratio = 2.6;
        changed[1] = R.buildBriefing(x, WIN, { generatedAt: R.isoKst(T0) });
        n = 0; const third = await AI.generate({ briefings: changed, config: cfg, previous: prev, adapters: { vm: { available: () => true, call: async ({ prompt }) => { n += idsIn(prompt).length; return respond(idsIn(prompt), (o, id) => id === changed[1].key ? { ...o, land: o.land.replace('1.8배', '2.6배') } : o); } } }, now: T0 });
        assert.equal(n, 1); assert.equal(third.stats.reused, 2);
        n = 0; await AI.generate({ briefings: stationsFor(3), config: { ...cfg, onlyChanged: false }, previous: prev, adapters: ad, now: T0 }); assert.equal(n, 3);
    });

    // ── 서비스(가짜 시계·저장소) ──
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-')), alerts = path.join(tmp, 'weather_alerts.json');
    let NOW = Date.parse('2026-10-17T07:09:00+09:00');
    const poly = (x0, y0) => ({ type: 'Polygon', coordinates: [[[x0, y0], [x0, y0 + 0.2], [x0 + 0.2, y0 + 0.2], [x0 + 0.2, y0], [x0, y0]]] });
    const fakeStations = [{ key: '제주해양경찰서|한림파출소', idx: '0', name: '한림파출소', office: '제주해양경찰서', region: '제주지방해양경찰청', address: '제주특별자치도 제주시 한림읍 한림해안로 196', geometry: poly(126.1, 33.35), bounds: [126.1, 33.35, 126.3, 33.55], seaOnly: false },
        { key: '제주해양경찰서|애월파출소', idx: '1', name: '애월파출소', office: '제주해양경찰서', region: '제주지방해양경찰청', address: '제주특별자치도 제주시 애월읍 애월해안로 1', geometry: poly(126.3, 33.45), bounds: [126.3, 33.45, 126.5, 33.65], seaOnly: false }];
    const tree = (lvl) => ({ 남해: { 제주도해상: { 제주도서부앞바다: { current: lvl ? { wrnTp: 'V', wrnTpNm: '풍랑', wrnLvl: lvl, tmFc: '2026년 10월 17일 10시 00분', tmEf: '2026년 10월 17일 10시 00분', clrNtcTm: '17일 오후(15시~18시)' } : null, upcoming: null, history: [], children: {} } } } });
    fs.writeFileSync(alerts, JSON.stringify({ current: tree(null) }));
    const cell = { i: 0, id: '9001', lat: 33.44, lon: 126.24, haegu: { major: 232, sub: 2, label: '232-2' }, ref: { name: '화순항', distNm: 13.3, bearingWord: '북북서' }, warnZone: '제주도서부앞바다', warnSubZone: null, geometry: poly(126.22, 33.42) };
    const fakeRisk = { marineInputs: () => ({ accident: { cells: [cell], frames: {} }, cells: { cells: [] }, congestion: null, warnings: I.readJson(alerts), sources: { accident: { status: 'ok' }, congestion: { status: 'ok' }, zoneForecasts: { status: 'ok' }, warnings: { status: 'ok' } }, weather: () => ({ wh: 1, ws: 5, forecastAt: null }) }), spots: () => ({ spots: [] }) };
    const fakeMarine = { stationAt: (p) => (p[0] >= 126.1 && p[0] < 126.3 && p[1] >= 33.35 && p[1] < 33.55 ? { id: '0' } : null), cellHistory: () => ({ count: 0 }) };
    let vmCalls = 0;
    const svc = SB.createService({ dir: path.join(tmp, 'sb'), clock: () => NOW, risk: fakeRisk, marine: fakeMarine, loadStations: () => fakeStations, alertsFile: alerts, hazardFeatures: () => [], kma: () => null, tideDeps: { anchors: [] },
        adapters: { vm: { available: () => true, call: async ({ prompt }) => { vmCalls++; return JSON.stringify({ stations: idsIn(prompt).map((s) => ({ id: s.id, land: null, sea: 'x' })) }); } }, gemini: { available: () => false } } });
    await check('서비스 일정(가짜 시계): 07:09 없음 → 07:10 아침 판(고정 2곳) 만들어 07:30 공개 대기 → 07:30 부터 보임 → 같은 시각 다시 점검해도 한 번만', async () => {
        fs.mkdirSync(path.join(tmp, 'sb'), { recursive: true });
        fs.writeFileSync(path.join(tmp, 'sb', 'state.json'), JSON.stringify({ done: ['2026-10-16|night'] }));
        assert.deepStrictEqual(await svc.tick(), {});
        NOW = Date.parse('2026-10-17T07:10:00+09:00'); const r = await svc.tick();
        assert.equal(r.edition, '2026-10-17|morning');
        const day = I.readJson(path.join(tmp, 'sb', 'briefings_2026-10-17.json'));
        assert.deepStrictEqual(Object.keys(day.pending).sort(), ['제주해양경찰서|애월파출소', '제주해양경찰서|한림파출소'], '공개 시각(07:30) 전이라 대기(§11.10.4)');
        assert.deepStrictEqual(day.stations, {});
        const h = day.pending['제주해양경찰서|한림파출소'];
        assert.equal(h.edition, 'morning'); assert.equal(h.publishAt, '2026-10-17T07:30:00+09:00');
        assert.equal(h.overview.source, 'template', 'VM 응답이 검증에 떨어지면 규칙 분석(VM 3번 — Gemini 없음)');
        assert.ok(svc.status().errors.some((e) => e.stage === 'validate' && e.attempt === 3), '시도 번호 기록');
        assert.equal(h.location.estimated, true, '카카오 없이(시험) 대표 위치 추정');
        assert.deepStrictEqual(svc.pick({ key: '제주해양경찰서|한림파출소', day: 'auto' }), { date: '2026-10-17', briefing: null, fallback: false, nextExpectedAt: '2026-10-17T07:30:00+09:00' });
        NOW = Date.parse('2026-10-17T07:30:00+09:00');
        assert.equal(svc.pick({ key: '제주해양경찰서|한림파출소', day: 'auto' }).briefing.edition, 'morning', '07:30 부터 보임');
        const again = await svc.tick(); assert.equal(again.edition, undefined);
    });
    await check('특보 변경: 처음 서명은 기록만 → 서부앞바다 주의보 발효로 바뀌면 그 구역에 걸친 관할(한림)만 다시 · trigger 기록', async () => {
        NOW = Date.parse(at(10)); vmCalls = 0;
        fs.writeFileSync(alerts, JSON.stringify({ current: tree(null) })); fs.utimesSync(alerts, new Date(), new Date(Date.now() + 1000));
        const first = await svc.tick(); assert.equal(first.warning, undefined, '처음 본 서명은 기록만');
        fs.writeFileSync(alerts, JSON.stringify({ current: tree('주의보') })); fs.utimesSync(alerts, new Date(), new Date(Date.now() + 5000));
        NOW = Date.parse('2026-10-17T10:05:00+09:00');
        // 디바운스(독립 검토 C9): 마지막 변경 뒤 3분 조용할 때 한 번 — 10:05 · 10:07 은 대기, 10:08 에 만든다.
        assert.deepStrictEqual(await svc.tick(), { pending: ['제주도서부앞바다'] });
        NOW = Date.parse('2026-10-17T10:07:00+09:00'); assert.deepStrictEqual(await svc.tick(), { pending: ['제주도서부앞바다'] });
        NOW = Date.parse('2026-10-17T10:08:00+09:00');
        const r = await svc.tick();
        assert.deepStrictEqual(r.warning, ['제주해양경찰서|한림파출소']); assert.deepStrictEqual(r.zones, ['제주도서부앞바다']);
        const day = I.readJson(path.join(tmp, 'sb', 'briefings_2026-10-17.json')), h = day.stations['제주해양경찰서|한림파출소'];
        assert.equal(h.edition, 'warning'); assert.deepStrictEqual(h.trigger, { kind: 'warning', zones: ['제주도서부앞바다'] }); assert.equal(h.window.from, at(9));
        assert.equal(day.stations['제주해양경찰서|애월파출소'].edition, 'morning', '걸치지 않은 관할은 그대로');
        assert.ok(h.sea.cards[0] && h.sea.cards[0].word === '주의 필요' && h.special.some((x) => x.kind === 'release'), JSON.stringify(h.special));
        const same = await svc.tick(); assert.equal(same.warning, undefined, '같은 파일이면 다시 만들지 않음');
    });
    await check('보여 줄 판(pick): 20:59 오늘 · 21:30 내일 판 없으면 오늘 판 + 23:00 예고 · 23:00 밤 판 뒤 내일', async () => {
        NOW = Date.parse('2026-10-17T20:59:00+09:00');
        let p = svc.pick({ key: '제주해양경찰서|한림파출소', day: 'auto' }); assert.equal(p.date, '2026-10-17'); assert.equal(p.fallback, false);
        NOW = Date.parse('2026-10-17T21:30:00+09:00');
        p = svc.pick({ key: '제주해양경찰서|한림파출소', day: 'auto' });
        assert.equal(p.date, '2026-10-17'); assert.equal(p.fallback, true); assert.equal(p.wanted, '2026-10-18'); assert.equal(p.nextExpectedAt, '2026-10-17T23:00:00+09:00');
        NOW = Date.parse(at(23)); fs.writeFileSync(path.join(tmp, 'sb', 'state.json'), JSON.stringify({ ...svc._state(), done: ['2026-10-17|morning', '2026-10-17|evening'] }));
        const r = await svc.tick(); assert.equal(r.edition, '2026-10-17|night');
        p = svc.pick({ key: '제주해양경찰서|한림파출소', day: 'auto' }); assert.equal(p.date, '2026-10-18'); assert.equal(p.briefing.edition, 'night'); assert.equal(p.briefing.window.from, at(21));
        assert.ok(p.briefing.summary.sea.headline.startsWith('내일 한림파출소 관할 해상의 단계는'), p.briefing.summary.sea.headline);
    });
    await check('설정: 기본값(관리자에게만·VM·해양경찰서 묶음·바뀐 곳만) · 선택지 밖 값 400 · ChatGPT 모델 목록 = codex_bridge 목록에서 gemini 뺀 것', () => {
        assert.deepStrictEqual(svc.readConfig(), { method: 'chatgpt', chatgptModel: 'gpt-6-luna', geminiModel: 'gemini-2.5-flash', exposure: 'admin', batchUnit: 'office', onlyChanged: true });
        assert.equal(svc.writeConfig({ exposure: 'user', batchUnit: 'region' }).exposure, 'user');
        assert.throws(() => svc.writeConfig({ method: 'claude' }), /설정값 오류/);
        svc.writeConfig({ exposure: 'admin', batchUnit: 'office' });
        assert.deepStrictEqual(SB.CHOICES.chatgptModel, require('../services/codex_bridge').ANSWER_MODELS.filter((m) => m !== 'gemini'));
    });
    await check('대표 위치: 가짜 카카오 성공은 저장·재사용, 일치 없음은 추정(같은 주소면 다시 안 물음), 호출 고장은 다음에 다시', async () => {
        const f = path.join(tmp, 'loc.json'); let asked = [];
        const geo = async (a) => { asked.push(a); if (a.includes('한림')) return { lat: 33.41, lon: 126.26, resolvedAddress: a }; if (a.includes('애월')) throw new Error('unmatched event'); throw new Error('HTTP 500'); };
        const st3 = fakeStations.concat([{ ...fakeStations[0], key: 'X|고장파출소', address: '제주특별자치도 제주시 어딘가로 1' }]);
        let L = await I.ensureLocations({ stations: st3, landPoints: { '제주해양경찰서|애월파출소': [{ lat: 33.46, lon: 126.31 }, { lat: 33.47, lon: 126.33 }] }, file: f, geocoder: geo, now: T0 });
        assert.equal(L['제주해양경찰서|한림파출소'].source, 'kakao'); assert.equal(L['제주해양경찰서|애월파출소'].estimated, true); assert.equal(L['제주해양경찰서|애월파출소'].method, '관할 관광지·위험구역 중심 평균(2점)');
        assert.equal(L['X|고장파출소'].method, '관할 해역 상자 중심(바다)');
        asked = []; L = await I.ensureLocations({ stations: st3, file: f, geocoder: geo, now: T0 });
        assert.deepStrictEqual(asked, ['제주특별자치도 제주시 어딘가로 1'], '고장(error)만 다시 묻는다');
        const saved = I.readJson(f); assert.equal(saved.stations['X|고장파출소'].reason, 'HTTP 500'); assert.ok(!JSON.stringify(saved).includes('KakaoAK'));
    });
    await check('카카오 호출 모양(가짜 fetch): 행사 위치 찾기와 같은 주소·키 헤더 · 정리된 주소로 질의', async () => {
        let seen = null;
        const fetchImpl = async (url, opt) => { seen = { url: String(url), auth: opt.headers.Authorization }; return { ok: true, json: async () => ({ documents: [{ road_address_name: '강원특별자치도 속초시 청호대교로 97', x: '128.59', y: '38.20' }] }) }; };
        const g = await I.geocodeStation('강 원 특 별 자 치 도 속초시 청호대교 로 97', { fetchImpl, key: 'TESTKEY' });
        assert.equal(g.lat, 38.2); assert.ok(seen.url.startsWith('https://dapi.kakao.com/v2/local/search/keyword.json?query=')); assert.equal(new URL(seen.url).searchParams.get('query'), '강원특별자치도 속초시 청호대교로 97'); assert.equal(seen.auth, 'KakaoAK TESTKEY');
    });

    // ── 노출(라우터, 임시 포트) ──
    await check('노출 판정: 관리자에게만(기본) — 일반 요청 내용 없음 · 등록 기기·관리자 토큰이면 내용 · 사용자에게 · 노출 안 함', async () => {
        const express = require('express'), { createRouter } = require('../routes/station_briefing');
        let exposure = 'admin';
        const fake = { readConfig: () => ({ exposure }), stations: () => fakeStations, stationList: () => fakeStations.map((s) => ({ key: s.key })), stationAreas: () => [{ key: 'k', seas: ['제주'], geometry: null }], pick: () => ({ date: '2026-10-17', briefing: { key: 'k' }, fallback: false }), status: () => ({ config: { exposure }, choices: SB.CHOICES }), writeConfig: (b) => { if (b.exposure === 'x') throw Object.assign(new Error('설정값 오류: exposure'), { status: 400 }); return b; }, run: async () => ({ ok: true }) };
        const app = express(); app.use(createRouter({ service: fake, isAdminDevice: (id) => id === 'fcm-admin-1', verifyToken: (t) => t === 'tok-ok', authorize: (req, res, next) => req.get('X-Admin-Token') === 'tok-ok' ? next() : res.status(401).json({ ok: false }) }));
        const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
        const base = 'http://127.0.0.1:' + server.address().port, q = '/api/station-briefing?station=' + encodeURIComponent('제주해양경찰서|한림파출소');
        try {
            const get = async (u, h = {}) => { const r = await fetch(base + u, { headers: h }); return { status: r.status, body: await r.json() }; };
            let r = await get(q); assert.equal(r.body.display, false); assert.equal(r.body.briefing, null); assert.equal(r.body.audience, 'admin');
            r = await get('/api/station-briefing/stations'); assert.deepStrictEqual(r.body.stations, []);
            r = await get('/api/station-briefing/areas'); assert.deepStrictEqual([r.body.display, r.body.areas], [false, []], '관할 구역도 같은 노출 판정');
            r = await get('/api/station-briefing/areas', { 'X-Admin-Device': 'fcm-admin-1' }); assert.deepStrictEqual([r.body.display, r.body.areas.length], [true, 1]);
            r = await get(q, { 'X-Admin-Device': 'fcm-admin-1' }); assert.equal(r.body.display, true); assert.deepStrictEqual(r.body.briefing, { key: 'k' });
            r = await get(q + '&adminToken=fcm-admin-1'); assert.equal(r.body.display, true, '특보 예측과 같은 쿼리 이름');
            r = await get(q, { 'X-Admin-Device': 'other' }); assert.equal(r.body.display, false);
            r = await get(q, { 'X-Admin-Token': 'tok-ok' }); assert.equal(r.body.display, true, 'PC 관리자 토큰');
            r = await get('/api/station-briefing?station=없는관할', { 'X-Admin-Token': 'tok-ok' }); assert.equal(r.status, 404);
            exposure = 'user'; r = await get(q); assert.equal(r.body.display, true);
            exposure = 'off'; r = await get(q, { 'X-Admin-Device': 'fcm-admin-1', 'X-Admin-Token': 'tok-ok' }); assert.equal(r.body.display, false); assert.equal(r.body.briefing, null);
            r = await get('/api/admin/station-briefing/config'); assert.equal(r.status, 401);
            r = await get('/api/admin/station-briefing/config', { 'X-Admin-Token': 'tok-ok' }); assert.equal(r.status, 200); assert.ok(r.body.choices.exposure.includes('user'));
            const put = await fetch(base + '/api/admin/station-briefing/config', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'tok-ok' }, body: JSON.stringify({ exposure: 'x' }) }); assert.equal(put.status, 400);
            const run = await fetch(base + '/api/admin/station-briefing/run', { method: 'POST', headers: { 'X-Admin-Token': 'tok-ok' } }); assert.equal(run.status, 202);
        } finally { server.close(); }
    });
    await check('서버 시작 부작용 없음: start() 는 FLY_ALLOC_ID 없으면 false · require 만으로 타이머·파일 쓰기 없음', () => {
        const had = process.env.FLY_ALLOC_ID; delete process.env.FLY_ALLOC_ID;
        try { assert.equal(svc.start(), false); } finally { if (had) process.env.FLY_ALLOC_ID = had; }
    });
    // ── 독립 검토 3건(규칙·AI·운영, 2026-10-16) 회귀 — 결함마다 1:1. 재현 스크립트: scratchpad review_rules·review_ai·review_ops ──
    const seaOnlyInput = (sea, sources = { accident: 'ok', congestion: 'ok', zoneForecasts: 'ok', warnings: 'ok' }) => ({ key: 'k|테스트파출소', name: '테스트파출소', office: 'o', seaOnly: true, sources, sea: { reviewedCells: 1, regions: [], weather: {}, warnings: [], ...sea }, places: [], land: null, tide: null });
    const region = (i, slots, extra = {}) => ({ rid: 'A:' + i, lat: 33 + i * 0.01, lon: 126, haegu: { major: 232, sub: 1, label: '232-1' }, ref: { name: '제주', distNm: 3, bearingWord: '북' }, zone: null, zones: [], slots, history: { count: 0 }, ...extra });
    await check('[A1] 육상 특보·떠밀림은 그날 칸 전부(daily.notices) — 가장 높은 칸 밖 18~21시 풍랑경보·바람 11m/s 도 「경계 필요」', () => {
        const fake = { coastDayDetail: (id, t) => ({ t, index: 60, band: '높음', rows: [], notices: [], daily: { peakAt: at(12), notices: [{ key: 'warning', name: '풍랑경보', state: '발효', from: at(18), to: at(21) }, { key: 'warning', name: '강풍주의보', state: '예비', from: at(21), to: at(21) }, { key: 'drift', windMs: 9, from: at(9), to: at(9) }, { key: 'drift', windMs: 11, from: at(15), to: at(18) }] }, history: { available: false }, missing: [] }) };
        const L = I.collectLand([{ id: 's1', name: '가나해수욕장', lat: 1, lon: 1, beach: true }], [], { risk: fake, t: at(8) });
        assert.deepStrictEqual(L.spots[0].notices, { effective: ['풍랑경보'], prelim: ['강풍주의보'], windMs: 11, detail: [{ name: '풍랑경보', state: '발효', issued: null, effective: null, release: null }, { name: '강풍주의보', state: '예비', issued: null, effective: null, release: null }] });
        const j = R.landSpot(L.spots[0]); assert.equal(j.rank, 3); assert.equal(j.sourceLabel, '풍랑경보');
    });
    await check('[A2] 결측과 0 구분: 원천이 낡거나 없으면 「평소 수준」·「겹치는 해역은 없습니다」 대신 「확인 불가」 + 총평 근거에 빠진 원천(§11.10 — AI 해설의 빠진 원천 필수 검사는 없앰)', () => {
        const all = R.buildBriefing(seaOnlyInput({ reviewedCells: 5 }, { accident: 'missing', congestion: 'missing', zoneForecasts: 'missing', warnings: 'missing' }), WIN, { generatedAt: R.isoKst(T0) });
        assert.equal(all.sea.level.word, '확인 불가'); assert.equal(all.sea.overviewLevel.word, '확인 불가'); assert.ok(all.sea.timeBar.every((s) => s.word === '확인 불가'));
        assert.equal(all.summary.sea.headline, '오늘 테스트파출소 관할 해상의 단계는 "확인 불가"입니다.');
        assert.ok(all.summary.sea.basis.includes('확인하지 못한 자료: 해양사고 위험예보·혼잡 예보·해구 예보·기상특보 — 그 근거는 판단에서 뺐습니다'), all.summary.sea.basis.join(' / '));
        assert.ok(all.summary.sea.basis[0].includes('확인된 자료 기준'), all.summary.sea.basis[0]);
        assert.ok(!JSON.stringify(all.summary).includes('평소 수준') && !JSON.stringify(all.summary).includes('겹치는 해역은 없습니다'));
        assert.equal(all.summary.sea.advice, '출항 전 기상청 특보·예보를 직접 확인하는 데 관심이 필요합니다.');
        const part = R.buildBriefing(seaOnlyInput({}, { accident: 'ok', congestion: 'stale', zoneForecasts: 'ok', warnings: 'ok' }), WIN, { generatedAt: R.isoKst(T0) });
        assert.equal(part.sea.level.word, '확인 불가(일부)'); assert.deepStrictEqual(part.sea.missing, ['congestion']);
        const si2 = AI.stationInput(part); assert.deepStrictEqual(si2.sea.missing_sources, ['혼잡 예보']);
        assert.ok(part.summary.sea.basis.includes('확인하지 못한 자료: 혼잡 예보 — 그 근거는 판단에서 뺐습니다'), part.summary.sea.basis.join(' / '));
        assert.deepStrictEqual(vo({ land: null, sea: '바람이 약합니다.' }, si2).errors, [], '빠진 원천은 서버 근거가 밝힌다 — 해설에 필수 아님');
        const fine = R.buildBriefing(seaOnlyInput({}), WIN, { generatedAt: R.isoKst(T0) }); assert.equal(fine.sea.level.word, '평소 수준', '원천이 모두 ok 이고 근거가 없으면 평소 수준');
    });
    await check('[A3] 특보 원천이 ok 가 아니면(낡음) 해제 예고·예비 칸·시간 막대 사건을 만들지 않는다', () => {
        const w = [{ zone: 'Z앞바다', type: '풍랑', level: '주의보', state: '발효', effective: null, release: { start: at(9), end: at(12), range: true } }, { zone: 'Z앞바다', type: '풍랑', level: '경보', state: '예비', effective: { start: at(18), end: at(21), range: true }, release: null }];
        const stale = R.buildBriefing(seaOnlyInput({ warnings: w }, { accident: 'ok', congestion: 'ok', zoneForecasts: 'ok', warnings: 'stale' }), WIN, { generatedAt: R.isoKst(T0) });
        assert.deepStrictEqual(stale.special, []); assert.ok(stale.sea.timeBar.every((s) => !s.events.length)); assert.ok(!stale.summary.sea.basis.some((x) => x.includes('해제 예고')));
        const ok = R.buildBriefing(seaOnlyInput({ warnings: w }), WIN, { generatedAt: R.isoKst(T0) }); assert.equal(ok.special.length, 2, '원천이 ok 면 그대로');
    });
    await check('[A4] 해제 예고·예비 범위가 창 시작 전에 시작해도 창과 겹치면 넣는다(17:30 판 12~18시 · 23시 판 18~24시), 사건은 첫 칸에', () => {
        const ev = R.editionWindow('evening', Date.parse('2026-10-17T17:30:00+09:00'));
        const r1 = R.warningEvents([{ zone: 'Z', type: '풍랑', level: '주의보', state: '발효', effective: null, release: { start: at(12), end: at(18), range: true } }], ev);
        assert.equal(r1.special.length, 1); assert.equal(r1.special[0].title, 'Z 풍랑주의보 — 12~18시 해제 예고'); assert.equal(r1.events[0].at, at(15));
        const ng = R.editionWindow('night', Date.parse(at(23)));
        const r2 = R.warningEvents([{ zone: 'Z', type: '풍랑', level: '주의보', state: '발효', effective: null, release: { start: at(18), end: '2026-10-18T00:00:00+09:00', range: true } }, { zone: 'Y', type: '풍랑', level: '경보', state: '예비', effective: { start: at(18), end: '2026-10-18T03:00:00+09:00', range: true }, release: null }], ng);
        assert.deepStrictEqual(r2.special.map((x) => x.kind), ['release', 'prewarn']); assert.equal(r2.special[0].title, 'Z 풍랑주의보 — 10월 17일 18~24시 해제 예고');
        const gone = R.warningEvents([{ zone: 'Z', type: '풍랑', level: '주의보', state: '발효', effective: null, release: { start: at(9), end: at(12), range: true } }], ev);
        assert.equal(gone.special.length, 0, '창 앞에서 끝난 해제 예고는 없음');
    });
    await check('[A5] 해역 카드 10개 상한 밖의 해역이 총평 근거여도 사라지지 않는다 — 총평 후보는 총평 단계 순위에서 바로, 단계 말과 총평 문장이 맞는다', () => {
        const regions = []; for (let i = 0; i < 11; i++) { const s = {}; for (const h of [6, 9, 12, 15, 18, 21]) s[at(h)] = { accident: '주의' }; regions.push(region(i, s)); }
        regions.push(region(99, { [at(15)]: { accident: '주의', congestion: { level: '높음', index: 12, at: at(15) } } }));
        const x = R.buildBriefing(seaOnlyInput({ reviewedCells: 12, regions }), WIN, { generatedAt: R.isoKst(T0) });
        assert.equal(x.sea.cards.length, 10); assert.ok(!x.sea.cards.some((c) => c.rid === 'A:99'), '카드 순위(지속 칸)로는 10개 밖');
        assert.deepStrictEqual(x.sea.overviewTop.map((c) => c.rid), ['A:99']); assert.equal(x.sea.overviewLevel.word, '주의 필요');
        assert.equal(x.summary.sea.headline, '오늘 테스트파출소 관할 해상의 단계는 "주의 필요"입니다.'); assert.ok(x.summary.sea.advice.startsWith('15~18시 ') && !x.summary.sea.advice.includes('시경'), x.summary.sea.advice);
    });
    await check('[A6] 끊긴 시간대를 하나로 잇지 않는다: 06시·21시 경계 → 카드 창·오늘 예상·총평 창 모두 「06~09시·21~24시」, peakAt 06시', () => {
        // 2026-10-16 결정 3(「경계」도 기상·혼잡이 겹칠 때만 총평)으로 두 칸에 혼잡 '높음'을 겹쳐 총평 창도 보이게 했다.
        const cg = { level: '높음', index: 12 };
        const x = R.buildBriefing(seaOnlyInput({ regions: [region(1, { [at(6)]: { accident: '경계', congestion: cg }, [at(21)]: { accident: '경계', congestion: cg } })] }), WIN, { generatedAt: R.isoKst(T0) });
        const c = x.sea.cards[0];
        assert.equal(c.window, '06~09시·21~24시'); assert.equal(c.peakAt, at(6));
        assert.deepStrictEqual(c.today.lines, ["06~09시·21~24시 해양사고 위험예보 '경계'", "06~09시·21~24시 혼잡 예보 '높음'(혼잡지수 12) → 충돌·접촉 주의"]);
        assert.equal(c.overview.window, '06~09시·21~24시'); assert.equal(c.overview.label, "해양사고 위험예보 '경계'(06~09시·21~24시)");
        assert.equal(R.runsText([at(15), at(18)], '2026-10-17'), '15~21시');
    });
    await check('[결정3] 「경계」 거르기(2026-10-16 *"모두 추천대로."*): 공식 사고예보 「경계」만 있는 칸도 총평 단계 0 — 기상·혼잡이 겹친 칸만 총평에, 해역 카드·시간 막대는 그대로 경계 · AI 검증 상한도 총평 단계', () => {
        const ok = { accident: true, congestion: true, zoneForecasts: true, warnings: true }, s = Date.parse(at(9)), e = s + 3 * 3600000;
        const only = R.slotOf({ accident: '경계' }, s, e, ok);
        assert.equal(only.rank, 3); assert.equal(only.overviewRank, 0); assert.deepStrictEqual(only.overviewSources, []);
        assert.equal(R.slotOf({ accident: '경계', congestion: { level: '높음', index: 12 } }, s, e, ok).overviewRank, 3, '혼잡이 겹치면 총평 경계');
        assert.equal(R.slotOf({ accident: '경계', ws: 12 }, s, e, ok).overviewRank, 3, '해구 풍속이 겹치면 총평 경계');
        const wz = { zone: 'Z', type: '풍랑', level: '주의보', state: '발효', effective: { start: at(0), end: at(0), range: false }, release: null };
        const withWarn = R.slotOf({ accident: '경계', warnings: [wz] }, s, e, ok);
        assert.equal(withWarn.overviewRank, 3, '특보가 겹치면 총평 경계'); assert.equal(withWarn.overviewSources[0].kind, 'accident');
        assert.equal(R.slotOf({ accident: '경계', congestion: { level: '높음', index: 12 } }, s, e, { ...ok, congestion: false }).overviewRank, 0, '낡은 혼잡은 겹침 근거가 아님');
        // 브리핑 전체: 09시 경계만(A:1) · 15시 경계+혼잡(A:2) · 거른 칸도 카드·시간 막대에는 경계
        const cg = { level: '높음', index: 12, at: at(15) };
        const x = R.buildBriefing(seaOnlyInput({ reviewedCells: 2, regions: [region(1, { [at(9)]: { accident: '경계' } }, { ref: { name: '모슬포', distNm: 3, bearingWord: '남' } }), region(2, { [at(15)]: { accident: '경계', congestion: cg } })] }), WIN, { generatedAt: R.isoKst(T0) });
        const c1 = x.sea.cards.find((c) => c.rid === 'A:1'), c2 = x.sea.cards.find((c) => c.rid === 'A:2');
        assert.equal(c1.rank, 3); assert.equal(c1.word, '경계 필요'); assert.equal(c1.overviewRank, 0); assert.equal(c1.overview, null);
        assert.equal(c2.overviewRank, 3); assert.equal(x.sea.level.rank, 3); assert.equal(x.sea.overviewLevel.rank, 3);
        assert.deepStrictEqual(x.sea.overviewTop.map((c) => c.rid), ['A:2']);
        assert.equal(x.sea.timeBar.find((q) => q.at === at(9)).rank, 3, '거른 칸도 시간 막대에는 경계');
        assert.ok(!JSON.stringify(x.summary).includes(c1.name), '순위만 경계인 해역은 총평 근거에 없음');
        const lone = R.buildBriefing(seaOnlyInput({ reviewedCells: 1, regions: [region(1, { [at(9)]: { accident: '경계' } })] }), WIN, { generatedAt: R.isoKst(T0) });
        assert.equal(lone.sea.level.word, '경계 필요'); assert.equal(lone.sea.overviewLevel.rank, 0); assert.deepStrictEqual(lone.sea.overviewTop, []);
        const sl = AI.stationInput(lone);
        assert.ok(Object.values(sl.levels.sea).every((r) => r < 3), JSON.stringify(sl.levels.sea));
        assert.ok(lone.summary.sea.basis.includes("해양사고 위험예보만 '경계'인 해역 1칸"), lone.summary.sea.basis.join(' / '));
        // 2026-10-16: AI 입력 시간 흐름(timeline)도 총평용 단계 — 거른 「경계」가 AI 에 보이면 그대로 써서 틀로 떨어지므로
        assert.equal(lone.sea.timeBar.find((q) => q.at === at(9)).overviewRank, 0); assert.ok(!JSON.stringify(sl.sea.timeline || []).includes('경계 필요'), JSON.stringify(sl.sea.timeline));
        assert.ok(!JSON.stringify(lone.summary).includes('순위만으로'), '총평은 「순위」로 단정하지 않음(순위식인지 미확인)');
        assert.deepStrictEqual(vo({ land: null, sea: '출항 전 기상 확인에 관심이 필요합니다.' }, sl).errors, []);
        const up = vo({ land: null, sea: '출항 전 기상 확인에 경계가 필요합니다.' }, sl);
        assert.ok(up.errors.some((er) => er.startsWith('level:경계')), 'AI 가 거른 「경계」를 총평에 쓰면 검증 실패 — ' + up.errors.join(','));
    });
    await check('[A8] 특보 변경 판이 내일 판을 고칠 때 21시 전이면 내일 0시부터(오늘 칸 섞지 않음) · 21시부터는 night 판과 같은 「오늘 밤~내일」', () => {
        const w = R.editionWindow('warning', Date.parse('2026-10-17T13:10:00+09:00'), '2026-10-18');
        assert.equal(w.from, '2026-10-18T00:00:00+09:00'); assert.equal(w.slots.length, 8); assert.ok(w.slots.every((s) => s.startsWith('2026-10-18')));
        assert.equal(R.editionWindow('warning', Date.parse('2026-10-17T23:10:00+09:00'), '2026-10-18').from, at(21));
        assert.equal(R.editionWindow('warning', Date.parse('2026-10-17T13:10:00+09:00'), '2026-10-17').from, at(12), '오늘 판은 그대로 지금 칸부터');
    });
    await check('[낮음] 조석 문구는 창 안의 고조·저조만 — 17:30 판은 15시 뒤, 23시 판은 전날 곡선의 오늘 밤(날짜 붙임)도', () => {
        const tide = { anchorId: 'A', distKm: 1, date: '2026-10-17', curve: [], peaks: [{ type: 'low', t: '06:12', cm: 0 }, { type: 'high', t: '12:30', cm: 600 }, { type: 'low', t: '18:40', cm: 0 }], rocks: null };
        assert.deepStrictEqual(R.tideSection(tide, R.editionWindow('evening', Date.parse('2026-10-17T17:30:00+09:00'))).text, ['18:40 저조 뒤부터 물이 차오릅니다.'], '06:12→12:30 밀물은 창(15시~) 앞에서 끝나 뺀다');
        const night = { ...tide, date: '2026-10-18', peaks: [{ type: 'high', t: '01:10', cm: 600 }, { type: 'low', t: '07:20', cm: 0 }], prevDayPeaks: [{ type: 'low', t: '18:40', cm: 0 }, { type: 'high', t: '22:50', cm: 610 }] };
        assert.equal(R.tideSection(night, R.editionWindow('night', Date.parse(at(23)))).text[0], '10월 17일 18:40 저조 뒤부터 물이 차오릅니다(10월 17일 22:50 고조) · 07:20 저조 뒤부터 물이 차오릅니다.', '창(21시~) 앞 저조라도 밀물이 창에 걸치면(22:50 고조) 넣는다');
        const files = { '20261018': { curve: [{ t: '00:00', h: 1 }], peaks: { lowTide1: { time: '07:20', height: 0 } } }, '20261017': { curve: [], peaks: { highTide2: { time: '22:50', height: 610 }, lowTide2: { time: '18:40', height: 0 } } } };
        const t = I.collectTide({ lat: 36.674, lon: 126.13 }, '2026-10-18', { type: 'Polygon', coordinates: [[[126, 36.6], [126, 36.7], [126.2, 36.7], [126.2, 36.6], [126, 36.6]]] }, { anchors: [{ id: 'A7', lat: 36.68, lon: 126.14 }], readCurve: (id, ymd) => files[ymd] || null, rocks: [], crossings: {} });
        assert.deepStrictEqual(t.prevDayPeaks.map((p) => p.t), ['18:40', '22:50']);
    });
    await check('[낮음] 육상 「관심」 근거 이름은 판정 이유와 맞게 — 평소 수준 지수 + 사람 + 예비특보면 근거는 예비특보', () => {
        const j = R.landSpot({ band: '평소 수준', people: { ratio: 1.2, score: 0.2 }, notices: { prelim: ['풍랑주의보'] } });
        assert.equal(j.rank, 1); assert.equal(j.sourceLabel, '풍랑주의보 예비특보');
        assert.equal(R.landSpot({ band: '다소 높음', index: 45, people: { ratio: 1.8, score: 0.8 }, notices: { prelim: ['풍랑주의보'] } }).sourceLabel, "연안 위험지수 45 '다소 높음'", '지수가 평소 위면 지수(결정 2 출처 꼬리표 — 종전 「첫 바뀐 요소」)');
    });
    await check('[낮음] 선박사고 「기록 없음」(0건)과 「이력 자료 없음」(집계 불가)을 가른다', () => {
        const mk = (history) => R.buildBriefing(seaOnlyInput({ regions: [region(1, { [at(9)]: { accident: '경계' } }, { history })] }), WIN, { generatedAt: R.isoKst(T0) }).sea.cards[0].traits;
        const none = mk({ count: 0, available: false, from: '2021-01-01', to: '2025-12-31' }); assert.ok(none.text.startsWith('선박사고 이력 자료 없음(집계 불가)'), none.text); assert.deepStrictEqual(none.history, { count: 0, available: false });
        const zero = mk({ count: 0, available: true, from: '2021-01-01', to: '2025-12-31' }); assert.ok(zero.text.startsWith('2021~2025년 선박사고 기록 없음'), zero.text); assert.equal(zero.history.available, true);
        assert.ok(mk(null).text.startsWith('선박사고 이력 자료 없음'));
    });
    await check('[낮음] 해역 이름 거리 0 가드: 기준점과 거의 같은 자리면 방위·0.0해리 대신 「○○ 인근 해역」', () => {
        assert.equal(R.regionName({ lat: 33.4067, lon: 126.2275, ref: { name: '화순항', distNm: 13.3, bearingWord: '북' }, haegu: { label: '232-2' } }, [{ name: '비양도', lat: 33.4067, lon: 126.2275 }]).name, '비양도 인근 해역(232-2해구)');
        assert.equal(R.regionName({ lat: 33.4, lon: 126.2, ref: { name: '한림항', distNm: 0, bearingWord: '북' }, haegu: { label: '232-2' } }, []).name, '한림항 인근 해역(232-2해구)');
    });
    await check('[낮음] 공식 사고예보 프레임이 빠진 칸은 「사고예보 없음」이 아니라 확인 불가 — sea.frameGaps → missing·missingSlots, 그 칸 근거 안 씀', () => {
        const box = { type: 'Polygon', coordinates: [[[126.2, 33.4], [126.2, 33.45], [126.25, 33.45], [126.25, 33.4], [126.2, 33.4]]] };
        const A = { i: 0, id: '9001', lat: 33.425, lon: 126.225, haegu: { major: 232, sub: 2, label: '232-2' }, ref: { name: '화순항', distNm: 13.3, bearingWord: '북북서' }, warnZone: null, warnSubZone: null, geometry: box };
        const frames = Object.fromEntries(WIN.slots.filter((s) => s !== at(21)).map((s) => [I.forecastKey(s), [[0, 0.1, '보통']]]));
        const risk = { marineInputs: () => ({ accident: { cells: [A], frames }, cells: { cells: [] }, congestion: null, warnings: null, sources: { accident: { status: 'ok' }, congestion: { status: 'ok' }, zoneForecasts: { status: 'ok' }, warnings: { status: 'ok' } }, weather: () => ({}) }) };
        const s = I.collectSea([{ key: 'K', idx: '0' }], { risk, marine: { stationAt: () => ({ id: '0' }), cellHistory: () => ({ count: 0 }) }, win: WIN, now: T0 }).bySt.get('K');
        assert.deepStrictEqual(s.frameGaps, { accident: [at(21)] });
        const x = R.buildBriefing(seaOnlyInput({ regions: [region(1, { [at(21)]: { accident: '경계' }, [at(9)]: { accident: '주의' } })], frameGaps: { accident: [at(21)] } }), WIN, { generatedAt: R.isoKst(T0) });
        assert.equal(x.sea.level.rank, 2, '빠진 칸(21시)의 값은 쓰지 않음'); assert.deepStrictEqual(x.sea.missing, ['accident']); assert.deepStrictEqual(x.sea.missingSlots, { accident: [at(21)] });
    });
    await check('[낮음] 검토한 관광지 수는 상세를 받은 곳만(실패 detail 은 빼고 failedSpots 로)', () => {
        const x = R.buildBriefing({ ...hallim(), land: { spots: hallim().land.spots.concat([{ id: 'bad', name: '없는곳', missing: ['detail'] }]), hazardOnly: [] } }, WIN, { generatedAt: R.isoKst(T0) });
        assert.equal(x.land.reviewedSpots, 4); assert.equal(x.land.failedSpots, 1); assert.ok(x.land.missing.includes('detail'));
        assert.ok(x.summary.land.basis[0].startsWith('관할 관광지 4곳 중') && x.summary.land.basis.includes('확인하지 못한 자료: 관광지 상세'), x.summary.land.basis.join(' / '));
    });
    // ── AI 검증(B) ──
    // 멈춘 약속을 시험이 영원히 기다리지 않게(고치기 전 코드는 시간 제한이 없어 여기서 멈췄다) — 실제 시계와 무관한 상한.
    const within = (p, ms, what) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(what + ' — ' + ms + 'ms 안에 끝나지 않음')), ms); })]).finally(() => clearTimeout(t)); };
    const sea0 = (mid) => '비양도 해역에서 ' + mid + ' 15시부터 파고가 높아져 비양도 해역에 주의가 필요합니다.';   // 해설 2문장(§11.10)
    const vErr = (sea, land = good.land) => vo({ land, sea }, si).errors;
    await check('[B1] 숫자는 「숫자+단위」·범위째 대조 — 3m·7m/s·10m·24척·11건·15m·12~15m/s 는 막고, 서버 문장 꼴은 통과', () => {
        for (const [mid, code] of [['파고 3m 풍속 7m/s 가 예상됩니다.', 'number:3m'], ['파고 10m 가 예상됩니다.', 'number:10m'], ['선박 24척 입니다.', 'number:24척'], ['최근 사고 11건 입니다.', 'number:11건'], ['파고 15m 가 예상됩니다.', 'number:15m'], ['풍속 12~15m/s 가 예상됩니다.', 'number:12~15m/s'], ['가능성 70% 입니다.', 'number:70%']]) assert.ok(vErr(sea0(mid)).includes(code), mid + ' → ' + vErr(sea0(mid)).join(','));
        assert.deepStrictEqual(vErr(sea0('대해구 232 예보는 파고 2.4m·풍속 13m/s 입니다.')), [], '서버 문장에 있는 숫자+단위');
        assert.ok(si.allowed_numbers.includes('2.4m') && si.allowed_numbers.includes('15~24시'));
    });
    await check('[B2] NFKC(전각 숫자)·한글 수사 차단 — ９９m · 구 미터 · 서른 미터 · 오후 세 시 · 두 척', () => {
        assert.ok(vErr(sea0('파고 ９９m 가 예상됩니다.')).includes('number:99m'));
        const h = vErr(sea0('파고 구 미터, 풍속 서른 미터 가 예상되고 오후 세 시에 선박 두 척이 있습니다.'));
        for (const c of ['number:hangul:구 미터', 'number:hangul:서른 미터', 'number:hangul:세 시', 'number:hangul:두 척']) assert.ok(h.includes(c), c + ' / ' + h.join(','));
        assert.deepStrictEqual(vErr(sea0('바람이 이 시각부터 셉니다.')), [], '「이 시각」은 수사가 아님');
    });
    await check('[B3] 해상 문단은 「사고 N배」·「두 배」 금지(해제 칸 1.2·1.3 만) — 육상 사람 배수(1.8)는 육상 문단에서만', () => {
        assert.ok(vErr(sea0('해상 사고 1.8배 입니다.')).includes('multiplier:1.8배'));
        assert.ok(vErr(sea0('사고가 두 배 늘 수 있습니다.')).includes('multiplier:두 배'));
        assert.deepStrictEqual(vErr(sea0('해제 뒤 이틀 동안 사고가 약 1.2~1.3배 많았습니다.')), []);
        assert.ok(vErr(good.sea, good.land.replace('1.8배', '1.2배')).includes('multiplier:1.2배'), '해제 배수는 육상 문단에 못 씀');
    });
    await check('[B4] 단계 말은 모든 서술 꼴(경계가 요구·경계하십시오·주의 단계) · 대상 이름 없는 문장은 그 문단 최저 단계까지', () => {
        const base = '비양도 해역에서 15시부터 파고가 높아집니다. ';
        for (const t of ['따라서 비양도 해역에 경계가 요구됩니다.', '따라서 비양도 해역에서는 경계하십시오.', '비양도 해역은 경계 단계입니다.']) assert.ok(vErr(base + t).includes('level:경계>2'), t + ' / ' + vErr(base + t).join(','));
        // 2026-10-17: 총평 후보에 관심(1) 해역(모슬포)이 들어 문단 최저가 1 — 이름 없는 문장의 「경계」는 그 최저를 넘는다.
        assert.ok(vErr(base + '따라서 이 해역에 경계가 필요합니다.').includes('level:경계>1'), vErr(base + '따라서 이 해역에 경계가 필요합니다.').join(','));
        // 문단 안 대상 단계가 2·1 로 갈리면 이름 없는 문장은 최저(1)까지 — 예전에는 문단 단계(2)까지 허용했다.
        const si1 = { ...si, levels: { ...si.levels, sea: { ...si.levels.sea, '한림항 북동방 5.2해리 해역(232-3해구)': 1, 한림항: 1 } } };
        const e1 = vo({ land: good.land, sea: base + '따라서 이 해역에 주의가 필요합니다.' }, si1).errors;
        assert.ok(e1.includes('level:주의>1'), '이름 없는 문장 — 문단 최저(관심)까지 / ' + e1.join(','));
        assert.deepStrictEqual(vErr(base + '따라서 비양도 해역에 주의가 필요합니다.'), []);
        assert.deepStrictEqual(si.levels.sea['한림파출소'], 2); assert.equal(si.levels.land['한림파출소'], 2, '문단별 단계(육상 = 협재 지수 72 높음 → 주의, 결정 2)');
    });
    await check('[B5] 지명: 갯바위·섬·도·포 등 접미사·띄어쓰기도 대조, 부분 일치는 허용 이름이 글 쪽에 포함될 때만(「림항」 조각 금지)', () => {
        for (const [mid, code] of [['차귀도 앞 갯바위 주변이 위험합니다.', 'place:차귀도'], ['제주도 동쪽 앞바다 에 풍랑이 있습니다.', 'place:제주도동쪽앞바다'], ['림항 이 위험합니다.', 'place:림항'], ['한림해수욕장 이 위험합니다.', 'place:한림해수욕장'], ['가로림만에서 물결이 높습니다.', 'place:가로림만']]) assert.ok(vErr(sea0(mid)).includes(code), mid + ' → ' + vErr(sea0(mid)).join(','));
        assert.deepStrictEqual(vErr(sea0('제주도 서부 앞바다 와 한림 파출소 관할에서 바람도 셉니다.')), [], '띄어 쓴 허용 이름·조사 「도」');
        // 기상청 해역 이름(제주도동부앞바다)은 2026-10-17 부터 허용(§11.10) — 같은 날 독립 검토 8 로 그 관할에 관련된 이름(기상청 전망 발췌·(기상) 칸에 나온 것)만
        assert.deepStrictEqual(vo({ land: good.land, sea: sea0('제주도 동부 앞바다 에 풍랑이 있습니다.') }, AI.stationInput(b, { excerpt: { 해상: '제주도동부앞바다에 물결이 높게 일겠습니다.' } })).errors, [], '전망 발췌에 있는 기상청 해역 이름');
        assert.ok(vErr(sea0('제주도 동부 앞바다 에 풍랑이 있습니다.')).includes('place:제주도동부앞바다'), '관련 글에 없는 기상청 해역 이름은 실패');
        assert.deepStrictEqual(vErr(sea0('정도의 차이는 있으나 운항 중 바람이 셉니다.')), []);
    });
    await check('[B6] 금지어는 공백·제로폭을 지우고 대조 · 「경비정 투입」 같은 직무 지시 · 안전 단정(안전한 상태·위험 요소가 없·이상 없·문제없)', () => {
        assert.ok(vErr(sea0('해경이 순 찰 해야 합니다.')).includes('forbidden:순찰'));
        assert.ok(vErr(sea0('해경이 순​찰 해야 합니다.')).includes('forbidden:순찰'));
        assert.ok(vErr(sea0('경비정 투입이 필요합니다.')).includes('forbidden:경비정'));
        for (const t of ['비양도 상태는 안전한 상태입니다.', '위험 요소가 전혀 없습니다.', '이상 없습니다.', '문제없습니다.']) assert.ok(vErr(sea0(t)).includes('forbidden:안전 단정'), t);
        assert.deepStrictEqual(vErr(sea0('특별한 위험 요소는 확인되지 않았습니다.')), [], '§10.3 허용 문구');
    });
    await check('[B13] AI 글에 HTML·URL 금지', () => {
        assert.ok(vErr(sea0('<script>alert(1)</script> 입니다.')).includes('markup'));
        assert.ok(vErr(sea0('자세한 내용은 http://evil.example/x 입니다.')).includes('markup'));
    });
    await check('[B7] 호출 시간 제한(멈춘 VM → 시간초과 → Gemini) · 실행 데드라인(남은 관할 틀) · VM 연속 실패 차단기(3회 뒤 건너뜀)', async () => {
        let aborted = false;
        const hang = { available: () => true, call: ({ signal }) => new Promise(() => { signal.addEventListener('abort', () => { aborted = true; }); }) };
        const gem = { available: () => true, call: async ({ prompt }) => respond(idsIn(prompt)) };
        const r = await within(AI.generate({ briefings: stationsFor(1), config: cfg, adapters: { vm: hang, gemini: gem }, now: T0, timeouts: { vm: 30, gemini: 1000 } }), 3000, '멈춘 VM');
        assert.equal(Object.values(r.overviews)[0].source, 'gemini'); assert.ok(aborted, 'signal 로 끊기 요청'); assert.ok(r.errors.some((e) => e.provider === 'vm' && /시간초과/.test(e.reason)));
        let fake = 0; const slowGem = { available: () => true, call: async ({ prompt }) => { fake += 60000; return respond(idsIn(prompt)); } };
        const r2 = await AI.generate({ briefings: stationsFor(3), config: { ...cfg, method: 'gemini', batchUnit: 'station' }, adapters: { gemini: slowGem }, now: T0, timer: () => fake, deadline: 60000 });
        assert.equal(r2.stats.ai, 1); assert.equal(r2.stats.deadline, 2); assert.ok(r2.errors.some((e) => e.stage === 'deadline'));
        let vmN = 0; const boom = { available: () => true, call: async () => { vmN++; throw new Error('codex 시간초과'); } };
        const r3 = await AI.generate({ briefings: stationsFor(4), config: { ...cfg, batchUnit: 'station' }, adapters: { vm: boom, gemini: gem }, now: T0 });
        assert.equal(vmN, 3, '연속 3번 실패 뒤 VM 을 부르지 않음'); assert.ok(r3.errors.some((e) => /VM 연속 실패 3회/.test(e.reason))); assert.ok(Object.values(r3.overviews).every((o) => o.source === 'gemini'));
    });
    await check('[B7] 실제 Gemini 어댑터: config.abortSignal 을 넘기고, signal 이 끊기면 응답 없이도 곧 실패(gemini_client 는 그대로)', async () => {
        const G = require('../services/gemini_client'), orig = G.callGeminiRaw; let seen = null;
        G.callGeminiRaw = (o) => { seen = o.config; return new Promise(() => {}); };
        try {
            const ac = new AbortController(), p = SB.realAdapters().gemini.call({ prompt: 'x', model: 'gemini-2.5-flash', signal: ac.signal });
            ac.abort(); await assert.rejects(within(p, 3000, 'Gemini 어댑터'), /Gemini 시간초과/); assert.equal(seen.abortSignal, ac.signal); assert.equal(seen.responseMimeType, 'application/json');
        } finally { G.callGeminiRaw = orig; }
        assert.equal(SB.GEMINI_CALL_MS, 90000);
    });
    await check('[B10] 재사용 해시에 검증·지시문 판·Gemini 모델 포함 · 지난 글이 Gemini 산인데 VM 이 살아 있으면 다시 만든다(VM 꺼져 있으면 재사용)', async () => {
        const gemOnly = { vm: { available: () => false }, gemini: { available: () => true, call: async ({ prompt }) => respond(idsIn(prompt)) } };
        const first = await AI.generate({ briefings: stationsFor(1), config: cfg, adapters: gemOnly, now: T0 });
        const prev = Object.fromEntries(Object.entries(first.overviews).map(([k, o]) => [k, { overview: o }])); assert.equal(Object.values(prev)[0].overview.source, 'gemini');
        let n = 0; const vmUp = { vm: { available: () => true, call: async ({ prompt }) => { n++; return respond(idsIn(prompt)); } }, gemini: gemOnly.gemini };
        const back = await AI.generate({ briefings: stationsFor(1), config: cfg, previous: prev, adapters: vmUp, now: T0 });
        assert.equal(n, 1); assert.equal(back.stats.reused, 0); assert.equal(Object.values(back.overviews)[0].source, 'chatgpt');
        const still = await AI.generate({ briefings: stationsFor(1), config: cfg, previous: prev, adapters: gemOnly, now: T0 }); assert.equal(still.stats.reused, 1, 'VM 이 여전히 꺼져 있으면 재사용');
        const lite = await AI.generate({ briefings: stationsFor(1), config: { ...cfg, geminiModel: 'gemini-2.5-flash-lite' }, previous: prev, adapters: gemOnly, now: T0 }); assert.equal(lite.stats.reused, 0, 'Gemini 모델이 바뀌면 다시');
        assert.ok(AI.VALIDATOR_VERSION && AI.PROMPT_VERSION);
    });
    await check('[B11·B12] 관리자 실행 중이면 POST /run 409(실제 상태) · 설정 PUT 의 __proto__·constructor·모르는 칸은 400', async () => {
        const express = require('express'), { createRouter } = require('../routes/station_briefing');
        let running = true, ran = 0;
        const fake = { readConfig: () => ({ exposure: 'admin' }), stations: () => fakeStations, status: () => ({ running, lastRun: { at: 'x' }, config: {}, choices: SB.CHOICES }), run: async () => { ran++; return { ok: true }; }, writeConfig: (b) => svc.writeConfig(b) };
        const app = express(); app.use(createRouter({ service: fake, isAdminDevice: () => false, verifyToken: () => false, authorize: (q, s, n) => n() }));
        const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port;
        try {
            let r = await fetch(base + '/api/admin/station-briefing/run', { method: 'POST' }); assert.equal(r.status, 409); const j = await r.json(); assert.equal(j.running, true); assert.equal(ran, 0);
            running = false; r = await fetch(base + '/api/admin/station-briefing/run', { method: 'POST' }); assert.equal(r.status, 202); assert.equal(ran, 1);
            for (const body of ['{"__proto__":{"exposure":"user"}}', '{"constructor":"x"}', '{"nope":1}']) { r = await fetch(base + '/api/admin/station-briefing/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body }); assert.equal(r.status, 400, body); }
            assert.equal(svc.readConfig().exposure, 'admin');
        } finally { server.close(); }
    });
    // ── 운영(C)·실행(B9) ──
    await check('[B9·ops1] 실행이 던지면 실패 시각·횟수를 남기고 10분 백오프, 같은 판은 3번까지 — 매분 다시 모으고 AI 를 부르지 않는다', async () => {
        const d = fs.mkdtempSync(path.join(tmp, 'fail-')); let clock = Date.parse(at(8)), gathers = 0, ai = 0;
        const s2 = SB.createService({ dir: d, clock: () => clock, risk: { spots: () => { gathers++; throw new Error('ENOSPC'); }, marineInputs: () => ({}) }, marine: fakeMarine, loadStations: () => fakeStations, alertsFile: path.join(d, 'none.json'), hazardFeatures: () => [], kma: () => null, adapters: { vm: { available: () => true, call: async () => { ai++; return '{}'; } } } });
        fs.writeFileSync(path.join(d, 'state.json'), JSON.stringify({ done: ['2026-10-16|night'] }));
        assert.deepStrictEqual(await s2.tick(), { failed: '2026-10-17|morning' });
        for (let m = 1; m < 10; m++) { clock = Date.parse(at(8)) + m * 60000; assert.deepStrictEqual(await s2.tick(), { backoff: '2026-10-17|morning' }); }
        assert.equal(gathers, 1);
        clock = Date.parse(at(8)) + 10 * 60000; await s2.tick(); clock += 10 * 60000; await s2.tick(); assert.equal(gathers, 3);
        clock += 60 * 60000; assert.deepStrictEqual(await s2.tick(), { backoff: '2026-10-17|morning' }, '3번 실패 뒤엔 멈춤'); assert.equal(gathers, 3); assert.equal(ai, 0);
        const st = s2.status(); assert.equal(st.failures['2026-10-17|morning'].count, 3); assert.ok(st.errors.some((e) => e.stage === 'run' && /ENOSPC/.test(e.reason)));
    });
    await check('[C2] 위치 찾기가 오래 걸려도 연안 하루 값 시각은 모으기 직전 시각(6분 늦어져도 risk_store 400 없음) · 위치 찾기 전체 상한·한 건 시간초과', async () => {
        const d = fs.mkdtempSync(path.join(tmp, 'late-')); let clock = Date.parse(at(8)); const asked = [];
        const spot = { id: 'sp1', name: '협재해수욕장', lat: 33.39, lon: 126.24, police: { name: '한림파출소' } };
        const risk = { ...fakeRisk, spots: () => ({ spots: [spot] }), coastDayDetail: (id, t) => { asked.push(t); if (Date.parse(t) < clock - 5 * 60000) throw Object.assign(new Error('잘못된 예보 시각'), { status: 400 }); return { t, index: 10, band: '평소 수준', rows: [], notices: [], daily: { peakAt: t, notices: [] }, history: { available: false }, missing: [] }; } };
        const s2 = SB.createService({ dir: d, clock: () => clock, risk, marine: fakeMarine, loadStations: () => fakeStations, alertsFile: path.join(d, 'none.json'), hazardFeatures: () => [], kma: () => null, tideDeps: { anchors: [] }, adapters: { vm: { available: () => false }, gemini: { available: () => false } },
            geocoder: async () => { clock += 6 * 60000; throw new Error('HTTP 500'); } });
        await s2.run({ kind: 'morning' });
        assert.equal(asked.length, 1); assert.equal(asked[0], R.isoKst(clock), '모으기 직전 시각');
        const day = I.readJson(path.join(d, 'briefings_2026-10-17.json')); assert.equal(day.stations['제주해양경찰서|한림파출소'].land.reviewedSpots, 1);
        let t = 0; const n = []; const L = await I.ensureLocations({ stations: fakeStations.concat([{ ...fakeStations[0], key: 'X|셋째' }]), file: path.join(d, 'loc2.json'), geocoder: async (a) => { n.push(a); t += 40000; return { lat: 1, lon: 2 }; }, now: T0, timer: () => t, budgetMs: 60000 });
        assert.equal(n.length, 2, '전체 60초 상한 — 셋째는 이번엔 묻지 않음'); assert.equal(L['X|셋째'].geocode, 'not_tried');
        const L2 = await I.ensureLocations({ stations: [fakeStations[0]], file: path.join(d, 'loc3.json'), geocoder: () => new Promise(() => {}), now: T0, callMs: 20 });
        assert.equal(L2[fakeStations[0].key].estimated, true); assert.equal(I.readJson(path.join(d, 'loc3.json')).stations[fakeStations[0].key].reason, 'timeout');
    });
    await check('[C4] 주소 정리: 깨진 6곳·성산(서귀포시)·울릉(경상북도)을 고치고 원문은 address_raw — 97곳 모두 카카오 대조 키가 만들어진다', () => {
        const st = I.loadStations(), byName = (n, o) => st.find((s) => s.name === n && (!o || s.office === o));
        const want = { 구룡포파출소: '호미로 210', 대산파출소: '삼길포1로 84', 고창파출소: '구시포해변길 51-129', 광양파출소: '항만9로 89', 통영파출소: '통영해안로 200', 성산파출소: '서귀포시 성산읍', 울릉파출소: '경상북도 울릉군' };
        for (const [n, frag] of Object.entries(want)) assert.ok(byName(n).address.includes(frag), n + ' ' + byName(n).address);
        assert.ok(byName('남항파출소', '부산해양경찰서').address.includes('해안새벽시장길 91')); // 2026-10-16 웹 확인으로 도로명 「해양→해안」 정정(station_addresses.md)
        const g = JSON.parse(fs.readFileSync(path.join(I.CONFIG, 'coastguard_stations.geojson'), 'utf8')), fixed = g.features.filter((f) => f.properties.address_raw);
        assert.equal(fixed.length, 26); // 1차 8곳 + 웹 확인 표기 정정 10곳 + 사용자 직접 확인 8곳(2026-10-16, 당진은 별표와 같아 원문 없음) assert.ok(fixed.every((f) => f.properties.address_fix && f.properties.address_raw !== f.properties.address));
        assert.equal(fixed.find((f) => f.properties.name === '울릉파출소').properties.address_raw, '강 원 특 별 자 치 도 울릉군 울릉읍 울릉순환 로 179');
        const { addressKey } = require('../services/coastal_events_collector');
        assert.equal(st.filter((s) => addressKey(I.normalizeAddress(s.address))).length, 97);
        assert.equal(addressKey(I.normalizeAddress(byName('구룡포파출소').address)), '경북|포항시/남구|road|구룡포읍/호미로|210', '카카오 도로명(「호미로」)과 같은 키');
    });
    await check('[C4] 「일치 없음」 캐시는 주소나 정리된 질의가 바뀌면 다시 묻는다 · 카카오 영구 오류(키 없음)는 그 자리에서 멈추고 6시간 묻지 않으며 로그는 한 줄', async () => {
        const d = fs.mkdtempSync(path.join(tmp, 'geo-')), f = path.join(d, 'loc.json');
        I.writeJson(f, { v: 1, stations: { [fakeStations[0].key]: { status: 'unmatched', address: fakeStations[0].address, query: '옛 정리 꼴', reason: 'unmatched event' } } });
        let asked = []; await I.ensureLocations({ stations: [fakeStations[0]], file: f, geocoder: async (a) => { asked.push(a); throw new Error('unmatched event'); }, now: T0 });
        assert.equal(asked.length, 1, '질의가 바뀌어 다시 물음');
        asked = []; await I.ensureLocations({ stations: [fakeStations[0]], file: f, geocoder: async (a) => { asked.push(a); throw new Error('unmatched event'); }, now: T0 }); assert.equal(asked.length, 0, '같은 질의면 다시 안 물음');
        const warns = [], ow = console.warn; console.warn = (m) => warns.push(String(m));
        try {
            const many = Array.from({ length: 5 }, (_, i) => ({ ...fakeStations[1], key: 'K|' + i, name: '파출소' + i, address: '제주특별자치도 제주시 어딘가로 ' + i }));
            const g2 = path.join(d, 'g2.json'); let n = 0; const keyless = async () => { n++; throw new Error('missing key'); };
            await I.ensureLocations({ stations: many, file: g2, geocoder: keyless, now: T0 }); assert.equal(n, 1, '키 없음이면 첫 곳에서 멈춤'); assert.equal(warns.length, 1, '로그 한 줄');
            assert.equal(I.readJson(g2).backoff.reason, 'missing key');
            await I.ensureLocations({ stations: many, file: g2, geocoder: keyless, now: T0 + 3600000 }); assert.equal(n, 1, '6시간 안에는 묻지 않음');
            await I.ensureLocations({ stations: many, file: g2, geocoder: keyless, now: T0 + 7 * 3600000 }); assert.equal(n, 2, '6시간 뒤 다시');
        } finally { console.warn = ow; }
    });
    await check('[C5] 브리핑용 과거 사고 집계(cellHistory)는 사고 목록을 만들지 않고 시트용 큰 캐시(historyCache)를 채우지 않는다', () => {
        const M = require('../services/marine_fusion'), geom = { type: 'Polygon', coordinates: [[[126.5, 33.5], [126.6, 33.5], [126.6, 33.6], [126.5, 33.6], [126.5, 33.5]]] };
        const rowA = (type, ymd) => [33.5625, 126.5375, ymd, '1300', '해역', type, null, null, null, 0, 0, 0, [], null, null, null];
        const m = M.createStore({ risk: { marineInputs: () => ({}), sources: () => ({}) }, dir: fs.mkdtempSync(path.join(tmp, 'mf-')), clock: () => T0, stations: [{ properties: { name: '제주파출소' }, geometry: geom }], accidents: [rowA('ATY027', '20250101'), rowA('ATY028', '20240101')], describe: (r) => ({ id: String(r.gridId) }) });
        const h = m.cellHistory(geom, 'grid:1');
        assert.equal(h.count, 2); assert.equal(h.accidents, undefined); assert.deepStrictEqual(m.cacheSizes(), { history: 0, cellSummary: 1 });
        m.cellHistory(geom, 'grid:1'); assert.deepStrictEqual(m.cacheSizes(), { history: 0, cellSummary: 1 }, '같은 칸은 작은 캐시에서');
    });
    await check('[C6] 날짜 파일 캐시는 오늘·내일만(최대 2) — 다른 날짜는 읽기만', () => {
        const d = fs.mkdtempSync(path.join(tmp, 'day-')); const s2 = SB.createService({ dir: d, clock: () => T0, risk: fakeRisk, marine: fakeMarine, loadStations: () => fakeStations });
        for (const dt of ['2026-10-16', '2026-10-17', '2026-10-18']) I.writeJson(path.join(d, 'briefings_' + dt + '.json'), { date: dt, stations: {} });
        assert.equal(s2._readDay('2026-10-16').date, '2026-10-16'); assert.equal(s2._fileCacheSize(), 0);
        s2._readDay('2026-10-17'); s2._readDay('2026-10-18'); s2._readDay('2026-10-16'); assert.equal(s2._fileCacheSize(), 2);
    });
    await check('[C9] 쓰기 실패 때 .tmp 잔재 없음 · 1시간 지난 .tmp 는 정리 · 개발 환경에서는 실제 AI 어댑터를 부르지 않고 틀(STATION_BRIEFING_DEV_AI=1 일 때만)', async () => {
        const d = fs.mkdtempSync(path.join(tmp, 'tmp-')), f = path.join(d, 'a.json'), orig = fs.renameSync;
        fs.renameSync = () => { throw new Error('ENOSPC'); };
        try { assert.throws(() => I.writeJson(f, { a: 1 }), /ENOSPC/); } finally { fs.renameSync = orig; }
        assert.deepStrictEqual(fs.readdirSync(d), []);
        const old = path.join(d, 'briefings_2026-10-17.json.99999.tmp'); fs.writeFileSync(old, 'x'); fs.utimesSync(old, new Date(Date.now() - 2 * 3600000), new Date(Date.now() - 2 * 3600000));
        const hadFly = process.env.FLY_ALLOC_ID, hadDev = process.env.STATION_BRIEFING_DEV_AI; delete process.env.FLY_ALLOC_ID; delete process.env.STATION_BRIEFING_DEV_AI;
        try {
            const s2 = SB.createService({ dir: d, clock: () => T0, risk: fakeRisk, marine: fakeMarine, loadStations: () => fakeStations, alertsFile: path.join(d, 'none.json'), hazardFeatures: () => [], kma: () => null, tideDeps: { anchors: [] } });
            const r = await s2.run({ kind: 'manual' }); assert.equal(r.ok, true);
            assert.ok(!fs.existsSync(old), '오래된 임시 파일 정리');
            const day = I.readJson(path.join(d, 'briefings_2026-10-17.json')); assert.equal(day.stations['제주해양경찰서|한림파출소'].overview.source, 'template');
            assert.ok(/개발 환경/.test(s2.status().lastRun.aiDisabled));
        } finally { if (hadFly) process.env.FLY_ALLOC_ID = hadFly; if (hadDev) process.env.STATION_BRIEFING_DEV_AI = hadDev; }
    });
    await check('[C9] 특보 변경 디바운스: 같은 내용을 다시 써서 파일 시각만 바뀌면 대기를 늘리지 않고, 계속 바뀌어도 첫 변경 뒤 15분이면 만든다', async () => {
        const d = fs.mkdtempSync(path.join(tmp, 'deb-')), af = path.join(d, 'alerts.json'); let clock = Date.parse(at(10)), stamp = Date.now();
        const put = (lvl) => { fs.writeFileSync(af, JSON.stringify({ current: tree(lvl) })); stamp += 1000; fs.utimesSync(af, new Date(stamp), new Date(stamp)); };
        fs.mkdirSync(d, { recursive: true }); I.writeJson(path.join(d, 'briefings_2026-10-17.json'), { date: '2026-10-17', stations: {} });
        I.writeJson(path.join(d, 'state.json'), { done: ['2026-10-17|morning'], warnSig: SB.warnSignatures(tree(null)), stationZones: { '제주해양경찰서|한림파출소': ['제주도서부앞바다'] } });
        const s2 = SB.createService({ dir: d, clock: () => clock, risk: fakeRisk, marine: fakeMarine, loadStations: () => fakeStations, alertsFile: af, hazardFeatures: () => [], kma: () => null, tideDeps: { anchors: [] }, adapters: { vm: { available: () => false }, gemini: { available: () => false } } });
        put('주의보'); assert.deepStrictEqual(await s2.tick(), { pending: ['제주도서부앞바다'] });
        clock += 2 * 60000; put('주의보'); assert.deepStrictEqual(await s2.tick(), { pending: ['제주도서부앞바다'] }, '같은 내용 다시 쓰기');
        clock += 60000; const r = await s2.tick(); assert.deepStrictEqual(r.warning, ['제주해양경찰서|한림파출소'], '첫 변경 뒤 3분(다시 쓰기로 늘지 않음)');
        let fired = null; const t0 = clock;
        // 마지막으로 만든 상태(주의보)와 다른 두 상태(경보 ↔ 해제)를 2분마다 오간다 — 대기는 계속 늘지만 첫 변경(1분째) 뒤 15분인 16분째에 만든다.
        for (let m = 1; m <= 20 && !fired; m++) { clock = t0 + m * 60000; if (m % 2) put(m % 4 === 1 ? '경보' : null); const x = await s2.tick(); if (x.warning) fired = m; }
        assert.equal(fired, 16, '첫 변경 1분째 + 15분 → ' + fired);
    });
    await check('[B9] 특보 변경 판도 같게: 실행이 던지면 10분 백오프, 3번 실패하면 그 서명을 받아들이고 멈춘다(매분 재실행 없음)', async () => {
        const d = fs.mkdtempSync(path.join(tmp, 'wfail-')), af = path.join(d, 'alerts.json'); let clock = Date.parse(at(10)), gathers = 0;
        fs.writeFileSync(af, JSON.stringify({ current: tree('경보') }));
        I.writeJson(path.join(d, 'state.json'), { done: ['2026-10-17|morning'], warnSig: SB.warnSignatures(tree(null)), stationZones: { '제주해양경찰서|한림파출소': ['제주도서부앞바다'] } });
        const s2 = SB.createService({ dir: d, clock: () => clock, risk: { spots: () => { gathers++; throw new Error('ENOSPC'); } }, marine: fakeMarine, loadStations: () => fakeStations, alertsFile: af, hazardFeatures: () => [], kma: () => null });
        assert.deepStrictEqual(await s2.tick(), { pending: ['제주도서부앞바다'] });
        clock += 3 * 60000; assert.deepStrictEqual(await s2.tick(), { failed: 'warning' });
        clock += 60000; assert.deepStrictEqual(await s2.tick(), { backoff: 'warning' }); assert.equal(gathers, 1);
        clock += 10 * 60000; await s2.tick(); clock += 10 * 60000; await s2.tick(); assert.equal(gathers, 3);
        clock += 10 * 60000; assert.deepStrictEqual(await s2.tick(), { warningGaveUp: ['제주도서부앞바다'] }); assert.equal(gathers, 3);
        clock += 60000; assert.deepStrictEqual(await s2.tick(), {}, '받아들인 서명 — 다시 만들지 않음'); assert.equal(s2.status().pendingWarn, null);
    });
    // ── 사용자 결정(2026-10-16) 1·2·4·5·6 — 결정마다 1:1 ──
    await check('[결정1] 브리핑 특보 칸은 기상청 시각 그대로: 해제 예고·예비 발효 예정에 발표 시각을 함께, 「더 일찍 풀릴 수 있음」 없음', () => {
        const iss = { start: '2026-10-16T14:00:00+09:00', end: '2026-10-16T14:00:00+09:00', range: false };
        const r = R.warningEvents([{ zone: 'Z', type: '풍랑', level: '주의보', state: '발효', issued: iss, effective: null, release: { start: at(6), end: at(9), range: true } },
            { zone: 'Y', type: '태풍', level: '경보', state: '예비', issued: { start: at(5), end: at(5), range: false }, effective: { start: at(21), end: at(21), range: false }, release: null }], WIN);
        assert.deepStrictEqual(r.special.map((x) => x.title), ['Z 풍랑주의보 — 06~09시 해제 예고(10월 16일 14:00 발표)', 'Y 태풍경보 예비특보 — 21:00 발효 예정(05:00 발표)']);
        assert.ok(!/더 일찍/.test(JSON.stringify(r)));
        const si = AI.stationInput(R.buildBriefing({ ...hallim(), sea: { ...hallim().sea, warnings: [{ zone: '제주도북부앞바다', kind: '앞바다', type: '풍랑', level: '주의보', state: '발효', issued: iss, effective: null, release: { start: at(6), end: at(9), range: true } }] } }, WIN, { generatedAt: R.isoKst(T0) }));
        assert.ok(si.allowed_number_keys.includes('14:00|:') && si.allowed_number_keys.includes('16|일'), 'AI 가 발표 시각을 옮겨도 숫자 검사 통과');
    });
    await check('[결정4] 해상 해제 뒤 관심 1시간: 해제 예고 끝 뒤 1시간이 걸친 칸만 · 이미 해제된 특보(구간 기록)도 — 「HH:MM 해제」 칸 + 해제 안내 두 줄', () => {
        const ok = { accident: true, congestion: true, zoneForecasts: true, warnings: true }, slot = (h) => [Date.parse(at(h)), Date.parse(at(h)) + 3 * 3600000];
        const rel = (start, end, range) => ({ zone: 'Z', type: '풍랑', level: '주의보', state: '발효', effective: null, release: { start, end, range } });
        const af = (w, h) => R.warnAtSlot(w, ...slot(h)).after;
        assert.deepStrictEqual([6, 9, 12].map((h) => af(rel(at(6), at(9), true), h)), [false, true, false], '범위 06~09시 → 09시 칸만(09~10시)');
        assert.deepStrictEqual([9, 12].map((h) => af(rel('2026-10-17T11:30:00+09:00', '2026-10-17T11:30:00+09:00', false), h)), [false, true], '11:30 해제 → 11:30~12:30 이 걸친 12시 칸');
        assert.equal(R.warnAtSlot(rel('2026-10-17T11:30:00+09:00', '2026-10-17T11:30:00+09:00', false), ...slot(9)).active, true, '해제 전 칸은 발효 그대로');
        const gone = { zone: 'Z', type: '풍랑', level: '주의보', state: '해제', issued: null, effective: null, release: { start: '2026-10-17T07:30:00+09:00', end: '2026-10-17T07:30:00+09:00', range: false } };
        assert.deepStrictEqual([6, 9].map((h) => R.slotOf({ warnings: [gone] }, ...slot(h), ok).rank), [1, 0], '07:30 해제 → 06시 칸만 관심');
        assert.equal(R.slotOf({ warnings: [gone] }, ...slot(6), ok).sources[0].label, 'Z 풍랑주의보 해제 뒤(07:30 해제)');
        const ev = R.warningEvents([gone], WIN);
        assert.deepStrictEqual(ev.special.map((x) => [x.kind, x.title, x.lines.length]), [['released', 'Z 풍랑주의보 — 07:30 해제', 2]]); assert.equal(ev.events[0].at, at(7) .replace('07:00', '07:30'));
        // 구간 기록 읽기: 등급 변경으로 닫힌 것·열린 것·범위 밖은 뺀다.
        const rec = { list: ({ zones, from, to }) => { assert.deepStrictEqual(zones, ['제주도북부앞바다']); return { intervals: [
            { zone: '제주도북부앞바다', kind: '앞바다', type: '풍랑', level: '경보', end: '2026-10-17T05:30:00+09:00', endBy: 'levelChange' },
            { zone: '제주도북부앞바다', kind: '앞바다', type: '풍랑', level: '주의보', end: '2026-10-17T07:30:00+09:00', endBy: 'clrNtcTm' },
            { zone: '제주도북부앞바다', kind: '앞바다', type: '풍랑', level: '주의보', end: null, endBy: null },
            { zone: '제주도북부앞바다', kind: '앞바다', type: '태풍', level: '주의보', end: '2026-10-17T01:00:00+09:00', endBy: 'observed' }] }; } };
        const rf = I.releasedFrom(rec, ['제주도북부앞바다'], Date.parse(at(3)), T0);
        assert.deepStrictEqual(rf.map((w) => [w.type + w.level, w.state, w.release.start]), [['풍랑주의보', '해제', '2026-10-17T07:30:00+09:00']]);
        assert.deepStrictEqual(I.releasedFrom(null, ['x'], 0, 1), [], '기록기가 없으면 보지 않음');
    });
    await check('[결정4] 해상 수집: 구간 기록의 해제는 창 시작 3시간 전부터 · 같은 구역·종류가 지금 발효 중이면(다시 발효) 뺀다 · 특보 원천이 낡으면 안 씀', () => {
        const A = { i: 0, id: '9001', lat: 33.425, lon: 126.225, haegu: { major: 232, sub: 2, label: '232-2' }, ref: { name: '화순항', distNm: 13.3, bearingWord: '북북서' }, warnZone: '제주도서부앞바다', warnSubZone: null, geometry: { type: 'Polygon', coordinates: [[[126.2, 33.4], [126.2, 33.45], [126.25, 33.45], [126.25, 33.4], [126.2, 33.4]]] } };
        const B = { ...A, i: 1, id: '9002', lat: 33.5, warnZone: '제주도북부앞바다' };
        const tree = { 남해: { x: { 제주도서부앞바다: { current: { wrnTp: 'V', wrnLvl: '주의보', tmFc: '2026년 10월 17일 05시 00분', tmEf: '2026년 10월 17일 06시 00분' }, upcoming: null, children: {} } } } };
        const mk = (wstatus) => ({ marineInputs: () => ({ accident: { cells: [A, B], frames: {} }, cells: { cells: [] }, congestion: null, warnings: { current: tree }, sources: { accident: { status: 'ok' }, congestion: { status: 'ok' }, zoneForecasts: { status: 'ok' }, warnings: { status: wstatus } }, weather: () => ({ wh: 1, ws: 5 }) }) });
        let asked = null;
        const rec = { list: (q) => { asked = q; return { intervals: [{ zone: '제주도서부앞바다', kind: '앞바다', type: '풍랑', level: '주의보', end: '2026-10-17T07:00:00+09:00', endBy: 'clrNtcTm' }, { zone: '제주도북부앞바다', kind: '앞바다', type: '풍랑', level: '경보', end: '2026-10-17T07:40:00+09:00', endBy: 'observed' }] }; } };
        const marine = { stationAt: () => ({ id: '0' }), cellHistory: () => ({ count: 0 }) };
        const s = I.collectSea([{ key: 'K', idx: '0' }], { risk: mk('ok'), marine, win: WIN, now: T0, warnHistory: rec }).bySt.get('K');
        assert.equal(asked.from, Date.parse(at(3)), '창 시작(06시) 3시간 전부터'); assert.equal(asked.to, T0);
        assert.deepStrictEqual(s.warnings.map((w) => w.zone + ' ' + w.type + w.level + ' ' + w.state), ['제주도서부앞바다 풍랑주의보 발효', '제주도북부앞바다 풍랑경보 해제'], '서부는 지금 발효 중이라 기록의 해제를 뺀다');
        assert.equal(I.collectSea([{ key: 'K', idx: '0' }], { risk: mk('stale'), marine, win: WIN, now: T0, warnHistory: rec }).bySt.get('K').warnings.filter((w) => w.state === '해제').length, 0, '특보 원천이 낡으면 해제 기록도 안 씀');
    });
    await check('[결정4] 육상 해제 뒤 관심 3시간: 오늘 밤 22시 해제 예고 → 내일 판 「해제 뒤」 · 구간 기록 해제 + 3시간 · 그날 발효로 남은 특보는 뺀다', () => {
        const day = (notices) => ({ t: at(0, '2026-10-18'), index: 15, band: '평소 수준', rows: [], notices: [], daily: { peakAt: at(0, '2026-10-18'), notices }, history: { available: false }, missing: [] });
        const cw = (warnings) => ({ zones: { warn: '제주도북부앞바다', gale: '제주시' }, warnings });
        const tonight = { name: '풍랑주의보', type: '풍랑', level: '주의보', state: '발효', source: 'mmis', issued: null, effective: null, release: { start: at(21), end: at(22), range: true } };
        const early = { ...tonight, name: '강풍주의보', source: 'gale', release: { start: at(18), end: at(18), range: false } };
        const risk = { coastDayDetail: () => day([]), coastWarnings: () => cw([tonight, early]) };
        const L = I.collectLand([{ id: 's', name: '가나해수욕장', lat: 1, lon: 1 }], [], { risk, t: at(0, '2026-10-18'), now: Date.parse(at(23)) });
        assert.deepStrictEqual(L.spots[0].released, [{ name: '풍랑주의보', at: at(22), source: 'mmis' }], '22시 해제 + 3시간이 내일 00시에 걸침 · 18시 해제(강풍)는 이미 지남');
        const j = R.landSpot(L.spots[0], '2026-10-18'); assert.deepStrictEqual([j.rank, j.sourceLabel], [1, '풍랑주의보 해제 뒤(10월 17일 22:00 해제)']);
        let q = null; const rec = { list: (x) => { q = x; return { intervals: [{ zone: '제주도북부앞바다', type: '태풍', level: '주의보', end: '2026-10-17T07:10:00+09:00', endBy: 'clrNtcTm' }] }; } };
        const L2 = I.collectLand([{ id: 's', name: '가나', lat: 1, lon: 1 }], [], { risk: { coastDayDetail: () => day([]), coastWarnings: () => cw([]) }, t: at(8), now: T0, warnHistory: rec });
        assert.deepStrictEqual(q.zones, ['제주도북부앞바다']); assert.equal(q.from, Date.parse(at(5)), '이 날 칸 시작(08시) 3시간 전부터');
        assert.deepStrictEqual(L2.spots[0].released, [{ name: '태풍주의보', at: '2026-10-17T07:10:00+09:00', source: 'history' }]);
        const L3 = I.collectLand([{ id: 's', name: '가나', lat: 1, lon: 1 }], [], { risk: { coastDayDetail: () => day([{ key: 'warning', name: '태풍주의보', state: '발효', from: at(9), to: at(12) }]), coastWarnings: () => cw([]) }, t: at(8), now: T0, warnHistory: rec });
        assert.deepStrictEqual(L3.spots[0].released, [], '그날 칸에 발효로 남아 있으면(다시 발효) 해제 뒤로 세지 않음');
    });
    await check('[결정2] AI 검증 단계 상한도 새 육상 규칙: 협재(지수 72 높음 + 바뀐 요소) = 주의까지 — 경계는 실패, 출처 꼬리표 인용은 통과', () => {
        const si2 = AI.stationInput(b), good2 = good;
        assert.equal(si2.levels.land['협재해수욕장'], 2); assert.equal(si2.levels.land['금능해수욕장'], 1); assert.equal(si2.land.top[0].source, "연안 위험지수 72 '높음'");
        const land = (t) => vo({ ...good2, land: t }, si2).errors;
        const base = "협재해수욕장의 연안 위험지수가 72 '높음'이고 사람 평소의 1.8배입니다. ";
        assert.deepStrictEqual(land(base + '따라서 협재해수욕장 주변 물가 접근에 주의가 필요합니다.'), [], '주의 = 상한 안');
        assert.ok(land(base + '따라서 협재해수욕장 주변 물가 접근에 경계가 필요합니다.').includes('level:경계>2'), '경계 = 상한 넘음');
        assert.ok(land(base + '따라서 금능해수욕장 주변 물가 접근에 주의가 필요합니다.').includes('level:주의>1'), '금능(다소 높음) = 관심까지');
    });
    await check('[결정6] 브리핑 오류를 관리자 오류현황에: historyRow 판정(실행 실패·없음·10시간 낡음·AI 총평 대신 틀·정상) — 틀 방식·개발 환경은 문제 아님', () => {
        const N = Date.parse(at(9)), last = (x) => ({ lastRun: { at: at(8), method: 'chatgpt', results: [{ stats: { template: 0 } }], ...x } });
        assert.equal(SB.historyRow({}, N).status, 'missing');
        assert.deepStrictEqual(SB.historyRow(last(), N), { updatedAt: at(8), lastSuccess: at(8), checkedAt: at(9), status: 'ok', lastError: null, detail: null });
        assert.equal(SB.historyRow(last(), Date.parse(at(18)) + 60000).status, 'stale', '08:00 판 뒤 10시간 넘음');
        const p = SB.historyRow({ ...last({ results: [{ stats: { template: 2 } }] }), errors: [{ at: at(8), stage: 'validate' }, { at: at(8), stage: 'call' }, { at: at(6), stage: 'call' }] }, N);
        assert.deepStrictEqual([p.status, p.partialCode, p.detail], ['partial', SB.HISTORY_PARTIAL_CODE, '마지막 실행 AI 총평 대신 틀 2곳(validate 1·call 1) — 생성 방식 chatgpt']);
        assert.equal(SB.historyRow(last({ method: 'template', results: [{ stats: { template: 97 } }] }), N).status, 'ok', '틀 방식은 일부 실패 아님');
        assert.equal(SB.historyRow(last({ aiDisabled: '개발 환경', results: [{ stats: { template: 97 } }] }), N).status, 'ok');
        const e = SB.historyRow({ ...last(), failures: { '2026-10-17|morning': { count: 2, lastAt: '2026-10-17T08:30:00+09:00', reason: 'ENOSPC' } } }, N);
        assert.deepStrictEqual([e.status, e.lastError, e.detail], ['error', 'network or parse error', '브리핑 실행 실패(연속 2번, 마지막 10-17 08:30 KST)'], '자유 글자(ENOSPC 원문)는 분류로 넘기지 않음');
        assert.equal(SB.historyRow({ ...last(), failures: { w: { count: 1, lastAt: at(7), reason: 'x' } } }, N).status, 'ok', '실패 뒤 성공한 실행이 있으면 정상');
    });
    await check('[결정6] 실행·실패가 오류현황(risk_error_history)에 바로 남고, 1분 감시(risk_history_sources)도 같은 판정 · 원천·분류 이름 등록', async () => {
        const H = require('../services/risk_error_history'), RHS = require('../services/risk_history_sources');
        assert.ok(H.SOURCES.includes('stationBriefing'));
        const d = fs.mkdtempSync(path.join(tmp, 'hist-')), hist = H.createHistory({ dir: path.join(d, 'risk'), clock: () => Date.parse(at(8)) });
        const s2 = SB.createService({ dir: path.join(d, 'sb'), clock: () => Date.parse(at(8)), risk: fakeRisk, marine: fakeMarine, loadStations: () => fakeStations, alertsFile: path.join(d, 'none.json'), hazardFeatures: () => [], kma: () => null, tideDeps: { anchors: [] }, errorHistory: hist,
            adapters: { vm: { available: () => true, call: async ({ prompt }) => JSON.stringify({ stations: idsIn(prompt).map((x) => ({ id: x.id, land: null, sea: 'x' })) }) }, gemini: { available: () => false } } });
        await s2.run({ kind: 'morning' });
        const cur = () => hist.list().current.find((r) => r.source === 'stationBriefing');
        assert.deepStrictEqual([cur().status, cur().code], ['partial', SB.HISTORY_PARTIAL_CODE], 'VM 글이 검증에 떨어져 틀 → 일부 실패');
        assert.ok(/AI 총평 대신 틀 2곳/.test(cur().detail), cur().detail);
        assert.deepStrictEqual(RHS.briefingSource(path.join(d, 'sb'), Date.parse(at(8))), SB.historyRow(s2._state(), Date.parse(at(8))), '감시 판정 = 실행 직후 판정');
        assert.equal(RHS.briefingSource(path.join(d, 'none'), 0).status, 'missing');
        fs.writeFileSync(path.join(d, 'bad.json'), '{'); fs.mkdirSync(path.join(d, 'bad')); fs.writeFileSync(path.join(d, 'bad', 'state.json'), '{');
        assert.deepStrictEqual([RHS.briefingSource(path.join(d, 'bad'), 0).status, RHS.briefingSource(path.join(d, 'bad'), 0).lastError], ['error', 'invalid response']);
        // 실행 실패(tick → reportFailure) — 09:00 에 아침 판이 아직 없다고 두고(done 비움) 저장소가 던지게 한다.
        const h2 = H.createHistory({ dir: path.join(d, 'risk'), clock: () => Date.parse(at(9)) });
        const s3 = SB.createService({ dir: path.join(d, 'sb'), clock: () => Date.parse(at(9)), risk: { spots: () => { throw new Error('ENOSPC'); } }, marine: fakeMarine, loadStations: () => fakeStations, alertsFile: path.join(d, 'none.json'), hazardFeatures: () => [], kma: () => null, errorHistory: h2 });
        const st0 = s3._state(); st0.done = []; I.writeJson(path.join(d, 'sb', 'state.json'), st0);
        assert.equal((await s3.tick()).failed, '2026-10-17|morning');
        const c2 = h2.list().current.find((r) => r.source === 'stationBriefing');
        assert.deepStrictEqual([c2.status, c2.code, c2.detail], ['error', 'network or parse error', '브리핑 실행 실패(연속 1번, 마지막 10-17 09:00 KST)']);
        assert.deepStrictEqual(h2.list({ source: 'stationBriefing' }).data.map((x) => x.phase), ['changed', 'opened'], '일부 실패 → 실행 실패 사건이 이력에 남음');
        h2.observeSources({ stationBriefing: RHS.briefingSource(path.join(d, 'sb'), Date.parse(at(9))) });
        assert.equal(h2.list({ source: 'stationBriefing' }).data.length, 2, '1분 감시가 같은 판정이면 가짜 사건을 더 만들지 않음');
    });
    // ── 2단계 화면 독립 검토(review_ui2, 2026-10-16) — 규칙 쪽 결함 1:1 ──
    await check('[UI-B1] 총평 「위험이 높아진 해역 N개」는 총평 단계와 같은 기준 — 공식 사고예보 「경계」만 있는 날 「평소 수준」 + 「1개」 자기모순 없음 · AI 입력 attention_regions 도 같은 기준', () => {
        // 검토자 재현(review_ui2/t2.js): 15시 공식 사고예보 '경계'만, 기상 평온 → 카드 단계 경계, 총평 단계 평소 수준
        const lone = R.buildBriefing(seaOnlyInput({ reviewedCells: 5, regions: [region(1, { [at(15)]: { accident: '경계' } })], weather: { 232: { label: '대해구 232', rows: WIN.slots.map((a) => ({ at: a, wh: 0.5, ws: 4 })) } } }), WIN, { generatedAt: R.isoKst(T0) });
        assert.deepStrictEqual([lone.sea.level.rank, lone.sea.overviewLevel.rank, lone.sea.attentionRegions, lone.sea.overviewRegions], [3, 0, 1, 0]);
        assert.equal(lone.summary.sea.headline, '오늘 테스트파출소 관할 해상의 단계는 "평소 수준"입니다.');
        assert.deepStrictEqual(lone.summary.sea.basis.slice(0, 2), ['관할 해역 1칸 중 위험이 높아진 해역 0칸', "해양사고 위험예보만 '경계'인 해역 1칸"]);
        assert.ok(!/해역 1칸$/.test(lone.summary.sea.basis[0]), '총평 단계와 다른 기준의 수를 쓰지 않음');
        const si = AI.stationInput(lone);
        assert.deepStrictEqual([si.sea.attention_regions, si.sea.accident_only_regions], [0, 1]);
        // 관심 이상 해역이 아예 없는 날 — 「공식 사고예보 단계만 있고」라 쓰지 않는다
        const calm = R.buildBriefing(seaOnlyInput({ reviewedCells: 5 }), WIN, { generatedAt: R.isoKst(T0) });
        assert.ok(!JSON.stringify(calm.summary).includes('해양사고 위험예보만'), calm.summary.sea.basis.join(' / '));
        assert.equal(calm.summary.sea.basis[0], '관할 해역 0칸 중 위험이 높아진 해역 0칸');
        assert.equal(calm.summary.sea.advice, '출항 전 기상 확인에 관심이 필요합니다.');
        // 둘 다 있는 날: 기상·혼잡이 겹친 해역 1 + 사고예보만 1 → 「관심 이상 1개 해역, 공식 사고예보 단계만 있는 해역 1개」
        const cg = { level: '높음', index: 12, at: at(15) };
        const mix = R.buildBriefing(seaOnlyInput({ reviewedCells: 2, regions: [region(1, { [at(9)]: { accident: '경계' } }), region(2, { [at(15)]: { accident: '주의', congestion: cg } })] }), WIN, { generatedAt: R.isoKst(T0) });
        assert.deepStrictEqual(mix.summary.sea.basis.slice(0, 2), ['관할 해역 2칸 중 위험이 높아진 해역 1칸', "해양사고 위험예보만 '경계'인 해역 1칸"]);
    });
    await check('[UI-B12] 경계 카드 문장의 「공식」을 출처별로 — 공식 사고예보 경계는 공단 사고위험 예보, 특보 경계는 기상청 특보', () => {
        const acc = R.buildBriefing(seaOnlyInput({ regions: [region(1, { [at(9)]: { accident: '경계' } })] }), WIN, { generatedAt: R.isoKst(T0) }).sea.cards[0];
        assert.ok(acc.sentence.includes("해양사고 위험예보 '경계' 단계이므로 공단 사고위험 예보를 확인하고 운항 시 경계가 필요합니다."), acc.sentence);
        const wz = { zone: '제주도서부앞바다', type: '풍랑', level: '경보', state: '발효', effective: { start: at(0), end: at(0), range: false }, release: null };
        const wr = R.buildBriefing(seaOnlyInput({ regions: [region(1, {}, { zone: { name: '제주도서부앞바다', kind: 'main' } })], warnings: [wz] }), WIN, { generatedAt: R.isoKst(T0) }).sea.cards[0];
        assert.ok(wr.sentence.includes('제주도서부앞바다 풍랑경보 근거로 기상청 특보를 확인하고 운항 시 경계가 필요합니다.'), wr.sentence);
        assert.ok(!/공식 경계 단계 확인/.test(acc.sentence + wr.sentence));
    });
    await check('[UI-B5] 관심 이상 관광지 전체 수(attentionSpots)를 따로 준다 — 카드는 10곳까지', () => {
        const spots = Array.from({ length: 12 }, (_, i) => ({ id: 's' + i, name: '관광지' + pad(i), lat: 33, lon: 126, index: 30, band: '다소 높음', people: { ratio: 1.5, score: 0.5 }, notices: {}, missing: [] }));
        const b = R.buildBriefing({ ...seaOnlyInput({}), seaOnly: false, land: { spots, hazardOnly: [] } }, WIN, { generatedAt: R.isoKst(T0) });
        assert.deepStrictEqual([b.land.attentionSpots, b.land.cards.length], [12, 10]);
    });
    // ── 2026-10-17 사용자 결정(설계서 §11.10) — 결정마다 1:1. 고치기 전 코드(origin/main 7800fbfb0)에서 실패함을 확인했다(보고서 참고) ──
    await check('[§11.10] 육상 근거 수는 관심 이상 관광지 전체(카드 상한 10 아님) · 여러 곳 공통 예비특보는 한 줄로 한 번만 · 너울 결측은 「너울」', () => {
        const spots = Array.from({ length: 12 }, (_, i) => ({ id: 's' + i, name: '관광지' + pad(i), lat: 33, lon: 126, index: i < 3 ? 80 : 30, band: i < 3 ? '높음' : '다소 높음', people: { ratio: 1.5, score: 0.5 }, missing: i === 5 ? ['swell'] : [],
            notices: { effective: [], prelim: ['풍랑주의보'], detail: [{ name: '풍랑주의보', state: '예비', issued: { start: at(4), end: at(4), range: false }, effective: { start: '2026-10-18T00:00:00+09:00', end: '2026-10-18T06:00:00+09:00', range: true }, release: null }] } }));
        const x = R.buildBriefing({ ...seaOnlyInput({}), seaOnly: false, land: { spots, hazardOnly: [] } }, WIN, { generatedAt: R.isoKst(T0) });
        assert.deepStrictEqual([x.land.attentionSpots, x.land.cards.length], [12, 10]); assert.deepStrictEqual(x.land.attentionByRank, { 1: 9, 2: 3, 3: 0 });
        const L = x.summary.land, pre = '풍랑주의보 예비특보(10월 18일 00~06시 발효 예정, 04:00 발표)';
        assert.equal(L.basis[0], '관할 관광지 12곳 중 평소보다 위험이 높아진 곳 12곳 (주의 3곳 · 관심 9곳)', '카드 상한(10)이 아니라 전체 12곳');
        assert.deepStrictEqual(L.basis.slice(1, 4), ['관광지00 — 연안 위험지수 80(높음, 예상), 방문객 평소의 1.5배(예상)', '관광지01 — 연안 위험지수 80(높음, 예상), 방문객 평소의 1.5배(예상)', '관광지02 — 연안 위험지수 80(높음, 예상), 방문객 평소의 1.5배(예상)']);
        assert.equal(L.basis.filter((t) => t.includes('예비특보')).length, 1, '공통 예비특보는 한 줄'); assert.ok(L.basis.includes(pre) && !L.basis.some((t) => t.includes('공통')), L.basis.join(' / '));
        assert.equal(L.basis[L.basis.length - 1], '확인하지 못한 자료: 너울', 'swell → 너울(종전엔 영어 그대로)');
        assert.equal(R.SOURCE_LABEL.swell, '너울'); assert.ok(!JSON.stringify(x.summary).includes('swell'));
        const sx = AI.stationInput(x); assert.ok(sx.allowed_number_keys.includes('12|곳')); assert.equal(sx.land.changed_spots, 12, 'AI 입력도 전체 수(종전 카드 수 10)');
        assert.deepStrictEqual(sx.land.missing_sources, ['너울']);
        // 한 곳에만 있는 특보는 공통 줄이 아니라 그 장소 줄에
        const y = R.buildBriefing({ ...seaOnlyInput({}), seaOnly: false, land: { spots: spots.slice(0, 2).map((q, i) => i ? { ...q, notices: {} } : q), hazardOnly: [] } }, WIN, { generatedAt: R.isoKst(T0) });
        assert.equal(y.summary.land.basis[1], '관광지00 — 연안 위험지수 80(높음, 예상), 방문객 평소의 1.5배(예상), ' + pre, y.summary.land.basis.join(' / '));
        // 근거가 하나이고 시간대가 해역 창과 같으면 해역 줄에 시간대를 되풀이하지 않는다
        const one = R.buildBriefing(seaOnlyInput({ regions: [region(1, { [at(9)]: { accident: '경계', congestion: { level: '높음', index: 12 } } })] }), WIN, { generatedAt: R.isoKst(T0) });
        assert.ok(one.summary.sea.basis.includes('09~12시 ' + one.sea.overviewTop[0].name + " — 해양사고 위험예보 '경계'(예상)"), one.summary.sea.basis.join(' / '));
        assert.equal(one.summary.sea.advice, '09~12시 ' + one.sea.overviewTop[0].name.replace(/\([^()]*해구\)$/, '') + ' 운항에 경계가 필요합니다.');
    });
    await check('[§11.10] AI 해설 검증: 기상청 해역 이름·「제주도」 허용 · 「두 곳」은 2곳이 허용 숫자일 때만, 「세 곳」은 3곳이 없으면 실패 · 「두 척」은 늘 실패 · 1~2문장', () => {
        // 운영 10-17 08:00 판 실패 재현: place:오후부터제주도남쪽바깥먼바다 · place:제주도 · number:hangul:두 곳
        const siK = AI.stationInput(b, { excerpt: { 해상: '오늘 밤부터 제주도남쪽바깥먼바다에 바람이 강하게 불겠습니다.' } });   // 운영 실패 때 그 이름은 기상청 전망 발췌에 있었다(독립 검토 8 — 관련 이름만)
        assert.deepStrictEqual(vo({ ...good, sea: '오후부터 제주도남쪽바깥먼바다에서 바람이 강해지고, 제주도에는 비가 옵니다.' }, siK).errors, []);
        assert.ok(AI.KMA_ZONE_NAMES.includes('제주도남쪽바깥먼바다') && AI.KMA_ZONE_NAMES.includes('제주도') && AI.KMA_ZONE_NAMES.includes('경기북부앞바다'));
        assert.ok(si.allowed_number_keys.includes('2|곳'));
        assert.deepStrictEqual(vo({ ...good, land: '협재해수욕장 등 두 곳은 사람이 평소보다 많습니다.' }, si).errors, [], '2|곳 허용 → 「두 곳」 통과');
        const no3 = { ...si, allowed_number_keys: si.allowed_number_keys.filter((k) => k !== '3|곳') };
        assert.ok(vo({ ...good, land: '협재해수욕장 등 세 곳은 사람이 많습니다.' }, no3).errors.includes('number:hangul:세 곳'), '3|곳 없으면 「세 곳」 실패');
        assert.ok(vo({ ...good, sea: '비양도 해역에 선박 두 척이 있습니다.' }, si).errors.includes('number:hangul:두 척'), '곳·개 밖 단위는 늘 실패');
        assert.ok(vo({ ...good, sea: '오후 세 시부터 바람이 셉니다.' }, si).errors.includes('number:hangul:세 시'));
        assert.ok(vo({ ...good, sea: '가로림만에서 물결이 높습니다.' }, si).errors.includes('place:가로림만'), '지어낸 지명은 그대로 실패');
        assert.ok(vo({ ...good, sea: '비양도 해역은 9건의 사고가 있었습니다.' }, si).errors.includes('number:9건'), '지어낸 숫자는 그대로 실패');
        // 지시문·묶음: 문장 수(§11.10.4 부터 3~5 — 그 전 1~2) · 해역 이름 목록 · 판 올림
        const batch = AI.batchInput([siK], null); assert.deepStrictEqual(batch.rules.sentences_per_paragraph, [3, 5]); assert.ok(batch.stations[0].kma_zones.includes('제주도남쪽바깥먼바다'), '해역 이름 목록은 관할마다(독립 검토 8)');
        assert.ok(batch.stations[0].shown.land.headline.startsWith('오늘 한림파출소 관할 연안의 단계는'), '이미 보이는 결론을 AI 에 알려 되풀이하지 않게');
        const pr = AI.buildPrompt(batch); assert.ok(pr.includes('3~5문장') && !pr.includes('1~2문장') && !pr.includes('required.'), '지시문도 분석 3~5문장(§11.10.4)');
        assert.deepStrictEqual([AI.VALIDATOR_VERSION, AI.PROMPT_VERSION], ['sb-validate-v5', 'sb-prompt-v6']);
    });
    await check('[§11.10] 관리자 오류 목록: 최근 3일(KST 날짜) 오류는 모두 남기고(종전 200개 상한 없음) 더 오래된 것만 지운다 · 안전 상한 5,000 은 지운 수를 남긴다 · status 가 전부(최근 것부터)', async () => {
        const mk = (iso, i) => ({ at: iso, stage: 'validate', provider: 'chatgpt', stations: ['k|' + i], reason: 'r' + i });
        const now = Date.parse('2026-10-17T08:10:00+09:00');
        const list = [mk('2026-10-14T23:59:00+09:00', 0)].concat(Array.from({ length: 450 }, (_, i) => mk('2026-10-15T00:00:00+09:00', i + 1)), [mk('2026-10-17T08:00:00+09:00', 999)]);
        const k = SB.keepErrors(list, now);
        assert.equal(k.errors.length, 451, '10-15 00:00 ~ 10-17 은 모두(종전 slice(-200) 이면 200)'); assert.equal(k.dropped, 0); assert.ok(!k.errors.some((e) => e.at.startsWith('2026-10-14')), '3일 전(10-14)은 지움');
        const big = Array.from({ length: 5003 }, (_, i) => mk('2026-10-16T10:00:00+09:00', i)), kb = SB.keepErrors(big, now);
        assert.deepStrictEqual([kb.errors.length, kb.dropped, kb.errors[0].reason], [SB.ERROR_HARD_CAP, 3, 'r3'], '상한을 넘으면 오래된 것부터, 지운 수를 셈');
        // 서비스: 실행 오류를 3일 보관 규칙으로 쌓고 status 가 전부를 최근 것부터
        const d = fs.mkdtempSync(path.join(tmp, 'errs-')); let clock = Date.parse(at(8));
        I.writeJson(path.join(d, 'state.json'), { done: ['2026-10-17|morning'], errors: list });
        const s2 = SB.createService({ dir: d, clock: () => clock, risk: fakeRisk, marine: fakeMarine, loadStations: () => fakeStations, alertsFile: path.join(d, 'none.json'), hazardFeatures: () => [], kma: () => null, tideDeps: { anchors: [] },
            adapters: { vm: { available: () => true, call: async ({ prompt }) => JSON.stringify({ stations: idsIn(prompt).map((x) => ({ id: x.id, land: null, sea: 'x' })) }) }, gemini: { available: () => false } } });
        await s2.run({ kind: 'manual' });
        const st = s2.status();
        assert.ok(st.errors.length > 451, '이번 실행 오류가 더해지고 지난 451건도 남음 — ' + st.errors.length); assert.ok(!st.errors.some((e) => e.at.startsWith('2026-10-14')));
        assert.ok(Date.parse(st.errors[0].at) >= Date.parse(st.errors[st.errors.length - 1].at), '최근 것부터'); assert.deepStrictEqual(st.errorKeep, { days: 3, cap: 5000 }); assert.equal(st.errorsCapped, null);
        clock = Date.parse('2026-10-20T09:00:00+09:00'); assert.equal(s2.status().errors.length, 0, '실행이 없어도 3일이 지나면 보이지 않음');
    });
    // ── 2026-10-17 사용자 후속 결정(설계서 §11.10.1 — 결론 → (기상) → (물때) → 근거·권고, 「예상」 표기) — 결정마다 1:1. 고치기 전 코드(8afdce39f)에서 실패함을 확인했다 ──
    const BULLETIN = fs.readFileSync(path.join(__dirname, 'fixtures', 'station_briefing', 'jeju_bulletin_20261017.txt'), 'utf8');   // 사용자가 붙여 준 10-17 제주지방기상청 단기 전망 본문(그대로)
    // 단기 해상예보 칸(regional_forecast_collector.loadCoastalForecasts 꼴 — 05시 발표면 오늘 오전부터, 17시 발표면 오늘 오후부터). 값은 인덱스 팝업 그림의 10-17 제주도서부앞바다 값 + 시험용.
    const coastal = (pub, periods) => ({ officeName: '제주지방기상청', publishTime: pub, collectedAt: '2026-10-17T05:20:00Z', periods });
    const P = (date, period, weather, wave, wind) => ({ date, period, weather, waveHeight: wave, wind });
    const jejuWest = coastal('10.17. 05:00', [P('20261017', 'am', '구름많음', '0.5~1.5', '동~남동 / 7~11'), P('20261017', 'pm', '구름많음', '0.5~1.5', '남동 / 7~11'), P('20261018', 'am', '흐리고 비', '1.5~2.5', '남동~남 / 9~13'), P('20261018', 'pm', '흐리고 비', '2.0~3.0', '남 / 11~16')]);
    const REGIONAL = () => ({ coastal: { 제주도서부앞바다: jejuWest }, offices: { 184: { officeName: '제주지방기상청', bulletinPublishTime: '2026.10.17 04:40', summary: BULLETIN } }, zoneOffice: require('../regional_forecast_collector').ZONE_TO_OFFICE_MAP });
    await check('[고르기 지도 2026-10-17] 관할 해역(stationSeas) — 실제 정리판 97곳·특보구역 도형: 지방청과 다른 관할·경계 관할 · 해역별 수 · 좌표 넷째 자리', () => {
        const st = I.loadStations(), areas = I.stationAreas(st), by = Object.fromEntries(areas.map((a) => [a.key, a.seas]));
        assert.equal(areas.length, 97, '정리판 97곳 모두 폴리곤');
        assert.deepStrictEqual([by['제주해양경찰서|한림파출소'], by['울산해양경찰서|울산항파출소'], by['여수해양경찰서|돌산파출소'], by['인천해양경찰서|영흥파출소'], by['강릉해양경찰서|강릉파출소']], [['제주'], ['동해'], ['남해'], ['서해'], ['동해']]);
        assert.deepStrictEqual(areas.filter((a) => a.seas.length > 1).map((a) => a.key + ':' + a.seas.join('·')).sort(), ['완도해양경찰서|땅끝파출소:서해·남해', '울산해양경찰서|기장파출소:남해·동해', '제주해양경찰서|추자파출소:남해·제주'].sort());
        const cnt = {}; areas.forEach((a) => a.seas.forEach((x) => { cnt[x] = (cnt[x] || 0) + 1; })); assert.deepStrictEqual(cnt, { 서해: 38, 남해: 33, 동해: 23, 제주: 6 });
        assert.ok(areas.every((a) => a.seas.length >= 1));
        assert.ok(areas[0].geometry.coordinates.flat(Infinity).every((v) => Math.round(v * 1e4) / 1e4 === v));
        const sq = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }, far = { type: 'Polygon', coordinates: [[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]] };
        assert.deepStrictEqual(I.stationSeas(sq, [{ sea: '서해', box: [5, 5, 6, 6], geometry: far }]), ['서해'], '어느 구역에도 안 들면 가장 가까운 구역의 해역');
        assert.deepStrictEqual(I.stationSeas(sq, []), [], '구역 표가 비면 빈 배열');
    });
    await check('[§11.10.1] 가장 가까운 특보구역(앞바다) — 실제 특보구역 도형(client/assets/warn_zones.geojson): 한림 → 제주도서부앞바다 · 애월 → 제주도북부앞바다 · 위치 없음 → null', () => {
        assert.deepStrictEqual(I.nearestCoastalZone({ lat: 33.41, lon: 126.26 }).zone, '제주도서부앞바다', '한림파출소 시험 위치(한림 고정 자료와 같은 좌표)');
        assert.equal(I.nearestCoastalZone({ lat: 33.46, lon: 126.33 }).zone, '제주도북부앞바다');
        assert.equal(I.nearestCoastalZone(null), null); assert.equal(I.nearestCoastalZone({ lat: null, lon: 1 }), null);
        const w = I.collectZoneWeather({ lat: 33.41, lon: 126.26 }, REGIONAL());
        assert.deepStrictEqual([w.zone, w.office, w.coastal.publishTime, w.bulletin.publishTime], ['제주도서부앞바다', '184', '10.17. 05:00', '2026.10.17 04:40'], '구역의 관할 지방청 = ZONE_TO_OFFICE_MAP(184 제주)');
        const none = I.collectZoneWeather({ lat: 33.41, lon: 126.26 }, { coastal: {}, offices: {}, zoneOffice: {} });
        assert.deepStrictEqual([none.zone, none.coastal, none.bulletin], ['제주도서부앞바다', null, null]);
    });
    await check('[§11.10.1] 판별 오전·오후 칸 — 08:00 판 오늘 오전·오후 · 17:30 판 오늘 오후·내일 오전 · 23:00 판 내일 오전·오후 · 특보 변경 13:10 은 17:30 판처럼', () => {
        const slots = (w) => R.weatherSlotsFor(w).map((x) => x.date.slice(6) + x.period);
        assert.deepStrictEqual(slots(R.editionWindow('morning', T0)), ['17am', '17pm']);
        assert.deepStrictEqual(slots(R.editionWindow('evening', Date.parse('2026-10-17T17:30:00+09:00'))), ['17pm', '18am']);
        assert.deepStrictEqual(slots(R.editionWindow('night', Date.parse(at(23)))), ['18am', '18pm']);
        assert.deepStrictEqual(slots(R.editionWindow('warning', Date.parse('2026-10-17T13:10:00+09:00'), '2026-10-17')), ['17pm', '18am']);
        const mk = (win, gen) => R.buildBriefing({ ...hallim(), zoneWeather: I.collectZoneWeather({ lat: 33.41, lon: 126.26 }, REGIONAL()) }, win, { generatedAt: gen }).summary.weather;
        const m = mk(WIN, R.isoKst(T0));
        assert.deepStrictEqual(m.rows.map((r) => r.label + ' | ' + r.text), ['오늘 오전 | 구름많음 · 파고 0.5~1.5m · 풍속 7~11m/s · 풍향 동→남동', '오늘 오후 | 구름많음 · 파고 0.5~1.5m · 풍속 7~11m/s · 풍향 남동']);
        assert.deepStrictEqual([m.zone, m.source, m.missing], ['제주도서부앞바다', '제주지방기상청 단기 해상예보 (10.17 05:00 발표)', false]);
        const e = mk(R.editionWindow('evening', Date.parse('2026-10-17T17:30:00+09:00')), '2026-10-17T17:30:00+09:00');
        assert.deepStrictEqual(e.rows.map((r) => r.label), ['오늘 오후', '내일 오전']); assert.ok(e.rows[1].text.startsWith('흐리고 비 · 파고 1.5~2.5m'));
        const n = mk(R.editionWindow('night', Date.parse(at(23))), R.isoKst(Date.parse(at(23))));
        assert.deepStrictEqual(n.rows.map((r) => r.label), ['내일 오전', '내일 오후']);
    });
    await check('[§11.10.1] 단기 전망 특이사항 — 사용자가 붙여 준 10-17 제주 통보문에서 대상일 것만(오늘 = 17일: 강풍·풍랑 예비특보·해상, 18일 것과 내륙 안개는 뺌) · 내일 판은 18일 것만 · 3줄까지', () => {
        // 독립 검토 2·4(설계서 §11.10.2): 지역·「곳에 따라」 단서를 붙이고, 같은 구역의 풍랑 예비특보 줄과 해상 줄은 한 줄로 — 그래서 17일은 2줄
        assert.deepStrictEqual(R.bulletinNotes(BULLETIN, '2026-10-17', '2026-10-17', '오늘'), ['오늘 오후부터 제주도에 순간풍속 15m/s 안팎의 강한 바람(곳에 따라)', '풍랑 예비특보: 오늘 밤(18~24시) 제주도남쪽바깥먼바다 — 물결 1.5~3.0m로 높아짐']);
        const tm = R.bulletinNotes(BULLETIN, '2026-10-17', '2026-10-18', '내일');
        assert.equal(tm.length, 3); assert.ok(tm.every((x) => x.startsWith('내일') || x.includes(': 내일')), tm.join(' / '));
        assert.ok(!tm.join('').includes('오늘') && !tm.join('').includes('17일') && !tm.join('').includes('인천'), '다른 날·다른 지역 정보 없음');
        assert.ok(tm.includes('내일 새벽부터 제주도산지와 제주시(북부, 중산간) 등에 순간풍속 20m/s 안팎의 매우 강한 바람(강풍특보 가능성)'), tm.join(' / '));
        assert.deepStrictEqual(R.bulletinNotes(BULLETIN, '2026-10-17', '2026-10-21', '오늘'), [], '발표일과 너무 먼 날은 없음');
        assert.equal(R.stripMarkup('{{loc:제주도}}에는 {{num:1.5~3.0m}}'), '제주도에는 1.5~3.0m');
        assert.deepStrictEqual(R.bulletinNotes(BULLETIN.replace('제주도남쪽바깥먼바다,', '{{loc:제주도남쪽바깥먼바다}},'), '2026-10-17', '2026-10-17', '오늘')[1], '풍랑 예비특보: 오늘 밤(18~24시) 제주도남쪽바깥먼바다 — 물결 1.5~3.0m로 높아짐', 'AI 색칠 마크업이 있어도 같게');
        const w = R.buildBriefing({ ...hallim(), zoneWeather: I.collectZoneWeather({ lat: 33.41, lon: 126.26 }, REGIONAL()) }, WIN, { generatedAt: R.isoKst(T0) }).summary.weather;
        assert.deepStrictEqual([w.notes.length, w.notesSource, w.bulletinMissing], [2, '제주지방기상청 단기 전망 (10.17 04:40 발표)', false]);
    });
    await check('[§11.10.1] 자료 없음 — 위치·예보·통보문이 없거나 통보문이 낡으면 지어내지 않고 missing · 옛 브리핑 다시 계산은 weather null', () => {
        const base = (zw) => R.buildBriefing({ ...hallim(), zoneWeather: zw }, WIN, { generatedAt: R.isoKst(T0) }).summary.weather;
        assert.deepStrictEqual([base(null).missing, base(null).bulletinMissing, base(null).rows, base(null).zone], [true, true, [], null]);
        const noPdf = base(I.collectZoneWeather({ lat: 33.41, lon: 126.26 }, { ...REGIONAL(), coastal: {} }));
        assert.deepStrictEqual([noPdf.zone, noPdf.missing, noPdf.source, noPdf.bulletinMissing], ['제주도서부앞바다', true, null, false]);
        const old = REGIONAL(); old.offices['184'].bulletinPublishTime = '2026.10.14 16:40';
        const stale = base(I.collectZoneWeather({ lat: 33.41, lon: 126.26 }, old)); assert.deepStrictEqual([stale.bulletinMissing, stale.notes], [true, []], '3일 전 통보문은 쓰지 않음');
        const gone = coastal('10.15. 17:00', [P('20261016', 'am', '맑음', '0.5', '북 / 4~6')]);
        const g = base(I.collectZoneWeather({ lat: 33.41, lon: 126.26 }, { ...REGIONAL(), coastal: { 제주도서부앞바다: gone } }));
        assert.deepStrictEqual([g.missing, g.rows.map((r) => r.text)], [true, ['자료 없음', '자료 없음']], '그날 칸이 없는 낡은 예보');
        assert.equal(R.buildSummary(b).weather, null, '창 없이 다시 계산하면(옛 브리핑) 기상 칸 없음');
    });
    await check('[§11.10.1] 「예상」 표기 — 예보·예측(공식 사고예보·혼잡·해구 예보·방문객·지수·너울·해안 바람)에만, 발효 중 특보·예비특보·해제·이안류(관측)·행사에는 없음', () => {
        assert.equal(R.expectText('people', '사람 평소의 2.2배'), '방문객 평소의 2.2배(예상)');
        assert.equal(R.expectText('swell', '너울(파주기 12초)'), '너울(파주기 12초, 예상)');
        assert.equal(R.expectText('drift', '해안 바람 9m/s(튜브·물놀이기구 떠밀림 주의)'), '해안 바람 9m/s(예상, 튜브·물놀이기구 떠밀림 주의)');
        for (const k of ['warning', 'prewarn', 'released', 'rip', 'event']) assert.equal(R.expectText(k, 'X'), 'X', k);
        const eff = R.buildBriefing({ ...seaOnlyInput({}), seaOnly: false, land: { spots: [{ id: 'w', name: '가나해수욕장', lat: 33, lon: 126, index: 30, band: '다소 높음', missing: [], notices: { effective: ['풍랑주의보'], prelim: [], detail: [] }, rip: { level: '주의' }, event: { name: '가나 축제' } }], hazardOnly: [] } }, WIN, { generatedAt: R.isoKst(T0) });
        const line = eff.summary.land.basis[1];
        assert.equal(line, "가나해수욕장 — 행사 「가나 축제」, 이안류 '주의', 풍랑주의보 발효", '발효 특보·이안류·행사에는 「예상」 없음(지수 출처가 아니면 지수도 안 붙음)');
        const wz = { zone: '제주도서부앞바다', type: '풍랑', level: '경보', state: '발효', effective: { start: at(0), end: at(0), range: false }, release: null };
        const wr = R.buildBriefing(seaOnlyInput({ regions: [region(1, { [at(9)]: { congestion: { level: '높음', index: 12 } } }, { zone: { name: '제주도서부앞바다', kind: 'main' } })], warnings: [wz] }), WIN, { generatedAt: R.isoKst(T0) });
        const rl = wr.summary.sea.basis.find((x) => x.includes('해역(232-1해구) — '));
        assert.ok(rl && rl.includes('제주도서부앞바다 풍랑경보') && !/풍랑경보[^·]*예상/.test(rl), '발효 중 경보에는 「예상」 없음 — ' + rl);
    });
    await check('[§11.10.1] AI 입력 — shown 에 (기상)·(물때)를 보여 되풀이하지 않게 하되, 기상 칸 숫자(예보 0.5~1.5m·통보문 15m/s)는 허용 숫자에 넣지 않는다(검증 규칙 그대로)', () => {
        const x = R.buildBriefing({ ...hallim(), zoneWeather: I.collectZoneWeather({ lat: 33.41, lon: 126.26 }, REGIONAL()) }, WIN, { generatedAt: R.isoKst(T0) });
        const sx = AI.stationInput(x);
        assert.ok(sx.shown.weather.rows[0].startsWith('오늘 오전 구름많음') && sx.shown.weather.notes.length === 2 && Array.isArray(sx.shown.tide));
        assert.ok(!sx.allowed_number_keys.includes('0.5~1.5|m') && !sx.allowed_number_keys.includes('15|m/s') && !sx.allowed_number_keys.includes('1.5~3|m'), '기상 칸 숫자는 해설 허용 숫자 아님');
        assert.ok(vo({ land: good.land, sea: '오늘 밤 파고 0.5~1.5m 입니다.' }, sx).errors.includes('number:0.5~1.5m'));
        assert.ok(AI.buildPrompt(AI.batchInput([sx], null)).includes('shown.weather 의 숫자는'));
    });
    // ── 2026-10-17 §11.10.1 독립 검토(8afdce39f..cebb4cbe0) 12건 — 설계서 §11.10.2 표 1:1. 고치기 전 코드(cebb4cbe0)에서 12건 모두 실패함을 확인했다 ──
    const SEA = (body) => '<강풍 및 해상>\n' + body, RAIN = (body) => '<강수 및 유의 사항>\n' + body;
    await check('[§11.10.2-1] 해상 특이사항 방향은 원문대로(낮게 → 낮아짐, 방향 말 없음 → 수치만, 「일겠으나 오후에는 낮아지겠으니」 → 둘 다) · 구역은 「에서는·에서·에는·에도·에」 앞까지', () => {
        // 검토자 재현: 낮게 이는데 「높아짐」이라고 썼다
        assert.deepStrictEqual(R.bulletinNotes(SEA('○ (해상) 내일(18일) 새벽부터 제주도앞바다에 바람이 약해지고 물결이 0.5~1.0m로 낮게 일겠습니다.'), '2026-10-17', '2026-10-18', '내일'), ['내일 새벽부터 제주도앞바다 물결 0.5~1.0m로 낮아짐']);
        assert.deepStrictEqual(R.bulletinNotes(SEA('○ (해상) 내일(18일) 새벽부터 제주도앞바다에서는 물결이 2.0~3.0m로 높게 일겠으나 오후에는 낮아지겠으니 유의하기 바랍니다.'), '2026-10-17', '2026-10-18', '내일'), ['내일 새벽부터 제주도앞바다 물결 2.0~3.0m로 높게 일다가 낮아짐']);
        assert.deepStrictEqual(R.bulletinNotes(SEA('○ (해상) 내일(18일) 제주도앞바다에는 물결이 1.0~2.0m로 일겠습니다.'), '2026-10-17', '2026-10-18', '내일'), ['내일 제주도앞바다 물결 1.0~2.0m'], '방향 말이 없으면 수치만');
    });
    await check('[§11.10.2-2] 지역·「곳에 따라」·「가능성」 단서를 남긴다 · 「한편 … 강수 강도와 강수량의 차이」 일반 안내는 뺀다', () => {
        const rain = RAIN('○ (강수) 제주도는 내일(18일) 이른 새벽(00~03시)부터 산지에 비가 시작되어 오후(12~18시)부터 그 밖의 지역으로 점차 확대되겠고, 이 비는 모레(19일) 낮(12~15시)까지 이어지는 곳이 있겠습니다.\n- 한편, 내일(18일) 내리는 비는 지역에 따라 강수 강도와 강수량의 차이가 있겠으니, 최신 기상정보와 기상레이더 영상을 참고하기 바랍니다.');
        assert.deepStrictEqual(R.bulletinNotes(rain, '2026-10-17', '2026-10-18', '내일'), ['내일 이른 새벽(00~03시)부터 산지에 비, 오후(12~18시)부터 그 밖의 지역으로 확대']);
        const all = R.bulletinScan(BULLETIN, '2026-10-17', '2026-10-18', '내일').notes.map((n) => n.text);
        assert.ok(all.includes('내일 새벽부터 제주도산지와 제주시(북부, 중산간) 등에 순간풍속 20m/s 안팎의 매우 강한 바람(강풍특보 가능성)'), all.join(' / '));
        assert.ok(all.includes('내일부터 중산간 이상 지역에 짙은 안개(곳에 따라)') && all.includes('내일 저녁부터 돌풍과 천둥·번개(곳에 따라)'), all.join(' / '));
        assert.ok(!all.includes('내일 비'), '강수 강도·강수량 차이 안내는 특이사항 아님');
        assert.equal(R.shortList('제주도산지와 제주시(북부, 중산간), 서귀포시중산간, 추자도', 24), '제주도산지와 제주시(북부, 중산간) 등', '괄호 안에서 끊지 않음');
    });
    await check('[§11.10.2-3] 그날 토막이 있는데 뽑지 못하면 「없습니다」가 아니라 「뽑지 못했습니다 — 원문 확인」 · 「물결이 최대 4m」·km/h 만 있는 순간풍속도 뽑는다', () => {
        assert.deepStrictEqual(R.bulletinNotes(SEA('○ (해상) 내일(18일) 제주도앞바다에 물결이 최대 4m로 매우 높게 일겠습니다.\n○ (강풍) 내일(18일) 제주도에는 순간풍속 90km/h 안팎으로 매우 강하게 불겠습니다.'), '2026-10-17', '2026-10-18', '내일'),
            ['내일 제주도에 순간풍속 90km/h 안팎의 매우 강한 바람', '내일 제주도앞바다 물결 최대 4m로 높아짐']);
        assert.deepStrictEqual(R.bulletinScan(SEA('○ (해상) 내일(18일)은 제주도앞바다의 물결이 점차 낮아지겠습니다.'), '2026-10-17', '2026-10-18', '내일'), { found: true, notes: [] });
        assert.deepStrictEqual(R.bulletinScan(SEA('○ (해상) 오늘(17일) 제주도앞바다에 물결이 1.0~2.0m로 일겠습니다.'), '2026-10-17', '2026-10-18', '내일'), { found: false, notes: [] }, '그날 토막이 없으면 found 거짓');
        const rg = REGIONAL(); rg.offices['184'].summary = SEA('○ (해상) 오늘(17일)은 제주도앞바다의 물결이 점차 낮아지겠습니다.');
        const w = R.buildBriefing({ ...hallim(), zoneWeather: I.collectZoneWeather({ lat: 33.41, lon: 126.26 }, rg) }, WIN, { generatedAt: R.isoKst(T0) }).summary.weather;
        assert.deepStrictEqual([w.notes, w.notesFound, w.bulletinMissing], [[], true, false]);
        const sandbox = { window: {} }; require('vm').runInNewContext(fs.readFileSync(path.join(__dirname, '../../client/js/forecast/station-briefing/station_briefing_render.js'), 'utf8'), sandbox);
        const txt = sandbox.window.StationBriefingRender.notesEmptyText;
        assert.equal(txt(w), '단기 전망에서 항목을 뽑지 못했습니다 — 원문(제주지방기상청 단기 전망 (10.17 04:40 발표))을 확인하세요.');
        assert.equal(txt({ notesFound: false }), '이 날에 해당하는 특보·강풍·해상 특이사항이 단기 전망에 없습니다.'); assert.equal(txt({}), '이 날에 해당하는 특보·강풍·해상 특이사항이 단기 전망에 없습니다.', 'notesFound 없는 옛 브리핑');
    });
    await check('[§11.10.2-4] 가장 가까운 특보구역 줄을 먼저(상한 3줄에 그 구역 줄이 남음) · 「(북부앞바다 제외)」는 맞음이 아님 · 같은 구역의 풍랑 예비특보 줄과 해상 줄은 한 줄', () => {
        const north = R.bulletinNotes(BULLETIN, '2026-10-17', '2026-10-18', '내일', '제주도북부앞바다');
        assert.ok(north.includes('내일 새벽부터 제주도북부앞바다 물결 1.0~2.5m로 높아짐'), north.join(' / '));
        assert.ok(!north.some((x) => x.startsWith('풍랑 예비특보')), '북부앞바다 제외 구역 줄은 맞음으로 세지 않아 뒤로 — ' + north.join(' / '));
        const west = R.bulletinNotes(BULLETIN, '2026-10-17', '2026-10-18', '내일', '제주도서부앞바다');
        assert.ok(west.includes('풍랑 예비특보: 내일 새벽(00~06시) 제주도남쪽안쪽먼바다, 제주도앞바다(북부앞바다 제외), 남해서부서쪽먼바다 — 물결 1.5~3.0m로 높아짐'), west.join(' / '));
        assert.ok(!west.some((x) => /^내일 새벽부터 제주도남쪽안쪽먼바다/.test(x)), '같은 구역 나열 해상 줄은 예비특보 줄에 합침');
        assert.deepStrictEqual([R.zoneHit('제주도앞바다(북부앞바다 제외), 남해서부서쪽먼바다', '제주도서부앞바다'), R.zoneHit('제주도앞바다(북부앞바다 제외)', '제주도북부앞바다'), R.zoneHit('제주도해상와 남해서부서쪽먼바다', '제주도북부앞바다'), R.zoneHit('남해서부서쪽먼바다', '제주도북부앞바다')], [true, false, true, false]);
        // weatherSummary 도 그 구역(wx.zone)으로 고른다 — 애월 위치 → 제주도북부앞바다
        const rg = REGIONAL(); rg.coastal = { 제주도북부앞바다: jejuWest };
        const n = R.buildBriefing({ ...hallim(), zoneWeather: I.collectZoneWeather({ lat: 33.46, lon: 126.33 }, rg) }, R.editionWindow('night', Date.parse(at(23))), { generatedAt: R.isoKst(Date.parse(at(23))) }).summary.weather;
        assert.ok(n.zone === '제주도북부앞바다' && n.notes.includes('내일 새벽부터 제주도북부앞바다 물결 1.0~2.5m로 높아짐'), n.zone + ' / ' + n.notes.join(' / '));
    });
    await check('[§11.10.2-5] 가장 가까운 앞바다가 30km 넘게 멀면 — 더 가까운 먼바다 예보가 있으면 그것(울릉 → 동해중부안쪽먼바다), 없으면 그 앞바다 + 「약 N km 떨어짐」 안내 · 30km 안(한림)은 안내 없음', () => {
        // 울릉파출소 추정 위치(estimateLocation — config 관광지·위험구역 32점 평균. 카카오 좌표는 이 환경에서 못 얻음): 가장 가까운 앞바다 = 강원남부앞바다 115.9km
        const UL = { lat: 37.50405, lon: 130.87499 }, P2 = [P('20261017', 'am', '흐림', '2.0~3.0', '북 / 9~13'), P('20261017', 'pm', '흐림', '2.0~3.5', '북 / 10~14')];
        assert.deepStrictEqual([I.nearestCoastalZone(UL).zone, I.nearestCoastalZone(UL).distKm, I.COASTAL_MAX_KM], ['강원남부앞바다', 115.9, 30]);
        const rg = { coastal: { 강원남부앞바다: coastal('10.17. 05:00', P2) }, offices: { 105: { officeName: '강원지방기상청', publishTime: '10.17. 05:00', marineForecast: { 동해중부안쪽먼바다: { periods: P2 } } } }, zoneOffice: require('../regional_forecast_collector').ZONE_TO_OFFICE_MAP };
        const far = I.collectZoneWeather(UL, rg);
        assert.deepStrictEqual([far.zone, far.kind, far.distKm, far.note], ['동해중부안쪽먼바다', 'far', 0, '가장 가까운 앞바다 특보구역(강원남부앞바다)이 약 115.9km 떨어져 있어 파출소가 있는 먼바다 특보구역 예보입니다']);
        const noFar = I.collectZoneWeather(UL, { ...rg, offices: {} });
        assert.deepStrictEqual([noFar.zone, noFar.kind, noFar.note], ['강원남부앞바다', 'coastal', '가장 가까운 앞바다 특보구역(약 115.9km 떨어짐) 예보입니다']);
        const w = R.buildBriefing({ ...hallim(), zoneWeather: far }, WIN, { generatedAt: R.isoKst(T0) }).summary.weather;
        assert.deepStrictEqual([w.zone, w.kind, w.note, w.rows[0].text, w.source], ['동해중부안쪽먼바다', 'far', far.note, '흐림 · 파고 2.0~3.0m · 풍속 9~13m/s · 풍향 북', '강원지방기상청 단기 해상예보 (10.17 05:00 발표)']);
        assert.equal(I.collectZoneWeather({ lat: 33.41, lon: 126.26 }, REGIONAL()).note, null, '한림 0.5km — 안내 없음');
    });
    await check('[§11.10.2-6] AI 해설이 서버 결론을 뒤집거나 누그러뜨리면 실패(평온·위험하지 않·위험이 크지 않·위험도가 낮·가능성은 낮·안심) · 출항 지시도 실패 · 시간 흐름 문장은 통과', () => {
        for (const t of ['오늘 해상은 평온합니다.', '위험하지 않습니다. 안심하고 출항하셔도 됩니다', '해상 위험이 크지 않습니다.', '위험도가 낮습니다.', '사고가 날 가능성은 낮습니다.']) assert.ok(vErr(t).includes('forbidden:결론과 다른 단정'), t + ' → ' + vErr(t).join(','));
        assert.ok(vErr('절대 출항하지 마십시오.').includes('forbidden:출항 지시'));
        assert.deepStrictEqual(vErr('오전에는 바람이 약하지만 15시부터 파고 2.4m로 높아집니다.'), []);
        assert.deepStrictEqual(vErr('오전에는 바다가 잔잔하지만 15시부터 파고 2.4m로 높아집니다. 21시부터는 위험이 낮아집니다.'), [], '「잔잔하지만」·「낮아집니다」(언제 나아지는지)는 된다');
    });
    await check('[§11.10.2-7] 「두세 곳」「서너 곳」「한두 곳」「세 번」은 늘 실패 · 「세 군데」는 곳으로 셈 · 셈말은 그 문단(육상·해상) 결론·근거에 있는 수만', () => {
        for (const w of ['두세 곳', '서너 곳', '한두 곳', '두서너 곳']) assert.ok(vErr(sea0('비양도 해역 ' + w + '에서 물결이 높습니다.')).includes('number:hangul:' + w), w);
        assert.ok(vErr(sea0('비양도 해역은 오늘 세 번 높아집니다.')).includes('number:hangul:세 번'));
        assert.deepStrictEqual(vErr(sea0('비양도 해역이 두번째로 높습니다.')), [], '「두번째」(차례)는 셈말 아님');
        // §11.10.3: 해상 근거의 해역 수는 「칸」(곳·개 아님)이라 해상 셈말 열쇠가 없다
        assert.deepStrictEqual([si.count_keys.sea, si.count_keys.land], [[], ['1|곳', '2|곳', '4|곳']]);
        assert.ok(vErr(sea0('비양도 해역 등 두 곳에서 물결이 높습니다.')).includes('number:hangul:두 곳'), '2곳은 육상 근거의 수 — 해상 문단에서는 실패');
        assert.deepStrictEqual(vErr(good.sea, '협재해수욕장 등 두 곳은 사람이 평소보다 많습니다.'), [], '육상 문단은 통과');
        assert.deepStrictEqual(vErr(good.sea, '협재해수욕장 등 네 군데를 살펴봤습니다.'), [], '「네 군데」 = 4곳(육상 근거)');
        assert.ok(vErr(good.sea, '협재해수욕장 등 세 군데는 붐빕니다.').includes('number:hangul:세 군데'));
    });
    await check('[§11.10.2-8] 기상청 해역 이름은 그 관할에 관련된 것만(기상청 전망 발췌·(기상) 칸 구역·특이사항) 정확히 같을 때 · 「제주도」는 제주 관할이거나 그 글에 있을 때만', () => {
        const siK = AI.stationInput(b, { excerpt: { 해상: '오늘 밤부터 제주도남쪽바깥먼바다에 바람이 강하게 불겠습니다.' } });
        assert.deepStrictEqual(siK.kma_zones, ['제주도', '제주도남쪽바깥먼바다']);
        assert.ok(vo({ land: good.land, sea: '오후부터 가짜제주도남쪽바깥먼바다에서 바람이 강해집니다.' }, siK).errors.some((e) => e.startsWith('place:') && e.includes('가짜제주도남쪽바깥먼바다')), '끝말 일치로 통과하지 않음');
        assert.ok(vo({ land: good.land, sea: '오후부터 서해중부안쪽먼바다에서 바람이 강해집니다.' }, siK).errors.some((e) => e.includes('서해중부안쪽먼바다')), '관련 글에 없는 해역');
        const inc = R.buildBriefing({ ...seaOnlyInput({}), key: '인천해양경찰서|영흥파출소', name: '영흥파출소', office: '인천해양경찰서', region: '중부지방해양경찰청' }, WIN, { generatedAt: R.isoKst(T0) });
        const siI = AI.stationInput(inc, { excerpt: { 해상: '서해중부안쪽먼바다에 물결이 높게 일겠습니다.' } });
        assert.deepStrictEqual(siI.kma_zones, ['서해중부안쪽먼바다'], '인천 관할에는 「제주도」 없음');
        assert.ok(vo({ land: null, sea: '오후부터 제주도에는 비가 옵니다.' }, siI).errors.some((e) => e.startsWith('place:') && e.includes('제주도')));
        assert.deepStrictEqual(vo({ land: null, sea: '오후부터 서해중부안쪽먼바다에서 바람이 강해집니다.' }, siI).errors, []);
    });
    await check('[§11.10.2-9] 문장 나누기 — 「…다.다음」·줄바꿈도 문장 끝(「2.4m」·「천둥.번개」는 아님) · 문단 글자 상한(§11.10.4 부터 420자) 넘으면 실패', () => {
        const vRaw = (sea) => AI.validateOverview({ land: good.land, sea }, si).errors;   // 모양 규칙을 보는 사례 — vo(모양 뺌)가 아니라 그대로
        assert.equal(AI.sentences('바람이 셉니다.두번째 문장입니다.세번째입니다.').length, 3);
        assert.equal(AI.sentences('바람이 셉니다\n두번째 문장입니다\n세번째입니다').length, 3);
        assert.equal(AI.sentences('파고 2.4m로 높아지고 천둥.번개가 칩니다.').length, 1);
        // §11.10.4: 문장 수 3~5 — 붙여 쓴 여섯 문장은 6 으로 센다(종전 1~2문장 시절엔 세 문장을 3 으로 세어 실패시켰다)
        assert.ok(vRaw('바람이 셉니다.두번째입니다.세번째입니다.네번째입니다.다섯번째입니다.따라서 관심이 필요합니다.').includes('shape:sea-sentences-6'));
        const long = '비양도 해역에서 ' + '바람과 물결이 함께 높아지며 '.repeat(27) + '15시부터 파고 2.4m로 높아집니다. 저녁에도 이어집니다. 따라서 관심이 필요합니다.';
        assert.ok(long.length > AI.MAX_CHARS && vRaw(long).includes('shape:sea-too-long-' + long.length), long.length + ' ' + vRaw(long).join(','));
    });
    await check('[§11.10.2-10] 오류 상한 기록(errorsCapped)도 3일이 지나면 지운다 — status 와 다음 기록 둘 다', () => {
        const now = Date.parse('2026-10-17T08:10:00+09:00');
        const d = fs.mkdtempSync(path.join(tmp, 'cap-'));
        I.writeJson(path.join(d, 'state.json'), { done: [], errors: [], errorsCapped: { at: '2026-10-14T09:00:00+09:00', dropped: 3, cap: 5000 } });
        const s2 = SB.createService({ dir: d, clock: () => now, risk: fakeRisk, marine: fakeMarine, loadStations: () => fakeStations, alertsFile: path.join(d, 'none.json'), hazardFeatures: () => [], kma: () => null, tideDeps: { anchors: [] } });
        assert.equal(s2.status().errorsCapped, null);
        assert.equal(SB.freshCapped({ at: '2026-10-14T09:00:00+09:00', dropped: 3, cap: 5000 }, now), null);
        assert.deepStrictEqual(SB.freshCapped({ at: '2026-10-15T00:00:00+09:00', dropped: 3, cap: 5000 }, now), { at: '2026-10-15T00:00:00+09:00', dropped: 3, cap: 5000 });
    });
    await check('[§11.10.2-11] 관리자 오류 마크다운 — 이유 글의 \\ | ` < > 를 이스케이프', () => {
        const sandbox = { window: {} }; require('vm').runInNewContext(fs.readFileSync(path.join(__dirname, '../../client/js/admin/admin_station_briefing.js'), 'utf8'), sandbox);
        const md = sandbox.window.renderStationBriefingAdmin.errorsMarkdown([{ at: '2026-10-17T08:03:10+09:00', edition: 'morning', date: '2026-10-17', stage: 'validate', provider: 'chatgpt', stations: ['제주해양경찰서|한림파출소'], reason: 'place:<b>`x`\\y|z' }], Date.parse('2026-10-17T10:05:00+09:00'), { days: 3 });
        assert.ok(md.includes('| place:\\<b\\>\\`x\\`\\\\y\\|z |'), md);
    });
    await check('[§11.10.2-12] 날짜 표지 「18일부터」·「1일부터 3일까지」(사이 날 포함)도 받는다 · 「15일간」은 아님', () => {
        assert.deepStrictEqual(R.bulletinNotes(SEA('○ (해상) 18일부터 제주도앞바다에 물결이 2.0~3.0m로 높게 일겠습니다.'), '2026-10-17', '2026-10-18', '내일'), ['내일부터 제주도앞바다 물결 2.0~3.0m로 높아짐']);
        assert.deepStrictEqual(R.bulletinNotes(SEA('○ (해상) 1일부터 3일까지 동해중부앞바다에 물결이 2.0~4.0m로 높게 일겠습니다.'), '2026-10-31', '2026-11-02', '모레'), ['모레 동해중부앞바다 물결 2.0~4.0m로 높아짐']);
        assert.deepStrictEqual(R.bulletinScan(SEA('○ (해상) 18일간 제주도앞바다에 물결이 2.0~3.0m로 높게 일겠습니다.'), '2026-10-17', '2026-10-18', '내일').notes, [], '「18일간」은 날짜 표지 아님');
    });
    // ── 2026-10-17 사용자 결정(설계서 §11.10.3) — (고립 주의)·육상 권고·해상 근거(칸·해양사고 위험예보·해구 줄은 넘을 때만·지도 재료) 1:1. 고치기 전 코드(6ec172ffa)에서 모두 실패함을 확인했다 ──
    const tideFx = { anchorId: 'J7', distKm: 3.2, date: '2026-10-17', curve: [], peaks: [{ type: 'high', t: '02:10', cm: 210 }, { type: 'low', t: '08:16', cm: 20 }, { type: 'high', t: '14:30', cm: 200 }, { type: 'low', t: '22:09', cm: 25 }], prevPeak: null, nextPeak: null, rocks: null };
    await check('[§11.10.3-1] (고립 주의) — 관할 관광지(육상 같은 목록) 중 고립 사고 지점 전부를 건수 많은 순·이름 순 표로, 저조 시간(창 안) 전후 문구 · 「물이 차오르기 전에 나오세요」 없음', () => {
        // 수집: 연안사고 기록(coastDayDetail history)에서 고립만 센다 · 기록을 못 쓰면 null(0 과 가름)
        const hist = (types) => ({ t: at(8), index: 10, band: '평소 수준', rows: [], notices: [], daily: { peakAt: at(8), notices: [] }, history: { available: true, from: '2020-01-01', to: '2024-12-31', accidents: types.map((type) => ({ type })) }, missing: [] });
        const risk = { coastDayDetail: (id) => id === 'na' ? { ...hist([]), history: { available: false } } : hist(id === 'a' ? ['고립', '익수', '고립'] : id === 'b' ? ['추락'] : ['고립']) };
        const L = I.collectLand([{ id: 'a', name: '가' }, { id: 'b', name: '나' }, { id: 'c', name: '다' }, { id: 'na', name: '라' }], [], { risk, t: at(8) });
        assert.deepStrictEqual(L.spots.map((s) => s.isolation), [2, 0, 1, null]);
        // 규칙: 12곳(카드 상한 10 넘음)이 모두 표에 — 건수 많은 순, 같으면 이름 순
        const spots = Array.from({ length: 12 }, (_, i) => ({ id: 's' + i, name: '지점' + pad(11 - i), lat: 33, lon: 126, index: 10, band: '평소 수준', notices: {}, missing: [], isolation: i < 2 ? 3 : 1, history: { count: 3, from: '2020-01-01', to: '2024-12-31', topTypes: [] } }))
            .concat([{ id: 'z', name: '고립없음', lat: 33, lon: 126, index: 10, band: '평소 수준', notices: {}, missing: [], isolation: 0, history: null }]);
        const x = R.buildBriefing({ ...seaOnlyInput({}), seaOnly: false, land: { spots, hazardOnly: [] }, tide: tideFx }, WIN, { generatedAt: R.isoKst(T0) });
        const iso = x.summary.isolation;
        assert.equal(iso.rows.length, 12, '모두(카드 상한 없음)'); assert.deepStrictEqual(iso.rows.slice(0, 3), [{ name: '지점10', count: 3 }, { name: '지점11', count: 3 }, { name: '지점00', count: 1 }]);
        assert.ok(!iso.rows.some((r) => r.name === '고립없음'));
        assert.equal(iso.text, '(고립 주의) 저조 시간(08:16·22:09) 전후 사고 지점(12개소) 확인 및 주의가 필요합니다.'); assert.equal(iso.link, '사고 지점(12개소)');
        assert.equal(iso.caption, '2020~2024 연안사고 기록 중 고립(관광지 구역 + 앞바다 500m)');
        assert.deepStrictEqual(x.tide.lows, ['08:16', '22:09']); assert.ok(!JSON.stringify(x).includes('차오르기 전에'), '「물이 차오르기 전에 나오세요」는 어디에도 없음');
        assert.equal(x.summary.tide[0], '08:16 저조 뒤부터 물이 차오릅니다(14:30 고조) · 22:09 저조 뒤부터 물이 차오릅니다.');
        // 17:30 판(15시~) — 그 창 안 저조만
        assert.equal(R.buildBriefing({ ...seaOnlyInput({}), seaOnly: false, land: { spots, hazardOnly: [] }, tide: tideFx }, R.editionWindow('evening', Date.parse('2026-10-17T17:30:00+09:00')), { generatedAt: '2026-10-17T17:30:00+09:00' }).summary.isolation.text, '(고립 주의) 저조 시간(22:09) 전후 사고 지점(12개소) 확인 및 주의가 필요합니다.');
        // 없을 때 — 고립 지점 0 · 해상만 관할 · 조석 칸 없는 관할(동해 등)은 줄을 넣지 않는다
        assert.equal(R.buildBriefing({ ...seaOnlyInput({}), seaOnly: false, land: { spots: spots.slice(-1), hazardOnly: [] }, tide: tideFx }, WIN, { generatedAt: R.isoKst(T0) }).summary.isolation, null);
        assert.equal(R.buildBriefing({ ...seaOnlyInput({}), tide: tideFx }, WIN, { generatedAt: R.isoKst(T0) }).summary.isolation, null);
        assert.equal(R.buildBriefing({ ...seaOnlyInput({}), seaOnly: false, land: { spots, hazardOnly: [] }, tide: null }, WIN, { generatedAt: R.isoKst(T0) }).summary.isolation, null);
    });
    await check('[§11.10.3-2] 육상 — 공통 이유 줄에 「— A·B 공통」 꼬리 없음 · 권고 「… 주변 연안사고에 …가 필요합니다」 · 관심 없으면 「관할 연안사고에 평소처럼 관심이 필요합니다」', () => {
        const spots = Array.from({ length: 3 }, (_, i) => ({ id: 's' + i, name: ['금능석물원', '월령포구', '한림공원'][i], lat: 33, lon: 126, index: 80, band: '높음', people: { ratio: 1.5, score: 0.5 }, missing: [],
            notices: { effective: [], prelim: ['풍랑주의보'], detail: [] } }));
        const x = R.buildBriefing({ ...seaOnlyInput({}), seaOnly: false, land: { spots, hazardOnly: [] } }, WIN, { generatedAt: R.isoKst(T0) });
        assert.equal(x.summary.land.basis[x.summary.land.basis.length - 1], '풍랑주의보 예비특보');
        assert.ok(!JSON.stringify(x.summary.land).includes('공통'));
        assert.equal(x.summary.land.advice, '금능석물원·월령포구·한림공원 주변 연안사고에 주의가 필요합니다.');
        assert.ok(!JSON.stringify(x.summary).includes('물가 접근'));
    });
    await check('[§11.10.3-3] 해상 근거 — 「관할 해역 N칸 중 위험이 높아진 해역 M칸」(같은 단위) · 「해양사고 위험예보만 \'주의·경계\'인 해역 K칸」+풀이 · 지도 재료(관할 경계·칸 상자) · 권고에 「경」·해구 꼬리 없음 · 「공식 사고예보」 없음', () => {
        const cg = { level: '높음', index: 12, at: at(15) }, box = (i) => [126, 33 + i * 0.01, 126.04, 33.04 + i * 0.01];
        const area = [[[[125.9, 32.9], [125.9, 33.3], [126.3, 33.3], [126.3, 32.9], [125.9, 32.9]]]];
        const regions = [region(1, { [at(9)]: { accident: '경계' } }, { box: box(1) }), region(2, { [at(12)]: { accident: '주의' } }, { box: box(2) }), region(3, { [at(15)]: { accident: '경계', congestion: cg } }, { box: box(3), haegu: { major: 232, sub: 2, label: '232-2' } }), region(4, {}, { box: box(4) })];
        const x = R.buildBriefing({ ...seaOnlyInput({ reviewedCells: 9, regions }), area }, WIN, { generatedAt: R.isoKst(T0) });
        const S = x.summary.sea;
        assert.equal(S.basis[0], '관할 해역 4칸 중 위험이 높아진 해역 1칸', '분모 = 검토한 해역 수(사고·혼잡 칸을 따로 센 reviewedCells 9 아님)');
        assert.equal(S.basis[1], "해양사고 위험예보만 '주의·경계'인 해역 2칸");
        assert.deepStrictEqual(S.area, area);
        assert.deepStrictEqual(S.detail, [{ line: 0, key: 'overview', boxes: [box(3)] }, { line: 1, key: 'accidentOnly', note: R.ACC_ONLY_NOTE, boxes: [box(1), box(2)] }]);
        assert.equal(R.ACC_ONLY_NOTE, '(한국해양교통안전공단 예보에서는 위험 단계지만, 같은 시간대에 높은 파도·강한 바람이나 선박 몰림은 예상되지 않은 해역)');
        assert.ok(S.basis.some((t) => t.endsWith("— 해양사고 위험예보 '경계'(예상)")), S.basis.join(' / '));
        assert.equal(S.advice, '15~18시 제주 북방 3.0해리 해역 운항에 경계가 필요합니다.');
        assert.ok(!JSON.stringify(x).includes('공식 사고예보'), '브리핑 안 이름은 「해양사고 위험예보」');
        assert.equal(R.SOURCE_LABEL.accident, '해양사고 위험예보');
        // 저장하는 sea 절에는 도형을 두 번 넣지 않는다(summary.sea 에만)
        assert.ok(!JSON.stringify(x.sea).includes('125.9'));
        // 경계만 있으면 「'경계'」 · 지도 재료가 없으면(관할 도형 없음) detail 은 있으나 상자·경계 없음 → 화면은 글만
        const y = R.buildBriefing(seaOnlyInput({ regions: [region(1, { [at(9)]: { accident: '경계' } })] }), WIN, { generatedAt: R.isoKst(T0) });
        assert.deepStrictEqual([y.summary.sea.basis[1], y.summary.sea.area, y.summary.sea.detail], ["해양사고 위험예보만 '경계'인 해역 1칸", null, [{ line: 1, key: 'accidentOnly', note: R.ACC_ONLY_NOTE }]]);
    });
    await check('[§11.10.3-4] 해구 예보 줄은 기준(파고 2m·풍속 12m/s)을 넘을 때만(사용자 「(가)로 진행하자」) — 넘으면 「대해구 232 예보 15시부터 …로 높아짐(예상)」+해구 상자, 넘지 않으면 줄 없음', () => {
        const rows = (list) => list.map(([h, wh, ws]) => ({ at: at(h), wh, ws }));
        const over = R.buildBriefing({ ...seaOnlyInput({ regions: [region(1, {}, { box: [126, 33, 126.04, 33.04] })], weather: { 232: { label: '대해구 232', box: [126, 33, 126.5, 33.5], rows: rows([[6, 0.8, 5], [9, 1.0, 6], [12, 1.4, 9], [15, 2.4, 13], [18, 2.6, 14], [21, 1.8, 10]]) } } }), area: [[[[126, 33], [126, 33.2], [126.2, 33.2], [126, 33]]]] }, WIN, { generatedAt: R.isoKst(T0) });
        const i = over.summary.sea.basis.findIndex((t) => t.startsWith('대해구 232 예보'));
        assert.equal(over.summary.sea.basis[i], '대해구 232 예보 15시부터 파고 2.4m·풍속 13m/s로 높아짐(예상), 21시부터 기준 아래로 내려감');
        assert.deepStrictEqual(over.summary.sea.detail.find((d) => d.key === 'haegu'), { line: i, key: 'haegu', major: '232', boxes: [[126, 33, 126.5, 33.5]] });
        const calm = R.buildBriefing(seaOnlyInput({ weather: { 222: { label: '대해구 222', box: [126, 33.5, 126.5, 34], rows: rows([[6, 1.0, 8], [9, 1.7, 11.7], [12, 1.2, 9]]) } } }), WIN, { generatedAt: R.isoKst(T0) });
        assert.ok(calm.sea.weather && calm.sea.weather.onsetAt === null, '해상 분석 칸의 흐름 글은 그대로 있다');
        assert.ok(!calm.summary.sea.basis.some((t) => t.includes('대해구') || t.includes('미만')), calm.summary.sea.basis.join(' / '));
        assert.ok(!calm.summary.sea.detail.some((d) => d.key === 'haegu'));
        // 해구 예보 원천은 ok 인데 자료가 없으면 종전처럼 밝힌다
        assert.ok(R.buildBriefing(seaOnlyInput({}), WIN, { generatedAt: R.isoKst(T0) }).summary.sea.basis.includes('해구 예보 자료를 확인하지 못했습니다'));
    });
    await check('[§11.10.3-5] 지도 재료 수집 — 관할 도형은 4자리·단순화(실제 한림 7점, 가장 큰 여호도 15KB 아래) · 해구 상자는 marine_zone_area.json · 사고 칸 상자는 웹 메르카토르 5km 칸 그대로', () => {
        const st = I.loadStations(), hl = st.find((s) => s.name === '한림파출소');
        const a = I.areaOf(hl.geometry); assert.equal(a.length, 1); assert.ok(a[0][0].every((p) => p.every((v) => Math.abs(v * 1e4 - Math.round(v * 1e4)) < 1e-6)), '소수 4자리');
        const sizes = st.map((s) => JSON.stringify(I.areaOf(s.geometry)).length);
        assert.ok(Math.max(...sizes) < 15000, '가장 큰 관할 도형 ' + Math.max(...sizes) + ' bytes');
        assert.deepStrictEqual(I.haeguBox(232), [126, 33, 126.5, 33.5]); assert.deepStrictEqual(I.haeguBox(222), [126, 33.5, 126.5, 34]); assert.equal(I.haeguBox(99999), null);
        const [w, s, e, n] = require('../services/mtis_accident_grid').cellBounds(126.041135, 33.088353);
        assert.deepStrictEqual(I.boxOf({ type: 'Polygon', coordinates: [[[w, s], [w, n], [e, n], [e, s], [w, s]]] }), [126.0187, 33.0695, 126.0636, 33.1072]);
        // 실제 크기: 가로 약 4.19km(위도 33.09) — 「칸」 설명(약 3.9~4.2km)의 근거
        const km = R.haversineKm(33.088, w, 33.088, e); assert.ok(km > 4.1 && km < 4.25, km);
    });
    // ── 2026-10-17 사용자 결정(설계서 §11.10.4) — 「연안 안전 브리핑」 이름·미리 만들어 두었다가 정해진 시각에 공개·연안/해상 AI 분석 문단(3~5문장)·VM 최대 3번 → Gemini → 규칙 분석 ──
    // 「[§11.10.4-1]…[§11.10.4-9]」 — 고치기 전 코드(e1c0d0321)에서 모두 실패함을 확인했다(설계서 §11.10.4 시험 줄).
    await check('[§11.10.4-1] 판 일정 — 만들기 시작 07:10·17:10·22:40 → 공개 07:30·17:30·23:00(사용자 「07:10분에 만들기 시작」·「아침 보이는 시각은 07시 30분」) · 자정 뒤 늦은 밤 판은 전날 23:00(이미 지남) · 특보·관리자는 공개 시각 없음', () => {
        assert.deepStrictEqual(R.EDITIONS.map((e) => [e.kind, e.h * 60 + e.m, e.ph * 60 + e.pm]), [['morning', 430, 450], ['evening', 1030, 1050], ['night', 1360, 1380]]);
        const t = (s) => Date.parse('2026-10-17T' + s + ':00+09:00');
        assert.equal(R.publishAtFor('morning', t('07:10')), '2026-10-17T07:30:00+09:00');
        assert.equal(R.publishAtFor('evening', t('17:10')), '2026-10-17T17:30:00+09:00');
        assert.equal(R.publishAtFor('night', t('22:40')), '2026-10-17T23:00:00+09:00');
        assert.equal(R.publishAtFor('night', t('01:10')), '2026-10-16T23:00:00+09:00', '자정 뒤 늦게 만든 밤 판 — 곧바로 보임');
        assert.equal(R.publishAtFor('warning', t('10:00')), null); assert.equal(R.publishAtFor('manual', t('10:00')), null);
        // 창은 그대로 — 07:10 아침 판도 06시 칸부터, 17:10 저녁 판도 15시 칸부터, 22:40 밤 판도 21시 칸부터(내일 대상) · 기상 칸 「오늘 오전·오후」/「오늘 오후·내일 오전」/「내일 오전·오후」도 그대로
        assert.equal(R.editionWindow('morning', t('07:10')).from, at(6)); assert.equal(R.editionWindow('evening', t('17:10')).from, at(15));
        const n = R.editionWindow('night', t('22:40')); assert.deepStrictEqual([n.targetDate, n.from], ['2026-10-18', at(21)]);
        assert.deepStrictEqual(R.weatherSlotsFor(R.editionWindow('morning', t('07:10'))), [{ date: '20261017', period: 'am' }, { date: '20261017', period: 'pm' }]);
        assert.deepStrictEqual(R.weatherSlotsFor(R.editionWindow('evening', t('17:10'))), [{ date: '20261017', period: 'pm' }, { date: '20261018', period: 'am' }]);
        assert.deepStrictEqual(R.weatherSlotsFor(n), [{ date: '20261018', period: 'am' }, { date: '20261018', period: 'pm' }]);
    });
    await check('[§11.10.4-2] 규칙 분석 문단(summary.analysis) — 연안·해상 각 3~5문장 · 마지막 「따라서 … 필요합니다」 · 「연안사고에」·「예상」 · 「공통」 없음 · 관심 이상 없음·해상만 관할도', () => {
        const A = b.summary.analysis;
        for (const k of ['land', 'sea']) { const n = AI.sentences(A[k]).length; assert.ok(n >= 3 && n <= 5, k + ' ' + n); assert.ok(/^따라서 .+ 필요합니다\.$/.test(AI.sentences(A[k]).pop()), A[k]); }
        assert.ok(A.land.startsWith("협재해수욕장은 연안 위험지수 72 '높음'(예상)으로 주의 필요 수준이며, 오늘 바뀐 요소는 방문객 평소의 1.8배(예상)"), A.land);
        assert.ok(A.land.endsWith('따라서 협재해수욕장 주변 연안사고에 주의가, 금능해수욕장 주변 연안사고에 관심이 필요합니다.'), A.land);
        assert.ok(A.sea.startsWith('대해구 232 예보는 15시부터 파고 2.4m·풍속 13m/s로 높아지고, 21시부터 기준 아래로 내려갈 것으로 예상됩니다.'), A.sea);
        assert.ok(A.sea.endsWith('따라서 15~24시 비양도 북북서방 1.4해리 해역 운항에 주의가 필요합니다.') && A.sea.includes('해양사고 위험예보'), A.sea);
        assert.ok(!/공통|공식 사고예보|관심 이상/.test(A.land + A.sea));
        // 관심 이상 없음 · 기준 미만 바다(사용자 예시 꼴 「…최대 파고는 0.4m, 풍속은 6.9m/s로 기준보다 낮을 것으로 예상됩니다」)
        const x = hallim(); x.land.spots.forEach((s) => { s.people.score = 0; s.notices.windMs = null; s.index = 5; s.band = '평소 수준'; }); x.sea.regions = []; x.sea.warnings = [];
        x.sea.weather = { 5099: { label: '대해구 5099', rows: [{ at: at(9), wh: 0.4, ws: 6.9 }, { at: at(12), wh: 0.3, ws: 5 }] } };
        const c = R.buildBriefing(x, WIN, { generatedAt: R.isoKst(T0) }).summary.analysis;
        assert.ok(c.land.endsWith('따라서 관할 연안사고에 평소처럼 관심이 필요합니다.') && AI.sentences(c.land).length >= 3, c.land);
        assert.ok(c.sea.includes('대해구 5099 예보의 최대 파고는 0.4m, 풍속은 6.9m/s로 기준(파고 2m·풍속 12m/s)보다 낮을 것으로 예상됩니다.') && c.sea.endsWith('따라서 한림파출소 관할 해상의 바람과 물결 변화에 관심이 필요합니다.') && AI.sentences(c.sea).length >= 3, c.sea);
        const so = R.buildBriefing({ ...hallim(), seaOnly: true, land: null }, WIN, { generatedAt: R.isoKst(T0) });
        assert.equal(so.summary.analysis.land, null); assert.ok(AI.sentences(so.summary.analysis.sea).length >= 3);
        // 조사: 괄호 덧말 앞 낱말로(「해역(232-2해구)은」) · 받침 ㄹ + 으로 → 로
        assert.equal(R.josa('비양도 북북서방 1.4해리 해역(232-2해구)', '은', '는'), '은'); assert.equal(R.josa("연안 위험지수 72 '높음'(예상)", '으로', '로'), '으로'); assert.equal(R.josa('바다물', '으로', '로'), '로');
        assert.equal(b.rulesVersion, 'station-briefing-rules-v10');
    });
    // 사용자 예시 꼴(돝섬해상유원지·대해구 5099)을 한림 고정 자료 이름·숫자로 옮긴 AI 분석 문단
    const ex = {
        land: "협재해수욕장은 연안 위험지수 '높음'으로 주의 필요 수준이고, 방문객이 평소의 1.8배로 예상됩니다. 위험구역과 과거 표류 사고 이력이 있어 사람이 늘어나는 오늘은 연안 상황 변화에 유의해야 합니다. 금능해수욕장은 관심 필요 수준입니다. 따라서 협재해수욕장에는 주의가, 금능해수욕장에는 관심이 필요합니다.",
        sea: "대해구 232 예보는 15시부터 파고 2.4m·풍속 13m/s로 높아질 것으로 예상됩니다. 21시부터는 제주도서부앞바다 풍랑주의보 예비특보 시각에 들어갑니다. 15~24시 비양도 주변 해역은 해양사고 위험예보 '주의'로 주의 필요 수준입니다. 따라서 비양도 주변 해역 운항에 주의가 필요합니다.",
    };
    await check('[§11.10.4-3] AI 분석 검증 — 사용자 예시 꼴(3~5문장·「따라서 A에는 주의가, B에는 관심이」)은 통과 · 2문장·6문장·마지막 「따라서」 없음·420자 넘음 실패 · 나열 꼴 「주의가,」도 그 대목 대상 단계로(바꿔 쓰면 실패)', () => {
        assert.deepStrictEqual(AI.validateOverview(ex, si).errors, []);
        const e = (o) => AI.validateOverview({ ...ex, ...o }, si).errors;
        assert.ok(e({ land: '협재해수욕장은 붐빕니다. 따라서 협재해수욕장에는 주의가 필요합니다.' }).includes('shape:land-sentences-2'));
        assert.ok(e({ sea: ex.sea.replace('따라서 비양도 주변 해역 운항에 주의가 필요합니다.', '비양도 주변 해역 운항에 주의가 필요합니다.') }).includes('shape:sea-no-conclusion'));
        assert.ok(e({ sea: ex.sea.replace('따라서', '한편 바람이 붑니다. 또 물결이 입니다. 따라서') }).includes('shape:sea-sentences-6'));
        const long = ex.land.replace('따라서', '바람과 물결이 함께 높아집니다 '.repeat(16) + '. 따라서');
        assert.ok(long.length > 420 && e({ land: long }).includes('shape:land-too-long-' + long.length), long.length);
        // 나열 꼴 — 금능(관심)에 주의를 붙이면 실패. 종전(문장 전체 상한)엔 같은 문장의 협재(주의) 때문에 통과했다.
        assert.ok(e({ land: ex.land.replace('따라서 협재해수욕장에는 주의가, 금능해수욕장에는 관심이 필요합니다.', '따라서 금능해수욕장에는 주의가, 협재해수욕장에는 관심이 필요합니다.') }).includes('level:주의>1'));
        assert.ok(e({ land: ex.land.replace('주의가, 금능해수욕장에는 관심이', '경계가, 금능해수욕장에는 관심이') }).includes('level:경계>2'));
        assert.deepStrictEqual([AI.MIN_S, AI.MAX_S, AI.MAX_CHARS, AI.VM_ATTEMPTS], [3, 5, 420, 3]);
        const pr = AI.buildPrompt(AI.batchInput([si], null));
        assert.ok(pr.includes('3~5문장') && pr.includes('따라서') && pr.includes('방문객이 평소의 2배로 예상') && pr.includes('retry_feedback') && pr.includes('연안 안전 브리핑'), '지시문: 3~5문장·따라서·예상·다시 시도 이유');
    });
    const one = stationsFor(1), k1 = one[0].key, bad1 = { ...ex, sea: ex.sea.replace('21시부터는 제주도서부앞바다', '21시부터는 하저리해수욕장 앞') };
    const fbOf = (prompt) => (idsIn(prompt)[0] || {}).retry_feedback || null;
    await check('[§11.10.4-4] 다시 시도 — VM 이 두 번 검증에 떨어지고 세 번째 통과: 두·세 번째 지시문에 버려진 이유(「place:하저리해수욕장 — 그 지명은 입력에 없다」) · 출처 chatgpt · 시도 번호 기록', async () => {
        const prompts = [];
        const ad = { vm: { available: () => true, call: async ({ prompt }) => { prompts.push(prompt); return JSON.stringify({ stations: idsIn(prompt).map((s) => ({ id: s.id, ...(prompts.length < 3 ? bad1 : ex) })) }); } }, gemini: { available: () => true, call: async () => { throw new Error('불리면 안 됨'); } } };
        const r = await AI.generate({ briefings: one, config: cfg, adapters: ad, now: T0 });
        assert.equal(prompts.length, 3); assert.equal(fbOf(prompts[0]), null, '첫 시도엔 이유 없음');
        assert.deepStrictEqual(fbOf(prompts[1]), { attempt: 2, reasons: ['place:하저리해수욕장 — 그 지명은 입력에 없다'] });
        assert.equal(fbOf(prompts[2]).attempt, 3);
        assert.deepStrictEqual([r.overviews[k1].source, r.overviews[k1].attempts, r.stats.ai, r.stats.retried, r.stats.template], ['chatgpt', 3, 1, 1, 0]);
        assert.deepStrictEqual(r.errors.map((x) => [x.stage, x.provider, x.attempt]), [['validate', 'chatgpt', 1], ['validate', 'chatgpt', 2]]);
        assert.equal(AI.explainError('level:주의>1'), 'level:주의>1 — 그 대목의 대상 단계는 「관심」까지다');
        assert.equal(AI.explainError('shape:sea-sentences-2'), 'shape:sea-sentences-2 — 해상 분석이 2문장이다(3~5문장)');
    });
    await check('[§11.10.4-5] 다시 시도 — VM 세 번 모두 실패 → Gemini 한 번(같은 이유 포함) 통과 · 모두 실패면 규칙 분석(source template, 글은 summary.analysis) · 시도 1~4 기록', async () => {
        const calls = [];
        const ad = { vm: { available: () => true, call: async ({ prompt }) => { calls.push('vm'); return JSON.stringify({ stations: idsIn(prompt).map((s) => ({ id: s.id, ...bad1 })) }); } },
            gemini: { available: () => true, call: async ({ prompt }) => { calls.push('gemini'); assert.equal(fbOf(prompt).attempt, 4); assert.ok(fbOf(prompt).reasons[0].startsWith('place:하저리해수욕장')); return JSON.stringify({ stations: idsIn(prompt).map((s) => ({ id: s.id, ...ex })) }); } } };
        const r = await AI.generate({ briefings: one, config: cfg, adapters: ad, now: T0 });
        assert.deepStrictEqual(calls, ['vm', 'vm', 'vm', 'gemini']); assert.deepStrictEqual([r.overviews[k1].source, r.overviews[k1].attempts, r.stats.gemini], ['gemini', 4, 1]);
        const allBad = { vm: ad.vm, gemini: { available: () => true, call: async ({ prompt }) => { calls.push('gemini'); return JSON.stringify({ stations: idsIn(prompt).map((s) => ({ id: s.id, ...bad1 })) }); } } };
        calls.length = 0; const r2 = await AI.generate({ briefings: one, config: cfg, adapters: allBad, now: T0 });
        assert.deepStrictEqual(calls, ['vm', 'vm', 'vm', 'gemini']);
        assert.deepStrictEqual([r2.overviews[k1].source, r2.overviews[k1].land, r2.stats.template], ['template', null, 1]);
        assert.deepStrictEqual(r2.errors.map((x) => x.attempt), [1, 2, 3, 4]);
        assert.ok(AI.sentences(one[0].summary.analysis.sea).length >= 3, '규칙 분석 문단은 서버가 늘 만들어 둔다');
        // VM 이 처음부터 꺼져 있으면 Gemini 두 번(종전 「Gemini → 실패 관할 1회 재시도」와 같은 횟수)
        calls.length = 0; await AI.generate({ briefings: one, config: cfg, adapters: { vm: { available: () => false }, gemini: allBad.gemini }, now: T0 });
        assert.deepStrictEqual(calls, ['gemini', 'gemini']);
    });
    await check('[§11.10.4-6] VM 차단기 그대로 — 호출 실패 3번 잇달면 그 실행 동안 VM 건너뜀(다음 관할은 곧바로 Gemini) · 데드라인이 지나면 남은 관할은 규칙 분석', async () => {
        const calls = [];
        const ad = { vm: { available: () => true, call: async () => { calls.push('vm'); throw new Error('codex 연결 끊김'); } }, gemini: { available: () => true, call: async ({ prompt }) => { calls.push('gemini'); return JSON.stringify({ stations: idsIn(prompt).map((s) => ({ id: s.id, ...ex })) }); } } };
        const r = await AI.generate({ briefings: stationsFor(3), config: { ...cfg, batchUnit: 'station' }, adapters: ad, now: T0 });
        assert.deepStrictEqual(calls, ['vm', 'vm', 'vm', 'gemini', 'gemini', 'gemini']); assert.equal(r.stats.ai, 3);
        assert.ok(r.errors.some((x) => x.reason.startsWith('VM 연속 실패 3회')));
        let fake = 0; const slow = { vm: { available: () => true, call: async ({ prompt }) => { fake += 6 * 60000; return JSON.stringify({ stations: idsIn(prompt).map((s) => ({ id: s.id, ...bad1 })) }); } } };
        const r2 = await AI.generate({ briefings: stationsFor(2), config: { ...cfg, batchUnit: 'station' }, adapters: slow, now: T0, timer: () => fake, deadline: 5 * 60000 });
        assert.equal(r2.stats.template, 2); assert.equal(r2.stats.deadline, 2); assert.ok(r2.errors.filter((x) => x.stage === 'deadline').length >= 1);
    });
    // 공개 대기(§11.10.4 대기 표) — 같은 폴더·가짜 시계로 판을 만들고 보이는 판을 본다
    const mkSvc = (dir, clockFn, extra = {}) => SB.createService({ dir, clock: clockFn, risk: fakeRisk, marine: fakeMarine, loadStations: () => fakeStations, alertsFile: path.join(dir, 'none.json'), hazardFeatures: () => [], kma: () => null, tideDeps: { anchors: [] }, adapters: { vm: { available: () => false }, gemini: { available: () => false } }, ...extra });
    const HL = '제주해양경찰서|한림파출소', AW = '제주해양경찰서|애월파출소', kt = (s, d = '2026-10-17') => Date.parse(d + 'T' + s + ':00+09:00');
    await check('[§11.10.4-7] 공개 대기 — ① 07:10 만든 아침 판은 07:29 까지 숨김(어제 밤 판을 계속) · 07:30 부터 보임 ② 서버 다시 켜짐(새 서비스)에도 제 시각에 ③ 대기 중 특보 판은 곧바로 · 07:30 에 아침 판이 덮지 않음 ④ 관리자 미리보기는 「예정」', async () => {
        const d = fs.mkdtempSync(path.join(tmp, 'pub-')); let clock = kt('23:00', '2026-10-16');
        const s1 = mkSvc(d, () => clock);
        await s1.run({ kind: 'night' });   // 어제 밤 판(대상 10-17) — 곧바로 공개
        clock = kt('07:10'); await s1.run({ kind: 'morning' });
        clock = kt('07:20');
        assert.equal(s1.pick({ key: HL, day: 'auto' }).briefing.edition, 'night', '① 07:20 — 아직 어제 밤 판');
        const pv = s1.pick({ key: HL, day: 'auto', withPending: true });
        assert.deepStrictEqual([pv.pending, pv.publishAt, pv.briefing.edition, pv.current.edition], [true, '2026-10-17T07:30:00+09:00', 'morning', 'night'], '④ 관리자 미리보기 = 예정 판');
        assert.deepStrictEqual(s1.status().pending, [{ date: '2026-10-17', publishAt: '2026-10-17T07:30:00+09:00', stations: 2 }]);
        // ③ 07:25 특보 변경 판(한림만) — 곧바로 보이고, 한림의 대기 아침 판(07:10 에 만든 더 오래된 자료)은 지운다
        clock = kt('07:25'); await s1.run({ kind: 'warning', keys: [HL], zones: ['제주도서부앞바다'] });
        assert.equal(s1.pick({ key: HL, day: 'auto' }).briefing.edition, 'warning', '③ 특보 판은 곧바로');
        // ② 서버 다시 켜짐 — 새 서비스(같은 폴더, 타이머 없음)
        clock = kt('07:29'); const s2 = mkSvc(d, () => clock);
        assert.equal(s2.pick({ key: AW, day: 'auto' }).briefing.edition, 'night', '② 07:29 — 애월은 아직 밤 판');
        clock = kt('07:30');
        assert.equal(s2.pick({ key: AW, day: 'auto' }).briefing.edition, 'morning', '② 07:30 — 다시 켜진 서버도 아침 판 공개');
        assert.equal(s2.pick({ key: HL, day: 'auto' }).briefing.edition, 'warning', '③ 07:30 — 아침 판이 더 나중의 특보 판을 덮지 않음');
        // 다음 쓰기(17:10 저녁 판)는 공개 시각이 지난 대기 판을 먼저 옮긴다(지워지지 않게)
        clock = kt('17:10'); await s2.run({ kind: 'evening' });
        const day = I.readJson(path.join(d, 'briefings_2026-10-17.json'));
        assert.deepStrictEqual([day.stations[AW].edition, day.stations[HL].edition, day.pending[AW].edition, day.pending[AW].publishAt], ['morning', 'warning', 'evening', '2026-10-17T17:30:00+09:00']);
        // 관리자 「지금 다시 만들기」(17:20) — 곧바로 보이고 그보다 먼저 만든 저녁 대기 판은 지운다
        clock = kt('17:20'); await s2.run({ kind: 'manual' });
        assert.equal(s2.pick({ key: AW, day: 'auto' }).briefing.edition, 'manual');
        clock = kt('17:30'); assert.equal(s2.pick({ key: AW, day: 'auto' }).briefing.edition, 'manual', '17:30 — 먼저 만든 저녁 판이 관리자 판을 덮지 않음');
        assert.equal(I.readJson(path.join(d, 'briefings_2026-10-17.json')).pending, undefined, '덮일 대기 판은 지웠다');
    });
    await check('[§11.10.4-8] 밤 판(22:40 → 23:00, 대상 내일 — U58 「21시 넘으면 내일」) — 22:50 은 오늘 판 + 「23:00 공개 예정」 · 23:00 내일 판 · 늦게(공개 시각 지나) 만든 판은 곧바로 · 저녁 판 데드라인은 17:30 까지(늦추지 않음)', async () => {
        const d = fs.mkdtempSync(path.join(tmp, 'night-')); let clock = kt('08:00');
        const s1 = mkSvc(d, () => clock);
        await s1.run({ kind: 'morning' });
        assert.equal(I.readJson(path.join(d, 'briefings_2026-10-17.json')).stations[HL].publishAt, '2026-10-17T07:30:00+09:00', '07:30 이 지난 늦은 실행은 곧바로');
        clock = kt('22:40'); await s1.run({ kind: 'night' });
        clock = kt('22:50');
        const p = s1.pick({ key: HL, day: 'auto' });
        assert.deepStrictEqual([p.date, p.fallback, p.wanted, p.nextExpectedAt, p.briefing.edition], ['2026-10-17', true, '2026-10-18', '2026-10-17T23:00:00+09:00', 'morning']);
        clock = kt('23:00');
        const q = s1.pick({ key: HL, day: 'auto' }); assert.deepStrictEqual([q.date, q.fallback, q.briefing.edition, q.briefing.targetDate], ['2026-10-18', false, 'night', '2026-10-18']);
        assert.ok(q.briefing.summary.analysis.sea && q.briefing.summary.sea.headline.startsWith('내일 '), '밤 판 대상 = 내일');
        // 저녁 판을 17:25 에 시작(서버가 늦게 켜짐) — AI 데드라인은 17:30(5분)까지. VM 한 번에 6분 걸리면 남은 관할은 규칙 분석으로 17:30 에 공개.
        const d2 = fs.mkdtempSync(path.join(tmp, 'eve-')); let fake = 0; clock = kt('17:25');
        const s2 = mkSvc(d2, () => clock, { timer: () => fake, adapters: { vm: { available: () => true, call: async ({ prompt }) => { fake += 6 * 60000; return JSON.stringify({ stations: idsIn(prompt).map((s) => ({ id: s.id, land: null, sea: 'x' })) }); } }, gemini: { available: () => true, call: async () => { throw new Error('데드라인 뒤라 불리면 안 됨'); } } } });
        const r = await s2.run({ kind: 'evening' });
        assert.deepStrictEqual([r.results[0].stats.deadline, r.results[0].stats.calls, r.results[0].publishAt], [2, 1, '2026-10-17T17:30:00+09:00']);
        assert.ok(s2.status().errors.some((e) => e.stage === 'deadline'));
        clock = kt('17:30'); assert.equal(s2.pick({ key: HL, day: 'today' }).briefing.overview.source, 'template', '공개 시각에 된 만큼(규칙 분석) 보임');
    });
    await check('[§11.10.4-9] 관리자 상태 오류·이름 — 시도 번호가 오류에 남고 「다음 예정」 시각표는 07:30·17:30·23:00 · 오류현황 낡음 상세도 07:30', async () => {
        const row = SB.historyRow({ lastRun: { at: '2026-10-16T07:10:00+09:00', method: 'chatgpt', results: [] }, errors: [], failures: {} }, kt('08:00'));
        assert.ok(row.status === 'stale' && row.detail.includes('07:30·17:30·23:00'), row.detail);
    });
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();
