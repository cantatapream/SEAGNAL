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

    // 낡음(stale) 가드 임계값 — 튜닝 가능. 저장 위치가 이보다 오래되면 "낡음"으로 본다.
    //   killed 상태에서 정지+JS 타이머 부재로 위치가 갱신되지 못할 때 잘못된 구역 알림을 막는다.
    const STALE_MAX_MS = 12 * 60 * 60 * 1000;    // 12시간 (tunable)

    // 주기 갱신 타이머 키 — 앱이 살아있는 동안 정지 상태에서도 위치를 시간 기반으로 갱신.
    const REFRESH_TIMER_KEY = '_locationAlertRefreshTimer';
    const REFRESH_INTERVAL_MS = 15 * 60 * 1000;  // ~15분

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
                src: 'gps',   // 진짜 백그라운드 GPS 고정값 표시(데모 위치와 구분). POS_KEY 오염 방지.
            };
            const json = JSON.stringify(rec);
            root.localStorage.setItem(POS_KEY, json);
            prefsSet(POS_KEY, json);   // 네이티브(killed)에서 읽을 수 있도록 미러
        } catch (_) { }
    }

    function getPosition() {
        try { return JSON.parse(root.localStorage.getItem(POS_KEY)); } catch (_) { return null; }
    }

    /**
     * 순수 헬퍼 — 저장 레코드가 "낡음"인지 판정.
     * rec.at 이 유한한 시각으로 파싱되고 (nowMs - 파싱값) > maxMs 일 때만 true.
     * at 누락/파싱불가 → false(낡지 않음으로 취급 — 유효 알림을 과도 억제하지 않기 위함).
     */
    function isStale(rec, nowMs, maxMs) {
        try {
            if (!rec || !rec.at) return false;
            const t = Date.parse(rec.at);
            if (!Number.isFinite(t)) return false;
            return (nowMs - t) > maxMs;
        } catch (_) { return false; }
    }

    function clearPosition() {
        try { root.localStorage.removeItem(POS_KEY); } catch (_) { }
        prefsRemove(POS_KEY);          // 미러도 즉시 삭제(해제 시 단말 위치 제거)
    }

    /** @capacitor/geolocation 의 현재 위치 1회 획득(저전력). 실패/부재 시 null. */
    async function getCurrentPositionOnce() {
        try {
            const G = root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.Geolocation;
            if (!G || !G.getCurrentPosition) return null;
            const p = await G.getCurrentPosition({ enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
            return (p && p.coords) ? p.coords : null;
        } catch (_) { return null; }
    }

    /**
     * 주기 갱신 타이머 시작(~15분). 매 틱마다 CURRENT 위치를 읽어 savePosition.
     *   - distanceFilter(거리 필터)로는 갱신되지 않는 "정지 상태"도 시간 기반으로 갱신한다.
     *   - 제약: JS 타이머는 앱이 살아있을 때만 동작한다. 앱이 완전 종료(killed)되고 단말이
     *     정지해 있으면 이 타이머는 돌지 못하므로, 그 경우엔 (a) 이동 시 watcher 갱신 +
     *     (b) 낡음 가드(STALE_MAX_MS, isStale) 에 의존한다.
     */
    function startRefreshTimer() {
        try {
            if (root[REFRESH_TIMER_KEY]) return;   // 이미 동작 중(idempotent)
            root[REFRESH_TIMER_KEY] = setInterval(async function () {
                try {
                    const coords = await getCurrentPositionOnce();
                    if (coords && Number.isFinite(coords.latitude) && Number.isFinite(coords.longitude)) {
                        savePosition({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy });
                    }
                } catch (_) { /* 실패 틱은 무시 */ }
            }, REFRESH_INTERVAL_MS);
        } catch (_) { /* setInterval 부재 등 — no-op */ }
    }

    function stopRefreshTimer() {
        try { if (root[REFRESH_TIMER_KEY]) clearInterval(root[REFRESH_TIMER_KEY]); } catch (_) { }
        root[REFRESH_TIMER_KEY] = null;
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
            startRefreshTimer();   // 정지 상태도 시간 기반(~15분)으로 갱신
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
        stopRefreshTimer();   // 주기 갱신 타이머 정리
        clearPosition(); // 해제 시 단말 저장 위치 즉시 삭제(설계 §10-7)
        console.log('[LocationAlertBG] stopped + position cleared');
        return true;
    }

    function isRunning() { return !!root[WATCHER_KEY]; }

    /** 활성+동의 여부 — LocationAlertSettings 우선, 없으면 persisted 플래그(둘 다 'true'). 방어적. */
    function isFeatureEnabled() {
        try {
            if (root.LocationAlertSettings && root.LocationAlertSettings.get) {
                return root.LocationAlertSettings.get().enabled === true;
            }
        } catch (_) { }
        try {
            const active = root.localStorage.getItem('location_alert_active');
            const consent = root.localStorage.getItem('location_alert_consent');
            return active === 'true' && consent === 'true';
        } catch (_) { }
        return false;
    }

    /**
     * 앱 실행 시 자동 재가동 — 네이티브 + 플러그인 + 기능 활성일 때 start() 호출(idempotent).
     *   Android 배터리 최적화 등으로 전경 위치 서비스가 죽었을 때, 사용자가 다시 토글하지 않아도
     *   앱을 켤 때 watcher 가 되살아나 위치가 며칠씩 낡는 것을 막는다. 절대 throw 하지 않음.
     */
    function ensureStarted() {
        try {
            if (!isNative() || !plugin()) return false;
            if (!isFeatureEnabled()) return false;
            // start() 는 root[WATCHER_KEY] 가 있으면 early-return 하므로 idempotent.
            start();
            return true;
        } catch (_) { return false; }
    }

    const api = { start, stop, ensureStarted, isRunning, getPosition, savePosition, clearPosition, isStale, STALE_MAX_MS, POS_KEY, Mirror };
    if (root) root.LocationAlertBackground = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
