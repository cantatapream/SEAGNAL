/**
 * test_typhoon_source.js — 태풍 탭 "자료 출처" 전환이 조용히 깨지지 않게 고정한다.
 *
 * [왜 있나] 기관마다 태풍을 다르게 기술한다. 기상청은 "장반경·단반경·단반경 방위 + 중심기압 +
 *   70% 확률반경", JTWC 는 "네 방향 거리 + 폭풍 종류"이고 중심기압·확률반경이 아예 없다.
 *   이 차이를 서버에서 우리 프레임 형식으로 옮기는데, 옮기는 규칙이 틀려도 지도에는
 *   그럴듯한 그림이 그려진다 — 눈으로는 안 걸린다. 그래서 규칙을 여기서 못박는다.
 *
 * [무엇을 고정하나]
 *   ① 변환 규칙 — 네 방향 → (장반경·단반경·단반경 방위), 폭풍 종류 → 강도, 시각 → KST.
 *   ② 없는 값을 지어내지 않는가 — 중심기압·70%확률반경은 반드시 null 이어야 한다.
 *   ③ 화면 배선 — 출처 드롭다운 5개가 있고, 미연동 3개는 잠겨 있는가. 출처 표기가 붙는가.
 *   ④ 게이트 등록.
 *
 * [실제 응답] 2026-09-22 에 받은 두쥐안(2026-WP-24) 응답 일부를 붙박이로 넣었다.
 *   네트워크는 쓰지 않는다.
 *
 * [실행] node local_server/scripts/test_typhoon_source.js
 * [연계] ← scripts/refactor/verify_all.sh SUITES
 *        → local_server/routes/typhoon_foreign.js
 *        → client/js/typhoon/ocean_typhoon.js · client/index2.html
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
// 라우트는 require 시점에 키를 읽는다 → 그 전에 시험용 키를 심는다(네트워크는 안 쓴다).
process.env.XWEATHER_CLIENT_ID = process.env.XWEATHER_CLIENT_ID || 'test-id';
process.env.XWEATHER_CLIENT_SECRET = process.env.XWEATHER_CLIENT_SECRET || 'test-secret';
const route = require(path.join(ROOT, 'local_server', 'routes', 'typhoon_foreign.js'));

const TYPHOON_SRC = fs.readFileSync(
    path.join(ROOT, 'client', 'js', 'typhoon', 'ocean_typhoon.js'), 'utf8');
const HTML_SRC = fs.readFileSync(path.join(ROOT, 'client', 'index2.html'), 'utf8');
const SERVER_SRC = fs.readFileSync(path.join(ROOT, 'local_server', 'server.js'), 'utf8');
const VERIFY_SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'refactor', 'verify_all.sh'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

// 2026-09-22 실제 응답의 예보 첫 시점(두쥐안). 필드 이름이 바뀌면 여기서 먼저 걸린다.
const REAL_FORECAST_NODE = {
    location: { type: 'Point', coordinates: [157.5, 40.9] },
    details: {
        basin: 'WP', stormType: 'TS', stormCat: 'TS',
        stormName: 'Tropical Storm Dujuan', advisoryNumber: '28',
        movement: { directionDEG: 76, direction: 'ENE', speedKTS: 35, speedKPH: 65, speedMPS: 18 },
        windRadii: [
            { quadrants: { ne: { distanceKM: 166.68 }, se: { distanceKM: 351.88 },
                           sw: { distanceKM: 370.4 }, nw: { distanceKM: 240.76 } },
              windSpeedKTS: 34, windSpeedKPH: 63, windSpeedMPS: 17 },
            { quadrants: { ne: { distanceKM: 74.08 }, se: { distanceKM: 129.64 },
                           sw: { distanceKM: 111.12 }, nw: { distanceKM: 0 } },
              windSpeedKTS: 50, windSpeedKPH: 93, windSpeedMPS: 26 }
        ],
        windSpeedKTS: 50, windSpeedKPH: 93, windSpeedMPS: 26,
        gustSpeedKTS: 65, gustSpeedMPS: 33,
        pressureMB: null, pressureIN: null
    },
    timestamp: 1790100000,
    dateTimeISO: '2026-09-23T04:00:00+10:00',
    loc: { long: 157.5, lat: 40.9 }
};

// ── [1] 변환 규칙 ──────────────────────────────────────────────────────────
console.log('\n[1] 변환 규칙 — 네 방향 반경·폭풍 종류·시각을 어떻게 옮기는가');

const q34 = route._pickQuad(REAL_FORECAST_NODE.details.windRadii, 34);
ok('34노트 네 방향 거리를 그대로 읽는다',
    q34 && q34.ne === 167 && q34.se === 352 && q34.sw === 370 && q34.nw === 241,
    JSON.stringify(q34));

const a34 = route._quadToAsym(q34);
ok('가장 먼 쪽(남서 370km)이 장반경이 된다', a34 && a34.long === 370, JSON.stringify(a34));
ok('가장 가까운 쪽(북동 167km)이 단반경이 되고 방위도 그쪽이다',
    a34 && a34.short === 167 && a34.dir === 'NE', JSON.stringify(a34));

const q50 = route._pickQuad(REAL_FORECAST_NODE.details.windRadii, 50);
ok('50노트에서 0km 인 방향(북서)도 버리지 않고 그대로 둔다', q50 && q50.nw === 0, JSON.stringify(q50));

ok('네 방향이 모두 0이면 없음으로 둔다',
    route._pickQuad([{ windSpeedKTS: 34, quadrants: { ne:{distanceKM:0}, se:{distanceKM:0},
      sw:{distanceKM:0}, nw:{distanceKM:0} } }], 34) === null);

ok('없는 등급을 물으면 없음', route._pickQuad(REAL_FORECAST_NODE.details.windRadii, 64) === null);

ok('폭풍 종류 → 강도: TD=0 · TS=1 · STS=2 · TY=3 · STY=5',
    route._gradeOfStormType('TD') === 0 && route._gradeOfStormType('TS') === 1 &&
    route._gradeOfStormType('STS') === 2 && route._gradeOfStormType('TY') === 3 &&
    route._gradeOfStormType('STY') === 5);

// 'H' 는 운영 응답에서 실제로 확인한 코드다(Odalys·Polo, 2026-09-22).
ok('허리케인 코드 H 를 안다 — Polo 사고 때 표에 없던 바로 그 코드',
    route._gradeOfStormType('H') === 3 && route._gradeOfStormType('HU') === 3);

ok('★모르는 종류는 null — 0(열대저압부)으로 떨어뜨리지 않는다',
    route._gradeOfStormType('???') === null && route._gradeOfStormType(null) === null);

// 기상청 임계값 17/25/33/44/54 m/s 는 10분 평균 기준 — JTWC 1분 평균에 0.88 을 곱해 넣는다.
ok('★풍속으로 강도를 낸다 — 1분 평균을 10분 평균으로 환산(×0.88)',
    route._gradeOfWind(74) === 5 &&     // 65.1 → 초강력
    route._gradeOfWind(31) === 2 &&     // 27.3 → 중
    route._gradeOfWind(20) === 1 &&     // 17.6 → 약
    route._gradeOfWind(18) === 0,       // 15.8 → 열대저압부
    [74,31,20,18].map(route._gradeOfWind).join(','));

ok('환산 경계가 기상청 기준과 맞는다 (10분평균 17/25/33/44/54 m/s)',
    route._gradeOfWind(17 / 0.88) === 1 && route._gradeOfWind(25 / 0.88) === 2 &&
    route._gradeOfWind(33 / 0.88) === 3 && route._gradeOfWind(44 / 0.88) === 4 &&
    route._gradeOfWind(54 / 0.88) === 5);

ok('풍속이 없으면 null', route._gradeOfWind(null) === null && route._gradeOfWind('빠름') === null);

// UTC+10 로 오는 시각을 한국시각으로 옮긴다 (2026-09-23T04:00+10:00 = 9/23 03:00 KST)
ok('시각을 한국시각 문자열로 바꾼다 (UTC+10 04시 → KST 03시)',
    route._toKstStamp(Date.parse('2026-09-23T04:00:00+10:00')) === '202609230300',
    route._toKstStamp(Date.parse('2026-09-23T04:00:00+10:00')));

// ── [2] 없는 값을 지어내지 않는가 ──────────────────────────────────────────
console.log('\n[2] 없는 값 — 중심기압과 70% 확률반경');

const frame = route._toFrame(REAL_FORECAST_NODE, false);
ok('프레임을 만들어 낸다', !!frame);
ok('위치가 그대로 들어간다', frame.lat === 40.9 && frame.lon === 157.5);
ok('시점 풍속 26m/s · 돌풍 33m/s 가 들어간다', frame.windMs === 26 && frame.gustMs === 33);
ok('이동 방향·속도가 들어간다', frame.dir === 'ENE' && frame.speedKmh === 65);
ok('강풍반경(34노트)이 장·단반경으로 들어간다',
    frame.radStrong === 370 && frame.radStrongS === 167 && frame.radStrongD === 'NE');
ok('원본 네 방향 값도 함께 실려 온다(나중에 정확히 그릴 때 쓴다)',
    frame.radQuad34 && frame.radQuad34.sw === 370 && frame.radQuad50 && frame.radQuad50.nw === 0);

ok('강도는 풍속 26m/s 를 환산해서 낸다 (26x0.88=22.9 → 약=1)',
    frame.grade === 1, String(frame.grade));
ok('원본 폭풍 종류 코드도 함께 실어 보낸다 — 등급이 이상할 때 보이게',
    frame.stormType === 'TS', frame.stormType);

// 실제로 이 사고가 났다: 허리케인 Polo(920hPa · 1분평균 74m/s)가 등급 0(열대저압부)으로 나왔다.
// 폭풍 종류 코드를 우리가 모르면 0으로 떨어뜨렸기 때문이다. 이제는 풍속이 이긴다.
const strong = route._toFrame({
    timestamp: Math.floor(Date.parse('2026-09-23T04:00:00+10:00') / 1000),
    loc: { lat: 15, long: -101.5 },
    details: { windSpeedMPS: 74, stormType: 'MH' }   // 'MH' 는 우리가 모르는 코드
}, true);
ok('★모르는 폭풍 종류라도 센 태풍이 열대저압부로 떨어지지 않는다 (74m/s → 초강력=5)',
    strong && strong.grade === 5, strong && String(strong.grade));

ok('★중심기압은 없으므로 null — 다른 값으로 채우지 않는다', frame.pressure === null);
ok('★70% 확률반경은 없으므로 null', frame.radProb === null);

ok('위경도가 없는 시점은 프레임을 만들지 않는다',
    route._toFrame({ details: {} }, false) === null && route._toFrame(null, false) === null);

// ── [3] 화면 배선 ──────────────────────────────────────────────────────────
console.log('\n[3] 화면 배선 — 출처 드롭다운과 표기');

ok('출처 드롭다운(#tphn-source)이 있다', /id="tphn-source"/.test(HTML_SRC));

['한국(기상청)', '미국(JTWC)', '일본(JMA/RSMC)', '유럽(ECMWF)', '중국(CMA)'].forEach(function (nm) {
    ok('드롭다운에 ' + nm + ' 가 있다', HTML_SRC.indexOf(nm) >= 0);
});

ok('아직 자료원이 없는 세 곳(일본·유럽·중국)은 잠겨 있다',
    /value="jma" disabled/.test(HTML_SRC) &&
    /value="ecmwf" disabled/.test(HTML_SRC) &&
    /value="cma" disabled/.test(HTML_SRC));

ok('드롭다운이 ⓘ 버튼 왼쪽에 있다',
    /id="tphn-source"[\s\S]{0,700}id="tphn-info-btn"/.test(HTML_SRC));

// 출처 전환은 아직 일반 사용자에게 열지 않는다 — 관리자 모드 기기에서만 보인다.
ok('★일반 사용자에게는 출처 드롭다운을 숨긴다',
    /getElementById\('tphn-source'\);\s*\n\s*if \(srcSel && !isAdmin\) srcSel\.style\.display = 'none';/.test(TYPHOON_SRC));

// var 는 함수 꼭대기로 끌어올려지므로, 선언이 사용처보다 아래에 있으면 값이 undefined 라
// 관리자에게도 숨겨진다. 그래서 읽는 자리가 쓰는 자리보다 앞인지 함께 고정한다.
ok('★관리자 여부를 읽는 자리가 드롭다운을 숨기는 자리보다 앞이다',
    TYPHOON_SRC.indexOf("isAdmin = localStorage.getItem('seagnal_admin_mode')")
        < TYPHOON_SRC.indexOf("if (srcSel && !isAdmin)"),
    '읽는 자리 ' + TYPHOON_SRC.indexOf("isAdmin = localStorage.getItem('seagnal_admin_mode')")
        + ' / 쓰는 자리 ' + TYPHOON_SRC.indexOf("if (srcSel && !isAdmin)"));

ok('디버그 줄도 같은 isAdmin 을 쓴다(선언이 하나만 남아 있다)',
    (TYPHOON_SRC.match(/var isAdmin = false;/g) || []).length === 1);

ok('출처를 바꾸면 setSource 가 돈다',
    /getElementById\('tphn-source'\)[\s\S]{0,200}setSource\(this\.value\)/.test(TYPHOON_SRC));
ok('해외 출처는 /api/typhoon/foreign 을 부른다', /\/api\/typhoon\/foreign\?src=/.test(TYPHOON_SRC));
ok('해외 출처에서는 연도 이동을 잠근다', /ySel\.disabled = \(src !== 'kma'\)/.test(TYPHOON_SRC));
ok('해외 출처에서는 70% 확률반경 체크박스를 잠근다',
    /probChk\.disabled = \(src !== 'kma'\)/.test(TYPHOON_SRC));
ok('어느 기관 자료인지 화면에 적는다(renderSourceNote)',
    /function renderSourceNote/.test(TYPHOON_SRC) && /tphn-source-note/.test(HTML_SRC));
ok('풍속 평균 시간 차이를 출처 표기에 적는다(1분 vs 10분)',
    /1분 평균[\s\S]{0,40}10분 평균/.test(TYPHOON_SRC));
ok('server.js 가 해외 태풍 라우터를 등록한다',
    /require\('\.\/routes\/typhoon_foreign'\)/.test(SERVER_SRC));

// ── [4] 게이트 등록 ────────────────────────────────────────────────────────
console.log('\n[4] 게이트 등록');
ok('verify_all.sh SUITES 에 test_typhoon_source 가 있다', /test_typhoon_source/.test(VERIFY_SRC));

// ── [5] 응답 만들기 — 상류 값이 왔을 때 화면에 뭘 내주나 ────────────────────
// fetch 를 가짜로 바꿔 끼워 핸들러를 직접 돌린다(네트워크 없음).
const handler = route.stack.find(l => l.route && l.route.path === '/api/typhoon/foreign')
    .route.stack[0].handle;

const UPSTREAM = {
    success: true, error: null,
    response: [{
        id: '2026-WP-24',
        profile: { name: 'Dujuan', year: 2026,
                   pressure: { minMB: 970 }, windSpeed: { maxKTS: 70, maxMPS: 36 } },
        position: {
            location: { type: 'Point', coordinates: [150.2, 39] },
            details: Object.assign({}, REAL_FORECAST_NODE.details, { advisoryNumber: '28' }),
            timestamp: 1790013600,
            loc: { long: 150.2, lat: 39 }
        },
        forecast: [REAL_FORECAST_NODE]
    }]
};

async function callRoute(query, upstream) {
    const realFetch = global.fetch;
    global.fetch = async () => ({ ok: true, status: 200, json: async () => upstream });
    let out = null;
    try {
        await handler({ query }, { set() {}, json(o) { out = o; } });
    } finally {
        global.fetch = realFetch;
    }
    return out;
}

(async () => {
    console.log('\n[5] 응답 만들기 — 상류 값이 왔을 때 화면에 뭘 내주나');

    const r = await callRoute({ src: 'jtwc' }, UPSTREAM);
    ok('성공 응답을 낸다', !!r && r.success === true, JSON.stringify(r && r.error || r));
    ok('활성 태풍이 있다고 알린다', !!r && r.hasActive === true);

    const t = r && r.typhoons && r.typhoons[0];
    ok('태풍 이름이 들어간다', !!t && t.name === 'Dujuan');
    ok('기상청 응답과 같은 모양이다(통보문 배열 안에 current/forecast)',
        !!t && Array.isArray(t.bulletins) && t.bulletins.length === 1 &&
        !!t.bulletins[0].current && Array.isArray(t.bulletins[0].forecast));
    ok('통보(자문) 라벨에 회차와 한국시각이 들어간다',
        !!t && /JTWC[\s\S]*제28호 자문[\s\S]*KST/.test(t.bulletins[0].label), t && t.bulletins[0].label);
    ok('현재 위치 프레임이 isCurrent 로 표시된다', !!t && t.bulletins[0].current.isCurrent === true);
    ok('안내문(rem)에 기관 차이가 적혀 있다',
        !!t && /1분 평균/.test(t.bulletins[0].rem) && /중심기압/.test(t.bulletins[0].rem));

    // 활성 태풍이 없을 때 — 상류가 success:false(warn_no_data)로 준다.
    // 30분 캐시가 앞 결과를 물고 오므로 비우고 부른다.
    route._clearCache();
    const empty = await callRoute({ src: 'jtwc' },
        { success: false, error: { code: 'warn_no_data' }, response: [] });
    ok('활성 태풍이 없으면 빈 목록으로 답한다(오류가 아니다)',
        !!empty && empty.success === true && empty.hasActive === false, JSON.stringify(empty));

    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail > 0 ? 1 : 0);
})();

