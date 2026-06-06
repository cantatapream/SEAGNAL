#!/usr/bin/env node
/**
 * build_haegu_sea_mapping.js — 해구(격자 번호) → 명명 해역(예보구역) 매핑표 생성기 (초안)
 *
 * 목적: data/zone_coords.json 의 1296개 해구 각각을, seaZoneCoordinates.js 의 48개
 *       명명 해역(대표 중심좌표) 중 가장 가까운 곳에 결정론적으로 배정한다.
 *
 * 입력(읽기 전용 — 수정 금지):
 *   - ../../data/zone_coords.json           : { "<번호>": { lat, lon }, ... }  (1296)
 *   - ../../seaZoneCoordinates.js           : SEA_ZONE_COORDINATES { code:{name,lat,lon,region,type} }
 *
 * 출력:
 *   - ./haegu_sea_mapping.json              : 런타임 소비용 매핑표
 *
 * 실행: node knowledge/graph/build_haegu_sea_mapping.js   (실행은 메인이 나중에)
 *
 * 결정론: 입력이 같으면 출력이 항상 동일. 거리 동률은 (1) 거리 (2) 해역코드 사전순으로 tie-break.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const HAEGU_PATH = path.join(ROOT, 'data', 'zone_coords.json');
const SEAZONE_PATH = path.join(ROOT, 'seaZoneCoordinates.js');
const OUT_PATH = path.join(__dirname, 'haegu_sea_mapping.json');

// ── 동률/경계 모호성 판정 파라미터 ───────────────────────────────────────────
// 격자 간격은 0.5°. 최근접 해역과 차순위 해역의 거리비가 임계 이내면 "경계 해구"로 표시.
const AMBIGUOUS_RATIO = 1.15;   // d2/d1 < 1.15 이면 모호(약 15% 이내 차이)
const DEG2KM = 111;             // 위도 1° ≈ 111km (참고용, 거리 단위 환산은 가중 유클리드 그대로 사용)

/** assistant.js 의 ZONE_COORDS 파서와 동일 정규식으로 SEA_ZONE_COORDINATES 파싱.
 *  (require 불가 — 브라우저/서버 공용 전역 스크립트일 수 있어 정규식 추출이 안전.) */
function loadSeaZones() {
    const raw = fs.readFileSync(SEAZONE_PATH, 'utf8');
    // 블록 단위로 추출하되, 블록 '내부'에서 필드를 개별 매칭한다.
    // (assistant.js 의 ZONE_COORDS 파서와 동일하게 필드 순서에 비의존 → 향후 편집에도 견고.)
    const blockRe = /'([0-9A-Z]{6,})':\s*\{([\s\S]*?)\}/g;
    const zones = [];
    let m;
    while ((m = blockRe.exec(raw)) !== null) {
        const code = m[1];
        const body = m[2];
        const lat = body.match(/lat:\s*([-\d.]+)/);
        const lon = body.match(/lon:\s*([-\d.]+)/);
        if (!lat || !lon) continue;            // 좌표 없는 블록(헬퍼 등)은 건너뜀
        const name = body.match(/name:\s*'([^']*)'/);
        const region = body.match(/region:\s*'([^']*)'/);
        zones.push({
            code,
            name: name ? name[1] : '',
            lat: +lat[1],
            lon: +lon[1],
            region: region ? region[1] : ''
        });
    }
    if (!zones.length) throw new Error('SEA_ZONE_COORDINATES 파싱 실패');
    return zones;
}

function loadHaegu() {
    const raw = JSON.parse(fs.readFileSync(HAEGU_PATH, 'utf8'));
    const src = raw && raw.data ? raw.data : raw;
    const out = {};
    for (const k of Object.keys(src || {})) {
        const v = src[k];
        if (v && v.lat != null && v.lon != null) out[String(k)] = { lat: +v.lat, lon: +v.lon };
    }
    return out;
}

/** 경도 가중 유클리드 거리(제곱). 한반도 위도대(≈35°)에서 경도 1° 실거리가 짧으므로
 *  cos(위도) 보정으로 실제 근접도에 맞춘다. 결정론·단조성만 필요하므로 sqrt 생략 가능하나
 *  거리비 판정을 위해 실제 거리(도 단위)를 반환한다. */
function dist(a, b) {
    const latMid = (a.lat + b.lat) / 2 * Math.PI / 180;
    const dLat = a.lat - b.lat;
    const dLon = (a.lon - b.lon) * Math.cos(latMid);
    return Math.sqrt(dLat * dLat + dLon * dLon);
}

function build() {
    const seaZones = loadSeaZones();
    const haegu = loadHaegu();

    const haeguToSea = {};   // "<해구번호>": { code, name, region, distDeg, ambiguous, alt }
    const seaToHaegu = {};   // "<해역코드>": [ 해구번호, ... ]
    let ambiguousCount = 0;

    for (const id of Object.keys(haegu)) {
        const p = haegu[id];
        // 모든 해역과의 거리 계산 → 오름차순(거리, 동률시 코드 사전순)
        const ranked = seaZones
            .map(z => ({ z, d: dist(p, z) }))
            .sort((x, y) => (x.d - y.d) || (x.z.code < y.z.code ? -1 : 1));

        const top = ranked[0];
        const second = ranked[1];
        const ambiguous = second ? (second.d / (top.d || 1e-9)) < AMBIGUOUS_RATIO : false;
        if (ambiguous) ambiguousCount++;

        haeguToSea[id] = {
            code: top.z.code,
            name: top.z.name,
            region: top.z.region,
            distKm: +(top.d * DEG2KM).toFixed(1),
            ambiguous,
            // 경계 해구에 한해 차순위 후보 노출(런타임에서 "또는 ○○" 안내 가능)
            alt: ambiguous ? { code: second.z.code, name: second.z.name } : null
        };
        (seaToHaegu[top.z.code] = seaToHaegu[top.z.code] || []).push(id);
    }

    // 역인덱스 해구번호 정렬(숫자) — 결정론
    for (const c of Object.keys(seaToHaegu)) {
        seaToHaegu[c].sort((a, b) => +a - +b);
    }

    const out = {
        _meta: {
            generated: '<RUN>',                 // 실행 시 ISO 날짜로 치환
            source: ['data/zone_coords.json', 'seaZoneCoordinates.js'],
            algorithm: 'nearest-named-zone (cos-lat weighted euclidean)',
            ambiguousRatio: AMBIGUOUS_RATIO,
            haeguCount: Object.keys(haeguToSea).length,
            seaZoneCount: seaZones.length,
            ambiguousCount
        },
        // 런타임 1순위 소비 대상: 해구번호 → 해역
        haeguToSea,
        // 보조 소비: 해역코드 → 소속 해구번호 목록
        seaToHaegu,
        // 해역 대표좌표 스냅샷(출처 검증·표시용)
        seaZones: seaZones.reduce((o, z) => (o[z.code] = z, o), {})
    };
    out._meta.generated = new Date().toISOString().slice(0, 10);

    fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
    console.log(`[build_haegu_sea_mapping] 완료: 해구 ${out._meta.haeguCount} → 해역 ${seaZones.length}` +
        ` (경계 모호 ${ambiguousCount}개) → ${path.relative(ROOT, OUT_PATH)}`);
}

if (require.main === module) build();
module.exports = { build, dist, loadSeaZones, loadHaegu };
