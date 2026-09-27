/**
 * ============================================================================
 * location_alert_background.js — 위치기반 특보: 이벤트 기반 위치 수집 (② 단계)
 * 역할  : 위치기반 특보: 이벤트 기반 위치 수집 (② 단계)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : @capacitor/geolocation, @capacitor/preferences 플러그인
 *                    (프로젝트 JS 의존 없음)
 *  - 서버 API      : 없음 (수집한 위치는 서버로 전송하지 않음 — on-device)
 *  - 마크업        : 없음
 *  - 나를 쓰는 곳  : capacitor-plugins.js(앱 실행 hook), location_alert_ui.js,
 *                    location_alert_runtime.js, location_alert_typhoon_runtime.js,
 *                    admin_location_status.js, scripts 테스트
 * ============================================================================
 * 설계 문서: location_alert.design.md (같은 폴더) (§9)
 *
 * [이벤트 기반 전환] 상시 GPS 수집(@capacitor-community/background-geolocation 전경
 *   서비스 + 상시 알림 "해상안전을 위해 위치 확인 중" + 15분 타이머)을 제거하고,
 *   특보 발표·변경(=깨우는 신호) 시점에 **그 순간 위치를 1회(fresh-fix)** 수집해 판정한다.
 *  - getFreshPosition(): @capacitor/geolocation 의 현재 위치 1회 획득(저전력) → 성공 시
 *    최신 1건으로 저장(POS_KEY) 후 반환. 실패/부재 시 마지막 저장 위치(getPosition)로 폴백.
 *  - 위치는 **단말 localStorage(+Preferences 미러)에 최신 1건만** 갱신(누적·서버전송 없음).
 *  - start()/stop()/ensureStarted() 은 동의/활성 UI(③)와 앱 실행 hook(capacitor-plugins.js)이 호출.
 *      · start()      → 즉시 fresh-fix 1회(상시 watcher/전경 서비스 없음).
 *      · stop()       → 저장 위치 삭제(해제 시 단말 위치 제거).
 *      · ensureStarted() → 활성 단말 한정, 앱 실행 시 fresh-fix 1회.
 *
 * ⚠️ 네이티브 전용. 실기기에서 @capacitor/geolocation + @capacitor/preferences 동작.
 *    웹/플러그인 부재 시 안전하게 no-op(폴백).
 * ============================================================================
 */
(function (root) {
    'use strict';

    const POS_KEY = 'location_alert_last_pos';   // {lat,lng,acc,at,src}

    // 낡음(stale) 가드 임계값 — 튜닝 가능. 저장 위치가 이보다 오래되면 "낡음"으로 본다.
    //   이벤트 기반 fresh-fix 가 실패해 마지막 저장 위치로 폴백할 때, 위치가 너무 낡으면
    //   잘못된 구역 알림을 막는 안전망으로 (네이티브/runtime 에서) 사용한다.
    const STALE_MAX_MS = 12 * 60 * 60 * 1000;    // 12시간 (tunable)

    // ── @capacitor/preferences 미러 (네이티브 killed 대응) ────────────────────
    //   기존 localStorage 경로는 그대로 두되(앱 켜짐/JS 가 사용), 같은 값을
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
        } catch (_) { /* Preferences 플러그인이 없는 환경(그냥 웹)이면 던진다 — 미러 저장만 빠지고 localStorage 값은 그대로다 */ }
    }
    function prefsRemove(key) {
        try {
            const P = prefsPlugin();
            if (P && P.remove) P.remove({ key }).catch(() => { });
        } catch (_) { /* 같은 까닭 — 플러그인이 없으면 지울 미러도 없다 */ }
    }
    // 다른 모듈(location_alert_ui.js)이 동일 경로로 플래그를 쓰도록 노출.
    const Mirror = { set: prefsSet, remove: prefsRemove, POS_KEY };

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
                src: 'gps',   // 진짜 GPS 고정값 표시(데모 위치와 구분). POS_KEY 오염 방지.
            };
            const json = JSON.stringify(rec);
            root.localStorage.setItem(POS_KEY, json);
            prefsSet(POS_KEY, json);   // 네이티브(killed)에서 읽을 수 있도록 미러
        } catch (_) { /* localStorage 가 막힌 환경(사생활 모드·저장 한도)이면 던진다 — 다음 위치 갱신 때 다시 쓴다 */ }
    }

    function getPosition() {
        try { return JSON.parse(root.localStorage.getItem(POS_KEY)); } catch (_) { return null; }
    }

    /** Preferences 에서 POS_KEY 를 1회 읽는다(네이티브 killed wake 가 쓴 최신 위치). 실패/부재 시 null. */
    async function prefsGet(key) {
        try {
            const P = prefsPlugin();
            if (P && P.get) {
                const r = await P.get({ key });
                if (r && r.value != null) return r.value;
            }
        } catch (_) { /* 플러그인이 없거나 아직 준비 전이면 던진다 — null 을 주면 부르는 쪽이 localStorage 로 떨어진다 */ }
        return null;
    }

    /**
     * 앱 실행 시 저장소 desync 해소 — 네이티브(killed) wake 는 위치를 Preferences 에만 쓰므로
     *   localStorage 는 낡을 수 있다. Preferences 값이 localStorage 보다 최신(at 비교)이면
     *   그 값을 localStorage 로 채워(adopt) JS 폴백·진단이 같은 위치를 보게 한다.
     *   at 이 없을 때: localStorage 가 아예 없으면 Preferences 값을 채운다(정보량 증가).
     *   절대 throw 하지 않음(방어적). 네이티브가 아니거나 플러그인 부재 시 no-op.
     * @returns {Promise<boolean>} localStorage 를 갱신했으면 true.
     */
    async function syncPositionFromPrefs() {
        try {
            if (!isNative()) return false;
            const prefRaw = await prefsGet(POS_KEY);
            if (!prefRaw) return false;
            let pref = null;
            try { pref = JSON.parse(prefRaw); } catch (_) { return false; }
            if (!pref || pref.lat == null || pref.lng == null) return false;
            let ls = null;
            try { ls = JSON.parse(root.localStorage.getItem(POS_KEY)); } catch (_) { ls = null; }
            let adopt = false;
            if (!ls) {
                adopt = true;                      // localStorage 부재 → Preferences 값 채택
            } else {
                const tp = pref.at ? Date.parse(pref.at) : NaN;
                const tl = ls.at ? Date.parse(ls.at) : NaN;
                if (Number.isFinite(tp) && Number.isFinite(tl)) adopt = tp > tl;   // Preferences 가 더 최신
                else if (Number.isFinite(tp) && !Number.isFinite(tl)) adopt = true; // Preferences 만 시각 보유
            }
            if (adopt) {
                try { root.localStorage.setItem(POS_KEY, prefRaw); } catch (_) { /* 사생활 모드·저장 한도면 던진다 — 저장이 안 돼도 화면은 그대로 돈다 */ }
                return true;
            }
        } catch (_) { /* 저장된 값이 깨져 파싱·비교에서 던지면 **채택하지 않는다**(아래 false) — 기존 위치를 그대로 둔다 */ }
        return false;
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
        try { root.localStorage.removeItem(POS_KEY); } catch (_) { /* 사생활 모드·저장 한도면 던진다 — 저장이 안 돼도 화면은 그대로 돈다 */ }
        prefsRemove(POS_KEY);          // 미러도 즉시 삭제(해제 시 단말 위치 제거)
    }

    /** @capacitor/geolocation 의 현재 위치 1회 획득(저전력). 실패/부재 시 null. */
    async function getCurrentPositionOnce() {
        try {
            const G = root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.Geolocation;
            if (!G || !G.getCurrentPosition) return null;
            const p = await G.getCurrentPosition({ enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 });
            return (p && p.coords) ? p.coords : null;
        } catch (e) {
            // ★조용히 넘어가지 않는다 (3-44). 지금 위치를 못 받으면 **마지막 저장 위치로 판단한다** —
            //   배가 이미 다른 해역에 있어도 옛 해역 기준으로 알림이 가거나 안 간다.
            console.warn('[LocationAlertBG] 현재 위치 획득 실패 — 마지막 저장 위치로 판단한다:', e && e.message);
            return null;
        }
    }

    /**
     * 이벤트 기반 fresh-fix — 깨우는 신호(특보 발표·변경) 시점에 그 순간 위치를 1회 수집.
     *   1) 전경 fix 시도(@capacitor/geolocation getCurrentPosition). 성공 시 savePosition 으로
     *      최신 1건 저장(src:'gps') 후, 저장된 레코드를 다시 읽어 {lat,lng,acc,at,src} 반환.
     *   2) 실패/부재 시 마지막 저장 위치(getPosition)로 폴백(없으면 null).
     *   완전 방어적(try/catch). 위치는 단말 밖으로 나가지 않음.
     * @returns {Promise<{lat,lng,acc,at,src}|null>}
     */
    async function getFreshPosition() {
        try {
            const coords = await getCurrentPositionOnce();
            if (coords && Number.isFinite(coords.latitude) && Number.isFinite(coords.longitude)) {
                // 최신 1건으로 저장(src:'gps') — 다음 폴백/진단(POS_KEY)도 이 값으로 갱신.
                savePosition({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy });
                const saved = getPosition();
                if (saved) return saved;
                // getPosition 폴백 실패(스토리지 부재 등) 시 직접 구성해 반환.
                return {
                    lat: coords.latitude, lng: coords.longitude,
                    acc: (typeof coords.accuracy === 'number' ? coords.accuracy : null),
                    at: new Date().toISOString(), src: 'gps',
                };
            }
        } catch (e) {
            // ★조용히 넘어가지 않는다 (3-44). 새 위치를 못 잡으면 **저장 위치로 내려간다** —
            //   「위치가 안 변했다」와 「위치를 못 받았다」가 겉으로 똑같았다.
            console.warn('[LocationAlertBG] 새 위치 획득 실패 — 저장 위치로 폴백한다:', e && e.message);
        }
        // 폴백: 마지막 저장 위치(may be null).
        try { return getPosition(); } catch (_) { return null; }
    }

    /**
     * 활성 시작/앱 실행 hook — 상시 watcher/전경 서비스 없이 fresh-fix 1회 수행.
     *   토글 ON(③) 또는 앱 실행(ensureStarted) 시 호출되어 즉시 위치를 갱신·저장한다.
     *   절대 throw 하지 않음(방어적). 네이티브가 아니면 no-op.
     */
    async function start() {
        try {
            if (!isNative()) { console.log('[LocationAlertBG] 네이티브 아님 → skip'); return false; }
            // 앱 실행 시 저장소 desync 해소 — 네이티브 wake 가 Preferences 에만 쓴 최신 위치를
            //   localStorage 로 채운다(이후 fresh-fix 성공 시 최신값으로 다시 덮어씀). 방어적.
            try { await syncPositionFromPrefs(); } catch (_) { /* 미러 동기화가 실패해도 시작을 막지 않는다 — 바로 뒤 getFreshPosition 이 최신 위치로 덮는다 */ }
            await getFreshPosition();   // 즉시 1회 위치 갱신(상시 수집 없음)
            console.log('[LocationAlertBG] event-driven fresh-fix done');
            return true;
        } catch (e) {
            // ★조용히 넘어가지 않는다 (3-44). 여기서 죽으면 **배경 위치 알림이 통째로 안 켜진다** —
            //   「알릴 것이 없었다」와 구분이 안 된다.
            console.warn('[LocationAlertBG] 시작 실패 — 배경 위치 알림이 안 켜진다:', e && e.message);
            return false;
        }
    }

    /** 해제 시 단말 저장 위치 즉시 삭제(설계 §10-7). 상시 watcher 가 없어 제거할 대상 없음. */
    async function stop() {
        try {
            clearPosition();
            console.log('[LocationAlertBG] position cleared');
        } catch (_) { /* 저장소가 막혀 지우기가 던져도 해제는 성공으로 친다 — 지울 수 있는 것은 이미 지웠다 */ }
        return true;
    }

    /** 활성+동의 여부 — LocationAlertSettings 우선, 없으면 persisted 플래그(둘 다 'true'). 방어적. */
    function isFeatureEnabled() {
        try {
            if (root.LocationAlertSettings && root.LocationAlertSettings.get) {
                return root.LocationAlertSettings.get().enabled === true;
            }
        } catch (_) { /* 설정 모듈이 아직 안 올라왔으면 던진다 — 아래 persisted 플래그로 떨어진다 */ }
        try {
            const active = root.localStorage.getItem('location_alert_active');
            const consent = root.localStorage.getItem('location_alert_consent');
            return active === 'true' && consent === 'true';
        } catch (_) { /* 사생활 모드·저장 한도면 던진다 — 저장이 안 돼도 화면은 그대로 돈다 */ }
        return false;
    }

    /**
     * 앱 실행 시 — 네이티브 + 기능 활성일 때 fresh-fix 1회(start()). 절대 throw 하지 않음.
     *   상시 watcher 가 없으므로 "되살리기"가 아니라, 앱을 켤 때 그 시점 위치를 한 번 갱신해
     *   다음 깨우는 신호 전까지의 폴백 정확도를 높인다.
     */
    function ensureStarted() {
        try {
            if (!isNative()) return false;
            if (!isFeatureEnabled()) return false;
            start();
            return true;
        } catch (_) { return false; }
    }

    const api = { start, stop, ensureStarted, getFreshPosition, getPosition, savePosition, clearPosition, syncPositionFromPrefs, isStale, STALE_MAX_MS, POS_KEY, Mirror };
    if (root) root.LocationAlertBackground = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
