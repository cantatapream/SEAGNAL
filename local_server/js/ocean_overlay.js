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
        // 해류 속도 (cm/s): 0 → 100+
        current: [
            { val: 0, color: [30, 60, 120, 0.5] },     // 짙은 파랑
            { val: 10, color: [40, 100, 180, 0.6] },    // 파랑
            { val: 20, color: [50, 160, 200, 0.6] },    // 하늘색
            { val: 40, color: [80, 200, 160, 0.65] },   // 청록
            { val: 60, color: [160, 220, 80, 0.7] },    // 연두
            { val: 80, color: [240, 200, 40, 0.7] },    // 노랑
            { val: 100, color: [240, 120, 30, 0.75] },  // 주황
            { val: 150, color: [220, 40, 40, 0.8] }     // 빨강
        ],
        // 풍속 (m/s): 0 → 25+
        wind: [
            { val: 0, color: [60, 80, 120, 0.4] },      // 회청색
            { val: 3, color: [50, 140, 80, 0.5] },       // 초록
            { val: 6, color: [80, 180, 60, 0.55] },      // 연초록
            { val: 9, color: [180, 200, 40, 0.6] },      // 연두
            { val: 12, color: [240, 180, 30, 0.65] },    // 노랑
            { val: 15, color: [240, 100, 30, 0.7] },     // 주황
            { val: 20, color: [200, 40, 40, 0.75] },     // 빨강
            { val: 25, color: [160, 30, 120, 0.8] }      // 보라
        ],
        // 파고 (m): 0 → 6+
        wave: [
            { val: 0, color: [30, 80, 140, 0.4] },      // 진파랑
            { val: 0.5, color: [40, 130, 200, 0.5] },    // 파랑
            { val: 1.0, color: [60, 180, 180, 0.55] },   // 청록
            { val: 1.5, color: [100, 200, 120, 0.6] },   // 청초록
            { val: 2.0, color: [180, 210, 60, 0.65] },   // 연두
            { val: 3.0, color: [240, 180, 40, 0.7] },    // 노랑
            { val: 4.0, color: [240, 100, 40, 0.75] },   // 주황
            { val: 6.0, color: [200, 40, 60, 0.8] }      // 빨강
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
    let gridData = null;           // ROMS 격자 데이터
    let animationId = null;        // 파티클 애니메이션 RAF ID
    let particles = [];            // 파티클 배열
    const MAX_PARTICLES = 800;

    // ========================================================================
    // 초기화
    // ========================================================================

    window.oceanOverlayInit = function (map) {
        mapRef = map;
        canvas = document.getElementById('ocean-overlay-canvas');
        if (!canvas) return;
        ctx = canvas.getContext('2d');

        // 오프스크린 캔버스 생성 (격자 색상용 - 정적 렌더)
        gridCanvas = document.createElement('canvas');
        gridCtx = gridCanvas.getContext('2d');

        // 캔버스 크기를 지도에 맞춤
        resizeCanvas();

        // 오버레이 토글 버튼 바인딩
        document.querySelectorAll('.ocean-overlay-btn[data-layer]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var layer = this.dataset.layer;
                setActiveLayer(layer);

                document.querySelectorAll('.ocean-overlay-btn[data-layer]').forEach(function (b) {
                    b.classList.remove('active');
                });
                this.classList.add('active');
            });
        });

        // 데이터 로드 및 렌더링
        loadOverlayData();
    };

    window.oceanOverlayRefresh = function (map) {
        if (!canvas || !ctx) return;
        mapRef = map;
        resizeCanvas();
        renderGridToOffscreen();
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
        particles = [];
        gridData = null;
    };

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
    }

    // ========================================================================
    // 오버레이 레이어 전환
    // ========================================================================

    function setActiveLayer(layer) {
        activeLayer = layer;
        updateLegend(layer);
        renderGridToOffscreen();
    }

    function updateLegend(layer) {
        var scale = COLOR_SCALES[layer];
        var barEl = document.getElementById('ocean-legend-bar');
        var labelsEl = document.getElementById('ocean-legend-labels');
        var titleEl = document.getElementById('ocean-legend-title');
        if (!barEl || !labelsEl || !titleEl) return;

        // 그라디언트 바 생성
        var colors = scale.map(function (s) {
            return 'rgba(' + s.color[0] + ',' + s.color[1] + ',' + s.color[2] + ',0.8)';
        });
        barEl.style.background = 'linear-gradient(to right, ' + colors.join(', ') + ')';

        // 라벨
        labelsEl.innerHTML = scale.map(function (s) {
            return '<span>' + s.val + '</span>';
        }).join('');

        // 제목
        var titles = {
            current: '해류 속도 (cm/s)',
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

        var view = mapRef.getView();
        var extent = view.calculateExtent(mapRef.getSize());
        var bl = ol.proj.toLonLat([extent[0], extent[1]]);
        var tr = ol.proj.toLonLat([extent[2], extent[3]]);

        console.log('[OceanOverlay] 그리드 데이터 로드 시작:', bl, tr);

        // ROMS 그리드 데이터 로드
        fetch('/api/ocean/roms-grid?ymin=' + bl[1].toFixed(2) +
            '&ymax=' + tr[1].toFixed(2) +
            '&xmin=' + bl[0].toFixed(2) +
            '&xmax=' + tr[0].toFixed(2))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                console.log('[OceanOverlay] ROMS 응답:', data.success, '항목:', data.items ? data.items.length : 0);
                if (data.success && data.items && data.items.length > 0) {
                    gridData = data.items;
                    renderGridToOffscreen();
                    startParticleAnimation();
                } else {
                    console.warn('[OceanOverlay] ROMS 데이터 없음, 범례만 표시');
                    // 데이터 없어도 범례는 표시
                    updateLegend(activeLayer);
                }
            })
            .catch(function (e) {
                console.warn('[OceanOverlay] ROMS 그리드 로드 실패:', e.message);
            });
    }

    // ========================================================================
    // 렌더링
    // ========================================================================

    /**
     * 격자 색상을 오프스크린 캔버스에 렌더링 (정적 레이어)
     * animate()에서 매 프레임 이 이미지를 합성하여 파티클과 함께 표시
     */
    function renderGridToOffscreen() {
        if (!gridCtx || !gridCanvas || !gridData || !mapRef) return;

        var w = gridCanvas.width / (window.devicePixelRatio || 1);
        var h = gridCanvas.height / (window.devicePixelRatio || 1);
        gridCtx.clearRect(0, 0, w, h);

        var scale = COLOR_SCALES[activeLayer];

        gridData.forEach(function (item) {
            var pixel = mapRef.getPixelFromCoordinate(ol.proj.fromLonLat([item.lon, item.lat]));
            if (!pixel) return;

            var x = pixel[0];
            var y = pixel[1];
            if (x < -20 || x > w + 20 || y < -20 || y > h + 20) return;

            // 값에 따른 색상 결정
            var value;
            if (activeLayer === 'current') value = item.crsp || 0;
            else if (activeLayer === 'wind') value = item.crsp ? item.crsp / 10 : 0;
            else value = item.crsp ? item.crsp / 20 : 0;

            var color = interpolateColor(scale, value);
            var radius = Math.max(8, 15 - mapRef.getView().getZoom());

            // 부드러운 원형 그라디언트
            var gradient = gridCtx.createRadialGradient(x, y, 0, x, y, radius);
            gradient.addColorStop(0, 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',' + color[3] + ')');
            gradient.addColorStop(1, 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',0)');

            gridCtx.fillStyle = gradient;
            gridCtx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        });

        // 애니메이션이 아직 없으면 정적 렌더만 메인 캔버스에 표시
        if (!animationId && ctx) {
            var mw = canvas.width / (window.devicePixelRatio || 1);
            var mh = canvas.height / (window.devicePixelRatio || 1);
            ctx.clearRect(0, 0, mw, mh);
            ctx.drawImage(gridCanvas, 0, 0, mw, mh);
        }
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

        // 파티클 초기화
        particles = [];
        for (var i = 0; i < MAX_PARTICLES; i++) {
            particles.push(createParticle());
        }

        animate();
    }

    function createParticle() {
        if (!mapRef) return { x: 0, y: 0, age: 0, maxAge: 60 };

        var view = mapRef.getView();
        var extent = view.calculateExtent(mapRef.getSize());
        var w = (extent[2] - extent[0]);
        var h = (extent[3] - extent[1]);

        return {
            x: extent[0] + Math.random() * w,
            y: extent[1] + Math.random() * h,
            age: Math.floor(Math.random() * 60),
            maxAge: 40 + Math.floor(Math.random() * 40)
        };
    }

    function animate() {
        if (!ctx || !canvas || !mapRef || !gridData) return;

        var w = canvas.width / (window.devicePixelRatio || 1);
        var h = canvas.height / (window.devicePixelRatio || 1);

        // 매 프레임 캔버스 초기화 후 레이어 합성:
        // 1) 오프스크린 격자 색상 이미지 그리기 (정적)
        // 2) 파티클 페이드 트레일 + 새 파티클 위치
        ctx.clearRect(0, 0, w, h);

        // ① 격자 색상 오버레이 (오프스크린 캔버스에서 복사)
        if (gridCanvas) {
            ctx.drawImage(gridCanvas, 0, 0, w, h);
        }

        // ② 파티클 업데이트 및 렌더 (흐름선 효과)
        particles.forEach(function (p) {
            // 가장 가까운 격자점의 유향/유속 찾기
            var lonLat = ol.proj.toLonLat([p.x, p.y]);
            var nearest = findNearestGrid(lonLat[1], lonLat[0]);

            if (nearest) {
                var dir = (nearest.crdir || 0) * Math.PI / 180;
                var spd = (nearest.crsp || 0) * 0.5; // 스케일 조정

                // 지도 좌표계에서의 이동
                p.x += Math.sin(dir) * spd;
                p.y -= Math.cos(dir) * spd;
            }

            p.age++;
            if (p.age > p.maxAge) {
                var newP = createParticle();
                p.x = newP.x;
                p.y = newP.y;
                p.age = 0;
            }

            // 화면에 파티클 그리기 (나이에 따라 투명도 감소)
            var pixel = mapRef.getPixelFromCoordinate([p.x, p.y]);
            if (pixel) {
                var alpha = 1.0 - (p.age / p.maxAge);
                ctx.fillStyle = 'rgba(255, 255, 255, ' + (alpha * 0.7) + ')';
                ctx.beginPath();
                ctx.arc(pixel[0], pixel[1], 1.5, 0, Math.PI * 2);
                ctx.fill();
            }
        });

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

})();
