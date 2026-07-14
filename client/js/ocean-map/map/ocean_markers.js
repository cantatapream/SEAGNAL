/**
 * ============================================================================
 * 파일명: js/ocean_markers.js
 * 역할: 해양종합정보 조석 표준항 마커 + 클릭 처리
 * ============================================================================
 *
 * [설명]
 * 모드 A(조석지도)에서 조석 표준항 마커를 지도에 표시하고,
 * 마커 또는 지도 클릭 시 바텀시트를 호출합니다.
 *
 * [연계 파일]
 * - ocean_map.js → initOceanMarkers() 호출
 * - ocean_bottom_sheet.js → showOceanBottomSheet() 호출
 * - tide.js → stationData (조석 표준항 목록) 참조
 * ============================================================================
 */

(function () {
    'use strict';

    let markerLayer = null;
    let mapRef = null;

    /**
     * 조석 표준항 마커를 지도에 추가합니다.
     * tide.js의 stationData를 참조합니다.
     */
    window.initOceanMarkers = function (map) {
        mapRef = map;

        // stationData가 tide.js에서 전역으로 선언됨
        if (typeof stationData === 'undefined' || !stationData || stationData.length === 0) {
            console.warn('[OceanMarkers] stationData 없음');
            return;
        }

        if (markerLayer) {
            map.removeLayer(markerLayer);
        }

        const features = stationData.map(function (station) {
            var feature = new ol.Feature({
                geometry: new ol.geom.Point(ol.proj.fromLonLat([station.lon, station.lat])),
                stationName: station.name,
                stationCode: station.code,
                stationLat: station.lat,
                stationLon: station.lon,
                type: 'tide-station'
            });
            return feature;
        });

        markerLayer = new ol.layer.Vector({
            source: new ol.source.Vector({ features: features }),
            zIndex: 100,
            style: function (feature, resolution) {
                var zoom = map.getView().getZoom();
                var name = feature.get('stationName');

                // 줌 레벨에 따른 마커 크기
                var radius = zoom >= 10 ? 6 : zoom >= 8 ? 5 : 4;
                var fontSize = zoom >= 10 ? '11px' : zoom >= 8 ? '10px' : '0px';

                var styles = [
                    // 외곽 테두리
                    new ol.style.Style({
                        image: new ol.style.Circle({
                            radius: radius + 2,
                            fill: new ol.style.Fill({ color: 'rgba(255,255,255,0.9)' }),
                            stroke: new ol.style.Stroke({ color: '#1a73e8', width: 1.5 })
                        })
                    }),
                    // 중심점
                    new ol.style.Style({
                        image: new ol.style.Circle({
                            radius: radius,
                            fill: new ol.style.Fill({ color: '#1a73e8' })
                        })
                    })
                ];

                // 줌 8 이상에서만 라벨 표시
                if (zoom >= 8) {
                    styles.push(new ol.style.Style({
                        text: new ol.style.Text({
                            text: name,
                            font: `bold ${fontSize} "Pretendard", sans-serif`,
                            fill: new ol.style.Fill({ color: '#1a237e' }),
                            stroke: new ol.style.Stroke({ color: '#fff', width: 3 }),
                            offsetY: -16,
                            textAlign: 'center'
                        })
                    }));
                }

                return styles;
            }
        });

        map.addLayer(markerLayer);
    };

    /**
     * 마커 레이어 표시/숨김 (모드 전환 시 사용)
     */
    window.showOceanMarkers = function (visible) {
        if (markerLayer) {
            markerLayer.setVisible(visible);
        }
    };

    /**
     * 마커 클릭 확인
     * @returns {boolean} 마커가 클릭되었으면 true
     */
    window.handleOceanMarkerClick = function (map, evt) {
        var hit = false;
        map.forEachFeatureAtPixel(evt.pixel, function (feature) {
            if (feature.get('type') === 'tide-station') {
                var lat = feature.get('stationLat');
                var lon = feature.get('stationLon');
                var name = feature.get('stationName');
                var code = feature.get('stationCode');

                if (window.showOceanBottomSheet) {
                    window.showOceanBottomSheet(lat, lon, { stationName: name, stationCode: code });
                }
                hit = true;
            }
        }, { hitTolerance: 10 });
        return hit;
    };

})();
