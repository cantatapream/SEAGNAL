/**
 * 파일명: local_server/scripts/test_no_mtis_web.js
 * 역할  : 서버 코드가 MTIS 웹 화면(mtis.komsa.or.kr)에 자동 접속하지 않는지 지킨다.
 *         공식 Open API(mtisopenapi.komsa.or.kr)·공공데이터포털 API 만 쓴다.
 *         사용자 결정 2026-10-15 원문: 「다른쪽에 이용약관에 사용하면 안된다고 써있어서 오토 스크래핑은 하면 안될 것 같아.
 *         이 부분은 코드에서 제외하도록 수정할 수 있도록 해줘.」
 * [연계] services/sea_realtime_collector.js(실시간 교통) · services/sea_accident_collector.js(사고예보)
 *        · services/mtis_accident_grid.js(사고 격자 경계 계산) · scripts/refactor/verify_all.sh SUITES
 * [로드 순서] 독립 Node 실행 — 실제 네트워크 없음(가짜 응답만), 임시 폴더만 쓴다.
 */
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
// 이 파일 자신에 웹 주소 글자가 들어가 검사에 걸리지 않도록 조각으로 만든다.
const WEB_HOST = ['mtis', 'komsa', 'or', 'kr'].join('.');
const API_HOST = 'mtisopenapi.komsa.or.kr';
let pass = 0, fail = 0;
async function check(name, fn) { try { await fn(); pass++; console.log('✅ ' + name); } catch (e) { fail++; console.log('❌ ' + name + ' — ' + e.message); } }
/** local_server 아래 .js 파일 목록(node_modules 제외). @param {string} dir @returns {string[]} */
function jsFiles(dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...jsFiles(p));
        else if (e.name.endsWith('.js')) out.push(p);
    }
    return out;
}
/** 부른 주소의 호스트를 모두 적는 가짜 fetch. 공식 API 는 정상 응답, 그 밖은 404(실제 접속 없음). */
function recorder(apiBody) {
    const hosts = [];
    const fetchImpl = async (url) => {
        const host = new URL(String(url)).hostname;
        hosts.push(host);
        if (host !== API_HOST) return { ok: false, status: 404, headers: { getSetCookie: () => [] }, text: async () => '', json: async () => ({}) };
        return { ok: true, status: 200, json: async () => apiBody(new URL(String(url))) };
    };
    return { hosts, fetchImpl };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'no-mtis-web-'));

(async () => {
    // 혹시 주입을 무시하고 전역 fetch 를 쓰는 코드가 있으면 여기서 잡는다(실제 접속 차단).
    const globalHosts = [];
    globalThis.fetch = async (url) => { globalHosts.push(new URL(String(url)).hostname); throw Error('network disabled in test'); };

    await check('local_server 의 .js 어디에도 MTIS 웹 주소·웹 화면 경로가 없다', () => {
        const hits = [];
        for (const f of jsFiles(ROOT)) {
            if (f === __filename) continue;
            const s = fs.readFileSync(f, 'utf8');
            if (s.includes(WEB_HOST) || /\/traffic\/(?:liveSea|focst)/.test(s)) hits.push(path.relative(ROOT, f));
        }
        assert.deepEqual(hits, []);
    });
    await check('웹 화면 수집 모듈(mtis_live_web.js)이 없다', () => {
        assert.equal(fs.existsSync(path.join(ROOT, 'services', 'mtis_live_web.js')), false);
    });
    await check('실시간 교통 수집 한 번 — 공식 API 호스트에만 접속한다', async () => {
        const C = require('../services/sea_realtime_collector');
        const { hosts, fetchImpl } = recorder(() => ({ response: { header: { resultCode: '200', resultMsg: 'NORMAL_SERVICE' },
            body: { items: { item: [{ grid_id: 'GR4_F4K23_P4', vmtc: 3, dnsty: 1 }] }, totalCount: 1, regDt: '2026-10-15 15:10:06' } } }));
        const c = C.createCollector({ dir: tmp(), key: 'k', clock: () => Date.parse('2026-10-15T15:12:00+09:00'), fetchImpl, describe: (r) => ({ id: String(r.gridId) }) });
        await c.collect();
        assert.ok(hosts.length > 0, '한 번도 부르지 않음');
        assert.deepEqual([...new Set(hosts)], [API_HOST]);
    });
    await check('공식 사고예보 수집 한 번 — 공식 API 호스트에만 접속한다(격자 경계도 웹에서 받지 않는다)', async () => {
        const A = require('../services/sea_accident_collector');
        const created = '2026-10-11 12:00:00';
        // 실제 운영 격자 한 칸(id 32)의 공식 중심점 — 계산 경계가 맞아야 수집이 끝까지 간다.
        const { hosts, fetchImpl } = recorder((u) => ({ response: { header: { resultCode: '200', resultMsg: 'NORMAL_SERVICE' }, body: { totalCount: 1,
            items: { item: [{ gridId: 32, latitude: 33.088353, longitude: 126.041135, fcstDate: u.searchParams.get('fcstDate'), fcstTime: u.searchParams.get('fcstTime'), fcstCreateDateTime: created, accidentRiskIndex: '.001', accidentRiskLevel: '경계' }] } } } }));
        const c = A.createCollector({ dir: tmp(), key: 'k', clock: () => Date.parse('2026-10-11T15:10:00+09:00'), fetchImpl });
        const r = await c.collect();
        assert.ok(hosts.length > 0, '한 번도 부르지 않음');
        assert.deepEqual([...new Set(hosts)], [API_HOST]);
        assert.equal(r.ok, true, JSON.stringify(r));
    });
    await check('전역 fetch 로 몰래 나간 접속이 없다', () => { assert.deepEqual(globalHosts, []); });
    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();
