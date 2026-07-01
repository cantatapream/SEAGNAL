/**
 * test_location_alert_zonematch.js — 구역명 정규화(canonZone) 매칭·정합성 검증 (BUG A)
 * 실행: node local_server/scripts/test_location_alert_zonematch.js
 *
 * [배경] 지도 폴리곤명(warn_zones.geojson properties.name)과 크롤러/스냅샷의 표준 구역명은
 *   공백·구분자('·'/'.')만 다르다(예: '제주도 남쪽 바깥먼바다' vs '제주도남쪽바깥먼바다',
 *   '인천.경기남부앞바다' vs '인천·경기남부앞바다'). 폴리곤명→스냅샷 조회가 이 차이로 빗나가
 *   특보구역이 무특보(none)로 오판정되고, 경보가 위험 해역을 안전 해역으로 안내하던
 *   안전-치명 버그(BUG A)를 canonZone 정규화로 해소했다.
 *
 * 검증:
 *   (0) 로드: 폴리곤 44개, 표준 구역명 집합 비어있지 않음, canonZone export.
 *   (1) 44개 폴리곤명 전부가 canonZone 을 거쳐 크롤러 표준 구역명 집합에 매칭(0 mismatch).
 *   (2) canonZone 이 폴리곤명 간 충돌을 만들지 않음(0 collision).
 *   (3) canonZone 순수성/규칙(공백 제거, '.'→'·', 이미 표준형 불변, null/undefined→'').
 *   (4) decideAlert 정합성(adversarial): 사용자가 주의보 구역에 있고, 지리적 최근접 이웃이
 *       '경보(severe)'인데 스냅샷 키는 무공백형, 지도 폴리곤명은 공백형일 때 —
 *       정규화 덕분에 그 warned 이웃이 '최근접 특보 미발표(clear)' 로 오선택되지 않는지.
 *       정규화가 없었던 OLD 로직에서는 tier='none' 오판정 → warned 이웃이 nearestClear 로
 *       선택되어 위험 해역으로 안내되던 버그를 재현·방지 확인.
 *   (5) 대조군: 이웃이 실제 무특보이면 최근접 무특보 안내가 정상 유지(정규화가 정상 매칭을 깨지 않음).
 */
'use strict';
const fs = require('fs');
const path = require('path');

global.LocationAlertCore = require('../js/location_alert_core.js');
const RT = require('../js/location_alert_runtime.js');
const core = global.LocationAlertCore;
const canonZone = core.canonZone;

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} ${extra != null ? extra : ''}`); }
}

// ── 크롤러 표준 구역명 집합 로드 ──────────────────────────────────────────────
//   weather_alerts_crawler.js 는 외부 의존성(@google/genai 등)으로 require 불가 →
//   소스 텍스트에서 앞바다/먼바다로 끝나는 인용 문자열을 수집한다. 자식 구역
//   (…앞바다중…/연안바다/평수구역)은 제외 — 메인 구역명(및 그룹명) 상위집합을 얻는다.
function loadCanonicalZoneNames() {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'weather_alerts_crawler.js'), 'utf8');
    const set = new Set();
    const re = /['"]([^'"]*(?:앞바다|먼바다))['"]/g;
    let m;
    while ((m = re.exec(src))) {
        const n = m[1];
        if (/(?:앞바다|먼바다)중/.test(n) || /연안바다|평수구역/.test(n)) continue;
        set.add(n);
    }
    return set;
}

const canonicalNames = loadCanonicalZoneNames();
const canonicalSet = new Set([...canonicalNames].map(canonZone));

const gj = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'assets', 'warn_zones.geojson'), 'utf8'));
const features = gj.features;
const polyNames = features.map(f => f.properties.name);

console.log('[0] 로드');
check('폴리곤명 44개', polyNames.length === 44, polyNames.length);
check('표준 구역명 집합 비어있지 않음', canonicalSet.size > 0, canonicalSet.size);
check('canonZone export 됨', typeof canonZone === 'function');

console.log('\n[1] 폴리곤명 → canonZone → 표준 구역명 매칭 (0 mismatch)');
let mismatch = 0;
const misses = [];
for (const p of polyNames) {
    const c = canonZone(p);
    if (!canonicalSet.has(c)) { mismatch++; misses.push(`${JSON.stringify(p)} -> ${JSON.stringify(c)}`); }
}
check(`전체 ${polyNames.length}개 폴리곤명 매칭 (mismatch=${mismatch})`, mismatch === 0, misses.join(' | '));

console.log('\n[2] canonZone collision-free (0 collision)');
let collision = 0;
const cols = [];
const seen = new Map();
for (const p of polyNames) {
    const c = canonZone(p);
    if (seen.has(c) && seen.get(c) !== p) { collision++; cols.push(`${seen.get(c)} & ${p} -> ${c}`); }
    else seen.set(c, p);
}
check(`collision=${collision}`, collision === 0, cols.join(' | '));

console.log('\n[3] canonZone 순수성/규칙');
check('공백 제거: "제주도 남쪽 바깥먼바다"→"제주도남쪽바깥먼바다"',
    canonZone('제주도 남쪽 바깥먼바다') === '제주도남쪽바깥먼바다', canonZone('제주도 남쪽 바깥먼바다'));
check('마침표→중점: "인천.경기남부앞바다"→"인천·경기남부앞바다"',
    canonZone('인천.경기남부앞바다') === '인천·경기남부앞바다', canonZone('인천.경기남부앞바다'));
check('이미 canonical 이면 그대로: "인천·경기남부앞바다"',
    canonZone('인천·경기남부앞바다') === '인천·경기남부앞바다', canonZone('인천·경기남부앞바다'));
check('이미 표준형 불변: "제주도북부앞바다"', canonZone('제주도북부앞바다') === '제주도북부앞바다');
check('null/undefined → ""', canonZone(null) === '' && canonZone(undefined) === '');

// ── decideAlert 헬퍼: 구역 내부점 ────────────────────────────────────────────
function interiorPointOf(feature) {
    const geom = feature.geometry;
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    for (const poly of polys) {
        const ext = poly[0];
        let sx = 0, sy = 0; ext.forEach(p => { sx += p[0]; sy += p[1]; });
        const c = [sx / ext.length, sy / ext.length];
        if (core.pointInGeometry(c, core.seaGeometry(feature))) return c;
        for (let i = 0; i < ext.length - 1; i++) {
            const mid = [(ext[i][0] + c[0]) / 2, (ext[i][1] + c[1]) / 2];
            if (core.pointInGeometry(mid, core.seaGeometry(feature))) return mid;
        }
    }
    return null;
}

// ── [4] BUG A 재현 방지(adversarial): 공백 폴리곤명 이웃(경보)이 '무특보'로 오선택되지 않음 ──
//   사용자 '경북남부앞바다'(주의보)의 지리적 최근접 이웃은 '동해남부 북쪽 안쪽먼바다'(공백 폴리곤명).
//   스냅샷은 canonical 무공백 키('동해남부북쪽안쪽먼바다')로 그 이웃을 severe(경보)로 표기.
//   정규화가 없으면 tierOfZone 이 'none' → 그 warned 이웃이 nearestClear 로 선택되어
//   위험 해역으로 안내됨(치명적). 정규화가 있으면 절대 선택되지 않아야 한다.
console.log('\n[4] decideAlert(adversarial): 공백명 warned 이웃이 nearestClear 로 오선택되지 않음 (BUG A)');
const USER = '경북남부앞바다';
const NEIGHBOR_POLY = '동해남부 북쪽 안쪽먼바다';       // 지도 폴리곤명(공백)
const NEIGHBOR_KEY = canonZone(NEIGHBOR_POLY);          // 스냅샷/크롤러 키(무공백)
check('테스트 전제: 이웃 폴리곤명에 공백 존재', /\s/.test(NEIGHBOR_POLY));
check('테스트 전제: canonZone 이 공백 제거', NEIGHBOR_KEY === '동해남부북쪽안쪽먼바다', NEIGHBOR_KEY);

const userF = features.find(f => f.properties.name === USER);
const neighborF = features.find(f => f.properties.name === NEIGHBOR_POLY);
check('테스트 대상 구역 존재(user & neighbor)', !!userF && !!neighborF,
    (userF ? '' : 'user missing ') + (neighborF ? '' : 'neighbor missing'));
const upt = interiorPointOf(userF);
check('사용자 구역 내부점 계산됨', !!upt);

// 스냅샷: 사용자=주의보(advisory), 이웃=경보(severe) — 이웃은 무공백 canonical 키로만 등록.
const snapshot = {
    zones: {
        [USER]: { warnType: '풍랑', level: '주의보', event: 'active', tier: 'advisory' },
        [NEIGHBOR_KEY]: { warnType: '태풍', level: '경보', event: 'active', tier: 'severe' },
    },
};
const msg = RT.decideAlert({ lat: upt[1], lng: upt[0], accuracyM: 30 }, features, snapshot);
check('메시지 생성됨(사용자 구역=주의보)', !!msg, msg && msg.title);
check('판정 구역이 사용자 구역', msg && msg.zone === USER, msg && msg.zone);
check('사용자 구역 tier=advisory', msg && msg.tier === 'advisory', msg && msg.tier);
// 핵심(adversarial): warned 이웃(공백 폴리곤명)이 '최근접 특보 미발표 해역' 줄에 나타나면 안 됨.
check('warned 이웃이 nearestClear(무특보)로 선택되지 않음',
    !!msg && !msg.body.includes(NEIGHBOR_POLY),
    msg && msg.body);

// OLD 로직 재현: 정규화 없이 조회하면 warned 이웃이 'none'으로 오판정됨을 명시 증명.
//   (정규화 인덱스를 쓰지 않고 원본 스냅샷 키만 조회하는 예전 tierOfZone 을 흉내낸다.)
const oldTierOf = (name) => {
    const z = snapshot.zones[name];       // 정규화 없음 — 공백 폴리곤명은 절대 매칭 안 됨
    return (z && z.tier) || 'none';
};
check('OLD 로직 증명: 정규화 없으면 공백 이웃이 none 으로 오판정',
    oldTierOf(NEIGHBOR_POLY) === 'none' && canonZone(NEIGHBOR_POLY) in snapshot.zones,
    'oldTier=' + oldTierOf(NEIGHBOR_POLY));

// ── [5] 대조군: 이웃이 실제 무특보이면 정상 안내 유지 ─────────────────────────
console.log('\n[5] 대조: 이웃 무특보이면 정상 안내 유지(정규화가 정상 매칭을 깨지 않음)');
const snapshot2 = { zones: { [USER]: { warnType: '풍랑', level: '주의보', event: 'active', tier: 'advisory' } } };
const msg2 = RT.decideAlert({ lat: upt[1], lng: upt[0], accuracyM: 30 }, features, snapshot2);
check('사용자 자기 구역(정확 일치)은 여전히 판정됨', !!msg2 && msg2.zone === USER, msg2 && msg2.zone);
check('최근접 무특보 해역 안내가 존재', !!msg2 && /최근접 특보 미발표 해역/.test(msg2.body));

// ── 결과 ─────────────────────────────────────────────────────────────────────
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
console.log(`[요약] mismatch=${mismatch}, collision=${collision}, polygons=${polyNames.length}`);
if (fail > 0) process.exit(1);
