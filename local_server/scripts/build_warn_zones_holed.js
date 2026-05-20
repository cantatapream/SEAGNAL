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
 * [왜 turf.difference 인가]
 *  단순 hole 추가(부모 ring 에 자식 ring 을 그대로 추가)는 두 GeoJSON 의 좌표
 *  정밀도가 달라(KMA 원본 검증 결과 일치율 50~90%) 외곽선 어긋남 발생.
 *  자식이 부모 외곽 밖으로 일부 튀어나가는 케이스도 있음.
 *  turf.difference 는 두 polygon 의 차집합을 정확히 계산하므로:
 *   • 자식이 부모 안에 완전 포함 → 깔끔히 도려냄
 *   • 자식이 부모 밖으로 튀어나감 → 부모와 겹친 부분만 차감
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
// 4단계: 각 부모 feature 에 대해 turf.difference 로 자식 영역 차감
//   feature.properties._holedGeometry = (차감 결과 polygon 의 geometry)
//   자식이 0개면 _holedGeometry 미설정 (클라이언트가 원본 geometry 사용)
// ============================================================================
function computeHoledGeometry(parentFeature, subFeatures) {
    // 부모 feature 를 turf Feature 로 변환
    let parentTurf = turf.feature(parentFeature.geometry);

    // 각 자식 feature 의 polygon 을 순차적으로 차감
    let remaining = parentTurf;
    let appliedSubs = 0;
    for (const sub of subFeatures) {
        const subTurf = turf.feature(sub.geometry);
        try {
            // turf.difference 는 두 turf Feature(또는 FeatureCollection) 를 받아
            // 첫 인자 - 두 번째 인자 의 차집합을 반환. null 가능 (완전 포함 등 케이스).
            // turf v6+: turf.difference(featureCollection) 또는 difference(f1, f2)
            // 호환성 위해 try-catch 로 두 시그니처 모두 시도.
            let diff;
            try {
                diff = turf.difference(remaining, subTurf);
            } catch (sigErr) {
                // turf v7+ 새 시그니처
                diff = turf.difference(turf.featureCollection([remaining, subTurf]));
            }
            if (diff === null || diff === undefined) {
                // 자식이 부모와 전혀 겹치지 않음 → 차감할 게 없음, 부모 그대로
                continue;
            }
            remaining = diff;
            appliedSubs++;
        } catch (e) {
            console.warn(`  [warn] difference 실패: ${parentFeature.properties.name} - ${sub.properties.name} (${e.message})`);
        }
    }

    if (appliedSubs === 0) {
        return null;   // 자식 없음 또는 모두 미적용
    }
    return remaining.geometry;
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
