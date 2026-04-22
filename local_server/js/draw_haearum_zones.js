/*
 * 해아름 특보구역 디지털화 도구 (개발자 전용)
 * -----------------------------------------------------------------
 * - 배경에 참조 이미지(스크린샷)를 깔고 그 위에 반투명 해아름 지도를
 *   오버레이 → 일치시켜서 특보구역 폴리곤을 경/위도로 찍는다.
 * - 해아름 지도는 KHOA WMS 타일(OpenLayers EPSG:3857)이므로
 *   좌표 변환은 OL의 getCoordinateFromPixel + toLonLat 로 해결.
 * - 결과는 경/위도 폴리곤 JSON (haearum_zone_polygons.json) 로 저장.
 * - 이 툴은 기존 파일을 수정하지 않는다.
 */
(function () {
    'use strict';

    // ============================================================
    // 상수
    // ============================================================
    var STORAGE_KEY     = 'haearum_zone_drawings';
    var HISTORY_MAX     = 80;
    var MAP_MIN_ZOOM    = 4;
    var MAP_MAX_ZOOM    = 20;
    var INITIAL_CENTER  = [127.0, 34.5];
    var INITIAL_ZOOM    = 7;

    // 1% 스케일 변화에 대응하는 OL zoom delta:
    //   zoom 1칸 = 2배 스케일 → log2(1.01) ≈ 0.01435
    var ZOOM_DELTA_1PCT  = Math.log(1.01) / Math.log(2);  // ≈ 0.01435
    var ZOOM_DELTA_5PCT  = Math.log(1.05) / Math.log(2);  // ≈ 0.07039
    var ZOOM_DELTA_10PCT = Math.log(1.10) / Math.log(2);  // ≈ 0.13750

    // WMS 엔드포인트 (ocean_map.js와 동일 구조)
    var WMS_URL        = '/api/ocean/khoa-wms';
    var WMS_LAYER_BASE = 'BASEMAP_RLTM3857';
    var WMS_LAYER_COAST = 'BASEMAP_RLTMCOAST3857';

    // ============================================================
    // 상태
    // ============================================================
    var map               = null;
    var baseLayer         = null;
    var coastLayer        = null;
    var vectorSource      = null;
    var vectorLayer       = null;
    var modifyInteraction = null;

    // zones: { [code]: { points: [[lon,lat], ...], center: [lon,lat]|null, closed: bool } }
    var zones            = {};
    var currentZoneCode  = null;
    var currentMode      = 'draw';
    var history          = { stack: [], idx: -1 };
    var bgTransform      = { x: 0, y: 0, scale: 1 };
    var bgDragState      = null;
    var suppressSaveOnce = false;

    // ============================================================
    // 유틸
    // ============================================================
    function $(id) { return document.getElementById(id); }
    function $$(sel) { return document.querySelectorAll(sel); }
    function toLonLat(coord3857) { return ol.proj.toLonLat(coord3857); }
    function fromLonLat(coordLL)  { return ol.proj.fromLonLat(coordLL); }
    function round6(v) { return Math.round(v * 1e6) / 1e6; }
    function fmt(n, d) {
        if (typeof n !== 'number' || !isFinite(n)) return '-';
        return n.toFixed(d == null ? 4 : d);
    }
    function showToast(msg, dur) {
        var t = $('toast');
        if (!t) return;
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(showToast._h);
        showToast._h = setTimeout(function () {
            t.classList.remove('show');
        }, dur || 1800);
    }
    function catalogEntries() {
        if (typeof SEA_ZONE_COORDINATES === 'undefined') return [];
        return Object.values(SEA_ZONE_COORDINATES);
    }
    function catalogByCode(code) {
        if (!code) return null;
        if (typeof SEA_ZONE_COORDINATES === 'undefined') return null;
        return SEA_ZONE_COORDINATES[code] || null;
    }
    function getZone(code) {
        if (!code) return null;
        if (!zones[code]) {
            zones[code] = { points: [], center: null, closed: false };
        }
        return zones[code];
    }

    // ============================================================
    // 스타일
    // ============================================================
    function pointStyle(idx) {
        return new ol.style.Style({
            image: new ol.style.Circle({
                radius: 5,
                fill: new ol.style.Fill({ color: '#4fc3f7' }),
                stroke: new ol.style.Stroke({ color: '#ffffff', width: 1.5 })
            }),
            text: new ol.style.Text({
                text: String(idx + 1),
                font: 'bold 10px sans-serif',
                offsetY: -12,
                fill: new ol.style.Fill({ color: '#ffffff' }),
                stroke: new ol.style.Stroke({ color: '#000000', width: 2 })
            })
        });
    }
    function polyStyle(closed) {
        return new ol.style.Style({
            stroke: new ol.style.Stroke({
                color: closed ? '#00e676' : '#4fc3f7',
                width: 2,
                lineDash: closed ? null : [6, 4]
            }),
            fill: new ol.style.Fill({
                color: closed ? 'rgba(0,230,118,0.18)' : 'rgba(79,195,247,0.10)'
            })
        });
    }
    function centerStyle() {
        return new ol.style.Style({
            image: new ol.style.Circle({
                radius: 9,
                fill: new ol.style.Fill({ color: '#ffb74d' }),
                stroke: new ol.style.Stroke({ color: '#ffffff', width: 2 })
            }),
            text: new ol.style.Text({
                text: '★',
                font: 'bold 12px sans-serif',
                fill: new ol.style.Fill({ color: '#000000' })
            })
        });
    }

    // ============================================================
    // 렌더 — zone 상태 → 벡터 피처
    // ============================================================
    function render() {
        if (!vectorSource) return;
        vectorSource.clear();

        var zone = currentZoneCode ? getZone(currentZoneCode) : null;

        if (zone) {
            // 점
            zone.points.forEach(function (pt, idx) {
                var f = new ol.Feature({ geometry: new ol.geom.Point(fromLonLat(pt)) });
                f.setStyle(pointStyle(idx));
                f.set('_kind', 'point');
                f.set('_index', idx);
                vectorSource.addFeature(f);
            });

            // 선/폴리곤
            if (zone.points.length >= 2) {
                var coords = zone.points.map(fromLonLat);
                if (zone.closed && zone.points.length >= 3) {
                    var ring = coords.concat([coords[0]]);
                    var pf = new ol.Feature({ geometry: new ol.geom.Polygon([ring]) });
                    pf.setStyle(polyStyle(true));
                    pf.set('_kind', 'polygon');
                    vectorSource.addFeature(pf);
                } else {
                    var lf = new ol.Feature({ geometry: new ol.geom.LineString(coords) });
                    lf.setStyle(polyStyle(false));
                    lf.set('_kind', 'line');
                    vectorSource.addFeature(lf);
                }
            }

            // 중앙점
            if (zone.center) {
                var cf = new ol.Feature({ geometry: new ol.geom.Point(fromLonLat(zone.center)) });
                cf.setStyle(centerStyle());
                cf.set('_kind', 'center');
                vectorSource.addFeature(cf);
            }
        }

        updateInfo();
        updateList();
        updateProgress();
        if (!suppressSaveOnce) saveStorage();
        suppressSaveOnce = false;
    }

    // ============================================================
    // History (Undo/Redo)
    // ============================================================
    function snapshot() {
        var snap = JSON.parse(JSON.stringify(zones));
        history.stack = history.stack.slice(0, history.idx + 1);
        history.stack.push(snap);
        if (history.stack.length > HISTORY_MAX) history.stack.shift();
        history.idx = history.stack.length - 1;
    }
    function undo() {
        if (history.idx <= 0) { showToast('더 이상 Undo할 수 없습니다'); return; }
        history.idx--;
        zones = JSON.parse(JSON.stringify(history.stack[history.idx]));
        render();
    }
    function redo() {
        if (history.idx >= history.stack.length - 1) { showToast('더 이상 Redo할 수 없습니다'); return; }
        history.idx++;
        zones = JSON.parse(JSON.stringify(history.stack[history.idx]));
        render();
    }

    // ============================================================
    // 구역 리스트 / 정보 패널
    // ============================================================
    function buildZoneList() {
        var list = $('zone-list');
        if (!list) return;
        list.innerHTML = '';
        var byRegion = {};
        catalogEntries().forEach(function (z) {
            if (!byRegion[z.region]) byRegion[z.region] = [];
            byRegion[z.region].push(z);
        });
        var regionOrder = ['동해북부', '동해중부', '동해남부', '남해동부', '남해서부',
                           '서해남부', '서해중부', '서해북부', '제주'];
        var regions = Object.keys(byRegion).sort(function (a, b) {
            var ia = regionOrder.indexOf(a), ib = regionOrder.indexOf(b);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        });
        regions.forEach(function (region) {
            var grp = document.createElement('div');
            grp.className = 'region-group';
            var title = document.createElement('div');
            title.className = 'region-name';
            title.textContent = region + ' (' + byRegion[region].length + ')';
            grp.appendChild(title);
            byRegion[region].forEach(function (z) {
                var item = document.createElement('div');
                item.className = 'zone-item';
                item.dataset.code = z.code;
                item.innerHTML =
                    '<span class="zone-icon"></span>' +
                    '<span class="zone-label">' + z.name + '</span>';
                item.addEventListener('click', function () { selectZone(z.code); });
                grp.appendChild(item);
            });
            list.appendChild(grp);
        });
        updateList();
    }
    function updateList() {
        var items = $$('#zone-list .zone-item');
        items.forEach(function (it) {
            var code = it.dataset.code;
            var z = zones[code];
            var ptCount = (z && z.points && z.points.length) || 0;
            var done = !!(z && z.closed && ptCount >= 3);
            it.classList.remove('active', 'status-done', 'status-progress', 'status-empty');
            if (code === currentZoneCode) it.classList.add('active');
            var icon = it.querySelector('.zone-icon');
            if (done) {
                it.classList.add('status-done');
                if (icon) icon.textContent = '✓';
            } else if (ptCount > 0 || (z && z.center)) {
                it.classList.add('status-progress');
                if (icon) icon.textContent = '⏳';
            } else {
                it.classList.add('status-empty');
                if (icon) icon.textContent = '○';
            }
        });
    }
    function selectZone(code) {
        currentZoneCode = code;
        getZone(code);
        suppressSaveOnce = true; // 단순 선택은 저장 트리거 아님
        render();
        var info = catalogByCode(code);
        if (info && typeof info.lon === 'number' && typeof info.lat === 'number' && map) {
            map.getView().animate({ center: fromLonLat([info.lon, info.lat]), duration: 300 });
        }
    }
    function updateInfo() {
        var z = currentZoneCode ? zones[currentZoneCode] : null;
        var info = catalogByCode(currentZoneCode);
        $('cur-name').textContent   = info ? info.name : '-';
        $('cur-code').textContent   = currentZoneCode || '-';
        $('cur-region').textContent = info ? info.region : '-';
        $('cur-points').textContent = (z && z.points && z.points.length) || 0;
        $('cur-center').textContent = (z && z.center)
            ? (fmt(z.center[0]) + ', ' + fmt(z.center[1]))
            : '없음';
        $('cur-closed').textContent = z && z.closed ? '✓ 닫힘' : '열림';
    }
    function updateProgress() {
        var total = catalogEntries().length;
        var done = 0;
        Object.keys(zones).forEach(function (code) {
            var z = zones[code];
            if (z && z.closed && z.points && z.points.length >= 3) done++;
        });
        $('progress-text').textContent = done + ' / ' + total;
        $('progress-fill').style.width = total > 0 ? Math.round(done / total * 100) + '%' : '0%';
    }

    // ============================================================
    // 모드
    // ============================================================
    function setMode(mode) {
        currentMode = mode;
        $$('.mode-btn').forEach(function (b) {
            b.classList.toggle('active', b.dataset.mode === mode);
        });
        var hints = {
            'align' : '🎯 정렬 · 드래그=배경 이동, 휠=배경 확대/축소',
            'draw'  : '✏️ 점 찍기 · 지도 클릭으로 점 추가',
            'edit'  : '🔧 편집 · 점 드래그=이동, 클릭=삭제',
            'center': '⭐ 중앙점 · 지도 클릭으로 중앙점 배치'
        };
        $('mode-hint').textContent = hints[mode] || '';

        // 정렬 모드에서만 배경 이미지가 마우스 이벤트를 먹는다
        var wrap = $('bg-image-wrap');
        if (wrap) wrap.style.pointerEvents = (mode === 'align') ? 'auto' : 'none';

        if (modifyInteraction) modifyInteraction.setActive(mode === 'edit');
    }

    // ============================================================
    // 지도 클릭 처리
    // ============================================================
    function handleMapClick(evt) {
        if (currentMode === 'align') return; // 정렬 모드에서는 점을 찍지 않음 (배경만 다룸)
        if (!currentZoneCode) {
            showToast('먼저 구역을 선택해주세요');
            return;
        }
        var ll = toLonLat(evt.coordinate);
        var lon = round6(ll[0]);
        var lat = round6(ll[1]);
        var zone = getZone(currentZoneCode);

        if (currentMode === 'draw') {
            if (zone.closed) {
                showToast('폴리곤이 닫혀있습니다 — [열기]를 눌러주세요');
                return;
            }
            zone.points.push([lon, lat]);
            snapshot();
            render();
        } else if (currentMode === 'center') {
            zone.center = [lon, lat];
            snapshot();
            render();
        } else if (currentMode === 'edit') {
            // 점 클릭 시 삭제 확인 (드래그는 Modify 인터랙션이 담당)
            var pointFeat = null;
            map.forEachFeatureAtPixel(evt.pixel, function (f) {
                if (!pointFeat && f.get('_kind') === 'point') pointFeat = f;
            }, { hitTolerance: 6 });
            if (pointFeat) {
                var idx = pointFeat.get('_index');
                if (confirm('점 #' + (idx + 1) + '을 삭제할까요?')) {
                    zone.points.splice(idx, 1);
                    snapshot();
                    render();
                }
            }
        }
    }

    // ============================================================
    // Modify (edit 모드에서 점 드래그)
    // ============================================================
    function setupModify() {
        modifyInteraction = new ol.interaction.Modify({
            source: vectorSource,
            pixelTolerance: 8
        });
        modifyInteraction.setActive(false);
        modifyInteraction.on('modifyend', function () {
            var zone = currentZoneCode ? getZone(currentZoneCode) : null;
            if (!zone) return;
            vectorSource.getFeatures().forEach(function (f) {
                var kind = f.get('_kind');
                if (kind === 'point') {
                    var idx = f.get('_index');
                    var ll = toLonLat(f.getGeometry().getCoordinates());
                    zone.points[idx] = [round6(ll[0]), round6(ll[1])];
                } else if (kind === 'center') {
                    var cll = toLonLat(f.getGeometry().getCoordinates());
                    zone.center = [round6(cll[0]), round6(cll[1])];
                }
            });
            snapshot();
            render();
        });
        map.addInteraction(modifyInteraction);
    }

    // ============================================================
    // localStorage
    // ============================================================
    function saveStorage() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                updatedAt: new Date().toISOString(),
                zones: zones
            }));
        } catch (e) { /* noop */ }
    }
    function loadStorage() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            var obj = JSON.parse(raw);
            if (obj && obj.zones && typeof obj.zones === 'object') zones = obj.zones;
        } catch (e) { zones = {}; }
    }

    // ============================================================
    // JSON Export
    // ============================================================
    function buildExportJSON() {
        var out = {
            map: 'haearum',
            schema: 'v1',
            updatedAt: new Date().toISOString(),
            zones: {}
        };
        catalogEntries().forEach(function (c) {
            var z = zones[c.code];
            if (!z) return;
            var hasPts = z.points && z.points.length > 0;
            if (!hasPts && !z.center) return;
            out.zones[c.code] = {
                code: c.code,
                name: c.name,
                region: c.region,
                type: c.type,
                points: z.points || [],
                center: z.center || null,
                closed: !!z.closed
            };
        });
        return out;
    }
    function exportPreview() {
        $('json-preview').value = JSON.stringify(buildExportJSON(), null, 2);
        showToast('JSON 미리보기 갱신됨');
    }
    function exportDownload() {
        var text = JSON.stringify(buildExportJSON(), null, 2);
        var blob = new Blob([text], { type: 'application/json' });
        var url  = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'haearum_zone_polygons.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        showToast('JSON 파일 다운로드 완료');
    }
    function exportCopy() {
        var text = JSON.stringify(buildExportJSON(), null, 2);
        var ta = $('json-preview');
        ta.value = text;
        var done = function () { showToast('JSON이 클립보드에 복사되었습니다'); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, function () {
                ta.select(); document.execCommand('copy'); done();
            });
        } else {
            ta.select(); document.execCommand('copy'); done();
        }
    }

    // ============================================================
    // 배경 이미지
    // ============================================================
    function applyBgTransform() {
        var img = $('bg-image');
        if (!img) return;
        img.style.transform =
            'translate(' + bgTransform.x + 'px, ' + bgTransform.y + 'px) scale(' + bgTransform.scale + ')';
    }
    function loadBgImage(file) {
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (e) {
            var img = $('bg-image');
            img.src = e.target.result;
            img.style.display = 'block';
            // 이미지 로드 완료 후 화면 중앙에 배치
            img.onload = function () {
                var wrap = $('bg-image-wrap');
                var ww = wrap.clientWidth;
                var wh = wrap.clientHeight;
                var iw = img.naturalWidth;
                var ih = img.naturalHeight;
                // 화면에 맞도록 스케일 조정 (긴 축 기준)
                var fitScale = Math.min(ww / iw, wh / ih, 1);
                var scaledW = iw * fitScale;
                var scaledH = ih * fitScale;
                bgTransform = {
                    x: (ww - scaledW) / 2,
                    y: (wh - scaledH) / 2,
                    scale: fitScale
                };
                applyBgTransform();
            };
            showToast('배경 이미지 로드 완료 · [A: 정렬] 모드에서 위치/크기를 맞춰주세요');
        };
        reader.readAsDataURL(file);
    }
    function setupBgInteractions() {
        var wrap = $('bg-image-wrap');
        if (!wrap) return;
        wrap.addEventListener('mousedown', function (e) {
            if (currentMode !== 'align') return;
            bgDragState = { x: e.clientX, y: e.clientY, sx: bgTransform.x, sy: bgTransform.y };
            e.preventDefault();
        });
        window.addEventListener('mousemove', function (e) {
            if (!bgDragState) return;
            bgTransform.x = bgDragState.sx + (e.clientX - bgDragState.x);
            bgTransform.y = bgDragState.sy + (e.clientY - bgDragState.y);
            applyBgTransform();
        });
        window.addEventListener('mouseup', function () { bgDragState = null; });

        wrap.addEventListener('wheel', function (e) {
            if (currentMode !== 'align') return;
            e.preventDefault();
            var old = bgTransform.scale;
            var factor = e.shiftKey ? (e.deltaY > 0 ? 0.95 : 1.05) : (e.deltaY > 0 ? 0.99 : 1.01);
            var ns = Math.max(0.05, Math.min(20, old * factor));
            var rect = wrap.getBoundingClientRect();
            var cx = e.clientX - rect.left;
            var cy = e.clientY - rect.top;
            // 커서를 중심으로 스케일
            bgTransform.x = cx - (cx - bgTransform.x) * (ns / old);
            bgTransform.y = cy - (cy - bgTransform.y) * (ns / old);
            bgTransform.scale = ns;
            applyBgTransform();
        }, { passive: false });
    }

    // ============================================================
    // 지도 초기화
    // ============================================================
    function makeKhoaLayer(layerName, opacity) {
        return new ol.layer.Tile({
            source: new ol.source.TileWMS({
                url: WMS_URL,
                params: {
                    'layer': layerName,
                    'SERVICE': 'WMS',
                    'VERSION': '1.1.1',
                    'REQUEST': 'GetMap',
                    'FORMAT': 'image/png',
                    'TRANSPARENT': true,
                    'STYLES': '',
                    'LAYERS': '',
                    'SRS': 'EPSG:3857'
                },
                projection: 'EPSG:3857',
                crossOrigin: 'anonymous'
            }),
            opacity: opacity
        });
    }

    function initMap() {
        baseLayer  = makeKhoaLayer(WMS_LAYER_BASE, 0.55);
        coastLayer = makeKhoaLayer(WMS_LAYER_COAST, 0.75);

        vectorSource = new ol.source.Vector();
        vectorLayer  = new ol.layer.Vector({ source: vectorSource });

        map = new ol.Map({
            target: 'map-container',
            layers: [baseLayer, coastLayer, vectorLayer],
            view: new ol.View({
                center: fromLonLat(INITIAL_CENTER),
                zoom: INITIAL_ZOOM,
                minZoom: MAP_MIN_ZOOM,
                maxZoom: MAP_MAX_ZOOM,
                constrainResolution: false,
                smoothResolutionConstraint: false
            }),
            controls: ol.control.defaults.defaults({ zoom: false, rotate: false }),
            interactions: ol.interaction.defaults.defaults({ mouseWheelZoom: false })
        });

        // --- 1% 단위 미세 휠 줌 (해아름 지도) ---
        //   기본 1틱 = 1% 스케일 변화 (≈ 0.01435 zoom)
        //   Shift+휠 = 5%
        //   Alt+휠   = 10%
        $('map-container').addEventListener('wheel', function (e) {
            e.preventDefault();
            var view = map.getView();
            var delta = ZOOM_DELTA_1PCT;
            if (e.shiftKey) delta = ZOOM_DELTA_5PCT;
            if (e.altKey)   delta = ZOOM_DELTA_10PCT;
            var sign = (e.deltaY > 0) ? -1 : +1;

            // 커서 기준 줌 (anchor)
            var anchor = map.getEventCoordinate(e);
            var res    = view.getResolution();
            var z0     = view.getZoom();
            var z1     = Math.max(MAP_MIN_ZOOM, Math.min(MAP_MAX_ZOOM, z0 + sign * delta));
            if (z1 === z0) return;
            var resFactor = Math.pow(2, z0 - z1); // 새 해상도 / 기존 해상도
            var newRes    = res * resFactor;
            var center    = view.getCenter();
            var cx = anchor[0] + (center[0] - anchor[0]) * (newRes / res);
            var cy = anchor[1] + (center[1] - anchor[1]) * (newRes / res);
            view.setZoom(z1);
            view.setCenter([cx, cy]);
            syncZoomUI();
        }, { passive: false });

        // 클릭
        map.on('click', handleMapClick);

        // 커서 좌표 + 줌 표시
        map.on('pointermove', function (evt) {
            if (evt.dragging) return;
            var ll = toLonLat(evt.coordinate);
            $('cursor-coord').textContent =
                'lon: ' + fmt(ll[0]) + ', lat: ' + fmt(ll[1]) +
                '  ·  zoom: ' + fmt(map.getView().getZoom(), 2);
        });

        // 뷰 변경 → 줌 UI 동기화
        map.getView().on('change:resolution', syncZoomUI);

        setupModify();
    }

    function syncZoomUI() {
        var z = map.getView().getZoom();
        var zv = $('zoom-val');
        var zs = $('zoom-slider');
        if (zv) zv.textContent = fmt(z, 2);
        if (zs && document.activeElement !== zs) {
            zs.value = String(z);
        }
    }

    function nudgeZoom(delta) {
        var view = map.getView();
        var z0 = view.getZoom();
        var z1 = Math.max(MAP_MIN_ZOOM, Math.min(MAP_MAX_ZOOM, z0 + delta));
        view.setZoom(z1);
        syncZoomUI();
    }

    // ============================================================
    // 컨트롤 바인딩
    // ============================================================
    function initControls() {
        // 배경 이미지
        $('bg-upload').addEventListener('change', function (e) {
            if (e.target.files && e.target.files[0]) loadBgImage(e.target.files[0]);
        });
        $('btn-bg-reset').addEventListener('click', function () {
            bgTransform = { x: 0, y: 0, scale: 1 };
            applyBgTransform();
        });
        $('btn-bg-clear').addEventListener('click', function () {
            var img = $('bg-image');
            img.src = '';
            img.style.display = 'none';
        });

        // 불투명도
        $('opacity-map').addEventListener('input', function (e) {
            var v = parseInt(e.target.value, 10);
            $('opacity-map-val').textContent = v + '%';
            if (baseLayer)  baseLayer.setOpacity(v / 100);
            if (coastLayer) coastLayer.setOpacity(Math.min(1, (v / 100) * 1.3));
        });
        $('opacity-bg').addEventListener('input', function (e) {
            var v = parseInt(e.target.value, 10);
            $('opacity-bg-val').textContent = v + '%';
            $('bg-image').style.opacity = v / 100;
        });

        // 미세 줌
        $('zoom-slider').addEventListener('input', function (e) {
            var z = parseFloat(e.target.value);
            map.getView().setZoom(z);
            $('zoom-val').textContent = fmt(z, 2);
        });
        $('btn-zoom-m10').addEventListener('click', function () { nudgeZoom(-ZOOM_DELTA_10PCT); });
        $('btn-zoom-m1') .addEventListener('click', function () { nudgeZoom(-ZOOM_DELTA_1PCT);  });
        $('btn-zoom-p1') .addEventListener('click', function () { nudgeZoom(+ZOOM_DELTA_1PCT);  });
        $('btn-zoom-p10').addEventListener('click', function () { nudgeZoom(+ZOOM_DELTA_10PCT); });
        $('btn-zoom-reset').addEventListener('click', function () {
            map.getView().setZoom(INITIAL_ZOOM);
            syncZoomUI();
        });

        // 모드 버튼
        $$('.mode-btn').forEach(function (b) {
            b.addEventListener('click', function () { setMode(b.dataset.mode); });
        });

        // 키보드 단축키
        document.addEventListener('keydown', function (e) {
            var tag = e.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            var k = e.key.toLowerCase();
            if (k === 'a')      { setMode('align');  e.preventDefault(); }
            else if (k === 'd') { setMode('draw');   e.preventDefault(); }
            else if (k === 'e') { setMode('edit');   e.preventDefault(); }
            else if (k === 'c') { setMode('center'); e.preventDefault(); }
            else if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
            else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (e.shiftKey && k === 'z'))) { e.preventDefault(); redo(); }
        });

        // 현재 구역 버튼
        $('btn-close-poly').addEventListener('click', function () {
            var z = currentZoneCode ? getZone(currentZoneCode) : null;
            if (!z) { showToast('먼저 구역을 선택해주세요'); return; }
            if (z.points.length < 3) { showToast('3점 이상 필요합니다'); return; }
            z.closed = true;
            snapshot(); render();
            showToast('폴리곤 닫힘');
        });
        $('btn-open-poly').addEventListener('click', function () {
            var z = currentZoneCode ? getZone(currentZoneCode) : null;
            if (!z) return;
            z.closed = false;
            snapshot(); render();
        });
        $('btn-undo').addEventListener('click', undo);
        $('btn-redo').addEventListener('click', redo);
        $('btn-clear-zone').addEventListener('click', function () {
            if (!currentZoneCode) { showToast('먼저 구역을 선택해주세요'); return; }
            if (!confirm('현재 구역의 모든 점/중앙점을 삭제할까요?')) return;
            zones[currentZoneCode] = { points: [], center: null, closed: false };
            snapshot(); render();
        });

        // 내보내기
        $('btn-preview').addEventListener('click', exportPreview);
        $('btn-download').addEventListener('click', exportDownload);
        $('btn-copy').addEventListener('click', exportCopy);
        $('btn-reset-all').addEventListener('click', function () {
            if (!confirm('전체 작업을 초기화합니다 (localStorage 포함). 계속할까요?')) return;
            zones = {};
            try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
            history = { stack: [], idx: -1 };
            snapshot();
            render();
            showToast('전체 초기화 완료');
        });
    }

    // ============================================================
    // 초기화
    // ============================================================
    function init() {
        if (typeof ol === 'undefined') {
            alert('OpenLayers 라이브러리를 로드하지 못했습니다.');
            return;
        }
        loadStorage();
        initMap();
        initControls();
        setupBgInteractions();
        buildZoneList();
        setMode('draw');
        snapshot();
        render();
        syncZoomUI();
        console.log('[DrawHaearumZones] 초기화 완료 · 구역 수:', catalogEntries().length);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
