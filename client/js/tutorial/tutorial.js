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
    function _setBuoy(on) {
        var card = _firstCard();
        var btn = card && card.querySelector('.buoy-btn');
        if (!btn) return;
        if (btn.classList.contains('active') !== on) btn.click();
    }

    /**
     * 구역 카드 아래쪽 버튼(기상예보·해구기상·윈디·종합정보) 하나를 찾는다.
     * @param {string} label - 버튼에 쓰인 글자 (예: '기상예보')
     * @returns {HTMLElement|null}
     */
    function _cardBtn(label) {
        var card = _firstCard();
        if (!card) return null;
        var btns = card.querySelectorAll('.card-action-btns button');
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
    function _setForecast(on) {
        var modal = document.getElementById('sea-forecast-modal');
        if (on && !modal) {
            var btn = _cardBtn('기상예보');
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
    function _setWindy(on) {
        var modal = document.getElementById('windy-modal');
        if (on && !modal) {
            var btn = _cardBtn('윈디');
            if (btn) btn.click();
        } else if (!on && modal) {
            if (typeof window.closeWindyPopup === 'function') window.closeWindyPopup();
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
        if (depth !== 'zonemap') {
            var mapSec = document.getElementById('ocean-map-section');
            if (mapSec && mapSec.classList.contains('active')
                && typeof window.switchMainTab === 'function') {
                window.switchMainTab('weather-alert-section');
            }
        }
        var list = _firstSeaWithAlerts(kind);
        var deep = (depth === 'sub' || depth === 'open' || depth === 'buoy'
                    || depth === 'forecast' || depth === 'windy' || depth === 'zonemap');
        if (deep) {
            _openSea(list);
            _openSub(_firstSub(list));   // 소분류가 없으면(제주) 아무 일도 안 한다
        } else {
            _setForecast(false);         // 떠 있는 팝업부터 닫고
            _setWindy(false);
            _setCardOpen(false);         // 카드를 접고
            _closeSubs(kind);            // 소분류를 접고(보이는 동안 접어야 한다)
            if (depth === 'sea') { _openSea(list); }
            else { _closeSeas(kind); }
            return;
        }
        // 기상현황 카드는 처음부터 펼쳐져 있어 접었다 펴는 동작이 없다(실측 확인).
        if (kind !== 'alert') return;
        // [주의] 'sub' 단계는 카드가 **접혀 있는** 모습을 보여주는 단계다(다음 단계에서
        //   눌러 펼친다). 여기서 무조건 펼치면, 접혀 있기를 기다리는 _drillSettled('sub')
        //   와 서로 어긋나 준비가 영영 안 되고 구멍이 앞 단계 자리에 그대로 남는다
        //   (배포본에서 6·7단계가 실제로 그랬다 — 2026-09-22 실측).
        _setCardOpen(depth !== 'sub');
        _setBuoy(depth === 'buoy');      // 카드를 펼친 뒤에 눌러야 한다
        _setForecast(depth === 'forecast');
        _setWindy(depth === 'windy');
        if (depth === 'zonemap') {
            // 해구기상 버튼은 그 자체가 해양종합정보 탭으로 넘어가면서 해구도를 켠다.
            //   이미 그 탭에 가 있으면 다시 누르지 않는다(누르면 토글이 뒤집힌다).
            var sec = document.getElementById('ocean-map-section');
            var onMap = sec && sec.classList.contains('active');
            if (!onMap) { var zb = _cardBtn('해구기상'); if (zb) zb.click(); }
        }
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
        if (depth === 'zonemap') {
            if (document.getElementById('sea-forecast-modal')
                || document.getElementById('windy-modal')) return false;
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

        if (kind !== 'alert') return true;   // 기상현황은 카드가 늘 펼쳐져 있다

        // 카드·부이까지 요구하는 단계는 그것들이 실제로 보이는지도 확인한다
        var card = _firstCard();
        var det = card && card.querySelector('.alert-details');
        var cardOpen = !!det && !det.classList.contains('hidden') && det.offsetHeight > 0;
        if (depth === 'sub') return !det || !cardOpen;   // 아직 접혀 있어야 한다
        if (!cardOpen) return false;
        var fm = document.getElementById('sea-forecast-modal');
        var wm = document.getElementById('windy-modal');
        if (depth === 'forecast') return !!fm && fm.offsetHeight > 0;
        if (depth === 'windy')    return !!wm && wm.offsetHeight > 0;
        if (fm || wm) return false;      // 다른 단계에서는 팝업이 닫혀 있어야 한다

        if (depth === 'open') return true;

        var info = card.querySelector('.buoy-info-area');
        return !!info && info.style.display !== 'none' && info.offsetHeight > 0;
    }

    // ========================================================================
    // [단계 목록] — 특보정보 탭 1~3
    //   target : 밝게 남길 요소. 배열로 여러 개를 주면 전부 감싸는 구멍 하나로 뚫는다
    //            (없으면 화면 전체가 어두워진다)
    //   want   : 이 단계에서 아코디언 셋이 각각 펼쳐져 있어야 하는지 (true=펼침)
    //            앞/뒤 어느 쪽에서 오든 이 모양으로 맞추므로 [이전] 이 저절로 동작한다
    //   drill  : 특보현황 안쪽을 어디까지 펼쳐 둘지 ('sea' | 'sub')
    //   image  : 가리킬 화면이 없을 때 대신 띄울 그림(특보가 하나도 없는 날)
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
                + '특보가 있으면 아래 그림처럼 해역 이름과 특보 종류, 파도 높이와 바람 세기, '
                + '발표·발효·해제 시각까지 한 장에 나옵니다.',
            image: EXAMPLE_IMG,
            // 특보가 있는 날에는 진짜 화면을 보여주므로 이 단계는 건너뛴다
            skip: function () { return !!_firstSeaWithAlerts(); },
            want: { forecast: false, alert: true, status: false }
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
                + '배를 띄울지 말지 판단할 때 가장 먼저 보게 되는 숫자입니다.',
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
                + '특보현황에서 본 것과 똑같이 쓸 수 있습니다.',
            skip: function () { return !_firstCard('status'); },
            drill: 'status:sub',
            target: function () { var c = _firstCard('status'); return c ? [c] : null; },
            want: { forecast: false, alert: false, status: true }
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

        var shotImg = document.createElement('img');
        shotImg.id = 'tutorial-shot-img';
        shotImg.alt = '특보가 있을 때의 화면 예시';
        shotImg.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;';

        var shotTag = document.createElement('div');
        shotTag.textContent = '예시 화면입니다';
        shotTag.style.cssText = 'position:absolute;top:10px;left:50%;transform:translateX(-50%);'
            + 'padding:6px 14px;border-radius:20px;background:rgba(250,204,21,0.92);color:#1a1f2e;'
            + 'font-size:0.78rem;font-weight:800;letter-spacing:0.3px;white-space:nowrap;'
            + 'box-shadow:0 4px 14px rgba(0,0,0,0.45);';

        shot.appendChild(shotImg);
        shot.appendChild(shotTag);

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
    function _paint() {
        if (!_root) return;
        var step = STEPS[_stepIdx];
        var u = _unionRect(_targets(step));
        var vw = window.innerWidth;
        var vh = window.innerHeight;

        // 하단 메인탭 바를 가리지 않도록 아래 한계를 정한다
        var bar = document.getElementById('bottom-tab-bar');
        var barH = bar ? bar.getBoundingClientRect().height : 0;
        var bottomLimit = vh - barH - EDGE;

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

            var shotTop = EDGE + 26;                       // 위쪽 "시험 모드" 딱지를 피한다
            var shotH = (bottomLimit - cardH - GAP) - shotTop;
            _shot.style.display = shotH > 120 ? 'block' : 'none';
            _shot.style.left = Math.round((vw - cardW) / 2) + 'px';
            _shot.style.width = cardW + 'px';
            _shot.style.top = shotTop + 'px';
            _shot.style.height = Math.round(shotH) + 'px';
            return;
        }
        _shot.style.display = 'none';

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
        var above = (hy - GAP) - EDGE;
        if (bottomLimit - (hy + hh + GAP) < CARD_MIN && above < CARD_MIN) {
            hh = Math.max(40, bottomLimit - CARD_MIN - GAP - hy);
        }

        _hole.style.left   = Math.round(hx) + 'px';
        _hole.style.top    = Math.round(hy) + 'px';
        _hole.style.width  = Math.round(hw) + 'px';
        _hole.style.height = Math.round(hh) + 'px';

        // 카드 자리: 아래쪽 공간과 위쪽 공간을 재어 넓은 쪽에 붙인다
        var below = bottomLimit - (hy + hh + GAP);
        var useBelow = below >= above;
        _card.style.maxHeight = Math.max(CARD_MIN, Math.round(useBelow ? below : above)) + 'px';
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
        for (var i = from + dir; i >= 0 && i < STEPS.length; i += dir) {
            var st = STEPS[i];
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
        if (idx < 0 || idx >= STEPS.length) return;

        // [건너뛰기] 오늘 화면에 없는 단계(특보가 없거나 소분류가 없는 바다)는 지나간다.
        var step = STEPS[idx];
        if (typeof step.skip === 'function' && step.skip()) {
            var d = dir || (idx > _stepIdx ? 1 : -1);
            var to = _nextIdx(idx - d, d);   // idx 부터 그 방향으로 갈 수 있는 곳
            if (to === -1) { if (d > 0) _close(); return; }   // 앞쪽에 아무것도 없으면 마친다
            return _go(to, d);
        }

        _stepIdx = idx;

        // 글자 먼저 채운다(카드 높이를 재려면 내용이 들어 있어야 한다)
        _root.querySelector('#tutorial-step-badge').textContent = (idx + 1) + ' / ' + STEPS.length;
        _root.querySelector('#tutorial-step-title').textContent = step.title;
        _root.querySelector('#tutorial-step-body').textContent  = step.body;

        var prev = _root.querySelector('#tutorial-prev-btn');
        var next = _root.querySelector('#tutorial-next-btn');
        // 갈 수 있는 곳이 없으면 [이전] 을 끄고, [다음] 을 '완료' 로 바꾼다.
        //   단순히 번호가 처음/끝인지로 판단하면, 건너뛰는 단계가 있는 날 갇힌다.
        prev.disabled = (_nextIdx(idx, -1) === -1);
        prev.style.opacity = prev.disabled ? '0.35' : '1';
        prev.style.cursor  = prev.disabled ? 'default' : 'pointer';
        next.textContent = (_nextIdx(idx, 1) === -1) ? '완료' : '다음';

        // 이 단계가 필요로 하는 화면 상태를 통째로 맞춘다(앞/뒤 어느 쪽에서 와도 같은 결과)
        _setAccordion(ACC_FORECAST, step.want.forecast);
        _setAccordion(ACC_ALERT, step.want.alert);
        _setAccordion(ACC_STATUS, step.want.status);

        _drill(step.drill);

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
            return (step.image || step.drill === 'zonemap' || _settled(step.want))
                && _drillSettled(step.drill)
                && (!step.target || !!_unionRect(_targets(step)));
        };
        _when(ready, function () {
            _scrollIntoView(_targets(step));
            // 아코디언 여닫는 애니메이션(0.4초)과 스크롤이 멈춘 뒤에 자리를 잡는다
            _whenStable(function () { return _targets(step); }, _paint);
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
            warn: !!warnBtn && warnBtn.classList.contains('active')
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
        _setBuoy(false);
        _setCardOpen(false);
        _closeSubs('alert');
        _closeSeas('alert');
        _closeSubs('status');
        _closeSeas('status');
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
        window.removeEventListener('resize', _queuePaint);
        window.removeEventListener('scroll', _queuePaint, true);
        _root.remove();
        _root = null;
        _hole = null;
        _shot = null;
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
