/**
 * ============================================================================
 * 파일명: js/ocean_buoy.js
 * 역할: 해양종합 지도 – 기상부이 + 주요지명 통합 클러스터 레이어 (INDEX2 전용)
 * ============================================================================
 *
 * [설명]
 * INDEX2 해양종합 지도에서 기상부이와 주요지명(조석표준항) 마커를
 * 하나의 클러스터 레이어로 통합 관리합니다.
 * - 줌 레벨에 따라 마커가 묶이고(클러스터) 펼쳐짐 (CCTV 패턴)
 * - 기상부이, 주요지명 각각 독립 토글 가능
 * - 두 종류가 동시에 켜져 있으면 함께 클러스터링
 * - 부이 클릭: seaZones.js의 showBuoyModal 호출 (해구기상과 동일)
 * - 주요지명 클릭: 바텀시트 표시 (기존 동작 유지)
 * - 클러스터(숫자) 클릭: 해당 영역으로 줌 인
 *
 * [로드 순서] ocean_markers.js 이후, index2_patch.js 이전에 로드
 *
 * [연계 파일]
 * - buoyLocations.js → BUOY_LOCATIONS, BUOY_TYPE_NAMES
 * - tide.js → stationData (조석 표준항 목록)
 * - seaZones.js → showBuoyModal(), fetchBuoyDataForModal(), displayBuoyDataInModal()
 * - ocean_markers.js → 원본 마커 레이어 (이 파일이 대체)
 * - ocean_map.js → initOceanBuoys 호출, handleOceanBuoyClick 사용
 * ============================================================================
 */

// INDEX2에서만 실행
if (window.__SEAGNAL_PAGE === 'index2') {

(function () {
    'use strict';

    // ========================================================================
    // 상태 변수
    // ========================================================================
    var _map = null;
    var _clusterSource = null;
    var _clusterLayer = null;
    var _vectorSource = null;     // 실제 피처를 담는 소스
    var _buoyFeatures = [];       // 부이 피처 배열
    var _stationFeatures = [];    // 주요지명 피처 배열
    var _buoysVisible = false;
    var _stationsVisible = false;
    var _origShowOceanMarkers = null;

    // ========================================================================
    // 클러스터 설정 (CCTV 패턴과 동일)
    // ========================================================================

    /** 줌 레벨에 따른 클러스터 거리 (px) */
    function getClusterDistance(zoom) {
        if (zoom >= 15) return 15;
        if (zoom >= 13) return 20;
        if (zoom >= 11) return 25;
        if (zoom >= 9)  return 30;
        if (zoom >= 7)  return 35;
        return 40;
    }

    /** 클러스터 크기에 따른 색상 */
    function getClusterColor(size) {
        if (size >= 50) return { fill: 'rgba(220, 38, 38, 0.85)',  stroke: 'rgba(220, 38, 38, 0.3)' };
        if (size >= 30) return { fill: 'rgba(234, 88, 12, 0.85)',  stroke: 'rgba(234, 88, 12, 0.3)' };
        if (size >= 10) return { fill: 'rgba(202, 138, 4, 0.85)',  stroke: 'rgba(202, 138, 4, 0.3)' };
        if (size >= 5)  return { fill: 'rgba(22, 163, 74, 0.85)',  stroke: 'rgba(22, 163, 74, 0.3)' };
        return              { fill: 'rgba(59, 130, 246, 0.85)', stroke: 'rgba(59, 130, 246, 0.3)' };
    }

    // ========================================================================
    // 부이 아이콘 SVG (seaZones.js BUOY_SVG와 동일)
    // ========================================================================
    var BUOY_ICON_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
        '<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
        '<g>' +
        '<path d="M20 70 Q 50 85 80 70 L 80 60 L 20 60 Z" fill="#FDD835" stroke="#000" stroke-width="3"/>' +
        '<ellipse cx="50" cy="60" rx="30" ry="10" fill="#FFEB3B" stroke="#000" stroke-width="2"/>' +
        '<rect x="45" y="30" width="10" height="30" fill="#FBC02D" stroke="#000" stroke-width="2"/>' +
        '<rect x="40" y="30" width="20" height="5" fill="#F57F17" stroke="#000" stroke-width="2"/>' +
        '<circle cx="50" cy="25" r="5" fill="#F44336" stroke="#000" stroke-width="2"/>' +
        '<path d="M50 25 L 60 15 M 50 25 L 40 15" stroke="#000" stroke-width="2"/>' +
        '<rect x="25" y="50" width="12" height="8" fill="#1E88E5" stroke="#000" stroke-width="1" transform="rotate(-10 25 50)"/>' +
        '<rect x="63" y="50" width="12" height="8" fill="#1E88E5" stroke="#000" stroke-width="1" transform="rotate(10 63 50)"/>' +
        '</g></svg>'
    );

    // ========================================================================
    // 피처 생성
    // ========================================================================

    /** BUOY_LOCATIONS 데이터로 부이 피처 생성 */
    function createBuoyFeatures() {
        if (typeof BUOY_LOCATIONS === 'undefined') return [];
        var features = [];
        var keys = Object.keys(BUOY_LOCATIONS);
        for (var i = 0; i < keys.length; i++) {
            var id = keys[i];
            var buoy = BUOY_LOCATIONS[id];
            var feature = new ol.Feature({
                geometry: new ol.geom.Point(ol.proj.fromLonLat([buoy.lon, buoy.lat])),
                markerType: 'buoy',
                buoyId: id,
                buoyName: buoy.name,
                buoyType: buoy.type,
                buoyLat: buoy.lat,
                buoyLon: buoy.lon
            });
            features.push(feature);
        }
        return features;
    }

    /** stationData(tide.js)로 조석 표준항 피처 생성 */
    function createStationFeatures() {
        if (typeof stationData === 'undefined' || !stationData) return [];
        var features = [];
        for (var i = 0; i < stationData.length; i++) {
            var station = stationData[i];
            var feature = new ol.Feature({
                geometry: new ol.geom.Point(ol.proj.fromLonLat([station.lon, station.lat])),
                markerType: 'station',
                stationName: station.name,
                stationCode: station.code,
                stationLat: station.lat,
                stationLon: station.lon,
                type: 'tide-station'
            });
            features.push(feature);
        }
        return features;
    }

    // ========================================================================
    // 스타일 함수
    // ========================================================================
    var _styleCache = {};

    /** 단일 부이 피처 스타일 */
    function getBuoyStyle(feature, zoom) {
        var scale = zoom >= 10 ? 0.35 : zoom >= 8 ? 0.3 : 0.25;
        var name = feature.get('buoyName');
        var styles = [
            new ol.style.Style({
                image: new ol.style.Icon({
                    src: BUOY_ICON_SVG,
                    scale: scale,
                    anchor: [0.5, 0.8]
                })
            })
        ];
        if (zoom >= 8) {
            var fontSize = zoom >= 10 ? '11px' : '10px';
            styles.push(new ol.style.Style({
                text: new ol.style.Text({
                    text: name,
                    font: 'bold ' + fontSize + ' "Pretendard", sans-serif',
                    fill: new ol.style.Fill({ color: '#FDD835' }),
                    stroke: new ol.style.Stroke({ color: '#000', width: 3 }),
                    offsetY: -24,
                    textAlign: 'center'
                })
            }));
        }
        return styles;
    }

    /** 단일 주요지명 피처 스타일 (ocean_markers.js와 동일) */
    function getStationStyle(feature, zoom) {
        var name = feature.get('stationName');
        var radius = zoom >= 10 ? 6 : zoom >= 8 ? 5 : 4;
        var styles = [
            new ol.style.Style({
                image: new ol.style.Circle({
                    radius: radius + 2,
                    fill: new ol.style.Fill({ color: 'rgba(255,255,255,0.9)' }),
                    stroke: new ol.style.Stroke({ color: '#1a73e8', width: 1.5 })
                })
            }),
            new ol.style.Style({
                image: new ol.style.Circle({
                    radius: radius,
                    fill: new ol.style.Fill({ color: '#1a73e8' })
                })
            })
        ];
        if (zoom >= 8) {
            var fontSize = zoom >= 10 ? '11px' : '10px';
            styles.push(new ol.style.Style({
                text: new ol.style.Text({
                    text: name,
                    font: 'bold ' + fontSize + ' "Pretendard", sans-serif',
                    fill: new ol.style.Fill({ color: '#1a237e' }),
                    stroke: new ol.style.Stroke({ color: '#fff', width: 3 }),
                    offsetY: -16,
                    textAlign: 'center'
                })
            }));
        }
        return styles;
    }

    /** 클러스터 레이어 스타일 함수 */
    function clusterStyleFunction(feature) {
        var clusterFeatures = feature.get('features');
        var size = clusterFeatures ? clusterFeatures.length : 1;

        // 단일 피처: 마커 타입에 따라 개별 스타일
        if (size === 1) {
            var singleFeature = clusterFeatures[0];
            var zoom = _map.getView().getZoom();
            if (singleFeature.get('markerType') === 'buoy') {
                return getBuoyStyle(singleFeature, zoom);
            }
            return getStationStyle(singleFeature, zoom);
        }

        // 복수 피처: 클러스터 원형 스타일
        var colorKey = size >= 50 ? '50' : size >= 30 ? '30' : size >= 10 ? '10' : size >= 5 ? '5' : '2';
        var cacheKey = colorKey + '-' + size;

        if (!_styleCache[cacheKey]) {
            var color = getClusterColor(size);
            var radius = 16 + Math.min(size, 80) * 0.15;

            _styleCache[cacheKey] = [
                new ol.style.Style({
                    image: new ol.style.Circle({
                        radius: radius + 6,
                        fill: new ol.style.Fill({ color: color.stroke })
                    })
                }),
                new ol.style.Style({
                    image: new ol.style.Circle({
                        radius: radius,
                        fill: new ol.style.Fill({ color: color.fill }),
                        stroke: new ol.style.Stroke({ color: '#ffffff', width: 2 })
                    }),
                    text: new ol.style.Text({
                        text: size.toString(),
                        fill: new ol.style.Fill({ color: '#ffffff' }),
                        font: 'bold ' + (size >= 100 ? '11' : '13') + 'px "Noto Sans KR", sans-serif'
                    })
                })
            ];
        }
        return _styleCache[cacheKey];
    }

    // ========================================================================
    // 소스 피처 갱신 (토글 시 호출)
    // ========================================================================

    /** 현재 토글 상태에 맞게 소스의 피처를 교체 */
    function updateSourceFeatures() {
        if (!_vectorSource) return;
        _vectorSource.clear();
        var features = [];
        if (_stationsVisible) features = features.concat(_stationFeatures);
        if (_buoysVisible) features = features.concat(_buoyFeatures);
        if (features.length > 0) {
            _vectorSource.addFeatures(features);
        }
        _styleCache = {};
    }

    // ========================================================================
    // 초기화 (ocean_map.js의 buildMap에서 호출)
    // ========================================================================

    window.initOceanBuoys = function (map) {
        _map = map;

        // 피처 생성
        _buoyFeatures = createBuoyFeatures();
        _stationFeatures = createStationFeatures();

        // 벡터 소스 (토글 상태에 따라 피처가 추가/제거됨)
        _vectorSource = new ol.source.Vector();

        // 클러스터 소스
        var initialZoom = map.getView().getZoom() || 6;
        _clusterSource = new ol.source.Cluster({
            distance: getClusterDistance(initialZoom),
            minDistance: 0,
            source: _vectorSource
        });

        // 클러스터 레이어
        _clusterLayer = new ol.layer.Vector({
            source: _clusterSource,
            updateWhileAnimating: true,
            updateWhileInteracting: true,
            style: clusterStyleFunction,
            zIndex: 100
        });

        map.addLayer(_clusterLayer);

        // 줌 변경 시 클러스터 거리 동적 조절
        map.getView().on('change:resolution', function () {
            var zoom = map.getView().getZoom();
            var newDist = getClusterDistance(zoom);
            if (_clusterSource && _clusterSource.getDistance() !== newDist) {
                _clusterSource.setDistance(newDist);
            }
            _styleCache = {};
        });

        // ocean_markers.js의 원본 함수 저장 후 오버라이드
        _origShowOceanMarkers = window.showOceanMarkers;

        // showOceanMarkers 오버라이드: 클러스터 소스에서 주요지명 토글
        window.showOceanMarkers = function (visible) {
            _stationsVisible = visible;
            // 원본 마커 레이어는 항상 숨김 (클러스터가 대체)
            if (_origShowOceanMarkers) _origShowOceanMarkers(false);
            updateSourceFeatures();
        };

        // localStorage에서 이전 상태 복원
        _stationsVisible = localStorage.getItem('seagnal_markers_visible') === 'true';
        // 원본 마커 레이어 숨기기
        if (_origShowOceanMarkers) _origShowOceanMarkers(false);

        // 부이 토글 버튼 바인딩
        bindBuoyToggle();

        // 초기 피처 반영
        updateSourceFeatures();

        console.log('[OceanBuoy] 통합 클러스터 레이어 초기화 (부이: ' + _buoyFeatures.length + ', 지명: ' + _stationFeatures.length + ')');
    };

    // ========================================================================
    // 부이 토글 버튼 바인딩
    // ========================================================================

    function bindBuoyToggle() {
        var btn = document.getElementById('ocean-buoy-toggle-btn');
        if (!btn) return;

        _buoysVisible = localStorage.getItem('seagnal_buoys_visible') === 'true';
        btn.classList.toggle('active', _buoysVisible);

        btn.addEventListener('click', function () {
            _buoysVisible = !_buoysVisible;
            btn.classList.toggle('active', _buoysVisible);
            updateSourceFeatures();
            try { localStorage.setItem('seagnal_buoys_visible', String(_buoysVisible)); } catch (e) {}
        });
    }

    // ========================================================================
    // 클릭 처리 (ocean_map.js의 handleMapClick에서 호출)
    // ========================================================================

    window.handleOceanBuoyClick = function (map, evt) {
        if (!_clusterLayer || !_clusterLayer.getVisible()) return false;

        var hit = false;
        map.forEachFeatureAtPixel(evt.pixel, function (feature, layer) {
            if (hit) return;
            if (layer !== _clusterLayer) return;

            var clusterFeatures = feature.get('features');
            if (!clusterFeatures || clusterFeatures.length === 0) return;

            if (clusterFeatures.length === 1) {
                // 단일 피처 클릭
                var single = clusterFeatures[0];
                if (single.get('markerType') === 'buoy') {
                    // 부이 모달 표시 (seaZones.js의 showBuoyModal 재사용)
                    var buoyId = single.get('buoyId');
                    var buoyData = {
                        name: single.get('buoyName'),
                        type: single.get('buoyType')
                    };
                    if (typeof showBuoyModal === 'function') {
                        showBuoyModal(buoyId, buoyData);
                    }
                    hit = true;
                } else if (single.get('markerType') === 'station') {
                    // 주요지명(조석 표준항) → 바텀시트 표시
                    var lat = single.get('stationLat');
                    var lon = single.get('stationLon');
                    var name = single.get('stationName');
                    var code = single.get('stationCode');
                    if (window.showOceanBottomSheet) {
                        window.showOceanBottomSheet(lat, lon, { stationName: name, stationCode: code });
                    }
                    hit = true;
                }
            } else {
                // 클러스터 클릭 → 해당 영역으로 줌 인
                var extent = ol.extent.createEmpty();
                for (var i = 0; i < clusterFeatures.length; i++) {
                    ol.extent.extend(extent, clusterFeatures[i].getGeometry().getExtent());
                }
                map.getView().fit(extent, {
                    duration: 500,
                    padding: [80, 80, 80, 80],
                    maxZoom: 15
                });
                hit = true;
            }
        }, { hitTolerance: 10 });

        return hit;
    };

})();

} // end if (window.__SEAGNAL_PAGE === 'index2')
