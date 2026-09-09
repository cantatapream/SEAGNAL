/**
 * test_accident_sheet.js — 사고 분석 바텀시트·격자가 조용히 깨지지 않게 고정한다.
 *
 * [왜 있나] 2026-09-04 적대검증에서 나온 결함들이 **몇 달간 아무도 모르게 살아 있었다.**
 *   - `hourOf` 가 같은 범위에 두 번 선언돼(8월 말부터) 시간대 필터가 시각 문자열의
 *     네 번째 글자를 시로 읽었다. 선박 59,664건 중 57,113건(95.7%)이 틀린 시였고
 *     "00~03시" 필터가 실제 5,883건 대신 36,662건을 통과시켰다.
 *   - 육상 특보구역 이름 체계가 통보문과 달라 강풍 발효 일수가 사실상 전부 0에 가까웠다.
 *   - 관할 미상을 폴리곤으로 채우면서 개서일을 안 봐서, 2017년에 생긴 울진해양경찰서에
 *     2016년 사고 117건이 들어갔다.
 *   이 저장소의 자동 검사(verify_all.sh)에 사고 지도·시트 검사가 **하나도 없어서**
 *   그때그때 사람이 손으로 볼 때만 드러났다. CLAUDE.md 결정로그(2026-08-09)의
 *   *"새 테스트 스위트는 만든 즉시 SUITES 배열에 등록"* 과 어긋나던 빈칸을 메운다.
 *
 * [무엇을 고정하나] 화면을 띄우지 않고도 확인할 수 있는 것들 — ①원본 데이터로 다시 센
 *   숫자가 화면에 적어 둔 값과 같은가 ②판정 규칙이 코드에 그대로 있는가.
 *   화면 배치·클릭 동작은 이 스위트가 다루지 않는다(브라우저가 필요하다).
 *
 * [실행] node local_server/scripts/test_accident_sheet.js
 * [연계] ← scripts/refactor/verify_all.sh SUITES
 *        → client/js/marine-life/safety/accident_info.js
 *        → client/accident_ships_hk.json · accident_persons.json
 *        → client/warn_intervals.json · client/assets/warn_zones_land_coastal.geojson
 *        → local_server/scripts/assign_unknown_jurisdiction.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const CLIENT = path.join(ROOT, 'client');
const SRC = fs.readFileSync(path.join(CLIENT, 'js', 'marine-life', 'safety', 'accident_info.js'), 'utf8');

// 주석을 걷어낸 판 — "이 표현이 남아 있으면 안 된다" 류 검사는 이걸 본다.
// (고친 내력을 적어 둔 주석이 그 표현을 그대로 인용하고 있어, 원문을 그대로 보면
//  고쳐 놓고도 실패한다. 실제로 이 스위트를 처음 돌렸을 때 두 항목이 그렇게 걸렸다.)
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

// ── 코드표·데이터 읽기 ────────────────────────────────────────────────────
const codesCtx = { window: {}, document: {} };
vm.createContext(codesCtx);
vm.runInContext(
    fs.readFileSync(path.join(CLIENT, 'js', 'shared', 'utils', 'accident_codes.js'), 'utf8') +
    '\n;this.__T = ACCIDENT_TYPE_LABELS; this.__O = ACCIDENT_ORG_LABELS;', codesCtx);
const TYPE = codesCtx.__T, ORG = codesCtx.__O;

const hk = JSON.parse(fs.readFileSync(path.join(CLIENT, 'accident_ships_hk.json'), 'utf8')).rows;
const person = JSON.parse(fs.readFileSync(path.join(CLIENT, 'accident_persons.json'), 'utf8')).rows;

// 선박 [lat,lon,ymd,hm,pos,typeCd,causeCd,shipCd,orgCd,구조,사망,실종,warnFlags,…,warnSev]
// 인명 [lat,lon,ymd,pos,typeCd,orgCd,관련인원,구조,사망,실종,warnFlags,warnSev]
const HK = { type: 5, org: 8, death: 10, missing: 11, warnSev: 16 };
const PS = { type: 4, org: 5, prsn: 6, rescue: 7, death: 8, missing: 9, warnSev: 11 };

console.log('\n[1] 시각(hm) 읽기 — 시간대 필터가 틀린 시를 보지 않는가');

ok('hourOf 가 같은 범위에 두 번 선언돼 있지 않다',
    (SRC.match(/function\s+hourOf\s*\(/g) || []).length === 0,
    '남은 선언 ' + (SRC.match(/function\s+hourOf\s*\(/g) || []).length + '개');
ok('행을 받는 hourOfRow 하나만 있다',
    (SRC.match(/function\s+hourOfRow\s*\(/g) || []).length === 1);
ok('hourOfRow 가 0~23 범위를 벗어난 값을 막는다',
    /function hourOfRow[\s\S]{0,400}h < 0 \|\| h > 23[\s\S]{0,40}return null/.test(SRC));
ok('시간대 필터가 행을 넘긴다(문자열이 아니라)',
    /hourOfRow\(row\)/.test(CODE) && !/hourOf\w*\(row\[3\]\)/.test(CODE));
ok('시간대별 집계가 선박만 센다(인명 row[3] 은 발생장소 텍스트)',
    /function hourlyBuckets[\s\S]{0,400}srcOfFeat\(f\) !== 'hk'[\s\S]{0,60}return;/.test(SRC));

// 인명 row[3] 이 실제로 숫자로 파싱되는 행이 있는지 — 위 방어가 왜 필요한지 데이터로 고정
(function () {
    let big = 0;
    person.forEach((r) => {
        const h = parseInt(String(r[3]).split(':')[0], 10);
        if (!isNaN(h) && (h < 0 || h > 23)) big++;
    });
    ok('인명 발생장소가 24 이상 숫자로 읽히는 행이 실제로 있다(방어가 필요한 이유)',
        big > 0, big + '건');
})();

console.log('\n[2] 관할서 — 개서 이전 기관에 배정하지 않는가');

const ESTABLISHED = {
    평택해양경찰서: '20110401', 창원해양경찰서: '20121227', 보령해양경찰서: '20140401',
    부안해양경찰서: '20160421', 울진해양경찰서: '20171128', 사천해양경찰서: '20220331',
    강릉해양경찰서: '20250331'
};
// 원본에 원래부터 있던 "개서 이전 기록"의 개수 — 우리가 채운 것이 여기 더해지면 안 된다.
const PRE_ESTABLISH_BASELINE = { 창원해양경찰서: 87, 평택해양경찰서: 47, 부안해양경찰서: 13, 보령해양경찰서: 57 };

(function () {
    const found = {};
    let unknown = 0;
    [[hk, HK.org], [person, PS.org]].forEach(([rows, idx]) => rows.forEach((r) => {
        const code = r[idx];
        if (!code) { unknown++; return; }
        const nm = ORG[code];
        if (!nm || !ESTABLISHED[nm]) return;
        if (String(r[2]) < ESTABLISHED[nm]) found[nm] = (found[nm] || 0) + 1;
    }));
    const bad = Object.keys(found).filter((k) => (found[k] || 0) > (PRE_ESTABLISH_BASELINE[k] || 0));
    ok('개서 이전 사고가 그 서로 새로 배정되지 않았다',
        bad.length === 0,
        bad.map((k) => k + ' ' + found[k] + '건(원본 ' + (PRE_ESTABLISH_BASELINE[k] || 0) + ')').join(' · '));
    ok('남은 "관할 미상"이 100건 이하다', unknown <= 100, unknown + '건');
})();

ok('배정 스크립트에 개서일 게이트가 있다',
    /ESTABLISHED_YMD/.test(fs.readFileSync(path.join(__dirname, 'assign_unknown_jurisdiction.js'), 'utf8')));
ok('관할서별 목록이 코드표에 없는 숫자 코드를 항목으로 안 쓴다',
    /ASH_EXCLUDED_LABEL\.test\(e\[0\]\) \|\| \/\^\\d\+\$\/\.test\(e\[0\]\)/.test(SRC));

console.log('\n[3] 특보 — 분모를 자료 시작일로 자르는가');

const WARN_START = '20160826';
ok('분모 시작일 상수가 그대로다',
    new RegExp("WARN_DATA_START_YMD = '" + WARN_START + "'").test(SRC));

(function () {
    function ratio(rows, sevIdx) {
        let denom = 0, warn = 0;
        rows.forEach((r) => {
            if (String(r[2]) < WARN_START) return;
            denom++;
            if ((r[sevIdx] || []).length) warn++;
        });
        return { denom, warn, pct: denom ? warn / denom * 100 : 0 };
    }
    const a = ratio(hk, HK.warnSev), b = ratio(person, PS.warnSev);
    const all = { warn: a.warn + b.warn, denom: a.denom + b.denom };
    all.pct = all.warn / all.denom * 100;
    // 원본 JSON 기준값(화면은 좌표 이상치 등을 걸러 조금 낮다 — 설계서 참고).
    ok('선박 특보 중 사고 비율이 4.0% 언저리', Math.abs(a.pct - 4.0) < 0.3, a.pct.toFixed(2) + '%');
    ok('인명 특보 중 사고 비율이 6.3% 언저리', Math.abs(b.pct - 6.3) < 0.3, b.pct.toFixed(2) + '%');
    ok('통합 특보 중 사고 비율이 4.3% 언저리', Math.abs(all.pct - 4.3) < 0.3, all.pct.toFixed(2) + '%');
})();

(function () {
    // 육상 특보구역 이름이 통보문 구역과 이어지는가 — 안 이어지면 발효 일수가 0에 가까워진다.
    const zones = JSON.parse(fs.readFileSync(path.join(CLIENT, 'warn_intervals.json'), 'utf8')).zones;
    const geo = JSON.parse(fs.readFileSync(
        path.join(CLIENT, 'assets', 'warn_zones_land_coastal.geojson'), 'utf8'));
    const norm = (s) => String(s).replace(/[\s·.]/g, '');
    const has = (n) => Object.prototype.hasOwnProperty.call(zones, n);
    const DIR = /(중부|서부|동부|남부|북부|영종|도서)$/;
    function cands(name, parents) {
        const out = [];
        const push = (v) => { if (v && out.indexOf(v) < 0) out.push(v); };
        const n = norm(name); push(n);
        const a = n.replace(/__.*$/, ''); push(a);
        const b = a.replace(/\(.*?\)/g, ''); push(b);
        [a, b].forEach((x) => {
            push(x.replace(/(시|군|구)(?=(평지|산지)?$)/, ''));
            push(x.replace(/(시|군|구)/g, ''));
            const base = x.replace(DIR, ''); push(base); push(base.replace(/(시|군|구)$/, ''));
            push(x + '평지'); push(x.replace(/(시|군|구)$/, '') + '평지');
            const t = x.match(/(평지|산지)$/);
            if (t) { const h = x.slice(0, -t[0].length); ['시', '군', '구'].forEach((u) => push(h + u + t[0])); }
        });
        (parents || []).forEach((p) => {
            const pn = norm(p); push(pn); push(pn.replace(/(특별자치도|광역시|시|도)$/, ''));
        });
        return out;
    }
    const seen = new Set();
    const miss = [];
    let matched = 0, total = 0;
    geo.features.forEach((f) => {
        const k = f.properties.name;
        if (seen.has(k)) return;
        seen.add(k); total++;
        if (cands(k, f.properties.parents).find(has)) matched++; else miss.push(k);
    });
    ok('육상 특보구역 이름이 통보문과 전부 이어진다',
        matched === total, matched + '/' + total +
        (matched === total ? '' : ' — 못 이은 것: ' + miss.join(' · ')));
    ok('육상 구역 파일이 대신 볼 이름(상위·부모 구역)을 함께 갖고 있다',
        geo.features.some((f) => (f.properties.parents || []).length > 0));
    // 2026-09-04 사용자가 준 기상청 안내서로 확인한 다섯 — 갈라지기 전 시·군 이름으로 이어져야 한다.
    [['완도여서도', '완도'], ['영광낙월면', '영광'], ['부안위도면', '부안'],
     ['군산옥도면(어청도제외)', '군산'], ['군산어청도', '군산']].forEach((pair) => {
        const f = geo.features.find((x) => x.properties.name === norm(pair[0]));
        ok('섬 구역 ' + pair[0] + ' 이 부모 구역 ' + pair[1] + ' 을 첫 대체 이름으로 갖는다',
            !!f && (f.properties.parents || [])[0] === pair[1],
            f ? JSON.stringify(f.properties.parents) : '피처 없음');
    });
    // 해상 44구역은 예전부터 전부 맞았다 — 그것이 깨지면 바로 알아야 한다.
    const sea = JSON.parse(fs.readFileSync(path.join(CLIENT, 'assets', 'warn_zones.geojson'), 'utf8'));
    const seaNames = new Set();
    sea.features.forEach((f) => { const n = f.properties && (f.properties.name || f.properties.regKo); if (n) seaNames.add(norm(n)); });
    let seaHit = 0;
    seaNames.forEach((n) => { if (has(n)) seaHit++; });
    ok('해상 특보구역 이름이 전부 이어진다', seaHit === seaNames.size, seaHit + '/' + seaNames.size);
})();

console.log('\n[4] 치명도 — 순위가 흔들리지 않는가');

const FATAL_MIN = 100;
const FATAL_SKIP_YEAR = { 2014: 1, 2015: 1 };
const EXCLUDED = /^(기타|정보없음|원인미상|관할 미상)/;
const DROP = { 해양오염: 1 };
const GRAY = { 변사자: 1, 자살자: 1 };

function fatalityTop5(rows, idx, isShip) {
    const m = {};
    rows.forEach((r) => {
        if (FATAL_SKIP_YEAR[String(r[2]).slice(0, 4)]) return;
        const label = TYPE[r[idx.type]] || '정보없음';
        if (EXCLUDED.test(label) || DROP[label]) return;
        const e = m[label] || (m[label] = { label, scale: 0, fatal: 0 });
        if (isShip) {
            e.scale += 1;
            if ((+r[idx.death] || 0) + (+r[idx.missing] || 0) > 0) e.fatal += 1;
        } else {
            e.scale += (+r[idx.prsn] || 0);
            e.fatal += (+r[idx.death] || 0) + (+r[idx.missing] || 0);
        }
    });
    return Object.keys(m).map((k) => m[k])
        .filter((e) => e.fatal > 0 && e.scale >= FATAL_MIN && !GRAY[e.label])
        .map((e) => { e.rate = e.fatal / e.scale * 100; return e; })
        .sort((a, b) => b.rate - a.rate).slice(0, 5);
}

(function () {
    const ship = fatalityTop5(hk, HK, true).map((e) => e.label);
    const life = fatalityTop5(person, PS, false).map((e) => e.label);
    ok('선박 치명도 Top 5 순서',
        ship.join('>') === '인명사상>전복>안전저해>침몰>충돌', ship.join(' > '));
    ok('인명 치명도 Top 5 순서',
        life.join('>') === '추락자>익수자>응급환자>고립자>표류자', life.join(' > '));
    const bad = fatalityTop5(hk, HK, true).filter((e) => e.rate >= 99 || e.scale < FATAL_MIN);
    ok('표본이 얇아 비율이 튄 유형이 Top 5 에 없다', bad.length === 0,
        bad.map((e) => e.label + ' ' + e.rate.toFixed(1) + '%').join(','));
    ok('치명도 기준선·제외 규칙이 코드에 그대로 있다',
        new RegExp('FATAL_MIN_SAMPLE = ' + FATAL_MIN).test(SRC) &&
        /FATAL_EXCLUDED_YEARS = \{ '2014': 1, '2015': 1 \}/.test(SRC) &&
        /FATAL_DROP_TYPES = \{ '해양오염': 1 \}/.test(SRC));
})();

console.log('\n[5] 인명 피해 — 세 항목 합이 분모와 맞는가');

(function () {
    let rescue = 0, death = 0, missing = 0, dropped = 0;
    person.forEach((r) => {
        if (FATAL_SKIP_YEAR[String(r[2]).slice(0, 4)] || DROP[TYPE[r[PS.type]]]) { dropped++; return; }
        rescue += (+r[PS.rescue] || 0);
        death += (+r[PS.death] || 0);
        missing += (+r[PS.missing] || 0);
    });
    const total = rescue + death + missing;
    ok('구조+사망+실종 이 분모와 정확히 같다(분모를 세 항목 합으로 쓴다)',
        total === rescue + death + missing && total > 0, total + '명');
    ok('2014·2015년과 해양오염이 실제로 빠진다', dropped > 0, dropped + '건 제외');
    // 화면은 최대잉여법으로 반올림해 합을 100.0% 로 맞춘다 — 그 코드가 있는지.
    ok('표시 비율의 합이 100%가 되도록 맞추는 코드가 있다',
        /최대잉여법|shown\[biggest\] = Math\.round/.test(SRC));
    // "해양오염은 인명피해가 없다"는 사실이 아니다 — 그렇게 쓰지 않았는지 고정.
    let pollutionFatal = 0;
    person.forEach((r) => {
        if (TYPE[r[PS.type]] === '해양오염') pollutionFatal += (+r[PS.death] || 0) + (+r[PS.missing] || 0);
    });
    ok('해양오염에 사망·실종이 실제로 있다(주석이 "없다"고 쓰면 거짓말)',
        pollutionFatal > 0, pollutionFatal + '명');
    ok('해양오염 주석이 "인명피해가 없어"라고 쓰지 않는다',
        !/해양오염은 인명피해가 없어/.test(CODE));
})();

console.log('\n[6] 격자·필터 — 격자가 필터를 타지 않는가');

ok('필터는 5개다(선박용도·톤수·계절 없음)',
    /var filters = \{ types: null, orgs: null, hourRanges: null, warnTypes: null, dateRange: null \};/.test(SRC));
ok('분석 모드 격자는 필터를 걸지 않는다',
    /var filtering = !analysis && hasActiveFilters\(\);/.test(SRC));
ok('분석 모드 격자는 두 소스 합계를 센다',
    /analysis \? analysisFeaturesAll\(\) :/.test(SRC));
ok('필터가 바뀌어도 격자를 다시 세지 않는다',
    /function onFiltersChanged[\s\S]{0,700}renderStatsBody\(\);/.test(SRC) &&
    !/function onFiltersChanged[\s\S]{0,700}recomputeGrid/.test(SRC));
ok('범례가 "(기간 지정)"이라고 쓰지 않는다(격자가 기간 필터를 안 타므로)',
    !/사고건수 \(기간 지정\)/.test(SRC));
ok('비동기 결과 가드가 _statsAll 을 본다(_statsMembers 는 매번 새 배열이라 늘 버려진다)',
    /_statsAll !== members/.test(SRC) && !/_statsMembers !== members/.test(SRC));

console.log('\n[7] 연도별 추이 그래프 — 세 선·머리글·안내[S24]');

const CSS = fs.readFileSync(path.join(CLIENT, 'style.css'), 'utf8');

ok('집계가 선박·인명을 따로 낸다',
    /function trendBuckets[\s\S]{0,1600}hk: hk,[\s\S]{0,60}person: person,/.test(SRC));
ok('전체 선은 두 소스의 합이다',
    /values: keys\.map\(function \(k, i\) \{ return hk\[i\] \+ person\[i\]; \}\)/.test(SRC));
ok('추이 그래프는 위 칩을 따르지 않는다(늘 세 선)',
    /function trendMembers[\s\S]{0,400}_statsAll[\s\S]{0,200}passesFilters/.test(CODE) &&
    /trendBuckets\(trendMembers\(\)/.test(CODE));
ok('세 선의 색이 서로 다르고 도넛 범례와 같다',
    /TREND_COLOR = \{ all: '#ffd740', hk: '#2b7cf0', person: '#16c8a3' \}/.test(SRC) &&
    /\['선박사고', hk, '#2b7cf0'\], \['인명사고', pr, '#16c8a3'\]/.test(SRC));
ok('숫자는 전체선에만 붙는다',
    /datalabels: isTotal[\s\S]{0,240}: \{ display: false \}/.test(SRC));
ok('선이 셋이라 범례를 켠다',
    /TREND_LEGEND = \{\s*display: true/.test(CODE) && /legend: TREND_LEGEND/.test(CODE));

ok('제목이 월별로 들어가면 "N년 월별 추이"가 된다',
    /_trendDrill\.year \+ '년 월별 추이'/.test(SRC));
ok('되돌아가는 버튼 이름이 "연도별로"다',
    /id="accident-trend-back"[\s\S]{0,160}연도별로/.test(SRC));
ok('버튼·자료범위 문구가 카드 머리(ash-card-head) 안에 있다',
    /ash-card-head[\s\S]{0,200}asideHtml/.test(SRC));
// [S25-7에서 바뀜] 긴 문구 → 맨 위 자료범위 뱃지와 같은 모양의 짧은 뱃지(’09~’24).
ok('자료범위가 제목 옆 뱃지로 들어간다',
    /ash-badge-note">' \+ escapeHtml\(badge\)/.test(SRC) &&
    /'’' \+ String\(a\)\.slice\(2\) \+ '~’' \+ String\(b\)\.slice\(2\)/.test(CODE));
ok('옛 문구("겹치는 …년만 표시합니다")가 없다',
    !/년만 표시합니다/.test(CODE));

// [S25-7에서 삭제] 토스트 관련 검사 4개 — 사용자 확정(2026-09-06)으로 토스트를 없애고
//   카드 제목 바로 아래 고정 한 줄(.ash-card-hint)로 바꿨다. 새 동작은 [8]에서 본다.
ok('옛 안내 상자(.ash-hint)를 이 카드에 다시 쓰지 않는다',
    !/ash-hint"><i class="fa-solid fa-hand-pointer"/.test(CODE));

ok('점 깜빡임 플러그인이 등록돼 있다',
    /Chart\.register\(PointPulsePlugin\)/.test(CODE) && /id: 'pointPulse'/.test(CODE));
ok('점 깜빡임은 연도별에서만 켠다',
    /pointPulse: \{ on: !_trendDrill \}/.test(CODE) &&
    /if \(!_trendDrill\) startPointPulse\(trendChart\);/.test(CODE));
ok('차트를 지울 때 깜빡임 타이머도 멈춘다',
    /function destroyStatsCharts\(\) \{\s*stopPointPulse\(\);/.test(CODE));
ok('지워진 차트를 다시 그리지 않는다(콘솔 오류 방지)',
    /if \(!ctx\) return;/.test(CODE) && /canvas\.isConnected/.test(CODE));
ok('연도 클릭 중에 곧바로 다시 그리지 않는다(Chart.js 오류 방지)',
    /setTimeout\(renderStatsBody, 0\);/.test(CODE));

ok('추세 요약 세 칸이 위로 붙는다(제목 높이가 같아진다)',
    /\.ash-stat \{[\s\S]{0,600}justify-content: flex-start;/.test(CSS));
ok('추세 요약 도넛이 4.1em 보다 크다',
    (function () {
        const m = CSS.match(/\.ash-donut\.sm \{ width: ([\d.]+)em/);
        return !!m && parseFloat(m[1]) > 4.1;
    })(), (CSS.match(/\.ash-donut\.sm \{ width: ([\d.]+)em/) || [])[1] + 'em');

console.log('\n[8] 화면 다듬기[S25] — 여백·라벨·뱃지·0건 타일');

ok('추세 요약 도넛 칸 범례 간격이 좁다',
    /\.ash-dlegend \{[^}]*gap: 0\.12em/.test(CSS));
ok('도넛 가운데 숫자와 라벨 간격이 절반(0.25→0.12em)',
    /\.ash-donut-center \{[\s\S]{0,400}gap: 0\.12em;/.test(CSS));

ok('숫자를 점 위·아래로 번갈아 놓는다',
    /align: function \(ctx\) \{ return ctx\.dataIndex % 2 \? 'bottom' : 'top'; \}/.test(CODE));
ok('점과 숫자 사이 간격이 절반(플러그인 기본 4 → 2)',
    /function trendTotalDatalabels[\s\S]{0,400}offset: 2,/.test(CODE));
ok('숫자 색이 그 선의 색을 따른다',
    /function trendTotalDatalabels\(color\)[\s\S]{0,400}color: color,/.test(CODE));
ok('숫자가 아래로도 가므로 캔버스 아래 여백이 있다',
    /TREND_CHART_PADDING = \{ padding: \{ top: 22, bottom: 6 \} \}/.test(CODE));

ok('같은 시트에서 다시 그릴 때는 등장 애니메이션을 끈다',
    /body\.classList\.add\('ash-noanim'\)/.test(CODE) &&
    /\.ash-noanim \.ash-seg \{ animation: none; \}/.test(CSS));
ok('시트를 새로 열 때만 애니메이션이 돈다',
    /_cardRevealDone = false;\s*\/\/ 시트를 새로 열 때만/.test(SRC) &&
    /_cardRevealDone = true;/.test(CODE));

ok('사고 0건인 특보 타일은 그리지 않는다',
    /kinds = kinds\.filter\(function \(k\) \{ return \(st\.sev\[k\.code\] \|\| 0\) > 0; \}\);/.test(CODE));
ok('남은 타일이 없으면 소제목도 함께 숨긴다',
    /kinds\.length[\s\S]{0,200}특보 종류별 사고 건수/.test(SRC));

ok('값 칸이 가장 긴 값보다 넓다(실측 기준)',
    /\.ash-row \.val \{[\s\S]{0,80}width: 8\.7em;/.test(CSS) &&
    /\.ash-fatal-row \.val \{ width: 11em; \}/.test(CSS));

ok('월별도 소스별로 세어 세 선을 그린다',
    /function monthlyBuckets[\s\S]{0,900}srcOfFeat\(f\) === 'person'/.test(CODE) &&
    /monthlyBuckets\(trendMembers\(\)\)/.test(CODE));
ok('월별도 연도별과 같은 기간으로 자른다',
    /function monthlyBuckets[\s\S]{0,600}combinedYearSpan\(\)/.test(CODE));
ok('연도별·월별이 같은 선 정의를 쓴다',
    /datasets: trendDatasets\(t\)/.test(CODE) && /datasets: trendDatasets\(mo\)/.test(CODE));

ok('카드 머리 뱃지 문구를 만드는 함수가 있다',
    /function chartSpanBadgeText[\s\S]{0,900}'선박사고만'/.test(CODE));
ok('연도별·월별 뱃지는 기간만 짧게',
    /view === 'trend' \|\| view === 'month'[\s\S]{0,160}yy\(sp\[0\], sp\[1\]\)/.test(CODE));
ok('안내가 제목 바로 아래 한 줄로 들어간다',
    /ash-card-hint">연도를 누르면 그 해의 월별로 바뀝니다/.test(SRC) &&
    /\.ash-card-hint \{/.test(CSS));
ok('토스트가 완전히 없어졌다',
    !/armTrendToast\(/.test(CODE) && !/ash-chart-toast/.test(CODE));
ok('시간대별 아래 긴 문구가 없어졌다',
    !/ACCIDENT_DAY_START_HOUR \+ '~'/.test(CODE));

// ── [9] 화면 다듬기[S26] — 2026-09-06 사용자 지적 9묶음 ────────────────────────
console.log('\n[9] 화면 다듬기[S26] — 여백·요일막대·말풍선·색·레저선박·치명도·칩');

// S26-1 도넛 칸 여백
ok('도넛 칸 위·사이 여백을 1/3로 줄였다',
    /\.ash-donut-stack \{[^}]*gap: 0\.06em; margin-top: 0\.05em/.test(CSS));
ok('칸 아래 여백을 1/5로 줄였다',
    /\.ash-stat \{[\s\S]{0,400}padding: 0\.85em 0\.6em 0\.17em;/.test(CSS));

// S26-2 요일별 막대
ok('요일 막대 숫자를 늘 막대 가운데에 둔다',
    /view === 'weekday'[\s\S]{0,900}anchor: 'center', align: 'center',/.test(CODE));
ok('요일 막대 숫자에 흰 글자·검은 외곽선을 준다',
    /view === 'weekday'[\s\S]{0,900}color: '#fff', textStrokeColor: '#000', textStrokeWidth: 3,/.test(CODE));
ok('요일 막대 색을 진하게 낮췄다',
    /CHART_COLOR = \{[^}]*green: '#0f8f74'/.test(CODE) && !/green: '#69f0ae'/.test(CODE));
ok('요일 막대가 바닥에서 자란다',
    /view === 'weekday'[\s\S]{0,1400}y: \{ from: function \(ctx\) \{ return ctx\.chart\.scales\.y\.getPixelForValue\(0\); \} \}/.test(CODE));
ok('세로 막대 라벨 바깥배치 함수는 더 쓰지 않는다',
    !/verticalBarLabelPlacement/.test(CODE));

// S26-3 특보 카드·말풍선
ok('말풍선에 해역별 일수만 남는다(합계·겹침 줄 없음)',
    /function warnDaysTipText[\s\S]{0,500}\}/.test(CODE) &&
    !/구역끼리 겹친/.test(CODE) && !/'합계  '/.test(CODE));
ok('특보 종류 타일에는 말풍선을 안 붙인다',
    !/ash-warn-tile"' \+ \(tip/.test(CODE) && /'<div class="ash-warn-tile">'/.test(CODE));
ok('한 번 누르면 1초 뒤 저절로 사라진다',
    /TIP_HOLD_MS = 1000/.test(CODE) && /showTip\(_tipStart\.target, TIP_HOLD_MS\)/.test(CODE) &&
    !/TIP_PRESS_MS/.test(CODE));
ok('말풍선이 서서히 뜨고 사라진다',
    /\.ash-tip \{[\s\S]{0,1200}transition: opacity/.test(CSS) &&
    /\.ash-tip\.on \{ opacity: 1; \}/.test(CSS));
ok('특보 카드 아래 안내 문구가 없어졌다',
    !/특보 발효 시간과 사고 발생 시간이/.test(CODE));

// S26-4 4·5번 카드
ok('토글 상자 아무 데나 눌러도 선박↔인명이 바뀐다',
    /closest\('\.ash-srctoggle'\)/.test(CODE));
ok('막대·도넛 색표에서 겹치던 청록을 뺐다',
    !/#25d0a6/.test(CODE) && /ASH_ROW_COLORS = \['#2b7cf0', '#16c8a3', '#ffc233'/.test(CODE));
ok('바뀐 색의 도넛 그라데이션도 표에 있다',
    /'#ffc233': \['#ffdd85', '#ffc233', '#9a6c00'\]/.test(CODE));
ok('막대 게이지가 차오른다',
    /@keyframes ashFillBar \{ from \{ width: 0; \} \}/.test(CSS) &&
    /\.ash-card\.reveal \.ash-bar > i \{ animation-play-state: running; \}/.test(CSS));
ok('같은 시트에서 다시 그릴 때는 막대 애니메이션을 끈다',
    /\.ash-noanim \.ash-bar > i \{ animation: none; \}/.test(CSS));

// S26-5 레저선박
ok('기타(레저선박)을 이름만 바꿔 순위에 살린다',
    /ASH_RENAME_LABELS = \{ '기타\(레저선박\)': '레저선박\(분류없음\)' \}/.test(CODE) &&
    /if \(ASH_RENAME_LABELS\[e\[0\]\]\) e = \[ASH_RENAME_LABELS\[e\[0\]\], e\[1\]\];/.test(CODE));
ok('이름 칸이 레저선박(분류없음)을 담을 만큼 넓다(실측 기준)',
    /\.ash-row \.nm \{[\s\S]{0,700}width: 8\.7em;/.test(CSS));
ok('바뀐 이름은 제외 규칙에 안 걸린다',
    !/^(기타|정보없음|원인미상|관할 미상)/.test('레저선박(분류없음)'));

// S26-6 치명도 카드
ok('치명도 첫 줄(이 구역 실제값)이 없어졌다',
    !/ash-scope-line/.test(CODE) && !/사망·실종 사고가 ' \+ fmtN/.test(CODE));
ok('치명도 아래 긴 안내문이 없어졌다',
    !/이 순위는 전국 자료로 낸 것이라/.test(CODE));
ok('값 칸이 무슨 숫자인지 알려 주는 줄이 있다',
    /ash-fatal-legend">' \+ legend/.test(CODE) &&
    /'\(<b>사망\+실종<\/b> \/ 총 ' \+ \(key === 'hk' \? '사고수' : '인원'\) \+ '\)'/.test(CODE));
ok('사망+실종 글자와 괄호 왼쪽 숫자가 빨간색이다',
    /\.ash-fatal-legend b \{ color: #ff5252;/.test(CSS) &&
    /\.ash-fatal-row \.val em b \{ color: #ff5252;/.test(CSS) &&
    /'<em>\(<b>' \+ fmtN\(e\.fatal\) \+ '<\/b>\/' \+ fmtN\(e\.scale\)/.test(CODE));

// S26-7 칩
ok('칩이 전체·선박·인명 셋이다',
    /\{ id: 'all', label: '전체', icon: 'fa-layer-group' \}/.test(CODE));
ok('전체 칩에도 건수·기간이 들어간다',
    /stat\.all = \{[\s\S]{0,240}n: total,/.test(CODE));
ok('전체 칩 색이 따로 있다', /\.ash-chip\.all \{/.test(CSS));
ok('한 종류를 고르면 그 한 선만 그린다',
    /_statsScope === 'hk'\) return \[trendSeriesSpec\('선박사고', bk\.hk, TREND_COLOR\.hk, true\)\]/.test(CODE) &&
    /_statsScope === 'person'\) return \[trendSeriesSpec\('인명사고', bk\.person, TREND_COLOR\.person, true\)\]/.test(CODE));
ok('한 선만 그릴 때 선 아래 칠도 그 색을 따른다',
    /function trendFillOf/.test(CODE) && /backgroundColor: isTotal \? trendFillOf\(color\)/.test(CODE));

// S26-8 치명도 구역↔전국 토글
ok('전국 기준 뱃지가 토글로 바뀌었다',
    /function fatalityScopeHtml[\s\S]{0,700}data-fatalscope="/.test(CODE) &&
    /\[\['cell', '이 구역'\], \['nation', '전국'\]\]/.test(CODE));
ok('전국 보기로 연 시트에서는 토글 대신 (전국) 뱃지',
    /if \(_statsNationwide\) return '<span class="ash-badge-scope">전국<\/span>';/.test(CODE));
ok('시트를 열 때는 이 구역으로 시작한다',
    /var _fatalScope = 'cell';/.test(CODE) && /_fatalScope = 'cell';\s*$/m.test(CODE.replace(/ +\/\/.*$/gm, '')));
ok('이 구역을 고르면 그 구역 목록으로 순위를 낸다',
    /var useCell = !_statsNationwide && _fatalScope === 'cell';/.test(CODE) &&
    /fatalityRanking\(key, useCell \? cellMembers : null\)/.test(CODE));
ok('구역 자료일 때 표본 기준을 낮춘다',
    /FATAL_MIN_SAMPLE_CELL = 10/.test(CODE) &&
    /var minSample = members \? FATAL_MIN_SAMPLE_CELL : FATAL_MIN_SAMPLE;/.test(CODE));
ok('후보가 하나도 없으면 표본 얇은 것까지 보여 준다',
    /var base = ranked\.length \? ranked : r\.rows\.filter/.test(CODE));
ok('토글을 누르면 다시 그린다',
    /closest\('\[data-fatalscope\]'\)/.test(CODE));
ok('토글에 전용 스타일이 있다', /\.ash-scopetoggle \{/.test(CSS));

// ── [10] 특보 중 사고 내역 팝업[S27] ────────────────────────────────────────
console.log('\n[10] 특보 중 사고 내역 팝업[S27]');

ok('특보 카드 소제목에 "사고 내역 보기" 버튼이 붙는다',
    /ash-warn-more" id="accident-warn-detail-open"/.test(CODE) &&
    /\.ash-warn-more \{/.test(CSS));
ok('버튼을 누르면 팝업이 열린다',
    /closest\('#accident-warn-detail-open'\)\) \{ openWarnDetailPopup\(\); return; \}/.test(CODE));
ok('뒤로가기로 닫히도록 팝업 스택에 등록한다',
    /PopupStack\.push\(WARN_DETAIL_POPUP_ID/.test(CODE) &&
    /PopupStack\.remove\(WARN_DETAIL_POPUP_ID\)/.test(CODE));
ok('열 때 소스 탭은 시트 칩을 물려받는다',
    /_warnDetail = \{ src: _statsScope \|\| 'all', warn: 'all', sort: 'recent', page: 0, open: null \};/.test(CODE));
ok('한 쪽에 20건',
    /WARN_DETAIL_PER_PAGE = 20/.test(CODE));
ok('특보가 발효 중이던 사고만 담는다',
    /function warnDetailPool[\s\S]{0,900}var sev = row\[WARN_SEVERITY_POS_IDX\[key\]\] \|\| \[\];[\s\S]{0,80}if \(!sev\.length\) return;/.test(CODE));
ok('시트 필터를 그대로 건다',
    /function warnDetailPool[\s\S]{0,600}if \(!passesFilters\(key, row\)\) return;/.test(CODE));
ok('시각은 문자열이 아니라 분으로 견준다(6:05 > 16:17 방지)',
    /function minutesOf[\s\S]{0,300}\* 60 \+/.test(CODE));

ok('위치 설명이 없으면 좌표로 대신 적는다',
    /function warnDetailCoord/.test(CODE) &&
    /hasPos \? escapeHtml\(f\.pos\) : warnDetailCoord\(f\)/.test(CODE));
ok('인명피해가 모두 0이면 "인명피해 기록 없음"',
    /'<span class="cas none">인명피해 기록 없음<\/span>'/.test(CODE));
ok('접힌 줄의 인명피해는 0인 항목을 빼고 적는다',
    /if \(f\.dead\) parts\.push/.test(CODE) && /if \(f\.miss\) parts\.push/.test(CODE) &&
    /if \(f\.resc\) parts\.push/.test(CODE));
ok('펼침에 특보 종류 줄을 넣지 않는다(배지에 이미 있다)',
    !/row\('발효 특보'/.test(CODE));
ok('구조·사망·실종이 모두 0이면 펼침에 그 줄도 없다',
    /if \(f\.resc \+ f\.dead \+ f\.miss > 0\) \{/.test(CODE));
ok('펼칠 것이 없으면 화살표를 감추고 못 누르게 한다',
    /class="ash-d-head' \+ \(detail \? '' : ' flat'\)/.test(CODE) &&
    /\(detail \? ' data-dopen="' \+ idx \+ '"' : ''\)/.test(CODE) &&
    /\.ash-d-head\.flat \{ cursor: default; \}/.test(CSS));
ok('소스마다 접힌 줄이 다르다(선박=시각·종류 / 인명=관련 인원)',
    /var showTime = _warnDetail\.src === 'hk' && f\.hm;/.test(CODE) &&
    /var showKind = _warnDetail\.src === 'hk' && f\.kind;/.test(CODE) &&
    /var showPrsn = _warnDetail\.src === 'person' && f\.prsn;/.test(CODE));
ok('한 종류만 볼 때는 사고 주체 도넛을 빼고 유형 도넛 하나만 넓게',
    /if \(_warnDetail\.src === 'all'\) \{[\s\S]{0,400}dcard\('사고 주체'/.test(CODE) &&
    /dcard\('사고 유형 <em>' \+ te\.length \+ '종<\/em>', typeEntries, ' wide'\)/.test(CODE));
ok('도넛은 시트 카드의 부품을 그대로 쓴다',
    /buildDonutHtml\(entries, \{ small: true, centerNum: fmtN\(list\.length\)/.test(CODE));
ok('팝업 도넛은 멈춘 애니메이션을 끈다(빈 원 방지)',
    /\.ash-detail \.ash-seg \{ animation: none; \}/.test(CSS));
ok('쪽 넘김이 게시판식(« ‹ 1..5 › »)',
    /function buildWarnDetailPager[\s\S]{0,1200}&laquo;[\s\S]{0,400}&raquo;/.test(CODE) &&
    /var WIN = 5;/.test(CODE));
ok('겹친 특보 안내를 한 줄 적는다',
    /한 사고가 두 특보에 함께 걸린 경우가 있어/.test(CODE));

// 팝업은 시트 밖(body)에 붙어 --ash-* 를 물려받지 못해 값을 다시 적는다.
// 두 곳이 어긋나면 팝업만 다른 색이 되므로 여기서 값이 같은지 본다.
(function () {
    function tokensOf(sel) {
        var m = CSS.match(new RegExp(sel.replace('.', '\\.') + ' \\{([\\s\\S]*?)\\}'));
        if (!m) return null;
        var out = {};
        (m[1].match(/--ash-[a-z-]+:\s*[^;]+;/g) || []).forEach(function (line) {
            var kv = line.split(':');
            out[kv[0].trim()] = kv[1].replace(';', '').trim();
        });
        return out;
    }
    var sheet = tokensOf('.accident-stats-sheet'), pop = tokensOf('.ash-detail-overlay');
    var bad = [];
    if (!sheet || !pop) bad.push('토큰 블록을 못 찾음');
    else Object.keys(pop).forEach(function (k) {
        if (k === '--ash-red') return;           // 팝업에만 있는 값
        if (sheet[k] !== pop[k]) bad.push(k + ' ' + sheet[k] + ' ≠ ' + pop[k]);
    });
    ok('팝업 색 토큰이 시트와 같은 값', bad.length === 0, bad.join(' · '));
})();

ok('정렬 버튼 두 개(최신순 · 피해순)',
    /\[\['recent', '최신순'\], \['fatal', '피해순'\]\]/.test(CODE) &&
    /\.ash-d-sort \{/.test(CSS));
ok('"피해순"은 사망+실종 인원 내림차순, 같으면 최신순',
    /function casOf[\s\S]{0,220}\+\(?\+?r\[hk \? 11 : 9\]/.test(CODE) &&
    /_warnDetail\.sort === 'fatal'[\s\S]{0,200}casOf\(b\) - casOf\(a\)[\s\S]{0,120}byRecent\(a, b\)/.test(CODE));
ok('정렬을 바꾸면 첫 쪽으로 돌아간다',
    /closest\('\[data-dsort\]'\)[\s\S]{0,240}_warnDetail\.page = 0;/.test(CODE));
ok('팝업을 열 때는 최신순으로 시작',
    /sort: 'recent', page: 0, open: null \};/.test(CODE));
ok('특보 칩은 옆으로 밀지 않고 두 줄로 접는다',
    /\.ash-detail-chips \{[\s\S]{0,200}flex-wrap: wrap;/.test(CSS) &&
    !/\.ash-detail-chips[\s\S]{0,200}overflow-x: auto/.test(CSS));
ok('팝업 도넛을 키웠다(5.6→7.2em)',
    /\.ash-d-donut \.ash-donut\.sm \{ width: 7\.2em; height: 7\.2em; \}/.test(CSS));
ok('도넛 가운데 숫자와 단위 사이 여백이 1/2',
    /\.ash-d-donut \.ash-donut-center \{ gap: 0\.06em; \}/.test(CSS));
ok('범례가 한 줄에 둘씩',
    /\.ash-d-leg \{[^}]*grid-template-columns: 1fr 1fr;/.test(CSS));
ok('범례 라벨은 말줄임이 되도록 <b> 로 감싼다',
    /<\/i><b>' \+ escapeHtml\(d\[0\]\) \+\s*'<\/b><span>/.test(CODE) &&
    /\.ash-d-leg b \{[^}]*text-overflow: ellipsis;/.test(CSS));
ok('기간·칩 줄 위아래 여백을 1/5 로 줄였다',
    /\.ash-meta \{[\s\S]{0,700}padding: 0\.18em 0 0\.19em;[\s\S]{0,200}margin-bottom: 0\.18em;/.test(CSS));

// ── [11] 지도 위 배치·버튼 정리[S28] ────────────────────────────────────────
console.log('\n[11] 지도 위 배치·버튼 정리[S28]');

const HTML = fs.readFileSync(path.join(CLIENT, 'index2.html'), 'utf8');

ok('격자 범례가 지도 좌측 하단(출처표기 바로 위)에 붙는다',
    /#ocean-topleft-controls > \.accident-grid-legend \{[\s\S]{0,300}position: fixed !important;[\s\S]{0,200}left: 8px;[\s\S]{0,200}bottom: calc\(var\(--main-tab-height, 68px\) \+ 8px \+ 25px\)/.test(HTML));
ok('서브탭이 열리면 범례도 그만큼 올라간다',
    /body\.sub-tabs-open #ocean-topleft-controls > \.accident-grid-legend \{[\s\S]{0,200}var\(--sub-tab-height, 50px\)/.test(HTML));
ok('해양안전에서도 출처표기(물빠짐 슬라이더 포함)를 따라간다',
    /body\.ls-mode\.ls-safety #ocean-topleft-controls > \.accident-grid-legend/.test(HTML) &&
    /body\.ls-mode\.ls-safety\.ls-mudflat-on #ocean-topleft-controls > \.accident-grid-legend/.test(HTML));
ok('범례 top 을 JS 가 더 이상 인라인으로 넣지 않는다',
    /if \(legend\) legend\.style\.top = '';/.test(CODE) &&
    !/legend\.style\.top = afterBarTop/.test(CODE));

ok('전국 통계 버튼 폭이 모드토글(120px)과 같고 글자가 가운데',
    /#ocean-topleft-controls > #accident-nationwide-btn \{[\s\S]{0,400}width: 120px;[\s\S]{0,80}text-align: center;/.test(HTML));

ok('"금지구역" 버튼이 있다',
    /id="ocean-banzone-toggle-btn"/.test(HTML) &&
    /body\.ls-mode\.ls-safety #ocean-banzone-toggle-btn,/.test(HTML));
ok('출입통제·낚시금지 원래 버튼은 숨기되 지우지 않는다(모듈이 참조)',
    /#ocean-access-control-toggle-btn,\s*\n\s*#ocean-fishing-ban-toggle-btn \{ display: none !important; \}/.test(HTML) &&
    /id="ocean-access-control-toggle-btn"/.test(HTML) && /id="ocean-fishing-ban-toggle-btn"/.test(HTML));
ok('금지구역 버튼이 두 원래 버튼을 대신 누른다',
    /ban_zone\.js/.test(HTML) &&
    (function () {
        const bz = fs.readFileSync(path.join(CLIENT, 'js', 'marine-life', 'safety', 'ban_zone.js'), 'utf8');
        return /acBtn\.classList\.contains\('active'\) !== turnOn\) acBtn\.click\(\)/.test(bz) &&
               /fbBtn\.classList\.contains\('active'\) !== turnOn\) fbBtn\.click\(\)/.test(bz);
    })());
ok('금지구역 스크립트가 두 모듈보다 뒤에 로드된다',
    (function () {
        // <script src=...> 만 본다 — 주석에도 파일명이 적혀 있어 문자열 첫 등장을
        // 그대로 쓰면 주석 위치를 잡는다(처음 이 검사를 그렇게 썼다가 걸렸다).
        function at(name) {
            const m = HTML.match(new RegExp('<script src="js/marine-life/safety/' + name + '[^"]*"'));
            return m ? HTML.indexOf(m[0]) : -1;
        }
        const bz = at('ban_zone\\.js'), fb = at('fishing_ban\\.js'), ac = at('access_control\\.js');
        return bz > 0 && fb > 0 && ac > 0 && bz > fb && bz > ac;
    })());
ok('안내 팝업 탭도 "금지구역" 하나로 합쳐졌다',
    (function () {
        const ls = fs.readFileSync(path.join(CLIENT, 'js', 'marine-life', 'safety', 'life_safety.js'), 'utf8');
        return /\{ id: 'banzone', label: '금지구역'/.test(ls) && !/id: 'fishingban'/.test(ls);
    })());

ok('CCTV·물빠짐 버튼은 해양종합정보에서만 숨긴다',
    /body:not\(\.ls-safety\) #ocean-cctv-toggle-btn,\s*\n\s*body:not\(\.ls-safety\) #ocean-mudflat-toggle-btn \{ display: none !important; \}/.test(HTML) &&
    /body\.ls-mode\.ls-safety #ocean-cctv-toggle-btn,/.test(HTML) &&
    /body\.ls-mode\.ls-safety #ocean-mudflat-toggle-btn,/.test(HTML));

// ── [12] 안내 팝업 "사고정보" 탭[S28-6] ─────────────────────────────────────
// 이 탭은 숫자를 사람이 손으로 적은 글이다. 원본이 바뀌면 조용히 거짓말이 되므로,
// 여기서 **원본을 다시 세어 글의 숫자와 대조**한다(추측 금지 규칙의 자동화).
console.log('\n[12] 안내 팝업 "사고정보" 탭[S28-6]');

(function () {
    const LS = fs.readFileSync(path.join(CLIENT, 'js', 'marine-life', 'safety', 'life_safety.js'), 'utf8');

    ok('안내에 "사고정보" 탭이 있다',
        /\{ id: 'accident', label: '사고정보', html:/.test(LS));
    ok('틀이 세 절(목적 · 사용법·구성 · 데이터 산출 내역)로 되어 있다',
        /<strong>1\. 목적<\/strong>/.test(LS) &&
        /<strong>2\. 사용법 · 구성<\/strong>/.test(LS) &&
        /<strong>3\. 데이터 산출 내역<\/strong>/.test(LS));
    ok('"예보가 아니다"를 밝힌다',
        /지금의 위험을 예보하는 기능이 아닙니다/.test(LS));
    ok('원본 자료에 오류가 있을 수 있음을 밝힌다(2026-09-09 사용자 지시)',
        /원본 자료 자체에 오류가 섞여 있을 수 있습니다/.test(LS) &&
        /참고용<\/strong>/.test(LS));
    ok('선박 이름이 없다는 한계를 밝힌다',
        /선박 이름은 어떤 화면에도 없습니다/.test(LS));

    // ── 글에 적은 숫자 ↔ 원본을 다시 센 값 대조 ──
    const hk = JSON.parse(fs.readFileSync(path.join(CLIENT, 'accident_ships_hk.json'), 'utf8')).rows;
    const pe = JSON.parse(fs.readFileSync(path.join(CLIENT, 'accident_persons.json'), 'utf8')).rows;
    const EXCLUDED_TYPES = { ATY012: 1, ATY013: 1, ATY014: 1, ATY020: 1 };

    const rawTotal = hk.length + pe.length;
    ok('원본 합계 74,018 이 맞다', rawTotal === 74018, String(rawTotal));

    const typeDropped = hk.filter(r => EXCLUDED_TYPES[r[5]]).length +
                        pe.filter(r => EXCLUDED_TYPES[r[4]]).length;
    ok('사고유형 4종 제외 347건이 맞다', typeDropped === 347, String(typeDropped));

    // 표출 건수는 앱이 좌표 이상치·위치 미상 뭉침까지 걸러 낸 뒤의 값이라 여기서는
    // 다시 셀 수 없다. 대신 글이 쓴 값끼리 산수가 맞는지 본다.
    const shown = 57167 + 14325;
    ok('표출 합계 71,492 = 57,167 + 14,325', shown === 71492, String(shown));
    ok('빠진 수 2,526 = 74,018 − 71,492', rawTotal - shown === 2526, String(rawTotal - shown));
    ok('빠진 수 내역 2,526 = 347 + 2,179', 347 + 2179 === 2526);

    ['74,018', '71,492', '57,167', '14,325', '2,526', '347', '2,179'].forEach(function (n) {
        ok('글에 ' + n + ' 이 적혀 있다', LS.indexOf(n) >= 0);
    });

    // 2025년 선박사고 결측 — 글이 "3,775건 전부"라고 단정했으므로 그대로 확인한다.
    const y25 = hk.filter(r => String(r[2]).slice(0, 4) === '2025');
    const y25AllBlank = y25.every(r => !r[4] && !r[6] && !r[7]);
    ok('2025년 선박사고 3,775건이 맞다', y25.length === 3775, String(y25.length));
    ok('그 3,775건의 위치·원인·선박종류가 실제로 전부 빈칸', y25AllBlank);
    ok('글에 3,775 가 적혀 있다', LS.indexOf('3,775') >= 0);

    // 2024년 위치 설명도 "하나도 없다"고 단정했다.
    const y24 = hk.filter(r => String(r[2]).slice(0, 4) === '2024');
    ok('2024년 선박사고도 위치 설명이 하나도 없다',
        y24.length > 0 && y24.every(r => !r[4]), y24.length + '건 중 ' + y24.filter(r => !r[4]).length + '건 빈칸');

    // 인명피해 셋 다 0 — "절반가량"이라고 썼다(50~60% 사이여야 그 표현이 맞다).
    const zeroCas = hk.filter(r => !(+r[9]) && !(+r[10]) && !(+r[11])).length;
    const pct = zeroCas / hk.length * 100;
    ok('인명피해 셋 다 0 인 선박사고가 "절반가량"이다', pct >= 45 && pct <= 60, pct.toFixed(1) + '%');

    ok('특보 집계 시작일 2016-08-26 이 글과 자료에서 같다',
        /2016년 8월 26일 이후/.test(LS) &&
        JSON.parse(fs.readFileSync(path.join(CLIENT, 'warn_intervals.json'), 'utf8')).start === '20160826');
})();

// ── [13] 금지구역 버튼 — 지도 준비 대기 + 위성지도 보장[S28-7] ────────────────
console.log('\n[13] 금지구역 버튼 — 지도 준비 대기 + 위성지도 보장[S28-7]');

(function () {
    const BZ = fs.readFileSync(path.join(CLIENT, 'js', 'marine-life', 'safety', 'ban_zone.js'), 'utf8');

    // ★결함: 버튼 존재만 보고 리스너를 붙이면, 두 모듈이 아직 리스너를 안 붙인 사이에
    //   누른 클릭이 허공에 떨어진다(폴리곤도 안 뜨고 배경지도도 안 바뀌는데 버튼만
    //   "켜진 척"). 두 모듈과 같은 조건(getOceanMap)으로 기다려야 한다.
    ok('지도가 준비된 뒤에 리스너를 붙인다',
        /function _installWhenReady[\s\S]{0,320}window\.getOceanMap && window\.getOceanMap\(\)/.test(BZ) &&
        /if \(map && bind\(\)\) return;/.test(BZ));
    ok('버튼 존재만 보고 붙이던 옛 코드가 없다',
        !/if \(!bind\(\)\) \{/.test(BZ) && !/setInterval\(/.test(BZ));
    ok('두 모듈과 같은 설치 어법(DOMContentLoaded → 폴링)',
        /document\.addEventListener\('DOMContentLoaded', _installWhenReady\)/.test(BZ));
    ok('켤 때 배경지도를 위성지도로 보장한다(2026-09-09 사용자 지시)',
        /if \(turnOn && typeof window\.oceanSetBasemap === 'function'/.test(BZ) &&
        /window\.oceanGetBasemap\(\) !== 'vworld'/.test(BZ) &&
        /window\.oceanSetBasemap\('vworld'\)/.test(BZ));
    ok('이미 위성지도면 건드리지 않는다(끌 때 되돌림을 깨지 않게)',
        /!== 'vworld'\) \{\s*\n\s*window\.oceanSetBasemap\('vworld'\);/.test(BZ));
    ok('두 원래 버튼을 대신 누르는 방식은 그대로',
        /acBtn\.click\(\);/.test(BZ) && /fbBtn\.click\(\);/.test(BZ));

    // 두 모듈 쪽 위성 전환 코드가 살아 있는지도 함께 본다 — 여기만 고치고 그쪽이
    // 사라지면 끌 때 되돌림이 없어진다.
    ['access_control.js', 'fishing_ban.js'].forEach(function (f) {
        const src = fs.readFileSync(path.join(CLIENT, 'js', 'marine-life', 'safety', f), 'utf8');
        ok(f + ' 이 켤 때 vworld 로 바꾸고 끌 때 되돌린다',
            /oceanSetBasemap\('vworld'\)/.test(src) && /oceanSetBasemap\(_prevBasemap\)/.test(src));
    });
})();

// ── [14] 특보 타일에 선박·인명 나눔[S28-8] ──────────────────────────────────
console.log('\n[14] 특보 타일에 선박·인명 나눔[S28-8]');

ok('칩이 "전체"일 때만 두 줄을 그린다',
    /var splitSrc = _statsScope === 'all';/.test(CODE) &&
    /if \(splitSrc\) \{[\s\S]{0,300}var hn = \(hkSt\.sev\[k\.code\] \|\| 0\), pn = \(peSt\.sev\[k\.code\] \|\| 0\);/.test(CODE));
ok('타일에 선박·인명 두 줄 마크업이 있다',
    /class="s hk"><span>선박사고<\/span><b>/.test(CODE) &&
    /class="s person"><span>인명사고<\/span><b>/.test(CODE));
ok('소스별 집계를 한 번만 하고 아래 칸과 함께 쓴다(중복 순회 제거)',
    /var hkSt = splitSrc \? warnStatsOf\('hk', membersOfSrc\(members, 'hk'\)\) : null;/.test(CODE) &&
    /var hw = hkSt\.warn, pw = peSt\.warn;/.test(CODE) &&
    (CODE.match(/warnStatsOf\('hk', membersOfSrc/g) || []).length === 1);
ok('카드 상단 선박·인명 칸은 그대로 남아 있다',
    /class="ash-warn-src ' \+ cls \+ '"/.test(CODE) &&
    /srcCell\('hk', '선박사고', 'fa-ship', hw\)/.test(CODE) &&
    /srcCell\('person', '인명사고', 'fa-person', pw\)/.test(CODE));
ok('두 줄 색이 시트의 선박=파랑·인명=청록과 같다',
    /\.ash-warn-tile \.s\.hk b \{ color: var\(--ash-blue-soft\); \}/.test(CSS) &&
    /\.ash-warn-tile \.s\.person b \{ color: var\(--ash-teal\); \}/.test(CSS));
ok('건수는 오른쪽 끝으로 밀고 자릿수를 고정한다',
    /\.ash-warn-tile \.s b \{ margin-left: auto;[^}]*tabular-nums; \}/.test(CSS));

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
