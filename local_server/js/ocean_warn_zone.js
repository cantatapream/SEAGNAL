/**
 * ============================================================================
 * 파일명: js/ocean_warn_zone.js
 * 역할: 해양종합정보 지도에 KMA 해상 예특보구역 폴리곤 outline 표출
 * ============================================================================
 *
 * [개요]
 * - 메인 특보구역(44개) — /api/warn-zones (mmis:shp_wrn_poly 1회 fetch)
 * - 자식 구역 (연안바다/평수구역, 50개 폴리곤) — /api/warn-zones-sub
 *   (mmis:warnArea2Poly202106 1회 fetch)
 * - 같은 토글 버튼(#ocean-warn-zone-toggle-btn)이 두 layer 모두 제어.
 * - 자식 구역 layer 는 minZoom 7 로 설정 → 줌 레벨 8 이상일 때만 자동 표시
 *   (DEFAULT_ZOOM=7 의 전국 뷰에서는 50개 라벨 겹침 방지, 한 단계만 줌인하면 표시).
 * - 자식 라벨은 overflow:true 로 폴리곤 폭을 넘어도 그대로 표시(작은 구역이라
 *   라벨이 통째로 숨겨지지 않도록).
 *
 * [자식 구역 명칭 정규화]
 * KMA 원본 name 은 공백·마침표·언더스코어가 섞여 있어 우리 앱 표기
 * (mappings.js 의 COASTAL_MAPPING.fullName)와 다르다.
 * → SUBZONE_LABEL_MAP (WarnCode → 우리 앱 fullName) 테이블로 1:1 변환.
 *
 * [예외 처리]
 *   1) S2320600 (제주도서부 통합 연안) — S2320610+S2320620 의 union 인 legacy 폴리곤.
 *      KMA 본 사이트에서도 더 이상 사용 안 함 → 렌더에서 완전 제외.
 *   2) S2120100 (경북북부 — 울진+영덕 두 폴리곤이 같은 코드 공유) — KMA 데이터
 *      결함이지만 둘 다 "경북북부앞바다중연안바다" 의 일부라 둘 다 그리되 동일 라벨.
 * ============================================================================
 */

(function () {
    'use strict';

    // ─────────────────────────────────────────────────────────────
    // KMA WarnCode → 우리 앱 자식해역 fullName 매핑 (49개)
    // 매핑 근거: js/mappings.js 의 COASTAL_MAPPING + KMA WFS warnArea2Poly202106
    //          1:1 매칭 결과 (사용자 검토 완료).
    // ─────────────────────────────────────────────────────────────
    var SUBZONE_LABEL_MAP = {
        // 동해
        'S2110100': '경북남부앞바다중평수구역',
        'S2110200': '울산앞바다중평수구역',
        'S2120300': '경북남부앞바다중연안바다',
        'S2120400': '울산앞바다중연안바다',
        'S2120500': '강원중부앞바다중연안바다',
        'S2120600': '강원북부앞바다중연안바다',
        'S2120700': '강원남부앞바다중연안바다',
        'S2120800': '울릉도울릉읍연안바다',
        'S2120900': '울릉도서면연안바다',
        'S2121000': '울릉도북면연안바다',
        // S2120100 — KMA 가 같은 코드로 울진/영덕 두 폴리곤을 보내지만
        //           우리 앱은 둘 다 "경북북부앞바다중연안바다" 한 항목으로 처리.
        'S2120100': '경북북부앞바다중연안바다',

        // 서해
        'S2210100': '전북북부앞바다중평수구역',
        'S2210200': '전북남부앞바다중평수구역',
        'S2210300': '전남북부서해앞바다중평수구역',
        'S2210500': '전남남부서해앞바다중평수구역',
        'S2210700': '충남남부앞바다중평수구역',
        'S2211100': '인천·경기남부앞바다중먼평수구역',
        'S2211200': '서해남부남쪽안쪽먼바다중조도부근평수구역',
        'S2211300': '전남중부서해앞바다중먼평수구역',
        'S2211400': '전남중부서해앞바다중앞평수구역',
        'S2211500': '천수만평수구역',
        'S2211600': '인천·경기남부앞바다중북부앞평수구역',
        'S2211700': '인천·경기남부앞바다중남부앞평수구역',
        'S2211900': '안면도서쪽평수구역',
        'S2212000': '인천·경기북부앞바다중평수구역',
        'S2212100': '당진평수구역',
        'S2212200': '태안·서산북쪽평수구역',

        // 남해
        'S2310100': '부산앞바다중동부평수구역',
        'S2310200': '부산앞바다중서부평수구역',
        'S2310300': '경남중부남해앞바다중평수구역',
        'S2310400': '경남서부남해앞바다중동부평수구역',
        'S2310500': '경남서부남해앞바다중서부평수구역',
        'S2310600': '경남서부남해앞바다중남부평수구역',
        'S2310700': '전남서부남해앞바다중평수구역',
        'S2310800': '전남동부남해앞바다중서부평수구역',
        'S2310900': '전남동부남해앞바다중동부평수구역',
        'S2320100': '부산앞바다중연안바다',
        'S2320200': '거제시동부앞바다중연안바다',
        'S2320300': '경남서부남해앞바다중남해군연안바다',
        'S2320800': '경남중부남해앞바다중연안바다',

        // 제주
        'S2320400': '제주도북부앞바다중연안바다',
        'S2320610': '제주도서부앞바다중북서연안바다',
        'S2320620': '제주도서부앞바다중남서연안바다',
        'S2320700': '제주도남부앞바다중연안바다',
        'S2320900': '제주도동부앞바다중북동연안바다',
        'S2321000': '제주도동부앞바다중남동연안바다',
        'S2330100': '남해서부서쪽먼바다중추자도연안바다',
        'S2330200': '제주도동부앞바다중우도연안바다',
        'S2330300': '제주도서부앞바다중가파도연안바다'
        // S2320600 (제주도서부 통합 연안) — legacy/aggregate, 렌더 시 제외
    };

    var EXCLUDED_SUBZONE_CODES = { 'S2320600': true };

    // 자식 구역 layer 가시 줌 임계값.
    // OL minZoom 은 "exclusive": 이 값보다 큰 줌에서만 표시.
    // 7 → zoom 8+ 에서 표시 (DEFAULT_ZOOM=7 의 전국 뷰에서 50개 라벨이 겹치는
    //                         과밀 방지 + 한 단계만 줌인하면 바로 보이는 균형점).
    var SUBZONE_MIN_ZOOM = 7;

    // ─────────────────────────────────────────────────────────────

    var _layer = null;
    var _source = null;
    var _subLayer = null;
    var _subSource = null;
    var _visible = false;

    var _loaded = false;
    var _loading = false;
    var _subLoaded = false;
    var _subLoading = false;

    /**
     * 메인 특보구역명 정규화 (공백 제거 + 마침표 → 중점)
     * 자식 구역은 SUBZONE_LABEL_MAP 으로 변환되므로 이 함수 미사용.
     */
    function _normalizeZoneName(name) {
        return (name || '')
            .replace(/\./g, '·')
            .replace(/\s+/g, '');
    }

    /** 메인 특보구역 폴리곤 스타일 (44개) */
    function _zoneStyle(feature) {
        var name = _normalizeZoneName(feature.get('name'));
        return new ol.style.Style({
            stroke: new ol.style.Stroke({
                color: 'rgba(255, 200, 80, 0.85)',
                width: 1.5,
                lineDash: [6, 4]
            }),
            fill: new ol.style.Fill({
                color: 'rgba(255, 200, 80, 0.04)'
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

    /** 자식 구역 (연안바다/평수구역) 폴리곤 스타일 — 더 옅은 청록 톤으로 시각 구분 */
    function _subZoneStyle(feature) {
        var code = feature.get('WarnCode');
        var label = SUBZONE_LABEL_MAP[code];
        // 매핑 테이블에 없는 코드는 KMA 원본 name 을 정규화해서 사용 (안전망)
        if (!label) label = _normalizeZoneName(feature.get('name'));
        return new ol.style.Style({
            stroke: new ol.style.Stroke({
                color: 'rgba(120, 220, 255, 0.85)',
                width: 1.0,
                lineDash: [3, 3]
            }),
            fill: new ol.style.Fill({
                color: 'rgba(120, 220, 255, 0.05)'
            }),
            text: new ol.style.Text({
                text: label,
                font: '600 10px "Pretendard", sans-serif',
                fill: new ol.style.Fill({ color: '#a5dfff' }),
                stroke: new ol.style.Stroke({ color: 'rgba(0,0,0,0.85)', width: 3 }),
                // overflow: true → 폴리곤 픽셀 폭보다 라벨이 넓어도 그대로 표시.
                //   (false 면 작은 자식 구역은 라벨이 통째로 숨겨져 매우 줌인해야 보임)
                overflow: true,
                placement: 'point'
            })
        });
    }

    /** 메인 + 자식 Vector Layer 를 한 번만 만들어 지도에 추가 */
    function _ensureLayers(map) {
        if (!_layer) {
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
        }
        if (!_subLayer) {
            _subSource = new ol.source.Vector();
            _subLayer = new ol.layer.Vector({
                source: _subSource,
                style: _subZoneStyle,
                zIndex: 81,            // 메인 위에 그려져 라벨이 가려지지 않게
                visible: _visible,
                minZoom: SUBZONE_MIN_ZOOM,  // OL: zoom > minZoom 에서만 표시 (즉 9+)
                updateWhileAnimating: false,
                updateWhileInteracting: false
            });
            map.addLayer(_subLayer);
        }
    }

    /** 메인 특보구역 GeoJSON lazy fetch */
    function _loadMain() {
        if (_loaded || _loading) return;
        _loading = true;
        fetch('/api/warn-zones')
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
                console.warn('[OceanWarnZone] 메인 GeoJSON 로드 실패:', err.message);
            });
    }

    /** 자식 구역 GeoJSON lazy fetch — S2320600 같은 제외 코드는 로딩 시점에 필터 */
    function _loadSub() {
        if (_subLoaded || _subLoading) return;
        _subLoading = true;
        fetch('/api/warn-zones-sub')
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (geojson) {
                if (!_subSource) return;
                var features = new ol.format.GeoJSON().readFeatures(geojson, {
                    dataProjection: 'EPSG:4326',
                    featureProjection: 'EPSG:3857'
                });
                // 제외 코드 필터 (예: S2320600 — 북서+남서 union legacy)
                features = features.filter(function (f) {
                    return !EXCLUDED_SUBZONE_CODES[f.get('WarnCode')];
                });
                _subSource.addFeatures(features);
                _subLoaded = true;
                _subLoading = false;
            })
            .catch(function (err) {
                _subLoading = false;
                console.warn('[OceanWarnZone] 자식 GeoJSON 로드 실패:', err.message);
            });
    }

    /** 토글 버튼 바인딩 — 메인/자식 두 layer 동시 제어 */
    function _bindToggle() {
        var btn = document.getElementById('ocean-warn-zone-toggle-btn');
        if (!btn) return;

        try {
            _visible = localStorage.getItem('seagnal_warn_zone_visible') === 'true';
        } catch (e) { _visible = false; }

        btn.classList.toggle('active', _visible);
        if (_layer)    _layer.setVisible(_visible);
        if (_subLayer) _subLayer.setVisible(_visible);   // minZoom 으로 자동 가/숨 됨
        if (_visible) { _loadMain(); _loadSub(); }

        btn.addEventListener('click', function () {
            _visible = !_visible;
            btn.classList.toggle('active', _visible);
            if (_layer)    _layer.setVisible(_visible);
            if (_subLayer) _subLayer.setVisible(_visible);
            if (_visible) { _loadMain(); _loadSub(); }
            try { localStorage.setItem('seagnal_warn_zone_visible', String(_visible)); } catch (e) {}
        });
    }

    /** oceanMap 이 만들어질 때까지 시간 제한 없이 폴링 */
    function _installWhenReady() {
        function _try() {
            var map = window.getOceanMap && window.getOceanMap();
            if (map) {
                _ensureLayers(map);
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
