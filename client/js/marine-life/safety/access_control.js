/**
 * ============================================================================
 * 파일명: client/js/marine-life/safety/access_control.js
 * 역할  : 해양안전 지도에 "출입통제" 토글 버튼을 얹어, 연안사고 예방에 관한
 *         법률 제10조에 따라 각 해양경찰서가 지정한 출입통제구역 폴리곤을
 *         표시한다. 폴리곤을 탭하면 관할서·구역명·상태를 토스트로 보여준다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : ocean-map/map/ocean_map.js(window.getOceanMap), OpenLayers(ol.*)
 *  - 서버 API      : 없음 — /access_control_zones.json 정적 파일(지연 로드)
 *  - 마크업        : index2.html #ocean-access-control-toggle-btn — 해양안전 전용
 *  - 나를 쓰는 곳  : 없음 — 토글 버튼은 이 파일이 자체 바인딩(ocean_warn_zone.js 와 동일 패턴)
 * [로드 순서] ocean_map.js 다음 · life_safety.js 바로 앞 (marine-life/safety 그룹)
 * [데이터 출처] 각 해양경찰서 홈페이지 고시.공고 게시판에서 직접 수집한 원문 PDF/HWP의
 *              경위도 좌표를 전사(자세한 출처·검증 이력은
 *              local_server/knowledge/legal/raw/02_해양경비구조/연안사고예방에관한법률/
 *              행정규칙/_원본첨부/_MANIFEST.md 참고). 폴리곤 전체가 좌표만으로 완결되는
 *              (해안선에 의존하지 않는) 구역만 우선 반영 — 나머지는 원본 이미지에
 *              손그림 경계선만 있어 후속 작업 필요.
 * ============================================================================
 */

(function () {
    'use strict';

    var DATA_URL = '/access_control_zones.json';

    var _layer = null;       // 외곽선+라벨 layer
    var _fillLayer = null;   // 채움 layer
    var _source = null;
    var _visible = false;
    var _loaded = false;
    var _loading = false;

    /** 출입통제구역 폴리곤 스타일 (빨간 톤 — 해도상 출입통제 표기 관례와 동일) */
    function _zoneStyle(feature) {
        return new ol.style.Style({
            stroke: new ol.style.Stroke({
                color: 'rgba(255, 82, 82, 0.9)',
                width: 2
            }),
            fill: new ol.style.Fill({
                color: 'rgba(255, 82, 82, 0.15)'
            }),
            text: new ol.style.Text({
                text: feature.get('location') || '',
                font: 'bold 11px "Pretendard", sans-serif',
                fill: new ol.style.Fill({ color: '#ffb3b3' }),
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
                zIndex: 42,
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
                zIndex: 82,
                visible: _visible,
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
                console.warn('[AccessControl] GeoJSON 로드 실패:', err.message);
            });
    }

    /** "항목: 값" 한 줄 — 값이 없으면 그 줄 자체를 만들지 않는다 */
    function _row(label, value) {
        if (!value) return '';
        return '<p><strong>' + label + '</strong>: ' + value + '</p>';
    }

    /** 문의처 문자열 속 전화번호(예: 032-650-2348)를 tel: 링크로 바꿔 탭하면 바로 전화 걸리게 한다 */
    function _linkifyPhone(text) {
        if (!text) return text;
        return text.replace(/(\d{2,3}-\d{3,4}-\d{4})/g, function (num) {
            return '<a href="tel:' + num.replace(/-/g, '') + '" style="color:#93c5fd;text-decoration:underline;">' + num + '</a>';
        });
    }

    /** 폴리곤 feature 하나의 상세 정보 팝업 HTML을 만든다(구역마다 고시 내용이 달라 항목별로 있는 것만 표시) */
    function _buildDetailHtml(hit) {
        var html = '';
        html += _row('관할', hit.get('station'));
        html += _row('고시.공고', hit.get('notice_no'));
        html += _row('일자', hit.get('date'));
        html += _row('지정사유', hit.get('reason'));
        html += _row('소재지', hit.get('address'));
        html += _row('통제기간', hit.get('control_period'));
        html += _row('통제시간', hit.get('control_time'));
        html += _row('대상', hit.get('target'));
        html += _row('벌칙', hit.get('penalty'));
        html += _row('문의처', _linkifyPhone(hit.get('contact')));
        html += _row('상태', hit.get('status'));

        var src = hit.get('source_file');
        if (src) {
            var url = '/api/legal/src?p=' + encodeURIComponent(src);
            html += '<p style="margin-top:16px;">' +
                '<a href="' + url + '" target="_blank" rel="noopener" ' +
                'style="display:inline-block;padding:8px 14px;border-radius:8px;' +
                'background:rgba(255,82,82,0.18);color:#ffb3b3;text-decoration:none;font-weight:600;">' +
                '<i class="fa-solid fa-file-lines"></i> 고시 원문 보기</a></p>';
        }
        return html || '<p>세부 정보를 불러오지 못했습니다.</p>';
    }

    /** 지도 클릭 시 출입통제구역 폴리곤을 찾아 상세 정보 팝업을 띄운다 */
    function _bindClick(map) {
        map.on('singleclick', function (evt) {
            if (!_visible) return;
            var hit = map.forEachFeatureAtPixel(evt.pixel, function (feature, layer) {
                if (layer === _fillLayer) return feature;
                return null;
            });
            if (!hit) return;
            var location = hit.get('location') || '출입통제구역';
            if (typeof window.showSeagnalModal === 'function') {
                window.showSeagnalModal(location, _buildDetailHtml(hit), 'info');
                // 항목 수가 많아 기본 폭(320px)보다 넓게 — 이 팝업에만 적용, 다른 showSeagnalModal 호출부는 그대로
                var modalContent = document.querySelector('#seagnal-custom-modal .seagnal-modal-content');
                if (modalContent) modalContent.classList.add('access-control-wide');
            } else if (typeof window._showOceanToast === 'function') {
                window._showOceanToast((hit.get('station') || '') + ' ' + location, 'bottom', 3000);
            }
        });
    }

    function _bindToggle(map) {
        var btn = document.getElementById('ocean-access-control-toggle-btn');
        if (!btn) return;

        btn.addEventListener('click', function () {
            _visible = !_visible;
            btn.classList.toggle('active', _visible);
            if (_layer) _layer.setVisible(_visible);
            if (_fillLayer) _fillLayer.setVisible(_visible);
            if (_visible) _load();
        });
    }

    /** oceanMap 이 만들어질 때까지 폴링 (ocean_warn_zone.js 와 동일 패턴) */
    function _installWhenReady() {
        function _try() {
            var map = window.getOceanMap && window.getOceanMap();
            if (map) {
                _ensureLayers(map);
                _bindToggle(map);
                _bindClick(map);
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
