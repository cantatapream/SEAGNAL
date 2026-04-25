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
 * - 자식 구역 layer 는 minZoom 8 로 설정 → 줌 레벨 9 이상일 때만 자동 표시
 *   (zoom 8 권역 뷰는 50개 라벨이 과밀하므로 한 단계 더 줌인 필요).
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
    // 8 → zoom 9+ 에서 표시. (zoom 8 은 권역 뷰라 50개 라벨이 너무 많이
    //                         보여 과밀하므로, 한 단계 더 줌인해야 표시)
    var SUBZONE_MIN_ZOOM = 8;

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

    /**
     * fullName 에서 부모해역 부분을 떼어내 leaf 라벨만 반환.
     * 우리 앱 COASTAL_MAPPING 의 name 필드와 동일한 규칙:
     *   1) "중" 뒤의 부분을 우선 사용
     *      예: 제주도북부앞바다중연안바다 → 연안바다
     *      예: 인천·경기남부앞바다중북부앞평수구역 → 북부앞평수구역
     *   2) "울릉도" 접두 제거 (지역 prefix)
     *      예: 울릉도울릉읍연안바다 → 울릉읍연안바다
     *   3) 그 외는 그대로 (이미 leaf 인 천수만평수구역·당진평수구역 등)
     */
    function _shortLabel(fullName) {
        if (!fullName) return '';
        var idx = fullName.lastIndexOf('중');
        if (idx >= 0) return fullName.substring(idx + 1);
        if (fullName.indexOf('울릉도') === 0) return fullName.substring(3);
        return fullName;
    }

    /** 자식 구역 (연안바다/평수구역) 폴리곤 스타일 — 청록 톤으로 메인(노란)과 시각 구분 */
    function _subZoneStyle(feature) {
        var code = feature.get('WarnCode');
        var fullName = SUBZONE_LABEL_MAP[code];
        // 매핑 테이블에 없는 코드는 KMA 원본 name 을 정규화해서 사용 (안전망)
        if (!fullName) fullName = _normalizeZoneName(feature.get('name'));
        var label = _shortLabel(fullName);
        return new ol.style.Style({
            stroke: new ol.style.Stroke({
                // 진한 청록 + 완전 불투명 + 굵기 1.8 로 가독성 강화
                color: 'rgba(80, 200, 255, 1.0)',
                width: 1.8,
                lineDash: [5, 3]
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

    // ==================================================================
    // 외부 API
    // ==================================================================

    /**
     * [외부 API] 특보구역 토글을 프로그래밍으로 ON/OFF.
     *
     * 무엇을 하나?
     *   #ocean-warn-zone-toggle-btn 의 active 클래스를 보고, 원하는 상태와
     *   다르면 버튼을 click() 으로 흉내 내어 _bindToggle 의 핸들러가 자연스럽게
     *   실행되게 한다. 그 한 번의 click 으로 다음이 모두 동기화됨:
     *     - 클로저의 _visible 플래그 반전
     *     - _layer / _subLayer 의 setVisible
     *     - localStorage('seagnal_warn_zone_visible') 저장
     *     - 처음 켜질 때 _loadMain() / _loadSub() 자동 호출 (lazy fetch)
     *
     * 왜 필요한가?
     *   "해구기상" 버튼 같은 외부 진입 경로에서 해양종합정보 탭으로 이동하면
     *   특보구역도 자동으로 켜져야 한다. 직접 _layer.setVisible 만 하면
     *   클로저 _visible 과 어긋나고 데이터 lazy fetch 도 트리거되지 않아
     *   토글 버튼 흉내가 가장 안전.
     *
     * 어디서 호출되나?
     *   - js/render.js / js/windy.js 의 "해구기상" 버튼 클릭 핸들러 (index2 분기)
     *
     * @param {boolean} visible - 원하는 가시 상태 (true=ON, false=OFF)
     * @returns {boolean} 토글 버튼이 존재해 처리 가능했으면 true
     */
    window.setWarnZoneVisible = function (visible) {
        var btn = document.getElementById('ocean-warn-zone-toggle-btn');
        if (!btn) return false;
        var isActive = btn.classList.contains('active');
        if (isActive !== !!visible) btn.click();
        return true;
    };

    // 현재 깜빡임 진행 중인 feature/타이머 — 새 깜빡임 시작 시 정리용
    var _flashFeature = null;
    var _flashTimer = null;

    /**
     * [외부 API] 특보구역 폴리곤을 잠시 깜빡여 강조.
     *
     * 무엇을 하나?
     *   _source 에 들어 있는 특보구역 features 중 name 이 zoneName 과 일치하는
     *   하나를 찾아 5 초 동안 빨간 강조 스타일과 원본 스타일을 500ms 간격으로
     *   교차로 setStyle 한다. 끝나면 setStyle(undefined) 로 정상 복구.
     *
     * 왜 필요한가?
     *   "해구기상" 버튼으로 해양종합정보 지도로 이동했을 때, 사용자가 어느
     *   특보구역을 보러 왔는지 한눈에 알아볼 수 있도록 시각 피드백을 준다.
     *   index1(이미지 지도) 의 seaZones.js 가 하던 깜빡임 효과의 OL 버전.
     *
     * 어디서 호출되나?
     *   - js/render.js / js/windy.js 의 "해구기상" 버튼 클릭 핸들러 (index2 분기)
     *     goToOceanMapByZone 직후 약 0.8초 지연을 두고 호출.
     *     특보구역 데이터가 lazy fetch 인 점을 고려해 내부에서 짧은 retry
     *     (200ms × 최대 8회) 로 features 가 도착할 때까지 기다린다.
     *
     * 안전성:
     *   - 같은 함수가 연속 호출돼도 이전 _flashTimer / _flashFeature 를 정리
     *     해서 스타일이 영구 덮어쓰이는 일이 없다.
     *   - feature 를 못 찾으면 그냥 종료 (오류 throw 안 함).
     *
     * @param {string} zoneName - 깜빡일 특보구역 이름 (예: "울산앞바다")
     */
    window.flashWarnZone = function (zoneName) {
        var target = _normalizeZoneName(zoneName);
        if (!target) return;

        // 이전 깜빡임 정리
        if (_flashTimer) { clearInterval(_flashTimer); _flashTimer = null; }
        if (_flashFeature) { _flashFeature.setStyle(undefined); _flashFeature = null; }

        var attempts = 0;
        var MAX_ATTEMPTS = 8;        // 200ms × 8 = 최대 1.6초 대기
        var WAIT_MS = 200;

        function tryFlash() {
            if (!_source) {
                if (++attempts <= MAX_ATTEMPTS) setTimeout(tryFlash, WAIT_MS);
                return;
            }
            var feats = _source.getFeatures();
            var feature = null;
            for (var i = 0; i < feats.length; i++) {
                if (_normalizeZoneName(feats[i].get('name')) === target) {
                    feature = feats[i];
                    break;
                }
            }
            if (!feature) {
                if (++attempts <= MAX_ATTEMPTS) setTimeout(tryFlash, WAIT_MS);
                return;
            }

            _flashFeature = feature;
            var brightStyle = new ol.style.Style({
                stroke: new ol.style.Stroke({
                    color: '#ff5252',     // 강렬한 빨강
                    width: 4,
                    lineDash: [6, 4]
                }),
                fill: new ol.style.Fill({
                    color: 'rgba(255, 82, 82, 0.18)'
                })
            });

            var phase = 0;
            var TOTAL_PHASES = 10;       // 500ms × 10 = 5초
            _flashTimer = setInterval(function () {
                if (phase % 2 === 0) {
                    feature.setStyle(brightStyle);          // ON 프레임
                } else {
                    feature.setStyle(undefined);             // OFF 프레임 (레이어 기본 스타일)
                }
                phase++;
                if (phase >= TOTAL_PHASES) {
                    clearInterval(_flashTimer);
                    _flashTimer = null;
                    feature.setStyle(undefined);             // 정상 복구
                    _flashFeature = null;
                }
            }, 500);
        }

        tryFlash();
    };
})();
