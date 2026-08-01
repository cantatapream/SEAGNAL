/**
 * ============================================================================
 * 파일명: client/js/marine-life/safety/hazard_rocks.js
 * 역할  : 해양안전 지도에 "위험물"(간출암·노출암) 토글 레이어를 얹는다.
 *         저조 시 드러나는 바위(간출암/세암/암암)와 항상 드러난 바위(노출암)를
 *         점으로 표시하고, 탭하면 종류(+수치)를 작은 말풍선으로 보여준다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : 없음 (OpenLayers 만 사용, 해아름 레이어와 독립)
 *  - 서버 API      : 없음 — /hazard_rocks.json 정적 파일을 직접 fetch
 *  - 마크업        : index2.html 의 #ocean-hazard-toggle-btn (해양안전 전용,
 *                    해양종합정보에서는 CSS 로 숨김)
 *  - 나를 쓰는 곳  : ocean_map.js buildMap() → window.initHazardRocksLayer(oceanMap)
 *                    ocean_map.js handleMapClick → window._hazardRocksTryHandleClick
 * [로드 순서] ocean_map.js 다음 · life_safety.js 바로 앞 (marine-life/safety 그룹)
 * [데이터 출처] 국립해양조사원 개방海 전자해도 TL_UWTROC_P_LV5(간출암·세암·암암)·
 *              TL_LNDARE_P_LV5(노출암), local_server/scripts/build_hazard_rocks.js 로 생성.
 *              수치(v)는 해도 기준면(약최저저조면) 위 노출 높이(m) — 우리 조위
 *              데이터(TideBED/조석표)와 같은 기준면이라 향후 "지금 잠기는지" 경고
 *              기능에서 보정 없이 바로 비교 가능(services/tide_field_common.js 참고).
 * ============================================================================
 */

(function () {
    'use strict';

    var DATA_URL = '/hazard_rocks.json';
    var layer = null;       // ol.layer.Vector — 6800여개 위험물 포인트
    var bubbleOverlay = null; // 탭한 지점에 뜨는 말풍선

    // k: 0=노출암(항상 물 위) 1=간출암(저조 시 드러남) 2=세암(수면과 같은 높이) 3=암암(항상 물속)
    var EXPOSED_KIND = 0;

    /**
     * feature 의 k 값에 따라 마커 스타일(색)을 고른다.
     * 노출암은 갈색, 간출암류(간출암/세암/암암)는 주황 — 사용자 요구대로 2가지로만 구분.
     * @param {ol.Feature} feature
     * @returns {ol.style.Style}
     * [연계] ← layer 의 style 함수로 등록
     */
    function styleFor(feature) {
        var isExposed = feature.get('k') === EXPOSED_KIND;
        return new ol.style.Style({
            image: new ol.style.Circle({
                radius: 4,
                fill: new ol.style.Fill({ color: isExposed ? '#8d6e63' : '#ff7043' }),
                stroke: new ol.style.Stroke({ color: '#fff', width: 1 })
            })
        });
    }

    /**
     * feature 의 종류·수치를 말풍선에 넣을 한 줄 문구로 만든다.
     * 예: 간출암 + v=1.0 → "간출암 · 저조 시 1.0m 노출"
     *     간출암 + v 없음 → "간출암 · 노출 높이 미상"
     *     노출암 → "노출암" (사실만)
     * @param {ol.Feature} feature
     * @returns {string}
     * [연계] ← window._hazardRocksTryHandleClick — 클릭 hit 시 호출
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
     * 위험물 레이어를 만들어 지도에 얹는다(처음엔 숨김). 데이터 로드는 1회만.
     * 예: window.initHazardRocksLayer(oceanMap) → 로드 완료 후 토글 버튼과 자동 연결
     * @param {ol.Map} map - 해양종합정보/해양안전이 함께 쓰는 OL 지도 인스턴스
     * [연계] ← ocean_map.js buildMap() (index2 전용) → 여기서 1회 호출
     */
    window.initHazardRocksLayer = function (map) {
        if (layer) return; // 중복 호출 방지(재진입 시 다시 fetch 하지 않음)

        fetch(DATA_URL)
            .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(function (geojson) {
                var fmt = new ol.format.GeoJSON({
                    dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857'
                });
                var features = fmt.readFeatures(geojson);
                layer = new ol.layer.Vector({
                    source: new ol.source.Vector({ features: features }),
                    style: styleFor,
                    visible: false,
                    zIndex: 55
                });
                map.addLayer(layer);
                bindToggle(map);
                console.log('[HazardRocks] 위험물 레이어 로드 완료:', features.length, '건');
            })
            .catch(function (e) {
                console.warn('[HazardRocks] 데이터 로드 실패:', e.message);
            });
    };

    /**
     * 위험물 토글 버튼을 레이어 표시/숨김과 연결한다.
     * [연계] ← initHazardRocksLayer() — 레이어 로드 완료 직후 1회
     */
    function bindToggle(map) {
        var btn = document.getElementById('ocean-hazard-toggle-btn');
        if (!btn) return;
        btn.addEventListener('click', function () {
            var visible = !layer.getVisible();
            layer.setVisible(visible);
            btn.classList.toggle('active', visible);
            if (visible && window.trackUsage) window.trackUsage('ocean.hazard_rocks');
            if (!visible && bubbleOverlay) bubbleOverlay.setPosition(undefined); // 끌 때 말풍선도 정리
        });
    }

    /**
     * [외부 API] 지도 클릭이 위험물 마커를 정확히 눌렀는지 확인하고, 맞으면
     * 그 자리에 말풍선을 띄운다. 레이어가 없거나 꺼져 있으면 항상 false.
     * @param {ol.Map} map
     * @param {ol.MapBrowserEvent} evt
     * @returns {boolean} true 면 클릭이 소비됨(호출자는 배경 클릭 핀 등을 건너뛰어야 함)
     * [연계] ← ocean_map.js handleMapClick — 마커/부이 클릭 다음 우선순위로 호출
     */
    window._hazardRocksTryHandleClick = function (map, evt) {
        if (!layer || !layer.getVisible()) return false;

        var hit = null;
        map.forEachFeatureAtPixel(evt.pixel, function (feature, lyr) {
            if (lyr === layer) { hit = feature; return true; }
        }, { layerFilter: function (l) { return l === layer; } });

        var bubble = ensureBubble(map);
        if (!hit) { bubble.setPosition(undefined); return false; }

        bubble.getElement().textContent = popupText(hit);
        bubble.setPosition(hit.getGeometry().getCoordinates());
        return true;
    };
})();
