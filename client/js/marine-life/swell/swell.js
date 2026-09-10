/**
 * ============================================================================
 * 파일명: client/js/marine-life/swell/swell.js
 * 역할  : 해양생활 "너울" 탭 — 해안선을 소해구별 너울 위험등급 색으로 칠해 보여준다.
 *         (관심=초록 · 주의=연노랑 · 경계=주황 · 위험=빨강, 기상청 범례와 같은 색)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : client/coastline_segments.json (해안선 조각 + 조각별 소해구 번호)
 *                    ↳ local_server/scripts/build_coastline_segments.js 가 만든다
 *  - 서버 API      : GET /api/swell-smallzone?coast=1  → 소해구별 등급(1~4)
 *                    (routes/swell_smallzone.js · services/swell_smallzone.js)
 *  - 마크업        : index2.html 의 #swell-section (#swell-map, #swell-publish-time 등)
 *  - 나를 쓰는 곳  : js/forecast/alerts/marine.js 의 _onSectionActivated('swell-section')
 *                    → window.initSwellMap() 호출
 *                    js/marine-life/safety/life_safety.js → window.getSwellMap()
 *                    (오른쪽 세로 레일에서 고르고 배경지도를 갈아끼울 때)
 * [로드 순서] js/marine-life/ripcurrent/ripcurrent.js 다음 — 순서 변경 금지
 *
 * [왜 해안선을 칠하나]
 *   너울은 먼바다보다 "해안에 부딪힐 때"가 위험하다. 그래서 바다 전체를 칠하지 않고
 *   해안선만 칠한다. 해안선 조각마다 어느 소해구에 속하는지는 미리 계산해 두었으므로
 *   앱은 등급표(우리 해안 소해구 233개)만 받아 색을 입히면 된다.
 *
 * [어떻게 그리나 — 선이 아니라 번지는 띠]
 *   ① 등급을 섞는다 : 해안선 점마다 가까운 소해구 여러 곳의 등급을 거리로 가중평균해
 *      1~4 사이 "연속값"을 만든다. 해구는 사람이 그은 네모라서 칸이 바뀌는 자리에서
 *      색이 뚝 끊기는데, 값 자체를 섞으면 그 자리가 자연스럽게 이어진다.
 *   ② 색을 잇는다   : 연속값을 등급 색 네 가지 사이에서 이어 붙인 색표로 바꾼다.
 *      (2.5 = 주의와 경계의 중간색)
 *   ③ 번지게 그린다 : 캔버스에 굵은 띠로 그린 뒤 통째로 한 번 흐리게 만든다.
 *      가운데는 진하고 가장자리로 갈수록 연해져 그라데이션이 된다.
 *   그 위에 가는 심지선을 얹어 해안선이 어디인지 알아볼 수 있게 한다.
 * ============================================================================
 */

(function () {
    'use strict';

    // ========================================================================
    // 상수
    // ========================================================================

    /**
     * 등급(1~4) → 이름 · 색(rgb). 색은 MMIS 너울 범례와 같은 계열이다.
     * 등급 사이 값(예: 2.5)은 이웃한 두 색을 이어 붙여 쓴다(_colorAt).
     */
    const LEVELS = {
        1: { name: '관심', rgb: [31, 162, 74] },
        2: { name: '주의', rgb: [228, 214, 75] },
        3: { name: '경계', rgb: [240, 138, 36] },
        4: { name: '위험', rgb: [224, 49, 49] }
    };
    /** 등급을 못 받은 해안(자료 없음). */
    const NO_DATA_RGB = [154, 163, 173];

    const SEGMENTS_URL = '/coastline_segments.json';
    const LEVELS_URL = '/api/swell-smallzone?coast=1';

    const KOREA_CENTER = ol.proj.fromLonLat([127.8, 35.9]);
    const DEFAULT_ZOOM = 7;

    /**
     * 등급을 섞는 반경(km)과 세기.
     * 소해구가 약 15×18.5km 이므로 32km 면 이웃 한두 칸이 함께 섞인다.
     * POWER 가 클수록 자기 칸 값을 더 지킨다(2 = 거리 제곱 반비례, 흔히 쓰는 값).
     */
    const BLEND_KM = 32;
    const BLEND_POWER = 2;

    /**
     * 확대 정도(줌)별 그라데이션 띠의 굵기(px)와 가는 심지선 굵기(px).
     * 띠는 흐리게 번지므로 실제로 보이는 폭은 이보다 넓다.
     */
    const BAND_BY_ZOOM = [
        { maxZoom: 7, band: 6.5, core: 1.2 },
        { maxZoom: 9, band: 9, core: 1.6 },
        { maxZoom: 11, band: 13, core: 2.2 },
        { maxZoom: 99, band: 17, core: 2.6 }
    ];
    /** 띠 굵기 대비 흐림 반경. 클수록 더 뭉개진다. */
    const BLUR_RATIO = 0.55;
    /**
     * 띠의 진하기(0~1). 캔버스에는 불투명하게 그리고 옮겨 담을 때 이 값을 한 번 먹인다 —
     * 반투명한 선을 여러 번 겹쳐 그리면 겹치는 자리마다 더 진해져 얼룩이 진다.
     * (실측 2026-09-10: 0.85 로 그렸는데 진하기 90~100% 인 점이 12,804개 나왔다.
     *  섬이 많은 다도해·서해안이 특히 지저분했다.)
     */
    const BAND_ALPHA = 0.85;
    /** 색을 이 간격으로 반올림해 같은 색끼리 묶어 그린다(그리는 횟수를 줄이려고). */
    const COLOR_STEP = 0.08;

    /**
     * 해안선이 몰린 곳은 띠를 의도적으로 얇게 그린다(사용자 확정 2026-09-10).
     * 섬이 촘촘한 다도해·서해안 갯벌에서는 띠끼리 겹쳐 한 덩어리로 뭉쳐 보이기 때문이다.
     *
     * 기준은 조각마다 미리 재어 둔 값(coastline_segments.json 의 `d`) —
     * **그 조각 둘레 약 227km²(14×17km) 안에 해안선이 몇 km 있는가**이다.
     *
     * 실측(2026-09-10, 조각 1,123개): 전체 중앙 66km · 75% 94km · 95% 129km.
     * 지역별로는 다도해(신안·진도) 화면 안 258조각의 중앙이 92km,
     * 동해안(강릉·삼척) 화면 안 15조각의 중앙이 25km 다 — 이 차이에 맞춰 나눴다.
     * (처음엔 100/130km 로 잡았다가, 그러면 다도해 조각의 절반 이상이 "보통"으로
     *  분류돼 아무것도 안 줄어드는 것을 실측으로 확인하고 낮췄다.)
     */
    const DENSE_STEPS = [
        { km: 120, scale: 0.38 },   // 아주 몰림 — 다도해 안쪽·서해안 갯벌
        { km: 90, scale: 0.55 },    // 많이 몰림
        { km: 60, scale: 0.75 },    // 조금 몰림
        { km: 0, scale: 1.00 }      // 보통 — 그대로
    ];

    // ========================================================================
    // 상태
    // ========================================================================
    let swellMap = null;
    let coastLayer = null;    // 가는 심지선(벡터)
    let bandLayer = null;     // 그라데이션 띠(캔버스)
    let segments = null;      // coastline_segments.json 의 segments (한 번만 받아 재사용)
    let zoneCenters = null;   // { "144-9": [경도, 위도] } — 등급을 섞을 때 쓴다

    // ========================================================================
    // 1. 지도 초기화
    // ========================================================================

    /**
     * 너울 탭 지도를 만들고 해안선을 칠한다. 이미 만들었으면 크기만 다시 잡는다.
     * 예: 사용자가 해양생활 → 너울 탭을 누르면 호출된다.
     * @returns {void}
     * [연계] ← js/forecast/alerts/marine.js 의 _onSectionActivated()
     *          → _loadAndDraw() 로 자료를 받아 그린다.
     */
    window.initSwellMap = function () {
        if (swellMap) {
            swellMap.updateSize();
            _loadAndDraw();
            return;
        }

        // 아래: 그라데이션 띠. OpenLayers 의 선 스타일로는 "번지는 면"을 만들 수 없어서
        // 캔버스에 직접 그린다(_renderBand).
        bandLayer = new ol.layer.Image({
            source: new ol.source.ImageCanvas({
                canvasFunction: _renderBand,
                ratio: 1.2   // 화면보다 조금 넓게 그려 살짝 움직여도 가장자리가 안 비게 한다
            })
        });

        // 위: 가는 심지선. 띠만 있으면 해안선이 어디인지 흐려지므로 한 줄 얹는다.
        // 스타일을 조각마다 박아두지 않고 레이어 함수로 준다 — 그래야 확대·축소할 때마다
        // 다시 계산돼 줌에 맞는 굵기가 적용된다(조각에 박아두면 처음 굵기로 고정된다).
        coastLayer = new ol.layer.Vector({
            source: new ol.source.Vector(),
            style: function (feature, resolution) {
                return _coreStyle(feature.get('v'), resolution);
            }
        });

        swellMap = new ol.Map({
            target: 'swell-map',
            layers: [
                new ol.layer.Tile({ source: new ol.source.OSM() }),
                bandLayer,
                coastLayer
            ],
            view: new ol.View({
                center: KOREA_CENTER,
                zoom: DEFAULT_ZOOM,
                minZoom: 6,
                maxZoom: 13
            }),
            controls: ol.control.defaults.defaults({ attribution: false, zoom: false })
                .extend([new ol.control.Attribution({ collapsible: false })])
        });

        _addLegendControl(swellMap);
        _bindEvents();
        _loadAndDraw();
    };

    /**
     * 이 탭의 지도 인스턴스를 준다(아직 안 만들었으면 null).
     * 예: 해양안전생활 화면이 배경지도를 "전자해도"로 바꿀 때 이 지도를 받아 갈아끼운다.
     * @returns {ol.Map|null}
     * [연계] ← js/marine-life/safety/life_safety.js 의 ACTIVITIES[].getMap
     *          다른 활동(getFishingMap·getSwimmingMap 등)과 같은 규약이다.
     */
    window.getSwellMap = function () { return swellMap; };

    // ========================================================================
    // 2. 자료 받아 그리기
    // ========================================================================

    /**
     * 해안선 조각과 소해구별 등급을 받아 지도에 색칠한다.
     * 예: 조각 1,123개 × 등급표 233개 → 등급 색이 입혀진 해안선
     * @returns {Promise<void>}
     * [연계] ← initSwellMap() · 새로고침 버튼
     *          → _draw() 가 실제로 선을 만든다.
     */
    async function _loadAndDraw() {
        // 불러오는 동안에는 '기준: -' 그대로 둔다. 해양안전생활 화면이 이 칸을 읽어
        // 토스트로 띄우는데(life_safety.js _toastPublishTime), '-' 를 "아직 값 없음"으로
        // 보고 0.5초 간격으로 네 번 다시 보기 때문이다. '불러오는 중…' 을 넣으면
        // 그것을 값으로 오해해 그대로 띄운다.
        _setStatus('기준: -');
        try {
            if (!segments) {
                const r = await fetch(SEGMENTS_URL);
                if (!r.ok) throw new Error('해안선 파일 ' + r.status);
                const j = await r.json();
                segments = j.segments || [];
                zoneCenters = j.zone_centers || {};
                _prepareSegments();
            }
            const r2 = await fetch(LEVELS_URL);
            if (!r2.ok) throw new Error('등급 API ' + r2.status);
            const data = await r2.json();
            if (!data.success) throw new Error(data.error || '등급 API 실패');

            _draw(data.levels || {});
            _setStatus(data.fctTm ? ('예보 ' + data.fctTm) : '예보시각 없음');
        } catch (e) {
            console.error('[swell] 표출 실패:', e.message);
            _setStatus('자료를 불러오지 못했습니다');
        }
    }

    /**
     * 해안선 좌표를 지도 좌표로 미리 바꿔 둔다(파일을 처음 받았을 때 한 번만).
     * 예: seg.c = [128.32, 38.70, ...] → seg._m = [14284000, 4677000, ...]
     * @returns {void}
     * [연계] ← _loadAndDraw()
     *          매번 그릴 때마다 11,833개 점을 변환하면 확대·축소가 버벅인다.
     */
    function _prepareSegments() {
        for (const seg of segments) {
            const c = seg.c;
            const m = new Float64Array(c.length);
            for (let i = 0; i < c.length; i += 2) {
                const xy = ol.proj.fromLonLat([c[i], c[i + 1]]);
                m[i] = xy[0];
                m[i + 1] = xy[1];
            }
            seg._m = m;
        }
    }

    /**
     * 해안선 점마다 "1~4 사이 연속값"을 만든다 — 가까운 소해구들의 등급을
     * 거리로 가중평균한 값이다.
     * 예: 주의(2)인 칸과 위험(4)인 칸 사이 해안 → 2.6, 3.1, 3.5 … 로 이어진다
     * @param {Object} levels - { "92-7": 3, ... } 소해구별 등급(1~4)
     * @returns {number} 값을 얻은 점의 개수(확인용)
     * [연계] ← _draw()
     *
     * [왜 섞나] 해구는 사람이 그은 네모다. 칸 하나만 그대로 칠하면 칸이 바뀌는
     *   자리에서 색이 뚝 끊겨 실제보다 급한 변화처럼 보인다. 바다의 너울은 그렇게
     *   칸 경계에서 갑자기 변하지 않으므로, 이웃 칸 값을 함께 섞어 이어 준다.
     */
    function _blendLevels(levels) {
        // 등급을 가진 소해구의 한가운데 좌표만 모은다.
        const cx = [], cy = [], cv = [];
        for (const key in levels) {
            const lv = levels[key];
            const c = zoneCenters && zoneCenters[key];
            if (!lv || !c) continue;
            cx.push(c[0]);
            cy.push(c[1]);
            cv.push(lv);
        }

        // 위경도 1도가 몇 km 인지 — 우리 해역(위도 33~38도) 한가운데를 기준으로 잡는다.
        const KM_PER_LAT = 111.0;
        const KM_PER_LON = 91.0;
        const R2 = BLEND_KM * BLEND_KM;
        let got = 0;

        for (const seg of segments) {
            const c = seg.c;
            const n = c.length / 2;
            const v = new Float32Array(n);
            for (let i = 0; i < n; i++) {
                const lon = c[i * 2], lat = c[i * 2 + 1];
                let sw = 0, sv = 0;
                let bestD = Infinity, bestV = 0;
                for (let k = 0; k < cx.length; k++) {
                    const dx = (lon - cx[k]) * KM_PER_LON;
                    const dy = (lat - cy[k]) * KM_PER_LAT;
                    const d2 = dx * dx + dy * dy;
                    if (d2 < bestD) { bestD = d2; bestV = cv[k]; }
                    if (d2 > R2) continue;
                    // 반경 끝에서 0 이 되도록 낮춰 준다 — 그래야 반경 밖 칸이 갑자기
                    // 끼어들 때 값이 튀지 않는다.
                    const fall = 1 - d2 / R2;
                    const w = fall * fall / Math.pow(d2 + 0.5, BLEND_POWER / 2);
                    sw += w;
                    sv += w * cv[k];
                }
                // 반경 안에 아무 칸도 없으면(외딴 섬) 가장 가까운 칸 값을 그대로 쓴다.
                v[i] = sw > 0 ? (sv / sw) : (bestD < Infinity ? bestV : 0);
                if (v[i] > 0) got++;
            }
            seg._v = v;
        }
        return got;
    }

    /**
     * 섞은 값으로 띠와 심지선을 다시 그린다.
     * @param {Object} levels - { "92-7": 3, ... } 소해구별 등급(1~4)
     * @returns {void}
     * [연계] ← _loadAndDraw() → _blendLevels() · _renderBand()
     */
    function _draw(levels) {
        _blendLevels(levels);

        const src = coastLayer.getSource();
        src.clear();
        const features = [];
        for (const seg of segments) {
            const m = seg._m;
            if (m.length < 4) continue;
            const coords = [];
            for (let i = 0; i < m.length; i += 2) coords.push([m[i], m[i + 1]]);
            const f = new ol.Feature({ geometry: new ol.geom.LineString(coords) });
            f.set('zoneKey', seg.z);
            // 심지선은 조각 하나를 한 색으로 그린다(가늘어서 안에서 색을 나눌 여지가 없다).
            // 조각 가운데 점의 값을 대표로 쓴다.
            f.set('v', seg._v ? seg._v[Math.floor(seg._v.length / 2)] : 0);
            features.push(f);
        }
        src.addFeatures(features);

        if (bandLayer) bandLayer.getSource().changed();
    }

    /** 양자화한 값 → 색 문자열. 선분마다 새로 만들면 1만 번 문자열이 생긴다. */
    const _bandColorCache = new Map();

    /**
     * 띠에 쓸 색 문자열을 준다(같은 값이면 만들어 둔 것을 그대로 준다).
     * 예: _bandColor(2.4) → "rgba(234,176,55,1)"
     * @param {number} q - COLOR_STEP 간격으로 반올림한 값
     * @returns {string} CSS 색
     * [연계] ← _renderBand()
     */
    function _bandColor(q) {
        let c = _bandColorCache.get(q);
        if (!c) {
            c = _rgba(_colorAt(q), 1);
            _bandColorCache.set(q, c);
        }
        return c;
    }

    /**
     * 연속값(1~4)을 색으로 바꾼다 — 등급 색 네 가지를 이어 붙인 색표.
     * 예: _colorAt(2.5) → 주의(연노랑)와 경계(주황)의 한가운데 색
     * @param {number} v - 1~4 사이 값. 0 이나 값 없음은 회색(자료 없음).
     * @returns {Array<number>} [r,g,b]
     * [연계] ← _renderBand() · _coreStyle()
     */
    function _colorAt(v) {
        if (!(v > 0)) return NO_DATA_RGB;
        const t = Math.max(1, Math.min(4, v));
        const lo = Math.min(3, Math.floor(t));
        const f = t - lo;
        const a = LEVELS[lo].rgb, b = LEVELS[lo + 1].rgb;
        return [
            Math.round(a[0] + (b[0] - a[0]) * f),
            Math.round(a[1] + (b[1] - a[1]) * f),
            Math.round(a[2] + (b[2] - a[2]) * f)
        ];
    }

    /** [r,g,b] + 투명도 → CSS 색 문자열. [연계] ← _renderBand() · _coreStyle() */
    function _rgba(rgb, a) {
        return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
    }

    /**
     * 지도 축척(resolution)을 줌 단계로 되돌린다.
     * 예: _zoomOf(2445) → 약 6 (전국이 보이는 정도)
     * @param {number} resolution - m/px
     * @returns {number} 줌 단계
     * [연계] ← _coreStyle() · _renderBand()
     *          156543.034 는 웹 지도 줌 0 의 축척(적도 기준 m/px)이다.
     */
    function _zoomOf(resolution) {
        return Math.log2(156543.03392804097 / resolution);
    }

    /** 줌 단계에 맞는 굵기 { band, core }. [연계] ← _coreStyle() · _renderBand() */
    function _widthsAt(zoom) {
        for (const step of BAND_BY_ZOOM) {
            if (zoom <= step.maxZoom) return step;
        }
        return BAND_BY_ZOOM[BAND_BY_ZOOM.length - 1];
    }

    /**
     * 조각이 어느 "몰린 정도" 단계에 드는지 그 번호를 준다.
     * 예: _denseIndex(141) → 0 (DENSE_STEPS[0] = 아주 몰린 곳, 굵기 0.38배)
     * @param {number} d - 그 조각 둘레 227km² 안의 해안선 길이(km)
     * @returns {number} DENSE_STEPS 의 자리 번호
     * [연계] ← _renderBand() / 값은 build_coastline_segments.js 의 measureDensity()
     */
    function _denseIndex(d) {
        for (let i = 0; i < DENSE_STEPS.length; i++) {
            if (d >= DENSE_STEPS[i].km) return i;
        }
        return DENSE_STEPS.length - 1;
    }

    /** 같은 모양을 매 프레임 새로 만들지 않도록 담아 둔다. 키는 "색@굵기". */
    const _styleCache = new Map();

    /**
     * 가는 심지선 하나를 만든다. 띠만 있으면 해안선이 어디인지 흐려지므로 얹는다.
     * 예: _coreStyle(3.2, 2445) → 주황빛 1.2px 선
     * @param {number} v - 섞은 연속값(1~4). 0 이면 자료 없음(회색).
     * @param {number} resolution - 지도 축척(m/px)
     * @returns {ol.style.Style}
     * [연계] ← 심지선 레이어의 스타일 함수(initSwellMap 에서 지정)
     */
    function _coreStyle(v, resolution) {
        const w = _widthsAt(_zoomOf(resolution)).core;
        const rgb = _colorAt(v);
        const key = rgb.join(',') + '@' + w;
        const hit = _styleCache.get(key);
        if (hit) return hit;

        const st = new ol.style.Style({
            stroke: new ol.style.Stroke({
                color: _rgba(rgb, v > 0 ? 0.95 : 0.55),
                width: w,
                lineCap: 'round',
                lineJoin: 'round'
            })
        });
        _styleCache.set(key, st);
        return st;
    }

    /**
     * 그라데이션 띠를 캔버스에 그린다. OpenLayers 가 화면이 바뀔 때마다 부른다.
     * 예: 화면에 보이는 해안선을 굵은 띠로 그린 뒤 통째로 흐리게 → 번지는 색면
     * @param {Array<number>} extent - 그릴 범위 [minX, minY, maxX, maxY] (지도 좌표)
     * @param {number} resolution - 지도 축척(m/px)
     * @param {number} pixelRatio - 화면 픽셀 배율(고화질 화면이면 2~3)
     * @param {Array<number>} size - 캔버스 크기 [너비, 높이] (픽셀)
     * @returns {HTMLCanvasElement}
     * [연계] ← bandLayer 의 ol.source.ImageCanvas
     *
     * [왜 두 장인가]
     *   흐림(ctx.filter)은 "그리는 동작 하나하나"에 걸린다. 선 1만 개를 흐림을 켠 채로
     *   그리면 1만 번 흐려져 아주 느리다. 그래서 흐림 없는 캔버스에 먼저 다 그린 뒤,
     *   그 그림 한 장을 흐림을 켜고 옮겨 담는다 — 흐리게 만드는 일이 딱 한 번이다.
     */
    function _renderBand(extent, resolution, pixelRatio, size) {
        const canvas = document.createElement('canvas');
        canvas.width = size[0];
        canvas.height = size[1];
        const ctx = canvas.getContext('2d');
        if (!segments) return canvas;

        const w = _widthsAt(_zoomOf(resolution)).band * pixelRatio;
        const k = pixelRatio / resolution;

        // 화면 밖 선분은 건너뛴다. 가장 굵은 띠가 번지는 만큼 여유를 둔다.
        const pad = (w + w * BLUR_RATIO * 2) * resolution / pixelRatio;
        const minX = extent[0] - pad, maxX = extent[2] + pad;
        const minY = extent[1] - pad, maxY = extent[3] + pad;

        // 몰린 정도가 같은 것끼리 모아 한 장씩 그린다. 흐림은 캔버스 한 장에 한 번만
        // 걸 수 있는데, 얇게 그린 띠에 굵은 띠와 같은 흐림을 걸면 다시 넓게 퍼져
        // 얇게 그린 뜻이 없어지기 때문이다.
        // 조각은 딱 한 번만 훑는다 — 단계마다 훑으면 전국 화면에서 선분 1만 개를
        // 네 번 검사하게 돼 느려진다(실측: 4번 훑을 때 한 장 그리는 데 90ms).
        const merged = document.createElement('canvas');
        merged.width = size[0];
        merged.height = size[1];
        const mctx = merged.getContext('2d');

        // 색마다 길을 따로 모아 두었다가 색당 딱 한 번씩 그린다.
        // 조각 순서대로 그리면 색이 계속 바뀌어 그리기 명령이 잘게 쪼개진다
        // (실측: 전국 화면에서 선분 10,504개가 2,279번으로 쪼개져 59ms 걸렸다).
        const lanes = DENSE_STEPS.map(function (step) {
            const off = document.createElement('canvas');
            off.width = size[0];
            off.height = size[1];
            const octx = off.getContext('2d');
            octx.lineCap = 'round';
            octx.lineJoin = 'round';
            octx.lineWidth = w * step.scale;
            return { step: step, off: off, octx: octx, paths: new Map(), drew: false };
        });

        for (const seg of segments) {
            const m = seg._m, v = seg._v;
            if (!v || m.length < 4) continue;
            const lane = lanes[_denseIndex(seg.d || 0)];
            for (let i = 0; i + 3 < m.length; i += 2) {
                const x0 = m[i], y0 = m[i + 1], x1 = m[i + 2], y1 = m[i + 3];
                if ((x0 < minX && x1 < minX) || (x0 > maxX && x1 > maxX)) continue;
                if ((y0 < minY && y1 < minY) || (y0 > maxY && y1 > maxY)) continue;
                const vm = (v[i / 2] + v[i / 2 + 1]) / 2;
                if (!(vm > 0)) continue;
                const q = Math.round(vm / COLOR_STEP);
                // 불투명하게 그린다 — 투명도는 맨 마지막에 한 번만 먹인다.
                const color = _bandColor(q * COLOR_STEP);
                let path = lane.paths.get(color);
                if (!path) {
                    path = new Path2D();
                    lane.paths.set(color, path);
                }
                path.moveTo((x0 - extent[0]) * k, (extent[3] - y0) * k);
                path.lineTo((x1 - extent[0]) * k, (extent[3] - y1) * k);
                lane.drew = true;
            }
        }

        for (const lane of lanes) {
            if (!lane.drew) continue;
            lane.paths.forEach(function (path, color) {
                lane.octx.strokeStyle = color;
                lane.octx.stroke(path);
            });
            // 이 단계의 굵기에 맞춘 흐림으로 옮겨 담는다(투명도는 아직 먹이지 않는다 —
            // 여기서 반투명하게 겹치면 단계가 만나는 자리가 진해져 얼룩이 진다).
            mctx.filter = 'blur(' + (w * lane.step.scale * BLUR_RATIO).toFixed(1) + 'px)';
            mctx.drawImage(lane.off, 0, 0);
            mctx.filter = 'none';
        }

        // 투명도는 여기서 딱 한 번. 그림 한 장을 통째로 옮겨 담으므로 선이 몇 겹
        // 겹쳤든 진하기가 고르다(겹칠 때마다 진해지던 얼룩이 없어진다).
        // 흐림을 지원하지 않는 브라우저(구형 사파리)에서는 filter 가 무시돼
        // 흐리지 않은 띠가 그대로 보인다 — 색과 진하기는 맞다.
        ctx.globalAlpha = BAND_ALPHA;
        ctx.drawImage(merged, 0, 0);
        ctx.globalAlpha = 1;
        return canvas;
    }

    // ========================================================================
    // 3. 지도 위 범례
    // ========================================================================

    /**
     * 지도 왼쪽 아래에 색 범례를 붙인다.
     * 예: ● 관심 ● 주의 ● 경계 ● 위험 ● 정보없음
     * @param {ol.Map} map
     * @returns {void}
     * [연계] ← initSwellMap()
     *          이안류 탭(_addLegendControl)과 같은 .fishing-legend 스타일을 그대로 쓴다
     *          — 새 CSS 를 만들지 않기 위해서다.
     */
    function _addLegendControl(map) {
        var legendEl = document.createElement('div');
        legendEl.className = 'fishing-legend';

        // 화면은 네 색 사이를 이어 붙인 연속색이므로, 점 네 개만 보여주면 실제와 다르다.
        // 색이 이어진다는 것을 띠 하나로 먼저 보여 준다.
        var ramp = document.createElement('span');
        ramp.style.display = 'block';
        ramp.style.height = '6px';
        ramp.style.borderRadius = '3px';
        ramp.style.marginBottom = '4px';
        ramp.style.background = 'linear-gradient(to right,'
            + [1, 2, 3, 4].map(function (lv) { return 'rgb(' + LEVELS[lv].rgb.join(',') + ')'; }).join(',')
            + ')';
        legendEl.appendChild(ramp);

        [1, 2, 3, 4, null].forEach(function (lv) {
            var rgb = (LEVELS[lv] && LEVELS[lv].rgb) || NO_DATA_RGB;
            var color = 'rgb(' + rgb.join(',') + ')';
            var name = (LEVELS[lv] && LEVELS[lv].name) || '정보없음';
            var item = document.createElement('span');
            item.className = 'fishing-legend-item';
            item.innerHTML = '<span class="fishing-legend-dot" style="background:' + color + ';"></span>' + name;
            legendEl.appendChild(item);
        });

        legendEl.style.position = 'absolute';
        legendEl.style.bottom = '8px';
        legendEl.style.left = '8px';
        map.addControl(new ol.control.Control({ element: legendEl }));
    }

    /**
     * 유의사항 팝업을 연다(#swell-disclaimer 의 글을 그대로 보여준다).
     * 이안류 탭의 안내 팝업과 같은 .fishing-guide-* 스타일을 쓴다.
     * @returns {void}
     * [연계] ← _bindEvents() 의 안내 버튼
     */
    function _openNoticePopup() {
        _closeNoticePopup();
        var src = document.getElementById('swell-disclaimer');

        var overlay = document.createElement('div');
        overlay.className = 'fishing-guide-overlay';
        overlay.id = 'swell-notice-overlay';
        overlay.addEventListener('click', function () { _closeNoticePopup(); });

        var popup = document.createElement('div');
        popup.className = 'fishing-guide-popup';
        popup.addEventListener('click', function (e) { e.stopPropagation(); });

        var header = document.createElement('div');
        header.className = 'fishing-guide-popup-header';
        header.innerHTML = '<span>너울 안내</span>'
            + '<button class="fishing-guide-popup-close" id="swell-notice-close">'
            + '<i class="fa-solid fa-xmark"></i></button>';

        var body = document.createElement('div');
        body.className = 'fishing-guide-popup-body';
        body.innerHTML = src ? src.innerHTML : '';

        popup.appendChild(header);
        popup.appendChild(body);
        overlay.appendChild(popup);
        document.body.appendChild(overlay);

        var closeBtn = document.getElementById('swell-notice-close');
        if (closeBtn) closeBtn.addEventListener('click', function () { _closeNoticePopup(); });
    }

    /** 유의사항 팝업을 닫는다. [연계] ← _openNoticePopup() */
    function _closeNoticePopup() {
        var el = document.getElementById('swell-notice-overlay');
        if (el && el.parentNode) el.parentNode.removeChild(el);
    }

    // ========================================================================
    // 4. 화면 요소
    // ========================================================================

    /** 헤더 오른쪽에 기준시각/상태 문구를 쓴다. @param {string} text */
    function _setStatus(text) {
        const el = document.getElementById('swell-publish-time');
        if (el) el.textContent = text;
    }

    /** 내 위치·안내 버튼을 연결한다. [연계] ← initSwellMap() */
    function _bindEvents() {
        const locBtn = document.getElementById('swell-my-location-btn');
        if (locBtn) {
            locBtn.addEventListener('click', function () {
                if (!navigator.geolocation) return;
                navigator.geolocation.getCurrentPosition(function (pos) {
                    swellMap.getView().animate({
                        center: ol.proj.fromLonLat([pos.coords.longitude, pos.coords.latitude]),
                        zoom: 11
                    });
                });
            });
        }
        const noticeBtn = document.getElementById('swell-notice-btn');
        if (noticeBtn) noticeBtn.addEventListener('click', function () { _openNoticePopup(); });
    }
})();
