/**
 * ============================================================================
 * 파일명: client/js/pc-layout/pc_alert_map.js
 * 역할  : PC 화면 「특보 및 전망」 가운데 칸의 특보 전용 지도(해양종합정보 지도와 따로 논다).
 *         해역별 특보구역을 앱과 같은 색(초록 풍랑·빨강 태풍 + 단계 무늬)으로 칠하고, 왼쪽 특보 카드를 누르면 그 해역으로 간다.
 *         해양종합정보 지도와는 상태를 하나도 나누지 않는다(그 지도의 층·저장값·켜짐을 건드리지 않는다).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : ocean-map/warnings/ocean_warn_zone.js(OceanWarnZone.loadFeatures·onlyFill·onlyStrokeAndText·
 *                    getMainZoneName·normalizeZoneName) · ocean-map/warnings/ocean_warn_active3.js(OceanWarnActive._styleAlways) ·
 *                    ocean-map/warnings/ocean_warn_active5.js(OceanWarnActive.refresh — 색칠 표를 다시 만든다) ·
 *                    ocean-map/map/ocean_map.js(window.oceanCreateKhoaLayer — 배경지도) ·
 *                    zoneOverlayConfig.js(ZONE_OVERLAY_CONFIG) · forecast/alerts/marine.js(pixelToGps) — 해역 중심 좌표,
 *                    ocean_warn_zone.js flashWarnZone 과 같은 찾기 · OpenLayers(ol.*)
 *  - 서버 API      : GET /api/warn-zones · GET /api/warn-zones-sub (routes/weather.js — OceanWarnZone.loadFeatures 가 부른다)
 *  - 마크업        : index2.html #weather-alert-section(여기에 #pc-alert-map·#pc-alert-legend·#pc-alert-note 를 붙인다)
 *  - 나를 쓰는 곳  : js/pc-layout/pc_layout.js(_afterTab → ensure · 특보 카드 누름 → focus)
 * [로드 순서] js/ocean-map/menu/ocean_menu.js 다음 · js/pc-layout/pc_layout.js 이전 — 순서 변경 금지
 * ============================================================================
 */
(function () {
    'use strict';

    // 점검으로 막히면 구역을 그리지 않는 기능 id(관리자 점검 목록 — index2.html applyFeatureBlocks)
    var BLOCK_IDS = ['weather-alert', 'ov-warn-zone', 'ov-warn-active', 'main-ocean'];

    var _map = null, _view = null, _fitted = false;

    var _loading = false;   // 특보구역을 받는 중인가(_load)
    var _mainSrc = null, _subSrc = null, _hiSrc = null;
    var _zoneLayers = [];        // 구역 층 5개(색칠 2 · 선+이름 2 · 고른 구역 테두리)

    /** 범례 표 — 앱의 특보 범례(ocean_warn_active4.js _renderLegend)와 같은 마크업. 색은 index2.html 의 .wal-swatch 규칙이 칠한다 */
    function _legendHtml() {
        var stages = ['upcoming', 'watch', 'warn'];
        var row = function (type, label) {
            var h = '<tr data-type="' + type + '"><th>' + label + '</th>';
            stages.forEach(function (s) { h += '<td><span class="wal-swatch" data-stage="' + s + '"></span></td>'; });
            return h + '</tr>';
        };
        return '<table class="warn-active-legend-table"><thead><tr><th></th><th>발표</th><th>주의보</th><th>경보</th></tr></thead><tbody>' +
            row('wave', '풍랑') + row('typhoon', '태풍') + '</tbody></table>';
    }

    /** 구역 층 하나를 만든다. 예: _layer(src, 40, f => …)  @param {ol.source.Vector} src @param {number} z @param {Function} style @returns {ol.layer.Vector} */
    function _layer(src, z, style) {
        return new ol.layer.Vector({ source: src, zIndex: z, style: style, updateWhileAnimating: false, updateWhileInteracting: false });
    }

    /**
     * 처음 한 번만 — 지도 칸에 크기가 생겼고 구역이 들어와 있으면 구역 전체가 보이게 맞춘다.
     * 예: 1200 폭(지도 칸 360px)에서도 바다 양 끝이 잘리지 않게
     * [연계] ← ensure()·loadFeatures 끝 / 크기가 0(해상일기도를 보는 중)이면 다음 ensure() 때 다시 한다
     */
    function _fitOnce() {
        if (_fitted || !_map) return;
        var size = _map.getSize();
        if (!size || !(size[0] > 0) || !(size[1] > 0) || !_mainSrc.getFeatures().length) return;
        _view.fit(_mainSrc.getExtent(), { padding: [20, 20, 20, 20] });
        _fitted = true;
    }

    /**
     * 점검 여부를 보고 구역을 켜거나 끄고, 켜져 있으면 색칠을 지금 특보로 다시 맞춘다.
     * 예: _blockedFeatures=['ov-warn-zone'] → 구역 층 꺼짐 + 「특보구역 표시는 점검 중입니다」
     * [연계] ← ensure()·'seagnal:alerts-changed' / → OceanWarnActive.refresh(ocean_warn_active5.js)
     */
    function refresh() {
        if (!_map) return;
        var blocked = Array.isArray(window._blockedFeatures) && window._blockedFeatures.some(function (id) { return BLOCK_IDS.indexOf(id) >= 0; });
        if (blocked) {
            var admin = false;
            try { admin = localStorage.getItem('seagnal_admin_mode') === 'true'; } catch (e) { admin = false; /* 저장소를 못 읽으면 일반 기기로 본다 — 막힌 것을 보여 주지 않는 쪽 */ }
            if (admin) blocked = false;
        }
        var note = document.getElementById('pc-alert-note');
        _zoneLayers.forEach(function (l) { l.setVisible(!blocked); });
        if (blocked) {
            if (note) { note.textContent = '특보구역 표시는 점검 중입니다'; note.hidden = false; }
            return;
        }
        if (note) note.hidden = true;
        if (window.OceanWarnActive && typeof window.OceanWarnActive.refresh === 'function') window.OceanWarnActive.refresh();
        _zoneLayers.slice(0, 4).forEach(function (l) { l.changed(); });
    }

    /**
     * 특보구역 경계를 받아 지도에 넣는다. 받는 중이면 겹쳐 부르지 않는다. 실패하면 다음 ensure() 때 다시 받는다.
     * 예: 첫 요청이 끊김 → 빈 지도 → 다른 탭에 갔다 돌아오면 다시 받아 그린다
     * [연계] ← ensure() / → OceanWarnZone.loadFeatures(ocean_warn_zone.js)
     */
    function _load() {
        if (_loading) return;
        _loading = true;
        window.OceanWarnZone.loadFeatures().then(function (r) {
            _loading = false;
            _mainSrc.addFeatures(r.main); _subSrc.addFeatures(r.sub); _fitOnce();
        }).catch(function (e) { _loading = false; console.warn('[pc-alert-map] 특보구역을 받지 못했습니다', e && e.message); });
    }

    /**
     * 「특보 및 전망」 화면이 보일 때 부른다 — 처음이면 지도를 만들고, 있으면 칸 크기와 색을 다시 맞춘다.
     * 예: PcAlertMap.ensure() → #pc-alert-map 에 배경지도 + 특보구역 4층 + 고른 구역 테두리
     * [연계] ← js/pc-layout/pc_layout.js _afterTab / → OceanWarnZone.loadFeatures(ocean_warn_zone.js)·refresh()
     */
    function ensure() {
        if (_map) { _map.updateSize(); refresh(); _fitOnce(); if (!_mainSrc.getFeatures().length) _load(); return; }   // 구역을 못 받았으면 화면에 돌아올 때 다시 받는다
        var sec = document.getElementById('weather-alert-section');
        if (!sec || typeof ol === 'undefined' || !window.OceanWarnZone || !window.OceanWarnActive) return;
        var el = document.createElement('div'); el.id = 'pc-alert-map';
        var legend = document.createElement('div'); legend.id = 'pc-alert-legend'; legend.innerHTML = _legendHtml();
        var note = document.createElement('div'); note.id = 'pc-alert-note'; note.hidden = true;
        sec.appendChild(el); sec.appendChild(legend); sec.appendChild(note);

        var layers = [];
        try {
            var base = window.oceanCreateKhoaLayer('BASEMAP_RLTMCOAST3857');
            base.setVisible(true);
            layers.push(base);
        } catch (e) { console.warn('[pc-alert-map] 배경지도 없이 구역만 그립니다', e); }

        var Z = window.OceanWarnZone, A = window.OceanWarnActive;
        _mainSrc = new ol.source.Vector(); _subSrc = new ol.source.Vector(); _hiSrc = new ol.source.Vector();
        _zoneLayers = [
            _layer(_mainSrc, 40, function (f) { return Z.onlyFill(A._styleAlways(f, 'main')); }),
            _layer(_subSrc, 41, function (f) { return Z.onlyFill(A._styleAlways(f, 'sub')); }),
            _layer(_mainSrc, 80, function (f) { return Z.onlyStrokeAndText(A._styleAlways(f, 'main')); }),
            _layer(_subSrc, 81, function (f) { return Z.onlyStrokeAndText(A._styleAlways(f, 'sub')); }),
            _layer(_hiSrc, 90, new ol.style.Style({ stroke: new ol.style.Stroke({ color: 'rgba(255,200,80,.95)', width: 2.5 }) }))
        ];
        _view = new ol.View({ center: ol.proj.fromLonLat([127.8, 36.0]), zoom: 6.3, minZoom: 5, maxZoom: 11 });
        _map = new ol.Map({
            target: 'pc-alert-map',
            layers: layers.concat(_zoneLayers),
            view: _view,
            controls: ol.control.defaults.defaults({ zoom: true, rotate: false, attribution: false }).extend([new ol.control.Attribution({ collapsible: false })])
        });
        _load();
        window.addEventListener('seagnal:alerts-changed', refresh);
        refresh();
    }

    /**
     * 그 해역의 부모 특보구역으로 지도를 옮기고 노란 테두리로 표시한다. 못 찾으면 아무 일도 없다.
     * 예: focus('울산앞바다') → 그 중심 좌표를 품은 「남해동부앞바다」 구역에 맞춤
     * @param {string} zoneName - 특보 카드의 해역 이름(자식·다른 이름이어도 된다)
     * [연계] ← js/pc-layout/pc_layout.js _onAlertCardClick / 찾는 법은 ocean_warn_zone.js flashWarnZone 과 같다
     */
    function focus(zoneName) {
        if (!_map) return;
        var feats = _mainSrc.getFeatures(), f = null, coord = null;
        try {
            if (typeof ZONE_OVERLAY_CONFIG !== 'undefined' && typeof pixelToGps === 'function') {
                var cfg = ZONE_OVERLAY_CONFIG[zoneName];
                var gps = cfg && cfg.center ? pixelToGps(cfg.center.x, cfg.center.y) : null;
                if (gps && gps.lat != null && gps.lon != null) coord = ol.proj.fromLonLat([gps.lon, gps.lat]);
            }
        } catch (e) { coord = null; /* 좌표 표가 없으면 이름으로만 찾는다 */ }
        var i;
        if (coord) {
            for (i = 0; i < feats.length && !f; i++) {
                var g = feats[i].getGeometry();
                if (g && typeof g.intersectsCoordinate === 'function' && g.intersectsCoordinate(coord)) f = feats[i];
            }
        }
        if (!f) {
            var target = window.OceanWarnZone.normalizeZoneName(zoneName);
            for (i = 0; i < feats.length && !f; i++) if (window.OceanWarnZone.getMainZoneName(feats[i]) === target) f = feats[i];
        }
        if (!f) return;
        _view.fit(f.getGeometry().getExtent(), { padding: [60, 60, 60, 60], maxZoom: 9, duration: 400 });
        _hiSrc.clear();
        _hiSrc.addFeature(new ol.Feature(f.getGeometry()));
    }

    window.PcAlertMap = { ensure: ensure, focus: focus, refresh: refresh };
})();
