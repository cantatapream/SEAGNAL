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

    /**
     * 색칠된 OL Style 객체 생성.
     *
     * [디자인]
     *   - fill: 종류별 RGB + 단계별 alpha (3단계)
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
        var fill = new ol.style.Fill({
            color: 'rgba(' + rgb + ',' + fillAlpha + ')'
        });

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

        // 어느 부모 zone 에 속하는지 결정
        var parentZone;
        if (kind === 'main') {
            parentZone = window.OceanWarnZone.getMainZoneName(feature);
        } else { // 'sub'
            var fullName = window.OceanWarnZone.getSubFullName(feature);
            parentZone = ns._resolveParentByFullName(fullName);
        }

        var info = parentZone ? ns._state.activeMap[parentZone] : null;
        // 사용자가 클릭하여 정보박스가 떠 있는 zone 인지 — 선택 강조 표시 용도.
        // 부모/자식 모두 같은 selectedZone(=부모) 을 공유하므로 해당 영역 전체가
        // 노란 테두리로 강조됨 (자식 클릭도 부모로 환원되는 정책과 시각 일관성).
        var isSelected = !!parentZone && parentZone === ns._state.selectedZone;

        // 활성 맵에 항목 있고 paletteKey 까지 있으면 색칠
        if (info && info.paletteKey) {
            return _coloredStyle(info, kind, feature, isSelected);
        }

        // 활성 zone 아님 (해제됐거나 처음부터 색칠 가능 특보 없음)
        if (kind === 'main') {
            // 메인은 옅은 회색 점선 + 라벨 → 활성 zone 을 시각적으로 부각
            return _dimmedOutlineStyle(kind, feature);
        }
        // 자식은 빈 스타일로 숨김 — 활성 모드에서 minZoom 해제로 모든 줌에서 그려지므로
        // 비활성 자식까지 청록 점선/라벨로 보이면 시각 노이즈 + 베이스맵 가독성 저하.
        return _EMPTY_STYLE;
    };
})();
