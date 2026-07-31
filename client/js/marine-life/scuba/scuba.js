/**
 * ============================================================================
 * 파일명: js/scuba.js
 * 역할: 스킨스쿠버 지수 프론트엔드 전체 로직
 * ============================================================================
 *
 * [설명]
 * 이 파일은 스킨스쿠버 지수 탭의 모든 프론트엔드 기능을 담당합니다.
 * 데이터 구조가 바다낚시와 동일(지점 → 날짜 → 오전/오후/일 슬롯)하므로,
 * 바다낚시(fishing.js)와 같은 지도형(마커+바텀시트) UI를 그대로 사용하되
 * 시각 스타일은 .fishing-* CSS 클래스를 재사용합니다.
 * - OpenLayers 지도 초기화 (OSM 타일 + 발광형 동심원 마커)
 * - GPS 기반 내 위치 이동
 * - 마커 클릭 시 바텀시트 (종합지수, 날짜 네비게이션, 오전/오후 기상요약)
 *
 * [바다낚시와의 차이]
 * - 갯바위/선상 구분 없음 (단일 카테고리: data.places)
 * - 어종(items) 그리드 없음
 * - 기상요약: 파고 / 수온 / 유속 / 물때 (풍속·기온 없음)
 *
 * [연계 파일]
 * - index2.html → #scuba-section 내 HTML 요소들 (#scuba-* IDs, .fishing-* 스타일)
 * - style.css → .fishing-* 클래스 스타일 (바다낚시와 공유)
 * - routes/fishing.js (서버) → GET /api/scuba-index 데이터 제공
 * - js/marine.js → _onSectionActivated('scuba-section') 시 initScubaMap() 호출
 *
 * [데이터 구조] (서버 응답)
 * {
 *   updatedAt: "2026.06.07 09:10",
 *   places: { "동명항": { lat, lot, forecasts: { "20260607": { "오전": {...}, "오후": {...} } } } }
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
    let scubaMap = null;            // OpenLayers Map 인스턴스
    let markerLayer = null;         // 마커 벡터 레이어
    let myLocationLayer = null;     // 내 위치 파란 원 마커 레이어
    let scubaData = null;           // 서버에서 받은 전체 데이터
    let selectedPlace = null;       // 바텀시트에 표시 중인 위치명
    let selectedDateIdx = 0;        // 바텀시트 날짜 인덱스 (0 = 오늘)
    let availableDates = [];        // 사용 가능한 날짜 목록 (YYYYMMDD)
    let selectedFeature = null;     // 현재 선택된 마커 피처 (시각적 피드백용)

    // ========================================================================
    // 1. 지도 초기화
    // ========================================================================

    /**
     * OpenLayers 지도를 초기화하고 마커 레이어를 추가합니다.
     * scuba-section 탭이 활성화될 때 한 번만 호출됩니다.
     * 이미 초기화된 경우 지도 크기만 갱신합니다.
     */
    window.initScubaMap = function () {
        if (scubaMap) {
            scubaMap.updateSize();
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

        scubaMap = new ol.Map({
            target: 'scuba-map',
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
        scubaMap.on('singleclick', function (evt) {
            const feature = scubaMap.forEachFeatureAtPixel(evt.pixel, function (f) { return f; });
            if (feature && feature.get('placeName')) {
                _selectMarker(feature);
                // [사용량] 스킨스쿠버 지점 클릭
                if (window.trackUsage) window.trackUsage('life.scuba.point');
                _openBottomSheet(feature.get('placeName'));
            }
        });

        // 마커 위에서 커서 변경
        scubaMap.on('pointermove', function (evt) {
            const hit = scubaMap.forEachFeatureAtPixel(evt.pixel, function () { return true; });
            scubaMap.getTargetElement().style.cursor = hit ? 'pointer' : '';
        });

        _addLegendControl(scubaMap);
        _addGuideControl(scubaMap);
        _loadScubaData();
        _bindEvents();
    };

    /**
     * [외부 API] 이 탭의 OpenLayers 지도 인스턴스를 돌려줍니다 (없으면 null).
     * 예: window.getScubaMap() → ol.Map
     * @returns {ol.Map|null}
     * [연계] ← js/marine-life/safety/life_safety.js — 배경지도 레이어 추가·위치 이어받기
     */
    window.getScubaMap = function () { return scubaMap; };

    // ========================================================================
    // 1-1. 지도 내부 커스텀 컨트롤 (범례, 안내 버튼)
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

    function _addGuideControl(map) {
        var btn = document.createElement('button');
        btn.className = 'fishing-guide-btn';
        btn.innerHTML = '<i class="fa-solid fa-circle-question"></i> <span>스킨스쿠버지수란?</span>';
        btn.style.position = 'absolute';
        btn.style.bottom = '8px';
        btn.style.right = '8px';
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            _openGuidePopup();
        });
        map.addControl(new ol.control.Control({ element: btn }));
    }

    /**
     * 유의사항 팝업을 엽니다 (지도 위 ❗ 버튼).
     * 숨김 DOM(#scuba-disclaimer) 의 HTML 을 읽어 showSeagnalModal 로 표시.
     */
    function _openNoticePopup() {
        var src = document.getElementById('scuba-disclaimer');
        var msgHtml = src ? src.innerHTML : '';
        if (typeof window.showSeagnalModal === 'function') {
            window.showSeagnalModal('유의사항', msgHtml, 'info');
        }
    }

    /**
     * 지수 안내 이미지 팝업을 엽니다. (로딩 스피너 포함)
     */
    function _openGuidePopup() {
        _closeGuidePopup();

        var imgSrc = '/images/scuba_guide.png';
        var title = '스킨스쿠버지수란?';

        var overlay = document.createElement('div');
        overlay.className = 'fishing-guide-overlay';
        overlay.id = 'scuba-guide-overlay';
        overlay.addEventListener('click', function () { _closeGuidePopup(); });

        var popup = document.createElement('div');
        popup.className = 'fishing-guide-popup';
        popup.id = 'scuba-guide-popup';
        popup.addEventListener('click', function (e) { e.stopPropagation(); });

        var header = document.createElement('div');
        header.className = 'fishing-guide-popup-header';
        header.innerHTML = '<span>' + title + '</span>' +
            '<button class="fishing-guide-popup-close" id="scuba-guide-close"><i class="fa-solid fa-xmark"></i></button>';

        var body = document.createElement('div');
        body.className = 'fishing-guide-popup-body';

        var spinner = document.createElement('div');
        spinner.className = 'guide-popup-spinner';
        spinner.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        body.appendChild(spinner);

        var img = document.createElement('img');
        img.src = imgSrc;
        img.alt = title;
        img.style.width = '100%';
        img.style.display = 'none';
        img.onload = function () {
            spinner.style.display = 'none';
            img.style.display = 'block';
        };
        img.onerror = function () {
            spinner.innerHTML = '<span style="color:#ef4444;font-size:0.8rem;">이미지를 불러올 수 없습니다.</span>';
        };
        body.appendChild(img);

        popup.appendChild(header);
        popup.appendChild(body);
        document.body.appendChild(overlay);
        document.body.appendChild(popup);

        document.getElementById('scuba-guide-close').addEventListener('click', function () {
            _closeGuidePopup();
        });

        if (window.PopupStack) {
            window.PopupStack.push('scuba-guide-popup', function () { _closeGuidePopup(); });
        }
    }

    function _closeGuidePopup() {
        var overlay = document.getElementById('scuba-guide-overlay');
        var popup = document.getElementById('scuba-guide-popup');
        if (popup) {
            var img = popup.querySelector('img');
            if (img) { img.onload = null; img.onerror = null; }
            popup.remove();
        }
        if (overlay) overlay.remove();
        if (window.PopupStack) window.PopupStack.remove('scuba-guide-popup');
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

    async function _loadScubaData() {
        try {
            const res = await fetch((window.CONFIG ? CONFIG.API_BASE : '') + '/api/scuba-index');
            if (!res.ok) throw new Error('데이터 없음');
            scubaData = await res.json();

            const pubEl = document.getElementById('scuba-publish-time');
            if (pubEl && scubaData.updatedAt) {
                pubEl.textContent = '발표: ' + scubaData.updatedAt;
            }

            _renderMarkers();
        } catch (e) {
            console.warn('🤿 스킨스쿠버 데이터 로드 실패:', e.message);
        }
    }

    /**
     * 모든 체험장 마커를 지도에 렌더링합니다.
     * 각 위치에 대해 오늘 날짜의 현재 시간대(오전/오후/일) 종합 지수로 색상을 결정합니다.
     */
    function _renderMarkers() {
        if (!scubaData || !markerLayer) return;

        const source = markerLayer.getSource();
        source.clear();

        const places = scubaData.places;
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
        var gpsBtn = document.getElementById('scuba-my-location-btn');
        if (gpsBtn) gpsBtn.addEventListener('click', function () { _moveToMyLocation(); });

        var noticeBtn = document.getElementById('scuba-notice-btn');
        if (noticeBtn) noticeBtn.addEventListener('click', function () { _openNoticePopup(); });

        var closeBtn = document.getElementById('scuba-bs-close');
        if (closeBtn) closeBtn.addEventListener('click', function () { _closeBottomSheet(); });

        var overlay = document.getElementById('scuba-bottomsheet-overlay');
        if (overlay) overlay.addEventListener('click', function () { _closeBottomSheet(); });

        var prevBtn = document.getElementById('scuba-date-prev');
        var nextBtn = document.getElementById('scuba-date-next');
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

        var gpsBtn = document.getElementById('scuba-my-location-btn');
        if (gpsBtn) gpsBtn.classList.add('loading');

        navigator.geolocation.getCurrentPosition(
            function (pos) {
                if (gpsBtn) gpsBtn.classList.remove('loading');
                var coord = ol.proj.fromLonLat([pos.coords.longitude, pos.coords.latitude]);

                scubaMap.getView().animate({ center: coord, zoom: 10, duration: 600 });

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
                    scubaMap.addLayer(myLocationLayer);
                }

                var source = myLocationLayer.getSource();
                source.clear();
                source.addFeature(new ol.Feature({ geometry: new ol.geom.Point(coord) }));
            },
            function (err) {
                if (gpsBtn) gpsBtn.classList.remove('loading');
                console.warn('🤿 GPS 오류:', err.message);
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

        var place = scubaData && scubaData.places && scubaData.places[placeName];
        if (!place || !place.forecasts) return;

        availableDates = Object.keys(place.forecasts).sort();
        if (availableDates.length === 0) return;

        var placeEl = document.getElementById('scuba-bs-place-name');
        if (placeEl) placeEl.textContent = placeName;

        var bs = document.getElementById('scuba-bottomsheet');
        var overlay = document.getElementById('scuba-bottomsheet-overlay');
        if (bs) bs.classList.add('active');
        if (overlay) overlay.classList.add('active');

        if (window.PopupStack) {
            window.PopupStack.push('scuba-bottomsheet', function () { _closeBottomSheet(); });
        }

        _renderBottomSheetContent();
    }

    function _closeBottomSheet() {
        var bs = document.getElementById('scuba-bottomsheet');
        var overlay = document.getElementById('scuba-bottomsheet-overlay');
        if (bs) bs.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
        selectedPlace = null;

        if (selectedFeature) {
            _resetMarkerStyle(selectedFeature);
            selectedFeature = null;
        }

        if (window.PopupStack) window.PopupStack.remove('scuba-bottomsheet');
    }

    // ========================================================================
    // 6. 바텀시트 콘텐츠 렌더링
    // ========================================================================

    function _renderBottomSheetContent() {
        if (!selectedPlace || !scubaData) return;

        var place = scubaData.places && scubaData.places[selectedPlace];
        if (!place) return;

        var dateStr = availableDates[selectedDateIdx];
        var forecast = place.forecasts && place.forecasts[dateStr];

        var dateLabel = document.getElementById('scuba-bs-date-label');
        if (dateLabel) dateLabel.textContent = _formatDateLabel(dateStr);

        var prevBtn = document.getElementById('scuba-date-prev');
        var nextBtn = document.getElementById('scuba-date-next');
        if (prevBtn) prevBtn.disabled = selectedDateIdx <= 0;
        if (nextBtn) nextBtn.disabled = selectedDateIdx >= availableDates.length - 1;

        // 종합 지수 배지 (현재 시간대 우선)
        var totalIdxEl = document.getElementById('scuba-bs-total-index');
        if (totalIdxEl) {
            var timeSlot = _getDisplayTimeSlot(dateStr);
            var slotData = forecast && (forecast[timeSlot] || forecast['오전'] || forecast['오후'] || forecast['일']);
            var totalIdx = slotData ? slotData.totalIndex || '' : '';
            totalIdxEl.innerHTML = totalIdx
                ? '<span class="fishing-index-badge level-' + totalIdx + '">' + totalIdx + '</span>'
                : '';
        }

        var contentEl = document.getElementById('scuba-bs-content');
        if (!contentEl) return;

        if (!forecast) {
            contentEl.innerHTML = '<p style="color:#888;text-align:center;padding:20px;">해당 날짜의 예보 데이터가 없습니다.</p>';
            return;
        }

        var html = '';
        if (forecast['오전']) html += _buildTimeBlock('오전', forecast['오전'], place);
        if (forecast['오후']) html += _buildTimeBlock('오후', forecast['오후'], place);
        if (forecast['일'])   html += _buildTimeBlock('종일', forecast['일'], place);

        contentEl.innerHTML = html;

        // 조석상세 버튼 클릭 이벤트 바인딩
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
    }

    /**
     * 시간 블록(오전/오후/종일) HTML을 생성합니다.
     * 스킨스쿠버는 단일 카테고리이므로 시간대 배지 옆에 종합지수 배지를 함께 표시.
     */
    function _buildTimeBlock(timeLabel, slotData, place) {
        var html = '<div class="fishing-time-block">';

        // 시간대 배지 + 종합지수 배지 (우측)
        if (slotData.totalIndex) {
            html += '<div class="fishing-time-header">';
            html += '<span class="fishing-time-badge">' + timeLabel + '</span>';
            html += '<span class="fishing-index-badge level-' + slotData.totalIndex + '">' + slotData.totalIndex + '</span>';
            html += '</div>';
        } else {
            html += '<span class="fishing-time-badge">' + timeLabel + '</span>';
        }

        // 기상 요약 → 파고 / 수온 / 유속 / 물때
        html += '<div class="fishing-weather-table">';
        if (slotData.minWvhgt || slotData.maxWvhgt) {
            html += '<span><i class="fa-solid fa-water"></i> 파고 ' + _rangeStr(slotData.minWvhgt, slotData.maxWvhgt, 'm') + '</span>';
        }
        if (slotData.minWtem || slotData.maxWtem) {
            html += '<span><i class="fa-solid fa-temperature-half"></i> 수온 ' + _rangeStr(slotData.minWtem, slotData.maxWtem, '°C') + '</span>';
        }
        if (slotData.minCrsp || slotData.maxCrsp) {
            html += '<span><i class="fa-solid fa-arrows-spin"></i> 유속 ' + _rangeStr(slotData.minCrsp, slotData.maxCrsp, 'kn') + '</span>';
        }
        if (slotData.tdlvHrCn) {
            html += '<span><i class="fa-solid fa-clock"></i> ' + _escapeHtml(slotData.tdlvHrCn);
            if (place && place.lat && place.lot) {
                html += ' <button class="fishing-tide-detail-btn" data-lat="' + place.lat + '" data-lon="' + place.lot + '">조석상세</button>';
            }
            html += '</span>';
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

    function _rangeStr(min, max, unit) {
        if (!min && !max) return '';
        if (min === max || !max) return (min || '') + unit;
        if (!min) return (max || '') + unit;
        return min + '~' + max + unit;
    }

    function _escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

})();
