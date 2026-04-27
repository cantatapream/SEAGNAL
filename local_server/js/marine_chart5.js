/**
 * ============================================================================
 * 파일명: js/marine_chart5.js
 * 역할: 해상일기도 — 전체화면 제스처 (핀치줌·팬·탭 토글)
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

    // ── 줌·팬 상태 ──
    const transform = {
        scale: 1,
        panX: 0,
        panY: 0,
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
     */
    function applyTransform() {
        const img = MC.el && MC.el.fsImage;
        if (!img) return;
        // CSS 의 top/left:50% + 자체 translate(-50%,-50%) 와 결합되도록
        // translate3d 사용 (GPU 가속 + 서브픽셀 정밀도)
        img.style.transform =
            `translate(-50%, -50%) translate3d(${transform.panX}px, ${transform.panY}px, 0) scale(${transform.scale})`;
    }

    /**
     * transform 초기화 — 풀스크린 종료 시 호출.
     */
    function resetTransform() {
        transform.scale = 1;
        transform.panX = 0;
        transform.panY = 0;
        const img = MC.el && MC.el.fsImage;
        if (img) {
            // CSS 기본값으로 되돌림 (translate(-50%,-50%) 만)
            img.style.transform = 'translate(-50%, -50%)';
        }
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
        const stage = MC.el && MC.el.fsStage;
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

    function onTouchEnd(e) {
        if (touchMode === 'tap') {
            const dt = Date.now() - tapStartTime;
            if (dt <= TAP_MAX_DURATION_MS) {
                // 짧고 이동 거의 없는 탭 → 컨트롤 토글
                if (MC.toggleControls) MC.toggleControls();
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
            // 더블탭
            if (transform.scale > 1) {
                resetTransform();
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
    function setup() {
        const stage = MC.el && MC.el.fsStage;
        if (!stage) return;

        // 패시브 false 로 preventDefault 가능하게
        stage.addEventListener('touchstart', onTouchStart, { passive: false });
        stage.addEventListener('touchmove', onTouchMove, { passive: false });
        stage.addEventListener('touchend', onTouchEnd, { passive: false });
        stage.addEventListener('touchcancel', onTouchEnd, { passive: false });

        // 데스크톱 보조: 클릭 → 컨트롤 토글, 더블 클릭 → 줌 토글
        stage.addEventListener('click', (e) => {
            if (e.target === stage || e.target.id === 'mc-fs-image') {
                if (!checkDoubleTap()) {
                    if (MC.toggleControls) MC.toggleControls();
                }
            }
        });
        stage.addEventListener('wheel', onWheel, { passive: false });

        // 화면 회전·리사이즈 시 transform 리셋 (이미지 사이즈 바뀌면 좌표 무효)
        window.addEventListener('resize', () => {
            const overlay = MC.el && MC.el.fullscreen;
            if (overlay && !overlay.hasAttribute('hidden')) {
                resetTransform();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setup);
    } else {
        setup();
    }

    // ── 전역 노출 ──
    Object.assign(MC, {
        resetTransform,
        _transform: transform, // 디버그용
    });
})();
