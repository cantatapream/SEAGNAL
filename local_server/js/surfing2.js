/**
 * ============================================================================
 * 파일명: js/surfing2.js
 * 역할: 서핑지수 프론트엔드 - 마커 렌더링 / 범례 / "서핑지수란?" 버튼+팝업
 * ============================================================================
 *
 * [설명]
 * - 16개 해수욕장 위치에 초급 totalIndex 기준 발광형 동심원 마커를 그립니다.
 * - 마커 클릭 시 확대 + 글로우 강화 효과를 적용합니다.
 * - 지도 좌하단에 등급별 색상 범례를 표시합니다.
 * - 지도 우하단에 "서핑지수란?" 버튼을 표시하고, 클릭 시 설명 이미지 팝업을 엽니다.
 *
 * [로드 순서] surfing1.js 다음 (window._surfing이 이미 생성된 상태)
 *
 * [연계]
 * - surfing1.js → window._surfing 공유 상태 객체 (마커 레이어, 데이터 등)
 * - surfing3.js → openPopup() 호출 (마커 클릭 시 팝업 표시)
 * - index.html → #surfing-map, #surfing-guide-overlay, #surfing-guide-popup
 * - style.css → .surfing-legend, .surfing-legend-item, .surfing-legend-dot,
 *               .surfing-guide-btn, .surfing-guide-overlay, .surfing-guide-popup
 *
 * [마커 색상 기준]
 * 낚시와 달리 서핑은 초급(grdCn='초급')의 totalIndex를 기준으로 색상 결정.
 * 이유: 가장 폭넓은 이용자층인 초급자를 기준으로 한눈에 서핑 가능 여부를 판단.
 * ============================================================================
 */

(function () {
    'use strict';

    // window._surfing이 아직 초기화되지 않았을 경우 안전 처리
    // (로드 순서가 어긋났을 때 에러 방지)
    if (!window._surfing) {
        console.error('surfing2.js: window._surfing이 없습니다. surfing1.js를 먼저 로드하세요.');
        return;
    }

    var s = window._surfing;

    // ========================================================================
    // 1. 마커 렌더링
    // ========================================================================

    /**
     * 16개 서핑 해수욕장 마커를 지도에 렌더링합니다.
     *
     * [마커 색상 결정 방법]
     * 1. 오늘 날짜의 현재 시간대(오전/오후) 예보를 찾습니다.
     * 2. 해당 시간대의 "초급" grades 지수를 가져옵니다.
     *    예: forecasts['20260402']['오전'].grades.초급 = '매우좋음'
     * 3. '매우좋음'→파랑, '좋음'→초록, '보통'→노랑, '나쁨'→주황, '매우나쁨'→빨강
     * 4. 데이터가 없으면 '보통' (노랑)으로 기본 표시.
     *
     * [마커 구조]
     * Canvas(14×14px)에 직접 그린 발광형 동심원:
     * - 바깥층: 반투명 글로우 (등급색 25% 투명)
     * - 안쪽층: 중심→외곽 그라데이션 원
     * - 위치명: 마커 아래 흰색 굵은 텍스트 + 검정 외곽선
     *
     * [호출 시점]
     * surfing1.js → _loadSurfingData() 완료 후 s.renderMarkers() 호출
     */
    function _renderMarkers() {
        var data = s.data;
        var markerLayer = s.markerLayer;

        if (!data || !data.beaches || !markerLayer) return;

        var source = markerLayer.getSource();
        source.clear(); // 기존 마커 제거 후 새로 그리기

        var utils = s.utils;
        var todayStr = utils.getTodayStr();          // 오늘 날짜 YYYYMMDD
        var timeSlot = utils.getCurrentTimeSlot();   // 현재 시간대: '오전' 또는 '오후'
        var LEVEL_COLORS = s.LEVEL_COLORS;
        var LEVEL_PRIORITY = s.LEVEL_PRIORITY;

        Object.keys(data.beaches).forEach(function (beachName) {
            var beach = data.beaches[beachName];
            if (!beach.lat || !beach.lot) return;

            // --- 초급 지수 추출 ---
            // 오늘 예보 → 현재 시간대 → 초급 grades
            // 현재 시간대 없으면 오전 → 오후 → 종일('일') 순서로 폴백
            var level = '보통'; // 기본값
            var todayForecast = beach.forecasts && beach.forecasts[todayStr];
            if (todayForecast) {
                var slotData = todayForecast[timeSlot]
                            || todayForecast['오전']
                            || todayForecast['오후']
                            || todayForecast['일'];
                if (slotData && slotData.grades && slotData.grades['초급']) {
                    level = slotData.grades['초급'];
                }
            }

            var colors = LEVEL_COLORS[level] || LEVEL_COLORS['보통'];

            // --- Canvas로 발광형 동심원 마커 그리기 ---
            var size = 14;
            var canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            var ctx = canvas.getContext('2d');
            var cx = size / 2, cy = size / 2, r = size / 2 - 1;

            // 바깥층: 반투명 글로우 (등급 색상, 더 넓게)
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, 2 * Math.PI);
            ctx.fillStyle = colors.glow;
            ctx.fill();

            // 안쪽층: 중심(밝은색) → 외곽(진한색) 그라데이션 원
            var grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r - 1);
            grad.addColorStop(0, colors.inner);
            grad.addColorStop(1, colors.outer);
            ctx.beginPath();
            ctx.arc(cx, cy, r - 1, 0, 2 * Math.PI);
            ctx.fillStyle = grad;
            ctx.fill();

            // --- OpenLayers 피처 생성 ---
            // geometry: 위경도(EPSG:4326) → 지도 좌표계(EPSG:3857) 변환
            // beachName: 클릭 이벤트(surfing1.js)에서 팝업 호출에 사용
            // level: 마커 선택/복원 시 색상 참조에 사용
            var feature = new ol.Feature({
                geometry: new ol.geom.Point(ol.proj.fromLonLat([beach.lot, beach.lat])),
                beachName: beachName,
                level: level
            });

            // 마커 아이콘(Canvas 이미지) + 위치명 텍스트 스타일
            feature.setStyle(new ol.style.Style({
                image: new ol.style.Icon({
                    img: canvas,
                    imgSize: [size, size],
                    anchor: [0.5, 0.5]
                }),
                text: new ol.style.Text({
                    text: beachName,
                    font: 'bold 11px "Noto Sans KR", sans-serif',
                    offsetY: 14,
                    fill: new ol.style.Fill({ color: '#ffffff' }),
                    stroke: new ol.style.Stroke({ color: '#000000', width: 3 })
                })
            }));

            source.addFeature(feature);
        });
    }

    // ========================================================================
    // 2. 마커 선택 효과 (클릭 시 확대 + 글로우 강화)
    // ========================================================================

    /**
     * 마커 클릭 시 확대(14→22px) + 흰 테두리 + 글로우 강화 효과를 적용합니다.
     * 이전에 선택된 마커가 있으면 원래 크기로 복원합니다.
     *
     * [동작 예시]
     * 경포해수욕장 마커 클릭
     *  → 경포 마커: 14px → 22px 확대, 흰 테두리 추가
     *  → 이전에 선택된 죽도 마커: 22px → 14px 복원
     *
     * @param {ol.Feature} feature - 클릭된 OpenLayers 피처
     */
    function _selectMarker(feature) {
        // 이전 선택 마커 원래 크기로 복원
        if (s.selectedFeature && s.selectedFeature !== feature) {
            _resetMarkerStyle(s.selectedFeature);
        }
        s.selectedFeature = feature;

        var beachName = feature.get('beachName');
        var level = feature.get('level') || '보통';
        var colors = s.LEVEL_COLORS[level] || s.LEVEL_COLORS['보통'];

        // 선택 상태: 22px 크기 + 글로우 강화(0.5→0.8) + 흰 외곽선
        var size = 22;
        var canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        var ctx = canvas.getContext('2d');
        var cx = size / 2, cy = size / 2, r = size / 2 - 1;

        // 글로우 (더 넓고 밝게: glow rgba의 투명도 0.5→0.8)
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 2 * Math.PI);
        ctx.fillStyle = colors.glow.replace('0.5)', '0.8)');
        ctx.fill();

        // 그라데이션 원 (흰색 중심 추가로 더 밝게)
        var grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r - 1);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.3, colors.inner);
        grad.addColorStop(1, colors.outer);
        ctx.beginPath();
        ctx.arc(cx, cy, r - 1, 0, 2 * Math.PI);
        ctx.fillStyle = grad;
        ctx.fill();

        // 흰색 외곽선 (선택됐음을 시각적으로 강조)
        ctx.beginPath();
        ctx.arc(cx, cy, r - 1, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        feature.setStyle(new ol.style.Style({
            image: new ol.style.Icon({
                img: canvas,
                imgSize: [size, size],
                anchor: [0.5, 0.5]
            }),
            text: new ol.style.Text({
                text: beachName,
                font: 'bold 12px "Noto Sans KR", sans-serif',
                offsetY: 18,
                fill: new ol.style.Fill({ color: '#ffffff' }),
                stroke: new ol.style.Stroke({ color: '#000000', width: 3 })
            })
        }));
    }

    /**
     * 마커를 원래 기본 스타일(14px)로 복원합니다.
     * 팝업을 닫거나 다른 마커를 클릭할 때 호출됩니다.
     *
     * @param {ol.Feature} feature - 복원할 OpenLayers 피처
     */
    function _resetMarkerStyle(feature) {
        if (!feature) return;

        var level = feature.get('level') || '보통';
        var beachName = feature.get('beachName');
        var colors = s.LEVEL_COLORS[level] || s.LEVEL_COLORS['보통'];

        var size = 14;
        var canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        var ctx = canvas.getContext('2d');
        var cx = size / 2, cy = size / 2, r = size / 2 - 1;

        // 바깥층: 글로우
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 2 * Math.PI);
        ctx.fillStyle = colors.glow;
        ctx.fill();

        // 안쪽층: 그라데이션
        var grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r - 1);
        grad.addColorStop(0, colors.inner);
        grad.addColorStop(1, colors.outer);
        ctx.beginPath();
        ctx.arc(cx, cy, r - 1, 0, 2 * Math.PI);
        ctx.fillStyle = grad;
        ctx.fill();

        feature.setStyle(new ol.style.Style({
            image: new ol.style.Icon({
                img: canvas,
                imgSize: [size, size],
                anchor: [0.5, 0.5]
            }),
            text: new ol.style.Text({
                text: beachName,
                font: 'bold 11px "Noto Sans KR", sans-serif',
                offsetY: 14,
                fill: new ol.style.Fill({ color: '#ffffff' }),
                stroke: new ol.style.Stroke({ color: '#000000', width: 3 })
            })
        }));
    }

    // ========================================================================
    // 3. 범례 컨트롤 (지도 좌하단)
    // ========================================================================

    /**
     * 지도 좌측 하단에 등급별 색상 범례를 추가합니다.
     *
     * [표시 내용]
     * ● 매우좋음  ● 좋음  ● 보통  ● 나쁨  ● 매우나쁨
     * 각 점은 해당 등급의 발광형 마커 색상과 동일합니다.
     *
     * [구현 방식]
     * ol.control.Control로 OL 지도 위에 오버레이 → CSS position:absolute로 좌하단 배치
     *
     * @param {ol.Map} map - OpenLayers Map 인스턴스
     */
    function _addLegendControl(map) {
        var legendEl = document.createElement('div');
        legendEl.className = 'surfing-legend';

        // 범례 항목: 등급 이름과 색상을 배열로 정의
        var levels = [
            { name: '매우좋음', inner: '#81D4FA', outer: '#1565C0', glow: 'rgba(21,101,192,0.4)' },
            { name: '좋음',     inner: '#81C784', outer: '#2E7D32', glow: 'rgba(46,125,50,0.4)' },
            { name: '보통',     inner: '#FFD54F', outer: '#F9A825', glow: 'rgba(249,168,37,0.4)' },
            { name: '나쁨',     inner: '#FFB74D', outer: '#E65100', glow: 'rgba(230,81,0,0.4)' },
            { name: '매우나쁨', inner: '#EF9A9A', outer: '#C62828', glow: 'rgba(198,40,40,0.4)' }
        ];

        levels.forEach(function (lv) {
            var item = document.createElement('span');
            item.className = 'surfing-legend-item';
            // 발광형 동심원 작은 점 (마커와 동일한 radial-gradient)
            item.innerHTML = '<span class="surfing-legend-dot" style="background:radial-gradient(circle, ' +
                lv.inner + ' 30%, ' + lv.outer + ' 100%);box-shadow:0 0 6px ' + lv.glow + ';"></span>' +
                lv.name;
            legendEl.appendChild(item);
        });

        legendEl.style.position = 'absolute';
        legendEl.style.bottom = '8px';
        legendEl.style.left = '8px';

        map.addControl(new ol.control.Control({ element: legendEl }));
    }

    // ========================================================================
    // 4. "서핑지수란?" 버튼 + 팝업 (지도 우하단)
    // ========================================================================

    /**
     * 지도 우측 하단에 "서핑지수란?" 버튼을 추가합니다.
     * 클릭하면 서핑지수 설명 이미지 팝업이 열립니다.
     *
     * [표시 예시]
     * ┌────────────────────────┐
     * │ ? 서핑지수란?          │ ← 지도 우하단
     * └────────────────────────┘
     *
     * @param {ol.Map} map - OpenLayers Map 인스턴스
     */
    function _addGuideControl(map) {
        var btn = document.createElement('button');
        btn.className = 'surfing-guide-btn';
        btn.innerHTML = '<i class="fa-solid fa-circle-question"></i> 서핑지수란?';
        btn.style.position = 'absolute';
        btn.style.bottom = '8px';
        btn.style.right = '8px';

        // 클릭 시 팝업 열기 (이벤트 버블링 차단: 지도 클릭 이벤트가 함께 발생하지 않도록)
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            _openGuidePopup();
        });

        map.addControl(new ol.control.Control({ element: btn }));
    }

    /**
     * 서핑지수 설명 이미지 팝업을 엽니다.
     *
     * [팝업 구조]
     * ┌─────────────────────────────┐
     * │ 서핑지수란?              ✕  │ ← 헤더
     * ├─────────────────────────────┤
     * │ [로딩 스피너]               │
     * │      ↓ 이미지 로딩 완료      │
     * │ [surfing_index_info.png]    │ ← 설명 이미지
     * └─────────────────────────────┘
     *
     * [이미지 경로] /images/surfing_index_info.png
     * (local_server/images/surfing_index_info.png → 서버가 /images/ 로 서빙)
     *
     * [닫기 방법]
     * - 헤더 ✕ 버튼 클릭
     * - 팝업 바깥(오버레이) 클릭
     * - 뒤로가기 버튼 (PopupStack 등록)
     */
    function _openGuidePopup() {
        // 기존 팝업이 열려 있으면 먼저 닫기
        _closeGuidePopup();

        // --- 오버레이 (팝업 뒤 어두운 배경, 클릭 시 팝업 닫힘) ---
        var overlay = document.createElement('div');
        overlay.className = 'surfing-guide-overlay';
        overlay.id = 'surfing-guide-overlay';
        overlay.addEventListener('click', function () { _closeGuidePopup(); });

        // --- 팝업 컨테이너 ---
        var popup = document.createElement('div');
        popup.className = 'surfing-guide-popup';
        popup.id = 'surfing-guide-popup';
        // 팝업 내부 클릭은 오버레이 클릭으로 전파되지 않도록 차단
        popup.addEventListener('click', function (e) { e.stopPropagation(); });

        // --- 헤더 (타이틀 + 닫기 버튼) ---
        var header = document.createElement('div');
        header.className = 'surfing-guide-popup-header';
        header.innerHTML =
            '<span>서핑지수란?</span>' +
            '<button class="surfing-guide-popup-close" id="surfing-guide-close">' +
            '<i class="fa-solid fa-xmark"></i></button>';

        // --- 바디 (스크롤 가능한 이미지 영역) ---
        var body = document.createElement('div');
        body.className = 'surfing-guide-popup-body';

        // 로딩 스피너: 이미지를 가져오는 동안 표시
        var spinner = document.createElement('div');
        spinner.className = 'guide-popup-spinner';
        spinner.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        body.appendChild(spinner);

        // 설명 이미지: 처음에는 숨김, 로딩 완료 시 스피너 교체
        var img = document.createElement('img');
        img.src = '/images/surfing_index_info.png';
        img.alt = '서핑지수 안내';
        img.style.width = '100%';
        img.style.display = 'none';
        img.onload = function () {
            spinner.style.display = 'none';
            img.style.display = 'block';
        };
        img.onerror = function () {
            // 이미지 로드 실패 시 스피너를 오류 메시지로 교체
            spinner.innerHTML = '<span style="color:#ef4444;font-size:0.8rem;">이미지를 불러올 수 없습니다.</span>';
        };
        body.appendChild(img);

        popup.appendChild(header);
        popup.appendChild(body);
        document.body.appendChild(overlay);
        document.body.appendChild(popup);

        // 닫기 버튼 이벤트
        document.getElementById('surfing-guide-close').addEventListener('click', function () {
            _closeGuidePopup();
        });

        // 뒤로가기 버튼으로 팝업 닫기 지원 (앱 내 PopupStack 연동)
        if (window.PopupStack) {
            window.PopupStack.push('surfing-guide-popup', function () {
                _closeGuidePopup();
            });
        }
    }

    /**
     * 서핑지수 설명 팝업을 닫고 DOM 요소를 제거합니다.
     * 이미지 로딩 중 닫힐 때 핸들러를 정리하여 메모리 누수를 방지합니다.
     */
    function _closeGuidePopup() {
        var overlay = document.getElementById('surfing-guide-overlay');
        var popup = document.getElementById('surfing-guide-popup');

        if (popup) {
            // 이미지 로딩 중 팝업이 닫혀도 핸들러가 실행되지 않도록 제거
            var img = popup.querySelector('img');
            if (img) { img.onload = null; img.onerror = null; }
            popup.remove();
        }
        if (overlay) overlay.remove();

        if (window.PopupStack) {
            window.PopupStack.remove('surfing-guide-popup');
        }
    }

    // ========================================================================
    // 5. window._surfing에 함수 등록
    // ========================================================================

    /**
     * surfing1.js의 initSurfingMap()이 아래 함수를 호출합니다.
     * surfing2.js가 로드될 때 슬롯에 등록합니다.
     *
     * 등록 순서:
     *   surfing1.js 로드 → window._surfing 생성 (슬롯은 null)
     *   surfing2.js 로드 → 아래 줄에서 슬롯에 실제 함수 등록
     *   사용자가 서핑 탭 클릭 → initSurfingMap() → s.renderMarkers() 등 호출
     */
    s.renderMarkers    = _renderMarkers;
    s.selectMarker     = _selectMarker;
    s.resetMarkerStyle = _resetMarkerStyle;
    s.addLegendControl = _addLegendControl;
    s.addGuideControl  = _addGuideControl;

})();
