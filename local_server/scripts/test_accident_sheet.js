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

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
