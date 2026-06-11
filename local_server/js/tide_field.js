/**
 * ============================================================================
 * 파일명: js/tide_field.js
 * 역할: "서해·남해 물빠짐(갯벌 노출) 예측" 프론트 레이어 (Phase 3)
 * ============================================================================
 *
 * [무엇을 하나]
 *   해양종합정보 지도에 "물빠짐" 토글 버튼을 붙인다(기존 조류/바람/파고/해구도
 *   오버레이 버튼과 동일 패턴). ON 시:
 *     - OpenLayers 벡터 레이어로 표출: 드러남(갯벌색) 셀만 칠한다(잠김 미표시).
 *       격자 경계선 없이 매끄럽게(서버가 드러남 state=1 셀만 보냄).
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

    // ── 색상 (드러남만 표시) ──────────────────────────────────────────
    var COLOR_EXPOSED = 'rgba(165, 125, 72, 0.92)';      // 드러남(갯벌색) — 불투명에 가깝게(이음선·농담차 방지)

    // ── 상태 ─────────────────────────────────────────────────────────
    var _map = null;
    var _layer = null;          // ol.layer.Image (캔버스 래스터)
    var _imgSource = null;      // ol.source.ImageCanvas
    var _drawCells = [];        // 그릴 셀 [{x0,y0,x1,y1}](3857, 사전변환) — canvasFunction 입력
    var _currentCells = [];     // 원본 셀(클릭 조회용)
    var _active = false;
    var _meta = null;           // /api/tide-field/meta 응답
    var _frames = [];           // 슬라이더 frame 의 ISO 시각 목록
    var _frameIdx = 0;
    var _cellCache = {};        // ISO -> cells[] (프리페치)
    var _playTimer = null;
    var _playing = false;       // 재생 중 여부(로드 동기 재생 가드)
    var _cellHalf = 0.0005;     // 데이터 최소 셀 반폭(도). meta.cell_deg/2.
    var _lastDrawDeg = 0.001;   // 마지막 렌더에 쓴 타일 크기(도) — 클릭 허용반경용.
    var _moveTimer = null;      // 줌/팬 재렌더 디바운스
    var _prefetchTimer = null;  // 전 프레임 백그라운드 프리페치
    var _anchorClicks = 0;      // [세션] 앵커 표출 제스처 클릭 수(앱 재시작 시 0으로 리셋)
    var _anchorLayer = null;    // 앵커 포인트 디버그 레이어(세션 한정)
    var _popupOverlay = null;

    function $(id) { return document.getElementById(id); }

    // ====================================================================
    // 초기화 (ocean_map.js buildMap 이후 호출)
    // ====================================================================
    window.initTideFieldLayer = function (map) {
        _map = map || (window.__getOceanMap && window.__getOceanMap());
        if (!_map) { console.warn('[tide_field] 지도 핸들 없음 — 초기화 보류'); return; }
        if (typeof ol === 'undefined') { console.warn('[tide_field] OpenLayers 미로드'); return; }

        // [캔버스 래스터] 폴리곤 수천 개 대신 캔버스에 사각형으로 한 번에 칠해
        //   이미지 1장으로 렌더 → 버벅임 해소 + 이음선 없는 연속 표출.
        _imgSource = new ol.source.ImageCanvas({
            canvasFunction: drawFieldCanvas,
            ratio: 1
        });
        _layer = new ol.layer.Image({
            source: _imgSource,
            visible: false,
            zIndex: 45   // 베이스맵 위, 해구도(49~51) 아래
        });
        _map.addLayer(_layer);

        bindToggle();
        bindSlider();
        bindMapClickPopup();

        // 줌/팬 시 집계 격자(agg)·뷰포트가 바뀌므로 현재 프레임을 다시 받아 그린다(디바운스).
        _map.on('moveend', function () {
            if (!_active) return;
            if (_moveTimer) clearTimeout(_moveTimer);
            _moveTimer = setTimeout(function () { renderFrame(_frameIdx, false); prefetchAll(); }, 250);
        });

        console.log('[tide_field] 물빠짐 레이어 초기화 완료 (캔버스 래스터)');
    };

    // 수심(dm, m·음수=드러남)→ 채움색. 물가(dm≈0)는 연하게, 많이 빠진 곳은 진하게.
    function depthToFill(dm) {
        var a = 0.85;
        if (dm != null) {
            var t = (-dm) / 1.2;            // 0(물가)~1(-1.2m 이하)
            t = t < 0 ? 0 : (t > 1 ? 1 : t);
            a = 0.22 + t * (0.92 - 0.22);
        }
        return 'rgba(165,125,72,' + a.toFixed(3) + ')';
    }

    // ImageCanvas 콜백: 현재 _drawCells(3857 사각형)를 캔버스에 채워 반환.
    //   extent/resolution/pixelRatio 로 지도좌표→픽셀 변환. 셀이 많아도
    //   "사각형 칠하기"라 폴리곤 객체 생성보다 훨씬 가볍다.
    function drawFieldCanvas(extent, resolution, pixelRatio, size) {
        var W = Math.max(1, Math.round(size[0])), H = Math.max(1, Math.round(size[1]));
        var out = document.createElement('canvas');
        out.width = W; out.height = H;
        var octx = out.getContext('2d');
        if (!_drawCells.length) return out;
        // 1) 타일을 임시 캔버스에 샤프하게 채움
        var tmp = document.createElement('canvas');
        tmp.width = W; tmp.height = H;
        var ctx = tmp.getContext('2d');
        var ex0 = extent[0], ey3 = extent[3], r = resolution / pixelRatio;
        for (var i = 0; i < _drawCells.length; i++) {
            var d = _drawCells[i];
            // 수심별 농도 그라데이션: 막 드러난 물가(dm≈0)는 연하게, 많이 빠진 곳
            //   (dm≤-1.2m)은 진하게 → 물가선이 부드럽게 페이드(연한 라인).
            ctx.fillStyle = depthToFill(d.dm);
            var px = (d.x0 - ex0) / r;
            var py = (ey3 - d.y1) / r;          // y1=상단(큰 Y)→작은 픽셀
            var pw = (d.x1 - d.x0) / r;
            var ph = (d.y1 - d.y0) / r;
            ctx.fillRect(px, py, pw < 1 ? 1 : pw, ph < 1 ? 1 : ph);
        }
        // 2) 블러 1회로 픽셀 경계를 부드럽게 → 해안선 따라 유연한 형태.
        try { octx.filter = 'blur(' + (2.6 * pixelRatio) + 'px)'; } catch (e) {}
        octx.drawImage(tmp, 0, 0);
        return out;
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

    // [세션 디버그] 앵커 포인트 표출 토글. 레이어는 메모리에만 있어 앱 재시작 시 사라짐.
    function toggleAnchorOverlay() {
        if (_anchorLayer) {                       // 이미 만들어져 있으면 표시/숨김 토글
            var vis = !_anchorLayer.getVisible();
            _anchorLayer.setVisible(vis);
            if (typeof toast === 'function') toast(vis ? '앵커 포인트 표시' : '앵커 포인트 숨김');
            return;
        }
        if (!_map || typeof ol === 'undefined') return;
        fetch('/api/tide-field/anchors')
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
                if (!j || !j.anchors || !j.anchors.length) { if (typeof toast === 'function') toast('앵커 정보가 없습니다.'); return; }
                var src = new ol.source.Vector();
                for (var i = 0; i < j.anchors.length; i++) {
                    var a = j.anchors[i];
                    src.addFeature(new ol.Feature({ geometry: new ol.geom.Point(ol.proj.fromLonLat([a.lon, a.lat])) }));
                }
                _anchorLayer = new ol.layer.Vector({
                    source: src, zIndex: 60,
                    style: new ol.style.Style({
                        image: new ol.style.Circle({
                            radius: 3,
                            fill: new ol.style.Fill({ color: 'rgba(220,40,40,0.95)' }),
                            stroke: new ol.style.Stroke({ color: '#ffffff', width: 1 })
                        })
                    })
                });
                _map.addLayer(_anchorLayer);
                if (typeof toast === 'function') toast('앵커 포인트 표시 (' + j.anchors.length + '개)');
            }).catch(function () { if (typeof toast === 'function') toast('앵커 정보를 불러오지 못했습니다.'); });
    }

    function bindToggle() {
        var btn = $('ocean-mudflat-toggle-btn');
        if (!btn) return;

        applyLockedLook(btn, !isUnlocked());

        btn.addEventListener('click', function () {
            // [세션 제스처] 매 클릭마다 누적, 15회에 앵커 포인트 표출 토글.
            //   메모리 카운터라 앱 재시작 시 0으로 리셋 → 다시 15회 눌러야 표출.
            _anchorClicks++;
            if (_anchorClicks >= 15) { _anchorClicks = 0; toggleAnchorOverlay(); }

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
            prefetchAll();   // 현재 화면(첫 프레임) 그린 뒤, 나머지 시각을 백그라운드로 미리 받아 슬라이더 즉시화
        }).catch(function (e) {
            console.warn('[tide_field] meta 로드 실패:', e);
            toast('물빠짐 데이터를 불러오지 못했습니다.');
            deactivate();
        });
    }

    function deactivate() {
        _active = false;
        stopPlay();
        stopPrefetch();
        var btn = $('ocean-mudflat-toggle-btn');
        if (btn) btn.classList.remove('active');
        if (_layer) _layer.setVisible(false);
        _drawCells = [];
        _currentCells = [];
        if (_imgSource) _imgSource.changed();
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
            _cellHalf = (j.cell_deg || 0.001) / 2;
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

        fetchCells(iso).then(function (res) {
            if (!_active) return;
            paintCells(res.cells, res.cellDeg);
        });

        // 다음 프레임 프리페치 (재생 부드럽게)
        if (prefetchNext && idx + 1 < _frames.length) {
            fetchCells(_frames[idx + 1]);
        }
    }

    // 현재 줌(화면 픽셀)에 맞는 집계 격자 크기(도). 각 타일이 화면 ~4.5px가
    //   되도록 → 줌에 무관하게 일정한 크기의 연속 타일로 채워진다.
    function currentAggDeg() {
        try {
            var size = _map.getSize();
            var ext = _map.getView().calculateExtent(size);
            var ll = ol.proj.toLonLat([ext[0], ext[1]]);
            var ur = ol.proj.toLonLat([ext[2], ext[3]]);
            var degPerPx = (ur[0] - ll[0]) / (size[0] || 360);
            return degPerPx * 4.5;
        } catch (e) { return (_meta && _meta.cell_deg) || 0.001; }
    }

    function fetchCells(iso) {
        var agg = currentAggDeg();
        var key = iso + '@' + agg.toFixed(5);
        if (_cellCache[key]) return Promise.resolve(_cellCache[key]);
        var params = '&agg=' + agg.toFixed(5);
        try {
            var ext = _map.getView().calculateExtent(_map.getSize());
            var ll = ol.proj.toLonLat([ext[0], ext[1]]);
            var ur = ol.proj.toLonLat([ext[2], ext[3]]);
            params += '&bbox=' + [ll[0], ll[1], ur[0], ur[1]].map(function (n) { return n.toFixed(3); }).join(',');
        } catch (e) {}
        return fetch('/api/tide-field?time=' + encodeURIComponent(iso) + params)
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
                var out = {
                    cells: (j && j.success && j.cells) ? j.cells : [],
                    cellDeg: (j && j.cell_deg) || ((_meta && _meta.cell_deg) || 0.001)
                };
                _cellCache[key] = out;
                return out;
            }).catch(function () { return { cells: [], cellDeg: (_meta && _meta.cell_deg) || 0.001 }; });
    }

    function paintCells(cells, cellDeg) {
        _currentCells = cells || [];
        _drawCells = [];
        _lastDrawDeg = cellDeg || (_cellHalf * 2);
        // 렌더 셀이 BADA 데이터(150m)에 맞춰졌으니(cell_deg≈0.0015), 타일 최소를
        //   셀 크기로 바닥처리 + 1.4× 겹침 → 빈칸/체커보드 없이 솔리드. 블러로 부드럽게.
        var MIN_TILE_DEG = 0.0015;
        for (var i = 0; i < _currentCells.length; i++) {
            var c = _currentCells[i];
            var sz = Math.max(c.s || _lastDrawDeg, MIN_TILE_DEG);
            var h = (sz / 2) * 1.4;
            var ll = ol.proj.fromLonLat([c.lon - h, c.lat - h]); // 좌하단 [x0,y0]
            var ur = ol.proj.fromLonLat([c.lon + h, c.lat + h]); // 우상단 [x1,y1]
            _drawCells.push({ x0: ll[0], y0: ll[1], x1: ur[0], y1: ur[1], dm: c.depth_m });
        }
        if (_imgSource) _imgSource.changed(); // 캔버스 다시 그리기
    }

    // ====================================================================
    // 슬라이더 + 재생
    // ====================================================================
    function bindSlider() {
        var slider = $('mudflat-slider');
        var playBtn = $('mudflat-play-btn');
        if (slider) {
            // 디바운스: 드래그 중 input 이 연속 발생해도 마지막값만 ~120ms 후 렌더.
            //   (드래그마다 즉시 fetch+재렌더 → 버벅임의 주원인 제거)
            var _sliderTimer = null;
            slider.addEventListener('input', function () {
                stopPlay();
                if (_sliderTimer) clearTimeout(_sliderTimer);
                _sliderTimer = setTimeout(function () {
                    renderFrame(parseInt(slider.value, 10) || 0, false);
                }, 120);
            });
        }
        if (playBtn) {
            playBtn.addEventListener('click', function () {
                if (_playTimer) stopPlay();
                else startPlay();
            });
        }
    }

    // 연속 재생: 로딩과 무관하게 일정 간격으로 바를 전진(멈추지 않음). 각 프레임은
    //   캐시면 즉시, 아니면 받아지는 대로(아직 그 프레임이면) 그린다. 앞 프레임은
    //   미리 받아둠 → 첫 바퀴엔 화면이 살짝 따라오다, 캐시가 데워지면 완전히 매끄럽다.
    function startPlay() {
        var playBtn = $('mudflat-play-btn');
        if (playBtn) playBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
        _playing = true;
        var FRAME_MS = 650;     // 프레임 간격(로딩과 무관하게 일정)
        function step() {
            if (!_playing || !_active) return;
            var next = _frameIdx + 1;
            if (next >= _frames.length) next = 0;
            _frameIdx = next;
            var slider = $('mudflat-slider');
            if (slider) slider.value = next;
            updateTooltip(next);
            // 앞 4프레임 미리 받기(도착 전 캐시 워밍)
            for (var k = 1; k <= 4; k++) fetchCells(_frames[(next + k) % _frames.length]);
            // 이 프레임: 받아지는 대로 그림(이미 다음으로 넘어갔으면 버림 → 최신 우선)
            fetchCells(_frames[next]).then(function (res) {
                if (_playing && _active && _frameIdx === next) paintCells(res.cells, res.cellDeg);
            });
            _playTimer = setTimeout(step, FRAME_MS);   // 로딩 기다리지 않고 계속 진행
        }
        step();
    }
    function stopPlay() {
        _playing = false;
        if (_playTimer) { clearTimeout(_playTimer); _playTimer = null; }
        var playBtn = $('mudflat-play-btn');
        if (playBtn) playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    }

    // 전 프레임을 백그라운드로 미리 받아 캐시 워밍 → 슬라이더가 즉시 반응.
    //   순차+간격(150ms)으로 가볍게. fetchCells 는 iso+agg 로 캐시하므로 이미 받은 건
    //   즉시 반환(서버 부담 X). 재생 중엔 재생 루프가 따로 받으므로 생략.
    function stopPrefetch() { if (_prefetchTimer) { clearTimeout(_prefetchTimer); _prefetchTimer = null; } }
    function prefetchAll() {
        stopPrefetch();
        var i = 0;
        function next() {
            if (!_active || _playing || i >= _frames.length) { _prefetchTimer = null; return; }
            fetchCells(_frames[i]);  // 캐시되면 다음부터 즉시
            i++;
            _prefetchTimer = setTimeout(next, 150);
        }
        _prefetchTimer = setTimeout(next, 300); // 첫 프레임 표시 먼저
    }

    function showSliderBar(show) {
        var bar = $('mudflat-slider-bar');
        var legend = $('mudflat-legend');
        if (bar) { bar.style.display = show ? 'flex' : 'none'; bar.setAttribute('aria-hidden', show ? 'false' : 'true'); }
        // 표시 직후(레이아웃 완료 후) 눈금·말풍선 위치 재계산
        if (show) requestAnimationFrame(function () { buildTicks(); updateTooltip(_frameIdx); });
        if (legend) {
            if (show) {
                legend.innerHTML =
                    '<div class="mudflat-legend-row"><span class="mudflat-sw mudflat-sw-exposed"></span>드러남(갯벌)</div>';
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
        var slider = $('mudflat-slider');
        if (!tip || !slider || !_frames[idx]) return;
        // 라벨 (KST mm/dd HH:MM)
        var kst = new Date(new Date(_frames[idx]).getTime() + 9 * 3600000);
        var mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
        var dd = String(kst.getUTCDate()).padStart(2, '0');
        var hh = String(kst.getUTCHours()).padStart(2, '0');
        var mi = String(kst.getUTCMinutes()).padStart(2, '0');
        tip.textContent = mm + '/' + dd + ' ' + hh + ':' + mi;

        // 핸들 위치에 말풍선 정렬 (천기 슬라이더와 동일 로직)
        tip.style.left = '0px';
        tip.style.transform = 'none';
        var sliderRect = slider.getBoundingClientRect();
        if (!sliderRect.width) return; // 아직 미표시 → 위치 계산 보류
        var min = parseFloat(slider.min) || 0;
        var max = parseFloat(slider.max) || 0;
        var pct = max > min ? ((idx - min) / (max - min)) : 0;
        var thumbHalf = 9;
        var thumbXVp = sliderRect.left + thumbHalf + pct * (sliderRect.width - thumbHalf * 2);
        var tipW = tip.getBoundingClientRect().width;
        var pad = 4;
        var idealLV = thumbXVp - tipW / 2;
        var clampedLV = Math.max(pad, Math.min(idealLV, window.innerWidth - tipW - pad));
        var wrapRect = tip.parentElement.getBoundingClientRect();
        tip.style.left = (clampedLV - wrapRect.left) + 'px';
        // 화살표 x (말풍선 안에서 핸들 가리키게)
        var arrowX = Math.max(8, Math.min(thumbXVp - clampedLV, tipW - 8));
        tip.style.setProperty('--shrt-arrow-x', arrowX + 'px');
    }

    // 천기 슬라이더와 동일: 모든 프레임에 작은 눈금, 자정/정오에 큰 눈금 + 자정에 날짜 라벨.
    function buildTicks() {
        var ticks = $('mudflat-ticks');
        if (!ticks || !_frames.length) return;
        ticks.innerHTML = '';
        var n = _frames.length;
        var labelsAdded = {};
        var frag = document.createDocumentFragment();
        for (var i = 0; i < n; i++) {
            var kst = new Date(new Date(_frames[i]).getTime() + 9 * 3600000);
            var hh = kst.getUTCHours();
            var pct = (i / Math.max(1, n - 1)) * 100;
            var isMajor = (hh === 0 || hh === 12);
            var tick = document.createElement('div');
            tick.className = 'shrt-fcst-tick ' + (isMajor ? 'major' : 'minor');
            tick.style.left = pct + '%';
            frag.appendChild(tick);
            if (isMajor && hh === 0 && kst.getUTCMinutes() === 0) {
                var mo = kst.getUTCMonth() + 1, da = kst.getUTCDate();
                var key = mo + '-' + da;
                if (!labelsAdded[key]) {
                    labelsAdded[key] = 1;
                    var label = document.createElement('div');
                    label.className = 'shrt-fcst-tick-label top';
                    label.style.left = pct + '%';
                    label.textContent = mo + '/' + da;
                    frag.appendChild(label);
                }
            }
        }
        ticks.appendChild(frag);
    }

    // ====================================================================
    // 셀 클릭 팝업 (현재 물깊이 / 간조 보조 표시)
    // ====================================================================
    function bindMapClickPopup() {
        // 캔버스 래스터엔 feature 가 없으므로, 클릭 좌표에서 가장 가까운 드러남 셀을
        // 직접 찾는다(1셀 반경 내). 물빠짐 활성 시에만.
        _map.on('singleclick', function (evt) {
            if (!_active || !_currentCells.length) return;
            var ll = ol.proj.toLonLat(evt.coordinate);
            var clon = ll[0], clat = ll[1];
            var tol = _lastDrawDeg * 1.2;  // 클릭 허용 반경(도) — 현재 타일 크기 기준
            var tol2 = tol * tol;
            var best = null, bestD = Infinity;
            for (var i = 0; i < _currentCells.length; i++) {
                var c = _currentCells[i];
                var dx = c.lon - clon, dy = c.lat - clat;
                var d2 = dx * dx + dy * dy;
                if (d2 < bestD) { bestD = d2; best = c; }
            }
            if (!best || bestD > tol2) { hidePopup(); return; }
            showCellPopup(evt.coordinate, best);
        });
    }

    function showCellPopup(coordinate, cell) {
        ensurePopupOverlay();
        var el = $('mudflat-popup');
        if (!el) return;
        var depth = cell.depth_m;
        var lat = cell.lat, lon = cell.lon;
        // 레이어엔 드러남(state=1) 셀만 존재한다.
        var stateTxt = '<b style="color:#8a5a2b;">드러남(갯벌 노출)</b>';
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
