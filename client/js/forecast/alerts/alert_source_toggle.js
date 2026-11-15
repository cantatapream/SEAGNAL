/**
 * ============================================================================
 * 파일명: client/js/forecast/alerts/alert_source_toggle.js
 * 역할  : 메인 「기상정보」 글자 오른쪽의 [MMIS] [통보문] 버튼(관리자만). 누르면 메인 「해역별 특보현황」 목록만
 *         MMIS 기준(기본·일반 사용자와 같음) ↔ 방재기상플랫폼 통보문 기준(관찰·계산만)으로 바꿔 그린다.
 *         지도·해역 상세·푸시는 바꾸지 않는다.
 *         (사용자 확정 2026-11-15: 「관리자 센터에 관리자 권한으로 로그인한 경우에 한해서만 기상정보라는 텍스트 오른쪽에 버튼 두 개를 놓고
 *          MMIS 그리고 통보문 … 번갈아 가면서 볼 수 있게」 「기본적으로는 MMIS를 기준으로 표출」 · 바뀌는 범위 「1- 가」 = 메인 목록만)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : forecast/alerts/data.js(flattenAlertsData·refreshAlertData·window.__alertSourceUrl) · render.js(renderApp) ·
 *                   admin/admin.js(fetch 래퍼 — /api/admin/* 에 관리자 토큰 자동 첨부)
 *  - 서버 API      : GET /api/admin/bulletin-status(관리자 토큰 — routes/bulletin_watch.js) · GET /api/weather-alerts
 *  - 마크업        : index2.html #alert-source-toggle(기상정보 헤더 안 — 기본 숨김)
 *  - 나를 쓰는 곳  : index2.html(스크립트) · 검사 test_alert_source_toggle
 * [로드 순서] forecast/alerts/data.js 다음(flattenAlertsData 를 쓴다).
 * ============================================================================
 */
(function () {
    'use strict';
    var BULLETIN_URL = '/api/admin/bulletin-status';

    /** 관리자 모드인가 — 관리자 센터 로그인 때 남는 표시(admin.js). 실제 자료는 서버가 관리자 토큰으로 다시 확인한다. */
    function isAdmin() {
        try { return localStorage.getItem('seagnal_admin_mode') === 'true'; } catch (e) { /* 사생활 모드·저장 한도 — 일반 사용자로 본다 */ return false; }
    }

    /** 버튼 모양을 지금 출처에 맞춘다. @param {'mmis'|'bulletin'} src  @param {string} [note] 버튼 옆 작은 글 */
    function paint(src, note) {
        var box = document.getElementById('alert-source-toggle');
        if (!box) return;
        box.querySelectorAll('button[data-src]').forEach(function (b) {
            var on = b.getAttribute('data-src') === src;
            b.style.background = on ? (src === 'bulletin' ? 'rgba(52,211,153,0.25)' : 'rgba(96,165,250,0.25)') : 'transparent';
            b.style.fontWeight = on ? '800' : '500';
        });
        var n = box.querySelector('.ast-note');
        if (n) n.textContent = note || '';
    }

    /**
     * 출처를 바꾼다. 통보문 = 관리자 토큰으로 /api/admin/bulletin-status 를 받아 같은 화면 코드로 그린다(자동 새로고침도 그 주소를 쓴다).
     * @param {'mmis'|'bulletin'} src
     * [연계] → data.js flattenAlertsData·refreshAlertData · render.js renderApp
     */
    async function setSource(src) {
        if (src === 'bulletin') {
            try {
                var r = await fetch(BULLETIN_URL, { cache: 'no-store' });
                if (r.status === 401 || r.status === 403) { window.alert('통보문 기준은 관리자 로그인이 필요합니다. 관리자 센터에서 로그인한 뒤 다시 눌러 주세요.'); return; }
                if (!r.ok) { var e = await r.json().catch(function () { return {}; }); window.alert('통보문 기준을 불러오지 못했습니다 — ' + (e.error || ('HTTP ' + r.status))); return; }
                var data = await r.json();
                window.__alertSourceUrl = BULLETIN_URL;
                flattenAlertsData(data);
                if (typeof renderApp === 'function') renderApp();
                var t = data.updatedAt ? new Date(new Date(data.updatedAt).getTime() + 9 * 3600e3).toISOString().slice(11, 16) : '';
                paint('bulletin', '통보문 기준' + (t ? ' · ' + t + ' 계산' : ''));
            } catch (err) {
                console.warn('[출처 전환] 통보문 기준 불러오기 실패:', err && err.message);
                window.alert('통보문 기준을 불러오지 못했습니다 — ' + (err && err.message));
            }
            return;
        }
        window.__alertSourceUrl = null;
        if (typeof refreshAlertData === 'function') await refreshAlertData();
        if (typeof renderApp === 'function') renderApp();
        paint('mmis', '');
    }

    /** 관리자면 버튼을 보이고 MMIS 로 시작한다(새로 열 때마다 MMIS — 기본값). [연계] ← DOMContentLoaded */
    function init() {
        var box = document.getElementById('alert-source-toggle');
        if (!box) return;
        if (!isAdmin()) { box.style.display = 'none'; return; }
        box.style.display = 'inline-flex';
        paint('mmis', '');
    }

    window.setAlertSource = setSource;
    window.__alertSourceToggleInit = init;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
