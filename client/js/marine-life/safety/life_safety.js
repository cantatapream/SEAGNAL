/**
 * ============================================================================
 * 파일명: client/js/marine-life/safety/life_safety.js
 * 역할  : "해양안전생활" 화면 — 하단 해양생활 탭을 10번 연달아 누르면 열리는 시험용 화면.
 *         하위탭을 [해양안전 | 해양생활] 로 바꾸고, 해양생활 쪽은 6개 활동(바다낚시·서핑·
 *         해수욕·스킨스쿠버·갯벌체험·바다갈라짐)을 화면 오른쪽 세로 버튼으로 갈아끼우며,
 *         배경지도(기본맵·전자해도·해안도·세계지도)를 해양종합정보와 같은 방식으로 고른다.
 *         여기에 더해 위성지도(브이월드)는 시험 단계라 이 화면에서만 고를 수 있다.
 *         새로고침(앱 재시작)하면 원래 해양생활 화면으로 돌아온다 — 저장하지 않음.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : ocean-map/map/ocean_map.js(window.oceanCreateKhoaLayer — 해아름 WMS 레이어,
 *                    window.oceanCreateVworldLayer — 브이월드 위성지도 레이어),
 *                    shared/ui/ui_modal.js(window.showSeagnalModal — 안내 팝업),
 *                    marine-life/*(fishing·surfing·scuba·mudflat·sea_parting — 활동 로직 그대로 재사용),
 *                    forecast/alerts/marine.js(TAB_GROUP_SUBTABS·SECTION_TO_GROUP·switchSubTab)
 *  - 서버 API      : 없음 (활동별 데이터 호출은 각 활동 모듈이 기존대로 담당)
 *  - 마크업        : index2.html 의 #ocean-safety-section, #ocean-safety-sub-tabs,
 *                    #ls-topleft-controls, #ls-rail
 *  - 나를 쓰는 곳  : 없음 — 스스로 하단 해양생활 탭 클릭을 세어 진입한다
 * [로드 순서] js/core/index2_patch.js 다음 — index2_patch 가 감싼 switchMainTab/
 *             switchSubTab 위에 한 겹 더 얹어야 하므로 반드시 그 뒤 · 순서 변경 금지
 * ============================================================================
 */

(function () {
    'use strict';

    // ========================================================================
    // 상수
    // ========================================================================

    /** 트리거: 해양생활 탭을 몇 번 눌러야 열리는가 (ocean_typhoon.js 의 잠금해제와 동일 규격) */
    var TAP_THRESHOLD = 10;
    /** 트리거: 이 시간(ms) 안에 다음 탭이 없으면 카운트 초기화 */
    var TAP_RESET_MS = 3000;

    /**
     * 오른쪽 세로 버튼(레일)에 올릴 활동 목록.
     *  - id      : 기존 섹션 DOM id (그대로 재사용)
     *  - label   : 버튼에 쓰는 글자 (아이콘 없이 텍스트만)
     *  - gpsBtn  : 그 활동이 이미 갖고 있는 "내 위치" 버튼 id (없으면 null)
     *  - getMap  : 그 활동의 OpenLayers 지도 인스턴스를 얻는 함수 (지도 없는 활동은 null)
     * [주의] 이안류(ripcurrent)는 현재 하위탭에서도 숨김 상태라 여기서도 뺀다.
     */
    var ACTIVITIES = [
        { id: 'fishing-section',     label: '바다낚시',   gpsBtn: 'fishing-my-location-btn', pub: 'fishing-publish-time', getMap: function () { return window.getFishingMap && window.getFishingMap(); } },
        { id: 'surfing-section',     label: '서핑',       gpsBtn: 'surfing-my-location-btn', pub: 'surfing-publish-time', getMap: function () { return (window._surfing && window._surfing.map) || null; } },
        { id: 'swimming-section',    label: '해수욕',     gpsBtn: null,                      pub: null,                   getMap: null },
        { id: 'scuba-section',       label: '스킨스쿠버', gpsBtn: 'scuba-my-location-btn',   pub: 'scuba-publish-time',   getMap: function () { return window.getScubaMap && window.getScubaMap(); } },
        { id: 'mudflat-section',     label: '갯벌체험',   gpsBtn: 'mudflat-my-location-btn', pub: 'mudflat-publish-time', getMap: function () { return window.getMudflatMap && window.getMudflatMap(); } },
        { id: 'sea-parting-section', label: '바다갈라짐', gpsBtn: null,                      pub: 'sp-publish-time',      getMap: null }
    ];

    /** 배경지도 종류 → 버튼에 표시할 이름 (해양종합정보 switchBaseLayer 와 동일 표기)
     *  [주의] vworld(위성지도)는 아직 시험 단계라 해양종합정보 메뉴에는 없고 이 화면에만 있다. */
    var BASEMAP_NAMES = { rltm: '기본맵', enc: '전자해도', coast: '해안도', osm: '세계지도', vworld: '위성지도' };

    /** 해아름 WMS 레이어명 — ocean_map.js 와 동일 (기본맵/전자해도/해안도) */
    var KHOA_LAYERS = {
        rltm:  'BASEMAP_RLTM3857',
        enc:   'BASEMAP_ENC573857',
        coast: 'BASEMAP_RLTMCOAST3857'
    };

    // ========================================================================
    // 상태 (전부 메모리 — localStorage 에 남기지 않으므로 새로고침하면 원상복구)
    // ========================================================================

    var _tapCount = 0;          // 해양생활 탭 연타 횟수
    var _tapTimer = null;       // 연타 초기화 타이머
    var _unlocked = false;      // 해양안전생활 화면이 열렸는가
    var _currentAct = 'fishing-section';  // 현재 보고 있는 활동 섹션 id
    var _currentBase = 'rltm';  // 현재 배경지도 종류
    var _lastView = null;       // 활동을 바꿔도 지도 위치가 이어지도록 기억 {center, zoom}
    var _decorated = [];        // 배경지도 레이어를 이미 끼워 넣은 지도 목록(중복 방지)
    var _suspended = [];        // 해양안전 진입 때 잠시 꺼둔 해양종합정보 오버레이 버튼들

    // ========================================================================
    // 1. 트리거 — 해양생활 탭 10회 연타
    // ========================================================================

    /**
     * 하단 "해양생활" 메인탭에 연타 감지를 붙인다.
     * 예: 3초 안에 10번 누르면 해양안전생활 화면이 열린다(그 전까지는 평소대로 동작).
     * [연계] → _unlock() — 임계치에 닿았을 때 화면을 바꾼다.
     *          index2.html 의 .tab-btn[data-target="ocean-life-group"] 이 대상
     */
    function _bindTrigger() {
        var tabBtn = document.querySelector('.main-tabs .tab-btn[data-target="ocean-life-group"]');
        if (!tabBtn) return;

        tabBtn.addEventListener('click', function () {
            if (_unlocked) return;

            _tapCount++;
            clearTimeout(_tapTimer);
            _tapTimer = setTimeout(function () { _tapCount = 0; }, TAP_RESET_MS);

            if (_tapCount < TAP_THRESHOLD) return;
            _tapCount = 0;
            _unlock();
        });
    }

    /**
     * 해양안전생활 화면으로 전환한다 (이 세션 동안만).
     * 하위탭 바를 [해양안전 | 해양생활] 로 갈아끼우고 body 에 표시용 클래스를 붙인 뒤
     * 해양생활 탭을 다시 열어 새 화면이 그려지게 한다.
     * [연계] → marine.js 의 TAB_GROUP_SUBTABS (그룹이 어떤 하위탭 바를 쓰는지의 출처)
     *          → window.switchMainTab — 실제 화면 전환
     */
    function _unlock() {
        _unlocked = true;

        // 해양생활 그룹이 쓰는 하위탭 바를 새 것으로 교체
        if (typeof TAB_GROUP_SUBTABS !== 'undefined') {
            TAB_GROUP_SUBTABS['ocean-life-group'] = 'ocean-safety-sub-tabs';
        }
        // 이 화면에 들어오면 '해양안전' 하위탭이 먼저 열리도록 기본값 변경
        if (typeof TAB_GROUP_DEFAULTS !== 'undefined') {
            TAB_GROUP_DEFAULTS['ocean-life-group'] = 'ocean-safety-section';
        }

        // 하단 메인탭 이름도 화면 이름에 맞춘다 ("해양종합정보"와 같은 6글자라 폭 문제 없음)
        var tabLabel = document.querySelector('.main-tabs .tab-btn[data-target="ocean-life-group"] .tab-btn-label');
        if (tabLabel) tabLabel.textContent = '해양안전생활';

        document.body.classList.add('ls-mode');

        if (typeof window.switchMainTab === 'function') {
            window.switchMainTab('ocean-life-group');
        }
    }

    // ========================================================================
    // 1-2. 해양안전 하위탭 — 해양종합정보 지도를 물빠짐 전용으로 빌려 쓴다
    // ========================================================================

    /**
     * 해양안전 하위탭을 연다.
     * 물빠짐(갯벌 노출 예측)은 해양종합정보 지도 한 곳에만 붙어 있는 기능이라
     * 새 지도를 만들지 않고 그 지도 섹션(#ocean-map-section)을 그대로 띄운 뒤,
     * CSS 로 물빠짐·안내·배경지도·내 위치만 남기고 나머지 버튼을 감춘다.
     * [연계] → window.initOceanMap (ocean_map.js) / body.ls-safety CSS (index2.html)
     *          ← _syncChrome() — 자리표시 섹션(#ocean-safety-section)이 켜지면 호출
     */
    function _enterSafety() {
        var placeholder = document.getElementById('ocean-safety-section');
        var oceanSec = document.getElementById('ocean-map-section');
        if (!oceanSec) return;   // 지도 섹션이 없으면 자리표시 섹션을 그대로 둔다

        if (placeholder) placeholder.classList.remove('active');
        oceanSec.classList.add('active');
        document.body.classList.add('ocean-map-active', 'ls-safety');
        document.body.classList.remove('ls-life');

        // 해양종합정보에서 켜 둔 오버레이(특보구역·해구도 등)가 따라오지 않게 끈다
        _suspendOceanOverlays();

        // 지도 초기화(최초 1회) — 섹션이 보이게 된 뒤라야 크기가 제대로 잡힌다
        setTimeout(function () {
            if (window.initOceanMap) window.initOceanMap();
            _reviveOceanMap();
        }, 200);
    }

    /**
     * 해양종합정보 지도의 캔버스 크기를 다시 계산한다.
     * 섹션이 숨겨져 있는 동안 크기가 0 으로 잡히는 것을 되돌리기 위함.
     * [연계] ← _enterSafety() — 화면 전환 직후·전환 애니메이션 종료 후 두 번 호출
     */
    function _reviveOceanMap() {
        function _run() {
            try {
                var m = window.getOceanMap && window.getOceanMap();
                if (!m) return;
                if (m.updateSize) m.updateSize();
                if (m.render) m.render();
            } catch (e) { /* 지도가 아직 준비 전이면 무시 */ }
        }
        requestAnimationFrame(_run);
        setTimeout(_run, 400);
    }

    /**
     * 해양안전에서 빠져나올 때 빌려 썼던 해양종합정보 지도 섹션을 정리한다.
     * [연계] ← _syncChrome() — 활동(바다낚시 등)으로 이동했을 때
     */
    function _leaveSafety() {
        // 이 화면에서 켠 것(물빠짐 등)만 끄고, 해양종합정보 쪽 복원은 그 탭에 실제로
        // 들어갈 때 한다(활동 화면에서 엉뚱한 안내 토스트가 뜨는 것을 막기 위함).
        _silently(function () {
            var on = document.querySelectorAll('#ocean-overlay-controls .ocean-overlay-btn.active');
            for (var i = 0; i < on.length; i++) {
                if (on[i].classList.contains('active')) on[i].click();
            }
        });
        var oceanSec = document.getElementById('ocean-map-section');
        if (oceanSec) oceanSec.classList.remove('active');
        document.body.classList.remove('ocean-map-active', 'ls-safety', 'ls-mudflat-on');
    }

    /**
     * 해양안전에 들어올 때, 해양종합정보 쪽에서 켜 둔 오버레이 버튼을 모두 끈다.
     * 같은 지도를 빌려 쓰기 때문에 아무것도 안 하면 특보구역·해구도 선 같은 것이
     * 그대로 따라온다. 어떤 버튼을 껐는지 기억해 두었다가 나갈 때 되살린다.
     * 예: 해양종합정보에서 특보구역 ON → 해양안전 진입 시 OFF → 되돌아가면 다시 ON
     * [연계] ← _enterSafety() / → _restoreOceanOverlays()
     *          기존 버튼의 click 을 그대로 호출하므로 각 오버레이의 정리 로직이 재사용된다.
     */
    /**
     * 오버레이 버튼을 프로그램으로 껐다 켜는 동안 안내 토스트를 잠시 막는다.
     * 사용자가 직접 누른 게 아니므로("특보구역은 참고용…" 같은) 안내가 뜨면
     * 엉뚱한 화면에 안내가 떠 혼란스럽기 때문.
     * @param {Function} fn - 이 안에서 버튼 click 을 수행
     * [연계] ← _suspendOceanOverlays() / _restoreOceanOverlays() / _leaveSafety()
     */
    function _silently(fn) {
        var orig = window._showOceanToast;
        window._showOceanToast = function () {};
        try { fn(); } finally { window._showOceanToast = orig; }
    }

    function _suspendOceanOverlays() {
        if (_suspended.length) return;   // 이미 정리된 상태
        // [주의] 이 화면 CSS 가 이미 버튼들을 숨긴 뒤라 offsetParent 로는 판별할 수 없다.
        //        지금 active 인 것만 골라 차례로 끄고, 그 목록을 그대로 기억한다.
        var btns = document.querySelectorAll('#ocean-overlay-controls .ocean-overlay-btn.active');
        for (var i = 0; i < btns.length; i++) {
            _suspended.push(btns[i]);
        }
        _silently(function () {
            for (var j = 0; j < _suspended.length; j++) {
                // 앞 버튼을 끄는 과정에서 이미 꺼졌을 수 있으므로 그때그때 확인
                if (_suspended[j].classList.contains('active')) _suspended[j].click();
            }
        });
    }

    /**
     * 진짜 해양종합정보 탭으로 갈 때, 해양안전 때문에 꺼뒀던 오버레이를 되살린다.
     * 예: 특보구역·주요지명을 켠 채로 해양안전에 들렀다 돌아오면 그대로 다시 켜져 있음
     * [연계] ← _wrapTabSwitchers() 의 switchMainTab 래퍼(targetId==='ocean-map-section')
     */
    function _restoreOceanOverlays() {
        // [버그수정] 예전엔 "_suspended 가 비어 있으면(=해양안전 진입 전 켜진 게
        //   없던 흔한 경우) 통째로 return" 했다. 그러면 바로 아래 "해양안전에서
        //   켠 것(물빠짐·위험물 등) 끄기" 단계까지 같이 건너뛰어, 해양안전에서
        //   토글한 오버레이가 해양종합정보로 넘어와도 그대로 켜진 채 남았다.
        //   꺼야 할 대상은 _suspended 유무와 무관하므로 얼리 리턴을 없앤다.
        _silently(function () {
            // 해양안전에서 켠 것(물빠짐·위험물 등)이 남아 있으면 먼저 끈다
            var on = document.querySelectorAll('#ocean-overlay-controls .ocean-overlay-btn.active');
            for (var i = 0; i < on.length; i++) {
                if (on[i].classList.contains('active')) on[i].click();
            }
            for (var j = 0; j < _suspended.length; j++) {
                if (!_suspended[j].classList.contains('active')) _suspended[j].click();
            }
        });
        _suspended = [];
    }

    /**
     * 지점 팝업(바텀시트)이 열렸는지 지켜보다가 body 에 ls-sheet-open 클래스를 붙인다.
     * 팝업은 활동 섹션 안에 있어 바깥에 뜬 우측 레일보다 위로 올라올 수 없으므로,
     * 팝업이 열린 동안에는 레일을 감춰 닫기 버튼이 가리지 않게 한다.
     * [연계] → index2.html 의 body.ls-sheet-open 규칙 (#ls-rail 숨김)
     */
    function _watchBottomSheets() {
        var ids = ['fishing-bottomsheet', 'mudflat-bottomsheet', 'scuba-bottomsheet',
                   'rip-bottomsheet', 'surfing-popup'];
        var els = [];
        for (var i = 0; i < ids.length; i++) {
            var el = document.getElementById(ids[i]);
            if (el) els.push(el);
        }
        if (!els.length || typeof MutationObserver === 'undefined') return;

        function _sync() {
            var open = false;
            for (var j = 0; j < els.length; j++) {
                if (els[j].classList.contains('active')) { open = true; break; }
            }
            document.body.classList.toggle('ls-sheet-open', open);
        }
        var obs = new MutationObserver(_sync);
        for (var k = 0; k < els.length; k++) {
            obs.observe(els[k], { attributes: true, attributeFilter: ['class'] });
        }
        _sync();
    }

    /**
     * 물빠짐 버튼의 켜짐/꺼짐을 지켜보다가 body 에 ls-mudflat-on 클래스를 붙인다.
     * 시간 슬라이더·범례가 생기면 출처표기(국립해양조사원/OpenStreetMap)를 그 위로
     * 올려야 해서 CSS 가 이 상태를 알아야 한다.
     * [연계] → index2.html 의 body.ls-mudflat-on 규칙 (출처표기·범례 위치)
     */
    function _watchMudflatToggle() {
        var btn = document.getElementById('ocean-mudflat-toggle-btn');
        if (!btn || typeof MutationObserver === 'undefined') return;
        function _sync() {
            document.body.classList.toggle('ls-mudflat-on', btn.classList.contains('active'));
        }
        new MutationObserver(_sync).observe(btn, { attributes: true, attributeFilter: ['class'] });
        _sync();
    }

    // ========================================================================
    // 2. 화면 동기화 — 어떤 활동이 켜져 있는지에 따라 크롬(우측 레일/좌측 상단)을 맞춘다
    // ========================================================================

    /**
     * 현재 활성 섹션을 보고 우측 레일·좌측 상단 컨트롤 상태를 맞춘다.
     * 예: 서핑 섹션이 켜져 있으면 → 레일의 "서핑" 버튼만 진하게, 갯바위/선상 팝아웃은 감춤,
     *     GPS 버튼은 서핑의 내 위치 버튼을 대신 누르도록 연결.
     * [연계] ← _wrapTabSwitchers() 가 탭 전환 직후마다 호출 / → _decorateMap() 배경지도 준비
     */
    function _syncChrome() {
        if (!_unlocked) return;

        // ① 해양안전 자리표시 섹션이 켜졌으면 해양종합정보 지도 섹션으로 바꿔 단다
        var placeholder = document.getElementById('ocean-safety-section');
        if (placeholder && placeholder.classList.contains('active')) {
            _enterSafety();
            return;
        }

        // ② 이미 해양안전(= 이 화면이 빌려 쓰는 지도 섹션)을 보고 있는 중인지 판정.
        //    진짜 해양종합정보 탭과 구분하려고 body[data-active-tab] 을 함께 본다.
        var oceanSec = document.getElementById('ocean-map-section');
        var inSafety = !!(oceanSec && oceanSec.classList.contains('active') &&
                          document.body.getAttribute('data-active-tab') === 'ocean-life-group');

        var actId = null;
        for (var i = 0; i < ACTIVITIES.length; i++) {
            var sec = document.getElementById(ACTIVITIES[i].id);
            if (sec && sec.classList.contains('active')) { actId = ACTIVITIES[i].id; break; }
        }

        // ③ 활동으로 이동했으면 빌려 썼던 지도 섹션을 되돌린다
        if (actId && inSafety) { _leaveSafety(); inSafety = false; }
        if (!actId && !inSafety) document.body.classList.remove('ls-safety');

        // 활동 섹션이 아닌 곳(해양안전 등)에 있으면 레일/좌측 컨트롤을 숨긴다
        document.body.classList.toggle('ls-life', !!actId);
        if (!actId) { document.body.classList.remove('ls-row'); return; }

        _currentAct = actId;

        // 하위탭 바의 "해양생활" 버튼이 항상 현재 활동을 가리키도록 동기화
        var lifeSubBtn = document.getElementById('ls-life-sub-btn');
        if (lifeSubBtn) {
            lifeSubBtn.setAttribute('data-target', actId);
            lifeSubBtn.classList.add('active');
        }

        // 레일 버튼 active 표시 ([data-act] 로 한정 — 갯바위/선상 팝아웃 버튼은 제외)
        var railBtns = document.querySelectorAll('#ls-rail .ls-act-btn[data-act]');
        for (var j = 0; j < railBtns.length; j++) {
            railBtns[j].classList.toggle('active', railBtns[j].getAttribute('data-act') === actId);
        }

        // 바다갈라짐은 지도가 없고 표가 넓어, 버튼을 좌측 상단 아래 가로 한 줄로 편다
        document.body.classList.toggle('ls-row', actId === 'sea-parting-section');

        // 갯바위/선상 팝아웃은 바다낚시일 때만 의미가 있으므로 다른 활동으로 가면 접는다
        // (바다낚시 버튼 자체는 레일에 계속 남아 있어야 하므로 wrap 은 숨기지 않는다)
        var gubunWrap = document.getElementById('ls-gubun-wrap');
        if (gubunWrap && actId !== 'fishing-section') {
            gubunWrap.classList.remove('popup-open');
        }

        // GPS 버튼: 그 활동에 내 위치 기능이 있을 때만 노출
        var act = _findActivity(actId);
        var gpsBtn = document.getElementById('ls-gps-btn');
        if (gpsBtn) gpsBtn.style.display = (act && act.gpsBtn) ? '' : 'none';

        // 지도가 있는 활동이면 배경지도 레이어를 준비하고 직전 위치를 이어받는다
        _prepareMap(act);
    }

    /**
     * 활동 id 로 ACTIVITIES 항목을 찾는다.
     * 예: _findActivity('surfing-section') → { id:'surfing-section', label:'서핑', ... }
     * @param {string} id - 섹션 DOM id
     * @returns {Object|null} 활동 정보 (없으면 null)
     * [연계] ← _syncChrome() / _selectActivity() — 활동별 버튼·지도 연결에 사용
     */
    function _findActivity(id) {
        for (var i = 0; i < ACTIVITIES.length; i++) {
            if (ACTIVITIES[i].id === id) return ACTIVITIES[i];
        }
        return null;
    }

    /**
     * 활동을 바꾼다 (우측 레일 버튼 클릭).
     * 기존 하위탭 전환 함수를 그대로 쓰기 때문에 지도 초기화·사용량 집계 등
     * 기존 동작이 모두 유지된다.
     * @param {string} sectionId - 이동할 활동 섹션 id
     * [연계] → window.switchSubTab (marine.js) — 섹션 표시/초기화 / → _syncChrome()
     */
    function _selectActivity(sectionId) {
        // 활동을 떠나기 전에 지금 지도 위치를 기억해 둔다 (다음 활동이 이어받도록)
        _rememberView();
        if (typeof window.switchSubTab === 'function') {
            window.switchSubTab(sectionId);
        }
        _toastPublishTime(sectionId);
    }

    /**
     * 그 활동의 발표(기준) 시각을 토스트로 알린다.
     * 화면 위 제목 줄을 없앤 대신, 버튼을 누를 때 발표 정보를 짧게 보여주기 위함.
     * 예: 바다낚시 버튼 → "발표: 2026. 8. 1. 02:52"
     * @param {string} sectionId - 활동 섹션 id
     * [연계] → index2_patch.js 의 window._showOceanToast (해양종합정보와 같은 위치·모양)
     *          ← _selectActivity() — 우측 레일 버튼 클릭 시
     */
    function _toastPublishTime(sectionId) {
        var act = _findActivity(sectionId);
        if (!act || !act.pub) return;

        // 데이터가 아직 안 왔으면 잠시 뒤 한 번 더 본다(활동 진입 시 비동기 로드)
        function _try(retries) {
            var el = document.getElementById(act.pub);
            var txt = el ? (el.textContent || '').trim() : '';
            var hasValue = txt && txt.replace(/^(발표|기준)\s*:\s*/, '').trim() !== '-';
            if (hasValue) {
                if (typeof window._showOceanToast === 'function') {
                    window._showOceanToast(act.label + ' ' + txt, 'bottom', 2600);
                }
                return;
            }
            if (retries > 0) setTimeout(function () { _try(retries - 1); }, 500);
        }
        _try(4);
    }

    // ========================================================================
    // 3. 지도 — 배경지도 4종 + 활동 간 위치 이어받기
    // ========================================================================

    /**
     * 현재 활동의 지도 위치(중심·줌)를 기억한다.
     * 활동을 바꿔도 "지도 하나를 계속 보고 있는" 느낌이 나게 하기 위함.
     * [연계] ← _selectActivity() / → _prepareMap() 가 기억한 값을 적용
     */
    function _rememberView() {
        var act = _findActivity(_currentAct);
        var map = act && act.getMap && act.getMap();
        if (!map || !map.getView) return;
        try {
            _lastView = { center: map.getView().getCenter(), zoom: map.getView().getZoom() };
        } catch (e) { /* 지도가 아직 준비 전이면 무시 */ }
    }

    /**
     * 활동의 지도에 배경지도 4종을 준비하고, 직전 활동의 위치를 이어받는다.
     * 지도가 아직 안 만들어졌을 수 있으므로(활동 진입 시 200ms 뒤 초기화) 잠시 뒤 다시 시도한다.
     * @param {Object|null} act - ACTIVITIES 항목
     * [연계] ← _syncChrome() / → _decorateMap(), _applyBasemap()
     */
    function _prepareMap(act) {
        if (!act || !act.getMap) return;

        function _try(retries) {
            var map = act.getMap();
            if (!map) {
                if (retries > 0) setTimeout(function () { _try(retries - 1); }, 250);
                return;
            }
            _decorateMap(map);
            _applyBasemap(_currentBase);
            if (_lastView && _lastView.center) {
                try {
                    map.getView().setCenter(_lastView.center);
                    map.getView().setZoom(_lastView.zoom);
                } catch (e) { /* 줌 한계가 다른 지도면 OL 이 알아서 맞춘다 */ }
            }
            if (map.updateSize) map.updateSize();
        }
        _try(6);
    }

    /**
     * 활동 지도에 해아름 배경지도(기본맵·전자해도·해안도) 레이어를 끼워 넣는다.
     * 원래 있던 OSM 타일은 "세계지도" 선택지로 그대로 쓴다.
     * 예: 바다낚시 지도 layers = [기본맵, 전자해도, 해안도, OSM, 마커…]
     * @param {ol.Map} map - 대상 지도
     * [연계] → ocean_map.js 의 window.oceanCreateKhoaLayer — WMS 프록시 설정을 그대로 재사용
     */
    function _decorateMap(map) {
        if (_decorated.indexOf(map) !== -1) return;
        if (typeof window.oceanCreateKhoaLayer !== 'function') return;

        var layers = map.getLayers();
        // 원래 첫 레이어가 OSM 타일 — 세계지도 선택지로 표시해 둔다
        var osm = layers.item(0);
        if (osm) osm.set('lsBase', 'osm');

        var order = ['rltm', 'enc', 'coast'];
        for (var i = 0; i < order.length; i++) {
            var lyr = window.oceanCreateKhoaLayer(KHOA_LAYERS[order[i]]);
            lyr.set('lsBase', order[i]);
            lyr.setVisible(false);
            layers.insertAt(i, lyr);
        }

        // 위성지도(브이월드) — 위성영상 위에 지명·도로 라벨을 덮어야 어디가 어딘지
        // 알 수 있으므로 두 장을 같은 'vworld' 로 묶는다. _applyBasemap 이 같은
        // 이름의 레이어를 한꺼번에 켜고 끄므로 별도 처리가 필요 없다.
        // 원래 줌 한계는 위성지도를 끌 때 되돌리려고 지도에 적어 둔다.
        if (typeof window.oceanCreateVworldLayer === 'function') {
            map.set('lsMaxZoom', map.getView().getMaxZoom());
            var vwSat = window.oceanCreateVworldLayer('Satellite');
            var vwLabel = window.oceanCreateVworldLayer('Hybrid');
            vwSat.set('lsBase', 'vworld');
            vwLabel.set('lsBase', 'vworld');
            layers.insertAt(3, vwSat);
            layers.insertAt(4, vwLabel);
        }

        _decorated.push(map);
    }

    /**
     * 배경지도를 지정한 종류로 바꾼다 (지금까지 준비된 모든 활동 지도에 함께 적용).
     * 예: _applyBasemap('enc') → 전자해도만 보이고 나머지 배경은 숨김
     * @param {string} type - 'rltm' | 'enc' | 'coast' | 'osm' | 'vworld'
     * [연계] ← 좌측 상단 배경지도 메뉴 클릭 / _prepareMap() 진입 시 현재 선택 재적용
     */
    function _applyBasemap(type) {
        _currentBase = type;

        for (var i = 0; i < _decorated.length; i++) {
            var layers = _decorated[i].getLayers().getArray();
            for (var j = 0; j < layers.length; j++) {
                var kind = layers[j].get('lsBase');
                if (kind) layers[j].setVisible(kind === type);
            }

            // 줌 한계 — 위성지도일 때만 브이월드 한계(19)까지 열어 준다. 활동 지도는
            // 원래 13 까지라 위성영상의 값어치(접안시설·갯바위 식별)가 안 나온다.
            // 다른 배경으로 돌아갈 때는 원래 한계로 되돌리고 현재 줌도 같이 당긴다.
            var view = _decorated[i].getView();
            var orig = _decorated[i].get('lsMaxZoom');
            if (typeof orig === 'number' && window.oceanCreateVworldLayer) {
                var maxZoom = (type === 'vworld') ? window.oceanCreateVworldLayer.maxZoom : orig;
                view.setMaxZoom(maxZoom);
                if (view.getZoom() > maxZoom) view.setZoom(maxZoom);
            }
        }

        // 토글 버튼 라벨 + 메뉴 active 표시 갱신
        var label = document.getElementById('ls-basemap-label');
        if (label) {
            label.textContent = BASEMAP_NAMES[type] || '지도';
            label.setAttribute('data-line1', BASEMAP_NAMES[type] || '지도');
        }
        var items = document.querySelectorAll('#ls-basemap-menu .ocean-basemap-item');
        for (var k = 0; k < items.length; k++) {
            items[k].classList.toggle('active', items[k].getAttribute('data-basemap') === type);
        }
    }

    // ========================================================================
    // 4. 안내(ⓘ) 팝업 — 해양종합정보와 같은 탭형 팝업
    // ========================================================================

    /**
     * 숨겨진 유의사항 DOM 의 내용을 읽어 온다.
     * 예: _pickHtml('#scuba-disclaimer') → 스킨스쿠버 유의사항 문단들
     * @param {string} selector - 유의사항이 들어 있는 요소 선택자
     * @returns {string} 내용 HTML (없으면 빈 문자열)
     * [연계] ← _buildInfoHtml() — 활동별 안내 본문을 기존 문구 그대로 재사용하기 위함
     */
    function _pickHtml(selector) {
        var el = document.querySelector(selector);
        return el ? el.innerHTML : '';
    }

    /**
     * 안내 팝업 본문(탭바 + 패널)을 만든다.
     * 6개 활동 버튼이 위에 있고, 누르면 그 활동의 유의사항이 아래에 표시된다.
     * @returns {string} 팝업에 넣을 HTML
     * [연계] → index2.html 의 .ocean-info-tabs/.ocean-info-panel CSS 를 그대로 사용
     *          → window.__lsInfoSwitch — 탭 전환
     */
    function _buildInfoHtml() {
        var items = [
            { id: 'fishing', label: '바다낚시', html:
                '<p><strong>갯바위</strong></p>' + _pickHtml('#fishing-disclaimer-gwbr') +
                '<p><strong>선상</strong></p>' + _pickHtml('#fishing-disclaimer-ship') },
            { id: 'surfing',  label: '서핑',       html: _pickHtml('#surfing-disclaimer') },
            { id: 'swimming', label: '해수욕',     html: '<p><i class="fa-solid fa-circle-check"></i> 해수욕 지수는 해수욕장 개장기간에 제공됩니다.</p>' },
            { id: 'scuba',    label: '스킨스쿠버', html: _pickHtml('#scuba-disclaimer') },
            { id: 'mudflat',  label: '갯벌체험',   html: _pickHtml('#mudflat-disclaimer') },
            { id: 'parting',  label: '바다갈라짐', html: _pickHtml('#sp-footer-info .sp-disclaimer') ||
                '<p><i class="fa-solid fa-circle-check"></i> 바다갈라짐 정보를 먼저 열어 보시면 안내 문구가 표시됩니다.</p>' }
        ];

        var tabsHtml = '<div class="ocean-info-tabs">';
        var panelsHtml = '<div class="ocean-info-panels">';
        for (var i = 0; i < items.length; i++) {
            var activeCls = (i === 0) ? ' active' : '';
            tabsHtml += '<button type="button" class="ocean-info-tab-btn' + activeCls +
                        '" data-info-tab="' + items[i].id + '" ' +
                        'onclick="window.__lsInfoSwitch(\'' + items[i].id + '\')">' + items[i].label + '</button>';
            panelsHtml += '<div class="ocean-info-panel' + activeCls + '" data-info-panel="' + items[i].id + '">' +
                          (items[i].html || '<p>준비 중입니다.</p>') + '</div>';
        }
        return tabsHtml + '</div>' + panelsHtml + '</div>';
    }

    /**
     * 해양안전 화면(물빠짐·노출암/간출암·CCTV·낚시금지·관제구역·항로) 전용 안내 팝업 본문(탭바 + 패널)을 만든다.
     * 해양종합정보의 17탭 안내와 같은 방식으로, 이 화면에 있는 기능만 탭으로 보여준다.
     * @returns {string} 팝업에 넣을 HTML
     * [연계] ← window.oceanInfoTabHtml() (ocean_cctv.js) — 탭 본문을 그대로 재사용
     *          (낚시금지는 해양종합정보에 없는 기능이라 공용 목록 대신 여기서 html 로 직접 넣는다)
     *          → index2.html 의 .ocean-info-tabs/.ocean-info-panel/.ocean-info-src CSS, window.__lsInfoSwitch
     */
    function _buildSafetyInfoHtml() {
        var fn = window.oceanInfoTabHtml;
        var items = [
            { id: 'mudflat', label: '물빠짐' },
            { id: 'hazardrock', label: '노출암·간출암' },
            { id: 'cctv', label: 'CCTV' },
            { id: 'fishingban', label: '낚시금지', html:
                '<p><i class="fa-solid fa-circle-check"></i> 낚시 관리 및 육성법 제6조와 지자체 조례에 따라 낚시가 금지되거나 제한된 구역을 지도 위에 주황색으로 표시합니다.</p>'
              + '<p><i class="fa-solid fa-circle-check"></i> 버튼을 켜면 실제 지형과 비교하기 쉽도록 배경지도가 위성지도로 자동 전환됩니다. 끄면 원래 배경지도로 돌아갑니다.</p>'
              + '<p><i class="fa-solid fa-circle-check"></i> 구역을 누르면 위치, 지정 사유, 통제 기간·시간, 대상, 벌칙, 고시번호 등 상세 정보를 확인할 수 있습니다.</p>'
              + '<p><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> 국립해양조사원이 파악한 구역만 반영되어 있어 최신 지정 현황과 다를 수 있습니다. 실제 낚시 전에는 현장 안내판이나 관할 지자체 공고를 꼭 확인하세요.</p>'
              + '<div class="ocean-info-src">최종 갱신일자 · 2025-12-12<br>출처 · 국립해양조사원 낚시통제구역 주제도</div>' },
            { id: 'vts', label: '관제구역', html:
                '<p>해양경찰청이 공고한 선박교통관제구역(VTS)을 지도 위에 남색(인디고)으로 표시하며, 명칭에 실제 관제채널(예: Ch. 09)이 함께 표기됩니다.</p>'
              + '<p>버튼을 켜면 배경지도가 전자해도로 자동 전환됩니다. 끄면 원래 배경지도로 돌아갑니다.</p>'
              + '<p>구역을 누르면 관제해역 설명, 관제센터 주소·전화·팩스를 확인할 수 있고, 누른 구역은 노란색으로 표시되어 어디를 선택했는지 알 수 있습니다.</p>'
              + '<p><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> 실제 통항 시 정확한 관제채널과 신고 절차는 관할 관제센터로 문의하세요.</p>'
              + '<div class="ocean-info-src">최종 갱신일자 · 2026-08-03<br>출처 · 해양경찰청 전국 VTS센터 공고자료</div>' },
            { id: 'seaway', label: '항로', html:
                '<p>해상교통안전법 등에 따라 지정된 항로(통항분리대·통항분리수역·지정항로·주의해역·선회장 등)를 지도 위에 청록색으로 표시합니다.</p>'
              + '<p>버튼을 켜면 실제 항로와 비교하기 쉽도록 배경지도가 전자해도로 자동 전환됩니다. 끄면 원래 배경지도로 돌아갑니다.</p>'
              + '<p>항로를 누르면 항로명, 종류(통항분리대/통항분리수역 등), 근거·참고 문서를 확인할 수 있습니다.</p>'
              + '<p><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> 항로 종류에 따라 통항 방법이 다르니, 실제 항해 전 관련 법령·고시 원문을 반드시 확인하세요.</p>'
              + '<div class="ocean-info-src">최종 갱신일자 · 2026-08-03<br>출처 · 국립해양조사원 개방海(실시간 해양공간정보)</div>' }
        ];
        var tabsHtml = '<div class="ocean-info-tabs">';
        var panelsHtml = '<div class="ocean-info-panels">';
        for (var i = 0; i < items.length; i++) {
            var activeCls = (i === 0) ? ' active' : '';
            tabsHtml += '<button type="button" class="ocean-info-tab-btn' + activeCls +
                        '" data-info-tab="' + items[i].id + '" ' +
                        'onclick="window.__lsInfoSwitch(\'' + items[i].id + '\')">' + items[i].label + '</button>';
            var body = items[i].html || (typeof fn === 'function' && fn(items[i].id)) || '<p>준비 중입니다.</p>';
            panelsHtml += '<div class="ocean-info-panel' + activeCls + '" data-info-panel="' + items[i].id + '">' +
                          body + '</div>';
        }
        return tabsHtml + '</div>' + panelsHtml + '</div>';
    }

    /**
     * 안내 팝업 안에서 탭을 바꾼다 (팝업 HTML 의 onclick 에서 호출).
     * @param {string} tabId - 활동 탭 id (예: 'surfing')
     * [연계] ← _buildInfoHtml() 이 심어 둔 onclick
     */
    window.__lsInfoSwitch = function (tabId) {
        var tabs = document.querySelectorAll('.ocean-info-tab-btn');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].classList.toggle('active', tabs[i].getAttribute('data-info-tab') === tabId);
        }
        var panels = document.querySelectorAll('.ocean-info-panel');
        for (var j = 0; j < panels.length; j++) {
            panels[j].classList.toggle('active', panels[j].getAttribute('data-info-panel') === tabId);
        }
    };

    // ========================================================================
    // 5. 이벤트 바인딩
    // ========================================================================

    /**
     * 새 화면의 버튼들(레일·배경지도·안내·GPS·갯바위/선상)에 클릭 이벤트를 붙인다.
     * 페이지 로드 시 1회만 실행된다.
     * [연계] → _selectActivity(), _applyBasemap(), _buildInfoHtml(),
     *          기존 활동 모듈의 내 위치/갯바위·선상 버튼을 대신 눌러 로직을 재사용
     */
    function _bindControls() {
        // --- 우측 레일: 활동 선택 ([data-act] 가 있는 버튼만 — 갯바위/선상은 아래에서 따로) ---
        var railBtns = document.querySelectorAll('#ls-rail .ls-act-btn[data-act]');
        for (var i = 0; i < railBtns.length; i++) {
            railBtns[i].addEventListener('click', function () {
                var target = this.getAttribute('data-act');
                var gubunWrap = document.getElementById('ls-gubun-wrap');

                // 바다낚시는 이미 켜진 상태에서 다시 누르면 갯바위/선상 팝아웃을 여닫는다
                //  (해양종합정보의 "천기" 버튼과 같은 방식 — 버튼 왼쪽으로 펼쳐짐)
                if (target === 'fishing-section' && _currentAct === 'fishing-section' && gubunWrap) {
                    gubunWrap.classList.toggle('popup-open');
                    return;
                }
                if (gubunWrap) gubunWrap.classList.remove('popup-open');
                _selectActivity(target);
            });
        }

        // --- 좌측 상단: 배경지도 피커 ---
        var bmToggle = document.getElementById('ls-basemap-toggle');
        var bmMenu = document.getElementById('ls-basemap-menu');
        if (bmToggle && bmMenu) {
            bmToggle.addEventListener('click', function (e) {
                e.stopPropagation();
                bmMenu.style.display = bmMenu.style.display === 'none' ? '' : 'none';
            });
            var items = bmMenu.querySelectorAll('.ocean-basemap-item');
            for (var b = 0; b < items.length; b++) {
                items[b].addEventListener('click', function (e) {
                    e.stopPropagation();
                    _applyBasemap(this.getAttribute('data-basemap'));
                    bmMenu.style.display = 'none';
                });
            }
        }

        // --- 좌측 상단: 안내(ⓘ) ---
        var infoBtn = document.getElementById('ls-info-btn');
        if (infoBtn) {
            infoBtn.addEventListener('click', function () {
                if (typeof window.showSeagnalModal === 'function') {
                    window.showSeagnalModal('안내사항', _buildInfoHtml(), 'info');
                }
            });
        }

        // --- 레일 하단: 내 위치 (활동이 원래 갖고 있던 버튼을 대신 누름) ---
        var gpsBtn = document.getElementById('ls-gps-btn');
        if (gpsBtn) {
            gpsBtn.addEventListener('click', function () {
                var act = _findActivity(_currentAct);
                var origin = act && act.gpsBtn && document.getElementById(act.gpsBtn);
                if (origin) origin.click();
            });
        }

        // --- 해양안전 화면의 안내(ⓘ) — 이 화면에 있는 기능만 보여준다 ---
        //   해양종합정보 버튼(#ocean-info-btn)을 그대로 쓰지만 그 팝업은 17개 탭짜리
        //   전체 안내다. 이 화면엔 물빠짐·노출암/간출암·CCTV만 있으므로 document 캡처
        //   단계에서 가로채 해양종합정보와 같은 탭형 팝업(_buildSafetyInfoHtml())으로
        //   띄운다(캡처라 버튼 자신의 기존 핸들러까지 도달하지 않음).
        document.addEventListener('click', function (e) {
            if (!document.body.classList.contains('ls-safety')) return;
            var btn = e.target && e.target.closest && e.target.closest('#ocean-info-btn');
            if (!btn) return;
            e.stopPropagation();
            e.preventDefault();
            if (typeof window.showSeagnalModal !== 'function') return;
            window.showSeagnalModal('해양안전 안내', _buildSafetyInfoHtml(), 'info');
        }, true);

        // --- 갯바위/선상 팝아웃 (바다낚시 전용) ---
        var gubunBtns = document.querySelectorAll('#ls-gubun-wrap .ls-gubun-item');
        for (var g = 0; g < gubunBtns.length; g++) {
            gubunBtns[g].addEventListener('click', function (e) {
                e.stopPropagation();
                var gubun = this.getAttribute('data-gubun');
                // 기존 바다낚시 토글 버튼을 대신 눌러 마커 재렌더링 로직을 그대로 사용
                var origin = document.querySelector('.fishing-gubun-btn[data-gubun="' + gubun + '"]');
                if (origin) origin.click();

                var all = document.querySelectorAll('#ls-gubun-wrap .ls-gubun-item');
                for (var k = 0; k < all.length; k++) {
                    all[k].classList.toggle('active', all[k] === this);
                }
                var wrap = document.getElementById('ls-gubun-wrap');
                if (wrap) wrap.classList.remove('popup-open');
            });
        }
    }

    /**
     * 탭 전환 함수를 한 겹 감싸, 전환이 끝날 때마다 새 화면 상태를 다시 맞춘다.
     * (index2_patch.js 가 이미 한 번 감쌌으므로 그 위에 얹는다)
     * [연계] → _syncChrome() — 레일/좌측 컨트롤/지도 동기화
     */
    function _wrapTabSwitchers() {
        var origMain = window.switchMainTab;
        window.switchMainTab = function (targetId) {
            // 진짜 해양종합정보 탭으로 들어가는 길이면, 해양안전 때문에 꺼뒀던
            // 오버레이를 먼저 되살린다(그 화면의 원래 상태로 복귀)
            if (_unlocked && targetId === 'ocean-map-section') _restoreOceanOverlays();
            origMain.apply(window, arguments);
            _syncChrome();
        };

        var origSub = window.switchSubTab;
        window.switchSubTab = function (targetId) {
            origSub.apply(window, arguments);
            _syncChrome();
        };
    }

    // ========================================================================
    // 6. 초기화
    // ========================================================================

    document.addEventListener('DOMContentLoaded', function () {
        _bindTrigger();
        _bindControls();
        _wrapTabSwitchers();
        _watchMudflatToggle();
        _watchBottomSheets();
    });

})();
