/**
 * test_guide_tabs.js — 「안내」 팝업이 화면·데이터와 어긋나지 않게 고정한다.
 *
 * [왜 있나] 2026-09-09 사용자 지적으로 안내가 화면과 크게 어긋나 있던 것이 드러났다.
 *   ① 화면에 **없는 버튼**을 설명하는 탭이 7개 있었다 — 주요지명·내 위치(버튼 자체가 제거됨),
 *      물빠짐·CCTV·노출암간출암(해양안전 전용으로 옮겨져 해양종합정보에서는 숨김),
 *      특보 ON/OFF(별도 버튼이 아니라 특보구역에 딸린 곁가지), 시정(천기 팝아웃의 한 항목).
 *   ② 화면에 **있는 버튼**인데 탭이 없던 것도 있었다 — 천기.
 *   ③ 탭 이름이 옛 이름이었다 — "해구도"(→해구기상), "부이"(→기상부이), "노출암·간출암"(→위험지형).
 *   ④ **본문 숫자가 데이터와 달랐다** — 조석 탭의 "표준항 166곳"은 실제 165곳이고,
 *      애초에 표준항 보간은 동해 북부에서만 쓰는데 전 해역 설명처럼 적혀 있었다.
 *   안내는 코드가 아니라 글이라 아무 검사도 걸려 있지 않았고, 그래서 기능이 바뀔 때마다
 *   조용히 낡았다. 이 스위트가 **탭 목록·순서·이름**과 **본문에 적힌 숫자**를 데이터와 맞대어 본다.
 *
 * [무엇을 고정하나] ①두 안내의 탭 id·라벨·순서 ②없어진 탭이 되살아나지 않는가
 *   ③본문 숫자가 실제 데이터 파일·상수와 같은가 ④출처 줄이 붙어 있는가.
 *   문구 자체(표현)는 고정하지 않는다 — 바뀔 수 있고, 바뀌어도 틀린 게 아니다.
 *
 * [실행] node local_server/scripts/test_guide_tabs.js
 * [연계] ← scripts/refactor/verify_all.sh SUITES
 *        → client/js/ocean-map/cctv/ocean_cctv.js (해양종합정보 안내 12탭)
 *        → client/js/marine-life/safety/life_safety.js (해양안전 안내 8탭)
 *        → client/index2.html (화면 버튼 존재 여부)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const CLIENT = path.join(ROOT, 'client');
const OCEAN_SRC = fs.readFileSync(path.join(CLIENT, 'js', 'ocean-map', 'cctv', 'ocean_cctv.js'), 'utf8');
const SAFETY_SRC = fs.readFileSync(path.join(CLIENT, 'js', 'marine-life', 'safety', 'life_safety.js'), 'utf8');
const INDEX_SRC = fs.readFileSync(path.join(CLIENT, 'index2.html'), 'utf8');
const TIDE_ROUTE = fs.readFileSync(path.join(ROOT, 'local_server', 'routes', 'tide.js'), 'utf8');
const VERIFY_SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'refactor', 'verify_all.sh'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

/** 소스에서 배열 리터럴을 떼어 실제로 평가한다(문자열 정규식보다 정확하다). */
function evalArray(src, marker, endMarker) {
    const i = src.indexOf(marker);
    if (i < 0) return null;
    const body = src.slice(i + marker.length);
    const end = body.indexOf(endMarker);
    if (end < 0) return null;
    const sb = {};
    vm.createContext(sb);
    vm.runInContext('this.__x = ' + body.slice(0, end + endMarker.length) + ';', sb);
    return sb.__x;
}

const oceanTabs = evalArray(OCEAN_SRC, 'var INFO_TAB_ITEMS = ', '\n    ];');
const safetySeg = SAFETY_SRC.slice(SAFETY_SRC.indexOf('function _buildSafetyInfoHtml'),
    SAFETY_SRC.indexOf('var tabsHtml', SAFETY_SRC.indexOf('function _buildSafetyInfoHtml')));
const safetyTabs = evalArray(safetySeg, 'var items = ', '\n        ];');

// 탭 본문 전체(숫자 검사에 쓴다)
const oceanText = (oceanTabs || []).map(t => (t.bodyHtml || t.body || '') + (t.src || '')).join('\n');
const safetyText = (safetyTabs || []).map(t => t.html || '').join('\n');

// ── [1] 해양종합정보 안내 ─────────────────────────────────────────────────
console.log('\n[1] 해양종합정보 안내 — 탭이 곧 그 화면의 버튼인가');

const OCEAN_EXPECT = [
    ['basemap', '지도 종류'], ['search', '위치 검색'], ['northup', '진북 정렬'],
    ['wind', '풍향·풍속'], ['current', '유향·유속'], ['wave', '파고·파향'],
    ['buoy', '기상부이'], ['seagrid', '해구기상'], ['warnzone', '특보구역'],
    ['otherwx', '천기'], ['depth', '수심'], ['tide', '조석']
];
ok('탭을 읽어 낼 수 있다', Array.isArray(oceanTabs), String(oceanTabs));
ok('탭이 12개다', (oceanTabs || []).length === 12, String((oceanTabs || []).length));
ok('탭 id·라벨·순서가 화면 버튼 순서와 같다',
    JSON.stringify((oceanTabs || []).map(t => [t.id, t.label])) === JSON.stringify(OCEAN_EXPECT),
    (oceanTabs || []).map(t => t.label).join(' | '));

// 없어진 탭이 되살아나지 않았는가 — 되살리려면 그 버튼부터 화면에 있어야 한다
[['marker', '주요지명'], ['myloc', '내 위치'], ['mudflat', '물빠짐'], ['cctv', 'CCTV'],
 ['hazardrock', '노출암·간출암'], ['warnactive', '특보 ON/OFF'], ['vsby', '시정']].forEach(([id, label]) => {
    ok(`「${label}」 탭이 해양종합정보 안내에 없다`, !(oceanTabs || []).some(t => t.id === id));
});

ok('「주요지명」 버튼이 화면에 없다(그래서 탭도 없다)',
    INDEX_SRC.indexOf('id="ocean-marker-toggle-btn"') < 0);
ok('「내 위치」 버튼이 화면에서 빠져 있다(주석 처리)',
    !/^\s*<button[^>]*id="ocean-myloc-btn"/m.test(INDEX_SRC.replace(/<!--[\s\S]*?-->/g, '')));
ok('물빠짐·CCTV 버튼은 해양종합정보에서 숨긴다(해양안전에만 보임)',
    /body:not\(\.ls-safety\) #ocean-cctv-toggle-btn/.test(INDEX_SRC) &&
    /body:not\(\.ls-safety\) #ocean-mudflat-toggle-btn/.test(INDEX_SRC));
ok('「특보 ON」은 특보구역과 같은 묶음 안에 있다(별도 버튼이 아니다)',
    /class="ocean-warn-zone-wrap"[\s\S]{0,900}id="ocean-warn-active-toggle-btn"[\s\S]{0,900}id="ocean-warn-zone-toggle-btn"/.test(INDEX_SRC));
ok('「시정예측」은 천기 팝아웃 안에 있다',
    /id="ocean-other-wx-popup"[\s\S]{0,3000}id="ocean-vsby-toggle-btn"/.test(INDEX_SRC));

ok('지도 조작 2개(위치 검색·진북 정렬)를 뺀 모든 탭에 출처가 붙어 있다',
    (oceanTabs || []).filter(t => !t.src).map(t => t.id).join(',') === 'search,northup',
    (oceanTabs || []).filter(t => !t.src).map(t => t.id).join(','));

// ── [2] 해양안전 안내 ─────────────────────────────────────────────────────
console.log('\n[2] 해양안전 안내 — 탭 순서가 버튼 순서와 같은가');

const SAFETY_EXPECT = [
    ['hazardrock', '위험지형'], ['accident', '사고정보'], ['banzone', '금지구역'],
    ['navwarn', '항행경보'], ['mudflat', '물빠짐'], ['cctv', 'CCTV'],
    ['vts', '관제구역'], ['seaway', '항로·해역']
];
ok('탭을 읽어 낼 수 있다', Array.isArray(safetyTabs), String(safetyTabs));
ok('탭이 8개다', (safetyTabs || []).length === 8, String((safetyTabs || []).length));
ok('탭 id·라벨·순서가 화면 버튼 순서와 같다',
    JSON.stringify((safetyTabs || []).map(t => [t.id, t.label])) === JSON.stringify(SAFETY_EXPECT),
    (safetyTabs || []).map(t => t.label).join(' | '));
ok('모든 탭이 자기 본문을 갖는다(해양종합정보에서 빌려 쓰지 않는다)',
    (safetyTabs || []).every(t => typeof t.html === 'string' && t.html.length > 100));
ok('모든 탭에 출처 줄이 있다',
    (safetyTabs || []).every(t => /ocean-info-src/.test(t.html || '')),
    (safetyTabs || []).filter(t => !/ocean-info-src/.test(t.html || '')).map(t => t.id).join(','));

// 화면 버튼 순서(CSS order)와 실제로 같은지 — 안내 순서의 근거
(function () {
    const order = [];
    const re = /body\.ls-mode\.ls-safety #ocean-overlay-controls > #?([\w-]+)\s*\{ order: (\d+); \}/g;
    let m;
    while ((m = re.exec(INDEX_SRC))) order[+m[2] - 1] = m[1];
    const BTN_TO_TAB = {
        'ocean-terrain-toggle-btn': 'hazardrock', 'ocean-accident-wrap': 'accident',
        'ocean-banzone-toggle-btn': 'banzone', 'ocean-navwarn-btn': 'navwarn',
        'ocean-mudflat-toggle-btn': 'mudflat', 'ocean-cctv-toggle-btn': 'cctv',
        'ocean-vts-toggle-btn': 'vts', 'ocean-seaway-toggle-btn': 'seaway'
    };
    const fromCss = order.filter(Boolean).map(id => BTN_TO_TAB[id]).filter(Boolean);
    ok('화면 버튼 순서(CSS order)를 8개 다 읽었다', fromCss.length === 8, fromCss.join(','));
    ok('안내 탭 순서 = 화면 버튼 순서',
        JSON.stringify(fromCss) === JSON.stringify((safetyTabs || []).map(t => t.id)),
        fromCss.join(',') + ' vs ' + (safetyTabs || []).map(t => t.id).join(','));
})();

// ── [3] 본문에 적힌 숫자가 실제 데이터와 같은가 ───────────────────────────
console.log('\n[3] 안내에 적힌 숫자 ↔ 실제 데이터');

function countFeatures(rel) {
    const j = JSON.parse(fs.readFileSync(path.join(CLIENT, rel), 'utf8'));
    return (j.features || j).length;
}
function has(text, s) { return text.indexOf(s) >= 0; }

(function () {
    const warn = countFeatures(path.join('assets', 'warn_zones.geojson'));
    const sub = countFeatures(path.join('assets', 'warn_zones_sub.geojson'));
    ok(`특보구역 부모 ${warn}개가 안내와 같다`, has(oceanText, `${warn}개 구역`), String(warn));
    ok(`특보구역 자식 ${sub}개가 안내와 같다`, has(oceanText, `평수구역 ${sub}개`), String(sub));

    const zones = countFeatures('marine_zone_area.json');
    ok(`해구 격자 ${zones}칸이 안내와 같다`,
        has(oceanText, `${zones.toLocaleString('en-US')}칸`), String(zones));

    // 표준항 목록은 배열을 실제로 평가해 센다(따옴표 종류에 흔들리지 않게).
    const stations = evalArray(fs.readFileSync(path.join(CLIENT, 'tide.js'), 'utf8'),
        'const TIDE_REFERENCE_STATIONS = ', '\n];') || [];
    ok(`표준항 ${stations.length}곳이 조석 탭과 같다`,
        stations.length > 0 && has(oceanText, `표준항 ${stations.length}곳`), String(stations.length));

    const limit = (TIDE_ROUTE.match(/TIDE_DAILY_LIMIT = (\d+)/) || [])[1];
    ok(`조석 하루 ${limit}회 제한이 안내와 같다`, has(oceanText, `하루 ${limit}회까지`), String(limit));
})();

(function () {
    const ban = countFeatures('fishing_ban_zones.json');
    ok(`낚시금지 ${ban}곳이 안내와 같다`, has(safetyText, `(${ban}곳)`), String(ban));

    const acJ = JSON.parse(fs.readFileSync(path.join(CLIENT, 'access_control_zones.json'), 'utf8'));
    const acZones = new Set(acJ.features.map(f => f.properties.station + '|' + f.properties.location)).size;
    ok(`출입통제 ${acZones}곳이 안내와 같다(조각 ${acJ.features.length}개를 구역 단위로 센 값)`,
        has(safetyText, `(${acZones}곳)`), String(acZones));

    const rocks = JSON.parse(fs.readFileSync(path.join(CLIENT, 'hazard_rocks.json'), 'utf8')).features;
    const byK = {};
    rocks.forEach(f => { const k = f.properties ? f.properties.k : f.k; byK[k] = (byK[k] || 0) + 1; });
    [[0, '노출암'], [1, '간출암'], [2, '세암'], [3, '암암']].forEach(([k, label]) => {
        const n = (byK[k] || 0).toLocaleString('en-US');
        ok(`${label} ${n}개가 위험지형 탭과 같다`, has(safetyText, `${label}</strong>(${n}개)`), n);
    });

    const shore = JSON.parse(fs.readFileSync(path.join(CLIENT, 'shore_rocks.json'), 'utf8'));
    const nShore = (shore.features || []).length.toLocaleString('en-US');
    const nCov = (shore.coveredExposedIds || []).length;
    ok(`갯바위 ${nShore}곳이 위험지형 탭과 같다`, has(safetyText, `갯바위</strong>(${nShore}곳)`), nShore);
    ok(`갯바위에 가린 노출암 ${nCov}개가 위험지형 탭과 같다`,
        has(safetyText, `노출암 ${nCov}개`), String(nCov));
})();

// ── [4] 표기 통일 ─────────────────────────────────────────────────────────
console.log('\n[4] 표기 통일');
ok('TideBED 를 "조위관측자료"라고 부르지 않는다(예측 자료다)',
    !/조위관측자료/.test(oceanText + safetyText));
ok('TideBED 표기가 대문자다(조석 탭)', /조석예측자료\(TideBED/.test(oceanText));

// ── [5] 게이트 등록 ───────────────────────────────────────────────────────
console.log('\n[5] 게이트 등록');
ok('verify_all.sh SUITES 에 test_guide_tabs 가 있다', /test_guide_tabs/.test(VERIFY_SRC));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
