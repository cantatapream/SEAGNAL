/**
 * ============================================================================
 * 바텀시트 '시정' 통합 — ocean_bottom_sheet_vsby.js
 * ============================================================================
 *
 * 역할:
 *   해점(소해구) 클릭 시 바텀시트에 시정(visibility) 시계열을 표출한다.
 *     1) 그리드의 '시정' 카드(ocean-val-vsby) → 현재 슬라이더 시각의 시정 km 1줄.
 *     2) 그리드 아래 풀폭 '시정 예보' 섹션(JS 가 동적 주입) →
 *        - 1시간 해상도 라인 그래프 (전체 시계열)
 *        - 3시간 간격 하단 km 라벨 (20km 클램프)
 *        - 라인 hover/tap → 정확한 km 툴팁
 *        - 슬라이더 시각에 수직 마커 (현재 시정 readout 과 동기)
 *
 * 데이터 경로 (서버 API, same-origin):
 *   GET /api/vsby-smallzone/point?lat=&lon=
 *     → { success, cell:"144-9", baseTm, series:[{t:"YYYY.MM.DD HH:mm", v:<km>}, ...], cached }
 *   series 는 1시간 간격, v 는 RAW km (최대 100). 표시 시 20km 클램프.
 *
 * 슬라이더 동기:
 *   기존 카드와 동일하게 OS.loadVsbyCard(lat, lon, date) 가 진입점.
 *   - 좌표가 바뀌면(시트 새로 열림/다른 해점) 시계열을 새로 fetch 하고 그래프를 다시 그림.
 *   - 같은 좌표에서 date 만 바뀌면(슬라이더 이동 / ◀▶ / release) 캐시된 시계열을 재사용해
 *     현재 readout + 그래프 마커만 갱신 (재요청 X).
 *   호출처: 5.js loadAllForDate, 2.js onTimelineChanged, (release→loadAllForDate).
 *
 * 의존:
 *   - Chart.js (전역 Chart) + chartjs-plugin-datalabels (전역 ChartDataLabels)
 *   - OS.setCardValue / OS.showCard / OS.hideCard (ocean_bottom_sheet1.js)
 *   - DOM: #ocean-card-vsby, #ocean-val-vsby, #ocean-cards-grid, #ocean-sheet-body
 * ============================================================================
 */
(function () {
    'use strict';

    var OS = window.OceanSheet = window.OceanSheet || {};

    // 동시성 토큰 — 빠른 좌표 변경 시 오래된 응답이 새 응답을 덮지 않도록.
    var _fetchToken = 0;

    // 마지막으로 fetch 한 좌표 + 시계열 캐시 (같은 좌표 슬라이더 이동 시 재사용).
    var _cache = {
        lat: null,
        lon: null,
        series: null    // [{ tMs:<epoch ms>, v:<raw km> }, ...] (정렬됨)
    };

    var _chart = null;        // Chart.js 인스턴스
    var _styleInjected = false;

    // 색상 스케일 (vsby_forecast_layer.js VSBY_STOPS 와 동일).
    var VSBY_STOPS = [
        { v: 0.0,  color: '#ff2bd6' },
        { v: 0.2,  color: '#e60000' },
        { v: 0.6,  color: '#ff7f00' },
        { v: 1.0,  color: '#ffb547' },
        { v: 2.0,  color: '#ffe800' },
        { v: 3.0,  color: '#c8d600' },
        { v: 5.0,  color: '#16b41a' },
        { v: 7.0,  color: '#6fdf6f' },
        { v: 10.0, color: '#1fb6d6' },
        { v: 14.0, color: '#2f7be6' },
        { v: 20.0, color: '#ffffff' }
    ];

    var VSBY_MAX = 20;   // 표시 클램프 상한 (km)

    // ─────────────────────────────────────────────────────────────
    // 유틸
    // ─────────────────────────────────────────────────────────────

    /** 20km 클램프. null 은 그대로. */
    function _clamp(v) {
        if (v == null) return null;
        return v >= VSBY_MAX ? VSBY_MAX : v;
    }

    /** 작은 숫자 포맷: 0 → '0', 0.5 → '0.5', 4 → '4'. */
    function _fmtNum(v) {
        if (v == null) return '';
        if (v === 0) return '0';
        return String(Math.round(v * 10) / 10);
    }

    /** 클램프 km → 카드/툴팁 텍스트. 20 이상은 '20km 이상'. */
    function _fmtVis(v) {
        if (v == null) return '정보 없음';
        return (v >= VSBY_MAX) ? '20km 이상' : (_fmtNum(v) + 'km');
    }

    /** km 값 → 버킷 색상 (largest stop ≤ v). */
    function _colorFor(v) {
        if (v == null) return '#888';
        var c = VSBY_STOPS[0].color;
        for (var i = 0; i < VSBY_STOPS.length; i++) {
            if (v >= VSBY_STOPS[i].v) c = VSBY_STOPS[i].color;
            else break;
        }
        return c;
    }

    /**
     * "YYYY.MM.DD HH:mm" (KST) → epoch ms.
     * 브라우저 로컬 TZ 가 KST 라는 가정 (앱/서버 동일 정책). new Date(y,m,d,h,mi) 사용.
     */
    function _parseTm(s) {
        if (!s) return null;
        var m = /^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/.exec(s);
        if (!m) return null;
        return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0).getTime();
    }

    /** epoch ms → "M.D HH:mm" (툴팁/라벨용). */
    function _fmtTmShort(ms) {
        var d = new Date(ms);
        var hh = String(d.getHours()).padStart(2, '0');
        var mi = String(d.getMinutes()).padStart(2, '0');
        return (d.getMonth() + 1) + '.' + d.getDate() + ' ' + hh + ':' + mi;
    }

    /** 시계열에서 date 에 가장 가까운 포인트의 raw v (없으면 null). */
    function _nearestValue(series, date) {
        if (!series || !series.length) return null;
        var target = (date instanceof Date ? date.getTime() : Date.now());
        var best = null, bestDiff = Infinity;
        for (var i = 0; i < series.length; i++) {
            var diff = Math.abs(series[i].tMs - target);
            if (diff < bestDiff) { bestDiff = diff; best = series[i]; }
        }
        return best ? best.v : null;
    }

    /** 시계열에서 date 에 가장 가까운 포인트 인덱스 (없으면 -1). */
    function _nearestIndex(series, date) {
        if (!series || !series.length) return -1;
        var target = (date instanceof Date ? date.getTime() : Date.now());
        var bestI = -1, bestDiff = Infinity;
        for (var i = 0; i < series.length; i++) {
            var diff = Math.abs(series[i].tMs - target);
            if (diff < bestDiff) { bestDiff = diff; bestI = i; }
        }
        return bestI;
    }

    // ─────────────────────────────────────────────────────────────
    // DOM / 스타일
    // ─────────────────────────────────────────────────────────────

    function _injectStyle() {
        if (_styleInjected) return;
        _styleInjected = true;
        var css =
            '#ocean-card-vsby-graph{display:none;flex-direction:column;gap:8px;'
          +   'background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);'
          +   'border-radius:12px;padding:12px;}'
          + '#ocean-card-vsby-graph .ovg-head{display:flex;align-items:center;gap:8px;}'
          + '#ocean-card-vsby-graph .ovg-head i{color:rgba(100,180,255,0.85);font-size:0.85rem;}'
          + '#ocean-card-vsby-graph .ovg-title{font-size:0.7rem;font-weight:600;'
          +   'color:rgba(100,180,255,0.85);}'
          + '#ocean-card-vsby-graph .ovg-now{margin-left:auto;font-size:0.72rem;'
          +   'font-weight:700;color:#fff;}'
          + '#ocean-card-vsby-graph .ovg-canvas-wrap{position:relative;width:100%;height:150px;}'
          + '#ocean-card-vsby-graph .ovg-empty{font-size:0.72rem;color:rgba(255,255,255,0.55);'
          +   'padding:14px 4px;text-align:center;}';
        var st = document.createElement('style');
        st.id = 'ocean-vsby-graph-style';
        st.textContent = css;
        document.head.appendChild(st);
    }

    /** 그래프 섹션 DOM 확보 (없으면 생성 + 그리드 뒤에 삽입). */
    function _ensureGraphSection() {
        var sec = document.getElementById('ocean-card-vsby-graph');
        if (sec) return sec;

        var grid = document.getElementById('ocean-cards-grid');
        var body = document.getElementById('ocean-sheet-body');
        if (!body) return null;

        _injectStyle();

        sec = document.createElement('div');
        sec.className = 'ocean-data-card ocean-card-fullwidth';
        sec.id = 'ocean-card-vsby-graph';
        sec.innerHTML =
            '<div class="ovg-head">'
          +   '<i class="fa-solid fa-eye"></i>'
          +   '<span class="ovg-title">시정 예보 (km)</span>'
          +   '<span class="ovg-now" id="ocean-vsby-graph-now"></span>'
          + '</div>'
          + '<div class="ovg-canvas-wrap"><canvas id="ocean-vsby-graph-canvas"></canvas></div>';

        // 그리드 바로 뒤에 삽입 (그리드가 있으면 nextSibling, 없으면 body 끝).
        if (grid && grid.parentNode === body) {
            body.insertBefore(sec, grid.nextSibling);
        } else {
            body.appendChild(sec);
        }
        return sec;
    }

    function _showGraph(visible) {
        var sec = document.getElementById('ocean-card-vsby-graph');
        if (sec) sec.style.display = visible ? 'flex' : 'none';
    }

    function _setNowLabel(text) {
        var el = document.getElementById('ocean-vsby-graph-now');
        if (el) el.textContent = text;
    }

    function _setCardValue(text) {
        if (OS.setCardValue) OS.setCardValue('ocean-val-vsby', text);
    }

    // ─────────────────────────────────────────────────────────────
    // Chart.js 그래프
    // ─────────────────────────────────────────────────────────────

    /** 현재 슬라이더 시각 인덱스를 세로 마커로 그리는 커스텀 플러그인. */
    var _markerPlugin = {
        id: 'ovgMarker',
        afterDatasetsDraw: function (chart) {
            var idx = chart.$ovgMarkerIdx;
            if (idx == null || idx < 0) return;
            var meta = chart.getDatasetMeta(0);
            if (!meta || !meta.data || !meta.data[idx]) return;
            var pt = meta.data[idx];
            var ctx = chart.ctx;
            var area = chart.chartArea;
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(pt.x, area.top);
            ctx.lineTo(pt.x, area.bottom);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = 'rgba(255,255,255,0.55)';
            ctx.setLineDash([4, 3]);
            ctx.stroke();
            ctx.setLineDash([]);
            // 마커 점
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#fff';
            ctx.strokeStyle = 'rgba(0,0,0,0.4)';
            ctx.lineWidth = 1.5;
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }
    };

    /**
     * 시계열로 차트를 (다시) 그린다.
     * @param {Array} series - [{ tMs, v(raw) }]
     * @param {number} markerIdx - 슬라이더 시각 인덱스 (마커 위치)
     */
    function _renderChart(series, markerIdx) {
        var canvas = document.getElementById('ocean-vsby-graph-canvas');
        if (!canvas || typeof Chart === 'undefined') return;

        var labels = [];
        var values = [];          // 클램프된 km (그래프 y)
        var pointColors = [];
        for (var i = 0; i < series.length; i++) {
            labels.push(series[i].tMs);
            var cv = _clamp(series[i].v);
            values.push(cv);
            pointColors.push(_colorFor(cv));
        }

        if (_chart) { _chart.destroy(); _chart = null; }

        var hasDL = (typeof ChartDataLabels !== 'undefined');
        var plugins = [_markerPlugin];
        if (hasDL) plugins.push(ChartDataLabels);

        _chart = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    data: values,
                    borderColor: 'rgba(100,180,255,0.9)',
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    pointHitRadius: 12,
                    pointBackgroundColor: pointColors,
                    tension: 0.25,
                    fill: false,
                    spanGaps: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                interaction: { mode: 'index', intersect: false },
                layout: { padding: { top: 16, right: 6, left: 2, bottom: 0 } },
                scales: {
                    y: {
                        min: 0,
                        max: VSBY_MAX,
                        ticks: {
                            stepSize: 5,
                            color: 'rgba(255,255,255,0.5)',
                            font: { size: 9 }
                        },
                        grid: { color: 'rgba(255,255,255,0.08)' }
                    },
                    x: {
                        type: 'category',
                        ticks: {
                            color: 'rgba(255,255,255,0.5)',
                            font: { size: 9 },
                            autoSkip: false,
                            maxRotation: 0,
                            minRotation: 0,
                            // 3시간 간격(매 3번째 포인트)에만 라벨, 나머지는 빈 문자열.
                            callback: function (val, index) {
                                if (index % 3 !== 0) return '';
                                var ms = labels[index];
                                return _fmtTmShort(ms);
                            }
                        },
                        grid: { display: false }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        displayColors: false,
                        callbacks: {
                            title: function (items) {
                                if (!items || !items.length) return '';
                                return _fmtTmShort(labels[items[0].dataIndex]);
                            },
                            label: function (item) {
                                return '시정 ' + _fmtVis(item.parsed.y);
                            }
                        }
                    },
                    // 3시간 간격 하단 km 라벨 — datalabels 플러그인으로 포인트 위에 표기.
                    datalabels: hasDL ? {
                        display: function (ctx) { return ctx.dataIndex % 3 === 0; },
                        align: 'top',
                        anchor: 'end',
                        offset: 2,
                        color: 'rgba(255,255,255,0.85)',
                        font: { size: 9, weight: '600' },
                        formatter: function (value) {
                            return value == null ? '' : _fmtNum(value);
                        }
                    } : undefined
                }
            },
            plugins: plugins
        });

        _chart.$ovgMarkerIdx = (markerIdx != null && markerIdx >= 0) ? markerIdx : null;
        _chart.update('none');
    }

    /** 기존 차트의 마커 인덱스만 옮김 (재생성 없이 슬라이더 동기). */
    function _moveMarker(markerIdx) {
        if (!_chart) return;
        _chart.$ovgMarkerIdx = (markerIdx != null && markerIdx >= 0) ? markerIdx : null;
        _chart.update('none');
    }

    // ─────────────────────────────────────────────────────────────
    // 공개 API
    // ─────────────────────────────────────────────────────────────

    /**
     * [공개 API] 시정 카드 + 그래프 로드.
     *
     * @param {number} lat  - 위도 (EPSG:4326)
     * @param {number} lon  - 경도
     * @param {Date}   date - 표시할 시각 (현재 readout/마커 위치)
     *
     * 동작:
     *   - 같은 좌표 + 시계열 캐시 보유 → fetch 없이 readout/마커만 갱신.
     *   - 좌표 변경 → /api/vsby-smallzone/point fetch → 그래프 + readout 갱신.
     *   - 실패/격자밖/데이터없음 → 카드 '정보 없음' + 그래프 섹션 숨김 (시트 다른 부분 영향 X).
     */
    OS.loadVsbyCard = function (lat, lon, date) {
        var card = document.getElementById('ocean-card-vsby');
        if (!card) return;

        if (lat == null || lon == null) {
            _setCardValue('정보 없음');
            _showGraph(false);
            return;
        }

        // 같은 좌표 + 시계열 보유 → 슬라이더 이동만 → 재요청 없이 readout/마커 갱신.
        var same = (_cache.series &&
                    Math.round(_cache.lat * 100000) === Math.round(lat * 100000) &&
                    Math.round(_cache.lon * 100000) === Math.round(lon * 100000));
        if (same) {
            _applyForDate(date);
            return;
        }

        // 새 좌표 — fetch.
        var token = ++_fetchToken;
        // 카드는 진행바 유지(5.js 가 reset), 그래프 섹션은 잠시 숨김 (직전 좌표 잔상 방지).
        _showGraph(false);

        fetch('/api/vsby-smallzone/point?lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (token !== _fetchToken) return;   // 더 새 fetch 시작 → 무시
                if (!data || !data.success || !data.series || !data.series.length) {
                    _cache.series = null;
                    _setCardValue('정보 없음');
                    _showGraph(false);
                    return;
                }
                // series → { tMs, v } 정규화 + 시간순 정렬.
                var norm = [];
                for (var i = 0; i < data.series.length; i++) {
                    var pt = data.series[i];
                    var ms = _parseTm(pt.t);
                    if (ms == null || pt.v == null || isNaN(pt.v)) continue;
                    norm.push({ tMs: ms, v: pt.v });
                }
                norm.sort(function (a, b) { return a.tMs - b.tMs; });
                if (!norm.length) {
                    _cache.series = null;
                    _setCardValue('정보 없음');
                    _showGraph(false);
                    return;
                }
                _cache.lat = lat;
                _cache.lon = lon;
                _cache.series = norm;

                _ensureGraphSection();
                var idx = _nearestIndex(norm, date);
                _renderChart(norm, idx);
                _showGraph(true);
                _applyForDate(date);   // readout + now 라벨 + 마커
            })
            .catch(function () {
                if (token !== _fetchToken) return;
                _cache.series = null;
                _setCardValue('정보 없음');
                _showGraph(false);
            });
    };

    /** 캐시된 시계열로 readout/마커/now 라벨만 date 에 맞춰 갱신. */
    function _applyForDate(date) {
        var series = _cache.series;
        if (!series || !series.length) {
            _setCardValue('정보 없음');
            _showGraph(false);
            return;
        }
        var raw = _nearestValue(series, date);
        var cv = _clamp(raw);
        _setCardValue(_fmtVis(cv));
        _setNowLabel(cv == null ? '' : _fmtVis(cv));
        _moveMarker(_nearestIndex(series, date));
    }

    /** [공개 API] 진행 중 fetch 무효화 + 그래프 숨김 (시트 닫힐 때). */
    OS.hideVsbyCard = function () {
        _fetchToken++;
        _cache.series = null;
        _cache.lat = null;
        _cache.lon = null;
        _showGraph(false);
        if (_chart) { _chart.destroy(); _chart = null; }
    };
})();
