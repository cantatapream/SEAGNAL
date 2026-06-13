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
    var COLOR_EXPOSED = 'rgba(140, 96, 50, 0.95)';      // 드러남(갯벌색) — 진한 갈색, 불투명에 가깝게

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
    var _cellCache = {};        // key(iso@agg@bbox) -> {cells,cellDeg} (프리페치 캐시)
    var _cacheKeys = [];        // _cellCache 키 입력 순서(상한 초과 시 오래된 것부터 제거)
    var _playTimer = null;
    var _playing = false;       // 재생 중 여부(로드 동기 재생 가드)
    var _cellHalf = 0.0005;     // 데이터 최소 셀 반폭(도). meta.cell_deg/2.
    var _lastDrawDeg = 0.001;   // 마지막 렌더에 쓴 타일 크기(도) — 클릭 허용반경용.
    var _moveTimer = null;      // 줌/팬 재렌더 디바운스
    var _prefetchTimer = null;  // 전 프레임 백그라운드 프리페치
    var _prefetchSettleTimer = null; // 이동 멈춘 뒤 1회만 프리페치(요청 폭주 방지)
    var _anchorClicks = 0;      // [세션] 앵커 표출 제스처 클릭 수(앱 재시작 시 0으로 리셋)
    var _anchorLayer = null;    // 앵커 포인트 디버그 레이어(세션 한정)
    var _popupOverlay = null;

    // [줌 바닥선] 갯벌이 표출되는 최소 줌. 이보다 더 줌아웃하면 표출하지 않고 "확대
    //   하세요" 안내만 띄운다. 활성 중 이 줌에 도달하면 minZoom 으로 잠가 더 못 줌아웃
    //   하게 한다(단독 표출·광역 과부하 통제). 값은 "경기만 광역(한 만 전체가 보이는)"
    //   프레이밍 기준 — 기기에서 미세조정 가능.
    var MIN_DISPLAY_ZOOM = 11.5;
    var _floorLocked = false;     // minZoom 잠금 적용 여부
    var _prevMinZoom = undefined; // 잠금 전 원래 minZoom(해제 시 복원용)
    var _moving = false;          // 지도 이동(줌/팬) 진행 중 — 재생 룩어헤드 억제용

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

        // 이동(줌/팬) 시작 — 진행 중 플래그 ON(재생 룩어헤드 억제용).
        _map.on('movestart', function () { if (_active) _moving = true; });

        // 줌/팬 시 집계 격자(agg)·뷰포트가 바뀌므로 현재 프레임을 다시 받아 그린다(디바운스).
        _map.on('moveend', function () {
            _moving = false;
            if (!_active) return;
            // [줌 바닥선] 표출 줌 미만이면 갯벌을 그리지 않고 안내 카드만 띄운다.
            //   (minZoom 잠금 전 단계 — 사용자가 직접 확대하도록 둠. 강제 줌 점프 없음.)
            if (_belowFloor()) {
                showZoomHint();
                _drawCells = [];
                if (_imgSource) _imgSource.changed();
                hideLoading();
                return;
            }
            // 표출 줌 도달 — 안내 숨기고, 그 줌을 바닥선으로 잠근 뒤 렌더.
            hideZoomHint();
            applyFloorLock();
            // 이동 중엔 현재 프레임만 다시 그린다(가벼움). 전체 프리페치는 매 이동마다
            //   돌리면 줌 한 번에 수십 요청이 쏟아져 버벅임 → 이동을 멈춘 뒤(1.2s) 1회만.
            if (_moveTimer) clearTimeout(_moveTimer);
            _moveTimer = setTimeout(function () { renderFrame(_frameIdx, false); }, 300);
            if (_prefetchSettleTimer) clearTimeout(_prefetchSettleTimer);
            _prefetchSettleTimer = setTimeout(function () {
                if (_active && !_playing) prefetchAll();
            }, 1200);
        });

        console.log('[tide_field] 물빠짐 레이어 초기화 완료 (캔버스 래스터)');
    };

    // 수심(dm, m·음수=드러남)→ 채움색. 물가(dm≈0)는 연하게, 많이 빠진 곳은 진하게.
    // 물깊이(dm, m·음수=드러남)→ 갯벌색. 물가(dm≈0)는 연하게, 많이 빠진 곳은 진하게.
    function depthToFill(dm) {
        var a = 0.90;
        if (dm != null) {
            var t = (-dm) / 1.2;
            t = t < 0 ? 0 : (t > 1 ? 1 : t);
            a = 0.40 + t * (0.97 - 0.40);
        }
        return 'rgba(140,96,50,' + a.toFixed(3) + ')';
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

        // [저해상도 렌더링] 갯벌은 어차피 blur 로 뭉개 부드럽게 표현하므로, 셀을
        //   기기 픽셀비율(레티나 2~3배) 그대로 채울 필요가 없다. 무거운 "셀 채우기"는
        //   CSS 해상도(=1배)로 낮춘 임시 캔버스에서 하고, 그걸 출력 캔버스로 확대한다.
        //   → 칠하는 픽셀 수가 픽셀비율²(2배 화면 4배, 3배 화면 9배) 줄어 렌더 시간·
        //   임시 캔버스 메모리가 크게 절감된다. 확대 보간 + blur 가 픽셀 경계를 가려
        //   체감 화질 차이는 없다. (pixelRatio=1 기기에선 다운스케일 없이 동일 동작)
        var pr = pixelRatio || 1;
        var ds = pr > 1 ? (1 / pr) : 1;            // 다운스케일 배율(레티나에서만 < 1)
        var tw = Math.max(1, Math.round(W * ds));
        var th = Math.max(1, Math.round(H * ds));

        // 1) 타일을 (저해상도) 임시 캔버스에 채움
        var tmp = document.createElement('canvas');
        tmp.width = tw; tmp.height = th;
        var ctx = tmp.getContext('2d');
        var ex0 = extent[0], ey3 = extent[3];
        var r = resolution / pixelRatio / ds;      // 월드(m) → 임시 캔버스 픽셀
        for (var i = 0; i < _drawCells.length; i++) {
            var d = _drawCells[i];
            // 수심별 농도 그라데이션: 막 드러난 물가(dm≈0)는 연하게, 많이 빠진 곳
            //   (dm≤-1.2m)은 진하게 → 물가선이 부드럽게 페이드(연한 라인).
            ctx.fillStyle = depthToFill(d.dm);
            var px = (d.x0 - ex0) / r;
            var py = (ey3 - d.y1) / r;             // y1=상단(큰 Y)→작은 픽셀
            var pw = (d.x1 - d.x0) / r;
            var ph = (d.y1 - d.y0) / r;
            ctx.fillRect(px, py, pw < 1 ? 1 : pw, ph < 1 ? 1 : ph);
        }
        // 2) 출력 캔버스로 확대 + 블러 1회 → 부드러운 해안선. 확대 보간과 blur 가
        //    저해상도 채움의 픽셀 경계를 함께 가린다.
        try { octx.filter = 'blur(' + (2.6 * pr) + 'px)'; } catch (e) {}
        octx.imageSmoothingEnabled = true;
        try { octx.imageSmoothingQuality = 'low'; } catch (e) {}
        octx.drawImage(tmp, 0, 0, tw, th, 0, 0, W, H);
        return out;
    }

    // ====================================================================
    // 토글 버튼 (정식 활성화: 버튼 기본 활성, 누르면 바로 표출)
    // ====================================================================
    // 물빠짐을 정식 공개하여 버튼을 기본 활성 상태로 둔다(10회 잠금 해제 게이트 제거).
    //   - FEATURE_RELEASED=false 로 바꾸면 다시 "10회 클릭 시 활성화" 테스트 게이트 적용.
    //   - 15회 클릭 앵커 표출 제스처는 그대로 유지(데이터 확보 해점 증명용).
    var FEATURE_RELEASED = true;       // 정식 활성화(true) / 테스트 잠금(false)
    var UNLOCK_KEY = 'tide_field_unlock_v2';
    var CLICK_KEY = 'tide_field_click_v2';
    var UNLOCK_CLICKS = 10;

    function isUnlocked() {
        if (FEATURE_RELEASED) return true;   // 정식 활성화 — 잠금 없음
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

    // 앵커 점 스타일 — 상태별 색으로 "데이터 확보 해점"을 증명.
    //   초록=데이터 확보(complete/partial), 보정 이동분은 파란 테두리로 강조,
    //   회색(작고 옅음)=데이터 없음(no_grid/missing).
    function anchorPointStyle(feature) {
        var st = feature.get('status');
        var secured = (st === 'complete' || st === 'partial');
        if (secured) {
            return new ol.style.Style({
                image: new ol.style.Circle({
                    radius: 3.4,
                    fill: new ol.style.Fill({ color: 'rgba(30,170,90,0.95)' }),
                    stroke: new ol.style.Stroke({
                        color: feature.get('nudged') ? '#1565ff' : '#ffffff',
                        width: feature.get('nudged') ? 1.6 : 1
                    })
                })
            });
        }
        return new ol.style.Style({   // 데이터 없음 — 옅은 회색 작은 점
            image: new ol.style.Circle({
                radius: 2,
                fill: new ol.style.Fill({ color: 'rgba(150,150,150,0.5)' }),
                stroke: new ol.style.Stroke({ color: 'rgba(255,255,255,0.55)', width: 0.5 })
            })
        });
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
                    // 실제 수집 좌표(a.lon/a.lat = 보정 반영). status/nudged 를 속성으로 보관.
                    src.addFeature(new ol.Feature({
                        geometry: new ol.geom.Point(ol.proj.fromLonLat([a.lon, a.lat])),
                        status: a.status, nudged: !!a.nudged
                    }));
                }
                _anchorLayer = new ol.layer.Vector({
                    source: src, zIndex: 60, style: anchorPointStyle
                });
                _map.addLayer(_anchorLayer);
                if (typeof toast === 'function') {
                    var sec = (j.secured != null ? j.secured : j.anchors.length);
                    toast('데이터 확보 ' + sec + '개소 / 전체 ' + (j.count || j.anchors.length) +
                          (j.nudged ? ' (보정 ' + j.nudged + ')' : ''));
                }
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
        // [단독 표출] 물빠짐은 유향유속·풍향풍속·파고파랑·해구도·천기·시정과 겹치지
        //   않게 — 켜질 때 그 오버레이들을 모두 끈다(슬라이더/캔버스 충돌·중첩 방지).
        if (window._shrtForecastDeactivate) { try { window._shrtForecastDeactivate(); } catch (e) {} }
        if (window._vsbyForecastDeactivate) { try { window._vsbyForecastDeactivate(); } catch (e) {} }
        if (window.oceanOverlayTurnOff) { try { window.oceanOverlayTurnOff(); } catch (e) {} }
        if (window.setMarineZoneGridVisible) { try { window.setMarineZoneGridVisible(false); } catch (e) {} }

        _active = true;
        if (btn) btn.classList.add('active');
        _layer.setVisible(true);
        showLoading();   // 슬라이더·범례·첫 화면 준비될 때까지 중앙 로딩 표시

        ensureMeta().then(function (ok) {
            if (!ok) {
                toast('물빠짐 예측 데이터가 아직 준비되지 않았습니다.');
                deactivate();
                return;
            }
            showSliderBar(true);
            // 슬라이더 바가 생기며 뷰포트가 바뀌므로 지도 크기 재측정(작게 렌더 방지).
            if (_map) { try { _map.updateSize(); } catch (e) {} setTimeout(function () { try { _map.updateSize(); } catch (e) {} }, 80); }
            // [안내] 예측 자료 면책 — 두 줄(\n)로 나눠 각 줄이 정상 폰트로 들어가게
            //   한다(한 줄이 길면 _showOceanToast 가 폰트를 11px까지 축소하므로).
            toast('예측 자료입니다. 참고용으로만 사용하고\n실제 현장·기상 상황을 꼭 확인하세요.');
            // [줌 바닥선] 표출 줌 미만이면 강제로 당기지 않고(점프 X) 안내 카드만 띄운다.
            //   사용자가 직접 확대해 표출 줌에 도달하면(moveend) 그때 잠그고 렌더한다.
            if (_belowFloor()) {
                hideLoading();
                showZoomHint();
            } else {
                hideZoomHint();
                applyFloorLock();
                renderFrame(_frameIdx, true);
                prefetchAll();   // 첫 프레임 그린 뒤, 나머지 시각을 백그라운드로 미리 받아 슬라이더 즉시화
            }
        }).catch(function (e) {
            console.warn('[tide_field] meta 로드 실패:', e);
            toast('물빠짐 데이터를 불러오지 못했습니다.');
            deactivate();
        });
    }

    function deactivate() {
        _active = false;
        _moving = false;
        stopPlay();
        stopPrefetch();
        releaseFloorLock();   // 줌아웃 잠금 해제 — 끈 뒤엔 자유롭게 줌아웃 가능
        hideZoomHint();
        if (_moveTimer) { clearTimeout(_moveTimer); _moveTimer = null; }
        var btn = $('ocean-mudflat-toggle-btn');
        if (btn) btn.classList.remove('active');
        if (_layer) _layer.setVisible(false);
        hideLoading();
        _drawCells = [];
        _currentCells = [];
        // 메모리 해제 — 끈 뒤에도 캐시(전 프레임 셀)가 남아 부하/지연 유발하던 것 정리.
        _cellCache = {};
        _cacheKeys = [];
        if (_imgSource) _imgSource.changed();
        showSliderBar(false);
        hidePopup();
        if (window.oceanClearClickPin) window.oceanClearClickPin();  // 꽂힌 핀 제거
        // [지도 크기 재측정] 슬라이더 바가 사라지며 뷰포트가 바뀌므로, 베이스맵이
        //   일부(작은 박스)만 렌더되는 현상 방지를 위해 OL 에 크기 재측정·재렌더 요청.
        if (_map) {
            try { _map.updateSize(); } catch (e) {}
            setTimeout(function () { try { _map.updateSize(); } catch (e) {} }, 80);
        }
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

        // [줌 바닥선] 표출 줌 미만에선 요청·렌더를 생략하고 안내 카드만.
        if (_active && _belowFloor()) { showZoomHint(); return; }

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

    // 뷰포트 파라미터 — 여유(패딩) bbox + 스냅으로 작은 이동은 같은 키가 되게 한다.
    //   → 패닝마다 서버 재요청하지 않고 캐시 재사용(이전엔 키에 bbox 가 없어 패닝 시
    //   옛 영역 셀이 그대로 보이는 문제도 있었음). 패딩으로 살짝 넘겨받아 즉시 채움.
    function currentViewParams() {
        var agg = currentAggDeg();
        var aggStr = agg.toFixed(5);
        try {
            var ext = _map.getView().calculateExtent(_map.getSize());
            var ll = ol.proj.toLonLat([ext[0], ext[1]]);
            var ur = ol.proj.toLonLat([ext[2], ext[3]]);
            var w = ur[0] - ll[0], h = ur[1] - ll[1];
            var snap = Math.max(0.02, w * 0.25);   // 이 격자 안의 이동은 동일 키 → 캐시 재사용
            function rd(v) { return Math.round(v / snap) * snap; }
            var x0 = rd(ll[0] - w * 0.3), y0 = rd(ll[1] - h * 0.3);
            var x1 = rd(ur[0] + w * 0.3), y1 = rd(ur[1] + h * 0.3);
            var bboxStr = [x0, y0, x1, y1].map(function (n) { return n.toFixed(3); }).join(',');
            return { agg: aggStr, bbox: bboxStr, key: aggStr + '@' + bboxStr };
        } catch (e) {
            return { agg: aggStr, bbox: '', key: aggStr + '@all' };
        }
    }

    function fetchCells(iso) {
        var vp = currentViewParams();
        var key = iso + '@' + vp.key;
        if (_cellCache[key]) return Promise.resolve(_cellCache[key]);
        var params = '&agg=' + vp.agg + (vp.bbox ? '&bbox=' + vp.bbox : '');
        return fetch('/api/tide-field?time=' + encodeURIComponent(iso) + params)
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
                var out = {
                    cells: (j && j.success && j.cells) ? j.cells : [],
                    cellDeg: (j && j.cell_deg) || ((_meta && _meta.cell_deg) || 0.001)
                };
                _cellCache[key] = out;
                _cacheKeys.push(key);
                if (_cacheKeys.length > 240) { delete _cellCache[_cacheKeys.shift()]; } // 메모리 상한
                return out;
            }).catch(function () { return { cells: [], cellDeg: (_meta && _meta.cell_deg) || 0.001 }; });
    }

    function paintCells(cells, cellDeg) {
        // [줌 바닥선] 표출 줌 미만이면 어떤 경로로 들어와도 그리지 않는다(방어).
        if (_active && _belowFloor()) {
            _currentCells = []; _drawCells = [];
            if (_imgSource) _imgSource.changed();
            hideLoading();
            return;
        }
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
        if (_loadingShown) hideLoading();     // 첫 화면이 그려지면 로딩 스피너 종료
    }

    // 로딩 스피너(중앙) — 최초 활성 시 메타·첫 프레임 받는 동안 표시.
    var _loadingShown = false;
    function ensureLoadingEl() {
        var el = document.getElementById('mudflat-loading');
        if (!el) {
            el = document.createElement('div');
            el.id = 'mudflat-loading';
            el.innerHTML = '<div class="mudflat-loading-box">' +
                '<div class="mudflat-loading-spin"></div>' +
                '<div class="mudflat-loading-text">로딩 중…</div></div>';
            document.body.appendChild(el);
        }
        return el;
    }
    function showLoading() { ensureLoadingEl().classList.add('show'); _loadingShown = true; }
    function hideLoading() {
        var el = document.getElementById('mudflat-loading');
        if (el) el.classList.remove('show');
        _loadingShown = false;
    }

    // ── 줌 바닥선 게이트 + 안내 카드 ─────────────────────────────────────
    //   표출 줌 미만에선 갯벌을 그리지 않고 중앙 안내 카드만 띄운다(강제 줌 점프 없음).
    //   표출 줌에 도달하면 그 줌을 minZoom 으로 잠가 더 못 줌아웃하게 한다.
    function _belowFloor() {
        try { return _map.getView().getZoom() < MIN_DISPLAY_ZOOM; } catch (e) { return false; }
    }
    function applyFloorLock() {
        if (_floorLocked || !_map) return;
        try {
            var v = _map.getView();
            _prevMinZoom = v.getMinZoom();
            v.setMinZoom(MIN_DISPLAY_ZOOM);
            _floorLocked = true;
        } catch (e) {}
    }
    function releaseFloorLock() {
        if (!_floorLocked || !_map) return;
        try { _map.getView().setMinZoom(_prevMinZoom || 0); } catch (e) {}
        _floorLocked = false; _prevMinZoom = undefined;
    }
    function ensureZoomHintEl() {
        var el = document.getElementById('mudflat-zoom-hint');
        if (!el) {
            el = document.createElement('div');
            el.id = 'mudflat-zoom-hint';
            el.innerHTML = '<div class="mudflat-zoom-hint-box">' +
                '<div class="mudflat-zoom-hint-icon"><i class="fa-solid fa-magnifying-glass-plus"></i></div>' +
                '<div class="mudflat-zoom-hint-title">지도를 확대하면 갯벌이 표시됩니다</div>' +
                '<div class="mudflat-zoom-hint-sub">이 축척부터 물빠짐 정보가 나타나요.</div></div>';
            document.body.appendChild(el);
        }
        return el;
    }
    function showZoomHint() { ensureZoomHintEl().classList.add('show'); }
    function hideZoomHint() {
        var el = document.getElementById('mudflat-zoom-hint');
        if (el) el.classList.remove('show');
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
            // [줌 바닥선] 표출 줌 미만이면 받기·그리기 없이 진행만(안내 카드 유지).
            if (_belowFloor()) { _playTimer = setTimeout(step, FRAME_MS); return; }
            // [폭주 억제] 지도 이동(줌/팬) 중에는 앞 프레임 룩어헤드를 멈춰 요청 폭주를
            //   막는다(이동이 멈추면 다시 미리받기). 현재 프레임은 계속 받아 그린다.
            if (!_moving) {
                for (var k = 1; k <= 4; k++) fetchCells(_frames[(next + k) % _frames.length]);
            }
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
    function stopPrefetch() {
        if (_prefetchTimer) { clearTimeout(_prefetchTimer); _prefetchTimer = null; }
        if (_prefetchSettleTimer) { clearTimeout(_prefetchSettleTimer); _prefetchSettleTimer = null; }
    }
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
                // 가로 방향 범례 — 갯벌(노출)
                legend.innerHTML =
                    '<span class="mudflat-legend-item"><span class="mudflat-sw mudflat-sw-exposed"></span>갯벌 노출</span>';
                legend.style.display = 'flex';
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
        // [바텀시트 억제] 물빠짐 활성 시 ocean_map.handleMapClick 가 이 가드를 먼저 호출.
        //   true 반환 → 클릭 소비(바텀시트 안 열림), 물빠짐 팝업만. 비활성이면 false(통과).
        window._tideFieldTryHandleClick = function (map, evt) {
            if (!_active) return false;
            var ll = ol.proj.toLonLat(evt.coordinate);
            var best = nearestCell(ll[0], ll[1]);
            if (best) showCellPopup(evt.coordinate, best);
            else hidePopup();
            return true;   // 활성 중엔 항상 소비 → 바텀시트 억제
        };
    }

    // 클릭 좌표에서 허용 반경 내 가장 가까운 셀(갯벌/얕은물) 반환, 없으면 null.
    function nearestCell(clon, clat) {
        if (!_currentCells.length) return null;
        var tol = _lastDrawDeg * 1.2, tol2 = tol * tol;
        var best = null, bestD = Infinity;
        for (var i = 0; i < _currentCells.length; i++) {
            var c = _currentCells[i];
            var dx = c.lon - clon, dy = c.lat - clat, d2 = dx * dx + dy * dy;
            if (d2 < bestD) { bestD = d2; best = c; }
        }
        return (best && bestD <= tol2) ? best : null;
    }

    // 십진도 → 도분초(DMS) 문자열
    function toDMS(lat, lon) {
        function fmt(v, pos, neg) {
            var dir = v >= 0 ? pos : neg; v = Math.abs(v);
            var d = Math.floor(v), mf = (v - d) * 60, m = Math.floor(mf), s = Math.round((mf - m) * 60);
            if (s === 60) { s = 0; m++; } if (m === 60) { m = 0; d++; }
            return d + '°' + (m < 10 ? '0' : '') + m + '′' + (s < 10 ? '0' : '') + s + '″' + dir;
        }
        return fmt(lat, 'N', 'S') + ', ' + fmt(lon, 'E', 'W');
    }

    // 슬라이더가 가리키는 예측 시각 라벨 (KST) — "12일 17시 기준"
    function sliderRefLabel() {
        var iso = _frames[_frameIdx]; if (!iso) return '';
        var kst = new Date(new Date(iso).getTime() + 9 * 3600000);
        return kst.getUTCDate() + '일 ' + kst.getUTCHours() + '시 기준';
    }

    // debug 시계열({date,min,depthM}) → [{t(ms,UTC), dm}] 정렬
    function _seriesToPoints(series) {
        var out = [];
        for (var i = 0; i < series.length; i++) {
            var s = series[i]; if (s.depthM == null) continue;
            var ds = String(s.date);
            var kstMs = Date.UTC(+ds.slice(0, 4), +ds.slice(4, 6) - 1, +ds.slice(6, 8)) + (s.min || 0) * 60000;
            out.push({ t: kstMs - 9 * 3600000, dm: s.depthM });
        }
        out.sort(function (a, b) { return a.t - b.t; });
        return out;
    }
    // fromMs 이후 목표 방향 첫 교차(부호 변화)까지 분. band='dry'→다음 잠김(dm≥0),
    //   'shallow'→다음 물빠짐(dm<0). 선형보간으로 분 단위. 없으면 null.
    function _minutesUntilCross(points, fromMs, band) {
        for (var j = 0; j < points.length - 1; j++) {
            var a = points[j], b = points[j + 1];
            if (b.t <= fromMs) continue;
            var cross = (band === 'dry') ? (a.dm < 0 && b.dm >= 0) : (a.dm >= 0 && b.dm < 0);
            if (!cross) continue;
            var frac = (0 - a.dm) / (b.dm - a.dm);
            var crossMs = a.t + frac * (b.t - a.t);
            if (crossMs >= fromMs) return Math.round((crossMs - fromMs) / 60000);
        }
        return null;
    }
    function fetchEta(lat, lon, band, cb) {
        fetch('/api/tide-field/debug?lat=' + lat + '&lon=' + lon)
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
                if (!j || !j.series) { cb('—'); return; }
                var mins = _minutesUntilCross(_seriesToPoints(j.series), new Date(_frames[_frameIdx]).getTime(), band);
                if (mins == null) { cb('예측 범위 내 없음'); return; }
                var h = Math.floor(mins / 60), m = mins % 60;
                cb((h < 10 ? '0' : '') + h + '시간 ' + (m < 10 ? '0' : '') + m + '분');
            }).catch(function () { cb('—'); });
    }

    function showCellPopup(coordinate, cell) {
        ensurePopupOverlay();
        var el = $('mudflat-popup');
        if (!el) return;
        el.innerHTML =
            '<div class="mudflat-popup-close" id="mudflat-popup-close">&times;</div>' +
            '<div class="mudflat-popup-title">물빠짐 예측 <span class="mudflat-popup-ref">(' + sliderRefLabel() + ')</span></div>' +
            '<div class="mudflat-popup-row">상태 : <b style="color:#d49a5a;">갯벌 노출</b></div>' +
            '<div class="mudflat-popup-row mudflat-popup-eta-row">' +
                '<span class="eta-label">물 잠김 남은시간 :</span>' +
                '<span class="eta-val" id="mudflat-popup-eta">계산 중…</span></div>' +
            '<div class="mudflat-popup-row mudflat-popup-coord">' + toDMS(cell.lat, cell.lon) + '</div>';
        _popupOverlay.setPosition(coordinate);
        el.style.display = 'block';
        var closeBtn = $('mudflat-popup-close');
        if (closeBtn) closeBtn.onclick = function () {
            hidePopup();
            if (window.oceanClearClickPin) window.oceanClearClickPin();   // 팝업 닫으면 핀도 제거
        };
        fetchEta(cell.lat, cell.lon, 'dry', function (txt) {
            var etaEl = $('mudflat-popup-eta'); if (etaEl) etaEl.textContent = txt;
        });
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
        // 앱 공용 토스트(_showOceanToast) 사용 — 천기·시정 등 형제 오버레이와 동일
        //   (하단 중앙). 이전엔 존재하지 않는 window.showToast 를 불러 토스트가 안 떴음.
        if (typeof window._showOceanToast === 'function') {
            try { window._showOceanToast(msg, 'bottom', 2600, true); return; } catch (e) {}
        }
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
