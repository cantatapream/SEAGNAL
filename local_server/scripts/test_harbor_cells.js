/**
 * ============================================================================
 * 파일명: local_server/scripts/test_harbor_cells.js
 * 역할  : 「항구 칸」(항·포구·방파제 안 — 정박·계류 배가 늘 세어지는 해상 교통 칸)을 혼잡 판정에서 빼는 일을 검사한다.
 *         판정 함수(근거·등급) · 저장소 목록(강·중만, 보령 앞바다 같은 진짜 일시 혼잡은 없음) · 서버(지금 척수·혼잡 예보의 충돌·접촉 주의,
 *         관심 단계, 관할 합계, 붐비는 해역, 지도 프레임 회색 표시) · 브리핑 해역 혼잡 예보 · 위험지수(100점) 무영향 · 화면(회색 칸·숫자·시트 한 줄·범례).
 *         사용자 2026-10-19 원문: *"한림 파출소 관할에서 그 화순항 북북서방 11.3해리 해역에 21척이 몰려 있다라고 표현이 되는데 여기는 한림항이야. …
 *         상시 그 배가 그 위치에 정박해서 계류하고 있는 상태를 의미하는 거라서 이것이 그 21척이 몰려서 밀집되어 있다라고 혼잡하다고 볼 수는 없을 것 같거든."*
 *         선택: 「예보 혼잡까지 전부」 · 「회색+숫자 유지」 · 「합계에서 뺌」 · 「자동판정후 애매한곳은1번으로」.
 * [연계] scripts/gen_harbor_cells.js(grade·evidenceFor) · services/harbor_cells.js · services/marine_fusion.js · routes/station_briefing.js(nowLineFrom)
 *        · services/station_briefing_inputs.js(collectSea) · services/risk_score.js(scoreSea) · client 위험예측 risk_map_layer.js·risk_marine.js·risk_forecast.js
 *        · client/js/forecast/station-briefing/station_briefing_riskmap.js · scripts/refactor/verify_all.sh SUITES
 * [로드 순서] 독립 Node 실행 — 네트워크 없음, 임시 폴더만 쓴다, 시계는 주입(현재 시각에 기대지 않는다). 화면 사례는 playwright-core 크로뮴.
 * ============================================================================
 */
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const io = require('../services/risk_collector_io'), M = require('../services/marine_fusion'), H = require('../services/harbor_cells');
const G = require('./gen_harbor_cells'), { nowLineFrom } = require('../routes/station_briefing');
const I = require('../services/station_briefing_inputs'), R = require('../services/station_briefing_rules'), S = require('../services/risk_score');
let pass = 0, fail = 0;
async function check(name, fn) { try { await fn(); pass++; console.log('✅ ' + name); } catch (e) { fail++; console.log('❌ ' + name + ' — ' + (e && e.message)); } }

// ── 서버 시험 자료: 같은 관할 안 두 칸 — HB(항구 칸으로 넣는다)·OP(바다 칸), 둘 다 23척·밀집도 12 ──
const HB = 'GR4_F4K23_P4', OP = 'GR4_F4K23_P3', T13 = '2026-10-12T13:05:00+09:00';
const sq = (w, s) => ({ type: 'Polygon', coordinates: [[[w, s], [w + .025, s], [w + .025, s + .025], [w, s + .025], [w, s]]] });
const describe = (r) => ({ id: String(r.gridId), lat: r.latitude, lon: r.longitude, haegu: { major: 163, sub: 6, label: '163-6' }, ref: { name: '제주항', bearingWord: '북서', distNm: 8.2 } });
const cellH = { ...describe({ gridId: HB, latitude: 33.5625, longitude: 126.5375 }), i: 0, geometry: sq(126.525, 33.55) };
const cellO = { ...describe({ gridId: OP, latitude: 33.5625, longitude: 126.5625 }), i: 1, geometry: sq(126.55, 33.55) };
cellO.ref = { name: '제주항', bearingWord: '북', distNm: 9.1 };
const stations = [{ properties: { name: '제주파출소' }, geometry: { type: 'Polygon', coordinates: [[[126.5, 33.5], [126.6, 33.5], [126.6, 33.6], [126.5, 33.6], [126.5, 33.5]]] } }];
const harborList = H.create([{ id: HB, grade: '강', hazards: ['가짜항'], names: ['가짜항'] }]);
/** 실시간 칸·혼잡 예보를 넣은 저장소를 만든다. 예: store({hCount:23, oCount:23, cong:'매우높음'}) @returns {object} marine_fusion 저장소(cleanup 포함) */
function store({ hCount = 23, oCount = 23, cong = '낮음', harbor = harborList } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor-cells-')), rows = [];
    if (hCount) rows.push([0, hCount, 12]); if (oCount) rows.push([1, oCount, 12]);
    io.write(path.join(dir, 'sea_realtime.json.gz'), { cells: [cellH, cellO], rows, sourceAt: T13, collectedAt: T13, v: 't' });
    const row = (id) => ({ gridId: id, fcstDate: '20261012', fcstTime: '1300', congestionIndex: cong === '매우높음' ? 33.2 : .5, congestionLevel: cong });
    const inp = { version: 1, cells: { cells: [cellH, cellO] }, congestion: { frames: { '202610121300': [row(HB), row(OP)] } }, accident: { cells: [], frames: {} },
        sources: { accident: { status: 'ok' }, congestion: { status: 'ok' }, zoneForecasts: { status: 'ok' } }, weather: () => ({ wh: .5, ws: 3, forecastAt: '2026-10-12T12:00:00+09:00' }) };
    const s = M.createStore({ risk: { marineInputs: () => inp }, dir, clock: () => Date.parse(T13), stations, accidents: [], describe, harbor, zonesFor: () => null, ports: [] });   // ports: [] — 해역 이름은 가짜 주요지명 그대로(공식 항 기준점 §11.10.43 는 test_station_briefing·test_marine_fusion 이 본다)
    s.cleanup = () => fs.rmSync(dir, { recursive: true, force: true }); return s;
}

(async () => {
    // ── 1. 판정 함수(저장소 실제 자료) ──
    const ctx = G.buildContext();
    await check('판정: 한림항 칸(33.4125N 126.2625E)·도두항 칸 = 강 — 해경 위험구역 「한림항」·「도두항」 + 항 안 사고글', () => {
        const h = G.evidenceFor(ctx, 'GR4_F4K32_F3'), d = G.evidenceFor(ctx, 'GR4_F4K14_Y3');
        assert.equal(G.grade(h), '강'); assert.ok(h.hazards.includes('한림항'), h.hazards.join()); assert.ok(h.accInPort >= 20, String(h.accInPort)); assert.ok(h.land > .5, String(h.land));
        assert.equal(G.grade(d), '강'); assert.ok(d.hazards.includes('도두항'), d.hazards.join());
    });
    await check('판정: 보령 앞바다(6번 36.4375N 126.4625E·27번 36.4125N 126.4625E — 평소 0척인 진짜 일시 혼잡)·먼바다(32.11N 125.19E — 늘 40척 안팎) = 아님', () => {
        for (const id of ['GR4_F2O32_J1', 'GR4_F2O32_J3', 'GR4_F4N33_N4']) { const e = G.evidenceFor(ctx, id); assert.equal(G.grade(e), '아님', id + ' ' + JSON.stringify(e)); assert.equal(e.land, 0, id); assert.deepEqual(e.hazards, [], id); }
    });
    await check('판정 규칙: 강·중·불확실·아님 경계 — 근거 없으면 몇 척이든 아님(척수는 판정에 쓰지 않음)', () => {
        const ev = (hazards, accInPort, land) => ({ hazards, accInPort, land, names: [], accAll: accInPort });
        assert.deepEqual([G.grade(ev(['a'], 1, 0)), G.grade(ev(['a'], 0, 0)), G.grade(ev([], 3, .1)), G.grade(ev([], 3, .09)), G.grade(ev([], 2, .5)), G.grade(ev([], 1, 0)), G.grade(ev([], 0, .1)), G.grade(ev([], 0, .09)), G.grade(null)],
            ['강', '중', '중', '불확실', '불확실', '불확실', '불확실', '아님', '아님']);
    });
    // ── 1-2. 공식 항 정리 파일(해양수산부 공공데이터포털) · 공식 근거 판정 — 2026-10-19 「좋아 진행하자」(공식 자료로 자동 확인) ──
    await check('공식 항 정리 파일: 여섯 종류·이름·대표 좌표·출처(데이터 번호·주소·이용허락) · 한림항 = 연안항 33.4205N 126.2536E(소형선항만안내) · 도두항 = 국가어항 + 구역 경계', () => {
        const official = JSON.parse(fs.readFileSync(path.join(ROOT, 'local_server/config/coastal_safety/official_ports.json'), 'utf8'));
        const KINDS = ['무역항', '연안항', '국가어항', '지방어항', '어촌정주어항', '마을공동어항'];
        assert.ok(official.ports.length > 500, String(official.ports.length));
        for (const k of KINDS) assert.ok(official.counts[k] > 0 && official.counts[k] === official.ports.filter((p) => p.kind === k).length, k);
        assert.ok(official.ports.every((p) => p.name && KINDS.includes(p.kind) && p.lat > 32.5 && p.lat < 39 && p.lon > 124 && p.lon < 132 && p.src.length && p.src.every((s) => official.sources[s])));
        for (const s of Object.values(official.sources)) { assert.ok(/^\d+$/.test(s.id) && s.url === 'https://www.data.go.kr/data/' + s.id + '/fileData.do' && s.title.startsWith('해양수산부') && s.license.includes('제한 없음') && s.rows > 0, JSON.stringify(s)); }
        const h = official.ports.find((p) => p.name === '한림항'); assert.equal(h.kind, '연안항'); assert.ok(Math.abs(h.lat - 33.42046) < 1e-4 && Math.abs(h.lon - 126.25364) < 1e-4, JSON.stringify(h)); assert.ok(h.src.includes('small_harbor'));
        const d = official.ports.find((p) => p.name === '도두항'); assert.equal(d.kind, '국가어항'); assert.ok(d.zone && d.zone[0].length > 3);
    });
    await check('공식 근거 판정: 한림항 칸에 한림항(연안항·점) · 옥포항 칸(34.8875N 128.7125E)·다대포항 칸 = 공식(점) · 영목항 구역만 걸친 칸 = 공식(구역) · 공식 항을 빼면 같은 칸이 불확실(공식 자료가 판정을 바꾼다)', () => {
        assert.ok(G.evidenceFor(ctx, 'GR4_F4K32_F3').official.some((p) => p.name === '한림항' && p.kind === '연안항' && p.how === '점'));
        const ok = G.evidenceFor(ctx, 'GR4_G3E21_O1'), dd = G.evidenceFor(ctx, 'GR4_G3A44_T3'), ym = G.evidenceFor(ctx, 'GR4_F2O32_I4');
        assert.equal(G.grade(ok), '공식'); assert.deepEqual(ok.official, [{ name: '옥포항', kind: '무역항', how: '점' }]);
        assert.equal(G.grade(dd), '공식'); assert.ok(dd.official.some((p) => p.name === '다대포항' && p.kind === '국가어항' && p.how === '점'));
        assert.equal(G.grade(ym), '공식'); assert.deepEqual(ym.official, [{ name: '영목항', kind: '국가어항', how: '구역' }]);
        const bare = G.buildContext({ official: [] }); for (const id of ['GR4_G3E21_O1', 'GR4_G3A44_T3', 'GR4_F2O32_I4']) assert.equal(G.grade(G.evidenceFor(bare, id)), '불확실', id);
        assert.equal(G.grade({ hazards: [], accInPort: 0, land: 0, names: [], official: [{ name: 'x', kind: '지방어항', how: '점' }] }), '아님');   // 근거 없는 칸은 공식 항이 있어도 올리지 않음
    });
    // ── 2. 저장소 목록 ──
    const list = JSON.parse(fs.readFileSync(H.FILE, 'utf8'));
    await check('목록 파일: 공식 근거로 올라간 칸 표본(옥포항·다대포항·청산도항) = 공식 등급·항 이름·종류 기록 · 불확실 140 = 공식 50 + 사용자 제외 1(영목항 구역 칸) + 남음 89(2026-10-19 09:28 자료) · 미조항(어항정보 2019 국가어항) 칸 = 공식', () => {
        const by = new Map(list.cells.map((c) => [c.id, c]));
        for (const [id, name, kind] of [['GR4_G3E21_O1', '옥포항', '무역항'], ['GR4_G3A44_T3', '다대포항', '국가어항'], ['GR4_F4G44_H1', '청산도항', '국가어항'], ['GR4_G3E13_A4', '미조항', '국가어항']]) {
            const c = by.get(id); assert.ok(c, id); assert.equal(c.grade, '공식', id); assert.ok(c.official.some((p) => p.name === name && p.kind === kind), id); assert.ok(c.names.includes(name), id);
        }
        assert.equal(list.counts.official, list.cells.filter((c) => c.grade === '공식').length);
        assert.deepEqual([list.counts.official, list.counts.uncertain, list.counts.strong, list.counts.medium, list.counts.userExcluded], [50, 89, 134, 52, 1]);
        assert.equal(list.counts.strongMediumWithOfficial + list.counts.strongMediumWithoutOfficial, list.counts.strong + list.counts.medium);
        assert.ok(list.cells.every((c) => Array.isArray(c.official)) && list.criteria.official.includes('data.go.kr/data/15088273'));
    });
    await check('사용자 제외: 영목항 구역만 걸친 칸 GR4_F2O32_I4 — 자동 판정은 공식이어도 목록에 없음 · 제외 목록에 사유·사용자 원문 「거기는 항구칸으로 보면 안될 것 같아 영목항은.」·날짜', () => {
        assert.equal(G.grade(G.evidenceFor(ctx, 'GR4_F2O32_I4')), '공식', '자동 판정은 그대로');
        assert.ok(!list.cells.some((c) => c.id === 'GR4_F2O32_I4')); assert.equal(H.forDefault().has('GR4_F2O32_I4'), false);
        assert.deepEqual(G.USER_EXCLUDED.GR4_F2O32_I4.quote, '거기는 항구칸으로 보면 안될 것 같아 영목항은.'); assert.equal(G.USER_EXCLUDED.GR4_F2O32_I4.date, '2026-10-19');
        assert.ok(list.cells.every((c) => !G.USER_EXCLUDED[c.id]));
    });
    await check('목록 파일: 강·중·공식만 · 한림항·도두항·제주항 칸 있음 · 보령 앞바다 두 칸·먼바다 칸 없음 · 기준·칸 수 기록', () => {
        const ids = new Set(list.cells.map((c) => c.id));
        for (const id of ['GR4_F4K32_F3', 'GR4_F4K14_Y3', 'GR4_F4K23_U4']) assert.ok(ids.has(id), id);
        for (const id of ['GR4_F2O32_J1', 'GR4_F2O32_J3', 'GR4_F4N33_N4']) assert.ok(!ids.has(id), id);
        assert.ok(list.cells.every((c) => c.grade === '강' || c.grade === '중' || c.grade === '공식'));
        assert.equal(list.counts.applied, list.cells.length); assert.equal(list.counts.strong + list.counts.medium + list.counts.official, list.cells.length);
        assert.ok(list.criteria.candidate.includes('14척') && list.criteria.candidate.includes("'높음'"), list.criteria.candidate);
        assert.ok(list.cells.every((c) => Array.isArray(c.why) && c.why.length && c.why.every((w) => ['history', 'now', 'congestion'].includes(w))));
    });
    await check('목록 파일: 칸마다 등급이 저장소 자료로 다시 판정한 값과 같다(재생성 가능 — 근거 파일이 바뀌면 여기서 드러남)', () => {
        const bad = list.cells.filter((c) => G.grade(G.evidenceFor(ctx, c.id)) !== c.grade).map((c) => c.id);
        assert.deepEqual(bad, []);
    });
    await check('불확실 후보표: 마크다운이 있고 칸 수가 목록 기록과 같으며 줄마다 구글맵 링크 · 「공식 근거」 칸(남은 칸은 「없음 — 가장 가까운 공식 항」) · 적용 목록 칸은 표에 없음 · 참고 표 둘(공식으로 올린 칸·공식 근거 없는 강·중 칸)', () => {
        const md = fs.readFileSync(path.join(ROOT, 'client/js/marine-life/risk-forecast/harbor_cells_review.md'), 'utf8'), parts = md.split('\n## ');
        const rowsOf = (t) => t.split('\n').filter((l) => /^\| \d+ \| GR4_/.test(l)), rows = rowsOf(parts[0]);
        assert.ok(parts[0].includes('| 근거 | 공식 근거 | 14척↑ 비율 |'));
        assert.equal(rows.length, list.counts.uncertain); assert.ok(rows.every((l) => l.includes('https://www.google.com/maps?q=')));
        assert.ok(rows.every((l) => / \| 없음 — 가장 가까운 공식 항 \S+\((무역항|연안항|국가어항|지방어항|어촌정주어항|마을공동어항)\) [\d.]+km \| /.test(l)), rows.find((l) => !l.includes('없음 — ')));
        const applied = new Set(list.cells.map((c) => c.id)); assert.ok(rows.every((l) => !applied.has(l.split('|')[2].trim())));
        assert.equal(parts.length, 4); assert.ok(parts[1].startsWith('사용자 제외(1') && parts[1].includes('| GR4_F2O32_I4 |') && parts[1].includes('「거기는 항구칸으로 보면 안될 것 같아 영목항은.」'), parts[1].slice(0, 300));
        assert.equal(rowsOf(parts[2]).length, list.counts.official); assert.equal(rowsOf(parts[3]).length, list.counts.strongMediumWithoutOfficial);
    });
    await check('목록 읽기: of·has·size · 깨진 목록이면 빈 목록(아무 칸도 빼지 않음)', () => {
        assert.equal(harborList.has(HB), true); assert.equal(harborList.of(OP), null); assert.equal(harborList.size, 1);
        const empty = H.create(null); assert.equal(empty.size, 0); assert.equal(empty.has(HB), false);
        assert.equal(H.forDefault().has('GR4_F4K32_F3'), true); assert.equal(H.forDefault().has('GR4_F2O32_J1'), false);
    });
    // ── 3. 서버 — 해상 시트(analysis) ──
    await check('해상 시트: 항구 칸 23척 + 혼잡 예보 매우높음 → 척수·예보는 그대로, 충돌·접촉 주의 없음 · 관심 단계 0 · 항구 사유 한 줄', () => {
        const s = store({ cong: '매우높음' }); try {
            const a = s.analysis({ id: HB, t: T13 }).marine;
            assert.equal(a.current.count, 23); assert.equal(a.current.harbor, true); assert.equal(a.congestion.level, '매우높음');
            assert.equal(a.collisionNotice.on, false); assert.equal(a.attentionRank, 0); assert.deepEqual(a.harbor, { grade: '강', names: ['가짜항'] });
            assert.ok(a.reasons.some((r) => r.key === 'harbor' && r.text.includes('정박·계류'))); assert.ok(!a.reasons.some((r) => r.key === 'collision'));
        } finally { s.cleanup(); }
    });
    await check('해상 시트: 바다 칸 23척 + 매우높음 → 종전대로 충돌·접촉 주의(지금 척수·혼잡 예보 사유 둘) · 관심 단계 1 · 항구 표시 없음', () => {
        const s = store({ cong: '매우높음' }); try {
            const a = s.analysis({ id: OP, t: T13 }).marine;
            assert.equal(a.collisionNotice.on, true); assert.deepEqual(a.collisionNotice.reasons.map((r) => r.kind).sort(), ['congestion', 'traffic']); assert.equal(a.attentionRank, 1);
            assert.equal(a.harbor, null); assert.equal('harbor' in a.current, false);
        } finally { s.cleanup(); }
    });
    await check('해상 시트: 항구 칸 21척 이상만(예보 낮음)도 관심 단계 0 · 목록이 비면 같은 칸이 종전대로 주의(목록이 판정을 바꾼다)', () => {
        const s = store({ hCount: 30 }); try { const a = s.analysis({ id: HB, t: T13 }).marine; assert.equal(a.attentionRank, 0); assert.equal(a.collisionNotice.on, false); } finally { s.cleanup(); }
        const e = store({ hCount: 30, harbor: H.create([]) }); try { const a = e.analysis({ id: HB, t: T13 }).marine; assert.equal(a.attentionRank, 1); assert.equal(a.collisionNotice.on, true); } finally { e.cleanup(); }
    });
    // ── 4. 서버 — 관할 브리핑(지금 밀집) ──
    await check('관할 합계: 항구 칸 척수를 뺌(23+23 → 23척 · 격자 1개) · cells 에 항구 칸 없음 · 뺀 몫 harborExcluded', () => {
        const s = store(); try {
            const b = s.briefing('0', T13);
            assert.equal(b.current.count, 23); assert.equal(b.current.gridCount, 1); assert.deepEqual(b.current.cells.map((c) => c.id), [OP]);
            assert.deepEqual(b.current.harborExcluded, { count: 23, gridCount: 1 });
            const now = nowLineFrom(b); assert.equal(now.count, 23); assert.equal(now.busiest.count, 23); assert.equal(now.busiest.id, OP);
            assert.ok(now.text.startsWith('13:05 기준 관할 해역 선박 23척 · 선박이 있는 해역 격자 1개\n제주항 북방 9.1해리 해역'), now.text);
        } finally { s.cleanup(); }
    });
    await check('지금 밀집: 항구 칸만 붐비면(바다 칸 5척) 붐비는 해역 줄 없음 · 항구 칸에만 배가 있으면 0척(자료 없음 아님)', () => {
        const s = store({ hCount: 40, oCount: 5 }); try { const now = nowLineFrom(s.briefing('0', T13)); assert.equal(now.busiest, null); assert.equal(now.count, 5); assert.ok(!now.text.includes('\n')); } finally { s.cleanup(); }
        const o = store({ hCount: 40, oCount: 0 }); try { const b = o.briefing('0', T13), now = nowLineFrom(b); assert.equal(b.current.count, 0); assert.equal(now.text, '13:05 기준 관할 해역 선박 0척 · 선박이 있는 해역 격자 0개'); } finally { o.cleanup(); }
    });
    await check('지금 밀집(순수 함수): regions 에 항구 칸(current.harbor)이 더 많아도 붐비는 해역은 바다 칸', () => {
        const box = [126.55, 33.55, 126.575, 33.575];
        const now = nowLineFrom({ current: { status: 'ok', count: 16, gridCount: 1, cells: [{ id: OP, box, count: 16 }], sourceAt: T13 }, regions: [
            { location: '항구', point: { lon: 126.5375, lat: 33.5625 }, current: { count: 40, harbor: true } }, { location: '바다', point: { lon: 126.5625, lat: 33.5625 }, current: { count: 16 } }] });
        assert.deepEqual(now.busiest, { name: '바다', count: 16, id: OP });
    });
    // ── 5. 서버 — 지도 프레임 ──
    await check('지도 프레임: 혼잡도 지금·혼잡 예보는 항구 칸 줄 끝에 1(숫자·단계·색 값은 그대로) · 위험 예측에는 없음 · 구역 자료는 harbor:true', () => {
        const s = store({ cong: '매우높음' }); try {
            const table = s.unifiedCells(), iOf = (id) => table.cells.find((c) => c.id === id).i;
            for (const mode of ['current', 'congestion']) {
                const f = s.unifiedFrame(mode, T13), h = f.cells.find((r) => r[0] === iOf(HB)), o = f.cells.find((r) => r[0] === iOf(OP));
                assert.equal(h.length, 5, mode); assert.equal(h[4], 1, mode); assert.equal(o.length, 4, mode); assert.equal(h[1], o[1], mode + ' 숫자 그대로'); assert.equal(h[2], o[2], mode); assert.equal(h[3], o[3], mode);
            }
            assert.ok(s.unifiedFrame('risk', T13).cells.every((r) => r.length === 4));
            const a = s.areaFrame('current', T13, '126.5,33.5,126.6,33.6'); assert.equal(a.cells.find((c) => c.id === HB).harbor, true); assert.equal('harbor' in a.cells.find((c) => c.id === OP), false);
            assert.equal(a.cells.find((c) => c.id === HB).n, 23);
        } finally { s.cleanup(); }
    });
    // ── 6. 브리핑 해상 분석 입력(혼잡 예보) ──
    await check('브리핑 수집: 해역 혼잡 예보에서 항구 칸을 뺌 — 항구 칸만 매우높음이면 그 해역 혼잡은 바다 칸 값 낮음(→ 규칙 「→ 충돌·접촉 주의」 근거 없음), 목록이 비면 매우높음', () => {
        const T0 = Date.parse('2026-10-17T08:00:00+09:00'), WIN = R.editionWindow('morning', T0), at15 = '2026-10-17T15:00:00+09:00';
        const A = { i: 0, id: '9001', lat: 33.425, lon: 126.225, haegu: { major: 232, sub: 2, label: '232-2' }, ref: { name: '화순항', distNm: 11.3, bearingWord: '북북서' }, geometry: sq(126.2, 33.4) };
        const tH = { id: 'GR4_H', lon: 126.21, lat: 33.41, haegu: A.haegu, ref: A.ref }, tO = { id: 'GR4_O', lon: 126.22, lat: 33.42, haegu: A.haegu, ref: A.ref };
        const risk = { marineInputs: () => ({ accident: { cells: [A], frames: {} }, cells: { cells: [tH, tO] }, congestion: { frames: { '202610171500': [{ gridId: 'GR4_H', congestionIndex: 33.2, congestionLevel: '매우높음' }, { gridId: 'GR4_O', congestionIndex: .5, congestionLevel: '낮음' }] } }, sources: { accident: { status: 'ok' }, congestion: { status: 'ok' }, zoneForecasts: { status: 'ok' } }, weather: (m, t) => ({ wh: 1, ws: 5, forecastAt: t }) }) };
        const marine = { stationAt: () => ({ id: '0' }), cellHistory: () => ({ count: 0 }) }, st = [{ key: 'K', idx: '0' }];
        const slot = (harbor) => I.collectSea(st, { risk, marine, win: WIN, now: T0, harbor }).bySt.get('K').regions[0].slots[at15].congestion;
        assert.deepEqual(slot(H.create([{ id: 'GR4_H', grade: '강' }])), { level: '낮음', index: .5, at: at15 });
        assert.equal(slot(H.create([])).level, '매우높음');
    });
    // ── 7. 위험지수(100점) 무영향 ──
    await check('위험지수(100점): 혼잡 지수는 점수에 들어가지 않음(지수 50 = 지수 없음과 같은 점수) · 점수 쪽 코드는 항구 목록을 읽지 않음', () => {
        const base = { t: '2026-10-19T10:00:00+09:00', now: Date.parse('2026-10-19T09:00:00+09:00'), wh: 2.6, ws: 9, warnings: [] };
        const a = S.scoreSea({ ...base, ci: 50 }), b = S.scoreSea({ ...base, ci: null });
        assert.equal(a.score, b.score); assert.equal(a.picked, b.picked); assert.ok(a.factors.find((f) => f.key === 'congestion').score === 0);
        for (const f of ['local_server/services/risk_score.js', 'local_server/services/risk_store.js']) assert.ok(!fs.readFileSync(path.join(ROOT, f), 'utf8').includes('harbor'), f);
    });
    // ── 8. 화면 — 회색 칸·숫자·시트 한 줄·범례·팝업 지도 ──
    await check('화면 코드: 팝업 지도(station_briefing_riskmap)가 구역 자료 harbor 를 줄 끝 1로 넘김 · 범례 「항구(정박·계류) 칸」은 혼잡도일 때만', () => {
        const rm = fs.readFileSync(path.join(ROOT, 'client/js/forecast/station-briefing/station_briefing_riskmap.js'), 'utf8');
        assert.ok(rm.includes('c.harbor ? [k, c.n, c.level, c.color, 1] : [k, c.n, c.level, c.color]'));
        const rf = fs.readFileSync(path.join(ROOT, 'client/js/marine-life/risk-forecast/risk_forecast.js'), 'utf8');
        assert.ok(rf.includes("(cong?'<div class=\"rf-harbor-key\"><i aria-hidden=\"true\"></i>항구(정박·계류) 칸</div>':'')"));
    });
    await check('화면(크로뮴): 혼잡도 지금 — 항구 칸 회색(138,148,166 · .5)·바다 칸은 혼잡 색 · 두 칸 다 숫자 23 · 위험 예측 모드는 줄 끝 1이 있어도 회색 아님 · 시트 「항구 칸 — … 혼잡 판정 제외」', async () => {
        const { chromium } = require('playwright-core');
        const exe = [process.env.PW_CHROME, process.env.SIM_CHROMIUM, process.env.CHROMIUM_EXECUTABLE, chromium.executablePath()].find((p) => p && fs.existsSync(p));
        const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--no-sandbox'] });
        try {
            const page = await browser.newPage({ viewport: { width: 412, height: 915 } }), errors = []; page.on('pageerror', (e) => errors.push(e.message));
            await page.setContent('<div id="map" style="width:412px;height:915px"></div>');
            for (const f of ['assets/vendor/ol/ol.js', 'js/marine-life/risk-forecast/risk_format.js', 'js/marine-life/risk-forecast/risk_map_layer.js', 'js/marine-life/risk-forecast/risk_marine.js']) await page.addScriptTag({ path: path.join(ROOT, 'client', f) });
            const r = await page.evaluate(() => {
                const map = new ol.Map({ target: 'map', layers: [], view: new ol.View({ center: ol.proj.fromLonLat([126.55, 33.5625]), resolution: 20 }) });
                const L = RiskMapLayer.create(map, () => {}); L.setActive({ coast: false, sea: true }, true);
                const table = { cells: [{ i: 0, id: 'H', lon: 126.5375, lat: 33.5625 }, { i: 1, id: 'O', lon: 126.5625, lat: 33.5625 }] };
                const read = (mode) => { L.drawUnified(table, { mode, cells: [[0, 23, '높음', .53, 1], [1, 23, '높음', .53]] }); map.renderSync();
                    const lay = (n) => map.getLayers().getArray().find((l) => l.getClassName() === 'rf-' + n + '-canvas').getSource().getFeatures();
                    const fill = (id) => lay('marine').find((f) => f.get('id') === id).getStyle().getFill().getColor();
                    return { h: fill('H'), o: fill('O'), nums: lay('traffic').map((f) => f.get('count')) }; };
                const cur = read('current'), acc = read('accident');
                const base = { location: '한림항 칸', t: '2026-10-19T09:10:00+09:00', currentStatus: {}, weather: {}, history: { available: false }, current: { status: 'ok', count: 23, density: 11.3, densityLevel: '높음' } };
                const host = document.createElement('div'); host.innerHTML = RiskMarine.render({ ...base, harbor: { grade: '강', names: ['한림항'] } }); const withH = host.textContent;
                host.innerHTML = RiskMarine.render(base); return { cur, acc, withH, without: host.textContent };
            });
            assert.deepEqual(errors, []);
            assert.equal(r.cur.h, 'rgba(138,148,166,0.5)'); assert.notEqual(r.cur.o, r.cur.h); assert.deepEqual(r.cur.nums.sort(), [23, 23]);
            assert.notEqual(r.acc.h, 'rgba(138,148,166,0.5)'); assert.equal(r.acc.h, r.acc.o);
            assert.ok(r.withH.includes('혼잡예보 정보 없음 (항구 | 혼잡 판정 제외)'), r.withH); assert.ok(!r.withH.includes('정박·계류 배 포함'), r.withH); assert.ok(!r.without.includes('항구'));   // 2026-10-19 사용자: 따로 한 줄 빼고 혼잡예보 줄 오른쪽에
        } finally { await browser.close(); }
    });
    console.log('\n' + pass + ' PASS / ' + fail + ' FAIL'); process.exit(fail ? 1 : 0);
})();
