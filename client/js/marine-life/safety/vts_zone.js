/**
 * ============================================================================
 * 파일명: client/js/marine-life/safety/vts_zone.js
 * 역할  : 해양안전 지도에 "관제구역" 토글 버튼을 얹어, 해양경찰청이 공고한
 *         선박교통관제(VTS)구역 폴리곤을 표시한다. 폴리곤을 탭하면 구역명
 *         (관제통신 채널 포함)·관제해역·관제센터 주소·전화·팩스를 팝업으로 보여주고,
 *         탭한 구역 하나를 "선택됨"으로 하이라이트한다(테두리·채움색이 바뀜).
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
 * [데이터 출처] 해양경찰청(https://www.kcg.go.kr) 전국 20개 VTS센터 페이지의
 *              "관제구역도" 도분초 좌표(WGS-84)와 "관제통신 제원" 표(채널)를 그대로 옮긴
 *              33개 구역. 국립해양조사원 shapefile(TL_VTMSA_A) 은 같은 구역을 영해선 기준
 *              으로 쪼개 놓아 경계가 어긋나 보여, 공식 공고본 기준으로 교체함(2026-08).
 * ============================================================================
 */

(function () {
    'use strict';

    var DATA_URL = '/vts_zones.json';

    // 관제구역이 화면에서 이 크기(px)보다 작으면 "손가락으로 누르기엔 너무 작다"고 보고
    // 선택·팝업 대신 확대부터 한다(fishing_ban.js·seaway.js 와 같은 기준값).
    var MIN_TAPPABLE_PX = 90;
    // 확대 상한 — 관제구역을 켜면 배경이 전자해도(enc)로 자동 전환되고, 해아름 WMS 는
    // 줌 15 까지만 타일을 준다(ocean_map.js 의 MAX_ZOOM). 그보다 더 확대하면
    // 배경이 빈 타일이 되므로 여기서 막는다(seaway.js 와 같은 값).
    var FIT_MAX_ZOOM = 15;

    var _layer = null;       // 외곽선+라벨 layer
    var _fillLayer = null;   // 채움 layer
    var _source = null;
    var _visible = false;
    var _loaded = false;
    var _loading = false;
    var _selected = null;    // 클릭으로 선택된 폴리곤 1개(하이라이트 대상) — 없으면 null

    /**
     * 관제구역 폴리곤 한 벌의 스타일(보라 톤 — 빨강 출입통제·주황 낚시금지와 구분)을 만든다.
     * 선택된 구역(_selected)만 더 밝은 보라(연보라) 톤으로 굵게 그려 "이거 눌렀다"를 보여준다
     * (노란색이 아니라 같은 보라 계열 안에서 밝기로 구분 — 다른 레이어 색과 안 헷갈리게).
     * 예: name='경인연안 VTS(Ch. 71)' → 평소엔 진보라 선 2px, 선택되면 연보라 선 4px + 35% 채움.
     * @param {ol.Feature} feature - 그릴 구역 피처(라벨 문구는 name 속성)
     * @returns {ol.style.Style} 외곽선·채움·라벨이 다 든 스타일 1개
     * [연계] ← _fillOnlyStyle()/_strokeOnlyStyle() — 두 레이어가 이 한 벌을 나눠 쓴다.
     *        모듈 변수 _selected 를 읽어 하이라이트 여부를 정한다(바뀌면
     *        window._vtsZoneTryHandleClick()·_bindToggle() 이 _source.changed() 로 다시 태운다).
     *        feature.setStyle() 을 쓰지 않는 이유: 이 소스는 채움(_fillLayer)·
     *        외곽선(_layer) 두 레이어가 함께 쓰므로 feature 개별 스타일을 주면
     *        두 레이어에 똑같이 두 번 그려진다(채움·라벨 중복).
     */
    function _zoneStyle(feature) {
        var on = (feature === _selected);
        return new ol.style.Style({
            stroke: new ol.style.Stroke({
                color: on ? 'rgba(240, 171, 252, 1)' : 'rgba(168, 85, 247, 0.9)',
                width: on ? 4 : 2
            }),
            fill: new ol.style.Fill({
                color: on ? 'rgba(240, 171, 252, 0.35)' : 'rgba(168, 85, 247, 0.14)'
            }),
            text: new ol.style.Text({
                text: feature.get('name') || '',
                font: 'bold 11px "Pretendard", sans-serif',
                fill: new ol.style.Fill({ color: on ? '#fdf4ff' : '#e9d5ff' }),
                stroke: new ol.style.Stroke({ color: 'rgba(0,0,0,0.85)', width: 3 }),
                overflow: true,
                placement: 'point'
            })
        });
    }

    /**
     * 스타일 한 벌에서 채움만 뽑아 새 스타일을 만든다.
     * 예: _onlyFill(_zoneStyle(f)) → 선·라벨 없이 rgba(168,85,247,0.14) 채움만.
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
     * 예: _onlyStrokeAndText(_zoneStyle(f)) → 채움 없이 보라 선 + '경인연안 VTS(Ch. 71)' 라벨.
     * @param {ol.style.Style} style - _zoneStyle() 이 만든 스타일 한 벌
     * @returns {ol.style.Style} 외곽선·라벨만 든 스타일
     * [연계] ← _strokeOnlyStyle()
     */
    function _onlyStrokeAndText(style) {
        return new ol.style.Style({ stroke: style.getStroke(), text: style.getText() });
    }
    /**
     * 채움 레이어(_fillLayer)의 스타일 함수 — 피처마다 채움만 그린다.
     * 예: _fillOnlyStyle(경인연안 VTS 피처) → 반투명 보라 면 1장(선택 시 노랑).
     * @param {ol.Feature} feature - OpenLayers 가 그릴 때마다 넘겨주는 피처
     * @returns {ol.style.Style|null} 채움만 든 스타일
     * [연계] ← _ensureLayers() 의 _fillLayer style 옵션 → _zoneStyle()·_onlyFill()
     */
    function _fillOnlyStyle(feature) { return _onlyFill(_zoneStyle(feature)); }
    /**
     * 외곽선 레이어(_layer)의 스타일 함수 — 피처마다 선과 라벨만 그린다.
     * 예: _strokeOnlyStyle(경인연안 VTS 피처) → 보라 테두리 + 이름 라벨(선택 시 노랑·굵게).
     * @param {ol.Feature} feature - OpenLayers 가 그릴 때마다 넘겨주는 피처
     * @returns {ol.style.Style} 외곽선·라벨만 든 스타일
     * [연계] ← _ensureLayers() 의 _layer style 옵션 → _zoneStyle()·_onlyStrokeAndText()
     */
    function _strokeOnlyStyle(feature) { return _onlyStrokeAndText(_zoneStyle(feature)); }

    /**
     * 채움·외곽선 두 벡터 레이어를 (아직 없을 때만) 만들어 지도에 얹는다.
     * 예: 첫 호출 → 채움(zIndex 40)·외곽선(zIndex 80, declutter) 레이어 생성, 두 번째 호출부터는 아무 일 없음.
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
                // 구역이 33개인데 이름이 길어("OO VTS(Ch. NN)") 좁은 해역에선 라벨이 겹친다 —
                // 겹치는 라벨은 OpenLayers 가 알아서 생략하게 한다(fishing_ban.js 와 동일).
                declutter: true,
                updateWhileAnimating: false,
                updateWhileInteracting: false
            });
            map.addLayer(_layer);
        }
    }

    /**
     * 정적 GeoJSON 을 내려받아 소스에 채운다(lazy fetch — 버튼을 처음 켤 때만 1회).
     * 예: fetch('/vts_zones.json') → 구역 33개를 EPSG:4326→3857 로 바꿔 _source 에 추가.
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
                console.warn('[VtsZone] GeoJSON 로드 실패:', err.message);
            });
    }

    /**
     * "라벨/값" 2열 grid의 한 행을 만든다 — 값이 없으면 그 행 자체를 만들지 않는다.
     * 예: _row('팩스', '032-728-8956') → '<span class="ac-detail-label">팩스</span><span class="ac-detail-value">032-728-8956</span>'
     * @param {string} label - 왼쪽 라벨(예: '관제해역', '관제센터')
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
     * 전화 문자열 속 번호를 tel: 링크로 바꿔 탭하면 바로 전화 걸리게 한다.
     * 예: '032-728-8456(사무실), 8656(관제실)'
     *     → '<a href="tel:0327288456">032-728-8456</a>(사무실), 8656(관제실)'
     * @param {string} text - 원문 전화 문자열(번호가 없으면 그대로 돌려준다)
     * @returns {string} 전화번호만 <a> 로 감싼 HTML
     * [연계] ← _buildDetailHtml() 의 '전화' 행
     *        (access_control.js 의 _linkifyPhone 과 같은 동작. 해양경찰청 원문이 "051)664-2750"
     *         처럼 지역번호 뒤에 괄호를 쓰는 곳이 있어 그 형태도 함께 잡는다.
     *         "041-950-2550, 2650" 처럼 뒷자리만 나열된 번호는 지역번호가 없어 링크 대상이 아니다)
     */
    function _linkifyPhone(text) {
        if (!text) return text;
        return text.replace(/(\d{2,3}[-)]\d{3,4}-\d{4})/g, function (num) {
            return '<a href="tel:' + num.replace(/[^\d]/g, '') + '" style="color:#93c5fd;text-decoration:underline;white-space:nowrap;">' + num + '</a>';
        });
    }

    /**
     * 폴리곤 feature 하나의 상세 정보 팝업 HTML을 만든다(값이 있는 항목만 표시).
     * 예: '경인연안 VTS(Ch. 71)' 피처 → 관제해역('덕적도에서 백령도에 이르는 해역')·관제센터·전화·팩스 표.
     * @param {ol.Feature} hit - 클릭으로 잡힌 구역 피처
     * @returns {string} 팝업 본문 HTML(항목이 하나도 없으면 안내 문구)
     * [연계] ← window._vtsZoneTryHandleClick() → _row()·_linkifyPhone()
     *        구역명(name)은 팝업 제목으로 이미 쓰이므로 여기서는 넣지 않는다.
     */
    function _buildDetailHtml(hit) {
        var rows = '';
        rows += _row('관제해역', hit.get('description'));
        rows += _row('관제센터', hit.get('address'));
        rows += _row('전화', _linkifyPhone(hit.get('tel')));
        rows += _row('팩스', hit.get('fax'));

        return rows ? '<div class="ac-detail-grid">' + rows + '</div>'
                    : '<p>세부 정보를 불러오지 못했습니다.</p>';
    }

    /**
     * [외부 API] 지도 클릭이 선박교통관제구역 폴리곤을 눌렀는지 확인한다.
     * 구역이 화면에서 얼마나 크게 보이는지에 따라 갈린다.
     * 예1: 줌아웃 상태에서 작게 보이는 구역을 탭 → 선택·팝업 없이 그 구역 범위로 지도를
     *      확대하고 true 반환(무엇을 눌렀는지 애매하니 확대부터 — 커진 뒤 다시 탭하면 선택).
     * 예2: 충분히 크게 보일 때 첫 탭 → 연보라 하이라이트만, true(클릭 소비, 팝업 없음).
     *      같은 폴리곤 다시 탭 → 상세 팝업(두 단계 — 한 번의 탭으로 바로 팝업이 뜨면
     *      화면 전환이 급작스러워 하이라이트를 먼저 보여준다).
     * @param {ol.Map} map
     * @param {ol.MapBrowserEvent} evt
     * @returns {boolean} true 면 클릭이 소비됨(호출자는 바텀시트 등을 건너뛰어야 함 —
     *                    확대만 한 경우도 true 라 바텀시트가 같이 뜨지 않는다)
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

        // 화면상 크기(px) = 지오메트리 범위(m, EPSG:3857) ÷ 해상도(m/px).
        // 선택 여부보다 먼저 판정한다 — 작을 땐 하이라이트 없이 확대만 해서 다음 탭을 정확하게.
        var extent = hit.getGeometry() && hit.getGeometry().getExtent();
        var resolution = map.getView().getResolution();
        if (extent && resolution) {
            var widthPx = (extent[2] - extent[0]) / resolution;
            var heightPx = (extent[3] - extent[1]) / resolution;
            if (widthPx < MIN_TAPPABLE_PX && heightPx < MIN_TAPPABLE_PX) {
                map.getView().fit(extent, {
                    padding: [80, 80, 80, 80],
                    duration: 400,
                    // 좁은 구역이 전자해도 타일 한계 너머로 과확대되는 걸 막는 상한
                    maxZoom: FIT_MAX_ZOOM
                });
                return true;   // 확대만 하고 선택·팝업은 하지 않는다(클릭은 소비)
            }
        }

        if (_selected !== hit) {
            // 처음 누른 구역(또는 다른 구역으로 옮겨감) — 하이라이트만 하고 팝업은 다음 탭에.
            _selected = hit;
            if (_source) _source.changed();   // 두 레이어의 스타일 함수를 다시 태운다
            return true;
        }
        // 이미 선택돼 있던 구역을 다시 탭 — 상세 팝업 표시.
        var name = hit.get('name') || '선박교통관제구역';
        if (typeof window.showSeagnalModal === 'function') {
            window.showSeagnalModal(name, _buildDetailHtml(hit), 'info');
            // 관제센터 주소가 길어 기본 폭(320px)보다 넓게 — 출입통제 팝업과 같은 클래스를 재사용
            var modalContent = document.querySelector('#seagnal-custom-modal .seagnal-modal-content');
            if (modalContent) modalContent.classList.add('access-control-wide');
        } else if (typeof window._showOceanToast === 'function') {
            window._showOceanToast(name, 'bottom', 3000);
        }
        return true;
    };

    /**
     * "관제구역" 토글 버튼에 ON/OFF 클릭 동작을 붙인다.
     * 예: 버튼 탭 → active 표시 + 폴리곤 표시 + 데이터 로드 + 배경지도 전자해도(enc) 전환, 다시 탭하면 되돌림.
     * @param {ol.Map} map - 해양지도 인스턴스(자매 파일과 시그니처를 맞춘 것 — 여기선 쓰지 않는다)
     * [연계] ← _installWhenReady()
     *        → _load(), ocean_map.js 의 window.oceanGetBasemap()/oceanSetBasemap().
     *        껐다 켤 때 _selected 를 비워 하이라이트를 초기화한다(_zoneStyle 이 읽는 값).
     */
    function _bindToggle(map) {
        var btn = document.getElementById('ocean-vts-toggle-btn');
        if (!btn) return;

        var _prevBasemap = null; // OFF 시 원래 배경지도로 되돌리기 위해 ON 시점 값을 기억

        btn.addEventListener('click', function () {
            _visible = !_visible;
            btn.classList.toggle('active', _visible);
            _selected = null;   // 껐다 켜면 선택 하이라이트는 초기화
            if (_source) _source.changed();
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

    /**
     * oceanMap 이 만들어질 때까지 250ms 간격으로 기다렸다가 레이어와 토글 버튼을 설치한다.
     * 예: 앱 부팅 직후엔 지도가 없어 몇 번 재시도 → 지도가 생기면 설치하고 폴링을 멈춘다.
     * [연계] ← DOMContentLoaded(이미 로드됐으면 즉시) → _ensureLayers()·_bindToggle()
     *        (fishing_ban.js 와 동일 패턴 — 지도 생성을 알리는 이벤트가 없어 폴링한다)
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
