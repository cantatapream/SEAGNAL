/**
 * ============================================================================
 * 파일명: js/tutorial/tutorial.js
 * 역할: 첫 사용자 온보딩 튜토리얼 — 지금은 "시험 모드"로만 열린다
 * ============================================================================
 *
 * [개요 - 초보자 안내]
 * 앱을 처음 켠 사람에게 화면 사용법을 안내하는 튜토리얼입니다.
 * 아직 만드는 중이라 **일반 사용자에게는 절대 보이지 않고**, 숨은 진입로로만 열립니다.
 *
 * [숨은 진입로]
 * 화면 맨 아래 **「공지사항」 탭을 3초 안에 5번 연달아** 누르면 열립니다.
 * 공지사항 탭은 원래 누르라고 있는 버튼이라 오래 붙들고 있으면 실수로 5번이 채워질 수
 * 있어, 관리자 진입(헤더 15연타, promo.js) 과 같은 방식으로 **3초 제한**을 둡니다.
 * 3초가 지나면 세던 수는 0으로 돌아갑니다.
 *
 * [지금 들어 있는 것 — 1단계: 문과 빈 틀]
 * 이 파일은 아직 "열리고 닫히는 껍데기"까지만 합니다.
 *   - 연타를 세어 튜토리얼을 연다
 *   - 화면 전체를 덮어 **안내 중에는 사용자의 터치를 막는다** (사용자 확정 2026-09-22)
 *   - 설명 카드 + [튜토리얼 종료하기] / [이전] / [다음] 한 줄
 *   - 닫으면 덮개를 완전히 걷어내 앱을 원래대로 되돌린다
 * 실제 안내 내용(아코디언을 스스로 열고, 버튼을 눌러 보이고, 탭을 옮기는 것)은
 * 다음 단계에서 이 틀 안에 채웁니다.
 *
 * [왜 터치를 막나]
 * 앞으로 이 튜토리얼은 아코디언을 열고 버튼을 누르며 탭을 옮깁니다. 그 도중에
 * 사용자가 화면을 만지면 순서가 엉킵니다. 그래서 안내 중에는 아래 세 버튼만 받습니다.
 *
 * [연계 파일]
 * - client/index2.html → 하단 메인탭의 공지사항 버튼(.tab-btn[data-target="promo-section"])
 * - js/notice/board/promo.js → 같은 방식(3초 안에 N번)의 관리자 진입 선례
 * - (예정) js/forecast/alerts/render.js · js/forecast/outlook/windy.js —
 *   앞으로 이 튜토리얼이 눌러 보일 카드·버튼들이 있는 곳
 *
 * [로드 순서]
 * index2.html 맨 끝, life_safety.js 다음. 앞으로 다른 화면을 조작해야 하므로
 * 조작 대상 스크립트가 모두 올라온 뒤에 실행되어야 합니다.
 * IIFE(즉시실행함수)로 감싸 전역을 더럽히지 않고, window.openTutorial 만 노출합니다.
 * ============================================================================
 */

(function () {
    'use strict';

    // ========================================================================
    // [상수]
    // ========================================================================
    var TAP_COUNT     = 5;      // 튜토리얼을 여는 연타 횟수
    var TAP_WINDOW_MS = 3000;   // 이 시간 안에 TAP_COUNT 번을 채워야 한다

    // 색·글꼴은 앱 기존 화면(index2.html · style.css)에서 그대로 가져온 값
    var C_CARD   = '#1c2338';
    var C_ACCENT = '#448aff';
    var C_TEXT   = '#cbd5e1';
    var C_SUB    = '#94a3b8';
    var C_BORDER = 'rgba(255,255,255,0.12)';
    var FONT     = "'Inter','Noto Sans KR',sans-serif";

    // ========================================================================
    // [단계 목록] — 지금은 틀이 열리고 넘어가는지 확인하기 위한 자리표시용
    //   다음 단계에서 각 항목에 "무엇을 강조할지 / 무엇을 눌러 볼지"가 붙습니다.
    // ========================================================================
    var STEPS = [
        {
            title: '튜토리얼 시험 모드',
            body: '이 화면은 공지사항 탭을 3초 안에 5번 눌러야 열립니다. '
                + '일반 사용자에게는 보이지 않습니다.'
        },
        {
            title: '아직 틀만 있습니다',
            body: '지금은 열리고·넘어가고·닫히는 것까지만 확인하는 단계입니다. '
                + '실제 안내(기상 전망 아코디언을 열고, 특보 구역을 펼치고, '
                + '해양종합정보 탭으로 넘어가는 것)는 다음 단계에서 이 자리에 들어갑니다.'
        },
        {
            title: '안내 중에는 화면이 잠깁니다',
            body: '앞으로 튜토리얼이 스스로 아코디언을 열고 버튼을 누르기 때문에, '
                + '도중에 화면을 만지면 순서가 엉킵니다. 그래서 아래 세 버튼만 받습니다. '
                + '[튜토리얼 종료하기]를 누르면 앱이 원래대로 돌아옵니다.'
        }
    ];

    // ========================================================================
    // [상태]
    // ========================================================================
    var _tapCount = 0;
    var _tapTimer = null;
    var _root     = null;   // 열려 있는 동안의 덮개 DOM (닫히면 null)
    var _stepIdx  = 0;

    // ========================================================================
    // [화면 만들기]
    // ========================================================================

    /**
     * 튜토리얼 덮개를 만들어 화면에 붙인다.
     *
     * 무엇을 하나?
     *   화면 전체를 덮는 반투명 판 + 설명 카드 + 버튼 세 개를 만들어 body 에 붙인다.
     *   덮개가 터치를 모두 받아 내므로 아래 앱 화면은 눌리지 않는다.
     *
     * 왜 스타일을 코드 안에 쓰나?
     *   아직 시험 단계라 언제든 통째로 걷어낼 수 있어야 해서, style.css 를 건드리지 않고
     *   이 파일 안에서만 끝낸다. 정식 공개 때 style.css 로 옮긴다.
     *
     * [연계] 닫기는 _close() 가 이 함수가 만든 _root 를 통째로 지운다.
     *
     * @returns {HTMLElement} 만들어 붙인 덮개 요소
     */
    function _build() {
        var root = document.createElement('div');
        root.id = 'tutorial-overlay';
        root.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:20000',
            'background:rgba(6,11,24,0.78)',
            'display:flex', 'flex-direction:column', 'justify-content:flex-end',
            'padding:20px', 'box-sizing:border-box',
            'font-family:' + FONT, 'color:#fff'
        ].join(';');

        var card = document.createElement('div');
        card.style.cssText = [
            'background:' + C_CARD, 'border:1px solid ' + C_BORDER, 'border-radius:14px',
            'padding:18px 18px 14px', 'box-shadow:0 18px 50px rgba(0,0,0,0.5)',
            'max-height:60vh', 'overflow:auto'
        ].join(';');

        var badge = document.createElement('div');
        badge.id = 'tutorial-step-badge';
        badge.style.cssText = 'font-size:0.7rem;font-weight:700;letter-spacing:1px;color:'
            + C_ACCENT + ';margin-bottom:6px;';

        var title = document.createElement('h3');
        title.id = 'tutorial-step-title';
        title.style.cssText = 'margin:0 0 8px;font-size:1.05rem;font-weight:700;color:#fff;';

        var body = document.createElement('p');
        body.id = 'tutorial-step-body';
        body.style.cssText = 'margin:0;font-size:0.88rem;line-height:1.65;color:' + C_TEXT + ';';

        card.appendChild(badge);
        card.appendChild(title);
        card.appendChild(body);

        // 버튼 한 줄: [종료] ......... [이전] [다음]
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:14px;';

        var quitBtn = _mkBtn('튜토리얼 종료하기', 'quit');
        quitBtn.addEventListener('click', _close);

        var spacer = document.createElement('div');
        spacer.style.cssText = 'flex:1;';

        var prevBtn = _mkBtn('이전', 'prev');
        prevBtn.id = 'tutorial-prev-btn';
        prevBtn.addEventListener('click', function () { _go(_stepIdx - 1); });

        var nextBtn = _mkBtn('다음', 'next');
        nextBtn.id = 'tutorial-next-btn';
        nextBtn.addEventListener('click', function () {
            if (_stepIdx >= STEPS.length - 1) { _close(); return; }
            _go(_stepIdx + 1);
        });

        row.appendChild(quitBtn);
        row.appendChild(spacer);
        row.appendChild(prevBtn);
        row.appendChild(nextBtn);
        card.appendChild(row);

        root.appendChild(card);
        return root;
    }

    /**
     * 튜토리얼 버튼 하나를 만든다.
     *
     * 예시: _mkBtn('다음', 'next') → 파란 [다음] 버튼
     *
     * @param {string} label - 버튼에 쓸 글자
     * @param {string} kind  - 'quit'(종료) | 'prev'(이전) | 'next'(다음). 색이 달라진다.
     * @returns {HTMLButtonElement}
     * [연계] _build() 가 버튼 세 개를 만들 때만 쓴다.
     */
    function _mkBtn(label, kind) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        var base = 'padding:9px 14px;border-radius:8px;font-size:0.82rem;font-weight:600;'
            + 'cursor:pointer;font-family:' + FONT + ';white-space:nowrap;';
        if (kind === 'next') {
            b.style.cssText = base + 'background:' + C_ACCENT + ';color:#fff;border:none;';
        } else if (kind === 'prev') {
            b.style.cssText = base + 'background:transparent;color:' + C_TEXT
                + ';border:1px solid ' + C_BORDER + ';';
        } else {
            b.style.cssText = base + 'background:transparent;color:' + C_SUB
                + ';border:1px solid ' + C_BORDER + ';';
        }
        return b;
    }

    // ========================================================================
    // [단계 이동]
    // ========================================================================

    /**
     * 주어진 번호의 단계를 화면에 그린다.
     *
     * 무엇을 하나?
     *   설명 카드의 글자를 그 단계 내용으로 바꾸고, 첫 단계면 [이전]을 흐리게,
     *   마지막 단계면 [다음] 글자를 '완료'로 바꾼다.
     *
     * @param {number} idx - 0 부터 시작하는 단계 번호. 범위를 벗어나면 무시한다.
     * [연계] [이전]/[다음] 버튼과 _open() 이 호출한다.
     */
    function _go(idx) {
        if (!_root) return;
        if (idx < 0 || idx >= STEPS.length) return;
        _stepIdx = idx;
        var s = STEPS[idx];

        _root.querySelector('#tutorial-step-badge').textContent =
            (idx + 1) + ' / ' + STEPS.length;
        _root.querySelector('#tutorial-step-title').textContent = s.title;
        _root.querySelector('#tutorial-step-body').textContent  = s.body;

        var prev = _root.querySelector('#tutorial-prev-btn');
        var next = _root.querySelector('#tutorial-next-btn');
        // 첫 단계에서는 [이전]을 못 누르게 한다(뒤로 갈 곳이 없다).
        prev.disabled = (idx === 0);
        prev.style.opacity = prev.disabled ? '0.35' : '1';
        prev.style.cursor  = prev.disabled ? 'default' : 'pointer';
        next.textContent = (idx === STEPS.length - 1) ? '완료' : '다음';
    }

    // ========================================================================
    // [열기 / 닫기]
    // ========================================================================

    /**
     * 튜토리얼을 연다. 이미 열려 있으면 아무것도 하지 않는다.
     * [연계] 공지사항 탭 연타 트리거와 window.openTutorial 이 호출한다.
     */
    function _open() {
        if (_root) return;
        _root = _build();
        document.body.appendChild(_root);
        _go(0);
    }

    /**
     * 튜토리얼을 닫고 앱을 원래대로 되돌린다.
     *
     * 무엇을 하나?
     *   덮개를 통째로 지운다. 덮개가 사라지면 아래 화면의 터치도 곧바로 살아난다.
     *   앞으로 튜토리얼이 아코디언·팝업을 건드리게 되면, 여기서 그것들도 함께
     *   원래 상태로 되돌려야 한다(지금은 건드리는 것이 없어 지우기만 한다).
     */
    function _close() {
        if (!_root) return;
        _root.remove();
        _root = null;
        _stepIdx = 0;
    }

    // ========================================================================
    // [숨은 진입로] 공지사항 탭 3초 안에 5연타
    // ========================================================================

    /**
     * 하단 공지사항 탭 버튼에 연타 감지를 붙인다.
     *
     * 무엇을 하나?
     *   사용자가 실제로 누른 클릭만 세고, 마지막 클릭으로부터 3초가 지나면 0으로
     *   되돌린다. 3초 안에 5번이 채워지면 튜토리얼을 연다.
     *   탭 전환 자체는 막지 않으므로 평소처럼 공지사항 화면이 열린다.
     *
     * 왜 사용자 클릭만 세나?
     *   코드가 프로그램적으로 부르는 .click() 까지 세면, 다른 기능이 탭을 옮길 때
     *   엉뚱하게 튜토리얼이 열린다. promo.js 의 관리자 진입도 같은 방식으로 거른다.
     *
     * [연계] index2.html 하단 메인탭 `.tab-btn[data-target="promo-section"]`
     */
    function _bindTrigger() {
        var btn = document.querySelector('.tab-btn[data-target="promo-section"]');
        if (!btn) return;   // 공지사항 탭이 없는 페이지(index1 등)면 아무 일도 안 한다

        btn.addEventListener('click', function (e) {
            if (!(e.detail > 0 || e.isTrusted)) return;   // 사용자 클릭만
            if (_root) return;                            // 이미 열려 있으면 세지 않는다

            _tapCount++;
            clearTimeout(_tapTimer);
            _tapTimer = setTimeout(function () { _tapCount = 0; }, TAP_WINDOW_MS);

            if (_tapCount >= TAP_COUNT) {
                _tapCount = 0;
                clearTimeout(_tapTimer);
                _open();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _bindTrigger);
    } else {
        _bindTrigger();
    }

    // 시험·디버그용: 콘솔에서 바로 열어 볼 수 있게 열기 함수만 노출한다.
    window.openTutorial = _open;
})();
