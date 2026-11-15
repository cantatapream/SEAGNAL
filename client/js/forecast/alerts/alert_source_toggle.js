/**
 * ============================================================================
 * 파일명: client/js/forecast/alerts/alert_source_toggle.js
 * 역할  : 메인 「기상정보」 글자 오른쪽의 [MMIS] [통보문] 버튼(관리자만). 누르면 메인 「해역별 특보현황」 목록만
 *         MMIS 기준(기본·일반 사용자와 같음) ↔ 방재기상플랫폼 통보문 기준(관찰·계산만)으로 바꿔 그린다.
 *         지도·해역 상세·푸시는 바꾸지 않는다. [통보문]일 때 머리 아래에 「HH:MM 기준 MMIS와 상이 N개소」 줄을 띄우고,
 *         「N개소」를 누르면 다른 해역을 부모 해역별 아코디언(구분 | MMIS | 통보문 표 + 「왜?」)으로 보여 주는 아래 팝업을 연다.
 *         (사용자 확정 2026-11-15: 「관리자 센터에 관리자 권한으로 로그인한 경우에 한해서만 기상정보라는 텍스트 오른쪽에 버튼 두 개를 놓고
 *          MMIS 그리고 통보문 … 번갈아 가면서 볼 수 있게」 「기본적으로는 MMIS를 기준으로 표출」 · 바뀌는 범위 「1- 가」 = 메인 목록만)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : forecast/alerts/data.js(flattenAlertsData·refreshAlertData·window.__alertSourceUrl — 자동 새로고침 뒤 window.__alertSourceOnData 를 부른다) · render.js(renderApp) ·
 *                   admin/admin.js(fetch 래퍼 — /api/admin/* 에 관리자 토큰 자동 첨부)
 *  - 서버 API      : GET /api/admin/bulletin-status(관리자 토큰 — routes/bulletin_watch.js, diff = services/bulletin_compare.diffSnapshot) · GET /api/weather-alerts
 *  - 마크업        : index2.html #alert-source-toggle(기상정보 헤더 안 — 기본 숨김) · #ast-diff-line(머리 아래 상이 줄 — 기본 숨김) · 팝업은 이 파일이 body 에 만든다
 *  - 나를 쓰는 곳  : index2.html(스크립트) · 검사 test_bulletin_compare(C·D)
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

    /** 버튼 모양을 지금 출처에 맞춘다. @param {'mmis'|'bulletin'} src */
    function paint(src) {
        var box = document.getElementById('alert-source-toggle');
        if (!box) return;
        box.querySelectorAll('button[data-src]').forEach(function (b) {
            var on = b.getAttribute('data-src') === src;
            b.style.background = on ? (src === 'bulletin' ? 'rgba(52,211,153,0.25)' : 'rgba(96,165,250,0.25)') : 'transparent';
            b.style.fontWeight = on ? '800' : '500';
        });
    }

    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    /** ms → 한국 시각 'HH:MM'. 예: Date.parse('2026-11-16T05:32:00Z') → '14:32' */
    var kstHm = function (ms) { return ms ? new Date(ms + 9 * 3600e3).toISOString().slice(11, 16) : ''; };
    var lastDiff = null;

    /**
     * 머리 아래 「HH:MM 기준 MMIS와 상이 N개소」 줄을 그린다(N = 다른 부모 해역 수, 0 이면 「MMIS와 상이 없음」 — 누를 것 없음).
     * 통보문을 하나도 못 받았으면(0건) 비교 대신 경고를 띄운다 — 실패와 「특보 없음」이 같아 보이지 않게(2026-11-16 사용자 지적, 옛 버튼 옆 글에서 옮김).
     * 예: { bulletins: 12, diff: { atMs, count: 3, zones:[…] } } → 「14:32 기준 MMIS와 상이 [3개소]」
     * @param {object|null} data GET /api/admin/bulletin-status 응답 — null 이면 줄을 숨긴다(MMIS 로 돌아갈 때)
     * [연계] ← setSource · window.__alertSourceOnData(data.js 자동 새로고침) / → openDiffPopup(「N개소」 누름)
     */
    function renderDiffLine(data) {
        var line = document.getElementById('ast-diff-line');
        if (!line) return;
        if (!data) { line.style.display = 'none'; lastDiff = null; return; }
        var d = data.diff || null;
        lastDiff = d;
        var dot = '<span style="width:6px;height:6px;border-radius:50%;background:var(--accent-yellow,#ffd740);flex-shrink:0"></span>';
        var html;
        if (data.bulletins === 0) html = '⚠ 통보문 0건 — 아직 받은 통보문이 없어 계산 못 함';
        else if (!d) html = dot + 'MMIS와 비교 전 — 비교가 한 번 돈 뒤 보입니다';
        else if (!d.count) html = dot + esc(kstHm(d.atMs)) + ' 기준 MMIS와 상이 없음';
        else html = dot + esc(kstHm(d.atMs)) + ' 기준 MMIS와 상이 <a role="button" tabindex="0" class="ast-diff-link" style="color:var(--accent-yellow,#ffd740);font-weight:800;text-decoration:underline;text-underline-offset:3px;cursor:pointer">' + d.count + '개소</a>';
        line.innerHTML = html;
        line.style.display = 'flex';
        var a = line.querySelector('.ast-diff-link');
        if (a) a.onclick = function () { openDiffPopup(lastDiff); };
    }

    // 팝업 모양(시안 compare_mockup.html 그대로 — 색은 style.css :root 값, 없으면 같은 값으로)
    var POP_CSS = '.ast-pop-dim{position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:flex-end;justify-content:center;z-index:10050}' +
        '.ast-pop{width:100%;max-width:520px;max-height:88vh;overflow-y:auto;background:var(--sea-section-bg,#111525);border:1px solid var(--border-color,rgba(255,255,255,0.1));border-radius:18px 18px 0 0;padding:16px 16px 24px;color:#fff;box-sizing:border-box}' +
        '.ast-pop-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.ast-pop-head h3{margin:0;font-size:1.02rem}' +
        '.ast-pop-head .sub{font-size:0.72rem;color:#9aa7b4;margin-top:3px}' +
        '.ast-pop-x{flex-shrink:0;width:32px;height:32px;border-radius:9px;border:1px solid var(--border-color,rgba(255,255,255,0.1));background:rgba(255,255,255,0.06);color:#fff;font-size:1rem;cursor:pointer}' +
        '.ast-pop-lead{font-size:0.78rem;line-height:1.55;color:#cbd5e1;background:rgba(255,255,255,0.04);border-radius:10px;padding:10px 12px;margin:12px 0 14px}' +
        '.ast-pop-lead b.m{color:#93c5fd}.ast-pop-lead b.b{color:#6ee7b7}' +
        '.ast-acc{background:var(--card-bg,#161b2d);border:1px solid var(--border-color,rgba(255,255,255,0.1));border-radius:12px;margin-bottom:10px;overflow:hidden}' +
        '.ast-acc-h{width:100%;display:flex;align-items:center;gap:8px;padding:12px;background:var(--sea-header-bg,#1a2238);border:0;color:#fff;font:inherit;text-align:left;cursor:pointer}' +
        '.ast-acc-h .name{font-weight:800;font-size:0.9rem;flex:1;min-width:0}.ast-acc-h .name small{display:block;font-weight:500;font-size:0.7rem;color:#9aa7b4;margin-top:2px}' +
        '.ast-badge{font-size:0.68rem;font-weight:800;color:#0a101f;background:var(--accent-yellow,#ffd740);border-radius:999px;padding:2px 8px;white-space:nowrap}' +
        '.ast-chev{color:#9aa7b4;transition:transform .2s;font-size:0.8rem}.ast-acc.open .ast-chev{transform:rotate(180deg)}' +
        '.ast-acc-b{display:none;padding:12px}.ast-acc.open .ast-acc-b{display:block}' +
        '.ast-part{margin-bottom:14px}.ast-part:last-child{margin-bottom:0}' +
        '.ast-part-t{font-size:0.78rem;font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}' +
        '.ast-part-t .kind{font-size:0.64rem;font-weight:700;padding:1px 6px;border-radius:5px;background:rgba(255,255,255,0.08);color:#9aa7b4}' +
        '.ast-tbl{overflow-x:auto;border:1px solid var(--border-color,rgba(255,255,255,0.1));border-radius:9px}' +
        '.ast-tbl table{border-collapse:collapse;width:100%;min-width:320px;font-size:0.72rem}' +
        '.ast-tbl th,.ast-tbl td{padding:7px 8px;border-bottom:1px solid var(--border-color,rgba(255,255,255,0.1));vertical-align:top;text-align:left;line-height:1.4}' +
        '.ast-tbl tr:last-child td{border-bottom:0}.ast-tbl thead th{background:rgba(255,255,255,0.05);font-weight:800;white-space:nowrap}' +
        '.ast-tbl thead th.m{color:#93c5fd}.ast-tbl thead th.b{color:#6ee7b7}.ast-tbl td.k{color:#9aa7b4;white-space:nowrap;width:1%}' +
        '.ast-tbl td.diff{background:rgba(255,215,64,0.10);color:#ffe58a;font-weight:700}' +
        '.ast-why{margin-top:7px;font-size:0.74rem;line-height:1.5;color:#e2e8f0;display:flex;gap:6px}.ast-why b{color:var(--accent-yellow,#ffd740);white-space:nowrap}' +
        '.ast-pop-foot{font-size:0.66rem;color:#9aa7b4;margin-top:12px;line-height:1.5}';

    /**
     * MMIS 와 다른 해역 팝업(아래에서 올라오는 판)을 연다 — 부모 해역마다 아코디언(첫 개만 펼침), 구역마다 표 + 「왜?」.
     * 표 글자·다름 표시·「왜?」 문장은 서버(bulletin_compare.diffSnapshot)가 만든 것을 그대로 쓴다(화면에서 다시 판정하지 않는다).
     * 예: openDiffPopup({ atMs, count: 1, zones: [{ parent:'경북북부앞바다', count:1, sub:'연안바다만 다름', parts:[…] }] })
     * @param {object} d diff 묶음
     * [연계] ← renderDiffLine 의 「N개소」 누름 — 다른 곳을 칸별로 보여 주기 위해
     */
    function openDiffPopup(d) {
        if (!d || !d.count) return;
        if (!document.getElementById('ast-pop-css')) { var st = document.createElement('style'); st.id = 'ast-pop-css'; st.textContent = POP_CSS; document.head.appendChild(st); }
        var old = document.getElementById('ast-pop'); if (old) old.remove();
        var acc = d.zones.map(function (z, i) {
            var parts = z.parts.map(function (p) {
                var rows = p.rows.map(function (r) {
                    var c = r.diff ? ' class="diff"' : '';
                    return '<tr><td class="k">' + esc(r.k) + '</td><td' + c + '>' + esc(r.m) + '</td><td' + c + '>' + esc(r.b) + '</td></tr>';
                }).join('');
                return '<div class="ast-part"><div class="ast-part-t">' + esc(p.unit) + ' <span class="kind">' + esc(p.kind) + '</span></div>' +
                    '<div class="ast-tbl"><table><thead><tr><th>구분</th><th class="m">MMIS</th><th class="b">통보문</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
                    '<div class="ast-why"><b>왜?</b><span>' + esc(p.why && p.why.text) + '</span></div></div>';
            }).join('');
            return '<div class="ast-acc' + (i === 0 ? ' open' : '') + '"><button type="button" class="ast-acc-h"><span class="name">' + esc(z.parent) + '<small>' + esc(z.sub) + '</small></span>' +
                '<span class="ast-badge">' + z.count + '곳 다름</span><span class="ast-chev">▼</span></button><div class="ast-acc-b">' + parts + '</div></div>';
        }).join('');
        var dim = document.createElement('div');
        dim.id = 'ast-pop'; dim.className = 'ast-pop-dim';
        dim.innerHTML = '<div class="ast-pop" role="dialog" aria-labelledby="ast-pop-title"><div class="ast-pop-head"><div><h3 id="ast-pop-title">MMIS와 다른 해역 ' + d.count + '곳</h3>' +
            '<div class="sub">' + esc(kstHm(d.atMs)) + ' 기준 · 시각은 모두 한국 시각</div></div><button type="button" class="ast-pop-x" aria-label="닫기">✕</button></div>' +
            '<div class="ast-pop-lead"><b class="m">MMIS</b>(지금 앱이 쓰는 자료)와 <b class="b">통보문</b>(기상청이 직접 낸 발표문)이 서로 다르게 보고 있는 해역입니다. 노란 칸이 다른 부분입니다.</div>' +
            acc + '<div class="ast-pop-foot">비교는 1분마다 다시 합니다. 같아지면 목록에서 사라집니다.</div></div>';
        var close = function () { dim.remove(); };
        dim.onclick = function (e) { if (e.target === dim) close(); };
        dim.querySelector('.ast-pop-x').onclick = close;
        dim.querySelectorAll('.ast-acc-h').forEach(function (h) { h.onclick = function () { h.parentNode.classList.toggle('open'); }; });
        document.body.appendChild(dim);
    }

    /**
     * 출처를 바꾼다. 통보문 = 관리자 토큰으로 /api/admin/bulletin-status 를 받아 같은 화면 코드로 그린다(자동 새로고침도 그 주소를 쓴다).
     * @param {'mmis'|'bulletin'} src
     * [연계] → data.js flattenAlertsData·refreshAlertData · render.js renderApp · renderDiffLine(머리 아래 상이 줄)
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
                paint('bulletin');
                renderDiffLine(data);
            } catch (err) {
                console.warn('[출처 전환] 통보문 기준 불러오기 실패:', err && err.message);
                window.alert('통보문 기준을 불러오지 못했습니다 — ' + (err && err.message));
            }
            return;
        }
        window.__alertSourceUrl = null;
        if (typeof refreshAlertData === 'function') await refreshAlertData();
        if (typeof renderApp === 'function') renderApp();
        paint('mmis');
        renderDiffLine(null);
    }

    /** 관리자면 버튼을 보이고 MMIS 로 시작한다(새로 열 때마다 MMIS — 기본값). [연계] ← DOMContentLoaded */
    function init() {
        var box = document.getElementById('alert-source-toggle');
        if (!box) return;
        if (!isAdmin()) { box.style.display = 'none'; return; }
        box.style.display = 'inline-flex';
        paint('mmis');
    }

    window.setAlertSource = setSource;
    // data.js 자동 새로고침이 통보문 기준 자료를 다시 받으면 상이 줄도 새로 그린다(그 사이 MMIS 로 돌아갔으면 무시)
    window.__alertSourceOnData = function (data) { if (window.__alertSourceUrl === BULLETIN_URL) renderDiffLine(data); };
    window.__alertSourceToggleInit = init;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
