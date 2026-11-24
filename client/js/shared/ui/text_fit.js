/**
 * ============================================================================
 * 파일명: js/shared/ui/text_fit.js
 * 역할: 긴 안내 글을 읽기 좋게 줄을 맞춘다(여러 화면이 함께 쓰는 도구).
 *       줄 끝에서 다음 줄로 넘어갈 낱말이 2~3글자만 모자라면, 그 줄의 글자 간격을 살짝 좁혀 한 줄에 넣는다.
 *       (낱말 중간에서 줄이 끊기지 않는 것은 각 화면 CSS 의 word-break:keep-all 이 한다 — 규칙 전체는 저장소 NOTICE.md 「줄 정렬」)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : 없음
 *  - 서버 API      : 없음
 *  - 마크업        : 부르는 쪽이 넘긴 칸 — 게시판 글 보기 칸(#promo-detail-content) · 해상 기상 전망 본문 · 지도 「안내」 팝업 본문
 *                    ⚠편집기(Quill) 칸에는 걸지 않는다(낱말마다 span 을 씌우므로 저장 글이 바뀐다)
 *  - 나를 쓰는 곳  : notice/board/promo.js(openPromoDetail) · forecast/outlook/marine_forecast.js(전망 본문) ·
 *                    ocean-map/cctv/ocean_cctv.js · marine-life/safety/life_safety.js(안내 팝업) · scripts/notice/build_notice.js(미리보기에 그대로 넣음)
 * [로드 순서] marine_forecast.js 앞 (index2.html — 전망은 첫 화면에서 바로 그려지므로)
 * ============================================================================
 *
 * 사용자 확정 2026-11-18: 「다음줄이 2~3개 텍스트 때문에 어절단위로 안끊어지면 그 줄의 자간을 좀 줄여서 한줄에 들어갈 수 있도록」 ·
 *   처음엔 「일단 패치노트만」 → 같은 날 해상 기상 전망·안내 팝업에도(「좋아 그렇게 해」).
 * [공개 API]
 *  - window.textFit(el, selector) — el 안의 selector 칸(문단·줄)마다 맞춘다. el 이 아직 안 보이면(폭 0) 보일 때 맞추고,
 *    폭이 바뀌면(폰 회전·창 크기) 다시 맞춘다(ResizeObserver). 글이 바뀌면 부르는 쪽이 다시 부른다.
 *  - window.textFitInfo(root) — 지도 「안내」 팝업 본문: 아이콘(✔·⚠)으로 시작하는 문단에 tf-ic(둘째 줄을 글자 시작점에 맞춤),
 *    굵은 제목만 있는 문단에 tf-h 를 달고 패널마다 textFit 을 건다.
 */
(function (root) {
    'use strict';

    // 좁히는 한도(글자 크기 대비) — 15px 글자에서 약 1.8px. 이보다 더 좁혀야 들어가면 그대로 다음 줄로 넘긴다
    //   (더 좁히면 한글 글자끼리 붙어 읽기 어려워진다). 15px 글자 20자 남짓인 줄에서 약 2~3글자를 받아들인다.
    var MAX_EM = 0.12;
    var watched = new Set();
    var ro = typeof ResizeObserver === 'function' ? new ResizeObserver(function (entries) {
        entries.forEach(function (e) {
            var el = e.target, w = Math.round(e.contentRect.width);
            if (w && w !== el.__tfW) { el.__tfW = w; run(el); }   // 폭이 바뀔 때만 — 좁혀서 높이가 바뀌는 것으로는 다시 안 돈다
        });
    }) : null;

    // 낱말 안 글자 사이에 넣는 「줄 바꾸지 마」 표시(WORD JOINER, 폭 0) — 괄호·가운뎃점·빗금 자리에서도 줄이 바뀌지 않게
    //   (사용자 2026-11-18 「일부 우리 규칙에 안맞게 어절단위로 안끊어진 부분도」 — 「실시간 / (매시간)」 「눈) / 가」 같은 것).
    //   한 줄보다 긴 낱말은 CSS overflow-wrap:break-word 가 어쩔 수 없이 끊는다.
    var WJ = '\u2060';

    /**
     * 글 칸의 글자를 띄어쓰기 단위 조각(span)으로 나눈다 — 줄마다 어느 낱말이 있는지 재기 위해. 한 번만 나눈다.
     * 띄어쓰기 없이 붙은 조각(예: 굵은 글씨 「[저장]」 + 「을」)은 한 낱말로 묶는다. 낱말 안 글자 사이에는 WJ 를 넣어
     * 띄어쓰기 자리에서만 줄이 바뀌게 한다. 줄바꿈 글자(\n)가 든 띄어쓰기 뒤 낱말은 hard=true(그 줄로 당기지 않는다).
     * 예: '<li>기상청이 <strong>11월</strong>부터</li>' → 낱말 [[기상청이], [11월, 부터]]
     * @param {Element} block - 문단·목록 항목 @returns {Array<Array<HTMLSpanElement>>} 낱말(조각 묶음) 목록 [연계] ← fitBlock
     */
    function words(block) {
        if (block.__tfWords) return block.__tfWords;
        var texts = [], walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT), out = [], gap = true, hard = false;
        while (walker.nextNode()) texts.push(walker.currentNode);
        texts.forEach(function (t) {
            var frag = document.createDocumentFragment();
            t.nodeValue.split(/(\s+)/).forEach(function (s) {
                if (!s) return;
                if (/^\s+$/.test(s)) { frag.appendChild(document.createTextNode(s)); gap = true; if (s.indexOf('\n') >= 0) hard = true; return; }
                var sp = document.createElement('span');
                sp.textContent = Array.from(s).join(WJ);
                frag.appendChild(sp);
                if (gap || !out.length) { var w = [sp]; w.hard = hard; out.push(w); hard = false; }
                else { var last = out[out.length - 1]; last[last.length - 1].textContent += WJ; last.push(sp); }   // 붙은 조각 사이도
                gap = false;
            });
            t.parentNode.replaceChild(frag, t);
        });
        block.__tfWords = out;
        return out;
    }

    /** 낱말(조각 묶음) 하나가 차지한 상자. 두 줄에 걸쳤으면 null. 예: box([sp1, sp2]) → {top, left, right, width} [연계] ← fitBlock */
    function box(w) {
        var r = []; w.forEach(function (sp) { r.push.apply(r, sp.getClientRects()); });
        if (!r.length) return null;
        var b = { top: r[0].top, left: r[0].left, right: r[0].right };
        for (var i = 1; i < r.length; i++) {
            if (Math.abs(r[i].top - b.top) > 2) return null;
            b.left = Math.min(b.left, r[i].left); b.right = Math.max(b.right, r[i].right);
        }
        b.width = b.right - b.left;
        return b;
    }
    function setLs(list, v) { list.forEach(function (w) { w.forEach(function (sp) { sp.style.letterSpacing = v; }); }); }

    /**
     * 문단 하나: 줄이 바뀌는 자리마다 「다음 줄 첫 낱말을 이 줄로 당기려면 글자마다 얼마나 좁혀야 하나」를 재고,
     * 한도(MAX_EM) 안이면 그 줄 낱말들과 당길 낱말의 글자 간격을 좁힌다. 좁혀도 안 올라오면 되돌린다.
     * 예: 「기상청이 11월 26일부터 「제주도남쪽바깥먼바다」를」 — 셋째 낱말이 3글자 모자라 다음 줄로 가면 첫 줄을 좁혀 올린다
     * @param {Element} block @returns {void} [연계] ← run
     */
    function fitBlock(block) {
        var ws = words(block);
        if (ws.length < 2) return;
        setLs(ws, '');
        var cs = getComputedStyle(block), br = block.getBoundingClientRect();
        if (!br.width) return;
        var right = br.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
        var cap = MAX_EM * parseFloat(cs.fontSize);
        for (var k = 1; k < ws.length; k++) {
            var ra = box(ws[k - 1]), rb = box(ws[k]);
            if (!ra || !rb) continue;                                    // 낱말이 두 줄에 걸쳤으면(아주 긴 낱말) 건드리지 않는다
            var top = ra.top;
            if (rb.top <= top + 2) continue;                             // 같은 줄
            if (ws[k].hard) continue;                                    // 줄바꿈 글자로 일부러 바꾼 줄(문장 끝)은 당기지 않는다
            var s = k - 1;                                               // 이 줄의 첫 낱말
            while (s > 0) { var rp = box(ws[s - 1]); if (!rp || Math.abs(rp.top - top) > 2) break; s--; }
            var space = s < k - 1 ? box(ws[s + 1]).left - box(ws[s]).right : parseFloat(cs.fontSize) * 0.27;
            var need = space + rb.width - (right - ra.right);
            if (need <= 0) continue;
            var line = ws.slice(s, k + 1), chars = 0, saved = [];
            line.forEach(function (w) { w.forEach(function (sp) { chars += sp.textContent.replace(/\u2060/g, '').length; saved.push(sp.style.letterSpacing); }); });
            // 이 줄이 앞서 이미 좁혀졌으면(낱말을 하나 당긴 뒤 또 당기는 경우) 그만큼에 더한다
            var ls = (-parseFloat(ws[s][0].style.letterSpacing) || 0) + need / chars + 0.05;
            if (ls > cap) continue;
            setLs(line, (-ls).toFixed(2) + 'px');
            var nb = box(ws[k]);
            if (!nb || Math.abs(nb.top - top) > 2) {                     // 좁혀도 안 올라왔으면 앞 상태로 되돌림
                var i = 0; line.forEach(function (w) { w.forEach(function (sp) { sp.style.letterSpacing = saved[i++]; }); });
            }
        }
    }

    function run(el) { if (el.isConnected && el.__tfSel) el.querySelectorAll(el.__tfSel).forEach(fitBlock); }

    /**
     * 칸 하나를 맞추고, 앞으로 폭이 바뀌면(보이게 되거나 화면이 돌면) 다시 맞추게 등록한다.
     * 예: window.textFit(document.getElementById('promo-detail-content'), 'p, li, h2, h3, blockquote')
     * @param {Element} el - 맞출 글이 든 칸 @param {string} selector - 그 안에서 줄을 맞출 문단·줄 @returns {void}
     * [연계] ← promo.js · marine_forecast.js · textFitInfo
     */
    function textFit(el, selector) {
        if (!el) return;
        el.__tfSel = selector;
        watched.forEach(function (x) { if (!x.isConnected) { watched.delete(x); if (ro) ro.unobserve(x); } });   // 글을 다시 그려 떨어져 나간 칸은 놓아준다
        if (!watched.has(el)) { watched.add(el); if (ro) ro.observe(el); }
        el.__tfW = Math.round(el.getBoundingClientRect().width);         // 지금 안 보이면 0 — 보이게 될 때 관찰기가 맞춘다
        if (el.__tfW) run(el);
    }

    /**
     * 지도 「안내」 팝업 본문을 맞춘다 — 아이콘으로 시작하는 문단(tf-ic)은 둘째 줄을 글자 시작점에 맞추고(CSS),
     * 굵은 제목만 있는 문단(tf-h)은 큰 간격을 준다(CSS). 패널마다 따로 등록(탭을 바꾸면 그 패널이 보이게 되므로).
     * 예: window.textFitInfo(document.getElementById('seagnal-custom-modal'))
     * @param {Element} rootEl - 안내 팝업 @returns {void} [연계] ← ocean_cctv.js _openNoticePopup · life_safety.js 안내 두 곳
     */
    function textFitInfo(rootEl) {
        if (!rootEl) return;
        // 문장이 끝나면(「~다.」「~요.」 + 띄어쓰기) 다음 문장은 새 줄에서(사용자 2026-11-18 「안내에서 문장이 끝나면 다음줄로 줄바꿈」)
        //   — 안내 본문은 white-space:pre-line 이라 줄바꿈 글자가 그대로 줄을 바꾼다. 「1.5」 같은 숫자는 건드리지 않는다.
        rootEl.querySelectorAll('.ocean-info-panel p').forEach(function (p) {
            if (p.__tfSent) return;
            p.__tfSent = true;
            var tw = document.createTreeWalker(p, NodeFilter.SHOW_TEXT), list = [];
            while (tw.nextNode()) list.push(tw.currentNode);
            list.forEach(function (t) { t.nodeValue = t.nodeValue.replace(/([다요])\.[ \t]+(?=\S)/g, '$1.\n'); });
        });
        rootEl.querySelectorAll('.ocean-info-panel p').forEach(function (p) {
            var first = p.firstChild;
            if (first && first.nodeType === 1 && first.tagName === 'I') {
                p.classList.add('tf-ic');
                var next = first.nextSibling;                            // 아이콘 칸이 간격을 맡으므로 뒤 띄어쓰기는 뗀다
                if (next && next.nodeType === 3) next.nodeValue = next.nodeValue.replace(/^\s+/, '');
            } else if (p.children.length === 1 && p.firstElementChild.tagName === 'STRONG' && p.textContent.trim() === p.firstElementChild.textContent.trim()) {
                p.classList.add('tf-h');
            }
        });
        rootEl.querySelectorAll('.ocean-info-panel').forEach(function (panel) { textFit(panel, 'p'); });
    }

    /**
     * 짧은 글 한 칸(안내 줄·칩 글자)이 좁은 화면에서 두 줄로 넘어가면, 글자 간격을 좁혀 한 줄에 넣는다.
     * 한도(MAX_EM, 글자 크기의 12%)보다 더 좁혀야 하면 손대지 않고 두 줄 그대로 둔다(글자가 붙어 읽기 어려워지므로).
     * 사용자 2026-11-23 「화면이 작아서 텍스트가 두줄로 표현되는 경우에는 한줄로 표출될 수 있도록 자간을 자동으로 줄여서」.
     * 예: window.textFitOneLine(document.querySelector('#om-banner .om-banner-text')) → true(한 줄에 들어감)
     * @param {Element} el - 글이 든 칸(폭이 정해진 block·flex 칸) @returns {boolean} 한 줄에 들어갔는가
     * [연계] ← ocean-map/menu/ocean_menu.js(안내 줄) · marine-life/safety/accident_info.js renderStatsBody(통계 칩)
     */
    function textFitOneLine(el) {
        if (!el || !el.clientWidth) return false;
        el.style.letterSpacing = ''; el.style.whiteSpace = 'nowrap';
        var over = el.scrollWidth - el.clientWidth;
        if (over <= 0) { el.style.whiteSpace = ''; return true; }
        var n = Array.from(el.textContent).length || 1, ls = over / n + 0.05;
        if (ls > MAX_EM * parseFloat(getComputedStyle(el).fontSize)) { el.style.whiteSpace = ''; return false; }
        el.style.letterSpacing = (-ls).toFixed(2) + 'px';
        if (el.scrollWidth > el.clientWidth) { el.style.letterSpacing = ''; el.style.whiteSpace = ''; return false; }
        return true;
    }

    root.textFit = textFit;
    root.textFitOneLine = textFitOneLine;
    root.textFitInfo = textFitInfo;
    // 글꼴이 늦게 받아지면 글자 폭이 바뀌므로 한 번 더 맞춘다
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { watched.forEach(run); });
})(window);
