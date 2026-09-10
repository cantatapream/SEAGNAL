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
 * [로드 순서] js/marine-life/ripcurrent/ripcurrent.js 다음 — 순서 변경 금지
 *
 * [왜 해안선을 칠하나]
 *   너울은 먼바다보다 "해안에 부딪힐 때"가 위험하다. 그래서 바다 전체를 칠하지 않고
 *   해안선만 칠한다. 해안선 조각마다 어느 소해구에 속하는지는 미리 계산해 두었으므로
 *   앱은 등급표(소해구 424개)만 받아 색을 입히면 된다.
 * ============================================================================
 */

(function () {
    'use strict';

    // ========================================================================
    // 상수
    // ========================================================================

    /** 등급(1~4) → 이름·색. MMIS 너울 범례와 같은 색 계열. */
    const LEVELS = {
        1: { name: '관심', color: '#1FA24A' },
        2: { name: '주의', color: '#E4D64B' },
        3: { name: '경계', color: '#F08A24' },
        4: { name: '위험', color: '#E03131' }
    };
    /** 등급을 못 받은 해안(자료 없음). */
    const NO_DATA_COLOR = '#9aa3ad';

    const SEGMENTS_URL = '/coastline_segments.json';
    const LEVELS_URL = '/api/swell-smallzone?coast=1';

    const KOREA_CENTER = ol.proj.fromLonLat([127.8, 35.9]);
    const DEFAULT_ZOOM = 7;

    /** 해안선 굵기(px). 전국(줌7)에서도 색이 보이고, 확대해도 과하지 않은 값. */
    const BASE_WIDTH = 3;

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

        coastLayer = new ol.layer.Vector({ source: new ol.source.Vector() });

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

    // ========================================================================
    // 2. 자료 받아 그리기
    // ========================================================================

    /**
     * 해안선 조각과 소해구별 등급을 받아 지도에 색칠한다.
     * 예: 조각 1,934개 × 등급표 424개 → 등급 색이 입혀진 해안선
     * @returns {Promise<void>}
     * [연계] ← initSwellMap() · 새로고침 버튼
     *          → _draw() 가 실제로 선을 만든다.
     */
    async function _loadAndDraw() {
        _setStatus('불러오는 중…');
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
            f.setStyle(_styleFor(lv));
            features.push(f);
        }
        src.addFeatures(features);
    }

    /**
     * 등급에 맞는 선 모양을 만든다.
     * 예: _styleFor(4) → 빨간 굵은 선
     * @param {number|undefined} lv - 등급 1~4. 없으면 회색(자료 없음).
     * @returns {ol.style.Style}
     * [연계] ← _draw()
     */
    function _styleFor(lv) {
        const color = (LEVELS[lv] && LEVELS[lv].color) || NO_DATA_COLOR;
        return new ol.style.Style({
            stroke: new ol.style.Stroke({ color: color, width: BASE_WIDTH })
        });
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
            var color = (LEVELS[lv] && LEVELS[lv].color) || NO_DATA_COLOR;
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
