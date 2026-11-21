/**
 * ============================================================================
 * 파일명: client/js/notice/news/news.js
 * 역할  : 「뉴스·공지·어황」 탭의 오늘의 뉴스 화면 — 날짜줄(◀ 날짜 ▶ [오늘] … [달력]), 「최종 업데이트」, 뉴스 카드 목록.
 *         카드를 누르면 펼쳐지고(아코디언, 다른 카드는 접힘), 펼친 카드를 다시 누르면 기사를 앱 안 브라우저 창으로 연다.
 * 사용자 확정(원문은 js/notice/news_hub.design.md §1·§1-2):
 *   「날짜선택은 달력에 날짜선택하는걸로 해주되, 날짜는 보유하고있는 뉴스 기간까지만.」 · 「< 0월 0일(토) > 가 화면 가운데 위치. 날짜피커는 현위치, 오늘은 > 바로 오른쪽에」 ·
 *   「펼쳐진 후 한번 더 누르면 그 페이지로 이동. 다른 아코디언 뉴스카드를 누르면 직전 눌렀던거 접힘.」 · 「앱 안에 브라우저 창 개념으로 가자.」 ·
 *   「우측 하단 정렬하여 작게 그 기사가 발표된 시각도」 · 「일시 왼쪽에 사용자가 눌러서 아코디언 열어본 횟수도 기록」 · 꼬리표는 사진 위에(시안 5-2 B)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : 없음(CONFIG.API_BASE · window.Capacitor.Plugins.Browser · window.PopupStack(core/backbutton.js — 달력 닫기))
 *  - 서버 API      : GET /api/news?date=YYYY-MM-DD · POST /api/news/:date/:id/open · GET /api/news/img?u=(http 사진) — local_server/routes/news.js
 *  - 마크업        : index2.html #nhub-news(#news-dateline · #news-updated · #news-list)
 *  - 나를 쓰는 곳  : notice/hub/notice_hub.js(window.NewsTab.open · hasNew · markSeen · prefetch)
 * [로드 순서] notice/board/promo.js·comments 다음 · notice/hub/notice_hub.js 이전 — 순서 변경 금지
 * ============================================================================
 */
(function (w) {
    'use strict';
    var CAT_ICON = { money: 'fa-coins', duty: 'fa-gavel', rule: 'fa-ruler', safety: 'fa-life-ring', sea: 'fa-water', conflict: 'fa-scale-balanced' };
    var CAT_SHORT = { money: '돈', duty: '처벌', rule: '규칙', safety: '안전', sea: '바다', conflict: '갈등' };
    var SEEN_KEY = 'nhub_news_seen_v1';   // 마지막으로 본 오늘 기사 중 가장 새 발행 시각(ms) — 탭 N 표시용(기기마다)
    var LATE_MS = 3 * 3600000;            // 최종 업데이트가 이보다 오래면 주황(수집이 멈췄을 수 있다 — 낡은 목록을 최신으로 오해하지 않게)
    var st = { date: null, data: null, dates: [], openId: null, loading: false, latestToday: 0 };

    function api(p) { return ((w.CONFIG && w.CONFIG.API_BASE) || '') + p; }
    /** KST 오늘(YYYY-MM-DD). 예: '2026-11-21' */
    function todayKst() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
    /** 날짜 글자 더하기. 예: shift('2026-11-21', -1) → '2026-11-20' */
    function shift(d, n) { var t = Date.parse(d + 'T00:00:00Z') + n * 86400000; return new Date(t).toISOString().slice(0, 10); }
    /** 날짜줄 글자. 예: '2026-11-21' → '11월 21일(토)' */
    function label(d) { var t = new Date(d + 'T00:00:00Z'); return (t.getUTCMonth() + 1) + '월 ' + t.getUTCDate() + '일(' + '일월화수목금토'.charAt(t.getUTCDay()) + ')'; }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; }
    function icon(name) { var i = document.createElement('i'); i.className = 'fa-solid ' + name; i.setAttribute('aria-hidden', 'true'); return i; }
    function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* 저장이 막힌 기기 — N 표시만 덜 정확해진다 */ } }

    /**
     * 기사를 연다 — 앱은 앱 안 브라우저 창(@capacitor/browser — 닫기 X 로 돌아온다), PC·휴대폰 웹은 새 탭.
     * 예: openArticle('https://www.kbmaeil.com/article/…')
     * [연계] ← 펼친 카드를 다시 누름 / → Capacitor Browser.open(종전 ui_modal.js downloadKmaFile 과 같은 길)
     */
    function openArticle(url) {
        if (!/^https?:\/\//i.test(url || '')) return;
        var cap = w.Capacitor, Browser = cap && cap.Plugins && cap.Plugins.Browser;
        var native = cap && typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : !!(cap && cap.platform && cap.platform !== 'web');
        if (native && Browser && typeof Browser.open === 'function') {
            var p = Browser.open({ url: url });
            if (p && typeof p.catch === 'function') p.catch(function () { w.open(url, '_blank', 'noopener'); });
            return;
        }
        w.open(url, '_blank', 'noopener');
    }

    /** 카드 사진 주소 — http 사진은 앱(https) 안에서 막히므로 서버가 받아 전달한다. */
    function imgSrc(u) { return /^http:\/\//i.test(u) ? api('/api/news/img?u=' + encodeURIComponent(u)) : u; }

    /** 사진이 없거나 못 불러오면 분류 그림. */
    function defaultThumb(thumb, cat) {
        thumb.innerHTML = '';
        thumb.className = 'news-thumb ' + (cat || '');
        var i = icon(CAT_ICON[cat] || 'fa-newspaper'); i.className += ' def-ico'; thumb.appendChild(i);
        thumb.appendChild(el('span', '', CAT_SHORT[cat] || '뉴스'));
    }

    /**
     * 카드 하나를 만든다(시안 5-2 B — 분류 꼬리표를 사진 위에).
     * @param {object} c 서버 카드 { id, title, summary, cat, catName, region, time, source, more, image, views, link } @returns {HTMLElement}
     * [연계] ← render / → toggle
     */
    function card(c) {
        var box = el('div', 'news-card'); box.setAttribute('role', 'button'); box.tabIndex = 0; box.setAttribute('data-news-id', c.id); box.setAttribute('aria-expanded', 'false');
        var thumb = el('div', 'news-thumb ' + (c.cat || ''));
        if (c.image) {
            var img = document.createElement('img'); img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; img.src = imgSrc(c.image);
            img.onerror = function () { defaultThumb(thumb, c.cat); if (c.catName) thumb.appendChild(el('span', 'news-cat ' + c.cat, c.catName)); };
            thumb.appendChild(img);
        } else defaultThumb(thumb, c.cat);
        if (c.catName) thumb.appendChild(el('span', 'news-cat ' + c.cat, c.catName));
        box.appendChild(thumb);
        var body = el('div', 'news-body');
        body.appendChild(el('div', 'news-title', c.title));
        body.appendChild(el('div', 'news-sum', c.summary || ''));
        body.appendChild(el('div', 'news-hint', '한 번 더 누르면 기사가 열립니다 ›'));
        var foot = el('div', 'news-foot');
        if (c.region) foot.appendChild(el('span', 'news-reg', c.region));
        foot.appendChild(el('span', 'src', (c.source || '') + (c.more ? ' 외 ' + c.more + '건' : '')));
        var rt = el('span', 'rt');
        var vw = el('span', 'vw'); var eye = document.createElement('i'); eye.className = 'fa-regular fa-eye'; eye.setAttribute('aria-hidden', 'true');
        vw.appendChild(eye); vw.appendChild(document.createTextNode(' ' + (c.views || 0))); vw.title = '펼쳐 본 횟수'; vw.setAttribute('data-news-views', c.id);
        rt.appendChild(vw); rt.appendChild(el('span', 'tm', c.time));
        foot.appendChild(rt);
        body.appendChild(foot);
        box.appendChild(body);
        var act = function () { toggle(c, box); };
        box.addEventListener('click', act);
        box.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
        return box;
    }

    /**
     * 누름: 접혀 있으면 펼치고(다른 카드 접기) 펼친 횟수를 서버에 남긴다 · 이미 펼쳐져 있으면 기사를 연다.
     * [연계] ← card / → POST /api/news/:date/:id/open · openArticle
     */
    function toggle(c, box) {
        if (box.classList.contains('open')) { openArticle(c.link); return; }
        var prev = document.querySelector('#news-list .news-card.open');
        if (prev) { prev.classList.remove('open'); prev.setAttribute('aria-expanded', 'false'); }
        box.classList.add('open'); box.setAttribute('aria-expanded', 'true');
        st.openId = c.id;
        var admin = lsGet('seagnal_admin_mode') === 'true';
        fetch(api('/api/news/' + st.date + '/' + c.id + '/open' + (admin ? '?admin=true' : '')), { method: 'POST' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
                if (!j || typeof j.views !== 'number') return;
                c.views = j.views;
                var v = box.querySelector('[data-news-views]'); if (v) v.lastChild.textContent = ' ' + j.views;
            })
            .catch(function (e) { console.warn('[오늘의 뉴스] 펼친 횟수 기록 실패:', e && e.message); });
    }

    /** 날짜줄(시안 5-1 B + 사용자 의견 — 날짜 가운데, [오늘]은 ▶ 바로 오른쪽, 달력 맨 오른쪽). */
    function renderDateline() {
        var host = document.getElementById('news-dateline'); if (!host) return;
        host.innerHTML = '';
        var first = st.dates[0] || st.date, today = todayKst();
        var mk = function (cls, ico, title, on, fn) { var b = el('button', 'news-dbtn' + (cls ? ' ' + cls : '')); b.type = 'button'; if (ico) b.appendChild(icon(ico)); if (title) b.setAttribute('aria-label', title); b.disabled = !on; b.addEventListener('click', fn); return b; };
        host.appendChild(el('span'));
        var mid = el('div', 'mid');
        mid.appendChild(mk('', 'fa-chevron-left', '전날', st.date > first, function () { load(shift(st.date, -1)); }));
        mid.appendChild(el('div', 'news-dlabel', label(st.date)));
        mid.appendChild(mk('', 'fa-chevron-right', '다음날', st.date < today, function () { load(shift(st.date, 1)); }));
        host.appendChild(mid);
        var rt = el('div', 'rt');
        var tb = mk(st.date === today ? 'on' : '', null, null, true, function () { load(today); }); tb.textContent = '오늘'; rt.appendChild(tb);
        rt.appendChild(el('span', 'sp'));
        rt.appendChild(mk('', 'fa-calendar-days', '달력에서 날짜 고르기', st.dates.length > 0, openCalendar));
        host.appendChild(rt);
    }

    /** 「최종 업데이트 HH:MM」 — 3시간 넘게 지났으면 주황 + 「업데이트가 늦어지고 있어요」. */
    function renderUpdated() {
        var host = document.getElementById('news-updated'); if (!host) return;
        var s = st.data && st.data.state; host.className = 'news-updated'; host.textContent = '';
        if (!s || !s.lastRun) return;
        var t = Date.parse(s.lastRun); if (!isFinite(t)) return;
        var k = new Date(t + 9 * 3600000), hm = String(k.getUTCHours()).padStart(2, '0') + ':' + String(k.getUTCMinutes()).padStart(2, '0');
        var day = k.toISOString().slice(0, 10) === todayKst() ? '' : (k.getUTCMonth() + 1) + '.' + k.getUTCDate() + ' ';
        host.appendChild(document.createTextNode('최종 업데이트 ')); host.appendChild(el('b', '', day + hm));
        var n = st.data && st.data.cards ? st.data.cards.length : 0;
        if (n) host.appendChild(document.createTextNode(' · ' + n + '건'));
        if (Date.now() - t > LATE_MS) { host.className = 'news-updated late'; host.appendChild(document.createTextNode(' · 업데이트가 늦어지고 있어요')); }
    }

    function renderList() {
        var host = document.getElementById('news-list'); if (!host) return;
        host.innerHTML = '';
        var cards = (st.data && st.data.cards) || [];
        if (!cards.length) {
            var em = el('div', 'news-empty'), today = todayKst();
            if (st.date === today) {
                em.appendChild(el('div', 'big', '아직 오늘 기사가 없어요'));
                em.appendChild(document.createTextNode('1시간마다 새 기사를 모읍니다.'));
                var y = shift(today, -1);
                if (st.dates.indexOf(y) >= 0) { em.appendChild(el('br')); var b = el('button', 'news-dbtn', '어제 뉴스 보기'); b.type = 'button'; b.addEventListener('click', function () { load(y); }); em.appendChild(b); }
            } else em.appendChild(el('div', 'big', '이날은 실린 뉴스가 없어요'));
            host.appendChild(em);
            return;
        }
        cards.forEach(function (c) { host.appendChild(card(c)); });
    }

    /**
     * 그날 뉴스를 받아 그린다.
     * @param {string} d YYYY-MM-DD
     * [연계] ← open · 날짜줄 · 달력 · 빈 목록의 [어제 뉴스 보기] / → GET /api/news
     */
    function load(d) {
        st.date = d; st.openId = null; st.loading = true;
        renderDateline();
        var list = document.getElementById('news-list');
        if (list) list.innerHTML = '<div class="news-empty"><i class="fa-solid fa-circle-notch fa-spin"></i> 불러오는 중…</div>';
        return fetch(api('/api/news?date=' + encodeURIComponent(d)))
            .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(function (j) {
                if (st.date !== d) return;   // 그사이 다른 날짜로 옮겼다
                st.data = j; st.dates = Array.isArray(j.dates) ? j.dates : [];
                if (d === todayKst()) { st.latestToday = (j.cards || []).reduce(function (m, c) { return Math.max(m, c.pubMs || 0); }, 0); markSeen(); }
                renderDateline(); renderUpdated(); renderList();
            })
            .catch(function (e) {
                console.warn('[오늘의 뉴스] 불러오기 실패:', e && e.message);
                if (st.date !== d || !list) return;
                list.innerHTML = '';
                var em = el('div', 'news-empty'); em.appendChild(el('div', 'big', '뉴스를 불러오지 못했어요')); em.appendChild(document.createTextNode('잠시 뒤 다시 열어 주세요.')); list.appendChild(em);
            })
            .then(function () { st.loading = false; });
    }

    /** 달력 — 보관 중인 날짜만 누를 수 있다. 앱 뒤로가기로 닫힌다(PopupStack). */
    function openCalendar() {
        if (!st.dates.length) return;
        var wrap = el('div', 'news-cal-wrap'); wrap.id = 'news-cal-wrap';
        var have = {}; st.dates.forEach(function (d) { have[d] = true; });
        var ym = st.date.slice(0, 7);
        var close = function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); if (w.PopupStack) w.PopupStack.remove('news-cal-wrap'); };
        var draw = function () {
            wrap.innerHTML = '';
            var cal = el('div', 'news-cal'); cal.setAttribute('role', 'dialog'); cal.setAttribute('aria-label', '날짜 고르기');
            var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
            var minYm = st.dates[0].slice(0, 7), maxYm = todayKst().slice(0, 7);
            var h = el('div', 'news-cal-h');
            var pm = el('button', 'news-dbtn'); pm.type = 'button'; pm.appendChild(icon('fa-chevron-left')); pm.setAttribute('aria-label', '이전 달'); pm.disabled = ym <= minYm;
            pm.addEventListener('click', function (e) { e.stopPropagation(); var t = new Date(Date.UTC(y, m - 2, 1)); ym = t.toISOString().slice(0, 7); draw(); });
            var nm = el('button', 'news-dbtn'); nm.type = 'button'; nm.appendChild(icon('fa-chevron-right')); nm.setAttribute('aria-label', '다음 달'); nm.disabled = ym >= maxYm;
            nm.addEventListener('click', function (e) { e.stopPropagation(); var t = new Date(Date.UTC(y, m, 1)); ym = t.toISOString().slice(0, 7); draw(); });
            h.appendChild(pm); h.appendChild(el('span', '', y + '년 ' + m + '월')); h.appendChild(nm);
            cal.appendChild(h);
            var g = el('div', 'news-cal-g');
            '일월화수목금토'.split('').forEach(function (x) { g.appendChild(el('div', 'w', x)); });
            var firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(), days = new Date(Date.UTC(y, m, 0)).getUTCDate(), today = todayKst();
            for (var i = 0; i < firstDow; i++) g.appendChild(el('span'));
            for (var d = 1; d <= days; d++) {
                var ds = ym + '-' + String(d).padStart(2, '0');
                var b = el('button', (have[ds] ? 'have' : '') + (ds === st.date ? ' sel' : '') + (ds === today ? ' today' : ''), d); b.type = 'button';
                if (have[ds]) (function (dd) { b.addEventListener('click', function (e) { e.stopPropagation(); close(); load(dd); }); })(ds); else b.disabled = true;
                g.appendChild(b);
            }
            cal.appendChild(g);
            cal.appendChild(el('div', 'news-cal-n', '밝은 날짜 = 뉴스 보관 중 (' + st.dates[0].slice(5).replace('-', '.') + ' ~ ' + st.dates[st.dates.length - 1].slice(5).replace('-', '.') + ')'));
            cal.addEventListener('click', function (e) { e.stopPropagation(); });
            wrap.appendChild(cal);
        };
        wrap.addEventListener('click', close);
        draw();
        document.body.appendChild(wrap);
        if (w.PopupStack) w.PopupStack.push('news-cal-wrap', close);
    }

    /** 오늘 기사 중 아직 안 본 것이 있나(탭 N). */
    function hasNew() { var seen = +(lsGet(SEEN_KEY) || 0); return st.latestToday > seen; }
    /** 지금 오늘 목록을 봤다고 적는다. */
    function markSeen() { if (st.latestToday) lsSet(SEEN_KEY, String(st.latestToday)); }

    w.NewsTab = {
        /** 탭이 보일 때 — 처음이면 오늘을, 오늘을 보고 있었으면 다시 받는다(1시간마다 늘어난다). [연계] ← notice_hub.show('news') */
        open: function () { if (!st.date || st.date === todayKst()) return load(todayKst()); markSeenIfToday(); return Promise.resolve(); },
        /** 앱이 켜질 때 N 표시만을 위해 오늘 목록을 받아 둔다(화면에 그리지 않는다). [연계] ← notice_hub 시작 */
        prefetch: function () {
            return fetch(api('/api/news?date=' + todayKst())).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
                if (!j) return false;
                st.latestToday = (j.cards || []).reduce(function (m, c) { return Math.max(m, c.pubMs || 0); }, 0);
                return hasNew();
            }).catch(function () { return false; });
        },
        hasNew: hasNew, markSeen: markSeen,
        _st: st, _openArticle: openArticle, _label: label, _shift: shift,
    };
    function markSeenIfToday() { if (st.date === todayKst()) markSeen(); }
})(window);
