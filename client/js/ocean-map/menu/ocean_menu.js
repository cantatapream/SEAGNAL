/**
 * ============================================================================
 * 파일명: client/js/ocean-map/menu/ocean_menu.js
 * 역할  : 해양종합정보의 「새 모드」 — 지도 오른쪽 버튼 줄 대신 [메뉴] 버튼 하나와
 *         오른쪽에서 열리는 사이드바(즐겨찾기 · 해양기상정보 · 해양안전정보 · 해양생활지수)로
 *         모든 기능을 켜고 본다. 해양안전생활 탭의 화면들도 여기서 [보기]로 연다.
 *         평소에는 아무것도 하지 않고, 아래 「해양종합정보」 탭을 3초 안에 10번 누르면 켜진다
 *         (앱을 껐다 켜면 원래 화면 — 저장하지 않는다).
 * ----------------------------------------------------------------------------
 * [사용자 확정 2026-11-22 — 원문]
 *  「수정한 화면에 대해서는 해양종합정보 탭 버튼을 10회 클릭하는 것으로 트리거가 작동하여 수정된 인터페이스가 나오도록」
 *  「앱을 껏다 켜면 원래대로 돌아가도록 하고 다시 10회 눌러야 해당 화면으로 가지도록」「모두 숨기자」
 *  「남은 지도부분은 어둡게 처리할 필요 없음」「사이드바가 닫히는 것으로」(열린 채 지도를 누르면)
 *  「"고정"을 즐겨찾기로 변경」「"해양생활정보" 는 "해양생활지수"로 바꾸자」
 *  「○○ 화면 표출 중 해양기상정보는 표시되지 않습니다. [끄기](버튼형태)」「가안이 좋겠어」(지도 밖 맨 위 한 줄)
 *  「가) 스위치는 바뀌지만 지도에는 [끄기] 뒤에 반영됩니다 … 좋아」「닫아」([보기]를 누르면 사이드바)「숨겨」(보는 동안 CCTV)
 *  「특보구역현황은 파고, 풍향속, 유향속 등과 병존하여 표출될 수 없음」
 *  「기본적으로는 "파고·풍향·유향·특보구역·현황"의 기준으로 하되 태풍, 해구기상이 켜진다면 태풍과 해구기상 배경 지도를 우선으로 적용」
 *  「아무것도 그리지 말고, 사용자가 선택하도록 하자 … 비활성화 상태로 두고, 또한 순서도 맨 뒤로 … 기온, 강수량, 강수형태,
 *    강수확률, 적설, 하늘상태, 시정 예측 순」(천기)
 *  「최초 단계 … 모두 펼쳐진 상태로. 단, 이후 사용자가 접고 펴고 선택한 그런 이력이 있다면 그 이력을 저장」
 *  「해양종합정보 탭을 들어왔을 때 기준으로 받아와. 사이드바를 열기 전 기준」(해수욕 개장 정보)
 * ----------------------------------------------------------------------------
 * [만드는 방식 — 기존 기능을 옮기지 않고 「대신 눌러 준다」]
 *  사이드바의 줄은 지도 오른쪽 버튼 줄(#ocean-overlay-controls)의 **원래 버튼을 대신 누른다**(.click()).
 *  켜짐 표시도 그 버튼의 .active 를 읽는다. [보기]는 지금의 해양안전생활 화면(life_safety.js)으로 실제로
 *  이동한 뒤 그 화면의 버튼을 눌러 준다 — 그래서 「기상정보를 숨겼다가 [끄기]에 되살리기」는 그 화면이
 *  이미 하는 일(_suspendOceanOverlays/_restoreOceanOverlays)을 그대로 쓴다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : marine-life/safety/life_safety.js(window._lsDropParkedSafety · 탭 전환 래퍼 · 단독 표출),
 *                    forecast/alerts/marine.js + core/index2_patch.js(window.switchMainTab·switchSubTab),
 *                    core/backbutton.js(window.PopupStack — 뒤로가기로 사이드바/[보기] 닫기),
 *                    ocean-map/map/ocean_map.js(window.oceanGetBasemap·oceanSetBasemap),
 *                    typhoon/ocean_typhoon.js(window.OceanTyphoon.hasActive·isVisible),
 *                    ocean-map/layers/shrt_forecast_layer.js(window._shrtForecastHasFrames),
 *                    ocean-map/layers/vsby_forecast_layer.js(window.VsbyRaster.frames),
 *                    shared/ui/locate_toast.js(window.showLocateStyleNotice — 자료 없음 알림),
 *                    shared/utils/utils.js(window.withUsageSuppressed — 대신 누를 때 사용량 이중 집계 방지)
 *  - 서버 API      : GET /api/swimming-index (routes/fishing.js) — 개장 해수욕장 유무
 *  - 마크업        : index2.html 의 #ocean-overlay-controls 안 버튼들 · #ls-rail 의 갯바위/선상 ·
 *                    #accident-filter-bar · .tab-btn[data-target="ocean-map-section"] ·
 *                    이 파일이 body 끝에 만드는 #om-menu-btn · #om-subs · #om-banner · #om-backdrop · #om-sidebar
 *  - 스타일        : js/ocean-map/menu/ocean_menu.css (전부 body.om-mode 아래)
 *  - 나를 쓰는 곳  : 없음 — 스스로 탭 버튼의 10회 누름을 듣는다. 시험: local_server/scripts/test_ocean_menu_ui.js
 * [로드 순서] js/marine-life/safety/life_safety.js 다음(그 파일이 감싼 switchMainTab/switchSubTab 위에 한 겹 더 얹는다)
 *             · 순서 변경 금지
 * ============================================================================
 */
(function () {
    'use strict';

    // ========================================================================
    // 상수 — 사이드바에 올리는 기능 목록(순서 = 사용자가 순서판에서 정한 순서)
    // ========================================================================

    var TAP_THRESHOLD = 10;     // 「해양종합정보」 탭을 이만큼 누르면 새 모드가 켜지고 꺼진다
    var TAP_RESET_MS = 3000;    // 이 시간 안에 이어 눌러야 센다
    var LS_FAV = 'seagnal_ocean_menu_fav_v1';        // 즐겨찾기한 기능 id 목록
    var LS_CLOSED = 'seagnal_ocean_menu_closed_v1';  // 접어 둔 폴더 id 목록(없으면 = 처음 = 모두 펼침)

    /** 함께 켜질 수 없는 묶음 — 하나를 켜면 먼저 켠 것이 꺼진다 */
    var EXCLUSIVE = ['zone', 'wav', 'wind', 'cur', 'wx'];

    /** 스위치로 켜고 끄는 기능 — sel: 대신 누를 원래 버튼 */
    var SWITCHES = {
        zone:  { label: '특보구역·현황', sel: '#ocean-warn-zone-toggle-btn' },
        typh:  { label: '태풍', sel: '#ocean-typhoon-toggle-btn' },
        wav:   { label: '파고·파향', sel: '.ocean-overlay-btn[data-layer="wave"]' },
        wind:  { label: '풍향·풍속', sel: '.ocean-overlay-btn[data-layer="wind"]' },
        cur:   { label: '유향·유속', sel: '.ocean-overlay-btn[data-layer="current"]' },
        buoy:  { label: '기상부이', sel: '#ocean-buoy-toggle-btn' },
        grid:  { label: '해구기상', sel: '#ocean-marine-zone-toggle-btn' },
        wx:    { label: '천기', sel: null },
        cctv:  { label: 'CCTV', sel: '#ocean-cctv-toggle-btn' }
    };

    /** [보기]로 여는 화면 — screen:'safety'(해양안전 지도의 버튼 btns) | 'life'(활동 섹션 section) */
    var VIEWS = {
        navw:      { label: '항행경보 현황', screen: 'safety', btns: ['ocean-navwarn-btn'] },
        risk:      { label: '위험예측', screen: 'safety', btns: ['ocean-risk-forecast-toggle-btn'] },
        accShip:   { label: '사고이력(선박)', screen: 'safety', btns: ['ocean-accident-toggle-btn'], accMode: 'status', accSrc: 'hk' },
        accPerson: { label: '사고이력(인명)', screen: 'safety', btns: ['ocean-accident-toggle-btn'], accMode: 'status', accSrc: 'person' },
        accStat:   { label: '사고분석', screen: 'safety', btns: ['ocean-accident-toggle-btn'], accMode: 'analysis' },
        terr:      { label: '위험지형', screen: 'safety', btns: ['ocean-terrain-toggle-btn'] },
        // base: 그 화면을 보는 동안 쓰는 배경지도 — 물빠짐 기능은 배경을 바꾸지 않으므로 여기서 맞춘다(2026-11-23 사용자 「위성지도를 기본 배경으로」)
        mud:       { label: '갯벌 수위 예측', screen: 'safety', btns: ['ocean-mudflat-toggle-btn'], base: 'vworld' },
        ban:       { label: '출입통제·낚시금지', screen: 'safety', btns: ['ocean-banzone-toggle-btn'] },
        vts:       { label: '관제구역·항로', screen: 'safety', btns: ['ocean-vts-toggle-btn', 'ocean-seaway-toggle-btn'] },
        fish:      { label: '바다낚시', screen: 'life', section: 'fishing-section' },
        surf:      { label: '서핑', screen: 'life', section: 'surfing-section' },
        scuba:     { label: '스킨스쿠버', screen: 'life', section: 'scuba-section' },
        swim:      { label: '해수욕', screen: 'life', section: 'swimming-section' },
        flat:      { label: '갯벌체험', screen: 'life', section: 'mudflat-section' },
        part:      { label: '바다갈라짐', screen: 'life', section: 'sea-parting-section' },
        swell:     { label: '너울', screen: 'life', section: 'swell-section' }
    };

    /** 폴더와 그 안의 줄 — kind: 'sw'(스위치) | 'view'([보기]) | 'label'(제목 줄) | 'pair'(버튼 둘) */
    var FOLDERS = [
        { id: 'wx', title: '해양기상정보', rows: [
            { kind: 'sw', id: 'zone' }, { kind: 'sw', id: 'typh' }, { kind: 'sw', id: 'wav' }, { kind: 'sw', id: 'wind' },
            { kind: 'sw', id: 'cur' }, { kind: 'sw', id: 'buoy' }, { kind: 'sw', id: 'grid' }, { kind: 'sw', id: 'wx' }
        ] },
        { id: 'safe', title: '해양안전정보', rows: [
            { kind: 'view', id: 'navw' }, { kind: 'view', id: 'risk' },
            { kind: 'label', id: 'accGroup', label: '사고발생 이력·분석' },
            { kind: 'pair', id: 'accHist', label: '사고이력', sub: true, pair: [['accShip', '선박'], ['accPerson', '인명']] },
            { kind: 'view', id: 'accStat', sub: true },
            { kind: 'view', id: 'terr' }, { kind: 'view', id: 'mud' }, { kind: 'view', id: 'ban' }, { kind: 'view', id: 'vts' },
            { kind: 'sw', id: 'cctv' }
        ] },
        { id: 'life', title: '해양생활지수', rows: [
            { kind: 'view', id: 'fish' }, { kind: 'view', id: 'surf' }, { kind: 'view', id: 'scuba' }, { kind: 'view', id: 'swim' },
            { kind: 'view', id: 'flat' }, { kind: 'view', id: 'part' }, { kind: 'view', id: 'swell' }
        ] }
    ];

    /** 천기 버튼 — 사용자가 정한 순서. shrt: 원래 버튼의 data-shrt(시정예측은 따로 id) */
    var WX_SUBS = [
        { id: 'tmp', label: ['기온'] }, { id: 'pcp', label: ['강수량'] }, { id: 'pty', label: ['강수', '형태'] },
        { id: 'pop', label: ['강수', '확률'] }, { id: 'sno', label: ['적설'] }, { id: 'sky', label: ['하늘', '상태'] },
        { id: 'vsby', label: ['시정', '예측'] }
    ];
    var WX_NO_DATA_MSG = '기상청 단기예보 데이터를\n일시적으로 불러올 수 없습니다.';

    // ========================================================================
    // 상태 — 전부 메모리(새 모드 자체는 저장하지 않는다). 즐겨찾기·접은 폴더만 localStorage.
    // ========================================================================

    var _mode = false;          // 새 모드가 켜져 있는가
    var _built = false;         // 화면 요소를 만들었는가
    var _open = false;          // 사이드바가 열려 있는가
    var _view = '';             // 지금 [보기]로 보고 있는 화면 id('' = 없음)
    var _pending = null;        // [보기] 중 스위치 상태 {id:true|false, wxSel:''} — [끄기] 뒤 지도에 반영
    var _applyPendingOnOcean = false;   // 다른 탭에 갔다가 해양종합정보로 돌아오면 _pending 을 반영할 것
    var _wxOpen = false;        // 천기 스위치가 켜져 있는가(버튼만 나온 상태 포함)
    var _wxAvail = {};          // 천기 버튼별 자료 유무 {tmp:true, sno:false …} — 모르면 키 없음(= 있다고 본다)
    var _beachOpen = null;      // 개장 해수욕장 유무 — null: 아직 모름(평소 자리·누를 수 있음)
    var _fav = [];              // 즐겨찾기 id
    var _closed = [];           // 접어 둔 폴더 id
    var _freeBase = null;       // 배경을 정하는 기능이 하나도 안 켜졌을 때의 배경지도(= 사용자가 쓰던 것)
    var _forcedBase = false;    // 지금 배경을 우리가 정해 둔 상태인가
    var _tapCount = 0, _tapTimer = null;
    var _viewSeq = 0;           // [보기]를 연달아 눌렀을 때 앞선 누름의 뒤처리가 끼어들지 않게 하는 번호
    var _arbTimers = [];
    var _viewBasePrev = null;   // [보기] 화면 전용 배경(VIEWS[].base)으로 바꾸기 전의 배경 — 그 화면을 떠날 때 되돌린다
    var _accBusy = false;       // 사고 자료를 받는 동안의 로딩 표시가 떠 있는가
    var _loadSeq = 0;           // 천기 로딩 표시 — 연달아 눌렀을 때 앞선 표시가 끼어들지 않게 하는 번호
    var _northPrev = null;      // 새 모드를 켜기 전 진북 상태('free'|'aligned'|'locked') — 끌 때 되돌린다

    // ========================================================================
    // 작은 도구
    // ========================================================================

    function $(sel) { return document.querySelector(sel); }
    function _esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function _isActive(el) { return !!(el && el.classList.contains('active')); }
    function _tab() { return document.body.getAttribute('data-active-tab') || ''; }

    /** 우리가 대신 누르는 동안 사용량 집계·안내 토스트를 막는다(사용자가 직접 누른 것이 아닌 뒤처리용).
     *  예: _quiet(function () { btn.click(); })  [연계] → window.withUsageSuppressed (shared/utils/utils.js) */
    function _quiet(fn) {
        var orig = window._showOceanToast;
        window._showOceanToast = function () {};
        var run = window.withUsageSuppressed || function (f) { f(); };
        try { run(fn); } finally { window._showOceanToast = orig; }
    }

    function _load(key) {
        try { var v = JSON.parse(localStorage.getItem(key)); return Array.isArray(v) ? v : null; } catch (e) { return null; }
    }
    function _save(key, arr) {
        try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) { /* 저장이 막힌 브라우저 — 이번 실행 동안만 유지 */ }
    }

    // ========================================================================
    // 1. 켜짐 상태 읽기 · 대신 누르기 (해양기상정보 스위치)
    // ========================================================================

    function _wxItemEl(subId) {
        return subId === 'vsby' ? document.getElementById('ocean-vsby-toggle-btn')
            : $('#ocean-other-wx-popup .ocean-other-wx-item[data-shrt="' + subId + '"]');
    }
    /** 지금 지도에 그려진 천기 종류 id('' = 없음). 예: 기온을 고른 상태 → 'tmp' */
    function _wxActiveSub() {
        for (var i = 0; i < WX_SUBS.length; i++) { if (_isActive(_wxItemEl(WX_SUBS[i].id))) return WX_SUBS[i].id; }
        return '';
    }

    /** 그 스위치가 지금 실제로 켜져 있는가(지도 기준). 예: _liveOn('wind') → 풍향·풍속 버튼이 active 면 true */
    function _liveOn(id) {
        if (id === 'wx') return _wxOpen || !!_wxActiveSub();
        var def = SWITCHES[id];
        return _isActive(def && def.sel ? $(def.sel) : null);
    }
    /** 사이드바에 보여 줄 켜짐 상태 — [보기] 중에는 미뤄 둔 값(_pending) */
    function _shownOn(id) { return _pending ? !!_pending[id] : _liveOn(id); }

    /** 특보 현황(발효 중 특보 색칠) 버튼을 원하는 상태로 맞춘다 — 버튼은 특보가 있을 때만 나타나므로 잠깐 기다리며 시도한다.
     *  [연계] → #ocean-warn-active-toggle-btn (ocean_warn_active4.js _renderButton) */
    function _setWarnActive(wantOn, tries) {
        var btn = document.getElementById('ocean-warn-active-toggle-btn');
        var shown = btn && btn.style.display !== 'none';
        if (wantOn && !_liveOn('zone')) return;
        if (btn && _isActive(btn) !== wantOn && (shown || !wantOn)) { _quiet(function () { btn.click(); }); return; }
        if (wantOn && !shown && (tries || 0) < 10 && _liveOn('zone')) {
            setTimeout(function () { _setWarnActive(true, (tries || 0) + 1); }, 300);
        }
    }

    /**
     * 스위치 하나를 지도에서 실제로 켜거나 끈다.
     * 예: _setLive('wav', true) → 파고·파향 버튼을 대신 누른다 / _setLive('zone', true) → 특보구역 + 특보 현황
     * @param {string} id - SWITCHES 의 키 @param {boolean} on @param {boolean} [byUser] - 사용자가 직접 누른 것(사용량을 센다)
     * [연계] ← _toggle()·_applyPending() / → 원래 버튼 click
     */
    function _setLive(id, on, byUser) {
        if (_liveOn(id) === on && id !== 'typh') return;
        var press = function (el) { if (!el) return; if (byUser) el.click(); else _quiet(function () { el.click(); }); };
        if (id === 'wx') {
            if (on) { _wxOpen = true; _probeWx(); }
            else { var cur = _wxItemEl(_wxActiveSub()); if (cur) press(cur); _wxOpen = false; }
            return;
        }
        if (id === 'zone') {
            var zoneBtn = $(SWITCHES.zone.sel);
            if (on) { press(zoneBtn); _setWarnActive(true); }
            else { _setWarnActive(false); if (_isActive(zoneBtn)) press(zoneBtn); }
            return;
        }
        press($(SWITCHES[id].sel));
    }

    /**
     * 사이드바 스위치를 눌렀을 때 — [보기] 중이면 미뤄 두고, 아니면 바로 지도에 반영한다.
     * 예: 풍향·풍속이 켜진 채 파고·파향을 누름 → 풍향·풍속이 꺼지고 파고·파향이 켜진다(함께 켤 수 없는 묶음)
     * [연계] ← 사이드바 줄 클릭 / → _setLive() · _arbitrateSoon()
     */
    function _toggle(id) {
        var on = !_shownOn(id);
        if (_pending) {
            if (id === 'typh' && _typhDisabled()) return;
            if (on && EXCLUSIVE.indexOf(id) >= 0) EXCLUSIVE.forEach(function (x) { _pending[x] = false; });
            _pending[id] = on;
            if (id === 'wx' && !on) _pending.wxSel = '';
            _renderRows();
            return;
        }
        if (id === 'typh') {
            // 태풍 버튼은 그대로 대신 누른다 — 활성 태풍이 없을 때 10번 누르면 열리는 숨은 기능을 그 버튼이 갖고 있다
            _noteFreeBase();
            var tb = $(SWITCHES.typh.sel); if (tb) tb.click();
            _arbitrateSoon(); _renderRows(); return;
        }
        _noteFreeBase();
        if (on && EXCLUSIVE.indexOf(id) >= 0) {
            EXCLUSIVE.forEach(function (x) { if (x !== id && _liveOn(x)) _setLive(x, false); });
        }
        _setLive(id, on, true);
        // 배경지도와 무관한 스위치(기상부이·CCTV)는 사용자가 고른 배경을 건드리지 않는다
        if (id !== 'buoy' && id !== 'cctv') _arbitrateSoon();
        _renderRows(); _renderSubs();
    }

    function _typhDisabled() {
        var b = $(SWITCHES.typh.sel);
        return !b || b.classList.contains('tphn-disabled');
    }
    function _typhActive() { return !!(window.OceanTyphoon && window.OceanTyphoon.hasActive && window.OceanTyphoon.hasActive()); }

    // ========================================================================
    // 2. 배경지도 — 기본은 해안도, 태풍(세계지도)·해구기상(기본맵)이 켜지면 그쪽이 먼저
    // ========================================================================

    /** 배경을 정하는 기능이 하나도 안 켜진 상태면 지금 배경을 「사용자가 쓰던 배경」으로 적어 둔다. */
    function _noteFreeBase() {
        if (_forcedBase || typeof window.oceanGetBasemap !== 'function') return;
        if (_wantBase()) return;
        _freeBase = window.oceanGetBasemap();
    }
    /** 지금 켜진 기능으로 볼 때 써야 할 배경. 예: 파고 + 태풍 → 'osm' / 파고만 → 'coast' / 없음 → null */
    function _wantBase() {
        if (window.OceanTyphoon && window.OceanTyphoon.isVisible && window.OceanTyphoon.isVisible()) return 'osm';
        if (_liveOn('grid')) return 'rltm';
        if (_liveOn('zone') || _liveOn('wav') || _liveOn('wind') || _liveOn('cur')) return 'coast';
        return null;
    }
    /**
     * 켜진 기능에 맞는 배경지도로 맞춘다(기능마다 따로 기억하던 「켜기 전 배경」이 순서에 따라 어긋나는 것을 덮는다).
     * 예: 파고(해안도) 위에 태풍을 켬 → 세계지도 / 태풍을 끔 → 해안도 / 다 끔 → 처음 쓰던 배경
     * [연계] ← _arbitrateSoon() / → window.oceanSetBasemap (ocean_map.js — 새 모드에서는 배경이 바뀌어도 오버레이를 끄지 않는다)
     */
    function _arbitrateBasemap() {
        if (!_mode || _view || _tab() !== 'ocean-map-section') return;
        if (typeof window.oceanGetBasemap !== 'function' || typeof window.oceanSetBasemap !== 'function') return;
        var want = _wantBase(), cur = window.oceanGetBasemap();
        if (want) {
            if (_freeBase === null) _freeBase = cur;
            _forcedBase = true;
            if (cur !== want) window.oceanSetBasemap(want);
        } else if (_forcedBase) {
            _forcedBase = false;
            if (_freeBase && cur !== _freeBase) window.oceanSetBasemap(_freeBase);
        } else {
            _freeBase = cur;
        }
    }
    function _arbitrateSoon() {
        _arbTimers.forEach(clearTimeout); _arbTimers = [];
        [80, 700, 1800].forEach(function (ms) { _arbTimers.push(setTimeout(function () { _arbitrateBasemap(); _renderRows(); _renderSubs(); }, ms)); });
    }

    // ========================================================================
    // 3. 천기 버튼 — 자료 유무 미리 알아보기 · 고르기
    // ========================================================================

    /** 천기 버튼 7개의 자료 유무를 한꺼번에 알아본다(천기를 켤 때). 못 받은 버튼은 회색 + 맨 뒤.
     *  [연계] → window._shrtForecastHasFrames (shrt_forecast_layer.js) · window.VsbyRaster.frames (vsby_forecast_layer.js) */
    function _probeWx() {
        WX_SUBS.forEach(function (s) {
            var p;
            if (s.id === 'vsby') {
                p = (window.VsbyRaster && window.VsbyRaster.frames)
                    ? window.VsbyRaster.frames().then(function (a) { return !!(a && a.length); }).catch(function () { return false; }) : null;
            } else {
                p = typeof window._shrtForecastHasFrames === 'function' ? window._shrtForecastHasFrames(s.id) : null;
            }
            if (!p) return;
            p.then(function (ok) { if (_wxAvail[s.id] !== ok) { _wxAvail[s.id] = ok; _renderSubs(); } });
        });
    }
    /** 천기 버튼을 눌렀을 때. 예: 기온 → 기온 그림 / 자료 없는 버튼 → 알림만 */
    function _pickWx(subId) {
        if (_wxAvail[subId] === false) {
            if (typeof window.showLocateStyleNotice === 'function') window.showLocateStyleNotice(WX_NO_DATA_MSG);
            _probeWx();     // 잠깐의 장애였으면 다음에 누를 때는 풀려 있게 다시 알아본다
            return;
        }
        var el = _wxItemEl(subId);
        if (!el) return;
        _noteFreeBase();
        // 천기 그림은 특보구역·현황과 함께 켤 수 없다(하나만) — 파고·풍향·유향은 원래 코드가 끈다
        if (!_isActive(el) && _liveOn('zone')) _setLive('zone', false);
        var turningOn = !_isActive(el);
        el.click();
        _wxOpen = true;
        if (turningOn) _showWxLoading();
        _arbitrateSoon(); _renderRows(); _renderSubs();
    }

    /**
     * 천기 그림을 받는 동안 화면 가운데에 「불러오는 중입니다...」를 띄운다(항행경보의 로딩 표시와 같은 모양).
     * 그림 층이 범례 자리에 「데이터를 불러오는 중…」을 적어 두는 동안을 받는 중으로 본다.
     * [연계] ← _pickWx() / 읽는 곳: .shrt-fcst-legend-loading(shrt_forecast_layer.js) · .vsby-fcst-legend-loading(vsby_forecast_layer.js)
     */
    function _showWxLoading() {
        var box = document.getElementById('om-loading');
        if (!box) return;
        var seq = ++_loadSeq, n = 0;
        box.hidden = false;
        (function tick() {
            if (seq !== _loadSeq) return;
            var lg = $('.shrt-fcst-legend-loading, .vsby-fcst-legend-loading');
            var busy = !!lg && lg.textContent.indexOf('불러오는 중') >= 0 && lg.offsetParent !== null;
            // 처음 0.4초는 범례가 아직 안 바뀌었을 수 있어 기다린다 · 최대 20초
            if ((busy || n < 2) && n < 100 && _mode && !_view) { n++; setTimeout(tick, 200); }
            else box.hidden = true;
        })();
    }

    // ========================================================================
    // 4. 해수욕 — 개장 해수욕장 유무(해양종합정보 탭에 들어올 때 받아 둔다)
    // ========================================================================

    function _todayKst() {
        var d = new Date(Date.now() + 9 * 3600 * 1000);
        var p = function (n) { return n < 10 ? '0' + n : '' + n; };
        return '' + d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate());
    }
    /**
     * 서버가 받아 둔 해수욕지수에서 「오늘 개장한 해수욕장이 하나라도 있는가」를 본다.
     * 예: 응답 places 중 한 곳이라도 오늘 자 예보의 opnStat 이 '개장' → true / 하나도 없거나 자료가 없음(404) → false
     * @param {Object} json - GET /api/swimming-index 응답 @returns {boolean}
     * [연계] ← _fetchBeach() · 시험(test_ocean_menu_ui.js 가 이 함수를 직접 부른다)
     */
    function _anyBeachOpen(json) {
        var places = (json && json.places) || {}, today = _todayKst();
        for (var name in places) {
            var day = ((places[name] || {}).forecasts || {})[today];
            if (!day) continue;
            for (var slot in day) { if (day[slot] && day[slot].opnStat === '개장') return true; }
        }
        return false;
    }
    function _fetchBeach() {
        var base = (window.CONFIG && window.CONFIG.API_BASE) || '';
        fetch(base + '/api/swimming-index').then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) { _beachOpen = _anyBeachOpen(j); _renderRows(); })
            .catch(function () { /* 못 받으면 모르는 채로 둔다 — 해수욕 줄은 평소 자리에서 누를 수 있다 */ });
    }

    // ========================================================================
    // 5. [보기] — 해양안전 지도 화면 · 해양생활 활동 화면으로 넘어가기 / [끄기]
    // ========================================================================

    function _safetyShown() {
        var sec = document.getElementById('ocean-map-section');
        return _tab() === 'ocean-life-group' && document.body.classList.contains('ls-safety') && !!(sec && sec.classList.contains('active'));
    }

    /** 지금 지도의 스위치 상태를 적어 둔다 — [보기] 동안 사이드바 스위치는 이 값을 바꾸고, [끄기] 뒤 지도에 반영한다. */
    function _snapshotPending() {
        var p = { wxSel: _wxActiveSub() };
        Object.keys(SWITCHES).forEach(function (id) { p[id] = _liveOn(id); });
        return p;
    }

    /**
     * [보기]를 눌렀을 때 — 그 화면을 열고 사이드바를 닫는다. 한 번에 하나만 열린다.
     * 예: _openView('surf') → 서핑 화면 / 위험지형을 보다가 _openView('surf') → 위험지형이 닫히고 서핑
     * [연계] ← 사이드바 [보기]·[선박]·[인명] / → window.switchMainTab·switchSubTab(life_safety.js 래퍼) · _pressSafety()
     */
    function _openView(id) {
        var def = VIEWS[id];
        if (!def) return;
        if (id === 'swim' && _beachOpen === false) return;
        var seq = ++_viewSeq;
        var fresh = !_view && !_pending;      // 해양종합정보 지도에서 처음 여는 [보기]인가
        if (fresh) { _noteFreeBase(); _pending = _snapshotPending(); }
        _applyPendingOnOcean = false;
        _view = id;
        _setOpen(false);
        if (def.screen === 'safety') {
            if (_safetyShown()) { _pressSafety(def, seq); }
            else {
                if (typeof window._lsDropParkedSafety === 'function') window._lsDropParkedSafety();
                _go('ocean-safety-section');
                if (_tab() === 'ocean-life-group') _whenSafetyReady(seq, function () { _pressSafety(def, seq); });
            }
        } else {
            _restoreViewBase();
            _go(def.section);
        }
        // 점검으로 막힌 화면이면 탭이 바뀌지 않는다(index2_patch.js 가 안내 창만 띄운다) — 아무것도 바꾸지 않은 것으로 되돌린다
        if (_tab() !== 'ocean-life-group') { _viewSeq++; _view = ''; if (fresh) _pending = null; }
        _sync();
    }

    /** 섹션으로 이동 — 이미 해양안전생활 그룹 안이면 하위탭 전환, 아니면 메인탭 전환 */
    function _go(sectionId) {
        if (_tab() === 'ocean-life-group' && typeof window.switchSubTab === 'function') window.switchSubTab(sectionId);
        else if (typeof window.switchMainTab === 'function') window.switchMainTab(sectionId);
    }

    /** 해양안전 지도 화면이 준비되면(지도 초기화 + 되살리기 200ms 가 지난 뒤) fn 을 부른다 */
    function _whenSafetyReady(seq, fn, tries) {
        setTimeout(function () {
            if (seq !== _viewSeq) return;
            // 끝내 그 화면이 안 열렸으면 누르지 않는다 — 해양종합정보 지도 위에서 엉뚱한 버튼이 켜지면 안 된다
            if (_safetyShown()) fn(); else if ((tries || 0) < 20) _whenSafetyReady(seq, fn, (tries || 0) + 1);
        }, (tries ? 150 : 450));
    }

    /**
     * 해양안전 지도에서 그 화면의 버튼만 켜진 상태로 맞춘다(다른 것은 끈다). 사고정보는 분석/현황·선박/인명까지 맞춘다.
     * 예: 관제구역·항로 → 관제구역 + 항로·해역 두 버튼 / 사고이력(인명) → 사고정보 → 현황 → 인명사고
     * [연계] ← _openView() / → 원래 버튼 click · #ocean-accident-mode-toggle · #accident-source-toggle (accident_info.js)
     */
    function _pressSafety(def, seq) {
        _restoreViewBase();
        var want = def.btns;
        _quiet(function () {
            var on = document.querySelectorAll('#ocean-overlay-controls .ocean-overlay-btn.active');
            for (var i = 0; i < on.length; i++) { if (want.indexOf(on[i].id) < 0 && _isActive(on[i])) on[i].click(); }
        });
        want.forEach(function (bid) { var b = document.getElementById(bid); if (b && !_isActive(b)) b.click(); });
        if (def.accMode) { _accLoading(true); _setAccident(def, seq, 0); } else _accLoading(false);
        if (def.base) _applyViewBase(def.base, seq);
        _sync();
    }

    /** 사고정보의 분석/현황·선박/인명을 맞춘다 — 자료를 다 받은 뒤에야 전환 단추가 나타나므로 기다리며 시도한다 */
    /**
     * 그 화면 전용 배경지도로 바꾼다(바꾸기 전 배경을 적어 둔다). 위성지도 인증을 못 받으면 빈 화면 대신 기본맵으로.
     * 예: 갯벌 수위 예측 [보기] → 위성지도 / 다른 [보기]나 [끄기] → _restoreViewBase() 가 원래 배경으로
     * [연계] ← _pressSafety() / → window.oceanSetBasemap·oceanVworldReady (ocean_map.js — 위험예측과 같은 방식)
     */
    function _applyViewBase(base, seq) {
        if (typeof window.oceanGetBasemap !== 'function' || typeof window.oceanSetBasemap !== 'function') return;
        if (_viewBasePrev === null) _viewBasePrev = window.oceanGetBasemap();
        if (window.oceanGetBasemap() !== base) window.oceanSetBasemap(base);
        if (base === 'vworld' && typeof window.oceanVworldReady === 'function') {
            window.oceanVworldReady().then(function (ok) {
                if (ok || seq !== _viewSeq || window.oceanGetBasemap() !== 'vworld') return;
                window.oceanSetBasemap('rltm');
            });
        }
    }
    function _restoreViewBase() {
        if (_viewBasePrev === null) return;
        var prev = _viewBasePrev; _viewBasePrev = null;
        if (typeof window.oceanSetBasemap === 'function' && window.oceanGetBasemap && window.oceanGetBasemap() !== prev) window.oceanSetBasemap(prev);
    }

    /** 사고 자료를 받는 동안 화면 가운데 「불러오는 중입니다...」를 띄우고 내린다(천기와 같은 표시 — 2026-11-23 사용자).
     *  @param {boolean} on  [연계] ← _pressSafety()·_setAccident()·_afterNav() */
    function _accLoading(on) {
        var box = document.getElementById('om-loading');
        if (!box) return;
        if (on) { _loadSeq++; _accBusy = true; box.hidden = false; }
        else if (_accBusy) { _accBusy = false; box.hidden = true; }
    }

    function _setAccident(def, seq, tries) {
        if (seq !== _viewSeq) return;
        var tgl = document.getElementById('ocean-accident-mode-toggle');
        var ready = tgl && tgl.style.display !== 'none' && tgl.style.display !== '';
        if (!ready) { if (tries < 80) setTimeout(function () { _setAccident(def, seq, tries + 1 || 1); }, 250); else _accLoading(false); return; }
        var mBtn = tgl.querySelector('button[data-mode="' + def.accMode + '"]');
        // ⚠이미 그 모드면 누르지 않는다 — 같은 모드를 다시 누르면 필터 줄이 접힌다(accident_info.js)
        var okMode = !mBtn || _isActive(mBtn);
        if (!okMode) mBtn.click();
        var sBtn = def.accSrc ? $('#accident-source-toggle button[data-source="' + def.accSrc + '"]') : null;
        var okSrc = !sBtn || _isActive(sBtn);
        if (okMode && !okSrc) sBtn.click();
        if (!tries || !okMode || !okSrc) {
            var bar = document.getElementById('accident-filter-bar');
            if (bar && !tries) bar.classList.remove('om-open');     // 필터는 접힌 채로 시작
            _syncFilterHead();
        }
        // 선박/인명의 눌린 표시는 자료를 다 받은 뒤에야 바뀐다 — 연달아 눌렀을 때 어긋나지 않게 맞을 때까지 다시 본다
        if ((!okMode || !okSrc) && tries < 80) setTimeout(function () { _setAccident(def, seq, tries + 1); }, 350);
        else _accLoading(false);     // 분석/현황·선박/인명이 다 맞았다(또는 끝내 못 맞췄다) — 로딩 표시를 내린다
    }

    /**
     * [끄기] — 보던 화면을 닫고 해양종합정보 지도로 돌아간다. 켜 두었던 해양기상정보가 그대로 다시 나온다.
     * [연계] ← 안내 줄·사이드바의 [끄기] · 뒤로가기(PopupStack) / → window.switchMainTab('ocean-map-section') —
     *          life_safety.js 래퍼가 숨겨 둔 버튼을 되살린다(_restoreOceanOverlays) → _afterNav() 가 미뤄 둔 스위치를 반영
     */
    function _closeView() {
        if (!_view && _tab() !== 'ocean-life-group') return;
        _viewSeq++;
        _restoreViewBase();
        if (typeof window.switchMainTab === 'function') window.switchMainTab('ocean-map-section');
    }

    /** [보기] 동안 사이드바에서 바꾼 스위치를 지도에 반영한다(해양종합정보 지도로 돌아온 직후). */
    function _applyPending() {
        var p = _pending;
        _pending = null; _applyPendingOnOcean = false;
        if (!p) return;
        Object.keys(SWITCHES).forEach(function (id) {
            if (id === 'wx' || id === 'typh') return;
            if (_liveOn(id) !== !!p[id]) _setLive(id, !!p[id]);
        });
        var tb = $(SWITCHES.typh.sel);
        if (tb && _isActive(tb) !== !!p.typh && !_typhDisabled()) _quiet(function () { tb.click(); });
        if (p.wx) {
            _wxOpen = true; _probeWx();
            var sel = p.wxSel && _wxItemEl(p.wxSel);
            if (sel && !_isActive(sel)) _quiet(function () { sel.click(); });
        } else {
            _setLive('wx', false);
        }
        _arbitrateSoon();
    }

    /** 우리 [보기]가 아닌 길(브리핑의 「지도에서 보기」 등)로 해양안전생활 화면에 들어온 경우, 지금 화면에서 이름을 알아낸다. */
    function _inferView() {
        if (_safetyShown()) {
            var ids = Object.keys(VIEWS);
            for (var i = 0; i < ids.length; i++) {
                var d = VIEWS[ids[i]];
                if (d.screen !== 'safety' || d.accMode) continue;
                if (_isActive(document.getElementById(d.btns[0]))) return ids[i];
            }
            if (_isActive(document.getElementById('ocean-accident-toggle-btn'))) {
                var st = $('#ocean-accident-mode-toggle button.active');
                if (st && st.getAttribute('data-mode') === 'status') {
                    var src = $('#accident-source-toggle button.active');
                    return src && src.getAttribute('data-source') === 'person' ? 'accPerson' : 'accShip';
                }
                return 'accStat';
            }
            return '_safety';
        }
        var keys = Object.keys(VIEWS);
        for (var k = 0; k < keys.length; k++) {
            var v = VIEWS[keys[k]];
            var sec = v.section && document.getElementById(v.section);
            if (sec && sec.classList.contains('active')) return keys[k];
        }
        return '_safety';
    }
    function _viewLabel(id) { return id === '_safety' ? '해양안전' : ((VIEWS[id] || {}).label || ''); }

    /**
     * 탭이 바뀔 때마다 — 우리 상태(_view·_pending)를 실제 화면에 맞춘다.
     * 예: [보기] 중 아래 「해양종합정보」 탭을 누름 → [끄기]와 같다 / 특보정보 탭으로 떠남 → 보기 끝, 돌아오면 스위치 반영
     * [연계] ← _wrapTabSwitchers() 가 감싼 switchMainTab·switchSubTab 직후
     */
    function _afterNav(pre) {
        if (!_mode) return;
        var tab = _tab();
        if (tab !== 'ocean-life-group' || !_safetyShown()) { _accLoading(false); _restoreViewBase(); }
        if (tab === 'ocean-life-group') {
            // 우리 [보기]가 아닌 길로 들어온 경우에도, 들어오기 직전의 스위치 상태(pre)를 미뤄 둔 값으로 삼는다
            if (!_pending) _pending = pre || _snapshotPending();
            if (!_view) {
                _view = _inferView();
                // 해양안전 화면은 들어온 200ms 뒤에 지난번 버튼을 되살린다(life_safety.js) — 그 뒤에 이름을 한 번 더 본다
                setTimeout(function () { if (_mode && _view === '_safety' && _tab() === 'ocean-life-group') { _view = _inferView(); _sync(); } }, 700);
            }
            else if (_view.charAt(0) === '_' || !VIEWS[_view] || !_viewMatches()) {
                // 하위탭이 다른 길로 바뀌었으면(드문 경우) 지금 화면 이름으로 맞춘다
                var inf = _inferView(); if (inf !== '_safety' || !_safetyShown()) _view = inf;
            }
        } else {
            var had = !!_view;
            _view = '';
            if (tab === 'ocean-map-section') {
                if (_pending) setTimeout(_applyPending, 60);
                _fetchBeach();
            } else if (had || _pending) {
                _applyPendingOnOcean = true;
            }
        }
        _sync();
    }
    function _viewMatches() {
        var d = VIEWS[_view];
        if (!d) return false;
        if (d.screen === 'life') { var s = document.getElementById(d.section); return !!(s && s.classList.contains('active')); }
        return _safetyShown() || _tab() === 'ocean-life-group';
    }

    function _wrapTabSwitchers() {
        var origMain = window.switchMainTab, origSub = window.switchSubTab;
        // 화면이 바뀌기 **전에** 스위치 상태를 적는다 — 해양안전생활 화면에 들어가면 life_safety.js 가 버튼을 꺼 버리므로
        var pre = function () { return (_mode && !_pending && _tab() !== 'ocean-life-group') ? _snapshotPending() : null; };
        if (typeof origMain === 'function') {
            window.switchMainTab = function () { var p = pre(); var r = origMain.apply(window, arguments); _afterNav(p); return r; };
        }
        if (typeof origSub === 'function') {
            window.switchSubTab = function () { var p = pre(); var r = origSub.apply(window, arguments); _afterNav(p); return r; };
        }
    }

    // ========================================================================
    // 6. 화면 요소 만들기 · 그리기
    // ========================================================================

    function _build() {
        if (_built) return;
        _built = true;
        var wrap = document.createElement('div');
        wrap.id = 'om-root';
        wrap.innerHTML =
            '<div id="om-banner" role="status" hidden><span class="om-banner-text"></span>' +
                '<button type="button" class="om-banner-off" data-om="off">끄기</button></div>' +
            '<button type="button" id="om-menu-btn" aria-label="전체 메뉴 열기" aria-expanded="false" data-om="open">' +
                '<i class="fa-solid fa-bars" aria-hidden="true"></i><span class="om-menu-label">전체 메뉴</span>' +
                '<span class="om-count" hidden></span></button>' +
            '<div id="om-subs" hidden></div>' +
            '<div id="om-loading" role="status" hidden><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>불러오는 중입니다...</span></div>' +
            '<div id="om-backdrop" data-om="close" hidden></div>' +
            '<aside id="om-sidebar" aria-label="해양종합정보 메뉴" aria-hidden="true">' +
                '<button type="button" class="om-handle" data-om="close" aria-label="메뉴 접기">' +
                    '<i class="fa-solid fa-chevron-right" aria-hidden="true"></i><span>접<br>기</span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>' +
                '<div class="om-head"><span>해양종합정보 메뉴</span>' +
                    '<button type="button" class="om-x" data-om="close" aria-label="닫기"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>' +
                '<div class="om-body">' +
                    '<div class="om-viewbox" hidden><p class="om-viewbox-text"></p>' +
                        '<button type="button" class="om-viewbox-off" data-om="off">화면 끄기</button></div>' +
                    '<div class="om-folders"></div>' +
                '</div>' +
            '</aside>';
        document.body.appendChild(wrap);

        var folders = wrap.querySelector('.om-folders');
        [{ id: 'fav', title: '즐겨찾기' }].concat(FOLDERS).forEach(function (f) {
            var sec = document.createElement('section');
            sec.className = 'om-folder';
            sec.setAttribute('data-folder', f.id);
            sec.innerHTML =
                '<button type="button" class="om-folder-head" data-om="fold" aria-expanded="true">' +
                    (f.id === 'fav' ? '<i class="fa-solid fa-star om-fav-ico" aria-hidden="true"></i>' : '') +
                    '<span class="om-folder-title">' + _esc(f.title) + '</span><span class="om-folder-count"></span>' +
                    '<i class="fa-solid fa-chevron-down om-chev" aria-hidden="true"></i></button>' +
                '<div class="om-folder-body"><div class="om-folder-inner"></div></div>';
            folders.appendChild(sec);
        });

        wrap.addEventListener('click', _onClick);
        document.addEventListener('keydown', function (e) { if (_mode && _open && e.key === 'Escape') _setOpen(false); });
        _buildFilterHead();
        // 원래 버튼들의 켜짐 표시가 바뀌면(다른 코드가 켜고 끌 때 포함) 사이드바를 다시 그린다
        var rail = document.getElementById('ocean-overlay-controls');
        if (rail && window.MutationObserver) {
            var t = null;
            new MutationObserver(function () {
                if (!_mode) return;
                clearTimeout(t); t = setTimeout(function () { _renderRows(); _renderSubs(); _syncFilterHead(); }, 40);
            }).observe(rail, { attributes: true, attributeFilter: ['class', 'style'], subtree: true });
        }
        var gubun = document.getElementById('ls-gubun-wrap');
        if (gubun && window.MutationObserver) {
            new MutationObserver(function () { if (_mode) _renderSubs(); })
                .observe(gubun, { attributes: true, attributeFilter: ['class'], subtree: true });
        }
    }

    /** 사고이력의 「필터」 머리 버튼을 필터 줄(#accident-filter-bar) 맨 위에 끼운다 — 누르면 아래로 펼쳐진다(새 모드에서만 보인다). */
    function _buildFilterHead() {
        var bar = document.getElementById('accident-filter-bar');
        if (!bar || document.getElementById('om-acc-filter-head')) return;
        var b = document.createElement('button');
        b.type = 'button'; b.id = 'om-acc-filter-head'; b.className = 'om-acc-filter-head';
        b.setAttribute('aria-expanded', 'false');
        b.innerHTML = '<span>필터 선택</span><i class="fa-solid fa-chevron-down" aria-hidden="true"></i>';
        b.addEventListener('click', function (e) {
            e.stopPropagation();
            bar.classList.toggle('om-open');
            _syncFilterHead();
        });
        bar.insertBefore(b, bar.firstChild);
        // 「선택 초기화」를 누르면 필터도 접는다(새 모드에서만 — 2026-11-23 사용자 「선택 초기화를 누르면 필터는 자동으로 접히도록」)
        var reset = document.getElementById('accident-filter-reset-btn');
        if (reset) reset.addEventListener('click', function () {
            if (!_mode) return;
            bar.classList.remove('om-open');
            _syncFilterHead();
        });
    }
    function _syncFilterHead() {
        var bar = document.getElementById('accident-filter-bar'), b = document.getElementById('om-acc-filter-head');
        var open = !!(bar && bar.classList.contains('om-open'));
        if (b) b.setAttribute('aria-expanded', String(open));
        document.body.classList.toggle('om-filter-open', _mode && open);   // 「선택 초기화」 자리(필터 폭 옆)를 CSS 가 옮긴다
    }

    /** 폴더 하나에 들어갈 줄 목록(자리 옮김 반영). 예: 활성 태풍이 없으면 태풍 줄이 맨 뒤로, 개장 해수욕장이 없으면 해수욕이 맨 뒤로 */
    function _rowsOf(folder) {
        var rows = folder.rows.slice();
        var moveLast = function (id) {
            var i = -1; rows.forEach(function (r, k) { if (r.id === id) i = k; });
            if (i >= 0) rows.push(rows.splice(i, 1)[0]);
        };
        if (folder.id === 'wx' && !_typhActive()) moveLast('typh');
        if (folder.id === 'life' && _beachOpen === false) moveLast('swim');
        return rows;
    }
    function _findRow(id) {
        for (var i = 0; i < FOLDERS.length; i++) {
            for (var j = 0; j < FOLDERS[i].rows.length; j++) { if (FOLDERS[i].rows[j].id === id) return FOLDERS[i].rows[j]; }
        }
        return null;
    }

    function _rowHTML(r, inFav) {
        var star = '';
        if (r.kind !== 'label') {
            var fav = _fav.indexOf(r.id) >= 0;
            star = '<button type="button" class="om-star' + (fav ? ' on' : '') + '" data-om="fav" data-id="' + r.id + '" aria-label="' +
                (fav ? '즐겨찾기 풀기' : '즐겨찾기') + '" aria-pressed="' + fav + '"><i class="' + (fav ? 'fa-solid' : 'fa-regular') + ' fa-star" aria-hidden="true"></i></button>';
        }
        var cls = 'om-row' + (r.sub && !inFav ? ' om-row-sub' : '');
        if (r.kind === 'label') return '<div class="' + cls + ' om-row-label"><span class="om-name">' + _esc(r.label) + '</span></div>';
        if (r.kind === 'pair') {
            return '<div class="' + cls + '"><span class="om-name">' + _esc(r.label) + '</span>' + r.pair.map(function (p) {
                return '<button type="button" class="om-view-btn' + (_view === p[0] ? ' on' : '') + '" data-om="view" data-id="' + p[0] + '">' + _esc(p[1]) + '</button>';
            }).join('') + star + '</div>';
        }
        if (r.kind === 'view') {
            var def = VIEWS[r.id], dead = r.id === 'swim' && _beachOpen === false, cur = _view === r.id;
            return '<div class="' + cls + (dead ? ' om-dead' : '') + '"><button type="button" class="om-main" data-om="view" data-id="' + r.id + '"' +
                (dead ? ' aria-disabled="true"' : '') + '><span class="om-name">' + _esc(def.label) +
                (dead ? '<small>개장 해수욕장 없음</small>' : '') + '</span>' +
                '<span class="om-view-btn' + (cur ? ' on' : '') + '">' + (cur ? '보는 중' : '보기') + '</span></button>' + star + '</div>';
        }
        var on = _shownOn(r.id), off = r.id === 'typh' && _typhDisabled();
        return '<div class="' + cls + (off ? ' om-dead' : '') + '"><button type="button" class="om-main" data-om="sw" data-id="' + r.id + '" role="switch" aria-checked="' + on + '">' +
            '<span class="om-name">' + _esc(SWITCHES[r.id].label) + (off ? '<small>활성 태풍 없음</small>' : '') + '</span>' +
            '<span class="om-sw' + (on ? ' on' : '') + '" aria-hidden="true"></span></button>' + star + '</div>';
    }

    /** 폴더 안 줄들을 지금 상태로 다시 그린다(폴더 틀은 그대로 — 접고 펴는 움직임이 끊기지 않게). */
    function _renderRows() {
        if (!_built || !_mode) return;
        var root = document.getElementById('om-sidebar');
        var favRows = _fav.map(_findRow).filter(Boolean);
        var groups = [{ id: 'fav', rows: favRows }].concat(FOLDERS.map(function (f) { return { id: f.id, rows: _rowsOf(f) }; }));
        groups.forEach(function (g) {
            var sec = root.querySelector('.om-folder[data-folder="' + g.id + '"]');
            if (!sec) return;
            var closed = _closed.indexOf(g.id) >= 0;
            sec.classList.toggle('closed', closed);
            sec.querySelector('.om-folder-head').setAttribute('aria-expanded', String(!closed));
            sec.querySelector('.om-folder-count').textContent = String(g.rows.filter(function (r) { return r.kind !== 'label'; }).length);
            var html = g.rows.map(function (r) { return _rowHTML(r, g.id === 'fav'); }).join('');
            if (g.id === 'fav' && !g.rows.length) html = '<p class="om-empty">아래 목록에서 ☆ 를 누르면 여기로 올라옵니다</p>';
            var inner = sec.querySelector('.om-folder-inner');
            if (inner.innerHTML !== html) inner.innerHTML = html;
        });
        var n = 0;
        Object.keys(SWITCHES).forEach(function (id) { if (_shownOn(id)) n++; });
        var cnt = $('#om-menu-btn .om-count');
        if (cnt) { cnt.textContent = String(n); cnt.hidden = n === 0; }
        _fitNames();
    }

    /** [메뉴] 아래 버튼 줄 — 천기를 켰을 때 7개(자료 없는 것은 회색 + 맨 뒤) / 바다낚시를 볼 때 갯바위·선상 */
    function _renderSubs() {
        if (!_built || !_mode) return;
        var box = document.getElementById('om-subs'), html = '';
        if (_view === 'fish') {
            ['갯바위', '선상'].forEach(function (g) {
                var orig = $('#ls-rail .ls-gubun-item[data-gubun="' + g + '"]');
                // 왼쪽 버튼(기본맵 등)과 같은 크기 + 선 그림(산·배) — 2026-11-23 사용자 「라안이 좋겠어」(시안 6차)
                html += '<button type="button" class="ocean-overlay-btn om-sub om-gubun' + (_isActive(orig) ? ' active' : '') + '" data-om="gubun" data-id="' + g + '">' +
                    '<i class="fa-solid ' + (g === '갯바위' ? 'fa-mountain' : 'fa-ship') + '" aria-hidden="true"></i>' +
                    '<span class="ocean-overlay-label">' + g + '</span></button>';
            });
        } else if (!_view && _wxOpen) {
            var cur = _wxActiveSub();
            var list = WX_SUBS.filter(function (s) { return _wxAvail[s.id] !== false; }).concat(WX_SUBS.filter(function (s) { return _wxAvail[s.id] === false; }));
            list.forEach(function (s) {
                var dead = _wxAvail[s.id] === false;
                // 원래 버튼(#ocean-other-wx-popup 안)의 아이콘·이름을 그대로 베낀다 — 지금 앱의 버튼과 같은 크기·모양
                var orig = _wxItemEl(s.id);
                var inner = orig ? orig.innerHTML : '<span class="ocean-overlay-label">' + s.label.join('') + '</span>';
                html += '<button type="button" class="ocean-overlay-btn om-sub' + (cur === s.id ? ' active' : '') + (dead ? ' om-sub-dead' : '') + '" data-om="wx" data-id="' + s.id + '"' +
                    (dead ? ' aria-disabled="true"' : '') + '>' + inner + '</button>';
            });
        }
        if (box.innerHTML !== html) box.innerHTML = html;
        box.hidden = !html;
    }

    /**
     * 진북 고정(North up fixed) — 새 모드에서는 「진북 정렬」 버튼을 없애고 지도를 늘 북쪽이 위로 고정해 둔다.
     * 2026-11-23 사용자 「진북정렬이라는 버튼은 삭제하고, 기본 진북 fix로 적용되어있도록 하자」.
     * 버튼(#ocean-northup-btn)은 CSS 로 감추고, 그 버튼을 대신 눌러 「고정」 상태(.northup-locked)까지 넘긴다
     * (자유 → 정렬 → 고정 3단 — ocean_northup.js). 끄면 켜기 전 상태로 되돌린다. 지도가 아직 안 만들어졌으면 잠깐 뒤 다시 한다.
     * @param {boolean} on  켜기/끄기
     * @param {number} [tries]  다시 해 본 횟수(안에서만 쓴다)  [연계] ← _setMode() → #ocean-northup-btn (ocean-map/map/ocean_northup.js)
     */
    function _lockNorth(on, tries) {
        var btn = document.getElementById('ocean-northup-btn');
        if (!btn) return;
        var stateOf = function () { return btn.classList.contains('northup-locked') ? 'locked' : (btn.classList.contains('northup-aligned') ? 'aligned' : 'free'); };
        var want = on ? 'locked' : _northPrev;
        if (on && _northPrev === null) _northPrev = stateOf();
        if (!want) return;
        _quiet(function () { for (var k = 0; k < 3 && stateOf() !== want; k++) btn.click(); });
        if (stateOf() !== want) {
            // 지도가 아직 준비 전이라 버튼이 듣지 않는다 — 조금 뒤 다시
            if ((tries || 0) < 12 && _mode === on) setTimeout(function () { _lockNorth(on, (tries || 0) + 1); }, 500);
            else if (!on) _northPrev = null;
            return;
        }
        if (!on) _northPrev = null;
        // 「고정」은 원래 휴대폰에 저장돼 다음 실행에도 남는다 — 새 모드는 앱을 껐다 켜면 원래대로여야 하니, 우리가 건 고정은 저장에서 뺀다
        else if (_northPrev !== 'locked') { try { localStorage.removeItem('oceanMap.northUp.locked'); } catch (e) { /* 저장이 막혀 있어도 화면은 그대로 돈다 */ } }
    }

    /**
     * 사이드바 줄 이름이 한 줄에 안 들어가면 자간을 줄이고, 그래도 넘치면 글자를 조금 줄인다(글자 크게 설정 대비).
     * 예: 폭 216px 사이드바 + 글자 크게 → 「출입통제·낚시금지」 자간 -0.1em
     * [연계] ← _renderRows()·_setOpen() / CSS: #om-sidebar .om-name { white-space: nowrap; overflow: hidden }
     */
    function _fitNames() {
        if (!_open) return;
        var els = document.querySelectorAll('#om-sidebar .om-name');
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            el.style.letterSpacing = ''; el.style.fontSize = '';
            if (el.clientWidth <= 0) continue;
            var steps = ['-0.06em', '-0.1em'];
            for (var k = 0; k < steps.length && el.scrollWidth > el.clientWidth + 1; k++) el.style.letterSpacing = steps[k];
            if (el.scrollWidth > el.clientWidth + 1) {
                var size = parseFloat(getComputedStyle(el).fontSize) || 13;
                el.style.fontSize = Math.max(size * 0.74, size * el.clientWidth / el.scrollWidth) + 'px';
            }
        }
    }

    /** 안내 줄·사이드바 안내·탭 표시·몸통 클래스를 지금 상태로 맞춘다. */
    function _sync() {
        if (!_built) return;
        var body = document.body, tab = _tab();
        var here = _mode && (tab === 'ocean-map-section' || tab === 'ocean-life-group');
        var viewing = _mode && !!_view && tab === 'ocean-life-group';
        body.classList.toggle('om-here', here);
        body.classList.toggle('om-view', viewing);
        if (!here && _open) _setOpen(false);

        var banner = document.getElementById('om-banner'), vbox = $('#om-sidebar .om-viewbox');
        var msg = viewing ? '<b>' + _esc(_viewLabel(_view)) + '</b> 화면 표출 중 해양기상정보는 표시되지 않습니다.' : '';
        banner.hidden = !viewing; vbox.hidden = !viewing;
        if (viewing) { banner.querySelector('.om-banner-text').innerHTML = msg; vbox.querySelector('.om-viewbox-text').innerHTML = msg; }
        // 좁은 화면에서 안내 글이 두 줄이 되면 글자 간격을 좁혀 한 줄로(한도를 넘으면 두 줄 그대로) — shared/ui/text_fit.js
        if (viewing && window.textFitOneLine) window.textFitOneLine(banner.querySelector('.om-banner-text'));
        var h = viewing ? banner.offsetHeight : 0;
        var prev = body.style.getPropertyValue('--om-banner-h');
        if (prev !== h + 'px') {
            body.style.setProperty('--om-banner-h', h + 'px');
            // 지도 영역의 높이가 바뀌었으니 지도들이 크기를 다시 재게 한다(OpenLayers 는 창 크기 변화를 듣는다)
            setTimeout(function () { try { window.dispatchEvent(new Event('resize')); } catch (e) { /* 옛 브라우저 — 다음 화면 전환 때 맞춰진다 */ } }, 60);
        }

        // 아래 탭: 새 모드에서는 해양안전생활 탭이 없으므로, [보기] 중에도 해양종합정보 탭이 켜진 것으로 보인다
        var oceanTab = $('.tab-btn[data-target="ocean-map-section"]');
        if (oceanTab && _mode) oceanTab.classList.toggle('active', here);

        // 뒤로가기 — [보기] 화면을 닫는다
        if (window.PopupStack) {
            if (viewing) window.PopupStack.push('om-view', function () { _closeView(); });
            else window.PopupStack.remove('om-view');
        }
        _renderRows(); _renderSubs(); _syncFilterHead();
    }

    function _setOpen(open) {
        if (!_built || _open === open) return;
        _open = open;
        document.body.classList.toggle('om-open', open);
        document.getElementById('om-sidebar').setAttribute('aria-hidden', String(!open));
        document.getElementById('om-menu-btn').setAttribute('aria-expanded', String(open));
        document.getElementById('om-backdrop').hidden = !open;
        if (window.PopupStack) {
            if (open) window.PopupStack.push('om-sidebar', function () { _setOpen(false); });
            else window.PopupStack.remove('om-sidebar');
        }
        if (open) { _renderRows(); setTimeout(_fitNames, 320); }
    }

    function _onClick(e) {
        var el = e.target.closest('[data-om]');
        if (!el) return;
        var act = el.getAttribute('data-om'), id = el.getAttribute('data-id');
        if (act === 'open') _setOpen(!_open);
        else if (act === 'close') _setOpen(false);
        else if (act === 'off') _closeView();
        else if (act === 'fold') {
            var fid = el.parentNode.getAttribute('data-folder'), i = _closed.indexOf(fid);
            if (i >= 0) _closed.splice(i, 1); else _closed.push(fid);
            _save(LS_CLOSED, _closed);
            el.parentNode.classList.toggle('closed', i < 0);
            el.setAttribute('aria-expanded', String(i >= 0));
        }
        else if (act === 'fav') {
            var k = _fav.indexOf(id);
            if (k >= 0) _fav.splice(k, 1); else _fav.push(id);
            _save(LS_FAV, _fav); _renderRows();
        }
        else if (act === 'sw') _toggle(id);
        else if (act === 'view') _openView(id);
        else if (act === 'wx') _pickWx(id);
        else if (act === 'gubun') {
            var orig = $('#ls-rail .ls-gubun-item[data-gubun="' + id + '"]');
            if (orig) orig.click();
            _renderSubs();
        }
    }

    // ========================================================================
    // 7. 새 모드 켜고 끄기 — 「해양종합정보」 탭 10번 누르기
    // ========================================================================

    /**
     * 새 모드를 켜거나 끈다(저장하지 않는다 — 앱을 껐다 켜면 평소 화면).
     * 예: _setMode(true) → body.om-mode + [메뉴] 버튼 / _setMode(false) → 보던 화면을 닫고 평소 화면
     * [연계] ← _bindTrigger() · window.OceanMenu.setMode(시험)
     */
    function _setMode(on) {
        on = !!on;
        if (_mode === on) return;
        if (!on) {
            if (_tab() === 'ocean-life-group') _closeView();
            _setOpen(false);
            _pending = null; _view = ''; _wxOpen = false; _loadSeq++; _accBusy = false;
            var lb = document.getElementById('om-loading'); if (lb) lb.hidden = true;
            // 평소 화면은 「해안도가 아니면 파고·풍향·유향을 켜 두지 않는다」 — 새 모드에서만 가능한 조합을 남기지 않는다
            if ((_liveOn('wav') || _liveOn('wind') || _liveOn('cur')) && typeof window.oceanGetBasemap === 'function' &&
                window.oceanGetBasemap() !== 'coast' && typeof window.oceanSetBasemap === 'function') window.oceanSetBasemap('coast');
        }
        _mode = on;
        if (on) {
            _build();
            _fav = _load(LS_FAV) || [];
            _closed = _load(LS_CLOSED) || [];     // 저장된 것이 없으면(처음) 모두 펼친 상태
            _freeBase = null; _forcedBase = false;
            _wxOpen = !!_wxActiveSub();
        }
        document.body.classList.toggle('om-mode', on);
        _lockNorth(on);
        if (!on) { document.body.classList.remove('om-here', 'om-view', 'om-open'); document.body.style.removeProperty('--om-banner-h'); }
        // 이미 그려진 특보 색칠·관제구역이 새 무늬·새 색으로 다시 그려지게 한다
        try { if (window.OceanWarnActive && window.OceanWarnActive.refresh) window.OceanWarnActive.refresh(); } catch (e) { /* 특보 층이 아직 없으면 켤 때 새 무늬로 그려진다 */ }
        if (on) {
            _noteFreeBase(); _fetchBeach(); if (_wxOpen) _probeWx();
            // 특보구역이 이미 켜져 있었으면 「특보구역·현황」 한 줄의 뜻대로 현황 색칠도 함께 켠다
            if (_liveOn('zone') && _tab() === 'ocean-map-section') _setWarnActive(true);
        }
        _sync();
        try { window.dispatchEvent(new Event('resize')); } catch (e2) { /* 위와 같다 */ }
        if (typeof window._showOceanToast === 'function') {
            window._showOceanToast(on ? '새 메뉴 화면으로 바뀌었습니다' : '원래 화면으로 돌아왔습니다', 'bottom', 1800);
        }
    }

    /** 아래 「해양종합정보」 탭을 3초 안에 10번 누르면 새 모드를 켜고 끈다. */
    function _bindTrigger() {
        var btn = $('.tab-btn[data-target="ocean-map-section"]');
        if (!btn) return;
        btn.addEventListener('click', function () {
            _tapCount++;
            clearTimeout(_tapTimer);
            _tapTimer = setTimeout(function () { _tapCount = 0; }, TAP_RESET_MS);
            if (_tapCount >= TAP_THRESHOLD) { _tapCount = 0; clearTimeout(_tapTimer); _setMode(!_mode); }
        });
        var others = document.querySelectorAll('.tab-btn:not([data-target="ocean-map-section"])');
        for (var i = 0; i < others.length; i++) others[i].addEventListener('click', function () { _tapCount = 0; });
    }

    document.addEventListener('DOMContentLoaded', function () {
        _wrapTabSwitchers();
        _bindTrigger();
    });

    /** 시험·점검용 창구 — 화면 코드는 쓰지 않는다. */
    window.OceanMenu = {
        isOn: function () { return _mode; },
        setMode: _setMode,
        open: function () { _setOpen(true); },
        close: function () { _setOpen(false); },
        toggle: _toggle,
        openView: _openView,
        closeView: _closeView,
        state: function () { return { mode: _mode, open: _open, view: _view, pending: _pending, wxOpen: _wxOpen, wxAvail: _wxAvail, beachOpen: _beachOpen, fav: _fav.slice(), closed: _closed.slice() }; },
        _anyBeachOpen: _anyBeachOpen,
        _setBeachOpen: function (v) { _beachOpen = v; _renderRows(); },
        _setWxAvail: function (id, ok) { _wxAvail[id] = ok; _renderSubs(); }
    };
})();
