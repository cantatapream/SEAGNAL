/**
 * ============================================================================
 * admin_location_demo.js — 통합 관리자 센터 > 시연 > "위치 기반 특보 시연" 하위탭
 * ============================================================================
 * 설계 문서: 00_docs/LOCATION_BASED_ALERT_DESIGN.md
 *
 * 목적(테스트 단계): 내 위치를 제주도북부앞바다로 임의 고정하고, 시나리오별로
 *   서버가 **이 관리자 기기에만** 실제 깨우는 신호(데이터 메시지)를 발송 → 단말이
 *   판정해 로컬 알림을 띄우는지 확인. 발송 전 제목/본문 미리보기도 표시.
 *
 * 실제 푸시 경로 검증용. 단말 푸시 토큰(push_token) + 관리자 토큰 필요.
 * ============================================================================
 */
(function () {
    'use strict';

    const ZONE_NAME = '제주도북부앞바다';
    const POS_KEY = 'location_alert_last_pos';
    let _features = null;

    async function loadFeatures() {
        if (_features) return _features;
        const r = await fetch('/api/warn-zones');
        const g = await r.json();
        _features = (g && g.features) || [];
        return _features;
    }

    // 구역 내부점(센트로이드→실패 시 외곽 중점) — 폴리곤 안 보장
    function interiorPoint(feature) {
        const core = window.LocationAlertCore;
        const geom = feature.geometry;
        const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
        for (const poly of polys) {
            const ext = poly[0];
            let sx = 0, sy = 0; ext.forEach(p => { sx += p[0]; sy += p[1]; });
            const c = [sx / ext.length, sy / ext.length];
            if (core.pointInGeometry(c, core.seaGeometry(feature))) return c;
            for (let i = 0; i < ext.length - 1; i++) {
                const m = [(ext[i][0] + c[0]) / 2, (ext[i][1] + c[1]) / 2];
                if (core.pointInGeometry(m, core.seaGeometry(feature))) return m;
            }
        }
        return null;
    }

    // 시나리오 정의 (단일 구역 = 제주도북부앞바다)
    const SCENARIOS = [
        { id: 'prelim', label: '예비특보 발표', warnings: [{ zone: ZONE_NAME, warnType: '풍랑', level: '예비', event: 'publish', efTime: '오늘 밤(21~24시)' }] },
        { id: 'adv_pub', label: '풍랑주의보 발효 예정', warnings: [{ zone: ZONE_NAME, warnType: '풍랑', level: '주의보', event: 'publish', efTime: '6월 17일 21시' }] },
        { id: 'adv_act', label: '풍랑주의보 발효 중', warnings: [{ zone: ZONE_NAME, warnType: '풍랑', level: '주의보', event: 'active' }] },
        { id: 'warn_pub', label: '풍랑경보 발표', warnings: [{ zone: ZONE_NAME, warnType: '풍랑', level: '경보', event: 'publish', efTime: '6월 17일 21시' }] },
        { id: 'warn_act', label: '풍랑경보 발효', warnings: [{ zone: ZONE_NAME, warnType: '풍랑', level: '경보', event: 'active' }] },
        { id: 'typhoon', label: '태풍경보 발효', warnings: [{ zone: ZONE_NAME, warnType: '태풍', level: '경보', event: 'active' }] },
    ];

    // 시나리오 warnings → 스냅샷(서버 buildSnapshot과 동일 규칙)
    function buildSnapshot(warnings) {
        const core = window.LocationAlertCore;
        const byZone = {};
        warnings.forEach(w => { (byZone[w.zone] = byZone[w.zone] || []).push(w); });
        const zones = {};
        Object.keys(byZone).forEach(z => {
            const ws = byZone[z];
            const tier = core.classifyTier(ws.map(w => ({ type: w.warnType, level: w.level })));
            const rep = ws[0];
            zones[z] = { warnType: rep.warnType, level: rep.level, event: rep.event, efTime: rep.efTime || null, tier };
        });
        return { generatedAt: new Date().toISOString(), zones };
    }

    function setStatus(html) { const el = document.getElementById('la-demo-status'); if (el) el.innerHTML = html; }
    function setResult(html) { const el = document.getElementById('la-demo-result'); if (el) el.innerHTML = html; }

    // 시연 위치를 제주도북부앞바다 중심으로 고정(단말 저장 — 실제 판정에 사용)
    window.laDemoSetPosition = async function () {
        try {
            const features = await loadFeatures();
            const f = features.find(x => x.properties.name === ZONE_NAME);
            if (!f) { setStatus('<span style="color:#fca5a5;">구역(' + ZONE_NAME + ')을 찾지 못했습니다.</span>'); return null; }
            const p = interiorPoint(f);
            if (!p) { setStatus('<span style="color:#fca5a5;">구역 내부점 계산 실패</span>'); return null; }
            const rec = { lat: p[1], lng: p[0], acc: 20, at: new Date().toISOString() };
            localStorage.setItem(POS_KEY, JSON.stringify(rec));
            setStatus('시연 위치 고정됨 → <b>' + ZONE_NAME + '</b> (' + rec.lat.toFixed(4) + ', ' + rec.lng.toFixed(4) + ')');
            return rec;
        } catch (e) { setStatus('<span style="color:#fca5a5;">위치 설정 실패: ' + (e && e.message) + '</span>'); return null; }
    };

    // 시나리오 실행: (1) 단말 미리보기 (2) 서버가 이 기기로 실제 데이터 메시지 발송
    window.laDemoRun = async function (scenarioId) {
        const sc = SCENARIOS.find(s => s.id === scenarioId);
        if (!sc) return;
        try {
            const features = await loadFeatures();
            // 위치 미설정이면 자동 설정
            let pos = null;
            try { pos = JSON.parse(localStorage.getItem(POS_KEY)); } catch (_) { }
            if (!pos) pos = await window.laDemoSetPosition();
            if (!pos) return;

            // (1) 미리보기 — 단말 판정 로직 그대로
            const snapshot = buildSnapshot(sc.warnings);
            const msg = window.LocationAlertRuntime.decideAlert(
                { lat: pos.lat, lng: pos.lng, accuracyM: pos.acc || 0 }, features, snapshot);
            if (msg) {
                setResult(
                    '<div style="margin-top:10px;padding:12px;background:rgba(0,0,0,0.25);border-radius:8px;">'
                    + '<div style="font-size:0.75rem;color:#94a3b8;margin-bottom:6px;">미리보기 (' + sc.label + ')</div>'
                    + '<div style="font-weight:700;color:#e2e8f0;">' + msg.title + '</div>'
                    + '<div style="white-space:pre-line;color:#cbd5e1;font-size:0.88rem;margin-top:6px;">' + msg.body + '</div>'
                    + '<div id="la-demo-send" style="margin-top:8px;font-size:0.8rem;color:#94a3b8;">발송 중…</div></div>');
            } else {
                setResult('<div style="margin-top:10px;color:#fbbf24;">이 시나리오는 현재 위치 기준 표출 대상이 아닙니다(판정 null).</div>');
            }

            // (2) 실제 발송 — 이 기기 push_token + 관리자 토큰
            const token = localStorage.getItem('push_token');
            const adminToken = localStorage.getItem('seagnal_admin_token') || sessionStorage.getItem('seagnal_admin_token');
            const sendEl = document.getElementById('la-demo-send');
            if (!token) { if (sendEl) sendEl.innerHTML = '<span style="color:#fbbf24;">⚠ push_token 없음 — 실기기(앱)에서 푸시 등록 후 발송 가능. 미리보기만 동작.</span>'; return; }

            const resp = await fetch('/api/location-alert/demo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken || '' },
                body: JSON.stringify({ token, activeWarnings: sc.warnings }),
            });
            const data = await resp.json().catch(() => ({}));
            if (sendEl) {
                if (resp.ok && data.success) {
                    const r = data.result || {};
                    sendEl.innerHTML = '✅ 발송 요청 완료 (대상 ' + (r.targets || 0) + '명) — 잠시 후 이 기기에 알림 도착';
                    sendEl.style.color = '#86efac';
                } else {
                    sendEl.innerHTML = '❌ 발송 실패: ' + (data.error || resp.status);
                    sendEl.style.color = '#fca5a5';
                }
            }
        } catch (e) { setResult('<span style="color:#fca5a5;">실행 실패: ' + (e && e.message) + '</span>'); }
    };

    // 하위탭 렌더
    window.renderLocationAlertDemoTab = function (container) {
        if (!container) return;
        const btns = SCENARIOS.map(s =>
            '<button onclick="laDemoRun(\'' + s.id + '\')" style="padding:9px 12px;border:none;border-radius:8px;'
            + 'background:linear-gradient(135deg,#0ea5e9,#0369a1);color:#fff;font-weight:700;font-size:0.82rem;cursor:pointer;">'
            + s.label + '</button>').join('');
        container.innerHTML =
            '<div class="admin-section-title"><i class="fa-solid fa-location-crosshairs" style="color:#0ea5e9;"></i> 위치 기반 특보 시연 (실제 푸시)</div>'
            + '<div style="font-size:0.82rem;color:#94a3b8;line-height:1.6;margin:6px 0 12px;">'
            + '내 위치를 <b>' + ZONE_NAME + '</b>로 임의 고정하고, 시나리오를 누르면 서버가 <b>이 관리자 기기에만</b> 실제 데이터 메시지를 보냅니다. '
            + '단말이 판정해 로컬 알림을 띄웁니다. (아래 미리보기로 발송 전 문구도 확인)</div>'
            + '<div style="margin-bottom:10px;"><button onclick="laDemoSetPosition()" style="padding:8px 14px;border:none;border-radius:8px;background:#334155;color:#e2e8f0;font-weight:700;cursor:pointer;font-size:0.82rem;"><i class="fa-solid fa-map-pin"></i> 시연 위치 설정(' + ZONE_NAME + ')</button>'
            + ' <span id="la-demo-status" style="font-size:0.8rem;color:#94a3b8;margin-left:8px;">위치 미설정</span></div>'
            + '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:6px;">' + btns + '</div>'
            + '<div id="la-demo-result"></div>'
            + '<div style="margin-top:12px;font-size:0.74rem;color:#64748b;line-height:1.5;">※ 실기기(앱)에서 동작. 앱이 <b>켜져 있을 때</b> 가장 확실히 수신됩니다. push_token이 없으면 미리보기만 동작합니다.</div>';
        // 진입 시 위치 자동 설정 시도
        window.laDemoSetPosition();
    };
})();
