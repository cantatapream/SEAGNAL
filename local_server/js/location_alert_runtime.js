/**
 * ============================================================================
 * location_alert_runtime.js — 위치기반 특보: 깨우는 신호 처리·경고 표시 (②)
 * ============================================================================
 * 설계 문서: 00_docs/LOCATION_BASED_ALERT_DESIGN.md (§5, §6, §8)
 *
 * 서버의 데이터 메시지(type:'location_alert_wake', snapshot)를 받으면:
 *   1) 단말 저장 위치 + 내장 특보구역 폴리곤으로 내 구역 판정(GPS 오차 반영)
 *   2) 내 구역에 특보가 있으면 tier별 최근접 대상 구역 계산 → 문구 생성
 *   3) 로컬 알림으로 표출 (위치는 서버로 가지 않음)
 *
 * decideAlert(...)는 순수 함수 → Node 테스트 가능. handleWake(...)는 표시 셸.
 * ============================================================================
 */
(function (root) {
    'use strict';

    function getCore() {
        if (root && root.LocationAlertCore) return root.LocationAlertCore;
        try { return require('./location_alert_core.js'); } catch (_) { return null; }
    }

    function tierOfZone(snapshot, name) {
        const z = snapshot && snapshot.zones && snapshot.zones[name];
        return (z && z.tier) || 'none';
    }

    /**
     * 순수 판정 — 표시할 {title, body} 또는 null.
     * @param pos {lat,lng,accuracyM}
     * @param features warn_zones.geojson features
     * @param snapshot { zones: { [구역명]: {warnType, level, event, efTime, tier} } }
     */
    function decideAlert(pos, features, snapshot) {
        const core = getCore();
        if (!core || !pos || !features || !snapshot) return null;

        const located = core.locateZone({ lat: pos.lat, lng: pos.lng }, features, pos.accuracyM || 0);
        if (!located) return null;                 // 바다 구역 밖(육지/외해)

        const zoneName = located.feature.properties.name;
        const z = snapshot.zones && snapshot.zones[zoneName];
        if (!z || z.tier === 'none' || z.tier === 'prelim_none') return null; // 내 구역에 유효 특보 없음
        const tier = z.tier;

        // 경계 회색지대(GPS 오차 반경 내): 설계 §6/§8 — 강한 경보(severe)만 보류.
        //   예비·주의보(안전정보)는 약한 안내라 그대로 표출(과소 알림 방지).
        if (located.grayZone && tier === 'severe') return null;

        // 최근접 무특보 구역
        const nearestClear = core.nearestZoneBy({ lat: pos.lat, lng: pos.lng }, features,
            (f) => tierOfZone(snapshot, f.properties.name) === 'none');
        // 2단계(경보·태풍)면 '경보·태풍이 아닌(주의보/예비)' 최근접도
        let nearestLower = null;
        if (tier === 'severe') {
            nearestLower = core.nearestZoneBy({ lat: pos.lat, lng: pos.lng }, features,
                (f) => f.properties.name !== zoneName && tierOfZone(snapshot, f.properties.name) !== 'severe');
        }

        return core.buildMessage({
            zoneName,
            warnType: z.warnType || '풍랑',
            tier,
            event: z.event || 'active',
            timeText: z.efTime || '',
            nearestClear,
            nearestLower,
        });
    }

    // ── 내장 폴리곤 캐시(1회 로드) ───────────────────────────────────────────
    let _features = null;
    async function loadFeatures() {
        if (_features) return _features;
        try {
            const res = await root.fetch('/api/warn-zones');
            const gj = await res.json();
            _features = (gj && gj.features) || [];
        } catch (e) {
            console.warn('[LocationAlertRuntime] 폴리곤 로드 실패:', e && e.message);
            _features = [];
        }
        return _features;
    }

    async function showLocalNotification(msg) {
        try {
            const LN = root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.LocalNotifications;
            if (!LN) { console.log('[LocationAlertRuntime] LocalNotifications 없음 → 표시 skip'); return; }
            await LN.schedule({
                notifications: [{
                    id: Math.floor(Date.now() % 2147483647),
                    title: msg.title,
                    body: msg.body,
                    smallIcon: 'ic_stat_icon',
                }],
            });
        } catch (e) { console.error('[LocationAlertRuntime] 알림 표시 실패:', e && e.message); }
    }

    /** 데이터 메시지 수신 처리(표시 셸). snapshotStr = data.snapshot(JSON 문자열). */
    async function handleWake(snapshotStr) {
        try {
            const snapshot = typeof snapshotStr === 'string' ? JSON.parse(snapshotStr) : snapshotStr;
            const pos = root.LocationAlertBackground && root.LocationAlertBackground.getPosition
                ? root.LocationAlertBackground.getPosition() : null;
            if (!pos) { console.log('[LocationAlertRuntime] 저장 위치 없음 → skip'); return; }
            const features = await loadFeatures();
            const msg = decideAlert(
                { lat: pos.lat, lng: pos.lng, accuracyM: pos.acc || 0 }, features, snapshot);
            if (msg) await showLocalNotification(msg);
        } catch (e) { console.error('[LocationAlertRuntime] handleWake 실패:', e && e.message); }
    }

    const api = { decideAlert, handleWake, loadFeatures };
    if (root) root.LocationAlertRuntime = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
