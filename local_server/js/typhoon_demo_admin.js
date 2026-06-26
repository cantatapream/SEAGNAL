/**
 * ============================================================================
 * 파일명: js/typhoon_demo_admin.js
 * 역할 : 통합 관리자 센터의 "시연 → 태풍" 하위탭 화면(UI).
 *        실제 태풍이 없어도 "발생/소멸" 알림 문구·동작을 미리 테스트할 수 있게 해준다.
 * ============================================================================
 *
 * [이 파일을 한 줄로 말하면]
 *   "관리자 화면에 [발생 테스트]/[소멸 테스트] 버튼을 그리고, 누르면 관리자 기기에만 푸시를 쏜다."
 *
 * [어떻게 들어오나 — 연관 흐름]
 *   1. 앱 헤더를 10번 눌러 비밀번호로 통합 관리자 센터 진입
 *   2. "시연" 메인탭 → "태풍" 하위탭 클릭
 *   3. js/admin.js 의 switchDemoSubTab('typhoon') 이 이 파일의 renderTyphoonDemoTab() 을 호출
 *
 * [버튼을 누르면 — 발송 경로]
 *   fetch POST /api/admin/demo/typhoon-test { kind:'onset'|'dissipation' }
 *     → routes/admin.js 가 services/typhoon_message.js 로 문구를 만들고
 *     → sendAdminPush 로 admin_devices.json(관리자 등록 기기)에만 발송
 *   ※ 실제 발송기와 "같은 문구 빌더"를 쓰므로, 여기서 보는 문구 = 실제 사용자에게 갈 형식.
 *   ※ 일반 사용자에게는 절대 발송되지 않는다(테스트 전용).
 *
 * [참고] /api/admin/* 호출에는 관리자 토큰이 필요하지만, js/admin.js 가 window.fetch 를
 *        감싸 X-Admin-Token 헤더를 자동으로 붙여주므로 여기서는 신경 쓸 필요가 없다.
 * ============================================================================
 */
(function () {
    'use strict';

    /**
     * [발송 실행] 발생/소멸 테스트 푸시를 서버에 요청하고, 결과를 알림창으로 보여준다.
     *   - 호출: 아래 renderTyphoonDemoTab() 이 만든 두 버튼의 click 이벤트.
     *   - 연결: 서버 /api/admin/demo/typhoon-test → sendAdminPush(관리자 기기).
     * @param {'onset'|'dissipation'} kind 발생/소멸 구분
     * @param {HTMLElement} btn 누른 버튼(발송 중 비활성화 표시용)
     */
    function send(kind, btn) {
        var label = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = '발송 중...'; } // 중복 클릭 방지
        fetch('/api/admin/demo/typhoon-test', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: kind })
        }).then(function (r) { return r.json(); }).then(function (resp) {
            var pr = resp && resp.pushResult; // { sent, failed } — 관리자 기기 발송 결과
            var msg;
            if (resp && resp.success) {
                msg = (kind === 'dissipation' ? '소멸' : '발생') + ' 테스트 발송 완료';
                if (pr && typeof pr.sent === 'number') {
                    msg += pr.sent > 0 ? ' — 관리자 기기 ' + pr.sent + '대 발송' : ' — 등록된 관리자 기기 없음';
                }
                // 실제로 어떤 문구가 나갔는지 관리자에게 그대로 보여준다(검수용).
                if (resp.title) msg += '\n\n[제목] ' + resp.title + '\n[본문] ' + resp.body;
            } else {
                msg = '발송 실패: ' + ((resp && resp.error) || '알 수 없는 오류');
            }
            alert(msg);
        }).catch(function (e) {
            alert('발송 오류: ' + e.message);
        }).finally(function () {
            if (btn) { btn.disabled = false; btn.textContent = label; } // 버튼 원상복구
        });
    }

    /**
     * [위치기반 반경 발송] 강풍/폭풍반경 진입 시나리오 푸시를 서버에 요청한다.
     *   - 발생/소멸 테스트(send)와 별개 엔드포인트. 고정 위치/고정 통보문 기준.
     *   - 연결: 서버 /api/admin/demo/typhoon-radius-test → sendAdminPush(관리자 기기).
     * @param {'strong'|'storm'} kind 강풍/폭풍 구분
     * @param {HTMLElement} btn 누른 버튼(발송 중 비활성화 표시용)
     */
    function sendRadius(kind, btn) {
        var label = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = '발송 중...'; } // 중복 클릭 방지
        fetch('/api/admin/demo/typhoon-radius-test', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: kind })
        }).then(function (r) { return r.json(); }).then(function (resp) {
            var pr = resp && resp.pushResult; // { sent, failed } — 관리자 기기 발송 결과
            var msg;
            if (resp && resp.success) {
                msg = (kind === 'storm' ? '폭풍반경 내습' : '강풍반경 진입') + ' 시연 발송 완료';
                if (pr && typeof pr.sent === 'number') {
                    msg += pr.sent > 0 ? ' — 관리자 기기 ' + pr.sent + '대 발송' : ' — 등록된 관리자 기기 없음';
                }
                if (resp.eta) msg += '\n[ETA] ' + resp.eta;
                // 실제로 어떤 문구가 나갔는지 관리자에게 그대로 보여준다(검수용).
                if (resp.title) msg += '\n\n[제목] ' + resp.title + '\n[본문] ' + resp.body;
            } else {
                msg = '발송 실패: ' + ((resp && resp.error) || '알 수 없는 오류');
            }
            alert(msg);
        }).catch(function (e) {
            alert('발송 오류: ' + e.message);
        }).finally(function () {
            if (btn) { btn.disabled = false; btn.textContent = label; } // 버튼 원상복구
        });
    }

    /**
     * [화면 그리기] "태풍" 하위탭의 내용을 container 안에 그린다.
     *   - 호출: js/admin.js 의 switchDemoSubTab('typhoon').
     *   - 만드는 것: 설명 문구 + [발생/소멸 테스트] 두 버튼 + 위치기반 반경 시나리오 두 버튼 + 클릭 연결.
     * @param {HTMLElement} container 하위탭 본문 영역(#demo-subtab-body)
     */
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
            // ── 위치기반 반경 시나리오(추가형) — 고정 위치/고정 통보문 기준 ─────────────
            + '  <div style="border-top:1px solid rgba(255,255,255,0.08);margin:16px 0 12px;"></div>'
            + '  <div style="font-size:0.95rem;color:#e2e8f0;font-weight:700;margin-bottom:6px;">'
            + '    <i class="fa-solid fa-location-crosshairs" style="color:#f59e0b;"></i> 위치기반 반경 시나리오</div>'
            + '  <div style="font-size:0.78rem;color:#94a3b8;line-height:1.5;margin-bottom:12px;">'
            + '    고정위치(30.345, 130.625) · 제6-20호 장미 통보문 기준으로 강풍/폭풍반경 진입 ETA 를 계산해 발송합니다.'
            + '    <br><span style="color:#64748b;">※ 탭하면 해당 통보문 태풍 화면 + 행동요령(2탭) 팝업이 자동 표출됩니다.</span></div>'
            + '  <div style="display:flex;gap:10px;">'
            + '    <button id="typhoon-radius-strong" style="' + btnBase + 'background:linear-gradient(135deg,#f59e0b,#d97706);">'
            + '      <i class="fa-solid fa-wind"></i> 강풍반경 진입</button>'
            + '    <button id="typhoon-radius-storm" style="' + btnBase + 'background:linear-gradient(135deg,#ef4444,#b91c1c);">'
            + '      <i class="fa-solid fa-hurricane"></i> 폭풍반경 내습</button>'
            + '  </div>'
            + '</div>';

        // 버튼에 클릭 동작 연결
        var b1 = document.getElementById('typhoon-test-onset');
        var b2 = document.getElementById('typhoon-test-dissipation');
        if (b1) b1.onclick = function () { send('onset', b1); };
        if (b2) b2.onclick = function () { send('dissipation', b2); };
        var b3 = document.getElementById('typhoon-radius-strong');
        var b4 = document.getElementById('typhoon-radius-storm');
        if (b3) b3.onclick = function () { sendRadius('strong', b3); };
        if (b4) b4.onclick = function () { sendRadius('storm', b4); };
    };
})();
