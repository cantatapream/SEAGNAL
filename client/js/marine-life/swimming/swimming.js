/**
 * ============================================================================
 * 파일명: client/js/marine-life/swimming/swimming.js
 * 역할  : 해수욕 지수 프론트엔드 전체 로직 (스킨스쿠버와 동일한 지도형)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : 없음 (독립 모듈, OpenLayers 전역 ol.* 사용)
 *  - 서버 API      : GET /api/swimming-index (routes/fishing.js)
 *  - 마크업        : index2.html #swimming-section 내 #swim-* ID들, .fishing-* 스타일 재사용
 *  - 나를 쓰는 곳  : js/forecast/alerts/marine.js → _onSectionActivated('swimming-section') 시 initSwimmingMap() 호출
 * [로드 순서] scuba.js 다음 · life_safety.js 이전 (marine-life 그룹)
 *
 * [설명]
 * 데이터 구조가 스킨스쿠버와 동일(지점 → 날짜 → 오전/오후/일 슬롯)하므로,
 * 스킨스쿠버(scuba.js)와 같은 지도형(마커+바텀시트) UI를 그대로 사용하되
 * 시각 스타일은 .fishing-* CSS 클래스를 재사용합니다.
 * - OpenLayers 지도 초기화 (OSM 타일 + 발광형 동심원 마커)
 * - GPS 기반 내 위치 이동
 * - 마커 클릭 시 바텀시트 (종합지수, 날짜 네비게이션, 오전/오후 기상요약 + 개장상태)
 *
 * [스킨스쿠버와의 차이]
 * - 기상요약: 파고 / 수온 / 기온 / 풍속 (유속·물때 없음)
 * - 개장상태(opnStat: 개장/폐장) 배지 추가
 *
 * [데이터 구조] (서버 응답)
 * {
 *   updatedAt: "2026.06.07 09:10",
 *   places: { "대천해수욕장": { lat, lot, forecasts: { "20260607": { "오전": {...}, "오후": {...} } } } }
 * }
 * ============================================================================
 */

(function () {
    'use strict';

    // ========================================================================
    // 상수 및 상태 변수
    // ========================================================================

    /** 지수 등급별 색상 맵 (발광형 동심원 마커 + 배지에 사용) — 스킨스쿠버와 동일 5단계 */
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
    let swimMap = null;             // OpenLayers Map 인스턴스
    let markerLayer = null;         // 마커 벡터 레이어
    let myLocationLayer = null;     // 내 위치 파란 원 마커 레이어
    let swimData = null;            // 서버에서 받은 전체 데이터
    let selectedPlace = null;       // 바텀시트에 표시 중인 위치명
    let selectedDateIdx = 0;        // 바텀시트 날짜 인덱스 (0 = 오늘)
    let availableDates = [];        // 사용 가능한 날짜 목록 (YYYYMMDD)
    let selectedFeature = null;     // 현재 선택된 마커 피처 (시각적 피드백용)

    // ========================================================================
    // 1. 지도 초기화
    // ========================================================================

    /**
     * OpenLayers 지도를 초기화하고 마커 레이어를 추가합니다.
     * swimming-section 탭이 활성화될 때 한 번만 호출됩니다.
     * 이미 초기화된 경우 지도 크기만 갱신합니다.
     */
    window.initSwimmingMap = function () {
        if (swimMap) {
            swimMap.updateSize();
            return;
        }

        const vectorSource = new ol.source.Vector();
        markerLayer = new ol.layer.Vector({
            source: vectorSource,
            renderOrder: function (a, b) {
                const pa = LEVEL_PRIORITY[a.get('level')] || 0;
                const pb = LEVEL_PRIORITY[b.get('level')] || 0;
                return pa - pb;
            }
        });

        swimMap = new ol.Map({
            target: 'swim-map',
            layers: [
                new ol.layer.Tile({ source: new ol.source.OSM() }),
                markerLayer
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

        // 마커 클릭 이벤트: 선택 피드백 + 바텀시트 표시
        swimMap.on('singleclick', function (evt) {
            const feature = swimMap.forEachFeatureAtPixel(evt.pixel, function (f) { return f; });
            if (feature && feature.get('placeName')) {
                _selectMarker(feature);
                // [사용량] 해수욕 지점 클릭
                if (window.trackUsage) window.trackUsage('life.swimming.point');
                _openBottomSheet(feature.get('placeName'));
            }
        });

        // 마커 위에서 커서 변경
        swimMap.on('pointermove', function (evt) {
            const hit = swimMap.forEachFeatureAtPixel(evt.pixel, function () { return true; });
            swimMap.getTargetElement().style.cursor = hit ? 'pointer' : '';
        });

        _addLegendControl(swimMap);
        _loadSwimData();
        _bindEvents();
    };

    /**
     * [외부 API] 이 탭의 OpenLayers 지도 인스턴스를 돌려줍니다 (없으면 null).
     * 예: window.getSwimmingMap() → ol.Map
     * @returns {ol.Map|null}
     * [연계] ← js/marine-life/safety/life_safety.js — 배경지도 레이어 추가·위치 이어받기
     */
    window.getSwimmingMap = function () { return swimMap; };

    // ========================================================================
    // 1-1. 지도 내부 커스텀 컨트롤 (범례)
    // ========================================================================

    function _addLegendControl(map) {
        var legendEl = document.createElement('div');
        legendEl.className = 'fishing-legend';

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

        legendEl.style.position = 'absolute';
        legendEl.style.bottom = '8px';
        legendEl.style.left = '8px';
        map.addControl(new ol.control.Control({ element: legendEl }));
    }

    /**
     * 유의사항 팝업을 엽니다 (지도 위 ❗ 버튼).
     * 숨김 DOM(#swim-disclaimer) 의 HTML 을 읽어 showSeagnalModal 로 표시.
     */
    function _openNoticePopup() {
        var src = document.getElementById('swim-disclaimer');
        var msgHtml = src ? src.innerHTML : '';
        if (typeof window.showSeagnalModal === 'function') {
            window.showSeagnalModal('유의사항', msgHtml, 'info');
        }
    }

    // ========================================================================
    // 1-2. 마커 선택 시각적 피드백
    // ========================================================================

    function _selectMarker(feature) {
        if (selectedFeature && selectedFeature !== feature) {
            _resetMarkerStyle(selectedFeature);
        }
        selectedFeature = feature;

        var placeName = feature.get('placeName');
        var level = feature.get('level') || '보통';
        var colors = LEVEL_COLORS[level] || LEVEL_COLORS['보통'];

        var size = 22;
        var canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        var ctx = canvas.getContext('2d');
        var cx = size / 2, cy = size / 2, r = size / 2 - 1;

        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 2 * Math.PI);
        ctx.fillStyle = colors.glow.replace('0.5)', '0.8)');
        ctx.fill();

        var grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r - 1);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.3, colors.inner);
        grad.addColorStop(1, colors.outer);
        ctx.beginPath();
        ctx.arc(cx, cy, r - 1, 0, 2 * Math.PI);
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(cx, cy, r - 1, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        feature.setStyle(new ol.style.Style({
            image: new ol.style.Icon({ img: canvas, imgSize: [size, size], anchor: [0.5, 0.5] }),
            text: new ol.style.Text({
                text: placeName,
                font: 'bold 12px "Noto Sans KR", sans-serif',
                offsetY: 18,
                fill: new ol.style.Fill({ color: '#ffffff' }),
                stroke: new ol.style.Stroke({ color: '#000000', width: 3 })
            })
        }));
    }

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
            image: new ol.style.Icon({ img: canvas, imgSize: [size, size], anchor: [0.5, 0.5] }),
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

    async function _loadSwimData() {
        try {
            const res = await fetch((window.CONFIG ? CONFIG.API_BASE : '') + '/api/swimming-index');
            if (!res.ok) throw new Error('데이터 없음');
            swimData = await res.json();

            const pubEl = document.getElementById('swim-publish-time');
            if (pubEl && swimData.updatedAt) {
                pubEl.textContent = '발표: ' + swimData.updatedAt;
            }

            _renderMarkers();
        } catch (e) {
            console.warn('🏖️ 해수욕 데이터 로드 실패:', e.message);
        }
    }

    /**
     * 모든 해수욕장 마커를 지도에 렌더링합니다.
     * 각 위치에 대해 오늘 날짜의 현재 시간대(오전/오후/일) 종합 지수로 색상을 결정합니다.
     */
    function _renderMarkers() {
        if (!swimData || !markerLayer) return;

        const source = markerLayer.getSource();
        source.clear();

        const places = swimData.places;
        if (!places) return;

        const todayStr = _getTodayStr();
        const timeSlot = _getCurrentTimeSlot();

        Object.keys(places).forEach(function (placeName) {
            const place = places[placeName];
            if (!place.lat || !place.lot) return;

            let level = '';
            const todayForecast = place.forecasts && place.forecasts[todayStr];
            if (todayForecast) {
                const slotData = todayForecast[timeSlot] || todayForecast['오전'] || todayForecast['오후'] || todayForecast['일'];
                if (slotData) level = slotData.totalIndex || '';
            }
            if (!level) level = '보통';

            const colors = LEVEL_COLORS[level] || LEVEL_COLORS['보통'];

            const canvas = document.createElement('canvas');
            const size = 14;
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            const cx = size / 2, cy = size / 2, r = size / 2 - 1;

            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, 2 * Math.PI);
            ctx.fillStyle = colors.glow;
            ctx.fill();

            const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r - 1);
            grad.addColorStop(0, colors.inner);
            grad.addColorStop(1, colors.outer);
            ctx.beginPath();
            ctx.arc(cx, cy, r - 1, 0, 2 * Math.PI);
            ctx.fillStyle = grad;
            ctx.fill();

            const feature = new ol.Feature({
                geometry: new ol.geom.Point(ol.proj.fromLonLat([place.lot, place.lat])),
                placeName: placeName,
                level: level
            });

            feature.setStyle(new ol.style.Style({
                image: new ol.style.Icon({ img: canvas, imgSize: [size, size], anchor: [0.5, 0.5] }),
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

    function _bindEvents() {
        var gpsBtn = document.getElementById('swim-my-location-btn');
        if (gpsBtn) gpsBtn.addEventListener('click', function () { _moveToMyLocation(); });

        var noticeBtn = document.getElementById('swim-notice-btn');
        if (noticeBtn) noticeBtn.addEventListener('click', function () { _openNoticePopup(); });

        var closeBtn = document.getElementById('swim-bs-close');
        if (closeBtn) closeBtn.addEventListener('click', function () { _closeBottomSheet(); });

        var overlay = document.getElementById('swim-bottomsheet-overlay');
        if (overlay) overlay.addEventListener('click', function () { _closeBottomSheet(); });

        var prevBtn = document.getElementById('swim-date-prev');
        var nextBtn = document.getElementById('swim-date-next');
        if (prevBtn) {
            prevBtn.addEventListener('click', function () {
                if (selectedDateIdx > 0) { selectedDateIdx--; _renderBottomSheetContent(); }
            });
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', function () {
                if (selectedDateIdx < availableDates.length - 1) { selectedDateIdx++; _renderBottomSheetContent(); }
            });
        }
    }

    // ========================================================================
    // 4. GPS 내 위치 이동
    // ========================================================================

    function _moveToMyLocation() {
        if (!navigator.geolocation) {
            alert('이 기기에서는 위치 서비스를 사용할 수 없습니다.');
            return;
        }

        var gpsBtn = document.getElementById('swim-my-location-btn');
        if (gpsBtn) gpsBtn.classList.add('loading');

        navigator.geolocation.getCurrentPosition(
            function (pos) {
                if (gpsBtn) gpsBtn.classList.remove('loading');
                var coord = ol.proj.fromLonLat([pos.coords.longitude, pos.coords.latitude]);

                swimMap.getView().animate({ center: coord, zoom: 10, duration: 600 });

                if (!myLocationLayer) {
                    myLocationLayer = new ol.layer.Vector({
                        source: new ol.source.Vector(),
                        zIndex: 1000,
                        style: function () {
                            return [
                                new ol.style.Style({ image: new ol.style.Circle({ radius: 15, fill: new ol.style.Fill({ color: 'rgba(0, 123, 255, 0.15)' }) }) }),
                                new ol.style.Style({ image: new ol.style.Circle({ radius: 12, fill: new ol.style.Fill({ color: 'rgba(0, 123, 255, 0.25)' }) }) }),
                                new ol.style.Style({ image: new ol.style.Circle({ radius: 9, fill: new ol.style.Fill({ color: '#ffffff' }), stroke: new ol.style.Stroke({ color: 'rgba(0, 0, 0, 0.05)', width: 1 }) }) }),
                                new ol.style.Style({ image: new ol.style.Circle({ radius: 6, fill: new ol.style.Fill({ color: '#007bff' }) }) })
                            ];
                        }
                    });
                    swimMap.addLayer(myLocationLayer);
                }

                var source = myLocationLayer.getSource();
                source.clear();
                source.addFeature(new ol.Feature({ geometry: new ol.geom.Point(coord) }));
            },
            function (err) {
                if (gpsBtn) gpsBtn.classList.remove('loading');
                console.warn('🏖️ GPS 오류:', err.message);
                alert('위치를 가져올 수 없습니다.\n위치 권한을 확인해 주세요.');
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    }

    // ========================================================================
    // 5. 바텀시트 열기 / 닫기
    // ========================================================================

    function _openBottomSheet(placeName) {
        selectedPlace = placeName;
        selectedDateIdx = 0;

        var place = swimData && swimData.places && swimData.places[placeName];
        if (!place || !place.forecasts) return;

        availableDates = Object.keys(place.forecasts).sort();
        if (availableDates.length === 0) return;

        var placeEl = document.getElementById('swim-bs-place-name');
        if (placeEl) placeEl.textContent = placeName;

        var bs = document.getElementById('swim-bottomsheet');
        var overlay = document.getElementById('swim-bottomsheet-overlay');
        if (bs) bs.classList.add('active');
        if (overlay) overlay.classList.add('active');

        if (window.PopupStack) {
            window.PopupStack.push('swim-bottomsheet', function () { _closeBottomSheet(); });
        }

        _renderBottomSheetContent();
    }

    function _closeBottomSheet() {
        var bs = document.getElementById('swim-bottomsheet');
        var overlay = document.getElementById('swim-bottomsheet-overlay');
        if (bs) bs.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
        selectedPlace = null;

        if (selectedFeature) {
            _resetMarkerStyle(selectedFeature);
            selectedFeature = null;
        }

        if (window.PopupStack) window.PopupStack.remove('swim-bottomsheet');
    }

    // ========================================================================
    // 6. 바텀시트 콘텐츠 렌더링
    // ========================================================================

    function _renderBottomSheetContent() {
        if (!selectedPlace || !swimData) return;

        var place = swimData.places && swimData.places[selectedPlace];
        if (!place) return;

        var dateStr = availableDates[selectedDateIdx];
        var forecast = place.forecasts && place.forecasts[dateStr];

        var dateLabel = document.getElementById('swim-bs-date-label');
        if (dateLabel) dateLabel.textContent = _formatDateLabel(dateStr);

        var prevBtn = document.getElementById('swim-date-prev');
        var nextBtn = document.getElementById('swim-date-next');
        if (prevBtn) prevBtn.disabled = selectedDateIdx <= 0;
        if (nextBtn) nextBtn.disabled = selectedDateIdx >= availableDates.length - 1;

        // 종합 지수 배지 (현재 시간대 우선)
        var totalIdxEl = document.getElementById('swim-bs-total-index');
        if (totalIdxEl) {
            var timeSlot = _getDisplayTimeSlot(dateStr);
            var slotData = forecast && (forecast[timeSlot] || forecast['오전'] || forecast['오후'] || forecast['일']);
            var totalIdx = slotData ? slotData.totalIndex || '' : '';
            totalIdxEl.innerHTML = totalIdx
                ? '<span class="fishing-index-badge level-' + totalIdx + '">' + totalIdx + '</span>'
                : '';
        }

        var contentEl = document.getElementById('swim-bs-content');
        if (!contentEl) return;

        if (!forecast) {
            contentEl.innerHTML = '<p style="color:#888;text-align:center;padding:20px;">해당 날짜의 예보 데이터가 없습니다.</p>';
            return;
        }

        var html = '';
        if (forecast['오전']) html += _buildTimeBlock('오전', forecast['오전']);
        if (forecast['오후']) html += _buildTimeBlock('오후', forecast['오후']);
        if (forecast['일'])   html += _buildTimeBlock('종일', forecast['일']);

        contentEl.innerHTML = html;
    }

    /**
     * 시간 블록(오전/오후/종일) HTML을 생성합니다.
     * 해수욕은 단일 카테고리이므로 시간대 배지 옆에 종합지수 + 개장상태 배지를 함께 표시.
     */
    function _buildTimeBlock(timeLabel, slotData) {
        var html = '<div class="fishing-time-block">';

        // 시간대 배지 + 종합지수 배지 + 개장상태 배지 (우측)
        html += '<div class="fishing-time-header">';
        html += '<span class="fishing-time-badge">' + timeLabel + '</span>';
        if (slotData.totalIndex) {
            html += '<span class="fishing-index-badge level-' + slotData.totalIndex + '">' + slotData.totalIndex + '</span>';
        }
        if (slotData.opnStat) {
            var closed = slotData.opnStat !== '개장';
            html += '<span class="fishing-index-badge" style="background:' + (closed ? '#616161' : '#2E7D32') + ';color:#fff;">' + _escapeHtml(slotData.opnStat) + '</span>';
        }
        html += '</div>';

        // 기상 요약 → 파고 / 수온 / 기온 / 풍속
        html += '<div class="fishing-weather-table">';
        if (slotData.maxWvhgt) {
            html += '<span><i class="fa-solid fa-water"></i> 파고 ' + slotData.maxWvhgt + 'm</span>';
        }
        if (slotData.avgWtem) {
            html += '<span><i class="fa-solid fa-temperature-half"></i> 수온 ' + slotData.avgWtem + '°C</span>';
        }
        if (slotData.avgArtmp) {
            html += '<span><i class="fa-solid fa-sun"></i> 기온 ' + slotData.avgArtmp + '°C</span>';
        }
        if (slotData.maxWspd) {
            html += '<span><i class="fa-solid fa-wind"></i> 풍속 ' + slotData.maxWspd + 'm/s</span>';
        }
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ========================================================================
    // 7. 유틸리티 함수
    // ========================================================================

    function _getTodayStr() {
        var now = new Date();
        var yyyy = now.getFullYear();
        var mm = String(now.getMonth() + 1).padStart(2, '0');
        var dd = String(now.getDate()).padStart(2, '0');
        return yyyy + mm + dd;
    }

    function _getCurrentTimeSlot() {
        return new Date().getHours() < 12 ? '오전' : '오후';
    }

    function _getDisplayTimeSlot(dateStr) {
        if (dateStr === _getTodayStr()) return _getCurrentTimeSlot();
        return '오전';
    }

    function _formatDateLabel(dateStr) {
        if (!dateStr || dateStr.length !== 8) return dateStr || '-';
        var y = parseInt(dateStr.substring(0, 4));
        var m = parseInt(dateStr.substring(4, 6)) - 1;
        var d = parseInt(dateStr.substring(6, 8));
        var date = new Date(y, m, d);
        var days = ['일', '월', '화', '수', '목', '금', '토'];
        var dayName = days[date.getDay()];

        var prefix = (dateStr === _getTodayStr()) ? '오늘 ' : '';
        return prefix + String(m + 1).padStart(2, '0') + '월 ' + String(d).padStart(2, '0') + '일 (' + dayName + ')';
    }

    function _escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

})();
