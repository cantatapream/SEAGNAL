/**
 * ============================================================================
 * 파일명: client/js/admin/admin_zone_editor.js
 * 역할  : 통합관리자센터 "구역 편집" 탭 — 출입통제구역(access_control_zones.json) 중
 *         자동판독·곡선보간이라 확신도가 낮아 "editable:true"로 표시해 둔 구역만
 *         지도 위에서 점을 드래그·추가·삭제·곡선화하고 결과를 내보낸다/서버에 저장한다.
 *         이미 원문 좌표로 확정된(editable 없음) 구역은 지도에 참고용으로만 보이고
 *         선택(클릭)은 막는다 — 실수로 검증 끝난 데이터를 건드리지 않기 위함.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : admin.js(switchUnifiedAdminTab, adminAwareFetch), ocean_map.js(window.oceanCreateKhoaLayer), OpenLayers(ol.*)
 *  - 서버 API      : GET /access_control_zones.json(정적) · POST /api/admin/access-control-zones(저장, routes/admin.js)
 *  - 마크업        : admin.js 의 tabs 배열에 {id:'zone-editor', ...} 추가돼 있어야 switchUnifiedAdminTab 이 이 파일의
 *                    renderUnifiedZoneEditorContent(body) 를 호출한다
 *  - 나를 쓰는 곳  : admin.js switchUnifiedAdminTab() — tabId === 'zone-editor' 분기
 * [로드 순서] admin.js 다음 (admin.js 의 adminAwareFetch 래핑을 그대로 이용 — X-Admin-Token 자동 첨부)
 * ============================================================================
 */

(function () {
    'use strict';

    var DATA_URL = '/access_control_zones.json';

    var _map = null;
    var _source = null;          // 전체 구역(편집가능+확정) 공용 source
    var _selectedFeature = null; // 현재 선택된(편집 가능) feature
    var _modify = null;          // ol.interaction.Modify — 선택된 feature 1개에만 적용
    var _undoStack = [];         // 선택된 feature 의 좌표 스냅샷(JSON 문자열) 배열
    var _deleteMode = false;
    var _curveMode = false;
    var _curveSel = [];          // 곡선화 대상으로 클릭한 좌표 인덱스(최대 2개)
    var _markerSource = null;    // 곡선화 선택 표시용 임시 마커

    function _isEditable(feature) {
        return feature.get('editable') === true;
    }

    /** 편집가능/확정 구역을 다르게 그리는 스타일. 곡선화 선택 좌표는 별도 marker layer로 표시. */
    function _zoneStyle(feature) {
        var editable = _isEditable(feature);
        var isSelected = feature === _selectedFeature;
        return new ol.style.Style({
            stroke: new ol.style.Stroke({
                color: editable ? (isSelected ? 'rgba(255, 214, 0, 0.95)' : 'rgba(255, 82, 82, 0.9)') : 'rgba(148, 163, 184, 0.55)',
                width: isSelected ? 3 : 2
            }),
            fill: new ol.style.Fill({
                color: editable ? 'rgba(255, 82, 82, 0.15)' : 'rgba(148, 163, 184, 0.08)'
            }),
            text: new ol.style.Text({
                text: feature.get('location') || '',
                font: 'bold 11px sans-serif',
                fill: new ol.style.Fill({ color: editable ? '#ffe58a' : '#94a3b8' }),
                stroke: new ol.style.Stroke({ color: 'rgba(0,0,0,0.85)', width: 3 }),
                overflow: true
            })
        });
    }

    function _markerStyle() {
        return new ol.style.Style({
            image: new ol.style.Circle({
                radius: 7,
                fill: new ol.style.Fill({ color: '#facc15' }),
                stroke: new ol.style.Stroke({ color: '#1e293b', width: 2 })
            })
        });
    }

    function _setStatus(msg) {
        var el = document.getElementById('ace-status');
        if (el) el.textContent = msg;
    }

    function _refreshUndoBtn() {
        var btn = document.getElementById('ace-undo-btn');
        if (btn) btn.disabled = _undoStack.length === 0;
    }

    /** 현재 선택된 feature 의 좌표를 스냅샷으로 저장(실행취소용) */
    function _pushUndo() {
        if (!_selectedFeature) return;
        var coords = _selectedFeature.getGeometry().getCoordinates();
        _undoStack.push(JSON.stringify(coords));
        if (_undoStack.length > 30) _undoStack.shift();
        _refreshUndoBtn();
    }

    function _undo() {
        if (!_selectedFeature || !_undoStack.length) return;
        var snap = JSON.parse(_undoStack.pop());
        _selectedFeature.getGeometry().setCoordinates(snap);
        _refreshUndoBtn();
        _setStatus('실행취소 완료');
    }

    /** ring/line 좌표 배열을 꺼낸다 (Polygon 은 외곽 ring[0], LineString 은 그대로) */
    function _getFlatCoords(feature) {
        var geom = feature.getGeometry();
        return geom.getType() === 'Polygon' ? geom.getCoordinates()[0] : geom.getCoordinates();
    }
    function _setFlatCoords(feature, coords) {
        var geom = feature.getGeometry();
        if (geom.getType() === 'Polygon') geom.setCoordinates([coords]);
        else geom.setCoordinates(coords);
    }

    /** 지도 픽셀 좌표에서 가장 가까운 vertex 인덱스 (map 좌표계 거리 기준, tolerance px 이내만) */
    function _nearestVertexIndex(map, pixel, feature, tolerancePx) {
        var coords = _getFlatCoords(feature);
        var best = -1, bestDist = Infinity;
        for (var i = 0; i < coords.length; i++) {
            var p = map.getPixelFromCoordinate(coords[i]);
            if (!p) continue;
            var dx = p[0] - pixel[0], dy = p[1] - pixel[1];
            var d = Math.sqrt(dx * dx + dy * dy);
            if (d < bestDist) { bestDist = d; best = i; }
        }
        if (bestDist > (tolerancePx || 14)) return -1;
        return best;
    }

    /** 점 삭제 — Polygon 은 최소 4개(3점+닫힘), LineString 은 최소 2개 유지 */
    function _deleteVertex(feature, idx) {
        var coords = _getFlatCoords(feature);
        var isPolygon = feature.getGeometry().getType() === 'Polygon';
        var minLen = isPolygon ? 4 : 2;
        if (coords.length <= minLen) {
            _setStatus('더 이상 점을 지울 수 없습니다(최소 점 수)');
            return;
        }
        _pushUndo();
        var isClosingPoint = isPolygon && (idx === 0 || idx === coords.length - 1);
        coords.splice(idx, 1);
        if (isClosingPoint) {
            // 폴리곤 시작/끝(닫힘 중복점)을 지웠으면 새 시작점을 마지막에도 복제해 닫힌 링 유지
            coords[coords.length - 1] = coords[0].slice();
        }
        _setFlatCoords(feature, coords);
        _setStatus('점을 삭제했습니다 (' + coords.length + '개 남음)');
    }

    /** 두 인접 좌표 사이에 완만한 호(quadratic bezier)를 그리는 점 N개를 보간해 끼워 넣는다 */
    function _curveifySegment(feature, i, j) {
        var coords = _getFlatCoords(feature);
        // i, j 가 인접(연속) 하도록 정렬 — 폴리곤 닫힘 구간(처음-끝)도 인접으로 취급
        var lo = Math.min(i, j), hi = Math.max(i, j);
        var wrap = (lo === 0 && hi === coords.length - 1);
        if (!wrap && hi - lo !== 1) {
            _setStatus('인접한 두 점만 곡선화할 수 있습니다');
            return;
        }
        _pushUndo();
        var p1 = wrap ? coords[hi] : coords[lo];
        var p2 = wrap ? coords[lo] : coords[hi];
        var insertAt = wrap ? coords.length - 1 : lo + 1; // wrap 이면 마지막(닫힘점) 앞에 삽입
        var mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2;
        var dx = p2[0] - p1[0], dy = p2[1] - p1[1];
        // 진행방향에 수직으로 20% 만큼 살짝 부풀린 완만한 곡선 — 이후 사용자가 각 점을 드래그해 실제 해안선에 맞춤
        var nx = -dy, ny = dx;
        var bulge = 0.2;
        var cx = mx + nx * bulge, cy = my + ny * bulge; // 2차 베지어 제어점
        var N = 6;
        var newPts = [];
        for (var k = 1; k <= N; k++) {
            var t = k / (N + 1);
            var x = (1 - t) * (1 - t) * p1[0] + 2 * (1 - t) * t * cx + t * t * p2[0];
            var y = (1 - t) * (1 - t) * p1[1] + 2 * (1 - t) * t * cy + t * t * p2[1];
            newPts.push([x, y]);
        }
        coords.splice.apply(coords, [insertAt, 0].concat(newPts));
        _setFlatCoords(feature, coords);
        _setStatus(N + '개 점을 추가해 곡선화했습니다 — 각 점을 드래그해 실제 해안선에 맞춰보세요');
    }

    function _clearCurveSelection() {
        _curveSel = [];
        if (_markerSource) _markerSource.clear();
        var applyBtn = document.getElementById('ace-curve-apply-btn');
        if (applyBtn) applyBtn.disabled = true;
    }

    function _onMapClick(evt) {
        if (!_selectedFeature) return;
        var map = _map;
        if (_deleteMode) {
            var idx = _nearestVertexIndex(map, evt.pixel, _selectedFeature, 14);
            if (idx >= 0) _deleteVertex(_selectedFeature, idx);
            return;
        }
        if (_curveMode) {
            var idx2 = _nearestVertexIndex(map, evt.pixel, _selectedFeature, 14);
            if (idx2 < 0) return;
            if (_curveSel.indexOf(idx2) !== -1) return;
            _curveSel.push(idx2);
            if (_curveSel.length > 2) _curveSel = [_curveSel[1], idx2];
            var coords = _getFlatCoords(_selectedFeature);
            _markerSource.clear();
            _curveSel.forEach(function (ci) {
                _markerSource.addFeature(new ol.Feature(new ol.geom.Point(coords[ci])));
            });
            var applyBtn = document.getElementById('ace-curve-apply-btn');
            if (applyBtn) applyBtn.disabled = _curveSel.length !== 2;
            _setStatus('곡선화할 두 점을 선택 중 (' + _curveSel.length + '/2)');
        }
    }

    function _selectZone(feature) {
        _selectedFeature = feature;
        _deleteMode = false;
        _curveMode = false;
        _clearCurveSelection();
        _undoStack = [];
        _refreshUndoBtn();

        document.querySelectorAll('.ace-zone-btn').forEach(function (b) {
            b.classList.toggle('active', b.dataset.idx === String(feature.get('_idx')));
        });
        var deleteBtn = document.getElementById('ace-delete-btn');
        var curveBtn = document.getElementById('ace-curve-btn');
        if (deleteBtn) { deleteBtn.disabled = false; deleteBtn.classList.remove('active'); }
        if (curveBtn) { curveBtn.disabled = false; curveBtn.classList.remove('active'); }

        if (_modify) { _map.removeInteraction(_modify); _modify = null; }
        _modify = new ol.interaction.Modify({ features: new ol.Collection([feature]) });
        _modify.on('modifystart', function () { _pushUndo(); });
        _map.addInteraction(_modify);

        var extent = feature.getGeometry().getExtent();
        _map.getView().fit(extent, { padding: [60, 60, 60, 60], maxZoom: 19, duration: 250 });
        _source.changed();
        _setStatus('"' + feature.get('location') + '" 선택됨 — 점을 드래그하거나 구간을 드래그하면 점이 추가됩니다');
    }

    function _toggleDeleteMode() {
        _deleteMode = !_deleteMode;
        _curveMode = false; _clearCurveSelection();
        document.getElementById('ace-delete-btn').classList.toggle('active', _deleteMode);
        document.getElementById('ace-curve-btn').classList.toggle('active', false);
        _setStatus(_deleteMode ? '점 삭제 모드 — 지울 점을 지도에서 클릭하세요' : '점 삭제 모드 해제');
    }
    function _toggleCurveMode() {
        _curveMode = !_curveMode;
        _deleteMode = false;
        document.getElementById('ace-curve-btn').classList.toggle('active', _curveMode);
        document.getElementById('ace-delete-btn').classList.toggle('active', false);
        if (!_curveMode) _clearCurveSelection();
        _setStatus(_curveMode ? '곡선화 모드 — 인접한 두 점을 순서대로 클릭하세요' : '곡선화 모드 해제');
    }
    function _applyCurve() {
        if (_curveSel.length !== 2) return;
        _curveifySegment(_selectedFeature, _curveSel[0], _curveSel[1]);
        _clearCurveSelection();
    }

    /** 전체 source 를 원본 스키마 그대로(EPSG:4326, 소수 6자리) GeoJSON 으로 직렬화 */
    function _buildExportGeoJson() {
        var features = _source.getFeatures();
        var fmt = new ol.format.GeoJSON();
        var obj = fmt.writeFeaturesObject(features, {
            featureProjection: 'EPSG:3857',
            dataProjection: 'EPSG:4326'
        });
        obj.features.forEach(function (f, i) {
            var round = function (c) {
                if (typeof c[0] === 'number') return [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6];
                return c.map(round);
            };
            f.geometry.coordinates = round(f.geometry.coordinates);
            delete f.properties._idx; // 내부용 인덱스는 내보내지 않음
        });
        return obj;
    }

    function _exportDownload() {
        var obj = _buildExportGeoJson();
        var blob = new Blob([JSON.stringify(obj, null, 1) + '\n'], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = 'access_control_zones.json';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        _setStatus('access_control_zones.json 다운로드 완료');
    }

    function _saveToServer() {
        var obj = _buildExportGeoJson();
        _setStatus('서버에 저장 중…');
        fetch('/api/admin/access-control-zones', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(obj)
        }).then(function (res) { return res.json().then(function (j) { return { ok: res.ok, j: j }; }); })
          .then(function (r) {
              if (r.ok) {
                  _setStatus('서버 저장 완료(' + r.j.count + '개 구역) — 이 서버가 즉시 반영됩니다. 운영 배포는 git 커밋·푸시가 별도로 필요합니다.');
              } else {
                  _setStatus('저장 실패: ' + (r.j.error || '알 수 없는 오류'));
              }
          })
          .catch(function (e) { _setStatus('저장 실패: ' + e.message); });
    }

    function _buildSidebarHtml(features) {
        var editable = features.filter(_isEditable);
        var locked = features.filter(function (f) { return !_isEditable(f); });

        function stationGroups(list) {
            var order = [], map = {};
            list.forEach(function (f) {
                var s = f.get('station');
                if (!map[s]) { map[s] = []; order.push(s); }
                map[s].push(f);
            });
            return order.map(function (s) { return { station: s, items: map[s] }; });
        }

        var html = '<div class="ace-sidebar-section"><h4><i class="fa-solid fa-pen-to-square"></i> 재검토 필요 (' + editable.length + ')</h4>';
        stationGroups(editable).forEach(function (g) {
            html += '<div class="ace-station">' + g.station.replace('해양경찰서', '') + '</div>';
            g.items.forEach(function (f) {
                html += '<button class="ace-zone-btn" data-idx="' + f.get('_idx') + '">' +
                    '<span>' + f.get('location') + '</span>' +
                    '<span class="ace-reason">' + (f.get('edit_reason') || '') + '</span></button>';
            });
        });
        html += '</div><div class="ace-sidebar-section"><h4><i class="fa-solid fa-lock"></i> 확정됨 — 선택 불가 (' + locked.length + ')</h4>';
        stationGroups(locked).forEach(function (g) {
            html += '<div class="ace-station">' + g.station.replace('해양경찰서', '') + '</div>';
            g.items.forEach(function (f) {
                html += '<div class="ace-zone-locked"><i class="fa-solid fa-lock"></i> ' + f.get('location') + '</div>';
            });
        });
        html += '</div>';
        return html;
    }

    /** [외부 API] admin.js switchUnifiedAdminTab() 에서 tabId==='zone-editor' 일 때 호출 */
    window.renderUnifiedZoneEditorContent = function (body) {
        // 탭 재진입 시 이전 상태 초기화
        _map = null; _source = null; _selectedFeature = null; _modify = null;
        _undoStack = []; _deleteMode = false; _curveMode = false; _curveSel = [];

        body.innerHTML =
            '<div class="ace-wrap">' +
            '  <div class="ace-sidebar" id="ace-sidebar"><p style="padding:16px;color:#94a3b8;">불러오는 중…</p></div>' +
            '  <div class="ace-main">' +
            '    <div class="ace-toolbar">' +
            '      <button id="ace-delete-btn" class="ace-tool-btn" disabled title="지도에서 점을 클릭하면 삭제"><i class="fa-solid fa-eraser"></i> 점 삭제 모드</button>' +
            '      <button id="ace-curve-btn" class="ace-tool-btn" disabled title="인접한 두 점을 클릭 → 사이 구간을 곡선으로"><i class="fa-solid fa-bezier-curve"></i> 곡선화</button>' +
            '      <button id="ace-curve-apply-btn" class="ace-tool-btn" disabled><i class="fa-solid fa-check"></i> 곡선화 적용</button>' +
            '      <button id="ace-undo-btn" class="ace-tool-btn" disabled><i class="fa-solid fa-rotate-left"></i> 실행취소</button>' +
            '      <span style="flex:1"></span>' +
            '      <button id="ace-export-btn" class="ace-tool-btn primary"><i class="fa-solid fa-download"></i> 내보내기</button>' +
            '      <button id="ace-save-btn" class="ace-tool-btn primary"><i class="fa-solid fa-server"></i> 서버에 저장</button>' +
            '    </div>' +
            '    <div id="ace-status" class="ace-status">구역을 선택하세요(왼쪽 목록 · 재검토 필요 항목만 클릭 가능)</div>' +
            '    <div id="ace-map" class="ace-map"></div>' +
            '  </div>' +
            '</div>';

        if (!document.getElementById('ace-editor-style')) {
            var style = document.createElement('style');
            style.id = 'ace-editor-style';
            style.textContent =
                '.ace-wrap{display:flex;gap:12px;height:640px;}' +
                '.ace-sidebar{width:260px;flex:none;overflow-y:auto;background:#0f172a;border-radius:10px;border:1px solid rgba(255,255,255,0.08);}' +
                '.ace-sidebar-section h4{color:#e2e8f0;font-size:0.82rem;margin:0;padding:12px 12px 6px;}' +
                '.ace-station{color:#64748b;font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:8px 12px 2px;}' +
                '.ace-zone-btn{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:calc(100% - 16px);margin:2px 8px;padding:7px 10px;' +
                'background:rgba(255,82,82,0.12);border:1px solid rgba(255,120,120,0.35);border-radius:8px;color:#ffe0e0;font-size:0.78rem;font-weight:600;cursor:pointer;text-align:left;}' +
                '.ace-zone-btn:hover{background:rgba(255,82,82,0.22);}' +
                '.ace-zone-btn.active{background:rgba(255,214,0,0.22);border-color:#ffd600;color:#fff9db;}' +
                '.ace-zone-btn .ace-reason{font-size:0.66rem;font-weight:400;color:#cbd5e1;opacity:0.8;}' +
                '.ace-zone-locked{display:flex;align-items:center;gap:6px;width:calc(100% - 16px);margin:2px 8px;padding:7px 10px;color:#64748b;font-size:0.78rem;}' +
                '.ace-main{flex:1;display:flex;flex-direction:column;gap:8px;min-width:0;}' +
                '.ace-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}' +
                '.ace-tool-btn{padding:7px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:#1e293b;color:#e2e8f0;font-size:0.78rem;font-weight:600;cursor:pointer;}' +
                '.ace-tool-btn:disabled{opacity:0.4;cursor:not-allowed;}' +
                '.ace-tool-btn.active{background:#3b82f6;border-color:#3b82f6;color:#fff;}' +
                '.ace-tool-btn.primary{background:rgba(59,130,246,0.18);border-color:#3b82f6;color:#bfdbfe;}' +
                '.ace-status{font-size:0.78rem;color:#94a3b8;padding:2px 4px;min-height:1.2em;}' +
                '.ace-map{flex:1;border-radius:10px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);}';
            document.head.appendChild(style);
        }

        fetch(DATA_URL).then(function (r) { return r.json(); }).then(function (geojson) {
            var mapEl = document.getElementById('ace-map');
            if (!mapEl) return; // 탭이 이미 전환됨

            var baseLayer = (typeof window.oceanCreateKhoaLayer === 'function')
                ? window.oceanCreateKhoaLayer('BASEMAP_RLTM3857')
                : new ol.layer.Tile({ source: new ol.source.OSM() });
            baseLayer.setVisible(true);

            _source = new ol.source.Vector();
            _markerSource = new ol.source.Vector();

            var zoneLayer = new ol.layer.Vector({ source: _source, style: _zoneStyle });
            var markerLayer = new ol.layer.Vector({ source: _markerSource, style: _markerStyle });

            _map = new ol.Map({
                target: mapEl,
                layers: [baseLayer, zoneLayer, markerLayer],
                view: new ol.View({ center: ol.proj.fromLonLat([127.8, 36.2]), zoom: 6.5, maxZoom: 19 }),
                controls: ol.control.defaults.defaults({ attribution: true })
            });

            var features = new ol.format.GeoJSON().readFeatures(geojson, {
                dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857'
            });
            features.forEach(function (f, i) { f.set('_idx', i); });
            _source.addFeatures(features);

            var sidebar = document.getElementById('ace-sidebar');
            if (sidebar) sidebar.innerHTML = _buildSidebarHtml(features);
            sidebar.querySelectorAll('.ace-zone-btn').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var idx = parseInt(btn.dataset.idx, 10);
                    var f = features.filter(function (ff) { return ff.get('_idx') === idx; })[0];
                    if (f) _selectZone(f);
                });
            });

            _map.on('singleclick', _onMapClick);

            document.getElementById('ace-delete-btn').addEventListener('click', _toggleDeleteMode);
            document.getElementById('ace-curve-btn').addEventListener('click', _toggleCurveMode);
            document.getElementById('ace-curve-apply-btn').addEventListener('click', _applyCurve);
            document.getElementById('ace-undo-btn').addEventListener('click', _undo);
            document.getElementById('ace-export-btn').addEventListener('click', _exportDownload);
            document.getElementById('ace-save-btn').addEventListener('click', _saveToServer);

            var editableFeatures = features.filter(_isEditable);
            if (editableFeatures.length) {
                var extent = ol.extent.createEmpty();
                editableFeatures.forEach(function (f) { ol.extent.extend(extent, f.getGeometry().getExtent()); });
                _map.getView().fit(extent, { padding: [40, 40, 40, 40], maxZoom: 12 });
            }
        }).catch(function (err) {
            var sidebar = document.getElementById('ace-sidebar');
            if (sidebar) sidebar.innerHTML = '<p style="padding:16px;color:#fca5a5;">로드 실패: ' + err.message + '</p>';
        });
    };
})();
