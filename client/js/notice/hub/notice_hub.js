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
 *                    · shared/ui/pull_refresh.js(window.PullRefresh — 세 칸 당겨서 새로고침, 사용자 2026-11-22 「오늘의 뉴스, 공지사항, 그리고 어항 정보」)
 *  - 서버 API      : GET /api/promo(앱이 켜질 때 공지 N 판정 — 목록은 그리지 않는다)
 *  - 마크업        : index2.html .nhub-head(고정 머리 — 오늘의 뉴스면 on-news 로 날짜줄 #news-dateline 을 보인다) · #nhub-tabs(.nhub-tab[data-nhub]) · #nhub-ptr(당겨서 새로고침 띠) · #nhub-news · #nhub-notice · #nhub-fishcond · 하단 .tab-btn[data-target="promo-section"]
 *  - 나를 쓰는 곳  : promo.js updateNewBadges(setNoticeNew) · 하단 탭이 이 탭으로 바뀜(core/index2_patch.js switchMainTab 이 body[data-active-tab] 을 바꾸면 이 파일이 본다)
 * [로드 순서] notice/fishcond/fishcond.js 다음 — 순서 변경 금지(NewsTab·FishcondTab 이 먼저 있어야 한다)
 * ============================================================================
 */
(function (w) {
    'use strict';
    var ONE_DAY = 24 * 3600000;
    var cur = null;                 // 지금 보이는 칸
    var noticeNew = null;           // 공지 24시간 안 새 글이 있나(null = 아직 모름)
    var pendingChoose = false;      // 하단 탭을 열고 새 공지 판정을 기다리는 중(오면 그 값으로 칸을 다시 고른다)
    var userPicked = false;         // 이번에 연 뒤 사용자가 칸을 직접 골랐다 — 늦게 온 판정이 덮지 않는다
    var picked = null;              // pick() 이 탭 바뀜 알림보다 먼저 온 경우 { name, at } — 그 알림이 와도 이 칸을 지킨다
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
        // 뉴스 날짜줄은 고정된 머리(.nhub-head) 안에 있다 — 오늘의 뉴스 칸일 때만 보이게(사용자 2026-11-22 「뉴스에서 날짜 부분도 고정되었으면」)
        var head = document.querySelector('#promo-section .nhub-head'); if (head) head.classList.toggle('on-news', name === 'news');
        if (name === 'news' && w.NewsTab) { badge.news = false; w.NewsTab.open(); }
        if (name === 'fishcond' && w.FishcondTab) { badge.fishcond = false; w.FishcondTab.open(); }
        refresh();
    }

    /** 처음 보일 칸 — 24시간 안 공지가 있으면 공지사항, 없으면 오늘의 뉴스. */
    function ruleTab() { return noticeNew ? 'notice' : 'news'; }

    /**
     * 하단 탭이 이 탭으로 바뀌었다 — 열 때마다 위 규칙으로 고른다.
     *   지금 아는 판정(없으면 뉴스)으로 바로 보이고(빈 화면 없음), promo.js 가 공지 목록을 새로 받아 판정이 오면(최대 5초) 그 값으로 한 번 더 고른다.
     *   그사이 사용자가 칸을 직접 골랐으면 덮지 않는다.
     *   (별도 에이전트 검토 2026-11-21: 종전에는 ① 지난번 판정으로 바로 골라 새 공지가 있어도 뉴스부터 떴고 ② 판정을 기다리는 동안 사용자가 고른 칸을 늦게 온 판정이 덮었고
     *    ③ 공지 목록을 못 받으면 3초 동안 세 칸이 모두 빈 화면이었다 — 셋 다 실행으로 재현)
     */
    function onMainOpen() {
        if (picked && Date.now() - picked.at < 1500) { var n = picked.name; picked = null; userPicked = true; pendingChoose = false; show(n); return; }
        picked = null;
        userPicked = false;
        pendingChoose = true;
        show(ruleTab());
        clearTimeout(chooseTimer);
        chooseTimer = setTimeout(function () { pendingChoose = false; }, 5000);
    }

    /** 공지 글 목록에서 24시간 안 새 글이 있나 — 한국 시각으로 읽는다(promo.js promoKstMs). 예: hasRecent([{createdAt:'2026.11.21 08:00'}], now) → true */
    function hasRecent(posts, now) {
        var parse = w.promoKstMs || function () { return NaN; };
        return (posts || []).some(function (p) {
            if (!p || !p.createdAt) return false;
            var t = parse(p.createdAt);
            return isFinite(t) && now - t >= 0 && now - t < ONE_DAY;
        });
    }

    w.NoticeHub = {
        /**
         * 공지 24시간 안 새 글 여부를 받는다(promo.js updateNewBadges 가 목록을 받을 때마다 부른다).
         * @param {boolean} v [연계] ← promo.js updateNewBadges / 시작 때 prefetch
         */
        setNoticeNew: function (v) {
            noticeNew = !!v; badge.notice = !!v;
            if (pendingChoose && !userPicked) { pendingChoose = false; clearTimeout(chooseTimer); if (cur !== ruleTab()) { show(ruleTab()); return; } }
            refresh();
        },
        /** 칸을 직접 고른 것으로 친다(늦게 온 판정이 덮지 않음). 예: 공지 팝업의 「게시글로 이동」이 글을 열 때 pick('notice'). [연계] ← promo.js openPromoDetail */
        pick: function (name) { userPicked = true; pendingChoose = false; picked = { name: name, at: Date.now() }; if (cur !== name) show(name); },
        show: show, refresh: refresh, hasRecent: hasRecent,
        current: function () { return cur; },
    };

    function init() {
        var tabs = Array.prototype.slice.call(document.querySelectorAll('#nhub-tabs .nhub-tab'));
        tabs.forEach(function (b, i) {
            b.setAttribute('aria-controls', 'nhub-' + b.getAttribute('data-nhub'));
            b.addEventListener('click', function () { userPicked = true; pendingChoose = false; show(b.getAttribute('data-nhub')); });
            b.addEventListener('keydown', function (e) {   // 방향키로 칸 옮기기(탭 줄 관례)
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                e.preventDefault();
                var t = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
                t.focus(); t.click();
            });
        });
        // 하단 탭이 이 탭으로 바뀔 때마다 — 누름·딥링크·switchMainTab 어느 길이든 core/index2_patch.js 가 body[data-active-tab] 을 바꾼다(그것을 본다)
        var last = document.body.getAttribute('data-active-tab');
        if (last === 'promo-section') onMainOpen();
        new MutationObserver(function () {
            var now = document.body.getAttribute('data-active-tab');
            if (now === 'promo-section' && last !== 'promo-section') onMainOpen();
            last = now;
        }).observe(document.body, { attributes: true, attributeFilter: ['data-active-tab'] });
        // 당겨서 새로고침 — 이 탭이 보이고 팝업이 없을 때, 지금 보이는 칸만 다시 받는다(뉴스는 서버가 모아 둔 것을 다시 받을 뿐 새로 수집하지 않는다)
        var ptr = document.getElementById('nhub-ptr'), sec = document.getElementById('promo-section');
        if (ptr && sec && w.PullRefresh) {
            w.NoticeHub._ptr = w.PullRefresh.attach({
                area: sec, indicator: ptr,
                enabled: function () {
                    if (document.body.getAttribute('data-active-tab') !== 'promo-section') return false;
                    if (w.PopupStack && w.PopupStack.size && w.PopupStack.size() > 0) return false;
                    return !Array.prototype.some.call(document.querySelectorAll('.modal:not(.hidden)'), function (m) { return m.offsetParent !== null; });
                },
                onRefresh: function () {
                    if (cur === 'news' && w.NewsTab) return w.NewsTab.refresh();
                    if (cur === 'fishcond' && w.FishcondTab) return w.FishcondTab.refresh();
                    if (cur === 'notice' && typeof w.loadPromoPosts === 'function') return w.loadPromoPosts();
                    return Promise.resolve();
                },
            });
        }
        // 앱이 켜지고 잠시 뒤 — 세 칸의 N 을 미리 알아 둔다(하단 탭 N). 첫 화면을 그리는 일을 막지 않게 늦춘다.
        var refreshBadges = function () {
            var base = (w.CONFIG && w.CONFIG.API_BASE) || '';
            fetch(base + '/api/promo').then(function (r) { return r.ok ? r.json() : null; }).then(function (posts) {
                if (Array.isArray(posts)) w.NoticeHub.setNoticeNew(hasRecent(posts, Date.now()));
            }).catch(function (e) { console.warn('[뉴스·공지·어황] 공지 새 글 확인 실패:', e && e.message); });
            if (w.NewsTab) w.NewsTab.prefetch().then(function (v) { if (cur !== 'news') { badge.news = !!v; refresh(); } });
            if (w.FishcondTab) w.FishcondTab.prefetch().then(function (v) { if (cur !== 'fishcond') { badge.fishcond = !!v; refresh(); } });
        };
        setTimeout(refreshBadges, 4000);
        // 앱을 오래 켜 둬도 매시 들어오는 새 기사·새 글에 N 이 다시 켜지게 30분마다(검토 참고 — 종전엔 켤 때 한 번뿐)
        setInterval(function () { if (!document.hidden) refreshBadges(); }, 30 * 60000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window);
