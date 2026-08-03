/**
 * ============================================================================
 * 파일명: client/js/marine-life/safety/seaway.js
 * 역할  : 해양안전 지도에 "항로" 토글 버튼을 얹어, 선박의 입항 및 출항 등에 관한
 *         법률 제10조·해상교통안전법 제30조 등에 따라 지정ㆍ고시된 항로(선박 출입
 *         통로)를 표시한다. 면(面)으로 고시된 항로는 폴리곤, 통항분리대처럼 선(線)
 *         으로 고시된 항로는 선으로 그린다. 탭하면 항로명·종류·참고문서·참고사이트
 *         를 팝업으로 보여준다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : ocean-map/map/ocean_map.js(window.getOceanMap·oceanGetBasemap·oceanSetBasemap), OpenLayers(ol.*)
 *  - 서버 API      : 없음 — /seaway_zones.json 정적 파일(지연 로드)
 *  - 마크업        : index2.html #ocean-seaway-toggle-btn — 해양안전 전용
 *  - 나를 쓰는 곳  : 토글 버튼은 이 파일이 자체 바인딩(vts_zone.js 와 동일 패턴).
 *                    폴리곤 클릭은 ocean_map.js의 handleMapClick 이
 *                    window._seawayTryHandleClick(map, evt) 를 호출
 *                    (vts_zone.js 의 _vtsZoneTryHandleClick 다음 순위 —
 *                    이래야 해양종합정보 바텀시트가 같은 클릭에 같이 뜨는 걸 막는다)
 * [로드 순서] vts_zone.js 다음 · life_safety.js 바로 앞 (marine-life/safety 그룹)
 * [데이터 출처] 국립해양조사원 "개방海" 포털의 실시간 WFS(vi_seaway 레이어)에서
 *              받아온 141개(2026-08 기준)를 EPSG:5179 → WGS84 로 재투영한 GeoJSON.
 *              면 124개(MultiPolygon) + 선 17개(MultiLineString) 가 섞여 있다.
 *              (이전에 쓰던 TL_SEAWAY_A shapefile 77개는 최신본이 아니어서 교체 —
 *               완도 인근처럼 실제로는 여러 개인 곳이 1개로만 나왔다)
 * ============================================================================
 */

(function () {
    'use strict';

    var DATA_URL = '/seaway_zones.json';

    var _layer = null;       // 외곽선+라벨 layer
    var _fillLayer = null;   // 채움 layer
    var _source = null;
    var _visible = false;
    var _loaded = false;
    var _loading = false;

    /** 선(線)으로 고시된 항로인가 — 통항분리대 등 17개가 MultiLineString 이다.
     *  채움이 없으므로 채움 레이어에서는 빼고, 클릭 판정도 외곽선 레이어에서 해야 한다. */
    function _isLine(feature) {
        var t = feature.getGeometry() && feature.getGeometry().getType();
        return t === 'LineString' || t === 'MultiLineString';
    }

    /** 항로 스타일 (청록 톤 — 빨강 출입통제·주황 낚시금지·인디고 관제구역과 구분) */
    function _zoneStyle(feature) {
        return new ol.style.Style({
            stroke: new ol.style.Stroke({
                color: 'rgba(45, 212, 191, 0.9)',
                width: 2
            }),
            fill: new ol.style.Fill({
                color: 'rgba(45, 212, 191, 0.14)'
            }),
            text: new ol.style.Text({
                text: feature.get('name') || '',
                font: 'bold 11px "Pretendard", sans-serif',
                fill: new ol.style.Fill({ color: '#99f6e4' }),
                stroke: new ol.style.Stroke({ color: 'rgba(0,0,0,0.85)', width: 3 }),
                overflow: true,
                placement: 'point'
            })
        });
    }

    function _onlyFill(style) {
        var f = style.getFill();
        if (!f) return null;
        return new ol.style.Style({ fill: f });
    }
    function _onlyStrokeAndText(style) {
        return new ol.style.Style({ stroke: style.getStroke(), text: style.getText() });
    }
    // 채움 레이어는 면 항로만 — 선 항로는 채울 것이 없으므로 스타일 없음(null)으로 건너뛴다.
    // 외곽선 레이어는 면·선 둘 다 같은 청록 선으로 그린다(선 항로는 이 레이어에만 보인다).
    function _fillOnlyStyle(feature) { return _isLine(feature) ? null : _onlyFill(_zoneStyle(feature)); }
    function _strokeOnlyStyle(feature) { return _onlyStrokeAndText(_zoneStyle(feature)); }

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
                // 항로가 141개인데 좁고 길게 붙어 있어("OO항 제1항로") 라벨이 겹친다 —
                // 겹치는 라벨은 OpenLayers 가 알아서 생략하게 한다(vts_zone.js 와 동일).
                declutter: true,
                updateWhileAnimating: false,
                updateWhileInteracting: false
            });
            map.addLayer(_layer);
        }
    }

    /** 정적 GeoJSON lazy fetch — 버튼을 처음 켤 때만 1회 */
    function _load() {
        if (_loaded || _loading) return;
        _loading = true;
        fetch(DATA_URL)
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (geojson) {
                if (!_source) return;
                var features = new ol.format.GeoJSON().readFeatures(geojson, {
                    dataProjection: 'EPSG:4326',
                    featureProjection: 'EPSG:3857'
                });
                _source.addFeatures(features);
                _loaded = true;
                _loading = false;
            })
            .catch(function (err) {
                _loading = false;
                console.warn('[Seaway] GeoJSON 로드 실패:', err.message);
            });
    }

    /** "라벨/값" 2열 grid의 한 행 — 값이 없으면 그 행 자체를 만들지 않는다.
     *  (CSS 는 출입통제 팝업과 같은 .ac-detail-* 을 그대로 재사용 — 모양이 동일하다) */
    function _row(label, value) {
        if (!value) return '';
        return '<span class="ac-detail-label">' + label + '</span><span class="ac-detail-value">' + value + '</span>';
    }

    /** 참고사이트 URL 을 그대로 클릭 가능한 링크로 감싼다(원문 법령 페이지로 이동) */
    function _linkifyUrl(url) {
        if (!url) return url;
        return '<a href="' + url + '" target="_blank" rel="noopener" ' +
               'style="color:#93c5fd;text-decoration:underline;word-break:break-all;font-size:0.9em;">' + url + '</a>';
    }

    /** feature 하나의 상세 정보 팝업 HTML을 만든다(값이 있는 항목만 표시 —
     *  WFS 가 주는 항목이 종류·참고문서·참고사이트 셋뿐이다) */
    function _buildDetailHtml(hit) {
        var rows = '';
        rows += _row('종류', hit.get('category'));
        rows += _row('참고문서', hit.get('reference_doc'));
        rows += _row('참고사이트', _linkifyUrl(hit.get('reference_url')));

        return rows ? '<div class="ac-detail-grid">' + rows + '</div>'
                    : '<p>세부 정보를 불러오지 못했습니다.</p>';
    }

    /**
     * [외부 API] 지도 클릭이 항로를 눌렀는지 확인한다.
     * @param {ol.Map} map
     * @param {ol.MapBrowserEvent} evt
     * @returns {boolean} true 면 클릭이 소비됨(호출자는 바텀시트 등을 건너뛰어야 함)
     * [연계] ← ocean_map.js handleMapClick — 관제구역 다음 우선순위로 호출.
     *        자체 singleclick 리스너를 따로 달지 않는 이유: 그렇게 하면 handleMapClick 의
     *        바텀시트 로직과 같은 클릭에 동시에 반응해버려 팝업+바텀시트가 함께 뜬다.
     */
    window._seawayTryHandleClick = function (map, evt) {
        if (!_visible || !_fillLayer) return false;
        var hit = map.forEachFeatureAtPixel(evt.pixel, function (feature, layer) {
            if (layer === _fillLayer) return feature;
            // 선 항로(통항분리대 등)는 채움이 없어 _fillLayer 로는 못 잡으므로
            // 외곽선 레이어에서 보조 판정한다(면 항로는 이미 위에서 잡힌다) —
            // access_control.js 와 같은 패턴.
            if (layer === _layer && _isLine(feature)) return feature;
            return null;
        }, { hitTolerance: 5 });   // 선은 2px 라 손가락으로 정확히 누르기 어렵다
        if (!hit) return false;
        var name = hit.get('name') || '항로';
        if (typeof window.showSeagnalModal === 'function') {
            window.showSeagnalModal(name, _buildDetailHtml(hit), 'info');
            // 항목 수가 많아 기본 폭(320px)보다 넓게 — 출입통제 팝업과 같은 클래스를 재사용
            var modalContent = document.querySelector('#seagnal-custom-modal .seagnal-modal-content');
            if (modalContent) modalContent.classList.add('access-control-wide');
        } else if (typeof window._showOceanToast === 'function') {
            window._showOceanToast(name, 'bottom', 3000);
        }
        return true;
    };

    function _bindToggle(map) {
        var btn = document.getElementById('ocean-seaway-toggle-btn');
        if (!btn) return;

        var _prevBasemap = null; // OFF 시 원래 배경지도로 되돌리기 위해 ON 시점 값을 기억

        btn.addEventListener('click', function () {
            _visible = !_visible;
            btn.classList.toggle('active', _visible);
            if (_layer) _layer.setVisible(_visible);
            if (_fillLayer) _fillLayer.setVisible(_visible);
            if (_visible) {
                _load();
                // 항로는 관제구역과 마찬가지로 항해 정보라, 위성지도가 아니라
                // 전자해도(enc)로 배경을 자동 전환한다(사용자 지시).
                // ON 시 전환 → OFF 시 복귀는 vts_zone.js 와 동일 패턴.
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

    /** oceanMap 이 만들어질 때까지 폴링 (vts_zone.js 와 동일 패턴) */
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
