/**
 * ============================================================================
 * 파일명: js/ocean_map.js
 * 역할: 해양종합정보 지도 초기화 + 베이스맵 전환 + 기본 인터랙션
 * ============================================================================
 *
 * [설명]
 * 해양종합정보 히든 탭의 OpenLayers 지도를 초기화합니다.
 * 조석지도/해양현황 분리 모드 없이 단일 통합 지도 뷰로 동작합니다.
 * - 베이스맵: 기본맵 / 전자해도 / 해안도 / 세계지도 / 위성지도 (피커로 선택)
 * - 오버레이: 조류/바람/파고 (항상 표시되는 우측 버튼)
 * - 주요지명: 조석 마커 토글 버튼
 * - 타임라인: 항상 표시 (조류=1h 스텝, 바람/파고=3h 스텝)
 *
 * [연계 파일]
 * - index.html → #ocean-map, #ocean-map-section
 * - ocean_markers.js → 조석 마커, 클릭 처리
 * - ocean_bottom_sheet.js → 바텀시트 표시
 * - ocean_overlay.js → 캔버스 오버레이
 * - ocean_timeline.js → 타임라인 슬라이더
 * - js/settings.js → 히든 탭 진입 메커니즘
 * ============================================================================
 */

(function () {
    'use strict';

    // ========================================================================
    // 상태 변수
    // ========================================================================
    let oceanMap = null;              // OpenLayers Map 인스턴스
    let baseLayerA         = null;    // 기본맵 (BASEMAP_RLTM3857)
    let baseLayerENC       = null;    // 전자해도 (BASEMAP_ENC573857)
    let baseLayerCoast     = null;    // 해안도 (BASEMAP_RLTMCOAST3857)
    let baseLayerOSM       = null;    // 세계지도 (OpenStreetMap)
    let baseLayerVwSat     = null;    // 위성지도 — 위성영상 (브이월드 Satellite)
    let baseLayerVwLabel   = null;    // 위성지도 — 그 위에 얹는 지명·도로 라벨 (브이월드 Hybrid)
    let currentBase        = 'rltm'; // 현재 베이스맵: 'rltm' | 'enc' | 'coast' | 'osm' | 'vworld'
    let searchResultLayer = null;     // 검색 결과 마커 레이어

    // 해구도 격자 레이어 (KMA marine_zone/area 정적 GeoJSON 기반)
    let marineZoneGridLayer    = null;  // 대해구 outline (항상 표시)
    let marineZoneSubGridLayer = null;  // 소해구 (대해구 3×3 분할, 확대 시만)
    let marineZoneLabelLayer   = null;  // 대해구 번호 라벨

    // 2-step 클릭으로 선택된 feature 추적 (메인/서브 별도). seaZones.js 의
    //   selectedZoneKey / selectedSmallZoneKey 와 동일 역할.
    let _selectedMainZoneFeature = null;  // 첫 클릭으로 하이라이트 된 대해구 feature
    let _selectedSubZoneFeature  = null;  // 첫 클릭으로 하이라이트 된 소해구 feature
    let _selectedZoneId          = null;  // "105" 또는 "105-3" 형식, 같은 셀 재클릭 판정용

    // 해아름 WMS 엔드포인트 (F12 캡처로 확인됨)
    // http://www.khoa.go.kr/oceanmap/{LAYER}/wmsVectordata.do?SERVICE=WMS&...
    const KHOA_WMS_BASE = 'https://www.khoa.go.kr/oceanmap/';
    const KHOA_LAYER_A     = 'BASEMAP_RLTM3857';      // 기본맵 (국문)
    const KHOA_LAYER_ENC   = 'BASEMAP_ENC573857';     // 전자해도
    const KHOA_LAYER_COAST = 'BASEMAP_RLTMCOAST3857'; // 해안도

    // 한반도 남부 + 제주 → 최소 줌 레벨 6
    // [중요] MAX_ZOOM 은 KHOA 해아름 WMS 가 안정적으로 타일을 제공하는 한계까지로 제한.
    //        그 이상으로 확대하면 해아름이 빈 타일을 주고, 사용자는 OpenStreetMap 같은
    //        다른 지도가 갑자기 나오는 것처럼 느낀다(실제로는 OSM 폴백 코드가 바꾸던 것).
    //        해아름만 사용한다는 요구사항(2026-04 사용자 지시)에 따라 폴백을 제거하고
    //        대신 줌 한계를 15 로 고정한다.
    const DEFAULT_CENTER = [127.0, 34.5];
    const DEFAULT_ZOOM = 7;
    const MIN_ZOOM = 6;
    const MAX_ZOOM = 15;

    // 위성지도(브이월드)가 타일을 주는 최대 줌. 위성영상은 확대해야 값어치가
    // 있어(양식장·갯바위·접안시설 식별) 해아름 한계(15)보다 깊이 들어간다.
    // 위성지도를 고른 동안만 이 한계를 쓰고, 다른 배경으로 돌아가면 MAX_ZOOM(15)
    // 으로 되돌린다 — switchBaseLayer() 참조. 해양안전생활 화면도 같은 값을
    // window.oceanCreateVworldLayer.maxZoom 으로 받아 쓴다.
    const VWORLD_MAX_ZOOM = 19;

    // ========================================================================
    // 해아름 WMS 레이어 생성
    // ========================================================================

    /**
     * 해아름 WMS 타일 레이어를 생성합니다.
     *
     * [동작 방식]
     * KHOA 해아름은 WMS 1.1.1 GetMap 방식으로 지도 조각을 줍니다.
     * 우리는 OpenLayers의 TileWMS source에 엔드포인트와 파라미터만
     * 넘기면, OL이 알아서 BBOX를 계산해서 256x256 png를 요청합니다.
     *
     * [캡처된 실제 요청 예시]
     *  http://www.khoa.go.kr/oceanmap/BASEMAP_RLTMHL/wmsVectordata.do
     *    ?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap
     *    &FORMAT=image/png&TRANSPARENT=true
     *    &WIDTH=256&HEIGHT=256&SRS=EPSG:5179&STYLES=
     *    &BBOX=...
     *
     * 레이어 이름에 '3857'이 포함되어 있으므로 EPSG:3857로 요청합니다.
     *
     * @param {string} layer - 레이어명 (BASEMAP_RLTM3857 등)
     * @returns {ol.layer.Tile}
     */
    function createKhoaLayer(layer) {
        // KHOA가 HTTPS→HTTP 302 리다이렉트를 보내 브라우저가 차단하므로
        // 서버 프록시(/api/ocean/khoa-wms)를 거쳐서 받습니다.
        var endpoint = '/api/ocean/khoa-wms';

        var wmsSource = new ol.source.TileWMS({
            url: endpoint,
            params: {
                'layer': layer,
                'SERVICE': 'WMS',
                'VERSION': '1.1.1',
                'REQUEST': 'GetMap',
                'FORMAT': 'image/png',
                'TRANSPARENT': true,
                'STYLES': '',
                'LAYERS': '',
                'SRS': 'EPSG:3857'
            },
            projection: 'EPSG:3857',
            attributions: '&copy; <a href="https://www.khoa.go.kr">국립해양조사원</a>',
            crossOrigin: 'anonymous'
        });

        // 타일 레이어 생성
        // [정책] 사용자 요구사항: "해아름만 나와야 함".
        //   기존에 있던 'tileloaderror 3회 누적 시 OSM 으로 setSource' 폴백은
        //   한 번 발동되면 영구적으로 OSM 이 표시되어 줌아웃해도 복구되지 않는
        //   문제가 있어 제거했다. 대신 MAX_ZOOM 을 KHOA 한계(15)로 고정하여
        //   해아름이 타일을 못 주는 줌 레벨 자체를 차단한다.
        var tileLayer = new ol.layer.Tile({
            source: wmsSource,
            visible: true
        });

        // [노이즈 제거 2026-04-25] tileloaderror 는 타일 한 장당 발화한다.
        //   KHOA 해아름은 한반도 외곽 BBOX 에서 빈 타일을 주는 게 정상 동작이라
        //   화면당 수십 장이 자연스레 실패하고 콘솔이 도배된다. 화면에는
        //   투명 타일로 처리되어 사용자 영향이 없으므로 로그를 제거.

        console.log('[OceanMap] 해아름 WMS 엔드포인트:', endpoint);
        return tileLayer;
    }

    /**
     * 브이월드(국토교통부) 위성지도 타일 레이어를 만듭니다.
     * 예: createVworldLayer('Satellite') → 위성영상 한 장짜리 타일 레이어
     *
     * [동작 방식]
     * 브이월드 WMTS 는 타일 한 장을 "/{z}/{y}/{x}" 주소로 주는 XYZ 방식이라,
     * OL 의 ol.source.XYZ 에 주소 틀만 넘기면 화면에 필요한 타일을 OL 이
     * 알아서 계산해 요청합니다. 좌표계도 우리 지도와 같은 EPSG:3857 이라
     * 변환이 필요 없습니다.
     *
     * [왜 서버를 안 거치고 단말이 직접 부르나]
     * 처음엔 인증키를 감추려고 우리 서버가 타일을 대신 받는 프록시로 만들었는데,
     * 운영서버(fly 도쿄)에서 api.vworld.kr 접속이 곧바로 실패하는 것을 실측으로
     * 확인했다(2026-08-01, 브이월드의 해외 IP 차단으로 추정). 국내에 있는 사용자
     * 단말은 막히지 않으므로 브라우저가 브이월드를 직접 부르게 한다.
     * 인증키는 등록된 서비스URL 에서만 통하도록 묶여 있어(도메인 검증) 주소에
     * 노출돼도 다른 사이트에서 가져다 쓸 수 없다.
     *
     * [키를 받아오는 순서]
     * 레이어를 만드는 시점엔 키가 없으므로 주소 없이 먼저 만들고,
     * /api/ocean/vworld-key 응답이 오면 source.setUrl() 로 주소를 채운다.
     * (OL 은 setUrl 시점에 타일을 다시 요청한다)
     *
     * @param {string} layer - 'Satellite'(위성영상) | 'Hybrid'(지명·도로 라벨)
     * @returns {ol.layer.Tile} 처음엔 숨김(visible:false) 상태인 타일 레이어
     * [연계] ← buildMap() 이 위성지도 2장(영상+라벨)을 만들 때 호출
     *          ← window.oceanCreateVworldLayer 로도 노출 → life_safety.js 가 활동
     *            지도에 같은 2장을 끼워 넣을 때 호출
     *          → local_server/routes/ocean1.js 의 GET /api/ocean/vworld-key
     */
    function createVworldLayer(layer) {
        // 위성영상만 jpeg, 라벨(Hybrid)은 투명 배경이 필요해 png.
        var ext = (layer === 'Satellite') ? 'jpeg' : 'png';

        var source = new ol.source.XYZ({
            projection: 'EPSG:3857',
            // [고화질 화면 대응] 브이월드는 256픽셀 조각 하나만 주고 레티나(2배·3배)
            //   전용 조각이 없다. 그대로 쓰면 픽셀밀도 3배 폰에서 3배로 늘려 그려져
            //   뿌옇게 보인다(실측 확인). 그래서 격자를 "한 칸당 128" 로 선언해
            //   OL 이 한 단계 더 깊은 조각을 받아 절반 크기로 그리게 한다 → 2배 선명.
            //   - tileSize:128 + 해상도 2배 = 조각이 덮는 실제 땅 넓이는 그대로라
            //     위치가 어긋나지 않는다(줌16 화면에서 z17 조각 요청, 좌표 일치 확인).
            //   - maxZoom 19 에서 멈추므로 가장 깊이 확대해도 빈 화면이 되지 않는다
            //     (그 지점에서는 예전처럼 z19 조각을 늘려 그린다).
            //   - 대가: 화면당 조각 수가 4배 → 지도 데이터 사용량도 약 4배.
            tilePixelRatio: 2,
            tileGrid: ol.tilegrid.createXYZ({ tileSize: 128, maxZoom: VWORLD_MAX_ZOOM }),
            attributions: '&copy; <a href="https://www.vworld.kr">국토교통부 브이월드</a>'
            // [주의] crossOrigin 을 주지 않는다. 브이월드가 CORS 헤더를 안 주면
            //        crossOrigin:'anonymous' 타일은 통째로 로드에 실패한다.
            //        우리는 타일을 캔버스로 읽어내지 않으므로 필요 없다.
        });

        // 키를 받아 주소를 채운다. 실패하면 주소가 비어 타일 요청 자체가 안 나가고
        // (빈 배경) 다른 배경지도는 영향받지 않는다.
        fetchVworldKey().then(function (key) {
            if (!key) return;
            source.setUrl('https://api.vworld.kr/req/wmts/1.0.0/' + key + '/' +
                          layer + '/{z}/{y}/{x}.' + ext);
        });

        return new ol.layer.Tile({ source: source, visible: false });
    }

    /**
     * 브이월드 인증키를 서버에서 한 번만 받아 온다 (이후엔 같은 약속을 재사용).
     * 예: fetchVworldKey().then(k => k) → "62FAF40F-…"
     * @returns {Promise<string>} 인증키. 못 받으면 빈 문자열.
     * [연계] ← createVworldLayer — 위성지도 2장이 같은 키를 쓰므로 요청은 1번만
     *          → local_server/routes/ocean1.js 의 GET /api/ocean/vworld-key
     */
    var _vworldKeyPromise = null;
    function fetchVworldKey() {
        if (_vworldKeyPromise) return _vworldKeyPromise;
        _vworldKeyPromise = fetch('/api/ocean/vworld-key')
            .then(function (r) { return r.json(); })
            .then(function (j) { return (j && j.key) || ''; })
            .catch(function (e) {
                console.warn('[OceanMap] 브이월드 인증키 조회 실패:', e.message);
                return '';
            });
        return _vworldKeyPromise;
    }

    // ========================================================================
    // 해구도 격자 레이어 (KMA marine_zone/area 기반)
    // ========================================================================
    //
    // [데이터 출처]
    //   KMA 해양기상기후정보포털 — https://marine.kma.go.kr/mmis_marine_api/v1/kma/mdl/marine_zone/area
    //   응답 GeoJSON FeatureCollection, CRS84(EPSG:4326), 1331개 0.5°×0.5° 셀.
    //   래퍼(code/msg/data) 벗긴 순수 GeoJSON 을 정적 파일로 저장.
    //   격자 자체는 거의 정적 데이터라 한 번 받아두면 반영구적으로 재사용 가능.
    //
    // [파일 경로 주의]
    //   local_server/marine_zone_area.json (프로젝트 루트 직속).
    //   local_server/data/ 는 .dockerignore 와 fly.io persistent volume 마운트로
    //   git 커밋 파일이 운영에 반영되지 않는 디렉터리이므로 절대 거기 두지 말 것.
    //   land_mask_korea.json 과 같은 정적 GeoJSON 컨벤션(루트 직속)을 따른다.
    //
    // [3-레이어 구성]
    //   1) 대해구 outline   — 항상 표시, 얇은 흰선
    //   2) 소해구 (3×3 분할) — 클라이언트에서 계산해 줌인 시 (≥9) 만 표시, 더 흐림
    //                           KMA 자체도 소해구 폴리곤 endpoint 가 없어 분할 방식 채택.
    //   3) 대해구 번호 라벨  — 셀 중앙, 흐린 흰색, 줌 ≥8 에서만 표시
    //
    // [성능 메모]
    //   소해구 = 1331 × 9 ≈ 12000 폴리곤. 줌 임계값으로 시야 밖일 때 렌더 차단.
    const MARINE_ZONE_GEOJSON_URL = '/marine_zone_area.json';

    /**
     * [헬퍼] 폴리곤 외곽선의 좌표 배열을 받아 그 도형을 감싸는 최소
     *        직사각형(bounding box)의 네 모서리 좌표를 돌려준다.
     *
     * 무엇을 하나?
     *   - 입력: GeoJSON Polygon 의 outer ring 배열.
     *           각 원소는 [경도, 위도] 한 점. 예: [[127, 34], [127.5, 34], ...]
     *   - 출력: [lonMin, latMin, lonMax, latMax]
     *           즉 "왼쪽아래 점의 경위도" + "오른쪽위 점의 경위도".
     *
     * 왜 필요한가?
     *   해구 셀은 0.5° × 0.5° 사각형이지만 GeoJSON 에 들어 있는 점 순서를
     *   믿을 수 없을 때가 있다. 셀을 9분할하거나 셀 중앙에 라벨을 찍으려면
     *   "이 셀의 좌하/우상 좌표는 어디인가?" 가 필요하므로, 모든 점을
     *   훑어 최소/최대를 직접 구해 안전하게 처리한다.
     *
     * 어디서 쓰이나?
     *   - initMarineZoneGridLayers() 안의 소해구 3×3 분할 좌표 계산.
     *
     * @param {Array<[number, number]>} ring - 폴리곤 외곽선의 [경도,위도] 점 목록
     * @returns {[number, number, number, number]} [lonMin, latMin, lonMax, latMax]
     */
    function _bboxOfRing(ring) {
        // Infinity 로 시작해서 점을 순회하며 더 작은/큰 값을 찾아 갱신하는
        // 표준 패턴. 점 1개라도 있으면 항상 정상값으로 끝난다.
        let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity;
        for (const p of ring) {
            if (p[0] < lonMin) lonMin = p[0]; // 경도 최소
            if (p[0] > lonMax) lonMax = p[0]; // 경도 최대
            if (p[1] < latMin) latMin = p[1]; // 위도 최소
            if (p[1] > latMax) latMax = p[1]; // 위도 최대
        }
        return [lonMin, latMin, lonMax, latMax];
    }

    /**
     * [핵심] 해구도 격자 레이어 3종을 만들어 OpenLayers 지도에 추가한다.
     *
     * ─────────────────────────────────────────────────────────────────
     * 무엇을 하나? (4단계로 동작)
     *   ① 우리 서버에 미리 받아둔 GeoJSON 파일을 fetch 로 가져온다.
     *      (KMA marine_zone/area 응답을 한 번만 받아 정적 저장한 것)
     *   ② OL 의 GeoJSON 포맷터를 써서 좌표계를 EPSG:4326 → EPSG:3857 로 변환.
     *      (지도는 3857 로 그리지만, KMA 데이터는 일반 경위도 4326 으로 옴)
     *   ③ 3개의 Vector 레이어를 만든다.
     *        Layer1) 대해구 outline   — 0.5°×0.5° 셀 1331 개의 외곽선
     *        Layer2) 소해구 outline   — 각 대해구 셀을 3×3 으로 클라가 분할 (12000 개)
     *        Layer3) 대해구 번호 라벨 — 각 셀 중앙에 marine_zone_no 텍스트
     *   ④ 세 레이어 모두 visible:false 로 만들고 지도에 추가.
     *      → 화면에는 안 보이는 상태. bindMarineZoneGridToggle 가 버튼과
     *        연결해 사용자가 "해구도" 버튼을 누를 때만 ON 으로 바뀐다.
     *
     * 왜 클라이언트에서 소해구를 분할하나?
     *   KMA 페이지 자체도 소해구(105-1 ~ 105-9) 도형을 별도로 그려주지
     *   않는다(역공학 결과 확인됨). 우리도 대해구 셀의 경위도 범위를
     *   균등 3×3 분할하는 동일 방식을 쓴다.
     *
     * 어디서 호출되나?
     *   - buildMap() 안에서 window.__SEAGNAL_PAGE === 'index2' 일 때만 호출.
     *   - 호출 후 .then(bindMarineZoneGridToggle) 으로 토글 버튼을 묶는다.
     *
     * 데이터 의존:
     *   - /data/marine_zone_area.json  (정적 GeoJSON, 약 300KB)
     *   - 갱신이 필요하면 KMA endpoint 다시 받아 같은 경로에 덮어쓰기만 하면 됨.
     *
     * @param {ol.Map} map - 격자 레이어를 얹을 OL 지도 인스턴스
     * @returns {Promise<void>} fetch + 레이어 생성 완료를 알리는 Promise
     */
    async function initMarineZoneGridLayers(map) {
        // ── ① 정적 GeoJSON 파일 로드 ─────────────────────────────────
        // 네트워크 / 파일 경로 문제가 생겨도 지도 다른 부분은 영향받지 않도록
        // try/catch 로 완전히 감싸고, 실패 시엔 console.warn 만 남긴다.
        let geojson;
        try {
            const r = await fetch(MARINE_ZONE_GEOJSON_URL);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            geojson = await r.json();
        } catch (e) {
            console.warn('[OceanMap] 해구도 격자 로드 실패:', e.message);
            return;   // 레이어 안 만들고 종료. 토글 버튼은 비활성화 상태로 남음.
        }

        // ── ② 좌표계 변환기 준비 ────────────────────────────────────
        // KMA 응답: WGS84 경위도 (EPSG:4326) → 우리 OL 지도: 웹 메르카토르 (EPSG:3857)
        // OL 의 GeoJSON 포맷터는 readFeatures 호출 시 자동으로 좌표를 변환해 준다.
        const fmt = new ol.format.GeoJSON({
            dataProjection: 'EPSG:4326',     // 입력 GeoJSON 의 좌표계
            featureProjection: 'EPSG:3857'   // OL 지도가 사용하는 좌표계
        });
        const mainFeatures = fmt.readFeatures(geojson);

        // ── ③-1 Layer1: 대해구 outline ──────────────────────────────
        // 1331 개 사각형 셀의 테두리만 그린다. 채움(fill)은 시각적으로는 투명이지만
        // 클릭 hit-test 를 위해 반드시 필요. fill 이 없으면 OL 은 stroke 픽셀만
        // hit 으로 인정해 셀 내부 빈 공간을 누르면 클릭이 통과되어 버린다.
        // visible:false 로 시작 → 버튼으로 ON.
        marineZoneGridLayer = new ol.layer.Vector({
            source: new ol.source.Vector({ features: mainFeatures }),
            style: new ol.style.Style({
                fill: new ol.style.Fill({ color: 'rgba(0,0,0,0)' }),  // 투명 fill = 클릭 영역 확보
                stroke: new ol.style.Stroke({
                    color: 'rgba(255,255,255,0.35)',  // 흰색에 alpha 0.35 → 흐리게
                    width: 1
                })
            }),
            visible: false,
            zIndex: 50    // 베이스맵보다는 위, 라벨(51)보다는 아래
        });

        // ── ③-2 Layer2: 소해구 (대해구 3×3 분할) ─────────────────────
        // 각 대해구 셀의 경위도 범위를 9등분해서 12000 개 사각형 GeoJSON 을
        // 메모리에서 만든 뒤, OL 에게 한 번에 readFeatures 로 넘긴다.
        // 분할은 CPU 잠깐 쓰지만 한 번만 일어나므로 부담 없음.
        const subGeo = { type: 'FeatureCollection', features: [] };
        for (const f of geojson.features) {
            // 일부 feature 가 비정상이면 건너뛴다 (방어 코드)
            const ring = (f.geometry && f.geometry.coordinates && f.geometry.coordinates[0])
                ? f.geometry.coordinates[0][0] : null;
            if (!ring || ring.length < 4) continue;

            // 셀의 사각형 범위 계산 → 가로/세로를 3 으로 나눠 작은 셀의 한 변 길이를 얻는다.
            const [lonMin, latMin, lonMax, latMax] = _bboxOfRing(ring);
            const lonStep = (lonMax - lonMin) / 3;
            const latStep = (latMax - latMin) / 3;
            const parentNo = (f.properties && f.properties.marine_zone_no) || '';

            // 3 × 3 = 9 개 작은 셀 생성. row/col 인덱스로 sub_no 1~9 부여.
            // (예: 부모 105 → 105-1 .. 105-9 처럼 식별 가능)
            //
            // [번호 매김 규칙 — KMA 표준]
            //   북쪽이 위. 좌→우, 위→아래 순으로 1..9.
            //     1 2 3   ← 북(latMax)
            //     4 5 6
            //     7 8 9   ← 남(latMin)
            //
            // [주의 — 좌표계 차이]
            //   seaZones.js 의 이미지 지도는 imgY 가 아래로 증가(이미지 좌표) 하므로
            //   `row*3+col+1` 만 써도 자연스럽게 위 규칙과 일치한다.
            //   반면 OL 은 지리 위도(lat) 가 위로 증가하기 때문에, row=0 일 때
            //   latMin 부터(=남쪽부터) 시작한다. 따라서 sub_no 를 그대로
            //   `row*3+col+1` 로 매기면 1·2·3 이 남쪽에 가서 표준과 정반대가 된다.
            //   → row 를 (2 - row) 로 뒤집어 북쪽 행이 1·2·3 이 되도록 보정.
            for (let row = 0; row < 3; row++) {
                for (let col = 0; col < 3; col++) {
                    const x0 = lonMin + col * lonStep;
                    const x1 = x0 + lonStep;
                    const y0 = latMin + row * latStep;
                    const y1 = y0 + latStep;
                    // 북쪽 = 표준 1·2·3 이 되도록 row 반전
                    const subNo = (2 - row) * 3 + col + 1;
                    subGeo.features.push({
                        type: 'Feature',
                        properties: {
                            parent_marine_zone_no: parentNo,    // 어느 대해구의 자식인지
                            sub_no: subNo                        // 1..9 (KMA 표준 배열)
                        },
                        geometry: {
                            type: 'Polygon',
                            // GeoJSON Polygon: [[outer ring]] → 점은 닫힌 형태로 끝점 = 시작점
                            coordinates: [[
                                [x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]
                            ]]
                        }
                    });
                }
            }
        }
        const subFeatures = fmt.readFeatures(subGeo);
        marineZoneSubGridLayer = new ol.layer.Vector({
            source: new ol.source.Vector({ features: subFeatures }),
            style: new ol.style.Style({
                // 투명 fill — 대해구와 동일 이유 (클릭 hit-test 영역 확보)
                fill: new ol.style.Fill({ color: 'rgba(0,0,0,0)' }),
                stroke: new ol.style.Stroke({
                    color: 'rgba(255,255,255,0.18)',  // 더 흐림 (대해구 0.35 보다 옅음)
                    width: 0.5
                })
            }),
            // minZoom: 줌 레벨이 이 값 "초과" 일 때만 레이어 렌더링.
            // 줌 8 이하에서는 12000 셀이 너무 빽빽해 보이므로 차단.
            minZoom: 8,
            visible: false,
            zIndex: 49    // 대해구 outline(50) 보다 살짝 아래로 깔아둠
        });

        // ── ③-3 Layer3: 대해구 번호 라벨 ─────────────────────────────
        // 각 대해구 셀의 중앙에 marine_zone_no 텍스트를 찍는다.
        // 도형이 아니라 Point geometry + Text 스타일로 표시 → 줌 변해도 글자 크기 일정.
        const labelFeatures = mainFeatures.map(function (mf) {
            // mf 는 이미 EPSG:3857 로 변환된 상태. extent 도 3857 좌표.
            const ext = mf.getGeometry().getExtent();   // [minX, minY, maxX, maxY]
            const cx = (ext[0] + ext[2]) / 2;            // 셀 중앙 X (3857)
            const cy = (ext[1] + ext[3]) / 2;            // 셀 중앙 Y (3857)
            const props = mf.getProperties();
            const f = new ol.Feature({ geometry: new ol.geom.Point([cx, cy]) });
            // 라벨 텍스트는 marine_zone_no 우선, 없으면 name 사용 (방어).
            f.set('label', String(props.marine_zone_no || props.name || ''));
            return f;
        });
        marineZoneLabelLayer = new ol.layer.Vector({
            source: new ol.source.Vector({ features: labelFeatures }),
            // style 을 함수로 주면 feature 마다 다른 텍스트를 그릴 수 있다.
            style: function (feature) {
                return new ol.style.Style({
                    text: new ol.style.Text({
                        text: feature.get('label'),
                        font: '11px sans-serif',
                        fill: new ol.style.Fill({ color: 'rgba(255,255,255,0.55)' }),
                        // 검은 외곽선을 두텁게 깔아서 어떤 베이스맵 위에서도 가독성 확보
                        stroke: new ol.style.Stroke({ color: 'rgba(0,0,0,0.55)', width: 2 })
                    })
                });
            },
            // 줌 7 이하에서는 1331 개 라벨이 겹쳐서 알아볼 수 없으므로 숨김.
            minZoom: 7,
            visible: false,
            zIndex: 51    // 가장 위에 그려져야 글자가 가려지지 않음
        });

        // ── ④ 지도에 레이어 추가 ─────────────────────────────────────
        map.addLayer(marineZoneGridLayer);
        map.addLayer(marineZoneSubGridLayer);
        map.addLayer(marineZoneLabelLayer);

        console.log('[OceanMap] 해구도 격자 로드 완료:', mainFeatures.length, '개 셀');
    }

    /**
     * [토글] "해구도" 버튼과 격자 레이어 3종을 연결한다.
     *
     * 무엇을 하나?
     *   ① index2.html 의 #ocean-marine-zone-toggle-btn 버튼을 찾는다.
     *   ② 페이지가 처음 열릴 때, 사용자의 이전 선택을 localStorage 에서 복원해
     *      그 상태(켜짐/꺼짐) 그대로 시작한다.
     *   ③ 버튼을 누를 때마다 visible 플래그를 뒤집고
     *      세 레이어(대해구/소해구/라벨) 의 setVisible 을 같은 값으로 호출.
     *   ④ 새 상태를 다시 localStorage 에 저장 → 새로고침해도 유지.
     *
     * 어디서 호출되나?
     *   - buildMap() 에서 initMarineZoneGridLayers() 가 끝난 뒤 .then 으로 연결.
     *     레이어가 만들어지지 않았으면(데이터 로드 실패) 토글 자체를 비활성화.
     *
     * 주의사항:
     *   - 소해구·라벨 레이어는 minZoom 으로 줌에 따라 자동 가/숨 처리되므로,
     *     이 함수에서는 단순히 visible(전체 ON/OFF) 만 제어하면 된다.
     *   - localStorage 가 막힌 환경(시크릿모드 등) 에서도 죽지 않도록 try/catch.
     *
     * 연계:
     *   - HTML : index2.html 의 <button id="ocean-marine-zone-toggle-btn">
     *   - 레이어: marineZoneGridLayer / marineZoneSubGridLayer / marineZoneLabelLayer
     *           (initMarineZoneGridLayers 가 만들어 둔 모듈 변수)
     *   - 스타일: 버튼이 active 클래스를 갖고 있을 때 CSS 가 강조 색을 입힘
     *           (다른 ocean-overlay-btn 들과 동일한 패턴)
     */
    function bindMarineZoneGridToggle() {
        // ── ① DOM 요소 + 레이어 존재 확인 ───────────────────────────
        const btn = document.getElementById('ocean-marine-zone-toggle-btn');
        if (!btn) return;                     // index2 가 아니거나 버튼 자체가 없는 경우
        if (!marineZoneGridLayer) return;     // 데이터 로드 실패 시 토글 비활성화

        // ── ② localStorage 에서 이전 상태 복원 ──────────────────────
        // 처음 방문 또는 저장 안 된 경우 false (꺼짐) 가 기본값.
        let visible;
        try {
            visible = localStorage.getItem('seagnal_marine_zone_visible') === 'true';
        } catch (e) { visible = false; }

        // ── ③ "현재 상태를 화면+레이어에 적용" 헬퍼 ─────────────────
        // 같은 동작을 초기화 시점과 클릭 시점에 둘 다 써야 하므로 함수로 묶음.
        const apply = (v) => {
            btn.classList.toggle('active', v);   // 버튼 색 강조 ON/OFF
            // sub/label 은 minZoom 으로 자동 가/숨 → 토글에서는 visible 만 제어.
            if (marineZoneGridLayer)    marineZoneGridLayer.setVisible(v);
            if (marineZoneSubGridLayer) marineZoneSubGridLayer.setVisible(v);
            if (marineZoneLabelLayer)   marineZoneLabelLayer.setVisible(v);
        };
        apply(visible);   // 페이지 진입 시 복원된 상태를 즉시 반영

        // ── ④ 클릭 핸들러: 상태 뒤집고 저장 ─────────────────────────
        btn.addEventListener('click', function () {
            visible = !visible;
            apply(visible);
            try { localStorage.setItem('seagnal_marine_zone_visible', String(visible)); } catch (e) {}
            // OFF 로 돌아갈 때는 "선택 상태" 도 같이 비워서 다음에 켤 때 깨끗하게 시작.
            if (!visible) _resetMarineZoneSelection();
            // [단독 표출] 해구도 ON 시 물빠짐이 켜져 있으면 끔.
            if (visible && typeof window._tideFieldDeactivate === 'function') {
                try { window._tideFieldDeactivate(); } catch (e) {}
            }
        });
    }

    /**
     * [외부 API] 해구도 토글을 프로그래밍 방식으로 켜고 끈다.
     *
     * 무엇을 하나?
     *   #ocean-marine-zone-toggle-btn 의 현재 active 상태를 읽어
     *   원하는 상태(visible) 와 다르면 버튼을 클릭한 효과를 발생시킨다.
     *   이 한 번의 click() 으로 다음 부수효과가 모두 동기화된다:
     *     - bindMarineZoneGridToggle 의 click 핸들러 → visible 플래그 반전,
     *       3개 레이어 setVisible, localStorage 저장
     *     - index2_patch.js 의 _bindMarineZoneToggleToast → 안내 토스트 표시
     *
     * 왜 필요한가?
     *   "해구기상" 버튼 같은 외부 진입 경로에서 해양종합정보 탭으로 이동할 때
     *   격자가 자동으로 보이도록 강제 ON 하고 싶지만, 우리 토글 함수의 visible
     *   상태가 클로저 안에 갇혀 있어 직접 setVisible 만 부르면 토스트/스토리지
     *   가 어긋난다. 같은 결과를 안전하게 내려면 버튼 클릭을 흉내 내는 것이
     *   가장 확실. (이미 ON 인 상태에서 또 클릭하면 OFF 로 가버리므로
     *   active 클래스로 현재 상태를 먼저 점검한 뒤 필요할 때만 click 호출.)
     *
     * 어디서 호출되나?
     *   - js/render.js / js/windy.js 의 "해구기상" 버튼 클릭 핸들러
     *     (index2 분기에서 해구도 ON 보장 후 goToOceanMapByZone 호출 전)
     *
     * @param {boolean} visible - 원하는 가시 상태 (true=ON, false=OFF)
     * @returns {boolean} 토글 버튼이 존재해 처리 가능했으면 true
     */
    window.setMarineZoneGridVisible = function (visible, _attempt) {
        const btn = document.getElementById('ocean-marine-zone-toggle-btn');
        if (!btn) return false;
        const isActive = btn.classList.contains('active');
        if (isActive !== !!visible) {
            btn.click();   // 토글 핸들러 + 토스트가 같이 발화 → 상태 일관성 보장
            // [최초 로드 대응] 지도 빌드 전이면 토글 핸들러가 아직 안 묶여 click 이
            //   무시될 수 있다(.active 가 안 바뀜). 실제 적용될 때까지 폴링 재시도.
            if (btn.classList.contains('active') !== !!visible && (_attempt || 0) < 40) {
                setTimeout(function () {
                    window.setMarineZoneGridVisible(visible, (_attempt || 0) + 1);
                }, 150);
            }
        }
        return true;
    };

    // ========================================================================
    // 해구도 클릭 — 2-step 선택 → 기상 모달
    // ========================================================================
    //
    // [전체 흐름]
    //   1) 사용자가 해구도 토글을 ON 으로 켠 상태에서 격자 셀(대해구/소해구)을 클릭.
    //   2) 첫 클릭   : 해당 셀 테두리를 시안색으로 강조 (하이라이트). 모달은 안 뜸.
    //   3) 같은 셀 두 번째 클릭 : window.getMarineZoneData(zoneId) 호출 →
    //                           기존 "해구별 기상" 모달이 그대로 떠서 시계열 표시.
    //   4) 다른 셀을 클릭하면    : 기존 하이라이트 해제 + 새 셀에 하이라이트 (다시 1단계).
    //
    // [zoneId 규칙 — 기존 seaZones.js 와 동일]
    //   - 대해구 클릭 : "105"          (marine_zone_no 그대로 문자열)
    //   - 소해구 클릭 : "105-3"        (parent_marine_zone_no + "-" + sub_no(1..9))
    //
    // [데이터/모달 의존]
    //   - window.getMarineZoneData (js/marine.js)         — fetch + 모달 호출
    //   - window.showMarineZoneModal (js/marine.js)        — 모달 자체 (마린이 호출)
    //   - /api/marine-zone-forecasts → zone_forecasts.json — 부모 대해구 키만 사용
    //   index2.html 은 위 스크립트들을 모두 로드하므로 추가 의존 없음.
    //
    // [클릭 우선순위]
    //   handleMapClick 에서 다른 마커(CCTV/부이/마커)가 먼저 처리되고, 모두 hit
    //   가 아닌 경우에만 격자 hit-test 로 내려옴. 격자 hit 이면 바텀시트도 뜨지
    //   않도록 true 를 반환.
    // ========================================================================

    /**
     * [헬퍼] 현재 줌 레벨에서 소해구(sub) 레이어가 보이는지 판정.
     *
     * 무엇을 하나?
     *   OL 뷰의 현재 줌 값을 읽어 marineZoneSubGridLayer 의 minZoom(=8) 보다
     *   큰지 비교한다. 결과는 boolean.
     *
     * 왜 필요한가?
     *   tryHandleMarineZoneClick 이 클릭 hit-test 를 할 때, 소해구가 화면에
     *   보이는 줌이면 소해구 레이어를 먼저 검사해야 한다 (작은 셀이 큰 셀
     *   안에 있으니 사용자 의도는 작은 셀일 가능성이 높음). 안 보이는 줌이면
     *   대해구만 검사하면 된다.
     *
     * 어디서 호출되나?
     *   - tryHandleMarineZoneClick 에서 layersInPriority 결정용으로 한 번 호출.
     *
     * @returns {boolean} 줌 > 8 이면 true (= 소해구 레이어 가시)
     */
    function _isSubVisibleZoom() {
        if (!oceanMap) return false;
        const z = oceanMap.getView().getZoom();
        return typeof z === 'number' && z > 8;   // marineZoneSubGridLayer.minZoom 과 동일
    }

    /**
     * [헬퍼] 첫 클릭으로 선택된 대해구 셀에 입힐 임시 하이라이트 스타일.
     *
     * 무엇을 하나?
     *   시안색(#4fc3f7) 의 굵은 테두리 + 투명 fill 을 가진 ol.style.Style 객체를
     *   매번 새로 만들어 돌려준다.
     *
     * 왜 필요한가?
     *   - 사용자에게 "이 셀이 선택됐다"는 시각적 피드백을 주기 위해 1단계 클릭
     *     시 feature.setStyle 로 잠시 덮어쓴다.
     *   - 투명 fill 을 같이 주는 이유: OL 의 hit-test 는 fill 이 없는 폴리곤을
     *     stroke 픽셀에서만 hit 으로 인정하므로, 두 번째 클릭(모달 호출) 이
     *     같은 셀 내부에서 또 미스되지 않으려면 fill 이 반드시 있어야 한다.
     *
     * 어디서 호출되나?
     *   - tryHandleMarineZoneClick 의 Step 1 분기에서 `hitFeature.setStyle(...)`.
     *   - 매 클릭마다 새 Style 인스턴스를 만들기 위해 함수로 분리.
     *
     * @returns {ol.style.Style} 시안색 테두리 + 투명 fill 한 set
     */
    function _styleSelectedMainFeature() {
        return new ol.style.Style({
            fill: new ol.style.Fill({ color: 'rgba(0,0,0,0)' }),
            stroke: new ol.style.Stroke({ color: '#4fc3f7', width: 2.5 })
        });
    }

    /**
     * [헬퍼] 첫 클릭으로 선택된 소해구 셀에 입힐 임시 하이라이트 스타일.
     *
     * 무엇을 하나?
     *   노랑(#ffeb3b) 의 굵은 테두리 + 투명 fill ol.style.Style 객체 반환.
     *
     * 왜 필요한가?
     *   - 대해구 하이라이트(시안)와 색을 다르게 해서 사용자가 "지금 큰 해구를
     *     골랐는지 작은 해구를 골랐는지" 한눈에 구분 가능.
     *   - 투명 fill 을 같이 두는 이유는 _styleSelectedMainFeature 와 동일.
     *
     * 어디서 호출되나?
     *   - tryHandleMarineZoneClick 의 Step 1 분기 중 isSub === true 일 때.
     *
     * @returns {ol.style.Style} 노랑 테두리 + 투명 fill 한 set
     */
    function _styleSelectedSubFeature() {
        return new ol.style.Style({
            fill: new ol.style.Fill({ color: 'rgba(0,0,0,0)' }),
            stroke: new ol.style.Stroke({ color: '#ffeb3b', width: 2 })
        });
    }

    /**
     * 현재 선택된 main/sub feature 의 임시 스타일을 모두 원복하고 추적 변수 초기화.
     * - feature.setStyle(undefined) : 레이어 기본 스타일로 되돌리는 OL 의 표준 방식.
     * - 토글 OFF / 다른 셀 클릭 / 빈 곳 클릭 시 호출.
     */
    function _resetMarineZoneSelection() {
        if (_selectedMainZoneFeature) {
            _selectedMainZoneFeature.setStyle(undefined);
            _selectedMainZoneFeature = null;
        }
        if (_selectedSubZoneFeature) {
            _selectedSubZoneFeature.setStyle(undefined);
            _selectedSubZoneFeature = null;
        }
        _selectedZoneId = null;
    }

    /**
     * 해구도 격자 클릭 hit-test + 2-step 선택 처리.
     *
     * @param {ol.MapBrowserEvent} evt - handleMapClick 이 받은 OL 클릭 이벤트
     * @returns {boolean} true 면 "격자 셀이 처리됨" → 호출자(handleMapClick) 가
     *                    뒤따르는 바텀시트/위치 표시 로직을 건너뛰어야 함.
     */
    function tryHandleMarineZoneClick(evt) {
        // 토글 OFF 거나 레이어 자체가 없으면 통째로 스킵 → 다른 핸들러에 양보.
        if (!marineZoneGridLayer || !marineZoneGridLayer.getVisible()) return false;

        // sub 레이어가 보이는 줌이라면 sub 우선 검사 (사용자 경험상 더 작은 셀 우선).
        // 그 외엔 main 만 검사.
        const layersInPriority = _isSubVisibleZoom()
            ? [marineZoneSubGridLayer, marineZoneGridLayer]
            : [marineZoneGridLayer];

        // forEachFeatureAtPixel 은 callback 에서 truthy 를 반환하면 즉시 종료.
        // layerFilter 로 우리 격자 레이어로 한정 → 다른 벡터 레이어와 섞이지 않음.
        let hitFeature = null;
        let hitLayer   = null;
        for (const targetLayer of layersInPriority) {
            if (!targetLayer || !targetLayer.getVisible()) continue;
            oceanMap.forEachFeatureAtPixel(evt.pixel, function (feature, lyr) {
                if (lyr === targetLayer) { hitFeature = feature; hitLayer = lyr; return true; }
            }, { layerFilter: function (l) { return l === targetLayer; } });
            if (hitFeature) break;
        }
        if (!hitFeature) return false;   // 격자 hit 아님 → 호출자가 다른 처리 계속

        // hit 한 feature 가 어느 종류(main/sub) 인지로 zoneId 만든다.
        const isSub = (hitLayer === marineZoneSubGridLayer);
        const props = hitFeature.getProperties();
        let zoneId;
        if (isSub) {
            const parent = props.parent_marine_zone_no || '';
            const subNo  = props.sub_no || '';
            if (!parent || !subNo) return false;
            zoneId = parent + '-' + subNo;
        } else {
            zoneId = String(props.marine_zone_no || props.name || '');
            if (!zoneId) return false;
        }

        // ── 2-step 판정 ─────────────────────────────────────────────
        if (_selectedZoneId === zoneId) {
            // Step 2: 같은 셀 재클릭 → 기상 모달 호출.
            //   기존 seaZones.js 패턴과 동일: getMarineZoneData 가 정의되어 있으면 호출.
            if (typeof window.getMarineZoneData === 'function') {
                // [사용량] 해구 셀 재클릭으로 전망표/그래프가 뜰 때마다 +1
                if (window.trackUsage) window.trackUsage('ocean.gugu_forecast');
                window.getMarineZoneData(zoneId);
            } else {
                console.warn('[OceanMap] window.getMarineZoneData 미로드 — 모달 호출 불가');
            }
            // 선택 상태는 그대로 둔다(모달 닫고 같은 곳 다시 누르면 또 뜨도록).
        } else {
            // Step 1: 새 선택 → 이전 하이라이트 해제 후 새 feature 에 임시 스타일 부여.
            _resetMarineZoneSelection();
            if (isSub) {
                _selectedSubZoneFeature = hitFeature;
                hitFeature.setStyle(_styleSelectedSubFeature());
            } else {
                _selectedMainZoneFeature = hitFeature;
                hitFeature.setStyle(_styleSelectedMainFeature());
            }
            _selectedZoneId = zoneId;
        }
        return true;   // 격자 셀이 처리되었음 → 호출자는 다른 액션 중단
    }

    // ========================================================================
    // 지도 초기화
    // ========================================================================

    /**
     * 해양종합정보 지도를 초기화합니다.
     * 이미 초기화된 경우 updateSize()만 호출합니다.
     */
    window.initOceanMap = function () {
        if (oceanMap) {
            oceanMap.updateSize();
            return;
        }

        // WMS 방식이라 비동기 스크립트 로드 불필요 → 즉시 빌드
        buildMap();
    };

    /**
     * 실제 지도를 생성하는 함수.
     * 해아름 URL 확보 후 호출됩니다.
     */
    function buildMap() {
        try {
            // 해아름 WMS 레이어 생성
            baseLayerA     = createKhoaLayer(KHOA_LAYER_A);
            baseLayerENC   = createKhoaLayer(KHOA_LAYER_ENC);
            baseLayerCoast = createKhoaLayer(KHOA_LAYER_COAST);
            // 전세계 OSM 베이스 — 태풍 등 먼바다 광역 표출용(해아름은 한반도 외곽이 빈 타일)
            baseLayerOSM   = new ol.layer.Tile({ source: new ol.source.OSM(), visible: false });
            // 위성지도 — 영상 위에 라벨을 덮어야 지명이 보이므로 두 장을 세트로 쓴다.
            baseLayerVwSat   = createVworldLayer('Satellite');
            baseLayerVwLabel = createVworldLayer('Hybrid');

            // 초기 가시성: 기본맵만 표시
            baseLayerENC.setVisible(false);
            baseLayerCoast.setVisible(false);

            // 배열 순서 = 그리는 순서. 위성영상(Satellite) 다음에 라벨(Hybrid) 이
            // 와야 지명·도로가 영상 위에 얹힌다.
            const layers = [baseLayerA, baseLayerENC, baseLayerCoast, baseLayerOSM,
                            baseLayerVwSat, baseLayerVwLabel];

            // 지도 생성
            oceanMap = new ol.Map({
                target: 'ocean-map',
                layers: layers,
                // [버그수정] 터치 미세 흔들림으로 첫 탭이 '드래그(팬)'로 분류되어
                //   'click' 이벤트가 소실되는 문제 방지. 기본 1px → 6px 로 완화하여
                //   터치 탭이 클릭으로 안정적으로 인정되게 함. (부이/마커 첫 클릭 미표출 해결)
                moveTolerance: 6,
                view: new ol.View({
                    center: ol.proj.fromLonLat(DEFAULT_CENTER),
                    zoom: DEFAULT_ZOOM,
                    minZoom: MIN_ZOOM,
                    maxZoom: MAX_ZOOM
                }),
                // OSM/해아름 저작권 출처표기를 좌측 하단에 상시 노출 (collapsible:false).
                // 축척 막대(ScaleLine)는 우측 하단에 상시 노출 — 줌 레벨에 따른 대략적인
                // 거리 감을 잡을 수 있도록(사용자 요청, 2026-08-01). 이 지도(oceanMap)는
                // 해양종합정보·해양안전생활>해양안전이 함께 빌려 쓰므로 두 화면 모두 적용되고,
                // 해양생활(활동별 지도, 자체 ol.Map 인스턴스)에는 반영되지 않는다(요청대로).
                controls: ol.control.defaults.defaults({ zoom: false, rotate: false, attribution: false })
                    .extend([
                        new ol.control.Attribution({ collapsible: false }),
                        new ol.control.ScaleLine({ units: 'metric' })
                    ])
            });

            // 클릭 이벤트
            oceanMap.on('click', handleMapClick);

            // [클릭 핀 정리] 우측 기능 버튼(파고/바람/조류/해구도/천기/물빠짐 등)을 누르면
            //   배경지도에 꽂아둔 핀을 제거. capture 단계라 버튼 핸들러의 stopPropagation 과 무관.
            document.addEventListener('click', function (e) {
                var b = e.target && e.target.closest && e.target.closest('.ocean-overlay-btn');
                if (b && typeof window.oceanClearClickPin === 'function') window.oceanClearClickPin();
            }, true);

            // 뷰포트 변경 시 오버레이 갱신
            oceanMap.on('moveend', function () {
                if (window.oceanOverlayRefresh) {
                    window.oceanOverlayRefresh(oceanMap);
                }
            });

            // 베이스맵 선택 피커 바인딩
            bindBasemapPicker();

            // 마커 초기화 후 바로 토글 버튼 바인딩
            // (bindMarkerToggle 내부에서 localStorage 복원 + showOceanMarkers 초기 적용)
            if (window.initOceanMarkers) {
                window.initOceanMarkers(oceanMap);
            }
            bindMarkerToggle();

            // 기상부이 + 통합 클러스터 초기화 (INDEX2 전용, ocean_buoy.js에서 정의)
            // INDEX1에서는 함수가 없으므로 이 블록 자체가 실행되지 않음
            if (window.initOceanBuoys) {
                window.initOceanBuoys(oceanMap);
            }

            // 위치 검색 초기화
            initOceanSearch();

            // 내 위치 버튼
            const myLocBtn = document.getElementById('ocean-myloc-btn');
            if (myLocBtn) {
                myLocBtn.addEventListener('click', goToMyLocation);
            }

            // 오버레이 초기화 (버튼 바인딩, 캔버스 준비)
            if (window.oceanOverlayInit) {
                window.oceanOverlayInit(oceanMap);
            }

            // 타임라인 초기화 (항상 표시)
            if (window.initOceanTimeline) {
                window.initOceanTimeline();
            }

            // 해구도 격자 레이어 (index2 전용 — 토글 버튼이 index2.html 에만 있음)
            // 레이어 자체는 init 후에도 visible:false 유지, 버튼 클릭 시에만 ON.
            if (window.__SEAGNAL_PAGE === 'index2') {
                initMarineZoneGridLayers(oceanMap).then(bindMarineZoneGridToggle);
            }

            // [기타 기상] KMA 단기예보 PNG 오버레이 모듈 (index2 전용)
            // shrt_forecast_layer.js 가 ImageStatic 으로 추가/제거하기 위해 oceanMap 핸들 노출.
            window.__getOceanMap = function () { return oceanMap; };
            if (window.__SEAGNAL_PAGE === 'index2' && window.initShrtForecastLayer) {
                window.initShrtForecastLayer(oceanMap);
            }
            // [시정예측] KMA RDPS 시정/안개 PNG 오버레이 모듈 (index2 전용 — 천기 메커니즘 복제)
            if (window.__SEAGNAL_PAGE === 'index2' && window.initVsbyForecastLayer) {
                window.initVsbyForecastLayer(oceanMap);
            }

            // [물빠짐] 서해·남해 갯벌 노출 예측 레이어 (index2 전용)
            //   tide_field.js 가 토글 버튼 + 시간 슬라이더 + 2색 벡터 레이어를 바인딩.
            //   (tide_field.js 자체에도 autoInit 폴링이 있어 누락 시 자동 보강)
            if (window.__SEAGNAL_PAGE === 'index2' && window.initTideFieldLayer) {
                window.initTideFieldLayer(oceanMap);
            }

            // [위험물] 간출암·노출암 포인트 레이어 (index2 전용).
            //   레이어 자체는 항상 만들어 두되(visible:false), 토글 버튼이
            //   해양안전(life_safety.js)에서만 CSS 로 노출되므로 실사용도 그쪽에 한정.
            if (window.__SEAGNAL_PAGE === 'index2' && window.initHazardRocksLayer) {
                window.initHazardRocksLayer(oceanMap);
            }

            console.log('[OceanMap] 지도 초기화 완료 (해아름 WMS)');
        } catch (error) {
            console.error('[OceanMap] 초기화 오류:', error);
        }
    }

    // ========================================================================
    // 베이스맵 선택 피커
    // ========================================================================

    /** 현재 currentBase 에 해당하는 레이어만 표시, 나머지 숨김 */
    function applyBaseLayerVisibility() {
        if (baseLayerA)     baseLayerA.setVisible(currentBase === 'rltm');
        if (baseLayerENC)   baseLayerENC.setVisible(currentBase === 'enc');
        if (baseLayerCoast) baseLayerCoast.setVisible(currentBase === 'coast');
        if (baseLayerOSM)   baseLayerOSM.setVisible(currentBase === 'osm');
        // 위성지도는 영상 + 라벨 두 장을 항상 함께 켜고 끈다.
        if (baseLayerVwSat)   baseLayerVwSat.setVisible(currentBase === 'vworld');
        if (baseLayerVwLabel) baseLayerVwLabel.setVisible(currentBase === 'vworld');
    }

    /**
     * 베이스맵을 지정한 종류로 전환합니다.
     * @param {string} type - 'rltm'(기본맵) | 'enc'(전자해도) | 'coast'(해안도)
     *                        | 'osm'(세계지도) | 'vworld'(위성지도)
     *
     * 기본맵·전자해도로 전환할 경우 파티클 오버레이(조류/바람/파고)를 자동으로 끕니다.
     * 오버레이는 해안도에서만 의미 있는 시각화이기 때문입니다.
     * (해안도 → 기본맵으로 돌아가면서 파티클이 남아 있는 것을 방지)
     */
    function switchBaseLayer(type) {
        currentBase = type;
        applyBaseLayerVisibility();

        // 줌 한계 조정 — 위성지도(브이월드)만 19, 나머지는 해아름 한계인 15.
        // 위성지도에서 16 이상으로 확대한 뒤 다른 배경으로 돌아가면 해아름이
        // 타일을 못 줘 빈 화면이 되므로, 한계를 내리면서 현재 줌도 같이 당겨준다.
        if (oceanMap) {
            var view = oceanMap.getView();
            var maxZoom = (type === 'vworld') ? VWORLD_MAX_ZOOM : MAX_ZOOM;
            view.setMaxZoom(maxZoom);
            if (view.getZoom() > maxZoom) view.setZoom(maxZoom);
        }

        // 피커 버튼 active 상태 갱신
        document.querySelectorAll('.ocean-basemap-item').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.basemap === type);
        });

        // 레이어 이름 표시 갱신
        var toggleLabel = document.getElementById('ocean-basemap-label');
        if (toggleLabel) {
            var names = { rltm: '기본맵', enc: '전자해도', coast: '해안도', osm: '세계지도', vworld: '위성지도' };
            toggleLabel.textContent = names[type] || '지도';
        }

        // 기본맵·전자해도로 전환 시 오버레이(파티클+범례+슬라이더) 자동 OFF
        // coast(해안도)로 전환할 때만 오버레이 상태를 유지합니다.
        if (type !== 'coast' && window.oceanOverlayTurnOff) {
            window.oceanOverlayTurnOff();
        }
    }

    /** 오버레이 버튼 클릭 시 배경지도를 해안도로 자동 전환 */
    window.switchToCoastBasemap = function () {
        if (currentBase !== 'coast') {
            switchBaseLayer('coast');
        }
    };

    /**
     * [외부 API] 베이스맵 종류 조회 / 설정.
     * ocean_warn_active.js 가 ON 진입 시 이전 베이스맵을 기억했다가 OFF 시 복귀하기 위함.
     */
    window.oceanGetBasemap = function () { return currentBase; };
    window.oceanSetBasemap = function (type) { switchBaseLayer(type); };

    /**
     * [외부 API] 해아름 WMS 배경지도 레이어 1장을 만들어 준다.
     * 해양안전생활 화면(life_safety.js)이 해양생활 활동 지도에도 같은 배경지도
     * (기본맵/전자해도/해안도)를 끼워 넣기 위해 사용한다. WMS 프록시·투영·출처표기
     * 설정을 여기 한 곳에서만 관리하려고 export 한다.
     */
    window.oceanCreateKhoaLayer = function (layer) { return createKhoaLayer(layer); };

    /**
     * [외부 API] 브이월드 위성지도 레이어 1장을 만들어 준다.
     * 해양안전생활 화면(life_safety.js)이 해양생활 활동 지도에도 같은 위성지도를
     * 끼워 넣기 위해 사용한다. 주소·투영·줌 한계·고화질 격자·출처표기 설정을
     * 여기 한 곳에서만 관리하려고 export 한다.
     * @property {number} maxZoom - 브이월드가 타일을 주는 최대 줌(19). 부르는 쪽이
     *                              지도 줌 한계를 올릴 때 쓰라고 같이 달아 둔다.
     */
    window.oceanCreateVworldLayer = function (layer) { return createVworldLayer(layer); };
    window.oceanCreateVworldLayer.maxZoom = VWORLD_MAX_ZOOM;

    function bindBasemapPicker() {
        var toggleBtn = document.getElementById('ocean-basemap-toggle');
        var menu      = document.getElementById('ocean-basemap-menu');
        if (!toggleBtn || !menu) return;

        // 토글 버튼: 메뉴 열고 닫기
        toggleBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            menu.style.display = menu.style.display === 'none' ? '' : 'none';
        });

        // 메뉴 아이템 클릭: 레이어 전환 + 메뉴 닫기
        document.querySelectorAll('.ocean-basemap-item').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var bm = this.dataset.basemap;
                // [사용량] 사용자가 직접 배경레이어 버튼을 누른 경우에만 카운트.
                //   ★자동 전환(switchToCoastBasemap)은 switchBaseLayer 를 직접 호출하므로
                //     여기(사용자 클릭 핸들러)에만 trackUsage 를 두어 카운트에서 제외됨★
                if (bm && window.trackUsage) window.trackUsage('ocean.basemap.' + bm);
                switchBaseLayer(bm);
                menu.style.display = 'none';
            });
        });

        // 지도 클릭 시 메뉴 닫기
        oceanMap.on('click', function () {
            menu.style.display = 'none';
        });
    }

    // ========================================================================
    // 주요지명 마커 토글
    // ========================================================================

    function bindMarkerToggle() {
        var btn = document.getElementById('ocean-marker-toggle-btn');
        if (!btn) return;

        // localStorage에서 이전 상태 복원 (기본값: 숨김)
        var markersVisible = localStorage.getItem('seagnal_markers_visible') === 'true';
        btn.classList.toggle('active', markersVisible);
        if (window.showOceanMarkers) window.showOceanMarkers(markersVisible);

        btn.addEventListener('click', function () {
            markersVisible = !markersVisible;
            btn.classList.toggle('active', markersVisible);
            if (window.showOceanMarkers) window.showOceanMarkers(markersVisible);
            try { localStorage.setItem('seagnal_markers_visible', markersVisible); } catch (e) {}
        });
    }

    // ========================================================================
    // 지도 클릭 처리
    // ========================================================================

    // [공통 클릭 핀] 배경지도를 누른 위치에 핀 1개를 표시한다(다른 곳 누르면 이동).
    //   해양종합정보 공통 — 물빠짐/바텀시트 등과 무관하게 "내가 누른 지점" 표시용.
    let _clickPinOverlay = null;
    window.oceanDropClickPin = function (map, coordinate) {
        if (!map || !coordinate || typeof ol === 'undefined') return;
        if (!_clickPinOverlay) {
            const el = document.createElement('div');
            el.className = 'ocean-click-pin';
            el.innerHTML = '<i class="fa-solid fa-location-dot"></i>';
            _clickPinOverlay = new ol.Overlay({
                element: el, positioning: 'bottom-center', offset: [0, 1], stopEvent: false
            });
            map.addOverlay(_clickPinOverlay);
        }
        _clickPinOverlay.setPosition(coordinate);
    };
    // 핀 제거(위치 해제) — 물빠짐 종료 등에서 호출.
    window.oceanClearClickPin = function () {
        if (_clickPinOverlay) _clickPinOverlay.setPosition(undefined);
    };

    function handleMapClick(evt) {
        const coord = ol.proj.toLonLat(evt.coordinate);
        const lon = coord[0];
        const lat = coord[1];

        // 태풍 말풍선/팝업 위 클릭은 지도(바텀시트) 처리에서 제외 — 말풍선 자체 핸들러가 처리.
        //   (말풍선 오버레이는 stopEvent:false 라 지도 드래그/줌은 통과하되, 클릭은 여기서 무시)
        const _oe = evt.originalEvent;
        if (_oe && _oe.target && _oe.target.closest && _oe.target.closest('.tphn-bubble, #tphn-guide-modal')) return;

        // CCTV 마커 클릭 우선 처리 (INDEX2 전용, ocean_cctv.js 에서 정의)
        // [목적] CCTV 마커를 눌렀을 때 뒤의 빈 해역 클릭이 동시에 감지되어
        //        영상 팝업과 바텀시트가 함께 뜨는 문제를 방지.
        // [안전] window.oceanCctv 는 index2 전용 ocean_cctv.js 가 만든 객체.
        //        INDEX1 에서는 존재하지 않아 이 블록이 통째로 스킵됨 → 무영향.
        if (window.oceanCctv && typeof window.oceanCctv.tryHandleMapClick === 'function') {
            const hit = window.oceanCctv.tryHandleMapClick(oceanMap, evt);
            if (hit) return;
        }

        // 위치 즐겨찾기(★) 마커 클릭 우선 처리 (INDEX2 전용)
        // [목적] 별 마커를 정확히 탭한 경우 그 즐겨찾기 좌표로 바텀시트 즉시 오픈.
        //        500m 반경 매칭 의존 없이 feature 의 정확한 lat/lon 사용 (b 방식).
        // [안전] CCTV 가드와 동일하게 window.oceanCctv 존재 여부 체크 → index1 무영향.
        if (window.oceanCctv && typeof window.oceanCctv.tryHandleFavLocClick === 'function') {
            const hit = window.oceanCctv.tryHandleFavLocClick(oceanMap, evt);
            if (hit) return;
        }

        // 부이/클러스터 클릭 확인 (INDEX2 전용, ocean_buoy.js에서 정의)
        // INDEX1에서는 함수가 없으므로 이 블록 자체가 실행되지 않음
        if (window.handleOceanBuoyClick) {
            const hit = window.handleOceanBuoyClick(oceanMap, evt);
            if (hit) return;
        }

        // 마커 클릭 확인
        if (window.handleOceanMarkerClick) {
            const hit = window.handleOceanMarkerClick(oceanMap, evt);
            if (hit) return; // 마커 클릭이면 마커 핸들러에서 처리
        }

        // 위험물(간출암·노출암) 마커 클릭 확인 (해양안전 전용, 레이어 꺼져 있으면 항상 false)
        // [연계] js/marine-life/safety/hazard_rocks.js
        if (typeof window._hazardRocksTryHandleClick === 'function') {
            const hit = window._hazardRocksTryHandleClick(oceanMap, evt);
            if (hit) return;
        }

        // 출입통제구역 폴리곤 클릭 확인 (해양안전 전용, 토글 꺼져 있으면 항상 false)
        // [연계] js/marine-life/safety/access_control.js
        if (typeof window._accessControlTryHandleClick === 'function') {
            const hit = window._accessControlTryHandleClick(oceanMap, evt);
            if (hit) return;
        }

        // 낚시금지구역 폴리곤 클릭 확인 (해양안전 전용, 토글 꺼져 있으면 항상 false)
        // [연계] js/marine-life/safety/fishing_ban.js
        if (typeof window._fishingBanTryHandleClick === 'function') {
            const hit = window._fishingBanTryHandleClick(oceanMap, evt);
            if (hit) return;
        }

        // 선박교통관제(VTS)구역 폴리곤 클릭 확인 (해양안전 전용, 토글 꺼져 있으면 항상 false)
        // [연계] js/marine-life/safety/vts_zone.js
        if (typeof window._vtsZoneTryHandleClick === 'function') {
            const hit = window._vtsZoneTryHandleClick(oceanMap, evt);
            if (hit) return;
        }

        // 항로 폴리곤 클릭 확인 (해양안전 전용, 토글 꺼져 있으면 항상 false)
        // [연계] js/marine-life/safety/seaway.js
        if (typeof window._seawayTryHandleClick === 'function') {
            const hit = window._seawayTryHandleClick(oceanMap, evt);
            if (hit) return;
        }

        // 항행경보 구역(원형/다각형) 클릭 확인 (해양안전 전용, 토글 꺼져 있으면 항상 false)
        // [연계] js/marine-life/safety/navigational_warning.js
        if (typeof window._navwarnTryHandleClick === 'function') {
            const hit = window._navwarnTryHandleClick(oceanMap, evt);
            if (hit) return;
        }

        // 사고정보 마커/격자 클릭 확인 (해양안전 전용, 소스 선택 전이면 항상 false)
        // [연계] js/marine-life/safety/accident_info.js
        if (typeof window._accidentInfoTryHandleClick === 'function') {
            const hit = window._accidentInfoTryHandleClick(oceanMap, evt);
            if (hit) return;
        }

        // [공통 핀] 배경(해역) 클릭 시 클릭 지점에 핀 1개 표시(다음 클릭 시 이동).
        //   마커/CCTV/부이 클릭은 위에서 return 되므로 그 위엔 안 찍힘.
        if (typeof window.oceanDropClickPin === 'function') window.oceanDropClickPin(oceanMap, evt.coordinate);

        // [T5 — 가드 순서 변경] 천기(KMA 단기예보) 레이어 활성 시 가장 우선.
        // [정책] 사용자 요구 — "해구도/특보가 같이 켜져있어도 천기가 1순위".
        //        해구도 가드 위로 옮겨져 천기가 활성이면 빈 영역 클릭은 천기 박스로 소비.
        //        CCTV/부이/마커는 우리 위에 있어 그 아이콘 클릭 시 정상 동작 (사용자 명세).
        // [구현] js/shrt_forecast_layer.js 가 window._shrtForecastTryHandleClick 노출.
        //        활성 + KMA extent 내부 + frame 있음 → 박스 띄우고 true 반환 (클릭 소비).
        //        그 외엔 false 반환 → 다음 가드 (해구도 / 특보 / 바텀시트) 진행.
        if (typeof window._shrtForecastTryHandleClick === 'function') {
            if (window._shrtForecastTryHandleClick(oceanMap, evt)) return;
        }

        // [시정예측 가드] 천기 바로 다음 우선순위. 시정 레이어 활성 + extent 내부 +
        // frame 있음 → 시정(km) 팝업 박스 띄우고 true 반환 (클릭 소비).
        // 천기와 시정은 상호 배타라 둘이 동시에 활성일 수 없음 (순서는 안전상 천기 다음).
        if (typeof window._vsbyForecastTryHandleClick === 'function') {
            if (window._vsbyForecastTryHandleClick(oceanMap, evt)) return;
        }

        // [물빠짐 가드] 물빠짐 활성 시 클릭 소비 → 바텀시트 억제, 물빠짐 팝업만 표출.
        if (typeof window._tideFieldTryHandleClick === 'function') {
            if (window._tideFieldTryHandleClick(oceanMap, evt)) return;
        }

        // 해구도 격자 클릭 (해구도 토글 ON 일 때만)
        // [목적] 격자 셀을 두 번 누르면 기존 "해구별 기상" 모달을 띄움.
        //        2-step (선택 → 모달) 흐름은 seaZones.js 의 이미지 지도와 동일.
        // [충돌 방지] hit 이면 true 반환 → 아래 바텀시트 로직이 추가로 뜨는 것을 막음.
        if (tryHandleMarineZoneClick(evt)) return;

        // 태풍 ON + 육지 클릭 → 바텀시트 대신 강풍반경 도달(상륙)시간 팝업.
        if (window.OceanTyphoon && typeof window.OceanTyphoon.tryHandleLandClick === 'function') {
            if (window.OceanTyphoon.tryHandleLandClick(lon, lat)) return;
        }

        // 활성 특보 색칠 모드(특보 ON 토글) — 부모 특보구역 클릭 시 특보 박스 표출.
        // [충돌 방지] hit 이면 true 반환 → 바텀시트 표출 스킵.
        // [정책] 활성/다가오는 특보가 있는 부모 zone 폴리곤만 hit. 자식 폴리곤을
        //        클릭한 경우라도 부모 특보 정보를 표출 (자식 단위 정보는 표출 안 함).
        if (window.OceanWarnActive && typeof window.OceanWarnActive.tryHandleClick === 'function') {
            if (window.OceanWarnActive.tryHandleClick(oceanMap, evt)) return;
        }

        // [시트 열림 가드 — 사용자 합의 Q3]
        // 시트가 이미 열려 있으면 새 해점 클릭 무시 (조용히, 토스트 X).
        // showOceanBottomSheet 진입에도 동일 가드 있음 — 여기서는 빠른 early-return.
        const _sheetEl = document.getElementById('ocean-bottom-sheet');
        if (_sheetEl && _sheetEl.style.display !== 'none' &&
            _sheetEl.classList.contains('open')) {
            return;
        }

        // 오버레이 데이터가 있는 영역만 바텀시트 표시
        if (window.showOceanBottomSheet) {
            if (window.hasOceanGridData && !window.hasOceanGridData(lat, lon)) return;
            window.showOceanBottomSheet(lat, lon);
        }
    }

    // ========================================================================
    // 위치 검색
    // ========================================================================

    function initOceanSearch() {
        const input = document.getElementById('ocean-search-input');
        const clearBtn = document.getElementById('ocean-search-clear');
        if (!input) return;

        let searchTimer = null;

        input.addEventListener('input', function () {
            clearBtn.style.display = this.value ? '' : 'none';
            clearTimeout(searchTimer);
            if (this.value.trim().length >= 2) {
                searchTimer = setTimeout(() => searchLocation(this.value.trim()), 300);
            } else {
                closeSearchDropdown();
            }
        });

        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                input.value = '';
                clearBtn.style.display = 'none';
                closeSearchDropdown();
                input.focus();
            });
        }

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (this.value.trim().length >= 2) {
                    searchLocation(this.value.trim());
                }
            }
        });
    }

    /**
     * 위치 검색 (서버 프록시 방식)
     *
     * [역할]
     * 사용자가 검색창에 입력한 키워드(예: "제주항")로 장소를 찾아
     * 드롭다운에 결과를 보여줍니다. 결과를 클릭하면 지도가 그 좌표로 이동합니다.
     *
     * [왜 서버 프록시?]
     * - 조석정보 탭(tide.js)과 동일하게 우리 서버의 /api/search-place 를 통해 검색합니다.
     * - 브라우저가 직접 Kakao 자바스크립트 SDK 를 부르지 않으므로
     *   1) Kakao Maps SDK 스크립트를 페이지에 로드할 필요가 없고
     *   2) 도메인 인증/배포환경 변경 이슈가 없으며
     *   3) tide.js 검색에서 이미 검증된 동일 응답 포맷을 그대로 사용합니다.
     *
     * [연계]
     * - 서버: routes/tide.js 의 /api/search-place (Kakao REST API 프록시)
     * - 호출처: 본 파일 위쪽 input 'input'/'keydown' 이벤트 핸들러
     * - 결과 표시: showSearchResults() 가 드롭다운 DOM 을 렌더링
     * - 항목 클릭: 같은 함수 안에서 oceanMap.getView().animate() 로 이동
     */
    function searchLocation(query) {
        // 1) 검색 시작 안내 (사용자가 무언가 진행 중임을 인지)
        showSearchResults([{ name: '검색 중...', disabled: true }]);

        // 2) 서버 프록시 호출 — Kakao REST API 응답을 그대로 패스스루
        fetch('/api/search-place?q=' + encodeURIComponent(query))
            .then(function (res) {
                return res.json().then(function (data) {
                    return { ok: res.ok, data: data };
                });
            })
            .then(function (resp) {
                // 3-a) 서버 오류 (예: API 키 미설정)
                if (!resp.ok) {
                    showSearchResults([{
                        name: (resp.data && resp.data.error) || '검색 서비스를 사용할 수 없습니다',
                        disabled: true
                    }]);
                    return;
                }

                var docs = resp.data && resp.data.documents;
                // 3-b) 결과 없음
                if (!docs || docs.length === 0) {
                    showSearchResults([{ name: '검색 결과가 없습니다', disabled: true }]);
                    return;
                }

                // 3-c) 정상 결과 → 기존 showSearchResults 가 기대하는 포맷으로 매핑
                //   - place_name  → name   (드롭다운 굵은 글씨)
                //   - address_name → address (드롭다운 보조 텍스트)
                //   - x(경도) / y(위도) → lon / lat (지도 이동에 사용)
                var results = docs.slice(0, 5).map(function (item) {
                    return {
                        name: item.place_name,
                        address: item.address_name,
                        lat: parseFloat(item.y),
                        lon: parseFloat(item.x)
                    };
                });
                showSearchResults(results);
            })
            .catch(function (err) {
                // 4) 네트워크 오류 등
                console.error('[OceanMap] 검색 오류:', err && err.message);
                showSearchResults([{ name: '검색 중 오류가 발생했습니다', disabled: true }]);
            });
    }

    function showSearchResults(results) {
        const dropdown = document.getElementById('ocean-search-dropdown');
        if (!dropdown) return;

        dropdown.innerHTML = results.map(r => {
            if (r.disabled) {
                return `<div class="ocean-search-item disabled">${r.name}</div>`;
            }
            return `<div class="ocean-search-item" data-lat="${r.lat}" data-lon="${r.lon}">
                <strong>${r.name}</strong>
                <span>${r.address || ''}</span>
            </div>`;
        }).join('');

        dropdown.style.display = 'block';

        dropdown.querySelectorAll('.ocean-search-item:not(.disabled)').forEach(item => {
            item.addEventListener('click', function () {
                const lat = parseFloat(this.dataset.lat);
                const lon = parseFloat(this.dataset.lon);
                var name = this.querySelector('strong').textContent;
                if (oceanMap) {
                    oceanMap.getView().animate({
                        center: ol.proj.fromLonLat([lon, lat]),
                        zoom: 12,
                        duration: 800
                    });
                    addOrUpdateSearchMarker(lat, lon, name);
                }
                closeSearchDropdown();
                document.getElementById('ocean-search-input').value = name;
            });
        });
    }

    /**
     * 검색 결과 위치에 마커 + 라벨을 표시한다.
     *
     * [역할]
     *  사용자가 위치 검색 드롭다운에서 항목을 클릭했을 때, 지도 이동 직후
     *  그 좌표 위에 빨간 점(중심 6px) + 흰 원(10px) + 반투명 외곽 원(14px)
     *  3겹 마커를 그리고, 위쪽에 장소 이름 라벨(빨간 배경)을 함께 표시한다.
     *  조석정보 탭(tide.js) 의 검색 결과 마커와 동일한 시각/패턴이다.
     *
     * [동작 방식]
     *  - 첫 호출 시: ol.layer.Vector + ol.source.Vector 를 1회 생성하고
     *    style 함수에서 3겹 Circle + Text 를 반환하도록 정의한 뒤
     *    oceanMap 에 addLayer 한다.
     *  - 이후 호출 시: 기존 source.clear() 로 이전 마커를 지우고 새 Feature
     *    1개를 추가한다 → 항상 마커 1개만 유지된다.
     *
     * [연계]
     *  - 호출처: showSearchResults 의 항목 클릭 핸들러
     *  - 모델: tide.js 657-707 의 searchResultLayer 패턴
     *
     * @param {number} lat   위도
     * @param {number} lon   경도
     * @param {string} name  마커 위에 표시할 장소 이름
     */
    function addOrUpdateSearchMarker(lat, lon, name) {
        if (!oceanMap) return;
        var coord = ol.proj.fromLonLat([lon, lat]);

        if (!searchResultLayer) {
            searchResultLayer = new ol.layer.Vector({
                source: new ol.source.Vector(),
                zIndex: 900,
                style: function (feature) {
                    var label = feature.get('name') || '';
                    return [
                        new ol.style.Style({
                            image: new ol.style.Circle({
                                radius: 14,
                                fill: new ol.style.Fill({ color: 'rgba(255, 80, 80, 0.15)' })
                            })
                        }),
                        new ol.style.Style({
                            image: new ol.style.Circle({
                                radius: 10,
                                fill: new ol.style.Fill({ color: '#ffffff' }),
                                stroke: new ol.style.Stroke({ color: 'rgba(0,0,0,0.08)', width: 1 })
                            })
                        }),
                        new ol.style.Style({
                            image: new ol.style.Circle({
                                radius: 6,
                                fill: new ol.style.Fill({ color: '#ff4444' })
                            }),
                            text: new ol.style.Text({
                                text: label,
                                offsetY: -22,
                                font: 'bold 12px sans-serif',
                                fill: new ol.style.Fill({ color: '#ffffff' }),
                                backgroundFill: new ol.style.Fill({ color: 'rgba(255,68,68,0.85)' }),
                                padding: [2, 6, 2, 6],
                                backgroundStroke: new ol.style.Stroke({ color: 'rgba(255,68,68,0.9)', width: 1 })
                            })
                        })
                    ];
                }
            });
            oceanMap.addLayer(searchResultLayer);
        }

        var source = searchResultLayer.getSource();
        source.clear();
        var feature = new ol.Feature({ geometry: new ol.geom.Point(coord) });
        feature.set('name', name);
        source.addFeature(feature);
    }

    function closeSearchDropdown() {
        const dropdown = document.getElementById('ocean-search-dropdown');
        if (dropdown) dropdown.style.display = 'none';
    }

    // ========================================================================
    // 내 위치 마커 + GPS 이동
    // ------------------------------------------------------------------------
    // [역할]
    //  - 사용자가 GPS 버튼(.ocean-myloc-btn)을 누르면 현재 좌표로 지도를
    //    이동하고, 그 지점 위에 "내 위치" 마커를 표시한다.
    //  - 마커 스타일은 index1 해구기상(seaZones.js updateSeaZoneMyLocationMarker)
    //    과 동일한 다층 원형(외곽 글로우 2겹 + 펄스 + 흰 테두리 + 파란 중심 + 라벨)
    //    로 통일한다. 펄스 애니메이션은 style.css:4893 의 seaZoneLocationPulse
    //    키프레임과 .sea-zone-my-location-pulse 클래스를 그대로 재사용한다.
    //
    // [구현 포인트]
    //  - OpenLayers 지도에는 ol.Overlay 로 HTML 요소를 "지리 좌표"에 고정한다.
    //  - Overlay 는 지도 이동/줌에 따라 자동으로 위치가 갱신되므로
    //    별도의 수동 업데이트 로직은 불필요하다.
    //  - 마커 요소는 최초 1회만 생성해 두고, 이후엔 position 만 갱신한다.
    // ========================================================================

    // 내 위치 Overlay 인스턴스 (최초 1회 생성 후 재사용)
    var _myLocOverlay = null;

    /**
     * "내 위치" 마커 DOM 을 만든다 (해구기상과 동일 스타일)
     * @returns {HTMLElement}
     */
    function _createMyLocationElement() {
        var wrap = document.createElement('div');
        // pointer-events:none → 지도 클릭/드래그를 방해하지 않도록 함
        wrap.style.cssText = 'position:relative; width:30px; height:30px; pointer-events:none;';
        wrap.innerHTML = ''
            // 1) 외곽 은은한 글로우 (가장 큰 원, 투명도 낮음)
            + '<div style="position:absolute; top:0; left:0; width:100%; height:100%;'
            +   ' background:rgba(0,123,255,0.12); border-radius:50%;"></div>'
            // 2) 중간 글로우
            + '<div style="position:absolute; top:10%; left:10%; width:80%; height:80%;'
            +   ' background:rgba(0,123,255,0.22); border-radius:50%;"></div>'
            // 3) 펄스 애니메이션 (style.css .sea-zone-my-location-pulse 재사용)
            + '<div class="sea-zone-my-location-pulse" style="position:absolute;'
            +   ' top:0; left:0; width:100%; height:100%;'
            +   ' background:rgba(0,123,255,0.2); border-radius:50%;"></div>'
            // 4) 흰색 테두리 원
            + '<div style="position:absolute; top:20%; left:20%; width:60%; height:60%;'
            +   ' background:#ffffff; border-radius:50%;'
            +   ' box-shadow:0 1px 3px rgba(0,0,0,0.2);"></div>'
            // 5) 중심 파란색 점
            + '<div style="position:absolute; top:30%; left:30%; width:40%; height:40%;'
            +   ' background:#007bff; border-radius:50%;"></div>'
            // 6) "내 위치" 라벨 (상단에 말풍선처럼)
            + '<div style="position:absolute; top:-26px; left:50%;'
            +   ' transform:translateX(-50%); background:rgba(10,25,41,0.85);'
            +   ' color:#fff; padding:3px 8px; border-radius:5px; font-size:11px;'
            +   ' white-space:nowrap; font-weight:600;'
            +   ' border:1px solid rgba(255,255,255,0.2);'
            +   ' box-shadow:0 2px 8px rgba(0,0,0,0.4);">내 위치</div>';
        return wrap;
    }

    /**
     * 주어진 경/위도에 "내 위치" 마커를 표시/갱신한다.
     * @param {number} lon - 경도
     * @param {number} lat - 위도
     */
    function _showMyLocationMarker(lon, lat) {
        if (!oceanMap) return;
        var coord = ol.proj.fromLonLat([lon, lat]);

        // 최초 1회만 Overlay 생성, 이후엔 위치만 갱신
        if (!_myLocOverlay) {
            _myLocOverlay = new ol.Overlay({
                element: _createMyLocationElement(),
                positioning: 'center-center',   // 좌표를 요소 중앙에 맞춤
                stopEvent: false,               // 지도 드래그/줌 이벤트 통과
                insertFirst: false              // 다른 Overlay 위에 올림
            });
            oceanMap.addOverlay(_myLocOverlay);
        }
        _myLocOverlay.setPosition(coord);
    }

    /**
     * GPS 버튼 클릭 시 호출: 현재 위치로 지도 이동 + "내 위치" 마커 표시
     *
     * [연계]
     *  - index2.html #ocean-myloc-btn 의 click 이벤트에서 호출
     *  - Capacitor 네이티브 권한은 사용자의 geolocation API 가 직접 관리
     */
    function goToMyLocation() {
        if (!navigator.geolocation) return;

        navigator.geolocation.getCurrentPosition(
            function (pos) {
                var lon = pos.coords.longitude;
                var lat = pos.coords.latitude;

                if (oceanMap) {
                    // 지도 이동 (애니메이션)
                    oceanMap.getView().animate({
                        center: ol.proj.fromLonLat([lon, lat]),
                        zoom: 12,
                        duration: 800
                    });
                    // "내 위치" 마커 표시 (해구기상과 동일 스타일)
                    _showMyLocationMarker(lon, lat);
                }
            },
            function () {
                console.warn('[OceanMap] 위치 정보를 가져올 수 없습니다.');
            },
            { enableHighAccuracy: true, timeout: 5000 }
        );
    }

    // ========================================================================
    // 외부 인터페이스
    // ========================================================================

    window.getOceanMap = function () { return oceanMap; };

    /**
     * [기본 뷰 복귀] 해양종합정보 탭을 처음 열었을 때와 동일하게 대한민국 전도(한반도 중앙)가
     *   화면 중앙에 오도록 지도 중심/줌을 기본값(DEFAULT_CENTER / DEFAULT_ZOOM)으로 되돌린다.
     *   태풍 시연을 끌 때(테스트/데모 경로) ocean_typhoon.js 가 호출.
     * @param {boolean} [animate=true] true(기본) 면 부드럽게 이동, false 면 즉시 이동.
     */
    window.oceanResetDefaultView = function (animate) {
        try {
            if (!oceanMap) return;
            const view = oceanMap.getView();
            const center = ol.proj.fromLonLat(DEFAULT_CENTER);
            if (animate === false) {
                view.setCenter(center);
                view.setZoom(DEFAULT_ZOOM);
            } else {
                view.animate({ center: center, zoom: DEFAULT_ZOOM, duration: 500 });
            }
        } catch (e) { /* noop */ }
    };

})();
