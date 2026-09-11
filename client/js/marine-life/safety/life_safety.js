/**
 * ============================================================================
 * 파일명: client/js/marine-life/safety/life_safety.js
 * 역할  : "해양안전생활" 화면 — 하단 메인 탭 4개 중 세 번째 정식 탭이다(2026-09-10 사용자 확정.
 *         그 전까지는 하단 "해양생활" 탭을 10번 연달아 눌러야 열리는 숨은 화면이었다).
 *         하위탭 [해양안전 | 해양생활] 중 해양생활 쪽은 6개 활동(바다낚시·서핑·
 *         해수욕·스킨스쿠버·갯벌체험·바다갈라짐)을 화면 오른쪽 세로 버튼으로 갈아끼우며,
 *         배경지도(기본맵·전자해도·해안도·세계지도)를 해양종합정보와 같은 방식으로 고른다.
 *         여기에 더해 위성지도(브이월드)는 시험 단계라 이 화면에서만 고를 수 있다.
 *         탭이 새로 생긴 것을 알리는 빨간 N 배지도 여기서 붙인다(배포일 포함 3일간만).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : ocean-map/map/ocean_map.js(window.oceanCreateKhoaLayer — 해아름 WMS 레이어,
 *                    window.oceanCreateVworldLayer — 브이월드 위성지도 레이어),
 *                    shared/ui/ui_modal.js(window.showSeagnalModal — 안내 팝업),
 *                    marine-life/*(fishing·surfing·scuba·mudflat·sea_parting·swimming — 활동 로직 그대로 재사용),
 *                    forecast/alerts/marine.js(TAB_GROUP_SUBTABS·SECTION_TO_GROUP·switchSubTab)
 *  - 서버 API      : 없음 (활동별 데이터 호출은 각 활동 모듈이 기존대로 담당)
 *  - 마크업        : index2.html 의 #ocean-safety-section, #ocean-safety-sub-tabs,
 *                    #ls-topleft-controls, #ls-rail,
 *                    .main-tabs .tab-btn[data-target="ocean-life-group"](N 배지를 붙이는 탭) ·
 *                    style.css 의 .new-badge(공지사항 탭과 같은 배지 스타일)
 *  - 나를 쓰는 곳  : 없음 — 앱이 뜨면 스스로 이 화면의 표시 규칙(body.ls-mode)을 켠다
 * [로드 순서] js/core/index2_patch.js 다음 — index2_patch 가 감싼 switchMainTab/
 *             switchSubTab 위에 한 겹 더 얹어야 하므로 반드시 그 뒤 · 순서 변경 금지
 * ============================================================================
 */

(function () {
    'use strict';

    // ========================================================================
    // 상수
    // ========================================================================

    /**
     * 오른쪽 세로 버튼(레일)에 올릴 활동 목록.
     *  - id      : 기존 섹션 DOM id (그대로 재사용)
     *  - label   : 버튼에 쓰는 글자 (아이콘 없이 텍스트만)
     *  - gpsBtn  : 그 활동이 이미 갖고 있는 "내 위치" 버튼 id (없으면 null)
     *  - getMap  : 그 활동의 OpenLayers 지도 인스턴스를 얻는 함수 (지도 없는 활동은 null)
     * [주의] 이안류(ripcurrent)는 현재 하위탭에서도 숨김 상태라 여기서도 뺀다.
 * [2026-09-10] 너울(swell) 추가 — 마커가 아니라 해안선 자체를 색칠하는 지도라
 *   바텀시트가 없지만, 레일에서 고르고 배경지도를 바꾸는 방식은 다른 활동과 같다.
     */
    var ACTIVITIES = [
        { id: 'fishing-section',     label: '바다낚시',   gpsBtn: 'fishing-my-location-btn', pub: 'fishing-publish-time', getMap: function () { return window.getFishingMap && window.getFishingMap(); } },
        { id: 'surfing-section',     label: '서핑',       gpsBtn: 'surfing-my-location-btn', pub: 'surfing-publish-time', getMap: function () { return (window._surfing && window._surfing.map) || null; } },
        { id: 'swimming-section',    label: '해수욕',     gpsBtn: 'swim-my-location-btn',    pub: 'swim-publish-time',    getMap: function () { return window.getSwimmingMap && window.getSwimmingMap(); } },
        { id: 'scuba-section',       label: '스킨스쿠버', gpsBtn: 'scuba-my-location-btn',   pub: 'scuba-publish-time',   getMap: function () { return window.getScubaMap && window.getScubaMap(); } },
        { id: 'mudflat-section',     label: '갯벌체험',   gpsBtn: 'mudflat-my-location-btn', pub: 'mudflat-publish-time', getMap: function () { return window.getMudflatMap && window.getMudflatMap(); } },
        { id: 'sea-parting-section', label: '바다갈라짐', gpsBtn: null,                      pub: 'sp-publish-time',      getMap: null },
        { id: 'swell-section',       label: '너울',       gpsBtn: 'swell-my-location-btn',   pub: 'swell-publish-time',   getMap: function () { return window.getSwellMap && window.getSwellMap(); }, basemap: 'vworld' }
    ];
    // basemap 을 적은 활동은 그 활동을 보는 동안만 그 배경지도를 쓴다(사용자 확정 2026-09-10).
    //   너울은 해안 지형(만·곶·방파제)과 견줘 봐야 뜻이 통하는데 기본맵에는 지형이 없다.
    //   벗어나면 사용자가 고른 배경(_userBase)으로 돌아간다.

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

    // [2026-09-10] 해양안전생활이 정식 탭이 되어 "잠금해제"라는 개념이 없어졌다.
    //   이 값은 아래 _syncChrome()·switchMainTab 래퍼가 "이 화면 규칙을 적용할지" 판단하는
    //   스위치로만 남는다(항상 켜짐). 지우지 않는 이유는 그 두 곳의 조건문을 그대로 두어
    //   변경 범위를 좁히기 위해서다.
    var _unlocked = true;
    var _currentAct = 'fishing-section';  // 현재 보고 있는 활동 섹션 id
    var _currentBase = 'rltm';  // 지금 화면에 보이는 배경지도 종류
    var _userBase = 'rltm';     // 사용자가 마지막으로 직접 고른 배경지도
                                //   (활동 전용 배경을 쓰다 벗어날 때 여기로 돌아간다)
    var _lastView = null;       // 활동을 바꿔도 지도 위치가 이어지도록 기억 {center, zoom}
    var _decorated = [];        // 배경지도 레이어를 이미 끼워 넣은 지도 목록(중복 방지)
    var _suspended = [];        // 해양안전 진입 때 잠시 꺼둔 해양종합정보 오버레이 버튼들

    // ========================================================================
    // 1. 화면 준비 — 해양안전생활은 정식 탭이다
    // ========================================================================

    /**
     * 이 화면의 표시 규칙(body.ls-mode)을 켠다.
     * 예: 앱이 뜨면 곧바로 호출되어, 해양생활 활동 화면이 자기 컨트롤 대신
     *     이 화면의 오른쪽 세로 레일(#ls-rail)을 쓰도록 만든다.
     * [연계] → index2.html 의 body.ls-mode / body.ls-mode.ls-life 규칙
     *
     * ⚠[2026-09-10] 예전에는 하단 "해양생활" 탭을 3초 안에 10번 눌러야 이 화면이 열렸다
     *   (숨은 기능). 사용자 확정으로 정식 탭이 되면서 연타 트리거를 없앴고, 탭 이름
     *   ("해양안전생활")과 하위탭 바([해양안전 | 해양생활]), 먼저 열리는 하위탭(해양안전)은
     *   각각 index2.html 과 marine.js 의 기본값으로 옮겼다 — 그래야 화면이 뜬 뒤 자바스크립트가
     *   이름을 바꿔 다는 깜빡임이 없다.
     */
    function _enableSafetyChrome() {
        document.body.classList.add('ls-mode');
    }

    // ── 신규 표시(N) — 하단 "해양안전생활" 탭 [사용자 확정 2026-09-10] ──────────
    //   탭이 새로 생긴 것을 알리려고, 공지사항 탭이 새 글에 붙이는 것과 똑같은
    //   빨간 N 배지(.new-badge)를 배포일 포함 3일간만 붙인다.
    //   공지사항(promo.js)은 "글이 올라온 지 하루가 지났나"를 매번 따져 붙였다 뗐다
    //   하지만, 여기서 붙이는 이유는 "탭이 새로 생겼다" 하나뿐이라 끝나는 시각만
    //   상수로 둔다 — 그 시각이 지나면 이 함수는 아무것도 하지 않는다(코드는 남지만
    //   화면에는 안 나온다).
    //   2026-09-12 24:00 KST = 2026-09-12 15:00 UTC.
    var NEW_BADGE_UNTIL = Date.UTC(2026, 8, 12, 15, 0, 0);

    /**
     * 하단 "해양안전생활" 탭에 빨간 N 배지를 붙인다(3일 지나면 안 붙임).
     * 예: 2026-09-11 에 앱을 켜면 "해양안전생활" 글자 옆에 N 이 붙고,
     *     2026-09-13 에 켜면 아무것도 안 붙는다.
     * [연계] → index2.html 의 .new-badge 스타일(공지사항 탭과 공용) ·
     *          .main-tabs .tab-btn[data-target="ocean-life-group"]
     */
    function _markNewBadge() {
        if (Date.now() >= NEW_BADGE_UNTIL) return;
        var btn = document.querySelector('.main-tabs .tab-btn[data-target="ocean-life-group"]');
        if (!btn || btn.querySelector('.new-badge')) return;
        var badge = document.createElement('span');
        badge.className = 'new-badge';
        badge.textContent = 'N';
        // 라벨 span 안에 넣어야 탭 높이가 안 늘어난다(promo.js 와 같은 이유 —
        // 버튼 직접 자식으로 붙이면 아이콘·라벨 아래 3번째 줄로 쌓여 탭이 잘린다).
        (btn.querySelector('.tab-btn-label') || btn).appendChild(badge);
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
        // 해양종합정보에서 열어 둔 상세정보 팝업(#seagnal-custom-modal)도 같이 넘어오지
        // 않게 닫는다 — CCTV·출입통제 등 여러 버튼이 이 팝업을 공용으로 쓰는데, 바텀시트와
        // 달리 이 팝업엔 body.ls-safety 로 숨기는 CSS 규칙이 없어 그대로 남아 있었다.
        if (typeof window.closeSeagnalModal === 'function') window.closeSeagnalModal();

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
        // 역방향도 마찬가지 — 해양안전에서 열어 둔 팝업이 해양종합정보로 그대로 넘어오지 않게
        if (typeof window.closeSeagnalModal === 'function') window.closeSeagnalModal();
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
        // 사용량 집계도 함께 막는다 — 여기서 누르는 버튼은 사용자가 누른 게 아니라
        // 화면 전환 복원이므로(사용자 확정 2026-09-10 "해양종합정보 탭 자체는 세지 않는다").
        var run = window.withUsageSuppressed || function (f) { f(); };
        try { run(fn); } finally { window._showOceanToast = orig; }
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
     * 예: 특보구역을 켠 채로 해양안전에 들렀다 돌아오면 그대로 다시 켜져 있음
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
        // 해양안전에서 열어 둔 팝업(#seagnal-custom-modal)이 진짜 해양종합정보로 그대로
        // 넘어오지 않게 닫는다 — _enterSafety() 의 반대 방향 누락분
        if (typeof window.closeSeagnalModal === 'function') window.closeSeagnalModal();
    }

    /**
     * 지점 팝업(바텀시트)이 열렸는지 지켜보다가 body 에 ls-sheet-open 클래스를 붙인다.
     * 팝업은 활동 섹션 안에 있어 바깥에 뜬 우측 레일보다 위로 올라올 수 없으므로,
     * 팝업이 열린 동안에는 레일을 감춰 닫기 버튼이 가리지 않게 한다.
     * [연계] → index2.html 의 body.ls-sheet-open 규칙 (#ls-rail 숨김)
     */
    function _watchBottomSheets() {
        // ★[2026-09-11] 사고 통계 시트를 이 목록에 넣었다. 이 시트는 버튼 묶음보다
        //   위층(z-index 70 vs 50)이라 열려 있는 동안 버튼이 눌리지 않는데, 그 사실을
        //   화면이 몰라 "버튼이 갑자기 안 눌린다"로 나타났다(사용자 보고).
        //   ⚠이 시트만 열림 표시가 'active' 가 아니라 'open' 이다 — 아래 _sync 참고.
        var ids = ['fishing-bottomsheet', 'mudflat-bottomsheet', 'scuba-bottomsheet',
                   'rip-bottomsheet', 'surfing-popup', 'swim-bottomsheet',
                   'accident-stats-sheet'];
        var els = [];
        for (var i = 0; i < ids.length; i++) {
            var el = document.getElementById(ids[i]);
            if (el) els.push(el);
        }
        if (!els.length || typeof MutationObserver === 'undefined') return;

        function _sync() {
            var open = false;
            for (var j = 0; j < els.length; j++) {
                // 활동 시트는 'active', 사고 통계 시트는 'open' 으로 열림을 표시한다.
                if (els[j].classList.contains('active') || els[j].classList.contains('open')) { open = true; break; }
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
     * 활동의 지도에 배경지도 5종을 준비하고, 직전 활동의 위치를 이어받는다.
     * 활동에 전용 배경지도(ACTIVITIES 의 basemap)가 있으면 그것을 켠다 — 너울이 그렇다.
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
            // 활동에 전용 배경지도가 있으면 그것, 없으면 사용자가 고른 배경으로 돌린다.
            _applyBasemap(act.basemap || _userBase);
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
     * [연계] ← 좌측 상단 배경지도 메뉴 클릭(그때는 _userBase 도 함께 바뀐다)
     *          / _prepareMap() 진입 시 — 활동 전용 배경 또는 _userBase 재적용
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
            { id: 'swimming', label: '해수욕',     html: _pickHtml('#swim-disclaimer') },
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
     * 해양안전 화면(물빠짐·노출암/간출암·CCTV·낚시금지·관제구역·항로·항행경보) 전용 안내 팝업 본문(탭바 + 패널)을 만든다.
     * 해양종합정보의 17탭 안내와 같은 방식으로, 이 화면에 있는 기능만 탭으로 보여준다.
     * @returns {string} 팝업에 넣을 HTML
     * [연계] ← window.oceanInfoTabHtml() (ocean_cctv.js) — 탭 본문을 그대로 재사용
     *          (낚시금지·관제구역·항로·항행경보는 해양종합정보에 없는 기능이라 공용 목록 대신 여기서 html 로 직접 넣는다)
     *          → index2.html 의 .ocean-info-tabs/.ocean-info-panel/.ocean-info-src CSS, window.__lsInfoSwitch
     */
    function _buildSafetyInfoHtml() {
        // [탭 = 이 화면의 버튼 — 2026-09-09 사용자 확정]
        //   순서·이름·내용을 화면 버튼(위험지형→사고정보→금지구역→항행경보→물빠짐→CCTV→
        //   관제구역→항로·해역)과 똑같이 맞춘다. 예전에는 물빠짐·CCTV·노출암간출암 본문을
        //   해양종합정보 안내(window.oceanInfoTabHtml)에서 빌려 썼는데, 두 화면의 동작이
        //   서로 달라(해양종합정보에는 그 버튼이 이제 아예 없다) 여기서 따로 쓴다.
        var items = [
            // 위험지형[S28, 2026-09-09] — 옛 "노출암·간출암" 두 버튼이 하나로 합쳐졌고
            //   갯바위(면)가 새로 생겼으며 동해는 잠김경고에서 빠졌다.
            { id: 'hazardrock', label: '위험지형', html:
                '<p><i class="fa-solid fa-circle-check"></i> <strong>「위험지형」 버튼 하나로</strong> 바다 위·물속의 바위를 함께 표시합니다. 켜면 화면 왼쪽 위에 <strong>「노출암/갯바위」</strong>와 <strong>「간출암, 암암 등」</strong> 스위치가 생겨 원하는 것만 골라 볼 수 있습니다.</p>'
              + '<p><i class="fa-solid fa-circle-check"></i> <strong>노출암</strong>(4,287개) — 썰물 때도 늘 물 위에 드러나 있는 바위입니다. <strong>갯바위</strong>(9,959곳)는 해안을 따라 이어진 바위 지대를 <strong>면으로</strong> 그립니다. 갯바위 안에 들어 있는 노출암 475개는 표시가 겹치지 않도록 <strong>갯바위로만</strong> 보여줍니다.</p>'
              + '<p><i class="fa-solid fa-circle-check"></i> <strong>간출암</strong>(1,778개) · <strong>세암</strong>(658개) · <strong>암암</strong>(106개) — 물때에 따라 드러났다 잠겼다 하거나 늘 물속에 있는 바위입니다. 마커를 누르면 종류와 <strong>썰물 때 드러나는 높이</strong>를 확인할 수 있습니다.</p>'
              + '<p><i class="fa-solid fa-circle-check"></i> 바위가 많은 곳은 <strong>숫자로 뭉쳐</strong> 보이다가, 확대하면 낱개 마커로 펼쳐집니다.</p>'
              + '<p><i class="fa-solid fa-circle-check"></i> <strong>잠김 경고</strong> — 간출암이 밀물에 완전히 잠기기 <strong>3시간 전부터</strong> 마커 테두리가 빨갛게 깜빡이고 남은 시간이 표시됩니다. 마커가 뭉쳐 있는 동안에도 그 안에 잠기는 바위가 있으면 <strong>뭉친 원 둘레가 빨갛게</strong> 됩니다(그 안 어느 바위의 시각인지 가릴 수 없어 시간은 적지 않습니다).</p>'
              + '<p><i class="fa-solid fa-circle-check"></i> 버튼을 켜면 실제 지형과 비교하기 쉽도록 <strong>배경지도가 위성지도로 자동 전환</strong>되고, 끄면 원래 배경지도로 돌아갑니다.</p>'
              + '<p><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> <strong>동해는 잠김 경고를 제공하지 않습니다.</strong> 동해는 밀물·썰물의 차가 작아 잠기는 시각을 믿을 만큼 계산하기 어려워 제외했습니다(바위 표시와 조석 곡선은 그대로 나옵니다).</p>'
              + '<p><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> 예측 자료이므로 실제 현장의 물때·기상 상황을 반드시 직접 확인하세요.</p>'
              + '<div class="ocean-info-src">최종 갱신일자 · 전자해도 2026-08 배포본<br>출처 · 국립해양조사원 전자해도(노출암·갯바위·간출암·세암·암암) · 조석예측자료(TideBED) · 연간 조석표</div>' },
            // 사고정보[S28-6·S28-8] — 틀은 사용자가 지정했다: ①목적 ②사용법·구성 ③데이터 산출 내역.
            //   ★숫자는 전부 원본 파일을 세어 확인한 값이다(추측 없음).
            //     근거는 accident_stats_sheet.design.md 작업 19-2 참고.
            { id: 'accident', label: '사고정보', html:
                '<p><strong>1. 목적</strong></p>'
              + '<p><i class="fa-solid fa-circle-check"></i> 우리 바다에서 <strong>실제로 어떤 사고가, 어디서, 얼마나</strong> 일어났는지 지도에서 바로 확인할 수 있게 합니다. 사고가 잦은 해역과 시기를 미리 알고 <strong>활동 계획에 참고</strong>하시라고 만들었습니다.</p>'
              + '<p><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> 지나간 사고 기록입니다. <strong>지금의 위험을 예보하는 기능이 아닙니다.</strong></p>'
              + '<p><strong>2. 사용법 · 구성</strong></p>'
              + '<p><i class="fa-solid fa-circle-check"></i> 버튼을 켜면 화면 왼쪽 위에 <strong>[분석 · 현황]</strong> 토글이 생깁니다.</p>'
              + '<p><i class="fa-solid fa-circle-check"></i> <strong>현황</strong> — 사고 한 건마다 마커를 찍습니다. 가까운 것끼리 묶여 숫자로 보이고, 확대하면 갈라집니다. 마커를 누르면 발생일·사고유형·위치·관할서를 볼 수 있습니다.</p>'
              + '<p><i class="fa-solid fa-circle-check"></i> <strong>분석</strong> — 지도를 격자로 나눠 <strong>칸 색으로 사고 건수</strong>를 보여줍니다(파랑=적음 → 빨강=많음). 칸을 누르면 <strong>통계 시트</strong>가 열리고, <strong>전국 통계</strong> 버튼으로 전국 기준을 볼 수 있습니다.</p>'
              + '<p><i class="fa-solid fa-circle-check"></i> 시트에서 <strong>전체 / 선박사고 / 인명사고</strong>를 고를 수 있고, 사고유형·기간·관할서·시간대·특보 <strong>5가지 필터</strong>를 걸 수 있습니다. 특보 종류별 타일에는 <strong>선박·인명 건수가 나뉘어</strong> 함께 표시됩니다(「전체」를 골랐을 때).</p>'
              + '<p><i class="fa-solid fa-circle-check"></i> 시트 카드 7개 — ①추세 요약 ②연도별 추이(월별·시간대별·요일별·관할서별로 전환) ③특보 중 사고 ④상위 발생 유형 ⑤주요 발생 원인 ⑥선박 종류별 ⑦사망·실종 발생률. ③번 카드의 <strong>사고 내역 보기</strong>로 특보 중 사고를 한 건씩 훑어볼 수 있습니다.</p>'
              + '<p><strong>3. 데이터 산출 내역</strong></p>'
              + '<p><i class="fa-solid fa-circle-check"></i> <strong>들어간 자료</strong> — 국립해양조사원 개방海의 <strong>선박사고(해경)</strong>와 <strong>인명사고</strong> 두 종류입니다. 선박사고 2008~2025년 <strong>57,167건</strong> + 인명사고 2009~2024년 <strong>14,325건</strong> = <strong>71,492건</strong>.</p>'
              + '<p><i class="fa-solid fa-circle-check"></i> <strong>빠진 자료</strong> — 원본 74,018건 중 2,526건(3.4%)을 뺐습니다. <strong>347건</strong>은 선체결함·속구손상·시설물손상·조난으로, 지도에 쓸 아이콘이 없어 제외했습니다. <strong>2,179건</strong>은 좌표가 잘못 들어간 사고(같은 위치인데 33km 이상 떨어진 것)와, 위치가 기록되지 않아 관할 해양경찰서 청사 좌표로 채워진 사고입니다 — 실제 사고 지점이 아니라 뺐습니다.</p>'
              + '<p><i class="fa-solid fa-circle-check"></i> <strong>선박 이름은 어떤 화면에도 없습니다.</strong> 원본에 그 칸 자체가 없습니다. <strong>어선·모터보트</strong> 같은 종류까지가 한계입니다.</p>'
              + '<p><i class="fa-solid fa-circle-check"></i> <strong>2024·2025년 선박사고는 위치 설명이 하나도 없습니다.</strong> 2025년은 사고 원인·선박 종류까지 3,775건 전부 비어 있습니다. 그래서 사고 내역에서 위치 설명 대신 <strong>좌표</strong>로 표시되는 경우가 많습니다.</p>'
              + '<p><i class="fa-solid fa-circle-check"></i> <strong>구조·사망·실종이 모두 0으로 기록된 선박사고가 절반가량</strong>입니다. 원본이 "아무도 안 다쳤다"와 "기록을 안 했다"를 구분하지 않아, 화면에는 <strong>인명피해 기록 없음</strong>으로 적습니다.</p>'
              + '<p><i class="fa-solid fa-circle-check"></i> <strong>특보 중 사고</strong>는 <strong>2016년 8월 26일 이후</strong>만 셉니다. 그 이전 특보 자료가 없어 분모에서 뺐습니다. 한 사고가 두 특보에 함께 걸린 경우가 있어, 특보 종류별 건수를 더하면 전체보다 조금 큽니다.</p>'
              + '<p><i class="fa-solid fa-circle-check"></i> <strong>사망·실종 발생률</strong>은 전국 자료로 냅니다. 인명피해가 통째로 기록되지 않은 <strong>2014·2015년</strong>, 해양오염, 표본이 아주 적은 유형, 성격상 비율이 높을 수밖에 없는 변사자·자살자는 순위에서 뺐습니다.</p>'
              + '<p><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> <strong>원본 자료 자체에 오류가 섞여 있을 수 있습니다.</strong> 위 좌표 오류처럼 눈에 띄는 것은 걸러냈지만, 발생일시·사고유형·인명피해 같은 값이 잘못 기록됐거나 누락된 경우까지 모두 가려낼 수는 없습니다. 통계 수치는 <strong>참고용</strong>으로 보시고, 공식 통계나 법적 근거가 필요할 때는 국립해양조사원·해양경찰청 원자료를 확인하세요.</p>'
              + '<div class="ocean-info-src">출처 · 국립해양조사원 개방海(선박사고·인명사고) · 기상청 특보 이력</div>' },
            // 금지구역[S28-3] — 낚시금지 · 출입통제를 한 버튼으로 합쳤고, 범례에서 따로 켤 수 있다.
            { id: 'banzone', label: '금지구역', html:
                '<p><i class="fa-solid fa-circle-check"></i> 버튼 하나로 <strong>낚시금지구역</strong>과 <strong>출입통제구역</strong>을 함께 표시합니다. 둘 다 "여기서는 하면 안 된다"는 뜻의 구역입니다.</p>'
              + '<p><i class="fa-solid fa-circle-check"></i> 켜면 화면 왼쪽 위에 <strong>범례</strong>가 나타납니다. 「출입통제구역」·「낚시금지구역」 스위치로 <strong>한 종류만 골라</strong> 볼 수도 있습니다.</p>'
              + '<p><i class="fa-solid fa-circle-check"></i> <strong>낚시금지구역</strong>(236곳) — 낚시 관리 및 육성법 제6조와 지자체 조례에 따라 낚시가 금지되거나 제한된 구역입니다. <strong>주황색</strong>으로 표시합니다.</p>'
              + '<p><i class="fa-solid fa-circle-check"></i> <strong>출입통제구역</strong>(39곳) — 연안사고 예방에 관한 법률 제10조에 따라 각 해양경찰서가 지정한 구역입니다. <strong>빨간색</strong>으로 표시합니다.</p>'
              + '<p><i class="fa-solid fa-circle-check"></i> 구역을 누르면 위치, 지정 사유, 통제 기간·시간, 대상, 벌칙, 고시번호 등 상세 정보를 확인할 수 있습니다. 켜면 실제 지형과 비교하기 쉽도록 <strong>배경지도가 위성지도로 자동 전환</strong>됩니다.</p>'
              + '<p><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> 낚시금지구역은 국립해양조사원이 파악한 구역만, 출입통제구역은 원본 고시·공고에 <strong>경위도 좌표가 온전히 적힌 구역만</strong> 반영되어 있습니다(나머지는 원본에 손그림 경계선만 있어 확정할 수 없었습니다). 최신 지정 현황과 다를 수 있으니 실제 활동 전에는 현장 안내판이나 관할 지자체·해양경찰서 공고를 꼭 확인하세요.</p>'
              + '<div class="ocean-info-src">최종 갱신일자 · 낚시금지 2025-12-12 · 출입통제 2026-09-10<br>출처 · 국립해양조사원 낚시통제구역 주제도 · 각 해양경찰서 고시·공고</div>' },
            { id: 'navwarn', label: '항행경보', html:
                '<p><i class="fa-solid fa-circle-check"></i> 선택한 날짜에 발효 중인 항행경보(선박사고·표류장애물·수중장애물·해상사격훈련 등)의 구역을 지도 위에 진한 빨간 점선 원형/다각형으로 표시합니다. 켜면 배경지도가 위성지도로 자동 전환됩니다. 같은 구역이 시간대만 다르게 여러 번 있으면 하나로 합쳐 라벨이 겹치지 않게 표시합니다.</p>'
              + '<p><i class="fa-solid fa-circle-check"></i> 상단 날짜 내비게이션(◀▶)으로 다른 날짜를 조회하고, 하단 기준 시각 슬라이더로 그 날짜의 특정 시각을 지정하면 이미 시각이 지난 구역은 회색으로 바뀌고 라벨도 사라집니다(활성 구역만 라벨 표시, 겹치면 큰 구역 우선). 슬라이더 위치는 날짜를 넘겨도 그대로 유지됩니다.</p>'
              + '<p><i class="fa-solid fa-circle-check"></i> 구역이 화면에서 작게 보일 때 누르면 먼저 그 구역으로 확대되고, 충분히 커진 뒤 다시 누르면 팝업이 뜹니다. 팝업엔 그 구역의 시간대별 내용이 구분돼 표시됩니다(구분, 발표기관, 유효기간, 근거, 본문 — 이미 끝난 시간대는 흐리게 "종료" 표시).</p>'
              + '<p><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> 좌표는 국립해양조사원 "항행경보 상황판" 자료를 보강해 표시한 것으로, 정식 항행경보 원문과 다를 수 있습니다. 실제 항해 시에는 반드시 항행경보 상황판(khoa.go.kr/nwb)이나 수로도서지 원문을 확인하세요.</p>'
              + '<div class="ocean-info-src">갱신 주기 · 30분<br>출처 · 국립해양조사원 항행경보</div>' },
            // 물빠짐 — 해양종합정보에서 빌려 쓰던 문구를 이 화면용으로 옮겨 적었다
            //   (그 화면에는 이제 물빠짐 버튼이 없어 "다른 기상 기능이 꺼진다"는 문장이 맞지 않는다).
            { id: 'mudflat', label: '물빠짐', html:
                '<p><i class="fa-solid fa-circle-check"></i> 서해·남해 갯벌 해안을 대상으로, 간조 시 물이 얼마나 빠지는지를 미리 예측해 지도 위에 <strong>갈색</strong>으로 표시합니다.</p>'
              + '<p><i class="fa-solid fa-circle-check"></i> 하단 슬라이더로 오늘부터 <strong>3일치 예측을 1시간 단위</strong>로 확인하고, 재생(▶) 버튼으로 시간 흐름에 따른 갯벌 노출·침수 변화를 자동으로 볼 수 있습니다.</p>'
              + '<p><i class="fa-solid fa-circle-check"></i> 갈색으로 표시된 갯벌 지점을 누르면, <strong>물이 다시 차기까지 남은 예측 시간</strong>과 예측 기준 시각을 확인할 수 있습니다.</p>'
              + '<p><i class="fa-solid fa-circle-check"></i> 정확도를 높이기 위해, 조위 기준면은 서해·남해 표준항 <strong>128곳</strong>으로 맞추고, 시간별 물빠짐은 연안 임의해점 <strong>315곳</strong>의 조석 예측 자료로 채워 표시합니다.</p>'
              + '<p><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> 예측 자료이므로 실제 현장의 기상·해양 상황을 반드시 직접 확인하세요. <strong>동해와 제주 해역은 제공되지 않습니다.</strong></p>'
              + '<p><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> 다수 해점 자료를 동시에 처리하므로 지도 표시에 약간의 시간이 걸릴 수 있습니다.</p>'
              + '<div class="ocean-info-src">출처 · 국립해양조사원 · 표준항 128곳(기준면) · 수심측량자료(BADA2024) · 조석예측자료(TideBed, 임의해점 315곳)</div>' },
            { id: 'cctv', label: 'CCTV', html:
                '<p><i class="fa-solid fa-circle-check"></i> 어항 안전상태와 해상 기상현황을 눈으로 확인할 수 있도록, 공공에 공개된 해안 CCTV 영상을 보여줍니다. <strong>본 앱은 영상을 수집·저장하지 않습니다.</strong></p>'
              + '<p><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> 옹진군 CCTV의 지도 위치는 명칭·지명을 참고해 수기로 배치한 것으로, 실제 설치 위치와 다를 수 있습니다.</p>'
              + '<p><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> 영상 정보의 정확성과 이를 활용함에 따른 민·형사상 법적 책임은 정보활용 주체에 있으며, 정보 제공주체 및 본 앱은 이에 대한 책임을 지지 않습니다.</p>'
              + '<div class="ocean-info-src">출처 · 지자체(부산·거제·옹진) · 해양수산부 연안포털 · KBS 재난센터</div>' },
            { id: 'vts', label: '관제구역', html:
                '<p>해양경찰청이 공고한 선박교통관제구역(VTS)을 지도 위에 남색(인디고)으로 표시하며, 명칭에 실제 관제채널(예: Ch. 09)이 함께 표기됩니다.</p>'
              + '<p>버튼을 켜면 배경지도가 전자해도로 자동 전환됩니다. 끄면 원래 배경지도로 돌아갑니다.</p>'
              + '<p>구역을 누르면 관제해역 설명, 관제센터 주소·전화·팩스를 확인할 수 있고, 누른 구역은 노란색으로 표시되어 어디를 선택했는지 알 수 있습니다.</p>'
              + '<p><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> 실제 통항 시 정확한 관제채널과 신고 절차는 관할 관제센터로 문의하세요.</p>'
              + '<div class="ocean-info-src">최종 갱신일자 · 2026-08-03<br>출처 · 해양경찰청 전국 VTS센터 공고자료</div>' },
            { id: 'seaway', label: '항로·해역', html:
                '<p>해상교통안전법 등에 따라 지정된 항로(통항분리대·통항분리수역·지정항로·주의해역·선회장 등)는 마젠타색으로, 한중·한일 간 국제 해양경계 수역은 선홍색으로 지도 위에 구분해 표시합니다.</p>'
              + '<p>버튼을 켜면 실제 항로·해역과 비교하기 쉽도록 배경지도가 전자해도로 자동 전환됩니다. 끄면 원래 배경지도로 돌아갑니다.</p>'
              + '<p>항로를 누르면 항로명, 종류(통항분리대/통항분리수역 등), 근거·참고 문서를 확인할 수 있습니다. 한중잠정조치수역·한일중간수역·한중과도수역 등 국제 해양경계 수역을 누르면 정의, 근거, 담당부서·연락처까지 함께 확인할 수 있습니다.</p>'
              + '<p><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> 항로·수역 종류에 따라 통항 방법과 적용 근거가 다르니, 실제 항해 전 관련 법령·고시·협정 원문을 반드시 확인하세요.</p>'
              + '<div class="ocean-info-src">최종 갱신일자 · 2026-08-11<br>출처 · 국립해양조사원 개방海(실시간 해양공간정보) · 해양수산부 한중·한일 어업협정</div>' },
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
                    _userBase = this.getAttribute('data-basemap');
                    _applyBasemap(_userBase);
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
    // 5-B. 해양안전 오버레이 단독 표출 (2026-09-09 사용자 확정)
    // ========================================================================

    /** 해양안전 화면 우측 버튼 8개 — 이 중 하나만 켜지게 한다. */
    var SOLO_BTN_IDS = [
        'ocean-terrain-toggle-btn',   // 위험지형
        'ocean-accident-toggle-btn',  // 사고정보
        'ocean-banzone-toggle-btn',   // 금지구역
        'ocean-navwarn-btn',          // 항행경보
        'ocean-mudflat-toggle-btn',   // 물빠짐
        'ocean-cctv-toggle-btn',      // CCTV
        'ocean-vts-toggle-btn',       // 관제구역
        'ocean-seaway-toggle-btn'     // 항로·해역
    ];
    var _soloBusy = false;   // 우리가 끄려고 누른 클릭이 다시 이 로직을 타지 않게 하는 빗장

    /**
     * 해양안전 오버레이 버튼을 "한 번에 하나만" 켜지도록 묶는다.
     * 예: 금지구역이 켜져 있을 때 위험지형을 누르면 → 금지구역이 먼저 꺼지고 위험지형만 켜진다
     *
     * 각 기능의 끄는 절차(폴리곤 정리·배경지도 복귀·폴링 중단)를 그대로 쓰려고
     * **그 버튼을 대신 눌러서** 끈다. 새로 켜는 클릭보다 먼저 처리해야 하므로
     * 캡처 단계에서 듣는다(끄기 → 그 다음 원래 리스너가 자기를 켠다).
     * 이미 켜져 있는 버튼을 다시 눌러 끄는 경우에는 아무것도 하지 않는다.
     * [연계] ← DOMContentLoaded → 각 모듈의 원래 토글 리스너(대신 클릭으로 호출)
     */
    function _bindSoloOverlays() {
        SOLO_BTN_IDS.forEach(function (id) {
            var btn = document.getElementById(id);
            if (!btn) return;
            btn.addEventListener('click', function () {
                if (_soloBusy) return;
                // 지금 꺼져 있는 버튼을 누른 경우에만(= 새로 켜려는 경우) 나머지를 끈다
                if (btn.classList.contains('active')) return;
                _soloBusy = true;
                try {
                    SOLO_BTN_IDS.forEach(function (otherId) {
                        if (otherId === id) return;
                        var other = document.getElementById(otherId);
                        if (other && other.classList.contains('active')) other.click();
                    });
                } finally {
                    _soloBusy = false;
                }
            }, true);   // ★캡처 단계 — 원래 토글 리스너보다 먼저 실행돼야 한다
        });
    }

    // ========================================================================
    // 6. 초기화
    // ========================================================================

    document.addEventListener('DOMContentLoaded', function () {
        _enableSafetyChrome();
        _markNewBadge();
        _bindControls();
        _wrapTabSwitchers();
        _watchMudflatToggle();
        _watchBottomSheets();
        _bindSoloOverlays();
    });

})();
