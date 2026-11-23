/**
 * ============================================================================
 * 파일명: client/js/pc-layout/pc_layout.js
 * 역할  : PC 화면(A안 · 지도 중심형)을 켜고 끈다 — 넓은 PC 브라우저에서 「해양종합정보」 탭을 10번 누르면 켜진다.
 *         (마우스를 쓰는 1200px 이상 창에서 3초 안에 10번 누르면 body.pc-mode 가 붙어 화면이
 *          「위 막대 · 왼쪽 메뉴 · 가운데 지도 · 오른쪽 칸」으로 바뀐다. 저장하지 않는다 — 새로고침하면 원래 화면.)
 * ----------------------------------------------------------------------------
 * [사용자 확정 2026-11-23~24 — 원문]
 *  「a안이 좋겠어 … 해양종합정보를 10회 터치하여야만 들어갈 수 있도록」
 *  「휴대폰에서는 표출하지말고 pc에서만 10회누르면 나타나는 것으로」
 *  「새모드는 저장하지 않음. 껐다 켜면 원래대로.(일반 사용자에게 영향 없도록)」
 *  (추가) 태블릿·터치 기기는 PC 로 보지 않는다(마우스를 쓰는 넓은 브라우저 창만).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : js/pc-layout/pc_layout.css(body.pc-mode 아래 배치 전부) ·
 *                    js/pc-layout/pc_alert_map.js(window.PcAlertMap — 특보 전용 지도) ·
 *                    js/ocean-map/menu/ocean_menu.js(window.OceanMenu.close — 켤 때 열린 사이드바를 닫는다) ·
 *                    core/index2_patch.js(window._showOceanToast — 안내) ·
 *                    forecast/alerts/marine.js(window.switchMainTab — 알약) ·
 *                    notice/hub/notice_hub.js(window.NoticeHub._ptr.refresh — 뉴스 칸 새로 받기) ·
 *                    ocean-map/map/ocean_map.js(window.getOceanMap — ＋−) ·
 *                    forecast/alerts/render.js(.alert-card[data-zone] · #main-accordion-header .header-status 를 그린다)
 *  - 서버 API      : 없음
 *  - 마크업        : index2.html #bottom-tab-bar · .main-header .header-utility-bar · #ocean-map-section ·
 *                    #weather-alert-section · #alert-content · #promo-section · #om-sidebar(ocean_menu.js 가 만든다)
 *  - 나를 쓰는 곳  : 없음 — 페이지가 뜰 때 #bottom-tab-bar 에 누름 리스너 하나만 붙인다.
 *                    window.PcLayout 은 시험(local_server/scripts/test_pc_layout_ui.js)·점검용.
 * [로드 순서] js/pc-layout/pc_alert_map.js 다음(그 파일은 js/ocean-map/menu/ocean_menu.js 다음) — 순서 변경 금지
 * ============================================================================
 *
 * [지키는 것 — 상세는 js/pc-layout/README.md 「수정 시 주의」]
 *  · 꺼져 있을 때 0 영향: 페이지가 뜰 때 붙이는 것은 탭 줄 리스너 하나. 요소·관찰자·나머지 리스너는 처음 켤 때 만든다.
 *  · 저장 안 함: localStorage·sessionStorage·URL·history 에 쓰지 않는다.
 *  · 기존 버튼을 프로그램으로 누르지 않는다(.click() 금지) — 버튼이 스스로 저장·집계하므로 새어 나간다.
 *  · 새 단추가 부르는 것은 넷뿐: switchMainTab('weather-group') · NoticeHub._ptr.refresh() · 지도 확대·축소 · disarm.
 */
(function () {
    'use strict';

    var PC_MIN_W = 1200;        // 이보다 좁은 창에서는 켜지지 않는다(켠 뒤 줄이면 평소 화면으로 쉬었다가 넓히면 돌아온다)
    var PC_TAPS = 10;           // 「해양종합정보」 탭을 몇 번 눌러야 하나
    var PC_GAP_MS = 3000;       // 누름 사이가 이보다 길면 처음부터 다시 센다

    var _pcTaps = 0, _pcLastTap = 0;
    var _armed = false;         // 이번 실행에서 10번 누름으로 켜 둔 상태(메모리에만)
    var _on = false;            // 지금 body.pc-mode 가 실제로 붙어 있나 — 언제나 _on === (_armed && _canShow())
    var _built = false;

    /**
     * 이 기기를 PC(마우스를 쓰는 데스크톱 브라우저)로 볼지 판정한다. 앱·터치가 되는 기기는 PC 가 아니다.
     * 예: 데스크톱 크롬 + 마우스 → true · 휴대폰·태블릿·터치 화면 노트북 → false
     * @returns {boolean}
     * [연계] ← _canShow() / 판정은 이 파일 한 곳에만 둔다(CSS 는 @media 를 쓰지 않는다)
     */
    function _isPcDevice() {
        var cap = window.Capacitor;
        if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) return false;   // 앱
        if (navigator.maxTouchPoints > 0) return false;                                                   // 터치가 되는 기기
        if (!window.matchMedia) return false;
        if (window.matchMedia('(any-pointer: coarse)').matches) return false;                             // 손가락 입력이 하나라도 있음
        return window.matchMedia('(hover: hover) and (pointer: fine)').matches;                           // 주 입력이 마우스
    }

    /**
     * 지금 PC 배치를 보여 줄 수 있는가 — PC 기기 + 창 폭 1200 이상 + 통합 메뉴 화면(body.om-mode).
     * 예: 1440 폭 데스크톱 → true · 같은 창을 1100 으로 줄이면 → false
     * @returns {boolean}
     * [연계] ← _onTabClick()·_apply()
     */
    function _canShow() {
        return _isPcDevice() && window.innerWidth >= PC_MIN_W && document.body.classList.contains('om-mode');
    }

    /** 공용 토스트로 안내한다(있을 때만). 예: _toast('원래 화면으로 돌아왔습니다', 1800)  @param {string} msg @param {number} ms
     *  [연계] → core/index2_patch.js _showOceanToast */
    function _toast(msg, ms) {
        if (typeof window._showOceanToast === 'function') window._showOceanToast(msg, 'bottom', ms);
    }

    /**
     * 화면 크기가 바뀐 것처럼 resize 를 0ms 뒤와 400ms 뒤 두 번 보낸다 — 지도들이 칸 크기를 다시 재고,
     * 탭 높이 값(<html> 의 --main-tab-height)이 다시 맞춰진다.
     * 예: 끈 직후 _kick() → 400ms 뒤 --main-tab-height 가 실제 탭 줄 높이(67px)
     * [연계] ← _apply() / 왜 두 번인가: 한 번이면 탭 버튼의 transition(.2s) 도중에 재서 48px 로 굳는다(실측)
     */
    function _kick() {
        [0, 400].forEach(function (ms) {
            setTimeout(function () { window.dispatchEvent(new Event('resize')); }, ms);
        });
    }

    /**
     * 「켜 둠(_armed) + 보여 줄 수 있음」에 맞춰 body.pc-mode 를 붙이거나 뗀다. 바뀌지 않으면 아무것도 안 한다.
     * 예: 켜 둔 채 창을 1100 으로 줄임 → resize → pc-mode 떨어짐(_armed 는 그대로) · 다시 넓힘 → 붙음
     * [연계] ← arm()·disarm()·window 'resize'(처음 켤 때 붙인다) / → _build()·_afterTab()·_kick()·OceanMenu.close()
     */
    function _apply() {
        var want = _armed && _canShow();
        if (want === _on) return;
        _on = want;
        var side = document.getElementById('om-sidebar');
        if (want) {
            if (window.OceanMenu && typeof window.OceanMenu.close === 'function') window.OceanMenu.close();   // 열린 사이드바(덮개·뒤로가기 목록)를 먼저 정리
            if (!_built) { _build(); window.addEventListener('resize', _apply); }
            document.body.classList.add('pc-mode');
            if (side) side.setAttribute('aria-hidden', 'false');
            _afterTab();
        } else {
            document.body.classList.remove('pc-mode');
            if (side) side.setAttribute('aria-hidden', 'true');
        }
        _kick();
    }

    /** PC 화면을 켠다. 예: arm(true) → 켜지고 안내 A  @param {boolean} toast - 안내를 띄울지  [연계] ← _onTabClick()·window.PcLayout */
    function arm(toast) {
        _armed = true;
        _apply();
        if (toast) _toast('PC 화면으로 바뀌었습니다 · 새로고침(F5)하면 원래 화면으로 돌아갑니다', 3500);
    }

    /** PC 화면을 끈다. 예: disarm(true) → 원래 화면 + 안내 B  @param {boolean} toast - 안내를 띄울지  [연계] ← _onTabClick()·#pc-exit·window.PcLayout */
    function disarm(toast) {
        _armed = false;
        _apply();
        if (toast) _toast('원래 화면으로 돌아왔습니다', 1800);
    }

    /**
     * 아래 탭 줄의 누름을 센다 — 「해양종합정보」를 3초 안에 10번이면 켜고(켜져 있으면 끈다), 다른 탭이 끼면 처음부터.
     * 기존 탭 동작은 막지 않는다(preventDefault·stopPropagation 을 부르지 않는다).
     * 예: 1440 데스크톱에서 10번 → arm(true) · 휴대폰에서 10번 → 아무 일도 없음
     * @param {MouseEvent} e
     * [연계] ← #bottom-tab-bar 'click'(bubble, 페이지가 뜰 때 붙임) / → arm()·disarm()·_canShow()
     */
    function _onTabClick(e) {
        var btn = e.target && e.target.closest ? e.target.closest('.tab-btn') : null;
        if (!btn) return;
        if (btn.getAttribute('data-target') !== 'ocean-map-section') { _pcTaps = 0; return; }
        var now = Date.now();
        if (now - _pcLastTap > PC_GAP_MS) _pcTaps = 0;
        _pcLastTap = now;
        _pcTaps++;
        if (_pcTaps < PC_TAPS) return;
        _pcTaps = 0;
        if (_armed) disarm(true);
        else if (!_canShow()) return;          // 휴대폰·태블릿·터치 노트북·좁은 창 — 조용히 아무 일도 없다
        else arm(true);
    }

    /** 요약 알약에 특보정보 머리의 요약 배지(「발효 n건」 등)를 그대로 베낀다.  [연계] ← _build()·MutationObserver / 원본은 forecast/alerts/render.js 가 그린다 */
    function _copyPill() {
        var pill = document.getElementById('pc-pill');
        var src = document.querySelector('#main-accordion-header .header-status');
        if (pill && src) pill.innerHTML = src.innerHTML;
    }

    /**
     * 「특보 및 전망」 화면이 지금 보이면 전용 지도를 준비한다(처음이면 만들고, 있으면 크기·색을 다시 맞춘다).
     * 예: PC 화면에서 특보정보 탭으로 옮김 → #weather-alert-section 에 active → PcAlertMap.ensure()
     * [연계] ← _apply()·MutationObserver(#weather-alert-section 의 class) / → js/pc-layout/pc_alert_map.js ensure
     *          body[data-active-tab] 이 아니라 섹션의 class 를 보는 까닭: [해상일기도]↔[특보 및 전망] 은 그 속성이 안 바뀐다
     */
    function _afterTab() {
        var sec = document.getElementById('weather-alert-section');
        if (_on && sec && sec.classList.contains('active') && window.PcAlertMap) window.PcAlertMap.ensure();
    }

    /**
     * 특보 카드를 누르면 전용 지도가 그 해역으로 간다. 카드 안 단추·연안·부이 칸을 누른 것은 건드리지 않는다.
     * 예: 「동해중부앞바다」 카드 머리를 누름 → PcAlertMap.focus('동해중부앞바다')
     * @param {MouseEvent} e
     * [연계] ← #alert-content 'click'(capture — 카드 리스너가 stopPropagation 을 한다, render.js) / → pc_alert_map.js focus
     */
    function _onAlertCardClick(e) {
        if (!_on) return;
        var card = e.target.closest('.alert-card');
        if (!card) return;
        if (e.target.closest('button, .coastal-item, .buoy-info-area')) return;
        var z = card.getAttribute('data-zone');
        if (z && window.PcAlertMap) window.PcAlertMap.focus(z);
    }

    /** ＋− 를 누르면 해양종합정보 지도를 한 단계 확대·축소한다. 예: ＋ → 줌 7 → 8  @param {MouseEvent} e  [연계] → ocean-map/map/ocean_map.js window.getOceanMap */
    function _onZoom(e) {
        var b = e.target.closest('[data-pc-zoom]');
        if (!b) return;
        var m = window.getOceanMap && window.getOceanMap();
        if (m) { var v = m.getView(); v.animate({ zoom: v.getZoom() + Number(b.getAttribute('data-pc-zoom')), duration: 200 }); }
    }

    /**
     * 처음 켤 때 한 번 — PC 화면에만 쓰는 요소(전부 id 가 pc- 로 시작)를 만들고 관찰자·리스너를 붙인다.
     * 예: _build() → .header-utility-bar 맨 앞에 #pc-pill, 맨 뒤에 #pc-exit, body 에 #pc-side-hint …
     * [연계] ← _apply() / → _copyPill()·_afterTab()·_onAlertCardClick()·_onZoom()·disarm()
     */
    function _build() {
        _built = true;
        var bar = document.querySelector('.main-header .header-utility-bar');
        var mk = function (tag, id, html) { var el = document.createElement(tag); el.id = id; if (html != null) el.innerHTML = html; return el; };

        var pill = mk('button', 'pc-pill');
        pill.type = 'button';
        pill.title = '특보정보로 가기';
        pill.addEventListener('click', function () { if (typeof window.switchMainTab === 'function') window.switchMainTab('weather-group'); });
        var exit = mk('button', 'pc-exit', '원래 화면으로');
        exit.type = 'button';
        exit.addEventListener('click', function () { disarm(true); });
        if (bar) { bar.insertBefore(pill, bar.firstChild); bar.appendChild(exit); }
        _copyPill();
        var status = document.querySelector('#main-accordion-header .header-status');
        if (status) new MutationObserver(_copyPill).observe(status, { childList: true, subtree: true, characterData: true });

        document.body.appendChild(mk('div', 'pc-side-hint',
            '<span class="pc-hint-main">지도에서 바다를 누르면 그 지점의 날씨·물때가 이곳에 나옵니다</span>' +
            '<span class="pc-hint-view">지도에서 지점·구역을 누르면 상세 정보가 나옵니다</span>'));

        var mapSec = document.getElementById('ocean-map-section');
        if (mapSec) {
            var zoom = mk('div', 'pc-zoom',
                '<button type="button" data-pc-zoom="1" aria-label="확대">＋</button>' +
                '<button type="button" data-pc-zoom="-1" aria-label="축소">−</button>');
            zoom.addEventListener('click', _onZoom);
            mapSec.appendChild(zoom);
        }

        var promo = document.getElementById('promo-section');
        if (promo) {
            promo.appendChild(mk('div', 'pc-read-hint', '목록에서 글을 누르면 이 자리에서 읽습니다. 오늘의 뉴스는 카드를 한 번 더 누르면 기사 원문이 새 창으로 열립니다'));
            var refresh = mk('button', 'pc-news-refresh', '↻ 새로 받기');
            refresh.type = 'button';
            refresh.addEventListener('click', function () { if (window.NoticeHub && window.NoticeHub._ptr) window.NoticeHub._ptr.refresh(); });
            promo.appendChild(refresh);
        }

        var wsec = document.getElementById('weather-alert-section');
        if (wsec) new MutationObserver(_afterTab).observe(wsec, { attributes: true, attributeFilter: ['class'] });
        // 「해역별 특보현황」 머리는 요약 배지가 많으면 두 줄이 된다(settings.js 의 전역 규칙) — 몸통이 그 바로 아래에서 시작하게 높이를 알려 준다(pc_layout.css --pc-acc-h)
        var head = document.getElementById('main-accordion-header');
        if (head && window.ResizeObserver) new ResizeObserver(function () { if (head.offsetHeight) document.body.style.setProperty('--pc-acc-h', head.offsetHeight + 'px'); }).observe(head);
        var alerts = document.getElementById('alert-content');
        if (alerts) alerts.addEventListener('click', _onAlertCardClick, true);
    }

    document.addEventListener('DOMContentLoaded', function () {
        var tabs = document.getElementById('bottom-tab-bar');
        if (tabs) tabs.addEventListener('click', _onTabClick);
    });

    /** 시험·점검용 창구 — 화면 코드는 쓰지 않는다. [연계] ← local_server/scripts/test_pc_layout_ui.js */
    window.PcLayout = {
        isArmed: function () { return _armed; },
        isOn: function () { return _on; },
        arm: arm,
        disarm: disarm
    };
})();
