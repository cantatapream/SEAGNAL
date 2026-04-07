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
    const MAX_PARTICLES = 2500;    // 흐름 트레일 효과를 위해 조밀하게
    let trailCanvas = null;        // 입자 트레일 전용 오프스크린 (페이드 누적)
    let trailCtx = null;
    let streamActive = false;      // 해류 시각화 ON/OFF (사용자 토글)
    let inited = false;            // oceanOverlayInit 1회 가드

    // ========================================================================
    // 초기화
    // ========================================================================

    window.oceanOverlayInit = function (map) {
        mapRef = map;
        // 모드 B 재진입 시에는 OFF 상태로 초기화 (직전 토글 상태 유지하지 않음)
        if (inited) {
            streamActive = false;
            document.querySelectorAll('.ocean-overlay-btn[data-layer="current"]').forEach(function (b) {
                b.classList.remove('active');
            });
            window.oceanOverlayClear();
            resizeCanvas();
            return;
        }
        canvas = document.getElementById('ocean-overlay-canvas');
        if (!canvas) return;
        ctx = canvas.getContext('2d');
        // 입자 트레일 전용 오프스크린 캔버스
        trailCanvas = document.createElement('canvas');
        trailCtx = trailCanvas.getContext('2d');
        inited = true;

        // 오프스크린 캔버스 생성 (격자 색상용 - 정적 렌더)
        gridCanvas = document.createElement('canvas');
        gridCtx = gridCanvas.getContext('2d');

        // 캔버스 크기를 지도에 맞춤
        resizeCanvas();

        // 오버레이 토글 버튼 바인딩 (current 만 사용 — wind/wave 는 데이터 소스 미연결)
        // 사용자 요구사항(2026-04): 모드 B(해양현황) 진입만으로는 해류 애니메이션을
        // 표시하지 않고, 'current' 버튼을 눌렀을 때만 ON, 다시 누르면 OFF.
        document.querySelectorAll('.ocean-overlay-btn[data-layer]').forEach(function (btn) {
            // 기본 active 클래스를 모두 떼서 OFF 상태로 시작
            btn.classList.remove('active');
            btn.addEventListener('click', function () {
                var layer = this.dataset.layer;
                if (layer !== 'current') {
                    // 현재는 current 만 지원
                    return;
                }
                if (streamActive) {
                    // 토글 OFF
                    streamActive = false;
                    this.classList.remove('active');
                    window.oceanOverlayClear();
                } else {
                    // 토글 ON
                    streamActive = true;
                    this.classList.add('active');
                    setActiveLayer('current');
                    loadOverlayData();
                }
            });
        });

        // 진입 시 자동 로드 안 함 — 사용자가 버튼을 눌러야 시작.
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

        console.log('[OceanOverlay] KHOA stream-vector 로드 시작');

        // KHOA 해아름 stream-vector — 한국 전 해역 약 1만 격자점을 1회 호출로 수신.
        // 응답 포맷: { success, points: [{lat, lon, s(m/s), d(deg), temp, salt, zeta}, ...] }
        // 기존 오버레이 코드는 crsp(cm/s)·crdir(deg) 키를 기대하므로 어댑터 변환.
        fetch('/api/ocean/khoa-stream-vector')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || !data.success || !data.points || data.points.length === 0) {
                    console.warn('[OceanOverlay] KHOA stream-vector 데이터 없음');
                    updateLegend(activeLayer);
                    return;
                }
                // 결측점(육지 등) 제거 + 키 변환
                gridData = [];
                for (var i = 0; i < data.points.length; i++) {
                    var p = data.points[i];
                    if (p.s === 0 && p.d === 0 && p.temp === 0 && p.salt === 0 && p.zeta === 0) continue;
                    gridData.push({
                        lat: p.lat,
                        lon: p.lon,
                        crsp: p.s * 100, // m/s → cm/s
                        crdir: p.d
                    });
                }
                console.log('[OceanOverlay] KHOA 격자 점 수:', gridData.length);
                updateLegend(activeLayer);
                renderGridToOffscreen();
                startParticleAnimation();
            })
            .catch(function (e) {
                console.warn('[OceanOverlay] KHOA 로드 실패:', e.message);
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
        var zoom = mapRef.getView().getZoom();

        // 격자 간격(약 0.15°)을 현재 줌의 픽셀로 환산해서 반경에 사용한다.
        // 줌인할수록 반경도 같이 커져 빈 공간 없이 색이 채워진다.
        // (KHOA 격자 lat 간격은 보통 0.13~0.15°)
        var GRID_DEG = 0.15;
        var refLat = 35;
        var p1 = mapRef.getPixelFromCoordinate(ol.proj.fromLonLat([127.0, refLat]));
        var p2 = mapRef.getPixelFromCoordinate(ol.proj.fromLonLat([127.0, refLat + GRID_DEG]));
        var spacingPx = p1 && p2 ? Math.abs(p2[1] - p1[1]) : 20;
        var radius = Math.max(10, spacingPx * 0.95);

        gridData.forEach(function (item) {
            var pixel = mapRef.getPixelFromCoordinate(ol.proj.fromLonLat([item.lon, item.lat]));
            if (!pixel) return;

            var x = pixel[0];
            var y = pixel[1];
            if (x < -radius || x > w + radius || y < -radius || y > h + radius) return;

            var value;
            if (activeLayer === 'current') value = item.crsp || 0;
            else if (activeLayer === 'wind') value = item.crsp ? item.crsp / 10 : 0;
            else value = item.crsp ? item.crsp / 20 : 0;

            var color = interpolateColor(scale, value);

            var gradient = gridCtx.createRadialGradient(x, y, 0, x, y, radius);
            gradient.addColorStop(0, 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',' + color[3] + ')');
            gradient.addColorStop(0.6, 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',' + (color[3] * 0.5) + ')');
            gradient.addColorStop(1, 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',0)');

            gridCtx.fillStyle = gradient;
            gridCtx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        });

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

        particles = [];
        for (var i = 0; i < MAX_PARTICLES; i++) {
            particles.push(createParticle());
        }

        // 트레일 캔버스 초기화
        if (trailCtx && trailCanvas) {
            var tw = trailCanvas.width / (window.devicePixelRatio || 1);
            var th = trailCanvas.height / (window.devicePixelRatio || 1);
            trailCtx.clearRect(0, 0, tw, th);
        }

        animate();
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
            age: Math.floor(Math.random() * 80),
            maxAge: 60 + Math.floor(Math.random() * 60),
            prevPx: null,
            prevPy: null
        };
    }

    function animate() {
        if (!ctx || !canvas || !mapRef || !gridData) return;

        var w = canvas.width / (window.devicePixelRatio || 1);
        var h = canvas.height / (window.devicePixelRatio || 1);
        var scale = COLOR_SCALES[activeLayer];

        // ① 트레일 캔버스를 약간 페이드(검정 반투명 덮기) → 잔상이 서서히 사라짐
        if (trailCtx) {
            trailCtx.globalCompositeOperation = 'destination-out';
            trailCtx.fillStyle = 'rgba(0,0,0,0.06)';
            trailCtx.fillRect(0, 0, w, h);
            trailCtx.globalCompositeOperation = 'source-over';
        }

        // ② 입자 업데이트 + 트레일 캔버스에 짧은 선분으로 그리기
        // 이동량은 지도 좌표(EPSG:3857) 단위. 줌인하면 화면상 같은 미터가 더 큰 픽셀이라
        // 자동으로 빠르게 흐르는 것처럼 보임.
        // 속도 스케일: KHOA s(m/s) → cm/s 변환된 crsp(0~250 정도) → 좌표 단위 이동량.
        // 한 프레임당 m 단위 이동. 1 cm/s = 0.01 m/s. 한 프레임 ≈ 1초로 가정 시
        // 0.01 m 가 되어 화면에서 안 보이므로 50배 가속.
        var SPEED_SCALE = 50;

        particles.forEach(function (p) {
            var lonLat = ol.proj.toLonLat([p.x, p.y]);
            var nearest = findNearestGrid(lonLat[1], lonLat[0]);

            var spdValue = 0;
            if (nearest) {
                var dirRad = (nearest.crdir || 0) * Math.PI / 180;
                var spdMps = (nearest.crsp || 0) * 0.01; // cm/s → m/s
                spdValue = nearest.crsp || 0;

                p.x += Math.sin(dirRad) * spdMps * SPEED_SCALE;
                p.y -= Math.cos(dirRad) * spdMps * SPEED_SCALE;
            }

            p.age++;
            // 격자점이 없거나 너무 느리면 자주 재생성
            if (p.age > p.maxAge || !nearest || spdValue < 0.5) {
                var newP = createParticle();
                p.x = newP.x;
                p.y = newP.y;
                p.age = 0;
                p.prevPx = null;
                p.prevPy = null;
                return;
            }

            var pixel = mapRef.getPixelFromCoordinate([p.x, p.y]);
            if (!pixel) return;
            var px = pixel[0], py = pixel[1];

            // 화면 밖이면 재생성
            if (px < 0 || py < 0 || px > w || py > h) {
                var np = createParticle();
                p.x = np.x; p.y = np.y; p.age = 0;
                p.prevPx = null; p.prevPy = null;
                return;
            }

            // 트레일에 짧은 선분 그리기 (이전 픽셀 → 현재 픽셀)
            if (trailCtx && p.prevPx !== null) {
                var col = interpolateColor(scale, spdValue);
                trailCtx.strokeStyle = 'rgba(255,255,255,0.85)';
                // 빠를수록 굵게 + 더 진하게
                var lw = 0.8 + Math.min(2.2, spdValue / 30);
                trailCtx.lineWidth = lw;
                trailCtx.lineCap = 'round';
                trailCtx.beginPath();
                trailCtx.moveTo(p.prevPx, p.prevPy);
                trailCtx.lineTo(px, py);
                trailCtx.stroke();
            }
            p.prevPx = px;
            p.prevPy = py;
        });

        // ③ 메인 캔버스 합성: 색상 격자(정적) + 트레일(애니메이션)
        ctx.clearRect(0, 0, w, h);
        if (gridCanvas) ctx.drawImage(gridCanvas, 0, 0, w, h);
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

})();
