/**
 * ============================================================================
 * 파일명: scripts/build_hazard_rock_anchors.js
 * 역할: "간출암 잠김경고" 제주 앵커 목록 생성 (오프라인 전처리)
 * ============================================================================
 *
 * [무엇을 만드나]
 *   client/hazard_rocks.json 의 간출암(k=1) 중 제주 해역(JEJU_BBOX) 좌표만 골라
 *   0.1°(~10km) 버킷으로 묶고, 버킷마다 대표 1개(버킷 내 간출암들의 중심에 가장
 *   가까운 점)를 앵커로 삼는다. 물빠짐(tide_field)의 버킷 앵커 방식과 동일한
 *   밀도를 쓰되, 대표 선정 기준만 다르다(물빠짐=최심 셀, 여기=버킷 중심 근접).
 *   → 서해·남해는 기존 물빠짐 앵커를 그대로 재사용하므로 신규 앵커가 필요 없고,
 *     동해는 TideBED 미제공 해역이라 애초에 대상이 아니다(제주만 신규 생성).
 *
 * [실행]
 *   node scripts/build_hazard_rock_anchors.js
 *
 * [연계]
 *   - services/hazard_rocks_tide_common.js → 산출 경로·버킷 크기
 *   - services/tide_field_common.js        → JEJU_BBOX, haversineKm 재사용
 *   - services/hazard_rocks_tide_collector.js → 이 anchors.json 을 읽어 곡선 수집
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

const TFC = require('../services/tide_field_common');
const HRC = require('../services/hazard_rocks_tide_common');

function log(...a) { console.log('[build_hazard_rock_anchors]', ...a); }

/** 좌표가 제주 박스 안인지(물빠짐과 동일 JEJU_BBOX 기준) — 앵커 대상 필터링용. */
function isJeju(lat, lon) {
    return lat >= TFC.JEJU_BBOX.latMin && lat <= TFC.JEJU_BBOX.latMax &&
        lon >= TFC.JEJU_BBOX.lonMin && lon <= TFC.JEJU_BBOX.lonMax;
}

/**
 * 버킷마다 대표 1개(버킷 중심에 가장 가까운 간출암) 선정.
 * [연계] 물빠짐(build_tide_field.js)의 버킷 앵커 방식과 같은 크기(0.1°)를 쓰되
 *   대표 선정 기준만 다르다(물빠짐=최심 셀, 여기=간출암 위치 중심 근접).
 * @param {Array<{lon,lat}>} points 제주 간출암 좌표 목록
 * @returns {Array<{id,bucket,lon,lat,rockCount}>} 버킷별 대표 앵커 목록
 */
function buildBucketAnchors(points) {
    const B = HRC.ANCHOR_BUCKET_DEG;
    const buckets = new Map(); // bucketKey -> {lon,lat,members:[...]}
    for (const p of points) {
        const bx = Math.floor(p.lon / B);
        const by = Math.floor(p.lat / B);
        const bk = `${bx}_${by}`;
        let b = buckets.get(bk);
        if (!b) { b = { members: [] }; buckets.set(bk, b); }
        b.members.push(p);
    }

    const bkeys = Array.from(buckets.keys()).sort();
    const anchors = [];
    let aid = 0;
    for (const bk of bkeys) {
        const members = buckets.get(bk).members;
        const cLon = members.reduce((s, p) => s + p.lon, 0) / members.length;
        const cLat = members.reduce((s, p) => s + p.lat, 0) / members.length;
        let best = members[0], bestD = Infinity;
        for (const p of members) {
            const d = TFC.haversineKm(cLat, cLon, p.lat, p.lon);
            if (d < bestD) { bestD = d; best = p; }
        }
        aid++;
        anchors.push({
            id: 'HRJ' + String(aid).padStart(3, '0'),
            bucket: bk,
            lon: +best.lon.toFixed(5),
            lat: +best.lat.toFixed(5),
            rockCount: members.length
        });
    }
    return anchors;
}

function main() {
    const dataPath = path.join(__dirname, '..', '..', 'client', 'hazard_rocks.json');
    if (!fs.existsSync(dataPath)) {
        log(`간출암 데이터 없음: ${dataPath}`);
        return;
    }
    const geojson = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    const jejuPoints = [];
    for (const f of geojson.features) {
        if (f.properties.k !== 1) continue; // 간출암만(세암/암암/노출암 제외)
        const [lon, lat] = f.geometry.coordinates;
        if (isJeju(lat, lon)) jejuPoints.push({ lon, lat });
    }
    log(`제주 간출암: ${jejuPoints.length}개`);

    const anchors = buildBucketAnchors(jejuPoints);
    log(`앵커(버킷): ${anchors.length}개 (버킷=${HRC.ANCHOR_BUCKET_DEG}°≈10km)`);

    fs.mkdirSync(HRC.HAZARD_ROCKS_TIDE_DIR, { recursive: true });
    fs.mkdirSync(HRC.HR_CURVES_DIR, { recursive: true });
    fs.writeFileSync(HRC.HR_ANCHORS_PATH, JSON.stringify({
        generated_at: new Date().toISOString(),
        count: anchors.length,
        anchors
    }, null, 2), 'utf8');
    log(`저장: ${HRC.HR_ANCHORS_PATH}`);
}

module.exports = { main, buildBucketAnchors, isJeju };

if (require.main === module) {
    main();
}
