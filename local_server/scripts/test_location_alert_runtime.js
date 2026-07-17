/**
 * test_location_alert_runtime.js — 단말 수신 판정(decideAlert) 검증
 * 실행: node local_server/scripts/test_location_alert_runtime.js
 * 실제 warn_zones.geojson + 합성 스냅샷으로 decideAlert 순수 로직을 검증.
 */
'use strict';
const fs = require('fs');
const path = require('path');

// 런타임이 코어를 require로 찾도록(브라우저 전역 없음)
global.LocationAlertCore = require('../../client/js/location-alert/location_alert_core.js');
const RT = require('../../client/js/location-alert/location_alert_runtime.js');
const core = global.LocationAlertCore;

const gj = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'client', 'assets', 'warn_zones.geojson'), 'utf8'));
const features = gj.features;

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} ${extra || ''}`); }
}

// 구역 내부점 구하기(테스트 보조)
function interiorPointOf(feature) {
    const geom = feature.geometry;
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    for (const poly of polys) {
        const ext = poly[0];
        let sx = 0, sy = 0; ext.forEach(p => { sx += p[0]; sy += p[1]; });
        const c = [sx / ext.length, sy / ext.length];
        if (core.pointInGeometry(c, core.seaGeometry(feature))) return c;
        for (let i = 0; i < ext.length - 1; i++) {
            const m = [(ext[i][0] + c[0]) / 2, (ext[i][1] + c[1]) / 2];
            if (core.pointInGeometry(m, core.seaGeometry(feature))) return m;
        }
    }
    return null;
}

const ulsan = features.find(f => f.properties.name === '울산앞바다');
const upt = interiorPointOf(ulsan);

console.log('[1] 경보 구역 안 → 긴급경보 메시지');
const snapSevere = { zones: { [ulsan.properties.name]: { warnType: '풍랑', level: '경보', event: 'active', tier: 'severe' } } };
const m1 = RT.decideAlert({ lat: upt[1], lng: upt[0], accuracyM: 30 }, features, snapSevere);
check('메시지 생성됨', !!m1, m1 && m1.title);
check('제목 긴급경보🚨', m1 && /긴급경보🚨/.test(m1.title), m1 && m1.title);
check('본문 최근접 미발표 해역 포함', m1 && /최근접 특보 미발표 해역/.test(m1.body));

console.log('\n[2] 내 구역에 특보 없음 → null');
const m2 = RT.decideAlert({ lat: upt[1], lng: upt[0], accuracyM: 30 }, features, { zones: {} });
check('특보 없으면 알림 없음', m2 === null);

console.log('\n[3] 육지(서울) → null');
const m3 = RT.decideAlert({ lat: 37.5665, lng: 126.9780, accuracyM: 30 }, features, snapSevere);
check('육지면 알림 없음', m3 === null);

console.log('\n[4] 주의보 구역 → 안전정보(긴급 아님)');
const snapAdv = { zones: { [ulsan.properties.name]: { warnType: '풍랑', level: '주의보', event: 'publish', efTime: '6월 17일 21시', tier: 'advisory' } } };
const m4 = RT.decideAlert({ lat: upt[1], lng: upt[0], accuracyM: 30 }, features, snapAdv);
check('주의보 제목 안전정보', m4 && /안전정보/.test(m4.title), m4 && m4.title);
check('주의보 제목 긴급경보 아님', m4 && !/긴급경보/.test(m4.title));

console.log('\n[5] 회색지대(GPS 오차 큼): severe 보류, advisory 표출');
const huge = { lat: upt[1], lng: upt[0], accuracyM: 999999 };
const g1 = RT.decideAlert(huge, features, snapSevere);
check('회색지대 + 경보 → 보류(null)', g1 === null);
const g2 = RT.decideAlert(huge, features, snapAdv);
check('회색지대 + 주의보 → 표출(안전정보)', g2 && /안전정보/.test(g2.title), g2 && g2.title);

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
