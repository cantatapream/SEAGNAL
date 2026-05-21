/**
 * ============================================================================
 * 파일명: js/ocean_warn_active3.js  (3/5 — 폴리곤 색상 스타일러)
 * 역할 : OceanWarnZone.setActiveStyler 에 등록할 스타일 함수 구현.
 *        부모/자식 feature 별로 활성 맵을 조회해 색칠 또는 기본 outline fallback.
 * ============================================================================
 *
 * [등록 흐름]
 *   1. 4.js 의 _activate() 가 OceanWarnZone.setActiveStyler(ns._styler) 호출
 *   2. ocean_warn_zone.js 가 _zoneStyle / _subZoneStyle 마다 _styler 우선 호출
 *   3. _styler 가 OL Style 반환하면 그 스타일 적용, null 반환하면 기본 outline
 *
 * [핵심 정책]
 *   - 활성 맵에 paletteKey 가 있는 zone   → 채색 스타일 반환
 *   - 활성 맵에 zone 자체 없음            → null 반환 (기본 점선 outline 그대로)
 *   - 자식 feature 는 부모 zone 색상을 따라감 (자식 단위 분리는 추후 고도화 예정)
 * ============================================================================
 */

(function () {
    'use strict';

    var ns = window.OceanWarnActive;
    if (!ns) return;

    // ────────────────────────────────────────────────────────────────────
    // 빗금 패턴 캐시
    // ────────────────────────────────────────────────────────────────────
    //
    // [용도]
    //   주의보·경보 단계 fill 에 사용할 CanvasPattern 을 생성/캐시.
    //   같은 (베이스 색상, 빗금 색상, dpr) 조합에 대해 매 스타일러 호출마다
    //   캔버스를 다시 만들면 낭비 → 키로 한 번만 생성하고 재사용.
    //
    // [DPR 인지 — 모바일에서 점처럼 보이지 않게 하는 핵심]
    //   OL 의 합성 캔버스는 HiDPI(devicePixelRatio 배율) 로 렌더되며,
    //   createPattern 의 tiling 단위는 CSS 픽셀이 아닌 캔버스 device 픽셀.
    //   → 단순히 14×14 캔버스를 만들면 DPR=3 폰에서 14/3 ≈ 4.67 CSS px 로
    //     너무 좁게 표출되어 빗금이 점처럼 보임.
    //   → 캔버스 크기를 TILE_CSS * dpr 로 두고 ctx.scale(dpr,dpr) 로 보정해
    //     "어느 디바이스에서도 동일한 CSS 픽셀 수의 간격" 을 보장.
    //
    // [지도 줌 무관성]
    //   CanvasPattern 은 화면(픽셀) 단위로 tile 되므로 지도 줌 변경에 영향
    //   받지 않음 — 사용자가 줌인/아웃 해도 빗금 간격은 항상 동일 px.
    //
    // [패턴 사양]
    //   14 CSS px 타일에 / 방향(forward slash) 대각선 1줄 + 좌상/우하 모서리
    //   짧은 보정선 → 인접 타일과 끊김 없이 자연스럽게 이어짐.
    //   빗금 두께 2.5 CSS px, perpendicular 간격 약 14/√2 ≈ 9.9 CSS px.
    // ────────────────────────────────────────────────────────────────────
    var _patternCache = {};

    function _stripeFillPattern(baseRgba, stripeRgba) {
        var dpr = window.devicePixelRatio || 1;
        var key = baseRgba + '|' + stripeRgba + '|' + dpr;
        if (_patternCache[key]) return _patternCache[key];

        var TILE_CSS = 14;     // 타일 변 길이 (CSS px)
        var LINE_W = 1.25;     // 빗금 두께 (CSS px) — 사용자 피드백으로 2.5 → 1.25
                               // 14 CSS px 타일 대비 약 9% → 또렷하지만 답답하지 않음

        var c = document.createElement('canvas');
        c.width = Math.round(TILE_CSS * dpr);
        c.height = Math.round(TILE_CSS * dpr);
        var x = c.getContext('2d');
        x.scale(dpr, dpr);  // 이후 모든 좌표는 CSS px 기준

        // 1) 베이스 색 (특보 종류색 + 단계별 알파) — 타일 전체
        x.fillStyle = baseRgba;
        x.fillRect(0, 0, TILE_CSS, TILE_CSS);

        // 2) 대각선 빗금 (/ 방향: 좌하단 → 우상단)
        //    좌상단 보정선 + 메인 가로지르는 1줄 + 우하단 보정선 → 시원한 간격
        x.strokeStyle = stripeRgba;
        x.lineWidth = LINE_W;
        x.lineCap = 'square';
        x.beginPath();
        x.moveTo(-3, 3);                          // 좌상단 모서리 보정 (이전 타일 연속)
        x.lineTo(3, -3);
        x.moveTo(0, TILE_CSS);                    // 메인선 (타일 중앙 가로지름)
        x.lineTo(TILE_CSS, 0);
        x.moveTo(TILE_CSS - 3, TILE_CSS + 3);     // 우하단 모서리 보정 (다음 타일 시작)
        x.lineTo(TILE_CSS + 3, TILE_CSS - 3);
        x.stroke();

        var pattern = x.createPattern(c, 'repeat');
        _patternCache[key] = pattern;
        return pattern;
    }

    /**
     * 색칠된 OL Style 객체 생성.
     *
     * [디자인]
     *   - fill:
     *       · upcoming(예비): 종류별 RGB + 알파 0.25 (단색만)
     *       · 주의보       : 종류별 RGB + 알파 0.40 + 회색 대각선 빗금 (gray-600)
     *       · 경보         : 종류별 RGB + 알파 0.55 + 빨간 대각선 빗금 (red-600)
     *     단계별 빗금 패턴은 _stripeFillPattern() 로 8×8 CanvasPattern 생성 → 캐시.
     *   - stroke: 종류별 RGB + 0.95 alpha (모든 단계 동일) — 윤곽선 또렷
     *   - 메인(부모) feature 는 라벨 표시(기존과 동일하게 흰색 글씨 + 검은 외곽)
     *   - 자식 feature 는 라벨 미표시 (부모 색을 따라가는 것이므로 라벨 중복 방지)
     *
     * [선택 강조 모드 (isSelected=true)]
     *   stroke 색을 OFF 상태 메인 outline 과 동일한 노란색
     *   (rgba(255, 200, 80, 0.95)) + 굵기 2.5px + 실선 으로 변경.
     *   fill 색은 그대로 유지하여 종류·단계 정보는 보존하되, 사용자가 어느 zone
     *   을 선택했는지 즉시 식별 가능.
     *
     * @param {Object} info - state.activeMap[zoneName] 항목
     * @param {string} kind - 'main' | 'sub'
     * @param {ol.Feature} feature - 라벨 텍스트 추출용
     * @param {boolean} isSelected - true 면 선택 강조 (노란 테두리)
     * @returns {ol.style.Style}
     */
    // [S13-B 추가] _holedGeometry (GeoJSON) → ol.geom (EPSG:3857) lazy 변환·캐시
    //   build_warn_zones_holed.js 가 warn_zones.geojson 각 부모 feature 의
    //   properties._holedGeometry 에 "자식 영역을 도려낸" polygon (EPSG:4326 GeoJSON)
    //   을 미리 계산해 저장. 클라이언트는 첫 사용 시 ol.format.GeoJSON 으로 변환해
    //   feature 에 캐시. 두 번째 사용부터는 메모리에서 즉시 사용.
    //
    //   적용 대상: 메인(부모) feature 의 활성 fill 만. stroke·text 는 원본 geometry 그대로.
    //   결과: 자식 영역엔 부모 fill 안 칠해짐 → 자식 fill 과 겹쳐 색 짙어지는 현상 해소.
    var _geojsonFormat = null;
    function _getHoledOlGeom(feature) {
        if (!feature) return null;
        var cached = feature.get('_holedOlGeom');
        if (cached) return cached;
        var holed = feature.get('_holedGeometry');
        if (!holed) return null;
        try {
            if (!_geojsonFormat) _geojsonFormat = new ol.format.GeoJSON();
            var olGeom = _geojsonFormat.readGeometry(holed, {
                featureProjection: 'EPSG:3857',
                dataProjection: 'EPSG:4326'
            });
            feature.set('_holedOlGeom', olGeom);
            return olGeom;
        } catch (e) {
            // 변환 실패 시 원본 geometry 로 fallback (사용자 명세 6 위반 안 됨)
            return null;
        }
    }

    function _coloredStyle(info, kind, feature, isSelected) {
        var palette = ns._const.ALERT_COLORS[info.paletteKey];
        if (!palette) return null;

        var rgb = palette.rgb;
        var fillAlpha = info.fillAlpha;
        var strokeAlpha = ns._const.STROKE_ALPHA;

        var stroke;
        if (isSelected) {
            // 선택 강조: ocean_warn_zone.js OFF 상태 메인 outline 색(노란) 사용
            // 굵기·실선으로 종류 색(초록/카키/빨강) 위에서도 또렷이 식별
            stroke = new ol.style.Stroke({
                color: 'rgba(255, 200, 80, 0.95)',
                width: 2.5,
                lineDash: null
            });
        } else {
            stroke = new ol.style.Stroke({
                color: 'rgba(' + rgb + ',' + strokeAlpha + ')',
                width: (kind === 'main') ? 2.0 : 1.6,
                // 메인은 실선 (활성 강조), 자식은 점선 (구분 유지)
                lineDash: (kind === 'main') ? null : [5, 3]
            });
        }
        // fill: 단계별 분기.
        // - upcoming        : 단색 fill (기존 동작 유지)
        // - 주의보 / 경보   : 단색 베이스 + 대각선 빗금 패턴 (신규)
        //   STAGE_STRIPE_RGBA 에서 단계별 빗금 색을 가져와 _stripeFillPattern 으로
        //   캔버스 패턴 생성. 결과 CanvasPattern 을 ol.style.Fill 의 color 에 직접
        //   넘김 (OL Fill 은 string·CanvasPattern 둘 다 지원).
        var baseRgba = 'rgba(' + rgb + ',' + fillAlpha + ')';
        var stripeRgba = ns._const.STAGE_STRIPE_RGBA[info.stage];
        var fillColorOrPattern = stripeRgba
            ? _stripeFillPattern(baseRgba, stripeRgba)
            : baseRgba;
        var fill = new ol.style.Fill({ color: fillColorOrPattern });

        // [S13-B] 메인(부모) feature 의 fill 만 _holedGeometry 적용 (있을 때),
        //   stroke·text 는 원본 geometry. 자식 영역에 부모 fill 이 안 칠해져
        //   자식 fill 과 겹쳐 색이 짙어지는 현상 해소.
        //   자식(sub) feature 는 holed 적용 대상 아님 (자식 자체가 차감 대상).
        var holedGeom = (kind === 'main') ? _getHoledOlGeom(feature) : null;

        var styles;
        if (holedGeom) {
            // fill 전용 Style (geometry = holed) + stroke·text 전용 Style (원본 geometry)
            var fillStyle = new ol.style.Style({
                fill: fill,
                geometry: holedGeom
            });
            var strokeStyle = new ol.style.Style({ stroke: stroke });
            styles = [fillStyle, strokeStyle];
        } else {
            // 자식 영역 없는 부모 또는 자식(sub) feature → 단일 Style 로 fill+stroke
            styles = [new ol.style.Style({ stroke: stroke, fill: fill })];
        }

        // 선택된 zone 은 같은 layer 안에서 최상단으로 그려지도록 zIndex 1000 부여.
        // [이유] 인접 zone 의 stroke 가 일부 구간에서 선택 테두리를 덮는 현상 방지.
        //        OL Style.zIndex 는 같은 layer 내 렌더 순서를 결정 (높을수록 위).
        if (isSelected) {
            for (var i = 0; i < styles.length; i++) styles[i].setZIndex(1000);
        }

        // 메인 feature 만 라벨 부여 (기존 _zoneStyle 의 라벨 위치/폰트 유지)
        // 라벨은 stroke 와 같은 (원본) geometry 에 부착 — 항상 마지막 Style 에 추가.
        if (kind === 'main' && feature) {
            // ocean_warn_zone.js 의 _normalizeZoneName 과 동일 규칙
            var name = ((feature.get('name') || '') + '')
                .replace(/\./g, '·')
                .replace(/\s+/g, '');
            styles[styles.length - 1].setText(new ol.style.Text({
                text: name,
                font: 'bold 11px "Pretendard", sans-serif',
                fill: new ol.style.Fill({ color: '#ffffff' }),
                stroke: new ol.style.Stroke({ color: 'rgba(0,0,0,0.85)', width: 3 }),
                overflow: false,
                placement: 'point'
            }));
        }

        // 단일 Style 이면 그 객체, 두 개면 배열 반환 (OL 둘 다 지원)
        return styles.length === 1 ? styles[0] : styles;
    }

    /**
     * 메인 라벨만 그리고 fill/stroke 는 거의 투명하게 만드는 "비활성 zone" 용 스타일.
     *
     * [용도]
     *   토글 ON 상태에서, 활성 특보가 없는 부모 zone 도 노란 점선 그대로 두면
     *   색칠된 zone 과 시각적으로 충돌. 색칠된 영역만 부각시키기 위해
     *   비활성 zone 은 매우 옅은 회색으로 죽여서 색칠된 zone 을 돋보이게.
     *
     *   ※ 단, 자식 feature 는 minZoom 해제로 멀리서도 그려지면 너무 복잡해질 수
     *     있어 자식은 _styler 에서 null 반환 → 기존 청록 점선 그대로 (이는
     *     "active 모드에서 자식을 어떻게 보여줄까" 디자인 선택; 자식이 부모와
     *     동일 색을 따라가야 하는 경우만 _coloredStyle 로 칠하므로 OK).
     *
     * @param {string} kind - 'main' | 'sub'
     * @param {ol.Feature} feature
     * @returns {ol.style.Style}
     */
    function _dimmedOutlineStyle(kind, feature) {
        var stroke = new ol.style.Stroke({
            color: 'rgba(140, 140, 140, 0.55)',
            width: 1.0,
            lineDash: [5, 4]
        });
        var fill = new ol.style.Fill({
            color: 'rgba(140, 140, 140, 0.03)'
        });
        var style = new ol.style.Style({ stroke: stroke, fill: fill });

        if (kind === 'main' && feature) {
            var name = ((feature.get('name') || '') + '')
                .replace(/\./g, '·')
                .replace(/\s+/g, '');
            style.setText(new ol.style.Text({
                text: name,
                font: '600 10px "Pretendard", sans-serif',
                fill: new ol.style.Fill({ color: '#cbd5e1' }),
                stroke: new ol.style.Stroke({ color: 'rgba(0,0,0,0.6)', width: 2 }),
                overflow: false,
                placement: 'point'
            }));
        }
        return style;
    }

    /**
     * "비활성 자식" 용 빈 스타일 — 활성 모드에서 자식이 활성 부모를 갖지 않는
     * 경우 사용. ol.style.Style 인스턴스이지만 stroke/fill/text 모두 없어
     * 렌더 결과가 0 (사실상 숨김). null 을 반환하면 ocean_warn_zone.js 의 기본
     * _subZoneStyle 로 fallback 되어 청록 점선 + 한국어 라벨이 줌 6~8 에서도
     * 모두 보이게 되는데, 활성 모드의 시각 의도(활성 zone 부각)에 반하므로 숨김.
     */
    var _EMPTY_STYLE = new ol.style.Style({});

    /**
     * OceanWarnZone 에 등록할 스타일러 본체.
     *
     * @param {ol.Feature} feature - 그려질 폴리곤 feature
     * @param {string} kind        - 'main' (44개 부모) | 'sub' (자식 49개)
     * @returns {ol.style.Style|ol.style.Style[]|null}
     *          truthy 반환 시 ocean_warn_zone.js 가 그 스타일 사용,
     *          null 반환 시 ocean_warn_zone.js 의 기본 outline 사용.
     */
    ns._styler = function (feature, kind) {
        // 토글 OFF 상태에선 절대 색칠 안 함 (안전망 — 보통 setActiveStyler(null) 로
        // 이미 해제되어 있지만 race condition 대비)
        if (!ns._state.active) return null;

        // [S9-D 변경] 자식(sub) 폴리곤 — 부모 종속 색칠을 폐지하고
        //   dmdw 머지 결과(appState.coastalAlerts) 기반으로 독립 판정·색칠.
        //
        // 이전 정책: 자식 항상 _EMPTY_STYLE (사실상 숨김) — 부모 색이 자식 영역도 덮음.
        // 신규 정책:
        //   • 자식에 active 한 dmdw 데이터가 있으면 자식 자체의 (wrnTp, wrnLvl) 로
        //     부모와 동일 팔레트 재활용해 색칠. 자식 fillLayer 의 zIndex=41 이
        //     부모 fillLayer zIndex=40 보다 위 → 자식 색이 부모 색을 정확히 덮음.
        //   • 자식 active 없으면 기존 _EMPTY_STYLE (부모는 부모 로직대로 색칠).
        //
        // [클릭 hit] 자식 폴리곤 클릭 처리는 S9-E 에서 별도 변경 — 자식 active 인
        //   경우 자식 전용 팝업, 그렇지 않으면 기존대로 부모로 환원.
        if (kind === 'sub') {
            var subFullName = window.OceanWarnZone && typeof window.OceanWarnZone.getSubFullName === 'function'
                ? window.OceanWarnZone.getSubFullName(feature)
                : null;
            if (!subFullName) return _EMPTY_STYLE;
            var subInfo = ns._buildChildInfoForStyle(subFullName);
            if (subInfo && subInfo.paletteKey) {
                // 자식은 현재 isSelected 강조 미지원 (선택 박스가 자식 단위로
                // 떠 있는 상태는 S9-E 의 자식 팝업 도입 후 별도로 표시 정책 검토).
                return _coloredStyle(subInfo, kind, feature, false);
            }
            return _EMPTY_STYLE;
        }

        // 이하 메인(부모) feature 만 처리.
        var parentZone = window.OceanWarnZone.getMainZoneName(feature);
        var info = parentZone ? ns._state.activeMap[parentZone] : null;
        // 사용자가 클릭하여 정보박스가 떠 있는 zone 인지 — 선택 강조 표시 용도.
        // 부모 main 의 polygon 이 zone 영역 전체 외곽을 한 줄로 그리므로
        // 노란 테두리가 영역 전체에 깔끔히 적용됨.
        var isSelected = !!parentZone && parentZone === ns._state.selectedZone;

        // 활성 맵에 항목 있고 paletteKey 까지 있으면 색칠
        if (info && info.paletteKey) {
            return _coloredStyle(info, kind, feature, isSelected);
        }

        // 활성 zone 아님 (해제됐거나 처음부터 색칠 가능 특보 없음)
        // 메인은 옅은 회색 점선 + 라벨 → 활성 zone 을 시각적으로 부각
        return _dimmedOutlineStyle(kind, feature);
    };
})();
