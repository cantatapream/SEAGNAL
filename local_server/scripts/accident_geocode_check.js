/**
 * ============================================================================
 * 파일명: scripts/accident_geocode_check.js
 * 역할  : 위치텍스트에 "OO 동방 5마일"처럼 방위+거리가 적힌 사고정보(선박·해경) 행을
 *         카카오 로컬 키워드 검색 API로 역검증해, 텍스트가 가리키는 위치와
 *         실제 저장된 좌표가 크게 어긋나는 행을 찾아낸다.
 * ----------------------------------------------------------------------------
 * [배경] findCoordOutliers(client/js/marine-life/safety/accident_info.js)는 같은
 *   위치텍스트가 2건 이상일 때만 좌표를 서로 비교해 이상치를 잡는데, 실측 결과
 *   위치텍스트 있는 26,108건 중 90.4%(23,607건)가 텍스트가 유일해 비교 대상이
 *   없었다(2026-08-21 조사) — 이 필터의 사각지대. 그중 49.8%(13,010건)는
 *   "기준지명 + 방위 + 거리" 패턴이라, 기준지명을 지오코딩해 방위·거리로 예상좌표를
 *   계산하면 검증할 수 있다.
 * [지오코딩 서비스 — Nominatim → 카카오로 교체(2026-08-22)] 처음엔 OpenStreetMap
 *   Nominatim으로 1차 조사(전수 실행, 의심 후보 1,134건)했으나, 결과를 실제로 검토하니
 *   "임원"·"우도"·"마라도"·"정자" 같은 지명에서 Nominatim이 매번 동일한(그리고 실제
 *   위치와 다른) 좌표를 반환하는 체계적 오류가 다수 확인됐다(예: "임원"이 들어간 서로
 *   다른 행 여러 건이 전부 같은 잘못된 좌표로 지오코딩됨) — OSM은 한국 소지명 커버리지가
 *   낮은 게 원인으로 추정. 우리 앱이 해양종합정보 탭 지도 검색에 이미 쓰고 있는 카카오
 *   로컬 키워드 검색 API(routes/tide.js 의 /api/search-place 참고)가 한국 지명 정확도가
 *   훨씬 높아 이걸로 교체했다.
 * [주의 — 실행 환경] dapi.kakao.com 은 이 저장소의 개발 샌드박스(Claude Code on the
 *   web)에서는 프록시 정책상 접속이 막혀 있고(2026-08-22 curl 재현 시 403 확인), 로컬에
 *   KAKAO_REST_API_KEY 도 설정돼 있지 않다. GitHub Actions(accident-geocode-check.yml)
 *   나 프로덕션 서버(fly.dev)처럼 외부망이 열려 있고 키가 설정된 환경에서 실행해야 한다.
 * [필요 환경변수] KAKAO_REST_API_KEY — 브라우저에서 쓰는 /api/search-place 프록시와
 *   같은 키를 그대로 쓴다(카카오 디벨로퍼스 REST API 키).
 * [정확도 한계] 기준지명 자체가 소규모 포구·간출암 등이면 카카오 지도에도 없을 수 있고
 *   (그 경우 지오코딩 실패로 건너뜀), 있어도 그 지명의 "대표 지점"과 사고 발생지점 사이에는
 *   원래 수 km 정도 오차가 있을 수 있어 THRESHOLD_KM 을 넉넉히(기본 30km) 잡았다.
 *   그래도 걸리는 건수는 자동삭제하지 말고 검수 모드로 사람이 최종 확인할 것.
 * [출력] local_server/data/accident_geocode_suspects.json — 의심 후보 목록(원본
 *   client/accident_ships_hk.json 은 건드리지 않는다).
 * [실행] node local_server/scripts/accident_geocode_check.js [--limit=50]
 * [연계] client/js/marine-life/safety/accident_info.js 의 findCoordOutliers 필터,
 *   client/accident_ships_hk.json(입력), local_server/routes/tide.js 의 /api/search-place
 *   (같은 카카오 API 키를 공유하는 브라우저용 프록시)
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HK_JSON_PATH = path.join(__dirname, '..', '..', 'client', 'accident_ships_hk.json');
const OUT_PATH = path.join(__dirname, '..', 'data', 'accident_geocode_suspects.json');
const POS_IDX = 4; // hk 행: [lat, lon, ymd, hm, pos, typeCd, causeCd, shipCd, orgCd, rescue, death, missing]

const KAKAO_URL = 'https://dapi.kakao.com/v2/local/search/keyword.json';
const KAKAO_API_KEY = process.env.KAKAO_REST_API_KEY;
const REQUEST_DELAY_MS = 100; // 카카오는 Nominatim보다 훨씬 관대하지만 안전하게 여유를 둔다
const THRESHOLD_KM = 30; // 이 이상 어긋나면 의심 후보

// "기준지명 + 방위(+거리)" 패턴. 거리 단위: 마일/해리(선박 위치 표기 관례상 해리로 간주)·km·m.
const DIR_PATTERN = /^(.*?)\s*(동남|동북|서남|서북|동|서|남|북)방\s*([0-9.]+)\s*(마일|해리|km|m)/;
const BEARING_DEG = { 북: 0, 동북: 45, 동: 90, 동남: 135, 남: 180, 서남: 225, 서: 270, 서북: 315 };

function parseArgs() {
    const limitArg = process.argv.find((a) => a.startsWith('--limit='));
    return { limit: limitArg ? parseInt(limitArg.split('=')[1], 10) : 50 };
}

/** 위치텍스트에서 [기준지명, 방위각(도), 거리(km)]를 뽑는다. 매치 안 되면 null. */
function parseDirectionDistance(posText) {
    const m = posText.match(DIR_PATTERN);
    if (!m) return null;
    const base = m[1].trim();
    if (!base) return null;
    const bearingDeg = BEARING_DEG[m[2]];
    let distanceKm = parseFloat(m[3]);
    if (m[4] === '마일' || m[4] === '해리') distanceKm *= 1.852;
    else if (m[4] === 'm') distanceKm /= 1000;
    return { base, bearingDeg, distanceKm };
}

/** 구면 공식으로 (lat,lon)에서 bearingDeg 방향으로 distanceKm 만큼 이동한 지점. */
function destinationPoint(lat, lon, bearingDeg, distanceKm) {
    const R = 6371; // 지구 반지름(km)
    const brng = (bearingDeg * Math.PI) / 180;
    const lat1 = (lat * Math.PI) / 180;
    const lon1 = (lon * Math.PI) / 180;
    const dR = distanceKm / R;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dR) + Math.cos(lat1) * Math.sin(dR) * Math.cos(brng));
    const lon2 = lon1 + Math.atan2(
        Math.sin(brng) * Math.sin(dR) * Math.cos(lat1),
        Math.cos(dR) - Math.sin(lat1) * Math.sin(lat2)
    );
    return { lat: (lat2 * 180) / Math.PI, lon: (lon2 * 180) / Math.PI };
}

function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 카카오 로컬 키워드 검색. 실패·미발견 시 null. */
async function geocode(query) {
    const url = `${KAKAO_URL}?query=${encodeURIComponent(query)}&size=1`;
    const res = await fetch(url, { headers: { Authorization: `KakaoAK ${KAKAO_API_KEY}` } });
    if (!res.ok) return null;
    const data = await res.json();
    const docs = data.documents || [];
    if (!docs.length) return null;
    return { lat: parseFloat(docs[0].y), lon: parseFloat(docs[0].x) };
}

async function main() {
    if (!KAKAO_API_KEY) {
        console.error('KAKAO_REST_API_KEY 환경변수가 설정되지 않았습니다.');
        process.exit(1);
    }
    const { limit } = parseArgs();
    const data = JSON.parse(fs.readFileSync(HK_JSON_PATH, 'utf8'));
    const rows = data.rows;

    // findCoordOutliers 사각지대와 동일 조건: 같은 위치텍스트가 1건뿐(비교 대상 없음).
    const textGroups = {};
    rows.forEach((row, origIndex) => {
        const pos = row[POS_IDX];
        if (!pos) return;
        (textGroups[pos] || (textGroups[pos] = [])).push(origIndex);
    });
    const candidates = [];
    Object.keys(textGroups).forEach((pos) => {
        if (textGroups[pos].length !== 1) return;
        const origIndex = textGroups[pos][0];
        const parsed = parseDirectionDistance(pos);
        if (parsed) candidates.push({ origIndex, row: rows[origIndex], parsed });
    });

    console.log(`전체 ${rows.length}건 중 "위치텍스트 유일 + 방위·거리 패턴" 대상: ${candidates.length}건`);
    const targets = limit > 0 ? candidates.slice(0, limit) : candidates;
    console.log(`이번 실행 대상: ${targets.length}건 (--limit=${limit}, 0이면 전수)`);

    const geocodeCache = new Map(); // 같은 기준지명 중복 조회 방지
    const suspects = [];
    let geocodeFailCount = 0;

    for (let i = 0; i < targets.length; i++) {
        const { origIndex, row, parsed } = targets[i];
        let baseCoord = geocodeCache.get(parsed.base);
        if (baseCoord === undefined) {
            baseCoord = await geocode(parsed.base);
            geocodeCache.set(parsed.base, baseCoord);
            await sleep(REQUEST_DELAY_MS);
        }
        if (!baseCoord) { geocodeFailCount++; continue; }

        const expected = destinationPoint(baseCoord.lat, baseCoord.lon, parsed.bearingDeg, parsed.distanceKm);
        const actualLat = row[0], actualLon = row[1];
        const offKm = haversineKm(actualLat, actualLon, expected.lat, expected.lon);

        if (offKm >= THRESHOLD_KM) {
            suspects.push({
                origIndex, pos: row[POS_IDX], ymd: row[2],
                actual: [actualLat, actualLon],
                baseGeocode: [baseCoord.lat, baseCoord.lon],
                expected: [expected.lat, expected.lon],
                offsetKm: Math.round(offKm * 10) / 10
            });
        }
        if ((i + 1) % 20 === 0) console.log(`진행 ${i + 1}/${targets.length}, 의심 후보 ${suspects.length}건`);
    }

    fs.writeFileSync(OUT_PATH, JSON.stringify({ generatedAt: null, thresholdKm: THRESHOLD_KM, suspects }, null, 2));
    console.log(`완료 — 지오코딩 실패(건너뜀) ${geocodeFailCount}건, 의심 후보 ${suspects.length}건`);
    console.log(`결과 저장: ${OUT_PATH}`);
    console.log(`origIndex 목록만 뽑아 검수 모드처럼 확인: ${JSON.stringify(suspects.map((s) => s.origIndex))}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
