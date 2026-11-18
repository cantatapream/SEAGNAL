/**
 * ============================================================================
 * 파일명: js/notice/board/md_fit.js
 * 역할: 공지 게시판에서 마크다운으로 올린 글(패치노트)을 읽기 좋게 줄을 맞춘다.
 *       줄 끝에서 다음 줄로 넘어갈 낱말이 2~3글자만 모자라면, 그 줄의 글자 간격을 살짝 좁혀 한 줄에 넣는다.
 *       (낱말 중간에서 줄이 끊기지 않는 것은 style.css .promo-md 의 word-break:keep-all 이 한다)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : 없음
 *  - 서버 API      : 없음
 *  - 마크업        : index2.html #promo-detail-content(게시글 보기 칸) — 편집기(Quill) 에는 걸지 않는다(낱말마다 span 을 씌우므로 저장 글이 바뀐다)
 *  - 나를 쓰는 곳  : promo.js openPromoDetail(마크다운 글을 열 때) · scripts/notice/build_notice.js(미리보기에 이 파일을 그대로 넣음)
 * [로드 순서] promo.js 앞 (index2.html — markdown_import.js 다음)
 * ============================================================================
 *
 * 사용자 확정 2026-11-18: 「다음줄이 2~3개 텍스트 때문에 어절단위로 안끊어지면 그 줄의 자간을 좀 줄여서 한줄에 들어갈 수 있도록」 ·
 *   「일단 패치노트만 그렇게 적용해봐」.
 * [공개 API] window.promoMdFit(el) — el 안의 문단·목록·제목마다 맞춘다. 마지막으로 맞춘 칸은 화면 폭이 바뀌면 다시 맞춘다.
 */
(function (root) {
    'use strict';

    // 좁히는 한도(글자 크기 대비) — 15px 글자에서 약 1.8px. 이보다 더 좁혀야 들어가면 그대로 다음 줄로 넘긴다
    //   (더 좁히면 한글 글자끼리 붙어 읽기 어려워진다). 15px 글자 20자 남짓인 줄에서 약 2~3글자를 받아들인다.
    var MAX_EM = 0.12;
    var BLOCKS = 'p, li, h2, h3, blockquote';
    var lastEl = null, resizeTimer = 0;

    /**
     * 글 칸의 글자를 띄어쓰기 단위 조각(span)으로 나눈다 — 줄마다 어느 낱말이 있는지 재기 위해. 한 번만 나눈다.
     * 띄어쓰기 없이 붙은 조각(예: 굵은 글씨 「[저장]」 + 「을」)은 한 낱말로 묶는다(브라우저도 그 사이에서 줄을 바꾸지 않는다).
     * 예: '<li>기상청이 <strong>11월</strong>부터</li>' → 낱말 [[기상청이], [11월, 부터]]
     * @param {Element} block - 문단·목록 항목 @returns {Array<Array<HTMLSpanElement>>} 낱말(조각 묶음) 목록 [연계] ← fitBlock
     */
    function words(block) {
        if (block.__mdFitWords) return block.__mdFitWords;
        var texts = [], walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT), out = [], gap = true;
        while (walker.nextNode()) texts.push(walker.currentNode);
        texts.forEach(function (t) {
            var frag = document.createDocumentFragment();
            t.nodeValue.split(/(\s+)/).forEach(function (s) {
                if (!s) return;
                if (/^\s+$/.test(s)) { frag.appendChild(document.createTextNode(s)); gap = true; return; }
                var sp = document.createElement('span');
                sp.textContent = s;
                frag.appendChild(sp);
                if (gap || !out.length) out.push([sp]); else out[out.length - 1].push(sp);
                gap = false;
            });
            t.parentNode.replaceChild(frag, t);
        });
        block.__mdFitWords = out;
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
     * @param {Element} block @returns {void} [연계] ← fit
     */
    function fitBlock(block) {
        var ws = words(block);
        if (ws.length < 2) return;
        setLs(ws, '');
        var cs = getComputedStyle(block), br = block.getBoundingClientRect();
        var right = br.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
        var cap = MAX_EM * parseFloat(cs.fontSize);
        for (var k = 1; k < ws.length; k++) {
            var ra = box(ws[k - 1]), rb = box(ws[k]);
            if (!ra || !rb) continue;                                    // 낱말이 두 줄에 걸쳤으면(아주 긴 낱말) 건드리지 않는다
            var top = ra.top;
            if (rb.top <= top + 2) continue;                             // 같은 줄
            var s = k - 1;                                               // 이 줄의 첫 낱말
            while (s > 0) { var rp = box(ws[s - 1]); if (!rp || Math.abs(rp.top - top) > 2) break; s--; }
            var space = s < k - 1 ? box(ws[s + 1]).left - box(ws[s]).right : parseFloat(cs.fontSize) * 0.27;
            var need = space + rb.width - (right - ra.right);
            if (need <= 0) continue;
            var line = ws.slice(s, k + 1), chars = 0, saved = [];
            line.forEach(function (w) { w.forEach(function (sp) { chars += sp.textContent.length; saved.push(sp.style.letterSpacing); }); });
            // 이 줄이 앞서 이미 좁혀졌으면(낱말을 하나 당긴 뒤 또 당기는 경우) 그만큼에 더한다
            var ls = (-parseFloat(ws[s][0].style.letterSpacing) || 0) + need / chars + 0.05;
            if (ls > cap) continue;
            setLs(line, (-ls).toFixed(2) + 'px');
            var nb = box(ws[k]);
            if (!nb || Math.abs(nb.top - top) > 2) {                // 좁혀도 안 올라왔으면 앞 상태로 되돌림
                var i = 0; line.forEach(function (w) { w.forEach(function (sp) { sp.style.letterSpacing = saved[i++]; }); });
            }
        }
    }

    /**
     * 게시글 칸 안의 문단·목록·제목을 모두 맞춘다. 칸이 아직 화면에 안 보이면(폭 0) 아무것도 하지 않는다.
     * 예: window.promoMdFit(document.getElementById('promo-detail-content'))
     * @param {Element} el - .promo-md 가 걸린 게시글 보기 칸 @returns {void} [연계] ← promo.js openPromoDetail · 화면 폭 바뀜
     */
    function fit(el) {
        if (!el || !el.classList.contains('promo-md') || !el.getBoundingClientRect().width) return;
        lastEl = el;
        el.querySelectorAll(BLOCKS).forEach(fitBlock);
    }

    root.promoMdFit = fit;
    // 폰을 돌리거나 창 크기를 바꾸면 줄이 달라지므로 다시 맞춘다(보던 칸만)
    root.addEventListener('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () { if (lastEl && lastEl.isConnected) fit(lastEl); }, 150);
    });
})(window);
