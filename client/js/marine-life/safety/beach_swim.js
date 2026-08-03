/**
 * ============================================================================
 * 파일명: client/js/marine-life/safety/beach_swim.js
 * 역할  : 해양안전 지도에 "해수욕" 토글 버튼을 얹어, 전국 해수욕장의 해수욕 지수
 *         (파고·수온·기온·풍속 기반 5단계, 국립해양조사원 fcstBeachv2)를 색상별 점 마커로
 *         표시한다. 마커를 탭하면 오늘/내일 예보 요약을 팝업으로 보여준다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : ocean-map/map/ocean_map.js(window.getOceanMap), OpenLayers(ol.*)
 *  - 서버 API      : GET /api/swimming-index (routes/fishing.js) — 해양생활 탭의
 *                    marine-life/swimming/swimming.js 와 동일한 데이터를 재사용
 *  - 마크업        : index2.html #ocean-swimming-toggle-btn — 해양안전 전용
 *  - 나를 쓰는 곳  : 토글 버튼은 이 파일이 자체 바인딩(fishing_ban.js 와 동일 패턴).
 *                    마커 클릭은 ocean_map.js의 handleMapClick 이
 *                    window._beachSwimTryHandleClick(map, evt) 를 호출
 *                    (seaway.js 의 _seawayTryHandleClick 다음 순위)
 * [로드 순서] seaway.js 다음 · life_safety.js 바로 앞 (marine-life/safety 그룹)
 * ============================================================================
 */

(function () {
    'use strict';

    var DATA_URL = (window.CONFIG ? CONFIG.API_BASE : '') + '/api/swimming-index';

    /** 지수 등급별 색상 맵 — 스킨스쿠버/해수욕 지도형과 동일 5단계 */
    var LEVEL_COLORS = {
        '매우좋음': { inner: '#81D4FA', outer: '#1565C0', glow: 'rgba(21,101,192,0.5)' },
        '좋음':     { inner: '#81C784', outer: '#2E7D32', glow: 'rgba(46,125,50,0.5)' },
        '보통':     { inner: '#FFD54F', outer: '#F9A825', glow: 'rgba(249,168,37,0.5)' },
        '나쁨':     { inner: '#FFB74D', outer: '#E65100', glow: 'rgba(230,81,0,0.5)' },
        '매우나쁨': { inner: '#EF9A9A', outer: '#C62828', glow: 'rgba(198,40,40,0.5)' }
    };

    var _layer = null;
    var _source = null;
    var _visible = false;
    var _loaded = false;
    var _loading = false;
    var _data = null; // 서버 응답 전체 (places)

    function _getTodayStr() {
        var now = new Date();
        return now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
    }
    function _getCurrentTimeSlot() {
        return new Date().getHours() < 12 ? '오전' : '오후';
    }

    function _markerCanvas(level) {
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

        return canvas;
    }

    function _ensureLayer(map) {
        if (_source) return;
        _source = new ol.source.Vector();
        _layer = new ol.layer.Vector({
            source: _source,
            zIndex: 58,
            visible: _visible,
            updateWhileAnimating: false,
            updateWhileInteracting: false
        });
        map.addLayer(_layer);
    }

    function _renderMarkers() {
        if (!_data || !_source) return;
        _source.clear();

        var places = _data.places || {};
        var todayStr = _getTodayStr();
        var timeSlot = _getCurrentTimeSlot();

        Object.keys(places).forEach(function (placeName) {
            var place = places[placeName];
            if (!place.lat || !place.lot) return;

            var level = '';
            var todayForecast = place.forecasts && place.forecasts[todayStr];
            if (todayForecast) {
                var slotData = todayForecast[timeSlot] || todayForecast['오전'] || todayForecast['오후'] || todayForecast['일'];
                if (slotData) level = slotData.totalIndex || '';
            }
            if (!level) level = '보통';

            var feature = new ol.Feature({
                geometry: new ol.geom.Point(ol.proj.fromLonLat([place.lot, place.lat])),
                placeName: placeName,
                level: level
            });
            feature.setStyle(new ol.style.Style({
                image: new ol.style.Icon({ img: _markerCanvas(level), imgSize: [14, 14], anchor: [0.5, 0.5] })
            }));
            _source.addFeature(feature);
        });
    }

    /** 데이터 lazy fetch — 버튼을 처음 켤 때만 1회 */
    function _load() {
        if (_loaded || _loading) return;
        _loading = true;
        fetch(DATA_URL)
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (json) {
                _data = json;
                _loaded = true;
                _loading = false;
                _renderMarkers();
            })
            .catch(function (err) {
                _loading = false;
                console.warn('[BeachSwim] 데이터 로드 실패:', err.message);
            });
    }

    /** "라벨/값" 2열 grid의 한 행 — 값이 없으면 그 행 자체를 만들지 않는다.
     *  (CSS 는 출입통제/낚시금지 팝업과 같은 .ac-detail-* 을 그대로 재사용) */
    function _row(label, value) {
        if (!value) return '';
        return '<span class="ac-detail-label">' + label + '</span><span class="ac-detail-value">' + value + '</span>';
    }

    /** 마커 하나의 오늘/내일 예보 요약 팝업 HTML을 만든다 */
    function _buildDetailHtml(placeName) {
        var place = _data && _data.places && _data.places[placeName];
        if (!place || !place.forecasts) return '<p>예보 데이터를 불러오지 못했습니다.</p>';

        var dates = Object.keys(place.forecasts).sort().slice(0, 2); // 오늘 + 내일
        var html = '';
        dates.forEach(function (dateStr) {
            var forecast = place.forecasts[dateStr];
            var y = dateStr.substring(0, 4), m = dateStr.substring(4, 6), d = dateStr.substring(6, 8);
            var label = (dateStr === _getTodayStr()) ? '오늘 (' + m + '/' + d + ')' : m + '/' + d;

            ['오전', '오후', '일'].forEach(function (slot) {
                var s = forecast[slot];
                if (!s) return;
                html += '<p style="margin:8px 0 4px;"><strong>' + label + (slot === '일' ? '' : ' ' + slot) + '</strong></p>';
                html += '<div class="ac-detail-grid">';
                html += _row('종합지수', s.totalIndex);
                html += _row('개장상태', s.opnStat);
                html += _row('파고', s.maxWvhgt ? s.maxWvhgt + 'm' : '');
                html += _row('수온', s.avgWtem ? s.avgWtem + '°C' : '');
                html += _row('기온', s.avgArtmp ? s.avgArtmp + '°C' : '');
                html += _row('풍속', s.maxWspd ? s.maxWspd + 'm/s' : '');
                html += '</div>';
            });
        });

        return html || '<p>예보 데이터를 불러오지 못했습니다.</p>';
    }

    /**
     * [외부 API] 지도 클릭이 해수욕 마커를 눌렀는지 확인한다.
     * @param {ol.Map} map
     * @param {ol.MapBrowserEvent} evt
     * @returns {boolean} true 면 클릭이 소비됨(호출자는 바텀시트 등을 건너뛰어야 함)
     * [연계] ← ocean_map.js handleMapClick — 항로 다음 우선순위로 호출.
     */
    window._beachSwimTryHandleClick = function (map, evt) {
        if (!_visible || !_layer) return false;
        var hit = map.forEachFeatureAtPixel(evt.pixel, function (feature, layer) {
            if (layer === _layer) return feature;
            return null;
        });
        if (!hit) return false;
        var name = hit.get('placeName') || '해수욕장';
        if (typeof window.showSeagnalModal === 'function') {
            window.showSeagnalModal(name, _buildDetailHtml(name), 'info');
            var modalContent = document.querySelector('#seagnal-custom-modal .seagnal-modal-content');
            if (modalContent) modalContent.classList.add('access-control-wide');
        } else if (typeof window._showOceanToast === 'function') {
            window._showOceanToast(name, 'bottom', 3000);
        }
        return true;
    };

    function _bindToggle(map) {
        var btn = document.getElementById('ocean-swimming-toggle-btn');
        if (!btn) return;

        btn.addEventListener('click', function () {
            _visible = !_visible;
            btn.classList.toggle('active', _visible);
            if (_layer) _layer.setVisible(_visible);
            if (_visible) _load();
        });
    }

    /** oceanMap 이 만들어질 때까지 폴링 (fishing_ban.js 와 동일 패턴) */
    function _installWhenReady() {
        function _try() {
            var map = window.getOceanMap && window.getOceanMap();
            if (map) {
                _ensureLayer(map);
                _bindToggle(map);
                return;
            }
            setTimeout(_try, 250);
        }
        _try();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _installWhenReady);
    } else {
        _installWhenReady();
    }
})();
