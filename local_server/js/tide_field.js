/**
 * ============================================================================
 * 파일명: js/tide_field.js
 * 역할: "서해·남해 물빠짐(갯벌 노출) 예측" 프론트 레이어 (Phase 3)
 * ============================================================================
 *
 * [무엇을 하나]
 *   해양종합정보 지도에 "물빠짐" 토글 버튼을 붙인다(기존 조류/바람/파고/해구도
 *   오버레이 버튼과 동일 패턴). ON 시:
 *     - OpenLayers 벡터 레이어로 A안 표출: 잠김(물색)·드러남(갯벌색) 2색 셀.
 *     - 하단 시간 슬라이더(앞으로 3일, 30분 간격) → 시각 변경 시
 *       /api/tide-field?time= 호출(프리페치 캐시)로 다시 칠함. 재생 버튼.
 *     - 셀 클릭 시 그 지점 "현재 물깊이 / 간조시각·최저조위" 보조 팝업.
 *   서해·남해만(서버가 동해·제주 셀을 애초에 안 보냄).
 *
 * [API 계약 — routes/tide_field.js 가 단일 소스]
 *   GET /api/tide-field/meta → { region_bbox, time_start, time_end, step_minutes, ... }
 *   GET /api/tide-field?time=ISO → { cells:[{lon,lat,state,depth_m}], ... }
 *     state: 0=잠김, 1=드러남.
 *
 * [데이터 준비 안 됨] meta 가 503 이면 토글을 비활성(안내 토스트)로 둔다.
 *
 * [연계]
 *   - ocean_map.js: window.__getOceanMap() 로 지도 핸들 획득.
 *   - index2.html: #ocean-mudflat-toggle-btn, #mudflat-slider-bar 등.
 *   - routes/tide_field.js: 데이터 소스.
 * ============================================================================
 */

(function () {
    'use strict';

    if (typeof window === 'undefined') return;

    // ── 색상 (A안 2색) ────────────────────────────────────────────────
    var COLOR_SUBMERGED = 'rgba(33, 120, 200, 0.30)';   // 잠김(물색)
    var COLOR_EXPOSED = 'rgba(150, 110, 60, 0.55)';      // 드러남(갯벌색)
    var COLOR_EXPOSED_STROKE = 'rgba(120, 85, 40, 0.7)';

    // ── 상태 ─────────────────────────────────────────────────────────
    var _map = null;
    var _layer = null;          // ol.layer.Vector
    var _source = null;         // ol.source.Vector
    var _active = false;
    var _meta = null;           // /api/tide-field/meta 응답
    var _frames = [];           // 슬라이더 frame 의 ISO 시각 목록
    var _frameIdx = 0;
    var _cellCache = {};        // ISO -> cells[] (프리페치)
    var _playTimer = null;
    var _cellHalf = 0.01;       // 셀 반폭(도). meta.cell_deg/2 로 갱신.
    var _popupOverlay = null;

    function $(id) { return document.getElementById(id); }

    // ====================================================================
    // 초기화 (ocean_map.js buildMap 이후 호출)
    // ====================================================================
    window.initTideFieldLayer = function (map) {
        _map = map || (window.__getOceanMap && window.__getOceanMap());
        if (!_map) { console.warn('[tide_field] 지도 핸들 없음 — 초기화 보류'); return; }
        if (typeof ol === 'undefined') { console.warn('[tide_field] OpenLayers 미로드'); return; }

        _source = new ol.source.Vector();
        _layer = new ol.layer.Vector({
            source: _source,
            style: styleFn,
            visible: false,
            zIndex: 45   // 베이스맵 위, 해구도(49~51) 아래
        });
        _map.addLayer(_layer);

        bindToggle();
        bindSlider();
        bindMapClickPopup();
        console.log('[tide_field] 물빠짐 레이어 초기화 완료');
    };

    // 셀 feature 스타일: state 로 색 분기
    function styleFn(feature) {
        var st = feature.get('state');
        if (st === 1) {
            return new ol.style.Style({
                fill: new ol.style.Fill({ color: COLOR_EXPOSED }),
                stroke: new ol.style.Stroke({ color: COLOR_EXPOSED_STROKE, width: 0.4 })
            });
        }
        return new ol.style.Style({
            fill: new ol.style.Fill({ color: COLOR_SUBMERGED })
        });
    }

    // ====================================================================
    // 토글 버튼 (테스트 단계: 비활성 표시 + 10회 클릭 시 활성화)
    // ====================================================================
    // 물빠짐은 아직 테스트 기능이라, 버튼은 보이되 비활성(회색) 상태로 두고
    // 10회 클릭하면 활성화한다. 활성화 상태는 localStorage 에 저장되어 한 번
    // 풀면 유지된다(진행 중 클릭 수도 저장 → 새로고침해도 누적 유지).
    var UNLOCK_KEY = 'tide_field_unlock_v2';
    var CLICK_KEY = 'tide_field_click_v2';
    var UNLOCK_CLICKS = 10;

    function isUnlocked() {
        try { return localStorage.getItem(UNLOCK_KEY) === '1'; } catch (e) { return false; }
    }
    function setUnlocked() {
        try { localStorage.setItem(UNLOCK_KEY, '1'); } catch (e) {}
    }
    function getUnlockClicks() {
        try { return parseInt(localStorage.getItem(CLICK_KEY) || '0', 10) || 0; } catch (e) { return 0; }
    }
    function setUnlockClicks(n) {
        try { localStorage.setItem(CLICK_KEY, String(n)); } catch (e) {}
    }

    // 잠금(비활성) 외형 적용/해제 — 회색 처리하되 클릭은 계속 받는다.
    function applyLockedLook(btn, locked) {
        if (!btn) return;
        if (locked) {
            btn.classList.add('ocean-overlay-btn--locked');
            btn.style.opacity = '0.45';
            btn.style.filter = 'grayscale(1)';
            btn.title = '물빠짐 (테스트 — 비활성화 상태)';
        } else {
            btn.classList.remove('ocean-overlay-btn--locked');
            btn.style.opacity = '';
            btn.style.filter = '';
            btn.title = '물빠짐 (서해·남해 갯벌 노출)';
        }
    }

    function bindToggle() {
        var btn = $('ocean-mudflat-toggle-btn');
        if (!btn) return;

        applyLockedLook(btn, !isUnlocked());

        btn.addEventListener('click', function () {
            // [테스트 게이트] 잠금 상태면 토글하지 않고 클릭 수만 누적, 10회에 해제.
            if (!isUnlocked()) {
                var n = getUnlockClicks() + 1;
                setUnlockClicks(n);
                if (n >= UNLOCK_CLICKS) {
                    setUnlocked();
                    applyLockedLook(btn, false);
                    toast('물빠짐 기능이 활성화되었습니다.');
                    activate(); // 해제 직후 바로 표출
                } else {
                    toast('물빠짐 활성화까지 ' + (UNLOCK_CLICKS - n) + '회 남았습니다.');
                }
                return;
            }
            // 잠금 해제됨: 정상 토글
            if (_active) deactivate();
            else activate();
        });
    }

    function activate() {
        var btn = $('ocean-mudflat-toggle-btn');
        // 다른 배타 오버레이(천기) 가 켜져 있으면 끔 — 슬라이더 충돌 방지
        if (window._shrtForecastDeactivate) { try { window._shrtForecastDeactivate(); } catch (e) {} }

        _active = true;
        if (btn) btn.classList.add('active');
        _layer.setVisible(true);

        ensureMeta().then(function (ok) {
            if (!ok) {
                toast('물빠짐 예측 데이터가 아직 준비되지 않았습니다.');
                deactivate();
                return;
            }
            showSliderBar(true);
            renderFrame(_frameIdx, true);
        }).catch(function (e) {
            console.warn('[tide_field] meta 로드 실패:', e);
            toast('물빠짐 데이터를 불러오지 못했습니다.');
            deactivate();
        });
    }

    function deactivate() {
        _active = false;
        stopPlay();
        var btn = $('ocean-mudflat-toggle-btn');
        if (btn) btn.classList.remove('active');
        if (_layer) _layer.setVisible(false);
        if (_source) _source.clear();
        showSliderBar(false);
        hidePopup();
    }
    // 외부(다른 오버레이 활성 시)에서 강제 OFF
    window._tideFieldDeactivate = function () { if (_active) deactivate(); };

    // ====================================================================
    // 메타 + frame 목록 구성
    // ====================================================================
    function ensureMeta() {
        if (_meta) return Promise.resolve(true);
        return fetch('/api/tide-field/meta').then(function (r) {
            if (r.status === 503) return null;
            if (!r.ok) return null;
            return r.json();
        }).then(function (j) {
            if (!j || !j.success || !j.ready) return false;
            _meta = j;
            _cellHalf = (j.cell_deg || 0.02) / 2;
            buildFrames(j);
            return true;
        });
    }

    // time_start ~ time_end 를 step_minutes 간격으로 frame 목록 생성
    function buildFrames(meta) {
        _frames = [];
        var start = new Date(meta.time_start).getTime();
        var end = new Date(meta.time_end).getTime();
        var step = (meta.step_minutes || 30) * 60000;
        for (var t = start; t < end; t += step) {
            _frames.push(new Date(t).toISOString());
        }
        // 슬라이더 초기 frame = 현재 시각에 가장 가까운 frame
        var now = Date.now();
        var best = 0, bestD = Infinity;
        for (var i = 0; i < _frames.length; i++) {
            var d = Math.abs(new Date(_frames[i]).getTime() - now);
            if (d < bestD) { bestD = d; best = i; }
        }
        _frameIdx = best;

        var slider = $('mudflat-slider');
        if (slider) {
            slider.min = 0;
            slider.max = Math.max(0, _frames.length - 1);
            slider.value = _frameIdx;
        }
        buildTicks();
    }

    // ====================================================================
    // 프레임 렌더 (그 시각의 셀 색칠)
    // ====================================================================
    function renderFrame(idx, prefetchNext) {
        if (idx < 0 || idx >= _frames.length) return;
        _frameIdx = idx;
        var iso = _frames[idx];

        var slider = $('mudflat-slider');
        if (slider) slider.value = idx;
        updateTooltip(idx);

        fetchCells(iso).then(function (cells) {
            if (!_active) return;
            paintCells(cells);
        });

        // 다음 프레임 프리페치 (재생 부드럽게)
        if (prefetchNext && idx + 1 < _frames.length) {
            fetchCells(_frames[idx + 1]);
        }
    }

    function fetchCells(iso) {
        if (_cellCache[iso]) return Promise.resolve(_cellCache[iso]);
        // 뷰포트 bbox 로 전송량 절감
        var bboxParam = '';
        try {
            var ext = _map.getView().calculateExtent(_map.getSize());
            var ll = ol.proj.toLonLat([ext[0], ext[1]]);
            var ur = ol.proj.toLonLat([ext[2], ext[3]]);
            bboxParam = '&bbox=' + [ll[0], ll[1], ur[0], ur[1]].map(function (n) { return n.toFixed(3); }).join(',');
        } catch (e) {}
        return fetch('/api/tide-field?time=' + encodeURIComponent(iso) + bboxParam)
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
                var cells = (j && j.success && j.cells) ? j.cells : [];
                _cellCache[iso] = cells;
                return cells;
            }).catch(function () { return []; });
    }

    function paintCells(cells) {
        _source.clear();
        if (!cells || !cells.length) return;
        var feats = [];
        var h = _cellHalf;
        for (var i = 0; i < cells.length; i++) {
            var c = cells[i];
            // 셀을 작은 사각형 폴리곤으로 (lon±h, lat±h)
            var ring = [
                [c.lon - h, c.lat - h], [c.lon + h, c.lat - h],
                [c.lon + h, c.lat + h], [c.lon - h, c.lat + h],
                [c.lon - h, c.lat - h]
            ].map(function (p) { return ol.proj.fromLonLat(p); });
            var f = new ol.Feature({ geometry: new ol.geom.Polygon([ring]) });
            f.set('state', c.state);
            f.set('depth_m', c.depth_m);
            f.set('lon', c.lon);
            f.set('lat', c.lat);
            feats.push(f);
        }
        _source.addFeatures(feats);
    }

    // ====================================================================
    // 슬라이더 + 재생
    // ====================================================================
    function bindSlider() {
        var slider = $('mudflat-slider');
        var playBtn = $('mudflat-play-btn');
        if (slider) {
            slider.addEventListener('input', function () {
                stopPlay();
                renderFrame(parseInt(slider.value, 10) || 0, false);
            });
        }
        if (playBtn) {
            playBtn.addEventListener('click', function () {
                if (_playTimer) stopPlay();
                else startPlay();
            });
        }
    }

    function startPlay() {
        var playBtn = $('mudflat-play-btn');
        if (playBtn) playBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
        _playTimer = setInterval(function () {
            var next = _frameIdx + 1;
            if (next >= _frames.length) next = 0;
            renderFrame(next, true);
        }, 800);
    }
    function stopPlay() {
        if (_playTimer) { clearInterval(_playTimer); _playTimer = null; }
        var playBtn = $('mudflat-play-btn');
        if (playBtn) playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    }

    function showSliderBar(show) {
        var bar = $('mudflat-slider-bar');
        var legend = $('mudflat-legend');
        if (bar) { bar.style.display = show ? 'flex' : 'none'; bar.setAttribute('aria-hidden', show ? 'false' : 'true'); }
        if (legend) {
            if (show) {
                legend.innerHTML =
                    '<div class="mudflat-legend-row"><span class="mudflat-sw mudflat-sw-exposed"></span>드러남(갯벌)</div>' +
                    '<div class="mudflat-legend-row"><span class="mudflat-sw mudflat-sw-sub"></span>잠김(바다)</div>';
                legend.style.display = 'block';
                legend.setAttribute('aria-hidden', 'false');
            } else {
                legend.style.display = 'none';
                legend.setAttribute('aria-hidden', 'true');
            }
        }
    }

    function updateTooltip(idx) {
        var tip = $('mudflat-tooltip');
        if (!tip || !_frames[idx]) return;
        var d = new Date(_frames[idx]);
        // KST 표시
        var kst = new Date(d.getTime() + 9 * 3600000);
        var mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
        var dd = String(kst.getUTCDate()).padStart(2, '0');
        var hh = String(kst.getUTCHours()).padStart(2, '0');
        var mi = String(kst.getUTCMinutes()).padStart(2, '0');
        tip.textContent = mm + '/' + dd + ' ' + hh + ':' + mi;
    }

    function buildTicks() {
        var ticks = $('mudflat-ticks');
        if (!ticks || !_frames.length) return;
        ticks.innerHTML = '';
        // 자정 frame 마다 날짜 라벨
        for (var i = 0; i < _frames.length; i++) {
            var kst = new Date(new Date(_frames[i]).getTime() + 9 * 3600000);
            if (kst.getUTCHours() === 0 && kst.getUTCMinutes() === 0) {
                var span = document.createElement('span');
                span.className = 'shrt-fcst-tick';
                span.style.left = (i / (_frames.length - 1) * 100) + '%';
                span.textContent = (kst.getUTCMonth() + 1) + '/' + kst.getUTCDate();
                ticks.appendChild(span);
            }
        }
    }

    // ====================================================================
    // 셀 클릭 팝업 (현재 물깊이 / 간조 보조 표시)
    // ====================================================================
    function bindMapClickPopup() {
        // 클릭은 ocean_map.js handleMapClick 이 먼저 처리하지만, 물빠짐 활성 시엔
        // 셀 hit 면 우리가 팝업을 띄운다. forEachFeatureAtPixel 로 우리 레이어 hit 확인.
        _map.on('singleclick', function (evt) {
            if (!_active) return;
            var hit = null;
            _map.forEachFeatureAtPixel(evt.pixel, function (feature, lyr) {
                if (lyr === _layer && hit == null) hit = feature;
            });
            if (!hit) { hidePopup(); return; }
            showCellPopup(evt.coordinate, hit);
        });
    }

    function showCellPopup(coordinate, feature) {
        ensurePopupOverlay();
        var el = $('mudflat-popup');
        if (!el) return;
        var state = feature.get('state');
        var depth = feature.get('depth_m');
        var lat = feature.get('lat'), lon = feature.get('lon');
        var stateTxt = state === 1
            ? '<b style="color:#8a5a2b;">드러남(갯벌 노출)</b>'
            : '<b style="color:#1f6fbf;">잠김(바다)</b>';
        var depthTxt = (depth == null) ? '-' :
            (depth <= 0 ? ('노출 ' + Math.abs(depth).toFixed(2) + ' m') : (depth.toFixed(2) + ' m'));
        el.innerHTML =
            '<div class="mudflat-popup-close" id="mudflat-popup-close">&times;</div>' +
            '<div class="mudflat-popup-title">물빠짐 예측</div>' +
            '<div class="mudflat-popup-row">상태: ' + stateTxt + '</div>' +
            '<div class="mudflat-popup-row">현재 물깊이: ' + depthTxt + '</div>' +
            '<div class="mudflat-popup-row" style="opacity:.7;">' + lat.toFixed(3) + ', ' + lon.toFixed(3) + '</div>';
        _popupOverlay.setPosition(coordinate);
        el.style.display = 'block';
        var closeBtn = $('mudflat-popup-close');
        if (closeBtn) closeBtn.onclick = hidePopup;
    }

    function ensurePopupOverlay() {
        if (_popupOverlay) return;
        var el = $('mudflat-popup');
        if (!el) {
            el = document.createElement('div');
            el.id = 'mudflat-popup';
            el.className = 'mudflat-popup';
            el.style.display = 'none';
            document.body.appendChild(el);
        }
        _popupOverlay = new ol.Overlay({
            element: el,
            positioning: 'bottom-center',
            offset: [0, -8],
            stopEvent: true
        });
        _map.addOverlay(_popupOverlay);
    }

    function hidePopup() {
        var el = $('mudflat-popup');
        if (el) el.style.display = 'none';
        if (_popupOverlay) _popupOverlay.setPosition(undefined);
    }

    // ====================================================================
    // 토스트 (간단)
    // ====================================================================
    function toast(msg) {
        if (window.showToast) { try { window.showToast(msg); return; } catch (e) {} }
        console.log('[tide_field]', msg);
    }

    // ocean_map.js 가 buildMap 끝에서 호출하지 않는 경우를 대비해, 지도가
    // 준비되면 자동 초기화 (index2 전용).
    function autoInit() {
        if (window.__SEAGNAL_PAGE !== 'index2') return;
        var tries = 0;
        var timer = setInterval(function () {
            tries++;
            var map = window.__getOceanMap && window.__getOceanMap();
            if (map) {
                clearInterval(timer);
                if (!_layer) window.initTideFieldLayer(map);
            } else if (tries > 40) {
                clearInterval(timer);
            }
        }, 250);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoInit);
    } else {
        autoInit();
    }
})();
