/**
 * ============================================================================
 * 파일명: js/ocean_warn_zone.js
 * 역할: 해양종합정보 지도에 KMA 해상 예특보구역(44개) 폴리곤 outline 표출
 * ============================================================================
 *
 * [개요]
 * - /api/warn-zones (서버에 저장된 GeoJSON, 원본은 marine.kma.go.kr 의
 *   geoserver mmis:shp_wrn_poly 레이어) 를 1회 fetch.
 * - OpenLayers Vector Layer 로 변환해 oceanMap 에 추가.
 * - 우측 토글 버튼(#ocean-warn-zone-toggle-btn) 클릭 시 layer.setVisible
 *   토글. 기본은 OFF (다른 토글들과 동일 패턴).
 * - 토글 상태는 localStorage('seagnal_warn_zone_visible') 에 저장.
 *
 * [지도 준비 대기]
 * 사용자가 해양종합정보 탭에 들어와야 oceanMap 이 만들어지므로,
 * ocean_cctv.js 와 동일하게 시간 제한 없이 250ms 주기로 폴링한다.
 *
 * [zIndex] 80
 *  - 해아름 베이스맵 < 특보구역 outline < 부이/CCTV 마커
 * ============================================================================
 */

(function () {
    'use strict';

    var _layer = null;
    var _source = null;
    var _visible = false;
    var _loaded = false;          // GeoJSON 로딩 완료 플래그 (중복 fetch 방지)
    var _loading = false;         // 현재 fetch 중 플래그

    /** 특보구역 폴리곤 스타일: 라인만 그리고 채움 없음 (지도가 가려지지 않게) */
    function _zoneStyle(feature) {
        var name = feature.get('name') || '';
        return new ol.style.Style({
            stroke: new ol.style.Stroke({
                color: 'rgba(255, 200, 80, 0.85)',
                width: 1.5,
                lineDash: [6, 4]
            }),
            fill: new ol.style.Fill({
                color: 'rgba(255, 200, 80, 0.04)'   // 매우 옅은 채움 (클릭 인식용)
            }),
            text: new ol.style.Text({
                text: name,
                font: 'bold 11px "Pretendard", sans-serif',
                fill: new ol.style.Fill({ color: '#ffd166' }),
                stroke: new ol.style.Stroke({ color: 'rgba(0,0,0,0.85)', width: 3 }),
                overflow: false,
                placement: 'point'
            })
        });
    }

    /** GeoJSON fetch + Vector Layer 생성 (1회만 실행) */
    function _ensureLayer(map) {
        if (_layer) return _layer;
        _source = new ol.source.Vector();
        _layer = new ol.layer.Vector({
            source: _source,
            style: _zoneStyle,
            zIndex: 80,
            visible: _visible,
            updateWhileAnimating: false,
            updateWhileInteracting: false
        });
        map.addLayer(_layer);
        return _layer;
    }

    /** GeoJSON 데이터를 fetch 해서 Vector source 에 주입 */
    function _loadGeoJson() {
        if (_loaded || _loading) return;
        _loading = true;

        fetch('/api/warn-zones')
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (geojson) {
                if (!_source) return;
                var format = new ol.format.GeoJSON();
                // 입력 좌표계는 EPSG:4326, 지도 표시 좌표계는 EPSG:3857
                var features = format.readFeatures(geojson, {
                    dataProjection: 'EPSG:4326',
                    featureProjection: 'EPSG:3857'
                });
                _source.addFeatures(features);
                _loaded = true;
                _loading = false;
            })
            .catch(function (err) {
                _loading = false;
                console.warn('[OceanWarnZone] GeoJSON 로드 실패:', err.message);
            });
    }

    /** 토글 버튼 바인딩 + 클릭 처리 */
    function _bindToggle() {
        var btn = document.getElementById('ocean-warn-zone-toggle-btn');
        if (!btn) return;

        // 이전 세션의 표시 상태 복원 (기본 OFF)
        try {
            _visible = localStorage.getItem('seagnal_warn_zone_visible') === 'true';
        } catch (e) { _visible = false; }

        btn.classList.toggle('active', _visible);
        if (_layer) _layer.setVisible(_visible);
        if (_visible) _loadGeoJson();   // 처음부터 ON 이면 즉시 로드

        btn.addEventListener('click', function () {
            _visible = !_visible;
            btn.classList.toggle('active', _visible);
            if (_layer) _layer.setVisible(_visible);
            if (_visible) _loadGeoJson();
            try { localStorage.setItem('seagnal_warn_zone_visible', String(_visible)); } catch (e) {}
        });
    }

    /** oceanMap 이 만들어질 때까지 시간 제한 없이 폴링 */
    function _installWhenReady() {
        function _try() {
            var map = window.getOceanMap && window.getOceanMap();
            if (map) {
                _ensureLayer(map);
                _bindToggle();
                return;
            }
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
