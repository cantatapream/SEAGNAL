/**
 * ============================================================================
 * 파일명: client/js/admin/admin_zone_editor.js
 * 역할  : 출입통제구역(access_control_zones.json) 폴리곤 점 편집기 — 독립 페이지
 *         (admin_zone_editor.html)에서 직접 실행된다. 자동판독·곡선보간이라
 *         확신도가 낮아 "editable:true"로 표시해 둔 구역만 지도 위에서 점을
 *         드래그·추가·삭제·곡선화하고 결과를 내보낸다/서버에 저장한다.
 *         이미 원문 좌표로 확정된(editable 없음) 구역은 참고용으로만 보이고
 *         선택은 막는다. 같은 구역 안에서도 원문에 정확한 경위도가 적혀 있던
 *         점(confirmed_vertices)은 편집가능 구역이라도 드래그·삭제·곡선화를
 *         막아 실수로 검증된 좌표를 건드리지 않게 한다. 우측 패널에는 그
 *         구역의 원본 고시 이미지(source_images)를 보여줘 지도와 대조하며
 *         점을 맞출 수 있다. 배경지도는 벡터(해아름) / 위성(브이월드) 전환 가능.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 마크업        : admin_zone_editor.html (이 파일을 직접 로드)
 *  - 사용하는 파일 : ocean-map/map/ocean_map.js(window.oceanCreateKhoaLayer·
 *                    window.oceanCreateVworldLayer), OpenLayers(ol.*)
 *  - 서버 API      : GET /access_control_zones.json(정적) ·
 *                    POST /api/admin/login(토큰 발급) ·
 *                    POST /api/admin/access-control-zones(저장, routes/admin.js —
 *                    X-Admin-Token 헤더 필요, 이 파일이 직접 첨부)
 *  - 나를 쓰는 곳  : admin.js 의 "구역 편집" 탭 버튼이 이 페이지를 새 창으로 연다
 *                    (더 이상 관리자센터 모달 안에서 렌더링되지 않음)
 * ============================================================================
 */

(function () {
    'use strict';

    var DATA_URL = '/access_control_zones.json';
    var TOKEN_KEY = 'seagnal_admin_token';

    var _map = null;
    var _source = null;          // 전체 구역(편집가능+확정) 공용 source
    var _selectedFeature = null; // 현재 선택된(편집 가능) feature
    var _modify = null;          // ol.interaction.Modify — 선택된 feature 1개에만 적용
    var _undoStack = [];         // 선택된 feature 의 좌표 스냅샷(JSON 문자열) 배열
    var _deleteMode = false;
    var _curveMode = false;
    var _curveSel = [];          // 곡선화 대상으로 클릭한 좌표 인덱스(최대 2개)
    var _markerSource = null;    // 곡선화 선택 표시용 임시 마커
    var _vertexMarkerSource = null; // 선택된 feature 의 점마다 잠김/편집가능 색으로 찍는 마커
    var _satellite = false;      // 배경지도: false=해아름 벡터, true=브이월드 위성
    var _khoaLayer = null;
    var _vworldLayer = null;

    // ========================================================================
    // 인증 — 독립 페이지라 index2.html 의 관리자센터 로그인 모달을 못 빌려 쓴다.
    // localStorage/sessionStorage 는 도메인 공용이라, 메인 앱에서 이미 로그인
    //했으면 토큰을 그대로 재사용한다(재로그인 불필요).
    // ========================================================================

    function _getToken() {
        try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || null; }
        catch (e) { return null; }
    }
    function _saveToken(token) {
        try { localStorage.setItem(TOKEN_KEY, token); } catch (e) { /* private mode 등 무시 */ }
    }

    /** /api/admin/* 호출에 토큰을 자동 첨부하는 fetch 래퍼(admin.js 의 adminAwareFetch 와 동일 패턴) */
    function _adminFetch(url, opts) {
        opts = opts || {};
        var token = _getToken();
        if (token && url.indexOf('/api/admin/') !== -1) {
            var headers = new Headers(opts.headers || {});
            headers.set('X-Admin-Token', token);
            opts.headers = headers;
        }
        return fetch(url, opts);
    }

    function _showLoginGate() {
        var gate = document.getElementById('ace-login-gate');
        var app = document.getElementById('ace-app');
        if (app) app.style.display = 'none';
        if (!gate) return;
        gate.style.display = 'flex';
        gate.innerHTML =
            '<div class="ace-login-box">' +
            '  <h2><i class="fa-solid fa-draw-polygon"></i> 구역 편집 — 관리자 로그인</h2>' +
            '  <input type="password" id="ace-login-pw" placeholder="관리자 비밀번호" autocomplete="current-password">' +
            '  <label class="ace-login-remember"><input type="checkbox" id="ace-login-remember" checked> 이 기기에서 기억</label>' +
            '  <button id="ace-login-btn">로그인</button>' +
            '  <p id="ace-login-err" class="ace-login-err"></p>' +
            '</div>';
        var pwInput = document.getElementById('ace-login-pw');
        var doLogin = function () {
            var pw = pwInput.value;
            if (!pw) return;
            fetch('/api/admin/login', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pw, longTerm: document.getElementById('ace-login-remember').checked })
            }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
              .then(function (res) {
                  if (res.ok && res.j.token) { _saveToken(res.j.token); _init(); }
                  else document.getElementById('ace-login-err').textContent = res.j.error || '로그인 실패';
              })
              .catch(function (e) { document.getElementById('ace-login-err').textContent = e.message; });
        };
        document.getElementById('ace-login-btn').addEventListener('click', doLogin);
        pwInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
        pwInput.focus();
    }

    function _isEditable(feature) {
        return feature.get('editable') === true;
    }

    /** idx 번째 점이 원문에 정확한 경위도가 있어 고정된 점인지 */
    function _isVertexConfirmed(feature, idx) {
        var confirmed = feature.get('confirmed_vertices');
        return Array.isArray(confirmed) && confirmed.indexOf(idx) !== -1;
    }

    /** 편집가능/확정 구역을 다르게 그리는 스타일. 라벨은 그대로 OL 스타일에 둔다(적은 개수라 겹침 걱정 없음). */
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

    /** 선택된 feature 의 점마다 잠김(파랑)/편집가능(노랑) 색으로 작은 원을 찍는 스타일 함수 */
    function _vertexMarkerStyle(feature) {
        var locked = feature.get('_locked') === true;
        return new ol.style.Style({
            image: new ol.style.Circle({
                radius: 5,
                fill: new ol.style.Fill({ color: locked ? '#38bdf8' : '#facc15' }),
                stroke: new ol.style.Stroke({ color: '#0f172a', width: 1.5 })
            })
        });
    }

    function _refreshVertexMarkers() {
        _vertexMarkerSource.clear();
        if (!_selectedFeature) return;
        var coords = _getFlatCoords(_selectedFeature);
        coords.forEach(function (c, i) {
            var pt = new ol.Feature(new ol.geom.Point(c));
            pt.set('_locked', _isVertexConfirmed(_selectedFeature, i));
            _vertexMarkerSource.addFeature(pt);
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
        _refreshVertexMarkers();
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

    /** 점 삭제 — Polygon 은 최소 4개(3점+닫힘), LineString 은 최소 2개 유지. 원문 확정 점은 삭제 불가 */
    function _deleteVertex(feature, idx) {
        if (_isVertexConfirmed(feature, idx)) {
            _setStatus('원문에 정확한 경위도가 있는 점입니다 — 삭제할 수 없습니다');
            return;
        }
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
        _refreshVertexMarkers();
        _setStatus('점을 삭제했습니다 (' + coords.length + '개 남음)');
    }

    /** 두 인접 좌표 사이에 완만한 호(quadratic bezier)를 그리는 점 N개를 보간해 끼워 넣는다.
     *  두 점 중 하나라도 원문 확정 점이면 막지 않는다(확정 점 자체는 안 움직이고 그 "사이"에
     *  점을 추가하는 것뿐이라 안전 — 단, 두 확정 점 사이를 곡선화하면 원문이 직선이라고 명시한
     *  구간을 곡선으로 바꾸는 셈이라 확인 메시지를 띄운다) */
    function _curveifySegment(feature, i, j) {
        var coords = _getFlatCoords(feature);
        var lo = Math.min(i, j), hi = Math.max(i, j);
        var wrap = (lo === 0 && hi === coords.length - 1);
        if (!wrap && hi - lo !== 1) {
            _setStatus('인접한 두 점만 곡선화할 수 있습니다');
            return;
        }
        if (_isVertexConfirmed(feature, i) && _isVertexConfirmed(feature, j)) {
            _setStatus('두 점 모두 원문 확정 점입니다 — 그 사이는 원문이 직선으로 명시한 구간일 수 있으니 신중히 확인하세요(곡선화는 계속 진행됩니다)');
        }
        _pushUndo();
        var p1 = wrap ? coords[hi] : coords[lo];
        var p2 = wrap ? coords[lo] : coords[hi];
        var insertAt = wrap ? coords.length - 1 : lo + 1; // wrap 이면 마지막(닫힘점) 앞에 삽입
        var mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2;
        var dx = p2[0] - p1[0], dy = p2[1] - p1[1];
        var nx = -dy, ny = dx;
        var bulge = 0.2;
        var cx = mx + nx * bulge, cy = my + ny * bulge;
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
        _refreshVertexMarkers();
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

    /** 우측 패널에 이 구역의 원문 고시 이미지를 보여준다(source_images 없으면 안내만) */
    function _renderSourceImages(feature) {
        var panel = document.getElementById('ace-source-panel');
        if (!panel) return;
        var imgs = feature.get('source_images');
        var reason = feature.get('edit_reason') || '';
        var note = feature.get('note') || '';
        var html = '<div class="ace-source-head">' +
            '<h4>' + (feature.get('location') || '') + ' — 원문 이미지</h4>' +
            (reason ? '<p class="ace-source-reason"><i class="fa-solid fa-triangle-exclamation"></i> ' + reason + '</p>' : '') +
            '</div>';
        if (Array.isArray(imgs) && imgs.length) {
            html += imgs.map(function (src) {
                return '<img class="ace-source-img" src="' + src + '" loading="lazy">';
            }).join('');
        } else {
            html += '<p class="ace-source-empty">이 구역은 확보된 원문 이미지가 없습니다. 지명·주소 기반 추정 위치이니 실제 위성지도와 대조해 직접 조정해주세요.</p>';
        }
        if (note) html += '<p class="ace-source-note">' + note + '</p>';
        panel.innerHTML = html;
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
        _modify = new ol.interaction.Modify({
            features: new ol.Collection([feature]),
            // 원문에 정확한 경위도가 있어 고정된 점은 드래그 시작 자체를 막는다
            condition: function (evt) {
                if (!ol.events.condition.primaryAction(evt)) return false;
                var idx = _nearestVertexIndex(_map, evt.pixel, feature, 12);
                if (idx >= 0 && _isVertexConfirmed(feature, idx)) {
                    _setStatus('원문에 정확한 경위도가 있는 점입니다 — 고정되어 움직이지 않습니다');
                    return false;
                }
                return true;
            }
        });
        _modify.on('modifystart', function () { _pushUndo(); });
        _modify.on('modifyend', function () { _refreshVertexMarkers(); });
        _map.addInteraction(_modify);

        _refreshVertexMarkers();
        _renderSourceImages(feature);

        var extent = feature.getGeometry().getExtent();
        _map.getView().fit(extent, { padding: [60, 60, 60, 60], maxZoom: 19, duration: 250 });
        _source.changed();
        _setStatus('"' + feature.get('location') + '" 선택됨 — 파란 점은 원문 확정(고정), 노란 점은 드래그 가능');
    }

    function _toggleDeleteMode() {
        _deleteMode = !_deleteMode;
        _curveMode = false; _clearCurveSelection();
        document.getElementById('ace-delete-btn').classList.toggle('active', _deleteMode);
        document.getElementById('ace-curve-btn').classList.toggle('active', false);
        _setStatus(_deleteMode ? '점 삭제 모드 — 지울 점을 지도에서 클릭하세요(파란 점은 삭제 불가)' : '점 삭제 모드 해제');
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

    /** 배경지도를 해아름 벡터 ↔ 브이월드 위성으로 전환한다(고시 원문 이미지와 대조하려면
     *  실제 지형이 보이는 위성지도가 필요 — 벡터 지도만으로는 해안선 곡선을 맞추기 어렵다) */
    function _toggleSatellite() {
        _satellite = !_satellite;
        if (_khoaLayer) _khoaLayer.setVisible(!_satellite);
        if (_vworldLayer) _vworldLayer.setVisible(_satellite);
        var btn = document.getElementById('ace-satellite-btn');
        if (btn) btn.classList.toggle('active', _satellite);
    }

    /** 전체 source 를 원본 스키마 그대로(EPSG:4326, 소수 6자리) GeoJSON 으로 직렬화 */
    function _buildExportGeoJson() {
        var features = _source.getFeatures();
        var fmt = new ol.format.GeoJSON();
        var obj = fmt.writeFeaturesObject(features, {
            featureProjection: 'EPSG:3857',
            dataProjection: 'EPSG:4326'
        });
        obj.features.forEach(function (f) {
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
        _adminFetch('/api/admin/access-control-zones', {
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

    function _init() {
        var gate = document.getElementById('ace-login-gate');
        var app = document.getElementById('ace-app');
        if (gate) gate.style.display = 'none';
        if (app) app.style.display = 'flex';

        // 탭 재진입(뒤로가기 등) 대비 이전 상태 초기화
        _map = null; _source = null; _selectedFeature = null; _modify = null;
        _undoStack = []; _deleteMode = false; _curveMode = false; _curveSel = []; _satellite = false;

        fetch(DATA_URL).then(function (r) { return r.json(); }).then(function (geojson) {
            var mapEl = document.getElementById('ace-map');
            if (!mapEl) return;

            _khoaLayer = (typeof window.oceanCreateKhoaLayer === 'function')
                ? window.oceanCreateKhoaLayer('BASEMAP_RLTM3857')
                : new ol.layer.Tile({ source: new ol.source.OSM() });
            _khoaLayer.setVisible(true);

            _vworldLayer = (typeof window.oceanCreateVworldLayer === 'function')
                ? window.oceanCreateVworldLayer('Satellite')
                : new ol.layer.Tile({ source: new ol.source.OSM() });
            _vworldLayer.setVisible(false);

            _source = new ol.source.Vector();
            _markerSource = new ol.source.Vector();
            _vertexMarkerSource = new ol.source.Vector();

            var zoneLayer = new ol.layer.Vector({ source: _source, style: _zoneStyle });
            var vertexLayer = new ol.layer.Vector({ source: _vertexMarkerSource, style: _vertexMarkerStyle, zIndex: 90 });
            var markerLayer = new ol.layer.Vector({ source: _markerSource, style: _markerStyle, zIndex: 95 });

            _map = new ol.Map({
                target: mapEl,
                layers: [_khoaLayer, _vworldLayer, zoneLayer, vertexLayer, markerLayer],
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
            document.getElementById('ace-satellite-btn').addEventListener('click', _toggleSatellite);

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
    }

    document.addEventListener('DOMContentLoaded', function () {
        if (_getToken()) _init();
        else _showLoginGate();
    });
})();
