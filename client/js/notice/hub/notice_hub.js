/**
 * ============================================================================
 * 파일명: client/js/notice/hub/notice_hub.js
 * 역할  : 「뉴스·공지·어황」 탭의 안쪽 탭 3칸(오늘의 뉴스 · 공지사항 · 어황정보)을 바꾸고, 하단 탭을 누를 때 어느 칸부터 보일지 정하고,
 *         칸마다·하단 탭의 N(새 글) 표시를 맞춘다.
 * 사용자 확정(원문은 js/notice/news_hub.design.md §1):
 *   「최근 1일 내 공지사항이 있다면 공지사항 부터 표출, 24시간이 만료되면 뉴스부터 표출.」 — 공지 = 공지사항 탭의 모든 글(어황 자동글 제외, 「맞아」)
 *   N: 공지 = 24시간 안 새 글(종전 규칙 그대로) · 뉴스 = 마지막으로 본 뒤 새 기사 · 어황 = 마지막으로 본 뒤 새 글(「추천대로」)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : notice/board/promo.js(loadPromoPosts — 공지 목록 · updateNewBadges 가 window.NoticeHub.setNoticeNew 를 부른다)
 *                    · notice/news/news.js(window.NewsTab) · notice/fishcond/fishcond.js(window.FishcondTab)
 *  - 서버 API      : GET /api/promo(앱이 켜질 때 공지 N 판정 — 목록은 그리지 않는다)
 *  - 마크업        : index2.html #nhub-tabs(.nhub-tab[data-nhub]) · #nhub-news · #nhub-notice · #nhub-fishcond · 하단 .tab-btn[data-target="promo-section"]
 *  - 나를 쓰는 곳  : promo.js updateNewBadges(setNoticeNew) · 하단 탭이 이 탭으로 바뀜(core/index2_patch.js switchMainTab 이 body[data-active-tab] 을 바꾸면 이 파일이 본다)
 * [로드 순서] notice/fishcond/fishcond.js 다음 — 순서 변경 금지(NewsTab·FishcondTab 이 먼저 있어야 한다)
 * ============================================================================
 */
(function (w) {
    'use strict';
    var ONE_DAY = 24 * 3600000;
    var cur = null;                 // 지금 보이는 칸
    var noticeNew = null;           // 공지 24시간 안 새 글이 있나(null = 아직 모름)
    var pendingChoose = false;      // 하단 탭을 눌렀는데 공지 판정을 기다리는 중
    var chooseTimer = null;
    var badge = { news: false, notice: false, fishcond: false };

    function tabBtn(name) { return document.querySelector('#nhub-tabs .nhub-tab[data-nhub="' + name + '"]'); }
    function mkBadge() { var b = document.createElement('span'); b.className = 'new-badge'; b.textContent = 'N'; return b; }

    /** 칸마다·하단 탭의 N 을 다시 단다. 하단 탭 = 세 칸 중 하나라도 새 글. [연계] ← setNoticeNew · show · 시작 */
    function refresh() {
        ['news', 'notice', 'fishcond'].forEach(function (n) {
            var b = tabBtn(n); if (!b) return;
            var old = b.querySelector('.new-badge'); if (old) old.remove();
            if (badge[n]) b.appendChild(mkBadge());
        });
        var main = document.querySelector('.main-tabs .tab-btn[data-target="promo-section"]');
        if (!main) return;
        var o = main.querySelector('.new-badge'); if (o) o.remove();
        if (badge.news || badge.notice || badge.fishcond) (main.querySelector('.tab-btn-label') || main).appendChild(mkBadge());   // 라벨 안에 — 하단 탭 높이가 변하지 않게(종전 promo.js 와 같은 까닭)
    }

    /**
     * 칸을 보인다. 뉴스·어황은 보일 때 목록을 받는다(그리고 「봤다」고 적어 N 을 끈다). 공지 목록은 promo.js 가 하단 탭 누름 때 이미 받는다.
     * @param {'news'|'notice'|'fishcond'} name
     * [연계] ← 칸 누름 · choose / → NewsTab.open · FishcondTab.open
     */
    function show(name) {
        cur = name;
        ['news', 'notice', 'fishcond'].forEach(function (n) {
            var b = tabBtn(n), p = document.getElementById('nhub-' + n);
            if (b) { b.classList.toggle('active', n === name); b.setAttribute('aria-selected', n === name ? 'true' : 'false'); }
            if (p) p.classList.toggle('active', n === name);
        });
        if (name === 'news' && w.NewsTab) { badge.news = false; w.NewsTab.open(); }
        if (name === 'fishcond' && w.FishcondTab) { badge.fishcond = false; w.FishcondTab.open(); }
        refresh();
    }

    /** 처음 보일 칸 — 24시간 안 공지가 있으면 공지사항, 없으면 오늘의 뉴스. */
    function choose() { pendingChoose = false; clearTimeout(chooseTimer); show(noticeNew ? 'notice' : 'news'); }

    /** 하단 탭을 눌렀다 — 누를 때마다 위 규칙으로 고른다. 공지 판정을 아직 모르면 promo.js 가 목록을 받을 때까지(최대 3초) 기다린다. */
    function onMainOpen() {
        if (noticeNew !== null) { choose(); return; }
        pendingChoose = true;
        ['news', 'notice', 'fishcond'].forEach(function (n) { var p = document.getElementById('nhub-' + n); if (p) p.classList.remove('active'); });
        clearTimeout(chooseTimer);
        chooseTimer = setTimeout(function () { if (pendingChoose) choose(); }, 3000);   // 공지 목록을 못 받으면 뉴스부터(빈 화면으로 두지 않는다)
    }

    /** 공지 글 목록에서 24시간 안 새 글이 있나. 예: hasRecent([{createdAt:'2026.11.21 08:00'}], now) → true */
    function hasRecent(posts, now) {
        return (posts || []).some(function (p) {
            if (!p || !p.createdAt) return false;
            var t = new Date(String(p.createdAt).replace(/\./g, '-')).getTime();
            return isFinite(t) && now - t >= 0 && now - t < ONE_DAY;
        });
    }

    w.NoticeHub = {
        /**
         * 공지 24시간 안 새 글 여부를 받는다(promo.js updateNewBadges 가 목록을 받을 때마다 부른다).
         * @param {boolean} v [연계] ← promo.js updateNewBadges / 시작 때 prefetch
         */
        setNoticeNew: function (v) { noticeNew = !!v; badge.notice = !!v; if (pendingChoose) choose(); else refresh(); },
        show: show, refresh: refresh, hasRecent: hasRecent,
        current: function () { return cur; },
    };

    function init() {
        Array.prototype.forEach.call(document.querySelectorAll('#nhub-tabs .nhub-tab'), function (b) {
            b.addEventListener('click', function () { show(b.getAttribute('data-nhub')); });
        });
        // 하단 탭이 이 탭으로 바뀔 때마다 — 누름·딥링크·switchMainTab 어느 길이든 core/index2_patch.js 가 body[data-active-tab] 을 바꾼다(그것을 본다)
        var last = document.body.getAttribute('data-active-tab');
        if (last === 'promo-section') onMainOpen();
        new MutationObserver(function () {
            var now = document.body.getAttribute('data-active-tab');
            if (now === 'promo-section' && last !== 'promo-section') onMainOpen();
            last = now;
        }).observe(document.body, { attributes: true, attributeFilter: ['data-active-tab'] });
        // 앱이 켜지고 잠시 뒤 — 세 칸의 N 을 미리 알아 둔다(하단 탭 N). 첫 화면을 그리는 일을 막지 않게 늦춘다.
        setTimeout(function () {
            var base = (w.CONFIG && w.CONFIG.API_BASE) || '';
            fetch(base + '/api/promo').then(function (r) { return r.ok ? r.json() : null; }).then(function (posts) {
                if (Array.isArray(posts) && noticeNew === null) w.NoticeHub.setNoticeNew(hasRecent(posts, Date.now()));
            }).catch(function (e) { console.warn('[뉴스·공지·어황] 공지 새 글 확인 실패:', e && e.message); });
            if (w.NewsTab) w.NewsTab.prefetch().then(function (v) { if (cur !== 'news') { badge.news = !!v; refresh(); } });
            if (w.FishcondTab) w.FishcondTab.prefetch().then(function (v) { if (cur !== 'fishcond') { badge.fishcond = !!v; refresh(); } });
        }, 4000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window);
