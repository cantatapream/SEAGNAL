/**
 * ============================================================================
 * 파일명: client/js/redesign-preview/redesign_preview.js
 * 역할  : 「디자인 미리보기」 스위치. 하단 「해양안전생활」 탭을 3초 안에 10번 누르면
 *         새 디자인(redesign_preview.css)을 앱 전체에 덧씌우고, 다시 10번 누르면 원래대로 돌린다.
 *         기능·데이터는 그대로이고 겉모습만 바뀐다 — 사용자가 새 디자인을 비교해 보려는 시험용이다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : js/redesign-preview/redesign_preview.css (body.rd-preview 아래에만 걸리는 규칙)
 *  - 서버 API      : 없음
 *  - 마크업        : index2.html 하단 메인탭 .tab-btn[data-target="ocean-life-group"]
 *                    · 특보 배지 .status-badge.warning (js/forecast/alerts/render.js 가 그린다)
 *  - 나를 쓰는 곳  : 없음(스스로 붙는다)
 * [로드 순서] js/tutorial/tutorial.js 다음(맨 끝) — 다른 파일이 이 파일을 부르지 않으므로 순서 의존 없음
 * ============================================================================
 */
(function () {
    'use strict';

    var TAP_COUNT     = 10;      // 미리보기를 켜고 끄는 연타 횟수(사용자 확정 2026-10-19 「10회 연타」)
    var TAP_WINDOW_MS = 3000;    // 이 시간 안에 TAP_COUNT 번을 채워야 한다(튜토리얼 5연타와 같은 방식)
    var STORE_KEY     = 'rd_preview_on';   // 이 기기에서 켜 둔 상태를 기억(앱을 다시 열어도 유지)
    var BODY_CLASS    = 'rd-preview';

    var _tapCount = 0;
    var _tapTimer = null;
    var _observer = null;
    var _tagQueued = false;

    /**
     * 특보 배지에 「경보 / 주의보」 구분 표시를 단다.
     * 예: <span class="status-badge warning">풍랑 경보</span> → class 에 rd-lv-alarm 추가
     *     <span class="status-badge warning">풍랑 주의보</span> → rd-lv-advisory 추가
     * 원래 화면은 둘 다 같은 빨강이라 CSS 만으로는 구분할 수 없어서, 글자를 읽어 꼬리표를 붙인다.
     * @returns {void}
     * [연계] ← _queueTag(화면이 바뀔 때마다) / 배지를 만드는 곳: js/forecast/alerts/render.js
     *          꼬리표 색은 redesign_preview.css 의 .rd-lv-alarm·.rd-lv-advisory 가 정한다.
     */
    function _tagWarnBadges() {
        _tagQueued = false;
        var list = document.querySelectorAll('.status-badge.warning:not(.rd-lv-alarm):not(.rd-lv-advisory)');
        for (var i = 0; i < list.length; i++) {
            if (list[i].closest('#main-accordion-header')) continue;   // 머리 요약 배지는 아래에서 따로
            var t = list[i].textContent || '';
            list[i].classList.add(/경보/.test(t) && !/주의보/.test(t) ? 'rd-lv-alarm' : 'rd-lv-advisory');
        }
        _tagHeader();
    }

    /**
     * 「해역별 특보현황」 머리줄과 그 요약 배지(「발효 N건」)를 지금 발효 중인 특보 중 가장 높은 단계 색으로 맞춘다.
     * 예: 풍랑주의보 2건뿐 → 머리줄·배지 주황(rd-hdr-advisory · rd-lv-advisory) / 경보가 1건이라도 → 빨강(rd-lv-alarm)
     * 요약 배지 글자(「발효 2건」)에는 단계가 없어서, 특보 목록(appState.alerts 의 level)을 본다.
     * @returns {void}
     * [연계] ← _tagWarnBadges / appState 는 js/shared/utils/utils.js 의 전역 상태(특보 목록 alerts 는 js/forecast/alerts/ 가 채운다)
     */
    function _tagHeader() {
        var header = document.getElementById('main-accordion-header');
        if (!header) return;
        var alerts = (typeof appState !== 'undefined' && appState && appState.alerts) || [];
        var hasAlarm = alerts.some(function (a) { return a && a.level === '경보'; });
        var badges = header.querySelectorAll('.status-badge.warning');
        for (var i = 0; i < badges.length; i++) {
            badges[i].classList.toggle('rd-lv-alarm', hasAlarm);
            badges[i].classList.toggle('rd-lv-advisory', !hasAlarm);
        }
        header.classList.toggle('rd-hdr-advisory', !hasAlarm);
    }

    /**
     * 화면이 바뀐 직후 한 번만 꼬리표 달기를 예약한다(같은 순간 여러 번 바뀌어도 한 번).
     * 예: 특보 목록을 다시 그리면 수십 개 노드가 바뀌지만 _tagWarnBadges 는 다음 프레임에 1번만 돈다.
     * @returns {void}
     * [연계] ← MutationObserver(_on 이 건다) / → _tagWarnBadges
     */
    function _queueTag() {
        if (_tagQueued) return;
        _tagQueued = true;
        (window.requestAnimationFrame || setTimeout)(_tagWarnBadges);
    }

    /**
     * 미리보기를 켠다 — body 에 rd-preview 를 붙이고, 배지 꼬리표 감시를 시작한다.
     * 예: _on() → <body class="… rd-preview">
     * @returns {void}
     * [연계] ← _toggle·_restore / → _tagWarnBadges, redesign_preview.css 가 body.rd-preview 를 보고 겉모습을 바꾼다
     */
    function _on() {
        document.body.classList.add(BODY_CLASS);
        _tagWarnBadges();
        if (!_observer && window.MutationObserver) {
            _observer = new MutationObserver(_queueTag);
            _observer.observe(document.body, { childList: true, subtree: true });
        }
    }

    /**
     * 미리보기를 끈다 — 원래 디자인으로 돌린다(붙인 꼬리표는 원래 CSS 가 쓰지 않으므로 남아도 영향 없다).
     * 예: _off() → body 에서 rd-preview 제거
     * @returns {void}
     * [연계] ← _toggle
     */
    function _off() {
        document.body.classList.remove(BODY_CLASS);
        if (_observer) { _observer.disconnect(); _observer = null; }
    }

    /**
     * 화면 아래쪽에 잠깐 안내 문구를 띄운다(2.5초 뒤 사라짐).
     * 예: _toast('디자인 미리보기 켜짐')
     * @param {string} msg - 보여 줄 문구
     * @returns {void}
     * [연계] ← _toggle — 켜졌는지 꺼졌는지 사용자가 바로 알게 하기 위해
     */
    function _toast(msg) {
        var el = document.createElement('div');
        el.className = 'rd-toast';
        el.setAttribute('role', 'status');
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 2500);
    }

    /**
     * 켜져 있으면 끄고, 꺼져 있으면 켠다. 상태는 이 기기에 저장한다.
     * 예: 꺼진 상태에서 10연타 → 켜짐 + 「디자인 미리보기 켜짐」 안내
     * @returns {void}
     * [연계] ← _bindTrigger(10연타가 채워졌을 때) / → _on·_off·_toast
     */
    function _toggle() {
        var on = !document.body.classList.contains(BODY_CLASS);
        if (on) _on(); else _off();
        try { localStorage.setItem(STORE_KEY, on ? '1' : '0'); } catch (e) { /* 저장 못 해도 이번 화면에는 적용 */ }
        _toast(on ? '디자인 미리보기 켜짐 · 해양안전생활 탭 10번 누르면 꺼짐' : '디자인 미리보기 꺼짐 · 원래 디자인');
    }

    /**
     * 하단 「해양안전생활」 탭에 연타 감지를 붙인다. 탭 전환 자체는 막지 않는다.
     * 예: 3초 안에 10번 누름 → _toggle / 9번 누르고 3초 쉬면 → 0부터 다시 셈
     * 사용자가 직접 누른 것만 센다 — 다른 코드가 .click() 으로 탭을 옮길 때 잘못 켜지지 않게(튜토리얼과 같은 이유).
     * @returns {void}
     * [연계] ← 이 파일 맨 아래(문서가 준비되면) / → _toggle
     *          대상 버튼: index2.html .tab-btn[data-target="ocean-life-group"]
     */
    function _bindTrigger() {
        var btn = document.querySelector('.tab-btn[data-target="ocean-life-group"]');
        if (!btn) return;
        btn.addEventListener('click', function (e) {
            if (!(e.detail > 0 || e.isTrusted)) return;   // 사용자 클릭만
            _tapCount++;
            clearTimeout(_tapTimer);
            _tapTimer = setTimeout(function () { _tapCount = 0; }, TAP_WINDOW_MS);
            if (_tapCount >= TAP_COUNT) {
                _tapCount = 0;
                clearTimeout(_tapTimer);
                _toggle();
            }
        });
    }

    /**
     * 앱을 다시 열었을 때, 이 기기에서 켜 두었던 미리보기를 되살린다.
     * 예: localStorage rd_preview_on = '1' → _on()
     * @returns {void}
     * [연계] ← 이 파일 맨 아래 / → _on
     */
    function _restore() {
        var on = false;
        try { on = localStorage.getItem(STORE_KEY) === '1'; } catch (e) { /* 저장소 못 쓰면 꺼진 채 */ }
        if (on) _on();
    }

    function _init() { _bindTrigger(); _restore(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _init);
    else _init();
})();
