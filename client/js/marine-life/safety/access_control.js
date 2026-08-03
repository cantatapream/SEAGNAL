/**
 * ============================================================================
 * 파일명: client/js/marine-life/safety/access_control.js
 * 역할  : 해양안전 지도에 "출입통제" 토글 버튼을 얹어, 연안사고 예방에 관한
 *         법률 제10조에 따라 각 해양경찰서가 지정한 출입통제구역 폴리곤을
 *         표시한다. 폴리곤을 탭하면 관할서·구역명·상태를 토스트로 보여준다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : ocean-map/map/ocean_map.js(window.getOceanMap·oceanGetBasemap·oceanSetBasemap), OpenLayers(ol.*)
 *  - 서버 API      : 없음 — /access_control_zones.json 정적 파일(지연 로드)
 *  - 마크업        : index2.html #ocean-access-control-toggle-btn — 해양안전 전용
 *  - 나를 쓰는 곳  : 토글 버튼은 이 파일이 자체 바인딩(ocean_warn_zone.js 와 동일 패턴).
 *                    폴리곤 클릭은 ocean_map.js의 handleMapClick 이
 *                    window._accessControlTryHandleClick(map, evt) 를 호출
 *                    (hazard_rocks.js 의 _hazardRocksTryHandleClick 과 동일 패턴 —
 *                    이래야 해양종합정보 바텀시트가 같은 클릭에 같이 뜨는 걸 막는다)
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

    /** "라벨/값" 2열 grid의 한 행 — 값이 없으면 그 행 자체를 만들지 않는다.
     *  (grid-template-columns: max-content 1fr 이라 값이 줄바꿈되면 값 칸의
     *  왼쪽 끝, 즉 라벨 다음 위치에 자동으로 맞춰 정렬된다) */
    function _row(label, value) {
        if (!value) return '';
        return '<span class="ac-detail-label">' + label + '</span><span class="ac-detail-value">' + value + '</span>';
    }

    /** 문의처 문자열 속 전화번호(예: 032-650-2348)를 tel: 링크로 바꿔 탭하면 바로 전화 걸리게 한다 */
    function _linkifyPhone(text) {
        if (!text) return text;
        return text.replace(/(\d{2,3}-\d{3,4}-\d{4})/g, function (num) {
            return '<a href="tel:' + num.replace(/-/g, '') + '" style="color:#93c5fd;text-decoration:underline;white-space:nowrap;">' + num + '</a>';
        });
    }

    /** 폴리곤 feature 하나의 상세 정보 팝업 HTML을 만든다(구역마다 고시 내용이 달라 항목별로 있는 것만 표시) */
    function _buildDetailHtml(hit) {
        var rows = '';
        rows += _row('관할', hit.get('station'));
        rows += _row('고시.공고', hit.get('notice_no'));
        rows += _row('일자', hit.get('date'));
        rows += _row('지정사유', hit.get('reason'));
        rows += _row('소재지', hit.get('address'));
        rows += _row('통제기간', hit.get('control_period'));
        rows += _row('통제시간', hit.get('control_time'));
        rows += _row('대상', hit.get('target'));
        rows += _row('벌칙', hit.get('penalty'));
        rows += _row('문의처', _linkifyPhone(hit.get('contact')));
        rows += _row('상태', hit.get('status'));

        var html = rows ? '<div class="ac-detail-grid">' + rows + '</div>' : '';

        var src = hit.get('source_file');
        if (src) {
            var url = '/api/legal/src?p=' + encodeURIComponent(src);
            var filename = src.split('/').pop().replace(/'/g, '');
            // 관할서마다 실제로 "고시" 또는 "공고"로 다르게 발행하므로(근거 조항은 같지만
            // 행정행위 형식이 다름) 버튼 문구도 원본 파일명을 보고 그대로 맞춘다.
            // (notice_no 필드는 평택 5건이 값 자체에 고시/공고 표기가 없어 source_file 로 판단)
            var docLabel = /고시/.test(src) ? '고시' : '공고';
            // <a download> 는 Capacitor 네이티브 웹뷰에서 그냥 무시된다(ocean_typhoon.js
            // downloadImg() 와 동일한 앱 공통 문제) — 그래서 클릭해도 아무 반응이 없었음.
            // window._accessControlDownloadSrc() 가 네이티브면 시스템 브라우저(@capacitor/browser)로,
            // 아니면 평범한 <a download> 로 내려받게 분기한다.
            html += '<p style="margin-top:18px;text-align:center;">' +
                '<button type="button" class="ac-src-btn" ' +
                'onclick="window._accessControlDownloadSrc(\'' + url + '\', \'' + filename + '\')">' +
                '<i class="fa-solid fa-file-lines"></i> ' + docLabel + ' 원문 다운로드하기</button></p>';
        }
        return html || '<p>세부 정보를 불러오지 못했습니다.</p>';
    }

    /**
     * [외부 API] 고시/공고 원문 파일을 내려받는다. Capacitor 네이티브 웹뷰는 <a download> 를
     * 무시하므로(ocean_typhoon.js downloadImg()·admin_collect.js 와 동일 패턴), 네이티브에서는
     * 시스템 브라우저(@capacitor/browser)로 attachment URL 을 열어 OS 가 받게 하고,
     * 일반 웹에서는 평범한 <a download> 로 처리한다.
     */
    window._accessControlDownloadSrc = function (url, filename) {
        function anchor() {
            var a = document.createElement('a');
            a.href = url; a.download = filename; a.target = '_blank';
            document.body.appendChild(a); a.click(); a.remove();
        }
        var isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
        var Browser = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser;
        if (isNative && Browser && Browser.open) {
            try {
                var p = Browser.open({ url: window.location.origin + url });
                if (p && p.catch) p.catch(anchor);
                return;
            } catch (e) { /* 폴백 */ }
        }
        anchor();
    };

    /**
     * [외부 API] 지도 클릭이 출입통제구역 폴리곤을 눌렀는지 확인한다.
     * @param {ol.Map} map
     * @param {ol.MapBrowserEvent} evt
     * @returns {boolean} true 면 클릭이 소비됨(호출자는 바텀시트 등을 건너뛰어야 함)
     * [연계] ← ocean_map.js handleMapClick — hazard_rocks 다음 우선순위로 호출.
     *        자체 singleclick 리스너를 따로 달지 않는 이유: 그렇게 하면 handleMapClick 의
     *        바텀시트 로직과 같은 클릭에 동시에 반응해버려 팝업+바텀시트가 함께 뜬다.
     */
    window._accessControlTryHandleClick = function (map, evt) {
        if (!_visible || !_fillLayer) return false;
        var hit = map.forEachFeatureAtPixel(evt.pixel, function (feature, layer) {
            if (layer === _fillLayer) return feature;
            return null;
        });
        if (!hit) return false;
        var location = hit.get('location') || '출입통제구역';
        if (typeof window.showSeagnalModal === 'function') {
            window.showSeagnalModal(location, _buildDetailHtml(hit), 'info');
            // 항목 수가 많아 기본 폭(320px)보다 넓게 — 이 팝업에만 적용, 다른 showSeagnalModal 호출부는 그대로
            var modalContent = document.querySelector('#seagnal-custom-modal .seagnal-modal-content');
            if (modalContent) modalContent.classList.add('access-control-wide');
        } else if (typeof window._showOceanToast === 'function') {
            window._showOceanToast((hit.get('station') || '') + ' ' + location, 'bottom', 3000);
        }
        return true;
    };

    function _bindToggle(map) {
        var btn = document.getElementById('ocean-access-control-toggle-btn');
        if (!btn) return;

        var _prevBasemap = null; // OFF 시 원래 배경지도로 되돌리기 위해 ON 시점 값을 기억

        btn.addEventListener('click', function () {
            _visible = !_visible;
            btn.classList.toggle('active', _visible);
            if (_layer) _layer.setVisible(_visible);
            if (_fillLayer) _fillLayer.setVisible(_visible);
            if (_visible) {
                _load();
                // 폴리곤을 실제 지형과 대조해 보기 쉽도록 배경지도를 위성지도로 자동 전환
                // (ocean_warn_active.js 의 "ON 시 배경 전환 → OFF 시 복귀" 와 동일 패턴)
                if (typeof window.oceanGetBasemap === 'function' && typeof window.oceanSetBasemap === 'function') {
                    _prevBasemap = window.oceanGetBasemap();
                    if (_prevBasemap !== 'vworld') window.oceanSetBasemap('vworld');
                }
            } else if (_prevBasemap && _prevBasemap !== 'vworld' && typeof window.oceanSetBasemap === 'function') {
                window.oceanSetBasemap(_prevBasemap);
                _prevBasemap = null;
            }
        });
    }

    /** oceanMap 이 만들어질 때까지 폴링 (ocean_warn_zone.js 와 동일 패턴) */
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
