/**
 * ============================================================================
 * 파일명: js/mudflat.js
 * 역할: 갯벌체험 지수 프론트엔드 전체 로직 (지도형 — 바다낚시/스킨스쿠버 방식)
 * ============================================================================
 *
 * [설명]
 * 갯벌체험 지수 탭을 바다낚시/스킨스쿠버와 동일한 지도형(마커+바텀시트)으로 표출합니다.
 * - OpenLayers 지도 + 발광형 동심원 마커 (오늘 대표 체험지수로 색상 결정)
 * - 데이터가 있는 체험장만 마커 표시 (미발생 지점은 표출하지 않음 — 추후 활성 시 자동 등장)
 * - 마커 클릭 시 바텀시트: 날짜 네비게이션 + 그 날짜의 체험시간/기온/날씨/체험지수 목록
 * - '체험불가'(시작·종료 00:00) 상태는 검정 계열로 표시
 *
 * [바다낚시와의 차이]
 * - forecasts[날짜] 가 오전/오후 슬롯이 아니라 '시간 구간(window) 배열' (같은 날 여러 구간 가능)
 * - 날짜 키가 'YYYY-MM-DD' 형식 (바다낚시는 'YYYYMMDD')
 * - 기상요약: 기온 / 날씨 (파고·유속·수온 없음), 체험시간(시작~종료) 표시
 *
 * [연계 파일]
 * - index2.html → #mudflat-section 내 HTML 요소들 (#mudflat-* IDs, .fishing-* 스타일)
 * - routes/fishing.js (서버) → GET /api/mudflat-index 데이터 제공
 * - js/marine.js → _onSectionActivated('mudflat-section') 시 initMudflat() 호출
 *
 * [데이터 구조] (서버 응답)
 * {
 *   updatedAt: '...',
 *   allPlaces: [...],   // 37개 전체(참고용)
 *   places: {           // 데이터 있는 지점만 (lat/lot 포함)
 *     '신리마을': { lat, lot, forecasts: {
 *        '2026-06-07': [ { bgng, end, minArtmp, maxArtmp, minWspd, maxWspd, weather, totalIndex }, ... ]
 *     } }
 *   }
 * }
 * ============================================================================
 */

(function () {
    'use strict';

    // ========================================================================
    // 상수 및 상태 변수
    // ========================================================================

    /** 지수 등급별 색상 맵 (마커 + 배지) — '체험불가'는 정보없음 의미의 검정 계열 */
    const LEVEL_COLORS = {
        '매우좋음': { inner: '#81D4FA', outer: '#1565C0', glow: 'rgba(21,101,192,0.5)' },
        '좋음':     { inner: '#81C784', outer: '#2E7D32', glow: 'rgba(46,125,50,0.5)' },
        '보통':     { inner: '#FFD54F', outer: '#F9A825', glow: 'rgba(249,168,37,0.5)' },
        '나쁨':     { inner: '#FFB74D', outer: '#E65100', glow: 'rgba(230,81,0,0.5)' },
        '매우나쁨': { inner: '#EF9A9A', outer: '#C62828', glow: 'rgba(198,40,40,0.5)' },
        '체험불가': { inner: '#6b7280', outer: '#111827', glow: 'rgba(0,0,0,0.55)' }
    };

    /** 등급 우선순위 (높을수록 좋음, 오늘 대표지수 산정에 사용) */
    const LEVEL_PRIORITY = { '체험불가': 0, '매우나쁨': 1, '나쁨': 2, '보통': 3, '좋음': 4, '매우좋음': 5 };

    /** '체험불가' 배지 인라인 스타일 (style.css에 level-체험불가 클래스가 없으므로 직접 지정) */
    const BAN_BADGE_STYLE = 'background:linear-gradient(135deg,#6b7280,#111827);color:#fff;border:1px solid rgba(0,0,0,0.4);';

    const KOREA_CENTER = ol.proj.fromLonLat([127.8, 35.9]);
    const DEFAULT_ZOOM = 7;

    // --- 모듈 상태 ---
    let mudflatMap = null;
    let markerLayer = null;
    let myLocationLayer = null;
    let mudflatData = null;
    let selectedPlace = null;
    let selectedDateIdx = 0;
    let availableDates = [];
    let selectedFeature = null;

    // ========================================================================
    // 1. 지도 초기화
    // ========================================================================

    window.initMudflat = function () {
        if (mudflatMap) {
            mudflatMap.updateSize();
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

        mudflatMap = new ol.Map({
            target: 'mudflat-map',
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

        mudflatMap.on('singleclick', function (evt) {
            const feature = mudflatMap.forEachFeatureAtPixel(evt.pixel, function (f) { return f; });
            if (feature && feature.get('placeName')) {
                _selectMarker(feature);
                if (window.trackUsage) window.trackUsage('life.mudflat.point');
                _openBottomSheet(feature.get('placeName'));
            }
        });

        mudflatMap.on('pointermove', function (evt) {
            const hit = mudflatMap.forEachFeatureAtPixel(evt.pixel, function () { return true; });
            mudflatMap.getTargetElement().style.cursor = hit ? 'pointer' : '';
        });

        _addLegendControl(mudflatMap);
        _addGuideControl(mudflatMap);
        _loadMudflatData();
        _bindEvents();
    };

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
            { name: '매우나쁨', inner: '#EF9A9A', outer: '#C62828', glow: 'rgba(198,40,40,0.4)' },
            { name: '체험불가', inner: '#6b7280', outer: '#111827', glow: 'rgba(0,0,0,0.4)' }
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
        btn.innerHTML = '<i class="fa-solid fa-circle-question"></i> <span>체험지수란?</span>';
        btn.style.position = 'absolute';
        btn.style.bottom = '8px';
        btn.style.right = '8px';
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            _openGuidePopup();
        });
        map.addControl(new ol.control.Control({ element: btn }));
    }

    function _openNoticePopup() {
        var src = document.getElementById('mudflat-disclaimer');
        var msgHtml = src ? src.innerHTML : '';
        if (typeof window.showSeagnalModal === 'function') {
            window.showSeagnalModal('유의사항', msgHtml, 'info');
        }
    }

    function _openGuidePopup() {
        _closeGuidePopup();

        var imgSrc = '/images/mudflat_guide.png';
        var title = '갯벌체험 지수란?';

        var overlay = document.createElement('div');
        overlay.className = 'fishing-guide-overlay';
        overlay.id = 'mudflat-guide-overlay';
        overlay.addEventListener('click', function () { _closeGuidePopup(); });

        var popup = document.createElement('div');
        popup.className = 'fishing-guide-popup';
        popup.id = 'mudflat-guide-popup';
        popup.addEventListener('click', function (e) { e.stopPropagation(); });

        var header = document.createElement('div');
        header.className = 'fishing-guide-popup-header';
        header.innerHTML = '<span>' + title + '</span>' +
            '<button class="fishing-guide-popup-close" id="mudflat-guide-close"><i class="fa-solid fa-xmark"></i></button>';

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
        img.onload = function () { spinner.style.display = 'none'; img.style.display = 'block'; };
        img.onerror = function () { spinner.innerHTML = '<span style="color:#ef4444;font-size:0.8rem;">이미지를 불러올 수 없습니다.</span>'; };
        body.appendChild(img);

        popup.appendChild(header);
        popup.appendChild(body);
        document.body.appendChild(overlay);
        document.body.appendChild(popup);

        document.getElementById('mudflat-guide-close').addEventListener('click', function () { _closeGuidePopup(); });

        if (window.PopupStack) {
            window.PopupStack.push('mudflat-guide-popup', function () { _closeGuidePopup(); });
        }
    }

    function _closeGuidePopup() {
        var overlay = document.getElementById('mudflat-guide-overlay');
        var popup = document.getElementById('mudflat-guide-popup');
        if (popup) {
            var img = popup.querySelector('img');
            if (img) { img.onload = null; img.onerror = null; }
            popup.remove();
        }
        if (overlay) overlay.remove();
        if (window.PopupStack) window.PopupStack.remove('mudflat-guide-popup');
    }

    // ========================================================================
    // 1-2. 마커 선택 시각적 피드백
    // ========================================================================

    function _drawMarkerCanvas(level, size, selected) {
        var colors = LEVEL_COLORS[level] || LEVEL_COLORS['보통'];
        var canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        var ctx = canvas.getContext('2d');
        var cx = size / 2, cy = size / 2, r = size / 2 - 1;

        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 2 * Math.PI);
        ctx.fillStyle = selected ? colors.glow.replace('0.5)', '0.8)').replace('0.55)', '0.8)') : colors.glow;
        ctx.fill();

        var grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r - 1);
        if (selected) { grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.3, colors.inner); grad.addColorStop(1, colors.outer); }
        else { grad.addColorStop(0, colors.inner); grad.addColorStop(1, colors.outer); }
        ctx.beginPath();
        ctx.arc(cx, cy, r - 1, 0, 2 * Math.PI);
        ctx.fillStyle = grad;
        ctx.fill();

        if (selected) {
            ctx.beginPath();
            ctx.arc(cx, cy, r - 1, 0, 2 * Math.PI);
            ctx.strokeStyle = 'rgba(255,255,255,0.7)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
        return canvas;
    }

    function _styleFeature(feature, level, selected) {
        var size = selected ? 22 : 14;
        feature.setStyle(new ol.style.Style({
            image: new ol.style.Icon({ img: _drawMarkerCanvas(level, size, selected), imgSize: [size, size], anchor: [0.5, 0.5] }),
            text: new ol.style.Text({
                text: feature.get('placeName'),
                font: 'bold 12px "Noto Sans KR", sans-serif',
                offsetY: selected ? 18 : 14,
                fill: new ol.style.Fill({ color: '#ffffff' }),
                stroke: new ol.style.Stroke({ color: '#000000', width: 3 })
            })
        }));
    }

    function _selectMarker(feature) {
        if (selectedFeature && selectedFeature !== feature) {
            _styleFeature(selectedFeature, selectedFeature.get('level') || '보통', false);
        }
        selectedFeature = feature;
        _styleFeature(feature, feature.get('level') || '보통', true);
    }

    // ========================================================================
    // 2. 데이터 로드 및 마커 렌더링
    // ========================================================================

    async function _loadMudflatData() {
        try {
            const res = await fetch((window.CONFIG ? CONFIG.API_BASE : '') + '/api/mudflat-index');
            if (!res.ok) throw new Error('데이터 없음');
            mudflatData = await res.json();

            const pubEl = document.getElementById('mudflat-publish-time');
            if (pubEl && mudflatData.updatedAt) {
                pubEl.textContent = '발표: ' + mudflatData.updatedAt;
            }
            _renderMarkers();
        } catch (e) {
            console.warn('🦪 갯벌체험 데이터 로드 실패:', e.message);
        }
    }

    /**
     * 데이터가 있는 체험장만 마커로 렌더링.
     * 마커 색상 = 오늘 날짜의 대표 체험지수(가장 좋은 구간). 오늘 데이터가 없으면
     * 가장 가까운(가장 이른) 날짜의 대표 지수를 사용.
     */
    function _renderMarkers() {
        if (!mudflatData || !markerLayer || !mudflatData.places) return;

        const source = markerLayer.getSource();
        source.clear();

        const todayStr = _getTodayStr();

        Object.keys(mudflatData.places).forEach(function (placeName) {
            const place = mudflatData.places[placeName];
            if (!place.lat || !place.lot) return;

            const level = _representativeLevel(place, todayStr);
            const feature = new ol.Feature({
                geometry: new ol.geom.Point(ol.proj.fromLonLat([place.lot, place.lat])),
                placeName: placeName,
                level: level
            });
            _styleFeature(feature, level, false);
            source.addFeature(feature);
        });
    }

    /**
     * 지점의 오늘(없으면 가장 이른 날짜) 대표 체험지수를 계산.
     * 한 날짜에 여러 구간이 있으면 가장 좋은 등급을 대표로 사용.
     * 모든 구간이 '체험불가'면 '체험불가' 반환.
     */
    function _representativeLevel(place, todayStr) {
        if (!place.forecasts) return '보통';
        var dateKey = place.forecasts[todayStr] ? todayStr : Object.keys(place.forecasts).sort()[0];
        var windows = dateKey ? place.forecasts[dateKey] : null;
        if (!windows || windows.length === 0) return '보통';

        var best = null, bestP = -1;
        windows.forEach(function (w) {
            var lv = w.totalIndex || '';
            var p = LEVEL_PRIORITY[lv];
            if (p === undefined) return;
            if (p > bestP) { bestP = p; best = lv; }
        });
        return best || '체험불가';
    }

    // ========================================================================
    // 3. 이벤트 바인딩
    // ========================================================================

    function _bindEvents() {
        var gpsBtn = document.getElementById('mudflat-my-location-btn');
        if (gpsBtn) gpsBtn.addEventListener('click', function () { _moveToMyLocation(); });

        var noticeBtn = document.getElementById('mudflat-notice-btn');
        if (noticeBtn) noticeBtn.addEventListener('click', function () { _openNoticePopup(); });

        var closeBtn = document.getElementById('mudflat-bs-close');
        if (closeBtn) closeBtn.addEventListener('click', function () { _closeBottomSheet(); });

        var overlay = document.getElementById('mudflat-bottomsheet-overlay');
        if (overlay) overlay.addEventListener('click', function () { _closeBottomSheet(); });

        var prevBtn = document.getElementById('mudflat-date-prev');
        var nextBtn = document.getElementById('mudflat-date-next');
        if (prevBtn) prevBtn.addEventListener('click', function () { if (selectedDateIdx > 0) { selectedDateIdx--; _renderBottomSheetContent(); } });
        if (nextBtn) nextBtn.addEventListener('click', function () { if (selectedDateIdx < availableDates.length - 1) { selectedDateIdx++; _renderBottomSheetContent(); } });
    }

    // ========================================================================
    // 4. GPS 내 위치 이동
    // ========================================================================

    function _moveToMyLocation() {
        if (!navigator.geolocation) { alert('이 기기에서는 위치 서비스를 사용할 수 없습니다.'); return; }

        var gpsBtn = document.getElementById('mudflat-my-location-btn');
        if (gpsBtn) gpsBtn.classList.add('loading');

        navigator.geolocation.getCurrentPosition(
            function (pos) {
                if (gpsBtn) gpsBtn.classList.remove('loading');
                var coord = ol.proj.fromLonLat([pos.coords.longitude, pos.coords.latitude]);
                mudflatMap.getView().animate({ center: coord, zoom: 10, duration: 600 });

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
                    mudflatMap.addLayer(myLocationLayer);
                }
                var source = myLocationLayer.getSource();
                source.clear();
                source.addFeature(new ol.Feature({ geometry: new ol.geom.Point(coord) }));
            },
            function (err) {
                if (gpsBtn) gpsBtn.classList.remove('loading');
                console.warn('🦪 GPS 오류:', err.message);
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

        var place = mudflatData && mudflatData.places && mudflatData.places[placeName];
        if (!place || !place.forecasts) return;

        availableDates = Object.keys(place.forecasts).sort();
        if (availableDates.length === 0) return;

        var placeEl = document.getElementById('mudflat-bs-place-name');
        if (placeEl) placeEl.textContent = placeName;

        var bs = document.getElementById('mudflat-bottomsheet');
        var overlay = document.getElementById('mudflat-bottomsheet-overlay');
        if (bs) bs.classList.add('active');
        if (overlay) overlay.classList.add('active');

        if (window.PopupStack) window.PopupStack.push('mudflat-bottomsheet', function () { _closeBottomSheet(); });

        _renderBottomSheetContent();
    }

    function _closeBottomSheet() {
        var bs = document.getElementById('mudflat-bottomsheet');
        var overlay = document.getElementById('mudflat-bottomsheet-overlay');
        if (bs) bs.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
        selectedPlace = null;

        if (selectedFeature) {
            _styleFeature(selectedFeature, selectedFeature.get('level') || '보통', false);
            selectedFeature = null;
        }
        if (window.PopupStack) window.PopupStack.remove('mudflat-bottomsheet');
    }

    // ========================================================================
    // 6. 바텀시트 콘텐츠 렌더링 (선택 날짜의 체험시간 구간 목록)
    // ========================================================================

    function _renderBottomSheetContent() {
        if (!selectedPlace || !mudflatData) return;

        var place = mudflatData.places && mudflatData.places[selectedPlace];
        if (!place) return;

        var dateStr = availableDates[selectedDateIdx];
        var windows = place.forecasts && place.forecasts[dateStr];

        var dateLabel = document.getElementById('mudflat-bs-date-label');
        if (dateLabel) dateLabel.textContent = _formatDateLabel(dateStr);

        var prevBtn = document.getElementById('mudflat-date-prev');
        var nextBtn = document.getElementById('mudflat-date-next');
        if (prevBtn) prevBtn.disabled = selectedDateIdx <= 0;
        if (nextBtn) nextBtn.disabled = selectedDateIdx >= availableDates.length - 1;

        // 종합 지수 배지 (그 날짜의 대표 지수)
        var totalIdxEl = document.getElementById('mudflat-bs-total-index');
        if (totalIdxEl) {
            var rep = _representativeLevel(place, dateStr);
            totalIdxEl.innerHTML = _badgeHtml(rep);
        }

        var contentEl = document.getElementById('mudflat-bs-content');
        if (!contentEl) return;

        if (!windows || windows.length === 0) {
            contentEl.innerHTML = '<p style="color:#888;text-align:center;padding:20px;">해당 날짜의 예보 데이터가 없습니다.</p>';
            return;
        }

        // 같은 날 여러 구간이면 시작시간 기준 정렬
        var sorted = windows.slice().sort(function (a, b) { return (a.bgng || '').localeCompare(b.bgng || ''); });

        var html = '';
        sorted.forEach(function (w) {
            html += _buildWindowBlock(w);
        });
        contentEl.innerHTML = html;
    }

    /**
     * 체험시간 구간 1개를 카드로 렌더링.
     * 체험불가(시작·종료 00:00)면 시간 대신 '체험 가능 시간 없음' 표시.
     */
    function _buildWindowBlock(w) {
        var isBan = (w.totalIndex === '체험불가') || (!w.bgng || !w.end) || (w.bgng === '00:00' && w.end === '00:00');
        var timeRange = isBan ? '체험 가능 시간 없음' : (w.bgng + ' ~ ' + w.end);
        var duration = isBan ? '' : _calcDuration(w.bgng, w.end);
        var temp = (w.minArtmp != null && w.maxArtmp != null && w.minArtmp !== '' && w.maxArtmp !== '') ? (w.minArtmp + '~' + w.maxArtmp + '°C') : '-';
        var weather = w.weather || '-';

        var html = '<div class="fishing-time-block">';
        html += '<div class="fishing-time-header">';
        html += '<span class="fishing-time-badge"><i class="fa-solid fa-clock" style="margin-right:4px;"></i>' + timeRange +
            (duration ? ' <span style="opacity:0.8;font-weight:400;">(' + duration + ')</span>' : '') + '</span>';
        html += _badgeHtml(w.totalIndex);
        html += '</div>';

        html += '<div class="fishing-weather-table">';
        html += '<span><i class="fa-solid fa-thermometer-half"></i> 기온 ' + temp + '</span>';
        html += '<span>' + _getWeatherIcon(weather) + ' 날씨 ' + _escapeHtml(weather) + '</span>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    /** 체험지수 배지 HTML (5단계는 level-* 클래스, 체험불가는 인라인 검정) */
    function _badgeHtml(idx) {
        if (!idx) return '';
        if (idx === '체험불가') {
            return '<span class="fishing-index-badge" style="' + BAN_BADGE_STYLE + '">체험불가</span>';
        }
        return '<span class="fishing-index-badge level-' + idx + '">' + idx + '</span>';
    }

    // ========================================================================
    // 7. 유틸리티 함수
    // ========================================================================

    /** 오늘 날짜를 'YYYY-MM-DD' 형식으로 반환 (mudflat 데이터 키 형식) */
    function _getTodayStr() {
        var now = new Date();
        var yyyy = now.getFullYear();
        var mm = String(now.getMonth() + 1).padStart(2, '0');
        var dd = String(now.getDate()).padStart(2, '0');
        return yyyy + '-' + mm + '-' + dd;
    }

    /** 'YYYY-MM-DD' → '오늘 06월 07일 (일)' 형식 */
    function _formatDateLabel(dateStr) {
        var parts = (dateStr || '').split('-');
        if (parts.length !== 3) return dateStr || '-';
        var y = parseInt(parts[0], 10), m = parseInt(parts[1], 10), d = parseInt(parts[2], 10);
        var date = new Date(y, m - 1, d);
        var days = ['일', '월', '화', '수', '목', '금', '토'];
        var prefix = (dateStr === _getTodayStr()) ? '오늘 ' : '';
        return prefix + String(m).padStart(2, '0') + '월 ' + String(d).padStart(2, '0') + '일 (' + days[date.getDay()] + ')';
    }

    /** 체험시간 소요시간 계산 ('09:00','15:25' → '6시간 25분') */
    function _calcDuration(startStr, endStr) {
        var s = startStr.split(':'), e = endStr.split(':');
        if (s.length < 2 || e.length < 2) return '';
        var sm = parseInt(s[0], 10) * 60 + parseInt(s[1], 10);
        var em = parseInt(e[0], 10) * 60 + parseInt(e[1], 10);
        if (isNaN(sm) || isNaN(em)) return '';
        var diff = em - sm;
        if (diff < 0) diff += 24 * 60;
        if (diff <= 0) return '';
        var h = Math.floor(diff / 60), mn = diff % 60;
        if (h > 0 && mn > 0) return h + '시간 ' + mn + '분';
        if (h > 0) return h + '시간';
        return mn + '분';
    }

    function _getWeatherIcon(weather) {
        if (!weather) return '';
        if (weather.indexOf('맑') >= 0) return '<i class="fa-solid fa-sun" style="color:#ffd54f;"></i>';
        if (weather.indexOf('구름') >= 0) return '<i class="fa-solid fa-cloud-sun" style="color:#90a4ae;"></i>';
        if (weather.indexOf('흐') >= 0) return '<i class="fa-solid fa-cloud" style="color:#78909c;"></i>';
        if (weather.indexOf('비') >= 0 || weather.indexOf('소나기') >= 0) return '<i class="fa-solid fa-cloud-rain" style="color:#42a5f5;"></i>';
        if (weather.indexOf('눈') >= 0) return '<i class="fa-solid fa-snowflake" style="color:#b3e5fc;"></i>';
        return '<i class="fa-solid fa-cloud" style="color:#78909c;"></i>';
    }

    function _escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

})();
