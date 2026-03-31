/**
 * ============================================================================
 * 파일명: js/fishing.js
 * 역할: 바다낚시 지수 프론트엔드 전체 로직
 * ============================================================================
 *
 * [설명]
 * 이 파일은 바다낚시 지수 탭의 모든 프론트엔드 기능을 담당합니다.
 * - OpenLayers 지도 초기화 (OSM 타일 + 발광형 동심원 마커)
 * - 갯바위/선상 구분 토글
 * - GPS 기반 내 위치 이동
 * - 마커 클릭 시 바텀시트 표시 (종합지수, 날짜 네비게이션, 어종 그리드)
 * - 오전/오후 예보 표시 로직 (현재 시간 기준 자동 판단)
 * - 기타어종 툴팁
 *
 * [연계 파일]
 * - index.html → #fishing-section 내 HTML 요소들
 * - style.css → .fishing-* 클래스 스타일
 * - routes/fishing.js (서버) → GET /api/fishing-index 데이터 제공
 * - js/marine.js → _onSectionActivated('fishing-section') 시 initFishingMap() 호출
 *
 * [데이터 구조] (서버 응답)
 * {
 *   updatedAt: "2026.03.31 09:00",
 *   갯바위: { "거제도": { lat, lot, forecasts: { "20260331": { "오전": {...}, "오후": {...} } }, etcFishList } },
 *   선상: { "거제도": { lat, lot, forecasts: {...}, etcFishList } }
 * }
 * ============================================================================
 */

(function () {
    'use strict';

    // ========================================================================
    // 상수 및 상태 변수
    // ========================================================================

    /** 지수 등급별 색상 맵 (발광형 동심원 마커 + 배지에 사용) */
    const LEVEL_COLORS = {
        '매우좋음': { inner: '#81D4FA', outer: '#1565C0', glow: 'rgba(21,101,192,0.5)' },
        '좋음':     { inner: '#81C784', outer: '#2E7D32', glow: 'rgba(46,125,50,0.5)' },
        '보통':     { inner: '#FFD54F', outer: '#F9A825', glow: 'rgba(249,168,37,0.5)' },
        '나쁨':     { inner: '#FFB74D', outer: '#E65100', glow: 'rgba(230,81,0,0.5)' },
        '매우나쁨': { inner: '#EF9A9A', outer: '#C62828', glow: 'rgba(198,40,40,0.5)' }
    };

    /** 지수 등급 우선순위 (높을수록 좋음, 마커 정렬에 사용) */
    const LEVEL_PRIORITY = { '매우나쁨': 1, '나쁨': 2, '보통': 3, '좋음': 4, '매우좋음': 5 };

    /** 한국 중심 좌표 및 기본 줌 (EPSG:4326 → EPSG:3857 변환) */
    const KOREA_CENTER = ol.proj.fromLonLat([127.8, 35.9]);
    const DEFAULT_ZOOM = 7;

    // --- 모듈 상태 ---
    let fishingMap = null;          // OpenLayers Map 인스턴스
    let markerLayer = null;         // 마커 벡터 레이어
    let fishingData = null;         // 서버에서 받은 전체 데이터
    let currentGubun = '갯바위';    // 현재 선택된 구분 (갯바위/선상)
    let selectedPlace = null;       // 바텀시트에 표시 중인 위치명
    let selectedDateIdx = 0;        // 바텀시트 날짜 인덱스 (0 = 오늘)
    let availableDates = [];        // 사용 가능한 날짜 목록 (YYYYMMDD)
    let activeTooltip = null;       // 현재 표시 중인 기타어종 툴팁 엘리먼트
    let selectedFeature = null;     // 현재 선택된 마커 피처 (시각적 피드백용)

    // ========================================================================
    // 1. 지도 초기화
    // ========================================================================

    /**
     * OpenLayers 지도를 초기화하고 마커 레이어를 추가합니다.
     * fishing-section 탭이 활성화될 때 한 번만 호출됩니다.
     * 이미 초기화된 경우 지도 크기만 갱신합니다.
     */
    window.initFishingMap = function () {
        // 이미 초기화된 경우 사이즈 갱신만 수행
        if (fishingMap) {
            fishingMap.updateSize();
            return;
        }

        // 마커를 담을 벡터 소스 및 레이어 생성
        const vectorSource = new ol.source.Vector();
        markerLayer = new ol.layer.Vector({
            source: vectorSource,
            // 마커 z-index: 좋은 등급이 위에 오도록 (나쁨이 아래)
            renderOrder: function (a, b) {
                const pa = LEVEL_PRIORITY[a.get('level')] || 0;
                const pb = LEVEL_PRIORITY[b.get('level')] || 0;
                return pa - pb;
            }
        });

        // 지도 생성 (OSM 타일 + 마커 레이어)
        fishingMap = new ol.Map({
            target: 'fishing-map',
            layers: [
                new ol.layer.Tile({
                    source: new ol.source.OSM()
                }),
                markerLayer
            ],
            view: new ol.View({
                center: KOREA_CENTER,
                zoom: DEFAULT_ZOOM,
                minZoom: 6,
                maxZoom: 13
            }),
            // 줌 컨트롤 및 attribution 표시 제거 (핀치줌/스크롤줌은 유지)
            controls: ol.control.defaults.defaults({ attribution: false, zoom: false })
        });

        // 마커 클릭 이벤트: 선택 피드백 + 팝업 표시
        fishingMap.on('singleclick', function (evt) {
            const feature = fishingMap.forEachFeatureAtPixel(evt.pixel, function (f) { return f; });
            if (feature && feature.get('placeName')) {
                _selectMarker(feature);
                _openBottomSheet(feature.get('placeName'));
            }
        });

        // 마커 위에서 커서 변경 (포인터 ↔ 기본)
        fishingMap.on('pointermove', function (evt) {
            const hit = fishingMap.forEachFeatureAtPixel(evt.pixel, function () { return true; });
            fishingMap.getTargetElement().style.cursor = hit ? 'pointer' : '';
        });

        // 지도 내부 좌측 하단 범례 + 우측 하단 안내 버튼 컨트롤 추가
        _addLegendControl(fishingMap);
        _addGuideControl(fishingMap);

        // 데이터 로드 및 마커 렌더링
        _loadFishingData();

        // 이벤트 바인딩 (최초 1회)
        _bindEvents();
    };

    // ========================================================================
    // 1-1. 지도 내부 커스텀 컨트롤 (범례, 안내 버튼)
    // ========================================================================

    /**
     * 지도 내부 좌측 하단에 범례 컨트롤을 추가합니다.
     * ol.control.Control을 사용하여 OL 지도 위에 오버레이합니다.
     * @param {ol.Map} map - OpenLayers Map 인스턴스
     */
    function _addLegendControl(map) {
        var legendEl = document.createElement('div');
        legendEl.className = 'fishing-legend';

        // 범례 항목 생성 (등급별 발광형 동심원 + 라벨)
        var levels = [
            { name: '매우좋음', inner: '#81D4FA', outer: '#1565C0', glow: 'rgba(21,101,192,0.4)' },
            { name: '좋음',     inner: '#81C784', outer: '#2E7D32', glow: 'rgba(46,125,50,0.4)' },
            { name: '보통',     inner: '#FFD54F', outer: '#F9A825', glow: 'rgba(249,168,37,0.4)' },
            { name: '나쁨',     inner: '#FFB74D', outer: '#E65100', glow: 'rgba(230,81,0,0.4)' },
            { name: '매우나쁨', inner: '#EF9A9A', outer: '#C62828', glow: 'rgba(198,40,40,0.4)' }
        ];

        levels.forEach(function (lv) {
            var item = document.createElement('span');
            item.className = 'fishing-legend-item';
            item.innerHTML = '<span class="fishing-legend-dot" style="background:radial-gradient(circle, ' +
                lv.inner + ' 30%, ' + lv.outer + ' 100%);box-shadow:0 0 6px ' + lv.glow + ';"></span>' + lv.name;
            legendEl.appendChild(item);
        });

        var legendControl = new ol.control.Control({
            element: legendEl
        });

        // 좌측 하단에 위치 (CSS position으
        legendEl.style.position = 'absolute';
        legendEl.style.bottom = '8px';
        legendEl.style.left = '8px';

        map.addControl(legendControl);
    }

    /**
     * 지도 내부 우측 하단에 지수 안내 버튼을 추가합니다.
     * 현재 구분(갯바위/선상)에 따라 라벨이 변경됩니다.
     * @param {ol.Map} map - OpenLayers Map 인스턴스
     */
    var guideButtonEl = null; // 안내 버튼 엘리먼트 (라벨 변경용 참조)

    function _addGuideControl(map) {
        guideButtonEl = document.createElement('button');
        guideButtonEl.className = 'fishing-guide-btn';
        guideButtonEl.innerHTML = '<i class="fa-solid fa-circle-question"></i> <span class="fishing-guide-btn-label">갯바위낚시지수란?</span>';
        guideButtonEl.style.position = 'absolute';
        guideButtonEl.style.bottom = '8px';
        guideButtonEl.style.right = '8px';

        // 클릭 시 안내 팝업 열기
        guideButtonEl.addEventListener('click', function (e) {
            e.stopPropagation();
            _openGuidePopup();
        });

        var guideControl = new ol.control.Control({
            element: guideButtonEl
        });
        map.addControl(guideControl);
    }

    /**
     * 안내 버튼 라벨을 현재 구분에 맞게 업데이트합니다.
     */
    function _updateGuideButtonLabel() {
        if (!guideButtonEl) return;
        var label = guideButtonEl.querySelector('.fishing-guide-btn-label');
        if (label) {
            label.textContent = currentGubun === '선상' ? '선상낚시지수란?' : '갯바위낚시지수란?';
        }
    }

    /**
     * 지수 안내 팝업을 엽니다.
     * 구분에 따라 해당 이미지를 표시합니다.
     */
    function _openGuidePopup() {
        // 기존 팝업 제거
        _closeGuidePopup();

        var imgSrc = currentGubun === '선상'
            ? '/images/fishing_index_ship.png'
            : '/images/fishing_index_gwbr.png';
        var title = currentGubun === '선상' ? '선상낚시지수란?' : '갯바위낚시지수란?';

        // 팝업 오버레이
        var overlay = document.createElement('div');
        overlay.className = 'fishing-guide-overlay';
        overlay.id = 'fishing-guide-overlay';
        overlay.addEventListener('click', function () { _closeGuidePopup(); });

        // 팝업 컨테이너
        var popup = document.createElement('div');
        popup.className = 'fishing-guide-popup';
        popup.id = 'fishing-guide-popup';
        popup.addEventListener('click', function (e) { e.stopPropagation(); });

        // 헤더 (타이틀 + 닫기 버튼)
        var header = document.createElement('div');
        header.className = 'fishing-guide-popup-header';
        header.innerHTML = '<span>' + title + '</span>' +
            '<button class="fishing-guide-popup-close" id="fishing-guide-close"><i class="fa-solid fa-xmark"></i></button>';

        // 스크롤 가능한 이미지 영역
        var body = document.createElement('div');
        body.className = 'fishing-guide-popup-body';
        var img = document.createElement('img');
        img.src = imgSrc;
        img.alt = title;
        img.style.width = '100%';
        body.appendChild(img);

        popup.appendChild(header);
        popup.appendChild(body);
        document.body.appendChild(overlay);
        document.body.appendChild(popup);

        // 닫기 버튼 이벤트
        document.getElementById('fishing-guide-close').addEventListener('click', function () {
            _closeGuidePopup();
        });

        // PopupStack 등록 (뒤로가기 버튼 지원)
        if (window.PopupStack) {
            window.PopupStack.push('fishing-guide-popup', function () {
                _closeGuidePopup();
            });
        }
    }

    /**
     * 지수 안내 팝업을 닫습니다.
     */
    function _closeGuidePopup() {
        var overlay = document.getElementById('fishing-guide-overlay');
        var popup = document.getElementById('fishing-guide-popup');
        if (overlay) overlay.remove();
        if (popup) popup.remove();
        if (window.PopupStack) {
            window.PopupStack.remove('fishing-guide-popup');
        }
    }

    // ========================================================================
    // 1-2. 마커 선택 시각적 피드백
    // ========================================================================

    /**
     * 마커 선택 시 확대 + 글로우 강화 효과를 적용합니다.
     * 이전 선택 마커는 원래 크기로 복원합니다.
     * @param {ol.Feature} feature - 선택된 피처
     */
    function _selectMarker(feature) {
        // 이전 선택 해제
        if (selectedFeature && selectedFeature !== feature) {
            _resetMarkerStyle(selectedFeature);
        }
        selectedFeature = feature;

        var placeName = feature.get('placeName');
        var level = feature.get('level') || '보통';
        var colors = LEVEL_COLORS[level] || LEVEL_COLORS['보통'];

        // 선택 상태: 마커 크기 확대 (14→22px) + 글로우 강화
        var size = 22;
        var canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        var ctx = canvas.getContext('2d');
        var cx = size / 2, cy = size / 2, r = size / 2 - 1;

        // 글로우 (더 넓고 밝게)
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 2 * Math.PI);
        ctx.fillStyle = colors.glow.replace('0.5)', '0.8)');
        ctx.fill();

        // 그라데이션 원
        var grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r - 1);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.3, colors.inner);
        grad.addColorStop(1, colors.outer);
        ctx.beginPath();
        ctx.arc(cx, cy, r - 1, 0, 2 * Math.PI);
        ctx.fillStyle = grad;
        ctx.fill();

        // 흰색 외곽선 추가
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
                text: placeName,
                font: 'bold 12px "Noto Sans KR", sans-serif',
                offsetY: 18,
                fill: new ol.style.Fill({ color: '#ffffff' }),
                stroke: new ol.style.Stroke({ color: '#000000', width: 3 })
            })
        }));
    }

    /**
     * 마커를 원래 스타일(14px 기본)로 복원합니다.
     * @param {ol.Feature} feature - 복원할 피처
     */
    function _resetMarkerStyle(feature) {
        if (!feature) return;
        var level = feature.get('level') || '보통';
        var placeName = feature.get('placeName');
        var colors = LEVEL_COLORS[level] || LEVEL_COLORS['보통'];

        var size = 14;
        var canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        var ctx = canvas.getContext('2d');
        var cx = size / 2, cy = size / 2, r = size / 2 - 1;

        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 2 * Math.PI);
        ctx.fillStyle = colors.glow;
        ctx.fill();

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
                text: placeName,
                font: 'bold 12px "Noto Sans KR", sans-serif',
                offsetY: 14,
                fill: new ol.style.Fill({ color: '#ffffff' }),
                stroke: new ol.style.Stroke({ color: '#000000', width: 3 })
            })
        }));
    }

    // ========================================================================
    // 2. 데이터 로드 및 마커 렌더링
    // ========================================================================

    /**
     * 서버에서 바다낚시 지수 데이터를 가져옵니다.
     * 성공 시 마커를 렌더링하고 발표시점을 표시합니다.
     */
    async function _loadFishingData() {
        try {
            const res = await fetch('/api/fishing-index');
            if (!res.ok) throw new Error('데이터 없음');
            fishingData = await res.json();

            // 발표시점 표시
            const pubEl = document.getElementById('fishing-publish-time');
            if (pubEl && fishingData.updatedAt) {
                pubEl.textContent = '발표: ' + fishingData.updatedAt;
            }

            // 마커 렌더링
            _renderMarkers();
        } catch (e) {
            console.warn('🎣 바다낚시 데이터 로드 실패:', e.message);
        }
    }

    /**
     * 현재 구분(갯바위/선상)에 해당하는 마커를 지도에 렌더링합니다.
     * 각 위치에 대해 오늘 날짜의 현재 시간대(오전/오후) 종합 지수로 색상을 결정합니다.
     */
    function _renderMarkers() {
        if (!fishingData || !markerLayer) return;

        const source = markerLayer.getSource();
        source.clear();

        const gubunData = fishingData[currentGubun];
        if (!gubunData) return;

        // 오늘 날짜 (YYYYMMDD)
        const todayStr = _getTodayStr();

        // 현재 시간대: 12시 이전이면 오전, 이후면 오후
        const timeSlot = _getCurrentTimeSlot();

        Object.keys(gubunData).forEach(function (placeName) {
            const place = gubunData[placeName];
            if (!place.lat || !place.lot) return;

            // 오늘 예보에서 현재 시간대의 종합 지수 추출
            let level = '';
            const todayForecast = place.forecasts && place.forecasts[todayStr];
            if (todayForecast) {
                const slotData = todayForecast[timeSlot] || todayForecast['오전'] || todayForecast['오후'];
                if (slotData) level = slotData.totalIndex || '';
            }

            // 지수가 없으면 기본 '보통'으로 표시
            if (!level) level = '보통';

            const colors = LEVEL_COLORS[level] || LEVEL_COLORS['보통'];

            // 발광형 동심원 마커 (Canvas로 그린 원형 이미지, 조석정보 마커와 유사한 크기)
            const canvas = document.createElement('canvas');
            const size = 14;
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            const cx = size / 2, cy = size / 2, r = size / 2 - 1;

            // 외곽 글로우 (반투명 원)
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, 2 * Math.PI);
            ctx.fillStyle = colors.glow;
            ctx.fill();

            // 그라데이션 원 (중심 밝게 → 외곽 어둡게)
            const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r - 1);
            grad.addColorStop(0, colors.inner);
            grad.addColorStop(1, colors.outer);
            ctx.beginPath();
            ctx.arc(cx, cy, r - 1, 0, 2 * Math.PI);
            ctx.fillStyle = grad;
            ctx.fill();

            // 피처 생성 (위경도 → EPSG:3857)
            const feature = new ol.Feature({
                geometry: new ol.geom.Point(ol.proj.fromLonLat([place.lot, place.lat])),
                placeName: placeName,
                level: level
            });

            // 마커 아이콘 + 위치명 텍스트 스타일 (조석정보 탭과 동일한 크기/배치)
            feature.setStyle(new ol.style.Style({
                image: new ol.style.Icon({
                    img: canvas,
                    imgSize: [size, size],
                    anchor: [0.5, 0.5]
                }),
                text: new ol.style.Text({
                    text: placeName,
                    font: 'bold 12px "Noto Sans KR", sans-serif',
                    offsetY: 14,
                    fill: new ol.style.Fill({ color: '#ffffff' }),
                    stroke: new ol.style.Stroke({ color: '#000000', width: 3 })
                })
            }));

            source.addFeature(feature);
        });
    }

    // ========================================================================
    // 3. 이벤트 바인딩
    // ========================================================================

    /**
     * 갯바위/선상 토글, GPS, 바텀시트 닫기, 날짜 네비게이션 등 이벤트를 바인딩합니다.
     * initFishingMap()에서 최초 1회 호출됩니다.
     */
    function _bindEvents() {
        // --- 갯바위/선상 토글 버튼 ---
        document.querySelectorAll('.fishing-gubun-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const gubun = this.dataset.gubun;
                if (gubun === currentGubun) return;

                // active 클래스 전환
                document.querySelectorAll('.fishing-gubun-btn').forEach(function (b) { b.classList.remove('active'); });
                this.classList.add('active');

                currentGubun = gubun;
                _renderMarkers();
                _closeBottomSheet();
                _updateGuideButtonLabel();
            });
        });

        // --- GPS 내 위치 버튼 ---
        var gpsBtn = document.getElementById('fishing-my-location-btn');
        if (gpsBtn) {
            gpsBtn.addEventListener('click', function () {
                _moveToMyLocation();
            });
        }

        // --- 바텀시트 닫기 버튼 ---
        var closeBtn = document.getElementById('fishing-bs-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', function () {
                _closeBottomSheet();
            });
        }

        // --- 바텀시트 오버레이 클릭으로 닫기 ---
        var overlay = document.getElementById('fishing-bottomsheet-overlay');
        if (overlay) {
            overlay.addEventListener('click', function () {
                _closeBottomSheet();
            });
        }

        // --- 날짜 이전/다음 버튼 ---
        var prevBtn = document.getElementById('fishing-date-prev');
        var nextBtn = document.getElementById('fishing-date-next');
        if (prevBtn) {
            prevBtn.addEventListener('click', function () {
                if (selectedDateIdx > 0) {
                    selectedDateIdx--;
                    _renderBottomSheetContent();
                }
            });
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', function () {
                if (selectedDateIdx < availableDates.length - 1) {
                    selectedDateIdx++;
                    _renderBottomSheetContent();
                }
            });
        }
    }

    // ========================================================================
    // 4. GPS 내 위치 이동
    // ========================================================================

    /**
     * 브라우저 Geolocation API를 사용하여 사용자의 현재 위치로 지도를 이동합니다.
     * Capacitor 환경에서도 동작합니다.
     */
    function _moveToMyLocation() {
        if (!navigator.geolocation) {
            alert('이 기기에서는 위치 서비스를 사용할 수 없습니다.');
            return;
        }

        var gpsBtn = document.getElementById('fishing-my-location-btn');
        if (gpsBtn) gpsBtn.classList.add('loading');

        navigator.geolocation.getCurrentPosition(
            function (pos) {
                if (gpsBtn) gpsBtn.classList.remove('loading');
                var coord = ol.proj.fromLonLat([pos.coords.longitude, pos.coords.latitude]);
                fishingMap.getView().animate({
                    center: coord,
                    zoom: 10,
                    duration: 600
                });
            },
            function (err) {
                if (gpsBtn) gpsBtn.classList.remove('loading');
                console.warn('🎣 GPS 오류:', err.message);
                alert('위치를 가져올 수 없습니다.\n위치 권한을 확인해 주세요.');
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    }

    // ========================================================================
    // 5. 바텀시트 열기 / 닫기
    // ========================================================================

    /**
     * 특정 위치의 바텀시트를 열고 예보 데이터를 렌더링합니다.
     * @param {string} placeName - 위치명 (예: "거제도")
     */
    function _openBottomSheet(placeName) {
        selectedPlace = placeName;
        selectedDateIdx = 0;

        // 해당 위치의 예보 날짜 목록 추출 (정렬)
        var gubunData = fishingData && fishingData[currentGubun];
        var place = gubunData && gubunData[placeName];
        if (!place || !place.forecasts) return;

        availableDates = Object.keys(place.forecasts).sort();
        if (availableDates.length === 0) return;

        // 위치명 표시
        var placeEl = document.getElementById('fishing-bs-place-name');
        if (placeEl) placeEl.textContent = placeName;

        // 바텀시트 + 오버레이 활성화
        var bs = document.getElementById('fishing-bottomsheet');
        var overlay = document.getElementById('fishing-bottomsheet-overlay');
        if (bs) bs.classList.add('active');
        if (overlay) overlay.classList.add('active');

        // 뒤로가기 버튼으로 바텀시트 닫기 지원 (PopupStack 등록)
        if (window.PopupStack) {
            window.PopupStack.push('fishing-bottomsheet', function () {
                _closeBottomSheet();
            });
        }

        // 콘텐츠 렌더링
        _renderBottomSheetContent();
    }

    /**
     * 바텀시트를 닫고 상태를 초기화합니다.
     */
    function _closeBottomSheet() {
        var bs = document.getElementById('fishing-bottomsheet');
        var overlay = document.getElementById('fishing-bottomsheet-overlay');
        if (bs) bs.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
        selectedPlace = null;
        _removeTooltip();

        // 선택 마커 원래 크기로 복원
        if (selectedFeature) {
            _resetMarkerStyle(selectedFeature);
            selectedFeature = null;
        }

        // 뒤로가기 스택에서 제거
        if (window.PopupStack) {
            window.PopupStack.remove('fishing-bottomsheet');
        }
    }

    // ========================================================================
    // 6. 바텀시트 콘텐츠 렌더링
    // ========================================================================

    /**
     * 선택된 위치 + 날짜에 대한 예보 데이터를 바텀시트에 렌더링합니다.
     * - 날짜 네비게이션 업데이트
     * - 종합 지수 배지
     * - 오전/오후 시간 블록 (기상 요약 + 어종 그리드)
     * - 오전/오후 표시 로직: 오늘 & 12시 이전 → 오전 + "오후 예보 보기" 버튼, 오늘 & 12시 이후 → 오후만
     * - 오늘이 아닌 날짜 → 오전+오후 모두 표시
     */
    function _renderBottomSheetContent() {
        if (!selectedPlace || !fishingData) return;

        var gubunData = fishingData[currentGubun];
        var place = gubunData && gubunData[selectedPlace];
        if (!place) return;

        var dateStr = availableDates[selectedDateIdx];
        var forecast = place.forecasts && place.forecasts[dateStr];

        // --- 날짜 라벨 업데이트 ---
        var dateLabel = document.getElementById('fishing-bs-date-label');
        if (dateLabel) {
            dateLabel.textContent = _formatDateLabel(dateStr);
        }

        // --- 날짜 버튼 활성/비활성 ---
        var prevBtn = document.getElementById('fishing-date-prev');
        var nextBtn = document.getElementById('fishing-date-next');
        if (prevBtn) prevBtn.disabled = selectedDateIdx <= 0;
        if (nextBtn) nextBtn.disabled = selectedDateIdx >= availableDates.length - 1;

        // --- 종합 지수 배지 (갯바위만 표시, 선상은 어종 데이터 미사용) ---
        var totalIdxEl = document.getElementById('fishing-bs-total-index');
        if (totalIdxEl) {
            if (currentGubun === '갯바위') {
                var timeSlot = _getDisplayTimeSlot(dateStr);
                var slotData = forecast && (forecast[timeSlot] || forecast['오전'] || forecast['오후'] || forecast['일']);
                var totalIdx = slotData ? slotData.totalIndex || '' : '';
                if (totalIdx) {
                    totalIdxEl.innerHTML = '<span class="fishing-index-badge level-' + totalIdx + '">' + totalIdx + '</span>';
                } else {
                    totalIdxEl.innerHTML = '';
                }
            } else {
                // 선상: 종합지수 미표시
                totalIdxEl.innerHTML = '';
            }
        }

        // --- 콘텐츠 영역 렌더링 ---
        var contentEl = document.getElementById('fishing-bs-content');
        if (!contentEl) return;

        if (!forecast) {
            contentEl.innerHTML = '<p style="color:#888;text-align:center;padding:20px;">해당 날짜의 예보 데이터가 없습니다.</p>';
            return;
        }

        var html = '';
        var isToday = dateStr === _getTodayStr();
        var now = new Date();
        var isBeforeNoon = now.getHours() < 12;

        if (isToday) {
            if (forecast['일']) {
                // 오늘이지만 '일'(종일) 슬롯만 있는 경우 (API 예외 상황 대비)
                html += _buildTimeBlock('종일', forecast['일'], place);
            } else if (isBeforeNoon) {
                // 오늘 오전: 오전 데이터 표시 + "오후 예보 보기" 버튼
                if (forecast['오전']) {
                    html += _buildTimeBlock('오전', forecast['오전'], place);
                }
                if (forecast['오후']) {
                    html += '<div id="fishing-pm-block" style="display:none;">';
                    html += _buildTimeBlock('오후', forecast['오후'], place);
                    html += '</div>';
                    html += '<button class="fishing-more-btn" id="fishing-toggle-pm-btn">';
                    html += '<i class="fa-solid fa-chevron-down"></i> 오후 예보 보기';
                    html += '</button>';
                }
            } else {
                // 오늘 오후: 오후 데이터만 표시
                if (forecast['오후']) {
                    html += _buildTimeBlock('오후', forecast['오후'], place);
                } else if (forecast['오전']) {
                    // 오후 데이터 없으면 오전 표시
                    html += _buildTimeBlock('오전', forecast['오전'], place);
                }
            }
        } else {
            // 다른 날짜: 오전 + 오후 모두 표시, 또는 종일('일') 표시
            if (forecast['오전']) {
                html += _buildTimeBlock('오전', forecast['오전'], place);
            }
            if (forecast['오후']) {
                html += _buildTimeBlock('오후', forecast['오후'], place);
            }
            // API가 4일차 이후 '일'(종일) 슬롯으로 반환하는 경우
            if (forecast['일']) {
                html += _buildTimeBlock('종일', forecast['일'], place);
            }
        }

        contentEl.innerHTML = html;

        // "오후 예보 보기" 버튼 토글 이벤트
        var toggleBtn = document.getElementById('fishing-toggle-pm-btn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', function () {
                var pmBlock = document.getElementById('fishing-pm-block');
                if (!pmBlock) return;
                var isHidden = pmBlock.style.display === 'none';
                pmBlock.style.display = isHidden ? 'block' : 'none';
                this.innerHTML = isHidden
                    ? '<i class="fa-solid fa-chevron-up"></i> 오후 예보 접기'
                    : '<i class="fa-solid fa-chevron-down"></i> 오후 예보 보기';
            });
        }

        // 조석상세 버튼 클릭 이벤트 바인딩 (물때 옆 버튼 → 조석 현황 모달 호출)
        contentEl.querySelectorAll('.fishing-tide-detail-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var lat = parseFloat(btn.getAttribute('data-lat'));
                var lon = parseFloat(btn.getAttribute('data-lon'));
                if (window.showTideDetailForLocation && lat && lon) {
                    window.showTideDetailForLocation(lat, lon, selectedPlace || '');
                }
            });
        });

        // 기타어종 ? 버튼 이벤트 바인딩
        _bindEtcFishTooltips(place.etcFishList);
    }

    /**
     * 시간 블록(오전/오후) HTML을 생성합니다.
     * @param {string} timeLabel - '오전' 또는 '오후'
     * @param {Object} slotData - 해당 시간대의 예보 데이터
     * @param {Object} place - 위치 전체 데이터 (etcFishList 참조용)
     * @returns {string} HTML 문자열
     */
    function _buildTimeBlock(timeLabel, slotData, place) {
        var html = '<div class="fishing-time-block">';
        var isShip = currentGubun === '선상';

        // 오전/오후 배지 (우측 지수 배지 제거)
        html += '<span class="fishing-time-badge">' + timeLabel + '</span>';

        // 기상 요약 → 2열 테이블
        html += '<div class="fishing-weather-table">';
        if (slotData.minWvhgt || slotData.maxWvhgt) {
            html += '<span><i class="fa-solid fa-water"></i> 파고 ' + _rangeStr(slotData.minWvhgt, slotData.maxWvhgt, 'm') + '</span>';
        }
        if (slotData.minWtem || slotData.maxWtem) {
            html += '<span><i class="fa-solid fa-temperature-half"></i> 수온 ' + _rangeStr(slotData.minWtem, slotData.maxWtem, '°C') + '</span>';
        }
        if (slotData.minWspd || slotData.maxWspd) {
            html += '<span><i class="fa-solid fa-wind"></i> 풍속 ' + _rangeStr(slotData.minWspd, slotData.maxWspd, 'm/s') + '</span>';
        }
        if (slotData.minCrsp || slotData.maxCrsp) {
            html += '<span><i class="fa-solid fa-arrows-spin"></i> 유속 ' + _rangeStr(slotData.minCrsp, slotData.maxCrsp, 'kn') + '</span>';
        }
        if (slotData.minArtmp || slotData.maxArtmp) {
            html += '<span><i class="fa-solid fa-thermometer-half"></i> 기온 ' + _rangeStr(slotData.minArtmp, slotData.maxArtmp, '°C') + '</span>';
        }
        if (slotData.tdlvHrCn) {
            html += '<span><i class="fa-solid fa-clock"></i> ' + slotData.tdlvHrCn;
            // 조석상세 버튼 (물때 옆에 배치, 클릭 시 조석 현황 모달 호출)
            if (place && place.lat && place.lot) {
                html += ' <button class="fishing-tide-detail-btn" data-lat="' + place.lat + '" data-lon="' + place.lot + '">조석상세</button>';
            }
            html += '</span>';
        }
        html += '</div>';

        // 어종별 그리드 (갯바위만 - 선상은 어종 데이터 미사용)
        // 기타어종을 맨 마지막으로 정렬
        if (!isShip && slotData.items && slotData.items.length > 0) {
            var sorted = slotData.items.slice().sort(function (a, b) {
                var aEtc = a.fishName === '기타어종' ? 1 : 0;
                var bEtc = b.fishName === '기타어종' ? 1 : 0;
                return aEtc - bEtc;
            });
            html += '<div class="fishing-species-grid">';
            sorted.forEach(function (item) {
                var levelClass = item.totalIndex ? 'level-' + item.totalIndex : '';
                var isEtc = item.fishName === '기타어종';
                html += '<div class="fishing-species-card">';
                html += '<div class="fishing-species-name">';
                html += _escapeHtml(item.fishName);
                if (isEtc) {
                    html += ' <button class="fishing-etc-info-btn" data-etc="true" title="기타어종 목록 보기">?</button>';
                }
                html += '</div>';
                if (item.totalIndex) {
                    html += '<span class="fishing-species-index ' + levelClass + '">' + item.totalIndex + '</span>';
                }
                html += '</div>';
            });
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    // ========================================================================
    // 7. 기타어종 툴팁
    // ========================================================================

    /**
     * 기타어종 ? 버튼에 클릭 이벤트를 바인딩합니다.
     * 클릭 시 해당 버튼 위에 어종 목록 말풍선을 표시합니다.
     * @param {string} etcFishList - 쉼표로 구분된 기타어종 문자열
     */
    function _bindEtcFishTooltips(etcFishList) {
        if (!etcFishList) return;

        document.querySelectorAll('.fishing-etc-info-btn[data-etc]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                _removeTooltip();

                // 툴팁 엘리먼트 생성
                var tooltip = document.createElement('div');
                tooltip.className = 'fishing-etc-tooltip';
                tooltip.innerHTML = '<div class="fishing-etc-tooltip-title">기타어종</div>' +
                    '<div>' + _escapeHtml(etcFishList).replace(/,/g, ', ') + '</div>';

                document.body.appendChild(tooltip);
                activeTooltip = tooltip;

                // 뒤로가기 버튼으로 툴팁 닫기 지원
                if (window.PopupStack) {
                    window.PopupStack.push('fishing-etc-tooltip', function () {
                        _removeTooltip();
                    });
                }

                // 위치 계산 (버튼 위에 표시)
                var rect = btn.getBoundingClientRect();
                tooltip.style.left = Math.max(10, rect.left + rect.width / 2 - tooltip.offsetWidth / 2) + 'px';
                tooltip.style.top = (rect.top - tooltip.offsetHeight - 8 + window.scrollY) + 'px';

                // 화면 밖 방지
                var tooltipRect = tooltip.getBoundingClientRect();
                if (tooltipRect.right > window.innerWidth - 10) {
                    tooltip.style.left = (window.innerWidth - tooltip.offsetWidth - 10) + 'px';
                }
                if (tooltipRect.top < 0) {
                    tooltip.style.top = (rect.bottom + 8 + window.scrollY) + 'px';
                }

                // 다른 곳 클릭 시 닫기
                setTimeout(function () {
                    document.addEventListener('click', _removeTooltip, { once: true });
                }, 10);
            });
        });
    }

    /**
     * 현재 표시 중인 기타어종 툴팁을 제거합니다.
     */
    function _removeTooltip() {
        if (activeTooltip && activeTooltip.parentNode) {
            activeTooltip.parentNode.removeChild(activeTooltip);
        }
        activeTooltip = null;

        // 뒤로가기 스택에서 제거
        if (window.PopupStack) {
            window.PopupStack.remove('fishing-etc-tooltip');
        }
    }

    // ========================================================================
    // 8. 유틸리티 함수
    // ========================================================================

    /**
     * 오늘 날짜를 YYYYMMDD 형식으로 반환합니다.
     * @returns {string} 예: "20260331"
     */
    function _getTodayStr() {
        var now = new Date();
        var yyyy = now.getFullYear();
        var mm = String(now.getMonth() + 1).padStart(2, '0');
        var dd = String(now.getDate()).padStart(2, '0');
        return yyyy + mm + dd;
    }

    /**
     * 현재 시간대를 반환합니다 (12시 기준 오전/오후 구분).
     * @returns {string} '오전' 또는 '오후'
     */
    function _getCurrentTimeSlot() {
        return new Date().getHours() < 12 ? '오전' : '오후';
    }

    /**
     * 바텀시트에서 표시할 시간대를 결정합니다.
     * 오늘이면 현재 시간 기준, 다른 날짜면 오전 우선.
     * @param {string} dateStr - YYYYMMDD 형식 날짜
     * @returns {string} '오전' 또는 '오후'
     */
    function _getDisplayTimeSlot(dateStr) {
        if (dateStr === _getTodayStr()) {
            return _getCurrentTimeSlot();
        }
        return '오전';
    }

    /**
     * YYYYMMDD 날짜를 읽기 좋은 형식으로 변환합니다.
     * @param {string} dateStr - "20260331"
     * @returns {string} "03월 31일 (화)" 형식
     */
    function _formatDateLabel(dateStr) {
        if (!dateStr || dateStr.length !== 8) return dateStr || '-';
        var y = parseInt(dateStr.substring(0, 4));
        var m = parseInt(dateStr.substring(4, 6)) - 1;
        var d = parseInt(dateStr.substring(6, 8));
        var date = new Date(y, m, d);
        var days = ['일', '월', '화', '수', '목', '금', '토'];
        var dayName = days[date.getDay()];

        var todayStr = _getTodayStr();
        var prefix = '';
        if (dateStr === todayStr) prefix = '오늘 ';

        return prefix + String(m + 1).padStart(2, '0') + '월 ' + String(d).padStart(2, '0') + '일 (' + dayName + ')';
    }

    /**
     * 최소~최대 범위 문자열을 생성합니다.
     * @param {string} min - 최솟값
     * @param {string} max - 최댓값
     * @param {string} unit - 단위 (예: 'm', '°C')
     * @returns {string} "0.5~1.2m" 또는 "1.0m" (동일한 경우)
     */
    function _rangeStr(min, max, unit) {
        if (!min && !max) return '';
        if (min === max || !max) return (min || '') + unit;
        if (!min) return (max || '') + unit;
        return min + '~' + max + unit;
    }

    /**
     * HTML 특수문자를 이스케이프합니다 (XSS 방지).
     * @param {string} str - 원본 문자열
     * @returns {string} 이스케이프된 문자열
     */
    function _escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

})();
