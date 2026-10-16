/**
 * ============================================================================
 * 파일명: local_server/scripts/test_station_briefing.js
 * 역할  : 「활동지점 안전 브리핑」(파출소 관할) 서버 1단계 시험 — 고정 입력(가짜 자료)으로 규칙·AI 순서·검증·저장·일정·노출을 결정론적으로 확인한다.
 *         실제 AI·카카오·기상청 호출 없음(가짜 어댑터·가짜 fetch), 임시 폴더만 쓴다, 서버를 띄우지 않는다(라우터만 임시 포트).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/station_briefing_rules.js · station_briefing_ai.js · station_briefing_inputs.js · station_briefing.js · routes/station_briefing.js
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
    await check('정시 판(가짜 시계): 08:00 아침 · 17:29 없음 · 17:30 저녁 · 23:00 밤 · 같은 판은 한 번만 · 서버가 꺼져 있었으면 다음 판 전까지 늦게', () => {
        const done = new Set(['2026-10-16|night']);
        assert.equal(R.dueEdition(Date.parse('2026-10-17T07:59:00+09:00'), done), null);
        const m = R.dueEdition(Date.parse(at(8)), done); assert.equal(m.kind, 'morning'); assert.equal(m.key, '2026-10-17|morning'); done.add(m.key);
        assert.equal(R.dueEdition(Date.parse('2026-10-17T17:29:00+09:00'), done), null);
        const e = R.dueEdition(Date.parse('2026-10-17T17:30:00+09:00'), done); assert.equal(e.kind, 'evening'); done.add(e.key);
        assert.equal(R.dueEdition(Date.parse('2026-10-17T22:59:00+09:00'), done), null);
        const n = R.dueEdition(Date.parse(at(23)), done); assert.equal(n.kind, 'night');
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
        assert.deepStrictEqual(b.sea.overviewTop.map((c) => c.rid), ['A:1001', 'T:GR4_9']);
        assert.ok(!b.overview.sea.includes('모슬포'), '순위만 주의인 해역은 틀 총평에 없음');
    });
    await check('해역 묶기·순위·창: 단계 > 지속 칸 > 근거 겹침 > 과거 사고 · 관할 검토 칸 수 · 관심 이상 해역 수', () => {
        assert.deepStrictEqual(b.sea.cards.map((c) => c.rid), ['A:1001', 'T:GR4_9', 'A:1002']);
        const r1 = b.sea.cards[0];
        assert.equal(r1.rank, 2); assert.equal(r1.word, '주의 필요'); assert.equal(r1.window, '15~24시'); assert.equal(r1.peakAt, at(15));
        assert.equal(b.sea.reviewedCells, 52); assert.equal(b.sea.attentionRegions, 3); assert.equal(b.sea.level.word, '주의 필요');
        assert.ok(r1.traits.text.includes('2021~2025년 선박사고 18건(충돌 7·침수 5), 사망 1·실종 0'), r1.traits.text);
        assert.ok(r1.today.lines.includes("15~18시 혼잡 예보 '높음'(15시 혼잡지수 12.3) → 충돌·접촉 주의"), r1.today.lines.join(' / '));
        assert.equal(r1.overview.label, "공식 사고예보 '주의'(15~21시)·제주도서부앞바다 풍랑주의보 예비특보(발효 예정 시각 이후)(21~24시)");
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
    await check('특보 해제 칸(§11.6-7): 「HH~HH시 해제 예고(더 일찍 풀릴 수 있음)」 + 출항 안내 + 1.2~1.3배, 1.4·1.31 은 없음', () => {
        const rel = b.special.find((x) => x.kind === 'release');
        assert.equal(rel.title, '제주도북부앞바다 풍랑주의보 — 06~09시 해제 예고(더 일찍 풀릴 수 있음)');
        assert.deepStrictEqual(rel.lines, ['해제 뒤 출항이 이어질 수 있습니다.', '2020~2025년 특보 해제 뒤 이틀 동안 전복·침몰·침수·표류 사고가 평소보다 약 1.2~1.3배 많았습니다.']);
        const all = JSON.stringify(b);
        assert.ok(!/1\.4배|1\.31배|첫 아침/.test(all));
        const pre = b.special.find((x) => x.kind === 'prewarn');
        assert.equal(pre.title, '제주도서부앞바다 풍랑주의보 예비특보 — 21~24시 발효 예정');
        const exact = R.warningEvents([{ zone: 'Z앞바다', type: '풍랑', level: '경보', state: '발효', effective: null, release: { start: '2026-10-18T06:30:00+09:00', end: '2026-10-18T06:30:00+09:00', range: false } }], R.editionWindow('night', Date.parse(at(23))));
        assert.equal(exact.special[0].title, 'Z앞바다 풍랑경보 — 06:30 해제 예고(더 일찍 풀릴 수 있음)');
        const outside = R.warningEvents([{ zone: 'Z', type: '풍랑', level: '주의보', state: '발효', effective: null, release: { start: '2026-10-19T06:00:00+09:00', end: '2026-10-19T09:00:00+09:00', range: true } }], WIN);
        assert.equal(outside.special.length, 0, '창 밖 해제 예고는 칸을 만들지 않음');
    });
    await check('해상 시간 막대: 3시간 칸마다 관할 최고 단계·해역·사건(해제 예고 06시·예비 21시)', () => {
        assert.deepStrictEqual(b.sea.timeBar.map((s) => [s.label, s.rank]), [['06시', 2], ['09시', 2], ['12시', 1], ['15시', 2], ['18시', 2], ['21시', 2]]);
        assert.ok(b.sea.timeBar[0].events.some((e) => e.kind === 'release')); assert.ok(b.sea.timeBar[5].events.some((e) => e.kind === 'prewarn'));
        assert.ok(b.sea.timeBar[2].labels.some((l) => l.includes('해제 뒤')), '해제 뒤 12시간 관심'); assert.ok(b.sea.timeBar[1].region.startsWith('모슬포'), '막대는 순위만 「주의」인 칸도 보인다(분석)');
        assert.ok(b.sea.timeBar[3].region.startsWith('비양도 '));
        const night = R.buildBriefing(hallim(), R.editionWindow('night', Date.parse(at(23))), { generatedAt: R.isoKst(Date.parse(at(23))) });
        assert.equal(night.sea.timeBar[0].label, '10월 17일 21시', '23시 판의 오늘 밤 칸은 날짜를 붙임');
    });

    // ── 육상 규칙 ──
    await check('오늘 바뀐 요소: 사람 많음·행사·너울 12초·이안류 주의·특보·떠밀림 / 주의·경계는 특보일 때만 / 평소 수준+사람만 = 상시 위험', () => {
        assert.equal(R.landSpot({ band: '매우 높음', people: { ratio: 3, score: 1.5 }, notices: {} }).rank, 1, '지수만으로는 관심까지');
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
        assert.ok(AI.validateOverview(x.overview, AI.stationInput(x)).ok);
    });
    await check('해망(관광지 0곳)은 위험구역만으로 상시 위험 장소 · 틀 총평 통과', () => {
        const x = R.buildBriefing({ ...hallim(), key: '군산해양경찰서|해망파출소', name: '해망파출소', office: '군산해양경찰서', sea: { reviewedCells: 12, regions: [], weather: {}, warnings: [] }, places: [], land: { spots: [], hazardOnly: [{ id: '해망-1', place: '해망동 물양장', class: '연안사고 위험구역', shape: '항포구' }, { id: '해망-2', place: '비응항 방파제', class: '사망사고 발생구역', shape: '방파제' }] } }, WIN, { generatedAt: R.isoKst(T0) });
        assert.equal(x.land.cards.length, 0); assert.deepStrictEqual(x.land.constant.map((c) => c.name), ['해망동 물양장', '비응항 방파제']);
        assert.ok(x.overview.land.includes('상시 위험 장소로 해망동 물양장·비응항 방파제'));
        const v = AI.validateOverview(x.overview, AI.stationInput(x)); assert.ok(v.ok, v.errors.join(','));
    });
    await check('조석 문구(서해): 가장 가까운 앵커 곡선 → 「저조 HH:MM 무렵 갯벌·고립 주의」 + 잠기는 바위 + 게이지 곡선(10분)·전후 물때', () => {
        const curve = Array.from({ length: 1440 }, (_, m) => ({ t: pad(Math.floor(m / 60)) + ':' + pad(m % 60), h: Math.round(300 + 330 * Math.cos((m - 750) / 1440 * 4 * Math.PI)) }));
        const files = { '20261017': { status: 'complete', curve, peaks: { lowTide1: { time: '06:12', height: -12 }, lowTide2: { time: '18:40', height: 20 }, highTide1: { time: '12:30', height: 650 }, highTide2: { time: '00:50', height: 610 } } }, '20261016': { curve, peaks: { lowTide2: { time: '17:55', height: 10 }, highTide2: { time: '23:59', height: 600 } } } };
        const geom = { type: 'Polygon', coordinates: [[[126.0, 36.6], [126.0, 36.75], [126.2, 36.75], [126.2, 36.6], [126.0, 36.6]]] };
        const t = I.collectTide({ lat: 36.674, lon: 126.13 }, '2026-10-17', geom, { anchors: [{ id: 'A9', lat: 36.9, lon: 126.0 }, { id: 'A7', lat: 36.68, lon: 126.14 }], readCurve: (id, ymd) => id === 'A7' ? files[ymd] || null : null, rocks: [{ id: 5, lat: 36.66, lon: 126.12, v: 1.2 }, { id: 6, lat: 37.5, lon: 126.12, v: 1 }], crossings: { '5': ['2026-10-16T22:10:00.000Z', '2026-10-17T09:40:00.000Z'], '6': ['2026-10-16T22:00:00.000Z'] } });
        assert.equal(t.anchorId, 'A7'); assert.equal(t.curve.length, 144); assert.equal(t.prevPeak.t, '23:59'); assert.equal(t.nextPeak, null);
        assert.deepStrictEqual(t.peaks.map((p) => p.type + p.t), ['high00:50', 'low06:12', 'high12:30', 'low18:40']);
        assert.deepStrictEqual(t.rocks, { count: 1, first: '07:10', last: '18:40' });
        const sec = R.tideSection(t, WIN);
        assert.equal(sec.text[0], '저조 06:12·18:40 무렵 갯벌·고립 주의 — 물이 빠져 갯벌·바위가 드러나고, 물이 다시 차오를 때 고립될 수 있습니다(고조 00:50·12:30).');
        assert.ok(sec.text[1].startsWith('관할 안 잠기는 바위(간출암) 1곳이 07:10~18:40 사이 물에 잠깁니다'));
        assert.equal(I.collectTide({ lat: 33.41, lon: 126.26 }, '2026-10-17', geom, { anchors: [{ id: 'A7', lat: 33.41, lon: 126.26 }], readCurve: () => files['20261017'] }), null, '제주는 물빠짐 대상 밖');
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
        assert.deepStrictEqual([s.people, s.event, s.swell, s.rip, s.notices], [{ ratio: 1.8, score: 0.82 }, { name: '협재 축제', weekend: true }, { periodS: 12.5 }, { level: '주의' }, { effective: ['풍랑주의보'], prelim: ['강풍주의보'], windMs: 9 }]);
        assert.deepStrictEqual(s.history, { count: 3, from: '2020-01-01', to: '2024-12-31', topTypes: [{ type: '표류', count: 2 }, { type: '익수', count: 1 }] });
        assert.deepStrictEqual(s.hazard, { count: 2, byType: [{ class: '사망사고 발생구역', count: 1 }, { class: '연안사고 위험구역', count: 1 }] });
        assert.deepStrictEqual(L.spots[1].missing, ['detail']);
        assert.deepStrictEqual(L.hazardOnly.map((z) => z.id), ['한림-9']);
        assert.equal(R.landSpot(s).rank, 2, '주의보 발효 → 주의 필요');
    });

    // ── 총평·AI ──
    await check('틀 총평: 육상·해상 각 3~5문장 · 원인(기상 흐름)·시간 · 검증 통과', () => {
        const v = AI.validateOverview(b.overview, AI.stationInput(b));
        assert.ok(v.ok, v.errors.join(','));
        assert.ok(b.overview.sea.includes('15시부터 파고 2.4m') && b.overview.sea.includes('따라서 15~24시경 비양도'), b.overview.sea);
        assert.ok(b.overview.land.startsWith('오늘 한림파출소 관할 육상은 관심 필요입니다'), b.overview.land);
        assert.equal(b.overview.source, 'template');
    });
    const si = AI.stationInput(b), good = { land: b.overview.land, sea: b.overview.sea };
    await check('AI 응답 검증: 숫자·N배·지명·단계 말·공식 단계 이름·필수 포함·금지어·문장 수·해상만 관할', () => {
        const bad = (o, code) => { const v = AI.validateOverview({ ...good, ...o }, si); assert.ok(!v.ok && v.errors.some((e) => e.startsWith(code)), code + ' 기대, 실제 ' + v.errors.join(',')); };
        bad({ sea: good.sea.replace('2.4m', '3.7m') }, 'number:3.7');
        bad({ sea: good.sea + ' 이 해역은 평소보다 사고가 2배 많습니다.' }, 'multiplier');
        bad({ sea: good.sea.replace('비양도', '서귀포항 부근 비양도') }, 'place:서귀포항');
        bad({ sea: good.sea.replace(/주의가 필요합니다\.$/, '경계가 필요합니다.') }, 'level:경계');
        bad({ sea: good.sea + " 공식 사고예보가 '경계'입니다." }, "label:'경계'");
        bad({ sea: good.sea.replace(/비양도/g, '관할') }, 'required:sea');
        bad({ land: good.land.replace('물가 접근에', '순찰과 물가 접근에') }, 'forbidden:순찰');
        bad({ land: good.land + ' 그러니 안전합니다.' }, 'forbidden:안전');
        bad({ sea: '짧습니다. 두 문장.' }, 'shape:sea-sentences-2');
        bad({ land: null }, 'shape:land-missing');
        const so = { ...si, land: null, required: { sea: si.required.sea, land: null } };
        assert.ok(AI.validateOverview({ sea: good.sea, land: '육상 글입니다. 둘. 셋.' }, so).errors.includes('shape:land-not-allowed'));
        assert.ok(AI.validateOverview(good, si).ok);
        assert.ok(si.allowed_multipliers.includes('1.2') && si.allowed_multipliers.includes('1.3') && si.allowed_multipliers.includes('1.8'));
        assert.ok(!si.allowed_places.some((p) => p.includes('모슬포')), '총평 후보가 아닌 해역 이름은 허용 지명에 없음');
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
        assert.deepStrictEqual(calls2, ['vm', 'gemini', 'vm', 'gemini'], '실패 관할만 1회 재시도');
        const o = Object.values(r2.overviews)[0]; assert.equal(o.source, 'template'); assert.equal(o.sea, good.sea);
        assert.ok(r2.errors.some((e) => e.stage === 'call' && e.reason === 'codex 시간초과'));
        let n = 0; const r3 = await AI.generate({ briefings: stationsFor(2), config: { ...cfg, method: 'template' }, adapters: { vm: { available: () => true, call: async () => { n++; } } }, now: T0 });
        assert.equal(n, 0); assert.equal(r3.stats.template, 2);
    });
    await check('검증 실패: 그 관할만 1회 재시도 → 다시 실패면 틀, 다른 관할은 AI 그대로 · 재시도 성공이면 AI', async () => {
        let round = 0;
        const ad = { vm: { available: () => true, call: async ({ prompt }) => { round++; return respond(idsIn(prompt), (o, id) => id.endsWith('파출소0') ? { ...o, sea: o.sea + ' 순찰이 필요합니다.' } : o); } } };
        const r = await AI.generate({ briefings: stationsFor(2), config: { ...cfg, batchUnit: 'station' }, adapters: ad, now: T0 });
        assert.equal(round, 3, '관할0 두 번 + 관할1 한 번');
        assert.equal(r.overviews['제주해양경찰서|파출소0'].source, 'template'); assert.equal(r.overviews['제주해양경찰서|파출소1'].source, 'chatgpt');
        assert.ok(r.errors.filter((e) => e.stage === 'validate').length === 2 && r.errors.every((e) => e.stage !== 'validate' || e.reason.includes('forbidden:순찰')));
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
        n = 0; const third = await AI.generate({ briefings: changed, config: cfg, previous: prev, adapters: { vm: { available: () => true, call: async ({ prompt }) => { n += idsIn(prompt).length; return respond(idsIn(prompt), (o, id) => ({ ...o, land: changed.find((c) => c.key === id).overview.land })); } } }, now: T0 });
        assert.equal(n, 1); assert.equal(third.stats.reused, 2);
        n = 0; await AI.generate({ briefings: stationsFor(3), config: { ...cfg, onlyChanged: false }, previous: prev, adapters: ad, now: T0 }); assert.equal(n, 3);
    });

    // ── 서비스(가짜 시계·저장소) ──
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-')), alerts = path.join(tmp, 'weather_alerts.json');
    let NOW = Date.parse('2026-10-17T07:59:00+09:00');
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
    await check('서비스 일정(가짜 시계): 07:59 없음 → 08:00 아침 판 97 아닌 고정 2곳 저장 → 같은 시각 다시 점검해도 한 번만', async () => {
        fs.mkdirSync(path.join(tmp, 'sb'), { recursive: true });
        fs.writeFileSync(path.join(tmp, 'sb', 'state.json'), JSON.stringify({ done: ['2026-10-16|night'] }));
        assert.deepStrictEqual(await svc.tick(), {});
        NOW = Date.parse(at(8)); const r = await svc.tick();
        assert.equal(r.edition, '2026-10-17|morning');
        const day = I.readJson(path.join(tmp, 'sb', 'briefings_2026-10-17.json'));
        assert.deepStrictEqual(Object.keys(day.stations).sort(), ['제주해양경찰서|애월파출소', '제주해양경찰서|한림파출소']);
        assert.equal(day.stations['제주해양경찰서|한림파출소'].edition, 'morning');
        assert.equal(day.stations['제주해양경찰서|한림파출소'].overview.source, 'template', 'VM 응답이 검증에 떨어지면 틀');
        assert.ok(svc.status().errors.some((e) => e.stage === 'validate'));
        assert.equal(day.stations['제주해양경찰서|한림파출소'].location.estimated, true, '카카오 없이(시험) 대표 위치 추정');
        const again = await svc.tick(); assert.equal(again.edition, undefined);
    });
    await check('특보 변경: 처음 서명은 기록만 → 서부앞바다 주의보 발효로 바뀌면 그 구역에 걸친 관할(한림)만 다시 · trigger 기록', async () => {
        NOW = Date.parse(at(10)); vmCalls = 0;
        fs.writeFileSync(alerts, JSON.stringify({ current: tree(null) })); fs.utimesSync(alerts, new Date(), new Date(Date.now() + 1000));
        const first = await svc.tick(); assert.equal(first.warning, undefined, '처음 본 서명은 기록만');
        fs.writeFileSync(alerts, JSON.stringify({ current: tree('주의보') })); fs.utimesSync(alerts, new Date(), new Date(Date.now() + 5000));
        NOW = Date.parse('2026-10-17T10:05:00+09:00');
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
        assert.ok(p.briefing.overview.sea.startsWith('내일 한림파출소 관할 해상은'));
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
        const fake = { readConfig: () => ({ exposure }), stations: () => fakeStations, stationList: () => fakeStations.map((s) => ({ key: s.key })), pick: () => ({ date: '2026-10-17', briefing: { key: 'k' }, fallback: false }), status: () => ({ config: { exposure }, choices: SB.CHOICES }), writeConfig: (b) => { if (b.exposure === 'x') throw Object.assign(new Error('설정값 오류: exposure'), { status: 400 }); return b; }, run: async () => ({ ok: true }) };
        const app = express(); app.use(createRouter({ service: fake, isAdminDevice: (id) => id === 'fcm-admin-1', verifyToken: (t) => t === 'tok-ok', authorize: (req, res, next) => req.get('X-Admin-Token') === 'tok-ok' ? next() : res.status(401).json({ ok: false }) }));
        const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
        const base = 'http://127.0.0.1:' + server.address().port, q = '/api/station-briefing?station=' + encodeURIComponent('제주해양경찰서|한림파출소');
        try {
            const get = async (u, h = {}) => { const r = await fetch(base + u, { headers: h }); return { status: r.status, body: await r.json() }; };
            let r = await get(q); assert.equal(r.body.display, false); assert.equal(r.body.briefing, null); assert.equal(r.body.audience, 'admin');
            r = await get('/api/station-briefing/stations'); assert.deepStrictEqual(r.body.stations, []);
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
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();
