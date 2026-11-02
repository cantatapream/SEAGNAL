/**
 * 역할: 시정 표시가 「최신 자료가 아니면 정보 없음」으로 나오는지 확인한다(사용자 확정 2026-10-15).
 *       MMIS 가 빈 응답만 주며 시정 수집이 멈춘 동안 하루 전 예보(10월 14일 16시 20km)가 오늘 값처럼
 *       특보구역 뱃지·바텀시트 카드에 떴다 — 두 화면 모두 가장 가까운 frame 을 거리 제한 없이 골랐기 때문.
 *       시각은 실행 순간 기준 상대값으로 만든다(시각 의존 시험 금지 규칙).
 * [연계] client/js/ocean-map/warnings/ocean_warn_vsby.js(makeBadge) ·
 *        client/js/ocean-map/bottom-sheet/ocean_bottom_sheet_vsby.js(OS.loadVsbyCard) · scripts/refactor/verify_all.sh SUITES
 * [로드 순서] 시험 스크립트 — node local_server/scripts/test_vsby_stale.js
 */
'use strict';
process.env.TZ = 'Asia/Seoul';   // ocean_warn_vsby 의 _parseTm 은 기기 시간대(한국)로 KST 문자열을 읽는다
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const CLIENT = path.join(__dirname, '..', '..', 'client', 'js', 'ocean-map');
let pass = 0, fail = 0;
async function test(name, fn) { try { await fn(); pass++; console.log('✅ ' + name); } catch (e) { fail++; console.log('❌ ' + name + ' — ' + e.message); } }
const tick = () => new Promise((r) => setTimeout(r, 0));

/** 지금으로부터 h 시간 뒤의 KST 벽시계 "YYYY.MM.DD HH:00" (정시로 내림). */
function kst(h) {
    const d = new Date(Date.now() + h * 3600e3 + 9 * 3600e3);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())} ${p(d.getUTCHours())}:00`;
}
/** from~to 시간(지금 기준 상대) 1시간 간격 시계열. */
function series(from, to, v) { const out = []; for (let h = from; h <= to; h++) out.push({ t: kst(h), v }); return out; }

function el() {
    return { className: '', dataset: {}, style: {}, innerHTML: '', title: '', textContent: '', listeners: {},
        addEventListener(t, f) { this.listeners[t] = f; }, appendChild() {}, querySelector() { return null }, querySelectorAll() { return []; } };
}

/** ocean_warn_vsby.js 를 가짜 브라우저에 올린다. zoneCells 는 /api/vsby-smallzone 응답 cells. */
async function loadWarn(zoneCells) {
    const calls = [];
    const win = { ZoneAvg: { refreshAll() {} }, _showOceanToast() {} };
    const ctx = {
        window: win, console, setTimeout, clearTimeout, Promise, Date, Math, Object, Array, JSON, isFinite, Number, String,
        document: { readyState: 'complete', getElementById: () => null, createElement: el, head: el(), body: el(), addEventListener() {} },
        fetch: (url) => {
            calls.push(url);
            const body = url.includes('zone_grid_map') ? { Z1: { name: '시험해역', smallZones: ['144-9'] } }
                : url.includes('vsby-smallzone') ? { success: true, cells: zoneCells() } : {};
            return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
        }
    };
    vm.runInNewContext(fs.readFileSync(path.join(CLIENT, 'warnings', 'ocean_warn_vsby.js'), 'utf8'), ctx);
    await tick(); await tick();
    const badge = async () => { win.OceanWarnVsby.makeBadge('시험해역'); for (let i = 0; i < 5; i++) await tick(); return win.OceanWarnVsby.makeBadge('시험해역'); };
    return { badge, calls };
}

/** ocean_bottom_sheet_vsby.js 를 가짜 브라우저에 올린다. 카드에 찍힌 글자를 돌려준다. */
async function cardValue(pointSeries, date) {
    let shown = null;
    const OS = { setCardValue: (id, text) => { shown = text; } };
    const ctx = {
        window: { OceanSheet: OS }, console, Promise, Date, Math, Number, String, isFinite, Array,
        document: { getElementById: () => el() },
        fetch: () => Promise.resolve({ json: () => Promise.resolve({ success: true, series: pointSeries }) })
    };
    vm.runInNewContext(fs.readFileSync(path.join(CLIENT, 'bottom-sheet', 'ocean_bottom_sheet_vsby.js'), 'utf8'), ctx);
    OS.loadVsbyCard(35.1, 129.1, date || new Date());
    for (let i = 0; i < 4; i++) await tick();
    return shown;
}

(async () => {
    await test('특보구역 뱃지: 지금 앞뒤 frame 이 있으면 값을 띄운다', async () => {
        const w = await loadWarn(() => ({ '144-9': series(-3, 12, 4) }));
        const b = await w.badge();
        assert.ok(b && /시정<\/span> 4km/.test(b.innerHTML), b && b.innerHTML);
    });
    await test('★특보구역 뱃지: 자료가 20시간 전에서 끝났으면 옛 값 대신 「정보 없음」(회색, 팝업 안 띄움)', async () => {
        const w = await loadWarn(() => ({ '144-9': series(-40, -20, 20) }));
        const b = await w.badge();
        assert.ok(b, '뱃지가 아예 사라지면 안 된다 — 「정보 없음」 으로 보여야 한다');
        assert.match(b.innerHTML, /정보 없음/); assert.doesNotMatch(b.innerHTML, /20km/);
        assert.match(b.className, /vsby-disabled/);
    });
    await test('특보구역 뱃지: 「정보 없음」 뒤에 새 런이 들어오면 쿨다운 뒤 다시 받아 정상 값으로 돌아온다', async () => {
        let cells = { '144-9': series(-40, -20, 20) };
        const w = await loadWarn(() => cells);
        await w.badge();
        const before = w.calls.filter((u) => u.includes('vsby-smallzone')).length;
        cells = { '144-9': series(-2, 10, 7) };   // 서버에 새 런이 들어왔다
        const realNow = Date.now; Date.now = () => realNow() + 11 * 60e3;   // 쿨다운(10분) 경과
        try {
            const b = await w.badge();
            assert.ok(w.calls.filter((u) => u.includes('vsby-smallzone')).length > before, '서버에 다시 물어야 한다');
            assert.ok(b && /7km/.test(b.innerHTML), b && b.innerHTML);
        } finally { Date.now = realNow; }
    });
    await test('바텀시트 카드: 선택 시각 frame 이 있으면 값', async () => {
        assert.equal(await cardValue(series(-3, 12, 5)), '5km');
    });
    await test('★바텀시트 카드: 자료가 20시간 전에서 끝났으면 「정보 없음」', async () => {
        assert.equal(await cardValue(series(-40, -20, 20)), '정보 없음');
    });
    await test('바텀시트 카드: 선택 시각이 자료 끝을 1시간 넘게 지나면 「정보 없음」, 안쪽이면 값', async () => {
        const s = series(-5, 5, 3);
        assert.equal(await cardValue(s, new Date(Date.now() + 8 * 3600e3)), '정보 없음');
        assert.equal(await cardValue(s, new Date(Date.now() + 4 * 3600e3)), '3km');
    });
    await test('바텀시트 카드: 날짜가 바뀌는 자정 앞뒤도 시간 거리를 맞게 잰다(23시 자료로 00시 선택 → 값)', async () => {
        // 키(YYYYMMDDHHmm)를 그냥 빼면 23시↔다음날 00시가 7700 으로 벌어져 「정보 없음」 이 되던 함정
        const d = new Date(Date.UTC(2026, 9, 14, 15, 0));            // 2026-10-15 00:00 KST
        assert.equal(await cardValue([{ t: '2026.10.14 23:00', v: 6 }], d), '6km');
    });
    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();
