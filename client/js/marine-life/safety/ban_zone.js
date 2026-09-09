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
 *   먼저 처리돼도 결국 먼저 켜진 쪽이 원래 지도로 되돌리므로 결과는 같다(실측 확인:
 *   rltm → 켬 vworld → 끔 rltm, 두 번 반복해도 같다).
 *
 * ★[2026-09-09 결함 수정] 처음에는 버튼이 있는지만 보고 바로 리스너를 붙였는데,
 *   그러면 **아무 일도 안 일어나는 창**이 생긴다. 두 모듈은 window.getOceanMap() 이
 *   지도를 돌려줄 때까지 250ms 씩 기다린 뒤에야 자기 버튼에 리스너를 붙인다. 그런데
 *   해양안전 화면은 진입 200ms 뒤에 비로소 지도를 만들기 시작하므로, 들어가서 곧바로
 *   이 버튼을 누르면 원래 버튼에 아직 리스너가 없어 클릭이 허공에 떨어진다 — 폴리곤도
 *   안 뜨고 배경지도도 안 바뀐다(헤드리스 실측에서 재현: 눌렀는데 두 원래 버튼의
 *   active 가 false, 배경지도 rltm 그대로).
 *   그래서 ①**지도가 준비된 뒤에** 리스너를 붙이고(두 모듈과 같은 조건이라 그 시점엔
 *   상대 리스너도 반드시 있다) ②켤 때 위성지도 전환을 **여기서도 한 번 더 보장**한다
 *   (사용자 지시 2026-09-09: "금지구역의 기본맵은 위성지도로 설정될 수 있도록").
 *   ②는 이미 vworld 면 아무 일도 하지 않으므로 끌 때의 되돌림에 영향이 없다.
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
            // 켤 때는 배경지도를 위성지도로 — 두 모듈도 각자 하지만, 여기서 한 번 더
            // 보장해 두면 어느 쪽이 먼저 켜지든 결과가 같다. 이미 vworld 면 그대로 둔다.
            if (turnOn && typeof window.oceanSetBasemap === 'function' &&
                typeof window.oceanGetBasemap === 'function' &&
                window.oceanGetBasemap() !== 'vworld') {
                window.oceanSetBasemap('vworld');
            }
        });
        return true;
    }

    /** 지도가 준비될 때까지 기다렸다가 리스너를 붙인다.
     *
     * 두 모듈도 똑같이 window.getOceanMap() 을 기다린 뒤 자기 버튼에 리스너를 붙이므로,
     * 이 조건을 같게 두면 우리 버튼이 눌릴 수 있게 된 순간 **상대 리스너도 반드시 있다**.
     * 버튼 존재만 보고 먼저 붙였다가 클릭이 허공에 떨어지던 결함을 이렇게 막는다
     * (위 파일 헤더 ★ 항목 참고). 폴링 간격·횟수는 access_control.js 와 같은 어법이다.
     */
    function _installWhenReady() {
        function _try(tries) {
            var map = window.getOceanMap && window.getOceanMap();
            if (map && bind()) return;
            if (tries > 0) setTimeout(function () { _try(tries - 1); }, 250);
        }
        _try(240);   // 최대 60초 — 해양안전은 진입 뒤에야 지도를 만들기 시작한다
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _installWhenReady);
    } else {
        _installWhenReady();
    }
})();
