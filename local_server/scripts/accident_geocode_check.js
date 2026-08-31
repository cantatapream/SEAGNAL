/**
 * ============================================================================
 * 파일명: scripts/accident_geocode_check.js
 * 역할  : 위치텍스트에 "OO 동방 5마일"처럼 방위+거리가 적힌 사고정보(hk=선박·해경 /
 *         person=인명사고) 행을 카카오 로컬 키워드 검색 API로 역검증해, 텍스트가
 *         가리키는 위치와 실제 저장된 좌표가 크게 어긋나는 행을 찾아낸다.
 *         --source=hk(기본)|person 으로 대상을 고른다(사용자 요청 2026-08-31 —
 *         "인명사고도 카카오맵 API로 위치 대조·보정하고 싶다"에 따라 hk 전용이던
 *         스크립트를 소스 선택 가능하게 확장).
 * [person 은 "전수조사"(2026-08-31 사용자 확정)] hk 는 기존 그대로 "위치텍스트 유일 +
 *   방위·거리 패턴"만 검사(정밀, 대상 좁음). person 은 사용자가 "위치텍스트 21,798건
 *   전부를 조사하자, 정밀도가 낮아도 된다"고 명시적으로 골라 SOURCE_CONFIG.person.
 *   fullCensus=true — 유일 텍스트 제한을 없애고, 세 방식을 우선순위대로 시도한다(모두
 *   method 필드로 구분해 후보에 남김, 전부 사람이 검수 화면에서 최종 확인·자동삭제 아님):
 *   ① coord — 위치텍스트에 "Fix 36-03-34N, 129-31-59E"처럼 도분초 좌표가 그대로 박혀
 *      있으면 그걸 바로 씀(카카오 호출 자체가 필요 없고 지오코딩보다 정확 — 사고 당시
 *      실측 좌표이므로). person 78건에서 확인, 74건(94.9%) 파싱 성공.
 *   ② pattern — 방위·거리 패턴이 있으면 기준지명을 지오코딩해 정밀 계산.
 *   ③ fulltext — 위 둘 다 없으면 위치텍스트(서술어 제거 후)를 그대로 검색해 1위 결과와
 *      직접 비교(방위·거리 보정 없이 텍스트 자체를 지명으로 취급 — 셋 중 가장 부정확).
 * ----------------------------------------------------------------------------
 * [배경] findCoordOutliers(client/js/marine-life/safety/accident_info.js)는 같은
 *   위치텍스트가 2건 이상일 때만 좌표를 서로 비교해 이상치를 잡는데, 실측 결과
 *   위치텍스트 있는 26,108건 중 90.4%(23,607건)가 텍스트가 유일해 비교 대상이
 *   없었다(2026-08-21 조사, hk 기준) — 이 필터의 사각지대. 그중 49.8%(13,010건)는
 *   "기준지명 + 방위 + 거리" 패턴이라, 기준지명을 지오코딩해 방위·거리로 예상좌표를
 *   계산하면 검증할 수 있다. person 도 위치텍스트 21,798건 전부에 이 패턴이 1,811건
 *   있어(2026-08-31 확인) 같은 방식이 그대로 적용된다.
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
 * [출력] local_server/data/accident_geocode_suspects_{source}.json — 의심 후보
 *   목록(원본 client/accident_ships_hk.json·accident_persons.json 은 건드리지 않는다).
 * [실행] node local_server/scripts/accident_geocode_check.js [--source=hk|person] [--limit=50]
 * [연계] client/js/marine-life/safety/accident_info.js 의 findCoordOutliers 필터,
 *   client/accident_ships_hk.json·accident_persons.json(입력), local_server/routes/tide.js 의
 *   /api/search-place(같은 카카오 API 키를 공유하는 브라우저용 프록시)
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

// 소스별 입력 파일·위치텍스트 컬럼 위치. hk 행: [lat, lon, ymd, hm, pos, typeCd, causeCd,
// shipCd, orgCd, rescue, death, missing] · person 행: [lat, lon, ymd, pos, typeCd, orgCd, ...]
// (accident_info.js 의 COORD_OUTLIER_POS_IDX 와 동일한 컬럼 위치를 그대로 씀).
const SOURCE_CONFIG = {
    hk: { jsonPath: path.join(__dirname, '..', '..', 'client', 'accident_ships_hk.json'), posIdx: 4, fullCensus: false },
    person: { jsonPath: path.join(__dirname, '..', '..', 'client', 'accident_persons.json'), posIdx: 3, fullCensus: true },
};

const KAKAO_KEYWORD_URL = 'https://dapi.kakao.com/v2/local/search/keyword.json';
const KAKAO_ADDRESS_URL = 'https://dapi.kakao.com/v2/local/search/address.json';
const KAKAO_API_KEY = process.env.KAKAO_REST_API_KEY;
const REQUEST_DELAY_MS = 100; // 카카오는 Nominatim보다 훨씬 관대하지만 안전하게 여유를 둔다
const THRESHOLD_KM = 30; // 이 이상 어긋나면 의심 후보

// "기준지명 + 방위(+거리)" 패턴. 거리 단위: 마일/해리(선박 위치 표기 관례상 해리로 간주)·km·m.
// [버그 수정 2026-08-31] "동남·동북·서남·서북"(동/서가 먼저 오는 정식 표기)만 넣어뒀더니
// 실제 데이터에 흔한 "북동·북서·남동·남서"(북/남이 먼저 오는 표기, 예: "남동방 5.5해리")를
// 정규식이 못 알아채고 조용히 틀리게 파싱했다 — "북"/"남" 한 글자만 매치되고 그 뒤 "동"이
// bearing으로 잘못 잡혀 base 문자열에 "...남"이 섞여 들어가고 각도도 틀렸다(200건 실측
// 재현 확인 — pattern 12건 중 7건이 이 버그에 걸림). 두 어순 모두 명시.
// [2026-08-31 2차 개선] 복합방위(동남·북서 등)는 "방" 없이 "...남서 0.6해리"처럼도 자주
// 쓰인다 — 전체 데이터에서 이 표기만으로 214건이 fulltext(부정확)로 새서 pattern(정밀)으로
// 못 넘어가고 있었다. 그래서 복합방위는 "방" 을 선택적으로 만들었다. 단, 단일글자(동/서/
// 남/북)는 "방" 을 그대로 필수로 남긴다 — "방" 없이 허용하면 "~에서"(조사) 처럼 "서"로
// 끝나는 흔한 한글 어미까지 방위로 오인해 대량 오탐이 남을 실측으로 확인했다(예: "형산강
// 강변에서 100m" 의 "~에서"가 "서방향 100m" 로 잘못 파싱됨).
const DIR_PATTERN = /^(.*?)\s*((?:동남|동북|서남|서북|북동|북서|남동|남서)방?|(?:동|서|남|북)방)\s*([0-9.]+)\s*(마일|해리|km|m)/;
const BEARING_DEG = {
    북: 0, 동북: 45, 북동: 45, 동: 90, 동남: 135, 남동: 135,
    남: 180, 서남: 225, 남서: 225, 서: 270, 서북: 315, 북서: 315,
};

/** DIR_PATTERN 의 group2("동남방"·"북서"처럼 "방"이 붙어 있을 수도 없을 수도 있는 원문
 * 매치)에서 순수 방위 문자열(BEARING_DEG 의 키)만 뽑는다. */
function bearingKeyOf(rawBearing) {
    return rawBearing.endsWith('방') ? rawBearing.slice(0, -1) : rawBearing;
}

// person 위치텍스트 앞의 관할구역 태그("[내해2구역/흑산파출소]" 등) — 지명이 아니라
// 검색에 방해만 되므로 제거.
const LEADING_TAG_PATTERN = /^\[[^\]]*\]\s*/;

// fulltext 검색 시 끝에서 잘라낼 서술어(2026-08-31 사용자 지적 — "동막해수욕장 앞 갯벌"을
// 전체 검색하지 말고 "동막해수욕장"만 검색해야 한다). person 위치텍스트 19,987건의 끝단어
// 빈도를 실측해(node -e 로 직접 집계) 상위 빈도 중 "장소명 자체가 아니라 위치 관계·지형
// 서술어"인 것만 골랐다 — 보건지소·보건진료소·병원·선착장·방파제처럼 그 자체가 검색해야
// 할 고유명사(또는 그 일부)인 단어는 제외(빼면 오히려 못 찾게 됨). "자택"(157건)은
// 처음에 이 부류로 착각해 남겨뒀으나 — 사용자 지적대로 "자택"은 그 자체가 결코 지명이
// 아니라("본인 집"이라는 뜻일 뿐, 카카오에 검색될 리 없음) 순수 필러라 뒤늦게 추가.
// 표본: 해상 5421·갯바위 914·인근 630·해안가 307·갯벌 288·앞 267·인근해상 256·TTP 124·
// 끝단 67·부근 65·테트라포트 60·항내 34·거주 34·내측 11·외측 12·아래 17·위 7·자택 157.
// [2026-08-31 2차 정제] cleanKeyword 적용 후에도 남는 끝단어를 전체(19,832건) 재집계해
// 밑(66)·입구(55)·주변(43)과, 거리 없이 방위만 남은 경우(예: "...낭도 동방" — DIR_PATTERN은
// 숫자가 있어야 매치되므로 이런 건 fulltext 로 넘어와 "동방"이 그대로 검색어에 남아있었다)
// 를 추가로 확인해 반영.
const TRAILING_FILLER_WORDS = new Set([
    '해상', '인근해상', '인근', '부근', '앞', '근처', '끝단', '사이', '중', '내',
    'TTP', '테트라포트', '테트라포드', '항내', '거주', '근해', '갯바위', '해안가', '갯벌', '해변', '앞바다',
    '내측', '외측', '아래', '위', '약', '자택', '밑', '입구', '주변',
    '동방', '서방', '남방', '북방', '동남방', '동북방', '서남방', '서북방', '북동방', '북서방', '남동방', '남서방',
]);

// 위치텍스트에 도분초 좌표가 문자 그대로 박혀 있는 경우("Fix 36-03-34N, 129-31-59E" 등,
// 2026-08-31 사용자 지적 — "경위도가 있으면 그 경위도를 비교하면 되는거 아니니?"). person
// 21,798건 중 78건에서 "Fix" 표기를 확인, 그중 74건(94.9%)이 이 정규식으로 파싱된다(도-분
// 만 있고 초가 없는 표기·소수점 분 표기 둘 다 지원). 이 좌표는 카카오 검색 결과가 아니라
// 사고 당시 기록된 실측 좌표 그 자체라 지오코딩보다 훨씬 정확 — API 호출 없이 그대로
// "예상좌표"로 쓴다(pattern·fulltext 보다 우선순위 높음). 도-분-초 사이 구분자가 "."인
// 표기·좌표 자체가 오타인 극소수(4건)는 못 잡지만 억지로 다 잡으려다 오탐 만드는 것보다
// 안전(카파시: 억지로 끼워맞추면 더 큰 오탐).
const DMS_PATTERN = /(\d{1,3})-(\d{1,2}(?:\.\d+)?)(?:-(\d{1,2}(?:\.\d+)?))?\s*N\D{0,6}(\d{1,3})-(\d{1,2}(?:\.\d+)?)(?:-(\d{1,2}(?:\.\d+)?))?\s*E/i;

function dmsToDecimal(deg, min, sec) {
    return parseInt(deg, 10) + parseFloat(min) / 60 + (sec ? parseFloat(sec) : 0) / 3600;
}

/** 위치텍스트에서 도분초 좌표를 뽑는다("Fix 36-03-34N, 129-31-59E" 형태). 없으면 null.
 * 분·초는 0~59.99 범위를 벗어나면 원문 자체가 오타("35-94.39N"처럼 분이 60 넘음 — 실측
 * 240건 중 1건 확인)이므로 매치를 버린다(억지로 계산하면 터무니없는 좌표가 나옴). */
function parseEmbeddedCoord(posText) {
    const m = posText.match(DMS_PATTERN);
    if (!m) return null;
    const minOk = (v) => !v || (parseFloat(v) >= 0 && parseFloat(v) < 60);
    if (!minOk(m[2]) || !minOk(m[3]) || !minOk(m[5]) || !minOk(m[6])) return null;
    return { lat: dmsToDecimal(m[1], m[2], m[3]), lon: dmsToDecimal(m[4], m[5], m[6]) };
}

// 방위 없이 "약 0.5마일"처럼 거리만 붙은 채로 끝나는 경우(DIR_PATTERN 은 방위 단어가
// 있어야 매치되므로 이런 건 fulltext 로 넘어온다) — 숫자+단위만 있는 마지막 단어도 지운다.
const TRAILING_DISTANCE_ONLY = /^[0-9.]+(마일|해리|km|m)$/;

/** 검색어 정제 — 앞의 구역 태그, 끝의 서술어·거리표기를 걷어내고 남는 지명만 검색어로
 * 쓴다. fulltext(위치텍스트 전체)뿐 아니라 pattern 의 기준지명(base)에도 같이 쓴다 —
 * base 도 "[내해1구역] 전남 신안군 임자도"처럼 구역 태그가 섞이거나 "...아목섬 약"처럼
 * 방위 앞의 "약"이 섞여 들어오는 경우가 있었다(2026-08-31 확인). 다 걷어내면(원문이 필러
 * 단어뿐이면) 원문을 그대로 돌려준다(검색 실패해도 기존과 동일). */
function cleanKeyword(posText) {
    const text = posText.replace(LEADING_TAG_PATTERN, '').trim();
    const words = text.split(/\s+/);
    while (words.length > 1 && (TRAILING_FILLER_WORDS.has(words[words.length - 1]) || TRAILING_DISTANCE_ONLY.test(words[words.length - 1]))) {
        words.pop();
    }
    const stripped = words.join(' ').trim();
    return stripped || text;
}

function parseArgs() {
    const limitArg = process.argv.find((a) => a.startsWith('--limit='));
    const sourceArg = process.argv.find((a) => a.startsWith('--source='));
    const source = sourceArg ? sourceArg.split('=')[1] : 'hk';
    if (!SOURCE_CONFIG[source]) {
        console.error(`알 수 없는 --source=${source} (hk 또는 person만 가능)`);
        process.exit(1);
    }
    return { limit: limitArg ? parseInt(limitArg.split('=')[1], 10) : 50, source };
}

/** 위치텍스트에서 [기준지명, 방위각(도), 거리(km)]를 뽑는다. 매치 안 되면 null. */
function parseDirectionDistance(posText) {
    const m = posText.match(DIR_PATTERN);
    if (!m) return null;
    const base = cleanKeyword(m[1].trim());
    if (!base) return null;
    const bearingDeg = BEARING_DEG[bearingKeyOf(m[2])];
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

/** 카카오 API 한 번 호출, documents 배열만 돌려준다(실패·0건이면 빈 배열). */
async function kakaoSearch(url, query) {
    const full = `${url}?query=${encodeURIComponent(query)}&size=15`;
    const res = await fetch(full, { headers: { Authorization: `KakaoAK ${KAKAO_API_KEY}` } });
    if (!res.ok) return [];
    const data = await res.json();
    return data.documents || [];
}

/** 카카오 지오코딩 — 장소·상호 이름 검색(키워드 API)을 먼저 쓰고, 결과가 없으면 지번·
 * 도로명 주소 검색(주소 API)으로 다시 시도한다(2026-08-31 사용자 지적 — "충남 보령시
 * 오천면 원산도리 492-2번지"처럼 번지수만 있는 텍스트는 키워드 검색으론 잘 안 걸린다).
 * 검색어(예: "동막해수욕장")는 앞에 붙은 시·군 지명(예: "인천 강화도")으로 어느 정도
 * 지역이 좁혀지지만, 동명 지명이 전국에 흩어져 있을 수 있다(2026-08-31 사용자 지적).
 * size=1(1위 결과만)이 아니라 최대 15건을 받아, 그중 원본에 저장된 좌표(refLat,refLon)와
 * 가장 가까운 결과를 고른다 — 완전히 엉뚱한 지역에 찍힌 진짜 오류라면 동명 지명 중 가까운
 * 게 하나도 없어 그래도 멀리 떨어진 채로 남아 의심 후보로 잡히므로, 이 방식이 오류
 * 탐지력을 떨어뜨리지 않는다. 실패·미발견 시 null. */
async function geocode(query, refLat, refLon) {
    let docs = await kakaoSearch(KAKAO_KEYWORD_URL, query);
    if (!docs.length) docs = await kakaoSearch(KAKAO_ADDRESS_URL, query);
    if (!docs.length) return null;
    let best = docs[0], bestDist = Infinity;
    docs.forEach((d) => {
        const lat = parseFloat(d.y), lon = parseFloat(d.x);
        const dist = haversineKm(refLat, refLon, lat, lon);
        if (dist < bestDist) { bestDist = dist; best = d; }
    });
    return { lat: parseFloat(best.y), lon: parseFloat(best.x) };
}

async function main() {
    if (!KAKAO_API_KEY) {
        console.error('KAKAO_REST_API_KEY 환경변수가 설정되지 않았습니다.');
        process.exit(1);
    }
    const { limit, source } = parseArgs();
    const { jsonPath, posIdx, fullCensus } = SOURCE_CONFIG[source];
    const outPath = path.join(__dirname, '..', 'data', `accident_geocode_suspects_${source}.json`);
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const rows = data.rows;

    const candidates = [];
    if (fullCensus) {
        // person 전수조사: 위치텍스트가 있는 행 전부(중복 텍스트도 포함) — 도분초 좌표가
        // 박혀 있으면 그걸 그대로 씀(coord, 가장 정확·API 불필요), 없고 방위·거리 패턴이
        // 있으면 정밀 계산(pattern), 둘 다 없으면 텍스트 전체를 그대로 검색(fulltext).
        rows.forEach((row, origIndex) => {
            const pos = row[posIdx];
            if (!pos) return;
            const coord = parseEmbeddedCoord(pos);
            const dir = coord ? null : parseDirectionDistance(pos);
            const parsed = coord ? { mode: 'coord', ...coord }
                : dir ? { mode: 'pattern', ...dir }
                : { mode: 'fulltext', query: cleanKeyword(pos) };
            candidates.push({ origIndex, row, parsed });
        });
    } else {
        // hk: findCoordOutliers 사각지대와 동일 조건 — 같은 위치텍스트가 1건뿐(비교 대상
        // 없음) + 방위·거리 패턴이 있는 행만(기존 동작 그대로 유지).
        const textGroups = {};
        rows.forEach((row, origIndex) => {
            const pos = row[posIdx];
            if (!pos) return;
            (textGroups[pos] || (textGroups[pos] = [])).push(origIndex);
        });
        Object.keys(textGroups).forEach((pos) => {
            if (textGroups[pos].length !== 1) return;
            const origIndex = textGroups[pos][0];
            const dir = parseDirectionDistance(pos);
            if (dir) candidates.push({ origIndex, row: rows[origIndex], parsed: { mode: 'pattern', ...dir } });
        });
    }

    console.log(`[${source}] 전체 ${rows.length}건 중 검사 대상: ${candidates.length}건 (전수조사=${fullCensus})`);
    const targets = limit > 0 ? candidates.slice(0, limit) : candidates;
    console.log(`이번 실행 대상: ${targets.length}건 (--limit=${limit}, 0이면 전수)`);

    const geocodeCache = new Map(); // 같은 기준지명 중복 조회 방지
    const suspects = [];
    let geocodeFailCount = 0;

    for (let i = 0; i < targets.length; i++) {
        const { origIndex, row, parsed } = targets[i];
        const actualLat = row[0], actualLon = row[1];
        let expected, baseCoord;

        if (parsed.mode === 'coord') {
            // 위치텍스트에 박힌 도분초 좌표를 그대로 씀 — 지오코딩(검색) 없이 바로 비교하므로
            // API 호출·지연(sleep) 자체가 필요 없다.
            expected = { lat: parsed.lat, lon: parsed.lon };
            baseCoord = expected;
        } else {
            const cacheKey = parsed.mode === 'pattern' ? parsed.base : parsed.query;
            baseCoord = geocodeCache.get(cacheKey);
            if (baseCoord === undefined) {
                // 같은 검색어를 쓰는 첫 행의 저장좌표를 동명 지명 disambiguation 기준점으로
                // 쓴다(캐시는 검색어 단위라 두 번째 행부터는 재사용) — geocode() 참고.
                baseCoord = await geocode(cacheKey, actualLat, actualLon);
                geocodeCache.set(cacheKey, baseCoord);
                await sleep(REQUEST_DELAY_MS);
            }
            if (!baseCoord) { geocodeFailCount++; continue; }

            // pattern: 기준지명에서 방위·거리만큼 이동한 지점과 비교. fulltext: 검색 결과(동명
            // 지명 중 저장좌표와 가장 가까운 것)를 그 자체로 예상좌표 삼아 비교(방위·거리 보정
            // 없음, 그만큼 부정확할 수 있어 method 로 표시).
            expected = parsed.mode === 'pattern'
                ? destinationPoint(baseCoord.lat, baseCoord.lon, parsed.bearingDeg, parsed.distanceKm)
                : baseCoord;
        }

        const offKm = haversineKm(actualLat, actualLon, expected.lat, expected.lon);

        if (offKm >= THRESHOLD_KM) {
            suspects.push({
                origIndex, pos: row[posIdx], ymd: row[2], method: parsed.mode,
                keyword: parsed.mode === 'coord' ? '(위치텍스트 내 도분초 좌표)' : parsed.mode === 'pattern' ? parsed.base : parsed.query,
                actual: [actualLat, actualLon],
                baseGeocode: [baseCoord.lat, baseCoord.lon],
                expected: [expected.lat, expected.lon],
                offsetKm: Math.round(offKm * 10) / 10
            });
        }
        if ((i + 1) % 20 === 0) console.log(`진행 ${i + 1}/${targets.length}, 의심 후보 ${suspects.length}건`);
    }

    fs.writeFileSync(outPath, JSON.stringify({ generatedAt: null, source, thresholdKm: THRESHOLD_KM, suspects }, null, 2));
    console.log(`완료 — 지오코딩 실패(건너뜀) ${geocodeFailCount}건, 의심 후보 ${suspects.length}건`);
    console.log(`결과 저장: ${outPath}`);
    console.log(`origIndex 목록만 뽑아 검수 모드처럼 확인: ${JSON.stringify(suspects.map((s) => s.origIndex))}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
