/**
 * ============================================================================
 * 파일명: js/marine-life/safety/ban_zone.js
 * 역할  : "금지구역" 버튼 하나로 출입통제구역과 낚시금지구역을 함께 켜고 끈다.
 *         켜져 있는 동안에는 기본맵 버튼 아래에 범례가 떠서, 어떤 색이 어떤 구역인지
 *         알려주고 종류별로 따로 켜고 끌 수 있게 한다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : window.accessControlSetShown()(access_control.js) ·
 *                    window.fishingBanSetShown()(fishing_ban.js) — 범례 스위치용.
 *                    켜고 끄기 자체는 두 모듈의 원래 버튼을 대신 눌러 그대로 재사용한다.
 *  - 서버 API      : 없음
 *  - 마크업        : index2.html #ocean-banzone-toggle-btn — 해양안전 전용.
 *                    #banzone-legend(범례 상자) · #bzl-row-ac · #bzl-row-fb(스위치 줄)
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
 * [범례 — 2026-09-09 사용자 확정]
 * 금지구역을 켜면 기본맵 버튼 아래에 범례가 뜬다. 색칩+이름으로 어떤 색이 어떤 구역인지
 * 알려주고, 오른쪽 스위치로 종류별로 따로 껐다 켤 수 있다(둘 다 켜도, 하나만 켜도 된다).
 * **둘 다 꺼도 범례는 남는다** — 다시 켤 수단이 사라지면 안 되기 때문이다(사용자 선택).
 * 스위치는 원래 버튼을 누르지 않고 두 모듈이 새로 내놓은 SetShown() 만 호출한다.
 * 원래 버튼을 눌렀다면 그 모듈이 배경지도를 원래대로 되돌려, 한쪽만 껐을 뿐인데
 * 위성지도가 일반지도로 바뀌는 일이 생긴다.
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

    /**
     * 범례 상자를 띄우거나 감춘다. 띄울 때는 두 스위치를 모두 켠 상태로 되돌린다
     * (원래 버튼이 새로 켜지면서 두 모듈의 _shown 도 true 로 돌아가므로 화면과 맞다).
     * 예: _showLegend(true) → 상자가 기본맵 버튼 아래에 뜨고 두 줄 다 초록 스위치
     * @param {boolean} on - true 띄우기 / false 감추기
     * [연계] ← bind() 의 "금지구역" 버튼 클릭 → _positionLegend()
     */
    function _showLegend(on) {
        var box = document.getElementById('banzone-legend');
        if (!box) return;
        if (on) {
            ['bzl-row-ac', 'bzl-row-fb'].forEach(function (id) {
                var row = document.getElementById(id);
                if (row) row.classList.add('on');
            });
            box.style.display = 'flex';
            _positionLegend();
        } else {
            box.style.display = 'none';
        }
    }

    /**
     * 범례 묶음(#ocean-legend-stack)을 기본맵 버튼 줄 아래에 놓되, 사고정보 모드토글이
     * 떠 있으면 그만큼 더 내린다. 묶음 하나만 움직이면 그 안의 범례들(위험지형·금지구역)이
     * 함께 따라온다.
     * 예: 모드토글이 보이면(실측 높이 34px) margin-top 이 6px → 46px 가 된다
     * [연계] ← _showLegend() · _watchAccidentToggle() · hazard_rocks.js showTerrainLegend()
     *          (window.oceanLegendStackReposition 으로 노출) — 좌측 상단 같은 자리를 쓰는
     *          요소들이 겹치지 않게 한다(accident_info.js 가 필터 바 위치를 실측하는 것과 같은 어법).
     */
    function _positionLegend() {
        var box = document.getElementById('ocean-legend-stack');
        var modeToggle = document.getElementById('ocean-accident-mode-toggle');
        if (!box) return;
        var extra = 0;
        if (modeToggle && modeToggle.offsetParent !== null) {
            extra = modeToggle.offsetHeight + 6;
        }
        box.style.marginTop = (6 + extra) + 'px';
    }
    window.oceanLegendStackReposition = _positionLegend;

    /**
     * 사고정보 모드토글이 나타나거나 사라지면 범례 위치를 다시 잡는다.
     * 예: 금지구역을 먼저 켜 둔 상태에서 사고정보를 켜면, 범례가 모드토글 아래로 내려간다
     * [연계] ← bind() — 표시할 때 한 번만 계산하면 "나중에 사고정보를 켠" 경우를 놓쳐
     *          두 상자가 겹친다(헤드리스 실측으로 확인한 결함). 그래서 style·class 변화를
     *          지켜보다가 그때그때 다시 계산한다.
     */
    function _watchAccidentToggle() {
        var modeToggle = document.getElementById('ocean-accident-mode-toggle');
        if (!modeToggle || modeToggle._bzlWatched || typeof MutationObserver !== 'function') return;
        modeToggle._bzlWatched = true;
        new MutationObserver(function () { _positionLegend(); })
            .observe(modeToggle, { attributes: true, attributeFilter: ['style', 'class'] });
    }

    /**
     * 범례의 두 줄에 스위치 동작을 붙인다(한 번만).
     * 예: "낚시금지구역" 줄을 탭 → 그 줄이 흐려지고 주황 폴리곤만 지도에서 사라진다.
     *     출입통제는 그대로 남고, 배경지도도 위성 그대로다.
     * [연계] ← bind() → window.accessControlSetShown() · window.fishingBanSetShown()
     */
    function _bindLegendRows() {
        [['bzl-row-ac', 'accessControlSetShown'], ['bzl-row-fb', 'fishingBanSetShown']]
            .forEach(function (pair) {
                var row = document.getElementById(pair[0]);
                if (!row || row._bzlBound) return;
                row._bzlBound = true;
                row.addEventListener('click', function () {
                    var on = !row.classList.contains('on');
                    row.classList.toggle('on', on);
                    if (typeof window[pair[1]] === 'function') window[pair[1]](on);
                });
            });
    }

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

        _bindLegendRows();
        _watchAccidentToggle();

        btn.addEventListener('click', function () {
            // 두 레이어의 켜짐 상태를 늘 같게 맞춘다 — 어느 한쪽만 켜져 있는 상태가
            // 생기면 버튼 하나로는 되돌릴 수 없다. 새로 켤지 끌지는 새 버튼 자신의
            // 표시(active)로 정한다.
            var turnOn = !btn.classList.contains('active');
            // [사용량] 원래 버튼 2개를 대신 누르는 동안은 세지 않고, 금지구역 켬 1건만 센다(사용자 확정 2026-09-10).
            var run = window.withUsageSuppressed || function (f) { f(); };
            run(function () {
                if (acBtn.classList.contains('active') !== turnOn) acBtn.click();
                if (fbBtn.classList.contains('active') !== turnOn) fbBtn.click();
            });
            if (turnOn && window.trackUsage) window.trackUsage('safety.ban_zone');
            btn.classList.toggle('active', turnOn);
            _showLegend(turnOn);
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
