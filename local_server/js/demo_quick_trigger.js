/**
 * ============================================================================
 * 파일명: js/demo_quick_trigger.js
 * 역할: [데모 시연] 메인 페이지 헤더 5연타 → 특보/태풍/위치기반 시연 즉시 발동
 * ============================================================================
 *
 * 관리자 센터(헤더 10연타) → 시연 탭에 들어가지 않고도, 메인 페이지의 두 헤더를
 * 각각 짧은 시간 안에 5번 연속 클릭하면 시연이 발동한다.
 *
 * [A] "해역별 특보현황" 헤더(#main-accordion-header) — 단계 진행식
 *   [1단계] 첫 5연타 → 특보 시연 활성화
 *     ① 테스트 모드 ON (POST /api/admin/demo/testmode)
 *     ② 저장된 데모 특보 슬롯 전부 표출 (POST /api/admin/demo/emit, 슬롯별 관리자 푸시)
 *     ③ reapplyDemoAlerts() 로 본인 화면 즉시 반영(폴링 대기 없이)
 *   [2단계] 다음 5연타 → 태풍 발생/소멸 테스트 푸시
 *     ④ POST /api/admin/demo/typhoon-test {kind:'onset'}      (발생)
 *     ⑤ POST /api/admin/demo/typhoon-test {kind:'dissipation'} (소멸)
 *        → 둘 다 sendAdminPush 로 관리자 등록 기기에만 발송.
 *        + 이후 해양종합정보 '태풍' 클릭 시 자동 표출을 "무장"(_typhoonDemoArmed).
 *   [3단계 이후] 동작 없음 (추후 기능 추가 예정)
 *
 * [C] 해양종합정보 '태풍' 버튼(#ocean-typhoon-toggle-btn) — 무장 시 1회 자동 표출
 *   [A]-2단계로 무장된 뒤, 사용자가 직접 해양종합정보에서 '태풍'을 클릭하면:
 *     - window.OceanTyphoon.demoFocus 로 제6호 '장미' 강제 표출
 *     - 통보문 06-16호 선택(#tphn-bulletin) + 해역표출 강제(디버그) ON(#tphn-dbg-korea)
 *   무장은 1회성이며 메모리 기반(앱 재시작 시 자동 초기화 — 별도 영속 없음).
 *
 * [B] "해역별 기상현황" 헤더(#marine-status-accordion-header) — 단계 진행식(1회성)
 *   [1단계] 첫 5연타 → 위치기반 시연 8건 즉시 발송 (모두 관리자 기기에만)
 *     ⑥ POST /api/admin/demo/typhoon-radius-test {kind:'strong'} (강풍반경 진입)
 *     ⑦ POST /api/admin/demo/typhoon-radius-test {kind:'storm'}  (폭풍반경 진입)
 *     ⑧ 위치기반 특보 시연 6종 즉시 — laDemoSetPosition() + laDemoRun(id,0):
 *        prelim(예비특보 발표) → adv_pub(풍랑주의보 발효예정) → adv_act(발효중)
 *        → warn_pub(풍랑경보 발표) → warn_act(풍랑경보 발효) → typhoon(태풍경보 발효)
 *        (각각 /api/location-alert/demo 가 이 기기 토큰 1대에만 발송)
 *   [2단계] 다음 5연타 → AI 탭 '시연'(나리 소개 슬라이드) 자동 ON: window.openNariDemo()
 *     ⑨ 그 시연 화면을 닫으면(closeNariDemo) 음성 비서 '나리야' 자동 ON (앱 전용)
 *   [3단계 이후] 동작 없음
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
    var _busy = false;         // 동작 진행 중 재진입 방지(두 헤더 공유 — 발송 겹침 방지)
    var _stage = 0;            // [특보현황 헤더] 0=특보 시연(1단계), 1=태풍 발생/소멸(2단계), 2+=동작 없음
    var _marineStage = 0;      // [기상현황 헤더] 0=위치기반(1단계), 1=AI 시연 열기(2단계), 2+=동작 없음(1회성)
    var _nariyaArmed = false;  // 트리거로 연 AI 시연이 닫힐 때 나리야를 자동 ON 할지
    var _typhoonDemoArmed = false;            // 태풍 푸시(특보현황 2단계) 후 '태풍' 클릭 시 1회 자동 표출 무장
    var TPHN_DEMO = { year: 2026, seq: '6', bno: '16' };  // 제6호 장미 · 통보문 6-16호

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
     * ["해역별 기상현황" 5연타] 위치기반 시연 8건 즉시 발송 (모두 관리자 기기에만):
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

    /** ["해역별 특보현황" 5연타] 현재 단계 동작 실행 후 다음 단계로 진행 */
    function _dispatchAlertHeader() {
        if (_busy) return;
        if (_stage === 0) {
            _stage = 1;
            _activate();              // 1단계: 특보 시연 활성화
        } else if (_stage === 1) {
            _stage = 2;
            _typhoonDemoArmed = true;  // 이후 해양종합정보 '태풍' 클릭 시 장미·통보문 06-16 자동 표출
            _sendTyphoonTests();      // 2단계: 태풍 발생/소멸 테스트 푸시
        }
        // _stage >= 2 → 동작 없음 (추후 추가 예정)
    }

    /** 음성 비서 나리야 ON — 네이티브 플러그인 직접 호출(앱 전용, 웹/플러그인 없으면 무동작). */
    function _enableNariya() {
        try {
            var P = window.Capacitor && window.Capacitor.Plugins;
            var Native = P && P.SeagnalAssistant;
            if (!Native || !Native.enable) return;   // 앱 외 환경 — 무동작
            var profile = '{}';
            try { profile = localStorage.getItem('seagnal_profile') || '{}'; } catch (e) { /* noop */ }
            Native.enable({ serverUrl: location.origin, profile })
                .then(function () { _toast('음성 비서 나리야가 켜졌습니다.'); })
                .catch(function () { /* 권한/모델 미비 등 — 조용히 무시 */ });
        } catch (e) { /* noop */ }
    }

    /**
     * window.closeNariDemo 를 1회 래핑 — 기존 닫기 동작은 그대로 두고,
     * "트리거로 연 시연"이 닫힐 때만(_nariyaArmed) 나리야를 자동 ON 한다.
     * 닫기 버튼·하드웨어 뒤로가기(PopupStack) 모두 window.closeNariDemo 를 거치므로 한 곳만 래핑.
     */
    function _wrapCloseNariOnce() {
        if (window.__nariCloseWrappedBySeagnalDemo) return;
        var orig = window.closeNariDemo;
        if (typeof orig !== 'function') return;
        window.closeNariDemo = function () {
            var r;
            try { r = orig.apply(this, arguments); } catch (e) { r = undefined; }
            if (_nariyaArmed) { _nariyaArmed = false; _enableNariya(); }
            return r;
        };
        window.__nariCloseWrappedBySeagnalDemo = true;
    }

    /** [기상현황 2단계] AI 탭 시연(나리 소개 슬라이드) 열기 + 닫을 때 나리야 ON 무장. */
    function _openAiDemoAndArm() {
        if (typeof window.openNariDemo !== 'function') {
            _toast('AI 시연 모듈이 아직 로드되지 않았습니다.');
            return;
        }
        _wrapCloseNariOnce();   // openNariDemo 가 PopupStack 에 closeNariDemo 를 등록하기 전에 래핑
        _nariyaArmed = true;
        try { window.openNariDemo(); } catch (e) { _nariyaArmed = false; }
    }

    /** ["해역별 기상현황" 5연타] 1차=위치기반 시연, 2차=AI 시연 열기 (1회성). */
    function _dispatchMarineHeader() {
        if (_busy) return;
        if (_marineStage === 0) {
            _marineStage = 1;
            _sendLocationDemos();   // 1단계: 위치기반 시연 8건
        } else if (_marineStage === 1) {
            _marineStage = 2;
            _openAiDemoAndArm();    // 2단계: AI 시연 열기 → 닫으면 나리야 ON
        }
        // _marineStage >= 2 → 동작 없음 (1회성)
    }

    /**
     * [태풍 시연] 무장 상태에서 해양종합정보 '태풍' 클릭 시 1회 실행:
     *   제6호 장미 강제 표출(demoFocus) → 통보문 06-16호 선택 → 해역표출 강제(디버그) ON.
     * demoFocus 가 실데이터를 비동기 로드하므로, 통보문 드롭다운이 채워질 때까지 폴링.
     */
    function _runTyphoonDemo() {
        try {
            var OT = window.OceanTyphoon;
            if (!OT || typeof OT.demoFocus !== 'function') return;
            OT.demoFocus({ year: TPHN_DEMO.year, seq: TPHN_DEMO.seq });  // 장미(6호) 강제 표출
            _selectBulletinAndDebug(0);
        } catch (e) { /* 시연 실패는 조용히 무시 */ }
    }

    /** 통보문 드롭다운에서 6-16호를 골라 선택 + 디버그 체크. 드롭다운 채워질 때까지 ~4초 폴링. */
    function _selectBulletinAndDebug(tries) {
        var bSel = document.getElementById('tphn-bulletin');
        if (bSel && bSel.options && bSel.options.length) {
            // 통보문 code 형식: 1_<tmFc>_<seq>_<bno> → 3·4번째 필드로 6-16 매칭
            var target = null;
            for (var i = 0; i < bSel.options.length; i++) {
                var p = String(bSel.options[i].value || '').split('_');
                if (p[2] === TPHN_DEMO.seq && p[3] === TPHN_DEMO.bno) { target = bSel.options[i].value; break; }
            }
            if (target && bSel.value !== target) {
                bSel.value = target;
                bSel.dispatchEvent(new Event('change'));  // → selectBulletin 실행
            }
            // 해역표출 강제(디버그) 체크박스 ON
            var dbg = document.getElementById('tphn-dbg-korea');
            if (dbg && !dbg.checked) { dbg.checked = true; dbg.dispatchEvent(new Event('change')); }
            return;
        }
        if (tries < 25) setTimeout(function () { _selectBulletinAndDebug(tries + 1); }, 150);
    }

    /**
     * 5연타 카운터 생성기 — 헤더마다 독립된 카운트를 갖는다.
     * 5번째 클릭이 완성되면 관리자 등록 기기에서만 onComplete() 를 실행.
     * @param {Function} onComplete 5연타 완성 시 실행할 동작
     * @param {Function} [skip] true 를 반환하면 device-status 호출 없이 건너뜀
     */
    function _makeCounter(onComplete, skip) {
        var count = 0, firstTs = 0;
        return function () {
            var now = Date.now();
            if (now - firstTs > WINDOW_MS) { count = 0; firstTs = now; }
            count++;
            if (count >= NEED_CLICKS) {
                count = 0;
                if (typeof skip === 'function' && skip()) return;
                // 관리자 등록 기기에서만 발동 — 일반 사용자는 무동작
                _isAdminDevice().then(function (ok) { if (ok) onComplete(); });
            }
        };
    }

    function _init() {
        // [A] 해역별 특보현황 — 단계 진행식(특보 → 태풍)
        var alertHeader = document.getElementById('main-accordion-header');
        if (alertHeader) {
            // 기존 onclick(toggleMainAccordion) 은 그대로 두고 클릭 카운터만 추가
            alertHeader.addEventListener('click', _makeCounter(
                _dispatchAlertHeader,
                function () { return _stage >= 2; }  // 단계 소진 시 불필요한 호출 방지
            ));
        }
        // [B] 해역별 기상현황 — 단계 진행식(위치기반 → AI 시연), 1회성
        var marineHeader = document.getElementById('marine-status-accordion-header');
        if (marineHeader) {
            marineHeader.addEventListener('click', _makeCounter(
                _dispatchMarineHeader,
                function () { return _marineStage >= 2; }  // 단계 소진 시 불필요한 호출 방지
            ));
        }
        // [C] 해양종합정보 '태풍' 버튼 — 특보현황 2단계(태풍 푸시) 후 무장되면,
        //     클릭 시 1회 한정으로 장미·통보문 06-16 + 디버그 자동 표출. (무장 안 됐으면 무동작)
        var tphnBtn = document.getElementById('ocean-typhoon-toggle-btn');
        if (tphnBtn) {
            tphnBtn.addEventListener('click', function () {
                if (!_typhoonDemoArmed) return;
                _typhoonDemoArmed = false;             // 1회성
                setTimeout(_runTyphoonDemo, 350);      // 기존 토글/잠금해제 처리 후 실행
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }
})();
