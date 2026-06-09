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
 * [오버레이 레이어] — 모두 배경 색상(히트맵) + 흰 파티클 트레일
 * - current: 해류 (ROMS 유향·유속) → 청색~빨강 배경 + 흰 파티클 (속도별 굵기)
 * - wind:    바람 (기상청 풍향·풍속) → 보라~빨강 배경 + 흰 파티클 (속도별 굵기)
 * - wave:    파고 (해구 예보)        → 보라~빨강 배경 + 흰 파티클 (파향, 굵기 고정)
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
            // val=0 알파를 거의 투명(0.05)으로 두어, 잠잠한 바다(<0.1 m/s)는 지도 배경이
            // 그대로 보이도록 함. interpolateColor 가 알파도 선형 보간 → 0~0.3 m/s 구간이
            // 자연스러운 fade-in (0.0=거의투명 → 0.1=옅은파랑 → 0.3=선명한파랑).
            // 주의: 0(falsy)으로 두면 renderGridToOffscreen 의 `color[3] || 0.6` 폴백에
            // 걸려 오히려 진해짐. 반드시 truthy 한 0.05 사용.
            { val: 0,   color: [10,  30,  180, 0.05] },  // 진파랑(거의 투명) (0.0 m/s)
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

    // ========================================================================
    // 파티클 캔버스 오프스크린화
    // ------------------------------------------------------------------------
    // [왜?]
    //  OpenLayers 8 은 composite 렌더 모드로 tile/vector 를 하나의 합성
    //  canvas 에 그림. 따라서 DOM z-index 조작만으로는 vector(부이/마커)를
    //  파티클 위로 올릴 수 없음.
    //
    //  대신, 파티클 canvas 를 "오프스크린 버퍼" 로 사용하고, vector layer 의
    //  prerender 이벤트에서 OL 합성 canvas 에 drawImage 로 파티클을 얹는다.
    //
    // [안전]
    //  display:none 이어도 Canvas API(getContext / drawImage / clearRect 등)
    //  는 모두 정상 동작. resizeCanvas() 는 viewport 기준이라 display 영향 없음.
    // ========================================================================
    function _hideOverlayCanvas() {
        if (!canvas) return;
        canvas.style.display = 'none';
    }

    // ========================================================================
    // 파티클 합성 훅: 전용 "합성용 vector layer" 의 prerender 이벤트
    // ------------------------------------------------------------------------
    // [역할]
    //  OL 합성 canvas 에 그려지는 순서에 끼어들어, 오프스크린 파티클
    //  canvas 를 drawImage 로 얹는다.
    //  결과 쌓임: tile → 파티클 → (부이/마커 vector) → overlay(내 위치)
    //
    // [왜 전용 layer 를 쓰는가?]
    //  - 기존 vector layer(부이/마커)의 prerender 에 훅을 걸 수도 있지만,
    //    그 layer 들은 사용자가 "기상부이"/"주요지명" 버튼을 누를 때만
    //    추가되므로 버튼 OFF 상태에선 훅이 발생하지 않아 파티클이 안 보임.
    //  - 전용으로 빈 Vector layer 를 즉시 추가하면 항상 존재하므로
    //    버튼 ON/OFF 에 무관하게 파티클이 합성됨.
    //  - 빈 source 라 렌더 비용 거의 없음. prerender 이벤트만 이용.
    //
    // [왜 prerender 가 postrender 보다 안전?]
    //  - tile layer 의 postrender: tile 이 캐시되면 이벤트가 skip 될 수 있음
    //  - vector layer 의 prerender: vector 는 interactive 하여 매 render()
    //    마다 재렌더 → 이벤트 확실히 발생
    //
    // [zIndex]
    //  - 1 : tile(기본 0) 바로 위, 부이/마커(100) 아래 → 자연스러운 쌓임
    //
    // [연계]
    //  - ocean_buoy.js / ocean_markers.js — vector layer zIndex:100 로 추가
    //  - .ol-overlaycontainer — 내 위치 Overlay (z-index 200 in index2.html)
    // ========================================================================
    let _compositeLayer = null;

    function _onCompositePrerender(re) {
        // 렌더 가능한 조건이 하나라도 빠지면 조용히 스킵
        if (!canvas || !streamActive) return;
        if (!re || !re.context) return;
        if (canvas.width === 0 || canvas.height === 0) return;

        try {
            var targetCtx = re.context;
            var target = targetCtx.canvas;
            // 합성 canvas 와 파티클 canvas 모두 동일한 DPR 반영 픽셀 크기이므로
            // 1:1 복사 가능. 다른 transform 이 걸려있을 수 있어 reset 후 drawImage.
            targetCtx.save();
            targetCtx.setTransform(1, 0, 0, 1, 0, 0);
            targetCtx.drawImage(canvas, 0, 0, target.width, target.height);
            targetCtx.restore();
        } catch (err) {
            // 어떤 이유로든 합성 실패 시 파티클만 누락될 뿐, OL 자체는 영향 없음
        }
    }

    /**
     * 파티클 캔버스를 OL Layer 위에 합성(compositing) 시키기 위한 hook 설정.
     * 이미 _compositeLayer 가 있거나 지도 미준비면 no-op.
     * 한 번만 호출되며 _compositeLayer 가 설정되면 다시 진입 안 함 (멱등).
     */
    function _hookParticleCompositing() {
        if (_compositeLayer || !mapRef || !window.ol) return;
        // 빈 vector layer 를 하나 만들어 OL 에 추가.
        // 실제 그리는 것은 없지만 prerender 이벤트는 매 render() 마다 발생.
        _compositeLayer = new ol.layer.Vector({
            source: new ol.source.Vector(),
            zIndex: 1,
            updateWhileAnimating: true,
            updateWhileInteracting: true
        });
        _compositeLayer.on('prerender', _onCompositePrerender);
        mapRef.addLayer(_compositeLayer);
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

        // 파티클 canvas 를 오프스크린 버퍼로 사용 — 화면에서는 숨김.
        _hideOverlayCanvas();

        // 첫 vector layer 의 prerender 이벤트에 drawImage 훅 바인딩.
        // 이 시점에 아직 vector layer 가 없으면 layers 'add' 이벤트로 후속 감시.
        _hookParticleCompositing();
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
                    // [2026-05] OFF 시 KHOA 토스트/재시도/로딩 인디케이터 정리
                    _hideKhoaUnavailableToast();
                    _cancelKhoaRetry();
                    _hideCurrentLoadingIndicator();
                    window.oceanOverlayClear();
                    // 통합 박스(범례+타임라인) 숨김 — 타임라인은 범례 내부에 있으므로 함께 사라집니다
                    var legendEl = document.getElementById('ocean-legend');
                    if (legendEl) legendEl.style.display = 'none';
                } else {
                    // 레이어 전환 또는 ON
                    // [Mutual Exclusion] 단기예보 raster (기타기상) 가 활성 상태면 끔
                    if (typeof window._shrtForecastDeactivate === 'function') {
                        try { window._shrtForecastDeactivate(); } catch (e) {}
                    }
                    // [Mutual Exclusion] 시정예측 raster 가 활성 상태면 끔
                    if (typeof window._vsbyForecastDeactivate === 'function') {
                        try { window._vsbyForecastDeactivate(); } catch (e) {}
                    }
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
                    // [사용량] 오버레이 버튼 켤 때 +1 (통합 key: ocean.current/wind/wave)
                    if (window.trackUsage) {
                        var _ovKey = (layer === 'wind') ? 'ocean.wind'
                            : (layer === 'wave') ? 'ocean.wave'
                            : 'ocean.current';
                        window.trackUsage(_ovKey);
                    }
                }
            });
        });

        // 진입 시 자동 로드 안 함 — 사용자가 버튼을 눌러야 시작.

        // [사용량] 타임라인 슬라이더 "놓을 때마다"(change=settle) 활성 레이어 통합 key +1.
        //   'input'(드래그 중 연속)은 카운트하지 않음 → 폭주 방지. 오버레이가 켜져있을 때만.
        (function bindOverlayTimelineUsage() {
            var tlSlider = document.getElementById('ocean-timeline-slider');
            if (!tlSlider || tlSlider._usageBound) return;
            tlSlider._usageBound = true;
            tlSlider.addEventListener('change', function () {
                if (!streamActive) return;            // 오버레이 OFF면 카운트 안 함
                if (!window.trackUsage) return;
                var k = (activeLayer === 'wind') ? 'ocean.wind'
                    : (activeLayer === 'wave') ? 'ocean.wave'
                    : 'ocean.current';
                window.trackUsage(k);
            });
        })();

        // [kts 토글] 범례 영역 클릭 시 단위 m/s ↔ kts 전환 (current/wind 만, wave 무관).
        //   바텀시트의 OS.state.useKts 와 연동 — 범례에서 토글하면 바텀시트 카드의
        //   풍속/유속 값도 동시에 변경. 사용자가 어디서 토글하든 일관된 단위 표시.
        //   wave 는 m 단위 고정이므로 클릭 무시 (cursor 도 default 유지).
        var legendBox = document.getElementById('ocean-legend');
        if (legendBox) {
            legendBox.addEventListener('click', function (e) {
                // 클릭 가능한 layer 만 (current/wind). wave 면 무시.
                if (activeLayer !== 'current' && activeLayer !== 'wind') return;
                // 색상 범례(타이틀/색상바/라벨)에서 발생한 클릭만 토글 처리.
                // 슬라이더(#ocean-timeline-slider) 트랙/손잡이 클릭이 부모로 버블링되어
                // 단위가 의도치 않게 토글되는 회귀 방지.
                if (!e.target.closest('.ocean-legend-title, .ocean-legend-bar, .ocean-legend-labels')) return;
                // OS 가 없으면 (시트 미열림 환경) 자체 fallback 변수 사용.
                if (!window.OceanSheet) window.OceanSheet = {};
                if (!window.OceanSheet.state) window.OceanSheet.state = {};
                window.OceanSheet.state.useKts = !window.OceanSheet.state.useKts;
                // 1) 범례 라벨 즉시 갱신
                updateLegend(activeLayer);
                // 2) 슬라이더 말풍선은 시각만 표시 (단위 무관) — 갱신 불필요
                // 3) 바텀시트 카드 — 시트 열려있으면 즉시 갱신
                if (window.OceanSheet && typeof window.OceanSheet.renderCurrentWindValues === 'function') {
                    try { window.OceanSheet.renderCurrentWindValues(); } catch (e2) {}
                }
            });
            // 클릭 가능 시각 단서 — current/wind 활성 시에만 cursor pointer.
            //   activeLayer 변경 시 setActiveLayer 가 다시 호출되어 자동 갱신되지만,
            //   여기는 init 시점이라 default 둠. setActiveLayer 안에서 cursor 갱신.
        }

        // 해구 좌표 캐시 로드 (오버레이 무관, 바텀시트 클릭 판단용 — 1회만)
        if (!_zoneCoordsList) loadZoneCoordsList();

        // 육지 마스크 로드 (CDN: Natural Earth 110m land topojson)
        if (!landRings) loadLandMask();
    };

    /**
     * [외부 노출] 지도 범례를 현재 활성 레이어 기준으로 다시 그림.
     *
     * 호출자: 바텀시트 카드 아이콘 클릭 시 (kts 토글) — 카드 + 지도 범례 양방향 동기.
     * 활성 레이어가 없거나 wave 면 단위 표시 변화 없음 → 안전 호출 (no-op).
     */
    window.oceanOverlayUpdateLegend = function () {
        if (activeLayer) updateLegend(activeLayer);
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
        // [Mutual Exclusion] 시정예측 raster 가 활성 상태면 함께 끔.
        //   천기(shrt) activate 가 이 함수를 호출하므로, 천기 ON 시 시정예측이 꺼진다.
        //   시정예측 activate 도 이 함수를 호출하지만 그 시점엔 state.active 가 아직
        //   false 라 _vsbyForecastDeactivate 는 no-op (자기 자신 끄기 방지).
        if (typeof window._vsbyForecastDeactivate === 'function') {
            try { window._vsbyForecastDeactivate(); } catch (e) {}
        }
        if (!streamActive) return; // 이미 꺼진 상태면 불필요
        streamActive = false;
        activeLayer = null;
        // [2026-05] 오버레이 OFF 시 KHOA 안내 토스트 + 재시도 타이머 + 로딩 인디케이터 정리
        _hideKhoaUnavailableToast();
        _cancelKhoaRetry();
        _hideCurrentLoadingIndicator();
        // 모든 오버레이 버튼의 active 표시 제거
        document.querySelectorAll('.ocean-overlay-btn[data-layer]').forEach(function (b) {
            b.classList.remove('active');
        });
        // 파티클 및 캔버스 초기화
        window.oceanOverlayClear();
        // 통합 박스(범례+타임라인) 숨김
        var legendEl = document.getElementById('ocean-legend');
        if (legendEl) legendEl.style.display = 'none';
        // 색상 범례 hide → 특보 범례 위치 계산식이 0 이 되도록 변수 reset.
        // (이 한 줄이 빠지면 특보 범례가 80px 떠 있는 채로 남는 회귀 발생)
        document.documentElement.style.setProperty('--ocean-legend-height', '0px');
    };

    window.oceanOverlayClear = function () {
        // [2026-05] 오버레이 자체가 꺼지면 KHOA 안내 토스트·로딩 인디케이터도 함께 해제.
        //   - 사용자가 같은 레이어 버튼을 다시 눌러 OFF 한 경우
        //   - 베이스맵 강제 전환 등으로 오버레이가 강제 종료된 경우
        _hideKhoaUnavailableToast();
        _cancelKhoaRetry();
        _hideCurrentLoadingIndicator();
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

    /**
     * 사용자가 "유향유속/풍향풍속/파고파향" 버튼을 누르면 호출되는 진입점.
     *
     * [이 함수의 역할 — 한 줄 요약]
     *   "지금 보여주는 레이어가 바뀌었으니, 캔버스 다 비우고 새 레이어용으로
     *    범례·타임라인을 갈아끼우자" — 데이터 fetch 자체는 바깥에서 시작됨.
     *
     * [호출자 (이 함수를 누가 부르나?)]
     *   - oceanOverlayInit() 내부의 .ocean-overlay-btn[data-layer] 클릭 핸들러
     *
     * [피호출자 (이 함수가 다음에 뭘 부르나?)]
     *   1. trailCanvas/gridCanvas/메인 canvas 모두 clearRect 로 비움
     *      → 이전 레이어의 색상이 잠깐이라도 남지 않게 잔상 제거
     *   2. window.setTimelineStep(1 또는 3)
     *      → 조류는 1시간 간격, 바람·파고는 3시간 간격으로 슬라이더 스텝 조절
     *   3. updateLegend(layer)
     *      → 화면 하단 색상 범례를 새 레이어 팔레트로 다시 그림
     *
     * [주의]
     *   이 함수는 데이터 fetch 를 직접 하지 않음. 호출 후 loadOverlayData()
     *   가 별도로 호출되어 loadCurrentData / loadZoneForecastData 가 실행됨.
     */
    function setActiveLayer(layer) {
        activeLayer = layer;
        // [2026-05] current 가 아닌 레이어로 전환 시 KHOA 안내 토스트 + 재시도 타이머 정리.
        //   사용자가 wind/wave 로 넘어갔는데 토스트가 남아있으면 잘못된 안내가 됨.
        if (layer !== 'current') {
            _hideKhoaUnavailableToast();
            _cancelKhoaRetry();
        }
        // 로딩 인디케이터 잔재 제거 (이전 레이어 잔상 방지)
        _hideCurrentLoadingIndicator();
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

        // [kts 토글 시각 단서] current/wind 면 범례 클릭 가능 → cursor: pointer.
        //   wave 는 단위 고정 (m) → cursor: default 유지. 사용자가 클릭 가능 여부 시각 식별.
        var legendBox = document.getElementById('ocean-legend');
        if (legendBox) {
            legendBox.style.cursor = (layer === 'current' || layer === 'wind') ? 'pointer' : '';
        }
    }

    /**
     * 현재 단위 — kts 모드 여부.
     * 바텀시트 (OS.state.useKts) 와 연동. true 면 m/s 값을 kts 로 변환해 표시.
     * 단위 변환: 1 m/s ≈ 1.94384 kts (해양 표준).
     * 토글 트리거: 범례 영역 클릭 (current/wind 만), 또는 바텀시트 카드 아이콘 클릭.
     */
    function _useKts() {
        return !!(window.OceanSheet && window.OceanSheet.state && window.OceanSheet.state.useKts);
    }
    /** m/s → kts 변환 (소수점 1자리 반올림). 변환 비율은 해양 표준 1.94384. */
    function _msToKts(v) {
        return Math.round(v * 1.94384 * 10) / 10;
    }
    /**
     * 라벨 한 개 포맷 — 숫자 + 단위 부착 (사용자 요구).
     * 정수면 정수 그대로, 소수면 1자리.
     */
    function _fmtLabelValue(v) {
        if (v == null) return '';
        if (Number.isInteger(v)) return String(v);
        return v.toFixed(1);
    }

    /**
     * 화면 하단 범례(#ocean-legend) 를 현재 레이어(layer)에 맞춰 갱신.
     * COLOR_SCALES[layer] 의 색·값 범위를 기반으로 그라디언트 막대 + 수치 라벨 빌드.
     *
     * [디자인 — 사용자 요구]
     *   - 한글 헤더 ("유의파고 (m)" 등) 제거. 헤더 element 는 비워두고 :empty CSS 로
     *     완전 hide → 위 여백도 같이 사라짐.
     *   - 단위는 각 숫자 옆에 직접 부착 ("0m/s", "0.3m/s" 등) — 천기 범례와 동일 패턴.
     *   - kts 모드면 current/wind 의 라벨 자동 변환 (wave 는 m 단위 그대로).
     *
     * @param {string} layer - 'current'|'wind'|'wave' 등
     */
    /**
     * [색상 범례 높이 publish]
     * #ocean-legend (그라디언트 + 슬라이더 박스) 의 실측 높이를 CSS 변수
     * `--ocean-legend-height` 로 publish.
     *
     * 왜?
     *   특보 범례(.warn-active-legend) 의 bottom 계산식이 이 변수를 더해
     *   색상 범례 위로 밀려 올라간다. 색상 범례 OFF 면 0px → 원위치.
     *
     * 언제 호출?
     *   - setActiveLayer 안에서 updateLegend 호출 직후 (레이어 ON)
     *   - oceanOverlayTurnOff 에서 0px 로 reset (레이어 OFF — 직접 setProperty)
     *   - ResizeObserver 가 폰트 크기 변경 등으로 높이 변할 때 자동 호출
     *
     * rAF 양보:
     *   display='' 직후엔 layout 미적용 → offsetHeight 0 일 수 있음.
     *   requestAnimationFrame 1tick 양보 후 측정.
     */
    function _publishOceanLegendHeight() {
        var apply = function () {
            var el = document.getElementById('ocean-legend');
            var h = 0;
            if (el && el.offsetHeight && el.style.display !== 'none') {
                var rect = el.getBoundingClientRect();
                h = Math.round(rect.height);
            }
            document.documentElement.style.setProperty(
                '--ocean-legend-height', h + 'px'
            );
        };
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(apply);
        } else {
            apply();
        }
    }

    /**
     * #ocean-legend 의 크기 변동 (폰트 크기, 슬라이더 tick 재배치 등) 추적.
     * init 시 1회만 등록. 변동 시마다 _publishOceanLegendHeight 자동 호출 →
     * 특보 범례 위치 자동 보정.
     */
    var _oceanLegendRO = null;
    function _setupOceanLegendResizeObserver() {
        if (_oceanLegendRO) return; // 이미 등록됨
        if (typeof ResizeObserver !== 'function') return; // 구형 브라우저 — 안전 fallback
        var el = document.getElementById('ocean-legend');
        if (!el) return;
        _oceanLegendRO = new ResizeObserver(function () {
            _publishOceanLegendHeight();
        });
        _oceanLegendRO.observe(el);
    }

    function updateLegend(layer) {
        var scale = COLOR_SCALES[layer];
        var legendEl = document.getElementById('ocean-legend');
        var barEl = document.getElementById('ocean-legend-bar');
        var labelsEl = document.getElementById('ocean-legend-labels');
        var titleEl = document.getElementById('ocean-legend-title');
        if (!barEl || !labelsEl) return;

        // 범례 표시
        if (legendEl) legendEl.style.display = '';
        // 색상 범례 표출 직후 실측 높이를 CSS 변수로 publish — 특보 범례가
        // 그만큼 위로 올라가도록. ResizeObserver 도 init.
        _setupOceanLegendResizeObserver();
        _publishOceanLegendHeight();

        // 그라디언트 바 생성 — 레이어별 분기
        // [왜 분기?]
        //   - 해류: val=0 알파가 0.05 (의도된 fade) → 컨테이너 진한 네이비에 그대로
        //     깔면 묻혀버림. 흰색 배경에 사전 알파 블렌드한 불투명 RGB 로 변환 →
        //     알파 0.05 → 거의 흰색 → 어두운 컨테이너 위에서 "이 구간 비어있다"
        //     시각 강조.
        //   - 풍속/파고: 모든 stop 알파가 0.68~0.88 로 비교적 균일하고, 컨테이너
        //     위에서도 충분히 시인 가능. 흰색 블렌드 시 지도 표출(지도 바다색 위에
        //     알파 합성) 과 색이 어긋나는 부수 영향만 발생 → 원래 동작(0.8 고정)
        //     유지하여 지도와 비슷한 톤 보존.
        var colors;
        if (layer === 'current') {
            // 흰색 사전 블렌드 → fade 시각 강조 (사용자 명시 요구)
            var BG_R = 255, BG_G = 255, BG_B = 255;
            colors = scale.map(function (s) {
                var a = (s.color[3] != null) ? s.color[3] : 0.8;
                var r = Math.round(BG_R * (1 - a) + s.color[0] * a);
                var g = Math.round(BG_G * (1 - a) + s.color[1] * a);
                var b = Math.round(BG_B * (1 - a) + s.color[2] * a);
                return 'rgb(' + r + ',' + g + ',' + b + ')';
            });
        } else {
            // 풍속/파고: 알파 0.8 고정 (원래 동작 — 손대지 말라는 사용자 명시 요구)
            colors = scale.map(function (s) {
                return 'rgba(' + s.color[0] + ',' + s.color[1] + ',' + s.color[2] + ',0.8)';
            });
        }
        barEl.style.background = 'linear-gradient(to right, ' + colors.join(', ') + ')';

        // 단위 결정 — current/wind 는 kts 모드 여부에 따라 m/s ↔ kts, wave 는 항상 m
        var unit;
        if (layer === 'wave') {
            unit = 'm';
        } else {
            unit = _useKts() ? 'kts' : 'm/s';
        }

        // 라벨 빌드 — 각 숫자 + 단위
        if (layer === 'current') {
            // 바다누리 m/s 기준값 (정해진 7 단계)
            var knLabels = [0.0, 0.3, 0.5, 0.8, 1.1, 1.4, 1.6];
            labelsEl.innerHTML = knLabels.map(function (v) {
                var displayV = _useKts() ? _msToKts(v) : v;
                return '<span>' + _fmtLabelValue(displayV) + unit + '</span>';
            }).join('');
        } else {
            labelsEl.innerHTML = scale.map(function (s) {
                var displayV = (layer === 'wave' || !_useKts()) ? s.val : _msToKts(s.val);
                return '<span>' + _fmtLabelValue(displayV) + unit + '</span>';
            }).join('');
        }

        // 헤더 — 비워둠 (CSS :empty 가 자동 hide)
        if (titleEl) titleEl.textContent = '';
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

    /**
     * 해류 격자 데이터에 5×5 가우시안 평활화를 적용해 새 배열로 반환.
     *
     * [DEPRECATED 2026-05 — 서버측 services/khoa_stream_cache.js 로 이동]
     *   loadCurrentData 는 더 이상 이 함수를 직접 호출하지 않음 (서버가 1회 가공).
     *   레거시 응답(data.preprocessed=false) 호환 폴백 경로에서만 호출됨.
     *

     * [이 함수의 역할 — 한 줄 요약]
     *   ROMS 원본의 셀 단위 국소 변동(작은 잡음·고변동 셀)을 인접 25셀
     *   가중평균으로 부드럽게 만들어 시각화의 얼룩 패턴을 줄임.
     *
     * [왜 필요?]
     *   풍속·파고는 buildGridFromZones 가 빈 셀을 인근 값으로 채워 인접 셀이
     *   비슷해지지만, 해류는 ROMS 원본 그대로라 인접 셀 값 차이가 클수록 색이
     *   격하게 변해 시각이 얼룩덜룩해짐. 데이터 자체를 가벼운 평활 처리로
     *   해결하면 색상 매핑 단계에서 자동으로 부드러워짐.
     *
     * [정확성 보존 이유]
     *   가중평균 결과는 "이 해역 약 35km 의 평균 유속" 으로 물리적으로 해석
     *   가능한 값. 단순 이미지 블러처럼 색을 섞는 게 아님. 5×5 정도 (~35km)
     *   는 와류·강류 같은 mesoscale 특징은 보존하면서 작은 잡음만 제거.
     *
     * [방향 평균]
     *   crdir 은 단위 벡터(sin, cos) 분해 후 가중평균 → atan2 복원.
     *   (도 단위 직접 평균하면 0°/360° 경계에서 정반대 방향으로 깨짐 — 기존
     *   sampleAtLenient 와 동일한 패턴)
     *
     * [성능]
     *   ~10000 셀 × 25 이웃 ≈ 250k op. 레이어 활성/타임라인 변경 시 1회만.
     */
    function _smoothCurrentGrid5x5(rawData) {
        if (!rawData || rawData.length === 0) return rawData;

        // 5×5 가우시안 가중치 (sigma ≈ 1, 합 256)
        var W = [
            [1,  4,  6,  4, 1],
            [4, 16, 24, 16, 4],
            [6, 24, 36, 24, 6],
            [4, 16, 24, 16, 4],
            [1,  4,  6,  4, 1]
        ];

        // 1) 정렬된 unique lon/lat 리스트 + (li,lj) → 원본 점 인덱스
        //    (buildGridIndex 와 같은 방식이지만 전용 스코프로 격리해
        //     모듈 변수 lonList/latList/gridLookup 을 건드리지 않음)
        var lonSet = {}, latSet = {};
        for (var i = 0; i < rawData.length; i++) {
            lonSet[rawData[i].lon] = true;
            latSet[rawData[i].lat] = true;
        }
        var lonArr = Object.keys(lonSet).map(parseFloat).sort(function (a, b) { return a - b; });
        var latArr = Object.keys(latSet).map(parseFloat).sort(function (a, b) { return a - b; });
        var lonIdx = {}, latIdx = {};
        for (var i = 0; i < lonArr.length; i++) lonIdx[lonArr[i]] = i;
        for (var i = 0; i < latArr.length; i++) latIdx[latArr[i]] = i;
        var grid = {};
        for (var i = 0; i < rawData.length; i++) {
            var p = rawData[i];
            grid[lonIdx[p.lon] + '_' + latIdx[p.lat]] = p;
        }

        // 2) 각 점에 대해 5×5 이웃 가중평균 계산 → 새 객체 생성
        //    원본 객체를 변경하지 않아 데이터 의존 충돌(이미 평활된 이웃을
        //    또 평활하는 일) 없음.
        var out = new Array(rawData.length);
        for (var i = 0; i < rawData.length; i++) {
            var p = rawData[i];
            var li = lonIdx[p.lon];
            var lj = latIdx[p.lat];
            var sumSpd = 0, sumX = 0, sumY = 0, sumW = 0;
            for (var dy = -2; dy <= 2; dy++) {
                for (var dx = -2; dx <= 2; dx++) {
                    var np = grid[(li + dx) + '_' + (lj + dy)];
                    if (!np) continue;  // 이웃 없음(육지·격자 끝) — 건너뜀
                    var w = W[dy + 2][dx + 2];
                    sumSpd += np.crsp * w;
                    var rad = (np.crdir || 0) * Math.PI / 180;
                    sumX += Math.sin(rad) * w;
                    sumY += Math.cos(rad) * w;
                    sumW += w;
                }
            }
            // 모든 이웃이 비어있는 비현실적 경우(자기 자신 가중 36 이라 사실상 발생 X) 방어
            if (sumW === 0) {
                out[i] = { lat: p.lat, lon: p.lon, crsp: p.crsp, crdir: p.crdir };
                continue;
            }
            var newDir = Math.atan2(sumX, sumY) * 180 / Math.PI;
            if (newDir < 0) newDir += 360;
            out[i] = {
                lat: p.lat,
                lon: p.lon,
                crsp: sumSpd / sumW,
                crdir: newDir
            };
        }
        return out;
    }

    /**
     * 해류(current) 격자 데이터를 서버에서 받아와 gridData 캐시를 채우는 함수.
     *
     * [이 함수의 역할 — 한 줄 요약]
     *   KHOA(국립해양조사원) ROMS 모델의 정밀 격자 데이터를 fetch 해서
     *   "어느 위경도에 유속·유향이 얼마"인지 메모리에 저장하고, 화면에
     *   배경 히트맵을 그려달라고 renderGridToOffscreen() 을 호출.
     *
     * [호출자]
     *   - loadOverlayData() — activeLayer === 'current' 일 때
     *   - 타임라인 슬라이더 변경 시 oceanOverlaySetTime() 경유로도 호출됨
     *
     * [피호출자]
     *   1. fetch('/api/ocean/khoa-stream-vector?date=&hour=')  ← 백엔드 엔드포인트
     *   2. updateLegend('current')  ← 범례 갱신
     *   3. renderGridToOffscreen()  ← 받은 데이터로 배경 히트맵 그림
     *   4. startParticleAnimation()  ← 흰 파티클 RAF 루프 시작
     *
     * [데이터 가공]
     *   1. API 응답의 단위(s = m/s)를 cm/s 로 환산(`crsp = s * 100`).
     *      이유: COLOR_SCALES.current 가 cm/s 단위로 정의되어 있어 단위 일치 필요.
     *   2. (서버측 services/khoa_stream_cache.js 에서 이미 5×5 가우시안 평활화 +
     *      양자화 + 결측점 필터 완료. 클라이언트는 결과를 그대로 시각화만 수행 —
     *      부하 분산. 레거시 응답(preprocessed 미설정)이 들어오면 보수적으로
     *      클라이언트 평활화 적용해 호환성 유지.)
     *   3. KHOA 일시 장애 시 안내 토스트 + 7초 간격 백그라운드 retry 자동 활성화.
     *
     * @param {boolean=} silent - true 면 console 로그를 억제 (백그라운드 retry 용)
     */
    function loadCurrentData(silent) {
        var dh = _offsetToDateHour(timelineOffsetHours);
        if (!silent) console.log('[OceanOverlay] KHOA stream-vector 로드 시작');
        // [Race-guard] 슬라이더 드래그 중 직전 fetch 의 옛 응답이 새 fetch 결과를
        //   덮어쓰는 회귀를 방지. myEpoch 가 현재 epoch 와 다르면 응답 폐기.
        var myEpoch = ++_currentLoadEpoch;
        // [로딩 인디케이터] 슬라이더 드래그/타임라인 변경 시 짧은 시간이지만 사용자가
        //   "응답이 오는 중인지" 알 수 있도록 캔버스를 살짝 어둡게 처리 + 범례에 펄스 dot.
        //   silent retry 시엔 표시 안 함 (이미 토스트가 안내 중).
        if (!silent) _showCurrentLoadingIndicator();
        fetch('/api/ocean/khoa-stream-vector?date=' + dh.date + '&hour=' + dh.hour)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (myEpoch !== _currentLoadEpoch) return; // 옛 응답 무시
                if (!data || data.success === false || !data.points || data.points.length === 0) {
                    if (!silent) console.warn('[OceanOverlay] KHOA stream-vector 데이터 없음');
                    _hideCurrentLoadingIndicator();
                    // [토스트] 서버가 success:false 로 응답했고 (upstreamFailed 포함)
                    //   유향유속 레이어가 활성화된 동안에만 안내 토스트 표시 + 7초 재시도.
                    if (activeLayer === 'current' && streamActive) {
                        _showKhoaUnavailableToast();
                        _scheduleKhoaRetry();
                    }
                    updateLegend(activeLayer);
                    return;
                }
                // 서버가 success:true → 토스트가 떠 있었으면 즉시 숨김
                _hideKhoaUnavailableToast();
                _cancelKhoaRetry();
                gridData = [];
                for (var i = 0; i < data.points.length; i++) {
                    var p = data.points[i];
                    // [2026-05] 서버가 이미 결측점(s/d/temp 모두 0) 필터 + 5×5 가우시안
                    //   평활화 + 양자화(s→0.01, d→정수, temp→0.1)를 수행했다.
                    //   클라이언트는 cm/s 환산(crsp = s * 100) 만 하고 그대로 사용.
                    //   안전망: lat/lon 타입만 검증 (옛 캐시 호환).
                    if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
                    gridData.push({ lat: p.lat, lon: p.lon, crsp: p.s * 100, crdir: p.d });
                }
                // [2026-05] 서버에서 평활화 완료 → 클라이언트는 _smoothCurrentGrid5x5 호출 안 함.
                //   data.preprocessed === true 면 확실히 서버 가공된 응답. 안전을 위해
                //   레거시 응답(preprocessed 미설정)이 들어오면 보수적으로 클라이언트 평활화 적용.
                if (!data.preprocessed) {
                    gridData = _smoothCurrentGrid5x5(gridData);
                }
                if (!silent) console.log('[OceanOverlay] KHOA 격자 점 수:', gridData.length);
                // gridData 가 새 객체 배열로 교체됐으므로 lonList/latList/gridLookup 도
                // 무효. 초기화해야 renderGridToOffscreen 이 buildGridIndex 재호출 →
                // gridLookup 이 새 객체를 가리키도록 갱신. (없으면 옛 데이터로 렌더링)
                lonList = null;
                updateLegend('current');
                renderGridToOffscreen();
                if (canvas) canvas.style.visibility = 'visible';
                isMoving = false;
                _hideCurrentLoadingIndicator();
                startParticleAnimation();
            })
            .catch(function (e) {
                if (myEpoch !== _currentLoadEpoch) return;
                if (!silent) console.warn('[OceanOverlay] KHOA 로드 실패:', e.message);
                _hideCurrentLoadingIndicator();
                if (activeLayer === 'current' && streamActive) {
                    _showKhoaUnavailableToast();
                    _scheduleKhoaRetry();
                }
            });
    }

    // ========================================================================
    // [KHOA 일시 장애] 안내 토스트 + 7초 백그라운드 재시도 — 2026-05
    // ------------------------------------------------------------------------
    // 서버가 success:false 를 응답할 때(국립해양조사원 upstream 장애 등) 사용자에게
    // "데이터를 받아오면 곧바로 표출됩니다" 안내. 이후 자동 재시도하여 가능한 빨리 복구.
    // 토스트 패턴: zone_guide.js:showZoneGuideToast 와 동일 (bottom-anchored).
    // 차이점: 자동 사라지지 않음 — 다음 성공 응답 시 또는 레이어 전환 시에만 사라짐.
    // ========================================================================
    var _khoaRetryTimer = null;
    var _currentLoadEpoch = 0;        // 슬라이더 변경 시 옛 응답 무시용 race-guard
    var KHOA_RETRY_INTERVAL_MS = 7000;

    function _showKhoaUnavailableToast() {
        // 이미 떠 있으면 중복 생성 방지
        if (document.getElementById('khoa-unavailable-toast')) return;
        var toast = document.createElement('div');
        toast.id = 'khoa-unavailable-toast';
        toast.textContent =
            '국립해양조사원에서 유향 및 유속 데이터를 일시적으로 제공하지 않습니다. ' +
            '데이터를 받아오면 곧 바로 정상적으로 표출됩니다.';
        toast.style.cssText = [
            'position: fixed',
            'bottom: 80px',
            'left: 50%',
            'transform: translateX(-50%) translateY(20px)',
            'background: rgba(30, 41, 59, 0.95)',
            'color: #e2e8f0',
            'padding: 12px 20px',
            'border-radius: 12px',
            'font-size: 0.85rem',
            'font-weight: 500',
            'z-index: 10200',
            'opacity: 0',
            'transition: opacity 0.3s ease, transform 0.3s ease',
            'box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3)',
            'border: 1px solid rgba(255, 255, 255, 0.1)',
            'text-align: center',
            'max-width: 90%',
            'line-height: 1.5'
        ].join(';');
        document.body.appendChild(toast);
        // 부드러운 등장 (zone_guide 토스트와 동일한 double-RAF 패턴)
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                toast.style.opacity = '1';
                toast.style.transform = 'translateX(-50%) translateY(0)';
            });
        });
    }

    function _hideKhoaUnavailableToast() {
        var toast = document.getElementById('khoa-unavailable-toast');
        if (!toast) return;
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(20px)';
        setTimeout(function () {
            if (toast.parentNode) toast.remove();
        }, 300);
    }

    /**
     * 7초 후 loadCurrentData(silent) 재시도 — 토스트 표시 중에만 작동.
     * setInterval 대신 재귀적 setTimeout 패턴: 응답이 7초보다 느릴 때도
     * 다음 호출이 stack up 되지 않도록 한다.
     */
    function _scheduleKhoaRetry() {
        _cancelKhoaRetry();
        _khoaRetryTimer = setTimeout(function () {
            _khoaRetryTimer = null;
            if (activeLayer === 'current' && streamActive) {
                loadCurrentData(true /* silent retry */);
            }
        }, KHOA_RETRY_INTERVAL_MS);
    }

    function _cancelKhoaRetry() {
        if (_khoaRetryTimer) {
            clearTimeout(_khoaRetryTimer);
            _khoaRetryTimer = null;
        }
    }

    // ========================================================================
    // [유향유속 로딩 인디케이터] — 2026-05
    // 슬라이더 드래그/레이어 전환 직후 짧은 시간 동안 캔버스에 약한 dim 효과 +
    // 범례 영역 우상단에 작은 펄스 dot 으로 "데이터 받아오는 중" 시각 단서 제공.
    // wind/wave 는 zone-forecasts 가 사실상 즉시 응답하므로 적용 안 함.
    // ========================================================================
    function _showCurrentLoadingIndicator() {
        if (activeLayer !== 'current') return; // current 전용
        // 1) 캔버스 살짝 dim — 0.55 opacity 부드러운 트랜지션
        if (canvas) {
            canvas.style.transition = 'opacity 0.2s ease';
            canvas.style.opacity = '0.55';
        }
        // 2) 범례 우상단에 펄스 dot — 자리를 차지하지 않도록 absolute 배치
        var legendEl = document.getElementById('ocean-legend');
        if (!legendEl) return;
        if (document.getElementById('ocean-current-loading-dot')) return;
        var dot = document.createElement('div');
        dot.id = 'ocean-current-loading-dot';
        dot.style.cssText = [
            'position: absolute',
            'top: 6px',
            'right: 8px',
            'width: 10px',
            'height: 10px',
            'border-radius: 50%',
            'background: #60a5fa',
            'box-shadow: 0 0 8px rgba(96,165,250,0.8)',
            'animation: ocean-current-pulse 0.9s ease-in-out infinite',
            'pointer-events: none',
            'z-index: 2'
        ].join(';');
        // keyframes 1회 주입
        if (!document.getElementById('ocean-current-pulse-keyframes')) {
            var style = document.createElement('style');
            style.id = 'ocean-current-pulse-keyframes';
            style.textContent =
                '@keyframes ocean-current-pulse{0%,100%{opacity:0.35;transform:scale(0.85)}50%{opacity:1;transform:scale(1.15)}}';
            document.head.appendChild(style);
        }
        var cs = window.getComputedStyle(legendEl);
        if (cs.position === 'static') legendEl.style.position = 'relative';
        legendEl.appendChild(dot);
    }

    function _hideCurrentLoadingIndicator() {
        if (canvas) canvas.style.opacity = '';
        var dot = document.getElementById('ocean-current-loading-dot');
        if (dot && dot.parentNode) dot.parentNode.removeChild(dot);
    }

    /**
     * 바람(wind) 또는 파고(wave) 격자 데이터를 서버에서 받아오는 함수.
     *
     * [이 함수의 역할 — 한 줄 요약]
     *   기상청 소해구(작은 해역 단위) 예보를 fetch 해서, 0.5° 정규 격자
     *   형태로 변환하고, 화면에 배경 히트맵 + 흰 파티클을 그려달라고 요청.
     *
     * [호출자]
     *   - loadOverlayData() — activeLayer 가 'wind' 또는 'wave' 일 때
     *   - 타임라인 슬라이더 변경 시에도 호출됨
     *
     * [피호출자]
     *   1. fetch('/api/ocean/zone-forecasts?time=...')  ← 백엔드 엔드포인트
     *   2. buildGridFromZones(zones, layer)  ← 소해구 → 0.5° 격자 변환
     *   3. buildGridIndex()  ← 빠른 보간을 위한 정렬 인덱스 생성
     *   4. updateLegend(layer)  ← 범례 갱신
     *   5. renderGridToOffscreen()  ← 배경 히트맵 그림
     *   6. startParticleAnimation()  ← 흰 파티클 RAF 루프 시작
     *
     * [레이어별 데이터 의미 (gridData 의 crsp/crdir 의미가 다름!)]
     *   - layer='wind': crsp = 풍속(m/s),  crdir = 풍향(기상학 관례, "from")
     *   - layer='wave': crsp = 파고(m),    crdir = 파향(해양학 관례, "to")
     *
     *   * 같은 변수명(crsp, crdir)에 의미가 다른 값이 들어가는 점을 주의.
     *   * 방향 관례 차이는 animate() 안의 이동 공식 분기로 보정 (`if (isWind)` 분기).
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

        /** 방위각 d(°) → 단위 벡터 [sin, cos] 변환. 4개 격자 점의 방향 평균에 사용. */
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

    /**
     * 임의 좌표(lon, lat) 위치의 (속도, 방향) 을 격자 데이터에서 양선형 보간으로 산출.
     * 격자 사각형의 4 코너 점을 가중 평균 (속도) + 단위 벡터 평균 (방향) 으로 보간.
     *
     * @returns {{crsp: number, crdir: number}|null} - 격자 밖 또는 데이터 없음 시 null
     */
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
     * 격자 데이터를 배경 히트맵(색상 면) 으로 그려서 gridCanvas 에 저장.
     *
     * [이 함수의 역할 — 한 줄 요약]
     *   "위경도별 수치(유속/풍속/파고) 데이터 → 화면 픽셀 색상" 변환을 담당.
     *   결과는 오프스크린 캔버스(gridCanvas)에 누적되고, animate() 가 매 프레임
     *   메인 캔버스로 합성함. 즉, 매 프레임이 아닌 데이터·줌 변경 시에만 갱신.
     *
     * [호출자]
     *   - loadCurrentData()         (데이터 도착 시)
     *   - loadZoneForecastData()    (데이터 도착 시)
     *   - oceanOverlayRefresh()     (지도 줌·이동 종료 시)
     *
     * [피호출자]
     *   1. buildGridIndex()        ← lonList/latList 인덱스 없으면 생성
     *   2. sampleAtLenient()  ← 위경도 → 보간된 값 (모든 레이어 lenient 통일)
     *   3. interpolateColor()      ← 값 → RGBA 색상
     *   4. applyLandMask()         ← 육지 영역 색상 펀치아웃
     *
     * [성능 트릭]
     *   화면 전체를 4픽셀 단위로 샘플링(STEP=4) → 작은 ImageData 생성
     *   → blur 필터로 부드럽게 확대. 이래야 한반도 전체 화면을 30fps 로 갱신해도
     *   부담이 없음. 줌인하면 같은 격자 셀에 픽셀이 더 많이 들어가 자동으로
     *   섬세해 보임.
     *
     * [모든 레이어 공통]
     *   직전 변경(2026-05) 으로 wind/current 도 wave 와 같은 방식의 배경 히트맵을
     *   사용. 이 함수는 activeLayer 에 따라 색 팔레트(COLOR_SCALES)와 보간 방법만
     *   바꿔서 동일한 출력 흐름으로 처리.
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
                // 모든 레이어 공통: lenient bilinear (1~4 코너 중 있는 것만 가중평균).
                // [왜 모두 lenient 인가?]
                //   해류(ROMS) 가 엄격 sampleAt 을 쓰면 빈 코너에서 null → 사각형 빈 칸이
                //   생기고, 모바일처럼 줌이 낮을 때 blur 강도가 작아(8px 수준) 그 직선
                //   모서리가 그대로 노출됨 ("뚝 끊기는" 격자 느낌).
                //   lenient 로 통일하면 빈 칸이 인접 코너 가중평균으로 채워져 부드러워짐.
                // [주의]
                //   파티클 이동(animate 내부)은 정확한 벡터값이 필요하므로 여전히
                //   sampleAt(엄격) 사용. 즉 "배경 색상은 lenient, 파티클은 strict" 분리.
                var samp = sampleAtLenient(ll[0], ll[1]);
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

    /**
     * 매 프레임(보통 60fps) 호출되는 메인 애니메이션 루프.
     *
     * [이 함수의 역할 — 한 줄 요약]
     *   파티클을 1프레임 만큼 이동시키고, 흰 트레일을 그린 뒤,
     *   "배경 히트맵(gridCanvas) + 트레일(trailCanvas)" 두 장을
     *   메인 캔버스에 차례로 합성해서 화면에 표시.
     *
     * [호출자]
     *   - startParticleAnimation()  → requestAnimationFrame(animate)
     *   - 자기 자신 (함수 끝의 requestAnimationFrame(animate) 로 다음 프레임 예약)
     *
     * [피호출자]
     *   1. sampleAt() / lookupNearest()  ← 파티클이 위치한 곳의 풍속·유속·파향
     *   2. createParticle()              ← 수명 끝난 파티클 재배치
     *   3. interpolateColor()는 호출 안 함 ← 직전 변경(2026-05) 으로 파티클 색은
     *      흰색 고정, 색은 배경(gridCanvas) 에서만 사용
     *   4. mapRef.render()               ← OpenLayers 합성 캔버스로 결과 전송
     *
     * [3개 레이어 공통 처리 + 차이점]
     *   공통: 배경 히트맵 + 흰 파티클
     *   차이:
     *     - wave  : 파티클 이동 속도 고정(1.0), 트레일 굵기 1.5 고정 (방향만 표시)
     *     - wind  : 파티클 이동 속도 = 풍속에 비례, 트레일 굵기 = 풍속 비례
     *     - current: 파티클 이동 속도 = 유속에 비례, 트레일 굵기 = 유속 비례
     *
     * [성능 가드]
     *   1. isMoving 중에는 캔버스를 비우고 다음 프레임 대기 (잔상 방지)
     *   2. 격자 밖으로 나간 파티클은 즉시 재배치 (무의미한 계산 방지)
     *   3. delta 클램프(0.1~3.0) 로 탭 복귀·백그라운드 후 점프 방지
     */
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

                // ─── 레이어별 이동 공식 (방향 관례 불일치 보정) ───
                //
                // [배경] 종래 `p.x += sin(dir); p.y -= cos(dir)` 단일 공식으로
                //        3개 레이어를 모두 그렸으나, 각 데이터의 방향 관례가
                //        달라 아래처럼 일관되지 않게 표출되고 있었음.
                //          · 바람 windDir : "from"(기상학 관례, 불어오는 쪽)
                //                → 종전 공식은 동·서 축 반전
                //          · 해류 currentDir : "to"(해양학 관례, 흘러가는 쪽)
                //                → 종전 공식은 남·북 축 반전
                //          · 파고 waveDir : "to"(파가 전파되는 방향)
                //                → 종전 공식은 남·북 축 반전 (해류와 동일)
                //
                // [수정] 관례에 맞춰 레이어별로 이동 벡터 기호를 분기.
                //        OL EPSG:3857 좌표계: p.x ↑=동, p.y ↑=북
                //          · from 관례 (바람): 이동 = (-sin, -cos)
                //          · to   관례 (조류·파고): 이동 = (+sin, +cos)
                if (isWind) {
                    p.x -= Math.sin(dirRad) * spdMps * SPEED_SCALE * delta;
                    p.y -= Math.cos(dirRad) * spdMps * SPEED_SCALE * delta;
                } else {
                    // current / wave — to 방향 관례
                    p.x += Math.sin(dirRad) * spdMps * SPEED_SCALE * delta;
                    p.y += Math.cos(dirRad) * spdMps * SPEED_SCALE * delta;
                }
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
                // 모든 레이어: 배경 히트맵(범례 색상) 위에 흰색 트레일.
                // 강도(풍속·유속·파고)는 배경 색상으로 읽고, 파티클은 흐름의 방향만 표현.
                // - wave  : 굵기 1.5 고정 (파향만 표시, 속력은 배경 단독 — 시인성 위해 풍향 수준으로 상향)
                // - wind  : 굵기를 풍속에 비례 (강한 바람일수록 굵게) — 동적 표현 유지
                // - current: 굵기를 유속에 비례 (강한 해류일수록 굵게) — 동적 표현 유지
                if (isWave) {
                    trailCtx.strokeStyle = 'rgba(255,255,255,0.65)';
                    trailCtx.lineWidth = 1.5;
                } else {
                    trailCtx.strokeStyle = 'rgba(255,255,255,0.78)';
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
        // 모든 레이어 공통: 강도는 배경 색상(히트맵)으로, 방향은 흰색 트레일로 표현.
        // (renderGridToOffscreen() 은 loadCurrentData / loadZoneForecastData 에서
        //  레이어 종류와 무관하게 호출되므로, gridCanvas 는 항상 최신 상태)
        ctx.clearRect(0, 0, w, h);
        if (gridCanvas) ctx.drawImage(gridCanvas, 0, 0, w, h);
        if (trailCanvas) ctx.drawImage(trailCanvas, 0, 0, w, h);

        // OL 에게 재렌더 요청.
        // → 첫 vector layer 의 prerender 이벤트가 발생하고, 그 시점에
        //   바로 위에서 갱신한 파티클 canvas 가 OL 합성 canvas 에
        //   drawImage 로 얹혀 화면에 표시됨.
        //   (vector hook 이 아직 안 걸렸거나 streamActive=false 면
        //    훅 내부에서 early return 이라 부작용 없음)
        if (mapRef && mapRef.render) mapRef.render();

        animationId = requestAnimationFrame(animate);
    }

    /**
     * 주어진 (lat, lon) 에 가장 가까운 격자 점을 brute-force 선형 검색으로 찾기.
     * 검색 비용이 높아 자주 호출하면 안 됨 — sampleAt 의 양선형 보간 보다 정확도가 낮을 때
     * fallback 용도. (예: 사용자 클릭 좌표 정확 매칭이 필요할 때)
     */
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

    // 클릭 지점이 실제 육지인지 — 육지 마스크 링(landRings, [lon,lat] 쌍)에 대한 point-in-polygon.
    //   ocean_typhoon.js 의 육지 클릭(강풍반경 도달시간) 판정에 사용. 마스크 미로드 시 null 반환.
    window.isOceanLand = function (lat, lon) {
        if (!landRings || landRings.length === 0) return null;
        var inside = false;
        for (var ri = 0; ri < landRings.length; ri++) {
            var ring = landRings[ri];
            for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
                if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
            }
        }
        return inside;
    };

})();
