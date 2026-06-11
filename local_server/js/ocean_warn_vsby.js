/**
 * ============================================================================
 * 파일명: js/ocean_warn_vsby.js
 * 역할 : 해역별 특보 현황 아코디언의 각 특보구역 카드에 "시정(visibility) 뱃지"
 *        를 부착하고, 뱃지 클릭 시 그 특보구역의 소해구(小海區) 폴리곤을 시정
 *        값에 따라 색칠/텍스트 표시하는 클라이언트 모듈.
 * ============================================================================
 *
 * [로드 방식]
 *   index2.html 을 수정할 수 없으므로 ocean_warn_active1.js 가 <script> 를
 *   동적으로 주입해 이 파일을 로드한다 (중복 주입 방지 가드 있음).
 *
 * [서버 API — 같은 origin, 이미 구현됨]
 *   GET /api/vsby-smallzone?zone={특보구역코드}
 *     → { success, zone, name, baseTm, cells: { "144-9":[{t,v}, ...], ... } }
 *       cells 키 = "부모대해구-소해구(1..9)", v = 시정 km 원값(최대 100).
 *
 * [매핑 데이터]
 *   /assets/zone_grid_map.json  — 특보구역코드 → { name, region, majorZones,
 *                                  smallZones:[...], viewBox:[lonMin,latMin,lonMax,latMax] }
 *   카드의 한글 해역명 ↔ zone_grid_map[code].name 을 정규화 비교해 코드 결정.
 *
 * [표시 규칙 — 명세 그대로]
 *   - 20km 상한 클램프: v ≥ 20 → "20km", 색 계산도 20 으로.
 *   - 색상: VSBY_STOPS (vsby_forecast_layer.js 와 동일) — 가장 큰 stop ≤ v.
 *   - fill: v ≤ 10km → 버킷색 반투명, v > 10km → 채움 없음(투명).
 *   - 텍스트: 항상 km 라벨 표시 (예 "3.2km", ≥20 → "20km").
 *   - 뱃지: 소해구 시정 min~max 범위 ("시정 0.2~5km", 동일값이면 단일).
 *
 * [소해구 폴리곤 기하 — 클라이언트 계산]
 *   대해구(0.5°×0.5° box) 를 3×3 분할. s in 1..9, r=floor((s-1)/3) (row0=북),
 *   c=(s-1)%3 (col0=서). marine_zone_area.json (CRS84) 의 marine_zone_no 로
 *   부모 box 를 얻는다. ocean_map.js 와 동일 정적 파일 /marine_zone_area.json.
 *
 * [지도]
 *   window.__getOceanMap() 으로 OL Map 획득. 투영 EPSG:3857 → lon/lat 는
 *   ol.proj.fromLonLat 로 변환. 전용 VectorLayer 한 장에 폴리곤+라벨을 그린다.
 * ============================================================================
 */

(function () {
    'use strict';

    // ── 색상 stop (vsby_forecast_layer.js VSBY_STOPS 와 동일) ──
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

    var VSBY_CLAMP_MAX = 20;     // 20km 상한
    var VSBY_FILL_MAX = 10;      // v > 10km 면 채움 없음
    var LAYER_ZINDEX = 60;       // 시정예측 raster(50) 위, 일반 UI 아래

    // ─────────────────────────────────────────────────────────────
    // 모듈 상태
    // ─────────────────────────────────────────────────────────────
    var state = {
        gridMap: null,        // zone_grid_map.json (code → meta)
        gridMapPromise: null,
        nameToCode: null,     // 정규화 해역명 → 특보구역코드
        parentBox: null,      // marine_zone_no → [lonMin,latMin,lonMax,latMax]
        parentBoxPromise: null,
        zoneCache: {},        // code → Promise<{cells, baseTm}>
        layer: null,          // 현재 그려진 OL VectorLayer
        activeCode: null,     // 현재 토글 ON 인 특보구역 코드 (없으면 null)
        observer: null
    };

    // ─────────────────────────────────────────────────────────────
    // 유틸
    // ─────────────────────────────────────────────────────────────

    /** 한글 해역명 정규화 — 공백·중점·마침표·괄호 제거 후 비교용. */
    function _normName(s) {
        return ('' + (s || '')).replace(/[\s·.()]/g, '').trim();
    }

    /** hex → "r,g,b" (rgba() 조립용). */
    function _hexToRgb(hex) {
        var v = parseInt(hex.replace('#', ''), 16);
        return ((v >> 16) & 0xff) + ',' + ((v >> 8) & 0xff) + ',' + (v & 0xff);
    }

    /** km 값 → 버킷 stop 인덱스 (가장 큰 stop ≤ v). */
    function _bucketIndex(v) {
        var idx = 0;
        for (var i = 0; i < VSBY_STOPS.length; i++) {
            if (VSBY_STOPS[i].v <= v) idx = i; else break;
        }
        return idx;
    }

    /** km 라벨 — 20 이상은 "20km", 그 외 소수1자리 정리 후 "Nkm". */
    function _fmtKm(v) {
        if (v == null || !isFinite(v)) return '';
        if (v >= VSBY_CLAMP_MAX) return VSBY_CLAMP_MAX + 'km';
        var r = Math.round(v * 10) / 10;
        return r + 'km';
    }

    /** 20 상한 클램프 (색/범위 계산용 숫자). */
    function _clamp(v) {
        if (v == null || !isFinite(v)) return null;
        return v >= VSBY_CLAMP_MAX ? VSBY_CLAMP_MAX : v;
    }

    /** "YYYY.MM.DD HH:mm" → epoch ms (KST 가정, 비교용으로만 사용). */
    function _parseTm(s) {
        var m = /^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/.exec(s || '');
        if (!m) return NaN;
        return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
    }

    // ─────────────────────────────────────────────────────────────
    // 데이터 로딩 — zone_grid_map / 대해구 box
    // ─────────────────────────────────────────────────────────────

    function _loadGridMap() {
        if (state.gridMap) return Promise.resolve(state.gridMap);
        if (state.gridMapPromise) return state.gridMapPromise;
        state.gridMapPromise = fetch('/assets/zone_grid_map.json')
            .then(function (r) { if (!r.ok) throw new Error('grid_map ' + r.status); return r.json(); })
            .then(function (j) {
                state.gridMap = j || {};
                var n2c = {};
                Object.keys(state.gridMap).forEach(function (code) {
                    var meta = state.gridMap[code];
                    if (meta && meta.name) n2c[_normName(meta.name)] = code;
                });
                state.nameToCode = n2c;
                return state.gridMap;
            })
            .catch(function (e) {
                console.warn('[vsby-badge] zone_grid_map 로드 실패:', e.message);
                state.gridMap = {};
                state.nameToCode = {};
                return state.gridMap;
            });
        return state.gridMapPromise;
    }

    /** marine_zone_area.json → marine_zone_no(string) → [lonMin,latMin,lonMax,latMax]. */
    function _loadParentBoxes() {
        if (state.parentBox) return Promise.resolve(state.parentBox);
        if (state.parentBoxPromise) return state.parentBoxPromise;
        state.parentBoxPromise = fetch('/marine_zone_area.json')
            .then(function (r) { if (!r.ok) throw new Error('marine_zone ' + r.status); return r.json(); })
            .then(function (geo) {
                var box = {};
                var feats = (geo && geo.features) || [];
                for (var i = 0; i < feats.length; i++) {
                    var f = feats[i];
                    var no = f && f.properties && f.properties.marine_zone_no;
                    if (no == null) continue;
                    var g = f.geometry;
                    if (!g || !g.coordinates) continue;
                    // MultiPolygon → 첫 polygon 첫 ring 의 bbox.
                    var ring = (g.type === 'MultiPolygon')
                        ? g.coordinates[0][0]
                        : (g.type === 'Polygon' ? g.coordinates[0] : null);
                    if (!ring) continue;
                    var lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity;
                    for (var p = 0; p < ring.length; p++) {
                        var lon = ring[p][0], lat = ring[p][1];
                        if (lon < lonMin) lonMin = lon;
                        if (lon > lonMax) lonMax = lon;
                        if (lat < latMin) latMin = lat;
                        if (lat > latMax) latMax = lat;
                    }
                    box[String(no)] = [lonMin, latMin, lonMax, latMax];
                }
                state.parentBox = box;
                return box;
            })
            .catch(function (e) {
                console.warn('[vsby-badge] marine_zone_area 로드 실패:', e.message);
                state.parentBox = {};
                return state.parentBox;
            });
        return state.parentBoxPromise;
    }

    /** 특보구역 시정 시계열 fetch (코드 단위 캐시). */
    function _loadZoneCells(code) {
        if (state.zoneCache[code]) return state.zoneCache[code];
        var p = fetch('/api/vsby-smallzone?zone=' + encodeURIComponent(code))
            .then(function (r) { if (!r.ok) throw new Error('vsby ' + r.status); return r.json(); })
            .then(function (j) {
                if (!j || !j.success || !j.cells) return { cells: {}, baseTm: null };
                return { cells: j.cells, baseTm: j.baseTm || null };
            })
            .catch(function (e) {
                // 실패는 캐시에서 제거해 다음 클릭 때 재시도 가능하게.
                delete state.zoneCache[code];
                throw e;
            });
        state.zoneCache[code] = p;
        return p;
    }

    // ─────────────────────────────────────────────────────────────
    // 시간 인덱스 선택 (now 에 가장 가까운 frame)
    // ─────────────────────────────────────────────────────────────

    /**
     * cells 의 어떤 한 셀의 시계열을 골라 now 에 가장 가까운 인덱스를 결정.
     * 모든 셀이 동일 시각열을 공유한다는 전제(서버가 동일 baseTm 기반 생성)이며,
     * 셀마다 길이가 달라도 인덱스 기반으로 안전하게 접근.
     *
     * @returns {{index:number, t:string}|null}
     */
    function _pickNearestTimeIndex(cells) {
        var keys = Object.keys(cells || {});
        for (var k = 0; k < keys.length; k++) {
            var series = cells[keys[k]];
            if (Array.isArray(series) && series.length) {
                var now = Date.now();
                var bestI = 0, bestD = Infinity;
                for (var i = 0; i < series.length; i++) {
                    var t = _parseTm(series[i] && series[i].t);
                    if (!isFinite(t)) continue;
                    var d = Math.abs(t - now);
                    if (d < bestD) { bestD = d; bestI = i; }
                }
                return { index: bestI, t: series[bestI] && series[bestI].t };
            }
        }
        return null;
    }

    /** 특정 셀 시계열에서 index(없으면 t매칭) 의 v 추출. */
    function _valueAt(series, index, t) {
        if (!Array.isArray(series) || !series.length) return null;
        if (t) {
            for (var i = 0; i < series.length; i++) {
                if (series[i] && series[i].t === t) return series[i].v;
            }
        }
        var clampIdx = Math.max(0, Math.min(index, series.length - 1));
        var rec = series[clampIdx];
        return rec ? rec.v : null;
    }

    // ─────────────────────────────────────────────────────────────
    // 뱃지 — min~max 범위 계산 + DOM 부착
    // ─────────────────────────────────────────────────────────────

    /**
     * 특보구역 시정 요약 계산.
     * @returns {Promise<{min:number, max:number, time:string}|null>}
     *          소해구/데이터 없으면 null.
     */
    function _computeZoneSummary(code) {
        return _loadZoneCells(code).then(function (data) {
            var cells = data.cells || {};
            var pick = _pickNearestTimeIndex(cells);
            if (!pick) return null;
            var min = Infinity, max = -Infinity, found = false;
            var keys = Object.keys(cells);
            for (var i = 0; i < keys.length; i++) {
                var v = _clamp(_valueAt(cells[keys[i]], pick.index, pick.t));
                if (v == null) continue;
                found = true;
                if (v < min) min = v;
                if (v > max) max = v;
            }
            if (!found) return null;
            return { min: min, max: max, time: pick.t };
        });
    }

    /** 뱃지 텍스트 — "시정 0.2~5km" 또는 동일값이면 "시정 5km". */
    function _badgeText(summary) {
        var loStr = _fmtKm(summary.min);
        var hiStr = _fmtKm(summary.max);
        if (loStr === hiStr) return '시정 ' + hiStr;
        // 동일 단위(km) 이므로 앞 숫자는 단위 생략해 "0.2~5km" 형태로.
        var lo = loStr.replace(/km$/, '');
        return '시정 ' + lo + '~' + hiStr;
    }

    /** 카드 헤더에서 해역명 추출. */
    function _zoneNameOfCard(card) {
        var nameEl = card.querySelector('.zone-name');
        if (!nameEl) return '';
        // 첫 자식 span 이 순수 해역명 (추가 정보 span 제외).
        var span = nameEl.querySelector('span');
        return span ? span.textContent : nameEl.textContent;
    }

    /** 카드 하나에 시정 뱃지 부착 (이미 있으면 skip). */
    function _attachBadgeToCard(card) {
        if (!card || card.dataset.vsbyBadgeDone === '1') return;
        var zoneName = _zoneNameOfCard(card);
        if (!zoneName) return;
        var code = state.nameToCode && state.nameToCode[_normName(zoneName)];
        if (!code) { card.dataset.vsbyBadgeDone = '1'; return; }

        var meta = state.gridMap[code];
        if (!meta || !meta.smallZones || !meta.smallZones.length) {
            card.dataset.vsbyBadgeDone = '1';
            return;
        }

        card.dataset.vsbyBadgeDone = '1';

        var header = card.querySelector('.alert-header');
        if (!header) return;

        var badge = document.createElement('button');
        badge.type = 'button';
        badge.className = 'vsby-zone-badge';
        badge.textContent = '시정 …';
        badge.dataset.vsbyCode = code;
        badge.title = '클릭하면 지도에 소해구별 시정을 표시합니다';
        badge.addEventListener('click', function (e) {
            e.stopPropagation();   // 카드 아코디언 토글 방지
            _onBadgeClick(code, badge);
        });

        // 뱃지 컨테이너(.alert-badges) 앞에 둬서 등급 뱃지들과 함께 한 줄에.
        var badgeBox = header.querySelector('.alert-badges');
        if (badgeBox) header.insertBefore(badge, badgeBox);
        else header.appendChild(badge);

        // 비동기로 범위 채움.
        _computeZoneSummary(code).then(function (summary) {
            if (!badge.isConnected) return;
            if (!summary) { badge.remove(); return; }
            badge.textContent = _badgeText(summary);
            badge.dataset.vsbyReady = '1';
        }).catch(function () {
            if (badge.isConnected) badge.remove();
        });
    }

    /** #alert-content 내 모든 카드 스캔. */
    function _scanCards() {
        if (!state.nameToCode) return;
        var cards = document.querySelectorAll('#alert-content .alert-card');
        for (var i = 0; i < cards.length; i++) _attachBadgeToCard(cards[i]);
    }

    // ─────────────────────────────────────────────────────────────
    // 소해구 폴리곤 그리기
    // ─────────────────────────────────────────────────────────────

    function _getMap() {
        if (typeof window.__getOceanMap === 'function') return window.__getOceanMap();
        if (typeof window.getOceanMap === 'function') return window.getOceanMap();
        return null;
    }

    /** 셀 키 "P-s" 분해 — parent = 마지막 '-' 앞, sub = 뒤(1..9). */
    function _splitCellKey(key) {
        var idx = key.lastIndexOf('-');
        if (idx < 0) return null;
        var parent = key.slice(0, idx);
        var sub = parseInt(key.slice(idx + 1), 10);
        if (!parent || !(sub >= 1 && sub <= 9)) return null;
        return { parent: parent, sub: sub };
    }

    /**
     * 부모 box + sub(1..9) → 소해구 4326 ring [[lon,lat]...] (닫힌 사각형).
     * r=floor((s-1)/3) (row0=북/top), c=(s-1)%3 (col0=서/left).
     */
    function _subRing(box, sub) {
        var lonMin = box[0], latMin = box[1], lonMax = box[2], latMax = box[3];
        var dlon = (lonMax - lonMin) / 3;
        var dlat = (latMax - latMin) / 3;
        var r = Math.floor((sub - 1) / 3);
        var c = (sub - 1) % 3;
        var sLonMin = lonMin + c * dlon;
        var sLonMax = lonMin + (c + 1) * dlon;
        var sLatMax = latMax - r * dlat;
        var sLatMin = latMax - (r + 1) * dlat;
        return [
            [sLonMin, sLatMin],
            [sLonMax, sLatMin],
            [sLonMax, sLatMax],
            [sLonMin, sLatMax],
            [sLonMin, sLatMin]
        ];
    }

    /** lon/lat ring → EPSG:3857 ring. */
    function _ringTo3857(ring) {
        var out = [];
        for (var i = 0; i < ring.length; i++) {
            out.push(ol.proj.fromLonLat(ring[i]));
        }
        return out;
    }

    /** feature 별 style 함수 — fill(≤10km) + 항상 km 텍스트. */
    function _cellStyleFn(feature) {
        var v = feature.get('vsbyV');          // 클램프된 km 값
        var color = feature.get('vsbyColor');  // 버킷 hex
        var label = feature.get('vsbyLabel');  // km 라벨 문자열

        var styleOpts = {
            stroke: new ol.style.Stroke({
                color: 'rgba(255,255,255,0.55)',
                width: 1
            }),
            text: new ol.style.Text({
                text: label || '',
                font: 'bold 11px "Pretendard", sans-serif',
                fill: new ol.style.Fill({ color: '#ffffff' }),
                stroke: new ol.style.Stroke({ color: 'rgba(0,0,0,0.85)', width: 3 }),
                overflow: false,
                placement: 'point'
            })
        };
        // v ≤ 10km → 채움, v > 10km → 채움 없음(투명).
        if (v != null && v <= VSBY_FILL_MAX) {
            styleOpts.fill = new ol.style.Fill({
                color: 'rgba(' + _hexToRgb(color) + ',0.55)'
            });
        }
        return new ol.style.Style(styleOpts);
    }

    /**
     * 특보구역 소해구 폴리곤 레이어 빌드 후 지도에 추가.
     * @returns {Promise<void>}
     */
    function _drawZone(code) {
        var map = _getMap();
        if (!map || typeof ol === 'undefined') return Promise.reject(new Error('map/ol 없음'));

        return Promise.all([_loadParentBoxes(), _loadZoneCells(code)]).then(function (res) {
            var parentBox = res[0];
            var cells = res[1].cells || {};
            var pick = _pickNearestTimeIndex(cells);
            if (!pick) throw new Error('시정 데이터 없음');

            var meta = state.gridMap[code];
            var smallZones = (meta && meta.smallZones) || Object.keys(cells);

            var features = [];
            for (var i = 0; i < smallZones.length; i++) {
                var key = smallZones[i];
                var parts = _splitCellKey(key);
                if (!parts) continue;
                var box = parentBox[parts.parent];
                if (!box) continue;
                var series = cells[key];
                var rawV = _valueAt(series, pick.index, pick.t);
                if (rawV == null) continue;          // 데이터 없는 셀은 그리지 않음
                var v = _clamp(rawV);
                var color = VSBY_STOPS[_bucketIndex(v)].color;

                var ring3857 = _ringTo3857(_subRing(box, parts.sub));
                var feat = new ol.Feature({
                    geometry: new ol.geom.Polygon([ring3857])
                });
                feat.set('vsbyV', v);
                feat.set('vsbyColor', color);
                feat.set('vsbyLabel', _fmtKm(v));
                features.push(feat);
            }

            _removeLayer();
            state.layer = new ol.layer.Vector({
                source: new ol.source.Vector({ features: features }),
                style: _cellStyleFn,
                zIndex: LAYER_ZINDEX
            });
            map.addLayer(state.layer);
            state.activeCode = code;

            // 프레이밍 — zone_grid_map 에 viewBox 가 있으면 그것으로, 없으면(현 데이터에
            // viewBox 키 없음) 실제 그려진 소해구 폴리곤 extent 로 자동 프레이밍.
            if (meta && Array.isArray(meta.viewBox) && meta.viewBox.length === 4) {
                _fitToExtentLonLat(map, meta.viewBox);
            } else if (features.length) {
                _fitToFeatures(map, state.layer.getSource());
            }
        });
    }

    /** lon/lat [minLon,minLat,maxLon,maxLat] 로 프레이밍. */
    function _fitToExtentLonLat(map, vb) {
        try {
            var sw = ol.proj.fromLonLat([vb[0], vb[1]]);
            var ne = ol.proj.fromLonLat([vb[2], vb[3]]);
            var extent = [
                Math.min(sw[0], ne[0]), Math.min(sw[1], ne[1]),
                Math.max(sw[0], ne[0]), Math.max(sw[1], ne[1])
            ];
            map.getView().fit(extent, { padding: [40, 40, 40, 40], duration: 350, maxZoom: 11 });
        } catch (e) { /* noop — 프레이밍 실패는 비치명적 */ }
    }

    /** 그려진 feature 들의 extent 로 프레이밍. */
    function _fitToFeatures(map, source) {
        try {
            var extent = source.getExtent();
            if (extent && isFinite(extent[0])) {
                map.getView().fit(extent, { padding: [40, 40, 40, 40], duration: 350, maxZoom: 11 });
            }
        } catch (e) { /* noop */ }
    }

    function _removeLayer() {
        var map = _getMap();
        if (state.layer && map) {
            try { map.removeLayer(state.layer); } catch (e) {}
        }
        state.layer = null;
        state.activeCode = null;
    }

    /** 모든 뱃지의 active 표시 갱신. */
    function _refreshBadgeActiveState() {
        var badges = document.querySelectorAll('.vsby-zone-badge');
        for (var i = 0; i < badges.length; i++) {
            var b = badges[i];
            if (b.dataset.vsbyCode === state.activeCode) b.classList.add('active');
            else b.classList.remove('active');
        }
    }

    function _onBadgeClick(code, badge) {
        // 이미 같은 구역이 켜져 있으면 토글 OFF.
        if (state.activeCode === code) {
            _removeLayer();
            _refreshBadgeActiveState();
            return;
        }
        // 시정예측 raster 가 켜져 있으면 충돌 방지 차원에서 끔(선택적).
        _drawZone(code).then(function () {
            _refreshBadgeActiveState();
        }).catch(function (e) {
            console.warn('[vsby-badge] 폴리곤 표시 실패:', e && e.message);
            if (typeof window._showOceanToast === 'function') {
                window._showOceanToast('시정 정보를 표시할 수 없습니다.', 'bottom', 1800, false);
            }
        });
    }

    // ─────────────────────────────────────────────────────────────
    // CSS 주입
    // ─────────────────────────────────────────────────────────────
    function _injectCss() {
        if (document.getElementById('vsby-zone-badge-style')) return;
        var st = document.createElement('style');
        st.id = 'vsby-zone-badge-style';
        st.textContent = ''
            + '.vsby-zone-badge{'
            +   'display:inline-flex;align-items:center;'
            +   'font-size:0.72rem;font-weight:600;line-height:1;'
            +   'padding:4px 8px;border-radius:6px;cursor:pointer;'
            +   'color:#cdeefd;background:rgba(31,182,214,0.15);'
            +   'border:1px solid rgba(31,182,214,0.4);'
            +   'margin-right:4px;flex-shrink:0;white-space:nowrap;'
            +   'transition:background .15s,border-color .15s;'
            + '}'
            + '.vsby-zone-badge:hover{'
            +   'background:rgba(31,182,214,0.3);border-color:rgba(31,182,214,0.6);'
            + '}'
            + '.vsby-zone-badge.active{'
            +   'background:rgba(31,182,214,0.55);border-color:#1fb6d6;color:#fff;'
            + '}';
        document.head.appendChild(st);
    }

    // ─────────────────────────────────────────────────────────────
    // 부트스트랩
    // ─────────────────────────────────────────────────────────────

    function _startObserver() {
        var container = document.getElementById('alert-content');
        if (!container) return false;
        if (state.observer) return true;
        state.observer = new MutationObserver(function () {
            // 카드가 다시 그려지면 재스캔 (renderApp 이 카드 DOM 교체).
            _scanCards();
        });
        state.observer.observe(container, { childList: true, subtree: true });
        _scanCards();   // 초기 1회
        return true;
    }

    function _boot() {
        _injectCss();
        // 매핑 데이터 먼저 로드한 뒤 카드 스캔 시작.
        _loadGridMap().then(function () {
            var ok = _startObserver();
            if (!ok) {
                // alert-content 아직 없으면 잠깐 후 재시도.
                var tries = 0;
                var iv = setInterval(function () {
                    tries++;
                    if (_startObserver() || tries > 40) clearInterval(iv);
                }, 250);
            }
            // 특보 데이터 갱신 시 재스캔 (새 카드 등장 대비).
            window.addEventListener('seagnal:alerts-changed', function () {
                // render 가 DOM 교체 후라 약간 지연 후 스캔.
                setTimeout(_scanCards, 0);
            });
        });
    }

    // 외부 디버깅/연동용 최소 API.
    window.OceanWarnVsby = {
        clear: function () { _removeLayer(); _refreshBadgeActiveState(); },
        rescan: _scanCards
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _boot);
    } else {
        _boot();
    }
})();
