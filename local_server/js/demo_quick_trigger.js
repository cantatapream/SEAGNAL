/**
 * ============================================================================
 * 파일명: js/demo_quick_trigger.js
 * 역할: [데모 시연] 메인 페이지 "해역별 특보현황" 헤더 5연타 → 특보 시연 즉시 활성화
 * ============================================================================
 *
 * [동작 개요]
 * 관리자 센터(헤더 10연타) → 시연 탭에 들어가지 않고도, 메인 페이지의
 * "해역별 특보현황" 아코디언 헤더(#main-accordion-header)를 짧은 시간 안에
 * 5번 연속 클릭하면 다음을 한 번에 실행한다:
 *   ① 특보 시연 "테스트 모드" ON  (POST /api/admin/demo/testmode)
 *   ② 이 기기에 저장된 데모 특보 슬롯을 모두 표출 (POST /api/admin/demo/emit)
 *      → 각 표출은 관리자 등록 기기에만 푸시 알림을 보낸다(sendAdminPush).
 *   ③ reapplyDemoAlerts() 로 본인 화면에 즉시 반영(폴링 대기 없이).
 *
 * [안전 설계 — demo_alert.js 와 동일한 게이트]
 *   ① localStorage.seagnal_admin_mode === 'true' (관리자 모드)
 *   ② localStorage.push_token 존재
 *   ③ /api/admin/device-status?token= 로 "등록된 관리자 기기" 확인
 *   세 조건을 모두 통과한 기기에서만 동작한다. 일반 사용자는 5번 눌러도
 *   device-status 가 false → 아무 일도 일어나지 않는다(완전 무동작).
 *   추가로 /api/admin/* 라우트는 X-Admin-Token 게이트 뒤에 있어, 토큰이 없는
 *   기기의 호출은 서버에서도 거부된다(이중 방어).
 *
 * [연계]
 *   - 표출/머지 표시는 js/demo_alert.js 가 담당(관리자 기기 폴링).
 *   - admin.js 의 fetch 래퍼가 X-Admin-Token 을 자동 첨부하므로 admin.js
 *     이후에 로드되어야 한다(index2.html 에서 demo_alert.js 인근 로드).
 * ============================================================================
 */
(function () {
    'use strict';
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    var NEED_CLICKS = 5;       // 발동에 필요한 연속 클릭 수
    var WINDOW_MS = 3000;      // 연속 클릭으로 인정하는 시간창
    var _count = 0;
    var _firstTs = 0;
    var _busy = false;         // 활성화 진행 중 재진입 방지

    function _adminMode() {
        try { return localStorage.getItem('seagnal_admin_mode') === 'true'; } catch (e) { return false; }
    }
    function _pushToken() {
        try { return localStorage.getItem('push_token') || ''; } catch (e) { return ''; }
    }

    /** 관리자 모드 + 등록된 관리자 기기인지 판정 (둘 다 만족해야 true) */
    function _isAdminDevice() {
        var token = _pushToken();
        if (!_adminMode() || !token) return Promise.resolve(false);
        return fetch('/api/admin/device-status?token=' + encodeURIComponent(token))
            .then(function (r) { return r.ok ? r.json() : { registered: false }; })
            .then(function (st) { return !!(st && st.registered); })
            .catch(function () { return false; });
    }

    /** 짧은 안내 토스트 (전역 헬퍼가 없을 때를 대비해 자체 포함) */
    function _toast(msg) {
        try {
            if (typeof window.showToast === 'function') { window.showToast(msg); return; }
        } catch (e) { /* noop */ }
        try {
            var el = document.createElement('div');
            el.textContent = msg;
            el.style.cssText = 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);'
                + 'background:linear-gradient(135deg,#a855f7,#7c3aed);color:#fff;padding:10px 18px;'
                + 'border-radius:10px;font-size:0.86rem;font-weight:700;z-index:99999;'
                + 'box-shadow:0 6px 20px rgba(124,58,237,0.45);max-width:88%;text-align:center;';
            document.body.appendChild(el);
            setTimeout(function () { try { el.remove(); } catch (e) { } }, 2600);
        } catch (e) { /* noop */ }
    }

    /**
     * ① 저장된 데모 슬롯 조회(먼저) → ② 슬롯이 있을 때만 테스트 모드 ON
     * → ③ 슬롯 전부 표출 → ④ 본인 화면 즉시 반영.
     *
     * [순서 주의] 테스트 모드를 먼저 켜면 실 특보가 숨겨지는데, 표출할 슬롯이
     * 0건이면 "빈 화면"으로 남아 관리자 센터에서 수동으로 꺼야만 복구된다.
     * 그래서 슬롯이 있는 것을 확인한 뒤에만 테스트 모드를 켠다.
     */
    function _activate() {
        if (_busy) return;
        _busy = true;
        fetch('/api/admin/demo/slots', { cache: 'no-cache' })
            .then(function (r) { return r.ok ? r.json() : { slots: [] }; })
            .then(function (data) {
                var slots = (data && data.slots) || [];
                if (!slots.length) {
                    _toast('저장된 데모 특보가 없습니다. (관리자 센터에서 먼저 등록하세요)');
                    return;
                }
                // ② 테스트 모드 ON
                return fetch('/api/admin/demo/testmode', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled: true })
                })
                    // ③ 저장된 슬롯을 순차 표출 (각 표출이 관리자 기기에 푸시 발송)
                    .then(function () {
                        return slots.reduce(function (p, slot) {
                            return p.then(function () {
                                return fetch('/api/admin/demo/emit', {
                                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ slotId: slot.id })
                                }).then(function () { }).catch(function () { });
                            });
                        }, Promise.resolve());
                    })
                    // ④ 본인 화면 즉시 반영 (demo_alert.js 폴링을 기다리지 않음)
                    .then(function () {
                        if (typeof window.reapplyDemoAlerts === 'function') setTimeout(window.reapplyDemoAlerts, 300);
                        _toast('특보 시연이 활성화되었습니다. (데모 특보 ' + slots.length + '건 표출)');
                    });
            })
            .catch(function () { _toast('특보 시연 활성화에 실패했습니다.'); })
            .then(function () { _busy = false; });
    }

    function _onHeaderClick() {
        var now = Date.now();
        if (now - _firstTs > WINDOW_MS) { _count = 0; _firstTs = now; }
        _count++;
        if (_count >= NEED_CLICKS) {
            _count = 0;
            // 관리자 등록 기기에서만 발동 — 일반 사용자는 무동작
            _isAdminDevice().then(function (ok) { if (ok) _activate(); });
        }
    }

    function _init() {
        var header = document.getElementById('main-accordion-header');
        if (!header) return;
        // 기존 onclick(toggleMainAccordion) 은 그대로 두고 클릭 카운터만 추가
        header.addEventListener('click', _onHeaderClick);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }
})();
