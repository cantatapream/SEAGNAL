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
        var pre = isUpcoming || level === '예비';
        return {
            zoneName: src.zoneName || slot.zoneName || '',
            regId: src.zoneName || slot.zoneName || '',
            warnType: src.warnType || slot.warnType || '풍랑',
            level: pre && level === '예비' ? '예비' : level,
            tmFc: _normalizeKmaTime(src.tmFc),
            tmEf: _normalizeKmaTime(src.tmEf),
            tmCc: _normalizeKmaTime(src.tmEd) || '',
            tmEd: _normalizeKmaTime(src.tmEd) || '',
            command: pre ? '발표' : (src.command || '발효'),
            isPreliminary: pre,
            isCoastal: false,
            source: 'DEMO',
            prevLevel: null,
            history: [],
            _isDemo: true,
            _demoId: slot.id
        };
    }

    /**
     * 현재 활성 데모 목록을 appState.alerts 에 머지.
     * 1) 기존 _isDemo 항목 모두 제거 (중복/잔존 방지)
     * 2) active 목록을 alert item 으로 변환해 append (병기 시 upcoming 도 별도 추가)
     * 3) seagnal:alerts-changed 발화 → 지도 색칠 갱신
     * 4) renderApp() 재호출 → 인덱스 카드 갱신
     */
    function _applyToAppState(active) {
        if (typeof appState === 'undefined' || !appState) return;
        if (!Array.isArray(appState.alerts)) appState.alerts = [];

        // 기존 데모 항목 제거
        appState.alerts = appState.alerts.filter(function (a) { return !a._isDemo; });

        // 활성 데모 추가
        (active || []).forEach(function (slot) {
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

    /** appState.alerts 에 데모 항목이 하나라도 남아있는지 */
    function _appStateHasDemo() {
        return !!(typeof appState !== 'undefined' && appState && Array.isArray(appState.alerts)
            && appState.alerts.some(function (a) { return a._isDemo; }));
    }

    /** 서버에서 현재 활성 데모 목록을 가져와 변경 시(또는 정식 새로고침으로 유실 시) 반영 */
    function _poll() {
        if (!_isAdminDevice) return;
        fetch('/api/admin/demo/active', { cache: 'no-cache' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                if (!data) return;
                var active = data.active || [];
                var json = JSON.stringify(active);
                var changed = json !== _lastActiveJson;
                // 변경됐거나, 활성 데모가 있는데 화면(appState)에서 유실됐으면 재반영
                //   (header 새로고침 등 정식 데이터 재적재가 _isDemo 항목을 지운 경우 복구)
                var lost = active.length > 0 && !_appStateHasDemo();
                if (!changed && !lost) return;
                _lastActiveJson = json;
                _applyToAppState(active);
            })
            .catch(function () { /* 폴링 실패 무시 */ });
    }

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
                        _lastActiveJson = JSON.stringify(active);
                        if (active.length) _applyToAppState(active);
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
