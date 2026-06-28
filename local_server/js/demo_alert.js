/**
 * ============================================================================
 * 파일명: js/demo_alert.js
 * 역할: [데모 시연] 관리자 기기 한정 — 데모 특보를 화면(인덱스 카드 + 지도)에 표출
 * ============================================================================
 *
 * [동작 개요]
 * 시연 자리에서 실제 특보가 없을 때, 관리자 센터에서 미리 저장해 둔 데모 특보를
 * "표출" 버튼으로 발동시키면 서버 demo_active.json 에 누적된다. 이 모듈은
 * **관리자로 등록된 기기에서만** 그 목록을 폴링해서 appState.alerts 에 머지하고,
 * 기존 렌더 파이프라인(renderApp + 지도 색칠)을 그대로 재사용해 표출한다.
 *
 * [안전 설계]
 * - 일반 사용자 기기에서는 device-status 가 false → 아무 것도 하지 않음 (완전 무동작).
 * - 실 장부 weather_alerts.json / 일반 시작 경로(/api/weather-alerts)는 건드리지 않음.
 * - 데모 특보는 appState.alerts 에 _isDemo:true 로 append 만 하므로, 다음 정식
 *   refreshAlertData() 호출(실 데이터 재적재) 후에도 _reapply 로 다시 얹어준다.
 *
 * [연계]
 * - 서버: GET /api/admin/demo/active (관리자 토큰 필요)
 * - 표출 트리거: js/admin_demo.js 의 [표출] 버튼 → /api/admin/demo/emit
 * - index2.html 에서 admin.js 이후 로드 (getStoredAdminToken 사용 가능)
 * ============================================================================
 */
(function () {
    'use strict';

    var POLL_INTERVAL_MS = 5000;   // 데모 활성 목록 폴링 주기
    var _pollTimer = null;
    var _isAdminDevice = false;    // 이 기기가 관리자 등록 기기인지 (device-status 결과)
    var _lastActiveJson = '';      // 직전 활성 목록 JSON (변경 감지용)
    var _testMode = false;         // 테스트 모드 ON 여부 (서버 상태 미러)
    var _lastTestMode = null;      // 직전 테스트 모드 상태 (전환 감지용)

    /** 이 기기의 FCM 푸시 토큰 (admin.js 와 동일 키) */
    function _getPushToken() {
        try { return localStorage.getItem('push_token') || ''; } catch (e) { return ''; }
    }

    /** 관리자 모드 여부 (UI 가드) */
    function _isAdminMode() {
        try { return localStorage.getItem('seagnal_admin_mode') === 'true'; } catch (e) { return false; }
    }

    /**
     * "2026년 05월 29일 14시 30분" 또는 datetime-local → flatten 가 기대하는
     * 기상청 형식("YYYY년 MM월 DD일 HH시 mm분")으로 정규화.
     */
    function _normalizeKmaTime(s) {
        if (!s) return '';
        var str = String(s).trim();
        // 이미 기상청 형식
        if (/\d{4}년/.test(str)) return str;
        // datetime-local
        var m = str.match(/(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
        if (m) return m[1] + '년 ' + m[2] + '월 ' + m[3] + '일 ' + m[4] + '시 ' + m[5] + '분';
        return str;
    }

    /**
     * 데모 슬롯 1건 → appState.alerts 항목 형식으로 변환.
     * data.js 의 processSingleAlert 가 만드는 구조와 동일한 필드를 채운다.
     * (warnType, level, tmFc/tmEf/tmEd, command, isPreliminary, isCoastal, history)
     */
    function _slotToAlertItem(slot, isUpcoming) {
        var src = isUpcoming ? slot.upcoming : slot;
        var level = src.level || '주의보';
        var cmd = isUpcoming ? '발표' : (slot.command || '발효');
        // 발표 단계(또는 다가오는 특보) → 예비(발효 전)로 표시 / 발효·격상·격하 → 발효중
        var pre = isUpcoming || cmd === '발표' || level === '예비';
        // 격상/격하는 화면상 '변경' command + 이전 등급 표기
        var displayCmd = pre ? '발표' : ((cmd === '격상' || cmd === '격하') ? '변경' : '발효');
        var prevLvl = null;
        if (!pre && (cmd === '격상' || cmd === '격하')) {
            prevLvl = slot.prevLevel || (cmd === '격상' ? '주의보' : '경보');
        }
        return {
            zoneName: src.zoneName || slot.zoneName || '',
            regId: src.zoneName || slot.zoneName || '',
            warnType: src.warnType || slot.warnType || '풍랑',
            level: pre && level === '예비' ? '예비' : level,
            tmFc: _normalizeKmaTime(src.tmFc),
            tmEf: _normalizeKmaTime(src.tmEf),
            tmCc: _normalizeKmaTime(src.tmEd) || '',
            tmEd: _normalizeKmaTime(src.tmEd) || '',
            command: displayCmd,
            isPreliminary: pre,
            isCoastal: false,
            source: 'DEMO',
            prevLevel: prevLvl,
            history: [],
            _isDemo: true,
            _demoId: slot.id
        };
    }

    /**
     * 현재 활성 데모 목록을 appState.alerts 에 머지.
     * [테스트 모드 ON] 실제 특보(비-데모)를 모두 숨겨 "빈 화면" 으로 만든 뒤 데모만 표출.
     *   - appState.alerts: 비-데모 항목 제거 (지도+인덱스 동시 비움)
     *   - appState.coastalAlerts: 통째로 비움 (연안/평수구역 카드 제거)
     *   원본은 _savedReal* 에 백업했다가 OFF 시 복원.
     * [테스트 모드 OFF] 데모 항목만 제거하고 실제 특보는 그대로 둠.
     * 1) (ON) 실제 특보 백업+제거 / (OFF) 데모만 제거
     * 2) active 목록을 alert item 으로 변환해 append (병기 시 upcoming 도 별도 추가)
     * 3) seagnal:alerts-changed 발화 → 지도 색칠 갱신
     * 4) renderApp() 재호출 → 인덱스 카드 갱신
     */
    function _applyToAppState(active) {
        if (typeof appState === 'undefined' || !appState) return;
        if (!Array.isArray(appState.alerts)) appState.alerts = [];

        if (_testMode) {
            // 테스트 모드: 실제 특보를 모두 숨김 → 데모만 남김 (아래에서 재추가)
            appState.alerts = [];
            appState.coastalAlerts = {};
        } else {
            // 일반: 기존 데모 항목만 제거 (실제 특보는 유지)
            appState.alerts = appState.alerts.filter(function (a) { return !a._isDemo; });
        }

        // 활성 데모 추가
        (active || []).forEach(function (slot) {
            // '해제' 단계는 특보 종료 → 화면에 카드/폴리곤 표시하지 않음 (푸시만 발송됨)
            if (slot.command === '해제') return;
            appState.alerts.push(_slotToAlertItem(slot, false));
            if (slot.upcoming && slot.upcoming.enabled) {
                appState.alerts.push(_slotToAlertItem(slot, true));
            }
        });

        // 지도 색칠 갱신 트리거
        try { window.dispatchEvent(new CustomEvent('seagnal:alerts-changed')); } catch (e) { }
        // 인덱스 카드 갱신
        if (typeof renderApp === 'function') {
            try { renderApp(); } catch (e) { console.error('[Demo] renderApp 실패:', e); }
        }
    }

    /**
     * 테스트 모드 OFF 로 전환 시: 실제 특보를 서버에서 다시 받아 화면 원복.
     * (데모 항목 제거 + 실 특보 재적재)
     */
    function _restoreRealAlerts() {
        if (typeof refreshAlertData === 'function') {
            // refreshAlertData 가 /api/weather-alerts 를 다시 받아 appState 를 실 데이터로 덮음
            refreshAlertData().then(function () {
                try { window.dispatchEvent(new CustomEvent('seagnal:alerts-changed')); } catch (e) { }
                if (typeof renderApp === 'function') { try { renderApp(); } catch (e) { } }
            }).catch(function () { });
        } else if (typeof appState !== 'undefined' && appState) {
            // fallback: 데모만 제거
            if (Array.isArray(appState.alerts)) appState.alerts = appState.alerts.filter(function (a) { return !a._isDemo; });
            try { window.dispatchEvent(new CustomEvent('seagnal:alerts-changed')); } catch (e) { }
            if (typeof renderApp === 'function') { try { renderApp(); } catch (e) { } }
        }
    }

    /** appState.alerts 에 데모 항목이 하나라도 남아있는지 */
    function _appStateHasDemo() {
        return !!(typeof appState !== 'undefined' && appState && Array.isArray(appState.alerts)
            && appState.alerts.some(function (a) { return a._isDemo; }));
    }

    /** 서버에서 현재 활성 데모 목록 + 테스트모드를 가져와 변경 시(또는 유실 시) 반영 */
    function _poll() {
        if (!_isAdminDevice) return;
        fetch('/api/admin/demo/active', { cache: 'no-cache' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                if (!data) return;
                var active = data.active || [];
                var testMode = !!data.testMode;
                var json = JSON.stringify(active);
                var activeChanged = json !== _lastActiveJson;
                var modeChanged = testMode !== _lastTestMode;

                _testMode = testMode;

                // 테스트 모드 OFF 로 전환됨 → 실 특보 화면 원복
                if (modeChanged && !testMode) {
                    _lastTestMode = testMode;
                    _lastActiveJson = json;
                    _restoreRealAlerts();
                    return;
                }

                // 활성 데모가 있는데 화면(appState)에서 유실됐으면 재반영
                //   (header 새로고침 등 정식 데이터 재적재가 _isDemo 항목을 지운 경우 복구)
                var lost = active.length > 0 && !_appStateHasDemo();
                // 테스트 모드 ON 인데 실 특보가 화면에 남아있으면(정식 새로고침으로 복귀) 다시 비워야 함
                var realLeaked = testMode && _appStateHasReal();

                if (!activeChanged && !modeChanged && !lost && !realLeaked) return;
                _lastTestMode = testMode;
                _lastActiveJson = json;
                _applyToAppState(active);
            })
            .catch(function () { /* 폴링 실패 무시 */ });
    }

    /** appState.alerts 에 실제(비-데모) 특보가 남아있는지 */
    function _appStateHasReal() {
        return !!(typeof appState !== 'undefined' && appState && Array.isArray(appState.alerts)
            && appState.alerts.some(function (a) { return !a._isDemo; }));
    }

    // [시연 연계] 특보 시연 "테스트 모드" ON 여부를 외부 모듈(tide_field.js 등)에 노출.
    //   _testMode 는 관리자 등록 기기에서만 서버 폴링으로 갱신되므로, 비관리자 기기에서는
    //   항상 false 를 반환한다(앵커 포인트 자동 표출이 일반 사용자에게 새지 않음).
    window.__seagnalDemoTestModeOn = function () { return _testMode === true; };

    /**
     * 정식 데이터 재적재(refreshAlertData / fetchAllData) 직후 데모 항목이
     * 사라지므로, 활성 데모가 있으면 다시 얹어준다.
     */
    window.reapplyDemoAlerts = function () {
        if (!_isAdminDevice || !_lastActiveJson) return;
        try {
            var active = JSON.parse(_lastActiveJson);
            if (active && active.length) _applyToAppState(active);
        } catch (e) { }
    };

    /** 관리자 기기 여부 확인 후 폴링 시작 */
    function _init() {
        if (!_isAdminMode()) return;          // 관리자 모드 아니면 종료
        var token = _getPushToken();
        if (!token) return;                    // 푸시 토큰 없으면 관리자 기기 판정 불가

        fetch('/api/admin/demo/active', { cache: 'no-cache' })
            .then(function (r) {
                // 200 이면 관리자 토큰 인증 통과 → 관리자 기기로 간주
                // (이 엔드포인트는 requireAdminToken 게이트 뒤에 있음)
                if (!r.ok) throw new Error('not admin');
                return r.json();
            })
            .then(function (data) {
                // device-status 로 "등록된 관리자 기기"인지 한 번 더 확인
                return fetch('/api/admin/device-status?token=' + encodeURIComponent(token))
                    .then(function (rr) { return rr.ok ? rr.json() : { registered: false }; })
                    .then(function (st) {
                        _isAdminDevice = !!(st && st.registered);
                        if (!_isAdminDevice) {
                            console.log('[Demo] 이 기기는 관리자 등록 기기가 아님 — 데모 표출 비활성');
                            return;
                        }
                        console.log('[Demo] 관리자 등록 기기 — 데모 표출 폴링 시작');
                        // 첫 반영
                        var active = (data && data.active) || [];
                        _testMode = !!(data && data.testMode);
                        _lastTestMode = _testMode;
                        _lastActiveJson = JSON.stringify(active);
                        if (_testMode || active.length) _applyToAppState(active);
                        // 주기 폴링
                        if (_pollTimer) clearInterval(_pollTimer);
                        _pollTimer = setInterval(_poll, POLL_INTERVAL_MS);
                    });
            })
            .catch(function () { /* 비관리자 또는 인증 실패 — 무동작 */ });
    }

    // 앱 로드 후 시작 (admin.js 의 fetch 래퍼가 X-Admin-Token 을 자동 첨부하므로
    //   admin.js 이후 로드 + 약간의 지연으로 토큰 준비 보장)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(_init, 1500); });
    } else {
        setTimeout(_init, 1500);
    }
})();
