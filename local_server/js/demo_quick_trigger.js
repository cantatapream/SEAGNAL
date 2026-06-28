/**
 * ============================================================================
 * 파일명: js/demo_quick_trigger.js
 * 역할: [데모 시연] 메인 페이지 "해역별 특보현황" 헤더 5연타 → 특보 시연 즉시 활성화
 * ============================================================================
 *
 * [동작 개요 — 단계 진행식]
 * 관리자 센터(헤더 10연타) → 시연 탭에 들어가지 않고도, 메인 페이지의
 * "해역별 특보현황" 아코디언 헤더(#main-accordion-header)를 짧은 시간 안에
 * 5번 연속 클릭할 때마다 다음 단계가 순서대로 실행된다:
 *   [1단계] 첫 5연타 → 특보 시연 활성화
 *     ① 테스트 모드 ON (POST /api/admin/demo/testmode)
 *     ② 저장된 데모 특보 슬롯 전부 표출 (POST /api/admin/demo/emit, 슬롯별 관리자 푸시)
 *     ③ reapplyDemoAlerts() 로 본인 화면 즉시 반영(폴링 대기 없이)
 *   [2단계] 다음 5연타 → 태풍 발생/소멸 테스트 푸시
 *     ④ POST /api/admin/demo/typhoon-test {kind:'onset'}      (발생)
 *     ⑤ POST /api/admin/demo/typhoon-test {kind:'dissipation'} (소멸)
 *        → 둘 다 sendAdminPush 로 관리자 등록 기기에만 발송.
 *   [3단계] 다음 5연타 → 위치기반 시연 8건 즉시 발송 (모두 관리자 기기에만)
 *     ⑥ POST /api/admin/demo/typhoon-radius-test {kind:'strong'} (강풍반경 진입)
 *     ⑦ POST /api/admin/demo/typhoon-radius-test {kind:'storm'}  (폭풍반경 진입)
 *     ⑧ 위치기반 특보 시연 6종 즉시 — laDemoSetPosition() + laDemoRun(id,0):
 *        prelim(예비특보 발표) → adv_pub(풍랑주의보 발효예정) → adv_act(발효중)
 *        → warn_pub(풍랑경보 발표) → warn_act(풍랑경보 발효) → typhoon(태풍경보 발효)
 *        (각각 /api/location-alert/demo 가 이 기기 토큰 1대에만 발송)
 *   [4단계 이후] 동작 없음 (추후 기능 추가 예정)
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
    var _busy = false;         // 동작 진행 중 재진입 방지
    var _stage = 0;            // 0=특보 시연(1단계), 1=태풍 발생/소멸(2단계), 2=위치기반(3단계), 3+=동작 없음

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

    /**
     * [2단계] 태풍 발생/소멸 테스트 푸시 — 발생 → 소멸 순차 발송.
     * 둘 다 /api/admin/demo/typhoon-test 가 sendAdminPush 로 관리자 등록 기기에만
     * 발송한다(위치기반 반경 typhoon-radius-test 는 호출하지 않음 — 제외).
     */
    function _sendTyphoonTests() {
        if (_busy) return;
        _busy = true;
        var _post = function (kind) {
            return fetch('/api/admin/demo/typhoon-test', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind: kind })
            }).then(function (r) { return r.json().catch(function () { return {}; }); })
                .catch(function () { return {}; });
        };
        // 발생 → 소멸 순차 (KMA 실데이터 조회가 있어 직렬 처리)
        _post('onset').then(function (r1) {
            return _post('dissipation').then(function (r2) {
                var ok1 = !!(r1 && r1.success), ok2 = !!(r2 && r2.success);
                if (ok1 && ok2) {
                    _toast('태풍 발생·소멸 테스트 푸시를 전송했습니다.');
                } else {
                    var err = ((r1 && r1.error) || '') + ' ' + ((r2 && r2.error) || '');
                    _toast('태풍 테스트 발송 실패' + (err.trim() ? ': ' + err.trim() : ''));
                }
            });
        }).catch(function () {
            _toast('태풍 테스트 발송에 실패했습니다.');
        }).then(function () { _busy = false; });
    }

    /**
     * [3단계] 위치기반 시연 8건 즉시 발송 (모두 관리자 기기에만):
     *   (A) 태풍 위치기반 반경: 강풍(strong) → 폭풍(storm)  [typhoon-radius-test]
     *   (B) 위치기반 특보 시연 6종 즉시: 기존 전역 laDemoSetPosition()+laDemoRun(id,0)
     *       → 각각 /api/location-alert/demo 가 이 기기 토큰 1대에만 발송.
     */
    function _sendLocationDemos() {
        if (_busy) return;
        _busy = true;
        var _radius = function (kind) {
            return fetch('/api/admin/demo/typhoon-radius-test', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind: kind })
            }).then(function (r) { return r.json().catch(function () { return {}; }); })
                .catch(function () { return {}; });
        };
        var LA_IDS = ['prelim', 'adv_pub', 'adv_act', 'warn_pub', 'warn_act', 'typhoon'];
        // (A) 강풍 → 폭풍 반경
        _radius('strong')
            .then(function () { return _radius('storm'); })
            .then(function () {
                // (B) 위치기반 특보 시연 6종 — 전역 함수 재사용(미로드면 건너뜀)
                if (typeof window.laDemoRun !== 'function') return;
                var p = Promise.resolve();
                if (typeof window.laDemoSetPosition === 'function') {
                    p = p.then(function () { return window.laDemoSetPosition(); }).catch(function () { });
                }
                LA_IDS.forEach(function (id) {
                    p = p.then(function () { return window.laDemoRun(id, 0); }).catch(function () { });
                });
                return p;
            })
            .then(function () { _toast('위치기반 특보 시연 푸시를 전송했습니다. (총 8건)'); })
            .catch(function () { _toast('위치기반 시연 발송에 실패했습니다.'); })
            .then(function () { _busy = false; });
    }

    /** 완성된 5연타 1회 → 현재 단계 동작 실행 후 다음 단계로 진행 */
    function _dispatch() {
        if (_busy) return;
        if (_stage === 0) {
            _stage = 1;
            _activate();              // 1단계: 특보 시연 활성화
        } else if (_stage === 1) {
            _stage = 2;
            _sendTyphoonTests();      // 2단계: 태풍 발생/소멸 테스트 푸시
        } else if (_stage === 2) {
            _stage = 3;
            _sendLocationDemos();     // 3단계: 위치기반 시연 8건 즉시 발송
        }
        // _stage >= 3 → 동작 없음 (추후 추가 예정)
    }

    function _onHeaderClick() {
        var now = Date.now();
        if (now - _firstTs > WINDOW_MS) { _count = 0; _firstTs = now; }
        _count++;
        if (_count >= NEED_CLICKS) {
            _count = 0;
            if (_stage >= 3) return;  // 모든 단계 소진 — 불필요한 호출 방지
            // 관리자 등록 기기에서만 발동 — 일반 사용자는 무동작
            _isAdminDevice().then(function (ok) { if (ok) _dispatch(); });
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
