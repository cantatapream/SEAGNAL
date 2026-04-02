/**
 * ============================================================================
 * 파일명: js/surfing1.js
 * 역할: 서핑지수 프론트엔드 - 기본 구조 / 상태 / 지도 초기화 / 데이터 로드 / 유틸함수
 * ============================================================================
 *
 * [설명]
 * 서핑지수 기능의 뼈대가 되는 파일입니다.
 * - 상수(등급색상, 해수욕장-해구 매핑 등)와 공유 상태를 window._surfing에 정의
 * - OpenLayers 지도 초기화 (initSurfingMap)
 * - 서핑지수/해구기상/특보 3개 API 데이터 로드
 * - 모든 파일에서 공통으로 사용하는 유틸 함수 (날짜, 풍향, XSS 등)
 *
 * [로드 순서] surfing1 → surfing2 → surfing3 → surfing4 → surfing5
 *
 * [연계]
 * - marine.js → initSurfingMap() 호출 (탭 활성화 시)
 * - surfing2.js → renderMarkers, addLegendControl, addGuideControl 등록
 * - surfing3.js → bindEvents, openPopup, closePopup 등록
 * - surfing4.js → renderPopupContent 등록
 * - surfing5.js → buildAlertMap 등록
 *
 * [데이터 구조] (서핑지수 API 응답, /api/surfing-index)
 * {
 *   updatedAt: "2026.04.02 09:00",
 *   beaches: {
 *     "경포해수욕장": {
 *       lat: 37.80662, lot: 128.9085,
 *       zone: "63", alert: "강원북부앞바다",
 *       forecasts: {
 *         "20260402": {
 *           "오전": { avgWvhgt, avgWvpd, avgWspd, avgWtem, grades: { 초급: "매우좋음", 중급: "보통", 상급: "나쁨" } },
 *           "오후": { ... }
 *         },
 *         "20260405": { "일": { ... } }   // D+3 이후 종일
 *       }
 *     }
 *   }
 * }
 * ============================================================================
 */

(function () {
    'use strict';

    // ========================================================================
    // 1. 상수 정의
    // ========================================================================

    /**
     * 서핑지수 등급별 색상 맵
     * - inner: 마커/배지 중심 색상 (밝은 톤)
     * - outer: 마커/배지 외곽 색상 (진한 톤)
     * - glow:  마커 발광 효과 색상 (반투명)
     * [사용처] 마커 렌더링(surfing2.js), 등급 배지(surfing4.js)
     */
    var LEVEL_COLORS = {
        '매우좋음': { inner: '#81D4FA', outer: '#1565C0', glow: 'rgba(21,101,192,0.5)' },
        '좋음':     { inner: '#81C784', outer: '#2E7D32', glow: 'rgba(46,125,50,0.5)' },
        '보통':     { inner: '#FFD54F', outer: '#F9A825', glow: 'rgba(249,168,37,0.5)' },
        '나쁨':     { inner: '#FFB74D', outer: '#E65100', glow: 'rgba(230,81,0,0.5)' },
        '매우나쁨': { inner: '#EF9A9A', outer: '#C62828', glow: 'rgba(198,40,40,0.5)' }
    };

    /**
     * 등급 우선순위 (숫자가 높을수록 좋은 등급)
     * 마커 렌더 순서 결정에 사용: 나쁜 등급이 아래, 좋은 등급이 위에 표시
     */
    var LEVEL_PRIORITY = { '매우나쁨': 1, '나쁨': 2, '보통': 3, '좋음': 4, '매우좋음': 5 };

    /** 한국 지도 중심 좌표 (EPSG:3857) 및 기본 줌 레벨 */
    var KOREA_CENTER = ol.proj.fromLonLat([127.8, 35.9]);
    var DEFAULT_ZOOM = 7;

    /**
     * 16개 서핑 해수욕장별 해구번호 및 특보구역 매핑
     *
     * - zone: 해구별 기상 데이터 조회 키 (zone_forecasts.json의 data[zone])
     *         → 팝업 상세정보에서 9시/12시/15시/18시 파고·파주기·바람 표시에 사용
     * - alert: 해상특보 조회 키 (weather_alerts.json의 최하위 구역명)
     *         → 팝업 하단 해상특보 표시에 사용
     *
     * [해구번호 결정 근거]
     * - 해수욕장 GPS 좌표를 해구도 격자에 대입하여 산출
     * - 5xxx번(연안 격자, 파고=0)인 경우 인접 근해 해구 사용
     * - 사용자 지정: 월포(816), 진하(923), 다대포(927), 남열(977), 만리포(1644), 월정리(223)
     */
    var BEACH_META = {
        '송지호해수욕장':      { zone: '55',   alert: '강원북부앞바다' },
        '죽도해수욕장':        { zone: '62',   alert: '강원북부앞바다' },
        '경포해수욕장':        { zone: '63',   alert: '강원북부앞바다' },
        '금진해수욕장':        { zone: '63',   alert: '강원중부앞바다' },
        '망상해수욕장':        { zone: '63',   alert: '강원남부앞바다' },
        '월포해수욕장':        { zone: '816',  alert: '경북남부앞바다' },
        '진하해수욕장':        { zone: '923',  alert: '울산앞바다' },
        '송정해수욕장':        { zone: '92',   alert: '부산앞바다' },
        '다대포해수욕장':      { zone: '927',  alert: '부산앞바다' },
        '송정솔바람해수욕장':  { zone: '98',   alert: '경남서부남해앞바다' },
        '남열해수욕장':        { zone: '977',  alert: '전남동부남해앞바다' },
        '명사십리해수욕장':    { zone: '213',  alert: '전남서부남해앞바다' },
        '만리포해수욕장':      { zone: '1644', alert: '충남북부앞바다' },
        '곽지해수욕장':        { zone: '232',  alert: '제주도북부앞바다' },
        '월정리해수욕장':      { zone: '223',  alert: '제주도동부앞바다' },
        '중문색달해수욕장':    { zone: '232',  alert: '제주도남부앞바다' }
    };

    // ========================================================================
    // 2. 공유 상태 객체 (다른 surfing 파일들이 window._surfing을 통해 접근)
    // ========================================================================

    /**
     * window._surfing: 서핑지수 모듈의 공유 저장소
     *
     * surfing1~5.js가 동일한 IIFE 안에 있지 않으므로,
     * 이 객체를 통해 상태(지도, 데이터)와 상수를 공유합니다.
     *
     * [사용 예시]
     * - surfing2.js: window._surfing.map.addControl(...)
     * - surfing3.js: window._surfing.selectedBeach = '경포해수욕장';
     * - surfing4.js: window._surfing.utils.formatDateLabel('20260402')
     */
    window._surfing = {
        // --- 지도/마커 관련 상태 ---
        map: null,              // OpenLayers Map 인스턴스
        markerLayer: null,      // 마커 벡터 레이어 (ol.layer.Vector)
        selectedFeature: null,  // 현재 선택(클릭)된 마커 피처 (시각적 확대 효과용)

        // --- API 데이터 ---
        data: null,             // 서핑지수 데이터 (/api/surfing-index 응답 전체)
        zoneForecasts: null,    // 해구별 기상 데이터 (/api/marine-zone-forecasts 응답)
        weatherAlerts: null,    // 해상특보 데이터 (/api/weather-alerts 응답)
        alertMap: null,         // 특보구역명 → 특보정보 평면맵 (surfing5.js에서 구축)

        // --- 팝업 상태 ---
        selectedBeach: null,    // 현재 팝업에 표시 중인 해수욕장명 (예: '경포해수욕장')
        selectedDateIdx: 0,     // 현재 선택된 날짜 인덱스 (0 = 가장 빠른 날짜)
        availableDates: [],     // 예보 날짜 목록 ['20260402','20260403',...] (정렬됨)

        // --- 상수 참조 (다른 파일에서 접근) ---
        LEVEL_COLORS: LEVEL_COLORS,
        LEVEL_PRIORITY: LEVEL_PRIORITY,
        BEACH_META: BEACH_META,
        KOREA_CENTER: KOREA_CENTER,
        DEFAULT_ZOOM: DEFAULT_ZOOM,

        // --- 다른 파일에서 등록할 함수 슬롯 ---
        // surfing2.js가 등록: renderMarkers, selectMarker, resetMarkerStyle,
        //                     addLegendControl, addGuideControl
        // surfing3.js가 등록: bindEvents, openPopup, closePopup
        // surfing4.js가 등록: renderPopupContent
        // surfing5.js가 등록: buildAlertMap

        // --- 유틸 함수 (아래에서 등록) ---
        utils: null
    };

    // ========================================================================
    // 3. 지도 초기화 (marine.js에서 서핑 탭 활성화 시 호출)
    // ========================================================================

    /**
     * OpenLayers 서핑지수 지도를 초기화합니다.
     *
     * [호출 시점]
     * marine.js → _onSectionActivated('surfing-section') → window.initSurfingMap()
     * 서핑 탭을 처음 클릭했을 때 1회만 실제 초기화, 이후에는 크기 갱신만 수행합니다.
     *
     * [처리 흐름]
     * 1. 마커 레이어 생성 (좋은 등급이 위에 오도록 renderOrder 설정)
     * 2. OSM 타일 + 마커 레이어로 지도 생성
     * 3. 마커 클릭 이벤트 → 팝업 열기 (surfing3.js)
     * 4. 좌하단 범례 + 우하단 "서핑지수란?" 버튼 추가 (surfing2.js)
     * 5. 팝업 닫기/날짜 버튼 이벤트 바인딩 (surfing3.js)
     * 6. 3개 API 데이터 로드 → 마커 렌더링 (surfing2.js)
     */
    window.initSurfingMap = function () {
        var s = window._surfing;

        // 이미 초기화된 경우: 탭 전환 시 레이아웃이 깨지지 않도록 크기만 갱신
        if (s.map) {
            s.map.updateSize();
            return;
        }

        // --- 마커 벡터 레이어 생성 ---
        // renderOrder: 등급 우선순위(LEVEL_PRIORITY)로 정렬하여
        // 나쁜 등급 마커가 아래, 좋은 등급 마커가 위에 표시되도록 합니다
        s.markerLayer = new ol.layer.Vector({
            source: new ol.source.Vector(),
            renderOrder: function (a, b) {
                var pa = LEVEL_PRIORITY[a.get('level')] || 0;
                var pb = LEVEL_PRIORITY[b.get('level')] || 0;
                return pa - pb;
            }
        });

        // --- 지도 생성 ---
        // target: index.html의 <div id="surfing-map"> 요소에 렌더링
        // layers: OpenStreetMap 배경 타일 위에 마커 레이어 표시
        // controls: 줌 버튼과 Attribution 텍스트 제거 (모바일 화면 깔끔하게)
        s.map = new ol.Map({
            target: 'surfing-map',
            layers: [
                new ol.layer.Tile({ source: new ol.source.OSM() }),
                s.markerLayer
            ],
            view: new ol.View({
                center: KOREA_CENTER,
                zoom: DEFAULT_ZOOM,
                minZoom: 6,
                maxZoom: 13
            }),
            controls: ol.control.defaults.defaults({ attribution: false, zoom: false })
        });

        // --- 마커 클릭 이벤트 ---
        // 지도 위 마커를 클릭하면:
        // 1. 마커 확대 효과 적용 (surfing2.js의 selectMarker)
        // 2. 해당 해수욕장의 팝업 열기 (surfing3.js의 openPopup)
        s.map.on('singleclick', function (evt) {
            var feature = s.map.forEachFeatureAtPixel(evt.pixel, function (f) { return f; });
            if (feature && feature.get('beachName')) {
                if (s.selectMarker) s.selectMarker(feature);
                if (s.openPopup) s.openPopup(feature.get('beachName'));
            }
        });

        // --- 마커 호버 시 커서 변경 ---
        // 마커 위에 마우스를 올리면 손가락 커서(pointer)로 변경
        s.map.on('pointermove', function (evt) {
            var hit = s.map.forEachFeatureAtPixel(evt.pixel, function () { return true; });
            s.map.getTargetElement().style.cursor = hit ? 'pointer' : '';
        });

        // --- 지도 내부 컨트롤 추가 (surfing2.js에서 정의) ---
        // 좌측 하단: 등급별 범례 (매우좋음~매우나쁨 색상 안내)
        if (s.addLegendControl) s.addLegendControl(s.map);
        // 우측 하단: "서핑지수란?" 버튼 (클릭 시 설명 이미지 팝업)
        if (s.addGuideControl) s.addGuideControl(s.map);

        // --- 팝업 관련 이벤트 바인딩 (surfing3.js에서 정의) ---
        // 팝업 닫기 버튼, 오버레이 클릭, 날짜 이전/다음 버튼 등
        if (s.bindEvents) s.bindEvents();

        // --- 내 위치 버튼 이벤트 바인딩 ---
        // 클릭 시 GPS 좌표를 얻어 지도 중심을 현재 위치로 이동합니다
        var locBtn = document.getElementById('surfing-my-location-btn');
        if (locBtn) {
            locBtn.addEventListener('click', function () {
                if (!navigator.geolocation) return;
                locBtn.disabled = true;
                navigator.geolocation.getCurrentPosition(
                    function (pos) {
                        var coord = ol.proj.fromLonLat([pos.coords.longitude, pos.coords.latitude]);
                        s.map.getView().animate({ center: coord, zoom: 9, duration: 500 });
                        locBtn.disabled = false;
                    },
                    function () {
                        locBtn.disabled = false;
                    },
                    { timeout: 8000 }
                );
            });
        }

        // --- 데이터 로드 및 마커 표시 ---
        _loadSurfingData();
    };

    // ========================================================================
    // 4. 데이터 로드 (3개 API 동시 호출)
    // ========================================================================

    /**
     * 서핑지수 표시에 필요한 3개 데이터를 한꺼번에 불러옵니다.
     *
     * [불러오는 데이터]
     * 1. 서핑지수 (/api/surfing-index)
     *    - 각 해수욕장의 오전/오후/종일 등급(초급·중급·상급) + 기상 평균값
     * 2. 해구별 기상 (/api/marine-zone-forecasts)
     *    - 해구별 3시간 간격 파고(wh), 파주기(wp), 풍속(ws), 풍향(windDir)
     *    - 팝업 상세정보 테이블의 9시/12시/15시/18시 데이터에 사용
     * 3. 해상특보 (/api/weather-alerts)
     *    - 특보구역별 현재 특보 여부 (풍랑주의보, 태풍경보 등)
     *    - 팝업 하단 해상특보 영역에 표시
     *
     * [완료 후 동작]
     * - 발표시점을 지도 하단에 표시 ("발표: 2026.04.02 09:00")
     * - 특보 조회용 평면 맵 구축 (surfing5.js의 buildAlertMap)
     * - 마커 렌더링 (surfing2.js의 renderMarkers)
     */
    async function _loadSurfingData() {
        try {
            // 3개 API를 Promise.all로 병렬 호출 (각각 독립적이므로 동시에 요청)
            var responses = await Promise.all([
                fetch('/api/surfing-index'),
                fetch('/api/marine-zone-forecasts'),
                fetch('/api/weather-alerts')
            ]);

            var surfRes = responses[0];
            var zoneRes = responses[1];
            var alertRes = responses[2];

            // 서핑지수 API가 실패하면 표시할 데이터가 없으므로 중단
            if (!surfRes.ok) throw new Error('서핑지수 데이터 없음');

            // JSON 파싱 (서핑지수는 필수, 해구기상/특보는 실패해도 기본 정보는 표시)
            var s = window._surfing;
            s.data = await surfRes.json();

            // 해구 기상: 실패 시 null (상세정보 테이블이 빈칸으로 표시됨)
            if (zoneRes.ok) {
                s.zoneForecasts = await zoneRes.json();
            } else {
                console.warn('🏄 해구 기상 데이터 로드 실패 (상세정보 미표시)');
            }

            // 특보: 실패 시 null (특보 영역이 "정보 없음"으로 표시됨)
            if (alertRes.ok) {
                s.weatherAlerts = await alertRes.json();
            } else {
                console.warn('🏄 특보 데이터 로드 실패 (특보정보 미표시)');
            }

            // --- 발표시점 표시 ---
            // 지도 하단의 "발표: 2026.04.02 09:00" 텍스트 업데이트
            var pubEl = document.getElementById('surfing-publish-time');
            if (pubEl && s.data && s.data.updatedAt) {
                pubEl.textContent = '발표: ' + s.data.updatedAt;
            }

            // --- 특보 조회용 평면 맵 구축 (surfing5.js에서 정의) ---
            // weather_alerts.json은 중첩 구조(동해>동해중부해상>...>강원북부앞바다)인데,
            // 이를 { '강원북부앞바다': { current, upcoming }, ... } 평면 맵으로 변환하여
            // 해수욕장별 특보를 O(1)로 조회할 수 있게 합니다
            if (s.buildAlertMap && s.weatherAlerts) {
                s.alertMap = s.buildAlertMap(s.weatherAlerts);
            }

            // --- 마커 렌더링 (surfing2.js에서 정의) ---
            // 16개 해수욕장 위치에 초급 totalIndex 기준 색상의 발광형 마커 표시
            if (s.renderMarkers) {
                s.renderMarkers();
            }

        } catch (e) {
            console.warn('🏄 서핑지수 데이터 로드 실패:', e.message);
            var pubEl = document.getElementById('surfing-publish-time');
            if (pubEl) pubEl.textContent = '데이터를 불러올 수 없습니다.';
        }
    }

    // ========================================================================
    // 5. 유틸리티 함수
    // ========================================================================

    /**
     * 오늘 날짜를 YYYYMMDD 형식 문자열로 반환합니다.
     * 예: 2026년 4월 2일 → "20260402"
     *
     * [사용처]
     * - 마커 색상 결정: 오늘 날짜의 초급 지수 기준
     * - 날짜 라벨: "오늘" 접두사 붙이기 여부 판단
     */
    function _getTodayStr() {
        var d = new Date();
        return String(d.getFullYear()) +
               String(d.getMonth() + 1).padStart(2, '0') +
               String(d.getDate()).padStart(2, '0');
    }

    /**
     * 현재 시각 기준으로 오전/오후를 판단합니다.
     * 12시 이전이면 '오전', 12시 이후이면 '오후' 반환.
     *
     * [사용처]
     * - 마커 색상: 현재 시간대의 초급 지수로 마커 색 결정
     * - 팝업: 오늘 날짜 진입 시 현재 시간대 데이터 우선 표시
     */
    function _getCurrentTimeSlot() {
        return new Date().getHours() < 12 ? '오전' : '오후';
    }

    /**
     * YYYYMMDD 형식 날짜를 읽기 좋은 라벨로 변환합니다.
     *
     * 예시:
     *   "20260402" (오늘) → "오늘 04월 02일 (목)"
     *   "20260403"        → "04월 03일 (금)"
     *
     * [사용처] 팝업 상단의 날짜 네비게이션 라벨 ( < 오늘 04월 02일 (목) > )
     *
     * @param {string} dateStr - "20260402" 형식의 날짜 문자열
     * @returns {string} 포맷된 날짜 라벨
     */
    function _formatDateLabel(dateStr) {
        if (!dateStr || dateStr.length !== 8) return dateStr || '-';
        var y = parseInt(dateStr.substring(0, 4));
        var m = parseInt(dateStr.substring(4, 6)) - 1;  // Date 객체는 0-based month
        var d = parseInt(dateStr.substring(6, 8));
        var date = new Date(y, m, d);
        var days = ['일', '월', '화', '수', '목', '금', '토'];
        var dayName = days[date.getDay()];

        // 오늘이면 "오늘 " 접두사 추가
        var prefix = dateStr === _getTodayStr() ? '오늘 ' : '';
        return prefix + String(m + 1).padStart(2, '0') + '월 ' +
               String(d).padStart(2, '0') + '일 (' + dayName + ')';
    }

    /**
     * 풍향 각도(0~360도)를 한글 16방위 텍스트와 방향 화살표로 변환합니다.
     *
     * [원리]
     * 기상에서 풍향은 "바람이 불어오는 방향"을 가리킵니다.
     *   - 0° = 북풍 (북쪽에서 불어옴 → 남쪽으로 이동 → 화살표 ↓)
     *   - 90° = 동풍 (동쪽에서 불어옴 → 서쪽으로 이동 → 화살표 ←)
     *   - 180° = 남풍 (남쪽에서 불어옴 → 화살표 ↑)
     *   - 270° = 서풍 (서쪽에서 불어옴 → 화살표 →)
     *
     * [사용처] 팝업 상세정보 테이블의 바람 행 (화살표 + 방위 + 풍속)
     *
     * @param {number} deg - 풍향 각도 (0~360)
     * @returns {{ text: string, arrow: string }} 예: { text: '북서풍', arrow: '↘' }
     */
    function _windDirToText(deg) {
        if (deg === null || deg === undefined || isNaN(deg)) {
            return { text: '-', arrow: '' };
        }

        // 360도를 22.5도 간격으로 16등분
        // 인덱스 0 = 북풍(0°), 인덱스 4 = 동풍(90°), ...
        var dirs16 = [
            { text: '북풍',     arrow: '↓' },   // 0°     (N)
            { text: '북북동풍', arrow: '↙' },   // 22.5°  (NNE)
            { text: '북동풍',   arrow: '↙' },   // 45°    (NE)
            { text: '동북동풍', arrow: '←' },   // 67.5°  (ENE)
            { text: '동풍',     arrow: '←' },   // 90°    (E)
            { text: '동남동풍', arrow: '↖' },   // 112.5° (ESE)
            { text: '남동풍',   arrow: '↖' },   // 135°   (SE)
            { text: '남남동풍', arrow: '↑' },   // 157.5° (SSE)
            { text: '남풍',     arrow: '↑' },   // 180°   (S)
            { text: '남남서풍', arrow: '↗' },   // 202.5° (SSW)
            { text: '남서풍',   arrow: '↗' },   // 225°   (SW)
            { text: '서남서풍', arrow: '→' },   // 247.5° (WSW)
            { text: '서풍',     arrow: '→' },   // 270°   (W)
            { text: '서북서풍', arrow: '↘' },   // 292.5° (WNW)
            { text: '북서풍',   arrow: '↘' },   // 315°   (NW)
            { text: '북북서풍', arrow: '↓' }    // 337.5° (NNW)
        ];

        // 22.5도 단위로 반올림하여 인덱스 계산
        var idx = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
        return dirs16[idx];
    }

    /**
     * HTML 특수문자를 이스케이프합니다 (XSS 방지).
     * API 응답값을 innerHTML에 직접 삽입할 때 반드시 거쳐야 합니다.
     *
     * @param {string} str - 원본 문자열
     * @returns {string} 이스케이프된 문자열 (<, >, & 등 변환)
     */
    function _escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    /**
     * zone_forecasts 데이터에서 특정 해구·날짜의 9시/12시/15시/18시 데이터를 추출합니다.
     *
     * [데이터 구조]
     * zone_forecasts.json → { data: { "63": [ { tm: 2026040209, wh: 0.3, wp: 5.2, ws: 3.4, windDir: 239 }, ... ] } }
     * tm은 YYYYMMDDhh 형식의 숫자 (예: 2026040209 = 2026년 4월 2일 09시)
     *
     * [반환값 예시]
     * [
     *   { time: '9시',  wh: 0.3, wp: 5.2, ws: 3.4, windDir: 239 },
     *   { time: '12시', wh: 0.4, wp: 5.1, ws: 2.4, windDir: 247 },
     *   { time: '15시', wh: 0.3, wp: 5.2, ws: 3.1, windDir: 217 },
     *   { time: '18시', wh: 0.3, wp: 5.3, ws: 2.8, windDir: 200 }
     * ]
     * → 데이터가 없는 시간대는 wh/wp/ws/windDir이 null
     *
     * [사용처] 팝업 상세정보 테이블 (surfing4.js)
     *
     * @param {string} zoneId - 해구번호 (예: '63')
     * @param {string} dateStr - 날짜 YYYYMMDD (예: '20260402')
     * @returns {Array} 4개 시간대 데이터 배열
     */
    function _getZoneTimeData(zoneId, dateStr) {
        var s = window._surfing;

        // 기본값: 4개 시간대 빈 데이터
        var result = [
            { time: '9시',  wh: null, wp: null, ws: null, windDir: null },
            { time: '12시', wh: null, wp: null, ws: null, windDir: null },
            { time: '15시', wh: null, wp: null, ws: null, windDir: null },
            { time: '18시', wh: null, wp: null, ws: null, windDir: null }
        ];

        // zone_forecasts 데이터 또는 해당 해구가 없으면 빈 데이터 반환
        if (!s.zoneForecasts || !s.zoneForecasts.data) return result;
        var zoneData = s.zoneForecasts.data[zoneId];
        if (!zoneData || !Array.isArray(zoneData)) return result;

        // 각 시간대의 tm 값을 숫자로 만들어 검색
        // 예: dateStr="20260402" → 9시 = 2026040209, 12시 = 2026040212, ...
        var targets = [
            { idx: 0, tm: Number(dateStr + '09') },
            { idx: 1, tm: Number(dateStr + '12') },
            { idx: 2, tm: Number(dateStr + '15') },
            { idx: 3, tm: Number(dateStr + '18') }
        ];

        targets.forEach(function (t) {
            // zoneData 배열에서 tm이 일치하는 항목 찾기
            var item = zoneData.find(function (d) { return Number(d.tm) === t.tm; });
            if (item) {
                result[t.idx] = {
                    time: result[t.idx].time,
                    wh: item.wh !== undefined ? item.wh : null,
                    wp: item.wp !== undefined ? item.wp : null,
                    ws: item.ws !== undefined ? item.ws : null,
                    windDir: item.windDir !== undefined ? Number(item.windDir) : null
                };
            }
        });

        return result;
    }

    // ========================================================================
    // 6. 유틸 함수 등록 (다른 파일에서 window._surfing.utils.xxx 으로 호출)
    // ========================================================================

    /**
     * 유틸 함수들을 window._surfing.utils에 등록합니다.
     *
     * [사용 예시]
     * surfing2.js: var today = window._surfing.utils.getTodayStr();
     * surfing4.js: var label = window._surfing.utils.formatDateLabel('20260402');
     * surfing4.js: var wind = window._surfing.utils.windDirToText(315);
     * surfing4.js: var data = window._surfing.utils.getZoneTimeData('63', '20260402');
     */
    window._surfing.utils = {
        getTodayStr: _getTodayStr,
        getCurrentTimeSlot: _getCurrentTimeSlot,
        formatDateLabel: _formatDateLabel,
        windDirToText: _windDirToText,
        escapeHtml: _escapeHtml,
        getZoneTimeData: _getZoneTimeData
    };

})();
