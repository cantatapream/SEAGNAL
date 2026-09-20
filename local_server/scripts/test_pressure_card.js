/**
 * test_pressure_card.js — 바텀시트 "기압" 카드가 조용히 깨지지 않게 고정한다.
 *
 * [왜 있나] 기압은 우리가 처음으로 외부 소스(OpenWeather)에서 받아오는 값이고,
 *   화면에서는 숫자 한 개로만 보인다. 그래서 "어느 예보 칸을 골랐나"·"해면기압을
 *   썼나 지면기압을 썼나" 가 틀려도 화면만 봐서는 알 수 없다. 상류 호출 없이
 *   확인할 수 있는 규칙들을 여기서 고정한다.
 *
 * [무엇을 고정하나]
 *   ① 계산 규칙 — 요청 시각에 가장 가까운 3시간 칸 선택, 허용 오차(±90분) 밖이면 값 없음,
 *      해면기압(sea_level) 우선.
 *   ② 화면 배선 — 카드 마크업(id)과 바텀시트 코드의 호출·초기화 목록이 서로 맞는가.
 *   ③ 게이트 등록 — 이 스위트가 verify_all.sh 에 올라가 있는가.
 *   ④ 응답 만들기 — fetch 를 가짜로 바꿔 끼워, 상류 값이 왔을 때 무엇을 돌려주는지.
 *
 * [실제 응답] 2026-09-20 에 실제로 받은 응답 1건을 붙박이로 넣어 필드 이름을 고정했다.
 *   다만 이 스위트는 네트워크를 쓰지 않으므로, 상류가 응답 형식을 바꾸면 여기서는 안 걸린다.
 *
 * [실행] node local_server/scripts/test_pressure_card.js
 * [연계] ← scripts/refactor/verify_all.sh SUITES
 *        → local_server/routes/pressure.js
 *        → client/js/ocean-map/bottom-sheet/ocean_bottom_sheet5.js · client/index2.html
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
// 라우트 모듈은 require 시점에 인증키를 읽는다 → 그 전에 시험용 키를 심는다.
// (네트워크는 쓰지 않는다. 아래 [4] 에서 fetch 를 가짜로 바꿔 끼운다.)
process.env.OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY || 'test-key-not-real';
const route = require(path.join(ROOT, 'local_server', 'routes', 'pressure.js'));

const SHEET_SRC = fs.readFileSync(
    path.join(ROOT, 'client', 'js', 'ocean-map', 'bottom-sheet', 'ocean_bottom_sheet5.js'), 'utf8');
const HTML_SRC = fs.readFileSync(path.join(ROOT, 'client', 'index2.html'), 'utf8');
const SERVER_SRC = fs.readFileSync(path.join(ROOT, 'local_server', 'server.js'), 'utf8');
const VERIFY_SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'refactor', 'verify_all.sh'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

/** 3시간 간격 예보 목록을 만든다. 기준시각 base(ms)부터 3시간씩, 기압은 1000부터 1씩 증가. */
function makeList(baseMs, count) {
    const out = [];
    for (let i = 0; i < count; i++) {
        out.push({ dt: Math.floor((baseMs + i * 3 * 3600 * 1000) / 1000), main: { sea_level: 1000 + i } });
    }
    return out;
}

// ── [1] 계산 규칙 ──────────────────────────────────────────────────────────
console.log('\n[1] 계산 규칙 — 어느 칸을 고르고, 어느 기압 값을 쓰는가');

// 기준일은 실행 시각과 무관하게 고정한다(시각 의존 테스트 금지 — CLAUDE.md 결정로그 2026-08-09).
const BASE = Date.UTC(2026, 0, 5, 0, 0, 0);   // 2026-01-05 00:00 UTC
const list = makeList(BASE, 8);                // 00·03·06·09·12·15·18·21시

ok('정각과 같은 시각이면 그 칸을 고른다',
    route._nearestSlot(list, BASE + 6 * 3600 * 1000).pressure === 1002);

ok('07:20 은 06시 칸으로 간다(가장 가까운 칸)',
    route._nearestSlot(list, BASE + 7 * 3600 * 1000 + 20 * 60 * 1000).pressure === 1002);

ok('07:40 은 09시 칸으로 간다(가장 가까운 칸)',
    route._nearestSlot(list, BASE + 7 * 3600 * 1000 + 40 * 60 * 1000).pressure === 1003);

ok('목록 밖(마지막 칸에서 5시간 뒤)이면 값을 지어내지 않고 없음으로 둔다',
    route._nearestSlot(list, BASE + 26 * 3600 * 1000) === null);

ok('목록이 비었으면 없음',
    route._nearestSlot([], BASE) === null && route._nearestSlot(null, BASE) === null);

ok('dt 가 없는 항목은 건너뛴다',
    route._nearestSlot([{ main: { pressure: 900 } }, list[2]], BASE + 6 * 3600 * 1000).pressure === 1002);

ok('해면기압(sea_level)이 있으면 그쪽을 쓴다',
    route._pickPressure({ pressure: 990, sea_level: 1013 }) === 1013);

ok('해면기압이 없으면 pressure 를 쓴다',
    route._pickPressure({ pressure: 1007 }) === 1007);

ok('소수는 정수로 반올림한다(화면에 소수점 없는 hPa 로 나간다)',
    route._pickPressure({ pressure: 1007.6 }) === 1008);

ok('값이 없거나 숫자가 아니면 없음',
    route._pickPressure(null) === null &&
    route._pickPressure({}) === null &&
    route._pickPressure({ pressure: 'abc' }) === null);

// 실제 응답 1건을 그대로 고정한다 — 2026-09-20 부산 앞바다(35.1N/129.1E) 호출 결과.
// 필드 이름이 바뀌거나 우리가 엉뚱한 칸을 읽으면 여기서 먼저 걸린다.
const REAL_CURRENT = {
    coord: { lon: 129.1, lat: 35.1 },
    main: { temp: 294.73, pressure: 1013, humidity: 68, sea_level: 1013, grnd_level: 1010 },
    wind: { speed: 4.12, deg: 50 }, dt: 1789907230, name: 'Busan', cod: 200
};
ok('실제 응답에서 해면기압 1013 hPa 을 뽑는다',
    route._pickPressure(REAL_CURRENT.main) === 1013);
ok('지면기압(grnd_level 1010)을 잘못 집지 않는다',
    route._pickPressure(REAL_CURRENT.main) !== 1010);

ok('sea_level 이 없으면 pressure 로 가되, grnd_level 은 어떤 경우에도 쓰지 않는다',
    route._pickPressure({ pressure: 1005, grnd_level: 980 }) === 1005 &&
    route._pickPressure({ grnd_level: 980 }) === null);

// 시각을 사람에게 보일 때는 항상 KST (CLAUDE.md '시간 표기' 규칙).
ok('KST 표기 — UTC 00시는 한국 09시로 적는다',
    route._kstLabel(Date.UTC(2026, 0, 5, 0, 0, 0)) === '01-05 09시 KST');
ok('KST 표기 — 날짜가 넘어가는 경우(UTC 18시 → 다음날 03시)',
    route._kstLabel(Date.UTC(2026, 0, 5, 18, 0, 0)) === '01-06 03시 KST');

// ── [2] 화면 배선 ──────────────────────────────────────────────────────────
console.log('\n[2] 화면 배선 — 카드 마크업과 바텀시트 코드가 맞물려 있는가');

ok('index2.html 에 기압 카드(#ocean-card-pressure)가 있다',
    /id="ocean-card-pressure"/.test(HTML_SRC));

ok('index2.html 에 기압 값 자리(#ocean-val-pressure)가 있다',
    /id="ocean-val-pressure"/.test(HTML_SRC));

ok('바텀시트가 기압을 불러온다(fetchPressure 호출)',
    /fetchPressure\(lat, lon, d, myEpoch\);/.test(SHEET_SRC));

ok('슬라이더 시각을 절대 시각이 아니라 오프셋(off)으로 보낸다 — 단말 시계 오차 차단',
    /'&off=' \+ Math\.round\(off\)/.test(SHEET_SRC) &&
    /dateObj\.getTime\(\) - Date\.now\(\)/.test(SHEET_SRC) &&
    !/'&ts='/.test(SHEET_SRC));

ok('카드 초기화 목록에 기압이 들어 있다(이전 값이 남지 않게)',
    /'ocean-val-vsby', 'ocean-val-pressure'/.test(SHEET_SRC));

ok('카드 표시 목록에 기압이 들어 있다',
    /'ocean-card-vsby', 'ocean-card-pressure'/.test(SHEET_SRC));

ok('값이 없으면 카드를 숨긴다(다른 카드와 같은 정책)',
    /OS\.hideCard\('ocean-card-pressure'\)/.test(SHEET_SRC));

ok('server.js 가 기압 라우터를 등록한다',
    /require\('\.\/routes\/pressure'\)/.test(SERVER_SRC));

const ROUTE_SRC = fs.readFileSync(path.join(ROOT, 'local_server', 'routes', 'pressure.js'), 'utf8');
ok('서버가 기준 시각을 자기 시계에서 잡는다(now + off)',
    /const ts = now \+ off;/.test(ROUTE_SRC) && !/req\.query\.ts/.test(ROUTE_SRC));

// ── [3] 게이트 등록 ────────────────────────────────────────────────────────
console.log('\n[3] 게이트 등록 — 이 스위트가 verify_all.sh 에 올라가 있는가');
ok('verify_all.sh SUITES 에 test_pressure_card 가 있다',
    /test_pressure_card/.test(VERIFY_SRC));

// ── [4] 응답 만들기 — 상류 응답이 왔을 때 무엇을 돌려주나 ──────────────────
// 네트워크를 쓰지 않고, fetch 를 가짜로 바꿔 끼워 핸들러를 직접 부른다.
// [왜] 여기까지 시험하지 않으면 "값이 실제로 왔을 때" 경로가 한 번도 안 돌아본 채
//   배포된다 — 실패 경로(카드 숨김)만 확인하고 넘어가기 쉽다.
const handler = route.stack.find(l => l.route && l.route.path === '/api/ocean/pressure')
    .route.stack[0].handle;

/**
 * 가짜 상류 응답을 물려 핸들러를 한 번 돌리고, 돌려준 JSON 을 가져온다.
 * @param {Object} query - ?lat=&lon=&off= 에 해당하는 값들
 * @param {Object} upstream - { current, forecast } 두 가지 가짜 응답
 * @returns {Promise<Object>} 라우트가 res.json 으로 내보낸 객체
 */
async function callRoute(query, upstream) {
    const realFetch = global.fetch;
    global.fetch = async (url) => ({
        ok: true,
        status: 200,
        json: async () => (String(url).indexOf('/forecast') >= 0 ? upstream.forecast : upstream.current)
    });
    let out = null;
    try {
        await handler({ query }, { set() {}, json(o) { out = o; } });
    } finally {
        global.fetch = realFetch;
    }
    return out;
}

(async () => {
    console.log('\n[4] 응답 만들기 — 상류 응답이 왔을 때 무엇을 돌려주나');

    // 실제로 받은 현재날씨 응답의 기압 칸 그대로(부산, 2026-09-20)
    const curBody = { main: { pressure: 1013, sea_level: 1013, grnd_level: 1010 }, dt: 1789907230 };
    const now = Date.now();
    const fctBody = {
        list: [
            { dt: Math.floor((now + 3 * 3600 * 1000) / 1000), main: { sea_level: 1007, grnd_level: 990 } },
            { dt: Math.floor((now + 6 * 3600 * 1000) / 1000), main: { sea_level: 1004, grnd_level: 988 } }
        ]
    };
    const up = { current: curBody, forecast: fctBody };

    // 좌표를 조금씩 달리 해 캐시가 앞 시험의 응답을 물고 오지 않게 한다.
    const a = await callRoute({ lat: '35.1', lon: '129.1', off: '0' }, up);
    ok('지금(off=0) → 현재날씨에서 1013 hPa 을 돌려준다',
        !!a && a.success === true && a.pressure === 1013 && a.source === 'current', JSON.stringify(a));
    ok('시각을 KST 로도 함께 내려준다',
        !!a && / KST$/.test(a.validAtKst || ''), a && a.validAtKst);

    const b = await callRoute({ lat: '35.2', lon: '129.2', off: String(6 * 3600 * 1000) }, up);
    ok('6시간 뒤 → 예보에서 그 칸(1004 hPa)을 돌려준다',
        !!b && b.success === true && b.pressure === 1004 && b.source === 'forecast', JSON.stringify(b));

    const c = await callRoute({ lat: '35.3', lon: '129.3', off: String(6 * 3600 * 1000) },
        { current: curBody, forecast: { list: [] } });
    ok('예보가 비면 값을 지어내지 않고 없음(out_of_range)으로 답한다',
        !!c && c.success === false && c.reason === 'out_of_range', JSON.stringify(c));

    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail > 0 ? 1 : 0);
})();
