/**
 * ============================================================================
 * 파일명: client/js/marine-life/safety/navigational_warning.js
 * 역할  : 해양안전 지도에 "항행경보" 토글 버튼을 얹어, 오늘 발효 중인 항행경보
 *         (선박사고·표류장애물·수중장애물·해상사격훈련 등)의 구역을 원형/다각형
 *         으로 표시한다. 구역을 탭하면 제목·구분·발표기관·유효기간·본문을 팝업으로
 *         보여준다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : ocean-map/map/ocean_map.js(window.getOceanMap·oceanGetBasemap·oceanSetBasemap),
 *                    shared/ui/ui_modal.js(window.showSeagnalModal), OpenLayers(ol.*)
 *  - 서버 API      : GET /api/navigational-warning/list (30분 캐시 — 텍스트는 공식
 *                    data.go.kr API, 좌표는 KHOA 내부 API 보강, local_server/routes/navigational_warning.js)
 *  - 마크업        : index2.html #ocean-navwarn-btn — 해양안전 전용
 *  - 나를 쓰는 곳  : 토글 버튼은 이 파일이 자체 바인딩(seaway.js 와 동일 패턴).
 *                    구역 클릭은 ocean_map.js의 handleMapClick 이
 *                    window._navwarnTryHandleClick(map, evt) 를 호출(seaway.js 다음 순위)
 * [로드 순서] seaway.js 다음 · life_safety.js 바로 앞 (marine-life/safety 그룹)
 * ============================================================================
 */

(function () {
    'use strict';

    var LIST_URL = '/api/navigational-warning/list';
    var NM_TO_M = 1852; // 1해리(nautical mile) = 1852m — RADIUS(해리) → OpenLayers Circle 반경(m) 환산

    var _layer = null;       // 외곽선 layer
    var _fillLayer = null;   // 채움 layer
    var _source = null;
    var _visible = false;
    var _loaded = false;
    var _loading = false;

    /** 항행경보 구역 스타일 (경고 의미의 붉은 톤 — 다른 해양안전 레이어와 색 구분) */
    function _zoneStyle(feature) {
        return new ol.style.Style({
            stroke: new ol.style.Stroke({
                color: 'rgba(248, 113, 113, 0.95)',
                width: 2,
                lineDash: [6, 4]
            }),
            fill: new ol.style.Fill({
                color: 'rgba(248, 113, 113, 0.16)'
            })
        });
    }
    function _onlyFill(style) {
        var f = style.getFill();
        if (!f) return null;
        return new ol.style.Style({ fill: f });
    }
    function _onlyStroke(style) {
        return new ol.style.Style({ stroke: style.getStroke() });
    }
    function _fillOnlyStyle(feature) { return _onlyFill(_zoneStyle(feature)); }
    function _strokeOnlyStyle(feature) { return _onlyStroke(_zoneStyle(feature)); }

    function _ensureLayers(map) {
        if (!_source) _source = new ol.source.Vector();

        if (!_fillLayer) {
            _fillLayer = new ol.layer.Vector({
                source: _source,
                style: _fillOnlyStyle,
                zIndex: 43,
                visible: _visible,
                updateWhileAnimating: false,
                updateWhileInteracting: false
            });
            map.addLayer(_fillLayer);
        }
        if (!_layer) {
            _layer = new ol.layer.Vector({
                source: _source,
                style: _strokeOnlyStyle,
                zIndex: 83,
                visible: _visible,
                updateWhileAnimating: false,
                updateWhileInteracting: false
            });
            map.addLayer(_layer);
        }
    }

    /** 서버가 준 zone(원형/다각형 위경도)을 OpenLayers feature로 변환한다.
     *  점이 부족해 그릴 수 없는 zone은 건너뛴다(그런 항목도 있음). */
    function _buildFeatures(items) {
        var features = [];
        items.forEach(function (item) {
            (item.zones || []).forEach(function (zone) {
                var geom = null;
                if (zone.type === 'circle' && zone.points.length >= 1 && zone.radiusNm) {
                    var center = ol.proj.fromLonLat([zone.points[0].lon, zone.points[0].lat]);
                    geom = new ol.geom.Circle(center, zone.radiusNm * NM_TO_M);
                } else if (zone.points.length >= 3) {
                    var ring = zone.points.map(function (p) { return ol.proj.fromLonLat([p.lon, p.lat]); });
                    ring.push(ring[0]);
                    geom = new ol.geom.Polygon([ring]);
                }
                if (!geom) return;

                var feature = new ol.Feature({ geometry: geom });
                feature.set('item', item);
                feature.set('zone', zone);
                features.push(feature);
            });
        });
        return features;
    }

    function _load() {
        if (_loaded || _loading) return;
        _loading = true;
        fetch(LIST_URL)
            .then(function (res) { return res.json(); })
            .then(function (data) {
                _loading = false;
                if (!data.success || !_source) return;
                _source.addFeatures(_buildFeatures(data.items || []));
                _loaded = true;
            })
            .catch(function (err) {
                _loading = false;
                console.warn('[NavWarn] 목록 로드 실패:', err.message);
            });
    }

    /** "라벨/값" 2열 grid의 한 행 — 값이 없으면 그 행 자체를 만들지 않는다.
     *  (CSS 는 출입통제/항로 팝업과 같은 .ac-detail-* 을 그대로 재사용) */
    function _row(label, value) {
        if (!value) return '';
        return '<span class="ac-detail-label">' + label + '</span><span class="ac-detail-value">' + value + '</span>';
    }

    /** 구역 feature 하나의 상세 정보 팝업 HTML — 상세 항목 + 본문 */
    function _buildDetailHtml(feature) {
        var item = feature.get('item');
        var zone = feature.get('zone');
        var cat = item.noti_cat || item.app_cat || '';

        var rows = '';
        rows += _row('구분', cat);
        rows += _row('발표기관', item.gov_cd);
        rows += _row('구역', zone.name);
        rows += _row('유효기간', zone.validity);
        rows += _row('근거', item.basic);

        var html = rows ? '<div class="ac-detail-grid">' + rows + '</div>' : '';
        if (item.content) {
            html += '<p style="margin-top:12px;color:#e4eaf3;font-size:0.88rem;line-height:1.65;text-align:left;">' +
                item.content.replace(/\r\n|\r/g, '\n') + '</p>';
        }
        return html || '<p>세부 정보를 불러오지 못했습니다.</p>';
    }

    /**
     * [외부 API] 지도 클릭이 항행경보 구역을 눌렀는지 확인한다.
     * @param {ol.Map} map
     * @param {ol.MapBrowserEvent} evt
     * @returns {boolean} true 면 클릭이 소비됨(호출자는 바텀시트 등을 건너뛰어야 함)
     * [연계] ← ocean_map.js handleMapClick — 항로 다음 순위로 호출.
     */
    window._navwarnTryHandleClick = function (map, evt) {
        if (!_visible || !_fillLayer) return false;
        var hit = map.forEachFeatureAtPixel(evt.pixel, function (feature, layer) {
            if (layer === _fillLayer) return feature;
            return null;
        });
        if (!hit) return false;
        var item = hit.get('item');
        if (typeof window.showSeagnalModal === 'function') {
            window.showSeagnalModal(item.title || '항행경보', _buildDetailHtml(hit), 'info');
            var modalContent = document.querySelector('#seagnal-custom-modal .seagnal-modal-content');
            if (modalContent) modalContent.classList.add('access-control-wide');
        } else if (typeof window._showOceanToast === 'function') {
            window._showOceanToast(item.title || '항행경보', 'bottom', 3000);
        }
        return true;
    };

    function _bindToggle(map) {
        var btn = document.getElementById('ocean-navwarn-btn');
        if (!btn) return;

        var _prevBasemap = null; // OFF 시 원래 배경지도로 되돌리기 위해 ON 시점 값을 기억

        btn.addEventListener('click', function () {
            _visible = !_visible;
            btn.classList.toggle('active', _visible);
            if (_layer) _layer.setVisible(_visible);
            if (_fillLayer) _fillLayer.setVisible(_visible);
            if (_visible) {
                _load();
                // 항해 정보라 위성지도가 아니라 전자해도(enc)로 배경을 자동 전환한다
                // (seaway.js·vts_zone.js 와 동일 패턴).
                if (typeof window.oceanGetBasemap === 'function' && typeof window.oceanSetBasemap === 'function') {
                    _prevBasemap = window.oceanGetBasemap();
                    if (_prevBasemap !== 'enc') window.oceanSetBasemap('enc');
                }
            } else if (_prevBasemap && _prevBasemap !== 'enc' && typeof window.oceanSetBasemap === 'function') {
                window.oceanSetBasemap(_prevBasemap);
                _prevBasemap = null;
            }
        });
    }

    /** oceanMap 이 만들어질 때까지 폴링 (seaway.js 와 동일 패턴) */
    function _installWhenReady() {
        function _try() {
            var map = window.getOceanMap && window.getOceanMap();
            if (map) {
                _ensureLayers(map);
                _bindToggle(map);
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
