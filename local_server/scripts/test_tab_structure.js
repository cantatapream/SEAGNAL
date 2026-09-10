/**
 * test_tab_structure.js — 하단 메뉴·하위탭 구성이 조용히 되돌아가지 않게 고정한다.
 *
 * [왜 있나] 2026-09-10 사용자 확정으로 하단 "해양생활" 자리를 **해양안전생활**이 대체했다.
 *   그 전까지 이 화면은 "해양생활 탭을 3초 안에 10번 연타"해야 열리는 숨은 기능이었고,
 *   열리는 순간 자바스크립트가 탭 이름·하위탭 바·기본 하위탭을 그 자리에서 바꿔치기했다.
 *   정식 기능이 되면서 그 값들을 **마크업(index2.html)과 marine.js 의 기본값으로 옮겼는데**,
 *   기본값은 여러 파일에 흩어져 있어(라벨은 HTML, 하위탭 바 매핑은 marine.js, 표시 규칙은
 *   life_safety.js) 한 곳만 되돌아가도 화면이 어긋난다. 그런데 이 영역을 지키는 검사가 없었다.
 *
 * [무엇을 고정하나] ①하단 메뉴 4개의 이름·순서 ②해양안전생활이 쓰는 하위탭 바와 그 두 갈래
 *   ③들어갔을 때 먼저 열리는 하위탭이 '해양안전' 인가 ④10회 연타 트리거가 되살아나지 않았나
 *   ⑤이 화면 표시 규칙(body.ls-mode)을 시작할 때 켜는가.
 *   화면을 띄우지 않고 소스만 읽어 확인한다(브라우저가 필요 없다).
 *
 * [실행] node local_server/scripts/test_tab_structure.js
 * [연계] ← scripts/refactor/verify_all.sh SUITES
 *        → client/index2.html (메인탭 라벨·하위탭 바 마크업)
 *        → client/js/forecast/alerts/marine.js (TAB_GROUP_SUBTABS · TAB_GROUP_DEFAULTS)
 *        → client/js/marine-life/safety/life_safety.js (body.ls-mode 적용)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const CLIENT = path.join(ROOT, 'client');
const INDEX_SRC = fs.readFileSync(path.join(CLIENT, 'index2.html'), 'utf8');
const MARINE_SRC = fs.readFileSync(path.join(CLIENT, 'js', 'forecast', 'alerts', 'marine.js'), 'utf8');
const LS_SRC = fs.readFileSync(path.join(CLIENT, 'js', 'marine-life', 'safety', 'life_safety.js'), 'utf8');
const VERIFY_SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'refactor', 'verify_all.sh'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

/** 소스에서 객체/배열 리터럴을 떼어 실제로 평가한다(정규식보다 정확). */
function evalLiteral(src, marker, endMarker) {
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

// ── [1] 하단 메뉴 4개 ──────────────────────────────────────────────────────
console.log('\n[1] 하단 메뉴 — 이름과 순서');

(function () {
    const nav = INDEX_SRC.match(/<nav[^>]*class="[^"]*main-tabs[^"]*"[\s\S]*?<\/nav>/);
    ok('메인탭 묶음을 찾았다', !!nav);
    if (!nav) return;
    const labels = (nav[0].match(/<span class="tab-btn-label">([^<]+)<\/span>/g) || [])
        .map(s => s.replace(/<[^>]+>/g, '').trim());
    const EXPECT = ['특보정보', '해양종합정보', '해양안전생활', '공지사항'];
    ok('하단 메뉴가 4개다', labels.length === 4, labels.join(' | '));
    ok('이름과 순서가 특보정보 · 해양종합정보 · 해양안전생활 · 공지사항 이다',
        JSON.stringify(labels) === JSON.stringify(EXPECT), labels.join(' | '));
    ok('옛 이름 "해양생활" 이 하단 메뉴에 남아 있지 않다', labels.indexOf('해양생활') < 0);
})();

ok('해양안전생활 탭이 ocean-life-group 을 가리킨다(섹션 id 는 그대로 재사용)',
    /<button class="tab-btn" data-target="ocean-life-group">[\s\S]{0,200}해양안전생활/.test(INDEX_SRC));

// ── [2] 하위탭 — 해양안전 | 해양생활 ───────────────────────────────────────
console.log('\n[2] 하위탭 — 두 갈래와 기본 선택');

(function () {
    const bar = INDEX_SRC.match(/<nav[^>]*id="ocean-safety-sub-tabs"[\s\S]*?<\/nav>/);
    ok('해양안전생활 하위탭 바가 있다', !!bar);
    if (!bar) return;
    // 화면에 보이는 두 갈래만 추린다(ls-hidden-sub 는 레일로 옮겨져 숨김)
    const shown = (bar[0].match(/<button class="sub-tab-btn[^"]*"[^>]*>([^<]+)<\/button>/g) || [])
        .filter(s => s.indexOf('ls-hidden-sub') < 0)
        .map(s => ({ label: s.replace(/<[^>]+>/g, '').trim(), active: /\bactive\b/.test(s) }));
    ok('보이는 하위탭이 2개다', shown.length === 2, shown.map(x => x.label).join(' | '));
    ok('하위탭이 [해양안전 | 해양생활] 이다',
        JSON.stringify(shown.map(x => x.label)) === JSON.stringify(['해양안전', '해양생활']),
        shown.map(x => x.label).join(' | '));
    ok('먼저 열리는 하위탭이 "해양안전" 이다(사용자 확정)',
        shown[0] && shown[0].active && !(shown[1] && shown[1].active),
        shown.map(x => x.label + (x.active ? '★' : '')).join(' | '));
    ok('활동 6개는 하위탭 바에서 숨겨져 있다(오른쪽 세로 레일에서 고른다)',
        (bar[0].match(/ls-hidden-sub/g) || []).length === 6,
        String((bar[0].match(/ls-hidden-sub/g) || []).length));
})();

// ── [3] 탭 그룹 기본값 (marine.js) ─────────────────────────────────────────
console.log('\n[3] 탭 그룹 기본값');

(function () {
    const subtabs = evalLiteral(MARINE_SRC, 'const TAB_GROUP_SUBTABS = ', '\n};');
    const defaults = evalLiteral(MARINE_SRC, 'const TAB_GROUP_DEFAULTS = ', '\n};');
    ok('TAB_GROUP_SUBTABS 를 읽어 냈다', !!subtabs, JSON.stringify(subtabs));
    ok('TAB_GROUP_DEFAULTS 를 읽어 냈다', !!defaults, JSON.stringify(defaults));
    ok('해양안전생활이 처음부터 ocean-safety-sub-tabs 를 쓴다',
        subtabs && subtabs['ocean-life-group'] === 'ocean-safety-sub-tabs',
        subtabs && subtabs['ocean-life-group']);
    ok('들어가면 ocean-safety-section(해양안전)이 먼저 열린다',
        defaults && defaults['ocean-life-group'] === 'ocean-safety-section',
        defaults && defaults['ocean-life-group']);
    ok('옛 기본값(ocean-life-sub-tabs / fishing-section)으로 돌아가지 않았다',
        subtabs && subtabs['ocean-life-group'] !== 'ocean-life-sub-tabs' &&
        defaults && defaults['ocean-life-group'] !== 'fishing-section');
})();

// ── [4] 10회 연타 트리거가 되살아나지 않았는가 ─────────────────────────────
console.log('\n[4] 숨은 트리거 제거 확인');

ok('life_safety.js 에 10회 연타 임계값이 없다', !/TAP_THRESHOLD/.test(LS_SRC));
ok('연타 카운터·타이머가 없다', !/_tapCount|_tapTimer/.test(LS_SRC));
ok('_bindTrigger()(연타 감지 바인딩)가 없다', !/_bindTrigger/.test(LS_SRC));
ok('시작할 때 이 화면 표시 규칙(body.ls-mode)을 켠다',
    /function _enableSafetyChrome\(\)[\s\S]{0,300}classList\.add\('ls-mode'\)/.test(LS_SRC) &&
    /DOMContentLoaded[\s\S]{0,200}_enableSafetyChrome\(\);/.test(LS_SRC));
ok('자바스크립트가 탭 이름을 나중에 바꿔 달지 않는다(깜빡임 방지)',
    !/tab-btn-label[\s\S]{0,120}textContent = '해양안전생활'/.test(LS_SRC));

// ── [5] 해양안전 화면 버튼 8개 (순서 = 안내 탭 순서의 근거) ────────────────
console.log('\n[5] 해양안전 화면 버튼');

(function () {
    const order = [];
    const re = /body\.ls-mode\.ls-safety #ocean-overlay-controls > #?([\w-]+)\s*\{ order: (\d+); \}/g;
    let m;
    while ((m = re.exec(INDEX_SRC))) order[+m[2] - 1] = m[1];
    const EXPECT = ['ocean-terrain-toggle-btn', 'ocean-accident-wrap', 'ocean-banzone-toggle-btn',
        'ocean-navwarn-btn', 'ocean-mudflat-toggle-btn', 'ocean-cctv-toggle-btn',
        'ocean-vts-toggle-btn', 'ocean-seaway-toggle-btn'];
    ok('버튼 순서 8개가 다 정의돼 있다', order.filter(Boolean).length === 8, order.filter(Boolean).join(','));
    ok('순서가 위험지형→사고정보→금지구역→항행경보→물빠짐→CCTV→관제구역→항로해역 이다',
        JSON.stringify(order.filter(Boolean)) === JSON.stringify(EXPECT), order.filter(Boolean).join(','));
})();

// ── [6] 신규 표시(N) 배지 — 3일 뒤 저절로 사라지는가 ──────────────────────
console.log('\n[6] 해양안전생활 N 배지');

(function () {
    ok('N 배지를 붙이는 함수(_markNewBadge)가 있다', /function _markNewBadge\(\)/.test(LS_SRC));
    ok('앱이 뜰 때 호출한다', /DOMContentLoaded[\s\S]{0,300}_markNewBadge\(\);/.test(LS_SRC));
    ok('공지사항 탭과 같은 배지 스타일(.new-badge)을 쓴다',
        /className = 'new-badge'/.test(LS_SRC) && /textContent = 'N'/.test(LS_SRC));
    ok('붙이는 대상이 하단 "해양안전생활" 탭이다',
        /tab-btn\[data-target="ocean-life-group"\]/.test(LS_SRC));
    ok('탭 높이가 안 늘어나도록 라벨 span 안에 넣는다',
        /querySelector\('\.tab-btn-label'\) \|\| btn\)\.appendChild\(badge\)/.test(LS_SRC));

    // 끝나는 시각을 실제로 평가해 본다 — 주석이 아니라 값으로 확인한다.
    const m = LS_SRC.match(/var NEW_BADGE_UNTIL = (Date\.UTC\([^)]*\));/);
    ok('끝나는 시각(NEW_BADGE_UNTIL)이 상수로 박혀 있다', !!m);
    if (!m) return;
    const sb = {}; vm.createContext(sb);
    vm.runInContext('this.__t = ' + m[1] + ';', sb);
    const until = sb.__t;
    // KST(UTC+9) 로 옮겨 본다 — 9/12 24:00 KST 는 곧 9/13 00:00 KST 와 같은 순간이다.
    const kst = new Date(until + 9 * 3600 * 1000);
    ok('배포일(9/10) 포함 3일이 끝나는 순간 = 2026-09-13 00:00 KST 이다',
        kst.getUTCFullYear() === 2026 && kst.getUTCMonth() === 8 &&
        kst.getUTCDate() === 13 && kst.getUTCHours() === 0 && kst.getUTCMinutes() === 0,
        new Date(until).toISOString());
    // 경계를 한 번 더 — 9/12 23:59 KST 는 붙고, 9/13 00:00 KST 는 안 붙는다.
    const kstToUtc = (y, mo, d, h, mi) => Date.UTC(y, mo, d, h - 9, mi);
    ok('9/12 23:59 KST 에는 아직 붙는다', kstToUtc(2026, 8, 12, 23, 59) < until);
    ok('9/13 00:00 KST 부터는 안 붙는다', kstToUtc(2026, 8, 13, 0, 0) >= until);
})();

// ── [7] 축척 막대(거리 눈금) — 하단 탭·하위탭을 따라 움직이는가 ───────────
console.log('\n[7] 축척 막대');

(function () {
    // 기준 박스가 지도 컨테이너면 하위탭이 열린 동안 높이를 이중으로 더해
    // 막대가 화면 한가운데까지 떠오른다(2026-09-10 사용자 보고). 화면 기준 고정이어야 한다.
    // 앞에 조상 선택자가 붙지 않은(줄 맨 앞에서 시작하는) 규칙만 고른다 —
    // 그냥 찾으면 위쪽의 `body.ls-mode.ls-safety .ol-scale-line {` 이 먼저 걸린다.
    const block = INDEX_SRC.match(/\n\s*\.ol-scale-line \{[\s\S]*?\}/);
    ok('.ol-scale-line 규칙을 찾았다', !!block);
    ok('화면(viewport) 기준으로 고정한다(position: fixed)',
        !!block && /position:\s*fixed\s*!important/.test(block[0]));
    ok('우측 하단에 붙인다(right/bottom 지정, left·top 해제)',
        !!block && /right:\s*8px\s*!important/.test(block[0]) &&
        /left:\s*auto\s*!important/.test(block[0]) && /top:\s*auto\s*!important/.test(block[0]));

    ok('하위탭이 열리면 그만큼 올라간다(body.sub-tabs-open)',
        /body\.sub-tabs-open \.ol-scale-line \{[\s\S]{0,200}var\(--sub-tab-height/.test(INDEX_SRC));
    ok('해양안전 화면에서는 출처표기와 같은 높이에 선다(--ls-bottom-chrome + 6px)',
        /body\.ls-mode\.ls-safety \.ol-scale-line \{\s*bottom: calc\(var\(--ls-bottom-chrome\) \+ 6px\)/.test(INDEX_SRC));
    ok('물빠짐이 켜지면 슬라이더(전폭·z-index 1200) 위로 함께 올라간다',
        /body\.ls-mode\.ls-safety\.ls-mudflat-on \.ol-scale-line \{\s*bottom: calc\(var\(--ls-bottom-chrome\) \+ 2\.25rem \+ 6px\)/.test(INDEX_SRC));

    // 색: 검은 글씨·검은 눈금 + 흰 테두리(사용자 확정 2026-09-10)
    const inner = INDEX_SRC.match(/\.ol-scale-line-inner \{[\s\S]*?\}/);
    ok('.ol-scale-line-inner 규칙을 찾았다', !!inner);
    ok('글씨와 눈금이 검정이다', !!inner && /color:\s*#000\s*!important/.test(inner[0]) &&
        /border-color:\s*#000\s*!important/.test(inner[0]));
    ok('옛 흰 글씨로 돌아가지 않았다', !!inner && !/color:\s*#fff/.test(inner[0]));
    ok('척도 전체에 흰 테두리를 두른다(drop-shadow)',
        /\.ol-scale-line \{[\s\S]{0,300}filter:[\s\S]{0,200}drop-shadow\(0 0 1px #fff\)/.test(INDEX_SRC));
})();

// ── [8] 게이트 등록 ───────────────────────────────────────────────────────
console.log('\n[8] 게이트 등록');
ok('verify_all.sh SUITES 에 test_tab_structure 가 있다', /test_tab_structure/.test(VERIFY_SRC));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
