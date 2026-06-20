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

        const msg = core.buildMessage({
            zoneName,
            warnType: z.warnType || '풍랑',
            tier,
            event: z.event || 'active',
            timeText: z.efTime || '',
            nearestClear,
            nearestLower,
            forecast: z.forecast || null,
        });
        // 진단/표시용 메타 주석(메시지 텍스트는 변경하지 않음 — title/body 동일).
        if (msg) { msg.zone = zoneName; msg.tier = tier; msg.event = z.event || 'active'; }
        return msg;
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
                    // BigTextStyle — 펼치면 본문 전체가 표시되도록(한 줄 "..." 잘림 방지)
                    largeBody: msg.body,
                    summaryText: '해상특보 안전 경보',
                    // 상태바/알림 아이콘을 앱 마크로. 전용 알림 아이콘이 없어 앱 아이콘 전경 드로어블 사용.
                    smallIcon: 'ic_launcher_foreground',
                    largeIcon: 'ic_launcher_foreground',
                }],
            });
        } catch (e) { console.error('[LocationAlertRuntime] 알림 표시 실패:', e && e.message); }
    }

    /** 단말 진단 로그 기록(완전 on-device, 네트워크 없음). localStorage + Capacitor Preferences(미러). */
    function writeLastMatch(rec) {
        try {
            const json = JSON.stringify(rec);
            try { root.localStorage.setItem('location_alert_last_match', json); } catch (_) { }
            try {
                const M = root.LocationAlertBackground && root.LocationAlertBackground.Mirror;
                if (M && M.set) M.set('location_alert_last_match', json);
            } catch (_) { }
        } catch (_) { }
    }

    /**
     * 데이터 메시지 수신 처리(표시 셸). snapshotStr = data.snapshot(JSON 문자열).
     * @param data (선택) FCM data 맵. demoLat/demoLng 가 있으면 시연 위치로 판정(POS_KEY 미사용),
     *   없으면 실제 백그라운드 GPS(POS_KEY)로 판정 — 실제 운영은 항상 진짜 위치 사용.
     */
    async function handleWake(snapshotStr, data) {
        try {
            const snapshot = typeof snapshotStr === 'string' ? JSON.parse(snapshotStr) : snapshotStr;
            let pos, src;
            if (data && data.demoLat && data.demoLng) {
                // 시연(데모): 메시지에 실린 위치 사용 — 실제 저장 위치(POS_KEY)는 건드리지 않음.
                const dLat = Number(data.demoLat), dLng = Number(data.demoLng);
                if (Number.isFinite(dLat) && Number.isFinite(dLng)) {
                    pos = { lat: dLat, lng: dLng, acc: Number(data.demoAcc) || 0 };
                    src = 'demo';
                }
            }
            if (!pos) {
                // 실제 운영(또는 데모 좌표가 비정상): 단말의 진짜 백그라운드 GPS 위치로 폴백.
                pos = root.LocationAlertBackground && root.LocationAlertBackground.getPosition
                    ? root.LocationAlertBackground.getPosition() : null;
                src = (pos && pos.src) || 'gps';
            }
            if (!pos) { console.log('[LocationAlertRuntime] 저장 위치 없음 → skip'); return; }
            const features = await loadFeatures();
            const msg = decideAlert(
                { lat: pos.lat, lng: pos.lng, accuracyM: pos.acc || pos.accuracyM || 0 }, features, snapshot);
            if (msg) {
                // 단말 진단 로그(어느 구역이 판정됐는지 + 위치 출처). on-device 전용.
                writeLastMatch({
                    zone: msg.zone || '', lat: pos.lat, lng: pos.lng, src,
                    tier: msg.tier || '', event: msg.event || '', at: new Date().toISOString(),
                });
                await showLocalNotification(msg);
            }
        } catch (e) { console.error('[LocationAlertRuntime] handleWake 실패:', e && e.message); }
    }

    const api = { decideAlert, handleWake, loadFeatures };
    if (root) root.LocationAlertRuntime = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
