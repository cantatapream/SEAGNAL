/**
 * test_typhoon_jma.js — 태풍 탭의 "일본(JMA)" 출처가 조용히 깨지지 않게 고정한다.
 *
 * [왜 따로 있나] 미국(JTWC)과 일본은 발표 방식이 아예 다르다. 미국은 글자 통보문에
 *   네 방향 거리·노트·1분 평균 풍속을 주고, 일본은 JSON 에 장·단반경·m/s·10분 평균을
 *   준다. 한 파일에 섞으면 어느 규칙이 어느 기관 것인지 흐려진다.
 *
 * [일본이 미국과 다른 점 — 이 검사가 지키는 것]
 *   ① 70% 확률반경(예보원)이 있다 — 미국에는 없어 화면에서 잠갔던 값이다.
 *   ② 예상 시점의 중심기압도 있다 — 미국은 현재 위치만 줬다.
 *   ③ 풍속이 10분 평균이라 **환산하면 안 된다** — 미국 규칙(×0.88)이 새어들면 강도가
 *      한 단계씩 낮게 나온다. 눈으로는 안 걸리므로 여기서 못박는다.
 *   ④ 강풍역은 현재 시점에만, 폭풍역은 예보 시점에만 온다 — 없는 시점을 채우지 않는다.
 *   ⑤ 위험구역 도형·예보도 그림은 없다 — 만들지 않는다.
 *
 * [실제 자료] fixtures/jma_targetTc.json · jma_specifications.json · jma_forecast.json
 *   2026-09-25 21:50 발표(KST), 태풍 26호 스리게(SURIGAE). 네트워크는 쓰지 않는다.
 *
 * [실행] node local_server/scripts/test_typhoon_jma.js
 * [연계] ← scripts/refactor/verify_all.sh SUITES
 *        → local_server/services/jma_parse.js · routes/typhoon_foreign.js
 *        → client/js/typhoon/ocean_typhoon.js · client/index2.html
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const J = require(path.join(ROOT, 'local_server', 'services', 'jma_parse.js'));
const route = require(path.join(ROOT, 'local_server', 'routes', 'typhoon_foreign.js'));

const FIX = (n) => path.join(__dirname, 'fixtures', n);
const TARGET_RAW = fs.readFileSync(FIX('jma_targetTc.json'), 'utf8');
const SPEC_RAW = fs.readFileSync(FIX('jma_specifications.json'), 'utf8');
const FC_RAW = fs.readFileSync(FIX('jma_forecast.json'), 'utf8');

const PARSE_SRC = fs.readFileSync(path.join(ROOT, 'local_server', 'services', 'jma_parse.js'), 'utf8');
const ROUTE_SRC = fs.readFileSync(path.join(ROOT, 'local_server', 'routes', 'typhoon_foreign.js'), 'utf8');
const TYPHOON_SRC = fs.readFileSync(path.join(ROOT, 'client', 'js', 'typhoon', 'ocean_typhoon.js'), 'utf8');
const HTML_SRC = fs.readFileSync(path.join(ROOT, 'client', 'index2.html'), 'utf8');
const VERIFY_SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'refactor', 'verify_all.sh'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

const S = J.parseSpecifications(JSON.parse(SPEC_RAW));
const CUR = S.frames.find(f => f.isCurrent);
const FC = S.frames.filter(f => !f.isCurrent);

// ── [1] 시각 ──────────────────────────────────────────────────────────────
console.log('\n[1] 시각 — 일본 시각을 우리 시각으로');

// 일본(JST)과 한국(KST)은 둘 다 UTC+9 라 벽시계가 같다 — 그래서 숫자만 뽑으면 된다.
ok('일본 시각 → 한국시각 문자열 (21:00 JST = 21:00 KST)',
    J._toKstStamp('2026-09-25T21:00:00+09:00') === '202609252100');
ok('자정을 넘겨도 날짜가 그대로 따라온다',
    J._toKstStamp('2026-10-01T00:00:00+09:00') === '202610010000');
ok('못 읽으면 null — 빈 문자열로 뭉개지 않는다',
    J._toKstStamp('어제') === null && J._toKstStamp('') === null && J._toKstStamp(null) === null);

// ── [2] 실제 자료 전수 대조 ────────────────────────────────────────────────
console.log('\n[2] 실제 자료 대조 — 2026-09-25 21:50 발표, 태풍 26호 스리게');

ok('태풍 번호·이름·발표시각을 읽는다',
    S.number === '2626' && S.name === 'SURIGAE' && S.issuedKst === '202609252150',
    S.number + '/' + S.name + '/' + S.issuedKst);
ok('시점 7개(현재 1 + 예보 6)를 읽는다',
    S.frames.length === 7 && FC.length === 6, String(S.frames.length));
ok('시각 오름차순으로 정렬한다',
    S.frames.every((f, i) => i === 0 || S.frames[i - 1].time <= f.time));

ok('★현재 위치 (21.3N 127.9E · 998hPa · 23m/s · 돌풍 35m/s)',
    CUR.lat === 21.3 && CUR.lon === 127.9 && CUR.pressure === 998 &&
    CUR.windMs === 23 && CUR.gustMs === 35,
    JSON.stringify([CUR.lat, CUR.lon, CUR.pressure, CUR.windMs, CUR.gustMs]));
ok('현재 시각 202609252100 · 진행 북서 · 25km/h',
    CUR.time === '202609252100' && CUR.dir === 'NW' && CUR.speedKmh === 25);
ok('풍속을 km/h 로도 채운다 (23m/s = 83km/h)', CUR.windKmh === 83, String(CUR.windKmh));

const F12 = FC[0], F120 = FC[FC.length - 1];
ok('★12시간 뒤 (22.0N 127.2E · 996hPa · 25m/s · 70%반경 75km)',
    F12.time === '202609260900' && F12.lat === 22 && F12.lon === 127.2 &&
    F12.pressure === 996 && F12.windMs === 25 && F12.radProb === 75,
    JSON.stringify([F12.time, F12.lat, F12.lon, F12.pressure, F12.windMs, F12.radProb]));
ok('★120시간 뒤 (29.7N 134.2E · 970hPa · 35m/s · 70%반경 460km · 폭풍역 560km)',
    F120.time === '202609302100' && F120.lat === 29.7 && F120.lon === 134.2 &&
    F120.pressure === 970 && F120.windMs === 35 && F120.radProb === 460 && F120.radStorm === 560,
    JSON.stringify([F120.time, F120.pressure, F120.windMs, F120.radProb, F120.radStorm]));

// ── [3] 없는 값을 지어내지 않는가 ──────────────────────────────────────────
console.log('\n[3] 없는 값 — 비어 있어야 할 자리');

ok('★예상 시점의 중심기압이 전부 있다 (미국에는 없던 값)',
    FC.every(f => typeof f.pressure === 'number'),
    FC.map(f => f.pressure).join(','));
ok('★예보 시점마다 70% 확률반경이 있다 (미국에는 없던 값)',
    FC.every(f => typeof f.radProb === 'number'),
    FC.map(f => f.radProb).join(','));
ok('현재 위치에는 70% 확률반경이 없다 — 기상청도 그렇다',
    CUR.radProb === null);
ok('★강풍역은 현재 시점에만 온다 — 예보 시점을 채우지 않는다',
    CUR.radStrong === 280 && FC.every(f => f.radStrong === null));
ok('★폭풍역은 현재 시점에 없다 — 일본이 그때는 발표하지 않는다',
    CUR.radStorm === null);
ok('12시간 뒤에는 폭풍역도 없다 — 그 시점만 비어 있는 것을 그대로 옮긴다',
    F12.radStorm === null);
ok('24시간 뒤부터 폭풍역이 나온다 (160km)',
    FC[1].radStorm === 160, String(FC[1].radStorm));
ok('네 방향 값(미국 전용)은 전부 비운다',
    S.frames.every(f => f.radQuad34 === null && f.radQuad50 === null && f.radQuad64 === null));
ok('★이동 속력이 말("ゆっくり")로 오면 숫자를 지어내지 않는다',
    F12.speedKmh === null, String(F12.speedKmh));
ok('숫자로 온 속력은 그대로 읽는다 (120시간 뒤 10km/h)',
    F120.speedKmh === 10, String(F120.speedKmh));
ok('크기 등급이 "-" 면 표시하지 않는다', S.frames.every(f => f.size === ''));

// ── [4] 강풍역·폭풍역 — 방향이 붙은 반경 ───────────────────────────────────
console.log('\n[4] 강풍역·폭풍역 — 짧은 쪽 방향까지');

ok('★현재 강풍역 북 280km / 남 165km → 장반경 280 · 단반경 165 · 단반경 방위 S',
    CUR.radStrong === 280 && CUR.radStrongS === 165 && CUR.radStrongD === 'S',
    [CUR.radStrong, CUR.radStrongS, CUR.radStrongD].join('/'));
ok('"全域" 하나면 방향 없는 원이 된다',
    JSON.stringify(J._warningToAsym([{ area: { jp: '全域', en: 'All' }, range: { km: 160 } }]))
      === '{"long":160,"short":160,"dir":""}');
ok('방향 칸이 글자로 와도 객체로 와도 읽는다',
    J._areaJp('北') === '北' && J._areaJp({ jp: '南', en: 'South' }) === '南' && J._areaJp(null) === '');
ok('16방위를 모두 읽는다 (북북동·동남동·서북서)',
    J._warningToAsym([{ area: '北', range: { km: 300 } }, { area: '北北東', range: { km: 100 } }]).dir === 'NNE' &&
    J._warningToAsym([{ area: '北', range: { km: 300 } }, { area: '東南東', range: { km: 100 } }]).dir === 'ESE' &&
    J._warningToAsym([{ area: '北', range: { km: 300 } }, { area: '西北西', range: { km: 100 } }]).dir === 'WNW');
ok('모르는 방향이면 방위를 비운다 — 엉뚱한 쪽으로 그리지 않는다',
    J._warningToAsym([{ area: '北', range: { km: 300 } }, { area: '???', range: { km: 100 } }]).dir === '');
ok('반경이 없거나 0이면 아예 없는 것으로 본다',
    J._warningToAsym([]) === null && J._warningToAsym(null) === null &&
    J._warningToAsym([{ area: '北', range: { km: 0 } }]) === null);

// ── [5] 강도 — 환산하면 안 된다 ────────────────────────────────────────────
console.log('\n[5] 강도 — 일본은 10분 평균이라 환산하지 않는다');

ok('기상청 기준 그대로 (17/25/33/44/54 m/s)',
    J._gradeOfWind(16) === 0 && J._gradeOfWind(17) === 1 && J._gradeOfWind(25) === 2 &&
    J._gradeOfWind(33) === 3 && J._gradeOfWind(44) === 4 && J._gradeOfWind(54) === 5);
// ★미국 규칙(1분 평균 → ×0.88)이 새어들면 17m/s 가 15m/s 로 깎여 열대저압부(0)가 된다.
ok('★미국의 환산계수(0.88)가 섞여 들지 않았다',
    J._gradeOfWind(17) === 1 && !/0\.88/.test(PARSE_SRC));
ok('숫자가 아니면 null', J._gradeOfWind(null) === null && J._gradeOfWind('강함') === null);
ok('실제 자료의 강도 (23→약 · 25·30→중 · 40·35→강)',
    CUR.grade === 1 && FC[0].grade === 2 && FC[1].grade === 2 &&
    FC[2].grade === 3 && F120.grade === 3,
    S.frames.map(f => f.grade).join(','));

// ── [6] 목록·지나온 경로 ───────────────────────────────────────────────────
console.log('\n[6] 목록과 지나온 경로');

const T = J.parseTargetList(JSON.parse(TARGET_RAW));
ok('목록에서 태풍 하나를 읽는다 (TC2632 / 26호 / TS)',
    T.length === 1 && T[0].id === 'TC2632' && T[0].number === '2626' && T[0].category === 'TS',
    JSON.stringify(T));
ok('태풍이 없으면 빈 목록', J.parseTargetList([]).length === 0 && J.parseTargetList(null).length === 0);
// id 는 뒤에서 주소를 만드는 데 쓰인다 — 형식이 안 맞으면 버린다.
ok('★형식이 안 맞는 식별자는 버린다 — 경로조작을 막는다',
    J.parseTargetList([{ tropicalCyclone: '../../etc' }, { tropicalCyclone: 'TC26' },
                       { tropicalCyclone: '' }, { tropicalCyclone: 'TC2632' }]).length === 1);

const TR = J.parseTrack(JSON.parse(FC_RAW));
ok('★지나온 경로 25개 지점을 읽는다', TR.length === 25, String(TR.length));
ok('오래된 것부터, 마지막이 지금 위치와 같다',
    TR[0].lat === 14.3 && TR[0].lon === 140.7 &&
    TR[24].lat === CUR.lat && TR[24].lon === CUR.lon,
    JSON.stringify([TR[0], TR[24]]));
// 태풍 되기 전(9점) + 된 뒤(17점) = 26점이지만 이음새가 겹쳐 있어 25점이 맞다.
ok('★이어붙일 때 겹치는 지점을 한 번만 남긴다',
    JSON.parse(FC_RAW).find(p => p.track).track.preTyphoon.length +
    JSON.parse(FC_RAW).find(p => p.track).track.typhoon.length === TR.length + 1);
ok('경로가 없어도 터지지 않는다', J.parseTrack([]).length === 0 && J.parseTrack(null).length === 0);
ok('일본은 지나온 경로에 시각·세기를 주지 않는다 — 위치만 싣는다',
    TR.every(p => Object.keys(p).join(',') === 'lat,lon'));

// ── [7] 화면 배선 ──────────────────────────────────────────────────────────
console.log('\n[7] 화면 배선');

ok('출처 드롭다운에서 일본을 고를 수 있다 (잠금이 풀렸다)',
    /<option value="jma">일본\(JMA\/RSMC\)<\/option>/.test(HTML_SRC));
ok('출처 목록(SOURCES)에 일본이 있다', /jma:\s*\{ label: '일본\(JMA\/RSMC\)'/.test(TYPHOON_SRC));
// [출처표기] 일본 기상청 자료는 출처를 적고, 가공했으면 가공했다고 밝혀야 한다.
ok('★출처표기에 "일본 기상청"·주소·"가공" 이 모두 있다',
    /일본 기상청 홈페이지\(www\.jma\.go\.jp\)/.test(TYPHOON_SRC) && /가공해 작성/.test(TYPHOON_SRC));
ok('★70%반경 체크박스가 일본에서도 열린다',
    /var PROB_SOURCES = \['kma', 'jma'\];/.test(TYPHOON_SRC));
ok('★위험구역 체크박스는 일본에서 잠긴다 (그 도형이 없다)',
    /var SWATH_SOURCES = \['jtwc'\];/.test(TYPHOON_SRC));

// ── [8] 서버 ───────────────────────────────────────────────────────────────
console.log('\n[8] 서버 — 어디서 받아 무엇을 내주나');

ok('일본 기상청에서 직접 받는다', /www\.jma\.go\.jp\/bosai\/typhoon\/data\//.test(ROUTE_SRC));
ok('출처 두 곳(미국·일본)을 받는다', /const SOURCES = \['jtwc', 'jma'\];/.test(ROUTE_SRC));
ok('출처마다 캐시를 따로 둔다 — 서로 덮어쓰지 않게',
    /cache\.jtwc = \{/.test(ROUTE_SRC) && /cache\.jma = \{/.test(ROUTE_SRC));
ok('일본은 캐시를 미국(30분)보다 짧게 둔다 (15분) — 새 발표를 늦게 보이지 않게',
    /JMA_TTL_MS = 15 \* 60 \* 1000/.test(ROUTE_SRC));
ok('목록을 못 받으면 지어내지 않는다', /if \(list === null\) return null;/.test(ROUTE_SRC));
ok('태풍 하나를 못 읽어도 나머지는 보여 준다', /본문 해독 실패 — 제외/.test(ROUTE_SRC));
ok('출처표기(other)에 출처와 가공 사실을 적는다',
    /출처: 일본 기상청 홈페이지/.test(ROUTE_SRC) && /가공해 작성/.test(ROUTE_SRC));
ok('일본에는 위험구역 도형이 없다고 분명히 적는다', /swath: null/.test(ROUTE_SRC));

// ── [8-2] 응답 한 판 ───────────────────────────────────────────────────────
console.log('\n[8-2] 응답 한 판 — 실제 파일을 상류인 척 물려 끝까지 돌려 본다');

(function wholeResponse() {
    const FILES = {
        'targetTc.json': TARGET_RAW,
        'specifications.json': SPEC_RAW,
        'forecast.json': FC_RAW
    };
    const realFetch = global.fetch;
    const realLog = console.log;
    global.fetch = async function (url) {
        const b = FILES[String(url).split('/').pop()];
        if (!b) return { ok: false, status: 404, headers: new Map() };
        return { ok: true, status: 200, text: async () => b };
    };
    console.log = function () {};
    route._clearCache();
    const handler = route.stack.find(function (l) {
        return l.route && l.route.path === '/api/typhoon/foreign';
    }).route.stack[0].handle;
    let out = null;
    handler({ query: { src: 'jma' } }, { set: function () { return this; }, json: function (d) { out = d; } },
        function () {});
    return new Promise(function (done) {
        setTimeout(function () {
            global.fetch = realFetch;
            console.log = realLog;
            route._clearCache();
            const t = out && out.typhoons && out.typhoons[0];
            const b = t && t.bulletins && t.bulletins[0];
            ok('★응답이 성공으로 나온다', !!(out && out.success && out.src === 'jma'));
            ok('태풍 하나를 찾는다 (SURIGAE)', !!(t && t.name === 'SURIGAE'), t && t.name);
            ok('통보문 라벨에 태풍 번호와 기준시각이 들어간다',
                !!(b && b.label === '[ JMA ] 제26호 태풍 / 09.25. 21:00 기준(KST)'), b && b.label);
            ok('★응답에 지나온 경로가 실린다 (25점)',
                !!(t && t.past && t.past.length === 25), t && t.past && String(t.past.length));
            ok('★위험구역은 없다고 명시해 보낸다', !!(t && t.swath === null));
            ok('★예보도 그림 이름이 없어 지도 버튼이 뜨지 않는다', !!(t && !t.imageName));
            ok('현재·예보 프레임이 나뉘어 실린다',
                !!(b && b.current && b.current.isCurrent === true && b.forecast.length === 6));
            ok('응답이 작다 (20KB 미만)',
                JSON.stringify(out).length < 20 * 1024,
                Math.round(JSON.stringify(out).length / 1024) + 'KB');
            done();
        }, 300);
    });
})().then(function () {

// ── [9] 게이트 등록 ────────────────────────────────────────────────────────
console.log('\n[9] 게이트 등록');
ok('verify_all.sh SUITES 에 test_typhoon_jma 가 있다', /test_typhoon_jma/.test(VERIFY_SRC));

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
}).catch(function (e) {
    console.log('  ❌ 응답 검사 도중 예외 — ' + e.message);
    process.exit(1);
});
