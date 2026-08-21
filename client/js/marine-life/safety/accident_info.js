/**
 * ============================================================================
 * 파일명: client/js/marine-life/safety/accident_info.js
 * 역할  : 해양안전 지도에 "사고정보" 버튼을 얹는다. 클릭하면 왼쪽으로 선박(심판원)·
 *         인명 2개 소스 버튼(천기 팝아웃과 같은 개별 아이콘 버튼 스타일)이 뜨고,
 *         고르면 팝아웃이 접히며 데이터가 켜진다(선박(해경) 소스는 2026-08-20에
 *         제외 — 심판원 데이터가 같은 사고를 더 정확하게 담고 있어 더 필요 없다는
 *         사용자 확정). 이미 켜진
 *         상태에서 사고정보 버튼을 다시 누르면 access_control.js 등과 동일하게
 *         전부 끈다(사용자 확정 2026-08-19). "현황"(개별 사고 마커, hazard_rocks.js
 *         와 같은 클러스터 방식) ↔ "분석"(지도 화면을 격자로 나눠 격자별 건수를
 *         색으로 표시, 격자 클릭 시 통계 바텀시트) 토글은 사고정보가 켜진 동안만
 *         좌측 상단(#ocean-topleft-controls, 기본맵·안내 버튼 아래)에 나온다.
 *         낱개 마커는 사고유형별 이미지 아이콘(hazard_rocks.js 와 같은 120px
 *         캔버스 방식)이고, 여러 건이 뭉친 클러스터는 그 안에서 가장 많은
 *         사고유형의 이미지를 대표로 보여준다(hazard_rocks.js 는 "켜진 버튼"
 *         기준이라 다름 — 사용자 확정 2026-08-18). 켜면 access_control.js 등과
 *         같은 패턴으로 배경지도가 위성지도로 자동 전환된다(사용자 확정 2026-08-19).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : js/shared/utils/accident_codes.js(코드값→한글 라벨,
 *                    ACCIDENT_TYPE_ICONS 마커 이미지 경로, ACCIDENT_TYPE_EXCLUDED
 *                    표출 제외 목록), client/images/accident_markers/*.png,
 *                    OpenLayers(ol.*)
 *  - 서버 API      : GET /accident_ships_hs.json · /accident_persons.json
 *                    (정적, 소스 버튼을 처음 누를 때만 지연 로드 — hazard_rocks.js
 *                    와 동일한 절약 방식)
 *  - 마크업        : index2.html 의 #ocean-accident-toggle-btn(버튼),
 *                    #ocean-accident-wrap/#ocean-accident-popup(소스 선택 팝아웃),
 *                    #ocean-accident-source-list, #ocean-accident-mode-toggle
 *                    (현황/분석 — #ocean-topleft-controls 안, 해양안전 화면이
 *                    빌려 쓰는 해양종합정보 기본맵·안내 버튼 바로 아래),
 *                    #accident-stats-sheet/#accident-stats-body(격자 클릭 시 통계)
 *  - 나를 쓰는 곳  : ocean_map.js handleMapClick → window._accidentInfoTryHandleClick
 *                    (access_control.js 와 동일하게 window.getOceanMap 폴링으로
 *                    스스로 설치 — ocean_map.js buildMap() 수정 불필요)
 *                    window.oceanGetBasemap/oceanSetBasemap(ocean_map.js, 배경지도
 *                    자동 전환/복귀)
 * [로드 순서] navigational_warning.js 다음 · life_safety.js 바로 앞
 * [데이터 출처] 국립해양조사원 개방海 "선박사고(심판원)"·"인명사고" —
 *   local_server/scripts/build_accidents.js 로 생성(원본 CSV는 레포에 없음).
 * [좌표 이상치 필터] 원본 좌표(ORGNL_XCDNT/YCDNT) 자체에 개별 오류가 소수 섞여
 *   있다(사용자 보고: 지도상 위치가 주소 텍스트와 안 맞음 — 조사 결과 좌표 변환
 *   로직 문제가 아니라 원본 데이터 오류로 확인, 사용자 확정 2026-08-20: 이상치는
 *   지도에서 제외). ensureRawFeatures 가 같은 "사고발생위치" 텍스트를 가진 행들의
 *   좌표 중앙값과 비교해 0.3도(≈33km) 이상 벗어난 행을 제외한다(findCoordOutliers).
 *   같은 텍스트가 1건뿐이면 비교 대상이 없어 판정하지 않는다. 선박(심판원)은 이
 *   위치텍스트 컬럼이 원본에 없어 이 필터를 적용하지 못한다(그대로 노출).
 * [위치 미상 뭉침 필터] 사용자 보고(2026-08-20): "화면을 최대로 확대해도 여전히
 *   뭉쳐있는 클러스터가 있다" — 조사 결과 좌표 반올림이 아니라 위치텍스트가 완전히
 *   빈 값인 사고들이 관할 해양경찰서의 대표 좌표(청사 근처)로 채워져 완전히 동일한
 *   좌표를 갖고 있었다(hk 최대 30건까지 겹침, 실측 606건). 완전 동일 좌표는 클러스터
 *   distance=0(SPREAD_ZOOM 이상 줌)이어도 갈라지지 않으므로 최대 줌에서도 하나로
 *   보인다 — 실제 사고 위치가 아니라서 지도에서 뺀다(findMissingLocationClusters).
 * [육지 표출 — 재조사(2026-08-20 사용자 재확인 요청)] "여전히 육지에 마커가 많다"는
 *   재보고로 다시 판 결과, 두 가지 별개 원인을 찾았다:
 *   1) 클러스터 대표점 문제(주된 원인) — ol.source.Cluster 는 기본적으로 클러스터
 *      위치를 멤버 평균 좌표(centroid)로 계산하는데, 굴곡진 해안선(특히 서해)에서는
 *      흩어진 항구 여러 곳의 평균이 육지(반도) 한가운데로 나온다(실측: 태안 인근
 *      5,545건의 평균좌표가 육지 판정). createCluster 콜백으로 평균 대신 "멤버 중
 *      하나의 실제 좌표"를 대표점으로 쓰도록 고쳤다(createClusterAtRealPoint) —
 *      실제 좌표는 이미 정확하므로(아래) 이 방식이면 클러스터가 항상 진짜 사고
 *      지점 위에 놓인다.
 *   2) 원본 데이터베이스의 위도 입력 오타(정확히 ±1도, 소수) — LAT_OFFSET_FIXES 참고.
 *   [좌표 정확성 검증] 사용자가 khoa.go.kr 개방海 사이트 F12로 확인해준 실제 API
 *   (POST /oceanmap/map/cmm/selectListCluster.json, layer=tl_shpacc_hk_p)가 주는
 *   x/y(EPSG:5179)를 WGS84로 변환해 우리 데이터와 대조한 결과 13개 샘플이 100%
 *   정확히 일치했다 — build_accidents.js 의 좌표 변환 로직과 원본 CSV 좌표 자체는
 *   정확하다(API 를 다시 받아도 달라지지 않는다는 뜻). 즉 "육지에 있는 것처럼 보이는"
 *   마커 대다수는 좌표 오류가 아니라 위 클러스터 평균점 문제이거나, 실제로 항구·
 *   방파제·양식장처럼 해안에 매우 가까운 정확한 위치다(위성지도 배경에서 육지처럼
 *   보일 뿐). ocean_overlay.js 의 기존 육지 마스크(/api/ocean/land-mask)는 국소적
 *   오차가 있어(해안선 근처 일부 지점 — 서울시청·태평양·하와이 등 명백한 지점은
 *   정확) 단독 필터링 근거로는 못 쓰지만, 시군구 지명 참조표와 함께 "위도 ±1 오타"
 *   후보를 좁히는 이중검증 용도로는 활용했다(아래 LAT_OFFSET_FIXES).
 * [3차 재조사 — 강원 산악 내륙·범위밖 재확인(2026-08-20, 머지 후 재보고)] "머지 후에도
 *   완전 내륙(강원 산악)에 마커가 있고, '완도군' 사고가 필리핀 근처에 표시된다"는
 *   스크린샷 재보고로 다시 조사:
 *   - "완도군 금일읍 장도" 사고(hk, [4.08333, 127.16667])는 재확인 결과 KOREA_BOUNDS
 *     (latMin 24)로 이미 걸러짐을 확인(코드·서버 서빙 바이트까지 대조). 화면에 남아
 *     있었다면 배포 반영 지연/캐시가 원인일 가능성이 크다 — sw.js 는 정적 자원을
 *     stale-while-revalidate 로 캐시하지만 CACHE_VERSION 이 배포마다 bump 되어(Docker
 *     빌드 단계) 새 배포 후 재접속하면 새 캐시로 교체된다.
 *   - 강원 산악 내륙 클러스터는 원본이 "OO-00N, OO-00E"처럼 도(度) 단위로만 기록된
 *     저정밀 좌표(예: [38,128]) 때문으로 확인 — 양양군 사고 4건이 정확히 [38,128]로
 *     겹쳐 있었다(사용자가 본 "산속 클러스터"로 추정). 서해안처럼 해안이 완만한 곳은
 *     1도 반올림이어도 우연히 바다 근처에 남지만, 강원 동해안은 해안선 바로 뒤가
 *     태백산맥이라 반올림만으로 산속에 놓인다. isIntegerDegreeCoord + isLandPoint
 *     (land-mask 재사용, 이번엔 "정수도 좌표"로만 범위를 좁혀 적용 — 전체 좌표에
 *     적용하면 해안가 실제 사고까지 대량 오탐 제외됨, 실측 16%) 로 제외.
 *   - 위 두 필터로 못 잡는 개별 오류 4건(hk 2건: "OO 동방 N해리" 텍스트인데 좌표는
 *     반대로 산속에 있음 · person 2건: 통영시 사고인데 좌표가 강원권, 3도 이상
 *     어긋남 — ±1 오타도 이상치 비교군도 없음)은 KNOWN_BAD_COORDS 로 개별 제외.
 * [검수 모드 (2026-08-20 추가)] 자동/AI 판정만으론 못 잡는 개별 좌표 오류가 더
 *   있을 수 있어, 사용자가 실제 앱 화면(실제 위성지도·실제 마커 이미지)에서 직접
 *   눈으로 보고 골라낼 수 있게 만든 기능. 사고정보를 켜면 하단 중앙에 항상 함께
 *   뜬다(처음엔 ?debug=review 쿼리로 숨겼으나, 매번 쿼리를 붙이기 번거롭다는
 *   요청으로 상시 노출로 변경 — 패널은 기본 접힌 한 줄이라 평소엔 거의 안 보임).
 *   낱개 마커를 클릭하면 기존 상세 팝업이 그대로 뜨고(무슨 사고인지 보고 판단하도록)
 *   추가로 빨간 테두리가 켜지며 패널 목록에 쌓인다. 뭉친 클러스터를 클릭하면
 *   기존과 동일하게 그 범위로 확대만 될 뿐 선택되지 않는다 — 여러 건이 한 픽셀에
 *   뭉쳐 있을 때 실수로 전부 선택되는 걸 막기 위함(사용자 확정 2026-08-20). "내보내기"
 *   를 누르면 {hs:[origIndex,...], person:[...]} 형식 JSON 을 텍스트
 *   상자에 채운다 — KNOWN_BAD_COORDS 등 제외 목록에 반영할 원본 행 인덱스.
 * [선박(해경) 소스 완전 제외(2026-08-20)] 선박(심판원) 데이터가 같은 사고를 더
 *   정확하게 담고 있어 해경 소스가 더 필요 없다는 사용자 확정으로, 버튼·데이터
 *   fetch·필터·팝업·통계 등 hk 관련 코드를 전부 제거했다(정적 파일도 삭제).
 *   위쪽 재조사 기록(완도군·강원 내륙 등)에 남은 hk 관련 서술은 당시 조사한
 *   내용의 역사적 기록이라 그대로 둔다.
 * [검수 모드로 선박(심판원) 50건 수동 제외(2026-08-20)] 사용자가 검수 모드로 실제
 *   화면에서 낱개로 갈라 눈으로 확인 후 "내보내기"한 목록을 그대로 반영했다
 *   (`MANUAL_EXCLUDED_INDICES`). 좌표가 아닌 원본 rows 배열 인덱스로 특정한다.
 * ============================================================================
 */

(function () {
    'use strict';

    var SOURCES = {
        hs: { url: '/accident_ships_hs.json' },
        person: { url: '/accident_persons.json' }
    };

    // px — hazard_rocks.js 는 45(점이 훨씬 적어 그대로 둬도 안 빽빽함). 사고정보는
    // 건수가 많아 45면 화면에 클러스터가 너무 많이 보여(사용자 확정 2026-08-19) 100으로 키움.
    var CLUSTER_DISTANCE = 100;
    var SPREAD_ZOOM = 14;
    var GRID_COLS = 6, GRID_ROWS = 5; // 분석 모드 격자 — 화면 현재 범위를 이 칸수로 나눔
    var ICON_SCALE = 0.2875;    // hazard_rocks.js 와 동일 — 아이콘 원본이 같은 120px 캔버스

    var dataPromises = {};    // key -> Promise<row[]>
    var rawFeatures = {};     // key -> ol.Feature[] (EPSG:3857, 낱개 — 격자 집계용)
    var clusterLayers = {};   // key -> ol.layer.Vector (현황 모드)
    var gridLayer = null;     // 분석 모드 — 소스 전환/모드 전환마다 내용만 갈아끼움
    var gridSource = null;
    var bubbleOverlay = null; // 현황 모드 마커 팝업

    var state = { source: null, mode: 'status' };
    var _activeDetailTab = {};        // source key -> 현재 선택된 "사고발생상세" 탭
    var _statsKey = null;             // 통계 시트에 지금 표시 중인 source key
    var _statsMembers = null;         // 통계 시트에 지금 표시 중인 격자 셀의 feature 목록

    /**
     * [검수 모드 — 사고정보를 켜면 항상 함께 뜬다(사용자 확정 2026-08-20)]
     * 실제 지도(위성지도)·실제 마커 이미지 위에서 육지에 잘못 찍힌 개별 마커를 직접
     * 클릭으로 골라 제외 후보 목록을 만드는 기능 — 별도 웹페이지 검수 도구는 실제
     * 위성지도 타일을 못 불러와서, 실제 앱 화면 그대로 검수하고 싶다는 요청으로 추가.
     * 처음엔 ?debug=review 쿼리가 있을 때만 켰으나, 매번 링크에 쿼리를 붙이기 번거롭다는
     * 요청으로 상시 노출로 바꿨다 — 패널은 기본 접힌 한 줄(헤더)이라 평소엔 거의
     * 눈에 안 띈다. 낱개 마커를 클릭하면 기존 상세 팝업은 그대로 뜨고, 추가로 빨간
     * 테두리가 켜지며 내보내기 목록에 쌓인다. 다시 클릭하면 빠진다.
     */
    var REVIEW_MODE = true;
    var flaggedItems = new Map(); // "key:origIndex" -> {key, idx, row}
    var flagLayer = null;         // 빨간 테두리 오버레이(소스 무관 공용)

    // ── 데이터 로드 ─────────────────────────────────────────────────────────
    function fetchSource(key) {
        if (!dataPromises[key]) {
            dataPromises[key] = fetch(SOURCES[key].url).then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            }).then(function (data) { return data.rows || []; });
        }
        return dataPromises[key];
    }

    /** 소스별 사고유형(ACDNT_TYPE_CD) 컬럼 위치 — popupRowsFor·aggregateCounts 와 동일 인덱스. */
    function typeCodeOf(key, row) {
        if (key === 'hs') return row[10];
        return row[4]; // person
    }

    /**
     * 소스별 "사고발생위치" 텍스트(ACDNT_PSTN) 컬럼 위치 — 좌표 이상치 탐지에 쓴다.
     * hs(선박·심판원)는 이 텍스트 컬럼이 원본 CSV에 아예 없어 탐지 대상에서 뺀다
     * (사고해역코드는 "남해영해"처럼 범위가 넓어 이 방식의 비교 기준으로 못 씀).
     */
    var COORD_OUTLIER_POS_IDX = { person: 3 };

    /** 좌표 이상치 판정 기준 — 같은 위치텍스트 그룹의 중앙값에서 이만큼(도) 벗어나면 원본 데이터
     * 오류로 본다. 0.3도 ≈ 33km(사용자 보고 사례: "하동군 금남면 송문리" 위도가 같은 지명의
     * 다른 건들과 정확히 1도 어긋나 있었음 — build_accidents.js 헤더 주석 및 README 참고). */
    var COORD_OUTLIER_THRESHOLD_DEG = 0.3;

    /** 대한민국 근해를 넉넉히 포괄하는 범위(build_accidents.js 의 육지 마스크 bbox와 동일 감각).
     * 원본 CSV(build_accidents.js 의 isPlausibleLatLon 는 "위경도로서 물리적으로 가능한가"만
     * 검사해 전 세계 어디든 통과시킨다)에 대만·뉴질랜드·경도 0(대서양)처럼 명백히 엉뚱한
     * 좌표가 소수 섞여 있었다(hk 13건·hs 130건, 사용자 재확인 요청 2026-08-20으로 발견 —
     * 클러스터 좌표를 직접 뽑아보다가 남반구·적도 근처 값이 나와 알아챔). */
    var KOREA_BOUNDS = { latMin: 24, latMax: 44, lonMin: 118, lonMax: 144 };
    function isOutOfKoreaBounds(row) {
        return row[0] < KOREA_BOUNDS.latMin || row[0] > KOREA_BOUNDS.latMax ||
            row[1] < KOREA_BOUNDS.lonMin || row[1] > KOREA_BOUNDS.lonMax;
    }

    function median(nums) {
        var sorted = nums.slice().sort(function (a, b) { return a - b; });
        var mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    /**
     * 같은 "사고발생위치" 텍스트를 가진 행들끼리 좌표를 비교해 이상치를 걸러낸다.
     * 같은 텍스트가 1건뿐이면 비교 대상이 없어 판정하지 않는다(그대로 둔다) — 오탐보다
     * 놓치는 쪽이 안전하다는 판단(사용자 확정 2026-08-20).
     * @param {Array<Array>} rows - 원본 소스의 전체 행
     * @param {number} posIdx - 위치텍스트 컬럼 인덱스
     * @returns {Set<Array>} 이상치로 판정된 행의 집합
     */
    function findCoordOutliers(rows, posIdx) {
        var groups = {};
        rows.forEach(function (row) {
            var pos = row[posIdx];
            if (!pos) return;
            (groups[pos] || (groups[pos] = [])).push(row);
        });
        var outliers = new Set();
        Object.keys(groups).forEach(function (pos) {
            var g = groups[pos];
            if (g.length < 2) return;
            var medLat = median(g.map(function (r) { return r[0]; }));
            var medLon = median(g.map(function (r) { return r[1]; }));
            g.forEach(function (row) {
                if (Math.abs(row[0] - medLat) > COORD_OUTLIER_THRESHOLD_DEG ||
                    Math.abs(row[1] - medLon) > COORD_OUTLIER_THRESHOLD_DEG) {
                    outliers.add(row);
                }
            });
        });
        return outliers;
    }

    /** 위치텍스트가 없는 행 중 완전히 동일한 좌표를 가진 게 이만큼 이상이면 "위치 미상
     * → 관할서 대표좌표로 채움"으로 본다(사용자 보고 2026-08-20: 최대 줌으로 확대해도
     * 안 갈라지는 뭉치가 있음 — 조사 결과 hk 606건이 위치텍스트 완전 공란 + 같은 관할서
     * 좌표에 최대 30건까지 겹쳐 있었다. 실제 사고 위치가 아니라서 지도에서 뺀다). */
    var DUPLICATE_COORD_MIN_COUNT = 3;

    /**
     * 위치텍스트가 없는 행들끼리 좌표로 묶어, 완전히 겹친 뭉치(관할서 대표좌표로 의심)를 찾는다.
     * @param {Array<Array>} rows
     * @param {number} posIdx
     * @returns {Set<Array>}
     */
    function findMissingLocationClusters(rows, posIdx) {
        var groups = {};
        rows.forEach(function (row) {
            if (row[posIdx]) return; // 위치텍스트가 있으면 대상 아님
            var key = row[0] + ',' + row[1];
            (groups[key] || (groups[key] = [])).push(row);
        });
        var flagged = new Set();
        Object.keys(groups).forEach(function (key) {
            var g = groups[key];
            if (g.length >= DUPLICATE_COORD_MIN_COUNT) g.forEach(function (row) { flagged.add(row); });
        });
        return flagged;
    }

    /**
     * 원본 데이터베이스의 위도 입력 오타(정확히 ±1도) — 사용자 보고(2026-08-20: "거제도"
     * 관련 사고 여러 건이 위도만 1도 높게 찍혀 대구 부근 내륙에 표출됨)로 발견했다.
     * 시군구 지명 참조표(위치텍스트에 있는 지명의 대략적 중심좌표)와 국립해양조사원
     * 육지 마스크(/api/ocean/land-mask)를 함께 대조해, "원좌표는 육지인데 위도를
     * ±1 하면 그 지명 근처의 바다가 되는" 경우만 이중검증으로 골라냈다(hk 24건·
     * person 10건, 자동 판정을 넓게 걸면 오탐이 섞여 목록으로 못박음). KHOA
     * selectListCluster.json API 좌표와 100% 일치 확인 — 원본 DB 자체의 오타라
     * API를 다시 받아도 그대로다. [원위도, 경도, 보정위도] 형식.
     */
    var LAT_OFFSET_FIXES = {
        person: [
            [36.31583,126.62,37.31583],
            [35.975,128.58444,34.975],
            [35.89056,128.70444,34.89056],
            [36.66056,126.49583,35.66056],
            [34.14444,125.94472,35.14444],
            [34.14361,125.94528,35.14361],
            [37.12417,128.63306,38.12417],
            [34.99139,126.92111,33.99139],
            [35.825,128.09861,34.825],
            [35.83806,128.43778,34.83806]
        ]
    };

    /** row[0](위도)를 보정 목록과 정확히 일치하면 그 자리에서 고친다(hs는 목록 없어 no-op). */
    function applyLatOffsetFix(key, row) {
        var fixes = LAT_OFFSET_FIXES[key];
        if (!fixes) return;
        for (var i = 0; i < fixes.length; i++) {
            if (fixes[i][0] === row[0] && fixes[i][1] === row[1]) { row[0] = fixes[i][2]; return; }
        }
    }

    /**
     * [정수도 좌표 + 육지판정 필터 — 사용자 재확인 2026-08-20] "강원 산악 내륙에 마커가
     * 여전히 있다"는 재보고로 조사한 결과, 원본 위치가 "OO-00N, OO-00E" 처럼 도(度)
     * 단위로만 기록된 저정밀 좌표(예: [38,128])가 소수 섞여 있었다. 서해안처럼 해안이
     * 완만한 곳에서는 1도 반올림이어도 우연히 바다 근처에 남지만, 강원 동해안처럼 해안선
     * 바로 뒤가 태백산맥인 곳에서는 반올림만으로 산속에 놓인다(실측: 양양군 사고 4건이
     * 정확히 [38,128]로 겹쳐 있었음 — 사용자가 본 "산속 클러스터"로 추정).
     * ocean_overlay.js 가 쓰는 /api/ocean/land-mask 를 이 필터 전용으로 재사용하되,
     * 육지 마스크 자체의 국소 오차 때문에(README 참고) 전체 좌표에 적용하면 해안가
     * 실제 사고(해수욕장·방파제 등)까지 대량 오탐 제외된다(실측: 필터 통과분의 16%가
     * 육지 판정 — 그중 다수가 진짜 해변 사고). 그래서 "정수도 좌표"(전체의 0.1% 미만,
     * 애초에 정밀도가 낮아 보정 불가능한 값)로만 적용 범위를 좁혔다.
     */
    var LAND_MASK_URL = '/api/ocean/land-mask';
    var landMaskPromise = null;
    function ensureLandMask() {
        if (!landMaskPromise) {
            landMaskPromise = fetch(LAND_MASK_URL).then(function (r) { return r.json(); })
                .then(function (data) { return (data && data.success && data.rings) ? data.rings : null; })
                .catch(function () { return null; });
        }
        return landMaskPromise;
    }

    /** ray-casting: (lat,lon)이 육지 마스크 링(들) 안인지. ring = [[lon,lat],...]. */
    function isLandPoint(landRings, lat, lon) {
        if (!landRings) return false;
        var inside = false;
        for (var ri = 0; ri < landRings.length; ri++) {
            var ring = landRings[ri];
            for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
                if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
            }
        }
        return inside;
    }

    /** row[0]/row[1] 둘 다 정수도(소수부 없음)면 원본이 도 단위로만 기록된 저정밀 좌표. */
    function isIntegerDegreeCoord(row) {
        return Number.isInteger(row[0]) && Number.isInteger(row[1]);
    }

    /**
     * [개별 좌표 오류 — 위 필터들로 못 잡는 케이스] 정수도도 아니고 ±1 오타도 아닌데
     * 위치텍스트와 좌표가 전혀 다른 지역을 가리키는 개별 오류(사용자 재확인 2026-08-20
     * 강원 산악 내륙 조사 중 발견). 예: "통영시 사량면 돈지리 수우도"(경남 통영, 실제
     * 34.8N대)인데 좌표는 37.9N대(강원권)로 3도 이상 어긋나 있다 — 보정 규칙이 없어
     * ±1 오타처럼 되돌릴 수 없고, 이상치와 달리 같은 텍스트의 비교군도 없다(1건뿐).
     * 정확한 값을 추정할 근거가 없어 위 DUPLICATE/OUTLIER 필터와 같은 원칙(이상치는
     * 지도에서 제외)으로 개별 나열해 뺀다. [원위도, 원경도] 형식.
     */
    var KNOWN_BAD_COORDS = {
        person: [
            [37.93028, 128.10611], // "통영시 사량면 돈지리 수우도" — 실제는 경남(34.8N대)
            [37.79333, 128.43917]  // "통영시 산양읍 영운리 앞 해상" — 실제는 경남(34.8N대)
        ]
    };
    function isKnownBadCoord(key, row) {
        var bad = KNOWN_BAD_COORDS[key];
        if (!bad) return false;
        for (var i = 0; i < bad.length; i++) {
            if (bad[i][0] === row[0] && bad[i][1] === row[1]) return true;
        }
        return false;
    }

    /**
     * [검수 모드로 사람이 직접 골라낸 제외 목록(2026-08-20)] 실제 앱 화면(위성지도·
     * 실제 마커)에서 낱개로 갈라 보면서 눈으로 확인해 뺀 선박(심판원) 50건 — 원본
     * rows 배열의 인덱스(검수 모드 "내보내기" 값 그대로)로 특정한다. 좌표값이 아니라
     * 인덱스로 매칭하는 이유는 검수 모드 자체가 origIndex 기준으로 내보내기 때문
     * (좌표 기반인 KNOWN_BAD_COORDS와 병행 — 둘 다 "정확한 원인은 못 밝혔지만
     * 육안으로 위치가 틀렸다고 확인된" 개별 제외라는 점은 같다).
     */
    var MANUAL_EXCLUDED_INDICES = {
        hs: [23250, 33695, 33674, 7390, 9347, 17249, 40259, 17452, 40386, 2432, 11340, 7062,
            7780, 10254, 6237, 20949, 28322, 26515, 25886, 7110, 21870, 26615, 6300, 22009,
            4241, 12471, 16854, 6887, 12749, 21046, 28714, 38205, 12443, 5347, 38359, 9323,
            11505, 26473, 21915, 25930, 6697, 5387, 29219, 27586, 38227, 15387, 32943, 18032,
            7603, 33557]
    };
    function isManuallyExcluded(key, origIndex) {
        var bad = MANUAL_EXCLUDED_INDICES[key];
        return !!bad && bad.indexOf(origIndex) !== -1;
    }

    function rowToFeature(key, row, origIndex) {
        var coord = ol.proj.fromLonLat([row[1], row[0]]); // row=[lat,lon,...]
        var f = new ol.Feature({ geometry: new ol.geom.Point(coord) });
        f.set('row', row);
        f.set('typeCode', typeCodeOf(key, row));
        f.set('origIndex', origIndex); // 검수 모드 내보내기용 — 원본 JSON rows 배열 안의 위치
        return f;
    }

    function ensureRawFeatures(key) {
        if (rawFeatures[key]) return Promise.resolve(rawFeatures[key]);
        return Promise.all([fetchSource(key), ensureLandMask()]).then(function (results) {
            var rows = results[0];
            var landRings = results[1];
            var origIndexOf = new Map();
            rows.forEach(function (row, i) { origIndexOf.set(row, i); });
            rows.forEach(function (row) { applyLatOffsetFix(key, row); });
            var posIdx = COORD_OUTLIER_POS_IDX[key];
            var outliers = posIdx != null ? findCoordOutliers(rows, posIdx) : null;
            var missingLocClusters = posIdx != null ? findMissingLocationClusters(rows, posIdx) : null;
            var feats = rows
                .filter(function (row) { return !isOutOfKoreaBounds(row); })
                .filter(function (row) { return !ACCIDENT_TYPE_EXCLUDED[typeCodeOf(key, row)]; })
                .filter(function (row) { return !outliers || !outliers.has(row); })
                .filter(function (row) { return !missingLocClusters || !missingLocClusters.has(row); })
                .filter(function (row) { return !isIntegerDegreeCoord(row) || !isLandPoint(landRings, row[0], row[1]); })
                .filter(function (row) { return !isKnownBadCoord(key, row); })
                .filter(function (row) { return !isManuallyExcluded(key, origIndexOf.get(row)); })
                .map(function (row) { return rowToFeature(key, row, origIndexOf.get(row)); });
            rawFeatures[key] = feats;
            return feats;
        });
    }

    // ── 현황 모드: 클러스터 레이어 ──────────────────────────────────────────
    // 마커는 사고유형별 이미지 아이콘(ACCIDENT_TYPE_ICONS, hazard_rocks.js 와 같은
    // 120px 캔버스 방식)을 쓰고, 매핑에 없는 코드만 파란 점으로 대체한다.
    var _fallbackStyleCache = null;
    function fallbackStyle() {
        if (!_fallbackStyleCache) {
            _fallbackStyleCache = new ol.style.Style({
                image: new ol.style.Circle({
                    radius: 6,
                    fill: new ol.style.Fill({ color: '#448aff' }),
                    stroke: new ol.style.Stroke({ color: '#fff', width: 1.5 })
                })
            });
        }
        return _fallbackStyleCache;
    }

    var _iconStyleCache = {};
    function singleStyleFor(typeCode) {
        var src = ACCIDENT_TYPE_ICONS[typeCode];
        if (!src) return fallbackStyle();
        if (!_iconStyleCache[typeCode]) {
            _iconStyleCache[typeCode] = new ol.style.Style({
                image: new ol.style.Icon({ src: src, scale: ICON_SCALE, anchor: [0.5, 0.5] })
            });
        }
        return _iconStyleCache[typeCode];
    }

    /** 클러스터 안에서 가장 많은 사고유형의 코드를 찾는다(동점이면 먼저 나온 쪽). */
    function dominantTypeCode(members) {
        var counts = {}, topCode = null, topCount = 0;
        members.forEach(function (f) {
            var tc = f.get('typeCode');
            var c = (counts[tc] || 0) + 1;
            counts[tc] = c;
            if (c > topCount) { topCount = c; topCode = tc; }
        });
        return topCode;
    }

    var _clusterIconStyleCache = {};
    function clusterIconStyle(typeCode, count) {
        var text = String(count); // 999+ 로 뭉개지 않고 실제 건수를 그대로 보여준다(사용자 확정 2026-08-19)
        var src = ACCIDENT_TYPE_ICONS[typeCode];
        if (src) {
            var cacheKey = typeCode + '|' + text;
            if (!_clusterIconStyleCache[cacheKey]) {
                _clusterIconStyleCache[cacheKey] = new ol.style.Style({
                    image: new ol.style.Icon({ src: src, scale: ICON_SCALE, anchor: [0.5, 0.5] }),
                    text: new ol.style.Text({
                        text: text,
                        font: 'bold 11px sans-serif',
                        fill: new ol.style.Fill({ color: '#fff' }),
                        stroke: new ol.style.Stroke({ color: 'rgba(0,0,0,0.65)', width: 2.5 }),
                        offsetY: 4
                    })
                });
            }
            return _clusterIconStyleCache[cacheKey];
        }
        return new ol.style.Style({
            image: new ol.style.Circle({
                radius: Math.min(11 + Math.log(count) * 3, 26),
                fill: new ol.style.Fill({ color: 'rgba(255,82,82,0.85)' }),
                stroke: new ol.style.Stroke({ color: '#fff', width: 1.5 })
            }),
            text: new ol.style.Text({
                text: text,
                font: 'bold 11px sans-serif',
                fill: new ol.style.Fill({ color: '#fff' })
            })
        });
    }

    function clusterStyleFn(clusterFeature) {
        var members = clusterFeature.get('features');
        if (members.length === 1) return singleStyleFor(members[0].get('typeCode'));
        return clusterIconStyle(dominantTypeCode(members), members.length);
    }

    /**
     * ol.source.Cluster 는 기본적으로 클러스터 위치를 멤버들의 평균 좌표(centroid)로
     * 계산한다. 서해안처럼 해안선이 굴곡진 지역은 흩어진 항구·포구 여러 곳의 평균이
     * 육지(반도) 한가운데로 계산될 수 있다(사용자 보고 2026-08-20: 넓은 뷰에서 큰
     * 숫자 클러스터가 육지에 떠 보임 — 태안 인근 5,545건의 평균좌표로 실측 재현·확인).
     * 대표 위치를 평균 대신 "멤버 중 하나의 실제 좌표"로 바꾸면 클러스터가 항상 실제
     * 사고 지점(바다) 위에 놓인다.
     * @param {ol.geom.Point} point - 기본 계산된 평균 좌표(안 씀)
     * @param {ol.Feature[]} members
     * @returns {ol.Feature}
     */
    function createClusterAtRealPoint(point, members) {
        var geom = members.length ? members[0].getGeometry() : point;
        return new ol.Feature({ geometry: geom, features: members });
    }

    /** hazard_rocks.js buildClusterLayer 와 동일한 줌 기반 뭉치기 조절 패턴. */
    function buildClusterLayer(map, features) {
        var clusterSource = new ol.source.Cluster({
            distance: CLUSTER_DISTANCE,
            source: new ol.source.Vector({ features: features }),
            createCluster: createClusterAtRealPoint
        });
        var applyDistanceForZoom = function () {
            var zoom = map.getView().getZoom();
            var target = (typeof zoom === 'number' && zoom >= SPREAD_ZOOM) ? 0 : CLUSTER_DISTANCE;
            if (clusterSource.getDistance() !== target) clusterSource.setDistance(target);
        };
        map.getView().on('change:resolution', applyDistanceForZoom);
        applyDistanceForZoom();
        var layer = new ol.layer.Vector({ source: clusterSource, style: clusterStyleFn, visible: false, zIndex: 56 });
        map.addLayer(layer);
        return layer;
    }

    function ensureClusterLayer(map, key) {
        if (clusterLayers[key]) return Promise.resolve(clusterLayers[key]);
        return ensureRawFeatures(key).then(function (features) {
            var layer = buildClusterLayer(map, features);
            clusterLayers[key] = layer;
            return layer;
        });
    }

    // ── 마커 팝업 ───────────────────────────────────────────────────────────
    function ensureBubble(map) {
        if (bubbleOverlay) return bubbleOverlay;
        var el = document.createElement('div');
        el.className = 'accident-popup';
        bubbleOverlay = new ol.Overlay({ element: el, positioning: 'bottom-center', offset: [0, -8], stopEvent: false });
        map.addOverlay(bubbleOverlay);
        return bubbleOverlay;
    }

    function pad2(n) { n = String(n); return n.length < 2 ? '0' + n : n; }
    function formatYmd(ymd) {
        if (!ymd || ymd.length !== 8) return ymd || '-';
        return ymd.slice(0, 4) + '-' + ymd.slice(4, 6) + '-' + ymd.slice(6, 8);
    }
    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /**
     * 소스별 마커 팝업에 보여줄 [라벨, 값] 목록.
     * [연계] accident_codes.js 의 ACCIDENT_*_LABELS · accidentLabel()
     */
    function popupRowsFor(key, row) {
        if (key === 'hs') {
            return [
                ['재결번호', row[8] || '-'],
                ['선박명', row[9] || '-'],
                ['사고유형', accidentLabel(ACCIDENT_TYPE_LABELS, row[10])],
                ['발생일시', row[2] + '-' + pad2(row[3]) + '-' + pad2(row[4]) + ' ' + pad2(row[5]) + ':' + pad2(row[6])]
            ];
        }
        // person
        return [
            ['사고발생일', formatYmd(row[2])],
            ['사고유형', accidentLabel(ACCIDENT_TYPE_LABELS, row[4])],
            ['위치', row[3] || '-'],
            ['사상자', '구조 ' + row[7] + ' · 사망 ' + row[8] + ' · 실종 ' + row[9]]
        ];
    }

    function renderPopup(map, key, feature) {
        var bubble = ensureBubble(map);
        var rows = popupRowsFor(key, feature.get('row'));
        bubble.getElement().innerHTML = rows.map(function (r) {
            return '<div class="row"><span>' + r[0] + '</span><span>' + escapeHtml(r[1]) + '</span></div>';
        }).join('');
        bubble.setPosition(feature.getGeometry().getCoordinates());
    }

    /** 검수 모드 목록에 보여줄 한 줄 요약(popupRowsFor 와 같은 컬럼을 재사용). */
    function reviewLabelFor(key, row) {
        if (key === 'hs') return row[2] + '-' + pad2(row[3]) + '-' + pad2(row[4]) + ' · ' + (row[9] || '-');
        return formatYmd(row[2]) + ' · ' + (row[3] || accidentLabel(ACCIDENT_TYPE_LABELS, row[4]));
    }

    /** 검수 모드 패널을 처음 한 번만 만든다(REVIEW_MODE 일 때만 bindUi 에서 호출). */
    function ensureReviewPanel() {
        if (document.getElementById('accident-review-panel')) return;
        var style = document.createElement('style');
        style.textContent =
            // 우측 세로 버튼 레일(출입통제·낚시금지 등)·하단 탭바와 안 겹치게 하단 중앙에 띄운다.
            // 기본은 한 줄(헤더)만 보이는 접힌 상태 — 목록·버튼은 헤더를 눌러야 펼쳐진다
            // (사용자 보고 2026-08-20: 목록이 펼쳐진 채로 고정돼 있어 지도 화면을 거의 다 가림).
            '#accident-review-panel{position:fixed;left:12px;right:12px;max-width:360px;margin:0 auto;' +
            'bottom:78px;background:rgba(20,26,32,0.94);color:#fff;font-size:12px;border-radius:10px;' +
            'z-index:900;box-shadow:0 4px 16px rgba(0,0,0,0.4);font-family:sans-serif;overflow:hidden;}' +
            '#accident-review-panel .arp-hdr{display:flex;align-items:center;gap:6px;font-weight:700;' +
            'padding:10px;cursor:pointer;user-select:none;}' +
            '#accident-review-panel .arp-hdr b{color:#ff5f74;}' +
            '#accident-review-panel .arp-hdr .arp-chevron{margin-left:auto;color:#aaa;font-size:11px;}' +
            '#accident-review-panel .arp-body{display:none;flex-direction:column;gap:8px;padding:0 10px 10px;}' +
            '#accident-review-panel.expanded .arp-body{display:flex;}' +
            '#accident-review-panel .arp-list{max-height:180px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;}' +
            '#accident-review-panel .arp-item{display:flex;gap:6px;align-items:flex-start;background:rgba(255,255,255,0.06);' +
            'border-radius:6px;padding:5px 7px;}' +
            '#accident-review-panel .arp-item span{flex:1;line-height:1.4;word-break:break-word;}' +
            '#accident-review-panel .arp-item button{flex:none;background:none;border:none;color:#aaa;cursor:pointer;font-size:13px;}' +
            '#accident-review-panel .arp-actions{display:flex;gap:6px;}' +
            '#accident-review-panel .arp-actions button{flex:1;padding:6px;border-radius:6px;border:1px solid #555;' +
            'background:#2a333a;color:#fff;font-size:12px;cursor:pointer;}' +
            '#accident-review-panel .arp-actions button.primary{background:#ff5f74;border-color:#ff5f74;font-weight:700;}' +
            '#accident-review-panel textarea{width:100%;height:90px;font-size:11px;border-radius:6px;border:1px solid #555;' +
            'background:#11161a;color:#fff;padding:6px;box-sizing:border-box;}';
        document.head.appendChild(style);

        var panel = document.createElement('div');
        panel.id = 'accident-review-panel';
        panel.innerHTML =
            '<div class="arp-hdr" id="accident-review-toggle">검수 모드 — 선택 <b id="accident-review-count">0</b>건' +
            '<span class="arp-chevron" id="accident-review-chevron">펼치기 ▾</span></div>' +
            '<div class="arp-body">' +
            '<div class="arp-list" id="accident-review-list"></div>' +
            '<div class="arp-actions">' +
            '<button type="button" id="accident-review-clear">전체 해제</button>' +
            '<button type="button" id="accident-review-export" class="primary">내보내기</button>' +
            '</div>' +
            '<textarea id="accident-review-export-text" readonly style="display:none;"></textarea>' +
            '</div>';
        document.body.appendChild(panel);

        document.getElementById('accident-review-toggle').addEventListener('click', function () {
            panel.classList.toggle('expanded');
            var expanded = panel.classList.contains('expanded');
            document.getElementById('accident-review-chevron').textContent = expanded ? '접기 ▴' : '펼치기 ▾';
        });
        document.getElementById('accident-review-clear').addEventListener('click', function () {
            flaggedItems.clear();
            var map = window.getOceanMap && window.getOceanMap();
            if (map) rebuildFlagLayer(map);
            renderReviewPanel();
        });
        document.getElementById('accident-review-export').addEventListener('click', function () {
            var out = {};
            flaggedItems.forEach(function (item) {
                (out[item.key] || (out[item.key] = [])).push(item.idx);
            });
            var ta = document.getElementById('accident-review-export-text');
            ta.value = JSON.stringify(out);
            ta.style.display = 'block';
            ta.focus();
            ta.select();
        });
        renderReviewPanel();
    }

    function renderReviewPanel() {
        var countEl = document.getElementById('accident-review-count');
        var listEl = document.getElementById('accident-review-list');
        if (!countEl || !listEl) return;
        countEl.textContent = flaggedItems.size;
        listEl.innerHTML = '';
        flaggedItems.forEach(function (item, flagKey) {
            var row = document.createElement('div');
            row.className = 'arp-item';
            var label = document.createElement('span');
            label.textContent = '[' + item.key + '] ' + reviewLabelFor(item.key, item.row);
            var rm = document.createElement('button');
            rm.type = 'button';
            rm.textContent = '✕';
            rm.addEventListener('click', function () {
                flaggedItems.delete(flagKey);
                var map = window.getOceanMap && window.getOceanMap();
                if (map) rebuildFlagLayer(map);
                renderReviewPanel();
            });
            row.appendChild(label);
            row.appendChild(rm);
            listEl.appendChild(row);
        });
        var ta = document.getElementById('accident-review-export-text');
        if (ta) ta.style.display = 'none'; // 목록이 바뀌면 다시 눌러야 최신 상태로 채워짐
    }

    // ── 검수 모드(사고정보 켜면 항상 함께 뜸) — 낱개 마커를 클릭하면 상세 팝업은 그대로 뜨고,
    // 추가로 빨간 테두리를 켜서 내보내기 목록에 쌓는다. ───────────────────────
    function ensureFlagLayer(map) {
        if (flagLayer) return flagLayer;
        var source = new ol.source.Vector();
        var style = new ol.style.Style({
            image: new ol.style.Circle({
                radius: 16,
                stroke: new ol.style.Stroke({ color: '#ff2d55', width: 3 }),
                fill: new ol.style.Fill({ color: 'rgba(255,45,85,0.15)' })
            })
        });
        flagLayer = new ol.layer.Vector({ source: source, style: style, zIndex: 58 });
        map.addLayer(flagLayer);
        return flagLayer;
    }

    function rebuildFlagLayer(map) {
        var layer = ensureFlagLayer(map);
        var source = layer.getSource();
        source.clear();
        flaggedItems.forEach(function (item) {
            source.addFeature(new ol.Feature({ geometry: new ol.geom.Point(item.coord) }));
        });
    }

    /** 낱개 마커 클릭 시 상세 팝업과 별개로 빨간 테두리 선택을 토글한다(검수 모드 전용). */
    function toggleFlag(map, key, feature) {
        if (!REVIEW_MODE) return;
        var idx = feature.get('origIndex');
        if (idx == null) return;
        var flagKey = key + ':' + idx;
        if (flaggedItems.has(flagKey)) {
            flaggedItems.delete(flagKey);
        } else {
            flaggedItems.set(flagKey, { key: key, idx: idx, row: feature.get('row'), coord: feature.getGeometry().getCoordinates() });
        }
        rebuildFlagLayer(map);
        renderReviewPanel();
    }

    /**
     * 클러스터 클릭 처리 — hazard_rocks.js tryHandleLayerClick 과 같은 방식.
     * 멤버 2개 이상이면 그 범위로 확대(더 갈라지도록), 낱개면 상세 팝업(검수 모드면
     * 팝업과 함께 빨간 테두리 선택도 토글 — 어떤 사고인지 보면서 골라야 하기 때문).
     */
    function tryHandleClusterClick(map, evt, key, layer) {
        var hit = null;
        map.forEachFeatureAtPixel(evt.pixel, function (feature, lyr) {
            if (lyr === layer) { hit = feature; return true; }
        }, { layerFilter: function (l) { return l === layer; } });
        if (!hit) return false;

        var members = hit.get('features');
        if (members.length > 1) {
            var view = map.getView();
            var extent = ol.extent.createEmpty();
            members.forEach(function (f) { ol.extent.extend(extent, f.getGeometry().getExtent()); });
            var atMaxZoom = view.getZoom() >= view.getMaxZoom() - 0.05;
            if (!atMaxZoom) {
                view.fit(extent, { padding: [60, 60, 60, 60], maxZoom: view.getMaxZoom(), duration: 300 });
            } else {
                renderPopup(map, key, members[0]); // 최대 줌에서도 안 갈라짐 — 대표 1건만
                toggleFlag(map, key, members[0]);
            }
            return true;
        }
        renderPopup(map, key, members[0]);
        toggleFlag(map, key, members[0]);
        return true;
    }

    // ── 분석 모드: 격자 히트맵 ──────────────────────────────────────────────
    function lerpColor(t) {
        var a = [255, 215, 64], b = [255, 82, 82]; // 노랑(낮음) → 빨강(높음)
        var r = Math.round(a[0] + (b[0] - a[0]) * t);
        var g = Math.round(a[1] + (b[1] - a[1]) * t);
        var bl = Math.round(a[2] + (b[2] - a[2]) * t);
        return 'rgba(' + r + ',' + g + ',' + bl + ',0.82)';
    }

    function gridCellStyle(feature) {
        var count = feature.get('count');
        var maxCount = feature.get('_maxInView') || 1;
        var t = Math.min(count / maxCount, 1);
        return new ol.style.Style({
            fill: new ol.style.Fill({ color: lerpColor(t) }),
            stroke: new ol.style.Stroke({ color: 'rgba(255,255,255,0.35)', width: 1 }),
            text: new ol.style.Text({
                text: String(count),
                font: 'bold 12px "Roboto Mono", monospace',
                fill: new ol.style.Fill({ color: t > 0.5 ? '#2a0000' : '#241a00' })
            })
        });
    }

    function ensureGridLayer(map) {
        if (gridLayer) return gridLayer;
        gridSource = new ol.source.Vector();
        gridLayer = new ol.layer.Vector({ source: gridSource, style: gridCellStyle, visible: false, zIndex: 57 });
        map.addLayer(gridLayer);
        return gridLayer;
    }

    /**
     * 현재 지도 화면(extent)을 GRID_COLS×GRID_ROWS 칸으로 나눠 활성 소스의
     * 포인트를 세어 격자 폴리곤 feature 로 다시 그린다. 줌/이동(moveend)마다
     * 다시 호출되므로 격자 크기가 화면 범위에 맞춰 자동으로 재계산된다.
     * @param {ol.Map} map
     */
    function recomputeGrid(map) {
        if (!gridSource || !state.source) return;
        var feats = rawFeatures[state.source] || [];
        var extent = map.getView().calculateExtent(map.getSize());
        var w = (extent[2] - extent[0]) / GRID_COLS;
        var h = (extent[3] - extent[1]) / GRID_ROWS;
        if (!(w > 0) || !(h > 0)) return;

        var buckets = {}; // "col,row" -> ol.Feature[]
        feats.forEach(function (f) {
            var c = f.getGeometry().getCoordinates();
            if (c[0] < extent[0] || c[0] > extent[2] || c[1] < extent[1] || c[1] > extent[3]) return;
            var col = Math.min(Math.floor((c[0] - extent[0]) / w), GRID_COLS - 1);
            var row = Math.min(Math.floor((c[1] - extent[1]) / h), GRID_ROWS - 1);
            var k = col + ',' + row;
            (buckets[k] || (buckets[k] = [])).push(f);
        });

        gridSource.clear();
        var maxCount = 0;
        Object.keys(buckets).forEach(function (k) { if (buckets[k].length > maxCount) maxCount = buckets[k].length; });
        Object.keys(buckets).forEach(function (k) {
            var parts = k.split(',');
            var col = parseInt(parts[0], 10), row = parseInt(parts[1], 10);
            var x0 = extent[0] + col * w, x1 = x0 + w;
            var y0 = extent[1] + row * h, y1 = y0 + h;
            var cellFeature = new ol.Feature({
                geometry: new ol.geom.Polygon([[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]])
            });
            cellFeature.set('count', buckets[k].length);
            cellFeature.set('members', buckets[k]);
            cellFeature.set('_maxInView', maxCount);
            gridSource.addFeature(cellFeature);
        });
        closeStatsSheet(); // 격자가 다시 그려졌으니 이전 선택은 무효
    }

    // ── 통계 바텀시트 ───────────────────────────────────────────────────────
    function yearOf(key, row) {
        var raw = (key === 'hs') ? row[2] : row[2]; // hs=OCRN_YR(정수), 나머지=OCRN_YMD(문자열)
        if (key === 'hs') return raw;
        return (raw && String(raw).length >= 4) ? parseInt(String(raw).slice(0, 4), 10) : null;
    }

    function yearHistogram(key, members) {
        var counts = {};
        members.forEach(function (f) {
            var y = yearOf(key, f.get('row'));
            if (!y) return;
            counts[y] = (counts[y] || 0) + 1;
        });
        return Object.keys(counts).map(Number).sort(function (a, b) { return a - b; })
            .map(function (y) { return [y, counts[y]]; });
    }

    /** person 은 발생 시각 컬럼이 없어 주/야간을 집계할 수 없다 — null 반환. */
    function dayNightCounts(key, members) {
        if (key === 'person') return null;
        var day = 0, night = 0;
        members.forEach(function (f) {
            var row = f.get('row');
            if (accidentIsDaytimeFromTmz(row[7])) day++; else night++;
        });
        return { day: day, night: night };
    }

    /**
     * "사고발생상세" 탭 구성 — 소스마다 실제 CSV 에 있는 컬럼만큼만 보여준다.
     * 선박(심판원) CSV 엔 발생원인·선박종류 컬럼이 없어 해역별로 대체했다.
     */
    function detailTabsFor(key) {
        if (key === 'hs') return ['발생유형', '해역'];
        return ['사고유형'];
    }

    function aggregateCounts(members, getter, labelTable) {
        var counts = {};
        members.forEach(function (f) {
            var label = accidentLabel(labelTable, getter(f.get('row')));
            counts[label] = (counts[label] || 0) + 1;
        });
        return Object.keys(counts).map(function (label) { return [label, counts[label]]; })
            .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 6); // 상위 6개만
    }

    function detailDataFor(key, tab, members) {
        if (key === 'hs') {
            if (tab === '발생유형') return aggregateCounts(members, function (r) { return r[10]; }, ACCIDENT_TYPE_LABELS);
            return aggregateCounts(members, function (r) { return r[11]; }, ACCIDENT_SEA_AREA_LABELS);
        }
        return aggregateCounts(members, function (r) { return r[4]; }, ACCIDENT_TYPE_LABELS);
    }

    function buildStatsHtml(key, members) {
        var years = yearHistogram(key, members);
        var maxY = Math.max.apply(null, years.map(function (y) { return y[1]; }).concat([1]));
        var sparkBars = years.map(function (y) {
            return '<i style="height:' + Math.max(6, Math.round(y[1] / maxY * 100)) + '%" title="' + y[0] + ': ' + y[1] + '건"></i>';
        }).join('');
        var yearLabel = years.length ? (years[0][0] + '~' + years[years.length - 1][0]) : '-';

        var dn = dayNightCounts(key, members);
        var dnHtml;
        if (dn) {
            var total = (dn.day + dn.night) || 1;
            var dayPct = Math.round(dn.day / total * 100);
            dnHtml = '<div class="accident-stats-block"><div class="accident-stats-label">주/야간별 (06~18시 근사)</div>' +
                '<div class="accident-daynight">' +
                '<div class="accident-dn-bar"><div class="track"><div class="fill day" style="width:' + dayPct + '%"></div></div><div class="meta">주간 <b>' + dn.day + '</b></div></div>' +
                '<div class="accident-dn-bar"><div class="track"><div class="fill night" style="width:' + (100 - dayPct) + '%"></div></div><div class="meta">야간 <b>' + dn.night + '</b></div></div>' +
                '</div></div>';
        } else {
            dnHtml = '<div class="accident-stats-block"><div class="accident-stats-label">주/야간별</div>' +
                '<div class="accident-stats-empty">이 데이터엔 발생 시각 정보가 없습니다.</div></div>';
        }

        var tabs = detailTabsFor(key);
        if (!_activeDetailTab[key] || tabs.indexOf(_activeDetailTab[key]) === -1) _activeDetailTab[key] = tabs[0];
        var activeTab = _activeDetailTab[key];
        var detailItems = detailDataFor(key, activeTab, members);
        var maxDetail = Math.max.apply(null, detailItems.map(function (d) { return d[1]; }).concat([1]));
        var barsHtml = detailItems.map(function (d) {
            return '<div class="accident-bar-row"><span class="name">' + escapeHtml(d[0]) + '</span>' +
                '<span class="track"><span class="fill" style="width:' + Math.round(d[1] / maxDetail * 100) + '%"></span></span>' +
                '<span class="n">' + d[1] + '</span></div>';
        }).join('');
        var tabsHtml = tabs.map(function (t) {
            return '<button class="accident-detail-tab' + (t === activeTab ? ' active' : '') + '" data-tab="' + t + '">' + t + '</button>';
        }).join('');

        return '<h3>그리드형 사고분석 <span class="cellcount">' + members.length + '건</span></h3>' +
            '<div class="accident-stats-block"><div class="accident-stats-label">연도별 사고현황 (' + yearLabel + ')</div>' +
            '<div class="accident-spark">' + sparkBars + '</div></div>' +
            dnHtml +
            '<div class="accident-stats-block"><div class="accident-stats-label">사고발생상세</div>' +
            '<div class="accident-detail-tabs">' + tabsHtml + '</div>' + barsHtml + '</div>';
    }

    function renderStatsBody() {
        var body = document.getElementById('accident-stats-body');
        if (!body || !_statsKey || !_statsMembers) return;
        body.innerHTML = buildStatsHtml(_statsKey, _statsMembers);
    }

    function openStatsSheet(key, members) {
        var sheet = document.getElementById('accident-stats-sheet');
        if (!sheet) return;
        _statsKey = key;
        _statsMembers = members;
        renderStatsBody();
        sheet.classList.add('open');
    }

    function closeStatsSheet() {
        var sheet = document.getElementById('accident-stats-sheet');
        if (sheet) sheet.classList.remove('open');
        _statsKey = null;
        _statsMembers = null;
    }

    function tryHandleGridClick(map, evt) {
        if (!gridLayer || !gridLayer.getVisible()) return false;
        var hit = null;
        map.forEachFeatureAtPixel(evt.pixel, function (feature, lyr) {
            if (lyr === gridLayer) { hit = feature; return true; }
        }, { layerFilter: function (l) { return l === gridLayer; } });
        if (!hit) { closeStatsSheet(); return false; }
        openStatsSheet(state.source, hit.get('members'));
        return true;
    }

    // ── 버튼·팝아웃 UI ──────────────────────────────────────────────────────
    function closePopout() {
        var wrap = document.getElementById('ocean-accident-wrap');
        if (wrap) wrap.classList.remove('popup-open');
    }

    function updateSourceButtonsUi() {
        var list = document.getElementById('ocean-accident-source-list');
        if (!list) return;
        Array.prototype.forEach.call(list.children, function (btn) {
            btn.classList.toggle('active', btn.dataset.source === state.source);
        });
    }

    function updateModeToggleUi() {
        var toggle = document.getElementById('ocean-accident-mode-toggle');
        if (!toggle) return;
        Array.prototype.forEach.call(toggle.children, function (btn) {
            btn.classList.toggle('active', btn.dataset.mode === state.mode);
        });
    }

    function applyModeVisibility(map) {
        var key = state.source;
        Object.keys(clusterLayers).forEach(function (k) {
            clusterLayers[k].setVisible(k === key && state.mode === 'status');
        });
        if (state.mode !== 'status' && bubbleOverlay) bubbleOverlay.setPosition(undefined);
        if (state.mode === 'analysis' && key) {
            ensureGridLayer(map).setVisible(true);
            recomputeGrid(map);
        } else {
            if (gridLayer) gridLayer.setVisible(false);
            closeStatsSheet();
        }
    }

    // ON 시점의 배경지도를 기억해 뒀다 OFF 시 되돌린다(access_control.js/fishing_ban.js 와 동일 패턴).
    var _prevBasemap = null;

    // 데이터 로딩 중(fetch 완료 전) 사고정보 버튼을 눌러 끈 경우, 나중에 로딩이 끝나면서
    // 꺼진 상태를 덮어쓰고 다시 켜지는 레이스 컨디션이 있었다(사용자 보고 2026-08-20:
    // "꺼도 지도에 남아있음" — 헤드리스 브라우저로 네트워크 지연을 인위로 걸어 재현
    // 확인). turnOff() 가 이 카운터를 올려 진행 중이던 selectSource 콜백을 무효화한다.
    var _selectSeq = 0;

    function showModeToggle(show) {
        var modeToggle = document.getElementById('ocean-accident-mode-toggle');
        if (modeToggle) modeToggle.style.display = show ? 'flex' : 'none';
    }

    function selectSource(map, key) {
        var seq = ++_selectSeq;
        var toggleBtn = document.getElementById('ocean-accident-toggle-btn');
        var iconEl = toggleBtn && toggleBtn.querySelector('i');
        var originalIconClass = iconEl ? iconEl.className : '';
        if (iconEl) iconEl.className = 'fa-solid fa-spinner fa-spin';
        ensureClusterLayer(map, key).then(function () {
            if (iconEl) iconEl.className = originalIconClass;
            if (seq !== _selectSeq) return; // 그 사이 껐거나 다른 소스를 골랐으면 이 결과는 버린다
            state.source = key;
            Object.keys(clusterLayers).forEach(function (k) { clusterLayers[k].setVisible(false); });
            applyModeVisibility(map);
            closePopout();
            updateSourceButtonsUi();
            showModeToggle(true);
            if (toggleBtn) toggleBtn.classList.add('active');
            // 마커를 실제 지형과 대조해 보기 쉽도록 배경지도를 위성지도로 자동 전환(사용자 확정 2026-08-19)
            if (typeof window.oceanGetBasemap === 'function' && typeof window.oceanSetBasemap === 'function') {
                _prevBasemap = window.oceanGetBasemap();
                if (_prevBasemap !== 'vworld') window.oceanSetBasemap('vworld');
            }
            if (window.trackUsage) window.trackUsage('ocean.accident_info');
        }).catch(function (e) {
            if (seq !== _selectSeq) return;
            if (iconEl) iconEl.className = originalIconClass;
            console.warn('[AccidentInfo] 데이터 로드 실패:', e.message);
        });
    }

    /**
     * 사고정보를 완전히 끈다 — 마커/격자 레이어 숨김, 소스 선택 해제, 배경지도 복귀.
     * 사고정보 버튼을 다시 누르면 호출(사용자 확정 2026-08-19: 재클릭으로 켜져 있던
     * 데이터를 끌 수 있어야 함 — access_control.js 등 다른 토글 레이어와 동일한 동작).
     * _selectSeq 를 올려 진행 중이던 selectSource 로딩 결과가 나중에 도착해도
     * 무시되게 한다(사용자 보고 2026-08-20 레이스 컨디션 수정).
     * [연계] ← bindUi() toggleBtn 클릭
     */
    function turnOff(map) {
        _selectSeq++;
        state.source = null;
        applyModeVisibility(map);
        closePopout();
        updateSourceButtonsUi();
        showModeToggle(false);
        var toggleBtn = document.getElementById('ocean-accident-toggle-btn');
        if (toggleBtn) toggleBtn.classList.remove('active');
        if (_prevBasemap && _prevBasemap !== 'vworld' && typeof window.oceanSetBasemap === 'function') {
            window.oceanSetBasemap(_prevBasemap);
        }
        _prevBasemap = null;
    }

    function setMode(map, mode) {
        state.mode = mode;
        applyModeVisibility(map);
        updateModeToggleUi();
    }

    function bindUi(map) {
        if (REVIEW_MODE) ensureReviewPanel();
        var toggleBtn = document.getElementById('ocean-accident-toggle-btn');
        var wrap = document.getElementById('ocean-accident-wrap');
        if (toggleBtn && wrap) {
            toggleBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                if (state.source) { turnOff(map); return; } // 이미 데이터가 켜져 있으면 전체 끄기
                // 아직 안 켜졌어도(소스 선택 직후 fetch 로딩 중일 수 있음) 진행 중인 로딩을
                // 취소한다 — 안 그러면 몇 초 후 로딩이 끝나면서 "끈" 데이터가 다시 나타난다
                // (사용자 보고 2026-08-20: 꺼도 지도에 남아있음 — 로딩 중 재현 확인).
                _selectSeq++;
                wrap.classList.toggle('popup-open'); // 소스 선택 팝아웃 열기/닫기
            });
            document.addEventListener('click', function (e) {
                if (!wrap.contains(e.target)) wrap.classList.remove('popup-open');
            });
        }

        var modeToggle = document.getElementById('ocean-accident-mode-toggle');
        if (modeToggle) {
            modeToggle.addEventListener('click', function (e) {
                var btn = e.target.closest('button');
                if (!btn) return;
                setMode(map, btn.dataset.mode);
            });
        }

        var sourceList = document.getElementById('ocean-accident-source-list');
        if (sourceList) {
            sourceList.addEventListener('click', function (e) {
                var btn = e.target.closest('button');
                if (!btn) return;
                selectSource(map, btn.dataset.source);
            });
        }

        var closeBtn = document.getElementById('accident-stats-close');
        if (closeBtn) closeBtn.addEventListener('click', closeStatsSheet);

        // "사고발생상세" 탭 전환 — 바텀시트 본문은 매번 다시 그려지므로 delegation.
        var statsBody = document.getElementById('accident-stats-body');
        if (statsBody) {
            statsBody.addEventListener('click', function (e) {
                var btn = e.target.closest('.accident-detail-tab');
                if (!btn || !_statsKey) return;
                _activeDetailTab[_statsKey] = btn.dataset.tab;
                renderStatsBody();
            });
        }

        // 분석 모드일 때만 줌/이동에 맞춰 격자 재계산(현황 모드에선 불필요한 연산 생략).
        map.on('moveend', function () {
            if (state.mode === 'analysis' && state.source) recomputeGrid(map);
        });
    }

    /**
     * [외부 API] 지도 클릭이 사고정보 레이어(격자 또는 마커)를 눌렀는지 확인한다.
     * @param {ol.Map} map
     * @param {ol.MapBrowserEvent} evt
     * @returns {boolean} true 면 클릭이 소비됨
     * [연계] ← ocean_map.js handleMapClick
     */
    window._accidentInfoTryHandleClick = function (map, evt) {
        if (tryHandleGridClick(map, evt)) return true;
        if (state.mode === 'status' && state.source && clusterLayers[state.source]) {
            if (tryHandleClusterClick(map, evt, state.source, clusterLayers[state.source])) return true;
        }
        if (bubbleOverlay) bubbleOverlay.setPosition(undefined);
        return false;
    };

    /**
     * oceanMap 이 만들어질 때까지 폴링해 UI를 설치한다.
     * [연계] ← DOMContentLoaded → bindUi() (access_control.js 와 동일 패턴)
     */
    function _installWhenReady() {
        function _try() {
            var map = window.getOceanMap && window.getOceanMap();
            if (map) { bindUi(map); return; }
            setTimeout(_try, 250);
        }
        _try();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _installWhenReady);
    } else {
        _installWhenReady();
    }
})();
