/**
 * ============================================================================
 * js/advisory_demo.js — "특보 예측 시연" 기기측 표출기 (관리자 등록 기기 전용)
 * ============================================================================
 *
 * demo_alert.js 와 동일한 게이트/폴링 패턴:
 *   ① localStorage.seagnal_admin_mode === 'true' (관리자 모드)
 *   ② localStorage.push_token 존재
 *   ③ /api/admin/device-status?token= 로 "등록된 관리자 기기" 확인
 *   → 통과한 기기만 /api/advisory-demo/active 를 5초 주기 폴링.
 *
 * 표출 중(payload != null)이면:
 *   - window.__advisoryDemoActive = true  (실제 예측 로더가 덮어쓰지 않도록)
 *   - window.renderAdvisoryPrediction(payload) 로 목업을 그대로 렌더.
 * 표출 해제/시연 OFF 면:
 *   - 플래그 해제 후 window.loadAdvisoryPrediction() 로 실제 예측 복원.
 *
 * 비관리자/일반 사용자에게는 아무 영향 없음(게이트에서 즉시 종료).
 * ============================================================================
 */
(function () {
    'use strict';
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    var POLL_MS = 5000;
    var _timer = null;
    var _isAdminDevice = false;
    var _lastId = undefined; // 마지막으로 표출한 scenarioId(또는 null)

    function _adminMode() {
        try { return localStorage.getItem('seagnal_admin_mode') === 'true'; } catch (e) { return false; }
    }
    function _pushToken() {
        try { return localStorage.getItem('push_token') || ''; } catch (e) { return ''; }
    }

    function _apply(state) {
        var payload = state && state.payload;
        var id = state && state.scenarioId ? state.scenarioId : null;

        if (payload) {
            window.__advisoryDemoActive = true;
            try { if (typeof window.__advShowAccordion === 'function') window.__advShowAccordion(true); } catch (e) { /* noop */ }
            if (id !== _lastId) {
                _lastId = id;
                try {
                    if (typeof window.renderAdvisoryPrediction === 'function') {
                        window.renderAdvisoryPrediction(payload);
                    }
                } catch (e) { /* noop */ }
            }
        } else {
            // 표출 없음/시연 OFF → 실제 예측 복원 (이전에 시연 중이었을 때만 1회)
            if (window.__advisoryDemoActive || _lastId !== null) {
                window.__advisoryDemoActive = false;
                _lastId = null;
                try {
                    if (typeof window.loadAdvisoryPrediction === 'function') {
                        window.loadAdvisoryPrediction();
                    }
                } catch (e) { /* noop */ }
            }
        }
    }

    function _poll() {
        fetch('/api/advisory-demo/active', { cache: 'no-cache' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (state) { if (state) _apply(state); })
            .catch(function () { /* 네트워크 오류는 조용히 무시 */ });
    }

    function _start() {
        if (!_adminMode()) return;
        var token = _pushToken();
        if (!token) return;
        // 등록된 관리자 기기인지 확인 후에만 폴링 시작
        fetch('/api/admin/device-status?token=' + encodeURIComponent(token))
            .then(function (r) { return r.ok ? r.json() : { registered: false }; })
            .then(function (st) {
                _isAdminDevice = !!(st && st.registered);
                if (!_isAdminDevice) return;
                _poll();
                if (_timer) clearInterval(_timer);
                _timer = setInterval(_poll, POLL_MS);
                document.addEventListener('visibilitychange', function () {
                    if (!document.hidden) _poll();
                });
            })
            .catch(function () { /* 판정 실패 → 표출기 비활성(안전) */ });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _start);
    } else {
        _start();
    }

    // 디버그/수동 트리거용 노출
    window.__advisoryDemoPoll = _poll;
})();
