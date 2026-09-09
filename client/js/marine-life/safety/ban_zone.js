/**
 * ============================================================================
 * 파일명: js/marine-life/safety/ban_zone.js
 * 역할  : "금지구역" 버튼 하나로 출입통제구역과 낚시금지구역을 함께 켜고 끈다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : 없음(두 모듈의 원래 버튼을 대신 눌러 로직을 그대로 재사용)
 *  - 서버 API      : 없음
 *  - 마크업        : index2.html #ocean-banzone-toggle-btn — 해양안전 전용.
 *                    원래 버튼 #ocean-access-control-toggle-btn ·
 *                    #ocean-fishing-ban-toggle-btn 은 CSS 로 숨긴 채 그대로 둔다.
 *  - 나를 쓰는 곳  : 없음(스스로 버튼에 붙는다)
 * [로드 순서] fishing_ban.js 다음(두 원래 버튼의 클릭 리스너가 먼저 붙어 있어야 한다)
 * ============================================================================
 *
 * [왜 이 파일이 있나 — 2026-09-09 사용자 확정]
 * 사용자 원문: *"낚시금지구역과 출입통제구역 버튼을 «금지구역»으로 일원화하고
 * 그것을 눌렀을 때 두 종류의 데이터가 한 화면에 표출되도록 하고 싶어."*
 * 둘 다 "여기서는 하면 안 된다"는 같은 뜻의 구역이라 버튼을 나눠 둘 이유가 없었다.
 *
 * [어떻게 묶었나]
 * 두 모듈(access_control.js · fishing_ban.js)의 코드는 손대지 않는다. 각자 자기
 * 버튼의 click 을 듣고 있으므로, 새 버튼이 **원래 버튼 두 개를 대신 눌러 준다**
 * (life_safety.js 의 "내 위치" 버튼이 활동 모듈의 GPS 버튼을 대신 누르는 것과 같은
 * 방식). 그래서 폴리곤·라벨·상세 팝업·배경지도 전환이 종전과 똑같이 동작한다.
 *
 * ⚠배경지도: 두 모듈이 각각 "켤 때의 배경지도"를 기억해 끌 때 되돌린다. 함께 켜면
 *   먼저 켜진 쪽이 원래 지도를, 나중 쪽은 위성지도를 기억하는데, 끌 때 나중 쪽이
 *   먼저 처리돼도 결국 먼저 켜진 쪽이 원래 지도로 되돌리므로 결과는 같다(실측 확인).
 */

(function () {
    'use strict';

    /** 원래 버튼 둘을 대신 누르고, 새 버튼의 눌린 표시를 둘 중 하나에 맞춘다.
     *
     * 예시: 꺼진 상태에서 "금지구역"을 누르면 출입통제·낚시금지 폴리곤이 함께 뜨고
     *       버튼에 active 가 붙는다. 다시 누르면 둘 다 사라지고 active 가 떨어진다.
     */
    function bind() {
        var btn = document.getElementById('ocean-banzone-toggle-btn');
        var acBtn = document.getElementById('ocean-access-control-toggle-btn');
        var fbBtn = document.getElementById('ocean-fishing-ban-toggle-btn');
        if (!btn || !acBtn || !fbBtn) return false;

        btn.addEventListener('click', function () {
            // 두 레이어의 켜짐 상태를 늘 같게 맞춘다 — 어느 한쪽만 켜져 있는 상태가
            // 생기면 버튼 하나로는 되돌릴 수 없다. 새로 켤지 끌지는 새 버튼 자신의
            // 표시(active)로 정한다.
            var turnOn = !btn.classList.contains('active');
            if (acBtn.classList.contains('active') !== turnOn) acBtn.click();
            if (fbBtn.classList.contains('active') !== turnOn) fbBtn.click();
            btn.classList.toggle('active', turnOn);
        });
        return true;
    }

    // 두 원래 버튼은 각 모듈이 "지도 준비 후"에 리스너를 붙이므로, 붙기 전에 우리가
    // 먼저 눌러 버리면 아무 일도 안 일어난다. 버튼이 생길 때까지만 짧게 기다린다
    // (access_control.js 의 window.getOceanMap 폴링과 같은 취지).
    if (!bind()) {
        var tries = 0;
        var timer = setInterval(function () {
            if (bind() || ++tries > 100) clearInterval(timer);
        }, 100);
    }
})();
