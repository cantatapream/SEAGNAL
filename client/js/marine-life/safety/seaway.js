/**
 * ============================================================================
 * 파일명: client/js/marine-life/safety/seaway.js
 * 역할  : 해양안전 지도에 "항로·해역" 토글 버튼을 얹어, 선박의 입항 및 출항 등에 관한
 *         법률 제10조·해상교통안전법 제30조 등에 따라 지정ㆍ고시된 항로(선박 출입
 *         통로)와, 한중·한일 어업협정으로 정해진 국제 해양경계 수역을 함께 표시한다.
 *         면(面)으로 고시된 항로·해역은 폴리곤, 통항분리대처럼 선(線)
 *         으로 고시된 항로는 선으로 그린다(원본 이름이 폴리곤 항로와 겹치므로 화면엔
 *         전부 "통항분리대"로 통일 표시 — 라벨은 항로 이름보다 작은 글씨). 같은 이름의
 *         조각(면 3개 등)이 여럿이어도 라벨은 하나만 보인다. 탭하면 이름·정의·근거·
 *         종류·참고문서·참고사이트·담당부서·연락처 중 있는 항목을 팝업으로 보여준다.
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
    // 한중과도수역만 다른 둘(한중잠정조치수역·한일중간수역)보다 옅은 선홍으로 구분한다
    // (선·채움 둘 다 — 사용자 지시). 이름으로 판별 — 국제 해양경계 수역은 이 3개뿐이다.
    var INTL_LIGHT_COLOR = 'rgba(248, 113, 113, 0.9)';
    var INTL_LIGHT_FILL = 'rgba(248, 113, 113, 0.14)';

    // 국내 항로 중 입출구(모서리로 꺾이는 짧은 변)를 자동으로 가릴 수 있는 항로만 옆면
    // 점선 + 입출구 선 없음 처리를 적용한다(입출구를 못 가리는 복잡한 항로는 추후 검토).
    var CORNER_ANGLE_MIN = 50;  // 내각이 이 범위(50~130도) 안이면 "모서리" 꼭짓점으로 본다
    var CORNER_ANGLE_MAX = 130; // (130도 초과면 "거의 일직선" — 옆면이 완만히 굽는 지점)
    // 간격이 좁으면(예전 [6,6]) 줌 레벨에 따라 점선이 실선처럼 뭉쳐 보이는 문제가 있어
    // 넓혔다(사용자 확인).
    var DASH_PATTERN = [12, 10];

    /**
     * 선(線)으로 고시된 항로인지 판별한다 — 통항분리대 등 17개가 MultiLineString 이다.
     * 예: 면 항로 '광양만'(MultiPolygon) → false, 통항분리대(MultiLineString) → true.
     * @param {ol.Feature} feature - 판별할 항로 피처
     * @returns {boolean} 선 항로면 true
     * [연계] ← _fillOnlyStyle()(채움이 없으니 채움 레이어에서 뺀다)·_buildOutlineStyle()·
     *        window._seawayTryHandleClick()(클릭 판정을 외곽선 레이어에서 보조로 한다)
     */
    function _isLine(feature) {
        var t = feature.getGeometry() && feature.getGeometry().getType();
        return t === 'LineString' || t === 'MultiLineString';
    }

    // 면(폴리곤)으로 고시돼도 통항분리대의 일부인 category 값 — '완도항 지정항로'·
    // '북매물수도항로' 등은 선이 아니라 면인데도 실제로는 통항분리대·통항분리수역이다.
    var TSS_CATEGORIES = { '통항분리대': true, '통항분리수역': true };

    /**
     * 통항분리대(선박이 서로 반대 방향으로 다니지 못하게 나눠놓은 통항로)인지 판별한다.
     * 선(線)으로 고시된 17개뿐 아니라, 면(폴리곤)이라도 category 가 '통항분리대'·
     * '통항분리수역'이면 같은 취급 — '항로(면)'·'선회장'·'지정항로' 등 일반 항로는 제외.
     * 예: 원본 name='광양만'(선) → true. '완도항 지정항로'(면, category='통항분리수역') → true.
     *     '보길도항로'(면, category='항로(면)') → false.
     * @param {ol.Feature} feature - 판별할 피처
     * @returns {boolean} 통항분리대(류)면 true
     * [연계] ← _displayName()·_buildOutlineStyle()(라벨 글자 크기)
     */
    function _isTrafficSeparation(feature) {
        return _isLine(feature) || !!TSS_CATEGORIES[feature.get('category')];
    }

    /**
     * 화면(라벨·팝업 제목)에 보여줄 이름을 정한다. 통항분리대(류)는 원본 name 이
     * '광양만'·'완도항 지정항로'처럼 같은 이름의 다른 항로와 겹치거나 헷갈리므로,
     * 전부 "통항분리대"로 통일해 보여준다(원본 name 은 그대로 두고 표시할 때만 바꿈).
     * 예: 통항분리대(원본 name='광양만') → '통항분리대'. 일반 항로 '보길도항로' → '보길도항로'.
     * @param {ol.Feature} feature - 대상 피처
     * @returns {string} 화면에 보여줄 이름
     * [연계] ← _buildOutlineStyle()·window._seawayTryHandleClick()
     */
    function _displayName(feature) {
        return _isTrafficSeparation(feature) ? '통항분리대' : (feature.get('name') || '항로');
    }

    /**
     * 항로 하나의 채움(면)색을 정한다 — 국내 항로는 마젠타, 국제 해양경계 수역은 선홍
     * (한중과도수역만 더 옅은 선홍) 계열이다.
     * 예: '광양만' → SEAWAY_FILL. '한중과도수역' → INTL_LIGHT_FILL. '한중잠정조치수역' → INTL_FILL.
     * @param {ol.Feature} feature - 판별할 피처
     * @returns {string} rgba() 채움색
     * [연계] ← _fillOnlyStyle()
     */
    function _fillColorFor(feature) {
        if (feature.get('category') !== '해역') return SEAWAY_FILL;
        return feature.get('name') === '한중과도수역' ? INTL_LIGHT_FILL : INTL_FILL;
    }

    /**
     * 채움 레이어(_fillLayer)의 스타일 함수 — 면 항로만 채우고 선 항로는 건너뛴다.
     * 예: _fillOnlyStyle('광양만' 면 항로) → 반투명 마젠타 면, 통항분리대 선 항로 → null.
     * @param {ol.Feature} feature - OpenLayers 가 그릴 때마다 넘겨주는 피처
     * @returns {ol.style.Style|null} 채움만 든 스타일(선 항로는 채울 것이 없어 null)
     * [연계] ← _ensureLayers() 의 _fillLayer style 옵션 → _isLine()·_fillColorFor()
     */
    function _fillOnlyStyle(feature) {
        if (_isLine(feature)) return null;
        return new ol.style.Style({ fill: new ol.style.Fill({ color: _fillColorFor(feature) }) });
    }

    /**
     * 두 벡터의 사잇각(도, 0~180)을 구한다.
     * 예: _angleBetween([1,0], [0,1]) → 90.
     * @param {Array<number>} u - 벡터1 [dx, dy]
     * @param {Array<number>} v - 벡터2 [dx, dy]
     * @returns {number|null} 사잇각(도) — 길이 0인 벡터가 있으면 null
     * [연계] ← _corridorSideEdges()
     */
    function _angleBetween(u, v) {
        var magU = Math.sqrt(u[0] * u[0] + u[1] * u[1]);
        var magV = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
        if (!magU || !magV) return null;
        var cos = Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (magU * magV)));
        return Math.acos(cos) * 180 / Math.PI;
    }

    /**
     * 항로 피처에서 꼭짓점 배열을 뽑는다(닫힘 중복점 제거). 조각이 여러 개인
     * MultiPolygon(드묾)은 어느 조각의 입출구인지 가릴 수 없어 판별 대상에서 뺀다.
     * @param {ol.Feature} feature - 대상 항로 피처
     * @returns {Array<Array<number>>|null} 꼭짓점 배열, 판별 불가면 null
     * [연계] ← _corridorSideEdges() 호출 전 _buildOutlineStyle() 이 먼저 부른다
     */
    function _getRingVertices(feature) {
        var geom = feature.getGeometry();
        var type = geom.getType();
        if (type === 'Polygon') {
            return geom.getCoordinates()[0].slice(0, -1);
        }
        if (type === 'MultiPolygon') {
            var polys = geom.getCoordinates();
            if (polys.length !== 1) return null;
            return polys[0][0].slice(0, -1);
        }
        return null;
    }

    /**
     * 변 하나(좌표 2개)의 길이를 구한다.
     * @param {Array<Array<number>>} edge - [시작좌표, 끝좌표]
     * @returns {number} 변 길이(투영좌표 단위)
     * [연계] ← _corridorSideEdges()
     */
    function _edgeLen(edge) {
        var dx = edge[0][0] - edge[1][0];
        var dy = edge[0][1] - edge[1][1];
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * 항로 폴리곤의 꼭짓점을 훑어 "입출구(짧게 꺾이는 모서리 변, 선 없음)"와
     * "옆면(다니는 방향과 나란한 변, 점선)"을 가른다. 실제 항로는 직사각형(꼭짓점 4개)
     * 뿐 아니라, 중간에 완만하게 굽은 다각형(6개 등)도 많다 — 내각이 130도보다 크면
     * ("거의 일직선") 그 꼭짓점은 옆면이 완만히 굽는 지점으로 보고, 50~130도면 "모서리"
     * 로 본다. 모서리 꼭짓점 두 개를 바로 잇는 변만 입출구 후보다.
     *  - 후보가 정확히 2개면 그 둘이 입출구(나머지는 전부 옆면 — 굽은 옆면은 변이 여러
     *    개로 나뉘어도 다 옆면).
     *  - 4각형이라 후보가 4개(전 꼭짓점이 모서리) 나오면, 마주보는 두 변 쌍 중 합이
     *    더 짧은 쪽을 입출구로 본다(모서리 판별만으론 어느 쌍인지 못 가림).
     *  - 그 외(후보 0·1·3개 이상 등)는 입출구를 못 가린 것 — null 을 돌려줘 호출자가
     *    기존처럼 전체 실선을 쓰게 한다.
     * 예1: 옹도항로(6각형, 모서리 4곳·완만한 굽음 2곳) → 입출구 변 2개만 빼고 옆면 4개 반환.
     * 예2: 보길도항로(4각형, 내각 약 93·86·83·98도) → 짧은 변 쌍(입출구) 빼고 긴 변 쌍 2개 반환.
     * @param {Array<Array<number>>} verts - _getRingVertices() 가 돌려준 꼭짓점들
     * @returns {Array<Array<Array<number>>>|null} 옆면들의 좌표쌍 배열, 판별 실패면 null
     * [연계] ← _buildOutlineStyle()
     */
    function _corridorSideEdges(verts) {
        var n = verts.length;
        if (n < 4) return null;

        var isCorner = [];
        for (var i = 0; i < n; i++) {
            var angle = _angleBetween(
                [verts[(i - 1 + n) % n][0] - verts[i][0], verts[(i - 1 + n) % n][1] - verts[i][1]],
                [verts[(i + 1) % n][0] - verts[i][0], verts[(i + 1) % n][1] - verts[i][1]]
            );
            if (angle === null) return null;
            isCorner.push(angle >= CORNER_ANGLE_MIN && angle <= CORNER_ANGLE_MAX);
        }

        var capCandidates = [];
        for (var e = 0; e < n; e++) {
            if (isCorner[e] && isCorner[(e + 1) % n]) capCandidates.push(e);
        }

        var capIdx;
        if (capCandidates.length === 2) {
            capIdx = capCandidates;
        } else if (n === 4 && capCandidates.length === 4) {
            var lenA = _edgeLen([verts[0], verts[1]]) + _edgeLen([verts[2], verts[3]]);
            var lenB = _edgeLen([verts[1], verts[2]]) + _edgeLen([verts[3], verts[0]]);
            capIdx = lenA < lenB ? [0, 2] : [1, 3]; // 더 짧은 쌍이 입출구
        } else {
            return null; // 입출구를 못 가림 — 전체 실선 유지
        }

        var sides = [];
        for (var k = 0; k < n; k++) {
            if (capIdx.indexOf(k) === -1) sides.push([verts[k], verts[(k + 1) % n]]);
        }
        return sides;
    }

    /**
     * 외곽선 레이어(_layer)의 스타일 함수 — 종류별로 선 모양이 다르다.
     *  - 국제 해양경계 수역(3곳): 닫힌 도형 점선(한중과도수역만 더 옅은 선홍).
     *  - 국내 항로 중 입출구 판별이 되는 폴리곤(직사각형·완만하게 굽은 다각형 등):
     *    옆면만 점선, 입출구 변은 선 없음.
     *  - 그 외(선으로 고시된 통항분리대 17곳·입출구를 못 가리는 복잡한 항로): 기존과
     *    동일하게 전체 외곽선 실선(추후 검토 대상).
     * 예: '보길도항로'(직사각형) → Style 배열(옆면 점선 + 라벨). '완도항 지정항로'(복잡한
     *     다각형) → Style 1개(전체 실선 + 라벨). '한중과도수역' → Style 1개(옅은 선홍 점선 + 라벨).
     * 라벨은 같은 이름(name)의 피처 중 _load() 가 첫 번째로 고른 것만 보인다(_hideLabel) —
     * 같은 항로가 여러 조각으로 나뉘어 있어도 이름이 중복 표출되지 않게.
     * @param {ol.Feature} feature - OpenLayers 가 그릴 때마다 넘겨주는 피처
     * @returns {ol.style.Style|Array<ol.style.Style>} 외곽선(들)·라벨 스타일
     * [연계] ← _ensureLayers() 의 _layer style 옵션 → _isLine()·_displayName()·_getRingVertices()·_corridorSideEdges()
     */
    function _buildOutlineStyle(feature) {
        var isIntl = feature.get('category') === '해역';
        // 통항분리대 라벨은 항로 이름 라벨(11px)보다 작게(9px) — 항로 이름과 구분되도록.
        var fontSize = _isTrafficSeparation(feature) ? 9 : 11;
        var textStyle = new ol.style.Text({
            text: feature.get('_hideLabel') ? '' : _displayName(feature),
            font: 'bold ' + fontSize + 'px "Pretendard", sans-serif',
            fill: new ol.style.Fill({ color: isIntl ? INTL_TEXT : SEAWAY_TEXT }),
            stroke: new ol.style.Stroke({ color: 'rgba(0,0,0,0.85)', width: 3 }),
            overflow: true,
            placement: 'point'
        });

        if (isIntl) {
            var isTransition = feature.get('name') === '한중과도수역';
            return new ol.style.Style({
                stroke: new ol.style.Stroke({
                    color: isTransition ? INTL_LIGHT_COLOR : INTL_COLOR,
                    width: 2,
                    lineDash: DASH_PATTERN
                }),
                text: textStyle
            });
        }

        if (!_isLine(feature)) {
            var verts = _getRingVertices(feature);
            var sides = verts ? _corridorSideEdges(verts) : null;
            if (sides) {
                var dashStroke = new ol.style.Stroke({ color: SEAWAY_COLOR, width: 2, lineDash: DASH_PATTERN });
                var styles = sides.map(function (edge) {
                    return new ol.style.Style({ geometry: new ol.geom.LineString(edge), stroke: dashStroke });
                });
                styles.push(new ol.style.Style({ text: textStyle }));
                return styles;
            }
        }

        // 선 항로(통항분리대 등)·입출구를 못 가리는 복잡한 폴리곤 항로 — 기존 방식(전체 실선) 유지
        return new ol.style.Style({
            stroke: new ol.style.Stroke({ color: SEAWAY_COLOR, width: 2 }),
            text: textStyle
        });
    }

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
                style: _buildOutlineStyle,
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
     * 같은 이름(name)의 피처가 여럿이면, 그중 처음(배열 순서) 하나만 라벨을 보이게
     * 남기고 나머지엔 _hideLabel 을 표시한다 — 같은 항로가 여러 조각(면 3개 등)으로
     * 나뉘어 있어도 지도에 이름이 중복으로 겹쳐 보이지 않게 한다. 폴리곤 스타일·클릭은
     * 조각별로 그대로 동작(라벨만 하나로 줄인다).
     * 선(통항분리대)과 면(항로) 은 원본 name 이 같아도('광양만' 등) 서로 다른 대상이라
     * 묶지 않는다 — 선/면 여부를 묶는 키에 함께 넣는다.
     * 예: '보길도항로'(면) 3개 → 첫 번째만 라벨 표시. '광양만' 면 2개·선 13개는 각각
     *     따로 묶여, 면 쪽 1개("광양만")·선 쪽 1개("통항분리대")가 남는다.
     * @param {Array<ol.Feature>} features - _load() 가 막 읽어들인 피처 배열
     * [연계] ← _load() — addFeatures() 전에 1회 호출. → _buildOutlineStyle() 이 _hideLabel 을 읽는다
     */
    function _markDuplicateLabels(features) {
        var seen = {};
        for (var i = 0; i < features.length; i++) {
            var key = (features[i].get('name') || '') + '|' + (_isLine(features[i]) ? 'L' : 'P');
            if (seen[key]) {
                features[i].set('_hideLabel', true);
            } else {
                seen[key] = true;
            }
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
                _markDuplicateLabels(features);
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

        var name = _displayName(hit);
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
