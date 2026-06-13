/**
 * ============================================================================
 * js/advisory_demo_admin.js — 통합관리자센터 "특보 예측 시연" 탭 UI
 * ============================================================================
 *
 * renderAdvisoryPredictionDemoTab(container) 를 노출.
 *   - 상단: 테스트 모드 ON/OFF 토글 (특보 시연과 독립)
 *   - 본문: 상황별 목업 시나리오 리스트 + [표출]/[표출중·내리기] 버튼
 *   - 표출 버튼을 누르면(테스트모드 ON 상태) 해당 목업이 관리자 기기의
 *     "특보 예측" 아코디언에 반영된다(advisory_demo.js 폴링이 받아 렌더).
 *
 * /api/admin/* 호출은 admin.js 의 전역 fetch 래퍼가 X-Admin-Token 자동 첨부.
 * ============================================================================
 */
(function () {
    'use strict';
    if (typeof window === 'undefined') return;

    var _state = { testMode: false, scenarioId: null, scenarios: [] };

    // 하위탭으로 묶이면 demo-subtab-body 에, 단독이면 unified-admin-body 에 재렌더.
    function _mount() {
        return document.getElementById('demo-subtab-body') || document.getElementById('unified-admin-body');
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function _fetchState() {
        return fetch('/api/admin/advisory-demo/state', { cache: 'no-cache' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) { if (d) _state = { testMode: !!d.testMode, scenarioId: d.scenarioId || null, scenarios: d.scenarios || [] }; return _state; });
    }

    window.renderAdvisoryPredictionDemoTab = function (container) {
        if (!container) container = document.getElementById('unified-admin-body');
        if (!container) return;
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> 로딩 중...</div>';
        _fetchState().then(function () { _render(container); }).catch(function () {
            container.innerHTML = '<div style="padding:20px;color:#fca5a5;">시연 상태를 불러오지 못했습니다.</div>';
        });
    };

    function _render(container) {
        var on = _state.testMode;
        var activeId = _state.scenarioId;

        var html = ''
            + '<div class="admin-section-title"><i class="fa-solid fa-wand-magic-sparkles" style="color:#a855f7;"></i> 특보 예측 시연 (테스트 모드)</div>'
            + '<div style="border:1px solid ' + (on ? 'rgba(168,85,247,0.6)' : 'rgba(255,255,255,0.1)') + ';border-radius:12px;padding:16px;margin-bottom:16px;background:' + (on ? 'rgba(168,85,247,0.1)' : 'rgba(255,255,255,0.02)') + ';">'
            + '  <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">'
            + '    <div style="flex:1;min-width:220px;">'
            + '      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">'
            + '        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + (on ? '#a855f7' : '#475569') + (on ? ';box-shadow:0 0 8px #a855f7' : '') + ';"></span>'
            + '        <span style="color:#fff;font-weight:700;font-size:1rem;">테스트 모드 ' + (on ? 'ON' : 'OFF') + '</span>'
            + '      </div>'
            + '      <div style="color:#94a3b8;font-size:0.76rem;line-height:1.5;">ON 으로 켠 뒤 아래 시나리오의 <b>표출</b>을 누르면, <b>관리자 등록 기기</b>의 "특보 예측"에 해당 목업이 표시됩니다. OFF 시 실제 예측으로 복원됩니다.</div>'
            + '    </div>'
            + '    <label style="display:inline-flex;align-items:center;cursor:pointer;">'
            + '      <input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="advisoryDemoToggleTestMode(this.checked)" style="width:44px;height:24px;cursor:pointer;">'
            + '    </label>'
            + '  </div>'
            + '</div>';

        html += '<div style="display:flex;flex-direction:column;gap:10px;">';
        (_state.scenarios || []).forEach(function (s, i) {
            var isActive = on && activeId === s.id;
            html += ''
                + '<div style="border:1px solid ' + (isActive ? 'rgba(168,85,247,0.7)' : 'rgba(255,255,255,0.1)') + ';border-radius:10px;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;background:' + (isActive ? 'rgba(168,85,247,0.12)' : 'rgba(255,255,255,0.02)') + ';">'
                + '  <div style="flex:1;min-width:200px;">'
                + '    <div style="color:#fff;font-weight:700;margin-bottom:2px;">' + (i + 1) + '. ' + esc(s.title) + (isActive ? ' <span style="color:#c4b5fd;font-size:0.72rem;">· 표출중</span>' : '') + '</div>'
                + '    <div style="color:#94a3b8;font-size:0.76rem;line-height:1.4;">' + esc(s.desc) + '</div>'
                + '  </div>'
                + '  <div>'
                + (isActive
                    ? '    <button onclick="advisoryDemoClear()" style="padding:7px 14px;border-radius:8px;border:1px solid rgba(248,113,113,0.6);background:rgba(248,113,113,0.12);color:#fca5a5;font-weight:700;cursor:pointer;">내리기</button>'
                    : '    <button onclick="advisoryDemoEmit(\'' + esc(s.id) + '\')" ' + (on ? '' : 'disabled') + ' style="padding:7px 16px;border-radius:8px;border:1px solid ' + (on ? 'rgba(168,85,247,0.6)' : 'rgba(255,255,255,0.12)') + ';background:' + (on ? 'rgba(168,85,247,0.15)' : 'rgba(255,255,255,0.03)') + ';color:' + (on ? '#d8b4fe' : '#64748b') + ';font-weight:700;cursor:' + (on ? 'pointer' : 'not-allowed') + ';">표출</button>')
                + '  </div>'
                + '</div>';
        });
        html += '</div>';

        if (!on) {
            html += '<div style="margin-top:12px;color:#94a3b8;font-size:0.76rem;">※ 표출하려면 먼저 테스트 모드를 ON 하세요.</div>';
        }

        container.innerHTML = html;
    }

    window.advisoryDemoToggleTestMode = function (enabled) {
        _state.testMode = !!enabled;
        var c = _mount();
        if (c) _render(c);
        fetch('/api/admin/advisory-demo/testmode', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: !!enabled })
        }).then(function (r) { return r.json(); }).then(function (resp) {
            _state.testMode = !!(resp && resp.testMode);
            _state.scenarioId = (resp && resp.scenarioId) || null;
            if (c) _render(c);
        }).catch(function (e) {
            alert('테스트 모드 전환 실패: ' + (e && e.message));
            _state.testMode = !enabled;
            if (c) _render(c);
        });
    };

    window.advisoryDemoEmit = function (scenarioId) {
        fetch('/api/admin/advisory-demo/emit', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scenarioId: scenarioId })
        }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
            .then(function (res) {
                if (!res.ok) { alert((res.j && res.j.error) || '표출 실패'); return; }
                _state.scenarioId = scenarioId;
                var c = _mount();
                if (c) _render(c);
            }).catch(function (e) { alert('표출 실패: ' + (e && e.message)); });
    };

    window.advisoryDemoClear = function () {
        fetch('/api/admin/advisory-demo/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
            .then(function (r) { return r.json(); }).then(function () {
                _state.scenarioId = null;
                var c = _mount();
                if (c) _render(c);
            }).catch(function (e) { alert('내리기 실패: ' + (e && e.message)); });
    };
})();
