/**
 * ============================================================================
 * 파일명: client/js/shared/ui/pull_refresh.js
 * 역할  : 「당겨서 새로고침」 — 화면 맨 위에서 손가락으로 아래로 당겼다 놓으면 파란 동그라미가 돌며 목록을 다시 받는다.
 *         어느 화면에서 쓸지·무엇을 다시 받을지는 쓰는 쪽이 정한다(지금은 「뉴스·공지·어황」 세 칸).
 * 사용자 확정(2026-11-22, 원문은 js/notice/news_hub.design.md): 「아래로 내려서 당기는 모션이 반영되는 것은 오늘의 뉴스, 공지사항, 그리고 어항 정보」
 *   — 보낸 그림처럼 위쪽에 연한 파란 띠 + 파란 동그라미.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : 없음
 *  - 마크업        : 쓰는 쪽이 띠(indicator) 요소를 준다 — index2.html #nhub-ptr
 *  - 나를 쓰는 곳  : notice/hub/notice_hub.js(window.PullRefresh.attach)
 *  - 스타일        : style.css .ptr
 * [로드 순서] notice/news/news.js 이전(그보다 앞이면 어디든) — notice_hub.js 가 시작할 때 window.PullRefresh 를 쓴다
 * ============================================================================
 */
(function (w) {
    var PULL_MAX = 90;      // 띠가 늘어나는 최대 높이(px)
    var TRIGGER = 60;       // 이만큼 당긴 뒤 놓으면 새로고침
    var MIN_SPIN_MS = 600;  // 너무 빨리 끝나도 동그라미가 돈 것을 볼 수 있게

    /**
     * 화면에 당겨서 새로고침을 붙인다.
     * 예: PullRefresh.attach({ area: document.getElementById('promo-section'), indicator: document.getElementById('nhub-ptr'),
     *                          enabled: () => body 가 그 탭일 때, onRefresh: () => fetch(...) })
     * @param {{area:HTMLElement, indicator:HTMLElement, enabled:function():boolean, onRefresh:function():Promise}} o
     *   area = 손가락이 닿으면 따라가는 범위 · enabled = 지금 받을 때인가(그 탭이 보이고 팝업이 없을 때) · onRefresh = 다시 받기(끝나면 띠를 접는다)
     * @returns {{refresh:function():Promise}} 손으로 당긴 것과 같은 새로고침(검사용)
     * [연계] ← notice_hub.init
     */
    function attach(o) {
        var ind = o.indicator, icon = ind.querySelector('i');
        var startY = null, startX = 0, pull = 0, busy = false, decided = false;
        var top = function () { return (w.scrollY || document.documentElement.scrollTop || 0) <= 0; };
        var set = function (h, anim) {
            ind.style.transition = anim ? 'height 0.2s ease' : 'none';
            ind.style.height = h + 'px';
            if (icon && !busy) icon.style.transform = 'rotate(' + Math.round(h * 4) + 'deg)';
            ind.classList.toggle('ready', h >= TRIGGER);
        };
        var refresh = function () {
            if (busy) return Promise.resolve();
            busy = true; ind.classList.add('spin'); set(TRIGGER, true);
            var t0 = Date.now();
            var p;
            try { p = Promise.resolve(o.onRefresh()); } catch (e) { p = Promise.reject(e); }
            return p.catch(function (e) { console.warn('[당겨서 새로고침] 다시 받기 실패:', e && e.message); })
                .then(function () { return new Promise(function (r) { setTimeout(r, Math.max(0, MIN_SPIN_MS - (Date.now() - t0))); }); })
                .then(function () { busy = false; ind.classList.remove('spin'); set(0, true); });
        };
        o.area.addEventListener('touchstart', function (e) {
            startY = null;
            if (busy || e.touches.length !== 1 || !o.enabled() || !top()) return;
            startY = e.touches[0].clientY; startX = e.touches[0].clientX; pull = 0; decided = false;
        }, { passive: true });
        o.area.addEventListener('touchmove', function (e) {
            if (startY === null) return;
            var dy = e.touches[0].clientY - startY, dx = e.touches[0].clientX - startX;
            if (!decided) {
                if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
                decided = true;
                if (Math.abs(dx) > Math.abs(dy) || dy < 0 || !top()) { startY = null; return; }   // 옆으로 밀기·위로 밀기는 평소 스크롤
            }
            if (dy <= 0) { pull = 0; set(0); return; }
            if (e.cancelable) e.preventDefault();   // 당기는 동안 화면이 같이 끌려가지 않게
            pull = Math.min(PULL_MAX, dy * 0.5);
            set(pull);
        }, { passive: false });
        var end = function () {
            if (startY === null) return;
            startY = null;
            if (pull >= TRIGGER) refresh(); else set(0, true);
            pull = 0;
        };
        o.area.addEventListener('touchend', end, { passive: true });
        o.area.addEventListener('touchcancel', function () { startY = null; pull = 0; if (!busy) set(0, true); }, { passive: true });   // 시스템이 끊은 손짓은 새로고침하지 않는다
        return { refresh: refresh };
    }

    w.PullRefresh = { attach: attach, TRIGGER: TRIGGER };
})(window);
