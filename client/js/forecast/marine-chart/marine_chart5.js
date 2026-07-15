/**
 * ============================================================================
 * 파일명: js/forecast/marine-chart/marine_chart5.js
 * 역할: 해상일기도 — 전체화면 제스처 (핀치줌·팬·탭 토글)
 * [연계]
 *  - 사용하는 파일 : marine_chart1~4.js (MC 네임스페이스 — 상태·전체화면·컨트롤)
 *  - 서버 API      : 없음 (제스처 입력만 처리)
 *  - 마크업        : #mc-fs-stage (전체화면 스테이지 DOM)
 *  - 나를 쓰는 곳  : marine_chart3.js 전체화면 진입 시 제스처 바인딩 초기화
 * ============================================================================
 *
 * [개요]
 *   #mc-fs-stage 위에서 발생하는 터치 제스처를 통합 처리:
 *     - 한 손가락 짧은 탭 (이동 거의 없음, 짧은 시간) → MC.toggleControls()
 *     - 한 손가락 드래그 (줌이 1배 초과일 때만) → 팬(이동)
 *     - 두 손가락 핀치 → 줌 인/아웃 (1배 ~ 4배)
 *
 * [핵심 변환]
 *   transform: translate(-50%, -50%) translate(panX, panY) scale(scale)
 *   CSS 가 `top:50%; left:50%; transform: translate(-50%,-50%)` 로 가운데
 *   정렬되어 있으므로, 우리는 추가 translate + scale 만 덧붙임.
 *
 * [좌표계]
 *   panX, panY 는 화면 픽셀 단위. scale 은 1 부터 4 까지.
 *
 * [제스처 충돌 방지]
 *   - touchstart 시 1손가락이면 tap 후보 등록 (시간/이동 누적 추적)
 *   - 두 번째 손가락이 닿으면 tap 후보 취소 → pinch 모드
 *   - touchmove 의 누적 이동 거리가 임계값 초과하면 tap 취소
 *
 * [전역 노출]
 *   resetTransform()  — 풀스크린 종료 시 transform 초기화
 *
 * [초보자 안내]
 *   "핀치" = 두 손가락 사이 거리 변화. touchstart 에서 초기 거리 d0 를
 *   기록 → touchmove 마다 d / d0 비율을 scale 에 곱하면 자연스러운 줌.
 * ============================================================================
 */

(function () {
    'use strict';

    const MC = window.MarineChart;
    if (!MC) {
        console.error('[marine_chart5] marine_chart1.js 가 먼저 로드되어야 합니다.');
        return;
    }

    // ── 줌·팬·회전 상태 ──
    // rotation: 0 또는 90 (사용자가 가로보기 버튼으로 토글). 핀치줌과 결합.
    const transform = {
        scale: 1,
        panX: 0,
        panY: 0,
        rotation: 0,
    };
    const MIN_SCALE = 1;
    const MAX_SCALE = 4;

    // ── 제스처 추적 상태 ──
    let touchMode = 'none';        // 'tap' | 'pan' | 'pinch'
    let tapStartTime = 0;
    let tapStartX = 0, tapStartY = 0;
    let panStartX = 0, panStartY = 0;
    let panOriginPan = { x: 0, y: 0 };
    let pinchStartDist = 0;
    let pinchStartScale = 1;

    const TAP_MAX_MOVE_PX = 8;     // 이만큼 이내 이동이면 탭으로 간주
    const TAP_MAX_DURATION_MS = 300;

    /**
     * 현재 transform 값을 이미지에 반영.
     * MC.el.fsImage 캐시 대신 직접 조회 — init() 호출 시점에 무관하게 동작.
     * 변환 순서: scale → rotate → translate → center (CSS 는 우→좌 순서로 적용)
     */
    function applyTransform() {
        const img = document.getElementById('mc-fs-image');
        if (!img) return;
        img.style.transform =
            `translate(-50%, -50%) translate3d(${transform.panX}px, ${transform.panY}px, 0) ` +
            `rotate(${transform.rotation}deg) scale(${transform.scale})`;
    }

    /**
     * transform 전체 초기화 — 풀스크린 종료/진입 시 호출.
     * rotation 까지 0 으로 리셋, 회전 버튼 활성 표시 해제.
     */
    function resetTransform() {
        transform.scale = 1;
        transform.panX = 0;
        transform.panY = 0;
        transform.rotation = 0;
        const img = document.getElementById('mc-fs-image');
        if (img) {
            img.style.transform = 'translate(-50%, -50%)';
        }
        const rotateBtn = document.getElementById('mc-fs-rotate');
        if (rotateBtn) rotateBtn.classList.remove('is-rotated');
    }

    /**
     * 줌·팬만 초기화 (회전 상태 유지).
     * 더블탭 줌 리셋, window.resize 같은 부분 리셋 시 사용.
     * 회전된 상태에선 fit-scale 재계산해서 컨테이너에 다시 꽉 차게.
     */
    function resetZoomPan() {
        transform.scale = 1;
        transform.panX = 0;
        transform.panY = 0;
        // 회전 중이면 fit-scale 다시 계산 (리사이즈 후에도 올바른 크기 유지)
        if (transform.rotation === 90) {
            const stage = document.getElementById('mc-fs-stage');
            const img = document.getElementById('mc-fs-image');
            if (stage && img) {
                const W = img.offsetWidth || img.naturalWidth || 0;
                const H = img.offsetHeight || img.naturalHeight || 0;
                if (W > 0 && H > 0) {
                    const fitScale = Math.min(
                        stage.clientHeight / W,
                        stage.clientWidth / H
                    );
                    if (fitScale < 1) transform.scale = fitScale;
                }
            }
        }
        applyTransform();
    }

    /**
     * 화면 회전 토글 — 0° ↔ 90°.
     * 회전 시 줌·팬 초기화, 90° 일 때 이미지가 컨테이너에 꽉 차도록 자동 fit-scale.
     * 거기서 사용자가 추가 핀치줌 가능.
     */
    function toggleRotation() {
        const stage = document.getElementById('mc-fs-stage');
        const img = document.getElementById('mc-fs-image');
        const rotateBtn = document.getElementById('mc-fs-rotate');
        if (!stage || !img) return;

        // 토글
        transform.rotation = transform.rotation === 0 ? 90 : 0;
        // 회전 시 줌·팬 초기화 (이전 좌표가 회전 후엔 무의미)
        transform.panX = 0;
        transform.panY = 0;
        transform.scale = 1;

        if (transform.rotation === 90) {
            // 회전 후 이미지의 가시 폭/높이는 원본의 height/width 와 swap.
            // 컨테이너 안에 꽉 차도록 fit-scale 계산.
            const W = img.offsetWidth || img.naturalWidth || 0;
            const H = img.offsetHeight || img.naturalHeight || 0;
            if (W > 0 && H > 0) {
                const fitScale = Math.min(
                    stage.clientHeight / W,    // 회전 후 가시 높이 = 원본 width
                    stage.clientWidth / H      // 회전 후 가시 폭 = 원본 height
                );
                // 이미지가 컨테이너보다 작으면 1배 유지, 크면 축소
                if (fitScale < 1) transform.scale = fitScale;
            }
        }

        applyTransform();

        // 버튼 시각 피드백 (CSS .is-rotated 가 색상·아이콘 변경)
        if (rotateBtn) rotateBtn.classList.toggle('is-rotated', transform.rotation === 90);

        // 회전 직후 컨트롤 잠시 표시 (사용자가 변화 인지)
        if (MC.showControls) MC.showControls();
    }

    /**
     * 두 점 사이 거리 (핀치 거리).
     */
    function distance(t0, t1) {
        const dx = t1.clientX - t0.clientX;
        const dy = t1.clientY - t0.clientY;
        return Math.hypot(dx, dy);
    }

    /**
     * 팬 범위 클램핑 — 이미지가 화면 밖으로 너무 멀리 빠지지 않게.
     * 줌이 클수록 더 멀리 팬 가능.
     */
    function clampPan() {
        const stage = document.getElementById('mc-fs-stage');
        if (!stage) return;
        const w = stage.clientWidth;
        const h = stage.clientHeight;
        // scale 1 일 땐 팬 무의미 → 0 으로
        if (transform.scale <= 1) {
            transform.panX = 0;
            transform.panY = 0;
            return;
        }
        // scale 비례한 한계: 화면 절반 * (scale-1)
        const limX = (w * (transform.scale - 1)) / 2;
        const limY = (h * (transform.scale - 1)) / 2;
        transform.panX = Math.max(-limX, Math.min(limX, transform.panX));
        transform.panY = Math.max(-limY, Math.min(limY, transform.panY));
    }

    /**
     * 줌 클램핑 — MIN_SCALE ~ MAX_SCALE.
     */
    function clampScale() {
        if (transform.scale < MIN_SCALE) transform.scale = MIN_SCALE;
        if (transform.scale > MAX_SCALE) transform.scale = MAX_SCALE;
    }

    // ── 터치 이벤트 핸들러 ──

    function onTouchStart(e) {
        const touches = e.touches;
        if (touches.length === 1) {
            // 1손가락: tap 후보로 시작
            touchMode = 'tap';
            const t = touches[0];
            tapStartTime = Date.now();
            tapStartX = t.clientX;
            tapStartY = t.clientY;
            // 이미 줌 인 상태면 pan 가능하도록 좌표 캐시
            panStartX = t.clientX;
            panStartY = t.clientY;
            panOriginPan = { x: transform.panX, y: transform.panY };
        } else if (touches.length === 2) {
            // 2손가락: pinch 모드
            touchMode = 'pinch';
            pinchStartDist = distance(touches[0], touches[1]);
            pinchStartScale = transform.scale;
        }
    }

    /**
     * 풀스크린 차트 모드의 touchmove 핸들러 — 핀치 줌, 한 손가락 드래그 모두 처리.
     * preventDefault 로 브라우저 기본 스크롤·줌 차단 후 자체 transform 으로 조작.
     */
    function onTouchMove(e) {
        const touches = e.touches;
        // 풀스크린에선 페이지 스크롤·줌 모두 우리가 처리하므로 기본 막기
        e.preventDefault();

        if (touchMode === 'tap' && touches.length === 1) {
            const t = touches[0];
            const dx = t.clientX - tapStartX;
            const dy = t.clientY - tapStartY;
            const moved = Math.hypot(dx, dy);
            if (moved > TAP_MAX_MOVE_PX) {
                // 이동이 임계값 초과 → tap 후보 탈락. 줌 1배 초과면 pan, 아니면 무시.
                if (transform.scale > 1) {
                    touchMode = 'pan';
                } else {
                    // 줌 1배에선 pan 의미 없음 → 그냥 무시 (1배 상태 고정)
                    touchMode = 'none';
                }
            }
        }

        if (touchMode === 'pan' && touches.length === 1) {
            const t = touches[0];
            transform.panX = panOriginPan.x + (t.clientX - panStartX);
            transform.panY = panOriginPan.y + (t.clientY - panStartY);
            clampPan();
            applyTransform();
        } else if (touchMode === 'pinch' && touches.length === 2) {
            const dist = distance(touches[0], touches[1]);
            if (pinchStartDist > 0) {
                const factor = dist / pinchStartDist;
                transform.scale = pinchStartScale * factor;
                clampScale();
                clampPan();
                applyTransform();
            }
        }
    }

    // 마지막 touchend 시각 — 모바일 단일 탭 후 브라우저가 자동 발화하는
    // synthetic click 을 무시하기 위해 사용 (이중 토글 방지).
    let lastTouchEndTime = 0;

    function onTouchEnd(e) {
        if (touchMode === 'tap') {
            const dt = Date.now() - tapStartTime;
            if (dt <= TAP_MAX_DURATION_MS) {
                // 짧고 이동 거의 없는 탭 → 더블탭 vs 단일탭 판정 후 처리.
                // 더블탭이면 줌 토글, 단일탭이면 컨트롤 토글.
                if (!checkDoubleTap()) {
                    if (MC.toggleControls) MC.toggleControls();
                }
                // 후속 synthetic click 차단 — touch 후 브라우저가 자동 발화하는
                // click 이벤트가 다시 toggleControls 호출해서 net=0 (사용자 체감
                // 변화 없음) 되는 문제 해결.
                if (e.cancelable) e.preventDefault();
                lastTouchEndTime = Date.now();
            }
        }
        // 두 손가락 중 하나만 떼졌을 때: pinch → pan/tap 으로 전환되는 케이스가
        // 있을 수 있으나 단순화를 위해 즉시 종료. 사용자가 다시 1손가락 터치해야 함.
        if (e.touches.length === 0) {
            touchMode = 'none';
        }
    }

    /**
     * 더블탭 — 1배 ↔ 2배 토글 (편의 기능).
     * 마지막 탭 시각을 기록해서 짧은 간격 두 번이면 더블탭으로 처리.
     */
    let lastTapTime = 0;
    const DOUBLE_TAP_GAP_MS = 280;
    function checkDoubleTap() {
        const now = Date.now();
        if (now - lastTapTime < DOUBLE_TAP_GAP_MS) {
            // 더블탭 — 줌·팬만 토글, 회전 상태는 보존
            // (회전 중일 때 fit-scale 이상이면 그게 1배 — 더블탭으로 2배 ↔ 1배)
            const baseScale = transform.rotation === 90
                ? Math.max(1, transform.scale)
                : 1;
            if (transform.scale > baseScale) {
                resetZoomPan();
            } else {
                transform.scale = 2;
                transform.panX = 0;
                transform.panY = 0;
                applyTransform();
            }
            lastTapTime = 0;       // 트리플탭 방지
            return true;
        }
        lastTapTime = now;
        return false;
    }

    /**
     * 데스크톱 마우스 휠 줌 (보조). 모바일 외에서도 테스트 편의.
     */
    function onWheel(e) {
        e.preventDefault();
        const delta = -e.deltaY * 0.002;
        transform.scale = transform.scale + delta * transform.scale;
        clampScale();
        clampPan();
        applyTransform();
    }

    // ── 이벤트 바인딩 ──
    // [중요] DOMContentLoaded 시점엔 MC.el 이 비어있으므로 직접 DOM 조회.
    // 풀스크린 DOM 자체는 HTML 파싱 시점부터 존재함.
    function setup() {
        const stage = document.getElementById('mc-fs-stage');
        if (!stage) return;

        // 패시브 false 로 preventDefault 가능하게
        stage.addEventListener('touchstart', onTouchStart, { passive: false });
        stage.addEventListener('touchmove', onTouchMove, { passive: false });
        stage.addEventListener('touchend', onTouchEnd, { passive: false });
        stage.addEventListener('touchcancel', onTouchEnd, { passive: false });

        // 데스크톱 보조: 마우스 클릭 → 컨트롤 토글, 더블 클릭 → 줌 토글.
        // 모바일에서는 touchend 가 이미 처리하므로 후속 synthetic click 무시
        // (touchend preventDefault 가 대부분 환경에서 차단하지만, 일부 환경에서
        //  안 막히는 경우 대비 — lastTouchEndTime 기준 500ms 이내면 무시).
        stage.addEventListener('click', (e) => {
            if (Date.now() - lastTouchEndTime < 500) return; // 모바일 중복 차단
            if (e.target === stage || e.target.id === 'mc-fs-image') {
                if (!checkDoubleTap()) {
                    if (MC.toggleControls) MC.toggleControls();
                }
            }
        });
        stage.addEventListener('wheel', onWheel, { passive: false });

        // 화면 회전·리사이즈 시 줌·팬만 리셋 (회전 상태는 보존, fit-scale 재계산)
        window.addEventListener('resize', () => {
            const overlay = document.getElementById('mc-fullscreen');
            if (overlay && !overlay.hasAttribute('hidden')) {
                resetZoomPan();
            }
        });

        // 회전 버튼 클릭 → 0° ↔ 90° 토글
        const rotateBtn = document.getElementById('mc-fs-rotate');
        if (rotateBtn) {
            rotateBtn.addEventListener('click', toggleRotation);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setup);
    } else {
        setup();
    }

    // ── 전역 노출 ──
    Object.assign(MC, {
        resetTransform,
        toggleRotation,
        _transform: transform, // 디버그용
    });
})();
