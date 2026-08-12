/**
 * ============================================================================
 * 파일명: client/js/marine-life/safety/seaway.js
 * 역할  : 해양안전 지도에 "항로·해역" 토글 버튼을 얹어, 선박의 입항 및 출항 등에 관한
 *         법률 제10조·해상교통안전법 제30조 등에 따라 지정ㆍ고시된 항로(선박 출입
 *         통로)와, 한중·한일 어업협정으로 정해진 국제 해양경계 수역을 함께 표시한다.
 *         면(面)으로 고시된 항로·해역은 폴리곤, 통항분리대처럼 선(線)
 *         으로 고시된 항로는 선으로 그린다. 탭하면 이름·정의·근거·종류·참고문서·
 *         참고사이트·담당부서·연락처 중 있는 항목을 팝업으로 보여준다.
 *         줌아웃 상태라 항로가 너무 작으면(라벨만 보이는 상태) 탭했을 때 팝업 대신
 *         그 항로 범위로 지도를 먼저 확대하고, 커진 뒤 다시 탭하면 팝업이 뜬다.
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
 *              여기에 한중어업협정·한일어업협정에 따른 국제 해양경계 수역 3개
 *              (한중잠정조치수역·한일중간수역·한중과도수역, category='해역')를
 *              2026-08 에 더해 모두 144개다. 이 3개에만 정의·근거·담당부서·연락처
 *              항목이 있어 팝업 행이 더 나온다(WFS 141개엔 그 항목이 없다).
 * ============================================================================
 */

(function () {
    'use strict';

    var DATA_URL = '/seaway_zones.json';

    // 항로가 화면에서 이 크기(px)보다 작으면 "손가락으로 누르기엔 너무 작다"고 보고
    // 팝업 대신 확대부터 한다. 라벨 글자가 11px 이라 이보다 작아지면 항로가 라벨에
    // 가려 어디를 눌러야 할지 알 수 없다(fishing_ban.js 와 같은 기준값).
    var MIN_TAPPABLE_PX = 90;
    // 확대 상한 — 항로를 켜면 배경이 전자해도(enc)로 자동 전환되고, 해아름 WMS 는
    // 줌 15 까지만 타일을 준다(ocean_map.js 의 MAX_ZOOM). 그보다 더 확대하면
    // 배경이 빈 타일이 되므로 여기서 막는다.
    var FIT_MAX_ZOOM = 15;

    var _layer = null;       // 외곽선+라벨 layer
    var _fillLayer = null;   // 채움 layer
    var _source = null;
    var _visible = false;
    var _loaded = false;
    var _loading = false;

    // 국내 항로(141곳) 색 — 마젠타. 전자해도에서 통항분리대 경계에 흔히 쓰이는 색 계열이라
    // 배경(enc)과 자연스럽게 어울리고, 보라인 관제구역(#A855F7)과도 톤이 갈려 구분된다.
    var SEAWAY_COLOR = 'rgba(162, 28, 175, 0.9)';
    var SEAWAY_FILL = 'rgba(162, 28, 175, 0.14)';
    var SEAWAY_TEXT = '#f5d0fe';
    // 국제 해양경계 수역(3곳, category='해역') 색 — 선홍. 항로 마젠타·관제구역 보라·
    // 낚시금지 주황 어디와도 겹치지 않게 뚜렷이 구분한다.
    var INTL_COLOR = 'rgba(220, 38, 38, 0.9)';
    var INTL_FILL = 'rgba(220, 38, 38, 0.14)';
    var INTL_TEXT = '#fecaca';

    /**
     * 선(線)으로 고시된 항로인지 판별한다 — 통항분리대 등 17개가 MultiLineString 이다.
     * 예: 면 항로 '광양만'(MultiPolygon) → false, 통항분리대(MultiLineString) → true.
     * @param {ol.Feature} feature - 판별할 항로 피처
     * @returns {boolean} 선 항로면 true
     * [연계] ← _fillOnlyStyle()(채움이 없으니 채움 레이어에서 뺀다)·
     *        window._seawayTryHandleClick()(클릭 판정을 외곽선 레이어에서 보조로 한다)
     */
    function _isLine(feature) {
        var t = feature.getGeometry() && feature.getGeometry().getType();
        return t === 'LineString' || t === 'MultiLineString';
    }

    /**
     * 항로 한 벌의 스타일을 만든다 — 국내 항로(141곳)는 마젠타 톤, 국제 해양경계 수역
     * (3곳, category='해역')은 선홍 톤으로 구분한다.
     * 예: name='광양만'(항로) → 마젠타 외곽선 2px + 14% 채움. name='한중잠정조치수역'(해역) → 선홍.
     * @param {ol.Feature} feature - 그릴 항로 피처(라벨 문구는 name 속성)
     * @returns {ol.style.Style} 외곽선·채움·라벨이 다 든 스타일 1개
     * [연계] ← _fillOnlyStyle()/_strokeOnlyStyle() — 두 레이어가 이 한 벌을 나눠 쓴다
     */
    function _zoneStyle(feature) {
        var isIntl = feature.get('category') === '해역';
        return new ol.style.Style({
            stroke: new ol.style.Stroke({
                color: isIntl ? INTL_COLOR : SEAWAY_COLOR,
                width: 2
            }),
            fill: new ol.style.Fill({
                color: isIntl ? INTL_FILL : SEAWAY_FILL
            }),
            text: new ol.style.Text({
                text: feature.get('name') || '',
                font: 'bold 11px "Pretendard", sans-serif',
                fill: new ol.style.Fill({ color: isIntl ? INTL_TEXT : SEAWAY_TEXT }),
                stroke: new ol.style.Stroke({ color: 'rgba(0,0,0,0.85)', width: 3 }),
                overflow: true,
                placement: 'point'
            })
        });
    }

    /**
     * 스타일 한 벌에서 채움만 뽑아 새 스타일을 만든다.
     * 예: _onlyFill(_zoneStyle(f)) → 선·라벨 없이 rgba(162,28,175,0.14) 채움만.
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
     * 예: _onlyStrokeAndText(_zoneStyle(f)) → 채움 없이 마젠타 선 + '광양만' 라벨.
     * @param {ol.style.Style} style - _zoneStyle() 이 만든 스타일 한 벌
     * @returns {ol.style.Style} 외곽선·라벨만 든 스타일
     * [연계] ← _strokeOnlyStyle()
     */
    function _onlyStrokeAndText(style) {
        return new ol.style.Style({ stroke: style.getStroke(), text: style.getText() });
    }
    /**
     * 채움 레이어(_fillLayer)의 스타일 함수 — 면 항로만 채우고 선 항로는 건너뛴다.
     * 예: _fillOnlyStyle('광양만' 면 항로) → 반투명 마젠타 면, 통항분리대 선 항로 → null.
     * @param {ol.Feature} feature - OpenLayers 가 그릴 때마다 넘겨주는 피처
     * @returns {ol.style.Style|null} 채움만 든 스타일(선 항로는 채울 것이 없어 null)
     * [연계] ← _ensureLayers() 의 _fillLayer style 옵션 → _isLine()·_zoneStyle()·_onlyFill()
     */
    function _fillOnlyStyle(feature) { return _isLine(feature) ? null : _onlyFill(_zoneStyle(feature)); }
    /**
     * 외곽선 레이어(_layer)의 스타일 함수 — 면·선 항로 둘 다 같은 색 계열의 선과 라벨로 그린다.
     * 예: _strokeOnlyStyle(통항분리대 선 항로) → 마젠타 선 + 이름 라벨(선 항로는 이 레이어에만 보인다).
     * @param {ol.Feature} feature - OpenLayers 가 그릴 때마다 넘겨주는 피처
     * @returns {ol.style.Style} 외곽선·라벨만 든 스타일
     * [연계] ← _ensureLayers() 의 _layer style 옵션 → _zoneStyle()·_onlyStrokeAndText()
     */
    function _strokeOnlyStyle(feature) { return _onlyStrokeAndText(_zoneStyle(feature)); }

    /**
     * 채움·외곽선 두 벡터 레이어를 (아직 없을 때만) 만들어 지도에 얹는다.
     * 예: 첫 호출 → 채움(zIndex 43)·외곽선(zIndex 83, declutter) 레이어 생성, 두 번째 호출부터는 아무 일 없음.
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
                // 항로·해역이 144개인데 좁고 길게 붙어 있어("OO항 제1항로") 라벨이 겹친다 —
                // 겹치는 라벨은 OpenLayers 가 알아서 생략하게 한다(vts_zone.js 와 동일).
                declutter: true,
                updateWhileAnimating: false,
                updateWhileInteracting: false
            });
            map.addLayer(_layer);
        }
    }

    /**
     * 정적 GeoJSON 을 내려받아 소스에 채운다(lazy fetch — 버튼을 처음 켤 때만 1회).
     * 예: fetch('/seaway_zones.json') → 항로·해역 144개(면 127·선 17)를 EPSG:4326→3857 로 바꿔 _source 에 추가.
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
                console.warn('[Seaway] GeoJSON 로드 실패:', err.message);
            });
    }

    /**
     * "라벨/값" 2열 grid의 한 행을 만든다 — 값이 없으면 그 행 자체를 만들지 않는다.
     * 예: _row('종류', '주의해역') → '<span class="ac-detail-label">종류</span><span class="ac-detail-value">주의해역</span>'
     * @param {string} label - 왼쪽 라벨(예: '참고문서', '참고사이트')
     * @param {string} value - 오른쪽 값 — 비어 있으면 행을 만들지 않는다
     * @returns {string} 행 2칸의 HTML(값이 없으면 빈 문자열)
     * [연계] ← _buildDetailHtml()
     *        (CSS 는 출입통제 팝업과 같은 .ac-detail-* 을 그대로 재사용 — 모양이 동일하다)
     */
    function _row(label, value) {
        if (!value) return '';
        return '<span class="ac-detail-label">' + label + '</span><span class="ac-detail-value">' + value + '</span>';
    }

    /**
     * 참고사이트 URL 을 그대로 클릭 가능한 링크로 감싼다(원문 법령 페이지로 이동).
     * 예: 'https://www.law.go.kr/법령/해상교통안전법'
     *     → '<a href="https://www.law.go.kr/법령/해상교통안전법" target="_blank" …>같은 주소</a>'
     * @param {string} url - 원문 URL(없으면 그대로 돌려준다)
     * @returns {string} 새 탭으로 열리는 <a> HTML
     * [연계] ← _buildDetailHtml() 의 '참고사이트' 행
     */
    function _linkifyUrl(url) {
        if (!url) return url;
        return '<a href="' + url + '" target="_blank" rel="noopener" ' +
               'style="color:#93c5fd;text-decoration:underline;word-break:break-all;font-size:0.9em;">' + url + '</a>';
    }

    /**
     * 전화 문자열 속 번호를 tel: 링크로 바꿔 탭하면 바로 전화 걸리게 한다.
     * 예: '02-2100-7532' → '<a href="tel:0221007532">02-2100-7532</a>'
     * @param {string} text - 원문 전화 문자열(번호가 없으면 그대로 돌려준다)
     * @returns {string} 전화번호만 <a> 로 감싼 HTML
     * [연계] ← _buildDetailHtml() 의 '연락처' 행
     *        (vts_zone.js·access_control.js 의 _linkifyPhone 과 같은 동작)
     */
    function _linkifyPhone(text) {
        if (!text) return text;
        return text.replace(/(\d{2,3}[-)]\d{3,4}-\d{4})/g, function (num) {
            return '<a href="tel:' + num.replace(/[^\d]/g, '') + '" style="color:#93c5fd;text-decoration:underline;white-space:nowrap;">' + num + '</a>';
        });
    }

    /**
     * feature 하나의 상세 정보 팝업 HTML을 만든다(값이 있는 항목만 표시).
     * 예1: '광양만' 항로 → 종류('주의해역')·참고문서('[별표 2] 교통안전특정해역 지정항로의 범위')·참고사이트 표.
     * 예2: '한중잠정조치수역' 해역 → 정의·근거('한.중 어업협정 제7조')·종류('해역')·참고문서·담당부서·연락처 표.
     * @param {ol.Feature} hit - 클릭으로 잡힌 항로/해역 피처
     * @returns {string} 팝업 본문 HTML(항목이 하나도 없으면 안내 문구)
     * [연계] ← window._seawayTryHandleClick() → _row()·_linkifyUrl()·_linkifyPhone()
     *        WFS 항로 141개엔 종류·참고문서·참고사이트만 있어 그 세 행만 나오고,
     *        국제 해양경계 수역 3개는 정의·근거·담당부서·연락처 행이 함께 나온다
     *        (_row() 가 값 없는 행을 통째로 빼므로 별도 분기가 필요 없다).
     */
    function _buildDetailHtml(hit) {
        var rows = '';
        rows += _row('정의', hit.get('definition'));
        rows += _row('근거', hit.get('law'));
        rows += _row('종류', hit.get('category'));
        rows += _row('참고문서', hit.get('reference_doc'));
        rows += _row('참고사이트', _linkifyUrl(hit.get('reference_url')));
        rows += _row('담당부서', hit.get('dept'));
        rows += _row('연락처', _linkifyPhone(hit.get('dept_tel')));

        return rows ? '<div class="ac-detail-grid">' + rows + '</div>'
                    : '<p>세부 정보를 불러오지 못했습니다.</p>';
    }

    /**
     * [외부 API] 지도 클릭이 항로(또는 그 이름 라벨)를 눌렀는지 확인한다.
     * 항로가 화면에서 얼마나 크게 보이는지에 따라 두 갈래로 나뉜다.
     * 예1: 줌아웃 상태에서 '광양만' 라벨을 탭 → 팝업 없이 그 항로 범위로 지도를
     *      확대하고 true 반환(확대만 하고 끝 — 커진 뒤 다시 탭하면 팝업).
     * 예2: 이미 확대돼 항로가 크게 보일 때 탭 → 상세 팝업을 띄우고 true 반환.
     * @param {ol.Map} map
     * @param {ol.MapBrowserEvent} evt
     * @returns {boolean} true 면 클릭이 소비됨(호출자는 바텀시트 등을 건너뛰어야 함 —
     *                    확대만 한 경우도 true 라 바텀시트가 같이 뜨지 않는다)
     * [연계] ← ocean_map.js handleMapClick — 관제구역 다음 우선순위로 호출.
     *        → _buildDetailHtml()
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

        // 화면상 크기(px) = 지오메트리 범위(m, EPSG:3857) ÷ 해상도(m/px)
        // 선 항로도 extent(바운딩박스)로 재므로 면·선을 같은 식으로 판정할 수 있다.
        var extent = hit.getGeometry() && hit.getGeometry().getExtent();
        var resolution = map.getView().getResolution();
        if (extent && resolution) {
            var widthPx = (extent[2] - extent[0]) / resolution;
            var heightPx = (extent[3] - extent[1]) / resolution;
            if (widthPx < MIN_TAPPABLE_PX && heightPx < MIN_TAPPABLE_PX) {
                map.getView().fit(extent, {
                    padding: [80, 80, 80, 80],
                    duration: 400,
                    // 짧은 항로가 전자해도 타일 한계 너머로 과확대되는 걸 막는 상한
                    maxZoom: FIT_MAX_ZOOM
                });
                return true;   // 확대만 하고 팝업은 띄우지 않는다(클릭은 소비)
            }
        }

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

    /**
     * "항로·해역" 토글 버튼에 ON/OFF 클릭 동작을 붙인다.
     * 예: 버튼 탭 → active 표시 + 항로·해역 표시 + 데이터 로드 + 배경지도 전자해도(enc) 전환, 다시 탭하면 되돌림.
     * @param {ol.Map} map - 해양지도 인스턴스(자매 파일과 시그니처를 맞춘 것 — 여기선 쓰지 않는다)
     * [연계] ← _installWhenReady()
     *        → _load(), ocean_map.js 의 window.oceanGetBasemap()/oceanSetBasemap()
     */
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

    /**
     * oceanMap 이 만들어질 때까지 250ms 간격으로 기다렸다가 레이어와 토글 버튼을 설치한다.
     * 예: 앱 부팅 직후엔 지도가 없어 몇 번 재시도 → 지도가 생기면 설치하고 폴링을 멈춘다.
     * [연계] ← DOMContentLoaded(이미 로드됐으면 즉시) → _ensureLayers()·_bindToggle()
     *        (vts_zone.js 와 동일 패턴 — 지도 생성을 알리는 이벤트가 없어 폴링한다)
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
