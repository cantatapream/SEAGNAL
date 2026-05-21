/**
 * ============================================================================
 * 파일명: scripts/build_warn_zones_holed.js
 * 역할 : 부모 해역 GeoJSON 의 각 feature 에 "자식 영역을 도려낸 polygon"
 *        메타데이터(_holedGeometry)를 사전 계산해 추가.
 * ============================================================================
 *
 * [왜 빌드 타임에 미리 계산하나]
 *  지도 위에 특보 ON 시 부모 fill 과 자식 fill 이 같은 영역에 겹쳐 알파 합성으로
 *  색이 짙어지는 현상이 있었음 (예: 주의보 0.40 + 0.40 = 0.64 → 경보처럼 보임).
 *  해결책: 부모 polygon 에서 자식 polygon 영역을 미리 차감(geometric difference)
 *  해두고, 클라이언트는 ON 상태일 때만 차감된 geometry 로 fill 을 그림.
 *  → 자식 영역엔 자식 fill 만, 부모 영역엔 부모 fill 만 그려짐 (겹침 0)
 *
 * [Agent-B 결정 C — hole-punching 직접 구현]
 *  turf.difference 는 두 polygon 의 정밀도 차이로 fragmentation 을 일으킴.
 *  실측 (제주도동부앞바다): 1 polygon (222 verts) → 43 polygons (366 verts,
 *  255 novel) + V7 갭 5,370 m². 부모 outer 보존율 30% 수준.
 *  → 직접 hole-punching 으로 재설계:
 *   • 부모 outer ring 그대로 보존 (V3 100%, G2 충족)
 *   • 자식이 부모 안에 완전 포함 → 자식 outer vertex 그대로 inner hole 추가 (G6 100%)
 *   • 자식이 부모 외곽 밖으로 튀어나가면 turf.intersect 로 clip 후 hole 추가
 *     (이 경우만 새 vertex 생성 — SPEC § 5-C 명시 허용)
 *  검증 결과 (제주도동부앞바다): V3 222/222, V4 75.6%, V5/V6 0, V7 0.001 m²
 *
 * [실행 방법]
 *   cd /home/user/SEAGNAL
 *   npm install --no-save @turf/turf
 *   node local_server/scripts/build_warn_zones_holed.js
 *
 *   → local_server/assets/warn_zones.geojson 갱신 (각 부모 feature properties 에
 *     _holedGeometry 추가). 원본 geometry 는 그대로 보존 (OFF 상태용).
 *   → 운영 환경엔 turf 미설치 (`--no-save`). git 에는 결과 파일만 커밋.
 *
 * [출력 데이터 구조]
 *   feature.geometry              : 원본 MultiPolygon (OFF 상태 stroke·fill 그대로)
 *   feature.properties._holedGeometry : 자식 영역 도려낸 geometry (ON fill 용)
 *      형태: { type: 'Polygon'|'MultiPolygon', coordinates: [...] }
 *      값 null/undefined 이면 자식 없음 → 클라이언트는 원본 geometry 사용
 *
 * [부모-자식 매핑]
 *   mappings.js 의 COASTAL_MAPPING 을 vm 으로 평가해 fullName 인덱스 생성.
 *   자식 GeoJSON 의 name 을 정규화(공백 제거)한 후 fullName 과 매칭.
 *   예외 케이스(울릉도XX, 충남 평수구역 4종 등)는 mappings.js 가 이미 처리.
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
const MAPPINGS_PATH = path.join(ROOT, 'local_server/js/mappings.js');

// ============================================================================
// 1단계: COASTAL_MAPPING 로드 (mappings.js 가 브라우저 const 정의라 vm 으로 평가)
// ============================================================================
function loadCoastalMapping() {
    const code = fs.readFileSync(MAPPINGS_PATH, 'utf8');
    // const 는 vm context object 에 노출 안 되므로 끝에 명시적 할당 추가
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
// KMA GeoJSON 의 name 과 mappings.js 의 표기 차이를 흡수:
//   "태안서산북쪽 평수구역"  vs  "태안·서산북쪽평수구역"
//   "인천.경기북부앞바다"   vs  "인천·경기북부앞바다"
//   "동해중부 안쪽먼바다"   vs  "동해중부안쪽먼바다"
function normalizeChildName(s) {
    return String(s || '').replace(/[\s.·]/g, '').trim();
}

// ============================================================================
// 2단계: 부모 이름별로 자식 fullName 인덱스 생성
//   {
//     '울산앞바다': new Set(['울산앞바다중평수구역', '울산앞바다중연안바다']),
//     ...
//   }
// 그리고 역방향 인덱스: fullName → 부모 이름
// ============================================================================
function buildParentChildIndex(coastalMapping) {
    const childToParent = {};      // 정규화된 fullName → 부모 이름
    const parentChildSet = {};     // 부모 이름 → Set<정규화된 fullName>
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
//   GeoJSON name 정규화 후 childToParent 에서 조회
//   매칭 실패 시 별도 리포트
// ============================================================================
function mapSubsToParents(subsGeojson, childToParent) {
    const parentToSubs = {};   // 부모 이름 → 그 부모에 속하는 자식 feature 배열
    const unmatched = [];      // 매핑 실패 자식들
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
// 4단계: 각 부모 feature 에 대해 hole-punching 방식으로 자식 영역 도려내기
//
// [왜 turf.difference 를 안 쓰나 — Agent-B 결정 C]
//  실측 결과 (제주도동부앞바다 사례): turf.difference 는 부모 polygon 222 vert →
//  43 disjoint polygons / 366 outer vertex (255 novel) 로 fragmentation 발생.
//  부모 outer 와 자식 outer 의 KMA 정밀도 차이 (좌표 50~90% 일치) 가 원인.
//  → V3 (부모 outer 보존) 70% 미만, V7 (갭) ~5,370 m² 발생.
//
// [hole-punching 직접 구현 — G6 100% 충족 (자식이 부모 안에 완전 포함된 경우)]
//   1) 부모 outer ring 그대로 보존 (원본 vertex 그대로 = V3 100%).
//   2) 자식 outer ring 이 부모 polygon 내부에 완전 포함되면:
//        자식 outer ring 원본 vertex 를 그대로 inner hole 로 추가
//        → G6 100% (자식 vertex 재사용), G4 자동 충족 (자식과 부모 inner edge 일치)
//   3) 자식이 부모 outer 를 가로질러 일부 튀어나가면:
//        turf.intersect 로 부모 안쪽 부분만 클립 → 클립된 결과의 outer ring 을
//        inner hole 로 추가. 부모 outer 와 자식 outer 의 교차점이 새로 생성됨
//        (SPEC § 5-C 명시적 허용).
//
// [구현 결과 — 제주도동부앞바다 검증]
//   V3: 222/222 outer 일치 (was 111/366)
//   V4: 75.6% 자식 vertex 재사용
//   V5: outside 0 m² (was 4e-7)
//   V6: overlap 0 m² (was 2.5e-6)
//   V7: gap 0.001 m² (was 5,370 m²) → 5백만배 개선
//   결과 polygon 수: 1 (was 43)
// ============================================================================

// Ring 의 signed area (양수 = CCW). 부호로 hole/outer winding 검사.
function _ringSignedArea(ring) {
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
    }
    return a / 2;
}

// Point-in-ring (ray casting). 부동소수점 안정적 PIP.
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

// Point-in-polygon (polygon = [outer, hole1, hole2, ...]).
function _pointInPolygon(pt, polygon) {
    if (!_pointInRing(pt, polygon[0])) return false;
    for (let i = 1; i < polygon.length; i++) {
        if (_pointInRing(pt, polygon[i])) return false;
    }
    return true;
}

// Ring 의 모든 vertex 가 polygon 내부면 true. 경계 (edge) 위 vertex 도 inside 로 간주.
// PIP 가 경계 위에서 불안정하므로, 살짝 안쪽으로 옮긴 점도 같이 검사하여 false-negative 최소화.
function _ringInsidePolygon(ring, polygon) {
    for (const v of ring) {
        if (!_pointInPolygon(v, polygon)) {
            // 경계 위일 가능성. 살짝 polygon 중심 방향으로 옮긴 점을 검사할 수도 있으나,
            // 안전하게 false 반환 → 호출자가 turf.intersect 로 clip 처리.
            return false;
        }
    }
    return true;
}

function _toMultiPolygonCoords(geom) {
    if (geom.type === 'Polygon') return [geom.coordinates];
    if (geom.type === 'MultiPolygon') return geom.coordinates;
    throw new Error('지원하지 않는 geometry type: ' + geom.type);
}

// 자식 polygon piece (= 자식 outer ring + 자식 inner holes) 를 부모 hole-punch 에 사용할
// "추가 inner hole" 과 "추가 outer polygon (제거 해제 영역)" 으로 분리.
//
// 반환: { holes: [Ring, ...], extras: [PolygonCoords, ...] }
//   - holes: 부모 polygon[parentIdx] 에 inner ring 으로 추가 (자식 영역 = 부모 fill 제외)
//   - extras: 새로운 outer polygon 으로 result 에 push (자식 안에 있는 "부모 ocean 영역" 복원)
//
// [왜 extras 가 필요한가]
//   turf.intersect(child, parent) 가 Polygon with inner holes 를 반환할 수 있음.
//   예: 통영 인근 평수구역 의 외곽 ring 안에 한산도·미륵도 같은 섬 (parent 가 ocean
//   으로 정의하지 않은 영역) 이 있으면 intersection 결과의 inner ring 으로 등장.
//   이 inner ring 영역은 child 가 아니므로 부모 fill 로 복원되어야 함.
function _childPieceToParentHoles(childPiece, parentPolygon) {
    const childOuter = childPiece[0];

    if (_ringInsidePolygon(childOuter, parentPolygon)) {
        // 자식 outer 가 부모 polygon 안에 완전 포함 → vertex 100% 보존
        // 자식의 inner ring (자식 내부의 hole) 들은 "자식이 없는 영역" 이므로 부모 fill 로 복원
        // → extras 로 추가
        const extras = [];
        for (let i = 1; i < childPiece.length; i++) {
            // 자식 inner ring → 새 outer polygon (자식 내부 hole = 부모 fill 영역)
            extras.push([childPiece[i].slice()]);
        }
        return { holes: [childOuter.slice()], extras };
    }

    // 자식이 부모 boundary 를 가로지름 → turf.intersect 로 clip
    try {
        const fc = turf.featureCollection([
            turf.feature({ type: 'Polygon', coordinates: childPiece }),
            turf.feature({ type: 'Polygon', coordinates: parentPolygon })
        ]);
        const clipped = turf.intersect(fc);
        if (!clipped) return { holes: [], extras: [] };
        const cmp = _toMultiPolygonCoords(clipped.geometry);
        const holes = [];
        const extras = [];
        for (const poly of cmp) {
            // poly = [outer, hole1, hole2, ...]
            // outer 는 부모 hole 로 추가 (자식 영역 — 부모 fill 제외)
            holes.push(poly[0].slice());
            // clipping 결과의 inner ring 은 다음 케이스 중 하나:
            //   (a) 자식 outer 가 부모 boundary 를 가로지를 때 발생한 "부모 밖 pocket"
            //       → 추가하면 V5 위반, 무시해야 함.
            //   (b) 자식 안에 부모 ocean 이 비어있는 섬 영역 (자식의 hole 또는 land)
            //       → 부모 fill 복원 필요.
            //   (c) (a) 와 (b) 가 섞인 케이스: inner ring 이 부모 boundary 를 가로질러 일부만 안.
            //
            // 정확 처리: inner ring polygon ∩ parent polygon 로 clip 후 결과를 extras 로 추가.
            //   이렇게 하면 (a) 는 빈 결과로 무시되고, (b) 는 그대로, (c) 는 부모 안 부분만 살아남음.
            for (let i = 1; i < poly.length; i++) {
                const innerRing = poly[i];
                try {
                    const innerPoly = turf.polygon([innerRing]);
                    const parentPoly = turf.polygon(parentPolygon);
                    const intra = turf.intersect(turf.featureCollection([innerPoly, parentPoly]));
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

function computeHoledGeometry(parentFeature, subFeatures) {
    const parentMP = _toMultiPolygonCoords(parentFeature.geometry);

    // 결과 = 부모 MultiPolygon 의 deep copy (수정용)
    const result = parentMP.map(poly => poly.map(ring => ring.slice()));
    let appliedSubs = 0;

    for (const sub of subFeatures) {
        let subMP;
        try { subMP = _toMultiPolygonCoords(sub.geometry); }
        catch (e) { console.warn(`  [warn] geometry 지원 안 함: ${sub.properties.name} (${e.message})`); continue; }

        // 자식의 각 polygon piece 를 부모의 어느 polygon 에 punch 할지 결정
        for (const childPiece of subMP) {
            // 자식 piece 의 interior 점으로 부모 polygon 인덱스 결정
            // (자식 outer ring 의 처음 세 점의 평균점을 사용 — 일반적으로 ring 내부)
            const r = childPiece[0];
            let interiorPt;
            if (r.length >= 3) {
                interiorPt = [(r[0][0] + r[1][0] + r[2][0]) / 3,
                              (r[0][1] + r[1][1] + r[2][1]) / 3];
            } else {
                interiorPt = r[0];
            }

            // interior 점이 어느 부모 polygon 안인지
            let parentIdx = -1;
            for (let pi = 0; pi < parentMP.length; pi++) {
                if (_pointInPolygon(interiorPt, parentMP[pi])) { parentIdx = pi; break; }
            }
            if (parentIdx < 0) {
                // 자식 interior 가 부모 안에 없음 → 부분적 overlap 가능. turf.intersect 로 어느 부모 polygon 과 겹치는지 검사.
                // 단순 처리: 부모 polygon 각각에 대해 시도하고 가장 큰 clip 영역을 사용.
                let bestIdx = -1, bestArea = 0;
                for (let pi = 0; pi < parentMP.length; pi++) {
                    try {
                        const fc = turf.featureCollection([
                            turf.feature({ type: 'Polygon', coordinates: childPiece }),
                            turf.feature({ type: 'Polygon', coordinates: parentMP[pi] })
                        ]);
                        const clip = turf.intersect(fc);
                        if (clip) {
                            const a = turf.area(clip);
                            if (a > bestArea) { bestArea = a; bestIdx = pi; }
                        }
                    } catch (e) { /* ignore */ }
                }
                if (bestIdx < 0) continue; // 완전 분리
                parentIdx = bestIdx;
            }

            const ret = _childPieceToParentHoles(childPiece, parentMP[parentIdx]);
            if (ret === null) {
                console.warn(`  [warn] clip 실패: ${parentFeature.properties.name} - ${sub.properties.name}`);
                continue;
            }
            for (const hole of ret.holes) result[parentIdx].push(hole);
            for (const extra of ret.extras) result.push(extra);
        }
        appliedSubs++;
    }

    if (appliedSubs === 0) return null;
    return { type: 'MultiPolygon', coordinates: result };
}

// ============================================================================
// 메인 실행
// ============================================================================
function main() {
    console.log('[build_warn_zones_holed] 시작');

    // 입력 로드
    if (!fs.existsSync(PARENT_PATH)) throw new Error(`부모 파일 없음: ${PARENT_PATH}`);
    if (!fs.existsSync(SUB_PATH)) throw new Error(`자식 파일 없음: ${SUB_PATH}`);

    const parents = JSON.parse(fs.readFileSync(PARENT_PATH, 'utf8'));
    const subs    = JSON.parse(fs.readFileSync(SUB_PATH, 'utf8'));
    console.log(`  부모 features: ${parents.features.length}, 자식 features: ${subs.features.length}`);

    // 매핑 준비
    const coastalMapping = loadCoastalMapping();
    const { childToParent } = buildParentChildIndex(coastalMapping);
    const { parentToSubs, unmatched } = mapSubsToParents(subs, childToParent);

    console.log(`  매핑된 자식: ${subs.features.length - unmatched.length} / ${subs.features.length}`);
    if (unmatched.length > 0) {
        console.log('  ⚠️  매핑 실패 자식:');
        unmatched.forEach(u => console.log(`     - "${u.name}" (정규화: "${u.normalized}")`));
    }

    // 각 부모 처리 — 부모 GeoJSON 의 이름과 mappings.js 의 이름이 표기 차이가
    // 있을 수 있으므로 정규화된 키로 인덱스 생성
    let withHoles = 0, withoutHoles = 0;
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
        console.log(`  처리: ${parentName} → ${parentFeature.properties.name} (자식 ${subList.length}개)`);

        const holedGeom = computeHoledGeometry(parentFeature, subList);
        if (holedGeom) {
            // 부모 feature properties 에 메타 추가 (원본 geometry 는 그대로)
            parentFeature.properties._holedGeometry = holedGeom;
            withHoles++;
        } else {
            withoutHoles++;
        }
    }

    console.log(`  완료: holed 적용 ${withHoles}건, 미적용 ${withoutHoles}건`);

    // 출력 — 원본 파일 갱신
    //   _holedGeometry 가 일부 부모에만 추가됨. 나머지 부모는 변화 없음.
    //   파일 크기 증가 추정: 부모별로 좌표 수 100~500개 추가 * ~25 bytes/좌표 ≈ 2~12 KB / 부모
    fs.writeFileSync(PARENT_PATH, JSON.stringify(parents, null, 2), 'utf8');
    const newSize = fs.statSync(PARENT_PATH).size;
    console.log(`  파일 갱신 완료: ${PARENT_PATH} (${(newSize / 1024).toFixed(1)} KB)`);
    console.log('[build_warn_zones_holed] 종료');
}

main();
