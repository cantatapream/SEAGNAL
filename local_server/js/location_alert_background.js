/**
 * ============================================================================
 * location_alert_background.js — 위치기반 특보: 백그라운드 위치 수집 (② 단계)
 * ============================================================================
 * 설계 문서: 00_docs/LOCATION_BASED_ALERT_DESIGN.md (§9)
 *
 * 검증된 플러그인 @capacitor-community/background-geolocation 사용.
 *  - 전경 서비스(상시 알림 "해상안전을 위해 위치 확인 중")로 앱 종료 상태에서도 동작.
 *  - 위치 업데이트마다 **단말 localStorage에 최신 1건만 갱신**(누적·서버전송 없음).
 *  - start()/stop() 은 동의/활성 UI(③)의 hook(window.LocationAlertBackground)이 호출.
 *
 * ⚠️ 네이티브 전용. 실기기에서 npm install + npx cap sync 후 동작.
 *    웹/플러그인 부재 시 안전하게 no-op.
 * ============================================================================
 */
(function (root) {
    'use strict';

    const POS_KEY = 'location_alert_last_pos';   // {lat,lng,acc,at}
    const WATCHER_KEY = '_locationAlertWatcherId';

    // ── @capacitor/preferences 미러 (네이티브 killed 대응) ────────────────────
    //   기존 localStorage 경로는 그대로 두되(앱 켜짐/백그라운드 JS 가 사용), 같은 값을
    //   @capacitor/preferences(= Android SharedPreferences "CapacitorStorage") 에도 저장한다.
    //   네이티브 FCM 서비스(LocationAlertStore)가 이 SharedPreferences 를 읽어 종료 상태에서도
    //   위치 판정/알림을 수행한다. (위치는 단말 밖으로 절대 나가지 않음 — on-device 미러일 뿐)
    function prefsPlugin() {
        try { return root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.Preferences; }
        catch (_) { return null; }
    }
    /** Preferences 에 set (fire-and-forget, 실패 무시). 네이티브가 동기 읽기로 사용. */
    function prefsSet(key, value) {
        try {
            const P = prefsPlugin();
            if (P && P.set) P.set({ key, value: String(value) }).catch(() => { });
        } catch (_) { }
    }
    function prefsRemove(key) {
        try {
            const P = prefsPlugin();
            if (P && P.remove) P.remove({ key }).catch(() => { });
        } catch (_) { }
    }
    // 다른 모듈(location_alert_ui.js)이 동일 경로로 플래그를 쓰도록 노출.
    const Mirror = { set: prefsSet, remove: prefsRemove, POS_KEY };

    function plugin() {
        try { return root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.BackgroundGeolocation; }
        catch (_) { return null; }
    }
    function isNative() {
        try { return !!(root.Capacitor && root.Capacitor.isNativePlatform && root.Capacitor.isNativePlatform()); }
        catch (_) { return false; }
    }

    /** 최신 위치 1건 저장(갱신). 서버로 보내지 않음. */
    function savePosition(loc) {
        try {
            const rec = {
                lat: loc.latitude, lng: loc.longitude,
                acc: (typeof loc.accuracy === 'number' ? loc.accuracy : null),
                at: new Date().toISOString(),
            };
            const json = JSON.stringify(rec);
            root.localStorage.setItem(POS_KEY, json);
            prefsSet(POS_KEY, json);   // 네이티브(killed)에서 읽을 수 있도록 미러
        } catch (_) { }
    }

    function getPosition() {
        try { return JSON.parse(root.localStorage.getItem(POS_KEY)); } catch (_) { return null; }
    }

    function clearPosition() {
        try { root.localStorage.removeItem(POS_KEY); } catch (_) { }
        prefsRemove(POS_KEY);          // 미러도 즉시 삭제(해제 시 단말 위치 제거)
    }

    async function start() {
        const BG = plugin();
        if (!isNative() || !BG) { console.log('[LocationAlertBG] 네이티브/플러그인 없음 → skip'); return false; }
        if (root[WATCHER_KEY]) return true; // 이미 동작 중
        try {
            const id = await BG.addWatcher(
                {
                    // 안드로이드 상시 알림(전경 서비스) — 최소 문구
                    backgroundMessage: '해상안전을 위해 위치 확인 중',
                    backgroundTitle: 'SEA:GNAL',
                    requestPermissions: true,
                    stale: false,
                    // 약 15분 주기 취지: 잦은 갱신 방지(거리 필터). 시간 throttle은 콜백에서 보강.
                    distanceFilter: 200,
                },
                function (location, error) {
                    if (error) { console.warn('[LocationAlertBG] watcher error:', error); return; }
                    if (!location) return;
                    // 15분 throttle: 직전 저장 후 15분 미만이면 무시(배터리 절약)
                    const prev = getPosition();
                    if (prev && prev.at && (Date.now() - Date.parse(prev.at)) < 15 * 60 * 1000) return;
                    savePosition(location);
                }
            );
            root[WATCHER_KEY] = id;
            console.log('[LocationAlertBG] started, watcher:', id);
            return true;
        } catch (e) {
            console.error('[LocationAlertBG] start 실패:', e && e.message);
            return false;
        }
    }

    async function stop() {
        const BG = plugin();
        try {
            if (BG && root[WATCHER_KEY]) await BG.removeWatcher({ id: root[WATCHER_KEY] });
        } catch (e) { console.warn('[LocationAlertBG] stop 경고:', e && e.message); }
        root[WATCHER_KEY] = null;
        clearPosition(); // 해제 시 단말 저장 위치 즉시 삭제(설계 §10-7)
        console.log('[LocationAlertBG] stopped + position cleared');
        return true;
    }

    function isRunning() { return !!root[WATCHER_KEY]; }

    const api = { start, stop, isRunning, getPosition, savePosition, clearPosition, POS_KEY, Mirror };
    if (root) root.LocationAlertBackground = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
