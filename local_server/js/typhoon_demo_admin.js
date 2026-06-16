/**
 * ============================================================================
 * 파일명: js/typhoon_demo_admin.js
 * 역할 : 통합 관리자 센터 "시연 → 태풍" 하위탭 UI.
 *        태풍 "발생/소멸" 푸시를 관리자 등록 기기에만 테스트 발송.
 * ============================================================================
 *
 * [진입] js/admin.js switchDemoSubTab('typhoon') → renderTyphoonDemoTab(container)
 * [발송] POST /api/admin/demo/typhoon-test { kind:'onset'|'dissipation' }
 *        → 서버가 sendAdminPush 로 admin_devices.json 기기에만 발송
 *        (admin.js 의 fetch 래퍼가 X-Admin-Token 헤더 자동 첨부)
 * [주의] 실제 발송기와 동일한 문구 빌더(typhoon_message)를 서버가 사용하므로
 *        여기서 보이는 문구 = 실제 사용자에게 갈 문구 형식과 동일.
 * ============================================================================
 */
(function () {
    'use strict';

    function send(kind, btn) {
        var label = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = '발송 중...'; }
        fetch('/api/admin/demo/typhoon-test', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: kind })
        }).then(function (r) { return r.json(); }).then(function (resp) {
            var pr = resp && resp.pushResult;
            var msg;
            if (resp && resp.success) {
                msg = (kind === 'dissipation' ? '소멸' : '발생') + ' 테스트 발송 완료';
                if (pr && typeof pr.sent === 'number') {
                    msg += pr.sent > 0 ? ' — 관리자 기기 ' + pr.sent + '대 발송' : ' — 등록된 관리자 기기 없음';
                }
                if (resp.title) msg += '\n\n[제목] ' + resp.title + '\n[본문] ' + resp.body;
            } else {
                msg = '발송 실패: ' + ((resp && resp.error) || '알 수 없는 오류');
            }
            alert(msg);
        }).catch(function (e) {
            alert('발송 오류: ' + e.message);
        }).finally(function () {
            if (btn) { btn.disabled = false; btn.textContent = label; }
        });
    }

    window.renderTyphoonDemoTab = function (container) {
        var btnBase = 'padding:12px 18px;border:none;border-radius:10px;color:#fff;cursor:pointer;'
            + 'font-weight:700;font-size:0.9rem;flex:1;';
        container.innerHTML =
            '<div style="background:rgba(30,41,59,0.5);border:1px solid rgba(255,255,255,0.08);'
            + 'border-radius:12px;padding:16px;">'
            + '  <div style="font-size:0.95rem;color:#e2e8f0;font-weight:700;margin-bottom:6px;">'
            + '    <i class="fa-solid fa-hurricane" style="color:#a855f7;"></i> 태풍 알림 테스트 발송</div>'
            + '  <div style="font-size:0.8rem;color:#94a3b8;line-height:1.5;margin-bottom:14px;">'
            + '    실제 발송과 동일한 문구로 <b style="color:#d8b4fe;">관리자 등록 기기</b>에만 테스트 푸시를 보냅니다.'
            + '    <br><span style="color:#64748b;">※ 일반 사용자에게는 발송되지 않습니다. 탭하면 해양종합정보 태풍 화면으로 이동합니다.</span></div>'
            + '  <div style="display:flex;gap:10px;">'
            + '    <button id="typhoon-test-onset" style="' + btnBase + 'background:linear-gradient(135deg,#3b82f6,#2563eb);">'
            + '      <i class="fa-solid fa-bell"></i> 발생 테스트 발송</button>'
            + '    <button id="typhoon-test-dissipation" style="' + btnBase + 'background:linear-gradient(135deg,#64748b,#475569);">'
            + '      <i class="fa-solid fa-bell-slash"></i> 소멸 테스트 발송</button>'
            + '  </div>'
            + '</div>';

        var b1 = document.getElementById('typhoon-test-onset');
        var b2 = document.getElementById('typhoon-test-dissipation');
        if (b1) b1.onclick = function () { send('onset', b1); };
        if (b2) b2.onclick = function () { send('dissipation', b2); };
    };
})();
