/**
 * test_typhoon_source.js — 태풍 탭 "자료 출처" 전환이 조용히 깨지지 않게 고정한다.
 *
 * [왜 있나] 기관마다 태풍을 다르게 기술한다. 기상청은 "장반경·단반경·단반경 방위 +
 *   중심기압 + 70% 확률반경", JTWC 는 "네 방향 거리 + 노트·해리 단위"이고 예보 시점의
 *   중심기압과 확률반경이 없다. 이 차이를 서버에서 우리 프레임 형식으로 옮기는데,
 *   옮기는 규칙이 틀려도 지도에는 그럴듯한 그림이 그려진다 — 눈으로는 안 걸린다.
 *   그래서 규칙을 여기서 못박는다.
 *
 * [2026-09-25 출처 전환] 중계 업체(Xweather)를 거치던 것을 JTWC 공개 통보문 직접
 *   읽기로 바꿨다. 그 업체 약관이 받은 자료를 내부 업무용으로만 쓰도록 제한하고
 *   제3자 배포를 금지하는데, 우리 앱은 일반에 공개돼 있어 쓸 수 없었다.
 *   JTWC 자료 자체는 미국 정부 저작물이라 저작권이 없다.
 *
 * [무엇을 고정하나]
 *   ① 통보문 해독 — 실제 원문(수리개 자문 8호)으로 위치·풍속·반경·시각을 전수 대조
 *   ② 단위 변환 — 해리→km, 노트→m/s, UTC→한국시각
 *   ③ 없는 값을 지어내지 않는가 — 예보 시점 기압·70%확률반경은 반드시 null
 *   ④ 목록 해독 — JTWC 화면에서 활동 중인 태풍을 뽑는가
 *   ⑤ 화면 배선 — 드롭다운·출처표기·이미지 버튼
 *   ⑥ 구글어스 파일(.kmz) 해독 — 위험구역·지나온 경로
 *   ⑦ 게이트 등록
 *
 * [실제 자료] fixtures/jtwc_wp2526web.txt — 2026-09-25 JTWC 가 실제로 낸 통보문.
 *   fixtures/jtwc_wp2526.kmz — 같은 시각의 구글어스 파일(원본에서 그림만 뺀 것).
 *   네트워크는 쓰지 않는다.
 *
 * [실행] node local_server/scripts/test_typhoon_source.js
 * [연계] ← scripts/refactor/verify_all.sh SUITES
 *        → local_server/services/jtwc_parse.js · services/jtwc_kmz.js · routes/typhoon_foreign.js
 *        → client/js/typhoon/ocean_typhoon.js · client/index2.html
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const P = require(path.join(ROOT, 'local_server', 'services', 'jtwc_parse.js'));
const KMZ = require(path.join(ROOT, 'local_server', 'services', 'jtwc_kmz.js'));
const route = require(path.join(ROOT, 'local_server', 'routes', 'typhoon_foreign.js'));

const WARN_TXT = fs.readFileSync(
    path.join(__dirname, 'fixtures', 'jtwc_wp2526web.txt'), 'utf8');
const KMZ_BUF = fs.readFileSync(path.join(__dirname, 'fixtures', 'jtwc_wp2526.kmz'));
const KMZ_SRC = fs.readFileSync(
    path.join(ROOT, 'local_server', 'services', 'jtwc_kmz.js'), 'utf8');
const PARSE_SRC = fs.readFileSync(
    path.join(ROOT, 'local_server', 'services', 'jtwc_parse.js'), 'utf8');
const ROUTE_SRC = fs.readFileSync(
    path.join(ROOT, 'local_server', 'routes', 'typhoon_foreign.js'), 'utf8');
const TYPHOON_SRC = fs.readFileSync(
    path.join(ROOT, 'client', 'js', 'typhoon', 'ocean_typhoon.js'), 'utf8');
const HTML_SRC = fs.readFileSync(path.join(ROOT, 'client', 'index2.html'), 'utf8');
const SERVER_SRC = fs.readFileSync(path.join(ROOT, 'local_server', 'server.js'), 'utf8');
const VERIFY_SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'refactor', 'verify_all.sh'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

// ── [1] 단위 변환 ──────────────────────────────────────────────────────────
console.log('\n[1] 단위 변환 — 해리·노트·UTC 를 우리 단위로');

ok('해리 → km (60NM = 111km · 70NM = 130km)',
    P._nmToKm(60) === 111 && P._nmToKm(70) === 130);
ok('노트 → m/s (40kt = 21m/s · 90kt = 46m/s)',
    P._ktToMs(40) === 21 && P._ktToMs(90) === 46);
ok('숫자가 아니면 null — 0 으로 뭉개지 않는다',
    P._nmToKm(null) === null && P._ktToMs('빠름') === null);

// 통보문에는 '일'까지만 있고 연·월이 없다. 발표 시각을 기준으로 채운다.
ok('UTC → 한국시각 (25일 00Z → 9/25 09시 KST)',
    P._toKstStamp('250000', 2026, 8, 25) === '202609250900',
    P._toKstStamp('250000', 2026, 8, 25));
ok('★달을 넘어가는 예보도 맞게 읽는다 (30일 발표 → 02일 예보는 다음 달)',
    P._toKstStamp('020000', 2026, 8, 30) === '202610020900',
    P._toKstStamp('020000', 2026, 8, 30));

ok('위경도 — 남위·서경은 음수로',
    JSON.stringify(P._parseLatLon('19.9N 130.7E')) === '{"lat":19.9,"lon":130.7}' &&
    JSON.stringify(P._parseLatLon('14.6S 155.8W')) === '{"lat":-14.6,"lon":-155.8}');

ok('방위(도) → 16방위 글자 (305도 = NW · 0도 = N)',
    P._degToDir(305) === 'NW' && P._degToDir(0) === 'N' && P._degToDir(360) === 'N');

// ── [2] 실제 통보문 해독 ───────────────────────────────────────────────────
console.log('\n[2] 실제 통보문 — 2026-09-25 수리개(25W) 자문 8호 전수 대조');

const W = P.parseWarning(WARN_TXT);
ok('통보문을 읽어 낸다', !!W);

ok('태풍 번호·이름·자문 회차를 읽는다 (25W · SURIGAE · 8호)',
    W.code === '25W' && W.name === 'SURIGAE' && W.advisory === '8',
    W && [W.code, W.name, W.advisory].join('/'));

ok('★번호를 제품 파일 이름으로 옮긴다 (25W + 2026 → wp2526)', W.seq === 'wp2526', W.seq);

// 원문: 250000Z --- NEAR 19.9N 130.7E / MAX SUSTAINED WINDS - 040 KT, GUSTS 050 KT
ok('현재 위치·시각을 읽는다 (9/25 09시 KST · 19.9N 130.7E)',
    W.current.time === '202609250900' && W.current.lat === 19.9 && W.current.lon === 130.7,
    [W.current.time, W.current.lat, W.current.lon].join('/'));
ok('현재 풍속·돌풍을 읽는다 (40kt→21m/s · 50kt→26m/s)',
    W.current.windMs === 21 && W.current.gustMs === 26);
// 원문: MOVEMENT PAST SIX HOURS - 305 DEGREES AT 11 KTS
ok('이동 방향·속도를 읽는다 (305도 NW · 11kt→20km/h)',
    W.current.dir === 'NW' && W.current.speedKmh === 20,
    [W.current.dir, W.current.speedKmh].join('/'));

// 원문: RADIUS OF 034 KT WINDS - 060/000/000/070 NM (NE/SE/SW/NW)
ok('★네 방향 풍속반경을 그대로 읽는다 (60/0/0/70 NM → 111/0/0/130 km)',
    JSON.stringify(W.current.radQuad34) === '{"ne":111,"se":0,"sw":0,"nw":130}',
    JSON.stringify(W.current.radQuad34));
ok('0 해리인 방향도 버리지 않는다(바람이 한쪽으로만 치우친 모양이 살아난다)',
    W.current.radQuad34.se === 0 && W.current.radQuad34.sw === 0);
ok('장·단반경도 함께 채운다 (가장 먼 130 / 가장 가까운 0, 방위 SE)',
    W.current.radStrong === 130 && W.current.radStrongS === 0 && W.current.radStrongD === 'SE');

ok('예보 시점을 모두 읽는다 (12·24·36·48·60·72·96·120시간 = 8개)',
    W.forecast.length === 8, String(W.forecast.length));

// 원문: 12 HRS 251200Z --- 20.9N 129.1E / 045 KT
ok('첫 예보 시점 (9/25 21시 KST · 20.9N 129.1E · 45kt→23m/s)',
    W.forecast[0].time === '202609252100' && W.forecast[0].lat === 20.9 &&
    W.forecast[0].lon === 129.1 && W.forecast[0].windMs === 23);
// 원문: 120 HRS 300000Z --- 29.6N 135.5E / 050 KT
ok('마지막 예보 시점 (9/30 09시 KST · 29.6N 135.5E · 50kt→26m/s)',
    W.forecast[7].time === '202609300900' && W.forecast[7].lat === 29.6 &&
    W.forecast[7].lon === 135.5 && W.forecast[7].windMs === 26);

// 원문 36HRS: RADIUS OF 064 KT WINDS - 020/020/010/020 NM
ok('★64노트(태풍급) 반경도 읽는다 — 중계 경로에는 없던 값',
    JSON.stringify(W.forecast[2].radQuad64) === '{"ne":37,"se":37,"sw":19,"nw":37}',
    JSON.stringify(W.forecast[2].radQuad64));
ok('64노트 반경이 안 나온 시점은 null (12시간·24시간)',
    W.forecast[0].radQuad64 === null && W.forecast[1].radQuad64 === null);

ok('시점마다 반경이 섞이지 않는다 (24시간은 34·50노트만, 64노트 없음)',
    W.forecast[1].radQuad50 !== null && W.forecast[1].radQuad64 === null);

// ── [3] 없는 값을 지어내지 않는가 ──────────────────────────────────────────
console.log('\n[3] 없는 값 — 예보 시점 기압과 70% 확률반경');

// 원문 REMARKS: MINIMUM CENTRAL PRESSURE AT 250000Z IS 1003 MB
ok('현재 중심기압은 REMARKS 에서 읽는다 (1003 hPa)', W.current.pressure === 1003,
    String(W.current.pressure));
ok('★예보 시점 중심기압은 모두 null — JTWC 가 발표하지 않는다',
    W.forecast.every(function (f) { return f.pressure === null; }));
ok('★70% 확률반경은 모두 null — JTWC 가 발표하지 않는다',
    W.current.radProb === null && W.forecast.every(function (f) { return f.radProb === null; }));
ok('★오차 원뿔 칸을 만들지 않는다 — 글자 통보문에 없다(예보도 그림에만 있다)',
    !/errorCone/.test(PARSE_SRC) && !/errorCone/.test(ROUTE_SRC) && !/errorCone/.test(TYPHOON_SRC));

ok('마지막 시점은 다음 시점 벡터가 없어 이동값이 비어 있다(지어내지 않는다)',
    W.forecast[7].dir === '' && W.forecast[7].speedKmh === null);

ok('읽을 수 없는 글은 null — 빈 통보문을 지어내지 않는다',
    P.parseWarning('') === null && P.parseWarning('아무 말') === null);

// ── [4] 강도 판정 ──────────────────────────────────────────────────────────
console.log('\n[4] 강도 — 1분 평균을 10분 평균으로 환산해 기상청 기준에 맞춘다');

ok('★환산 경계가 기상청 기준과 맞는다 (10분평균 17/25/33/44/54 m/s)',
    P._gradeOfWind(17 / 0.88) === 1 && P._gradeOfWind(25 / 0.88) === 2 &&
    P._gradeOfWind(33 / 0.88) === 3 && P._gradeOfWind(44 / 0.88) === 4 &&
    P._gradeOfWind(54 / 0.88) === 5);
ok('풍속이 없으면 null', P._gradeOfWind(null) === null && P._gradeOfWind('빠름') === null);

// 실제 통보문의 강도가 환산값과 맞는지 — 40kt=20.6m/s ×0.88=18.1 → 약(1)
ok('실제 통보문 현재 강도 = 약 (40kt)', W.current.grade === 1, String(W.current.grade));
// 90kt=46.3m/s ×0.88=40.7 → 강(3)
ok('실제 통보문 최성기 강도 = 강 (90kt)', W.forecast[5].grade === 3, String(W.forecast[5].grade));

ok('풍속이 없을 때만 종류 글자를 쓴다 (SUPER TYPHOON=5 · TROPICAL DEPRESSION=0)',
    P._gradeOfStormType('SUPER TYPHOON') === 5 &&
    P._gradeOfStormType('TROPICAL DEPRESSION') === 0 &&
    P._gradeOfStormType('TROPICAL STORM') === 1 &&
    P._gradeOfStormType('HURRICANE') === 3);
ok('모르는 종류는 null — 0(열대저압부)으로 떨어뜨리지 않는다',
    P._gradeOfStormType('???') === null && P._gradeOfStormType(null) === null);

// ── [5] 활동 중인 태풍 목록 ────────────────────────────────────────────────
console.log('\n[5] 목록 — 해역 기상정보에서 지금 활동 중인 태풍 뽑기');

// [왜 이 글인가 — 2026-09-25 운영 실측]
//   jtwc.html = 403 · products/ 폴더 목록 = 403 · products/ 안의 파일 = 200
//   그래서 활동 중인 태풍을 나열해 주는 '해역 기상정보' 파일을 읽는다.
const ABPW = fs.readFileSync(path.join(__dirname, 'fixtures', 'jtwc_abpwweb.txt'), 'utf8');
const ABIO = fs.readFileSync(path.join(__dirname, 'fixtures', 'jtwc_abioweb.txt'), 'utf8');

const WP_LIST = P.parseAdvisory(ABPW);
ok('★서태평양 기상정보에서 활동 중인 태풍을 뽑는다 (수리개 1개)',
    WP_LIST.length === 1 && WP_LIST[0].code === '25W' && WP_LIST[0].name === 'SURIGAE',
    JSON.stringify(WP_LIST));
ok('종류도 함께 읽는다', WP_LIST[0].stormType === 'TROPICAL STORM');

ok('★"NO OTHER TROPICAL CYCLONES" 를 태풍으로 세지 않는다', WP_LIST.length === 1);

const IO_LIST = P.parseAdvisory(ABIO);
ok('★태풍이 없는 해역은 빈 목록 (인도양 "SUMMARY: NONE.")',
    IO_LIST.length === 0, JSON.stringify(IO_LIST));
ok('끝난 태풍 안내문(REMOVED 01B INFORMATION)을 활동 중으로 세지 않는다',
    IO_LIST.length === 0);

ok('이름 없는 열대저압부도 번호로 읽는다',
    JSON.stringify(P.parseAdvisory('TROPICAL DEPRESSION 26W WAS LOCATED NEAR')) ===
    '[{"stormType":"TROPICAL DEPRESSION","code":"26W","name":"26W"}]');
ok('같은 태풍이 두 번 나와도 하나로 센다',
    P.parseAdvisory('TYPHOON 25W (SURIGAE) ... TYPHOON 25W (SURIGAE)').length === 1);
ok('빈 글이면 빈 목록', P.parseAdvisory('').length === 0 && P.parseAdvisory(null).length === 0);

// 해역 글자 → 파일 이름. W=북서태평양 E=동태평양 C=중태평양 A/B=인도양 S/P=남반구
ok('★해역별 파일 이름 (25W→wp2526 · 17E→ep1726 · 01B→io0126)',
    P.fileBase('25W', 2026) === 'wp2526' && P.fileBase('17E', 2026) === 'ep1726' &&
    P.fileBase('01B', 2026) === 'io0126');
ok('번호를 두 자리로 채운다 (6W → wp0626)', P.fileBase('6W', 2026) === 'wp0626');
ok('★형식이 안 맞으면 빈 값 — 경로조작을 막는다',
    P.fileBase('../etc', 2026) === '' && P.fileBase('', 2026) === '' &&
    P.fileBase('25Z', 2026) === '');

// ── [6] 화면 배선 ──────────────────────────────────────────────────────────
console.log('\n[6] 화면 배선 — 드롭다운·출처표기·버튼');

ok('출처 드롭다운(#tphn-source)이 있다', /id="tphn-source"/.test(HTML_SRC));
['한국(기상청)', '미국(JTWC)', '일본(JMA/RSMC)', '유럽(ECMWF)', '중국(CMA)'].forEach(function (nm) {
    ok('드롭다운에 ' + nm + ' 가 있다', HTML_SRC.indexOf(nm) >= 0);
});
ok('연결된 네 곳(한국·미국·일본·유럽)은 고를 수 있다',
    /<option value="kma">/.test(HTML_SRC) &&
    /<option value="jtwc">/.test(HTML_SRC) &&
    /<option value="jma">/.test(HTML_SRC) &&
    /<option value="ecmwf">/.test(HTML_SRC));
ok('아직 자료원이 없는 중국은 잠겨 있다', /value="cma" disabled/.test(HTML_SRC));
ok('드롭다운이 ⓘ 버튼 왼쪽에 있다',
    /id="tphn-source"[\s\S]{0,700}id="tphn-info-btn"/.test(HTML_SRC));
ok('출처 드롭다운을 모든 사용자에게 보여 준다(숨기는 코드가 없다)',
    !/srcSel && !isAdmin/.test(TYPHOON_SRC) &&
    !/tphn-source'\);[\s\S]{0,120}display = 'none'/.test(TYPHOON_SRC));
ok('임시 장치였던 5회 탭이 남아 있지 않다',
    !/SRC_TAP_THRESHOLD|_srcTapCount|_srcRevealed|handleSourceTap/.test(TYPHOON_SRC));
ok('기본 출처는 여전히 한국(기상청)이다', /_src = 'kma';/.test(TYPHOON_SRC));

// ★출처표기 — JTWC 는 미국 정부 공공저작물이다. 중계 업체를 안 거치므로 그 이름을 지운다.
ok('★출처표기에 "미국 합동태풍경보센터(JTWC)" 와 "공공저작물" 이 있다',
    /미국 합동태풍경보센터\(JTWC\)/.test(TYPHOON_SRC) && /공공저작물/.test(TYPHOON_SRC));
ok('★중계 업체 이름이 사용자 화면 문구에 남아 있지 않다',
    !/Xweather/i.test(TYPHOON_SRC.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')));

ok('해외 출처에서는 연도 이동을 잠근다', /ySel\.disabled = \(src !== 'kma'\)/.test(TYPHOON_SRC));
// 70%확률반경은 한국·일본이 발표하고, 위험구역 도형은 미국만 발표한다.
ok('★70%반경 체크박스는 그 값을 발표하는 기관(한국·일본)에서만 열린다',
    /var PROB_SOURCES = \['kma', 'jma'\];/.test(TYPHOON_SRC) &&
    /var hasProb = PROB_SOURCES\.indexOf\(_src\) >= 0;/.test(TYPHOON_SRC) &&
    /lockLayerChk\('tphn-ly-prob', hasProb,/.test(TYPHOON_SRC));
ok('★위험구역 체크박스는 그 도형을 발표하는 기관(미국)에서만 열린다',
    /var SWATH_SOURCES = \['jtwc'\];/.test(TYPHOON_SRC) &&
    /var hasSwath = SWATH_SOURCES\.indexOf\(_src\) >= 0;/.test(TYPHOON_SRC) &&
    /lockLayerChk\('tphn-ly-swath', hasSwath,/.test(TYPHOON_SRC));
ok('대신 볼 것은 그 기관에 실제로 있을 때만 권한다 (유럽은 둘 다 없다)',
    /\(hasSwath \? ' \(대신 "위험구역"을 보세요\)' : ''\)/.test(TYPHOON_SRC) &&
    /\(hasProb \? ' \(대신 "70%반경"을 보세요\)' : ''\)/.test(TYPHOON_SRC));
ok('왜 잠겼는지 알려 주고, 대신 무엇을 보면 되는지도 적는다',
    /70% 확률반경을 발표하지 않습니다/.test(TYPHOON_SRC) &&
    /34노트 위험구역 도형을 발표하지 않습니다/.test(TYPHOON_SRC));
ok('위험구역 체크박스(#tphn-ly-swath)가 화면에 있다', /id="tphn-ly-swath"/.test(HTML_SRC));
ok('위험구역 체크박스가 토글 목록에 연결돼 있다',
    /\['tphn-ly-swath', 'swath'\]/.test(TYPHOON_SRC));
ok('위험구역 레이어가 다른 반경들보다 아래에 깔린다(가장 넓어서)',
    /source: _swathSrc, zIndex: 114/.test(TYPHOON_SRC));
ok('출처·태풍을 바꿀 때 지우는 것을 잊지 않도록, 도형은 그때그때 찾아 쓴다',
    /function currentShapes\(\)[\s\S]{0,160}if \(_src === 'kma'\) return null;/.test(TYPHOON_SRC));
ok('지나온 경로는 있을 때만 그린다', /if \(shp && shp\.past && shp\.past\.length\) renderPastTrack/.test(TYPHOON_SRC));

ok('해외 기본 태풍도 기상청과 같은 규칙(제주 최근접)으로 고른다',
    /pickDefaultTyphoon\(_foreignData\.typhoons\)/.test(TYPHOON_SRC));
ok('해외 출처도 5분마다 갱신한다', /if \(_src !== 'kma'\) refreshForeign\(\);/.test(TYPHOON_SRC));
ok('갱신이 사용자가 고른 태풍을 건드리지 않는다(새 자문일 때만 다시 그린다)',
    /if \(!b0 \|\| b0\.code === _selCode\) return;/.test(TYPHOON_SRC));

ok('강풍·폭풍반경이 네 방향 원본값을 쓴다',
    /quad: 'radQuad34'/.test(TYPHOON_SRC) && /quad: 'radQuad50'/.test(TYPHOON_SRC));

// quadRadAt 은 바깥 것을 안 쓰는 순수 계산이라 그대로 꺼내 돌려 본다(브라우저 없이).
const QRA_SRC = (TYPHOON_SRC.match(/var QUADS = [\s\S]*?\n    \}/) || [''])[0];
const quadRadAt = new Function(QRA_SRC + '; return quadRadAt;')();
ok('사분면 중심 방위에서는 그 값 그대로',
    quadRadAt({ ne: 111, se: 0, sw: 0, nw: 130 }, 45) === 111 &&
    quadRadAt({ ne: 111, se: 0, sw: 0, nw: 130 }, 135) === 0 &&
    quadRadAt({ ne: 111, se: 0, sw: 0, nw: 130 }, 315) === 130);
// [2026-09-25] 예전에는 이웃 사분면을 S-커브로 이었다(북쪽 = 120.5). 그런데 JTWC 가
//   공개한 .kmz 의 반경 도형을 실제로 재어 보니 사분면마다 90°짜리 '일정한 호'였다.
//   그래서 계단으로 바꿨다 — 아래 [9]에서 원본 도형과 직접 대조한다.
ok('★사분면 안에서는 값이 변하지 않는다 (JTWC 가 그리는 모양 그대로)',
    quadRadAt({ ne: 111, se: 0, sw: 0, nw: 130 }, 1) === 111 &&
    quadRadAt({ ne: 111, se: 0, sw: 0, nw: 130 }, 89) === 111 &&
    quadRadAt({ ne: 111, se: 0, sw: 0, nw: 130 }, 271) === 130 &&
    quadRadAt({ ne: 111, se: 0, sw: 0, nw: 130 }, 359) === 130);
ok('★사분면 경계에서 값이 바뀐다 (정북 = 북동값, 정북 직전 = 북서값)',
    quadRadAt({ ne: 111, se: 0, sw: 0, nw: 130 }, 0) === 111 &&
    quadRadAt({ ne: 111, se: 0, sw: 0, nw: 130 }, 359.999) === 130);
ok('한 바퀴 돌아도 끊기지 않는다(0도와 360도가 같다)',
    quadRadAt({ ne: 100, se: 50, sw: 20, nw: 80 }, 0)
      === quadRadAt({ ne: 100, se: 50, sw: 20, nw: 80 }, 360));
ok('거리가 0인 사분면은 중심으로 접힌다 — 없는 범위를 부풀리지 않는다',
    quadRadAt({ ne: 111, se: 0, sw: 0, nw: 130 }, 180) === 0);
ok('사분면 경계를 점으로 정확히 찍는 링을 따로 쓴다(턱이 잘리지 않게)',
    /if \(quad\) return quadRing\(lon, lat, quad\);/.test(TYPHOON_SRC));

// quadRing 은 지도 라이브러리(ol) 한 줄만 쓴다 — 그 한 줄을 '그대로 돌려주기'로 바꿔 끼우면
//   브라우저 없이 실제 화면 코드를 돌려 볼 수 있다. 링이 어떤 모양으로 나오는지 직접 잰다.
const RING_SRC = (TYPHOON_SRC.match(/function destPoint[\s\S]*?\n    \}/) || [''])[0] +
                 (TYPHOON_SRC.match(/var QUADS = [\s\S]*?function quadRing[\s\S]*?\n    \}/) || [''])[0];
const quadRing = new Function(
    'var ol = { proj: { fromLonLat: function (c) { return c; } } };' +
    RING_SRC + '; return quadRing;')();
const RING = quadRing(130.7, 19.9, { ne: 111, se: 0, sw: 0, nw: 130 });
ok('사분면당 18칸 + 닫는 점 = 77점', RING.length === 77, String(RING.length));
ok('첫 점과 끝 점이 같다(도형이 닫힌다)',
    RING[0][0] === RING[76][0] && RING[0][1] === RING[76][1]);
ok('★북동 사분면은 111km 로 일정하다',
    RING.slice(0, 19).every(function (c) {
        return Math.abs(kmBetween(130.7, 19.9, c[0], c[1]) - 111) < 0.5;
    }));
ok('★거리 0인 남동·남서 사분면은 중심으로 접힌다',
    RING.slice(19, 57).every(function (c) {
        return kmBetween(130.7, 19.9, c[0], c[1]) < 0.01;
    }));
ok('★북서 사분면은 130km 로 일정하다',
    RING.slice(57, 76).every(function (c) {
        return Math.abs(kmBetween(130.7, 19.9, c[0], c[1]) - 130) < 0.5;
    }));
ok('네 방향 값이 없으면 기존 장·단반경 방식으로 돌아간다(기상청 프레임)',
    /return quad \? quadRadAt\(quad, brngDeg\) : radAt\(rLong, rShort, edDeg, brngDeg\);/.test(TYPHOON_SRC));

ok('그 태풍에 예보도가 있을 때만 이미지 버튼을 띄운다',
    /var t = foreignTyphoon\(_selSeq\);\s*\n\s*on = !!\(t && t\.imageName\);/.test(TYPHOON_SRC));
ok('해외에서는 해외 전용 주소를 부른다',
    /'\/api\/typhoon\/foreign\/image\?src=' \+ encodeURIComponent\(_src\)/.test(TYPHOON_SRC));

// ── [7] 서버 라우트 ────────────────────────────────────────────────────────
console.log('\n[7] 서버 — 어디서 받아 무엇을 내주나');

ok('★중계 업체가 아니라 JTWC 에서 직접 받는다',
    /metoc\.navy\.mil\/jtwc\//.test(ROUTE_SRC) && !/data\.api\.xweather\.com/.test(ROUTE_SRC));
ok('★인증키가 더 이상 필요 없다(공개 자료라서)',
    !/XWEATHER_CLIENT_ID|CLIENT_SECRET/.test(ROUTE_SRC));
ok('목록과 통보문을 모두 읽는다',
    /jtwc\.html/.test(ROUTE_SRC) && /web\.txt/.test(ROUTE_SRC));
ok('태풍마다 예보도 파일 이름을 채워 보낸다', /imageName: w\.seq \+ '\.gif'/.test(ROUTE_SRC));
ok('★그림 중계는 seq 형식을 검사한다 — 경로조작 차단',
    /\^\[a-z\]\{2\}\\d\{4\}\$/.test(ROUTE_SRC));
ok('출처 안내(other)에 공공저작물임을 적는다', /미국 정부 공공저작물/.test(ROUTE_SRC));

// [2026-09-25] 배포 직후 목록 받기가 실패했는데 응답이 'upstream' 한 마디뿐이라
//   원인을 알 수 없었다. 실패는 이유와 함께 드러나야 한다(L-291).
// [2026-09-25 운영 실측] 막힌 곳과 열린 곳
//   jtwc.html = 403 · products/ = 403 · products/<파일> = 200
ok('★활동 중인 태풍을 해역 기상정보 파일에서 읽는다 (막히지 않는 경로)',
    /products\/abpwweb\.txt/.test(ROUTE_SRC) && /products\/abioweb\.txt/.test(ROUTE_SRC));
ok('막혀서 못 쓰는 경로(jtwc.html · 폴더 목록)를 더는 부르지 않는다',
    !/fetchText\(LIST_URL\)|fetchText\(DIR_URL\)/.test(ROUTE_SRC) &&
    !/const (LIST|DIR)_URL/.test(ROUTE_SRC));
ok('어느 주소가 몇 번으로 답했는지 알려 준다', /probe: where/.test(ROUTE_SRC));
ok('둘 다 못 받으면 지어내지 않는다', /texts\.every\(t => t === null\)\) return null/.test(ROUTE_SRC));

ok('★발표 시각이 오래되면 끝난 태풍으로 본다 (18시간)',
    /FRESH_MS = 18 \* 3600 \* 1000/.test(ROUTE_SRC) &&
    /Date\.now\(\) - ms\) > FRESH_MS/.test(ROUTE_SRC));
ok('한국시각 문자열을 시각으로 되돌린다 (9/25 09시 KST = 9/25 00Z)',
    route._kstStampToMs('202609250900') === Date.parse('2026-09-25T00:00:00Z'));

ok('★상류 실패 시 이유(detail)를 함께 내려 준다',
    /reason: 'upstream', detail: lastError/.test(ROUTE_SRC));
ok('★목록이 비었을 때 "태풍 없음"과 "못 읽음"을 가를 단서를 남긴다',
    /listChars: chars/.test(ROUTE_SRC) && /활동 중 \$\{bases\.length\}개/.test(ROUTE_SRC));
ok('그림이 아니라 목록만 막히던 차이를 메우려 브라우저 표식을 보낸다',
    /'User-Agent': UA/.test(ROUTE_SRC) && /headers: REQ_HEADERS/.test(ROUTE_SRC));
ok('★구글어스 파일(.kmz)도 같이 받는다', /PRODUCT_BASE \+ base \+ '\.kmz'/.test(ROUTE_SRC));
ok('★.kmz 자문 회차가 통보문과 다르면 도형을 안 쓴다 (지난 예보를 새 예보 위에 그리지 않게)',
    /String\(k\.advisory\) !== String\(advisory\)/.test(ROUTE_SRC));
ok('★.kmz 를 못 받아도 태풍 자체는 계속 보여 준다',
    /swath: \(sh && sh\.swath\) \|\| null/.test(ROUTE_SRC) &&
    /past: \(sh && sh\.past && sh\.past\.length\) \? sh\.past : null/.test(ROUTE_SRC));
ok('.kmz 는 글자가 아니라 덩어리로 받는다(압축이 깨지지 않게)',
    /async function fetchBuffer/.test(ROUTE_SRC) && /arrayBuffer\(\)/.test(ROUTE_SRC));
ok('통보문을 읽은 태풍에 대해서만 .kmz 를 받는다(헛걸음 없이)',
    /w \? fetchShapes\(w\.seq, w\.advisory\) : Promise\.resolve\(null\)/.test(ROUTE_SRC));
ok('안내문이 위험구역이 무엇인지 설명한다',
    /34노트 위험구역/.test(ROUTE_SRC) && /예보가 빗나갈 가능성까지/.test(ROUTE_SRC));
ok('server.js 가 해외 태풍 라우터를 등록한다', /typhoon_foreign/.test(SERVER_SRC));

ok('통보문 라벨 시각 표기 (202609250900 → "09.25. 09:00")',
    route._stampToLabel('202609250900') === '09.25. 09:00', route._stampToLabel('202609250900'));
ok('시각이 모자라면 빈 값', route._stampToLabel('2026') === '');

// ── [8] 구글어스 파일(.kmz) — 위험구역·지나온 경로 ────────────────────────
console.log('\n[8] 구글어스 파일(.kmz) — 글자 통보문에 없는 두 가지');

ok('zip 에서 doc.kml 을 꺼낸다',
    (KMZ.unzipEntry(KMZ_BUF, 'doc.kml') || '').indexOf('<kml') >= 0);
ok('없는 이름이면 null — 빈 문자열로 뭉개지 않는다',
    KMZ.unzipEntry(KMZ_BUF, 'none.kml') === null);
ok('zip 이 아니면 null', KMZ.unzipEntry(Buffer.from('그냥 글'), 'doc.kml') === null &&
    KMZ.unzipEntry(null, 'doc.kml') === null);

const K = KMZ.parseKmz(KMZ_BUF);
ok('★자문 회차를 읽는다 (통보문과 같은 8호)',
    K && K.advisory === 8 && String(K.advisory) === W.advisory, K && String(K.advisory));
ok('★위험구역 도형을 꺼낸다 (점 1,032개)', K.swath && K.swath.length === 1032,
    K.swath && String(K.swath.length));
ok('좌표는 [경도, 위도] 순서다 (첫 점 135.84E 34.09N)',
    K.swath[0][0] === 135.84 && K.swath[0][1] === 34.09, JSON.stringify(K.swath[0]));
ok('좌표를 소수 셋째 자리까지만 싣는다 — 그 아래는 화면에서 안 보이는데 자료만 커진다',
    K.swath.every(function (c) {
        return Math.abs(c[0] * 1000 - Math.round(c[0] * 1000)) < 1e-6 &&
               Math.abs(c[1] * 1000 - Math.round(c[1] * 1000)) < 1e-6;
    }));

ok('★지나온 실제 경로 19개를 꺼낸다', K.past.length === 19, String(K.past.length));
ok('시각을 한국시각으로 바꾼다 (26092006Z → 9/20 15시 KST)',
    K.past[0].time === '202609201500', K.past[0].time);
ok('지나온 경로는 오래된 것부터 온다',
    K.past[0].time < K.past[18].time && K.past[18].time === '202609250300');
ok('세기도 같이 읽는다 (15노트 = 8m/s · 35노트 = 18m/s)',
    K.past[0].windMs === 8 && K.past[18].windMs === 18,
    K.past[0].windMs + '/' + K.past[18].windMs);
ok('지나온 경로의 강도도 10분 평균으로 환산해 매긴다 (18m/s × 0.88 = 15.8 → 열대저압부)',
    K.past[18].grade === 0);
ok('위치를 읽는다 (마지막 = 19.3N 131.7E)',
    K.past[18].lat === 19.3 && K.past[18].lon === 131.7);

// ★이 검사가 핵심이다 — "위험구역이 그냥 바람 반경을 이어 붙인 것 아니냐"를 직접 확인한다.
//   바람 반경만 다시 칠한 것이라면 새로 받을 이유가 없다. 실제로는 예보 오차가 들어 있어
//   훨씬 넓다. (2026-09-25 실측: 꼭짓점 1,032개 전부가 바람 반경 밖, 중앙값 205km 바깥)
const FRAMES_34 = [W.current].concat(W.forecast)
    .filter(function (f) { return f && f.radQuad34; });
function kmBetween(lon1, lat1, lon2, lat2) {
    const dx = (lon2 - lon1) * Math.cos((lat1 + lat2) / 2 * Math.PI / 180);
    return Math.hypot(dx, lat2 - lat1) * 111.32;
}
function bearingDeg(lon1, lat1, lon2, lat2) {
    const dx = (lon2 - lon1) * Math.cos((lat1 + lat2) / 2 * Math.PI / 180);
    return ((Math.atan2(dx, lat2 - lat1) * 180 / Math.PI) % 360 + 360) % 360;
}
function insideAnyRadius(c) {
    return FRAMES_34.some(function (f) {
        const d = kmBetween(f.lon, f.lat, c[0], c[1]);
        return d <= quadRadAt(f.radQuad34, bearingDeg(f.lon, f.lat, c[0], c[1]));
    });
}
const outside = K.swath.filter(function (c) { return !insideAnyRadius(c); }).length;
ok('★위험구역은 바람 반경을 이어 붙인 것이 아니다 — 꼭짓점 전부가 그 밖에 있다',
    outside === K.swath.length, outside + '/' + K.swath.length);

// 날짜변경선을 걸치는 도형은 지도에서 화면을 가로지르는 띠가 된다 — 싣지 않는다.
const DATELINE_KML = '<Placemark><name>34 knot Danger Swath</name><Polygon>' +
    '<coordinates>179.0,10.0,0 -179.0,11.0,0 -178.0,12.0,0 179.0,10.0,0</coordinates>' +
    '</Polygon></Placemark>';
ok('★날짜변경선을 걸치는 도형은 싣지 않는다 (지도가 가로로 뭉개진다)',
    KMZ.parseKml(DATELINE_KML).swath === null);
ok('Placemark 가 없으면 null', KMZ.parseKml('<kml></kml>') === null && KMZ.parseKml('') === null);
ok('도형이 없는 파일도 터지지 않는다 — 빈 결과를 준다',
    (function () {
        const r = KMZ.parseKml('<Placemark><name>JTWC Logo</name></Placemark>');
        return r && r.swath === null && r.past.length === 0 && r.advisory === null;
    })());
ok('★반경 도형은 가져오지 않는다 — 통보문 숫자로 같은 모양이 나오므로 두 번 받지 않는다',
    !/RADIUS OF/.test(KMZ_SRC.replace(/\/\*[\s\S]*?\*\//g, '')));

// ★위 한 줄("통보문 숫자로 같은 모양이 나온다")이 정말 맞는지 원본과 직접 대조한다.
//   틀리면 반경을 통째로 잘못 그리게 되므로, 말로 넘기지 않고 꼭짓점을 전부 재어 본다.
//   2026-09-25 결과: 3,547개 대조 · 최대 어긋남 0.65km (지도에서 보이지 않는 차이)
const DOC_KML = KMZ.unzipEntry(KMZ_BUF, 'doc.kml');
const ALL_FRAMES = [W.current].concat(W.forecast);
(function compareRadiusPolygons() {
    const blocks = DOC_KML.split('<Placemark').slice(1);
    let fi = -1, checked = 0, bad = 0, worst = 0;
    blocks.forEach(function (b) {
        const name = ((/<name>([\s\S]*?)<\/name>/.exec(b) || ['', ''])[1]).trim();
        if (/^\d{2}\/\d{2}Z/.test(name)) { fi++; return; }
        const m = /^RADIUS OF (\d+) KT WINDS$/.exec(name);
        if (!m || fi < 0) return;
        const f = ALL_FRAMES[fi];
        const q = f && f['radQuad' + m[1]];
        if (!q) return;
        const co = ((/<coordinates>([\s\S]*?)<\/coordinates>/.exec(b) || ['', ''])[1]).trim().split(/\s+/);
        co.forEach(function (tok) {
            const a = tok.split(',');
            const lon = +a[0], lat = +a[1];
            const d = kmBetween(f.lon, f.lat, lon, lat);
            if (d < 0.5) return;                                   // 거리 0 사분면 — 중심으로 접힌 점
            const bd = bearingDeg(f.lon, f.lat, lon, lat);
            if (Math.min(bd % 90, 90 - (bd % 90)) < 1) return;     // 사분면 경계 위의 점은 건너뛴다
            checked++;
            const err = Math.abs(d - quadRadAt(q, bd));
            if (err > worst) worst = err;
            if (err > 2) bad++;
        });
    });
    ok('★우리가 그리는 반경이 JTWC 원본 도형과 같다 (꼭짓점 3,000개 이상 전수 대조, 2km 이내)',
        checked > 3000 && bad === 0, checked + '개 중 ' + bad + '개 어긋남 · 최대 ' + worst.toFixed(2) + 'km');
})();

// ── [8-2] 서버가 실제로 내주는 응답 (네트워크 대신 실제 파일로) ──────────────
console.log('\n[8-2] 응답 한 판 — 실제 파일을 상류인 척 물려 끝까지 돌려 본다');

(function wholeResponse() {
    // 상류 호출만 실제 파일로 바꿔 끼운다. 나머지 경로는 운영과 똑같이 돈다.
    const FILES = {
        'abpwweb.txt': fs.readFileSync(path.join(__dirname, 'fixtures', 'jtwc_abpwweb.txt')),
        'abioweb.txt': fs.readFileSync(path.join(__dirname, 'fixtures', 'jtwc_abioweb.txt')),
        'wp2526web.txt': fs.readFileSync(path.join(__dirname, 'fixtures', 'jtwc_wp2526web.txt')),
        'wp2526.kmz': KMZ_BUF
    };
    const realFetch = global.fetch;
    const realLog = console.log;
    const realNow = Date.now;
    global.fetch = async function (url) {
        const b = FILES[String(url).split('/').pop()];
        if (!b) return { ok: false, status: 404, headers: new Map() };
        return { ok: true, status: 200, text: async () => b.toString('utf8'), arrayBuffer: async () => b };
    };
    // [시각 고정 — 2026-09-26] 라우트는 발표 18시간이 지난 통보문을 '끝난 태풍'으로 거른다.
    //   실제 시계를 쓰면 저장해 둔 25일 자료가 다음 날부터 걸러져 검사가 저절로 깨진다
    //   (실제로 26일에 깨졌다 — CLAUDE.md "시각 의존 테스트 금지"). 발표 직후 시각으로 고정한다.
    Date.now = function () { return Date.parse('2026-09-25T04:00:00Z'); };
    console.log = function () {};          // 라우트가 찍는 진행 기록은 여기선 가린다
    route._clearCache();
    const handler = route.stack.find(function (l) {
        return l.route && l.route.path === '/api/typhoon/foreign';
    }).route.stack[0].handle;
    let out = null;
    handler({ query: { src: 'jtwc' } }, { set: function () { return this; }, json: function (d) { out = d; } },
        function () {});
    return new Promise(function (done) {
        setTimeout(function () {
            global.fetch = realFetch;
            console.log = realLog;
            Date.now = realNow;
            route._clearCache();
            const t = out && out.typhoons && out.typhoons[0];
            ok('★응답이 성공으로 나온다', !!(out && out.success));
            ok('태풍 하나를 찾는다 (수리개)', !!(t && t.name === 'SURIGAE'), t && t.name);
            ok('★응답에 위험구역이 실린다 (1,032점)', !!(t && t.swath && t.swath.length === 1032),
                t && t.swath && String(t.swath.length));
            ok('★응답에 지나온 경로가 실린다 (19개)', !!(t && t.past && t.past.length === 19),
                t && t.past && String(t.past.length));
            ok('예보도 그림 이름도 그대로 실린다', !!(t && t.imageName === 'wp2526.gif'));
            ok('응답이 너무 커지지 않는다 (50KB 미만)',
                JSON.stringify(out).length < 50 * 1024,
                Math.round(JSON.stringify(out).length / 1024) + 'KB');
            done();
        }, 300);
    });
})().then(function () {

// ── [9] 게이트 등록 ────────────────────────────────────────────────────────
console.log('\n[9] 게이트 등록');
ok('verify_all.sh SUITES 에 test_typhoon_source 가 있다',
    /test_typhoon_source/.test(VERIFY_SRC));

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
// 위 응답 검사에서 예외가 나면 그대로 조용히 끝나 버린다 — 실패로 드러나게 한다(L-291).
}).catch(function (e) {
    console.log('  ❌ 응답 검사 도중 예외 — ' + e.message);
    process.exit(1);
});
