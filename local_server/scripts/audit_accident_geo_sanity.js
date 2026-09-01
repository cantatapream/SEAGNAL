/**
 * ============================================================================
 * 파일명: local_server/scripts/audit_accident_geo_sanity.js
 * 역할  : 사고정보(hk+person) 전체에 대해 두 가지 지리적 이상치를 전수조사한다
 *         (사용자 지시 2026-08-31: "폴리곤과 해양경찰서 관할이 기본적으로
 *         설정되어 있는데... 태안해양경찰서인데 동해 쪽에 나오고 이런 경우가
 *         있더라... 20마일 이상 떨어져 있는 것이 있는지 전수조사해줘. 또는
 *         육지에 올라가 있는 것, 해안선으로부터 10km 이상 들어가 있는 것도").
 *         읽기 전용 — 아무 파일도 고치지 않고 콘솔 요약 + 후보 목록 JSON만 남긴다.
 * ----------------------------------------------------------------------------
 * [검사 1: 자기 관할서 폴리곤과의 거리 — hk 전용] audit_hk_jurisdiction_mismatch.js 는
 *   "그 좌표가 속한 폴리곤의 소유자"와 "기록된 관할서"가 다른지를 보지만, 이번
 *   요청은 다르다 — "기록된 관할서 자기 자신의 폴리곤"에서 얼마나 떨어져
 *   있는지를 직접 잰다(예: 태안 라벨인데 좌표가 동해 근처면, 동해 폴리곤과는
 *   무관하게 "태안 자기 폴리곤에서 몇 마일 떨어졌나"만 본다). 점이 자기 관할
 *   폴리곤 "안"이면 거리 0. 밖이면 그 관할의 모든 면(섬 등 다중 면 포함) 중
 *   가장 가까운 경계까지 거리를 잰다. 20해리(≈37.04km) 이상이면 후보로 남긴다.
 *   person(인명사고)은 이 검사에서 제외한다 — 사용자 확정 2026-08-31: "인명사고는
 *   관할이 없기때문에 놔둬야돼"(관할서 필드가 hk처럼 신뢰할 수 있는 관할 배정이
 *   아님). [제외] orgCd=0(관할 미상)·사천해양경찰서(폴리곤 자체가 없음 — 위 감사
 *   스크립트와 동일 사유)도 비교 기준이 없어 이 검사에서 제외한다.
 * [검사 2: 해안선에서 10km 이상 내륙 — hk+person 둘 다] client/land_mask_korea.json
 *   (전 세계 육지 마스크, 통짜 유라시아 링 포함이라 포인트 쿼리가 느림 — 위도
 *   0.5도 버킷 인덱스로 속도 확보)로 ray-casting해 "육지 안"으로 판정된 점만,
 *   가장 가까운 해안선까지 거리를 재 10km 이상이면 후보로 남긴다.
 *   accident_info.js 헤더 주석(L57~)에 이미 기록된 교훈 — "육지 마스크는 해안선
 *   근처 국소 오차가 있어 얕은 육지판정은 대량 오탐(진짜 해변·방파제 사고)을
 *   낳는다" — 를 그대로 따라 10km 문턱으로 얕은 오차를 걸러낸다(사용자가 그
 *   문턱을 명시로 지정함). 이 검사는 관할서와 무관해 person도 포함한다.
 * [검사 범위] accident_info.js 의 KOREA_BOUNDS(lat 24~44, lon 118~144)와 동일한
 *   범위만 본다 — 그 밖은 런타임에서 이미 지도에 안 뜨는 좌표라(isOutOfKoreaBounds
 *   필터) 사용자가 실제로 보고 있는 마커와 무관하다.
 * [실행] node local_server/scripts/audit_accident_geo_sanity.js
 * [출력] 콘솔 요약 + local_server/scripts/_accident_raw/geo_sanity_candidates.json
 *   (읽기 전용 산출물, 원본 데이터는 건드리지 않음)
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, '..', 'config');
const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');
const OUT_PATH = path.join(__dirname, '_accident_raw', 'geo_sanity_candidates.json');

const ORG_LABEL_OF = {
    1532418: '속초해양경찰서', 1532440: '동해해양경찰서', 1532466: '포항해양경찰서', 1532304: '울산해양경찰서',
    1532329: '부산해양경찰서', 1532357: '창원해양경찰서', 1532376: '통영해양경찰서', 1532170: '여수해양경찰서',
    1532199: '완도해양경찰서', 1532222: '목포해양경찰서', 1532255: '군산해양경찰서', 1532056: '보령해양경찰서',
    1532074: '태안해양경찰서', 1532098: '평택해양경찰서', 1532121: '인천해양경찰서', 1532508: '제주해양경찰서',
    1532530: '서귀포해양경찰서', 1532281: '부안해양경찰서', 1532609: '울진해양경찰서', 1532759: '사천해양경찰서',
    1532865: '강릉해양경찰서',
    1750163: '속초해양경찰서', 1750186: '동해해양경찰서', 1750213: '포항해양경찰서', 1750259: '울산해양경찰서',
    1750283: '부산해양경찰서', 1750311: '창원해양경찰서', 1750329: '통영해양경찰서', 1750374: '여수해양경찰서',
    1750403: '완도해양경찰서', 1750426: '목포해양경찰서', 1750461: '군산해양경찰서', 1750494: '보령해양경찰서',
    1750511: '태안해양경찰서', 1750533: '평택해양경찰서', 1750556: '인천해양경찰서', 1750608: '제주해양경찰서',
    1750612: '제주해양경찰서', 1750631: '서귀포해양경찰서', 1750632: '서귀포해양경찰서',
};

const KOREA_BOUNDS = { latMin: 24, latMax: 44, lonMin: 118, lonMax: 144 };
const NM_TO_KM = 1.852;
const FAR_THRESHOLD_KM = 20 * NM_TO_KM; // 37.04km
const INLAND_THRESHOLD_KM = 10;
const KM_PER_DEG = 111; // 위경도 1도 ≈ 111km 근사(기존 감사 스크립트와 동일 공식)

function pointInPolygon(lon, lat, coords) {
    let inside = false;
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
        const xi = coords[i][0], yi = coords[i][1];
        const xj = coords[j][0], yj = coords[j][1];
        const intersect = ((yi > lat) !== (yj > lat)) &&
            (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function distPointToSegmentDeg(lon, lat, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((lon - x1) * dx + (lat - y1) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = x1 + t * dx, py = y1 + t * dy;
    return Math.hypot(lon - px, lat - py);
}

function distToPolygonBoundaryDeg(lon, lat, coords) {
    let best = Infinity;
    for (let i = 0; i < coords.length; i++) {
        const [x1, y1] = coords[i];
        const [x2, y2] = coords[(i + 1) % coords.length];
        const d = distPointToSegmentDeg(lon, lat, x1, y1, x2, y2);
        if (d < best) best = d;
    }
    return best;
}

/** 위도 버킷 인덱스 — land_mask_korea.json 이 유라시아 통짜 링(24만점)을 포함해
 * 전수 ray-casting 이 느리다. 각 변(edge)을 그 y범위가 걸치는 모든 버킷에 등록해두면,
 * 쿼리 점은 자기 버킷의 변만 검사하면 된다(그 위도를 안 걸치는 변은 애초에 교차 불가). */
function buildLatBucketIndex(rings, bucketDeg) {
    const buckets = new Map();
    rings.forEach((ring) => {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
            const minY = Math.min(yi, yj), maxY = Math.max(yi, yj);
            const b0 = Math.floor(minY / bucketDeg), b1 = Math.floor(maxY / bucketDeg);
            for (let b = b0; b <= b1; b++) {
                if (!buckets.has(b)) buckets.set(b, []);
                buckets.get(b).push(xi, yi, xj, yj);
            }
        }
    });
    return buckets;
}

function isLandPointIndexed(buckets, bucketDeg, lon, lat) {
    const edges = buckets.get(Math.floor(lat / bucketDeg));
    if (!edges) return false;
    let inside = false;
    for (let k = 0; k < edges.length; k += 4) {
        const xi = edges[k], yi = edges[k + 1], xj = edges[k + 2], yj = edges[k + 3];
        if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
}

/** 육지 판정된 점의 "해안선까지 거리" — 문턱보다 조금 넉넉한 창의 버킷들만 모아
 * 최근접 변까지의 거리를 잰다(육지 판정된 점만 대상이라 건수가 적어 브루트포스로도
 * 충분히 빠름). */
function distToCoastlineKm(buckets, bucketDeg, lon, lat, searchDeg) {
    const b = Math.floor(lat / bucketDeg);
    const span = Math.ceil(searchDeg / bucketDeg);
    let best = Infinity;
    for (let bb = b - span; bb <= b + span; bb++) {
        const edges = buckets.get(bb);
        if (!edges) continue;
        for (let k = 0; k < edges.length; k += 4) {
            const d = distPointToSegmentDeg(lon, lat, edges[k], edges[k + 1], edges[k + 2], edges[k + 3]);
            if (d < best) best = d;
        }
    }
    return best === Infinity ? null : best * KM_PER_DEG;
}

function inKoreaBounds(lat, lon) {
    return lat >= KOREA_BOUNDS.latMin && lat <= KOREA_BOUNDS.latMax &&
        lon >= KOREA_BOUNDS.lonMin && lon <= KOREA_BOUNDS.lonMax;
}

function main() {
    const faces = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'coastguard_jurisdiction_faces.json'), 'utf8'));
    const gangneung = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'coastguard_gangneung_zone.json'), 'utf8'));
    const landMask = JSON.parse(fs.readFileSync(path.join(CLIENT_DIR, 'land_mask_korea.json'), 'utf8'));
    const hkData = JSON.parse(fs.readFileSync(path.join(CLIENT_DIR, 'accident_ships_hk.json'), 'utf8'));
    const personData = JSON.parse(fs.readFileSync(path.join(CLIENT_DIR, 'accident_persons.json'), 'utf8'));

    const facesByOwner = {};
    faces.forEach((f) => { (facesByOwner[f.owner] || (facesByOwner[f.owner] = [])).push(f.coords); });
    (facesByOwner['강릉해양경찰서'] || (facesByOwner['강릉해양경찰서'] = [])).push(gangneung.coords);

    console.log('[해안선/육지 마스크 인덱스 구축 중]');
    const BUCKET_DEG = 0.5;
    const latBuckets = buildLatBucketIndex(landMask.rings, BUCKET_DEG);
    console.log('  버킷 수', latBuckets.size, '· 원본 링', landMask.rings.length, '개');

    const farCandidates = [];
    const inlandCandidates = [];
    let total = 0, outOfBounds = 0, checked = 0;
    let farChecked = 0, farNoPolygon = 0, farOk = 0, farFlagged = 0;
    let inlandOnLand = 0, inlandFlagged = 0;

    function process(sourceKey, rows, doFarCheck) {
        const orgIdx = sourceKey === 'hk' ? 8 : 5;
        rows.forEach((row, idx) => {
            total++;
            const lat = row[0], lon = row[1];
            if (!inKoreaBounds(lat, lon)) { outOfBounds++; return; }
            checked++;

            const orgCd = row[orgIdx];
            const orgName = ORG_LABEL_OF[orgCd];

            // 검사 1: 자기 관할서 폴리곤과의 거리(hk만, doFarCheck 로 제어)
            if (doFarCheck) {
                if (orgName && orgName !== '사천해양경찰서' && facesByOwner[orgName]) {
                    farChecked++;
                    const ownFaces = facesByOwner[orgName];
                    let inside = false;
                    for (let i = 0; i < ownFaces.length && !inside; i++) {
                        if (pointInPolygon(lon, lat, ownFaces[i])) inside = true;
                    }
                    if (inside) {
                        farOk++;
                    } else {
                        let bestDeg = Infinity;
                        ownFaces.forEach((coords) => {
                            const d = distToPolygonBoundaryDeg(lon, lat, coords);
                            if (d < bestDeg) bestDeg = d;
                        });
                        const km = bestDeg * KM_PER_DEG;
                        if (km >= FAR_THRESHOLD_KM) {
                            farFlagged++;
                            farCandidates.push({
                                source: sourceKey, idx, lat, lon, ymd: row[2], org: orgName,
                                distKm: Math.round(km * 10) / 10, distNm: Math.round(km / NM_TO_KM * 10) / 10,
                            });
                        } else {
                            farOk++;
                        }
                    }
                } else {
                    farNoPolygon++;
                }
            }

            // 검사 2: 해안선에서 10km 이상 내륙(hk+person 둘 다)
            if (isLandPointIndexed(latBuckets, BUCKET_DEG, lon, lat)) {
                inlandOnLand++;
                const km = distToCoastlineKm(latBuckets, BUCKET_DEG, lon, lat, INLAND_THRESHOLD_KM / KM_PER_DEG * 3);
                if (km != null && km >= INLAND_THRESHOLD_KM) {
                    inlandFlagged++;
                    inlandCandidates.push({
                        source: sourceKey, idx, lat, lon, ymd: row[2],
                        org: orgName || String(orgCd), distKm: Math.round(km * 10) / 10,
                    });
                }
            }
        });
    }

    console.log('\n[검사 실행]');
    process('hk', hkData.rows, true);
    process('person', personData.rows, false);

    console.log('\n=== 검사 1: 자기 관할서 폴리곤과의 거리(hk만, 20해리=' + FAR_THRESHOLD_KM.toFixed(1) + 'km 문턱) ===');
    console.log('hk 전체', hkData.rows.length, '건');
    console.log('검사 대상(KOREA_BOUNDS 안, 런타임에 실제로 보이는 범위) 중 폴리곤 비교 가능', farChecked, '건');
    console.log('  (비교 불가 — 관할미상/사천/미확인 코드)', farNoPolygon, '건');
    console.log('  자기 폴리곤 안 또는 20해리 이내 — 정상', farOk, '건');
    console.log('  ❗ 20해리 이상 이탈', farFlagged, '건');
    if (farCandidates.length) {
        const byOrg = {};
        farCandidates.forEach((c) => { byOrg[c.org] = (byOrg[c.org] || 0) + 1; });
        console.log('  관할서별 분포:');
        Object.entries(byOrg).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log('   ', n + '건', k));
        console.log('  거리 상위 20건:');
        farCandidates.slice().sort((a, b) => b.distKm - a.distKm).slice(0, 20).forEach((c) => {
            console.log('   ', c.ymd, c.org, '→', c.distNm + '해리(' + c.distKm + 'km)', '@', c.lat + ',' + c.lon, 'idx=' + c.idx);
        });
    }

    console.log('\n=== 검사 2: 해안선에서 10km 이상 내륙(hk+person) ===');
    console.log('KOREA_BOUNDS 안 검사 대상', checked, '건 중 육지 마스크상 "육지 안"으로 판정된 점', inlandOnLand, '건');
    console.log('  ❗ 해안선에서 10km 이상 안쪽', inlandFlagged, '건');
    if (inlandCandidates.length) {
        const byOrg2 = {};
        inlandCandidates.forEach((c) => { byOrg2[c.org] = (byOrg2[c.org] || 0) + 1; });
        console.log('  관할서별 분포:');
        Object.entries(byOrg2).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log('   ', n + '건', k));
        console.log('  거리 상위 20건:');
        inlandCandidates.slice().sort((a, b) => b.distKm - a.distKm).slice(0, 20).forEach((c) => {
            console.log('   ', c.source, c.ymd, c.org, '→', c.distKm + 'km 내륙', '@', c.lat + ',' + c.lon, 'idx=' + c.idx);
        });
    }

    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, JSON.stringify({ farCandidates, inlandCandidates }, null, 1));
    console.log('\n후보 목록 저장:', OUT_PATH);
}

main();
