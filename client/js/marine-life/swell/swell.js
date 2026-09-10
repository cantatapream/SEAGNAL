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
 * ============================================================================
 */

(function () {
    'use strict';

    // ========================================================================
    // 상수
    // ========================================================================

    /**
     * 등급(1~4) → 이름 · 선 색(rgb) · 빛번짐 세기.
     * 색은 MMIS 너울 범례와 같은 계열이다.
     * glow 는 "위험할수록 더 밝게 번지게" 하려고 등급마다 다르게 준다 —
     * 꾸미기가 아니라, 멀리서 봐도 위험한 해안이 먼저 눈에 띄게 하려는 것이다.
     */
    const LEVELS = {
        1: { name: '관심', rgb: [31, 162, 74], glow: 0.30 },
        2: { name: '주의', rgb: [228, 214, 75], glow: 0.40 },
        3: { name: '경계', rgb: [240, 138, 36], glow: 0.55 },
        4: { name: '위험', rgb: [224, 49, 49], glow: 0.75 }
    };
    /** 등급을 못 받은 해안(자료 없음). 빛번짐 없이 흐리게만 둔다. */
    const NO_DATA_RGB = [154, 163, 173];

    const SEGMENTS_URL = '/coastline_segments.json';
    const LEVELS_URL = '/api/swell-smallzone?coast=1';

    const KOREA_CENTER = ol.proj.fromLonLat([127.8, 35.9]);
    const DEFAULT_ZOOM = 7;

    /**
     * 확대 정도(줌)별 해안선 심지 굵기(px).
     * 전국을 볼 때(줌 7 이하)는 선이 얇으면 점점이 흩어져 보이고,
     * 확대했을 때(줌 12 이상)는 너무 굵으면 해안 모양을 가린다.
     */
    const CORE_WIDTH_BY_ZOOM = [
        { maxZoom: 7, width: 3.0 },
        { maxZoom: 9, width: 4.0 },
        { maxZoom: 11, width: 5.0 },
        { maxZoom: 99, width: 6.5 }
    ];

    /**
     * 겹쳐 그리는 네 겹의 굵기 배수(심지 대비).
     * 바깥은 넓고 흐리게, 안쪽은 좁고 진하게, 맨 위 가는 줄은 광택 몫이다.
     */
    const GLOW_OUTER_SCALE = 3.2;
    const GLOW_INNER_SCALE = 1.9;
    const SHEEN_SCALE = 0.38;

    // ========================================================================
    // 상태
    // ========================================================================
    let swellMap = null;
    let coastLayer = null;
    let segments = null;      // coastline_segments.json 의 segments (한 번만 받아 재사용)

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

        // 스타일을 조각마다 박아두지 않고 레이어 함수로 준다 — 그래야 확대·축소할 때마다
        // 다시 계산돼 줌에 맞는 굵기가 적용된다(조각에 박아두면 처음 굵기로 고정된다).
        coastLayer = new ol.layer.Vector({
            source: new ol.source.Vector(),
            style: function (feature, resolution) {
                return _styleFor(feature.get('level'), resolution);
            }
        });

        swellMap = new ol.Map({
            target: 'swell-map',
            layers: [
                new ol.layer.Tile({ source: new ol.source.OSM() }),
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
     * 조각마다 자기 소해구의 등급 색을 입혀 지도에 올린다.
     * 예: 조각 z="92-7" 의 등급이 3이면 주황색 선으로 그린다.
     * @param {Object} levels - { "92-7": 3, ... } 소해구별 등급(1~4)
     * @returns {void}
     * [연계] ← _loadAndDraw()
     */
    function _draw(levels) {
        const src = coastLayer.getSource();
        src.clear();

        const features = [];
        for (const seg of segments) {
            const c = seg.c;
            const coords = [];
            for (let i = 0; i < c.length; i += 2) {
                coords.push(ol.proj.fromLonLat([c[i], c[i + 1]]));
            }
            if (coords.length < 2) continue;

            const lv = levels[seg.z];
            const f = new ol.Feature({ geometry: new ol.geom.LineString(coords) });
            f.set('zoneKey', seg.z);
            f.set('level', lv || null);
            features.push(f);
        }
        src.addFeatures(features);
    }

    /**
     * 색을 어둡게(-) 또는 밝게(+) 만든다.
     * 예: _shade([224,49,49], -0.55) → [101,22,22] (위험색을 어둡게)
     * @param {Array<number>} rgb - [r,g,b] 0~255
     * @param {number} f - -1(검정)~+1(흰색) 사이 비율
     * @returns {Array<number>} 바뀐 [r,g,b]
     * [연계] ← _styleFor() 가 바깥 그림자·안쪽 심지 색을 만들 때 쓴다.
     */
    function _shade(rgb, f) {
        const t = f < 0 ? 0 : 255;
        const k = Math.abs(f);
        return rgb.map(v => Math.round(v + (t - v) * k));
    }

    /** [r,g,b] + 투명도 → CSS 색 문자열. [연계] ← _styleFor() */
    function _rgba(rgb, a) {
        return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
    }

    /**
     * 지도 축척(resolution)을 줌 단계로 되돌린다.
     * 예: _zoomOf(2445) → 약 6 (전국이 보이는 정도)
     * @param {number} resolution - OpenLayers 가 스타일 함수에 넘겨주는 값(m/px)
     * @returns {number} 줌 단계
     * [연계] ← _styleFor()
     *          스타일 함수에는 지도가 아니라 축척만 들어와서 줌을 직접 구해야 한다.
     *          156543.034 는 웹 지도 줌 0 의 축척(적도 기준 m/px)이다.
     */
    function _zoomOf(resolution) {
        return Math.log2(156543.03392804097 / resolution);
    }

    /** 줌 단계에 맞는 심지 굵기(px). [연계] ← _styleFor() */
    function _coreWidth(zoom) {
        for (const step of CORE_WIDTH_BY_ZOOM) {
            if (zoom <= step.maxZoom) return step.width;
        }
        return CORE_WIDTH_BY_ZOOM[CORE_WIDTH_BY_ZOOM.length - 1].width;
    }

    /** 같은 모양을 매 프레임 새로 만들지 않도록 담아 둔다. 키는 "등급@굵기". */
    const _styleCache = new Map();

    /**
     * 등급에 맞는 선 모양(빛번짐 2겹 + 심지 + 광택 1겹)을 만든다.
     * 예: _styleFor(4, 2445) → 빨간 심지 3px + 그 둘레로 번지는 붉은 빛 + 가운데 광택
     * @param {number|undefined} lv - 등급 1~4. 없으면 회색(자료 없음).
     * @param {number} resolution - 지도 축척(m/px)
     * @returns {Array<ol.style.Style>} 아래에서 위 순서 — 바깥번짐 · 안쪽번짐 · 심지 · 광택
     * [연계] ← 지도 레이어의 스타일 함수(initSwellMap 에서 지정)
     *
     * [왜 네 겹인가]
     *   OpenLayers 의 선에는 그림자·번짐 설정이 없다. 그래서 같은 선을
     *   "넓고 아주 흐리게 → 좁고 조금 진하게 → 가늘고 선명하게" 겹쳐 그려
     *   빛이 번지는 것처럼 보이게 한다. 맨 위 가는 줄 하나를 더 밝게 얹으면
     *   선 가운데가 반짝이는 것처럼 보인다(심지 자체를 밝히면 색이 옅어져 등급을
     *   알아보기 어려워지므로, 심지는 제 색 그대로 두고 광택만 따로 얹는다).
     */
    function _styleFor(lv, resolution) {
        const zoom = _zoomOf(resolution);
        const w = _coreWidth(zoom);
        const key = (lv || 0) + '@' + w;
        const hit = _styleCache.get(key);
        if (hit) return hit;

        const def = LEVELS[lv];
        const rgb = (def && def.rgb) || NO_DATA_RGB;
        const glow = def ? def.glow : 0;          // 자료 없음은 번지지 않는다
        const round = { lineCap: 'round', lineJoin: 'round' };
        const stroke = (color, width) => new ol.style.Style({
            stroke: new ol.style.Stroke(Object.assign({ color, width }, round))
        });

        const styles = [];
        if (glow > 0) {
            // 바깥: 제 색을 조금 어둡게 깐다. 밝은 기본지도 위에서도 선이 떠 보이게 하는
            // 그림자 몫이다. 너무 어둡게 하면 주황·노랑이 탁해 보이므로 살짝만 낮춘다.
            styles.push(stroke(_rgba(_shade(rgb, -0.35), 0.14 + glow * 0.16), w * GLOW_OUTER_SCALE));
            // 가운데: 제 색 그대로 번진다.
            styles.push(stroke(_rgba(rgb, 0.30 + glow * 0.40), w * GLOW_INNER_SCALE));
        }
        // 심지: 제 색 그대로. 등급 색을 알아보는 건 이 줄이다.
        styles.push(stroke(_rgba(rgb, glow > 0 ? 1 : 0.85), w));
        if (glow > 0) {
            // 광택: 심지 위에 가는 밝은 줄. 선 가운데가 빛나는 것처럼 보이게 한다.
            styles.push(stroke(_rgba(_shade(rgb, 0.62), 0.28 + glow * 0.45), Math.max(1, w * SHEEN_SCALE)));
        }

        _styleCache.set(key, styles);
        return styles;
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
