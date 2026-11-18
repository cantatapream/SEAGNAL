/**
 * ============================================================================
 * 파일명: js/shared/ui/wheel_date_picker.js
 * 역할: 앱의 모든 날짜칸(<input type="date">)·날짜시각칸(<input type="datetime-local">)을 누르면
 *       브라우저 기본 달력 대신 화면 아래에서 올라오는 휠(돌려서 고르는) 선택기를 띄운다.
 *       년·월·일(날짜시각칸이면 시·분까지)을 위아래로 굴려 고르고 [확인]을 누르면 칸에 들어간다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : core/backbutton.js 의 window.PopupStack(있으면 — 뒤로가기로 닫기)
 *  - 서버 API      : 없음
 *  - 마크업        : 동적 생성 #wdp-overlay (+ <style id="wdp-style">)
 *  - 나를 쓰는 곳  : 직접 부르는 곳 없음 — 문서 전체에 이벤트를 걸어 날짜칸 누름을 가로챈다.
 *                    지금 해당하는 칸: marine-life/safety/accident_info.js(사고정보 기간 직접 설정),
 *                    admin/admin_collect.js(통계·이용현황·CSV 기간, 공지 만료일 등),
 *                    admin/admin_survey.js(설문 기간), admin/admin.js(특보 발표시각·로그 조회 등),
 *                    admin/admin_trigger.js(공지 만료일)
 * [로드 순서] js/shared/ui/locate_toast.js 다음. 누를 때 동작하므로 날짜칸을 만드는 파일보다
 *            늦게 로드돼도 된다.
 * ============================================================================
 *
 * [왜 칸마다 고치지 않고 가로채나] 날짜칸이 5개 파일에 20곳 넘게 흩어져 있고 대부분 그때그때
 *   innerHTML 로 만들어진다. 칸은 그대로 두고(값 형식 "YYYY-MM-DD" 도 그대로) 누르는 순간만
 *   가로채면, 각 화면이 듣고 있는 change 이벤트와 .value 읽기가 손대지 않아도 그대로 동작한다.
 * [기본 달력이 안 뜨게 하는 법] 누르기 직전(pointerdown·focusin)에 readonly 를 붙이고,
 *   click 의 기본 동작을 막는다. readonly 는 원래 readonly 가 아니던 칸에만 붙이고 표시
 *   (data-wheel-armed)를 남긴다 — 원래부터 readonly·disabled 인 칸은 건드리지 않는다.
 * [빼고 싶은 칸] data-native-picker 속성을 붙이면 이 선택기가 손대지 않는다.
 * [사용자 요청 2026-11-18] 「날짜 선택하는 부분이 현재 캘린더 방식으로 되어있는데 휠 피커로
 *   년월일을 선택할 수 있도록 해줘」(사고정보 기간선택·통합관리자 통계 등 앱 전체).
 */
(function () {
    'use strict';

    var ITEM_H = 40;          // 한 줄 높이(px) — 아래 CSS 의 .wdp-item 높이와 같아야 한다
    var VISIBLE = 5;          // 보이는 줄 수(가운데 줄이 선택)
    var PAD = ITEM_H * Math.floor(VISIBLE / 2);
    var SELECTOR = 'input[type="date"], input[type="datetime-local"]';
    var WEEK = ['일', '월', '화', '수', '목', '금', '토'];

    var _state = null;        // 열려 있는 동안만: { input, withTime, cols, titleEl, overlay }

    /** 이 선택기가 맡을 칸인지 본다. 원래 readonly(우리가 붙인 것 말고)·disabled 는 뺀다. */
    function _isTarget(el) {
        if (!el || !el.matches || !el.matches(SELECTOR)) return false;
        if (el.disabled || el.hasAttribute('data-native-picker')) return false;
        if (el.readOnly && !el.hasAttribute('data-wheel-armed')) return false;
        return true;
    }

    /** 기본 달력이 뜨지 않도록 readonly 를 붙인다(한 번만). */
    function _arm(el) {
        if (el.hasAttribute('data-wheel-armed')) return;
        el.setAttribute('data-wheel-armed', '');
        el.readOnly = true;
    }

    function _pad2(n) { return (n < 10 ? '0' : '') + n; }
    function _daysIn(y, m) { return new Date(y, m, 0).getDate(); }   // m 은 1~12

    /**
     * 칸의 값 문자열을 숫자 묶음으로 바꾼다.
     * 예: "2026-11-18" → {y:2026,m:11,d:18,h:0,mi:0} / "2026-11-18T09:05" → {…h:9,mi:5}
     * @param {string} s - 칸 값(min·max 포함)
     * @returns {?Object} 형식이 아니면 null
     */
    function _parse(s) {
        var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(s || '');
        if (!m) return null;
        return { y: +m[1], m: +m[2], d: +m[3], h: m[4] ? +m[4] : 0, mi: m[5] ? +m[5] : 0 };
    }

    /** 숫자 묶음 → 칸 값 문자열("YYYY-MM-DD" 또는 "YYYY-MM-DDTHH:mm"). */
    function _format(p, withTime) {
        var s = p.y + '-' + _pad2(p.m) + '-' + _pad2(p.d);
        return withTime ? s + 'T' + _pad2(p.h) + ':' + _pad2(p.mi) : s;
    }

    function _range(a, b) { var r = []; for (var i = a; i <= b; i++) r.push(i); return r; }

    /** 스타일을 1회 넣는다. 색은 앱의 어두운 테마(style.css :root)와 맞췄다. */
    function _ensureStyle() {
        if (document.getElementById('wdp-style')) return;
        var st = document.createElement('style');
        st.id = 'wdp-style';
        st.textContent = [
            '#wdp-overlay { position: fixed; inset: 0; z-index: 2147483000; background: rgba(0,0,0,0.55);',
            '  display: flex; align-items: flex-end; justify-content: center; opacity: 0; transition: opacity .2s ease; }',
            '#wdp-overlay.show { opacity: 1; }',
            '#wdp-overlay .wdp-sheet { width: 100%; max-width: 480px; background: #141b2d; color: #fff;',
            '  border-radius: 16px 16px 0 0; border: 1px solid rgba(255,255,255,0.08); border-bottom: 0;',
            '  box-shadow: 0 -8px 30px rgba(0,0,0,0.5); font-family: inherit;',
            '  padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));',
            '  transform: translateY(100%); transition: transform .22s ease; }',
            '#wdp-overlay.show .wdp-sheet { transform: none; }',
            '#wdp-overlay .wdp-head { display: flex; align-items: center; justify-content: space-between;',
            '  padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.08); }',
            '#wdp-overlay .wdp-btn { background: none; border: 0; color: #94a3b8; font-size: 0.95rem;',
            '  padding: 6px 4px; cursor: pointer; font-family: inherit; min-width: 44px; }',
            '#wdp-overlay .wdp-btn.ok { color: #448aff; font-weight: 700; }',
            '#wdp-overlay .wdp-title { font-size: 0.95rem; font-weight: 700; text-align: center; }',
            '#wdp-overlay .wdp-body { position: relative; display: flex; gap: 4px; padding: 8px 12px; }',
            '#wdp-overlay .wdp-band { position: absolute; left: 12px; right: 12px; top: 50%; height: ' + ITEM_H + 'px;',
            '  margin-top: -' + (ITEM_H / 2) + 'px; border-radius: 10px; background: rgba(68,138,255,0.14);',
            '  border: 1px solid rgba(68,138,255,0.35); pointer-events: none; box-sizing: border-box; }',
            '#wdp-overlay .wdp-col { flex: 1; height: ' + (ITEM_H * VISIBLE) + 'px; overflow-y: scroll;',
            '  scroll-snap-type: y mandatory; overscroll-behavior: contain; -webkit-overflow-scrolling: touch;',
            '  scrollbar-width: none; position: relative; outline: none;',
            '  -webkit-mask-image: linear-gradient(to bottom, transparent, #000 32%, #000 68%, transparent);',
            '  mask-image: linear-gradient(to bottom, transparent, #000 32%, #000 68%, transparent); }',
            '#wdp-overlay .wdp-col::-webkit-scrollbar { display: none; }',
            '#wdp-overlay .wdp-col.y { flex: 1.4; }',
            '#wdp-overlay .wdp-pad { height: ' + PAD + 'px; }',
            '#wdp-overlay .wdp-item { height: ' + ITEM_H + 'px; line-height: ' + ITEM_H + 'px; text-align: center;',
            '  scroll-snap-align: center; color: rgba(255,255,255,0.38); font-size: 1rem; cursor: pointer;',
            '  user-select: none; -webkit-user-select: none; white-space: nowrap; }',
            '#wdp-overlay .wdp-item.sel { color: #fff; font-weight: 700; font-size: 1.08rem; }'
        ].join('\n');
        document.head.appendChild(st);
    }

    /**
     * 휠 한 줄(년·월·일·시·분 중 하나)을 만든다.
     * 예: _makeCol('m', [1..12], '월', 11) → "1월 … 12월" 목록, 11월이 가운데
     * @param {string} key - 'y'|'m'|'d'|'h'|'mi'
     * @param {number[]} values - 고를 수 있는 값들
     * @param {string} suffix - 값 뒤에 붙일 글자
     * @param {number} cur - 처음 가운데 둘 값
     * @returns {Object} { key, values, suffix, el, idx }
     */
    function _makeCol(key, values, suffix, cur) {
        var col = { key: key, values: values, suffix: suffix, el: document.createElement('div'), idx: 0 };
        col.el.className = 'wdp-col ' + key;
        col.el.setAttribute('data-key', key);
        _fillCol(col, cur);
        var timer = null, raf = 0;
        col.el.addEventListener('scroll', function () {
            // 굴리는 동안에도 가운데 줄 글자를 밝혀 준다
            if (!raf) raf = requestAnimationFrame(function () { raf = 0; _markSel(col, _idxFromScroll(col)); });
            clearTimeout(timer);
            timer = setTimeout(function () { _settle(col); }, 120);   // 멈추면 값 확정
        });
        col.el.addEventListener('click', function (e) {
            var it = e.target.closest('.wdp-item');
            if (!it) return;
            col.el.scrollTo({ top: +it.getAttribute('data-i') * ITEM_H, behavior: 'smooth' });
        });
        return col;
    }

    /** 줄의 항목을 (다시) 채우고 cur 값을 가운데로 둔다. 일(日) 줄은 달이 바뀔 때 다시 채운다. */
    function _fillCol(col, cur) {
        var html = '<div class="wdp-pad"></div>';
        for (var i = 0; i < col.values.length; i++) {
            var v = col.values[i];
            html += '<div class="wdp-item" data-i="' + i + '">' +
                (col.key === 'h' || col.key === 'mi' ? _pad2(v) : v) + col.suffix + '</div>';
        }
        col.el.innerHTML = html + '<div class="wdp-pad"></div>';
        var idx = col.values.indexOf(cur);
        col.idx = idx < 0 ? 0 : idx;
        _markSel(col, col.idx);
    }

    function _idxFromScroll(col) {
        var i = Math.round(col.el.scrollTop / ITEM_H);
        return Math.max(0, Math.min(col.values.length - 1, i));
    }

    function _markSel(col, idx) {
        var items = col.el.querySelectorAll('.wdp-item');
        for (var i = 0; i < items.length; i++) items[i].classList.toggle('sel', i === idx);
    }

    /** 굴리기가 멈췄을 때 값을 확정하고, 년·월이 바뀌었으면 일 줄 길이(28~31)를 맞춘다. */
    function _settle(col) {
        if (!_state) return;
        col.idx = _idxFromScroll(col);
        _markSel(col, col.idx);
        if (col.key === 'y' || col.key === 'm') _syncDays();
        _updateTitle();
    }

    function _cols() {
        var o = {};
        _state.cols.forEach(function (c) { o[c.key] = c; });
        return o;
    }

    /** 지금 휠 위치에서 고른 값 묶음. */
    function _picked() {
        var c = _cols(), p = {};
        _state.cols.forEach(function (col) { p[col.key] = col.values[_idxFromScroll(col)]; });
        if (!c.h) { p.h = 0; p.mi = 0; }
        p.d = Math.min(p.d, _daysIn(p.y, p.m));
        return p;
    }

    /** 일 줄을 고른 년·월의 날수에 맞춘다(예: 3월 31일 → 2월로 굴리면 28·29일). */
    function _syncDays() {
        var c = _cols();
        var y = c.y.values[_idxFromScroll(c.y)], m = c.m.values[_idxFromScroll(c.m)];
        var n = _daysIn(y, m);
        if (c.d.values.length === n) return;
        var d = Math.min(c.d.values[_idxFromScroll(c.d)], n);
        c.d.values = _range(1, n);
        _fillCol(c.d, d);
        c.d.el.scrollTop = c.d.idx * ITEM_H;
    }

    /** 머리줄에 지금 고른 날짜를 요일과 함께 보여 준다. 예: "2026년 11월 18일 (수) 09:05" */
    function _updateTitle() {
        var p = _picked();
        var t = p.y + '년 ' + p.m + '월 ' + p.d + '일 (' + WEEK[new Date(p.y, p.m - 1, p.d).getDay()] + ')';
        if (_state.withTime) t += ' ' + _pad2(p.h) + ':' + _pad2(p.mi);
        _state.titleEl.textContent = t;
    }

    /**
     * 날짜칸에 휠 선택기를 연다.
     * 예: 사고정보 기간의 시작일 칸을 누르면 → 그 칸 값(없으면 오늘)에 맞춰 휠이 올라온다
     * @param {HTMLInputElement} input - type=date 또는 datetime-local 칸
     * [연계] ← 아래 click·keydown 가로채기 / → _confirm 이 칸 값을 바꾸고 change 를 쏜다
     *        (각 화면은 원래 듣던 change 이벤트로 값을 받는다)
     */
    function open(input) {
        if (_state) close();
        _ensureStyle();
        // 칸에 포커스가 남으면 칸 안 '연도' 같은 한 조각이 파랗게 선택된 채 보인다(2026-11-18 화면 확인)
        input.blur();
        var withTime = input.type === 'datetime-local';
        var now = new Date();
        var cur = _parse(input.value) || { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate(),
            h: now.getHours(), mi: now.getMinutes() };
        var min = _parse(input.min), max = _parse(input.max);
        // 년 범위: min·max 가 있으면 그대로, 없으면 지금 값·올해 기준 앞 20년 ~ 뒤 5년
        var y0 = min ? min.y : Math.min(cur.y, now.getFullYear()) - 20;
        var y1 = max ? max.y : Math.max(cur.y, now.getFullYear()) + 5;
        cur.y = Math.max(y0, Math.min(y1, cur.y));

        var overlay = document.createElement('div');
        overlay.id = 'wdp-overlay';
        overlay.innerHTML =
            '<div class="wdp-sheet" role="dialog" aria-modal="true">' +
            '<div class="wdp-head">' +
            '<button type="button" class="wdp-btn cancel">취소</button>' +
            '<div class="wdp-title"></div>' +
            '<button type="button" class="wdp-btn ok">확인</button>' +
            '</div><div class="wdp-body"><div class="wdp-band"></div></div></div>';
        var body = overlay.querySelector('.wdp-body');

        var cols = [
            _makeCol('y', _range(y0, y1), '년', cur.y),
            _makeCol('m', _range(1, 12), '월', cur.m),
            _makeCol('d', _range(1, _daysIn(cur.y, cur.m)), '일', Math.min(cur.d, _daysIn(cur.y, cur.m)))
        ];
        if (withTime) {
            cols.push(_makeCol('h', _range(0, 23), '시', cur.h));
            cols.push(_makeCol('mi', _range(0, 59), '분', cur.mi));
        }
        cols.forEach(function (c) { body.appendChild(c.el); });

        _state = { input: input, withTime: withTime, cols: cols, overlay: overlay,
            titleEl: overlay.querySelector('.wdp-title'), min: input.min, max: input.max };

        overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
        overlay.querySelector('.cancel').addEventListener('click', close);
        overlay.querySelector('.ok').addEventListener('click', _confirm);

        document.body.appendChild(overlay);
        // 붙인 뒤에야 스크롤 위치를 줄 수 있다
        cols.forEach(function (c) { c.el.scrollTop = c.idx * ITEM_H; });
        _updateTitle();
        requestAnimationFrame(function () { overlay.classList.add('show'); });
        if (window.PopupStack) window.PopupStack.push('wheel-date-picker', close);
    }

    /** [확인] — 고른 값을 칸에 넣고 input·change 이벤트를 쏜 뒤 닫는다. min·max 를 넘으면 그 끝으로 맞춘다. */
    function _confirm() {
        if (!_state) return;
        var s = _state;
        var v = _format(_picked(), s.withTime);
        // 같은 형식의 문자열이라 크기 비교가 날짜 비교와 같다
        if (s.min && v < s.min) v = s.min;
        if (s.max && v > s.max) v = s.max;
        var changed = s.input.value !== v;
        s.input.value = v;
        close();
        if (changed) {
            s.input.dispatchEvent(new Event('input', { bubbles: true }));
            s.input.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    /** 선택기를 닫는다(값은 바꾸지 않는다). */
    function close() {
        if (!_state) return;
        var ov = _state.overlay;
        _state = null;
        if (window.PopupStack) window.PopupStack.remove('wheel-date-picker');
        ov.classList.remove('show');
        setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 220);
    }

    // ── 가로채기: 누르기 직전에 readonly 를 붙이고, 누르면 휠을 연다 ──────────────
    function _onArm(e) { if (_isTarget(e.target)) _arm(e.target); }
    document.addEventListener('pointerdown', _onArm, true);
    document.addEventListener('touchstart', _onArm, { capture: true, passive: true });
    document.addEventListener('focusin', _onArm, true);
    // 칸에 포커스가 가면 칸 안 '연도' 같은 한 조각이 파랗게 선택된 채 남는다(blur 로도 안 지워짐,
    // 2026-11-18 화면 확인) — 누를 때 포커스가 아예 안 가게 막는다. click 은 그대로 온다.
    document.addEventListener('mousedown', function (e) { if (_isTarget(e.target)) e.preventDefault(); }, true);
    document.addEventListener('click', function (e) {
        if (!_isTarget(e.target)) return;
        _arm(e.target);
        e.preventDefault();
        open(e.target);
    }, true);
    document.addEventListener('keydown', function (e) {
        if (_state && e.key === 'Escape') { close(); return; }
        if (_state && e.key === 'Enter' && !e.target.closest('.wdp-btn') && !e.target.matches(SELECTOR)) { e.preventDefault(); _confirm(); return; }
        if ((e.key === 'Enter' || e.key === ' ') && _isTarget(e.target)) {
            e.preventDefault();
            _arm(e.target);
            open(e.target);
        }
    }, true);

    window.WheelDatePicker = { open: open, close: close };
})();
