/**
 * ============================================================================
 * 파일명: scripts/build_warn_zones_holed.js
 * 역할 : 부모 해역 GeoJSON 의 각 feature 에 "자식 영역을 도려낸 polygon"
 *        메타데이터(_holedGeometry)를 사전 계산해 추가.
 * ============================================================================
 *
 * [Synthesis 본 — Agent B 알고리즘 + Agent C 후처리 + Agent A 로깅]
 *
 *  1) 핵심 알고리즘: Agent B 의 hole-punching 직접 구현
 *     - 부모 outer ring 그대로 보존 (V3 100%, G2 의미 충족)
 *     - 자식이 부모 안에 완전 포함 → 자식 outer vertex 100% 보존 (G6 충족)
 *     - 자식이 부모 boundary 가로지름 → turf.intersect 로 clip (교차점만 새 vertex)
 *
 *  2) 후처리: Agent C 의 clipToParent
 *     - hole-punching 결과의 미세 sliver (인천경기북부 V5 ~29 m²) 제거
 *     - vertex 폭증 가드 (>5% 증가 시 폐기, 부모 outer 보존 깨지지 않도록)
 *
 *  3) 폴백: Agent A 의 raw-sequential difference (S13 동작)
 *     - hole-punching 실패 시 안전망. 결과 geometry 가 null 이거나 throw 시 S13 동작.
 *
 *  4) 로깅: Agent A 의 method-label 카운트 패턴
 *     - 각 부모가 어떤 알고리즘 단계(hole_punch / raw_fallback / fail)로 처리됐는지 보고
 *
 *  5) 호환성: Agent C 의 turf v6/v7 시그니처 fallback
 *     - turf.difference / turf.intersect 모두 두 시그니처 시도
 *
 * [실행 방법]
 *   cd /home/user/SEAGNAL
 *   npm install --no-save @turf/turf   # 운영 환경에 영구 설치 금지
 *   node local_server/scripts/build_warn_zones_holed.js
 *
 *   → local_server/assets/warn_zones.geojson 갱신.
 *     각 부모 feature properties 에 _holedGeometry 추가. 원본 geometry 는 보존.
 *
 * [출력 데이터 구조]
 *   feature.geometry              : 원본 MultiPolygon (수정 안 함 — G2)
 *   feature.properties._holedGeometry : 자식 영역 도려낸 geometry (ON fill 용)
 *      형태: { type: 'Polygon'|'MultiPolygon', coordinates: [...] }
 *      값 null/undefined 이면 자식 없음 → 클라이언트는 원본 geometry 사용
 *
 * [부모-자식 매핑]
 *   mappings.js 의 COASTAL_MAPPING 을 vm 으로 평가해 fullName 인덱스 생성.
 *   자식 GeoJSON 의 name 을 정규화(공백 제거)한 후 fullName 과 매칭.
 *
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// turf 는 빌드 타임에만 필요한 외부 의존성 (npm install --no-save @turf/turf)
let turf;
try {
    turf = require('@turf/turf');
} catch (e) {
    console.error('[ERROR] @turf/turf 미설치. 다음 명령 후 다시 실행:');
    console.error('  npm install --no-save @turf/turf');
    process.exit(1);
}

// ============================================================================
// 경로 설정
// ============================================================================
const ROOT = path.resolve(__dirname, '..', '..');                  // /home/user/SEAGNAL
const PARENT_PATH = path.join(ROOT, 'local_server/assets/warn_zones.geojson');
const SUB_PATH    = path.join(ROOT, 'local_server/assets/warn_zones_sub.geojson');
const MAPPINGS_PATH = path.join(ROOT, 'local_server/js/shared/utils/mappings.js');

// ============================================================================
// 1단계: COASTAL_MAPPING 로드 (mappings.js 가 브라우저 const 정의라 vm 으로 평가)
// ============================================================================
function loadCoastalMapping() {
    const code = fs.readFileSync(MAPPINGS_PATH, 'utf8');
    const transformed = code + '\nthis.COASTAL_MAPPING = COASTAL_MAPPING;';
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(transformed, ctx);
    if (!ctx.COASTAL_MAPPING) {
        throw new Error('COASTAL_MAPPING 추출 실패');
    }
    return ctx.COASTAL_MAPPING;
}

// 이름 정규화 — 공백·마침표·가운뎃점 모두 제거.
function normalizeChildName(s) {
    return String(s || '').replace(/[\s.·]/g, '').trim();
}

// ============================================================================
// 2단계: 부모 이름별로 자식 fullName 인덱스 생성
// ============================================================================
function buildParentChildIndex(coastalMapping) {
    const childToParent = {};
    const parentChildSet = {};
    for (const parentName of Object.keys(coastalMapping)) {
        const list = coastalMapping[parentName] || [];
        parentChildSet[parentName] = new Set();
        for (const child of list) {
            const key = normalizeChildName(child.fullName);
            childToParent[key] = parentName;
            parentChildSet[parentName].add(key);
        }
    }
    return { childToParent, parentChildSet };
}

// ============================================================================
// 3단계: 자식 GeoJSON 의 각 feature → 부모 이름 매핑
// ============================================================================
function mapSubsToParents(subsGeojson, childToParent) {
    const parentToSubs = {};
    const unmatched = [];
    for (const f of subsGeojson.features) {
        const subName = (f.properties && f.properties.name) || '';
        const norm = normalizeChildName(subName);
        const parentName = childToParent[norm];
        if (parentName) {
            if (!parentToSubs[parentName]) parentToSubs[parentName] = [];
            parentToSubs[parentName].push(f);
        } else {
            unmatched.push({ name: subName, normalized: norm });
        }
    }
    return { parentToSubs, unmatched };
}

// ============================================================================
// 4단계: hole-punching (Agent B 알고리즘)
//
// 핵심:
//   1) 부모 outer ring 그대로 보존 (deep-copy 후 inner ring 만 추가)
//   2) 자식 outer ring 이 부모 내부에 완전 포함 → 자식 vertex 100% 보존
//   3) 자식이 부모 boundary 가로지름 → turf.intersect 로 clip
//   4) 자식 내부의 hole (자식이 부모 fill 영역으로 인정) → extras 로 부모 fill 복원
// ============================================================================

// Ring 의 signed area (양수 = CCW)
function _ringSignedArea(ring) {
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
    }
    return a / 2;
}

// Point-in-ring (ray casting)
function _pointInRing(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        const denom = (yj - yi) || 1e-30;
        const intersect = ((yi > pt[1]) !== (yj > pt[1])) &&
            (pt[0] < (xj - xi) * (pt[1] - yi) / denom + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// Point-in-polygon (polygon = [outer, hole1, hole2, ...])
function _pointInPolygon(pt, polygon) {
    if (!_pointInRing(pt, polygon[0])) return false;
    for (let i = 1; i < polygon.length; i++) {
        if (_pointInRing(pt, polygon[i])) return false;
    }
    return true;
}

// Ring 의 모든 vertex 가 polygon 내부면 true.
function _ringInsidePolygon(ring, polygon) {
    for (const v of ring) {
        if (!_pointInPolygon(v, polygon)) return false;
    }
    return true;
}

function _toMultiPolygonCoords(geom) {
    if (geom.type === 'Polygon') return [geom.coordinates];
    if (geom.type === 'MultiPolygon') return geom.coordinates;
    throw new Error('지원하지 않는 geometry type: ' + geom.type);
}

// turf.intersect v6/v7 시그니처 호환 래퍼
function _turfIntersectCompat(featA, featB) {
    try {
        return turf.intersect(turf.featureCollection([featA, featB]));
    } catch (e1) {
        try {
            return turf.intersect(featA, featB);
        } catch (e2) {
            throw e2;
        }
    }
}

// turf.difference v6/v7 시그니처 호환 래퍼
function _turfDifferenceCompat(featA, featB) {
    try {
        return turf.difference(turf.featureCollection([featA, featB]));
    } catch (e1) {
        try {
            return turf.difference(featA, featB);
        } catch (e2) {
            throw e2;
        }
    }
}

// 자식 polygon piece 를 부모 hole-punch 용 inner hole + extras (부모 fill 복원) 로 분리
function _childPieceToParentHoles(childPiece, parentPolygon) {
    const childOuter = childPiece[0];

    if (_ringInsidePolygon(childOuter, parentPolygon)) {
        // 자식 outer 가 부모 polygon 안에 완전 포함 → vertex 100% 보존 (G6)
        const extras = [];
        for (let i = 1; i < childPiece.length; i++) {
            // 자식 inner ring → 새 outer polygon (자식 내부의 hole = 부모 fill 영역)
            extras.push([childPiece[i].slice()]);
        }
        return { holes: [childOuter.slice()], extras };
    }

    // 자식이 부모 boundary 를 가로지름 → turf.intersect 로 clip
    try {
        const clipped = _turfIntersectCompat(
            turf.feature({ type: 'Polygon', coordinates: childPiece }),
            turf.feature({ type: 'Polygon', coordinates: parentPolygon })
        );
        if (!clipped) return { holes: [], extras: [] };
        const cmp = _toMultiPolygonCoords(clipped.geometry);
        const holes = [];
        const extras = [];
        for (const poly of cmp) {
            holes.push(poly[0].slice());
            // clipping 결과의 inner ring 처리 (자식 안에 부모 영역이 있는 경우 등)
            for (let i = 1; i < poly.length; i++) {
                const innerRing = poly[i];
                try {
                    const intra = _turfIntersectCompat(
                        turf.polygon([innerRing]),
                        turf.polygon(parentPolygon)
                    );
                    if (intra) {
                        const intraMP = _toMultiPolygonCoords(intra.geometry);
                        for (const ep of intraMP) extras.push(ep.map(r => r.slice()));
                    }
                } catch (e) { /* 무시 */ }
            }
        }
        return { holes, extras };
    } catch (e) {
        return null;
    }
}

function computeHoledGeometryHolePunch(parentFeature, subFeatures) {
    const parentMP = _toMultiPolygonCoords(parentFeature.geometry);

    // 결과 = 부모 MultiPolygon 의 deep copy (G2 충족 — 부모 outer ring 보존)
    const result = parentMP.map(poly => poly.map(ring => ring.slice()));
    let appliedSubs = 0;
    let skippedPieces = 0;

    for (const sub of subFeatures) {
        let subMP;
        try { subMP = _toMultiPolygonCoords(sub.geometry); }
        catch (e) {
            console.warn(`  [warn] geometry 지원 안 함: ${sub.properties.name} (${e.message})`);
            continue;
        }

        for (const childPiece of subMP) {
            // 자식 piece 의 interior 점으로 부모 polygon 인덱스 결정
            const r = childPiece[0];
            let interiorPt;
            if (r.length >= 3) {
                interiorPt = [(r[0][0] + r[1][0] + r[2][0]) / 3,
                              (r[0][1] + r[1][1] + r[2][1]) / 3];
            } else {
                interiorPt = r[0];
            }

            let parentIdx = -1;
            for (let pi = 0; pi < parentMP.length; pi++) {
                if (_pointInPolygon(interiorPt, parentMP[pi])) { parentIdx = pi; break; }
            }
            if (parentIdx < 0) {
                // interior 점이 부모 밖 → 부모 polygon 각각에 대해 intersect 시도, 가장 큰 clip 영역 사용
                let bestIdx = -1, bestArea = 0;
                for (let pi = 0; pi < parentMP.length; pi++) {
                    try {
                        const clip = _turfIntersectCompat(
                            turf.feature({ type: 'Polygon', coordinates: childPiece }),
                            turf.feature({ type: 'Polygon', coordinates: parentMP[pi] })
                        );
                        if (clip) {
                            const a = turf.area(clip);
                            if (a > bestArea) { bestArea = a; bestIdx = pi; }
                        }
                    } catch (e) { /* ignore */ }
                }
                if (bestIdx < 0) { skippedPieces++; continue; }
                parentIdx = bestIdx;
            }

            const ret = _childPieceToParentHoles(childPiece, parentMP[parentIdx]);
            if (ret === null) {
                console.warn(`  [warn] clip 실패: ${parentFeature.properties.name} - ${sub.properties.name}`);
                skippedPieces++;
                continue;
            }
            for (const hole of ret.holes) result[parentIdx].push(hole);
            for (const extra of ret.extras) result.push(extra);
        }
        appliedSubs++;
    }

    if (appliedSubs === 0) return null;
    return {
        geom: { type: 'MultiPolygon', coordinates: result },
        skippedPieces,
    };
}

// ============================================================================
// 5단계: raw-sequential difference (S13 동작) — fallback 안전망
//
// Agent A 의 패턴: hole-punching 이 throw 또는 null geometry 반환 시 S13 raw 차감으로 폴백.
// ============================================================================
function computeHoledGeometryRawSequential(parentFeature, subFeatures) {
    let remaining = turf.feature(parentFeature.geometry);
    let appliedSubs = 0;
    for (const sub of subFeatures) {
        const subTurf = turf.feature(sub.geometry);
        try {
            let diff;
            try {
                diff = _turfDifferenceCompat(remaining, subTurf);
            } catch (e) {
                // 시그니처 fallback
                diff = turf.difference(remaining, subTurf);
            }
            if (diff === null || diff === undefined) continue;
            remaining = diff;
            appliedSubs++;
        } catch (e) {
            console.warn(`  [warn] raw difference 실패: ${parentFeature.properties.name} - ${sub.properties.name} (${e.message})`);
        }
    }
    if (appliedSubs === 0) return null;
    return remaining.geometry;
}

// ============================================================================
// 6단계: clipToParent 후처리 (Agent C)
//
// hole-punching 결과의 미세 sliver (V5 위반분, 부모 outer 밖으로 살짝 나간 영역) 제거.
// vertex 폭증 가드: turf.intersect 가 새 vertex 를 과도하게 생성하면 clip 폐기 →
//   hole-punching 의 부모 outer 100% 보존 (V3) 깨지지 않도록 보호.
// ============================================================================
function _collectVertices(geom) {
    if (!geom) return [];
    if (geom.type === 'Polygon') {
        const arr = [];
        for (const ring of geom.coordinates) for (const v of ring) arr.push(v);
        return arr;
    }
    if (geom.type === 'MultiPolygon') {
        const arr = [];
        for (const poly of geom.coordinates) for (const ring of poly) for (const v of ring) arr.push(v);
        return arr;
    }
    return [];
}

function _countPolygons(geom) {
    if (!geom) return 0;
    if (geom.type === 'Polygon') return 1;
    if (geom.type === 'MultiPolygon') return geom.coordinates.length;
    return 0;
}

function clipToParent(holedGeom, parentGeom) {
    if (!holedGeom) return { geom: holedGeom, clipUsed: false };
    try {
        const inter = _turfIntersectCompat(
            turf.feature(holedGeom),
            turf.feature(parentGeom)
        );
        if (!inter || !inter.geometry) return { geom: holedGeom, clipUsed: false };

        // 가드 1: vertex 폭증 — hole-punching 의 부모 outer 보존 (V3) 지키기.
        const beforeVtx = _collectVertices(holedGeom).length;
        const afterVtx = _collectVertices(inter.geometry).length;

        // 가드 2: polygon 수 폭증 — turf.intersect 가 fragmentation 일으키면 폐기.
        //   특히 부모 outer 가 한 폴리곤인데 clip 후 여러 폴리곤으로 쪼개지면 V3/V7 회귀.
        const beforePoly = _countPolygons(holedGeom);
        const afterPoly = _countPolygons(inter.geometry);

        const vtxOk = afterVtx <= Math.ceil(beforeVtx * 1.05) + 10;
        // polygon 은 추가 허용 안 함 (extras 영역 보존을 위해 = 이상도 폐기, 단 +0 까지는 허용)
        const polyOk = afterPoly <= beforePoly;

        if (!vtxOk || !polyOk) return { geom: holedGeom, clipUsed: false };
        return { geom: inter.geometry, clipUsed: true };
    } catch (e) {
        return { geom: holedGeom, clipUsed: false };
    }
}

// ============================================================================
// dispatcher — hole-punching 우선, 실패 시 raw fallback. clip-to-parent 후처리 적용.
//
// 반환: { geom, method } where method ∈ {'hole_punch', 'raw_fallback', 'fail', 'none'}
// ============================================================================
function computeHoledGeometry(parentFeature, subFeatures) {
    if (!subFeatures || subFeatures.length === 0) {
        return { geom: null, method: 'none', clipUsed: false };
    }

    // 1) hole-punching 우선 (Agent B)
    let primary = null;
    try {
        const hp = computeHoledGeometryHolePunch(parentFeature, subFeatures);
        if (hp && hp.geom) primary = hp.geom;
    } catch (e) {
        console.warn(`  [info] hole-punch 실패 → raw fallback: ${parentFeature.properties.name} (${e.message})`);
    }

    if (primary) {
        // 2) clipToParent 후처리 (Agent C, vertex 폭증 가드)
        const cp = clipToParent(primary, parentFeature.geometry);
        return { geom: cp.geom, method: 'hole_punch', clipUsed: cp.clipUsed };
    }

    // 3) raw-sequential fallback (Agent A / S13)
    try {
        const raw = computeHoledGeometryRawSequential(parentFeature, subFeatures);
        if (raw) {
            const cp = clipToParent(raw, parentFeature.geometry);
            return { geom: cp.geom, method: 'raw_fallback', clipUsed: cp.clipUsed };
        }
    } catch (e) {
        console.warn(`  [warn] raw fallback 실패: ${parentFeature.properties.name} (${e.message})`);
    }

    return { geom: null, method: 'fail', clipUsed: false };
}

// ============================================================================
// 메인 실행
// ============================================================================
function main() {
    console.log('[build_warn_zones_holed] Synthesis (B + C + A 로깅) 시작');

    if (!fs.existsSync(PARENT_PATH)) throw new Error(`부모 파일 없음: ${PARENT_PATH}`);
    if (!fs.existsSync(SUB_PATH)) throw new Error(`자식 파일 없음: ${SUB_PATH}`);

    const parents = JSON.parse(fs.readFileSync(PARENT_PATH, 'utf8'));
    const subs    = JSON.parse(fs.readFileSync(SUB_PATH, 'utf8'));
    console.log(`  부모 features: ${parents.features.length}, 자식 features: ${subs.features.length}`);

    const coastalMapping = loadCoastalMapping();
    const { childToParent } = buildParentChildIndex(coastalMapping);
    const { parentToSubs, unmatched } = mapSubsToParents(subs, childToParent);

    console.log(`  매핑된 자식: ${subs.features.length - unmatched.length} / ${subs.features.length}`);
    if (unmatched.length > 0) {
        console.log('  ⚠️  매핑 실패 자식:');
        unmatched.forEach(u => console.log(`     - "${u.name}" (정규화: "${u.normalized}")`));
    }

    // 재실행 안전성: 기존 _holedGeometry 모두 삭제 후 재계산 (Agent A 패턴)
    for (const f of parents.features) {
        if (f.properties && f.properties._holedGeometry !== undefined) {
            delete f.properties._holedGeometry;
        }
    }

    let withHoles = 0, withoutHoles = 0, clipUsedCount = 0;
    const methodCount = { hole_punch: 0, raw_fallback: 0, fail: 0, none: 0 };

    const parentsByNormName = {};
    for (const f of parents.features) {
        const key = normalizeChildName(f.properties.name);
        parentsByNormName[key] = f;
    }

    for (const parentName of Object.keys(parentToSubs)) {
        const normKey = normalizeChildName(parentName);
        const parentFeature = parentsByNormName[normKey];
        if (!parentFeature) {
            console.warn(`  [warn] 부모 GeoJSON 에 없는 zone: ${parentName} (정규화: ${normKey})`);
            continue;
        }
        const subList = parentToSubs[parentName];

        const result = computeHoledGeometry(parentFeature, subList);
        methodCount[result.method] = (methodCount[result.method] || 0) + 1;
        const clipMark = result.clipUsed ? ' clip=Y' : '';
        console.log(`  처리: ${parentFeature.properties.name} (자식 ${subList.length}) → ${result.method}${clipMark}`);

        if (result.geom) {
            parentFeature.properties._holedGeometry = result.geom;
            withHoles++;
            if (result.clipUsed) clipUsedCount++;
        } else {
            withoutHoles++;
        }
    }

    console.log(`  완료: holed 적용 ${withHoles}건, 미적용 ${withoutHoles}건`);
    console.log(`  방식별: hole_punch=${methodCount.hole_punch}, raw_fallback=${methodCount.raw_fallback}, fail=${methodCount.fail}`);
    console.log(`  clipToParent 적용: ${clipUsedCount}건 (vertex 폭증 가드 통과)`);

    fs.writeFileSync(PARENT_PATH, JSON.stringify(parents, null, 2), 'utf8');
    const newSize = fs.statSync(PARENT_PATH).size;
    console.log(`  파일 갱신 완료: ${PARENT_PATH} (${(newSize / 1024).toFixed(1)} KB)`);
    console.log('[build_warn_zones_holed] 종료');
}

main();
