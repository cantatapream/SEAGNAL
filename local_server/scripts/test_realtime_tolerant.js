/**
 * 파일명: local_server/scripts/test_realtime_tolerant.js
 * 역할  : 실시간 선박 교통 수집이 「이상한 줄 하나」 때문에 전체를 버리지 않고 그 줄만 빼는지,
 *         뺀 사유·실패 사유를 관리자 오류현황(상세 한 줄)으로 남기는지 확인한다.
 *         2026-10-15 운영에서 「invalid response」로 하루 넘게 갱신이 멈췄는데, 어느 줄·어느 단계 때문인지
 *         기록이 없어 원인을 못 찾았다(사용자 「키없이 바로 할 수 있는 수정을 진행하자」).
 * [연계] services/sea_realtime_collector.js(readApi·cellBounds·collect) — 2026-10-15 MTIS 웹 수집 제거 후 API 전용
 *        · services/risk_history_sources.js(realtime.detail) · services/risk_error_history.js(detail 보관)
 *        · client/js/admin/admin.js(「상세」 줄) · scripts/refactor/verify_all.sh SUITES
 * [로드 순서] 독립 Node 실행 — 네트워크·실제 키 없음, 임시 폴더만 쓴다.
 */
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const io = require('../services/risk_collector_io'), C = require('../services/sea_realtime_collector');
let pass = 0, fail = 0;
async function check(name, fn) { try { await fn(); pass++; console.log('✅ ' + name); } catch (e) { fail++; console.log('❌ ' + name + ' — ' + e.message); } }
const now = Date.parse('2026-10-15T15:12:00+09:00');

/** 공단 v2 모양(사용자 제공 샘플과 같은 틀)의 가짜 응답. rows 는 [grid_id, vmtc, dnsty]. */
function apiFetch(rows, regDt = '2026-10-15 15:10:06') {
    return async () => ({ ok: true, json: async () => ({ response: { header: { resultCode: '200', resultMsg: 'NORMAL_SERVICE' },
        body: { dataType: 'JSON', items: { item: rows.map(([g, v, d]) => ({ grid_id: g, vmtc: v, dnsty: d })) }, pageNo: 1, numOfRows: 7000, totalCount: rows.length, regDt } } }) });
}
const describe = (g, o) => ({ id: g.gridId, name: 'x', lat: g.latitude, lon: g.longitude, bounds: o && o.bounds });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rt-tolerant-'));

(async () => {
    await check('API: 밀집도 100 초과 한 줄은 밀집도만 비우고 척수는 쓴다 · 나머지 줄 그대로', async () => {
        const r = await C.readApi({ dir: tmp(), key: 'k', now, fetchImpl: apiFetch([['GR4_F4K23_P4', 3, 12.5], ['GR4_G3B33_L3', 74, 100.4], ['GR4_F2O41_P1', 81, 5.2]]) });
        assert.equal(r.rows.length, 3);
        assert.equal(r.rows[1].density, null); assert.equal(r.rows[1].count, 74);
        assert.equal(r.dropped['밀집도 범위 밖(척수는 유지)'], 1);
        assert.equal(r.sourceAt, '2026-10-15T15:10:06+09:00');
    });
    await check('API: 격자번호 이상·척수 이상·중복 줄은 그 줄만 뺀다(전체를 버리지 않는다)', async () => {
        const r = await C.readApi({ dir: tmp(), key: 'k', now, fetchImpl: apiFetch([['GR4_F4K23_P4', 3, 1], ['GR4_F4K23_P10', 2, 1], ['GR4_G3B33_L3', 1.5, 1], ['GR4_F4K23_P4', 9, 1], ['GR4_F2O41_P1', 81, 5.2]]) });
        assert.deepEqual(r.rows.map((x) => x.id), ['GR4_F4K23_P4', 'GR4_F2O41_P1']);
        assert.deepEqual(r.dropped, { '격자번호 형식': 1, '척수 값': 1, '격자 중복': 1 });
    });
    await check('API: 등록시각 형식이 틀리면 여전히 응답 전체를 의심한다(구조 오류는 그대로)', async () => {
        await assert.rejects(C.readApi({ dir: tmp(), key: 'k', now, fetchImpl: apiFetch([['GR4_F4K23_P4', 3, 1]], '2026/10/15') }), /invalid response/);
    });
    await check('수집 성공 + 뺀 줄 있음 → 상태 파일에 사유 한 줄(detail), 관리자 출처에도 실린다', async () => {
        const dir = tmp();
        const c = C.createCollector({ dir, key: 'k', clock: () => now, describe, fetchImpl: apiFetch([['GR4_F4K23_P4', 5, 101], ['bad', 1, 1]]) });
        const res = await c.collect();
        assert.equal(res.ok, true, JSON.stringify(res));
        const st = io.read(path.join(dir, 'realtime_status.json'));
        assert.match(st.detail, /^API 2줄: /); assert.match(st.detail, /격자번호 형식 1/); assert.match(st.detail, /밀집도 범위 밖\(척수는 유지\) 1/);
        assert.equal(/k=|serviceKey|https?:/.test(st.detail), false, '키·주소가 섞이면 안 된다');
        const reader = require('../services/risk_history_sources').createReader({ dir, clock: () => now });
        const src = await reader();
        assert.equal(src.realtime.detail, st.detail);
    });
    await check('API 실패 → 「API 무엇」 이 상세로 남고 마지막 정상본은 그대로(웹으로 대신하지 않는다)', async () => {
        const dir = tmp();
        io.write(path.join(dir, 'sea_realtime.json.gz'), { sentinel: 1 });
        const c = C.createCollector({ dir, key: 'k', clock: () => now, describe, fetchImpl: async () => ({ ok: false, status: 503 }) });
        const res = await c.collect();
        assert.equal(res.ok, false);
        const st = io.read(path.join(dir, 'realtime_status.json'));
        assert.equal(st.lastError, 'HTTP 503');
        assert.equal(st.detail, 'API HTTP 503');
        assert.deepEqual(io.read(path.join(dir, 'sea_realtime.json.gz')), { sentinel: 1 });
    });
    await check('키가 없으면 외부 호출 0·상세 「API 키 없음」', async () => {
        const dir = tmp();
        let calls = 0;
        const c = C.createCollector({ dir, key: '', clock: () => now, describe, fetchImpl: async () => { calls++; throw Error('never'); } });
        assert.equal((await c.collect()).error, 'missing key');
        assert.equal(calls, 0);
        assert.equal(io.read(path.join(dir, 'realtime_status.json')).detail, 'API 키 없음');
    });
    await check('GR4 번호에서 칸 경계 계산 — 운영에 저장돼 있던 공식 웹 경계 3칸과 같다', () => {
        // 2026-10-15 운영 /api/risk-forecast/sea/traffic-cells 저장본(종전 MTIS 웹 응답)에서 그대로 옮긴 값.
        assert.deepEqual(C.cellBounds('GR4_F4G31_M4'), [126.125, 34.35, 126.15, 34.375]);
        assert.deepEqual(C.cellBounds('GR4_F4K23_P4'), [126.525, 33.55, 126.55, 33.575]);
        const b = C.cellBounds('GR4_F2I33_E4');  // 공공데이터포털 혼잡예보 API 중심 37.2125, 124.2375
        assert.ok(Math.abs((b[0] + b[2]) / 2 - 124.2375) < 1e-9 && Math.abs((b[1] + b[3]) / 2 - 37.2125) < 1e-9);
        assert.deepEqual(C.geometry(C.cellBounds('GR4_F4G31_M4')).coordinates[0], [[126.125, 34.375], [126.15, 34.375], [126.15, 34.35], [126.125, 34.35], [126.125, 34.375]]);
        for (const bad of ['GR4_F4K23_Z4', 'GR4_F5K23_P4', 'GR4_F4Q23_P4', 'GR4_F4K03_P4', 'F4K23_P4', 'GR4_A1A11_A1']) assert.equal(C.cellBounds(bad), null, bad);
    });
    await check('API: 위치를 계산할 수 없는 격자번호 줄은 뺀다(형식은 맞아도)', async () => {
        const r = await C.readApi({ dir: tmp(), key: 'k', now, fetchImpl: apiFetch([['GR4_F4K23_P4', 3, 1], ['GR4_F4K23_Z4', 2, 1]]) });
        assert.deepEqual(r.rows.map((x) => x.id), ['GR4_F4K23_P4']);
        assert.deepEqual(r.dropped, { '격자번호 형식': 1 });
    });
    await check('새 격자는 번호에서 계산한 경계·중심으로 위치표에 붙고 행은 [번호,척수,밀집도] 3칸', async () => {
        const dir = tmp();
        const c = C.createCollector({ dir, key: 'k', clock: () => now, describe, fetchImpl: apiFetch([['GR4_F4K23_P4', 5, 10]]) });
        assert.equal((await c.collect()).ok, true);
        const d = io.read(path.join(dir, 'sea_realtime.json.gz'));
        assert.equal(d.cells.length, 1);
        assert.deepEqual(d.cells[0].bounds, [126.525, 33.55, 126.55, 33.575]);
        assert.equal(d.cells[0].lat, 33.5625); assert.equal(d.cells[0].lon, 126.5375);
        assert.deepEqual(d.cells[0].geometry.coordinates[0][0], [126.525, 33.575]);
        assert.deepEqual(d.rows, [[0, 5, 10]]);
        assert.equal(d.source, 'MTIS realtime API');
        assert.equal('typeCollectedAt' in d, false);
    });
    await check('위치표가 상한(3만 칸)을 넘게 되면 이번 응답의 칸만으로 다시 만든다(수집이 멈추지 않는다)', async () => {
        const dir = tmp();
        const old = Array.from({ length: 30000 }, (_, i) => ({ id: 'old' + i, i }));
        io.write(path.join(dir, 'sea_realtime.json.gz'), { v: 'x', cells: old, rows: [] });
        const c = C.createCollector({ dir, key: 'k', clock: () => now, describe, fetchImpl: apiFetch([['GR4_F4K23_P4', 5, 10]]) });
        assert.equal((await c.collect()).ok, true);
        const d = io.read(path.join(dir, 'sea_realtime.json.gz'));
        assert.deepEqual(d.cells.map((x) => x.id), ['GR4_F4K23_P4']);
        assert.deepEqual(d.rows, [[0, 5, 10]]);
    });
    await check('오류 이력도 상세를 보관한다(200자 이내·문자열만)', () => {
        const dir = tmp();
        const H = require('../services/risk_error_history').createHistory({ dir, clock: () => now });
        H.recordCollector('realtime', { status: 'error', lastError: 'HTTP 503', lastRun: io.iso(now), detail: 'API HTTP 503' });
        const cur = H.list({}).current.find((r) => r.source === 'realtime');
        assert.equal(cur.detail, 'API HTTP 503');
    });
    await check('관리자 화면이 「상세」 줄을 그린다', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'js', 'admin', 'admin.js'), 'utf8');
        // 2026-10-15 오류현황 화면을 카드 꼴로 정리하며 줄 모음(lines)의 한 칸이 됐다.
        //   실제 화면에 「상세」 가 그려지는지는 test_risk_errors_filter_ui 가 Chromium 으로 본다.
        assert.ok(src.includes("['상세', r.detail]"));
    });
    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();
