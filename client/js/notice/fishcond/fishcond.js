/**
 * ============================================================================
 * 파일명: client/js/notice/fishcond/fishcond.js
 * 역할  : 「뉴스·공지·어황」 탭의 어황정보 화면 — 국립수산과학원 어황정보 글 목록(공지사항과 같은 모양, 시안 7-1 A)과
 *         누르면 뜨는 게시글 팝업(PDF 를 쪽마다 그림으로 보여 주고 [PDF 받기]·[원문 보기]).
 * 사용자 확정(원문은 js/notice/news_hub.design.md §1·§1-2):
 *   「어황정보는 공지사항의 게시글처럼 하되 누르면 지금 게시글에 반영된 것처럼 게시글 팝업이 뜨고 해당 pdf 정보가 표출」 · 「pdf 다운로드 기능도 반영」 ·
 *   「Pdf 쪽수 불필요, 날짜 주관부서 맨 오른쪽, 날짜 왼쪽에 조회 눈 붙이고」 · 바다 꼬리표 「붙여」 · 댓글·반응 「불필요. 공지사항에만」
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : shared/ui/ui_modal.js(window.downloadKmaFile — PDF 받기, 앱은 시스템 브라우저로) · core/backbutton.js(window.PopupStack — 뒤로가기로 팝업 닫기)
 *  - 서버 API      : GET /api/fishcond · GET /api/fishcond/:id/view(열 때 조회 수 1 — ?admin=true 는 하루 1번) · GET /api/fishcond/:id/pdf — local_server/routes/fishcond.js
 *  - 마크업        : index2.html #nhub-fishcond(#fishcond-list) · #fishcond-detail-modal
 *  - 나를 쓰는 곳  : notice/hub/notice_hub.js(window.FishcondTab.open · hasNew · prefetch) · 팝업 닫기 단추(onclick="closeFishcondDetail()")
 * [로드 순서] notice/news/news.js 다음 · notice/hub/notice_hub.js 이전 — 순서 변경 금지
 * ============================================================================
 */
(function (w) {
    'use strict';
    var SEA_CLS = { '서해': 'west', '남해': 'south', '동해': 'east', '전국': 'all' };
    var SEEN_KEY = 'nhub_fishcond_seen_v1';   // 마지막으로 본 가장 새 글 ID(글 ID 앞 17자리가 등록 시각이라 글자 순서 = 시간 순서)
    var posts = [], newest = '', current = null;

    function api(p) { return ((w.CONFIG && w.CONFIG.API_BASE) || '') + p; }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; }
    function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* 저장이 막힌 기기 — N 표시만 덜 정확해진다 */ } }
    function eyeSpan(n) { var s = el('span', 'promo-item-views'); var i = document.createElement('i'); i.className = 'fa-regular fa-eye'; i.setAttribute('aria-hidden', 'true'); s.appendChild(i); s.appendChild(document.createTextNode(' ' + (n || 0))); return s; }
    /** 날짜 꼴. 예: '2026-11-20' → '2026.11.20' */
    function dot(d) { return String(d || '').replace(/-/g, '.'); }

    /**
     * 목록을 그린다 — [바다] 제목 (N) / 오른쪽 끝에 조회(눈)·날짜·주관부서.
     * [연계] ← load / → openFishcondDetail
     */
    function render() {
        var host = document.getElementById('fishcond-list'); if (!host) return;
        host.innerHTML = '';
        if (!posts.length) {
            var em = el('div', 'promo-empty'); var i = document.createElement('i'); i.className = 'fa-solid fa-fish'; em.appendChild(i);
            em.appendChild(el('p', '', '아직 받아 둔 어황정보가 없습니다.')); host.appendChild(em); return;
        }
        var seen = lsGet(SEEN_KEY) || '';
        posts.forEach(function (p) {
            var item = el('div', 'promo-item'); item.setAttribute('role', 'button'); item.tabIndex = 0; item.setAttribute('data-fishcond-id', p.id);
            var t = el('div', 'promo-item-title');
            t.appendChild(el('span', 'fishcond-sea ' + (SEA_CLS[p.sea] || 'all'), p.sea || '전국'));
            t.appendChild(document.createTextNode(p.title));
            if (p.id > seen) { var nb = el('span', 'new-badge', 'N'); nb.style.cssText = 'vertical-align:middle;margin-left:6px'; t.appendChild(nb); }
            item.appendChild(t);
            var m = el('div', 'promo-item-meta nhub-right');
            m.appendChild(eyeSpan(p.views));
            m.appendChild(el('span', 'promo-item-date', dot(p.date)));
            m.appendChild(el('span', 'fishcond-dept', p.dept || ''));
            item.appendChild(m);
            var go = function () { w.openFishcondDetail(p.id); };
            item.addEventListener('click', go);
            item.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
            host.appendChild(item);
        });
    }

    /** 목록을 받는다. [연계] ← open · prefetch · 팝업을 닫을 때(조회 수 갱신) */
    function load(draw) {
        return fetch(api('/api/fishcond')).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (j) {
            posts = Array.isArray(j.posts) ? j.posts : [];
            newest = posts.reduce(function (m, p) { return p.id > m ? p.id : m; }, '');
            if (draw) render();
            return true;
        }).catch(function (e) {
            console.warn('[어황정보] 목록 불러오기 실패:', e && e.message);
            if (draw) { var host = document.getElementById('fishcond-list'); if (host) { host.innerHTML = ''; var em = el('div', 'promo-empty'); em.appendChild(el('p', '', '어황정보를 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.')); host.appendChild(em); } }
            return false;
        });
    }

    /** 받은 파일 이름에 쓸 수 없는 글자를 뺀다. */
    function safeName(s) { return String(s || '어황정보').replace(/[\\/:*?"<>|]/g, ' ').trim() + '.pdf'; }
    function openUrl(url) {
        var cap = w.Capacitor, Browser = cap && cap.Plugins && cap.Plugins.Browser;
        var native = cap && typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : !!(cap && cap.platform && cap.platform !== 'web');
        if (native && Browser && typeof Browser.open === 'function') { var p = Browser.open({ url: url }); if (p && p.catch) p.catch(function () { w.open(url, '_blank', 'noopener'); }); return; }
        w.open(url, '_blank', 'noopener');
    }

    /**
     * 게시글 팝업을 연다 — 머리(제목·바다·날짜·부서·조회·[PDF 받기]·[원문 보기]) + 몸통(쪽 그림 보기 페이지).
     * 예: openFishcondDetail('20261120132915271ZVR')
     * [연계] ← 목록 누름 / → GET /api/fishcond/:id/view(iframe — 서버가 조회 수를 센다) · downloadKmaFile · PopupStack
     */
    w.openFishcondDetail = function (id) {
        var p = posts.filter(function (x) { return x.id === id; })[0];
        var modal = document.getElementById('fishcond-detail-modal');
        if (!p || !modal) return;
        current = p;
        document.getElementById('fishcond-detail-title').textContent = p.title;
        var meta = document.getElementById('fishcond-detail-meta'); meta.innerHTML = '';
        meta.appendChild(el('span', 'fishcond-sea ' + (SEA_CLS[p.sea] || 'all'), p.sea || '전국'));
        meta.appendChild(el('span', '', dot(p.date)));
        meta.appendChild(el('span', '', p.dept || ''));
        meta.appendChild(el('span', '', '출처: 국립수산과학원'));
        var body = document.getElementById('fishcond-detail-body'); body.innerHTML = '';
        var admin = lsGet('seagnal_admin_mode') === 'true';
        if (p.pages > 0 && p.status === 'ok') {
            var f = document.createElement('iframe'); f.title = p.title + ' 미리보기'; f.src = api('/api/fishcond/' + p.id + '/view' + (admin ? '?admin=true' : ''));
            body.appendChild(f);
        } else {
            body.appendChild(el('div', 'fishcond-nopreview', '미리보기를 만들지 못했어요. [PDF 받기]로 보실 수 있어요.'));
            // 미리보기가 없어도 연 것으로 센다(서버 보기 주소가 센다 — 404 를 돌려주지만 조회 수는 오른다)
            fetch(api('/api/fishcond/' + p.id + '/view' + (admin ? '?admin=true' : ''))).catch(function () { /* 조회 수만 못 올린다 */ });
        }
        document.getElementById('fishcond-detail-pdf').onclick = function () {
            if (typeof w.downloadKmaFile === 'function') w.downloadKmaFile(api('/api/fishcond/' + p.id + '/pdf'), safeName(p.title));
            else w.open(api('/api/fishcond/' + p.id + '/pdf'), '_blank');
        };
        document.getElementById('fishcond-detail-source').onclick = function () { if (p.sourceUrl) openUrl(p.sourceUrl); };
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        if (w.PopupStack) w.PopupStack.push('fishcond-detail-modal', w.closeFishcondDetail);
    };
    /** 팝업을 닫는다(목록의 조회 수를 다시 받아 그린다). [연계] ← 닫기 단추 · 뒤로가기(PopupStack) */
    w.closeFishcondDetail = function () {
        var modal = document.getElementById('fishcond-detail-modal');
        if (modal) modal.classList.add('hidden');
        var body = document.getElementById('fishcond-detail-body'); if (body) body.innerHTML = '';
        document.body.style.overflow = '';
        if (w.PopupStack) w.PopupStack.remove('fishcond-detail-modal');
        current = null;
        load(true);
    };

    w.FishcondTab = {
        /** 탭이 보일 때 — 목록을 받아 그리고, 가장 새 글까지 봤다고 적는다(N 은 다음 새 글부터). [연계] ← notice_hub.show('fishcond') */
        open: function () { return load(true).then(function () { if (newest) lsSet(SEEN_KEY, newest); }); },
        /** 앱이 켜질 때 N 표시만을 위해 받아 둔다. @returns {Promise<boolean>} 새 글이 있나 */
        prefetch: function () { return load(false).then(function () { return hasNew(); }); },
        hasNew: hasNew,
        _posts: function () { return posts; },
    };
    /** 마지막으로 본 뒤 새로 들어온 글이 있나. */
    function hasNew() { return !!newest && newest > (lsGet(SEEN_KEY) || ''); }
})(window);
