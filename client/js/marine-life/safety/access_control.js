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

    /**
     * 출입통제구역 폴리곤 한 벌의 스타일(빨간 톤 — 해도상 출입통제 표기 관례와 동일)을 만든다.
     * 예: location='영흥도 내리 갯벌' → 빨간 외곽선 2px + 15% 채움 + 그 이름 라벨.
     * @param {ol.Feature} feature - 그릴 구역 피처(라벨 문구는 location 속성)
     * @returns {ol.style.Style} 외곽선·채움·라벨이 다 든 스타일 1개
     * [연계] ← _fillOnlyStyle()/_strokeOnlyStyle() — 두 레이어가 이 한 벌을 나눠 쓴다
     */
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

    /**
     * 스타일 한 벌에서 채움만 뽑아 새 스타일을 만든다.
     * 예: _onlyFill(_zoneStyle(f)) → 선·라벨 없이 rgba(255,82,82,0.15) 채움만.
     * @param {ol.style.Style} style - _zoneStyle() 이 만든 스타일 한 벌
     * @returns {ol.style.Style|null} 채움만 든 스타일 — 채울 것이 없으면 null(안 그림)
     * [연계] ← _fillOnlyStyle()
     */
    function _onlyFill(style) {
        var f = style.getFill();
        if (!f) return null;
        return new ol.style.Style({ fill: f });
    }
    /**
     * 스타일 한 벌에서 외곽선과 라벨만 뽑아 새 스타일을 만든다.
     * 예: _onlyStrokeAndText(_zoneStyle(f)) → 채움 없이 빨간 선 + '영흥도 내리 갯벌' 라벨.
     * @param {ol.style.Style} style - _zoneStyle() 이 만든 스타일 한 벌
     * @returns {ol.style.Style} 외곽선·라벨만 든 스타일
     * [연계] ← _strokeOnlyStyle()
     */
    function _onlyStrokeAndText(style) {
        return new ol.style.Style({ stroke: style.getStroke(), text: style.getText() });
    }
    /**
     * 채움 레이어(_fillLayer)의 스타일 함수 — 피처마다 채움만 그린다.
     * 예: _fillOnlyStyle(영흥도 갯벌 피처) → 반투명 빨간 면 1장.
     * @param {ol.Feature} feature - OpenLayers 가 그릴 때마다 넘겨주는 피처
     * @returns {ol.style.Style|null} 채움만 든 스타일
     * [연계] ← _ensureLayers() 의 _fillLayer style 옵션 → _zoneStyle()·_onlyFill()
     */
    function _fillOnlyStyle(feature) { return _onlyFill(_zoneStyle(feature)); }
    /**
     * 외곽선 레이어(_layer)의 스타일 함수 — 피처마다 선과 라벨만 그린다.
     * 예: _strokeOnlyStyle(영흥도 갯벌 피처) → 빨간 테두리 + 이름 라벨.
     * @param {ol.Feature} feature - OpenLayers 가 그릴 때마다 넘겨주는 피처
     * @returns {ol.style.Style} 외곽선·라벨만 든 스타일
     * [연계] ← _ensureLayers() 의 _layer style 옵션 → _zoneStyle()·_onlyStrokeAndText()
     */
    function _strokeOnlyStyle(feature) { return _onlyStrokeAndText(_zoneStyle(feature)); }

    /**
     * 채움·외곽선 두 벡터 레이어를 (아직 없을 때만) 만들어 지도에 얹는다.
     * 예: 첫 호출 → 채움(zIndex 42)·외곽선(zIndex 82) 레이어 생성, 두 번째 호출부터는 아무 일 없음.
     * @param {ol.Map} map - 레이어를 얹을 해양지도 인스턴스
     * [연계] ← _installWhenReady() — 지도가 준비된 뒤 1회.
     *        레이어를 둘로 나누는 이유: 채움은 다른 오버레이 아래에 깔되 라벨·외곽선은
     *        그 위로 보여야 해서 zIndex 를 따로 줘야 한다.
     */
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

    /**
     * 정적 GeoJSON 을 내려받아 소스에 채운다(lazy fetch — 버튼을 처음 켤 때만 1회).
     * 예: fetch('/access_control_zones.json') → 구역 18개를 EPSG:4326→3857 로 바꿔 _source 에 추가.
     * [연계] ← _bindToggle() 의 ON 핸들러. 이미 받았거나(_loaded) 받는 중(_loading)이면 즉시 되돌아온다.
     */
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

    /**
     * "라벨/값" 2열 grid의 한 행을 만든다 — 값이 없으면 그 행 자체를 만들지 않는다.
     * 예: _row('문의처', '032-650-2348') → '<span class="ac-detail-label">문의처</span><span class="ac-detail-value">032-650-2348</span>'
     * @param {string} label - 왼쪽 라벨(예: '관할', '통제시간')
     * @param {string} value - 오른쪽 값 — 비어 있으면 행을 만들지 않는다
     * @returns {string} 행 2칸의 HTML(값이 없으면 빈 문자열)
     * [연계] ← _buildDetailHtml()
     *        (grid-template-columns: max-content 1fr 이라 값이 줄바꿈되면 값 칸의
     *         왼쪽 끝, 즉 라벨 다음 위치에 자동으로 맞춰 정렬된다)
     */
    function _row(label, value) {
        if (!value) return '';
        return '<span class="ac-detail-label">' + label + '</span><span class="ac-detail-value">' + value + '</span>';
    }

    /**
     * 문의처 문자열 속 전화번호를 tel: 링크로 바꿔 탭하면 바로 전화 걸리게 한다.
     * 예: '인천해양경찰서 해양안전과 안전관리계 032-650-2348'
     *     → '인천해양경찰서 … <a href="tel:0326502348">032-650-2348</a>'
     * @param {string} text - 원문 문의처 문자열(번호가 없으면 그대로 돌려준다)
     * @returns {string} 전화번호만 <a> 로 감싼 HTML
     * [연계] ← _buildDetailHtml() 의 '문의처' 행
     */
    function _linkifyPhone(text) {
        if (!text) return text;
        return text.replace(/(\d{2,3}-\d{3,4}-\d{4})/g, function (num) {
            return '<a href="tel:' + num.replace(/-/g, '') + '" style="color:#93c5fd;text-decoration:underline;white-space:nowrap;">' + num + '</a>';
        });
    }

    /**
     * 폴리곤 feature 하나의 상세 정보 팝업 HTML을 만든다(구역마다 고시 내용이 달라 항목별로 있는 것만 표시).
     * 예: '영흥도 내리 갯벌' 피처 → 관할·고시.공고·통제시간·벌칙… 표 + "공고 원문 다운로드하기" 버튼.
     * @param {ol.Feature} hit - 클릭으로 잡힌 구역 피처
     * @returns {string} 팝업 본문 HTML(항목이 하나도 없으면 안내 문구)
     * [연계] ← window._accessControlTryHandleClick()
     *        → _row()·_linkifyPhone(), 버튼은 window._accessControlDownloadSrc() 를 부른다
     */
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
     * 예: ('/api/legal/src?p=…공고제2025-2호….pdf', '[inchon_66183]….pdf') → 그 PDF 저장.
     * @param {string} url - 서버의 원문 파일 URL(/api/legal/src?p=…)
     * @param {string} filename - 저장될 파일명
     * [연계] ← _buildDetailHtml() 이 심어 둔 "원문 다운로드하기" 버튼의 onclick
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
     * 예: '영흥도 내리 갯벌' 폴리곤을 탭 → 상세 팝업을 띄우고 true 반환(바텀시트는 안 뜬다).
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
            // 채움이 없는 선(LineString, 예: 용수리 가~나 통제경계선)은 _fillLayer로는
            // 못 잡으므로 외곽선 레이어(_layer)에서 보조로 판정 — 폴리곤은 이미 위에서
            // _fillLayer 판정으로 잡히므로 여기선 LineString feature만 추가로 본다.
            if (layer === _layer && feature.getGeometry().getType() === 'LineString') return feature;
            return null;
        }, { hitTolerance: 6 });
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

    /**
     * "출입통제" 토글 버튼에 ON/OFF 클릭 동작을 붙인다.
     * 예: 버튼 탭 → active 표시 + 폴리곤 표시 + 데이터 로드 + 배경지도 위성(vworld) 전환, 다시 탭하면 되돌림.
     * @param {ol.Map} map - 해양지도 인스턴스(자매 파일과 시그니처를 맞춘 것 — 여기선 쓰지 않는다)
     * [연계] ← _installWhenReady()
     *        → _load(), ocean_map.js 의 window.oceanGetBasemap()/oceanSetBasemap()
     */
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

    /**
     * oceanMap 이 만들어질 때까지 250ms 간격으로 기다렸다가 레이어와 토글 버튼을 설치한다.
     * 예: 앱 부팅 직후엔 지도가 없어 몇 번 재시도 → 지도가 생기면 설치하고 폴링을 멈춘다.
     * [연계] ← DOMContentLoaded(이미 로드됐으면 즉시) → _ensureLayers()·_bindToggle()
     *        (ocean_warn_zone.js 와 동일 패턴 — 지도 생성을 알리는 이벤트가 없어 폴링한다)
     */
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
