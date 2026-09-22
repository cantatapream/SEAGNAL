/**
 * ============================================================================
 * 파일명: js/tutorial/tutorial.js
 * 역할: 첫 사용자 온보딩 튜토리얼 — 지금은 "시험 모드"로만 열린다
 * ============================================================================
 *
 * [개요 - 초보자 안내]
 * 앱을 처음 켠 사람에게 화면 사용법을 안내하는 튜토리얼입니다.
 * 미리 찍어 둔 사진을 넘기는 방식이 아니라, **실제 앱을 자동으로 조작하면서**
 * (아코디언을 스스로 열고, 버튼을 눌러 보이고, 탭을 옮기면서) 그 옆에 설명을 답니다.
 * 아직 만드는 중이라 **일반 사용자에게는 보이지 않고**, 숨은 진입로로만 열립니다.
 *
 * [숨은 진입로]
 * 화면 맨 아래 **「공지사항」 탭을 3초 안에 5번 연달아** 누르면 열립니다.
 * 공지사항 탭은 원래 누르라고 있는 버튼이라 시간 제한이 없으면 실수로 5번이 채워질 수
 * 있어, 관리자 진입(헤더 15연타, promo.js) 과 같은 방식으로 3초 제한을 둡니다.
 *
 * [화면 구성]
 *   - 덮개(_root)        : 화면 전체를 덮어 안내 중 사용자의 터치를 막는다
 *   - 구멍(_hole)        : 설명 중인 부분만 뚫어 밝게 남기고, 테두리를 깜빡인다
 *                          (바깥을 어둡게 하는 것은 box-shadow 한 장으로 처리)
 *   - 설명 카드(_card)   : 구멍 바로 아래(공간이 없으면 위)에 붙는다
 *   - 버튼 한 줄         : [튜토리얼 종료하기] / [이전] / [다음]
 *
 * [★시간으로 기다리지 않는다]
 * "0.5초 뒤에 다음 단계" 같은 식으로 만들면 느린 기기·느린 회선에서 그대로 깨집니다
 * (해구기상 격자가 실제로 그렇게 깨졌습니다 — _LESSONS.md L-306).
 * 그래서 각 단계는 _when() 으로 **화면에 실제로 나타났는지 확인한 뒤** 그립니다.
 *
 * [지금까지 만든 단계 — 특보정보 탭 1~3]
 *   1. 기상청 바로가기(통보문·특보종합) 소개 — 누르지 않고 위치만 알린다
 *   2. 기상청 해상 기상 전망 아코디언을 스스로 펼친다
 *   3. 그 아코디언을 스스로 닫고 해역별 특보현황으로 넘어간다
 * 이 뒤(특보 유무에 따라 구역을 펼쳐 들어가는 부분부터)는 다음 단계에서 잇습니다.
 *
 * [되돌리기 — 이전 버튼]
 * 각 단계는 "그 단계에 필요한 화면 상태"를 want 로 통째로 적어 둡니다(어느 아코디언이
 * 열려 있어야 하는지). 그래서 앞으로 가든 뒤로 가든 그 want 대로 맞추기만 하면
 * 화면이 제자리를 찾습니다 — 되돌리는 절차를 따로 만들 필요가 없습니다.
 * 튜토리얼을 닫을 때는 열기 전에 적어 둔 원래 상태(_snapshot)로 되돌립니다.
 *
 * [연계 파일]
 * - client/index2.html → 하단 메인탭 공지사항 버튼 / 기상청 바로가기 위젯 /
 *                        기상 전망·해역별 특보현황 아코디언 마크업
 * - js/forecast/outlook/marine_forecast.js → toggleMarineForecastAccordion
 * - js/forecast/alerts/data.js             → toggleMainAccordion
 * - js/forecast/outlook/windy.js           → toggleMarineStatusAccordion
 * - js/forecast/alerts/marine.js           → switchMainTab (특보정보 탭으로 이동)
 * - js/notice/board/promo.js               → 같은 방식(3초 안에 N번)의 관리자 진입 선례
 *
 * [로드 순서]
 * index2.html 맨 끝, life_safety.js 다음. 다른 화면을 조작하므로 조작 대상 스크립트가
 * 모두 올라온 뒤에 실행되어야 합니다.
 * IIFE 로 감싸 전역을 더럽히지 않고 window.openTutorial 만 노출합니다.
 * ============================================================================
 */

(function () {
    'use strict';

    // ========================================================================
    // [상수]
    // ========================================================================
    var TAP_COUNT     = 5;       // 튜토리얼을 여는 연타 횟수
    var TAP_WINDOW_MS = 3000;    // 이 시간 안에 TAP_COUNT 번을 채워야 한다
    var WAIT_CAP_MS   = 30000;   // _when() 이 기다려 주는 최대 시간(그 뒤엔 그냥 진행)

    var GAP      = 12;   // 구멍과 설명 카드 사이 간격(px)
    var EDGE     = 12;   // 화면 가장자리에서 띄울 여백(px)
    var CARD_MAX = 420;  // 설명 카드 최대 너비(px)

    // 색·글꼴은 앱 기존 화면(index2.html · style.css)에서 그대로 가져온 값
    var C_CARD   = '#1c2338';
    var C_ACCENT = '#448aff';
    var C_TEXT   = '#cbd5e1';
    var C_SUB    = '#94a3b8';
    var C_BORDER = 'rgba(255,255,255,0.12)';
    var C_DIM    = 'rgba(6,11,24,0.78)';   // 설명 대상 바깥을 덮는 어두운 색
    var FONT     = "'Inter','Noto Sans KR',sans-serif";

    // 아코디언 = [본문 id, 여는/닫는 함수 이름]
    var ACC_FORECAST = ['marine-forecast-accordion-body', 'toggleMarineForecastAccordion'];
    var ACC_ALERT    = ['main-accordion-body',            'toggleMainAccordion'];
    var ACC_STATUS   = ['marine-status-accordion-body',   'toggleMarineStatusAccordion'];

    // ========================================================================
    // [상태]
    // ========================================================================
    var _tapCount = 0;
    var _tapTimer = null;
    var _root     = null;   // 덮개 (닫히면 null)
    var _hole     = null;
    var _card     = null;
    var _stepIdx  = 0;
    var _snapshot = null;   // 열기 전 화면 상태(닫을 때 되돌리려고 적어 둔다)
    var _repaintQueued = false;

    // ========================================================================
    // [작은 도구들]
    // ========================================================================

    /**
     * 어떤 조건이 참이 될 때까지 기다렸다가 다음 일을 한다.
     *
     * 무엇을 하나?
     *   매 화면 갱신(약 1/60초)마다 cond() 를 확인하고, 참이 되면 done() 을 부른다.
     *   30초가 지나도 참이 안 되면 그냥 done() 을 불러 튜토리얼이 멈추지 않게 한다.
     *
     * 예시: _when(function () { return el.offsetHeight > 0; }, paint)
     *
     * 왜 필요한가?
     *   "0.5초 뒤에 다음"처럼 시간으로 기다리면 느린 기기에서 아직 안 나타난 빈 곳을
     *   가리키게 된다. 같은 종류의 사고가 해구기상 격자에서 실제로 났다(L-306).
     *
     * @param {Function} cond - 참/거짓을 돌려주는 함수
     * @param {Function} done - 조건이 참이 됐을 때 할 일
     * [연계] _go() 가 각 단계를 그리기 직전에 쓴다.
     */
    function _when(cond, done) {
        var started = Date.now();
        (function tick() {
            if (!_root) return;                       // 기다리는 사이 닫혔으면 그만둔다
            if (cond() || Date.now() - started > WAIT_CAP_MS) { done(); return; }
            requestAnimationFrame(tick);
        })();
    }

    /**
     * 대상의 화면 위치가 "더 이상 움직이지 않을 때"까지 기다렸다가 다음 일을 한다.
     *
     * 무엇을 하나?
     *   매 화면 갱신마다 대상의 좌표를 재서, 연속 3번 같은 자리면 멈춘 것으로 보고 done()
     *   을 부른다. 30초가 지나면 그냥 done() 을 부른다.
     *
     * 왜 필요한가?
     *   아코디언은 0.4초에 걸쳐 스르르 열리고 닫힌다(style.css 의 transition).
     *   토글한 직후에 자리를 재면 **애니메이션 도중의 위치**를 잡아, 구멍이 엉뚱한 곳에
     *   생긴다(실제로 3단계에서 384px 어긋났다). 스크롤이 뒤늦게 멈추는 경우도 같다.
     *   "0.4초 기다리기"로 때우지 않는 이유는 L-306 과 같다 — 느린 기기에서 그대로 깨진다.
     *
     * @param {Function} getEl - 대상 요소를 돌려주는 함수(중간에 다시 그려질 수 있어 함수로 받는다)
     * @param {Function} done  - 자리가 멈췄을 때 할 일
     * [연계] _go() 가 구멍·카드를 놓기 직전에 쓴다.
     */
    function _whenStable(getEl, done) {
        var started = Date.now();
        var last = null;
        var same = 0;
        (function tick() {
            if (!_root) return;
            var el = getEl();
            var r = el ? el.getBoundingClientRect() : null;
            var key = r ? [Math.round(r.top), Math.round(r.left), Math.round(r.width), Math.round(r.height)].join(',') : 'none';
            same = (key === last) ? same + 1 : 0;
            last = key;
            if (same >= 3 || Date.now() - started > WAIT_CAP_MS) { done(); return; }
            requestAnimationFrame(tick);
        })();
    }

    /**
     * 아코디언이 지금 펼쳐져 있는지 본다.
     * @param {Array} acc - ACC_* 상수 ([본문 id, 토글 함수 이름])
     * @returns {boolean} 펼쳐져 있으면 true (본문에 collapsed 클래스가 없으면 펼침)
     */
    function _isOpen(acc) {
        var body = document.getElementById(acc[0]);
        return !!body && !body.classList.contains('collapsed');
    }

    /**
     * 아코디언 본문이 지금 화면에서 차지하는 높이를 잰다.
     * @param {Array} acc - ACC_* 상수
     * @returns {number} 픽셀 높이 (접힌 상태면 0)
     * [연계] _settled() 가 여닫기가 끝났는지 볼 때 쓴다.
     */
    function _accHeight(acc) {
        var body = document.getElementById(acc[0]);
        return body ? body.offsetHeight : 0;
    }

    /**
     * 아코디언 세 개가 원하는 모양(want)에 **실제로 도달했는지** 본다.
     *
     * 왜 클래스가 아니라 높이를 보나?
     *   클래스는 누르는 즉시 바뀌지만 화면은 0.4초에 걸쳐 스르르 움직인다
     *   (style.css 의 transition). 게다가 접힐 때는 max-height 가 8000px→0 으로 줄어드는
     *   동안 한참은 **높이가 전혀 안 줄어든다**(내용보다 큰 구간). 그래서 "좌표가 3프레임
     *   같으면 멈춘 것"이라는 판정만으로는 애니메이션 초반을 멈춘 것으로 착각한다
     *   (실제로 3단계 구멍이 384px 어긋났다). 높이가 0 이 되는 것까지 봐야 확실하다.
     *
     * @param {Object} want - {forecast:boolean, alert:boolean, status:boolean} — true=펼침
     * @returns {boolean} 셋 다 원하는 모양이면 true
     * [연계] _go() 가 구멍을 그리기 전에 기다리는 조건으로 쓴다.
     */
    function _settled(want) {
        return (want.forecast ? _accHeight(ACC_FORECAST) > 0 : _accHeight(ACC_FORECAST) === 0)
            && (want.alert    ? _accHeight(ACC_ALERT)    > 0 : _accHeight(ACC_ALERT)    === 0)
            && (want.status   ? _accHeight(ACC_STATUS)   > 0 : _accHeight(ACC_STATUS)   === 0);
    }

    /**
     * 아코디언을 원하는 상태로 맞춘다. 이미 그 상태면 아무것도 하지 않는다.
     *
     * 왜 클래스를 직접 건드리지 않고 토글 함수를 부르나?
     *   토글 함수가 본문·머리글 화살표·사용량 집계까지 함께 맞춰 주기 때문이다.
     *   클래스만 바꾸면 머리글 화살표가 반대로 남는다.
     *
     * @param {Array} acc    - ACC_* 상수
     * @param {boolean} open - true=펼침, false=접음
     * [연계] _go() 가 단계의 want 대로 화면을 맞출 때 쓴다.
     */
    function _setAccordion(acc, open) {
        if (_isOpen(acc) === open) return;
        var fn = window[acc[1]];
        if (typeof fn === 'function') fn();
    }

    /**
     * 설명할 대상을 화면 가운데로 끌어온다.
     * @param {HTMLElement} el - 보이게 할 요소
     * [연계] _go() 가 단계를 그리기 전에 호출. 부드러운 스크롤(smooth)은 위치가
     *        언제 멈출지 알 수 없어 쓰지 않는다(즉시 이동).
     */
    function _scrollIntoView(el) {
        if (!el || !el.scrollIntoView) return;
        try { el.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (e) { el.scrollIntoView(); }
    }

    // ========================================================================
    // [단계 목록] — 특보정보 탭 1~3
    //   target : 밝게 남길 요소 (없으면 화면 전체가 어두워진다)
    //   want   : 이 단계에서 아코디언 셋이 각각 펼쳐져 있어야 하는지 (true=펼침)
    //            앞/뒤 어느 쪽에서 오든 이 모양으로 맞추므로 [이전] 이 저절로 동작한다
    // ========================================================================
    var STEPS = [
        {
            title: '기상청 바로가기',
            body: '기상청이 직접 내는 「통보문」과 「특보종합」을 바로 열어 볼 수 있습니다. '
                + '앱이 정리해 주는 정보 말고 원문을 그대로 보고 싶을 때 씁니다.',
            target: function () { return document.querySelector('.kma-shortcut-widget'); },
            want: { forecast: false, alert: false, status: false }
        },
        {
            title: '기상청 해상 기상 전망',
            body: '앞으로 바다 날씨가 어떻게 될지 기상청 예보를 정리해 보여줍니다. '
                + '눌러서 펼치면 종합 예보 · 초단기 전망 · 단기 전망이 차례로 나옵니다.',
            target: function () { return document.getElementById('marine-forecast-accordion-header'); },
            want: { forecast: true, alert: false, status: false }
        },
        {
            title: '해역별 특보현황',
            body: '지금 어느 바다에 풍랑·태풍 같은 특보가 내려져 있는지 모아 놓은 곳입니다. '
                + '동해 · 서해 · 남해 · 제주로 나뉘고, 그 안에서 우리 해역까지 펼쳐 볼 수 있습니다.',
            target: function () { return document.getElementById('main-accordion-header'); },
            want: { forecast: false, alert: false, status: false }
        }
    ];

    // ========================================================================
    // [화면 만들기]
    // ========================================================================

    /**
     * 깜빡이는 테두리에 쓸 keyframes 를 한 번만 심는다.
     * [연계] _build() 에서 호출. 덮개를 지워도 이 style 은 남지만 크기가 작아 그대로 둔다.
     */
    function _ensureKeyframes() {
        if (document.getElementById('tutorial-keyframes')) return;
        var st = document.createElement('style');
        st.id = 'tutorial-keyframes';
        st.textContent = '@keyframes tutorialRingBlink{0%,100%{border-color:' + C_ACCENT
            + '}50%{border-color:rgba(68,138,255,0.15)}}';
        document.head.appendChild(st);
    }

    /**
     * 덮개 · 구멍 · 설명 카드를 만들어 화면에 붙인다.
     *
     * 무엇을 하나?
     *   화면 전체를 덮는 투명한 판(_root)을 깔아 터치를 모두 받아 내고, 그 위에
     *   설명 대상 자리에 구멍(_hole)을 둔다. 구멍 바깥이 어두워 보이는 것은 구멍에
     *   아주 넓게 퍼지는 그림자(box-shadow)를 줘서 만든 것이다.
     *
     * 왜 스타일을 코드 안에 쓰나?
     *   아직 시험 단계라 언제든 통째로 걷어낼 수 있어야 해서 style.css 를 건드리지 않는다.
     *   정식 공개 때 style.css 로 옮긴다.
     *
     * @returns {HTMLElement} 만들어 붙인 덮개
     */
    function _build() {
        _ensureKeyframes();

        var root = document.createElement('div');
        root.id = 'tutorial-overlay';
        root.style.cssText = 'position:fixed;inset:0;z-index:20000;font-family:' + FONT
            + ';color:#fff;overflow:hidden;';

        // 구멍 — 설명 대상만 밝게 남기고 바깥을 어둡게 한다
        var hole = document.createElement('div');
        hole.id = 'tutorial-hole';
        hole.style.cssText = 'position:absolute;border:2px solid ' + C_ACCENT
            + ';border-radius:10px;box-shadow:0 0 0 9999px ' + C_DIM
            + ';animation:tutorialRingBlink 1.3s ease-in-out infinite;pointer-events:auto;';

        // 시험 모드 표시 — 정식 공개 때 지운다
        var flag = document.createElement('div');
        flag.id = 'tutorial-test-flag';
        flag.textContent = '튜토리얼 시험 모드';
        flag.style.cssText = 'position:absolute;top:10px;left:12px;padding:4px 10px;'
            + 'border-radius:20px;background:rgba(68,138,255,0.18);border:1px solid ' + C_ACCENT
            + ';color:' + C_ACCENT + ';font-size:0.66rem;font-weight:700;letter-spacing:0.5px;';

        // 설명 카드
        var card = document.createElement('div');
        card.id = 'tutorial-card';
        card.style.cssText = 'position:absolute;box-sizing:border-box;background:' + C_CARD
            + ';border:1px solid ' + C_BORDER + ';border-radius:14px;padding:16px 16px 12px;'
            + 'box-shadow:0 18px 50px rgba(0,0,0,0.5);overflow:auto;';

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

        root.appendChild(hole);
        root.appendChild(flag);
        root.appendChild(card);

        _hole = hole;
        _card = card;
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
    // [자리 잡기] 구멍과 설명 카드를 현재 단계에 맞춰 놓는다
    // ========================================================================

    /**
     * 지금 단계의 구멍과 설명 카드를 제자리에 놓는다.
     *
     * 무엇을 하나?
     *   ① 대상 요소의 현재 화면 좌표를 매번 다시 재서 구멍을 씌운다(좌표 하드코딩 아님).
     *   ② 카드는 구멍 아래에 붙이되, 아래 공간이 모자라면 위에 붙인다.
     *      하단 메인탭 바는 가리지 않도록 그 위까지만 쓴다.
     *
     * 왜 매번 다시 재나?
     *   아코디언이 펼쳐지면 아래 요소들이 전부 밀려 내려간다. 스크롤·화면 회전도 마찬가지다.
     *
     * [연계] _go() · 화면 크기 변경 · 스크롤에서 호출.
     */
    function _paint() {
        if (!_root) return;
        var step = STEPS[_stepIdx];
        var el = step.target ? step.target() : null;
        var vw = window.innerWidth;
        var vh = window.innerHeight;

        // 하단 메인탭 바를 가리지 않도록 아래 한계를 정한다
        var bar = document.getElementById('bottom-tab-bar');
        var barH = bar ? bar.getBoundingClientRect().height : 0;
        var bottomLimit = vh - barH - EDGE;

        var cardW = Math.min(CARD_MAX, vw - EDGE * 2);
        _card.style.width = cardW + 'px';
        _card.style.left = Math.round((vw - cardW) / 2) + 'px';

        if (!el) {
            // 가리킬 것이 없는 단계 — 화면 전체를 어둡게 하고 카드는 아래쪽에 둔다
            _hole.style.display = 'none';
            _root.style.background = C_DIM;
            _card.style.maxHeight = Math.round(vh * 0.6) + 'px';
            _card.style.top = Math.round(bottomLimit - _card.offsetHeight) + 'px';
            return;
        }

        _root.style.background = 'transparent';
        _hole.style.display = 'block';
        var r = el.getBoundingClientRect();
        var pad = 6;   // 대상보다 살짝 넉넉하게 뚫어 준다
        var hx = Math.max(0, r.left - pad);
        var hy = Math.max(0, r.top - pad);
        var hw = Math.min(vw - hx, r.width + pad * 2);
        var hh = Math.min(vh - hy, r.height + pad * 2);
        _hole.style.left   = Math.round(hx) + 'px';
        _hole.style.top    = Math.round(hy) + 'px';
        _hole.style.width  = Math.round(hw) + 'px';
        _hole.style.height = Math.round(hh) + 'px';

        // 카드 자리: 아래쪽 공간과 위쪽 공간을 재어 넓은 쪽에 붙인다
        var below = bottomLimit - (hy + hh + GAP);
        var above = (hy - GAP) - EDGE;
        var useBelow = below >= above;
        _card.style.maxHeight = Math.max(120, Math.round(useBelow ? below : above)) + 'px';
        var ch = _card.offsetHeight;
        _card.style.top = Math.round(useBelow ? (hy + hh + GAP)
                                              : Math.max(EDGE, hy - GAP - ch)) + 'px';
    }

    /**
     * 스크롤·화면 크기 변경 때 자리를 다시 잡는다(화면 갱신 한 번에 한 번만).
     * [연계] _open() 에서 window 에 붙이고 _close() 에서 뗀다.
     */
    function _queuePaint() {
        if (_repaintQueued || !_root) return;
        _repaintQueued = true;
        requestAnimationFrame(function () { _repaintQueued = false; _paint(); });
    }

    // ========================================================================
    // [단계 이동]
    // ========================================================================

    /**
     * 주어진 번호의 단계로 간다.
     *
     * 무엇을 하나?
     *   ① 그 단계가 필요로 하는 화면 상태를 만든다(아코디언 열기/닫기 등)
     *   ② 화면에 실제로 나타날 때까지 기다린다(시간이 아니라 조건으로)
     *   ③ 대상을 화면 가운데로 끌어와 구멍과 카드를 놓는다
     *
     * @param {number} idx - 0 부터 시작하는 단계 번호. 범위를 벗어나면 무시한다.
     * [연계] [이전]/[다음] 버튼과 _open() 이 호출한다.
     */
    function _go(idx) {
        if (!_root) return;
        if (idx < 0 || idx >= STEPS.length) return;
        _stepIdx = idx;
        var step = STEPS[idx];

        // 글자 먼저 채운다(카드 높이를 재려면 내용이 들어 있어야 한다)
        _root.querySelector('#tutorial-step-badge').textContent = (idx + 1) + ' / ' + STEPS.length;
        _root.querySelector('#tutorial-step-title').textContent = step.title;
        _root.querySelector('#tutorial-step-body').textContent  = step.body;

        var prev = _root.querySelector('#tutorial-prev-btn');
        var next = _root.querySelector('#tutorial-next-btn');
        prev.disabled = (idx === 0);          // 첫 단계에서는 뒤로 갈 곳이 없다
        prev.style.opacity = prev.disabled ? '0.35' : '1';
        prev.style.cursor  = prev.disabled ? 'default' : 'pointer';
        next.textContent = (idx === STEPS.length - 1) ? '완료' : '다음';

        // 이 단계가 필요로 하는 화면 상태를 통째로 맞춘다(앞/뒤 어느 쪽에서 와도 같은 결과)
        _setAccordion(ACC_FORECAST, step.want.forecast);
        _setAccordion(ACC_ALERT, step.want.alert);
        _setAccordion(ACC_STATUS, step.want.status);

        var ready = function () {
            var el = step.target ? step.target() : null;
            return _settled(step.want)
                && (!step.target || (!!el && el.getBoundingClientRect().height > 0));
        };
        _when(ready, function () {
            if (step.target) _scrollIntoView(step.target());
            // 아코디언 여닫는 애니메이션(0.4초)과 스크롤이 멈춘 뒤에 자리를 잡는다
            _whenStable(function () { return step.target ? step.target() : null; }, _paint);
        });
    }

    // ========================================================================
    // [열기 / 닫기]
    // ========================================================================

    /**
     * 열기 전 화면 상태를 적어 둔다(닫을 때 그대로 되돌리려고).
     * @returns {Object} 지금 열려 있는 메인탭과 아코디언 세 개의 펼침 여부
     * [연계] _open() 이 부르고 _restore() 가 쓴다.
     */
    function _snap() {
        var activeTab = document.querySelector('.tab-btn.active');
        return {
            tab: activeTab ? activeTab.dataset.target : null,
            forecast: _isOpen(ACC_FORECAST),
            alert: _isOpen(ACC_ALERT),
            status: _isOpen(ACC_STATUS)
        };
    }

    /**
     * 튜토리얼이 건드린 것을 열기 전 상태로 되돌린다.
     * [연계] _close() 에서 호출.
     */
    function _restore() {
        if (!_snapshot) return;
        _setAccordion(ACC_FORECAST, _snapshot.forecast);
        _setAccordion(ACC_ALERT, _snapshot.alert);
        _setAccordion(ACC_STATUS, _snapshot.status);
        if (_snapshot.tab && typeof window.switchMainTab === 'function') {
            window.switchMainTab(_snapshot.tab);
        }
        _snapshot = null;
    }

    /**
     * 튜토리얼을 연다. 이미 열려 있으면 아무것도 하지 않는다.
     *
     * 무엇을 하나?
     *   원래 화면 상태를 적어 두고, 튜토리얼이 시작되는 특보정보 탭으로 옮긴 뒤,
     *   그 탭이 실제로 보이게 되면 덮개를 붙이고 1단계를 그린다.
     *
     * [연계] 공지사항 탭 연타 트리거와 window.openTutorial 이 호출한다.
     */
    function _open() {
        if (_root) return;
        _snapshot = _snap();

        // 튜토리얼은 특보정보 탭에서 시작한다(연타는 공지사항 탭에서 일어난다)
        if (typeof window.switchMainTab === 'function') {
            window.switchMainTab('weather-alert-section');
        }

        _root = _build();
        document.body.appendChild(_root);
        window.addEventListener('resize', _queuePaint);
        window.addEventListener('scroll', _queuePaint, true);

        // 특보정보 화면이 실제로 보이게 된 뒤에 1단계를 그린다(시간으로 기다리지 않는다)
        _when(function () {
            var sec = document.getElementById('weather-alert-section');
            return !!sec && sec.getBoundingClientRect().height > 0;
        }, function () { _go(0); });
    }

    /**
     * 튜토리얼을 닫고 앱을 원래대로 되돌린다.
     *
     * 무엇을 하나?
     *   덮개를 지우고(터치가 곧바로 살아난다), 튜토리얼이 열고 닫은 아코디언과
     *   옮긴 탭을 열기 전 상태로 되돌린다.
     */
    function _close() {
        if (!_root) return;
        window.removeEventListener('resize', _queuePaint);
        window.removeEventListener('scroll', _queuePaint, true);
        _root.remove();
        _root = null;
        _hole = null;
        _card = null;
        _stepIdx = 0;
        _restore();
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
                // [주의] 이 클릭에는 앱의 원래 탭 전환 처리(settings.js)도 함께 걸려 있고,
                //   그쪽이 우리보다 나중에 실행돼 공지사항 탭으로 돌려놓는다. 그래서 같은
                //   클릭 처리가 모두 끝난 다음(setTimeout 0)에 연다 — 안 그러면 튜토리얼이
                //   공지사항 화면 위에서 열려 가리킬 대상이 보이지 않는다.
                setTimeout(_open, 0);
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
