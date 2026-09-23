/**
 * ============================================================================
 * location_alert_runtime.js — 위치기반 특보: 깨우는 신호 처리·경고 표시 (②)
 * 역할  : 위치기반 특보: 깨우는 신호 처리·경고 표시 (② 단계)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : js/location-alert/location_alert_core.js(getCore, 순수 판정),
 *                    js/location-alert/location_alert_background.js(저장 위치)
 *  - 서버 API      : GET /api/warn-zones (특보구역 폴리곤)
 *  - 마크업        : 없음 (로컬 알림 표시 셸)
 *  - 나를 쓰는 곳  : capacitor-plugins.js(wake 신호 라우팅), admin_location_status.js,
 *                    scripts 테스트
 * ============================================================================
 * 설계 문서: location_alert.design.md (같은 폴더) (§5, §6, §8)
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

    /**
     * 순수 판정 — 표시할 {title, body} 또는 null.
     * @param pos {lat,lng,accuracyM}
     * @param features warn_zones.geojson features
     * @param snapshot { zones: { [구역명]: {warnType, level, event, efTime, tier} } }
     * @param diag (선택) 진단 out-param 객체. 전달 시 다음 필드를 채운다(반환 계약 불변):
     *   - diag.locatedZone: 위치가 속한 바다 구역명('' = 바다 구역 밖)
     *   - diag.reason: 'notified' | 'off-sea' | 'no-warning'(무특보·회색지대 보류) | 'invalid'
     *   기존 호출부(3-인자)는 영향 없음 — 반환값은 여전히 Message|null.
     */
    function decideAlert(pos, features, snapshot, diag) {
        // 진단 out-param — 객체가 아니면 완전 무시(기존 호출 non-breaking).
        const D = (diag && typeof diag === 'object') ? diag : null;
        const core = getCore();
        if (!core || !pos || !features || !snapshot) { if (D) D.reason = 'invalid'; return null; }

        // 폴리곤명(공백·'.') 과 스냅샷 표준 구역명(무공백·'·') 차이를 흡수하기 위한
        //   정규화 인덱스를 1회 구축. 이것이 없으면 특보구역이 무특보로 오판정되어
        //   경보가 위험 해역을 안전 해역으로 안내하는 안전-치명 버그가 발생한다.
        const canon = (typeof core.canonZone === 'function')
            ? core.canonZone
            : (n) => String(n || '').replace(/\s+/g, '').replace(/[·.]/g, '·');
        const zonesRaw = (snapshot && snapshot.zones) || {};
        const normZones = {};
        for (const k of Object.keys(zonesRaw)) normZones[canon(k)] = zonesRaw[k];
        // 정확 일치 우선(안전) → 정규화 조회. 무특보면 'none'.
        function tierOfZone(name) {
            const z = zonesRaw[name] || normZones[canon(name)];
            return (z && z.tier) || 'none';
        }

        const located = core.locateZone({ lat: pos.lat, lng: pos.lng }, features, pos.accuracyM || 0);
        if (!located) {                            // 바다 구역 밖(육지/외해)
            if (D) { D.locatedZone = ''; D.reason = 'off-sea'; }
            return null;
        }

        const zoneName = located.feature.properties.name;
        if (D) D.locatedZone = zoneName;
        const z = zonesRaw[zoneName] || normZones[canon(zoneName)];
        if (!z || z.tier === 'none' || z.tier === 'prelim_none') {
            if (D) D.reason = 'no-warning';        // 내 구역에 유효 특보 없음
            return null;
        }
        const tier = z.tier;

        // 경계 회색지대(GPS 오차 반경 내): 설계 §6/§8 — 강한 경보(severe)만 보류.
        //   예비·주의보(안전정보)는 약한 안내라 그대로 표출(과소 알림 방지).
        //   진단상으로는 '유효 특보 억제(no-warning)'로 기록(회색지대 보류 = 표출 없음).
        if (located.grayZone && tier === 'severe') {
            if (D) D.reason = 'no-warning';
            return null;
        }

        // 최근접 무특보 구역 — 정규화 tierOfZone 사용(특보구역이 무특보로 오판정되지 않도록).
        const nearestClear = core.nearestZoneBy({ lat: pos.lat, lng: pos.lng }, features,
            (f) => tierOfZone(f.properties.name) === 'none');
        // 2단계(경보·태풍)면 '경보·태풍이 아닌(주의보/예비)' 최근접도
        let nearestLower = null;
        if (tier === 'severe') {
            nearestLower = core.nearestZoneBy({ lat: pos.lat, lng: pos.lng }, features,
                (f) => f.properties.name !== zoneName && tierOfZone(f.properties.name) !== 'severe');
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
        if (D) D.reason = msg ? 'notified' : 'no-warning'; // buildMessage null(비정상)도 무표출로 기록
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
            try { root.localStorage.setItem('location_alert_last_match', json); } catch (_) { /* 사생활 모드·저장 한도면 던진다 — 저장이 안 돼도 화면은 그대로 돈다 */ }
            try {
                const M = root.LocationAlertBackground && root.LocationAlertBackground.Mirror;
                if (M && M.set) M.set('location_alert_last_match', json);
            } catch (_) { }
        } catch (_) { }
    }

    /**
     * "마지막 wake 처리" 진단 — 알림 여부와 무관하게 **모든** wake 처리 시도를 기록한다.
     *   (location_alert_last_match 는 "마지막 성공 판정"만 남아, 육지(무표출) wake 는
     *    보이지 않았다 → wake 가 아예 안 온 것인지/왔는데 무표출인지 구분 불가 문제 해소.)
     *   완전 on-device — 네트워크 전송 없음. localStorage + Preferences 미러(writeLastMatch 동일 패턴).
     */
    function writeLastWake(rec) {
        try {
            const json = JSON.stringify(rec);
            try { root.localStorage.setItem('location_alert_last_wake', json); } catch (_) { /* 사생활 모드·저장 한도면 던진다 — 저장이 안 돼도 화면은 그대로 돈다 */ }
            try {
                const M = root.LocationAlertBackground && root.LocationAlertBackground.Mirror;
                if (M && M.set) M.set('location_alert_last_wake', json);
            } catch (_) { }
        } catch (_) { }
    }

    /** last_wake 기록 1건 구성 — { at, src, lat, lng, posAt, outcome, zone }. 위치 없으면 lat/lng null. */
    function wakeRec(outcome, pos, src, zone) {
        return {
            at: new Date().toISOString(),
            src: src || 'gps',
            lat: pos && Number.isFinite(pos.lat) ? pos.lat : null,
            lng: pos && Number.isFinite(pos.lng) ? pos.lng : null,
            posAt: (pos && pos.at) || '',
            outcome: outcome || '',
            zone: zone || '',
        };
    }

    /**
     * 데이터 메시지 수신 처리(표시 셸). snapshotStr = data.snapshot(JSON 문자열).
     * 깨우는 신호 시점에 **그 순간 fresh-fix(현재 위치 1회 수집)** 로 판정한다.
     */
    async function handleWake(snapshotStr, data) {
        // pos/src 를 try 밖에 두어 suberror 기록 시에도 가용 정보를 최대한 남긴다(best-effort).
        let pos = null, src = 'gps';
        try {
            const snapshot = typeof snapshotStr === 'string' ? JSON.parse(snapshotStr) : snapshotStr;
            if (!pos) {
                // 이벤트 기반 fresh-fix —
                //   깨우는 신호 시점에 그 순간 위치를 1회 수집(getFreshPosition).
                //   상시 수집을 제거했으므로 매 wake 마다 신선한 위치를 직접 획득한다.
                //   getFreshPosition 은 전경 fix 실패 시 마지막 저장 위치로 폴백(없으면 null).
                const BG = root.LocationAlertBackground;
                if (BG && typeof BG.getFreshPosition === 'function') {
                    try { pos = await BG.getFreshPosition(); } catch (e) {
                        // ★조용히 넘어가지 않는다 (3-44). 위치가 null 이면 **이번 깨움은 통째로 건너뛴다** —
                        //   「알릴 일이 없었다」와 겉으로 똑같다.
                        console.warn('[LocationAlert] 위치 획득 실패 — 이번 깨움은 건너뛴다:', e && e.message);
                        pos = null;
                    }
                } else if (BG && BG.getPosition) {
                    pos = BG.getPosition();
                } else {
                    pos = null;
                }
                src = (pos && pos.src) || 'gps';
            }
            // fresh-fix 실패(전경 fix·저장 위치 모두 없음) → 알림하지 않고 종료.
            if (!pos) {
                writeLastWake(wakeRec('no-position', null, src, ''));
                console.log('[LocationAlertRuntime] fresh-fix/저장 위치 없음 → skip');
                return;
            }

            const features = await loadFeatures();
            // diag out-param — decideAlert null 사유(off-sea/no-warning)를 last_wake 에 남긴다.
            const diag = {};
            const msg = decideAlert(
                { lat: pos.lat, lng: pos.lng, accuracyM: pos.acc || pos.accuracyM || 0 },
                features, snapshot, diag);
            // ① 하위 토글 게이트: '위치 기반 특보 정보 받기'(subAlert)가 OFF 면 표출 스킵.
            //   미설정(=기본 ON) 또는 LocationAlertSettings 미로드 시엔 fail-open(기존 동작 유지).
            //   decideAlert 순수성 유지 위해 가드는 표출 셸 handleWake 에 둔다.
            if (msg && root.LocationAlertSettings && root.LocationAlertSettings.get
                && root.LocationAlertSettings.get().subAlert === false) {
                // 게이트가 표출을 막아도 wake 처리 사실은 남긴다(플래그 desync 가시화).
                writeLastWake(wakeRec('disabled-skip', pos, src, msg.zone || ''));
                console.log('[LocationAlertRuntime] subAlert OFF → 표출 skip');
                return;
            }
            // ② 태풍 반경 엔진은 아직 없음 → subTyphoon 설정은 저장만 하며, 엔진 구축 시 여기 연동.
            if (msg) {
                // 단말 진단 로그(어느 구역이 판정됐는지 + 위치 출처). on-device 전용.
                //   last_match 는 기존 그대로 "마지막 성공 판정"만 기록(의미 불변).
                writeLastMatch({
                    zone: msg.zone || '', lat: pos.lat, lng: pos.lng, src,
                    tier: msg.tier || '', event: msg.event || '', at: new Date().toISOString(),
                });
                writeLastWake(wakeRec('notified', pos, src, msg.zone || ''));
                await showLocalNotification(msg);
            } else {
                // 무표출 wake 도 반드시 기록 — off-sea(육지/외해) vs no-warning(구역 내 무특보·회색지대).
                const outcome = diag.reason === 'off-sea' ? 'off-sea'
                    : (diag.reason === 'no-warning' ? 'no-warning' : 'no-match');
                writeLastWake(wakeRec(outcome, pos, src, diag.locatedZone || ''));
            }
        } catch (e) {
            // 예기치 못한 예외도 best-effort 로 기록(관측 불가 wake 를 없앤다).
            try { writeLastWake(wakeRec('suberror', pos, src, '')); } catch (_) { }
            console.error('[LocationAlertRuntime] handleWake 실패:', e && e.message);
        }
    }

    const api = { decideAlert, handleWake, loadFeatures };
    if (root) root.LocationAlertRuntime = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
