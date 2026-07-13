/**
 * ============================================================================
 * location_alert_typhoon_runtime.js — 위치기반 태풍 반경 알림: 단말 런타임 (Phase 2a)
 * 역할  : 위치기반 태풍 반경 알림 단말 런타임 (서버 wake 신호 → 반경 판정 → 알림)
 * ============================================================================
 * 설계 문서: typhoon_radius_engine.design.md (같은 폴더) (Phase 2a 확정 리파인)
 *
 * 서버의 데이터 메시지(type:'typhoon_radius_wake', sig)를 받으면:
 *   1) subTyphoon 게이트(OFF면 skip, 미설정/미로드는 fail-open)
 *   2) 그 순간 위치 1회 수집(getFreshPosition) — 없으면 skip ({lat,lng}→{lat,lon} 매핑)
 *   3) /api/typhoon 재조회 → 활성 태풍 목록
 *   4) **각 태풍마다** 폭풍(우선)/강풍 반경 진입 판정(typhoon_radius.radiusEntry)
 *   5) 진입한 **태풍마다 별도** 로컬 알림(buildRadiusAlert + buildDemoUrl(guide:true))
 *
 * 위치는 서버로 가지 않는다. 좌표 판정은 전부 on-device.
 * 기존 특보용 location_alert_runtime.js 와 별 파일로 공존(그 파일은 수정하지 않음).
 *
 * 순수부(framesOf/decideTyphoonAlerts)는 Node 테스트 가능. handleTyphoonWake 는 표시 셸.
 * 완전 방어적 — 절대 throw 하지 않는다.
 * ============================================================================
 */
(function (root) {
    'use strict';

    // typhoon_radius / typhoon_message 를 전역(브라우저) 또는 require(Node 테스트)로 확보.
    function getRadius() {
        if (root && root.TyphoonRadius && root.TyphoonRadius.radiusEntry) return root.TyphoonRadius;
        try { return require('../services/typhoon_radius.js'); } catch (_) { return null; }
    }
    function getMessage() {
        if (root && root.TyphoonMessage && root.TyphoonMessage.buildRadiusAlert) return root.TyphoonMessage;
        try { return require('../services/typhoon_message.js'); } catch (_) { return null; }
    }

    /**
     * 순수 — 한 태풍의 통보문(최신 bulletin)에서 radiusEntry 입력용 프레임 배열을 만든다.
     *   normRow(typhoon_crawler.js:234)가 채우는 키와 radiusEntry 기대 키가 동일:
     *     time / lat / lon / radStrong / radStrongS / radStrongD / radStorm / radStormS / radStormD.
     *   (만일을 대비해 lng→lon 폴백도 둔다 — 어댑터.)
     *   최신 통보문(isLatest 우선, 없으면 0번)의 current + forecast 프레임을 모은다.
     * @param {object} typhoon { seq, name, nameEn, latestTmFc, bulletins:[{current,forecast,...}] }
     * @returns {Array} radiusEntry-shaped 프레임 배열
     */
    function framesOf(typhoon) {
        if (!typhoon || !Array.isArray(typhoon.bulletins) || typhoon.bulletins.length === 0) return [];
        // 최신 통보문 선택: isLatest===true 우선, 없으면 첫 번째(크롤러가 최신을 0번에 둠).
        let b = null;
        for (let i = 0; i < typhoon.bulletins.length; i++) {
            if (typhoon.bulletins[i] && typhoon.bulletins[i].isLatest) { b = typhoon.bulletins[i]; break; }
        }
        if (!b) b = typhoon.bulletins[0];
        if (!b) return [];

        const raw = [];
        if (b.current && typeof b.current === 'object') raw.push(b.current);
        if (Array.isArray(b.forecast)) for (const f of b.forecast) { if (f && typeof f === 'object') raw.push(f); }

        const out = [];
        for (const f of raw) {
            const lat = (typeof f.lat === 'number') ? f.lat : Number(f.lat);
            const lon = (typeof f.lon === 'number') ? f.lon
                : (f.lon != null ? Number(f.lon) : (f.lng != null ? Number(f.lng) : NaN)); // lng→lon 폴백
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
            out.push({
                time: f.time,
                lat: lat,
                lon: lon,
                radStrong: f.radStrong != null ? f.radStrong : null,
                radStrongS: f.radStrongS != null ? f.radStrongS : null,
                radStrongD: f.radStrongD != null ? f.radStrongD : null,
                radStorm: f.radStorm != null ? f.radStorm : null,
                radStormS: f.radStormS != null ? f.radStormS : null,
                radStormD: f.radStormD != null ? f.radStormD : null,
            });
        }
        return out;
    }

    /**
     * 순수 — 내 위치 + 활성 태풍들 → 진입한 태풍마다 1건씩.
     *   각 태풍: 폭풍(storm) 반경 진입을 먼저 보고, 없으면 강풍(strong). 둘 다 없으면 그 태풍 skip.
     *   (earliest-only 아님 — 진입한 모든 태풍을 각각 1건씩 반환.)
     * @param {{lat:number, lon:number}} loc 내 위치
     * @param {Array} typhoons /api/typhoon 의 typhoons
     * @returns {Array<{seq, name, nameEn, which:'storm'|'strong', entry, snap}>}
     */
    function decideTyphoonAlerts(loc, typhoons) {
        const R = getRadius();
        if (!R || !R.radiusEntry) return [];
        if (!loc || typeof loc.lat !== 'number' || typeof loc.lon !== 'number') return [];
        if (!Array.isArray(typhoons)) return [];

        const out = [];
        for (const t of typhoons) {
            if (!t) continue;
            const frames = framesOf(t);
            if (!frames.length) continue;
            // 폭풍 우선 — 더 위험. 없으면 강풍 폴백.
            let which = 'storm';
            let entry = R.radiusEntry(loc, frames, 'storm');
            if (!entry) { which = 'strong'; entry = R.radiusEntry(loc, frames, 'strong'); }
            if (!entry) continue; // 어느 반경에도 안 들면 skip
            out.push({
                seq: t.seq,
                name: t.name,
                nameEn: t.nameEn,
                which: which,
                entry: entry,
                snap: { seq: t.seq, name: t.name, nameEn: t.nameEn },
            });
        }
        return out;
    }

    // ── 표시 셸 ────────────────────────────────────────────────────────────

    /** seq → 안정적(태풍별 고유) 32-bit 양의 정수 알림 id. 같은 태풍은 같은 id(중복 표출 방지). */
    function notifIdForSeq(seq) {
        const s = String(seq == null ? '' : seq);
        let h = 0;
        for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
        // 양수 + 특보 알림(Date.now 기반)과 충돌 회피용 베이스 오프셋.
        return (Math.abs(h) % 1000000) + 700000000;
    }

    /** 최신 bulletin 의 통보문 code/연도 — 탭 라우팅(buildDemoUrl) 식별자. */
    function _refOfTyphoon(t) {
        let b = null;
        if (t && Array.isArray(t.bulletins)) {
            for (let i = 0; i < t.bulletins.length; i++) {
                if (t.bulletins[i] && t.bulletins[i].isLatest) { b = t.bulletins[i]; break; }
            }
            if (!b) b = t.bulletins[0];
        }
        return {
            year: (t && t.year) != null ? t.year : ((root.__typhoonYear != null) ? root.__typhoonYear : ''),
            seq: t && t.seq,
            code: b && b.code,
            guide: true,
        };
    }

    /** 로컬 알림 1건 표출. extra.url(딥링크) 포함 — 탭 라우팅에 필요. 방어적(플러그인 없으면 skip). */
    async function showLocalNotification(msg, opts) {
        try {
            const LN = root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.LocalNotifications;
            if (!LN || !LN.schedule) { console.log('[TyphoonRuntime] LocalNotifications 없음 → 표시 skip'); return; }
            const id = (opts && Number.isFinite(opts.id)) ? opts.id : Math.floor(Date.now() % 2147483647);
            await LN.schedule({
                notifications: [{
                    id: id,
                    title: msg.title,
                    body: msg.body,
                    largeBody: msg.body,
                    summaryText: '태풍 반경 안전 경보',
                    smallIcon: 'ic_launcher_foreground',
                    largeIcon: 'ic_launcher_foreground',
                    // 탭 라우팅용 — localNotificationActionPerformed 리스너가 extra.url 을 읽는다.
                    extra: { url: (opts && opts.url) || '' },
                }],
            });
        } catch (e) { console.error('[TyphoonRuntime] 알림 표시 실패:', e && e.message); }
    }

    /**
     * 깨우는 신호 처리(표시 셸). data = FCM data 맵 { type, v, sig }.
     *   각 진입 태풍마다 별도 로컬 알림(태풍별 고유 id). 절대 throw 하지 않는다.
     */
    async function handleTyphoonWake(data) {
        try {
            // ① subTyphoon 게이트 — OFF 면 skip. 미설정/미로드는 fail-open(표출).
            if (root.LocationAlertSettings && root.LocationAlertSettings.get) {
                try {
                    if (root.LocationAlertSettings.get().subTyphoon === false) {
                        console.log('[TyphoonRuntime] subTyphoon OFF → skip');
                        return;
                    }
                } catch (_) { /* get 실패 → fail-open */ }
            }

            // ② 그 순간 위치 1회 수집 — 없으면 skip. {lat,lng} → {lat,lon} 매핑.
            const BG = root.LocationAlertBackground;
            let pos = null;
            if (BG && typeof BG.getFreshPosition === 'function') {
                try { pos = await BG.getFreshPosition(); } catch (_) { pos = null; }
            } else if (BG && BG.getPosition) {
                try { pos = BG.getPosition(); } catch (_) { pos = null; }
            }
            if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) {
                console.log('[TyphoonRuntime] 위치 없음 → skip');
                return;
            }
            const loc = { lat: pos.lat, lon: pos.lng };

            // ③ /api/typhoon 재조회 — 실패/빈 응답 → skip.
            let typhoons = null, year = null;
            try {
                const res = await root.fetch('/api/typhoon');
                const j = await res.json();
                typhoons = (j && Array.isArray(j.typhoons)) ? j.typhoons : null;
                year = j && j.year;
            } catch (e) {
                console.warn('[TyphoonRuntime] /api/typhoon 조회 실패:', e && e.message);
                return;
            }
            if (!typhoons || typhoons.length === 0) { console.log('[TyphoonRuntime] 활성 태풍 없음 → skip'); return; }
            // buildDemoUrl 연도 폴백용으로 전역에 잠깐 보관(없어도 동작).
            if (year != null) try { root.__typhoonYear = year; } catch (_) { }

            // ④ 각 태풍 판정 — 진입한 태풍마다 1건.
            const results = decideTyphoonAlerts(loc, typhoons);
            if (!results.length) { console.log('[TyphoonRuntime] 반경 진입 태풍 없음 → skip'); return; }

            const MSG = getMessage();
            if (!MSG || !MSG.buildRadiusAlert) { console.warn('[TyphoonRuntime] typhoon_message 없음 → skip'); return; }

            // ⑤ 태풍별 별도 로컬 알림.
            for (const r of results) {
                try {
                    const msg = MSG.buildRadiusAlert(r.which, r.snap, r.entry && r.entry.time);
                    if (!msg) continue;
                    const t = typhoons.find(x => x && String(x.seq) === String(r.seq));
                    const ref = _refOfTyphoon(t || { seq: r.seq });
                    const url = MSG.buildDemoUrl ? MSG.buildDemoUrl(ref) : '';
                    await showLocalNotification(msg, { id: notifIdForSeq(r.seq), url: url });
                } catch (e) { console.error('[TyphoonRuntime] 태풍 알림 표출 실패(무시):', e && e.message); }
            }
        } catch (e) { console.error('[TyphoonRuntime] handleTyphoonWake 실패:', e && e.message); }
    }

    const api = { framesOf, decideTyphoonAlerts, handleTyphoonWake, notifIdForSeq };
    if (root) root.LocationAlertTyphoonRuntime = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
