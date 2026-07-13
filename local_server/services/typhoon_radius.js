/**
 * ============================================================================
 * 파일명: services/typhoon_radius.js
 * 역할 : "내 위치"가 태풍의 (비대칭) 강풍/폭풍반경에 언제 처음 드는지 판정하는
 *        순수 로직 모듈. 관리자 "위치기반 반경 시연" 전용.
 * ============================================================================
 *
 * [이 파일을 한 줄로 말하면]
 *   "고정 위치 + 통보문 프레임들을 받아, 가장 이른 강풍/폭풍반경 진입 프레임을 찾아준다."
 *
 * [왜 순수 함수인가]
 *   - 인터넷/파일 접근 없음. 입력 → 출력만. node 로 단독 단위테스트 가능
 *     (파일 하단에 합성 데이터 자체검증 포함. `node services/typhoon_radius.js` 로 실행).
 *
 * [앱과 동일한 비대칭 반경 수식]
 *   - js/ocean_typhoon.js 437~468행(DIR16_DEG/dirToDeg/angDiff/radAt)과 동일하게 구현.
 *   - 중심→내위치 방위(brng)에서의 반경 radAt 이 중심→내위치 거리(하버사인) 이상이면 "진입".
 *
 * [프레임 형태]
 *   { time:"YYYYMMDDHHmm", lat, lon,
 *     radStrong, radStrongS, radStrongD,   // 강풍: 장반경/단반경/단반경방위(16방위 문자)
 *     radStorm,  radStormS,  radStormD }   // 폭풍: 동일
 *
 * [공개 함수]
 *   radiusEntry(loc, frames, which) → { time, frame } | null
 *
 * [사용처]
 *   단말 런타임(js/location_alert_typhoon_runtime.js) 및 네이티브 TyphoonRadiusDecider —
 *   위치기반 태풍 반경 알림 판정.
 * ============================================================================
 */
'use strict';

// 16방위 → 각도(deg). (앱 js/ocean_typhoon.js 와 동일)
const DIR16_DEG = { N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5, S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 };

function dirToDeg(d) {
    if (d == null) return null;
    var v = DIR16_DEG[String(d).trim().toUpperCase()];
    return v == null ? null : v;
}

// 두 방위(deg)의 최소 각도 차(0~180)
function angDiff(a, b) {
    var x = Math.abs(a - b) % 360;
    return x > 180 ? 360 - x : x;
}

// 방위(brngDeg)에서의 (비대칭) 반경 — ed(가항측,0°)→rShort, 반대(위험측,180°)→rLong 코사인 보간.
function radAt(rLong, rShort, edDeg, brngDeg) {
    if (edDeg == null || rShort == null || !(rShort > 0) || rShort >= rLong) return rLong;
    var s = (1 - Math.cos(Math.PI * angDiff(brngDeg, edDeg) / 180)) / 2; // 0..1 S-커브
    return rShort + (rLong - rShort) * s;
}

// 하버사인 거리(km)
function haversineKm(lat1, lon1, lat2, lon2) {
    var R = 6371.0088;
    var toRad = function (x) { return x * Math.PI / 180; };
    var dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 초기 방위각(deg, 0~360): from(lat1,lon1) → to(lat2,lon2)
function bearingDeg(lat1, lon1, lat2, lon2) {
    var toRad = function (x) { return x * Math.PI / 180; };
    var la1 = toRad(lat1), la2 = toRad(lat2), dLon = toRad(lon2 - lon1);
    var y = Math.sin(dLon) * Math.cos(la2);
    var x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// 시각 문자열("YYYYMMDDHHmm") → 정렬용 정수. 숫자만 추출해 수치 비교(자릿수 보존 시 사전식과 동일하나 더 견고).
function timeKey(t) {
    var s = String(t == null ? '' : t).replace(/[^0-9]/g, '');
    return s ? parseInt(s, 10) : NaN;
}

/**
 * 가장 이른 (강풍/폭풍)반경 진입 프레임을 찾는다.
 * @param {{lat:number, lon:number}} loc 내 위치(고정)
 * @param {Array} frames 통보문 프레임들(time/lat/lon/rad*)
 * @param {'strong'|'storm'} which 강풍/폭풍 구분
 * @returns {{time:string, frame:object}|null}
 */
function radiusEntry(loc, frames, which) {
    if (!loc || typeof loc.lat !== 'number' || typeof loc.lon !== 'number') return null;
    if (!Array.isArray(frames) || frames.length === 0) return null;

    var rLongKey = which === 'storm' ? 'radStorm' : 'radStrong';
    var rShortKey = which === 'storm' ? 'radStormS' : 'radStrongS';
    var rDirKey = which === 'storm' ? 'radStormD' : 'radStrongD';

    // time(문자열 YYYYMMDDHHmm) 오름차순 정렬 — 원본 배열 비파괴 복사 후 정렬(NaN 은 뒤로).
    var sorted = frames.slice().sort(function (a, b) {
        var ta = timeKey(a && a.time), tb = timeKey(b && b.time);
        if (isNaN(ta) && isNaN(tb)) return 0;
        if (isNaN(ta)) return 1;
        if (isNaN(tb)) return -1;
        return ta - tb;
    });

    for (var i = 0; i < sorted.length; i++) {
        var f = sorted[i];
        if (f == null || f.lat == null || f.lon == null) continue;
        var rLong = f[rLongKey];
        if (rLong == null || !(rLong > 0)) continue; // 반경 없으면 판정 불가
        var rShort = f[rShortKey];
        var edDeg = dirToDeg(f[rDirKey]);
        var dist = haversineKm(f.lat, f.lon, loc.lat, loc.lon);
        var brng = bearingDeg(f.lat, f.lon, loc.lat, loc.lon);
        var r = radAt(rLong, rShort, edDeg, brng);
        if (r >= dist) return { time: f.time, frame: f };
    }
    return null;
}

// [Phase 2a] UMD 표출 — Node(require)에선 module.exports, 브라우저(<script>)에선 window.TyphoonRadius.
//   기존 require 소비자/자체검증에 영향 없는 비파괴적 추가(브라우저엔 module 이 없으므로 가드).
var _TyphoonRadius = {
    DIR16_DEG: DIR16_DEG,
    dirToDeg: dirToDeg,
    angDiff: angDiff,
    radAt: radAt,
    haversineKm: haversineKm,
    bearingDeg: bearingDeg,
    radiusEntry: radiusEntry
};
if (typeof module !== 'undefined' && module.exports) { module.exports = _TyphoonRadius; }
if (typeof window !== 'undefined') { window.TyphoonRadius = _TyphoonRadius; }

// ---------------------------------------------------------------------------
// 합성 단위테스트 (이 파일을 직접 실행할 때만: `node services/typhoon_radius.js`)
//   - require 로 불러올 때(서버/라우트)는 실행되지 않는다.
// ---------------------------------------------------------------------------
if (typeof require !== 'undefined' && require.main === module) {
    var fails = 0, n = 0;
    function ok(cond, msg) { n++; if (!cond) { fails++; console.error('  [FAIL] ' + msg); } else { console.log('  [PASS] ' + msg); } }
    function eq(a, b, msg) { ok(a === b, msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

    var LOC = { lat: 30.345, lon: 130.625 };

    // (T1) 헬퍼 기본 검증
    eq(dirToDeg('SW'), 225, 'dirToDeg(SW)=225');
    eq(dirToDeg('n'), 0, 'dirToDeg(n)=0 (대소문자 무시)');
    eq(dirToDeg('XX'), null, 'dirToDeg(unknown)=null');
    eq(angDiff(350, 10), 20, 'angDiff(350,10)=20');
    eq(angDiff(0, 180), 180, 'angDiff(0,180)=180');
    // radAt: 단반경 없으면 장반경 그대로
    eq(radAt(100, null, null, 90), 100, 'radAt(장반경만)=장반경');
    // radAt: 가항측(edDeg) 방향이면 단반경, 반대면 장반경, 90°에서 중간
    eq(radAt(100, 20, 0, 0), 20, 'radAt 가항측(0°)=단반경');
    eq(radAt(100, 20, 0, 180), 100, 'radAt 위험측(180°)=장반경');
    ok(Math.abs(radAt(100, 20, 0, 90) - 60) < 1e-9, 'radAt 90°=중간(~60)');

    // 하버사인/방위 sanity: 같은 위치면 거리 0
    ok(haversineKm(LOC.lat, LOC.lon, LOC.lat, LOC.lon) < 1e-6, 'haversine 같은점=0');

    // (T2) 가까운 프레임 = 진입 / 먼 프레임 = 미진입
    //   - 프레임 중심을 LOC 와 동일하게 두면 거리 0 → 어떤 반경이든 진입.
    var near = { time: '202606011200', lat: 30.345, lon: 130.625, radStrong: 300, radStrongS: 150, radStrongD: 'SW' };
    var far = { time: '202606010000', lat: 10.0, lon: 110.0, radStrong: 100, radStrongS: 50, radStrongD: 'SW' };
    var r1 = radiusEntry(LOC, [near, far], 'strong');
    ok(r1 && r1.time === '202606011200', 'near 프레임 강풍반경 진입');

    var r2 = radiusEntry(LOC, [far], 'strong');
    eq(r2, null, 'far 단독 프레임 미진입(null)');

    // (T3) "가장 이른" 진입 프레임 반환 — 두 진입 프레임 중 더 이른 time
    var early = { time: '202606010600', lat: 30.345, lon: 130.625, radStorm: 200, radStormS: 100, radStormD: 'N' };
    var late = { time: '202606011800', lat: 30.345, lon: 130.625, radStorm: 200, radStormS: 100, radStormD: 'N' };
    // 입력 순서를 일부러 뒤섞어 정렬 동작 확인
    var r3 = radiusEntry(LOC, [late, early], 'storm');
    ok(r3 && r3.time === '202606010600', '가장 이른 진입 프레임 반환(정렬 동작)');

    // (T4) which 분기: 같은 프레임에서 강풍은 진입, 폭풍은 미진입
    //   LOC 에서 약 111km 떨어진 점(위도 +1도 ≈ 111km).
    var split = { time: '202606010300', lat: 31.345, lon: 130.625,
        radStrong: 200, radStrongS: 200, radStrongD: null,   // 균일원 200km
        radStorm: 50, radStormS: 50, radStormD: null };       // 균일원 50km
    var distSplit = haversineKm(split.lat, split.lon, LOC.lat, LOC.lon);
    ok(distSplit > 100 && distSplit < 130, 'split 프레임 거리 ~111km (got ' + distSplit.toFixed(1) + ')');
    ok(radiusEntry(LOC, [split], 'strong') !== null, 'split: 강풍반경(200km) 진입');
    eq(radiusEntry(LOC, [split], 'storm'), null, 'split: 폭풍반경(50km) 미진입');

    // (T5) 비대칭 효과: LOC 가 가항측(ed) 방향에 있으면 단반경 적용 → 미진입
    //   LOC 가 중심의 북쪽(N) → ed=N(가항측) → 단반경 30km, 거리 ~111km → 미진입.
    var asymSafe = { time: '202606010900', lat: 29.345, lon: 130.625,
        radStrong: 200, radStrongS: 30, radStrongD: 'N' };
    eq(radiusEntry(LOC, [asymSafe], 'strong'), null, '비대칭: 가항측(단반경30km) 방향이라 미진입');
    //   같은 반경이지만 ed=S(위험측이 북쪽) → LOC 방향은 위험측 → 장반경 200km → 진입.
    var asymDanger = { time: '202606010900', lat: 29.345, lon: 130.625,
        radStrong: 200, radStrongS: 30, radStrongD: 'S' };
    ok(radiusEntry(LOC, [asymDanger], 'strong') !== null, '비대칭: 위험측 방향이라 장반경 적용 → 진입');

    // (T6) 반경 정보 없는 프레임은 스킵 — radStrong 없으면 진입 판정 안 함
    eq(radiusEntry(LOC, [{ time: '202606010400', lat: 30.35, lon: 130.63 }], 'strong'), null,
        '반경 없는 프레임 스킵(null)');

    // (T7) 빈/이상 입력 방어
    eq(radiusEntry(LOC, [], 'strong'), null, '빈 frames → null');
    eq(radiusEntry(null, [{ time: '1', lat: 30, lon: 130, radStrong: 9999 }], 'strong'), null,
        'loc 없음 → null');

    console.log('\n[typhoon_radius] 단위테스트 ' + (n - fails) + '/' + n + ' 통과' + (fails ? ' — ' + fails + '건 실패' : ''));
    process.exit(fails ? 1 : 0);
}
