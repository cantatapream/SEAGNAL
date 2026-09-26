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
    var TAG_H    = 30;   // 위쪽 "시험 모드" 딱지 줄이 차지하는 높이(px)
    var _insets  = { top: 0, bottom: 0 };   // 상태표시줄·제스처 바가 차지하는 만큼
    var _zoneModalSaved = null;   // 해구 기상전망 창을 줄이기 전 모습
    var _trackId = 0;    // 대상 자리를 지켜보는 rAF 번호
    var _trackKey = '';  // 마지막으로 그린 대상 자리
    var CARD_MAX = 420;  // 설명 카드 최대 너비(px)
    var CARD_MIN = 215;  // 설명 카드에 최소한 내주는 높이(px) — 이만큼도 없으면 구멍을 줄인다
                         //   (버튼 줄 약 52px + 글 두어 줄 + 안쪽 여백)

    // 색·글꼴은 앱 기존 화면(index2.html · style.css)에서 그대로 가져온 값
    var C_CARD   = '#1c2338';
    var C_ACCENT = '#448aff';
    var C_TEXT   = '#cbd5e1';
    var C_SUB    = '#94a3b8';
    var C_BORDER = 'rgba(255,255,255,0.12)';
    var C_DIM    = 'rgba(6,11,24,0.78)';   // 설명 대상 바깥을 덮는 어두운 색
    var FONT     = "'Inter','Noto Sans KR',sans-serif";

    // [대체 그림] 특보가 하나도 없는 날에는 보여줄 화면이 없어, 특보가 있을 때의
    //   실제 화면을 찍어 둔 그림으로 대신 설명한다(사용자 제공 2026-09-22).
    //   날짜·수치가 그대로 들어 있어 지금 상황으로 오해하지 않도록 "예시 화면" 딱지를 겹쳐 붙인다.
    var EXAMPLE_IMG = 'assets/tutorial/alert_example.jpg';

    // 그림 안에서 설명할 부분들 — 그림 크기에 대한 비율(0~1)이라 그림이 커지거나
    //   작아져도 그대로 맞는다. 값은 그림 위에 실제로 그려 보고 맞췄다.
    var IMG_RECT = {
        card:   { x: 0.100, y: 0.262, w: 0.832, h: 0.558 },  // 구역 카드 전체
        avg:    { x: 0.188, y: 0.350, w: 0.680, h: 0.042 },  // 시정·유의파고·풍속
        times:  { x: 0.174, y: 0.398, w: 0.680, h: 0.074 },  // 글자 가로 127~612 실측  // 발표·발효·해제
        coast:  { x: 0.160, y: 0.498, w: 0.708, h: 0.132 },  // 연안바다·평수구역
        buoy:   { x: 0.170, y: 0.646, w: 0.698, h: 0.090 },  // 관측부이
        // [버튼 줄] 원본 720x1470 에서 색 픽셀을 세어 잰 값이다(2026-09-23 재측정).
    //   띠 세로 1096~1156, 버튼 가로 125~238 / 251~365 / 378~490 / 504~617.
    //   종합정보는 설명하지 않으므로(사용자 확정) 줄 강조도 앞의 셋까지만 감싼다.
    btns:   { x: 0.174, y: 0.7456, w: 0.507, h: 0.0415 },  // 기상예보·해구기상·윈디
    btn1:   { x: 0.174, y: 0.7456, w: 0.157, h: 0.0415 },  // 기상예보(노랑)
    btn2:   { x: 0.349, y: 0.7456, w: 0.157, h: 0.0415 },  // 해구기상(빨강)
    btn3:   { x: 0.525, y: 0.7456, w: 0.157, h: 0.0415 }   // 윈디(파랑)
    };

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
    var _shot     = null;   // 대체 그림 상자
    var _card     = null;
    var _stepIdx  = 0;
    var _snapshot = null;   // 열기 전 화면 상태(닫을 때 되돌리려고 적어 둔다)
    var _repaintQueued = false;
    var _steps    = null;   // 지금 진행 중인 단계 목록(특보정보용 STEPS 또는 지도용 STEPS_OCEAN)
    var _mode     = 'alert';// 'alert' = 특보정보 탭 튜토리얼, 'ocean' = 해양종합정보 탭 튜토리얼
    var _oceanArmed = false;// 공지사항 5연타로 켜진다 — 해양종합정보 탭에 들어가면 지도 튜토리얼 시작
    var _safetyArmed = false;// 같은 연타로 켜진다 — 해양안전 화면에 들어가면 그 튜토리얼 시작
    var _lifeArmed   = false;// 같은 연타로 켜진다 — 해양생활 화면에 들어가면 그 튜토리얼 시작
    var _alertArmed  = false;// 같은 연타로 켜진다 — 특보정보 탭을 누르면 그 튜토리얼 시작

    // [연타를 기억한다] 한 번 5연타하면 그 표시를 휴대폰에 적어 두고, 앱을 껐다 켜도
    //   그대로 쓴다(사용자 확정 2026-09-26). 그러지 않으면 새 버전을 받으려고 앱을
    //   닫을 때마다 5연타를 다시 해야 했다.
    //   시험을 끝내려면 콘솔에서 localStorage.removeItem('tutorial_test_armed').
    var ARMED_KEY = 'tutorial_test_armed';

    /** 적어 둔 연타 표시를 읽어 네 화면을 모두 열 수 있게 한다. */
    function _restoreArmed() {
        var on = false;
        try { on = localStorage.getItem(ARMED_KEY) === '1'; } catch (e) { /* 저장소 못 쓰면 그냥 꺼진 채 */ }
        if (!on) return;
        _alertArmed = _oceanArmed = _safetyArmed = _lifeArmed = true;
    }
    var _sheetScrollId = 0; // 바텀시트를 천천히 내리는 중인 애니메이션 번호

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
     * @param {Function} getEls - 대상 요소 배열을 돌려주는 함수(중간에 다시 그려질 수 있어 함수로 받는다)
     * @param {Function} done  - 자리가 멈췄을 때 할 일
     * [연계] _go() 가 구멍·카드를 놓기 직전에 쓴다.
     */
    function _whenStable(getEls, done) {
        var started = Date.now();
        var last = null;
        var same = 0;
        (function tick() {
            if (!_root) return;
            var r = _unionRect(getEls());
            var key = r ? [Math.round(r.top), Math.round(r.left), Math.round(r.right), Math.round(r.bottom)].join(',') : 'none';
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
        return _accSettled(ACC_FORECAST, want.forecast)
            && _accSettled(ACC_ALERT,    want.alert)
            && _accSettled(ACC_STATUS,   want.status);
    }

    /**
     * 아코디언 하나가 원하는 모양(펼침/접힘)으로 **다 움직였는지** 본다.
     *
     * 왜 이렇게 보나?
     *   접힘은 높이 0 으로 확인하면 된다. 펼침은 보통 높이 > 0 이지만, **속이 텅 빈 날**
     *   에는 펼쳐도 높이가 0 이다(실측 2026-09-23: 특보가 하나도 없는 날
     *   `#main-accordion-body` 는 offsetHeight·scrollHeight 가 둘 다 0). 높이만 보면
     *   그런 날은 "아직 안 펼쳐졌다"로 읽혀 그 단계가 영영 준비되지 않는다
     *   (특보 없는 날 4단계에서 [이전] 로 돌아오면 밝은 자리가 아예 안 생겼다).
     *   그래서 **접힘 표시가 없고 속도 비어 있으면**(scrollHeight 0) 펼쳐진 것으로 본다.
     *   펼치는 중간에는 속(scrollHeight)이 0 이 아니므로 중간을 잡지 않는다.
     *
     * @param {Array} acc - [본문 id, 토글 함수 이름]
     * @param {boolean} want - true=펼쳐져 있어야 함
     * @returns {boolean}
     */
    function _accSettled(acc, want) {
        var h = _accHeight(acc);
        if (!want) return h === 0;
        if (h > 0) return true;
        var body = document.getElementById(acc[0]);
        return !!body && !body.classList.contains('collapsed') && body.scrollHeight === 0;
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
     * 단계가 가리키는 요소들을 배열로 돌려준다.
     *
     * 무엇을 하나?
     *   target() 이 요소 하나를 주든 여러 개를 주든 배열로 맞춰 주고, 없는 것은 걸러낸다.
     *
     * 왜 여러 개인가?
     *   아코디언은 "머리줄 + 펼쳐진 내용"을 **함께** 밝게 비춰야 무엇이 열렸는지 보인다
     *   (사용자 확정 2026-09-22). 둘을 한 덩어리로 묶어 구멍 하나로 뚫는다.
     *
     * @param {Object} step - STEPS 의 한 항목
     * @returns {Array<HTMLElement>} 화면에 있는 대상들 (없으면 빈 배열)
     * [연계] _paint() · _whenStable() · _scrollIntoView() 가 쓴다.
     */
    function _targets(step) {
        if (!step.target) return [];
        var t = step.target();
        if (!t) return [];
        return (Array.isArray(t) ? t : [t]).filter(function (el) { return !!el; });
    }

    /**
     * 여러 요소를 모두 감싸는 사각형을 구한다.
     *
     * 예시: [머리줄, 펼쳐진 내용] → 둘을 함께 덮는 하나의 사각형
     *
     * @param {Array<HTMLElement>} els - 대상들
     * @returns {Object|null} {top,left,right,bottom} (화면 좌표) 또는 대상이 없으면 null
     * [연계] _paint() 가 구멍 크기를 정할 때, _whenStable() 이 멈췄는지 볼 때 쓴다.
     */
    function _unionRect(els) {
        if (!els.length) return null;
        var top = Infinity, left = Infinity, right = -Infinity, bottom = -Infinity;
        for (var i = 0; i < els.length; i++) {
            var r = els[i].getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;   // 아직 안 펼쳐진 것은 뺀다
            if (r.top < top) top = r.top;
            if (r.left < left) left = r.left;
            if (r.right > right) right = r.right;
            if (r.bottom > bottom) bottom = r.bottom;
        }
        if (top === Infinity) return null;
        return { top: top, left: left, right: right, bottom: bottom };
    }

    /**
     * 설명할 대상을 화면 안으로 끌어온다.
     * @param {Array<HTMLElement>} els - 보이게 할 요소들(첫 번째가 기준)
     * [연계] _go() 가 단계를 그리기 전에 호출. 부드러운 스크롤(smooth)은 위치가
     *        언제 멈출지 알 수 없어 쓰지 않는다(즉시 이동).
     */
    function _scrollIntoView(els) {
        if (!els.length || !els[0].scrollIntoView) return;
        // 머리줄 + 펼쳐진 내용처럼 덩어리가 화면 절반을 넘으면 가운데 정렬로는 머리줄이
        // 위로 잘려 나간다. 그럴 때는 맨 앞(머리줄)을 화면 위쪽에 맞춘다.
        var u = _unionRect(els);
        var tall = u && (u.bottom - u.top) > window.innerHeight * 0.5;
        var opt = { block: tall ? 'start' : 'center', behavior: 'auto' };
        try { els[0].scrollIntoView(opt); } catch (e) { els[0].scrollIntoView(); }
    }

    /**
     * 휴대폰 상단 상태표시줄·하단 제스처 바가 차지하는 만큼을 잰다.
     *
     * 왜 필요한가?
     *   이 앱은 `viewport-fit=cover` 라 화면이 상태표시줄 **아래까지** 늘어난다
     *   (index2.html 이 곳곳에서 `env(safe-area-inset-top)` 으로 여백을 준다).
     *   튜토리얼은 그 여백을 안 줘서 딱지와 설명 카드가 상태표시줄을 침범했다
     *   (사용자 지적 2026-09-23).
     *
     * @returns {{top:number, bottom:number}} 위·아래 안전 여백(px)
     * [연계] _open 에서 한 번 재고(_insets), 화면 회전(resize)에서 다시 잰다.
     */
    function _measureInsets() {
        var d = document.createElement('div');
        d.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;'
            + 'pointer-events:none;padding-top:env(safe-area-inset-top,0px);'
            + 'padding-bottom:env(safe-area-inset-bottom,0px);';
        document.body.appendChild(d);
        var cs = getComputedStyle(d);
        var out = { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
        d.parentNode.removeChild(d);
        return out;
    }

    /**
     * 대상이 화면 아래로 넘쳤으면 넘친 만큼 더 내려 **잘리지 않게** 한다.
     *
     * 왜 필요한가?
     *   `scrollIntoView` 만으로는 대상 아래쪽이 화면 밖에 남는 일이 있었다. 그러면
     *   구멍이 화면 끝에서 잘려, 부이를 눌러 펼쳐진 관측값이 어둡게 가려졌다
     *   (사용자 지적 2026-09-23 · 실측: 대상 높이 330 인데 구멍이 252 로 잘림).
     *   이 화면은 **문서(documentElement)가 스크롤된다** — `main.content-area` 는
     *   overflow 가 auto 지만 내용 높이를 그대로 가져(scrollHeight == clientHeight)
     *   움직이지 않는다(실측으로 셋 다 시험해 확인).
     *   그래서 반드시 **레이아웃이 멎은 뒤에** 한 번 더 맞춘다.
     *
     * @param {Array<HTMLElement>} els - 밝게 남길 요소들
     * [연계] _go 가 _whenStable 뒤에 호출.
     */
    function _fitIntoView(els) {
        var u = _unionRect(els);
        if (!u) return;
        var topLimit    = EDGE + _insets.top + TAG_H;   // 위쪽 딱지 줄 아래
        var bottomLimit = window.innerHeight - EDGE - _insets.bottom;

        // 설명 카드가 **아래쪽**에 들어갈 자리가 남아 있으면 그대로 둔다.
        if (bottomLimit - u.bottom - GAP >= CARD_MIN) return;

        // 자리가 모자라면 대상을 위로 끌어올려 아래를 비운다. 그러지 않으면 카드가 위로
        //   올라가고 대상은 화면 아래에 눌려, 부이 관측값처럼 아래쪽 내용이 화면 밖으로
        //   잘려 나간다(사용자 지적 2026-09-23: "부이 선택 화면이 아래쪽에 있어서 안 보인다").
        var want = Math.round(u.top - topLimit);
        if (want <= 0) return;   // 이미 위쪽에 붙어 있다 — 더 올릴 수 없다
        var de = document.scrollingElement || document.documentElement;
        var room = de.scrollHeight - de.clientHeight - de.scrollTop;
        if (room > 0) de.scrollTop += Math.min(want, room);
    }

    // ========================================================================
    // [파고들기] 해역별 특보현황 안으로 한 겹씩 들어간다
    // ========================================================================
    //
    // [구조가 해역마다 다르다 — 실측 2026-09-22 운영 화면]
    //   동해 : 소분류 1개 → 그 안에 구역 카드
    //   서해 : 비어 있음(특보 없음)
    //   남해 : 소분류 2개 → 그 안에 구역 카드
    //   제주 : 소분류 없이 구역 카드가 바로 4개
    // 그래서 "무조건 소분류를 연다" 로 만들면 제주가 맨 위일 때 멈춘다.
    // → 있으면 열고, 없으면 건너뛴다.

    // 특보현황과 기상현황은 뼈대가 똑같다(대분류 → 소분류 → 구역 카드). id 앞머리와
    //   카드 class 만 다르다. 그래서 같은 함수에 갈래(kind)만 넘겨 쓴다.
    var SCOPES = {
        alert:  {
            lists: ['east-sea-list', 'west-sea-list', 'south-sea-list', 'jeju-sea-list'],
            body: 'main-accordion-body',
            card: '.alert-card'
        },
        status: {
            lists: ['status-east-sea-list', 'status-west-sea-list',
                    'status-south-sea-list', 'status-jeju-sea-list'],
            body: 'marine-status-accordion-body',
            card: '.weather-status-card'
        }
    };

    /**
     * 갈래 이름으로 그 갈래의 id·class 묶음을 준다.
     * @param {string} [kind] - 'alert'(특보현황) | 'status'(기상현황). 없으면 alert
     * @returns {Object} SCOPES 의 한 묶음
     */
    function _scope(kind) { return SCOPES[kind] || SCOPES.alert; }

    /**
     * 특보가 실제로 들어 있는 첫 번째 대분류 해역(동해→서해→남해→제주 순)을 찾는다.
     *
     * @returns {HTMLElement|null} 그 해역의 목록 요소(#east-sea-list 등). 아무 데도 없으면 null
     * [연계] 파고들기 단계들이 "어디로 들어갈지" 정할 때 쓴다.
     */
    function _firstSeaWithAlerts(kind) {
        var lists = _scope(kind).lists;
        for (var i = 0; i < lists.length; i++) {
            var list = document.getElementById(lists[i]);
            if (list && list.children.length > 0) return list;
        }
        return null;
    }

    /**
     * 대분류 해역을 펼친다(이미 펼쳐져 있으면 그대로 둔다).
     * @param {HTMLElement} list - 해역 목록 요소
     * [연계] window.toggleSection (render_coastal.js) — 배타적 토글이라 다른 해역은 저절로 닫힌다.
     */
    function _openSea(list) {
        if (!list) return;
        var section = list.parentElement;   // .sea-section
        if (section && !section.classList.contains('open')
            && typeof window.toggleSection === 'function') {
            window.toggleSection(list.id);
        }
    }

    /**
     * 펼쳐진 해역 안의 첫 번째 소분류(중분류) 덩어리를 찾는다.
     * @param {HTMLElement} list - 해역 목록 요소
     * @returns {HTMLElement|null} .sub-region-section (제주처럼 소분류가 없으면 null)
     */
    function _firstSub(list) {
        return list ? list.querySelector('.sub-region-section') : null;
    }

    /**
     * 소분류를 펼친다(이미 펼쳐져 있으면 그대로 둔다).
     *
     * 왜 머리글을 클릭하나?
     *   소분류는 머리글의 onclick 안에서 슬라이드 애니메이션·사용량 집계까지 하므로,
     *   목록의 display 만 바꾸면 화살표·집계가 어긋난다(render.js).
     *
     * @param {HTMLElement} sub - .sub-region-section
     */
    function _openSub(sub) {
        if (!sub) return;
        var list = sub.querySelector('.sub-region-list');
        var header = sub.querySelector('.sub-region-header');
        if (list && header && list.style.display === 'none') header.click();
    }

    /**
     * 지금 화면에서 안내할 구역 카드(첫 번째)를 찾는다.
     * @returns {HTMLElement|null} .alert-card — 해역을 아직 안 펼쳤으면 null
     */
    function _firstCard(kind) {
        var list = _firstSeaWithAlerts(kind);
        if (!list) return null;
        var sub = _firstSub(list);
        return (sub || list).querySelector(_scope(kind).card);
    }

    /**
     * 구역 카드의 자세한 내용을 펼치거나 접는다.
     *
     * 왜 카드를 클릭하나?
     *   카드 클릭 핸들러가 "다른 카드는 모두 접고 이 카드만 펼치기" 까지 함께 한다
     *   (render.js). 클래스만 직접 지우면 다른 카드가 열린 채 남는다.
     *
     * @param {boolean} open - true=펼침
     */
    function _setCardOpen(open) {
        var card = _firstCard();
        if (!card) return;
        var det = card.querySelector('.alert-details');
        if (!det) return;
        var isOpen = !det.classList.contains('hidden');
        if (isOpen !== open) card.click();
    }

    /**
     * 관측부이 버튼 중 **맨 앞 것**을 눌러 실제 관측값을 띄우거나 도로 닫는다.
     *
     * @param {boolean} on - true=눌러서 값 표출
     * [연계] render.js 의 부이 버튼은 같은 버튼을 다시 누르면 닫히는 토글이다.
     */
    function _setBuoy(on, kind) {
        var btn = _buoyBtn(kind);
        if (!btn) return;
        if (btn.classList.contains('active') !== on) btn.click();
    }

    /**
     * 카드 안 첫 관측부이 버튼을 찾는다.
     *
     * 왜 갈래마다 다르나?
     *   특보 카드는 `.buoy-btn`, 기상현황 카드는 `.buoy-status-btn` 을 쓴다(실측 2026-09-23).
     *
     * @param {string} [kind] - 'alert'(기본) | 'status'
     * @returns {HTMLElement|null}
     */
    function _buoyBtn(kind) {
        var card = _firstCard(kind);
        if (!card) return null;
        return card.querySelector('.buoy-btn') || card.querySelector('.buoy-status-btn');
    }

    /**
     * 카드 안 관측부이 영역(머리줄 + 버튼들)을 찾는다.
     *
     * 기상현황 카드에는 이름표(class)가 없어(실측) 버튼에서 거슬러 올라간다.
     *
     * @param {string} [kind] - 'alert'(기본) | 'status'
     * @returns {HTMLElement|null}
     */
    function _buoyBox(kind) {
        var card = _firstCard(kind);
        if (!card) return null;
        var sec = card.querySelector('.buoy-section');
        if (sec) return sec;
        var b = card.querySelector('.buoy-status-btn');
        return b && b.parentElement ? b.parentElement.parentElement : null;
    }

    /**
     * 카드 아래 버튼 넷이 놓인 줄을 찾는다.
     *
     * 기상현황 카드에는 이름표가 없어(실측) [기상예보] 버튼의 부모를 쓴다.
     *
     * @param {string} [kind] - 'alert'(기본) | 'status'
     * @returns {HTMLElement|null}
     */
    function _btnRow(kind) {
        var card = _firstCard(kind);
        if (!card) return null;
        var row = card.querySelector('.card-action-btns');
        if (row) return row;
        var b = _cardBtn('기상예보', kind);
        return b ? b.parentElement : null;
    }

    /**
     * 구역 카드 아래쪽 버튼(기상예보·해구기상·윈디·종합정보) 하나를 찾는다.
     * @param {string} label - 버튼에 쓰인 글자 (예: '기상예보')
     * @returns {HTMLElement|null}
     */
    function _cardBtn(label, kind) {
        var card = _firstCard(kind);
        if (!card) return null;
        // 특보 카드는 .card-action-btns 로 묶여 있지만, 기상현황 카드는 이름표가 없다(실측
        //   2026-09-23). 그 경우 카드 안 모든 버튼에서 글자로 찾는다 — 부이 버튼은 해역
        //   이름이라 '기상예보' 같은 라벨과 겹치지 않는다.
        var btns = card.querySelectorAll('.card-action-btns button');
        if (!btns.length) btns = card.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
            if ((btns[i].textContent || '').trim() === label) return btns[i];
        }
        return null;
    }

    /**
     * 기상예보 팝업을 띄우거나 닫는다.
     *
     * @param {boolean} on - true=띄움
     * [연계] forecast.js 의 showSeaForecastTable 이 #sea-forecast-modal 을 만든다.
     *        닫기는 그 안의 #close-forecast-modal 버튼을 눌러 애니메이션까지 맞춘다.
     */
    function _setForecast(on, kind) {
        var modal = document.getElementById('sea-forecast-modal');
        if (on && !modal) {
            var btn = _cardBtn('기상예보', kind);
            if (btn) btn.click();
        } else if (!on && modal) {
            var close = document.getElementById('close-forecast-modal');
            if (close) close.click(); else modal.remove();
        }
    }

    /**
     * 윈디 팝업을 띄우거나 닫는다.
     * @param {boolean} on - true=띄움
     * [연계] windy.js 의 showWindyPopup / closeWindyPopup (#windy-modal)
     */
    function _setWindy(on, kind) {
        var modal = document.getElementById('windy-modal');
        if (on && !modal) {
            var btn = _cardBtn('윈디', kind);
            if (btn) btn.click();
        } else if (!on && modal) {
            if (typeof window.closeWindyPopup === 'function') window.closeWindyPopup();
            else modal.remove();
        }
    }

    /**
     * 해구(격자) 기상전망 창을 띄우거나 닫는다.
     *
     * 무엇을 하나?
     *   사람이 지도에서 칸을 두 번 누르면 뜨는 창(`#sea-zone-modal`)을 대신 띄운다.
     *   지도 한가운데에 있는 격자 칸의 번호를 읽어 `getMarineZoneData` 에 넘긴다 —
     *   해구기상 버튼이 이미 그 해역 한가운데로 지도를 옮겨 놓았기 때문에,
     *   가운데 칸이 곧 그 해역의 칸이다(실측 2026-09-23: 울산앞바다 → 93해구).
     *
     * 왜 클릭을 흉내 내지 않았나?
     *   지도(OpenLayers)에 포인터 이벤트를 만들어 보냈더니 창이 뜨지 않았다(실측).
     *   그래서 앱이 쓰는 함수를 그대로 부른다.
     *
     * @param {boolean} on - true=띄움
     * [연계] ocean_map.js 의 window.getOceanMap · marine.js 의 getMarineZoneData /
     *        closeSeaZoneModal (#sea-zone-modal)
     */
    function _zoneIdAtCenter() {
        var map = window.getOceanMap && window.getOceanMap();
        if (!map) return null;
        var c;
        try { c = map.getView().getCenter(); } catch (e) { return null; }
        if (!c) return null;
        // [주의] 화면에 찍힌 것으로 찾는 forEachFeatureAtPixel 은 쓰지 않는다 — 탭을
        //   오간 직후에는 지도가 아직 다시 그려지지 않아 아무것도 못 찾았다(실측:
        //   [이전] 로 이 단계에 돌아오면 8초가 지나도 빈손이었다). 자료(소스)에서
        //   좌표로 직접 찾으면 화면에 그려졌는지와 무관하게 찾을 수 있다.
        var id = null;
        map.getLayers().forEach(function (l) {
            if (id) return;
            var src = l.getSource && l.getSource();
            if (!src || typeof src.getFeaturesAtCoordinate !== 'function') return;
            var fs;
            try { fs = src.getFeaturesAtCoordinate(c); } catch (e) { return; }
            for (var i = 0; i < fs.length; i++) {
                var pr = fs[i].getProperties();
                if (pr && pr.marine_zone_no) { id = String(pr.marine_zone_no); return; }
            }
        });
        if (id) return id;

        // [한가운데가 육지일 때] 해구 격자는 바다에만 있어서, 화면 가운데가 내륙이면
        //   위 방법으로는 아무것도 못 찾는다(실측 2026-09-25 — 지도가 한반도 내륙을
        //   보고 있어 창이 끝내 안 열렸다). 그럴 때는 **가장 가까운 칸**을 고른다.
        var bestD = Infinity;
        map.getLayers().forEach(function (l) {
            var src = l.getSource && l.getSource();
            if (!src || typeof src.getFeatures !== 'function') return;
            var fs;
            try { fs = src.getFeatures(); } catch (e) { return; }
            for (var i = 0; i < fs.length; i++) {
                var no = fs[i].get('marine_zone_no');
                if (!no) continue;
                var g = fs[i].getGeometry();
                if (!g) continue;
                var e = g.getExtent();
                var cx = (e[0] + e[2]) / 2, cy = (e[1] + e[3]) / 2;
                var d = (cx - c[0]) * (cx - c[0]) + (cy - c[1]) * (cy - c[1]);
                if (d < bestD) { bestD = d; id = String(no); }
            }
        });
        return id;
    }

    function _fitZoneModal(on) {
        var modal = document.getElementById('sea-zone-modal');
        var content = modal && modal.querySelector('.modal-content');
        if (!content) return;
        if (on) {
            // 창은 원래 화면 한가운데에 세로 90% 까지 차지한다. 튜토리얼은 아래쪽을
            //   설명 카드가 쓰므로 그대로 두면 창 아래가 잘린다(사용자 지적 2026-09-24).
            //   **튜토리얼이 열려 있는 동안만** 위로 붙이고 남는 높이에 맞춘다.
            //   안쪽(#zone-modal-body)이 overflow:auto 라 줄여도 표는 밀어서 다 볼 수 있다.
            if (!_zoneModalSaved) {
                _zoneModalSaved = { align: modal.style.alignItems,
                                    padTop: modal.style.paddingTop,
                                    maxH: content.style.maxHeight };
            }
            var topLimit    = EDGE + _insets.top + TAG_H;
            var bottomLimit = window.innerHeight - EDGE - _insets.bottom;
            var avail = bottomLimit - topLimit - GAP - CARD_MIN;
            modal.style.alignItems = 'flex-start';
            modal.style.paddingTop = Math.round(topLimit) + 'px';
            content.style.maxHeight = Math.max(200, Math.round(avail)) + 'px';
        } else if (_zoneModalSaved) {
            modal.style.alignItems  = _zoneModalSaved.align;
            modal.style.paddingTop  = _zoneModalSaved.padTop;
            content.style.maxHeight = _zoneModalSaved.maxH;
            _zoneModalSaved = null;
        }
    }

    function _setZoneGrid(on) {
        var modal = document.getElementById('sea-zone-modal');
        if (on && !modal) {
            if (typeof window.getMarineZoneData !== 'function') return;
            var id = _zoneIdAtCenter();
            if (id) window.getMarineZoneData(id);
        } else if (!on && modal) {
            _fitZoneModal(false);   // 우리가 줄여 둔 것을 되돌린 뒤에 닫는다
            if (typeof window.closeSeaZoneModal === 'function') window.closeSeaZoneModal();
            else modal.remove();
        }
    }

    /**
     * 카드 안에서 발표시각·발효시각·해제예정 줄을 찾는다.
     *
     * 무엇을 하나?
     *   이 줄들에는 따로 class 가 없어(실측 확인) 글자로 찾는다.
     *
     * @returns {Array<HTMLElement>} 찾은 줄들 (없으면 빈 배열)
     */
    function _timeRows() {
        var card = _firstCard();
        var det = card && card.querySelector('.alert-details');
        if (!det) return [];
        var out = [];
        var divs = det.querySelectorAll('div');
        for (var i = 0; i < divs.length; i++) {
            var d = divs[i];
            if (d.children.length <= 2 && /^(발표시각|발효시각|해제예정)/.test((d.textContent || '').trim())) {
                out.push(d);
            }
        }
        return out;
    }

    /**
     * 펼쳐져 있는 소분류를 모두 접는다.
     * [연계] _drill() 이 앞 단계로 되돌아갈 때 쓴다. 머리글 클릭으로 접어야 화살표까지 맞는다.
     */
    function _closeSubs(kind) {
        var lists = document.querySelectorAll('#' + _scope(kind).body + ' .sub-region-list');
        for (var i = 0; i < lists.length; i++) {
            if (lists[i].style.display !== 'none') {
                var header = lists[i].previousElementSibling;
                if (header && header.classList.contains('sub-region-header')) header.click();
            }
        }
    }

    /**
     * 펼쳐져 있는 대분류 해역을 모두 접는다.
     * [연계] toggleSection 은 배타적이라 열린 것 하나에 대고 부르면 전부 닫힌다(render_coastal.js).
     */
    function _closeSeas(kind) {
        var open = document.querySelector('#' + _scope(kind).body + ' .sea-section.open');
        if (!open) return;
        var list = open.querySelector('.alert-list');
        if (list && typeof window.toggleSection === 'function') window.toggleSection(list.id);
    }

    /**
     * 특보현황 안쪽을 그 단계에 맞는 모양으로 **정확히** 맞춘다.
     *
     * 무엇을 하나?
     *   depth 가 없으면 전부 접고, 'sea' 면 첫 해역만 펼치고, 'sub'·'card' 면 소분류까지 펼친다.
     *   여는 것뿐 아니라 **닫는 것까지** 여기서 하므로, [이전] 으로 되돌아가도 화면이 제자리를
     *   찾는다(안 그러면 앞 단계로 갔는데 뒤 단계에서 열어 둔 것이 그대로 남는다 — 실측 확인).
     *
     * @param {string} [depth] - 'sea'(해역까지) | 'sub'·'card'(소분류까지) | 없으면 전부 접음
     * [연계] _go() 가 매 단계 부른다. 여러 번 불러도 결과가 같다(멱등).
     */
    function _drill(spec) {
        // 'status:sub' 처럼 갈래를 앞에 붙여 쓴다. 갈래를 안 쓰면 특보현황(alert).
        var kind = 'alert';
        var depth = spec;
        if (spec && spec.indexOf(':') > 0) {
            var parts = spec.split(':');
            kind = parts[0];
            depth = parts[1];
        }

        // [탭 먼저] 해구기상 단계 말고는 특보정보 탭에 있어야 한다. 다른 탭에 있으면
        //   카드·아코디언의 높이가 0 이라 자리를 재는 것부터 어긋난다.
        if (depth !== 'zonemap' && depth !== 'zonegrid') {
            var mapSec = document.getElementById('ocean-map-section');
            if (mapSec && mapSec.classList.contains('active')
                && typeof window.switchMainTab === 'function') {
                window.switchMainTab('weather-alert-section');
            }
        }
        var list = _firstSeaWithAlerts(kind);
        var deep = (depth === 'sub' || depth === 'open' || depth === 'buoy'
                    || depth === 'forecast' || depth === 'windy' || depth === 'zonemap'
                    || depth === 'zonegrid');
        if (deep) {
            _openSea(list);
            _openSub(_firstSub(list));   // 소분류가 없으면(제주) 아무 일도 안 한다
        } else {
            _setForecast(false);         // 떠 있는 팝업부터 닫고
            _setWindy(false);
            _setZoneGrid(false);
            _setBuoy(false, kind);       // 눌러 둔 부이를 되돌리고
            _setCardOpen(false);         // 카드를 접고
            _closeSubs(kind);            // 소분류를 접고(보이는 동안 접어야 한다)
            if (depth === 'sea') { _openSea(list); }
            else { _closeSeas(kind); }
            return;
        }
        // [주의] 'sub' 단계는 카드가 **접혀 있는** 모습을 보여주는 단계다(다음 단계에서
        //   눌러 펼친다). 여기서 무조건 펼치면, 접혀 있기를 기다리는 _drillSettled('sub')
        //   와 서로 어긋나 준비가 영영 안 되고 구멍이 앞 단계 자리에 그대로 남는다
        //   (배포본에서 6·7단계가 실제로 그랬다 — 2026-09-22 실측).
        //   기상현황 카드는 처음부터 펼쳐져 있어(실측) 접었다 펴는 동작 자체가 없다.
        if (kind === 'alert') _setCardOpen(depth !== 'sub');
        _setBuoy(depth === 'buoy', kind);      // 카드를 펼친 뒤에 눌러야 한다
        _setForecast(depth === 'forecast', kind);
        _setWindy(depth === 'windy', kind);
        if (depth === 'zonemap' || depth === 'zonegrid') {
            // 해구기상 버튼은 그 자체가 해양종합정보 탭으로 넘어가면서 해구도를 켠다.
            //   이미 그 탭에 가 있으면 다시 누르지 않는다(누르면 토글이 뒤집힌다).
            var sec = document.getElementById('ocean-map-section');
            var onMap = sec && sec.classList.contains('active');
            if (!onMap) { var zb = _cardBtn('해구기상', kind); if (zb) zb.click(); }
        }
        // 해구 기상전망 창은 'zonegrid' 단계에서만 띄운다(격자만 보여주는 단계에서는 닫는다).
        //   탭을 막 옮긴 직후에는 지도가 아직 없어 창을 못 띄운다 — 지도가 설 때까지
        //   기다렸다가 띄운다([이전] 로 이 단계에 돌아올 때 실제로 안 떴다 — 실측).
        if (depth === 'zonegrid') {
            // 지도가 서고 **격자 칸까지 그려진 뒤**라야 칸 번호를 읽을 수 있다.
            //   [이전] 로 이 단계에 돌아올 때 격자가 아직 없어 창이 안 떴다(실측).
            var want = spec;
            _when(function () {
                var mEl = document.getElementById('ocean-map');
                return !!(mEl && mEl.getBoundingClientRect().height > 0) && !!_zoneIdAtCenter();
            }, function () {
                // 기다리는 사이 다른 단계로 넘어갔으면 띄우지 않는다
                if (_steps[_stepIdx] && _steps[_stepIdx].drill === want) _setZoneGrid(true);
            });
        } else {
            _setZoneGrid(false);
        }
    }

    /**
     * 그 단계가 **해양종합정보 지도로 넘어가는 단계**인지 본다.
     *
     * 왜 필요한가?
     *   지도 단계는 화면이 통째로 다른 탭에 가 있어 특보정보 쪽 아코디언 높이가 0 이다.
     *   그걸 같이 보면 영영 준비됐다고 못 한다. 갈래가 앞에 붙을 수 있어(예: 'status:zonemap')
     *   글자 그대로 비교하면 안 된다.
     *
     * @param {string} spec - 단계의 drill 값
     * @returns {boolean}
     */
    function _isMapStep(spec) {
        var d = spec && spec.indexOf(':') > 0 ? spec.split(':')[1] : spec;
        return d === 'zonemap' || d === 'zonegrid';
    }

    /**
     * 파고들기가 화면에 **실제로** 반영됐는지 본다.
     *
     * 왜 필요한가?
     *   해역·소분류도 슬라이드로 열린다. 클래스만 보고 그리면 움직이는 중간을 잡는다
     *   (기상 전망 아코디언에서 실제로 겪은 것과 같은 문제 — L-306 취지).
     *
     * @param {string} depth - 'sea' | 'sub' | 'card'
     * @returns {boolean} 그 깊이까지 실제로 펼쳐졌으면 true
     */
    function _drillSettled(spec) {
        var kind = 'alert';
        var depth = spec;
        if (spec && spec.indexOf(':') > 0) {
            var pp = spec.split(':');
            kind = pp[0];
            depth = pp[1];
        }

        // [해구기상 단계] 화면이 통째로 해양종합정보 탭으로 넘어가 있으므로, 특보정보 쪽
        //   (아코디언·카드) 높이는 0 이다. 그걸 같이 보면 영영 준비됐다고 못 한다
        //   (실측: [이전] 로 이 단계에 돌아오면 구멍이 앞 단계 자리에 그대로 남았다).
        //   그래서 이 단계는 지도만 보고 판단하고 바로 끝낸다.
        if (depth === 'zonemap' || depth === 'zonegrid') {
            if (document.getElementById('sea-forecast-modal')
                || document.getElementById('windy-modal')) return false;
            var zm = document.getElementById('sea-zone-modal');
            // 해구 기상전망 창은 'zonegrid' 단계에서만 떠 있어야 한다.
            var zmOpen = !!zm && zm.offsetHeight > 0;
            if (depth === 'zonegrid') { if (!zmOpen) return false; }
            else if (zm) return false;
            var mSec = document.getElementById('ocean-map-section');
            var mEl  = document.getElementById('ocean-map');
            return !!mSec && mSec.classList.contains('active')
                && !!mEl && mEl.getBoundingClientRect().height > 0;
        }

        var wSec = document.getElementById('weather-alert-section');
        if (!wSec || wSec.getBoundingClientRect().height === 0) return false;

        var body = _scope(kind).body;
        var openSub = document.querySelectorAll('#' + body + ' .sub-region-list');
        var subOpenCount = 0;
        for (var i = 0; i < openSub.length; i++) {
            if (openSub[i].style.display !== 'none' && openSub[i].offsetHeight > 0) subOpenCount++;
        }
        var openSea = document.querySelector('#' + body + ' .sea-section.open');

        if (!depth) return !openSea && subOpenCount === 0;   // 전부 접혀야 한다

        var list = _firstSeaWithAlerts(kind);
        if (!list) return true;                 // 특보가 아예 없으면 기다릴 것도 없다
        if (list.offsetHeight === 0) return false;
        if (depth === 'sea') return subOpenCount === 0;

        var sub = _firstSub(list);
        if (sub) {
            var subList = sub.querySelector('.sub-region-list');
            if (!subList || subList.style.display === 'none' || subList.offsetHeight === 0) return false;
        }

        // 카드·부이까지 요구하는 단계는 그것들이 실제로 보이는지도 확인한다.
        //   기상현황 카드는 처음부터 펼쳐져 있어(실측) 펼침 확인을 건너뛴다.
        var card = _firstCard(kind);
        if (kind === 'alert') {
            var det = card && card.querySelector('.alert-details');
            var cardOpen = !!det && !det.classList.contains('hidden') && det.offsetHeight > 0;
            if (depth === 'sub') return !det || !cardOpen;   // 아직 접혀 있어야 한다
            if (!cardOpen) return false;
        } else {
            if (!card || card.offsetHeight === 0) return false;
        }
        var fm = document.getElementById('sea-forecast-modal');
        var wm = document.getElementById('windy-modal');
        if (depth === 'forecast') return !!fm && fm.offsetHeight > 0;
        if (depth === 'windy')    return !!wm && wm.offsetHeight > 0;
        if (fm || wm) return false;      // 다른 단계에서는 팝업이 닫혀 있어야 한다

        if (depth !== 'buoy') return true;

        // [부이가 실제로 펼쳐졌나] 특보 카드는 `.buoy-info-area` 가 생기지만, 기상현황
        //   카드는 이름표 없이 카드 안에 값이 붙는다(실측 2026-09-23: 카드 높이 194→456,
        //   버튼에 active). 그래서 기상현황은 **값이 실제로 찍혔는지**를 글자로 본다.
        if (kind === 'alert') {
            var info = card.querySelector('.buoy-info-area');
            return !!info && info.style.display !== 'none' && info.offsetHeight > 0;
        }
        var bb = card.querySelector('.buoy-status-btn.active');
        return !!bb && (card.textContent || '').indexOf('관측시간') >= 0;
    }

    // ========================================================================
    // [단계 목록] — 특보정보 탭 1~3
    //   target : 밝게 남길 요소. 배열로 여러 개를 주면 전부 감싸는 구멍 하나로 뚫는다
    //            (없으면 화면 전체가 어두워진다)
    //   want   : 이 단계에서 아코디언 셋이 각각 펼쳐져 있어야 하는지 (true=펼침)
    //            앞/뒤 어느 쪽에서 오든 이 모양으로 맞추므로 [이전] 이 저절로 동작한다
    //   drill  : 특보현황 안쪽을 어디까지 펼쳐 둘지 ('sea' | 'sub')
    //   image  : 가리킬 화면이 없을 때 대신 띄울 그림(특보가 하나도 없는 날)
    //   imageRect : 그 그림 안에서 지금 설명하는 부분(비율 0~1). 그 자리로 밀어 보여주고
    //               테두리를 둘러 준다. 없으면 그림 맨 위부터 보여준다
    //   skip   : 오늘 화면에 없는 단계인지 (특보가 없거나 소분류가 없는 바다) — 참이면 지나간다
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
            body: '앞으로 바다 날씨가 어떻게 될지 기상청 예보를 모아 보여줍니다. '
                + '펼치면 종합 · 초단기 · 단기 전망이 차례로 나옵니다.',
            // 머리줄과 펼쳐진 내용을 함께 비춘다(사용자 확정 2026-09-22) — 무엇이 열렸는지 보여야 한다
            target: function () {
                return [document.getElementById('marine-forecast-accordion-header'),
                        document.getElementById('marine-forecast-accordion-body')];
            },
            want: { forecast: true, alert: false, status: false }
        },
        {
            title: '해역별 특보현황',
            body: '지금 어느 바다에 풍랑·태풍 같은 특보가 내려져 있는지 모아 놓은 곳입니다. '
                + '동해 · 서해 · 남해 · 제주로 나뉘고, 그 안에서 우리 해역까지 펼쳐 볼 수 있습니다.',
            target: function () { return document.getElementById('main-accordion-header'); },
            want: { forecast: false, alert: false, status: false }
        },
        {
            title: '네 바다로 나뉘어 있습니다',
            body: '동해 · 서해 · 남해 · 제주 순서로 묶여 있고, 오른쪽 숫자가 그 바다에서 '
                + '특보가 내려진 해역 수입니다. 0개면 그 바다는 지금 특보가 없습니다.',
            target: function () {
                return [document.getElementById('main-accordion-header'),
                        document.getElementById('main-accordion-body')];
            },
            want: { forecast: false, alert: true, status: false }
        },
        {
            title: '특보가 내려지면 이렇게 보입니다',
            body: '오늘은 특보가 내려진 해역이 없어 보여드릴 화면이 없습니다. '
                + '특보가 있으면 아래 그림처럼 해역마다 카드가 하나씩 생깁니다. '
                + '맨 위에 해역 이름과 특보 종류가 나옵니다.',
            image: EXAMPLE_IMG,
            imageRect: IMG_RECT.card,
            // 특보가 있는 날에는 진짜 화면을 보여주므로 이 단계는 건너뛴다
            skip: function () { return !!_firstSeaWithAlerts(); },
            want: { forecast: false, alert: true, status: false }
        },
        {
            title: '파도 높이와 바람 세기',
            body: '그 해역의 시정(얼마나 멀리 보이나) · 유의파고(파도 높이) · 풍속(바람 세기)입니다. '
                + '배를 띄울지 말지 판단할 때 가장 먼저 보게 되는 숫자입니다.',
            image: EXAMPLE_IMG,
            imageRect: IMG_RECT.avg,
            skip: function () { return !!_firstSeaWithAlerts(); },
            want: { forecast: false, alert: true, status: false }
        },
        {
            title: '언제 발표되고 언제 풀리나',
            body: '발표시각은 기상청이 알린 때, 발효시각은 실제로 효력이 시작되는 때, '
                + '해제예정은 풀릴 것으로 보는 때입니다.',
            image: EXAMPLE_IMG,
            imageRect: IMG_RECT.times,
            skip: function () { return !!_firstSeaWithAlerts(); },
            want: { forecast: false, alert: true, status: false }
        },
        {
            title: '연안바다 · 평수구역',
            body: '같은 해역 안에서도 육지에 가까운 연안바다와 항내 같은 평수구역은 '
                + '특보가 따로 내려집니다. 여기에 함께 보여줍니다.',
            image: EXAMPLE_IMG,
            imageRect: IMG_RECT.coast,
            skip: function () { return !!_firstSeaWithAlerts(); },
            want: { forecast: false, alert: true, status: false }
        },
        {
            title: '관측부이 — 실제로 재고 있는 값',
            body: '그 해역 근처 바다에 떠 있는 관측부이입니다. 이름을 누르면 예보가 아니라 '
                + '지금 실제로 재고 있는 파고·수온 같은 값이 그 자리에서 펼쳐집니다.',
            image: EXAMPLE_IMG,
            imageRect: IMG_RECT.buoy,
            skip: function () { return !!_firstSeaWithAlerts(); },
            want: { forecast: false, alert: true, status: false }
        },
        {
            title: '부이는 지금 바로 눌러 볼 수 있습니다',
            body: '부이는 특보가 없어도 「해역별 기상현황」 카드에 그대로 있습니다. '
                + '방금 그림에서 본 그 부이를 실제로 눌러 봤습니다 — 파고 · 수온 · 파주기 같은 '
                + '지금 관측값이 그 자리에서 펼쳐집니다.',
            skip: function () {
                return !!_firstSeaWithAlerts() || !_buoyBtn('status');
            },
            drill: 'status:buoy',
            target: function () { var el = _buoyBox('status'); return el ? [el] : null; },
            want: { forecast: false, alert: false, status: true }
        },
        {
            title: '카드 아래 버튼들',
            body: '기상예보 · 해구기상 · 윈디입니다. 이 버튼들은 특보가 없어도 그대로 있으니, '
                + '하나씩 실제로 눌러 보겠습니다.',
            image: EXAMPLE_IMG,
            imageRect: IMG_RECT.btns,
            skip: function () { return !!_firstSeaWithAlerts(); },
            want: { forecast: false, alert: true, status: false }
        },
        {
            title: '① 기상예보 — 노란 버튼',
            body: '맨 왼쪽 노란 버튼입니다. 누르면 그 해역의 예보표가 뜹니다 — '
                + '지금 상황이 아니라 앞으로 어떻게 될지를 봅니다. [다음] 을 누르면 실제로 눌러 드립니다.',
            image: EXAMPLE_IMG,
            imageRect: IMG_RECT.btn1,
            skip: function () { return !!_firstSeaWithAlerts(); },
            want: { forecast: false, alert: true, status: false }
        },
        {
            title: '눌렀더니 이렇게 뜹니다 — 기상예보',
            body: '실제로 누른 화면입니다. 날짜별 · 시간대별로 파고와 풍속, 풍향이 나옵니다. '
                + '옆으로 밀면 더 먼 날까지 볼 수 있습니다.',
            skip: function () {
                return !!_firstSeaWithAlerts() || !_cardBtn('기상예보', 'status');
            },
            drill: 'status:forecast',
            target: function () {
                var el = document.querySelector('#sea-forecast-modal .forecast-modal-content');
                return el ? [el] : null;
            },
            want: { forecast: false, alert: false, status: true }
        },
        {
            title: '② 해구기상 — 빨간 버튼',
            body: '두 번째 빨간 버튼입니다. 누르면 화면이 해양종합정보로 넘어가면서 '
                + '바다가 격자로 나뉩니다. [다음] 을 누르면 실제로 넘어갔다가 돌아옵니다.',
            image: EXAMPLE_IMG,
            imageRect: IMG_RECT.btn2,
            skip: function () { return !!_firstSeaWithAlerts(); },
            want: { forecast: false, alert: true, status: false }
        },
        {
            title: '눌렀더니 이렇게 넘어갑니다 — 해구기상',
            body: '바다가 칸(해구)으로 나뉘어 있습니다. 칸을 두 번 누르면 그 칸의 기상이 나옵니다. '
                + '[다음] 을 누르면 다시 원래 화면으로 돌아갑니다.',
            skip: function () {
                return !!_firstSeaWithAlerts() || !_cardBtn('해구기상', 'status');
            },
            drill: 'status:zonemap',
            target: function () {
                var el = document.getElementById('ocean-map');
                return el ? [el] : null;
            },
            want: { forecast: false, alert: false, status: true }
        },
        {
            title: '칸을 두 번 누르면 이 창이 나옵니다',
            body: '그 칸의 기상전망입니다. 날짜·시간대별 풍속과 유의파고, 시정이 '
                + '그래프와 표로 나옵니다. 화면 한가운데 칸을 대신 눌러 드렸습니다.',
            skip: function () {
                return !!_firstSeaWithAlerts() || !_cardBtn('해구기상', 'status');
            },
            drill: 'status:zonegrid',
            target: function () {
                // 덮개 전체가 아니라 창만 밝힌다
                var el = document.querySelector('#sea-zone-modal .modal-content');
                return el ? [el] : null;
            },
            want: { forecast: false, alert: false, status: true }
        },
        {
            title: '③ 윈디 — 파란 버튼',
            body: '세 번째 파란 버튼입니다. 바람과 물결의 흐름을 움직이는 그림으로 보여줍니다. '
                + '숫자보다 한눈에 들어옵니다.',
            image: EXAMPLE_IMG,
            imageRect: IMG_RECT.btn3,
            skip: function () { return !!_firstSeaWithAlerts(); },
            want: { forecast: false, alert: true, status: false }
        },
        {
            title: '눌렀더니 이렇게 뜹니다 — 윈디',
            body: '바람이 흐르는 모습이 그대로 보입니다. 화면을 끌어 옮기거나 키워서 볼 수 있습니다.',
            skip: function () {
                return !!_firstSeaWithAlerts() || !_cardBtn('윈디', 'status');
            },
            drill: 'status:windy',
            target: function () {
                var el = document.querySelector('#windy-modal .windy-modal-content');
                return el ? [el] : null;
            },
            want: { forecast: false, alert: false, status: true }
        },
        {
            title: '특보가 있는 바다를 펼칩니다',
            body: '특보가 내려진 바다를 누르면 그 안의 해역이 나옵니다. '
                + '지금은 맨 위에 있는 바다를 대신 펼쳐 보여드립니다.',
            // 특보가 아무 데도 없는 날은 펼칠 것이 없으므로 이 단계를 건너뛴다
            skip: function () { return !_firstSeaWithAlerts(); },
            drill: 'sea',
            target: function () {
                var list = _firstSeaWithAlerts();
                return list ? [list.parentElement] : null;   // .sea-section (머리글 + 목록)
            },
            want: { forecast: false, alert: true, status: false }
        },
        {
            title: '그 안에서 한 번 더 나뉩니다',
            body: '동해·남해처럼 넓은 바다는 「동해중부해상」 같은 묶음으로 한 번 더 나뉩니다. '
                + '제주처럼 나뉘지 않는 바다도 있습니다.',
            // 소분류가 없는 바다(제주 등)이거나 특보가 없으면 이 단계는 건너뛴다
            skip: function () {
                var list = _firstSeaWithAlerts();
                return !list || !_firstSub(list);
            },
            drill: 'sub',
            target: function () {
                var list = _firstSeaWithAlerts();
                return list ? [_firstSub(list)] : null;
            },
            want: { forecast: false, alert: true, status: false }
        },
        {
            title: '해역 하나하나가 이렇게 보입니다',
            body: '여기부터가 실제 특보 내용입니다. 해역 이름과 특보 종류, 그리고 그 아래에 '
                + '자세한 내용이 이어집니다.',
            skip: function () { return !_firstCard(); },
            drill: 'sub',
            target: function () { var c = _firstCard(); return c ? [c] : null; },
            want: { forecast: false, alert: true, status: false }
        },
        {
            title: '눌러서 펼치면 속이 보입니다',
            body: '해역을 누르면 그 아래로 자세한 내용이 펼쳐집니다. '
                + '파도 높이와 바람 세기, 특보가 언제 발표·발효되고 언제 풀리는지가 나옵니다.',
            skip: function () { return !_firstCard(); },
            drill: 'open',
            target: function () { var c = _firstCard(); return c ? [c] : null; },
            want: { forecast: false, alert: true, status: false }
        },
        {
            title: '파도 높이와 바람 세기',
            body: '그 해역의 유의파고(파도 높이)와 풍속(바람 세기)입니다. '
                + '배를 띄울지 말지 판단할 때 가장 먼저 보게 되는 숫자입니다. '
                + '연안 해역에서는 시정(얼마나 멀리 보이나)도 앞에 함께 나옵니다.',
            skip: function () {
                var c = _firstCard();
                return !c || !c.querySelector('.zone-avg-box');
            },
            drill: 'open',
            target: function () {
                var c = _firstCard();
                var box = c && (c.querySelector('.zone-avg-row') || c.querySelector('.zone-avg-box'));
                return box ? [box] : null;
            },
            want: { forecast: false, alert: true, status: false }
        },
        {
            title: '언제 발표되고 언제 풀리나',
            body: '발표시각은 기상청이 알린 때, 발효시각은 실제로 효력이 시작되는 때, '
                + '해제예정은 풀릴 것으로 보는 때입니다.',
            skip: function () { return _timeRows().length === 0; },
            drill: 'open',
            target: function () { var r = _timeRows(); return r.length ? r : null; },
            want: { forecast: false, alert: true, status: false }
        },
        {
            title: '연안바다 · 평수구역',
            body: '같은 해역 안에서도 육지에 가까운 연안바다와 항내 같은 평수구역은 '
                + '특보가 따로 내려집니다. 여기에 함께 보여줍니다.',
            skip: function () {
                var c = _firstCard();
                return !c || !c.querySelector('.coastal-zones');
            },
            drill: 'open',
            target: function () {
                var c = _firstCard();
                var el = c && c.querySelector('.coastal-zones');
                return el ? [el] : null;
            },
            want: { forecast: false, alert: true, status: false }
        },
        {
            title: '관측부이 — 실제로 재고 있는 값',
            body: '그 해역 근처 바다에 떠 있는 관측부이입니다. 예보가 아니라 '
                + '지금 실제로 재고 있는 값이라, 예보와 견줘 보면 도움이 됩니다.',
            skip: function () {
                var c = _firstCard();
                return !c || !c.querySelector('.buoy-section');
            },
            drill: 'open',
            target: function () {
                var c = _firstCard();
                var el = c && c.querySelector('.buoy-section');
                return el ? [el] : null;
            },
            want: { forecast: false, alert: true, status: false }
        },
        {
            title: '부이를 누르면 지금 값이 나옵니다',
            body: '부이 이름을 누르면 그 자리에서 파고 · 풍속 · 수온 같은 지금 관측값이 '
                + '펼쳐집니다. 한 번 더 누르면 닫힙니다.',
            skip: function () {
                var c = _firstCard();
                return !c || !c.querySelector('.buoy-btn');
            },
            drill: 'buoy',
            target: function () {
                var c = _firstCard();
                var el = c && c.querySelector('.buoy-section');
                return el ? [el] : null;
            },
            want: { forecast: false, alert: true, status: false }
        },
        {
            title: '카드 아래 버튼들',
            body: '카드 맨 아래에 버튼이 있습니다. 기상예보는 앞으로의 예보, '
                + '해구기상은 바다를 칸으로 나눠 본 기상, 윈디는 바람 흐름 그림입니다. '
                + '하나씩 눌러 보겠습니다.',
            skip: function () {
                var c = _firstCard();
                return !c || !c.querySelector('.card-action-btns');
            },
            drill: 'open',
            target: function () {
                var c = _firstCard();
                var el = c && c.querySelector('.card-action-btns');
                return el ? [el] : null;
            },
            want: { forecast: false, alert: true, status: false }
        },
        {
            title: '기상예보 — 앞으로의 예보',
            body: '카드 맨 아래 [기상예보] 를 누르면 그 해역의 예보표가 뜹니다. '
                + '지금 상황이 아니라 앞으로 어떻게 될지를 봅니다.',
            skip: function () { return !_cardBtn('기상예보'); },
            drill: 'forecast',
            target: function () {
                var el = document.querySelector('#sea-forecast-modal .forecast-modal-content');
                return el ? [el] : null;
            },
            want: { forecast: false, alert: true, status: false }
        },
        {
            title: '해구기상 — 바다를 칸으로 나눠 봅니다',
            body: '[해구기상] 을 누르면 해양종합정보 화면으로 넘어가면서 바다가 격자로 나뉩니다. '
                + '칸을 두 번 누르면 그 칸의 기상이 나옵니다.',
            skip: function () { return !_cardBtn('해구기상'); },
            drill: 'zonemap',
            target: function () {
                var el = document.getElementById('ocean-map');
                return el ? [el] : null;
            },
            want: { forecast: false, alert: true, status: false }
        },
        {
            title: '칸을 두 번 누르면 이 창이 나옵니다',
            body: '그 칸의 기상전망입니다. 날짜·시간대별 풍속과 유의파고, 시정이 '
                + '그래프와 표로 나옵니다. 화면 한가운데 칸을 대신 눌러 드렸습니다.',
            skip: function () { return !_cardBtn('해구기상'); },
            drill: 'zonegrid',
            target: function () {
                // 덮개 전체가 아니라 창만 밝힌다
                var el = document.querySelector('#sea-zone-modal .modal-content');
                return el ? [el] : null;
            },
            want: { forecast: false, alert: true, status: false }
        },
        {
            title: '윈디 — 바람의 흐름을 그림으로',
            body: '[윈디] 는 바람과 물결의 흐름을 움직이는 그림으로 보여줍니다. '
                + '숫자보다 한눈에 들어옵니다.',
            skip: function () { return !_cardBtn('윈디'); },
            drill: 'windy',
            target: function () {
                var el = document.querySelector('#windy-modal .windy-modal-content');
                return el ? [el] : null;
            },
            want: { forecast: false, alert: true, status: false }
        },
        {
            title: '특보가 없어도 볼 수 있습니다',
            body: '특보가 내려지지 않은 해역도 지금 바다가 어떤지는 알아야 합니다. '
                + '그래서 바로 아래에 「해역별 기상현황」을 따로 두었습니다.',
            drill: 'status:',
            target: function () {
                return [document.getElementById('marine-status-accordion-header'),
                        document.getElementById('marine-status-accordion-body')];
            },
            want: { forecast: false, alert: false, status: true }
        },
        {
            title: '여기도 똑같이 나뉩니다',
            body: '동해 · 서해 · 남해 · 제주, 그 안의 묶음까지 특보현황과 같은 차례로 들어갑니다. '
                + '다른 점은 특보가 있든 없든 모든 해역이 다 들어 있다는 것입니다.',
            skip: function () {
                var l = _firstSeaWithAlerts('status');
                return !l || !_firstSub(l);
            },
            drill: 'status:sub',
            target: function () {
                var l = _firstSeaWithAlerts('status');
                return l ? [_firstSub(l)] : null;
            },
            want: { forecast: false, alert: false, status: true }
        },
        {
            title: '해역마다 지금 바다 상태가 나옵니다',
            body: '파도 높이와 바람 세기, 관측부이, 그리고 기상예보 · 해구기상 · 윈디 버튼까지 '
                + '특보 카드에서 본 것과 똑같이 들어 있습니다.',
            skip: function () { return !_firstCard('status'); },
            drill: 'status:sub',
            target: function () { var c = _firstCard('status'); return c ? [c] : null; },
            want: { forecast: false, alert: false, status: true }
        }
    ];


    // ========================================================================
    // [단계 목록 — 해양종합정보(지도) 탭]
    //
    // 설명 글은 **새로 쓰지 않는다.** 지도 왼쪽 위 「안 내」 버튼이 이미 기능마다
    // 확정된 설명을 갖고 있어(js/ocean-map/cctv/ocean_cctv.js 의 INFO_TAB_ITEMS),
    // 그것을 그대로 가져다 쓴다. 같은 기능을 두 곳에서 다르게 설명하면 나중에
    // 한쪽만 고쳐져 어긋나기 때문이다.
    //
    //   btns : 이 단계에서 **켜져 있어야 하는** 지도 버튼들. 여기 없는 관리 대상 버튼은
    //          꺼진다 — 그래서 [이전] 으로 돌아와도 화면이 그 단계 모습으로 맞춰진다.
    //   pop  : 이 단계에서 펼쳐 둘 팝아웃 ('basemap' = 지도 종류 메뉴, 'otherwx' = 천기)
    // ========================================================================

    /** 지도 버튼 하나를 id 나 선택자로 찾는다. @param {string} sel @returns {HTMLElement|null} */
    function _ob(sel) {
        return document.querySelector(sel.charAt(0) === '[' ? sel : '#' + sel);
    }

    /**
     * 「안 내」 팝업이 갖고 있는 설명문을 가져온다.
     *
     * @param {string} id - INFO_TAB_ITEMS 의 항목 id ('wind' · 'buoy' · 'seagrid' …)
     * @returns {Object} { title, body } 또는 { title, bodyHtml }
     * [연계] ocean_cctv.js 의 window.oceanInfoTabItems
     */
    function _info(id) {
        var list = window.oceanInfoTabItems || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === id) {
                return list[i].bodyHtml
                    ? { title: list[i].label, bodyHtml: list[i].bodyHtml }
                    : { title: list[i].label, body: list[i].body };
            }
        }
        // 안내 팝업이 아직 안 올라왔을 때를 대비한 최소 표시(실제로는 거의 안 쓰인다)
        return { title: id, body: '설명을 불러오지 못했습니다.' };
    }

    /**
     * 지도 버튼 하나를 원하는 상태로 만든다(이미 그 상태면 아무것도 안 한다).
     *
     * @param {string} sel - 버튼 선택자
     * @param {boolean} on - 켠 상태로 둘지
     * [연계] _setOceanBtns 가 쓴다. 버튼의 active 클래스로 현재 상태를 읽는다.
     */
    function _obSet(sel, on) {
        var b = _ob(sel);
        if (!b) return;
        // 화면에 없는 버튼은 건드리지 않는다 — 「특보 ON」은 지금 특보가 있을 때만
        //   나타나고, 특보구역을 켠 **뒤에야** 생긴다. 숨은 것을 누르면 엉뚱한 상태가 된다.
        if (b.getBoundingClientRect().height < 1) return;
        var now = b.classList.contains('active');
        if (now !== on) b.click();
    }

    /**
     * 지도 튜토리얼이 다루는 버튼 전체를 이 단계의 모습으로 맞춘다.
     *
     * 왜 전체를 맞추나?
     *   [다음] 뿐 아니라 [이전] 으로 돌아왔을 때도 그 단계의 화면이 나와야 한다.
     *   "켤 것만 켜고 끄지 않으면" 뒤로 갈수록 레이어가 겹겹이 쌓인다.
     *
     * @param {Array<string>} list - 켜 둘 버튼 선택자들(없으면 전부 끈다)
     */
    function _setOceanBtns(list) {
        var want = {};
        (list || []).forEach(function (sel) { want[sel] = true; });
        var pass = function () {
            // [순서가 중요하다] 끌 것을 **뒤에서부터** 먼저 끄고, 켤 것을 나중에 켠다.
            //   「특보 ON」은 특보구역에 딸린 버튼이라, 특보구역을 먼저 꺼 버리면
            //   그 버튼이 화면에서 사라져 **끌 수가 없다**(실측: 켠 채로 끝까지 남았다).
            var list = _btnList();
            for (var i = list.length - 1; i >= 0; i--) {
                if (!want[list[i]]) _obSet(list[i], false);
            }
            list.forEach(function (sel) { if (want[sel]) _obSet(sel, true); });
        };
        pass();
        // 한 번 더 맞춘다 — 「특보 ON」 버튼은 **특보구역을 켠 뒤에** 화면에 생기므로
        //   첫 번째에는 아직 없어서 건너뛴다(위 _obSet 의 "안 보이면 건드리지 않는다").
        setTimeout(pass, 0);
    }

    /**
     * 팝아웃(지도 종류 메뉴 · 천기)을 원하는 상태로 만든다.
     *
     * @param {string} which - 'basemap' | 'otherwx' | 없으면 둘 다 닫는다
     * [연계] 이 둘은 active 클래스가 아니라 **펼쳐진 상자의 높이**로 상태를 읽는다
     *        (실측으로 확인 — 버튼에 active 가 안 붙는다).
     */
    function _setOceanPop(which) {
        [['basemap', 'ocean-basemap-toggle', 'ocean-basemap-menu'],
         ['otherwx', 'ocean-other-wx-toggle-btn', 'ocean-other-wx-popup']].forEach(function (t) {
            var btn = document.getElementById(t[1]);
            var box = document.getElementById(t[2]);
            if (!btn || !box) return;
            // [왜 미루나 — 상태 확인까지 함께 미룬다]
            //   천기 팝아웃에는 "바깥을 누르면 닫힌다"는 규칙이 있다
            //   (shrt_forecast_layer.js 의 document 클릭 핸들러). 그래서 지금 처리 중인
            //   [다음]·[이전] 클릭이 이어서 document 까지 퍼져 나가면서 팝아웃을 닫는다.
            //   **지금 열렸는지 여기서 먼저 읽어 두면 그 판단이 곧 뒤집힌다** —
            //   앞으로 갈 때는 우리가 연 것을 그 클릭이 닫고, 뒤로 올 때는 이미 닫힌 것을
            //   "열려 있다" 로 잘못 읽어 아무것도 안 했다(실측으로 확인).
            //   그래서 그 클릭이 다 끝난 뒤에 **다시 읽고** 필요할 때만 누른다.
            setTimeout(function () {
                var open = box.getBoundingClientRect().height > 1;
                if (open !== (which === t[0])) btn.click();
            }, 0);
        });
    }

    // 해양안전(해양안전생활 탭) 지도 버튼 — 화면 세로 순서 그대로
    var SAFETY_BTNS = [
        'ocean-terrain-toggle-btn', 'ocean-accident-toggle-btn', 'ocean-banzone-toggle-btn',
        'ocean-navwarn-btn', 'ocean-mudflat-toggle-btn', 'ocean-cctv-toggle-btn',
        'ocean-vts-toggle-btn', 'ocean-seaway-toggle-btn'
    ];

    /** 지금 모드에서 켜고 끄는 버튼 목록. @returns {Array<string>} */
    function _btnList() { return (_mode === 'safety') ? SAFETY_BTNS : OCEAN_BTNS; }

    var OCEAN_BTNS = [
        '[data-layer="wind"]', '[data-layer="current"]', '[data-layer="wave"]',
        'ocean-buoy-toggle-btn', 'ocean-marine-zone-toggle-btn',
        'ocean-warn-zone-toggle-btn', 'ocean-warn-active-toggle-btn',
        'ocean-typhoon-toggle-btn'
    ];

    /**
     * 이 단계에서 열어 둘 "눌러서 보는 창"을 맞춘다.
     *
     * 왜 필요한가?
     *   버튼만 켜면 지도에 표시가 생길 뿐이고, **그것을 눌렀을 때 무엇이 나오는지**는
     *   안 보인다(사용자 지적 2026-09-25 — 부이·해구도 둘 다 누른 화면이 없었다).
     *   그래서 이 단계에서는 앱이 대신 눌러 준다.
     *
     * @param {string} which - 'buoy'(부이 관측값 창) · 'zone'(해구 기상전망 창) · 없으면 둘 다 닫는다
     * [연계] ocean_buoy.js 의 window.showBuoyModal · marine.js 의 window.getMarineZoneData /
     *        window.closeSeaZoneModal
     */
    function _setOceanOpen(which) {
        // 먼저 이 단계에서 필요 없는 창을 닫는다
        if (which !== 'buoy') {
            var bm = document.getElementById('buoy-info-modal');
            var bd = document.getElementById('buoy-modal-backdrop');
            if (bm) bm.remove();
            if (bd) bd.remove();
        }
        if (which !== 'zone' && typeof window.closeSeaZoneModal === 'function') {
            if (document.getElementById('sea-zone-modal')) window.closeSeaZoneModal();
        }
        if (which !== 'sheet') {
            var sheet = document.getElementById('ocean-bottom-sheet');
            var x = document.getElementById('ocean-sheet-close');
            if (sheet && x && sheet.classList.contains('open')) x.click();
        }
        if (!which) return;

        // 자료가 실제로 올라온 뒤에 연다(시간이 아니라 조건으로 기다린다)
        if (which === 'sheet') {
            var sh = document.getElementById('ocean-bottom-sheet');
            if (sh && sh.classList.contains('open')) return;
            _when(function () { return typeof window.showOceanBottomSheet === 'function'; }, function () {
                var el = document.getElementById('ocean-bottom-sheet');
                if (el && el.classList.contains('open')) return;
                window.showOceanBottomSheet(SHEET_PT[0], SHEET_PT[1]);
            });
        } else if (which === 'buoy') {
            if (document.getElementById('buoy-info-modal')) return;
            _when(function () { return !!_centerBuoy(); }, function () {
                if (document.getElementById('buoy-info-modal')) return;
                var f = _centerBuoy();
                if (!f || typeof window.showBuoyModal !== 'function') return;
                window.showBuoyModal(f.get('buoyId'),
                    { name: f.get('buoyName'), type: f.get('buoyType') });
            });
        } else if (which === 'zone') {
            if (document.getElementById('sea-zone-modal')) return;
            _when(function () { return _zoneIdsNear(1).length > 0; }, function () {
                if (document.getElementById('sea-zone-modal')) return;
                if (typeof window.getMarineZoneData !== 'function') return;
                _pickZoneWithData(function (id) {
                    if (!_root || document.getElementById('sea-zone-modal')) return;
                    if (id) window.getMarineZoneData(id);
                });
            });
        }
    }

    // 바텀시트를 띄워 보여 줄 자리 — **동해 삼척 앞바다**(사용자 확정 2026-09-26).
    //   [왜 고정인가] 전에는 화면 한가운데에서 가까운 바다를 찾았는데, 지도가 한반도
    //   중부를 보고 있어 서해가 걸렸고 그 자리는 **조석이 안 나왔다**(사용자 지적).
    //   삼척 동쪽은 조석까지 다 나오는 것을 확인했다.
    var SHEET_PT = [37.45, 129.30];   // [위도, 경도]

    /**
     * 바텀시트가 보이는 자리(시트 위쪽 지도 구간)의 한가운데로 지도를 옮긴다.
     *
     * 왜 필요한가?
     *   "어디를 찍은 것이냐"가 화면으로 드러나야 한다(사용자 지적 2026-09-26).
     *   시트가 화면 아래를 덮으므로, 그 위에 남는 구간의 한가운데에 그 지점을 놓는다.
     *
     * [연계] ol.proj.fromLonLat · view.centerOn
     */
    function _focusSheetPoint() {
        var map = window.getOceanMap && window.getOceanMap();
        var box = _oceanMapEl();
        if (!map || !box || typeof ol === 'undefined') return;
        var size = map.getSize();
        if (!size) return;
        var r = box.getBoundingClientRect();
        var sheet = document.getElementById('ocean-bottom-sheet');
        var sr = sheet ? sheet.getBoundingClientRect() : null;
        // [카드는 안 본다] 이 단계의 설명 카드는 시트 **아래**에 놓인다. 그것까지 계산에
        //   넣었더니 남는 구간이 없다고 판단해 지도 한가운데로 밀렸고, 그 자리가 시트에
        //   가려 엉뚱한 곳(북한 동해안)이 보였다(실측 2026-09-26).
        //   보이는 곳은 "지도 위쪽 ~ 시트가 시작되는 곳" 이다.
        var top    = GAP + _insets.top + TAG_H;
        var bottom = (sr && sr.height > 1 ? sr.top - r.top : size[1]) - GAP;
        if (bottom <= top) { top = 0; bottom = size[1]; }
        map.getView().centerOn(ol.proj.fromLonLat([SHEET_PT[1], SHEET_PT[0]]),
                               size, [size[0] / 2, (top + bottom) / 2]);
    }

    /**
     * 바텀시트를 위에서 아래까지 **천천히 한 번** 내려 보여 준다.
     *
     * 왜 필요한가?
     *   휴대폰 화면이 좁아 시트가 다 안 들어간다. 로딩이 끝나면 위쪽만 보이고
     *   아래(조석·천문·기압 등)는 손으로 밀어야 보였다(사용자 지적 2026-09-26).
     *
     * [연계] #ocean-bottom-sheet 자체가 스크롤 상자다(overflow-y:auto).
     *        내용이 늦게 도착해 길이가 늘어날 수 있어 **매 프레임 끝 위치를 다시 잰다.**
     */
    function _autoScrollSheet() {
        var el = document.getElementById('ocean-bottom-sheet');
        if (!el) return;
        if (_sheetScrollId) { cancelAnimationFrame(_sheetScrollId); _sheetScrollId = 0; }
        el.scrollTop = 0;
        var t0 = 0;
        var DUR = 4000;   // 4초에 걸쳐 천천히
        var step = function (ts) {
            if (!_root) { _sheetScrollId = 0; return; }
            if (!t0) t0 = ts;
            var to = el.scrollHeight - el.clientHeight;
            if (to < 4) { _sheetScrollId = 0; return; }
            var p = Math.min(1, (ts - t0) / DUR);
            el.scrollTop = to * p;
            _sheetScrollId = (p < 1) ? requestAnimationFrame(step) : 0;
        };
        _sheetScrollId = requestAnimationFrame(step);
    }

    /**
     * 화면 한가운데에서 가까운 해구(대해구) 번호를 가까운 순으로 모은다.
     *
     * @param {number} n - 몇 개까지
     * @returns {Array<string>} 해구 번호들(가까운 순)
     * [연계] 지도에 올라온 해구 격자 피처의 marine_zone_no.
     *        소해구(번호에 '-' 가 들어간 것)는 제외한다 — 예보값은 대해구 단위다.
     */
    function _zoneIdsNear(n) {
        var map = window.getOceanMap && window.getOceanMap();
        if (!map) return [];
        var c;
        try { c = map.getView().getCenter(); } catch (e) { return []; }
        if (!c) return [];
        var list = [];
        var seen = {};
        map.getLayers().forEach(function (l) {
            var src = l.getSource && l.getSource();
            if (!src || typeof src.getFeatures !== 'function') return;
            var fs;
            try { fs = src.getFeatures(); } catch (e) { return; }
            for (var i = 0; i < fs.length; i++) {
                var no = fs[i].get('marine_zone_no');
                if (!no) continue;
                no = String(no);
                if (no.indexOf('-') !== -1 || seen[no]) continue;
                var g = fs[i].getGeometry();
                if (!g) continue;
                var e = g.getExtent();
                var cx = (e[0] + e[2]) / 2, cy = (e[1] + e[3]) / 2;
                seen[no] = true;
                list.push({ id: no, d: (cx - c[0]) * (cx - c[0]) + (cy - c[1]) * (cy - c[1]) });
            }
        });
        list.sort(function (a, b) { return a.d - b.d; });
        return list.slice(0, n || 8).map(function (o) { return o.id; });
    }

    /**
     * 가까운 해구 중 **예보값이 실제로 들어 있는** 것을 하나 고른다.
     *
     * 왜 필요한가?
     *   해구마다 예보가 있는 곳과 없는 곳이 갈린다. 그냥 가장 가까운 칸을 열었더니
     *   표가 전부 "-999.0"(값 없음)으로 찼다(실측 2026-09-25 — 5097해구).
     *   설명용 화면이 값 없는 표면 보여줄 것이 없다.
     *
     * @param {Function} done - 고른 해구 번호를 받는 함수(끝내 못 찾으면 가장 가까운 것)
     * [연계] GET /api/marine-zone-forecasts/:zone — 해구 하나치만 받는 가벼운 길
     */
    function _pickZoneWithData(done) {
        var ids = _zoneIdsNear(8);
        if (!ids.length) { done(null); return; }
        var i = 0;
        var next = function () {
            if (i >= ids.length) { done(ids[0]); return; }   // 다 없으면 가장 가까운 것
            var id = ids[i++];
            fetch('/api/marine-zone-forecasts/' + id)
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (j) {
                    var d = j && j.data && j.data[id];
                    var txt = d ? JSON.stringify(d) : '';
                    if (txt.length > 50 && txt.indexOf('-999') === -1) done(id);
                    else next();
                })
                .catch(next);
        };
        next();
    }

    /**
     * 화면 한가운데에서 가장 가까운 부이를 고른다.
     *
     * @returns {Object|null} ol feature (부이) 또는 없으면 null
     * [연계] ocean_buoy.js 가 지도에 올린 마커(markerType === 'buoy').
     *        화면에 찍힌 것으로 찾지 않고 **자료에서 좌표로** 고른다 — 해구도와 같은 이유
     *        (탭을 오간 직후에는 아직 다시 그려지지 않아 못 찾는다).
     */
    function _centerBuoy() {
        var map = window.getOceanMap && window.getOceanMap();
        if (!map) return null;
        var c;
        try { c = map.getView().getCenter(); } catch (e) { return null; }
        if (!c) return null;
        var best = null, bestD = Infinity;
        map.getLayers().forEach(function (l) {
            var src = l.getSource && l.getSource();
            if (!src || typeof src.getFeatures !== 'function') return;
            var fs;
            try { fs = src.getFeatures(); } catch (e) { return; }
            for (var i = 0; i < fs.length; i++) {
                if (fs[i].get('markerType') !== 'buoy') continue;
                var g = fs[i].getGeometry();
                if (!g || typeof g.getCoordinates !== 'function') continue;
                var p = g.getCoordinates();
                var d = (p[0] - c[0]) * (p[0] - c[0]) + (p[1] - c[1]) * (p[1] - c[1]);
                if (d < bestD) { bestD = d; best = fs[i]; }
            }
        });
        return best;
    }

    /**
     * 태풍이 설명 카드와 아래 조작줄 사이의 **한가운데**에 오도록 지도를 옮긴다.
     *
     * 왜 필요한가?
     *   앱은 태풍을 켤 때 "태풍 + 우리나라"가 다 보이게 맞추는데, 태풍이 멀리 있으면
     *   화면 구석에 몰린다(사용자 지적 2026-09-25). 튜토리얼에서는 태풍 자체를 봐야 한다.
     *
     * [연계] ocean_typhoon.js 가 지도에 올린 말풍선 중 **지금 위치**(tphn-bubble,
     *        tphn-faint 가 아닌 것)의 좌표를 쓴다. 앱이 켜면서 맞추는 이동(0.6초)이
     *        끝난 뒤에 다시 맞춘다.
     */
    function _focusTyphoon() {
        var map = window.getOceanMap && window.getOceanMap();
        var box = _oceanMapEl();
        if (!map || !box) return;
        var pos = null;
        map.getOverlays().forEach(function (o) {
            if (pos) return;
            var el = o.getElement();
            var cls = el ? String(el.className || '') : '';
            if (cls.indexOf('tphn-bubble') === -1 || cls.indexOf('tphn-faint') !== -1) return;
            pos = o.getPosition();
        });
        if (!pos) return;
        var size = map.getSize();
        if (!size) return;
        var r = box.getBoundingClientRect();
        // 카드(위)와 태풍 조작줄(아래) 사이가 실제로 보이는 구간이다
        var card  = _card ? _card.getBoundingClientRect() : null;
        var panel = document.getElementById('ocean-typhoon-panel');
        var pr = panel ? panel.getBoundingClientRect() : null;
        var top    = (card && card.bottom > r.top ? card.bottom : r.top) - r.top + GAP;
        var bottom = (pr && pr.height > 1 ? pr.top : r.bottom) - r.top - GAP;
        if (bottom <= top) { top = 0; bottom = size[1]; }
        map.getView().centerOn(pos, size, [size[0] / 2, (top + bottom) / 2]);
    }

    /** 지도 그림 전체(구멍을 지도에 뚫을 때 쓴다). @returns {HTMLElement|null} */
    function _oceanMapEl() { return document.getElementById('ocean-map'); }

    /**
     * 버튼과 지도를 함께 비추는 대상을 만든다.
     * @param {string} sel - 버튼 선택자
     * @returns {Function} target 함수
     * [연계] 버튼만 비추면 "그래서 지도에 뭐가 생겼나"가 안 보인다.
     */
    function _obTarget(sel) {
        return function () {
            var b = _ob(sel), m = _oceanMapEl();
            return b ? (m ? [b, m] : [b]) : null;
        };
    }

    var STEPS_OCEAN = [
        {
            title: '해양종합정보 — 바다 지도',
            body: '바다 상태를 지도 위에 겹쳐 보는 화면입니다. 오른쪽 세로줄 버튼을 누르면 '
                + '바람 · 물살 · 파도 · 부이 같은 정보가 지도에 하나씩 올라옵니다. '
                + '지금부터 버튼을 하나씩 실제로 눌러 가며 보여드립니다.',
            target: function () { var m = _oceanMapEl(); return m ? [m] : null; },
            btns: []
        },
        {
            title: '지도를 누르면 — 그 지점의 종합 정보',
            // [짧게 쓴 이유] 바텀시트가 화면 아래 60%를 차지해 카드 자리가 좁다.
            //   길게 쓰면 마지막 줄이 잘린다(실측 2026-09-25).
            body: '바다 아무 곳이나 누르면 그 지점의 파고 · 바람 · 물살 · 수온 · 수심 · '
                + '시정에 조석 · 일출몰 · 기압까지 한 번에 열립니다(동해 삼척 앞바다).',
            target: function () {
                var sh = document.getElementById('ocean-bottom-sheet');
                return (sh && sh.getBoundingClientRect().height > 1) ? [sh] : null;
            },
            btns: [], open: 'sheet', focusSheet: true, autoScroll: true
        },
        {
            title: '위치 검색',
            body: _info('search').body,
            target: function () {
                var e = document.getElementById('ocean-search-container');
                return e ? [e] : null;
            },
            btns: []
        },
        {
            title: '지도 종류',
            body: _info('basemap').body,
            target: function () {
                var b = document.getElementById('ocean-basemap-toggle');
                var m = document.getElementById('ocean-basemap-menu');
                if (!b) return null;
                return (m && m.getBoundingClientRect().height > 1) ? [b, m] : [b];
            },
            btns: [], pop: 'basemap'
        },
        {
            title: '진북 정렬',
            body: _info('northup').body,
            target: function () {
                var b = document.getElementById('ocean-northup-btn');
                return b ? [b] : null;
            },
            btns: []
        },
        {
            title: '안 내 — 모든 설명이 여기 있습니다',
            body: '지금 보여드리는 설명은 이 「안 내」 버튼 안에도 그대로 들어 있습니다. '
                + '나중에 기능이 헷갈리면 이 버튼을 누르면 됩니다. 기능마다 탭이 나뉘어 있고, '
                + '자료를 어디에서 받아 오는지(출처)까지 적혀 있습니다.',
            target: function () {
                var b = document.getElementById('ocean-info-btn');
                return b ? [b] : null;
            },
            btns: []
        },
        {
            title: '풍향·풍속',
            body: _info('wind').body,
            target: _obTarget('[data-layer="wind"]'),
            btns: ['[data-layer="wind"]']
        },
        {
            title: '유향·유속',
            body: _info('current').body,
            target: _obTarget('[data-layer="current"]'),
            btns: ['[data-layer="current"]']
        },
        {
            title: '파고·파향',
            body: _info('wave').body,
            target: _obTarget('[data-layer="wave"]'),
            btns: ['[data-layer="wave"]']
        },
        {
            title: '기상부이',
            body: _info('buoy').body,
            target: _obTarget('ocean-buoy-toggle-btn'),
            btns: ['ocean-buoy-toggle-btn']
        },
        {
            title: '부이를 누르면 — 관측값이 열립니다',
            body: '지도에 뜬 부이를 누르면 그 부이가 방금 잰 값이 열립니다. '
                + '풍속·풍향·기온·기압처럼 그 자리에서 실제로 측정한 값이고, '
                + '부이 종류에 따라 나오는 항목이 다릅니다. '
                + '지금은 화면 한가운데에서 가장 가까운 부이를 대신 눌러 보여드립니다.',
            target: function () {
                var m = document.getElementById('buoy-info-modal');
                return m ? [m] : null;
            },
            btns: ['ocean-buoy-toggle-btn'], open: 'buoy'
        },
        {
            title: '해구기상',
            // [짧게 쓴 이유] 사용자 확정 2026-09-26 — 격자 구조·자동 배경전환 같은 속사정은
            //   빼고, "누르면 표로 보여준다" 만 알려 준다. 실제 화면은 바로 다음 단계에서 본다.
            body: '바다를 격자로 나눠 표시합니다. 각 대해구(또는 소해구)를 누르면 '
                + '그 해구의 기상 내용을 표로 보여줍니다.',
            target: _obTarget('ocean-marine-zone-toggle-btn'),
            btns: ['ocean-marine-zone-toggle-btn']
        },
        {
            title: '해구 칸을 누르면 — 기상전망이 열립니다',
            // [짧게 쓴 이유] 이 단계는 기상전망 창이 화면을 거의 다 쓰므로 카드 자리가
            //   좁다. 길게 쓰면 마지막 줄이 잘린다(실측 2026-09-25).
            body: '격자의 칸을 누르면 그 해구의 기상전망이 열립니다. '
                + '풍향 · 풍속 · 유의파고 · 파향 · 파주기 · 시정을 '
                + '3시간 간격으로 최대 75시간까지 보여줍니다.',
            target: function () {
                var m = document.getElementById('sea-zone-modal');
                var c = m && m.querySelector('.modal-content');
                return c ? [c] : (m ? [m] : null);
            },
            btns: ['ocean-marine-zone-toggle-btn'], open: 'zone', fitZoneModal: true
        },
        {
            title: '특보구역',
            bodyHtml: _info('warnzone').bodyHtml,
            // 「특보 ON」은 특보가 있을 때만 옆에 나타난다 — 있으면 함께 비춘다
            target: function () {
                var b = _ob('ocean-warn-zone-toggle-btn'), m = _oceanMapEl();
                if (!b) return null;
                var on = document.getElementById('ocean-warn-active-toggle-btn');
                var list = [b];
                if (on && on.getBoundingClientRect().height > 1) list.unshift(on);
                if (m) list.push(m);
                return list;
            },
            // 「특보 ON」도 함께 켠다(사용자 확정 2026-09-25) — 특보가 없는 날에는
            //   그 버튼이 화면에 아예 없으므로 _obSet 이 알아서 건너뛴다.
            btns: ['ocean-warn-zone-toggle-btn', 'ocean-warn-active-toggle-btn']
        },
        {
            title: '태풍',
            // [짧게 쓴 이유] 사용자 확정 2026-09-26 — 재생·회차·반경 같은 속사정은 빼고
            //   "예상 진로를 그리고 행동요령까지 준다" 만 알려 준다.
            body: '우리 바다에 영향을 주는 태풍의 예상 진로를 지도에 그려 줍니다. '
                + '태풍을 눌러 들어가면 해상 · 육상 행동요령까지 볼 수 있습니다.',
            // 태풍이 없는 날에는 버튼이 회색(tphn-disabled)이라 눌러도 아무 일이 없다
            //   → 이 단계를 통째로 건너뛴다(사용자 확정 2026-09-25).
            skip: function () {
                var b = document.getElementById('ocean-typhoon-toggle-btn');
                return !b || b.classList.contains('tphn-disabled')
                    || b.getBoundingClientRect().height < 1;
            },
            // 아래 조작줄(연도·태풍·자료출처 고르는 줄)까지 함께 비춘다 — 설명 카드가
            //   그 줄을 덮지 않게 하려는 것이다(사용자 지적 2026-09-25).
            target: function () {
                var b = _ob('ocean-typhoon-toggle-btn'), m = _oceanMapEl();
                if (!b) return null;
                var list = [b];
                if (m) list.push(m);
                var p = document.getElementById('ocean-typhoon-panel');
                if (p && p.getBoundingClientRect().height > 1) list.push(p);
                return list;
            },
            btns: ['ocean-typhoon-toggle-btn'], cardTop: true, focusTyphoon: true
        }
    ];


    // ========================================================================
    // [단계 목록 — 해양안전생활 ▸ 해양안전]
    //
    // 같은 지도를 쓰지만 버튼 구성이 해양종합정보와 다르다(index2.html 의 body.ls-safety
    // 규칙). 설명 글은 「안 내」 원문을 **한두 줄로 줄여** 따로 썼다(사용자 확정 2026-09-26).
    // ========================================================================
    var STEPS_SAFETY = [
        {
            title: '해양안전 — 바다에서 조심할 것',
            body: '바다에서 위험한 곳과 하면 안 되는 곳을 지도에 겹쳐 보는 화면입니다. '
                + '오른쪽 버튼을 누르면 바위 · 사고 기록 · 금지구역 같은 것이 하나씩 올라옵니다.',
            target: function () { var m = _oceanMapEl(); return m ? [m] : null; },
            btns: []
        },
        {
            title: '지도 종류',
            body: '지도 배경을 바꿉니다. 버튼에 따라 위성지도나 전자해도로 저절로 바뀌기도 합니다.',
            target: function () {
                var b = document.getElementById('ocean-basemap-toggle');
                var m = document.getElementById('ocean-basemap-menu');
                if (!b) return null;
                return (m && m.getBoundingClientRect().height > 1) ? [b, m] : [b];
            },
            btns: [], pop: 'basemap'
        },
        {
            title: '안 내 — 자세한 설명은 여기',
            body: '지금 보여드리는 것보다 자세한 설명이 이 버튼 안에 들어 있습니다. '
                + '자료를 어디에서 받아 오는지(출처)와 주의할 점까지 적혀 있습니다.',
            target: function () {
                var b = document.getElementById('ocean-info-btn');
                return b ? [b] : null;
            },
            btns: []
        },
        {
            title: '진북 정렬',
            body: '지도를 정북(위쪽=북) 방향으로 맞춥니다.',
            target: function () {
                var b = document.getElementById('ocean-northup-btn');
                return b ? [b] : null;
            },
            btns: []
        },
        {
            title: '위험지형',
            body: '바다 위와 물속의 바위를 표시합니다. 켜면 화면 왼쪽 위에 스위치가 생겨 '
                + '노출암 · 갯바위와 간출암 · 암암을 골라 볼 수 있습니다.',
            target: _obTarget('ocean-terrain-toggle-btn'),
            btns: ['ocean-terrain-toggle-btn']
        },
        {
            title: '사고정보',
            body: '실제로 일어난 해양사고 기록을 지도에 보여줍니다. 왼쪽 위 [분석 · 현황]으로 '
                + '한 건씩 보거나 격자 통계로 볼 수 있습니다. 지나간 기록이며 예보가 아닙니다.',
            target: _obTarget('ocean-accident-toggle-btn'),
            btns: ['ocean-accident-toggle-btn']
        },
        {
            title: '금지구역',
            body: '낚시금지구역과 출입통제구역을 함께 표시합니다. 구역을 누르면 '
                + '지정 사유 · 통제 기간 · 벌칙까지 볼 수 있습니다.',
            target: _obTarget('ocean-banzone-toggle-btn'),
            btns: ['ocean-banzone-toggle-btn']
        },
        {
            title: '항행경보',
            body: '그날 발효 중인 항행경보 구역(사고 · 장애물 · 해상사격훈련 등)을 '
                + '빨간 점선으로 표시합니다. 날짜와 시각을 바꿔 가며 볼 수 있습니다.',
            target: _obTarget('ocean-navwarn-btn'),
            btns: ['ocean-navwarn-btn']
        },
        {
            title: '물빠짐',
            body: '서해 · 남해 갯벌이 썰물에 얼마나 드러나는지 예측해 갈색으로 표시합니다. '
                + '아래 슬라이더로 3일치를 1시간 단위로 볼 수 있습니다.',
            target: _obTarget('ocean-mudflat-toggle-btn'),
            btns: ['ocean-mudflat-toggle-btn']
        },
        {
            title: 'CCTV',
            body: '공공에 공개된 해안 CCTV 영상을 볼 수 있습니다. '
                + '항구 상태와 바다 날씨를 눈으로 확인할 때 씁니다.',
            target: _obTarget('ocean-cctv-toggle-btn'),
            btns: ['ocean-cctv-toggle-btn']
        },
        {
            title: '관제구역',
            body: '선박교통관제구역(VTS)을 표시하고 관제채널이 함께 적힙니다. '
                + '구역을 누르면 관제센터 주소와 전화번호를 볼 수 있습니다.',
            target: _obTarget('ocean-vts-toggle-btn'),
            btns: ['ocean-vts-toggle-btn']
        },
        {
            title: '항로·해역',
            body: '지정된 항로는 자홍색으로, 한중 · 한일 사이 해양경계 수역은 선홍색으로 '
                + '나눠 표시합니다.',
            target: _obTarget('ocean-seaway-toggle-btn'),
            btns: ['ocean-seaway-toggle-btn']
        }
    ];


    // ========================================================================
    // [단계 목록 — 해양안전생활 ▸ 해양생활]
    //
    // 활동 7개를 오른쪽 세로 레일에서 고른다. 여섯은 "지점마다 색으로 지수를 찍은 지도"라
    // 생김새가 같고, 바다갈라짐만 표로 보여준다.
    // ========================================================================

    /** 레일의 활동 버튼. @param {string} sec - 활동 섹션 id @returns {HTMLElement|null} */
    function _actBtn(sec) { return document.querySelector('#ls-rail [data-act="' + sec + '"]'); }

    /**
     * 이 단계에서 보여 줄 활동으로 바꾼다(이미 그 활동이면 아무것도 안 한다).
     * @param {string} sec - 활동 섹션 id
     */
    function _setAct(sec) {
        if (!sec) return;
        var el = document.getElementById(sec);
        if (el && el.getBoundingClientRect().height > 1) return;   // 이미 이 활동이다
        var b = _actBtn(sec);
        if (b) b.click();
    }

    /**
     * 지금 보고 있는 활동의 지도를 얻는다.
     * @returns {Object|null} ol.Map
     * [연계] 활동마다 지도 핸들을 내놓는 이름이 다르다(life_safety.js 의 목록과 같다).
     */
    function _actMap() {
        var gets = [window.getFishingMap, window.getSwimmingMap, window.getScubaMap,
                    window.getMudflatMap, window.getSwellMap];
        for (var i = 0; i < gets.length; i++) {
            if (typeof gets[i] !== 'function') continue;
            var m;
            try { m = gets[i](); } catch (e) { continue; }
            // 화면에 실제로 붙어 있는 지도만 고른다(활동을 바꿔도 옛 지도가 남아 있다)
            if (m && m.getTargetElement && m.getTargetElement()
                && m.getTargetElement().getBoundingClientRect().height > 1) return m;
        }
        if (window._surfing && window._surfing.map) return window._surfing.map;
        return null;
    }

    /**
     * 지도 한가운데에서 가장 가까운 지점을 **대신 눌러** 상세 시트를 띄운다.
     *
     * 왜 이렇게 하나?
     *   활동마다 시트를 여는 함수가 안쪽에 숨어 있어 직접 부를 수 없다. 대신 지도에
     *   "눌렀다"는 신호(singleclick)를 보내면 앱이 평소처럼 시트를 연다(실측으로 확인).
     *
     * @param {boolean} on - 열지(true) 닫을지(false)
     */
    function _setLifeSheet(on) {
        var sheet = document.getElementById('fishing-bottomsheet');
        if (!on) {
            var x = document.getElementById('fishing-bs-close');
            if (sheet && sheet.classList.contains('active') && x) x.click();
            return;
        }
        if (sheet && sheet.classList.contains('active')) return;
        _when(function () { return !!_actMap(); }, function () {
            var m = _actMap();
            if (!m || typeof ol === 'undefined') return;
            var c = m.getView().getCenter();
            var best = null, bestD = Infinity;
            m.getLayers().forEach(function (l) {
                var src = l.getSource && l.getSource();
                if (!src || typeof src.getFeatures !== 'function') return;
                src.getFeatures().forEach(function (f) {
                    if (!f.get('placeName')) return;
                    var g = f.getGeometry();
                    if (!g || typeof g.getCoordinates !== 'function') return;
                    var p = g.getCoordinates();
                    var d = (p[0] - c[0]) * (p[0] - c[0]) + (p[1] - c[1]) * (p[1] - c[1]);
                    if (d < bestD) { bestD = d; best = f; }
                });
            });
            if (!best) return;
            var coord = best.getGeometry().getCoordinates();
            var pixel = m.getPixelFromCoordinate(coord);
            if (!pixel) return;
            m.dispatchEvent({ type: 'singleclick', pixel: pixel, coordinate: coord, map: m });
        });
    }

    /** 활동 화면 전체(구멍을 그 화면에 뚫을 때). @returns {Array|null} */
    function _actTarget(sec) {
        return function () {
            var el = document.getElementById(sec);
            return (el && el.getBoundingClientRect().height > 1) ? [el] : null;
        };
    }

    var STEPS_LIFE = [
        {
            title: '해양생활 — 오늘 하기 좋은가',
            body: '바다에서 하는 활동마다 "오늘 하기 좋은 정도"를 지점별로 색으로 보여줍니다. '
                + '오른쪽 세로줄에서 활동을 고릅니다.',
            target: function () {
                var r = document.getElementById('ls-rail');
                return r ? [r] : null;
            },
            act: 'fishing-section'
        },
        {
            title: '지도 종류 · 안 내',
            body: '왼쪽 위에서 지도 배경을 바꾸고, 「안 내」로 활동마다 지수를 어떻게 매기는지 '
                + '자세한 설명과 출처를 볼 수 있습니다.',
            target: function () {
                var e = document.getElementById('ls-topleft-controls');
                return (e && e.getBoundingClientRect().height > 1) ? [e] : null;
            },
            act: 'fishing-section'
        },
        {
            title: '색이 무슨 뜻인가',
            body: '지점 색은 그 활동을 하기에 좋은 정도입니다 — 파랑(매우좋음)에서 '
                + '빨강(매우나쁨)까지. 활동에 따라 기준이 다릅니다.',
            target: function () {
                var sec = document.getElementById('fishing-section');
                if (!sec) return null;
                var lg = sec.querySelector('[class*=legend]');
                return (lg && lg.getBoundingClientRect().height > 1) ? [lg] : null;
            },
            act: 'fishing-section'
        },
        {
            title: '지점을 누르면 — 자세히 보기',
            body: '지점을 누르면 그날의 지수와 근거가 되는 바다 상태가 열립니다. '
                + '날짜를 넘겨 가며 볼 수도 있습니다. 지금은 가까운 지점을 대신 눌렀습니다.',
            target: function () {
                var s = document.getElementById('fishing-bottomsheet');
                return (s && s.getBoundingClientRect().height > 1) ? [s] : null;
            },
            act: 'fishing-section', sheet: true
        },
        {
            title: '바다낚시',
            body: '갯바위와 선상 낚시를 지점마다 보여줍니다. '
                + '「바다낚시」를 한 번 더 누르면 갯바위 · 선상을 갈라 볼 수 있습니다.',
            target: _actTarget('fishing-section'),
            act: 'fishing-section'
        },
        {
            title: '서핑',
            body: '서핑하기 좋은 정도를 지점마다 보여줍니다.',
            target: _actTarget('surfing-section'),
            act: 'surfing-section'
        },
        {
            title: '해수욕',
            body: '해수욕하기 좋은 정도를 해수욕장마다 보여줍니다.',
            target: _actTarget('swimming-section'),
            act: 'swimming-section'
        },
        {
            title: '스킨스쿠버',
            body: '스킨스쿠버 하기 좋은 정도를 지점마다 보여줍니다.',
            target: _actTarget('scuba-section'),
            act: 'scuba-section'
        },
        {
            title: '갯벌체험',
            body: '갯벌체험 하기 좋은 정도를 갯벌마다 보여줍니다.',
            target: _actTarget('mudflat-section'),
            act: 'mudflat-section'
        },
        {
            title: '바다갈라짐',
            body: '이것만 지도가 아니라 표로 보여줍니다. 지역을 고르면 날짜마다 '
                + '바다가 갈라지는 시간과 체험지수가 나옵니다.',
            target: _actTarget('sea-parting-section'),
            act: 'sea-parting-section'
        },
        {
            title: '너울',
            body: '너울이 얼마나 위험한지를 관심 · 주의 · 경계 · 위험으로 나눠 보여줍니다. '
                + '갯바위나 방파제에 나갈 때 꼭 확인하세요.',
            target: _actTarget('swell-section'),
            act: 'swell-section'
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

        // 대체 그림 자리 — 가리킬 화면이 없는 단계에서만 쓴다(평소엔 숨김)
        var shot = document.createElement('div');
        shot.id = 'tutorial-shot';
        shot.style.cssText = 'position:absolute;display:none;border:1px solid ' + C_BORDER
            + ';border-radius:12px;overflow:hidden;background:#0b1020;';

        // 이미지는 가로를 상자에 꽉 맞추고(실제 폰에서 보는 크기와 거의 같아진다),
        //   세로로 밀어서 설명할 부분이 가운데 오게 한다. 상자 밖은 잘라 낸다.
        var shotImg = document.createElement('img');
        shotImg.id = 'tutorial-shot-img';
        shotImg.alt = '특보가 있을 때의 화면 예시';
        shotImg.style.cssText = 'position:absolute;left:0;display:block;width:100%;height:auto;';

        // 그림 안에서 지금 설명하는 부분을 두르는 테두리(구멍과 같은 깜빡임)
        var shotBox = document.createElement('div');
        shotBox.id = 'tutorial-shot-box';
        shotBox.style.cssText = 'position:absolute;display:none;border:2px solid ' + C_ACCENT
            + ';border-radius:6px;box-shadow:0 0 0 9999px rgba(6,11,24,0.55);'
            + 'animation:tutorialRingBlink 1.3s ease-in-out infinite;pointer-events:none;';

        // [딱지는 그림 밖에] 그림 위에 얹으면 하필 설명 중인 값(유의파고 등)을 가린다.
        //   화면 오른쪽 위, "튜토리얼 시험 모드" 와 같은 줄에 둔다(실측으로 확인 2026-09-23).
        var shotTag = document.createElement('div');
        shotTag.id = 'tutorial-shot-tag';
        shotTag.textContent = '예시 화면입니다';
        shotTag.style.cssText = 'position:absolute;display:none;right:12px;'
            + 'top:calc(10px + env(safe-area-inset-top,0px));'
            + 'padding:5px 12px;border-radius:20px;background:rgba(250,204,21,0.95);color:#1a1f2e;'
            + 'font-size:0.72rem;font-weight:800;letter-spacing:0.3px;white-space:nowrap;'
            + 'box-shadow:0 4px 14px rgba(0,0,0,0.45);';

        shot.appendChild(shotImg);
        shot.appendChild(shotBox);

        // 시험 모드 표시 — 정식 공개 때 지운다
        var flag = document.createElement('div');
        flag.id = 'tutorial-test-flag';
        flag.textContent = '튜토리얼 시험 모드';
        flag.style.cssText = 'position:absolute;left:12px;padding:4px 10px;'
            + 'top:calc(10px + env(safe-area-inset-top,0px));'
            + 'border-radius:20px;background:rgba(68,138,255,0.18);border:1px solid ' + C_ACCENT
            + ';color:' + C_ACCENT + ';font-size:0.66rem;font-weight:700;letter-spacing:0.5px;'
            // 구멍보다 위에 둔다 — 지도 화면에서는 구멍이 화면 전체라, 그냥 두면
            //   딱지가 구멍에 덮여 흐릿하게 보였다(실측으로 확인).
            + 'z-index:2;';

        // 설명 카드
        var card = document.createElement('div');
        card.id = 'tutorial-card';
        // [버튼은 늘 보이게] 카드를 세로 flex 로 두고 글 부분만 스크롤시킨다.
        //   구멍이 커서 카드가 눌려도 [종료]/[이전]/[다음] 이 잘려 나가면 안 된다.
        card.style.cssText = 'position:absolute;box-sizing:border-box;background:' + C_CARD
            + ';border:1px solid ' + C_BORDER + ';border-radius:14px;padding:16px 16px 12px;'
            + 'box-shadow:0 18px 50px rgba(0,0,0,0.5);overflow:hidden;'
            + 'display:flex;flex-direction:column;';

        var textWrap = document.createElement('div');
        textWrap.style.cssText = 'flex:1 1 auto;overflow:auto;min-height:0;';

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

        textWrap.appendChild(badge);
        textWrap.appendChild(title);
        textWrap.appendChild(body);
        card.appendChild(textWrap);

        // 버튼 한 줄: [종료] ......... [이전] [다음]
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:14px;flex:0 0 auto;';

        var quitBtn = _mkBtn('튜토리얼 종료하기', 'quit');
        quitBtn.addEventListener('click', _close);

        var spacer = document.createElement('div');
        spacer.style.cssText = 'flex:1;';

        var prevBtn = _mkBtn('이전', 'prev');
        prevBtn.id = 'tutorial-prev-btn';
        prevBtn.addEventListener('click', function () {
            var to = _nextIdx(_stepIdx, -1);
            if (to !== -1) _go(to, -1);
        });

        var nextBtn = _mkBtn('다음', 'next');
        nextBtn.id = 'tutorial-next-btn';
        nextBtn.addEventListener('click', function () {
            var to = _nextIdx(_stepIdx, 1);
            if (to === -1) { _close(); return; }
            _go(to, 1);
        });

        row.appendChild(quitBtn);
        row.appendChild(spacer);
        row.appendChild(prevBtn);
        row.appendChild(nextBtn);
        card.appendChild(row);

        root.appendChild(hole);
        root.appendChild(shot);
        root.appendChild(shotTag);
        root.appendChild(flag);
        root.appendChild(card);

        _hole = hole;
        _shot = shot;
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
    function _paint(doFit) {
        if (!_root) return;
        var step = _steps[_stepIdx];
        // 해구 기상전망 창은 이 단계에서만 화면에 맞춰 줄인다(그래야 구멍도 줄어든 창을 감싼다)
        var _d = step.drill;
        _fitZoneModal(!!step.fitZoneModal
            || (_d && _d.indexOf(':') > 0 ? _d.split(':')[1] : _d) === 'zonegrid');
        // 단계를 새로 그릴 때만 화면 밖으로 넘쳤는지 보고 맞춘다. 더 일찍 맞추면 그 뒤에
        //   내용이 더 펼쳐져(부이 관측값 등) 다시 어긋나고, 반대로 **매번** 맞추면
        //   사람이 화면을 움직일 때마다 되돌려 버린다(실측 2026-09-23).
        if (doFit) _fitIntoView(_targets(step));
        var u = _unionRect(_targets(step));
        var vw = window.innerWidth;
        var vh = window.innerHeight;

        // [아래 한계] 예전에는 하단 메인탭 바를 가리지 않게 그 위에서 멈췄는데, 그만큼
        //   설명 카드가 위로 올라와 팝업(기상예보표·윈디) 아래쪽을 가렸다(사용자 지적
        //   2026-09-23). 튜토리얼 중에는 어차피 화면을 못 누르므로 탭 바를 덮어도 된다.
        //   다만 휴대폰의 상태표시줄·제스처 바가 차지하는 만큼은 비워 둔다.
        var topLimit    = EDGE + _insets.top;
        var bottomLimit = vh - EDGE - _insets.bottom;

        var cardW = Math.min(CARD_MAX, vw - EDGE * 2);
        _card.style.width = cardW + 'px';
        _card.style.left = Math.round((vw - cardW) / 2) + 'px';

        if (step.image) {
            // [대체 그림 단계] 화면에 가리킬 것이 없다. 화면 전체를 어둡게 하고,
            //   설명 카드를 아래에 둔 뒤 남은 위쪽 공간에 그림을 채운다.
            _hole.style.display = 'none';
            _root.style.background = C_DIM;
            var img = _root.querySelector('#tutorial-shot-img');
            if (img.getAttribute('src') !== step.image) img.setAttribute('src', step.image);

            _card.style.maxHeight = Math.round(vh * 0.42) + 'px';
            var cardH = _card.offsetHeight;
            _card.style.top = Math.round(bottomLimit - cardH) + 'px';

            var shotTop = topLimit + 26;                   // 위쪽 "시험 모드" 딱지를 피한다
            var shotH = (bottomLimit - cardH - GAP) - shotTop;
            _shot.style.display = shotH > 120 ? 'block' : 'none';
            _root.querySelector('#tutorial-shot-tag').style.display = _shot.style.display;
            _shot.style.left = Math.round((vw - cardW) / 2) + 'px';
            _shot.style.width = cardW + 'px';
            _shot.style.top = shotTop + 'px';
            _shot.style.height = Math.round(shotH) + 'px';

            // [세로 이동] 그림을 가로에 맞추면 세로로는 상자보다 길다. 설명할 부분이
            //   상자 가운데 오도록 밀어 준다. 부분이 없으면 맨 위부터 보여준다.
            var natW = img.naturalWidth || 720;
            var natH = img.naturalHeight || 1470;
            var drawH = cardW * (natH / natW);             // 가로를 맞췄을 때의 세로 길이
            var r = step.imageRect;
            var panY = 0;
            if (r) panY = (r.y + r.h / 2) * drawH - shotH / 2;
            panY = Math.max(0, Math.min(panY, Math.max(0, drawH - shotH)));
            img.style.top = Math.round(-panY) + 'px';

            var box = _root.querySelector('#tutorial-shot-box');
            if (r) {
                box.style.display = 'block';
                box.style.left   = Math.round(r.x * cardW) + 'px';
                box.style.width  = Math.round(r.w * cardW) + 'px';
                box.style.top    = Math.round(r.y * drawH - panY) + 'px';
                box.style.height = Math.round(r.h * drawH) + 'px';
            } else {
                box.style.display = 'none';
            }
            return;
        }
        _shot.style.display = 'none';
        _root.querySelector('#tutorial-shot-tag').style.display = 'none';

        if (!u) {
            // 가리킬 것이 없는 단계 — 화면 전체를 어둡게 하고 카드는 아래쪽에 둔다
            _hole.style.display = 'none';
            _root.style.background = C_DIM;
            _card.style.maxHeight = Math.round(vh * 0.6) + 'px';
            _card.style.top = Math.round(bottomLimit - _card.offsetHeight) + 'px';
            return;
        }

        _root.style.background = 'transparent';
        _hole.style.display = 'block';
        var pad = 6;   // 대상보다 살짝 넉넉하게 뚫어 준다
        var hx = Math.max(0, u.left - pad);
        var hy = Math.max(0, u.top - pad);
        var hw = Math.min(vw - hx, (u.right - u.left) + pad * 2);
        var hh = Math.min(vh - hy, (u.bottom - u.top) + pad * 2);

        // [설명 카드 자리 확보] 머리줄 + 펼쳐진 내용을 함께 비추면 덩어리가 길어져
        //   카드가 들어갈 자리가 없어질 수 있다. 위아래 어느 쪽에도 CARD_MIN 만큼
        //   남지 않으면, 구멍의 아래쪽을 그만큼 잘라 카드 자리를 만든다
        //   (내용의 윗부분은 그대로 밝게 보이므로 "무엇이 열렸는지"는 전달된다).
        // [딱지 줄을 비운다] 카드가 화면 위쪽에 붙을 때는 「시험 모드」 딱지와 단계 번호가
        //   있는 줄 아래에서 시작해야 한다. 그러지 않으면 카드가 그 둘을 덮는다
        //   (실측 2026-09-25 — 바텀시트 단계에서 드러났다).
        var topCard = topLimit + TAG_H;
        var above = (hy - GAP) - topCard;
        if (bottomLimit - (hy + hh + GAP) < CARD_MIN && above < CARD_MIN) {
            hh = Math.max(40, bottomLimit - CARD_MIN - GAP - hy);
        }

        _hole.style.left   = Math.round(hx) + 'px';
        _hole.style.top    = Math.round(hy) + 'px';
        _hole.style.width  = Math.round(hw) + 'px';
        _hole.style.height = Math.round(hh) + 'px';

        // 카드 자리: 아래쪽 공간과 위쪽 공간을 재어 넓은 쪽에 붙인다.
        //   다만 태풍 단계처럼 **화면 아래에 조작줄이 있는 단계**는 위쪽으로 못박는다 —
        //   그러지 않으면 카드가 그 줄을 덮어 고를 수가 없다(사용자 지적 2026-09-25).
        var below = bottomLimit - (hy + hh + GAP);
        var useBelow = step.cardTop ? false : (below >= above);
        // 위쪽에 붙일 때, 구멍이 화면을 거의 다 차지하면(지도 단계) 위 공간이 0 이라
        //   카드가 납작해진다. 그럴 때는 화면 위쪽 절반까지 쓰게 한다.
        // 위에 못박는 단계는 「시험 모드」 딱지 줄 아래에서 시작하고(그러지 않으면 딱지와
        //   단계 번호를 덮는다), 화면의 절반 남짓만 쓴다 — 나머지로 지도를 봐야 한다.
        var space = useBelow ? below
                             : (step.cardTop ? Math.max(above, (bottomLimit - topCard) * 0.45) : above);
        _card.style.maxHeight = Math.max(CARD_MIN, Math.round(space)) + 'px';
        var ch = _card.offsetHeight;
        _card.style.top = Math.round(useBelow ? (hy + hh + GAP)
                                   : (step.cardTop ? topCard
                                                   : Math.max(topCard, hy - GAP - ch))) + 'px';
    }

    /**
     * 스크롤·화면 크기 변경 때 자리를 다시 잡는다(화면 갱신 한 번에 한 번만).
     * [연계] _open() 에서 window 에 붙이고 _close() 에서 뗀다.
     */
    /**
     * 밝게 비출 대상이 **움직였는지** 매 프레임 지켜보다가, 움직였으면 다시 그린다.
     *
     * 왜 필요한가?
     *   구멍을 그린 뒤에도 화면이 움직이는 일이 있다 — 값이 늦게 도착해 칸이 커지거나,
     *   사람이 화면을 밀거나, 앱이 스스로 스크롤을 되돌리는 경우다. 그러면 밝은 자리가
     *   엉뚱한 곳에 남는다(사용자 지적 2026-09-23: 부이 관측값이 밝은 자리 밖으로 밀려남).
     *   scroll 이벤트만으로는 놓치는 경우가 있어, 자리 자체를 지켜본다.
     *
     * [연계] _open 에서 시작하고 _close 에서 멈춘다.
     */
    function _track() {
        if (!_root) { _trackId = 0; return; }
        var step = _steps[_stepIdx];
        var u = _unionRect(_targets(step));
        var key = u ? [Math.round(u.top), Math.round(u.left),
                       Math.round(u.right), Math.round(u.bottom)].join(',') : 'none';
        if (key !== _trackKey) { _trackKey = key; _paint(false); }
        _trackId = requestAnimationFrame(_track);
    }

    function _onResize() {
        // 화면을 돌리면 상태표시줄 쪽 여백이 달라진다
        _insets = _measureInsets();
        _queuePaint();
    }

    function _queuePaint() {
        if (_repaintQueued || !_root) return;
        _repaintQueued = true;
        requestAnimationFrame(function () { _repaintQueued = false; _paint(false); });
    }

    // ========================================================================
    // [단계 이동]
    // ========================================================================

    /**
     * 지금 단계에서 그 방향으로 **실제로 갈 수 있는** 다음 단계 번호를 구한다.
     *
     * 무엇을 하나?
     *   건너뛸 단계(오늘 화면에 없는 것)를 지나쳐 가장 가까운 단계를 찾는다.
     *   그 방향에 아무것도 없으면 -1 을 준다.
     *
     * 왜 필요한가?
     *   특보가 하나도 없는 날에는 파고드는 단계가 전부 건너뛰기 대상이라, 마지막 단계가
     *   어디인지 미리 알아야 [다음] 을 '완료' 로 바꿀 수 있다. 이걸 안 하면 [다음] 을
     *   눌러도 아무 일이 없어 **사용자가 갇힌다**(실측으로 확인 — 4단계에서 멈췄다).
     *
     * @param {number} from - 기준 단계 번호
     * @param {number} dir  - 1(다음) 또는 -1(이전)
     * @returns {number} 갈 수 있는 단계 번호, 없으면 -1
     * [연계] _go() 와 [이전]/[다음] 버튼이 쓴다.
     */
    function _nextIdx(from, dir) {
        for (var i = from + dir; i >= 0 && i < _steps.length; i += dir) {
            var st = _steps[i];
            if (typeof st.skip !== 'function' || !st.skip()) return i;
        }
        return -1;
    }

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
    function _go(idx, dir) {
        if (!_root) return;
        if (idx < 0 || idx >= _steps.length) return;

        // [건너뛰기] 오늘 화면에 없는 단계(특보가 없거나 소분류가 없는 바다)는 지나간다.
        var step = _steps[idx];
        if (typeof step.skip === 'function' && step.skip()) {
            var d = dir || (idx > _stepIdx ? 1 : -1);
            var to = _nextIdx(idx - d, d);   // idx 부터 그 방향으로 갈 수 있는 곳
            if (to === -1) { if (d > 0) _close(); return; }   // 앞쪽에 아무것도 없으면 마친다
            return _go(to, d);
        }

        _stepIdx = idx;

        // 글자 먼저 채운다(카드 높이를 재려면 내용이 들어 있어야 한다)
        _root.querySelector('#tutorial-step-badge').textContent = (idx + 1) + ' / ' + _steps.length;
        _root.querySelector('#tutorial-step-title').textContent = step.title;
        var bodyEl = _root.querySelector('#tutorial-step-body');
        // 지도 단계의 글은 「안 내」 팝업 원문을 그대로 쓰는데, 그 글에 굵게·목록 서식이
        //   들어 있다. 우리 앱이 직접 갖고 있는 글이라 그대로 넣어도 안전하다.
        if (step.bodyHtml) bodyEl.innerHTML = step.bodyHtml;
        else bodyEl.textContent = step.body;

        var prev = _root.querySelector('#tutorial-prev-btn');
        var next = _root.querySelector('#tutorial-next-btn');
        // 갈 수 있는 곳이 없으면 [이전] 을 끄고, [다음] 을 '완료' 로 바꾼다.
        //   단순히 번호가 처음/끝인지로 판단하면, 건너뛰는 단계가 있는 날 갇힌다.
        prev.disabled = (_nextIdx(idx, -1) === -1);
        prev.style.opacity = prev.disabled ? '0.35' : '1';
        prev.style.cursor  = prev.disabled ? 'default' : 'pointer';
        next.textContent = (_nextIdx(idx, 1) === -1) ? '완료' : '다음';

        // 이 단계가 필요로 하는 화면 상태를 통째로 맞춘다(앞/뒤 어느 쪽에서 와도 같은 결과)
        if (_mode === 'life') {
            // 해양생활 — 이 단계에서 보여 줄 활동으로 바꾸고, 지점 상세를 열지 말지 맞춘다
            _setAct(step.act);
            _setLifeSheet(!!step.sheet);
        } else if (_mode === 'ocean' || _mode === 'safety') {
            // 지도 튜토리얼 — 아코디언이 아니라 지도 버튼을 이 단계 모습으로 맞춘다
            _setOceanBtns(step.btns);
            _setOceanPop(step.pop);
            _setOceanOpen(step.open);
        } else {
            _setAccordion(ACC_FORECAST, step.want.forecast);
            _setAccordion(ACC_ALERT, step.want.alert);
            _setAccordion(ACC_STATUS, step.want.status);
            _drill(step.drill);
        }

        var ready = function () {
            // 해구기상 단계는 화면이 해양종합정보 탭에 가 있어 특보정보 쪽 아코디언 높이가
            //   0 이다. 그것까지 확인하면 영영 준비되지 않는다(실측: [이전] 로 돌아올 때
            //   구멍이 10초 넘게 앞 단계 자리에 머물렀다). 그 단계는 _drillSettled 만 본다.
            //
            // [대체 그림 단계도 같다] 그 단계는 화면에서 아무것도 가리키지 않고 그림만
            //   띄운다. 그런데 특보가 하나도 없으면 특보현황 본문이 **비어서 높이가 0** 이
            //   되고, 그것을 "아직 안 펼쳐졌다" 로 읽어 준비가 영영 안 됐다. 그래서 그림이
            //   끝내 안 나왔다(배포본에서 실측 — src 가 빈 채로 남아 있었다).
            //   그림 단계는 아코디언 상태를 볼 필요가 없으므로 그 확인을 건너뛴다.
            // 지도 단계는 아코디언과 무관하다 — 비출 것이 화면에 잡히면 준비된 것이다
            //   (눌러서 여는 창이 있는 단계는 그 창이 떠야 잡힌다)
            if (_mode !== 'alert') return (!step.target || !!_unionRect(_targets(step)));
            return (step.image || _isMapStep(step.drill) || _settled(step.want))
                && _drillSettled(step.drill)
                && (!step.target || !!_unionRect(_targets(step)));
        };
        _when(ready, function () {
            _scrollIntoView(_targets(step));
            // 아코디언 여닫는 애니메이션(0.4초)과 스크롤이 멈춘 뒤에 자리를 잡는다.
            //   멎은 뒤 한 번 더 "화면 밖으로 넘쳤는지"를 보고 맞춘다 — 그 전에 맞추면
            //   아직 펼쳐지는 중이라 계산이 어긋난다(실측).
            _whenStable(function () { return _targets(step); }, function () {
                _paint(true);
                // 태풍 단계는 카드 자리가 정해진 **뒤에** 지도를 맞춰야 한다 —
                //   카드와 아래 조작줄 사이 한가운데에 태풍을 놓기 때문이다.
                //   앱이 켜면서 하는 이동(0.6초)이 끝난 뒤라야 덮어쓰지 않는다.
                if (step.focusTyphoon) setTimeout(function () {
                    if (_root && _steps[_stepIdx] === step) { _focusTyphoon(); _paint(false); }
                }, 800);
                // 바텀시트 단계 — 그 지점으로 지도를 옮기고, 시트를 천천히 끝까지 내려 준다.
                //   시트가 다 찬 뒤라야 끝이 어디인지 알 수 있어 잠시 기다린다.
                if (step.focusSheet) setTimeout(function () {
                    if (_root && _steps[_stepIdx] === step) { _focusSheetPoint(); _paint(false); }
                }, 800);
                if (step.autoScroll) setTimeout(function () {
                    if (_root && _steps[_stepIdx] === step) _autoScrollSheet();
                }, 1600);
            });
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
        var gridBtn = document.getElementById('ocean-marine-zone-toggle-btn');
        var warnBtn = document.getElementById('ocean-warn-zone-toggle-btn');
        return {
            tab: activeTab ? activeTab.dataset.target : null,
            forecast: _isOpen(ACC_FORECAST),
            alert: _isOpen(ACC_ALERT),
            status: _isOpen(ACC_STATUS),
            // 해구기상 단계가 해양종합정보 지도의 해구도·특보구역을 켠다 → 원래대로 되돌린다
            grid: !!gridBtn && gridBtn.classList.contains('active'),
            warn: !!warnBtn && warnBtn.classList.contains('active'),
            // 지도 튜토리얼이 켜고 끄는 버튼들 — 닫을 때 하나씩 원래대로 돌린다
            ocean: (_mode === 'life' ? [] : _btnList()).map(function (sel) {
                var b = _ob(sel);
                return { sel: sel, on: !!b && b.classList.contains('active') };
            })
        };
    }

    /**
     * 튜토리얼이 건드린 것을 열기 전 상태로 되돌린다.
     * [연계] _close() 에서 호출.
     */
    function _restore() {
        if (!_snapshot) return;
        // 튜토리얼이 띄운 팝업·펼친 카드·누른 부이부터 되돌린다
        _setForecast(false);
        _setWindy(false);
        _fitZoneModal(false);
        _setZoneGrid(false);
        _setBuoy(false, 'alert');
        _setBuoy(false, 'status');
        _setCardOpen(false);
        _closeSubs('alert');
        _closeSeas('alert');
        _closeSubs('status');
        _closeSeas('status');
        // 지도 튜토리얼이 켠 버튼·펼친 팝아웃·열어 준 창도 원래대로
        _setOceanOpen(null);
        _setOceanPop(null);
        _setLifeSheet(false);   // 해양생활이 대신 눌러 띄운 지점 상세도 닫는다
        if (_snapshot.ocean) {
            _snapshot.ocean.forEach(function (o) { _obSet(o.sel, o.on); });
        }
        // 해구기상 단계가 켠 지도 레이어도 원래대로
        if (typeof window.setMarineZoneGridVisible === 'function') {
            window.setMarineZoneGridVisible(_snapshot.grid);
        }
        if (typeof window.setWarnZoneVisible === 'function') {
            window.setWarnZoneVisible(_snapshot.warn);
        }
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
    function _open(mode) {
        if (_root) return;
        _mode  = (mode === 'ocean' || mode === 'safety' || mode === 'life') ? mode : 'alert';
        _steps = (_mode === 'ocean') ? STEPS_OCEAN
               : (_mode === 'safety') ? STEPS_SAFETY
               : (_mode === 'life') ? STEPS_LIFE : STEPS;
        _snapshot = _snap();

        // 특보정보 튜토리얼은 특보정보 탭에서 시작한다(연타는 공지사항 탭에서 일어난다).
        //   지도 튜토리얼은 이미 해양종합정보 탭에 들어와 있으므로 탭을 옮기지 않는다.
        var startSec = (_mode === 'ocean') ? 'ocean-map-section'
                     : (_mode === 'safety') ? 'ocean-map-section'   // 해양안전도 같은 지도를 빌려 쓴다
                     : (_mode === 'life') ? 'fishing-section'       // 해양생활은 활동 화면에서 시작
                     : 'weather-alert-section';
        if (_mode === 'alert' && typeof window.switchMainTab === 'function') {
            window.switchMainTab(startSec);
        }

        _insets = _measureInsets();
        _root = _build();
        document.body.appendChild(_root);
        window.addEventListener('resize', _onResize);
        window.addEventListener('scroll', _queuePaint, true);
        _trackKey = '';
        _trackId = requestAnimationFrame(_track);

        // 특보정보 화면이 실제로 보이게 된 뒤에 1단계를 그린다(시간으로 기다리지 않는다)
        _when(function () {
            var sec = document.getElementById(startSec);
            return !!sec && sec.getBoundingClientRect().height > 0;
        }, function () { _go(0, 1); });
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
        window.removeEventListener('resize', _onResize);
        window.removeEventListener('scroll', _queuePaint, true);
        if (_trackId) { cancelAnimationFrame(_trackId); _trackId = 0; }
        _root.remove();
        _root = null;
        _hole = null;
        _shot = null;
        _card = null;
        _stepIdx = 0;
        if (_sheetScrollId) { cancelAnimationFrame(_sheetScrollId); _sheetScrollId = 0; }
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
            if (document.getElementById('zone-setup-overlay')) return;   // 관심해역 설정 중

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
                setTimeout(_startFlow, 0);
            }
        });
    }

    /**
     * 숨은 진입로로 들어왔을 때 실제로 보여 줄 순서를 정한다.
     *
     * 무엇을 하나?
     *   먼저 **관심해역 설정**(js/onboarding/zone_setup.js)을 열고, 다 고르거나
     *   [건너뛰기]를 누르면 이어서 튜토리얼을 연다. 설계 시안이 「관심해역 설정 → 튜토리얼」
     *   한 줄기였기 때문이다. 관심해역 설정 파일이 없으면 지금처럼 튜토리얼만 연다.
     *
     * [연계] zone_setup.js 의 window.openZoneSetup(끝났을때호출할함수)
     */
    function _startFlow() {
        // 여기서부터 **해양종합정보 탭 튜토리얼도 켜 둔다** — 이 흐름이 끝난 뒤
        //   사용자가 해양종합정보 탭에 들어가면 지도 튜토리얼이 이어서 시작한다
        //   (시험 단계 진입 규칙, 사용자 확정 2026-09-24).
        _oceanArmed = true;
        _safetyArmed = true;
        _lifeArmed = true;
        _alertArmed = false;   // 특보는 지금 바로 여니 탭 진입으로 또 열 필요가 없다
        try { localStorage.setItem(ARMED_KEY, '1'); } catch (e) { /* 저장 실패해도 이번 실행에는 쓴다 */ }
        if (typeof window.openZoneSetup === 'function') window.openZoneSetup(function () { _open(); });
        else _open();
    }

    /**
     * 해양종합정보 탭에 들어갈 때 지도 튜토리얼을 시작하도록 걸어 둔다.
     *
     * 무엇을 하나?
     *   공지사항 5연타로 켜 둔 표시(_oceanArmed)가 있을 때만, 그 탭을 누르는 순간
     *   지도 튜토리얼을 연다. 한 번 열리면 표시를 끄므로 그 뒤에는 다시 안 열린다.
     *   탭 전환 자체는 막지 않는다 — 평소처럼 지도가 열리고 그 위에 튜토리얼이 뜬다.
     *
     * 왜 탭을 누를 때인가?
     *   지도 화면을 설명하는 튜토리얼이라 그 화면에 실제로 들어와 있어야 가리킬 것이 있다.
     *
     * [연계] index2.html 하단 메인탭 `.tab-btn[data-target="ocean-map-section"]`
     */
    function _bindOceanTrigger() {
        var btn = document.querySelector('.tab-btn[data-target="ocean-map-section"]');
        if (!btn) return;
        btn.addEventListener('click', function (e) {
            if (!(e.detail > 0 || e.isTrusted)) return;   // 사용자 클릭만
            if (!_oceanArmed || _root) return;
            if (document.getElementById('zone-setup-overlay')) return;   // 관심해역 설정 중
            _oceanArmed = false;
            // 앱의 원래 탭 전환 처리가 끝난 뒤에 연다(특보탭 트리거와 같은 이유)
            setTimeout(function () { _open('ocean'); }, 0);
        });
    }

    /**
     * 해양안전생활 탭의 「해양안전」 화면에 들어갈 때 그 튜토리얼을 시작하도록 걸어 둔다.
     *
     * 무엇을 하나?
     *   ① 하단 「해양안전생활」 탭을 눌렀을 때(그 탭은 해양안전 화면으로 열린다)
     *   ② 그 안의 「해양안전」 하위 탭을 눌렀을 때
     *   둘 다에서, 공지사항 5연타로 켜 둔 표시가 있으면 연다. 한 번 열리면 표시를 끈다.
     *
     * [연계] index2.html 하단 `.tab-btn[data-target="ocean-life-group"]` 와
     *        `#ocean-safety-sub-tabs .sub-tab-btn[data-target="ocean-safety-section"]`
     */
    function _bindSafetyTrigger() {
        var open = function () {
            if (!_safetyArmed || _root) return;
            if (document.getElementById('zone-setup-overlay')) return;
            // 해양안전 화면일 때만 연다(해양생활 쪽은 아직 따로 만들지 않았다)
            var sec = document.getElementById('ocean-safety-section');
            var on = document.querySelector('#ocean-safety-sub-tabs .sub-tab-btn.active');
            if (!on || on.dataset.target !== 'ocean-safety-section') return;
            _safetyArmed = false;
            _open('safety');
        };
        var main = document.querySelector('.tab-btn[data-target="ocean-life-group"]');
        if (main) main.addEventListener('click', function (e) {
            if (!(e.detail > 0 || e.isTrusted)) return;
            // 탭 전환과 화면 그리기가 끝난 뒤에 연다(다른 트리거와 같은 이유)
            setTimeout(open, 600);
        });
        var sub = document.querySelector('#ocean-safety-sub-tabs .sub-tab-btn[data-target="ocean-safety-section"]');
        if (sub) sub.addEventListener('click', function (e) {
            if (!(e.detail > 0 || e.isTrusted)) return;
            setTimeout(open, 600);
        });
    }

    /**
     * 해양안전생활 탭의 「해양생활」 화면에 들어갈 때 그 튜토리얼을 시작하도록 걸어 둔다.
     *
     * [연계] index2.html 의 `#ls-life-sub-btn`(해양생활 하위 탭 버튼)
     */
    function _bindLifeTrigger() {
        var btn = document.getElementById('ls-life-sub-btn');
        if (!btn) return;
        btn.addEventListener('click', function (e) {
            if (!(e.detail > 0 || e.isTrusted)) return;
            if (!_lifeArmed || _root) return;
            if (document.getElementById('zone-setup-overlay')) return;
            _lifeArmed = false;
            // 활동 화면이 그려진 뒤에 연다(지도가 올라오는 데 시간이 걸린다)
            setTimeout(function () { _open('life'); }, 900);
        });
    }

    /**
     * 특보정보 탭을 누를 때 그 튜토리얼을 시작하도록 걸어 둔다.
     *
     * 왜 필요한가?
     *   연타 표시를 기억하게 되면서, 앱을 다시 켠 뒤에도 각 탭에 들어가면 그 화면의
     *   튜토리얼이 뜨게 됐다. 특보정보만 그 길이 없으면 5연타를 또 해야 한다.
     *   **탭을 누를 때만** 열고 앱을 켜자마자 열지는 않는다(특보정보가 첫 화면이라
     *   앱을 켤 때마다 튜토리얼이 뜨면 성가시다).
     *
     * [연계] index2.html 하단 `.tab-btn[data-target="weather-group"]`
     */
    function _bindAlertTrigger() {
        var btn = document.querySelector('.tab-btn[data-target="weather-group"]');
        if (!btn) return;
        btn.addEventListener('click', function (e) {
            if (!(e.detail > 0 || e.isTrusted)) return;
            if (!_alertArmed || _root) return;
            if (document.getElementById('zone-setup-overlay')) return;
            _alertArmed = false;
            setTimeout(function () { _open(); }, 600);
        });
    }

    function _bindAll() {
        _restoreArmed();
        _bindTrigger(); _bindAlertTrigger(); _bindOceanTrigger();
        _bindSafetyTrigger(); _bindLifeTrigger();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _bindAll);
    } else {
        _bindAll();
    }

    // 시험·디버그용: 콘솔에서 바로 열어 볼 수 있게 열기 함수만 노출한다.
    window.openTutorial = _open;
    // 시험·디버그용: 지도 튜토리얼만 바로 열어 본다
    window.openOceanTutorial = function () { _open('ocean'); };
    // 시험·디버그용: 해양안전 튜토리얼만 바로 열어 본다
    window.openSafetyTutorial = function () { _open('safety'); };
    // 시험·디버그용: 해양생활 튜토리얼만 바로 열어 본다
    window.openLifeTutorial = function () { _open('life'); };
})();
