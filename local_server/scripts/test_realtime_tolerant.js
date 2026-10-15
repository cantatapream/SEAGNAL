/**
 * 파일명: local_server/scripts/test_realtime_tolerant.js
 * 역할  : 실시간 선박 교통 수집이 「이상한 줄 하나」 때문에 전체를 버리지 않고 그 줄만 빼는지,
 *         뺀 사유·실패 사유를 관리자 오류현황(상세 한 줄)으로 남기는지 확인한다.
 *         2026-10-15 운영에서 「invalid response」로 하루 넘게 갱신이 멈췄는데, 어느 줄·어느 단계 때문인지
 *         기록이 없어 원인을 못 찾았다(사용자 「키없이 바로 할 수 있는 수정을 진행하자」).
 * [연계] services/sea_realtime_collector.js(readApi·normalizeWeb·collect) · services/mtis_live_web.js(보안 토큰)
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
/** 웹 응답 — 격자 하나(F4K23_P4, 0.025° 정사각형), 척수 n. */
function web(n = 5) {
    const p = { gridId: 'F4K23_P4', shipCount: String(n) };
    for (let i = 1; i <= 7; i++) p['s' + String(i).padStart(3, '0') + 'Count'] = String(i === 1 ? n : 0);
    for (let i = 1; i <= 10; i++) p['t' + String(i).padStart(3, '0') + 'Count'] = String(i === 5 ? n : 0);
    const ring = [[126, 33], [126.025, 33], [126.025, 33.025], [126, 33.025], [126, 33]];
    return { collection: { type: 'FeatureCollection', features: [{ properties: p, geometry: { type: 'Polygon', coordinates: [ring] } }] }, densities: [{ gridId: 'F4K23_P4', density: '10' }] };
}
const describe = (g) => ({ id: g.gridId, name: 'x' });
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
        const c = C.createCollector({ dir, key: 'k', clock: () => now, describe, fetchImpl: apiFetch([['GR4_F4K23_P4', 5, 101], ['bad', 1, 1]]), webFetch: async () => web(5) });
        const res = await c.collect();
        assert.equal(res.ok, true, JSON.stringify(res));
        const st = io.read(path.join(dir, 'realtime_status.json'));
        assert.match(st.detail, /^API 2줄: /); assert.match(st.detail, /격자번호 형식 1/); assert.match(st.detail, /밀집도 범위 밖\(척수는 유지\) 1/);
        assert.equal(/k=|serviceKey|https?:/.test(st.detail), false, '키·주소가 섞이면 안 된다');
        const reader = require('../services/risk_history_sources').createReader({ dir, clock: () => now });
        const src = await reader();
        assert.equal(src.realtime.detail, st.detail);
    });
    await check('두 길 모두 실패 → 「API 무엇 · 웹 무엇」 이 상세로 남는다(보안 토큰 없음 포함)', async () => {
        const dir = tmp();
        const tokenErr = Object.assign(Error('invalid response'), { detail: '접속 페이지에 보안 토큰 없음' });
        const c = C.createCollector({ dir, key: 'k', clock: () => now, describe, fetchImpl: async () => ({ ok: false, status: 503 }), webFetch: async () => { throw tokenErr; } });
        const res = await c.collect();
        assert.equal(res.ok, false);
        const st = io.read(path.join(dir, 'realtime_status.json'));
        assert.equal(st.lastError, 'invalid response');
        assert.equal(st.detail, 'API HTTP 503 · 웹 invalid response(접속 페이지에 보안 토큰 없음)');
    });
    await check('오류 이력도 상세를 보관한다(200자 이내·문자열만)', () => {
        const dir = tmp();
        const H = require('../services/risk_error_history').createHistory({ dir, clock: () => now });
        H.recordCollector('realtime', { status: 'error', lastError: 'invalid response', lastRun: io.iso(now), detail: 'API HTTP 503 · 웹 invalid response' });
        const cur = H.list({}).current.find((r) => r.source === 'realtime');
        assert.equal(cur.detail, 'API HTTP 503 · 웹 invalid response');
    });
    await check('관리자 화면이 「상세」 줄을 그린다', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'js', 'admin', 'admin.js'), 'utf8');
        assert.ok(src.includes("(r.detail?'<br>상세 '+esc(r.detail):'')"));
    });
    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();
