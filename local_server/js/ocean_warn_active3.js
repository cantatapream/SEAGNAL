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

        var style = new ol.style.Style({ stroke: stroke, fill: fill });

        // 선택된 zone 은 같은 layer 안에서 최상단으로 그려지도록 zIndex 1000 부여.
        // [이유] 인접 zone 의 stroke 가 일부 구간에서 선택 테두리를 덮는 현상 방지.
        //        OL Style.zIndex 는 같은 layer 내 렌더 순서를 결정 (높을수록 위).
        // [한계] 메인 layer(zIndex 80) 와 자식 layer(zIndex 81) 사이의 cross-layer
        //        순위는 layer 자체 zIndex 가 결정. 선택된 zone 은 자식 sub feature
        //        도 함께 노란 테두리이므로(_styler 가 isSelected 동일하게 적용),
        //        결과적으로 zone 영역 전체 외곽이 노란 테두리로 또렷이 보임.
        if (isSelected) {
            style.setZIndex(1000);
        }

        // 메인 feature 만 라벨 부여 (기존 _zoneStyle 의 라벨 위치/폰트 유지)
        if (kind === 'main' && feature) {
            // ocean_warn_zone.js 의 _normalizeZoneName 과 동일 규칙
            var name = ((feature.get('name') || '') + '')
                .replace(/\./g, '·')
                .replace(/\s+/g, '');
            style.setText(new ol.style.Text({
                text: name,
                font: 'bold 11px "Pretendard", sans-serif',
                fill: new ol.style.Fill({ color: '#ffffff' }),
                stroke: new ol.style.Stroke({ color: 'rgba(0,0,0,0.85)', width: 3 }),
                overflow: false,
                placement: 'point'
            }));
        }
        // 자식(sub) feature 의 라벨은 _styler 가 _subLabelOnlyStyle 로 분기해 처리.
        // 여기까지 'sub' kind 가 도달하지 않으므로 별도 분기 불필요.

        return style;
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
        // 자식(sub) feature 의 라벨은 _styler 가 _subLabelOnlyStyle 로 분기해 처리.
        // 여기까지 'sub' kind 가 도달하지 않으므로 별도 분기 불필요.
        return style;
    }

    /**
     * "자식 라벨 전용" 스타일 — 활성 모드에서 자식해역의 fill/stroke 는 그리지
     * 않고 라벨만 표출한다.
     *
     * [왜 라벨만?]
     *   - fill/stroke 정책: 자식 polygon 의 fill 은 부모 main polygon 과 영역이
     *     겹쳐 alpha 합성으로 색이 진해지는 부작용(예: 주의보→경보로 오인) 이 있어
     *     활성 모드에선 자식 fill/stroke 를 그리지 않는 정책 유지.
     *   - 라벨만: 사용자 요청 — 자식 라벨은 일반 모드와 같은 위치/텍스트로 표출해
     *     활성 모드 전환 시 자식해역 식별 가능성을 잃지 않게 한다.
     *
     * [텍스트/오프셋 규칙]
     *   ocean_warn_zone.js 의 _buildSubZoneTextStyle 공유 — SUBZONE_LABEL_MAP,
     *   _shortLabel, SUBZONE_LABEL_OFFSET 동일 적용. 색만 활성 색칠 위 가독성을
     *   위해 흰색 + 검은 stroke 3.5px 로 오버라이드.
     *
     * @param {ol.Feature} feature
     * @returns {ol.style.Style}
     */
    function _subLabelOnlyStyle(feature) {
        var style = new ol.style.Style({});
        if (feature && window.OceanWarnZone
            && window.OceanWarnZone.buildSubZoneTextStyle) {
            var subText = window.OceanWarnZone.buildSubZoneTextStyle(feature, {
                fillColor: '#ffffff',
                strokeColor: 'rgba(0,0,0,0.95)',
                strokeWidth: 3.5
            });
            if (subText) style.setText(subText);
        }
        return style;
    }

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

        // [자식(sub) feature 정책 — 라벨만 표출]
        //
        // [fill/stroke 미표출] 자식 zone polygon 은 부모 zone polygon 의 부분집합.
        //   두 polygon 모두 fill 을 그리면 같은 영역에 fill 이 두 번 겹쳐
        //   alpha 합성으로 색이 진해짐 (예: 주의보 0.5 + 0.5 ≒ 0.75 → 경보처럼 보임).
        //   따라서 활성 모드에서 자식 fill/stroke 는 그리지 않는 정책 유지.
        //
        // [라벨만 표출] 사용자 요청 — 일반 모드(_subZoneStyle) 와 활성 모드에서
        //   자식해역 라벨이 동일한 위치·텍스트로 보여야 UX 일관. 부모 라벨과 자식
        //   라벨이 함께 보여 사용자가 자식해역 단위까지 식별 가능.
        //   텍스트/오프셋 규칙은 ocean_warn_zone.js 의 _buildSubZoneTextStyle 공유.
        //
        // [클릭 hit] 자식 영역의 어떤 픽셀을 클릭해도 부모 main polygon 이 그 좌표
        //   를 포함하므로 forEachFeatureAtPixel 이 부모 main 을 hit → tryHandleClick
        //   이 부모 zone 으로 박스 표출. 라벨만 그려도 클릭 동작 정상.
        if (kind === 'sub') return _subLabelOnlyStyle(feature);

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
