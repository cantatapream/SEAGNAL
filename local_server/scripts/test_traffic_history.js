/**
 * 파일명: local_server/scripts/test_traffic_history.js
 * 역할  : 교통량 2주 그래프용 서버 쪽(30분 척수 이력·특보 발효 구간·칸→특보구역·조회 API)을 검사한다.
 *         같은 날 1시간→30분: 「30분마다의 선박수로 표출해주고 그래프도 그렇게 정교하게 반영해줘.」
 *         사용자 2026-10-15: 「교통량 그래프를 2주 단위로 표출하도록 하자. 그리고 배경에 특보도 표출하고.」
 *         「경보에서 주의보로 격하되어 발효되거나 격상된 경우에는 그 시점을 기준으로」 「(연안바다, 평수구역 구분 필요)」
 * [연계] services/sea_traffic_history.js · services/sea_warning_history.js · services/warn_zone_cells.js
 *        · services/sea_realtime_collector.js(수집 직후 이력 연결) · routes/risk_forecast.js(GET sea/traffic-history)
 *        · marine_warning_crawler._buildZoneTreeFromSnapshot(빈 구역 트리 — 구역 이름 대조용, 읽기만)
 *        · scripts/refactor/verify_all.sh SUITES
 * [로드 순서] 독립 Node 실행 — 네트워크·실제 키 없음, 임시 폴더만 쓴다. 시계는 전부 주입(현재 시각에 기대지 않는다).
 */
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const io = require('../services/risk_collector_io'), H = require('../services/sea_traffic_history');
const W = require('../services/sea_warning_history'), Z = require('../services/warn_zone_cells');
let pass = 0, fail = 0;
async function check(name, fn) { try { await fn(); pass++; console.log('✅ ' + name); } catch (e) { fail++; console.log('❌ ' + name + ' — ' + (e && e.stack || e).toString().split('\n').slice(0, 3).join(' | ')); } }
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'traffic-history-'));
const K = (s) => Date.parse(s + '+09:00');                 // KST 글자 → ms
const at = (s) => s + '+09:00';                            // API 등록시각 모양(KST ISO)
const A = 'GR4_F4K23_P4', B = 'GR4_F4G31_M4';
const dayFile = (dir, d) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'traffic_history', d + '.json.gz'))));

(async () => {
    // ── 1. 30분 집계 ─────────────────────────────────────────────────────────
    await check('30분 값 = 그 30분 받은 5분 응답들의 평균 · 응답에 칸이 없던 5분은 0척(공단 API 는 배 없는 칸을 안 보냄) · 같은 등록시각은 한 번만', () => {
        const dir = tmp(); let now = K('2026-10-15T15:20:00');
        const h = H.createHistory({ dir, clock: () => now });
        h.add({ sourceAt: at('2026-10-15T15:00:06'), rows: [{ id: A, count: 2 }, { id: B, count: 7 }] });
        h.add({ sourceAt: at('2026-10-15T15:05:06'), rows: [{ id: A, count: 4 }] });              // B 는 이번 5분에 안 옴
        h.add({ sourceAt: at('2026-10-15T15:05:06'), rows: [{ id: A, count: 99 }] });             // 같은 등록시각 재수집 → 무시
        h.add({ sourceAt: at('2026-10-15T15:10:06'), rows: [{ id: A, count: 5 }, { id: B, count: 8 }] });
        assert.equal(h._memory().open.samples, 3);
        h.add({ sourceAt: at('2026-10-15T15:30:06'), rows: [{ id: A, count: 1 }] });             // 다음 30분 → 15:00 칸 확정
        now = K('2026-10-15T15:40:00');
        const s = h.series(A, K('2026-10-15T15:00:00'), 2);
        assert.deepEqual(s.values, [3.7, null]);              // (2+4+5)/3 = 3.666… → 3.7 · 15:30 칸은 아직 진행 중
        assert.deepEqual(s.samples, [3, 0]);
        assert.deepEqual(h.series(B, K('2026-10-15T15:00:00'), 1).values, [5]);     // (7+0+8)/3 — 15:05 응답에 B 가 없었다 = 0척
        assert.deepEqual(h.series('GR4_F4K23_P3', K('2026-10-15T15:00:00'), 2).values, [0, null]);   // 한 번도 안 나온 칸: 응답 받은 30분은 0, 진행 중 30분은 null
        const f = dayFile(dir, '2026-10-15');
        assert.deepEqual(f.ids.sort(), [A, B].sort());
        assert.equal(f.v, 2); assert.equal(f.stepMinutes, 30);
        assert.equal(f.slots.length, 1); assert.equal(f.slots[0].s, 30); assert.equal(f.slots[0].n, 3);   // 15:00 = 30번째 칸(0부터)
        assert.match(f.definition, /30분/);
    });
    await check('30분 경계: 15:29:59 와 15:30:00 은 다른 칸, 16:00 은 그다음 칸', () => {
        const dir = tmp(); let now = K('2026-10-15T15:29:59');
        const h = H.createHistory({ dir, clock: () => now });
        h.add({ sourceAt: at('2026-10-15T15:29:59'), rows: [{ id: A, count: 2 }] });
        h.add({ sourceAt: at('2026-10-15T15:30:00'), rows: [{ id: A, count: 8 }] });
        h.add({ sourceAt: at('2026-10-15T16:00:00'), rows: [{ id: A, count: 5 }] });
        now = K('2026-10-15T16:30:00');
        assert.deepEqual(h.series(A, K('2026-10-15T15:00:00'), 3).values, [2, 8, 5]);
        assert.equal(H.slotKey(K('2026-10-15T15:29:59')), '2026-10-15T15:00');
        assert.equal(H.slotKey(K('2026-10-15T15:30:00')), '2026-10-15T15:30');
    });
    await check('지난 30분 값·이미 확정된 30분 값은 받지 않는다 · 수집이 멈춰도 시계가 지나면 마지막 30분이 확정된다', () => {
        const dir = tmp(); let now = K('2026-10-15T10:01:00');
        const h = H.createHistory({ dir, clock: () => now });
        h.add({ sourceAt: at('2026-10-15T10:00:06'), rows: [{ id: A, count: 6 }] });
        assert.equal(h.add({ sourceAt: at('2026-10-15T09:55:06'), rows: [{ id: A, count: 1 }] }).reason, 'older slot');
        now = K('2026-10-15T12:30:00');                        // 10:30 이후 수집 없음
        assert.deepEqual(h.series(A, K('2026-10-15T10:00:00'), 3), { values: [6, null, null], samples: [1, 0, 0] });
        assert.equal(h.add({ sourceAt: at('2026-10-15T10:20:06'), rows: [{ id: A, count: 1 }] }).reason, 'slot already closed');
    });

    // ── 2. 날짜 넘김(KST 자정) ────────────────────────────────────────────────
    await check('KST 자정: 23:55 값은 전날 파일 23:30 칸(47), 00:00 값은 다음날 0번 칸(UTC 15시가 날짜 경계)', () => {
        const dir = tmp(); let now = K('2026-10-14T23:56:00');
        const h = H.createHistory({ dir, clock: () => now });
        h.add({ sourceAt: at('2026-10-14T23:55:06'), rows: [{ id: A, count: 9 }] });
        h.add({ sourceAt: at('2026-10-15T00:00:06'), rows: [{ id: A, count: 3 }] });
        now = K('2026-10-15T00:30:30'); h.flush();
        assert.deepEqual(dayFile(dir, '2026-10-14').slots.map((x) => [x.s, x.c[0]]), [[47, 9]]);
        assert.deepEqual(dayFile(dir, '2026-10-15').slots.map((x) => [x.s, x.c[0]]), [[0, 3]]);
        assert.deepEqual(h.series(A, K('2026-10-14T23:30:00'), 2).values, [9, 3]);
    });

    // ── 3. 재시작 복구 ────────────────────────────────────────────────────────
    await check('재시작: 완성된 30분은 날짜 파일에서, 진행 중 30분은 합계 파일에서 이어 받는다', () => {
        const dir = tmp(); let now = K('2026-10-15T14:06:00');
        const a = H.createHistory({ dir, clock: () => now });
        a.add({ sourceAt: at('2026-10-15T13:55:06'), rows: [{ id: A, count: 10 }] });
        a.add({ sourceAt: at('2026-10-15T14:00:06'), rows: [{ id: A, count: 2 }] });
        a.add({ sourceAt: at('2026-10-15T14:05:06'), rows: [{ id: A, count: 4 }] });
        const b = H.createHistory({ dir, clock: () => now });                 // 새 프로세스
        assert.deepEqual(b._memory().open, { slot: '2026-10-15T14:00', samples: 2 });
        b.add({ sourceAt: at('2026-10-15T14:05:06'), rows: [{ id: A, count: 50 }] });   // 재시작 전과 같은 등록시각 → 무시
        b.add({ sourceAt: at('2026-10-15T14:10:06'), rows: [{ id: A, count: 6 }] });
        now = K('2026-10-15T14:30:10');
        assert.deepEqual(b.series(A, K('2026-10-15T13:30:00'), 2).values, [10, 4]);   // (2+4+6)/3
        const c = H.createHistory({ dir, clock: () => now });
        assert.deepEqual(c.series(A, K('2026-10-15T13:30:00'), 2), { values: [10, 4], samples: [1, 3] });
        assert.equal(c._memory().open, null);
    });

    // ── 4. 보관 1년·메모리 15일 ───────────────────────────────────────────────
    await check('디스크는 365일 넘은 날짜 파일만 지우고(다른 파일은 그대로), 메모리는 최근 15일만 올린다', () => {
        const dir = tmp(), folder = path.join(dir, 'traffic_history'), now = K('2026-10-15T12:00:00');
        for (let d = 0; d < 20; d++) io.write(path.join(folder, io.day(now - d * 86400000) + '.json.gz'), { v: 2, date: io.day(now - d * 86400000), ids: [A], slots: [{ s: 0, n: 6, c: [d] }] });
        for (const d of ['2025-10-14', '2025-10-15', '2024-01-01']) io.write(path.join(folder, d + '.json.gz'), { v: 1, date: d, ids: [A], hours: [] });
        fs.writeFileSync(path.join(folder, 'memo.txt'), 'x');
        const h = H.createHistory({ dir, clock: () => now });
        const m = h._memory();
        assert.equal(m.days.length, 15); assert.equal(m.days[0], '2026-10-01'); assert.equal(m.days.at(-1), '2026-10-15');
        assert.deepEqual(h.prune().sort(), ['2024-01-01.json.gz', '2025-10-14.json.gz']);
        const left = fs.readdirSync(folder);
        assert.ok(left.includes('2025-10-15.json.gz') && left.includes('memo.txt') && left.includes('2026-09-26.json.gz'));
        assert.deepEqual(h.series(A, K('2026-10-01T00:00:00'), 1).values, [14]);
    });
    await check('30분이 확정될 때 정리도 함께 돈다(30분에 한 번)', () => {
        const dir = tmp(), folder = path.join(dir, 'traffic_history'); let now = K('2026-10-15T09:01:00');
        io.write(path.join(folder, '2025-10-01.json.gz'), { v: 1, date: '2025-10-01', ids: [], hours: [] });
        const h = H.createHistory({ dir, clock: () => now });
        h.add({ sourceAt: at('2026-10-15T09:00:06'), rows: [{ id: A, count: 1 }] });
        assert.ok(fs.existsSync(path.join(folder, '2025-10-01.json.gz')));
        h.add({ sourceAt: at('2026-10-15T10:00:06'), rows: [{ id: A, count: 1 }] });
        assert.equal(fs.existsSync(path.join(folder, '2025-10-01.json.gz')), false);
    });

    // ── 5. 수집기 연결 ────────────────────────────────────────────────────────
    const C = require('../services/sea_realtime_collector');
    const apiFetch = (rows, regDt) => async () => ({ ok: true, json: async () => ({ response: { header: { resultCode: '200', resultMsg: 'NORMAL_SERVICE' }, body: { items: { item: rows.map(([g, v, d]) => ({ grid_id: g, vmtc: v, dnsty: d })) }, pageNo: 1, numOfRows: 7000, totalCount: rows.length, regDt } } }) });
    const describe = (g, o) => ({ id: g.gridId, lat: g.latitude, lon: g.longitude, bounds: o && o.bounds });
    await check('실시간 수집 성공 → 같은 폴더 이력에 그 5분 값(척수만)이 더해진다', async () => {
        const dir = tmp(), now = K('2026-10-15T15:12:00');
        const c = C.createCollector({ dir, key: 'k', clock: () => now, describe, fetchImpl: apiFetch([[A, 3, 1.5], ['F2O41_P1', 81, 5]], '2026-10-15 15:10:06') });
        assert.equal((await c.collect()).ok, true);
        const o = io.read(path.join(dir, 'traffic_history', 'open.json.gz'));
        assert.equal(o.slot, '2026-10-15T15:00'); assert.deepEqual(o.at, ['2026-10-15T15:10:06+09:00']);
        assert.deepEqual(o.cells.sort(), [[A, 3, 1], ['GR4_F2O41_P1', 81, 1]].sort());
    });
    await check('이력 저장이 실패해도 현재 교통 수집은 성공으로 끝난다', async () => {
        const dir = tmp(), now = K('2026-10-15T15:12:00');
        const c = C.createCollector({ dir, key: 'k', clock: () => now, describe, history: { add() { throw new Error('disk full'); } }, fetchImpl: apiFetch([[A, 3, 1.5]], '2026-10-15 15:10:06') });
        assert.equal((await c.collect()).ok, true);
        assert.equal(io.read(path.join(dir, 'realtime_status.json')).status, 'ok');
    });

    // ── 6. 특보 발효 구간 ─────────────────────────────────────────────────────
    const crawler = require('../marine_warning_crawler');
    const skeleton = () => crawler._buildZoneTreeFromSnapshot(null);
    const leaf = (tree, name) => { let hit = null; (function w(n) { for (const [k, v] of Object.entries(n || {})) { if (k === name && v && 'children' in v) hit = v; else if (v && typeof v === 'object' && !('children' in v)) w(v); } })(tree); return hit; };
    const block = (type, level, tmEf, clr = '') => ({ wrnTp: type, wrnTpNm: type, wrnLvl: level, wrnLvlNm: level, tmFc: '', tmEf, tmYn: '', tmCc: clr, clrNtcTm: clr, source: 'MARINE_MMIS' });
    /** 결과 파일을 쓰고 수정시각(=관측 시각)을 맞춘다. */
    function writeAlerts(file, fill, obsKst) {
        const cur = skeleton(); fill(cur);
        fs.writeFileSync(file, JSON.stringify({ updatedAt: 'x', previous: skeleton(), current: cur }));
        const t = K(obsKst) / 1000; fs.utimesSync(file, t, t);
    }
    await check('발효 시작 = 발효시각 · 격상(주의보→경보)은 경보 발효시각에서 나눔 · 격하는 그 시점(관측) · 해제 = 해제시각', () => {
        const dir = tmp(), file = path.join(dir, 'weather_alerts.json');
        const r = W.createRecorder({ dir, alertsFile: file, clock: () => K('2026-10-15T00:00:00') });
        writeAlerts(file, (t) => { leaf(t, '울산앞바다').current = block('풍랑', '주의보', '2026년 10월 13일 06시 00분', '14일 밤(21시~24시)'); }, '2026-10-13T06:02:00');
        r.observe();
        writeAlerts(file, (t) => { leaf(t, '울산앞바다').current = block('풍랑', '경보', '2026년 10월 13일 15시 00분'); }, '2026-10-13T15:01:00');
        r.observe();
        writeAlerts(file, (t) => { leaf(t, '울산앞바다').current = block('풍랑', '주의보', '2026년 10월 13일 06시 00분', '2026년 10월 14일 09시 00분'); }, '2026-10-14T03:01:00');
        r.observe();
        writeAlerts(file, () => {}, '2026-10-14T09:03:00');
        r.observe();
        const got = r.list({ zones: ['울산앞바다'] }).intervals.map((x) => [x.level, x.start, x.startBy, x.end, x.endBy]);
        assert.deepEqual(got, [
            ['주의보', '2026-10-13T06:00:00+09:00', 'tmEf', '2026-10-13T15:00:00+09:00', 'levelChange'],
            ['경보', '2026-10-13T15:00:00+09:00', 'tmEf', '2026-10-14T03:01:00+09:00', 'levelChange'],
            ['주의보', '2026-10-14T03:01:00+09:00', 'observed', '2026-10-14T09:00:00+09:00', 'clrNtcTm']]);
    });
    await check('예비특보는 발효가 아니라 기록하지 않는다(부모 upcoming·자식 예비) · 범위형 해제예고만 있으면 사라진 걸 본 시각이 끝', () => {
        const dir = tmp(), file = path.join(dir, 'weather_alerts.json');
        const r = W.createRecorder({ dir, alertsFile: file, clock: () => K('2026-10-15T00:00:00') });
        writeAlerts(file, (t) => { const l = leaf(t, '부산앞바다'); l.upcoming = block('풍랑', '예비', '15일 밤(21시~24시)'); l.children['부산앞바다중연안바다'] = block('풍랑', '예비', ''); leaf(t, '제주도남쪽바깥먼바다').current = block('풍랑', '주의보', '15일 새벽(00시~06시)', '16일 낮(12시~15시)'); }, '2026-10-15T03:00:00');
        r.observe();
        const all = r._state().intervals;
        assert.deepEqual(all.map((x) => [x.zone, x.kind, x.start, x.startBy]), [['제주도남쪽바깥먼바다', '먼바다', '2026-10-15T03:00:00+09:00', 'observed']]);
        writeAlerts(file, () => {}, '2026-10-16T12:40:00');
        r.observe();
        assert.deepEqual([all[0].end, all[0].endBy], ['2026-10-16T12:40:00+09:00', 'observed']);
    });
    await check('연안바다·평수구역은 본구역과 따로(역할 sub·종류 구분) 기록하고, 이름 표기(띄어쓰기·가운뎃점)가 달라도 찾는다', () => {
        const dir = tmp(), file = path.join(dir, 'weather_alerts.json');
        const r = W.createRecorder({ dir, alertsFile: file, clock: () => K('2026-10-15T00:00:00') });
        writeAlerts(file, (t) => {
            const l = leaf(t, '충남북부앞바다'); l.current = block('풍랑', '주의보', '2026년 10월 15일 09시 00분');
            l.children['태안·서산북쪽평수구역'] = block('풍랑', '주의보', '2026년 10월 15일 10시 00분');
            const u = leaf(t, '울산앞바다'); u.children['울산앞바다중연안바다'] = block('풍랑', '경보', '2026년 10월 15일 08시 00분');
        }, '2026-10-15T10:05:00');
        r.observe();
        const rows = r._state().intervals.map((x) => [x.zone, x.role, x.kind, x.level]).sort();
        assert.deepEqual(rows, [['울산앞바다중연안바다', 'sub', '연안바다', '경보'], ['충남북부앞바다', 'main', '앞바다', '주의보'], ['태안·서산북쪽평수구역', 'sub', '평수구역', '주의보']]);
        assert.equal(r.list({ zones: ['태안서산북쪽 평수구역'] }).intervals.length, 1);     // 지도 파일 표기
        assert.equal(r.list({ zones: ['울산앞바다중 연안바다'] }).intervals[0].level, '경보');
        assert.equal(r.list({ zones: ['울산앞바다'] }).intervals.length, 0);                 // 자식 특보를 본구역에 섞지 않음
        writeAlerts(file, (t) => {
            const l = leaf(t, '충남북부앞바다'); l.current = { ...block('', '주의보', '2026년 10월 15일 09시 00분'), wrnTp: 'V' };   // 한글 종류명 빠짐
            l.children['태안·서산북쪽평수구역'] = block('풍랑', '주의보', '2026년 10월 15일 10시 00분');
            leaf(t, '울산앞바다').children['울산앞바다중연안바다'] = block('풍랑', '경보', '2026년 10월 15일 08시 00분');
        }, '2026-10-15T10:06:00');
        r.observe();
        assert.equal(r._state().intervals.length, 3, '종류 코드 V 를 풍랑과 같은 특보로 본다');
    });
    await check('결과 파일이 그대로면 다시 읽지 않음 · 잠깐 사라졌다 같은 특보로 돌아오면 구간을 다시 이음 · 재시작 후 이어서 기록', () => {
        const dir = tmp(), file = path.join(dir, 'weather_alerts.json');
        const mk = () => W.createRecorder({ dir, alertsFile: file, clock: () => K('2026-10-15T00:00:00') });
        const r = mk(), on = (t) => { leaf(t, '강원북부앞바다').current = block('풍랑', '주의보', '2026년 10월 15일 01시 00분'); };
        writeAlerts(file, on, '2026-10-15T01:01:00'); r.observe();
        assert.equal(r.observe().unchanged, true);
        writeAlerts(file, () => {}, '2026-10-15T01:02:00'); r.observe();
        writeAlerts(file, on, '2026-10-15T01:03:00'); r.observe();
        const r2 = mk();                                                               // 재시작
        writeAlerts(file, () => {}, '2026-10-15T05:00:00'); r2.observe();
        assert.deepEqual(r2.list({ zones: ['강원북부앞바다'] }).intervals.map((x) => [x.start, x.end]), [['2026-10-15T01:00:00+09:00', '2026-10-15T05:00:00+09:00']]);
    });
    await check('결과 파일이 없거나 깨지면 기록을 바꾸지 않는다 · 1년 넘게 지난 구간은 지운다(열린 구간은 남김)', () => {
        const dir = tmp(), file = path.join(dir, 'weather_alerts.json'); let now = K('2026-10-15T00:00:00');
        const r = W.createRecorder({ dir, alertsFile: file, clock: () => now });
        assert.equal(r.observe().ok, false);
        fs.writeFileSync(file, '{bad'); assert.equal(r.observe().ok, false);
        writeAlerts(file, (t) => { leaf(t, '부산앞바다').current = block('풍랑', '주의보', '2025년 10월 01일 00시 00분'); leaf(t, '거제시동부앞바다').current = block('풍랑', '주의보', '2025년 10월 01일 00시 00분'); }, '2025-10-01T00:10:00');
        r.observe();
        writeAlerts(file, (t) => { leaf(t, '거제시동부앞바다').current = block('풍랑', '주의보', '2025년 10월 01일 00시 00분'); }, '2025-10-02T00:00:00');
        r.observe();
        now = K('2026-10-02T12:00:00');
        writeAlerts(file, (t) => { leaf(t, '거제시동부앞바다').current = block('풍랑', '주의보', '2025년 10월 01일 00시 00분'); }, '2026-10-02T12:00:00');
        r.observe();
        assert.deepEqual(r._state().intervals.map((x) => x.zone), ['거제시동부앞바다']);
        const saved = io.read(path.join(dir, 'warning_history.json'));
        assert.equal(saved.intervals.length, 1); assert.equal(saved.checkedAt, '2026-10-02T12:00:00+09:00');
    });

    // ── 7. 칸 → 특보구역 ──────────────────────────────────────────────────────
    await check('특보구역 파일: 앞바다25·먼바다19 / 연안바다22·평수구역27, 93개 이름이 전부 크롤러 구역 트리와 맞는다', () => {
        const t = Z._load(), count = {};
        for (const z of [...t.main, ...t.sub]) count[z.kind] = (count[z.kind] || 0) + 1;
        assert.deepEqual(count, { '앞바다': 25, '먼바다': 19, '연안바다': 22, '평수구역': 27 });
        const names = new Set(); (function w(n) { for (const [k, v] of Object.entries(n)) { if (v && 'children' in v) { names.add(Z.zoneKey(k)); Object.keys(v.children).forEach((c) => names.add(Z.zoneKey(c))); } else if (v && typeof v === 'object') w(v); } })(skeleton());
        assert.deepEqual([...t.main, ...t.sub].filter((z) => !names.has(z.key)).map((z) => z.name), []);
        assert.equal(names.size, 93);
    });
    await check('칸 중심 판정이 기존 risk_sea_cells.describe(warnZone·warnSubZone)와 같다 — 한반도 주변 칸 1,500개', () => {
        const D = require('../services/risk_sea_cells'), L = 'ABCDEFGHIJKLMNOP', Y = 'ABCDEFGHIJKLMNOPQRSTUVWXY';
        let seed = 7; const rand = () => { seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
        let n = 0, sub = 0, main = 0;
        while (n < 1500) {
            const id = 'GR4_' + 'FG'[Math.floor(rand() * 2)] + (1 + Math.floor(rand() * 4)) + L[Math.floor(rand() * 16)] + (1 + Math.floor(rand() * 4)) + (1 + Math.floor(rand() * 4)) + '_' + Y[Math.floor(rand() * 25)] + (1 + Math.floor(rand() * 4));
            const b = C.cellBounds(id); if (!b || b[0] < 124 || b[2] > 131.5 || b[1] < 32.5 || b[3] > 38.7) continue;
            n++;
            const z = Z.zonesOfCell(id), d = D.describe({ gridId: id, latitude: z.center[1], longitude: z.center[0] }, { bounds: b });
            assert.equal(z.main ? z.main.name : null, d.warnZone, id); assert.equal(z.sub ? z.sub.name : null, d.warnSubZone, id);
            if (z.main) main++; if (z.sub) sub++;
        }
        assert.ok(main > 100 && sub > 5, 'main ' + main + ' sub ' + sub);
    });
    await check('세부구역 칸은 본구역과 세부구역을 함께 돌려준다 · 짜임 틀린 번호는 null', () => {
        assert.deepEqual(Z.zonesOfCell(A).main, { name: '제주도북부앞바다', code: 'S1323100', kind: '앞바다', key: '제주도북부앞바다' });
        assert.equal(Z.zonesOfCell('GR4_F4K23_P5'), null); assert.equal(Z.zonesOfCell('x'), null);
        // 울산앞바다중 연안바다 안쪽 한 점(129.40,35.45 근처)을 품는 칸을 번호로 찾는다
        const t = Z._load(), ulsan = t.sub.find((z) => z.name === '울산앞바다중 연안바다');
        const G = require('../services/risk_geo');
        let found = null;
        for (const a of 'ABCDEFGHIJKLMNOP') for (const b of '1234') for (const c of '1234') for (const y of 'ABCDEFGHIJKLMNOPQRSTUVWXY') for (const d of '1234') {
            if (found) break; const id = 'GR4_G3' + a + b + c + '_' + y + d, bb = C.cellBounds(id);
            if (bb && G.pointInGeometry([(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2], ulsan.geometry)) found = id;
        }
        assert.ok(found, '울산 연안바다 칸을 못 찾음');
        const z = Z.zonesOfCell(found);
        assert.equal(z.sub.kind, '연안바다'); assert.equal(z.main.name, '울산앞바다');
    });

    // ── 8. 조회 API ───────────────────────────────────────────────────────────
    await check('API 형식: 14일 × 48칸(30분) 배열(오늘 포함 KST 달력일) + 본구역·세부구역 + 같은 기간 특보 구간', () => {
        const dir = tmp(), now = K('2026-10-15T15:30:00');
        const h = H.createHistory({ dir, clock: () => now });
        h.add({ sourceAt: at('2026-10-15T13:05:00'), rows: [{ id: A, count: 4 }] });
        h.add({ sourceAt: at('2026-10-15T14:05:00'), rows: [{ id: A, count: 6 }] });
        const file = path.join(dir, 'weather_alerts.json'), r = W.createRecorder({ dir, alertsFile: file, clock: () => now });
        writeAlerts(file, (t) => { leaf(t, '제주도북부앞바다').current = block('풍랑', '주의보', '2026년 10월 15일 12시 00분'); leaf(t, '부산앞바다').current = block('풍랑', '경보', '2026년 10월 15일 12시 00분'); }, '2026-10-15T12:01:00');
        r.observe();
        const api = H.createApi({ history: h, warnings: r, clock: () => now });
        const b = api.query({ cell: A, days: '14' });
        assert.equal(b.cell, A); assert.equal(b.days, 14); assert.equal(b.slots, 672); assert.equal(b.stepMinutes, 30);
        assert.equal(b.start, '2026-10-02T00:00:00+09:00'); assert.equal(b.end, '2026-10-16T00:00:00+09:00');
        assert.equal(b.traffic.values.length, 672); assert.equal(b.traffic.samples.length, 672);
        const i13 = 13 * 48 + 26;                                                   // 10-15 13:00 칸
        assert.deepEqual(b.traffic.values.slice(i13, i13 + 4), [4, null, 6, null]);  // 13:00·13:30(없음)·14:00·14:30(없음)
        assert.equal(b.traffic.currentSlot, '2026-10-15T15:30');
        assert.deepEqual(b.zones, { main: { name: '제주도북부앞바다', code: 'S1323100', kind: '앞바다' }, sub: null });
        assert.deepEqual(b.warnings, [{ zone: '제주도북부앞바다', role: 'main', kind: '앞바다', type: '풍랑', level: '주의보', start: '2026-10-15T12:00:00+09:00', startBy: 'tmEf', end: null, endBy: null }]);
        assert.equal(b.warningsCheckedAt, '2026-10-15T12:01:00+09:00');
        assert.equal(api.query({ cell: A }).days, 14);
    });
    await check('API: 잘못된 칸·기간은 400(1~15일 정수만)', () => {
        const api = H.createApi({ history: { series: () => ({ values: [], samples: [] }) }, warnings: { list: () => ({ intervals: [] }) }, clock: () => K('2026-10-15T00:00:00') });
        for (const q of [{}, { cell: 'GR4_F4K23_P5' }, { cell: A, days: '0' }, { cell: A, days: '16' }, { cell: A, days: '2.5' }, { cell: [A] }])
            assert.throws(() => api.query(q), (e) => e.status === 400, JSON.stringify(q));
        assert.equal(api.query({ cell: A, days: '15' }).slots, 720);
    });
    await check('HTTP 경로 /api/risk-forecast/sea/traffic-history — 200·60초 캐시, 오류 400', async () => {
        const express = require('express'), { createRouter } = require('../routes/risk_forecast');
        const store = { sources: () => ({}), meta: () => ({}) };
        const app = express(); app.use(createRouter({ store, marine: {}, trafficHistory: H.createApi({ history: { series: (id, f, n) => ({ values: new Array(n).fill(null), samples: new Array(n).fill(0) }) }, warnings: { list: () => ({ checkedAt: null, intervals: [] }) }, clock: () => K('2026-10-15T09:00:00') }) }));
        const server = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
        try {
            const url = 'http://127.0.0.1:' + server.address().port + '/api/risk-forecast/sea/traffic-history';
            const r = await fetch(url + '?cell=' + A + '&days=14'), b = await r.json();
            assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'public, max-age=60');
            assert.equal(b.ok, true); assert.equal(b.traffic.values.length, 672);
            const bad = await fetch(url + '?cell=nope');
            assert.equal(bad.status, 400); assert.equal((await bad.json()).ok, false);
        } finally { server.close(); }
    });

    console.log(`${pass} PASS / ${fail} FAIL`);
    if (fail) process.exitCode = 1;
    process.exit();
})();
