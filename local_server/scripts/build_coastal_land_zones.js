/**
 * ============================================================================
 * 파일명: local_server/scripts/build_coastal_land_zones.js
 * 역할  : 육상 특보구역(강풍) 중 "바다에 접한 것"만 골라 경계를 단순화해 클라이언트가
 *         쓸 수 있는 작은 파일로 만든다(빌드타임 1회성, 배포 코드에는 안 실림).
 *
 * [왜 필요한가]
 *   강풍특보는 육상 구역 단위로 낸다. 격자 칸이 해안에 걸쳐 있으면 그 칸의 "육상 특보
 *   발효 일수"도 함께 보여주기로 했는데(설계서 작업 6 G-4, 사용자 확정 2026-09-04
 *   "해상 0000일 / 육상 0000일 두 줄"), 그러려면 어느 육상 구역에 걸치는지 앱이 알아야
 *   한다. 원본(wrnArea_land.geojson)은 4.2MB 라 그대로 실을 수 없다.
 *
 * [어떻게 줄이나]
 *   ① 내륙 구역은 뺀다 — 해상 특보구역에서 3km 안쪽(NEAR_LAND_KM 과 같은 값)에 닿는
 *      것만 남긴다. 실측으로 시군 단위 280개 중 108개만 남는다.
 *   ② 경계를 단순화한다 — 격자 칸은 보통 수 km 이상이라 수백 m 오차는 판정에 영향이
 *      없다. 실측: 222m 정밀도에서 0.52MB, 555m 에서 0.30MB.
 *
 * [실행]
 *   cd /home/user/SEAGNAL
 *   npm install --no-save @turf/turf
 *   node local_server/scripts/build_coastal_land_zones.js
 *
 * [출력] client/assets/warn_zones_land_coastal.geojson
 *   properties.name 은 build_warn_intervals.js 가 쓰는 구역 이름과 같은 규칙으로
 *   정규화해 둔다(공백·가운뎃점·마침표 제거) — 두 파일을 이름으로 맞춰야 하기 때문.
 *
 * [연계] 이름 규칙은 build_accident_warn_flags.js 의 loadZoneFeatures() 와 같다
 *   (regKo || regko, 신 제주 10구역은 빼고 jeju_old_zones.geojson 의 옛 이름을 쓴다).
 *   읽는 쪽: client/js/marine-life/safety/accident_info.js (S11 에서 연결)
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');

const DATA_DIR = path.join(__dirname, 'data', 'warn_zone_flags');
const LAND_PATH = path.join(DATA_DIR, 'wrnArea_land.geojson');
const JEJU_OLD_PATH = path.join(DATA_DIR, 'jeju_old_zones.geojson');
const SEA_PATH = path.join(__dirname, '..', '..', 'client', 'assets', 'warn_zones.geojson');
const OUT_PATH = path.join(__dirname, '..', '..', 'client', 'assets', 'warn_zones_land_coastal.geojson');

const NEAR_LAND_KM = 3;          // build_accident_warn_flags.js 와 같은 값이어야 한다
const SIMPLIFY_TOLERANCE = 0.002; // 도 단위, 약 222m
const NEW_JEJU_NAMES = ['제주시서부', '제주시동부', '제주시북부', '제주시중산간',
    '서귀포시서부', '서귀포시동부', '서귀포시남부', '서귀포시중산간'];

function normZone(name) { return String(name).replace(/[\s·.]/g, ''); }

function main() {
    console.log('[1/4] 원본 읽기...');
    const land = JSON.parse(fs.readFileSync(LAND_PATH, 'utf8'));
    const jejuOld = JSON.parse(fs.readFileSync(JEJU_OLD_PATH, 'utf8'));
    const sea = JSON.parse(fs.readFileSync(SEA_PATH, 'utf8'));

    // 해상구역을 각각 3km 밖으로 부풀려 둔다 — 이 중 하나라도 닿는 육상구역이 "해안"이다.
    // 하나로 합치지(union) 않는 이유: 44개를 합치면 아주 무겁고, 어차피 "하나라도 닿는가"만
    // 보면 되므로 합칠 이유가 없다. bbox 를 미리 재 두고 먼저 걸러 빠르게 판정한다.
    console.log('[2/4] 해상구역을 3km 밖으로 부풀리기...');
    const band = sea.features.map((f) => {
        const b = turf.buffer(f, NEAR_LAND_KM, { units: 'kilometers' });
        return { geom: b, bbox: turf.bbox(b) };
    });
    function bboxOverlap(a, b) {
        return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
    }

    console.log('[3/4] 해안에 닿는 육상구역만 고르고 경계 단순화...');
    const cands = [];
    land.features.forEach((f) => {
        if (f.properties.level !== 2 || f.properties.ground !== 'local') return;
        const name = f.properties.regKo || f.properties.regko;
        if (!name || NEW_JEJU_NAMES.includes(name)) return;
        cands.push({ name: name, geom: f });
    });
    jejuOld.features.forEach((f) => cands.push({ name: f.properties.name, geom: f }));

    const out = [];
    cands.forEach((c) => {
        let touches = false;
        let cb;
        try { cb = turf.bbox(c.geom); } catch (e) { return; }
        for (let i = 0; i < band.length && !touches; i++) {
            if (!bboxOverlap(cb, band[i].bbox)) continue;
            try { touches = turf.booleanIntersects(c.geom, band[i].geom); } catch (e) { /* 이상 지오메트리 */ }
        }
        if (!touches) return;
        let simplified;
        try {
            simplified = turf.simplify(c.geom, { tolerance: SIMPLIFY_TOLERANCE, highQuality: false, mutate: false });
        } catch (e) { simplified = c.geom; }
        out.push({ type: 'Feature', properties: { name: normZone(c.name) }, geometry: simplified.geometry });
    });

    console.log('[4/4] 저장...');
    fs.writeFileSync(OUT_PATH, JSON.stringify({ type: 'FeatureCollection', features: out }));
    const kb = (fs.statSync(OUT_PATH).size / 1024).toFixed(0);
    console.log(`  후보 ${cands.length}개 -> 해안 ${out.length}개 (${kb}KB)`);
    console.log(`  저장: ${OUT_PATH}`);
}

main();
