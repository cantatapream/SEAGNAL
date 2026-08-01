/**
 * ============================================================================
 * 파일명: client/js/marine-life/safety/hazard_rocks.js
 * 역할  : 해양안전 지도에 "노출암" / "간출암 등" 두 토글 버튼을 얹는다. 항상
 *         드러난 바위(노출암)와 저조 시 드러나는 바위(간출암/세암/암암)를 각각
 *         독립적으로 켤 수 있고(동시에 켜도 됨), 탭하면 종류(+수치)를 말풍선으로
 *         보여준다. 포인트가 많은 지역은 줌 레벨에 따라 숫자로 뭉쳐 표시하다가
 *         확대할수록 낱개로 펼쳐진다(OpenLayers 클러스터).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : 없음 (OpenLayers 만 사용, 해아름 레이어와 독립)
 *  - 서버 API      : 없음 — /hazard_rocks.json 정적 파일을 직접 fetch(지연 로드)
 *  - 마크업        : index2.html 의 #ocean-exposed-toggle-btn(노출암),
 *                    #ocean-rock-toggle-btn(간출암 등) — 둘 다 해양안전 전용
 *  - 나를 쓰는 곳  : ocean_map.js buildMap() → window.initHazardRocksLayer(oceanMap)
 *                    ocean_map.js handleMapClick → window._hazardRocksTryHandleClick
 * [로드 순서] ocean_map.js 다음 · life_safety.js 바로 앞 (marine-life/safety 그룹)
 * [데이터 출처] 국립해양조사원 개방海 전자해도 TL_UWTROC_P_LV5(간출암·세암·암암)·
 *              TL_LNDARE_P_LV5(노출암), local_server/scripts/build_hazard_rocks.js 로 생성.
 *              수치(v)는 해도 기준면(약최저저조면) 위 노출 높이(m) — 우리 조위
 *              데이터(TideBED/조석표)와 같은 기준면이라 향후 "지금 잠기는지" 경고
 *              기능에서 보정 없이 바로 비교 가능(services/tide_field_common.js 참고).
 *
 * [성능 설계 — 지연 로드 + 클러스터]
 *  - 데이터(~700KB, gzip 전송 시 수십KB)는 두 버튼 중 하나를 처음 누를 때만
 *    받는다. 해양안전에 아예 안 들어오거나 버튼을 안 누르는 사용자는 요청 자체가
 *    없다. 두 버튼이 같은 파일을 나눠 쓰므로 fetch 는 세션당 최대 1번.
 *  - 화면에 그리는 점 개수를 줄이려고 ol.source.Cluster 로 감싼다. 화면 픽셀
 *    거리(CLUSTER_DISTANCE) 안의 점들을 하나의 숫자 원으로 뭉치고, 확대할수록
 *    같은 픽셀거리가 가리키는 실제 면적이 좁아지므로 자연히 잘게 쪼개진다.
 *    다만 아주 가까운 바위 몇 개는 최대 줌에서도 여전히 뭉칠 수 있어, 줌이
 *    SPREAD_ZOOM 이상이 되면 뭉치기 거리를 0으로 낮춰 무조건 낱개로 펼친다.
 *  - 뭉친 숫자 원을 탭하면 그 안의 점들이 다 보이도록 지도를 확대한다.
 *    낱개로 펼쳐지면 종류별 아이콘(노출암/간출암/세암·암암, 물그릇에 담긴 바위
 *    모양·같은 캔버스 크기)으로 보이고, 그 마커를 탭하면 종류·수치 말풍선을 띄운다.
 * ============================================================================
 */

(function () {
    'use strict';

    var DATA_URL = '/hazard_rocks.json';
    var CLUSTER_DISTANCE = 45;   // px — 이 거리 안의 점들을 한 원으로 뭉친다
    var SPREAD_ZOOM = 14;        // 이 줌 이상에서는 뭉치지 않고 낱개 마커로 고정 표시

    var dataPromise = null;    // 두 버튼이 나눠 쓰는 공유 fetch(1회만 요청)
    var exposedLayer = null;   // 노출암(k=0)
    var rockLayer = null;      // 간출암류(k=1,2,3)
    var bubbleOverlay = null;  // 탭한 지점에 뜨는 말풍선

    var CLUSTER_COLOR = { exposed: '#8d6e63', rock: '#ff7043' }; // 뭉친 숫자 원 색(노출암 갈색/간출암류 주황)

    // ── 낱개 마커 아이콘(바위 종류별) ──────────────────────────────────────
    // "물그릇에 담긴 바위" 모양의 SVG. 셋 다 같은 40x40 캔버스·같은 그릇
    // 테두리를 써서 크기가 똑같이 나온다. 다른 건 바위 높이·수면 위치뿐:
    //   submerged(세암·암암) — 바위가 물 전체에 잠김
    //   exposed(노출암)      — 바위 봉우리가 물 위로 높이 드러남
    //   tidal(간출암)        — 봉우리 끝만 수면에 살짝 걸침(물결 표시)
    var ICON_SUBMERGED = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MCA0MCIgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIj4KICA8ZGVmcz48Y2xpcFBhdGggaWQ9ImJvd2wtc3VibWVyZ2VkIj48cGF0aCBkPSJNNCwxMyBDNCw3IDM2LDcgMzYsMTMgTDM2LDIzIEMzNiwzMyAyOSwzOCAyMCwzOCBDMTEsMzggNCwzMyA0LDIzIFoiLz48L2NsaXBQYXRoPjwvZGVmcz4KICA8cGF0aCBkPSJNNCwxMyBDNCw3IDM2LDcgMzYsMTMgTDM2LDIzIEMzNiwzMyAyOSwzOCAyMCwzOCBDMTEsMzggNCwzMyA0LDIzIFoiIGZpbGw9InJnYmEoMTUwLDE4MCwyMDAsMC4yOCkiLz4KICA8ZyBjbGlwLXBhdGg9InVybCgjYm93bC1zdWJtZXJnZWQpIj4KICAgIDxnIHRyYW5zZm9ybT0idHJhbnNsYXRlKDIwLDM2KSBzY2FsZSgxLDAuODUpIHRyYW5zbGF0ZSgtMjAsLTM2KSI+CiAgICAgIDxwb2x5Z29uIHBvaW50cz0iMTQsMzYgMTIsMjkgMTUsMjIgMTgsMTIgMjAsOCAyMiwxMiAyNSwyMCAyMywyNSAyOCwyMSAzMCwyOCAyNywzNiIgZmlsbD0iIzZiNzI4MCIgc3Ryb2tlPSIjNGI1NTYzIiBzdHJva2Utd2lkdGg9IjAuNiIvPgogICAgPC9nPgogICAgPHJlY3QgeD0iMCIgeT0iMTAiIHdpZHRoPSI0MCIgaGVpZ2h0PSIzMCIgZmlsbD0icmdiYSg3NCwxNDQsMTgwLDAuNTUpIi8+CiAgPC9nPgogIAogIDxwYXRoIGQ9Ik00LDEzIEM0LDcgMzYsNyAzNiwxMyBMMzYsMjMgQzM2LDMzIDI5LDM4IDIwLDM4IEMxMSwzOCA0LDMzIDQsMjMgWiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMmIzYTRhIiBzdHJva2Utd2lkdGg9IjEuNiIvPgo8L3N2Zz4=';
    var ICON_EXPOSED = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MCA0MCIgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIj4KICA8ZGVmcz48Y2xpcFBhdGggaWQ9ImJvd2wtZXhwb3NlZCI+PHBhdGggZD0iTTQsMTMgQzQsNyAzNiw3IDM2LDEzIEwzNiwyMyBDMzYsMzMgMjksMzggMjAsMzggQzExLDM4IDQsMzMgNCwyMyBaIi8+PC9jbGlwUGF0aD48L2RlZnM+CiAgPHBhdGggZD0iTTQsMTMgQzQsNyAzNiw3IDM2LDEzIEwzNiwyMyBDMzYsMzMgMjksMzggMjAsMzggQzExLDM4IDQsMzMgNCwyMyBaIiBmaWxsPSJyZ2JhKDE1MCwxODAsMjAwLDAuMjgpIi8+CiAgPGcgY2xpcC1wYXRoPSJ1cmwoI2Jvd2wtZXhwb3NlZCkiPgogICAgPGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMjAsMzYpIHNjYWxlKDEsMS4wKSB0cmFuc2xhdGUoLTIwLC0zNikiPgogICAgICA8cG9seWdvbiBwb2ludHM9IjE0LDM2IDEyLDI5IDE1LDIyIDE4LDEyIDIwLDggMjIsMTIgMjUsMjAgMjMsMjUgMjgsMjEgMzAsMjggMjcsMzYiIGZpbGw9IiM2YjcyODAiIHN0cm9rZT0iIzRiNTU2MyIgc3Ryb2tlLXdpZHRoPSIwLjYiLz4KICAgIDwvZz4KICAgIDxyZWN0IHg9IjAiIHk9IjI3IiB3aWR0aD0iNDAiIGhlaWdodD0iMTMiIGZpbGw9InJnYmEoNzQsMTQ0LDE4MCwwLjU1KSIvPgogIDwvZz4KICAKICA8cGF0aCBkPSJNNCwxMyBDNCw3IDM2LDcgMzYsMTMgTDM2LDIzIEMzNiwzMyAyOSwzOCAyMCwzOCBDMTEsMzggNCwzMyA0LDIzIFoiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzJiM2E0YSIgc3Ryb2tlLXdpZHRoPSIxLjYiLz4KPC9zdmc+';
    var ICON_TIDAL = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MCA0MCIgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIj4KICA8ZGVmcz48Y2xpcFBhdGggaWQ9ImJvd2wtdGlkYWwiPjxwYXRoIGQ9Ik00LDEzIEM0LDcgMzYsNyAzNiwxMyBMMzYsMjMgQzM2LDMzIDI5LDM4IDIwLDM4IEMxMSwzOCA0LDMzIDQsMjMgWiIvPjwvY2xpcFBhdGg+PC9kZWZzPgogIDxwYXRoIGQ9Ik00LDEzIEM0LDcgMzYsNyAzNiwxMyBMMzYsMjMgQzM2LDMzIDI5LDM4IDIwLDM4IEMxMSwzOCA0LDMzIDQsMjMgWiIgZmlsbD0icmdiYSgxNTAsMTgwLDIwMCwwLjI4KSIvPgogIDxnIGNsaXAtcGF0aD0idXJsKCNib3dsLXRpZGFsKSI+CiAgICA8ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSgyMCwzNikgc2NhbGUoMSwwLjg1KSB0cmFuc2xhdGUoLTIwLC0zNikiPgogICAgICA8cG9seWdvbiBwb2ludHM9IjE0LDM2IDEyLDI5IDE1LDIyIDE4LDEyIDIwLDggMjIsMTIgMjUsMjAgMjMsMjUgMjgsMjEgMzAsMjggMjcsMzYiIGZpbGw9IiM2YjcyODAiIHN0cm9rZT0iIzRiNTU2MyIgc3Ryb2tlLXdpZHRoPSIwLjYiLz4KICAgIDwvZz4KICAgIDxyZWN0IHg9IjAiIHk9IjEzIiB3aWR0aD0iNDAiIGhlaWdodD0iMjciIGZpbGw9InJnYmEoNzQsMTQ0LDE4MCwwLjU1KSIvPgogIDwvZz4KICA8ZWxsaXBzZSBjeD0nMjAnIGN5PScxMycgcng9JzgnIHJ5PScxLjgnIGZpbGw9J25vbmUnIHN0cm9rZT0nI2VhZjVmYicgc3Ryb2tlLXdpZHRoPScxLjInIG9wYWNpdHk9JzAuOTUnLz4KICA8cGF0aCBkPSJNNCwxMyBDNCw3IDM2LDcgMzYsMTMgTDM2LDIzIEMzNiwzMyAyOSwzOCAyMCwzOCBDMTEsMzggNCwzMyA0LDIzIFoiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzJiM2E0YSIgc3Ryb2tlLXdpZHRoPSIxLjYiLz4KPC9zdmc+';

    /** feature 의 k 값(0~3) 으로 아이콘을 고른다. 세암(2)·암암(3) 은 같은 "잠김" 아이콘. */
    function iconFor(k) {
        if (k === 0) return ICON_EXPOSED;
        if (k === 1) return ICON_TIDAL;
        return ICON_SUBMERGED; // 2, 3
    }

    var _iconStyleCache = {}; // k → ol.style.Style (매 렌더마다 새로 안 만들려고 캐시)
    function singleStyle(k) {
        if (!_iconStyleCache[k]) {
            _iconStyleCache[k] = new ol.style.Style({
                image: new ol.style.Icon({ src: iconFor(k), scale: 0.7, anchor: [0.5, 0.5] })
            });
        }
        return _iconStyleCache[k];
    }

    /**
     * /hazard_rocks.json 을 한 번만 받아 온다. 두 번째 호출부터는 같은 Promise 재사용.
     * @returns {Promise<Object>} GeoJSON FeatureCollection
     */
    function fetchData() {
        if (!dataPromise) {
            dataPromise = fetch(DATA_URL).then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            });
        }
        return dataPromise;
    }

    /**
     * feature 의 종류·수치를 말풍선에 넣을 한 줄 문구로 만든다.
     * 예: 간출암 + v=1.0 → "간출암 · 저조 시 1.0m 노출"
     *     간출암 + v 없음 → "간출암 · 노출 높이 미상"
     *     노출암 → "노출암" (사실만)
     * @param {ol.Feature} feature - 원본 포인트 feature(클러스터 멤버 1개)
     * @returns {string}
     */
    function popupText(feature) {
        var k = feature.get('k');
        var v = feature.get('v');
        if (k === 0) return '노출암';
        if (k === 2) return '세암 · 저조 시 수면과 같은 높이';
        if (k === 3) return '암암 · 항상 물속';
        // k === 1 (간출암)
        return (typeof v === 'number') ? ('간출암 · 저조 시 ' + v.toFixed(1) + 'm 노출')
                                        : '간출암 · 노출 높이 미상';
    }

    /**
     * 클러스터 레이어의 스타일 함수를 만든다. 뭉친 개수가 1개면 종류별 아이콘,
     * 여러 개면 개수를 적은 숫자 원으로 그린다.
     * @param {string} clusterColor - 뭉친 숫자 원의 색(카테고리 대표색)
     * @returns {function(ol.Feature): ol.style.Style}
     */
    function makeClusterStyle(clusterColor) {
        return function (clusterFeature) {
            var members = clusterFeature.get('features');
            if (members.length === 1) {
                return singleStyle(members[0].get('k'));
            }
            var radius = Math.min(10 + Math.sqrt(members.length) * 2, 22);
            return new ol.style.Style({
                image: new ol.style.Circle({
                    radius: radius,
                    fill: new ol.style.Fill({ color: clusterColor }),
                    stroke: new ol.style.Stroke({ color: '#fff', width: 1.5 })
                }),
                text: new ol.style.Text({
                    text: String(members.length),
                    font: 'bold 11px sans-serif',
                    fill: new ol.style.Fill({ color: '#fff' })
                })
            });
        };
    }

    /**
     * feature 배열(GeoJSON) 로 클러스터 벡터 레이어를 만든다(처음엔 숨김).
     * 지도 줌이 SPREAD_ZOOM 이상이 되면 뭉치기 거리를 0으로 낮춰 낱개 마커로
     * 고정 표시한다(반대로 줌아웃하면 다시 뭉친다).
     * @param {ol.Map} map
     * @param {Array<ol.Feature>} features
     * @param {string} clusterColor
     * @returns {ol.layer.Vector}
     */
    function buildClusterLayer(map, features, clusterColor) {
        var clusterSource = new ol.source.Cluster({
            distance: CLUSTER_DISTANCE,
            source: new ol.source.Vector({ features: features })
        });

        var applyDistanceForZoom = function () {
            var zoom = map.getView().getZoom();
            var target = (typeof zoom === 'number' && zoom >= SPREAD_ZOOM) ? 0 : CLUSTER_DISTANCE;
            if (clusterSource.getDistance() !== target) clusterSource.setDistance(target);
        };
        map.getView().on('change:resolution', applyDistanceForZoom);
        applyDistanceForZoom();

        return new ol.layer.Vector({
            source: clusterSource,
            style: makeClusterStyle(clusterColor),
            visible: false,
            zIndex: 55
        });
    }

    /**
     * 말풍선 Overlay 를 준비(1회)해 돌려준다. 이후 위치·문구만 갱신한다.
     * @param {ol.Map} map
     * @returns {ol.Overlay}
     */
    function ensureBubble(map) {
        if (bubbleOverlay) return bubbleOverlay;
        var el = document.createElement('div');
        el.className = 'hazard-rock-popup';
        bubbleOverlay = new ol.Overlay({
            element: el, positioning: 'bottom-center', offset: [0, -8], stopEvent: false
        });
        map.addOverlay(bubbleOverlay);
        return bubbleOverlay;
    }

    /**
     * 데이터를 받아 exposedLayer·rockLayer 를 만들고 지도에 얹는다(최초 1회만 실행).
     * @param {ol.Map} map
     * @returns {Promise<void>}
     */
    function ensureLayersReady(map) {
        return fetchData().then(function (geojson) {
            if (exposedLayer && rockLayer) return; // 이미 만들어짐

            var fmt = new ol.format.GeoJSON({
                dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857'
            });
            var all = fmt.readFeatures(geojson);
            var exposedFeatures = all.filter(function (f) { return f.get('k') === 0; });
            var rockFeatures = all.filter(function (f) { return f.get('k') !== 0; });

            exposedLayer = buildClusterLayer(map, exposedFeatures, CLUSTER_COLOR.exposed);
            rockLayer = buildClusterLayer(map, rockFeatures, CLUSTER_COLOR.rock);
            map.addLayer(exposedLayer);
            map.addLayer(rockLayer);

            console.log('[HazardRocks] 로드 완료 — 노출암', exposedFeatures.length, '건 · 간출암류', rockFeatures.length, '건');
        });
    }

    /**
     * 버튼 하나를 레이어 표시/숨김과 연결한다. 데이터가 아직 없으면 첫 클릭 때
     * 받아 오고(버튼에 로딩 스피너 표시), 그 다음부터는 바로 토글만 한다.
     * @param {ol.Map} map
     * @param {string} btnId
     * @param {function(): ol.layer.Vector} getLayer - 이 버튼이 다룰 레이어를 돌려주는 함수
     * @param {string} usageKey - trackUsage 에 넘길 키
     */
    function bindToggle(map, btnId, getLayer, usageKey) {
        var btn = document.getElementById(btnId);
        if (!btn) return;
        var iconEl = btn.querySelector('i');
        var originalIconClass = iconEl ? iconEl.className : '';
        var busy = false;

        btn.addEventListener('click', function () {
            if (busy) return;

            if (!exposedLayer || !rockLayer) {
                busy = true;
                if (iconEl) iconEl.className = 'fa-solid fa-spinner fa-spin';
                ensureLayersReady(map).then(function () {
                    if (iconEl) iconEl.className = originalIconClass;
                    busy = false;
                    applyToggle();
                }).catch(function (e) {
                    console.warn('[HazardRocks] 데이터 로드 실패:', e.message);
                    if (iconEl) iconEl.className = originalIconClass;
                    busy = false;
                });
                return;
            }
            applyToggle();

            function applyToggle() {
                var layer = getLayer();
                var visible = !layer.getVisible();
                layer.setVisible(visible);
                btn.classList.toggle('active', visible);
                if (visible && window.trackUsage) window.trackUsage(usageKey);
                if (!visible && bubbleOverlay) bubbleOverlay.setPosition(undefined);
            }
        });
    }

    /**
     * [외부 API] 위험물(노출암/간출암류) 토글 버튼 2개를 지도와 연결한다.
     * 레이어 자체는 버튼을 처음 누를 때 지연 생성된다(성능·트래픽 절약).
     * @param {ol.Map} map - 해양종합정보/해양안전이 함께 쓰는 OL 지도 인스턴스
     * [연계] ← ocean_map.js buildMap() (index2 전용) → 여기서 1회 호출
     */
    window.initHazardRocksLayer = function (map) {
        bindToggle(map, 'ocean-exposed-toggle-btn', function () { return exposedLayer; }, 'ocean.hazard_exposed');
        bindToggle(map, 'ocean-rock-toggle-btn', function () { return rockLayer; }, 'ocean.hazard_rock');
    };

    /**
     * 한 레이어에 대해 클릭을 처리한다. 클러스터(멤버 2개 이상)를 눌렀으면 그
     * 범위로 확대하고, 낱개 포인트를 눌렀으면 말풍선을 띄운다.
     * @param {ol.Map} map
     * @param {ol.MapBrowserEvent} evt
     * @param {ol.layer.Vector} layer
     * @returns {boolean} true 면 이 레이어에서 클릭을 소비함
     */
    function tryHandleLayerClick(map, evt, layer) {
        var hit = null;
        map.forEachFeatureAtPixel(evt.pixel, function (feature, lyr) {
            if (lyr === layer) { hit = feature; return true; }
        }, { layerFilter: function (l) { return l === layer; } });
        if (!hit) return false;

        var members = hit.get('features');
        if (members.length > 1) {
            var extent = ol.extent.createEmpty();
            members.forEach(function (f) { ol.extent.extend(extent, f.getGeometry().getExtent()); });
            map.getView().fit(extent, { padding: [60, 60, 60, 60], maxZoom: 18, duration: 300 });
            return true;
        }

        var bubble = ensureBubble(map);
        bubble.getElement().textContent = popupText(members[0]);
        bubble.setPosition(members[0].getGeometry().getCoordinates());
        return true;
    }

    /**
     * [외부 API] 지도 클릭이 노출암/간출암류 레이어를 눌렀는지 확인한다.
     * 두 레이어 모두 켜져 있을 수 있으므로 순서대로 검사한다.
     * @param {ol.Map} map
     * @param {ol.MapBrowserEvent} evt
     * @returns {boolean} true 면 클릭이 소비됨(호출자는 배경 클릭 핀 등을 건너뛰어야 함)
     * [연계] ← ocean_map.js handleMapClick — 마커/부이 클릭 다음 우선순위로 호출
     */
    window._hazardRocksTryHandleClick = function (map, evt) {
        var handled = false;
        if (rockLayer && rockLayer.getVisible()) handled = tryHandleLayerClick(map, evt, rockLayer);
        if (!handled && exposedLayer && exposedLayer.getVisible()) handled = tryHandleLayerClick(map, evt, exposedLayer);
        if (!handled && bubbleOverlay) bubbleOverlay.setPosition(undefined);
        return handled;
    };
})();
