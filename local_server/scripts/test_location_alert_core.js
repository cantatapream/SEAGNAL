/**
 * test_location_alert_core.js — 위치 기반 경보 순수 로직 검증
 * 실행: node local_server/scripts/test_location_alert_core.js
 * 실제 assets/warn_zones.geojson 으로 시나리오를 돌려 결과를 출력·검증한다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('../js/location-alert/location_alert_core.js');

const gj = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'assets', 'warn_zones.geojson'), 'utf8'));
const features = gj.features;

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} ${extra || ''}`); }
}

console.log(`구역 수: ${features.length}`);

// 1) 기초 수학
console.log('\n[1] 거리·방위 기초');
const seoul = { lat: 37.5665, lng: 126.9780 };
const busan = { lat: 35.1796, lng: 129.0756 };
const dNm = C.haversineMeters(seoul, busan) / C.NM_M;
check('서울-부산 거리 약 170~200해리', dNm > 170 && dNm < 200, `(${dNm.toFixed(1)}해리)`);
const b = C.bearingDeg(seoul, busan);
check('서울→부산 방위 남동(100~150°)', b > 100 && b < 150, `(${b.toFixed(0)}°)`);

// 2) 구역 판정 — 각 구역 대표점(외곽 첫 좌표를 살짝 안쪽으로) 대신, 구역 내부 임의점 탐색
console.log('\n[2] 구역 포함 판정');
// 육지(서울)는 어떤 바다 구역에도 안 들어가야 함
check('서울(육지)은 특보구역 밖', C.locateZone(seoul, features) === null);

// 각 구역마다 내부점을 하나 찾아 그 구역으로 판정되는지(자기 자신 포함 확인)
function interiorPointOf(feature) {
    // 외곽 폴리곤들의 좌표 평균(센트로이드 근사) → 구역 안일 가능성 높음. 아니면 외곽점들 스캔.
    const geom = feature.geometry;
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    for (const poly of polys) {
        const ext = poly[0];
        let sx = 0, sy = 0;
        ext.forEach(p => { sx += p[0]; sy += p[1]; });
        const c = [sx / ext.length, sy / ext.length];
        if (C.pointInGeometry(c, C.seaGeometry(feature))) return c;
        // 센트로이드가 구멍/밖이면 외곽 꼭짓점들의 인접 중점들 시도
        for (let i = 0; i < ext.length - 1; i++) {
            const m = [(ext[i][0] + c[0]) / 2, (ext[i][1] + c[1]) / 2];
            if (C.pointInGeometry(m, C.seaGeometry(feature))) return m;
        }
    }
    return null;
}
let located = 0, foundInterior = 0;
for (const f of features) {
    const ip = interiorPointOf(f);
    if (!ip) continue;
    foundInterior++;
    const r = C.locateZone(ip, features);
    if (r && r.feature.properties.WarnCode === f.properties.WarnCode) located++;
}
check(`내부점 판정 정확도(=내부점 찾은 구역 중 자기 구역으로 판정)`,
    located >= foundInterior * 0.9, `(${located}/${foundInterior})`);

// 3) 시나리오: 울산앞바다 내부점에서 경보 발효 → 최근접 무특보/주의보 구역 + 문구
console.log('\n[3] 종합 시나리오 (울산앞바다 경보 발효)');
const ulsan = features.find(f => f.properties.name === '울산앞바다');
const upt = interiorPointOf(ulsan);
check('울산앞바다 내부점 확보', !!upt, upt ? `[${upt[0].toFixed(3)}, ${upt[1].toFixed(3)}]` : '');

// 현재 특보 상태(가정): 울산앞바다=풍랑경보(severe). 그 외 전부 무특보.
const stateByCode = {};
stateByCode[ulsan.properties.WarnCode] = [{ type: '풍랑', level: '경보' }];
const tierOf = (f) => C.classifyTier(stateByCode[f.properties.WarnCode]);

const nearestClear = C.nearestZoneBy(upt, features, (f) => tierOf(f) === 'none');
const nearestLower = C.nearestZoneBy(upt, features,
    (f) => f.properties.WarnCode !== ulsan.properties.WarnCode && tierOf(f) !== 'severe');

check('최근접 무특보 구역 탐색됨', !!nearestClear, nearestClear ? `${nearestClear.name} ${nearestClear.bearing}° ${nearestClear.distNm.toFixed(1)}해리` : '');
check('방위 0~360 범위', nearestClear && nearestClear.bearing >= 0 && nearestClear.bearing < 360);
check('거리 양수', nearestClear && nearestClear.distNm > 0);

const msg = C.buildMessage({
    zoneName: '울산앞바다', warnType: '풍랑', tier: 'severe', event: 'active',
    nearestClear, nearestLower,
});
console.log('\n--- 생성된 푸시 ---');
console.log('제목:', msg.title);
console.log('내용:\n' + msg.body.split('\n').map(l => '   ' + l).join('\n'));
check('제목에 긴급경보🚨 포함', /긴급경보🚨/.test(msg.title));
check('본문에 최근접 미발표 해역 줄 포함', /최근접 특보 미발표 해역/.test(msg.body));

// 4) 예비특보 / 주의보 문구
console.log('\n[4] 예비특보·주의보 문구');
const prelim = C.buildMessage({ zoneName: '경북남부앞바다', warnType: '풍랑', tier: 'prelim', timeText: '오늘 밤(21~24시)' });
console.log('예비 제목:', prelim.title);
check('예비특보 본문에 발효 예정시각 줄', /발효 예정시각 : 오늘 밤/.test(prelim.body));
check('예비특보엔 방위 줄 없음', !/최근접/.test(prelim.body));

const adv = C.buildMessage({
    zoneName: '경북남부앞바다', warnType: '풍랑', tier: 'advisory', event: 'publish',
    timeText: '6월 17일 21시', nearestClear,
});
console.log('주의보 제목:', adv.title);
check('주의보 제목에 발효 예정', /풍랑주의보 발효 예정/.test(adv.title));

console.log('\n[5] 둘째줄(주의보·예비특보 해역) 생략 dedup — name 기준');
const tDiff = C.buildMessage({
    zoneName: 'A해역', warnType: '풍랑', tier: 'severe', event: 'active',
    nearestClear: { name: '클리어해역', bearing: 90, distNm: 5 },
    nearestLower: { name: '주의보해역', bearing: 100, distNm: 3 },
});
check('두 목표 다르면 둘째줄 표시', /최근접 주의보·예비특보 해역/.test(tDiff.body));
const tSame = C.buildMessage({
    zoneName: 'A해역', warnType: '풍랑', tier: 'severe', event: 'active',
    nearestClear: { name: '같은해역', bearing: 90, distNm: 5 },
    nearestLower: { name: '같은해역', bearing: 90, distNm: 5 },
});
check('두 목표 같으면 둘째줄 생략', !/최근접 주의보·예비특보 해역/.test(tSame.body));

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
