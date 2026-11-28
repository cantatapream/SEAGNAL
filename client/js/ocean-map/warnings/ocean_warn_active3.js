/**
 * ============================================================================
 * 파일명: js/ocean_warn_active3.js  (3/5 — 폴리곤 색상 스타일러)
 * 역할 : OceanWarnZone.setActiveStyler 에 등록할 스타일 함수 구현.
 *        부모/자식 feature 별로 활성 맵을 조회해 색칠 또는 기본 outline fallback.
 * [연계]
 *  - 사용하는 파일 : ocean_warn_active1.js(네임스페이스), ocean_warn_active2.js(활성 맵/_buildChildInfoForStyle),
 *                    ocean_warn_zone.js(buildSubZoneTextStyle/getSubFullName/getMainZoneName), OpenLayers(ol.style.*)
 *  - 서버 API      : 없음
 *  - 마크업        : 없음 (폴리곤 OL Style 만 반환)
 *  - 나를 쓰는 곳  : ns._styler — ocean_warn_active4.js _activate 가 OceanWarnZone.setActiveStyler(ns._styler)로 등록
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

    function _stripeFillPattern(baseRgba, stripeRgba, cross) {
        var dpr = window.devicePixelRatio || 1;
        var key = baseRgba + '|' + stripeRgba + '|' + dpr + (cross ? '|x' : '');
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
        // 3) [새 모드 · 경보] 반대 방향(\ : 좌상단 → 우하단) 빗금을 하나 더 그어 ✕ 격자로 만든다.
        //    2026-11-22 사용자 「주의보와 경보가 … 거의 동일해서 잘 안보임 … 경보는 추가로 좌측 상단에서
        //    우측 하단으로 내려오는 대각선이 있으면 좋겠어 … (태풍 경보도 동일하게 반영)」
        if (cross) {
            x.moveTo(-3, TILE_CSS - 3);               // 좌하단 모서리 보정
            x.lineTo(3, TILE_CSS + 3);
            x.moveTo(0, 0);                           // 메인선
            x.lineTo(TILE_CSS, TILE_CSS);
            x.moveTo(TILE_CSS - 3, -3);               // 우상단 모서리 보정
            x.lineTo(TILE_CSS + 3, 3);
        }
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

    /** 이름표 글자 폭(px) — 세모를 이름 바로 오른쪽에 놓기 위해 잰다. 같은 이름은 한 번만 잰다. [연계] ← _coloredStyle */
    var _lwCache = {}, _lwCtx = null;
    function _labelWidth(name) {
        if (_lwCache[name]) return _lwCache[name];
        try {
            if (!_lwCtx) { _lwCtx = document.createElement('canvas').getContext('2d'); }
            _lwCtx.font = 'bold 11px "Pretendard", sans-serif';
            return (_lwCache[name] = _lwCtx.measureText(name).width);
        } catch (e) { return name.length * 11; }   // 캔버스를 못 쓰는 환경 — 글자 수로 어림
    }

    /**
     * 그 특보구역에 달 세모 — 'up'(더 높은 단계로 오를 수 있음) · 'down'(더 낮은 특보가 다가옴) · ''(없음).
     * 첫 화면 특보 카드(forecast/alerts/render.js)와 같은 규칙이다: 다가오는 특보로 본 오르내림(zoneTrend)이 먼저이고,
     * 그것이 없으면 기상청이 글로 알린 「경보·태풍 변경 가능성」(zoneEscalations)이 있을 때 'up'.
     * 예: 풍랑주의보 발효 + 풍랑경보 발표 → 'up' / 풍랑경보 발효 + 풍랑주의보 발표 → 'down' / 주의보만 → ''
     * @param {string} zoneName 특보구역 이름 @param {object} info state.activeMap 의 그 구역(allCurrents·allUpcomings) @returns {'up'|'down'|''}
     * [연계] ← _coloredStyle(지도 이름표) · ocean_warn_active5.js(팝업 머리 뱃지) / → window.zoneTrend·zoneEscalations(forecast/alerts/escalation.js)
     */
    /** 카드가 쓰는 꼴({current, upcoming})로 바꾼다 — 발효 중인 것 가운데 풍랑·태풍 특보(높은 것 먼저)를 대표로 삼는다(강풍 등은 오르내림을 견주지 않는다). */
    ns._zoneCardState = function (info) {
        var rank = function (a) {
            var t = String((a && a.warnType) || ''), l = String((a && a.level) || '');
            return (t.indexOf('태풍') >= 0 ? 20 : t.indexOf('풍랑') >= 0 ? 10 : 0) + (l.indexOf('경보') >= 0 ? 2 : l.indexOf('주의') >= 0 ? 1 : 0);
        };
        var curs = ((info && info.allCurrents) || []).slice().sort(function (a, b) { return rank(b) - rank(a); });
        return { current: curs[0] || null, upcoming: (info && info.allUpcomings) || [] };
    };
    ns._zoneTrendOf = function (zoneName, info) {
        if (!info) return '';
        var st = ns._zoneCardState(info);
        var t = typeof window.zoneTrend === 'function' ? window.zoneTrend(st) : '';
        if (t === 'up' || t === 'down') return t;
        var esc = typeof window.zoneEscalations === 'function' ? window.zoneEscalations(zoneName, st) : [];
        return esc && esc.length ? 'up' : '';
    };

    function _coloredStyle(info, kind, feature, isSelected) {
        var palette = ns._const.ALERT_COLORS[info.paletteKey];
        if (!palette) return null;

        var rgb = palette.rgb;
        var fillAlpha = info.fillAlpha;
        var strokeAlpha = ns._const.STROKE_ALPHA;

        var stroke;
        if (isSelected) {
            // 선택 강조: ocean_warn_zone.js OFF 상태 메인 outline 색(노란) 사용
            // 굵기·실선으로 종류 색(초록/빨강) 위에서도 또렷이 식별
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
        // 경보의 ✕ 격자는 새 모드(body.om-mode)에서만 — 평소 화면은 종전 한 방향 빗금 그대로
        //   ★단계 값은 한글 '경보' 다(ocean_warn_active1.js STAGE_STRIPE_RGBA 의 열쇠 · _resolveStage). 2026-11-22 에 넣을 때 'warn' 으로 견줘
        //     한 번도 참이 아니었다 — 범례(CSS)만 ✕ 로 보이고 지도는 한 방향 빗금이었다(사용자 2026-11-24 「경보는 빗금이 x자로 되어야하는데」).
        var crossHatch = info.stage === '경보' && document.body.classList.contains('om-mode');
        var fillColorOrPattern = stripeRgba
            ? _stripeFillPattern(baseRgba, stripeRgba, crossHatch)
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
            var shown = ((window.ZoneSplit && window.ZoneSplit.displayName) ? window.ZoneSplit.displayName(name) : name);   // 이름표만 보이는 이름(2026-11-28)
            styles[styles.length - 1].setText(new ol.style.Text({
                text: shown,
                font: 'bold 11px "Pretendard", sans-serif',
                fill: new ol.style.Fill({ color: '#ffffff' }),
                stroke: new ol.style.Stroke({ color: 'rgba(0,0,0,0.85)', width: 3 }),
                overflow: false,
                placement: 'point'
            }));
            // [새 메뉴 화면 — 2026-11-23] 구역 이름 오른쪽에 격상(빨강 ▲)·격하(초록 ▼) 세모 — 첫 화면 특보 카드의 세모와 같은 규칙.
            //   사용자 「구역명칭 오른쪽에 격상, 격하를 의미하는 화살표 … 그 해역은 격상, 격하 가능성이 있다는 사항을 나타내고자」.
            //   글자색을 한 이름표 안에서 나눌 수 없어, 이름 폭을 재서 그 오른쪽에 세모만 따로 그린다.
            var trend = document.body.classList.contains('om-mode') ? ns._zoneTrendOf(name, info) : '';
            if (trend) {
                var tri = new ol.style.Style({ text: new ol.style.Text({
                    text: trend === 'down' ? '▼' : '▲',
                    // 크기 — 사용자 2026-11-23 「세모가 너무 작은것 같은데 글씨크기의 3/4정도는 되어야」. 세모 글자는 제 글자 크기의 약 6할 높이로 그려져,
                    //   이름표(11px) 높이의 3/4(약 8px)이 되려면 14px 로 적는다.
                    font: 'bold 14px Arial, sans-serif',
                    fill: new ol.style.Fill({ color: trend === 'down' ? '#10b981' : '#ff3b3b' }),
                    stroke: new ol.style.Stroke({ color: 'rgba(255,255,255,0.95)', width: 2.5 }),
                    offsetX: Math.round(_labelWidth(shown) / 2) + 10,
                    overflow: true,          // 세모는 작다 — 이름표가 보이는 한 같이 보이게(이름표가 가려질 만큼 좁은 구역에서는 세모만 남는다)
                    placement: 'point'
                }) });
                tri._omTrend = true;         // ocean_warn_zone.js _onlyStrokeAndText 가 이 표시를 보고 선·이름표 층에 함께 싣는다
                tri._omLabelW = _labelWidth(shown);   // 이름표 폭 — 이름표가 숨는 축척에서는 세모를 구역 안(이름표 자리)으로 옮긴다(ocean_warn_zone.js _placeTrend, 2026-11-28)
                if (isSelected) tri.setZIndex(1000);
                styles.push(tri);
            }
        }
        // 자식(sub) feature 의 라벨은 _styler 가 _subLabelOnlyStyle 로 분기해 처리.
        // 여기까지 'sub' kind 가 도달하지 않으므로 별도 분기 불필요.

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
                text: ((window.ZoneSplit && window.ZoneSplit.displayName) ? window.ZoneSplit.displayName(name) : name),   // 이름표만 보이는 이름(2026-11-28)
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
     * "자식 외곽선 + 라벨" 스타일 — 활성 모드에서 자식해역이 비활성일 때 사용.
     *
     * [정책 변경 이력]
     *   (a) 640afb7 (2026-04): 활성 모드에서 비활성 자식은 _EMPTY_STYLE 로 완전 숨김.
     *       이유: setSubMinZoomDisabled(true) 로 minZoom 해제되어 줌 6~8 에서도
     *       자식 청록 점선 + 라벨 다수 표출 → 시각 노이즈.
     *   (b) 5acafbe (2026-05): 라벨만 그리고 fill/stroke 는 미표출. 사용자 식별성 부분 회복.
     *   (c) 본 수정 (v7 머지 후): 라벨 + **얇은 회색 점선 외곽선** 추가.
     *       이유: 사용자 보고 — "특보구역 ON 시 자식 zone (연안바다/평수구역) 의
     *       테두리가 안 보임". 부모가 활성으로 색칠된 zone 에선 _holedGeometry
     *       로 자식 영역을 도려내 부모 fill 의 경계가 자연스러운 자식 테두리
     *       역할을 했지만, **부모가 비활성**인 zone 에선 그 경계조차 없어 자식
     *       구역이 보이지 않음. 부분 회귀 (일부 zone OK, 일부 NG) 가 이 차이에서
     *       기인.
     *
     * [선 사양]
     *   _dimmedOutlineStyle (메인 비활성) 과 동일 색조(rgba(140,140,140,0.55))
     *   + 점선 [5,4] + width 1.0 → 비활성 메인과 통일된 시각 무게.
     *   fill 은 미설정 (활성 색칠과 alpha 합성 부작용 회피).
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
        var style = new ol.style.Style({
            stroke: new ol.style.Stroke({
                color: 'rgba(140, 140, 140, 0.55)',
                width: 1.0,
                lineDash: [5, 4]
            })
        });
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

        // [자식(sub) feature 정책 — main S9-D 자체 색칠 + 우리 자식 라벨 결합]
        //
        // 두 개의 머지된 정책을 함께 적용:
        //
        // (A) main S9-D — 자식 폴리곤 독립 색칠:
        //   자식에 active 한 dmdw 데이터가 있으면 자식 자체의 (wrnTp, wrnLvl) 로
        //   부모 팔레트 재활용해 색칠. 자식 fillLayer (zIndex=41) 가 부모(zIndex=40) 위라
        //   자식 색이 부모 색을 정확히 덮음.
        //
        // (B) 우리 라벨 정책 — 자식 라벨 항상 표출:
        //   일반 모드(_subZoneStyle) 와 활성 모드에서 자식해역 라벨이 동일한
        //   위치·텍스트로 보여야 UX 일관. 부모와 자식 라벨이 함께 보여 자식해역
        //   단위 식별 가능. 텍스트/오프셋은 ocean_warn_zone.js 의 buildSubZoneTextStyle 공유.
        //
        // 결합 동작:
        //   • 자식 자체 active dmdw → _coloredStyle(자체 색칠) + 자식 라벨
        //   • 자식 active 없음     → 라벨만 (_subLabelOnlyStyle), 부모 색이 영역 덮음
        //
        // [클릭 hit] 자식 active 면 자식 전용 팝업(S9-E), 아니면 부모 main polygon 으로 환원.
        if (kind === 'sub') {
            var subFullName = window.OceanWarnZone && typeof window.OceanWarnZone.getSubFullName === 'function'
                ? window.OceanWarnZone.getSubFullName(feature)
                : null;
            if (subFullName) {
                var subInfo = ns._buildChildInfoForStyle(subFullName);
                if (subInfo && subInfo.paletteKey) {
                    // 자식 자체 active → 색칠 + 라벨 결합. _coloredStyle 은 sub 일 때 라벨 미설정 →
                    // 공용 빌더로 만든 라벨을 명시적으로 setText.
                    // 자식 단위 선택 강조 — selectedSubName 과 일치하면 노란 stroke 적용.
                    var isSubSelected = !!ns._state.selectedSubName
                        && subFullName === ns._state.selectedSubName;
                    var coloredStyle = _coloredStyle(subInfo, kind, feature, isSubSelected);
                    if (coloredStyle) {
                        var subText = window.OceanWarnZone && typeof window.OceanWarnZone.buildSubZoneTextStyle === 'function'
                            ? window.OceanWarnZone.buildSubZoneTextStyle(feature, {
                                fillColor: '#ffffff',
                                strokeColor: 'rgba(0,0,0,0.95)',
                                strokeWidth: 3.5
                            })
                            : null;
                        if (subText) coloredStyle.setText(subText);
                        return coloredStyle;
                    }
                }
            }
            // 자식 active 없음 → 라벨만 (부모 색이 자식 영역 덮음).
            return _subLabelOnlyStyle(feature);
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
