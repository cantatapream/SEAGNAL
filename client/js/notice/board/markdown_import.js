/**
 * ============================================================================
 * 파일명: js/notice/board/markdown_import.js
 * 역할: 공지 게시판 관리자 글쓰기 — 마크다운(.md) 파일 내용을 게시글 본문(HTML)으로 바꾼다.
 *       글·사진만 꺼내고 모양(배경·글자색)은 게시판 화면이 정한다. 패치노트 작성 규칙은 저장소 맨 위 NOTICE.md.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : 없음
 *  - 서버 API      : 없음 (브라우저에서 파일을 읽어 바꾸기만 — 저장은 promo.js savePromoPost 그대로)
 *  - 마크업        : 없음 (promo.js 편집기 모달의 [마크다운 불러오기] 버튼이 부른다)
 *  - 나를 쓰는 곳  : promo.js openPromoEditor(불러오기 버튼) · local_server/scripts/test_notice_markdown.js(node 시험)
 * [로드 순서] promo.js 앞 (index2.html — image_compress.js 다음)
 * ============================================================================
 *
 * [받는 꼴] (게시판 편집기 Quill 1.3.6 이 담을 수 있는 것만 — 그 밖은 글자 그대로)
 *  # 제목(맨 처음에 있으면 게시글 제목으로 빼낸다) · ## / ### 소제목(#### 이상은 ###)
 *  문단(빈 줄로 나눔, 붙은 줄은 한 문단) · - / * 목록(앞 공백 2칸마다 한 단계 아래 — 3단계까지, Quill ql-indent-1·2) · 1. 번호 목록 · > 인용
 *  **굵게** · ==중요==(노랑 굵게) · !!주의!!(주황 굵게) · *기울임* / _기울임_ · [글](https://…) · `코드`(글자만) · ![설명](data:image/jpeg;base64,…)
 *  --- 가로줄·<!-- 메모 --> 는 뺀다. 날 HTML 은 글자로 보인다(꺾쇠를 바꿔 넣음).
 *  단계별 줄 간격·글자 크기·글자색은 넣지 않는다 — 게시판 화면 CSS(style.css `.promo-md`)가 마크다운 글(format:'md')에만 건다(편집기는 간격을 담지 못한다, §NOTICE.md 3).
 * [사진] 파일 안에 넣은 것(data:image/png·jpeg·webp·gif;base64)과 https 주소만. 그 밖(상대 경로 등)은 넣지 않고 warnings 에 남긴다.
 * [공개 API] window.noticeMarkdown.toHtml(md) → {title, html, warnings, images, bytes}
 */
(function (root) {
    'use strict';

    var STRONG = { '==': '#facc15', '!!': '#fb923c' };   // ==중요== 노랑 · !!주의!! 주황 — 앱 강조색(위험 4색의 노랑·주황)과 같다
    var IMG_OK = /^(?:data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+|https:\/\/[^\s"'<>]+)$/i;
    var LINK_OK = /^https?:\/\/[^\s"'<>]+$/i;

    /** 글자의 꺾쇠·따옴표를 바꿔 HTML 로 읽히지 않게 한다. 예: esc('<b>') → '&lt;b&gt;' @param {string} s @returns {string} [연계] ← inline */
    function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    /**
     * 한 줄 안의 꾸밈(사진·링크·굵게·기울임·코드)을 HTML 로. 사진 주소가 허용 꼴이 아니면 넣지 않고 warn 에 적는다.
     * 예: inline('**새 기능** [보기](https://a.b)', w) → '<strong>새 기능</strong> <a href="https://a.b">보기</a>'
     * @param {string} s - 한 줄(문단·목록 항목) @param {object} st - {warnings:[], images:0} @returns {string} [연계] ← block
     */
    function inline(s, st) {
        var keep = [];   // 사진·링크·코드는 먼저 떼어 두어 안의 * _ 를 꾸밈으로 읽지 않게 한다
        var put = function (h) { keep.push(h); return '\u0000' + (keep.length - 1) + '\u0000'; };
        s = s.replace(/!\[([^\]]*)\]\(\s*([^)\s]+)\s*\)/g, function (m, alt, src) {
            if (!IMG_OK.test(src)) { st.warnings.push('사진을 넣지 못함(파일 안에 넣은 사진·https 주소만): ' + (src.length > 60 ? src.slice(0, 60) + '…' : src)); return ''; }
            st.images++; return put('<img src="' + src.replace(/\s+/g, '') + '" alt="' + esc(alt) + '">');
        });
        s = s.replace(/\[([^\]]+)\]\(\s*([^)\s]+)\s*\)/g, function (m, text, href) { return LINK_OK.test(href) ? put('<a href="' + esc(href) + '">' + esc(text) + '</a>') : m; });
        s = s.replace(/`([^`]+)`/g, function (m, code) { return put(esc(code)); });
        s = esc(s)
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/(==|!!)([^=!]+?)\1/g, function (m, k, t) { return '<strong style="color: ' + STRONG[k] + ';">' + t + '</strong>'; })
            .replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\*)/g, '$1<em>$2</em>')
            .replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>');
        return s.replace(/\u0000(\d+)\u0000/g, function (m, i) { return keep[+i]; });
    }

    /**
     * 마크다운 글 전체를 게시글 본문 HTML 로 바꾼다.
     * 예: toHtml('# 10월 패치노트\n\n새 기능이 생겼어요.\n\n- 항목\n  - ==하위==') → {title:'10월 패치노트', html:'<p>새 기능이 생겼어요.</p><ul><li>항목</li><li class="ql-indent-1"><strong style="color: #facc15;">하위</strong></li></ul>', warnings:[], images:0, bytes:…}
     * @param {string} md - .md 파일 글 @returns {{title:string, html:string, warnings:string[], images:number, bytes:number}}
     * [연계] ← promo.js(불러오기 → Quill 에 채움 · title 은 제목 칸이 비었을 때만) · test_notice_markdown.js
     */
    function toHtml(md) {
        var st = { warnings: [], images: 0 }, out = [], title = '', para = [], list = null, quote = [];
        var lines = String(md || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n');
        var flushPara = function () { if (para.length) { out.push('<p>' + inline(para.join(' '), st) + '</p>'); para = []; } };
        var flushList = function () { if (list) { out.push('<' + list.tag + '>' + list.items.map(function (x) { return '<li' + (x.lv ? ' class="ql-indent-' + x.lv + '"' : '') + '>' + inline(x.text, st) + '</li>'; }).join('') + '</' + list.tag + '>'); list = null; } };
        var flushQuote = function () { if (quote.length) { out.push('<blockquote>' + inline(quote.join(' '), st) + '</blockquote>'); quote = []; } };
        var flush = function () { flushPara(); flushList(); flushQuote(); };
        lines.forEach(function (raw) {
            var line = raw.replace(/\s+$/, ''), m;
            if (!line.trim()) { flush(); return; }
            if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); return; }
            if ((m = /^\s*(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line))) {
                flush();
                if (m[1].length === 1 && !title && !out.length) { title = m[2].replace(/[*_`]/g, ''); return; }
                var lv = Math.min(3, Math.max(2, m[1].length)); out.push('<h' + lv + '>' + inline(m[2], st) + '</h' + lv + '>'); return;
            }
            if ((m = /^\s*>\s?(.*)$/.exec(line))) { flushPara(); flushList(); quote.push(m[1]); return; }
            if ((m = /^(\s*)(?:([-*+])|(\d+)[.)])\s+(.+)$/.exec(line))) {
                flushPara(); flushQuote(); var tag = m[2] ? 'ul' : 'ol', lv = Math.min(2, Math.floor(m[1].replace(/\t/g, '  ').length / 2));
                if (!list || list.tag !== tag) { flushList(); list = { tag: tag, items: [] }; }
                list.items.push({ lv: lv, text: m[4] }); return;
            }
            if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1].text += ' ' + line.trim(); return; }   // 목록 항목이 다음 줄로 이어짐(그 항목 들여쓰기보다 깊고 기호 없는 줄)
            flushList(); flushQuote(); para.push(line.trim());
        });
        flush();
        var html = out.join('');   // 덩어리 사이 간격은 화면 CSS(.promo-md) — 빈 줄을 끼우지 않는다
        return { title: title, html: html, warnings: st.warnings, images: st.images, bytes: html.length };
    }

    var api = { toHtml: toHtml };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.noticeMarkdown = api;
})(typeof window !== 'undefined' ? window : null);
