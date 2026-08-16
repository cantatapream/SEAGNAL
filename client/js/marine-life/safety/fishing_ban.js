/**
 * ============================================================================
 * 파일명: client/js/marine-life/safety/fishing_ban.js
 * 역할  : 해양안전 지도에 "낚시금지" 토글 버튼을 얹어, 낚시 관리 및 육성법
 *         제6조(지자체 조례 포함)에 따라 지정된 낚시통제(금지)구역 폴리곤을
 *         표시한다. 폴리곤을 탭하면 구역명·근거법령·통제시간·벌칙을 팝업으로 보여준다.
 *         줌아웃 상태라 구역이 너무 작으면(라벨만 보이는 상태) 탭했을 때 팝업 대신
 *         그 구역 범위로 지도를 먼저 확대하고, 커진 뒤 다시 탭하면 팝업이 뜬다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : ocean-map/map/ocean_map.js(window.getOceanMap), OpenLayers(ol.*)
 *  - 서버 API      : 없음 — /fishing_ban_zones.json 정적 파일(지연 로드)
 *  - 마크업        : index2.html #ocean-fishing-ban-toggle-btn — 해양안전 전용
 *  - 나를 쓰는 곳  : 토글 버튼은 이 파일이 자체 바인딩(access_control.js 와 동일 패턴).
 *                    폴리곤 클릭은 ocean_map.js의 handleMapClick 이
 *                    window._fishingBanTryHandleClick(map, evt) 를 호출
 *                    (access_control.js 의 _accessControlTryHandleClick 다음 순위 —
 *                    이래야 해양종합정보 바텀시트가 같은 클릭에 같이 뜨는 걸 막는다)
 * [로드 순서] access_control.js 다음 · life_safety.js 바로 앞 (marine-life/safety 그룹)
 * [데이터 출처] 국립해양조사원 해양공간 주제도 "낚시통제구역"(TL_RESARE_ENS) shapefile
 *              236개 폴리곤을 EPSG:5179 → WGS84 로 재투영해 GeoJSON 으로 변환한 것.
 * ============================================================================
 */

(function () {
    'use strict';

    var DATA_URL = '/fishing_ban_zones.json';

    // 구역이 화면에서 이 크기(px)보다 작으면 "손가락으로 누르기엔 너무 작다"고 보고
    // 팝업 대신 확대부터 한다. 라벨 글자가 11px 이라 이보다 작아지면 폴리곤이 라벨에
    // 가려 어디를 눌러야 할지 알 수 없다(값이 클수록 더 자주 확대됨 — 조정용 상수).
    var MIN_TAPPABLE_PX = 90;
    // 확대 상한 — 낚시금지를 켜면 배경이 위성지도(vworld)로 자동 전환되므로 그 타일
    // 한계(19)에 맞춰야 확대가 중간에 막히지 않는다. 못 읽으면 안전하게 18.
    var FIT_MAX_ZOOM = 18;

    var _layer = null;       // 외곽선+라벨 layer
    var _fillLayer = null;   // 채움 layer
    var _source = null;
    var _visible = false;
    var _loaded = false;
    var _loading = false;

    /**
     * 낚시금지구역 폴리곤 한 벌의 스타일(주황 톤 — 빨강인 출입통제·간출암 경고와 구분)을 만든다.
     * 예: name='국동 대경도 선착장' → 주황 외곽선 2px + 18% 채움 + 그 이름 라벨.
     * @param {ol.Feature} feature - 그릴 구역 피처(라벨 문구는 name 속성)
     * @returns {ol.style.Style} 외곽선·채움·라벨이 다 든 스타일 1개
     * [연계] ← _fillOnlyStyle()/_strokeOnlyStyle() — 두 레이어가 이 한 벌을 나눠 쓴다
     */
    function _zoneStyle(feature) {
        return new ol.style.Style({
            stroke: new ol.style.Stroke({
                color: 'rgba(255, 152, 0, 0.9)',
                width: 2
            }),
            fill: new ol.style.Fill({
                color: 'rgba(255, 152, 0, 0.18)'
            }),
            text: new ol.style.Text({
                text: feature.get('name') || '',
                font: 'bold 11px "Pretendard", sans-serif',
                fill: new ol.style.Fill({ color: '#ffd699' }),
                stroke: new ol.style.Stroke({ color: 'rgba(0,0,0,0.85)', width: 3 }),
                overflow: true,
                placement: 'point'
            })
        });
    }

    /**
     * 스타일 한 벌에서 채움만 뽑아 새 스타일을 만든다.
     * 예: _onlyFill(_zoneStyle(f)) → 선·라벨 없이 rgba(255,152,0,0.18) 채움만.
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
     * 예: _onlyStrokeAndText(_zoneStyle(f)) → 채움 없이 주황 선 + '국동 대경도 선착장' 라벨.
     * @param {ol.style.Style} style - _zoneStyle() 이 만든 스타일 한 벌
     * @returns {ol.style.Style} 외곽선·라벨만 든 스타일
     * [연계] ← _strokeOnlyStyle()
     */
    function _onlyStrokeAndText(style) {
        return new ol.style.Style({ stroke: style.getStroke(), text: style.getText() });
    }
    /**
     * 채움 레이어(_fillLayer)의 스타일 함수 — 피처마다 채움만 그린다.
     * 예: _fillOnlyStyle(대경도 선착장 피처) → 반투명 주황 면 1장.
     * @param {ol.Feature} feature - OpenLayers 가 그릴 때마다 넘겨주는 피처
     * @returns {ol.style.Style|null} 채움만 든 스타일
     * [연계] ← _ensureLayers() 의 _fillLayer style 옵션 → _zoneStyle()·_onlyFill()
     */
    function _fillOnlyStyle(feature) { return _onlyFill(_zoneStyle(feature)); }
    /**
     * 외곽선 레이어(_layer)의 스타일 함수 — 피처마다 선과 라벨만 그린다.
     * 예: _strokeOnlyStyle(대경도 선착장 피처) → 주황 테두리 + 이름 라벨.
     * @param {ol.Feature} feature - OpenLayers 가 그릴 때마다 넘겨주는 피처
     * @returns {ol.style.Style} 외곽선·라벨만 든 스타일
     * [연계] ← _ensureLayers() 의 _layer style 옵션 → _zoneStyle()·_onlyStrokeAndText()
     */
    function _strokeOnlyStyle(feature) { return _onlyStrokeAndText(_zoneStyle(feature)); }

    /**
     * 채움·외곽선 두 벡터 레이어를 (아직 없을 때만) 만들어 지도에 얹는다.
     * 예: 첫 호출 → 채움(zIndex 41)·외곽선(zIndex 81, declutter) 레이어 생성, 두 번째 호출부터는 아무 일 없음.
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
                zIndex: 41,
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
                zIndex: 81,
                visible: _visible,
                // 구역이 236개라 라벨을 다 그리면 글자가 겹쳐 읽을 수 없다 —
                // 겹치는 라벨은 OpenLayers 가 알아서 생략하게 한다(출입통제는 구역이 적어 미사용).
                declutter: true,
                updateWhileAnimating: false,
                updateWhileInteracting: false
            });
            map.addLayer(_layer);
        }
    }

    /**
     * 정적 GeoJSON 을 내려받아 소스에 채운다(lazy fetch — 버튼을 처음 켤 때만 1회).
     * 예: fetch('/fishing_ban_zones.json') → 구역 236개를 EPSG:4326→3857 로 바꿔 _source 에 추가.
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
                console.warn('[FishingBan] GeoJSON 로드 실패:', err.message);
            });
    }

    /**
     * "라벨/값" 2열 grid의 한 행을 만든다 — 값이 없으면 그 행 자체를 만들지 않는다.
     * 예: _row('통제시간', '24시간') → '<span class="ac-detail-label">통제시간</span><span class="ac-detail-value">24시간</span>'
     * @param {string} label - 왼쪽 라벨(예: '근거법령', '벌칙')
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
     * 폴리곤 feature 하나의 상세 정보 팝업 HTML을 만든다(구역마다 고시 내용이 달라 항목별로 있는 것만 표시).
     * 예: '국동 대경도 선착장' 피처 → 위치·근거법령('낚시 관리 및 육성법 제6조…')·통제시간·벌칙 표.
     * @param {ol.Feature} hit - 클릭으로 잡힌 구역 피처
     * @returns {string} 팝업 본문 HTML(항목이 하나도 없으면 안내 문구)
     * [연계] ← window._fishingBanTryHandleClick() → _row()
     */
    function _buildDetailHtml(hit) {
        var rows = '';
        rows += _row('위치', hit.get('location_desc'));
        rows += _row('소재지', hit.get('address'));
        rows += _row('근거법령', hit.get('law'));
        rows += _row('지정사유', hit.get('reason'));
        rows += _row('통제기간', hit.get('control_period'));
        rows += _row('통제시간', hit.get('control_time'));
        rows += _row('대상', hit.get('target'));
        rows += _row('벌칙', hit.get('penalty'));
        rows += _row('벌칙근거', hit.get('penalty_basis'));
        rows += _row('고시.공고', hit.get('notice'));

        return rows ? '<div class="ac-detail-grid">' + rows + '</div>'
                    : '<p>세부 정보를 불러오지 못했습니다.</p>';
    }

    /**
     * [외부 API] 지도 클릭이 낚시금지구역 폴리곤(또는 그 이름 라벨)을 눌렀는지 확인한다.
     * 구역이 화면에서 얼마나 크게 보이는지에 따라 두 갈래로 나뉜다.
     * 예1: 줌아웃 상태에서 '국동 대경도 선착장' 라벨을 탭 → 팝업 없이 그 구역 범위로
     *      지도를 확대하고 true 반환(확대만 하고 끝 — 커진 뒤 다시 탭하면 팝업).
     * 예2: 이미 확대돼 구역이 크게 보일 때 탭 → 상세 팝업을 띄우고 true 반환.
     * @param {ol.Map} map
     * @param {ol.MapBrowserEvent} evt
     * @returns {boolean} true 면 클릭이 소비됨(호출자는 바텀시트 등을 건너뛰어야 함 —
     *                    확대만 한 경우도 true 라 바텀시트가 같이 뜨지 않는다)
     * [연계] ← ocean_map.js handleMapClick — 출입통제 다음 우선순위로 호출.
     *        → _buildDetailHtml(), ocean_map.js 의 window.oceanCreateVworldLayer.maxZoom
     *        자체 singleclick 리스너를 따로 달지 않는 이유: 그렇게 하면 handleMapClick 의
     *        바텀시트 로직과 같은 클릭에 동시에 반응해버려 팝업+바텀시트가 함께 뜬다.
     */
    window._fishingBanTryHandleClick = function (map, evt) {
        if (!_visible || !_fillLayer) return false;
        var hit = map.forEachFeatureAtPixel(evt.pixel, function (feature, layer) {
            if (layer === _fillLayer) return feature;
            // 줌아웃 상태에선 폴리곤이 몇 px 밖에 안 돼 채움만으로는 잘 안 잡힌다 —
            // 외곽선+라벨 레이어에서도 보조 판정한다(seaway.js 와 같은 패턴).
            if (layer === _layer) return feature;
            return null;
        }, { hitTolerance: 5 });   // 작은 구역은 손가락으로 정확히 누르기 어렵다
        if (!hit) return false;

        // 화면상 크기(px) = 지오메트리 범위(m, EPSG:3857) ÷ 해상도(m/px)
        var extent = hit.getGeometry() && hit.getGeometry().getExtent();
        var resolution = map.getView().getResolution();
        if (extent && resolution) {
            var widthPx = (extent[2] - extent[0]) / resolution;
            var heightPx = (extent[3] - extent[1]) / resolution;
            if (widthPx < MIN_TAPPABLE_PX && heightPx < MIN_TAPPABLE_PX) {
                var vworldMaxZoom = window.oceanCreateVworldLayer && window.oceanCreateVworldLayer.maxZoom;
                map.getView().fit(extent, {
                    padding: [80, 80, 80, 80],
                    duration: 400,
                    // 아주 작은 선착장 구역이 줌 20+ 까지 과확대되는 걸 막는 상한
                    maxZoom: vworldMaxZoom || FIT_MAX_ZOOM
                });
                return true;   // 확대만 하고 팝업은 띄우지 않는다(클릭은 소비)
            }
        }

        var name = hit.get('name') || '낚시금지구역';
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
     * "낚시금지" 토글 버튼에 ON/OFF 클릭 동작을 붙인다.
     * 예: 버튼 탭 → active 표시 + 폴리곤 표시 + 데이터 로드 + 배경지도 위성(vworld) 전환, 다시 탭하면 되돌림.
     * @param {ol.Map} map - 해양지도 인스턴스(자매 파일과 시그니처를 맞춘 것 — 여기선 쓰지 않는다)
     * [연계] ← _installWhenReady()
     *        → _load(), ocean_map.js 의 window.oceanGetBasemap()/oceanSetBasemap()
     */
    function _bindToggle(map) {
        var btn = document.getElementById('ocean-fishing-ban-toggle-btn');
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
                // (access_control.js 의 "ON 시 배경 전환 → OFF 시 복귀" 와 동일 패턴)
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
     *        (access_control.js 와 동일 패턴 — 지도 생성을 알리는 이벤트가 없어 폴링한다)
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
