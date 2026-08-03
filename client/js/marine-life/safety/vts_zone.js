/**
 * ============================================================================
 * 파일명: client/js/marine-life/safety/vts_zone.js
 * 역할  : 해양안전 지도에 "관제구역" 토글 버튼을 얹어, 선박교통관제에 관한 법률
 *         제12조(선박교통관제에 관한 규정 [별표 1])에 따라 지정된 선박교통관제구역
 *         (VTS) 폴리곤을 표시한다. 폴리곤을 탭하면 구역명·근거법령·관할 해양경찰청·
 *         담당부서·관제대상을 팝업으로 보여준다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : ocean-map/map/ocean_map.js(window.getOceanMap·oceanGetBasemap·oceanSetBasemap), OpenLayers(ol.*)
 *  - 서버 API      : 없음 — /vts_zones.json 정적 파일(지연 로드)
 *  - 마크업        : index2.html #ocean-vts-toggle-btn — 해양안전 전용
 *  - 나를 쓰는 곳  : 토글 버튼은 이 파일이 자체 바인딩(fishing_ban.js 와 동일 패턴).
 *                    폴리곤 클릭은 ocean_map.js의 handleMapClick 이
 *                    window._vtsZoneTryHandleClick(map, evt) 를 호출
 *                    (fishing_ban.js 의 _fishingBanTryHandleClick 다음 순위 —
 *                    이래야 해양종합정보 바텀시트가 같은 클릭에 같이 뜨는 걸 막는다)
 * [로드 순서] fishing_ban.js 다음 · life_safety.js 바로 앞 (marine-life/safety 그룹)
 * [데이터 출처] 국립해양조사원 해양공간 주제도 "선박교통관제구역"(TL_VTMSA_A) shapefile
 *              40개 폴리곤을 EPSG:5179 → WGS84 로 재투영하고, 같은 배포본의
 *              TL_VTMSA_A.xlsx 속성(OBJ_SN 조인)을 붙여 GeoJSON 으로 변환한 것.
 * ============================================================================
 */

(function () {
    'use strict';

    var DATA_URL = '/vts_zones.json';

    var _layer = null;       // 외곽선+라벨 layer
    var _fillLayer = null;   // 채움 layer
    var _source = null;
    var _visible = false;
    var _loaded = false;
    var _loading = false;

    /** 관제구역 폴리곤 스타일 (인디고 톤 — 빨강 출입통제·주황 낚시금지와 구분) */
    function _zoneStyle(feature) {
        return new ol.style.Style({
            stroke: new ol.style.Stroke({
                color: 'rgba(129, 140, 248, 0.9)',
                width: 2
            }),
            fill: new ol.style.Fill({
                color: 'rgba(129, 140, 248, 0.14)'
            }),
            text: new ol.style.Text({
                text: feature.get('name') || '',
                font: 'bold 11px "Pretendard", sans-serif',
                fill: new ol.style.Fill({ color: '#c7d2fe' }),
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
    function _fillOnlyStyle(feature) { return _onlyFill(_zoneStyle(feature)); }
    function _strokeOnlyStyle(feature) { return _onlyStrokeAndText(_zoneStyle(feature)); }

    function _ensureLayers(map) {
        if (!_source) _source = new ol.source.Vector();

        if (!_fillLayer) {
            _fillLayer = new ol.layer.Vector({
                source: _source,
                style: _fillOnlyStyle,
                zIndex: 40,
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
                zIndex: 80,
                visible: _visible,
                // 구역이 40개인데 이름이 길어("OO광역구역 NN OO 브이티에스") 라벨이 겹친다 —
                // 겹치는 라벨은 OpenLayers 가 알아서 생략하게 한다(fishing_ban.js 와 동일).
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
                console.warn('[VtsZone] GeoJSON 로드 실패:', err.message);
            });
    }

    /** "라벨/값" 2열 grid의 한 행 — 값이 없으면 그 행 자체를 만들지 않는다.
     *  (CSS 는 출입통제 팝업과 같은 .ac-detail-* 을 그대로 재사용 — 모양이 동일하다) */
    function _row(label, value) {
        if (!value) return '';
        return '<span class="ac-detail-label">' + label + '</span><span class="ac-detail-value">' + value + '</span>';
    }

    /** 전화번호(예: 032-835-2485)를 tel: 링크로 바꿔 탭하면 바로 전화 걸리게 한다
     *  (access_control.js 의 _linkifyPhone 과 같은 동작) */
    function _linkifyPhone(text) {
        if (!text) return text;
        return text.replace(/(\d{2,3}-\d{3,4}-\d{4})/g, function (num) {
            return '<a href="tel:' + num.replace(/-/g, '') + '" style="color:#93c5fd;text-decoration:underline;white-space:nowrap;">' + num + '</a>';
        });
    }

    /** 참고사이트 URL 을 그대로 클릭 가능한 링크로 감싼다(원문 규정 페이지로 이동) */
    function _linkifyUrl(url) {
        if (!url) return url;
        return '<a href="' + url + '" target="_blank" rel="noopener" ' +
               'style="color:#93c5fd;text-decoration:underline;word-break:break-all;font-size:0.9em;">' + url + '</a>';
    }

    /** 폴리곤 feature 하나의 상세 정보 팝업 HTML을 만든다(값이 있는 항목만 표시) */
    function _buildDetailHtml(hit) {
        var rows = '';
        rows += _row('정의', hit.get('definition'));
        rows += _row('근거법령', hit.get('law'));
        rows += _row('참고문서', hit.get('reference_doc'));
        rows += _row('규정개정일', hit.get('revision_date'));
        rows += _row('공고일자', hit.get('announce_date'));
        rows += _row('관할', hit.get('jurisdiction'));
        rows += _row('담당부서', hit.get('dept'));
        rows += _row('연락처', _linkifyPhone(hit.get('dept_tel')));
        rows += _row('관제대상', hit.get('target'));
        rows += _row('제외구역', hit.get('excluded'));
        rows += _row('참고사이트', _linkifyUrl(hit.get('reference_url')));

        return rows ? '<div class="ac-detail-grid">' + rows + '</div>'
                    : '<p>세부 정보를 불러오지 못했습니다.</p>';
    }

    /**
     * [외부 API] 지도 클릭이 선박교통관제구역 폴리곤을 눌렀는지 확인한다.
     * @param {ol.Map} map
     * @param {ol.MapBrowserEvent} evt
     * @returns {boolean} true 면 클릭이 소비됨(호출자는 바텀시트 등을 건너뛰어야 함)
     * [연계] ← ocean_map.js handleMapClick — 낚시금지 다음 우선순위로 호출.
     *        자체 singleclick 리스너를 따로 달지 않는 이유: 그렇게 하면 handleMapClick 의
     *        바텀시트 로직과 같은 클릭에 동시에 반응해버려 팝업+바텀시트가 함께 뜬다.
     */
    window._vtsZoneTryHandleClick = function (map, evt) {
        if (!_visible || !_fillLayer) return false;
        var hit = map.forEachFeatureAtPixel(evt.pixel, function (feature, layer) {
            if (layer === _fillLayer) return feature;
            return null;
        });
        if (!hit) return false;
        var name = hit.get('name') || '선박교통관제구역';
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
        var btn = document.getElementById('ocean-vts-toggle-btn');
        if (!btn) return;

        var _prevBasemap = null; // OFF 시 원래 배경지도로 되돌리기 위해 ON 시점 값을 기억

        btn.addEventListener('click', function () {
            _visible = !_visible;
            btn.classList.toggle('active', _visible);
            if (_layer) _layer.setVisible(_visible);
            if (_fillLayer) _fillLayer.setVisible(_visible);
            if (_visible) {
                _load();
                // 관제구역은 항로·항계와 함께 보는 항해 정보라, 위성지도가 아니라
                // 전자해도(enc)로 배경을 자동 전환한다(사용자 지시).
                // ON 시 전환 → OFF 시 복귀는 access_control.js·fishing_ban.js 와 동일 패턴.
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

    /** oceanMap 이 만들어질 때까지 폴링 (fishing_ban.js 와 동일 패턴) */
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
