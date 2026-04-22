/**
 * ============================================================================
 * 파일명: js/ocean_overlay.js
 * 역할: 해양현황 캔버스 오버레이 (해류/바람/파고 색상 + 파티클 애니메이션)
 * ============================================================================
 *
 * [설명]
 * 모드 B(해양현황)에서 지도 위에 캔버스를 겹쳐서
 * 해류/바람/파고 데이터를 색상 그라디언트 + 파티클 애니메이션으로 표현합니다.
 * Windy 스타일의 세련된 시각화를 구현합니다.
 *
 * [오버레이 레이어]
 * - current: 해류 (ROMS 유향·유속) → 파란색~빨간색 그라디언트 + 흐름 파티클
 * - wind: 바람 (기상청 풍향·풍속) → 초록색~보라색 그라디언트 + 바람 파티클
 * - wave: 파고 (해구 예보) → 청색~주황색 그라디언트
 *
 * [연계 파일]
 * - ocean_map.js → oceanOverlayInit(), oceanOverlayRefresh(), oceanOverlayClear()
 * - index.html → #ocean-overlay-canvas, .ocean-overlay-btn
 * ============================================================================
 */

(function () {
    'use strict';

    // ========================================================================
    // 색상 팔레트 (Windy 스타일)
    // ========================================================================

    const COLOR_SCALES = {
        // 해류 속도 (cm/s): 바다누리 범례 기준 m/s 환산
        // 0.0m/s=0  0.3m/s=30  0.5m/s=50  0.8m/s=80  1.1m/s=110  1.4m/s=140  1.6m/s=160
        current: [
            { val: 0,   color: [10,  30,  180, 0.85] },  // 진파랑  (0.0 m/s)
            { val: 30,  color: [30,  110, 235, 0.85] },  // 파랑    (0.3 m/s)
            { val: 50,  color: [30,  200, 210, 0.85] },  // 청록    (0.5 m/s)
            { val: 80,  color: [80,  220, 60,  0.85] },  // 연두    (0.8 m/s)
            { val: 110, color: [220, 230, 20,  0.90] },  // 노랑    (1.1 m/s)
            { val: 140, color: [240, 110, 15,  0.90] },  // 주황    (1.4 m/s)
            { val: 160, color: [220, 20,  20,  0.90] }   // 빨강    (1.6 m/s)
        ],
        // 풍속 (m/s): 0 → 25+ — Windy 앱 색상과 유사 (보라→파→청록→초록→노랑→주황→빨강)
        // 반투명하게 처리하여 지도가 비쳐 보임
        wind: [
            { val: 0,  color: [ 53,  42, 135, 0.70] },  // 진보라  (무풍)
            { val: 2,  color: [ 53,  95, 200, 0.72] },  // 파랑
            { val: 5,  color: [ 33, 160, 200, 0.74] },  // 하늘파랑
            { val: 8,  color: [ 30, 195, 155, 0.76] },  // 청록
            { val: 12, color: [ 50, 200,  60, 0.78] },  // 연두
            { val: 16, color: [230, 220,  20, 0.80] },  // 노랑
            { val: 20, color: [250, 130,  10, 0.83] },  // 주황
            { val: 25, color: [220,  20,  20, 0.86] }   // 빨강    (강풍)
        ],
        // 파고 (m): 0 → 5+ — Windy 파고 색상과 유사
        wave: [
            { val: 0,   color: [ 53,  42, 135, 0.68] }, // 진보라  (잔잔)
            { val: 0.3, color: [ 53,  95, 200, 0.70] }, // 파랑
            { val: 0.7, color: [ 33, 160, 200, 0.73] }, // 하늘파랑
            { val: 1.2, color: [ 30, 195, 155, 0.76] }, // 청록
            { val: 2.0, color: [230, 220,  20, 0.79] }, // 노랑
            { val: 3.0, color: [250, 130,  10, 0.82] }, // 주황
            { val: 4.0, color: [220,  20,  20, 0.85] }, // 빨강
            { val: 5.5, color: [150,  10,  80, 0.88] }  // 진빨강  (매우 높음)
        ]
    };

    // ========================================================================
    // 상태 변수
    // ========================================================================

    let canvas = null;              // 메인 캔버스 (파티클 + 합성)
    let ctx = null;
    let gridCanvas = null;          // 오프스크린 캔버스 (격자 색상 정적 렌더)
    let gridCtx = null;
    let mapRef = null;
    let activeLayer = 'current';   // 현재 표시 중인 오버레이
    let timelineOffsetHours = 0;   // 타임라인 슬라이더 오프셋 (현재 시각 기준 +N시간)
    let gridData = null;           // ROMS 격자 데이터
    let lonList = null;            // 정렬된 unique lon 배열 (보간용 인덱스)
    let latList = null;            // 정렬된 unique lat 배열
    let gridLookup = null;         // 'lonIdx_latIdx' → point 사전 (보간용)
    let animationId = null;        // 파티클 애니메이션 RAF ID
    let lastAnimTime = null;       // 델타타임 계산용 이전 프레임 타임스탬프
    let particles = [];            // 파티클 배열
    const BASE_PARTICLES = 1000;   // 줌 7 기준 입자 수 (실제는 줌에 따라 가변)
    let trailCanvas = null;        // 입자 트레일 전용 오프스크린 (페이드 누적)
    let trailCtx = null;
    let streamActive = false;      // 해류 시각화 ON/OFF (사용자 토글)
    let isMoving = false;          // 지도 이동/줌 중 플래그 (잔상 방지)
    let inited = false;            // oceanOverlayInit 1회 가드
    let landRings = null;          // 육지 마스크용 폴리곤 링 배열 (lon/lat 쌍)
    let _zoneCoordsList = null;    // 해구 좌표 캐시 (오버레이 무관, 바텀시트 클릭 판단용)
    let _canvasRepositioned = false; // 파티클 캔버스를 OL viewport 로 이동했는지

    // ========================================================================
    // 파티클 캔버스 위치 재배치
    // ------------------------------------------------------------------------
    // 목표: 레이어 쌓임 순서를 아래처럼 만들기
    //   [아래] tile (OL 기본 z:0)
    //          파티클 canvas (z:1)
    //          buoy / markers vector layer (OL setZIndex(100))
    //   [위]   .ol-overlaycontainer (내 위치 Overlay)
    //
    // 방법: 캔버스를 .ol-viewport 의 자식(= .ol-layers 의 형제) 으로 옮긴다.
    //       같은 viewport stacking context 안에서 z-index 로 정렬되고,
    //       OL 이 vector layer div 의 style.zIndex 를 setZIndex 값으로
    //       설정하므로 결과적으로 원하는 순서가 됨.
    //
    // 주의: 이전 시도에서 .ol-layers '안' 으로 넣었다가 OL 내부 관리 DOM 을
    //       건드려 파티클이 렌더 안 되는 회귀가 있었음. 이번엔 .ol-layers
    //       '밖' (viewport 의 형제 위치) 으로 이동하므로 OL 관리 영역 무침.
    // ========================================================================
    function _repositionOverlayCanvas() {
        if (_canvasRepositioned || !mapRef || !canvas) return;
        try {
            var viewport = mapRef.getViewport && mapRef.getViewport();
            if (!viewport) return;
            var layersEl = viewport.querySelector('.ol-layers');
            if (!layersEl) return;
            // .ol-layers 바로 다음 자리 = layersEl.nextSibling 앞에 삽입
            // (nextSibling 이 null 이면 appendChild 와 동일)
            viewport.insertBefore(canvas, layersEl.nextSibling);
            // viewport stacking context 기준으로 tile(0) 위, vector(100) 아래
            canvas.style.zIndex = '1';
            _canvasRepositioned = true;
        } catch (e) {
            // 이동 실패 시에도 기능 자체는 유지 (원래 위치에서 동작)
            console.warn('[OceanOverlay] 캔버스 재배치 실패:', e);
        }
    }

    // ========================================================================
    // 초기화
    // ========================================================================

    window.oceanOverlayInit = function (map) {
        mapRef = map;
        // 모드 B 재진입 시
        if (inited) {
            resizeCanvas();
            if (streamActive) {
                // 이전에 활성화된 레이어가 있었으면 버튼 상태 복원 + 데이터 재로드
                document.querySelectorAll('.ocean-overlay-btn[data-layer]').forEach(function (b) {
                    b.classList.toggle('active', b.dataset.layer === activeLayer);
                });
                loadOverlayData();
            }
            // streamActive=false면 캔버스가 이미 비어있으므로 별도 처리 불필요
            return;
        }
        canvas = document.getElementById('ocean-overlay-canvas');
        if (!canvas) return;
        ctx = canvas.getContext('2d');

        // 파티클 캔버스를 OL viewport 내부로 재배치 (z-index 쌓임 순서 맞추기)
        // 부이/마커(vector layer zIndex 100) 는 자동으로 파티클(z:1) 위에 쌓임
        _repositionOverlayCanvas();
        // 입자 트레일 전용 오프스크린 캔버스
        trailCanvas = document.createElement('canvas');
        trailCtx = trailCanvas.getContext('2d');
        inited = true;

        // 지도 이동/줌 시작 → 파티클 캔버스 숨기기 (잔상 방지)
        mapRef.on('movestart', function () {
            isMoving = true;
            if (canvas) canvas.style.visibility = 'hidden';
        });

        // 오프스크린 캔버스 생성 (격자 색상용 - 정적 렌더)
        gridCanvas = document.createElement('canvas');
        gridCtx = gridCanvas.getContext('2d');

        // 캔버스 크기를 지도에 맞춤
        resizeCanvas();

        // 오버레이 토글 버튼 바인딩 (current/wind/wave 3개 레이어 지원)
        // 같은 버튼 재클릭 → OFF, 다른 버튼 클릭 → 레이어 전환
        document.querySelectorAll('.ocean-overlay-btn[data-layer]').forEach(function (btn) {
            btn.classList.remove('active');
            btn.addEventListener('click', function () {
                var layer = this.dataset.layer;
                if (streamActive && activeLayer === layer) {
                    // 같은 레이어 토글 OFF
                    streamActive = false;
                    this.classList.remove('active');
                    window.oceanOverlayClear();
                    // 통합 박스(범례+타임라인) 숨김 — 타임라인은 범례 내부에 있으므로 함께 사라집니다
                    var legendEl = document.getElementById('ocean-legend');
                    if (legendEl) legendEl.style.display = 'none';
                } else {
                    // 레이어 전환 또는 ON
                    streamActive = true;
                    document.querySelectorAll('.ocean-overlay-btn[data-layer]').forEach(function (b) {
                        b.classList.remove('active');
                    });
                    this.classList.add('active');
                    // 오버레이 활성화 시 배경지도를 해안도로 자동 전환
                    if (window.switchToCoastBasemap) window.switchToCoastBasemap();
                    // 슬라이더 현재(0)로 초기화
                    timelineOffsetHours = 0;
                    var tlSlider = document.getElementById('ocean-timeline-slider');
                    if (tlSlider) tlSlider.value = 0;
                    // 조류: max 72h 고정 (KHOA 동적 범위 미제공), 바람/파고: 데이터 로드 후 동적 설정
                    if (layer === 'current' && window.setTimelineMax) window.setTimelineMax(72);
                    // 통합 박스(범례+타임라인)는 setActiveLayer 내부의 updateLegend가 표시하므로 별도 처리 불필요
                    setActiveLayer(layer);  // 내부에서 setTimelineStep, updateLegend 처리
                    loadOverlayData();
                }
            });
        });

        // 진입 시 자동 로드 안 함 — 사용자가 버튼을 눌러야 시작.

        // 해구 좌표 캐시 로드 (오버레이 무관, 바텀시트 클릭 판단용 — 1회만)
        if (!_zoneCoordsList) loadZoneCoordsList();

        // 육지 마스크 로드 (CDN: Natural Earth 110m land topojson)
        if (!landRings) loadLandMask();
    };

    window.oceanOverlayRefresh = function (map) {
        if (!canvas || !ctx) return;
        mapRef = map;
        resizeCanvas();
        // 줌/팬 후 트레일 잔상은 픽셀 좌표가 어긋나므로 지우고 새로 시작
        if (trailCtx && trailCanvas) {
            var tw = trailCanvas.width / (window.devicePixelRatio || 1);
            var th = trailCanvas.height / (window.devicePixelRatio || 1);
            trailCtx.clearRect(0, 0, tw, th);
        }
        if (particles && particles.length) {
            for (var i = 0; i < particles.length; i++) {
                particles[i].prevPx = null;
                particles[i].prevPy = null;
            }
        }
        renderGridToOffscreen();
        // 이동 종료 → 파티클 다시 표시
        isMoving = false;
        if (canvas && streamActive) canvas.style.visibility = 'visible';
    };

    /**
     * 오버레이를 강제로 끕니다.
     * ocean_map.js의 베이스맵 전환(기본맵/전자해도)에서 호출됩니다.
     * - 이미 OFF 상태이면 아무것도 하지 않습니다.
     * - ON 상태이면: 파티클 애니메이션 중단 → 캔버스 초기화 → 버튼 active 해제 → 통합박스 숨김
     */
    window.oceanOverlayTurnOff = function () {
        if (!streamActive) return; // 이미 꺼진 상태면 불필요
        streamActive = false;
        // 모든 오버레이 버튼의 active 표시 제거
        document.querySelectorAll('.ocean-overlay-btn[data-layer]').forEach(function (b) {
            b.classList.remove('active');
        });
        // 파티클 및 캔버스 초기화
        window.oceanOverlayClear();
        // 통합 박스(범례+타임라인) 숨김
        var legendEl = document.getElementById('ocean-legend');
        if (legendEl) legendEl.style.display = 'none';
    };

    window.oceanOverlayClear = function () {
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
        if (ctx) {
            var w = canvas.width / (window.devicePixelRatio || 1);
            var h = canvas.height / (window.devicePixelRatio || 1);
            ctx.clearRect(0, 0, w, h);
        }
        if (gridCtx) {
            gridCtx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
        }
        if (trailCtx && trailCanvas) {
            var tw = trailCanvas.width / (window.devicePixelRatio || 1);
            var th = trailCanvas.height / (window.devicePixelRatio || 1);
            trailCtx.clearRect(0, 0, tw, th);
        }
        particles = [];
        gridData = null;
        lonList = null;
        latList = null;
        gridLookup = null;
        lastAnimTime = null;
    };

    /**
     * 타임라인 슬라이더에서 호출: 오프셋(시간)을 받아 현재 활성 레이어 데이터를 재로드.
     * ocean_timeline.js → window.oceanOverlaySetTime(hours)
     */
    window.oceanOverlaySetTime = function (hours) {
        timelineOffsetHours = hours;
        if (!streamActive) return;
        loadOverlayData();
    };

    /** 현재 시각 + offsetHours → KHOA 포맷 { date: 'YYYYMMDD', hour: 'HH' } */
    function _offsetToDateHour(offsetHours) {
        var d = new Date();
        d.setHours(d.getHours() + offsetHours);
        return {
            date: String(d.getFullYear()) +
                  String(d.getMonth() + 1).padStart(2, '0') +
                  String(d.getDate()).padStart(2, '0'),
            hour: String(d.getHours()).padStart(2, '0')
        };
    }

    // ========================================================================
    // 캔버스 크기 조정
    // ========================================================================

    function resizeCanvas() {
        if (!canvas || !mapRef) return;
        var viewport = mapRef.getViewport();
        var rect = viewport.getBoundingClientRect();
        var dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';
        if (ctx) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        // 오프스크린 캔버스도 동일 크기
        if (gridCanvas) {
            gridCanvas.width = rect.width * dpr;
            gridCanvas.height = rect.height * dpr;
            if (gridCtx) {
                gridCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
            }
        }
        if (trailCanvas) {
            trailCanvas.width = rect.width * dpr;
            trailCanvas.height = rect.height * dpr;
            if (trailCtx) {
                trailCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
            }
        }
    }

    // ========================================================================
    // 오버레이 레이어 전환
    // ========================================================================

    function setActiveLayer(layer) {
        activeLayer = layer;
        // 레이어 전환 시 이전 데이터 및 캔버스 모두 초기화
        gridData = null;
        lonList = null; latList = null; gridLookup = null;
        particles = [];
        if (trailCtx && trailCanvas) {
            trailCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
        }
        if (gridCtx && gridCanvas) {
            gridCtx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
        }
        if (ctx && canvas) {
            var dpr = window.devicePixelRatio || 1;
            ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
        }
        // 타임라인 스텝 전환: 조류=1h, 바람/파고=3h
        if (window.setTimelineStep) {
            window.setTimelineStep(layer === 'current' ? 1 : 3);
        }
        updateLegend(layer);
    }

    function updateLegend(layer) {
        var scale = COLOR_SCALES[layer];
        var legendEl = document.getElementById('ocean-legend');
        var barEl = document.getElementById('ocean-legend-bar');
        var labelsEl = document.getElementById('ocean-legend-labels');
        var titleEl = document.getElementById('ocean-legend-title');
        if (!barEl || !labelsEl || !titleEl) return;

        // 범례 표시
        if (legendEl) legendEl.style.display = '';

        // 그라디언트 바 생성
        var colors = scale.map(function (s) {
            return 'rgba(' + s.color[0] + ',' + s.color[1] + ',' + s.color[2] + ',0.8)';
        });
        barEl.style.background = 'linear-gradient(to right, ' + colors.join(', ') + ')';

        // 라벨: current=바다누리 m/s 기준, wind=m/s, wave=m
        if (layer === 'current') {
            var knLabels = [0.0, 0.3, 0.5, 0.8, 1.1, 1.4, 1.6];
            labelsEl.innerHTML = knLabels.map(function (v) {
                return '<span>' + v.toFixed(1) + '</span>';
            }).join('');
        } else {
            labelsEl.innerHTML = scale.map(function (s) {
                return '<span>' + (Number.isInteger(s.val) ? s.val : s.val.toFixed(1)) + '</span>';
            }).join('');
        }

        // 제목
        var titles = {
            current: '조류 속도 (m/s)',
            wind: '풍속 (m/s)',
            wave: '유의파고 (m)'
        };
        titleEl.textContent = titles[layer] || '';
    }

    // ========================================================================
    // 데이터 로딩
    // ========================================================================

    function loadOverlayData() {
        if (!mapRef) return;
        if (activeLayer === 'current') {
            loadCurrentData();
        } else {
            loadZoneForecastData(activeLayer);
        }
    }

    function loadCurrentData() {
        var dh = _offsetToDateHour(timelineOffsetHours);
        console.log('[OceanOverlay] KHOA stream-vector 로드 시작');
        fetch('/api/ocean/khoa-stream-vector?date=' + dh.date + '&hour=' + dh.hour)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || !data.success || !data.points || data.points.length === 0) {
                    console.warn('[OceanOverlay] KHOA stream-vector 데이터 없음');
                    updateLegend(activeLayer);
                    return;
                }
                gridData = [];
                for (var i = 0; i < data.points.length; i++) {
                    var p = data.points[i];
                    if (p.s === 0 && p.d === 0 && p.temp === 0 && p.salt === 0 && p.zeta === 0) continue;
                    gridData.push({ lat: p.lat, lon: p.lon, crsp: p.s * 100, crdir: p.d });
                }
                console.log('[OceanOverlay] KHOA 격자 점 수:', gridData.length);
                updateLegend('current');
                renderGridToOffscreen();
                if (canvas) canvas.style.visibility = 'visible';
                isMoving = false;
                startParticleAnimation();
            })
            .catch(function (e) { console.warn('[OceanOverlay] KHOA 로드 실패:', e.message); });
    }

    /**
     * 해구별 기상전망(zone_forecasts)으로 바람/파고 오버레이 데이터를 로드합니다.
     * layer: 'wind' 또는 'wave'
     * - wind: crsp = ws(m/s), crdir = windDir → 속도별 색상 파티클 (배경 없음)
     * - wave: crsp = wh(m),   crdir = waveDir → 파고 배경 색상 + 파향 흰 파티클
     */
    function loadZoneForecastData(layer) {
        var timeParam = '';
        if (timelineOffsetHours !== 0) {
            var t = new Date();
            t.setHours(t.getHours() + timelineOffsetHours);
            timeParam = '?time=' + encodeURIComponent(t.toISOString());
        }

        fetch('/api/ocean/zone-forecasts' + timeParam)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || !data.success) {
                    console.warn('[OceanOverlay] zone-forecasts 데이터 없음');
                    return;
                }
                // 슬라이더 최대값을 실제 데이터 범위로 업데이트 (초기 로드 시 1회)
                if (data.maxForecastHours != null && window.setTimelineMax && timelineOffsetHours === 0) {
                    window.setTimelineMax(data.maxForecastHours);
                }
                gridData = buildGridFromZones(data.zones, layer);
                if (!gridData || gridData.length === 0) {
                    console.warn('[OceanOverlay] zone 격자 생성 실패 (데이터 없음)');
                    return;
                }
                lonList = null; // 인덱스 재빌드 강제
                buildGridIndex();
                updateLegend(layer);
                renderGridToOffscreen();
                // 캔버스 반드시 표시
                if (canvas) canvas.style.visibility = 'visible';
                isMoving = false;
                startParticleAnimation();
            })
            .catch(function (e) { console.warn('[OceanOverlay] zone-forecasts 로드 실패:', e.message); });
    }

    // ========================================================================
    // 육지 마스크 (해안선 내측 오버레이 제거)
    // ========================================================================

    /**
     * 서버 /api/ocean/land-mask에서 육지 링 배열을 로드합니다.
     * 서버가 @geo-maps 10km GeoJSON(가장 정밀) → Natural Earth 50m(fallback)
     * 순서로 시도하고 한반도 bbox로 잘라 반환합니다.
     * CDN 요청 없이 로컬 API만 호출 → 더 빠르고 안정적.
     */
    function loadLandMask() {
        fetch('/api/ocean/land-mask')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || !data.success || !data.rings) {
                    console.warn('[OceanOverlay] 육지 마스크 없음');
                    return;
                }
                landRings = data.rings;
                console.log('[OceanOverlay] 육지 마스크 로드 완료, rings:', landRings.length);
            })
            .catch(function (e) {
                console.warn('[OceanOverlay] 육지 마스크 로드 실패:', e.message);
            });
    }

    /**
     * 그리드 캔버스에 육지 마스크를 적용합니다.
     *
     * 별도 maskCanvas에 육지 폴리곤을 먼저 그린 뒤 destination-out으로 합성.
     * → targetCtx의 transform/state와 독립적으로 렌더링 가능.
     * → pixel 좌표가 화면 밖인 링은 그리지 않아 경로 오염 방지.
     */
    function applyLandMask(targetCtx, w, h) {
        if (!landRings || landRings.length === 0 || !mapRef) return;

        var dpr = window.devicePixelRatio || 1;
        var maskCanvas = document.createElement('canvas');
        maskCanvas.width  = Math.round(w * dpr);
        maskCanvas.height = Math.round(h * dpr);
        var mCtx = maskCanvas.getContext('2d');
        mCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        mCtx.fillStyle = 'black';

        for (var ri = 0; ri < landRings.length; ri++) {
            var ring = landRings[ri];
            mCtx.beginPath();
            var valid = false;
            for (var pi = 0; pi < ring.length; pi++) {
                var projected = ol.proj.fromLonLat(ring[pi]);
                var pixel = mapRef.getPixelFromCoordinate(projected);
                if (!pixel) { valid = false; break; }
                if (!valid) { mCtx.moveTo(pixel[0], pixel[1]); valid = true; }
                else mCtx.lineTo(pixel[0], pixel[1]);
            }
            if (valid) { mCtx.closePath(); mCtx.fill(); }
        }

        // 생성된 마스크를 destination-out으로 합성
        targetCtx.save();
        targetCtx.globalCompositeOperation = 'destination-out';
        targetCtx.setTransform(1, 0, 0, 1, 0, 0); // dpr transform 해제
        targetCtx.drawImage(maskCanvas, 0, 0);
        targetCtx.restore();
    }

    /**
     * 소해구 좌표 기반으로 완전한 격자를 생성합니다.
     *
     * 1. 소해구 데이터(~1295개)를 lat/lon 해시맵으로 인덱싱
     * 2. 0.5° 정규 격자를 전체 한반도 주변 해역에 걸쳐 생성
     * 3. 빈 셀은 인근 소해구 값으로 채움 (흰 공백 방지)
     * → bilinear 보간이 항상 4-corner를 찾을 수 있어 백색 공백이 사라짐
     */
    function buildGridFromZones(zones, layer) {
        // 소해구 데이터 → 빠른 위치 인덱스 구축
        // API 포맷 두 가지 지원:
        //   신규: { lat, lon, wh, ws, ... }  (zone_coords.json 기반)
        //   구형: { bounds:[ymin,ymax,xmin,xmax], wh, ws, ... }  (SEA_ZONES 기반)
        var zoneMap = {};
        var zonePts = [];
        Object.keys(zones).forEach(function (lzone) {
            var z = zones[lzone];

            // lat/lon 결정: 신규 포맷 우선, 없으면 bounds 중심점 사용
            var lat = z.lat;
            var lon = z.lon;
            if ((lat == null || lon == null) && z.bounds && z.bounds.length === 4) {
                lat = (z.bounds[0] + z.bounds[1]) / 2;
                lon = (z.bounds[2] + z.bounds[3]) / 2;
            }
            if (lat == null || lon == null) return;

            // -999 결측값 제외
            var crsp = (layer === 'wind') ? z.ws : z.wh;
            if (crsp == null || crsp < 0) return;

            var val = {
                crsp:  crsp,
                crdir: (layer === 'wind') ? (z.windDir || 0) : (z.waveDir || 0)
            };
            // 0.5° 격자에 스냅 (zone_coords.json의 미세 오차 보정: x.24→x.25, x.76→x.75 등)
            lat = Math.round((parseFloat(lat) - 0.25) / 0.5) * 0.5 + 0.25;
            lon = Math.round((parseFloat(lon) - 0.25) / 0.5) * 0.5 + 0.25;
            lat = Math.round(lat * 100) / 100;
            lon = Math.round(lon * 100) / 100;
            var key = lat.toFixed(2) + '_' + lon.toFixed(2);
            zoneMap[key] = val;
            zonePts.push({ lat: parseFloat(lat), lon: parseFloat(lon), crsp: val.crsp, crdir: val.crdir });
        });

        if (zonePts.length === 0) return [];

        // 소해구 데이터가 있는 셀만 표시 (nearest-neighbor 채움 없음)
        var pts = [];
        var STEP = 0.5;
        var LAT_MIN = 24.25, LAT_MAX = 45.75;
        var LON_MIN = 118.25, LON_MAX = 141.75;

        for (var lat = LAT_MIN; lat <= LAT_MAX + 0.01; lat = Math.round((lat + STEP) * 100) / 100) {
            for (var lon = LON_MIN; lon <= LON_MAX + 0.01; lon = Math.round((lon + STEP) * 100) / 100) {
                var key = lat.toFixed(2) + '_' + lon.toFixed(2);
                var val = zoneMap[key];

                if (val) {
                    pts.push({ lat: lat, lon: lon, crsp: val.crsp, crdir: val.crdir });
                }
            }
        }
        return pts;
    }

    /**
     * (lat, lon) 주변에서 가장 가까운 소해구 값을 나선형으로 탐색합니다.
     * zoneMap 키는 "lat.toFixed(2)_lon.toFixed(2)" 형식.
     */
    function findNearestZoneVal(lat, lon, zoneMap, step) {
        for (var r = 1; r <= 8; r++) {
            for (var dRow = -r; dRow <= r; dRow++) {
                for (var dCol = -r; dCol <= r; dCol++) {
                    if (Math.abs(dRow) !== r && Math.abs(dCol) !== r) continue; // 경계만
                    var tLat = Math.round((lat + dRow * step) * 100) / 100;
                    var tLon = Math.round((lon + dCol * step) * 100) / 100;
                    var k = tLat.toFixed(2) + '_' + tLon.toFixed(2);
                    if (zoneMap[k]) return zoneMap[k];
                }
            }
        }
        return null;
    }

    // ========================================================================
    // 렌더링
    // ========================================================================

    /**
     * 격자 색상을 오프스크린 캔버스에 렌더링 (정적 레이어)
     * animate()에서 매 프레임 이 이미지를 합성하여 파티클과 함께 표시
     */
    /**
     * 격자 인덱스 빌드 — 정렬된 lon/lat 리스트와 (lonIdx, latIdx) → point 사전.
     * 격자가 정규 격자(lat 동일, lon 동일이 행/열을 이룸)라는 KHOA 데이터 특성을 활용.
     * sampleAt() 의 쌍선형 보간에 사용된다.
     */
    function buildGridIndex() {
        if (!gridData || gridData.length === 0) return;
        var lonSet = {}, latSet = {};
        for (var i = 0; i < gridData.length; i++) {
            lonSet[gridData[i].lon] = true;
            latSet[gridData[i].lat] = true;
        }
        lonList = Object.keys(lonSet).map(parseFloat).sort(function (a, b) { return a - b; });
        latList = Object.keys(latSet).map(parseFloat).sort(function (a, b) { return a - b; });
        var lonIdx = {}, latIdx = {};
        for (var k = 0; k < lonList.length; k++) lonIdx[lonList[k]] = k;
        for (var m = 0; m < latList.length; m++) latIdx[latList[m]] = m;
        gridLookup = {};
        for (var n = 0; n < gridData.length; n++) {
            var p = gridData[n];
            gridLookup[lonIdx[p.lon] + '_' + latIdx[p.lat]] = p;
        }
    }

    // 정렬 배열 sortedArr 에서 value 보다 크지 않은 마지막 인덱스를 찾는다 (이진탐색).
    function lowerBound(sortedArr, value) {
        var lo = 0, hi = sortedArr.length - 1;
        if (value < sortedArr[0]) return -1;
        if (value >= sortedArr[hi]) return hi;
        while (lo < hi) {
            var mid = (lo + hi + 1) >> 1;
            if (sortedArr[mid] <= value) lo = mid; else hi = mid - 1;
        }
        return lo;
    }

    /**
     * 소해구 격자용 nearest-cell 조회.
     * bilinear 보간(sampleAt)은 4개 코너 모두 필요 → 육지 경계에서 null 다발.
     * 이 함수는 가장 가까운 0.5° 셀을 직접 조회 → 있으면 반환, 없으면 null.
     */
    function lookupNearest(lon, lat) {
        if (!lonList || !latList || !gridLookup) return null;
        // 0.5° 격자(x.25/x.75)에 스냅
        var snapLon = Math.round((lon - 0.25) / 0.5) * 0.5 + 0.25;
        var snapLat = Math.round((lat - 0.25) / 0.5) * 0.5 + 0.25;
        snapLon = Math.round(snapLon * 100) / 100;
        snapLat = Math.round(snapLat * 100) / 100;
        var li = lowerBound(lonList, snapLon);
        var la = lowerBound(latList, snapLat);
        if (li < 0 || la < 0) return null;
        // 정확히 일치하는 셀만 반환 (데이터 없는 셀은 null → 투명 처리)
        if (Math.abs(lonList[li] - snapLon) > 0.01 || Math.abs(latList[la] - snapLat) > 0.01) return null;
        return gridLookup[li + '_' + la] || null;
    }

    /**
     * 바람/파고용 쌍선형 보간 (일부 코너 누락 허용).
     *
     * 기존 sampleAt()은 4코너 모두 필요 → 육지 인접 셀에서 null 다발 → 격자 경계 선명.
     * 이 함수는 1~4개 코너 중 있는 것만으로 가중평균 → 격자 경계가 부드럽게 블렌딩.
     * (lookupNearest 대비: 셀 중심값 그대로 반환 → 확대 시 직사각형 패턴 발생)
     */
    function sampleAtLenient(lon, lat) {
        if (!lonList || !latList || !gridLookup) return null;
        var li = lowerBound(lonList, lon);
        var la = lowerBound(latList, lat);
        if (li < 0 || la < 0) return null;

        // 외삽 방지: 데이터 격자 마지막 경계를 0.3° 이상 초과하면 null
        // (내부 빈 칸은 li+1/la+1이 존재하므로 이 조건에 걸리지 않음)
        var HALF_STEP = 0.3;
        if (li + 1 >= lonList.length && lon > lonList[li] + HALF_STEP) return null;
        if (la + 1 >= latList.length && lat > latList[la] + HALF_STEP) return null;
        if (lon < lonList[0] - HALF_STEP) return null;
        if (lat < latList[0] - HALF_STEP) return null;

        var p00 = gridLookup[li + '_' + la] || null;
        var p10 = (li + 1 < lonList.length) ? (gridLookup[(li+1) + '_' + la] || null) : null;
        var p01 = (la + 1 < latList.length) ? (gridLookup[li + '_' + (la+1)] || null) : null;
        var p11 = (li + 1 < lonList.length && la + 1 < latList.length)
                  ? (gridLookup[(li+1) + '_' + (la+1)] || null) : null;

        if (!p00 && !p10 && !p01 && !p11) return null;

        var fx = (li + 1 < lonList.length)
                 ? (lon - lonList[li]) / (lonList[li+1] - lonList[li]) : 0;
        var fy = (la + 1 < latList.length)
                 ? (lat - latList[la]) / (latList[la+1] - latList[la]) : 0;

        var w00 = (1-fx)*(1-fy), w10 = fx*(1-fy);
        var w01 = (1-fx)*fy,    w11 = fx*fy;
        var wSum = (p00?w00:0) + (p10?w10:0) + (p01?w01:0) + (p11?w11:0);
        if (wSum < 0.01) return null;

        var s = 0;
        if (p00) s += p00.crsp * w00;
        if (p10) s += p10.crsp * w10;
        if (p01) s += p01.crsp * w01;
        if (p11) s += p11.crsp * w11;
        s /= wSum;

        function vec(d) { var r = d * Math.PI / 180; return [Math.sin(r), Math.cos(r)]; }
        var sx = 0, sy = 0;
        if (p00) { var v0=vec(p00.crdir); sx+=v0[0]*w00; sy+=v0[1]*w00; }
        if (p10) { var v1=vec(p10.crdir); sx+=v1[0]*w10; sy+=v1[1]*w10; }
        if (p01) { var v2=vec(p01.crdir); sx+=v2[0]*w01; sy+=v2[1]*w01; }
        if (p11) { var v3=vec(p11.crdir); sx+=v3[0]*w11; sy+=v3[1]*w11; }
        sx /= wSum; sy /= wSum;
        var d = Math.atan2(sx, sy) * 180 / Math.PI;
        if (d < 0) d += 360;
        return { crsp: s, crdir: d };
    }

    function sampleAt(lon, lat) {
        if (!lonList || !latList || !gridLookup) return null;
        var li = lowerBound(lonList, lon);
        var la = lowerBound(latList, lat);
        if (li < 0 || li >= lonList.length - 1) return null;
        if (la < 0 || la >= latList.length - 1) return null;
        var p00 = gridLookup[li + '_' + la];
        var p10 = gridLookup[(li + 1) + '_' + la];
        var p01 = gridLookup[li + '_' + (la + 1)];
        var p11 = gridLookup[(li + 1) + '_' + (la + 1)];
        if (!p00 || !p10 || !p01 || !p11) return null;
        var fx = (lon - lonList[li]) / (lonList[li + 1] - lonList[li]);
        var fy = (lat - latList[la]) / (latList[la + 1] - latList[la]);
        var s = (p00.crsp * (1 - fx) + p10.crsp * fx) * (1 - fy) +
                (p01.crsp * (1 - fx) + p11.crsp * fx) * fy;
        // 방향은 sin/cos 로 분해해서 보간 (도 단위 직접 평균하면 0/360 경계에서 깨짐)
        function vec(d) { var r = d * Math.PI / 180; return [Math.sin(r), Math.cos(r)]; }
        var v00 = vec(p00.crdir), v10 = vec(p10.crdir), v01 = vec(p01.crdir), v11 = vec(p11.crdir);
        var sx = (v00[0] * (1 - fx) + v10[0] * fx) * (1 - fy) + (v01[0] * (1 - fx) + v11[0] * fx) * fy;
        var sy = (v00[1] * (1 - fx) + v10[1] * fx) * (1 - fy) + (v01[1] * (1 - fx) + v11[1] * fx) * fy;
        var d = Math.atan2(sx, sy) * 180 / Math.PI;
        if (d < 0) d += 360;
        return { crsp: s, crdir: d };
    }

    /**
     * 색상 격자 렌더링 — 화면을 저해상도(STEP px)로 샘플링하여
     * 각 픽셀에서 sampleAt() 으로 쌍선형 보간한 값을 색으로 환산.
     * 이 저해상도 ImageData 를 캔버스 크기로 부드럽게 확대(drawImage smoothing)
     * 해서 매끄러운 색면을 얻는다. 줌인할수록 같은 격자 영역에 더 많은 픽셀이
     * 들어가 자동으로 더 섬세해 보인다.
     */
    function renderGridToOffscreen() {
        if (!gridCtx || !gridCanvas || !gridData || !mapRef) return;
        if (!lonList) buildGridIndex();

        var dpr = window.devicePixelRatio || 1;
        var w = gridCanvas.width / dpr;
        var h = gridCanvas.height / dpr;
        gridCtx.clearRect(0, 0, w, h);

        var scale = COLOR_SCALES[activeLayer];
        var STEP = 4; // 4px 단위 샘플링 → 속도/품질 균형
        var imgW = Math.max(1, Math.ceil(w / STEP));
        var imgH = Math.max(1, Math.ceil(h / STEP));

        var tmp = document.createElement('canvas');
        tmp.width = imgW;
        tmp.height = imgH;
        var tctx = tmp.getContext('2d');
        var idata = tctx.createImageData(imgW, imgH);
        var data = idata.data;

        for (var py = 0; py < imgH; py++) {
            for (var px = 0; px < imgW; px++) {
                var sx = px * STEP;
                var sy = py * STEP;
                var coord = mapRef.getCoordinateFromPixel([sx, sy]);
                if (!coord) continue;
                var ll = ol.proj.toLonLat(coord);
                // current(ROMS): 밀집 정규 격자 → bilinear 보간
                // wind/wave(소해구): 0.5° 격자 → lenient bilinear(일부 코너 누락 허용)
                //   lookupNearest 대신 sampleAtLenient: 셀 경계에서 값 보간 → 격자 느낌 제거
                var samp = (activeLayer === 'current') ? sampleAt(ll[0], ll[1]) : sampleAtLenient(ll[0], ll[1]);
                if (!samp) continue;
                // crsp는 레이어별 네이티브 단위:
                // current=cm/s, wind=m/s, wave=m → 각 COLOR_SCALES과 단위 일치
                var value = samp.crsp;

                var color = interpolateColor(scale, value);
                var i = (py * imgW + px) * 4;
                data[i]     = color[0];
                data[i + 1] = color[1];
                data[i + 2] = color[2];
                data[i + 3] = Math.round((color[3] || 0.6) * 255);
            }
        }
        tctx.putImageData(idata, 0, 0);

        // blur: 0.5° 해구가 화면에서 차지하는 픽셀 크기에 비례 적용
        // resolution(m/px)로 환산 → 줌인할수록 격자가 크게 보이므로 blur도 크게
        var resolution = mapRef.getView().getResolution(); // m/px
        var zonePx = (0.5 * 111000) / resolution;         // 0.5° ≈ 55km → 화면 픽셀 수
        var blurPx = Math.max(3, Math.min(Math.round(zonePx * 0.18), 60));
        gridCtx.imageSmoothingEnabled = true;
        gridCtx.imageSmoothingQuality = 'high';
        gridCtx.filter = 'blur(' + blurPx + 'px)';
        gridCtx.drawImage(tmp, 0, 0, w, h);
        gridCtx.filter = 'none';

        // 육지 영역 펀치아웃: 해안선 내측 오버레이 제거
        applyLandMask(gridCtx, w, h);
    }

    /**
     * 색상 스케일에서 값에 해당하는 색상을 보간
     */
    function interpolateColor(scale, value) {
        if (value <= scale[0].val) return scale[0].color;
        if (value >= scale[scale.length - 1].val) return scale[scale.length - 1].color;

        for (var i = 0; i < scale.length - 1; i++) {
            if (value >= scale[i].val && value <= scale[i + 1].val) {
                var t = (value - scale[i].val) / (scale[i + 1].val - scale[i].val);
                return [
                    Math.round(scale[i].color[0] + t * (scale[i + 1].color[0] - scale[i].color[0])),
                    Math.round(scale[i].color[1] + t * (scale[i + 1].color[1] - scale[i].color[1])),
                    Math.round(scale[i].color[2] + t * (scale[i + 1].color[2] - scale[i].color[2])),
                    scale[i].color[3] + t * (scale[i + 1].color[3] - scale[i].color[3])
                ];
            }
        }
        return scale[0].color;
    }

    // ========================================================================
    // 파티클 애니메이션
    // ========================================================================

    function startParticleAnimation() {
        if (animationId) cancelAnimationFrame(animationId);
        if (!gridData || gridData.length === 0) return;
        if (!lonList) buildGridIndex();

        // 줌이 깊을수록 입자 더 조밀하게 — 같은 화면 면적에 더 많이 떨어뜨려
        // 듬성듬성 보이지 않게 한다.
        var zoom = mapRef.getView().getZoom();
        var count = Math.round(BASE_PARTICLES * Math.pow(1.35, zoom - 7));
        if (count < 400) count = 400;
        if (count > 2500) count = 2500;

        particles = [];
        for (var i = 0; i < count; i++) {
            particles.push(createParticle());
        }

        // 트레일 캔버스 초기화
        if (trailCtx && trailCanvas) {
            var tw = trailCanvas.width / (window.devicePixelRatio || 1);
            var th = trailCanvas.height / (window.devicePixelRatio || 1);
            trailCtx.clearRect(0, 0, tw, th);
        }

        lastAnimTime = null; // 델타타임 리셋 (이전 애니메이션 잔류값 방지)
        animationId = requestAnimationFrame(animate);
    }

    /**
     * 파티클 생성: 화면(viewport) 안에서 랜덤 좌표에 떨어뜨린다.
     * 좌표는 EPSG:3857(map projection coord)로 저장 — 줌/팬해도 같은 절대 좌표.
     * prevPx/prevPy 는 이전 프레임의 픽셀 좌표(트레일 선분 그릴 때 사용).
     */
    function createParticle() {
        if (!mapRef) return { x: 0, y: 0, age: 0, maxAge: 80, prevPx: null, prevPy: null };

        var view = mapRef.getView();
        var extent = view.calculateExtent(mapRef.getSize());
        var w = (extent[2] - extent[0]);
        var h = (extent[3] - extent[1]);

        return {
            x: extent[0] + Math.random() * w,
            y: extent[1] + Math.random() * h,
            age: Math.floor(Math.random() * 60),
            maxAge: 60 + Math.floor(Math.random() * 40),
            prevPx: null,
            prevPy: null
        };
    }

    function animate(timestamp) {
        if (!ctx || !canvas || !mapRef || !gridData) return;

        // 델타타임 계산: 화면 주사율(60/90/120Hz)에 관계없이 같은 속도로 이동
        // delta=1.0이 60fps 기준. 120Hz에서는 delta≈0.5, 30fps에서는 delta≈2.0
        var delta = 1.0;
        if (lastAnimTime != null && timestamp != null) {
            var elapsed = timestamp - lastAnimTime;
            // 탭 복귀·백그라운드 후 큰 시간 점프 방지: 3프레임 이내로 클램프
            delta = Math.min(3.0, Math.max(0.1, elapsed / (1000 / 60)));
        }
        lastAnimTime = timestamp || null;

        var w = canvas.width / (window.devicePixelRatio || 1);
        var h = canvas.height / (window.devicePixelRatio || 1);
        var scale = COLOR_SCALES[activeLayer];

        // 지도 이동/줌 중에는 캔버스를 비우고 대기 (잔상 방지)
        if (isMoving) {
            ctx.clearRect(0, 0, w, h);
            lastAnimTime = null; // 이동 후 재시작 시 델타 점프 방지
            animationId = requestAnimationFrame(animate);
            return;
        }

        // ─── 해류/바람/파고: 파티클 트레일 ───
        var isWind = (activeLayer === 'wind');
        var isWave = (activeLayer === 'wave');

        // ① 트레일 페이드
        // - wave: 꼬리 길이 길게 (값 작을수록 잔상 오래 유지)
        // - wind/current: 기존 동일
        if (trailCtx) {
            trailCtx.globalCompositeOperation = 'destination-out';
            trailCtx.fillStyle = isWave ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.15)'; // wave: 꼬리 2/3 길이
            trailCtx.fillRect(0, 0, w, h);
            trailCtx.globalCompositeOperation = 'source-over';
        }

        // ② 입자 이동 + 트레일 그리기
        // SPEED_SCALE: 레이어별 단위 보정 (바람·파고는 모바일 고속 방지를 위해 기존 대비 1/2)
        // - current: ×100 (기준 유지)
        // - wind:    ×10 → ×5  (1/2 감속)
        // - wave:    ×50 → ×25 (1/2 감속)
        var resolution = mapRef.getView().getResolution();
        var SPEED_SCALE = isWave ? (0.015 * resolution * 25)
                        : isWind ? (0.015 * resolution * 5)
                                 : (0.015 * resolution * 100);

        particles.forEach(function (p) {
            var lonLat = ol.proj.toLonLat([p.x, p.y]);
            var nearest = (activeLayer === 'current') ? sampleAt(lonLat[0], lonLat[1]) : lookupNearest(lonLat[0], lonLat[1]);

            var spdValue = 0;
            if (nearest) {
                var dirRad = (nearest.crdir || 0) * Math.PI / 180;
                var spdMps = isWave ? 1.0                          // 파고: 파향만 사용, 고정 속도
                           : isWind ? (nearest.crsp || 0)          // 바람: m/s 그대로
                                    : (nearest.crsp || 0) * 0.01;  // 해류: cm/s → m/s
                spdValue = nearest.crsp || 0;

                p.x += Math.sin(dirRad) * spdMps * SPEED_SCALE * delta;
                p.y -= Math.cos(dirRad) * spdMps * SPEED_SCALE * delta;
            }

            p.age++;
            var minSpeed = isWave ? 0.0    // 파고: 파향 있으면 무조건 표시
                         : isWind ? 0.05   // 바람: m/s 최소
                                  : 0.1;   // 해류: cm/s 최소
            if (p.age > p.maxAge || !nearest || spdValue < minSpeed) {
                var newP = createParticle();
                p.x = newP.x; p.y = newP.y; p.age = 0;
                p.prevPx = null; p.prevPy = null;
                return;
            }

            var pixel = mapRef.getPixelFromCoordinate([p.x, p.y]);
            if (!pixel) return;
            var px = pixel[0], py = pixel[1];

            if (px < 0 || py < 0 || px > w || py > h) {
                var np = createParticle();
                p.x = np.x; p.y = np.y; p.age = 0;
                p.prevPx = null; p.prevPy = null;
                return;
            }

            if (trailCtx && p.prevPx !== null) {
                if (isWave) {
                    // 파고: 배경 색상 위에 흰 트레일 (파향 방향, 긴 꼬리)
                    trailCtx.strokeStyle = 'rgba(255,255,255,0.65)';
                    trailCtx.lineWidth = 1.0;
                } else {
                    // 바람/해류: 속도별 색상 트레일 (배경 없음)
                    var col = interpolateColor(scale, spdValue);
                    trailCtx.strokeStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',0.78)';
                    trailCtx.lineWidth = isWind ? (0.8 + Math.min(1.2, spdValue / 15))
                                                : (0.8 + Math.min(1.2, spdValue / 40));
                }
                trailCtx.lineCap = 'round';
                trailCtx.beginPath();
                trailCtx.moveTo(p.prevPx, p.prevPy);
                trailCtx.lineTo(px, py);
                trailCtx.stroke();
            }
            p.prevPx = px;
            p.prevPy = py;
        });

        // ③ 합성
        // - 파고: 파고 높이 배경 색상 + 흰 파향 트레일
        // - 바람/해류: 트레일만 (배경 색상 없음)
        ctx.clearRect(0, 0, w, h);
        if (isWave && gridCanvas) ctx.drawImage(gridCanvas, 0, 0, w, h);
        if (trailCanvas) ctx.drawImage(trailCanvas, 0, 0, w, h);

        animationId = requestAnimationFrame(animate);
    }

    function findNearestGrid(lat, lon) {
        if (!gridData || gridData.length === 0) return null;

        var closest = null;
        var minDist = Infinity;

        for (var i = 0; i < gridData.length; i++) {
            var item = gridData[i];
            var dLat = item.lat - lat;
            var dLon = item.lon - lon;
            var dist = dLat * dLat + dLon * dLon;
            if (dist < minDist) {
                minDist = dist;
                closest = item;
            }
        }
        return closest;
    }

    // ──────────────────────────────────────────────
    // 해구 좌표 캐시: 오버레이 상태와 무관하게 1회 로드
    // 바텀시트 클릭 가능 영역 판단에 사용
    // ──────────────────────────────────────────────
    function loadZoneCoordsList() {
        fetch('/api/ocean/zone-forecasts')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || !data.success || !data.zones) return;
                _zoneCoordsList = [];
                var keys = Object.keys(data.zones);
                for (var i = 0; i < keys.length; i++) {
                    var z = data.zones[keys[i]];
                    if (z.lat != null && z.lon != null) {
                        _zoneCoordsList.push({ lat: z.lat, lon: z.lon });
                    }
                }
            })
            .catch(function () { /* silent */ });
    }

    // ──────────────────────────────────────────────
    // 외부 노출: 해당 좌표에 해구 데이터가 존재하는지 확인
    // 오버레이 ON/OFF와 무관하게, 해구 좌표 캐시 기준 판단
    // 최근접 해구와의 거리가 0.35° 이내이면 true
    // ──────────────────────────────────────────────
    window.hasOceanGridData = function (lat, lon) {
        if (!_zoneCoordsList || _zoneCoordsList.length === 0) return false;
        var minDist = Infinity;
        for (var i = 0; i < _zoneCoordsList.length; i++) {
            var item = _zoneCoordsList[i];
            var dLat = item.lat - lat;
            var dLon = item.lon - lon;
            var dist = dLat * dLat + dLon * dLon;
            if (dist < minDist) minDist = dist;
        }
        return Math.sqrt(minDist) <= 0.35;
    };

})();
