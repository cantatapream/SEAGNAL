/**
 * ============================================================================
 * 파일명: js/ripcurrent.js
 * 역할: 이안류 지수 프론트엔드 전체 로직 (지도형 — 스킨스쿠버 방식)
 * ============================================================================
 *
 * [설명]
 * 이안류 지수 탭을 스킨스쿠버와 동일한 지도형(마커+바텀시트)으로 표출합니다.
 * 단, 이안류는 7일 예보가 아니라 '실시간 관측'이므로 날짜 네비게이션이 없고
 * 각 해수욕장의 최신 관측값(현재 상태)을 보여줍니다.
 * - 4단계(관심/주의/경계/위험) 전용 색상 마커
 * - 10개 해수욕장 모두 표시, 관측 데이터가 없는 곳은 '정보 없음'(검정) 마커
 * - 마커 클릭 시 바텀시트: 위험단계 + 관측시각 + 지수값 + 파고/파주기/수온/기온/풍향/풍속
 *
 * [연계 파일]
 * - index2.html → #ripcurrent-section 내 HTML 요소들 (#rip-* IDs, .fishing-* 스타일)
 * - routes/fishing.js (서버) → GET /api/ripcurrent-index 데이터 제공
 * - js/marine.js → _onSectionActivated('ripcurrent-section') 시 initRipCurrent() 호출
 *
 * [데이터 구조] (서버 응답)
 * {
 *   updatedAt: "...",
 *   places: {
 *     "해운대해수욕장": { code, lat, lot, hasData:true, level:'경계', score:49,
 *                       obsrvnDt:'2026-06-07 22:40', wvhgt, wvpd, wtem, artmp, wndrct, wspd },
 *     "대천해수욕장":   { code, lat, lot, hasData:false, level:null }
 *   }
 * }
 * ============================================================================
 */

(function () {
    'use strict';

    // ========================================================================
    // 상수 및 상태 변수
    // ========================================================================

    /** 이안류 4단계 색상 + 정보없음(검정). (관심=파랑 → 위험=빨강) */
    const LEVEL_COLORS = {
        '관심': { inner: '#4FC3F7', outer: '#0277BD', glow: 'rgba(2,119,189,0.5)' },
        '주의': { inner: '#FFD54F', outer: '#F9A825', glow: 'rgba(249,168,37,0.5)' },
        '경계': { inner: '#FFB74D', outer: '#E65100', glow: 'rgba(230,81,0,0.5)' },
        '위험': { inner: '#EF5350', outer: '#C62828', glow: 'rgba(198,40,40,0.55)' },
        '정보없음': { inner: '#6b7280', outer: '#111827', glow: 'rgba(0,0,0,0.55)' }
    };

    /** 마커 정렬 우선순위 (위험할수록 위에 표시) */
    const LEVEL_PRIORITY = { '정보없음': 0, '관심': 1, '주의': 2, '경계': 3, '위험': 4 };

    /** 배지 인라인 스타일 (style.css에 이안류 단계 클래스가 없으므로 직접 지정) */
    function _badgeStyle(level) {
        var c = LEVEL_COLORS[level] || LEVEL_COLORS['정보없음'];
        var textColor = (level === '주의') ? '#333' : '#fff';
        return 'background:linear-gradient(135deg,' + c.inner + ',' + c.outer + ');color:' + textColor + ';border:1px solid rgba(0,0,0,0.25);';
    }

    const KOREA_CENTER = ol.proj.fromLonLat([127.8, 35.9]);
    const DEFAULT_ZOOM = 7;

    // --- 모듈 상태 ---
    let ripMap = null;
    let markerLayer = null;
    let myLocationLayer = null;
    let ripData = null;
    let selectedPlace = null;
    let selectedFeature = null;

    // ========================================================================
    // 1. 지도 초기화
    // ========================================================================

    window.initRipCurrent = function () {
        if (ripMap) {
            ripMap.updateSize();
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

        ripMap = new ol.Map({
            target: 'rip-map',
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

        ripMap.on('singleclick', function (evt) {
            const feature = ripMap.forEachFeatureAtPixel(evt.pixel, function (f) { return f; });
            if (feature && feature.get('placeName')) {
                _selectMarker(feature);
                if (window.trackUsage) window.trackUsage('life.ripcurrent.point');
                _openBottomSheet(feature.get('placeName'));
            }
        });

        ripMap.on('pointermove', function (evt) {
            const hit = ripMap.forEachFeatureAtPixel(evt.pixel, function () { return true; });
            ripMap.getTargetElement().style.cursor = hit ? 'pointer' : '';
        });

        _addLegendControl(ripMap);
        // [제거] '이안류 지수란?' 안내 이미지가 없어 지도 위 안내 버튼은 두지 않음.
        //        4단계 설명은 우측 상단 ❗(유의사항) 버튼의 텍스트 안내로 제공.
        _loadRipData();
        _bindEvents();
    };

    // ========================================================================
    // 1-1. 지도 내부 커스텀 컨트롤 (범례, 안내 버튼)
    // ========================================================================

    function _addLegendControl(map) {
        var legendEl = document.createElement('div');
        legendEl.className = 'fishing-legend';

        ['관심', '주의', '경계', '위험', '정보없음'].forEach(function (lvName) {
            var c = LEVEL_COLORS[lvName];
            var item = document.createElement('span');
            item.className = 'fishing-legend-item';
            item.innerHTML = '<span class="fishing-legend-dot" style="background:radial-gradient(circle, ' +
                c.inner + ' 30%, ' + c.outer + ' 100%);box-shadow:0 0 6px ' + c.glow + ';"></span>' + lvName;
            legendEl.appendChild(item);
        });

        legendEl.style.position = 'absolute';
        legendEl.style.bottom = '8px';
        legendEl.style.left = '8px';
        map.addControl(new ol.control.Control({ element: legendEl }));
    }

    /**
     * 유의사항(이안류 발생 시 행동요령) 팝업.
     * 기상청 '이안류 발생 시 행동요령' 이미지(ripcrnt_notice.png)를 상단에 표시하고,
     * 그 아래에 텍스트 안내(#rip-disclaimer)를 함께 보여줍니다.
     * (서핑/갯벌 지수 안내 팝업과 동일한 패턴 — 이미지 로딩 스피너 + 실패 시 폴백)
     */
    function _openNoticePopup() {
        _closeNoticePopup();

        var imgSrc = '/images/ripcrnt_notice.png';
        var title = '이안류 발생 시 행동요령';
        var src = document.getElementById('rip-disclaimer');
        var msgHtml = src ? src.innerHTML : '';

        var overlay = document.createElement('div');
        overlay.className = 'fishing-guide-overlay';
        overlay.id = 'rip-notice-overlay';
        overlay.addEventListener('click', function () { _closeNoticePopup(); });

        var popup = document.createElement('div');
        popup.className = 'fishing-guide-popup';
        popup.id = 'rip-notice-popup';
        popup.addEventListener('click', function (e) { e.stopPropagation(); });

        var header = document.createElement('div');
        header.className = 'fishing-guide-popup-header';
        header.innerHTML = '<span>' + title + '</span>' +
            '<button class="fishing-guide-popup-close" id="rip-notice-close"><i class="fa-solid fa-xmark"></i></button>';

        var body = document.createElement('div');
        body.className = 'fishing-guide-popup-body';

        // 행동요령 이미지 (스피너 → 로딩 완료 시 표시, 실패 시 숨김)
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
        img.onerror = function () { spinner.style.display = 'none'; }; // 이미지 없으면 텍스트만
        body.appendChild(img);

        // 텍스트 안내
        if (msgHtml) {
            var textBox = document.createElement('div');
            textBox.className = 'fishing-disclaimer';
            textBox.style.display = 'block';
            textBox.style.marginTop = '10px';
            textBox.innerHTML = msgHtml;
            body.appendChild(textBox);
        }

        popup.appendChild(header);
        popup.appendChild(body);
        document.body.appendChild(overlay);
        document.body.appendChild(popup);

        document.getElementById('rip-notice-close').addEventListener('click', function () { _closeNoticePopup(); });

        if (window.PopupStack) {
            window.PopupStack.push('rip-notice-popup', function () { _closeNoticePopup(); });
        }
    }

    function _closeNoticePopup() {
        var overlay = document.getElementById('rip-notice-overlay');
        var popup = document.getElementById('rip-notice-popup');
        if (popup) {
            var img = popup.querySelector('img');
            if (img) { img.onload = null; img.onerror = null; }
            popup.remove();
        }
        if (overlay) overlay.remove();
        if (window.PopupStack) window.PopupStack.remove('rip-notice-popup');
    }

    // ========================================================================
    // 1-2. 마커 그리기/선택
    // ========================================================================

    function _drawMarkerCanvas(level, size, selected) {
        var colors = LEVEL_COLORS[level] || LEVEL_COLORS['정보없음'];
        var canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        var ctx = canvas.getContext('2d');
        var cx = size / 2, cy = size / 2, r = size / 2 - 1;

        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 2 * Math.PI);
        ctx.fillStyle = selected ? colors.glow.replace(/0\.5\d?\)/, '0.8)') : colors.glow;
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
            _styleFeature(selectedFeature, selectedFeature.get('level') || '정보없음', false);
        }
        selectedFeature = feature;
        _styleFeature(feature, feature.get('level') || '정보없음', true);
    }

    // ========================================================================
    // 2. 데이터 로드 및 마커 렌더링
    // ========================================================================

    async function _loadRipData() {
        try {
            const res = await fetch((window.CONFIG ? CONFIG.API_BASE : '') + '/api/ripcurrent-index');
            if (!res.ok) throw new Error('데이터 없음');
            ripData = await res.json();

            const pubEl = document.getElementById('rip-publish-time');
            if (pubEl && ripData.updatedAt) {
                pubEl.textContent = '기준: ' + ripData.updatedAt;
            }
            _renderMarkers();
        } catch (e) {
            console.warn('🌊 이안류 데이터 로드 실패:', e.message);
        }
    }

    /** 10개 해수욕장 모두 마커 표시. 관측 데이터 없으면 '정보없음'(검정). */
    function _renderMarkers() {
        if (!ripData || !markerLayer || !ripData.places) return;

        const source = markerLayer.getSource();
        source.clear();

        Object.keys(ripData.places).forEach(function (placeName) {
            const place = ripData.places[placeName];
            if (!place.lat || !place.lot) return;

            const level = (place.hasData && place.level) ? place.level : '정보없음';
            const feature = new ol.Feature({
                geometry: new ol.geom.Point(ol.proj.fromLonLat([place.lot, place.lat])),
                placeName: placeName,
                level: level
            });
            _styleFeature(feature, level, false);
            source.addFeature(feature);
        });
    }

    // ========================================================================
    // 3. 이벤트 바인딩
    // ========================================================================

    function _bindEvents() {
        var gpsBtn = document.getElementById('rip-my-location-btn');
        if (gpsBtn) gpsBtn.addEventListener('click', function () { _moveToMyLocation(); });

        var noticeBtn = document.getElementById('rip-notice-btn');
        if (noticeBtn) noticeBtn.addEventListener('click', function () { _openNoticePopup(); });

        var closeBtn = document.getElementById('rip-bs-close');
        if (closeBtn) closeBtn.addEventListener('click', function () { _closeBottomSheet(); });

        var overlay = document.getElementById('rip-bottomsheet-overlay');
        if (overlay) overlay.addEventListener('click', function () { _closeBottomSheet(); });
    }

    // ========================================================================
    // 4. GPS 내 위치 이동
    // ========================================================================

    function _moveToMyLocation() {
        if (!navigator.geolocation) { alert('이 기기에서는 위치 서비스를 사용할 수 없습니다.'); return; }

        var gpsBtn = document.getElementById('rip-my-location-btn');
        if (gpsBtn) gpsBtn.classList.add('loading');

        navigator.geolocation.getCurrentPosition(
            function (pos) {
                if (gpsBtn) gpsBtn.classList.remove('loading');
                var coord = ol.proj.fromLonLat([pos.coords.longitude, pos.coords.latitude]);
                ripMap.getView().animate({ center: coord, zoom: 10, duration: 600 });

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
                    ripMap.addLayer(myLocationLayer);
                }
                var source = myLocationLayer.getSource();
                source.clear();
                source.addFeature(new ol.Feature({ geometry: new ol.geom.Point(coord) }));
            },
            function (err) {
                if (gpsBtn) gpsBtn.classList.remove('loading');
                console.warn('🌊 GPS 오류:', err.message);
                alert('위치를 가져올 수 없습니다.\n위치 권한을 확인해 주세요.');
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    }

    // ========================================================================
    // 5. 바텀시트 열기 / 닫기 / 렌더링 (실시간 단일 관측 — 날짜 네비게이션 없음)
    // ========================================================================

    function _openBottomSheet(placeName) {
        selectedPlace = placeName;
        var place = ripData && ripData.places && ripData.places[placeName];
        if (!place) return;

        var placeEl = document.getElementById('rip-bs-place-name');
        if (placeEl) placeEl.textContent = placeName;

        var level = (place.hasData && place.level) ? place.level : '정보없음';
        var badgeEl = document.getElementById('rip-bs-level');
        if (badgeEl) badgeEl.innerHTML = '<span class="fishing-index-badge" style="' + _badgeStyle(level) + '">' + level + '</span>';

        var contentEl = document.getElementById('rip-bs-content');
        if (contentEl) contentEl.innerHTML = _buildContent(place);

        var bs = document.getElementById('rip-bottomsheet');
        var overlay = document.getElementById('rip-bottomsheet-overlay');
        if (bs) bs.classList.add('active');
        if (overlay) overlay.classList.add('active');

        if (window.PopupStack) window.PopupStack.push('rip-bottomsheet', function () { _closeBottomSheet(); });
    }

    function _closeBottomSheet() {
        var bs = document.getElementById('rip-bottomsheet');
        var overlay = document.getElementById('rip-bottomsheet-overlay');
        if (bs) bs.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
        selectedPlace = null;

        if (selectedFeature) {
            _styleFeature(selectedFeature, selectedFeature.get('level') || '정보없음', false);
            selectedFeature = null;
        }
        if (window.PopupStack) window.PopupStack.remove('rip-bottomsheet');
    }

    function _buildContent(place) {
        if (!place.hasData) {
            return '<p style="color:#94a3b8;text-align:center;padding:24px 12px;line-height:1.6;">' +
                '<i class="fa-solid fa-circle-info" style="margin-right:4px;"></i> 현재 이안류 관측 정보가 없습니다.<br>' +
                '<span style="font-size:0.85rem;">이안류 지수는 여름철(6~9월) 운영기간에 제공됩니다.</span></p>';
        }

        var html = '';
        // 관측시각 + 지수값
        html += '<div class="fishing-time-block">';
        html += '<div class="fishing-weather-table">';
        if (place.obsrvnDt) html += '<span><i class="fa-solid fa-clock"></i> 관측 ' + _escapeHtml(place.obsrvnDt) + '</span>';
        if (place.score != null && place.score !== '') html += '<span><i class="fa-solid fa-gauge-high"></i> 지수값 ' + _escapeHtml(String(place.score)) + '</span>';
        html += '</div>';
        html += '</div>';

        // 해양·기상 관측값
        html += '<div class="fishing-time-block">';
        html += '<span class="fishing-time-badge">관측 환경</span>';
        html += '<div class="fishing-weather-table">';
        if (place.wvhgt) html += '<span><i class="fa-solid fa-water"></i> 파고 ' + _escapeHtml(place.wvhgt) + 'm</span>';
        if (place.wvpd)  html += '<span><i class="fa-solid fa-wave-square"></i> 파주기 ' + _escapeHtml(place.wvpd) + 'sec</span>';
        if (place.wtem)  html += '<span><i class="fa-solid fa-temperature-half"></i> 수온 ' + _escapeHtml(place.wtem) + '°C</span>';
        if (place.artmp) html += '<span><i class="fa-solid fa-thermometer-half"></i> 기온 ' + _escapeHtml(place.artmp) + '°C</span>';
        if (place.wndrct || place.wspd) {
            html += '<span><i class="fa-solid fa-wind"></i> 바람 ' + _escapeHtml(place.wndrct || '') + ' ' + _escapeHtml(place.wspd || '') + (place.wspd ? 'm/s' : '') + '</span>';
        }
        html += '</div>';
        html += '</div>';

        return html;
    }

    // ========================================================================
    // 6. 유틸리티
    // ========================================================================

    function _escapeHtml(str) {
        if (str == null) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(String(str)));
        return div.innerHTML;
    }

})();
