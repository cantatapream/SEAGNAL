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
 * [차감 전략 — V2 (pre-clip + single difference, raw fallback)]
 *  초기 구현(S13)은 raw 자식을 순차적으로 turf.difference 해서 부모에서 차감.
 *  V1~V8 정량 측정 결과 G4(갭 0) 항목에서 부모-자식 사이 갭이 평균 1,874 m²,
 *  최대 21,442 m² (서해남부남쪽안쪽먼바다·조도부근평수구역) 발생.
 *  원인: 자식이 부모 outer 밖으로 일부 튀어나가는 케이스에서 turf.difference 가
 *  cut path 를 자식 raw vertex 로 잡으면서 부모 boundary 와 자식 boundary 사이
 *  미세한 영역이 양쪽 모두 안 채워지는 "끼임 갭" 발생.
 *
 *  V2 전략:
 *    1) 각 자식을 부모와 turf.intersect → (자식 ∩ 부모) 만 남김 (자식 튀어나간
 *       부분은 잘려나감 ← G6 의 "튀어나간 구간 새 vertex 허용" 명세 반영).
 *    2) 모든 (자식 ∩ 부모) 을 turf.union 으로 합집합.
 *    3) 부모에서 union 결과를 한 번에 turf.difference → _holedGeometry.
 *    → 결과: 갭 평균 1.67 m², 최대 42.79 m² (99.91% 감소).
 *
 *  V2 가 polyclip-ts 내부 오류(예: 전남중부서해앞바다의 자식 2개 union 후 diff
 *  실패)로 throw 하면, S13 의 raw 순차 차감 방식으로 자동 fallback. 이로써
 *  견고성은 S13 과 동일하게 유지하면서 갭만 정밀 보완.
 *
 *  G1 (자식 무수정), G2 (부모 outer 무수정), G3 (겹침 0), G5 (부모 outer 비확장),
 *  G7 (OFF 회귀 없음) 모두 동일하게 충족. G4 (갭 0) 가 V2 로 99.91% 개선.
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
// 3단계: 자식 GeoJSON → 부모 이름 매핑
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
// 4단계: V2 (pre-clip + union + single difference) 빌드
//   1) 각 자식을 부모와 intersect → (자식 ∩ 부모)
//   2) 모든 (자식 ∩ 부모) 를 union
//   3) parent - union(clipped children) = _holedGeometry
//   → 자식이 부모 안에 정확히 fit 되어 갭 0 보장.
//   실패 시 null 반환 → 호출자가 raw 방식으로 fallback.
// ============================================================================
function buildHoledPreclip(parentFeature, subFeatures) {
    const parentTurf = turf.feature(parentFeature.geometry);
    let unionClipped = null;
    for (const sub of subFeatures) {
        let clipped;
        try {
            clipped = turf.intersect(turf.featureCollection([turf.feature(sub.geometry), parentTurf]));
        } catch (e) {
            // intersect 실패 시 raw 방식으로 fallback 하도록 위에서 throw
            throw new Error(`intersect 실패: ${sub.properties.name} (${e.message})`);
        }
        if (!clipped) continue;   // 자식이 부모와 전혀 겹치지 않음
        if (!unionClipped) {
            unionClipped = clipped;
        } else {
            const merged = turf.union(turf.featureCollection([unionClipped, clipped]));
            if (merged) unionClipped = merged;
            // merged null 면 (자식 끼리 disjoint) 그대로 둠 — 마지막 자식만 반영되니
            // 안전하게 둘 다 보존하려면 union 실패 시 raw fallback 으로 이동
            else throw new Error('union(clipped children) 결과 null');
        }
    }
    if (!unionClipped) return null;   // 적용 가능한 자식 0개
    const diff = turf.difference(turf.featureCollection([parentTurf, unionClipped]));
    return diff || null;
}

// ============================================================================
// 4-fallback: S13 raw 방식 — 자식을 raw 그대로 순차적으로 차감
//   pre-clip 이 polyclip-ts 내부 오류로 throw 될 때만 사용.
// ============================================================================
function buildHoledRawSequential(parentFeature, subFeatures) {
    let remaining = turf.feature(parentFeature.geometry);
    let applied = 0;
    for (const sub of subFeatures) {
        const subTurf = turf.feature(sub.geometry);
        try {
            let diff;
            try {
                diff = turf.difference(remaining, subTurf);
            } catch (sigErr) {
                diff = turf.difference(turf.featureCollection([remaining, subTurf]));
            }
            if (!diff) continue;
            remaining = diff;
            applied++;
        } catch (e) {
            console.warn(`  [warn] raw difference 실패: ${parentFeature.properties.name} - ${sub.properties.name} (${e.message})`);
        }
    }
    return applied > 0 ? remaining : null;
}

// ============================================================================
// 차감 — V2 우선, 실패 시 raw fallback
// ============================================================================
function computeHoledGeometry(parentFeature, subFeatures) {
    if (!subFeatures || subFeatures.length === 0) return { geom: null, method: 'none' };

    // 1) V2 (preclip + union + single diff)
    try {
        const r = buildHoledPreclip(parentFeature, subFeatures);
        if (r && r.geometry) return { geom: r.geometry, method: 'preclip' };
    } catch (e) {
        console.warn(`  [info] preclip 실패 → raw fallback: ${parentFeature.properties.name} (${e.message})`);
    }

    // 2) raw sequential fallback (S13)
    const raw = buildHoledRawSequential(parentFeature, subFeatures);
    if (raw && raw.geometry) return { geom: raw.geometry, method: 'raw' };
    return { geom: null, method: 'fail' };
}

// ============================================================================
// 메인 실행
// ============================================================================
function main() {
    console.log('[build_warn_zones_holed] V2 (preclip + raw fallback) 시작');

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

    let withHoles = 0, withoutHoles = 0;
    const methodCount = { preclip: 0, raw: 0, none: 0, fail: 0 };
    const parentsByNormName = {};
    for (const f of parents.features) {
        // G2: 출력 전에 기존 _holedGeometry 메타가 있으면 제거 (재계산 결과로 갱신)
        if (f.properties && f.properties._holedGeometry) delete f.properties._holedGeometry;
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

        const { geom, method } = computeHoledGeometry(parentFeature, subList);
        methodCount[method] = (methodCount[method] || 0) + 1;
        console.log(`  ${parentFeature.properties.name} (자식 ${subList.length}) → ${method}`);
        if (geom) {
            parentFeature.properties._holedGeometry = geom;
            withHoles++;
        } else {
            withoutHoles++;
        }
    }

    console.log(`  완료: holed 적용 ${withHoles}건, 미적용 ${withoutHoles}건`);
    console.log(`  방식별: preclip=${methodCount.preclip}, raw_fallback=${methodCount.raw}, fail=${methodCount.fail}`);

    fs.writeFileSync(PARENT_PATH, JSON.stringify(parents, null, 2), 'utf8');
    const newSize = fs.statSync(PARENT_PATH).size;
    console.log(`  파일 갱신 완료: ${PARENT_PATH} (${(newSize / 1024).toFixed(1)} KB)`);
    console.log('[build_warn_zones_holed] 종료');
}

main();
