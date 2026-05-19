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
 *
 * [T4 — z-order 분리 (천기 레이어와 공존)]
 *   사용자 요구: 특보 색칠은 천기 레이어 아래, 특보구역 선은 천기 위.
 *   구현: 한 source 를 두 layer 가 공유.
 *     - _fillLayer (zIndex 40)    : 색칠만 그림 (천기 PNG 50 보다 아래)
 *     - _layer (zIndex 80)        : 외곽선 + 라벨 (천기 PNG 50 보다 위)
 *     - _subFillLayer (zIndex 41) : 자식구역 색칠
 *     - _subLayer (zIndex 81)     : 자식구역 외곽선 + 라벨
 *   _onlyFill / _onlyStrokeAndText 가 _zoneStyle 결과를 분해해서 각 layer 에 전달.
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

    // 부모 라벨과 좌표가 거의 같아 글자가 겹쳐 보이는 자식해역만 라벨을 픽셀 단위로 비킴.
    // 값은 [offsetX, offsetY] (양수 Y = 아래, 음수 Y = 위). 겹침이 추가로 발견되면 한 줄씩 등록.
    var SUBZONE_LABEL_OFFSET = {
        // S2310300 (경남중부남해앞바다중평수구역) — 부모 '경남중부남해앞바다' 라벨과 같은
        // 위치에 찍혀 글자가 뒤엉켜 보임. 자식 라벨만 위로 14px 비킴.
        'S2310300': [0, -14]
    };

    // 자식 구역 layer 가시 줌 임계값.
    // OL minZoom 은 "exclusive": 이 값보다 큰 줌에서만 표시.
    // 8 → zoom 9+ 에서 표시. (zoom 8 은 권역 뷰라 50개 라벨이 너무 많이
    //                         보여 과밀하므로, 한 단계 더 줌인해야 표시)
    var SUBZONE_MIN_ZOOM = 8;

    // ─────────────────────────────────────────────────────────────

    // ─────────────────────────────────────────────────────────────
    // OL Layer/Source 핸들러
    //   ▸ 한 source 를 두 layer 가 공유하는 패턴 (OpenLayers 표준 기능):
    //     - _fillLayer    : 색칠(fill) 만 그리는 layer  → zIndex 40 (천기 PNG 50 보다 아래)
    //     - _layer        : 외곽선(stroke) + 라벨(text) 만 그리는 layer → zIndex 80 (천기 위)
    //     - _source       : 두 layer 공통 feature 저장소 (한 번 add 하면 두 layer 자동 반영)
    //   ▸ 같은 패턴을 자식구역(sub) 에도 적용 → _subFillLayer (41) + _subLayer (81)
    //   ▸ [왜 분리?] 사용자 요구: "특보 색칠은 천기 레이어 아래, 특보구역 선은 천기 위"
    //                즉 한 layer 의 fill+stroke 묶음은 layer-level zIndex 하나만 가지므로
    //                fill 과 stroke 가 천기 PNG 의 위·아래로 갈라질 수 없음 → layer 분리 필수.
    // ─────────────────────────────────────────────────────────────
    var _layer = null;          // 메인구역 외곽선+라벨 layer (zIndex 80, 천기 위)
    var _fillLayer = null;      // 메인구역 색칠 layer (zIndex 40, 천기 아래)
    var _source = null;         // 메인구역 feature source (두 layer 공유)
    var _subLayer = null;       // 자식구역 외곽선+라벨 layer (zIndex 81, 천기 위)
    var _subFillLayer = null;   // 자식구역 색칠 layer (zIndex 41, 천기 아래)
    var _subSource = null;      // 자식구역 feature source (두 layer 공유)
    var _visible = false;

    var _loaded = false;
    var _loading = false;
    var _subLoaded = false;
    var _subLoading = false;

    // 활성 특보 색칠 모듈(ocean_warn_active.js)이 주입하는 스타일 함수.
    // 시그니처: (feature, kind: 'main'|'sub') → ol.style.Style | ol.style.Style[] | null
    // null 반환 시 기본 outline 스타일로 fallback.
    var _activeStyler = null;

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
        if (_activeStyler) {
            var override = _activeStyler(feature, 'main');
            if (override) return override;
        }
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

    /**
     * 자식 라벨용 ol.style.Text 공통 빌더.
     *
     * [왜 분리?]
     *   - 일반 모드(_subZoneStyle) 와 활성 특보 모드(ocean_warn_active3.js _styler)
     *     모두 같은 SUBZONE_LABEL_MAP / _shortLabel / SUBZONE_LABEL_OFFSET 규칙으로
     *     자식 라벨을 그려야 한다. UX 일관성을 위해 한 곳에서 산출.
     *   - 두 모드는 색상만 다름. opts.fillColor / opts.strokeColor / opts.strokeWidth
     *     로 색·두께만 오버라이드 가능.
     *
     * [기본값]
     *   - fillColor: '#a5dfff' (일반 모드의 청록 톤)
     *   - strokeColor: 'rgba(0,0,0,0.85)'
     *   - strokeWidth: 3
     *   - font: '600 10px "Pretendard", sans-serif'
     *   - overflow: true, placement: 'point'
     *
     * @param {ol.Feature} feature - 자식 폴리곤 feature
     * @param {Object} [opts] - 색상/두께 오버라이드용
     * @returns {ol.style.Text|null} 라벨이 없으면 null
     */
    function _buildSubZoneTextStyle(feature, opts) {
        if (!feature) return null;
        var code = feature.get('WarnCode');
        var fullName = SUBZONE_LABEL_MAP[code];
        // 매핑 테이블에 없는 코드는 KMA 원본 name 을 정규화해서 사용 (안전망)
        if (!fullName) fullName = _normalizeZoneName(feature.get('name'));
        var label = _shortLabel(fullName);
        if (!label) return null;

        opts = opts || {};
        var textOpts = {
            text: label,
            font: opts.font || '600 10px "Pretendard", sans-serif',
            fill: new ol.style.Fill({ color: opts.fillColor || '#a5dfff' }),
            stroke: new ol.style.Stroke({
                color: opts.strokeColor || 'rgba(0,0,0,0.85)',
                width: opts.strokeWidth != null ? opts.strokeWidth : 3
            }),
            // overflow: true → 폴리곤 픽셀 폭보다 라벨이 넓어도 그대로 표시.
            //   (false 면 작은 자식 구역은 라벨이 통째로 숨겨져 매우 줌인해야 보임)
            overflow: true,
            placement: 'point'
        };
        var off = SUBZONE_LABEL_OFFSET[code];
        if (off) {
            textOpts.offsetX = off[0];
            textOpts.offsetY = off[1];
        }
        return new ol.style.Text(textOpts);
    }

    /** 자식 구역 (연안바다/평수구역) 폴리곤 스타일 — 청록 톤으로 메인(노란)과 시각 구분 */
    function _subZoneStyle(feature) {
        if (_activeStyler) {
            var override = _activeStyler(feature, 'sub');
            if (override) return override;
        }
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
            text: _buildSubZoneTextStyle(feature)
        });
    }

    // ─────────────────────────────────────────────────────────────
    // Style 분리 헬퍼 — ol.style.Style 1개를 fill 전용 / stroke+text 전용 으로 쪼개기
    //
    // [왜 필요?]
    //   _zoneStyle / _subZoneStyle 은 fill + stroke + text 를 묶어 1 개의 Style 로 반환.
    //   이 묶음을 fill 전용 Style 과 stroke+text 전용 Style 두 개로 쪼개야
    //   각각 다른 layer (zIndex) 에서 렌더할 수 있다.
    //
    // [동작]
    //   _onlyFill(s)         → s 에서 fill 부분만 추출한 새 Style. fill 없으면 null 반환.
    //   _onlyStrokeAndText(s) → s 에서 stroke + text 부분만 추출한 새 Style.
    //
    // [성능]
    //   feature 수 = 메인 44 + 자식 50 ≈ 94 개. 두 layer 가 각각 _zoneStyle 호출하므로
    //   re-render 당 약 188 회 호출이지만 ol.style.* 객체 생성이 가벼워 부담 없음.
    // ─────────────────────────────────────────────────────────────
    function _onlyFill(style) {
        if (!style) return null;
        if (Array.isArray(style)) style = style[0];
        if (!style || !style.getFill) return null;
        var f = style.getFill();
        if (!f) return null;
        var ns = new ol.style.Style({ fill: f });
        var z = style.getZIndex();
        if (z != null) ns.setZIndex(z);
        return ns;
    }
    function _onlyStrokeAndText(style) {
        if (!style) return null;
        if (Array.isArray(style)) style = style[0];
        if (!style || !style.getStroke) return null;
        var s = style.getStroke();
        var t = style.getText && style.getText();
        if (!s && !t) return null;
        var opts = {};
        if (s) opts.stroke = s;
        if (t) opts.text = t;
        var ns = new ol.style.Style(opts);
        var z = style.getZIndex();
        if (z != null) ns.setZIndex(z);
        return ns;
    }

    // 두 layer 가 각각 호출할 style 함수 — 본 _zoneStyle 결과를 split.
    function _zoneFillOnlyStyle(feature)    { return _onlyFill(_zoneStyle(feature)); }
    function _zoneStrokeOnlyStyle(feature)  { return _onlyStrokeAndText(_zoneStyle(feature)); }
    function _subZoneFillOnlyStyle(feature) { return _onlyFill(_subZoneStyle(feature)); }
    function _subZoneStrokeOnlyStyle(feature) { return _onlyStrokeAndText(_subZoneStyle(feature)); }

    /**
     * 메인 + 자식 Vector Layer 를 한 번만 만들어 지도에 추가
     *
     * [구조]
     *   메인구역  : _fillLayer (zIndex 40, 색칠) + _layer (zIndex 80, 선+라벨)
     *   자식구역  : _subFillLayer (zIndex 41, 색칠) + _subLayer (zIndex 81, 선+라벨)
     *
     * [zIndex 의미]
     *   - 천기(KMA 단기예보 PNG) layer 가 zIndex 50 → 그 사이로 갈리도록 fill 은 40, stroke 는 80
     *   - 결과: 사용자가 본 화면 — 색칠(특보 발효 색) → 천기 → 특보구역 선 + 라벨
     *
     * [source 공유]
     *   같은 _source 를 두 layer 에 넘겨서, 한 번 addFeatures 하면 두 layer 가 자동 동기화.
     *   OL 의 정식 패턴으로 메모리/일관성 둘 다 깔끔.
     */
    function _ensureLayers(map) {
        // source 먼저 보장 (layer 생성 시 source 가 필요)
        if (!_source) _source = new ol.source.Vector();
        if (!_subSource) _subSource = new ol.source.Vector();

        // [메인구역] 색칠 layer — 천기 PNG (zIndex 50) 보다 아래에 위치
        if (!_fillLayer) {
            _fillLayer = new ol.layer.Vector({
                source: _source,
                style: _zoneFillOnlyStyle,
                zIndex: 40,
                visible: _visible,
                updateWhileAnimating: false,
                updateWhileInteracting: false
            });
            map.addLayer(_fillLayer);
        }
        // [메인구역] 외곽선+라벨 layer — 천기 PNG 위에 위치 (사용자가 라인 보이도록)
        if (!_layer) {
            _layer = new ol.layer.Vector({
                source: _source,
                style: _zoneStrokeOnlyStyle,
                zIndex: 80,
                visible: _visible,
                updateWhileAnimating: false,
                updateWhileInteracting: false
            });
            map.addLayer(_layer);
        }
        // [자식구역] 색칠 layer
        if (!_subFillLayer) {
            _subFillLayer = new ol.layer.Vector({
                source: _subSource,
                style: _subZoneFillOnlyStyle,
                zIndex: 41,
                visible: _visible,
                minZoom: SUBZONE_MIN_ZOOM,
                updateWhileAnimating: false,
                updateWhileInteracting: false
            });
            map.addLayer(_subFillLayer);
        }
        // [자식구역] 외곽선+라벨 layer
        if (!_subLayer) {
            _subLayer = new ol.layer.Vector({
                source: _subSource,
                style: _subZoneStrokeOnlyStyle,
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
        // [캐시 무력화 v=20260430] 메인 특보구역 GeoJSON 좌표를 KMA wrnArea 정식
        //   데이터로 교체(c09bf2a). 이전 응답은 routes/weather.js 의
        //   Cache-Control: max-age=86400 으로 클라이언트(앱 WebView) 에 24시간
        //   캐시되어 새 데이터 미적용 → URL 키 변경(?v=20260430) 으로 1회성 무력화.
        //   다음 GeoJSON 갱신이 필요해지면 v 값을 다시 올려 같은 방식으로 처리.
        fetch('/api/warn-zones?v=20260430')
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
        // [캐시 무력화 v=20260430] 자식 특보구역 GeoJSON 도 함께 1회 무력화
        //   (메인과 동일 사유 — 위 _loadMain 주석 참조)
        fetch('/api/warn-zones-sub?v=20260430')
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
        // 4개 layer 모두 동기화 (메인/자식 × 색칠/외곽선)
        if (_layer)        _layer.setVisible(_visible);
        if (_fillLayer)    _fillLayer.setVisible(_visible);
        if (_subLayer)     _subLayer.setVisible(_visible);   // minZoom 으로 자동 가/숨 됨
        if (_subFillLayer) _subFillLayer.setVisible(_visible);
        if (_visible) { _loadMain(); _loadSub(); }

        btn.addEventListener('click', function () {
            _visible = !_visible;
            btn.classList.toggle('active', _visible);
            if (_layer)        _layer.setVisible(_visible);
            if (_fillLayer)    _fillLayer.setVisible(_visible);
            if (_subLayer)     _subLayer.setVisible(_visible);
            if (_subFillLayer) _subFillLayer.setVisible(_visible);
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

    /**
     * [외부 API] 활성 특보 색칠 모듈(ocean_warn_active.js) 연동용 네임스페이스.
     *
     * - setActiveStyler(fn): 메인/자식 폴리곤 그릴 때 우선 호출되는 스타일 함수 등록.
     *                       fn(feature, kind) 가 truthy 반환 시 그 스타일이 사용되고,
     *                       null/undefined 반환 시 기존 outline 스타일로 fallback.
     *                       null 전달 시 등록 해제.
     * - refresh(): 두 layer 의 스타일을 즉시 재평가 (특보 갱신 후 호출).
     * - setSubMinZoomDisabled(bool): true 면 자식 layer 의 minZoom 제약을 풀어 멀리서도
     *                                자식구역이 색칠되어 보이게 함. false 면 원복.
     * - getMainSource() / getSubSource(): feature 검색용 (forEachFeatureAtPixel 의
     *                                     layerFilter 에 _layer / _subLayer 사용).
     * - getMainLayer() / getSubLayer(): 클릭 hit 테스트용 layer 참조.
     *   ▸ [T4 변경] fill layer 를 반환하도록 변경. 이유: stroke layer 는 외곽선만
     *     렌더되어 그 layer 의 hit detection 캔버스가 외곽선 픽셀만 포함 → polygon
     *     내부 클릭 시 hit 안 됨. fill layer 는 polygon 전체 면적이 hit canvas 에
     *     포함되어 어디 클릭해도 정상 hit. (active5.js _findHitParentZone 의 폴리곤
     *     내부 클릭 호환성 유지)
     * - getSubFullName(feature): 자식 feature 의 우리 앱 fullName 반환 (SUBZONE_LABEL_MAP).
     */
    window.OceanWarnZone = {
        /**
         * [공개 API] 활성 특보 색칠 모듈이 사용할 스타일 함수 등록.
         * fn(feature, kind) 가 ol.style.Style (또는 배열) 반환 → 그 스타일 사용.
         * fn 이 null/undefined 반환 → 기본 outline 스타일 fallback.
         * [연계] ocean_warn_active3.js 의 _styler() 가 fn 으로 등록됨.
         */
        setActiveStyler: function (fn) {
            _activeStyler = (typeof fn === 'function') ? fn : null;
            this.refresh();
        },
        /**
         * [공개 API] 4개 layer 의 스타일을 즉시 재평가.
         *
         * 언제 호출?
         *   - 활성 특보 데이터가 갱신되어 색칠을 새로 적용해야 할 때 (active4.js)
         *   - 사용자가 zone 을 클릭해 selected 상태로 강조해야 할 때 (active5.js)
         *
         * 4개 layer (메인 fill+stroke, 자식 fill+stroke) 모두 .changed() 호출 →
         * OL 이 다음 render 시 _zoneStyle / _subZoneStyle 을 다시 호출 → 새 스타일 반영.
         */
        refresh: function () {
            // 4개 layer 모두 스타일 재평가 (특보 갱신 후 색칠/외곽선 양쪽 모두 다시 그림)
            if (_layer)        _layer.changed();
            if (_fillLayer)    _fillLayer.changed();
            if (_subLayer)     _subLayer.changed();
            if (_subFillLayer) _subFillLayer.changed();
        },
        /**
         * [공개 API] 자식구역의 minZoom (확대 임계값) 일시 해제.
         *
         * @param {boolean} disabled - true 면 멀리서도 자식구역이 보이게 (active 색칠 모드용)
         *
         * 활성 특보가 자식구역 단위로 발효된 경우 (예: 평수구역만 발효) 멀리서도 색칠
         * 영역이 보이도록 minZoom 제약을 일시 해제. 비활성 시 다시 8(=zoom9+) 로 복귀.
         * [연계] ocean_warn_active4.js 의 _activate / _deactivate 에서 호출.
         */
        setSubMinZoomDisabled: function (disabled) {
            if (!_subLayer) return;
            // OL Layer 의 minZoom 은 생성 시 옵션. set('minZoom', ...) 으로 동적 변경 가능.
            // 자식구역 외곽선/색칠 layer 둘 다 같은 minZoom 정책 유지.
            _subLayer.setMinZoom(disabled ? -Infinity : SUBZONE_MIN_ZOOM);
            if (_subFillLayer) _subFillLayer.setMinZoom(disabled ? -Infinity : SUBZONE_MIN_ZOOM);
        },
        /** [공개 API] 메인구역 / 자식구역 feature 저장소 (Vector source) — feature 순회용. */
        getMainSource: function () { return _source; },
        getSubSource:  function () { return _subSource; },
        /**
         * [공개 API] 메인구역 / 자식구역 클릭 hit detection 용 layer.
         *
         * [T4 이후 — 중요]
         *   stroke layer (_layer / _subLayer) 가 아닌 **fill layer (_fillLayer /
         *   _subFillLayer) 를 반환**. 이유:
         *     - OL Vector layer 의 hit detection 은 layer 의 hit canvas 픽셀로 결정
         *     - stroke layer 는 외곽선 픽셀만 hit canvas 에 포함 → polygon 내부
         *       클릭 시 hit 못함
         *     - fill layer 는 polygon 전체 면적이 hit canvas 에 포함 → 어디 클릭해도 OK
         *   features 자체는 두 layer 가 같은 source 를 공유하므로 동일.
         *   active5.js 의 _findHitParentZone 에서 layerFilter 로 사용 → 정상 동작.
         */
        getMainLayer: function () { return _fillLayer || _layer; },
        getSubLayer:  function () { return _subFillLayer || _subLayer; },
        /** 자식 feature 의 우리 앱 fullName 변환 (KMA WarnCode → COASTAL_MAPPING name) */
        getSubFullName: function (feature) {
            if (!feature) return '';
            var code = feature.get('WarnCode');
            return SUBZONE_LABEL_MAP[code] || _normalizeZoneName(feature.get('name'));
        },
        /** 메인 feature 의 정규화된 zone 이름 (appState.alerts[].zoneName 매칭용) */
        getMainZoneName: function (feature) {
            return feature ? _normalizeZoneName(feature.get('name')) : '';
        },
        /** 외부에서도 사용 가능한 zone name 정규화 함수 (공백/마침표 처리) */
        normalizeZoneName: _normalizeZoneName,
        /**
         * [공개 API] 자식해역 라벨용 ol.style.Text 빌더.
         *
         * 일반 모드(_subZoneStyle) 와 활성 특보 모드(ocean_warn_active3.js) 가
         * **같은 텍스트/오프셋 규칙**으로 자식 라벨을 그리도록 공유.
         *
         * @param {ol.Feature} feature - 자식 폴리곤 feature
         * @param {Object} [opts] - { fillColor, strokeColor, strokeWidth, font }
         *                           활성 모드는 흰색+굵은 stroke 로 오버라이드.
         * @returns {ol.style.Text|null}
         */
        buildSubZoneTextStyle: _buildSubZoneTextStyle,
        /** GeoJSON 두 종류 모두 로드 완료됐는지 — 데이터 의존 동작 트리거 전에 확인 */
        isLoaded: function () { return _loaded && _subLoaded; }
    };

    // 현재 깜빡임 진행 중인 feature/타이머 — 새 깜빡임 시작 시 정리용
    var _flashFeature = null;
    var _flashTimer = null;

    /**
     * [외부 API] 특보구역(부모, 44개) 폴리곤을 잠시 깜빡여 강조.
     *
     * 무엇을 하나?
     *   주어진 zoneName 이 어느 부모 특보구역 안에 있는지 찾아 그 폴리곤을 5초간
     *   깜빡인다. 부모 zone 결정 우선순위:
     *     ① ZONE_OVERLAY_CONFIG[zoneName].center 픽셀 → pixelToGps → 위경도 →
     *        EPSG:3857 좌표 → _source 의 features 중 geometry 가 그 좌표를
     *        "공간적으로 포함" 하는 부모 zone 1 개 (대부분 케이스).
     *     ② 좌표 기반으로 못 찾은 경우 fallback: features 의 name 이 zoneName
     *        과 정규화 일치하는 1 개.
     *
     * 왜 좌표 기반인가?
     *   사용자 카드(예: "울산앞바다") 의 zoneName 은 자식/이름이 다른 구역인
     *   경우가 많아 부모 특보구역(예: "남해동부앞바다") name 과 직접 매칭
     *   되지 않는다. 부모 폴리곤은 자식 좌표를 공간적으로 항상 포함하므로
     *   좌표 기반 검색이 가장 안전하고 일관적.
     *
     * 깜빡임 동작:
     *   강조 스타일(빨강 width:4) ↔ 원본 스타일을 500ms 간격으로 10회(=5초)
     *   교차 setStyle. 끝나면 setStyle(undefined) 로 정상 복귀.
     *
     * 어디서 호출되나?
     *   - js/render.js / js/windy.js 의 "해구기상" 버튼 클릭 핸들러 (index2 분기)
     *     goToOceanMapByZone 직후 약 0.8초 지연 호출.
     *
     * 안전성:
     *   - 데이터 lazy fetch 라 features 가 비었을 수 있어 200ms × 8회 retry.
     *   - 같은 함수 연속 호출 시 이전 _flashTimer / _flashFeature 정리 → 스타일
     *     영구 덮어쓰기 방지.
     *   - 좌표/이름 모두 못 찾으면 조용히 종료 (오류 throw 안 함).
     *
     * @param {string} zoneName - 깜빡일 부모 특보구역의 식별자(자식 이름이어도 됨)
     */
    window.flashWarnZone = function (zoneName) {
        var target = _normalizeZoneName(zoneName);
        if (!target) return;

        // 좌표 기반 검색을 위해 zoneName 의 중심 GPS 좌표(EPSG:3857) 미리 계산.
        // ZONE_OVERLAY_CONFIG / pixelToGps 가 없거나 매핑 없으면 null → name match 만 사용.
        var coord3857 = null;
        try {
            if (typeof ZONE_OVERLAY_CONFIG !== 'undefined'
                && typeof pixelToGps === 'function'
                && typeof ol !== 'undefined') {
                var cfg = ZONE_OVERLAY_CONFIG[zoneName];
                if (cfg && cfg.center) {
                    var gps = pixelToGps(cfg.center.x, cfg.center.y);
                    if (gps && gps.lat != null && gps.lon != null) {
                        coord3857 = ol.proj.fromLonLat([gps.lon, gps.lat]);
                    }
                }
            }
        } catch (e) { coord3857 = null; }

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

            // ① 좌표 기반 — 부모 폴리곤이 좌표를 포함하는지 검사 (정상 경로)
            if (coord3857) {
                for (var i = 0; i < feats.length; i++) {
                    var geom = feats[i].getGeometry();
                    if (geom && typeof geom.intersectsCoordinate === 'function'
                        && geom.intersectsCoordinate(coord3857)) {
                        feature = feats[i];
                        break;
                    }
                }
            }
            // ② fallback — 이름 정규화 일치
            if (!feature) {
                for (var j = 0; j < feats.length; j++) {
                    if (_normalizeZoneName(feats[j].get('name')) === target) {
                        feature = feats[j];
                        break;
                    }
                }
            }
            if (!feature) {
                if (++attempts <= MAX_ATTEMPTS) setTimeout(tryFlash, WAIT_MS);
                return;
            }

            _flashFeature = feature;

            // ── 화면 맞춤 (zoom + center) ──────────────────────────────
            // 부모 특보구역 폴리곤이 화면에 "충분히 크게" 보이도록 fit().
            //   - padding 60px : 사방 여백, 폴리곤이 화면 가장자리까지 안 가게
            //   - maxZoom 9    : 너무 확대돼서 베이스맵 디테일이 사라지지 않도록
            //                    (실제 부모 zone 들이 대체로 커서 9 정도면 1.5~2 화면)
            //   - duration 500 : 부드러운 줌·이동
            // goToOceanMapByZone 의 center animate(400ms) 와 잠시 겹칠 수 있으나
            // fit 이 나중에 적용되어 최종 상태는 항상 일관.
            var oceanMap_ = window.getOceanMap && window.getOceanMap();
            if (oceanMap_) {
                try {
                    var extent = feature.getGeometry().getExtent();
                    oceanMap_.getView().fit(extent, {
                        padding: [60, 60, 60, 60],
                        duration: 500,
                        maxZoom: 9
                    });
                } catch (e) { /* fit 실패해도 깜빡임은 계속 진행 */ }
            }

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
