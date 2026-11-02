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
 *        → client/js/ocean-map/cctv/ocean_cctv.js (해양종합정보 안내 13탭)
 *        → client/js/marine-life/safety/life_safety.js (해양안전 안내 9탭 — 2026-10-16 위험예측 탭 추가)
 *        → client/index2.html (화면 버튼 존재 여부)
 *        → client/js/marine-life/risk-forecast/risk_forecast.css (위험예측 버튼 order:0 — 맨 위)
 *        → client/js/marine-life/risk-forecast/risk_forecast.js·risk_format.js·risk_sheet.js·risk_basis_content.js
 *          (위험예측 탭에 적은 스위치 이름·시간 버튼·단계 말·[기준 상세]·오늘·내일이 화면 코드와 같은가)
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
const RF_DIR = path.join(CLIENT, 'js', 'marine-life', 'risk-forecast');
const RF_CSS = fs.readFileSync(path.join(RF_DIR, 'risk_forecast.css'), 'utf8');
const RF_JS = fs.readFileSync(path.join(RF_DIR, 'risk_forecast.js'), 'utf8');
const RF_FORMAT = fs.readFileSync(path.join(RF_DIR, 'risk_format.js'), 'utf8');
const RF_SHEET = fs.readFileSync(path.join(RF_DIR, 'risk_sheet.js'), 'utf8');
const RF_BASIS = fs.readFileSync(path.join(RF_DIR, 'risk_basis_content.js'), 'utf8');

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
    ['typhoon', '태풍'], ['otherwx', '천기'], ['depth', '수심'], ['tide', '조석'],
    ['pressure', '기압']
];
ok('탭을 읽어 낼 수 있다', Array.isArray(oceanTabs), String(oceanTabs));
ok('탭이 14개다', (oceanTabs || []).length === 14, String((oceanTabs || []).length));
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
    ['riskforecast', '위험예측'],
    ['hazardrock', '위험지형'], ['accident', '사고정보'], ['banzone', '금지구역'],
    ['navwarn', '항행경보'], ['mudflat', '물빠짐'], ['cctv', 'CCTV'],
    ['vts', '관제구역'], ['seaway', '항로·해역']
];
ok('탭을 읽어 낼 수 있다', Array.isArray(safetyTabs), String(safetyTabs));
ok('탭이 9개다(2026-10-16 위험예측 추가)', (safetyTabs || []).length === 9, String((safetyTabs || []).length));
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
    // 위험예측 버튼의 순서는 index2.html 이 아니라 risk_forecast.css 에 있다(order:0 = 맨 위).
    const rfOrder = (RF_CSS.match(/body\.ls-mode\.ls-safety #ocean-overlay-controls > #ocean-risk-forecast-toggle-btn \{[^}]*order:\s*(-?\d+)/) || [])[1];
    ok('위험예측 버튼 순서를 risk_forecast.css 에서 읽었다(order:0 = 맨 위)', rfOrder === '0', String(rfOrder));
    if (rfOrder === '0') order.unshift('ocean-risk-forecast-toggle-btn');
    const BTN_TO_TAB = {
        'ocean-risk-forecast-toggle-btn': 'riskforecast',
        'ocean-terrain-toggle-btn': 'hazardrock', 'ocean-accident-wrap': 'accident',
        'ocean-banzone-toggle-btn': 'banzone', 'ocean-navwarn-btn': 'navwarn',
        'ocean-mudflat-toggle-btn': 'mudflat', 'ocean-cctv-toggle-btn': 'cctv',
        'ocean-vts-toggle-btn': 'vts', 'ocean-seaway-toggle-btn': 'seaway'
    };
    const fromCss = order.filter(Boolean).map(id => BTN_TO_TAB[id]).filter(Boolean);
    ok('화면 버튼 순서(CSS order)를 9개 다 읽었다', fromCss.length === 9, fromCss.join(','));
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

// ── [3-2] 위험예측 탭 ↔ 화면 코드·기준 상세 ─────────────────────────────
// 2026-10-16 사용자 「그리고 해양안전생활에서 안내 버튼을 보면 매뉴별 내용이 있는데 그 내용에
//   위험예측에 관한 내용이 들어가도록 해줘. 내용은 기존에 작성되어있던 내용을 참고하여 반영해.
//   길게쓸 필요는 없어. 주요내용만.」 — 탭에 적은 이름·단계·버튼이 화면 코드에서 바뀌면 여기서 걸린다.
console.log('\n[3-2] 위험예측 탭 ↔ 화면 코드');
(function () {
    const rf = ((safetyTabs || []).find(t => t.id === 'riskforecast') || {}).html || '';
    ok('위험예측 탭 본문이 있다', rf.length > 100, String(rf.length));
    ['연안 위험 예측·분석', '해상 위험 예측·분석'].forEach(name => {
        ok(`스위치 이름 「${name}」 이 화면 코드와 같다`, has(rf, name) && has(RF_JS, '<span class="bzl-name">' + name + '</span>'));
    });
    ok('처음엔 연안만 켜진다(스위치 기본값이 연안 on·해상 off)',
        has(rf, '처음에는 연안만') &&
        has(RF_JS, 'class="bzl-row on" data-layer="coast" aria-pressed="true"') &&
        has(RF_JS, 'class="bzl-row" data-layer="sea" aria-pressed="false"'));
    ok('해상 단계 「낮음·보통·주의·경계」 가 기준 상세·지도 범례와 같다',
        has(rf, '낮음·보통·주의·경계') && has(RF_BASIS, '<b>낮음·보통·주의·경계</b>') &&
        has(RF_JS, "['낮음','보통','주의','경계']"));
    ok('연안 단계 「평소 수준·다소 높음·높음·매우 높음」 이 단계 함수와 같다',
        has(rf, '평소 수준·다소 높음·높음·매우 높음') &&
        has(RF_FORMAT, "['평소 수준','다소 높음','높음','매우 높음']"));
    ok('[혼잡도] 선택 버튼이 화면에 있다', has(rf, '[혼잡도]') && has(RF_JS, 'data-marine-mode="congestion" aria-checked="false">혼잡도</button>'));
    ok('시간 버튼 5개(-6H·-3H·현재·+3H·+6H)가 화면 코드와 같다',
        has(rf, '-6H·-3H·현재·+3H·+6H') && has(RF_JS, "['-6','-3','now','3','6']"));
    ok('[기준 상세] 버튼이 시트에 있다', has(rf, '[기준 상세]') && has(RF_SHEET, '>기준 상세</button>'));
    ok('연안 PDF 받기가 연안 기준 상세에 있다', has(rf, 'PDF') && /coast:[\s\S]*pdf-btn/.test(RF_BASIS));
    ok('「오늘·내일」 이 기준 상세와 같다', has(rf, '오늘·내일') && has(RF_BASIS, '오늘·내일을 3시간 간격'));
    ok('연안 「주변 3km」 가 기준 상세와 같다', has(rf, '주변 3km') && has(RF_BASIS, '이 관광지 주변 3km'));
    // 연안은 「하루 하나·날짜 넘기기」로 바뀌는 중(2026-10-16 사용자 확정) — 3시간 칸이라고 적지 않는다.
    const coastSentences = rf.split('</p>').filter(p => /<strong>연안<\/strong>/.test(p));
    ok('연안을 3시간 단위라고 적지 않는다(날짜별)',
        coastSentences.length > 0 && coastSentences.every(p => !/3시간/.test(p) || /<strong>해상<\/strong>/.test(p)) && has(rf, '<strong>날짜별</strong>'),
        coastSentences.length + '문단');
    ok('위험예측 탭에 출처 줄이 있다', /ocean-info-src/.test(rf));
})();

// ── [4] 표기 통일 ─────────────────────────────────────────────────────────
console.log('\n[4] 표기 통일');
ok('TideBED 를 "조위관측자료"라고 부르지 않는다(예측 자료다)',
    !/조위관측자료/.test(oceanText + safetyText));
ok('TideBED 표기가 대문자다(조석 탭)', /조석예측자료\(TideBED/.test(oceanText));
ok('태풍 출처가 기상청 방재기상플랫폼이다(사용자 확정)',
    /기상청 방재기상플랫폼/.test((oceanTabs || []).filter(t => t.id === 'typhoon').map(t => t.src || '').join('')));

// ── [5] 게이트 등록 ───────────────────────────────────────────────────────
console.log('\n[5] 게이트 등록');
ok('verify_all.sh SUITES 에 test_guide_tabs 가 있다', /test_guide_tabs/.test(VERIFY_SRC));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
